/**
 * `get_delivery_status` — F38, Fase 3.
 *
 * A leitura NÃO tem regra própria: as peças vêm do catálogo (no SQL, a mesma
 * `readWeeklyPieces` do Painel) e a conta é `deliveryStatusOf`
 * (`src/delivery/ultima-entrega.ts`). Os testes provam o recorte (concessão
 * por cliente e por empresa, empresa omitida, cliente cancelado ausente), os
 * números iguais aos da regra, e as três superfícies (função, HTTP, MCP)
 * dizendo o mesmo.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { deliveryStatusOf } from '@/delivery/ultima-entrega';
import {
  GET_DELIVERY_STATUS_PATH,
  getDeliveryStatusInputSchema,
  getDeliveryStatusOpenApiExample,
  getDeliveryStatusResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { EMPTY_WORK_CATALOG } from '@/integrations/reads';
import {
  MemoryDeliveryCatalog,
  SqlDeliveryCatalog,
  getDeliveryStatus,
  type DeliveryCatalog,
  type MemoryDeliveryData,
  type MemoryDeliveryItem,
  type ReportCtx,
} from '@/integrations/reports';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_ALMA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_HELP = 'cliente-hiper-center';
const CLIENT_REBROTA = 'cliente-rebrota';
const CLIENT_HUB = 'cliente-hub';
const CLIENT_CANCELADO = 'cliente-zeca';
const CLIENT_B = 'cliente-filmes';
const CLIENT_ALMA = 'cliente-alma9';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const ORIGIN = 'https://ideworks.test';
/** Terça-feira, 06/10/2026, 09h em São Paulo. */
const AGORA = new Date('2026-10-06T12:00:00.000Z');
const OUT = '2026-10-01';
const SET = '2026-09-01';

const COMPANIES = [
  { id: COMPANY_A, name: 'Agência Ide' },
  { id: COMPANY_B, name: 'Ide Filmes' },
  { id: COMPANY_ALMA, name: 'Alma Nove' },
];

const SUPER: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [COMPANY_A, COMPANY_B, COMPANY_ALMA],
  clientIds: [CLIENT_HELP, CLIENT_REBROTA, CLIENT_HUB, CLIENT_CANCELADO, CLIENT_B, CLIENT_ALMA],
  hasAllClientsAccess: true,
};
const SEM_ALMA: PersonAccess = { ...SUPER, omittedCompanyIds: [COMPANY_ALMA] };

function grant(partial: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: 'grant-entrega',
    ownerId: OWNER_ID,
    oauthClientId: 'claude',
    name: 'Claude da agência',
    capabilities: ['reports:delivery:read'],
    allowedCompanyIds: null,
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
    ...partial,
  };
}

function peca(
  clientId: string,
  scheduledOn: string | null,
  completed: boolean,
  extra: Partial<MemoryDeliveryItem> = {},
): MemoryDeliveryItem {
  return {
    clientId,
    referenceMonth: scheduledOn === null ? OUT : `${scheduledOn.slice(0, 7)}-01`,
    contentType: 'arte',
    isExtra: false,
    isCompleted: completed,
    scheduledOn,
    ...extra,
  };
}

/**
 * Hiper Center (o caso medido em 06/10): entregou 02/10 e 05/10, uma vencida de
 * 21/09, uma que vence hoje, uma adiantada (08/10 com ✓), próximas 07/10 e
 * 09/10, uma sem dia de outubro (conta) e uma sem dia de setembro (não conta).
 * Rebrota: entregou às 23h30 de 05/10 em São Paulo (02h30 de 06/10 em UTC) —
 * é entrega de 05/10. HUB: ativo sem peça nenhuma. Zeca: CANCELADO, com peça.
 * Filmes: outra empresa. Alma: empresa omitida.
 */
