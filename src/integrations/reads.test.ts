/**
 * Pesquisa, quadro, tarefa, cliente e conversa — F16.3b.
 *
 * OpenAPI e a resposta efetiva passam no mesmo schema Zod. A suíte injeta
 * o port de trabalho; o dado de outra empresa existe no catálogo e a query
 * recortada não o vê.
 */

import { describe, expect, it } from 'vitest';

import {
  GET_PERSON_WORK_PATH,
  GET_TASK_PATH,
  LIST_PEOPLE_PATH,
  SEARCH_PATH,
  getBoardResponseSchema,
  getPersonWorkOpenApiExample,
  getPersonWorkResponseSchema,
  getTaskOpenApiExample,
  getTaskResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
  listPeopleOpenApiExample,
  listPeopleResponseSchema,
  searchOpenApiExample,
  searchResponseSchema,
  type SearchKind,
  type WorkflowTarget,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { RESPONSE_BUDGET_BYTES, measureJsonBytes } from '@/integrations/page';
import {
  MemoryWorkCatalog,
  getBoardWork,
  getClientWork,
  getPersonWork,
  toWorkScope,
  getTaskWork,
  listCommentsWork,
  listPeopleWork,
  searchWork,
  type MemoryTask,
  type ReadCtx,
  type SearchWindow,
  type TitleWindow,
  type WorkCatalog,
  type WorkScope,
  type WorkSearchHit,
} from '@/integrations/reads';
import { SqlWorkCatalog, searchKindWindow } from '@/integrations/sql-work';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_A2 = 'cliente-rebrota';
const CLIENT_B = 'cliente-filmes';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const AGORA = new Date('2026-09-21T04:00:00.000Z');
const SECRET_LIST = 'Lista secreta Alma9';
const SECRET_SPACE = 'Espaço Alma9';

const ADMIN: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [COMPANY_A, COMPANY_B],
  clientIds: [CLIENT_A, CLIENT_A2, CLIENT_B],
  hasAllClientsAccess: true,
};

const OPEN = { id: 'status-aberto', name: 'Aberto', sortOrder: 1, type: 'open' as const };
const DONE = { id: 'status-feito', name: 'Feito', sortOrder: 2, type: 'done' as const };

const MASSA: MemoryTask[] = Array.from({ length: 120 }, (_, index) => {
  const n = String(index + 1).padStart(3, '0');
  return {
    id: `item-${n}`,
    title: `Item ${n}`,
    description: null,
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    boardId: 'lista-atendimento-jatoba',
    clientId: null,
    clientName: null,
    statusId: OPEN.id,
    dueOn: null,
    people: [],
  };
});

const CONVERSA = Array.from({ length: 80 }, (_, index) => {
  const n = String(index + 1).padStart(3, '0');
  return {
    id: `c-${n}`,
    taskId: 'tarefa-conversa',
    parentId: null as string | null,
    body: `msg-${n}-${'x'.repeat(1200)}`,
    createdAt: new Date(Date.UTC(2026, 8, 21, 4, 0, 0, index)).toISOString(),
    author: { id: 'pessoa-helena', name: 'Helena' },
  };
});

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
      statuses: [OPEN, DONE],
    },
    {
      id: 'lista-atendimento-rebrota',
      name: 'Atendimento',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      spaceId: 'space-a',
      spaceName: 'Entrega',
      folderId: 'folder-rebrota',
      folderName: 'Rebrota',
      clientId: CLIENT_A2,
      clientName: 'Rebrota',
      canSeeSpace: true,
      statuses: [OPEN],
    },
    {
      id: 'lista-secreta',
      name: SECRET_LIST,
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      spaceId: 'space-secreto',
      spaceName: SECRET_SPACE,
      folderId: null,
      folderName: null,
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      canSeeSpace: false,
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
      title: 'Peça da campanha',
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
      completedAt: '2026-09-26T12:00:00.000Z',
      people: [{ id: 'pessoa-helena', name: 'Helena' }],
    },
    {
      id: 'tarefa-sem-cliente',
      title: 'Tarefa interna',
      description: null,
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      boardId: 'lista-atendimento-jatoba',
      clientId: null,
      clientName: null,
      statusId: OPEN.id,
      dueOn: null,
      people: [],
    },
    {
      id: 'tarefa-intrusa',
      title: 'Peça da campanha',
      description: 'Outro cliente na mesma lista.',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      boardId: 'lista-atendimento-jatoba',
      clientId: CLIENT_A2,
      clientName: 'Rebrota',
      statusId: OPEN.id,
      dueOn: null,
      people: [{ id: 'pessoa-helena', name: 'Helena' }],
    },
    {
      id: 'tarefa-rebrota',
      title: 'Peça Rebrota',
      description: null,
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      boardId: 'lista-atendimento-rebrota',
      clientId: CLIENT_A2,
      clientName: 'Rebrota',
      statusId: OPEN.id,
      dueOn: null,
      people: [],
    },
    {
      id: 'tarefa-filmes',
      title: 'Peça da campanha',
      description: 'Não deve vazar.',
      companyId: COMPANY_B,
      companyName: 'Ide Filmes',
      boardId: 'lista-filmes',
      clientId: CLIENT_B,
      clientName: 'Cliente Filmes',
      statusId: OPEN.id,
      dueOn: null,
      people: [{ id: 'pessoa-helena', name: 'Helena' }],
    },
    {
      id: 'tarefa-longa',
      title: 'Descrição enorme',
      description: 'x'.repeat(80_000),
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      boardId: 'lista-atendimento-jatoba',
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      statusId: OPEN.id,
      dueOn: null,
      people: [],
    },
    {
      id: 'tarefa-conversa',
      title: 'Conversa longa',
      description: 'ok',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      boardId: 'lista-atendimento-jatoba',
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      statusId: OPEN.id,
      dueOn: null,
      priority: 'high',
      startOn: '2026-09-01',
      people: [],
    },
    ...MASSA,
  ],
  clients: [
    {
      id: CLIENT_A,
      name: 'Jatobá',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      listIds: ['lista-atendimento-jatoba', 'lista-secreta'],
    },
    {
      id: CLIENT_A2,
      name: 'Rebrota',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      listIds: ['lista-atendimento-rebrota'],
    },
    {
      id: CLIENT_B,
      name: 'Cliente Filmes',
      companyId: COMPANY_B,
      companyName: 'Ide Filmes',
      listIds: ['lista-filmes'],
    },
  ],
  comments: CONVERSA,
  people: [
    {
      id: 'pessoa-helena',
      name: 'Helena',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      detail: 'atendimento',
      email: 'NAO_VAZAR_EMAIL',
      papel: 'NAO_VAZAR_PAPEL',
      todosOsClientes: true,
      isSuperadmin: true,
    },
    {
      id: 'pessoa-idle',
      name: 'Pessoa sem demanda',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      detail: 'entrega',
      email: 'NAO_VAZAR_EMAIL',
      papel: 'NAO_VAZAR_PAPEL',
      todosOsClientes: true,
      isSuperadmin: true,
    },
    {
      id: 'pessoa-wesley-entrega',
      name: 'Wesley Lourenço',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      detail: 'entrega',
      email: 'NAO_VAZAR_EMAIL',
      papel: 'NAO_VAZAR_PAPEL',
      todosOsClientes: true,
      isSuperadmin: true,
    },
    {
      id: 'pessoa-wesley-comercial',
      name: 'Wesley Lourenço',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      detail: 'comercial',
      email: 'NAO_VAZAR_EMAIL',
      papel: 'NAO_VAZAR_PAPEL',
      todosOsClientes: true,
      isSuperadmin: true,
    },
    {
      id: 'pessoa-wesley-filmes',
      name: 'Wesley Lourenço',
      companyId: COMPANY_B,
      companyName: 'Ide Filmes',
      detail: 'produção',
      email: 'NAO_VAZAR_EMAIL',
      papel: 'NAO_VAZAR_PAPEL',
      todosOsClientes: true,
      isSuperadmin: true,
    },
  ],
});

