/**
 * EMPRESAS OMITIDAS — F31, Fase 2.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE ONDE VEIO
 *
 *   Em 25/09/2026 o Wesley decidiu: "não tem mais nada Alma e ninguém de lá vai
 *   precisar ver — será apenas Ide", e em seguida "pode só omitir por hora tudo
 *   que não é da Ide". A palavra que manda é OMITIR: nada é apagado, movido ou
 *   desligado no banco. A coleta da Meta continua, as linhas continuam, as
 *   regras de acesso continuam — o que muda é o que as LEITURAS do trabalho e da
 *   entrega devolvem.
 *
 * OMITIR É REVERSÍVEL, E POR ISSO MORA NUMA VARIÁVEL
 *
 *   `IDEWORKS_EMPRESAS_OMITIDAS` no `wrangler.toml`, por NOME, separados por
 *   vírgula, sem diferenciar maiúsculas. Esvaziar a variável e publicar devolve
 *   tudo como era, sem migração nem conserto de dado. Apagar não se desfaz;
 *   parar a coleta abriria buraco no histórico da Meta. Omitir não custa nada
 *   para voltar atrás.
 *
 * UMA REGRA SÓ, NO SERVIDOR
 *
 *   Os nomes viram ids aqui (uma consulta, guardada por um minuto no isolado) e
 *   os ids viajam no ator (`AuthenticatedActor.categoriasOmitidas`), que TODA
 *   leitura já recebe. Quem lê lista de cliente, espaço, lista ou tarefa monta o
 *   recorte com os ajudantes abaixo; quem é endereçado por id direto
 *   (`/clients/:id`, `/board/lists/:id`, `/board/tasks/:id`…) é barrado uma vez
 *   só, na conferência do crachá (`resolveActor`), com a MESMA frase de "não
 *   encontrado" que a rota já dá — sem dizer o nome de nada.
 *
 * O QUE NÃO PASSA POR AQUI (e é de propósito)
 *
 *   · A coleta da Meta (`meta-coleta.ts`, cron): ator `collector`, sem crachá.
 *     Ela CONTINUA coletando as contas da empresa omitida — parar a coleta
 *     abriria buraco no histórico, e isso não se desfaz.
 *   · O chat (D24): não tem recorte por empresa.
 *
 *   (A administração — Pessoas, Convite e Catálogos — entrou na Fase 3a:
 *   `pessoas.ts`, `catalogos.ts`. As telas da Meta e os agentes de IA, na 3b:
 *   `meta-*.ts` com `contaDaMetaForaDasOmitidas`, e `integrations/grants.ts`
 *   com `PersonAccess.omittedCompanyIds`.)
 *
 * A CATEGORIA PADRÃO NUNCA É OMITIDA
 *
 *   "Sem categoria" é a linha técnica para onde vai o cliente de categoria
 *   apagada. Omiti-la esconderia clientes da Ide que só perderam a etiqueta —
 *   então, se alguém a puser na variável, ela é IGNORADA com aviso no log.
 *   "Ide" e "Ide Hub" não são protegidas pelo código: são nomes de empresa, e
 *   proteger nome em código seria regra de negócio escondida. A variável é
 *   versionada, e o erro de configuração se desfaz esvaziando-a.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type postgres from 'postgres';

import { type Actor, type Sql, type Tx, withActor } from '@/server/db';
import { inlineUuidList } from '@/server/db-literal';
import type { AuthenticatedActor } from '@/server/session';

/** Fragmento montado com o mesmo `tx` da consulta que o recebe. */
type Trecho = postgres.PendingQuery<postgres.Row[]>;

/* ───────────────────────────── a variável ───────────────────────────── */

/**
 * Os nomes da variável, limpos: sem espaço nas pontas, em minúsculas, sem
 * repetição e sem vazio. Ausente ou vazia → lista vazia → nada omitido.
 */
export function lerNomesOmitidos(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const nomes = texto
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== '');
  return [...new Set(nomes)];
}

