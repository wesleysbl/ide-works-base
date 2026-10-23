/**
 * UMA CONEXÃO POR REQUISIÇÃO — F22, Fase 2.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   Cada chamada MCP abria ONZE clientes Postgres, um depois do outro: dois
 *   para resolver o ator, quatro para o freio de chamadas, dois de novo no
 *   despacho, dois para o contexto e um para a busca. Cada porto tinha o seu
 *   `connect()` → trabalho → `end()`, e ninguém via o total. Medido pelo
 *   pooler, 464–502 ms por conexão: 5,7–6,0 s de aperto de mão contra um prazo
 *   de 8 s, com a busca custando só 0,7 s.
 *
 *   O conserto não é cache nem atalho de segurança: é abrir o cliente UMA vez
 *   por requisição e emprestá-lo aos portos.
 *
 * POR QUE `AsyncLocalStorage` E NÃO UM PARÂMETRO
 *   O caminho do MCP atravessa o provedor OAuth da Cloudflare, que chama os
 *   `apiHandlers` com um `env` que ele mesmo monta. Não há por onde passar um
 *   cliente de mão em mão sem reescrever essa travessia. Guardar o cliente num
 *   campo do módulo seria pior: um isolado do Worker atende várias requisições
 *   ao mesmo tempo, e duas credenciais diferentes passariam a dividir conexão
 *   — exatamente o que a F16.5 proíbe. O contexto assíncrono mantém cada
 *   cliente preso à requisição que o abriu, e some junto com ela.
 *
 * POR QUE COMPARTILHAR NÃO AFROUXA O RECORTE
 *   O que declara o ator é `withActor`, e ele declara com `set_config(..., true)`
 *   — a forma LOCAL, que vale só até o fim da transação. Cada porto continua
 *   abrindo a sua transação e declarando o seu ator lá dentro; o Postgres
 *   devolve a sessão limpa no `commit`/`rollback`. Compartilhar o cliente,
 *   portanto, compartilha o SOCKET, nunca a declaração. Nenhuma transação
 *   enxerga o ator de outra, e o teste `db-request.test.ts` prova isso em
 *   transações intercaladas.
 *
 * FECHAR UMA VEZ SÓ, INCLUSIVE QUANDO O PRAZO ESTOURA
 *   `withDeadline` responde ANTES de o trabalho terminar quando os 8 s acabam:
 *   a promessa perdedora continua correndo com consulta no ar. Por isso o
 *   fechamento fica no `finally` do envelope mais de fora (`handleIntegration`)
 *   e passa por `end({ timeout: 5 })`, que drena o que estiver em voo e corta
 *   depois de cinco segundos em vez de deixar o socket pendurado. O fechamento
 *   é memoizado numa promessa só: erro, recusa e prazo caem todos no mesmo
 *   `finally`, e `end()` nunca é chamado duas vezes.
 *
 * ESPERAR O FECHAMENTO, MAS NÃO ATÉ CINCO SEGUNDOS
 *   Esperar o `end()` inteiro seria pagar o pior caso na hora errada: na
 *   resposta de `deadline_exceeded`, a consulta órfã ainda está em voo e o
 *   dreno pode levar os cinco segundos inteiros — quem já esperou 8 s esperaria
 *   13. Justamente o cenário que esta fase existe para melhorar.
 *
 *   Então o fechamento é ENTREGUE ao `waitUntil` da plataforma, que mantém o
 *   isolado vivo até ele terminar, e aqui só se espera uma CARÊNCIA curta. No
 *   caminho feliz o `end()` resolve em dezenas de milissegundos, cabe na
 *   carência e o cabeçalho da Fase 1 continua dizendo `closed=1` — a prova
 *   desta fase depende disso. No caminho do prazo, a resposta sai na hora e o
 *   dreno termina por fora; o cabeçalho dirá `closed=0`, que ali significa
 *   "ainda fechando", e não "vazou".
 *
 *   Sem `waitUntil` de verdade (script, teste, tarefa fora do Worker) NÃO se
 *   solta nada: espera-se o fechamento inteiro, porque nada mais garantiria que
 *   ele termina. Soltar não é esquecer.
 *
 * SE ALGUÉM PARALELIZAR OS PORTOS AMANHÃ
 *   O cliente compartilhado é um agrupador (`max: 5` pelo Hyperdrive). Hoje os
 *   portos correm um depois do outro, então o agrupador usa UM socket e a
 *   contagem no pooler bate com `conns=1`. Um `Promise.all` entre portos faria
 *   o driver reservar sockets separados: o recorte continua isolado — cada
 *   transação declara o seu ator —, mas a contagem lá no pooler passa de um.
 *   Quem for paralelizar está comprando isso, e deve medir de novo.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { connect, type ServerEnv, type Sql } from '@/server/db';

/** Rótulo da conexão compartilhada no cabeçalho de medição (`x-ideworks-db`). */
export const REQUEST_DB_LABEL = 'requisicao';