function grant(partial: Partial<IntegrationGrant>): IntegrationGrant {
  return {
    id: 'grant-leitura',
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

const WIDE = grant({});
const TIGHT = grant({ allowedClientIds: [CLIENT_A] });
const TASKS_ONLY = grant({ capabilities: ['tasks:read'] });

const COMPANIES = [
  { id: COMPANY_A, name: 'Agência Ide' },
  { id: COMPANY_B, name: 'Ide Filmes' },
];

function ctxFor(g: IntegrationGrant): ReadCtx {
  return {
    grant: g,
    person: ADMIN,
    origin: 'http',
    companies: COMPANIES,
    displayName: 'Wesley Lourenço',
    work: WORK,
    now: AGORA,
  };
}

describe('search recusa texto que o Postgres não aceita', () => {
  it('caractere nulo no texto é invalid_input, e não erro interno do banco', async () => {
    const r = await searchWork(ctxFor(WIDE), { q: 'Wes\u0000ley' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid_input');
  });
});

describe('search encontra e desambigua nomes repetidos', () => {
  it('texto acha o registro; dois Wesley e duas listas Atendimento vêm com contexto e IDs distintos', async () => {
    const people = await searchWork(ctxFor(WIDE), { q: 'Wesley', kinds: ['person'] });
    expect(people.ok).toBe(true);
    if (!people.ok) return;
    expect(people.body.items).toHaveLength(2);
    const ids = people.body.items.map((item) => item.id).sort();
    expect(ids).toEqual(['pessoa-wesley-comercial', 'pessoa-wesley-entrega']);
    expect(people.body.items.map((item) => item.detail).sort()).toEqual(['comercial', 'entrega']);
    expect(people.body.items.every((item) => item.title === 'Wesley Lourenço')).toBe(true);
    expect(people.body.items.every((item) => item.company?.id === COMPANY_A)).toBe(true);
    expect(JSON.stringify(people.body)).not.toContain('pessoa-wesley-filmes');
    expect(JSON.stringify(people.body)).not.toContain('produção');

    const boards = await searchWork(ctxFor(WIDE), { q: 'Atendimento', kinds: ['board'] });
    expect(boards.ok).toBe(true);
    if (!boards.ok) return;
    expect(boards.body.items).toHaveLength(2);
    expect(new Set(boards.body.items.map((item) => item.id)).size).toBe(2);
    expect(boards.body.items.map((item) => item.client?.id).sort()).toEqual([CLIENT_A, CLIENT_A2]);
    expect(boards.body.items.every((item) => item.title === 'Atendimento')).toBe(true);
  });

  it('kinds sem capacidade é permission_denied, não lista vazia', async () => {
    const denied = await searchWork(ctxFor(TASKS_ONLY), { q: 'Wesley', kinds: ['person'] });
    expect(denied).toEqual({
      ok: false,
      code: 'permission_denied',
      message: 'Fora do alcance desta integração.',
    });
  });
});

describe('massa acima do teto pagina sem duplicar', () => {
  it('todas as páginas, união sem duplicar, conjunto estável', async () => {
    const key = ctxFor(WIDE);
    const primeira = await searchWork(key, { q: 'Item', kinds: ['task'] });
    expect(primeira.ok).toBe(true);
    if (!primeira.ok) return;
    expect(primeira.body.items).toHaveLength(50);
    expect(primeira.body.hasMore).toBe(true);
    expect(primeira.body.nextCursor).toBeTruthy();

    const segunda = await searchWork(key, { q: 'Item', kinds: ['task'], cursor: primeira.body.nextCursor! });
    expect(segunda.ok).toBe(true);
    if (!segunda.ok) return;
    expect(segunda.body.items).toHaveLength(50);
    expect(segunda.body.hasMore).toBe(true);

    const terceira = await searchWork(key, { q: 'Item', kinds: ['task'], cursor: segunda.body.nextCursor! });
    expect(terceira.ok).toBe(true);
    if (!terceira.ok) return;
    expect(terceira.body.items).toHaveLength(20);
    expect(terceira.body.hasMore).toBe(false);
    expect(terceira.body.nextCursor).toBeNull();

    const ids = [...primeira.body.items, ...segunda.body.items, ...terceira.body.items].map((item) => item.id);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
    expect(ids).toEqual(MASSA.map((item) => item.id));
  });
});

describe('admin com concessão parcial não vê a outra empresa nem o outro cliente', () => {
  it('o dado existe no catálogo; a query recortada não conta nem lista', async () => {
    const tight = ctxFor(TIGHT);
    const found = await searchWork(tight, { q: 'Peça da campanha', kinds: ['task'] });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.body.items.map((item) => item.id)).toEqual(['tarefa-peca']);
    expect(JSON.stringify(found.body)).not.toContain('tarefa-filmes');
    expect(JSON.stringify(found.body)).not.toContain('Ide Filmes');
    expect(JSON.stringify(found.body)).not.toContain('tarefa-intrusa');
    expect(JSON.stringify(found.body)).not.toContain('Rebrota');

    const otherCompany = await getBoardWork(tight, { id: 'lista-filmes' });
    expect(otherCompany.ok).toBe(false);
    if (otherCompany.ok) return;
    expect(otherCompany.code).toBe('permission_denied');

    const otherClient = await getTaskWork(tight, { id: 'tarefa-intrusa' });
    expect(otherClient).toMatchObject({ ok: false, code: 'permission_denied' });

    const board = await getBoardWork(tight, { id: 'lista-atendimento-jatoba' });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    const aberto = board.body.board.columns.find((column) => column.id === OPEN.id);
    expect(aberto?.total).toBe(124);
    expect(board.body.board.tasks.map((task) => task.id)).not.toContain('tarefa-intrusa');
    expect(board.body.board.tasks.map((task) => task.id)).not.toContain('tarefa-filmes');
    expect(JSON.stringify(board.body)).not.toContain('Rebrota');
  });
});

describe('descrição e conversa longa cabem no orçamento', () => {
  it('get_task de descrição enorme continua por cursor e cada página fica <= 64 KiB', async () => {
    let cursor: string | undefined;
    let text = '';
    let pages = 0;
    for (;;) {
      const page = await getTaskWork(ctxFor(WIDE), { id: 'tarefa-longa', cursor });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(measureJsonBytes(page.body)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      text += page.body.task.description ?? '';
      pages += 1;
      if (!page.body.hasMore) {
        expect(page.body.nextCursor).toBeNull();
        break;
      }
      expect(page.body.nextCursor).toBeTruthy();
      cursor = page.body.nextCursor ?? undefined;
      expect(pages).toBeLessThan(20);
    }
    expect(text).toHaveLength(80_000);
    expect(text).toBe('x'.repeat(80_000));
    expect(pages).toBeGreaterThan(1);
  });

  /**
   * Auditoria de 08/10/2026 — o `get_task` cortava os comentários e devolvia
   * um cursor que ele mesmo recusava (`invalid_cursor`): só aceitava o da
   * descrição. A conversa além da primeira página ficava inalcançável por ali.
   */
  it('get_task de conversa enorme continua os comentários pelo próprio cursor, cada página <= 64 KiB', async () => {
    let cursor: string | undefined;
    const ids: string[] = [];
    let pages = 0;
    for (;;) {
      const page = await getTaskWork(ctxFor(WIDE), { id: 'tarefa-conversa', cursor });
      expect(page).toMatchObject({ ok: true });
      if (!page.ok) return;
      expect(measureJsonBytes(page.body)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      ids.push(...(page.body.task.comments ?? []).map((item) => item.id));
      // A descrição vem inteira na primeira página; nas seguintes, nada dela.
      expect(page.body.task.description).toBe(pages === 0 ? 'ok' : '');
      pages += 1;
      if (!page.body.hasMore) {
        expect(page.body.nextCursor).toBeNull();
        break;
      }
      cursor = page.body.nextCursor ?? undefined;
      expect(pages).toBeLessThan(20);
    }
    expect(ids).toEqual(CONVERSA.map((item) => item.id));
    expect(pages).toBeGreaterThan(1);
  });

  it('o cursor do get_task levado ao list_comments é recusado, e não vira uma página vazia', async () => {
    const first = await getTaskWork(ctxFor(WIDE), { id: 'tarefa-conversa' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const viaList = await listCommentsWork(ctxFor(WIDE), { taskId: 'tarefa-conversa', cursor: first.body.nextCursor! });
    expect(viaList).toMatchObject({ ok: false, code: 'invalid_cursor', message: expect.stringMatching(/get_task/) });
  });

  it('get_task com descrição E conversa enormes: primeiro a descrição, depois os comentários, nada perdido', async () => {
    const tarefa = {
      id: 'tarefa-tudo-longo',
      title: 'Tudo longo',
      description: 'y'.repeat(80_000),
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      boardId: 'lista-atendimento-jatoba',
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      statusId: OPEN.id,
      dueOn: null,
      people: [],
    };
    const work = new MemoryWorkCatalog({
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
      ],
      tasks: [tarefa],
      clients: [],
      comments: CONVERSA.map((item) => ({ ...item, taskId: tarefa.id })),
      people: [],
    });
    let cursor: string | undefined;
    let text = '';
    const ids: string[] = [];
    let pages = 0;
    for (;;) {
      const page = await getTaskWork({ ...ctxFor(WIDE), work }, { id: tarefa.id, cursor });
      expect(page).toMatchObject({ ok: true });
      if (!page.ok) return;
      expect(measureJsonBytes(page.body)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      text += page.body.task.description ?? '';
      ids.push(...(page.body.task.comments ?? []).map((item) => item.id));
      pages += 1;
      if (!page.body.hasMore) break;
      cursor = page.body.nextCursor ?? undefined;
      expect(pages).toBeLessThan(30);
    }
    expect(text).toBe(tarefa.description);
    expect(ids).toEqual(CONVERSA.map((item) => item.id));
  });

  it('cursor de comentário que não existe mais pede a primeira página de novo', async () => {
    const first = await getTaskWork(ctxFor(WIDE), { id: 'tarefa-conversa' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const outra = await getTaskWork(ctxFor(WIDE), { id: 'tarefa-longa', cursor: first.body.nextCursor! });
    expect(outra).toMatchObject({ ok: false, code: 'invalid_cursor' });
  });

  it('list_comments de conversa enorme pagina e cada JSON fica <= 64 KiB', async () => {
    let cursor: string | undefined;
    const ids: string[] = [];
    let pages = 0;
    for (;;) {
      const page = await listCommentsWork(ctxFor(WIDE), { taskId: 'tarefa-conversa', cursor });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(measureJsonBytes(page.body)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      ids.push(...page.body.items.map((item) => item.id));
      pages += 1;
      if (!page.body.hasMore) break;
      cursor = page.body.nextCursor ?? undefined;
      expect(pages).toBeLessThan(20);
    }
    expect(ids).toHaveLength(80);
    expect(new Set(ids).size).toBe(80);
    expect(pages).toBeGreaterThan(1);
  });
});

describe('OpenAPI e a resposta efetiva passam no mesmo schema Zod', () => {
  it('search: documento, exemplo e HTTP efetivo fecham o contrato', async () => {
    const doc = integrationOpenApi();
    const schema = (
      doc.components as { schemas: { SearchResponse: Record<string, unknown> } }
    ).schemas.SearchResponse;
    expect(schema).toEqual(jsonSchemaFromZod(searchResponseSchema));
    expect(searchResponseSchema.parse(searchOpenApiExample()).items.length).toBeGreaterThan(1);

    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${SEARCH_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'Wesley', kinds: ['person'] }),
      }),
      grant: WIDE,
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      work: WORK,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const body = searchResponseSchema.parse(await response.json());
    expect(body.operation).toBe('search');
    expect(body.self).toBe(SEARCH_PATH);
    expect(body.queriedAt).toBe(AGORA.toISOString());
    expect(body.items).toHaveLength(2);
    expect(body.effectiveScope.companies).toEqual([{ id: COMPANY_A, name: 'Agência Ide' }]);
  });

  it('get_task: exemplo OpenAPI e resposta efetiva no mesmo schema', async () => {
    const doc = integrationOpenApi();
    const schema = (
      doc.components as { schemas: { GetTaskResponse: Record<string, unknown> } }
    ).schemas.GetTaskResponse;
    expect(schema).toEqual(jsonSchemaFromZod(getTaskResponseSchema));
    expect(getTaskResponseSchema.parse(getTaskOpenApiExample()).task.id).toBe('tarefa-peca');

    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_TASK_PATH}?id=tarefa-peca`),
      grant: WIDE,
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      work: WORK,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const body = getTaskResponseSchema.parse(await response.json());
    expect(body.task.title).toBe('Peça da campanha');
    expect(body.task.client?.name).toBe('Jatobá');
    expect(body.hasMore).toBe(false);
  });
});

describe('F37 — prioridade, datas e tipo da etapa em get_task e get_board', () => {
  it('get_task devolve priority urgent por HTTP e os demais campos; ausentes viram null', async () => {
    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_TASK_PATH}?id=tarefa-peca`),
      grant: WIDE,
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      work: WORK,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const body = getTaskResponseSchema.parse(await response.json());
    expect(body.task).toMatchObject({
      priority: 'urgent',
      startOn: '2026-09-24',
      completedAt: '2026-09-26T12:00:00.000Z',
      archivedAt: null,
      statusType: 'open',
    });

    const vazia = await getTaskWork(ctxFor(WIDE), { id: 'tarefa-sem-cliente' });
    expect(vazia.ok).toBe(true);
    if (!vazia.ok) return;
    expect(vazia.body.task).toMatchObject({ priority: null, startOn: null, completedAt: null, archivedAt: null });
  });

  it('get_board devolve o tipo das colunas e os campos nos cartões; cliente de outro recorte segue invisível', async () => {
    const page = await getBoardWork(ctxFor(WIDE), { id: 'lista-atendimento-jatoba', limit: 100 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.board.columns.map((column) => column.type)).toEqual(['open', 'done']);
    const card = page.body.board.tasks.find((task) => task.id === 'tarefa-conversa');
    expect(card).toMatchObject({ priority: 'high', startOn: '2026-09-01', archivedAt: null });
    const seca = page.body.board.tasks.find((task) => task.id === 'item-001');
    expect(seca).toMatchObject({ priority: null, startOn: null, completedAt: null, archivedAt: null });
    expect(getBoardResponseSchema.safeParse(page.body).success).toBe(true);
    expect(await getBoardWork(ctxFor(WIDE), { id: 'lista-filmes' })).toMatchObject({ ok: false });
  });
});

describe('relações não concedidas não vazam', () => {
  it('get_task sem clients:read zera o cliente mesmo com o registro preenchido', async () => {
    const page = await getTaskWork(ctxFor(TASKS_ONLY), { id: 'tarefa-peca' });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.task.client).toBeNull();
    expect(page.body.task.people).toBeNull();
    expect(page.body.task.comments).toBeNull();
    expect(page.body.task.board?.name).toBeNull();
    expect(JSON.stringify(page.body)).not.toContain('Jatobá');
    expect(JSON.stringify(page.body)).not.toContain('Helena');
  });

  it('tarefa sem cliente próprio em lista de cliente lê o cliente da lista (F38, Fase 6)', async () => {
    const page = await getTaskWork(ctxFor(WIDE), { id: 'tarefa-sem-cliente' });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    // A regra única: o cliente da tarefa, e na falta dele o da lista.
    expect(page.body.task.client).toEqual({ id: CLIENT_A, name: 'Jatobá' });
    expect(page.body.task.title).toBe('Tarefa interna');
  });

  it('get_client com duas listas, uma fora do alcance, não vaza o nome bloqueado', async () => {
    const page = await getClientWork(ctxFor(WIDE), { id: CLIENT_A });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    if (!('lists' in page.body.client)) throw new Error('cliente ativo devolveu a ficha de cancelado');
    expect(page.body.client.lists).toHaveLength(2);
    const visible = page.body.client.lists.find((list) => list.id === 'lista-atendimento-jatoba');
    const hidden = page.body.client.lists.find((list) => list.id === 'lista-secreta');
    expect(visible?.name).toBe('Atendimento');
    expect(hidden?.name).toBeNull();
    expect(hidden?.space.name).toBeNull();
    expect(hidden?.id).toBe('lista-secreta');
    const json = JSON.stringify(page.body);
    expect(json).not.toContain(SECRET_LIST);
    expect(json).not.toContain(SECRET_SPACE);
  });

  it('get_board sem boards:read recusa; list_comments sem comments:read recusa', async () => {
    expect(await getBoardWork(ctxFor(TASKS_ONLY), { id: 'lista-atendimento-jatoba' })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
    expect(await listCommentsWork(ctxFor(TASKS_ONLY), { taskId: 'tarefa-conversa' })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
  });
});

describe('diretório e trabalho por pessoa', () => {
  it('list_people não revela e-mail, papel admin nem carteira completa', async () => {
    const page = await listPeopleWork(ctxFor(WIDE));
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.operation).toBe('list_people');
    const ids = page.body.items.map((item) => item.id).sort();
    expect(ids).toEqual(['pessoa-helena', 'pessoa-idle', 'pessoa-wesley-comercial', 'pessoa-wesley-entrega']);
    expect(page.body.items.every((item) => item.displayName.length > 0)).toBe(true);
    expect(page.body.items.every((item) => item.team?.id === COMPANY_A)).toBe(true);
    const json = JSON.stringify(page.body);
    expect(json).not.toContain('email');
    expect(json).not.toContain('papel');
    expect(json).not.toContain('todosOsClientes');
    expect(json).not.toContain('isSuperadmin');
    expect(json).not.toContain('NAO_VAZAR_EMAIL');
    expect(json).not.toContain('NAO_VAZAR_PAPEL');
    expect(json).not.toContain('pessoa-wesley-filmes');
    expect(json).not.toContain('Ide Filmes');
  });

  it('sem people:read a recusa é permission_denied, não lista vazia', async () => {
    const denied = await listPeopleWork(ctxFor(TASKS_ONLY));
    expect(denied).toEqual({
      ok: false,
      code: 'permission_denied',
      message: 'Fora do alcance desta integração.',
    });
    const workDenied = await getPersonWork(ctxFor(TASKS_ONLY), { id: 'pessoa-idle' });
    expect(workDenied).toEqual({
      ok: false,
      code: 'permission_denied',
      message: 'Fora do alcance desta integração.',
    });
  });

  it('pessoa visível sem tarefas devolve zero, 200, com identidade mínima', async () => {
    const page = await getPersonWork(ctxFor(WIDE), { id: 'pessoa-idle' });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.person).toEqual({
      id: 'pessoa-idle',
      displayName: 'Pessoa sem demanda',
      team: { id: COMPANY_A, name: 'Agência Ide' },
    });
    expect(page.body.returned).toBe(0);
    expect(page.body.counts).toEqual({ tasks: 0, open: 0, done: 0 });
    expect(page.body.items).toEqual([]);
    expect(JSON.stringify(page.body)).not.toContain('NAO_VAZAR_EMAIL');
    expect(JSON.stringify(page.body)).not.toContain('email');

    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_PERSON_WORK_PATH}?id=pessoa-idle`),
      grant: WIDE,
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      work: WORK,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const body = getPersonWorkResponseSchema.parse(await response.json());
    expect(body.returned).toBe(0);
    expect(body.counts.tasks).toBe(0);
  });

  it('id fora do recorte é permission_denied mesmo se o catálogo tem a pessoa com 0 tarefas', async () => {
    const zero = await getPersonWork(ctxFor(WIDE), { id: 'pessoa-idle' });
    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.body.returned).toBe(0);
    expect(zero.body.items).toEqual([]);

    const inaccessible = await getPersonWork(ctxFor(WIDE), { id: 'pessoa-wesley-filmes' });
    expect(inaccessible).toEqual({
      ok: false,
      code: 'permission_denied',
      message: 'Fora do alcance desta integração.',
    });
    expect(inaccessible).not.toMatchObject({ returned: 0 });
    expect(JSON.stringify(inaccessible)).not.toContain('items');
    expect(JSON.stringify(inaccessible)).not.toContain('counts');

    const unknown = await getPersonWork(ctxFor(WIDE), { id: 'pessoa-inexistente' });
    expect(unknown).toMatchObject({ ok: false, code: 'permission_denied' });

    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_PERSON_WORK_PATH}?id=pessoa-wesley-filmes`),
      grant: WIDE,
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      work: WORK,
      now: AGORA,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'permission_denied' });
  });

  it('admin com concessão parcial não lista pessoa da outra empresa e conta só o recorte', async () => {
    const tight = ctxFor(TIGHT);
    const directory = await listPeopleWork(tight);
    expect(directory.ok).toBe(true);
    if (!directory.ok) return;
    expect(directory.body.items.map((item) => item.id)).not.toContain('pessoa-wesley-filmes');
    expect(JSON.stringify(directory.body)).not.toContain('Ide Filmes');

    const work = await getPersonWork(tight, { id: 'pessoa-helena' });
    expect(work.ok).toBe(true);
    if (!work.ok) return;
    expect(work.body.counts.tasks).toBe(1);
    expect(work.body.returned).toBe(1);
    expect(work.body.items.map((item) => item.id)).toEqual(['tarefa-peca']);
    expect(JSON.stringify(work.body)).not.toContain('tarefa-intrusa');
    expect(JSON.stringify(work.body)).not.toContain('tarefa-filmes');
    expect(JSON.stringify(work.body)).not.toContain('Rebrota');
    expect(JSON.stringify(work.body)).not.toContain('Ide Filmes');
  });

  it('F37: fila da pessoa traz etapa e prioridade; cursor continua válido', async () => {
    const base = {
      description: null,
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      boardId: 'lista-atendimento-jatoba',
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      dueOn: null,
      people: [{ id: 'pessoa-helena', name: 'Helena' }],
    };
    const work = new MemoryWorkCatalog({
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
          statuses: [OPEN, DONE],
        },
      ],
      clients: [
        {
          id: CLIENT_A,
          name: 'Jatobá',
          companyId: COMPANY_A,
          companyName: 'Agência Ide',
          listIds: ['lista-atendimento-jatoba'],
        },
      ],
      people: [
        {
          id: 'pessoa-helena',
          name: 'Helena',
          companyId: COMPANY_A,
          companyName: 'Agência Ide',
          detail: 'atendimento',
        },
      ],
      tasks: [
        { ...base, id: 'f37-a', title: 'A urgente', statusId: OPEN.id, priority: 'urgent' },
        { ...base, id: 'f37-b', title: 'B feita', statusId: DONE.id, priority: 'low' },
        { ...base, id: 'f37-c', title: 'C sem nada', statusId: null },
      ],
    });
    const ctx = { ...ctxFor(WIDE), work };

    const all = await getPersonWork(ctx, { id: 'pessoa-helena' });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.body.items.map((i) => [i.id, i.statusId, i.statusName, i.statusType, i.priority])).toEqual([
      ['f37-a', OPEN.id, 'Aberto', 'open', 'urgent'],
      ['f37-b', DONE.id, 'Feito', 'done', 'low'],
      ['f37-c', null, null, null, null],
    ]);

    const p1 = await getPersonWork(ctx, { id: 'pessoa-helena', limit: 1 });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect(p1.body.items[0].priority).toBe('urgent');
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await getPersonWork(ctx, { id: 'pessoa-helena', limit: 1, cursor: p1.body.nextCursor! });
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    expect(p2.body.items.map((i) => [i.id, i.statusType])).toEqual([['f37-b', 'done']]);

    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_PERSON_WORK_PATH}?id=pessoa-helena`),
      grant: WIDE,
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      work,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    expect(getPersonWorkResponseSchema.parse(await response.json()).items).toEqual(all.body.items);
  });

  it('OpenAPI e a resposta efetiva de list_people passam no mesmo schema Zod', async () => {
    const doc = integrationOpenApi();
    const schema = (
      doc.components as { schemas: { ListPeopleResponse: Record<string, unknown> } }
    ).schemas.ListPeopleResponse;
    expect(schema).toEqual(jsonSchemaFromZod(listPeopleResponseSchema));
    expect(listPeopleResponseSchema.parse(listPeopleOpenApiExample()).items.length).toBeGreaterThan(0);

    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${LIST_PEOPLE_PATH}`),
      grant: WIDE,
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      work: WORK,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const body = listPeopleResponseSchema.parse(await response.json());
    expect(body.operation).toBe('list_people');
    expect(body.self).toBe(LIST_PEOPLE_PATH);
    expect(body.queriedAt).toBe(AGORA.toISOString());
    expect(body.effectiveScope.companies).toEqual([{ id: COMPANY_A, name: 'Agência Ide' }]);
  });

  it('OpenAPI e o exemplo de get_person_work passam no mesmo schema Zod', () => {
    const doc = integrationOpenApi();
    const schema = (
      doc.components as { schemas: { GetPersonWorkResponse: Record<string, unknown> } }
    ).schemas.GetPersonWorkResponse;
    expect(schema).toEqual(jsonSchemaFromZod(getPersonWorkResponseSchema));
    const example = getPersonWorkResponseSchema.parse(getPersonWorkOpenApiExample());
    expect(example.operation).toBe('get_person_work');
    expect(example.returned).toBe(1);
    expect(example.person).not.toHaveProperty('email');
    expect(example.person).not.toHaveProperty('isSuperadmin');
    expect(JSON.stringify(example)).not.toContain('papel');
  });
});

