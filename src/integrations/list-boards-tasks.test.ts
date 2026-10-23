/**
 * `list_boards` e `list_tasks` — conferência de 08/10/2026, lacuna G11.
 *
 * O agente achava lista pelo nome (`search`) e não via "atrasadas da pasta X" nem
 * "o que a Carla criou" sem varrer lista por lista. Os testes provam o recorte
 * (outra empresa, outro cliente da mesma empresa, empresa omitida, cliente
 * cancelado, espaço/pasta/lista fora), a projeção por capacidade (nome de lista,
 * de cliente e de pessoa), cada filtro, o total, o cursor até o fim dentro dos
 * 64 KiB e as três superfícies iguais. O SQL está em `listas-e-tarefas-banco.test.ts`.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  LIST_BOARDS_PATH,
  LIST_TASKS_PATH,
  integrationOpenApi,
  jsonSchemaFromZod,
  listBoardsInputSchema,
  listBoardsOpenApiExample,
  listBoardsResponseSchema,
  listTasksInputSchema,
  listTasksOpenApiExample,
  listTasksResponseSchema,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import type { IntegrationCapability, IntegrationGrant, PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { RESPONSE_BUDGET_BYTES, measureJsonBytes } from '@/integrations/page';
import {
  MemoryWorkCatalog,
  listBoardsWork,
  listTasksWork,
  type MemoryBoard,
  type MemoryClient,
  type MemoryTask,
} from '@/integrations/reads';
import { EMPTY_DELIVERY_CATALOG } from '@/integrations/reports';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_ALMA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_A = '10000000-0000-4000-8000-00000000000a';
const CLIENT_A2 = '10000000-0000-4000-8000-00000000000b';
const CLIENT_B = '10000000-0000-4000-8000-00000000000c';
const CLIENT_ALMA = '10000000-0000-4000-8000-00000000000d';
const CLIENT_ZECA = '10000000-0000-4000-8000-00000000000e';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const HELENA = '20000000-0000-4000-8000-000000000001';
const CARLA = '20000000-0000-4000-8000-000000000002';
const SPACE_1 = '30000000-0000-4000-8000-000000000001';
const SPACE_2 = '30000000-0000-4000-8000-000000000002';
const SPACE_B = '30000000-0000-4000-8000-000000000003';
const SPACE_ALMA = '30000000-0000-4000-8000-000000000004';
const FOLDER_1 = '40000000-0000-4000-8000-000000000001';
const LIST_A = '50000000-0000-4000-8000-000000000001';
const LIST_A2 = '50000000-0000-4000-8000-000000000002';
const LIST_ESTUDIO = '50000000-0000-4000-8000-000000000003';
const LIST_B = '50000000-0000-4000-8000-000000000004';
const LIST_ALMA = '50000000-0000-4000-8000-000000000005';
const LIST_ARQUIVADA = '50000000-0000-4000-8000-000000000006';
const LIST_ZECA = '50000000-0000-4000-8000-000000000007';
const ORIGIN = 'https://ideworks.test';
/** Quinta-feira, 08/10/2026, 09h em São Paulo. */
const AGORA = new Date('2026-10-08T12:00:00.000Z');

const TODAS: IntegrationCapability[] = ['boards:read', 'tasks:read', 'clients:read', 'people:read'];
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
/** Quem NÃO é o topo: alcança só a empresa A e, dos clientes dela, só o Jatobá (a regra de `can_see_client`). */
const SO_O_JATOBA: PersonAccess = {
  ...SUPER,
  isSuper: false,
  isSuperadmin: false,
  hasAllClientsAccess: false,
  companyIds: [COMPANY_A],
  clientIds: [CLIENT_A],
};

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: 'grant-listas',
  ownerId: OWNER_ID,
  oauthClientId: 'claude',
  name: 'Claude',
  capabilities: TODAS,
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
  ...over,
});
const sem = (...tiradas: IntegrationCapability[]) => grant({ capabilities: TODAS.filter((c) => !tiradas.includes(c)) });

const STAGES = [
  { id: 'aberto', name: 'A fazer', sortOrder: 1, type: 'unstarted' as const },
  { id: 'fazendo', name: 'Em produção', sortOrder: 2, type: 'custom' as const },
  { id: 'feito', name: 'Feito', sortOrder: 3, type: 'done' as const },
];
const PRODUCAO = [...STAGES, { id: 'atribuir', name: 'Atribuir demanda', sortOrder: 0, type: 'open' as const }];

function lista(
  id: string,
  name: string,
  companyId: string,
  spaceId: string,
  spaceName: string,
  over: Partial<MemoryBoard> = {},
): MemoryBoard {
  return {
    id,
    name,
    companyId,
    companyName: companyId === COMPANY_A ? 'Agência Ide' : companyId === COMPANY_B ? 'Ide Filmes' : 'Alma Nove',
    spaceId,
    spaceName,
    folderId: null,
    folderName: null,
    clientId: null,
    clientName: null,
    canSeeSpace: true,
    statuses: STAGES,
    ...over,
  };
}