type Holder = {
  /**
   * Qual banco esta conexão alcança. Serve de trava: um porto que chegue com
   * OUTRA credencial NÃO herda este cliente — ele abre o seu, e a medição
   * mostra `conns=2`, que é como se descobre a regressão.
   */
  key: string | null;
  sql: Sql | null;
  /** A promessa do único `end()`. Não-nula significa "já fechando ou fechada". */
  closing: Promise<void> | null;
};

const store = new AsyncLocalStorage<Holder>();

/**
 * Identidade do destino do banco — credencial, não objeto.
 *
 * O `env` não serve de chave por referência: o provedor OAuth entrega aos
 * `apiHandlers` uma CÓPIA do ambiente (`{ ...env, OAUTH_KV }`), então comparar
 * referências recusaria o compartilhamento justo no caminho do MCP, que é o
 * caminho que precisa dele. O que importa é para onde a conexão aponta.
 */
function connectionKey(env: ServerEnv): string {
  if (env.HYPERDRIVE?.connectionString) return `hyperdrive:${env.HYPERDRIVE.connectionString}`;
  return [
    'direct',
    env.IDEWORKS_PUBLIC_SUPABASE_URL ?? '',
    env.IDEWORKS_SERVER_DB_HOST ?? '',
    env.IDEWORKS_SERVER_DB_USER ?? '',
    env.IDEWORKS_SERVER_DB_PASSWORD ?? '',
  ].join('|');
}

/**
 * Roda a requisição com uma conexão compartilhada disponível, e a fecha ao sair.
 *
 * O cliente é preguiçoso: uma requisição que não toca no banco (o
 * `.well-known`, a página de consentimento, um 404) não abre conexão nenhuma.
 */
/**
 * Quanto tempo se espera pelo fechamento antes de deixá-lo terminar por fora.
 *
 *   Fechar custou 38–55 ms na medição do diagnóstico — a carência é folgada
 *   para o caminho feliz e curta perto dos 8 s do prazo. Ela NÃO é um limite
 *   para o `end()`: quem limita é o `timeout: 5` dele.
 */
const CLOSE_GRACE_MS = 250;

export type RequestDbOptions = {
  /**
   * O `waitUntil` da plataforma. Com ele, o fechamento lento sai do caminho da
   * resposta sem deixar de acontecer. Sem ele, espera-se o fechamento inteiro.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
};

export async function withRequestDb<T>(
  work: () => Promise<T>,
  options: RequestDbOptions = {},
): Promise<T> {
  const holder: Holder = { key: null, sql: null, closing: null };
  try {
    return await store.run(holder, work);
  } finally {
    // O fechamento COMEÇA aqui em qualquer desfecho — resposta, erro, recusa ou
    // prazo. O que a carência decide é só quanto dele se espera.
    const closing = closeHolder(holder);
    const keepAlive = options.waitUntil;
    if (!keepAlive) {
      await closing;
    } else {
      keepAlive(closing);
      await raceWithGrace(closing);
    }
  }
}

/** Espera o fechamento, ou a carência — o que vier primeiro, sem deixar temporizador vivo. */
async function raceWithGrace(closing: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, CLOSE_GRACE_MS);
  });
  try {
    await Promise.race([closing, grace]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function closeHolder(holder: Holder): Promise<void> {
  const sql = holder.sql;
  if (!sql) {
    // Marca fechado mesmo sem cliente: trabalho órfão do prazo estourado que
    // tente abrir DEPOIS da resposta não deixa conexão para trás.
    holder.closing ??= Promise.resolve();
    return holder.closing;
  }
  holder.closing ??= sql.end({ timeout: 5 }).then(
    () => undefined,
    () => undefined,
  );
  return holder.closing;
}

/**
 * Empresta a conexão da requisição a um porto, ou abre uma só para ele.
 *
 * O porto NÃO fecha o que pegou emprestado — quem abriu fecha. Quando não há
 * requisição em volta (script de prova, teste, tarefa agendada) o
 * comportamento é o de antes: abre, usa, fecha.
 */
export async function borrowSql<T>(
  env: ServerEnv,
  label: string,
  work: (sql: Sql) => Promise<T>,
): Promise<T> {
  const holder = store.getStore();
  if (!holder) return withOwnSql(env, label, work);

  const key = connectionKey(env);
  // Já fechada: estamos em trabalho órfão, depois de a resposta ter saído.
  // Abrir e fechar a própria conexão é o único caminho que não vaza.
  if (holder.closing) return withOwnSql(env, label, work);
  // Credencial diferente da que abriu esta requisição: sem empréstimo.
  if (holder.key !== null && holder.key !== key) return withOwnSql(env, label, work);

  if (!holder.sql) {
    holder.key = key;
    holder.sql = connect(env, REQUEST_DB_LABEL);
  }
  return work(holder.sql);
}

async function withOwnSql<T>(
  env: ServerEnv,
  label: string,
  work: (sql: Sql) => Promise<T>,
): Promise<T> {
  const sql = connect(env, label);
  try {
    return await work(sql);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
