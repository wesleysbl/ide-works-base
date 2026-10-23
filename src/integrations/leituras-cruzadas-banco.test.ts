/**
 * As leituras do MCP com dados CRUZADOS entre empresas, contra um Postgres de
 * verdade — revisão adversária de 09/10/2026.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   `SqlWorkCatalog` sobre o PGlite, com o recorte montado pelo caminho de
 *   produção (`toWorkScope` dentro de cada `...Work`), em terreno onde a lista
 *   ou a tarefa é de uma empresa EM ESCOPO (Ide) e o cliente ligado a ela é de
 *   uma empresa OMITIDA (Alma9):
 *     · o cliente da empresa omitida não aparece (id nem nome) em linha nenhuma
 *       — list_tasks, list_boards, get_task, get_board, search e
 *       get_person_work —, e a linha continua lá: a empresa da tarefa é a da
 *       lista dela, e a linha está legitimamente no recorte;
 *     · o cliente de empresa em escopo continua aparecendo.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha e as funções de concessão reais
 *   (`integration_allows_company`/`_client`): aqui dizem "sim" para tudo — e é
 *   justamente o que `integration_allows_client` faz no banco com a omissão, que
 *   vem de uma variável do Worker e que ela não conhece.
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IntegrationCapability, IntegrationGrant, PersonAccess } from '@/integrations/grants';
import type { Tx } from '@/server/db';

/* ───────────────────────────── o adaptador ───────────────────────────── */

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

const reads = await import('@/integrations/reads');
const { SqlWorkCatalog } = await import('@/integrations/sql-work');

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDE = id(1);
const FILMES = id(2);
const ALMA = id(3);
const C_IDE = id(10);
const C_ALMA = id(11);
const C_ZECA = id(12);
const S_IDE = id(20);
const S_ESTUDIO = id(21);
const S_ALMA = id(22);
const S_SO_ZECA = id(23);
const F_SO_ZECA = id(30);
const F_MISTA = id(31);
const L_IDE = id(40);
const L_ESTUDIO = id(41);
const L_IDE_DO_CALMA = id(42);
const L_ALMA = id(43);
const L_ZECA = id(44);
const L_SO_ZECA = id(45);
const L_MISTA_ZECA = id(46);
const L_MISTA_ATIVA = id(47);
const T_IDE = id(60);
const T_ESTUDIO_ALMA = id(61);
const T_ZECA = id(62);
const T_NA_LISTA_DA_ALMA = id(63);
const T_ALMA = id(64);
const ST_ALMA = id(50);
const ST_IDE = id(51);
const HELENA = id(91);
const EU = id(99);

const NOME_OMITIDO = 'Cliente Alma9 Secreto';
const AGORA = new Date('2026-10-08T12:00:00Z');
const ATOR = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };
const TODAS: IntegrationCapability[] = ['boards:read', 'tasks:read', 'clients:read', 'people:read', 'comments:read'];

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: id(200),
  ownerId: EU,
  oauthClientId: 'cliente-oauth',
  name: 'Claude da Helena',
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

