/**
 * TAREFAS DE UM ESCOPO — a leitura. Etapa F18A (revisão de 28/09, R09).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO
 *   Lista e Kanban em todas as visões de trabalho, inclusive o panorama geral
 *   do espaço ("AGÊNCIA IDE, tudo junto"). Esta é a parte de DADOS: uma
 *   consulta paginada por espaço, pasta ou lista, que as duas composições
 *   usam — o mesmo universo, as mesmas contagens.
 *
 * O CONTRATO está em `@/board/tarefas-do-escopo`. Aqui mora o SQL.
 *
 * ⚠️ NENHUM `where can_see_...` NESTE ARQUIVO
 *   Mesma regra de `board-trabalho.ts` e `board-pasta.ts`: `tasks`, `lists`,
 *   `folders`, `spaces` e `clients` têm política de linha, avaliada dentro de
 *   `withActor`. A parede da F17.23 (`lists_select`) tira a lista fechada da
 *   junção `tasks → lists`, e com ela as tarefas, as contagens, o menu de
 *   listas e os fluxos. Escrever o alcance aqui seria a dívida 8.1 outra vez.
 *   Um escopo fora do alcance responde 404, igual ao inexistente.
 *
 * UMA VARREDURA SÓ PARA CONTAGEM E PÁGINA
 *   O que custa é a política de `tasks`, linha a linha (F17.50/F17.64). A
 *   consulta principal marca o recorte UMA vez (`marcada`, materializada) e
 *   dela saem as contagens por etapa E a página — a mesma técnica do quadro da
 *   pasta. A página é cortada por CHAVE (cursor), com `limite + 1` para saber
 *   se continua; só as linhas do lote passam pelas junções de exibição
 *   (responsáveis, miniatura, etiquetas).
 *
 * A ORDEM E O CURSOR SÃO OS DE `Minhas tarefas`
 *   `due_on nulls last, priority nulls last, lower(title), id`, com a mesma
 *   condição "depois do cursor" (`depoisDoCursor`). O cursor daqui leva o
 *   ESCOPO em vez da aba: um cursor da pasta A não continua a pasta B.
 *
 * O QUE SÓ A PRIMEIRA PÁGINA LÊ
 *   Os menus (pastas, listas, responsáveis) e os fluxos com as etapas reais.
 *   Os lotes seguintes pagam só a varredura; as contagens voltam a cada lote,
 *   como na AUD06.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { BoardAssigneeOption, Priority, StatusType } from '@/board/board';
import { ACENTOS_DE, ACENTOS_PARA, paraConsulta } from '@/board/filtro';
import {
  type CabecalhoDoEscopo,
  type CatalogoDoEscopo,
  type ContagensDoEscopo,
  type Escopo,
  type FiltroDoEscopo,
  type FluxoDoEscopo,
  LOTE_DO_ESCOPO,
  LOTE_MAXIMO_DO_ESCOPO,
  type LeitorDeParametros,
  type LinhaDoEscopo,
  type ListaDoEscopo,
  type PastaDoEscopo,
  SEM_PASTA,
  type TarefasDoEscopo,
  ehEscopo,
  lerFiltroDoEscopo,
} from '@/board/tarefas-do-escopo';
import { BoardRefused } from '@/server/board';
import { depoisDoCursor, paraWorkRow } from '@/server/board-trabalho';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import { clienteDaTarefaSql } from '@/server/cliente-da-tarefa';
import { type Sql, type Tx, inlineUuid, inlineUuidList, withActor } from '@/server/db';
import { recorteDasOmitidas, tarefaForaDasOmitidas } from '@/server/omitidas';
import {
  type ChaveDeOrdem,
  deBase64url,
  paraBase64url,
} from '@/server/paginacao-do-trabalho';
import { lerResponsaveisDoQuadro } from '@/server/responsaveis-do-quadro';
import { type AuthenticatedActor, asDbActor } from '@/server/session';
import type postgres from 'postgres';

type Trecho = postgres.PendingQuery<postgres.Row[]>;

const comoNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4,}-\d{2}-\d{2}$/;
const PRIORIDADES: readonly Priority[] = ['urgent', 'high', 'normal', 'low'];

/** A chave de `statusCounts` para "sem etapa". Não colide com uuid. */
export const SEM_ETAPA = '-';

