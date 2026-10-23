/**
 * Escritas de agente — F16.7 `add_comment` + F16.8 `preview_move` / `move_task`
 * + F26.5 `create_task` / `update_task` / `assign_task` / `complete_task` /
 * `reopen_task` + F26.6 `add_mural_note` / `update_mural_note` /
 * `add_history_entry` / `update_history_entry` (seções próprias no fim).
 *
 * HTTP e MCP chamam a mesma operação. `runAgentWrite` revalida a concessão
 * e grava o ledger; `postCommentInTx` e `moveTaskOnBoardInTx` entram no MESMO
 * `Tx` (`AgentWriteTx.sqlTx`). Autor = dono da concessão (`acting_user_id`).
 *
 * Menções: o gatilho humano `sync_text_mentions` RECUSA pessoa fora do alcance
 * (`23514`) e desfaz o insert — não silencia, não notifica. O port em memória
 * espelha essa recusa. Teto de tamanho = orçamento da conversa (64 KiB).
 *
 * Movimento: IDs + origem observada. Sem equivalente, devolve opções
 * (`status_choice_required`) e não escolhe a primeira. Automação ou subárvore
 * fora da concessão recusa TUDO. `approved: true` do modelo não vale — a
 * política F16.6a decide. UI humana da autoria da integração: F16.9.
 */

import {
  AGENT_RECORD_TEXT_MAX_BYTES,
  addCommentResponseSchema,
  addHistoryEntryResponseSchema,
  addMuralNoteResponseSchema,
  updateHistoryEntryResponseSchema,
  updateMuralNoteResponseSchema,
  type AddHistoryEntryInput,
  type AddHistoryEntryResponse,
  type AddMuralNoteInput,
  type AddMuralNoteResponse,
  type AgentHistoryEntryStateView,
  type AgentMuralNoteStateView,
  type MuralNoteColor,
  type UpdateHistoryEntryInput,
  type UpdateHistoryEntryResponse,
  type UpdateMuralNoteInput,
  type UpdateMuralNoteResponse,
  assignTaskResponseSchema,
  completeTaskResponseSchema,
  createTaskResponseSchema,
  moveTaskResponseSchema,
  previewMoveResponseSchema,
  releaseTaskResponseSchema,
  reopenTaskResponseSchema,
  updateTaskResponseSchema,
  type AddCommentInput,
  type AgentTaskStateView,
  type AssignTaskInput,
  type AssignTaskResponse,
  type CompleteTaskInput,
  type CompleteTaskResponse,
  type CreateTaskInput,
  type CreateTaskResponse,
  type ReleaseTaskInput,
  type ReleaseTaskResponse,
  type ReopenTaskInput,
  type ReopenTaskResponse,
  type TaskPriorityName,
  type UpdateTaskInput,
  type UpdateTaskResponse,
  type AddCommentResponse,
  type IntegrationErrorCode,
  type MoveAutomationEffect,
  type MoveStatusOption,
  type MoveTaskInput,
  type MoveTaskResponse,
  type PreviewMoveInput,
  type PreviewMoveResponse,
} from '@/integrations/contract';
import {
  AgentWriteError,
  DailyWriteLimitError,
  decideWriteImpact,
  runAgentWrite,
  type AgentWriteAccess,
  type AgentWriteOperation,
  type AgentWriteStore,
  type AgentWriteSuccess,
  type AgentWriteTx,
  type WriteImpactFacts,
} from '@/integrations/executions';
import {
  allowsOperation,
  companyOmitted,
  decideAccess,
  effectiveCompanies,
  omittedIn,
  type CompanyScope,
  type IntegrationCapability,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import { INTEGRATION_MAX_BODY_BYTES } from '@/integrations/limits';
import type { NewTask, TaskPatch } from '@/board/ficha';
import { postCommentInTx } from '@/server/board-anexos';
import { BoardRefused, MoveNeedsStatus, TypeRequired, moveTaskOnBoardInTx } from '@/server/board';
import { actorDaPessoa } from '@/integrations/admin-semana';
import {
  ETAPA_DE_DESTINO,
  ETAPA_DE_ORIGEM,
  LiberarRecusado,
  normalizarEtapa,
  liberarDemandaInTx,
  FRASE_SEM_PESSOA,
  FRASE_SEM_PRAZO,
} from '@/server/liberar-demanda';
import { type TipoDaTarefa, comoTipoLido } from '@/server/tipo-da-tarefa';
import {
  createBoardTaskInTx,
  patchBoardTaskInTx,
  setBoardTaskCompletedInTx,
} from '@/server/board-task';
import { createSubtaskInTx, type NewSubtaskInTx } from '@/server/board-passos';
import {
  type ClienteDaNovaTarefa,
  clienteDaTarefa,
  decidirClienteDaNovaTarefa,
  fraseClienteCancelado,
} from '@/server/cliente-da-tarefa';
import { arrayOuNulo, type ExecutionOrigin, type Tx } from '@/server/db';
import {
  HistoryRefused,
  createEventInTx,
  updateEventInTx,
  type EntradaDeEvento,
} from '@/server/history';
import {
  MuralRefused,
  createNotaInTx,
  updateNotaInTx,
  type EntradaDeNota,
} from '@/server/mural-e-captacao';

/** Mesmo teto do pedido/resposta da conversa paginada (64 KiB). */
export const COMMENT_BODY_MAX_BYTES = INTEGRATION_MAX_BODY_BYTES;

/** Espelha `ideworks.sync_text_mentions` (máximo 20 pessoas por texto). */
export const COMMENT_MENTION_CEILING = 20;

const MENTION_RE =
  /@\[[^\]\r\n]{1,120}\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

const PARENT_OTHER_TASK =
  'A resposta pertence à tarefa do comentário que ela responde, e a tarefa informada não é essa.';
const PARENT_MISSING =
  'O comentário que você quer responder não existe ou está fora do seu alcance.';
const REPLY_TO_REPLY =
  'No ClickUp a conversa tem UM nível: responde-se ao comentário, não a uma resposta. Responda o comentário original.';
const MENTION_DENIED = 'Esta pessoa não tem acesso à tarefa. Escolha alguém da lista de menções.';
const WRITE_DENIED = 'Esta concessão não autoriza comentar.';
const MOVE_DENIED = 'Esta concessão não autoriza mover.';
const ORIGIN_REQUIRED =
  'Informe listId e statusId que você viu nesta tarefa. Relê o card e tente de novo.';
const ORIGIN_CHANGED = 'A tarefa mudou desde a leitura. Relê e tente de novo.';
const STATUS_CHOICE =
  'Não há etapa equivalente na lista de destino. Escolha uma das opções.';
const CREATE_STATUS_CHOICE =
  'Esta etapa não é da esteira desta lista. Escolha uma das opções (as mesmas de get_workflow). Nada foi criado.';
const PREVIEW_REQUIRED =
  'Este movimento exige prévia confirmada no servidor (id, parâmetros, revisão e prazo). approved: true no pedido não substitui.';
const GRANT_REACH =
  'Origem, destino, subtarefas ou a automação desta etapa ficam fora da concessão. Nada foi alterado.';

export type WriteFailure = {
  ok: false;
  code: Extract<
    IntegrationErrorCode,
    | 'permission_denied'
    | 'invalid_input'
    | 'state_conflict'
    | 'status_choice_required'
    | 'type_required'
    | 'assignee_required'
    | 'due_required'
    | 'already_released'
    | 'stage_missing'
    | 'not_found'
    | 'payload_too_large'
    | 'daily_write_limit'
  >;
  message: string;
  taskId?: string;
  listId?: string;
  listName?: string;
  options?: MoveStatusOption[];
  /**
   * F40 — `type_required`: os quatro tipos. Sai como `options` no corpo do erro
   * (HTTP e MCP), no mesmo formato das outras recusas de escolha; ficam em
   * campo próprio aqui só para `options` seguir sendo as etapas da lista.
   */
  typeOptions?: ReadonlyArray<{ value: TipoDaTarefa; label: string }>;
  current?: { listId: string; statusId: string | null };
  /**
   * Só na recusa por teto diário (F21.1). Os números vão estruturados além do
   * texto para a tela da Fase 5 desenhar a cota sem reinterpretar a frase.
   */
  dailyWrites?: { used: number; limit: number; resetsAt: string };
};

export type WriteSuccess<T> = { ok: true; body: T };
export type WriteResult<T> = WriteSuccess<T> | WriteFailure;

class WriteRefused extends Error {
  readonly failure: WriteFailure;

  constructor(failure: WriteFailure) {
    super(failure.message);
    this.name = 'WriteRefused';
    this.failure = failure;
  }
}

export type CommentParent = { id: string; taskId: string; parentId: string | null };

export type CommentMutator = {
  find(tx: AgentWriteTx, commentId: string): Promise<CommentParent | null>;
  post(
    tx: AgentWriteTx,
    input: { taskId: string; body: string; parentId: string | null },
  ): Promise<{ id: string }>;
  /**
   * `true`/`false` = o port decide (memória). `null` = o gatilho humano decide
   * (SQL). Menção inválida no banco levanta exceção; não gera aviso.
   */
  canMention(tx: AgentWriteTx, taskId: string, personId: string): Promise<boolean | null>;
  /**
   * O recorte da tarefa, como o DONO a enxerga — `null` = não existe ou fora
   * do alcance dele. A empresa é o espaço da lista; sem lista, o cliente (a
   * regra de `server/omitidas.ts`, F31, Fase 3b). O cliente é o efetivo: o da
   * tarefa e, na falta dele, o da lista (a regra única da F38, Fase 6). É o
   * que a omissão e o recorte da concessão conferem (auditoria de 08/10/2026:
   * antes só a omissão perguntava, e só pela empresa).
   */
  taskScope(tx: AgentWriteTx, taskId: string): Promise<{ companyId: string | null; clientId: string | null } | null>;
  /** O mesmo diretório de `TaskMutator.peopleCompanies` — para as menções. */
  peopleCompanies(tx: AgentWriteTx, personIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;
};

export type WriteCtx = {
  grant: IntegrationGrant;
  person: PersonAccess;
  origin: ExecutionOrigin;
  store: AgentWriteStore;
  comments: CommentMutator;
  board?: BoardMutator;
  /** F26.5 — miolo das escritas de tarefa. Ausente = SQL (`SQL_TASK_MUTATOR`). */
  tasks?: TaskMutator;
  /** F26.6 — miolo de mural e histórico. Ausente = SQL (`SQL_CLIENT_RECORD_MUTATOR`). */
  clientRecords?: ClientRecordMutator;
  now?: Date;
};

export type MemoryPostedComment = {
  id: string;
  taskId: string;
  parentId: string | null;
  body: string;
  authorId: string;
};

/**
 * Port injetável da suíte. Não fala com o banco (F0.4). Conta mutações e
 * avisos para a prova de replay. Menção fora da lista recusa sem notificar.
 */
export class MemoryCommentBoard implements CommentMutator {
  readonly comments = new Map<string, MemoryPostedComment>();
  readonly mentionable = new Map<string, Set<string>>();
  readonly notifications: string[] = [];
  /**
   * A empresa de cada tarefa — F31, Fase 3b. É também a massa das tarefas:
   * tarefa fora do mapa não existe para o dono (`taskScope` devolve `null`).
   */
  readonly taskCompanies = new Map<string, string>();
  /** O cliente efetivo de cada tarefa. Fora do mapa: sem cliente. */
  readonly taskClients = new Map<string, string>();
  /** O diretório do dono (`team_directory`), com as empresas de cada pessoa. */
  readonly peopleDirectory = new Map<string, readonly string[]>();
  mutations = 0;

  constructor(
    private readonly ownerId: string,
    seed: {
      comments?: readonly MemoryPostedComment[];
      mentionable?: ReadonlyMap<string, readonly string[]>;
      taskCompanies?: ReadonlyMap<string, string>;
      taskClients?: ReadonlyMap<string, string>;
      peopleCompanies?: ReadonlyMap<string, readonly string[]>;
    } = {},
  ) {
    for (const row of seed.comments ?? []) this.comments.set(row.id, row);
    for (const [taskId, companyId] of seed.taskCompanies ?? []) this.taskCompanies.set(taskId, companyId);
    for (const [taskId, clientId] of seed.taskClients ?? []) this.taskClients.set(taskId, clientId);
    for (const [personId, companies] of seed.peopleCompanies ?? []) {
      this.peopleDirectory.set(personId.toLowerCase(), [...companies]);
    }
    for (const [taskId, people] of seed.mentionable ?? []) {
      this.mentionable.set(taskId, new Set(people.map((id) => id.toLowerCase())));
    }
  }

  async find(_tx: AgentWriteTx, commentId: string): Promise<CommentParent | null> {
    const row = this.comments.get(commentId);
    if (!row) return null;
    return { id: row.id, taskId: row.taskId, parentId: row.parentId };
  }

  async taskScope(
    _tx: AgentWriteTx,
    taskId: string,
  ): Promise<{ companyId: string | null; clientId: string | null } | null> {
    const companyId = this.taskCompanies.get(taskId);
    if (companyId === undefined) return null;
    return { companyId, clientId: this.taskClients.get(taskId) ?? null };
  }

  async peopleCompanies(
    _tx: AgentWriteTx,
    personIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const out = new Map<string, readonly string[]>();
    for (const id of personIds) {
      const companies = this.peopleDirectory.get(id.toLowerCase());
      if (companies) out.set(id.toLowerCase(), companies);
    }
    return out;
  }

  async canMention(_tx: AgentWriteTx, taskId: string, personId: string): Promise<boolean | null> {
    const allowed = this.mentionable.get(taskId);
    if (!allowed) return false;
    return allowed.has(personId.toLowerCase());
  }

  async post(
    _tx: AgentWriteTx,
    input: { taskId: string; body: string; parentId: string | null },
  ): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    this.comments.set(id, {
      id,
      taskId: input.taskId,
      parentId: input.parentId,
      body: input.body,
      authorId: this.ownerId,
    });
    this.mutations += 1;
    for (const personId of mentionedPeople(input.body)) {
      if (personId === this.ownerId) continue;
      this.notifications.push(personId);
    }
    return { id };
  }
}

export const SQL_COMMENT_MUTATOR: CommentMutator = {
  async find(tx, commentId) {
    if (!tx.sqlTx) return null;
    const [row] = await tx.sqlTx`
      select c.id::text as id, c.task_id::text as task_id, c.parent_id::text as parent_id
        from ideworks.task_comments c
       where c.id = ${commentId}::uuid`;
    if (!row) return null;
    return {
      id: row.id as string,
      taskId: row.task_id as string,
      parentId: (row.parent_id as string | null) ?? null,
    };
  },
  async canMention() {
    return null;
  },
  async taskScope(tx, taskId) {
    if (!tx.sqlTx) return null;
    // Sob o RLS do dono: tarefa que ele não enxerga não volta, e é "não
    // encontrada". O cliente pela regra única (o da tarefa, senão o da lista),
    // o mesmo de `readAgentTaskStateInTx`.
    const [row] = await tx.sqlTx`
      select coalesce(s.category_id,
                      case when t.list_id is null then c.category_id end)::text as company_id,
             coalesce(t.client_id, l.client_id)::text as client_id
        from ideworks.tasks t
        left join ideworks.lists l on l.id = t.list_id
        left join ideworks.spaces s on s.id = l.space_id
        left join ideworks.clients c on c.id = t.client_id
       where t.id = ${taskId}::uuid`;
    if (!row) return null;
    return {
      companyId: (row.company_id as string | null) ?? null,
      clientId: (row.client_id as string | null) ?? null,
    };
  },
  async peopleCompanies(tx, personIds) {
    return SQL_TASK_MUTATOR.peopleCompanies(tx, personIds);
  },
  async post(tx, input) {
    if (!tx.sqlTx) {
      throw new AgentWriteError('invalid_input', 'A transação de escrita não está aberta.');
    }
    const posted = await postCommentInTx(tx.sqlTx, input.taskId, {
      body: input.body,
      parentId: input.parentId,
    });
    return { id: posted.id };
  },
};

export function mentionedPeople(body: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(new RegExp(MENTION_RE.source, 'g'))) {
    const id = match[1].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function commentBodyBytes(body: string): number {
  return new TextEncoder().encode(body).length;
}

function fail(
  code: WriteFailure['code'],
  message: string,
  extra?: Omit<WriteFailure, 'ok' | 'code' | 'message'>,
): WriteFailure {
  return { ok: false, code, message, ...extra };
}

function fromAgentError(error: AgentWriteError): WriteFailure {
  if (error.code === 'preview_required') {
    return fail('state_conflict', PREVIEW_REQUIRED);
  }
  // Código próprio, e não `rate_limited`: esperar não resolve teto de dia.
  if (error instanceof DailyWriteLimitError) {
    return fail('daily_write_limit', error.message, {
      dailyWrites: {
        used: error.used,
        limit: error.limit,
        resetsAt: error.resetsAt.toISOString(),
      },
    });
  }
  return fail(error.code, error.message);
}

/**
 * F40 — a recusa por falta de tipo, com a MESMA frase da tela e as quatro
 * opções, no formato das outras recusas de escolha. O que a IA faz: repetir o
 * pedido com `type`.
 */
const TYPE_REQUIRED_HINT =
  ' Repita o pedido com type: video, arte, foto ou outros (as opções vêm em options). Nada foi gravado.';

function typeRequired(error: TypeRequired, extra?: { listId?: string; taskId?: string }): WriteFailure {
  return fail('type_required', `${error.message}.${TYPE_REQUIRED_HINT}`, {
    ...(extra?.taskId ? { taskId: extra.taskId } : {}),
    ...(extra?.listId ? { listId: extra.listId } : {}),
    typeOptions: error.options,
  });
}

function fromBoard(error: BoardRefused): WriteFailure {
  if (error instanceof TypeRequired) return typeRequired(error);
  if (error instanceof MoveNeedsStatus) {
    if (/mudou/i.test(error.message)) {
      return fail('state_conflict', ORIGIN_CHANGED, {
        current: {
          listId: error.escolhaDeEtapa.origem.listId ?? '',
          statusId: error.escolhaDeEtapa.origem.statusId,
        },
      });
    }
    return fail('status_choice_required', STATUS_CHOICE, {
      taskId: error.escolhaDeEtapa.taskId,
      listId: error.escolhaDeEtapa.listId,
      listName: error.escolhaDeEtapa.listName,
      options: error.escolhaDeEtapa.etapas,
    });
  }
  const message = error.message;
  if (/tarefa do comentario|tarefa informada nao e essa|tarefa informada não é essa/i.test(message)) {
    return fail('state_conflict', PARENT_OTHER_TASK);
  }
  if (/nao tem acesso à tarefa|não tem acesso à tarefa|lista de menções/i.test(message)) {
    return fail('invalid_input', MENTION_DENIED);
  }
  if (error.status === 403) return fail('permission_denied', message);
  if (error.status === 404) return fail('not_found', message);
  if (error.status === 409) return fail('state_conflict', message);
  return fail('invalid_input', message);
}

function actedAs(grant: IntegrationGrant): AddCommentResponse['actedAs'] {
  return {
    ownerId: grant.ownerId,
    integrationId: grant.id,
    integrationName: grant.name,
  };
}

async function assertMentions(
  tx: AgentWriteTx,
  comments: CommentMutator,
  access: TaskAccess,
  taskId: string,
  body: string,
): Promise<void> {
  const people = mentionedPeople(body);
  if (people.length > COMMENT_MENTION_CEILING) {
    throw new WriteRefused(fail('invalid_input', 'Use no máximo 20 pessoas mencionadas por texto.'));
  }
  for (const personId of people) {
    const allowed = await comments.canMention(tx, taskId, personId);
    if (allowed === false) {
      throw new WriteRefused(fail('invalid_input', MENTION_DENIED));
    }
  }
  if (people.length === 0) return;
  // A menção avisa a pessoa: só entra quem está no diretório que a CONCESSÃO
  // enxerga — a mesma regra dos responsáveis (`assertAssigneesInGrant`). O
  // gatilho humano confere só o alcance do dono, não o recorte da conexão.
  const companies = await comments.peopleCompanies(tx, people);
  const scope = effectiveCompanies(access.person, access.grant);
  for (const personId of people) {
    const found = companies.get(personId);
    if (!found || !personInGrantScope(scope, found)) {
      throw new WriteRefused(fail('invalid_input', MENTION_DENIED));
    }
  }
}

/**
 * Publica comentário ou resposta. Autoria da credencial; resposta compacta.
 * Replay da mesma chave não chama o mutator de novo.
 */
export async function addCommentWork(
  ctx: WriteCtx,
  input: AddCommentInput,
): Promise<WriteResult<AddCommentResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'comments:write', now)) {
    return fail('permission_denied', WRITE_DENIED);
  }

  const taskId = input.taskId;
  const body = input.body;
  const parentId = input.parentId ?? null;

  if (body.trim() === '') {
    return fail('invalid_input', 'Escreva alguma coisa antes de enviar.');
  }
  if (commentBodyBytes(body) > COMMENT_BODY_MAX_BYTES) {
    return fail(
      'payload_too_large',
      `O comentário passa de ${COMMENT_BODY_MAX_BYTES} bytes (64 KiB), o teto da conversa.`,
    );
  }

  try {
    const written = await runAgentWrite<{
      commentId: string;
      taskId: string;
      parentId: string | null;
      actedAs: AddCommentResponse['actedAs'];
    }>({
      store: ctx.store,
      grantId: ctx.grant.id,
      operation: 'add_comment',
      idempotencyKey: input.idempotencyKey,
      targetId: taskId,
      params: { taskId, body, parentId },
      impact: {},
      origin: ctx.origin,
      now,
      mutate: async (ledger, loaded) => {
        // A concessão RELIDA e travada, como nas outras escritas.
        const access = accessOf(ctx, loaded, now);
        const scope = await ctx.comments.taskScope(ledger, taskId);
        if (!scope?.companyId) throw new WriteRefused(fail('not_found', TASK_MISSING));
        // F31, Fase 3b — comentar em tarefa de empresa omitida é "não
        // encontrada", como a leitura dela. Vem antes do recorte da concessão.
        refuseIfOmitted(access.person, scope.companyId, TASK_MISSING);
        // O recorte de empresa/cliente da concessão — o mesmo das outras
        // escritas sobre tarefa (auditoria de 08/10/2026).
        if (!grantReachesTask(access, 'comments:write', scope.companyId, scope.clientId)) {
          throw new WriteRefused(fail('permission_denied', TASK_OUT_OF_GRANT));
        }
        if (parentId) {
          const parent = await ctx.comments.find(ledger, parentId);
          if (!parent) throw new WriteRefused(fail('not_found', PARENT_MISSING));
          if (parent.taskId !== taskId) throw new WriteRefused(fail('state_conflict', PARENT_OTHER_TASK));
          if (parent.parentId) throw new WriteRefused(fail('invalid_input', REPLY_TO_REPLY));
        }
        await assertMentions(ledger, ctx.comments, access, taskId, body);
        const posted = await ctx.comments.post(ledger, { taskId, body, parentId });
        return {
          result: {
            commentId: posted.id,
            taskId,
            parentId,
            actedAs: actedAs(ctx.grant),
          },
          changes: { commentsAdded: 1 },
        };
      },
    });

    const bodyOut: AddCommentResponse = {
      operation: 'add_comment',
      commentId: written.result.commentId,
      taskId: written.result.taskId,
      parentId: written.result.parentId,
      executionId: written.executionId,
      replay: written.replay,
      actedAs: written.result.actedAs,
    };
    return { ok: true, body: addCommentResponseSchema.parse(bodyOut) };
  } catch (error) {
    if (error instanceof WriteRefused) return error.failure;
    if (error instanceof AgentWriteError) return fromAgentError(error);
    if (error instanceof BoardRefused) return fromBoard(error);
    throw error;
  }
}

