/**
 * O AGENTE DE IA SEM A EMPRESA OMITIDA, CONTRA UM POSTGRES DE VERDADE — F31, Fase 3b.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   As leituras SQL do agente — quadro, tarefa, cliente, busca, pessoas,
 *   trabalho da pessoa, relatório de entrega e de marketing — rodando o MESMO
 *   código de `sql-work.ts`, `reports.ts` e `marketing.ts` sobre o PGlite, com
 *   o recorte montado pelo caminho de produção: `toWorkScope(pessoa,
 *   concessão)`, com a pessoa carregando `omittedCompanyIds`. Ligada, nada da
 *   Alma9 volta; desligada, tudo volta, e as consultas não levam trecho novo.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha e as funções de concessão do banco
 *   (`integration_allows_company`, `integration_allows_client`) — aqui elas
 *   dizem "sim" para tudo, porque a F31 não mexe nelas: o recorte da omissão é
 *   uma cláusula A MAIS, que só pode tirar linha.
 *
 * NENHUMA REDE: o PGlite roda no próprio processo; a conexão da requisição
 * (`borrowSql`) é trocada pelo adaptador.
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import type { Tx } from '@/server/db';

/* ───────────────────────────── o adaptador ───────────────────────────── */

type Fragmento = {
  readonly dublê: true;
  readonly strings: readonly string[];
  readonly args: readonly unknown[];
};

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

/** Liga para a PRÓXIMA transação falhar — a conferência das omitidas quebrando. */
let falharProximaTransacao = false;

const sql = {
  begin: (trabalho: (t: Tx) => Promise<unknown>) => {
    if (falharProximaTransacao) {
      falharProximaTransacao = false;
      return Promise.reject(new Error('conexão caiu'));
    }
    return trabalho(tx);
  },
};

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (s: unknown) => Promise<unknown>) => work(sql),
}));

const { toWorkScope } = await import('@/integrations/reads');
const { SqlWorkCatalog } = await import('@/integrations/sql-work');
const { SqlMarketingCatalog } = await import('@/integrations/marketing');
const { SqlDeliveryCatalog } = await import('@/integrations/reports');
const { createSqlGrantStore } = await import('@/integrations/handler');
const { sqlLedger } = await import('@/integrations/executions');
const { esquecerResolucoes } = await import('@/server/omitidas');

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const IDE = id(1);
const ALMA = id(3);
const C_IDE = id(10);
const C_ALMA = id(11);
const S_IDE = id(20);
const S_ALMA = id(21);
const L_IDE = id(40);
const L_ALMA = id(41);
/** Lista no espaço da Alma9 ligada a cliente da Ide: sai da ficha do cliente. */
const L_ALMA_DO_CIDE = id(42);
const F_IDE = id(30);
const F_ALMA = id(31);
const L_IDE_PASTA = id(43);
const SET_ESPACO_IDE = id(400);
const SET_ESPACO_ALMA = id(401);
const SET_PASTA_IDE = id(402);
const T_IDE = id(50);
const T_ALMA = id(51);
const P_IDE = id(60);
const P_ALMA = id(61);
const P_AMBOS = id(62);
const EU = id(99);

const A_IDE = id(100);
const A_ALMA = id(101);
const A_ALMA_CIDE = id(102);
const A_IDE_CALMA = id(103);

const ATOR = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };

