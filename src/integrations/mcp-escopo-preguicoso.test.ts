/**
 * O ESCOPO DO MCP E DA API HTTP SÓ É LIDO QUEM O USA — perf do servidor, 08/10/2026.
 *
 * O PROBLEMA
 *   Toda chamada de integração lia do banco, ANTES de despachar, as empresas
 *   que o dono alcança e o nome dele — duas transações (begin, declaração do
 *   ator, consulta, commit, duas vezes). Valia também para `initialize`,
 *   `tools/list` e as escritas, que nunca usam nenhum dos dois.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. As chamadas que não usam o escopo não tocam no catálogo.
 *   2. As que usam leem UMA vez (e numa transação só, quando o catálogo sabe).
 *   3. A resposta é a MESMA: o corpo de cada leitura, pelo caminho preguiçoso, é
 *      idêntico ao de quando o escopo vinha lido de antemão.
 *   4. O catálogo SQL devolve, na transação única, exatamente as linhas das duas
 *      consultas separadas — contra um Postgres de verdade (PGlite).
 */

import { PGlite } from '@electric-sql/pglite';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MemoryCatalog,
  lerEscopoDoCatalogo,
  type IntegrationCatalog,
  type IntegrationCompany,
  type IntegrationScope,
} from '@/integrations/context';
import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import {
  MCP_PREVIEW_TOOL_NAMES,
  MCP_READ_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
  executeTool,
  handleMcpRequest,
  type McpLoaded,
} from '@/integrations/mcp';
import { EMPTY_WORK_CATALOG } from '@/integrations/reads';
import { EMPTY_DELIVERY_CATALOG } from '@/integrations/reports';
import { criarAdaptadorPglite, type AdaptadorPglite } from '@/server/pglite-adaptador';

const ORIGIN = 'https://ideworks.test';
const OWNER = '11111111-1111-4111-8111-111111111111';
const EMPRESA_A = '22222222-2222-4222-8222-222222222222';
const EMPRESA_B = '33333333-3333-4333-8333-333333333333';
const AGORA = new Date('2026-10-08T12:00:00.000Z');

