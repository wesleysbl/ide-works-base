/**
 * Leituras operacionais — F16.3b + F16.3c.
 *
 * Operações no mesmo módulo (teto de arquivos). A IDEIA vem dos
 * serviços atuais — quadro (`board.ts`), ficha (`board-task.ts`), cliente
 * (`client-detail.ts`), listas F17.84 (`client-board-lists.ts`), conversa,
 * e diretório (`readTeam` / `ideworks.team_directory()`). Não é a
 * administração de pessoas da F12.
 *
 * Recorte ANTES de contar, paginar e incluir relações. Pessoa visível
 * sem demanda é zero; pessoa fora do recorte é recusa — os dois não
 * compartilham envelope. O adaptador HTTP só valida o contrato e
 * despacha: autorização não se repete lá.
 *
 * Vitest bloqueia rede. O port recebe o recorte (empresas/clientes/
 * capacidades) e só devolve o que cabe. A suíte injeta `MemoryWorkCatalog`.
 */

import {
  GET_BOARD_PATH,
  GET_WORKFLOW_PATH,
  CLIENT_URGENCIES,
  LIST_BOARDS_PATH,
  diaValido,
  LIST_TASKS_INPUT_MESSAGE,
  LIST_TASKS_PATH,
  listBoardsResponseSchema,
  listTasksResponseSchema,
  type ListBoardsInput,
  type ListBoardsItem,
  type ListBoardsResponse,
  type ListTasksInput,
  type ListTasksItem,
  type ListTasksResponse,
  LIST_CLIENTS_PATH,
  LIST_TAGS_INPUT_MESSAGE,
  LIST_TAGS_PATH,
  listClientsResponseSchema,
  type ListClientsInput,
  type ListClientsItem,
  type ListClientsResponse,
  listTagsResponseSchema,
  listTagsTargetOf,
  type ListTagsInput,
  type ListTagsResponse,
  type ListTagsTarget,
  WORKFLOW_INPUT_MESSAGE,
  workflowTargetOf,
  getWorkflowResponseSchema,
  type GetWorkflowResponse,
  type TaskDemandType,
  type WorkflowOrigin,
  type WorkflowTarget,
  type GetWorkflowInput,
  CLIENT_HISTORY_QUERY_MAX,
  GET_CLIENT_HISTORY_PATH,
  GET_CLIENT_MURAL_PATH,
  GET_CLIENT_PATH,
  GET_PERSON_WORK_PATH,
  GET_TASK_PATH,
  GET_TASK_SUBTASKS_MAX,
  LIST_COMMENTS_PATH,
  LIST_PEOPLE_PATH,
  SEARCH_KINDS,
  SEARCH_PATH,
  getBoardResponseSchema,
  getClientHistoryResponseSchema,
  getClientMuralResponseSchema,
  getClientResponseSchema,
  getPersonWorkResponseSchema,
  getTaskResponseSchema,
  listCommentsResponseSchema,
  listPeopleResponseSchema,
  searchResponseSchema,
  type GetBoardResponse,
  type GetClientHistoryResponse,
  type GetClientMuralResponse,
  type GetClientResponse,
  type HistoryEntryItem,
  type MuralNoteColor,
  type MuralNoteItem,
  type GetPersonWorkResponse,
  type GetTaskResponse,
  type GetTaskSubtask,
  type TaskApprovalRound,
  type IntegrationErrorCode,
  type ListCommentsResponse,
  type ListPeopleResponse,
  type PersonDirectoryItem,
  type SearchHit,
  type SearchKind,
  type SearchResponse,
  type StatusType,
  type TaskPriority,
} from '@/integrations/contract';
import type { EventoDaTarefa } from '@/board/historico';
import { palavrasDaBusca, semAcento } from '@/clients/historico-busca';
import { TETOS_CHEIOS, TETOS_MINIMOS, TETOS_REDUZIDOS, projetarFicha, type FichaDaTarefa } from '@/integrations/task-ficha';
import { getContext, type IntegrationCompany } from '@/integrations/context';
import {
  companyAllowed,
  effectiveCapabilities,
  effectiveCompanies,
  grantIsLive,
  omittedIn,
  personReachesClient,
  projectTask,
  type CompanyScope,
  type IntegrationCapability,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import {
  PAGE_CURSOR_VERSION,
  RESPONSE_BUDGET_BYTES,
  decodePageCursor,
  encodePageCursor,
  fitItemsToBudget,
  measureJsonBytes,
  paginateStable,
  parsePageRequest,
  type Page,
  type PageCursor,
  type PageKey,
  type PageRequestError,
} from '@/integrations/page';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import { clienteDaTarefa } from '@/server/cliente-da-tarefa';
import type { ExecutionOrigin } from '@/server/db';

const KIND_CAPABILITY = {
  board: 'boards:read',
  task: 'tasks:read',
  client: 'clients:read',
  person: 'people:read',
} as const satisfies Record<SearchKind, IntegrationCapability>;

export type WorkScope = {
  companies: CompanyScope;
  clients: 'all' | 'none' | ReadonlySet<string>;
  capabilities: ReadonlySet<IntegrationCapability>;
};

export type WorkSearchHit = SearchHit;

export type WorkBoardView = {
  id: string;
  name: string;
  space: { id: string; name: string | null };
  folder: { id: string; name: string | null } | null;
  company: { id: string; name: string };
  client: { id: string; name: string | null } | null;
  columns: Array<{ id: string; name: string; sortOrder: number; total: number; type?: StatusType | null }>;
  tasks: Array<{
    id: string;
    title: string;
    statusId: string | null;
    priority?: TaskPriority | null;
    /** F40 — o tipo da demanda. */
    type?: TaskDemandType | null;
    startOn?: string | null;
    completedAt?: string | null;
    archivedAt?: string | null;
    client: { id: string; name: string } | null;
    people: Array<{ id: string; name: string }>;
  }>;
};

/**
 * F37 — a esteira de uma lista ou pasta. `null` no lugar desta visão = alvo
 * inexistente, fora do recorte ou de empresa omitida (tudo vira `not_found`).
 */
export type WorkWorkflowView = GetWorkflowResponse['workflow'];

/** G11 — uma lista do recorte, crua: o cliente leva o nome e quem o esconde sem `clients:read` é `listBoardsWork`. */
export type WorkBoardRow = {
  id: string;
  name: string;
  space: { id: string; name: string | null };
  folder: { id: string; name: string | null } | null;
  company: { id: string; name: string };
  client: { id: string; name: string | null } | null;
  requiresClient: boolean;
  isProduction: boolean;
  archived: boolean;
};

/** G11 — o filtro de `list_tasks`, já com o "hoje" de São Paulo resolvido por quem chama. */
export type WorkTaskFilters = {
  container?: { kind: 'space' | 'folder' | 'list'; id: string };
  assigneeId?: string;
  createdBy?: string;
  statusType?: StatusType;
  type?: TaskDemandType;
  dueBefore?: string;
  overdue?: boolean;
  /** `AAAA-MM-DD`, o que `overdue` compara com o prazo. */
  today: string;
  clientId?: string;
  completed?: boolean;
};

/** G11 — uma tarefa listada; o nome de lista e cliente já vem pelas capacidades, os responsáveis só se `people:read` (senão vazio). */
export type WorkListedTask = Omit<ListTasksItem, 'people'> & { people: Array<{ id: string; name: string }> };

/** G7 — as etiquetas de um espaço, com o espaço e a lista de onde se chegou a ele. */
export type WorkTagsView = {
  space: { id: string; name: string | null; company: { id: string; name: string } };
  list: { id: string; name: string | null } | null;
  /** Por nome (minúsculas, sem espaços nas pontas), e o id desempata. */
  tags: Array<{ id: string; name: string; bgColor: string | null; fgColor: string | null }>;
};

export type WorkTaskView = {
  id: string;
  title: string;
  description: string | null;
  dueOn: string | null;
  statusId: string | null;
  statusType?: StatusType | null;
  priority?: TaskPriority | null;
  /** F40 — o tipo da demanda. */
  type?: TaskDemandType | null;
  startOn?: string | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  board: { id: string; name: string | null } | null;
  client: { id: string; name: string } | null;
  people: Array<{ id: string; name: string }>;
  comments: Array<{ id: string; body: string; fromClient?: boolean }>;
  /**
   * F42, Fase 7 — as rodadas de aprovação do cliente, a mais nova primeiro, com
   * os comentários do cliente SEMPRE preenchidos aqui: quem corta (sem
   * `comments:read` → `null`) é `getTaskWork`. Nunca o token nem o link do cliente.
   */
  approvalRounds?: TaskApprovalRound[];
  /**
   * F38, Fase 6.4 — as subtarefas diretas, não arquivadas e no recorte, na
   * ordem de criação, até `GET_TASK_SUBTASKS_MAX`. `subtaskTotal` conta todas.
   */
  subtasks?: GetTaskSubtask[];
  subtaskTotal?: number;
  /*
   * G6 — a ficha inteira, CRUA: quem corta por capacidade é `projetarFicha`
   * (`task-ficha.ts`). Ausente = o catálogo não trouxe o grupo (campo ausente no
   * `get_task`, nunca "vazio"). O nome de pasta e espaço já sai projetado pelo
   * catálogo (`boards:read`), como o do quadro.
   */
  tags?: Array<{ id: string; name: string; bgColor: string | null; fgColor: string | null }>;
  watchers?: Array<{ id: string; name: string }>;
  /** A mãe, se há e está no recorte; `null` = não é subtarefa (ou a mãe está fora). */
  parent?: { id: string; title: string } | null;
  checklists?: Array<{
    id: string;
    name: string;
    items: Array<{
      id: string;
      name: string;
      parentItemId: string | null;
      resolvedAt: string | null;
      assignee: { id: string; name: string } | null;
    }>;
  }>;
  /** Todos os itens de checklist da tarefa, antes do teto do catálogo. */
  checklistItemTotal?: number;
  links?: Array<{ id: string; label: string; url: string }>;
  linkTotal?: number;
  /** Do mais antigo ao mais novo, os nomes já resolvidos. */
  history?: EventoDaTarefa[];
  createdBy?: { id: string; name: string } | null;
  completedBy?: { id: string; name: string } | null;
  createdVia?: string | null;
  createdAt?: string | null;
  folder?: { id: string; name: string | null } | null;
  space?: { id: string; name: string | null } | null;
};

/** G5 — a ficha do cadastro de um cliente ativo. NUNCA contato (telefone, e-mail, CNPJ, endereço, responsável do cliente). */
export type WorkClientProfile = {
  plan: { id: string; name: string } | null;
  urgency: (typeof CLIENT_URGENCIES)[number];
  startedOn: string | null;
  renewsOn: string | null;
  tags: Array<{ id: string; name: string; color: string | null }>;
};

export type WorkActiveClientView = Partial<WorkClientProfile> & {
  id: string;
  name: string;
  company: { id: string; name: string };
  /** G5 — a cota vigente por tipo (a de hoje, não a do mês). */
  quotas?: Array<{ type: 'video' | 'arte' | 'foto' | 'ads'; quantity: number }>;
  lists: Array<{
    id: string;
    name: string | null;
    archived: boolean;
    space: { id: string; name: string | null };
    folder: { id: string; name: string | null } | null;
  }>;
};

/**
 * F38, Fase 4 — a ficha de um cliente CANCELADO (`is_active = false`): só a
 * identificação e o dia do cancelamento (`inactive_at` no fuso de São Paulo).
 * Nada da carteira atual (empresa, listas) sai por aqui.
 */
/** G5 — uma linha da carteira ativa (`list_clients`). */
export type WorkClientSummary = Pick<ListClientsItem, 'id' | 'name' | 'company'> & WorkClientProfile;

export type WorkCancelledClientView = {
  id: string;
  name: string;
  cancelled: true;
  cancelledOn: string | null;
};

export type WorkClientView = WorkActiveClientView | WorkCancelledClientView;

/**
 * F38, Fase 4 — quando um cliente CANCELADO volta na busca.
 *
 * A busca por cliente ativo é "o texto aparece no nome". Para o cancelado ela
 * é mais estrita: o texto (sem acento, sem caixa, pontas aparadas) tem de ser
 * o COMEÇO do nome e terminar numa fronteira de palavra. "Zeca" acha "Zeca
 * Hamburgueria"; "Cris" e "Cida Enxovais" acham "Cida Enxovais"; "enxovais"
 * NÃO acha "Cida Enxovais" (o nome não começa por ela) e "zap" não acha nada
 * (para no meio da palavra). Assim uma palavra genérica do ramo não despeja os
 * cancelados na resposta, e quem pergunta por um deles pelo nome o encontra.
 *
 * O SQL (`SqlWorkCatalog.search`) escreve a mesma regra; os dois lados tiram
 * acento das mesmas letras latinas.
 */
export function cancelledNameMatches(name: string, query: string): boolean {
  const needle = semAcento(query.trim());
  if (needle.length === 0) return false;
  const hay = semAcento(name);
  if (!hay.startsWith(needle)) return false;
  if (hay.length === needle.length) return true;
  return !/[a-z0-9]/.test(hay.charAt(needle.length));
}

/** `AAAA-MM-DD` → `dd/mm/aaaa`, o texto que a pessoa lê. */
export function cancelledDetail(cancelledOn: string | null): string {
  if (!cancelledOn) return 'cancelado';
  const [ano, mes, dia] = cancelledOn.split('-');
  return `cancelado em ${dia}/${mes}/${ano}`;
}

export type WorkCommentView = {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
  /** F42: escrito pelo cliente no link de aprovação. */
  fromClient?: boolean;
};

export type WorkPersonView = PersonDirectoryItem;

export type WorkPersonTaskView = {
  id: string;
  title: string;
  statusId: string | null;
  statusName?: string | null;
  statusType?: StatusType | null;
  priority?: TaskPriority | null;
  /** F40 — o tipo da demanda. */
  type?: TaskDemandType | null;
  dueOn: string | null;
  completedAt: string | null;
  board: { id: string; name: string | null } | null;
  client: { id: string; name: string | null } | null;
};

/**
 * `null` = pessoa inacessível (fora do diretório / recorte / id desconhecido).
 * Pessoa visível sem demanda: `tasks` vazio e `counts` em zero — não é `null`.
 */
export type WorkPersonWorkView = {
  person: WorkPersonView;
  counts: { tasks: number; open: number; done: number };
  tasks: WorkPersonTaskView[];
};

/**
 * F26.6 — uma nota do mural como o port a entrega. `author` já vem recortado
 * por `people:read` (como o autor do comentário); `createdById` NÃO sai na
 * resposta — serve só para dizer se esta conexão pode editar a nota.
 */
export type WorkMuralNoteView = {
  id: string;
  title: string | null;
  content: string;
  color: MuralNoteColor;
  author: { id: string; name: string } | null;
  createdById: string | null;
  viaName: string | null;
  createdAt: string;
  updatedAt: string;
};

/** F26.6 — um registro do histórico. Mesmo recorte de pessoa; documentos só contados. */
export type WorkHistoryEntryView = {
  id: string;
  happenedOn: string;
  title: string;
  subtitle: string | null;
  body: string;
  ledBy: { id: string; name: string } | null;
  ledByNote: string | null;
  author: { id: string; name: string } | null;
  createdById: string | null;
  viaName: string | null;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

/** `null` no lugar desta visão = cliente fora do recorte (ou inexistente). */
export type WorkClientRecordsView<T> = {
  client: { id: string; name: string };
  items: T[];
};

/**
 * Port de consulta. A implementação SQL aplica o mesmo recorte no WHERE
 * — não carrega o universo para filtrar depois.
 */
/**
 * Janela da busca — F22, Fase 3.
 *
 * POR QUÊ: sem isto, `search` trazia o banco inteiro e o corte acontecia em
 * JavaScript; a palavra `a` carregava 1860 tarefas para descartar quase todas.
 * A janela desce à implementação para o corte acontecer NO BANCO — mesma
 * ordem, mesmo cursor, mesmo sinal de continuação, outro lugar de corte.
 *
 * A chave de ordenação é a mesma que `searchWork` usa depois (`kind:título
 * dobrado`, desempate por id), porque um corte com ordem diferente da que
 * pagina perderia ou repetiria linha na virada de página.
 */
export type SearchWindow = { limit: number; cursor: PageCursor | null };

/**
 * A janela de uma leitura por título — F38, Fase 6.1 (`get_board` e
 * `get_person_work`). A mesma forma da janela da busca, com uma ordem só:
 * título dobrado (`titleOrderKey`) e desempate por id. Ausente = sem corte
 * (as provas que comparam com a leitura inteira usam isso).
 */
export type TitleWindow = SearchWindow;

/**
 * A chave de ordem de `get_board` e `get_person_work` — F38, Fase 6.1. É a da
 * busca sem a espécie na frente: o SQL ordena por `lower(título) collate "C"`
 * e desempata por `id::text collate "C"`, e o JavaScript tem de ordenar igual
 * para o cursor cair no mesmo lugar nos dois lados (ver `searchOrderKey`).
 *
 * O formato do cursor não mudou (`{ v: 1, k, id }`). Antes desta fase a chave
 * era `fold(título)`, que também aparava as pontas; um cursor antigo de título
 * com espaço na ponta continua sendo lido, e no pior caso a página seguinte
 * começa uma linha antes ou depois. O cursor é opaco para a IA.
 */
export function titleOrderKey(text: string): string {
  return searchOrderKey(text);
}

/**
 * O corte da janela sobre uma massa já recortada e inteira, como o SQL faz:
 * ordem do título, depois do cursor, `limit + 1`. Usado pelo dublê em memória.
 */
export function cutTitleWindow<T>(
  items: readonly T[],
  key: (item: T) => PageKey,
  window: TitleWindow | undefined,
): T[] {
  const ranked = items
    .map((item) => ({ item, key: key(item) }))
    .sort((a, b) => (a.key.k === b.key.k ? (a.key.id < b.key.id ? -1 : a.key.id > b.key.id ? 1 : 0) : a.key.k < b.key.k ? -1 : 1));
  if (!window) return ranked.map((row) => row.item);
  const after = window.cursor;
  return ranked
    .filter((row) => !after || row.key.k > after.k || (row.key.k === after.k && row.key.id > after.id))
    .slice(0, window.limit + 1)
    .map((row) => row.item);
}

export type WorkCatalog = {
  search(
    scope: WorkScope,
    query: string,
    kinds: readonly SearchKind[],
    window: SearchWindow,
  ): Promise<readonly WorkSearchHit[]>;
  /**
   * F38, Fase 6.1 — `window` desce ao SQL: `tasks` traz só `limit + 1` depois
   * do cursor; `columns[].total` continua contando o quadro inteiro.
   */
  getBoard(scope: WorkScope, boardId: string, window?: TitleWindow): Promise<WorkBoardView | null>;
  /** F37 — etapas da esteira de uma lista ou pasta, com o dono e a origem. */
  getWorkflow(scope: WorkScope, target: WorkflowTarget): Promise<WorkWorkflowView | null>;
  /** G11 — as listas do recorte (vivas, ou também as arquivadas), por espaço, pasta e nome. */
  listBoards(scope: WorkScope, options: { includeArchived: boolean }): Promise<readonly WorkBoardRow[]>;
  /**
   * G11 — as tarefas do recorte que passam no filtro, por título, na janela
   * (`limit + 1` depois do cursor, como `getBoard`); `total` conta o filtro inteiro.
   * `null` = o espaço, a pasta ou a lista do filtro não existe ou está fora do recorte.
   */
  listTasks(
    scope: WorkScope,
    filters: WorkTaskFilters,
    window?: TitleWindow,
  ): Promise<{ total: number; tasks: WorkListedTask[] } | null>;
  /** G5 — a carteira ATIVA do recorte (empresa, cliente, omitidas), com o cadastro de cada um, por nome. */
  listClients(scope: WorkScope): Promise<readonly WorkClientSummary[]>;
  /** G7 — as etiquetas de um espaço (ou do espaço de uma lista), no recorte da concessão. `null` = não achado, fora do recorte ou omitido. */
  listTags(scope: WorkScope, target: ListTagsTarget): Promise<WorkTagsView | null>;
  getTask(scope: WorkScope, taskId: string): Promise<WorkTaskView | null>;
  getClient(scope: WorkScope, clientId: string): Promise<WorkClientView | null>;
  listComments(scope: WorkScope, taskId: string): Promise<WorkCommentView[] | null>;
  listPeople(scope: WorkScope): Promise<readonly WorkPersonView[]>;
  /**
   * F38, Fase 6.1 — `window` desce ao SQL: `tasks` traz só `limit + 1` depois
   * do cursor; `counts` vem de uma contagem à parte, do recorte inteiro.
   */
  getPersonWork(scope: WorkScope, personId: string, window?: TitleWindow): Promise<WorkPersonWorkView | null>;
  /** F26.6 — o mural inteiro do cliente (é pequeno: dezenas de notas). */
  getClientMural(scope: WorkScope, clientId: string): Promise<WorkClientRecordsView<WorkMuralNoteView> | null>;
  /** F26.6 — o histórico inteiro do cliente (idem: dezenas de registros). */
  getClientHistory(
    scope: WorkScope,
    clientId: string,
    /** F37 — busca por palavra-chave, já aparada; o recorte de cliente vem antes dela. */
    query?: string,
  ): Promise<WorkClientRecordsView<WorkHistoryEntryView> | null>;
};

export const EMPTY_WORK_CATALOG: WorkCatalog = {
  async search() {
    return [];
  },
  async getBoard() {
    return null;
  },
  async getWorkflow() {
    return null;
  },
  async listBoards() {
    return [];
  },
  async listTasks() {
    return null;
  },
  async listClients() {
    return [];
  },
  async listTags() {
    return null;
  },
  async getTask() {
    return null;
  },
  async getClient() {
    return null;
  },
  async listComments() {
    return null;
  },
  async listPeople() {
    return [];
  },
  async getPersonWork() {
    return null;
  },
  async getClientMural() {
    return null;
  },
  async getClientHistory() {
    return null;
  },
};

export type MemoryBoard = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  spaceId: string;
  spaceName: string;
  folderId: string | null;
  folderName: string | null;
  clientId: string | null;
  clientName: string | null;
  canSeeSpace: boolean;
  archived?: boolean;
  statuses: Array<{ id: string; name: string; sortOrder: number; type?: StatusType | null }>;
  /**
   * F40 — lista de produção. Ausente: o dublê deduz pelo nome das etapas (o
   * banco decide por `list_is_production`; aqui só se repete a regra).
   */
  isProduction?: boolean;
  /** G11 — lista compartilhada: a tarefa nova exige cliente. */
  requiresClient?: boolean;
  /**
   * F37 — de onde a esteira desta lista vem. Sem isto, a esteira é da própria
   * lista (`list`, dona = a lista, nome = `workflowName` ou o nome da lista).
   */
  workflow?: MemoryWorkflowSource;
};

/** F37 — quem guarda a esteira e como ela se chama. */
export type MemoryWorkflowSource = {
  inheritedFrom: WorkflowOrigin;
  ownerId: string;
  ownerName: string;
  name: string;
};

/** F37 — uma pasta na massa em memória, com a esteira que ela mostra. */
export type MemoryFolder = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  canSeeSpace: boolean;
  workflow: MemoryWorkflowSource;
  statuses: Array<{ id: string; name: string; sortOrder: number; type?: StatusType | null }>;
};