const BOARDS: MemoryBoard[] = [
  lista(LIST_A, 'Atendimento', COMPANY_A, SPACE_1, 'CLIENTES', {
    folderId: FOLDER_1,
    folderName: 'TIME HELENA',
    clientId: CLIENT_A,
    clientName: 'Jatobá',
    statuses: PRODUCAO,
  }),
  lista(LIST_A2, 'Atendimento', COMPANY_A, SPACE_1, 'CLIENTES', {
    folderId: FOLDER_1,
    folderName: 'TIME HELENA',
    clientId: CLIENT_A2,
    clientName: 'Sabor Doce',
  }),
  lista(LIST_ESTUDIO, 'ESTÚDIO', COMPANY_A, SPACE_2, 'Estúdio Ide', { requiresClient: true }),
  lista(LIST_B, 'Filmes', COMPANY_B, SPACE_B, 'Produção', { clientId: CLIENT_B, clientName: 'Cliente Filmes' }),
  lista(LIST_ALMA, 'Lista da Alma', COMPANY_ALMA, SPACE_ALMA, 'Alma', { clientId: CLIENT_ALMA, clientName: 'Cliente Alma' }),
  lista(LIST_ARQUIVADA, 'Antiga', COMPANY_A, SPACE_2, 'Estúdio Ide', { archived: true }),
  lista(LIST_ZECA, 'Zeca', COMPANY_A, SPACE_1, 'CLIENTES', { clientId: CLIENT_ZECA, clientName: 'Zeca' }),
];