/* ───────────────────────────── o cursor ───────────────────────────── */

export const VERSAO_DO_CURSOR_DO_ESCOPO = 1;

export type CursorDoEscopo = ChaveDeOrdem & {
  v: typeof VERSAO_DO_CURSOR_DO_ESCOPO;
  escopo: Escopo;
  /** O id do escopo — o cursor da pasta A não continua a pasta B. */
  alvo: string;
};

export function codificarCursorDoEscopo(c: CursorDoEscopo): string {
  return paraBase64url(JSON.stringify(c));
}

export function decodificarCursorDoEscopo(texto: string): CursorDoEscopo | null {
  const json = deBase64url(texto);
  if (json === null) return null;
  let cru: unknown;
  try {
    cru = JSON.parse(json);
  } catch {
    return null;
  }
  if (cru === null || typeof cru !== 'object' || Array.isArray(cru)) return null;
  const c = cru as Record<string, unknown>;
  if (c.v !== VERSAO_DO_CURSOR_DO_ESCOPO) return null;
  if (!ehEscopo(c.escopo)) return null;
  if (typeof c.alvo !== 'string' || !UUID.test(c.alvo)) return null;
  if (!(c.dueOn === null || (typeof c.dueOn === 'string' && DATA.test(c.dueOn)))) return null;
  if (!(c.priority === null || PRIORIDADES.includes(c.priority as Priority))) return null;
  if (typeof c.title !== 'string') return null;
  if (typeof c.id !== 'string' || !UUID.test(c.id)) return null;
  return {
    v: VERSAO_DO_CURSOR_DO_ESCOPO,
    escopo: c.escopo,
    alvo: c.alvo.toLowerCase(),
    dueOn: c.dueOn,
    priority: c.priority as Priority | null,
    title: c.title,
    id: c.id,
  };
}

/* ───────────────────────────── o pedido ───────────────────────────── */

export type PedidoInternoDoEscopo = {
  escopo: Escopo;
  id: string;
  filtro: FiltroDoEscopo;
  cursor: CursorDoEscopo | null;
  /** Já preso entre 1 e `LOTE_MAXIMO_DO_ESCOPO`. */
  limite: number;
};

export type PedidoDoEscopoLido =
  | { ok: true; pedido: PedidoInternoDoEscopo }
  | { ok: false; status: 400; message: string };

/** Tolerante, como `per-column`: torto cai no padrão, acima do teto vira o teto. */
export function lerLimiteDoEscopo(texto: string | null): number {
  if (texto === null || texto.trim() === '') return LOTE_DO_ESCOPO;
  const n = Number(texto);
  if (!Number.isFinite(n) || n < 1) return LOTE_DO_ESCOPO;
  return Math.min(LOTE_MAXIMO_DO_ESCOPO, Math.floor(n));
}

/**
 * Lê o endereço e decide. ESTRITO no que muda o universo — escopo, id e
 * cursor viram 400 antes de qualquer consulta —; TOLERANTE nos filtros, que
 * só estreitam (ver `lerFiltroDoEscopo`).
 */
export function lerPedidoDoEscopo(p: LeitorDeParametros): PedidoDoEscopoLido {
  const escopo = (p.get('escopo') ?? '').trim().toLowerCase();
  if (!ehEscopo(escopo)) {
    return { ok: false, status: 400, message: 'Escopo desconhecido. Use espaco, pasta ou lista.' };
  }
  const id = (p.get('id') ?? '').trim().toLowerCase();
  if (!UUID.test(id)) {
    return { ok: false, status: 400, message: 'Informe o identificador do espaço, da pasta ou da lista.' };
  }
  let cursor: CursorDoEscopo | null = null;
  const cru = p.get('cursor');
  if (cru !== null && cru !== '') {
    cursor = decodificarCursorDoEscopo(cru);
    if (cursor === null) {
      return {
        ok: false,
        status: 400,
        message: 'Não deu para continuar a leitura de onde parou. Recarregue a lista.',
      };
    }
    if (cursor.escopo !== escopo || cursor.alvo !== id) {
      return {
        ok: false,
        status: 400,
        message: 'Esse ponto de continuação é de outra visão. Recarregue a lista.',
      };
    }
  }
  return {
    ok: true,
    pedido: {
      escopo,
      id,
      filtro: lerFiltroDoEscopo(p),
      cursor,
      limite: lerLimiteDoEscopo(p.get('limite')),
    },
  };
}