/* ───────────────────────────── de nome para id ───────────────────────────── */

/**
 * Quanto tempo a resolução vale no isolado.
 *
 * Um minuto: renomear uma empresa em Catálogos leva no máximo isso para valer
 * aqui, e cada pedido deixa de pagar uma ida ao banco. A resposta não depende
 * de quem pergunta — `categories_select` libera a tabela inteira para qualquer
 * sessão —, então guardar por isolado não mistura o alcance de duas pessoas.
 */
export const VALIDADE_DA_RESOLUCAO_MS = 60_000;

const guardadas = new Map<string, { ids: string[]; vence: number }>();

/**
 * A empresa de cada ALVO de endereço direto já conferido — F31, Fase 3a.
 *
 * POR QUE EXISTE
 *   Na Fase 2, com a variável ligada, todo pedido a uma rota com id
 *   (`/board/tasks/:id`, `/clients/:id`…) abria UMA TRANSAÇÃO A MAIS só para
 *   perguntar de que empresa era a coisa — mesmo com a resolução dos nomes
 *   guardada. Transação no Hyperdrive prende uma conexão do pool do Supabase
 *   (15, com o Hyperdrive limitado a 10 desde o `EMAXCONNSESSION` de 22/09), e
 *   abrir tarefa, lista e cliente é o gesto mais comum do dia. Guardando a
 *   resposta, o segundo pedido ao mesmo alvo não vai ao banco.
 *
 * POR QUE CACHE, E NÃO A CONFERÊNCIA DENTRO DA TRANSAÇÃO DA ROTA
 *   Seriam 24 tipos de endereço espalhados por dezenas de rotas, cada uma com a
 *   sua transação — dezenas de lugares para esquecer a conferência, e a que
 *   faltasse não daria sinal. Aqui a conferência continua num lugar só
 *   (`resolveActor`), e a garantia da Fase 2 (conferência que falha não
 *   derruba o pedido) fica intacta.
 *
 * O QUE PODE SER GUARDADO, E O QUE NÃO PODE — a consulta roda sob a RLS de
 * quem pede:
 *   · Empresa ACHADA (não nula) é fato do objeto, igual para todos: a política
 *     esconde linha, mas não troca o valor de uma coluna. Esta é guardada.
 *   · "Não achei" ou empresa NULA pode ser só o alcance de quem perguntou (a
 *     tarefa cujo espaço a pessoa não enxerga sai com empresa nula pela junção
 *     à esquerda). Guardar isso como fato deixaria passar, para o super admin,
 *     algo omitido que outra pessoa não enxergava. NUNCA é guardada: pergunta
 *     de novo a cada pedido.
 *   Quem não enxerga um objeto de empresa omitida e bate no guardado recebe o
 *   404 com a frase de "não encontrado" — a mesma que a rota lhe daria. Quem
 *   não enxerga um objeto de empresa visível segue para a rota, que recusa como
 *   sempre. O guardado nunca amplia alcance.
 *
 * O QUE SE GUARDA É O FATO, NÃO A DECISÃO
 *   A empresa, e não "omitido sim/não": a decisão é refeita a cada pedido com
 *   os ids do momento, então mudar a variável vale na hora.
 *
 * DEFASAGEM ACEITA: um minuto. Pela tela nada muda de empresa para dentro ou
 *   para fora de uma omitida (a Fase 2 recusa criar e mover para ela, e o que
 *   é dela é "não encontrado" para ser mexido); só uma mudança feita fora do
 *   sistema leva até um minuto para valer neste isolado.
 */
export const VALIDADE_DA_EMPRESA_DO_ALVO_MS = 60_000;

/**
 * Teto de alvos guardados por isolado. Passou, sai o mais antigo (o `Map`
 * guarda a ordem de entrada) — o isolado não cresce sem fim.
 */
export const LIMITE_DE_ALVOS_GUARDADOS = 5_000;

