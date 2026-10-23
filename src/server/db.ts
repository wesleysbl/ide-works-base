/**
 * Acesso ao banco pelo papel restrito — etapa F1.9.
 *
 * DUAS COISAS QUE ESTE ARQUIVO GARANTE
 *
 *   1. Só se conecta como `ideworks_app`, que fisicamente não alcança o schema
 *      do Sistema IDE. Não é disciplina: é privilégio de banco.
 *
 *   2. Toda consulta roda dentro de um contexto **declarado**. As políticas do
 *      schema decidem a partir da declaração, e sem declaração devolvem vazio.
 *      Por isso não existe aqui um "execute esta consulta solta": ou você diz em
 *      nome de quem age, ou não passa.
 */

import postgres from 'postgres';

import { assertStaysInOurSchema } from '@/config/env';
import { registrarAberturaDeConexao } from '@/server/db-medicao';
import { UUID_ESTRITO, aceitaTextoDireto, definirTextoDireto } from '@/server/db-literal';

export {
  inlineBool,
  inlineDate,
  inlineDateList,
  inlineInt,
  inlineLetras,
  inlineSha256,
  inlineText,
  inlineTimestamp,
  inlineUuid,
  inlineUuidList,
  inlineWord,
} from '@/server/db-literal';

export type ServerEnv = {
  IDEWORKS_PUBLIC_SUPABASE_URL: string;
  IDEWORKS_SERVER_DB_USER?: string;
  IDEWORKS_SERVER_DB_PASSWORD?: string;
  IDEWORKS_SERVER_DB_HOST?: string;
  /**
   * Ligação do Hyperdrive.
   *
   * A conexão TCP direta ao Postgres de dentro do Worker trava — medimos 503 em
   * 147 segundos, contra 35ms da rota que não toca no banco. O Hyperdrive é o
   * intermediário que a Cloudflare desenhou para isso, e ele entrega uma conexão
   * Postgres de verdade do outro lado. Por isso as políticas por variável de
   * sessão continuam valendo: elas dependem de sessão real, não de HTTP.
   */
  HYPERDRIVE?: { connectionString: string };
  /** "desligado" volta toda consulta ao parâmetro de sempre (ver `definirTextoDireto`). */
  IDEWORKS_SQL_TEXTO_DIRETO?: string;
};

export type Sql = ReturnType<typeof postgres>;

/**
 * A conexão DENTRO de uma transação.
 *
 * Não é o mesmo tipo que `Sql`, e a diferença importa: só ela tem `savepoint`.
 * O bloco de `withActor` recebia `Sql`, e por isso o motor de coleta não tinha
 * como isolar um ativo dos outros — no Postgres um erro aborta a transação
 * inteira, então uma conta com valor recusado apagava a coleta de todas as
 * outras. Ver o laço em `server/meta-coleta.ts`.
 */
export type Tx = postgres.TransactionSql<Record<string, never>>;

/**
 * Array para o banco, com o VAZIO virando `null`.
 *
 * O driver não consegue tipar uma lista vazia: `${[]}::uuid[]` chega ao
 * Postgres como string vazia e ele recusa com `malformed array literal: ""`.
 * Com uma lista cheia funciona — então o defeito só aparece no caso mais
 * comum de todos: cadastrar cliente **sem** etiqueta, criar demanda **sem**
 * responsável, registrar gravação **sem** tipo.
 *
 * Encontrado em 2026-08-20, ao tentar cadastrar um cliente de verdade pela
 * API. Estava em seis chamadas, e nenhum teste pegava: a suíte não fala com
 * banco (bloqueio de rede da F0.4), e os scripts de prova montavam a consulta
 * à mão, sem passar pelo mesmo caminho da aplicação.
 *
 * As funções do banco recebem `null` e fazem `coalesce(..., '{}')`, então
 * nulo e lista vazia significam a mesma coisa lá dentro — que é o que se
 * quer.
 */
export const arrayOuNulo = <T>(v: readonly T[] | null | undefined): T[] | null =>
  v === null || v === undefined || v.length === 0 ? null : [...v];