const ctxDe = (g: IntegrationGrant, pessoa: PersonAccess = semAlma) => ({
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
    create table ideworks.client_categories(id uuid primary key, name text, is_default boolean default false);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid,
      is_active boolean default true, inactive_at timestamptz,
      plan_id uuid, urgency text not null default 'paz', finance_ok boolean not null default false,
      started_on date, renews_on date);
    create table ideworks.people(id uuid primary key, name text);
    create table ideworks.user_categories(user_id uuid, category_id uuid);
    create function ideworks.team_directory() returns table(id uuid, name text) language sql as
      $$ select id, name from ideworks.people $$;
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
    create function ideworks.list_is_production(p_list_id uuid) returns boolean language sql stable as $$ select false $$;
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, title text, description text,
      due_on date, start_on date, priority text, demand_type text, status_id uuid, archived_at timestamptz,
      completed_at timestamptz, parent_id uuid, created_at timestamptz not null default now(),
      created_by uuid, completed_by uuid, via_name text);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    create table ideworks.task_tags(id uuid primary key, space_id uuid, name text, bg_color text, fg_color text);
    create table ideworks.task_labels(task_id uuid, tags jsonb);
    create table ideworks.task_watchers(task_id uuid, user_id uuid);
    create table ideworks.task_checklists(id uuid primary key, task_id uuid, name text, sort_order int default 0,
      created_at timestamptz default now());
    create table ideworks.checklist_items(id uuid primary key, checklist_id uuid, parent_item_id uuid, name text,
      sort_order int default 0, resolved_at timestamptz, assignee_id uuid, created_at timestamptz default now());
    create table ideworks.task_links(id uuid primary key, task_id uuid, label text, url text, sort_order int default 0,
      created_at timestamptz default now());
    create table ideworks.task_events(id bigserial primary key, task_id uuid,
      automation_name text, occurred_at timestamptz default now(), via_name text, actor_id uuid,
      from_list_id uuid, to_list_id uuid, from_status_id uuid, to_status_id uuid,
      from_client_id uuid, to_client_id uuid, removed_user_ids uuid[] not null default '{}'::uuid[],
      added_user_id uuid, added_user_ids uuid[] not null default '{}'::uuid[]);
    create table ideworks.task_comments(id uuid primary key, task_id uuid, parent_id uuid, body text,
      created_at timestamptz default now(), author_id uuid,
      from_client boolean not null default false, approval_round_id uuid, approval_item_id uuid);
    create table ideworks.approval_rounds(id uuid primary key, task_id uuid, client_id uuid, version int,
      state text, sent_at timestamptz default now(), sent_by uuid, decided_at timestamptz,
      decided_via text, decision_comment_id uuid, closed_at timestamptz);
    create table ideworks.approval_round_items(id uuid primary key, round_id uuid, position int,
      dropbox_url text, kind text, file_name text, storage_path text);

    insert into ideworks.client_categories values ('${IDE}', 'Ide', false), ('${FILMES}', 'Filmes', false), ('${ALMA}', 'Alma9', false);
    insert into ideworks.people values ('${HELENA}', 'Helena'), ('${EU}', 'Wesley');
    insert into ideworks.clients(id, name, category_id, is_active, inactive_at) values
      ('${C_IDE}', 'Alfa Ide', '${IDE}', true, null),
      ('${C_ALMA}', '${NOME_OMITIDO}', '${ALMA}', true, null),
      ('${C_ZECA}', 'Zeca', '${IDE}', false, '2026-10-04T12:00:00Z');
    insert into ideworks.spaces values
      ('${S_IDE}', '${IDE}', 'CLIENTES', null), ('${S_ESTUDIO}', '${IDE}', 'Estúdio Ide', null),
      ('${S_ALMA}', '${ALMA}', 'Espaço Alma9', null),
      ('${S_SO_ZECA}', '${IDE}', 'Só do Zeca', null);
    insert into ideworks.folders values
      ('${F_SO_ZECA}', '${S_SO_ZECA}', 'Pasta só do Zeca', null),
      ('${F_MISTA}', '${S_IDE}', 'Pasta mista', null);
    insert into ideworks.lists(id, space_id, folder_id, name, client_id, archived_at, requires_client) values
      ('${L_IDE}', '${S_IDE}', null, 'Lista Alfa', '${C_IDE}', null, false),
      ('${L_ESTUDIO}', '${S_ESTUDIO}', null, 'ESTÚDIO', null, null, true),
      -- Lista da Ide (em escopo) ligada a cliente da Alma9 (omitida).
      ('${L_IDE_DO_CALMA}', '${S_IDE}', null, 'Lista da Ide ligada ao cliente da Alma', '${C_ALMA}', null, false),
      ('${L_ALMA}', '${S_ALMA}', null, 'Lista Alma9', '${C_ALMA}', null, false),
      ('${L_ZECA}', '${S_IDE}', null, 'Lista do Zeca', '${C_ZECA}', null, false),
      -- Contêineres de cliente cancelado: só dele (espaço e pasta) e misturado com cliente ativo (pasta).
      ('${L_SO_ZECA}', '${S_SO_ZECA}', '${F_SO_ZECA}', 'Só do Zeca', '${C_ZECA}', null, false),
      ('${L_MISTA_ZECA}', '${S_IDE}', '${F_MISTA}', 'Mista do Zeca', '${C_ZECA}', null, false),
      ('${L_MISTA_ATIVA}', '${S_IDE}', '${F_MISTA}', 'Mista ativa', '${C_IDE}', null, false);
    insert into ideworks.statuses values
      ('${ST_IDE}', '${S_IDE}', 'A fazer', 'unstarted', 1),
      (gen_random_uuid(), '${S_SO_ZECA}', 'A fazer', 'unstarted', 1),
      (gen_random_uuid(), '${S_ESTUDIO}', 'A fazer', 'unstarted', 1),
      ('${ST_ALMA}', '${S_ALMA}', 'Etapa secreta da Alma9', 'open', 1);

    insert into ideworks.tasks(id, list_id, client_id, title, status_id, due_on, parent_id) values
      ('${T_IDE}', '${L_IDE}', null, 'Tarefa da Ide', '${ST_IDE}', '2026-10-05', null),
      -- Tarefa de lista da Ide com cliente PRÓPRIO da Alma9.
      ('${T_ESTUDIO_ALMA}', '${L_ESTUDIO}', '${C_ALMA}', 'Briefing no Estúdio', null, '2026-10-05', null),
      ('${T_ZECA}', '${L_ZECA}', null, 'Tarefa do Zeca', null, '2026-10-05', null),
      -- Tarefa sem cliente numa lista da Ide ligada ao cliente da Alma9: o cliente dela vem da lista.
      ('${T_NA_LISTA_DA_ALMA}', '${L_IDE_DO_CALMA}', null, 'Pauta da lista ligada à Alma', '${ST_IDE}', '2026-10-06', null),
      ('${T_ALMA}', '${L_ALMA}', null, 'Mãe secreta na Alma9', null, null, null);
    insert into ideworks.task_tags values ('${id(70)}', '${S_SO_ZECA}', 'Etiqueta do espaço do Zeca', '#000', '#fff');
    insert into ideworks.task_assignees values
      ('${T_ESTUDIO_ALMA}', '${HELENA}'), ('${T_NA_LISTA_DA_ALMA}', '${HELENA}'), ('${T_IDE}', '${HELENA}');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const json = (x: unknown) => JSON.stringify(x);
