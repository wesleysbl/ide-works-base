/**
 * `get_client` com o cadastro e `list_clients` — conferência de 08/10/2026, lacuna G5.
 *
 * A ficha do cliente chegava mínima (id, nome, empresa, listas): sem plano, cota
 * vigente, renovação, urgência, financeiro ok e etiquetas. Agora vem, e a
 * carteira ativa sai numa lista. O que NÃO sai, nunca: contato (telefone,
 * WhatsApp, e-mail, CNPJ, endereço, responsável do cliente) e observações. Os
 * testes provam o recorte (outra empresa, outro cliente da mesma empresa,
 * empresa omitida, cancelado), a capacidade (`clients:read`), que a isca de
 * contato não vaza, o cursor até o fim e as três superfícies iguais.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  GET_CLIENT_PATH,
  LIST_CLIENTS_PATH,
  getClientOpenApiExample,
  getClientResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
  listClientsInputSchema,
  listClientsOpenApiExample,
  listClientsResponseSchema,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { RESPONSE_BUDGET_BYTES, measureJsonBytes } from '@/integrations/page';
import { MemoryWorkCatalog, getClientWork, listClientsWork, type MemoryClient } from '@/integrations/reads';
import { EMPTY_DELIVERY_CATALOG } from '@/integrations/reports';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_ALMA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const ORIGIN = 'https://ideworks.test';
const AGORA = new Date('2026-10-08T12:00:00.000Z');
const ISCA = ['11 99999-0000', 'financeiro@jatoba.com.br', '12.345.678/0001-90', 'Dona Maria', 'Cliente difícil'];

const SUPER: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [COMPANY_A, COMPANY_B, COMPANY_ALMA],
  clientIds: [],
  hasAllClientsAccess: true,
};
const SEM_ALMA: PersonAccess = { ...SUPER, omittedCompanyIds: [COMPANY_ALMA] };
/** Quem alcança só a empresa A. */
const DA_EMPRESA_A: PersonAccess = {
  ...SUPER,
  isSuper: false,
  isSuperadmin: false,
  hasAllClientsAccess: false,
  companyIds: [COMPANY_A],
  clientIds: ['c-jatoba', 'c-sonho', 'c-agua'],
};

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: 'grant-carteira',
  ownerId: OWNER_ID,
  oauthClientId: 'claude',
  name: 'Claude',
  capabilities: ['clients:read', 'boards:read'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
  ...over,
});

const cliente = (over: Partial<MemoryClient> & { id: string; name: string }): MemoryClient => ({
  companyId: COMPANY_A,
  companyName: 'Agência Ide',
  listIds: [],
  ...over,
});