/**
 * Objeto para uma coluna `jsonb`.
 *
 * POR QUE NÃO SE PASSA `JSON.stringify(...)`
 *   O driver trata uma string JS como VALOR json. Então `'{"spend":100}'` chega
 *   ao banco como uma *string* JSON, não como objeto: `jsonb_typeof` diz
 *   "string" e `->>'spend'` devolve `null`. A linha entra, as colunas ficam
 *   nulas, e nada levanta erro.
 *
 *   Foi assim que o motor de coleta gravaria todo dia com todas as métricas
 *   nulas — descoberto na F9, antes da primeira coleta rodar.
 *
 * POR QUE O `as`
 *   O tipo `JSONValue` do driver é fechado e não aceita `Record<string,
 *   unknown>`, que é o que sobra de uma resposta HTTP já passada por
 *   `JSON.parse`. O valor veio de JSON, então é JSON: a conversão afirma o que
 *   a origem já garante, e concentrá-la aqui evita um `as` solto em cada
 *   chamada.
 */
export const comoJson = (sql: Sql | Tx, valor: unknown) =>
  sql.json(valor as Parameters<Sql['json']>[0]);

/**
 * Origem da execução de uma integração — distinta da identidade do
 * proprietário. Humano autenticado na interface não declara isto: a
 * ausência (string vazia na sessão) é o caminho antigo, intacto.
 */
export type ExecutionOrigin = 'mcp' | 'http' | 'automation';

/**
 * Recorte da integração na transação. `ownerId` é a pessoa responsável;
 * `origin` é por onde a chamada chegou. Os dois não se substituem.
 */
export type IntegrationContext = {
  integrationId: string;
  grantId: string;
  ownerId: string;
  origin: ExecutionOrigin;
};

/**
 * O ator em nome de quem a transação corre.
 *
 *   `preauth` é o caminho de login e ativação: acontece antes de existir
 *   identidade, e as políticas dão a ele o mínimo — conferir convite, contar
 *   tentativa, ver se há perfil. Nada além.
 */
export type Actor =
  | { kind: 'preauth' }
  /**
   * ⚠️ `isSuper` E OBRIGATORIO — F17.38, e ele ja foi opcional.
   *
   *   Enquanto era `isSuper?`, um cracha montado a mao sem ele COMPILAVA. Foi
   *   assim que `resetPorts` passou meses declarando so `isSuperadmin: true`:
   *   inofensivo ate a F17.34 fazer `profiles_select` olhar empresa, e entao o
   *   dono do sistema — que tem zero empresas — parou de enxergar as proprias
   *   pessoas, e `Redefinir` respondia "nao ha conta" para quem estava na tela.
   *
   *   Obrigatorio, o compilador recusa o cracha incompleto na hora de escreve-lo,
   *   em vez de o banco recusar a linha meses depois.
   *
   *   `integration` é opcional de propósito: o ator humano da interface não
   *   carrega concessão, e `asDbActor` continua devolvendo o mesmo formato
   *   de sempre. Sem o campo, as quatro variáveis novas da sessão saem vazias.
   */
  | {
      kind: 'user';
      userId: string;
      isSuperadmin: boolean;
      isSuper: boolean;
      integration?: IntegrationContext;
    }
  /**
   * O motor de coleta da F8 — roda por gatilho de tempo, sem pessoa nenhuma.
   *
   * Não declara nada, e é por isso que funciona: as funções que gravam métrica
   * RECUSAM quando há sessão de pessoa declarada. Métrica entra pelo motor ou
   * não entra — número forjado numa série histórica é indetectável depois,
   * porque não há com o que comparar.
   *
   * Em compensação, este ator não enxerga nada por consulta comum: toda leitura
   * dele passa pelas mesmas funções com dono.
   */
  | { kind: 'collector' };

/** Único construtor de ator `user` fora da sessão — o literal `kind: 'user'` mora aqui. */
export function userActor(input: {
  userId: string;
  isSuperadmin: boolean;
  isSuper: boolean;
  integration?: IntegrationContext;
}): Extract<Actor, { kind: 'user' }> {
  return {
    kind: 'user',
    userId: input.userId,
    isSuperadmin: input.isSuperadmin,
    isSuper: input.isSuper,
    ...(input.integration ? { integration: input.integration } : {}),
  };
}