const grant: IntegrationGrant = {
  id: id(200),
  ownerId: EU,
  oauthClientId: 'cliente-oauth',
  name: 'Claude',
  capabilities: [
    'boards:read',
    'tasks:read',
    'clients:read',
    'people:read',
    'comments:read',
    'reports:delivery:read',
    'reports:marketing:read',
  ],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const desligada: PersonAccess = {
  userId: EU,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [IDE, ALMA],
  clientIds: [],
  hasAllClientsAccess: true,
};
const ligada: PersonAccess = { ...desligada, omittedCompanyIds: [ALMA] };

const agora = new Date('2026-09-25T12:00:00Z');
const escopo = (pessoa: PersonAccess, g: IntegrationGrant = grant) => toWorkScope(pessoa, g, agora);
const trabalho = () => new SqlWorkCatalog({} as never, ATOR as never);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create table ideworks.client_categories(id uuid primary key, name text, is_default boolean default false);
    create table ideworks.profiles(id uuid primary key, is_active boolean, is_superadmin boolean, role text,
      has_all_clients_access boolean);
    create table ideworks.user_clients(user_id uuid, client_id uuid);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid,
      is_active boolean default true, inactive_at timestamptz,
      -- G5: o cadastro que o get_client e o list_clients leem (nunca o contato).
      plan_id uuid, urgency text not null default 'paz', finance_ok boolean not null default false,
      started_on date, renews_on date);
    create table ideworks.plans(id uuid primary key, name text);
    create table ideworks.client_tags(id uuid primary key, name text, color text);
    create table ideworks.client_tag_assignments(client_id uuid, tag_id uuid);
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
    create view ideworks.list_workflow as
      select null::uuid as list_id, null::uuid as status_id, null::text as status_name, null::text as status_type, 0 as status_sort_order
       where false;
    create table ideworks.status_sets(id uuid primary key, name text, space_id uuid, folder_id uuid, list_id uuid);
    create table ideworks.statuses(id uuid primary key, status_set_id uuid, name text, type text, sort_order int);
    create function ideworks.resolve_status_set(p_list_id uuid) returns uuid language sql stable as $$
      select coalesce(
        (select ss.id from ideworks.status_sets ss where ss.list_id = p_list_id),
        (select ss.id from ideworks.status_sets ss join ideworks.lists l on l.folder_id = ss.folder_id where l.id = p_list_id),
        (select ss.id from ideworks.status_sets ss join ideworks.lists l on l.space_id = ss.space_id where l.id = p_list_id))
    $$;
    -- F40: a regra do banco (a etapa "atribuir demanda" na esteira efetiva), sem o acento da migration.
    create function ideworks.list_is_production(p_list_id uuid) returns boolean language sql stable as $$
      select exists (select 1 from ideworks.statuses s
                      where s.status_set_id = ideworks.resolve_status_set(p_list_id)
                        and lower(btrim(s.name)) = 'atribuir demanda')
    $$;
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, title text, description text,
      due_on date, start_on date, priority text, demand_type text, status_id uuid, archived_at timestamptz, completed_at timestamptz,
      -- F38, Fase 6.4: o get_task lista as subtarefas (filhas por parent_id, ordem de criação).
      parent_id uuid, created_at timestamptz not null default now(),
      -- G6: quem criou/concluiu e a conexão de IA de origem (a ficha inteira do get_task).
      created_by uuid, completed_by uuid, via_name text);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    -- G6: o que o get_task lê além do núcleo (etiquetas, seguidores, passos, links, histórico).
    create table ideworks.task_labels(task_id uuid, tags jsonb);
    create table ideworks.task_watchers(task_id uuid, user_id uuid);
    create table ideworks.task_checklists(id uuid primary key, task_id uuid, name text, sort_order int default 0,
      created_at timestamptz default now());
    create table ideworks.checklist_items(id uuid primary key, checklist_id uuid, parent_item_id uuid, name text,
      sort_order int default 0, resolved_at timestamptz, assignee_id uuid, created_at timestamptz default now());
    create table ideworks.task_links(id uuid primary key, task_id uuid, label text, url text, sort_order int default 0,
      created_at timestamptz default now());
    create table ideworks.task_events(id uuid primary key default gen_random_uuid(), task_id uuid,
      automation_name text, occurred_at timestamptz default now(), via_name text, actor_id uuid,
      from_list_id uuid, to_list_id uuid, from_status_id uuid, to_status_id uuid,
      from_client_id uuid, to_client_id uuid, removed_user_ids uuid[] not null default '{}'::uuid[],
      added_user_id uuid, added_user_ids uuid[] not null default '{}'::uuid[]);
    create table ideworks.task_comments(id uuid primary key, task_id uuid, parent_id uuid, body text,
      created_at timestamptz default now(), author_id uuid,
      -- F42: o comentário do cliente e o vínculo com a rodada (get_task, Fase 7).
      from_client boolean not null default false, approval_round_id uuid, approval_item_id uuid);
    create table ideworks.approval_rounds(id uuid primary key, task_id uuid, client_id uuid, version int,
      state text, sent_at timestamptz default now(), sent_by uuid, decided_at timestamptz,
      decided_via text, decision_comment_id uuid, closed_at timestamptz);
    create table ideworks.approval_round_items(id uuid primary key, round_id uuid, position int,
      dropbox_url text, kind text, file_name text, storage_path text);
    -- O link do cliente existe no banco e NÃO pode sair pelo get_task.
    create table ideworks.client_approval_links(client_id uuid, token_hash text, token_ciphertext text);
    create table ideworks.user_categories(user_id uuid, category_id uuid);
    create table ideworks.people(id uuid primary key, name text);
    create function ideworks.team_directory() returns table(id uuid, name text) language sql as
      $$ select id, name from ideworks.people $$;
    create function ideworks.display_name(u uuid) returns text language sql as
      $$ select name from ideworks.people where id = u $$;
    create function ideworks.integration_allows_company(c uuid) returns boolean language sql as $$ select true $$;
    create function ideworks.integration_allows_client(c uuid) returns boolean language sql as $$ select true $$;
    create function ideworks.client_board_lists(c uuid)
      returns table(id uuid, name text, archived boolean, space_id uuid, space_name text, folder_id uuid, folder_name text)
      language sql as $$
        select l.id, l.name, l.archived_at is not null, s.id, s.name, null::uuid, null::text
          from ideworks.lists l join ideworks.spaces s on s.id = l.space_id
         where l.client_id = c
      $$;

    create table ideworks.meta_assets(id uuid primary key, kind text, display_name text, external_id text,
      client_id uuid, category_id uuid, last_seen_at timestamptz);
    create table ideworks.meta_daily_campaign(asset_id uuid, day date, campaign_id text, campaign_name text,
      spend numeric, reach numeric, impressions numeric, clicks numeric, link_clicks numeric,
      conversions numeric, conversion_value numeric, collected_at timestamptz);
    create table ideworks.meta_daily_organic(asset_id uuid, day date, reach numeric, views numeric,
      accounts_engaged numeric, total_interactions numeric, follows numeric, unfollows numeric,
      profile_links_taps numeric, likes numeric, comments numeric, shares numeric, saves numeric,
      followers_total numeric, media_count numeric, collected_at timestamptz);
    create table ideworks.meta_collection_runs(started_at timestamptz, finished_at timestamptz, outcome text,
      window_from date, window_to date);

    create table ideworks.month_contracts(id uuid primary key, client_id uuid, reference_month date);
    create table ideworks.month_contract_items(contract_id uuid, content_type text, quantity int);
    create table ideworks.client_quotas(client_id uuid, content_type text, quantity int);
    create table ideworks.content_items(client_id uuid, reference_month date, content_type text,
      is_extra boolean default false, scheduled_at timestamptz, completed_at timestamptz);

    insert into ideworks.client_categories values ('${IDE}', 'Ide', false), ('${ALMA}', 'Alma9', false);
    insert into ideworks.profiles values ('${EU}', true, true, 'super_admin', true);
    insert into ideworks.clients values ('${C_IDE}', 'Alfa Ide', '${IDE}'), ('${C_ALMA}', 'Alfa Alma', '${ALMA}');
    insert into ideworks.spaces values ('${S_IDE}', '${IDE}', 'CLIENTES', null), ('${S_ALMA}', '${ALMA}', 'CLIENTES', null);
    insert into ideworks.lists values
      ('${L_IDE}', '${S_IDE}', null, 'Alfa lista Ide', '${C_IDE}', null),
      ('${L_ALMA}', '${S_ALMA}', null, 'Alfa lista Alma', '${C_ALMA}', null),
      ('${L_ALMA_DO_CIDE}', '${S_ALMA}', null, 'Alfa lista Alma do cliente Ide', '${C_IDE}', null);
    insert into ideworks.folders values
      ('${F_IDE}', '${S_IDE}', 'Pasta Ide', null), ('${F_ALMA}', '${S_ALMA}', 'Pasta Alma', null);
    insert into ideworks.lists values ('${L_IDE_PASTA}', '${S_IDE}', '${F_IDE}', 'Beta lista na pasta Ide', null, null);
    insert into ideworks.status_sets values
      ('${SET_ESPACO_IDE}', 'Padrão Ide', '${S_IDE}', null, null),
      ('${SET_ESPACO_ALMA}', 'Padrão Alma', '${S_ALMA}', null, null),
      ('${SET_PASTA_IDE}', 'Esteira da pasta Ide', null, '${F_IDE}', null);
    insert into ideworks.statuses values
      ('${id(410)}', '${SET_ESPACO_IDE}', 'Fechado', 'closed', 1),
      ('${id(411)}', '${SET_ESPACO_IDE}', 'A fazer', 'unstarted', 0),
      ('${id(412)}', '${SET_ESPACO_ALMA}', 'A fazer Alma', 'unstarted', 0),
      ('${id(413)}', '${SET_PASTA_IDE}', 'Pauta', 'open', 0),
      ('${id(414)}', '${SET_PASTA_IDE}', 'Aprovado', 'done', 1),
      ('${id(415)}', '${SET_PASTA_IDE}', 'Fim', 'closed', 2);
    insert into ideworks.tasks(id, list_id, client_id, title) values
      ('${T_IDE}', '${L_IDE}', '${C_IDE}', 'Alfa tarefa Ide'),
      ('${T_ALMA}', '${L_ALMA}', '${C_ALMA}', 'Alfa tarefa Alma');
    insert into ideworks.people values
      ('${P_IDE}', 'Alfa pessoa Ide'), ('${P_ALMA}', 'Alfa pessoa Alma'), ('${P_AMBOS}', 'Alfa pessoa das duas'),
      ('${EU}', 'Wesley');
    insert into ideworks.user_categories values
      ('${P_IDE}', '${IDE}'), ('${P_ALMA}', '${ALMA}'), ('${P_AMBOS}', '${ALMA}'), ('${P_AMBOS}', '${IDE}'),
      ('${EU}', '${IDE}'), ('${EU}', '${ALMA}');
    insert into ideworks.task_assignees values ('${T_IDE}', '${EU}'), ('${T_ALMA}', '${EU}');

    insert into ideworks.meta_assets values
      ('${A_IDE}', 'ad_account', 'Conta Ide', 'act_1', '${C_IDE}', '${IDE}', null),
      ('${A_ALMA}', 'ad_account', 'Conta Alma', 'act_2', null, '${ALMA}', null),
      ('${A_ALMA_CIDE}', 'ad_account', 'Conta Alma do cliente Ide', 'act_3', '${C_IDE}', '${ALMA}', null),
      ('${A_IDE_CALMA}', 'ad_account', 'Conta Ide do cliente Alma', 'act_4', '${C_ALMA}', '${IDE}', null);
    insert into ideworks.meta_daily_campaign(asset_id, day, campaign_id, spend)
      select id, '2026-09-10', 'c-' || external_id, 10 from ideworks.meta_assets;

    insert into ideworks.month_contracts values ('${id(300)}', '${C_IDE}', '2026-09-01'), ('${id(301)}', '${C_ALMA}', '2026-09-01');
    insert into ideworks.month_contract_items values ('${id(300)}', 'video', 8), ('${id(301)}', 'video', 8);
    insert into ideworks.content_items(client_id, reference_month, content_type) values
      ('${C_IDE}', '2026-09-01', 'video'), ('${C_ALMA}', '2026-09-01', 'video');
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(() => {
  textos = [];
  falharProximaTransacao = false;
  esquecerResolucoes();
});