const CLIENTES: MemoryClient[] = [
  cliente({
    id: 'c-jatoba',
    name: 'Jatobá',
    plan: { id: 'plano-premium', name: 'Premium' },
    urgency: 'alerta',
    financeOk: true,
    startedOn: '2024-03-01',
    renewsOn: '2027-03-01',
    quotas: [
      { type: 'video', quantity: 8 },
      { type: 'arte', quantity: 4 },
    ],
    tags: [{ id: 'tag-restaurante', name: 'Restaurante', color: '#f59e0b' }],
    phone: ISCA[0],
    email: ISCA[1],
    taxId: ISCA[2],
    ownerName: ISCA[3],
    notes: ISCA[4],
  }),
  cliente({ id: 'c-sonho', name: 'Sabor Doce', urgency: 'perigo', financeOk: false, plan: null }),
  cliente({ id: 'c-agua', name: 'Água Viva', urgency: 'paz', renewsOn: '2026-11-15', tags: [] }),
  cliente({ id: 'c-filmes', name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes', urgency: 'alerta' }),
  cliente({ id: 'c-alma', name: 'Cliente Alma', companyId: COMPANY_ALMA, companyName: 'Alma Nove', urgency: 'perigo' }),
  cliente({ id: 'c-zeca', name: 'Zeca', isActive: false, cancelledOn: '2026-10-04', urgency: 'perigo' }),
];

const WORK = new MemoryWorkCatalog({ clients: CLIENTES });
const COMPANIES = [
  { id: COMPANY_A, name: 'Agência Ide' },
  { id: COMPANY_B, name: 'Ide Filmes' },
];
const ctx = (g: IntegrationGrant = grant(), person: PersonAccess = SUPER, work: MemoryWorkCatalog = WORK) => ({
  grant: g,
  person,
  origin: 'http' as const,
  companies: COMPANIES,
  displayName: 'Wesley',
  work,
  now: AGORA,
});
const NEGADO = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };

async function lista(input: Parameters<typeof listClientsWork>[1], c = ctx()) {
  const r = await listClientsWork(c, input);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.body;
}

describe('get_client — o cadastro', () => {
  it('plano, urgência, início, renovação, cota vigente e etiquetas (nunca contato, nunca o financeiro)', async () => {
    const r = await getClientWork(ctx(), { id: 'c-jatoba' });
    if (!r.ok) throw new Error(r.message);
    const client = getClientResponseSchema.parse(r.body).client;
    expect(client).toMatchObject({
      id: 'c-jatoba',
      name: 'Jatobá',
      company: { id: COMPANY_A, name: 'Agência Ide' },
      plan: { id: 'plano-premium', name: 'Premium' },
      urgency: 'alerta',
      startedOn: '2024-03-01',
      renewsOn: '2027-03-01',
      quotas: [
        { type: 'video', quantity: 8 },
        { type: 'arte', quantity: 4 },
      ],
      tags: [{ id: 'tag-restaurante', name: 'Restaurante', color: '#f59e0b' }],
    });
    const texto = JSON.stringify(r.body);
    for (const isca of ISCA) expect(texto).not.toContain(isca);
    expect(texto).not.toMatch(/phone|email|taxId|ownerName|notes/);
    // O financeiro (o cliente pagou?) fica só na tela: o dublê tem o dado de isca, e a saída não o leva.
    expect(texto).not.toMatch(/financeOk|finance_ok/);
  });

  it('o contrato não tem financeOk: os exemplos do OpenAPI não o levam e o schema estrito o recusa', () => {
    const get = getClientOpenApiExample();
    const lista = listClientsOpenApiExample();
    expect(JSON.stringify(get)).not.toContain('financeOk');
    expect(JSON.stringify(lista)).not.toContain('financeOk');
    expect(getClientResponseSchema.safeParse(get).success).toBe(true);
    expect(listClientsResponseSchema.safeParse(lista).success).toBe(true);
    // Um catálogo que voltasse a devolver o campo quebraria a resposta, em vez de vazar em silêncio.
    expect(getClientResponseSchema.safeParse({ ...get, client: { ...get.client, financeOk: true } }).success).toBe(false);
    expect(
      listClientsResponseSchema.safeParse({ ...lista, clients: [{ ...lista.clients[0], financeOk: true }] }).success,
    ).toBe(false);
  });

  it('cadastro mínimo: sem plano, sem cota nem etiqueta', async () => {
    const r = await getClientWork(ctx(), { id: 'c-sonho' });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.client).toMatchObject({ plan: null, urgency: 'perigo', startedOn: null, renewsOn: null, quotas: [], tags: [] });
  });

  it('cliente cancelado: só id, nome, cancelled e cancelledOn — como antes', async () => {
    const r = await getClientWork(ctx(), { id: 'c-zeca' });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.client).toEqual({ id: 'c-zeca', name: 'Zeca', cancelled: true, cancelledOn: '2026-10-04' });
  });

  it('outra empresa, outro cliente da concessão, omitida e sem clients:read: a mesma recusa', async () => {
    expect(await getClientWork(ctx(grant({ allowedCompanyIds: [COMPANY_B] })), { id: 'c-jatoba' })).toEqual(NEGADO);
    expect(await getClientWork(ctx(grant({ allowedClientIds: ['c-sonho'] })), { id: 'c-jatoba' })).toEqual(NEGADO);
    expect(await getClientWork(ctx(grant(), SEM_ALMA), { id: 'c-alma' })).toEqual(NEGADO);
    expect(await getClientWork(ctx(grant({ capabilities: ['boards:read'] })), { id: 'c-jatoba' })).toEqual(NEGADO);
    expect(await getClientWork(ctx(), { id: 'c-que-nao-existe' })).toEqual(NEGADO);
  });
});

