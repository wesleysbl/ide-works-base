/**
 * Desfazer em lote o que um agente escreveu — F21.2, ampliado na F26.8.
 *
 * O PEDIDO
 *   O dono limpar de uma vez o que uma concessão escreveu, sem caçar
 *   comentário por comentário na conversa de cada tarefa. Desde a F26 a IA
 *   também cria tarefa, mexe em responsáveis, prazo e conclusão, e escreve no
 *   mural e no histórico do cliente — e o lote aprende a voltar isso também.
 *
 * O QUE VOLTA, O QUE NÃO VOLTA (decisão 3 do plano F26)
 *   · comentário            → apagado (como na F21.2);
 *   · tarefa criada         → ARQUIVADA, não apagada (desarquiva-se pela tela);
 *   · nota e registro       → apagados;
 *   · mudança pequena       → volta ao valor ANTERIOR guardado em
 *     (`update_task`,          `changes.before` — prazo, início, prioridade,
 *      `assign_task`,          etiquetas, responsáveis, conclusão e a etapa que
 *      `complete_task`,        concluir e reabrir mexem;
 *      `reopen_task`)
 *   · texto editado e movimento de card → NÃO se desfazem. A versão anterior
 *     do texto nunca foi guardada (o registro é compacto por regra), e o
 *     movimento pode ter disparado automação. O resultado os lista como "não
 *     se desfaz", e o registro deles NÃO é carimbado: carimbar diria "desfeito"
 *     sobre algo que continua lá.
 *   · F44, Fase 8: concluir e reabrir passaram a ser o arrasto para a etapa que
 *     fecha / a primeira que abre, com a automação dela. Responsáveis que a
 *     regra trocou voltam junto (entram no antes/depois); a tarefa que a regra
 *     levou para OUTRA lista (`changes.movedByAutomation`) é movimento de card,
 *     e não se desfaz.
 *
 * O QUE UMA PESSOA MEXEU DEPOIS FICA COMO ELA DEIXOU
 *   Nenhuma volta passa por cima de trabalho de gente. Os critérios, objetivos
 *   e medidos no banco:
 *
 *   Mudança pequena — o valor ATUAL de cada campo que a escrita mudou tem de
 *     ser exatamente o `changes.after` que a IA deixou. Qualquer diferença é
 *     "mudou depois", e a escrita é pulada inteira (não volta metade de uma
 *     escrita: o registro só é carimbado quando ela voltou toda). Se a
 *     diferença veio de outra escrita de IA ainda viva, a frase diz isso.
 *
 *   Tarefa criada — é pulada se, depois da criação, houver QUALQUER um destes:
 *     1. um campo pequeno diferente do que as escritas da IA (desta pessoa, por
 *        qualquer conexão dela) deixaram, relido do registro na ordem;
 *     2. um evento no histórico da tarefa SEM marca de IA (`via_grant_id` e
 *        `via_name` nulos): movimento ou troca de responsáveis feita por gente,
 *        ou por automação que gente disparou — menos os eventos do próprio
 *        dono desfazendo antes (até 60 s do carimbo de um desfazer anterior);
 *     3. comentário na tarefa que não está no registro como escrito pela IA
 *        desta pessoa;
 *     4. subtarefa, checklist, link ou anexo (a IA não cria nenhum deles);
 *     5. `updated_at` depois do último instante que o registro explica — a
 *        criação (exato, relógio do banco) ou, havendo escritas/desfazeres
 *        posteriores da IA, o último deles mais 60 s de folga, porque o
 *        registro usa o relógio do Worker e a tarefa, o do banco. É o que pega
 *        título e descrição editados à mão.
 *
 *   Nota e registro criados — pulados se `updated_at` passou do último instante
 *     que o registro explica (mesma regra do item 5: editar, e no mural também
 *     arrastar ou redimensionar, conta como mexer), ou se o registro ganhou
 *     documento anexado. A nota não guarda QUEM editou (não há `updated_by`);
 *     como a IA de outra pessoa não edita o que não é dela (gatilho F26.2),
 *     uma edição que o registro desta pessoa não explica é de gente.
 *
 * A ORDEM É A INVERSA DO TEMPO
 *   O lote volta da escrita mais nova para a mais antiga: a atribuição feita
 *   depois da criação volta ANTES de a tarefa ser arquivada, e duas trocas de
 *   prazo em sequência voltam uma de cada vez até o valor original. Os fatos
 *   de "alguém mexeu na criação?" são lidos ANTES de qualquer volta: o que o
 *   próprio lote muda não pode contar como mexida de gente.
 *
 * QUEM PODE DESFAZER: O DONO, POR SESSÃO HUMANA
 *   Um agente NÃO desfaz as próprias escritas nem as de outro. Se pudesse,
 *   apagar o rastro seria a última jogada de um agente em pane. Por isso esta
 *   operação mora na rota de gestão (`/connections/:id/undo`), que recusa token
 *   de agente antes de qualquer outra coisa — e o gatilho da F21.2 recusa o
 *   carimbo `undone_at` vindo de sessão de agente, qualquer que seja a operação.
 *
 * COMO SE DESFAZ: PELOS MESMOS MIOLOS DA TELA
 *   Apagar comentário (`deleteCommentInTx`), arquivar tarefa
 *   (`setBoardTaskArchivedInTx`), apagar nota (`deleteNotaInTx`) e registro
 *   (`deleteEventInTx`), e voltar campos (`patchBoardTaskInTx`,
 *   `setBoardTaskCompletedInTx`) — os mesmos que a tela usa, dentro da
 *   transação do dono. Nenhum `update`/`delete` próprio aqui: um segundo
 *   caminho seria um segundo lugar onde a regra de quem-pode mora.
 *
 * PERMISSÃO: QUEM JULGA É O BANCO, OBSERVANDO OS FATOS
 *   Não há `if` de permissão neste arquivo. Cada volta corre num SAVEPOINT: se
 *   o banco recusar (42501, alcance perdido), só aquela volta cai, e ela é
 *   reportada como pulada — em vez de fingir sucesso ou derrubar o lote.
 *
 * TUDO OU NADA NO CARIMBO
 *   Voltar e carimbar o registro correm na MESMA transação. Se o carimbo
 *   falhar, nada é confirmado.
 *
 * O LEDGER SOBREVIVE
 *   Desfazer NÃO apaga a linha da execução — carimba `undone_at`/`undone_by`.
 *   E sobrevive à revogação da concessão: revogar antes de desfazer é o
 *   caminho recomendado quando o agente ainda está escrevendo.
 */

