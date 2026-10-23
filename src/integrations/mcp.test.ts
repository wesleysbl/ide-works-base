/**
 * MCP de leitura — F16.5.
 *
 * MCP e HTTP leem a mesma massa autorizada. Dois tokens no mesmo processo
 * não misturam concessão. O fluxo de prova acha demanda, pessoa e relatório
 * sem IDs digitados. Sem capacidade → isError + permission_denied.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GET_DELIVERY_REPORT_PATH,
  GET_TASK_PATH,
  SEARCH_PATH,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { READ_CAPABILITIES, type IntegrationCapability, type PersonAccess } from '@/integrations/grants';
import {
  MemoryGrantStore,
  OAUTH_CONSENT_PATH,
  OAUTH_CSRF_COOKIE,
  PROOF_REDIRECT_URI,
  PROOF_SCOPE,
  createIntegrationHandler,
  httpAudience,
  mcpAudience,
  type IntegrationServer,
} from '@/integrations/handler';
import { MCP_READ_TOOL_NAMES, MCP_TOOL_NAMES } from '@/integrations/mcp';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { MemoryWorkCatalog } from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';
import { SESSION_COOKIE as HUMAN_SESSION } from '@/server/session';
import type { AuthenticatedActor, SessionResult } from '@/server/session';

const ORIGIN = 'https://ideworks.test';
const MCP = mcpAudience(ORIGIN);
const HTTP = httpAudience(ORIGIN);
const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_B = 'cliente-filmes';
const AGORA_FROM = '2026-09-01';
const AGORA_TO = '2026-09-30';
const MES = '2026-09-01';
const OPEN = { id: 'status-aberto', name: 'Aberto', sortOrder: 1, type: 'open' as const };

const OWNER_A: AuthenticatedActor = {
  userId: '11111111-1111-1111-1111-111111111111',
  email: 'wesley@exemplo.com.br',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: ['entrega'],
  hasAllClientsAccess: true,
};

const OWNER_B: AuthenticatedActor = {
  userId: '22222222-2222-2222-2222-222222222222',
  email: 'lia@exemplo.com.br',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: ['entrega'],
  hasAllClientsAccess: true,
};

const PERSON_A: PersonAccess = {
  userId: OWNER_A.userId,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [COMPANY_A],
  clientIds: [CLIENT_A],
  hasAllClientsAccess: true,
};

const PERSON_B: PersonAccess = {
  userId: OWNER_B.userId,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [COMPANY_B],
  clientIds: [CLIENT_B],
  hasAllClientsAccess: true,
};

const CATALOG = new MemoryCatalog(
  [
    { id: COMPANY_A, name: 'Agência Ide' },
    { id: COMPANY_B, name: 'Ide Filmes' },
  ],
  new Map([
    [OWNER_A.userId, 'Wesley Lourenço'],
    [OWNER_B.userId, 'Leandro Reis'],
  ]),
);

const WORK = new MemoryWorkCatalog({
  boards: [
    {
      id: 'lista-atendimento-jatoba',
      name: 'Atendimento',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      spaceId: 'space-a',
      spaceName: 'Entrega',
      folderId: null,
      folderName: null,
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      canSeeSpace: true,
      statuses: [OPEN],
    },
    {
      id: 'lista-filmes',
      name: 'Filmes',
      companyId: COMPANY_B,
      companyName: 'Ide Filmes',
      spaceId: 'space-b',
      spaceName: 'Produção',
      folderId: null,
      folderName: null,
      clientId: CLIENT_B,
      clientName: 'Cliente Filmes',
      canSeeSpace: true,
      statuses: [OPEN],
    },
  ],
  tasks: [
    {
      id: 'tarefa-peca',
      title: 'Peça da campanha Jatobá',
      description: 'Briefing curto.',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      boardId: 'lista-atendimento-jatoba',
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      statusId: OPEN.id,
      dueOn: '2026-09-30',
      priority: 'urgent',
      startOn: '2026-09-24',
      people: [{ id: 'pessoa-helena', name: 'Helena' }],
    },
    {
      id: 'tarefa-filmes',
      title: 'Peça da campanha Filmes',
      description: 'Não deve vazar para a outra concessão.',
      companyId: COMPANY_B,
      companyName: 'Ide Filmes',
      boardId: 'lista-filmes',
      clientId: CLIENT_B,
      clientName: 'Cliente Filmes',
      statusId: OPEN.id,
      dueOn: null,
      people: [{ id: 'pessoa-leo', name: 'Leandro Reis' }],
    },
  ],
  clients: [
    { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: ['lista-atendimento-jatoba'] },
    { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes', listIds: ['lista-filmes'] },
  ],
  comments: [
    {
      id: 'c-1',
      taskId: 'tarefa-peca',
      parentId: null,
      body: 'ok',
      createdAt: '2026-09-21T04:00:00.000Z',
      author: { id: 'pessoa-helena', name: 'Helena' },
    },
  ],
  people: [
    {
      id: 'pessoa-helena',
      name: 'Helena',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      detail: 'atendimento',
      email: 'NAO_VAZAR_EMAIL',
      papel: 'NAO_VAZAR_PAPEL',
    },
    {
      id: 'pessoa-leo',
      name: 'Leandro Reis',
      companyId: COMPANY_B,
      companyName: 'Ide Filmes',
      detail: 'produção',
      email: 'NAO_VAZAR_EMAIL',
      papel: 'NAO_VAZAR_PAPEL',
    },
  ],
});

const DELIVERY = new MemoryDeliveryCatalog({
  clients: [
    { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes' },
  ],
  contracts: [
    { clientId: CLIENT_A, referenceMonth: MES, contentType: 'arte', quantity: 1 },
    { clientId: CLIENT_B, referenceMonth: MES, contentType: 'arte', quantity: 1 },
  ],
  items: [
    {
      clientId: CLIENT_A,
      referenceMonth: MES,
      scheduledOn: '2026-09-10',
      contentType: 'arte',
      isExtra: false,
      isCompleted: true,
    },
    {
      clientId: CLIENT_B,
      referenceMonth: MES,
      scheduledOn: '2026-09-12',
      contentType: 'arte',
      isExtra: false,
      isCompleted: true,
    },
  ],
  opened: [
    { clientId: CLIENT_A, referenceMonth: MES },
    { clientId: CLIENT_B, referenceMonth: MES },
  ],
  contentContractClientIds: [CLIENT_A, CLIENT_B],
});

const MARKETING = new MemoryMarketingCatalog({
  assets: [
    {
      id: 'conta-anuncio-jatoba',
      kind: 'ad_account',
      displayName: 'Jatobá ads',
      externalId: 'act-a',
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      currency: 'BRL',
      lastSeenAt: '2026-08-01T12:00:00.000Z',
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
      collectedAt: '2026-08-01T12:00:00.000Z',
    },
  ],
  lastRun: {
    startedAt: '2026-08-01T11:50:00.000Z',
    finishedAt: '2026-08-01T12:00:00.000Z',
    outcome: 'ok',
    windowFrom: '2026-07-04',
    windowTo: '2026-08-01',
  },
});

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function mergeCookies(previous: string, response: Response): string {
  const map = new Map<string, string>();
  for (const part of previous.split(';').map((item) => item.trim()).filter(Boolean)) {
    const [key, ...rest] = part.split('=');
    map.set(key, rest.join('='));
  }
  for (const set of response.headers.getSetCookie()) {
    const pair = set.split(';')[0] ?? '';
    const [key, ...rest] = pair.split('=');
    const value = rest.join('=');
    if (!key) continue;
    if (value === '') map.delete(key);
    else map.set(key, value);
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function sessionResult(cookieHeader: string): SessionResult {
  if (cookieHeader.includes(`${HUMAN_SESSION}=owner-b`)) return { ok: true, actor: OWNER_B };
  if (cookieHeader.includes(`${HUMAN_SESSION}=owner-a`)) return { ok: true, actor: OWNER_A };
  return { ok: false, status: 401, reason: 'no_token', message: 'Faltou o crachá.' };
}

async function createServer(): Promise<IntegrationServer> {
  const store = new MemoryGrantStore();
  store.seedPerson(PERSON_A);
  store.seedPerson(PERSON_B);
  return createIntegrationHandler({
    grants: store,
    catalog: CATALOG,
    work: WORK,
    delivery: DELIVERY,
    marketing: MARKETING,
    resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
  });
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function issueToken(
  server: IntegrationServer,
  options: {
    session: 'owner-a' | 'owner-b';
    resource: string;
    capabilities: readonly IntegrationCapability[];
    clientId?: string;
  },
): Promise<string> {
  const pair = await pkce();
  const clientId = options.clientId ?? server.clientId;
  const authorize = new URL('/oauth/authorize', ORIGIN);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', PROOF_REDIRECT_URI);
  authorize.searchParams.set('code_challenge', pair.challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', 'f16-5');
  authorize.searchParams.set('scope', PROOF_SCOPE);
  authorize.searchParams.set('resource', options.resource);

  const started = await server.fetch(new Request(authorize.toString()));
  const withSession = `${mergeCookies('', started)}; ${HUMAN_SESSION}=${options.session}`;
  const page = await server.fetch(
    new Request(authorize.toString(), { headers: { Cookie: withSession, Accept: 'application/json' } }),
  );
  const payload = await parseJson(page);
  const cookies = mergeCookies(withSession, page);
  const csrf = typeof payload.csrf === 'string' ? payload.csrf : '';
  const match = cookies.match(new RegExp(`${OAUTH_CSRF_COOKIE}=([^;]+)`));
  const posted = await server.fetch(
    new Request(new URL(OAUTH_CONSENT_PATH, ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookies },
      body: JSON.stringify({
        csrf: csrf || match?.[1] || '',
        capabilities: [...options.capabilities],
        company_scope: 'all',
        client_scope: 'all',
      }),
    }),
  );
  expect(posted.status).toBe(302);
  const code = new URL(posted.headers.get('Location')!).searchParams.get('code');
  const tokenRes = await server.fetch(
    new Request(new URL('/oauth/token', ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: PROOF_REDIRECT_URI,
        client_id: clientId,
        code_verifier: pair.verifier,
        resource: options.resource,
      }),
    }),
  );
  expect(tokenRes.status).toBe(200);
  return String((await parseJson(tokenRes)).access_token);
}

function mcpPost(token: string, method: string, params: unknown, id = 1): Request {
  return new Request(MCP, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

async function callTool(
  server: IntegrationServer,
  token: string,
  name: string,
  args: Record<string, unknown>,
  id = 3,
): Promise<{ isError: boolean; structured?: Record<string, unknown>; text: string; rpc: Record<string, unknown> }> {
  const response = await server.fetch(mcpPost(token, 'tools/call', { name, arguments: args }, id));
  expect(response.status).toBe(200);
  const rpc = await parseJson(response);
  const result = rpc.result as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ text: string }>;
  };
  return {
    isError: result?.isError === true,
    structured: result?.structuredContent,
    text: result?.content?.[0]?.text ?? '',
    rpc,
  };
}

function comparable(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy.queriedAt;
  delete copy.origin;
  delete copy.integration;
  return copy;
}

describe('catálogo MCP de leitura', () => {
  it('lista as leituras (25, com mural e histórico da F26.6, a entrega mês a mês da F26.7, a esteira e o planejamento por semana da F37, a última entrega pela Semanal da F38, o painel dos admins da F40 o mês do cliente, o mês de um cliente peça a peça o calendário e as etiquetas dos espaços a carteira de clientes, as listas e as tarefas com filtro da conferência de 08/10) e 38 ferramentas no total com readOnlyHint e publica add_comment com readOnlyHint false', async () => {
    const server = await createServer();
    const token = await issueToken(server, {
      session: 'owner-a',
      resource: MCP,
      capabilities: [...READ_CAPABILITIES],
    });
    const listed = await server.fetch(mcpPost(token, 'tools/list', {}, 2));
    const tools = ((await parseJson(listed)).result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    const reads = tools.filter((tool) => (MCP_READ_TOOL_NAMES as readonly string[]).includes(String(tool.name)));
    expect(reads).toHaveLength(MCP_READ_TOOL_NAMES.length);
    expect(MCP_READ_TOOL_NAMES).toHaveLength(25);
    expect(MCP_TOOL_NAMES).toHaveLength(38);
    expect(tools).toHaveLength(38);
    expect(tools.some((tool) => tool.name === 'get_workflow')).toBe(true);
    expect(tools.some((tool) => tool.name === 'get_planning_weeks')).toBe(true);
    expect(tools.some((tool) => tool.name === 'get_delivery_status')).toBe(true);
    // F40, Fase 9: a leitura do painel dos admins (e a escrita release_task, no fim da lista).
    expect(tools.some((tool) => tool.name === 'get_admin_week')).toBe(true);
    expect(tools.some((tool) => tool.name === 'release_task')).toBe(true);
    expect(reads.every((tool) => (tool.annotations as { readOnlyHint?: boolean }).readOnlyHint === true)).toBe(true);
    expect(tools.every((tool) => typeof tool.description === 'string' && (tool.description as string).length > 20)).toBe(
      true,
    );
    expect(tools.every((tool) => tool.outputSchema)).toBe(true);
    const write = tools.find((tool) => tool.name === 'add_comment');
    expect((write?.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(false);
    expect(tools.some((tool) => tool.name === 'move_task')).toBe(true);
    expect(tools.some((tool) => tool.name === 'preview_move')).toBe(true);
  });
});

describe('MCP e HTTP devolvem os mesmos dados autorizados', () => {
  it('search, get_task e relatório coincidem na mesma massa', async () => {
    const server = await createServer();
    const mcpToken = await issueToken(server, {
      session: 'owner-a',
      resource: MCP,
      capabilities: [...READ_CAPABILITIES],
    });
    const httpClient = await server.helpers.createClient({
      clientName: 'Cliente HTTP F16.5',
      tokenEndpointAuthMethod: 'none',
      redirectUris: [PROOF_REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
    });
    const httpToken = await issueToken(server, {
      session: 'owner-a',
      resource: HTTP,
      capabilities: [...READ_CAPABILITIES],
      clientId: httpClient.clientId,
    });

    const mcpSearch = await callTool(server, mcpToken, 'search', { q: 'Peça da campanha Jatobá', kinds: ['task'] });
    expect(mcpSearch.isError).toBe(false);
    const httpSearch = await server.fetch(
      new Request(`${ORIGIN}${SEARCH_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${httpToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'Peça da campanha Jatobá', kinds: ['task'] }),
      }),
    );
    expect(httpSearch.status).toBe(200);
    const httpSearchBody = await parseJson(httpSearch);
    expect(comparable(mcpSearch.structured!)).toEqual(comparable(httpSearchBody));
    expect((mcpSearch.structured!.items as unknown[]).length).toBe(1);

    const taskId = (mcpSearch.structured!.items as Array<{ id: string }>)[0].id;
    const mcpTask = await callTool(server, mcpToken, 'get_task', { id: taskId }, 4);
    const httpTask = await server.fetch(
      new Request(`${ORIGIN}${GET_TASK_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${httpToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId }),
      }),
    );
    const httpTaskBody = await parseJson(httpTask);
    expect(comparable(mcpTask.structured!)).toEqual(comparable(httpTaskBody));
    // F37: a urgência chega igual por MCP e por HTTP.
    const mcpFicha = mcpTask.structured!.task as Record<string, unknown>;
    expect(mcpFicha).toMatchObject({ priority: 'urgent', startOn: '2026-09-24', statusType: 'open', completedAt: null, archivedAt: null });
    expect((httpTaskBody.task as Record<string, unknown>).priority).toBe('urgent');

    const mcpBoard = await callTool(server, mcpToken, 'get_board', { id: 'lista-atendimento-jatoba' }, 7);
    expect(mcpBoard.isError).toBe(false);
    const board = mcpBoard.structured!.board as { columns: Array<{ type: string }>; tasks: Array<{ id: string; priority: string }> };
    expect(board.columns[0].type).toBe('open');
    expect(board.tasks.find((task) => task.id === taskId)?.priority).toBe('urgent');

    const mcpReport = await callTool(server, mcpToken, 'get_delivery_report', { from: AGORA_FROM, to: AGORA_TO }, 5);
    const httpReport = await server.fetch(
      new Request(`${ORIGIN}${GET_DELIVERY_REPORT_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${httpToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: AGORA_FROM, to: AGORA_TO }),
      }),
    );
    expect(comparable(mcpReport.structured!)).toEqual(comparable(await parseJson(httpReport)));
    expect((mcpReport.structured!.summary as { clients: number }).clients).toBe(1);
  });
});

describe('credenciais intercaladas no mesmo processo', () => {
  it('dois tokens não compartilham grant nem resultados', async () => {
    const server = await createServer();
    const tokenA = await issueToken(server, {
      session: 'owner-a',
      resource: MCP,
      capabilities: [...READ_CAPABILITIES],
    });
    const tokenB = await issueToken(server, {
      session: 'owner-b',
      resource: MCP,
      capabilities: [...READ_CAPABILITIES],
    });

    const a1 = await callTool(server, tokenA, 'search', { q: 'Peça da campanha' });
    const b1 = await callTool(server, tokenB, 'search', { q: 'Peça da campanha' }, 4);
    const a2 = await callTool(server, tokenA, 'get_context', {}, 5);
    const b2 = await callTool(server, tokenB, 'get_context', {}, 6);
    const a3 = await callTool(server, tokenA, 'search', { q: 'Peça da campanha' }, 7);

    const idsA = (a1.structured!.items as Array<{ id: string }>).map((item) => item.id);
    const idsB = (b1.structured!.items as Array<{ id: string }>).map((item) => item.id);
    expect(idsA).toEqual(['tarefa-peca']);
    expect(idsB).toEqual(['tarefa-filmes']);
    expect(JSON.stringify(a1.structured)).not.toContain('tarefa-filmes');
    expect(JSON.stringify(b1.structured)).not.toContain('tarefa-peca');
    expect((a2.structured!.owner as { id: string }).id).toBe(OWNER_A.userId);
    expect((b2.structured!.owner as { id: string }).id).toBe(OWNER_B.userId);
    expect((a3.structured!.items as Array<{ id: string }>).map((item) => item.id)).toEqual(idsA);
  });
});

describe('fluxo sem IDs manuais', () => {
  it('search pelo nome chega em get_task, get_person_work e relatório', async () => {
    const server = await createServer();
    const token = await issueToken(server, {
      session: 'owner-a',
      resource: MCP,
      capabilities: [...READ_CAPABILITIES],
    });

    const foundTask = await callTool(server, token, 'search', { q: 'Peça da campanha Jatobá', kinds: ['task'] });
    expect((foundTask.structured!.items as unknown[]).length).toBe(1);
    const taskId = (foundTask.structured!.items as Array<{ id: string }>)[0].id;
    const task = await callTool(server, token, 'get_task', { id: taskId }, 4);
    expect((task.structured!.task as { title: string }).title).toBe('Peça da campanha Jatobá');

    const foundPerson = await callTool(server, token, 'search', { q: 'Helena', kinds: ['person'] }, 5);
    expect((foundPerson.structured!.items as unknown[]).length).toBe(1);
    const personId = (foundPerson.structured!.items as Array<{ id: string }>)[0].id;
    const work = await callTool(server, token, 'get_person_work', { id: personId }, 6);
    expect(work.isError).toBe(false);
    expect((work.structured!.person as { displayName: string }).displayName).toBe('Helena');
    expect((work.structured!.counts as { tasks: number }).tasks).toBeGreaterThan(0);
    const workItems = work.structured!.items as Array<{ statusType?: string | null; priority?: string | null }>;
    expect(workItems.every((item) => 'statusType' in item && 'priority' in item)).toBe(true);

    const report = await callTool(server, token, 'get_delivery_report', { from: AGORA_FROM, to: AGORA_TO }, 7);
    expect(report.isError).toBe(false);
    expect((report.structured!.coverage as { kind: string }).kind).toBe('partial');
    expect((report.structured!.summary as { clients: number }).clients).toBe(1);
  });
});

describe('sem capacidade não vira sucesso vazio', () => {
  it('permission_denied no protocolo, com código estável', async () => {
    const server = await createServer();
    const token = await issueToken(server, {
      session: 'owner-a',
      resource: MCP,
      capabilities: ['tasks:read'],
    });
    const denied = await callTool(server, token, 'get_client', { id: CLIENT_A });
    expect(denied.isError).toBe(true);
    expect(denied.structured).toBeUndefined();
    const error = JSON.parse(denied.text) as { error: string; message: string };
    expect(error.error).toBe('permission_denied');
    expect(error.message.length).toBeGreaterThan(0);
  });
});

/**
 * Auditoria de 08/10/2026 — falha inesperada dentro de uma ferramenta ia
 * crua para o agente (o SDK devolve `error.message` como texto: nome de
 * restrição do banco, valores) e não ia para o log.
 */
