/**
 * O CONTRATO DO MCP, PONTA A PONTA — conferência de qualidade de 09/10/2026.
 *
 * COMO SE MEDE
 *   Um cliente MCP de verdade (o do SDK) fala com o servidor pelo par em
 *   memória do SDK (`InMemoryTransport`), sobre as portas em memória de todo o
 *   resto da suíte. Nada de rede, de banco ou de segredo. O cliente do SDK
 *   também confere `structuredContent` contra o `outputSchema` que `tools/list`
 *   anunciou: uma saída fora do contrato derruba a chamada.
 *
 * O QUE ESTE ARQUIVO TRAVA, PARA UMA FERRAMENTA NOVA NÃO NASCER QUEBRADA
 *   1. `tools/list`: as 38 ferramentas, na ordem de `MCP_TOOL_NAMES`, com título,
 *      descrição e os schemas de entrada e saída; o `inputSchema` anunciado é o
 *      do contrato (mesmos campos, mesmos obrigatórios, estrito).
 *   2. Cada exemplo de `_meta.examples` (e uma entrada mínima) roda na massa e
 *      devolve resultado que valida contra o `outputSchema`, com `content` em
 *      DOIS blocos: a linha-resumo e o corpo inteiro em JSON (igual a
 *      `structuredContent`, no mesmo teto de 64 KiB que a HTTP respeita).
 *   3. As anotações (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
 *      `openWorldHint`) de cada ferramenta.
 *   4. Toda recusa (`isError`) vem como `{ error, message }` com código estável
 *      e frase em português que diz o que fazer — entrada inválida, permissão
 *      que falta, id fora do recorte, cursor, escritas desligadas, teto do dia.
 *   5. A tabela de permissões usada nessas frases confere com o comportamento
 *      REAL de cada ferramenta (tira-se uma permissão por vez e vê-se quem recusa).
 *   6. `get_context` diz, em texto, o que as permissões da conexão liberam.
 *   7. O custo de contexto: o tamanho de `tools/list` e das descrições, que só
 *      citam ferramentas que existem e apontam o próximo passo.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LATEST_PROTOCOL_VERSION, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { z, type ZodTypeAny } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import {
  GET_MONTH_ATTENTION_PATH,
  GET_TASK_PATH,
  INTEGRATION_ERROR_CODES,
  INTEGRATION_WRITES_UNAVAILABLE_MESSAGE,
  SEARCH_PATH,
  addCommentInputSchema,
  addCommentResponseSchema,
  addHistoryEntryInputSchema,
  addHistoryEntryResponseSchema,
  addMuralNoteInputSchema,
  addMuralNoteResponseSchema,
  assignTaskInputSchema,
  assignTaskResponseSchema,
  completeTaskInputSchema,
  completeTaskResponseSchema,
  createTaskInputSchema,
  createTaskResponseSchema,
  getAdminWeekInputSchema,
  getAdminWeekResponseSchema,
  getBoardInputSchema,
  getBoardResponseSchema,
  getCalendarInputSchema,
  getCalendarResponseSchema,
  getClientDeliveryHistoryInputSchema,
  getClientDeliveryHistoryResponseSchema,
  getClientHistoryInputSchema,
  getClientHistoryResponseSchema,
  getClientInputSchema,
  getClientMonthInputSchema,
  getClientMonthResponseSchema,
  getClientMuralInputSchema,
  getClientMuralResponseSchema,
  getClientResponseSchema,
  getContextInputSchema,
  getContextResponseSchema,
  getDeliveryReportInputSchema,
  getDeliveryReportResponseSchema,
  getDeliveryStatusInputSchema,
  getDeliveryStatusResponseSchema,
  getDeliveryTrendInputSchema,
  getDeliveryTrendResponseSchema,
  getMarketingReportInputSchema,
  getMarketingReportResponseSchema,
  getMonthAttentionInputSchema,
  getMonthAttentionResponseSchema,
  getPersonWorkInputSchema,
  getPersonWorkResponseSchema,
  getPlanningWeeksInputSchema,
  getPlanningWeeksResponseSchema,
  getTaskInputSchema,
  getTaskResponseSchema,
  getWorkflowInputSchema,
  getWorkflowResponseSchema,
  listBoardsInputSchema,
  listBoardsResponseSchema,
  listClientsInputSchema,
  listClientsResponseSchema,
  listCommentsInputSchema,
  listCommentsResponseSchema,
  listPeopleInputSchema,
  listPeopleResponseSchema,
  listTagsInputSchema,
  listTagsResponseSchema,
  listTasksInputSchema,
  listTasksResponseSchema,
  moveTaskInputSchema,
  moveTaskResponseSchema,
  previewMoveInputSchema,
  previewMoveResponseSchema,
  releaseTaskInputSchema,
  releaseTaskResponseSchema,
  reopenTaskInputSchema,
  reopenTaskResponseSchema,
  searchInputSchema,
  searchResponseSchema,
  updateHistoryEntryInputSchema,
  updateHistoryEntryResponseSchema,
  updateMuralNoteInputSchema,
  updateMuralNoteResponseSchema,
  updateTaskInputSchema,
  updateTaskResponseSchema,
} from '@/integrations/contract';
import { MemoryAdminWeekCatalog } from '@/integrations/admin-semana';
import { MemoryCatalog } from '@/integrations/context';
import { MemoryAgentWriteStore } from '@/integrations/executions';
import {
  INTEGRATION_CAPABILITIES,
  type IntegrationCapability,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import {
  MCP_PREVIEW_TOOL_NAMES,
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
  compactText,
  criarServidorMcp,
  handleMcpRequest,
  type McpLoaded,
  type McpToolName,
} from '@/integrations/mcp';
import { EXIGENCIAS_DAS_FERRAMENTAS, permissoesQueFaltam } from '@/integrations/mcp-orientacao';
import { RESPONSE_BUDGET_BYTES } from '@/integrations/page';
import { MemoryWorkCatalog, type MemoryWorkData } from '@/integrations/reads';
import { MemoryDeliveryCatalog, type MemoryDeliveryData } from '@/integrations/reports';
import {
  MemoryClientRecordBoard,
  MemoryCommentBoard,
  MemoryMoveBoard,
  MemoryTaskBoard,
} from '@/integrations/writes';
import type { ControleDaSemana } from '@/server/controle-da-semana';

// A primeira ferramenta pagar a conversão dos 38 schemas (`tools/list`); numa máquina cheia isso passa de 5 s.
vi.setConfig({ testTimeout: 30_000 });

/* ───────────────────────────── a massa ───────────────────────────── */

const ORIGIN = 'https://ideworks.test';
const AGORA = new Date('2026-10-09T15:00:00.000Z');
const EMPRESA = 'empresa-a';
const DONO = '22222222-2222-4222-8222-222222222222';
const CONCESSAO = '11111111-1111-4111-8111-111111111111';
const NOME_DA_CONEXAO = 'Claude da agência';

// As leituras: os ids que os exemplos de `tools/list` usam.
const CLIENTE_JATOBA = 'cliente-jatoba';
const CLIENTE_CLINIMAX = '44444444-4444-4444-8444-444444444444';
const LISTA_ATENDIMENTO = 'lista-atendimento-jatoba';
const LISTA_DA_ESTEIRA = '11111111-2222-3333-4444-555555555555';
const ESPACO = 'eeeeeee1-eee1-4ee1-8ee1-eeeeeeeeeee1';
const TAREFA_DA_PECA = 'tarefa-peca';
const PESSOA_HELENA = 'pessoa-helena';
const ETIQUETA = 'ccccccc1-ccc1-4cc1-8cc1-ccccccccccc1';

// As escritas: os ids que os exemplos de `tools/list` usam.
const TAREFA = '33333333-3333-4333-8333-333333333333';
const PESSOA_DO_TIME = '11111111-1111-1111-1111-111111111111';
const LISTA_A = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const LISTA_B = 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2';
const ETAPA_ATRIBUIR = 'bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1';
const ETAPA_FEITO = 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2';
const ETAPA_EM_PRODUCAO = 'bbbbbbb3-bbb3-4bb3-8bb3-bbbbbbbbbbb3';
const ETAPA_AFAZER_VIDEO = 'bbbbbbb4-bbb4-4bb4-8bb4-bbbbbbbbbbb4';
const ETAPA_B_ABERTA = 'bbbbbbb5-bbb5-4bb5-8bb5-bbbbbbbbbbb5';
const ETAPA_B_FEITO = 'bbbbbbb6-bbb6-4bb6-8bb6-bbbbbbbbbbb6';
const NOTA_DA_IA = '55555555-5555-4555-8555-555555555555';
const REGISTRO_DA_IA = '66666666-6666-4666-8666-666666666666';

const PESSOA: PersonAccess = {
  userId: DONO,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [EMPRESA],
  clientIds: [CLIENTE_JATOBA, CLIENTE_CLINIMAX],
  hasAllClientsAccess: true,
};