import {
  isAgentWriteOperation,
  type AgentWriteOperation,
  type AgentWriteTx,
  type MemoryAgentWriteStore,
  type PersistedExecution,
} from '@/integrations/executions';
import {
  readAgentTaskStateInTx,
  type MemoryClientRecordBoard,
  type MemoryCommentBoard,
  type MemoryTaskBoard,
} from '@/integrations/writes';
import { BoardRefused } from '@/server/board';
import { deleteCommentInTx } from '@/server/board-anexos';
import {
  patchBoardTaskInTx,
  setBoardTaskArchivedInTx,
  setBoardTaskCompletedInTx,
} from '@/server/board-task';
import { withActor, type ServerEnv, type Tx } from '@/server/db';
import { borrowSql } from '@/server/db-request';
import { HistoryRefused, deleteEventInTx } from '@/server/history';
import { MuralRefused, deleteNotaInTx } from '@/server/mural-e-captacao';
import { asDbActor, type AuthenticatedActor } from '@/server/session';

/** Por que um comentário ficou de pé depois do lote. */
export type UndoKeptReason = 'permission_denied' | 'not_found';

export type UndoDeleteOutcome = 'deleted' | UndoKeptReason;

/** O que o lote fez com cada escrita. */
export type UndoItemStatus =
  /** Voltou agora. O registro é carimbado. */
  | 'undone'
  /** O efeito pedido já vigorava (apagado ou arquivado antes). Carimbado. */
  | 'already_gone'
  /** Poderia voltar, mas não voltou — o motivo diz por quê. NÃO carimbado. */
  | 'skipped'
  /** Esta escrita não se desfaz (texto editado, movimento). NÃO carimbado. */
  | 'not_undoable';

export type UndoItemReason =
  | 'permission_denied'
  | 'not_found'
  /** O valor atual não é o que a IA deixou. */
  | 'changed_later'
  /** Uma pessoa mexeu na tarefa, na nota ou no registro depois da criação. */
  | 'touched_later'
  /** A tarefa foi arquivada depois; mudança pequena não volta nela. */
  | 'archived'
  /** O banco recusou a volta por outra regra — a frase é dele. */
  | 'refused'
  | 'text_edit'
  | 'move';

export type UndoItem = {
  executionId: string;
  operation: AgentWriteOperation;
  targetId: string;
  occurredAt: string;
  status: UndoItemStatus;
  reason: UndoItemReason | null;
  /** Frase em português para a tela, dizendo o que aconteceu. */
  message: string;
  /** `update_task` que também editou texto: a parte pequena voltou, estes campos não. */
  textNotUndone?: string[];
};

/** Uma escrita ainda não desfeita, candidata ao lote. */
export type UndoCandidate = {
  executionId: string;
  operation: AgentWriteOperation;
  targetId: string;
  occurredAt: Date;
  result: Record<string, unknown>;
  changes: Record<string, unknown>;
};

/** Uma escrita do registro sobre um alvo — de qualquer conexão do dono, desfeita ou não. */
export type UndoHistoryRow = UndoCandidate & { undoneAt: Date | null };

export type UndoWindow = { from: Date | null; to: Date | null };

/** Os campos pequenos da tarefa, como o registro os guarda (`SMALL_FIELDS`, writes.ts). */
export type UndoTaskState = {
  dueOn: string | null;
  startOn: string | null;
  priority: string | null;
  /** F40 — o tipo da demanda. Ausente = tarefa lida por quem ainda não o conhece (vale nulo). */
  type?: string | null;
  assigneeIds: string[];
  tagIds: string[];
  completed: boolean;
  statusId: string | null;
  archived: boolean;
};

/** O que o banco sabe da tarefa para responder "uma pessoa mexeu nela depois?". */
export type UndoTaskFacts = {
  state: UndoTaskState;
  createdAt: Date;
  updatedAt: Date;
  /** Eventos do histórico da tarefa SEM marca de IA, da criação em diante. */
  unmarkedEvents: Array<{ at: Date; actorId: string | null }>;
  /** Todos os comentários da tarefa (inclusive respostas). */
  commentIds: string[];
  /** Subtarefas, checklists, links e anexos — nenhum deles a IA cria. */
  extras: number;
};

export type UndoRecordKind = 'note' | 'entry';

export type UndoRecordFacts = { createdAt: Date; updatedAt: Date; documents: number };

export type UndoActOutcome =
  | { ok: true }
  | { ok: false; reason: 'permission_denied' | 'not_found' | 'refused'; message: string };

/** O que voltar numa tarefa: campos do `patch`, conclusão, e a etapa de antes. */
export type UndoTaskRestore = {
  patch: {
    dueOn?: string | null;
    startOn?: string | null;
    priority?: string | null;
    /** F40 — o tipo de antes (nulo inclusive). */
    type?: string | null;
    assigneeIds?: string[];
    tagIds?: string[];
  };
  completed?: boolean;
  statusId?: string | null;
};

export type UndoTx = {
  /**
   * As escritas desta concessão que ainda não foram desfeitas, dentro do
   * recorte, da mais antiga para a mais nova. Filtra por dono também — o
   * recorte não é só do id da concessão, é de quem responde por ela.
   */
  listUndoable(input: { grantId: string; ownerId: string; window: UndoWindow }): Promise<UndoCandidate[]>;
  /** Toda escrita do dono sobre estes alvos, de qualquer conexão dele, da mais antiga para a mais nova. */
  historyOf(ownerId: string, targetIds: readonly string[]): Promise<UndoHistoryRow[]>;
  /** Apaga como o DONO, pelo miolo da tela. O resultado é o fato observado. */
  deleteComment(commentId: string): Promise<UndoDeleteOutcome>;
  /** Os fatos de uma tarefa, ou nulo se o dono não a enxerga. */
  taskFacts(taskId: string): Promise<UndoTaskFacts | null>;
  /** O valor ATUAL dos campos pequenos, travado. Nulo = o dono não a alcança. */
  taskState(taskId: string): Promise<UndoTaskState | null>;
  archiveTask(taskId: string): Promise<UndoActOutcome>;
  restoreTask(taskId: string, restore: UndoTaskRestore, ownerId: string): Promise<UndoActOutcome>;
  recordFacts(kind: UndoRecordKind, id: string): Promise<UndoRecordFacts | null>;
  deleteRecord(kind: UndoRecordKind, id: string): Promise<UndoActOutcome>;
  /**
   * A lista (da tarefa) ou o cliente (da nota/registro) está ao alcance do
   * dono? Separa "alguém apagou" de "saiu do seu alcance" quando a linha some.
   */
  containerVisible(kind: 'task' | UndoRecordKind, containerId: string): Promise<boolean>;
  /** Carimba as execuções como desfeitas. Falhar aqui derruba o lote inteiro. */
  markUndone(executionIds: readonly string[], undoneBy: string, at: Date): Promise<void>;
};

export type UndoStore = {
  withUndoTransaction<T>(work: (tx: UndoTx) => Promise<T>): Promise<T>;
};

export type UndoKept = {
  commentId: string;
  executionId: string;
  reason: UndoKeptReason;
  message: string;
};