const JANELA = { limit: 50, cursor: null };

/* ───────────────────────────── o recorte ───────────────────────────── */

describe('F31.3b — o recorte do agente sai de effectiveCompanies', () => {
  it('desligada: o recorte é o de antes da F31, campo a campo (sem `omitted`)', () => {
    expect(escopo(desligada).companies).toEqual({ kind: 'all' });
  });

  it('ligada: "todas menos a omitida", sem mudar o `kind` que o contrato mostra', () => {
    const r = escopo(ligada).companies;
    expect(r.kind).toBe('all');
    expect(r.kind === 'all' && [...(r.omitted ?? [])]).toEqual([ALMA]);
  });
});

/* ───────────────────────────── a esteira (F37) ───────────────────────────── */

describe('F37 — get_workflow no banco: esteira de lista e pasta, com origem e recorte', () => {
  it('lista sem esteira própria herda do espaço; lista na pasta herda da pasta, etapas em ordem', async () => {
    const espaco = await trabalho().getWorkflow(escopo(ligada), { kind: 'list', id: L_IDE });
    expect(espaco?.inheritedFrom).toBe('space');
    expect(espaco?.owner).toEqual({ kind: 'space', id: S_IDE, name: 'CLIENTES' });
    expect(espaco?.stages.map((e) => [e.name, e.type])).toEqual([
      ['A fazer', 'unstarted'],
      ['Fechado', 'closed'],
    ]);

    const pasta = await trabalho().getWorkflow(escopo(ligada), { kind: 'list', id: L_IDE_PASTA });
    expect(pasta?.inheritedFrom).toBe('folder');
    expect(pasta?.owner).toEqual({ kind: 'folder', id: F_IDE, name: 'Pasta Ide' });
    expect(pasta?.name).toBe('Esteira da pasta Ide');
    expect(pasta?.company).toEqual({ id: IDE, name: 'Ide' });
    expect(pasta?.stages.map((e) => e.name)).toEqual(['Pauta', 'Aprovado', 'Fim']);
  });

  it('pasta: a esteira da pasta; pasta sem esteira própria mostra a do espaço', async () => {
    const propria = await trabalho().getWorkflow(escopo(desligada), { kind: 'folder', id: F_IDE });
    expect(propria?.inheritedFrom).toBe('folder');
    expect(propria?.target).toEqual({ kind: 'folder', id: F_IDE, name: 'Pasta Ide' });
    const herdada = await trabalho().getWorkflow(escopo(desligada), { kind: 'folder', id: F_ALMA });
    expect(herdada?.inheritedFrom).toBe('space');
    expect(herdada?.stages.map((e) => e.name)).toEqual(['A fazer Alma']);
  });

  it('ligada: lista e pasta da Alma9 são "não encontradas"; desligada, voltam', async () => {
    expect(await trabalho().getWorkflow(escopo(ligada), { kind: 'list', id: L_ALMA })).toBeNull();
    expect(await trabalho().getWorkflow(escopo(ligada), { kind: 'folder', id: F_ALMA })).toBeNull();
    expect((await trabalho().getWorkflow(escopo(desligada), { kind: 'list', id: L_ALMA }))?.target.id).toBe(L_ALMA);
  });

  it('id que não é uuid ou que não existe é null, sem consulta quebrada', async () => {
    expect(await trabalho().getWorkflow(escopo(ligada), { kind: 'list', id: 'nao-uuid' })).toBeNull();
    expect(await trabalho().getWorkflow(escopo(ligada), { kind: 'folder', id: id(998) })).toBeNull();
  });
});

