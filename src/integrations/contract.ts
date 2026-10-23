/**
 * Contrato HTTP da integração — F16.3a.
 *
 * Zod é a fonte. O OpenAPI sai dos mesmos schemas: o documento versionado
 * descreve os campos que a resposta efetiva também precisa passar. Sem
 * biblioteca extra — o recorte de Zod 3 que usamos cabe num conversor local.
 *
 * Códigos de erro são estáveis. A mensagem muda; o `error` não.
 */

import { z, type ZodTypeAny } from 'zod';

import { CONTENT_TYPES, FORMULA_VERSION } from '@/delivery/level';
import { INTEGRATION_CAPABILITIES } from '@/integrations/grants';
import { AGENCY_TIMEZONE } from '@/server/calendar';

export const HTTP_INTEGRATIONS_PATH = '/api/integrations/v1';
export const CONNECTIONS_PATH = `${HTTP_INTEGRATIONS_PATH}/connections`;
export const OPENAPI_PATH = `${HTTP_INTEGRATIONS_PATH}/openapi.json`;
export const GET_CONTEXT_PATH = `${HTTP_INTEGRATIONS_PATH}/get_context`;
export const SEARCH_PATH = `${HTTP_INTEGRATIONS_PATH}/search`;
export const GET_BOARD_PATH = `${HTTP_INTEGRATIONS_PATH}/get_board`;
export const GET_TASK_PATH = `${HTTP_INTEGRATIONS_PATH}/get_task`;
export const GET_CLIENT_PATH = `${HTTP_INTEGRATIONS_PATH}/get_client`;
export const LIST_COMMENTS_PATH = `${HTTP_INTEGRATIONS_PATH}/list_comments`;
export const LIST_PEOPLE_PATH = `${HTTP_INTEGRATIONS_PATH}/list_people`;
export const GET_PERSON_WORK_PATH = `${HTTP_INTEGRATIONS_PATH}/get_person_work`;
export const GET_DELIVERY_REPORT_PATH = `${HTTP_INTEGRATIONS_PATH}/get_delivery_report`;
export const GET_MARKETING_REPORT_PATH = `${HTTP_INTEGRATIONS_PATH}/get_marketing_report`;
export const ADD_COMMENT_PATH = `${HTTP_INTEGRATIONS_PATH}/add_comment`;
export const PREVIEW_MOVE_PATH = `${HTTP_INTEGRATIONS_PATH}/preview_move`;
export const MOVE_TASK_PATH = `${HTTP_INTEGRATIONS_PATH}/move_task`;
// F26.5 — as escritas de tarefa. Uma rota por operação, como as anteriores.
export const CREATE_TASK_PATH = `${HTTP_INTEGRATIONS_PATH}/create_task`;
export const UPDATE_TASK_PATH = `${HTTP_INTEGRATIONS_PATH}/update_task`;
export const ASSIGN_TASK_PATH = `${HTTP_INTEGRATIONS_PATH}/assign_task`;
export const COMPLETE_TASK_PATH = `${HTTP_INTEGRATIONS_PATH}/complete_task`;
export const REOPEN_TASK_PATH = `${HTTP_INTEGRATIONS_PATH}/reopen_task`;
// F26.6 — mural e histórico do cliente: duas leituras e quatro escritas.
export const GET_CLIENT_MURAL_PATH = `${HTTP_INTEGRATIONS_PATH}/get_client_mural`;
export const GET_CLIENT_HISTORY_PATH = `${HTTP_INTEGRATIONS_PATH}/get_client_history`;
export const ADD_MURAL_NOTE_PATH = `${HTTP_INTEGRATIONS_PATH}/add_mural_note`;
export const UPDATE_MURAL_NOTE_PATH = `${HTTP_INTEGRATIONS_PATH}/update_mural_note`;
export const ADD_HISTORY_ENTRY_PATH = `${HTTP_INTEGRATIONS_PATH}/add_history_entry`;
export const UPDATE_HISTORY_ENTRY_PATH = `${HTTP_INTEGRATIONS_PATH}/update_history_entry`;
// F26.7 — a entrega mês a mês: um cliente com o detalhe, ou a carteira compacta.
export const GET_CLIENT_DELIVERY_HISTORY_PATH = `${HTTP_INTEGRATIONS_PATH}/get_client_delivery_history`;
export const GET_DELIVERY_TREND_PATH = `${HTTP_INTEGRATIONS_PATH}/get_delivery_trend`;
// F37 — a esteira (etapas, ordem, tipo, origem) de uma lista ou de uma pasta.
export const GET_WORKFLOW_PATH = `${HTTP_INTEGRATIONS_PATH}/get_workflow`;
// F37 — o mês de cada cliente por semana (a aba Semana do Planejamento).
export const GET_PLANNING_WEEKS_PATH = `${HTTP_INTEGRATIONS_PATH}/get_planning_weeks`;
// F38 — a última entrega e as peças vencidas de cada cliente ativo, pela Semanal.
export const GET_DELIVERY_STATUS_PATH = `${HTTP_INTEGRATIONS_PATH}/get_delivery_status`;
// G1 (conferência de 08/10/2026) — "quais clientes estão atrás neste mês?": o ritual,
// o contrato por tipo e os motivos de atenção da visão Contrato do Planejamento.
export const GET_MONTH_ATTENTION_PATH = `${HTTP_INTEGRATIONS_PATH}/get_month_attention`;
// G2 — o mês de UM cliente com cada peça nominal, e o calendário (peças e compromissos) de um período.
export const GET_CLIENT_MONTH_PATH = `${HTTP_INTEGRATIONS_PATH}/get_client_month`;
export const GET_CALENDAR_PATH = `${HTTP_INTEGRATIONS_PATH}/get_calendar`;
// G7 — as etiquetas de um espaço (ou do espaço de uma lista): de onde vêm os `tagIds` de create_task/update_task.
export const LIST_TAGS_PATH = `${HTTP_INTEGRATIONS_PATH}/list_tags`;
// G5 — a carteira ativa: as linhas do cadastro de cada cliente (plano, urgência, financeiro, renovação, etiquetas).
export const LIST_CLIENTS_PATH = `${HTTP_INTEGRATIONS_PATH}/list_clients`;
// G11 — a árvore de listas e as tarefas com filtro (a leitura que hoje exige varrer lista por lista).
export const LIST_BOARDS_PATH = `${HTTP_INTEGRATIONS_PATH}/list_boards`;
export const LIST_TASKS_PATH = `${HTTP_INTEGRATIONS_PATH}/list_tasks`;
// F40 — o painel de controle da semana (só admin): a leitura e a liberação do card.
export const GET_ADMIN_WEEK_PATH = `${HTTP_INTEGRATIONS_PATH}/get_admin_week`;
export const RELEASE_TASK_PATH = `${HTTP_INTEGRATIONS_PATH}/release_task`;
export const INTEGRATION_API_VERSION = '1.0.0';

const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dia civil que existe de verdade (31 de fevereiro não): ida e volta por UTC. O
 * `CIVIL_DAY` só confere a forma — `2026-02-30` passa por ele e, se descesse ao
 * SQL como `::date`, virava erro interno do Postgres. `get_calendar` e
 * `list_tasks` (`dueBefore`) usam esta.
 */