export type UndoOutcome = {
  grantId: string;
  undoneAt: string;
  window: { from: string | null; to: string | null };
  /** Quantas escritas o recorte alcançou nesta rodada. */
  examined: number;
  /** Comentários que sumiram da conversa agora. */
  removed: number;
  /** Comentários que já não estavam lá (apagados à mão antes). Contam como desfeitos. */
  alreadyGone: number;
  /** Comentários que ficaram de pé porque o dono não os alcança. */
  kept: number;
  keptComments: UndoKept[];
  /** F26.8 — cada escrita examinada, na ORDEM em que o lote a tratou (da mais nova para a mais antiga). */
  items: UndoItem[];
  /** Escritas que voltaram agora, de qualquer tipo (inclui os comentários de `removed`). */
  undone: number;
  /** Escritas puladas (pessoa mexeu depois, sem alcance…), com motivo em `items`. */
  skipped: number;
  /** Escritas que não se desfazem (texto editado, movimento). */
  notUndoable: number;
};

export class UndoRefused extends Error {
  readonly code: 'invalid_input';

  constructor(message: string) {
    super(message);
    this.name = 'UndoRefused';
    this.code = 'invalid_input';
  }
}

const KEPT_MESSAGE: Record<UndoKeptReason, string> = {
  permission_denied:
    'Este comentário não é seu para apagar: só o autor apaga o próprio comentário. ' +
    'Peça a quem o escreveu, ou deixe o registro como está.',
  not_found: 'Este comentário já não existia — alguém o apagou antes do lote.',
};

/**
 * A folga entre o relógio do registro (Worker, `occurred_at`/`undone_at`) e o
 * do banco (`updated_at`, `task_events.occurred_at`). Mexida de gente dentro
 * desta folga depois de uma escrita da IA passa despercebida — o preço de não
 * confundir a própria escrita da IA com mexida de gente.
 */
export const UNDO_CLOCK_SLACK_MS = 60_000;

/** O id do comentário mora no resultado da execução, e só lá. */
export function commentIdOfExecution(row: {
  operation: string;
  result: Record<string, unknown>;
}): string | null {
  if (row.operation !== 'add_comment') return null;
  const value = row.result?.commentId;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Uma execução ainda pode entrar no lote? Operação conhecida, viva, e não desfeita antes. */
export function isUndoable(row: PersistedExecution): boolean {
  if (!isAgentWriteOperation(row.operation)) return false;
  if (row.undoneAt) return false;
  if (row.operation === 'add_comment') return commentIdOfExecution(row) !== null;
  return true;
}

export function withinWindow(at: Date, window: UndoWindow): boolean {
  if (window.from && at.getTime() < window.from.getTime()) return false;
  if (window.to && at.getTime() >= window.to.getTime()) return false;
  return true;
}

/**
 * Lê o recorte pedido. Tudo ausente = tudo da concessão; datas = só a janela.
 * Data ilegível é recusada com frase — nunca interpretada como "tudo", que é
 * o jeito de um erro de digitação virar uma limpeza geral.
 */
export function parseUndoWindow(input: { since?: unknown; until?: unknown }): UndoWindow {
  const read = (value: unknown, field: string): Date | null => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') {
      throw new UndoRefused(`O campo "${field}" precisa ser uma data ISO em texto.`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new UndoRefused(`A data de "${field}" não é uma data válida (use o formato ISO).`);
    }
    return parsed;
  };
  const from = read(input.since, 'since');
  const to = read(input.until, 'until');
  if (from && to && from.getTime() >= to.getTime()) {
    throw new UndoRefused('A janela começa depois de terminar: "since" tem de ser antes de "until".');
  }
  return { from, to };
}

/* ─────────────────────── as regras, em TS puro ─────────────────────── */

/** Os campos pequenos que o registro guarda e o desfazer sabe voltar. */
const TASK_SMALL_FIELDS = ['dueOn', 'startOn', 'priority', 'type', 'assigneeIds', 'tagIds', 'completed', 'statusId'] as const;
type TaskSmallField = (typeof TASK_SMALL_FIELDS)[number];

const FIELD_NAME: Record<TaskSmallField, string> = {
  dueOn: 'o prazo',
  startOn: 'o início',
  priority: 'a prioridade',
  type: 'o tipo',
  assigneeIds: 'os responsáveis',
  tagIds: 'as etiquetas',
  completed: 'a conclusão',
  statusId: 'a etapa',
};

const TEXT_FIELD_NAME: Record<string, string> = {
  title: 'título',
  description: 'descrição',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Igualdade de campo pequeno: listas sem ordem e sem caixa; ausente = nulo. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = (v: unknown) =>
      (Array.isArray(v) ? v : [])
        .map((x) => String(x).toLowerCase())
        .sort()
        .join(',');
    return norm(a) === norm(b);
  }
  return (a ?? null) === (b ?? null);
}

/** A lista dos nomes, em português: "o prazo e a prioridade". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Os campos pequenos que uma escrita deixou (ou devolveu, se já foi desfeita).
 * `move_task` não guarda antes/depois em `changes`; o depois dele mora em
 * `result` — e é só o que a IA deixou, para a conta de "o que é esperado".
 */
function fieldsLeftBy(row: UndoCandidate & { undoneAt?: Date | null }): Partial<Record<TaskSmallField, unknown>> {
  const out: Partial<Record<TaskSmallField, unknown>> = {};
  if (row.operation === 'move_task') {
    if ('statusId' in row.result) out.statusId = row.result.statusId ?? null;
    if ('completed' in row.result) out.completed = row.result.completed === true;
    return out;
  }
  const after = asRecord(row.changes.after);
  const before = asRecord(row.changes.before);
  for (const field of TASK_SMALL_FIELDS) {
    if (!(field in after)) continue;
    out[field] = row.undoneAt ? before[field] : after[field];
  }
  return out;
}

/** Os instantes que o registro explica depois da criação: escritas e desfazeres. */
function explainedUntil(createdAt: Date, later: readonly UndoHistoryRow[]): Date {
  let last = 0;
  for (const row of later) {
    last = Math.max(last, row.occurredAt.getTime(), row.undoneAt?.getTime() ?? 0);
  }
  if (last === 0) return createdAt;
  return new Date(Math.max(createdAt.getTime(), last + UNDO_CLOCK_SLACK_MS));
}

/**
 * Uma pessoa mexeu na tarefa depois da criação pela IA? Devolve a frase do
 * motivo, ou nulo. Os critérios estão no cabeçalho, na mesma ordem.
 */