/** Nem o nome nem o id do cliente da empresa omitida saem em lugar nenhum do corpo. */
function semClienteOmitido(corpo: unknown) {
  expect(json(corpo)).not.toContain(NOME_OMITIDO);
  expect(json(corpo)).not.toContain(C_ALMA);
}

/* ─────────────── cliente de empresa omitida em linha em escopo ─────────────── */

describe('cliente de empresa omitida em lista ou tarefa de empresa em escopo', () => {
  it('CONTROLE: sem omissão o nome do cliente da Alma9 aparece (a regra é a omissão, não o dado)', async () => {
    const r = await reads.listTasksWork(ctxDe(grant(), topo), {});
    if (!r.ok) throw new Error(r.message);
    expect(r.body.tasks.find((t) => t.id === T_ESTUDIO_ALMA)?.client).toEqual({ id: C_ALMA, name: NOME_OMITIDO });
  });

  it('list_tasks: a tarefa continua na lista, com o cliente em branco (o do cliente próprio e o da lista)', async () => {
    const r = await reads.listTasksWork(ctxDe(grant()), {});
    if (!r.ok) throw new Error(r.message);
    semClienteOmitido(r.body);
    const porId = new Map(r.body.tasks.map((t) => [t.id, t]));
    expect(porId.get(T_ESTUDIO_ALMA)?.client).toBeNull();
    expect(porId.get(T_NA_LISTA_DA_ALMA)?.client).toBeNull();
    expect(porId.get(T_IDE)?.client).toEqual({ id: C_IDE, name: 'Alfa Ide' });
    // A tarefa da lista da própria Alma9 continua fora (a empresa dela é a omitida).
    expect(porId.has(T_ALMA)).toBe(false);
  });

  it('list_tasks sem clients:read: o id do cliente da empresa omitida também não sai', async () => {
    const r = await reads.listTasksWork(ctxDe(sem('clients:read')), {});
    if (!r.ok) throw new Error(r.message);
    semClienteOmitido(r.body);
    expect(r.body.tasks.find((t) => t.id === T_ESTUDIO_ALMA)?.client).toBeNull();
    // O cliente em escopo, sem clients:read, segue com o id e sem nome.
    expect(r.body.tasks.find((t) => t.id === T_IDE)?.client).toEqual({ id: C_IDE, name: null });
  });

  it('list_tasks com clientId da empresa omitida não acha nada (o filtro não confirma o vínculo)', async () => {
    const r = await reads.listTasksWork(ctxDe(grant()), { clientId: C_ALMA });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.tasks).toEqual([]);
    expect(r.body.total).toBe(0);
  });

  it('list_boards: a lista da Ide ligada ao cliente da Alma9 continua, com o cliente em branco', async () => {
    const r = await reads.listBoardsWork(ctxDe(grant()), {});
    if (!r.ok) throw new Error(r.message);
    semClienteOmitido(r.body);
    expect(r.body.boards.find((b) => b.id === L_IDE_DO_CALMA)?.client).toBeNull();
    expect(r.body.boards.find((b) => b.id === L_IDE)?.client).toEqual({ id: C_IDE, name: 'Alfa Ide' });
    // O filtro por cliente da empresa omitida não acha a lista.
    const filtrado = await reads.listBoardsWork(ctxDe(grant()), { clientId: C_ALMA });
    if (!filtrado.ok) throw new Error(filtrado.message);
    expect(filtrado.body.boards).toEqual([]);
  });

  it('get_task: a ficha da tarefa com cliente da Alma9 sai sem o cliente', async () => {
    for (const taskId of [T_ESTUDIO_ALMA, T_NA_LISTA_DA_ALMA]) {
      const r = await reads.getTaskWork(ctxDe(grant()), { id: taskId });
      if (!r.ok) throw new Error(r.message);
      semClienteOmitido(r.body);
      expect(r.body.task.client).toBeNull();
    }
  });

  it('get_board: o cliente da lista e o das tarefas saem em branco', async () => {
    const r = await reads.getBoardWork(ctxDe(grant()), { id: L_IDE_DO_CALMA });
    if (!r.ok) throw new Error(r.message);
    semClienteOmitido(r.body);
    expect(r.body.board.client).toBeNull();
    expect(r.body.board.tasks.map((t) => t.id)).toEqual([T_NA_LISTA_DA_ALMA]);
    expect(r.body.board.tasks[0]?.client).toBeNull();

    const estudio = await reads.getBoardWork(ctxDe(grant()), { id: L_ESTUDIO });
    if (!estudio.ok) throw new Error(estudio.message);
    semClienteOmitido(estudio.body);
    expect(estudio.body.board.tasks.map((t) => t.id)).toEqual([T_ESTUDIO_ALMA]);
  });

  it('search: a tarefa e a lista achadas saem sem o cliente da Alma9', async () => {
    const r = await reads.searchWork(ctxDe(grant()), { q: 'lista', kinds: ['board', 'task'] });
    if (!r.ok) throw new Error(r.message);
    semClienteOmitido(r.body);
    expect(r.body.items.find((i) => i.id === L_IDE_DO_CALMA)).toMatchObject({ kind: 'board', client: null });
    const t = await reads.searchWork(ctxDe(grant()), { q: 'briefing', kinds: ['task'] });
    if (!t.ok) throw new Error(t.message);
    semClienteOmitido(t.body);
    expect(t.body.items.find((i) => i.id === T_ESTUDIO_ALMA)).toMatchObject({ kind: 'task', client: null });
  });

  it('get_person_work: as tarefas da pessoa saem sem o cliente da Alma9', async () => {
    const r = await reads.getPersonWork(ctxDe(grant()), { id: HELENA });
    if (!r.ok) throw new Error(r.message);
    semClienteOmitido(r.body);
    const porId = new Map(r.body.items.map((t) => [t.id, t]));
    expect(porId.get(T_ESTUDIO_ALMA)?.client).toBeNull();
    expect(porId.get(T_NA_LISTA_DA_ALMA)?.client).toBeNull();
    expect(porId.get(T_IDE)?.client).toEqual({ id: C_IDE, name: 'Alfa Ide' });
  });

  it('sem empresa omitida nenhuma consulta nova é feita (o texto é o de antes)', async () => {
    textos = [];
    await reads.listTasksWork(ctxDe(grant(), topo), {});
    expect(textos.join('\n')).not.toContain('omitida');
    const r = await reads.listBoardsWork(ctxDe(grant(), topo), {});
    if (!r.ok) throw new Error(r.message);
    expect(r.body.boards.find((b) => b.id === L_IDE_DO_CALMA)?.client).toEqual({ id: C_ALMA, name: NOME_OMITIDO });
  });
});