describe('SqlWorkCatalog recorta no escopo vazio sem falar com o banco', () => {
  it('listPeople vazio e getPersonWork nulo quando a concessão não tem empresa', async () => {
    const catalog = new SqlWorkCatalog({} as never, { kind: 'preauth' });
    const scope = {
      companies: { kind: 'none' as const },
      clients: 'none' as const,
      capabilities: new Set<'people:read'>(['people:read']),
    };
    await expect(catalog.listPeople(scope)).resolves.toEqual([]);
    await expect(catalog.getPersonWork(scope, 'pessoa-idle')).resolves.toBeNull();
    await expect(catalog.getBoard(scope, 'lista-atendimento-jatoba')).resolves.toBeNull();
  });
});

/**
 * F22, Fase 3: o corte passou a acontecer no banco. Este catálogo imita o que
 * o SQL faz — `limit + 1` por espécie, depois do cursor, na mesma ordem — para
 * a suíte provar a SEMÂNTICA do corte sem um Postgres. Se o corte no banco
 * perdesse ou repetisse linha na virada de página, é aqui que apareceria.
 */
class JanelaComoNoBanco implements WorkCatalog {
  constructor(private readonly base: WorkCatalog) {}

  async search(scope: WorkScope, query: string, kinds: readonly SearchKind[], window: SearchWindow) {
    const todos = await this.base.search(scope, query, kinds, window);
    const saida: WorkSearchHit[] = [];
    for (const kind of kinds) {
      const janela = searchKindWindow(kind, window);
      if (janela.skip) continue;
      const desta = todos
        .filter((hit) => hit.kind === kind)
        .map((hit) => ({ hit, k: hit.title.toLowerCase(), id: hit.id }))
        .sort((a, b) => (a.k === b.k ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.k < b.k ? -1 : 1))
        .filter((row) => !janela.after || row.k > janela.after.k || (row.k === janela.after.k && row.id > janela.after.id))
        .slice(0, janela.fetch);
      for (const row of desta) saida.push(row.hit);
    }
    return saida;
  }