export function personTouchedTask(
  facts: UndoTaskFacts,
  creation: UndoCandidate,
  history: readonly UndoHistoryRow[],
  ownerId: string,
): string | null {
  const later = history.filter((row) => row.executionId !== creation.executionId);

  // 1. Campo pequeno diferente do que as escritas da IA deixaram.
  const expected: Partial<Record<TaskSmallField, unknown>> = { ...fieldsLeftBy(creation) };
  for (const row of [...later].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    Object.assign(expected, fieldsLeftBy(row));
  }
  const drift = TASK_SMALL_FIELDS.filter(
    (field) => field in expected && !sameValue(facts.state[field], expected[field]),
  );
  if (drift.length > 0) {
    return `Uma pessoa mudou ${listNames(drift.map((f) => FIELD_NAME[f]))} desta tarefa depois; ela não é arquivada.`;
  }

  // 2. Evento sem marca de IA — menos os do próprio dono desfazendo antes.
  const undoInstants = later.flatMap((row) => (row.undoneAt ? [row.undoneAt.getTime()] : []));
  const peopleEvents = facts.unmarkedEvents.filter(
    (event) =>
      !(
        event.actorId === ownerId &&
        undoInstants.some((at) => Math.abs(event.at.getTime() - at) <= UNDO_CLOCK_SLACK_MS)
      ),
  );
  if (peopleEvents.length > 0) {
    return 'Uma pessoa moveu esta tarefa ou trocou os responsáveis depois; ela não é arquivada.';
  }

  // 3. Comentário que o registro não explica.
  const agentComments = new Set(
    history.flatMap((row) => {
      const id = commentIdOfExecution(row);
      return id ? [id] : [];
    }),
  );
  if (facts.commentIds.some((id) => !agentComments.has(id))) {
    return 'Há comentário de pessoa nesta tarefa; arquivá-la esconderia a conversa, então ela fica.';
  }

  // 4. O que só gente acrescenta.
  if (facts.extras > 0) {
    return 'Uma pessoa acrescentou subtarefa, checklist, link ou anexo a esta tarefa; ela não é arquivada.';
  }

  // 5. Edição que o registro não explica (título, descrição…).
  if (facts.updatedAt.getTime() > explainedUntil(facts.createdAt, later).getTime()) {
    return 'Uma pessoa editou esta tarefa depois (título, descrição ou outro campo); ela não é arquivada.';
  }
  return null;
}

/** Uma pessoa mexeu na nota ou no registro depois da criação pela IA? */
export function personTouchedRecord(
  kind: UndoRecordKind,
  facts: UndoRecordFacts,
  creation: UndoCandidate,
  history: readonly UndoHistoryRow[],
): string | null {
  if (kind === 'entry' && facts.documents > 0) {
    return 'Uma pessoa anexou documento a este registro do histórico; ele fica.';
  }
  const later = history.filter((row) => row.executionId !== creation.executionId);
  if (facts.updatedAt.getTime() > explainedUntil(facts.createdAt, later).getTime()) {
    return kind === 'note'
      ? 'Uma pessoa editou, arrastou ou redimensionou esta nota do mural depois; ela fica como está.'
      : 'Uma pessoa editou este registro do histórico depois; ele fica como está.';
  }
  return null;
}

const NOT_UNDOABLE_MESSAGE: Partial<Record<AgentWriteOperation, string>> = {
  move_task: 'Movimento de card não se desfaz: ele pode ter disparado automação, e a volta seria outro movimento.',
  update_mural_note: 'Edição de nota do mural não se desfaz: a versão anterior do texto não fica guardada.',
  update_history_entry: 'Edição de registro do histórico não se desfaz: a versão anterior não fica guardada.',
};

/** F44, Fase 8 — concluir/reabrir cuja automação levou a tarefa para outra lista. */
const AUTOMATION_MOVED_MESSAGE =
  'A automação da etapa levou a tarefa para outra lista: é movimento de card, e não se desfaz — a volta seria outro movimento.';

const UNDONE_MESSAGE: Partial<Record<AgentWriteOperation, string>> = {
  create_task: 'Tarefa arquivada. Dá para desarquivar pela tela, se precisar.',
  update_task: 'Voltou ao valor anterior.',
  assign_task: 'Os responsáveis voltaram a ser os de antes.',
  complete_task: 'A tarefa voltou a ficar aberta, na etapa em que estava.',
  reopen_task: 'A tarefa voltou a ficar concluída.',
  add_mural_note: 'Nota apagada do mural.',
  add_history_entry: 'Registro apagado do histórico do cliente.',
};

/** F40, Fase 9 — o `release_task` fica no registro como `assign_task` com `changes.released`. */
const RELEASE_UNDONE_MESSAGE =
  'O card voltou para "atribuir demanda", sem os responsáveis e com o prazo de antes.';

function refusalItem(
  base: Omit<UndoItem, 'status' | 'reason' | 'message'>,
  outcome: Exclude<UndoActOutcome, { ok: true }>,
): UndoItem {
  const message =
    outcome.reason === 'permission_denied'
      ? `Você não alcança mais isto para desfazer: ${outcome.message}`
      : outcome.reason === 'not_found'
        ? 'Não encontrado, ou fora do seu alcance.'
        : `O banco recusou a volta: ${outcome.message}`;
  return { ...base, status: 'skipped', reason: outcome.reason, message };
}

type PrefetchedCreation =
  | { kind: 'task'; facts: UndoTaskFacts | null }
  | { kind: UndoRecordKind; facts: UndoRecordFacts | null };

/**
 * Desfaz, em lote, o que uma concessão escreveu.
 *
 * A ORDEM IMPORTA: primeiro os fatos das criações (antes de qualquer volta),
 * depois as voltas da mais nova para a mais antiga, e por último o carimbo,
 * tudo no mesmo `withUndoTransaction`. Carimbar antes de voltar marcaria como
 * desfeita uma escrita que o dono não alcança.
 */