/**
 * Abre um cliente Postgres — e deixa registrado que abriu.
 *
 * O `rotulo` diz QUAL ponto do código abriu esta conexão. Ele só serve para a
 * medição da F22 (`db-medicao.ts`): fora de uma requisição medida, contar custa
 * uma leitura de contexto e nada mais. O rótulo é sempre literal do código —
 * nunca identificador de pessoa, de concessão ou de token —, porque ele sai no
 * cabeçalho de resposta em produção.
 */
export function connect(env: ServerEnv, rotulo = 'db'): Sql {
  definirTextoDireto(env.IDEWORKS_SQL_TEXTO_DIRETO);
  const sql = abrirCliente(env);
  const fechou = registrarAberturaDeConexao(rotulo);

  /**
   * POR QUE TROCAR `end` EM VEZ DE EMBRULHAR O CLIENTE INTEIRO
   *   Um `Proxy` sobre o cliente passaria a ficar no caminho de TODA consulta —
   *   e `sql` é função, objeto e etiqueta de template ao mesmo tempo. Trocar
   *   um único método deixa o caminho quente intocado: o que se cronometra é o
   *   fim da vida do cliente, que é onde o tempo já estava sendo pago.
   */
  const encerrar = sql.end.bind(sql) as Sql['end'];
  sql.end = ((...args: Parameters<Sql['end']>) => {
    const terminou = encerrar(...args);
    // O carimbo vale tanto em sucesso quanto em falha: uma conexão que morreu
    // mal continua tendo custado tempo, e esconder isso falsearia a medição.
    return terminou.then(
      (valor) => {
        fechou();
        return valor;
      },
      (erro: unknown) => {
        fechou();
        throw erro;
      },
    );
  }) as Sql['end'];

  return sql;
}

function abrirCliente(env: ServerEnv): Sql {
  // Dentro do Worker, sempre pelo Hyperdrive — a credencial mora nele, não aqui.
  if (env.HYPERDRIVE?.connectionString) {
    return postgres(env.HYPERDRIVE.connectionString, {
      // O agrupador do outro lado trabalha em modo transação: instrução
      // preparada não sobrevive entre chamadas.
      prepare: false,
      // O Hyperdrive já agrupa. Abrir muitas daqui só empilha conexão ociosa.
      max: 5,
      // `fetch_types` FICA LIGADO, e isto custou caro.
      //
      // Ele estava desligado "porque o Worker é efêmero". Só que é o catálogo
      // de tipos que ensina o driver a serializar ARRAY: sem ele, um
      // `${lista}::date[]` vira o texto `2026-08-01` e o Postgres recusa com
      // "malformed array literal".
      //
      // Consequência medida em 2026-08-21: o COCKPIT — a tela principal —
      // devolvia 500 em toda chamada, e devolvia desde a F4.11. Pelo driver do
      // Node a mesma consulta sempre funcionou, então nenhum script de prova
      // pegou: eles não passam pelo Worker.
      //
      // O custo é uma ida ao banco na abertura da conexão. O Hyperdrive agrupa,
      // então isso acontece raramente — e é barato perto de uma tela que não
      // abre.
    });
  }

  // Fora do Worker — scripts de verificação rodando no Node, onde a conexão
  // direta funciona. Exige as credenciais no ambiente.
  if (!env.IDEWORKS_SERVER_DB_USER || !env.IDEWORKS_SERVER_DB_PASSWORD) {
    throw new Error(
      'Sem Hyperdrive e sem credenciais de banco no ambiente. ' +
        'Defina IDEWORKS_SERVER_DB_USER e IDEWORKS_SERVER_DB_PASSWORD, ' +
        'ou rode dentro do Worker, que usa o Hyperdrive.',
    );
  }

  const ref = env.IDEWORKS_PUBLIC_SUPABASE_URL.replace('https://', '').split('.')[0];
  const host = env.IDEWORKS_SERVER_DB_HOST || 'aws-0-sa-east-1.pooler.supabase.com';

  return postgres({
    host,
    port: 6543,
    database: 'postgres',
    username: `${env.IDEWORKS_SERVER_DB_USER}.${ref}`,
    password: env.IDEWORKS_SERVER_DB_PASSWORD,
    ssl: 'require',
    prepare: false,
    max: 3,
    idle_timeout: 20,
  });
}