  getBoard(scope: WorkScope, id: string, window?: TitleWindow) {
    return this.base.getBoard(scope, id, window);
  }
  listTags(scope: WorkScope, target: Parameters<WorkCatalog['listTags']>[1]) {
    return this.base.listTags(scope, target);
  }
  listClients(scope: WorkScope) {
    return this.base.listClients(scope);
  }
  listBoards(scope: WorkScope, options: Parameters<WorkCatalog['listBoards']>[1]) {
    return this.base.listBoards(scope, options);
  }
  listTasks(scope: WorkScope, filters: Parameters<WorkCatalog['listTasks']>[1], window?: TitleWindow) {
    return this.base.listTasks(scope, filters, window);
  }
  getWorkflow(scope: WorkScope, target: WorkflowTarget) {
    return this.base.getWorkflow(scope, target);
  }
  getTask(scope: WorkScope, id: string) {
    return this.base.getTask(scope, id);
  }
  getClient(scope: WorkScope, id: string) {
    return this.base.getClient(scope, id);
  }
  listComments(scope: WorkScope, id: string) {
    return this.base.listComments(scope, id);
  }
  listPeople(scope: WorkScope) {
    return this.base.listPeople(scope);
  }
  getPersonWork(scope: WorkScope, id: string, window?: TitleWindow) {
    return this.base.getPersonWork(scope, id, window);
  }
  getClientMural(scope: WorkScope, id: string) {
    return this.base.getClientMural(scope, id);
  }
  getClientHistory(scope: WorkScope, id: string) {
    return this.base.getClientHistory(scope, id);
  }
}