/* ─────────────────────────── entrada que o Postgres recusa ─────────────────────────── */

describe('entrada impossível vira recusa de entrada, não erro interno', () => {
  const forjar = (k: string, idx: string) => Buffer.from(JSON.stringify({ v: 1, k, id: idx })).toString('base64url');

  it('list_tasks com dueBefore que não existe no calendário: invalid_input, sem ir ao banco', async () => {
    for (const dueBefore of ['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31']) {
      textos = [];
      const r = await reads.listTasksWork(ctxDe(grant()), { dueBefore });
      expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(r.ok === false && r.message).toMatch(/dueBefore/);
      expect(textos).toEqual([]);
    }
  });

  it('list_tasks com dueBefore que existe (inclusive 29/02 de ano bissexto) lê normalmente', async () => {
    for (const dueBefore of ['2026-02-28', '2028-02-29', '2026-10-09']) {
      const r = await reads.listTasksWork(ctxDe(grant()), { dueBefore });
      expect(r.ok).toBe(true);
    }
  });

  it('cursor forjado com NUL em k ou id: invalid_cursor em todas as leituras paginadas', async () => {
    const cursores = [forjar('a\u0000b', 'x'), forjar('a', 'x\u0000y'), forjar('\u0000', '\u0000')];
    for (const cursor of cursores) {
      textos = [];
      const resultados = [
        await reads.listTasksWork(ctxDe(grant()), { cursor }),
        await reads.listBoardsWork(ctxDe(grant()), { cursor }),
        await reads.getBoardWork(ctxDe(grant()), { id: L_IDE, cursor }),
        await reads.getPersonWork(ctxDe(grant()), { id: HELENA, cursor }),
        await reads.searchWork(ctxDe(grant()), { q: 'a', cursor }),
        await reads.listClientsWork(ctxDe(grant()), { cursor }),
      ];
      for (const r of resultados) expect(r).toMatchObject({ ok: false, code: 'invalid_cursor' });
      expect(textos).toEqual([]);
    }
  });
});

