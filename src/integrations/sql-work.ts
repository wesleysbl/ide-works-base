/**
 * Catálogo SQL da integração — F16.3c.
 *
 * O Worker até aqui despachava `EMPTY_WORK_CATALOG`: HTTP de produção não
 * lia quadro, tarefa, pessoa. Este adapter aplica o recorte no WHERE e
 * declara a concessão em `withActor` (campo `integration` no Actor).
 *
 * `team_directory()` inspira o diretório (id + nome). A allowlist da
 * concessão entra na consulta — a função sozinha não recorta o agente.
 */

import {
  APPROVAL_ROUND_STATES,
  CLIENT_URGENCIES,
  GET_TASK_CHECKLISTS_MAX,
  GET_TASK_CHECKLIST_ITEMS_MAX,
  GET_TASK_LINKS_MAX,
  GET_TASK_SUBTASKS_MAX,
  STATUS_TYPES,
  TASK_DEMAND_TYPES,
  TASK_PRIORITIES,
  type ApprovalRoundState,
  type MuralNoteColor,
  type SearchKind,
  type StatusType,
  type TaskDemandType,
  type ListTagsTarget,
  type TaskPriority,
  type WorkflowOrigin,
  type WorkflowTarget,
} from '@/integrations/contract';
import type { EventoDaTarefa } from '@/board/historico';
import { CONTENT_TYPES } from '@/delivery/level';
import { palavrasDaBusca, semAcento } from '@/clients/historico-busca';
import { omittedIn } from '@/integrations/grants';
import { cancelledDetail } from '@/integrations/reads';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import { clienteDaTarefaIdSql, clienteDaTarefaJuncao } from '@/server/cliente-da-tarefa';
import type {
  SearchWindow,
  TitleWindow,
  WorkBoardRow,
  WorkBoardView,
  WorkCatalog,
  WorkListedTask,
  WorkTaskFilters,
  WorkClientProfile,
  WorkClientRecordsView,
  WorkClientSummary,
  WorkClientView,
  WorkCommentView,
  WorkHistoryEntryView,
  WorkMuralNoteView,
  WorkPersonTaskView,
  WorkPersonView,
  WorkPersonWorkView,
  WorkScope,
  WorkSearchHit,
  WorkTagsView,
  WorkTaskView,
  WorkWorkflowView,
} from '@/integrations/reads';
import { arrayOuNulo, withActor, type Actor, type ServerEnv, type Tx } from '@/server/db';
import { borrowSql } from '@/server/db-request';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tirar acento no SQL sem `unaccent` (a extensão não está instalada neste
 * banco e esta fase não cria migration): `translate` com os pares abaixo,
 * depois de `lower()`. Os pares saem da mesma decomposição NFD que a busca do
 * site usa (`semAcento`), então as duas pontas concordam nas letras latinas
 * comuns; maiúscula acentuada entra para não depender da localidade do banco.
 */
const LATIN_ACENTUADAS = 'áàâãäåāéèêëēíìîïīóòôõöōúùûüūçñýÿ';
const ACENTOS_DE = LATIN_ACENTUADAS + LATIN_ACENTUADAS.toUpperCase();
const ACENTOS_PARA = [...ACENTOS_DE]
  .map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
  .join('');

function asUuid(id: string): string | null {
  return UUID.test(id) ? id : null;
}

function named(id: string | null | undefined, name: string | null | undefined, allowed: boolean): { id: string; name: string | null } | null {
  if (!id) return null;
  return { id, name: allowed && name && name.length > 0 ? name : null };
}

function peopleOf(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ id: string; name: string }> = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    const name = (row as { name?: unknown }).name;
    if (typeof id === 'string' && typeof name === 'string') out.push({ id, name });
  }
  return out;
}

function instant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function dueOn(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 10);
}

function priorityOf(value: unknown): TaskPriority | null {
  return (TASK_PRIORITIES as readonly string[]).includes(value as string) ? (value as TaskPriority) : null;
}

/** F40 — o tipo da demanda (`demand_type::text`); valor desconhecido vira nulo. */
function demandTypeOf(value: unknown): TaskDemandType | null {
  return (TASK_DEMAND_TYPES as readonly string[]).includes(value as string) ? (value as TaskDemandType) : null;
}

/** F42, Fase 7 — o estado da rodada (`state::text`); valor desconhecido vira `cancelled` (fechada, sem decisão). */
function approvalStateOf(value: unknown): ApprovalRoundState {
  return (APPROVAL_ROUND_STATES as readonly string[]).includes(value as string)
    ? (value as ApprovalRoundState)
    : 'cancelled';
}

function statusTypeOf(value: unknown): StatusType | null {
  return (STATUS_TYPES as readonly string[]).includes(value as string) ? (value as StatusType) : null;
}

function companyList(scope: WorkScope): readonly string[] | null {
  if (scope.companies.kind === 'all') return null;
  if (scope.companies.kind === 'none') return [];
  return [...scope.companies.ids];
}

function clientList(scope: WorkScope): 'all' | 'none' | readonly string[] {
  return scope.clients === 'all' || scope.clients === 'none' ? scope.clients : [...scope.clients];
}

function emptyScope(scope: WorkScope): boolean {
  return scope.companies.kind === 'none';
}

function companySql(tx: Tx, scope: WorkScope, column: 'tr.category_id' | 'uc.category_id' | 'c.category_id' | 's.category_id') {
  const ids = companyList(scope);
  const allows =
    column === 'tr.category_id'
      ? tx`ideworks.integration_allows_company(tr.category_id)`
      : column === 'uc.category_id'
        ? tx`ideworks.integration_allows_company(uc.category_id)`
        : column === 'c.category_id'
          ? tx`ideworks.integration_allows_company(c.category_id)`
          : tx`ideworks.integration_allows_company(s.category_id)`;
  // F31, Fase 3b — com recorte `all`, a empresa omitida sai por aqui (com
  // `ids` ela já saiu da lista em `effectiveCompanies`). Sem omitida o trecho
  // não existe, e a consulta fica a de antes, texto e parâmetros.
  const omitidas = scope.companies.kind === 'all' ? omittedIn(scope.companies) : [];
  if (ids === null) {
    if (omitidas.length === 0) return allows;
    const fora = arrayOuNulo(omitidas);
    if (column === 'tr.category_id') return tx`${allows} and not (tr.category_id = any(${fora}::uuid[]))`;
    if (column === 'uc.category_id') return tx`${allows} and not (uc.category_id = any(${fora}::uuid[]))`;
    if (column === 'c.category_id') return tx`${allows} and not (c.category_id = any(${fora}::uuid[]))`;
    return tx`${allows} and not (s.category_id = any(${fora}::uuid[]))`;
  }
  const list = arrayOuNulo(ids);
  if (column === 'tr.category_id') return tx`${allows} and tr.category_id = any(${list}::uuid[])`;
  if (column === 'uc.category_id') return tx`${allows} and uc.category_id = any(${list}::uuid[])`;
  if (column === 'c.category_id') return tx`${allows} and c.category_id = any(${list}::uuid[])`;
  return tx`${allows} and s.category_id = any(${list}::uuid[])`;
}

/**
 * O que toda consulta de TAREFA do MCP põe no FROM, logo depois de
 * `ideworks.tasks t` — F38, Fase 6.1.
 *
 * 1. `clienteDaTarefaJuncao`: o cliente da tarefa pela regra única (F38,
 *    Fase 6), em `cliente_da_tarefa.id`.
 * 2. `cliente_permitido.sim`: `integration_allows_client` do cliente da
 *    tarefa. POR QUÊ uma junção lateral, e com `offset 0`: chamada direto no
 *    `where`, a função rodava em CADA tarefa, ~1 ms cada — no ATENDIMENTO
 *    (1.148 tarefas) era 0,95 s dos ~1 s da consulta. O `offset 0` impede o
 *    Postgres de achatar a subconsulta de volta no `where`, e assim ele pode
 *    pôr um `Memoize` na frente: a função roda uma vez por CLIENTE distinto
 *    (41 no ATENDIMENTO), não por tarefa. A função é `stable`, então guardar
 *    a resposta dentro da consulta não muda nada do que ela responde.
 *    Sem cliente nenhum no recorte (`none`) a junção nem entra.
 */
function taskClientJoins(tx: Tx, scope: WorkScope) {
  if (clientList(scope) === 'none') return clienteDaTarefaJuncao(tx);
  return tx`${clienteDaTarefaJuncao(tx)}
            left join lateral (
              select ideworks.integration_allows_client(${clienteDaTarefaIdSql(tx)}) as sim offset 0
            ) cliente_permitido on true`;
}

/**
 * O recorte de cliente da conexão sobre a tarefa `t` — pela regra única do
 * cliente da tarefa (F38, Fase 6): o da tarefa, e na falta dele o da lista.
 * Antes lia só `t.client_id`, e a tarefa sem cliente numa lista de cliente
 * passava pelo recorte como "sem cliente". Exige `taskClientJoins` no FROM.
 */
function clientSql(tx: Tx, scope: WorkScope) {
  const clients = clientList(scope);
  const cliente = clienteDaTarefaIdSql(tx);
  if (clients === 'all') {
    return tx`(${cliente} is null or cliente_permitido.sim)`;
  }
  if (clients === 'none') {
    return tx`${cliente} is null`;
  }
  return tx`(${cliente} is null or (cliente_permitido.sim and ${cliente} = any(${arrayOuNulo(clients)}::uuid[])))`;
}

/**
 * F38, Fase 6.2 — o cliente da tarefa (regra única, `cliente_da_tarefa.id`)
 * não está cancelado. Tarefa sem cliente passa; cliente que a política de
 * linha não devolve também passa, como no `coalesce(cl.is_active, true)` da
 * busca. Exige `taskClientJoins` no FROM.
 *
 * POR QUE a lista dos cancelados num `array(...)` sem correlação: `clients`
 * tem política de linha (`can_see_client`, ~0,2 ms por cliente), e o
 * Postgres não usa o índice por baixo dela. `not exists`, subconsulta
 * escalar e `left join` releram `clients` inteira para CADA tarefa (97
 * tarefas: 1,6 s, 2,1 s e 0,85 s, contra 0,21 s sem o filtro). O `array`
 * vira um InitPlan: `clients` é lida UMA vez por consulta (~0,27 s).
 */
function taskClientNotCancelledSql(tx: Tx) {
  const cliente = clienteDaTarefaIdSql(tx);
  return tx`(${cliente} is null
             or not (${cliente} = any (array(select cancelado.id from ideworks.clients cancelado
                                              where not cancelado.is_active))))`;
}

