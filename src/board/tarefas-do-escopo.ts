/**
 * TAREFAS DE UM ESCOPO — espaço, pasta ou lista. Etapa F18A (revisão de
 * 28/09, R09: "escolher Lista ou Kanban em todas as visões de trabalho").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO É
 *   O CONTRATO entre a tela e o servidor, e mais nada: o que o endereço carrega
 *   (escopo, filtros, cursor, lote), como ele se lê de forma tolerante, e a
 *   forma da resposta. Não fala com banco nem com rede — é puro, como
 *   `@/board/filtro`, e por isso a tela e a rota não conseguem discordar sobre
 *   o que `prazo=atrasado` significa.
 *
 * POR QUE UMA CONSULTA NOVA, E NÃO `Todas as tarefas` COM MAIS UM PARÂMETRO
 *   Levantamento da F18A (ver `06-acompanhamento.md`): nenhuma rota filtrava
 *   por espaço. `GET /board/all-tasks` tem teto de 500 sem cursor; o quadro da
 *   pasta agrupa etapas por NOME (a R09 pede o contrário: etapa real, por
 *   fluxo); o quadro da lista é de uma lista só. A consulta nova mora em
 *   `@/server/tarefas-do-escopo` e REAPROVEITA as peças que já existem — a
 *   peneira de `@/board/filtro`, a condição "depois do cursor" e o formato de
 *   linha de `Todas as tarefas` (`WorkRow`), o recorte das empresas omitidas e
 *   o censo de responsáveis do quadro.
 *
 * ⚠️ O ALCANCE NÃO MORA AQUI
 *   Nenhum parâmetro deste contrato diz QUEM lê. A política de linha decide o
 *   que volta — linhas E contagens. Um `id` de escopo fora do alcance responde
 *   404, igual ao inexistente.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { BoardAssigneeOption, StatusType } from '@/board/board';
import { type FiltroDeTarefas, SEM_FILTRO, lerFiltro, paraEndereco } from '@/board/filtro';
import type { WorkRow } from '@/board/meu-trabalho';

/* ───────────────────────────── o escopo ───────────────────────────── */

/** Onde se olha. O espaço é o panorama geral ("AGÊNCIA IDE, tudo junto"). */
export type Escopo = 'espaco' | 'pasta' | 'lista';

export const ESCOPOS: readonly Escopo[] = ['espaco', 'pasta', 'lista'] as const;

export const ehEscopo = (v: unknown): v is Escopo =>
  typeof v === 'string' && (ESCOPOS as readonly string[]).includes(v);

/* ───────────────────────────── os filtros ───────────────────────────── */

/**
 * O recorte do prazo. Sempre relativo ao dia de hoje NO FUSO DA AGÊNCIA — o
 * servidor calcula; a tela não manda data.
 *
 *   atrasado → prazo antes de hoje E não concluída (concluída não atrasa,
 *              mesma regra de `dueState`)
 *   hoje     → prazo hoje
 *   semana   → prazo de hoje a hoje + 6
 *   sem      → sem prazo
 */
export type Prazo = 'atrasado' | 'hoje' | 'semana' | 'sem';

export const PRAZOS: readonly Prazo[] = ['atrasado', 'hoje', 'semana', 'sem'] as const;

const ehPrazo = (v: unknown): v is Prazo =>
  typeof v === 'string' && (PRAZOS as readonly string[]).includes(v);

/** O valor de `pasta` que quer dizer "as listas soltas no espaço". */
export const SEM_PASTA = 'sem';

export type FiltroDoEscopo = FiltroDeTarefas & {
  /** Um id de pasta, `SEM_PASTA` (listas sem pasta) ou nulo (qualquer). */
  pasta: string | null;
  /** Um id de lista, ou nulo. */
  lista: string | null;
  /** O id REAL de uma etapa (status). Ids são únicos entre fluxos. */
  etapa: string | null;
  prazo: Prazo | null;
  /** Concluídas entram? Padrão: não — a visão de trabalho é do que está aberto. */
  concluidas: boolean;
};

