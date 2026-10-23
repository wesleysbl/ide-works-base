/**
 * Adaptador HTTP versionado — F16.3a + F16.3b + F16.3c + F16.4a + F16.4b + F16.7 + F16.8.
 *
 * Superfície: `/api/integrations/v1`. OpenAPI público em `/openapi.json`.
 * `get_context` no prefixo e em `/get_context`. Leituras: `search`,
 * `get_board`, `get_task`, `get_client`, `list_comments`, `list_people`,
 * `get_person_work`, `get_delivery_report`, `get_marketing_report`.
 * Escrita: `add_comment` e `move_task` (POST). Prévia: `preview_move`.
 * F26.5: `create_task`, `update_task`, `assign_task`, `complete_task` e
 * `reopen_task` (POST, cabeçalho `Idempotency-Key` aceito como nas outras).
 * F26.6: leitura `get_client_mural` e `get_client_history`; escrita
 * `add_mural_note`, `update_mural_note`, `add_history_entry` e
 * `update_history_entry` (mesma tabela de rotas das de tarefa).
 * F26.7: leitura `get_client_delivery_history` e `get_delivery_trend`
 * (entrega mês a mês, a mesma fórmula de `get_delivery_report`).
 * F38: leitura `get_delivery_status` (última entrega pela Semanal, só ativos).
 * Token MCP não entra aqui: a audiência
 * continua a cargo do provedor OAuth. Gestão `/connections` é sessão
 * humana e nem passa por este despacho.
 *
 * Autorização mora nas operações (`reads.ts` / `context.ts` / `reports.ts` /
 * `marketing.ts` / `writes.ts`), não neste arquivo. O MCP em `mcp.ts`
 * despacha as mesmas operações.
 */