/**
 * Guarda-se a LISTA de empresas do alvo, e não uma só — F31, Fase 3b: a conta
 * da Meta responde por duas (a do token e a do cliente ligado), e é omitida se
 * QUALQUER uma for. Para os outros tipos a lista tem um elemento.
 */
const empresasDosAlvos = new Map<string, { empresas: readonly string[]; vence: number }>();

/** Só para a suíte: cada teste começa sem nada guardado (nomes E alvos). */
export function esquecerResolucoes(): void {
  guardadas.clear();
  empresasDosAlvos.clear();
}

/**
 * Resolve os nomes para ids de `ideworks.client_categories` — UMA consulta.
 *
 * Nome que não existe é ignorado (com aviso no log, para o erro de digitação
 * não passar calado). A categoria padrão é ignorada mesmo que esteja escrita na
 * variável — ver o cabeçalho.
 *
 * Recebe um `tx` JÁ declarado com ator de pessoa: a política da tabela exige
 * sessão, e `preauth` não enxerga categoria nenhuma.
 */
export async function resolverOmitidas(
  tx: Tx,
  nomes: readonly string[],
  agora: number = Date.now(),
): Promise<string[]> {
  if (nomes.length === 0) return [];
  const chave = nomes.join(',');
  const guardada = guardadas.get(chave);
  if (guardada && guardada.vence > agora) return guardada.ids;

  const linhas = await tx`
    select id, name, is_default
      from ideworks.client_categories
     where lower(name) = any(${[...nomes]}::text[])`;

  const ids: string[] = [];
  const achados = new Set<string>();
  for (const l of linhas) {
    achados.add(String(l.name).toLowerCase());
    if (l.is_default === true) {
      console.warn(
        `[ide-works] F31: "${String(l.name)}" é a categoria padrão e não pode ser omitida — ignorada em IDEWORKS_EMPRESAS_OMITIDAS.`,
      );
      continue;
    }
    ids.push(l.id as string);
  }
  const faltando = nomes.filter((n) => !achados.has(n));
  if (faltando.length > 0) {
    console.warn(
      `[ide-works] F31: IDEWORKS_EMPRESAS_OMITIDAS cita empresa que não existe: ${faltando.join(', ')} — ignorada.`,
    );
  }

  guardadas.set(chave, { ids, vence: agora + VALIDADE_DA_RESOLUCAO_MS });
  return ids;
}

/* ───────────────────────────── o endereço direto ───────────────────────────── */

/**
 * O que um endereço de API aponta, quando aponta para algo que tem empresa.
 *
 * A empresa de cada coisa sai da corrente que o banco já guarda:
 *   cliente .............. `clients.category_id`
 *   espaço ............... `spaces.category_id`
 *   pasta, lista ......... o espaço dela
 *   tarefa ............... o espaço da lista; sem lista, o cliente dela
 *   dentro da tarefa ..... a tarefa (checklist, item, comentário, link, anexo)
 *   automação ............ a lista de origem
 *   dentro do cliente .... o cliente (item, compromisso, nota, gravação,
 *                          evento e documento do histórico)
 *
 *   conta da Meta ....... a do token E a do cliente ligado — ver
 *                          `contaDaMetaForaDasOmitidas` (F31, Fase 3b)
 *
 * Administração e chat ficam de fora: ver o cabeçalho.
 */
export type TipoDeAlvo =
  | 'cliente'
  | 'item'
  | 'compromisso'
  | 'nota'
  | 'gravacao'
  | 'evento'
  | 'documento'
  | 'demanda'
  | 'tarefa'
  | 'lista'
  | 'pasta'
  | 'espaco'
  | 'checklist'
  | 'item-de-checklist'
  | 'comentario'
  | 'link'
  | 'anexo'
  | 'automacao'
  | 'conta-meta';

export type Alvo = { tipo: TipoDeAlvo; id: string };

const UUID = '([0-9a-f-]{36})';