/* ───────────────────────────── F16.8 movimento ───────────────────────────── */

export type MemoryMoveStatus = {
  id: string;
  name: string;
  type: 'open' | 'closed' | 'custom';
  color: string | null;
};

export type MemoryMoveList = {
  id: string;
  name: string;
  companyId: string;
  clientId: string | null;
  statuses: MemoryMoveStatus[];
};

export type MemoryMoveTask = {
  id: string;
  title: string;
  listId: string;
  statusId: string;
  parentId: string | null;
  clientId: string | null;
  companyId: string;
  completedAt: string | null;
};

export type MemoryMoveAutomation = {
  name: string;
  sourceListId: string;
  triggerStatusId: string;
  targetListId: string | null;
  targetStatusId: string | null;
  assigned?: boolean;
  active?: boolean;
};

export type MoveInspectRequest = {
  taskId: string;
  listId: string;
  statusId: string | null;
  from: { listId: string; statusId: string | null };
  lock: boolean;
};

export type AgentMoveEffect = {
  taskId: string;
  listId: string;
  statusId: string;
  statusName: string | null;
  completed: boolean;
  subtasksMoved: number;
  automation: MoveAutomationEffect | null;
};

type MoveSnapshot = {
  task: {
    id: string;
    title: string;
    listId: string;
    statusId: string | null;
    completed: boolean;
    companyId: string;
    clientId: string | null;
  };
  dest: {
    id: string;
    name: string;
    companyId: string;
    clientId: string | null;
    statuses: Array<{
      id: string;
      name: string;
      color: string | null;
      type: string;
      equivalent: boolean;
    }>;
  };
  subtree: Array<{ id: string; companyId: string; clientId: string | null }>;
  automation: {
    name: string;
    targetListId: string | null;
    targetStatusId: string | null;
    targetCompanyId: string | null;
    targetClientId: string | null;
    targetStatusName: string | null;
    targetStatusType: string | null;
    assigned: boolean;
  } | null;
};

export type MoveInspectReady = {
  kind: 'ready';
  chosenStatusId: string;
  currentCompleted: boolean;
  finalListId: string;
  finalStatusId: string;
  finalStatusName: string | null;
  finalCompleted: boolean;
  subtasksWouldMove: number;
  automation: MoveAutomationEffect | null;
};

export type MoveInspectResult =
  | MoveInspectReady
  | { kind: 'choice'; taskId: string; listId: string; listName: string; options: MoveStatusOption[] }
  | { kind: 'conflict'; current: { listId: string; statusId: string | null } }
  | { kind: 'denied'; failure: WriteFailure };

export type BoardMutator = {
  inspect(
    tx: AgentWriteTx,
    request: MoveInspectRequest,
    access: { person: PersonAccess; grant: IntegrationGrant; now: Date },
  ): Promise<MoveInspectResult>;
  apply(
    tx: AgentWriteTx,
    request: MoveInspectRequest,
    chosenStatusId: string,
  ): Promise<AgentMoveEffect>;
};

function normalizeStatusName(name: string): string {
  return name.trim().toLowerCase();
}

function grantReaches(
  access: { person: PersonAccess; grant: IntegrationGrant; now: Date },
  companyId: string,
  clientId: string | null,
): boolean {
  return decideAccess({
    person: access.person,
    grant: access.grant,
    operation: 'tasks:move',
    companyId,
    clientId: clientId ?? undefined,
    clientCompanyId: clientId ? companyId : null,
    now: access.now,
  }).allowed;
}

function resolvePlan(
  request: MoveInspectRequest,
  snap: MoveSnapshot,
  access: { person: PersonAccess; grant: IntegrationGrant; now: Date },
): MoveInspectResult {
  // F31, Fase 3b — tarefa ou lista de destino de empresa omitida responde
  // EXATAMENTE como a que não existe, ANTES de tudo: o conflito abaixo
  // devolveria a etapa atual da tarefa, e isso já contaria que ela existe. No
  // movimento, "não existe" é `permission_denied` com a frase do `inspect`
  // (tarefa) e `GRANT_REACH` (destino) — dar `not_found` aqui distinguiria a
  // omitida da inexistente.
  if (companyOmitted(access.person, snap.task.companyId)) {
    return { kind: 'denied', failure: fail('permission_denied', 'Tarefa não encontrada ou fora do seu alcance.') };
  }
  if (companyOmitted(access.person, snap.dest.companyId)) {
    return { kind: 'denied', failure: fail('permission_denied', GRANT_REACH) };
  }
  // O recorte da concessão também vem ANTES da origem, pelo mesmo motivo da
  // omitida: o conflito devolve a lista e a etapa ATUAIS da tarefa, e isso
  // não pode sair para tarefa (ou destino) fora da concessão — auditoria de
  // 08/10/2026.
  if (!grantReaches(access, snap.task.companyId, snap.task.clientId)) {
    return { kind: 'denied', failure: fail('permission_denied', GRANT_REACH) };
  }
  if (!grantReaches(access, snap.dest.companyId, snap.dest.clientId)) {
    return { kind: 'denied', failure: fail('permission_denied', GRANT_REACH) };
  }
  if (request.from.listId !== snap.task.listId || request.from.statusId !== snap.task.statusId) {
    return {
      kind: 'conflict',
      current: { listId: snap.task.listId, statusId: snap.task.statusId },
    };
  }
  for (const node of snap.subtree) {
    if (!grantReaches(access, node.companyId, node.clientId)) {
      return { kind: 'denied', failure: fail('permission_denied', GRANT_REACH) };
    }
  }
  if (snap.dest.statuses.length === 0) {
    return {
      kind: 'denied',
      failure: fail('invalid_input', 'A lista de destino está indisponível ou não tem etapas.'),
    };
  }
  const equivalent = snap.dest.statuses.find((row) => row.equivalent);
  const requested = request.statusId;
  if (
    (requested === null && !equivalent) ||
    (requested !== null && !snap.dest.statuses.some((row) => row.id === requested))
  ) {
    return {
      kind: 'choice',
      taskId: snap.task.id,
      listId: snap.dest.id,
      listName: snap.dest.name,
      options: snap.dest.statuses.map((row) => ({ id: row.id, name: row.name, color: row.color })),
    };
  }
  const chosen = requested ?? equivalent!.id;
  const chosenRow = snap.dest.statuses.find((row) => row.id === chosen)!;
  const wouldChange = snap.task.listId !== request.listId || snap.task.statusId !== chosen;
  const automation = wouldChange ? snap.automation : null;
  if (automation?.targetListId) {
    if (
      !automation.targetCompanyId ||
      !grantReaches(access, automation.targetCompanyId, automation.targetClientId)
    ) {
      return { kind: 'denied', failure: fail('permission_denied', GRANT_REACH) };
    }
  }
  const finalListId = automation?.targetListId ?? request.listId;
  const finalStatusId = (automation?.targetListId ? automation.targetStatusId : null) ?? chosen;
  const finalStatusName = automation?.targetListId
    ? (automation.targetStatusName ?? chosenRow.name)
    : chosenRow.name;
  const finalType = automation?.targetListId
    ? (automation.targetStatusType ?? chosenRow.type)
    : chosenRow.type;
  return {
    kind: 'ready',
    chosenStatusId: chosen,
    currentCompleted: snap.task.completed,
    finalListId,
    finalStatusId,
    finalStatusName,
    finalCompleted: finalType === 'closed',
    subtasksWouldMove: Math.max(0, snap.subtree.length - 1),
    automation: automation
      ? {
          name: automation.name,
          moved: automation.targetListId !== null,
          assigned: automation.assigned,
          removed: 0,
        }
      : null,
  };
}

function refusalFromPlan(plan: MoveInspectResult): WriteFailure | null {
  if (plan.kind === 'denied') return plan.failure;
  if (plan.kind === 'conflict') {
    return fail('state_conflict', ORIGIN_CHANGED, { current: plan.current });
  }
  if (plan.kind === 'choice') {
    return fail('status_choice_required', STATUS_CHOICE, {
      taskId: plan.taskId,
      listId: plan.listId,
      listName: plan.listName,
      options: plan.options,
    });
  }
  return null;
}

function impactFromPlan(plan: MoveInspectResult): WriteImpactFacts {
  if (plan.kind !== 'ready') return {};
  return {
    subtasksWouldMove: plan.subtasksWouldMove,
    automationWouldRun: plan.automation !== null,
  };
}

/**
 * Port injetável da suíte de movimento. Não fala com o banco. Conta writes
 * e disparos de automação para a prova de recusa/replay.
 */
export class MemoryMoveBoard implements BoardMutator {
  readonly lists = new Map<string, MemoryMoveList>();
  readonly tasks = new Map<string, MemoryMoveTask>();
  readonly automations: MemoryMoveAutomation[] = [];
  readonly writes: unknown[][] = [];
  mutations = 0;
  automationRuns = 0;

  constructor(seed: {
    lists?: readonly MemoryMoveList[];
    tasks?: readonly MemoryMoveTask[];
    automations?: readonly MemoryMoveAutomation[];
  } = {}) {
    for (const list of seed.lists ?? []) this.lists.set(list.id, { ...list, statuses: [...list.statuses] });
    for (const task of seed.tasks ?? []) this.tasks.set(task.id, { ...task });
    this.automations.push(...(seed.automations ?? []));
  }

  private family(rootId: string): MemoryMoveTask[] {
    const out: MemoryMoveTask[] = [];
    const walk = (id: string) => {
      const row = this.tasks.get(id);
      if (!row) return;
      out.push(row);
      for (const child of this.tasks.values()) {
        if (child.parentId === id) walk(child.id);
      }
    };
    walk(rootId);
    return out;
  }

  /**
   * F38, Fase 6 — o cliente da tarefa pela regra única do SQL: o dela, e na
   * falta dele o da lista em que ela está AGORA (`clienteDaTarefa`).
   */
  private clientOf(task: MemoryMoveTask): string | null {
    return clienteDaTarefa(task.clientId, this.lists.get(task.listId)?.clientId);
  }

  private snapshot(request: MoveInspectRequest): MoveSnapshot | WriteFailure {
    const task = this.tasks.get(request.taskId);
    if (!task) return fail('permission_denied', 'Tarefa não encontrada ou fora do seu alcance.');
    const dest = this.lists.get(request.listId);
    if (!dest) return fail('permission_denied', GRANT_REACH);
    const originName = this.lists.get(task.listId)?.statuses.find((row) => row.id === task.statusId)?.name ?? '';
    const statuses = dest.statuses.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      type: row.type,
      equivalent: originName.length > 0 && normalizeStatusName(row.name) === normalizeStatusName(originName),
    }));
    const family = this.family(task.id);
    const requested = request.statusId;
    const equivalent = statuses.find((row) => row.equivalent);
    const chosen =
      requested !== null && statuses.some((row) => row.id === requested)
        ? requested
        : equivalent?.id ?? null;
    const wouldChange = chosen !== null && (task.listId !== request.listId || task.statusId !== chosen);
    const rule =
      wouldChange && chosen
        ? this.automations.find(
            (row) =>
              row.sourceListId === request.listId &&
              row.triggerStatusId === chosen &&
              row.active !== false,
          )
        : undefined;
    const targetList = rule?.targetListId ? this.lists.get(rule.targetListId) : undefined;
    const targetStatus = targetList?.statuses.find((row) => row.id === rule?.targetStatusId);
    return {
      task: {
        id: task.id,
        title: task.title,
        listId: task.listId,
        statusId: task.statusId,
        completed: task.completedAt !== null,
        companyId: task.companyId,
        clientId: this.clientOf(task),
      },
      dest: {
        id: dest.id,
        name: dest.name,
        companyId: dest.companyId,
        clientId: dest.clientId,
        statuses,
      },
      subtree: family.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        clientId: this.clientOf(row),
      })),
      automation: rule
        ? {
            name: rule.name,
            targetListId: rule.targetListId,
            targetStatusId: rule.targetStatusId,
            targetCompanyId: targetList?.companyId ?? null,
            targetClientId: targetList?.clientId ?? null,
            targetStatusName: targetStatus?.name ?? null,
            targetStatusType: targetStatus?.type ?? null,
            assigned: rule.assigned === true,
          }
        : null,
    };
  }

  private retarget(family: MemoryMoveTask[], listId: string, rootId: string, rootStatusId: string): void {
    const list = this.lists.get(listId);
    if (!list) throw new WriteRefused(fail('permission_denied', GRANT_REACH));
    for (const task of family) {
      const originName = this.lists.get(task.listId)?.statuses.find((row) => row.id === task.statusId)?.name ?? '';
      const nextStatus =
        task.id === rootId
          ? rootStatusId
          : (list.statuses.find((row) => normalizeStatusName(row.name) === normalizeStatusName(originName))?.id ??
            list.statuses.find((row) => row.type === 'open')?.id ??
            rootStatusId);
      const status = list.statuses.find((row) => row.id === nextStatus);
      task.listId = listId;
      task.statusId = nextStatus;
      task.companyId = list.companyId;
      // F38, Fase 6 — como no SQL: `move_task` não grava cliente. A tarefa sem
      // cliente próprio passa a ler o da lista nova pela regra única.
      task.completedAt = status?.type === 'closed' ? (task.completedAt ?? new Date().toISOString()) : null;
    }
  }

  async inspect(
    _tx: AgentWriteTx,
    request: MoveInspectRequest,
    access: { person: PersonAccess; grant: IntegrationGrant; now: Date },
  ): Promise<MoveInspectResult> {
    const snap = this.snapshot(request);
    if ('ok' in snap) return { kind: 'denied', failure: snap };
    return resolvePlan(request, snap, access);
  }

  async apply(
    _tx: AgentWriteTx,
    request: MoveInspectRequest,
    chosenStatusId: string,
  ): Promise<AgentMoveEffect> {
    const task = this.tasks.get(request.taskId);
    if (!task) throw new WriteRefused(fail('permission_denied', 'Tarefa não encontrada ou fora do seu alcance.'));
    if (request.from.listId !== task.listId || request.from.statusId !== task.statusId) {
      throw new WriteRefused(
        fail('state_conflict', ORIGIN_CHANGED, {
          current: { listId: task.listId, statusId: task.statusId },
        }),
      );
    }
    const family = this.family(task.id);
    const dest = this.lists.get(request.listId);
    if (!dest) throw new WriteRefused(fail('permission_denied', GRANT_REACH));
    this.retarget(family, request.listId, task.id, chosenStatusId);
    this.writes.push([task.id, request.listId, chosenStatusId]);
    this.mutations += 1;
    const rule = this.automations.find(
      (row) =>
        row.sourceListId === request.listId &&
        row.triggerStatusId === chosenStatusId &&
        row.active !== false,
    );
    let automation: MoveAutomationEffect | null = null;
    if (rule) {
      this.automationRuns += 1;
      if (rule.targetListId) {
        this.retarget(family, rule.targetListId, task.id, rule.targetStatusId ?? chosenStatusId);
      }
      automation = {
        name: rule.name,
        moved: rule.targetListId !== null,
        assigned: rule.assigned === true,
        removed: 0,
      };
    }
    const after = this.tasks.get(task.id)!;
    const finalList = this.lists.get(after.listId);
    const finalStatus = finalList?.statuses.find((row) => row.id === after.statusId);
    return {
      taskId: after.id,
      listId: after.listId,
      statusId: after.statusId,
      statusName: finalStatus?.name ?? null,
      completed: after.completedAt !== null,
      subtasksMoved: Math.max(0, family.length - 1),
      automation,
    };
  }
}

