/**
 * A FICHA INTEIRA DO `get_task` (G6) E `list_tags` (G7) CONTRA UM POSTGRES DE VERDADE
 * — conferência de 08/10/2026.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   `SqlWorkCatalog.getTask` + `getTaskWork` (as consultas novas: etiquetas,
 *   seguidores, mãe, checklists, links, histórico, criador, pasta e espaço)
 *   sobre o PGlite, com o recorte montado pelo caminho de produção
 *   (`toWorkScope(pessoa, concessão)`):
 *     · a mãe fora do recorte de cliente some;
 *     · o histórico só NOMEIA lista, etapa e cliente que a conexão alcança — a
 *       lista da Alma9 (empresa omitida), a etapa dela e o cliente que a
 *       concessão não cobre não aparecem na frase "alterou a lista de A para B";
 *     · pessoa, quadro e cliente seguem as capacidades;
 *     · os tetos cortam com o total ao lado.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha e as funções de concessão reais
 *   (`integration_allows_company`/`_client`): aqui dizem "sim", porque o recorte
 *   que importa à ficha é o do TypeScript, que vira cláusula.
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

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      return db
        .query(montar(f, params), params)
        .then((r) => r.rows)
        .then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) };

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (s: unknown) => Promise<unknown>) => work(sql),
}));

const { getTaskWork, listTagsWork } = await import('@/integrations/reads');
const { SqlWorkCatalog } = await import('@/integrations/sql-work');
const { getTaskResponseSchema } = await import('@/integrations/contract');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const IDE = id(1);
const ALMA = id(2);
const C_A = id(10);
const C_B = id(11);
const C_ALMA = id(12);
const S_IDE = id(20);
const S_ALMA = id(21);
const F_HELENA = id(30);
const L_A = id(40);
const L_B = id(41);
const L_ALMA = id(42);
const ST_AFAZER = id(60);
const ST_APROVACAO = id(61);
const ST_ALMA = id(62);
const T_FICHA = id(70);
const T_FILHA_FORA = id(71);
const T_MAE_B = id(72);
const T_CHEIA = id(73);
const EU = id(99);
const HELENA = id(91);
const ANA = id(92);
const MURILO = id(93);

const AGORA = new Date('2026-10-08T12:00:00Z');
const ATOR = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };

const CAPACIDADES: IntegrationCapability[] = ['tasks:read', 'boards:read', 'clients:read', 'people:read', 'comments:read'];

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: id(200),
  ownerId: EU,
  oauthClientId: 'cliente-oauth',
  name: 'Claude',
  capabilities: CAPACIDADES,
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
  ...over,
});
const topo: PersonAccess = {
  userId: EU,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [IDE, ALMA],
  clientIds: [],
  hasAllClientsAccess: true,
};
const semAlma: PersonAccess = { ...topo, omittedCompanyIds: [ALMA] };

const catalogo = () => new SqlWorkCatalog({} as never, ATOR as never);
const ctxDe = (g: IntegrationGrant, pessoa: PersonAccess = topo) => ({
  grant: g,
  person: pessoa,
  origin: 'http' as const,
  companies: [
    { id: IDE, name: 'Ide' },
    { id: ALMA, name: 'Alma9' },
  ],
  displayName: 'Wesley',
  work: catalogo(),
  now: AGORA,
});

async function ler(g: IntegrationGrant, pessoa: PersonAccess = topo, tarefa = T_FICHA, cursor?: string) {
  const r = await getTaskWork(ctxDe(g, pessoa), { id: tarefa, cursor });
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return getTaskResponseSchema.parse(r.body);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
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
      archived_at timestamptz);
    create view ideworks.tree as
      select l.id as list_id, l.name as list_name, s.id as space_id, s.name as space_name,
             f.id as folder_id, f.name as folder_name, s.category_id,
             (s.archived_at is null and l.archived_at is null) as is_live
        from ideworks.lists l
        join ideworks.spaces s on s.id = l.space_id
        left join ideworks.folders f on f.id = l.folder_id;
    create table ideworks.statuses(id uuid primary key, space_id uuid, name text, type text, sort_order int);
    create view ideworks.list_workflow as
      select l.id as list_id, st.id as status_id, st.name as status_name, st.type as status_type,
             st.sort_order as status_sort_order
        from ideworks.lists l join ideworks.statuses st on st.space_id = l.space_id;
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, title text, description text,
      due_on date, start_on date, priority text, demand_type text, status_id uuid, archived_at timestamptz,
      completed_at timestamptz, parent_id uuid, created_at timestamptz not null default now(),
      created_by uuid, completed_by uuid, via_name text);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    create table ideworks.task_comments(id uuid primary key, task_id uuid, parent_id uuid, body text,
      created_at timestamptz default now(), author_id uuid, from_client boolean not null default false,
      approval_round_id uuid, approval_item_id uuid);
    create table ideworks.approval_rounds(id uuid primary key, task_id uuid, client_id uuid, version int,
      state text, sent_at timestamptz default now(), sent_by uuid, decided_at timestamptz,
      decided_via text, decision_comment_id uuid, closed_at timestamptz);
    create table ideworks.approval_round_items(id uuid primary key, round_id uuid, position int,
      dropbox_url text, kind text, file_name text, storage_path text);
    create table ideworks.task_tags(id uuid primary key default gen_random_uuid(), space_id uuid, name text,
      bg_color text, fg_color text);
    create table ideworks.task_labels(task_id uuid, tags jsonb);
    create table ideworks.task_watchers(task_id uuid, user_id uuid);
    create table ideworks.task_checklists(id uuid primary key, task_id uuid, name text, sort_order int default 0,
      created_at timestamptz default now());
    create table ideworks.checklist_items(id uuid primary key default gen_random_uuid(), checklist_id uuid,
      parent_item_id uuid, name text, sort_order int default 0, resolved_at timestamptz, assignee_id uuid,
      created_at timestamptz default now());
    create table ideworks.task_links(id uuid primary key default gen_random_uuid(), task_id uuid, label text,
      url text, sort_order int default 0, created_at timestamptz default now());
    create table ideworks.task_events(id uuid primary key default gen_random_uuid(), task_id uuid,
      automation_name text, occurred_at timestamptz default now(), via_name text, actor_id uuid,
      from_list_id uuid, to_list_id uuid, from_status_id uuid, to_status_id uuid,
      from_client_id uuid, to_client_id uuid, removed_user_ids uuid[] not null default '{}'::uuid[],
      added_user_id uuid, added_user_ids uuid[] not null default '{}'::uuid[]);

    insert into ideworks.client_categories values ('${IDE}', 'Ide'), ('${ALMA}', 'Alma9');
    insert into ideworks.people values ('${HELENA}', 'Helena'), ('${ANA}', 'Ana'), ('${MURILO}', 'Murilo'), ('${EU}', 'Wesley');
    insert into ideworks.clients values
      ('${C_A}', 'Jatobá', '${IDE}', true, null),
      ('${C_B}', 'Sabor Doce', '${IDE}', true, null),
      ('${C_ALMA}', 'Cliente Alma', '${ALMA}', true, null);
    insert into ideworks.spaces values ('${S_IDE}', '${IDE}', 'CLIENTES', null), ('${S_ALMA}', '${ALMA}', 'CLIENTES ALMA', null);
    insert into ideworks.folders values ('${F_HELENA}', '${S_IDE}', 'TIME HELENA', null);
    insert into ideworks.lists values
      ('${L_A}', '${S_IDE}', '${F_HELENA}', 'Redes sociais', '${C_A}', null),
      ('${L_B}', '${S_IDE}', null, 'Lista do outro cliente', '${C_B}', null),
      ('${L_ALMA}', '${S_ALMA}', null, 'Lista Secreta da Alma', '${C_ALMA}', null);
    insert into ideworks.statuses values
      ('${ST_AFAZER}', '${S_IDE}', 'A fazer', 'unstarted', 0),
      ('${ST_APROVACAO}', '${S_IDE}', 'Aprovação', 'custom', 1),
      ('${ST_ALMA}', '${S_ALMA}', 'Pauta Secreta da Alma', 'open', 0);

    insert into ideworks.tasks(id, list_id, client_id, title, status_id, parent_id, created_by, completed_by, via_name, created_at) values
      ('${T_MAE_B}', '${L_A}', '${C_B}', 'Mãe do outro cliente', null, null, null, null, null, '2026-09-01T10:00:00Z'),
      ('${T_FICHA}', '${L_A}', null, 'Peça da campanha', '${ST_APROVACAO}', null, '${HELENA}', null, 'Claude da Carla', '2026-09-18T13:00:00Z'),
      ('${T_FILHA_FORA}', '${L_A}', null, 'Filha de mãe de outro cliente', null, '${T_MAE_B}', null, null, null, '2026-09-02T10:00:00Z'),
      ('${T_CHEIA}', '${L_A}', null, 'Tarefa cheia', null, null, null, null, null, '2026-09-03T10:00:00Z');
    -- a mãe da T_FICHA mora na mesma lista e no mesmo cliente
    insert into ideworks.tasks(id, list_id, client_id, title, created_at) values
      ('${id(74)}', '${L_A}', null, 'Campanha de outubro', '2026-09-01T10:00:00Z');
    update ideworks.tasks set parent_id = '${id(74)}' where id = '${T_FICHA}';

    insert into ideworks.task_labels values
      ('${T_FICHA}', '[{"id":"${id(80)}","name":"Reels","bg_color":"#7c3aed","fg_color":"#ffffff"},{"id":"${id(81)}","name":"Urgente","bg_color":null,"fg_color":null}]'::jsonb);
    insert into ideworks.task_watchers values ('${T_FICHA}', '${ANA}'), ('${T_FICHA}', '${HELENA}');
    insert into ideworks.task_checklists values
      ('${id(90)}', '${T_FICHA}', 'Antes de enviar', 0, '2026-09-18T13:00:00Z'),
      ('${id(94)}', '${T_FICHA}', 'Depois de enviar', 1, '2026-09-18T13:01:00Z');
    insert into ideworks.checklist_items(id, checklist_id, parent_item_id, name, sort_order, resolved_at, assignee_id) values
      ('${id(95)}', '${id(90)}', null, 'Revisar a legenda', 0, '2026-09-20T15:00:00Z', '${HELENA}'),
      ('${id(96)}', '${id(90)}', null, 'Conferir a música', 1, null, null),
      ('${id(97)}', '${id(90)}', '${id(96)}', 'Música livre de direitos?', 2, null, '${ANA}'),
      ('${id(98)}', '${id(94)}', null, 'Avisar o cliente', 0, null, null);
    insert into ideworks.task_links(id, task_id, label, url, sort_order) values
      ('${id(110)}', '${T_FICHA}', 'Pasta da peça no Dropbox', 'https://www.dropbox.com/scl/fo/exemplo', 0),
      ('${id(111)}', '${T_FICHA}', 'Roteiro', 'https://docs.google.com/document/d/exemplo', 1);

    -- O livro: status à mão; mudança de lista vinda da Alma9; regra de automação com IA; cliente; responsáveis.
    insert into ideworks.task_events(id, task_id, automation_name, occurred_at, via_name, actor_id,
      from_list_id, to_list_id, from_status_id, to_status_id, from_client_id, to_client_id, removed_user_ids, added_user_ids) values
      ('${id(120)}', '${T_FICHA}', null, '2026-09-19T10:00:00Z', null, '${HELENA}', null, null, '${ST_AFAZER}', '${ST_APROVACAO}', null, null, '{}', '{}'),
      ('${id(121)}', '${T_FICHA}', null, '2026-09-19T11:00:00Z', null, '${HELENA}', '${L_ALMA}', '${L_A}', '${ST_ALMA}', '${ST_AFAZER}', null, null, '{}', '{}'),
      ('${id(122)}', '${T_FICHA}', 'Regra: aprovou, avisa', '2026-09-19T12:00:00Z', 'Claude da Carla', null, null, null, '${ST_AFAZER}', '${ST_APROVACAO}', null, null, '{}', '{}'),
      ('${id(123)}', '${T_FICHA}', null, '2026-09-19T13:00:00Z', null, '${HELENA}', null, null, null, null, '${C_B}', '${C_A}', '{}', '{}'),
      ('${id(124)}', '${T_FICHA}', null, '2026-09-19T14:00:00Z', null, '${HELENA}', null, null, null, null, null, null, '{${MURILO}}', '{${ANA}}');

    -- G7: as etiquetas dos espaços (a da Alma9 não pode vazar).
    insert into ideworks.task_tags(id, space_id, name, bg_color, fg_color) values
      ('${id(80)}', '${S_IDE}', 'Reels', '#7c3aed', '#ffffff'),
      ('${id(81)}', '${S_IDE}', 'Urgente', null, null),
      ('${id(82)}', '${S_IDE}', 'arte final', null, null),
      ('${id(83)}', '${S_ALMA}', 'Segredo da Alma', null, null);

    -- A tarefa cheia: passa dos tetos de checklist, link e histórico.
    insert into ideworks.task_checklists
      select gen_random_uuid(), '${T_CHEIA}', 'Lista ' || n, n, now() from generate_series(1, 20) n;
    insert into ideworks.checklist_items(checklist_id, name, sort_order)
      select k.id, 'Item ' || k.sort_order || '-' || n, n from ideworks.task_checklists k, generate_series(1, 8) n
       where k.task_id = '${T_CHEIA}';
    insert into ideworks.task_links(task_id, label, url, sort_order)
      select '${T_CHEIA}', 'Link ' || n, 'https://www.dropbox.com/scl/fo/' || n, n from generate_series(1, 45) n;
    insert into ideworks.task_events(task_id, automation_name, occurred_at, actor_id, from_status_id, to_status_id)
      select '${T_CHEIA}', null, '2026-09-10T10:00:00Z'::timestamptz + (n || ' minutes')::interval, '${HELENA}',
             case when n % 2 = 0 then '${ST_AFAZER}'::uuid else '${ST_APROVACAO}'::uuid end,
             case when n % 2 = 0 then '${ST_APROVACAO}'::uuid else '${ST_AFAZER}'::uuid end
        from generate_series(1, 50) n;
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe('get_task — a ficha inteira, no Postgres', () => {
  it('com todas as leituras: etiquetas, seguidores, mãe, checklists, links, histórico, criador, pasta e espaço', async () => {
    const { task } = await ler(grant());
    expect(task.tags).toEqual([
      { id: id(80), name: 'Reels', bgColor: '#7c3aed', fgColor: '#ffffff' },
      { id: id(81), name: 'Urgente', bgColor: null, fgColor: null },
    ]);
    // Por nome, como a ficha da tela.
    expect(task.watchers).toEqual([
      { id: ANA, name: 'Ana' },
      { id: HELENA, name: 'Helena' },
    ]);
    expect(task.parentId).toBe(id(74));
    expect(task.parentTitle).toBe('Campanha de outubro');
    expect(task.checklists).toEqual([
      {
        id: id(90),
        name: 'Antes de enviar',
        items: [
          {
            id: id(95),
            name: 'Revisar a legenda',
            parentItemId: null,
            resolved: true,
            resolvedAt: '2026-09-20T15:00:00.000Z',
            assignee: { id: HELENA, name: 'Helena' },
          },
          { id: id(96), name: 'Conferir a música', parentItemId: null, resolved: false, resolvedAt: null, assignee: null },
          {
            id: id(97),
            name: 'Música livre de direitos?',
            parentItemId: id(96),
            resolved: false,
            resolvedAt: null,
            assignee: { id: ANA, name: 'Ana' },
          },
        ],
      },
      {
        id: id(94),
        name: 'Depois de enviar',
        items: [{ id: id(98), name: 'Avisar o cliente', parentItemId: null, resolved: false, resolvedAt: null, assignee: null }],
      },
    ]);
    expect(task.checklistItemTotal).toBe(4);
    expect(task.links).toEqual([
      { id: id(110), label: 'Pasta da peça no Dropbox', url: 'https://www.dropbox.com/scl/fo/exemplo' },
      { id: id(111), label: 'Roteiro', url: 'https://docs.google.com/document/d/exemplo' },
    ]);
    expect(task.linkTotal).toBe(2);
    expect(task.createdBy).toEqual({ id: HELENA, name: 'Helena' });
    expect(task.completedBy).toBeNull();
    expect(task.createdVia).toBe('Claude da Carla');
    expect(task.createdAt).toBe('2026-09-18T13:00:00.000Z');
    expect(task.folder).toEqual({ id: F_HELENA, name: 'TIME HELENA' });
    expect(task.space).toEqual({ id: S_IDE, name: 'CLIENTES' });

    // O livro, do mais antigo ao mais novo, em frases; regra e IA marcadas.
    expect(task.history?.map((e) => [e.by, e.automation, e.via, e.changes])).toEqual([
      ['Helena', false, null, ['alterou o status de A fazer para Aprovação']],
      ['Helena', false, null, ['alterou o status de Pauta Secreta da Alma para A fazer', 'alterou a lista de Lista Secreta da Alma para Redes sociais']],
      ['Regra: aprovou, avisa', true, 'Claude da Carla', ['alterou o status de A fazer para Aprovação']],
      ['Helena', false, null, ['trocou o cliente de Sabor Doce para Jatobá']],
      ['Helena', false, null, ['removeu o responsável: Murilo', 'adicionou o responsável: Ana']],
    ]);
    expect(task.historyTotal).toBe(5);
    // O que já vinha continua igual.
    expect(task).toMatchObject({ id: T_FICHA, title: 'Peça da campanha', client: { id: C_A, name: 'Jatobá' } });
  });

  it('empresa omitida (Alma9): a lista e a etapa dela nunca aparecem no histórico', async () => {
    const { task } = await ler(grant(), semAlma);
    const texto = JSON.stringify(task);
    expect(texto).not.toContain('Alma');
    expect(texto).not.toContain('Secreta');
    // O fato continua, só sem o nome do que está fora: "moveu para a lista", sem "de onde".
    expect(task.history?.[1]?.changes).toEqual(['pôs o status em A fazer', 'moveu para a lista Redes sociais']);
  });

  it('concessão que não cobre o cliente antigo: o nome dele não aparece no "trocou o cliente"', async () => {
    const { task } = await ler(grant({ allowedClientIds: [C_A] }));
    expect(JSON.stringify(task)).not.toContain('Sabor Doce');
    expect(task.history?.[3]?.changes).toEqual(['definiu o cliente Jatobá']);
  });

  it('mãe fora do recorte de cliente: parentId e parentTitle nulos; a mãe do mesmo cliente aparece', async () => {
    const fora = await ler(grant({ allowedClientIds: [C_A] }), topo, T_FILHA_FORA);
    expect(fora.task.parentId).toBeNull();
    expect(fora.task.parentTitle).toBeNull();
    expect(JSON.stringify(fora)).not.toContain('Mãe do outro cliente');
    const dentro = await ler(grant(), topo, T_FILHA_FORA);
    expect(dentro.task.parentTitle).toBe('Mãe do outro cliente');
  });

  it('sem people:read: seguidores, criador, responsável de item e quem agiu vêm nulos; a frase de gente some', async () => {
    const { task } = await ler(grant({ capabilities: CAPACIDADES.filter((c) => c !== 'people:read') }));
    expect(task.watchers).toBeNull();
    expect(task.createdBy).toBeNull();
    expect(task.completedBy).toBeNull();
    expect(task.checklists?.flatMap((l) => l.items.map((i) => i.assignee))).toEqual([null, null, null, null]);
    expect(task.history?.every((e) => e.by === null || e.automation)).toBe(true);
    expect(task.history?.flatMap((e) => e.changes).join('|')).not.toMatch(/responsável/);
    // O fato só de gente (trocar responsáveis) sai por inteiro.
    expect(task.history).toHaveLength(4);
    expect(task.historyTotal).toBe(4);
    expect(JSON.stringify(task)).not.toMatch(/Helena|Murilo|"Ana"/);
    // O que não é gente fica: a conexão de IA e a regra.
    expect(task.createdVia).toBe('Claude da Carla');
  });

  it('sem boards:read: pasta e espaço só com id; lista e etapa somem do histórico', async () => {
    const { task } = await ler(grant({ capabilities: CAPACIDADES.filter((c) => c !== 'boards:read') }));
    expect(task.folder).toEqual({ id: F_HELENA, name: null });
    expect(task.space).toEqual({ id: S_IDE, name: null });
    expect(task.history?.flatMap((e) => e.changes).join('|')).not.toMatch(/lista|status/);
  });

  it('sem clients:read: o nome do cliente some do histórico', async () => {
    const { task } = await ler(grant({ capabilities: CAPACIDADES.filter((c) => c !== 'clients:read') }));
    expect(task.client).toBeNull();
    expect(task.history?.flatMap((e) => e.changes).join('|')).not.toMatch(/cliente/);
  });

  it('a primeira página leva a ficha; a continuação da conversa não a repete', async () => {
    const primeira = await ler(grant());
    expect(primeira.task.history).toBeDefined();
    expect(primeira.hasMore).toBe(false);
  });

  it('tetos: 15 checklists, 60 itens, 30 links e os 30 fatos mais recentes, cada um com o total', async () => {
    const { task } = await ler(grant(), topo, T_CHEIA);
    expect(task.checklists).toHaveLength(15);
    expect(task.checklists?.reduce((n, l) => n + l.items.length, 0)).toBe(60);
    expect(task.checklistItemTotal).toBe(160);
    expect(task.links).toHaveLength(30);
    expect(task.linkTotal).toBe(45);
    expect(task.history).toHaveLength(30);
    expect(task.historyTotal).toBe(50);
    // Cortado, ficam os MAIS RECENTES (o último fato do livro está lá).
    const ultimos = task.history?.map((e) => e.at) ?? [];
    expect([...ultimos].sort()).toEqual(ultimos);
    expect(ultimos.at(-1)).toBe('2026-09-10T10:50:00.000Z');
    expect(ultimos[0]).toBe('2026-09-10T10:21:00.000Z');
  });
});

describe('list_tags no banco', () => {
  const NAO_ACHADO = (m: string) => ({ ok: false, code: 'not_found', message: m });
  const tags = async (g: IntegrationGrant, input: Parameters<typeof listTagsWork>[1], pessoa: PersonAccess = topo) =>
    listTagsWork(ctxDe(g, pessoa), input);

  it('por spaceId e por listId: as etiquetas do espaço, por nome', async () => {
    const porEspaco = await tags(grant(), { spaceId: S_IDE });
    if (!porEspaco.ok) throw new Error(porEspaco.message);
    expect(porEspaco.body.tags.map((t) => t.name)).toEqual(['arte final', 'Reels', 'Urgente']);
    expect(porEspaco.body.tags[1]).toEqual({ id: id(80), name: 'Reels', bgColor: '#7c3aed', fgColor: '#ffffff' });
    expect(porEspaco.body.space).toEqual({ id: S_IDE, name: 'CLIENTES', company: { id: IDE, name: 'Ide' } });
    expect(porEspaco.body.list).toBeNull();
    const porLista = await tags(grant(), { listId: L_A });
    if (!porLista.ok) throw new Error(porLista.message);
    expect(porLista.body.list).toEqual({ id: L_A, name: 'Redes sociais' });
    expect(porLista.body.tags.map((t) => t.id)).toEqual(porEspaco.body.tags.map((t) => t.id));
  });

  it('empresa omitida e empresa fora da concessão: o espaço, a lista e as etiquetas não existem', async () => {
    expect(await tags(grant(), { spaceId: S_ALMA }, semAlma)).toEqual(NAO_ACHADO('Espaço não encontrado neste recorte.'));
    expect(await tags(grant(), { listId: L_ALMA }, semAlma)).toEqual(NAO_ACHADO('Lista não encontrada neste recorte.'));
    const soIde = grant({ allowedCompanyIds: [IDE] });
    expect(await tags(soIde, { spaceId: S_ALMA })).toEqual(NAO_ACHADO('Espaço não encontrado neste recorte.'));
    const soAlma = grant({ allowedCompanyIds: [ALMA] });
    expect(await tags(soAlma, { spaceId: S_IDE })).toEqual(NAO_ACHADO('Espaço não encontrado neste recorte.'));
    // Sem omitir, a mesma pessoa as vê.
    const vista = await tags(grant(), { spaceId: S_ALMA });
    expect(vista.ok && vista.body.tags.map((t) => t.name)).toEqual(['Segredo da Alma']);
  });

  it('outro cliente da mesma empresa: a lista dele é recusada; o espaço só vale com lista do cliente concedido', async () => {
    const soClienteA = grant({ allowedClientIds: [C_A] });
    expect(await tags(soClienteA, { listId: L_B })).toEqual(NAO_ACHADO('Lista não encontrada neste recorte.'));
    expect((await tags(soClienteA, { listId: L_A })).ok).toBe(true);
    expect((await tags(soClienteA, { spaceId: S_IDE })).ok).toBe(true);
    const soOutroCliente = grant({ allowedClientIds: [C_ALMA] });
    expect(await tags(soOutroCliente, { spaceId: S_IDE })).toEqual(NAO_ACHADO('Espaço não encontrado neste recorte.'));
  });

  it('sem boards:read: permission_denied; id que não é uuid e inexistente: not_found', async () => {
    const sem = await tags(grant({ capabilities: ['tasks:read'] }), { spaceId: S_IDE });
    expect(sem.ok === false && sem.code).toBe('permission_denied');
    expect((await tags(grant(), { spaceId: 'nao-e-uuid' })).ok).toBe(false);
    expect(await tags(grant(), { spaceId: id(777) })).toEqual(NAO_ACHADO('Espaço não encontrado neste recorte.'));
  });

  it('muitas etiquetas: o cursor anda até o fim contra o banco', async () => {
    await db.exec(`
      insert into ideworks.task_tags(space_id, name)
        select '${S_IDE}', 'Etiqueta ' || lpad(n::text, 3, '0') from generate_series(1, 130) n;`);
    const vistas: string[] = [];
    let cursor: string | undefined;
    let voltas = 0;
    do {
      const pagina = await tags(grant(), { spaceId: S_IDE, limit: 40, cursor });
      if (!pagina.ok) throw new Error(pagina.message);
      expect(pagina.body.total).toBe(133);
      vistas.push(...pagina.body.tags.map((t) => t.name));
      cursor = pagina.body.nextCursor ?? undefined;
      voltas += 1;
    } while (cursor && voltas < 10);
    expect(vistas).toHaveLength(133);
    expect(new Set(vistas).size).toBe(133);
    expect([...vistas].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'))).toEqual(vistas);
  });
});