const SEMANA: ControleDaSemana = {
  week: { start: '2026-10-05', end: '2026-10-11', today: '2026-10-09', isCurrent: true, previous: '2026-09-28', next: '2026-10-12' },
  toAssign: [
    {
      clientId: CLIENTE_CLINIMAX,
      clientName: 'Clinimax',
      type: 'video',
      cards: [
        {
          id: TAREFA,
          title: 'Reels de outubro',
          createdBy: { id: PESSOA_DO_TIME, name: 'Helena' },
          suggestedDueOn: '2026-10-09',
          list: { id: LISTA_A, name: 'Clinimax' },
        },
      ],
    },
  ],
  progress: [{ clientId: CLIENTE_CLINIMAX, clientName: 'Clinimax', type: 'video', awaiting: 1, todo: 0, doing: 1, done: 0 }],
  missing: {
    items: [{ clientId: CLIENTE_CLINIMAX, clientName: 'Clinimax', type: 'video', target: 2, cards: 1, missing: 1 }],
    overdue: [],
    overdueTotal: 0,
  },
};

const ESTEIRA = [
  { id: ETAPA_ATRIBUIR, name: 'Atribuir Demanda', color: null, type: 'open' as const },
  { id: ETAPA_AFAZER_VIDEO, name: 'A fazer Vídeo', color: null, type: 'custom' as const },
  { id: ETAPA_FEITO, name: 'Feito', color: null, type: 'closed' as const },
];

function dadosDasLeituras(): MemoryWorkData {
  return {
    tags: [{ id: ETIQUETA, spaceId: ESPACO, name: 'Reels' }],
    boards: [
      {
        id: LISTA_ATENDIMENTO,
        name: 'Atendimento',
        companyId: EMPRESA,
        companyName: 'Agência Ide',
        spaceId: ESPACO,
        spaceName: 'Entrega',
        folderId: null,
        folderName: null,
        clientId: CLIENTE_JATOBA,
        clientName: 'Jatobá',
        canSeeSpace: true,
        statuses: [
          { id: 'status-aberto', name: 'Aberto', sortOrder: 1, type: 'open' },
          { id: 'status-feito', name: 'Feito', sortOrder: 2, type: 'closed' },
        ],
      },
      {
        id: LISTA_DA_ESTEIRA,
        name: 'Redes sociais',
        companyId: EMPRESA,
        companyName: 'Agência Ide',
        spaceId: ESPACO,
        spaceName: 'Entrega',
        folderId: 'pasta-clinimax',
        folderName: 'Clinimax',
        clientId: CLIENTE_CLINIMAX,
        clientName: 'Clinimax',
        canSeeSpace: true,
        isProduction: true,
        statuses: [
          { id: ETAPA_ATRIBUIR, name: 'Atribuir Demanda', sortOrder: 1, type: 'open' },
          { id: ETAPA_AFAZER_VIDEO, name: 'A fazer Vídeo', sortOrder: 2, type: 'custom' },
          { id: ETAPA_FEITO, name: 'Feito', sortOrder: 3, type: 'closed' },
        ],
      },
    ],
    tasks: [
      {
        id: TAREFA_DA_PECA,
        title: 'Peça da campanha Jatobá',
        description: 'Briefing curto.',
        companyId: EMPRESA,
        companyName: 'Agência Ide',
        boardId: LISTA_ATENDIMENTO,
        clientId: CLIENTE_JATOBA,
        clientName: 'Jatobá',
        statusId: 'status-aberto',
        dueOn: '2026-09-30',
        priority: 'urgent',
        startOn: '2026-09-24',
        people: [{ id: PESSOA_HELENA, name: 'Helena' }],
      },
    ],
    clients: [
      {
        id: CLIENTE_JATOBA,
        name: 'Jatobá',
        companyId: EMPRESA,
        companyName: 'Agência Ide',
        listIds: [LISTA_ATENDIMENTO],
        urgency: 'alerta',
        plan: { id: 'plano-1', name: 'Plano 8' },
        renewsOn: '2026-11-15',
      },
      {
        id: CLIENTE_CLINIMAX,
        name: 'Clinimax',
        companyId: EMPRESA,
        companyName: 'Agência Ide',
        listIds: [LISTA_DA_ESTEIRA],
      },
    ],
    comments: [
      {
        id: 'comentario-1',
        taskId: TAREFA_DA_PECA,
        parentId: null,
        body: 'Tudo certo por aqui.',
        createdAt: '2026-09-21T04:00:00.000Z',
        author: { id: PESSOA_HELENA, name: 'Helena' },
      },
    ],
    people: [
      {
        id: PESSOA_HELENA,
        name: 'Helena',
        companyId: EMPRESA,
        companyName: 'Agência Ide',
        detail: 'atendimento',
      },
    ],
    muralNotes: [
      {
        id: NOTA_DA_IA,
        clientId: CLIENTE_CLINIMAX,
        title: 'Reunião de pauta',
        content: 'Cliente quer vídeo de bastidores.',
        color: 'yellow',
        author: { id: PESSOA_HELENA, name: 'Helena' },
        createdById: DONO,
        viaName: NOME_DA_CONEXAO,
        createdAt: '2026-09-20T10:00:00.000Z',
        updatedAt: '2026-09-20T10:00:00.000Z',
      },
    ],
    historyEntries: [
      {
        id: REGISTRO_DA_IA,
        clientId: CLIENTE_CLINIMAX,
        happenedOn: '2026-09-21',
        title: 'Reunião de alinhamento',
        subtitle: null,
        body: 'Definimos as pautas de outubro.',
        ledBy: null,
        ledByNote: null,
        author: { id: PESSOA_HELENA, name: 'Helena' },
        createdById: DONO,
        viaName: NOME_DA_CONEXAO,
        documentCount: 0,
        createdAt: '2026-09-21T12:00:00.000Z',
        updatedAt: '2026-09-21T12:00:00.000Z',
      },
    ],
  };
}

/** As leituras da massa; `ajustar` acrescenta o que um caso precisa (muitas tarefas, uma descrição enorme…). */
function montarLeituras(ajustar?: (dados: MemoryWorkData) => MemoryWorkData): MemoryWorkCatalog {
  const dados = dadosDasLeituras();
  return new MemoryWorkCatalog(ajustar ? ajustar(dados) : dados);
}

function dadosDaEntrega(): MemoryDeliveryData {
  const meses = ['2026-07', '2026-08', '2026-09', '2026-10'];
  const clientes = [CLIENTE_JATOBA, CLIENTE_CLINIMAX];
  return {
    clients: [
      { id: CLIENTE_JATOBA, name: 'Jatobá', companyId: EMPRESA, companyName: 'Agência Ide' },
      { id: CLIENTE_CLINIMAX, name: 'Clinimax', companyId: EMPRESA, companyName: 'Agência Ide' },
    ],
    contracts: meses.flatMap((mes) =>
      clientes.flatMap((clientId) => [
        { clientId, referenceMonth: `${mes}-01`, contentType: 'arte', quantity: 2 },
        { clientId, referenceMonth: `${mes}-01`, contentType: 'video', quantity: 1 },
      ]),
    ),
    items: [
      ...meses.slice(0, 3).flatMap((mes) =>
        clientes.map((clientId, i) => ({
          clientId,
          referenceMonth: `${mes}-01`,
          scheduledOn: `${mes}-1${i}`,
          contentType: 'arte',
          isExtra: false,
          isCompleted: true,
        })),
      ),
      {
        id: 'peca-outubro-1',
        title: 'Arte de lançamento',
        clientId: CLIENTE_JATOBA,
        referenceMonth: '2026-10-01',
        scheduledOn: '2026-10-05',
        contentType: 'arte',
        isExtra: false,
        isCompleted: true,
      },
      {
        id: 'peca-outubro-2',
        title: 'Vídeo de bastidores',
        clientId: CLIENTE_JATOBA,
        referenceMonth: '2026-10-01',
        scheduledOn: '2026-10-07',
        contentType: 'video',
        isExtra: false,
        isCompleted: false,
      },
    ],
    opened: meses.flatMap((mes) => clientes.map((clientId) => ({ clientId, referenceMonth: `${mes}-01` }))),
    contentContractClientIds: clientes,
    registry: clientes.map((clientId) => ({ clientId, contentType: 'arte', quantity: 2 })),
    folders: [{ clientId: CLIENTE_JATOBA, folderId: 'pasta-helena', folderName: 'TIME HELENA' }],
    appointments: [
      { id: 'compromisso-1', clientId: CLIENTE_JATOBA, day: '2026-10-08', time: '10:00', title: 'Gravação' },
    ],
  };
}

/** A entrega da massa; `ajustar` acrescenta o que um caso precisa (muitos clientes…). */
function montarEntrega(ajustar?: (dados: MemoryDeliveryData) => MemoryDeliveryData): MemoryDeliveryCatalog {
  const dados = dadosDaEntrega();
  return new MemoryDeliveryCatalog(ajustar ? ajustar(dados) : dados);
}