/** A ordem importa só onde um prefixo cobre outro — os mais longos primeiro. */
const ENDERECOS: ReadonlyArray<readonly [RegExp, TipoDeAlvo]> = [
  [new RegExp(`^/history/documents/${UUID}/url$`, 'i'), 'documento'],
  [new RegExp(`^/clients/${UUID}(?:/.*)?$`, 'i'), 'cliente'],
  [new RegExp(`^/items/${UUID}(?:/.*)?$`, 'i'), 'item'],
  [new RegExp(`^/appointments/${UUID}$`, 'i'), 'compromisso'],
  [new RegExp(`^/mural/${UUID}$`, 'i'), 'nota'],
  [new RegExp(`^/captures/${UUID}$`, 'i'), 'gravacao'],
  [new RegExp(`^/history/${UUID}$`, 'i'), 'evento'],
  [new RegExp(`^/tasks/${UUID}(?:/.*)?$`, 'i'), 'demanda'],
  [new RegExp(`^/board/tasks/${UUID}(?:/.*)?$`, 'i'), 'tarefa'],
  [new RegExp(`^/board/lists/${UUID}(?:/.*)?$`, 'i'), 'lista'],
  [new RegExp(`^/board/folders/${UUID}(?:/.*)?$`, 'i'), 'pasta'],
  [new RegExp(`^/board/spaces/${UUID}(?:/.*)?$`, 'i'), 'espaco'],
  [new RegExp(`^/board/access/space/${UUID}$`, 'i'), 'espaco'],
  [new RegExp(`^/board/access/folder/${UUID}$`, 'i'), 'pasta'],
  [new RegExp(`^/board/access/list/${UUID}$`, 'i'), 'lista'],
  [new RegExp(`^/board/checklists/${UUID}(?:/.*)?$`, 'i'), 'checklist'],
  [new RegExp(`^/board/checklist-items/${UUID}$`, 'i'), 'item-de-checklist'],
  [new RegExp(`^/board/comments/${UUID}$`, 'i'), 'comentario'],
  [new RegExp(`^/board/links/${UUID}$`, 'i'), 'link'],
  [new RegExp(`^/board/attachments/${UUID}(?:/url)?$`, 'i'), 'anexo'],
  [new RegExp(`^/board/automations/${UUID}$`, 'i'), 'automacao'],
  // F31, Fase 3b — relatório pago e orgânico, publicações, campanhas,
  // anúncios, dono (`/client`), ligar/desligar e apagar. `/clients/:id/meta-assets`
  // já cai em "cliente", lá em cima.
  [new RegExp(`^/meta-assets/${UUID}(?:/.*)?$`, 'i'), 'conta-meta'],
];

/** O alvo do endereço, ou `null` quando o endereço não aponta para nada com empresa. */
export function alvoDoCaminho(caminho: string | undefined): Alvo | null {
  if (!caminho) return null;
  for (const [padrao, tipo] of ENDERECOS) {
    const achou = caminho.match(padrao);
    if (achou) return { tipo, id: achou[1].toLowerCase() };
  }
  return null;
}

/**
 * A frase de "não encontrado" de cada coisa — a MESMA que a rota daria para um
 * id inexistente ou fora do alcance. Distinguir "omitido" de "não existe"
 * contaria que a coisa existe, e com ela o nome da empresa.
 */
export const FRASE_DE_NAO_ENCONTRADO: Record<TipoDeAlvo, string> = {
  cliente: 'Cliente não encontrado.',
  item: 'Item não encontrado.',
  compromisso: 'Compromisso não encontrado.',
  nota: 'Nota não encontrada, ou fora do seu alcance.',
  gravacao: 'Gravação não encontrada, ou fora do seu alcance.',
  evento: 'Evento não encontrado, ou fora do seu alcance.',
  documento: 'Documento não encontrado, ou fora do seu alcance.',
  demanda: 'Demanda não encontrada, ou fora do seu alcance.',
  tarefa: 'Tarefa não encontrada, ou fora do seu alcance.',
  lista: 'Lista não encontrada, ou fora do seu alcance.',
  pasta: 'Pasta não encontrada, ou fora do seu alcance.',
  espaco: 'Espaço não encontrado, ou fora do seu alcance.',
  checklist: 'Checklist não encontrado, ou fora do seu alcance.',
  'item-de-checklist': 'Item não encontrado, ou fora do seu alcance.',
  comentario: 'Comentário não encontrado, ou fora do seu alcance.',
  link: 'Link não encontrado, ou fora do seu alcance.',
  anexo: 'Anexo não encontrado, ou fora do seu alcance.',
  automacao: 'Automação não encontrada.',
  // A frase do relatório da conta (`meta-relatorio.ts`) — a primeira que a
  // tela da conta recebe.
  'conta-meta': 'Conta não encontrada ou fora do seu alcance.',
};