import {
  ADD_COMMENT_PATH,
  ADD_HISTORY_ENTRY_PATH,
  ADD_MURAL_NOTE_PATH,
  GET_CLIENT_DELIVERY_HISTORY_PATH,
  GET_CLIENT_HISTORY_PATH,
  GET_CLIENT_MURAL_PATH,
  GET_ADMIN_WEEK_PATH,
  RELEASE_TASK_PATH,
  GET_DELIVERY_STATUS_PATH,
  GET_CALENDAR_PATH,
  GET_CLIENT_MONTH_PATH,
  GET_DELIVERY_TREND_PATH,
  GET_MONTH_ATTENTION_PATH,
  GET_PLANNING_WEEKS_PATH,
  GET_WORKFLOW_PATH,
  LIST_BOARDS_INPUT_MESSAGE,
  LIST_BOARDS_PATH,
  LIST_CLIENTS_INPUT_MESSAGE,
  LIST_CLIENTS_PATH,
  LIST_TASKS_INPUT_MESSAGE,
  LIST_TASKS_PATH,
  LIST_TAGS_INPUT_MESSAGE,
  LIST_TAGS_PATH,
  UPDATE_HISTORY_ENTRY_PATH,
  CALENDAR_INPUT_MESSAGE,
  CLIENT_MONTH_INPUT_MESSAGE,
  DELIVERY_STATUS_INPUT_MESSAGE,
  MONTH_ATTENTION_INPUT_MESSAGE,
  PLANNING_WEEKS_INPUT_MESSAGE,
  WORKFLOW_INPUT_MESSAGE,
  UPDATE_MURAL_NOTE_PATH,
  addHistoryEntryInputSchema,
  addMuralNoteInputSchema,
  getClientHistoryInputSchema,
  getClientMuralInputSchema,
  updateHistoryEntryInputSchema,
  updateMuralNoteInputSchema,
  ASSIGN_TASK_PATH,
  COMPLETE_TASK_PATH,
  CONNECTIONS_PATH,
  CREATE_TASK_PATH,
  REOPEN_TASK_PATH,
  UPDATE_TASK_PATH,
  INTEGRATION_WRITES_UNAVAILABLE_MESSAGE,
  GET_BOARD_PATH,
  GET_CLIENT_PATH,
  GET_CONTEXT_PATH,
  GET_DELIVERY_REPORT_PATH,
  GET_MARKETING_REPORT_PATH,
  GET_PERSON_WORK_PATH,
  GET_TASK_PATH,
  HTTP_INTEGRATIONS_PATH,
  LIST_COMMENTS_PATH,
  LIST_PEOPLE_PATH,
  MOVE_TASK_PATH,
  OPENAPI_PATH,
  PREVIEW_MOVE_PATH,
  SEARCH_PATH,
  addCommentInputSchema,
  addCommentResponseSchema,
  assignTaskInputSchema,
  completeTaskInputSchema,
  createTaskInputSchema,
  getBoardInputSchema,
  getClientInputSchema,
  getContextInputSchema,
  getContextResponseSchema,
  getClientDeliveryHistoryInputSchema,
  getDeliveryReportInputSchema,
  getDeliveryTrendInputSchema,
  getPlanningWeeksInputSchema,
  getCalendarInputSchema,
  getClientMonthInputSchema,
  getMonthAttentionInputSchema,
  listTagsInputSchema,
  listClientsInputSchema,
  listBoardsInputSchema,
  listTasksInputSchema,
  getDeliveryStatusInputSchema,
  ADMIN_WEEK_INPUT_MESSAGE,
  getAdminWeekInputSchema,
  releaseTaskInputSchema,
  getWorkflowInputSchema,
  getMarketingReportInputSchema,
  getPersonWorkInputSchema,
  getTaskInputSchema,
  integrationError,
  integrationOpenApi,
  jsonBody,
  listCommentsInputSchema,
  listPeopleInputSchema,
  moveTaskInputSchema,
  moveTaskResponseSchema,
  previewMoveInputSchema,
  previewMoveResponseSchema,
  reopenTaskInputSchema,
  searchInputSchema,
  updateTaskInputSchema,
} from '@/integrations/contract';
import { getAdminWeek, type AdminWeekCatalog } from '@/integrations/admin-semana';
import { getCalendar, getClientMonth } from '@/integrations/client-month';
import { getMonthAttention } from '@/integrations/month-attention';
import {
  EMPTY_CATALOG,
  getContext,
  lerEscopoDoCatalogo,
  type IntegrationCatalog,
  type IntegrationScope,
} from '@/integrations/context';
import {
  allowsOperation,
  type IntegrationCapability,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import {
  EMPTY_WORK_CATALOG,
  getBoardWork,
  clientHistoryInputMessage,
  getClientHistoryWork,
  getClientMuralWork,
  getClientWork,
  getPersonWork,
  getTaskWork,
  listCommentsWork,
  getWorkflowWork,
  listTagsWork,
  listClientsWork,
  listBoardsWork,
  listTasksWork,
  listPeopleWork,
  searchWork,
  type ReadFailure,
  type WorkCatalog,
} from '@/integrations/reads';
import {
  EMPTY_DELIVERY_CATALOG,
  getClientDeliveryHistory,
  getDeliveryReport,
  getDeliveryTrend,
  getPlanningWeeks,
  getDeliveryStatus,
  type DeliveryCatalog,
} from '@/integrations/reports';
import {
  EMPTY_MARKETING_CATALOG,
  getMarketingReport,
  type MarketingCatalog,
} from '@/integrations/marketing';
import type { ExecutionOrigin } from '@/server/db';
import { MemoryAgentWriteStore, type AgentWriteStore } from '@/integrations/executions';
import {
  CLIENT_RECORD_TOOL_INVALID,
  HISTORY_WRITE_DENIED,
  MURAL_WRITE_DENIED,
  SQL_BOARD_MUTATOR,
  SQL_CLIENT_RECORD_MUTATOR,
  SQL_COMMENT_MUTATOR,
  SQL_TASK_MUTATOR,
  TASK_ASSIGN_DENIED,
  RELEASE_DENIED,
  RELEASE_TOOL_INVALID,
  releaseTaskWork,
  TASK_COMPLETE_DENIED,
  TASK_TOOL_INVALID,
  TASK_WRITE_DENIED,
  addCommentWork,
  addHistoryEntryWork,
  addMuralNoteWork,
  assignTaskWork,
  completeTaskWork,
  createTaskWork,
  moveTaskWork,
  previewMoveWork,
  reopenTaskWork,
  updateHistoryEntryWork,
  updateMuralNoteWork,
  updateTaskWork,
  type BoardMutator,
  type ClientRecordMutator,
  type CommentMutator,
  type TaskMutator,
  type WriteCtx,
  type WriteFailure,
  type WriteResult,
} from '@/integrations/writes';

export {
  GET_CONTEXT_PATH,
  OPENAPI_PATH,
  HTTP_INTEGRATIONS_PATH,
  CONNECTIONS_PATH,
  SEARCH_PATH,
  GET_BOARD_PATH,
  GET_TASK_PATH,
  GET_CLIENT_PATH,
  LIST_COMMENTS_PATH,
  LIST_PEOPLE_PATH,
  GET_PERSON_WORK_PATH,
  GET_DELIVERY_REPORT_PATH,
  GET_MARKETING_REPORT_PATH,
  ADD_COMMENT_PATH,
  PREVIEW_MOVE_PATH,
  MOVE_TASK_PATH,
  CREATE_TASK_PATH,
  UPDATE_TASK_PATH,
  ASSIGN_TASK_PATH,
  COMPLETE_TASK_PATH,
  REOPEN_TASK_PATH,
  GET_CLIENT_MURAL_PATH,
  GET_CLIENT_HISTORY_PATH,
  ADD_MURAL_NOTE_PATH,
  UPDATE_MURAL_NOTE_PATH,
  ADD_HISTORY_ENTRY_PATH,
  UPDATE_HISTORY_ENTRY_PATH,
  GET_CLIENT_DELIVERY_HISTORY_PATH,
  GET_DELIVERY_TREND_PATH,
  GET_WORKFLOW_PATH,
  GET_PLANNING_WEEKS_PATH,
  GET_DELIVERY_STATUS_PATH,
  GET_MONTH_ATTENTION_PATH,
  GET_CLIENT_MONTH_PATH,
  GET_CALENDAR_PATH,
  LIST_TAGS_PATH,
  LIST_CLIENTS_PATH,
  LIST_BOARDS_PATH,
  LIST_TASKS_PATH,
  GET_ADMIN_WEEK_PATH,
  RELEASE_TASK_PATH,
};

/**
 * F26.5 — as escritas de tarefa, uma linha por rota; F26.6 — as de mural e
 * histórico, na MESMA tabela. Tabela, e não um `if` copiado por rota: a ordem
 * das conferências (chave geral → permissão → contrato → operação) é a mesma
 * de `move_task` e mora num lugar só (`writeRoute`).
 */
type WriteRoute = {
  capability: IntegrationCapability;
  denied: string;
  run: (ctx: WriteCtx, body: Record<string, unknown>) => Promise<WriteResult<unknown> | 'invalid'>;
  invalid: string;
};

function parseAndRun<I>(
  schema: { safeParse(value: unknown): { success: true; data: I } | { success: false } },
  work: (ctx: WriteCtx, input: I) => Promise<WriteResult<unknown>>,
) {
  return async (ctx: WriteCtx, body: Record<string, unknown>) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return 'invalid' as const;
    return work(ctx, parsed.data);
  };
}