describe('com o corte no banco, a paginação continua alcançando tudo', () => {
  const janelado: ReadCtx = { ...ctxFor(WIDE), work: new JanelaComoNoBanco(WORK) };

  async function tudo(input: { q: string; kinds?: SearchKind[]; limit?: number }) {
    const ids: string[] = [];
    let cursor: string | undefined;
    let voltas = 0;
    for (;;) {
      const página = await searchWork(janelado, { ...input, cursor });
      expect(página.ok).toBe(true);
      if (!página.ok) break;
      ids.push(...página.body.items.map((item) => item.id));
      if (!página.body.hasMore) {
        expect(página.body.nextCursor).toBeNull();
        break;
      }
      expect(página.body.nextCursor).toBeTruthy();
      cursor = página.body.nextCursor!;
      if (++voltas > 40) throw new Error('paginação não terminou');
    }
    return ids;
  }

  it('massa acima do teto: todas as páginas, sem duplicar, na mesma ordem de antes', async () => {
    const ids = await tudo({ q: 'Item', kinds: ['task'] });
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
    expect(ids).toEqual(MASSA.map((item) => item.id));
  });

  it('página pequena: o sinal de continuação vem do corte do banco e nada se perde', async () => {
    const ids = await tudo({ q: 'Item', kinds: ['task'], limit: 7 });
    expect(ids).toEqual(MASSA.map((item) => item.id));
  });

  it('termo curto que casa com várias espécies atravessa todas elas', async () => {
    const janela = await tudo({ q: 'a' });
    const sem = await searchWork(ctxFor(WIDE), { q: 'a' });
    expect(sem.ok).toBe(true);
    if (!sem.ok) return;
    // O conjunto alcançável é o mesmo com corte no banco e sem ele.
    const completo: string[] = [];
    let cursor: string | undefined = undefined;
    for (;;) {
      const p: Awaited<ReturnType<typeof searchWork>> = await searchWork(ctxFor(WIDE), { q: 'a', cursor });
      if (!p.ok) break;
      completo.push(...p.body.items.map((i) => i.id));
      if (!p.body.hasMore) break;
      cursor = p.body.nextCursor!;
    }
    expect(janela).toEqual(completo);
    expect(new Set(janela).size).toBe(janela.length);
  });

  it('a primeira página só pede ao banco o que cabe nela, mais um', async () => {
    const espiao: SearchWindow[] = [];
    const observado: ReadCtx = {
      ...janelado,
      work: new Proxy(janelado.work, {
        get(alvo, prop, receiver) {
          if (prop !== 'search') return Reflect.get(alvo, prop, receiver);
          return async (scope: WorkScope, q: string, kinds: readonly SearchKind[], window: SearchWindow) => {
            espiao.push(window);
            return janelado.work.search(scope, q, kinds, window);
          };
        },
      }),
    };
    const página = await searchWork(observado, { q: 'Item', kinds: ['task'], limit: 5 });
    expect(página.ok).toBe(true);
    expect(espiao).toHaveLength(1);
    expect(espiao[0].limit).toBe(5);
    expect(espiao[0].cursor).toBeNull();
  });

  it('limite inválido recusa antes de qualquer ida ao banco', async () => {
    let foi = false;
    const observado: ReadCtx = {
      ...janelado,
      work: {
        ...janelado.work,
        async search(...args: Parameters<WorkCatalog['search']>) {
          foi = true;
          return janelado.work.search(...args);
        },
      } as WorkCatalog,
    };
    const recusa = await searchWork(observado, { q: 'Item', limit: 1000 });
    expect(recusa).toEqual({ ok: false, code: 'limit_exceeded', message: expect.any(String) });
    expect(foi).toBe(false);
  });
});