export type MemoryTask = {
  id: string;
  title: string;
  description: string | null;
  companyId: string;
  companyName: string;
  boardId: string | null;
  clientId: string | null;
  clientName: string | null;
  statusId: string | null;
  dueOn: string | null;
  completedAt?: string | null;
  priority?: TaskPriority | null;
  /** F40 — o tipo da demanda. */
  type?: TaskDemandType | null;
  startOn?: string | null;
  archivedAt?: string | null;
  people: Array<{ id: string; name: string }>;
  /** F38, Fase 6.4 — a mãe, quando é subtarefa. A ordem das filhas é a do array. */
  parentId?: string | null;
  /** F42, Fase 7 — as rodadas de aprovação, como o SQL as devolve. */
  approvalRounds?: TaskApprovalRound[];
  /** G6 — a ficha inteira (cada grupo ausente = o dublê não traz). */
  tags?: Array<{ id: string; name: string; bgColor: string | null; fgColor: string | null }>;
  watchers?: Array<{ id: string; name: string }>;
  checklists?: NonNullable<WorkTaskView['checklists']>;
  links?: Array<{ id: string; label: string; url: string }>;
  /**
   * O livro da tarefa. Os ids opcionais dizem DE QUE lista e cliente o nome é: o
   * dublê repete o recorte do SQL (`lerHistoricoNoRecorte`) e esconde o nome do
   * que está fora da concessão. Id ausente = o dublê não diz, e o nome passa.
   */
  history?: Array<
    EventoDaTarefa & {
      fromListId?: string | null;
      toListId?: string | null;
      fromClientId?: string | null;
      toClientId?: string | null;
    }
  >;
  createdBy?: { id: string; name: string } | null;
  completedBy?: { id: string; name: string } | null;
  createdVia?: string | null;
  createdAt?: string | null;
};