/* ───────────────────────────── os pedaços de SQL ─────────────────────────────
   Síncronos de propósito: fragmento não se espera (nota de board-trabalho.ts).
   Todos falam de `l` (lists), `f` (folders da lista) e `t` (tasks). */

/**
 * O universo do escopo, sobre `l` e `f`.
 *
 * Espaço e pasta: só listas vivas (e, no espaço, fora de pasta arquivada) —
 * a mesma decisão do quadro da pasta: juntar o arquivado ao que anda faria a
 * contagem mentir. Listas SEM pasta entram no espaço (`f` nulo).
 * Lista: a lista pedida, mesmo arquivada — abrir o que se pediu pelo nome.
 */
export function universoDoEscopo(tx: Tx, escopo: Escopo, id: string): Trecho {
  // O id vai no TEXTO (`inlineUuid`): sem parâmetro, as leituras do catálogo do
  // escopo saem juntas na mesma ida. Fora do formato UUID segue como parâmetro.
  const alvo = inlineUuid(tx, id);
  if (escopo === 'espaco') {
    return tx`(l.space_id = ${alvo}::uuid
               and l.archived_at is null
               and (l.folder_id is null or f.archived_at is null))`;
  }
  if (escopo === 'pasta') {
    return tx`(l.folder_id = ${alvo}::uuid and l.archived_at is null)`;
  }
  return tx`(l.id = ${alvo}::uuid)`;
}

/** O filtro de lista/pasta, que vale também para os fluxos do Kanban. */
export function filtroDeListas(tx: Tx, f: FiltroDoEscopo): Trecho {
  const pasta =
    f.pasta === null
      ? tx`true`
      : f.pasta === SEM_PASTA
        ? tx`l.folder_id is null`
        : tx`l.folder_id = ${f.pasta}::uuid`;
  const lista = f.lista === null ? tx`true` : tx`l.id = ${f.lista}::uuid`;
  return tx`(${pasta} and ${lista})`;
}

/** Hoje no fuso da agência — no banco, para a data não depender do Worker. */
const hoje = (tx: Tx): Trecho => tx`((now() at time zone ${AGENCY_TIMEZONE}::text)::date)`;

export function filtroDePrazo(tx: Tx, f: FiltroDoEscopo): Trecho {
  switch (f.prazo) {
    case 'atrasado':
      return tx`(t.due_on < ${hoje(tx)} and t.completed_at is null)`;
    case 'hoje':
      return tx`(t.due_on = ${hoje(tx)})`;
    case 'semana':
      return tx`(t.due_on between ${hoje(tx)} and ${hoje(tx)} + 6)`;
    case 'sem':
      return tx`(t.due_on is null)`;
    default:
      return tx`true`;
  }
}

/**
 * A PENEIRA inteira — o `bate` de cada tarefa. Só entra o que está ligado:
 * sem filtro, é `true` e o resultado é o universo.
 *
 * Busca e responsável: as MESMAS expressões da F17.55 (acento tirado dos dois
 * lados pela mesma tabela, passada como parâmetro).
 */
export function peneiraDoEscopo(tx: Tx, f: FiltroDoEscopo): Trecho {
  const p = paraConsulta(f);
  const partes: Trecho[] = [filtroDeListas(tx, f)];
  if (p.texto !== null) {
    partes.push(tx`position(${p.texto}::text
                            in translate(lower(t.title), ${ACENTOS_DE}, ${ACENTOS_PARA})) > 0`);
  }
  if (p.semResponsavel) {
    partes.push(tx`not exists (select 1 from ideworks.task_assignees a where a.task_id = t.id)`);
  }
  if (p.responsavel !== null) {
    partes.push(tx`exists (select 1 from ideworks.task_assignees a
                            where a.task_id = t.id and a.user_id = ${p.responsavel}::uuid)`);
  }
  if (f.etapa !== null) partes.push(tx`t.status_id = ${f.etapa}::uuid`);
  if (!f.concluidas) partes.push(tx`t.completed_at is null`);
  if (f.prazo !== null) partes.push(filtroDePrazo(tx, f));
  return partes.reduce((acc, parte) => tx`${acc} and ${parte}`);
}