export const SEM_FILTRO_DO_ESCOPO: FiltroDoEscopo = {
  ...SEM_FILTRO,
  pasta: null,
  lista: null,
  etapa: null,
  prazo: null,
  concluidas: false,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const umId = (v: string | null | undefined): string | null => {
  const cru = (v ?? '').trim().toLowerCase();
  return UUID.test(cru) ? cru : null;
};

/** Qualquer coisa com `get`: `URLSearchParams`, ou um objeto de teste. */
export type LeitorDeParametros = { get(chave: string): string | null };

/**
 * O filtro que veio do endereço. TOLERANTE, como `lerFiltro`: o endereço pode
 * ser digitado à mão, e `?prazo=ontem` vira "qualquer prazo", não uma tela
 * quebrada. Só o ESCOPO e o CURSOR são estritos (ver `@/server/tarefas-do-escopo`).
 */
export function lerFiltroDoEscopo(p: LeitorDeParametros): FiltroDoEscopo {
  const pasta = (p.get('pasta') ?? '').trim().toLowerCase();
  const prazo = (p.get('prazo') ?? '').trim().toLowerCase();
  const concluidas = (p.get('concluidas') ?? '').trim().toLowerCase();
  return {
    ...lerFiltro(p.get('busca'), p.get('responsavel')),
    pasta: pasta === SEM_PASTA ? SEM_PASTA : umId(pasta),
    lista: umId(p.get('lista')),
    etapa: umId(p.get('etapa')),
    prazo: ehPrazo(prazo) ? prazo : null,
    concluidas: concluidas === '1' || concluidas === 'sim' || concluidas === 'true',
  };
}

/** O filtro no endereço: só o que está ligado. Mesmo idioma de `paraEndereco`. */
export function paraEnderecoDoEscopo(f: FiltroDoEscopo): Record<string, string> {
  const saida = paraEndereco(f);
  if (f.pasta !== null) saida.pasta = f.pasta;
  if (f.lista !== null) saida.lista = f.lista;
  if (f.etapa !== null) saida.etapa = f.etapa;
  if (f.prazo !== null) saida.prazo = f.prazo;
  if (f.concluidas) saida.concluidas = '1';
  return saida;
}

/* ───────────────────────────── o lote ───────────────────────────── */

/** O lote de partida. Cinquenta linhas cabem na tela e no orçamento. */
export const LOTE_DO_ESCOPO = 50;
/** O teto: pedir mais devolve isto. Nunca há consulta sem limite. */
export const LOTE_MAXIMO_DO_ESCOPO = 100;

export type PedidoDoEscopo = {
  escopo: Escopo;
  id: string;
  filtro?: FiltroDoEscopo;
  /** Opaco: a tela guarda o `nextCursor` que recebeu e devolve. */
  cursor?: string | null;
  limite?: number;
};

/** O endereço da rota `GET /board/scope-tasks`. A tela não monta à mão. */
export function enderecoDoEscopo(pedido: PedidoDoEscopo): string {
  const p = new URLSearchParams({ escopo: pedido.escopo, id: pedido.id });
  for (const [k, v] of Object.entries(paraEnderecoDoEscopo(pedido.filtro ?? SEM_FILTRO_DO_ESCOPO))) {
    p.set(k, v);
  }
  if (pedido.cursor) p.set('cursor', pedido.cursor);
  if (pedido.limite !== undefined) p.set('limite', String(pedido.limite));
  return `/board/scope-tasks?${p.toString()}`;
}

/* ───────────────────────────── a resposta ───────────────────────────── */

/**
 * Uma tarefa do escopo: a MESMA linha de `Todas as tarefas` (então
 * `LinhaDeTrabalho` e o cartão a desenham sem adaptação) e a origem completa.
 *
 * ⚠️ `clientId`/`clientName` só vêm quando a pessoa ALCANÇA o cliente — o da
 * tarefa, e na falta dele o da lista. Cliente fora do alcance vem nulo, e a
 * tela não inventa nome.
 *
 * ⚠️ A ETAPA É A REAL: `statusId` + `workflowId` (o conjunto de status, "a
 * esteira"). Duas etapas chamadas `A fazer` em fluxos diferentes são DUAS
 * etapas — o Kanban agrupa por `workflowId` e nunca por nome.
 */
export type LinhaDoEscopo = WorkRow & {
  spaceId: string;
  folderId: string | null;
  workflowId: string | null;
  workflowName: string | null;
  statusSortOrder: number | null;
};

export type EtapaDoFluxo = {
  id: string;
  name: string;
  type: StatusType;
  color: string | null;
  sortOrder: number;
  /** Tarefas vivas do escopo nesta etapa, sem filtro. */
  total: number;
  /** As que passam por TODOS os filtros — somam `counts.matched`. */
  matched: number;
};

/** Um fluxo (esteira) usado por alguma lista do recorte, com as etapas em ordem. */
export type FluxoDoEscopo = {
  id: string;
  name: string;
  /** Quantas listas do recorte usam este fluxo. */
  lists: number;
  etapas: EtapaDoFluxo[];
};

export type ListaDoEscopo = {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string | null;
  /** Só quando a pessoa alcança o cliente vinculado. */
  clientId: string | null;
  clientName: string | null;
  archived: boolean;
  workflowId: string | null;
};

export type PastaDoEscopo = { id: string; name: string; archived: boolean };

/**
 * O que só a PRIMEIRA página traz: os menus de filtro e as colunas do Kanban.
 * Os lotes seguintes não repagam essas leituras.
 */
export type CatalogoDoEscopo = {
  pastas: PastaDoEscopo[];
  listas: ListaDoEscopo[];
  fluxos: FluxoDoEscopo[];
  assigneeOptions: BoardAssigneeOption[];
  unassignedTasks: number;
};

export type ContagensDoEscopo = {
  /** Tarefas vivas do escopo (não arquivadas), concluídas incluídas. */
  total: number;
  /** Dessas, as não concluídas. É o "Tarefas em aberto" do panorama. */
  abertas: number;
  /** As que passam por todos os filtros. É o número do resultado. */
  matched: number;
  /**
   * As que passam pelos filtros e não caem em etapa de fluxo nenhum do
   * recorte (sem status, ou status fora da esteira da lista). Com elas,
   * `sum(etapas.matched) + semEtapa === matched`.
   */
  semEtapa: number;
};

export type CabecalhoDoEscopo = {
  spaceId: string;
  spaceName: string;
  folderId: string | null;
  folderName: string | null;
  listId: string | null;
  listName: string | null;
  archived: boolean;
};

export type TarefasDoEscopo = {
  escopo: Escopo;
  id: string;
  header: CabecalhoDoEscopo;
  filter: FiltroDoEscopo;
  rows: LinhaDoEscopo[];
  /** Quantas vieram NESTE lote. Nunca é o total. */
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
  /** Contadas no banco sobre o recorte inteiro, a cada lote. */
  counts: ContagensDoEscopo;
  /** Por etapa real: `{ [statusId]: { total, matched } }`. A cada lote. */
  statusCounts: Record<string, { total: number; matched: number }>;
  /** Presente só na primeira página (sem cursor). */
  catalog?: CatalogoDoEscopo;
};