/* ───────────────────────────── as leituras do trabalho ───────────────────────────── */

describe('F38, Fase 4 — cliente cancelado na busca e na ficha, no Postgres', () => {
  it('cancelado: volta só pelo começo do nome e mínimo; nem ele nem a tarefa e a lista dele por outra palavra', async () => {
    await db.exec(`update ideworks.clients set is_active = false, inactive_at = '2025-12-30 15:00+00' where id = '${C_IDE}'`);
    try {
      const pelo = await trabalho().search(escopo(desligada), 'ALFA ide', ['board', 'task', 'client'], JANELA);
      expect(pelo).toEqual([
        {
          kind: 'client',
          id: C_IDE,
          title: 'Alfa Ide',
          detail: 'cancelado em 30/12/2025',
          board: null,
          client: null,
          company: null,
          cancelled: true,
          cancelledOn: '2025-12-30',
        },
      ]);
      // "ide" está no nome, mas não no começo: o cancelado não volta; a tarefa
      // e as listas dele também não.
      const outra = await trabalho().search(escopo(desligada), 'ide', ['board', 'task', 'client'], JANELA);
      expect(outra.map((h) => h.id)).not.toContain(C_IDE);
      expect(outra.some((h) => h.client?.id === C_IDE)).toBe(false);
      // Meio de palavra não casa.
      expect(await trabalho().search(escopo(desligada), 'alf', ['client'], JANELA)).toEqual([
        expect.objectContaining({ id: C_ALMA }),
      ]);

      expect(await trabalho().getClient(escopo(desligada), C_IDE)).toEqual({
        id: C_IDE,
        name: 'Alfa Ide',
        cancelled: true,
        cancelledOn: '2025-12-30',
      });
      expect((await trabalho().getTask(escopo(desligada), T_IDE))?.id).toBe(T_IDE);
    } finally {
      await db.exec(`update ideworks.clients set is_active = true, inactive_at = null where id = '${C_IDE}'`);
    }
  });
});