describe('list_clients — a carteira ativa', () => {
  it('uma linha por cliente ativo, por nome, com o cadastro, sem contato e sem o financeiro', async () => {
    const body = await lista({});
    expect(body.operation).toBe('list_clients');
    expect(body.clients.map((c) => c.name)).toEqual(['Água Viva', 'Cliente Alma', 'Cliente Filmes', 'Jatobá', 'Sabor Doce']);
    expect(body.total).toBe(5);
    expect(body.clients.find((c) => c.id === 'c-jatoba')).toEqual({
      id: 'c-jatoba',
      name: 'Jatobá',
      company: { id: COMPANY_A, name: 'Agência Ide' },
      plan: { id: 'plano-premium', name: 'Premium' },
      urgency: 'alerta',
      startedOn: '2024-03-01',
      renewsOn: '2027-03-01',
      tags: [{ id: 'tag-restaurante', name: 'Restaurante', color: '#f59e0b' }],
    });
    const texto = JSON.stringify(body);
    expect(texto).not.toMatch(/financeOk|finance_ok/);
    for (const isca of ISCA) expect(texto).not.toContain(isca);
    // O cancelado não está na carteira.
    expect(texto).not.toContain('Zeca');
  });

  it('filtros: empresa, urgência e nome (sem acento nem caixa)', async () => {
    expect((await lista({ companyId: COMPANY_B })).clients.map((c) => c.id)).toEqual(['c-filmes']);
    expect((await lista({ urgency: 'perigo' })).clients.map((c) => c.id)).toEqual(['c-alma', 'c-sonho']);
    expect((await lista({ q: 'agua' })).clients.map((c) => c.id)).toEqual(['c-agua']);
    expect((await lista({ q: 'JATOBA' })).clients.map((c) => c.id)).toEqual(['c-jatoba']);
    expect((await lista({ q: 'cliente', urgency: 'alerta' })).clients.map((c) => c.id)).toEqual(['c-filmes']);
    const nada = await lista({ q: 'zzz' });
    expect(nada.clients).toEqual([]);
    expect(nada.total).toBe(0);
    expect((await lista({ urgency: 'perigo' })).self).toBe(`${LIST_CLIENTS_PATH}?urgency=perigo`);
  });

  it('outra empresa: a concessão da A não vê a B nem a Alma, nem pelo filtro de empresa', async () => {
    const soA = ctx(grant({ allowedCompanyIds: [COMPANY_A] }));
    expect((await lista({}, soA)).clients.map((c) => c.id)).toEqual(['c-agua', 'c-jatoba', 'c-sonho']);
    expect((await lista({ companyId: COMPANY_B }, soA)).clients).toEqual([]);
    expect(JSON.stringify(await lista({}, soA))).not.toMatch(/Filmes|Alma/);
    const daEmpresaA = ctx(grant(), DA_EMPRESA_A);
    expect((await lista({}, daEmpresaA)).clients.map((c) => c.id)).toEqual(['c-agua', 'c-jatoba', 'c-sonho']);
  });

  it('outro cliente na MESMA empresa: concessão por cliente só devolve o permitido', async () => {
    const body = await lista({}, ctx(grant({ allowedClientIds: ['c-jatoba'] })));
    expect(body.clients.map((c) => c.id)).toEqual(['c-jatoba']);
    expect(body.total).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/Sabor Doce|Água Viva/);
  });

  it('empresa omitida (Alma Nove): nenhum rastro', async () => {
    const body = await lista({}, ctx(grant(), SEM_ALMA));
    expect(body.clients.map((c) => c.id)).not.toContain('c-alma');
    expect(JSON.stringify(body)).not.toContain('Alma');
    expect(body.total).toBe(4);
  });

  it('sem clients:read: permission_denied, antes de olhar o pedido', async () => {
    const semCap = ctx(grant({ capabilities: ['boards:read'] }));
    expect(await listClientsWork(semCap, {})).toEqual(NEGADO);
    expect(await listClientsWork(semCap, { limit: 0 })).toEqual(NEGADO);
  });

  it('limite e cursor ruins são recusados', async () => {
    expect((await listClientsWork(ctx(), { limit: 101 })).ok).toBe(false);
    expect((await listClientsWork(ctx(), { limit: 0 })).ok).toBe(false);
    const c = await listClientsWork(ctx(), { cursor: 'lixo!' });
    expect(c.ok === false && c.code).toBe('invalid_cursor');
  });
});

