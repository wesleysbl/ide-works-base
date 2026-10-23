/**
 * `list_boards` e `list_tasks` CONTRA UM POSTGRES DE VERDADE — conferência de 08/10/2026, G11.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   `SqlWorkCatalog.listBoards` e `SqlWorkCatalog.listTasks` sobre o PGlite, com o
 *   recorte montado pelo caminho de produção (`toWorkScope` dentro de
 *   `listBoardsWork`/`listTasksWork`):
 *     · cada filtro (lista, pasta, espaço, responsável, criador, etapa, tipo,
 *       prazo, atrasadas, cliente, concluídas) e o total do filtro inteiro;
 *     · empresa omitida, empresa e cliente fora da concessão, cliente cancelado
 *       e tarefa arquivada não saem — o recorte é cláusula do `where`;
 *     · espaço, pasta ou lista fora do recorte é `not_found`;
 *     · o cursor anda até o fim; responsável só vem com `people:read`.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha e as funções de concessão reais: aqui dizem "sim".
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IntegrationCapability, IntegrationGrant, PersonAccess } from '@/integrations/grants';
import type { Tx } from '@/server/db';

type Fragmento = { readonly dublê: true; readonly strings: readonly string[]; readonly args: readonly unknown[] };
const ehFragmento = (v: unknown): v is Fragmento =>
  typeof v === 'object' && v !== null && (v as Fragmento).dublê === true;

function montar(f: Fragmento, params: unknown[]): string {
  let texto = f.strings[0] ?? '';
  f.args.forEach((a, i) => {
    if (ehFragmento(a)) texto += montar(a, params);
    else {
      params.push(a);
      texto += `$${params.length}`;
    }
    texto += f.strings[i + 1] ?? '';
  });
  return texto;
}

let db: PGlite;
let textos: string[] = [];

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      const texto = montar(f, params);
      textos.push(texto);
      return db.query(texto, params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) };

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (s: unknown) => Promise<unknown>) => work(sql),
}));

const { listBoardsWork, listTasksWork } = await import('@/integrations/reads');
const { SqlWorkCatalog } = await import('@/integrations/sql-work');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDE = id(1);
const FILMES = id(2);
const ALMA = id(3);
const C_A = id(10);
const C_A2 = id(11);
const C_FILMES = id(12);
const C_ALMA = id(13);
const C_ZECA = id(14);
const S_CLIENTES = id(20);
const S_ESTUDIO = id(21);
const S_FILMES = id(22);
const S_ALMA = id(23);
const F_HELENA = id(30);
const L_A = id(40);
const L_A2 = id(41);
const L_ESTUDIO = id(42);
const L_FILMES = id(43);
const L_ALMA = id(44);
const L_ARQUIVADA = id(45);
const L_ZECA = id(46);
const ST_AFAZER = id(50);
const ST_FAZENDO = id(51);
const ST_FEITO = id(52);
const ST_ATRIBUIR = id(53);
const ST_ALMA = id(54);
const HELENA = id(91);
const CARLA = id(92);
const EU = id(99);

const AGORA = new Date('2026-10-08T12:00:00Z');
const ATOR = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };
const TODAS: IntegrationCapability[] = ['boards:read', 'tasks:read', 'clients:read', 'people:read'];

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: id(200),
  ownerId: EU,
  oauthClientId: 'cliente-oauth',
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
const topo: PersonAccess = {
  userId: EU,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [IDE, FILMES, ALMA],
  clientIds: [],
  hasAllClientsAccess: true,
};
const semAlma: PersonAccess = { ...topo, omittedCompanyIds: [ALMA] };

const ctxDe = (g: IntegrationGrant, pessoa: PersonAccess = topo) => ({
  grant: g,
  person: pessoa,
  origin: 'http' as const,
  companies: [],
  displayName: 'Wesley',
  work: new SqlWorkCatalog({} as never, ATOR as never),
  now: AGORA,
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create type ideworks.status_type as enum ('open', 'unstarted', 'custom', 'done', 'closed');
    create type ideworks.task_priority as enum ('urgent', 'high', 'normal', 'low');
    create type ideworks.task_demand_type as enum ('video', 'arte', 'foto', 'outros');
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid,
      is_active boolean default true, inactive_at timestamptz);
    create table ideworks.people(id uuid primary key, name text);
    create function ideworks.display_name(u uuid) returns text language sql as
      $$ select name from ideworks.people where id = u $$;
    create function ideworks.integration_allows_company(c uuid) returns boolean language sql as $$ select true $$;
    create function ideworks.integration_allows_client(c uuid) returns boolean language sql as $$ select true $$;
    create table ideworks.spaces(id uuid primary key, category_id uuid, name text, archived_at timestamptz);
    create table ideworks.folders(id uuid primary key, space_id uuid, name text, archived_at timestamptz);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, client_id uuid,
      archived_at timestamptz, requires_client boolean not null default false);
    create view ideworks.tree as
      select l.id as list_id, l.name as list_name, s.id as space_id, s.name as space_name,
             f.id as folder_id, f.name as folder_name, s.category_id,
             (s.archived_at is null and l.archived_at is null) as is_live
        from ideworks.lists l
        join ideworks.spaces s on s.id = l.space_id
        left join ideworks.folders f on f.id = l.folder_id;
    create table ideworks.statuses(id uuid primary key, space_id uuid, name text, type ideworks.status_type, sort_order int);
    create view ideworks.list_workflow as
      select l.id as list_id, st.id as status_id, st.name as status_name, st.type as status_type,
             st.sort_order as status_sort_order
        from ideworks.lists l join ideworks.statuses st on st.space_id = l.space_id;
    -- A regra do banco: a esteira efetiva tem a etapa "atribuir demanda".
    create function ideworks.list_is_production(p_list_id uuid) returns boolean language sql stable as $$
      select exists (select 1 from ideworks.list_workflow lw
                      where lw.list_id = p_list_id and lower(btrim(lw.status_name)) = 'atribuir demanda')
    $$;
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, title text, description text,
      due_on date, start_on date, priority ideworks.task_priority, demand_type ideworks.task_demand_type,
      status_id uuid, archived_at timestamptz, completed_at timestamptz, parent_id uuid,
      created_at timestamptz not null default now(), created_by uuid, completed_by uuid, via_name text);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);

    insert into ideworks.client_categories values ('${IDE}', 'Ide'), ('${FILMES}', 'Filmes'), ('${ALMA}', 'Alma9');
    insert into ideworks.people values ('${HELENA}', 'Helena'), ('${CARLA}', 'Carla'), ('${EU}', 'Wesley');
    insert into ideworks.clients values
      ('${C_A}', 'Jatobá', '${IDE}', true, null),
      ('${C_A2}', 'Sabor Doce', '${IDE}', true, null),
      ('${C_FILMES}', 'Cliente Filmes', '${FILMES}', true, null),
      ('${C_ALMA}', 'Cliente Alma', '${ALMA}', true, null),
      ('${C_ZECA}', 'Zeca', '${IDE}', false, '2026-10-04T12:00:00Z');
    insert into ideworks.spaces values
      ('${S_CLIENTES}', '${IDE}', 'CLIENTES', null), ('${S_ESTUDIO}', '${IDE}', 'Estúdio Ide', null),
      ('${S_FILMES}', '${FILMES}', 'Produção', null), ('${S_ALMA}', '${ALMA}', 'Alma', null);
    insert into ideworks.folders values ('${F_HELENA}', '${S_CLIENTES}', 'TIME HELENA', null);
    insert into ideworks.lists(id, space_id, folder_id, name, client_id, archived_at, requires_client) values
      ('${L_A}', '${S_CLIENTES}', '${F_HELENA}', 'Atendimento', '${C_A}', null, false),
      ('${L_A2}', '${S_CLIENTES}', '${F_HELENA}', 'Atendimento', '${C_A2}', null, false),
      ('${L_ESTUDIO}', '${S_ESTUDIO}', null, 'ESTÚDIO', null, null, true),
      ('${L_FILMES}', '${S_FILMES}', null, 'Filmes', '${C_FILMES}', null, false),
      ('${L_ALMA}', '${S_ALMA}', null, 'Lista da Alma', '${C_ALMA}', null, false),
      ('${L_ARQUIVADA}', '${S_ESTUDIO}', null, 'Antiga', null, '2026-09-01T10:00:00Z', false),
      ('${L_ZECA}', '${S_CLIENTES}', null, 'Zeca', '${C_ZECA}', null, false);
    insert into ideworks.statuses values
      ('${ST_ATRIBUIR}', '${S_CLIENTES}', 'Atribuir demanda', 'open', 0),
      ('${ST_AFAZER}', '${S_CLIENTES}', 'A fazer', 'unstarted', 1),
      ('${ST_FAZENDO}', '${S_CLIENTES}', 'Em produção', 'custom', 2),
      ('${ST_FEITO}', '${S_CLIENTES}', 'Feito', 'done', 3),
      (gen_random_uuid(), '${S_ESTUDIO}', 'A fazer', 'unstarted', 1),
      (gen_random_uuid(), '${S_FILMES}', 'A fazer', 'unstarted', 1),
      ('${ST_ALMA}', '${S_ALMA}', 'Pauta Alma', 'open', 1);

    insert into ideworks.tasks(id, list_id, client_id, title, status_id, due_on, demand_type, priority, completed_at, created_by, archived_at) values
      ('${id(60)}', '${L_A}', null, 'Atrasada de vídeo', '${ST_AFAZER}', '2026-10-05', 'video', 'high', null, '${CARLA}', null),
      ('${id(61)}', '${L_A}', null, 'Vence hoje', '${ST_FAZENDO}', '2026-10-08', 'arte', null, null, '${HELENA}', null),
      ('${id(62)}', '${L_A}', null, 'Vence na semana que vem', '${ST_AFAZER}', '2026-10-15', 'foto', null, null, '${CARLA}', null),
      ('${id(63)}', '${L_A}', null, 'Sem prazo', '${ST_AFAZER}', null, 'outros', null, null, null, null),
      ('${id(64)}', '${L_A}', null, 'Feita com prazo antigo', '${ST_FEITO}', '2026-10-01', null, null, '2026-10-02T12:00:00Z', null, null),
      ('${id(65)}', '${L_A2}', '${C_A2}', 'Do Sabor Doce', '${ST_AFAZER}', '2026-10-03', 'arte', null, null, null, null),
      ('${id(66)}', '${L_ESTUDIO}', '${C_A}', 'Do estúdio', null, '2026-10-04', 'video', null, null, null, null),
      ('${id(67)}', '${L_FILMES}', null, 'Da Filmes', null, '2026-10-02', null, null, null, null, null),
      ('${id(68)}', '${L_ALMA}', null, 'Da Alma', '${ST_ALMA}', '2026-10-02', null, null, null, null, null),
      ('${id(69)}', '${L_ZECA}', null, 'Do cliente cancelado', null, '2026-10-02', null, null, null, null, null),
      ('${id(70)}', '${L_A}', null, 'Arquivada', null, '2026-10-01', null, null, null, null, '2026-10-01T10:00:00Z');
    insert into ideworks.task_assignees values
      ('${id(60)}', '${HELENA}'), ('${id(61)}', '${HELENA}'), ('${id(61)}', '${CARLA}'), ('${id(64)}', '${CARLA}');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const NAO_ACHADO = { ok: false, code: 'not_found', message: 'Espaço, pasta ou lista não encontrado neste recorte.' };
const NEGADO = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };

async function boards(g: IntegrationGrant, input: Parameters<typeof listBoardsWork>[1] = {}, pessoa: PersonAccess = topo) {
  const r = await listBoardsWork(ctxDe(g, pessoa), input);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.body;
}
async function tasks(g: IntegrationGrant, input: Parameters<typeof listTasksWork>[1] = {}, pessoa: PersonAccess = topo) {
  const r = await listTasksWork(ctxDe(g, pessoa), input);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.body;
}
const ids = (body: { tasks: Array<{ id: string }> }) => body.tasks.map((t) => t.id);

describe('list_boards no banco', () => {
  it('as listas vivas, por espaço, pasta e nome, com cliente, "exige cliente" e produção (list_is_production)', async () => {
    const body = await boards(grant());
    expect(body.boards.map((b) => b.id)).toEqual([L_ALMA, L_A, L_A2, L_ESTUDIO, L_FILMES]);
    expect(body.total).toBe(5);
    expect(body.boards.find((b) => b.id === L_A)).toEqual({
      id: L_A,
      name: 'Atendimento',
      space: { id: S_CLIENTES, name: 'CLIENTES' },
      folder: { id: F_HELENA, name: 'TIME HELENA' },
      company: { id: IDE, name: 'Ide' },
      client: { id: C_A, name: 'Jatobá' },
      requiresClient: false,
      isProduction: true,
      archived: false,
    });
    expect(body.boards.find((b) => b.id === L_ESTUDIO)).toMatchObject({ folder: null, client: null, requiresClient: true, isProduction: false });
  });

  it('includeArchived, cliente cancelado, empresa omitida e concessões', async () => {
    const todas = await boards(grant(), { includeArchived: true });
    expect(todas.boards.map((b) => b.id)).toContain(L_ARQUIVADA);
    expect(JSON.stringify(todas)).not.toContain('Zeca');

    textos = [];
    const semOmitida = await boards(grant(), {}, semAlma);
    expect(semOmitida.boards.map((b) => b.id)).not.toContain(L_ALMA);
    expect(JSON.stringify(semOmitida)).not.toContain('Alma');
    expect(textos.some((t) => t.includes('not (tr.category_id = any('))).toBe(true);

    expect((await boards(grant({ allowedCompanyIds: [IDE] }))).boards.map((b) => b.id)).toEqual([L_A, L_A2, L_ESTUDIO]);
    // Cliente da concessão: a lista dele e as compartilhadas (sem cliente), não a do vizinho.
    expect((await boards(grant({ allowedClientIds: [C_A] }))).boards.map((b) => b.id)).toEqual([L_A, L_ESTUDIO]);
    expect((await boards(grant(), { companyId: FILMES })).boards.map((b) => b.id)).toEqual([L_FILMES]);
    expect((await boards(grant(), { folderId: F_HELENA })).boards.map((b) => b.id)).toEqual([L_A, L_A2]);
  });

  it('sem clients:read o nome do cliente some; sem boards:read, permission_denied; cursor até o fim', async () => {
    const semClientes = await boards(sem('clients:read'));
    expect(semClientes.boards.find((b) => b.id === L_A)?.client).toEqual({ id: C_A, name: null });
    expect(await listBoardsWork(ctxDe(sem('boards:read')), {})).toEqual(NEGADO);
    const vistas: string[] = [];
    let cursor: string | undefined;
    let voltas = 0;
    do {
      const pagina = await boards(grant(), { limit: 2, cursor });
      vistas.push(...pagina.boards.map((b) => b.id));
      cursor = pagina.nextCursor ?? undefined;
      voltas += 1;
    } while (cursor && voltas < 10);
    expect(vistas).toEqual([L_ALMA, L_A, L_A2, L_ESTUDIO, L_FILMES]);
  });
});

describe('list_tasks no banco', () => {
  it('sem filtro: as do recorte, por título; arquivada e de cliente cancelado fora; total do filtro inteiro', async () => {
    const body = await tasks(grant());
    expect(body.total).toBe(9);
    expect(ids(body)).not.toContain(id(70));
    expect(ids(body)).not.toContain(id(69));
    expect(body.tasks.map((t) => t.title)).toEqual([...body.tasks.map((t) => t.title)].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)));
  });

  it('a tarefa leva etapa, prioridade, tipo, prazo, lista, cliente e responsáveis', async () => {
    const body = await tasks(grant(), { listId: L_A, overdue: true });
    expect(body.tasks).toEqual([
      {
        id: id(60),
        title: 'Atrasada de vídeo',
        statusId: ST_AFAZER,
        statusName: 'A fazer',
        statusType: 'unstarted',
        priority: 'high',
        type: 'video',
        dueOn: '2026-10-05',
        startOn: null,
        completedAt: null,
        list: { id: L_A, name: 'Atendimento' },
        client: { id: C_A, name: 'Jatobá' },
        people: [{ id: HELENA, name: 'Helena' }],
      },
    ]);
  });

  it('cada filtro: overdue, dueBefore, completed, statusType, type, clientId, assigneeId, createdBy', async () => {
    expect(ids(await tasks(grant(), { overdue: true })).sort()).toEqual([id(60), id(65), id(66), id(67), id(68)].sort());
    expect(ids(await tasks(grant(), { listId: L_A, dueBefore: '2026-10-09' })).sort()).toEqual([id(60), id(61), id(64)].sort());
    expect(ids(await tasks(grant(), { listId: L_A, completed: true }))).toEqual([id(64)]);
    expect(ids(await tasks(grant(), { listId: L_A, completed: false })).sort()).toEqual([id(60), id(61), id(62), id(63)].sort());
    expect(ids(await tasks(grant(), { listId: L_A, statusType: 'custom' }))).toEqual([id(61)]);
    expect(ids(await tasks(grant(), { listId: L_A, type: 'foto' }))).toEqual([id(62)]);
    expect(ids(await tasks(grant(), { clientId: C_A })).sort()).toEqual([id(60), id(61), id(62), id(63), id(64), id(66)].sort());
    expect(ids(await tasks(grant(), { assigneeId: HELENA })).sort()).toEqual([id(60), id(61)].sort());
    expect(ids(await tasks(grant(), { assigneeId: CARLA })).sort()).toEqual([id(61), id(64)].sort());
    expect(ids(await tasks(grant(), { createdBy: CARLA })).sort()).toEqual([id(60), id(62)].sort());
    expect(ids(await tasks(grant(), { createdBy: CARLA, overdue: true }))).toEqual([id(60)]);
  });

  it('pasta e espaço', async () => {
    expect(ids(await tasks(grant(), { folderId: F_HELENA })).sort()).toEqual([id(60), id(61), id(62), id(63), id(64), id(65)].sort());
    expect(ids(await tasks(grant(), { spaceId: S_ESTUDIO }))).toEqual([id(66)]);
    expect((await tasks(grant(), { folderId: F_HELENA, overdue: true })).total).toBe(2);
  });

  it('empresa omitida, outra empresa, outro cliente e contêiner de fora: nunca aparecem', async () => {
    textos = [];
    const semOmitida = await tasks(grant(), {}, semAlma);
    expect(ids(semOmitida)).not.toContain(id(68));
    expect(JSON.stringify(semOmitida)).not.toContain('Alma');
    expect(textos.some((t) => t.includes('not (tr.category_id = any('))).toBe(true);
    expect(ids(await tasks(grant({ allowedCompanyIds: [IDE] }))).sort()).toEqual(
      [id(60), id(61), id(62), id(63), id(64), id(65), id(66)].sort(),
    );
    const soClienteA = await tasks(grant({ allowedClientIds: [C_A] }));
    expect(ids(soClienteA)).not.toContain(id(65));
    expect(ids(soClienteA)).toContain(id(66));

    expect(await listTasksWork(ctxDe(grant({ allowedCompanyIds: [IDE] })), { listId: L_FILMES })).toEqual(NAO_ACHADO);
    expect(await listTasksWork(ctxDe(grant({ allowedCompanyIds: [IDE] })), { spaceId: S_FILMES })).toEqual(NAO_ACHADO);
    expect(await listTasksWork(ctxDe(grant(), semAlma), { listId: L_ALMA })).toEqual(NAO_ACHADO);
    expect(await listTasksWork(ctxDe(grant(), semAlma), { spaceId: S_ALMA })).toEqual(NAO_ACHADO);
    expect(await listTasksWork(ctxDe(grant({ allowedClientIds: [C_A] })), { listId: L_A2 })).toEqual(NAO_ACHADO);
    expect(await listTasksWork(ctxDe(grant()), { listId: id(777) })).toEqual(NAO_ACHADO);
  });

  it('capacidades: sem tasks:read nada; filtro de pessoa exige people:read; responsáveis, cliente e lista seguem as leituras', async () => {
    expect(await listTasksWork(ctxDe(sem('tasks:read')), {})).toEqual(NEGADO);
    expect(await listTasksWork(ctxDe(sem('people:read')), { assigneeId: HELENA })).toEqual(NEGADO);
    const semPessoas = await tasks(sem('people:read'), { listId: L_A, overdue: true });
    expect(semPessoas.tasks[0]?.people).toBeNull();
    expect(JSON.stringify(semPessoas)).not.toContain('Helena');
    expect((await tasks(sem('clients:read'), { listId: L_A, overdue: true })).tasks[0]?.client).toEqual({ id: C_A, name: null });
    expect((await tasks(sem('boards:read'), { listId: L_A, overdue: true })).tasks[0]?.list).toEqual({ id: L_A, name: null });
  });

  it('o cursor anda até o fim contra o banco', async () => {
    const todas = ids(await tasks(grant()));
    const vistas: string[] = [];
    let cursor: string | undefined;
    let voltas = 0;
    do {
      const pagina = await tasks(grant(), { limit: 2, cursor });
      expect(pagina.total).toBe(9);
      vistas.push(...ids(pagina));
      cursor = pagina.nextCursor ?? undefined;
      voltas += 1;
    } while (cursor && voltas < 10);
    expect(vistas).toEqual(todas);
    expect(new Set(vistas).size).toBe(9);
  });
});