/**
 * A janela de `get_board` e `get_person_work` — F38, Fase 6.1. O mesmo
 * desenho de `searchKindWindow`, sem espécie: `limit + 1` (o `+ 1` é o que faz
 * o corte do banco aparecer como "sobrou item" para o `pageAndFit`) e a
 * continuação estritamente depois do cursor, na ordem `lower(título) collate
 * "C", id::text collate "C"` — a de `titleOrderKey` no JavaScript. Sem janela,
 * a leitura vem inteira (as provas comparam com ela).
 */
export type TitleCut = { after: { k: string; id: string } | null; fetch: number | null };

export function titleWindowCut(window: TitleWindow | undefined): TitleCut {
  if (!window) return { after: null, fetch: null };
  const cursor = window.cursor;
  return { after: cursor ? { k: cursor.k, id: cursor.id } : null, fetch: window.limit + 1 };
}

function titleAfterSql(tx: Tx, cut: TitleCut) {
  return cut.after
    ? tx`and (lower(t.title) collate "C", t.id::text collate "C") > (${cut.after.k}, ${cut.after.id})`
    : tx``;
}

function titleLimitSql(tx: Tx, cut: TitleCut) {
  return cut.fetch === null ? tx`` : tx`limit ${cut.fetch}`;
}

/**
 * Os clientes de UMA página de linhas — F38, Fase 6.1 (o nome) e F31 (a empresa
 * omitida).
 *
 * POR QUÊ à parte, e não `left join ideworks.clients` na consulta das tarefas:
 * com a estimativa de linhas baixa (a da pessoa é sempre "1"), o Postgres
 * escolhia laço aninhado e relia `clients` inteiro (com a política de linha) a
 * cada tarefa — 0,6 s em 97 tarefas. Aqui é uma leitura só, das ≤ `limit + 1`
 * linhas que voltaram. Cliente que a política não devolve fica sem nome, como no
 * `left join`.
 *
 * POR QUE a empresa omitida é decidida AQUI: a tarefa (ou a lista) é de uma
 * empresa em escopo — a do espaço da lista —, mas o cliente ligado a ela pode
 * ser de outra, e `integration_allows_client()` só conhece a concessão, não a
 * omissão (que vem de uma variável do Worker, F31). A linha fica, porque está
 * legitimamente no recorte; o CLIENTE some dela (id e nome), como na linha sem
 * cliente. É o mesmo desfecho de `search` e `list_clients`, que escondem esse
 * cliente. Todas as leituras de tarefa passam por esta função, então a regra
 * mora num lugar só. Sem empresa omitida e sem `clients:read` nenhuma consulta
 * é feita; sem omitida a consulta é a de antes.
 */
type ClientesDaPagina = {
  /** O cliente é de empresa omitida: a linha não leva cliente nenhum (nem o id). */
  oculto: (id: string | null | undefined) => boolean;
  /** O nome, só com `clients:read` e quando a política de linha devolveu o cliente. */
  nome: (id: string) => string | null;
};

async function clientNamesOf(
  tx: Tx,
  scope: WorkScope,
  ids: readonly (string | null)[],
): Promise<ClientesDaPagina> {
  const unicos = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const comNome = scope.capabilities.has('clients:read');
  const omitidas = new Set(omittedIn(scope.companies));
  const nomes = new Map<string, string | null>();
  const ocultos = new Set<string>();
  if (unicos.length > 0 && (comNome || omitidas.size > 0)) {
    const rows = await tx`
      select c.id::text as id, c.name, c.category_id::text as company_id
        from ideworks.clients c
       where c.id = any(${arrayOuNulo(unicos)}::uuid[])`;
    for (const row of rows) {
      nomes.set(row.id as string, (row.name as string | null) ?? null);
      if (omitidas.has(row.company_id as string)) ocultos.add(row.id as string);
    }
  }
  return {
    oculto: (id) => !!id && ocultos.has(id),
    nome: (id) => (comNome ? (nomes.get(id) ?? null) : null),
  };
}

/**
 * F31 — a mesma pergunta de `clientNamesOf` para as consultas que já juntam o
 * cliente (`cl`) na própria linha: o cliente é de empresa omitida? Quem pergunta
 * lê `cl.category_id::text as client_company_id`.
 */
function clienteDeEmpresaOmitida(scope: WorkScope): (companyId: unknown) => boolean {
  const omitidas = new Set(omittedIn(scope.companies));
  return (companyId) => omitidas.size > 0 && typeof companyId === 'string' && omitidas.has(companyId);
}

function boardClientSql(tx: Tx, scope: WorkScope) {
  const clients = clientList(scope);
  if (clients === 'all') {
    return tx`(l.client_id is null or ideworks.integration_allows_client(l.client_id))`;
  }
  if (clients === 'none') {
    return tx`l.client_id is null`;
  }
  return tx`(l.client_id is null or (ideworks.integration_allows_client(l.client_id) and l.client_id = any(${arrayOuNulo(clients)}::uuid[])))`;
}

/**
 * A janela de UMA espécie da busca — F22, Fase 3.
 *
 * POR QUÊ existe: o `searchWork` ordena os achados por `espécie:título dobrado`
 * e desempata por id. Como nenhuma espécie é prefixo da outra, essa ordem é a
 * CONCATENAÇÃO das espécies em ordem alfabética (board, client, person, task).
 * Logo, os primeiros N achados depois do cursor estão contidos nos primeiros N
 * de cada espécie — pedir `limite + 1` por espécie basta, e nada se perde.
 *
 * O `+ 1` não é enfeite: é ele que faz o corte do BANCO aparecer como "sobrou
 * item" para o `pageAndFit`, que continua sendo o único lugar que decide
 * `hasMore`. Sem o extra, uma página cheia pareceria a última.
 *
 * `skip` mata a consulta inteira quando o cursor já passou daquela espécie —
 * caso contrário a consulta traria as primeiras linhas dela, todas ANTES do
 * cursor, e a página voltaria vazia com páginas ainda por ler.
 */
export type KindWindow = { skip: boolean; after: { k: string; id: string } | null; fetch: number };

export function searchKindWindow(kind: SearchKind, window: SearchWindow): KindWindow {
  const fetch = window.limit + 1;
  const cursor = window.cursor;
  if (cursor === null) return { skip: false, after: null, fetch };
  const corte = cursor.k.indexOf(':');
  const especie = corte < 0 ? cursor.k : cursor.k.slice(0, corte);
  if (especie > kind) return { skip: true, after: null, fetch };
  if (especie < kind) return { skip: false, after: null, fetch };
  return { skip: false, after: { k: cursor.k.slice(corte + 1), id: cursor.id }, fetch };
}

/**
 * O histórico de movimentação de UMA tarefa (a que já passou pelo recorte), com
 * os nomes que a concessão pode ver — G6.
 *
 * A ficha da tela resolve lista, etapa e cliente de cada fato pelo nome vivo.
 * Para o agente isso vaza: o fato "alterou a lista de A para B" carrega o nome da
 * lista A, e A pode ser de OUTRA empresa (ou da empresa omitida, a Alma9) ou de
 * outro cliente que a conexão não alcança, ainda que a tarefa de hoje esteja no
 * recorte. Então cada nome só sai se o que ele nomeia está DENTRO do recorte:
 *
 *   · lista: viva e no recorte de empresa e de cliente (`companySql` +
 *     `boardClientSql`, o mesmo de `get_board`);
 *   · cliente: ATIVO e no recorte de empresa e de cliente;
 *   · etapa: de alguma esteira de lista no recorte de empresa.
 *
 * Nome que não se confirma (inclusive o PARAQUEDAS, o retrato de lista ou etapa
 * já apagada, que não tem id para conferir) fica de fora, e a frase que dependia
 * dele some em `frasesDoEvento`. Gente (`actor`, quem entrou e saiu) vem crua: o
 * corte é por `people:read`, em `task-ficha.ts`.
 */
async function lerHistoricoNoRecorte(tx: Tx, scope: WorkScope, taskId: string): Promise<EventoDaTarefa[]> {
  const brutos = await tx`
    select e.id::text as id, e.automation_name, e.occurred_at, e.via_name,
           ideworks.display_name(e.actor_id) as actor,
           e.from_list_id::text as from_list_id, e.to_list_id::text as to_list_id,
           e.from_status_id::text as from_status_id, e.to_status_id::text as to_status_id,
           e.from_client_id::text as from_client_id, e.to_client_id::text as to_client_id,
           coalesce(
             (select json_agg(coalesce(ideworks.display_name(u), '(sem nome)'))
                from unnest(e.removed_user_ids) as u),
             '[]'::json) as removed,
           coalesce(
             (select json_agg(coalesce(ideworks.display_name(u), '(sem nome)'))
                from unnest(
                       array_remove(array[e.added_user_id], null) || e.added_user_ids
                     ) as u),
             '[]'::json) as added
      from ideworks.task_events e
     where e.task_id = ${taskId}::uuid
     order by e.occurred_at, e.id`;
  if (brutos.length === 0) return [];

  const unicos = (campos: string[]) => [
    ...new Set(
      brutos.flatMap((row) => campos.map((campo) => row[campo] as string | null)).filter((v): v is string => !!v),
    ),
  ];
  const listaIds = unicos(['from_list_id', 'to_list_id']);
  const etapaIds = unicos(['from_status_id', 'to_status_id']);
  const clienteIds = unicos(['from_client_id', 'to_client_id']);
  const clientes = clientList(scope);

  const listas =
    listaIds.length === 0
      ? []
      : await tx`
          select l.id::text as id, l.name
            from ideworks.lists l
            join ideworks.tree tr on tr.list_id = l.id
           where l.id = any(${arrayOuNulo(listaIds)}::uuid[])
             and tr.is_live
             and tr.category_id is not null
             and ${companySql(tx, scope, 'tr.category_id')}
             and ${boardClientSql(tx, scope)}`;
  const etapas =
    etapaIds.length === 0
      ? []
      : await tx`
          select st.id::text as id, st.name
            from ideworks.statuses st
           where st.id = any(${arrayOuNulo(etapaIds)}::uuid[])
             and exists (select 1
                           from ideworks.list_workflow lw
                           join ideworks.tree tr on tr.list_id = lw.list_id
                          where lw.status_id = st.id
                            and tr.category_id is not null
                            and ${companySql(tx, scope, 'tr.category_id')})`;
  const clientesVisiveis =
    clienteIds.length === 0 || clientes === 'none'
      ? []
      : await tx`
          select c.id::text as id, c.name
            from ideworks.clients c
           where c.id = any(${arrayOuNulo(clienteIds)}::uuid[])
             and c.is_active
             and ${companySql(tx, scope, 'c.category_id')}
             and ideworks.integration_allows_client(c.id)
             ${clientes === 'all' ? tx`` : tx`and c.id = any(${arrayOuNulo(clientes)}::uuid[])`}`;

  const nomeDe = (conjunto: readonly Record<string, unknown>[]) =>
    new Map(conjunto.map((row) => [row.id as string, (row.name as string | null) ?? null]));
  const listasPorId = nomeDe(listas);
  const etapasPorId = nomeDe(etapas);
  const clientesPorId = nomeDe(clientesVisiveis);
  const confirmado = (porId: Map<string, string | null>, id: unknown) =>
    typeof id === 'string' ? (porId.get(id) ?? null) : null;

  return brutos.map(
    (row): EventoDaTarefa => ({
      id: row.id as string,
      automationName: (row.automation_name as string | null) ?? null,
      actorName: (row.actor as string | null) ?? null,
      fromListName: confirmado(listasPorId, row.from_list_id),
      toListName: confirmado(listasPorId, row.to_list_id),
      fromStatusName: confirmado(etapasPorId, row.from_status_id),
      toStatusName: confirmado(etapasPorId, row.to_status_id),
      fromClientName: confirmado(clientesPorId, row.from_client_id),
      toClientName: confirmado(clientesPorId, row.to_client_id),
      removed: (row.removed as string[] | null) ?? [],
      added: (row.added as string[] | null) ?? [],
      occurredAt: instant(row.occurred_at) ?? new Date(0).toISOString(),
      viaName: (row.via_name as string | null) ?? null,
    }),
  );
}