async function inspectSql(
  tx: AgentWriteTx,
  request: MoveInspectRequest,
  access: { person: PersonAccess; grant: IntegrationGrant; now: Date },
): Promise<MoveInspectResult> {
  if (!tx.sqlTx) {
    throw new AgentWriteError('invalid_input', 'A transação de escrita não está aberta.');
  }
  const sql = tx.sqlTx;
  const taskRows = request.lock
    ? await sql`
        select t.id::text as id, t.title, t.list_id::text as list_id, t.status_id::text as status_id,
               coalesce(t.client_id, l.client_id)::text as client_id, t.completed_at,
               sp.category_id::text as company_id
          from ideworks.tasks t
          join ideworks.lists l on l.id = t.list_id
          join ideworks.spaces sp on sp.id = l.space_id
         where t.id = ${request.taskId}::uuid
         for update of t`
    : await sql`
        select t.id::text as id, t.title, t.list_id::text as list_id, t.status_id::text as status_id,
               coalesce(t.client_id, l.client_id)::text as client_id, t.completed_at,
               sp.category_id::text as company_id
          from ideworks.tasks t
          join ideworks.lists l on l.id = t.list_id
          join ideworks.spaces sp on sp.id = l.space_id
         where t.id = ${request.taskId}::uuid`;
  const task = taskRows[0];
  if (!task) return { kind: 'denied', failure: fail('permission_denied', 'Tarefa não encontrada ou fora do seu alcance.') };

  const destMeta = await sql`
    select l.id::text as id, l.name, l.client_id::text as client_id, sp.category_id::text as company_id
      from ideworks.lists l
      join ideworks.spaces sp on sp.id = l.space_id
     where l.id = ${request.listId}::uuid`;
  const dest = destMeta[0];
  if (!dest) return { kind: 'denied', failure: fail('permission_denied', GRANT_REACH) };

  const options = await sql`
    select s.id::text as id, s.name, s.color, s.type::text as type,
           coalesce(lower(btrim(s.name)) = lower(btrim(old.name)), false) as equivalent
      from ideworks.lists l
      join ideworks.statuses s on s.status_set_id = ideworks.resolve_status_set(l.id)
      left join ideworks.statuses old on old.id = ${task.status_id}::uuid
     where l.id = ${request.listId}::uuid
     order by s.sort_order, s.name, s.id`;

  const family = await sql`
    with recursive familia as (
      select t.id, t.list_id, t.client_id, 1 as passo
        from ideworks.tasks t where t.id = ${request.taskId}::uuid
      union all
      select f.id, f.list_id, f.client_id, m.passo + 1
        from ideworks.tasks f
        join familia m on f.parent_id = m.id
       where m.passo < 200
    )
    select fa.id::text as id, sp.category_id::text as company_id,
           coalesce(fa.client_id, l.client_id)::text as client_id
      from familia fa
      join ideworks.lists l on l.id = fa.list_id
      join ideworks.spaces sp on sp.id = l.space_id`;

  const statuses = options.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    color: (row.color as string | null) ?? null,
    type: String(row.type ?? ''),
    equivalent: row.equivalent === true,
  }));
  const requested = request.statusId;
  const equivalent = statuses.find((row) => row.equivalent);
  const chosenPreview =
    requested !== null && statuses.some((row) => row.id === requested)
      ? requested
      : equivalent?.id ?? null;

  let automation: MoveSnapshot['automation'] = null;
  const wouldChange =
    chosenPreview !== null &&
    (String(task.list_id) !== request.listId || String(task.status_id ?? '') !== chosenPreview);
  if (wouldChange && chosenPreview) {
    const rules = await sql`
      select a.name, a.target_list_id::text as target_list_id,
             a.target_status_id::text as target_status_id,
             a.assignee_id::text as assignee_id
        from ideworks.task_automations a
       where a.source_list_id = ${request.listId}::uuid
         and a.trigger_status_id = ${chosenPreview}::uuid
         and a.is_active
       limit 1`;
    const rule = rules[0];
    if (rule) {
      let targetCompanyId: string | null = null;
      let targetClientId: string | null = null;
      let targetStatusName: string | null = null;
      let targetStatusType: string | null = null;
      if (rule.target_list_id) {
        const target = await sql`
          select l.client_id::text as client_id, sp.category_id::text as company_id,
                 s.name as status_name, s.type::text as status_type
            from ideworks.lists l
            join ideworks.spaces sp on sp.id = l.space_id
            left join ideworks.statuses s on s.id = ${rule.target_status_id}::uuid
           where l.id = ${rule.target_list_id}::uuid`;
        const destRule = target[0];
        if (!destRule) {
          return { kind: 'denied', failure: fail('permission_denied', GRANT_REACH) };
        }
        targetCompanyId = String(destRule.company_id);
        targetClientId = (destRule.client_id as string | null) ?? null;
        targetStatusName = (destRule.status_name as string | null) ?? null;
        targetStatusType = (destRule.status_type as string | null) ?? null;
      }
      automation = {
        name: String(rule.name),
        targetListId: (rule.target_list_id as string | null) ?? null,
        targetStatusId: (rule.target_status_id as string | null) ?? null,
        targetCompanyId,
        targetClientId,
        targetStatusName,
        targetStatusType,
        assigned: Boolean(rule.assignee_id),
      };
    }
  }

  return resolvePlan(
    request,
    {
      task: {
        id: String(task.id),
        title: String(task.title),
        listId: String(task.list_id),
        statusId: (task.status_id as string | null) ?? null,
        completed: task.completed_at != null,
        companyId: String(task.company_id),
        clientId: (task.client_id as string | null) ?? null,
      },
      dest: {
        id: String(dest.id),
        name: String(dest.name),
        companyId: String(dest.company_id),
        clientId: (dest.client_id as string | null) ?? null,
        statuses,
      },
      subtree: family.map((row) => ({
        id: String(row.id),
        companyId: String(row.company_id),
        clientId: (row.client_id as string | null) ?? null,
      })),
      automation,
    },
    access,
  );
}

export const SQL_BOARD_MUTATOR: BoardMutator = {
  inspect: inspectSql,
  async apply(tx, request, chosenStatusId) {
    if (!tx.sqlTx) {
      throw new AgentWriteError('invalid_input', 'A transação de escrita não está aberta.');
    }
    const moved = await moveTaskOnBoardInTx(tx.sqlTx, request.taskId, request.listId, chosenStatusId, {
      listId: request.from.listId,
      statusId: request.from.statusId,
    });
    const [after] = await tx.sqlTx`
      select (t.completed_at is not null) as completed, s.name as status_name
        from ideworks.tasks t
        left join ideworks.statuses s on s.id = t.status_id
       where t.id = ${request.taskId}::uuid`;
    return {
      taskId: moved.taskId,
      listId: moved.listId,
      statusId: moved.statusId,
      statusName: (after?.status_name as string | null) ?? null,
      completed: after?.completed === true,
      subtasksMoved: moved.subtasksMoved,
      automation: moved.automation
        ? {
            name: moved.automation.name,
            moved: moved.automation.moved,
            assigned: moved.automation.assigned,
            removed: moved.automation.removed,
          }
        : null,
    };
  },
};

/**
 * `access` ausente = a concessão do pedido (prévia e espiada, que não gravam).
 * A escrita passa a RELIDA e travada por `runAgentWrite` (`accessOf`), como
 * todas as outras — entre o portão e a transação o recorte pode ter mudado.
 */
async function planMove(
  ctx: WriteCtx,
  tx: AgentWriteTx,
  input: { taskId: string; listId: string; statusId?: string | null; from: PreviewMoveInput['from'] },
  lock: boolean,
  access?: TaskAccess,
): Promise<MoveInspectResult> {
  const board = ctx.board ?? SQL_BOARD_MUTATOR;
  return board.inspect(
    tx,
    {
      taskId: input.taskId,
      listId: input.listId,
      statusId: input.statusId ?? null,
      from: input.from,
      lock,
    },
    access ?? { person: ctx.person, grant: ctx.grant, now: ctx.now ?? new Date() },
  );
}

function catchMove(error: unknown): WriteFailure {
  if (error instanceof WriteRefused) return error.failure;
  if (error instanceof AgentWriteError) return fromAgentError(error);
  if (error instanceof BoardRefused) return fromBoard(error);
  throw error;
}

/**
 * Prévia sem escrita. Exige origem observada. Não grava execução.
 */
export async function previewMoveWork(
  ctx: WriteCtx,
  input: PreviewMoveInput,
): Promise<WriteResult<PreviewMoveResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'tasks:move', now)) {
    return fail('permission_denied', MOVE_DENIED);
  }
  try {
    return await ctx.store.withWriteTransaction(async (tx) => {
      const plan = await planMove(ctx, tx, input, false);
      const refusal = refusalFromPlan(plan);
      if (refusal) return refusal;
      if (plan.kind !== 'ready') return fail('invalid_input', ORIGIN_REQUIRED);
      const body: PreviewMoveResponse = {
        operation: 'preview_move',
        taskId: input.taskId,
        from: input.from,
        listId: plan.finalListId,
        statusId: plan.finalStatusId,
        statusName: plan.finalStatusName,
        completed: plan.finalCompleted,
        reopened: plan.currentCompleted && !plan.finalCompleted,
        subtasksWouldMove: plan.subtasksWouldMove,
        automation: plan.automation,
        writeImpact: decideWriteImpact('move_task', impactFromPlan(plan)),
      };
      return { ok: true, body: previewMoveResponseSchema.parse(body) };
    });
  } catch (error) {
    return catchMove(error);
  }
}

/**
 * Move o card. `runAgentWrite` + `moveTaskOnBoardInTx` no mesmo Tx.
 * Replay da mesma chave não chama o mutator nem dispara a automação de novo.
 */
export async function moveTaskWork(
  ctx: WriteCtx,
  input: MoveTaskInput,
): Promise<WriteResult<MoveTaskResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'tasks:move', now)) {
    return fail('permission_denied', MOVE_DENIED);
  }
  try {
    const peeked = await ctx.store.withWriteTransaction((tx) => planMove(ctx, tx, input, false));
    const peekedFacts = impactFromPlan(peeked);
    const written = await runAgentWrite<{
      taskId: string;
      listId: string;
      statusId: string;
      statusName: string | null;
      completed: boolean;
      reopened: boolean;
      subtasksMoved: number;
      automation: MoveAutomationEffect | null;
      actedAs: MoveTaskResponse['actedAs'];
    }>({
      store: ctx.store,
      grantId: ctx.grant.id,
      operation: 'move_task',
      idempotencyKey: input.idempotencyKey,
      targetId: input.taskId,
      params: {
        taskId: input.taskId,
        listId: input.listId,
        statusId: input.statusId ?? null,
        from: input.from,
      },
      impact: peekedFacts,
      approvalId: input.approvalId,
      origin: ctx.origin,
      now,
      mutate: async (ledger, loaded) => {
        const plan = await planMove(ctx, ledger, input, true, accessOf(ctx, loaded, now));
        const refusal = refusalFromPlan(plan);
        if (refusal) throw new WriteRefused(refusal);
        if (plan.kind !== 'ready') throw new WriteRefused(fail('invalid_input', ORIGIN_REQUIRED));
        if (
          decideWriteImpact('move_task', impactFromPlan(plan)) === 'preview_required' &&
          decideWriteImpact('move_task', peekedFacts) === 'auto'
        ) {
          throw new AgentWriteError('preview_required', PREVIEW_REQUIRED);
        }
        const board = ctx.board ?? SQL_BOARD_MUTATOR;
        const moved = await board.apply(
          ledger,
          {
            taskId: input.taskId,
            listId: input.listId,
            statusId: plan.chosenStatusId,
            from: input.from,
            lock: true,
          },
          plan.chosenStatusId,
        );
        return {
          result: {
            taskId: moved.taskId,
            listId: moved.listId,
            statusId: moved.statusId,
            statusName: moved.statusName,
            completed: moved.completed,
            reopened: plan.currentCompleted && !moved.completed,
            subtasksMoved: moved.subtasksMoved,
            automation: moved.automation,
            actedAs: actedAs(ctx.grant),
          },
          changes: {
            subtasksMoved: moved.subtasksMoved,
            automation: moved.automation !== null,
          },
        };
      },
    });

    const body: MoveTaskResponse = {
      operation: 'move_task',
      taskId: written.result.taskId,
      listId: written.result.listId,
      statusId: written.result.statusId,
      statusName: written.result.statusName,
      completed: written.result.completed,
      reopened: written.result.reopened,
      subtasksMoved: written.result.subtasksMoved,
      automation: written.result.automation,
      executionId: written.executionId,
      replay: written.replay,
      actedAs: written.result.actedAs,
    };
    return { ok: true, body: moveTaskResponseSchema.parse(body) };
  } catch (error) {
    return catchMove(error);
  }
}

/* ───────────────────────────── F26.5 tarefas ───────────────────────────── */
/*
 * Criar, editar, atribuir, concluir e reabrir tarefa pelo agente.
 *
 * O CAMINHO É O MESMO DE `add_comment` E `move_task`
 *   `runAgentWrite` revalida a concessão (relida e travada), confere a chave
 *   de repetição, cobra o teto do dia (1 chamada = 1 escrita, decisão 4) e só
 *   então chama `mutate`, que usa os MIOLOS da tela (`…InTx`, F26.3) no MESMO
 *   `Tx` do registro. O autor é sempre `grant.ownerId` — nunca algo do corpo.
 *
 * O RECORTE DA CONEXÃO É CONFERIDO AQUI, NO CÓDIGO
 *   O banco aplica só o alcance HUMANO do dono. A concessão pode ser mais
 *   estreita (empresas e clientes escolhidos no consentimento), e isso o banco
 *   não sabe. Então, antes de gravar: a lista (ou a tarefa) precisa estar numa
 *   empresa/cliente que a CONCESSÃO alcança, e cada responsável NOVO precisa
 *   estar no diretório que a concessão enxerga (a mesma regra de
 *   `list_people`). Depois disso o banco ainda confere o dele
 *   (`can_assign_person`, `can_reach_task_for`). As duas paredes, nesta ordem.
 *
 * O QUE FICA NO REGISTRO (`changes`), DECISÃO 3
 *   O valor ANTES e DEPOIS das mudanças pequenas — responsáveis, prazo, início,
 *   prioridade, etiquetas, concluída (e a etapa, que concluir e reabrir mexem).
 *   Título e descrição NÃO entram, nem o texto nem o valor anterior: o
 *   registro é compacto por regra, e edição de texto não se desfaz. Só o NOME
 *   do campo de texto editado entra (`textEdited`), para a Fase 8 dizer "isto
 *   não volta" sem adivinhar.
 *
 * O ENSAIO (`dryRun`)
 *   Roda a mutação de verdade dentro da transação e desfaz a transação inteira
 *   (`runAgentWrite`). É a única forma de responder "eu faria isto" com a
 *   resposta EXATA e com as regras do banco aplicadas — uma conferência
 *   escrita à parte seria uma segunda versão da regra, que fica para trás.
 */

export const TASK_WRITE_DENIED = 'Esta concessão não autoriza criar ou editar tarefas (tasks:write).';
export const TASK_ASSIGN_DENIED = 'Esta concessão não autoriza definir responsáveis (tasks:assign).';
export const TASK_COMPLETE_DENIED = 'Esta concessão não autoriza concluir ou reabrir tarefas (tasks:complete).';
export const TASK_ASSIGN_ON_CREATE_DENIED =
  'Responsáveis na criação exigem também a permissão tasks:assign, que esta concessão não tem. ' +
  'Crie sem assigneeIds, ou peça ao responsável para reconectar a IA com essa permissão. Nada foi criado.';
/** A frase de entrada inválida de cada escrita de tarefa — a MESMA no MCP e na HTTP. */
export const TASK_TOOL_INVALID = {
  create_task:
    'Informe listId (UUID) ou parentId (UUID da tarefa-mãe, para criar subtarefa), title não vazio e idempotencyKey. Opcionais: clientId (UUID de search; obrigatório em lista compartilhada; na subtarefa, só o da mãe), statusId (UUID da etapa, de get_workflow da mesma lista; sem ele vale a primeira etapa), description, dueOn/startOn (AAAA-MM-DD), priority (urgent, high, normal, low), tagIds, assigneeIds, dryRun. Autor não é aceito.',
  update_task:
    'Informe taskId (UUID), idempotencyKey e ao menos um de: title, description, dueOn, startOn (AAAA-MM-DD), priority, tagIds. Opcional: dryRun.',
  assign_task:
    'Informe taskId (UUID), assigneeIds (a lista FINAL de ids de pessoa; [] tira todos) e idempotencyKey. Opcional: dryRun.',
  complete_task: 'Informe taskId (UUID) e idempotencyKey. Opcional: dryRun.',
  reopen_task: 'Informe taskId (UUID) e idempotencyKey. Opcional: dryRun.',
} as const;
const TASK_MISSING = 'Tarefa não encontrada, ou fora do seu alcance.';
const LIST_MISSING = 'Lista não encontrada, ou fora do seu alcance.';
const TASK_OUT_OF_GRANT =
  'Esta tarefa fica fora do recorte desta conexão (empresa ou cliente não concedidos). Nada foi alterado.';
const LIST_OUT_OF_GRANT =
  'Esta lista fica fora do recorte desta conexão (empresa ou cliente não concedidos). Nada foi criado.';
/**
 * F38, Fase 6 — a frase EXATA da recusa em lista compartilhada (plano F38,
 * Fase 6). O quadro tem a dele (`FRASE_LISTA_COMPARTILHADA`), para gente.
 */
export const CLIENT_REQUIRED_ON_SHARED_LIST = 'Esta lista é compartilhada: informe o cliente (clientId de search)';
const TASK_CLIENT_MISSING = 'Cliente não encontrado, ou fora do seu alcance. Nada foi criado.';
const TASK_CLIENT_OUT_OF_GRANT =
  'Este cliente fica fora do alcance de quem conectou ou do recorte desta conexão. Use search para achar um cliente concedido. Nada foi criado.';
const TASK_ARCHIVED = 'A tarefa está arquivada. Desarquive pela tela antes de mexer nela. Nada foi alterado.';
/* F38, Fase 6.4 — subtarefa pelo `create_task` com `parentId`. */
const PARENT_TASK_MISSING = 'Tarefa-mãe não encontrada, ou fora do seu alcance. Nada foi criado.';
const PARENT_TASK_OUT_OF_GRANT =
  'A tarefa-mãe fica fora do recorte desta conexão (empresa ou cliente não concedidos). Nada foi criado.';
const PARENT_TASK_ARCHIVED =
  'A tarefa-mãe está arquivada: não dá para criar subtarefa nela. Desarquive a mãe pela tela antes. Nada foi criado.';
const PARENT_TASK_OTHER_LIST =
  'A subtarefa nasce na lista da tarefa-mãe, e o listId informado é outro. Omita listId (a lista vem da mãe) ou use o da mãe. Nada foi criado.';
const PARENT_TASK_OTHER_CLIENT =
  'A subtarefa herda o cliente da tarefa-mãe, e o clientId informado não é o dela. Omita clientId para herdar. Nada foi criado.';
const TASK_ALREADY_DONE = 'A tarefa já está concluída. Nada foi alterado.';
const TASK_ALREADY_OPEN =
  'A tarefa já está aberta. Reabrir vale só para tarefa concluída — reabrir uma aberta a mandaria para a primeira etapa. Nada foi alterado.';
/** F44, Fase 8 — concluir/reabrir rodam a automação da etapa, como o arrasto. */
const TASK_AUTOMATION_OUT_OF_GRANT =
  'A automação desta etapa leva a tarefa para fora do recorte desta conexão (empresa ou cliente não concedidos). Conclua ou reabra pela tela. Nada foi alterado.';
const UPDATE_NOTHING =
  'Informe ao menos um campo para mudar: title, description, dueOn, startOn, priority, type ou tagIds. ' +
  'Etapa é move_task; responsáveis, assign_task; conclusão, complete_task ou reopen_task.';

/** O que o agente enxerga e o registro guarda da tarefa, mais o recorte dela. */
export type AgentTaskState = AgentTaskStateView & {
  taskId: string;
  companyId: string;
  clientId: string | null;
  archived: boolean;
};

export type TaskListScope = {
  companyId: string;
  clientId: string | null;
  /** F38, Fase 6 — lista compartilhada: sem cliente, exige um na criação. */
  requiresClient: boolean;
};

/** F38, Fase 6.3 — a esteira de uma lista: o nome dela e as etapas, com o tipo. */
export type ListStatuses = {
  listName: string;
  statuses: ReadonlyArray<{ id: string; name: string; color: string | null; type: 'open' | 'closed' | 'custom' }>;
};

/**
 * O port das escritas de tarefa. O SQL chama os miolos da Fase 3; a suíte usa
 * `MemoryTaskBoard`. Nenhum método aqui decide permissão de concessão: quem
 * decide é `…Work`, com a concessão relida.
 */
export type TaskMutator = {
  /** A lista de destino. `null` = não existe ou o dono não a alcança. */
  listScope(tx: AgentWriteTx, listId: string): Promise<TaskListScope | null>;
  /**
   * F38, Fase 6 — o cliente escolhido na criação, como o DONO o enxerga.
   * `null` = não existe ou fora do alcance dele.
   */
  clientForTask(tx: AgentWriteTx, clientId: string): Promise<ClienteDaNovaTarefa>;
  /**
   * F38, Fase 6.3 — a esteira RESOLVIDA da lista (a mesma de `get_workflow`),
   * na ordem das colunas. Só é perguntada quando o pedido traz `statusId`.
   */
  listStatuses(tx: AgentWriteTx, listId: string): Promise<ListStatuses>;
  /** O retrato da tarefa. `lock` trava a linha até o fim da escrita. */
  snapshot(tx: AgentWriteTx, taskId: string, lock: boolean): Promise<AgentTaskState | null>;
  /**
   * As empresas de cada pessoa que o dono enxerga no diretório. Quem não
   * aparece no mapa não está no diretório — e não pode ser atribuído.
   */
  peopleCompanies(tx: AgentWriteTx, personIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;
  create(tx: AgentWriteTx, listId: string, entrada: NewTask, autorId: string): Promise<string>;
  /**
   * F38, Fase 6.4 — a subtarefa, dentro da mãe (`createSubtaskInTx`, o mesmo
   * miolo do quadro). Lista e cliente vêm da mãe, nunca do pedido.
   */
  createSubtask(tx: AgentWriteTx, parentId: string, entrada: NewSubtaskInTx, autorId: string): Promise<string>;
  patch(tx: AgentWriteTx, taskId: string, patch: TaskPatch): Promise<void>;
  setCompleted(tx: AgentWriteTx, taskId: string, concluida: boolean, autorId: string): Promise<void>;
  /**
   * F40, Fase 9 — liberar a demanda (`liberarDemandaInTx`): grava pessoas e
   * prazo e move o card de "atribuir demanda" para a fila do tipo. Lança
   * `LiberarRecusado`, `TypeRequired` ou `BoardRefused` — a regra é a da tela.
   */
  release(
    tx: AgentWriteTx,
    input: { taskId: string; assigneeIds: string[]; dueOn: string },
    actor: ReleaseActor,
  ): Promise<{ statusId: string; statusName: string }>;
};

/** Quem libera: a pessoa da concessão, já relida e conferida como admin. */
export type ReleaseActor = Pick<
  PersonAccess,
  'userId' | 'isSuperadmin' | 'isSuper' | 'hasAllClientsAccess' | 'omittedCompanyIds'
>;

function openTx(tx: AgentWriteTx) {
  if (!tx.sqlTx) {
    throw new AgentWriteError('invalid_input', 'A transação de escrita não está aberta.');
  }
  return tx.sqlTx;
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).toLowerCase()).sort();
}