const WRITE_ROUTES: Record<string, WriteRoute> = {
  [CREATE_TASK_PATH]: {
    capability: 'tasks:write',
    denied: TASK_WRITE_DENIED,
    run: parseAndRun(createTaskInputSchema, createTaskWork),
    invalid: TASK_TOOL_INVALID.create_task,
  },
  [UPDATE_TASK_PATH]: {
    capability: 'tasks:write',
    denied: TASK_WRITE_DENIED,
    run: parseAndRun(updateTaskInputSchema, updateTaskWork),
    invalid: TASK_TOOL_INVALID.update_task,
  },
  [ASSIGN_TASK_PATH]: {
    capability: 'tasks:assign',
    denied: TASK_ASSIGN_DENIED,
    run: parseAndRun(assignTaskInputSchema, assignTaskWork),
    invalid: TASK_TOOL_INVALID.assign_task,
  },
  [COMPLETE_TASK_PATH]: {
    capability: 'tasks:complete',
    denied: TASK_COMPLETE_DENIED,
    run: parseAndRun(completeTaskInputSchema, completeTaskWork),
    invalid: TASK_TOOL_INVALID.complete_task,
  },
  [REOPEN_TASK_PATH]: {
    capability: 'tasks:complete',
    denied: TASK_COMPLETE_DENIED,
    run: parseAndRun(reopenTaskInputSchema, reopenTaskWork),
    invalid: TASK_TOOL_INVALID.reopen_task,
  },
  // F40, Fase 9 — liberar a demanda (só admin; as três permissões são conferidas no `Work`).
  [RELEASE_TASK_PATH]: {
    capability: 'tasks:assign',
    denied: RELEASE_DENIED,
    run: parseAndRun(releaseTaskInputSchema, releaseTaskWork),
    invalid: RELEASE_TOOL_INVALID,
  },
  [ADD_MURAL_NOTE_PATH]: {
    capability: 'clients:mural:write',
    denied: MURAL_WRITE_DENIED,
    run: parseAndRun(addMuralNoteInputSchema, addMuralNoteWork),
    invalid: CLIENT_RECORD_TOOL_INVALID.add_mural_note,
  },
  [UPDATE_MURAL_NOTE_PATH]: {
    capability: 'clients:mural:write',
    denied: MURAL_WRITE_DENIED,
    run: parseAndRun(updateMuralNoteInputSchema, updateMuralNoteWork),
    invalid: CLIENT_RECORD_TOOL_INVALID.update_mural_note,
  },
  [ADD_HISTORY_ENTRY_PATH]: {
    capability: 'clients:history:write',
    denied: HISTORY_WRITE_DENIED,
    run: parseAndRun(addHistoryEntryInputSchema, addHistoryEntryWork),
    invalid: CLIENT_RECORD_TOOL_INVALID.add_history_entry,
  },
  [UPDATE_HISTORY_ENTRY_PATH]: {
    capability: 'clients:history:write',
    denied: HISTORY_WRITE_DENIED,
    run: parseAndRun(updateHistoryEntryInputSchema, updateHistoryEntryWork),
    invalid: CLIENT_RECORD_TOOL_INVALID.update_history_entry,
  },
};