/**
 * Confere o recorte da integração ANTES de declarar a sessão.
 *
 * Proprietário ≠ origem: a pessoa em `userId` é quem o RLS antigo enxerga;
 * `ownerId` tem de ser essa mesma pessoa (o responsável); `origin` diz se a
 * chamada veio por MCP, HTTP ou automação. Misturar os dois — ou declarar
 * origem `human` num ator de integração — é bug de quem monta o crachá, e
 * cai aqui em vez de chegar ao banco com um recorte mentiroso.
 */
export function assertIntegrationActor(actor: Extract<Actor, { kind: 'user' }>): void {
  const integration = actor.integration;
  if (!integration) return;
  if (integration.ownerId !== actor.userId) {
    throw new Error(
      'O proprietário da integração tem de ser a pessoa em nome de quem a transação corre.',
    );
  }
  const origin: string = integration.origin;
  if (origin !== 'mcp' && origin !== 'http' && origin !== 'automation') {
    throw new Error('Origem da execução da integração inválida.');
  }
  if (!integration.integrationId || !integration.grantId) {
    throw new Error('Integração sem identificador de conexão ou de concessão.');
  }
}

/** Origem de execução conhecida — a única que pode virar texto direto. */
const ORIGENS = new Set<string>(['mcp', 'http', 'automation']);

/** UUID ou vazio: o que as variáveis de integração carregam. */
const idOuVazio = (valor: string): boolean => valor === '' || UUID_ESTRITO.test(valor);

/**
 * A declaração do ator com os valores no texto, ou `null` quando algum não é de
 * formato conhecido (nesse caso a declaração viaja por parâmetro, como sempre).
 *
 * Exportada para a suíte provar que o texto direto declara EXATAMENTE os mesmos
 * valores que o caminho por parâmetro.
 */
export function declaracaoDoUsuarioNoTexto(
  actor: Extract<Actor, { kind: 'user' }>,
): string | null {
  const integration = actor.integration;
  const valores = {
    userId: actor.userId,
    integrationId: integration?.integrationId ?? '',
    grantId: integration?.grantId ?? '',
    ownerId: integration?.ownerId ?? '',
    origin: integration?.origin ?? '',
  };
  if (!UUID_ESTRITO.test(valores.userId)) return null;
  if (!idOuVazio(valores.integrationId) || !idOuVazio(valores.grantId) || !idOuVazio(valores.ownerId)) {
    return null;
  }
  if (valores.origin !== '' && !ORIGENS.has(valores.origin)) return null;
  const aspas = (v: string) => `'${v.toLowerCase()}'`;
  return (
    `select set_config('app.user_id', ${aspas(valores.userId)}, true), ` +
    `set_config('app.is_superadmin', '${actor.isSuperadmin ? 'true' : 'false'}', true), ` +
    `set_config('app.is_super', '${actor.isSuper ? 'true' : 'false'}', true), ` +
    `set_config('app.integration_id', ${aspas(valores.integrationId)}, true), ` +
    `set_config('app.grant_id', ${aspas(valores.grantId)}, true), ` +
    `set_config('app.integration_owner_id', ${aspas(valores.ownerId)}, true), ` +
    `set_config('app.execution_origin', ${aspas(valores.origin)}, true)`
  );
}

/**
 * Roda um bloco declarando quem age. Fora daqui não há como tocar no banco —
 * de propósito.
 *
 * A DECLARAÇÃO SAI JUNTO COM A PRIMEIRA CONSULTA DO BLOCO — 08/10/2026
 *   Antes: `begin`, `set_config` (parâmetros: duas idas), consultas, `commit` —
 *   quatro idas de moldura antes e depois do trabalho. Agora o `set_config`
 *   viaja SEM parâmetros (valores validados no texto) e é enviado sem esperar
 *   resposta; o bloco começa a emitir as suas consultas no mesmo instante. O
 *   Postgres executa na ordem em que recebe, na mesma conexão: a declaração
 *   SEMPRE roda antes de qualquer consulta do bloco, então o recorte de linha
 *   é exatamente o de antes. Moldura: `begin` + `commit` (duas idas), e o
 *   `set_config` mora na ida da primeira consulta.
 *
 *   Se a declaração falhar, o Postgres aborta a transação e as consultas
 *   seguintes recusam (`25P02`); o postgres.js devolve o erro de origem, e o
 *   `Promise.all` abaixo também nunca deixa o bloco "passar" sem a declaração
 *   ter dado certo.
 *
 *   Sem a trava de formato (id fora do padrão) ou com um dublê de teste, o
 *   caminho é o de antes: parâmetros, esperando a resposta.
 */