/* ─────────────────────────── cliente cancelado (F38) ─────────────────────────── */

describe('contêiner de cliente cancelado: not_found, como list_boards o esconde', () => {
  const NAO_ACHADO_TAGS = { ok: false, code: 'not_found' };

  it('CONTROLE: list_boards não traz as listas do cliente cancelado', async () => {
    const r = await reads.listBoardsWork(ctxDe(grant()), {});
    if (!r.ok) throw new Error(r.message);
    const nomes = r.body.boards.map((b) => b.id);
    for (const cancelada of [L_ZECA, L_SO_ZECA, L_MISTA_ZECA]) expect(nomes).not.toContain(cancelada);
    expect(nomes).toContain(L_MISTA_ATIVA);
  });

  it('list_tags por listId de cliente cancelado é not_found', async () => {
    for (const listId of [L_ZECA, L_SO_ZECA, L_MISTA_ZECA]) {
      expect(await reads.listTagsWork(ctxDe(grant()), { listId })).toMatchObject(NAO_ACHADO_TAGS);
    }
    // A lista do cliente ativo continua lendo.
    expect((await reads.listTagsWork(ctxDe(grant()), { listId: L_MISTA_ATIVA })).ok).toBe(true);
  });

  it('list_tags por spaceId: o espaço só com listas de cliente cancelado é not_found; o misto lê', async () => {
    expect(await reads.listTagsWork(ctxDe(grant()), { spaceId: S_SO_ZECA })).toMatchObject(NAO_ACHADO_TAGS);
    expect((await reads.listTagsWork(ctxDe(grant()), { spaceId: S_IDE })).ok).toBe(true);
  });

  it('list_tasks por listId de cliente cancelado é not_found (não "ok, total 0")', async () => {
    for (const listId of [L_ZECA, L_SO_ZECA, L_MISTA_ZECA]) {
      expect(await reads.listTasksWork(ctxDe(grant()), { listId })).toMatchObject({ ok: false, code: 'not_found' });
    }
    expect((await reads.listTasksWork(ctxDe(grant()), { listId: L_MISTA_ATIVA })).ok).toBe(true);
  });

  it('list_tasks por folderId e spaceId: só com listas de cliente cancelado é not_found; misto lê', async () => {
    expect(await reads.listTasksWork(ctxDe(grant()), { folderId: F_SO_ZECA })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await reads.listTasksWork(ctxDe(grant()), { spaceId: S_SO_ZECA })).toMatchObject({ ok: false, code: 'not_found' });
    expect((await reads.listTasksWork(ctxDe(grant()), { folderId: F_MISTA })).ok).toBe(true);
    expect((await reads.listTasksWork(ctxDe(grant()), { spaceId: S_IDE })).ok).toBe(true);
  });
});