/* ───────────────────────────── a montagem pura ───────────────────────────── */

type ParDeContagem = { total: number; abertas: number; matched: number };

/** O mapa por etapa → as contagens do recorte. Pura, com teste. */
export function contagensDoMapa(mapa: Record<string, Partial<ParDeContagem>>): {
  counts: ContagensDoEscopo;
  statusCounts: Record<string, { total: number; matched: number }>;
} {
  const counts: ContagensDoEscopo = { total: 0, abertas: 0, matched: 0, semEtapa: 0 };
  const statusCounts: Record<string, { total: number; matched: number }> = {};
  for (const [chave, par] of Object.entries(mapa)) {
    const total = comoNumero(par?.total);
    const matched = comoNumero(par?.matched);
    counts.total += total;
    counts.abertas += comoNumero(par?.abertas);
    counts.matched += matched;
    if (chave === SEM_ETAPA) counts.semEtapa += matched;
    else statusCounts[chave] = { total, matched };
  }
  return { counts, statusCounts };
}

export type EtapaLida = {
  id: string;
  name: string;
  type: StatusType;
  color: string | null;
  sortOrder: number;
  workflowId: string;
  workflowName: string;
};

/**
 * Os fluxos do Kanban — pura, com teste.
 *
 * Um fluxo entra se alguma lista do recorte FILTRADO o usa, ou se alguma
 * tarefa do escopo está numa etapa dele (status fora da esteira atual da
 * lista continua tendo coluna — some-la esconderia trabalho). As etapas
 * guardam o id REAL e a ordem da esteira; nada é mesclado por nome.
 */
export function montarFluxos(
  listas: readonly Pick<ListaDoEscopo, 'id' | 'folderId' | 'workflowId'>[],
  etapas: readonly EtapaLida[],
  statusCounts: Record<string, { total: number; matched: number }>,
  filtro: Pick<FiltroDoEscopo, 'pasta' | 'lista'>,
): FluxoDoEscopo[] {
  const passa = (l: Pick<ListaDoEscopo, 'id' | 'folderId'>) =>
    (filtro.lista === null || l.id === filtro.lista) &&
    (filtro.pasta === null ||
      (filtro.pasta === SEM_PASTA ? l.folderId === null : l.folderId === filtro.pasta));

  const listasPorFluxo = new Map<string, number>();
  for (const l of listas) {
    if (l.workflowId === null || !passa(l)) continue;
    listasPorFluxo.set(l.workflowId, (listasPorFluxo.get(l.workflowId) ?? 0) + 1);
  }
  const comTarefa = new Set(
    etapas.filter((e) => (statusCounts[e.id]?.total ?? 0) > 0).map((e) => e.workflowId),
  );

  const fluxos = new Map<string, FluxoDoEscopo>();
  for (const e of etapas) {
    if (!listasPorFluxo.has(e.workflowId) && !comTarefa.has(e.workflowId)) continue;
    let fluxo = fluxos.get(e.workflowId);
    if (!fluxo) {
      fluxo = {
        id: e.workflowId,
        name: e.workflowName,
        lists: listasPorFluxo.get(e.workflowId) ?? 0,
        etapas: [],
      };
      fluxos.set(e.workflowId, fluxo);
    }
    fluxo.etapas.push({
      id: e.id,
      name: e.name,
      type: e.type,
      color: e.color,
      sortOrder: e.sortOrder,
      total: statusCounts[e.id]?.total ?? 0,
      matched: statusCounts[e.id]?.matched ?? 0,
    });
  }
  const saida = [...fluxos.values()];
  for (const f of saida) f.etapas.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  // Mais listas primeiro (o fluxo "da casa"), depois pelo nome, e o id desempata.
  saida.sort(
    (a, b) =>
      b.lists - a.lists ||
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id),
  );
  return saida;
}

/* ───────────────────────────── a leitura ───────────────────────────── */