/**
 * O retrato da tarefa que o agente enxerga, num `Tx` já aberto. Exportado para
 * o desfazer em lote (F26.8) comparar o valor ATUAL com o que a IA deixou — o
 * MESMO retrato que o registro gravou em `changes`, lido pelo mesmo SQL.
 */
export async function readAgentTaskStateInTx(
  sql: Tx,
  taskId: string,
  lock: boolean,
): Promise<AgentTaskState | null> {
  // `for update of t` sob RLS também filtra pela política de UPDATE da
  // tabela (ver a armadilha em `executions.ts`): tarefa que o dono não pode
  // alterar some aqui, e a recusa é a de "fora do alcance" — que é verdade.
  const rows = await sql`
    select t.id::text as id, t.list_id::text as list_id, t.status_id::text as status_id,
           (t.completed_at is not null) as completed,
           t.due_on::text as due_on, t.start_on::text as start_on,
           t.priority::text as priority, (t.archived_at is not null) as archived,
           t.demand_type::text as demand_type,
           -- F38, Fase 6: o cliente da tarefa pela regra única (o dela, e na
           -- falta dele o da lista) — é ele que o recorte da conexão confere.
           coalesce(t.client_id, l.client_id)::text as client_id, sp.category_id::text as company_id,
           coalesce((select array_agg(a.user_id::text order by a.user_id::text)
                       from ideworks.task_assignees a where a.task_id = t.id),
                    '{}'::text[]) as assignee_ids,
           coalesce((select array_agg(g.tag_id::text order by g.tag_id::text)
                       from ideworks.task_tag_assignments g where g.task_id = t.id),
                    '{}'::text[]) as tag_ids
      from ideworks.tasks t
      join ideworks.lists l on l.id = t.list_id
      join ideworks.spaces sp on sp.id = l.space_id
     where t.id = ${taskId}::uuid
     ${lock ? sql`for update of t` : sql``}`;
  const row = rows[0];
  if (!row) return null;
  return {
    taskId: String(row.id),
    listId: String(row.list_id),
    statusId: (row.status_id as string | null) ?? null,
    completed: row.completed === true,
    dueOn: (row.due_on as string | null) ?? null,
    startOn: (row.start_on as string | null) ?? null,
    priority: (row.priority as TaskPriorityName | null) ?? null,
    type: comoTipoLido(row.demand_type),
    assigneeIds: asIdList(row.assignee_ids),
    tagIds: asIdList(row.tag_ids),
    companyId: String(row.company_id),
    clientId: (row.client_id as string | null) ?? null,
    archived: row.archived === true,
  };
}

export const SQL_TASK_MUTATOR: TaskMutator = {
  async listScope(tx, listId) {
    const sql = openTx(tx);
    const [row] = await sql`
      select l.client_id::text as client_id, l.requires_client,
             sp.category_id::text as company_id
        from ideworks.lists l
        join ideworks.spaces sp on sp.id = l.space_id
       where l.id = ${listId}::uuid`;
    if (!row) return null;
    return {
      companyId: String(row.company_id),
      clientId: (row.client_id as string | null) ?? null,
      requiresClient: row.requires_client === true,
    };
  },

  async clientForTask(tx, clientId) {
    const sql = openTx(tx);
    // Sob a política de `clients`, como o dono: o que ele não enxerga não volta.
    const [row] = await sql`
      select c.id::text as id, c.name, c.category_id::text as company_id, c.is_active,
             to_char(c.inactive_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as cancelled_on
        from ideworks.clients c
       where c.id = ${clientId}::uuid`;
    if (!row) return null;
    return {
      id: String(row.id),
      name: (row.name as string | null) ?? 'sem nome',
      companyId: (row.company_id as string | null) ?? null,
      isActive: row.is_active !== false,
      cancelledOn: (row.cancelled_on as string | null) ?? null,
    };
  },

  async listStatuses(tx, listId) {
    const sql = openTx(tx);
    // A MESMA esteira de `get_workflow` e do guarda `tasks_status_guard`
    // (`resolve_status_set`: lista → pasta → espaço), na ordem das colunas.
    const rows = await sql`
      select l.name as list_name, s.id::text as id, s.name, s.color, s.type::text as type
        from ideworks.lists l
        left join ideworks.statuses s on s.status_set_id = ideworks.resolve_status_set(l.id)
       where l.id = ${listId}::uuid
       order by s.sort_order, s.name, s.id`;
    const first = rows[0];
    return {
      listName: String(first?.list_name ?? ''),
      statuses: rows
        .filter((row) => row.id !== null)
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          color: (row.color as string | null) ?? null,
          type: (row.type as 'open' | 'closed' | 'custom') ?? 'custom',
        })),
    };
  },

  async snapshot(tx, taskId, lock) {
    return readAgentTaskStateInTx(openTx(tx), taskId, lock);
  },

  async peopleCompanies(tx, personIds) {
    const sql = openTx(tx);
    if (personIds.length === 0) return new Map();
    // O MESMO diretório de `list_people` (`team_directory()`): quem o dono
    // enxerga. A empresa de cada um é conferida contra a concessão em TS.
    const rows = await sql`
      select d.id::text as id,
             coalesce((select array_agg(uc.category_id::text)
                         from ideworks.user_categories uc where uc.user_id = d.id),
                      '{}'::text[]) as companies
        from ideworks.team_directory() d
       where d.id = any(${arrayOuNulo(personIds)}::uuid[])`;
    return new Map(
      rows.map((row) => [String(row.id).toLowerCase(), asIdList(row.companies)] as const),
    );
  },

  async create(tx, listId, entrada, autorId) {
    return createBoardTaskInTx(openTx(tx), listId, entrada, autorId);
  },

  async createSubtask(tx, parentId, entrada, autorId) {
    return createSubtaskInTx(openTx(tx), parentId, entrada, autorId);
  },

  async patch(tx, taskId, patch) {
    await patchBoardTaskInTx(openTx(tx), taskId, patch);
  },

  async setCompleted(tx, taskId, concluida, autorId) {
    await setBoardTaskCompletedInTx(openTx(tx), taskId, concluida, autorId);
  },

  async release(tx, input, actor) {
    const done = await liberarDemandaInTx(openTx(tx), actorDaPessoa(actor), input);
    return { statusId: done.statusId, statusName: done.statusName };
  },
};

/* --- o port em memória --------------------------------------------------- */

export type MemoryTaskList = {
  id: string;
  companyId: string;
  clientId: string | null;
  /** A etapa que abre (nascimento e reabertura) e a que fecha (conclusão). */
  openStatusId: string;
  closedStatusId: string;
  /** F38, Fase 6.3 — nome da lista e esteira completa. Ausentes: só a que abre e a que fecha. */
  name?: string;
  statuses?: ListStatuses['statuses'];
  /** Etiquetas do espaço da lista. Outra etiqueta é recusada, como no guarda do banco. */
  tagIds?: readonly string[];
  /** F38, Fase 6 — lista compartilhada (sem cliente, exige um na criação). */
  requiresClient?: boolean;
  /** F40 — lista de produção: a tarefa nova exige tipo (o banco decide; o dublê só repete). */
  isProduction?: boolean;
};

/** F38, Fase 6 — um cliente que o DONO enxerga. Ausente da massa = fora do alcance. */
export type MemoryTaskClient = {
  id: string;
  name: string;
  companyId: string;
  /** Ausente = ativo. */
  isActive?: boolean;
  cancelledOn?: string | null;
};

export type MemoryTaskPerson = { id: string; companyIds: readonly string[] };

/**
 * F44, Fase 8 — a regra da etapa (`task_automations`), como `move_task` a roda
 * quando concluir/reabrir leva a tarefa a uma etapa nova (F44_6).
 */
export type MemoryTaskAutomation = {
  sourceListId: string;
  triggerStatusId: string;
  /** Troca quem cuida, SUBSTITUINDO — o gesto de `set_task_assignees`. */
  assigneeId?: string | null;
  /** Encaminha a tarefa para esta lista (e etapa; ausente = a que abre). */
  targetListId?: string | null;
  targetStatusId?: string | null;
};

type MemoryTaskRow = Omit<AgentTaskState, 'type'> & {
  /** F40 — ausente = sem tipo. */
  type?: TipoDaTarefa | null;
  /** F38, Fase 6.4 — a mãe, quando a linha é subtarefa. */
  parentId?: string | null;
  title: string;
  description: string | null;
  createdBy: string;
  completedBy: string | null;
};

/**
 * Port injetável da suíte. Não fala com o banco (F0.4).
 *
 * `people` é o diretório do dono (`team_directory`); `ownerReach` espelha as
 * duas perguntas de `set_task_assignees` (`can_assign_person` e
 * `can_reach_task_for`) — nulo = o dono alcança todos do diretório.
 *
 * O ENSAIO: sem transação para desfazer, o port escreve numa CÓPIA das tarefas
 * presa ao `tx` do ensaio (`WeakMap`). A leitura seguinte no mesmo `tx` vê a
 * cópia; nenhuma outra vê.
 */
export class MemoryTaskBoard implements TaskMutator {
  readonly lists = new Map<string, MemoryTaskList>();
  readonly tasks = new Map<string, MemoryTaskRow>();
  readonly people = new Map<string, MemoryTaskPerson>();
  readonly clients = new Map<string, MemoryTaskClient>();
  readonly ownerReach: Set<string> | null;
  /** F44, Fase 8 — as regras das etapas. Vazio = nenhuma etapa automatizada. */
  readonly automations: MemoryTaskAutomation[] = [];
  mutations = 0;
  private readonly rehearsals = new WeakMap<AgentWriteTx, Map<string, MemoryTaskRow>>();

  constructor(seed: {
    lists?: readonly MemoryTaskList[];
    tasks?: ReadonlyArray<Partial<MemoryTaskRow> & { taskId: string; listId: string }>;
    people?: readonly MemoryTaskPerson[];
    clients?: readonly MemoryTaskClient[];
    ownerReach?: readonly string[] | null;
    automations?: readonly MemoryTaskAutomation[];
  } = {}) {
    this.automations.push(...(seed.automations ?? []));
    for (const list of seed.lists ?? []) this.lists.set(list.id, list);
    for (const client of seed.clients ?? []) this.clients.set(client.id.toLowerCase(), client);
    for (const person of seed.people ?? []) this.people.set(person.id.toLowerCase(), person);
    this.ownerReach = seed.ownerReach ? new Set(seed.ownerReach.map((id) => id.toLowerCase())) : null;
    for (const task of seed.tasks ?? []) {
      const list = this.lists.get(task.listId);
      this.tasks.set(task.taskId, {
        taskId: task.taskId,
        listId: task.listId,
        statusId: task.statusId ?? list?.openStatusId ?? null,
        completed: task.completed ?? false,
        dueOn: task.dueOn ?? null,
        startOn: task.startOn ?? null,
        priority: task.priority ?? null,
        type: task.type ?? null,
        assigneeIds: [...(task.assigneeIds ?? [])].sort(),
        tagIds: [...(task.tagIds ?? [])].sort(),
        companyId: list?.companyId ?? task.companyId ?? 'empresa-desconhecida',
        // F38, Fase 6 — a regra única do SQL: o da tarefa vence o da lista.
        clientId: clienteDaTarefa(task.clientId, list?.clientId),
        archived: task.archived ?? false,
        title: task.title ?? 'Tarefa',
        description: task.description ?? null,
        createdBy: task.createdBy ?? 'semente',
        completedBy: task.completedBy ?? null,
        parentId: task.parentId ?? null,
      });
    }
  }

  private rows(tx: AgentWriteTx): Map<string, MemoryTaskRow> {
    if (!tx.rehearsal) return this.tasks;
    let copy = this.rehearsals.get(tx);
    if (!copy) {
      copy = new Map([...this.tasks].map(([id, row]) => [id, structuredClone(row)]));
      this.rehearsals.set(tx, copy);
    }
    return copy;
  }

  private touched(tx: AgentWriteTx): void {
    if (!tx.rehearsal) this.mutations += 1;
  }

  private assertAssignable(row: MemoryTaskRow, next: readonly string[]): void {
    for (const id of next) {
      if (row.assigneeIds.includes(id)) continue;
      const person = this.people.get(id);
      if (!person || (this.ownerReach && !this.ownerReach.has(id))) {
        throw new BoardRefused('Você não pode atribuir tarefa a essa pessoa — ela está fora do seu alcance.', 403);
      }
      if (!person.companyIds.includes(row.companyId)) {
        throw new BoardRefused('Essa pessoa não alcança a empresa desta tarefa, e por isso não pode ser responsável por ela.', 403);
      }
    }
  }

  private assertTags(row: MemoryTaskRow, tagIds: readonly string[]): void {
    const allowed = new Set(this.lists.get(row.listId)?.tagIds ?? []);
    if (tagIds.some((id) => !allowed.has(id))) {
      throw new BoardRefused('A etiqueta não é do espaço desta tarefa.', 400);
    }
  }

  async listScope(_tx: AgentWriteTx, listId: string): Promise<TaskListScope | null> {
    const list = this.lists.get(listId);
    return list
      ? { companyId: list.companyId, clientId: list.clientId, requiresClient: list.requiresClient === true }
      : null;
  }

  async listStatuses(_tx: AgentWriteTx, listId: string): Promise<ListStatuses> {
    const list = this.lists.get(listId);
    if (!list) return { listName: '', statuses: [] };
    return {
      listName: list.name ?? list.id,
      statuses: list.statuses ?? [
        { id: list.openStatusId, name: 'Aberta', color: null, type: 'open' },
        { id: list.closedStatusId, name: 'Concluída', color: null, type: 'closed' },
      ],
    };
  }

  async clientForTask(_tx: AgentWriteTx, clientId: string): Promise<ClienteDaNovaTarefa> {
    const client = this.clients.get(clientId.toLowerCase());
    if (!client) return null;
    return {
      id: client.id,
      name: client.name,
      companyId: client.companyId,
      isActive: client.isActive !== false,
      cancelledOn: client.cancelledOn ?? null,
    };
  }

  async snapshot(tx: AgentWriteTx, taskId: string): Promise<AgentTaskState | null> {
    const row = this.rows(tx).get(taskId);
    if (!row) return null;
    return {
      taskId: row.taskId,
      listId: row.listId,
      statusId: row.statusId,
      completed: row.completed,
      dueOn: row.dueOn,
      startOn: row.startOn,
      priority: row.priority,
      type: row.type ?? null,
      assigneeIds: [...row.assigneeIds],
      tagIds: [...row.tagIds],
      companyId: row.companyId,
      clientId: row.clientId,
      archived: row.archived,
    };
  }

  async peopleCompanies(
    _tx: AgentWriteTx,
    personIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const out = new Map<string, readonly string[]>();
    for (const id of personIds) {
      const person = this.people.get(id.toLowerCase());
      if (person) out.set(id.toLowerCase(), [...person.companyIds]);
    }
    return out;
  }

  async create(tx: AgentWriteTx, listId: string, entrada: NewTask, autorId: string): Promise<string> {
    const list = this.lists.get(listId);
    if (!list) throw new BoardRefused('Lista não encontrada, ou fora do seu alcance.', 403);
    if (entrada.title.trim() === '') throw new BoardRefused('A tarefa precisa de um título.', 400);
    // F38, Fase 6 — a MESMA decisão de `createBoardTaskInTx` (e do gatilho).
    const pedido = entrada.clientId ?? null;
    const decisao = decidirClienteDaNovaTarefa(
      { clientId: list.clientId, requiresClient: list.requiresClient === true, companyId: list.companyId },
      pedido,
      pedido ? await this.clientForTask(tx, pedido) : undefined,
    );
    if (!decisao.ok) {
      throw new BoardRefused(decisao.mensagem, decisao.motivo === 'fora_do_alcance' ? 403 : 400);
    }
    // F38, Fase 6.3 — o guarda `tasks_status_guard`: a etapa tem de ser da
    // esteira da lista, e o tipo `closed` carimba a conclusão no nascimento.
    const esteira = await this.listStatuses(tx, listId);
    const etapa = entrada.statusId
      ? esteira.statuses.find((status) => status.id === entrada.statusId)
      : undefined;
    if (entrada.statusId && !etapa) {
      throw new BoardRefused('o status informado nao pertence a esteira da lista.', 400);
    }
    // F40 — a MESMA decisão de `createBoardTaskInTx`: sem tipo em lista de produção, recusa.
    const tipo = comoTipoLido(entrada.type);
    if (tipo === null && list.isProduction === true) throw new TypeRequired();
    const id = crypto.randomUUID();
    const row: MemoryTaskRow = {
      taskId: id,
      listId,
      statusId: etapa?.id ?? list.openStatusId,
      completed: etapa?.type === 'closed',
      dueOn: entrada.dueOn,
      startOn: entrada.startOn,
      priority: entrada.priority,
      type: tipo,
      assigneeIds: [],
      tagIds: [],
      companyId: list.companyId,
      clientId: decisao.clientId,
      archived: false,
      title: entrada.title.trim(),
      description: entrada.description,
      createdBy: autorId,
      completedBy: etapa?.type === 'closed' ? autorId : null,
    };
    this.assertAssignable(row, entrada.assigneeIds);
    this.assertTags(row, entrada.tagIds);
    row.assigneeIds = [...new Set(entrada.assigneeIds)].sort();
    row.tagIds = [...new Set(entrada.tagIds)].sort();
    this.rows(tx).set(id, row);
    this.touched(tx);
    return id;
  }

  /**
   * F38, Fase 6.4 — o `tasks_parent_guard`: a filha mora na lista da mãe e
   * herda o cliente dela. O dublê guarda o cliente EFETIVO (regra única), e o
   * SQL guarda o gravado da mãe; lidos pela regra, os dois dão o mesmo.
   */
  async createSubtask(tx: AgentWriteTx, parentId: string, entrada: NewSubtaskInTx, autorId: string): Promise<string> {
    if (entrada.title.trim() === '') throw new BoardRefused('A subtarefa precisa de um título.', 400);
    const rows = this.rows(tx);
    const mae = rows.get(parentId);
    if (!mae) throw new BoardRefused('Tarefa mãe não encontrada, ou fora do seu alcance.', 404);
    const list = this.lists.get(mae.listId);
    if (!list) throw new BoardRefused('Tarefa mãe não encontrada, ou fora do seu alcance.', 403);
    const esteira = await this.listStatuses(tx, mae.listId);
    const etapa = entrada.statusId
      ? esteira.statuses.find((status) => status.id === entrada.statusId)
      : undefined;
    if (entrada.statusId && !etapa) {
      throw new BoardRefused('o status informado nao pertence a esteira da lista.', 400);
    }
    const id = crypto.randomUUID();
    const row: MemoryTaskRow = {
      taskId: id,
      listId: mae.listId,
      statusId: etapa?.id ?? list.openStatusId,
      completed: etapa?.type === 'closed',
      dueOn: entrada.dueOn,
      startOn: entrada.startOn,
      priority: entrada.priority,
      type: null,
      assigneeIds: [],
      tagIds: [],
      companyId: mae.companyId,
      clientId: mae.clientId,
      archived: false,
      parentId,
      title: entrada.title.trim(),
      description: entrada.description ?? null,
      createdBy: autorId,
      completedBy: etapa?.type === 'closed' ? autorId : null,
    };
    this.assertAssignable(row, entrada.assigneeIds);
    this.assertTags(row, entrada.tagIds);
    row.assigneeIds = [...new Set(entrada.assigneeIds)].sort();
    row.tagIds = [...new Set(entrada.tagIds)].sort();
    rows.set(id, row);
    this.touched(tx);
    return id;
  }