export function diaValido(dia: string): boolean {
  if (!CIVIL_DAY.test(dia)) return false;
  const data = new Date(`${dia}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === dia;
}
export const INTEGRATION_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const SEARCH_KINDS = ['board', 'task', 'client', 'person'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const INTEGRATION_ERROR_CODES = [
  'permission_denied',
  'ambiguous_match',
  'state_conflict',
  'status_choice_required',
  'type_required',
  // F40, Fase 9 — as recusas de `release_task` (a mesma regra da tela de liberar).
  'assignee_required',
  'due_required',
  'already_released',
  'stage_missing',
  'rate_limited',
  'daily_write_limit',
  'data_incomplete',
  'invalid_token',
  'payload_too_large',
  'deadline_exceeded',
  'invalid_input',
  'invalid_cursor',
  'limit_exceeded',
  'unknown_operation',
  'method_not_allowed',
  'not_found',
  'unavailable',
] as const;

export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];

export const ERROR_STATUS: Record<IntegrationErrorCode, number> = {
  permission_denied: 403,
  ambiguous_match: 409,
  state_conflict: 409,
  status_choice_required: 409,
  // F40: a MESMA recusa da tela (400 no quadro). Não é conflito de estado: falta um dado.
  type_required: 400,
  // F40, Fase 9 — as mesmas respostas da rota `POST /admin/semana/liberar`.
  assignee_required: 400,
  due_required: 400,
  already_released: 409,
  stage_missing: 409,
  rate_limited: 429,
  // Também 429, e MESMO ASSIM um código próprio. Quem recebe `rate_limited`
  // espera alguns segundos e repete; quem recebe `daily_write_limit` não tem
  // o que esperar hoje — a cota só vira na virada do dia, e a saída é a
  // pessoa liberar o teto. Juntar os dois num código só faria o agente
  // insistir a noite inteira contra uma porta que não abre por espera.
  daily_write_limit: 429,
  data_incomplete: 422,
  invalid_token: 401,
  payload_too_large: 413,
  deadline_exceeded: 504,
  invalid_input: 400,
  invalid_cursor: 400,
  limit_exceeded: 400,
  unknown_operation: 404,
  method_not_allowed: 405,
  not_found: 404,
  unavailable: 503,
};

/** Integração inteira desligada (`IDEWORKS_INTEGRATIONS_ENABLED === 'false'`). */
export const INTEGRATION_UNAVAILABLE_MESSAGE =
  'A integração de agentes está desligada neste servidor.';

/** Escritas desligadas (`IDEWORKS_INTEGRATION_WRITES_ENABLED === 'false'`). */
export const INTEGRATION_WRITES_UNAVAILABLE_MESSAGE =
  'As escritas de agente estão desligadas neste servidor, então não adianta repetir a chamada: só o administrador do servidor as religa. ' +
  'Leituras e prévia de movimento continuam; use-as e diga à pessoa o que ficou por escrever.';

export const integrationErrorSchema = z
  .object({
    error: z.enum(INTEGRATION_ERROR_CODES),
    message: z.string().min(1),
  })
  .strict();

const capabilitySchema = z.enum(INTEGRATION_CAPABILITIES);

export const companyRefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

export const ownerIdentitySchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export const effectiveScopeSchema = z
  .object({
    companies: z.array(companyRefSchema),
    capabilities: z.array(capabilitySchema),
    policyVersion: z.number().int().positive(),
    companyScope: z.enum(['none', 'ids', 'all']),
  })
  .strict();

/** Pedido de `get_context`: vazio e estrito. Nada além do token. */
export const getContextInputSchema = z.object({}).strict();

export const getContextResponseSchema = z
  .object({
    operation: z.literal('get_context'),
    queriedAt: z.string().datetime(),
    self: z.literal(GET_CONTEXT_PATH),
    origin: z.enum(['mcp', 'http', 'automation']),
    owner: ownerIdentitySchema,
    integration: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
      })
      .strict(),
    effectiveScope: effectiveScopeSchema,
  })
  .strict();

export type GetContextResponse = z.infer<typeof getContextResponseSchema>;

const namedRefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

/** Id sempre; nome só quando a leitura do quadro/espaço foi concedida. */
export const maybeNamedRefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).nullable(),
  })
  .strict();

const continuationSchema = {
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).nullable(),
};

export const searchInputSchema = z
  .object({
    q: z.string().min(1),
    kinds: z.array(z.enum(SEARCH_KINDS)).min(1).optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

/**
 * F38, Fase 4 — dia civil do cancelamento (`AAAA-MM-DD`, no fuso de São
 * Paulo). Só a forma: o dia vem do banco, não da pessoa.
 */
const cancelledOnSchema = z.string().regex(CIVIL_DAY, 'Use AAAA-MM-DD.');

export const searchHitSchema = z
  .object({
    kind: z.enum(SEARCH_KINDS),
    id: z.string().min(1),
    title: z.string().min(1),
    detail: z.string().min(1).nullable(),
    board: maybeNamedRefSchema.nullable(),
    client: maybeNamedRefSchema.nullable(),
    company: namedRefSchema.nullable(),
    /**
     * F38, Fase 4 — só no achado de cliente CANCELADO (`is_active = false`),
     * que volta apenas quando a busca é pelo nome dele: id, nome, `cancelled`
     * e o dia do cancelamento. Sem quadro, cliente ou empresa.
     */
    cancelled: z.literal(true).optional(),
    cancelledOn: cancelledOnSchema.nullable().optional(),
  })
  .strict();

export const searchResponseSchema = z
  .object({
    operation: z.literal('search'),
    queriedAt: z.string().datetime(),
    self: z.literal(SEARCH_PATH),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    items: z.array(searchHitSchema),
  })
  .strict();

export const getBoardInputSchema = z
  .object({
    id: z.string().min(1),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

/** Mesmo vocabulário do enum `ideworks.task_priority` (F17.3). */
export const TASK_PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;

/** Mesmo vocabulário do enum `ideworks.status_type` (F17.2): o tipo da etapa. */
export const STATUS_TYPES = ['open', 'unstarted', 'custom', 'done', 'closed'] as const;

/**
 * F40 — o tipo da demanda. Mesmo vocabulário do enum `ideworks.task_demand_type`
 * e de `TIPOS_DA_TAREFA` (`server/tipo-da-tarefa.ts`); repetido aqui porque o
 * contrato é importado por quem não deve puxar o servidor, e um teste prende
 * as duas listas iguais.
 */
export const TASK_DEMAND_TYPES = ['video', 'arte', 'foto', 'outros'] as const;
export type TaskDemandType = (typeof TASK_DEMAND_TYPES)[number];

export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type StatusType = (typeof STATUS_TYPES)[number];

export const boardTaskCardSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    statusId: z.string().min(1).nullable(),
    client: maybeNamedRefSchema.nullable(),
    people: z.array(namedRefSchema).nullable(),
    // F37: opcionais/anuláveis — cliente antigo que não os conhece segue lendo.
    priority: z.enum(TASK_PRIORITIES).nullable().optional(),
    startOn: z.string().nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    archivedAt: z.string().datetime().nullable().optional(),
    /** F40: o tipo da demanda; nulo no card antigo e em lista interna. */
    type: z.enum(TASK_DEMAND_TYPES).nullable().optional(),
  })
  .strict();

export const boardColumnSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    sortOrder: z.number().int(),
    type: z.enum(STATUS_TYPES).nullable().optional(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const getBoardResponseSchema = z
  .object({
    operation: z.literal('get_board'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    board: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        space: maybeNamedRefSchema,
        folder: maybeNamedRefSchema.nullable(),
        company: namedRefSchema,
        client: maybeNamedRefSchema.nullable(),
        columns: z.array(boardColumnSchema),
        tasks: z.array(boardTaskCardSchema),
      })
      .strict(),
  })
  .strict();

/**
 * F37 — `get_workflow`: UMA lista OU UMA pasta, por uuid. O "exatamente um dos
 * dois" não mora no schema (um `.refine` viraria ZodEffects e o MCP/OpenAPI
 * precisam de um objeto simples): `workflowTargetOf` confere e as superfícies
 * respondem `invalid_input` quando não vier exatamente um.
 */
export const getWorkflowInputSchema = z
  .object({
    listId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    folderId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
  })
  .strict();

export type GetWorkflowInput = z.infer<typeof getWorkflowInputSchema>;

export type WorkflowTarget = { kind: 'list' | 'folder'; id: string };

/** `null` = não veio exatamente um dos dois (nenhum, ou os dois). */
export function workflowTargetOf(input: GetWorkflowInput): WorkflowTarget | null {
  const hasList = input.listId !== undefined;
  const hasFolder = input.folderId !== undefined;
  if (hasList === hasFolder) return null;
  return hasList ? { kind: 'list', id: input.listId as string } : { kind: 'folder', id: input.folderId as string };
}

export const WORKFLOW_INPUT_MESSAGE = 'Informe exatamente um dos dois: listId (uuid) ou folderId (uuid).';

export const WORKFLOW_ORIGINS = ['list', 'folder', 'space'] as const;
export type WorkflowOrigin = (typeof WORKFLOW_ORIGINS)[number];

export const workflowStageSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    sortOrder: z.number().int(),
    type: z.enum(STATUS_TYPES).nullable(),
  })
  .strict();

export const getWorkflowResponseSchema = z
  .object({
    operation: z.literal('get_workflow'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    workflow: z
      .object({
        /** O que foi perguntado: a lista ou a pasta. */
        target: z.object({ kind: z.enum(['list', 'folder']), id: z.string().min(1), name: z.string().min(1) }).strict(),
        company: namedRefSchema,
        /** Nome da esteira. */
        name: z.string().min(1),
        /** De onde a esteira do alvo vem: da própria lista, da pasta ou do espaço. */
        inheritedFrom: z.enum(WORKFLOW_ORIGINS),
        /** O dono da esteira (a lista, a pasta ou o espaço em que ela está gravada). */
        owner: z.object({ kind: z.enum(WORKFLOW_ORIGINS), id: z.string().min(1), name: z.string().min(1) }).strict(),
        stages: z.array(workflowStageSchema),
        /**
         * F40 — a lista é de PRODUÇÃO (a esteira tem a etapa "atribuir demanda"):
         * nela toda tarefa nova precisa de `type`. Decidido pelo banco
         * (`list_is_production`). Nulo quando o alvo é uma pasta: a pergunta é
         * por lista, e uma lista da pasta pode ter esteira própria.
         */
        isProduction: z.boolean().nullable().optional(),
      })
      .strict(),
  })
  .strict();

export type GetWorkflowResponse = z.infer<typeof getWorkflowResponseSchema>;

/** F38, Fase 6.4 — teto de subtarefas listadas no `get_task`. */
export const GET_TASK_SUBTASKS_MAX = 50;

/**
 * G6 (conferência de 08/10/2026) — tetos da ficha inteira no `get_task`. Cada
 * grupo vem com o total, para o agente saber que cortou. O histórico vem do
 * mais antigo ao mais novo e, cortado, fica com os MAIS RECENTES.
 */
export const GET_TASK_CHECKLISTS_MAX = 15;
export const GET_TASK_CHECKLIST_ITEMS_MAX = 60;
export const GET_TASK_LINKS_MAX = 30;
export const GET_TASK_HISTORY_MAX = 30;

/** Etiqueta da tarefa (`tags`): o que `create_task`/`update_task` aceitam em `tagIds`. */
export const taskTagSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    bgColor: z.string().nullable(),
    fgColor: z.string().nullable(),
  })
  .strict();

export const taskChecklistItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    /** Item de checklist tem UM nível: o pai, se houver. */
    parentItemId: z.string().min(1).nullable(),
    resolved: z.boolean(),
    resolvedAt: z.string().datetime().nullable(),
    /** Nulo = sem responsável, ou sem `people:read`. */
    assignee: namedRefSchema.nullable(),
  })
  .strict();

export const taskChecklistSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    items: z.array(taskChecklistItemSchema),
  })
  .strict();

/** Link externo da tarefa (Dropbox, Google Docs): o material da entrega e da aprovação. */
export const taskLinkSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    url: z.string(),
  })
  .strict();

/**
 * Um fato do histórico de movimentação, como a linha do tempo da ficha: quando,
 * quem (pessoa ou regra de automação), por qual conexão de IA e o quê, em frases
 * prontas. Pessoa, lista, etapa e cliente só aparecem com a leitura deles.
 */
export const taskHistoryEventSchema = z
  .object({
    id: z.string().min(1),
    at: z.string().datetime(),
    /** O nome da regra (automation true) ou da pessoa; nulo = sem people:read ou desconhecido. */
    by: z.string().nullable(),
    /** Foi uma regra de automação, e não gente. */
    automation: z.boolean(),
    /** A conexão de IA da sessão que gerou o fato ("Claude da Carla"); nulo = gente. */
    via: z.string().nullable(),
    changes: z.array(z.string().min(1)),
  })
  .strict();

/** F38, Fase 6.4 — uma subtarefa no `get_task`: id, título, etapa e se está concluída. */
export const getTaskSubtaskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    statusId: z.string().min(1).nullable(),
    statusName: z.string().min(1).nullable(),
    completed: z.boolean(),
  })
  .strict();

export type GetTaskSubtask = z.infer<typeof getTaskSubtaskSchema>;

/**
 * F42, Fase 7 — uma rodada de aprovação do cliente no `get_task`. Cada envio
 * ao cliente é uma versão; o estado diz o que o cliente decidiu. NUNCA leva o
 * token nem o link do cliente (`/aprovar/…`): só o que a equipe enviou (os
 * links do Dropbox) e o que o cliente respondeu. `clientComments` segue a
 * leitura de comentários: sem `comments:read`, vem `null`.
 */
export const APPROVAL_ROUND_STATES = ['open', 'approved', 'rejected', 'superseded', 'cancelled', 'locked_changed'] as const;
export type ApprovalRoundState = (typeof APPROVAL_ROUND_STATES)[number];
export const APPROVAL_ITEM_KINDS = ['video', 'image', 'other'] as const;

export const taskApprovalRoundSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    /** open = aguardando o cliente; approved; rejected = ajustes pedidos; superseded = nova versão enviada. */
    state: z.enum(APPROVAL_ROUND_STATES),
    sentAt: z.string().datetime(),
    decidedAt: z.string().datetime().nullable(),
    /** Quem decidiu: `client_link` = o cliente, pelo link. Nulo sem decisão. */
    decidedBy: z.enum(['client_link']).nullable(),
    closedAt: z.string().datetime().nullable(),
    items: z.array(
      z
        .object({
          position: z.number().int().positive(),
          kind: z.enum(APPROVAL_ITEM_KINDS),
          fileName: z.string(),
          /** `dropbox` = link do Dropbox; `attachment` = arte anexada ao card, copiada para a rodada (F42, Fase 9). */
          source: z.enum(['dropbox', 'attachment']),
          /** O link do Dropbox enviado (material da equipe), não o link do cliente. Nulo na arte anexada. */
          url: z.string().nullable(),
        })
        .strict(),
    ),
    clientComments: z
      .array(
        z
          .object({
            id: z.string().min(1),
            body: z.string(),
            createdAt: z.string().datetime(),
            /** A posição do material comentado no carrossel; nulo = sobre a chamada inteira. */
            itemPosition: z.number().int().positive().nullable(),
            /** Verdadeiro no comentário que acompanhou a decisão (o motivo dos ajustes). */
            decision: z.boolean(),
          })
          .strict(),
      )
      .nullable(),
  })
  .strict();

export type TaskApprovalRound = z.infer<typeof taskApprovalRoundSchema>;

/**
 * G7 — `list_tags`: as etiquetas de um espaço, por `spaceId`, ou do espaço de uma
 * lista, por `listId`. `create_task`/`update_task` já aceitam `tagIds`, mas o
 * agente não tinha de onde tirar um id. A etiqueta mora no ESPAÇO (o gatilho do
 * banco recusa a de outro espaço). Como `get_workflow`, o "exatamente um dos
 * dois" não mora no schema: `listTagsTargetOf` confere.
 */
export const LIST_TAGS_MAX_LIMIT = 100;
export const LIST_TAGS_INPUT_MESSAGE =
  'Informe exatamente um dos dois: spaceId (uuid) ou listId (uuid); limit (inteiro) e cursor são opcionais.';

export const listTagsInputSchema = z
  .object({
    spaceId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    listId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export type ListTagsInput = z.infer<typeof listTagsInputSchema>;

export type ListTagsTarget = { kind: 'space' | 'list'; id: string };

/** `null` = não veio exatamente um dos dois (nenhum, ou os dois). */
export function listTagsTargetOf(input: Pick<ListTagsInput, 'spaceId' | 'listId'>): ListTagsTarget | null {
  const hasSpace = input.spaceId !== undefined;
  const hasList = input.listId !== undefined;
  if (hasSpace === hasList) return null;
  return hasSpace ? { kind: 'space', id: input.spaceId as string } : { kind: 'list', id: input.listId as string };
}

export const listTagsResponseSchema = z
  .object({
    operation: z.literal('list_tags'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    /** O espaço dono das etiquetas. */
    space: z.object({ id: z.string().min(1), name: z.string().min(1).nullable(), company: namedRefSchema }).strict(),
    /** A lista perguntada (quando veio `listId`); nulo se veio `spaceId`. */
    list: maybeNamedRefSchema.nullable(),
    /** Quantas etiquetas o espaço tem, antes da página. */
    total: z.number().int().nonnegative(),
    /** Por nome. Os ids vão em `tagIds` de create_task/update_task. */
    tags: z.array(taskTagSchema),
  })
  .strict();

export type ListTagsResponse = z.infer<typeof listTagsResponseSchema>;

export const getTaskInputSchema = z
  .object({
    id: z.string().min(1),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const getTaskResponseSchema = z
  .object({
    operation: z.literal('get_task'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    task: z
      .object({
        id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().nullable(),
        dueOn: z.string().nullable(),
        statusId: z.string().min(1).nullable(),
        // F37: opcionais/anuláveis — cliente antigo que não os conhece segue lendo.
        statusType: z.enum(STATUS_TYPES).nullable().optional(),
        priority: z.enum(TASK_PRIORITIES).nullable().optional(),
        startOn: z.string().nullable().optional(),
        completedAt: z.string().datetime().nullable().optional(),
        archivedAt: z.string().datetime().nullable().optional(),
        /** F40: o tipo da demanda; nulo no card antigo e em lista interna. */
        type: z.enum(TASK_DEMAND_TYPES).nullable().optional(),
        board: maybeNamedRefSchema.nullable(),
        client: maybeNamedRefSchema.nullable(),
        people: z.array(namedRefSchema).nullable(),
        // F38, Fase 6.4 — as subtarefas DIRETAS, não arquivadas e dentro do
        // recorte da conexão, na ordem de criação (a do quadro). Até
        // `GET_TASK_SUBTASKS_MAX`; `subtaskTotal` conta todas.
        subtasks: z.array(getTaskSubtaskSchema).optional(),
        subtaskTotal: z.number().int().nonnegative().optional(),
        comments: z
          .array(
            z
              .object({
                id: z.string().min(1),
                body: z.string(),
                /** F42: escrito pelo cliente no link de aprovação (sem autor). */
                fromClient: z.boolean().optional(),
              })
              .strict(),
          )
          .nullable(),
        /** F42, Fase 7: as rodadas de aprovação do cliente, a mais nova primeiro. */
        approvalRounds: z.array(taskApprovalRoundSchema).optional(),
        /*
         * G6 — a ficha inteira. TUDO opcional e só na PRIMEIRA página do get_task
         * (a descrição e a conversa longas continuam por cursor sem repeti-los).
         * `null` = a leitura que o campo exige não foi concedida.
         */
        /** As etiquetas da tarefa (ids para `tagIds`). */
        tags: z.array(taskTagSchema).optional(),
        /** Quem segue a tarefa. Exige people:read. */
        watchers: z.array(namedRefSchema).nullable().optional(),
        /** A mãe, quando esta tarefa é subtarefa (e a mãe está no recorte). */
        parentId: z.string().min(1).nullable().optional(),
        parentTitle: z.string().nullable().optional(),
        /** Até `GET_TASK_CHECKLISTS_MAX` checklists; os itens somam até `GET_TASK_CHECKLIST_ITEMS_MAX`. */
        checklists: z.array(taskChecklistSchema).optional(),
        /** Todos os itens de checklist da tarefa, antes do teto. */
        checklistItemTotal: z.number().int().nonnegative().optional(),
        /** Até `GET_TASK_LINKS_MAX` links. */
        links: z.array(taskLinkSchema).optional(),
        linkTotal: z.number().int().nonnegative().optional(),
        /** O histórico de movimentação, do mais antigo ao mais novo; cortado, os `GET_TASK_HISTORY_MAX` mais recentes. */
        history: z.array(taskHistoryEventSchema).optional(),
        /** Todos os fatos do histórico que a concessão enxerga, antes do teto. */
        historyTotal: z.number().int().nonnegative().optional(),
        /** Quem criou / concluiu: exige people:read. */
        createdBy: namedRefSchema.nullable().optional(),
        completedBy: namedRefSchema.nullable().optional(),
        /** O nome da conexão de IA que criou a tarefa; nulo = criada por gente. */
        createdVia: z.string().nullable().optional(),
        createdAt: z.string().datetime().nullable().optional(),
        /** A pasta e o espaço da lista; o nome exige boards:read. */
        folder: maybeNamedRefSchema.nullable().optional(),
        space: maybeNamedRefSchema.nullable().optional(),
      })
      .strict(),
  })
  .strict();

export const getClientInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

/** Mesmo vocabulário do enum `ideworks.urgency_level`; a tela mostra Em dia / Atenção / Crítico. */
export const CLIENT_URGENCIES = ['paz', 'alerta', 'perigo'] as const;

export const clientTagSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.string().nullable(),
  })
  .strict();

export const clientQuotaSchema = z
  .object({
    type: z.enum(CONTENT_TYPES),
    quantity: z.number().int().nonnegative(),
  })
  .strict();

/** Os campos do cadastro do cliente que `get_client` e `list_clients` dividem. */
const clientProfileShape = {
  plan: namedRefSchema.nullable().optional(),
  /** Em dia (paz), Atenção (alerta) ou Crítico (perigo): a urgência marcada à mão no cadastro. */
  urgency: z.enum(CLIENT_URGENCIES).optional(),
  /** AAAA-MM-DD. */
  startedOn: z.string().regex(CIVIL_DAY).nullable().optional(),
  renewsOn: z.string().regex(CIVIL_DAY).nullable().optional(),
  tags: z.array(clientTagSchema).optional(),
};

export const clientListLinkSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).nullable(),
    archived: z.boolean(),
    space: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1).nullable(),
      })
      .strict(),
    folder: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const getClientResponseSchema = z
  .object({
    operation: z.literal('get_client'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    /**
     * Cliente ativo: a ficha mínima e as listas. Cliente CANCELADO (F38,
     * Fase 4): só a identificação, `cancelled: true` e o dia do cancelamento —
     * mural, histórico e tarefas dele continuam nas leituras próprias.
     */
    client: z.union([
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          company: namedRefSchema,
          lists: z.array(clientListLinkSchema),
          /*
           * G5 — a ficha do cadastro, aditiva e opcional. NUNCA contato: sem CNPJ,
           * telefone, WhatsApp, e-mail, endereço, nome ou telefone do responsável
           * do cliente, observações nem links úteis.
           */
          ...clientProfileShape,
          /** A cota VIGENTE por tipo (o que o cliente contrata hoje; o do mês é o contrato congelado — get_client_month). */
          quotas: z.array(clientQuotaSchema).optional(),
        })
        .strict(),
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          cancelled: z.literal(true),
          cancelledOn: cancelledOnSchema.nullable(),
        })
        .strict(),
    ]),
  })
  .strict();

/**
 * G5 — `list_clients`: a carteira ATIVA do recorte, uma linha por cliente com o
 * que o cadastro diz (plano, urgência, financeiro, início, renovação, etiquetas).
 * Sem contato. Cliente cancelado não aparece (só a carteira ativa). Leitura sob
 * `clients:read`; filtros por empresa, urgência e nome, e a página pelo cursor.
 */
export const LIST_CLIENTS_MAX_LIMIT = 100;
export const LIST_CLIENTS_INPUT_MESSAGE =
  'Use companyId (uuid), urgency (paz, alerta ou perigo), q (parte do nome), limit (inteiro) e cursor, ou omita.';

export const listClientsInputSchema = z
  .object({
    companyId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    urgency: z.enum(CLIENT_URGENCIES).optional(),
    /** Parte do nome, sem diferença de acento nem de caixa. */
    q: z.string().min(1).max(100).optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const listClientsItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    company: namedRefSchema,
    plan: namedRefSchema.nullable(),
    urgency: z.enum(CLIENT_URGENCIES),
    startedOn: z.string().regex(CIVIL_DAY).nullable(),
    renewsOn: z.string().regex(CIVIL_DAY).nullable(),
    tags: z.array(clientTagSchema),
  })
  .strict();

export const listClientsResponseSchema = z
  .object({
    operation: z.literal('list_clients'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    /** Quantos clientes batem com o filtro, antes da página. */
    total: z.number().int().nonnegative(),
    /** Por nome. */
    clients: z.array(listClientsItemSchema),
  })
  .strict();

export type ListClientsInput = z.infer<typeof listClientsInputSchema>;
export type ListClientsResponse = z.infer<typeof listClientsResponseSchema>;
export type ListClientsItem = z.infer<typeof listClientsItemSchema>;

/**
 * G11 — `list_boards`: as LISTAS do recorte com o lugar delas na árvore (espaço
 * e pasta), o cliente, se exigem cliente e se são de produção. É de onde saem os
 * `listId` de `get_board`, `get_workflow`, `create_task` e `list_tasks`. Leitura
 * sob `boards:read`; o nome do cliente exige `clients:read`.
 */
export const LIST_BOARDS_MAX_LIMIT = 100;
export const LIST_BOARDS_INPUT_MESSAGE =
  'Use companyId, spaceId, folderId, clientId (uuid), includeArchived (true ou false), limit (inteiro) e cursor, ou omita.';

export const listBoardsInputSchema = z
  .object({
    companyId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    spaceId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    folderId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    clientId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    /** Padrão: só as listas vivas. */
    includeArchived: z.boolean().optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const listBoardsItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    space: maybeNamedRefSchema,
    folder: maybeNamedRefSchema.nullable(),
    company: namedRefSchema,
    client: maybeNamedRefSchema.nullable(),
    /** A lista é compartilhada: toda tarefa nova precisa de clientId. */
    requiresClient: z.boolean(),
    /** A esteira tem a etapa "atribuir demanda": toda tarefa nova precisa de type. */
    isProduction: z.boolean(),
    archived: z.boolean(),
  })
  .strict();

export const listBoardsResponseSchema = z
  .object({
    operation: z.literal('list_boards'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    /** Quantas listas batem com o filtro, antes da página. */
    total: z.number().int().nonnegative(),
    /** Por espaço, pasta e nome. */
    boards: z.array(listBoardsItemSchema),
  })
  .strict();

export type ListBoardsInput = z.infer<typeof listBoardsInputSchema>;
export type ListBoardsItem = z.infer<typeof listBoardsItemSchema>;
export type ListBoardsResponse = z.infer<typeof listBoardsResponseSchema>;

/**
 * G11 — `list_tasks`: as tarefas do recorte com filtro, de uma lista, de uma
 * pasta, de um espaço ou de todo o recorte ("atrasadas da pasta X", "o que a
 * Carla criou para outros"). A mesma tarefa de `get_board`/`get_person_work`, com
 * o mesmo recorte; só tarefa não arquivada de cliente ativo. Leitura sob
 * `tasks:read`; os filtros `assigneeId` e `createdBy` exigem `people:read`.
 */
export const LIST_TASKS_MAX_LIMIT = 100;
export const LIST_TASKS_INPUT_MESSAGE =
  'Use no máximo um de spaceId, folderId ou listId (uuid); assigneeId, createdBy, clientId (uuid); statusType; type; dueBefore (AAAA-MM-DD); overdue e completed (true ou false); limit e cursor, ou omita.';

export const listTasksInputSchema = z
  .object({
    /** No máximo um dos três; nenhum = todo o recorte. */
    spaceId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    folderId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    listId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    /** Responsável pela tarefa (exige people:read). */
    assigneeId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    /** Quem criou a tarefa (exige people:read). */
    createdBy: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    statusType: z.enum(STATUS_TYPES).optional(),
    type: z.enum(TASK_DEMAND_TYPES).optional(),
    /** Prazo ANTES deste dia (AAAA-MM-DD, exclusivo). */
    dueBefore: z.string().regex(CIVIL_DAY, 'Use AAAA-MM-DD.').optional(),
    /** Prazo antes de hoje (dia de São Paulo) e ainda não concluída. */
    overdue: z.boolean().optional(),
    clientId: z.string().regex(INTEGRATION_UUID, 'UUID inválido.').optional(),
    /** true = só as concluídas; false = só as abertas. */
    completed: z.boolean().optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const listTasksItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    statusId: z.string().min(1).nullable(),
    statusName: z.string().min(1).nullable(),
    statusType: z.enum(STATUS_TYPES).nullable(),
    priority: z.enum(TASK_PRIORITIES).nullable(),
    type: z.enum(TASK_DEMAND_TYPES).nullable(),
    dueOn: z.string().nullable(),
    startOn: z.string().nullable(),
    completedAt: z.string().datetime().nullable(),
    /** A lista; o nome exige boards:read. */
    list: maybeNamedRefSchema.nullable(),
    /** O cliente da tarefa (ou o da lista); o nome exige clients:read. */
    client: maybeNamedRefSchema.nullable(),
    /** Os responsáveis; nulo sem people:read. */
    people: z.array(namedRefSchema).nullable(),
  })
  .strict();

export const listTasksResponseSchema = z
  .object({
    operation: z.literal('list_tasks'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    /** O dia de hoje em São Paulo, o que `overdue` usa. */
    today: z.string().regex(CIVIL_DAY),
    /** Quantas tarefas batem com o filtro, antes da página. */
    total: z.number().int().nonnegative(),
    /** Por título. */
    tasks: z.array(listTasksItemSchema),
  })
  .strict();

export type ListTasksInput = z.infer<typeof listTasksInputSchema>;
export type ListTasksItem = z.infer<typeof listTasksItemSchema>;
export type ListTasksResponse = z.infer<typeof listTasksResponseSchema>;

export const listCommentsInputSchema = z
  .object({
    taskId: z.string().min(1),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const commentItemSchema = z
  .object({
    id: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    body: z.string(),
    createdAt: z.string().datetime(),
    author: namedRefSchema.nullable(),
    /** F42: escrito pelo cliente no link de aprovação — `author` vem nulo. */
    fromClient: z.boolean().optional(),
  })
  .strict();

export const listCommentsResponseSchema = z
  .object({
    operation: z.literal('list_comments'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    taskId: z.string().min(1),
    items: z.array(commentItemSchema),
  })
  .strict();

const uuidSchema = z.string().regex(INTEGRATION_UUID, 'UUID inválido.');

/** F16.7: comentar. Sem authorId — o autor é o dono da concessão. Schema estrito. */
export const addCommentInputSchema = z
  .object({
    taskId: uuidSchema,
    body: z.string(),
    parentId: uuidSchema.nullable().optional(),
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !/[\r\n]/.test(value), 'A chave de idempotência é inválida.'),
  })
  .strict();

export const addCommentActedAsSchema = z
  .object({
    ownerId: z.string().min(1),
    integrationId: z.string().min(1),
    integrationName: z.string().min(1),
  })
  .strict();

export const addCommentResponseSchema = z
  .object({
    operation: z.literal('add_comment'),
    commentId: z.string().min(1),
    taskId: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    executionId: z.string().min(1),
    replay: z.boolean(),
    actedAs: addCommentActedAsSchema,
  })
  .strict();

export type AddCommentInput = z.infer<typeof addCommentInputSchema>;
export type AddCommentResponse = z.infer<typeof addCommentResponseSchema>;

const observedOriginSchema = z
  .object({
    listId: uuidSchema,
    statusId: uuidSchema.nullable(),
  })
  .strict();

const moveStatusOptionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    color: z.string().min(1).nullable(),
  })
  .strict();

const moveAutomationSchema = z
  .object({
    name: z.string().min(1),
    moved: z.boolean(),
    assigned: z.boolean(),
    removed: z.number().int().nonnegative(),
  })
  .strict();

/** F16.8: prévia sem escrita. Origem observada é obrigatória — sem ela, relê. */
export const previewMoveInputSchema = z
  .object({
    taskId: uuidSchema,
    listId: uuidSchema,
    statusId: uuidSchema.nullable().optional(),
    from: observedOriginSchema,
  })
  .strict();

export const previewMoveResponseSchema = z
  .object({
    operation: z.literal('preview_move'),
    taskId: z.string().min(1),
    from: observedOriginSchema,
    listId: z.string().min(1),
    statusId: z.string().min(1),
    statusName: z.string().min(1).nullable(),
    completed: z.boolean(),
    reopened: z.boolean(),
    subtasksWouldMove: z.number().int().nonnegative(),
    automation: moveAutomationSchema.nullable(),
    writeImpact: z.enum(['auto', 'preview_required']),
  })
  .strict();

/** F16.8: movimento. `approved` do modelo não entra — schema estrito. */
export const moveTaskInputSchema = z
  .object({
    taskId: uuidSchema,
    listId: uuidSchema,
    statusId: uuidSchema.nullable().optional(),
    from: observedOriginSchema,
    idempotencyKey: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => !/[\r\n]/.test(value), 'A chave de idempotência é inválida.'),
    approvalId: uuidSchema.optional(),
  })
  .strict();

export const moveTaskResponseSchema = z
  .object({
    operation: z.literal('move_task'),
    taskId: z.string().min(1),
    listId: z.string().min(1),
    statusId: z.string().min(1),
    statusName: z.string().min(1).nullable(),
    completed: z.boolean(),
    reopened: z.boolean(),
    subtasksMoved: z.number().int().nonnegative(),
    automation: moveAutomationSchema.nullable(),
    executionId: z.string().min(1),
    replay: z.boolean(),
    actedAs: addCommentActedAsSchema,
  })
  .strict();

export const statusChoiceRequiredSchema = z
  .object({
    error: z.literal('status_choice_required'),
    message: z.string().min(1),
    /** Ausente no `create_task`: a tarefa ainda não existe. */
    taskId: z.string().min(1).optional(),
    listId: z.string().min(1),
    listName: z.string().min(1),
    options: z.array(moveStatusOptionSchema).min(1),
  })
  .strict();

/**
 * F40 — a recusa por falta de tipo, no formato das outras recusas de escolha
 * (`status_choice_required`): a frase da tela e as opções para a IA corrigir
 * sozinha e repetir o pedido com `type`.
 */
export const typeRequiredSchema = z
  .object({
    error: z.literal('type_required'),
    message: z.string().min(1),
    /** Ausente na criação: a tarefa ainda não existe. */
    taskId: z.string().min(1).optional(),
    listId: z.string().min(1).optional(),
    options: z.array(z.object({ value: z.enum(TASK_DEMAND_TYPES), label: z.string().min(1) }).strict()).min(1),
  })
  .strict();

export type TypeRequired = z.infer<typeof typeRequiredSchema>;

export type PreviewMoveInput = z.infer<typeof previewMoveInputSchema>;
export type PreviewMoveResponse = z.infer<typeof previewMoveResponseSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskInputSchema>;
export type MoveTaskResponse = z.infer<typeof moveTaskResponseSchema>;
export type StatusChoiceRequired = z.infer<typeof statusChoiceRequiredSchema>;
export type MoveStatusOption = z.infer<typeof moveStatusOptionSchema>;
export type MoveAutomationEffect = z.infer<typeof moveAutomationSchema>;

/* ───────────────────────── F26.5 — escritas de tarefa ───────────────────────── */

/** Teto de pessoas e de etiquetas por pedido. Uma tarefa real tem poucas. */
export const AGENT_TASK_MAX_PEOPLE = 50;
export const AGENT_TASK_MAX_TAGS = 50;
/** O banco só exige título não vazio; o contrato põe um teto de bom senso. */
export const AGENT_TASK_TITLE_MAX = 500;

/**
 * Dia civil de verdade, e não só o formato: `2026-02-30` passa no regex e o
 * Postgres recusaria com 22008 depois de o registro já ter começado.
 */
function isCalendarDay(value: string): boolean {
  if (!CIVIL_DAY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

const civilDaySchema = z
  .string()
  .regex(CIVIL_DAY, 'Use AAAA-MM-DD.')
  .refine(isCalendarDay, 'Esta data não existe no calendário.');

const agentIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !/[\r\n]/.test(value), 'A chave de idempotência é inválida.');

/**
 * `dryRun: true` confere TUDO (permissão, recorte, regras do banco, teto do
 * dia) e responde o que faria, sem gravar, sem entrar no registro e sem gastar
 * teto. Decisão 6 da F26.
 */
const dryRunSchema = z.boolean().optional();

/**
 * F26.5: criar tarefa. Sem autor no pedido — o autor é o dono da concessão.
 * Responsáveis na criação exigem também `tasks:assign`.
 *
 * F38, Fase 6: `clientId` opcional. Em lista de cliente a tarefa herda o
 * cliente da lista; em lista compartilhada ele é obrigatório; em lista interna,
 * opcional. Cliente cancelado ou fora do alcance é recusado.
 *
 * F38, Fase 6.3: `statusId` opcional — a etapa em que o card nasce, uma da
 * esteira da lista (a de `get_workflow`). Ausente, vale a primeira que abre.
 * Etapa de outra lista: `status_choice_required` com as opções da lista.
 *
 * F38, Fase 6.4: `parentId` opcional — cria SUBTAREFA da tarefa-mãe. Ela nasce
 * na lista da mãe e herda o cliente dela. Com `parentId`, `listId` fica
 * opcional (se vier, tem de ser o da mãe) e `clientId`, se vier, tem de ser o
 * da mãe. "listId OU parentId" é conferido em `createTaskWork` (um `.refine`
 * viraria ZodEffects; mesma decisão de `get_workflow`).
 */
export const createTaskInputSchema = z
  .object({
    listId: uuidSchema.optional(),
    parentId: uuidSchema.optional(),
    clientId: uuidSchema.optional(),
    statusId: uuidSchema.optional(),
    /**
     * F40: o tipo da demanda. OBRIGATÓRIO em lista de produção (a esteira tem a
     * etapa "atribuir demanda"; `get_workflow` diz em `isProduction`): sem ele
     * a criação é recusada com `type_required` e as opções. Opcional nas demais.
     */
    type: z.enum(TASK_DEMAND_TYPES).optional(),
    title: z.string().min(1).max(AGENT_TASK_TITLE_MAX),
    description: z.string().nullable().optional(),
    dueOn: civilDaySchema.nullable().optional(),
    startOn: civilDaySchema.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).nullable().optional(),
    tagIds: z.array(uuidSchema).max(AGENT_TASK_MAX_TAGS).optional(),
    assigneeIds: z.array(uuidSchema).max(AGENT_TASK_MAX_PEOPLE).optional(),
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

/**
 * F26.5: editar tarefa. Só o que vem muda; ausente é "não mexer", e `null` é
 * "limpar" (prazo, início, prioridade, descrição). Etapa é `move_task`,
 * responsáveis é `assign_task`, conclusão é `complete_task`/`reopen_task`.
 */
export const updateTaskInputSchema = z
  .object({
    taskId: uuidSchema,
    /**
     * F40: troca o tipo da demanda. `null` apaga — recusado (`type_required`)
     * em lista de produção quando a tarefa já tem tipo.
     */
    type: z.enum(TASK_DEMAND_TYPES).nullable().optional(),
    title: z.string().min(1).max(AGENT_TASK_TITLE_MAX).optional(),
    description: z.string().nullable().optional(),
    dueOn: civilDaySchema.nullable().optional(),
    startOn: civilDaySchema.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).nullable().optional(),
    tagIds: z.array(uuidSchema).max(AGENT_TASK_MAX_TAGS).optional(),
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

/** F26.5: a lista FINAL de responsáveis. Substitui a atual; `[]` tira todos. */
export const assignTaskInputSchema = z
  .object({
    taskId: uuidSchema,
    assigneeIds: z.array(uuidSchema).max(AGENT_TASK_MAX_PEOPLE),
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

/** F26.5: concluir e reabrir têm a mesma entrada. */
export const completeTaskInputSchema = z
  .object({
    taskId: uuidSchema,
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

export const reopenTaskInputSchema = completeTaskInputSchema;

/**
 * F40, Fase 9: liberar a demanda do painel dos admins — grava pessoas e prazo e
 * move o card de "atribuir demanda" para a fila do tipo, numa transação só.
 * A regra é `liberarDemandaInTx`, a mesma da rota `POST /admin/semana/liberar`.
 */
export const releaseTaskInputSchema = z
  .object({
    taskId: uuidSchema,
    /** A lista FINAL de responsáveis; pelo menos um. */
    assigneeIds: z.array(uuidSchema).min(1).max(AGENT_TASK_MAX_PEOPLE),
    /** O prazo real (AAAA-MM-DD). */
    dueOn: civilDaySchema,
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

/**
 * O estado da tarefa DEPOIS da escrita, relido do banco na mesma transação.
 * Só ids e campos pequenos — nem título nem descrição: a resposta é compacta
 * e o registro guarda este mesmo objeto para o replay.
 */
export const agentTaskStateSchema = z
  .object({
    listId: z.string().min(1),
    statusId: z.string().min(1).nullable(),
    completed: z.boolean(),
    dueOn: z.string().min(1).nullable(),
    startOn: z.string().min(1).nullable(),
    priority: z.enum(TASK_PRIORITIES).nullable(),
    /** F40: o tipo da demanda depois da escrita (o ensaio mostra o que ficaria). */
    type: z.enum(TASK_DEMAND_TYPES).nullable(),
    assigneeIds: z.array(z.string().min(1)),
    tagIds: z.array(z.string().min(1)),
  })
  .strict();

/** Só no ensaio (`dryRun`): a cota do dia como estava, sem esta escrita. */
export const agentDailyWritesSchema = z
  .object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    resetsAt: z.string().datetime(),
  })
  .strict();

const taskWriteFields = {
  /** `true` = ensaio: nada foi gravado, nada entrou no registro, nada contou no teto. */
  dryRun: z.boolean(),
  task: agentTaskStateSchema,
  /** Nulo no ensaio (não há execução), exceto quando a chave já tinha escrita. */
  executionId: z.string().min(1).nullable(),
  replay: z.boolean(),
  actedAs: addCommentActedAsSchema,
  dailyWrites: agentDailyWritesSchema.optional(),
};

export const createTaskResponseSchema = z
  .object({
    operation: z.literal('create_task'),
    /** Nulo no ensaio: a tarefa não existe, e um id fantasma induziria o agente a usá-lo. */
    taskId: z.string().min(1).nullable(),
    /** F38, Fase 6.4 — só quando a tarefa criada é subtarefa: a mãe. */
    parentId: z.string().min(1).optional(),
    ...taskWriteFields,
  })
  .strict();

export const updateTaskResponseSchema = z
  .object({
    operation: z.literal('update_task'),
    taskId: z.string().min(1),
    ...taskWriteFields,
  })
  .strict();

export const assignTaskResponseSchema = z
  .object({
    operation: z.literal('assign_task'),
    taskId: z.string().min(1),
    ...taskWriteFields,
  })
  .strict();

export const completeTaskResponseSchema = z
  .object({
    operation: z.literal('complete_task'),
    taskId: z.string().min(1),
    ...taskWriteFields,
  })
  .strict();

export const reopenTaskResponseSchema = z
  .object({
    operation: z.literal('reopen_task'),
    taskId: z.string().min(1),
    ...taskWriteFields,
  })
  .strict();

/** F40, Fase 9: a liberação devolve a tarefa como ficou e o nome da etapa de destino. */
export const releaseTaskResponseSchema = z
  .object({
    operation: z.literal('release_task'),
    taskId: z.string().min(1),
    /** O nome da etapa para onde o card foi (ex.: "a fazer video"). */
    statusName: z.string().min(1),
    ...taskWriteFields,
  })
  .strict();

export type TaskPriorityName = (typeof TASK_PRIORITIES)[number];
export type AgentTaskStateView = z.infer<typeof agentTaskStateSchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskInputSchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskInputSchema>;
export type ReopenTaskInput = z.infer<typeof reopenTaskInputSchema>;
export type ReleaseTaskInput = z.infer<typeof releaseTaskInputSchema>;
export type ReleaseTaskResponse = z.infer<typeof releaseTaskResponseSchema>;
export type CreateTaskResponse = z.infer<typeof createTaskResponseSchema>;
export type UpdateTaskResponse = z.infer<typeof updateTaskResponseSchema>;
export type AssignTaskResponse = z.infer<typeof assignTaskResponseSchema>;
export type CompleteTaskResponse = z.infer<typeof completeTaskResponseSchema>;
export type ReopenTaskResponse = z.infer<typeof reopenTaskResponseSchema>;

/* ─────────────────── F26.6 — mural e histórico do cliente ─────────────────── */

/**
 * Mesmo vocabulário de `CORES_DA_NOTA` (`server/mural-e-captacao.ts`) e do enum
 * `ideworks.note_color`. Repetido aqui, e não importado, porque aquele módulo
 * puxa o driver do banco; um teste prende as duas listas iguais.
 */
export const MURAL_NOTE_COLORS = ['yellow', 'green', 'blue', 'red'] as const;

/** Teto de bom senso para título, subtítulo e "quem conduziu" em texto livre. */
export const AGENT_RECORD_SHORT_TEXT_MAX = 500;
/**
 * Teto do texto da nota e do relato do registro: METADE do orçamento de
 * resposta (64 KiB). O que a IA escreve precisa caber de volta numa página de
 * `get_client_mural`/`get_client_history` junto do envelope — um texto de
 * 64 KiB seria gravável e ilegível pela mesma IA.
 */
export const AGENT_RECORD_TEXT_MAX_BYTES = 32 * 1024;

const clientRecordPageInput = {
  clientId: z.string().min(1),
  limit: z.number().int().optional(),
  cursor: z.string().min(1).optional(),
};

/** F26.6: o mural de um cliente, paginado. Leitura sob `clients:read`. */
export const getClientMuralInputSchema = z.object(clientRecordPageInput).strict();

/** F26.6: o histórico de um cliente, paginado. Leitura sob `clients:read`. */
export const CLIENT_HISTORY_QUERY_MAX = 100;

/**
 * `query` (F37, Fase 5): a mesma busca da barra do site — sem acento, sem
 * diferença de maiúscula, várias palavras valem TODAS, em qualquer campo.
 * `%`, `_` e `\` são texto, nunca curinga. Mínimo 1 caractere útil (o site não
 * exige mais que isso); só espaços é recusado em vez de virar "tudo".
 */
export const getClientHistoryInputSchema = z
  .object({
    ...clientRecordPageInput,
    query: z.string().trim().min(1).max(CLIENT_HISTORY_QUERY_MAX).optional(),
  })
  .strict();

const clientRecordOrigin = {
  /**
   * O nome da conexão de IA que CRIOU a linha ("Claude"), no instante. Nulo =
   * escrita por uma pessoa. Retrato: sobrevive à conexão revogada.
   */
  viaName: z.string().min(1).nullable(),
  /**
   * `true` quando a IA DESTA conexão pode editar a linha: criada pela IA da
   * mesma pessoa (regra do banco, F26.2). As outras, a edição recusa.
   */
  agentEditable: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const muralNoteItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).nullable(),
    content: z.string(),
    color: z.enum(MURAL_NOTE_COLORS),
    /** Nulo sem `people:read` — a mesma regra do autor do comentário. */
    author: namedRefSchema.nullable(),
    ...clientRecordOrigin,
  })
  .strict();

export const historyEntryItemSchema = z
  .object({
    id: z.string().min(1),
    /** Quando aconteceu (AAAA-MM-DD) — não quando foi registrado. */
    happenedOn: z.string().regex(CIVIL_DAY),
    title: z.string().min(1),
    subtitle: z.string().min(1).nullable(),
    body: z.string(),
    /** Quem conduziu, se é do time. Nulo sem `people:read`. */
    ledBy: namedRefSchema.nullable(),
    /** Quem conduziu, em texto livre (gente de fora do time). */
    ledByNote: z.string().min(1).nullable(),
    /** Nulo sem `people:read`. */
    author: namedRefSchema.nullable(),
    /** Quantos documentos estão anexados. Os links não saem por aqui. */
    documentCount: z.number().int().nonnegative(),
    ...clientRecordOrigin,
  })
  .strict();

const clientRefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

export const getClientMuralResponseSchema = z
  .object({
    operation: z.literal('get_client_mural'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    client: clientRefSchema,
    items: z.array(muralNoteItemSchema),
  })
  .strict();

export const getClientHistoryResponseSchema = z
  .object({
    operation: z.literal('get_client_history'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    client: clientRefSchema,
    items: z.array(historyEntryItemSchema),
  })
  .strict();

const shortTextSchema = z.string().max(AGENT_RECORD_SHORT_TEXT_MAX);

/**
 * F26.6: criar nota no mural. Sem autor no pedido — o autor é o dono da
 * concessão. Cor ausente = amarela, como na tela.
 */
export const addMuralNoteInputSchema = z
  .object({
    clientId: uuidSchema,
    title: shortTextSchema.nullable().optional(),
    content: z.string().min(1),
    color: z.enum(MURAL_NOTE_COLORS).optional(),
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

/**
 * F26.6: editar nota. Só o que vem muda; `title: null` (ou vazio) tira o
 * título. Posição e tamanho são da tela, e não entram aqui.
 */
export const updateMuralNoteInputSchema = z
  .object({
    noteId: uuidSchema,
    title: shortTextSchema.nullable().optional(),
    content: z.string().min(1).optional(),
    color: z.enum(MURAL_NOTE_COLORS).optional(),
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

/**
 * F26.6: registrar no histórico. `happenedOn` é quando aconteceu. Quem
 * conduziu é `ledBy` (id de pessoa do time) e/ou `ledByNote` (texto livre).
 */
export const addHistoryEntryInputSchema = z
  .object({
    clientId: uuidSchema,
    happenedOn: civilDaySchema,
    title: z.string().min(1).max(AGENT_RECORD_SHORT_TEXT_MAX),
    subtitle: shortTextSchema.nullable().optional(),
    body: z.string().min(1),
    ledBy: uuidSchema.nullable().optional(),
    ledByNote: shortTextSchema.nullable().optional(),
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

/** F26.6: editar registro. Só o que vem muda; `null` limpa os opcionais. */
export const updateHistoryEntryInputSchema = z
  .object({
    entryId: uuidSchema,
    happenedOn: civilDaySchema.optional(),
    title: z.string().min(1).max(AGENT_RECORD_SHORT_TEXT_MAX).optional(),
    subtitle: shortTextSchema.nullable().optional(),
    body: z.string().min(1).optional(),
    ledBy: uuidSchema.nullable().optional(),
    ledByNote: shortTextSchema.nullable().optional(),
    idempotencyKey: agentIdempotencyKeySchema,
    dryRun: dryRunSchema,
  })
  .strict();

/**
 * A nota DEPOIS da escrita, relida na mesma transação. Sem título e sem texto:
 * a resposta é compacta e o registro guarda este objeto para o replay.
 * `viaName` é a marca que o banco gravou (F26.2) — a prova de que saiu marcada.
 */
export const agentMuralNoteStateSchema = z
  .object({
    clientId: z.string().min(1),
    color: z.enum(MURAL_NOTE_COLORS),
    viaName: z.string().min(1).nullable(),
  })
  .strict();

/** O registro DEPOIS da escrita, relido. Só data, pessoa e marca — nenhum texto. */
export const agentHistoryEntryStateSchema = z
  .object({
    clientId: z.string().min(1),
    happenedOn: z.string().regex(CIVIL_DAY),
    ledById: z.string().min(1).nullable(),
    viaName: z.string().min(1).nullable(),
  })
  .strict();

const recordWriteFields = {
  /** `true` = ensaio: nada foi gravado, nada entrou no registro, nada contou no teto. */
  dryRun: z.boolean(),
  /** Nulo no ensaio (não há execução), exceto quando a chave já tinha escrita. */
  executionId: z.string().min(1).nullable(),
  replay: z.boolean(),
  actedAs: addCommentActedAsSchema,
  dailyWrites: agentDailyWritesSchema.optional(),
};

export const addMuralNoteResponseSchema = z
  .object({
    operation: z.literal('add_mural_note'),
    /** Nulo no ensaio: a nota não existe, e um id fantasma induziria o agente a usá-lo. */
    noteId: z.string().min(1).nullable(),
    note: agentMuralNoteStateSchema,
    ...recordWriteFields,
  })
  .strict();

export const updateMuralNoteResponseSchema = z
  .object({
    operation: z.literal('update_mural_note'),
    noteId: z.string().min(1),
    note: agentMuralNoteStateSchema,
    ...recordWriteFields,
  })
  .strict();

export const addHistoryEntryResponseSchema = z
  .object({
    operation: z.literal('add_history_entry'),
    /** Nulo no ensaio, pelo mesmo motivo de `noteId`. */
    entryId: z.string().min(1).nullable(),
    entry: agentHistoryEntryStateSchema,
    ...recordWriteFields,
  })
  .strict();

export const updateHistoryEntryResponseSchema = z
  .object({
    operation: z.literal('update_history_entry'),
    entryId: z.string().min(1),
    entry: agentHistoryEntryStateSchema,
    ...recordWriteFields,
  })
  .strict();

export type MuralNoteColor = (typeof MURAL_NOTE_COLORS)[number];
export type MuralNoteItem = z.infer<typeof muralNoteItemSchema>;
export type HistoryEntryItem = z.infer<typeof historyEntryItemSchema>;
export type GetClientMuralInput = z.infer<typeof getClientMuralInputSchema>;
export type GetClientHistoryInput = z.infer<typeof getClientHistoryInputSchema>;
export type GetClientMuralResponse = z.infer<typeof getClientMuralResponseSchema>;
export type GetClientHistoryResponse = z.infer<typeof getClientHistoryResponseSchema>;
export type AgentMuralNoteStateView = z.infer<typeof agentMuralNoteStateSchema>;
export type AgentHistoryEntryStateView = z.infer<typeof agentHistoryEntryStateSchema>;
export type AddMuralNoteInput = z.infer<typeof addMuralNoteInputSchema>;
export type UpdateMuralNoteInput = z.infer<typeof updateMuralNoteInputSchema>;
export type AddHistoryEntryInput = z.infer<typeof addHistoryEntryInputSchema>;
export type UpdateHistoryEntryInput = z.infer<typeof updateHistoryEntryInputSchema>;
export type AddMuralNoteResponse = z.infer<typeof addMuralNoteResponseSchema>;
export type UpdateMuralNoteResponse = z.infer<typeof updateMuralNoteResponseSchema>;
export type AddHistoryEntryResponse = z.infer<typeof addHistoryEntryResponseSchema>;
export type UpdateHistoryEntryResponse = z.infer<typeof updateHistoryEntryResponseSchema>;

export const listPeopleInputSchema = z
  .object({
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

/** Diretório mínimo: id, nome de exibição, equipe visível. Sem e-mail, papel ou carteira. */
export const personDirectoryItemSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    team: namedRefSchema.nullable(),
  })
  .strict();

export const listPeopleResponseSchema = z
  .object({
    operation: z.literal('list_people'),
    queriedAt: z.string().datetime(),
    self: z.literal(LIST_PEOPLE_PATH),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    items: z.array(personDirectoryItemSchema),
  })
  .strict();

export const getPersonWorkInputSchema = z
  .object({
    id: z.string().min(1),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const personWorkItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    statusId: z.string().min(1).nullable(),
    // F37: etapa real da esteira (nome e tipo) e prioridade — opcionais/anuláveis,
    // para agrupar a fila por etapa como o Kanban "Minhas tarefas" do site.
    statusName: z.string().nullable().optional(),
    statusType: z.enum(STATUS_TYPES).nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).nullable().optional(),
    /** F40: o tipo da demanda; nulo no card antigo e em lista interna. */
    type: z.enum(TASK_DEMAND_TYPES).nullable().optional(),
    dueOn: z.string().nullable(),
    board: maybeNamedRefSchema.nullable(),
    client: maybeNamedRefSchema.nullable(),
  })
  .strict();

export const personWorkCountsSchema = z
  .object({
    tasks: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
  })
  .strict();

export const getPersonWorkResponseSchema = z
  .object({
    operation: z.literal('get_person_work'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    ...continuationSchema,
    person: personDirectoryItemSchema,
    counts: personWorkCountsSchema,
    returned: z.number().int().nonnegative(),
    items: z.array(personWorkItemSchema),
  })
  .strict();

export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchHit = z.infer<typeof searchHitSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type GetBoardResponse = z.infer<typeof getBoardResponseSchema>;
export type GetTaskResponse = z.infer<typeof getTaskResponseSchema>;
export type GetClientResponse = z.infer<typeof getClientResponseSchema>;
export type ListCommentsResponse = z.infer<typeof listCommentsResponseSchema>;
export type ListPeopleResponse = z.infer<typeof listPeopleResponseSchema>;
export type GetPersonWorkResponse = z.infer<typeof getPersonWorkResponseSchema>;
export type PersonDirectoryItem = z.infer<typeof personDirectoryItemSchema>;

const contentTypeSchema = z.enum(CONTENT_TYPES);

const typeTotalsSchema = z
  .object({
    contracted: z.number().nonnegative(),
    delivered: z.number().nonnegative(),
    extras: z.number().nonnegative(),
  })
  .strict();

const typeBreakdownSchema = z
  .object({
    contentType: contentTypeSchema,
    weight: z.number(),
    contracted: z.number(),
    delivered: z.number(),
    extras: z.number(),
    contractedPoints: z.number(),
    deliveredPoints: z.number(),
    extraPoints: z.number(),
  })
  .strict();

export const deliveryResultSchema = z.union([
  z
    .object({
      measurable: z.literal(false),
      reason: z.enum(['no_contract', 'no_content_contract', 'empty_contract']),
      message: z.string().min(1),
      formulaVersion: z.string().min(1),
    })
    .strict(),
  z
    .object({
      measurable: z.literal(true),
      level: z.number(),
      base: z.number(),
      bonus: z.number(),
      contractedPoints: z.number(),
      deliveredPoints: z.number(),
      extraPoints: z.number(),
      breakdown: z.array(typeBreakdownSchema),
      deliveredOutsideContract: z.number(),
      formulaVersion: z.string().min(1),
    })
    .strict(),
]);

export const getDeliveryReportInputSchema = z
  .object({
    from: z.string().regex(CIVIL_DAY).optional(),
    to: z.string().regex(CIVIL_DAY).optional(),
  })
  .strict();

const periodBoundSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export const deliveryCoverageSchema = z
  .object({
    kind: z.enum(['full', 'partial']),
    reason: z.string().min(1).optional(),
  })
  .strict();

export const deliveryClientReportSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    company: namedRefSchema,
    inPeriod: z
      .object({
        scheduled: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
      })
      .strict(),
    delivery: deliveryResultSchema,
  })
  .strict();

export const getDeliveryReportResponseSchema = z
  .object({
    operation: z.literal('get_delivery_report'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    period: z
      .object({
        requested: z
          .object({
            from: z.string().min(1).nullable(),
            to: z.string().min(1).nullable(),
          })
          .strict(),
        effective: periodBoundSchema,
        timezone: z.literal(AGENCY_TIMEZONE),
      })
      .strict(),
    coverage: deliveryCoverageSchema,
    summary: z
      .object({
        clients: z.number().int().nonnegative(),
        measurable: z.number().int().nonnegative(),
        unmeasurable: z.number().int().nonnegative(),
        averageLevel: z.number().nullable(),
        inPeriod: z
          .object({
            scheduled: z.number().int().nonnegative(),
            completed: z.number().int().nonnegative(),
          })
          .strict(),
        byType: z
          .object({
            video: typeTotalsSchema,
            arte: typeTotalsSchema,
            foto: typeTotalsSchema,
            ads: typeTotalsSchema,
          })
          .strict(),
      })
      .strict(),
    clients: z.array(deliveryClientReportSchema),
  })
  .strict();

export type GetDeliveryReportInput = z.infer<typeof getDeliveryReportInputSchema>;
export type GetDeliveryReportResponse = z.infer<typeof getDeliveryReportResponseSchema>;

/*
 * F26.7 — A ENTREGA MÊS A MÊS
 *
 * `get_delivery_report` responde "como foi o período", com UM nível por
 * cliente para o intervalo inteiro. As duas leituras abaixo respondem "como
 * evoluiu": um nível por cliente POR MÊS, cada um igual ao que
 * `get_delivery_report` daria pedido só com aquele mês.
 *
 * O intervalo é em meses (AAAA-MM), não em dias: o medidor cobra o contrato do
 * mês inteiro, e pedir "de 15/08 a 10/09" numa série mensal só confundiria.
 */

/** Mês civil, AAAA-MM. */
export const DELIVERY_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Um cliente: até 24 meses por pedido (o mesmo teto de `get_delivery_report`). */
export const DELIVERY_HISTORY_MAX_MONTHS = 24;
/** A carteira: até 6 meses por pedido, só o nível — cabe em 64 KiB com ~100 clientes. */
export const DELIVERY_TREND_MAX_MONTHS = 6;
/** Sem from/to: os 6 meses que terminam no mês atual da agência. */
export const DELIVERY_SERIES_DEFAULT_MONTHS = 6;

const deliveryMonthSchema = z.string().regex(DELIVERY_MONTH_PATTERN);

const deliverySeriesRangeInput = {
  from: deliveryMonthSchema.optional(),
  to: deliveryMonthSchema.optional(),
};

export const getClientDeliveryHistoryInputSchema = z
  .object({
    clientId: z.string().min(1),
    ...deliverySeriesRangeInput,
  })
  .strict();

export const getDeliveryTrendInputSchema = z.object(deliverySeriesRangeInput).strict();

const deliverySeriesPeriodSchema = z
  .object({
    requested: z
      .object({
        from: z.string().min(1).nullable(),
        to: z.string().min(1).nullable(),
      })
      .strict(),
    /** O intervalo usado, em AAAA-MM, depois de aplicar os padrões. */
    effective: periodBoundSchema,
    /**
     * O mês civil em curso na agência. Ele ainda não fechou: um nível baixo nele
     * pode ser só o mês pela metade, não queda.
     */
    currentMonth: deliveryMonthSchema,
    timezone: z.literal(AGENCY_TIMEZONE),
  })
  .strict();

const deliveryInPeriodSchema = z
  .object({
    scheduled: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  })
  .strict();

/**
 * F38, Fase 5 — o mês de um cliente que já estava cancelado: do mês seguinte
 * ao cancelamento em diante. Não é 0% nem "mês não aberto": o cliente não está
 * na carteira daquele mês. Só existe no mês a mês; `get_delivery_report` não
 * devolve o cliente nos meses em que ele não conta.
 */
export const cancelledDeliverySchema = z
  .object({
    measurable: z.literal(false),
    reason: z.literal('cancelled'),
    message: z.string().min(1),
    /** Dia do cancelamento (`AAAA-MM-DD`, São Paulo). */
    cancelledOn: cancelledOnSchema.nullable(),
    formulaVersion: z.string().min(1),
  })
  .strict();

export type CancelledDelivery = z.infer<typeof cancelledDeliverySchema>;

export const clientDeliveryMonthSchema = z
  .object({
    month: deliveryMonthSchema,
    /** Agendado e concluído com data dentro do mês (a produção datada). Zero no mês `cancelled`. */
    inPeriod: deliveryInPeriodSchema,
    /**
     * O mesmo objeto de `get_delivery_report` para este cliente e este mês — ou,
     * depois do mês do cancelamento, `reason: 'cancelled'`.
     */
    delivery: z.union([deliveryResultSchema, cancelledDeliverySchema]),
  })
  .strict();

export const getClientDeliveryHistoryResponseSchema = z
  .object({
    operation: z.literal('get_client_delivery_history'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    period: deliverySeriesPeriodSchema,
    coverage: deliveryCoverageSchema,
    client: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        company: namedRefSchema,
      })
      .strict(),
    /** Do mês mais antigo para o mais novo. */
    months: z.array(clientDeliveryMonthSchema),
  })
  .strict();

/**
 * Nível do mês (número) ou o motivo de não ser mensurável (texto). Nunca 0%
 * no lugar de "não dá para medir". `cancelled` (F38, Fase 5): o cliente já
 * estava cancelado naquele mês e não conta nele.
 */
export const deliveryTrendLevelSchema = z.union([
  z.number(),
  z.enum(['no_contract', 'no_content_contract', 'empty_contract', 'cancelled']),
]);

export const deliveryTrendClientSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    company: namedRefSchema,
    /** Alinhado com `months` do envelope: levels[i] é o mês months[i]. */
    levels: z.array(deliveryTrendLevelSchema),
    /**
     * Pontos do penúltimo para o último mês (negativo = caiu). Nulo quando um
     * dos dois não é mensurável ou o intervalo tem um mês só.
     */
    change: z.number().nullable(),
  })
  .strict();

export const getDeliveryTrendResponseSchema = z
  .object({
    operation: z.literal('get_delivery_trend'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    period: deliverySeriesPeriodSchema,
    coverage: deliveryCoverageSchema,
    months: z.array(deliveryMonthSchema),
    /** Por mês, a mesma média de `get_delivery_report`: não mensurável fica fora. */
    summary: z.array(
      z
        .object({
          month: deliveryMonthSchema,
          clients: z.number().int().nonnegative(),
          measurable: z.number().int().nonnegative(),
          unmeasurable: z.number().int().nonnegative(),
          averageLevel: z.number().nullable(),
        })
        .strict(),
    ),
    /** Por nome, em ordem estável. */
    clients: z.array(deliveryTrendClientSchema),
  })
  .strict();

export type GetClientDeliveryHistoryInput = z.infer<typeof getClientDeliveryHistoryInputSchema>;
export type GetClientDeliveryHistoryResponse = z.infer<typeof getClientDeliveryHistoryResponseSchema>;
export type GetDeliveryTrendInput = z.infer<typeof getDeliveryTrendInputSchema>;
export type GetDeliveryTrendResponse = z.infer<typeof getDeliveryTrendResponseSchema>;
export type DeliveryTrendLevel = z.infer<typeof deliveryTrendLevelSchema>;

/**
 * F37 — `get_planning_weeks`: o mês de cada cliente por semana, o que a aba
 * Semana do Planejamento mostra. A divisão em semanas, a meta e o estado de cada
 * semana são a regra da tela (`src/painel/planejamento-semanal.ts`), não uma
 * conta daqui. Leitura sob `reports:delivery:read`.
 */
export const PLANNING_WEEKS_MAX_LIMIT = 100;
export const PLANNING_WEEKS_INPUT_MESSAGE =
  'Use month em AAAA-MM (ex.: 2026-10), clientId, ownerId (uuid), limit (inteiro) e cursor, ou omita.';

export const getPlanningWeeksInputSchema = z
  .object({
    /** AAAA-MM; sem ele, o mês atual da agência. */
    month: deliveryMonthSchema.optional(),
    clientId: z.string().min(1).optional(),
    /** Um responsável: o id da pasta (time) ou da pessoa, como em `clients[].owners[].id`. */
    ownerId: z.string().regex(INTEGRATION_UUID).optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const PLANNING_WEEK_STATES = ['neutra', 'futura', 'bateu', 'risco', 'andamento', 'abaixo'] as const;

const planningWeekSchema = z
  .object({
    number: z.number().int().positive(),
    /** AAAA-MM-DD, inclusivo. */
    from: z.string().regex(CIVIL_DAY),
    to: z.string().regex(CIVIL_DAY),
    days: z.number().int().positive(),
  })
  .strict();

const planningWeekCellSchema = z
  .object({
    /** Casa com `weeks[].number`. */
    number: z.number().int().positive(),
    /** Meta da semana: a cota do tipo dividida pelos dias úteis, soma = cota. */
    goal: z.number().int().nonnegative(),
    /** Concluídas agendadas nesta semana (extra inclusa). */
    done: z.number().int().nonnegative(),
    /** Agendadas no prazo, ainda não concluídas. */
    scheduled: z.number().int().nonnegative(),
    /** Agendadas para um dia que já passou, sem conclusão. */
    late: z.number().int().nonnegative(),
    /** O que falta para a meta: max(0, goal - done). */
    missing: z.number().int().nonnegative(),
    /** neutra, futura, bateu, risco, andamento ou abaixo — a mesma da tela. */
    state: z.enum(PLANNING_WEEK_STATES),
  })
  .strict();

const planningWeekTypeSchema = z
  .object({
    type: contentTypeSchema,
    /** Cota do mês deste tipo; 0 quando o tipo só aparece porque há peça. */
    quota: z.number().int().nonnegative(),
    /** Concluídas do tipo no mês de competência (com dia, sem dia ou fora das semanas). */
    done: z.number().int().nonnegative(),
    /** max(0, quota - done). */
    missing: z.number().int().nonnegative(),
    /** Peças sem dia agendado: não entram em semana nenhuma. */
    withoutDay: z.number().int().nonnegative(),
    /** Agendadas fora do mês de competência: também não entram em semana. */
    outsideMonth: z.number().int().nonnegative(),
    weeks: z.array(planningWeekCellSchema),
  })
  .strict();

/** Responsável do cliente: uma pasta (time) ou, sem pasta, uma pessoa da carteira. Nome de pessoa só com people:read. */
const monthOwnerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).nullable(),
    kind: z.enum(['folder', 'person']),
  })
  .strict();

const planningWeekClientSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    company: namedRefSchema,
    /** De onde veio a cota: contrato (mês aberto), cadastro (mês não aberto) ou nenhuma. */
    quotaSource: z.enum(['contrato', 'cadastro', 'nenhuma']),
    /** Sem cota mensal de conteúdo: não entra na conta de atraso. */
    noQuota: z.boolean(),
    /** Alguma semana corrente em risco. */
    atRisk: z.boolean(),
    /** Alguma semana passada abaixo da meta. */
    below: z.boolean(),
    owners: z.array(monthOwnerSchema),
    types: z.array(planningWeekTypeSchema),
  })
  .strict();

const planningWeekGroupSchema = z
  .object({
    /** Nulo = "Sem responsável". */
    owner: monthOwnerSchema.nullable(),
    /** Em risco primeiro, depois abaixo, depois o resto, e o nome. */
    clientIds: z.array(z.string().min(1)),
    atRisk: z.number().int().nonnegative(),
  })
  .strict();

export const getPlanningWeeksResponseSchema = z
  .object({
    operation: z.literal('get_planning_weeks'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    coverage: deliveryCoverageSchema,
    ...continuationSchema,
    /** AAAA-MM pedido (ou o mês atual da agência). */
    month: deliveryMonthSchema,
    /** O dia de hoje na agência: o que decide futura, risco e abaixo. */
    today: z.string().regex(CIVIL_DAY),
    timezone: z.literal(AGENCY_TIMEZONE),
    /** As semanas do mês, iguais para todo cliente. */
    weeks: z.array(planningWeekSchema),
    /** Clientes sem cota e sem peça no mês, que ficaram de fora desta lista (no filtro inteiro, não só nesta página). */
    omittedWithoutQuota: z.number().int().nonnegative(),
    /** Por nome. */
    clients: z.array(planningWeekClientSchema),
    /** Os clientes DESTA página por responsável; quem tem dois responsáveis aparece nos dois. */
    groups: z.array(planningWeekGroupSchema),
  })
  .strict();

export type GetPlanningWeeksInput = z.infer<typeof getPlanningWeeksInputSchema>;
export type GetPlanningWeeksResponse = z.infer<typeof getPlanningWeeksResponseSchema>;

/**
 * F38, Fase 3 — `get_delivery_status`: a última entrega e as peças vencidas de
 * cada cliente ATIVO, pela Semanal. É o mesmo número do cartão do Painel: a
 * regra é `deliveryStatusOf` (`src/delivery/ultima-entrega.ts`) e as peças são
 * as de `readWeeklyPieces` (`src/server/delivery-status.ts`), nada recalculado
 * aqui. Leitura sob `reports:delivery:read`.
 */
export const DELIVERY_STATUS_MAX_LIMIT = 100;
export const DELIVERY_STATUS_INPUT_MESSAGE =
  'Use clientId (de search/get_client), limit (inteiro) e cursor, ou omita.';

export const getDeliveryStatusInputSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

const deliveryStatusClientSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    company: namedRefSchema,
    /** Dia marcado (AAAA-MM-DD, São Paulo) da peça com ✓ mais recente até hoje. Nulo = sem entrega registrada. */
    lastDeliveryOn: z.string().regex(CIVIL_DAY).nullable(),
    /** Dias de lastDeliveryOn até today. Nulo junto com lastDeliveryOn. */
    daysSinceLastDelivery: z.number().int().nonnegative().nullable(),
    /** Peças sem ✓ com dia marcado ANTES de hoje (sem corte de meses). */
    overdueCount: z.number().int().nonnegative(),
    /** O dia de cada vencida, da mais antiga para a mais nova; repete se houver duas no dia. */
    overdueDays: z.array(z.string().regex(CIVIL_DAY)),
    /** Peças sem ✓ marcadas para hoje. Não são vencidas. */
    dueToday: z.number().int().nonnegative(),
    /** Peças do mês corrente sem dia marcado, com ✓ ou sem. Não entram em data nenhuma. */
    unscheduled: z.number().int().nonnegative(),
    /** O dia marcado futuro mais próximo (com ✓ ou sem). Nulo = nada marcado para frente. */
    nextScheduledOn: z.string().regex(CIVIL_DAY).nullable(),
  })
  .strict();

export const getDeliveryStatusResponseSchema = z
  .object({
    operation: z.literal('get_delivery_status'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    coverage: deliveryCoverageSchema,
    ...continuationSchema,
    /** De onde vem a entrega: a aba Semanal (peças com dia marcado e ✓), não as tarefas do quadro. */
    source: z.literal('semanal'),
    /** O dia de hoje na agência: o que separa entrega, vencida, vence hoje e próxima. */
    today: z.string().regex(CIVIL_DAY),
    timezone: z.literal(AGENCY_TIMEZONE),
    /** Clientes ATIVOS no alcance (e no filtro clientId), no filtro inteiro, não só nesta página. */
    activeClients: z.number().int().nonnegative(),
    /** Uma linha por cliente ativo, por nome. Cliente cancelado não aparece. */
    clients: z.array(deliveryStatusClientSchema),
  })
  .strict();

export type GetDeliveryStatusInput = z.infer<typeof getDeliveryStatusInputSchema>;
export type GetDeliveryStatusResponse = z.infer<typeof getDeliveryStatusResponseSchema>;

/**
 * `get_month_attention` — a lista "Precisa de atenção" da visão Contrato do
 * Planejamento (F43), pelo mês: por cliente ATIVO do recorte, o estágio do
 * ritual (aberto, planejado, aprovado), o contrato do mês por tipo repartido
 * nos seis baldes e os motivos de atenção com a frase pronta.
 *
 * NÃO TEM REGRA PRÓPRIA. Quem conta é `planejarMes` / `listaDeAtencao` /
 * `agruparMesPorResponsavel` (`src/painel/planejamento-do-mes.ts`), as MESMAS
 * funções que a tela chama, sobre o MESMO retrato de `get_planning_weeks` mais
 * o ritual de `month_contracts`. Leitura sob `reports:delivery:read`.
 */
export const MONTH_ATTENTION_MAX_LIMIT = 100;
export const MONTH_ATTENTION_INPUT_MESSAGE =
  'Use month em AAAA-MM (ex.: 2026-10), clientId, ownerId (uuid), onlyAttention (true ou false), limit (inteiro) e cursor, ou omita.';

export const getMonthAttentionInputSchema = z
  .object({
    /** AAAA-MM; sem ele, o mês atual da agência. */
    month: deliveryMonthSchema.optional(),
    clientId: z.string().min(1).optional(),
    /** Um responsável: o id da pasta (time) ou da pessoa, como em `clients[].owners[].id`. */
    ownerId: z.string().regex(INTEGRATION_UUID).optional(),
    /** `true`: só quem precisa de atenção, do motivo mais pesado ao mais leve. Padrão: todos, quem precisa de atenção primeiro. */
    onlyAttention: z.boolean().optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

/** Os mesmos de `ritualStage` (`src/delivery/month-ritual.ts`); um teste prende as listas iguais. */
export const MONTH_RITUAL_STAGES = ['fechado', 'aberto', 'planejado', 'aprovado'] as const;

/** As mesmas chaves de `PESO_DO_MOTIVO` (`src/painel/planejamento-do-mes.ts`), do mais pesado ao mais leve. */
export const MONTH_ATTENTION_REASON_KEYS = [
  'mes-nao-aberto',
  'semana-sem-peca',
  'atrasadas',
  'semana-em-risco',
  'semana-anterior-abaixo',
  'sem-dia',
] as const;

const monthAttentionReasonSchema = z
  .object({
    key: z.enum(MONTH_ATTENTION_REASON_KEYS),
    /** A frase pronta, a mesma que a faixa da tela mostra. */
    text: z.string().min(1),
    /** Quem aparece primeiro: maior = mais grave. */
    weight: z.number().int().positive(),
  })
  .strict();

/** A semana de hoje de um tipo — a célula da aba Semana, sem recontar. Nulo fora do mês atual. */
const monthAttentionWeekSchema = z
  .object({
    goal: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    scheduled: z.number().int().nonnegative(),
    late: z.number().int().nonnegative(),
    state: z.enum(PLANNING_WEEK_STATES),
  })
  .strict();

const monthAttentionTypeSchema = z
  .object({
    type: contentTypeSchema,
    /** Do contrato congelado, ou do cadastro se o mês não abriu. 0 = o tipo só aparece porque tem peça. */
    contract: z.number().int().nonnegative(),
    /** O contrato se parte em seis e a soma fecha: delivered + scheduled + late + outsideMonth + withoutDay + notCreated. */
    delivered: z.number().int().nonnegative(),
    /** Pendentes com dia dentro do mês, de hoje em diante. */
    scheduled: z.number().int().nonnegative(),
    /** Pendentes cujo dia já passou. */
    late: z.number().int().nonnegative(),
    /** Pendentes com dia fora do mês, ainda não vencido. */
    outsideMonth: z.number().int().nonnegative(),
    /** Existem e não têm dia. */
    withoutDay: z.number().int().nonnegative(),
    /** O contrato pede e nem existe como peça ainda. */
    notCreated: z.number().int().nonnegative(),
    /** withoutDay + notCreated: o trabalho de marcar que sobra. */
    missingToSchedule: z.number().int().nonnegative(),
    /** Extras entregues (não pagam contrato; ficam fora dos seis baldes). */
    extras: z.number().int().nonnegative(),
    /** Extras que ainda não saíram, com dia ou sem. */
    pendingExtras: z.number().int().nonnegative(),
    /** Das pendentes, as que já passaram do dia. */
    lateExtras: z.number().int().nonnegative(),
    week: monthAttentionWeekSchema.nullable(),
  })
  .strict();

const monthRitualSchema = z
  .object({
    monthOpened: z.boolean(),
    planningDoneAt: z.string().datetime().nullable(),
    /** Nulo = não registrado (mês do legado) ou sem people:read. */
    planningDoneBy: namedRefSchema.nullable(),
    clientApprovedAt: z.string().datetime().nullable(),
    clientApprovedBy: namedRefSchema.nullable(),
  })
  .strict();

export const monthAttentionClientSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    company: namedRefSchema,
    owners: z.array(monthOwnerSchema),
    /** O estágio do ritual: fechado (mês não aberto), aberto, planejado ou aprovado. */
    stage: z.enum(MONTH_RITUAL_STAGES),
    /** O rótulo da tela: "mês não aberto", "aberto, falta planejar"… */
    stageLabel: z.string().min(1),
    ritual: monthRitualSchema,
    /** Compra conteúdo neste mês. Falso = "sem contrato": nunca entra na atenção. */
    hasContract: z.boolean(),
    /** De onde veio a cota: contrato (mês aberto), cadastro (mês não aberto) ou nenhuma. */
    quotaSource: z.enum(['contrato', 'cadastro', 'nenhuma']),
    /** O mês pedido em relação a hoje. Só no atual existe "esta semana". */
    when: z.enum(['passado', 'atual', 'futuro']),
    /** A semana (da aba Semana) que contém hoje; nulo fora do mês atual. */
    currentWeek: z
      .object({
        number: z.number().int().positive(),
        from: z.string().regex(CIVIL_DAY),
        to: z.string().regex(CIVIL_DAY),
      })
      .strict()
      .nullable(),
    needsAttention: z.boolean(),
    /** O peso do motivo mais grave; 0 sem motivo. */
    weight: z.number().int().nonnegative(),
    /** Do mais pesado ao mais leve. Vazio para quem não tem contrato. */
    reasons: z.array(monthAttentionReasonSchema),
    types: z.array(monthAttentionTypeSchema),
  })
  .strict();

const monthAttentionGroupSchema = z
  .object({
    /** Nulo = "Sem responsável". */
    owner: monthOwnerSchema.nullable(),
    clientIds: z.array(z.string().min(1)),
    /** Quantos desta página precisam de atenção. */
    needingAttention: z.number().int().nonnegative(),
    /** Quantos com semana corrente em risco. */
    atRisk: z.number().int().nonnegative(),
  })
  .strict();

export const getMonthAttentionResponseSchema = z
  .object({
    operation: z.literal('get_month_attention'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    coverage: deliveryCoverageSchema,
    ...continuationSchema,
    /** AAAA-MM pedido (ou o mês atual da agência). */
    month: deliveryMonthSchema,
    /** O dia de hoje na agência. */
    today: z.string().regex(CIVIL_DAY),
    timezone: z.literal(AGENCY_TIMEZONE),
    /** Os totais do filtro INTEIRO (month, clientId, ownerId), não só desta página. */
    summary: z
      .object({
        clients: z.number().int().nonnegative(),
        withContract: z.number().int().nonnegative(),
        needingAttention: z.number().int().nonnegative(),
        byStage: z
          .object({
            fechado: z.number().int().nonnegative(),
            aberto: z.number().int().nonnegative(),
            planejado: z.number().int().nonnegative(),
            aprovado: z.number().int().nonnegative(),
          })
          .strict(),
        /** Quantos clientes têm cada motivo, do mais pesado ao mais leve. */
        byReason: z
          .array(
            z
              .object({
                key: z.enum(MONTH_ATTENTION_REASON_KEYS),
                clients: z.number().int().nonnegative(),
              })
              .strict(),
          ),
      })
      .strict(),
    /** Quem precisa de atenção primeiro (motivo mais pesado, depois o nome); com onlyAttention, só eles. */
    clients: z.array(monthAttentionClientSchema),
    /** Os clientes DESTA página por responsável; quem tem dois responsáveis aparece nos dois. */
    groups: z.array(monthAttentionGroupSchema),
  })
  .strict();

export type GetMonthAttentionInput = z.infer<typeof getMonthAttentionInputSchema>;
export type GetMonthAttentionResponse = z.infer<typeof getMonthAttentionResponseSchema>;

/**
 * `get_client_month` — o mês de UM cliente, com cada peça pelo nome: o contrato
 * congelado, o ritual, o medidor (a MESMA `calculateDeliveryLevel` da ficha do
 * cliente) e as peças (id, nome, tipo, dia, ✓, extra). `get_month_attention`
 * diz QUANTAS faltam; esta diz QUAIS. Leitura sob `reports:delivery:read`.
 */
export const CLIENT_MONTH_INPUT_MESSAGE =
  'Informe clientId (de search/get_client) e, se quiser, month em AAAA-MM (ex.: 2026-10).';

export const getClientMonthInputSchema = z
  .object({
    clientId: z.string().min(1),
    /** AAAA-MM; sem ele, o mês atual da agência. */
    month: deliveryMonthSchema.optional(),
  })
  .strict();

const clientMonthPieceSchema = z
  .object({
    id: z.string().min(1),
    /** O nome que a tela dá à peça ("Vídeo “Reels”, dia 12/10"), com "(n de m)" onde se repete. */
    name: z.string().min(1),
    title: z.string().nullable(),
    type: contentTypeSchema,
    /** O dia marcado (AAAA-MM-DD), como a Semanal o conta. Nulo = peça sem dia. */
    day: z.string().regex(CIVIL_DAY).nullable(),
    /** Tem ✓. */
    done: z.boolean(),
    completedAt: z.string().datetime().nullable(),
    /** Extra não paga contrato. */
    extra: z.boolean(),
    /** feita (✓), agendada (● no prazo) ou atrasada (✕: o dia passou sem ✓); nulo = sem dia. */
    signal: z.enum(['feita', 'agendada', 'atrasada']).nullable(),
    /** A semana (da aba Semana) em que cai; nulo = sem dia ou dia fora do mês. */
    week: z.number().int().positive().nullable(),
  })
  .strict();

export const getClientMonthResponseSchema = z
  .object({
    operation: z.literal('get_client_month'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    coverage: deliveryCoverageSchema,
    ...continuationSchema,
    month: deliveryMonthSchema,
    today: z.string().regex(CIVIL_DAY),
    timezone: z.literal(AGENCY_TIMEZONE),
    /** O cliente no mês: ritual, motivos de atenção e o contrato por tipo nos seis baldes (o de get_month_attention). */
    client: monthAttentionClientSchema,
    /** O contrato do mês: o congelado (mês aberto, mesmo vazio) ou, se não abriu, a cota do cadastro de hoje. */
    contract: z
      .object({
        monthOpened: z.boolean(),
        source: z.enum(['contrato', 'cadastro', 'nenhuma']),
        items: z.array(z.object({ type: contentTypeSchema, quantity: z.number().int().positive() }).strict()),
      })
      .strict(),
    /** O medidor do mês, a fórmula da ficha do cliente: nível, base, bônus e o detalhe por tipo; ou o motivo de não medir. */
    meter: deliveryResultSchema,
    /** Todas as peças do mês de competência, por dia (sem dia por último). */
    pieces: z.array(clientMonthPieceSchema),
  })
  .strict();

export type GetClientMonthInput = z.infer<typeof getClientMonthInputSchema>;
export type GetClientMonthResponse = z.infer<typeof getClientMonthResponseSchema>;

/**
 * `get_calendar` — o Calendário editorial: as peças com dia e os compromissos
 * (reunião, gravação, viagem) de um período, de todos os clientes do recorte ou
 * de um. Período fechado nas duas pontas, de até `CALENDAR_MAX_DAYS` dias.
 * Compromisso sai sem as observações (texto livre). Leitura sob
 * `reports:delivery:read`.
 */
export const CALENDAR_MAX_DAYS = 62;
export const CALENDAR_INPUT_MESSAGE = `Informe from e to em AAAA-MM-DD (até ${CALENDAR_MAX_DAYS} dias) e, se quiser, clientId, limit (inteiro) e cursor.`;

export const getCalendarInputSchema = z
  .object({
    from: z.string().regex(CIVIL_DAY, 'Use AAAA-MM-DD.'),
    to: z.string().regex(CIVIL_DAY, 'Use AAAA-MM-DD.'),
    clientId: z.string().min(1).optional(),
    limit: z.number().int().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

const calendarEntrySchema = z
  .object({
    kind: z.enum(['delivery', 'appointment']),
    id: z.string().min(1),
    /** O dia em São Paulo (AAAA-MM-DD). */
    day: z.string().regex(CIVIL_DAY),
    /** HH:MM. Só o compromisso tem; a hora de uma peça nunca foi escolhida por ninguém. */
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    client: namedRefSchema,
    /** Só a peça (delivery). */
    type: contentTypeSchema.nullable(),
    title: z.string().nullable(),
    /** Só a peça: tem ✓. */
    done: z.boolean().nullable(),
    /** Só a peça: extra. */
    extra: z.boolean().nullable(),
  })
  .strict();

export const getCalendarResponseSchema = z
  .object({
    operation: z.literal('get_calendar'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    coverage: deliveryCoverageSchema,
    ...continuationSchema,
    period: z
      .object({
        from: z.string().regex(CIVIL_DAY),
        to: z.string().regex(CIVIL_DAY),
        days: z.number().int().positive(),
      })
      .strict(),
    timezone: z.literal(AGENCY_TIMEZONE),
    /** Os totais do período INTEIRO (e do filtro clientId), não só desta página. */
    summary: z
      .object({
        deliveries: z.number().int().nonnegative(),
        deliveriesDone: z.number().int().nonnegative(),
        appointments: z.number().int().nonnegative(),
      })
      .strict(),
    /** Por dia; dentro do dia, quem tem hora vem antes, depois o nome do cliente. */
    entries: z.array(calendarEntrySchema),
  })
  .strict();

export type GetCalendarInput = z.infer<typeof getCalendarInputSchema>;
export type GetCalendarResponse = z.infer<typeof getCalendarResponseSchema>;

/**
 * F40, Fase 9 — `get_admin_week`: o painel "Controle da semana" dos admins, os
 * três blocos que a tela mostra (para atribuir, andamento, faltando). A regra
 * é `readControleDaSemana` (`src/server/controle-da-semana.ts`), a MESMA função
 * da rota `GET /admin/semana`: nada é recalculado aqui. Só para administrador.
 */
export const ADMIN_WEEK_INPUT_MESSAGE =
  'Use week em AAAA-MM-DD (qualquer dia da semana; vira a segunda-feira dela), ou omita para a semana atual.';

export const getAdminWeekInputSchema = z
  .object({
    week: civilDaySchema.optional(),
  })
  .strict();

const adminWeekPersonSchema = z.object({ id: z.string().min(1), name: z.string() }).strict();
/** `null` = "Sem tipo". */
const adminWeekGroupTypeSchema = z.enum(TASK_DEMAND_TYPES).nullable();
const adminWeekListSchema = z.object({ id: z.string(), name: z.string() }).strict();
/**
 * O nome do cliente — nulo sem `clients:read` (o id fica: é ele que agrupa).
 * Auditoria de 08/10/2026: o painel devolvia o nome sem a leitura concedida.
 */
const adminWeekClientNameSchema = z.string().nullable();

const adminWeekToAssignSchema = z
  .object({
    clientId: z.string().min(1),
    clientName: adminWeekClientNameSchema,
    type: adminWeekGroupTypeSchema,
    cards: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string(),
          /** Quem lançou o card. */
          createdBy: adminWeekPersonSchema.nullable(),
          /** O prazo que o captador sugeriu; nulo = "Sem data". */
          suggestedDueOn: z.string().regex(CIVIL_DAY).nullable(),
          list: adminWeekListSchema,
        })
        .strict(),
    ),
  })
  .strict();

const adminWeekProgressSchema = z
  .object({
    clientId: z.string().min(1),
    clientName: adminWeekClientNameSchema,
    type: adminWeekGroupTypeSchema,
    /** Na etapa "atribuir demanda". */
    awaiting: z.number().int().nonnegative(),
    todo: z.number().int().nonnegative(),
    doing: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
  })
  .strict();

const adminWeekMissingSchema = z
  .object({
    clientId: z.string().min(1),
    clientName: adminWeekClientNameSchema,
    type: z.enum(['video', 'arte', 'foto']),
    target: z.number().int().nonnegative(),
    cards: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
  })
  .strict();

const adminWeekOverdueSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    dueOn: z.string().regex(CIVIL_DAY),
    clientId: z.string().min(1),
    clientName: adminWeekClientNameSchema,
    type: adminWeekGroupTypeSchema,
    list: adminWeekListSchema,
    statusName: z.string().nullable(),
    assignees: z.array(adminWeekPersonSchema),
  })
  .strict();

export const getAdminWeekResponseSchema = z
  .object({
    operation: z.literal('get_admin_week'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    week: z
      .object({
        /** A segunda-feira. */
        start: z.string().regex(CIVIL_DAY),
        /** O domingo. */
        end: z.string().regex(CIVIL_DAY),
        today: z.string().regex(CIVIL_DAY),
        isCurrent: z.boolean(),
        previous: z.string().regex(CIVIL_DAY),
        next: z.string().regex(CIVIL_DAY),
      })
      .strict(),
    /** Cards em "atribuir demanda" com prazo na semana (e "sem data", só na semana atual), por cliente e tipo. */
    toAssign: z.array(adminWeekToAssignSchema),
    /** Por cliente e tipo, quantos cards da semana estão em cada fase. */
    progress: z.array(adminWeekProgressSchema),
    missing: z
      .object({
        /** Meta da semana contra cards na semana, por cliente e tipo. */
        items: z.array(adminWeekMissingSchema),
        /** Atrasados (até 200); `overdueTotal` é o total. */
        overdue: z.array(adminWeekOverdueSchema),
        overdueTotal: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type GetAdminWeekInput = z.infer<typeof getAdminWeekInputSchema>;
export type GetAdminWeekResponse = z.infer<typeof getAdminWeekResponseSchema>;

const metricStatusSchema = z.enum(['present', 'absent']);

/** Valor ausente = null + absent. Zero real = 0 + present. */
export const metricCountSchema = z
  .object({
    value: z.number().nullable(),
    status: metricStatusSchema,
  })
  .strict();

/**
 * Pessoas distintas: média e pico. Sem total. `distinctPeople: false` impede
 * ler o número como pessoas únicas do período.
 */
export const distinctPeopleMetricSchema = z
  .object({
    kind: z.literal('approximate'),
    distinctPeople: z.literal(false),
    average: z.number().nullable(),
    peak: z.number().nullable(),
    peakOn: z.string().nullable(),
    days: z.number().int().nonnegative(),
    status: metricStatusSchema,
    note: z.string().min(1),
  })
  .strict();

export const seriesPointSchema = z
  .object({
    day: z.string().min(1),
    value: z.number().nullable(),
    status: metricStatusSchema,
  })
  .strict();

export const countableSeriesSchema = z
  .object({
    metric: z.string().min(1),
    points: z.array(seriesPointSchema),
  })
  .strict();

export const distinctSeriesSchema = z
  .object({
    metric: z.enum(['reach', 'accountsEngaged']),
    kind: z.literal('approximate'),
    distinctPeople: z.literal(false),
    note: z.string().min(1),
    points: z.array(seriesPointSchema),
  })
  .strict();

export const getMarketingReportInputSchema = z
  .object({
    from: z.string().regex(CIVIL_DAY).optional(),
    to: z.string().regex(CIVIL_DAY).optional(),
  })
  .strict();

const paidKpisSchema = z
  .object({
    spend: metricCountSchema,
    impressions: metricCountSchema,
    clicks: metricCountSchema,
    linkClicks: metricCountSchema,
    conversions: metricCountSchema,
    conversionValue: metricCountSchema,
    reach: distinctPeopleMetricSchema,
    ctr: metricCountSchema,
    cpc: metricCountSchema,
    cpm: metricCountSchema,
    cpa: metricCountSchema,
    roas: metricCountSchema,
    days: z.number().int().nonnegative(),
  })
  .strict();

const organicKpisSchema = z
  .object({
    views: metricCountSchema,
    totalInteractions: metricCountSchema,
    follows: metricCountSchema,
    unfollows: metricCountSchema,
    profileLinksTaps: metricCountSchema,
    followerBalance: metricCountSchema,
    reach: distinctPeopleMetricSchema,
    accountsEngaged: distinctPeopleMetricSchema,
    engagementRate: metricCountSchema,
    followers: metricCountSchema,
    publications: metricCountSchema,
    days: z.number().int().nonnegative(),
  })
  .strict();

const marketingCampaignSchema = z
  .object({
    campaignId: z.string().min(1),
    campaignName: z.string().min(1).nullable(),
    kpis: paidKpisSchema,
  })
  .strict();

const marketingClientRefSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict()
  .nullable();

export const marketingPaidAccountSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal('ad_account'),
    displayName: z.string().min(1).nullable(),
    externalId: z.string().min(1),
    client: marketingClientRefSchema,
    company: namedRefSchema.nullable(),
    currency: z.string().min(1).nullable(),
    currencyKnown: z.boolean(),
    collectedAt: z.string().datetime().nullable(),
    kpis: paidKpisSchema,
    campaigns: z.array(marketingCampaignSchema),
    series: z
      .object({
        spend: countableSeriesSchema,
        impressions: countableSeriesSchema,
        reach: distinctSeriesSchema,
      })
      .strict(),
  })
  .strict();

export const marketingOrganicAccountSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal('instagram_account'),
    displayName: z.string().min(1).nullable(),
    externalId: z.string().min(1),
    client: marketingClientRefSchema,
    company: namedRefSchema.nullable(),
    collectedAt: z.string().datetime().nullable(),
    kpis: organicKpisSchema,
    series: z
      .object({
        views: countableSeriesSchema,
        reach: distinctSeriesSchema,
        accountsEngaged: distinctSeriesSchema,
      })
      .strict(),
  })
  .strict();

export const spendCurrencyBucketSchema = z
  .object({
    currency: z.string().min(1).nullable(),
    currencyKnown: z.boolean(),
    spend: metricCountSchema,
    conversionValue: metricCountSchema,
    cpc: metricCountSchema,
    cpm: metricCountSchema,
    cpa: metricCountSchema,
    roas: metricCountSchema,
  })
  .strict();

export const marketingCoverageSchema = z
  .object({
    kind: z.enum(['full', 'partial']),
    reason: z.string().min(1).optional(),
    collectedAt: z.string().datetime().nullable(),
    collection: z
      .object({
        status: z.enum(['none', 'current', 'stale']),
        lastRunAt: z.string().datetime().nullable(),
        lastRunOutcome: z.enum(['running', 'ok', 'partial', 'failed']).nullable(),
        triggeredNow: z.literal(false),
        message: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const getMarketingReportResponseSchema = z
  .object({
    operation: z.literal('get_marketing_report'),
    queriedAt: z.string().datetime(),
    self: z.string().min(1),
    effectiveScope: effectiveScopeSchema,
    period: z
      .object({
        requested: z
          .object({
            from: z.string().min(1).nullable(),
            to: z.string().min(1).nullable(),
          })
          .strict(),
        effective: periodBoundSchema,
        truncated: z.boolean(),
        timezone: z.literal(AGENCY_TIMEZONE),
        maxDays: z.number().int().positive(),
      })
      .strict(),
    coverage: marketingCoverageSchema,
    paid: z
      .object({
        accounts: z.array(marketingPaidAccountSchema),
        totals: z
          .object({
            impressions: metricCountSchema,
            clicks: metricCountSchema,
            linkClicks: metricCountSchema,
            conversions: metricCountSchema,
            reach: distinctPeopleMetricSchema,
            ctr: metricCountSchema,
            days: z.number().int().nonnegative(),
          })
          .strict(),
        spendByCurrency: z.array(spendCurrencyBucketSchema),
      })
      .strict(),
    organic: z
      .object({
        accounts: z.array(marketingOrganicAccountSchema),
        totals: organicKpisSchema,
      })
      .strict(),
  })
  .strict();

export type GetMarketingReportInput = z.infer<typeof getMarketingReportInputSchema>;
export type GetMarketingReportResponse = z.infer<typeof getMarketingReportResponseSchema>;

export function jsonBody(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

export function integrationError(
  code: IntegrationErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return jsonBody({ error: code, message, ...extra }, ERROR_STATUS[code]);
}

type JsonSchema = Record<string, unknown>;

function unwrap(schema: ZodTypeAny): { inner: ZodTypeAny; optional: boolean; nullable: boolean } {
  let inner = schema;
  let optional = false;
  let nullable = false;
  for (;;) {
    if (inner instanceof z.ZodOptional) {
      optional = true;
      inner = inner.unwrap();
      continue;
    }
    if (inner instanceof z.ZodNullable) {
      nullable = true;
      inner = inner.unwrap();
      continue;
    }
    if (inner instanceof z.ZodEffects) {
      inner = inner._def.schema as ZodTypeAny;
      continue;
    }
    if (inner instanceof z.ZodDefault) {
      inner = inner._def.innerType as ZodTypeAny;
      continue;
    }
    break;
  }
  return { inner, optional, nullable };
}

function applyNull(schema: JsonSchema, nullable: boolean): JsonSchema {
  if (!nullable) return schema;
  const current = schema.type;
  if (typeof current === 'string') return { ...schema, type: [current, 'null'] };
  return { anyOf: [schema, { type: 'null' }] };
}

export function jsonSchemaFromZod(schema: ZodTypeAny): JsonSchema {
  const { inner, nullable } = unwrap(schema);

  if (inner instanceof z.ZodLiteral) {
    return applyNull({ type: typeof inner._def.value, const: inner._def.value }, nullable);
  }
  if (inner instanceof z.ZodEnum) {
    return applyNull({ type: 'string', enum: [...inner._def.values] }, nullable);
  }
  if (inner instanceof z.ZodString) {
    const checks = inner._def.checks ?? [];
    const json: JsonSchema = { type: 'string' };
    for (const check of checks) {
      if (check.kind === 'min') json.minLength = check.value;
      if (check.kind === 'max') json.maxLength = check.value;
      if (check.kind === 'datetime') json.format = 'date-time';
      if (check.kind === 'regex') json.pattern = check.regex.source;
    }
    return applyNull(json, nullable);
  }
  if (inner instanceof z.ZodNumber) {
    const json: JsonSchema = { type: 'number' };
    for (const check of inner._def.checks ?? []) {
      if (check.kind === 'int') json.type = 'integer';
      if (check.kind === 'min') {
        json.minimum = check.value;
        if (check.inclusive === false) json.exclusiveMinimum = check.value;
      }
      if (check.kind === 'max') json.maximum = check.value;
    }
    return applyNull(json, nullable);
  }
  if (inner instanceof z.ZodBoolean) return applyNull({ type: 'boolean' }, nullable);
  if (inner instanceof z.ZodArray) {
    return applyNull({ type: 'array', items: jsonSchemaFromZod(inner._def.type) }, nullable);
  }
  if (inner instanceof z.ZodUnion || inner instanceof z.ZodDiscriminatedUnion) {
    const options = inner.options as ZodTypeAny[];
    return applyNull({ anyOf: options.map((option) => jsonSchemaFromZod(option)) }, nullable);
  }
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const field = unwrap(value);
      properties[key] = jsonSchemaFromZod(value);
      if (!field.optional) required.push(key);
    }
    const json: JsonSchema = { type: 'object', properties };
    if (required.length > 0) json.required = required;
    if (inner._def.unknownKeys === 'strict') json.additionalProperties = false;
    return applyNull(json, nullable);
  }

  throw new Error(`Schema Zod sem conversão OpenAPI: ${inner._def.typeName}`);
}

const SCOPE_EXAMPLE = {
  companies: [{ id: 'empresa-a', name: 'Agência Ide' }],
  capabilities: ['boards:read', 'tasks:read', 'clients:read'] as const,
  policyVersion: 1,
  companyScope: 'ids' as const,
};

const GET_CONTEXT_EXAMPLE: GetContextResponse = {
  operation: 'get_context',
  queriedAt: '2026-09-21T04:00:00.000Z',
  self: GET_CONTEXT_PATH,
  origin: 'http',
  owner: { id: '11111111-1111-1111-1111-111111111111', displayName: 'Wesley Lourenço' },
  integration: { id: 'grant-exemplo', name: 'Claude da agência' },
  effectiveScope: {
    companies: [{ id: 'empresa-a', name: 'Agência Ide' }],
    capabilities: ['boards:read'],
    policyVersion: 1,
    companyScope: 'ids',
  },
};

const SEARCH_EXAMPLE: SearchResponse = {
  operation: 'search',
  queriedAt: '2026-09-21T04:00:00.000Z',
  self: SEARCH_PATH,
  effectiveScope: { ...SCOPE_EXAMPLE, capabilities: [...SCOPE_EXAMPLE.capabilities] },
  hasMore: false,
  nextCursor: null,
  items: [
    {
      kind: 'person',
      id: 'pessoa-wesley-entrega',
      title: 'Wesley Lourenço',
      detail: 'entrega',
      board: null,
      client: null,
      company: { id: 'empresa-a', name: 'Agência Ide' },
    },
    {
      kind: 'board',
      id: 'lista-atendimento-jatoba',
      title: 'Atendimento',
      detail: null,
      board: { id: 'lista-atendimento-jatoba', name: 'Atendimento' },
      client: { id: 'cliente-jatoba', name: 'Jatobá' },
      company: { id: 'empresa-a', name: 'Agência Ide' },
    },
    {
      kind: 'client',
      id: 'cliente-zeca',
      title: 'Zeca Hamburgueria',
      detail: 'cancelado em 30/12/2025',
      board: null,
      client: null,
      company: null,
      cancelled: true,
      cancelledOn: '2025-12-30',
    },
  ],
};

const GET_WORKFLOW_EXAMPLE: GetWorkflowResponse = {
  operation: 'get_workflow',
  queriedAt: '2026-10-05T12:00:00.000Z',
  self: `${GET_WORKFLOW_PATH}?listId=11111111-2222-3333-4444-555555555555`,
  effectiveScope: { ...SCOPE_EXAMPLE, capabilities: ['boards:read'] },
  workflow: {
    target: { kind: 'list', id: '11111111-2222-3333-4444-555555555555', name: 'Atendimento Jatobá' },
    company: { id: 'empresa-a', name: 'Agência Ide' },
    name: 'Esteira do atendimento',
    isProduction: false,
    inheritedFrom: 'folder',
    owner: { kind: 'folder', id: '66666666-7777-8888-9999-000000000000', name: 'Jatobá' },
    stages: [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'A fazer', sortOrder: 0, type: 'open' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Em produção', sortOrder: 1, type: 'custom' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Aprovado', sortOrder: 2, type: 'done' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000004', name: 'Fechado', sortOrder: 3, type: 'closed' },
    ],
  },
};

const GET_TASK_EXAMPLE: GetTaskResponse = {
  operation: 'get_task',
  queriedAt: '2026-09-21T04:00:00.000Z',
  self: `${GET_TASK_PATH}?id=tarefa-peca`,
  effectiveScope: { ...SCOPE_EXAMPLE, capabilities: [...SCOPE_EXAMPLE.capabilities] },
  hasMore: false,
  nextCursor: null,
  task: {
    id: 'tarefa-peca',
    title: 'Peça da campanha',
    description: 'Briefing da peça.',
    dueOn: '2026-09-30',
    statusId: 'status-aberto',
    statusType: 'open',
    priority: 'high',
    startOn: '2026-09-24',
    completedAt: null,
    archivedAt: null,
    type: 'video',
    board: { id: 'lista-atendimento-jatoba', name: 'Atendimento' },
    client: { id: 'cliente-jatoba', name: 'Jatobá' },
    people: [{ id: 'pessoa-helena', name: 'Helena' }],
    comments: null,
    tags: [{ id: 'etiqueta-reels', name: 'Reels', bgColor: '#7c3aed', fgColor: '#ffffff' }],
    watchers: [{ id: 'pessoa-wesley-entrega', name: 'Wesley Lourenço' }],
    parentId: null,
    parentTitle: null,
    checklists: [
      {
        id: 'checklist-entrega',
        name: 'Antes de enviar',
        items: [
          {
            id: 'item-legenda',
            name: 'Revisar a legenda',
            parentItemId: null,
            resolved: true,
            resolvedAt: '2026-09-20T15:00:00.000Z',
            assignee: { id: 'pessoa-helena', name: 'Helena' },
          },
          { id: 'item-musica', name: 'Conferir a música', parentItemId: null, resolved: false, resolvedAt: null, assignee: null },
        ],
      },
    ],
    checklistItemTotal: 2,
    links: [{ id: 'link-dropbox', label: 'Pasta da peça no Dropbox', url: 'https://www.dropbox.com/scl/fo/exemplo' }],
    linkTotal: 1,
    history: [
      {
        id: 'evento-1',
        at: '2026-09-21T10:00:00.000Z',
        by: 'Helena',
        automation: false,
        via: null,
        changes: ['alterou o status de Em produção para Aprovação'],
      },
    ],
    historyTotal: 1,
    createdBy: { id: 'pessoa-helena', name: 'Helena' },
    completedBy: null,
    createdVia: null,
    createdAt: '2026-09-18T13:00:00.000Z',
    folder: { id: 'pasta-time-helena', name: 'TIME HELENA' },
    space: { id: 'espaco-clientes', name: 'CLIENTES' },
  },
};

const LIST_PEOPLE_EXAMPLE: ListPeopleResponse = {
  operation: 'list_people',
  queriedAt: '2026-09-21T04:00:00.000Z',
  self: LIST_PEOPLE_PATH,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['people:read', 'tasks:read', 'clients:read'],
  },
  hasMore: false,
  nextCursor: null,
  items: [
    {
      id: 'pessoa-helena',
      displayName: 'Helena',
      team: { id: 'empresa-a', name: 'Agência Ide' },
    },
    {
      id: 'pessoa-wesley-entrega',
      displayName: 'Wesley Lourenço',
      team: { id: 'empresa-a', name: 'Agência Ide' },
    },
  ],
};

const GET_PERSON_WORK_EXAMPLE: GetPersonWorkResponse = {
  operation: 'get_person_work',
  queriedAt: '2026-09-21T04:00:00.000Z',
  self: `${GET_PERSON_WORK_PATH}?id=pessoa-helena`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['people:read', 'tasks:read', 'clients:read'],
  },
  hasMore: false,
  nextCursor: null,
  person: {
    id: 'pessoa-helena',
    displayName: 'Helena',
    team: { id: 'empresa-a', name: 'Agência Ide' },
  },
  counts: { tasks: 1, open: 1, done: 0 },
  returned: 1,
  items: [
    {
      id: 'tarefa-peca',
      title: 'Peça da campanha',
      statusId: 'status-aberto',
      statusName: 'Aberto',
      statusType: 'open',
      priority: 'urgent',
      type: 'arte',
      dueOn: '2026-09-30',
      board: { id: 'lista-atendimento-jatoba', name: 'Atendimento' },
      client: { id: 'cliente-jatoba', name: 'Jatobá' },
    },
  ],
};

const GET_DELIVERY_REPORT_EXAMPLE: GetDeliveryReportResponse = {
  operation: 'get_delivery_report',
  queriedAt: '2026-09-21T04:00:00.000Z',
  self: `${GET_DELIVERY_REPORT_PATH}?from=2026-09-01&to=2026-09-30`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:delivery:read'],
  },
  period: {
    requested: { from: '2026-09-01', to: '2026-09-30' },
    effective: { from: '2026-09-01', to: '2026-09-30' },
    timezone: AGENCY_TIMEZONE,
  },
  coverage: {
    kind: 'partial',
    reason: 'A concessão recorta empresas ou clientes; o agregado não é a carteira global.',
  },
  summary: {
    clients: 2,
    measurable: 1,
    unmeasurable: 1,
    averageLevel: 50,
    inPeriod: { scheduled: 2, completed: 1 },
    byType: {
      video: { contracted: 1, delivered: 0, extras: 0 },
      arte: { contracted: 3, delivered: 3, extras: 0 },
      foto: { contracted: 0, delivered: 0, extras: 0 },
      ads: { contracted: 0, delivered: 0, extras: 0 },
    },
  },
  clients: [
    {
      id: 'cliente-jatoba',
      name: 'Jatobá',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      inPeriod: { scheduled: 2, completed: 1 },
      delivery: {
        measurable: true,
        level: 50,
        base: 50,
        bonus: 0,
        contractedPoints: 6,
        deliveredPoints: 3,
        extraPoints: 0,
        breakdown: [
          {
            contentType: 'video',
            weight: 3,
            contracted: 1,
            delivered: 0,
            extras: 0,
            contractedPoints: 3,
            deliveredPoints: 0,
            extraPoints: 0,
          },
          {
            contentType: 'arte',
            weight: 1,
            contracted: 3,
            delivered: 3,
            extras: 0,
            contractedPoints: 3,
            deliveredPoints: 3,
            extraPoints: 0,
          },
        ],
        deliveredOutsideContract: 0,
        formulaVersion: FORMULA_VERSION,
      },
    },
    {
      id: 'cliente-hub',
      name: 'Cliente HUB',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      inPeriod: { scheduled: 0, completed: 0 },
      delivery: {
        measurable: false,
        reason: 'no_content_contract',
        message: 'Este cliente não tem contrato de conteúdo mensal.',
        formulaVersion: FORMULA_VERSION,
      },
    },
  ],
};

const GET_CLIENT_DELIVERY_HISTORY_EXAMPLE: GetClientDeliveryHistoryResponse = {
  operation: 'get_client_delivery_history',
  queriedAt: '2026-09-22T12:00:00.000Z',
  self: `${GET_CLIENT_DELIVERY_HISTORY_PATH}?clientId=cliente-jatoba&from=2026-07&to=2026-09`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:delivery:read'],
  },
  period: {
    requested: { from: '2026-07', to: '2026-09' },
    effective: { from: '2026-07', to: '2026-09' },
    currentMonth: '2026-09',
    timezone: AGENCY_TIMEZONE,
  },
  coverage: {
    kind: 'partial',
    reason: 'A concessão recorta empresas ou clientes; o agregado não é a carteira global.',
  },
  client: {
    id: 'cliente-jatoba',
    name: 'Jatobá',
    company: { id: 'empresa-a', name: 'Agência Ide' },
  },
  months: [
    {
      month: '2026-07',
      inPeriod: { scheduled: 0, completed: 0 },
      delivery: {
        measurable: false,
        reason: 'no_contract',
        message: 'Este mês ainda não foi aberto para este cliente.',
        formulaVersion: FORMULA_VERSION,
      },
    },
    {
      month: '2026-08',
      inPeriod: { scheduled: 4, completed: 4 },
      delivery: {
        measurable: true,
        level: 100,
        base: 100,
        bonus: 0,
        contractedPoints: 4,
        deliveredPoints: 4,
        extraPoints: 0,
        breakdown: [
          {
            contentType: 'arte',
            weight: 1,
            contracted: 4,
            delivered: 4,
            extras: 0,
            contractedPoints: 4,
            deliveredPoints: 4,
            extraPoints: 0,
          },
        ],
        deliveredOutsideContract: 0,
        formulaVersion: FORMULA_VERSION,
      },
    },
    {
      month: '2026-09',
      inPeriod: { scheduled: 2, completed: 1 },
      delivery: GET_DELIVERY_REPORT_EXAMPLE.clients[0].delivery,
    },
  ],
};

const GET_DELIVERY_TREND_EXAMPLE: GetDeliveryTrendResponse = {
  operation: 'get_delivery_trend',
  queriedAt: '2026-09-22T12:00:00.000Z',
  self: `${GET_DELIVERY_TREND_PATH}?from=2026-07&to=2026-09`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:delivery:read'],
  },
  period: {
    requested: { from: '2026-07', to: '2026-09' },
    effective: { from: '2026-07', to: '2026-09' },
    currentMonth: '2026-09',
    timezone: AGENCY_TIMEZONE,
  },
  coverage: {
    kind: 'partial',
    reason: 'A concessão recorta empresas ou clientes; o agregado não é a carteira global.',
  },
  months: ['2026-07', '2026-08', '2026-09'],
  summary: [
    { month: '2026-07', clients: 3, measurable: 1, unmeasurable: 2, averageLevel: 75 },
    { month: '2026-08', clients: 2, measurable: 1, unmeasurable: 1, averageLevel: 100 },
    { month: '2026-09', clients: 2, measurable: 1, unmeasurable: 1, averageLevel: 50 },
  ],
  clients: [
    {
      id: 'cliente-hub',
      name: 'Cliente HUB',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      levels: ['no_contract', 'no_content_contract', 'no_content_contract'],
      change: null,
    },
    {
      id: 'cliente-jatoba',
      name: 'Jatobá',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      levels: ['no_contract', 100, 50],
      change: -50,
    },
    {
      id: 'cliente-zeca',
      name: 'Zeca',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      levels: [75, 'cancelled', 'cancelled'],
      change: null,
    },
  ],
};

const GET_PLANNING_WEEKS_EXAMPLE: GetPlanningWeeksResponse = {
  operation: 'get_planning_weeks',
  queriedAt: '2026-10-05T12:00:00.000Z',
  self: `${GET_PLANNING_WEEKS_PATH}?month=2026-10`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:delivery:read'],
  },
  coverage: { kind: 'full' },
  hasMore: false,
  nextCursor: null,
  month: '2026-10',
  today: '2026-10-05',
  timezone: AGENCY_TIMEZONE,
  weeks: [
    { number: 1, from: '2026-10-01', to: '2026-10-04', days: 4 },
    { number: 2, from: '2026-10-05', to: '2026-10-11', days: 7 },
    { number: 3, from: '2026-10-12', to: '2026-10-18', days: 7 },
    { number: 4, from: '2026-10-19', to: '2026-10-25', days: 7 },
    { number: 5, from: '2026-10-26', to: '2026-10-31', days: 6 },
  ],
  omittedWithoutQuota: 0,
  clients: [
    {
      id: 'cliente-jatoba',
      name: 'Jatobá',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      quotaSource: 'contrato',
      noQuota: false,
      atRisk: true,
      below: false,
      owners: [{ id: '22222222-2222-4222-8222-222222222222', name: 'TIME HELENA', kind: 'folder' }],
      types: [
        {
          type: 'video',
          quota: 8,
          done: 1,
          missing: 7,
          withoutDay: 0,
          outsideMonth: 0,
          weeks: [
            { number: 1, goal: 0, done: 1, scheduled: 0, late: 0, missing: 0, state: 'bateu' },
            { number: 2, goal: 2, done: 0, scheduled: 1, late: 0, missing: 2, state: 'risco' },
            { number: 3, goal: 2, done: 0, scheduled: 0, late: 0, missing: 2, state: 'futura' },
            { number: 4, goal: 2, done: 0, scheduled: 0, late: 0, missing: 2, state: 'futura' },
            { number: 5, goal: 2, done: 0, scheduled: 0, late: 0, missing: 2, state: 'futura' },
          ],
        },
      ],
    },
  ],
  groups: [
    {
      owner: { id: '22222222-2222-4222-8222-222222222222', name: 'TIME HELENA', kind: 'folder' },
      clientIds: ['cliente-jatoba'],
      atRisk: 1,
    },
  ],
};

const GET_DELIVERY_STATUS_EXAMPLE: GetDeliveryStatusResponse = {
  operation: 'get_delivery_status',
  queriedAt: '2026-10-06T12:00:00.000Z',
  self: GET_DELIVERY_STATUS_PATH,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:delivery:read'],
  },
  coverage: { kind: 'full' },
  hasMore: false,
  nextCursor: null,
  source: 'semanal',
  today: '2026-10-06',
  timezone: AGENCY_TIMEZONE,
  activeClients: 2,
  clients: [
    {
      id: 'cliente-hiper-center',
      name: 'Hiper Center',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      lastDeliveryOn: '2026-10-05',
      daysSinceLastDelivery: 1,
      overdueCount: 1,
      overdueDays: ['2026-09-21'],
      dueToday: 0,
      unscheduled: 0,
      nextScheduledOn: '2026-10-07',
    },
    {
      id: 'cliente-jatoba',
      name: 'Jatobá',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      lastDeliveryOn: null,
      daysSinceLastDelivery: null,
      overdueCount: 0,
      overdueDays: [],
      dueToday: 0,
      unscheduled: 2,
      nextScheduledOn: null,
    },
  ],
};

const GET_MONTH_ATTENTION_EXAMPLE: GetMonthAttentionResponse = {
  operation: 'get_month_attention',
  queriedAt: '2026-10-08T12:00:00.000Z',
  self: `${GET_MONTH_ATTENTION_PATH}?month=2026-10&onlyAttention=true`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:delivery:read'],
  },
  coverage: { kind: 'full' },
  hasMore: false,
  nextCursor: null,
  month: '2026-10',
  today: '2026-10-08',
  timezone: AGENCY_TIMEZONE,
  summary: {
    clients: 12,
    withContract: 10,
    needingAttention: 1,
    byStage: { fechado: 1, aberto: 3, planejado: 5, aprovado: 3 },
    byReason: [
      { key: 'mes-nao-aberto', clients: 0 },
      { key: 'semana-sem-peca', clients: 0 },
      { key: 'atrasadas', clients: 1 },
      { key: 'semana-em-risco', clients: 1 },
      { key: 'semana-anterior-abaixo', clients: 0 },
      { key: 'sem-dia', clients: 1 },
    ],
  },
  clients: [
    {
      id: 'cliente-jatoba',
      name: 'Jatobá',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      owners: [{ id: '22222222-2222-4222-8222-222222222222', name: 'TIME HELENA', kind: 'folder' }],
      stage: 'planejado',
      stageLabel: 'planejado, falta aprovação',
      ritual: {
        monthOpened: true,
        planningDoneAt: '2026-10-02T13:00:00.000Z',
        planningDoneBy: { id: '33333333-3333-4333-8333-333333333333', name: 'Helena' },
        clientApprovedAt: null,
        clientApprovedBy: null,
      },
      hasContract: true,
      quotaSource: 'contrato',
      when: 'atual',
      currentWeek: { number: 2, from: '2026-10-05', to: '2026-10-11' },
      needsAttention: true,
      weight: 40,
      reasons: [
        { key: 'atrasadas', text: '1 peça passou do dia sem entrega.', weight: 40 },
        {
          key: 'semana-em-risco',
          text: 'Esta semana está em risco: falta marcar 1 vídeo.',
          weight: 30,
        },
        { key: 'sem-dia', text: 'As 4 artes do mês ainda estão sem dia.', weight: 10 },
      ],
      types: [
        {
          type: 'video',
          contract: 8,
          delivered: 1,
          scheduled: 1,
          late: 1,
          outsideMonth: 0,
          withoutDay: 1,
          notCreated: 4,
          missingToSchedule: 5,
          extras: 0,
          pendingExtras: 0,
          lateExtras: 0,
          week: { goal: 2, done: 0, scheduled: 1, late: 0, state: 'risco' },
        },
        {
          type: 'arte',
          contract: 4,
          delivered: 0,
          scheduled: 0,
          late: 0,
          outsideMonth: 0,
          withoutDay: 0,
          notCreated: 4,
          missingToSchedule: 4,
          extras: 0,
          pendingExtras: 0,
          lateExtras: 0,
          week: { goal: 1, done: 0, scheduled: 0, late: 0, state: 'risco' },
        },
      ],
    },
  ],
  groups: [
    {
      owner: { id: '22222222-2222-4222-8222-222222222222', name: 'TIME HELENA', kind: 'folder' },
      clientIds: ['cliente-jatoba'],
      needingAttention: 1,
      atRisk: 1,
    },
  ],
};

const GET_CLIENT_MONTH_EXAMPLE: GetClientMonthResponse = {
  operation: 'get_client_month',
  queriedAt: '2026-10-08T12:00:00.000Z',
  self: `${GET_CLIENT_MONTH_PATH}?clientId=cliente-jatoba&month=2026-10`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:delivery:read'],
  },
  coverage: { kind: 'full' },
  hasMore: false,
  nextCursor: null,
  month: '2026-10',
  today: '2026-10-08',
  timezone: AGENCY_TIMEZONE,
  client: GET_MONTH_ATTENTION_EXAMPLE.clients[0] as GetMonthAttentionResponse['clients'][number],
  contract: {
    monthOpened: true,
    source: 'contrato',
    items: [
      { type: 'video', quantity: 8 },
      { type: 'arte', quantity: 4 },
    ],
  },
  meter: {
    measurable: true,
    level: 8,
    base: 8,
    bonus: 0,
    contractedPoints: 28,
    deliveredPoints: 3,
    extraPoints: 0,
    breakdown: [
      {
        contentType: 'video',
        weight: 3,
        contracted: 8,
        delivered: 1,
        extras: 0,
        contractedPoints: 24,
        deliveredPoints: 3,
        extraPoints: 0,
      },
      {
        contentType: 'arte',
        weight: 1,
        contracted: 4,
        delivered: 0,
        extras: 0,
        contractedPoints: 4,
        deliveredPoints: 0,
        extraPoints: 0,
      },
    ],
    deliveredOutsideContract: 0,
    formulaVersion: FORMULA_VERSION,
  },
  pieces: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Vídeo “Reels de abertura”, dia 02/10',
      title: 'Reels de abertura',
      type: 'video',
      day: '2026-10-02',
      done: true,
      completedAt: '2026-10-02T15:00:00.000Z',
      extra: false,
      signal: 'feita',
      week: 1,
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Vídeo sem título, dia 08/10',
      title: null,
      type: 'video',
      day: '2026-10-08',
      done: false,
      completedAt: null,
      extra: false,
      signal: 'agendada',
      week: 2,
    },
    {
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Vídeo sem título, sem data',
      title: null,
      type: 'video',
      day: null,
      done: false,
      completedAt: null,
      extra: false,
      signal: null,
      week: null,
    },
  ],
};

const GET_CALENDAR_EXAMPLE: GetCalendarResponse = {
  operation: 'get_calendar',
  queriedAt: '2026-10-08T12:00:00.000Z',
  self: `${GET_CALENDAR_PATH}?from=2026-10-05&to=2026-10-11`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:delivery:read'],
  },
  coverage: { kind: 'full' },
  hasMore: false,
  nextCursor: null,
  period: { from: '2026-10-05', to: '2026-10-11', days: 7 },
  timezone: AGENCY_TIMEZONE,
  summary: { deliveries: 2, deliveriesDone: 1, appointments: 1 },
  entries: [
    {
      kind: 'appointment',
      id: '88888888-8888-4888-8888-888888888888',
      day: '2026-10-06',
      time: '14:30',
      client: { id: 'cliente-jatoba', name: 'Jatobá' },
      type: null,
      title: 'Gravação na loja',
      done: null,
      extra: null,
    },
    {
      kind: 'delivery',
      id: '55555555-5555-4555-8555-555555555555',
      day: '2026-10-06',
      time: null,
      client: { id: 'cliente-hiper-center', name: 'Hiper Center' },
      type: 'arte',
      title: 'Post de lançamento',
      done: true,
      extra: false,
    },
    {
      kind: 'delivery',
      id: '66666666-6666-4666-8666-666666666666',
      day: '2026-10-08',
      time: null,
      client: { id: 'cliente-jatoba', name: 'Jatobá' },
      type: 'video',
      title: null,
      done: false,
      extra: false,
    },
  ],
};

const LIST_TAGS_EXAMPLE: ListTagsResponse = {
  operation: 'list_tags',
  queriedAt: '2026-10-08T12:00:00.000Z',
  self: `${LIST_TAGS_PATH}?listId=11111111-2222-3333-4444-555555555555`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['boards:read'],
  },
  hasMore: false,
  nextCursor: null,
  space: { id: '66666666-6666-4666-8666-666666666666', name: 'CLIENTES', company: { id: 'empresa-a', name: 'Agência Ide' } },
  list: { id: '11111111-2222-3333-4444-555555555555', name: 'Redes sociais' },
  total: 2,
  tags: [
    { id: '77777777-7777-4777-8777-777777777777', name: 'Reels', bgColor: '#7c3aed', fgColor: '#ffffff' },
    { id: '88888888-8888-4888-8888-888888888888', name: 'Urgente', bgColor: null, fgColor: null },
  ],
};

const GET_CLIENT_EXAMPLE: GetClientResponse = {
  operation: 'get_client',
  queriedAt: '2026-10-08T12:00:00.000Z',
  self: `${GET_CLIENT_PATH}?id=cliente-jatoba`,
  effectiveScope: { ...SCOPE_EXAMPLE, capabilities: ['clients:read', 'boards:read'] },
  hasMore: false,
  nextCursor: null,
  client: {
    id: 'cliente-jatoba',
    name: 'Jatobá',
    company: { id: 'empresa-a', name: 'Agência Ide' },
    lists: [
      {
        id: 'lista-atendimento-jatoba',
        name: 'Atendimento',
        archived: false,
        space: { id: 'espaco-clientes', name: 'CLIENTES' },
        folder: { id: 'pasta-time-helena', name: 'TIME HELENA' },
      },
    ],
    plan: { id: 'plano-premium', name: 'Premium' },
    urgency: 'alerta',
    startedOn: '2024-03-01',
    renewsOn: '2027-03-01',
    quotas: [
      { type: 'video', quantity: 8 },
      { type: 'arte', quantity: 4 },
    ],
    tags: [{ id: 'etiqueta-restaurante', name: 'Restaurante', color: '#f59e0b' }],
  },
};

const LIST_CLIENTS_EXAMPLE: ListClientsResponse = {
  operation: 'list_clients',
  queriedAt: '2026-10-08T12:00:00.000Z',
  self: `${LIST_CLIENTS_PATH}?urgency=alerta`,
  effectiveScope: { ...SCOPE_EXAMPLE, capabilities: ['clients:read'] },
  hasMore: false,
  nextCursor: null,
  total: 1,
  clients: [
    {
      id: 'cliente-jatoba',
      name: 'Jatobá',
      company: { id: 'empresa-a', name: 'Agência Ide' },
      plan: { id: 'plano-premium', name: 'Premium' },
      urgency: 'alerta',
      startedOn: '2024-03-01',
      renewsOn: '2027-03-01',
      tags: [{ id: 'etiqueta-restaurante', name: 'Restaurante', color: '#f59e0b' }],
    },
  ],
};

const LIST_BOARDS_EXAMPLE: ListBoardsResponse = {
  operation: 'list_boards',
  queriedAt: '2026-10-08T12:00:00.000Z',
  self: LIST_BOARDS_PATH,
  effectiveScope: { ...SCOPE_EXAMPLE, capabilities: ['boards:read', 'clients:read'] },
  hasMore: false,
  nextCursor: null,
  total: 2,
  boards: [
    {
      id: '11111111-2222-3333-4444-555555555555',
      name: 'Atendimento',
      space: { id: 'espaco-clientes', name: 'CLIENTES' },
      folder: { id: 'pasta-time-helena', name: 'TIME HELENA' },
      company: { id: 'empresa-a', name: 'Agência Ide' },
      client: { id: 'cliente-jatoba', name: 'Jatobá' },
      requiresClient: false,
      isProduction: true,
      archived: false,
    },
    {
      id: '22222222-3333-4444-5555-666666666666',
      name: 'ATENDIMENTO',
      space: { id: 'espaco-ide', name: 'Estúdio Ide' },
      folder: null,
      company: { id: 'empresa-a', name: 'Agência Ide' },
      client: null,
      requiresClient: true,
      isProduction: false,
      archived: false,
    },
  ],
};

const LIST_TASKS_EXAMPLE: ListTasksResponse = {
  operation: 'list_tasks',
  queriedAt: '2026-10-08T12:00:00.000Z',
  self: `${LIST_TASKS_PATH}?overdue=true`,
  effectiveScope: { ...SCOPE_EXAMPLE, capabilities: ['tasks:read', 'boards:read', 'clients:read', 'people:read'] },
  hasMore: false,
  nextCursor: null,
  today: '2026-10-08',
  total: 1,
  tasks: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Peça da campanha',
      statusId: 'status-aberto',
      statusName: 'Em produção',
      statusType: 'custom',
      priority: 'high',
      type: 'video',
      dueOn: '2026-10-05',
      startOn: null,
      completedAt: null,
      list: { id: '11111111-2222-3333-4444-555555555555', name: 'Atendimento' },
      client: { id: 'cliente-jatoba', name: 'Jatobá' },
      people: [{ id: 'pessoa-helena', name: 'Helena' }],
    },
  ],
};

const ALCANCE_APROX = {
  kind: 'approximate' as const,
  distinctPeople: false as const,
  average: 100,
  peak: 100,
  peakOn: '2026-09-01',
  days: 1,
  status: 'present' as const,
  note: 'Média e pico diários. Não é o total de pessoas únicas do período — alcance não se soma.',
};

const CURVA_ALCANCE = {
  metric: 'reach' as const,
  kind: 'approximate' as const,
  distinctPeople: false as const,
  note: 'Curva aproximada para ver a forma. Os dias não se somam; as mesmas pessoas aparecem em vários.',
  points: [
    { day: '2026-09-01', value: 100, status: 'present' as const },
    { day: '2026-09-02', value: null, status: 'absent' as const },
  ],
};

const GET_MARKETING_REPORT_EXAMPLE: GetMarketingReportResponse = {
  operation: 'get_marketing_report',
  queriedAt: '2026-09-21T04:00:00.000Z',
  self: `${GET_MARKETING_REPORT_PATH}?from=2026-09-01&to=2026-09-02`,
  effectiveScope: {
    ...SCOPE_EXAMPLE,
    capabilities: ['reports:marketing:read'],
  },
  period: {
    requested: { from: '2026-09-01', to: '2026-09-02' },
    effective: { from: '2026-09-01', to: '2026-09-02' },
    truncated: false,
    timezone: AGENCY_TIMEZONE,
    maxDays: 800,
  },
  coverage: {
    kind: 'partial',
    reason: 'A concessão recorta empresas ou clientes; o agregado não é a carteira global.',
    collectedAt: '2026-08-01T12:00:00.000Z',
    collection: {
      status: 'stale',
      lastRunAt: '2026-08-01T12:00:00.000Z',
      lastRunOutcome: 'ok',
      triggeredNow: false,
      message:
        'Última coleta em 2026-08-01T12:00:00.000Z. Esta resposta lê o que já estava no port, sem disparar coleta agora.',
    },
  },
  paid: {
    accounts: [
      {
        id: 'conta-anuncio-jatoba',
        kind: 'ad_account',
        displayName: 'Jatobá Ads',
        externalId: 'act_1',
        client: { id: 'cliente-jatoba', name: 'Jatobá' },
        company: { id: 'empresa-a', name: 'Agência Ide' },
        currency: null,
        currencyKnown: false,
        collectedAt: '2026-08-01T12:00:00.000Z',
        kpis: {
          spend: { value: 10, status: 'present' },
          impressions: { value: 200, status: 'present' },
          clicks: { value: 4, status: 'present' },
          linkClicks: { value: null, status: 'absent' },
          conversions: { value: 0, status: 'present' },
          conversionValue: { value: null, status: 'absent' },
          reach: ALCANCE_APROX,
          ctr: { value: 0.02, status: 'present' },
          cpc: { value: 2.5, status: 'present' },
          cpm: { value: 50, status: 'present' },
          cpa: { value: null, status: 'absent' },
          roas: { value: null, status: 'absent' },
          days: 1,
        },
        campaigns: [
          {
            campaignId: 'camp-1',
            campaignName: 'Campanha',
            kpis: {
              spend: { value: 10, status: 'present' },
              impressions: { value: 200, status: 'present' },
              clicks: { value: 4, status: 'present' },
              linkClicks: { value: null, status: 'absent' },
              conversions: { value: 0, status: 'present' },
              conversionValue: { value: null, status: 'absent' },
              reach: ALCANCE_APROX,
              ctr: { value: 0.02, status: 'present' },
              cpc: { value: 2.5, status: 'present' },
              cpm: { value: 50, status: 'present' },
              cpa: { value: null, status: 'absent' },
              roas: { value: null, status: 'absent' },
              days: 1,
            },
          },
        ],
        series: {
          spend: {
            metric: 'spend',
            points: [
              { day: '2026-09-01', value: 10, status: 'present' },
              { day: '2026-09-02', value: null, status: 'absent' },
            ],
          },
          impressions: {
            metric: 'impressions',
            points: [
              { day: '2026-09-01', value: 200, status: 'present' },
              { day: '2026-09-02', value: null, status: 'absent' },
            ],
          },
          reach: CURVA_ALCANCE,
        },
      },
    ],
    totals: {
      impressions: { value: 200, status: 'present' },
      clicks: { value: 4, status: 'present' },
      linkClicks: { value: null, status: 'absent' },
      conversions: { value: 0, status: 'present' },
      reach: ALCANCE_APROX,
      ctr: { value: 0.02, status: 'present' },
      days: 1,
    },
    spendByCurrency: [
      {
        currency: null,
        currencyKnown: false,
        spend: { value: 10, status: 'present' },
        conversionValue: { value: null, status: 'absent' },
        cpc: { value: 2.5, status: 'present' },
        cpm: { value: 50, status: 'present' },
        cpa: { value: null, status: 'absent' },
        roas: { value: null, status: 'absent' },
      },
    ],
  },
  organic: {
    accounts: [
      {
        id: 'conta-ig-jatoba',
        kind: 'instagram_account',
        displayName: 'Jatobá IG',
        externalId: 'ig_1',
        client: { id: 'cliente-jatoba', name: 'Jatobá' },
        company: { id: 'empresa-a', name: 'Agência Ide' },
        collectedAt: '2026-08-01T12:00:00.000Z',
        kpis: {
          views: { value: 50, status: 'present' },
          totalInteractions: { value: null, status: 'absent' },
          follows: { value: 2, status: 'present' },
          unfollows: { value: 0, status: 'present' },
          profileLinksTaps: { value: null, status: 'absent' },
          followerBalance: { value: 2, status: 'present' },
          reach: ALCANCE_APROX,
          accountsEngaged: {
            ...ALCANCE_APROX,
            average: 10,
            peak: 10,
          },
          engagementRate: { value: 0.1, status: 'present' },
          followers: { value: 1000, status: 'present' },
          publications: { value: null, status: 'absent' },
          days: 1,
        },
        series: {
          views: {
            metric: 'views',
            points: [
              { day: '2026-09-01', value: 50, status: 'present' },
              { day: '2026-09-02', value: null, status: 'absent' },
            ],
          },
          reach: CURVA_ALCANCE,
          accountsEngaged: {
            ...CURVA_ALCANCE,
            metric: 'accountsEngaged',
            points: [
              { day: '2026-09-01', value: 10, status: 'present' },
              { day: '2026-09-02', value: null, status: 'absent' },
            ],
          },
        },
      },
    ],
    totals: {
      views: { value: 50, status: 'present' },
      totalInteractions: { value: null, status: 'absent' },
      follows: { value: 2, status: 'present' },
      unfollows: { value: 0, status: 'present' },
      profileLinksTaps: { value: null, status: 'absent' },
      followerBalance: { value: 2, status: 'present' },
      reach: ALCANCE_APROX,
      accountsEngaged: {
        ...ALCANCE_APROX,
        average: 10,
        peak: 10,
      },
      engagementRate: { value: 0.1, status: 'present' },
      followers: { value: 1000, status: 'present' },
      publications: { value: null, status: 'absent' },
      days: 1,
    },
  },
};

function errorResponses(...codes: string[]): Record<string, unknown> {
  const errorResponse = {
    description: 'Recusa com código estável.',
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/IntegrationError' } },
    },
  };
  const out: Record<string, unknown> = {};
  for (const code of codes) out[code] = errorResponse;
  return out;
}

function jsonOk(schemaRef: string, example: unknown, description: string) {
  const media: Record<string, unknown> = {
    schema: { $ref: `#/components/schemas/${schemaRef}` },
  };
  if (example !== null && example !== undefined) media.example = example;
  return {
    description,
    content: { 'application/json': media },
  };
}