async function lerCabecalho(
  tx: Tx,
  actor: AuthenticatedActor,
  escopo: Escopo,
  id: string,
): Promise<CabecalhoDoEscopo> {
  // F31: espaço de empresa omitida responde como inexistente.
  const omitida = recorteDasOmitidas(
    tx,
    actor,
    (ids) => tx`and (s.category_id is null or not (s.category_id = any(${inlineUuidList(tx, ids)}::uuid[])))`,
  );
  const [r] =
    escopo === 'espaco'
      ? await tx`
          select s.id as space_id, s.name as space_name,
                 null::uuid as folder_id, null::text as folder_name,
                 null::uuid as list_id, null::text as list_name,
                 (s.archived_at is not null) as archived
            from ideworks.spaces s
           where s.id = ${inlineUuid(tx, id)}::uuid ${omitida}`
      : escopo === 'pasta'
        ? await tx`
            select s.id as space_id, s.name as space_name,
                   f.id as folder_id, f.name as folder_name,
                   null::uuid as list_id, null::text as list_name,
                   (f.archived_at is not null or s.archived_at is not null) as archived
              from ideworks.folders f
              join ideworks.spaces s on s.id = f.space_id
             where f.id = ${inlineUuid(tx, id)}::uuid ${omitida}`
        : await tx`
            select s.id as space_id, s.name as space_name,
                   f.id as folder_id, f.name as folder_name,
                   l.id as list_id, l.name as list_name,
                   (l.archived_at is not null or f.archived_at is not null
                    or s.archived_at is not null) as archived
              from ideworks.lists l
              join ideworks.spaces s on s.id = l.space_id
              left join ideworks.folders f on f.id = l.folder_id
             where l.id = ${inlineUuid(tx, id)}::uuid ${omitida}`;

  // Fora do alcance e inexistente respondem igual (mesma recusa do quadro).
  if (!r) {
    const nome = escopo === 'espaco' ? 'Espaço' : escopo === 'pasta' ? 'Pasta' : 'Lista';
    throw new BoardRefused(`${nome} não encontrad${escopo === 'espaco' ? 'o' : 'a'}, ou fora do seu alcance.`, 404);
  }
  return {
    spaceId: r.space_id as string,
    spaceName: r.space_name as string,
    folderId: (r.folder_id as string | null) ?? null,
    folderName: (r.folder_name as string | null) ?? null,
    listId: (r.list_id as string | null) ?? null,
    listName: (r.list_name as string | null) ?? null,
    archived: r.archived === true,
  };
}

/**
 * A varredura: contagens por etapa E a página, numa instrução só.
 *
 * `contagem left join pagina on true` garante uma linha mesmo com a página
 * vazia — a busca que não achou nada ainda diz `0 de 133`.
 */