/**
 * Verificação da Fase 3 (olhos frescos): a virada de página com título
 * ACENTUADO, REPETIDO e com MAIÚSCULA misturada — os três casos em que a chave
 * de ordem do SQL e a do JavaScript poderiam divergir e fazer uma linha sumir
 * ou voltar duas vezes. A massa também força a virada ENTRE espécies.
 */
const TITULOS_DIFICEIS = ['Ação', 'AÇÃO', 'ação', 'Alfa', 'alfa', 'ALFA', 'Ana', 'ana', 'Água', 'agua', '\tCarro', 'Carro\n', '  Barra', 'Barra  ', '\u00a0Ampla'];

const WORK_DIFICIL = new MemoryWorkCatalog({
  boards: TITULOS_DIFICEIS.map((name, i) => ({
    id: `quadro-${String(i).padStart(2, '0')}`,
    name,
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    spaceId: 'space-a',
    spaceName: 'Entrega',
    folderId: null,
    folderName: null,
    clientId: null,
    clientName: null,
    canSeeSpace: true,
    statuses: [OPEN],
  })),
  tasks: TITULOS_DIFICEIS.map((title, i) => ({
    id: `tarefa-${String(i).padStart(2, '0')}`,
    title,
    description: null,
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    boardId: 'quadro-00',
    clientId: null,
    clientName: null,
    statusId: OPEN.id,
    dueOn: null,
    people: [],
  })),
});

describe('virada de página com acento, repetição e caixa misturada', () => {
  const dificil: ReadCtx = { ...ctxFor(WIDE), work: new JanelaComoNoBanco(WORK_DIFICIL) };
  const inteiro: ReadCtx = { ...ctxFor(WIDE), work: WORK_DIFICIL };

  async function percorre(ctx: ReadCtx, limit: number) {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let voltas = 0; voltas < 60; voltas++) {
      const p = await searchWork(ctx, { q: 'a', kinds: ['board', 'task'], limit, cursor });
      expect(p.ok).toBe(true);
      if (!p.ok) break;
      ids.push(...p.body.items.map((i) => i.id));
      if (!p.body.hasMore) return ids;
      cursor = p.body.nextCursor!;
    }
    throw new Error('paginação não terminou');
  }

  it.each([1, 2, 3, 4, 7, 20])('limite %i: nada some, nada se repete, e a ordem é a de sempre', async (limit) => {
    const comJanela = await percorre(dificil, limit);
    const semJanela = await percorre(inteiro, limit);
    expect(new Set(comJanela).size).toBe(comJanela.length);
    expect(comJanela).toHaveLength(TITULOS_DIFICEIS.length * 2);
    expect(comJanela).toEqual(semJanela);
  });

  it('a virada acontece mesmo entre as espécies, e não pula a primeira da seguinte', async () => {
    const ids = await percorre(dificil, 3);
    const quadros = ids.filter((id) => id.startsWith('quadro-'));
    const tarefas = ids.filter((id) => id.startsWith('tarefa-'));
    expect(quadros).toHaveLength(TITULOS_DIFICEIS.length);
    expect(tarefas).toHaveLength(TITULOS_DIFICEIS.length);
    // todos os quadros vêm antes de todas as tarefas: a chave é `espécie:título`
    expect(ids.slice(0, quadros.length)).toEqual(quadros);
  });
});