const grant: IntegrationGrant = {
  id: '44444444-4444-4444-8444-444444444444',
  ownerId: OWNER,
  oauthClientId: 'claude',
  name: 'Claude',
  capabilities: ['boards:read', 'tasks:read', 'reports:delivery:read', 'comments:write', 'tasks:move'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const person: PersonAccess = {
  userId: OWNER,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [],
  clientIds: [],
  hasAllClientsAccess: true,
};

/** Um catálogo que conta quem o chamou — por qual porta, e quantas vezes. */
class CatalogoQueConta implements IntegrationCatalog {
  chamadas = { companies: 0, displayName: 0, scope: 0 };
  private readonly interno = new MemoryCatalog(
    [
      { id: EMPRESA_B, name: 'Ide Filmes' },
      { id: EMPRESA_A, name: 'Agência Ide' },
    ],
    new Map([[OWNER, 'Wesley Lourenço']]),
  );

  constructor(comScope: boolean) {
    if (comScope) {
      this.scope = async (ownerId: string): Promise<IntegrationScope> => {
        this.chamadas.scope += 1;
        return { companies: await this.interno.companies(), displayName: await this.interno.displayName(ownerId) };
      };
    }
  }

  scope?: (ownerId: string) => Promise<IntegrationScope>;

  async companies(): Promise<readonly IntegrationCompany[]> {
    this.chamadas.companies += 1;
    return this.interno.companies();
  }

  async displayName(ownerId: string): Promise<string | null> {
    this.chamadas.displayName += 1;
    return this.interno.displayName(ownerId);
  }

  get total(): number {
    return this.chamadas.companies + this.chamadas.displayName + this.chamadas.scope;
  }
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

function mcp(catalog: IntegrationCatalog, method: string, params: unknown, fallback?: string) {
  return handleMcpRequest({
    request: mcpPost(method, params),
    grant,
    person,
    origin: 'mcp',
    catalog,
    work: EMPTY_WORK_CATALOG,
    delivery: EMPTY_DELIVERY_CATALOG,
    marketing: new MemoryMarketingCatalog(),
    displayNameFallback: fallback,
    now: AGORA,
  });
}

function http(catalog: IntegrationCatalog, path: string, init?: RequestInit) {
  // As rotas moram em `HTTP_INTEGRATIONS_PATH` (`/api/integrations/v1`).
  return dispatchIntegrationHttp({
    request: new Request(`${ORIGIN}${path}`, init),
    grant,
    person,
    origin: 'http',
    catalog,
    now: AGORA,
  });
}

const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe('MCP — o catálogo só é lido por quem usa', () => {
  it('initialize e tools/list não tocam no catálogo (eram duas transações cada)', async () => {
    const catalogo = new CatalogoQueConta(false);
    for (const [metodo, params] of [
      ['initialize', { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 't', version: '1' } }],
      ['tools/list', {}],
    ] as const) {
      const resposta = await mcp(catalogo, metodo, params);
      expect(resposta.status).toBe(200);
    }
    expect(catalogo.total).toBe(0);
  });

  it('get_context lê o escopo UMA vez; sem scope(), são as duas leituras de sempre, na ordem de sempre', async () => {
    const velho = new CatalogoQueConta(false);
    const resposta = await mcp(velho, 'tools/call', { name: 'get_context', arguments: {} });
    const corpo = (await json(resposta)) as { result: { structuredContent: { owner: { displayName: string }; effectiveScope: { companies: Array<{ name: string }> } } } };
    expect(corpo.result.structuredContent.owner.displayName).toBe('Wesley Lourenço');
    expect(corpo.result.structuredContent.effectiveScope.companies.map((c) => c.name)).toEqual(['Agência Ide', 'Ide Filmes']);
    expect(velho.chamadas).toEqual({ companies: 1, displayName: 1, scope: 0 });

    const novo = new CatalogoQueConta(true);
    await mcp(novo, 'tools/call', { name: 'get_context', arguments: {} });
    expect(novo.chamadas).toEqual({ companies: 0, displayName: 0, scope: 1 });
  });

  it('o corpo do get_context é idêntico ao de quando o escopo vinha lido de antemão', async () => {
    const catalogo = new CatalogoQueConta(true);
    const preguicoso = await json(await mcp(catalogo, 'tools/call', { name: 'get_context', arguments: {} }));

    const interno = new MemoryCatalog(
      [
        { id: EMPRESA_B, name: 'Ide Filmes' },
        { id: EMPRESA_A, name: 'Agência Ide' },
      ],
      new Map([[OWNER, 'Wesley Lourenço']]),
    );
    const deAntemao: McpLoaded = {
      grant,
      person,
      origin: 'mcp',
      companies: await interno.companies(),
      displayName: (await interno.displayName(OWNER)) ?? OWNER,
      work: EMPTY_WORK_CATALOG,
      delivery: EMPTY_DELIVERY_CATALOG,
      marketing: new MemoryMarketingCatalog(),
      writes: undefined as never,
      comments: undefined as never,
      board: undefined as never,
      tasks: undefined as never,
      now: AGORA,
      writesEnabled: true,
    };
    const antigo = await executeTool('get_context', {}, deAntemao);
    expect(antigo.ok).toBe(true);
    const estruturado = (preguicoso as { result: { structuredContent: unknown } }).result.structuredContent;
    expect(estruturado).toEqual((antigo as { body: unknown }).body);
  });

  it('o nome de reserva (displayNameFallback) vale quando o catálogo não sabe o nome', async () => {
    const semNome = new MemoryCatalog([{ id: EMPRESA_A, name: 'Agência Ide' }], new Map());
    const resposta = await json(await mcp(semNome, 'tools/call', { name: 'get_context', arguments: {} }, 'wesley@ide.com'));
    expect((resposta as { result: { structuredContent: { owner: { displayName: string } } } }).result.structuredContent.owner.displayName).toBe('wesley@ide.com');
  });

  it('ferramenta de escrita, prévia e get_admin_week NÃO leem o escopo; as demais leituras leem uma vez', async () => {
    const semEscopo = [...MCP_WRITE_TOOL_NAMES, ...MCP_PREVIEW_TOOL_NAMES, 'get_admin_week'];
    const comEscopo = MCP_READ_TOOL_NAMES.filter((nome) => nome !== 'get_admin_week');
    expect(comEscopo.length).toBeGreaterThan(10);

    for (const nome of [...semEscopo, ...comEscopo]) {
      let leituras = 0;
      const loaded: McpLoaded = {
        grant,
        person,
        origin: 'mcp',
        carregarEscopo: async () => {
          leituras += 1;
          return { companies: [], displayName: 'x' };
        },
        work: EMPTY_WORK_CATALOG,
        delivery: EMPTY_DELIVERY_CATALOG,
        marketing: new MemoryMarketingCatalog(),
        writes: undefined as never,
        comments: undefined as never,
        board: undefined as never,
        tasks: undefined as never,
        now: AGORA,
        writesEnabled: false,
      };
      // Argumentos vazios: a ferramenta recusa (entrada inválida ou escrita desligada),
      // e o que se confere aqui é só se o escopo foi pedido antes disso.
      await executeTool(nome, {}, loaded);
      expect(leituras, nome).toBe(semEscopo.includes(nome) ? 0 : 1);
    }
  });

  it('duas ferramentas no mesmo lote leem o escopo uma vez só', async () => {
    const catalogo = new CatalogoQueConta(true);
    const pedido = new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_context', arguments: {} } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_context', arguments: {} } },
      ]),
    });
    const resposta = await handleMcpRequest({
      request: pedido,
      grant,
      person,
      origin: 'mcp',
      catalog: catalogo,
      work: EMPTY_WORK_CATALOG,
      delivery: EMPTY_DELIVERY_CATALOG,
      marketing: new MemoryMarketingCatalog(),
      now: AGORA,
    });
    const corpo = (await resposta.json()) as unknown;
    // As duas respostas voltaram (lote aceito) e o catálogo foi lido uma vez.
    expect(Array.isArray(corpo) ? corpo : []).toHaveLength(2);
    expect(catalogo.chamadas.scope).toBe(1);
  });
});