async function lerPaginaEContagens(
  tx: Tx,
  actor: AuthenticatedActor,
  pedido: PedidoInternoDoEscopo,
): Promise<{ rows: postgres.Row[]; mapa: Record<string, Partial<ParDeContagem>> }> {
  const eu = actor.userId;
  const linhas = await tx`
    with marcada as materialized (
      select t.id, t.title, t.status_id, t.priority, t.due_on, t.completed_at,
             (${peneiraDoEscopo(tx, pedido.filtro)}) as bate
        from ideworks.tasks t
        join ideworks.lists l on l.id = t.list_id
        left join ideworks.folders f on f.id = l.folder_id
       where ${universoDoEscopo(tx, pedido.escopo, pedido.id)}
         and t.archived_at is null
         ${tarefaForaDasOmitidas(tx, actor)}
    ), contagem as (
      select coalesce(
               jsonb_object_agg(
                 coalesce(status_id::text, ${SEM_ETAPA}),
                 jsonb_build_object('total', total, 'abertas', abertas, 'matched', achadas)),
               '{}'::jsonb) as mapa
        from (select status_id,
                     count(*)::int                                   as total,
                     count(*) filter (where completed_at is null)::int as abertas,
                     count(*) filter (where bate)::int               as achadas
                from marcada
               group by status_id) por_etapa
    ), pagina as (
      select t.id, lower(t.title) as sort_title
        from marcada t
       where t.bate
         and ${pedido.cursor ? depoisDoCursor(tx, pedido.cursor) : tx`true`}
       order by t.due_on nulls last, t.priority nulls last, lower(t.title), t.id
       limit ${pedido.limite + 1}
    )
    select c.mapa,
           t.id, t.title, t.status_id, t.priority,
           t.due_on::text   as due_on,
           t.start_on::text as start_on,
           t.completed_at,
           p.sort_title,
           (t.description is not null and btrim(t.description) <> '') as has_description,
           -- O cliente VISÍVEL, pela regra única da F38 (Fase 6): o da tarefa,
           -- e na falta dele o da lista. A política de clients recorta a
           -- junção; fora do alcance, nulo.
           cl.id as client_id, cl.name as client_name,
           t.parent_id, pai.title as parent_title,
           tl.task_type_name,
           t.demand_type::text as demand_type,
           coalesce(tl.tags, '[]'::jsonb) as tags,
           coalesce(tp.subtask_count, 0)    as subtask_count,
           coalesce(tp.checklist_done, 0)   as checklist_done,
           coalesce(tp.checklist_total, 0)  as checklist_total,
           coalesce(tp.attachment_count, 0) as attachment_count,
           coalesce(tp.comment_count, 0)    as comment_count,
           st.name  as status_name,
           st.type  as status_type,
           st.color as status_color,
           st.sort_order as status_sort_order,
           ss.id    as workflow_id,
           ss.name  as workflow_name,
           l.id as list_id, l.name as list_name, l.folder_id,
           fo.name as folder_name,
           s.id as space_id, s.name as space_name,
           (s.archived_at is null
            and (fo.id is null or fo.archived_at is null)
            and l.archived_at is null) as list_live,
           cat.name as category_name,
           coalesce(
             (select json_agg(json_build_object(
                        'id', a.user_id,
                        'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                      order by ideworks.display_name(a.user_id))
                from ideworks.task_assignees a
               where a.task_id = t.id),
             '[]'::json
           ) as assignees,
           img.attachment_id            as preview_attachment_id,
           coalesce(img.image_count, 0) as preview_count,
           exists (select 1 from ideworks.task_assignees a
                    where a.task_id = t.id and a.user_id = ${eu}) as assigned_to_me,
           coalesce(t.created_by = ${eu}, false) as created_by_me,
           (select count(*)::int from ideworks.task_assignees a
             where a.task_id = t.id and a.user_id <> ${eu}) as other_assignees
      from contagem c
      left join pagina p on true
      left join ideworks.tasks t on t.id = p.id
      left join ideworks.lists l on l.id = t.list_id
      left join ideworks.folders fo on fo.id = l.folder_id
      left join ideworks.spaces s on s.id = l.space_id
      left join ideworks.client_categories cat on cat.id = s.category_id
      left join ideworks.statuses st on st.id = t.status_id
      left join ideworks.status_sets ss on ss.id = st.status_set_id
      left join ideworks.clients cl on cl.id = ${clienteDaTarefaSql(tx)}
      left join ideworks.task_labels tl on tl.task_id = t.id
      left join ideworks.task_progress tp on tp.task_id = t.id
      left join ideworks.tasks pai on pai.id = t.parent_id
      -- A miniatura: a MESMA regra do quadro e de Todas as tarefas, e aqui ela
      -- roda só sobre o lote (no maximo limite + 1 linhas).
      left join lateral (
        select (array_agg(a.id order by
                 (position('attachment:' || a.id::text in coalesce(t.description, '')) > 0) desc,
                 nullif(position('attachment:' || a.id::text in coalesce(t.description, '')), 0),
                 a.created_at, a.id))[1] as attachment_id,
               count(*)::int                                    as image_count
          from ideworks.task_attachments a
         where a.task_id = t.id
           and a.content_type like 'image/%'
           and (a.expires_at is null or a.expires_at > now())
           and (a.expires_at is null or position('attachment:' || a.id::text in coalesce(t.description, '')) > 0)
      ) img on true
     order by t.due_on nulls last, t.priority nulls last, p.sort_title, t.id`;

  const mapa = (linhas[0]?.mapa as Record<string, Partial<ParDeContagem>> | undefined) ?? {};
  return { rows: linhas.filter((r) => r.id !== null && r.id !== undefined), mapa };
}

function paraLinhaDoEscopo(r: postgres.Row): LinhaDoEscopo {
  return {
    ...paraWorkRow(r),
    spaceId: r.space_id as string,
    folderId: (r.folder_id as string | null) ?? null,
    workflowId: (r.workflow_id as string | null) ?? null,
    workflowName: (r.workflow_name as string | null) ?? null,
    statusSortOrder:
      r.status_sort_order === null || r.status_sort_order === undefined
        ? null
        : comoNumero(r.status_sort_order),
  };
}