describe('F38, Fase 6.2 — cancelado fora do trabalho da pessoa e do marketing, no Postgres', () => {
  const T_LISTA_CANCELADA = id(52);
  const marketing = () => new SqlMarketingCatalog({} as never, ATOR as never);

  it('get_person_work: a tarefa do cancelado sai da lista e das contagens, pelo cliente dela ou da lista', async () => {
    await db.exec(`
      insert into ideworks.tasks(id, list_id, client_id, title, completed_at)
        values ('${T_LISTA_CANCELADA}', '${L_IDE}', null, 'Alfa sem cliente na lista Ide', now());
      insert into ideworks.task_assignees values ('${T_LISTA_CANCELADA}', '${EU}');`);
    try {
      const antes = await trabalho().getPersonWork(escopo(desligada), EU);
      expect(antes?.tasks.map((t) => t.id).sort()).toEqual([T_IDE, T_ALMA, T_LISTA_CANCELADA].sort());
      expect(antes?.counts).toEqual({ tasks: 3, open: 2, done: 1 });

      await db.exec(`update ideworks.clients set is_active = false, inactive_at = '2025-12-30 15:00+00' where id = '${C_IDE}'`);
      const depois = await trabalho().getPersonWork(escopo(desligada), EU, { limit: 50, cursor: null });
      expect(depois?.tasks.map((t) => t.id)).toEqual([T_ALMA]);
      expect(depois?.counts).toEqual({ tasks: 1, open: 1, done: 0 });
    } finally {
      await db.exec(`
        update ideworks.clients set is_active = true, inactive_at = null where id = '${C_IDE}';
        delete from ideworks.task_assignees where task_id = '${T_LISTA_CANCELADA}';
        delete from ideworks.tasks where id = '${T_LISTA_CANCELADA}';`);
    }
  });

  it('get_marketing_report: o cancelado conta até o mês do cancelamento, inclusive, e some depois', async () => {
    await db.exec(`
      insert into ideworks.meta_daily_campaign(asset_id, day, campaign_id, spend)
        values ('${A_IDE}', '2026-10-02', 'c-act_1', 7);
      update ideworks.clients set is_active = false, inactive_at = '2026-09-30 23:30-03' where id = '${C_IDE}';`);
    try {
      // Cancelado em 30/09 (São Paulo): setembro inteiro conta, outubro não.
      const dosDois = await marketing().load(escopo(desligada), { from: '2026-09-01', to: '2026-10-31' });
      expect(dosDois.assets.map((a) => a.id)).toContain(A_IDE);
      expect(dosDois.paidDays.filter((d) => d.assetId === A_IDE).map((d) => d.day)).toEqual(['2026-09-10']);

      const outubro = await marketing().load(escopo(desligada), { from: '2026-10-01', to: '2026-10-31' });
      const ids = outubro.assets.map((a) => a.id);
      expect(ids).not.toContain(A_IDE);
      expect(ids).not.toContain(A_ALMA_CIDE);
      // Conta sem cliente e conta de cliente ativo continuam.
      expect(ids).toEqual(expect.arrayContaining([A_ALMA, A_IDE_CALMA]));
      expect(outubro.paidDays.some((d) => d.assetId === A_IDE)).toBe(false);
    } finally {
      await db.exec(`
        update ideworks.clients set is_active = true, inactive_at = null where id = '${C_IDE}';
        delete from ideworks.meta_daily_campaign where asset_id = '${A_IDE}' and day = '2026-10-02';`);
    }
  });
});

describe('F38, Fase 6.4 — get_task lista as subtarefas, no Postgres', () => {
  const PASSO_1 = id(53);
  const PASSO_2 = id(54);
  const ARQUIVADO = id(55);
  const LEGADO = id(56);
  const NETA = id(57);

  it('filhas diretas, não arquivadas, na ordem de criação, com etapa e conclusão; o recorte de cliente vale nelas', async () => {
    await db.exec(`
      insert into ideworks.tasks(id, list_id, client_id, title, status_id, parent_id, created_at, completed_at, archived_at) values
        ('${PASSO_2}', '${L_IDE}', '${C_IDE}', 'Passo 2', '${id(410)}', '${T_IDE}', '2026-09-02', now(), null),
        ('${PASSO_1}', '${L_IDE}', '${C_IDE}', 'Passo 1', '${id(411)}', '${T_IDE}', '2026-09-01', null, null),
        ('${ARQUIVADO}', '${L_IDE}', '${C_IDE}', 'Passo arquivado', null, '${T_IDE}', '2026-09-03', null, now()),
        ('${LEGADO}', '${L_IDE}', '${C_ALMA}', 'Passo legado de outro cliente', null, '${T_IDE}', '2026-09-04', null, null),
        ('${NETA}', '${L_IDE}', '${C_IDE}', 'Neta', null, '${PASSO_1}', '2026-09-05', null, null);`);
    try {
      const mae = await trabalho().getTask(escopo(desligada), T_IDE);
      expect(mae?.subtasks).toEqual([
        { id: PASSO_1, title: 'Passo 1', statusId: id(411), statusName: 'A fazer', completed: false },
        { id: PASSO_2, title: 'Passo 2', statusId: id(410), statusName: 'Fechado', completed: true },
        { id: LEGADO, title: 'Passo legado de outro cliente', statusId: null, statusName: null, completed: false },
      ]);
      expect(mae?.subtaskTotal).toBe(3);

      // A conexão recortada no cliente da mãe não vê a filha legada de outro cliente.
      const recortada = await trabalho().getTask(escopo(desligada, { ...grant, allowedClientIds: [C_IDE] }), T_IDE);
      expect(recortada?.subtasks?.map((t) => t.id)).toEqual([PASSO_1, PASSO_2]);
      expect(recortada?.subtaskTotal).toBe(2);

      // A filha tem as dela: a neta aparece no get_task da filha, não no da avó.
      expect((await trabalho().getTask(escopo(desligada), PASSO_1))?.subtasks?.map((t) => t.id)).toEqual([NETA]);
      expect((await trabalho().getTask(escopo(desligada), T_ALMA))?.subtasks).toEqual([]);
    } finally {
      await db.exec(`delete from ideworks.tasks where id in ('${NETA}');
        delete from ideworks.tasks where id in ('${PASSO_1}', '${PASSO_2}', '${ARQUIVADO}', '${LEGADO}');`);
    }
  });
});