function montarMarketing(): MemoryMarketingCatalog {
  return new MemoryMarketingCatalog({
    assets: [
      {
        id: 'conta-anuncio-jatoba',
        kind: 'ad_account',
        displayName: 'Jatobá ads',
        externalId: 'act-a',
        clientId: CLIENTE_JATOBA,
        clientName: 'Jatobá',
        companyId: EMPRESA,
        companyName: 'Agência Ide',
        currency: 'BRL',
        lastSeenAt: '2026-09-04T12:00:00.000Z',
      },
    ],
    paidDays: [
      {
        assetId: 'conta-anuncio-jatoba',
        day: '2026-09-01',
        campaignId: 'camp-1',
        campaignName: 'Campanha',
        spend: 10,
        reach: 100,
        impressions: 50,
        clicks: 2,
        linkClicks: 1,
        conversions: null,
        conversionValue: null,
        collectedAt: '2026-09-04T12:00:00.000Z',
      },
    ],
    lastRun: {
      startedAt: '2026-09-04T11:50:00.000Z',
      finishedAt: '2026-09-04T12:00:00.000Z',
      outcome: 'ok',
      windowFrom: '2026-08-05',
      windowTo: '2026-09-04',
    },
  });
}

function montarTarefas(): MemoryTaskBoard {
  return new MemoryTaskBoard({
    lists: [
      {
        // Lista de produção: a esteira tem "Atribuir Demanda" (o que `release_task` lê).
        id: LISTA_A,
        name: 'Clinimax',
        companyId: EMPRESA,
        clientId: CLIENTE_CLINIMAX,
        openStatusId: ETAPA_ATRIBUIR,
        closedStatusId: ETAPA_FEITO,
        statuses: ESTEIRA,
        isProduction: true,
        tagIds: [ETIQUETA],
      },
      {
        id: LISTA_B,
        name: 'Jatobá',
        companyId: EMPRESA,
        clientId: CLIENTE_JATOBA,
        openStatusId: ETAPA_B_ABERTA,
        closedStatusId: ETAPA_B_FEITO,
        statuses: [
          { id: ETAPA_B_ABERTA, name: 'Aberta', color: null, type: 'open' },
          { id: ETAPA_EM_PRODUCAO, name: 'Em produção', color: null, type: 'custom' },
          { id: ETAPA_B_FEITO, name: 'Concluída', color: null, type: 'closed' },
        ],
      },
    ],
    people: [
      { id: DONO, companyIds: [EMPRESA] },
      { id: PESSOA_DO_TIME, companyIds: [EMPRESA] },
    ],
    tasks: [
      { taskId: TAREFA, listId: LISTA_A, title: 'Reels de outubro', type: 'video', dueOn: '2026-10-09', statusId: ETAPA_ATRIBUIR },
    ],
  });
}

function montarMovimento(): MemoryMoveBoard {
  return new MemoryMoveBoard({
    lists: [
      {
        id: LISTA_A,
        name: 'Clinimax',
        companyId: EMPRESA,
        clientId: CLIENTE_CLINIMAX,
        statuses: [{ id: ETAPA_ATRIBUIR, name: 'A fazer', type: 'open', color: null }],
      },
      {
        id: LISTA_B,
        name: 'Jatobá',
        companyId: EMPRESA,
        clientId: CLIENTE_JATOBA,
        statuses: [
          { id: ETAPA_B_ABERTA, name: 'A fazer', type: 'open', color: null },
          { id: ETAPA_B_FEITO, name: 'Feito', type: 'closed', color: null },
        ],
      },
    ],
    tasks: [
      {
        id: TAREFA,
        title: 'Reels de outubro',
        listId: LISTA_A,
        statusId: ETAPA_ATRIBUIR,
        parentId: null,
        clientId: null,
        companyId: EMPRESA,
        completedAt: null,
      },
    ],
  });
}

function montarMuralEHistorico(): MemoryClientRecordBoard {
  return new MemoryClientRecordBoard(
    { ownerId: DONO, viaName: NOME_DA_CONEXAO },
    {
      clients: [
        { id: CLIENTE_CLINIMAX, companyId: EMPRESA },
        { id: CLIENTE_JATOBA, companyId: EMPRESA },
      ],
      people: [
        { id: DONO, companyIds: [EMPRESA] },
        { id: PESSOA_DO_TIME, companyIds: [EMPRESA] },
      ],
      notes: [{ noteId: NOTA_DA_IA, clientId: CLIENTE_CLINIMAX, content: 'nota da IA', createdBy: DONO, viaName: NOME_DA_CONEXAO }],
      entries: [
        {
          entryId: REGISTRO_DA_IA,
          clientId: CLIENTE_CLINIMAX,
          happenedOn: '2026-09-21',
          title: 'Reunião',
          body: 'Relato',
          createdBy: DONO,
          viaName: NOME_DA_CONEXAO,
        },
      ],
    },
  );
}

type Opcoes = {
  /** As permissões da concessão. Padrão: as 14. */
  capacidades?: readonly IntegrationCapability[];
  /** Quem conectou é administrador agora? Padrão: sim. */
  admin?: boolean;
  writesEnabled?: boolean;
  /** Teto de escritas por dia da concessão (padrão do servidor: 50). */
  tetoDoDia?: number;
  /** Empresas da concessão (`null` = todas as que a pessoa alcança). */
  empresas?: readonly string[] | null;
  /** Acrescenta dados às leituras e à entrega da massa (casos de resposta grande). */
  leituras?: (dados: MemoryWorkData) => MemoryWorkData;
  entrega?: (dados: MemoryDeliveryData) => MemoryDeliveryData;
};

type Massa = {
  loaded: McpLoaded;
  store: MemoryAgentWriteStore;
  tarefas: MemoryTaskBoard;
};

function montarMassa(opcoes: Opcoes = {}): Massa {
  const pessoa: PersonAccess = { ...PESSOA, isSuperadmin: opcoes.admin !== false };
  const concessao: IntegrationGrant = {
    id: CONCESSAO,
    ownerId: DONO,
    oauthClientId: 'ideworks-claude',
    name: NOME_DA_CONEXAO,
    capabilities: [...(opcoes.capacidades ?? INTEGRATION_CAPABILITIES)],
    allowedCompanyIds: opcoes.empresas === undefined ? null : opcoes.empresas,
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
    ...(opcoes.tetoDoDia === undefined ? {} : { dailyWriteLimit: opcoes.tetoDoDia }),
  };
  const store = new MemoryAgentWriteStore();
  store.seedPerson(pessoa);
  store.seedGrant(concessao);
  const tarefas = montarTarefas();
  const comentarios = new MemoryCommentBoard(DONO, {
    taskCompanies: new Map([[TAREFA, EMPRESA]]),
    taskClients: new Map([[TAREFA, CLIENTE_CLINIMAX]]),
  });
  const loaded: McpLoaded = {
    grant: concessao,
    person: pessoa,
    origin: 'mcp',
    companies: [{ id: EMPRESA, name: 'Agência Ide' }],
    displayName: 'Wesley Lourenço',
    work: montarLeituras(opcoes.leituras),
    delivery: montarEntrega(opcoes.entrega),
    marketing: montarMarketing(),
    writes: store,
    comments: comentarios,
    board: montarMovimento(),
    tasks: tarefas,
    clientRecords: montarMuralEHistorico(),
    adminWeek: new MemoryAdminWeekCatalog(async () => SEMANA),
    now: AGORA,
    writesEnabled: opcoes.writesEnabled !== false,
  };
  return { loaded, store, tarefas };
}

/** Prepara o estado que um exemplo pressupõe (reabrir exige tarefa concluída). */
const PREPARO: Partial<Record<McpToolName, (massa: Massa) => void>> = {
  reopen_task: ({ tarefas }) => {
    const linha = tarefas.tasks.get(TAREFA)!;
    tarefas.tasks.set(TAREFA, { ...linha, completed: true, statusId: ETAPA_FEITO, completedBy: DONO });
  },
};

/* ───────────────────────────── massas grandes (o teto de 64 KiB) ───────────────────────────── */

const PARAGRAFO = 'Briefing da campanha de lançamento: roteiro, referências visuais e prazos combinados com o cliente. ';

/**
 * Uma tarefa de descrição enorme (~225 KB, mais de três tetos de resposta) e 150 comentários:
 * `get_task` só cabe em páginas, por `nextCursor`.
 */
const comTarefaLonga = (dados: MemoryWorkData): MemoryWorkData => ({
  ...dados,
  tasks: [
    ...(dados.tasks ?? []),
    {
      id: 'tarefa-longa',
      title: 'Campanha de lançamento (briefing completo)',
      description: PARAGRAFO.repeat(2300),
      companyId: EMPRESA,
      companyName: 'Agência Ide',
      boardId: LISTA_ATENDIMENTO,
      clientId: CLIENTE_JATOBA,
      clientName: 'Jatobá',
      statusId: 'status-aberto',
      dueOn: '2026-10-30',
      people: [{ id: PESSOA_HELENA, name: 'Helena' }],
    },
  ],
  comments: [
    ...(dados.comments ?? []),
    ...Array.from({ length: 150 }, (_, i) => ({
      id: `comentario-longo-${i}`,
      taskId: 'tarefa-longa',
      parentId: null,
      body: `Comentário ${i}: ${'ajuste combinado com o cliente na reunião de alinhamento. '.repeat(4)}`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 12, i)).toISOString(),
      author: { id: PESSOA_HELENA, name: 'Helena' },
    })),
  ],
});