/** A tarefa de uma coisa que mora dentro dela, como subconsulta. */
function tarefaDe(tx: Tx, alvo: Alvo): Trecho {
  switch (alvo.tipo) {
    case 'checklist':
      return tx`(select c.task_id from ideworks.task_checklists c where c.id = ${alvo.id})`;
    case 'item-de-checklist':
      return tx`(select c.task_id
                   from ideworks.checklist_items i
                   join ideworks.task_checklists c on c.id = i.checklist_id
                  where i.id = ${alvo.id})`;
    case 'comentario':
      return tx`(select c.task_id from ideworks.task_comments c where c.id = ${alvo.id})`;
    case 'link':
      return tx`(select k.task_id from ideworks.task_links k where k.id = ${alvo.id})`;
    case 'anexo':
      return tx`(select a.task_id from ideworks.task_attachments a where a.id = ${alvo.id})`;
    default:
      return tx`${alvo.id}::uuid`;
  }
}

/** O cliente de uma coisa que mora dentro dele, como subconsulta. */
function clienteDe(tx: Tx, alvo: Alvo): Trecho {
  switch (alvo.tipo) {
    case 'item':
      return tx`(select i.client_id from ideworks.content_items i where i.id = ${alvo.id})`;
    case 'compromisso':
      return tx`(select a.client_id from ideworks.appointments a where a.id = ${alvo.id})`;
    case 'nota':
      return tx`(select n.client_id from ideworks.mural_notes n where n.id = ${alvo.id})`;
    case 'gravacao':
      return tx`(select g.client_id from ideworks.video_captures g where g.id = ${alvo.id})`;
    case 'evento':
      return tx`(select h.client_id from ideworks.client_history h where h.id = ${alvo.id})`;
    case 'documento':
      return tx`(select h.client_id
                   from ideworks.history_documents d
                   join ideworks.client_history h on h.id = d.history_id
                  where d.id = ${alvo.id})`;
    default:
      return tx`${alvo.id}::uuid`;
  }
}

/**
 * As empresas do alvo — sob o MESMO alcance de quem pediu.
 *
 * Quem não enxerga a coisa recebe lista vazia e segue para a rota, que dá a
 * recusa dela como sempre deu. O recorte da omissão nunca amplia o que se vê.
 *
 * `guardar` diz se a resposta é FATO do objeto (pode ir para o guardado) ou
 * pode ser só o alcance de quem perguntou — ver `empresasDosAlvos`.
 */
async function empresasDoAlvo(
  tx: Tx,
  alvo: Alvo,
): Promise<{ empresas: string[]; guardar: boolean }> {
  if (alvo.tipo === 'conta-meta') {
    // A conta visível traz a empresa DELA (fato da coluna). A do cliente vem
    // por junção à esquerda: cliente ligado que sai nulo pode ser só o
    // cliente que quem pergunta não enxerga — então não se guarda.
    const [conta] = await tx`
      select a.category_id, a.client_id, c.category_id as client_category_id
        from ideworks.meta_assets a
        left join ideworks.clients c on c.id = a.client_id
       where a.id = ${alvo.id}`;
    if (!conta) return { empresas: [], guardar: false };
    const empresas = [conta.category_id, conta.client_category_id].filter(
      (e): e is string => typeof e === 'string',
    );
    const clienteVisto = conta.client_id === null || conta.client_category_id !== null;
    return { empresas, guardar: empresas.length > 0 && clienteVisto };
  }
  const empresa = await empresaDoAlvo(tx, alvo);
  return empresa === null ? { empresas: [], guardar: false } : { empresas: [empresa], guardar: true };
}