export async function withActor<T>(
  sql: Sql,
  actor: Actor,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    let declarada: PromiseLike<unknown> | null = null;
    /** Manda já, se o driver sabe; senão espera aqui mesmo (dublê de teste). */
    const declarar = async (consulta: PromiseLike<unknown>): Promise<void> => {
      declarada = dispararSemEsperar(consulta);
      if (declarada === null) await consulta;
    };
    if (actor.kind === 'collector') {
      // Nada a declarar, de propósito. Ver a nota no tipo `Actor`.
    } else if (actor.kind === 'preauth') {
      await declarar(tx`select set_config('app.preauth', 'true', true)`);
    } else {
      // DUAS declaracoes, e nao uma. `is_superadmin` significa "administra" —
      // super admin e administrador. `is_super` e so o topo, e e ele que o
      // banco confere para criar outro super admin e para apagar pessoa.
      //
      // As quatro variáveis da integração saem SEMPRE, inclusive vazias: o
      // mesmo motivo de `is_super` desde a F17.32. Omitir faria a transação
      // seguinte herdar recorte de agente se o agrupador reaproveitasse a
      // sessão. Ator humano sem `integration` continua idêntico ao de antes
      // — as quatro ficam string vazia, e as funções do banco leem nulo.
      assertIntegrationActor(actor);
      const noTexto = aceitaTextoDireto(tx) ? declaracaoDoUsuarioNoTexto(actor) : null;
      if (noTexto !== null) {
        await declarar(tx.unsafe(noTexto));
      } else {
        const integration = actor.integration;
        await tx`
          select set_config('app.user_id', ${actor.userId}, true),
                 set_config('app.is_superadmin', ${actor.isSuperadmin ? 'true' : 'false'}, true),
                 set_config('app.is_super', ${actor.isSuper ? 'true' : 'false'}, true),
                 set_config('app.integration_id', ${integration?.integrationId ?? ''}, true),
                 set_config('app.grant_id', ${integration?.grantId ?? ''}, true),
                 set_config('app.integration_owner_id', ${integration?.ownerId ?? ''}, true),
                 set_config('app.execution_origin', ${integration?.origin ?? ''}, true)`;
      }
    }
    const trabalho = work(tx as unknown as Tx);
    if (declarada === null) return trabalho;
    // A declaração é parte do resultado: se ela falhou, o bloco falha.
    const [, resultado] = await Promise.all([declarada, trabalho]);
    return resultado;
  }) as Promise<T>;
}

/**
 * Manda a consulta agora, sem esperar a resposta — se o driver sabe fazer isso.
 *
 * `execute()` existe no postgres.js real e faz a escrita no soquete já. Dublê de
 * teste (função que devolve `Promise`) não o tem: aí devolve `null` e quem chama
 * espera a consulta, que é o comportamento de antes.
 *
 * É função SÍNCRONA de propósito: a consulta do driver é uma promessa, e uma
 * função `async` que a devolvesse a aguardaria.
 */
function dispararSemEsperar(consulta: PromiseLike<unknown>): PromiseLike<unknown> | null {
  const disparavel = consulta as { execute?: () => PromiseLike<unknown> };
  if (typeof disparavel.execute !== 'function') return null;
  const emVoo = disparavel.execute();
  // O erro é entregue por `Promise.all` em `withActor`; isto só evita
  // "rejeição sem tratador" se o bloco falhar antes de chegar lá.
  Promise.resolve(emVoo).catch(() => undefined);
  return emVoo;
}

/**
 * Rede de cima para consulta montada como texto. A garantia é o privilégio do
 * papel; isto existe só para dar mensagem legível antes de o banco recusar com
 * um erro cru.
 */
export function guardStatement(sql: string): void {
  assertStaysInOurSchema(sql);
}