/** G5 — o cadastro de um cliente ativo, só com o que o contrato leva (nunca contato). */
function clientProfileOf(
  row: Record<string, unknown>,
  tags: readonly Record<string, unknown>[],
): WorkClientProfile {
  return {
    plan: row.plan_id ? { id: row.plan_id as string, name: (row.plan_name as string | null) ?? (row.plan_id as string) } : null,
    urgency: CLIENT_URGENCIES.includes(row.urgency as (typeof CLIENT_URGENCIES)[number])
      ? (row.urgency as (typeof CLIENT_URGENCIES)[number])
      : 'paz',
    startedOn: row.started_on === null || row.started_on === undefined ? null : dueOn(row.started_on),
    renewsOn: row.renews_on === null || row.renews_on === undefined ? null : dueOn(row.renews_on),
    tags: tags.map((tag) => ({
      id: tag.id as string,
      name: tag.name as string,
      color: (tag.color as string | null) ?? null,
    })),
  };
}

export class SqlWorkCatalog implements WorkCatalog {
  constructor(
    private readonly env: ServerEnv,
    private readonly actor: Actor,
  ) {}

  /** Conexão emprestada da requisição (F22, Fase 2); o ator continua sendo o deste porto. */
  private async withTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return borrowSql(this.env, 'trabalho', (sql) => withActor(sql, this.actor, work));
  }

  private async directory(
    tx: Tx,
    scope: WorkScope,
    personId?: string,
    busca?: { needle: string; window: KindWindow },
  ): Promise<WorkPersonView[]> {
    const id = personId ? asUuid(personId) : null;
    if (personId && !id) return [];
    const rows = await tx`
      select d.id::text as id,
             d.name as display_name,
             (
               select json_build_object('id', c.id::text, 'name', c.name)
                 from ideworks.user_categories uc
                 join ideworks.client_categories c on c.id = uc.category_id
                where uc.user_id = d.id
                  and ${companySql(tx, scope, 'uc.category_id')}
                order by lower(c.name), c.id
                limit 1
             ) as team
        from ideworks.team_directory() d
       where (${id}::uuid is null or d.id = ${id}::uuid)
         and (
           exists (
             select 1
               from ideworks.user_categories uc
              where uc.user_id = d.id
                and ${companySql(tx, scope, 'uc.category_id')}
           )
           or (
             ${companyList(scope) === null}
             and not exists (
               select 1 from ideworks.user_categories uc where uc.user_id = d.id
             )
           )
         )
         ${busca ? tx`and position(${busca.needle} in lower(d.name)) > 0` : tx``}
         ${
           busca?.window.after
             ? tx`and (lower(d.name) collate "C", d.id::text collate "C") > (${busca.window.after.k}, ${busca.window.after.id})`
             : tx``
         }
       order by lower(d.name) collate "C", d.id::text collate "C"
       ${busca ? tx`limit ${busca.window.fetch}` : tx``}`;

    return rows.map((row) => ({
      id: row.id as string,
      displayName: (row.display_name as string) || (row.id as string),
      team: (row.team as WorkPersonView['team']) ?? null,
    }));
  }

  /**
   * A janela (`limite + 1`, depois do cursor) desce às QUATRO consultas — F22,
   * Fase 3. O recorte da concessão continua inteiro no `where`, e o `limit` só
   * corta o que o `where` já deixou passar: limitar antes de recortar mostraria
   * linha que a concessão não alcança. A ordem é a mesma que pagina depois
   * (`lower(...)` = o `searchOrderKey()` do JS; `collate "C"` para o banco
   * comparar por byte, como o JavaScript compara, e o cursor cair no mesmo
   * lugar nos dois. NÃO há `btrim` aqui de propósito: `btrim` corta só espaço,
   * e `String.trim()` corta tabulação, quebra de linha e espaço duro também —
   * um título com tabulação na frente ordenaria em lugares diferentes nos dois
   * lados e ficaria inalcançável depois da primeira página.)
   */
  async search(
    scope: WorkScope,
    query: string,
    kinds: readonly SearchKind[],
    window: SearchWindow,
  ): Promise<readonly WorkSearchHit[]> {
    if (emptyScope(scope)) return [];
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    return this.withTx(async (tx) => {
      const hits: WorkSearchHit[] = [];
      const canBoard = scope.capabilities.has('boards:read');
      const canClient = scope.capabilities.has('clients:read');
      const clienteOmitido = clienteDeEmpresaOmitida(scope);
      const janela = (kind: SearchKind) => searchKindWindow(kind, window);

      const board = janela('board');
      if (kinds.includes('board') && !board.skip) {
        const rows = await tx`
          select l.id::text as id, l.name as title,
                 tr.category_id::text as company_id, cat.name as company_name,
                 l.client_id::text as client_id, cl.name as client_name,
                 cl.category_id::text as client_company_id
            from ideworks.lists l
            join ideworks.tree tr on tr.list_id = l.id
            left join ideworks.client_categories cat on cat.id = tr.category_id
            left join ideworks.clients cl on cl.id = l.client_id
           where position(${needle} in lower(l.name)) > 0
             and tr.category_id is not null
             and ${companySql(tx, scope, 'tr.category_id')}
             and ${boardClientSql(tx, scope)}
             -- F38, Fase 4: lista de cliente cancelado não volta na busca.
             and coalesce(cl.is_active, true)
             ${
               board.after
                 ? tx`and (lower(l.name) collate "C", l.id::text collate "C") > (${board.after.k}, ${board.after.id})`
                 : tx``
             }
           order by lower(l.name) collate "C", l.id::text collate "C"
           limit ${board.fetch}`;
        for (const row of rows) {
          hits.push({
            kind: 'board',
            id: row.id as string,
            title: row.title as string,
            detail: null,
            board: { id: row.id as string, name: row.title as string },
            client: clienteOmitido(row.client_company_id) ? null : named(row.client_id as string | null, row.client_name as string | null, canClient),
            company: row.company_id
              ? { id: row.company_id as string, name: (row.company_name as string) || (row.company_id as string) }
              : null,
          });
        }
      }

      const task = janela('task');
      if (kinds.includes('task') && !task.skip) {
        const rows = await tx`
          select t.id::text as id, t.title,
                 tr.category_id::text as company_id, cat.name as company_name,
                 t.list_id::text as board_id, tr.list_name as board_name, tr.is_live,
                 ${clienteDaTarefaIdSql(tx)}::text as client_id, cl.name as client_name,
                 cl.category_id::text as client_company_id
            from ideworks.tasks t
            ${taskClientJoins(tx, scope)}
            left join ideworks.tree tr on tr.list_id = t.list_id
            left join ideworks.client_categories cat on cat.id = tr.category_id
            left join ideworks.clients cl on cl.id = ${clienteDaTarefaIdSql(tx)}
           where t.archived_at is null
             and position(${needle} in lower(t.title)) > 0
             and tr.category_id is not null
             and ${companySql(tx, scope, 'tr.category_id')}
             and ${clientSql(tx, scope)}
             -- F38, Fase 4: tarefa de cliente cancelado não volta na busca;
             -- pelo id, \`get_task\` continua lendo. Desde a Fase 6 o \`cl\` já
             -- é o cliente da tarefa pela regra única (o dela, e na falta
             -- dele o da lista), então uma condição só basta.
             and coalesce(cl.is_active, true)
             ${
               task.after
                 ? tx`and (lower(t.title) collate "C", t.id::text collate "C") > (${task.after.k}, ${task.after.id})`
                 : tx``
             }
           order by lower(t.title) collate "C", t.id::text collate "C"
           limit ${task.fetch}`;
        for (const row of rows) {
          hits.push({
            kind: 'task',
            id: row.id as string,
            title: row.title as string,
            detail: null,
            board: named(row.board_id as string | null, row.board_name as string | null, canBoard && row.is_live === true),
            client: clienteOmitido(row.client_company_id) ? null : named(row.client_id as string | null, row.client_name as string | null, canClient),
            company: row.company_id
              ? { id: row.company_id as string, name: (row.company_name as string) || (row.company_id as string) }
              : null,
          });
        }
      }

      const client = janela('client');
      if (kinds.includes('client') && !client.skip) {
        if (scope.clients !== 'none') {
          const clientIds = scope.clients === 'all' ? null : [...scope.clients];
          // F38, Fase 4 — o ativo casa por trecho do nome; o CANCELADO só pelo
          // começo do nome, até uma fronteira de palavra, sem acento. É a regra
          // de \`cancelledNameMatches\` (reads.ts), escrita aqui em SQL.
          const prefixo = semAcento(query.trim());
          const rows = await tx`
            select c.id::text as id, c.name as title,
                   c.category_id::text as company_id, cat.name as company_name,
                   c.is_active,
                   to_char(c.inactive_at at time zone ${AGENCY_TIMEZONE}, 'YYYY-MM-DD') as cancelled_on
              from ideworks.clients c
              join ideworks.client_categories cat on cat.id = c.category_id
              cross join lateral (
                select translate(lower(c.name), ${ACENTOS_DE}, ${ACENTOS_PARA}) as nome
              ) n
             where (
                     (c.is_active and position(${needle} in lower(c.name)) > 0)
                  or (
                       not c.is_active
                       and length(${prefixo}::text) > 0
                       and left(n.nome, length(${prefixo}::text)) = ${prefixo}::text
                       and (
                             length(n.nome) = length(${prefixo}::text)
                          or substr(n.nome, length(${prefixo}::text) + 1, 1) !~ '[a-z0-9]'
                           )
                     )
                   )
               and ${companySql(tx, scope, 'c.category_id')}
               and ideworks.integration_allows_client(c.id)
               and (${clientIds}::uuid[] is null or c.id = any(${arrayOuNulo(clientIds)}::uuid[]))
               ${
                 client.after
                   ? tx`and (lower(c.name) collate "C", c.id::text collate "C") > (${client.after.k}, ${client.after.id})`
                   : tx``
               }
             order by lower(c.name) collate "C", c.id::text collate "C"
             limit ${client.fetch}`;
          for (const row of rows) {
            if (row.is_active === false) {
              const cancelledOn = (row.cancelled_on as string | null) ?? null;
              hits.push({
                kind: 'client',
                id: row.id as string,
                title: row.title as string,
                detail: cancelledDetail(cancelledOn),
                board: null,
                client: null,
                company: null,
                cancelled: true,
                cancelledOn,
              });
              continue;
            }
            hits.push({
              kind: 'client',
              id: row.id as string,
              title: row.title as string,
              detail: null,
              board: null,
              client: { id: row.id as string, name: row.title as string },
              company: { id: row.company_id as string, name: row.company_name as string },
            });
          }
        }
      }

      const person_ = janela('person');
      if (kinds.includes('person') && !person_.skip) {
        // O diretório também recebe a janela: filtrar o nome em JS depois de
        // trazer a equipe inteira é o mesmo defeito, em escala menor.
        const people = await this.directory(tx, scope, undefined, { needle, window: person_ });
        for (const person of people) {
          hits.push({
            kind: 'person',
            id: person.id,
            title: person.displayName,
            detail: person.team?.name ?? null,
            board: null,
            client: null,
            company: person.team,
          });
        }
      }

      return hits;
    });
  }

  /**
   * F38, Fase 6.1 — a janela (`limit + 1`, depois do cursor) desce à consulta
   * de tarefas, como no `search`. O recorte da concessão continua inteiro no
   * `where`, e o `limit` só corta o que o `where` deixou passar. Os totais das
   * colunas vêm de uma contagem à parte, com o MESMO `where` e sem janela —
   * contar a página daria o total da página.
   */
  async getBoard(scope: WorkScope, boardId: string, window?: TitleWindow): Promise<WorkBoardView | null> {
    if (emptyScope(scope)) return null;
    const id = asUuid(boardId);
    if (!id) return null;
    return this.withTx(async (tx) => {
      const [board] = await tx`
        select l.id::text as id, l.name,
               tr.space_id::text as space_id, tr.space_name,
               tr.folder_id::text as folder_id, tr.folder_name,
               tr.category_id::text as company_id, cat.name as company_name,
               l.client_id::text as client_id, cl.name as client_name,
               cl.category_id::text as client_company_id
          from ideworks.lists l
          join ideworks.tree tr on tr.list_id = l.id
          left join ideworks.client_categories cat on cat.id = tr.category_id
          left join ideworks.clients cl on cl.id = l.client_id
         where l.id = ${id}::uuid
           and tr.category_id is not null
           and ${companySql(tx, scope, 'tr.category_id')}
           and ${boardClientSql(tx, scope)}`;
      if (!board) return null;

      const statuses = await tx`
        select lw.status_id::text as id, lw.status_name as name, lw.status_sort_order as sort_order,
               lw.status_type::text as type
          from ideworks.list_workflow lw
         where lw.list_id = ${id}::uuid
         order by lw.status_sort_order, lw.status_id`;

      const totals = await tx`
        select t.status_id::text as status_id, count(*)::int as total
          from ideworks.tasks t
          ${taskClientJoins(tx, scope)}
         where t.list_id = ${id}::uuid
           and t.archived_at is null
           and ${clientSql(tx, scope)}
         group by t.status_id`;
      const totalOf = new Map(totals.map((row) => [row.status_id as string | null, Number(row.total) || 0]));

      const cut = titleWindowCut(window);
      const taskRows = await tx`
        select t.id::text as id, t.title, t.status_id::text as status_id,
               t.priority::text as priority, t.demand_type::text as demand_type,
               t.start_on::text as start_on,
               t.completed_at, t.archived_at,
               ${clienteDaTarefaIdSql(tx)}::text as client_id,
               coalesce(
                 (select json_agg(json_build_object(
                            'id', a.user_id::text,
                            'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                          order by ideworks.display_name(a.user_id))
                    from ideworks.task_assignees a
                   where a.task_id = t.id),
                 '[]'::json
               ) as people
          from ideworks.tasks t
          ${taskClientJoins(tx, scope)}
         where t.list_id = ${id}::uuid
           and t.archived_at is null
           and ${clientSql(tx, scope)}
           ${titleAfterSql(tx, cut)}
         order by lower(t.title) collate "C", t.id::text collate "C"
         ${titleLimitSql(tx, cut)}`;

      const canClient = scope.capabilities.has('clients:read');
      const canPeople = scope.capabilities.has('people:read');
      const clientes = await clientNamesOf(tx, scope, taskRows.map((row) => row.client_id as string | null));
      const tasks = taskRows.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        statusId: (row.status_id as string | null) ?? null,
        priority: priorityOf(row.priority),
        type: demandTypeOf(row.demand_type),
        startOn: row.start_on === null || row.start_on === undefined ? null : dueOn(row.start_on),
        completedAt: instant(row.completed_at),
        archivedAt: instant(row.archived_at),
        client:
          canClient && row.client_id && !clientes.oculto(row.client_id as string)
            ? { id: row.client_id as string, name: clientes.nome(row.client_id as string) ?? (row.client_id as string) }
            : null,
        people: canPeople ? peopleOf(row.people) : [],
      }));

      const columns = statuses.map((status) => ({
        id: status.id as string,
        name: status.name as string,
        sortOrder: Number(status.sort_order) || 0,
        type: statusTypeOf(status.type),
        total: totalOf.get(status.id as string) ?? 0,
      }));

      return {
        id: board.id as string,
        name: board.name as string,
        space: named(board.space_id as string, board.space_name as string | null, true) ?? { id: board.space_id as string, name: null },
        folder: named(board.folder_id as string | null, board.folder_name as string | null, true),
        company: { id: board.company_id as string, name: (board.company_name as string) ?? (board.company_id as string) },
        client: clienteDeEmpresaOmitida(scope)(board.client_company_id)
          ? null
          : named(board.client_id as string | null, board.client_name as string | null, canClient),
        columns,
        tasks,
      };
    });
  }

  /**
   * F37 — a esteira de uma lista ou pasta, com o recorte no WHERE (empresa,
   * empresa omitida e cliente), igual a `getBoard`.
   *
   * Lista: a esteira resolvida por `ideworks.resolve_status_set` (lista → pasta
   * → espaço), a mesma da view `list_workflow`. Pasta: a esteira da pasta, ou a
   * do espaço quando a pasta não tem uma (a regra de `ideworks.folder_workflow`).
   */
  async getWorkflow(scope: WorkScope, target: WorkflowTarget): Promise<WorkWorkflowView | null> {
    if (emptyScope(scope)) return null;
    const id = asUuid(target.id);
    if (!id) return null;
    return this.withTx(async (tx) => {
      let header: {
        name: string;
        companyId: string;
        companyName: string | null;
        setId: string | null;
        setName: string | null;
        origin: WorkflowOrigin;
        ownerId: string;
        ownerName: string | null;
      } | null = null;

      if (target.kind === 'list') {
        const [row] = await tx`
          select l.name, tr.category_id::text as company_id, cat.name as company_name,
                 ss.id::text as set_id, ss.name as set_name,
                 case when ss.list_id is not null then 'list'
                      when ss.folder_id is not null then 'folder'
                      else 'space' end as origin,
                 case when ss.list_id is not null then l.id
                      when ss.folder_id is not null then tr.folder_id
                      else tr.space_id end::text as owner_id,
                 case when ss.list_id is not null then l.name
                      when ss.folder_id is not null then tr.folder_name
                      else tr.space_name end as owner_name
            from ideworks.lists l
            join ideworks.tree tr on tr.list_id = l.id
            left join ideworks.client_categories cat on cat.id = tr.category_id
            left join ideworks.status_sets ss on ss.id = ideworks.resolve_status_set(l.id)
           where l.id = ${id}::uuid
             and tr.category_id is not null
             and ${companySql(tx, scope, 'tr.category_id')}
             and ${boardClientSql(tx, scope)}`;
        if (row) header = this.workflowHeader(row);
      } else {
        const [row] = await tx`
          select f.name, s.category_id::text as company_id, cat.name as company_name,
                 ss.id::text as set_id, ss.name as set_name,
                 case when ss.folder_id is not null then 'folder' else 'space' end as origin,
                 case when ss.folder_id is not null then f.id else s.id end::text as owner_id,
                 case when ss.folder_id is not null then f.name else s.name end as owner_name
            from ideworks.folders f
            join ideworks.spaces s on s.id = f.space_id
            left join ideworks.client_categories cat on cat.id = s.category_id
            left join ideworks.status_sets ss on ss.id = coalesce(
                   (select x.id from ideworks.status_sets x where x.folder_id = f.id),
                   (select x.id from ideworks.status_sets x where x.space_id = f.space_id))
           where f.id = ${id}::uuid
             and s.category_id is not null
             and ${companySql(tx, scope, 's.category_id')}
             and (not exists (select 1 from ideworks.lists l where l.folder_id = f.id)
                  or exists (select 1 from ideworks.lists l
                              where l.folder_id = f.id and ${boardClientSql(tx, scope)}))`;
        if (row) header = this.workflowHeader(row);
      }
      if (!header || !header.setId) return null;

      const stages = await tx`
        select st.id::text as id, st.name, st.sort_order, st.type::text as type
          from ideworks.statuses st
         where st.status_set_id = ${header.setId}::uuid
         order by st.sort_order, st.id`;

      // F40 — quem decide é o banco (`list_is_production`); pasta não tem resposta única.
      let isProduction: boolean | null = null;
      if (target.kind === 'list') {
        const [prod] = await tx`select ideworks.list_is_production(${id}::uuid) as producao`;
        isProduction = prod?.producao === true;
      }

      return {
        target: { kind: target.kind, id, name: header.name },
        company: { id: header.companyId, name: header.companyName ?? header.companyId },
        name: header.setName ?? header.name,
        inheritedFrom: header.origin,
        owner: { kind: header.origin, id: header.ownerId, name: header.ownerName ?? header.ownerId },
        stages: stages.map((stage) => ({
          id: stage.id as string,
          name: stage.name as string,
          sortOrder: Number(stage.sort_order) || 0,
          type: statusTypeOf(stage.type),
        })),
        isProduction,
      };
    });
  }

  /**
   * G11 — as listas do recorte: empresa (omitidas fora) e cliente da lista no
   * `where`, lista de cliente cancelado fora. `isProduction` é a pergunta do
   * banco (`list_is_production`), a mesma de `get_workflow` e de `create_task`.
   */
  async listBoards(scope: WorkScope, options: { includeArchived: boolean }): Promise<readonly WorkBoardRow[]> {
    if (emptyScope(scope)) return [];
    return this.withTx(async (tx) => {
      const linhas = await tx`
        select l.id::text as id, l.name,
               tr.space_id::text as space_id, tr.space_name,
               tr.folder_id::text as folder_id, tr.folder_name,
               tr.category_id::text as company_id, cat.name as company_name,
               l.client_id::text as client_id, cl.name as client_name,
               cl.category_id::text as client_company_id,
               coalesce(l.requires_client, false) as requires_client,
               ideworks.list_is_production(l.id) as is_production,
               (l.archived_at is not null or not tr.is_live) as archived
          from ideworks.lists l
          join ideworks.tree tr on tr.list_id = l.id
          left join ideworks.client_categories cat on cat.id = tr.category_id
          left join ideworks.clients cl on cl.id = l.client_id
         where tr.category_id is not null
           and ${companySql(tx, scope, 'tr.category_id')}
           and ${boardClientSql(tx, scope)}
           and coalesce(cl.is_active, true)
           ${options.includeArchived ? tx`` : tx`and tr.is_live and l.archived_at is null`}
         order by lower(tr.space_name), lower(coalesce(tr.folder_name, '')), lower(l.name), l.id`;
      const clienteOmitido = clienteDeEmpresaOmitida(scope);
      return linhas.map(
        (linha): WorkBoardRow => ({
          id: linha.id as string,
          name: linha.name as string,
          space: { id: linha.space_id as string, name: (linha.space_name as string | null) ?? null },
          folder: linha.folder_id
            ? { id: linha.folder_id as string, name: (linha.folder_name as string | null) ?? null }
            : null,
          company: { id: linha.company_id as string, name: (linha.company_name as string | null) ?? (linha.company_id as string) },
          client:
            linha.client_id && !clienteOmitido(linha.client_company_id)
              ? { id: linha.client_id as string, name: (linha.client_name as string | null) ?? null }
              : null,
          requiresClient: linha.requires_client === true,
          isProduction: linha.is_production === true,
          archived: linha.archived === true,
        }),
      );
    });
  }

  /**
   * G11 — as tarefas do recorte com filtro. O recorte é o de `getPersonWork`
   * (empresa e omitidas, cliente da conexão pela regra única do cliente da
   * tarefa, cliente cancelado fora, arquivada fora) mais o filtro, tudo no
   * `where`; a janela de página desce ao banco como em `getBoard` e o total vem
   * de uma contagem à parte do filtro inteiro. O espaço, a pasta ou a lista do
   * filtro só vale se alcançável: senão devolve `null` (não achado).
   */
  async listTasks(
    scope: WorkScope,
    filters: WorkTaskFilters,
    window?: TitleWindow,
  ): Promise<{ total: number; tasks: WorkListedTask[] } | null> {
    if (emptyScope(scope)) return filters.container ? null : { total: 0, tasks: [] };
    const container = filters.container;
    const containerId = container ? asUuid(container.id) : null;
    if (container && !containerId) return null;
    return this.withTx(async (tx) => {
      if (container && containerId) {
        const alcancavel =
          container.kind === 'list'
            ? await tx`
                select 1 as ok
                  from ideworks.lists l
                  join ideworks.tree tr on tr.list_id = l.id
                  left join ideworks.clients cl on cl.id = l.client_id
                 where l.id = ${containerId}::uuid
                   and tr.category_id is not null
                   and ${companySql(tx, scope, 'tr.category_id')}
                   and ${boardClientSql(tx, scope)}
                   -- F38: lista de cliente cancelado não existe aqui, como em \`listBoards\`.
                   and coalesce(cl.is_active, true)`
            : container.kind === 'folder'
              ? await tx`
                  select 1 as ok
                    from ideworks.folders f
                    join ideworks.spaces s on s.id = f.space_id
                   where f.id = ${containerId}::uuid
                     and s.category_id is not null
                     and ${companySql(tx, scope, 's.category_id')}
                     and (not exists (select 1 from ideworks.lists l where l.folder_id = f.id)
                          or exists (select 1 from ideworks.lists l
                                      left join ideworks.clients cl on cl.id = l.client_id
                                      where l.folder_id = f.id and ${boardClientSql(tx, scope)}
                                        and coalesce(cl.is_active, true)))`
              : await tx`
                  select 1 as ok
                    from ideworks.spaces s
                   where s.id = ${containerId}::uuid
                     and s.category_id is not null
                     and ${companySql(tx, scope, 's.category_id')}
                     and (not exists (select 1 from ideworks.lists l where l.space_id = s.id)
                          or exists (select 1 from ideworks.lists l
                                      left join ideworks.clients cl on cl.id = l.client_id
                                      where l.space_id = s.id and ${boardClientSql(tx, scope)}
                                        and coalesce(cl.is_active, true)))`;
        if (alcancavel.length === 0) return null;
      }

      const canBoard = scope.capabilities.has('boards:read');
      const canClient = scope.capabilities.has('clients:read');
      const canPeople = scope.capabilities.has('people:read');
      const omitidasDoRecorte = omittedIn(scope.companies);
      const filtro = tx`
        t.archived_at is null
        and tr.category_id is not null
        and ${companySql(tx, scope, 'tr.category_id')}
        and ${clientSql(tx, scope)}
        and ${taskClientNotCancelledSql(tx)}
        ${container?.kind === 'list' ? tx`and t.list_id = ${containerId}::uuid` : tx``}
        ${container?.kind === 'folder' ? tx`and tr.folder_id = ${containerId}::uuid` : tx``}
        ${container?.kind === 'space' ? tx`and tr.space_id = ${containerId}::uuid` : tx``}
        ${
          filters.assigneeId === undefined
            ? tx``
            : tx`and exists (select 1 from ideworks.task_assignees a
                              where a.task_id = t.id and a.user_id = ${filters.assigneeId}::uuid)`
        }
        ${filters.createdBy === undefined ? tx`` : tx`and t.created_by = ${filters.createdBy}::uuid`}
        ${filters.statusType === undefined ? tx`` : tx`and lw.status_type::text = ${filters.statusType}`}
        ${filters.type === undefined ? tx`` : tx`and t.demand_type::text = ${filters.type}`}
        ${filters.dueBefore === undefined ? tx`` : tx`and t.due_on < ${filters.dueBefore}::date`}
        ${filters.overdue === true ? tx`and t.due_on < ${filters.today}::date and t.completed_at is null` : tx``}
        ${filters.clientId === undefined ? tx`` : tx`and ${clienteDaTarefaIdSql(tx)} = ${filters.clientId}::uuid`}
        ${
          // F31: o cliente de empresa omitida não é achado nem pelo filtro (não confirma o vínculo).
          filters.clientId === undefined || omitidasDoRecorte.length === 0
            ? tx``
            : tx`and not exists (select 1 from ideworks.clients oc
                                  where oc.id = ${filters.clientId}::uuid
                                    and oc.category_id = any(${arrayOuNulo(omitidasDoRecorte)}::uuid[]))`
        }
        ${
          filters.completed === true
            ? tx`and t.completed_at is not null`
            : filters.completed === false
              ? tx`and t.completed_at is null`
              : tx``
        }`;

      const [contagem] = await tx`
        select count(*)::int as total
          from ideworks.tasks t
          ${taskClientJoins(tx, scope)}
          left join ideworks.tree tr on tr.list_id = t.list_id
          left join ideworks.list_workflow lw on lw.list_id = t.list_id and lw.status_id = t.status_id
         where ${filtro}`;

      const cut = titleWindowCut(window);
      const linhas = await tx`
        select t.id::text as id, t.title, t.status_id::text as status_id,
               lw.status_name as status_name, lw.status_type::text as status_type,
               t.priority::text as priority, t.demand_type::text as demand_type,
               t.due_on::text as due_on, t.start_on::text as start_on, t.completed_at,
               t.list_id::text as list_id, tr.list_name as list_name, tr.is_live,
               ${clienteDaTarefaIdSql(tx)}::text as client_id,
               ${
                 canPeople
                   ? tx`coalesce(
                          (select json_agg(json_build_object(
                                     'id', a.user_id::text,
                                     'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                                   order by ideworks.display_name(a.user_id))
                             from ideworks.task_assignees a
                            where a.task_id = t.id),
                          '[]'::json)`
                   : tx`'[]'::json`
               } as people
          from ideworks.tasks t
          ${taskClientJoins(tx, scope)}
          left join ideworks.tree tr on tr.list_id = t.list_id
          left join ideworks.list_workflow lw on lw.list_id = t.list_id and lw.status_id = t.status_id
         where ${filtro}
           ${titleAfterSql(tx, cut)}
         order by lower(t.title) collate "C", t.id::text collate "C"
         ${titleLimitSql(tx, cut)}`;

      const clientes = await clientNamesOf(tx, scope, linhas.map((linha) => linha.client_id as string | null));
      return {
        total: Number(contagem?.total) || 0,
        tasks: linhas.map(
          (linha): WorkListedTask => ({
            id: linha.id as string,
            title: linha.title as string,
            statusId: (linha.status_id as string | null) ?? null,
            statusName: (linha.status_name as string | null) ?? null,
            statusType: statusTypeOf(linha.status_type),
            priority: priorityOf(linha.priority),
            type: demandTypeOf(linha.demand_type),
            dueOn: dueOn(linha.due_on),
            startOn: linha.start_on === null || linha.start_on === undefined ? null : dueOn(linha.start_on),
            completedAt: instant(linha.completed_at),
            list: named(linha.list_id as string | null, linha.list_name as string | null, canBoard && linha.is_live === true),
            client: clientes.oculto(linha.client_id as string | null)
              ? null
              : named(
                  linha.client_id as string | null,
                  linha.client_id ? clientes.nome(linha.client_id as string) : null,
                  canClient,
                ),
            people: peopleOf(linha.people),
          }),
        ),
      };
    });
  }

  /**
   * G5 — a carteira ATIVA do recorte: empresa, cliente da concessão e omitidas no
   * `where` (nada fora é lido para depois ser descartado), cancelado fora. O
   * cadastro de cada um vem numa consulta só, as etiquetas em outra — sem uma
   * consulta por cliente.
   */
  async listClients(scope: WorkScope): Promise<readonly WorkClientSummary[]> {
    if (emptyScope(scope)) return [];
    const clientes = clientList(scope);
    if (clientes === 'none') return [];
    // Id que não é UUID não existe no banco: tira da lista em vez de estourar o `::uuid[]`.
    const permitidos = clientes === 'all' ? null : clientes.filter((valor) => asUuid(valor) !== null);
    if (permitidos !== null && permitidos.length === 0) return [];
    return this.withTx(async (tx) => {
      const linhas = await tx`
        select c.id::text as id, c.name,
               c.category_id::text as company_id, cat.name as company_name,
               c.urgency::text as urgency,
               c.started_on::text as started_on, c.renews_on::text as renews_on,
               p.id::text as plan_id, p.name as plan_name
          from ideworks.clients c
          join ideworks.client_categories cat on cat.id = c.category_id
          left join ideworks.plans p on p.id = c.plan_id
         where c.is_active
           and ${companySql(tx, scope, 'c.category_id')}
           and ideworks.integration_allows_client(c.id)
           ${permitidos === null ? tx`` : tx`and c.id = any(${arrayOuNulo(permitidos)}::uuid[])`}
         order by lower(c.name), c.id`;
      if (linhas.length === 0) return [];
      const etiquetas = await tx`
        select ta.client_id::text as client_id, t.id::text as id, t.name, t.color
          from ideworks.client_tag_assignments ta
          join ideworks.client_tags t on t.id = ta.tag_id
         where ta.client_id = any(${arrayOuNulo(linhas.map((linha) => linha.id as string))}::uuid[])
         order by t.name, t.id`;
      return linhas.map(
        (linha): WorkClientSummary => ({
          id: linha.id as string,
          name: linha.name as string,
          company: { id: linha.company_id as string, name: linha.company_name as string },
          ...clientProfileOf(
            linha,
            etiquetas.filter((etiqueta) => etiqueta.client_id === linha.id),
          ),
        }),
      );
    });
  }

  /**
   * G7 — as etiquetas do espaço, pelo mesmo recorte de `getWorkflow`: a empresa
   * do espaço na concessão (omitidas fora) e, para a lista, o cliente dela; um
   * espaço vale se não tem lista nenhuma ou se alguma lista dele passa no
   * recorte de cliente.
   */
  async listTags(scope: WorkScope, target: ListTagsTarget): Promise<WorkTagsView | null> {
    if (emptyScope(scope)) return null;
    const id = asUuid(target.id);
    if (!id) return null;
    return this.withTx(async (tx) => {
      let espaco: { id: string; name: string | null; companyId: string; companyName: string | null } | null = null;
      let lista: { id: string; name: string | null } | null = null;
      if (target.kind === 'list') {
        const [row] = await tx`
          select l.name as list_name, tr.space_id::text as space_id, tr.space_name,
                 tr.category_id::text as company_id, cat.name as company_name
            from ideworks.lists l
            join ideworks.tree tr on tr.list_id = l.id
            left join ideworks.client_categories cat on cat.id = tr.category_id
            left join ideworks.clients cl on cl.id = l.client_id
           where l.id = ${id}::uuid
             and tr.category_id is not null
             and ${companySql(tx, scope, 'tr.category_id')}
             and ${boardClientSql(tx, scope)}
             -- F38: lista de cliente cancelado não existe aqui, como em \`listBoards\`.
             and coalesce(cl.is_active, true)`;
        if (row) {
          espaco = {
            id: row.space_id as string,
            name: (row.space_name as string | null) ?? null,
            companyId: row.company_id as string,
            companyName: (row.company_name as string | null) ?? null,
          };
          lista = { id, name: (row.list_name as string | null) ?? null };
        }
      } else {
        const [row] = await tx`
          select s.id::text as space_id, s.name as space_name,
                 s.category_id::text as company_id, cat.name as company_name
            from ideworks.spaces s
            left join ideworks.client_categories cat on cat.id = s.category_id
           where s.id = ${id}::uuid
             and s.category_id is not null
             and ${companySql(tx, scope, 's.category_id')}
             and (not exists (select 1 from ideworks.lists l where l.space_id = s.id)
                  or exists (select 1 from ideworks.lists l
                              left join ideworks.clients cl on cl.id = l.client_id
                              where l.space_id = s.id and ${boardClientSql(tx, scope)}
                                and coalesce(cl.is_active, true)))`;
        if (row) {
          espaco = {
            id: row.space_id as string,
            name: (row.space_name as string | null) ?? null,
            companyId: row.company_id as string,
            companyName: (row.company_name as string | null) ?? null,
          };
        }
      }
      if (!espaco) return null;

      const tags = await tx`
        select g.id::text as id, g.name, g.bg_color, g.fg_color
          from ideworks.task_tags g
         where g.space_id = ${espaco.id}::uuid
         order by lower(btrim(g.name)), g.id`;
      return {
        space: {
          id: espaco.id,
          name: espaco.name,
          company: { id: espaco.companyId, name: espaco.companyName ?? espaco.companyId },
        },
        list: lista,
        tags: tags.map((tag) => ({
          id: tag.id as string,
          name: tag.name as string,
          bgColor: (tag.bg_color as string | null) ?? null,
          fgColor: (tag.fg_color as string | null) ?? null,
        })),
      };
    });
  }

  private workflowHeader(row: Record<string, unknown>) {
    const origin = row.origin === 'list' || row.origin === 'folder' ? row.origin : 'space';
    return {
      name: row.name as string,
      companyId: row.company_id as string,
      companyName: (row.company_name as string | null) ?? null,
      setId: (row.set_id as string | null) ?? null,
      setName: (row.set_name as string | null) ?? null,
      origin: origin as WorkflowOrigin,
      ownerId: row.owner_id as string,
      ownerName: (row.owner_name as string | null) ?? null,
    };
  }

  async getTask(scope: WorkScope, taskId: string): Promise<WorkTaskView | null> {
    if (emptyScope(scope)) return null;
    const id = asUuid(taskId);
    if (!id) return null;
    return this.withTx(async (tx) => {
      const [task] = await tx`
        select t.id::text as id, t.title, t.description,
               t.due_on::text as due_on, t.status_id::text as status_id,
               t.priority::text as priority, t.demand_type::text as demand_type,
               t.start_on::text as start_on,
               t.completed_at, t.archived_at,
               (select lw.status_type::text
                  from ideworks.list_workflow lw
                 where lw.list_id = t.list_id and lw.status_id = t.status_id) as status_type,
               t.list_id::text as board_id, tr.list_name as board_name, tr.is_live,
               -- G6: a ficha inteira (mãe, quem criou/concluiu, pasta e espaço).
               t.parent_id::text as parent_id,
               t.created_by::text as created_by,
               ideworks.display_name(t.created_by) as created_by_name,
               t.completed_by::text as completed_by,
               ideworks.display_name(t.completed_by) as completed_by_name,
               t.via_name, t.created_at,
               tr.folder_id::text as folder_id, tr.folder_name,
               tr.space_id::text as space_id, tr.space_name,
               ${clienteDaTarefaIdSql(tx)}::text as client_id, cl.name as client_name,
               cl.category_id::text as client_company_id,
               coalesce(
                 (select json_agg(json_build_object(
                            'id', a.user_id::text,
                            'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                          order by ideworks.display_name(a.user_id))
                    from ideworks.task_assignees a
                   where a.task_id = t.id),
                 '[]'::json
               ) as people
          from ideworks.tasks t
          ${taskClientJoins(tx, scope)}
          left join ideworks.tree tr on tr.list_id = t.list_id
          left join ideworks.clients cl on cl.id = ${clienteDaTarefaIdSql(tx)}
         where t.id = ${id}::uuid
           and t.archived_at is null
           and tr.category_id is not null
           and ${companySql(tx, scope, 'tr.category_id')}
           and ${clientSql(tx, scope)}`;
      if (!task) return null;

      const comments = await tx`
        select c.id::text as id, c.body, c.from_client
          from ideworks.task_comments c
         where c.task_id = ${id}::uuid
         order by c.created_at, c.id`;

      // F42, Fase 7 — as rodadas de aprovação do cliente. A política
      // `approval_rounds_select` já recorta pelo alcance ao card e ao cliente.
      // NADA do link do cliente sai daqui (nem hash, nem cifrado, nem token):
      // só o que a equipe enviou e o que o cliente respondeu.
      const rodadas = await tx`
        select r.id::text as id, r.version, r.state::text as state, r.sent_at,
               r.decided_at, r.decided_via::text as decided_via, r.closed_at,
               r.decision_comment_id::text as decision_comment_id
          from ideworks.approval_rounds r
         where r.task_id = ${id}::uuid
         order by r.version desc`;
      const idsDasRodadas = rodadas.map((r) => r.id as string);
      const itensDasRodadas =
        idsDasRodadas.length === 0
          ? []
          : await tx`
              select i.id::text as id, i.round_id::text as round_id, i.position,
                     i.kind::text as kind, i.file_name, i.dropbox_url,
                     (i.storage_path is not null) as is_attachment
                from ideworks.approval_round_items i
               where i.round_id = any(${idsDasRodadas}::uuid[])
               order by i.round_id, i.position`;
      const falasDoCliente =
        idsDasRodadas.length === 0
          ? []
          : await tx`
              select c.id::text as id, c.approval_round_id::text as round_id,
                     c.approval_item_id::text as item_id, c.body, c.created_at
                from ideworks.task_comments c
               where c.task_id = ${id}::uuid
                 and c.from_client
                 and c.approval_round_id = any(${idsDasRodadas}::uuid[])
               order by c.created_at, c.id`;

      // F38, Fase 6.4 — as subtarefas diretas, com o MESMO recorte da mãe
      // (empresa e cliente da conexão, pela regra única do cliente da tarefa):
      // uma filha legada com cliente fora do recorte não aparece. Arquivada
      // fica fora, como a própria mãe arquivada fica. Ordem de criação, a do
      // quadro (`lerFicha`). `total` conta todas antes do teto.
      const filhas = await tx`
        select t.id::text as id, t.title, t.status_id::text as status_id,
               s.name as status_name, (t.completed_at is not null) as completed,
               count(*) over () as total
          from ideworks.tasks t
          ${taskClientJoins(tx, scope)}
          left join ideworks.tree tr on tr.list_id = t.list_id
          left join ideworks.statuses s on s.id = t.status_id
         where t.parent_id = ${id}::uuid
           and t.archived_at is null
           and tr.category_id is not null
           and ${companySql(tx, scope, 'tr.category_id')}
           and ${clientSql(tx, scope)}
         order by t.created_at, lower(t.title), t.id
         limit ${GET_TASK_SUBTASKS_MAX}`;

      // G6 — a ficha inteira. Tudo lido DEPOIS de a tarefa ter passado pelo
      // recorte da concessão (empresa, cliente, omitidas) e por id dela: nada
      // aqui amplia o alcance. A mãe repete o recorte, como as filhas.
      const [etiquetas] = await tx`
        select tl.tags from ideworks.task_labels tl where tl.task_id = ${id}::uuid`;
      const seguidores = await tx`
        select w.user_id::text as id,
               coalesce(ideworks.display_name(w.user_id), '(sem nome)') as name
          from ideworks.task_watchers w
         where w.task_id = ${id}::uuid
         order by ideworks.display_name(w.user_id)`;
      const maes = task.parent_id
        ? await tx`
            select t.id::text as id, t.title
              from ideworks.tasks t
              ${taskClientJoins(tx, scope)}
              left join ideworks.tree tr on tr.list_id = t.list_id
             where t.id = ${task.parent_id as string}::uuid
               and t.archived_at is null
               and tr.category_id is not null
               and ${companySql(tx, scope, 'tr.category_id')}
               and ${clientSql(tx, scope)}`
        : [];
      const listasDePassos = await tx`
        select k.id::text as id, k.name
          from ideworks.task_checklists k
         where k.task_id = ${id}::uuid
         order by k.sort_order, k.created_at
         limit ${GET_TASK_CHECKLISTS_MAX}`;
      const itensDePassos = await tx`
        select i.id::text as id, i.checklist_id::text as checklist_id,
               i.parent_item_id::text as parent_item_id, i.name, i.resolved_at,
               i.assignee_id::text as assignee_id,
               ideworks.display_name(i.assignee_id) as assignee_name,
               count(*) over () as total
          from ideworks.checklist_items i
          join ideworks.task_checklists k on k.id = i.checklist_id
         where k.task_id = ${id}::uuid
         order by k.sort_order, k.created_at, i.sort_order, i.created_at
         limit ${GET_TASK_CHECKLIST_ITEMS_MAX}`;
      const [totalDePassos] = await tx`
        select count(*)::int as total
          from ideworks.checklist_items i
          join ideworks.task_checklists k on k.id = i.checklist_id
         where k.task_id = ${id}::uuid`;
      const ligacoes = await tx`
        select l.id::text as id, l.label, l.url, count(*) over () as total
          from ideworks.task_links l
         where l.task_id = ${id}::uuid
         order by l.sort_order, l.created_at
         limit ${GET_TASK_LINKS_MAX}`;
      const historico = await lerHistoricoNoRecorte(tx, scope, id);

      const canBoard = scope.capabilities.has('boards:read');
      const pessoaDe = (pessoaId: unknown, nome: unknown) =>
        typeof pessoaId === 'string' && pessoaId.length > 0
          ? { id: pessoaId, name: (nome as string | null) ?? '(sem nome)' }
          : null;
      return {
        id: task.id as string,
        title: task.title as string,
        description: (task.description as string | null) ?? null,
        dueOn: dueOn(task.due_on),
        statusId: (task.status_id as string | null) ?? null,
        statusType: statusTypeOf(task.status_type),
        priority: priorityOf(task.priority),
        type: demandTypeOf(task.demand_type),
        startOn: task.start_on === null || task.start_on === undefined ? null : dueOn(task.start_on),
        completedAt: instant(task.completed_at),
        archivedAt: instant(task.archived_at),
        board: named(task.board_id as string | null, task.board_name as string | null, canBoard && task.is_live === true),
        // F31: o cliente de empresa omitida não sai na ficha (a tarefa está no recorte, ele não).
        client:
          task.client_id && !clienteDeEmpresaOmitida(scope)(task.client_company_id)
            ? { id: task.client_id as string, name: (task.client_name as string | null) ?? (task.client_id as string) }
            : null,
        people: peopleOf(task.people),
        comments: comments.map((row) => ({
          id: row.id as string,
          body: (row.body as string) ?? '',
          ...(row.from_client === true ? { fromClient: true } : {}),
        })),
        approvalRounds: rodadas.map((r) => {
          const itens = itensDasRodadas.filter((i) => i.round_id === r.id);
          const posicao = new Map(itens.map((i) => [i.id as string, Number(i.position)]));
          return {
            id: r.id as string,
            version: Number(r.version),
            state: approvalStateOf(r.state),
            sentAt: instant(r.sent_at) ?? new Date(0).toISOString(),
            decidedAt: instant(r.decided_at),
            decidedBy: r.decided_via === 'client_link' ? ('client_link' as const) : null,
            closedAt: instant(r.closed_at),
            items: itens.map((i) => ({
              position: Number(i.position),
              kind: i.kind === 'video' || i.kind === 'image' ? (i.kind as 'video' | 'image') : ('other' as const),
              fileName: (i.file_name as string) ?? '',
              // F42, Fase 9: arte anexada ao card vai como cópia da rodada; o
              // caminho do balde NUNCA sai — só o nome e a origem.
              source: i.is_attachment === true ? ('attachment' as const) : ('dropbox' as const),
              url: i.is_attachment === true ? null : ((i.dropbox_url as string | null) ?? null),
            })),
            clientComments: falasDoCliente
              .filter((c) => c.round_id === r.id)
              .map((c) => ({
                id: c.id as string,
                body: (c.body as string) ?? '',
                createdAt: instant(c.created_at) ?? new Date(0).toISOString(),
                itemPosition: c.item_id ? (posicao.get(c.item_id as string) ?? null) : null,
                decision: c.id === r.decision_comment_id,
              })),
          };
        }),
        subtasks: filhas.map((row) => ({
          id: row.id as string,
          title: (row.title as string) || '(sem título)',
          statusId: (row.status_id as string | null) ?? null,
          statusName: (row.status_name as string | null) || null,
          completed: row.completed === true,
        })),
        subtaskTotal: filhas.length > 0 ? Number(filhas[0].total) : 0,
        tags: ((etiquetas?.tags as Array<Record<string, unknown>> | null) ?? []).map((tag) => ({
          id: tag.id as string,
          name: tag.name as string,
          bgColor: (tag.bg_color as string | null) ?? null,
          fgColor: (tag.fg_color as string | null) ?? null,
        })),
        watchers: seguidores.map((row) => ({ id: row.id as string, name: row.name as string })),
        parent: maes[0] ? { id: maes[0].id as string, title: maes[0].title as string } : null,
        checklists: listasDePassos.map((lista) => ({
          id: lista.id as string,
          name: lista.name as string,
          items: itensDePassos
            .filter((item) => item.checklist_id === lista.id)
            .map((item) => ({
              id: item.id as string,
              name: item.name as string,
              parentItemId: (item.parent_item_id as string | null) ?? null,
              resolvedAt: instant(item.resolved_at),
              assignee: pessoaDe(item.assignee_id, item.assignee_name),
            })),
        })),
        checklistItemTotal: Number(totalDePassos?.total ?? 0),
        links: ligacoes.map((row) => ({
          id: row.id as string,
          label: (row.label as string) ?? '',
          url: (row.url as string) ?? '',
        })),
        linkTotal: ligacoes.length > 0 ? Number(ligacoes[0].total) : 0,
        history: historico,
        createdBy: pessoaDe(task.created_by, task.created_by_name),
        completedBy: pessoaDe(task.completed_by, task.completed_by_name),
        createdVia: (task.via_name as string | null) ?? null,
        createdAt: instant(task.created_at),
        folder: task.folder_id
          ? named(task.folder_id as string, task.folder_name as string | null, canBoard && task.is_live === true)
          : null,
        space: task.space_id
          ? named(task.space_id as string, task.space_name as string | null, canBoard && task.is_live === true)
          : null,
      };
    });
  }

  async getClient(scope: WorkScope, clientId: string): Promise<WorkClientView | null> {
    if (emptyScope(scope)) return null;
    const id = asUuid(clientId);
    if (!id) return null;
    if (scope.clients === 'none') return null;
    if (scope.clients !== 'all' && !scope.clients.has(id)) return null;
    return this.withTx(async (tx) => {
      const [client] = await tx`
        select c.id::text as id, c.name,
               c.category_id::text as company_id, cat.name as company_name,
               c.is_active,
               to_char(c.inactive_at at time zone ${AGENCY_TIMEZONE}, 'YYYY-MM-DD') as cancelled_on,
               -- G5: o cadastro. As colunas de contato e as observações do cliente
               -- NUNCA entram aqui: elas nem são lidas.
               c.urgency::text as urgency,
               c.started_on::text as started_on, c.renews_on::text as renews_on,
               p.id::text as plan_id, p.name as plan_name
          from ideworks.clients c
          join ideworks.client_categories cat on cat.id = c.category_id
          left join ideworks.plans p on p.id = c.plan_id
         where c.id = ${id}::uuid
           and ${companySql(tx, scope, 'c.category_id')}
           and ideworks.integration_allows_client(c.id)`;
      if (!client) return null;

      // F38, Fase 4 — cancelado: só a identificação e o dia do cancelamento.
      // Nem empresa nem listas: isso é a carteira de hoje, e ele não está nela.
      if (client.is_active === false) {
        return {
          id: client.id as string,
          name: client.name as string,
          cancelled: true as const,
          cancelledOn: (client.cancelled_on as string | null) ?? null,
        };
      }

      // F31, Fase 3b — lista em espaço de empresa omitida não aparece no
      // cliente: a mesma regra de `server/client-board-lists.ts` na tela.
      const omitidas = omittedIn(scope.companies);
      const lists = await tx`
        select id::text as id, name, archived,
               space_id::text as space_id, space_name,
               folder_id::text as folder_id, folder_name
          from ideworks.client_board_lists(${id}::uuid)${
            omitidas.length === 0
              ? tx``
              : tx`
         where space_id not in (select s.id from ideworks.spaces s
                                 where s.category_id = any(${arrayOuNulo(omitidas)}::uuid[]))`
          }`;
      const cotas = await tx`
        select q.content_type, q.quantity
          from ideworks.client_quotas q
         where q.client_id = ${id}::uuid
         order by q.content_type`;
      const etiquetas = await tx`
        select t.id::text as id, t.name, t.color
          from ideworks.client_tag_assignments ta
          join ideworks.client_tags t on t.id = ta.tag_id
         where ta.client_id = ${id}::uuid
         order by t.name, t.id`;
      const canBoard = scope.capabilities.has('boards:read');
      return {
        id: client.id as string,
        name: client.name as string,
        company: { id: client.company_id as string, name: client.company_name as string },
        ...clientProfileOf(client, etiquetas),
        quotas: cotas
          .filter((row) => (CONTENT_TYPES as readonly string[]).includes(row.content_type as string))
          .map((row) => ({ type: row.content_type as (typeof CONTENT_TYPES)[number], quantity: Number(row.quantity) })),
        lists: lists.map((row) => ({
          id: row.id as string,
          name: canBoard ? ((row.name as string | null) ?? null) : null,
          archived: row.archived === true,
          space: { id: row.space_id as string, name: canBoard ? ((row.space_name as string | null) ?? null) : null },
          folder: row.folder_id
            ? { id: row.folder_id as string, name: canBoard ? ((row.folder_name as string | null) ?? null) : null }
            : null,
        })),
      };
    });
  }

  /**
   * F26.6 — o cliente, se o recorte da CONCESSÃO o alcança: a mesma porta de
   * `getClient` (lista de clientes do escopo, empresa concedida e
   * `integration_allows_client`). O alcance humano vem do RLS da sessão.
   */
  private async clientInScope(tx: Tx, scope: WorkScope, id: string): Promise<{ id: string; name: string } | null> {
    const [client] = await tx`
      select c.id::text as id, c.name
        from ideworks.clients c
       where c.id = ${id}::uuid
         and ${companySql(tx, scope, 'c.category_id')}
         and ideworks.integration_allows_client(c.id)`;
    return client ? { id: client.id as string, name: client.name as string } : null;
  }

  /** O que as duas leituras de F26.6 recusam sem falar com o banco. */
  private recordsClientId(scope: WorkScope, clientId: string): string | null {
    if (emptyScope(scope)) return null;
    const id = asUuid(clientId);
    if (!id) return null;
    if (scope.clients === 'none') return null;
    if (scope.clients !== 'all' && !scope.clients.has(id)) return null;
    return id;
  }

  async getClientMural(scope: WorkScope, clientId: string): Promise<WorkClientRecordsView<WorkMuralNoteView> | null> {
    const id = this.recordsClientId(scope, clientId);
    if (!id) return null;
    return this.withTx(async (tx) => {
      const client = await this.clientInScope(tx, scope, id);
      if (!client) return null;
      const canPeople = scope.capabilities.has('people:read');
      // O mural de um cliente é pequeno (dezenas de notas): vem inteiro, e a
      // página é cortada em `getClientMuralWork`, pelo mesmo orçamento das outras.
      const rows = await tx`
        select n.id::text as id, n.title, n.content, n.color::text as color,
               n.created_by::text as created_by,
               ideworks.display_name(n.created_by) as author_name,
               n.via_name, n.created_at, n.updated_at
          from ideworks.mural_notes n
         where n.client_id = ${id}::uuid
         order by n.created_at desc, n.id`;
      return {
        client,
        items: rows.map((row) => ({
          id: row.id as string,
          title: (row.title as string | null) ?? null,
          content: (row.content as string) ?? '',
          color: row.color as MuralNoteColor,
          author:
            canPeople && row.created_by
              ? { id: row.created_by as string, name: (row.author_name as string | null) ?? '(sem nome)' }
              : null,
          createdById: (row.created_by as string | null) ?? null,
          viaName: (row.via_name as string | null) ?? null,
          createdAt: instant(row.created_at) ?? new Date(0).toISOString(),
          updatedAt: instant(row.updated_at) ?? new Date(0).toISOString(),
        })),
      };
    });
  }

  async getClientHistory(
    scope: WorkScope,
    clientId: string,
    query?: string,
  ): Promise<WorkClientRecordsView<WorkHistoryEntryView> | null> {
    const id = this.recordsClientId(scope, clientId);
    if (!id) return null;
    return this.withTx(async (tx) => {
      const client = await this.clientInScope(tx, scope, id);
      if (!client) return null;
      const canPeople = scope.capabilities.has('people:read');
      // F37 — busca por palavra-chave, depois do recorte de cliente (o
      // `clientInScope` acima já recusou o que está fora). Sem `like`: é
      // `position(palavra in texto)`, então `%`, `_` e `\` são texto puro e
      // a palavra segue SEMPRE como parâmetro. Várias palavras valem todas.
      const words = query === undefined ? [] : palavrasDaBusca(query);
      const busca =
        words.length === 0
          ? tx``
          : tx`and not exists (
                 select 1 from unnest(${arrayOuNulo(words)}::text[]) as w(p)
                  where position(w.p in translate(lower(concat_ws(chr(10),
                          h.title, h.subtitle, h.body,
                          ${canPeople ? tx`ideworks.display_name(h.led_by)` : tx`null::text`},
                          h.led_by_note, h.via_name,
                          to_char(h.happened_on, 'DD/MM/YYYY'),
                          (select string_agg(d2.file_name, chr(10))
                             from ideworks.history_documents d2 where d2.history_id = h.id))),
                          ${ACENTOS_DE}, ${ACENTOS_PARA})) = 0)`;
      // Documentos: só a contagem. O link assinado é outra porta, fora da F26.
      const rows = await tx`
        select h.id::text as id, h.happened_on::text as happened_on, h.title, h.subtitle, h.body,
               h.led_by::text as led_by, ideworks.display_name(h.led_by) as led_by_name,
               h.led_by_note,
               h.created_by::text as created_by,
               ideworks.display_name(h.created_by) as author_name,
               h.via_name, h.created_at, h.updated_at,
               (select count(*)::int from ideworks.history_documents d
                 where d.history_id = h.id) as document_count
          from ideworks.client_history h
         where h.client_id = ${id}::uuid
           ${busca}
         order by h.happened_on desc, h.created_at desc, h.id`;
      return {
        client,
        items: rows.map((row) => ({
          id: row.id as string,
          happenedOn: dueOn(row.happened_on) ?? '1970-01-01',
          title: (row.title as string) ?? '',
          subtitle: (row.subtitle as string | null) ?? null,
          body: (row.body as string) ?? '',
          ledBy:
            canPeople && row.led_by
              ? { id: row.led_by as string, name: (row.led_by_name as string | null) ?? '(sem nome)' }
              : null,
          ledByNote: (row.led_by_note as string | null) ?? null,
          author:
            canPeople && row.created_by
              ? { id: row.created_by as string, name: (row.author_name as string | null) ?? '(sem nome)' }
              : null,
          createdById: (row.created_by as string | null) ?? null,
          viaName: (row.via_name as string | null) ?? null,
          documentCount: Number(row.document_count ?? 0),
          createdAt: instant(row.created_at) ?? new Date(0).toISOString(),
          updatedAt: instant(row.updated_at) ?? new Date(0).toISOString(),
        })),
      };
    });
  }

  async listComments(scope: WorkScope, taskId: string): Promise<WorkCommentView[] | null> {
    const task = await this.getTask(scope, taskId);
    if (!task) return null;
    const id = asUuid(taskId);
    if (!id) return null;
    return this.withTx(async (tx) => {
      const canPeople = scope.capabilities.has('people:read');
      const rows = await tx`
        select c.id::text as id, c.parent_id::text as parent_id, c.body, c.created_at,
               c.author_id::text as author_id,
               ideworks.display_name(c.author_id) as author_name,
               c.from_client
          from ideworks.task_comments c
         where c.task_id = ${id}::uuid
         order by c.created_at, c.id`;
      return rows.map((row) => ({
        id: row.id as string,
        parentId: (row.parent_id as string | null) ?? null,
        body: (row.body as string) ?? '',
        createdAt: instant(row.created_at) ?? new Date(0).toISOString(),
        author:
          canPeople && row.author_id
            ? { id: row.author_id as string, name: (row.author_name as string | null) ?? '(sem nome)' }
            : null,
        // F42, Fase 7: como no MemoryWorkCatalog — o comentário do cliente vem marcado.
        ...(row.from_client === true ? { fromClient: true } : {}),
      }));
    });
  }

  async listPeople(scope: WorkScope): Promise<readonly WorkPersonView[]> {
    if (emptyScope(scope)) return [];
    return this.withTx((tx) => this.directory(tx, scope));
  }

  /**
   * F38, Fase 6.1 — a janela desce à consulta de tarefas (ordem `lower(título)
   * collate "C", id`), e `counts` vem de uma contagem à parte, com o MESMO
   * recorte e sem janela. F38, Fase 6.2: tarefa de cliente cancelado fica
   * fora das duas (`taskClientNotCancelledSql`).
   */
  async getPersonWork(scope: WorkScope, personId: string, window?: TitleWindow): Promise<WorkPersonWorkView | null> {
    if (emptyScope(scope)) return null;
    const id = asUuid(personId);
    if (!id) return null;
    return this.withTx(async (tx) => {
      const [person] = await this.directory(tx, scope, id);
      if (!person) return null;

      const canBoard = scope.capabilities.has('boards:read');
      const canClient = scope.capabilities.has('clients:read');
      const [contagem] = await tx`
        select count(*)::int as tasks,
               count(*) filter (where t.completed_at is null)::int as open,
               count(*) filter (where t.completed_at is not null)::int as done
          from ideworks.tasks t
          join ideworks.task_assignees a on a.task_id = t.id and a.user_id = ${id}::uuid
          ${taskClientJoins(tx, scope)}
          left join ideworks.tree tr on tr.list_id = t.list_id
         where t.archived_at is null
           and tr.category_id is not null
           and ${companySql(tx, scope, 'tr.category_id')}
           and ${clientSql(tx, scope)}
           and ${taskClientNotCancelledSql(tx)}`;

      const cut = titleWindowCut(window);
      const rows = await tx`
        select t.id::text as id, t.title, t.status_id::text as status_id,
               t.due_on::text as due_on, t.completed_at, t.priority::text as priority,
               t.demand_type::text as demand_type,
               lw.status_name as status_name, lw.status_type::text as status_type,
               t.list_id::text as board_id, tr.list_name as board_name, tr.is_live,
               ${clienteDaTarefaIdSql(tx)}::text as client_id
          from ideworks.tasks t
          join ideworks.task_assignees a on a.task_id = t.id and a.user_id = ${id}::uuid
          ${taskClientJoins(tx, scope)}
          left join ideworks.tree tr on tr.list_id = t.list_id
          left join ideworks.list_workflow lw on lw.list_id = t.list_id and lw.status_id = t.status_id
         where t.archived_at is null
           and tr.category_id is not null
           and ${companySql(tx, scope, 'tr.category_id')}
           and ${clientSql(tx, scope)}
           -- F38, Fase 6.2: tarefa de cliente cancelado não volta (nem na contagem acima).
           and ${taskClientNotCancelledSql(tx)}
           ${titleAfterSql(tx, cut)}
         order by lower(t.title) collate "C", t.id::text collate "C"
         ${titleLimitSql(tx, cut)}`;

      const clientes = await clientNamesOf(tx, scope, rows.map((row) => row.client_id as string | null));
      const tasks: WorkPersonTaskView[] = rows.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        statusId: (row.status_id as string | null) ?? null,
        statusName: (row.status_name as string | null) ?? null,
        statusType: statusTypeOf(row.status_type),
        priority: priorityOf(row.priority),
        type: demandTypeOf(row.demand_type),
        dueOn: dueOn(row.due_on),
        completedAt: instant(row.completed_at),
        board: named(row.board_id as string | null, row.board_name as string | null, canBoard && row.is_live === true),
        client: clientes.oculto(row.client_id as string | null)
          ? null
          : named(row.client_id as string | null, row.client_id ? clientes.nome(row.client_id as string) : null, canClient),
      }));

      const counts = {
        tasks: Number(contagem?.tasks) || 0,
        open: Number(contagem?.open) || 0,
        done: Number(contagem?.done) || 0,
      };
      return { person, counts, tasks };
    });
  }
}

export function createSqlWorkCatalog(env: ServerEnv, actor: Actor): WorkCatalog {
  return new SqlWorkCatalog(env, actor);
}