function readOperationPaths(input: {
  operationId: string;
  summary: string;
  inputRef: string;
  responseRef: string;
  example: unknown;
  description: string;
  query?: Array<{ name: string; required: boolean; schema: Record<string, unknown> }>;
  extraErrors?: string[];
}): Record<string, unknown> {
  const errors = errorResponses('400', '401', '403', '409', '422', '429', ...(input.extraErrors ?? []));
  return {
    get: {
      operationId: input.operationId,
      summary: input.summary,
      security: [{ bearerAuth: [] }],
      parameters: input.query ?? [],
      responses: { '200': jsonOk(input.responseRef, input.example, input.description), ...errors },
    },
    post: {
      operationId: `${input.operationId}_post`,
      summary: input.summary,
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${input.inputRef}` } },
        },
      },
      responses: { '200': jsonOk(input.responseRef, input.example, input.description), ...errors },
    },
  };
}

function writeOperationPath(input: {
  operationId: string;
  summary: string;
  inputRef: string;
  responseRef: string;
  example: unknown;
  description: string;
}): Record<string, unknown> {
  const errors = errorResponses('400', '401', '403', '404', '409', '413', '422', '429', '503');
  return {
    post: {
      operationId: input.operationId,
      summary: input.summary,
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: `#/components/schemas/${input.inputRef}` } },
        },
      },
      responses: { '200': jsonOk(input.responseRef, input.example, input.description), ...errors },
    },
  };
}