export type MemoryComment = {
  id: string;
  taskId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
  fromClient?: boolean;
};

export type MemoryClient = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  listIds: readonly string[];
  /** F38, Fase 4 — ausente = ativo; `false` = cancelado. */
  isActive?: boolean;
  /** Dia do cancelamento (`AAAA-MM-DD`, São Paulo). Só vale com `isActive: false`. */
  cancelledOn?: string | null;
  /** G5 — o cadastro. Cada campo ausente = o dublê não diz (urgência paz, sem plano). */
  plan?: { id: string; name: string } | null;
  urgency?: (typeof CLIENT_URGENCIES)[number];
  startedOn?: string | null;
  renewsOn?: string | null;
  quotas?: Array<{ type: 'video' | 'arte' | 'foto' | 'ads'; quantity: number }>;
  tags?: Array<{ id: string; name: string; color: string | null }>;
  /** Isca: o financeiro (o cliente pagou?) fica só na tela — de propósito, não sai pelo agente. */
  financeOk?: boolean;
  /** Isca: o contato do cliente NUNCA pode sair pelo agente. */
  phone?: string;
  email?: string;
  taxId?: string;
  ownerName?: string;
  notes?: string;
};

export type MemoryPerson = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  detail: string | null;
  /** Isca: o diretório da integração não pode vazar estes campos. */
  email?: string;
  papel?: string;
  todosOsClientes?: boolean;
  isSuperadmin?: boolean;
};

/** F26.6 — nota do mural na massa em memória; `author` é o dado cru, sem recorte. */
export type MemoryMuralNote = WorkMuralNoteView & { clientId: string };

/** F26.6 — registro do histórico na massa em memória. */
export type MemoryHistoryEntry = WorkHistoryEntryView & { clientId: string; documentFileNames?: readonly string[] };

/** G7 — uma etiqueta na massa em memória: mora num espaço (o `spaceId` de um quadro). */
export type MemoryTag = {
  id: string;
  spaceId: string;
  name: string;
  bgColor?: string | null;
  fgColor?: string | null;
};

export type MemoryWorkData = {
  /** G7 — as etiquetas dos espaços. */
  tags?: readonly MemoryTag[];
  boards?: readonly MemoryBoard[];
  folders?: readonly MemoryFolder[];
  tasks?: readonly MemoryTask[];
  clients?: readonly MemoryClient[];
  comments?: readonly MemoryComment[];
  people?: readonly MemoryPerson[];
  muralNotes?: readonly MemoryMuralNote[];
  historyEntries?: readonly MemoryHistoryEntry[];
};

function fold(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Chave de ORDEM da busca — e só dela. Não apara as pontas de propósito: o
 * corte acontece no banco (F22, Fase 3) e lá a ordem é `lower(...) collate
 * "C"`. `btrim` do Postgres corta só espaço; `String.trim()` corta tabulação,
 * quebra de linha e espaço duro também. Se os dois lados aparassem coisas
 * diferentes, um título com tabulação na frente ordenaria em lugares
 * diferentes e sumiria da paginação. Comparar sem aparar nenhum dos dois
 * lados é o que mantém banco e JavaScript na MESMA ordem.
 */
function searchOrderKey(text: string): string {
  return text.toLowerCase();
}

function resourceVisible(scope: WorkScope, companyId: string, clientId: string | null): boolean {
  if (!companyAllowed(scope.companies, companyId)) return false;
  if (clientId === null) return true;
  if (scope.clients === 'none') return false;
  if (scope.clients === 'all') return true;
  return scope.clients.has(clientId);
}

function named(id: string, name: string | null | undefined, allowed: boolean): { id: string; name: string | null } {
  return { id, name: allowed && name && name.length > 0 ? name : null };
}

function personInDirectory(scope: WorkScope, person: MemoryPerson): boolean {
  return companyAllowed(scope.companies, person.companyId);
}

function toPersonView(person: MemoryPerson): WorkPersonView {
  return {
    id: person.id,
    displayName: person.name,
    team: { id: person.companyId, name: person.companyName },
  };
}

function personWorkCounts(tasks: readonly { completedAt: string | null }[]): WorkPersonWorkView['counts'] {
  let open = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.completedAt) done += 1;
    else open += 1;
  }
  return { tasks: tasks.length, open, done };
}

export function effectiveClients(person: PersonAccess, grant: IntegrationGrant, now?: Date): WorkScope['clients'] {
  if (!person.isActive || person.userId !== grant.ownerId || !grantIsLive(grant, now)) return 'none';
  if (grant.allowedClientIds !== null && grant.allowedClientIds.length === 0) return 'none';
  if (grant.allowedClientIds === null) {
    if (person.isSuper || person.hasAllClientsAccess) return 'all';
    return new Set(person.clientIds);
  }
  const allowed = grant.allowedClientIds.filter((id) => personReachesClient(person, id));
  return allowed.length === 0 ? 'none' : new Set(allowed);
}

export function toWorkScope(person: PersonAccess, grant: IntegrationGrant, now?: Date): WorkScope {
  return {
    companies: effectiveCompanies(person, grant),
    clients: effectiveClients(person, grant, now),
    capabilities: effectiveCapabilities(person, grant, now),
  };
}

export class MemoryWorkCatalog implements WorkCatalog {
  private readonly boards: readonly MemoryBoard[];
  private readonly folders: readonly MemoryFolder[];
  private readonly tasks: readonly MemoryTask[];
  private readonly clients: readonly MemoryClient[];
  private readonly comments: readonly MemoryComment[];
  private readonly people: readonly MemoryPerson[];
  private readonly muralNotes: readonly MemoryMuralNote[];
  private readonly historyEntries: readonly MemoryHistoryEntry[];
  private readonly spaceTags: readonly MemoryTag[];

  constructor(data: MemoryWorkData = {}) {
    this.spaceTags = data.tags ?? [];
    this.boards = data.boards ?? [];
    this.folders = data.folders ?? [];
    this.tasks = data.tasks ?? [];
    this.clients = data.clients ?? [];
    this.comments = data.comments ?? [];
    this.people = data.people ?? [];
    this.muralNotes = data.muralNotes ?? [];
    this.historyEntries = data.historyEntries ?? [];
  }

  /** O cliente, se o recorte o alcança — a mesma porta de `getClient`. */
  private clientInScope(scope: WorkScope, clientId: string): MemoryClient | null {
    const client = this.clients.find((row) => row.id === clientId);
    if (!client) return null;
    if (!resourceVisible(scope, client.companyId, client.id)) return null;
    return client;
  }

  async getClientMural(
    scope: WorkScope,
    clientId: string,
  ): Promise<WorkClientRecordsView<WorkMuralNoteView> | null> {
    const client = this.clientInScope(scope, clientId);
    if (!client) return null;
    const canPeople = scope.capabilities.has('people:read');
    const items: WorkMuralNoteView[] = this.muralNotes
      .filter((row) => row.clientId === client.id)
      .map((note) => ({
        id: note.id,
        title: note.title,
        content: note.content,
        color: note.color,
        author: canPeople ? note.author : null,
        createdById: note.createdById,
        viaName: note.viaName,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      }));
    return { client: { id: client.id, name: client.name }, items };
  }

  async getClientHistory(
    scope: WorkScope,
    clientId: string,
    query?: string,
  ): Promise<WorkClientRecordsView<WorkHistoryEntryView> | null> {
    const client = this.clientInScope(scope, clientId);
    if (!client) return null;
    const canPeople = scope.capabilities.has('people:read');
    const words = query === undefined ? [] : palavrasDaBusca(query);
    const items: WorkHistoryEntryView[] = this.historyEntries
      .filter((row) => row.clientId === client.id)
      .filter((entry) => {
        if (words.length === 0) return true;
        // Mesmos campos da busca do site e do SQL; o nome de quem conduziu
        // só entra com people:read (sem ela a pessoa nem o vê na resposta).
        const hay = semAcento(
          [
            entry.title,
            entry.subtitle,
            entry.body,
            canPeople ? entry.ledBy?.name : null,
            entry.ledByNote,
            entry.viaName,
            entry.happenedOn.slice(0, 10).split('-').reverse().join('/'),
            ...(entry.documentFileNames ?? []),
          ]
            .filter((p): p is string => typeof p === 'string' && p !== '')
            .join(' \n '),
        );
        return words.every((w) => hay.includes(w));
      })
      .map((entry) => ({
        id: entry.id,
        happenedOn: entry.happenedOn,
        title: entry.title,
        subtitle: entry.subtitle,
        body: entry.body,
        ledBy: canPeople ? entry.ledBy : null,
        ledByNote: entry.ledByNote,
        author: canPeople ? entry.author : null,
        createdById: entry.createdById,
        viaName: entry.viaName,
        documentCount: entry.documentCount,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }));
    return { client: { id: client.id, name: client.name }, items };
  }

  private boardById(id: string): MemoryBoard | undefined {
    return this.boards.find((board) => board.id === id);
  }

  /**
   * F38, Fase 6 — o cliente da tarefa pela regra única do SQL
   * (`clienteDaTarefaSql`): o dela, e na falta dele o da lista. O nome vem de
   * quem deu o id.
   */
  private taskClient(task: MemoryTask): { id: string; name: string | null } | null {
    const board = task.boardId ? this.boardById(task.boardId) : undefined;
    const id = clienteDaTarefa(task.clientId, board?.clientId);
    if (id === null) return null;
    return { id, name: id === task.clientId ? task.clientName : (board?.clientName ?? null) };
  }

  /**
   * F31 — o dublê do que o SQL faz em `clientNamesOf`: o cliente de empresa
   * OMITIDA não aparece em linha nenhuma (id nem nome), mesmo que a lista ou a
   * tarefa esteja no recorte. A linha fica; o cliente some dela.
   */
  private clienteOculto(scope: WorkScope, clientId: string | null | undefined): boolean {
    if (!clientId) return false;
    const empresa = this.clients.find((row) => row.id === clientId)?.companyId;
    return empresa !== undefined && omittedIn(scope.companies).includes(empresa);
  }

  /** F38, Fase 4 — o cliente existe na massa e está cancelado. */
  private isCancelled(clientId: string | null): boolean {
    if (clientId === null) return false;
    return this.clients.find((row) => row.id === clientId)?.isActive === false;
  }

  private visibleTasksOnBoard(scope: WorkScope, boardId: string): MemoryTask[] {
    const found: MemoryTask[] = [];
    for (const task of this.tasks) {
      if (task.boardId !== boardId) continue;
      if (!resourceVisible(scope, task.companyId, this.taskClient(task)?.id ?? null)) continue;
      found.push(task);
    }
    return found;
  }