describe('API HTTP — o catálogo só é lido por quem usa', () => {
  it('OpenAPI, rota desconhecida, corpo torto e escritas não tocam no catálogo', async () => {
    const catalogo = new CatalogoQueConta(true);
    const rotas: Array<[string, RequestInit | undefined]> = [
      ['/api/integrations/v1/openapi.json', undefined],
      ['/api/integrations/v1/nao_existe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
      ['/api/integrations/v1/get_task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2]' }],
      [
        '/api/integrations/v1/add_comment',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'x', body: 'oi', idempotencyKey: 'k' }) },
      ],
      ['/api/integrations/v1/get_admin_week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
    ];
    for (const [caminho, init] of rotas) await http(catalogo, caminho, init);
    expect(catalogo.total).toBe(0);
  });

  it('get_context e as leituras leem o escopo uma vez, e a resposta é a de sempre', async () => {
    const catalogo = new CatalogoQueConta(true);
    const contexto = await http(catalogo, '/api/integrations/v1/get_context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(contexto.status).toBe(200);
    const corpo = (await json(contexto)) as { owner: { displayName: string }; effectiveScope: { companies: Array<{ name: string }> } };
    expect(corpo.owner.displayName).toBe('Wesley Lourenço');
    expect(corpo.effectiveScope.companies.map((c) => c.name)).toEqual(['Agência Ide', 'Ide Filmes']);
    expect(catalogo.chamadas.scope).toBe(1);

    const busca = await http(catalogo, '/api/integrations/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: 'peça' }),
    });
    expect(busca.status).toBe(200);
    expect(catalogo.chamadas.scope).toBe(2); // uma por chamada
    const envelope = (await json(busca)) as { effectiveScope: { companies: Array<{ name: string }> } };
    expect(envelope.effectiveScope.companies.map((c) => c.name)).toEqual(['Agência Ide', 'Ide Filmes']);
  });
});