describe('F42, Fase 7 — get_task traz as rodadas de aprovação, no Postgres, sem o link do cliente', () => {
  const RODADA_1 = id(700);
  const RODADA_2 = id(701);
  const ITEM_1 = id(710);
  const ITEM_2 = id(711);
  const FALA_ITEM = id(720);
  const FALA_DECISAO = id(721);
  const FALA_EQUIPE = id(722);
  const HASH = 'f'.repeat(64);
  const CIFRADO = 'segredo-cifrado-do-link';

  it('rodadas (a mais nova primeiro), itens na ordem, comentários do cliente com o item e a decisão; nada do link', async () => {
    await db.exec(`
      insert into ideworks.client_approval_links values ('${C_IDE}', '${HASH}', '${CIFRADO}');
      insert into ideworks.approval_rounds(id, task_id, client_id, version, state, sent_at, decided_at, decided_via, decision_comment_id, closed_at) values
        ('${RODADA_1}', '${T_IDE}', '${C_IDE}', 1, 'rejected', '2026-10-07T12:00:00Z', '2026-10-07T15:00:00Z', 'client_link', '${FALA_DECISAO}', null),
        ('${RODADA_2}', '${T_IDE}', '${C_IDE}', 2, 'open', '2026-10-08T12:00:00Z', null, null, null, null);
      insert into ideworks.approval_round_items(id, round_id, position, dropbox_url, kind, file_name) values
        ('${ITEM_2}', '${RODADA_1}', 2, 'https://www.dropbox.com/scl/fi/b/reels.mp4?rlkey=k&dl=0', 'video', 'reels.mp4'),
        ('${ITEM_1}', '${RODADA_1}', 1, 'https://www.dropbox.com/scl/fi/a/arte.jpg?rlkey=k&dl=0', 'image', 'arte.jpg');
      -- F42, Fase 9: a arte anexada — o caminho do balde não pode sair pelo get_task.
      insert into ideworks.approval_round_items(id, round_id, position, dropbox_url, kind, file_name, storage_path) values
        ('00000000-0000-0000-0000-00000000a173', '${RODADA_1}', 3, null, 'image', 'capa.png', 'aprovacoes/${RODADA_1}/3-capa.png');
      insert into ideworks.task_comments(id, task_id, body, created_at, author_id, from_client, approval_round_id, approval_item_id) values
        ('${FALA_ITEM}', '${T_IDE}', 'A cor da arte está escura.', '2026-10-07T14:00:00Z', null, true, '${RODADA_1}', '${ITEM_1}'),
        ('${FALA_DECISAO}', '${T_IDE}', 'Clareiem a arte e cortem 3 s do vídeo.', '2026-10-07T15:00:00Z', null, true, '${RODADA_1}', null),
        ('${FALA_EQUIPE}', '${T_IDE}', 'Ajustando.', '2026-10-07T16:00:00Z', '${EU}', false, null, null);`);
    try {
      const tarefa = await trabalho().getTask(escopo(desligada), T_IDE);
      expect(tarefa?.approvalRounds?.map((r) => [r.version, r.state])).toEqual([[2, 'open'], [1, 'rejected']]);
      const [aberta, reprovada] = tarefa?.approvalRounds ?? [];
      expect(aberta).toMatchObject({ decidedAt: null, decidedBy: null, items: [], clientComments: [] });
      expect(reprovada).toEqual({
        id: RODADA_1,
        version: 1,
        state: 'rejected',
        sentAt: '2026-10-07T12:00:00.000Z',
        decidedAt: '2026-10-07T15:00:00.000Z',
        decidedBy: 'client_link',
        closedAt: null,
        items: [
          { position: 1, kind: 'image', fileName: 'arte.jpg', source: 'dropbox', url: 'https://www.dropbox.com/scl/fi/a/arte.jpg?rlkey=k&dl=0' },
          { position: 2, kind: 'video', fileName: 'reels.mp4', source: 'dropbox', url: 'https://www.dropbox.com/scl/fi/b/reels.mp4?rlkey=k&dl=0' },
          { position: 3, kind: 'image', fileName: 'capa.png', source: 'attachment', url: null },
        ],
        clientComments: [
          { id: FALA_ITEM, body: 'A cor da arte está escura.', createdAt: '2026-10-07T14:00:00.000Z', itemPosition: 1, decision: false },
          { id: FALA_DECISAO, body: 'Clareiem a arte e cortem 3 s do vídeo.', createdAt: '2026-10-07T15:00:00.000Z', itemPosition: null, decision: true },
        ],
      });
      // Na conversa, o comentário do cliente vem marcado; o da equipe, não.
      const marcados = tarefa?.comments.filter((c) => c.fromClient).map((c) => c.id);
      expect(marcados).toEqual([FALA_ITEM, FALA_DECISAO]);
      expect(tarefa?.comments.find((c) => c.id === FALA_EQUIPE)).not.toHaveProperty('fromClient');
      // list_comments (SQL) também marca o do cliente, sem autor.
      const lista = (await trabalho().listComments(escopo(desligada), T_IDE)) ?? [];
      expect(lista.filter((c) => c.fromClient).map((c) => [c.id, c.author])).toEqual([[FALA_ITEM, null], [FALA_DECISAO, null]]);
      expect(lista.find((c) => c.id === FALA_EQUIPE)).not.toHaveProperty('fromClient');
      // E o link do cliente NUNCA sai: nem hash, nem cifrado, nem endereço.
      const tudo = JSON.stringify(tarefa);
      expect(tudo).not.toContain(HASH);
      expect(tudo).not.toContain(CIFRADO);
      expect(tudo).not.toContain('/aprovar/');
      expect(tudo).not.toContain('aprovacoes/');
      expect(tudo).not.toMatch(/token/i);
    } finally {
      await db.exec(`delete from ideworks.task_comments where id in ('${FALA_ITEM}', '${FALA_DECISAO}', '${FALA_EQUIPE}');
        delete from ideworks.approval_round_items; delete from ideworks.approval_rounds;
        delete from ideworks.client_approval_links;`);
    }
  });
});