export function isOpenApiPath(pathname: string): boolean {
  return pathname === OPENAPI_PATH;
}

export function isHttpIntegrationApiPath(pathname: string): boolean {
  if (pathname === CONNECTIONS_PATH || pathname.startsWith(`${CONNECTIONS_PATH}/`)) return false;
  if (pathname === OPENAPI_PATH) return false;
  return pathname === HTTP_INTEGRATIONS_PATH || pathname.startsWith(`${HTTP_INTEGRATIONS_PATH}/`);
}

function isGetContextPath(pathname: string): boolean {
  return pathname === HTTP_INTEGRATIONS_PATH || pathname === GET_CONTEXT_PATH;
}

type ReadOp =
  | 'search'
  | 'get_board'
  | 'get_task'
  | 'get_client'
  | 'list_comments'
  | 'list_people'
  | 'get_person_work'
  | 'get_delivery_report'
  | 'get_marketing_report'
  | 'get_client_mural'
  | 'get_client_history'
  | 'get_client_delivery_history'
  | 'get_delivery_trend'
  | 'get_workflow'
  | 'get_planning_weeks'
  | 'get_delivery_status'
  | 'get_month_attention'
  | 'get_client_month'
  | 'get_calendar'
  | 'list_tags'
  | 'list_clients'
  | 'list_boards'
  | 'list_tasks'
  | 'get_admin_week';

function readOpFromPath(pathname: string): ReadOp | null {
  if (pathname === SEARCH_PATH) return 'search';
  if (pathname === GET_BOARD_PATH) return 'get_board';
  if (pathname === GET_TASK_PATH) return 'get_task';
  if (pathname === GET_CLIENT_PATH) return 'get_client';
  if (pathname === LIST_COMMENTS_PATH) return 'list_comments';
  if (pathname === LIST_PEOPLE_PATH) return 'list_people';
  if (pathname === GET_PERSON_WORK_PATH) return 'get_person_work';
  if (pathname === GET_DELIVERY_REPORT_PATH) return 'get_delivery_report';
  if (pathname === GET_MARKETING_REPORT_PATH) return 'get_marketing_report';
  if (pathname === GET_CLIENT_MURAL_PATH) return 'get_client_mural';
  if (pathname === GET_CLIENT_HISTORY_PATH) return 'get_client_history';
  if (pathname === GET_CLIENT_DELIVERY_HISTORY_PATH) return 'get_client_delivery_history';
  if (pathname === GET_DELIVERY_TREND_PATH) return 'get_delivery_trend';
  if (pathname === GET_WORKFLOW_PATH) return 'get_workflow';
  if (pathname === GET_PLANNING_WEEKS_PATH) return 'get_planning_weeks';
  if (pathname === GET_DELIVERY_STATUS_PATH) return 'get_delivery_status';
  if (pathname === GET_MONTH_ATTENTION_PATH) return 'get_month_attention';
  if (pathname === GET_CLIENT_MONTH_PATH) return 'get_client_month';
  if (pathname === GET_CALENDAR_PATH) return 'get_calendar';
  if (pathname === LIST_TAGS_PATH) return 'list_tags';
  if (pathname === LIST_CLIENTS_PATH) return 'list_clients';
  if (pathname === LIST_BOARDS_PATH) return 'list_boards';
  if (pathname === LIST_TASKS_PATH) return 'list_tasks';
  if (pathname === GET_ADMIN_WEEK_PATH) return 'get_admin_week';
  return null;
}