describe('lerEscopoDoCatalogo', () => {
  it('sem scope() usa displayName e depois companies, nessa ordem', async () => {
    const ordem: string[] = [];
    const catalogo: IntegrationCatalog = {
      async displayName() {
        ordem.push('nome');
        return 'N';
      },
      async companies() {
        ordem.push('empresas');
        return [];
      },
    };
    expect(await lerEscopoDoCatalogo(catalogo, OWNER)).toEqual({ displayName: 'N', companies: [] });
    expect(ordem).toEqual(['nome', 'empresas']);
  });
});

/* ──────────────────────── o catálogo SQL, contra o PGlite ──────────────────────── */

let db: PGlite;
let adaptador: AdaptadorPglite;
const holder: { sql: unknown } = { sql: null };

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (s: unknown) => Promise<unknown>) => work(holder.sql),
}));

const { SqlIntegrationCatalog } = await import('@/integrations/sql-catalog');

describe('SqlIntegrationCatalog.scope — as mesmas linhas, numa transação só', () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema ideworks;
      create table ideworks.client_categories (
        id uuid primary key, name text, sort_order int not null default 0);
      insert into ideworks.client_categories (id, name, sort_order) values
        ('${EMPRESA_B}', 'Ide Filmes', 2),
        ('${EMPRESA_A}', 'Agência Ide', 1),
        ('55555555-5555-4555-8555-555555555555', '   ', 3),
        ('66666666-6666-4666-8666-666666666666', 'Escondida', 4);
      create function ideworks.owner_currently_reaches_company(c uuid) returns boolean
        language sql stable as $$ select c <> '66666666-6666-4666-8666-666666666666'::uuid $$;
      create function ideworks.display_name(u uuid) returns text
        language sql stable as $$
          select case u
                   when '${OWNER}'::uuid then '  Wesley Lourenço '
                   when '77777777-7777-4777-8777-777777777777'::uuid then '   '
                 end $$;
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    adaptador = criarAdaptadorPglite(db, { textoDireto: true });
    holder.sql = adaptador.sql;
  });

  const ator = { kind: 'user' as const, userId: OWNER, isSuperadmin: true, isSuper: true };
  const catalogo = () => new SqlIntegrationCatalog({} as never, ator);

  for (const [descricao, dono] of [
    ['dono com nome', OWNER],
    ['dono sem nome (função devolve nulo)', '88888888-8888-4888-8888-888888888888'],
    ['dono com nome em branco', '77777777-7777-4777-8777-777777777777'],
    ['id que não é UUID (não vira consulta)', 'nao-e-uuid'],
  ] as const) {
    it(`${descricao}: scope() devolve o que companies() e displayName() devolvem`, async () => {
      const c = catalogo();
      const separado = { companies: await c.companies(), displayName: await c.displayName(dono) };
      const transacoesSeparadas = adaptador.transacoes();
      adaptador.zerar();

      const junto = await c.scope(dono);
      expect(junto).toEqual(separado);
      expect(transacoesSeparadas).toBe(dono === 'nao-e-uuid' ? 1 : 2);
      expect(adaptador.transacoes()).toBe(1);
    });
  }

  it('a ordem e os nomes são os do catálogo antigo: sort_order, nome em branco vira o id, a escondida some', async () => {
    const { companies, displayName } = await catalogo().scope(OWNER);
    expect(displayName).toBe('  Wesley Lourenço ');
    expect(companies).toEqual([
      { id: EMPRESA_A, name: 'Agência Ide' },
      { id: EMPRESA_B, name: 'Ide Filmes' },
      { id: '55555555-5555-4555-8555-555555555555', name: '55555555-5555-4555-8555-555555555555' },
    ]);
  });

  it('o id do dono vai no texto da consulta, e não como parâmetro', async () => {
    await catalogo().scope(OWNER);
    const consulta = adaptador.consultas.find((c) => c.includes('display_name'));
    expect(consulta).toContain(`'${OWNER}'`);
    expect(consulta).not.toMatch(/\$\d/);
  });
});