  /** F38, Fase 6.4 — a mãe da linha (a suíte confere que a subtarefa nasceu presa). */
  parentOf(taskId: string): string | null {
    return this.tasks.get(taskId)?.parentId ?? null;
  }

  async patch(tx: AgentWriteTx, taskId: string, patch: TaskPatch): Promise<void> {
    const rows = this.rows(tx);
    const current = rows.get(taskId);
    if (!current) throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 404);
    const row = structuredClone(current);
    if (patch.title !== undefined) {
      if (patch.title.trim() === '') throw new BoardRefused('A tarefa precisa de um título.', 400);
      row.title = patch.title;
    }
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.dueOn !== undefined) row.dueOn = patch.dueOn;
    if (patch.startOn !== undefined) row.startOn = patch.startOn;
    if (patch.priority !== undefined) row.priority = patch.priority;
    if (patch.type !== undefined) {
      // F40 — como `patchBoardTaskInTx`: valor torto recusa; apagar o tipo que
      // já existe em lista de produção também; card antigo sem tipo passa.
      const tipo = comoTipoLido(patch.type);
      if (patch.type !== null && tipo === null) throw new BoardRefused('Tipo inválido. Use um destes: video, arte, foto ou outros.', 400);
      if (tipo === null && row.type && this.lists.get(row.listId)?.isProduction === true) throw new TypeRequired();
      row.type = tipo;
    }
    if (patch.assigneeIds !== undefined) {
      this.assertAssignable(row, patch.assigneeIds);
      row.assigneeIds = [...new Set(patch.assigneeIds)].sort();
    }
    if (patch.tagIds !== undefined) {
      this.assertTags(row, patch.tagIds);
      row.tagIds = [...new Set(patch.tagIds)].sort();
    }
    rows.set(taskId, row);
    this.touched(tx);
  }

  async setCompleted(tx: AgentWriteTx, taskId: string, concluida: boolean, autorId: string): Promise<void> {
    const rows = this.rows(tx);
    const current = rows.get(taskId);
    if (!current) throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 403);
    const list = this.lists.get(current.listId);
    const row = structuredClone(current);
    row.completed = concluida;
    row.completedBy = concluida ? (row.completedBy ?? autorId) : null;
    row.statusId = (concluida ? list?.closedStatusId : list?.openStatusId) ?? row.statusId;
    // F44, Fase 8 — concluir/reabrir é o arrasto (`move_task`, F44_6): chegou a
    // uma etapa NOVA, roda a regra dela, uma vez só. Na mesma etapa, nada.
    if (row.statusId !== current.statusId) this.applyAutomation(row);
    rows.set(taskId, row);
    this.touched(tx);
  }

  /** A regra da etapa em que a linha acabou de chegar — o bloco F17.41 de `move_task`. */
  private applyAutomation(row: MemoryTaskRow): void {
    const rule = this.automations.find(
      (a) => a.sourceListId === row.listId && a.triggerStatusId === row.statusId,
    );
    if (!rule) return;
    if (rule.targetListId) {
      const target = this.lists.get(rule.targetListId);
      if (!target) {
        throw new BoardRefused(
          'esta etapa encaminha a tarefa para uma lista fora do seu alcance, entao a mudanca nao foi feita. Peca a quem cuida do quadro.',
          403,
        );
      }
      // A regra única do SQL: cliente escolhido na tarefa fica; o que vinha da
      // lista passa a ser o da lista nova (o dublê guarda o EFETIVO).
      const daLista = this.lists.get(row.listId)?.clientId ?? null;
      row.clientId = row.clientId !== null && row.clientId !== daLista ? row.clientId : target.clientId;
      row.listId = target.id;
      row.companyId = target.companyId;
      row.statusId = rule.targetStatusId ?? target.openStatusId;
      const fecha =
        row.statusId === target.closedStatusId ||
        target.statuses?.find((status) => status.id === row.statusId)?.type === 'closed';
      row.completed = fecha;
      if (!fecha) row.completedBy = null;
    }
    if (rule.assigneeId) row.assigneeIds = [rule.assigneeId];
  }

  /**
   * F40, Fase 9 — as mesmas conferências de `liberarDemandaInTx`, na mesma ordem
   * e com as mesmas frases, sobre a massa em memória. A esteira vem de
   * `list.statuses` (nome normalizado, igualdade exata, como no banco).
   */
  async release(
    tx: AgentWriteTx,
    input: { taskId: string; assigneeIds: string[]; dueOn: string },
    actor: ReleaseActor,
  ): Promise<{ statusId: string; statusName: string }> {
    if (!actor.isSuperadmin) throw new BoardRefused('Liberar demanda é só para administradores.', 403);
    const pessoas = [...new Set(input.assigneeIds)];
    if (pessoas.length === 0) throw new LiberarRecusado(FRASE_SEM_PESSOA, 400, 'assignee_required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) throw new LiberarRecusado(FRASE_SEM_PRAZO, 400, 'due_required');
    const rows = this.rows(tx);
    const current = rows.get(input.taskId);
    if (!current || current.archived) throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 404);
    const esteira = await this.listStatuses(tx, current.listId);
    const atual = esteira.statuses.find((status) => status.id === current.statusId);
    if (normalizarEtapa(atual?.name) !== ETAPA_DE_ORIGEM) {
      throw new LiberarRecusado(
        `Este card não está mais em "Atribuir demanda" (etapa atual: ${atual?.name ?? 'sem etapa'}).`,
        409,
        'already_released',
      );
    }
    const tipo = comoTipoLido(current.type ?? null);
    if (tipo === null) throw new TypeRequired();
    const nomeDoDestino = ETAPA_DE_DESTINO[tipo];
    const destino = esteira.statuses.find((status) => normalizarEtapa(status.name) === nomeDoDestino);
    if (!destino) {
      throw new LiberarRecusado(
        `A lista "${esteira.listName}" não tem a etapa "${nomeDoDestino}" na esteira. Crie a etapa antes de liberar este card.`,
        409,
        'stage_missing',
      );
    }
    await this.patch(tx, input.taskId, { assigneeIds: pessoas, dueOn: input.dueOn });
    const row = this.rows(tx).get(input.taskId)!;
    this.rows(tx).set(input.taskId, { ...row, statusId: destino.id, completed: destino.type === 'closed' });
    return { statusId: destino.id, statusName: destino.name };
  }

  /** Quem criou/concluiu — a suíte confere que é o dono, nunca o corpo do pedido. */
  authorOf(taskId: string): { createdBy: string; completedBy: string | null } | null {
    const row = this.tasks.get(taskId);
    return row ? { createdBy: row.createdBy, completedBy: row.completedBy } : null;
  }
}

/* --- as conferências de `…Work` ------------------------------------------ */

type TaskAccess = AgentWriteAccess & { now: Date };

/**
 * O acesso da escrita: a concessão e a pessoa RELIDAS e travadas por
 * `runAgentWrite`, com as omitidas do pedido — F31, Fase 3b.
 *
 * A releitura dentro da transação (`loadGrant`) não conhece
 * `IDEWORKS_EMPRESAS_OMITIDAS` — ela é do Worker, não do banco. As omitidas
 * vêm da pessoa do pedido (`ctx.person`, lida pelo portão), que é a mesma
 * resolução da API humana. Sem omitida, o acesso é o de antes, campo a campo.
 */
function accessOf(ctx: WriteCtx, loaded: AgentWriteAccess, now: Date): TaskAccess {
  const omitted = ctx.person.omittedCompanyIds;
  if (!omitted || omitted.length === 0) return { ...loaded, now };
  return { ...loaded, person: { ...loaded.person, omittedCompanyIds: omitted }, now };
}

/**
 * Alvo de empresa omitida → "não encontrado", com a frase de "não encontrado"
 * que a escrita já dá — F31, Fase 3b. Dizer "fora da concessão" contaria que a
 * coisa existe; a omitida é, para o agente, o que não existe. Vem ANTES da
 * conferência da concessão pelo mesmo motivo.
 */
function refuseIfOmitted(person: PersonAccess, companyId: string | null | undefined, missing: string): void {
  if (companyOmitted(person, companyId)) throw new WriteRefused(fail('not_found', missing));
}

/** Pessoa ∩ concessão ∩ operação ∩ empresa/cliente — `decideAccess`, como em `move_task`. */
function grantReachesTask(
  access: TaskAccess,
  capability: IntegrationCapability,
  companyId: string,
  clientId: string | null,
): boolean {
  return decideAccess({
    person: access.person,
    grant: access.grant,
    operation: capability,
    companyId,
    clientId: clientId ?? undefined,
    clientCompanyId: clientId ? companyId : null,
    now: access.now,
  }).allowed;
}

/**
 * A pessoa está no diretório que a CONCESSÃO enxerga — a mesma regra de
 * `list_people`: alguma empresa dela dentro das empresas da concessão; com a
 * concessão sem recorte de empresa (`all`), qualquer pessoa do diretório.
 */
function personInGrantScope(scope: CompanyScope, companies: readonly string[]): boolean {
  if (scope.kind === 'none') return false;
  if (scope.kind === 'all') {
    // F31, Fase 3b — com omitida, a pessoa que SÓ é da empresa omitida sai,
    // como sai de `list_people`. Sem empresa nenhuma, continua (é a regra do
    // diretório com recorte `all`).
    const omitted = omittedIn(scope);
    if (omitted.length === 0 || companies.length === 0) return true;
    return companies.some((id) => !omitted.includes(id));
  }
  return companies.some((id) => scope.ids.has(id));
}

/**
 * Só quem ENTRA é conferido — o mesmo corte de `set_task_assignees` (F17.69):
 * tirar sempre pode, e regravar quem já estava sempre pode. Conferir também os
 * antigos travaria a tarefa com um vínculo legado fora do recorte.
 */
async function assertAssigneesInGrant(
  tx: AgentWriteTx,
  tasks: TaskMutator,
  access: TaskAccess,
  requested: readonly string[],
  already: readonly string[],
): Promise<void> {
  const newcomers = requested.filter((id) => !already.includes(id));
  if (newcomers.length === 0) return;
  const companies = await tasks.peopleCompanies(tx, newcomers);
  const scope = effectiveCompanies(access.person, access.grant);
  const refused = newcomers.filter((id) => {
    const found = companies.get(id);
    return !found || !personInGrantScope(scope, found);
  });
  if (refused.length > 0) {
    throw new WriteRefused(
      fail(
        'permission_denied',
        `Estas pessoas não podem ser responsáveis por esta conexão: ${refused.join(', ')}. ` +
          'Elas estão fora do alcance de quem conectou ou fora do recorte da conexão. ' +
          'Use list_people (exige people:read) para ver quem pode ser escolhido. Nada foi gravado.',
      ),
    );
  }
}

/**
 * O banco IGNORA em silêncio responsável sem perfil e etiqueta que não
 * existe (cabeçalho de `board-task.ts`). O agente não pode receber "feito"
 * sobre o que não ficou: releio e recuso — a transação inteira volta.
 */
function assertApplied(
  after: AgentTaskState,
  want: { assigneeIds?: readonly string[]; tagIds?: readonly string[] },
): void {
  if (want.assigneeIds) {
    const missing = want.assigneeIds.filter((id) => !after.assigneeIds.includes(id));
    if (missing.length > 0) {
      throw new WriteRefused(
        fail('invalid_input', `Estas pessoas não puderam ser atribuídas: ${missing.join(', ')}. Nada foi gravado.`),
      );
    }
  }
  if (want.tagIds) {
    const missing = want.tagIds.filter((id) => !after.tagIds.includes(id));
    if (missing.length > 0) {
      throw new WriteRefused(
        fail('invalid_input', `Estas etiquetas não existem no espaço da tarefa: ${missing.join(', ')}. Nada foi gravado.`),
      );
    }
  }
}

/** Ids em minúsculas e sem repetição, na ordem em que vieram. */
function normalizeIds(ids: readonly string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.toLowerCase()))];
}

function taskView(state: AgentTaskState): AgentTaskStateView {
  return {
    listId: state.listId,
    statusId: state.statusId,
    completed: state.completed,
    dueOn: state.dueOn,
    startOn: state.startOn,
    priority: state.priority,
    type: state.type,
    assigneeIds: [...state.assigneeIds],
    tagIds: [...state.tagIds],
  };
}

/** Os campos pequenos que o desfazer (Fase 8) sabe voltar. */
const SMALL_FIELDS = ['assigneeIds', 'dueOn', 'startOn', 'priority', 'type', 'tagIds', 'completed', 'statusId'] as const;
type SmallField = (typeof SMALL_FIELDS)[number];