export async function undoGrantWrites(input: {
  store: UndoStore;
  grantId: string;
  ownerId: string;
  window?: UndoWindow;
  now?: Date;
}): Promise<UndoOutcome> {
  const now = input.now ?? new Date();
  const window = input.window ?? { from: null, to: null };
  const ownerId = input.ownerId;

  return input.store.withUndoTransaction(async (tx) => {
    const candidates = await tx.listUndoable({ grantId: input.grantId, ownerId, window });

    const targets = [
      ...new Set(candidates.filter((c) => c.operation !== 'add_comment').map((c) => c.targetId)),
    ];
    const history = targets.length > 0 ? await tx.historyOf(ownerId, targets) : [];
    const historyOn = (targetId: string) => history.filter((row) => row.targetId === targetId);

    // Os fatos das criações, lidos ANTES de qualquer volta deste lote.
    const prefetched = new Map<string, PrefetchedCreation>();
    for (const c of candidates) {
      if (c.operation === 'create_task') {
        prefetched.set(c.executionId, { kind: 'task', facts: await tx.taskFacts(c.targetId) });
      } else if (c.operation === 'add_mural_note') {
        prefetched.set(c.executionId, { kind: 'note', facts: await tx.recordFacts('note', c.targetId) });
      } else if (c.operation === 'add_history_entry') {
        prefetched.set(c.executionId, { kind: 'entry', facts: await tx.recordFacts('entry', c.targetId) });
      }
    }

    const undoneNow = new Set<string>();
    const items: UndoItem[] = [];
    const keptComments: UndoKept[] = [];
    let removed = 0;
    let commentsAlreadyGone = 0;

    /** Uma escrita de mudança pequena: confere o valor atual e volta o anterior. */
    const undoSmallChange = async (c: UndoCandidate, base: Omit<UndoItem, 'status' | 'reason' | 'message'>) => {
      const after = asRecord(c.changes.after);
      const before = asRecord(c.changes.before);
      const fields = TASK_SMALL_FIELDS.filter((field) => field in after);
      const textEdited = Array.isArray(c.changes.textEdited)
        ? c.changes.textEdited.filter((f): f is string => typeof f === 'string')
        : [];
      const textNote =
        textEdited.length > 0
          ? ` O texto editado (${textEdited.map((f) => TEXT_FIELD_NAME[f] ?? f).join(', ')}) não volta.`
          : '';

      if (fields.length === 0) {
        return {
          ...base,
          status: 'not_undoable',
          reason: 'text_edit',
          message: 'Edição de texto não se desfaz: a versão anterior não fica guardada.',
          ...(textEdited.length > 0 ? { textNotUndone: textEdited } : {}),
        } satisfies UndoItem;
      }

      const current = await tx.taskState(c.targetId);
      if (!current) {
        return {
          ...base,
          status: 'skipped',
          reason: 'not_found',
          message: 'A tarefa não existe mais, ou saiu do seu alcance; não há o que voltar.',
        } satisfies UndoItem;
      }
      if (current.archived) {
        return {
          ...base,
          status: 'skipped',
          reason: 'archived',
          message: 'A tarefa foi arquivada depois; desarquive pela tela se quiser mexer nela.',
        } satisfies UndoItem;
      }

      const drift = fields.filter((field) => !sameValue(current[field], after[field]));
      if (drift.length > 0) {
        const names = listNames(drift.map((f) => FIELD_NAME[f]));
        const laterAgent = historyOn(c.targetId).some(
          (row) =>
            row.executionId !== c.executionId &&
            row.occurredAt.getTime() > c.occurredAt.getTime() &&
            !row.undoneAt &&
            !undoneNow.has(row.executionId) &&
            drift.some((field) => field in fieldsLeftBy(row)),
        );
        return {
          ...base,
          status: 'skipped',
          reason: 'changed_later',
          message: laterAgent
            ? `Uma escrita posterior de IA mudou ${names} de novo; desfaça-a antes, ou deixe como está.${textNote}`
            : `${capitalized(names)}: uma pessoa ${drift.length > 1 ? 'mudou esses campos' : 'mudou isso'} depois, e fica como ela deixou.${textNote}`,
        } satisfies UndoItem;
      }

      const restore: UndoTaskRestore = { patch: {} };
      for (const field of fields) {
        const value = before[field];
        if (field === 'completed') restore.completed = value === true;
        else if (field === 'statusId') restore.statusId = (value as string | null | undefined) ?? null;
        else if (field === 'assigneeIds' || field === 'tagIds') {
          restore.patch[field] = Array.isArray(value) ? value.map(String) : [];
        } else {
          restore.patch[field] = (value as string | null | undefined) ?? null;
        }
      }
      const outcome = await tx.restoreTask(c.targetId, restore, ownerId);
      if (!outcome.ok) return refusalItem(base, outcome);
      return {
        ...base,
        status: 'undone',
        reason: null,
        message:
          c.operation === 'update_task'
            ? `${capitalized(listNames(fields.map((f) => FIELD_NAME[f])))} voltou ao valor anterior.${textNote}`
            : c.changes.released === true
              ? RELEASE_UNDONE_MESSAGE
              : (UNDONE_MESSAGE[c.operation] ?? 'Voltou ao valor anterior.'),
        ...(textEdited.length > 0 ? { textNotUndone: textEdited } : {}),
      } satisfies UndoItem;
    };

    for (const c of [...candidates].reverse()) {
      const base = {
        executionId: c.executionId,
        operation: c.operation,
        targetId: c.targetId,
        occurredAt: c.occurredAt.toISOString(),
      };
      let item: UndoItem;

      switch (c.operation) {
        case 'add_comment': {
          const commentId = commentIdOfExecution(c)!;
          const outcome = await tx.deleteComment(commentId);
          if (outcome === 'deleted') {
            removed += 1;
            item = { ...base, status: 'undone', reason: null, message: 'Comentário apagado da conversa.' };
          } else if (outcome === 'not_found') {
            // Já não está na conversa: o efeito pedido é o efeito vigente.
            commentsAlreadyGone += 1;
            item = { ...base, status: 'already_gone', reason: 'not_found', message: KEPT_MESSAGE.not_found };
          } else {
            keptComments.push({
              commentId,
              executionId: c.executionId,
              reason: outcome,
              message: KEPT_MESSAGE[outcome],
            });
            item = { ...base, status: 'skipped', reason: outcome, message: KEPT_MESSAGE[outcome] };
          }
          break;
        }

        case 'move_task':
        case 'update_mural_note':
        case 'update_history_entry':
          item = {
            ...base,
            status: 'not_undoable',
            reason: c.operation === 'move_task' ? 'move' : 'text_edit',
            message: NOT_UNDOABLE_MESSAGE[c.operation]!,
          };
          break;

        case 'complete_task':
        case 'reopen_task':
          // F44, Fase 8 — a automação da etapa levou a tarefa para outra lista:
          // é movimento de card, e movimento não se desfaz (a volta seria outro
          // movimento, com outra automação). Sem a marca, é mudança pequena.
          item =
            c.changes.movedByAutomation === true
              ? { ...base, status: 'not_undoable', reason: 'move', message: AUTOMATION_MOVED_MESSAGE }
              : await undoSmallChange(c, base);
          break;

        case 'update_task':
        case 'assign_task':
          item = await undoSmallChange(c, base);
          break;

        case 'create_task': {
          const pre = prefetched.get(c.executionId);
          const facts = pre?.kind === 'task' ? pre.facts : null;
          if (!facts) {
            const listId = typeof c.changes.listId === 'string' ? c.changes.listId : null;
            const listVisible = listId ? await tx.containerVisible('task', listId) : false;
            item = listVisible
              ? { ...base, status: 'already_gone', reason: 'not_found', message: 'A tarefa já não existia — alguém a apagou antes do lote.' }
              : { ...base, status: 'skipped', reason: 'not_found', message: 'A tarefa saiu do seu alcance; não dá para arquivá-la daqui.' };
            break;
          }
          if (facts.state.archived) {
            item = { ...base, status: 'already_gone', reason: null, message: 'A tarefa já estava arquivada.' };
            break;
          }
          const touched = personTouchedTask(facts, c, historyOn(c.targetId), ownerId);
          if (touched) {
            item = { ...base, status: 'skipped', reason: 'touched_later', message: touched };
            break;
          }
          const outcome = await tx.archiveTask(c.targetId);
          item = outcome.ok
            ? { ...base, status: 'undone', reason: null, message: UNDONE_MESSAGE.create_task! }
            : refusalItem(base, outcome);
          break;
        }

        case 'add_mural_note':
        case 'add_history_entry': {
          const kind: UndoRecordKind = c.operation === 'add_mural_note' ? 'note' : 'entry';
          const pre = prefetched.get(c.executionId);
          const facts = pre && pre.kind === kind ? (pre.facts as UndoRecordFacts | null) : null;
          const what = kind === 'note' ? 'A nota' : 'O registro';
          if (!facts) {
            const clientId = typeof c.changes.clientId === 'string' ? c.changes.clientId : null;
            const clientVisible = clientId ? await tx.containerVisible(kind, clientId) : false;
            item = clientVisible
              ? {
                  ...base,
                  status: 'already_gone',
                  reason: 'not_found',
                  message: `${what} já não existia — alguém ${kind === 'note' ? 'a' : 'o'} apagou antes do lote.`,
                }
              : { ...base, status: 'skipped', reason: 'not_found', message: `${what} saiu do seu alcance (o cliente não aparece mais para você).` };
            break;
          }
          const touched = personTouchedRecord(kind, facts, c, historyOn(c.targetId));
          if (touched) {
            item = { ...base, status: 'skipped', reason: 'touched_later', message: touched };
            break;
          }
          const outcome = await tx.deleteRecord(kind, c.targetId);
          item = outcome.ok
            ? { ...base, status: 'undone', reason: null, message: UNDONE_MESSAGE[c.operation]! }
            : refusalItem(base, outcome);
          break;
        }
      }

      items.push(item);
      if (item.status === 'undone' || item.status === 'already_gone') undoneNow.add(c.executionId);
    }

    // Tudo ou nada: se isto levantar, a transação cai e NADA do que voltou
    // acima fica confirmado.
    if (undoneNow.size > 0) await tx.markUndone([...undoneNow], ownerId, now);

    return {
      grantId: input.grantId,
      undoneAt: now.toISOString(),
      window: {
        from: window.from ? window.from.toISOString() : null,
        to: window.to ? window.to.toISOString() : null,
      },
      examined: candidates.length,
      removed,
      alreadyGone: commentsAlreadyGone,
      kept: keptComments.length,
      keptComments,
      items,
      undone: items.filter((i) => i.status === 'undone').length,
      skipped: items.filter((i) => i.status === 'skipped').length,
      notUndoable: items.filter((i) => i.status === 'not_undoable').length,
    } satisfies UndoOutcome;
  });
}