/**
 * F38, Fase 6.1 — `get_board` e `get_person_work` cortam no banco. O dublê em
 * memória faz o mesmo corte que o SQL (`limit + 1` depois do cursor, ordem do
 * título dobrado e id), e as contagens continuam sendo do recorte inteiro. A
 * massa é a dos títulos difíceis: acento, repetição, caixa e espaço na ponta.
 */
const PESSOA_P = 'pessoa-paginas';
const WORK_PAGINAS = new MemoryWorkCatalog({
  boards: [
    {
      id: 'quadro-paginas',
      name: 'Paginado',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      spaceId: 'space-a',
      spaceName: 'Entrega',
      folderId: null,
      folderName: null,
      clientId: null,
      clientName: null,
      canSeeSpace: true,
      statuses: [OPEN, DONE],
    },
  ],
  people: [{ id: PESSOA_P, name: 'Paola', companyId: COMPANY_A, companyName: 'Agência Ide', detail: null }],
  tasks: TITULOS_DIFICEIS.map((title, i) => ({
    id: `pg-${String(i).padStart(2, '0')}`,
    title,
    description: null,
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    boardId: 'quadro-paginas',
    clientId: null,
    clientName: null,
    statusId: i % 3 === 0 ? DONE.id : OPEN.id,
    completedAt: i % 3 === 0 ? '2026-10-01T12:00:00.000Z' : null,
    dueOn: null,
    people: [{ id: PESSOA_P, name: 'Paola' }],
  })),
});

describe('F38, Fase 6.1 — get_board e get_person_work com o corte no banco', () => {
  const ctx: ReadCtx = { ...ctxFor(WIDE), work: WORK_PAGINAS };

  async function quadroInteiro(limit: number) {
    const ids: string[] = [];
    const totais: string[] = [];
    let cursor: string | undefined;
    for (let voltas = 0; voltas < 60; voltas++) {
      const p = await getBoardWork(ctx, { id: 'quadro-paginas', limit, cursor });
      expect(p.ok).toBe(true);
      if (!p.ok) break;
      ids.push(...p.body.board.tasks.map((t) => t.id));
      totais.push(JSON.stringify(p.body.board.columns.map((c) => [c.id, c.total])));
      if (!p.body.hasMore) {
        expect(p.body.nextCursor).toBeNull();
        return { ids, totais };
      }
      expect(p.body.board.tasks).toHaveLength(limit);
      expect(p.body.nextCursor).toBeTruthy();
      cursor = p.body.nextCursor!;
    }
    throw new Error('paginação não terminou');
  }

  async function pessoaInteira(limit: number) {
    const ids: string[] = [];
    const contagens: string[] = [];
    let cursor: string | undefined;
    for (let voltas = 0; voltas < 60; voltas++) {
      const p = await getPersonWork(ctx, { id: PESSOA_P, limit, cursor });
      expect(p.ok).toBe(true);
      if (!p.ok) break;
      ids.push(...p.body.items.map((t) => t.id));
      contagens.push(JSON.stringify(p.body.counts));
      if (!p.body.hasMore) {
        expect(p.body.nextCursor).toBeNull();
        return { ids, contagens };
      }
      expect(p.body.items).toHaveLength(limit);
      expect(p.body.nextCursor).toBeTruthy();
      cursor = p.body.nextCursor!;
    }
    throw new Error('paginação não terminou');
  }

  it.each([1, 2, 3, 7, 14])('get_board limite %i: nada some, nada se repete, mesma ordem da página única', async (limit) => {
    const { ids, totais } = await quadroInteiro(limit);
    const unica = await quadroInteiro(100);
    expect(unica.ids).toHaveLength(TITULOS_DIFICEIS.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(unica.ids);
    // os totais das colunas são do quadro inteiro, iguais em toda página
    expect(new Set(totais)).toEqual(new Set([unica.totais[0]]));
    expect(JSON.parse(unica.totais[0])).toEqual([
      [OPEN.id, 10],
      [DONE.id, 5],
    ]);
  });

  it.each([1, 2, 4, 14])('get_person_work limite %i: nada some, nada se repete; contagens iguais com e sem corte', async (limit) => {
    const { ids, contagens } = await pessoaInteira(limit);
    const unica = await pessoaInteira(100);
    expect(ids).toEqual(unica.ids);
    expect(new Set(ids).size).toBe(TITULOS_DIFICEIS.length);
    const semCorte = await WORK_PAGINAS.getPersonWork(toWorkScope(ADMIN, WIDE, AGORA), PESSOA_P);
    expect(semCorte?.counts).toEqual({ tasks: 15, open: 10, done: 5 });
    expect(new Set(contagens)).toEqual(new Set([JSON.stringify(semCorte?.counts)]));
  });

  it('a segunda página começa logo depois do cursor da primeira', async () => {
    const p1 = await getBoardWork(ctx, { id: 'quadro-paginas', limit: 4 });
    const p2 = await getBoardWork(ctx, { id: 'quadro-paginas', limit: 4, cursor: p1.ok ? p1.body.nextCursor! : '' });
    const tudo = await getBoardWork(ctx, { id: 'quadro-paginas', limit: 8 });
    if (!p1.ok || !p2.ok || !tudo.ok) throw new Error('recusou');
    expect(p1.body.hasMore).toBe(true);
    expect([...p1.body.board.tasks, ...p2.body.board.tasks].map((t) => t.id)).toEqual(
      tudo.body.board.tasks.map((t) => t.id),
    );
  });

  it('o catálogo recebe a janela e devolve no máximo o pedido + 1', async () => {
    const janelas: Array<TitleWindow | undefined> = [];
    const tamanhos: number[] = [];
    const observado: ReadCtx = {
      ...ctx,
      work: new Proxy(WORK_PAGINAS, {
        get(alvo, prop, receiver) {
          if (prop === 'getBoard') {
            return async (scope: WorkScope, id: string, window?: TitleWindow) => {
              janelas.push(window);
              const visao = await alvo.getBoard(scope, id, window);
              tamanhos.push(visao?.tasks.length ?? -1);
              return visao;
            };
          }
          if (prop === 'getPersonWork') {
            return async (scope: WorkScope, id: string, window?: TitleWindow) => {
              janelas.push(window);
              const visao = await alvo.getPersonWork(scope, id, window);
              tamanhos.push(visao?.tasks.length ?? -1);
              return visao;
            };
          }
          return Reflect.get(alvo, prop, receiver);
        },
      }),
    };
    await getBoardWork(observado, { id: 'quadro-paginas', limit: 5 });
    await getPersonWork(observado, { id: PESSOA_P, limit: 3 });
    expect(janelas).toEqual([
      { limit: 5, cursor: null },
      { limit: 3, cursor: null },
    ]);
    expect(tamanhos).toEqual([6, 4]);
  });

  it('limite ou cursor inválido recusa antes de qualquer ida ao banco', async () => {
    let foi = false;
    const observado: ReadCtx = {
      ...ctx,
      work: {
        ...WORK_PAGINAS,
        async getBoard() {
          foi = true;
          return null;
        },
        async getPersonWork() {
          foi = true;
          return null;
        },
      } as unknown as WorkCatalog,
    };
    expect(await getBoardWork(observado, { id: 'quadro-paginas', limit: 1000 })).toMatchObject({ ok: false, code: 'limit_exceeded' });
    expect(await getPersonWork(observado, { id: PESSOA_P, cursor: 'lixo!' })).toMatchObject({ ok: false, code: 'invalid_cursor' });
    expect(foi).toBe(false);
  });
});

describe('F38, Fase 6.4 — get_task lista as subtarefas', () => {
  const lista = {
    id: 'lista-sub',
    name: 'Fonseca',
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    spaceId: 'space-a',
    spaceName: 'Entrega',
    folderId: null,
    folderName: null,
    clientId: CLIENT_A,
    clientName: 'Jatobá',
    canSeeSpace: true,
    statuses: [OPEN, DONE],
  };
  const tarefa = (id: string, extra: Partial<MemoryTask> = {}): MemoryTask => ({
    id,
    title: id,
    description: null,
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    boardId: 'lista-sub',
    clientId: null,
    clientName: null,
    statusId: OPEN.id,
    dueOn: null,
    people: [],
    ...extra,
  });
  const work = new MemoryWorkCatalog({
    boards: [lista],
    tasks: [
      tarefa('mae'),
      tarefa('passo-1', { parentId: 'mae' }),
      tarefa('passo-2', { parentId: 'mae', statusId: DONE.id, completedAt: '2026-09-26T12:00:00.000Z' }),
      tarefa('passo-arquivado', { parentId: 'mae', archivedAt: '2026-09-26T12:00:00.000Z' }),
      tarefa('passo-de-outro-cliente', { parentId: 'mae', clientId: CLIENT_A2, clientName: 'Rebrota' }),
      tarefa('neta', { parentId: 'passo-1' }),
    ],
  });
  const ctx = (g: IntegrationGrant): ReadCtx => ({ ...ctxFor(g), work });

  it('as filhas diretas, não arquivadas, com etapa e conclusão; a neta fica no get_task da filha', async () => {
    const page = await getTaskWork(ctx(WIDE), { id: 'mae' });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.task.subtasks).toEqual([
      { id: 'passo-1', title: 'passo-1', statusId: OPEN.id, statusName: 'Aberto', completed: false },
      { id: 'passo-2', title: 'passo-2', statusId: DONE.id, statusName: 'Feito', completed: true },
      { id: 'passo-de-outro-cliente', title: 'passo-de-outro-cliente', statusId: OPEN.id, statusName: 'Aberto', completed: false },
    ]);
    expect(page.body.task.subtaskTotal).toBe(3);
    const filha = await getTaskWork(ctx(WIDE), { id: 'passo-1' });
    expect(filha.ok && filha.body.task.subtasks?.map((t) => t.id)).toEqual(['neta']);
    const semFilhas = await getTaskWork(ctx(WIDE), { id: 'neta' });
    expect(semFilhas.ok && semFilhas.body.task).toMatchObject({ subtasks: [], subtaskTotal: 0 });
  });

  it('o recorte de cliente da conexão vale nas subtarefas', async () => {
    const page = await getTaskWork(ctx(TIGHT), { id: 'mae' });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.task.subtasks?.map((t) => t.id)).toEqual(['passo-1', 'passo-2']);
    expect(page.body.task.subtaskTotal).toBe(2);
    expect(JSON.stringify(page.body)).not.toContain('passo-de-outro-cliente');
  });
});