describe('list_clients — paginação e orçamento', () => {
  const MUITOS: MemoryClient[] = Array.from({ length: 450 }, (_, n) =>
    cliente({
      id: `c-${String(n).padStart(3, '0')}`,
      name: `Cliente de nome comprido para pesar no corpo número ${String(n).padStart(3, '0')}`,
      plan: { id: 'plano-premium', name: 'Premium' },
      urgency: n % 3 === 0 ? 'perigo' : 'paz',
      financeOk: n % 2 === 0,
      renewsOn: '2027-01-01',
      tags: [
        { id: `tag-${n}-a`, name: 'Restaurante com nome comprido', color: '#f59e0b' },
        { id: `tag-${n}-b`, name: 'Franquia', color: '#123456' },
      ],
    }),
  );
  const work = new MemoryWorkCatalog({ clients: MUITOS });

  it('o cursor anda até o fim: cada página cabe em 64 KiB e as páginas trazem todos, uma vez só', async () => {
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const pagina = await lista({ limit: 100, cursor }, ctx(grant(), SUPER, work));
      expect(measureJsonBytes(pagina)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      expect(pagina.total).toBe(450);
      vistos.push(...pagina.clients.map((c) => c.id));
      cursor = pagina.nextCursor ?? undefined;
      expect(pagina.hasMore).toBe(cursor !== undefined);
      paginas += 1;
    } while (cursor !== undefined && paginas < 30);
    expect(vistos).toEqual(MUITOS.map((c) => c.id));
    expect(paginas).toBeGreaterThan(4);
  });

  it('com filtro, o total e as páginas valem para o filtro inteiro', async () => {
    const vistos: string[] = [];
    let cursor: string | undefined;
    do {
      const pagina = await lista({ urgency: 'perigo', limit: 50, cursor }, ctx(grant(), SUPER, work));
      expect(pagina.total).toBe(150);
      vistos.push(...pagina.clients.map((c) => c.id));
      cursor = pagina.nextCursor ?? undefined;
    } while (cursor);
    expect(vistos).toHaveLength(150);
    expect(new Set(vistos).size).toBe(150);
  });
});

