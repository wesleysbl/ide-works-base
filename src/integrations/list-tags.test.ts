/**
 * `list_tags` — conferência de 08/10/2026, lacuna G7.
 *
 * `create_task`/`update_task` aceitam `tagIds`, mas o agente não tinha de onde
 * tirar um id. A etiqueta mora no ESPAÇO; esta leitura lista as do espaço (ou do
 * espaço de uma lista) sob `boards:read` e o recorte da concessão. Os testes
 * provam o recorte (outra empresa, outro cliente da mesma empresa, empresa
 * omitida), a recusa sem a capacidade, o cursor andando até o fim e as três
 * superfícies (função, HTTP, MCP) iguais. O SQL está em `task-ficha-banco.test.ts`.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  LIST_TAGS_PATH,
  integrationOpenApi,
  jsonSchemaFromZod,
  listTagsInputSchema,
  listTagsOpenApiExample,
  listTagsResponseSchema,
  listTagsTargetOf,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { RESPONSE_BUDGET_BYTES, measureJsonBytes } from '@/integrations/page';
import { MemoryWorkCatalog, listTagsWork, type MemoryBoard, type MemoryTag } from '@/integrations/reads';
import { EMPTY_DELIVERY_CATALOG } from '@/integrations/reports';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_ALMA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_B = 'cliente-sabor-doce';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const ORIGIN = 'https://ideworks.test';
const AGORA = new Date('2026-10-08T12:00:00.000Z');

const SPACE_A = '11111111-aaaa-4aaa-8aaa-111111111111';
const SPACE_B = '22222222-bbbb-4bbb-8bbb-222222222222';
const SPACE_ALMA = '33333333-cccc-4ccc-8ccc-333333333333';
const SPACE_VAZIO = '44444444-dddd-4ddd-8ddd-444444444444';
const LIST_A = '55555555-aaaa-4aaa-8aaa-555555555555';
const LIST_A2 = '66666666-aaaa-4aaa-8aaa-666666666666';
const LIST_B = '77777777-bbbb-4bbb-8bbb-777777777777';
const LIST_ALMA = '88888888-cccc-4ccc-8ccc-888888888888';

const SUPER: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [COMPANY_A, COMPANY_B, COMPANY_ALMA],
  clientIds: [CLIENT_A, CLIENT_B],
  hasAllClientsAccess: true,
};
const SEM_ALMA: PersonAccess = { ...SUPER, omittedCompanyIds: [COMPANY_ALMA] };

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: 'grant-etiquetas',
  ownerId: OWNER_ID,
  oauthClientId: 'claude',
  name: 'Claude',
  capabilities: ['boards:read'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
  ...over,
});

const board = (
  id: string,
  name: string,
  companyId: string,
  spaceId: string,
  clientId: string | null,
  canSee = true,
): MemoryBoard => ({
  id,
  name,
  companyId,
  companyName: companyId === COMPANY_A ? 'Agência Ide' : companyId === COMPANY_B ? 'Ide Filmes' : 'Alma Nove',
  spaceId,
  spaceName: `Espaço ${spaceId.slice(0, 2)}`,
  folderId: null,
  folderName: null,
  clientId,
  clientName: clientId,
  canSeeSpace: canSee,
  statuses: [{ id: 'aberto', name: 'Aberto', sortOrder: 1, type: 'open' }],
});

const TAGS: MemoryTag[] = [
  { id: 't-urgente', spaceId: SPACE_A, name: 'Urgente', bgColor: '#ef4444', fgColor: '#ffffff' },
  { id: 't-reels', spaceId: SPACE_A, name: 'Reels', bgColor: '#7c3aed', fgColor: '#ffffff' },
  { id: 't-arte', spaceId: SPACE_A, name: 'arte final' },
  { id: 't-filmes', spaceId: SPACE_B, name: 'Só da Filmes' },
  { id: 't-alma', spaceId: SPACE_ALMA, name: 'Segredo da Alma' },
];

const WORK = new MemoryWorkCatalog({
  tags: TAGS,
  boards: [
    board(LIST_A, 'Redes sociais', COMPANY_A, SPACE_A, CLIENT_A),
    board(LIST_A2, 'Lista do outro cliente', COMPANY_A, SPACE_A, CLIENT_B),
    board(LIST_B, 'Filmes', COMPANY_B, SPACE_B, null),
    board(LIST_ALMA, 'Lista da Alma', COMPANY_ALMA, SPACE_ALMA, null),
    board('lista-fechada', 'Lista fechada', COMPANY_A, SPACE_VAZIO, null, false),
  ],
});

const ctx = (g: IntegrationGrant = grant(), person: PersonAccess = SUPER, work: MemoryWorkCatalog = WORK) => ({
  grant: g,
  person,
  origin: 'http' as const,
  companies: [{ id: COMPANY_A, name: 'Agência Ide' }],
  displayName: 'Wesley',
  work,
  now: AGORA,
});

async function ok(input: Parameters<typeof listTagsWork>[1], c = ctx()) {
  const r = await listTagsWork(c, input);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.body;
}

describe('list_tags — a leitura', () => {
  it('por spaceId: as etiquetas do espaço, por nome (sem diferença de caixa), com os ids de tagIds', async () => {
    const body = await ok({ spaceId: SPACE_A });
    expect(body.operation).toBe('list_tags');
    expect(body.space).toEqual({ id: SPACE_A, name: 'Espaço 11', company: { id: COMPANY_A, name: 'Agência Ide' } });
    expect(body.list).toBeNull();
    expect(body.total).toBe(3);
    expect(body.tags.map((t) => [t.id, t.name])).toEqual([
      ['t-arte', 'arte final'],
      ['t-reels', 'Reels'],
      ['t-urgente', 'Urgente'],
    ]);
    expect(body.tags[1]).toEqual({ id: 't-reels', name: 'Reels', bgColor: '#7c3aed', fgColor: '#ffffff' });
    expect(body.tags[0]).toEqual({ id: 't-arte', name: 'arte final', bgColor: null, fgColor: null });
    expect(body.self).toBe(`${LIST_TAGS_PATH}?spaceId=${SPACE_A}`);
    expect(body.hasMore).toBe(false);
  });

  it('por listId: o espaço da lista, com a lista dizendo de onde se chegou', async () => {
    const body = await ok({ listId: LIST_A });
    expect(body.space.id).toBe(SPACE_A);
    expect(body.list).toEqual({ id: LIST_A, name: 'Redes sociais' });
    expect(body.tags.map((t) => t.id)).toEqual(['t-arte', 't-reels', 't-urgente']);
    expect(body.self).toBe(`${LIST_TAGS_PATH}?listId=${LIST_A}`);
  });

  it('espaço sem etiqueta é lista vazia, não erro', async () => {
    const outra = new MemoryWorkCatalog({ boards: [board(LIST_A, 'Redes', COMPANY_A, SPACE_A, null)], tags: [] });
    const body = await ok({ spaceId: SPACE_A }, ctx(grant(), SUPER, outra));
    expect(body.tags).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('exatamente um dos dois: nenhum ou os dois é invalid_input', async () => {
    for (const ruim of [{}, { spaceId: SPACE_A, listId: LIST_A }]) {
      const r = await listTagsWork(ctx(), ruim);
      expect(r.ok === false && r.code).toBe('invalid_input');
    }
    expect(listTagsTargetOf({ spaceId: SPACE_A })).toEqual({ kind: 'space', id: SPACE_A });
    expect(listTagsTargetOf({ listId: LIST_A })).toEqual({ kind: 'list', id: LIST_A });
    expect(listTagsTargetOf({})).toBeNull();
  });
});

describe('list_tags — cliente cancelado (F38)', () => {
  const NAO_ACHADO = (m: string) => ({ ok: false, code: 'not_found', message: m });
  const SPACE_ZECA = '99999999-eeee-4eee-8eee-999999999999';
  const LIST_ZECA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const work = new MemoryWorkCatalog({
    tags: [{ id: 't-zeca', spaceId: SPACE_ZECA, name: 'Etiqueta do espaço do Zeca' }],
    boards: [board(LIST_ZECA, 'Lista do Zeca', COMPANY_A, SPACE_ZECA, 'cliente-zeca')],
    clients: [
      { id: 'cliente-zeca', name: 'Zeca', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: [LIST_ZECA], isActive: false, cancelledOn: '2026-10-04' },
    ],
  });

  it('a lista de cliente cancelado é not_found, como list_boards a esconde; o espaço só com ela também', async () => {
    expect(await listTagsWork(ctx(grant(), SUPER, work), { listId: LIST_ZECA })).toEqual(
      NAO_ACHADO('Lista não encontrada neste recorte.'),
    );
    expect(await listTagsWork(ctx(grant(), SUPER, work), { spaceId: SPACE_ZECA })).toEqual(
      NAO_ACHADO('Espaço não encontrado neste recorte.'),
    );
  });
});

describe('list_tags — o recorte da concessão', () => {
  const NAO_ACHADO = (m: string) => ({ ok: false, code: 'not_found', message: m });

  it('outra empresa: concessão só da A não vê o espaço nem a lista da B', async () => {
    const soA = ctx(grant({ allowedCompanyIds: [COMPANY_A] }));
    expect(await listTagsWork(soA, { spaceId: SPACE_B })).toEqual(NAO_ACHADO('Espaço não encontrado neste recorte.'));
    expect(await listTagsWork(soA, { listId: LIST_B })).toEqual(NAO_ACHADO('Lista não encontrada neste recorte.'));
    expect((await ok({ spaceId: SPACE_A }, soA)).tags).toHaveLength(3);
  });

  it('outro cliente da MESMA empresa: a lista dele é recusada; o espaço continua (há lista do cliente concedido)', async () => {
    const soClienteA = ctx(grant({ allowedClientIds: [CLIENT_A] }));
    expect(await listTagsWork(soClienteA, { listId: LIST_A2 })).toEqual(NAO_ACHADO('Lista não encontrada neste recorte.'));
    expect((await ok({ listId: LIST_A }, soClienteA)).list?.id).toBe(LIST_A);
    expect((await ok({ spaceId: SPACE_A }, soClienteA)).space.id).toBe(SPACE_A);
    // Espaço em que NENHUMA lista passa no recorte de cliente não é alcançado.
    const soFora = ctx(grant({ allowedClientIds: ['cliente-que-ninguem-tem'] }));
    expect(await listTagsWork(soFora, { spaceId: SPACE_A })).toEqual(NAO_ACHADO('Espaço não encontrado neste recorte.'));
  });

  it('empresa omitida (Alma9): nenhum rastro, nem pelo espaço, nem pela lista', async () => {
    const semAlma = ctx(grant(), SEM_ALMA);
    expect(await listTagsWork(semAlma, { spaceId: SPACE_ALMA })).toEqual(NAO_ACHADO('Espaço não encontrado neste recorte.'));
    expect(await listTagsWork(semAlma, { listId: LIST_ALMA })).toEqual(NAO_ACHADO('Lista não encontrada neste recorte.'));
    // Sem omitir, a mesma pessoa as vê.
    expect((await ok({ spaceId: SPACE_ALMA })).tags.map((t) => t.name)).toEqual(['Segredo da Alma']);
  });

  it('espaço que a pessoa não pode ver (canSeeSpace falso), inexistente: a mesma recusa', async () => {
    const r1 = await listTagsWork(ctx(), { spaceId: SPACE_VAZIO });
    const r2 = await listTagsWork(ctx(), { spaceId: '99999999-9999-4999-8999-999999999999' });
    expect(r1).toEqual(r2);
    expect(r1.ok).toBe(false);
  });

  it('sem boards:read: permission_denied, antes de olhar o pedido', async () => {
    const negado = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };
    const sem = ctx(grant({ capabilities: ['tasks:read'] }));
    expect(await listTagsWork(sem, { spaceId: SPACE_A })).toEqual(negado);
    expect(await listTagsWork(sem, {})).toEqual(negado);
  });
});

describe('list_tags — paginação e orçamento', () => {
  const MUITAS: MemoryTag[] = Array.from({ length: 450 }, (_, n) => ({
    id: `t-${String(n).padStart(3, '0')}`,
    spaceId: SPACE_A,
    name: `Etiqueta de nome comprido para pesar no corpo ${String(n).padStart(3, '0')}`,
    bgColor: '#123456',
    fgColor: '#ffffff',
  }));
  const work = new MemoryWorkCatalog({ boards: [board(LIST_A, 'Redes', COMPANY_A, SPACE_A, null)], tags: MUITAS });

  it('limit e cursor: as páginas cobrem as etiquetas uma vez só, em ordem de nome, e cada uma cabe em 64 KiB', async () => {
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const pagina = await ok({ spaceId: SPACE_A, limit: 100, cursor }, ctx(grant(), SUPER, work));
      expect(measureJsonBytes(pagina)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      expect(pagina.total).toBe(450);
      vistos.push(...pagina.tags.map((t) => t.id));
      cursor = pagina.nextCursor ?? undefined;
      expect(pagina.hasMore).toBe(cursor !== undefined);
      paginas += 1;
    } while (cursor !== undefined && paginas < 30);
    expect(vistos).toEqual(MUITAS.map((t) => t.id));
    expect(new Set(vistos).size).toBe(450);
  });

  it('limite e cursor ruins são recusados', async () => {
    const c = ctx(grant(), SUPER, work);
    expect((await listTagsWork(c, { spaceId: SPACE_A, limit: 101 })).ok).toBe(false);
    expect((await listTagsWork(c, { spaceId: SPACE_A, limit: 0 })).ok).toBe(false);
    const cursor = await listTagsWork(c, { spaceId: SPACE_A, cursor: 'lixo!' });
    expect(cursor.ok === false && cursor.code).toBe('invalid_cursor');
  });
});

describe('list_tags — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog([{ id: COMPANY_A, name: 'Agência Ide' }], new Map([[OWNER_ID, 'Wesley']]));

  it('OpenAPI publica GET e POST, schemas iguais ao Zod e exemplo válido; entrada estrita', () => {
    const doc = integrationOpenApi() as {
      info: { description: string };
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths['/list_tags'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(doc.components.schemas.ListTagsInput).toEqual(jsonSchemaFromZod(listTagsInputSchema));
    expect(doc.components.schemas.ListTagsResponse).toEqual(jsonSchemaFromZod(listTagsResponseSchema));
    expect(doc.info.description).toContain('list_tags');
    expect(listTagsResponseSchema.parse(listTagsOpenApiExample()).tags.length).toBeGreaterThan(0);
    expect(listTagsInputSchema.safeParse({ spaceId: SPACE_A }).success).toBe(true);
    expect(listTagsInputSchema.safeParse({ spaceId: 'nao-e-uuid' }).success).toBe(false);
    expect(listTagsInputSchema.safeParse({ spaceId: SPACE_A, extra: 1 }).success).toBe(false);
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

  async function callTool(args: unknown, g: IntegrationGrant = grant()) {
    const response = await handleMcpRequest({
      request: new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tags', arguments: args } }),
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

  it('paridade: HTTP GET, POST, MCP e a função devolvem o mesmo corpo', async () => {
    const direto = await ok({ listId: LIST_A });
    const get = await http(`${LIST_TAGS_PATH}?listId=${LIST_A}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);
    const post = await http(LIST_TAGS_PATH, grant(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listId: LIST_A }),
    });
    expect(await post.json()).toEqual(direto);
    const mcp = await callTool({ listId: LIST_A });
    expect(mcp.structuredContent).toEqual(direto);
    expect(mcp.content[0]?.text).toContain('3 no total');
    expect(mcp.content[0]?.text).toContain('Reels');
  });

  it('HTTP: 403 sem a capacidade, 400 sem alvo, 404 fora do recorte; MCP: erro estável', async () => {
    expect((await http(`${LIST_TAGS_PATH}?spaceId=${SPACE_A}`, grant({ capabilities: ['tasks:read'] }))).status).toBe(403);
    const semAlvo = await http(LIST_TAGS_PATH);
    expect(semAlvo.status).toBe(400);
    expect(((await semAlvo.json()) as { error: string }).error).toBe('invalid_input');
    expect((await http(`${LIST_TAGS_PATH}?spaceId=${SPACE_A}&listId=${LIST_A}`)).status).toBe(400);
    expect((await http(`${LIST_TAGS_PATH}?spaceId=${SPACE_B}`, grant({ allowedCompanyIds: [COMPANY_A] }))).status).toBe(404);
    expect((await http(`${LIST_TAGS_PATH}?spaceId=${SPACE_A}&foo=1`)).status).toBe(400);

    const semCap = await callTool({ spaceId: SPACE_A }, grant({ capabilities: ['tasks:read'] }));
    expect(semCap.isError).toBe(true);
    expect((JSON.parse(semCap.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');
    const fora = await callTool({ spaceId: SPACE_B }, grant({ allowedCompanyIds: [COMPANY_A] }));
    expect((JSON.parse(fora.content[0]?.text ?? '{}') as { error: string }).error).toBe('not_found');
    expect((await callTool({})).isError).toBe(true);
  });
});