const ITEMS: MemoryDeliveryItem[] = [
  peca(CLIENT_HELP, '2026-10-02', true),
  peca(CLIENT_HELP, '2026-10-05', true, { isExtra: true }),
  peca(CLIENT_HELP, '2026-09-21', false),
  peca(CLIENT_HELP, '2026-10-06', false),
  peca(CLIENT_HELP, '2026-10-08', true),
  peca(CLIENT_HELP, '2026-10-09', false),
  peca(CLIENT_HELP, '2026-10-07', false),
  peca(CLIENT_HELP, null, false),
  peca(CLIENT_HELP, null, true, { referenceMonth: SET }),
  peca(CLIENT_REBROTA, '2026-10-06', true, { scheduledAt: '2026-10-06T02:30:00.000Z' }),
  peca(CLIENT_CANCELADO, '2026-10-01', true),
  peca(CLIENT_CANCELADO, '2026-09-15', false),
  peca(CLIENT_B, '2026-09-30', true),
  peca(CLIENT_ALMA, '2026-10-03', true),
];

const DATA: MemoryDeliveryData = {
  clients: [
    { id: CLIENT_HELP, name: 'Hiper Center', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_REBROTA, name: 'Rebrota', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_HUB, name: 'Cliente HUB', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_CANCELADO, name: 'Zeca', companyId: COMPANY_A, companyName: 'Agência Ide', isActive: false },
    { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes' },
    { id: CLIENT_ALMA, name: 'Cliente Alma', companyId: COMPANY_ALMA, companyName: 'Alma Nove' },
  ],
  items: ITEMS,
};
const CATALOG = new MemoryDeliveryCatalog(DATA);

function ctxFor(
  g: IntegrationGrant = grant(),
  person: PersonAccess = SUPER,
  delivery: DeliveryCatalog = CATALOG,
): ReportCtx {
  return { grant: g, person, origin: 'http', companies: COMPANIES, displayName: 'Wesley Lourenço', delivery, now: AGORA };
}

async function ok(input: Parameters<typeof getDeliveryStatus>[1], ctx: ReportCtx = ctxFor()) {
  const result = await getDeliveryStatus(ctx, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.body;
}

const NEGADO = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };

describe('get_delivery_status — a leitura', () => {
  it('uma linha por cliente ativo, por nome: última entrega, dias, vencidas com o dia, vence hoje, sem dia e próxima', async () => {
    const body = await ok({});
    expect(body.operation).toBe('get_delivery_status');
    expect(body.source).toBe('semanal');
    expect(body.today).toBe('2026-10-06');
    expect(body.timezone).toBe('America/Sao_Paulo');
    expect(body.coverage).toEqual({ kind: 'full' });
    expect(body.clients.map((c) => c.name)).toEqual(['Cliente Alma', 'Cliente Filmes', 'Cliente HUB', 'Hiper Center', 'Rebrota']);
    expect(body.activeClients).toBe(5);

    const help = body.clients.find((c) => c.id === CLIENT_HELP);
    expect(help).toEqual({
      id: CLIENT_HELP,
      name: 'Hiper Center',
      company: { id: COMPANY_A, name: 'Agência Ide' },
      lastDeliveryOn: '2026-10-05',
      daysSinceLastDelivery: 1,
      overdueCount: 1,
      overdueDays: ['2026-09-21'],
      dueToday: 1,
      unscheduled: 1,
      nextScheduledOn: '2026-10-07',
    });

    // A virada do dia é a de São Paulo: 02h30 UTC de 06/10 é 23h30 de 05/10.
    const rebrota = body.clients.find((c) => c.id === CLIENT_REBROTA);
    expect(rebrota?.lastDeliveryOn).toBe('2026-10-05');
    expect(rebrota?.daysSinceLastDelivery).toBe(1);

    // Ativo sem peça nenhuma: aparece, com "sem entrega registrada".
    const hub = body.clients.find((c) => c.id === CLIENT_HUB);
    expect(hub).toMatchObject({
      lastDeliveryOn: null,
      daysSinceLastDelivery: null,
      overdueCount: 0,
      overdueDays: [],
      dueToday: 0,
      unscheduled: 0,
      nextScheduledOn: null,
    });
  });

  it('os números são os de deliveryStatusOf sobre as mesmas peças — não há segunda regra', async () => {
    const body = await ok({});
    const snapshot = await CATALOG.loadDeliveryStatus(
      { companies: { kind: 'all' }, clients: 'all', capabilities: new Set(['reports:delivery:read']) as never },
      AGORA,
    );
    for (const row of body.clients) {
      const regra = deliveryStatusOf(snapshot.pieces.get(row.id) ?? [], AGORA);
      expect(row.lastDeliveryOn).toBe(regra.lastDeliveryOn);
      expect(row.daysSinceLastDelivery).toBe(regra.daysSinceLastDelivery);
      expect(row.overdueDays).toEqual(regra.overdue);
      expect(row.overdueCount).toBe(regra.overdue.length);
      expect(row.dueToday).toBe(regra.dueToday);
      expect(row.unscheduled).toBe(regra.unscheduled);
      expect(row.nextScheduledOn).toBe(regra.nextScheduledOn);
      expect(body.today).toBe(regra.today);
    }
  });

  it('cliente cancelado não aparece: nem na lista, nem pelo clientId (a mesma recusa de um id de fora)', async () => {
    const body = await ok({});
    expect(body.clients.map((c) => c.id)).not.toContain(CLIENT_CANCELADO);
    expect(JSON.stringify(body)).not.toContain('Zeca');
    expect(body.activeClients).toBe(body.clients.length);

    const pelaId = await getDeliveryStatus(ctxFor(), { clientId: CLIENT_CANCELADO });
    const inexistente = await getDeliveryStatus(ctxFor(), { clientId: 'cliente-que-nao-existe' });
    expect(pelaId).toEqual(NEGADO);
    expect(inexistente).toEqual(NEGADO);
  });

  it('recorte por concessão: só os clientes concedidos, cobertura parcial e o total do alcance', async () => {
    const soHelp = await ok({}, ctxFor(grant({ allowedClientIds: [CLIENT_HELP, CLIENT_CANCELADO] })));
    expect(soHelp.clients.map((c) => c.id)).toEqual([CLIENT_HELP]);
    expect(soHelp.activeClients).toBe(1);
    expect(soHelp.coverage.kind).toBe('partial');
    expect(soHelp.coverage.reason).toBeTruthy();

    const soEmpresaA = await ok({}, ctxFor(grant({ allowedCompanyIds: [COMPANY_A] })));
    expect(soEmpresaA.clients.map((c) => c.id)).toEqual([CLIENT_HUB, CLIENT_HELP, CLIENT_REBROTA]);
    expect(soEmpresaA.activeClients).toBe(3);
    expect(soEmpresaA.coverage.kind).toBe('partial');
    expect(JSON.stringify(soEmpresaA)).not.toContain('Cliente Filmes');
    expect(JSON.stringify(soEmpresaA)).not.toContain('Cliente Alma');

    // Pedir pelo id um cliente fora da concessão é recusa, não linha vazia.
    const fora = await getDeliveryStatus(ctxFor(grant({ allowedClientIds: [CLIENT_HELP] })), { clientId: CLIENT_B });
    expect(fora).toEqual(NEGADO);
  });

  it('concessão parcial da PESSOA (sem acesso a todos os clientes) também marca cobertura parcial', async () => {
    const pessoa: PersonAccess = {
      ...SUPER,
      isSuperadmin: false,
      isSuper: false,
      hasAllClientsAccess: false,
      clientIds: [CLIENT_REBROTA],
      companyIds: [COMPANY_A],
    };
    const body = await ok({}, ctxFor(grant(), pessoa));
    expect(body.clients.map((c) => c.id)).toEqual([CLIENT_REBROTA]);
    expect(body.activeClients).toBe(1);
    expect(body.coverage.kind).toBe('partial');
  });

  it('cliente da empresa omitida (Alma Nove) não aparece, nem pelo id', async () => {
    const body = await ok({}, ctxFor(grant(), SEM_ALMA));
    expect(body.clients.map((c) => c.id)).not.toContain(CLIENT_ALMA);
    expect(JSON.stringify(body)).not.toContain('Alma');
    expect(body.activeClients).toBe(4);

    const pelaId = await getDeliveryStatus(ctxFor(grant(), SEM_ALMA), { clientId: CLIENT_ALMA });
    expect(pelaId).toEqual(NEGADO);
  });

  it('permission_denied sem reports:delivery:read, antes de validar o resto', async () => {
    const semCapacidade = grant({ capabilities: ['boards:read'] });
    expect(await getDeliveryStatus(ctxFor(semCapacidade), {})).toEqual(NEGADO);
    expect(await getDeliveryStatus(ctxFor(semCapacidade), { limit: 0 })).toEqual(NEGADO);
  });

  it('limite e cursor ruins são recusados antes de ler o banco; com clientId, UMA leitura estreitada', async () => {
    let lidas = 0;
    const escopos: unknown[] = [];
    const espiao: DeliveryCatalog = {
      load: (scope, period) => CATALOG.load(scope, period),
      loadCalendar: (scope, period) => CATALOG.loadCalendar(scope, period),
      loadMonthly: (scope, period) => CATALOG.loadMonthly(scope, period),
      loadPlanning: (scope, month) => CATALOG.loadPlanning(scope, month),
      loadDeliveryStatus: (scope, now) => {
        lidas += 1;
        escopos.push(scope.clients);
        return CATALOG.loadDeliveryStatus(scope, now);
      },
    };
    const ctx = ctxFor(grant(), SUPER, espiao);
    const limite = await getDeliveryStatus(ctx, { limit: 101 });
    expect(limite.ok === false && limite.code).toBe('limit_exceeded');
    const zero = await getDeliveryStatus(ctx, { limit: 0 });
    expect(zero.ok === false && zero.code).toBe('invalid_input');
    const cursor = await getDeliveryStatus(ctx, { cursor: 'lixo!' });
    expect(cursor.ok === false && cursor.code).toBe('invalid_cursor');
    expect(lidas).toBe(0);

    const body = await ok({ clientId: CLIENT_HELP }, ctx);
    expect(body.clients.map((c) => c.id)).toEqual([CLIENT_HELP]);
    expect(body.activeClients).toBe(1);
    expect(escopos).toEqual([new Set([CLIENT_HELP])]);
    expect(body.self).toBe(`${GET_DELIVERY_STATUS_PATH}?clientId=${CLIENT_HELP}`);
  });

  it('paginação por nome: limit corta e o cursor segue, com activeClients do filtro inteiro', async () => {
    const primeira = await ok({ limit: 2 });
    expect(primeira.clients).toHaveLength(2);
    expect(primeira.hasMore).toBe(true);
    expect(primeira.activeClients).toBe(5);
    const segunda = await ok({ limit: 2, cursor: primeira.nextCursor as string });
    const terceira = await ok({ limit: 2, cursor: segunda.nextCursor as string });
    const vistos = [...primeira.clients, ...segunda.clients, ...terceira.clients].map((c) => c.id);
    expect(vistos).toEqual((await ok({})).clients.map((c) => c.id));
    expect(terceira.hasMore).toBe(false);
  });

  it('catálogo vazio (sem Hyperdrive): lista vazia, não erro', async () => {
    const body = await ok({}, ctxFor(grant(), SUPER, new MemoryDeliveryCatalog()));
    expect(body.clients).toEqual([]);
    expect(body.activeClients).toBe(0);
  });
});

describe('get_delivery_status — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']]));

  it('OpenAPI publica GET e POST, schemas iguais ao Zod e exemplo válido; entrada estrita', () => {
    const doc = integrationOpenApi() as {
      info: { description: string };
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths['/get_delivery_status'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(doc.components.schemas.GetDeliveryStatusInput).toEqual(jsonSchemaFromZod(getDeliveryStatusInputSchema));
    expect(doc.components.schemas.GetDeliveryStatusResponse).toEqual(
      jsonSchemaFromZod(getDeliveryStatusResponseSchema),
    );
    expect(doc.info.description).toContain('get_delivery_status');
    const exemplo = getDeliveryStatusResponseSchema.parse(getDeliveryStatusOpenApiExample());
    expect(exemplo.clients[0]?.overdueDays).toHaveLength(exemplo.clients[0]?.overdueCount ?? -1);

    expect(getDeliveryStatusInputSchema.safeParse({}).success).toBe(true);
    expect(getDeliveryStatusInputSchema.safeParse({ clientId: CLIENT_HELP, limit: 10 }).success).toBe(true);
    expect(getDeliveryStatusInputSchema.safeParse({ month: '2026-10' }).success).toBe(false);
    expect(getDeliveryStatusInputSchema.safeParse({ clientId: '' }).success).toBe(false);
  });

  function http(path: string, init?: RequestInit, g: IntegrationGrant = grant()) {
    return dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${path}`, init),
      grant: g,
      person: SUPER,
      origin: 'http',
      catalog: memoryCatalog,
      delivery: CATALOG,
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

  async function mcp(method: string, params: unknown, g: IntegrationGrant = grant()) {
    const response = await handleMcpRequest({
      request: mcpPost(method, params),
      grant: g,
      person: SUPER,
      origin: 'mcp',
      catalog: memoryCatalog,
      work: EMPTY_WORK_CATALOG,
      delivery: CATALOG,
      marketing: new MemoryMarketingCatalog(),
      now: AGORA,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { result: Record<string, unknown> }).result;
  }

  async function callTool(args: unknown, g: IntegrationGrant = grant()) {
    return (await mcp('tools/call', { name: 'get_delivery_status', arguments: args }, g)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
    };
  }

  it('paridade: HTTP GET, HTTP POST, MCP e a função devolvem o mesmo corpo', async () => {
    const direto = await ok({ clientId: CLIENT_HELP });

    const get = await http(`${GET_DELIVERY_STATUS_PATH}?clientId=${CLIENT_HELP}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);

    const post = await http(GET_DELIVERY_STATUS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_HELP }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual(direto);

    const tool = await callTool({ clientId: CLIENT_HELP });
    expect(tool.isError).toBeUndefined();
    expect(tool.structuredContent).toEqual(direto);
    expect(tool.content[0]?.text).toContain('entrega pela Semanal');
    expect(tool.content[0]?.text).toContain('com peça vencida: Hiper Center (1)');
  });

  it('HTTP: 403 sem a permissão, 400 com campo desconhecido e com cursor ruim; limit na query é número', async () => {
    const sem = await http(GET_DELIVERY_STATUS_PATH, undefined, grant({ capabilities: ['boards:read'] }));
    expect(sem.status).toBe(403);
    const extra = await http(`${GET_DELIVERY_STATUS_PATH}?foo=1`);
    expect(extra.status).toBe(400);
    expect(((await extra.json()) as { error: string }).error).toBe('invalid_input');
    const cursor = await http(`${GET_DELIVERY_STATUS_PATH}?cursor=lixo!`);
    expect(cursor.status).toBe(400);
    expect(((await cursor.json()) as { error: string }).error).toBe('invalid_cursor');
    const limitado = await http(`${GET_DELIVERY_STATUS_PATH}?limit=2`);
    expect(limitado.status).toBe(200);
    expect(getDeliveryStatusResponseSchema.parse(await limitado.json()).clients).toHaveLength(2);
  });

  it('MCP: a descrição diz a fonte, só ativos, cancelado fora e aponta get_delivery_report para a cota', async () => {
    const list = (await mcp('tools/list', {})) as { tools: Array<{ name: string; description: string }> };
    const tool = list.tools.find((t) => t.name === 'get_delivery_status');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('Semanal');
    expect(tool?.description).toContain('ATIVO');
    expect(tool?.description).toContain('cancelado não aparece');
    expect(tool?.description.toLowerCase()).toContain('para entrega por cota (nível do mês) use get_delivery_report');
  });

  it('MCP: recusa com código estável (sem permissão, cancelado, campo desconhecido)', async () => {
    const sem = await callTool({}, grant({ capabilities: ['boards:read'] }));
    expect(sem.isError).toBe(true);
    expect((JSON.parse(sem.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');

    const cancelado = await callTool({ clientId: CLIENT_CANCELADO });
    expect(cancelado.isError).toBe(true);
    expect((JSON.parse(cancelado.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');

    const extra = await callTool({ foo: 1 });
    expect(extra.isError).toBe(true);
  });
});

describe('SqlDeliveryCatalog.loadDeliveryStatus', () => {
  it('escopo vazio e id que não é UUID respondem vazio sem falar com o banco', async () => {
    const catalog = new SqlDeliveryCatalog({} as never, { kind: 'preauth' });
    const capabilities = new Set(['reports:delivery:read']) as never;
    const vazio = await catalog.loadDeliveryStatus({ companies: { kind: 'none' }, clients: 'none', capabilities }, AGORA);
    expect(vazio.clients).toEqual([]);
    const naoUuid = await catalog.loadDeliveryStatus(
      { companies: { kind: 'all' }, clients: new Set(['cliente-x']), capabilities },
      AGORA,
    );
    expect(naoUuid.clients).toEqual([]);
    expect(naoUuid.pieces.size).toBe(0);
  });
});
