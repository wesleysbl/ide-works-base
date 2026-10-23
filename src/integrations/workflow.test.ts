/**
 * `get_workflow` — F37, Fase 2: as etapas de uma lista ou pasta, em ordem, com
 * tipo e de onde a esteira vem (lista, pasta ou espaço).
 *
 * MCP, HTTP e a função de leitura respondem o MESMO corpo. Alvo que não existe,
 * está fora do recorte ou é de empresa omitida é `not_found` (igual nos três
 * casos); sem `boards:read` é `permission_denied`; os dois ids ou nenhum é
 * `invalid_input`. A prova das consultas SQL está em `omitidas-banco.test.ts`.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  GET_WORKFLOW_PATH,
  getWorkflowInputSchema,
  getWorkflowOpenApiExample,
  getWorkflowResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
  workflowTargetOf,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { MCP_READ_TOOL_NAMES, handleMcpRequest } from '@/integrations/mcp';
import {
  MemoryWorkCatalog,
  getWorkflowWork,
  type MemoryBoard,
  type MemoryFolder,
  type ReadCtx,
} from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';

const ORIGIN = 'https://ideworks.test';
const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const AGORA = new Date('2026-10-05T12:00:00.000Z');

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const L_PROPRIA = uid(1);
const L_DA_PASTA = uid(2);
const L_DO_ESPACO = uid(3);
const L_OUTRA_EMPRESA = uid(4);
const L_CLIENTE_FORA = uid(5);
const F_JATOBA = uid(10);
const F_SEM_ESTEIRA = uid(11);
const F_OUTRA_EMPRESA = uid(12);
const F_CLIENTE = uid(13);
const CLIENT_A = 'cliente-jatoba';
const CLIENT_B = 'cliente-filmes';

const ETAPAS_PASTA = [
  { id: uid(101), name: 'Pauta', sortOrder: 0, type: 'open' as const },
  { id: uid(102), name: 'Em produção', sortOrder: 1, type: 'custom' as const },
  { id: uid(103), name: 'Aprovado', sortOrder: 2, type: 'done' as const },
  { id: uid(104), name: 'Fechado', sortOrder: 3, type: 'closed' as const },
];
const ETAPAS_ESPACO = [
  { id: uid(201), name: 'A fazer', sortOrder: 0, type: 'unstarted' as const },
  { id: uid(202), name: 'Feito', sortOrder: 1, type: 'closed' as const },
];
const ETAPAS_LISTA = [
  // De propósito fora de ordem: a resposta ordena por sortOrder.
  { id: uid(302), name: 'Revisão', sortOrder: 1, type: 'custom' as const },
  { id: uid(301), name: 'Rascunho', sortOrder: 0, type: 'open' as const },
  { id: uid(303), name: 'Publicado', sortOrder: 2, type: 'closed' as const },
];

function board(partial: Partial<MemoryBoard> & Pick<MemoryBoard, 'id' | 'name'>): MemoryBoard {
  return {
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    spaceId: 'espaco-clientes',
    spaceName: 'CLIENTES',
    folderId: null,
    folderName: null,
    clientId: null,
    clientName: null,
    canSeeSpace: true,
    statuses: ETAPAS_ESPACO,
    ...partial,
  };
}

const BOARDS: MemoryBoard[] = [
  board({ id: L_PROPRIA, name: 'Lista com esteira própria', statuses: ETAPAS_LISTA }),
  board({
    id: L_DA_PASTA,
    name: 'Atendimento Jatobá',
    folderId: F_JATOBA,
    folderName: 'Jatobá',
    statuses: ETAPAS_PASTA,
    workflow: { inheritedFrom: 'folder', ownerId: F_JATOBA, ownerName: 'Jatobá', name: 'Esteira do Jatobá' },
  }),
  board({
    id: L_DO_ESPACO,
    name: 'Lista solta no espaço',
    workflow: { inheritedFrom: 'space', ownerId: 'espaco-clientes', ownerName: 'CLIENTES', name: 'Esteira padrão' },
  }),
  board({
    id: L_OUTRA_EMPRESA,
    name: 'Lista do Filmes',
    companyId: COMPANY_B,
    companyName: 'Ide Filmes',
    clientId: CLIENT_B,
    clientName: 'Cliente Filmes',
  }),
  board({
    id: L_CLIENTE_FORA,
    name: 'Lista de outro cliente',
    folderId: F_CLIENTE,
    folderName: 'Pasta de cliente',
    clientId: CLIENT_B,
    clientName: 'Cliente Filmes',
  }),
];

const FOLDERS: MemoryFolder[] = [
  {
    id: F_JATOBA,
    name: 'Jatobá',
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    canSeeSpace: true,
    workflow: { inheritedFrom: 'folder', ownerId: F_JATOBA, ownerName: 'Jatobá', name: 'Esteira do Jatobá' },
    statuses: ETAPAS_PASTA,
  },
  {
    id: F_SEM_ESTEIRA,
    name: 'Pasta sem esteira',
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    canSeeSpace: true,
    workflow: { inheritedFrom: 'space', ownerId: 'espaco-clientes', ownerName: 'CLIENTES', name: 'Esteira padrão' },
    statuses: ETAPAS_ESPACO,
  },
  {
    id: F_OUTRA_EMPRESA,
    name: 'Pasta do Filmes',
    companyId: COMPANY_B,
    companyName: 'Ide Filmes',
    canSeeSpace: true,
    workflow: { inheritedFrom: 'space', ownerId: 'espaco-filmes', ownerName: 'FILMES', name: 'Esteira padrão' },
    statuses: ETAPAS_ESPACO,
  },
  {
    id: F_CLIENTE,
    name: 'Pasta de cliente',
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    canSeeSpace: true,
    workflow: { inheritedFrom: 'space', ownerId: 'espaco-clientes', ownerName: 'CLIENTES', name: 'Esteira padrão' },
    statuses: ETAPAS_ESPACO,
  },
];

const WORK = new MemoryWorkCatalog({ boards: BOARDS, folders: FOLDERS });
const COMPANIES = [
  { id: COMPANY_A, name: 'Agência Ide' },
  { id: COMPANY_B, name: 'Ide Filmes' },
];

const PESSOA: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [COMPANY_A, COMPANY_B],
  clientIds: [CLIENT_A, CLIENT_B],
  hasAllClientsAccess: true,
};

function grant(partial: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: 'grant-esteira',
    ownerId: OWNER_ID,
    oauthClientId: 'claude',
    name: 'Claude da agência',
    capabilities: [...READ_CAPABILITIES],
    allowedCompanyIds: [COMPANY_A],
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
    ...partial,
  };
}

function ctxFor(g: IntegrationGrant = grant(), person: PersonAccess = PESSOA, work = WORK): ReadCtx {
  return { grant: g, person, origin: 'http', companies: COMPANIES, displayName: 'Wesley Lourenço', work, now: AGORA };
}

describe('get_workflow — a leitura', () => {
  it('lista com esteira própria: etapas em ordem, dona = a lista', async () => {
    const result = await getWorkflowWork(ctxFor(), { listId: L_PROPRIA });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { workflow } = result.body;
    expect(workflow.target).toEqual({ kind: 'list', id: L_PROPRIA, name: 'Lista com esteira própria' });
    expect(workflow.inheritedFrom).toBe('list');
    expect(workflow.owner).toEqual({ kind: 'list', id: L_PROPRIA, name: 'Lista com esteira própria' });
    expect(workflow.stages.map((stage) => [stage.name, stage.sortOrder, stage.type])).toEqual([
      ['Rascunho', 0, 'open'],
      ['Revisão', 1, 'custom'],
      ['Publicado', 2, 'closed'],
    ]);
    expect(result.body.self).toBe(`${GET_WORKFLOW_PATH}?listId=${L_PROPRIA}`);
  });

  it('lista herdando da pasta: origem folder e dona = a pasta', async () => {
    const result = await getWorkflowWork(ctxFor(), { listId: L_DA_PASTA });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.workflow.inheritedFrom).toBe('folder');
    expect(result.body.workflow.owner).toEqual({ kind: 'folder', id: F_JATOBA, name: 'Jatobá' });
    expect(result.body.workflow.name).toBe('Esteira do Jatobá');
    expect(result.body.workflow.stages.map((stage) => stage.name)).toEqual(['Pauta', 'Em produção', 'Aprovado', 'Fechado']);
    expect(result.body.workflow.stages.map((stage) => stage.id)).toEqual(ETAPAS_PASTA.map((stage) => stage.id));
  });

  it('lista herdando do espaço: origem space', async () => {
    const result = await getWorkflowWork(ctxFor(), { listId: L_DO_ESPACO });
    expect(result.ok && result.body.workflow.inheritedFrom).toBe('space');
    expect(result.ok && result.body.workflow.owner.kind).toBe('space');
  });

  it('pasta: a esteira da pasta, ou a do espaço quando ela não tem uma', async () => {
    const propria = await getWorkflowWork(ctxFor(), { folderId: F_JATOBA });
    expect(propria.ok).toBe(true);
    if (!propria.ok) return;
    expect(propria.body.workflow.target).toEqual({ kind: 'folder', id: F_JATOBA, name: 'Jatobá' });
    expect(propria.body.workflow.inheritedFrom).toBe('folder');
    expect(propria.body.self).toBe(`${GET_WORKFLOW_PATH}?folderId=${F_JATOBA}`);

    const herdada = await getWorkflowWork(ctxFor(), { folderId: F_SEM_ESTEIRA });
    expect(herdada.ok && herdada.body.workflow.inheritedFrom).toBe('space');
    expect(herdada.ok && herdada.body.workflow.stages.map((stage) => stage.type)).toEqual(['unstarted', 'closed']);
  });

  it('id inexistente é not_found, para lista e para pasta', async () => {
    const lista = await getWorkflowWork(ctxFor(), { listId: uid(999) });
    expect(lista.ok === false && lista.code).toBe('not_found');
    const pasta = await getWorkflowWork(ctxFor(), { folderId: uid(999) });
    expect(pasta.ok === false && pasta.code).toBe('not_found');
  });

  it('sem boards:read é permission_denied, antes de olhar o alvo', async () => {
    const semLeitura = grant({ capabilities: ['tasks:read'] });
    const existente = await getWorkflowWork(ctxFor(semLeitura), { listId: L_PROPRIA });
    expect(existente.ok === false && existente.code).toBe('permission_denied');
    const inexistente = await getWorkflowWork(ctxFor(semLeitura), { listId: uid(999) });
    expect(inexistente.ok === false && inexistente.code).toBe('permission_denied');
  });

  it('empresa fora da concessão ou omitida vira not_found, como se não existisse', async () => {
    const fora = await getWorkflowWork(ctxFor(), { listId: L_OUTRA_EMPRESA });
    expect(fora.ok === false && fora.code).toBe('not_found');
    const pastaFora = await getWorkflowWork(ctxFor(), { folderId: F_OUTRA_EMPRESA });
    expect(pastaFora.ok === false && pastaFora.code).toBe('not_found');

    // Concessão sobre todas as empresas: só a omissão (Alma9) esconde a de fora.
    const todas = grant({ allowedCompanyIds: null });
    const aberta = await getWorkflowWork(ctxFor(todas), { listId: L_OUTRA_EMPRESA });
    expect(aberta.ok).toBe(true);
    const omitida: PersonAccess = { ...PESSOA, omittedCompanyIds: [COMPANY_B] };
    const lista = await getWorkflowWork(ctxFor(todas, omitida), { listId: L_OUTRA_EMPRESA });
    expect(lista.ok === false && lista.code).toBe('not_found');
    const pasta = await getWorkflowWork(ctxFor(todas, omitida), { folderId: F_OUTRA_EMPRESA });
    expect(pasta.ok === false && pasta.code).toBe('not_found');
    const daIde = await getWorkflowWork(ctxFor(todas, omitida), { listId: L_PROPRIA });
    expect(daIde.ok).toBe(true);
  });

  it('recorte de cliente: lista de cliente fora do recorte e pasta só com listas de fora são not_found', async () => {
    const soJatoba = grant({ allowedClientIds: [CLIENT_A] });
    const pessoa: PersonAccess = { ...PESSOA, hasAllClientsAccess: false };
    const lista = await getWorkflowWork(ctxFor(soJatoba, pessoa), { listId: L_CLIENTE_FORA });
    expect(lista.ok === false && lista.code).toBe('not_found');
    const pasta = await getWorkflowWork(ctxFor(soJatoba, pessoa), { folderId: F_CLIENTE });
    expect(pasta.ok === false && pasta.code).toBe('not_found');
    // Lista sem cliente e pasta sem listas de cliente seguem visíveis.
    expect((await getWorkflowWork(ctxFor(soJatoba, pessoa), { listId: L_PROPRIA })).ok).toBe(true);
    expect((await getWorkflowWork(ctxFor(soJatoba, pessoa), { folderId: F_JATOBA })).ok).toBe(true);
  });

  it('os dois ids ou nenhum é invalid_input', async () => {
    const dois = await getWorkflowWork(ctxFor(), { listId: L_PROPRIA, folderId: F_JATOBA });
    expect(dois.ok === false && dois.code).toBe('invalid_input');
    const nenhum = await getWorkflowWork(ctxFor(), {});
    expect(nenhum.ok === false && nenhum.code).toBe('invalid_input');
    expect(workflowTargetOf({})).toBeNull();
    expect(workflowTargetOf({ listId: L_PROPRIA })).toEqual({ kind: 'list', id: L_PROPRIA });
  });
});

describe('get_workflow — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']]));

  it('OpenAPI publica GET e POST, schemas iguais ao Zod, exemplo válido e o aviso dos ids', () => {
    const doc = integrationOpenApi() as {
      info: { description: string };
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths['/get_workflow'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(doc.paths['/get_workflow']?.get?.responses['404']).toBeDefined();
    expect(doc.components.schemas.GetWorkflowInput).toEqual(jsonSchemaFromZod(getWorkflowInputSchema));
    expect(doc.components.schemas.GetWorkflowResponse).toEqual(jsonSchemaFromZod(getWorkflowResponseSchema));
    expect(doc.info.description).toContain('get_workflow');
    expect(JSON.stringify(doc.paths['/get_workflow'])).toContain('ids das etapas MUDAM');
    const exemplo = getWorkflowResponseSchema.parse(getWorkflowOpenApiExample());
    expect(exemplo.workflow.stages.length).toBeGreaterThan(0);
  });

  async function http(search: string, g: IntegrationGrant = grant(), init?: RequestInit) {
    return dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${GET_WORKFLOW_PATH}${search}`, init),
      grant: g,
      person: PESSOA,
      origin: 'http',
      catalog: memoryCatalog,
      work: WORK,
      now: AGORA,
    });
  }

  function mcpPost(method: string, params: unknown): Request {
    return new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  }

  async function callTool(args: unknown, g: IntegrationGrant = grant()) {
    const response = await handleMcpRequest({
      request: mcpPost('tools/call', { name: 'get_workflow', arguments: args }),
      grant: g,
      person: PESSOA,
      origin: 'mcp',
      catalog: memoryCatalog,
      work: WORK,
      delivery: new MemoryDeliveryCatalog(),
      marketing: new MemoryMarketingCatalog(),
      now: AGORA,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
    }).result;
  }

  it('paridade: HTTP GET, HTTP POST, MCP e a função devolvem o mesmo corpo (lista e pasta)', async () => {
    for (const [query, args] of [
      [`?listId=${L_DA_PASTA}`, { listId: L_DA_PASTA }],
      [`?folderId=${F_JATOBA}`, { folderId: F_JATOBA }],
    ] as const) {
      const direto = await getWorkflowWork(ctxFor(), args);
      expect(direto.ok).toBe(true);
      if (!direto.ok) return;

      const get = await http(query);
      expect(get.status).toBe(200);
      expect(getWorkflowResponseSchema.parse(await get.json())).toEqual(direto.body);

      const post = await http('', grant(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      expect(post.status).toBe(200);
      expect(await post.json()).toEqual(direto.body);

      const mcp = await callTool(args);
      expect(mcp.isError).toBeUndefined();
      expect(mcp.structuredContent).toEqual(direto.body);
    }
    const resumo = await callTool({ listId: L_DA_PASTA });
    expect(resumo.content[0]?.text).toContain('Atendimento Jatobá');
    expect(resumo.content[0]?.text).toContain('herdada de folder');
    expect(resumo.content[0]?.text).toContain('Pauta (open) → Em produção (custom)');
  });

  it('HTTP: 404 not_found, 403 sem boards:read, 400 com os dois ids, nenhum ou id que não é uuid', async () => {
    const naoAchou = await http(`?listId=${uid(999)}`);
    expect(naoAchou.status).toBe(404);
    expect(((await naoAchou.json()) as { error: string }).error).toBe('not_found');

    const proibido = await http(`?listId=${L_PROPRIA}`, grant({ capabilities: ['tasks:read'] }));
    expect(proibido.status).toBe(403);

    for (const query of [`?listId=${L_PROPRIA}&folderId=${F_JATOBA}`, '', '?listId=nao-e-uuid']) {
      const ruim = await http(query);
      expect(ruim.status).toBe(400);
      expect(((await ruim.json()) as { error: string }).error).toBe('invalid_input');
    }
  });

  it('MCP: as mesmas recusas, com o código estável', async () => {
    const naoAchou = await callTool({ folderId: uid(999) });
    expect(naoAchou.isError).toBe(true);
    expect((JSON.parse(naoAchou.content[0]?.text ?? '{}') as { error: string }).error).toBe('not_found');

    const proibido = await callTool({ listId: L_PROPRIA }, grant({ capabilities: ['tasks:read'] }));
    expect(proibido.isError).toBe(true);
    expect((JSON.parse(proibido.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');

    for (const args of [{ listId: L_PROPRIA, folderId: F_JATOBA }, {}]) {
      const ruim = await callTool(args);
      expect(ruim.isError).toBe(true);
      expect((JSON.parse(ruim.content[0]?.text ?? '{}') as { error: string }).error).toBe('invalid_input');
    }
  });

  it('MCP: get_workflow está entre as leituras', () => {
    expect(MCP_READ_TOOL_NAMES).toContain('get_workflow');
  });
});