  /**
   * A massa em memória não recebe janela: ela já está carregada, e cortar aqui
   * só esconderia da suíte o que o SQL faz de verdade. Quem precisa provar o
   * corte com janela usa um catálogo que a honra (ver `reads.test.ts`).
   */
  async search(scope: WorkScope, query: string, kinds: readonly SearchKind[]): Promise<readonly WorkSearchHit[]> {
    const needle = fold(query);
    if (needle.length === 0) return [];
    const hits: WorkSearchHit[] = [];
    const canBoard = scope.capabilities.has('boards:read');
    const canClient = scope.capabilities.has('clients:read');

    if (kinds.includes('board')) {
      for (const board of this.boards) {
        if (!board.canSeeSpace) continue;
        if (!resourceVisible(scope, board.companyId, board.clientId)) continue;
        if (this.isCancelled(board.clientId)) continue;
        if (!fold(board.name).includes(needle)) continue;
        hits.push({
          kind: 'board',
          id: board.id,
          title: board.name,
          detail: null,
          board: { id: board.id, name: board.name },
          client: board.clientId && !this.clienteOculto(scope, board.clientId) ? named(board.clientId, board.clientName, canClient) : null,
          company: { id: board.companyId, name: board.companyName },
        });
      }
    }

    if (kinds.includes('task')) {
      for (const task of this.tasks) {
        const client = this.taskClient(task);
        if (!resourceVisible(scope, task.companyId, client?.id ?? null)) continue;
        if (!fold(task.title).includes(needle)) continue;
        if (this.isCancelled(client?.id ?? null)) continue;
        const board = task.boardId ? this.boardById(task.boardId) : undefined;
        const showBoardName = canBoard && board?.canSeeSpace === true;
        hits.push({
          kind: 'task',
          id: task.id,
          title: task.title,
          detail: null,
          board: task.boardId ? named(task.boardId, board?.name, showBoardName) : null,
          client: client && !this.clienteOculto(scope, client.id) ? named(client.id, client.name, canClient) : null,
          company: { id: task.companyId, name: task.companyName },
        });
      }
    }

    if (kinds.includes('client')) {
      for (const client of this.clients) {
        if (!resourceVisible(scope, client.companyId, client.id)) continue;
        if (client.isActive === false) {
          if (!cancelledNameMatches(client.name, query)) continue;
          const cancelledOn = client.cancelledOn ?? null;
          hits.push({
            kind: 'client',
            id: client.id,
            title: client.name,
            detail: cancelledDetail(cancelledOn),
            board: null,
            client: null,
            company: null,
            cancelled: true,
            cancelledOn,
          });
          continue;
        }
        if (!fold(client.name).includes(needle)) continue;
        hits.push({
          kind: 'client',
          id: client.id,
          title: client.name,
          detail: null,
          board: null,
          client: { id: client.id, name: client.name },
          company: { id: client.companyId, name: client.companyName },
        });
      }
    }

    if (kinds.includes('person')) {
      for (const person of this.people) {
        if (!companyAllowed(scope.companies, person.companyId)) continue;
        if (!fold(person.name).includes(needle)) continue;
        hits.push({
          kind: 'person',
          id: person.id,
          title: person.name,
          detail: person.detail,
          board: null,
          client: null,
          company: { id: person.companyId, name: person.companyName },
        });
      }
    }

    return hits;
  }

  async getBoard(scope: WorkScope, boardId: string, window?: TitleWindow): Promise<WorkBoardView | null> {
    const board = this.boardById(boardId);
    if (!board) return null;
    if (!board.canSeeSpace) return null;
    if (!resourceVisible(scope, board.companyId, board.clientId)) return null;

    const visible = this.visibleTasksOnBoard(scope, board.id);
    const canClient = scope.capabilities.has('clients:read');
    const canPeople = scope.capabilities.has('people:read');
    const columns = [...board.statuses]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map((status) => ({
        id: status.id,
        name: status.name,
        sortOrder: status.sortOrder,
        type: status.type ?? null,
        total: visible.filter((task) => task.statusId === status.id).length,
      }));

    return {
      id: board.id,
      name: board.name,
      space: named(board.spaceId, board.spaceName, true),
      folder: board.folderId ? named(board.folderId, board.folderName, true) : null,
      company: { id: board.companyId, name: board.companyName },
      client: board.clientId && !this.clienteOculto(scope, board.clientId) ? named(board.clientId, board.clientName, canClient) : null,
      columns,
      // F38, Fase 6.1: o mesmo corte do SQL; as colunas acima contam tudo.
      tasks: cutTitleWindow(visible, (task) => ({ k: titleOrderKey(task.title), id: task.id }), window).map((task) => {
        const client = this.taskClient(task);
        return {
          id: task.id,
          title: task.title,
          statusId: task.statusId,
          priority: task.priority ?? null,
          type: task.type ?? null,
          startOn: task.startOn ?? null,
          completedAt: task.completedAt ?? null,
          archivedAt: task.archivedAt ?? null,
          client:
            canClient && client && !this.clienteOculto(scope, client.id)
              ? { id: client.id, name: client.name ?? client.id }
              : null,
          people: canPeople ? [...task.people] : [],
        };
      }),
    };
  }

  /** G7 — o dublê de `SqlWorkCatalog.listTags`: o espaço e a lista pelo recorte, as etiquetas por nome. */
  async listTags(scope: WorkScope, target: ListTagsTarget): Promise<WorkTagsView | null> {
    // Uma lista vale pelo recorte dela (empresa e cliente); um espaço, pela empresa e
    // por ter ao menos uma lista que o recorte alcança (ou nenhuma lista).
    const daLista = target.kind === 'list' ? this.boardById(target.id) : undefined;
    const doEspaco = this.boards.filter((board) => board.spaceId === (daLista?.spaceId ?? target.id));
    const primeira = daLista ?? doEspaco[0];
    if (!primeira || !primeira.canSeeSpace) return null;
    if (!companyAllowed(scope.companies, primeira.companyId)) return null;
    // F38: a lista (ou o espaço, se nenhuma lista dele) de cliente cancelado não existe aqui.
    if (target.kind === 'list') {
      if (!resourceVisible(scope, primeira.companyId, primeira.clientId) || this.isCancelled(primeira.clientId)) return null;
    } else if (
      !doEspaco.some((board) => resourceVisible(scope, board.companyId, board.clientId) && !this.isCancelled(board.clientId))
    ) {
      return null;
    }
    return {
      space: {
        id: primeira.spaceId,
        name: primeira.spaceName,
        company: { id: primeira.companyId, name: primeira.companyName },
      },
      list: daLista ? { id: daLista.id, name: daLista.name } : null,
      tags: this.spaceTags
        .filter((tag) => tag.spaceId === primeira.spaceId)
        .map((tag) => ({ id: tag.id, name: tag.name, bgColor: tag.bgColor ?? null, fgColor: tag.fgColor ?? null })),
    };
  }

  async getWorkflow(scope: WorkScope, target: WorkflowTarget): Promise<WorkWorkflowView | null> {
    const stagesOf = (statuses: MemoryBoard['statuses']) =>
      [...statuses]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        .map((status) => ({ id: status.id, name: status.name, sortOrder: status.sortOrder, type: status.type ?? null }));

    if (target.kind === 'list') {
      const board = this.boardById(target.id);
      if (!board || !board.canSeeSpace) return null;
      if (!resourceVisible(scope, board.companyId, board.clientId)) return null;
      const source: MemoryWorkflowSource = board.workflow ?? {
        inheritedFrom: 'list',
        ownerId: board.id,
        ownerName: board.name,
        name: board.name,
      };
      return {
        target: { kind: 'list', id: board.id, name: board.name },
        company: { id: board.companyId, name: board.companyName },
        name: source.name,
        inheritedFrom: source.inheritedFrom,
        owner: { kind: source.inheritedFrom, id: source.ownerId, name: source.ownerName },
        stages: stagesOf(board.statuses),
        isProduction:
          board.isProduction ?? board.statuses.some((status) => semAcento(status.name.trim()) === 'atribuir demanda'),
      };
    }

    const folder = this.folders.find((row) => row.id === target.id);
    if (!folder || !folder.canSeeSpace) return null;
    if (!companyAllowed(scope.companies, folder.companyId)) return null;
    // Pasta com listas, mas nenhuma no recorte de cliente: não existe para esta conexão.
    const inside = this.boards.filter((row) => row.folderId === folder.id);
    if (inside.length > 0 && !inside.some((row) => resourceVisible(scope, row.companyId, row.clientId))) return null;
    return {
      target: { kind: 'folder', id: folder.id, name: folder.name },
      company: { id: folder.companyId, name: folder.companyName },
      name: folder.workflow.name,
      inheritedFrom: folder.workflow.inheritedFrom,
      owner: { kind: folder.workflow.inheritedFrom, id: folder.workflow.ownerId, name: folder.workflow.ownerName },
      stages: stagesOf(folder.statuses),
      isProduction: null,
    };
  }