const ADD_COMMENT_EXAMPLE: AddCommentResponse = {
  operation: 'add_comment',
  commentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  taskId: '33333333-3333-4333-8333-333333333333',
  parentId: null,
  executionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  replay: false,
  actedAs: {
    ownerId: '11111111-1111-1111-1111-111111111111',
    integrationId: 'grant-exemplo',
    integrationName: 'Claude da agência',
  },
};

const PREVIEW_MOVE_EXAMPLE: PreviewMoveResponse = {
  operation: 'preview_move',
  taskId: '33333333-3333-4333-8333-333333333333',
  from: {
    listId: 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1',
    statusId: 'bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1',
  },
  listId: 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2',
  statusId: 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2',
  statusName: 'REFAÇÃO',
  completed: false,
  reopened: false,
  subtasksWouldMove: 0,
  automation: null,
  writeImpact: 'auto',
};

const MOVE_TASK_EXAMPLE: MoveTaskResponse = {
  operation: 'move_task',
  taskId: '33333333-3333-4333-8333-333333333333',
  listId: 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2',
  statusId: 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2',
  statusName: 'REFAÇÃO',
  completed: false,
  reopened: false,
  subtasksMoved: 0,
  automation: null,
  executionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  replay: false,
  actedAs: {
    ownerId: '11111111-1111-1111-1111-111111111111',
    integrationId: 'grant-exemplo',
    integrationName: 'Claude da agência',
  },
};