/** 400 tarefas que casam com a busca "Campanha": `search` devolve o máximo de uma página (limit 100). */
const comMuitasTarefas = (dados: MemoryWorkData): MemoryWorkData => ({
  ...dados,
  tasks: [
    ...(dados.tasks ?? []),
    ...Array.from({ length: 400 }, (_, i) => ({
      id: `tarefa-campanha-${String(i).padStart(3, '0')}`,
      title: `Campanha ${String(i).padStart(3, '0')} — peça para o feed do cliente`,
      description: null,
      companyId: EMPRESA,
      companyName: 'Agência Ide',
      boardId: LISTA_ATENDIMENTO,
      clientId: CLIENTE_JATOBA,
      clientName: 'Jatobá',
      statusId: 'status-aberto',
      dueOn: '2026-10-20',
      people: [{ id: PESSOA_HELENA, name: 'Helena' }],
    })),
  ],
});

/** 150 clientes ativos com contrato aberto em outubro: `get_month_attention` passa do teto e corta por `nextCursor`. */
const comMuitosClientes = (dados: MemoryDeliveryData): MemoryDeliveryData => {
  const ids = Array.from({ length: 150 }, (_, i) => `cliente-massa-${String(i).padStart(3, '0')}`);
  return {
    ...dados,
    clients: [
      ...(dados.clients ?? []),
      ...ids.map((id, i) => ({ id, name: `Cliente da carteira ${String(i).padStart(3, '0')}`, companyId: EMPRESA, companyName: 'Agência Ide' })),
    ],
    contracts: [
      ...(dados.contracts ?? []),
      ...ids.flatMap((clientId) => [
        { clientId, referenceMonth: '2026-10-01', contentType: 'arte', quantity: 4 },
        { clientId, referenceMonth: '2026-10-01', contentType: 'video', quantity: 2 },
        { clientId, referenceMonth: '2026-10-01', contentType: 'foto', quantity: 2 },
      ]),
    ],
    items: [
      ...(dados.items ?? []),
      ...ids.flatMap((clientId) => [
        { clientId, referenceMonth: '2026-10-01', scheduledOn: '2026-10-06', contentType: 'arte', isExtra: false, isCompleted: true },
        { clientId, referenceMonth: '2026-10-01', scheduledOn: '2026-10-08', contentType: 'video', isExtra: false, isCompleted: false },
      ]),
    ],
    opened: [...(dados.opened ?? []), ...ids.map((clientId) => ({ clientId, referenceMonth: '2026-10-01' }))],
    contentContractClientIds: [...(dados.contentContractClientIds ?? []), ...ids],
  };
};

/* ───────────────────────────── o cliente MCP ───────────────────────────── */

type Conectado = { cliente: Client; fechar: () => Promise<void> };

/**
 * Liga um cliente MCP ao servidor pelo par em memória. `validarSaida` faz o
 * cliente do SDK buscar `tools/list` e conferir cada `structuredContent` contra
 * o `outputSchema` anunciado — custa ~0,4 s por conexão (o servidor converte os
 * 38 schemas), então só a prova de "cliente de verdade" a liga; os demais casos
 * conferem a saída com o mesmo JSON Schema, uma vez por ferramenta.
 */
async function conectar(massa: Massa = montarMassa(), opcoes: { validarSaida?: boolean } = {}): Promise<Conectado> {
  const servidor = criarServidorMcp(massa.loaded);
  const [doCliente, doServidor] = InMemoryTransport.createLinkedPair();
  await servidor.connect(doServidor);
  const cliente = new Client({ name: 'contrato-ponta-a-ponta', version: '1.0.0' });
  await cliente.connect(doCliente);
  if (opcoes.validarSaida) await cliente.listTools();
  return {
    cliente,
    fechar: async () => {
      await cliente.close();
      await servidor.close();
    },
  };
}

type Resultado = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

/** Uma chamada numa conexão nova (e uma massa nova, ou a dada). */
async function chamar(nome: string, args: unknown, massa: Massa = montarMassa()): Promise<Resultado> {
  const { cliente, fechar } = await conectar(massa);
  try {
    return (await cliente.callTool({ name: nome, arguments: args as Record<string, unknown> })) as Resultado;
  } finally {
    await fechar();
  }
}

function textoDe(resultado: Resultado): string {
  return resultado.content?.[0]?.text ?? '';
}

/** A recusa como o agente a lê: `{ error, message, … }`. */
function recusaDe(resultado: Resultado): { error: string; message: string; [chave: string]: unknown } {
  expect(resultado.isError).toBe(true);
  return JSON.parse(textoDe(resultado)) as { error: string; message: string };
}

/** A ferramenta como `tools/list` a anuncia, com os exemplos de `_meta`. */
type Ferramenta = Tool & {
  title: string;
  description: string;
  outputSchema: NonNullable<Tool['outputSchema']>;
  _meta: { examples: Array<{ input: Record<string, unknown>; output?: unknown }> };
};

let listagem: Promise<Ferramenta[]> | undefined;

/** O `tools/list` pelo cliente MCP, lido uma vez por arquivo. */
function listar(): Promise<Ferramenta[]> {
  listagem ??= (async () => {
    const { cliente, fechar } = await conectar();
    try {
      return (await cliente.listTools()).tools as Ferramenta[];
    } finally {
      await fechar();
    }
  })();
  return listagem;
}

/* ───────────────────────────── os contratos, por ferramenta ───────────────────────────── */

const ENTRADAS: Record<McpToolName, ZodTypeAny> = {
  get_context: getContextInputSchema,
  search: searchInputSchema,
  get_board: getBoardInputSchema,
  get_task: getTaskInputSchema,
  get_client: getClientInputSchema,
  list_people: listPeopleInputSchema,
  get_person_work: getPersonWorkInputSchema,
  list_comments: listCommentsInputSchema,
  get_delivery_report: getDeliveryReportInputSchema,
  get_marketing_report: getMarketingReportInputSchema,
  get_client_mural: getClientMuralInputSchema,
  get_client_history: getClientHistoryInputSchema,
  get_client_delivery_history: getClientDeliveryHistoryInputSchema,
  get_delivery_trend: getDeliveryTrendInputSchema,
  get_workflow: getWorkflowInputSchema,
  get_planning_weeks: getPlanningWeeksInputSchema,
  get_delivery_status: getDeliveryStatusInputSchema,
  get_admin_week: getAdminWeekInputSchema,
  get_month_attention: getMonthAttentionInputSchema,
  get_client_month: getClientMonthInputSchema,
  get_calendar: getCalendarInputSchema,
  list_tags: listTagsInputSchema,
  list_clients: listClientsInputSchema,
  list_boards: listBoardsInputSchema,
  list_tasks: listTasksInputSchema,
  add_comment: addCommentInputSchema,
  preview_move: previewMoveInputSchema,
  move_task: moveTaskInputSchema,
  create_task: createTaskInputSchema,
  update_task: updateTaskInputSchema,
  assign_task: assignTaskInputSchema,
  complete_task: completeTaskInputSchema,
  reopen_task: reopenTaskInputSchema,
  add_mural_note: addMuralNoteInputSchema,
  update_mural_note: updateMuralNoteInputSchema,
  add_history_entry: addHistoryEntryInputSchema,
  update_history_entry: updateHistoryEntryInputSchema,
  release_task: releaseTaskInputSchema,
};

const SAIDAS: Record<McpToolName, ZodTypeAny> = {
  get_context: getContextResponseSchema,
  search: searchResponseSchema,
  get_board: getBoardResponseSchema,
  get_task: getTaskResponseSchema,
  get_client: getClientResponseSchema,
  list_people: listPeopleResponseSchema,
  get_person_work: getPersonWorkResponseSchema,
  list_comments: listCommentsResponseSchema,
  get_delivery_report: getDeliveryReportResponseSchema,
  get_marketing_report: getMarketingReportResponseSchema,
  get_client_mural: getClientMuralResponseSchema,
  get_client_history: getClientHistoryResponseSchema,
  get_client_delivery_history: getClientDeliveryHistoryResponseSchema,
  get_delivery_trend: getDeliveryTrendResponseSchema,
  get_workflow: getWorkflowResponseSchema,
  get_planning_weeks: getPlanningWeeksResponseSchema,
  get_delivery_status: getDeliveryStatusResponseSchema,
  get_admin_week: getAdminWeekResponseSchema,
  get_month_attention: getMonthAttentionResponseSchema,
  get_client_month: getClientMonthResponseSchema,
  get_calendar: getCalendarResponseSchema,
  list_tags: listTagsResponseSchema,
  list_clients: listClientsResponseSchema,
  list_boards: listBoardsResponseSchema,
  list_tasks: listTasksResponseSchema,
  add_comment: addCommentResponseSchema,
  preview_move: previewMoveResponseSchema,
  move_task: moveTaskResponseSchema,
  create_task: createTaskResponseSchema,
  update_task: updateTaskResponseSchema,
  assign_task: assignTaskResponseSchema,
  complete_task: completeTaskResponseSchema,
  reopen_task: reopenTaskResponseSchema,
  add_mural_note: addMuralNoteResponseSchema,
  update_mural_note: updateMuralNoteResponseSchema,
  add_history_entry: addHistoryEntryResponseSchema,
  update_history_entry: updateHistoryEntryResponseSchema,
  release_task: releaseTaskResponseSchema,
};