/* ─────────────────────── o store em memória ─────────────────────── */

/** Os fatos que a suíte simula por tarefa (o que o port em memória não guarda). */
export type MemoryTaskMeta = Partial<Omit<UndoTaskFacts, 'state'>>;
export type MemoryRecordMeta = Partial<UndoRecordFacts>;

const EPOCH = new Date(0);

/** O port em memória não tem transação: um `tx` de fora do ensaio basta. */
const MEMORY_TX = { rehearsal: false } as unknown as AgentWriteTx;

/**
 * Store em memória para a suíte (F0.4: nenhum teste fala com o banco).
 * Lê o mesmo ledger, o mesmo quadro de comentários e os mesmos ports de
 * tarefa, mural e histórico que as escritas usaram, para a prova ser sobre o
 * estado real, e não sobre um espelho inventado.
 *
 * O rollback espelha o do Postgres: falhar no meio devolve tudo ao estado
 * anterior.
 */
export class MemoryUndoStore implements UndoStore {
  failMarkUndone = false;
  /** Fatos de tarefa que só o banco tem (datas, eventos, extras). Ausente = nada mexido. */
  readonly taskMeta = new Map<string, MemoryTaskMeta>();
  /** Idem, para nota e registro. */
  readonly recordMeta = new Map<string, MemoryRecordMeta>();
  /** Alvos em que o dono perdeu o alcance para escrever — imita o 42501. */
  readonly denied = new Set<string>();
  /** Listas e clientes que o dono ainda enxerga. */
  readonly visibleContainers = new Set<string>();

  constructor(
    private readonly ledger: MemoryAgentWriteStore,
    private readonly board: MemoryCommentBoard,
    /** Quem está apagando: só o autor alcança o próprio comentário. */
    private readonly actingUserId: string,
    private readonly ports: { tasks?: MemoryTaskBoard; records?: MemoryClientRecordBoard } = {},
  ) {}

  async withUndoTransaction<T>(work: (tx: UndoTx) => Promise<T>): Promise<T> {
    const snapExecutions = new Map(this.ledger.executions);
    const snapComments = new Map(this.board.comments);
    const snapTasks = this.ports.tasks ? new Map([...this.ports.tasks.tasks].map(([k, v]) => [k, structuredClone(v)])) : null;
    const snapNotes = this.ports.records ? new Map(this.ports.records.notes) : null;
    const snapEntries = this.ports.records ? new Map(this.ports.records.entries) : null;
    try {
      return await work(this.asTx());
    } catch (error) {
      this.ledger.executions.clear();
      for (const [id, row] of snapExecutions) this.ledger.executions.set(id, row);
      this.board.comments.clear();
      for (const [id, row] of snapComments) this.board.comments.set(id, row);
      if (snapTasks && this.ports.tasks) {
        this.ports.tasks.tasks.clear();
        for (const [id, row] of snapTasks) this.ports.tasks.tasks.set(id, row);
      }
      if (snapNotes && snapEntries && this.ports.records) {
        this.ports.records.notes.clear();
        for (const [id, row] of snapNotes) this.ports.records.notes.set(id, row);
        this.ports.records.entries.clear();
        for (const [id, row] of snapEntries) this.ports.records.entries.set(id, row);
      }
      throw error;
    }
  }

  private asCandidate(row: PersistedExecution): UndoCandidate {
    return {
      executionId: row.id,
      operation: row.operation,
      targetId: row.targetId,
      occurredAt: row.occurredAt,
      result: row.result,
      changes: row.changes,
    };
  }

  private denial(targetId: string): UndoActOutcome | null {
    if (!this.denied.has(targetId)) return null;
    return { ok: false, reason: 'permission_denied', message: 'fora do seu alcance.' };
  }