/**
 * As listas do escopo, SEM os filtros de pasta/lista — o menu mostra todas.
 * A esteira de cada uma sai de `resolve_status_set`, a mesma regra de herança
 * (lista → pasta → espaço) de `list_workflow`.
 *
 * Separada de `lerCatalogo` (perf do servidor, 08/10/2026) porque só depende do
 * escopo pedido, e não da página: sai na MESMA ida que o cabeçalho.
 */
async function lerListasDoCatalogo(tx: Tx, pedido: PedidoInternoDoEscopo) {
  return tx`
    select l.id, l.name, l.folder_id, f.name as folder_name,
           (l.archived_at is not null or f.archived_at is not null) as archived,
           cl.id as client_id, cl.name as client_name,
           ideworks.resolve_status_set(l.id) as workflow_id
      from ideworks.lists l
      left join ideworks.folders f on f.id = l.folder_id
      left join ideworks.clients cl on cl.id = l.client_id
     where ${universoDoEscopo(tx, pedido.escopo, pedido.id)}
     order by f.sort_order nulls first, lower(btrim(f.name)) nulls first,
              l.sort_order, lower(btrim(l.name)), l.id`;
}

/** Quem o menu de responsáveis oferece neste escopo — também só depende do escopo. */
async function lerResponsaveisDoCatalogo(tx: Tx, actor: AuthenticatedActor, pedido: PedidoInternoDoEscopo) {
  return lerResponsaveisDoQuadro(
    tx,
    tx`
      select distinct a.task_id, a.user_id
        from ideworks.task_assignees a
        join ideworks.tasks t on t.id = a.task_id
        join ideworks.lists l on l.id = t.list_id
        left join ideworks.folders f on f.id = l.folder_id
       where ${universoDoEscopo(tx, pedido.escopo, pedido.id)}
         and t.archived_at is null
         ${tarefaForaDasOmitidas(tx, actor)}`,
  );
}

type CatalogoPrevio = {
  listasLidas: Awaited<ReturnType<typeof lerListasDoCatalogo>>;
  responsaveis: Awaited<ReturnType<typeof lerResponsaveisDoCatalogo>>;
};

async function lerCatalogo(
  tx: Tx,
  pedido: PedidoInternoDoEscopo,
  header: CabecalhoDoEscopo,
  statusCounts: Record<string, { total: number; matched: number }>,
  total: number,
  previo: CatalogoPrevio,
): Promise<CatalogoDoEscopo> {
  const { listasLidas, responsaveis } = previo;

  const listas: ListaDoEscopo[] = listasLidas.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    folderId: (r.folder_id as string | null) ?? null,
    folderName: (r.folder_name as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    clientName: (r.client_name as string | null) ?? null,
    archived: r.archived === true,
    workflowId: (r.workflow_id as string | null) ?? null,
  }));

  /* As etapas: dos fluxos que as listas usam E dos fluxos das etapas onde há
     tarefa. Conjunto inteiro, com a ordem da esteira. As pastas e as etapas não
     dependem uma da outra: saem na mesma ida. */
  const fluxosDasListas = [...new Set(listas.map((l) => l.workflowId).filter((x): x is string => x !== null))];
  const etapasComTarefa = Object.keys(statusCounts);
  const [pastasLidas, etapasLidas] = await Promise.all([
    pedido.escopo === 'espaco'
      ? tx`
          select f.id, f.name, (f.archived_at is not null) as archived
            from ideworks.folders f
           where f.space_id = ${inlineUuid(tx, header.spaceId)}::uuid
             and f.archived_at is null
           order by f.sort_order, lower(btrim(f.name)), f.id`
      : Promise.resolve([]),
    tx`
    select st.id, st.name, st.type::text as type, st.color, st.sort_order,
           ss.id as workflow_id, ss.name as workflow_name
      from ideworks.statuses st
      join ideworks.status_sets ss on ss.id = st.status_set_id
     where ss.id = any(${inlineUuidList(tx, fluxosDasListas)}::uuid[])
        or ss.id in (select x.status_set_id from ideworks.statuses x
                      where x.id = any(${inlineUuidList(tx, etapasComTarefa)}::uuid[]))`,
  ]);
  const pastas: PastaDoEscopo[] = pastasLidas.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    archived: r.archived === true,
  }));
  const etapas: EtapaLida[] = etapasLidas.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    type: r.type as StatusType,
    color: (r.color as string | null) ?? null,
    sortOrder: comoNumero(r.sort_order),
    workflowId: r.workflow_id as string,
    workflowName: r.workflow_name as string,
  }));

  const assigneeOptions: BoardAssigneeOption[] = responsaveis.opcoes;

  return {
    pastas,
    listas,
    fluxos: montarFluxos(listas, etapas, statusCounts, pedido.filtro),
    assigneeOptions,
    // Nunca negativo: duas instruções, e uma escrita entre elas.
    unassignedTasks: Math.max(total - responsaveis.comDono, 0),
  };
}