  async getTask(scope: WorkScope, taskId: string): Promise<WorkTaskView | null> {
    const task = this.tasks.find((row) => row.id === taskId);
    if (!task) return null;
    const client = this.taskClient(task);
    if (!resourceVisible(scope, task.companyId, client?.id ?? null)) return null;

    const board = task.boardId ? this.boardById(task.boardId) : undefined;
    const showBoardName = scope.capabilities.has('boards:read') && board?.canSeeSpace === true;
    const comments = this.comments.filter((row) => row.taskId === task.id);
    // F38, Fase 6.4 — as filhas diretas, não arquivadas e no recorte, como o SQL.
    const filhas = this.tasks.filter(
      (row) =>
        row.parentId === task.id &&
        !row.archivedAt &&
        resourceVisible(scope, row.companyId, this.taskClient(row)?.id ?? null),
    );
    const subtasks: GetTaskSubtask[] = filhas.slice(0, GET_TASK_SUBTASKS_MAX).map((row) => {
      const daLista = row.boardId ? this.boardById(row.boardId) : undefined;
      return {
        id: row.id,
        title: row.title,
        statusId: row.statusId,
        statusName: daLista?.statuses.find((status) => status.id === row.statusId)?.name || null,
        completed: Boolean(row.completedAt),
      };
    });
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      dueOn: task.dueOn,
      statusId: task.statusId,
      statusType: board?.statuses.find((status) => status.id === task.statusId)?.type ?? null,
      priority: task.priority ?? null,
      type: task.type ?? null,
      startOn: task.startOn ?? null,
      completedAt: task.completedAt ?? null,
      archivedAt: task.archivedAt ?? null,
      board: task.boardId ? named(task.boardId, board?.name, showBoardName) : null,
      client: client && !this.clienteOculto(scope, client.id) ? { id: client.id, name: client.name ?? client.id } : null,
      people: [...task.people],
      comments: comments.map((row) => ({ id: row.id, body: row.body, ...(row.fromClient ? { fromClient: true } : {}) })),
      approvalRounds: (task.approvalRounds ?? []).map((r) => ({ ...r, items: [...r.items] })),
      subtasks,
      subtaskTotal: filhas.length,
      ...this.fichaDe(scope, task, board, showBoardName),
    };
  }

  /** G6 — os grupos da ficha que o dublê tem; o resto fica ausente, como no catálogo antigo. */
  private fichaDe(
    scope: WorkScope,
    task: MemoryTask,
    board: MemoryBoard | undefined,
    showBoardName: boolean,
  ): Partial<WorkTaskView> {
    const ficha: Partial<WorkTaskView> = {};
    if (task.tags !== undefined) ficha.tags = task.tags.map((tag) => ({ ...tag }));
    if (task.watchers !== undefined) ficha.watchers = task.watchers.map((w) => ({ ...w }));
    // A mãe só aparece se está no recorte e não está arquivada, como o SQL.
    const mae = task.parentId ? this.tasks.find((row) => row.id === task.parentId) : undefined;
    ficha.parent =
      mae && !mae.archivedAt && resourceVisible(scope, mae.companyId, this.taskClient(mae)?.id ?? null)
        ? { id: mae.id, title: mae.title }
        : null;
    if (task.checklists !== undefined) {
      ficha.checklists = task.checklists.map((lista) => ({ ...lista, items: lista.items.map((item) => ({ ...item })) }));
      ficha.checklistItemTotal = task.checklists.reduce((n, lista) => n + lista.items.length, 0);
    }
    if (task.links !== undefined) {
      ficha.links = task.links.map((link) => ({ ...link }));
      ficha.linkTotal = task.links.length;
    }
    if (task.history !== undefined) {
      // O nome só sai se o que ele nomeia está no recorte (o mesmo do SQL).
      const listaVisivel = (id: string | null | undefined) => {
        if (id === undefined) return true;
        const lista = id === null ? undefined : this.boardById(id);
        return lista !== undefined && resourceVisible(scope, lista.companyId, lista.clientId);
      };
      const clienteVisivel = (id: string | null | undefined) => {
        if (id === undefined) return true;
        const cliente = id === null ? undefined : this.clients.find((row) => row.id === id);
        return (
          cliente !== undefined && cliente.isActive !== false && resourceVisible(scope, cliente.companyId, cliente.id)
        );
      };
      ficha.history = task.history.map(
        ({ fromListId, toListId, fromClientId, toClientId, ...evento }): EventoDaTarefa => ({
          ...evento,
          fromListName: listaVisivel(fromListId) ? evento.fromListName : null,
          toListName: listaVisivel(toListId) ? evento.toListName : null,
          fromClientName: clienteVisivel(fromClientId) ? (evento.fromClientName ?? null) : null,
          toClientName: clienteVisivel(toClientId) ? (evento.toClientName ?? null) : null,
        }),
      );
    }
    if (task.createdBy !== undefined) ficha.createdBy = task.createdBy;
    if (task.completedBy !== undefined) ficha.completedBy = task.completedBy;
    if (task.createdVia !== undefined) ficha.createdVia = task.createdVia;
    if (task.createdAt !== undefined) ficha.createdAt = task.createdAt;
    if (board) {
      ficha.folder = board.folderId ? named(board.folderId, board.folderName, showBoardName) : null;
      ficha.space = named(board.spaceId, board.spaceName, showBoardName);
    }
    return ficha;
  }

  async getClient(scope: WorkScope, clientId: string): Promise<WorkClientView | null> {
    const client = this.clients.find((row) => row.id === clientId);
    if (!client) return null;
    if (!resourceVisible(scope, client.companyId, client.id)) return null;
    if (client.isActive === false) {
      return { id: client.id, name: client.name, cancelled: true, cancelledOn: client.cancelledOn ?? null };
    }

    const canBoard = scope.capabilities.has('boards:read');
    const lists = [];
    for (const listId of client.listIds) {
      const board = this.boardById(listId);
      if (!board) continue;
      const show = canBoard && board.canSeeSpace;
      lists.push({
        id: board.id,
        name: show ? board.name : null,
        archived: board.archived === true,
        space: { id: board.spaceId, name: show ? board.spaceName : null },
        folder: board.folderId ? { id: board.folderId, name: show ? board.folderName : null } : null,
      });
    }
    lists.sort((a, b) => {
      const space = (a.space.name ?? '').toLowerCase().localeCompare((b.space.name ?? '').toLowerCase());
      if (space !== 0) return space;
      if (a.space.id !== b.space.id) return a.space.id < b.space.id ? -1 : 1;
      const name = (a.name ?? '').toLowerCase().localeCompare((b.name ?? '').toLowerCase());
      if (name !== 0) return name;
      return a.id < b.id ? -1 : 1;
    });

    return {
      id: client.id,
      name: client.name,
      company: { id: client.companyId, name: client.companyName },
      lists,
      ...this.perfilDe(client),
      quotas: (client.quotas ?? []).map((quota) => ({ ...quota })),
    };
  }

  /** G5 — só o cadastro que o contrato leva; telefone, e-mail, CNPJ, responsável e observações do dublê ficam de fora. */
  private perfilDe(client: MemoryClient): WorkClientProfile {
    return {
      plan: client.plan ?? null,
      urgency: client.urgency ?? 'paz',
      startedOn: client.startedOn ?? null,
      renewsOn: client.renewsOn ?? null,
      tags: (client.tags ?? []).map((tag) => ({ ...tag })),
    };
  }

  /** G11 — o dublê de `SqlWorkCatalog.listBoards`. */
  async listBoards(scope: WorkScope, options: { includeArchived: boolean }): Promise<readonly WorkBoardRow[]> {
    return this.boards
      .filter(
        (board) =>
          board.canSeeSpace &&
          resourceVisible(scope, board.companyId, board.clientId) &&
          !this.isCancelled(board.clientId) &&
          (options.includeArchived || board.archived !== true),
      )
      .map(
        (board): WorkBoardRow => ({
          id: board.id,
          name: board.name,
          space: { id: board.spaceId, name: board.spaceName },
          folder: board.folderId ? { id: board.folderId, name: board.folderName } : null,
          company: { id: board.companyId, name: board.companyName },
          client:
            board.clientId && !this.clienteOculto(scope, board.clientId)
              ? { id: board.clientId, name: board.clientName }
              : null,
          requiresClient: board.requiresClient === true,
          isProduction:
            board.isProduction ?? board.statuses.some((status) => semAcento(status.name.trim()) === 'atribuir demanda'),
          archived: board.archived === true,
        }),
      )
      .sort(
        (a, b) =>
          semAcento(a.space.name ?? '').localeCompare(semAcento(b.space.name ?? '')) ||
          semAcento(a.folder?.name ?? '').localeCompare(semAcento(b.folder?.name ?? '')) ||
          semAcento(a.name).localeCompare(semAcento(b.name)) ||
          (a.id < b.id ? -1 : 1),
      );
  }

  /** G11 — o dublê de `SqlWorkCatalog.listTasks`: o mesmo recorte de `getPersonWork`, mais o filtro. */
  async listTasks(
    scope: WorkScope,
    filters: WorkTaskFilters,
    window?: TitleWindow,
  ): Promise<{ total: number; tasks: WorkListedTask[] } | null> {
    const container = filters.container;
    if (container) {
      // O espaço, a pasta ou a lista tem de existir E ser alcançável (uma lista que o recorte vê).
      const alcancaveis = this.boards.filter(
        (board) =>
          board.canSeeSpace &&
          resourceVisible(scope, board.companyId, board.clientId) &&
          // F38: lista de cliente cancelado não existe aqui, como em `listBoards`.
          !this.isCancelled(board.clientId) &&
          (container.kind === 'list'
            ? board.id === container.id
            : container.kind === 'folder'
              ? board.folderId === container.id
              : board.spaceId === container.id),
      );
      if (alcancaveis.length === 0) return null;
    }
    const canBoard = scope.capabilities.has('boards:read');
    const canClient = scope.capabilities.has('clients:read');
    const canPeople = scope.capabilities.has('people:read');
    const achadas: WorkListedTask[] = [];
    for (const task of this.tasks) {
      if (task.archivedAt) continue;
      const board = task.boardId ? this.boardById(task.boardId) : undefined;
      const client = this.taskClient(task);
      if (!resourceVisible(scope, task.companyId, client?.id ?? null)) continue;
      if (this.isCancelled(client?.id ?? null)) continue;
      if (container) {
        if (!board) continue;
        const dentro =
          container.kind === 'list'
            ? board.id === container.id
            : container.kind === 'folder'
              ? board.folderId === container.id
              : board.spaceId === container.id;
        if (!dentro) continue;
      }
      if (filters.assigneeId !== undefined && !task.people.some((p) => p.id === filters.assigneeId)) continue;
      if (filters.createdBy !== undefined && task.createdBy?.id !== filters.createdBy) continue;
      const stage = board?.statuses.find((status) => status.id === task.statusId);
      if (filters.statusType !== undefined && stage?.type !== filters.statusType) continue;
      if (filters.type !== undefined && task.type !== filters.type) continue;
      if (filters.dueBefore !== undefined && !(task.dueOn !== null && task.dueOn < filters.dueBefore)) continue;
      if (filters.overdue === true && !(task.dueOn !== null && task.dueOn < filters.today && !task.completedAt)) continue;
      if (filters.clientId !== undefined && (client?.id !== filters.clientId || this.clienteOculto(scope, client.id))) continue;
      if (filters.completed !== undefined && Boolean(task.completedAt) !== filters.completed) continue;
      const showBoardName = canBoard && board?.canSeeSpace === true;
      achadas.push({
        id: task.id,
        title: task.title,
        statusId: task.statusId,
        statusName: stage?.name ?? null,
        statusType: stage?.type ?? null,
        priority: task.priority ?? null,
        type: task.type ?? null,
        dueOn: task.dueOn,
        startOn: task.startOn ?? null,
        completedAt: task.completedAt ?? null,
        list: task.boardId ? named(task.boardId, board?.name, showBoardName) : null,
        client: client && !this.clienteOculto(scope, client.id) ? named(client.id, client.name, canClient) : null,
        people: canPeople ? task.people.map((p) => ({ ...p })) : [],
      });
    }
    return {
      total: achadas.length,
      tasks: cutTitleWindow(achadas, (task) => ({ k: titleOrderKey(task.title), id: task.id }), window),
    };
  }

  async listClients(scope: WorkScope): Promise<readonly WorkClientSummary[]> {
    return this.clients
      .filter((client) => client.isActive !== false && resourceVisible(scope, client.companyId, client.id))
      .map((client) => ({
        id: client.id,
        name: client.name,
        company: { id: client.companyId, name: client.companyName },
        ...this.perfilDe(client),
      }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.id < b.id ? -1 : 1));
  }

  async listComments(scope: WorkScope, taskId: string): Promise<WorkCommentView[] | null> {
    const task = this.tasks.find((row) => row.id === taskId);
    if (!task) return null;
    if (!resourceVisible(scope, task.companyId, this.taskClient(task)?.id ?? null)) return null;

    const canPeople = scope.capabilities.has('people:read');
    const rows = this.comments.filter((row) => row.taskId === taskId);
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      body: row.body,
      createdAt: row.createdAt,
      author: canPeople ? row.author : null,
      ...(row.fromClient ? { fromClient: true } : {}),
    }));
  }

  async listPeople(scope: WorkScope): Promise<readonly WorkPersonView[]> {
    const found: WorkPersonView[] = [];
    for (const person of this.people) {
      if (!personInDirectory(scope, person)) continue;
      found.push(toPersonView(person));
    }
    found.sort((a, b) => {
      const name = fold(a.displayName).localeCompare(fold(b.displayName));
      if (name !== 0) return name;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return found;
  }

  async getPersonWork(scope: WorkScope, personId: string, window?: TitleWindow): Promise<WorkPersonWorkView | null> {
    const person = this.people.find((row) => row.id === personId);
    if (!person) return null;
    if (!personInDirectory(scope, person)) return null;

    const canBoard = scope.capabilities.has('boards:read');
    const canClient = scope.capabilities.has('clients:read');
    const tasks: WorkPersonTaskView[] = [];
    for (const task of this.tasks) {
      if (!task.people.some((assignee) => assignee.id === personId)) continue;
      const client = this.taskClient(task);
      if (!resourceVisible(scope, task.companyId, client?.id ?? null)) continue;
      // F38, Fase 6.2: tarefa de cliente cancelado não volta, nem nas contagens.
      if (this.isCancelled(client?.id ?? null)) continue;
      const board = task.boardId ? this.boardById(task.boardId) : undefined;
      const showBoardName = canBoard && board?.canSeeSpace === true;
      const stage = board?.statuses.find((status) => status.id === task.statusId);
      tasks.push({
        id: task.id,
        title: task.title,
        statusId: task.statusId,
        statusName: stage?.name ?? null,
        statusType: stage?.type ?? null,
        priority: task.priority ?? null,
        type: task.type ?? null,
        dueOn: task.dueOn,
        completedAt: task.completedAt ?? null,
        board: task.boardId ? named(task.boardId, board?.name, showBoardName) : null,
        client: client && !this.clienteOculto(scope, client.id) ? named(client.id, client.name, canClient) : null,
      });
    }
    // F38, Fase 6.1: as contagens são do recorte inteiro; a lista, o mesmo
    // corte do SQL (ordem do título, depois do cursor, `limit + 1`).
    return {
      person: toPersonView(person),
      counts: personWorkCounts(tasks),
      tasks: cutTitleWindow(tasks, (task) => ({ k: titleOrderKey(task.title), id: task.id }), window),
    };
  }
}

export type ReadCtx = {
  grant: IntegrationGrant;
  person: PersonAccess;
  origin: ExecutionOrigin;
  companies: readonly IntegrationCompany[];
  displayName: string;
  work: WorkCatalog;
  now?: Date;
};

export type ReadFailure = {
  ok: false;
  code: Extract<IntegrationErrorCode, 'permission_denied' | 'not_found' | 'invalid_input' | 'invalid_cursor' | 'limit_exceeded' | 'data_incomplete'>;
  message: string;
};

export type ReadSuccess<T> = { ok: true; body: T };
export type ReadResult<T> = ReadSuccess<T> | ReadFailure;

const DENIED: ReadFailure = {
  ok: false,
  code: 'permission_denied',
  message: 'Fora do alcance desta integração.',
};

function envelope(ctx: ReadCtx) {
  const snapshot = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now: ctx.now,
  });
  return { queriedAt: snapshot.queriedAt, effectiveScope: snapshot.effectiveScope };
}