/** A empresa de um alvo que tem UMA (todos, menos a conta da Meta). */
async function empresaDoAlvo(tx: Tx, alvo: Alvo): Promise<string | null> {
  let linhas: postgres.RowList<postgres.Row[]>;
  switch (alvo.tipo) {
    case 'cliente':
    case 'item':
    case 'compromisso':
    case 'nota':
    case 'gravacao':
    case 'evento':
    case 'documento':
      linhas = await tx`
        select c.category_id from ideworks.clients c where c.id = ${clienteDe(tx, alvo)}`;
      break;
    case 'espaco':
      linhas = await tx`select s.category_id from ideworks.spaces s where s.id = ${alvo.id}`;
      break;
    case 'pasta':
      linhas = await tx`
        select s.category_id
          from ideworks.folders f
          join ideworks.spaces s on s.id = f.space_id
         where f.id = ${alvo.id}`;
      break;
    case 'lista':
    case 'automacao':
      linhas = await tx`
        select s.category_id
          from ideworks.lists l
          join ideworks.spaces s on s.id = l.space_id
         where l.id = ${
           alvo.tipo === 'lista'
             ? tx`${alvo.id}::uuid`
             : tx`(select a.source_list_id from ideworks.task_automations a where a.id = ${alvo.id})`
         }`;
      break;
    default:
      // Tarefa, demanda e o que mora dentro da tarefa.
      linhas = await tx`
        select coalesce(s.category_id,
                        case when t.list_id is null then c.category_id end) as category_id
          from ideworks.tasks t
          left join ideworks.lists l on l.id = t.list_id
          left join ideworks.spaces s on s.id = l.space_id
          left join ideworks.clients c on c.id = t.client_id
         where t.id = ${tarefaDe(tx, alvo)}`;
  }
  return (linhas[0]?.category_id as string | null | undefined) ?? null;
}

/**
 * Resolve as omitidas e confere o endereço, numa transação só — chamada por
 * `resolveActor`, depois de a pessoa estar conferida.
 *
 * Devolve os ids (para o ator levar a todas as leituras) e, quando o endereço
 * aponta para algo de empresa omitida, a frase de recusa.
 *
 * Sem nome na variável não abre transação nenhuma: é o caminho de hoje.
 */
export async function conferirOmitidas(
  sql: Sql,
  ator: Actor,
  nomes: readonly string[],
  caminho: string | undefined,
): Promise<{ ids: string[]; recusa: string | null }> {
  if (nomes.length === 0) return { ids: [], recusa: null };
  const alvo = alvoDoCaminho(caminho);
  const agora = Date.now();
  const chave = nomes.join(',');
  const guardada = guardadas.get(chave);

  // F31, Fase 3a — com o que precisa guardado, zero transação. É o caminho de
  // quase todo pedido: a resolução vale um minuto, e o alvo aberto agora
  // costuma ser o mesmo do pedido anterior (a ficha e as leituras dela).
  if (guardada && guardada.vence > agora) {
    // Sem nada a conferir no endereço, ou sem empresa omitida que exista.
    if (!alvo || guardada.ids.length === 0) return { ids: guardada.ids, recusa: null };
    const sabida = empresasDosAlvos.get(chaveDoAlvo(alvo));
    if (sabida && sabida.vence > agora) return decidir(guardada.ids, alvo, sabida.empresas);
  }

  return withActor(sql, ator, async (tx) => {
    const ids = await resolverOmitidas(tx, nomes, agora);
    if (!alvo || ids.length === 0) return { ids, recusa: null };
    const { empresas, guardar } = await empresasDoAlvo(tx, alvo);
    // Só a empresa ACHADA vira guardado — ver `empresasDosAlvos`.
    if (guardar) guardarEmpresasDoAlvo(alvo, empresas, agora);
    return decidir(ids, alvo, empresas);
  });
}