  private asTx(): UndoTx {
    const tasks = this.ports.tasks;
    const records = this.ports.records;
    return {
      listUndoable: async ({ grantId, ownerId, window }) => {
        const found: UndoCandidate[] = [];
        for (const row of this.ledger.executions.values()) {
          if (row.grantId !== grantId || row.ownerId !== ownerId) continue;
          if (!isUndoable(row)) continue;
          if (!withinWindow(row.occurredAt, window)) continue;
          found.push(this.asCandidate(row));
        }
        return found.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      },
      historyOf: async (ownerId, targetIds) => {
        const wanted = new Set(targetIds);
        return [...this.ledger.executions.values()]
          .filter((row) => row.ownerId === ownerId && wanted.has(row.targetId))
          .map((row) => ({ ...this.asCandidate(row), undoneAt: row.undoneAt ?? null }))
          .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      },
      deleteComment: async (commentId) => {
        const row = this.board.comments.get(commentId);
        if (!row) return 'not_found';
        // Mesma regra da política do banco: só o autor apaga.
        if (row.authorId !== this.actingUserId) return 'permission_denied';
        this.board.comments.delete(commentId);
        // Cascata das respostas, como `task_comments_parent_fk on delete cascade`.
        for (const [id, reply] of [...this.board.comments]) {
          if (reply.parentId === commentId) this.board.comments.delete(id);
        }
        return 'deleted';
      },
      taskFacts: async (taskId) => {
        const state = await this.taskState(taskId);
        if (!state) return null;
        const meta = this.taskMeta.get(taskId) ?? {};
        const comments = [...this.board.comments.values()].filter((row) => row.taskId === taskId).map((row) => row.id);
        return {
          state,
          createdAt: meta.createdAt ?? EPOCH,
          updatedAt: meta.updatedAt ?? meta.createdAt ?? EPOCH,
          unmarkedEvents: meta.unmarkedEvents ?? [],
          commentIds: [...comments, ...(meta.commentIds ?? [])],
          extras: meta.extras ?? 0,
        };
      },
      taskState: (taskId) => this.taskState(taskId),
      archiveTask: async (taskId) => {
        const row = tasks?.tasks.get(taskId);
        if (!tasks || !row) return { ok: false, reason: 'not_found', message: 'tarefa não encontrada.' };
        const denied = this.denial(taskId);
        if (denied) return denied;
        tasks.tasks.set(taskId, { ...row, archived: true });
        return { ok: true };
      },
      restoreTask: async (taskId, restore, ownerId) => {
        const row = tasks?.tasks.get(taskId);
        if (!tasks || !row) return { ok: false, reason: 'not_found', message: 'tarefa não encontrada.' };
        const denied = this.denial(taskId);
        if (denied) return denied;
        // Pelo MESMO port que as escritas usaram: responsáveis passam pela
        // mesma conferência de alcance, e a etapa pelo mesmo abrir/fechar.
        const patch = restore.patch as Parameters<MemoryTaskBoard['patch']>[2];
        const before = structuredClone(row);
        // F44, Fase 8 — como no SQL: voltar a uma etapa conhecida é ir direto a
        // ela, sem passar pela primeira que abre (e pela regra dela).
        const direto = restore.completed === false && Boolean(restore.statusId);
        try {
          if (Object.keys(patch).length > 0) await tasks.patch(MEMORY_TX, taskId, patch);
          if (direto) {
            const now = tasks.tasks.get(taskId)!;
            tasks.tasks.set(taskId, { ...now, completed: false, completedBy: null });
          } else if (restore.completed !== undefined) {
            await tasks.setCompleted(MEMORY_TX, taskId, restore.completed, ownerId);
          }
        } catch (error) {
          // O savepoint do Postgres: a volta recusada não deixa metade feita.
          tasks.tasks.set(taskId, before);
          if (error instanceof BoardRefused) {
            return { ok: false, reason: error.status === 403 ? 'permission_denied' : 'refused', message: error.message };
          }
          throw error;
        }
        if (restore.statusId) {
          const now = tasks.tasks.get(taskId)!;
          if (now.statusId !== restore.statusId) tasks.tasks.set(taskId, { ...now, statusId: restore.statusId });
        }
        return { ok: true };
      },
      recordFacts: async (kind, id) => {
        const exists = kind === 'note' ? records?.notes.has(id) : records?.entries.has(id);
        if (!exists) return null;
        const meta = this.recordMeta.get(id) ?? {};
        return {
          createdAt: meta.createdAt ?? EPOCH,
          updatedAt: meta.updatedAt ?? meta.createdAt ?? EPOCH,
          documents: meta.documents ?? 0,
        };
      },
      deleteRecord: async (kind, id) => {
        const table = kind === 'note' ? records?.notes : records?.entries;
        if (!table || !table.has(id)) return { ok: false, reason: 'not_found', message: 'não encontrado.' };
        const denied = this.denial(id);
        if (denied) return denied;
        table.delete(id);
        return { ok: true };
      },
      containerVisible: async (_kind, containerId) => this.visibleContainers.has(containerId),
      markUndone: async (executionIds, undoneBy, at) => {
        if (this.failMarkUndone) throw new Error('falha ao registrar o desfazer');
        for (const id of executionIds) {
          const row = this.ledger.executions.get(id);
          if (!row || row.undoneAt) continue;
          this.ledger.executions.set(id, { ...row, undoneAt: at, undoneBy });
        }
      },
    };
  }

  private async taskState(taskId: string): Promise<UndoTaskState | null> {
    const row = this.ports.tasks?.tasks.get(taskId);
    if (!row) return null;
    return {
      dueOn: row.dueOn,
      startOn: row.startOn,
      priority: row.priority,
      type: row.type ?? null,
      assigneeIds: [...row.assigneeIds],
      tagIds: [...row.tagIds],
      completed: row.completed,
      statusId: row.statusId,
      archived: row.archived,
    };
  }
}

/* ─────────────────────── o store SQL ─────────────────────── */

/**
 * Store SQL: UMA transação, com o ator do DONO — não o da integração.
 * É isso que faz o lote respeitar as permissões dele, sem nenhum `if` aqui:
 * o que ele não alcança, o banco não deixa voltar.
 */
export function createSqlUndoStore(env: ServerEnv, owner: AuthenticatedActor): UndoStore {
  return {
    async withUndoTransaction<T>(work: (tx: UndoTx) => Promise<T>): Promise<T> {
      // Conexão emprestada da requisição (F22, Fase 2); o ator continua o do DONO.
      return borrowSql(env, 'desfazer', (sql) => withActor(sql, asDbActor(owner), (tx) => work(sqlUndoTx(tx))));
    },
  };
}

const asDate = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));

/**
 * Cada volta num SAVEPOINT: no Postgres um erro aborta a transação inteira, e
 * a recusa de UMA volta (42501 de alcance perdido) não pode custar o lote. As
 * recusas traduzidas pelos miolos viram o motivo do item; o resto sobe.
 */