describe('falha inesperada numa ferramenta', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('o agente recebe uma frase genérica com o id da requisição; o log recebe o erro', async () => {
    const SEGREDO = 'duplicate key value violates unique constraint "segredo_idx" DETAIL: Key (email)=(x@y.z)';
    class Quebrado extends MemoryWorkCatalog {
      override async getTask(): Promise<never> {
        throw new Error(SEGREDO);
      }
    }
    const store = new MemoryGrantStore();
    store.seedPerson(PERSON_A);
    const server = await createIntegrationHandler({
      grants: store,
      catalog: CATALOG,
      work: new Quebrado(),
      delivery: DELIVERY,
      marketing: MARKETING,
      resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
    });
    const token = await issueToken(server, { session: 'owner-a', resource: MCP, capabilities: [...READ_CAPABILITIES] });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await server.fetch(mcpPost(token, 'tools/call', { name: 'get_task', arguments: { id: 'tarefa-x' } }));
    expect(response.status).toBe(200);
    const requestId = response.headers.get('X-Request-Id');
    expect(requestId).toBeTruthy();
    const result = (await parseJson(response)).result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).not.toContain('segredo_idx');
    expect(text).not.toContain('x@y.z');
    const payload = JSON.parse(text) as { error: string; message: string; requestId: string };
    expect(payload.error).toBe('internal');
    expect(payload.message).toMatch(/Falha inesperada/);
    // O MESMO id do cabeçalho da resposta, do corpo e do log.
    expect(payload.requestId).toBe(requestId);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain('get_task');
    expect(String(log.mock.calls[0][0])).toContain(`request_id=${requestId}`);
    expect((log.mock.calls[0][1] as Error).message).toBe(SEGREDO);
  });

  it('recusa de negócio continua com a frase dela, sem log', async () => {
    const server = await createServer();
    const token = await issueToken(server, { session: 'owner-a', resource: MCP, capabilities: ['tasks:read'] });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const denied = await callTool(server, token, 'get_client', { id: CLIENT_A });
    expect(JSON.parse(denied.text)).toMatchObject({ error: 'permission_denied' });
    expect(log).not.toHaveBeenCalled();
  });
});

describe('SDK oficial contra o catálogo real', () => {
  it('listTools e callTool get_context usam a operação compartilhada', async () => {
    const server = await createServer();
    const token = await issueToken(server, {
      session: 'owner-a',
      resource: MCP,
      capabilities: [...READ_CAPABILITIES],
    });
    const transport = new StreamableHTTPClientTransport(new URL(MCP), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        return server.fetch(request);
      },
    });
    const client = new Client({ name: 'f16-5-sdk', version: '0.0.1' });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    const result = await client.callTool({ name: 'get_context', arguments: {} });
    expect(result.isError).toBeFalsy();
    const body = result.structuredContent as { operation?: string; owner?: { id: string } };
    expect(body.operation).toBe('get_context');
    expect(body.owner?.id).toBe(OWNER_A.userId);
    await client.close();
  });
});