function chaveDoAlvo(alvo: Alvo): string {
  return `${alvo.tipo}:${alvo.id}`;
}

function guardarEmpresasDoAlvo(alvo: Alvo, empresas: readonly string[], agora: number): void {
  const chave = chaveDoAlvo(alvo);
  // Reinsere para ir ao fim da fila: o que sai pelo teto é o mais antigo.
  empresasDosAlvos.delete(chave);
  if (empresasDosAlvos.size >= LIMITE_DE_ALVOS_GUARDADOS) {
    const maisAntigo = empresasDosAlvos.keys().next().value;
    if (maisAntigo !== undefined) empresasDosAlvos.delete(maisAntigo);
  }
  empresasDosAlvos.set(chave, { empresas, vence: agora + VALIDADE_DA_EMPRESA_DO_ALVO_MS });
}

/** A decisão, refeita a cada pedido com os ids do momento. */
function decidir(
  ids: readonly string[],
  alvo: Alvo,
  empresas: readonly string[],
): { ids: string[]; recusa: string | null } {
  const omitido = empresas.some((empresa) => ids.includes(empresa));
  return { ids: [...ids], recusa: omitido ? FRASE_DE_NAO_ENCONTRADO[alvo.tipo] : null };
}

/* ───────────────────────────── o recorte das leituras ───────────────────────────── */

/** Os ids omitidos que o ator carrega. Ausente = nada omitido = comportamento de antes. */
export function idsOmitidos(actor: Pick<AuthenticatedActor, 'categoriasOmitidas'>): string[] {
  return [...(actor.categoriasOmitidas ?? [])];
}

/** Há empresa omitida para este ator? Sem ela, nenhuma conferência extra roda. */
export function recorteAtivo(actor: Pick<AuthenticatedActor, 'categoriasOmitidas'>): boolean {
  return (actor.categoriasOmitidas?.length ?? 0) > 0;
}

/** A empresa está omitida para este ator? */
export function estaOmitida(
  actor: Pick<AuthenticatedActor, 'categoriasOmitidas'>,
  categoriaId: string | null | undefined,
): boolean {
  return !!categoriaId && (actor.categoriasOmitidas ?? []).includes(categoriaId);
}

/**
 * O pedaço de SQL do recorte — ou NADA, quando não há omitida.
 *
 * Sem omitida, devolve o fragmento vazio (`tx\`\``, o idioma do driver para
 * "nada aqui"): a consulta sai IDÊNTICA à de antes da F31, texto e parâmetros.
 * Com omitida, devolve o que `montar` escrever com os ids — quem chama sabe o
 * apelido da coluna e se o pedaço começa com `where` ou `and`.
 *
 * ⚠️ FRAGMENTO NÃO SE ESPERA — mesma nota de `board-trabalho.ts`. Esta função é
 * síncrona de propósito.
 *
 * QUEM ESCREVE O PEDAÇO USA `inlineUuidList(tx, ids)` NO LUGAR DE `${ids}`
 * (perf do servidor, 08/10/2026): com os ids no TEXTO a consulta pode ficar sem
 * parâmetro nenhum, e uma consulta sem parâmetro sai numa ida só e viaja junto
 * das vizinhas. Sem a troca ela continua correta — só gasta duas idas.
 */
export function recorteDasOmitidas(
  tx: Tx,
  actor: Pick<AuthenticatedActor, 'categoriasOmitidas'>,
  montar: (ids: string[]) => Trecho,
): Trecho {
  const ids = idsOmitidos(actor);
  return ids.length === 0 ? tx`` : montar(ids);
}