/** A menor entrada válida de cada ferramenta (só o que o schema obriga). */
const MINIMAS: Record<McpToolName, Record<string, unknown>> = {
  get_context: {},
  search: { q: 'Peça' },
  get_board: { id: LISTA_ATENDIMENTO },
  get_task: { id: TAREFA_DA_PECA },
  get_client: { id: CLIENTE_JATOBA },
  list_people: {},
  get_person_work: { id: PESSOA_HELENA },
  list_comments: { taskId: TAREFA_DA_PECA },
  get_delivery_report: {},
  get_marketing_report: {},
  get_client_mural: { clientId: CLIENTE_CLINIMAX },
  get_client_history: { clientId: CLIENTE_CLINIMAX },
  get_client_delivery_history: { clientId: CLIENTE_JATOBA },
  get_delivery_trend: {},
  get_workflow: { listId: LISTA_DA_ESTEIRA },
  get_planning_weeks: {},
  get_delivery_status: {},
  get_admin_week: {},
  get_month_attention: {},
  get_client_month: { clientId: CLIENTE_JATOBA },
  get_calendar: { from: '2026-10-05', to: '2026-10-11' },
  list_tags: { spaceId: ESPACO },
  list_clients: {},
  list_boards: {},
  list_tasks: {},
  add_comment: { taskId: TAREFA, body: 'Combinado.', idempotencyKey: 'min-comentar' },
  preview_move: { taskId: TAREFA, listId: LISTA_B, from: { listId: LISTA_A, statusId: ETAPA_ATRIBUIR } },
  move_task: {
    taskId: TAREFA,
    listId: LISTA_B,
    from: { listId: LISTA_A, statusId: ETAPA_ATRIBUIR },
    idempotencyKey: 'min-mover',
  },
  create_task: { listId: LISTA_B, title: 'Pauta de novembro', idempotencyKey: 'min-criar' },
  update_task: { taskId: TAREFA, title: 'Reels de outubro (revisado)', idempotencyKey: 'min-editar' },
  assign_task: { taskId: TAREFA, assigneeIds: [], idempotencyKey: 'min-atribuir' },
  complete_task: { taskId: TAREFA, idempotencyKey: 'min-concluir' },
  reopen_task: { taskId: TAREFA, idempotencyKey: 'min-reabrir' },
  add_mural_note: { clientId: CLIENTE_CLINIMAX, content: 'Aprovações só com a Fulana.', idempotencyKey: 'min-nota' },
  update_mural_note: { noteId: NOTA_DA_IA, content: 'Texto novo.', idempotencyKey: 'min-nota-2' },
  add_history_entry: {
    clientId: CLIENTE_CLINIMAX,
    happenedOn: '2026-10-08',
    title: 'Ligação',
    body: 'Cliente pediu mais vídeos.',
    idempotencyKey: 'min-historico',
  },
  update_history_entry: { entryId: REGISTRO_DA_IA, title: 'Reunião (corrigida)', idempotencyKey: 'min-historico-2' },
  release_task: { taskId: TAREFA, assigneeIds: [PESSOA_DO_TIME], dueOn: '2026-10-09', idempotencyKey: 'min-liberar' },
};

const validadorJson = new AjvJsonSchemaValidator();

/* ───────────────────────────── 1. tools/list ───────────────────────────── */

describe('tools/list pelo cliente MCP do SDK', () => {
  it('anuncia as 38 ferramentas, na ordem do código, com título, descrição e os dois schemas', async () => {
    const tools = await listar();
    expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    expect(tools).toHaveLength(38);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(38);
    for (const tool of tools) {
      expect(typeof tool.title, tool.name).toBe('string');
      expect(tool.title.length, tool.name).toBeGreaterThan(3);
      expect(typeof tool.description, tool.name).toBe('string');
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.outputSchema?.type, tool.name).toBe('object');
      expect(Array.isArray(tool._meta?.examples), tool.name).toBe(true);
      expect(tool._meta.examples.length, tool.name).toBeGreaterThan(0);
    }
  });

  it('é a mesma lista que o transporte HTTP (a porta do Worker) devolve', async () => {
    const massa = montarMassa();
    const resposta = await handleMcpRequest({
      request: new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
      grant: massa.loaded.grant,
      person: massa.loaded.person,
      origin: 'mcp',
      catalog: new MemoryCatalog([{ id: EMPRESA, name: 'Agência Ide' }], new Map([[DONO, 'Wesley Lourenço']])),
      work: massa.loaded.work,
      delivery: massa.loaded.delivery,
      marketing: massa.loaded.marketing,
      writes: massa.store,
      now: AGORA,
    });
    const pelaHttp = ((await resposta.json()) as { result: { tools: unknown[] } }).result.tools;
    expect(pelaHttp).toEqual(await listar());
  });

  it('o inputSchema anunciado é o do contrato: mesmos campos, mesmos obrigatórios, estrito', async () => {
    const tools = await listar();
    for (const tool of tools) {
      let zod: ZodTypeAny = ENTRADAS[tool.name as McpToolName];
      while (zod instanceof z.ZodEffects) zod = zod._def.schema;
      expect(zod instanceof z.ZodObject, `${tool.name}: a entrada precisa ser um objeto`).toBe(true);
      const forma = (zod as z.ZodObject<z.ZodRawShape>).shape;
      const esperadosObrigatorios = Object.keys(forma).filter((chave) => !forma[chave].isOptional()).sort();
      expect(Object.keys(tool.inputSchema.properties ?? {}).sort(), `${tool.name}: campos`).toEqual(Object.keys(forma).sort());
      expect([...(tool.inputSchema.required ?? [])].sort(), `${tool.name}: obrigatórios`).toEqual(esperadosObrigatorios);
      expect(tool.inputSchema.additionalProperties, `${tool.name}: estrito`).toBe(false);
    }
  });
});

describe('o cliente do SDK, de ponta a ponta', () => {
  it('listTools + callTool: o cliente confere o outputSchema anunciado e a leitura passa', async () => {
    const { cliente, fechar } = await conectar(montarMassa(), { validarSaida: true });
    try {
      for (const nome of ['get_context', 'search', 'get_task', 'list_tasks', 'get_month_attention'] as const) {
        const resultado = (await cliente.callTool({ name: nome, arguments: MINIMAS[nome] })) as Resultado;
        expect(resultado.isError, nome).toBeFalsy();
        expect(resultado.structuredContent?.operation, nome).toBe(nome);
      }
      // A recusa de negócio atravessa o cliente como resultado (isError), não como exceção.
      const recusa = (await cliente.callTool({ name: 'get_task', arguments: { id: 'tarefa-que-nao-existe' } })) as Resultado;
      expect(recusa.isError).toBe(true);
    } finally {
      await fechar();
    }
  });
});

/* ───────────────────────────── 2. exemplos e entradas mínimas ───────────────────────────── */

describe('cada exemplo de _meta.examples e a entrada mínima rodam e cumprem o outputSchema', () => {
  it.each([...MCP_TOOL_NAMES])('%s', async (nome) => {
    const tools = await listar();
    const tool = tools.find((candidata) => candidata.name === nome)!;
    const validaEntrada = validadorJson.getValidator(tool.inputSchema);
    const validaSaida = validadorJson.getValidator(tool.outputSchema);

    const entradas: Array<{ rotulo: string; input: Record<string, unknown>; outputDoExemplo?: unknown }> = [
      ...(tool._meta.examples as Array<{ input: Record<string, unknown>; output?: unknown }>).map((exemplo, i) => ({
        rotulo: `exemplo ${i + 1}`,
        input: exemplo.input,
        outputDoExemplo: exemplo.output,
      })),
      { rotulo: 'entrada mínima', input: MINIMAS[nome] },
    ];

    for (const { rotulo, input, outputDoExemplo } of entradas) {
      const onde = `${nome} (${rotulo})`;
      // (a) a entrada passa pelo JSON Schema anunciado E pelo Zod do contrato.
      expect(validaEntrada(input).valid, `${onde}: JSON Schema de entrada`).toBe(true);
      expect(ENTRADAS[nome].safeParse(input).success, `${onde}: Zod de entrada`).toBe(true);
      // (b) a saída do exemplo, quando existe, cumpre o outputSchema.
      if (outputDoExemplo !== undefined) {
        expect(validaSaida(outputDoExemplo).valid, `${onde}: o output do exemplo`).toBe(true);
        expect(SAIDAS[nome].safeParse(outputDoExemplo).success, `${onde}: o output do exemplo (Zod)`).toBe(true);
      }
      // (c) a chamada real, numa massa nova (o cliente do SDK já confere o outputSchema).
      const massa = montarMassa();
      PREPARO[nome]?.(massa);
      const resultado = await chamar(nome, input, massa);
      expect(resultado.isError, `${onde}: ${textoDe(resultado)}`).toBeFalsy();
      expect(resultado.structuredContent, onde).toBeDefined();
      expect(resultado.structuredContent!.operation, onde).toBe(nome);
      expect(validaSaida(resultado.structuredContent).valid, `${onde}: JSON Schema de saída`).toBe(true);
      expect(SAIDAS[nome].safeParse(resultado.structuredContent).success, `${onde}: Zod de saída`).toBe(true);
      // `content` leva DOIS blocos de texto: a linha-resumo e o corpo inteiro em JSON compacto,
      // igual a `structuredContent`. Muito cliente MCP repassa ao modelo só `content`.
      expect(resultado.content, `${onde}: content`).toHaveLength(2);
      const [resumo, corpo] = resultado.content!;
      expect(resumo.type, onde).toBe('text');
      expect(corpo.type, onde).toBe('text');
      // O resumo: presente, específico (não o "ok" de reserva) e igual ao que o código monta.
      expect(resumo.text, `${onde}: resumo`).toBe(compactText(resultado.structuredContent!));
      expect(resumo.text!.length, `${onde}: resumo`).toBeGreaterThan(10);
      expect(resumo.text, `${onde}: resumo`).not.toMatch(/\[object Object\]|undefined|NaN/);
      expect(resumo.text, `${onde}: resumo`).not.toBe('ok');
      // O corpo: exatamente structuredContent, serializado compacto (sem indentação).
      expect(corpo.text, `${onde}: corpo`).toBe(JSON.stringify(resultado.structuredContent));
      expect(JSON.parse(corpo.text!), `${onde}: corpo`).toEqual(resultado.structuredContent);
      expect(corpo.text, `${onde}: corpo compacto`).not.toMatch(/\n/);
      // E cabe no mesmo teto de 64 KiB que a HTTP respeita.
      expect(new TextEncoder().encode(corpo.text!).length, `${onde}: teto`).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
    }
  });
});