function pickSmall(state: AgentTaskState, fields: readonly SmallField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = state[field];
    out[field] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

function descriptionTooLarge(description: string | null | undefined): WriteFailure | null {
  if (typeof description !== 'string') return null;
  if (commentBodyBytes(description) <= COMMENT_BODY_MAX_BYTES) return null;
  return fail(
    'payload_too_large',
    `A descrição passa de ${COMMENT_BODY_MAX_BYTES} bytes (64 KiB), o teto da conversa.`,
  );
}

/** Descrição vazia ou só com espaço é "sem descrição", como na tela. */
function normalizeDescription(description: string | null | undefined): string | null | undefined {
  if (description === undefined || description === null) return description;
  return description.trim() === '' ? null : description;
}

function fromTaskBoard(error: BoardRefused): WriteFailure {
  if (error instanceof TypeRequired) return typeRequired(error);
  if (error.status === 403) return fail('permission_denied', error.message);
  if (error.status === 404) return fail('not_found', error.message);
  if (error.status === 409) return fail('state_conflict', error.message);
  return fail('invalid_input', error.message);
}

function catchTask(error: unknown): WriteFailure {
  if (error instanceof WriteRefused) return error.failure;
  if (error instanceof AgentWriteError) return fromAgentError(error);
  if (error instanceof BoardRefused) return fromTaskBoard(error);
  throw error;
}

type TaskWriteResult = {
  taskId: string;
  task: AgentTaskStateView;
  actedAs: AddCommentResponse['actedAs'];
  /** F38, Fase 6.4 — só no `create_task` de subtarefa. */
  parentId?: string;
  /** F40, Fase 9 — só no `release_task`: a etapa para onde o card foi. */
  statusName?: string;
};

/** Os campos comuns das cinco respostas, a partir do que o registro devolveu. */
function taskWriteBody(written: AgentWriteSuccess<TaskWriteResult>) {
  return {
    dryRun: written.dryRun,
    task: written.result.task,
    executionId: written.executionId === '' ? null : written.executionId,
    replay: written.replay,
    actedAs: written.result.actedAs,
    ...(written.dailyWrites
      ? {
          dailyWrites: {
            used: written.dailyWrites.used,
            limit: written.dailyWrites.limit,
            resetsAt: written.dailyWrites.resetsAt.toISOString(),
          },
        }
      : {}),
  };
}

/**
 * O esqueleto das quatro escritas sobre tarefa EXISTENTE: relê travado, confere
 * o recorte da concessão e o arquivamento, muta, relê e devolve o registro.
 */
async function runExistingTaskWrite(
  ctx: WriteCtx,
  spec: {
    operation: Exclude<AgentWriteOperation, 'add_comment' | 'move_task' | 'create_task'>;
    capability: IntegrationCapability;
    taskId: string;
    idempotencyKey: string;
    dryRun: boolean;
    params: Record<string, unknown>;
    apply: (
      ledger: AgentWriteTx,
      before: AgentTaskState,
      access: TaskAccess,
    ) => Promise<{
      changed: readonly SmallField[];
      textEdited?: readonly string[];
      check?: Parameters<typeof assertApplied>[1];
      /** F40, Fase 9 — campos a mais no `changes` e no resultado (o desfazer e a resposta leem). */
      changesExtra?: Record<string, unknown>;
      resultExtra?: { statusName?: string };
    }>;
  },
): Promise<AgentWriteSuccess<TaskWriteResult>> {
  const now = ctx.now ?? new Date();
  const tasks = ctx.tasks ?? SQL_TASK_MUTATOR;
  return runAgentWrite<TaskWriteResult>({
    store: ctx.store,
    grantId: ctx.grant.id,
    operation: spec.operation,
    idempotencyKey: spec.idempotencyKey,
    targetId: spec.taskId,
    params: spec.params,
    impact: {},
    origin: ctx.origin,
    now,
    dryRun: spec.dryRun,
    mutate: async (ledger, loaded) => {
      const access = accessOf(ctx, loaded, now);
      const before = await tasks.snapshot(ledger, spec.taskId, true);
      if (!before) throw new WriteRefused(fail('not_found', TASK_MISSING));
      refuseIfOmitted(access.person, before.companyId, TASK_MISSING);
      if (!grantReachesTask(access, spec.capability, before.companyId, before.clientId)) {
        throw new WriteRefused(fail('permission_denied', TASK_OUT_OF_GRANT));
      }
      if (before.archived) throw new WriteRefused(fail('state_conflict', TASK_ARCHIVED));
      const applied = await spec.apply(ledger, before, access);
      const after = await tasks.snapshot(ledger, spec.taskId, false);
      if (!after) throw new WriteRefused(fail('not_found', TASK_MISSING));
      if (applied.check) assertApplied(after, applied.check);
      const changes: Record<string, unknown> = {
        before: pickSmall(before, applied.changed),
        after: pickSmall(after, applied.changed),
      };
      if (applied.textEdited && applied.textEdited.length > 0) changes.textEdited = [...applied.textEdited];
      if (applied.changesExtra) Object.assign(changes, applied.changesExtra);
      return {
        result: {
          taskId: spec.taskId,
          task: taskView(after),
          actedAs: actedAs(ctx.grant),
          ...(applied.resultExtra?.statusName ? { statusName: applied.resultExtra.statusName } : {}),
        },
        changes,
      };
    },
  });
}

/**
 * F38, Fase 6 — o cliente da tarefa nova, com a recusa de cada caso:
 *   · lista compartilhada sem cliente → `invalid_input` com a frase exata;
 *   · cliente que o dono não enxerga → `permission_denied`; de empresa
 *     omitida → `not_found` (a omitida não existe para o agente);
 *   · cliente fora do recorte da conexão → `permission_denied`;
 *   · cancelado, de outra lista ou de outra empresa → `invalid_input`, com a
 *     frase de `decidirClienteDaNovaTarefa` (a do cancelado traz a data) —
 *     o cancelado também quando é o da lista, herdado sem escolha.
 * Devolve o id ESCOLHIDO (ou nulo): a herança da lista é do miolo e do banco.
 */
async function decideTaskClient(
  ledger: AgentWriteTx,
  tasks: TaskMutator,
  access: TaskAccess,
  list: TaskListScope,
  requested: string | null,
): Promise<string | null> {
  let client: ClienteDaNovaTarefa | undefined;
  if (requested) {
    client = await tasks.clientForTask(ledger, requested);
    if (!client) throw new WriteRefused(fail('permission_denied', TASK_CLIENT_MISSING));
    refuseIfOmitted(access.person, client.companyId, TASK_CLIENT_MISSING);
    if (!grantReachesTask(access, 'tasks:write', client.companyId ?? list.companyId, client.id)) {
      throw new WriteRefused(fail('permission_denied', TASK_CLIENT_OUT_OF_GRANT));
    }
  }
  const decision = decidirClienteDaNovaTarefa(
    { clientId: list.clientId, requiresClient: list.requiresClient, companyId: list.companyId },
    requested,
    client,
  );
  if (decision.ok) {
    // Sem escolha, a tarefa herda o cliente da lista — e cliente cancelado não
    // recebe tarefa nova, com a mesma frase da escolha explícita e da
    // subtarefa (`decideParent`). Auditoria de 08/10/2026.
    if (!requested && list.clientId) {
      const inherited = await tasks.clientForTask(ledger, list.clientId);
      if (inherited && !inherited.isActive) {
        throw new WriteRefused(fail('invalid_input', fraseClienteCancelado(inherited.name, inherited.cancelledOn)));
      }
    }
    return requested;
  }
  if (decision.motivo === 'lista_compartilhada') {
    throw new WriteRefused(fail('invalid_input', CLIENT_REQUIRED_ON_SHARED_LIST));
  }
  if (decision.motivo === 'fora_do_alcance') throw new WriteRefused(fail('permission_denied', TASK_CLIENT_MISSING));
  throw new WriteRefused(fail('invalid_input', decision.mensagem));
}

/**
 * F38, Fase 6.3 — a etapa pedida na criação tem de ser da esteira da lista (a
 * de `get_workflow`). Outra: `status_choice_required` com as opções da lista,
 * a MESMA recusa e o MESMO formato do `move_task`, e nada é criado. O tipo
 * `closed` não é decidido aqui: nasce concluída pela regra do banco (o guarda
 * `tasks_status_guard`, a mesma que `complete_task` e `move_task` usam).
 */
async function assertStatusOfList(
  ledger: AgentWriteTx,
  tasks: TaskMutator,
  listId: string,
  statusId: string,
): Promise<void> {
  const esteira = await tasks.listStatuses(ledger, listId);
  if (esteira.statuses.length === 0) {
    throw new WriteRefused(fail('invalid_input', 'A lista não tem etapas. Nada foi criado.'));
  }
  if (esteira.statuses.some((status) => status.id.toLowerCase() === statusId)) return;
  throw new WriteRefused(
    fail('status_choice_required', CREATE_STATUS_CHOICE, {
      listId,
      listName: esteira.listName || listId,
      options: esteira.statuses.map((status) => ({ id: status.id, name: status.name, color: status.color })),
    }),
  );
}

/**
 * F38, Fase 6.4 — a tarefa-mãe da subtarefa pedida, com a recusa de cada caso:
 *   · mãe que o dono não enxerga (ou de empresa omitida) → `not_found`;
 *   · mãe fora do recorte da conexão → `permission_denied`;
 *   · mãe arquivada → `state_conflict`;
 *   · `listId` diferente da lista da mãe → `invalid_input`;
 *   · `clientId` diferente do cliente da mãe (o efetivo, pela regra única) →
 *     `invalid_input`;
 *   · cliente da mãe cancelado → `invalid_input`, com a data (a mesma regra
 *     da tarefa raiz: não se cria tarefa para cliente cancelado).
 * Subtarefa de subtarefa PASSA: o quadro tem profundidade livre
 * (`tasks_parent_guard` só recusa ciclo, e ciclo não nasce num INSERT).
 */
async function decideParent(
  ledger: AgentWriteTx,
  tasks: TaskMutator,
  access: TaskAccess,
  parentId: string,
  requestedListId: string | null,
  requestedClientId: string | null,
): Promise<AgentTaskState> {
  const parent = await tasks.snapshot(ledger, parentId, false);
  if (!parent) throw new WriteRefused(fail('not_found', PARENT_TASK_MISSING));
  refuseIfOmitted(access.person, parent.companyId, PARENT_TASK_MISSING);
  if (!grantReachesTask(access, 'tasks:write', parent.companyId, parent.clientId)) {
    throw new WriteRefused(fail('permission_denied', PARENT_TASK_OUT_OF_GRANT));
  }
  if (parent.archived) throw new WriteRefused(fail('state_conflict', PARENT_TASK_ARCHIVED));
  if (requestedListId && requestedListId !== parent.listId.toLowerCase()) {
    throw new WriteRefused(fail('invalid_input', PARENT_TASK_OTHER_LIST));
  }
  if (requestedClientId && requestedClientId !== (parent.clientId ?? '').toLowerCase()) {
    throw new WriteRefused(fail('invalid_input', PARENT_TASK_OTHER_CLIENT));
  }
  if (parent.clientId) {
    const client = await tasks.clientForTask(ledger, parent.clientId);
    if (client && !client.isActive) {
      throw new WriteRefused(fail('invalid_input', fraseClienteCancelado(client.name, client.cancelledOn)));
    }
  }
  return parent;
}

/**
 * `create_task`. Autor = dono da concessão. Responsáveis exigem `tasks:assign`
 * — recusa clara, não silêncio. O alvo do registro é a tarefa NOVA.
 *
 * F38, Fase 6.4 — com `parentId`, cria SUBTAREFA pelo mesmo miolo do quadro
 * (`createSubtaskInTx`): nasce na lista da mãe e herda o cliente dela. Entra no
 * teto, na chave de repetição e no desfazer em lote como qualquer criação.
 */
export async function createTaskWork(
  ctx: WriteCtx,
  input: CreateTaskInput,
): Promise<WriteResult<CreateTaskResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'tasks:write', now)) {
    return fail('permission_denied', TASK_WRITE_DENIED);
  }
  // O "listId OU parentId" não mora no schema (um `.refine` viraria
  // ZodEffects, e o MCP/OpenAPI precisam de um objeto simples — mesma decisão
  // de `get_workflow`). Sem nenhum dos dois, a frase de entrada inválida.
  if (!input.listId && !input.parentId) return fail('invalid_input', TASK_TOOL_INVALID.create_task);
  const assigneeIds = normalizeIds(input.assigneeIds);
  const tagIds = normalizeIds(input.tagIds);
  if (assigneeIds.length > 0 && !allowsOperation(ctx.person, ctx.grant, 'tasks:assign', now)) {
    return fail('permission_denied', TASK_ASSIGN_ON_CREATE_DENIED);
  }
  const title = input.title.trim();
  if (title === '') return fail('invalid_input', 'A tarefa precisa de um título.');
  const tooLarge = descriptionTooLarge(input.description);
  if (tooLarge) return tooLarge;

  const listId = input.listId ? input.listId.toLowerCase() : null;
  const parentId = input.parentId ? input.parentId.toLowerCase() : null;
  const requestedClientId = input.clientId ? input.clientId.toLowerCase() : null;
  const requestedStatusId = input.statusId ? input.statusId.toLowerCase() : null;
  const requestedType = input.type ?? null;
  // F40 — subtarefa não tem tipo (herda a lista da mãe, e o quadro não o pede).
  if (parentId && requestedType) {
    return fail('invalid_input', 'Subtarefa não tem tipo: informe type só ao criar a tarefa na lista, não com parentId.');
  }
  const entrada: NewTask = {
    title,
    description: normalizeDescription(input.description) ?? null,
    dueOn: input.dueOn ?? null,
    startOn: input.startOn ?? null,
    priority: input.priority ?? null,
    // F38, Fase 6.3 — `statusId` já estava nos parâmetros (nulo) antes da
    // fase: o pedido sem etapa mantém a mesma chave de repetição de sempre, e
    // só quem escolhe a etapa ganha uma chave diferente.
    statusId: requestedStatusId,
    customItemId: null,
    assigneeIds,
    tagIds,
  };
  const tasks = ctx.tasks ?? SQL_TASK_MUTATOR;
  // A chave de repetição cobre o cliente só quando ele veio: o pedido sem
  // cliente continua com os mesmos parâmetros de antes da F38. A mãe, idem
  // (F38, Fase 6.4): a criação sem `parentId` tem a chave de sempre.
  const params: Record<string, unknown> = {
    ...entrada,
    assigneeIds: [...assigneeIds].sort(),
    tagIds: [...tagIds].sort(),
  };
  if (requestedClientId) params.clientId = requestedClientId;
  if (parentId) params.parentId = parentId;
  // F40 — a chave de repetição cobre o tipo só quando ele veio.
  if (requestedType) params.type = requestedType;

  try {
    const written = await runAgentWrite<TaskWriteResult>({
      store: ctx.store,
      grantId: ctx.grant.id,
      operation: 'create_task',
      idempotencyKey: input.idempotencyKey,
      // Provisório: o alvo de verdade é a tarefa, que só existe depois da
      // mutação — ela o devolve em `targetId`.
      targetId: listId ?? (parentId as string),
      // Ordem dos ids não muda o pedido: a mesma chave com a lista em outra
      // ordem é repetição, não conflito.
      params,
      requires: assigneeIds.length > 0 ? ['tasks:assign'] : [],
      impact: {},
      origin: ctx.origin,
      now,
      dryRun: input.dryRun === true,
      mutate: async (ledger, loaded) => {
        const access = accessOf(ctx, loaded, now);
        let taskId: string;
        if (parentId) {
          const parent = await decideParent(ledger, tasks, access, parentId, listId, requestedClientId);
          if (requestedStatusId) await assertStatusOfList(ledger, tasks, parent.listId, requestedStatusId);
          await assertAssigneesInGrant(ledger, tasks, access, assigneeIds, []);
          taskId = await tasks.createSubtask(
            ledger,
            parentId,
            {
              title: entrada.title,
              description: entrada.description,
              dueOn: entrada.dueOn,
              startOn: entrada.startOn,
              priority: entrada.priority,
              statusId: entrada.statusId,
              assigneeIds: entrada.assigneeIds,
              tagIds: entrada.tagIds,
            },
            loaded.grant.ownerId,
          );
        } else {
          const rootListId = listId as string;
          const list = await tasks.listScope(ledger, rootListId);
          if (!list) throw new WriteRefused(fail('not_found', LIST_MISSING));
          refuseIfOmitted(access.person, list.companyId, LIST_MISSING);
          if (!grantReachesTask(access, 'tasks:write', list.companyId, list.clientId)) {
            throw new WriteRefused(fail('permission_denied', LIST_OUT_OF_GRANT));
          }
          const clientId = await decideTaskClient(ledger, tasks, access, list, requestedClientId);
          if (requestedStatusId) await assertStatusOfList(ledger, tasks, rootListId, requestedStatusId);
          await assertAssigneesInGrant(ledger, tasks, access, assigneeIds, []);
          try {
            taskId = await tasks.create(
              ledger,
              rootListId,
              { ...entrada, clientId, type: requestedType },
              loaded.grant.ownerId,
            );
          } catch (error) {
            // F40 — a recusa por falta de tipo diz de qual lista, para a IA corrigir.
            if (error instanceof TypeRequired) throw new WriteRefused(typeRequired(error, { listId: rootListId }));
            throw error;
          }
        }
        const after = await tasks.snapshot(ledger, taskId, false);
        if (!after) throw new WriteRefused(fail('not_found', TASK_MISSING));
        assertApplied(after, { assigneeIds, tagIds });
        return {
          targetId: taskId,
          result: {
            taskId,
            task: taskView(after),
            actedAs: actedAs(ctx.grant),
            ...(parentId ? { parentId } : {}),
          },
          changes: {
            created: true,
            listId: after.listId,
            ...(parentId ? { parentId } : {}),
            after: pickSmall(after, SMALL_FIELDS),
          },
        };
      },
    });
    const body: CreateTaskResponse = {
      operation: 'create_task',
      // No ensaio a tarefa não existe: um id fantasma induziria o agente a usá-lo.
      taskId: written.dryRun && !written.replay ? null : written.result.taskId,
      ...(written.result.parentId ? { parentId: written.result.parentId } : {}),
      ...taskWriteBody(written),
    };
    return { ok: true, body: createTaskResponseSchema.parse(body) };
  } catch (error) {
    return catchTask(error);
  }
}

/** `update_task`. Só os campos enviados mudam; título/descrição não entram no registro. */
export async function updateTaskWork(
  ctx: WriteCtx,
  input: UpdateTaskInput,
): Promise<WriteResult<UpdateTaskResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'tasks:write', now)) {
    return fail('permission_denied', TASK_WRITE_DENIED);
  }
  const patch: TaskPatch = {};
  const changed: SmallField[] = [];
  const textEdited: string[] = [];
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title === '') return fail('invalid_input', 'A tarefa precisa de um título.');
    patch.title = title;
    textEdited.push('title');
  }
  if (input.description !== undefined) {
    const tooLarge = descriptionTooLarge(input.description);
    if (tooLarge) return tooLarge;
    patch.description = normalizeDescription(input.description) ?? null;
    textEdited.push('description');
  }
  if (input.dueOn !== undefined) {
    patch.dueOn = input.dueOn;
    changed.push('dueOn');
  }
  if (input.startOn !== undefined) {
    patch.startOn = input.startOn;
    changed.push('startOn');
  }
  if (input.priority !== undefined) {
    patch.priority = input.priority;
    changed.push('priority');
  }
  if (input.type !== undefined) {
    patch.type = input.type;
    changed.push('type');
  }
  const tagIds = input.tagIds !== undefined ? normalizeIds(input.tagIds) : undefined;
  if (tagIds !== undefined) {
    patch.tagIds = tagIds;
    changed.push('tagIds');
  }
  if (changed.length === 0 && textEdited.length === 0) return fail('invalid_input', UPDATE_NOTHING);

  const tasks = ctx.tasks ?? SQL_TASK_MUTATOR;
  const taskId = input.taskId.toLowerCase();
  try {
    const written = await runExistingTaskWrite(ctx, {
      operation: 'update_task',
      capability: 'tasks:write',
      taskId,
      idempotencyKey: input.idempotencyKey,
      dryRun: input.dryRun === true,
      params: { taskId, ...patch, ...(patch.tagIds ? { tagIds: [...patch.tagIds].sort() } : {}) },
      apply: async (ledger) => {
        try {
          await tasks.patch(ledger, taskId, patch);
        } catch (error) {
          // F40 — apagar o tipo em lista de produção: diz qual tarefa e dá as opções.
          if (error instanceof TypeRequired) throw new WriteRefused(typeRequired(error, { taskId }));
          throw error;
        }
        return { changed, textEdited, check: tagIds ? { tagIds } : undefined };
      },
    });
    const body: UpdateTaskResponse = { operation: 'update_task', taskId, ...taskWriteBody(written) };
    return { ok: true, body: updateTaskResponseSchema.parse(body) };
  } catch (error) {
    return catchTask(error);
  }
}

/** `assign_task`. A lista final substitui a atual; cada pessoa NOVA passa pelo recorte. */
export async function assignTaskWork(
  ctx: WriteCtx,
  input: AssignTaskInput,
): Promise<WriteResult<AssignTaskResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'tasks:assign', now)) {
    return fail('permission_denied', TASK_ASSIGN_DENIED);
  }
  const assigneeIds = normalizeIds(input.assigneeIds);
  const tasks = ctx.tasks ?? SQL_TASK_MUTATOR;
  const taskId = input.taskId.toLowerCase();
  try {
    const written = await runExistingTaskWrite(ctx, {
      operation: 'assign_task',
      capability: 'tasks:assign',
      taskId,
      idempotencyKey: input.idempotencyKey,
      dryRun: input.dryRun === true,
      params: { taskId, assigneeIds: [...assigneeIds].sort() },
      apply: async (ledger, before, access) => {
        await assertAssigneesInGrant(ledger, tasks, access, assigneeIds, before.assigneeIds);
        await tasks.patch(ledger, taskId, { assigneeIds });
        return { changed: ['assigneeIds'], check: { assigneeIds } };
      },
    });
    const body: AssignTaskResponse = { operation: 'assign_task', taskId, ...taskWriteBody(written) };
    return { ok: true, body: assignTaskResponseSchema.parse(body) };
  } catch (error) {
    return catchTask(error);
  }
}

async function setCompletedWork(
  ctx: WriteCtx,
  input: CompleteTaskInput | ReopenTaskInput,
  concluida: boolean,
): Promise<AgentWriteSuccess<TaskWriteResult>> {
  const tasks = ctx.tasks ?? SQL_TASK_MUTATOR;
  const taskId = input.taskId.toLowerCase();
  return runExistingTaskWrite(ctx, {
    operation: concluida ? 'complete_task' : 'reopen_task',
    capability: 'tasks:complete',
    taskId,
    idempotencyKey: input.idempotencyKey,
    dryRun: input.dryRun === true,
    params: { taskId },
    apply: async (ledger, before, access) => {
      if (before.completed === concluida) {
        throw new WriteRefused(fail('state_conflict', concluida ? TASK_ALREADY_DONE : TASK_ALREADY_OPEN));
      }
      // Quem conclui é o DONO da concessão — `complete_task(p_by)` grava o
      // que recebe, então o autor nunca pode vir do pedido.
      await tasks.setCompleted(ledger, taskId, concluida, access.grant.ownerId);

      // F44, Fase 8 — concluir e reabrir são o arrasto para a etapa que fecha /
      // a primeira que abre (`move_task`), e a automação daquela etapa roda:
      // pode trocar quem cuida e pode levar a tarefa para outra lista. Relido
      // aqui, no mesmo Tx, pelas três consequências:
      const after = await tasks.snapshot(ledger, taskId, false);
      if (!after) throw new WriteRefused(fail('not_found', TASK_MISSING));
      //   1. a regra não leva a tarefa para fora do recorte — a MESMA recusa do
      //      `move_task` do agente (`resolvePlan`), e a transação inteira volta;
      if (
        companyOmitted(access.person, after.companyId) ||
        !grantReachesTask(access, 'tasks:complete', after.companyId, after.clientId)
      ) {
        throw new WriteRefused(fail('permission_denied', TASK_AUTOMATION_OUT_OF_GRANT));
      }
      //   2. responsáveis trocados pela regra entram no antes/depois, e o
      //      desfazer em lote os volta junto com a etapa;
      const changed: SmallField[] = ['completed', 'statusId'];
      if (before.assigneeIds.join(',') !== after.assigneeIds.join(',')) changed.push('assigneeIds');
      //   3. tarefa levada a outra lista é movimento de card, e movimento não se
      //      desfaz em lote (`undo.ts`): fica a marca.
      return after.listId === before.listId ? { changed } : { changed, changesExtra: { movedByAutomation: true } };
    },
  });
}

/** `complete_task`. Vai para a etapa que fecha; já concluída é `state_conflict`. */
export async function completeTaskWork(
  ctx: WriteCtx,
  input: CompleteTaskInput,
): Promise<WriteResult<CompleteTaskResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'tasks:complete', now)) {
    return fail('permission_denied', TASK_COMPLETE_DENIED);
  }
  try {
    const written = await setCompletedWork(ctx, input, true);
    const body: CompleteTaskResponse = {
      operation: 'complete_task',
      taskId: written.result.taskId,
      ...taskWriteBody(written),
    };
    return { ok: true, body: completeTaskResponseSchema.parse(body) };
  } catch (error) {
    return catchTask(error);
  }
}

/** `reopen_task`. Só tarefa concluída; aberta é `state_conflict`, sem mexer na etapa. */
export async function reopenTaskWork(
  ctx: WriteCtx,
  input: ReopenTaskInput,
): Promise<WriteResult<ReopenTaskResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'tasks:complete', now)) {
    return fail('permission_denied', TASK_COMPLETE_DENIED);
  }
  try {
    const written = await setCompletedWork(ctx, input, false);
    const body: ReopenTaskResponse = {
      operation: 'reopen_task',
      taskId: written.result.taskId,
      ...taskWriteBody(written),
    };
    return { ok: true, body: reopenTaskResponseSchema.parse(body) };
  } catch (error) {
    return catchTask(error);
  }
}

/* ───────────────────────── F40, Fase 9 — liberar a demanda ───────────────────────── */
/*
 * `release_task`: o OK do painel "Controle da semana", pela IA.
 *
 * A REGRA É A DA TELA — `liberarDemandaInTx` (`server/liberar-demanda.ts`), a
 * mesma da rota `POST /admin/semana/liberar`: grava responsáveis e prazo e move
 * o card de "atribuir demanda" para a fila do tipo, na mesma lista, numa
 * transação só. Recusas: `type_required`, `assignee_required`, `due_required`,
 * `already_released`, `stage_missing`.
 *
 * CONCESSÃO DE ADMIN
 *   Não há escopo de admin no banco (o enum é fechado; criar um pede migration).
 *   Vale, então: a PESSOA é admin agora (`person.isSuperadmin`, relida dentro da
 *   transação) E a concessão carrega as TRÊS permissões que a liberação exerce
 *   — `tasks:assign` (pessoas), `tasks:write` (prazo) e `tasks:move` (a etapa).
 *   Sem qualquer uma: `permission_denied`.
 *
 * O REGISTRO
 *   A operação gravada no ledger é `assign_task`: a coluna `operation` do banco
 *   é uma lista fechada (`integration_executions_operation_sane`), e um nome novo
 *   pede migration. A chave de repetição é a do `release_task` (os parâmetros
 *   levam `release: true`, então a mesma chave num `assign_task` é conflito, não
 *   replay), o teto diário e o desfazer em lote valem como em qualquer escrita.
 *   `changes` guarda antes/depois de responsáveis, prazo e etapa e a marca
 *   `released: true`; o desfazer em lote devolve o card para "atribuir
 *   demanda", sem os responsáveis e com o prazo de antes.
 */

export const RELEASE_CAPABILITIES = ['tasks:assign', 'tasks:write', 'tasks:move'] as const satisfies readonly IntegrationCapability[];
export const RELEASE_DENIED =
  'Esta concessão não autoriza liberar demandas: exige tasks:assign, tasks:write e tasks:move, e que quem conectou seja administrador.';
export const RELEASE_ADMIN_ONLY =
  'Liberar demanda é só para administradores: a pessoa desta conexão não tem esse papel agora. Nada foi gravado.';