/**
 * O recorte de TAREFA, com o apelido `t` — ou nada, sem omitida.
 *
 * A empresa da tarefa é a do espaço da lista dela; a tarefa SEM lista (a
 * demanda antiga, pendurada só no cliente) herda a do cliente. É a mesma regra
 * de `empresaDoAlvo`, escrita como condição.
 *
 * `not exists`, e não junção: as consultas que recebem este pedaço já têm as
 * junções delas, e uma a mais multiplicaria ou esconderia linha. Sob a política
 * de quem lê — lista ou cliente fora do alcance não omitem nada.
 */
export function tarefaForaDasOmitidas(
  tx: Tx,
  actor: Pick<AuthenticatedActor, 'categoriasOmitidas'>,
): Trecho {
  return recorteDasOmitidas(
    tx,
    actor,
    (ids) => tx`
      and not exists (select 1
                        from ideworks.lists omit_l
                        join ideworks.spaces omit_s on omit_s.id = omit_l.space_id
                       where omit_l.id = t.list_id
                         and omit_s.category_id = any(${inlineUuidList(tx, ids)}::uuid[]))
      and not exists (select 1
                        from ideworks.clients omit_c
                       where t.list_id is null
                         and omit_c.id = t.client_id
                         and omit_c.category_id = any(${inlineUuidList(tx, ids)}::uuid[]))`,
  );
}

/**
 * O recorte de CONTA DA META — F31, Fase 3b —, ou nada, sem omitida.
 *
 * A REGRA: a conta sai se QUALQUER UMA das duas empresas dela for omitida —
 *   · a da CONTA (`meta_assets.category_id`), que diz qual TOKEN a alcança, ou
 *   · a do CLIENTE ligado (`clients.category_id` via `meta_assets.client_id`).
 *
 * QUANDO AS DUAS DIVERGEM (o comentário da F7g diz que podem, de propósito):
 *   · Conta do token da Alma9 ligada a cliente da Ide → SAI. A conta mora na
 *     BM da Alma9 e é operada por ela; "nem vice-versa" (Wesley, 25/09) é
 *     justamente não ver o que é de lá. A série continua sendo coletada, e
 *     esvaziar a variável traz a conta de volta com o histórico inteiro.
 *   · Conta do token da Ide ligada a cliente da Alma9 → SAI. Mostrá-la poria o
 *     nome de um cliente da Alma9 na tela, que é o que a F31 tira.
 *   Com isso nenhuma conta visível carrega o nome da Alma9 — nem no campo
 *   "Empresa", nem no "Cliente" —, e os filtros de empresa das telas da Meta
 *   ficam só com o que é da Ide (e somem quando sobra uma).
 *
 *   O custo, anotado: um cliente da Ide cujos anúncios rodam na BM da Alma9
 *   perde a conta de vista enquanto a omissão estiver ligada.
 *
 * `colunas` são as da consulta que recebe o pedaço (o apelido muda de uma para
 * outra), e `inicio` diz se ele abre o `where` ou continua um. Cliente fora do
 * alcance de quem lê não omite nada: o recorte roda sob a política de quem lê,
 * como `tarefaForaDasOmitidas`.
 *
 * ⚠️ FRAGMENTO NÃO SE ESPERA — função síncrona de propósito.
 */
export function contaDaMetaForaDasOmitidas(
  tx: Tx,
  actor: Pick<AuthenticatedActor, 'categoriasOmitidas'>,
  colunas: { categoria: Trecho; cliente: Trecho },
  inicio: 'where' | 'and' = 'and',
): Trecho {
  return recorteDasOmitidas(tx, actor, (ids) => {
    const abre = inicio === 'where' ? tx`where` : tx`and`;
    return tx`
      ${abre} (${colunas.categoria} is null or not (${colunas.categoria} = any(${inlineUuidList(tx, ids)}::uuid[])))
      and not exists (select 1
                        from ideworks.clients omit_mc
                       where omit_mc.id = ${colunas.cliente}
                         and omit_mc.category_id = any(${inlineUuidList(tx, ids)}::uuid[]))`;
  });
}