async function inSavepoint(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<UndoActOutcome> {
  try {
    await tx.savepoint(async (sp) => {
      await work(sp);
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof BoardRefused || error instanceof MuralRefused || error instanceof HistoryRefused) {
      if (error.status === 403) return { ok: false, reason: 'permission_denied', message: error.message };
      if (error.status === 404) return { ok: false, reason: 'not_found', message: error.message };
      return { ok: false, reason: 'refused', message: error.message };
    }
    throw error;
  }
}

function candidateFromSql(row: Record<string, unknown>): UndoCandidate | null {
  const operation = String(row.operation);
  if (!isAgentWriteOperation(operation)) return null;
  return {
    executionId: String(row.id),
    operation,
    targetId: String(row.target_id),
    occurredAt: asDate(row.occurred_at),
    result: asRecord(row.result),
    changes: asRecord(row.changes),
  };
}

/** Exportado para a prova contra o banco montar o MESMO port dentro da transação dela. */
export function sqlUndoTx(tx: Tx): UndoTx {
  const state = async (taskId: string, lock: boolean): Promise<UndoTaskState | null> => {
    const row = await readAgentTaskStateInTx(tx, taskId, lock);
    if (!row) return null;
    return {
      dueOn: row.dueOn,
      startOn: row.startOn,
      priority: row.priority,
      type: row.type,
      assigneeIds: row.assigneeIds,
      tagIds: row.tagIds,
      completed: row.completed,
      statusId: row.statusId,
      archived: row.archived,
    };
  };

  return {
    async listUndoable({ grantId, ownerId, window }) {
      // Sem filtro de operação no SQL: o índice parcial da F21.2 cobre só
      // `add_comment`, e o recorte por concessão (≤ 50 escritas por dia) já
      // usa `integration_executions_grant_idx` (grant_id, occurred_at).
      const rows = await tx`
        select id::text as id, operation, target_id::text as target_id,
               occurred_at, result, changes
          from ideworks.integration_executions
         where grant_id = ${grantId}::uuid
           and owner_id = ${ownerId}::uuid
           and undone_at is null
           and (operation <> 'add_comment' or result ? 'commentId')
           and (${window.from}::timestamptz is null or occurred_at >= ${window.from})
           and (${window.to}::timestamptz is null or occurred_at < ${window.to})
         order by occurred_at asc, id asc`;
      return rows.flatMap((row) => {
        const c = candidateFromSql(row as Record<string, unknown>);
        return c ? [c] : [];
      });
    },

    async historyOf(ownerId, targetIds) {
      if (targetIds.length === 0) return [];
      const rows = await tx`
        select id::text as id, operation, target_id::text as target_id,
               occurred_at, undone_at, result, changes
          from ideworks.integration_executions
         where owner_id = ${ownerId}::uuid
           and target_id = any(${[...targetIds]}::uuid[])
         order by occurred_at asc, id asc`;
      return rows.flatMap((row) => {
        const c = candidateFromSql(row as Record<string, unknown>);
        return c ? [{ ...c, undoneAt: row.undone_at ? asDate(row.undone_at) : null }] : [];
      });
    },

    async deleteComment(commentId) {
      const outcome = await inSavepoint(tx, (sp) => deleteCommentInTx(sp, commentId));
      if (outcome.ok) return 'deleted';
      // As duas recusas NÃO são erro de Postgres: vêm de um `select` vazio e
      // de um `delete` que não alcançou a linha.
      if (outcome.reason === 'not_found') return 'not_found';
      if (outcome.reason === 'permission_denied') return 'permission_denied';
      return 'permission_denied';
    },

    async taskFacts(taskId) {
      const current = await state(taskId, false);
      if (!current) return null;
      // `task_events` sem marca = gente (ou automação que gente disparou). A
      // marca vem do gatilho `stamp_agent_origin` (F26.2), a partir da sessão.
      const [row] = await tx`
        select t.created_at, t.updated_at,
               coalesce((select json_agg(json_build_object('at', e.occurred_at, 'actor', e.actor_id))
                           from ideworks.task_events e
                          where e.task_id = t.id
                            and e.via_grant_id is null and e.via_name is null
                            and e.occurred_at >= t.created_at), '[]'::json) as events,
               coalesce((select array_agg(c.id::text) from ideworks.task_comments c
                          where c.task_id = t.id), '{}'::text[]) as comment_ids,
               ((select count(*) from ideworks.tasks s where s.parent_id = t.id)
                + (select count(*) from ideworks.task_checklists k where k.task_id = t.id)
                + (select count(*) from ideworks.task_links k where k.task_id = t.id)
                + (select count(*) from ideworks.task_attachments a where a.task_id = t.id))::int as extras
          from ideworks.tasks t
         where t.id = ${taskId}::uuid`;
      if (!row) return null;
      const events = (Array.isArray(row.events) ? row.events : []) as Array<{ at: string; actor: string | null }>;
      return {
        state: current,
        createdAt: asDate(row.created_at),
        updatedAt: asDate(row.updated_at),
        unmarkedEvents: events.map((e) => ({ at: asDate(e.at), actorId: e.actor ?? null })),
        commentIds: Array.isArray(row.comment_ids) ? row.comment_ids.map(String) : [],
        extras: Number(row.extras ?? 0),
      };
    },

    async taskState(taskId) {
      return state(taskId, true);
    },

    async archiveTask(taskId) {
      return inSavepoint(tx, (sp) => setBoardTaskArchivedInTx(sp, taskId, true));
    },

    async restoreTask(taskId, restore, ownerId) {
      return inSavepoint(tx, async (sp) => {
        if (Object.keys(restore.patch).length > 0) {
          await patchBoardTaskInTx(sp, taskId, restore.patch as Parameters<typeof patchBoardTaskInTx>[2]);
        }
        // F44, Fase 8 — reabrir é o arrasto para a primeira etapa que abre, com
        // evento e a automação DAQUELA etapa. Voltando para uma etapa conhecida,
        // o desfazer vai direto a ela num movimento só (o gatilho do status
        // limpa a conclusão): passar pela primeira que abre deixaria um evento
        // a mais e dispararia uma regra que a tarefa nunca tinha cruzado.
        const direto = restore.completed === false && Boolean(restore.statusId);
        if (restore.completed !== undefined && !direto) {
          // Concluir de volta grava o DONO como quem concluiu — é ele que age.
          await setBoardTaskCompletedInTx(sp, taskId, restore.completed, ownerId);
        }
        if (restore.statusId) {
          // Concluir e reabrir levam a tarefa à etapa que fecha ou à primeira
          // que abre; a etapa de ANTES pode ser outra, e volta por `move_task`.
          const [now] = await sp`select status_id::text as status_id from ideworks.tasks where id = ${taskId}::uuid`;
          if (now && now.status_id !== restore.statusId) {
            await patchBoardTaskInTx(sp, taskId, { statusId: restore.statusId });
          }
        }
      });
    },

    async recordFacts(kind, id) {
      const rows =
        kind === 'note'
          ? await tx`
              select created_at, updated_at, 0 as documents
                from ideworks.mural_notes where id = ${id}::uuid`
          : await tx`
              select h.created_at, h.updated_at,
                     (select count(*)::int from ideworks.history_documents d where d.history_id = h.id) as documents
                from ideworks.client_history h where h.id = ${id}::uuid`;
      const row = rows[0];
      if (!row) return null;
      return {
        createdAt: asDate(row.created_at),
        updatedAt: asDate(row.updated_at),
        documents: Number(row.documents ?? 0),
      };
    },

    async deleteRecord(kind, id) {
      return inSavepoint(tx, (sp) => (kind === 'note' ? deleteNotaInTx(sp, id) : deleteEventInTx(sp, id)));
    },

    async containerVisible(kind, containerId) {
      const [row] =
        kind === 'task'
          ? await tx`select exists(select 1 from ideworks.lists where id = ${containerId}::uuid) as visible`
          : await tx`select ideworks.can_see_client(${containerId}::uuid) as visible`;
      return row?.visible === true;
    },

    async markUndone(executionIds, undoneBy, at) {
      if (executionIds.length === 0) return;
      await tx`
        update ideworks.integration_executions
           set undone_at = ${at}, undone_by = ${undoneBy}::uuid
         where id = any(${[...executionIds]}::uuid[])
           and undone_at is null`;
    },
  };
}