/* ───────────────────────────── 2b. o que o agente lê em content ───────────────────────────── */

describe('content: o resumo e o corpo inteiro, no mesmo teto que a HTTP', () => {
  const corpoEmBytes = (texto: string) => new TextEncoder().encode(texto).length;

  /** A resposta da API HTTP gêmea para a mesma leitura, na mesma massa. */
  async function viaHttp(massa: Massa, caminho: string, consulta: Record<string, string>): Promise<string> {
    const resposta = await dispatchIntegrationHttp({
      grant: massa.loaded.grant,
      person: massa.loaded.person,
      origin: 'http',
      catalog: new MemoryCatalog([{ id: EMPRESA, name: 'Agência Ide' }], new Map([[DONO, 'Wesley Lourenço']])),
      work: massa.loaded.work,
      delivery: massa.loaded.delivery,
      marketing: massa.loaded.marketing,
      now: AGORA,
      request: new Request(`${ORIGIN}${caminho}?${new URLSearchParams(consulta).toString()}`),
    });
    expect(resposta.status).toBe(200);
    return resposta.text();
  }

  it('recusa continua com UM bloco, o JSON { error, message }', async () => {
    const recusa = await chamar('get_task', { id: 'nao-existe' });
    expect(recusa.isError).toBe(true);
    expect(recusa.content).toHaveLength(1);
    expect(JSON.parse(textoDe(recusa))).toMatchObject({ error: expect.any(String), message: expect.any(String) });
    expect(recusa.structuredContent).toBeUndefined();
  });

  it.each([
    {
      nome: 'get_task',
      args: { id: 'tarefa-longa' },
      massa: () => montarMassa({ leituras: comTarefaLonga }),
      http: [GET_TASK_PATH, { id: 'tarefa-longa' }] as const,
    },
    {
      nome: 'search',
      args: { q: 'Campanha', limit: 100 },
      massa: () => montarMassa({ leituras: comMuitasTarefas }),
      http: [SEARCH_PATH, { q: 'Campanha', limit: '100' }] as const,
    },
    {
      nome: 'get_month_attention',
      args: { month: '2026-10', limit: 100 },
      massa: () => montarMassa({ entrega: comMuitosClientes }),
      http: [GET_MONTH_ATTENTION_PATH, { month: '2026-10', limit: '100' }] as const,
    },
  ])(
    '$nome com resposta grande: o corpo em content cabe no teto de 64 KiB e é byte a byte o da HTTP',
    async ({ nome, args, massa, http }) => {
      const m = massa();
      const resultado = await chamar(nome, args, m);
      expect(resultado.isError, textoDe(resultado)).toBeFalsy();
      const [resumo, corpo] = resultado.content!;
      expect(resultado.content).toHaveLength(2);
      // O teto que `pageAndFit` mede é o do corpo — e é o corpo que vai em content[1].
      expect(corpoEmBytes(corpo.text!)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      expect(corpo.text).toBe(JSON.stringify(resultado.structuredContent));
      // A mesma leitura pela API HTTP devolve exatamente estes bytes: o content nunca passa do
      // corpo da HTTP mais a linha-resumo.
      expect(corpo.text).toBe(await viaHttp(m, http[0], http[1]));
      expect(resumo.text!.length).toBeLessThan(2_000);
      // A massa é grande de verdade: a página cortou e manda continuar.
      expect(resultado.structuredContent!.hasMore, 'a massa precisa passar de uma página').toBe(true);
      expect(typeof resultado.structuredContent!.nextCursor).toBe('string');
    },
  );
});

/* ───────────────────────────── 3. anotações ───────────────────────────── */

describe('anotações MCP', () => {
  const ADITIVAS = ['add_comment', 'create_task', 'add_mural_note', 'add_history_entry'];

  it('leituras e a prévia: somente leitura; escritas: não, com destrutiva só onde sobrescreve; nenhuma toca o mundo aberto', async () => {
    const tools = await listar();
    for (const tool of tools) {
      const anotacoes = tool.annotations as Record<string, boolean>;
      const nome = tool.name as McpToolName;
      expect(anotacoes.openWorldHint, `${nome}: sistema fechado`).toBe(false);
      if ((MCP_READ_TOOL_NAMES as readonly string[]).includes(nome) || (MCP_PREVIEW_TOOL_NAMES as readonly string[]).includes(nome)) {
        expect(anotacoes, nome).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      } else {
        expect(MCP_WRITE_TOOL_NAMES as readonly string[], nome).toContain(nome);
        expect(anotacoes.readOnlyHint, `${nome}: escreve`).toBe(false);
        // Aditiva = só cria linha nova. O resto sobrescreve um dado que já existia.
        expect(anotacoes.destructiveHint, `${nome}: destrutiva`).toBe(!ADITIVAS.includes(nome));
        // Toda escrita exige idempotencyKey, e repetir a mesma chave não grava de novo.
        expect(tool.inputSchema.required, `${nome}: chave de idempotência`).toContain('idempotencyKey');
        expect(anotacoes.idempotentHint, `${nome}: idempotente`).toBe(true);
      }
    }
  });

  it('repetir a mesma idempotencyKey de fato não grava de novo (a dica idempotentHint é verdadeira)', async () => {
    const massa = montarMassa();
    const { cliente, fechar } = await conectar(massa);
    try {
      for (const nome of MCP_WRITE_TOOL_NAMES) {
        const entrada = MINIMAS[nome];
        PREPARO[nome]?.(massa);
        const primeira = (await cliente.callTool({ name: nome, arguments: entrada })) as Resultado;
        expect(primeira.isError, `${nome}: ${textoDe(primeira)}`).toBeFalsy();
        const gravadas = massa.store.executions.size;
        const segunda = (await cliente.callTool({ name: nome, arguments: entrada })) as Resultado;
        expect(segunda.isError, `${nome}: ${textoDe(segunda)}`).toBeFalsy();
        expect(segunda.structuredContent?.replay, `${nome}: replay`).toBe(true);
        expect(massa.store.executions.size, `${nome}: nada a mais no registro`).toBe(gravadas);
      }
    } finally {
      await fechar();
    }
  });
});

/* ───────────────────────────── 4. recusas ───────────────────────────── */

const INGLES_DO_SDK = /Input validation error|Invalid arguments|MCP error|Required|Invalid enum|Unrecognized key/i;

function expectaRecusaEmPortugues(recusa: { error: string; message: string }, onde: string) {
  expect([...INTEGRATION_ERROR_CODES, 'internal'], `${onde}: código estável`).toContain(recusa.error);
  expect(recusa.message.length, `${onde}: mensagem`).toBeGreaterThan(15);
  expect(recusa.message, `${onde}: sem o inglês do SDK`).not.toMatch(INGLES_DO_SDK);
}

describe('recusas: código estável e frase em português que diz o que fazer', () => {
  it.each([...MCP_TOOL_NAMES])('%s: campo desconhecido é invalid_input, e a frase nomeia o campo', async (nome) => {
    const resultado = await chamar(nome, { ...MINIMAS[nome], campoQueNaoExiste: 1 });
    const recusa = recusaDe(resultado);
    expectaRecusaEmPortugues(recusa, nome);
    expect(recusa.error).toBe('invalid_input');
    expect(recusa.message).toContain('campoQueNaoExiste');
    expect(recusa.message).toMatch(/não aceita/);
  });

  it.each(MCP_TOOL_NAMES.filter((nome) => Object.keys(MINIMAS[nome]).length > 0))(
    '%s: tirar um campo obrigatório é invalid_input e a frase diz qual',
    async (nome) => {
      const tools = await listar();
      const obrigatorios = (tools.find((tool) => tool.name === nome)!.inputSchema.required ?? []) as string[];
      for (const campo of obrigatorios) {
        const { [campo]: _tirado, ...semOCampo } = MINIMAS[nome];
        void _tirado;
        const recusa = recusaDe(await chamar(nome, semOCampo));
        expectaRecusaEmPortugues(recusa, `${nome} sem ${campo}`);
        expect(recusa.error, `${nome} sem ${campo}`).toBe('invalid_input');
        expect(recusa.message, `${nome} sem ${campo}`).toContain(campo);
      }
    },
  );

  it('enum errado: a frase lista os valores aceitos', async () => {
    const recusa = recusaDe(await chamar('list_tasks', { statusType: 'pronto' }));
    expectaRecusaEmPortugues(recusa, 'list_tasks');
    expect(recusa.error).toBe('invalid_input');
    expect(recusa.message).toContain('statusType');
    expect(recusa.message).toContain('"pronto"');
    for (const valor of ['open', 'unstarted', 'custom', 'done', 'closed']) expect(recusa.message).toContain(valor);
  });

  it('tipo de dado errado e id mal formado: dizem o campo e o que vale', async () => {
    const numero = recusaDe(await chamar('get_task', { id: 123 }));
    expect(numero.error).toBe('invalid_input');
    expect(numero.message).toMatch(/"id" deve ser texto/);
    const uuid = recusaDe(await chamar('list_tasks', { listId: 'lista-1' }));
    expect(uuid.message).toMatch(/"listId": UUID inválido\./);
    // A frase escrita no schema já traz o ponto: a recusa não fecha com dois.
    expect(uuid.message).not.toMatch(/\.\./);
    const dia = recusaDe(await chamar('list_tasks', { dueBefore: '30/09/2026' }));
    expect(dia.message).toMatch(/"dueBefore": Use AAAA-MM-DD\./);
    expect(dia.message).not.toMatch(/\.\./);
    const aninhado = recusaDe(
      await chamar('preview_move', { taskId: TAREFA, listId: LISTA_B, from: { listId: 'x', statusId: null } }),
    );
    expect(aninhado.message).toContain('"from.listId"');
  });

  it('permissão que falta: permission_denied, com a permissão e o que fazer', async () => {
    const semTarefas = INTEGRATION_CAPABILITIES.filter((cap) => cap !== 'tasks:read');
    const leitura = recusaDe(await chamar('get_task', { id: TAREFA_DA_PECA }, montarMassa({ capacidades: semTarefas })));
    expect(leitura.error).toBe('permission_denied');
    expect(leitura.message).toContain('tasks:read');
    expect(leitura.message).toMatch(/Peça a quem conectou/);
    expect(leitura.message).toContain('get_context');

    const semEscrita = INTEGRATION_CAPABILITIES.filter((cap) => cap !== 'tasks:write');
    const escrita = recusaDe(await chamar('create_task', MINIMAS.create_task, montarMassa({ capacidades: semEscrita })));
    expect(escrita.error).toBe('permission_denied');
    expect(escrita.message).toContain('tasks:write');
    expect(escrita.message).toMatch(/Peça a quem conectou/);
  });

  it('id fora do recorte da conexão: permission_denied ou not_found, com o próximo passo', async () => {
    // A concessão só alcança outra empresa: o id existe, mas está fora.
    const foraDoRecorte = montarMassa({ empresas: [] });
    for (const [nome, args] of [
      ['get_task', { id: TAREFA_DA_PECA }],
      ['get_client', { id: CLIENTE_JATOBA }],
      ['get_board', { id: LISTA_ATENDIMENTO }],
    ] as const) {
      const recusa = recusaDe(await chamar(nome, args, foraDoRecorte));
      expectaRecusaEmPortugues(recusa, nome);
      expect(['permission_denied', 'not_found'], nome).toContain(recusa.error);
      expect(recusa.message, nome).toMatch(/search/);
      expect(recusa.message, nome).toContain('get_context');
    }
    const naoExiste = recusaDe(await chamar('get_workflow', { listId: '99999999-9999-4999-8999-999999999999' }));
    expect(naoExiste.error).toBe('not_found');
    expect(naoExiste.message).toMatch(/search|list_boards/);
  });

  it('cursor inválido: invalid_cursor manda recomeçar sem cursor', async () => {
    for (const [nome, args] of [
      ['search', { q: 'Peça', cursor: 'lixo!' }],
      ['list_tasks', { cursor: 'lixo!' }],
      ['list_boards', { cursor: 'lixo!' }],
      ['list_clients', { cursor: 'lixo!' }],
    ] as const) {
      const recusa = recusaDe(await chamar(nome, args));
      expect(recusa.error, nome).toBe('invalid_cursor');
      expect(recusa.message, nome).toMatch(/primeira página/);
    }
  });

  it('limite acima do teto: limit_exceeded diz o teto e como continuar', async () => {
    const recusa = recusaDe(await chamar('list_tasks', { limit: 5000 }));
    expect(recusa.error).toBe('limit_exceeded');
    expect(recusa.message).toMatch(/100/);
    expect(recusa.message).toMatch(/nextCursor/);
  });

  it('escritas desligadas: unavailable diz que não adianta repetir e o que continua valendo', async () => {
    const desligadas = montarMassa({ writesEnabled: false });
    for (const nome of MCP_WRITE_TOOL_NAMES) {
      const recusa = recusaDe(await chamar(nome, MINIMAS[nome], desligadas));
      expect(recusa.error, nome).toBe('unavailable');
      expect(recusa.message, nome).toBe(INTEGRATION_WRITES_UNAVAILABLE_MESSAGE);
    }
    expect(INTEGRATION_WRITES_UNAVAILABLE_MESSAGE).toMatch(/Leituras e prévia de movimento continuam/);
    expect(INTEGRATION_WRITES_UNAVAILABLE_MESSAGE).toMatch(/não adianta repetir/);
    // A prévia e as leituras seguem de pé com as escritas desligadas.
    expect((await chamar('preview_move', MINIMAS.preview_move, desligadas)).isError).toBeFalsy();
    expect((await chamar('get_task', MINIMAS.get_task, desligadas)).isError).toBeFalsy();
  });

  it('teto do dia atingido: daily_write_limit diz quantas, o teto, quando zera e quem muda', async () => {
    const massa = montarMassa({ tetoDoDia: 1 });
    const { cliente, fechar } = await conectar(massa);
    try {
      const primeira = (await cliente.callTool({ name: 'add_comment', arguments: MINIMAS.add_comment })) as Resultado;
      expect(primeira.isError).toBeFalsy();
      const segunda = (await cliente.callTool({
        name: 'add_comment',
        arguments: { ...MINIMAS.add_comment, idempotencyKey: 'min-comentar-2' },
      })) as Resultado;
      const recusa = recusaDe(segunda);
      expect(recusa.error).toBe('daily_write_limit');
      expect(recusa.message).toMatch(/1 de 1 escritas/);
      expect(recusa.message).toMatch(/zera em/);
      expect(recusa.message).toMatch(/aumentar o teto/);
    } finally {
      await fechar();
    }
  });

  it('ferramenta que não existe: recusa em português, não o erro cru do SDK', async () => {
    const recusa = recusaDe(await chamar('apagar_tudo', {}));
    expect(recusa.error).toBe('unknown_operation');
    expect(recusa.message).toMatch(/Ferramenta desconhecida/);
    expect(recusa.message).not.toMatch(INGLES_DO_SDK);
  });

  it('a recusa de estado devolve a opção para a pessoa escolher, sem escolher por ela', async () => {
    const recusa = recusaDe(
      await chamar('create_task', { listId: LISTA_A, title: 'Sem tipo', idempotencyKey: 'sem-tipo' }),
    );
    expect(recusa.error).toBe('type_required');
    expect(recusa.options).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'video' })]));
  });
});