const TASK_STATE_EXAMPLE: AgentTaskStateView = {
  listId: 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2',
  statusId: 'bbbbbbb3-bbb3-4bb3-8bb3-bbbbbbbbbbb3',
  completed: false,
  dueOn: '2026-09-30',
  startOn: null,
  priority: 'high',
  type: 'video',
  assigneeIds: ['11111111-1111-1111-1111-111111111111'],
  tagIds: [],
};

const TASK_ACTED_AS_EXAMPLE = {
  ownerId: '11111111-1111-1111-1111-111111111111',
  integrationId: 'grant-exemplo',
  integrationName: 'Claude da agência',
};

const CREATE_TASK_EXAMPLE: CreateTaskResponse = {
  operation: 'create_task',
  taskId: '33333333-3333-4333-8333-333333333333',
  dryRun: false,
  task: TASK_STATE_EXAMPLE,
  executionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  replay: false,
  actedAs: TASK_ACTED_AS_EXAMPLE,
};

const UPDATE_TASK_EXAMPLE: UpdateTaskResponse = {
  ...CREATE_TASK_EXAMPLE,
  operation: 'update_task',
  taskId: '33333333-3333-4333-8333-333333333333',
};

const ASSIGN_TASK_EXAMPLE: AssignTaskResponse = {
  ...CREATE_TASK_EXAMPLE,
  operation: 'assign_task',
  taskId: '33333333-3333-4333-8333-333333333333',
};