export function asPageError(error: PageRequestError): ReadFailure {
  if (error.code === 'limit_exceeded') {
    return { ok: false, code: 'limit_exceeded', message: error.message };
  }
  if (error.code === 'invalid_cursor') {
    return { ok: false, code: 'invalid_cursor', message: error.message };
  }
  return { ok: false, code: 'invalid_input', message: error.message };
}

export function pageAndFit<T>(
  items: readonly T[],
  options: {
    limit?: unknown;
    cursor?: string | null;
    key: (item: T) => PageKey;
    envelopeOf: (page: Page<T>) => unknown;
  },
): Page<T> | PageRequestError {
  const page = paginateStable(items, {
    limit: options.limit,
    cursor: options.cursor,
    key: options.key,
  });
  if (!('items' in page)) return page;

  const fitted = fitItemsToBudget(page.items, {
    key: options.key,
    envelopeBytes: (lote) => {
      const cut = lote.length < page.items.length;
      const last = lote.at(-1);
      const nextCursor = cut && last ? encodePageCursor({ v: PAGE_CURSOR_VERSION, ...options.key(last) }) : page.nextCursor;
      return measureJsonBytes(
        options.envelopeOf({
          items: [...lote],
          returned: lote.length,
          hasMore: page.hasMore || cut,
          nextCursor,
        }),
      );
    },
  });

  const cut = fitted.returned < page.items.length;
  return {
    items: fitted.items,
    returned: fitted.returned,
    hasMore: page.hasMore || cut,
    nextCursor: cut ? fitted.nextCursor : page.nextCursor,
  };
}

export async function searchWork(
  ctx: ReadCtx,
  input: { q: string; kinds?: SearchKind[]; limit?: number; cursor?: string },
): Promise<ReadResult<SearchResponse>> {
  const q = input.q.trim();
  if (q.length === 0) {
    return { ok: false, code: 'invalid_input', message: 'Informe o texto da busca.' };
  }
  // O Postgres não guarda NUL (U+0000) em texto: o caractere chegava ao `ilike`
  // e voltava como erro interno. É o mesmo cuidado do cursor (`page.ts`).
  if (q.includes('\u0000')) {
    return { ok: false, code: 'invalid_input', message: 'O texto da busca tem um caractere inválido.' };
  }

  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  const requested = input.kinds ?? SEARCH_KINDS.filter((kind) => scope.capabilities.has(KIND_CAPABILITY[kind]));
  if (input.kinds) {
    for (const kind of input.kinds) {
      if (!scope.capabilities.has(KIND_CAPABILITY[kind])) return DENIED;
    }
  }
  if (requested.length === 0) return DENIED;

  // O pedido de página é lido ANTES da consulta (F22, Fase 3): limite e cursor
  // precisam chegar ao SQL para o corte acontecer no banco. Recusa de limite ou
  // de cursor continua saindo antes de qualquer ida ao banco — era assim quando
  // o `pageAndFit` lia o pedido, e continua sendo.
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  const hits = await ctx.work.search(scope, q, requested, { limit: pedido.limit, cursor: pedido.cursor });
  const meta = envelope(ctx);
  const key = (hit: WorkSearchHit) => ({ k: `${hit.kind}:${searchOrderKey(hit.title)}`, id: hit.id });
  // `hits` já vem cortado pelo banco: até `limit + 1` por espécie, depois do
  // cursor. O `pageAndFit` continua sendo a única boca que decide `hasMore` —
  // ele vê "mais itens do que cabem na página" quando o corte veio do SQL, e
  // `fitItemsToBudget` acrescenta o corte por bytes. Os dois sinais entram no
  // mesmo `hasMore`, e um `+1` a mais do banco é exatamente o que faz o sinal
  // do SQL aparecer aqui sem inventar uma segunda regra.
  const paged = pageAndFit(hits, {
    limit: input.limit,
    cursor: input.cursor,
    key,
    envelopeOf: (page) => ({
      operation: 'search',
      queriedAt: meta.queriedAt,
      self: SEARCH_PATH,
      effectiveScope: meta.effectiveScope,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      items: page.items,
    }),
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = searchResponseSchema.parse({
    operation: 'search',
    queriedAt: meta.queriedAt,
    self: SEARCH_PATH,
    effectiveScope: meta.effectiveScope,
    hasMore: paged.hasMore,
    nextCursor: paged.nextCursor,
    items: paged.items,
  });
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

export async function getBoardWork(
  ctx: ReadCtx,
  input: { id: string; limit?: number; cursor?: string },
): Promise<ReadResult<GetBoardResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('boards:read')) return DENIED;

  // F38, Fase 6.1 — como no `search` (F22, Fase 3): o pedido de página é lido
  // ANTES da consulta, porque limite e cursor descem ao SQL. O `pageAndFit`
  // continua decidindo `hasMore` (o `+ 1` do banco vira "sobrou item") e o
  // teto de 64 KiB.
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  const board = await ctx.work.getBoard(scope, input.id, { limit: pedido.limit, cursor: pedido.cursor });
  if (!board) return DENIED;

  const canTasks = scope.capabilities.has('tasks:read');
  const canPeople = scope.capabilities.has('people:read');
  const cards = canTasks
    ? board.tasks.map((task) => {
        const projected = projectTask(
          { id: task.id, title: task.title, client: task.client, people: task.people },
          scope.capabilities,
        );
        return {
          id: task.id,
          title: task.title,
          statusId: task.statusId,
          priority: task.priority ?? null,
          type: task.type ?? null,
          startOn: task.startOn ?? null,
          completedAt: task.completedAt ?? null,
          archivedAt: task.archivedAt ?? null,
          client: projected.client,
          people: canPeople ? [...(projected.people ?? [])] : null,
        };
      })
    : [];

  const meta = envelope(ctx);
  const self = `${GET_BOARD_PATH}?id=${encodeURIComponent(board.id)}`;
  const key = (task: (typeof cards)[number]) => ({ k: titleOrderKey(task.title), id: task.id });
  const paged = pageAndFit(cards, {
    limit: input.limit,
    cursor: input.cursor,
    key,
    envelopeOf: (page) => ({
      operation: 'get_board',
      queriedAt: meta.queriedAt,
      self,
      effectiveScope: meta.effectiveScope,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      board: { ...board, tasks: page.items },
    }),
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = getBoardResponseSchema.parse({
    operation: 'get_board',
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: paged.hasMore,
    nextCursor: paged.nextCursor,
    board: { ...board, tasks: paged.items },
  });
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/**
 * F37 — `get_workflow`. Sem `boards:read`: `permission_denied`. Alvo que não
 * existe, está fora do recorte ou é de empresa omitida: `not_found`, igual
 * para os três (não dá para descobrir por aqui o que existe fora do recorte).
 */
export async function getWorkflowWork(ctx: ReadCtx, input: GetWorkflowInput): Promise<ReadResult<GetWorkflowResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('boards:read')) return DENIED;

  const target = workflowTargetOf(input);
  if (!target) return { ok: false, code: 'invalid_input', message: WORKFLOW_INPUT_MESSAGE };

  const workflow = await ctx.work.getWorkflow(scope, target);
  if (!workflow) {
    return {
      ok: false,
      code: 'not_found',
      message: target.kind === 'list' ? 'Lista não encontrada neste recorte.' : 'Pasta não encontrada neste recorte.',
    };
  }

  const meta = envelope(ctx);
  const body = getWorkflowResponseSchema.parse({
    operation: 'get_workflow',
    queriedAt: meta.queriedAt,
    self: `${GET_WORKFLOW_PATH}?${target.kind === 'list' ? 'listId' : 'folderId'}=${encodeURIComponent(target.id)}`,
    effectiveScope: meta.effectiveScope,
    workflow,
  });
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A resposta não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/**
 * G7 — `list_tags`: as etiquetas de um espaço, ou do espaço de uma lista, sob
 * `boards:read` e o recorte da concessão (empresa, cliente da lista, omitidas).
 * Espaço ou lista fora do recorte é `not_found`, a mesma resposta de um id que
 * não existe. Paginada por nome, dentro do orçamento de 64 KiB.
 */
export async function listTagsWork(ctx: ReadCtx, input: ListTagsInput): Promise<ReadResult<ListTagsResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('boards:read')) return DENIED;

  const target = listTagsTargetOf(input);
  if (!target) return { ok: false, code: 'invalid_input', message: LIST_TAGS_INPUT_MESSAGE };
  // Limite e cursor ruins são recusados ANTES de ler o banco.
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  const view = await ctx.work.listTags(scope, target);
  if (!view) {
    return {
      ok: false,
      code: 'not_found',
      message: target.kind === 'list' ? 'Lista não encontrada neste recorte.' : 'Espaço não encontrado neste recorte.',
    };
  }

  const meta = envelope(ctx);
  const self = `${LIST_TAGS_PATH}?${target.kind === 'list' ? 'listId' : 'spaceId'}=${encodeURIComponent(target.id)}`;
  const assemble = (page: { items: WorkTagsView['tags']; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'list_tags' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    space: view.space,
    list: view.list,
    total: view.tags.length,
    tags: page.items,
  });
  const paged = pageAndFit(view.tags, {
    limit: input.limit,
    cursor: input.cursor,
    key: (tag) => ({ k: tag.name.trim().toLowerCase(), id: tag.id }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = listTagsResponseSchema.parse(assemble(paged));
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/**
 * O cursor do `get_task` tem dois sabores: o da descrição (`k: 'description'`,
 * `id` = onde ela continua) e o dos comentários (`k: 'comment'`, `id` = o
 * último comentário já entregue), que só nasce depois da última página da
 * descrição. Auditoria de 08/10/2026: o dos comentários saía com o id do
 * comentário na chave, e esta função o recusava — a conversa além da primeira
 * página ficava inalcançável pelo `get_task`.
 */
const TASK_COMMENT_CURSOR = 'comment';

function descriptionOffset(
  cursor: string | undefined,
): { ok: true; start: number; afterComment: string | null } | ReadFailure {
  if (cursor === undefined || cursor === '') return { ok: true, start: 0, afterComment: null };
  const lido = decodePageCursor(cursor);
  if (lido.ok && lido.cursor.k === TASK_COMMENT_CURSOR) {
    return { ok: true, start: 0, afterComment: lido.cursor.id };
  }
  if (!lido.ok || lido.cursor.k !== 'description') {
    return {
      ok: false,
      code: 'invalid_cursor',
      message: 'Não deu para continuar a leitura de onde parou. Peça a primeira página de novo.',
    };
  }
  const start = Number(lido.cursor.id);
  if (!Number.isInteger(start) || start < 0) {
    return {
      ok: false,
      code: 'invalid_cursor',
      message: 'Não deu para continuar a leitura de onde parou. Peça a primeira página de novo.',
    };
  }
  return { ok: true, start, afterComment: null };
}

function sliceDescription(
  full: string,
  start: number,
  build: (chunk: string, hasMore: boolean, nextCursor: string | null) => unknown,
): { chunk: string; hasMore: boolean; nextCursor: string | null } {
  if (start >= full.length) return { chunk: '', hasMore: false, nextCursor: null };
  let lo = 1;
  let hi = full.length - start;
  let fit = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const chunk = full.slice(start, start + mid);
    const hasMore = start + mid < full.length;
    const nextCursor = hasMore
      ? encodePageCursor({ v: PAGE_CURSOR_VERSION, k: 'description', id: String(start + mid) })
      : null;
    if (measureJsonBytes(build(chunk, hasMore, nextCursor)) <= RESPONSE_BUDGET_BYTES) {
      fit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const chunk = full.slice(start, start + fit);
  const hasMore = start + fit < full.length;
  const nextCursor = hasMore
    ? encodePageCursor({ v: PAGE_CURSOR_VERSION, k: 'description', id: String(start + fit) })
    : null;
  return { chunk, hasMore, nextCursor };
}

export async function getTaskWork(
  ctx: ReadCtx,
  input: { id: string; cursor?: string },
): Promise<ReadResult<GetTaskResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('tasks:read')) return DENIED;

  const task = await ctx.work.getTask(scope, input.id);
  if (!task) return DENIED;

  const projected = projectTask(task, scope.capabilities);
  const offset = descriptionOffset(input.cursor);
  if (!offset.ok) return offset;

  const meta = envelope(ctx);
  const self = `${GET_TASK_PATH}?id=${encodeURIComponent(task.id)}`;
  const comments = projected.comments;
  const commentsHeld = comments === null ? null : [];
  // F42, Fase 7 — as rodadas vêm com a leitura da tarefa; o que o CLIENTE
  // escreveu segue a leitura de comentários: sem `comments:read`, `null`.
  const podeComentarios = scope.capabilities.has('comments:read');
  const approvalRounds = (task.approvalRounds ?? []).map((r) => ({
    ...r,
    items: [...r.items],
    clientComments: podeComentarios && r.clientComments ? [...r.clientComments] : null,
  }));

  // G6 — a ficha inteira vai só na PRIMEIRA página (a descrição e a conversa
  // longas continuam por cursor sem repeti-la) e SEMPRE dentro do orçamento: se
  // a parte fixa da resposta (sem descrição e sem conversa) passa de metade do
  // teto, os grupos grandes encolhem e, no limite, saem. Quem já lia o get_task
  // nunca ganha `data_incomplete` por causa dos campos novos.
  let ficha: FichaDaTarefa = {};

  const assemble = (
    description: string | null,
    hasMore: boolean,
    nextCursor: string | null,
    commentItems: typeof comments,
  ) => ({
    operation: 'get_task' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore,
    nextCursor,
    task: {
      id: task.id,
      title: task.title,
      description,
      dueOn: task.dueOn,
      statusId: task.statusId,
      statusType: task.statusType ?? null,
      priority: task.priority ?? null,
      type: task.type ?? null,
      startOn: task.startOn ?? null,
      completedAt: task.completedAt ?? null,
      archivedAt: task.archivedAt ?? null,
      board: task.board,
      client: projected.client,
      people: projected.people ? [...projected.people] : null,
      subtasks: task.subtasks ? [...task.subtasks] : [],
      subtaskTotal: task.subtaskTotal ?? task.subtasks?.length ?? 0,
      comments: commentItems,
      approvalRounds,
      ...ficha,
    },
  });

  if (offset.start === 0 && offset.afterComment === null) {
    for (const tetos of [TETOS_CHEIOS, TETOS_REDUZIDOS, TETOS_MINIMOS]) {
      ficha = projetarFicha(task, scope.capabilities, tetos);
      if (measureJsonBytes(assemble('', false, null, commentsHeld)) <= RESPONSE_BUDGET_BYTES / 2) break;
    }
  }

  const fitComments = (description: string | null, items: typeof comments = comments): ReadResult<GetTaskResponse> => {
    if (items === null || items.length === 0) {
      const body = getTaskResponseSchema.parse(assemble(description, false, null, items));
      if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
        return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
      }
      return { ok: true, body };
    }
    const fitted = fitItemsToBudget(items, {
      key: (item) => ({ k: TASK_COMMENT_CURSOR, id: item.id }),
      envelopeBytes: (lote) => {
        const last = lote.at(-1);
        const nextCursor =
          lote.length < items.length && last
            ? encodePageCursor({ v: PAGE_CURSOR_VERSION, k: TASK_COMMENT_CURSOR, id: last.id })
            : null;
        return measureJsonBytes(assemble(description, lote.length < items.length, nextCursor, [...lote]));
      },
    });
    const body = getTaskResponseSchema.parse(
      assemble(description, fitted.hasMore, fitted.nextCursor, fitted.items),
    );
    if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
      return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
    }
    return { ok: true, body };
  };

  if (offset.afterComment !== null) {
    // Continuação da conversa: a descrição já saiu inteira nas páginas de
    // antes, e aqui vem vazia (nula só se a tarefa não tem descrição).
    const after = comments === null ? -1 : comments.findIndex((item) => item.id === offset.afterComment);
    if (comments === null || after < 0) {
      return {
        ok: false,
        code: 'invalid_cursor',
        message: 'Não deu para continuar a leitura de onde parou. Peça a primeira página de novo.',
      };
    }
    return fitComments(task.description ? '' : task.description, comments.slice(after + 1));
  }

  const fullDescription = task.description ?? '';
  if (fullDescription.length > 0) {
    const sliced = sliceDescription(fullDescription, offset.start, (chunk, hasMore, nextCursor) =>
      assemble(chunk, hasMore, nextCursor, commentsHeld),
    );
    if (sliced.hasMore) {
      const body = getTaskResponseSchema.parse(
        assemble(sliced.chunk, true, sliced.nextCursor, commentsHeld),
      );
      if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
        return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
      }
      return { ok: true, body };
    }
    return fitComments(sliced.chunk.length > 0 ? sliced.chunk : task.description);
  }

  return fitComments(task.description);
}

export async function getClientWork(ctx: ReadCtx, input: { id: string }): Promise<ReadResult<GetClientResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('clients:read')) return DENIED;

  const client = await ctx.work.getClient(scope, input.id);
  if (!client) return DENIED;

  const meta = envelope(ctx);
  const body = getClientResponseSchema.parse({
    operation: 'get_client',
    queriedAt: meta.queriedAt,
    self: `${GET_CLIENT_PATH}?id=${encodeURIComponent(client.id)}`,
    effectiveScope: meta.effectiveScope,
    hasMore: false,
    nextCursor: null,
    client,
  });
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/**
 * G11 — `list_boards`: as LISTAS do recorte com o lugar delas na árvore, o
 * cliente, "exige cliente" e produção, sob `boards:read`. O catálogo já devolve
 * só o que a concessão alcança (empresa, cliente da lista, omitidas, cliente
 * cancelado fora); os filtros só estreitam o que sobrou.
 */