describe('F31.3b — busca, quadro, tarefa, cliente, pessoas', () => {
  it('ligada: a busca não acha nada da Alma9 (quadro, tarefa, cliente, pessoa)', async () => {
    const hits = await trabalho().search(escopo(ligada), 'alfa', ['board', 'task', 'client', 'person'], JANELA);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.title).join(' | ')).not.toMatch(/Alma/);
    expect(hits.some((h) => h.company?.id === ALMA)).toBe(false);
    // A pessoa das duas empresas continua, com a equipe da Ide.
    const ambos = hits.find((h) => h.id === P_AMBOS);
    expect(ambos?.company).toEqual({ id: IDE, name: 'Ide' });
  });

  it('desligada: a busca acha as duas empresas, e nenhuma consulta leva recorte', async () => {
    const hits = await trabalho().search(escopo(desligada), 'alfa', ['board', 'task', 'client', 'person'], JANELA);
    expect(hits.map((h) => h.title)).toEqual(
      expect.arrayContaining(['Alfa lista Alma', 'Alfa tarefa Alma', 'Alfa Alma', 'Alfa pessoa Alma']),
    );
    for (const t of textos) expect(t).not.toMatch(/not \(\w+\.category_id = any/);
  });

  it('ligada: quadro e tarefa da Alma9 são "não encontrados"; os da Ide seguem', async () => {
    expect(await trabalho().getBoard(escopo(ligada), L_ALMA)).toBeNull();
    expect(await trabalho().getTask(escopo(ligada), T_ALMA)).toBeNull();
    expect(await trabalho().listComments(escopo(ligada), T_ALMA)).toBeNull();
    expect((await trabalho().getBoard(escopo(ligada), L_IDE))?.id).toBe(L_IDE);
    expect((await trabalho().getTask(escopo(ligada), T_IDE))?.id).toBe(T_IDE);
  });

  it('desligada: quadro e tarefa da Alma9 voltam', async () => {
    expect((await trabalho().getBoard(escopo(desligada), L_ALMA))?.id).toBe(L_ALMA);
    expect((await trabalho().getTask(escopo(desligada), T_ALMA))?.id).toBe(T_ALMA);
  });

  it('ligada: cliente da Alma9 não existe; o da Ide perde a lista que mora no espaço da Alma9', async () => {
    expect(await trabalho().getClient(escopo(ligada), C_ALMA)).toBeNull();
    expect(await trabalho().getClientMural(escopo(ligada), C_ALMA)).toBeNull();
    expect(await trabalho().getClientHistory(escopo(ligada), C_ALMA)).toBeNull();
    const ide = await trabalho().getClient(escopo(ligada), C_IDE);
    expect(ide && 'lists' in ide ? ide.lists.map((l) => l.id) : null).toEqual([L_IDE]);
  });

  it('desligada: as duas listas do cliente da Ide, e a consulta das listas é a de sempre', async () => {
    const ide = await trabalho().getClient(escopo(desligada), C_IDE);
    expect(ide && 'lists' in ide ? ide.lists.map((l) => l.id).sort() : null).toEqual([L_IDE, L_ALMA_DO_CIDE].sort());
    const listas = textos.find((t) => t.includes('client_board_lists'));
    expect(listas).not.toContain('space_id not in');
  });

  it('ligada: o diretório perde quem é SÓ da Alma9, e o trabalho da pessoa perde a tarefa da Alma9', async () => {
    const pessoas = await trabalho().listPeople(escopo(ligada));
    expect(pessoas.map((p) => p.id)).not.toContain(P_ALMA);
    expect(pessoas.find((p) => p.id === P_AMBOS)?.team).toEqual({ id: IDE, name: 'Ide' });
    const meu = await trabalho().getPersonWork(escopo(ligada), EU);
    expect(meu?.tasks.map((t) => t.id)).toEqual([T_IDE]);
    expect(await trabalho().getPersonWork(escopo(ligada), P_ALMA)).toBeNull();
  });

  it('concessão que lista a omitida continua valendo — só a omitida some', async () => {
    const comAlma = { ...grant, allowedCompanyIds: [IDE, ALMA] };
    const r = escopo(ligada, comAlma).companies;
    expect(r.kind === 'ids' && [...r.ids]).toEqual([IDE]);
    expect(await trabalho().getTask(escopo(ligada, comAlma), T_ALMA)).toBeNull();
    expect((await trabalho().getTask(escopo(ligada, comAlma), T_IDE))?.id).toBe(T_IDE);
    // Desligada, a mesma concessão volta a alcançar a Alma9.
    expect((await trabalho().getTask(escopo(desligada, comAlma), T_ALMA))?.id).toBe(T_ALMA);
  });
});

/* ───────────────────────────── relatórios ───────────────────────────── */

describe('F31.3b — relatório de entrega (e a tendência, que usa o mesmo recorte)', () => {
  const periodo = { months: ['2026-09-01'], from: '2026-09-01', to: '2026-09-30' };
  const entrega = () => new SqlDeliveryCatalog({} as never, ATOR as never);

  it('ligada: só o cliente da Ide, e só os itens dele', async () => {
    const r = await entrega().load(escopo(ligada), periodo as never);
    expect(r.clients.map((c) => c.id)).toEqual([C_IDE]);
    expect(new Set(r.items.map((i) => i.clientId))).toEqual(new Set([C_IDE]));
    expect(r.contracts.map((c) => c.clientId)).toEqual([C_IDE]);
  });

  it('desligada: os dois clientes, e nenhuma consulta com recorte', async () => {
    const r = await entrega().load(escopo(desligada), periodo as never);
    expect(r.clients.map((c) => c.id).sort()).toEqual([C_ALMA, C_IDE].sort());
    for (const t of textos) expect(t).not.toContain('not (c.category_id');
  });
});

describe('F31.3b — relatório de marketing (a mesma regra das telas da Meta)', () => {
  const marketing = () => new SqlMarketingCatalog({} as never, ATOR as never);
  const periodo = { from: '2026-09-01', to: '2026-09-30' };

  it('ligada: sai a conta da Alma9 e as duas divergentes; fica só a da Ide', async () => {
    const r = await marketing().load(escopo(ligada), periodo);
    expect(r.assets.map((a) => a.id)).toEqual([A_IDE]);
    expect(new Set(r.paidDays.map((d) => d.assetId))).toEqual(new Set([A_IDE]));
  });

  it('desligada: as quatro contas, e nenhuma consulta com recorte', async () => {
    const r = await marketing().load(escopo(desligada), periodo);
    expect(r.assets).toHaveLength(4);
    for (const t of textos) expect(t).not.toContain('omit_mc');
  });
});