/* ───────────────────────────── 5. a tabela de permissões confere com o comportamento ───────────────────────────── */

describe('a tabela de permissões das frases confere com cada ferramenta de verdade', () => {
  it('cobre exatamente as 38 ferramentas, na mesma ordem de tools/list', () => {
    expect(Object.keys(EXIGENCIAS_DAS_FERRAMENTAS)).toEqual([...MCP_TOOL_NAMES]);
  });

  it('tirando UMA permissão por vez: recusa exatamente quem a tabela diz que a exige', async () => {
    for (const faltante of INTEGRATION_CAPABILITIES) {
      const capacidades = INTEGRATION_CAPABILITIES.filter((cap) => cap !== faltante);
      const tem = new Set<string>(capacidades);
      for (const nome of MCP_TOOL_NAMES) {
        const massa = montarMassa({ capacidades });
        PREPARO[nome]?.(massa);
        const resultado = await chamar(nome, MINIMAS[nome], massa);
        const esperadoNegar = permissoesQueFaltam(nome, MINIMAS[nome], tem).length > 0;
        const onde = `${nome} sem ${faltante}`;
        if (esperadoNegar) {
          const recusa = recusaDe(resultado);
          expect(recusa.error, onde).toBe('permission_denied');
          expect(recusa.message, `${onde}: nomeia a permissão`).toContain(faltante);
        } else {
          expect(resultado.isError, `${onde}: ${textoDe(resultado)}`).toBeFalsy();
        }
      }
    }
  }, 120_000);

  it('sem nenhuma leitura, search recusa; com só uma, atende', async () => {
    const leituras = ['boards:read', 'tasks:read', 'clients:read', 'people:read'];
    const semLeituras = INTEGRATION_CAPABILITIES.filter((cap) => !leituras.includes(cap));
    const recusa = recusaDe(await chamar('search', { q: 'Peça' }, montarMassa({ capacidades: semLeituras })));
    expect(recusa.error).toBe('permission_denied');
    expect(recusa.message).toMatch(/boards:read/);
    const soTarefas = INTEGRATION_CAPABILITIES.filter((cap) => !leituras.includes(cap) || cap === 'tasks:read');
    expect((await chamar('search', { q: 'Peça' }, montarMassa({ capacidades: soTarefas }))).isError).toBeFalsy();
  });

  it('search com kinds exige a leitura de cada tipo pedido, e a recusa diz qual falta', async () => {
    const semPessoas = INTEGRATION_CAPABILITIES.filter((cap) => cap !== 'people:read');
    const recusa = recusaDe(await chamar('search', { q: 'Helena', kinds: ['person'] }, montarMassa({ capacidades: semPessoas })));
    expect(recusa.error).toBe('permission_denied');
    expect(recusa.message).toContain('people:read');
    // Sem kinds, as quatro leituras não são todas obrigatórias: a busca atende com o que a conexão tem.
    expect((await chamar('search', { q: 'Peça' }, montarMassa({ capacidades: semPessoas }))).isError).toBeFalsy();
  });

  it('administração é do papel, não da permissão: get_admin_week e release_task recusam quem não é admin', async () => {
    for (const nome of ['get_admin_week', 'release_task'] as const) {
      const recusa = recusaDe(await chamar(nome, MINIMAS[nome], montarMassa({ admin: false })));
      expect(recusa.error, nome).toBe('permission_denied');
      expect(recusa.message, nome).toMatch(/administrador/);
    }
  });
});