export async function listBoardsWork(ctx: ReadCtx, input: ListBoardsInput): Promise<ReadResult<ListBoardsResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('boards:read')) return DENIED;
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  const canClient = scope.capabilities.has('clients:read');
  const todas = await ctx.work.listBoards(scope, { includeArchived: input.includeArchived === true });
  const doFiltro = todas
    .filter(
      (board) =>
        (input.companyId === undefined || board.company.id === input.companyId) &&
        (input.spaceId === undefined || board.space.id === input.spaceId) &&
        (input.folderId === undefined || board.folder?.id === input.folderId) &&
        (input.clientId === undefined || board.client?.id === input.clientId),
    )
    // Sem clients:read o cliente fica só com o id (nome nulo), como no `get_board`.
    .map((board): ListBoardsItem => ({
      ...board,
      client: board.client ? { id: board.client.id, name: canClient ? board.client.name : null } : null,
    }));

  const meta = envelope(ctx);
  const filtros = (Object.entries({
    companyId: input.companyId,
    spaceId: input.spaceId,
    folderId: input.folderId,
    clientId: input.clientId,
  }) as Array<[string, string | undefined]>)
    .filter(([, valor]) => valor !== undefined)
    .map(([nome, valor]) => `${nome}=${encodeURIComponent(valor as string)}`);
  if (input.includeArchived === true) filtros.push('includeArchived=true');
  const self = filtros.length === 0 ? LIST_BOARDS_PATH : `${LIST_BOARDS_PATH}?${filtros.join('&')}`;
  // A posição na ordem (espaço, pasta, nome) vira a chave do cursor, com zeros à esquerda.
  const entradas = doFiltro.map((board, posicao) => ({ board, posicao: String(posicao).padStart(6, '0') }));
  const assemble = (page: { items: typeof entradas; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'list_boards' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    total: doFiltro.length,
    boards: page.items.map((entrada) => entrada.board),
  });
  const paged = pageAndFit(entradas, {
    limit: input.limit,
    cursor: input.cursor,
    key: ({ board, posicao }) => ({ k: posicao, id: board.id }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = listBoardsResponseSchema.parse(assemble(paged));
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/**
 * G11 — `list_tasks`: as tarefas do recorte com filtro, sob `tasks:read`. Os
 * filtros por pessoa (`assigneeId`, `createdBy`) exigem `people:read`, como
 * `get_person_work`. O "hoje" do `overdue` é o de São Paulo. O catálogo aplica o
 * recorte da concessão e a janela de página no banco; aqui só se projeta por
 * capacidade e se corta o orçamento de 64 KiB.
 */
export async function listTasksWork(ctx: ReadCtx, input: ListTasksInput): Promise<ReadResult<ListTasksResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('tasks:read')) return DENIED;

  const containers = (
    [
      ['space', input.spaceId],
      ['folder', input.folderId],
      ['list', input.listId],
    ] as const
  ).filter((par): par is readonly ['space' | 'folder' | 'list', string] => par[1] !== undefined);
  if (containers.length > 1) return { ok: false, code: 'invalid_input', message: LIST_TASKS_INPUT_MESSAGE };
  if ((input.assigneeId !== undefined || input.createdBy !== undefined) && !scope.capabilities.has('people:read')) {
    return DENIED;
  }
  // `2026-02-30` passa pela forma AAAA-MM-DD e, descendo ao SQL como `::date`, vira
  // erro interno: o dia tem de existir, e a recusa sai ANTES de ir ao banco.
  if (input.dueBefore !== undefined && !diaValido(input.dueBefore)) {
    return { ok: false, code: 'invalid_input', message: 'Informe dueBefore em AAAA-MM-DD, um dia que existe.' };
  }
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  const now = ctx.now ?? new Date();
  const today = civilDayInAgency(now);
  const filters: WorkTaskFilters = {
    ...(containers[0] ? { container: { kind: containers[0][0], id: containers[0][1] } } : {}),
    ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
    ...(input.statusType === undefined ? {} : { statusType: input.statusType }),
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.dueBefore === undefined ? {} : { dueBefore: input.dueBefore }),
    ...(input.overdue === true ? { overdue: true } : {}),
    today,
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
    ...(input.completed === undefined ? {} : { completed: input.completed }),
  };
  const found = await ctx.work.listTasks(scope, filters, { limit: pedido.limit, cursor: pedido.cursor });
  if (!found) {
    return {
      ok: false,
      code: 'not_found',
      message: 'Espaço, pasta ou lista não encontrado neste recorte.',
    };
  }

  const canPeople = scope.capabilities.has('people:read');
  const cards: ListTasksItem[] = found.tasks.map((task) => ({ ...task, people: canPeople ? task.people : null }));

  const meta = envelope(ctx);
  const query = (Object.entries(input) as Array<[string, unknown]>)
    .filter(([nome, valor]) => nome !== 'limit' && nome !== 'cursor' && valor !== undefined)
    .map(([nome, valor]) => `${nome}=${encodeURIComponent(String(valor))}`);
  const self = query.length === 0 ? LIST_TASKS_PATH : `${LIST_TASKS_PATH}?${query.join('&')}`;
  const assemble = (page: { items: ListTasksItem[]; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'list_tasks' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    today,
    total: found.total,
    tasks: page.items,
  });
  const paged = pageAndFit(cards, {
    limit: input.limit,
    cursor: input.cursor,
    key: (task) => ({ k: titleOrderKey(task.title), id: task.id }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = listTasksResponseSchema.parse(assemble(paged));
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/** O dia de hoje em São Paulo (`AAAA-MM-DD`), o mesmo relógio das leituras de entrega. */
function civilDayInAgency(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENCY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/**
 * G5 — `list_clients`: a carteira ATIVA do recorte com o cadastro de cada
 * cliente (plano, urgência, financeiro, início, renovação, etiquetas), sob
 * `clients:read`. O catálogo já devolve só o que o recorte da concessão alcança
 * (empresa, cliente, omitidas); os filtros (empresa, urgência, nome) só
 * estreitam o que sobrou — empresa que a conexão não alcança dá lista vazia, a
 * mesma resposta de uma empresa sem cliente.
 */
export async function listClientsWork(
  ctx: ReadCtx,
  input: ListClientsInput,
): Promise<ReadResult<ListClientsResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('clients:read')) return DENIED;

  // Limite e cursor ruins são recusados ANTES de ler o banco.
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  const todos = await ctx.work.listClients(scope);
  const agulha = input.q === undefined ? null : semAcento(input.q.trim());
  const doFiltro = todos.filter(
    (client) =>
      (input.companyId === undefined || client.company.id === input.companyId) &&
      (input.urgency === undefined || client.urgency === input.urgency) &&
      (agulha === null || agulha.length === 0 || semAcento(client.name).includes(agulha)),
  );

  const meta = envelope(ctx);
  const filtros = [
    input.companyId === undefined ? null : `companyId=${encodeURIComponent(input.companyId)}`,
    input.urgency === undefined ? null : `urgency=${input.urgency}`,
    input.q === undefined ? null : `q=${encodeURIComponent(input.q)}`,
  ].filter((parte): parte is string => parte !== null);
  const self = filtros.length === 0 ? LIST_CLIENTS_PATH : `${LIST_CLIENTS_PATH}?${filtros.join('&')}`;
  const assemble = (page: { items: ListClientsItem[]; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'list_clients' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    total: doFiltro.length,
    clients: page.items,
  });
  const paged = pageAndFit(
    doFiltro.map((client): ListClientsItem => ({ ...client })),
    {
      limit: input.limit,
      cursor: input.cursor,
      // Por nome sem acento nem caixa: "Água Viva" fica entre o A e o B, não depois do Z.
      key: (client) => ({ k: semAcento(client.name), id: client.id }),
      envelopeOf: assemble,
    },
  );
  if (!('items' in paged)) return asPageError(paged);

  const body = listClientsResponseSchema.parse(assemble(paged));
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/**
 * A chave de ordem DECRESCENTE de um texto de largura fixa (instante ISO,
 * `AAAA-MM-DD`): cada dígito vira 9 − dígito. A paginação estável ordena por
 * chave CRESCENTE; com a chave invertida, o mais novo vem primeiro, e o cursor
 * continua sendo o de sempre (chave + id).
 */
function descendingKey(text: string): string {
  return text.replace(/\d/g, (digit) => String(9 - Number(digit)));
}

/**
 * F26.6 — `get_client_mural`: as notas do mural do cliente, das mais novas para
 * as mais antigas, sob `clients:read` e o recorte da concessão.
 */
export async function getClientMuralWork(
  ctx: ReadCtx,
  input: { clientId: string; limit?: number; cursor?: string },
): Promise<ReadResult<GetClientMuralResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('clients:read')) return DENIED;

  const view = await ctx.work.getClientMural(scope, input.clientId);
  if (!view) return DENIED;

  const items: MuralNoteItem[] = view.items.map((note) => ({
    id: note.id,
    title: note.title,
    content: note.content,
    color: note.color,
    author: note.author,
    viaName: note.viaName,
    // A regra do banco (F26.2): só o que a IA da MESMA pessoa escreveu.
    agentEditable: note.viaName !== null && note.createdById === ctx.grant.ownerId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }));
  const meta = envelope(ctx);
  const self = `${GET_CLIENT_MURAL_PATH}?clientId=${encodeURIComponent(view.client.id)}`;
  const assemble = (page: { items: MuralNoteItem[]; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'get_client_mural' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    client: view.client,
    items: page.items,
  });
  const paged = pageAndFit(items, {
    limit: input.limit,
    cursor: input.cursor,
    key: (item) => ({ k: descendingKey(item.createdAt), id: item.id }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = getClientMuralResponseSchema.parse(assemble(paged));
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/**
 * F26.6 — `get_client_history`: os registros do histórico do cliente, do fato
 * mais recente para o mais antigo (`happenedOn`, depois a hora do registro).
 * Documentos anexos saem só contados: o link é outra porta, fora do escopo.
 */
const HISTORY_QUERY_MESSAGE = `Informe a busca (query) com 1 a ${CLIENT_HISTORY_QUERY_MAX} caracteres, ou omita o campo.`;

/** Frase de `invalid_input` do `get_client_history`: a busca ruim não vira "falta o clientId". */
export function clientHistoryInputMessage(error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }> }): string {
  return error.issues.some((issue) => issue.path[0] === 'query')
    ? HISTORY_QUERY_MESSAGE
    : 'Informe o id do cliente (clientId).';
}

export async function getClientHistoryWork(
  ctx: ReadCtx,
  input: { clientId: string; limit?: number; cursor?: string; query?: string },
): Promise<ReadResult<GetClientHistoryResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('clients:read')) return DENIED;

  // O contrato já apara; aqui vale de novo para quem chama `Work` direto.
  const query = input.query?.trim();
  if (input.query !== undefined && (query === undefined || query.length === 0 || query.length > CLIENT_HISTORY_QUERY_MAX)) {
    return { ok: false, code: 'invalid_input', message: HISTORY_QUERY_MESSAGE };
  }
  const view = await ctx.work.getClientHistory(scope, input.clientId, query);
  if (!view) return DENIED;

  const items: HistoryEntryItem[] = view.items.map((entry) => ({
    id: entry.id,
    happenedOn: entry.happenedOn,
    title: entry.title,
    subtitle: entry.subtitle,
    body: entry.body,
    ledBy: entry.ledBy,
    ledByNote: entry.ledByNote,
    author: entry.author,
    documentCount: entry.documentCount,
    viaName: entry.viaName,
    agentEditable: entry.viaName !== null && entry.createdById === ctx.grant.ownerId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
  const meta = envelope(ctx);
  const self = `${GET_CLIENT_HISTORY_PATH}?clientId=${encodeURIComponent(view.client.id)}`;
  const assemble = (page: { items: HistoryEntryItem[]; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'get_client_history' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    client: view.client,
    items: page.items,
  });
  const paged = pageAndFit(items, {
    limit: input.limit,
    cursor: input.cursor,
    key: (item) => ({
      k: `${descendingKey(item.happenedOn)}:${descendingKey(item.createdAt)}`,
      id: item.id,
    }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = getClientHistoryResponseSchema.parse(assemble(paged));
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

export async function listCommentsWork(
  ctx: ReadCtx,
  input: { taskId: string; limit?: number; cursor?: string },
): Promise<ReadResult<ListCommentsResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('comments:read')) return DENIED;

  // O cursor do `get_task` (descrição ou comentário) não é deste: a chave dele
  // ordena depois de toda data, e a página viria vazia como se a conversa
  // tivesse acabado. Recusa dizendo de onde ele é.
  if (input.cursor) {
    const lido = decodePageCursor(input.cursor);
    if (lido.ok && (lido.cursor.k === TASK_COMMENT_CURSOR || lido.cursor.k === 'description')) {
      return {
        ok: false,
        code: 'invalid_cursor',
        message: 'Este cursor é do get_task: continue por lá, ou comece list_comments sem cursor.',
      };
    }
  }

  const comments = await ctx.work.listComments(scope, input.taskId);
  if (comments === null) return DENIED;

  const meta = envelope(ctx);
  const self = `${LIST_COMMENTS_PATH}?taskId=${encodeURIComponent(input.taskId)}`;
  const key = (item: WorkCommentView) => ({ k: item.createdAt, id: item.id });
  const paged = pageAndFit(comments, {
    limit: input.limit,
    cursor: input.cursor,
    key,
    envelopeOf: (page) => ({
      operation: 'list_comments',
      queriedAt: meta.queriedAt,
      self,
      effectiveScope: meta.effectiveScope,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      taskId: input.taskId,
      items: page.items,
    }),
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = listCommentsResponseSchema.parse({
    operation: 'list_comments',
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: paged.hasMore,
    nextCursor: paged.nextCursor,
    taskId: input.taskId,
    items: paged.items,
  });
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

export async function listPeopleWork(
  ctx: ReadCtx,
  input: { limit?: number; cursor?: string } = {},
): Promise<ReadResult<ListPeopleResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('people:read')) return DENIED;

  const people = await ctx.work.listPeople(scope);
  const meta = envelope(ctx);
  const key = (item: WorkPersonView) => ({ k: fold(item.displayName), id: item.id });
  const paged = pageAndFit(people, {
    limit: input.limit,
    cursor: input.cursor,
    key,
    envelopeOf: (page) => ({
      operation: 'list_people',
      queriedAt: meta.queriedAt,
      self: LIST_PEOPLE_PATH,
      effectiveScope: meta.effectiveScope,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      items: page.items,
    }),
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = listPeopleResponseSchema.parse({
    operation: 'list_people',
    queriedAt: meta.queriedAt,
    self: LIST_PEOPLE_PATH,
    effectiveScope: meta.effectiveScope,
    hasMore: paged.hasMore,
    nextCursor: paged.nextCursor,
    items: paged.items,
  });
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

export async function getPersonWork(
  ctx: ReadCtx,
  input: { id: string; limit?: number; cursor?: string },
): Promise<ReadResult<GetPersonWorkResponse>> {
  const scope = toWorkScope(ctx.person, ctx.grant, ctx.now);
  if (!scope.capabilities.has('people:read')) return DENIED;

  // F38, Fase 6.1 — limite e cursor descem ao SQL, como em `getBoardWork`.
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  const found = await ctx.work.getPersonWork(scope, input.id, { limit: pedido.limit, cursor: pedido.cursor });
  if (!found) return DENIED;

  const meta = envelope(ctx);
  const self = `${GET_PERSON_WORK_PATH}?id=${encodeURIComponent(found.person.id)}`;
  const key = (item: WorkPersonTaskView) => ({ k: titleOrderKey(item.title), id: item.id });
  const paged = pageAndFit(found.tasks, {
    limit: input.limit,
    cursor: input.cursor,
    key,
    envelopeOf: (page) => ({
      operation: 'get_person_work',
      queriedAt: meta.queriedAt,
      self,
      effectiveScope: meta.effectiveScope,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      person: found.person,
      counts: found.counts,
      returned: page.returned,
      items: page.items.map((item) => {
        const { completedAt, ...rest } = item;
        void completedAt;
        return rest;
      }),
    }),
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = getPersonWorkResponseSchema.parse({
    operation: 'get_person_work',
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    hasMore: paged.hasMore,
    nextCursor: paged.nextCursor,
    person: found.person,
    counts: found.counts,
    returned: paged.returned,
    items: paged.items.map((item) => {
      const { completedAt, ...rest } = item;
      void completedAt;
      return rest;
    }),
  });
  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}