const COMPLETE_TASK_EXAMPLE: CompleteTaskResponse = {
  ...CREATE_TASK_EXAMPLE,
  operation: 'complete_task',
  taskId: '33333333-3333-4333-8333-333333333333',
  task: { ...TASK_STATE_EXAMPLE, statusId: 'bbbbbbb5-bbb5-4bb5-8bb5-bbbbbbbbbbb5', completed: true },
};

const REOPEN_TASK_EXAMPLE: ReopenTaskResponse = {
  ...CREATE_TASK_EXAMPLE,
  operation: 'reopen_task',
  taskId: '33333333-3333-4333-8333-333333333333',
};

const RELEASE_TASK_EXAMPLE: ReleaseTaskResponse = {
  ...CREATE_TASK_EXAMPLE,
  operation: 'release_task',
  taskId: '33333333-3333-4333-8333-333333333333',
  statusName: 'a fazer video',
};

const GET_ADMIN_WEEK_EXAMPLE: GetAdminWeekResponse = {
  operation: 'get_admin_week',
  queriedAt: '2026-10-07T15:00:00.000Z',
  self: GET_ADMIN_WEEK_PATH,
  week: {
    start: '2026-10-05',
    end: '2026-10-11',
    today: '2026-10-07',
    isCurrent: true,
    previous: '2026-09-28',
    next: '2026-10-12',
  },
  toAssign: [
    {
      clientId: '44444444-4444-4444-8444-444444444444',
      clientName: 'Clinimax',
      type: 'video',
      cards: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Reels de outubro',
          createdBy: { id: '11111111-1111-1111-1111-111111111111', name: 'Gustavo' },
          suggestedDueOn: '2026-10-09',
          list: { id: 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2', name: 'Clinimax' },
        },
      ],
    },
  ],
  progress: [
    {
      clientId: '44444444-4444-4444-8444-444444444444',
      clientName: 'Clinimax',
      type: 'video',
      awaiting: 1,
      todo: 1,
      doing: 0,
      done: 0,
    },
  ],
  missing: {
    items: [
      {
        clientId: '44444444-4444-4444-8444-444444444444',
        clientName: 'Clinimax',
        type: 'video',
        target: 2,
        cards: 2,
        missing: 0,
      },
    ],
    overdue: [],
    overdueTotal: 0,
  },
};

/** Frase comum das cinco escritas de tarefa no OpenAPI. */
const TASK_WRITE_NOTES =
  'Autor = dono da concessão; nada no corpo escolhe autor. Lista, tarefa e cada responsável novo precisam estar no recorte da concessão, ' +
  'não só no alcance de quem conectou (fora dele: permission_denied, nada gravado). ' +
  'dryRun: true confere tudo, inclusive as regras do banco e o teto do dia, e responde o que faria, sem gravar, sem registro e sem gastar teto; ' +
  'a recusa do ensaio é a mesma da escrita real. 1 chamada = 1 escrita do teto diário. Replay da mesma chave devolve o mesmo resultado. ' +
  'O registro guarda o valor anterior e o novo das mudanças pequenas (responsáveis, prazo, início, prioridade, etiquetas, concluída), nunca título nem descrição.';

/* --- F26.6: exemplos do mural e do histórico ------------------------------ */

const CLIENT_EXAMPLE = { id: '44444444-4444-4444-8444-444444444444', name: 'Clinimax' };

const GET_CLIENT_MURAL_EXAMPLE: GetClientMuralResponse = {
  operation: 'get_client_mural',
  queriedAt: '2026-09-22T12:00:00.000Z',
  self: `${GET_CLIENT_MURAL_PATH}?clientId=44444444-4444-4444-8444-444444444444`,
  effectiveScope: {
    companies: [{ id: 'empresa-a', name: 'Agência Ide' }],
    capabilities: ['clients:read', 'people:read', 'clients:mural:write'],
    policyVersion: 1,
    companyScope: 'ids',
  },
  hasMore: false,
  nextCursor: null,
  client: CLIENT_EXAMPLE,
  items: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Reunião de pauta',
      content: 'Cliente quer vídeo de bastidores em outubro.',
      color: 'yellow',
      author: { id: '11111111-1111-1111-1111-111111111111', name: 'Wesley Lourenço' },
      viaName: 'Claude da agência',
      agentEditable: true,
      createdAt: '2026-09-22T11:00:00.000Z',
      updatedAt: '2026-09-22T11:00:00.000Z',
    },
  ],
};

const GET_CLIENT_HISTORY_EXAMPLE: GetClientHistoryResponse = {
  ...GET_CLIENT_MURAL_EXAMPLE,
  operation: 'get_client_history',
  self: `${GET_CLIENT_HISTORY_PATH}?clientId=44444444-4444-4444-8444-444444444444`,
  items: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      happenedOn: '2026-09-21',
      title: 'Reunião de alinhamento',
      subtitle: null,
      body: 'Definimos as pautas de outubro e o dia de captação.',
      ledBy: { id: '11111111-1111-1111-1111-111111111111', name: 'Wesley Lourenço' },
      ledByNote: null,
      author: { id: '11111111-1111-1111-1111-111111111111', name: 'Wesley Lourenço' },
      documentCount: 0,
      viaName: null,
      agentEditable: false,
      createdAt: '2026-09-21T18:00:00.000Z',
      updatedAt: '2026-09-21T18:00:00.000Z',
    },
  ],
};

const ADD_MURAL_NOTE_EXAMPLE: AddMuralNoteResponse = {
  operation: 'add_mural_note',
  noteId: '55555555-5555-4555-8555-555555555555',
  note: { clientId: CLIENT_EXAMPLE.id, color: 'yellow', viaName: 'Claude da agência' },
  dryRun: false,
  executionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  replay: false,
  actedAs: TASK_ACTED_AS_EXAMPLE,
};

const UPDATE_MURAL_NOTE_EXAMPLE: UpdateMuralNoteResponse = {
  ...ADD_MURAL_NOTE_EXAMPLE,
  operation: 'update_mural_note',
  noteId: '55555555-5555-4555-8555-555555555555',
  note: { ...ADD_MURAL_NOTE_EXAMPLE.note, color: 'green' },
};

const ADD_HISTORY_ENTRY_EXAMPLE: AddHistoryEntryResponse = {
  operation: 'add_history_entry',
  entryId: '66666666-6666-4666-8666-666666666666',
  entry: {
    clientId: CLIENT_EXAMPLE.id,
    happenedOn: '2026-09-21',
    ledById: '11111111-1111-1111-1111-111111111111',
    viaName: 'Claude da agência',
  },
  dryRun: false,
  executionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  replay: false,
  actedAs: TASK_ACTED_AS_EXAMPLE,
};

const UPDATE_HISTORY_ENTRY_EXAMPLE: UpdateHistoryEntryResponse = {
  ...ADD_HISTORY_ENTRY_EXAMPLE,
  operation: 'update_history_entry',
  entryId: '66666666-6666-4666-8666-666666666666',
};

/** Frase comum das quatro escritas de mural e histórico no OpenAPI. */
const CLIENT_RECORD_WRITE_NOTES =
  'Autor = dono da concessão; nada no corpo escolhe autor, e a linha sai marcada com o nome da conexão (viaName). ' +
  'O cliente precisa estar no recorte da concessão, não só no alcance de quem conectou (fora dele: permission_denied, nada gravado). ' +
  'A IA só edita o que a IA da MESMA pessoa escreveu: editar nota ou registro escrito por gente, ou pela IA de outra pessoa, é permission_denied com a frase do banco. ' +
  'dryRun: true confere tudo, inclusive as regras do banco e o teto do dia, e responde o que faria, sem gravar, sem registro e sem gastar teto. ' +
  '1 chamada = 1 escrita do teto diário. Replay da mesma chave devolve o mesmo resultado. ' +
  'O registro guarda só metadados (cliente, cor, data, quem conduziu e o NOME dos campos de texto editados), nunca o texto. Texto editado não se desfaz pela tela.';