const CLIENTES: MemoryClient[] = [
  { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: [LIST_A] },
  { id: CLIENT_A2, name: 'Sabor Doce', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: [LIST_A2] },
  { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes', listIds: [LIST_B] },
  { id: CLIENT_ALMA, name: 'Cliente Alma', companyId: COMPANY_ALMA, companyName: 'Alma Nove', listIds: [LIST_ALMA] },
  { id: CLIENT_ZECA, name: 'Zeca', companyId: COMPANY_A, companyName: 'Agência Ide', listIds: [LIST_ZECA], isActive: false, cancelledOn: '2026-10-04' },
];

function tarefa(over: Partial<MemoryTask> & { id: string; title: string }): MemoryTask {
  return {
    description: null,
    companyId: COMPANY_A,
    companyName: 'Agência Ide',
    boardId: LIST_A,
    clientId: null,
    clientName: null,
    statusId: 'aberto',
    dueOn: null,
    people: [],
    ...over,
  };
}

const TAREFAS: MemoryTask[] = [
  tarefa({ id: 't-atrasada', title: 'Atrasada de vídeo', dueOn: '2026-10-05', type: 'video', priority: 'high', people: [{ id: HELENA, name: 'Helena' }], createdBy: { id: CARLA, name: 'Carla' } }),
  tarefa({ id: 't-hoje', title: 'Vence hoje', dueOn: '2026-10-08', type: 'arte', statusId: 'fazendo', people: [{ id: HELENA, name: 'Helena' }, { id: CARLA, name: 'Carla' }], createdBy: { id: HELENA, name: 'Helena' } }),
  tarefa({ id: 't-futura', title: 'Vence na semana que vem', dueOn: '2026-10-15', type: 'foto', createdBy: { id: CARLA, name: 'Carla' } }),
  tarefa({ id: 't-sem-prazo', title: 'Sem prazo', type: 'outros' }),
  tarefa({ id: 't-feita-atrasada', title: 'Feita com prazo antigo', dueOn: '2026-10-01', statusId: 'feito', completedAt: '2026-10-02T12:00:00.000Z', people: [{ id: CARLA, name: 'Carla' }] }),
  tarefa({ id: 't-sonho', title: 'Do Sabor Doce', boardId: LIST_A2, dueOn: '2026-10-03', type: 'arte', clientId: CLIENT_A2, clientName: 'Sabor Doce' }),
  tarefa({ id: 't-estudio', title: 'Do estúdio', boardId: LIST_ESTUDIO, clientId: CLIENT_A, clientName: 'Jatobá', dueOn: '2026-10-04', type: 'video' }),
  tarefa({ id: 't-filmes', title: 'Da Filmes', boardId: LIST_B, companyId: COMPANY_B, companyName: 'Ide Filmes', dueOn: '2026-10-02' }),
  tarefa({ id: 't-alma', title: 'Da Alma', boardId: LIST_ALMA, companyId: COMPANY_ALMA, companyName: 'Alma Nove', dueOn: '2026-10-02' }),
  tarefa({ id: 't-zeca', title: 'Do cliente cancelado', boardId: LIST_ZECA, dueOn: '2026-10-02' }),
  tarefa({ id: 't-arquivada', title: 'Arquivada', archivedAt: '2026-10-01T10:00:00.000Z', dueOn: '2026-10-01' }),
];

const WORK = new MemoryWorkCatalog({ boards: BOARDS, clients: CLIENTES, tasks: TAREFAS });
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

async function boards(input: Parameters<typeof listBoardsWork>[1], c = ctx()) {
  const r = await listBoardsWork(c, input);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.body;
}
async function tasks(input: Parameters<typeof listTasksWork>[1], c = ctx()) {
  const r = await listTasksWork(c, input);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.body;
}
const ids = (body: { tasks: Array<{ id: string }> }) => body.tasks.map((t) => t.id);

describe('cliente de empresa omitida em linha de empresa em escopo (o dublê faz o que o SQL faz)', () => {
  // Lista da Ide ligada ao cliente da Alma Nove, e tarefa de lista da Ide com cliente próprio da Alma Nove.
  const LISTA_CRUZADA = '50000000-0000-4000-8000-0000000000aa';
  const work = new MemoryWorkCatalog({
    boards: [
      ...BOARDS,
      lista(LISTA_CRUZADA, 'Lista da Ide ligada à Alma', COMPANY_A, SPACE_1, 'CLIENTES', {
        clientId: CLIENT_ALMA,
        clientName: 'Cliente Alma',
      }),
    ],
    clients: CLIENTES,
    tasks: [
      ...TAREFAS,
      tarefa({ id: 't-cruzada', title: 'Briefing cruzado', boardId: LIST_ESTUDIO, clientId: CLIENT_ALMA, clientName: 'Cliente Alma' }),
    ],
  });

  it('list_tasks e list_boards: a linha fica, o cliente da empresa omitida sai (id e nome)', async () => {
    const t = await tasks({}, ctx(grant(), SEM_ALMA, work));
    expect(t.tasks.find((x) => x.id === 't-cruzada')?.client).toBeNull();
    expect(JSON.stringify(t)).not.toContain('Cliente Alma');
    expect(JSON.stringify(t)).not.toContain(CLIENT_ALMA);
    const b = await boards({}, ctx(grant(), SEM_ALMA, work));
    expect(b.boards.find((x) => x.id === LISTA_CRUZADA)?.client).toBeNull();
    expect(JSON.stringify(b)).not.toContain(CLIENT_ALMA);
    // Sem omissão o cliente aparece: a regra é a omissão.
    expect((await tasks({}, ctx(grant(), SUPER, work))).tasks.find((x) => x.id === 't-cruzada')?.client).toEqual({
      id: CLIENT_ALMA,
      name: 'Cliente Alma',
    });
  });

  it('o filtro clientId do cliente da empresa omitida não acha a tarefa', async () => {
    expect((await tasks({ clientId: CLIENT_ALMA }, ctx(grant(), SEM_ALMA, work))).tasks).toEqual([]);
  });
});

describe('contêiner de cliente cancelado: not_found, como list_boards o esconde', () => {
  it('list_tasks por listId e spaceId de cliente cancelado não é "ok, total 0"', async () => {
    // A lista do Zeca está no espaço CLIENTES, que também tem listas de cliente ativo: o espaço lê, a lista não.
    expect(await listTasksWork(ctx(), { listId: LIST_ZECA })).toMatchObject({ ok: false, code: 'not_found' });
    expect((await listTasksWork(ctx(), { spaceId: SPACE_1 })).ok).toBe(true);
    // Um espaço só com a lista do cliente cancelado também não existe para a leitura.
    const so = new MemoryWorkCatalog({
      boards: [lista(LIST_ZECA, 'Zeca', COMPANY_A, SPACE_1, 'CLIENTES', { clientId: CLIENT_ZECA, clientName: 'Zeca' })],
      clients: CLIENTES,
    });
    expect(await listTasksWork(ctx(grant(), SUPER, so), { spaceId: SPACE_1 })).toMatchObject({ ok: false, code: 'not_found' });
  });
});

describe('list_boards — a leitura', () => {
  it('as listas vivas do recorte, por espaço, pasta e nome, com cliente, "exige cliente" e produção', async () => {
    const body = await boards({});
    expect(body.operation).toBe('list_boards');
    expect(body.boards.map((b) => b.id)).toEqual([LIST_ALMA, LIST_A, LIST_A2, LIST_ESTUDIO, LIST_B]);
    expect(body.total).toBe(5);
    expect(body.boards.find((b) => b.id === LIST_A)).toEqual({
      id: LIST_A,
      name: 'Atendimento',
      space: { id: SPACE_1, name: 'CLIENTES' },
      folder: { id: FOLDER_1, name: 'TIME HELENA' },
      company: { id: COMPANY_A, name: 'Agência Ide' },
      client: { id: CLIENT_A, name: 'Jatobá' },
      requiresClient: false,
      isProduction: true,
      archived: false,
    });
    expect(body.boards.find((b) => b.id === LIST_ESTUDIO)).toMatchObject({
      folder: null,
      client: null,
      requiresClient: true,
      isProduction: false,
    });
    expect(body.boards.find((b) => b.id === LIST_A2)?.isProduction).toBe(false);
  });

  it('includeArchived traz as arquivadas; a lista de cliente cancelado nunca vem', async () => {
    const com = await boards({ includeArchived: true });
    expect(com.boards.map((b) => b.id)).toContain(LIST_ARQUIVADA);
    expect(com.boards.find((b) => b.id === LIST_ARQUIVADA)?.archived).toBe(true);
    expect(JSON.stringify(com)).not.toContain('Zeca');
    expect(com.total).toBe(6);
    expect((await boards({})).boards.map((b) => b.id)).not.toContain(LIST_ARQUIVADA);
  });

  it('filtros: empresa, espaço, pasta e cliente', async () => {
    expect((await boards({ companyId: COMPANY_B })).boards.map((b) => b.id)).toEqual([LIST_B]);
    expect((await boards({ spaceId: SPACE_2 })).boards.map((b) => b.id)).toEqual([LIST_ESTUDIO]);
    expect((await boards({ folderId: FOLDER_1 })).boards.map((b) => b.id)).toEqual([LIST_A, LIST_A2]);
    expect((await boards({ clientId: CLIENT_A2 })).boards.map((b) => b.id)).toEqual([LIST_A2]);
    const nada = await boards({ folderId: '99999999-9999-4999-8999-999999999999' });
    expect(nada.boards).toEqual([]);
    expect(nada.total).toBe(0);
    expect((await boards({ folderId: FOLDER_1 })).self).toBe(`${LIST_BOARDS_PATH}?folderId=${FOLDER_1}`);
  });

  it('outra empresa, outro cliente da mesma empresa e empresa omitida: nunca aparecem', async () => {
    const soA = await boards({}, ctx(grant({ allowedCompanyIds: [COMPANY_A] })));
    expect(soA.boards.map((b) => b.id)).toEqual([LIST_A, LIST_A2, LIST_ESTUDIO]);
    expect(JSON.stringify(soA)).not.toMatch(/Filmes|Alma/);
    // Concessão por cliente: a lista dele e as sem cliente (compartilhadas), não a do vizinho.
    const soClienteA = await boards({}, ctx(grant({ allowedClientIds: [CLIENT_A] })));
    expect(soClienteA.boards.map((b) => b.id)).toEqual([LIST_A, LIST_ESTUDIO]);
    expect(JSON.stringify(soClienteA)).not.toContain('Sabor Doce');
    const semAlma = await boards({}, ctx(grant(), SEM_ALMA));
    expect(semAlma.boards.map((b) => b.id)).not.toContain(LIST_ALMA);
    expect(JSON.stringify(semAlma)).not.toContain('Alma');
    // Pedir pelo filtro uma empresa de fora é lista vazia, a mesma de uma empresa sem lista.
    expect((await boards({ companyId: COMPANY_B }, ctx(grant({ allowedCompanyIds: [COMPANY_A] })))).boards).toEqual([]);
  });

  it('a pessoa que alcança só um cliente (não o topo): vê a lista dele e as compartilhadas, não a do vizinho nem a de outra empresa', async () => {
    const body = await boards({}, ctx(grant(), SO_O_JATOBA));
    expect(body.boards.map((b) => b.id)).toEqual([LIST_A, LIST_ESTUDIO]);
    expect(JSON.stringify(body)).not.toMatch(/Sabor Doce|Filmes|Alma/);
  });

  it('sem clients:read o nome do cliente some (o id fica, como no get_board); sem boards:read, permission_denied', async () => {
    const semClientes = await boards({}, ctx(sem('clients:read')));
    expect(semClientes.boards.find((b) => b.id === LIST_A)?.client).toEqual({ id: CLIENT_A, name: null });
    expect(JSON.stringify(semClientes)).not.toContain('Jatobá');
    expect(await listBoardsWork(ctx(sem('boards:read')), {})).toEqual(NEGADO);
    expect(await listBoardsWork(ctx(sem('boards:read')), { limit: 0 })).toEqual(NEGADO);
  });

  it('limite e cursor ruins são recusados', async () => {
    expect((await listBoardsWork(ctx(), { limit: 101 })).ok).toBe(false);
    const cursor = await listBoardsWork(ctx(), { cursor: 'lixo!' });
    expect(cursor.ok === false && cursor.code).toBe('invalid_cursor');
  });

  it('o cursor anda até o fim, na ordem da árvore, dentro dos 64 KiB', async () => {
    const MUITAS = Array.from({ length: 400 }, (_, n) =>
      lista(
        `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        `Lista de nome comprido para pesar no corpo número ${String(n).padStart(3, '0')}`,
        COMPANY_A,
        SPACE_1,
        'CLIENTES',
        { folderId: FOLDER_1, folderName: 'TIME HELENA', clientId: CLIENT_A, clientName: 'Jatobá' },
      ),
    );
    const work = new MemoryWorkCatalog({ boards: MUITAS, clients: CLIENTES });
    const vistas: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const pagina = await boards({ limit: 100, cursor }, ctx(grant(), SUPER, work));
      expect(measureJsonBytes(pagina)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      expect(pagina.total).toBe(400);
      vistas.push(...pagina.boards.map((b) => b.id));
      cursor = pagina.nextCursor ?? undefined;
      expect(pagina.hasMore).toBe(cursor !== undefined);
      paginas += 1;
    } while (cursor !== undefined && paginas < 30);
    expect(vistas).toEqual(MUITAS.map((b) => b.id));
  });
});

describe('list_tasks — os filtros', () => {
  it('sem filtro: todas as abertas e fechadas do recorte, por título; arquivada, de outra empresa e de cliente cancelado ficam de fora do que a concessão não alcança', async () => {
    const body = await tasks({});
    expect(body.operation).toBe('list_tasks');
    expect(body.today).toBe('2026-10-08');
    // A concessão do topo vê as 3 empresas; só a arquivada e a de cliente cancelado saem.
    const porTitulo = [...TAREFAS]
      .filter((t) => !t.archivedAt && t.id !== 't-zeca')
      .sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0))
      .map((t) => t.id);
    expect(ids(body)).toEqual(porTitulo);
    expect(body.total).toBe(9);
    expect(ids(body)).not.toContain('t-arquivada');
    expect(ids(body)).not.toContain('t-zeca');
  });

  it('cada tarefa leva etapa, prioridade, tipo, prazo, lista, cliente e responsáveis', async () => {
    const body = await tasks({ listId: LIST_A, overdue: true });
    expect(body.tasks).toEqual([
      {
        id: 't-atrasada',
        title: 'Atrasada de vídeo',
        statusId: 'aberto',
        statusName: 'A fazer',
        statusType: 'unstarted',
        priority: 'high',
        type: 'video',
        dueOn: '2026-10-05',
        startOn: null,
        completedAt: null,
        list: { id: LIST_A, name: 'Atendimento' },
        client: { id: CLIENT_A, name: 'Jatobá' },
        people: [{ id: HELENA, name: 'Helena' }],
      },
    ]);
  });

  it('overdue: prazo antes de hoje e sem conclusão (a feita com prazo antigo não conta; a de hoje também não)', async () => {
    expect(ids(await tasks({ overdue: true }))).toEqual(
      expect.arrayContaining(['t-atrasada', 't-sonho', 't-estudio']),
    );
    expect(ids(await tasks({ overdue: true }))).not.toContain('t-feita-atrasada');
    expect(ids(await tasks({ overdue: true }))).not.toContain('t-hoje');
    expect(ids(await tasks({ overdue: true, listId: LIST_A }))).toEqual(['t-atrasada']);
  });

  it('dueBefore é exclusivo e não pega tarefa sem prazo', async () => {
    expect(ids(await tasks({ listId: LIST_A, dueBefore: '2026-10-08' })).sort()).toEqual(['t-atrasada', 't-feita-atrasada']);
    expect(ids(await tasks({ listId: LIST_A, dueBefore: '2026-10-09' })).sort()).toEqual(['t-atrasada', 't-feita-atrasada', 't-hoje']);
  });

  it('completed, statusType, type e clientId', async () => {
    expect(ids(await tasks({ listId: LIST_A, completed: true }))).toEqual(['t-feita-atrasada']);
    expect(ids(await tasks({ listId: LIST_A, completed: false })).sort()).toEqual(['t-atrasada', 't-futura', 't-hoje', 't-sem-prazo']);
    expect(ids(await tasks({ listId: LIST_A, statusType: 'custom' }))).toEqual(['t-hoje']);
    expect(ids(await tasks({ listId: LIST_A, statusType: 'done' }))).toEqual(['t-feita-atrasada']);
    expect(ids(await tasks({ listId: LIST_A, type: 'foto' }))).toEqual(['t-futura']);
    expect(ids(await tasks({ clientId: CLIENT_A })).sort()).toEqual(
      ['t-atrasada', 't-feita-atrasada', 't-hoje', 't-futura', 't-sem-prazo', 't-estudio'].sort(),
    );
    expect(ids(await tasks({ clientId: CLIENT_A2 })).sort()).toEqual(['t-sonho']);
  });

  it('assigneeId e createdBy (a fila e o "delegado")', async () => {
    expect(ids(await tasks({ assigneeId: HELENA })).sort()).toEqual(['t-atrasada', 't-hoje']);
    expect(ids(await tasks({ assigneeId: CARLA })).sort()).toEqual(['t-feita-atrasada', 't-hoje']);
    expect(ids(await tasks({ createdBy: CARLA })).sort()).toEqual(['t-atrasada', 't-futura']);
    // Os filtros somam: criadas pela Carla e atrasadas.
    expect(ids(await tasks({ createdBy: CARLA, overdue: true }))).toEqual(['t-atrasada']);
  });

  it('pasta e espaço: as listas dentro dela', async () => {
    expect(ids(await tasks({ folderId: FOLDER_1 })).sort()).toEqual(
      ['t-atrasada', 't-feita-atrasada', 't-futura', 't-hoje', 't-sem-prazo', 't-sonho'].sort(),
    );
    expect(ids(await tasks({ spaceId: SPACE_2 }))).toEqual(['t-estudio']);
    expect((await tasks({ folderId: FOLDER_1, overdue: true })).total).toBe(2);
  });

  it('total conta o filtro inteiro, não só a página', async () => {
    const pagina = await tasks({ folderId: FOLDER_1, limit: 2 });
    expect(pagina.tasks).toHaveLength(2);
    expect(pagina.total).toBe(6);
    expect(pagina.hasMore).toBe(true);
  });

  it('self carrega os filtros (sem limit nem cursor)', async () => {
    const body = await tasks({ listId: LIST_A, overdue: true });
    expect(body.self).toBe(`${LIST_TASKS_PATH}?listId=${LIST_A}&overdue=true`);
  });
});

describe('list_tasks — o recorte e a projeção', () => {
  it('outra empresa, outro cliente da mesma empresa e empresa omitida: nunca aparecem', async () => {
    const soA = await tasks({}, ctx(grant({ allowedCompanyIds: [COMPANY_A] })));
    expect(ids(soA)).not.toContain('t-filmes');
    expect(ids(soA)).not.toContain('t-alma');
    expect(soA.total).toBe(7);
    const soClienteA = await tasks({}, ctx(grant({ allowedClientIds: [CLIENT_A] })));
    expect(ids(soClienteA)).not.toContain('t-sonho');
    expect(ids(soClienteA)).toContain('t-estudio');
    const semAlma = await tasks({}, ctx(grant(), SEM_ALMA));
    expect(ids(semAlma)).not.toContain('t-alma');
    expect(JSON.stringify(semAlma)).not.toContain('Alma');
    expect(semAlma.total).toBe(8);
  });

  it('a pessoa que alcança só um cliente (não o topo): suas tarefas e as sem cliente, não as do vizinho', async () => {
    const body = await tasks({}, ctx(grant(), SO_O_JATOBA));
    expect(ids(body)).toContain('t-atrasada');
    expect(ids(body)).toContain('t-estudio');
    expect(ids(body)).not.toContain('t-sonho');
    expect(ids(body)).not.toContain('t-filmes');
    expect(ids(body)).not.toContain('t-alma');
    const naoAchado = { ok: false, code: 'not_found', message: 'Espaço, pasta ou lista não encontrado neste recorte.' };
    expect(await listTasksWork(ctx(grant(), SO_O_JATOBA), { listId: LIST_A2 })).toEqual(naoAchado);
  });

  it('espaço, pasta ou lista fora do recorte, omitido ou inexistente: not_found, a mesma resposta', async () => {
    const naoAchado = { ok: false, code: 'not_found', message: 'Espaço, pasta ou lista não encontrado neste recorte.' };
    const soA = ctx(grant({ allowedCompanyIds: [COMPANY_A] }));
    expect(await listTasksWork(soA, { listId: LIST_B })).toEqual(naoAchado);
    expect(await listTasksWork(soA, { spaceId: SPACE_B })).toEqual(naoAchado);
    expect(await listTasksWork(ctx(grant(), SEM_ALMA), { listId: LIST_ALMA })).toEqual(naoAchado);
    expect(await listTasksWork(ctx(grant(), SEM_ALMA), { spaceId: SPACE_ALMA })).toEqual(naoAchado);
    expect(await listTasksWork(ctx(), { listId: '99999999-9999-4999-8999-999999999999' })).toEqual(naoAchado);
    // Lista de outro cliente da mesma empresa.
    expect(await listTasksWork(ctx(grant({ allowedClientIds: [CLIENT_A] })), { listId: LIST_A2 })).toEqual(naoAchado);
  });

  it('mais de um de spaceId, folderId e listId é invalid_input', async () => {
    const r = await listTasksWork(ctx(), { spaceId: SPACE_1, listId: LIST_A });
    expect(r.ok === false && r.code).toBe('invalid_input');
  });

  it('sem tasks:read: permission_denied; assigneeId e createdBy sem people:read: permission_denied', async () => {
    expect(await listTasksWork(ctx(sem('tasks:read')), {})).toEqual(NEGADO);
    expect(await listTasksWork(ctx(sem('people:read')), { assigneeId: HELENA })).toEqual(NEGADO);
    expect(await listTasksWork(ctx(sem('people:read')), { createdBy: CARLA })).toEqual(NEGADO);
    expect((await listTasksWork(ctx(sem('people:read')), { overdue: true })).ok).toBe(true);
  });

  it('sem people:read os responsáveis são null; sem clients:read o nome do cliente some; sem boards:read o da lista', async () => {
    const semPessoas = await tasks({ listId: LIST_A, overdue: true }, ctx(sem('people:read')));
    expect(semPessoas.tasks[0]?.people).toBeNull();
    expect(JSON.stringify(semPessoas)).not.toContain('Helena');
    const semClientes = await tasks({ listId: LIST_A, overdue: true }, ctx(sem('clients:read')));
    expect(semClientes.tasks[0]?.client).toEqual({ id: CLIENT_A, name: null });
    const semQuadros = await tasks({ listId: LIST_A, overdue: true }, ctx(sem('boards:read')));
    expect(semQuadros.tasks[0]?.list).toEqual({ id: LIST_A, name: null });
  });

  it('limite e cursor ruins são recusados', async () => {
    expect((await listTasksWork(ctx(), { limit: 101 })).ok).toBe(false);
    const cursor = await listTasksWork(ctx(), { cursor: 'lixo!' });
    expect(cursor.ok === false && cursor.code).toBe('invalid_cursor');
  });
});

describe('list_tasks — paginação e orçamento', () => {
  const MUITAS: MemoryTask[] = Array.from({ length: 450 }, (_, n) =>
    tarefa({
      id: `t-${String(n).padStart(3, '0')}`,
      title: `Tarefa de título comprido para pesar no corpo da resposta número ${String(n).padStart(3, '0')}`,
      dueOn: n % 2 === 0 ? '2026-10-01' : '2026-10-30',
      people: [{ id: HELENA, name: 'Helena' }],
      clientId: CLIENT_A,
      clientName: 'Jatobá',
    }),
  );
  const work = new MemoryWorkCatalog({ boards: BOARDS, clients: CLIENTES, tasks: MUITAS });

  it('o cursor anda até o fim: cada página cabe em 64 KiB, traz todas uma vez só e o total é o do filtro', async () => {
    const vistas: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const pagina = await tasks({ listId: LIST_A, limit: 100, cursor }, ctx(grant(), SUPER, work));
      expect(measureJsonBytes(pagina)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      expect(pagina.total).toBe(450);
      vistas.push(...pagina.tasks.map((t) => t.id));
      cursor = pagina.nextCursor ?? undefined;
      expect(pagina.hasMore).toBe(cursor !== undefined);
      paginas += 1;
    } while (cursor !== undefined && paginas < 30);
    expect(vistas).toHaveLength(450);
    expect(new Set(vistas).size).toBe(450);
    expect(paginas).toBeGreaterThan(3);
  });

  it('com filtro, o cursor continua no filtro: só as atrasadas, uma vez cada', async () => {
    const vistas: string[] = [];
    let cursor: string | undefined;
    do {
      const pagina = await tasks({ overdue: true, limit: 60, cursor }, ctx(grant(), SUPER, work));
      expect(pagina.total).toBe(225);
      vistas.push(...pagina.tasks.map((t) => t.id));
      cursor = pagina.nextCursor ?? undefined;
    } while (cursor);
    expect(vistas).toHaveLength(225);
    expect(new Set(vistas).size).toBe(225);
  });
});

describe('list_boards e list_tasks — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley']]));

  it('OpenAPI publica GET e POST, schemas iguais ao Zod e exemplos válidos; entrada estrita', () => {
    const doc = integrationOpenApi() as {
      info: { description: string };
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    for (const caminho of ['/list_boards', '/list_tasks']) {
      expect(Object.keys(doc.paths[caminho] ?? {}).sort()).toEqual(['get', 'post']);
    }
    expect(doc.components.schemas.ListBoardsInput).toEqual(jsonSchemaFromZod(listBoardsInputSchema));
    expect(doc.components.schemas.ListBoardsResponse).toEqual(jsonSchemaFromZod(listBoardsResponseSchema));
    expect(doc.components.schemas.ListTasksInput).toEqual(jsonSchemaFromZod(listTasksInputSchema));
    expect(doc.components.schemas.ListTasksResponse).toEqual(jsonSchemaFromZod(listTasksResponseSchema));
    expect(doc.info.description).toContain('list_boards');
    expect(doc.info.description).toContain('list_tasks');
    expect(listBoardsResponseSchema.parse(listBoardsOpenApiExample()).boards.length).toBeGreaterThan(0);
    expect(listTasksResponseSchema.parse(listTasksOpenApiExample()).tasks.length).toBeGreaterThan(0);

    expect(listBoardsInputSchema.safeParse({ includeArchived: true, folderId: FOLDER_1 }).success).toBe(true);
    expect(listBoardsInputSchema.safeParse({ folderId: 'nao-e-uuid' }).success).toBe(false);
    expect(listBoardsInputSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(listTasksInputSchema.safeParse({ overdue: true, statusType: 'done', type: 'video', dueBefore: '2026-10-31' }).success).toBe(true);
    expect(listTasksInputSchema.safeParse({ overdue: 'sim' }).success).toBe(false);
    expect(listTasksInputSchema.safeParse({ statusType: 'pronto' }).success).toBe(false);
    expect(listTasksInputSchema.safeParse({ dueBefore: '31/10/2026' }).success).toBe(false);
    expect(listTasksInputSchema.safeParse({ assigneeId: 'x' }).success).toBe(false);
    expect(listTasksInputSchema.safeParse({ extra: 1 }).success).toBe(false);
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

  it('list_boards: HTTP GET (includeArchived=true na query), POST, MCP e a função devolvem o mesmo corpo', async () => {
    const direto = await boards({ includeArchived: true });
    const get = await http(`${LIST_BOARDS_PATH}?includeArchived=true`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);
    const post = await http(LIST_BOARDS_PATH, grant(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeArchived: true }),
    });
    expect(await post.json()).toEqual(direto);
    const mcp = await callTool('list_boards', { includeArchived: true });
    expect(mcp.structuredContent).toEqual(direto);
    expect(mcp.content[0]?.text).toContain('6 lista(s)');
  });

  it('list_tasks: HTTP GET (overdue=true na query), POST, MCP e a função devolvem o mesmo corpo', async () => {
    const direto = await tasks({ folderId: FOLDER_1, overdue: true });
    const get = await http(`${LIST_TASKS_PATH}?folderId=${FOLDER_1}&overdue=true`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);
    const post = await http(LIST_TASKS_PATH, grant(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: FOLDER_1, overdue: true }),
    });
    expect(await post.json()).toEqual(direto);
    const mcp = await callTool('list_tasks', { folderId: FOLDER_1, overdue: true });
    expect(mcp.structuredContent).toEqual(direto);
    expect(mcp.content[0]?.text).toContain('2 tarefa(s) no filtro');
  });

  it('HTTP e MCP: 403 sem a capacidade, 400 com entrada inválida, 404 fora do recorte', async () => {
    expect((await http(LIST_BOARDS_PATH, sem('boards:read'))).status).toBe(403);
    expect((await http(LIST_TASKS_PATH, sem('tasks:read'))).status).toBe(403);
    expect((await http(`${LIST_TASKS_PATH}?assigneeId=${HELENA}`, sem('people:read'))).status).toBe(403);
    for (const ruim of ['overdue=sim', 'statusType=pronto', 'foo=1', 'dueBefore=amanha', 'dueBefore=2026-02-30']) {
      expect((await http(`${LIST_TASKS_PATH}?${ruim}`)).status).toBe(400);
    }
    // Dia que passa pela forma mas não existe: recusa de entrada, no HTTP e no MCP, nunca erro interno.
    const diaImpossivel = await http(`${LIST_TASKS_PATH}?dueBefore=2026-02-30`);
    expect(((await diaImpossivel.json()) as { error: string }).error).toBe('invalid_input');
    const diaImpossivelMcp = await callTool('list_tasks', { dueBefore: '2026-02-30' });
    expect(diaImpossivelMcp.isError).toBe(true);
    expect((JSON.parse(diaImpossivelMcp.content[0]?.text ?? '{}') as { error: string }).error).toBe('invalid_input');
    expect((await http(`${LIST_BOARDS_PATH}?includeArchived=talvez`)).status).toBe(400);
    expect((await http(`${LIST_TASKS_PATH}?spaceId=${SPACE_1}&listId=${LIST_A}`)).status).toBe(400);
    const fora = await http(`${LIST_TASKS_PATH}?listId=${LIST_B}`, grant({ allowedCompanyIds: [COMPANY_A] }));
    expect(fora.status).toBe(404);
    const cursor = await http(`${LIST_TASKS_PATH}?cursor=lixo!`);
    expect(((await cursor.json()) as { error: string }).error).toBe('invalid_cursor');

    const semCap = await callTool('list_tasks', {}, sem('tasks:read'));
    expect(semCap.isError).toBe(true);
    expect((JSON.parse(semCap.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');
    const foraMcp = await callTool('list_tasks', { listId: LIST_B }, grant({ allowedCompanyIds: [COMPANY_A] }));
    expect((JSON.parse(foraMcp.content[0]?.text ?? '{}') as { error: string }).error).toBe('not_found');
    expect((await callTool('list_boards', { foo: 1 })).isError).toBe(true);
    expect((await callTool('list_tasks', { overdue: 'sim' })).isError).toBe(true);
  });
});