/**
 * Uma página das tarefas de um escopo — F18A.
 *
 * QUEM LÊ VEM DO ATOR, E SÓ DELE. O pedido traz escopo, filtros, cursor e
 * lote; nada disso entra em identidade. Um cursor forjado, no pior caso,
 * começa a página em outro ponto do MESMO recorte do MESMO alcance.
 */
export async function readScopeTasks(
  sql: Sql,
  actor: AuthenticatedActor,
  pedido: PedidoInternoDoEscopo,
): Promise<TarefasDoEscopo> {
  return withActor(sql, asDbActor(actor), (tx) => lerTarefasDoEscopo(tx, actor, pedido));
}

/**
 * O miolo, dentro de uma transação já aberta com o ator declarado. Separado
 * para a prova de banco (`scripts/provar-tarefas-do-escopo.mjs`) rodar a
 * MESMA leitura numa transação SOMENTE LEITURA.
 */
export async function lerTarefasDoEscopo(
  tx: Tx,
  actor: AuthenticatedActor,
  pedido: PedidoInternoDoEscopo,
): Promise<TarefasDoEscopo> {
  // O CABEÇALHO E O QUE SÓ DEPENDE DO ESCOPO SAEM NA MESMA IDA — perf do servidor,
  // 08/10/2026. Eram seis a sete consultas em fila, cada uma com o id do escopo
  // como parâmetro. Com o id no texto, o cabeçalho, as listas e os responsáveis
  // (estes dois só na primeira página, a que leva o catálogo) saem juntos; a
  // página dos cartões, que leva os filtros como parâmetro, vem depois; e as
  // pastas e as etapas, que precisam do cabeçalho e das contagens, fecham numa
  // terceira ida. Escopo inexistente ou fora do alcance recusa na primeira.
  const comCatalogo = pedido.cursor === null;
  const [header, listasLidas, responsaveis] = await Promise.all([
    lerCabecalho(tx, actor, pedido.escopo, pedido.id),
    comCatalogo ? lerListasDoCatalogo(tx, pedido) : Promise.resolve(null),
    comCatalogo ? lerResponsaveisDoCatalogo(tx, actor, pedido) : Promise.resolve(null),
  ]);
  const { rows: cruas, mapa } = await lerPaginaEContagens(tx, actor, pedido);
  const { counts, statusCounts } = contagensDoMapa(mapa);

  const hasMore = cruas.length > pedido.limite;
  const lote = hasMore ? cruas.slice(0, pedido.limite) : cruas;
  const ultima = lote.at(-1);
  const nextCursor =
    hasMore && ultima
      ? codificarCursorDoEscopo({
          v: VERSAO_DO_CURSOR_DO_ESCOPO,
          escopo: pedido.escopo,
          alvo: pedido.id,
          dueOn: (ultima.due_on as string | null) ?? null,
          priority: (ultima.priority as Priority | null) ?? null,
          // `lower()` do BANCO, e não toLowerCase(): ver paginacao-do-trabalho.
          title: (ultima.sort_title as string | null) ?? '',
          id: ultima.id as string,
        })
      : null;

  const resposta: TarefasDoEscopo = {
    escopo: pedido.escopo,
    id: pedido.id,
    header,
    filter: pedido.filtro,
    rows: lote.map(paraLinhaDoEscopo),
    returned: lote.length,
    hasMore,
    nextCursor,
    counts,
    statusCounts,
  };
  if (listasLidas !== null && responsaveis !== null) {
    resposta.catalog = await lerCatalogo(tx, pedido, header, statusCounts, counts.total, {
      listasLidas,
      responsaveis,
    });
  }
  return resposta;
}