export function integrationOpenApi(): Record<string, unknown> {
  const errorResponse = {
    description: 'Recusa com código estável.',
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/IntegrationError' } },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'IDE Works — Integrações',
      version: INTEGRATION_API_VERSION,
      description:
        'API HTTP versionada para agentes. Token MCP não autentica esta superfície. ' +
        'get_context devolve o recorte efetivo da concessão. ' +
        'search, get_board, get_task, get_client, list_comments, list_people e get_person_work leem só o trabalho concedido. ' +
        'get_delivery_report usa a mesma fórmula de nível da aplicação; mês sem contrato mensurável não vira 0%. ' +
        'get_client_delivery_history (um cliente, até 24 meses, com detalhe por tipo) e get_delivery_trend (a carteira, até 6 meses, só o nível) dão a mesma fórmula mês a mês. ' +
        'get_planning_weeks lê o mês de cada cliente por semana (cota, meta, entregue, o que falta, por responsável), como a aba Semana do Planejamento. ' +
        'get_delivery_status dá, por cliente ativo, a última entrega e as peças vencidas pela Semanal, o mesmo número do Painel; cliente cancelado não aparece. ' +
        'get_month_attention responde "quais clientes estão atrás neste mês?": por cliente ativo, o estágio do ritual (planejado, aprovado), o contrato do mês por tipo em seis baldes e os motivos de atenção com a frase pronta, pelas mesmas funções da visão Contrato do Planejamento. ' +
        'get_client_month abre o mês de UM cliente com cada peça pelo nome (contrato, ritual, medidor, dia, ✓, extra) e get_calendar lista as peças com dia e os compromissos de um período de até 62 dias. ' +
        'get_admin_week (leitura) e release_task (escrita) são do painel Controle da semana e só valem para a concessão de um administrador: a semana (para atribuir, andamento, faltando) e a liberação do card com pessoas e prazo. ' +
        'list_boards lista as listas do recorte (espaço, pasta, cliente, exige cliente, produção) e list_tasks lista as tarefas com filtro (lista, pasta, espaço, responsável, criador, etapa, tipo, prazo, atrasadas, cliente). ' +
        'list_clients lista a carteira ativa com o cadastro de cada cliente (plano, urgência, financeiro, renovação, etiquetas), sem dado de contato; get_client traz também a cota vigente por tipo. ' +
        'list_tags lista as etiquetas de um espaço (ou do espaço de uma lista), de onde saem os tagIds de create_task e update_task. ' +
        'get_workflow lê as etapas de uma lista ou de uma pasta (ordem, tipo e de onde a esteira vem: lista, pasta ou espaço); os ids das etapas mudam quando a esteira da pasta é alterada, então releia antes de mover. ' +
        'get_task, get_board e get_person_work trazem prioridade e tipo da etapa; get_client_history aceita query para buscar por palavra. ' +
        'get_marketing_report lê orgânico/pago já coletado, sem disparar coleta; alcance não se soma; conta de cliente cancelado só entra até o mês do cancelamento. ' +
        'get_person_work não traz tarefa de cliente cancelado, nem nas contagens. ' +
        'add_comment publica comentário ou resposta com autoria da concessão (sem authorId). ' +
        'preview_move mostra destino, etapa e efeitos sem escrever. ' +
        'move_task move o card com as regras atuais (esteira, subtarefas, automação) e devolve o estado final compacto. ' +
        'create_task, update_task, assign_task, complete_task e reopen_task escrevem a tarefa com autoria da concessão, recorte da conexão, teto diário, chave de repetição e ensaio (dryRun). ' +
        'get_client_mural e get_client_history leem o mural e o histórico do cliente; add_mural_note, update_mural_note, add_history_entry e update_history_entry escrevem neles, e a IA só edita o que a IA da mesma pessoa escreveu. ' +
        'Pessoa visível sem demanda devolve zero; pessoa inacessível é permission_denied. ' +
        'Nome ambíguo devolve várias opções com contexto; mutação futura exige id.',
    },
    servers: [{ url: HTTP_INTEGRATIONS_PATH }],
    paths: {
      '/openapi.json': {
        get: {
          operationId: 'get_openapi',
          summary: 'Contrato OpenAPI',
          security: [],
          responses: {
            '200': {
              description: 'Documento OpenAPI 3.1 gerado dos schemas Zod.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/get_context': {
        get: {
          operationId: 'get_context',
          summary: 'Contexto recortado da integração',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': jsonOk('GetContextResponse', GET_CONTEXT_EXAMPLE, 'Identidade mínima, recorte efetivo e instante da consulta.'),
            '401': errorResponse,
            '429': errorResponse,
          },
        },
        post: {
          operationId: 'get_context_post',
          summary: 'Contexto recortado da integração',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: false,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/GetContextInput' } },
            },
          },
          responses: {
            '200': jsonOk('GetContextResponse', GET_CONTEXT_EXAMPLE, 'Identidade mínima, recorte efetivo e instante da consulta.'),
            '400': errorResponse,
            '401': errorResponse,
            '429': errorResponse,
          },
        },
      },
      '/search': readOperationPaths({
        operationId: 'search',
        summary: 'Localizar tarefa, lista, cliente ou pessoa',
        inputRef: 'SearchInput',
        responseRef: 'SearchResponse',
        example: SEARCH_EXAMPLE,
        description: 'Várias opções com contexto. Não escolhe uma. Mutação futura exige id.',
        query: [
          { name: 'q', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'kinds', required: false, schema: { type: 'array', items: { type: 'string', enum: [...SEARCH_KINDS] } } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_board': readOperationPaths({
        operationId: 'get_board',
        summary: 'Quadro acessível: esteira, contagens e cartões recortados',
        inputRef: 'GetBoardInput',
        responseRef: 'GetBoardResponse',
        example: null,
        description:
          'Contagens só do recorte. Colunas trazem o tipo da etapa (type); cartões trazem priority, startOn, completedAt, archivedAt e type (o tipo da demanda: video, arte, foto, outros; opcionais/anuláveis). Sem boards:read a recusa é permission_denied.',
        query: [
          { name: 'id', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_task': readOperationPaths({
        operationId: 'get_task',
        summary: 'Ficha da tarefa com relações concedidas',
        inputRef: 'GetTaskInput',
        responseRef: 'GetTaskResponse',
        example: GET_TASK_EXAMPLE,
        description:
          'Sem clients:read o cliente some. Traz prioridade, início, conclusão, arquivamento e o tipo da etapa (opcionais/anuláveis). Descrição longa e conversa longa continuam por cursor, no próprio get_task: primeiro a descrição, depois os comentários. ' +
          'A ficha inteira (só na primeira página, tudo opcional): tags (ids para tagIds), watchers, parentId/parentTitle, checklists (itens com resolved e responsável), links (rótulo e URL, o material do Dropbox), history (quando, quem, por qual IA, o quê, do mais antigo ao mais novo), createdBy/completedBy/createdVia/createdAt, folder e space. ' +
          'Seguidores, quem criou/concluiu, responsável de item e quem agiu no histórico exigem people:read (sem ela: null); o nome de pasta e espaço exige boards:read; o histórico só nomeia lista, etapa e cliente que a conexão alcança. Cada grupo grande vem com teto e total (checklistItemTotal, linkTotal, historyTotal).',
        query: [
          { name: 'id', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_client': readOperationPaths({
        operationId: 'get_client',
        summary: 'Cliente e listas visíveis (vínculo sem nome se o quadro não cabe)',
        inputRef: 'GetClientInput',
        responseRef: 'GetClientResponse',
        example: GET_CLIENT_EXAMPLE,
        description:
          'Lista fora de boards:read/can_see_space aparece só com id. Cliente ativo traz também, opcionais, a ficha do cadastro: plan, urgency (paz, alerta, perigo), startedOn, renewsOn, quotas (a cota VIGENTE por tipo, a de hoje; a do mês é o contrato congelado, em get_client_month) e tags. NUNCA contato: sem CNPJ, telefone, WhatsApp, e-mail, endereço, responsável do cliente, observações nem links. Cliente cancelado devolve só id, nome, cancelled e cancelledOn.',
        query: [{ name: 'id', required: true, schema: { type: 'string', minLength: 1 } }],
      }),
      '/list_comments': readOperationPaths({
        operationId: 'list_comments',
        summary: 'Conversa paginada de uma tarefa acessível',
        inputRef: 'ListCommentsInput',
        responseRef: 'ListCommentsResponse',
        example: null,
        description: 'Sem comments:read a recusa é permission_denied. Orçamento 64 KiB.',
        query: [
          { name: 'taskId', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/list_people': readOperationPaths({
        operationId: 'list_people',
        summary: 'Diretório mínimo da equipe visível no recorte',
        inputRef: 'ListPeopleInput',
        responseRef: 'ListPeopleResponse',
        example: LIST_PEOPLE_EXAMPLE,
        description:
          'Id, nome de exibição e contexto de equipe. Sem people:read a recusa é permission_denied, não lista vazia.',
        query: [
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_person_work': readOperationPaths({
        operationId: 'get_person_work',
        summary: 'Demandas e contagens visíveis de uma pessoa do diretório',
        inputRef: 'GetPersonWorkInput',
        responseRef: 'GetPersonWorkResponse',
        example: GET_PERSON_WORK_EXAMPLE,
        description:
          'Cada item traz a etapa da esteira (statusId, statusName, statusType), a prioridade e o tipo da demanda (type), para agrupar a fila por etapa; ausentes vêm null. Tarefa de cliente cancelado (o cliente da tarefa ou, sem ele, o da lista) não volta nem entra em counts; pelo id, get_task continua lendo. Pessoa visível sem tarefas: zero, 200. Fora do recorte, sem people:read ou id desconhecido: permission_denied.',
        query: [
          { name: 'id', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_delivery_report': readOperationPaths({
        operationId: 'get_delivery_report',
        summary: 'Produção, metas e entregas do período recortado',
        inputRef: 'GetDeliveryReportInput',
        responseRef: 'GetDeliveryReportResponse',
        example: GET_DELIVERY_REPORT_EXAMPLE,
        description:
          'Mesma fórmula de calculateDeliveryLevel. O medidor cobra os meses civis que o intervalo toca, inteiros. ' +
          'Cliente cancelado conta só até o mês do cancelamento (São Paulo), inclusive: entra se cancelou no primeiro mês do intervalo ou depois, e só com o contrato, as peças e a produção desses meses. ' +
          'inPeriod conta só os dias pedidos, e o dia de cada peça é o de São Paulo (a peça das 22h de 31/10 é de 31/10). Sem reports:delivery:read: permission_denied. ' +
          'Intervalo acima de 24 meses: limit_exceeded, sem corte silencioso. ' +
          'Concessão parcial marca coverage.kind=partial e não devolve a carteira global.',
        query: [
          { name: 'from', required: false, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
          { name: 'to', required: false, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        ],
      }),
      '/get_client_delivery_history': readOperationPaths({
        operationId: 'get_client_delivery_history',
        summary: 'Evolução da entrega de um cliente, mês a mês, com o detalhe por tipo',
        inputRef: 'GetClientDeliveryHistoryInput',
        responseRef: 'GetClientDeliveryHistoryResponse',
        example: GET_CLIENT_DELIVERY_HISTORY_EXAMPLE,
        description:
          'Cada mês traz exatamente o que get_delivery_report daria pedido só com aquele mês: nível, base, bônus, pontos e breakdown, ou measurable=false com o motivo (nunca 0%). ' +
          'Cliente cancelado conta até o mês do cancelamento, inclusive; do mês seguinte em diante o mês vem measurable=false, reason=cancelled e cancelledOn (AAAA-MM-DD). ' +
          'from/to em AAAA-MM; sem eles, os 6 meses que terminam no mês atual (period.currentMonth, ainda em curso). ' +
          `Mais de ${DELIVERY_HISTORY_MAX_MONTHS} meses: limit_exceeded com o limite na frase. ` +
          'Sem reports:delivery:read, cliente fora do recorte ou inexistente: permission_denied, sem distinguir os dois.',
        query: [
          { name: 'clientId', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'from', required: false, schema: { type: 'string', pattern: DELIVERY_MONTH_PATTERN.source } },
          { name: 'to', required: false, schema: { type: 'string', pattern: DELIVERY_MONTH_PATTERN.source } },
        ],
      }),
      '/get_delivery_trend': readOperationPaths({
        operationId: 'get_delivery_trend',
        summary: 'Nível de entrega de todos os clientes do recorte, mês a mês, compacto',
        inputRef: 'GetDeliveryTrendInput',
        responseRef: 'GetDeliveryTrendResponse',
        example: GET_DELIVERY_TREND_EXAMPLE,
        description:
          'Para cada cliente, levels[i] é o nível do mês months[i] (o mesmo de get_delivery_report daquele mês) ou o motivo de não ser mensurável. ' +
          'Cliente cancelado conta até o mês do cancelamento, inclusive: depois dele, levels[i] = cancelled e o cliente sai do summary daquele mês; cancelado antes do intervalo inteiro não aparece. ' +
          'change = pontos do penúltimo para o último mês, nulo se um dos dois não é mensurável. Ordem por nome. ' +
          `from/to em AAAA-MM; sem eles, os 6 meses que terminam no mês atual. Mais de ${DELIVERY_TREND_MAX_MONTHS} meses: limit_exceeded. ` +
          'Concessão parcial marca coverage.kind=partial. Detalhe por tipo de um cliente: get_client_delivery_history.',
        query: [
          { name: 'from', required: false, schema: { type: 'string', pattern: DELIVERY_MONTH_PATTERN.source } },
          { name: 'to', required: false, schema: { type: 'string', pattern: DELIVERY_MONTH_PATTERN.source } },
        ],
      }),
      '/get_workflow': readOperationPaths({
        operationId: 'get_workflow',
        summary: 'Etapas da esteira de uma lista ou pasta: ordem, tipo e origem',
        inputRef: 'GetWorkflowInput',
        responseRef: 'GetWorkflowResponse',
        example: GET_WORKFLOW_EXAMPLE,
        description:
          'Informe exatamente um: listId ou folderId (uuid); os dois ou nenhum é invalid_input. ' +
          'isProduction (F40, só para lista; null para pasta) diz se a lista é de PRODUÇÃO — a esteira tem a etapa "atribuir demanda" —, e nela create_task exige type (video, arte, foto, outros). ' +
          'stages vem em ordem (sortOrder) com o tipo de cada etapa (open, unstarted, custom, done, closed); inheritedFrom diz se a esteira é da própria lista, da pasta ou do espaço, e owner é quem a guarda. ' +
          'Para uma pasta, é a esteira da pasta (ou a do espaço, se ela não tem uma); uma lista dentro dela ainda pode ter esteira própria. ' +
          'AVISO: os ids das etapas MUDAM quando a esteira da pasta é alterada (ideworks.folder_workflow recria as etapas); não guarde ids de etapa entre conversas e releia get_workflow antes de mover tarefas. ' +
          'Sem boards:read a recusa é permission_denied; lista ou pasta inexistente, fora do recorte ou de empresa omitida é not_found.',
        query: [
          { name: 'listId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'folderId', required: false, schema: { type: 'string', format: 'uuid' } },
        ],
        extraErrors: ['404'],
      }),
      '/get_delivery_status': readOperationPaths({
        operationId: 'get_delivery_status',
        summary: 'Última entrega e peças vencidas de cada cliente ativo, pela Semanal',
        inputRef: 'GetDeliveryStatusInput',
        responseRef: 'GetDeliveryStatusResponse',
        example: GET_DELIVERY_STATUS_EXAMPLE,
        description:
          'Fonte = a aba Semanal (peças com dia marcado e ✓), não as tarefas do quadro; é o mesmo número do cartão do Painel. ' +
          'Só clientes ATIVOS: cliente cancelado não aparece, nem pelo clientId. ' +
          'lastDeliveryOn é o dia MARCADO da peça com ✓ mais recente até hoje (não o dia do clique no ✓); peça adiantada (✓ com dia futuro) ainda não é entrega e aparece em nextScheduledOn. ' +
          'overdueCount/overdueDays = peças sem ✓ com dia antes de hoje, sem corte de meses; dueToday = sem ✓ marcadas para hoje (não são vencidas); unscheduled = peças do mês corrente sem dia. Hoje é o dia de São Paulo (today). ' +
          'activeClients é o total de clientes ativos no alcance (no filtro inteiro). Concessão parcial marca coverage.kind=partial e não é a carteira toda. ' +
          'Para entrega por cota (nível do mês) use get_delivery_report. ' +
          'clientId filtra; limit (até 100) e cursor paginam, e o orçamento de 64 KiB também corta com nextCursor. ' +
          'Exige reports:delivery:read (sem ela: permission_denied); clientId fora do recorte, inexistente, cancelado ou de empresa omitida dá a mesma recusa.',
        query: [
          { name: 'clientId', required: false, schema: { type: 'string', minLength: 1 } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_planning_weeks': readOperationPaths({
        operationId: 'get_planning_weeks',
        summary: 'O mês de cada cliente por semana: cota, meta, entregue e o que falta, por responsável',
        inputRef: 'GetPlanningWeeksInput',
        responseRef: 'GetPlanningWeeksResponse',
        example: GET_PLANNING_WEEKS_EXAMPLE,
        description:
          'É a aba Semana do Planejamento: as semanas do mês (weeks) e, por cliente e tipo de conteúdo, a cota, a meta de cada semana (a cota dividida pelos dias úteis, soma = cota), o concluído, o agendado, o atrasado e o que falta; state é o mesmo da tela (bateu, risco, abaixo, andamento, futura, neutra) e depende de today, o dia da agência. ' +
          'A peça conta na semana em que está agendada, não na que foi concluída. Sem peça com dia, withoutDay; fora do mês, outsideMonth. ' +
          'quotaSource diz se a cota é do contrato do mês (aberto) ou do cadastro de hoje (mês não aberto). groups agrupa os clientes da página por responsável (pasta ou pessoa); quem tem dois aparece nos dois. ' +
          'Cliente sem cota e sem peça no mês fica de fora e é contado em omittedWithoutQuota; mês sem nenhum cliente a planejar devolve clients vazio, não erro. ' +
          'month em AAAA-MM; sem ele, o mês atual da agência. clientId e ownerId filtram; limit (até 100) e cursor paginam, e o orçamento de 64 KiB também corta com nextCursor. ' +
          'Exige reports:delivery:read (sem ela: permission_denied); clientId fora do recorte, inexistente, inativo ou de empresa omitida dá a mesma recusa.',
        query: [
          { name: 'month', required: false, schema: { type: 'string', pattern: DELIVERY_MONTH_PATTERN.source } },
          { name: 'clientId', required: false, schema: { type: 'string', minLength: 1 } },
          { name: 'ownerId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_month_attention': readOperationPaths({
        operationId: 'get_month_attention',
        summary: 'Quais clientes estão atrás neste mês: ritual, contrato por tipo e motivos de atenção',
        inputRef: 'GetMonthAttentionInput',
        responseRef: 'GetMonthAttentionResponse',
        example: GET_MONTH_ATTENTION_EXAMPLE,
        description:
          'É a lista "Precisa de atenção" da visão Contrato do Planejamento, pelas MESMAS funções da tela (planejarMes, listaDeAtencao, agruparMesPorResponsavel). ' +
          'Por cliente ativo: stage/stageLabel (mês não aberto, aberto, planejado, aprovado) com quando e por quem (ritual; planningDoneBy/clientApprovedBy só com people:read), hasContract, e por tipo o contrato repartido em seis baldes que somam o contrato (delivered, scheduled, late, outsideMonth, withoutDay, notCreated) mais extras fora da conta, e reasons (key, text, weight) com a frase pronta. ' +
          'Cliente sem contrato nunca tem motivo. Fora do mês atual não há "esta semana" nem "semana passada" (week e currentWeek nulos). ' +
          'summary conta o filtro inteiro (clientes, com contrato, precisando de atenção, por estágio e por motivo); clients vem com quem precisa de atenção primeiro (motivo mais pesado, depois o nome) e, com onlyAttention=true, só eles. ' +
          'groups agrupa os clientes DA PÁGINA por responsável (pasta/time ou pessoa; quem tem dois aparece nos dois). Cliente cancelado e empresa omitida não aparecem. ' +
          'month em AAAA-MM; sem ele, o mês atual da agência. clientId e ownerId filtram; limit (até 100) e cursor paginam, e o orçamento de 64 KiB também corta com nextCursor. ' +
          'Exige reports:delivery:read (sem ela: permission_denied); clientId fora do recorte, inexistente, cancelado ou de empresa omitida dá a mesma recusa.',
        query: [
          { name: 'month', required: false, schema: { type: 'string', pattern: DELIVERY_MONTH_PATTERN.source } },
          { name: 'clientId', required: false, schema: { type: 'string', minLength: 1 } },
          { name: 'ownerId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'onlyAttention', required: false, schema: { type: 'boolean' } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_client_month': readOperationPaths({
        operationId: 'get_client_month',
        summary: 'O mês de um cliente: contrato, ritual, medidor e cada peça pelo nome',
        inputRef: 'GetClientMonthInput',
        responseRef: 'GetClientMonthResponse',
        example: GET_CLIENT_MONTH_EXAMPLE,
        description:
          'Para responder QUAL peça falta (get_month_attention diz quantas): client traz o ritual e os motivos de atenção como em get_month_attention; contract é o contrato do mês (congelado se o mês abriu, senão a cota do cadastro de hoje); meter é o medidor da ficha do cliente (a mesma fórmula calculateDeliveryLevel) ou o motivo de não medir; pieces são todas as peças do mês de competência com id, nome, título, tipo, dia (como a Semanal o conta), done (✓), extra, signal (feita, agendada, atrasada) e a semana. ' +
          'Peça sem dia vem por último. month em AAAA-MM; sem ele, o mês atual da agência. Nome de pessoa (quem planejou/aprovou, responsável da carteira) só com people:read; o link de aprovação do cliente nunca vem. ' +
          'Exige reports:delivery:read (sem ela: permission_denied); clientId fora do recorte, inexistente, cancelado ou de empresa omitida dá a mesma recusa.',
        query: [
          { name: 'clientId', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'month', required: false, schema: { type: 'string', pattern: DELIVERY_MONTH_PATTERN.source } },
        ],
      }),
      '/get_calendar': readOperationPaths({
        operationId: 'get_calendar',
        summary: 'Calendário editorial: peças com dia e compromissos de um período',
        inputRef: 'GetCalendarInput',
        responseRef: 'GetCalendarResponse',
        example: GET_CALENDAR_EXAMPLE,
        description:
          'As peças com dia marcado (delivery: tipo, título, done, extra) e os compromissos (appointment: reunião, gravação, viagem, com hora quando há; sem as observações) de todos os clientes do recorte ou de um (clientId). ' +
          `from e to em AAAA-MM-DD, fechados nas duas pontas, de até ${CALENDAR_MAX_DAYS} dias (acima: limit_exceeded; from depois de to ou data impossível: invalid_input). O dia é o de São Paulo. ` +
          'Por dia; dentro do dia, quem tem hora vem antes, depois o nome do cliente. summary conta o período inteiro; limit (até 100) e cursor paginam, e o orçamento de 64 KiB também corta com nextCursor. ' +
          'Só cliente ativo (cliente cancelado não aparece) e fora da empresa omitida. Exige reports:delivery:read (sem ela: permission_denied); clientId fora do recorte, inexistente, cancelado ou de empresa omitida dá a mesma recusa.',
        query: [
          { name: 'from', required: true, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
          { name: 'to', required: true, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
          { name: 'clientId', required: false, schema: { type: 'string', minLength: 1 } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/list_tags': readOperationPaths({
        operationId: 'list_tags',
        summary: 'Etiquetas de um espaço (ou do espaço de uma lista), com os ids de tagIds',
        inputRef: 'ListTagsInput',
        responseRef: 'ListTagsResponse',
        example: LIST_TAGS_EXAMPLE,
        description:
          'Informe exatamente um: spaceId ou listId (uuid); os dois ou nenhum é invalid_input. A etiqueta mora no espaço; com listId vale o espaço da lista (e list vem preenchida). ' +
          'Cada etiqueta traz id (o que create_task e update_task aceitam em tagIds), nome e cores; ordem por nome, total antes da página, limit (até 100) e cursor. ' +
          'Exige boards:read (sem ela: permission_denied); espaço ou lista inexistente, fora do recorte ou de empresa omitida é not_found. As etiquetas atuais de uma tarefa vêm em get_task (tags).',
        query: [
          { name: 'spaceId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'listId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
        extraErrors: ['404'],
      }),
      '/list_clients': readOperationPaths({
        operationId: 'list_clients',
        summary: 'A carteira ativa: plano, urgência, financeiro, renovação e etiquetas de cada cliente',
        inputRef: 'ListClientsInput',
        responseRef: 'ListClientsResponse',
        example: LIST_CLIENTS_EXAMPLE,
        description:
          'Uma linha por cliente ATIVO do recorte, por nome, com o que o cadastro diz: empresa, plan, urgency (paz, alerta, perigo), startedOn, renewsOn e tags. NUNCA contato (telefone, e-mail, CNPJ, endereço, responsável do cliente). ' +
          'Cliente cancelado não aparece (para ele, search pelo nome e get_client). Filtros companyId (uuid), urgency e q (parte do nome, sem acento nem caixa); total conta o filtro inteiro; limit (até 100) e cursor paginam, e o orçamento de 64 KiB também corta com nextCursor. ' +
          'Exige clients:read (sem ela: permission_denied); empresa omitida e clientes fora da conexão nunca aparecem. A cota vigente por tipo vem em get_client; a entrega do mês, em get_month_attention.',
        query: [
          { name: 'companyId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'urgency', required: false, schema: { type: 'string', enum: [...CLIENT_URGENCIES] } },
          { name: 'q', required: false, schema: { type: 'string', minLength: 1, maxLength: 100 } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/list_boards': readOperationPaths({
        operationId: 'list_boards',
        summary: 'As listas do recorte com espaço, pasta, cliente, "exige cliente" e produção',
        inputRef: 'ListBoardsInput',
        responseRef: 'ListBoardsResponse',
        example: LIST_BOARDS_EXAMPLE,
        description:
          'Uma linha por LISTA, por espaço, pasta e nome: space, folder, company, client (o nome exige clients:read), requiresClient (lista compartilhada: create_task exige clientId), isProduction (create_task exige type) e archived. É de onde saem os listId de get_board, get_workflow, create_task e list_tasks. ' +
          'Filtros companyId, spaceId, folderId, clientId (uuid) e includeArchived (padrão: só as vivas); total conta o filtro inteiro; limit (até 100) e cursor paginam, e o orçamento de 64 KiB também corta com nextCursor. ' +
          'Lista de cliente cancelado e de empresa omitida não aparecem. Exige boards:read (sem ela: permission_denied).',
        query: [
          { name: 'companyId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'spaceId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'folderId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'clientId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'includeArchived', required: false, schema: { type: 'boolean' } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/list_tasks': readOperationPaths({
        operationId: 'list_tasks',
        summary: 'Tarefas do recorte com filtro: por lista, pasta, espaço, responsável, criador, etapa, tipo, prazo e cliente',
        inputRef: 'ListTasksInput',
        responseRef: 'ListTasksResponse',
        example: LIST_TASKS_EXAMPLE,
        description:
          'Cobre "atrasadas da pasta X" e "o que a Carla criou" sem varrer lista por lista. No máximo um de spaceId, folderId ou listId (nenhum = todo o recorte); os demais filtros somam: assigneeId e createdBy (exigem people:read), statusType, type, dueBefore (prazo antes do dia, exclusivo), overdue (prazo antes de hoje em São Paulo e sem conclusão), clientId e completed. ' +
          'Cada tarefa traz etapa (nome e tipo), prioridade, tipo, prazos, a lista (o nome exige boards:read), o cliente (o nome exige clients:read) e os responsáveis (nulos sem people:read). Só tarefa não arquivada, de cliente ativo, de empresa que a conexão alcança (empresa omitida e cliente fora da conexão nunca aparecem). ' +
          'Por título; total conta o filtro inteiro; limit (até 100) e cursor paginam, e o orçamento de 64 KiB também corta com nextCursor. Exige tasks:read (sem ela: permission_denied); lista, pasta ou espaço inexistente ou fora do recorte é not_found.',
        query: [
          { name: 'spaceId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'folderId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'listId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'assigneeId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'createdBy', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'statusType', required: false, schema: { type: 'string', enum: [...STATUS_TYPES] } },
          { name: 'type', required: false, schema: { type: 'string', enum: [...TASK_DEMAND_TYPES] } },
          { name: 'dueBefore', required: false, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
          { name: 'overdue', required: false, schema: { type: 'boolean' } },
          { name: 'clientId', required: false, schema: { type: 'string', format: 'uuid' } },
          { name: 'completed', required: false, schema: { type: 'boolean' } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
        extraErrors: ['404'],
      }),
      '/get_marketing_report': readOperationPaths({
        operationId: 'get_marketing_report',
        summary: 'Orgânico e pago já coletados, com origem e cobertura explícitas',
        inputRef: 'GetMarketingReportInput',
        responseRef: 'GetMarketingReportResponse',
        example: GET_MARKETING_REPORT_EXAMPLE,
        description:
          'Reusa @/meta/relatorio. Não dispara coleta. Alcance e contas engajadas: kind=approximate, distinctPeople=false (média/pico, não pessoas únicas do período). ' +
          'Buraco na série é null com status absent; zero coletado é 0 com status present. CTR com denominador 0 é null, não 0%. ' +
          'Moedas se agrupam; não se somam nem se assume BRL. Período acima de TETO_DE_DIAS (800): limit_exceeded, sem recorte silencioso. ' +
          'collectedAt é a última coleta conhecida, distinta de queriedAt. Sem reports:marketing:read: permission_denied. ' +
          'Concessão parcial marca coverage.kind=partial e não devolve totais globais. ' +
          'Cliente cancelado segue a regra de período: a conta ligada a ele entra se o período alcança o mês do cancelamento, e só com os dias até esse mês, inclusive; a janela de hoje não a traz.',
        query: [
          { name: 'from', required: false, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
          { name: 'to', required: false, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        ],
      }),
      '/add_comment': writeOperationPath({
        operationId: 'add_comment',
        summary: 'Publicar comentário ou resposta com autoria da integração',
        inputRef: 'AddCommentInput',
        responseRef: 'AddCommentResponse',
        example: ADD_COMMENT_EXAMPLE,
        description:
          'Autor = dono da concessão. Sem comments:write: permission_denied. Resposta a comentário de outra tarefa: state_conflict. ' +
          'O registro de execução não guarda o corpo. Replay da mesma chave devolve o mesmo commentId.',
      }),
      '/preview_move': writeOperationPath({
        operationId: 'preview_move',
        summary: 'Prévia do movimento sem escrever',
        inputRef: 'PreviewMoveInput',
        responseRef: 'PreviewMoveResponse',
        example: PREVIEW_MOVE_EXAMPLE,
        description:
          'Exige listId/statusId vistos na origem. Sem etapa equivalente devolve status_choice_required com as opções, sem escolher a primeira. ' +
          'Não grava tarefa nem execução. Sem tasks:move: permission_denied.',
      }),
      '/move_task': writeOperationPath({
        operationId: 'move_task',
        summary: 'Mover card preservando etapa, subtarefas e automação',
        inputRef: 'MoveTaskInput',
        responseRef: 'MoveTaskResponse',
        example: MOVE_TASK_EXAMPLE,
        description:
          'Usa runAgentWrite + moveTaskOnBoardInTx no mesmo Tx. Origem divergente: state_conflict. ' +
          'Sem equivalente: status_choice_required e zero escrita. Automação fora da concessão recusa tudo. ' +
          'approved: true no modelo não substitui a prévia persistida. Replay não dispara a automação de novo.',
      }),
      '/create_task': writeOperationPath({
        operationId: 'create_task',
        summary: 'Criar tarefa numa lista, com prazo, prioridade, etiquetas e responsáveis opcionais',
        inputRef: 'CreateTaskInput',
        responseRef: 'CreateTaskResponse',
        example: CREATE_TASK_EXAMPLE,
        description:
          'Exige tasks:write; responsáveis na criação exigem também tasks:assign (sem ela, permission_denied — não se ignora em silêncio). ' +
          'A etapa inicial é a primeira que abre na esteira da lista, ou a que statusId indicar (F38: use um statusId de get_workflow da lista; etapa de outra lista devolve status_choice_required com as opções e nada é criado; etapa do tipo concluída nasce concluída). No ensaio, taskId é nulo e task.statusId/task.completed mostram a etapa escolhida. ' +
          'type (F40): o tipo da demanda (video, arte, foto, outros). É OBRIGATÓRIO em lista de PRODUÇÃO — a esteira tem a etapa "atribuir demanda"; get_workflow devolve isProduction: true para ela — e opcional nas demais. Sem ele, em lista de produção: type_required (HTTP 400) com a frase da tela e options [{value, label}] dos quatro tipos, e nada é criado; repita o pedido com type. Subtarefa não tem tipo: type com parentId é invalid_input. O ensaio mostra o tipo em task.type. ' +
          'clientId (F38): em lista de cliente a tarefa herda o cliente da lista; em lista compartilhada é obrigatório (sem ele, invalid_input "Esta lista é compartilhada: informe o cliente (clientId de search)"); em lista interna, opcional. Cliente cancelado: invalid_input com a data; fora do alcance ou do recorte: permission_denied. ' +
          'parentId (F38): cria SUBTAREFA da tarefa-mãe (id de get_task/get_board). Ela nasce na lista da mãe e herda o cliente dela; listId fica opcional e, se vier, tem de ser o da mãe; clientId, se vier, tem de ser o da mãe (senão invalid_input). statusId é validado na esteira da lista da mãe. Mãe fora do alcance: not_found; fora do recorte: permission_denied; arquivada: state_conflict; de cliente cancelado: invalid_input. Subtarefa de subtarefa é aceita. A resposta traz parentId. ' +
          TASK_WRITE_NOTES,
      }),
      '/update_task': writeOperationPath({
        operationId: 'update_task',
        summary: 'Editar título, descrição, prazo, início, prioridade, tipo ou etiquetas',
        inputRef: 'UpdateTaskInput',
        responseRef: 'UpdateTaskResponse',
        example: UPDATE_TASK_EXAMPLE,
        description:
          'Exige tasks:write. Só os campos enviados mudam; null limpa. type (F40) troca o tipo da demanda (video, arte, foto, outros); null apaga, e em lista de produção apagar o tipo que a tarefa já tem é type_required com as opções. O desfazer em lote volta o tipo anterior. Etapa é move_task; responsáveis, assign_task; conclusão, complete_task/reopen_task. ' +
          'Edição de título e descrição não se desfaz pela tela. ' +
          TASK_WRITE_NOTES,
      }),
      '/get_admin_week': readOperationPaths({
        operationId: 'get_admin_week',
        summary: 'O painel de controle da semana dos admins (para atribuir, andamento, faltando)',
        inputRef: 'GetAdminWeekInput',
        responseRef: 'GetAdminWeekResponse',
        example: GET_ADMIN_WEEK_EXAMPLE,
        description:
          'Só para administrador: exige a concessão de um admin com boards:read e tasks:read; para os demais é permission_denied. ' +
          'É a MESMA leitura da tela Controle da semana (GET /admin/semana), com a mesma regra. week (AAAA-MM-DD, qualquer dia) vira a segunda-feira dela; sem week, a semana atual. ' +
          'toAssign = cards em "atribuir demanda" com prazo na semana (mais os sem data, só na semana atual), por cliente e tipo; progress = quantos cards da semana estão em atribuir, por fazer, em andamento e feitos; missing.items = meta da semana contra cards na semana, e missing.overdue = os atrasados (até 200, overdueTotal é o total). Cliente cancelado e empresa omitida ficam de fora. ' +
          'Vale o recorte de empresas e clientes da conexão. Sem clients:read o nome do cliente vem null; sem people:read, createdBy vem null e assignees vazio.',
        query: [{ name: 'week', required: false, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }],
      }),
      '/release_task': writeOperationPath({
        operationId: 'release_task',
        summary: 'Liberar a demanda: pessoas e prazo, e o card sai de "atribuir demanda" para a fila do tipo',
        inputRef: 'ReleaseTaskInput',
        responseRef: 'ReleaseTaskResponse',
        example: RELEASE_TASK_EXAMPLE,
        description:
          'Só para administrador, e exige tasks:assign, tasks:write e tasks:move (as três): é o botão OK do painel Controle da semana. ' +
          'Numa transação só grava os responsáveis e o prazo e move o card para a etapa do tipo (video → "a fazer video", arte → "a fazer arte", foto e outros → "a fazer"), na mesma lista. ' +
          'Recusas: type_required (card sem tipo, com as opções), assignee_required, due_required, already_released (o card já saiu de "atribuir demanda"; a frase diz quem e quando), stage_missing (a lista não tem a etapa de destino; a frase diz qual) e permission_denied (não admin, ou concessão sem uma das três). ' +
          'O desfazer em lote devolve o card para "atribuir demanda", sem os responsáveis e com o prazo de antes. Fica no registro como assign_task, com changes.released. ' +
          TASK_WRITE_NOTES,
      }),
      '/assign_task': writeOperationPath({
        operationId: 'assign_task',
        summary: 'Definir a lista final de responsáveis da tarefa',
        inputRef: 'AssignTaskInput',
        responseRef: 'AssignTaskResponse',
        example: ASSIGN_TASK_EXAMPLE,
        description:
          'Exige tasks:assign. assigneeIds substitui a lista atual; [] tira todos. Achar a pessoa pelo nome é list_people, que exige people:read. ' +
          TASK_WRITE_NOTES,
      }),
      '/complete_task': writeOperationPath({
        operationId: 'complete_task',
        summary: 'Concluir a tarefa (vai para a etapa que fecha)',
        inputRef: 'CompleteTaskInput',
        responseRef: 'CompleteTaskResponse',
        example: COMPLETE_TASK_EXAMPLE,
        description:
          'Exige tasks:complete. A automação da etapa que fecha roda, como no arrasto do card. Tarefa já concluída: state_conflict. ' + TASK_WRITE_NOTES,
      }),
      '/reopen_task': writeOperationPath({
        operationId: 'reopen_task',
        summary: 'Reabrir a tarefa concluída (volta para a primeira etapa que abre)',
        inputRef: 'ReopenTaskInput',
        responseRef: 'ReopenTaskResponse',
        example: REOPEN_TASK_EXAMPLE,
        description:
          'Exige tasks:complete. A automação da primeira etapa que abre roda, como no arrasto do card. Tarefa que já está aberta: state_conflict, sem mexer na etapa. ' + TASK_WRITE_NOTES,
      }),
      '/get_client_mural': readOperationPaths({
        operationId: 'get_client_mural',
        summary: 'Notas do mural de um cliente acessível, das mais novas para as mais antigas',
        inputRef: 'GetClientMuralInput',
        responseRef: 'GetClientMuralResponse',
        example: GET_CLIENT_MURAL_EXAMPLE,
        description:
          'Exige clients:read. Cliente fora do recorte: permission_denied. Autor só com people:read. viaName = conexão de IA que criou a nota (nulo = pessoa); ' +
          'agentEditable diz se esta conexão pode editá-la. Orçamento 64 KiB, continua por cursor.',
        query: [
          { name: 'clientId', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/get_client_history': readOperationPaths({
        operationId: 'get_client_history',
        summary: 'Registros do histórico de um cliente acessível, do fato mais recente para o mais antigo',
        inputRef: 'GetClientHistoryInput',
        responseRef: 'GetClientHistoryResponse',
        example: GET_CLIENT_HISTORY_EXAMPLE,
        description:
          'Exige clients:read. Ordem por happenedOn (quando aconteceu), não pelo registro. Autor e quem conduziu (ledBy) só com people:read; ledByNote é texto livre. ' +
          'Documentos anexos: só a contagem, sem link. Orçamento 64 KiB, continua por cursor. ' +
          'query (opcional, 1 a 100 caracteres): filtra como a barra de busca do site — sem acento e sem diferença de maiúscula, várias palavras valem TODAS, ' +
          'procura em título, subtítulo, relato, quem conduziu (nome só com people:read), observação, origem, data (dd/mm/aaaa) e nome dos documentos; ' +
          '% _ e \\ valem como texto. Só espaços é invalid_input. Use a mesma query ao continuar por cursor.',
        query: [
          { name: 'clientId', required: true, schema: { type: 'string', minLength: 1 } },
          { name: 'query', required: false, schema: { type: 'string', minLength: 1, maxLength: 100 } },
          { name: 'limit', required: false, schema: { type: 'integer' } },
          { name: 'cursor', required: false, schema: { type: 'string' } },
        ],
      }),
      '/add_mural_note': writeOperationPath({
        operationId: 'add_mural_note',
        summary: 'Escrever uma nota no mural do cliente',
        inputRef: 'AddMuralNoteInput',
        responseRef: 'AddMuralNoteResponse',
        example: ADD_MURAL_NOTE_EXAMPLE,
        description:
          'Exige clients:mural:write. Cor: yellow (padrão), green, blue ou red. No ensaio, noteId é nulo. ' + CLIENT_RECORD_WRITE_NOTES,
      }),
      '/update_mural_note': writeOperationPath({
        operationId: 'update_mural_note',
        summary: 'Editar título, texto ou cor de uma nota que a IA escreveu',
        inputRef: 'UpdateMuralNoteInput',
        responseRef: 'UpdateMuralNoteResponse',
        example: UPDATE_MURAL_NOTE_EXAMPLE,
        description:
          'Exige clients:mural:write. Só os campos enviados mudam; title null tira o título. ' + CLIENT_RECORD_WRITE_NOTES,
      }),
      '/add_history_entry': writeOperationPath({
        operationId: 'add_history_entry',
        summary: 'Registrar um fato no histórico do cliente',
        inputRef: 'AddHistoryEntryInput',
        responseRef: 'AddHistoryEntryResponse',
        example: ADD_HISTORY_ENTRY_EXAMPLE,
        description:
          'Exige clients:history:write. happenedOn é quando aconteceu. ledBy (pessoa do time, no recorte da concessão; achar pelo nome é list_people) ou ledByNote (texto livre). ' +
          'No ensaio, entryId é nulo. ' + CLIENT_RECORD_WRITE_NOTES,
      }),
      '/update_history_entry': writeOperationPath({
        operationId: 'update_history_entry',
        summary: 'Editar um registro do histórico que a IA escreveu',
        inputRef: 'UpdateHistoryEntryInput',
        responseRef: 'UpdateHistoryEntryResponse',
        example: UPDATE_HISTORY_ENTRY_EXAMPLE,
        description:
          'Exige clients:history:write. Só os campos enviados mudam; null limpa subtitle, ledBy e ledByNote. ' + CLIENT_RECORD_WRITE_NOTES,
      }),
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'OAuth' },
      },
      schemas: {
        GetContextInput: jsonSchemaFromZod(getContextInputSchema),
        GetContextResponse: jsonSchemaFromZod(getContextResponseSchema),
        SearchInput: jsonSchemaFromZod(searchInputSchema),
        SearchResponse: jsonSchemaFromZod(searchResponseSchema),
        GetBoardInput: jsonSchemaFromZod(getBoardInputSchema),
        GetBoardResponse: jsonSchemaFromZod(getBoardResponseSchema),
        GetWorkflowInput: jsonSchemaFromZod(getWorkflowInputSchema),
        GetWorkflowResponse: jsonSchemaFromZod(getWorkflowResponseSchema),
        GetTaskInput: jsonSchemaFromZod(getTaskInputSchema),
        GetTaskResponse: jsonSchemaFromZod(getTaskResponseSchema),
        GetClientInput: jsonSchemaFromZod(getClientInputSchema),
        GetClientResponse: jsonSchemaFromZod(getClientResponseSchema),
        ListCommentsInput: jsonSchemaFromZod(listCommentsInputSchema),
        ListCommentsResponse: jsonSchemaFromZod(listCommentsResponseSchema),
        ListPeopleInput: jsonSchemaFromZod(listPeopleInputSchema),
        ListPeopleResponse: jsonSchemaFromZod(listPeopleResponseSchema),
        GetPersonWorkInput: jsonSchemaFromZod(getPersonWorkInputSchema),
        GetPersonWorkResponse: jsonSchemaFromZod(getPersonWorkResponseSchema),
        GetDeliveryReportInput: jsonSchemaFromZod(getDeliveryReportInputSchema),
        GetDeliveryReportResponse: jsonSchemaFromZod(getDeliveryReportResponseSchema),
        GetClientDeliveryHistoryInput: jsonSchemaFromZod(getClientDeliveryHistoryInputSchema),
        GetClientDeliveryHistoryResponse: jsonSchemaFromZod(getClientDeliveryHistoryResponseSchema),
        GetDeliveryTrendInput: jsonSchemaFromZod(getDeliveryTrendInputSchema),
        GetDeliveryTrendResponse: jsonSchemaFromZod(getDeliveryTrendResponseSchema),
        GetPlanningWeeksInput: jsonSchemaFromZod(getPlanningWeeksInputSchema),
        GetPlanningWeeksResponse: jsonSchemaFromZod(getPlanningWeeksResponseSchema),
        GetDeliveryStatusInput: jsonSchemaFromZod(getDeliveryStatusInputSchema),
        GetDeliveryStatusResponse: jsonSchemaFromZod(getDeliveryStatusResponseSchema),
        GetMonthAttentionInput: jsonSchemaFromZod(getMonthAttentionInputSchema),
        GetMonthAttentionResponse: jsonSchemaFromZod(getMonthAttentionResponseSchema),
        GetClientMonthInput: jsonSchemaFromZod(getClientMonthInputSchema),
        GetClientMonthResponse: jsonSchemaFromZod(getClientMonthResponseSchema),
        GetCalendarInput: jsonSchemaFromZod(getCalendarInputSchema),
        GetCalendarResponse: jsonSchemaFromZod(getCalendarResponseSchema),
        ListTagsInput: jsonSchemaFromZod(listTagsInputSchema),
        ListTagsResponse: jsonSchemaFromZod(listTagsResponseSchema),
        ListClientsInput: jsonSchemaFromZod(listClientsInputSchema),
        ListClientsResponse: jsonSchemaFromZod(listClientsResponseSchema),
        ListBoardsInput: jsonSchemaFromZod(listBoardsInputSchema),
        ListBoardsResponse: jsonSchemaFromZod(listBoardsResponseSchema),
        ListTasksInput: jsonSchemaFromZod(listTasksInputSchema),
        ListTasksResponse: jsonSchemaFromZod(listTasksResponseSchema),
        GetAdminWeekInput: jsonSchemaFromZod(getAdminWeekInputSchema),
        GetAdminWeekResponse: jsonSchemaFromZod(getAdminWeekResponseSchema),
        GetMarketingReportInput: jsonSchemaFromZod(getMarketingReportInputSchema),
        GetMarketingReportResponse: jsonSchemaFromZod(getMarketingReportResponseSchema),
        AddCommentInput: jsonSchemaFromZod(addCommentInputSchema),
        AddCommentResponse: jsonSchemaFromZod(addCommentResponseSchema),
        PreviewMoveInput: jsonSchemaFromZod(previewMoveInputSchema),
        PreviewMoveResponse: jsonSchemaFromZod(previewMoveResponseSchema),
        MoveTaskInput: jsonSchemaFromZod(moveTaskInputSchema),
        MoveTaskResponse: jsonSchemaFromZod(moveTaskResponseSchema),
        CreateTaskInput: jsonSchemaFromZod(createTaskInputSchema),
        CreateTaskResponse: jsonSchemaFromZod(createTaskResponseSchema),
        UpdateTaskInput: jsonSchemaFromZod(updateTaskInputSchema),
        UpdateTaskResponse: jsonSchemaFromZod(updateTaskResponseSchema),
        ReleaseTaskInput: jsonSchemaFromZod(releaseTaskInputSchema),
        ReleaseTaskResponse: jsonSchemaFromZod(releaseTaskResponseSchema),
        AssignTaskInput: jsonSchemaFromZod(assignTaskInputSchema),
        AssignTaskResponse: jsonSchemaFromZod(assignTaskResponseSchema),
        CompleteTaskInput: jsonSchemaFromZod(completeTaskInputSchema),
        CompleteTaskResponse: jsonSchemaFromZod(completeTaskResponseSchema),
        ReopenTaskInput: jsonSchemaFromZod(reopenTaskInputSchema),
        ReopenTaskResponse: jsonSchemaFromZod(reopenTaskResponseSchema),
        GetClientMuralInput: jsonSchemaFromZod(getClientMuralInputSchema),
        GetClientMuralResponse: jsonSchemaFromZod(getClientMuralResponseSchema),
        GetClientHistoryInput: jsonSchemaFromZod(getClientHistoryInputSchema),
        GetClientHistoryResponse: jsonSchemaFromZod(getClientHistoryResponseSchema),
        AddMuralNoteInput: jsonSchemaFromZod(addMuralNoteInputSchema),
        AddMuralNoteResponse: jsonSchemaFromZod(addMuralNoteResponseSchema),
        UpdateMuralNoteInput: jsonSchemaFromZod(updateMuralNoteInputSchema),
        UpdateMuralNoteResponse: jsonSchemaFromZod(updateMuralNoteResponseSchema),
        AddHistoryEntryInput: jsonSchemaFromZod(addHistoryEntryInputSchema),
        AddHistoryEntryResponse: jsonSchemaFromZod(addHistoryEntryResponseSchema),
        UpdateHistoryEntryInput: jsonSchemaFromZod(updateHistoryEntryInputSchema),
        UpdateHistoryEntryResponse: jsonSchemaFromZod(updateHistoryEntryResponseSchema),
        StatusChoiceRequired: jsonSchemaFromZod(statusChoiceRequiredSchema),
        TypeRequired: jsonSchemaFromZod(typeRequiredSchema),
        IntegrationError: jsonSchemaFromZod(integrationErrorSchema),
      },
    },
  };
}

export function getContextOpenApiExample(): GetContextResponse {
  return GET_CONTEXT_EXAMPLE;
}

export function searchOpenApiExample(): SearchResponse {
  return SEARCH_EXAMPLE;
}

export function getWorkflowOpenApiExample(): GetWorkflowResponse {
  return GET_WORKFLOW_EXAMPLE;
}

export function getTaskOpenApiExample(): GetTaskResponse {
  return GET_TASK_EXAMPLE;
}

export function listPeopleOpenApiExample(): ListPeopleResponse {
  return LIST_PEOPLE_EXAMPLE;
}

export function getPersonWorkOpenApiExample(): GetPersonWorkResponse {
  return GET_PERSON_WORK_EXAMPLE;
}

export function getDeliveryReportOpenApiExample(): GetDeliveryReportResponse {
  return GET_DELIVERY_REPORT_EXAMPLE;
}

export function getClientDeliveryHistoryOpenApiExample(): GetClientDeliveryHistoryResponse {
  return GET_CLIENT_DELIVERY_HISTORY_EXAMPLE;
}

export function getDeliveryTrendOpenApiExample(): GetDeliveryTrendResponse {
  return GET_DELIVERY_TREND_EXAMPLE;
}

export function getPlanningWeeksOpenApiExample(): GetPlanningWeeksResponse {
  return GET_PLANNING_WEEKS_EXAMPLE;
}

export function getDeliveryStatusOpenApiExample(): GetDeliveryStatusResponse {
  return GET_DELIVERY_STATUS_EXAMPLE;
}

export function getMonthAttentionOpenApiExample(): GetMonthAttentionResponse {
  return GET_MONTH_ATTENTION_EXAMPLE;
}

export function getClientMonthOpenApiExample(): GetClientMonthResponse {
  return GET_CLIENT_MONTH_EXAMPLE;
}

export function getCalendarOpenApiExample(): GetCalendarResponse {
  return GET_CALENDAR_EXAMPLE;
}

export function listTagsOpenApiExample(): ListTagsResponse {
  return LIST_TAGS_EXAMPLE;
}

export function getClientOpenApiExample(): GetClientResponse {
  return GET_CLIENT_EXAMPLE;
}

export function listClientsOpenApiExample(): ListClientsResponse {
  return LIST_CLIENTS_EXAMPLE;
}

export function listBoardsOpenApiExample(): ListBoardsResponse {
  return LIST_BOARDS_EXAMPLE;
}

export function listTasksOpenApiExample(): ListTasksResponse {
  return LIST_TASKS_EXAMPLE;
}

export function getAdminWeekOpenApiExample(): GetAdminWeekResponse {
  return GET_ADMIN_WEEK_EXAMPLE;
}

export function releaseTaskOpenApiExample(): ReleaseTaskResponse {
  return RELEASE_TASK_EXAMPLE;
}

export function getMarketingReportOpenApiExample(): GetMarketingReportResponse {
  return GET_MARKETING_REPORT_EXAMPLE;
}

export function addCommentOpenApiExample(): AddCommentResponse {
  return ADD_COMMENT_EXAMPLE;
}

export function previewMoveOpenApiExample(): PreviewMoveResponse {
  return PREVIEW_MOVE_EXAMPLE;
}

export function moveTaskOpenApiExample(): MoveTaskResponse {
  return MOVE_TASK_EXAMPLE;
}

export function createTaskOpenApiExample(): CreateTaskResponse {
  return CREATE_TASK_EXAMPLE;
}

/** F38, Fase 6.4 — o `create_task` de subtarefa: a resposta traz a mãe. */
export function createSubtaskOpenApiExample(): CreateTaskResponse {
  return {
    ...CREATE_TASK_EXAMPLE,
    taskId: '44444444-4444-4444-8444-444444444444',
    parentId: '33333333-3333-4333-8333-333333333333',
  };
}

export function updateTaskOpenApiExample(): UpdateTaskResponse {
  return UPDATE_TASK_EXAMPLE;
}

export function assignTaskOpenApiExample(): AssignTaskResponse {
  return ASSIGN_TASK_EXAMPLE;
}

export function completeTaskOpenApiExample(): CompleteTaskResponse {
  return COMPLETE_TASK_EXAMPLE;
}

export function reopenTaskOpenApiExample(): ReopenTaskResponse {
  return REOPEN_TASK_EXAMPLE;
}

export function getClientMuralOpenApiExample(): GetClientMuralResponse {
  return GET_CLIENT_MURAL_EXAMPLE;
}

export function getClientHistoryOpenApiExample(): GetClientHistoryResponse {
  return GET_CLIENT_HISTORY_EXAMPLE;
}

export function addMuralNoteOpenApiExample(): AddMuralNoteResponse {
  return ADD_MURAL_NOTE_EXAMPLE;
}

export function updateMuralNoteOpenApiExample(): UpdateMuralNoteResponse {
  return UPDATE_MURAL_NOTE_EXAMPLE;
}

export function addHistoryEntryOpenApiExample(): AddHistoryEntryResponse {
  return ADD_HISTORY_ENTRY_EXAMPLE;
}

export function updateHistoryEntryOpenApiExample(): UpdateHistoryEntryResponse {
  return UPDATE_HISTORY_ENTRY_EXAMPLE;
}
