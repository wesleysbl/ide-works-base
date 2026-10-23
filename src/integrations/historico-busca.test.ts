/**
 * Busca por palavra-chave em `get_client_history` — F37, Fase 5.
 *
 * Mesma regra da barra de busca do site (`src/clients/historico-busca.ts`):
 * sem acento, sem diferença de maiúscula, várias palavras valem TODAS, em
 * qualquer campo. `%`, `_` e `\` são texto. Aqui: a leitura (massa em memória),
 * o SQL (tx de mentira que grava o texto) e a paridade MCP × HTTP.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { palavrasDaBusca } from '@/clients/historico-busca';
import {
  GET_CLIENT_HISTORY_PATH,
  getClientHistoryInputSchema,
  getClientHistoryOpenApiExample,
  getClientHistoryResponseSchema,
  integrationOpenApi,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { MemoryAgentWriteStore } from '@/integrations/executions';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import {
  MemoryWorkCatalog,
  getClientHistoryWork,
  type MemoryHistoryEntry,
  type ReadCtx,
  type WorkScope,
} from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';
import { MemoryClientRecordBoard, MemoryCommentBoard } from '@/integrations/writes';

const consultas: string[] = [];
const respostas: unknown[][] = [];

type Frag = { readonly strings: readonly string[]; readonly values: readonly unknown[]; then: (ok: (rows: unknown[]) => void) => void };

function ehFrag(v: unknown): v is Frag {
  return typeof v === 'object' && v !== null && 'strings' in v && 'values' in v;
}

function renderiza(frag: Frag): string {
  let out = '';
  frag.strings.forEach((parte, i) => {
    out += parte;
    if (i < frag.values.length) {
      const v = frag.values[i];
      out += ehFrag(v) ? renderiza(v) : `«${JSON.stringify(v)}»`;
    }
  });
  return out;
}

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (sql: unknown) => Promise<unknown>) => {
    const tag = (strings: readonly string[], ...values: unknown[]): Frag => {
      const frag: Frag = {
        strings,
        values,
        then(ok) {
          consultas.push(renderiza(frag).replace(/\s+/g, ' ').trim());
          ok(respostas.shift() ?? []);
        },
      };
      return frag;
    };
    return work(tag);
  },
}));

vi.mock('@/server/db', async (original) => {
  const real = await original<typeof import('@/server/db')>();
  return {
    ...real,
    withActor: async (sql: unknown, _actor: unknown, work: (tx: unknown) => Promise<unknown>) => work(sql),
  };
});

const { SqlWorkCatalog } = await import('@/integrations/sql-work');

const ORIGIN = 'https://ideworks.test';
const agora = new Date('2026-10-05T15:00:00.000Z');
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const HELENA = '33333333-3333-4333-8333-333333333333';
const CLIENTE_A = 'c1111111-1111-4111-8111-111111111111';
const CLIENTE_B = 'c2222222-2222-4222-8222-222222222222';

const person: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a', 'empresa-b'],
  clientIds: [CLIENTE_A, CLIENTE_B],
  hasAllClientsAccess: false,
};

const grant: IntegrationGrant = {
  id: '11111111-1111-4111-8111-111111111111',
  ownerId: OWNER_ID,
  oauthClientId: 'ideworks-claude',
  name: 'Claude da agência',
  capabilities: [...READ_CAPABILITIES],
  allowedCompanyIds: ['empresa-a'],
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const registro = (
  extra: Partial<MemoryHistoryEntry> & { id: string; happenedOn: string; createdAt: string },
): MemoryHistoryEntry => ({
  clientId: CLIENTE_A,
  title: 'Registro',
  subtitle: null,
  body: 'relato',
  ledBy: { id: HELENA, name: 'Helena' },
  ledByNote: null,
  author: { id: OWNER_ID, name: 'Wesley Lourenço' },
  createdById: OWNER_ID,
  viaName: null,
  documentCount: 0,
  updatedAt: extra.createdAt,
  ...extra,
});

const WORK = new MemoryWorkCatalog({
  clients: [
    { id: CLIENTE_A, name: 'Clinimax', companyId: 'empresa-a', companyName: 'Agência Ide', listIds: [] },
    { id: CLIENTE_B, name: 'Rebrota', companyId: 'empresa-b', companyName: 'Ide Filmes', listIds: [] },
  ],
  historyEntries: [
    registro({ id: 'h-reuniao', happenedOn: '2026-09-18', createdAt: '2026-09-18T12:00:00.000Z', title: 'Reunião de alinhamento', body: 'Definimos o banner de outubro.' }),
    registro({ id: 'h-desconto', happenedOn: '2026-09-10', createdAt: '2026-09-10T12:00:00.000Z', title: 'Promoção', body: 'Oferta de 50% de desconto em kit_pro.' }),
    registro({ id: 'h-barra', happenedOn: '2026-08-01', createdAt: '2026-08-01T12:00:00.000Z', title: 'Caminho', body: 'Pasta C:\\fotos', ledByNote: 'Mirela', viaName: 'Claude', documentFileNames: ['Contrato Final.pdf'] }),
    registro({ id: 'h-b', clientId: CLIENTE_B, happenedOn: '2026-09-20', createdAt: '2026-09-20T10:00:00.000Z', title: 'Reunião secreta da Rebrota' }),
  ],
});

function readCtx(g: IntegrationGrant = grant): ReadCtx {
  return {
    grant: g,
    person,
    origin: 'mcp',
    companies: [
      { id: 'empresa-a', name: 'Agência Ide' },
      { id: 'empresa-b', name: 'Ide Filmes' },
    ],
    displayName: 'Wesley Lourenço',
    work: WORK,
    now: agora,
  };
}

async function ids(query: string | undefined, ctx = readCtx(), clientId = CLIENTE_A) {
  const result = await getClientHistoryWork(ctx, { clientId, ...(query === undefined ? {} : { query }) });
  expect(result.ok).toBe(true);
  return result.ok ? result.body.items.map((item) => item.id) : [];
}

describe('get_client_history com query: a leitura', () => {
  it('sem query devolve tudo, como antes', async () => {
    expect(await ids(undefined)).toEqual(['h-reuniao', 'h-desconto', 'h-barra']);
  });

  it('termo presente: só as entradas que o contêm, na ordem de sempre', async () => {
    expect(await ids('banner')).toEqual(['h-reuniao']);
    expect(await ids('o')).toEqual(['h-reuniao', 'h-desconto', 'h-barra']);
  });

  it('termo ausente: lista vazia, sem erro e sem continuação', async () => {
    const result = await getClientHistoryWork(readCtx(), { clientId: CLIENTE_A, query: 'inexistente' });
    expect(result.ok && result.body.items).toEqual([]);
    expect(result.ok && result.body.hasMore).toBe(false);
    expect(result.ok && result.body.nextCursor).toBeNull();
  });

  it('sem acento e sem diferença de maiúscula, como o site; várias palavras valem todas', async () => {
    expect(await ids('REUNIAO')).toEqual(['h-reuniao']);
    expect(await ids('reunião alinhamento')).toEqual(['h-reuniao']);
    expect(await ids('alinhamento banner')).toEqual(['h-reuniao']);
    expect(await ids('banner desconto')).toEqual([]);
    expect(await ids('promocao')).toEqual(['h-desconto']);
  });

  it('acha pela data dd/mm/aaaa, por quem conduziu, pela observação, pela origem e pelo nome do documento', async () => {
    expect(await ids('18/09/2026')).toEqual(['h-reuniao']);
    expect(await ids('helena')).toEqual(['h-reuniao', 'h-desconto', 'h-barra']);
    expect(await ids('mirela')).toEqual(['h-barra']);
    expect(await ids('claude')).toEqual(['h-barra']);
    expect(await ids('contrato final')).toEqual(['h-barra']);
  });

  it('%, _ e \\ são texto: uma busca por % NÃO casa tudo', async () => {
    expect(await ids('%')).toEqual(['h-desconto']);
    expect(await ids('_')).toEqual(['h-desconto']);
    expect(await ids('kit_pro')).toEqual(['h-desconto']);
    expect(await ids('kit%pro')).toEqual([]);
    expect(await ids('\\')).toEqual(['h-barra']);
    expect(await ids('50%')).toEqual(['h-desconto']);
  });

  it('o nome de quem conduziu só entra na busca com people:read', async () => {
    const semPessoas: IntegrationGrant = { ...grant, capabilities: grant.capabilities.filter((cap) => cap !== 'people:read') };
    expect(await ids('helena', readCtx(semPessoas))).toEqual([]);
    expect(await ids('banner', readCtx(semPessoas))).toEqual(['h-reuniao']);
  });

  it('o recorte de cliente vem antes da busca', async () => {
    const fora = await getClientHistoryWork(readCtx(), { clientId: CLIENTE_B, query: 'secreta' });
    expect(fora).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(await ids('secreta')).toEqual([]);
  });

  it('a página e o cursor valem dentro do resultado filtrado', async () => {
    const um = await getClientHistoryWork(readCtx(), { clientId: CLIENTE_A, query: 'helena', limit: 2 });
    expect(um.ok && um.body.items.map((i) => i.id)).toEqual(['h-reuniao', 'h-desconto']);
    expect(um.ok && um.body.hasMore).toBe(true);
    const dois = await getClientHistoryWork(readCtx(), {
      clientId: CLIENTE_A,
      query: 'helena',
      limit: 2,
      cursor: um.ok ? um.body.nextCursor! : undefined,
    });
    expect(dois.ok && dois.body.items.map((i) => i.id)).toEqual(['h-barra']);
    expect(dois.ok && dois.body.hasMore).toBe(false);
  });

  it('query vazia ou só espaços é invalid_input, também direto no Work', async () => {
    for (const query of ['', '   ']) {
      expect(await getClientHistoryWork(readCtx(), { clientId: CLIENTE_A, query })).toMatchObject({
        ok: false,
        code: 'invalid_input',
      });
    }
  });
});

describe('contrato da query', () => {
  const base = { clientId: CLIENTE_A };

  it('aceita 1 a 100 caracteres, apara as pontas, recusa vazio, espaços e acima de 100', () => {
    expect(getClientHistoryInputSchema.parse({ ...base, query: '  banner  ' }).query).toBe('banner');
    expect(getClientHistoryInputSchema.parse(base).query).toBeUndefined();
    expect(getClientHistoryInputSchema.safeParse({ ...base, query: '' }).success).toBe(false);
    expect(getClientHistoryInputSchema.safeParse({ ...base, query: '   ' }).success).toBe(false);
    expect(getClientHistoryInputSchema.safeParse({ ...base, query: 'a'.repeat(100) }).success).toBe(true);
    expect(getClientHistoryInputSchema.safeParse({ ...base, query: 'a'.repeat(101) }).success).toBe(false);
  });

  it('o OpenAPI publica query (mín. 1, máx. 100) e o exemplo continua válido', () => {
    const doc = integrationOpenApi() as unknown as {
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
      paths: Record<string, { get: { parameters: Array<{ name: string; schema: unknown }> } }>;
    };
    expect(doc.components.schemas.GetClientHistoryInput.properties.query).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 100,
    });
    const parametro = doc.paths['/get_client_history'].get.parameters.find((p) => p.name === 'query');
    expect(parametro?.schema).toMatchObject({ minLength: 1, maxLength: 100 });
    expect(getClientHistoryResponseSchema.parse(getClientHistoryOpenApiExample()).operation).toBe('get_client_history');
  });
});

describe('paridade MCP × HTTP', () => {
  const shared = {
    grant,
    person,
    catalog: new MemoryCatalog(
      [
        { id: 'empresa-a', name: 'Agência Ide' },
        { id: 'empresa-b', name: 'Ide Filmes' },
      ],
      new Map([[OWNER_ID, 'Wesley Lourenço']]),
    ),
    work: WORK,
    delivery: new MemoryDeliveryCatalog(),
    marketing: new MemoryMarketingCatalog(),
    writes: new MemoryAgentWriteStore(),
    comments: new MemoryCommentBoard(OWNER_ID),
    clientRecords: new MemoryClientRecordBoard({ ownerId: OWNER_ID, viaName: 'Claude da agência' }, { clients: [], people: [], notes: [], entries: [] }),
    displayNameFallback: 'Wesley Lourenço',
    now: agora,
  };

  async function viaMcp(args: Record<string, unknown>) {
    const response = await handleMcpRequest({
      ...shared,
      origin: 'mcp',
      request: new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_client_history', arguments: args } }),
      }),
    });
    return ((await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
    }).result;
  }

  async function viaHttp(query: string) {
    return dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${GET_CLIENT_HISTORY_PATH}?clientId=${CLIENTE_A}&query=${encodeURIComponent(query)}`),
    });
  }

  it('o mesmo filtro nas duas portas, com % literal', async () => {
    for (const [query, esperado] of [
      ['banner', ['h-reuniao']],
      ['%', ['h-desconto']],
      ['reuniao', ['h-reuniao']],
    ] as const) {
      const mcp = await viaMcp({ clientId: CLIENTE_A, query });
      const http = await viaHttp(query);
      expect(http.status).toBe(200);
      const doHttp = getClientHistoryResponseSchema.parse(await http.json());
      const doMcp = getClientHistoryResponseSchema.parse(mcp.structuredContent);
      expect(doMcp.items.map((i) => i.id)).toEqual(esperado);
      expect(doHttp.items.map((i) => i.id)).toEqual(esperado);
    }
  });

  it('vazio e só espaços: recusado nas duas portas, com invalid_input e a frase em português', async () => {
    for (const query of ['', '   ']) {
      const mcp = await viaMcp({ clientId: CLIENTE_A, query });
      expect(mcp.isError).toBe(true);
      // A ferramenta valida a própria entrada (o SDK não despeja mais o erro cru do Zod, em inglês):
      // código estável e a mesma frase da HTTP, com o campo que falhou.
      expect(JSON.parse(String(mcp.content?.[0]?.text))).toMatchObject({
        error: 'invalid_input',
        message: expect.stringMatching(/Informe a busca \(query\)/),
      });
      const http = await viaHttp(query);
      expect(http.status).toBe(400);
      expect(await http.json()).toMatchObject({ error: 'invalid_input', message: expect.stringMatching(/Informe a busca \(query\)/) });
    }
  });

  it('sem clientId continua pedindo o clientId', async () => {
    const mcp = await viaMcp({ query: 'banner' });
    expect(JSON.stringify(mcp)).toMatch(/clientId/);
  });
});

describe('SqlWorkCatalog.getClientHistory: a busca desce ao SQL', () => {
  const ESCOPO: WorkScope = {
    companies: { kind: 'all' },
    clients: 'all',
    capabilities: new Set(['clients:read', 'people:read'] as const),
  };
  const ACTOR = { kind: 'user', userId: OWNER_ID, isSuperadmin: true, isSuper: true } as const;

  beforeEach(() => {
    consultas.length = 0;
    respostas.length = 0;
  });

  async function consultaDoHistorico(query: string | undefined, escopo: WorkScope = ESCOPO) {
    respostas.push([{ id: CLIENTE_A, name: 'Clinimax', company_id: 'e', company_name: 'E' }]);
    await new SqlWorkCatalog({} as never, ACTOR as never).getClientHistory(escopo, CLIENTE_A, query);
    return consultas.find((sql) => sql.includes('from ideworks.client_history')) ?? '';
  }

  it('sem query a consulta é a de antes: nada de position nem unnest', async () => {
    const sql = await consultaDoHistorico(undefined);
    expect(sql).toContain('from ideworks.client_history h');
    expect(sql).not.toMatch(/unnest|position\(/);
  });

  it('com query: palavras como parâmetro, sem like, depois do recorte de cliente, ordem preservada', async () => {
    const sql = await consultaDoHistorico('Reunião 50%_\\');
    expect(sql).not.toMatch(/\blike\b/i);
    expect(sql).toMatch(/position\(w\.p in translate\(lower\(concat_ws/);
    // A palavra segue ligada (entre «») e inteira, sem curinga interpretado nem concatenada no texto.
    expect(sql).toContain('«["reuniao","50%_\\\\"]»');
    expect(sql).toMatch(/h\.client_id = «"c1111111[^"]*"»::uuid and not exists/);
    expect(sql).toMatch(/order by h\.happened_on desc, h\.created_at desc, h\.id$/);
    // O texto da pessoa nunca aparece no SQL fora do parâmetro.
    expect(sql.replace(/«[^»]*»/g, '')).not.toMatch(/50%|reuniao/i);
  });

  it('sem people:read o nome de quem conduziu não entra no texto pesquisado', async () => {
    const semPessoas: WorkScope = { ...ESCOPO, capabilities: new Set(['clients:read'] as const) };
    expect(await consultaDoHistorico('x', ESCOPO)).toContain('ideworks.display_name(h.led_by), h.led_by_note');
    consultas.length = 0;
    const sql = await consultaDoHistorico('x', semPessoas);
    expect(sql).toContain('null::text, h.led_by_note');
  });

  it('a mesma regra de palavras do site: ordem, acento e caixa não importam', () => {
    expect(palavrasDaBusca('  Reunião   ALINHAMENTO ')).toEqual(['reuniao', 'alinhamento']);
  });
});