describe('get_client e list_clients — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley']]));

  it('OpenAPI publica GET e POST, schemas iguais ao Zod e exemplos válidos; entrada estrita', () => {
    const doc = integrationOpenApi() as {
      info: { description: string };
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths['/list_clients'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(doc.components.schemas.ListClientsInput).toEqual(jsonSchemaFromZod(listClientsInputSchema));
    expect(doc.components.schemas.ListClientsResponse).toEqual(jsonSchemaFromZod(listClientsResponseSchema));
    expect(doc.components.schemas.GetClientResponse).toEqual(jsonSchemaFromZod(getClientResponseSchema));
    expect(doc.info.description).toContain('list_clients');
    expect(listClientsResponseSchema.parse(listClientsOpenApiExample()).clients.length).toBeGreaterThan(0);
    const exemplo = getClientResponseSchema.parse(getClientOpenApiExample());
    expect('quotas' in exemplo.client && exemplo.client.quotas?.length).toBeGreaterThan(0);

    expect(listClientsInputSchema.safeParse({ urgency: 'alerta', q: 'jac' }).success).toBe(true);
    expect(listClientsInputSchema.safeParse({ urgency: 'critico' }).success).toBe(false);
    expect(listClientsInputSchema.safeParse({ companyId: 'nao-e-uuid' }).success).toBe(false);
    expect(listClientsInputSchema.safeParse({ q: '' }).success).toBe(false);
    expect(listClientsInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  const http = (path: string, g: IntegrationGrant = grant(), init?: RequestInit) =>
    dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${path}`, init),
      grant: g,
      person: SUPER,
      origin: 'http',
      catalog: memoryCatalog,
      work: WORK,
      delivery: EMPTY_DELIVERY_CATALOG,
      now: AGORA,
    });

  async function callTool(name: string, args: unknown, g: IntegrationGrant = grant()) {
    const response = await handleMcpRequest({
      request: new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }),
      grant: g,
      person: SUPER,
      origin: 'mcp',
      catalog: memoryCatalog,
      work: WORK,
      delivery: EMPTY_DELIVERY_CATALOG,
      marketing: new MemoryMarketingCatalog(),
      now: AGORA,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
    }).result;
  }

  it('list_clients: HTTP GET, POST, MCP e a função devolvem o mesmo corpo', async () => {
    const direto = await lista({ urgency: 'alerta' });
    const get = await http(`${LIST_CLIENTS_PATH}?urgency=alerta`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);
    const post = await http(LIST_CLIENTS_PATH, grant(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urgency: 'alerta' }),
    });
    expect(await post.json()).toEqual(direto);
    const mcp = await callTool('list_clients', { urgency: 'alerta' });
    expect(mcp.structuredContent).toEqual(direto);
    expect(mcp.content[0]?.text).toContain('2 cliente(s)');
  });

  it('get_client: HTTP e MCP devolvem o cadastro; sem a capacidade, 403; sem contato', async () => {
    const get = await http(`${GET_CLIENT_PATH}?id=c-jatoba`);
    expect(get.status).toBe(200);
    const corpo = (await get.json()) as { client: { urgency: string; quotas: unknown[] } };
    expect(corpo.client.urgency).toBe('alerta');
    expect(corpo.client.quotas).toHaveLength(2);
    const mcp = await callTool('get_client', { id: 'c-jatoba' });
    expect(mcp.structuredContent).toEqual(corpo);
    for (const isca of ISCA) expect(JSON.stringify(mcp.structuredContent)).not.toContain(isca);
    expect((await http(`${GET_CLIENT_PATH}?id=c-jatoba`, grant({ capabilities: ['boards:read'] }))).status).toBe(403);
  });

  it('list_clients: 403 sem clients:read, 400 com entrada inválida, 400 com cursor ruim; MCP com erro estável', async () => {
    expect((await http(LIST_CLIENTS_PATH, grant({ capabilities: ['boards:read'] }))).status).toBe(403);
    for (const ruim of ['urgency=critico', 'companyId=x', 'foo=1', 'q=']) {
      const r = await http(`${LIST_CLIENTS_PATH}?${ruim}`);
      expect(r.status).toBe(400);
    }
    const cursor = await http(`${LIST_CLIENTS_PATH}?cursor=lixo!`);
    expect(((await cursor.json()) as { error: string }).error).toBe('invalid_cursor');
    const sem = await callTool('list_clients', {}, grant({ capabilities: ['boards:read'] }));
    expect(sem.isError).toBe(true);
    expect((JSON.parse(sem.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');
    expect((await callTool('list_clients', { urgency: 'critico' })).isError).toBe(true);
  });
});