/* ───────────────────────────── a pessoa do agente ───────────────────────────── */

describe('F31.3b — a pessoa lida pelo portão do agente leva as omitidas', () => {
  // O ambiente do Worker: só o que o porto precisa para "ter banco".
  const ambiente = (omitidas?: string) => ({
    IDEWORKS_SERVER_DB_USER: 'ideworks_app',
    IDEWORKS_SERVER_DB_PASSWORD: 'x',
    ...(omitidas === undefined ? {} : { IDEWORKS_EMPRESAS_OMITIDAS: omitidas }),
  });

  it('ligada: `omittedCompanyIds` com a Alma9, e o NOME de cada empresa para o consentimento', async () => {
    const pessoa = await createSqlGrantStore(ambiente('Alma9') as never).person(EU);
    expect(pessoa?.omittedCompanyIds).toEqual([ALMA]);
    expect(pessoa?.companyNames).toEqual({ [IDE]: 'Ide', [ALMA]: 'Alma9' });
    // A pessoa continua com a empresa: omitir não mexe em vínculo nenhum.
    expect(pessoa?.companyIds).toEqual(expect.arrayContaining([IDE, ALMA]));
  });

  it('desligada (ausente ou vazia): nem o campo existe, e nenhuma consulta a mais', async () => {
    for (const valor of [undefined, '']) {
      textos = [];
      const pessoa = await createSqlGrantStore(ambiente(valor) as never).person(EU);
      expect(pessoa).not.toHaveProperty('omittedCompanyIds');
      expect(textos.some((t) => t.includes('lower(name)'))).toBe(false);
    }
  });

  it('a conferência que falha NÃO derruba o agente: segue sem omitir, com aviso no log', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    falharProximaTransacao = true;
    const pessoa = await createSqlGrantStore(ambiente('Alma9') as never).person(EU);
    expect(pessoa?.userId).toBe(EU);
    expect(pessoa).not.toHaveProperty('omittedCompanyIds');
    expect(aviso.mock.calls.join(' ')).toContain('nada omitido');
    aviso.mockRestore();
  });
});

/* ───────────────────────────── o cliente pela empresa ───────────────────────────── */

/**
 * Auditoria de 08/10/2026 — desde a F17.32, `can_see_client` dá a quem é de
 * uma empresa (`user_categories`) TODOS os clientes dela. O agente lia só os
 * vínculos diretos (`user_clients`): quem enxerga os clientes pela empresa
 * tinha `get_client` recusado, as tarefas deles sumiam do recorte, as
 * escritas eram recusadas e o consentimento não listava cliente nenhum.
 */
describe('o cliente alcançado pela empresa (can_see_client, F17.32) chega ao agente', () => {
  const ELA = id(97);
  const ELE = id(96);
  const G_ELA = id(201);
  const ambiente = (omitidas?: string) => ({
    IDEWORKS_SERVER_DB_USER: 'ideworks_app',
    IDEWORKS_SERVER_DB_PASSWORD: 'x',
    ...(omitidas === undefined ? {} : { IDEWORKS_EMPRESAS_OMITIDAS: omitidas }),
  });

  beforeAll(async () => {
    // ELA: só da Ide, sem vínculo direto com cliente nenhum. ELE: das duas.
    await db.exec(`
      insert into ideworks.profiles values ('${ELA}', true, false, 'member', false), ('${ELE}', true, false, 'member', false);
      insert into ideworks.user_categories values ('${ELA}', '${IDE}'), ('${ELE}', '${IDE}'), ('${ELE}', '${ALMA}');
      create table ideworks.integration_grants(id uuid primary key, owner_id uuid, oauth_client_id text, name text,
        capabilities text[], allowed_company_ids uuid[], allowed_client_ids uuid[], expires_at timestamptz,
        revoked_at timestamptz, policy_version int, daily_write_limit int);
      insert into ideworks.integration_grants values
        ('${G_ELA}', '${ELA}', 'cliente-oauth', 'Claude', '{tasks:read,clients:read}', null, null, null, null, 1, null);
    `);
  });

  afterAll(async () => {
    await db.exec(`
      delete from ideworks.user_categories where user_id in ('${ELA}', '${ELE}');
      delete from ideworks.profiles where id in ('${ELA}', '${ELE}');
      drop table ideworks.integration_grants;
    `);
  });

  it('o portão lê os clientes da empresa dela — e nenhum de empresa que não é dela', async () => {
    const pessoa = await createSqlGrantStore(ambiente() as never).person(ELA);
    expect(pessoa?.clientIds).toEqual([C_IDE]);
  });

  it('get_client volta pelo recorte montado com essa pessoa; o cliente da outra empresa não', async () => {
    const pessoa = (await createSqlGrantStore(ambiente() as never).person(ELA))!;
    const recorte = toWorkScope(pessoa, { ...grant, ownerId: ELA }, agora);
    expect(await trabalho().getClient(recorte, C_IDE)).toMatchObject({ id: C_IDE });
    expect(await trabalho().getClient(recorte, C_ALMA)).toBeNull();
  });

  it('a escrita relê a pessoa com a mesma regra (loadGrant)', async () => {
    const lida = await sqlLedger(tx).loadGrant(G_ELA);
    expect(lida?.person.clientIds).toEqual([C_IDE]);
  });

  it('cliente de empresa omitida não entra pela empresa', async () => {
    const semOmissao = await createSqlGrantStore(ambiente() as never).person(ELE);
    expect([...(semOmissao?.clientIds ?? [])].sort()).toEqual([C_IDE, C_ALMA].sort());
    const comOmissao = await createSqlGrantStore(ambiente('Alma9') as never).person(ELE);
    expect(comOmissao?.clientIds).toEqual([C_IDE]);
  });
});