export const RELEASE_TOOL_INVALID =
  'Informe taskId (UUID), assigneeIds (pelo menos uma pessoa, ids de list_people), dueOn (AAAA-MM-DD) e idempotencyKey. Opcional: dryRun.';

function fromRelease(error: unknown, taskId: string): never {
  if (error instanceof TypeRequired) throw new WriteRefused(typeRequired(error, { taskId }));
  if (error instanceof LiberarRecusado) {
    throw new WriteRefused(fail(error.code, error.message, { taskId }));
  }
  throw error;
}

/** `release_task`. Só admin; pessoas ∩ concessão como em `assign_task`; a regra da tela. */
export async function releaseTaskWork(
  ctx: WriteCtx,
  input: ReleaseTaskInput,
): Promise<WriteResult<ReleaseTaskResponse>> {
  const now = ctx.now ?? new Date();
  if (!RELEASE_CAPABILITIES.every((capability) => allowsOperation(ctx.person, ctx.grant, capability, now))) {
    return fail('permission_denied', RELEASE_DENIED);
  }
  if (!ctx.person.isSuperadmin) return fail('permission_denied', RELEASE_ADMIN_ONLY);
  const assigneeIds = normalizeIds(input.assigneeIds);
  const tasks = ctx.tasks ?? SQL_TASK_MUTATOR;
  const taskId = input.taskId.toLowerCase();
  try {
    const written = await runExistingTaskWrite(ctx, {
      operation: 'assign_task',
      capability: 'tasks:assign',
      taskId,
      idempotencyKey: input.idempotencyKey,
      dryRun: input.dryRun === true,
      params: { release: true, taskId, assigneeIds: [...assigneeIds].sort(), dueOn: input.dueOn },
      apply: async (ledger, before, access) => {
        // O papel RELIDO dentro da transação, junto com a concessão.
        if (!access.person.isSuperadmin) throw new WriteRefused(fail('permission_denied', RELEASE_ADMIN_ONLY));
        for (const capability of RELEASE_CAPABILITIES) {
          if (!grantReachesTask(access, capability, before.companyId, before.clientId)) {
            throw new WriteRefused(fail('permission_denied', TASK_OUT_OF_GRANT));
          }
        }
        await assertAssigneesInGrant(ledger, tasks, access, assigneeIds, before.assigneeIds);
        let destino: { statusId: string; statusName: string };
        try {
          destino = await tasks.release(ledger, { taskId, assigneeIds, dueOn: input.dueOn }, access.person);
        } catch (error) {
          fromRelease(error, taskId);
        }
        return {
          changed: ['assigneeIds', 'dueOn', 'statusId'],
          check: { assigneeIds },
          changesExtra: { released: true },
          resultExtra: { statusName: destino.statusName },
        };
      },
    });
    const body: ReleaseTaskResponse = {
      operation: 'release_task',
      taskId,
      statusName: written.result.statusName ?? written.result.task.statusId ?? 'liberado',
      ...taskWriteBody(written),
    };
    return { ok: true, body: releaseTaskResponseSchema.parse(body) };
  } catch (error) {
    return catchTask(error);
  }
}

/* ─────────────────────── F26.6 mural e histórico ─────────────────────── */
/*
 * Criar e editar nota do mural e registro do histórico do cliente pelo agente.
 *
 * O CAMINHO É O MESMO DAS ESCRITAS DE TAREFA (F26.5)
 *   `runAgentWrite` revalida a concessão, confere a chave de repetição, cobra o
 *   teto do dia e só então chama `mutate`, que usa os MIOLOS da tela
 *   (`createNotaInTx`, `updateNotaInTx`, `createEventInTx`, `updateEventInTx`,
 *   F26.3) no MESMO `Tx` do registro. Autor = `grant.ownerId`, nunca o corpo.
 *
 * O RECORTE DA CONEXÃO É CONFERIDO AQUI; A AUTORIA, NO BANCO
 *   O cliente — o do pedido, ou o da LINHA relida sob RLS, na edição — precisa
 *   estar numa empresa/cliente que a CONCESSÃO alcança (`decideAccess`): isso o
 *   banco não sabe. Já "a IA só edita o que a IA da mesma pessoa escreveu" é do
 *   banco (gatilho `agent_client_record_guard`, F26.2), e NÃO é repetido aqui:
 *   uma conferência escrita à parte seria uma segunda versão da regra. O miolo
 *   traduz o 42501 do gatilho em `MuralRefused`/`HistoryRefused` 403, com a
 *   frase dele, e a recusa chega ao agente como `permission_denied`.
 *
 *   POR QUE `permission_denied`, E NÃO `state_conflict`
 *     A regra é de AUTORIZAÇÃO — quem pode editar a linha —, e não depende de
 *     nada que mude: reler e repetir (que é o que `state_conflict` pede ao
 *     agente) daria a mesma recusa para sempre. É também o que o banco diz
 *     (42501, "insufficient privilege") e o 403 que o miolo já devolve à tela.
 *
 * O QUE FICA NO REGISTRO (`changes`)
 *   Só metadados: o cliente, e antes/depois dos campos pequenos — a cor da nota;
 *   a data e quem conduziu (id) do registro. Título, texto, subtítulo e "quem
 *   conduziu" em texto livre NÃO entram, nem o valor novo nem o antigo: só o
 *   NOME do campo editado (`textEdited`), para a Fase 8 dizer "isto não volta".
 *
 * O ENSAIO (`dryRun`) é o da F26.5: a mutação roda de verdade, com o gatilho do
 * banco aplicando a regra de autoria, e a transação inteira é desfeita.
 */

export const MURAL_WRITE_DENIED =
  'Esta concessão não autoriza escrever no mural do cliente (clients:mural:write).';
export const HISTORY_WRITE_DENIED =
  'Esta concessão não autoriza registrar no histórico do cliente (clients:history:write).';
/** A frase de entrada inválida de cada escrita — a MESMA no MCP e na HTTP. */
export const CLIENT_RECORD_TOOL_INVALID = {
  add_mural_note:
    'Informe clientId (UUID), content não vazio e idempotencyKey. Opcionais: title (até 500 caracteres), color (yellow, green, blue, red), dryRun. Autor não é aceito.',
  update_mural_note:
    'Informe noteId (UUID), idempotencyKey e ao menos um de: title (null tira o título), content, color (yellow, green, blue, red). Opcional: dryRun.',
  add_history_entry:
    'Informe clientId (UUID), happenedOn (AAAA-MM-DD), title, body e idempotencyKey. Opcionais: subtitle, ledBy (id de pessoa), ledByNote (texto livre), dryRun. Autor não é aceito.',
  update_history_entry:
    'Informe entryId (UUID), idempotencyKey e ao menos um de: happenedOn (AAAA-MM-DD), title, subtitle, body, ledBy, ledByNote. Opcional: dryRun.',
} as const;

/**
 * As frases do gatilho `agent_client_record_guard` (F26.2), LITERAIS. Quem
 * recusa é o banco; estas cópias servem ao port em memória, que imita o
 * gatilho, e um teste as prende à migration — se a frase mudar lá, ele acusa.
 */
export const AGENT_MURAL_GUARD_MESSAGE =
  'A IA só edita ou apaga notas do mural que ela mesma escreveu em seu nome. Esta nota foi escrita por uma pessoa ou pela IA de outra pessoa; quem quiser mudá-la muda pela tela.';
export const AGENT_HISTORY_GUARD_MESSAGE =
  'A IA só edita ou apaga registros do histórico do cliente que ela mesma escreveu em seu nome. Este registro foi escrito por uma pessoa ou pela IA de outra pessoa; quem quiser mudá-lo muda pela tela.';

const CLIENT_MISSING = 'Cliente não encontrado, ou fora do seu alcance.';
const CLIENT_OUT_OF_GRANT =
  'Este cliente fica fora do recorte desta conexão (empresa ou cliente não concedidos). Nada foi gravado.';
const NOTE_MISSING = 'Nota não encontrada, ou fora do seu alcance.';
const ENTRY_MISSING = 'Registro do histórico não encontrado, ou fora do seu alcance.';
const NOTE_UPDATE_NOTHING = 'Informe ao menos um campo para mudar: title, content ou color.';
const ENTRY_UPDATE_NOTHING =
  'Informe ao menos um campo para mudar: happenedOn, title, subtitle, body, ledBy ou ledByNote.';

/** O cliente de uma escrita e a empresa dele — o que o recorte da concessão confere. */
export type ClientRecordScope = { clientId: string; companyId: string };

/** A nota como o port a relê. O texto fica NA MEMÓRIA da escrita, nunca no registro. */
export type AgentMuralNoteState = {
  noteId: string;
  clientId: string;
  companyId: string;
  title: string | null;
  content: string;
  color: MuralNoteColor;
  createdBy: string | null;
  viaName: string | null;
};

/** O registro do histórico como o port o relê. Idem: o texto não sai daqui. */
export type AgentHistoryEntryState = {
  entryId: string;
  clientId: string;
  companyId: string;
  happenedOn: string;
  title: string;
  subtitle: string | null;
  body: string;
  ledBy: string | null;
  ledByNote: string | null;
  createdBy: string | null;
  viaName: string | null;
};

/**
 * O port das escritas de mural e histórico. O SQL chama os miolos da F26.3; a
 * suíte usa `MemoryClientRecordBoard`. Nenhum método decide permissão de
 * concessão (quem decide é `…Work`), nem a regra de autoria (quem decide é o
 * gatilho do banco — e o port em memória, que o imita).
 */
export type ClientRecordMutator = {
  /** O cliente. `null` = não existe ou o dono não o alcança. */
  clientScope(tx: AgentWriteTx, clientId: string): Promise<ClientRecordScope | null>;
  /** O mesmo diretório de `TaskMutator.peopleCompanies` — para "quem conduziu". */
  peopleCompanies(tx: AgentWriteTx, personIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>>;
  /** A nota, com o cliente dela. `lock` trava a linha até o fim da escrita. */
  note(tx: AgentWriteTx, noteId: string, lock: boolean): Promise<AgentMuralNoteState | null>;
  createNote(tx: AgentWriteTx, clientId: string, entrada: Partial<EntradaDeNota>, autorId: string): Promise<string>;
  updateNote(tx: AgentWriteTx, noteId: string, patch: Partial<EntradaDeNota>): Promise<void>;
  /** O registro, com o cliente dele. `lock` trava a linha até o fim da escrita. */
  entry(tx: AgentWriteTx, entryId: string, lock: boolean): Promise<AgentHistoryEntryState | null>;
  createEntry(tx: AgentWriteTx, clientId: string, entrada: EntradaDeEvento, autorId: string): Promise<string>;
  /** O miolo do histórico regrava a linha INTEIRA: quem chama manda a entrada completa. */
  updateEntry(tx: AgentWriteTx, entryId: string, entrada: EntradaDeEvento): Promise<void>;
};

const asDay = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

export const SQL_CLIENT_RECORD_MUTATOR: ClientRecordMutator = {
  async clientScope(tx, clientId) {
    const sql = openTx(tx);
    // Sob RLS: cliente que o dono não alcança some, e a recusa é "fora do alcance".
    const [row] = await sql`
      select c.id::text as id, c.category_id::text as company_id
        from ideworks.clients c
       where c.id = ${clientId}::uuid`;
    if (!row) return null;
    return { clientId: String(row.id), companyId: String(row.company_id) };
  },

  async peopleCompanies(tx, personIds) {
    return SQL_TASK_MUTATOR.peopleCompanies(tx, personIds);
  },

  async note(tx, noteId, lock) {
    const sql = openTx(tx);
    // O cliente sai DA LINHA, relida sob RLS — nunca do pedido. `for update of
    // n` trava só a nota, e sob RLS também filtra pela política de UPDATE.
    const rows = await sql`
      select n.id::text as id, n.client_id::text as client_id,
             c.category_id::text as company_id,
             n.title, n.content, n.color::text as color,
             n.created_by::text as created_by, n.via_name
        from ideworks.mural_notes n
        join ideworks.clients c on c.id = n.client_id
       where n.id = ${noteId}::uuid
       ${lock ? sql`for update of n` : sql``}`;
    const row = rows[0];
    if (!row) return null;
    return {
      noteId: String(row.id),
      clientId: String(row.client_id),
      companyId: String(row.company_id),
      title: (row.title as string | null) ?? null,
      content: String(row.content ?? ''),
      color: row.color as MuralNoteColor,
      createdBy: (row.created_by as string | null) ?? null,
      viaName: (row.via_name as string | null) ?? null,
    };
  },

  async createNote(tx, clientId, entrada, autorId) {
    return createNotaInTx(openTx(tx), clientId, entrada, autorId);
  },

  async updateNote(tx, noteId, patch) {
    await updateNotaInTx(openTx(tx), noteId, patch);
  },

  async entry(tx, entryId, lock) {
    const sql = openTx(tx);
    const rows = await sql`
      select h.id::text as id, h.client_id::text as client_id,
             c.category_id::text as company_id,
             h.happened_on, h.title, h.subtitle, h.body,
             h.led_by::text as led_by, h.led_by_note,
             h.created_by::text as created_by, h.via_name
        from ideworks.client_history h
        join ideworks.clients c on c.id = h.client_id
       where h.id = ${entryId}::uuid
       ${lock ? sql`for update of h` : sql``}`;
    const row = rows[0];
    if (!row) return null;
    return {
      entryId: String(row.id),
      clientId: String(row.client_id),
      companyId: String(row.company_id),
      happenedOn: asDay(row.happened_on),
      title: String(row.title ?? ''),
      subtitle: (row.subtitle as string | null) ?? null,
      body: String(row.body ?? ''),
      ledBy: (row.led_by as string | null) ?? null,
      ledByNote: (row.led_by_note as string | null) ?? null,
      createdBy: (row.created_by as string | null) ?? null,
      viaName: (row.via_name as string | null) ?? null,
    };
  },

  async createEntry(tx, clientId, entrada, autorId) {
    return createEventInTx(openTx(tx), clientId, entrada, autorId);
  },

  async updateEntry(tx, entryId, entrada) {
    await updateEventInTx(openTx(tx), entryId, entrada);
  },
};

/* --- o port em memória --------------------------------------------------- */

export type MemoryRecordClient = { id: string; companyId: string };

/**
 * Port injetável da suíte. Não fala com o banco (F0.4).
 *
 * IMITA OS DOIS GATILHOS DA F26.2: toda linha criada por aqui sai com
 * `createdBy` = dono e `viaName` = o nome da conexão (`stamp_agent_origin`); e
 * editar linha que não seja "do dono, via IA" recusa com a frase LITERAL do
 * banco (`agent_client_record_guard`). `ownerReach` = clientes que o dono
 * alcança (nulo = todos) — o RLS humano.
 *
 * O ENSAIO: como em `MemoryTaskBoard`, a escrita vai para uma cópia presa ao
 * `tx` do ensaio, e nenhuma outra leitura a vê.
 */
export class MemoryClientRecordBoard implements ClientRecordMutator {
  readonly clients = new Map<string, MemoryRecordClient>();
  readonly people = new Map<string, MemoryTaskPerson>();
  readonly notes = new Map<string, AgentMuralNoteState>();
  readonly entries = new Map<string, AgentHistoryEntryState>();
  readonly ownerReach: Set<string> | null;
  mutations = 0;
  /**
   * O autor que cada criação RECEBEU de quem chamou. No banco o gatilho força
   * a autoria de qualquer jeito; aqui a suíte confere que `…Work` já manda o
   * dono da concessão, e nunca algo do pedido.
   */
  readonly authorArgs: string[] = [];
  private readonly rehearsals = new WeakMap<
    AgentWriteTx,
    { notes: Map<string, AgentMuralNoteState>; entries: Map<string, AgentHistoryEntryState> }
  >();

  constructor(
    private readonly agent: { ownerId: string; viaName: string },
    seed: {
      clients?: readonly MemoryRecordClient[];
      people?: readonly MemoryTaskPerson[];
      ownerReach?: readonly string[] | null;
      notes?: ReadonlyArray<Partial<AgentMuralNoteState> & { noteId: string; clientId: string }>;
      entries?: ReadonlyArray<Partial<AgentHistoryEntryState> & { entryId: string; clientId: string }>;
    } = {},
  ) {
    for (const client of seed.clients ?? []) this.clients.set(client.id, client);
    for (const person of seed.people ?? []) this.people.set(person.id.toLowerCase(), person);
    this.ownerReach = seed.ownerReach ? new Set(seed.ownerReach) : null;
    for (const note of seed.notes ?? []) {
      this.notes.set(note.noteId, {
        noteId: note.noteId,
        clientId: note.clientId,
        companyId: this.clients.get(note.clientId)?.companyId ?? 'empresa-desconhecida',
        title: note.title ?? null,
        content: note.content ?? 'Nota',
        color: note.color ?? 'yellow',
        createdBy: note.createdBy ?? null,
        viaName: note.viaName ?? null,
      });
    }
    for (const entry of seed.entries ?? []) {
      this.entries.set(entry.entryId, {
        entryId: entry.entryId,
        clientId: entry.clientId,
        companyId: this.clients.get(entry.clientId)?.companyId ?? 'empresa-desconhecida',
        happenedOn: entry.happenedOn ?? '2026-09-01',
        title: entry.title ?? 'Registro',
        subtitle: entry.subtitle ?? null,
        body: entry.body ?? 'Relato',
        ledBy: entry.ledBy ?? null,
        ledByNote: entry.ledByNote ?? null,
        createdBy: entry.createdBy ?? null,
        viaName: entry.viaName ?? null,
      });
    }
  }

  private tables(tx: AgentWriteTx) {
    if (!tx.rehearsal) return { notes: this.notes, entries: this.entries };
    let copy = this.rehearsals.get(tx);
    if (!copy) {
      copy = {
        notes: new Map([...this.notes].map(([id, row]) => [id, structuredClone(row)])),
        entries: new Map([...this.entries].map(([id, row]) => [id, structuredClone(row)])),
      };
      this.rehearsals.set(tx, copy);
    }
    return copy;
  }

  private touched(tx: AgentWriteTx): void {
    if (!tx.rehearsal) this.mutations += 1;
  }

  private reaches(clientId: string): MemoryRecordClient | null {
    const client = this.clients.get(clientId);
    if (!client) return null;
    if (this.ownerReach && !this.ownerReach.has(clientId)) return null;
    return client;
  }

  /** `agent_client_record_guard`: a IA só mexe no que a IA da MESMA pessoa criou. */
  private ownAgentRow(row: { createdBy: string | null; viaName: string | null }): boolean {
    return row.createdBy === this.agent.ownerId && row.viaName !== null;
  }

  async clientScope(_tx: AgentWriteTx, clientId: string): Promise<ClientRecordScope | null> {
    const client = this.reaches(clientId);
    return client ? { clientId: client.id, companyId: client.companyId } : null;
  }

  async peopleCompanies(
    _tx: AgentWriteTx,
    personIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const out = new Map<string, readonly string[]>();
    for (const id of personIds) {
      const person = this.people.get(id.toLowerCase());
      if (person) out.set(id.toLowerCase(), [...person.companyIds]);
    }
    return out;
  }

  async note(tx: AgentWriteTx, noteId: string): Promise<AgentMuralNoteState | null> {
    const row = this.tables(tx).notes.get(noteId);
    if (!row || !this.reaches(row.clientId)) return null;
    return { ...row };
  }

  async createNote(
    tx: AgentWriteTx,
    clientId: string,
    entrada: Partial<EntradaDeNota>,
    autorId: string,
  ): Promise<string> {
    const client = this.reaches(clientId);
    if (!client) throw new MuralRefused('Cliente não encontrado, ou fora do seu alcance.', 403);
    const content = (entrada.content ?? '').trim();
    if (content === '') throw new MuralRefused('A nota precisa de conteúdo.', 400);
    const color = entrada.color ?? 'yellow';
    if (!(['yellow', 'green', 'blue', 'red'] as const).includes(color as MuralNoteColor)) {
      throw new MuralRefused(`Cor desconhecido: "${color}".`, 400);
    }
    const id = crypto.randomUUID();
    const title = (entrada.title ?? '').trim();
    this.tables(tx).notes.set(id, {
      noteId: id,
      clientId,
      companyId: client.companyId,
      title: title === '' ? null : title,
      content,
      color: color as MuralNoteColor,
      // O gatilho força a autoria para quem age, o que for que o chamador mande.
      createdBy: this.agent.ownerId,
      viaName: this.agent.viaName,
    });
    this.authorArgs.push(autorId);
    this.touched(tx);
    return id;
  }

  async updateNote(tx: AgentWriteTx, noteId: string, patch: Partial<EntradaDeNota>): Promise<void> {
    const notes = this.tables(tx).notes;
    const current = notes.get(noteId);
    if (!current || !this.reaches(current.clientId)) {
      throw new MuralRefused('Nota não encontrada, ou fora do seu alcance.', 404);
    }
    if (!this.ownAgentRow(current)) throw new MuralRefused(AGENT_MURAL_GUARD_MESSAGE, 403);
    const row = { ...current };
    if (patch.title !== undefined) {
      const title = (patch.title ?? '').trim();
      row.title = title === '' ? null : title;
    }
    if (patch.content !== undefined) {
      const content = patch.content.trim();
      if (content === '') throw new MuralRefused('A nota precisa de conteúdo.', 400);
      row.content = content;
    }
    if (patch.color !== undefined) row.color = patch.color as MuralNoteColor;
    notes.set(noteId, row);
    this.touched(tx);
  }

  async entry(tx: AgentWriteTx, entryId: string): Promise<AgentHistoryEntryState | null> {
    const row = this.tables(tx).entries.get(entryId);
    if (!row || !this.reaches(row.clientId)) return null;
    return { ...row };
  }

  private conferir(entrada: EntradaDeEvento): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.happenedOn)) {
      throw new HistoryRefused('Informe a data em que o evento aconteceu.', 400);
    }
    if (entrada.title.trim() === '') throw new HistoryRefused('O evento precisa de um título.', 400);
    if (entrada.body.trim() === '') {
      throw new HistoryRefused('Escreva o que aconteceu — um evento sem relato não informa nada.', 400);
    }
  }

  async createEntry(
    tx: AgentWriteTx,
    clientId: string,
    entrada: EntradaDeEvento,
    autorId: string,
  ): Promise<string> {
    const client = this.reaches(clientId);
    if (!client) throw new HistoryRefused('Cliente não encontrado, ou fora do seu alcance.', 403);
    this.conferir(entrada);
    const id = crypto.randomUUID();
    this.tables(tx).entries.set(id, {
      entryId: id,
      clientId,
      companyId: client.companyId,
      happenedOn: entrada.happenedOn,
      title: entrada.title.trim(),
      subtitle: entrada.subtitle,
      body: entrada.body.trim(),
      ledBy: entrada.ledBy,
      ledByNote: entrada.ledByNote,
      createdBy: this.agent.ownerId,
      viaName: this.agent.viaName,
    });
    this.authorArgs.push(autorId);
    this.touched(tx);
    return id;
  }

  async updateEntry(tx: AgentWriteTx, entryId: string, entrada: EntradaDeEvento): Promise<void> {
    const entries = this.tables(tx).entries;
    const current = entries.get(entryId);
    if (!current || !this.reaches(current.clientId)) {
      throw new HistoryRefused('Evento não encontrado, ou fora do seu alcance.', 404);
    }
    if (!this.ownAgentRow(current)) throw new HistoryRefused(AGENT_HISTORY_GUARD_MESSAGE, 403);
    this.conferir(entrada);
    entries.set(entryId, {
      ...current,
      happenedOn: entrada.happenedOn,
      title: entrada.title.trim(),
      subtitle: entrada.subtitle,
      body: entrada.body.trim(),
      ledBy: entrada.ledBy,
      ledByNote: entrada.ledByNote,
    });
    this.touched(tx);
  }
}