/* ───────────────────────────── 6. get_context diz o que dá para fazer ───────────────────────────── */

describe('get_context orienta o agente sobre as próprias permissões', () => {
  it('com tudo liberado, lista todas as ferramentas e como começar', async () => {
    const resultado = await chamar('get_context', {});
    const texto = textoDe(resultado);
    expect(texto).toMatch(/^Wesley Lourenço · 1 empresa · /);
    expect(texto).toMatch(/Pode usar \(38\)/);
    for (const nome of MCP_TOOL_NAMES) expect(texto, nome).toContain(nome);
    expect(texto).not.toMatch(/Sem a permissão/);
    expect(texto).toMatch(/search/);
    expect(texto).toMatch(/idempotencyKey/);
    expect(texto).toMatch(/dryRun/);
  });

  it('com leitura apenas, separa o que pode do que pede permissão e diz qual', async () => {
    const soLeitura = INTEGRATION_CAPABILITIES.filter((cap) => cap.endsWith(':read'));
    const texto = textoDe(await chamar('get_context', {}, montarMassa({ capacidades: soLeitura })));
    expect(texto).toMatch(/Pode usar \(\d+\): .*get_task/);
    expect(texto).toMatch(/Sem a permissão \(\d+\): .*create_task \(tasks:write\)/);
    expect(texto).toMatch(/release_task \(tasks:assign \+ tasks:write \+ tasks:move\)/);
    expect(texto).toMatch(/Quem conectou amplia em Conexões/);
  });
});

/* ───────────────────────────── 7. custo de contexto e descobribilidade ───────────────────────────── */

/**
 * O orçamento de contexto de `tools/list`, em bytes de JSON, fixado na conferência de 09/10/2026.
 *
 * ANTES (38 ferramentas): 214 453 bytes no total (~61 mil tokens a 3,5 bytes/token), dos quais
 * 31 817 de descrições, 111 975 de outputSchema, 16 173 de inputSchema e 44 519 de `_meta.examples`
 * (a entrada E a saída de cada exemplo).
 * DEPOIS: 169 475 bytes (~48 400 tokens): 27 600 de descrições (as 12 maiores foram de 17 256 a
 * 13 790 bytes, -20%) e 3 786 de exemplos (só a entrada; a saída é a do outputSchema). O que um
 * cliente costuma pôr no contexto do modelo (nome + descrição + inputSchema) foi de 50 284 a
 * 46 047 bytes.
 *
 * Uma ferramenta nova que estoure o orçamento: enxugue a descrição (o que o `outputSchema` já diz
 * não precisa estar nela) ou suba o número aqui de propósito, sabendo que paga em todo começo de
 * conversa de todo agente.
 */
const BYTES_DO_TOOLS_LIST = 171_500;
const BYTES_DAS_DESCRICOES = 28_200;
const TETO_DA_DESCRICAO = 1_600;

const referenciasDeFerramenta = /\b(?:get|list|add|update|create|assign|complete|reopen|release|move|preview|search)(?:_[a-z]+)*\b/g;

describe('descrições: custo de contexto e o próximo passo', () => {
  it('o tools/list inteiro cabe no orçamento (bytes e tokens aproximados)', async () => {
    const tools = await listar();
    const bytes = new TextEncoder().encode(JSON.stringify(tools)).length;
    const descricoes = tools.reduce((soma, tool) => soma + new TextEncoder().encode(tool.description).length, 0);
    expect(bytes, `tools/list: ${bytes} bytes, ~${Math.round(bytes / 3.5)} tokens`).toBeLessThanOrEqual(BYTES_DO_TOOLS_LIST);
    expect(descricoes, `descrições: ${descricoes} bytes`).toBeLessThanOrEqual(BYTES_DAS_DESCRICOES);
  });

  it('cada descrição abre dizendo o que a ferramenta faz e cabe no teto individual', async () => {
    const tools = await listar();
    for (const tool of tools) {
      const descricao = tool.description as string;
      const primeiraFrase = descricao.split(/(?<=[.!?])\s/)[0];
      expect(primeiraFrase.length, `${tool.name}: primeira frase`).toBeLessThanOrEqual(240);
      expect(new TextEncoder().encode(descricao).length, `${tool.name}: descrição`).toBeLessThanOrEqual(TETO_DA_DESCRICAO);
    }
  });

  it('as descrições só citam ferramentas que existem', async () => {
    const tools = await listar();
    const nomes = new Set<string>(MCP_TOOL_NAMES);
    // Campos e códigos com cara de ferramenta que NÃO são ferramentas.
    const permitidas = new Set(['get_context_']);
    for (const tool of tools) {
      for (const achado of (tool.description as string).match(referenciasDeFerramenta) ?? []) {
        if (!achado.includes('_')) continue;
        expect(nomes.has(achado) || permitidas.has(achado), `${tool.name} cita "${achado}", que não é ferramenta`).toBe(true);
      }
    }
  });

  it('o caminho de cada leitura aponta para a ferramenta seguinte', async () => {
    const tools = await listar();
    const descricao = (nome: string) => tools.find((tool) => tool.name === nome)!.description as string;
    const aponta: Array<[string, string[]]> = [
      ['search', ['get_task', 'get_client', 'get_board']],
      ['list_tags', ['create_task', 'update_task']],
      ['get_month_attention', ['get_client_month']],
      ['get_client_month', ['get_month_attention']],
      ['get_planning_weeks', ['get_month_attention']],
      ['get_delivery_status', ['get_delivery_report']],
      ['get_delivery_report', ['get_delivery_status', 'get_client_delivery_history', 'get_delivery_trend']],
      ['get_delivery_trend', ['get_client_delivery_history']],
      ['get_calendar', ['get_client_month']],
      ['get_board', ['get_task']],
      ['list_boards', ['get_workflow', 'create_task']],
      ['list_tasks', ['get_task', 'get_person_work']],
      ['list_clients', ['get_client']],
      ['get_workflow', ['create_task', 'move_task']],
      ['get_admin_week', ['release_task']],
      ['release_task', ['get_admin_week']],
      ['preview_move', ['move_task']],
      ['move_task', ['preview_move', 'get_workflow']],
      ['assign_task', ['list_people']],
      ['list_comments', ['add_comment']],
      ['add_comment', ['list_comments']],
      ['get_client_mural', ['add_mural_note']],
      ['get_client_history', ['add_history_entry']],
      ['get_context', ['search']],
    ];
    for (const [nome, seguintes] of aponta) {
      for (const seguinte of seguintes) expect(descricao(nome), `${nome} → ${seguinte}`).toContain(seguinte);
    }
  });
});