/* ─────────────── F42, Fase 7 — as rodadas de aprovação no get_task ─────────────── */

describe('get_task traz as rodadas de aprovação do cliente', () => {
  const rodada = {
    id: 'rodada-1',
    version: 1,
    state: 'rejected' as const,
    sentAt: '2026-10-07T12:00:00.000Z',
    decidedAt: '2026-10-07T15:00:00.000Z',
    decidedBy: 'client_link' as const,
    closedAt: null,
    items: [
      { position: 1, kind: 'image' as const, fileName: 'arte.jpg', source: 'dropbox' as const, url: 'https://www.dropbox.com/scl/fi/a/arte.jpg' },
      // F42, Fase 9: arte anexada — sem link, e o caminho do balde nunca aparece.
      { position: 2, kind: 'image' as const, fileName: 'capa.png', source: 'attachment' as const, url: null },
    ],
    clientComments: [
      { id: 'fala-1', body: 'Clareiem a arte.', createdAt: '2026-10-07T15:00:00.000Z', itemPosition: null, decision: true },
    ],
  };
  const work = new MemoryWorkCatalog({
    tasks: [
      {
        id: 'tarefa-aprovacao',
        title: 'Carrossel de outubro',
        description: 'Legenda',
        companyId: COMPANY_A,
        companyName: 'Agência Ide',
        boardId: null,
        clientId: CLIENT_A,
        clientName: 'Jatobá',
        statusId: null,
        dueOn: null,
        people: [],
        approvalRounds: [rodada],
      },
    ],
    clients: [{ id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: [] }],
    comments: [
      { id: 'fala-1', taskId: 'tarefa-aprovacao', parentId: null, body: 'Clareiem a arte.', createdAt: '2026-10-07T15:00:00.000Z', author: null, fromClient: true },
    ],
  });

  it('com comments:read: as rodadas com itens e o que o cliente escreveu; o comentário vem marcado fromClient', async () => {
    const r = await getTaskWork({ ...ctxFor(WIDE), work }, { id: 'tarefa-aprovacao' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.task.approvalRounds).toEqual([rodada]);
    expect(r.body.task.comments).toEqual([{ id: 'fala-1', body: 'Clareiem a arte.', fromClient: true }]);
    expect(JSON.stringify(r.body)).not.toMatch(/token|\/aprovar\//i);
  });

  it('sem comments:read: a rodada continua (estado, datas, itens), mas o que o cliente escreveu vem null', async () => {
    const r = await getTaskWork({ ...ctxFor(TASKS_ONLY), work }, { id: 'tarefa-aprovacao' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.task.comments).toBeNull();
    expect(r.body.task.approvalRounds).toEqual([{ ...rodada, clientComments: null }]);
    expect(JSON.stringify(r.body)).not.toContain('Clareiem');
  });

  it('list_comments marca o comentário do cliente, sem autor', async () => {
    const r = await listCommentsWork({ ...ctxFor(WIDE), work }, { taskId: 'tarefa-aprovacao' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.items).toEqual([
      { id: 'fala-1', parentId: null, body: 'Clareiem a arte.', createdAt: '2026-10-07T15:00:00.000Z', author: null, fromClient: true },
    ]);
  });
});