async function readStrictObject(request: Request): Promise<Record<string, unknown> | Response> {
  const length = request.headers.get('Content-Length');
  if (request.method === 'GET') return {};
  if (length === '0' || length === null) {
    const text = await request.text();
    if (text.trim() === '') return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return integrationError('invalid_input', 'O corpo precisa ser um objeto JSON.');
      }
      return parsed as Record<string, unknown>;
    } catch {
      return integrationError('invalid_input', 'JSON inválido.');
    }
  }
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return integrationError('invalid_input', 'O corpo precisa ser um objeto JSON.');
    }
    return parsed as Record<string, unknown>;
  } catch {
    return integrationError('invalid_input', 'JSON inválido.');
  }
}

function queryObject(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'kinds') {
      const pieces = value.includes(',') ? value.split(',').map((item) => item.trim()).filter(Boolean) : [value];
      const existing = out.kinds;
      out.kinds = Array.isArray(existing) ? [...existing, ...pieces] : pieces;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function coerceInput(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  if (typeof out.limit === 'string' && out.limit !== '') out.limit = Number(out.limit);
  // Na query tudo chega como texto: os campos de verdadeiro/falso viram booleano
  // ("true"/"false"); qualquer outro texto fica como está e o contrato recusa.
  for (const campo of ['onlyAttention', 'includeArchived', 'overdue', 'completed'] as const) {
    if (out[campo] === 'true') out[campo] = true;
    else if (out[campo] === 'false') out[campo] = false;
  }
  if (typeof out.kinds === 'string') {
    out.kinds = out.kinds.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return out;
}

function fromFailure(failure: ReadFailure): Response {
  return integrationError(failure.code, failure.message);
}

function fromWriteFailure(failure: WriteFailure): Response {
  const extra: Record<string, unknown> = {};
  if (failure.options) extra.options = failure.options;
  // F40: `type_required` leva os quatro tipos em `options`, como as outras recusas de escolha.
  if (failure.typeOptions) extra.options = failure.typeOptions;
  if (failure.listId) extra.listId = failure.listId;
  if (failure.listName) extra.listName = failure.listName;
  if (failure.taskId) extra.taskId = failure.taskId;
  if (failure.current) extra.current = failure.current;
  if (failure.dailyWrites) extra.dailyWrites = failure.dailyWrites;
  return integrationError(failure.code, failure.message, extra);
}

export async function dispatchIntegrationHttp(input: {
  request: Request;
  grant: IntegrationGrant;
  person: PersonAccess;
  origin: ExecutionOrigin;
  catalog?: IntegrationCatalog;
  work?: WorkCatalog;
  delivery?: DeliveryCatalog;
  marketing?: MarketingCatalog;
  writes?: AgentWriteStore;
  comments?: CommentMutator;
  board?: BoardMutator;
  /** F26.5 — miolo das escritas de tarefa. Ausente = SQL. */
  tasks?: TaskMutator;
  /** F26.6 — miolo de mural e histórico. Ausente = SQL. */
  clientRecords?: ClientRecordMutator;
  /** F40, Fase 9 — a leitura do painel dos admins. Ausente = indisponível. */
  adminWeek?: AdminWeekCatalog;
  displayNameFallback?: string;
  now?: Date;
  /** `false` recusa toda escrita (inclusive o ensaio). Prévia e leituras seguem. */
  writesEnabled?: boolean;
}): Promise<Response> {
  const url = new URL(input.request.url);
  if (isOpenApiPath(url.pathname)) {
    if (input.request.method !== 'GET') {
      return integrationError('method_not_allowed', 'Método não permitido.');
    }
    return jsonBody(integrationOpenApi());
  }

  if (input.request.method !== 'GET' && input.request.method !== 'POST') {
    return integrationError('method_not_allowed', 'Método não permitido.');
  }

  const catalog = input.catalog ?? EMPTY_CATALOG;
  const work = input.work ?? EMPTY_WORK_CATALOG;
  const delivery = input.delivery ?? EMPTY_DELIVERY_CATALOG;
  const marketing = input.marketing ?? EMPTY_MARKETING_CATALOG;
  // Empresas e nome do dono: lidos SÓ por quem os usa (perf do servidor,
  // 08/10/2026). Antes eram duas transações a mais em toda chamada — também nas
  // escritas, que montam o próprio contexto e nunca os leem. Agora a leitura
  // acontece uma vez, no primeiro `escopo()`: `get_context` e o despacho das
  // leituras. Mesmo resultado, na mesma ordem.
  let escopoLido: Promise<IntegrationScope> | undefined;
  const escopo = async () => {
    escopoLido ??= lerEscopoDoCatalogo(catalog, input.grant.ownerId);
    const lido = await escopoLido;
    return {
      companies: lido.companies,
      displayName: lido.displayName ?? input.displayNameFallback ?? input.grant.ownerId,
    };
  };
  const writeCtx = (): WriteCtx => ({
    grant: input.grant,
    person: input.person,
    origin: input.origin,
    store: input.writes ?? new MemoryAgentWriteStore(),
    comments: input.comments ?? SQL_COMMENT_MUTATOR,
    board: input.board ?? SQL_BOARD_MUTATOR,
    tasks: input.tasks ?? SQL_TASK_MUTATOR,
    clientRecords: input.clientRecords ?? SQL_CLIENT_RECORD_MUTATOR,
    now: input.now,
  });
  const writesEnabled = input.writesEnabled !== false;

  if (isGetContextPath(url.pathname)) {
    const body = await readStrictObject(input.request);
    if (body instanceof Response) return body;
    const parsed = getContextInputSchema.safeParse(body);
    if (!parsed.success) {
      return integrationError('invalid_input', 'get_context não aceita campos extras.');
    }
    const { companies, displayName } = await escopo();
    const context = getContext({
      grant: input.grant,
      person: input.person,
      origin: input.origin,
      companies,
      displayName,
      now: input.now,
    });
    return jsonBody(getContextResponseSchema.parse(context));
  }

  if (url.pathname === ADD_COMMENT_PATH) {
    if (input.request.method !== 'POST') {
      return integrationError('method_not_allowed', 'Método não permitido.');
    }
    if (!writesEnabled) {
      return integrationError('unavailable', INTEGRATION_WRITES_UNAVAILABLE_MESSAGE);
    }
    if (!allowsOperation(input.person, input.grant, 'comments:write', input.now)) {
      return integrationError('permission_denied', 'Esta concessão não autoriza comentar.');
    }
    const body = await readStrictObject(input.request);
    if (body instanceof Response) return body;
    const headerKey = input.request.headers.get('Idempotency-Key')?.trim();
    const payload = {
      ...body,
      idempotencyKey:
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
          ? body.idempotencyKey
          : headerKey,
    };
    const parsed = addCommentInputSchema.safeParse(payload);
    if (!parsed.success) {
      return integrationError(
        'invalid_input',
        'Informe taskId (UUID), corpo não vazio e chave de idempotência. authorId não é aceito.',
      );
    }
    const result = await addCommentWork(writeCtx(), parsed.data);
    if (!result.ok) return fromWriteFailure(result);
    return jsonBody(addCommentResponseSchema.parse(result.body));
  }

  if (url.pathname === PREVIEW_MOVE_PATH) {
    if (input.request.method !== 'POST') {
      return integrationError('method_not_allowed', 'Método não permitido.');
    }
    if (!allowsOperation(input.person, input.grant, 'tasks:move', input.now)) {
      return integrationError('permission_denied', 'Esta concessão não autoriza mover.');
    }
    const body = await readStrictObject(input.request);
    if (body instanceof Response) return body;
    const parsed = previewMoveInputSchema.safeParse(body);
    if (!parsed.success) {
      return integrationError(
        'invalid_input',
        'Informe taskId, listId e a origem observada (from.listId/from.statusId). Relê o card se não tiver a origem.',
      );
    }
    const result = await previewMoveWork(writeCtx(), parsed.data);
    if (!result.ok) return fromWriteFailure(result);
    return jsonBody(previewMoveResponseSchema.parse(result.body));
  }

  if (url.pathname === MOVE_TASK_PATH) {
    if (input.request.method !== 'POST') {
      return integrationError('method_not_allowed', 'Método não permitido.');
    }
    if (!writesEnabled) {
      return integrationError('unavailable', INTEGRATION_WRITES_UNAVAILABLE_MESSAGE);
    }
    if (!allowsOperation(input.person, input.grant, 'tasks:move', input.now)) {
      return integrationError('permission_denied', 'Esta concessão não autoriza mover.');
    }
    const body = await readStrictObject(input.request);
    if (body instanceof Response) return body;
    const headerKey = input.request.headers.get('Idempotency-Key')?.trim();
    const payload = {
      ...body,
      idempotencyKey:
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
          ? body.idempotencyKey
          : headerKey,
    };
    const parsed = moveTaskInputSchema.safeParse(payload);
    if (!parsed.success) {
      return integrationError(
        'invalid_input',
        'Informe taskId, listId, origem observada e chave de idempotência. approved do modelo não é aceito.',
      );
    }
    const result = await moveTaskWork(writeCtx(), parsed.data);
    if (!result.ok) return fromWriteFailure(result);
    return jsonBody(moveTaskResponseSchema.parse(result.body));
  }

  const writeRoute = Object.prototype.hasOwnProperty.call(WRITE_ROUTES, url.pathname)
    ? WRITE_ROUTES[url.pathname]
    : undefined;
  if (writeRoute) {
    if (input.request.method !== 'POST') {
      return integrationError('method_not_allowed', 'Método não permitido.');
    }
    if (!writesEnabled) {
      return integrationError('unavailable', INTEGRATION_WRITES_UNAVAILABLE_MESSAGE);
    }
    if (!allowsOperation(input.person, input.grant, writeRoute.capability, input.now)) {
      return integrationError('permission_denied', writeRoute.denied);
    }
    const body = await readStrictObject(input.request);
    if (body instanceof Response) return body;
    const headerKey = input.request.headers.get('Idempotency-Key')?.trim();
    const payload = {
      ...body,
      idempotencyKey:
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.length > 0
          ? body.idempotencyKey
          : headerKey,
    };
    const result = await writeRoute.run(writeCtx(), payload);
    if (result === 'invalid') return integrationError('invalid_input', writeRoute.invalid);
    if (!result.ok) return fromWriteFailure(result);
    return jsonBody(result.body);
  }

  const operation = readOpFromPath(url.pathname);
  if (!operation) {
    return integrationError(
      'unknown_operation',
      'Operação ainda não publicada neste contrato. Consulte o OpenAPI.',
    );
  }

  const body = await readStrictObject(input.request);
  if (body instanceof Response) return body;
  const payload = coerceInput({ ...queryObject(url), ...body });

  // O contexto das leituras. Só aqui o catálogo é lido: pedido torto (corpo
  // inválido, operação desconhecida) já respondeu acima sem ir ao banco.
  // `get_admin_week` lê o painel dos admins com concessão e pessoa apenas; não
  // usa `companies` nem `displayName`, então não paga a leitura deles.
  const ctx = {
    grant: input.grant,
    person: input.person,
    origin: input.origin,
    ...(operation === 'get_admin_week'
      ? { companies: [] as readonly never[], displayName: '' }
      : await escopo()),
    work,
    delivery,
    marketing,
    now: input.now,
  };

  if (operation === 'search') {
    const parsed = searchInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', 'Informe o texto da busca.');
    const result = await searchWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_board') {
    const parsed = getBoardInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', 'Informe o id do quadro.');
    const result = await getBoardWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_task') {
    const parsed = getTaskInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', 'Informe o id da tarefa.');
    const result = await getTaskWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_client') {
    const parsed = getClientInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', 'Informe o id do cliente.');
    const result = await getClientWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'list_people') {
    const parsed = listPeopleInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', 'Pedido de diretório inválido.');
    const result = await listPeopleWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_person_work') {
    const parsed = getPersonWorkInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', 'Informe o id da pessoa.');
    const result = await getPersonWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_client_mural') {
    const parsed = getClientMuralInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', 'Informe o id do cliente (clientId).');
    const result = await getClientMuralWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_client_history') {
    const parsed = getClientHistoryInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', clientHistoryInputMessage(parsed.error));
    const result = await getClientHistoryWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_delivery_report') {
    const parsed = getDeliveryReportInputSchema.safeParse(payload);
    if (!parsed.success) {
      return integrationError('invalid_input', 'Informe from e to em AAAA-MM-DD, ou omita os dois.');
    }
    const result = await getDeliveryReport(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_client_delivery_history') {
    const parsed = getClientDeliveryHistoryInputSchema.safeParse(payload);
    if (!parsed.success) {
      return integrationError('invalid_input', 'Informe clientId e, se quiser, from e to em AAAA-MM (ex.: 2026-08).');
    }
    const result = await getClientDeliveryHistory(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_delivery_trend') {
    const parsed = getDeliveryTrendInputSchema.safeParse(payload);
    if (!parsed.success) {
      return integrationError('invalid_input', 'Informe from e to em AAAA-MM (ex.: 2026-08), ou omita.');
    }
    const result = await getDeliveryTrend(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_workflow') {
    const parsed = getWorkflowInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', WORKFLOW_INPUT_MESSAGE);
    const result = await getWorkflowWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_planning_weeks') {
    const parsed = getPlanningWeeksInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', PLANNING_WEEKS_INPUT_MESSAGE);
    const result = await getPlanningWeeks(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_month_attention') {
    const parsed = getMonthAttentionInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', MONTH_ATTENTION_INPUT_MESSAGE);
    const result = await getMonthAttention(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_client_month') {
    const parsed = getClientMonthInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', CLIENT_MONTH_INPUT_MESSAGE);
    const result = await getClientMonth(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_calendar') {
    const parsed = getCalendarInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', CALENDAR_INPUT_MESSAGE);
    const result = await getCalendar(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'list_boards') {
    const parsed = listBoardsInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', LIST_BOARDS_INPUT_MESSAGE);
    const result = await listBoardsWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'list_tasks') {
    const parsed = listTasksInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', LIST_TASKS_INPUT_MESSAGE);
    const result = await listTasksWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'list_clients') {
    const parsed = listClientsInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', LIST_CLIENTS_INPUT_MESSAGE);
    const result = await listClientsWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'list_tags') {
    const parsed = listTagsInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', LIST_TAGS_INPUT_MESSAGE);
    const result = await listTagsWork(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_admin_week') {
    const parsed = getAdminWeekInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', ADMIN_WEEK_INPUT_MESSAGE);
    const result = await getAdminWeek(
      { grant: input.grant, person: input.person, adminWeek: input.adminWeek, now: input.now },
      parsed.data,
    );
    if (!result.ok) return integrationError(result.code, result.message);
    return jsonBody(result.body);
  }

  if (operation === 'get_delivery_status') {
    const parsed = getDeliveryStatusInputSchema.safeParse(payload);
    if (!parsed.success) return integrationError('invalid_input', DELIVERY_STATUS_INPUT_MESSAGE);
    const result = await getDeliveryStatus(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  if (operation === 'get_marketing_report') {
    const parsed = getMarketingReportInputSchema.safeParse(payload);
    if (!parsed.success) {
      return integrationError('invalid_input', 'Informe from e to em AAAA-MM-DD, ou omita os dois.');
    }
    const result = await getMarketingReport(ctx, parsed.data);
    if (!result.ok) return fromFailure(result);
    return jsonBody(result.body);
  }

  const parsed = listCommentsInputSchema.safeParse(payload);
  if (!parsed.success) return integrationError('invalid_input', 'Informe o id da tarefa.');
  const result = await listCommentsWork(ctx, parsed.data);
  if (!result.ok) return fromFailure(result);
  return jsonBody(result.body);
}

export function openApiResponse(): Response {
  return jsonBody(integrationOpenApi());
}