/* --- as conferências de `…Work` ------------------------------------------ */

/** O recorte da concessão sobre o cliente — o mesmo `decideAccess` das tarefas. */
function grantReachesRecord(
  access: TaskAccess,
  capability: IntegrationCapability,
  scope: { clientId: string; companyId: string },
): boolean {
  return grantReachesTask(access, capability, scope.companyId, scope.clientId);
}

/** Vazio e "só espaços" são a mesma coisa, e viram nulo — como na tela. */
function trimOrNull(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

function recordTextTooLarge(field: string, text: string): WriteFailure | null {
  if (commentBodyBytes(text) <= AGENT_RECORD_TEXT_MAX_BYTES) return null;
  return fail(
    'payload_too_large',
    `O campo ${field} passa de ${AGENT_RECORD_TEXT_MAX_BYTES} bytes (32 KiB) — o teto para a IA conseguir ler de volta, numa página, o que escreveu.`,
  );
}

/**
 * "Quem conduziu", quando é pessoa do time, precisa estar no diretório que a
 * CONCESSÃO enxerga — a mesma regra dos responsáveis (e de `list_people`). Id
 * fora dele nem chega ao banco: seria uma pessoa que esta conexão não pode
 * nomear, ou um id que nem é de perfil.
 */
async function assertLedByInGrant(
  tx: AgentWriteTx,
  records: ClientRecordMutator,
  access: TaskAccess,
  ledBy: string,
): Promise<void> {
  const companies = await records.peopleCompanies(tx, [ledBy]);
  const found = companies.get(ledBy);
  if (found && personInGrantScope(effectiveCompanies(access.person, access.grant), found)) return;
  throw new WriteRefused(
    fail(
      'permission_denied',
      `Esta pessoa não pode ser indicada como quem conduziu, por esta conexão: ${ledBy}. ` +
        'Ela está fora do alcance de quem conectou ou fora do recorte da conexão. ' +
        'Use list_people (exige people:read) para achar a pessoa; para gente de fora do time, use ledByNote. Nada foi gravado.',
    ),
  );
}

/**
 * A recusa do miolo. 403 é o RLS (cliente fora do alcance humano) OU o gatilho
 * de autoria da F26.2 — e nos dois a frase vem como o banco a escreveu.
 */
function fromRecordRefused(error: MuralRefused | HistoryRefused): WriteFailure {
  if (error.status === 403) return fail('permission_denied', error.message);
  if (error.status === 404) return fail('not_found', error.message);
  return fail('invalid_input', error.message);
}

function catchClientRecord(error: unknown): WriteFailure {
  if (error instanceof WriteRefused) return error.failure;
  if (error instanceof AgentWriteError) return fromAgentError(error);
  if (error instanceof MuralRefused || error instanceof HistoryRefused) return fromRecordRefused(error);
  throw error;
}

function noteView(state: AgentMuralNoteState): AgentMuralNoteStateView {
  return { clientId: state.clientId, color: state.color, viaName: state.viaName };
}

function entryView(state: AgentHistoryEntryState): AgentHistoryEntryStateView {
  return {
    clientId: state.clientId,
    happenedOn: state.happenedOn,
    ledById: state.ledBy,
    viaName: state.viaName,
  };
}

type NoteWriteResult = {
  noteId: string;
  note: AgentMuralNoteStateView;
  actedAs: AddCommentResponse['actedAs'];
};

type EntryWriteResult = {
  entryId: string;
  entry: AgentHistoryEntryStateView;
  actedAs: AddCommentResponse['actedAs'];
};

/** Os campos comuns das quatro respostas, a partir do que o registro devolveu. */
function recordWriteBody(written: AgentWriteSuccess<{ actedAs: AddCommentResponse['actedAs'] }>) {
  return {
    dryRun: written.dryRun,
    executionId: written.executionId === '' ? null : written.executionId,
    replay: written.replay,
    actedAs: written.result.actedAs,
    ...(written.dailyWrites
      ? {
          dailyWrites: {
            used: written.dailyWrites.used,
            limit: written.dailyWrites.limit,
            resetsAt: written.dailyWrites.resetsAt.toISOString(),
          },
        }
      : {}),
  };
}

/** `add_mural_note`. Autor = dono; o alvo do registro é a nota NOVA. */
export async function addMuralNoteWork(
  ctx: WriteCtx,
  input: AddMuralNoteInput,
): Promise<WriteResult<AddMuralNoteResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'clients:mural:write', now)) {
    return fail('permission_denied', MURAL_WRITE_DENIED);
  }
  const content = input.content.trim();
  if (content === '') return fail('invalid_input', 'A nota precisa de conteúdo.');
  const tooLarge = recordTextTooLarge('content', content);
  if (tooLarge) return tooLarge;
  const title = trimOrNull(input.title);
  const color: MuralNoteColor = input.color ?? 'yellow';
  const clientId = input.clientId.toLowerCase();
  const records = ctx.clientRecords ?? SQL_CLIENT_RECORD_MUTATOR;

  try {
    const written = await runAgentWrite<NoteWriteResult>({
      store: ctx.store,
      grantId: ctx.grant.id,
      operation: 'add_mural_note',
      idempotencyKey: input.idempotencyKey,
      // Provisório: o alvo de verdade é a nota, devolvida pela mutação.
      targetId: clientId,
      params: { clientId, title, content, color },
      impact: {},
      origin: ctx.origin,
      now,
      dryRun: input.dryRun === true,
      mutate: async (ledger, loaded) => {
        const access = accessOf(ctx, loaded, now);
        const scope = await records.clientScope(ledger, clientId);
        if (!scope) throw new WriteRefused(fail('not_found', CLIENT_MISSING));
        refuseIfOmitted(access.person, scope.companyId, CLIENT_MISSING);
        if (!grantReachesRecord(access, 'clients:mural:write', scope)) {
          throw new WriteRefused(fail('permission_denied', CLIENT_OUT_OF_GRANT));
        }
        const noteId = await records.createNote(ledger, clientId, { title, content, color }, loaded.grant.ownerId);
        const after = await records.note(ledger, noteId, false);
        if (!after) throw new WriteRefused(fail('not_found', NOTE_MISSING));
        return {
          targetId: noteId,
          result: { noteId, note: noteView(after), actedAs: actedAs(ctx.grant) },
          changes: { created: true, clientId: after.clientId, after: { color: after.color } },
        };
      },
    });
    const body: AddMuralNoteResponse = {
      operation: 'add_mural_note',
      noteId: written.dryRun && !written.replay ? null : written.result.noteId,
      note: written.result.note,
      ...recordWriteBody(written),
    };
    return { ok: true, body: addMuralNoteResponseSchema.parse(body) };
  } catch (error) {
    return catchClientRecord(error);
  }
}

/** `update_mural_note`. Só os campos enviados mudam; o gatilho decide a autoria. */
export async function updateMuralNoteWork(
  ctx: WriteCtx,
  input: UpdateMuralNoteInput,
): Promise<WriteResult<UpdateMuralNoteResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'clients:mural:write', now)) {
    return fail('permission_denied', MURAL_WRITE_DENIED);
  }
  const patch: Partial<EntradaDeNota> = {};
  const textEdited: string[] = [];
  let colorChanged = false;
  if (input.title !== undefined) {
    patch.title = trimOrNull(input.title);
    textEdited.push('title');
  }
  if (input.content !== undefined) {
    const content = input.content.trim();
    if (content === '') return fail('invalid_input', 'A nota precisa de conteúdo.');
    const tooLarge = recordTextTooLarge('content', content);
    if (tooLarge) return tooLarge;
    patch.content = content;
    textEdited.push('content');
  }
  if (input.color !== undefined) {
    patch.color = input.color;
    colorChanged = true;
  }
  if (textEdited.length === 0 && !colorChanged) return fail('invalid_input', NOTE_UPDATE_NOTHING);

  const records = ctx.clientRecords ?? SQL_CLIENT_RECORD_MUTATOR;
  const noteId = input.noteId.toLowerCase();
  try {
    const written = await runAgentWrite<NoteWriteResult>({
      store: ctx.store,
      grantId: ctx.grant.id,
      operation: 'update_mural_note',
      idempotencyKey: input.idempotencyKey,
      targetId: noteId,
      params: { noteId, ...patch },
      impact: {},
      origin: ctx.origin,
      now,
      dryRun: input.dryRun === true,
      mutate: async (ledger, loaded) => {
        const access = accessOf(ctx, loaded, now);
        const before = await records.note(ledger, noteId, true);
        if (!before) throw new WriteRefused(fail('not_found', NOTE_MISSING));
        refuseIfOmitted(access.person, before.companyId, NOTE_MISSING);
        if (!grantReachesRecord(access, 'clients:mural:write', before)) {
          throw new WriteRefused(fail('permission_denied', CLIENT_OUT_OF_GRANT));
        }
        await records.updateNote(ledger, noteId, patch);
        const after = await records.note(ledger, noteId, false);
        if (!after) throw new WriteRefused(fail('not_found', NOTE_MISSING));
        const changes: Record<string, unknown> = {
          clientId: after.clientId,
          before: colorChanged ? { color: before.color } : {},
          after: colorChanged ? { color: after.color } : {},
        };
        if (textEdited.length > 0) changes.textEdited = [...textEdited];
        return {
          result: { noteId, note: noteView(after), actedAs: actedAs(ctx.grant) },
          changes,
        };
      },
    });
    const body: UpdateMuralNoteResponse = {
      operation: 'update_mural_note',
      noteId,
      note: written.result.note,
      ...recordWriteBody(written),
    };
    return { ok: true, body: updateMuralNoteResponseSchema.parse(body) };
  } catch (error) {
    return catchClientRecord(error);
  }
}

/** `add_history_entry`. Autor = dono; "quem conduziu" do time passa pelo recorte. */
export async function addHistoryEntryWork(
  ctx: WriteCtx,
  input: AddHistoryEntryInput,
): Promise<WriteResult<AddHistoryEntryResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'clients:history:write', now)) {
    return fail('permission_denied', HISTORY_WRITE_DENIED);
  }
  const title = input.title.trim();
  if (title === '') return fail('invalid_input', 'O evento precisa de um título.');
  const body = input.body.trim();
  if (body === '') {
    return fail('invalid_input', 'Escreva o que aconteceu — um evento sem relato não informa nada.');
  }
  const tooLarge = recordTextTooLarge('body', body);
  if (tooLarge) return tooLarge;
  const entrada: EntradaDeEvento = {
    happenedOn: input.happenedOn,
    title,
    subtitle: trimOrNull(input.subtitle),
    body,
    ledBy: input.ledBy ? input.ledBy.toLowerCase() : null,
    ledByNote: trimOrNull(input.ledByNote),
  };
  const clientId = input.clientId.toLowerCase();
  const records = ctx.clientRecords ?? SQL_CLIENT_RECORD_MUTATOR;

  try {
    const written = await runAgentWrite<EntryWriteResult>({
      store: ctx.store,
      grantId: ctx.grant.id,
      operation: 'add_history_entry',
      idempotencyKey: input.idempotencyKey,
      targetId: clientId,
      params: { clientId, ...entrada },
      impact: {},
      origin: ctx.origin,
      now,
      dryRun: input.dryRun === true,
      mutate: async (ledger, loaded) => {
        const access = accessOf(ctx, loaded, now);
        const scope = await records.clientScope(ledger, clientId);
        if (!scope) throw new WriteRefused(fail('not_found', CLIENT_MISSING));
        refuseIfOmitted(access.person, scope.companyId, CLIENT_MISSING);
        if (!grantReachesRecord(access, 'clients:history:write', scope)) {
          throw new WriteRefused(fail('permission_denied', CLIENT_OUT_OF_GRANT));
        }
        if (entrada.ledBy) await assertLedByInGrant(ledger, records, access, entrada.ledBy);
        const entryId = await records.createEntry(ledger, clientId, entrada, loaded.grant.ownerId);
        const after = await records.entry(ledger, entryId, false);
        if (!after) throw new WriteRefused(fail('not_found', ENTRY_MISSING));
        return {
          targetId: entryId,
          result: { entryId, entry: entryView(after), actedAs: actedAs(ctx.grant) },
          changes: {
            created: true,
            clientId: after.clientId,
            after: { happenedOn: after.happenedOn, ledById: after.ledBy },
          },
        };
      },
    });
    const out: AddHistoryEntryResponse = {
      operation: 'add_history_entry',
      entryId: written.dryRun && !written.replay ? null : written.result.entryId,
      entry: written.result.entry,
      ...recordWriteBody(written),
    };
    return { ok: true, body: addHistoryEntryResponseSchema.parse(out) };
  } catch (error) {
    return catchClientRecord(error);
  }
}

/**
 * `update_history_entry`. Só os campos enviados mudam: o miolo regrava a linha
 * inteira, então a entrada completa sai da linha relida + o que veio.
 */
export async function updateHistoryEntryWork(
  ctx: WriteCtx,
  input: UpdateHistoryEntryInput,
): Promise<WriteResult<UpdateHistoryEntryResponse>> {
  const now = ctx.now ?? new Date();
  if (!allowsOperation(ctx.person, ctx.grant, 'clients:history:write', now)) {
    return fail('permission_denied', HISTORY_WRITE_DENIED);
  }
  const patch: Partial<EntradaDeEvento> = {};
  const textEdited: string[] = [];
  const small: Array<'happenedOn' | 'ledById'> = [];
  if (input.happenedOn !== undefined) {
    patch.happenedOn = input.happenedOn;
    small.push('happenedOn');
  }
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title === '') return fail('invalid_input', 'O evento precisa de um título.');
    patch.title = title;
    textEdited.push('title');
  }
  if (input.subtitle !== undefined) {
    patch.subtitle = trimOrNull(input.subtitle);
    textEdited.push('subtitle');
  }
  if (input.body !== undefined) {
    const body = input.body.trim();
    if (body === '') {
      return fail('invalid_input', 'Escreva o que aconteceu — um evento sem relato não informa nada.');
    }
    const tooLarge = recordTextTooLarge('body', body);
    if (tooLarge) return tooLarge;
    patch.body = body;
    textEdited.push('body');
  }
  if (input.ledBy !== undefined) {
    patch.ledBy = input.ledBy ? input.ledBy.toLowerCase() : null;
    small.push('ledById');
  }
  if (input.ledByNote !== undefined) {
    patch.ledByNote = trimOrNull(input.ledByNote);
    textEdited.push('ledByNote');
  }
  if (textEdited.length === 0 && small.length === 0) return fail('invalid_input', ENTRY_UPDATE_NOTHING);

  const records = ctx.clientRecords ?? SQL_CLIENT_RECORD_MUTATOR;
  const entryId = input.entryId.toLowerCase();
  const pickEntry = (state: AgentHistoryEntryState) => {
    const out: Record<string, unknown> = {};
    if (small.includes('happenedOn')) out.happenedOn = state.happenedOn;
    if (small.includes('ledById')) out.ledById = state.ledBy;
    return out;
  };
  try {
    const written = await runAgentWrite<EntryWriteResult>({
      store: ctx.store,
      grantId: ctx.grant.id,
      operation: 'update_history_entry',
      idempotencyKey: input.idempotencyKey,
      targetId: entryId,
      params: { entryId, ...patch },
      impact: {},
      origin: ctx.origin,
      now,
      dryRun: input.dryRun === true,
      mutate: async (ledger, loaded) => {
        const access = accessOf(ctx, loaded, now);
        const before = await records.entry(ledger, entryId, true);
        if (!before) throw new WriteRefused(fail('not_found', ENTRY_MISSING));
        refuseIfOmitted(access.person, before.companyId, ENTRY_MISSING);
        if (!grantReachesRecord(access, 'clients:history:write', before)) {
          throw new WriteRefused(fail('permission_denied', CLIENT_OUT_OF_GRANT));
        }
        // Só quem ENTRA é conferido: manter a pessoa que já estava sempre pode.
        if (patch.ledBy && patch.ledBy !== before.ledBy) {
          await assertLedByInGrant(ledger, records, access, patch.ledBy);
        }
        const full: EntradaDeEvento = {
          happenedOn: patch.happenedOn ?? before.happenedOn,
          title: patch.title ?? before.title,
          subtitle: patch.subtitle !== undefined ? patch.subtitle : before.subtitle,
          body: patch.body ?? before.body,
          ledBy: patch.ledBy !== undefined ? patch.ledBy : before.ledBy,
          ledByNote: patch.ledByNote !== undefined ? patch.ledByNote : before.ledByNote,
        };
        await records.updateEntry(ledger, entryId, full);
        const after = await records.entry(ledger, entryId, false);
        if (!after) throw new WriteRefused(fail('not_found', ENTRY_MISSING));
        const changes: Record<string, unknown> = {
          clientId: after.clientId,
          before: pickEntry(before),
          after: pickEntry(after),
        };
        if (textEdited.length > 0) changes.textEdited = [...textEdited];
        return {
          result: { entryId, entry: entryView(after), actedAs: actedAs(ctx.grant) },
          changes,
        };
      },
    });
    const out: UpdateHistoryEntryResponse = {
      operation: 'update_history_entry',
      entryId,
      entry: written.result.entry,
      ...recordWriteBody(written),
    };
    return { ok: true, body: updateHistoryEntryResponseSchema.parse(out) };
  } catch (error) {
    return catchClientRecord(error);
  }
}
