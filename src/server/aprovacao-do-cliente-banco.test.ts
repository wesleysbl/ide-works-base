/**
 * A APROVAÇÃO DO CLIENTE, CONTRA UM POSTGRES DE VERDADE — F42, Fase 1.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   As quatro migrations da F42 Fase 1, aplicadas de verdade e duas vezes, sobre
 *   o mínimo de esquema que elas tocam. `resolve_status_set` (F17.2) e
 *   `status_for_move` (F17.80) são copiadas das migrations delas; `move_task` é
 *   a da parte 4 da F42 (o corpo da F17.80 com o nome da automação). O alcance
 *   (`can_see_client`, `can_see_list`, `can_act_on_task_id`…) é dublê: uma
 *   tabela diz quem alcança qual lista e qual cliente.
 *     · o link: um vivo por cliente; revogado, desligado e inativo não resolvem;
 *     · os destinos: etapa de outra esteira é recusada; etapa apagada deixa a
 *       configuração incompleta sem quebrar;
 *     · enviar: versão 1, itens na ordem, legenda copiada, card em "aguardando";
 *       segundo envio vira versão 2 e a 1 fica "substituída";
 *     · decidir: aprovar move o card e grava `task_events` com "Aprovação do
 *       cliente"; segunda decisão é recusada e o card não se move; reprovar sem
 *       comentário é recusado; com comentário, o comentário entra no card como
 *       "do cliente"; sem destino, grava e não move;
 *     · RLS: quem não alcança o cliente não lê rodada nem item;
 *     · card arquivado cancela a rodada aberta;
 *     · o link só muda para ser revogado (hash fixo, revogado não volta);
 *     · comentário só aponta rodada do próprio card, e item daquela rodada;
 *     · o comentário do cliente não passa pelas menções (F17.82): reprovar com
 *       mais de 20 marcas de menção funciona.
 *
 * NENHUMA REDE: o PGlite roda no próprio processo.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS = [
  'supabase/migrations/20261007150000_ideworks_f42_1_cliente_e_link.sql',
  'supabase/migrations/20261007150100_ideworks_f42_2_destinos_da_esteira.sql',
  'supabase/migrations/20261007150200_ideworks_f42_3_rodadas_de_aprovacao.sql',
  'supabase/migrations/20261007150300_ideworks_f42_4_enviar_e_decidir.sql',
  'supabase/migrations/20261007160000_ideworks_f42_5_itens_sem_api.sql',
];
const ROLLBACKS = [
  'supabase/rollback/20261007160000_ideworks_f42_5_itens_sem_api.sql',
  'supabase/rollback/20261007150300_ideworks_f42_4_enviar_e_decidir.sql',
  'supabase/rollback/20261007150200_ideworks_f42_3_rodadas_de_aprovacao.sql',
  'supabase/rollback/20261007150100_ideworks_f42_2_destinos_da_esteira.sql',
  'supabase/rollback/20261007150000_ideworks_f42_1_cliente_e_link.sql',
];
const ESTEIRAS = 'supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql';
const F17_80 = 'supabase/migrations/20260909174220_ideworks_f17_80_preservar_etapa_ao_mover.sql';
const F17_82 = 'supabase/migrations/20260911180517_ideworks_f17_82_mencoes_e_notificacoes.sql';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const hash = (c: string) => c.repeat(64);

const EQUIPE = id(1); // alcança a lista L1 e o cliente C1
const FORA = id(2); // não alcança nada
const C1 = id(10);
const C2 = id(11);
const ESPACO = id(20);
const L1 = id(30);
const L2 = id(31); // esteira própria, outra esteira
const SET1 = id(40);
const SET2 = id(41);
const A_FAZER = id(50);
const AGUARDANDO = id(51);
const APROVADO = id(52);
const REFACAO = id(53);
const CONCLUIDO = id(54);
const OUTRA_ESTEIRA = id(55);
const OUTRA_FECHA = id(56);

const TOKEN_C1 = hash('a');
const TOKEN_C2 = hash('b');

const db = new PGlite();

const fatia = (arquivo: string, inicio: string) => {
  const texto = readFileSync(arquivo, 'utf8');
  const de = texto.indexOf(inicio);
  return texto.slice(de, texto.indexOf('$fn$;', de) + 5);
};

/** Declara quem age, como `withActor` faz (`set_config(..., true)` dentro da transação). */
const comoPessoa = async <T>(userId: string, trabalho: () => Promise<T>): Promise<T> => {
  await db.exec('begin');
  try {
    await db.query(
      `select set_config('app.user_id', $1, true), set_config('app.is_superadmin', 'false', true),
              set_config('app.is_super', 'false', true)`,
      [userId],
    );
    const r = await trabalho();
    await db.exec('commit');
    return r;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
};

const itens = (n: number) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      dropbox_url: `https://www.dropbox.com/scl/fi/arquivo${i + 1}`,
      kind: i === n - 1 ? 'video' : 'image',
      file_name: `peca-${i + 1}.${i === n - 1 ? 'mp4' : 'jpg'}`,
      dropbox_file_id: `id:arquivo${i + 1}`,
      dropbox_rev: `rev${i + 1}`,
    })),
  );

const enviar = (taskId: string, n = 2, quem = EQUIPE) =>
  comoPessoa(quem, async () => {
    const r = await db.query<{ r: { round_id: string; version: number; superseded: number } }>(
      'select ideworks.create_approval_round($1, $2::jsonb) as r',
      [taskId, itens(n)],
    );
    return r.rows[0].r;
  });

/** O cliente decide sem pessoa declarada: a rota pública não tem ator. */
const decidir = async (token: string, roundId: string, decisao: string, comentario: string | null = null) =>
  (
    await db.query<{ r: { state: string; moved: boolean; comment_id: string | null } }>(
      'select ideworks.decide_approval_round($1, $2, $3, $4) as r',
      [token, roundId, decisao, comentario],
    )
  ).rows[0].r;

const novoCard = async (titulo: string, descricao = 'Legenda do post') =>
  (
    await db.query<{ id: string }>(
      `insert into ideworks.tasks(list_id, client_id, status_id, title, description)
       values ($1, $2, $3, $4, $5) returning id`,
      [L1, C1, A_FAZER, titulo, descricao],
    )
  ).rows[0].id;

const etapa = async (taskId: string) =>
  (await db.query<{ s: string }>('select status_id as s from ideworks.tasks where id = $1', [taskId])).rows[0].s;

const eventos = async (taskId: string) =>
  (
    await db.query<{ automation_name: string | null; automation_id: string | null; actor_id: string | null; to_status_id: string }>(
      'select automation_name, automation_id, actor_id, to_status_id from ideworks.task_events where task_id = $1 order by id',
      [taskId],
    )
  ).rows;

const rodada = async (roundId: string) =>
  (
    await db.query<{ state: string; version: number; decided_at: string | null; decided_via: string | null; closed_at: string | null; caption: string | null; decision_comment_id: string | null }>(
      'select state, version, decided_at, decided_via, closed_at, caption, decision_comment_id from ideworks.approval_rounds where id = $1',
      [roundId],
    )
  ).rows[0];

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role ideworks_app;
    create schema auth;
    create table auth.users(id uuid primary key);
    create schema ideworks;
    grant usage on schema ideworks to ideworks_app;

    create type ideworks.access_level as enum ('view', 'execute', 'create', 'manage');
    create type ideworks.status_type as enum ('open', 'unstarted', 'custom', 'done', 'closed');

    create function ideworks.acting_user_id() returns uuid language sql stable as
      $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create function ideworks.acting_is_superadmin() returns boolean language sql stable as
      $$ select coalesce(current_setting('app.is_superadmin', true), 'false') = 'true' $$;
    create function ideworks.acting_is_super() returns boolean language sql stable as
      $$ select coalesce(current_setting('app.is_super', true), 'false') = 'true' $$;

    create table ideworks.clients(id uuid primary key, name text not null,
      is_active boolean not null default true);
    create table ideworks.user_clients(user_id uuid, client_id uuid);
    create table ideworks.list_access(user_id uuid, list_id uuid); -- dublê do alcance por nó
    create table ideworks.spaces(id uuid primary key);
    create table ideworks.folders(id uuid primary key, space_id uuid);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text);
    create table ideworks.status_sets(id uuid primary key default gen_random_uuid(),
      space_id uuid, folder_id uuid, list_id uuid, name text);
    create table ideworks.statuses(id uuid primary key default gen_random_uuid(),
      status_set_id uuid not null references ideworks.status_sets on delete cascade,
      name text not null, type ideworks.status_type not null, sort_order int not null default 0);
    create table ideworks.tasks(id uuid primary key default gen_random_uuid(),
      list_id uuid references ideworks.lists, client_id uuid references ideworks.clients,
      status_id uuid references ideworks.statuses, parent_id uuid references ideworks.tasks,
      title text not null, description text, archived_at timestamptz,
      completed_at timestamptz, completed_by uuid, updated_at timestamptz default now());
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    create table ideworks.task_automations(id uuid primary key default gen_random_uuid(),
      name text, source_list_id uuid, trigger_status_id uuid, is_active boolean default true,
      target_list_id uuid, target_status_id uuid, assignee_id uuid);
    create table ideworks.task_events(id bigint generated always as identity primary key,
      task_id uuid not null references ideworks.tasks on delete cascade,
      automation_id uuid, automation_name text,
      from_list_id uuid, to_list_id uuid, from_status_id uuid, to_status_id uuid,
      from_list_name text, to_list_name text, from_status_name text, to_status_name text,
      removed_user_ids uuid[] not null default '{}', added_user_id uuid,
      added_user_ids uuid[] not null default '{}', actor_id uuid,
      occurred_at timestamptz not null default now(),
      constraint task_events_manual_has_no_rule
        check (automation_name is not null or automation_id is null));
    create table ideworks.task_comments(id uuid primary key default gen_random_uuid(),
      task_id uuid not null references ideworks.tasks on delete cascade, parent_id uuid,
      body text not null, author_id uuid references auth.users on delete set null,
      created_at timestamptz not null default now());
    create table ideworks.task_mentions(task_id uuid, source_type text, source_id uuid,
      recipient_id uuid, actor_id uuid, unique (source_type, source_id, recipient_id));
    create function ideworks.can_mention_person(p_user_id uuid, p_list_id uuid, p_client_id uuid)
      returns boolean language sql stable as $$ select true $$;

    -- Dublês do alcance: super passa; os demais, pelas duas tabelas acima.
    create function ideworks.can_see_client(target uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select ideworks.acting_is_super() or exists (select 1 from ideworks.user_clients uc
           where uc.client_id = target and uc.user_id = ideworks.acting_user_id()) $$;
    create function ideworks.can_see_list(target uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select ideworks.acting_is_super() or exists (select 1 from ideworks.list_access a
           where a.list_id = target and a.user_id = ideworks.acting_user_id()) $$;
    create function ideworks.can_reach_task_id(target uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select coalesce(ideworks.can_see_list(t.list_id), false)
             or coalesce(ideworks.can_see_client(t.client_id), false)
           from ideworks.tasks t where t.id = target $$;
    create function ideworks.can_act_on_task_id(target uuid, p_min ideworks.access_level) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select ideworks.can_reach_task_id(target) $$;
    create function ideworks.can_reach_task_for(p_user uuid, p_list uuid, p_client uuid) returns boolean
      language sql stable as $$ select true $$;
    create function ideworks.can_see_status_set(target uuid) returns boolean
      language sql stable as $$ select ideworks.acting_user_id() is not null or ideworks.acting_is_super() $$;
    create function ideworks.can_write_status_set(target uuid) returns boolean
      language sql stable as $$ select ideworks.acting_user_id() is not null $$;
    create function ideworks.first_open_status(p_status_set_id uuid) returns uuid
      language sql stable as
      $$ select s.id from ideworks.statuses s where s.status_set_id = p_status_set_id
           and s.type <> 'closed' order by (s.type <> 'open'), s.sort_order, s.name limit 1 $$;

    insert into auth.users values ('${EQUIPE}'), ('${FORA}');
    insert into ideworks.clients(id, name) values ('${C1}', 'Cliente Um'), ('${C2}', 'Cliente Dois');
    insert into ideworks.user_clients values ('${EQUIPE}', '${C1}');
    insert into ideworks.spaces values ('${ESPACO}');
    insert into ideworks.lists(id, space_id, name) values ('${L1}', '${ESPACO}', 'Cliente Um'),
      ('${L2}', '${ESPACO}', 'Outra');
    insert into ideworks.list_access values ('${EQUIPE}', '${L1}');
    insert into ideworks.status_sets(id, space_id, name) values ('${SET1}', '${ESPACO}', 'Produção');
    insert into ideworks.status_sets(id, list_id, name) values ('${SET2}', '${L2}', 'Outra');
    insert into ideworks.statuses(id, status_set_id, name, type, sort_order) values
      ('${A_FAZER}', '${SET1}', 'a fazer', 'open', 0),
      ('${AGUARDANDO}', '${SET1}', 'aguardando cliente', 'custom', 1),
      ('${APROVADO}', '${SET1}', 'aprovado', 'custom', 2),
      ('${REFACAO}', '${SET1}', 'refação', 'custom', 3),
      ('${CONCLUIDO}', '${SET1}', 'concluído', 'closed', 4),
      ('${OUTRA_ESTEIRA}', '${SET2}', 'na fila', 'open', 0),
      ('${OUTRA_FECHA}', '${SET2}', 'fim', 'closed', 1);
  `);

  await db.exec(fatia(ESTEIRAS, 'create or replace function ideworks.resolve_status_set('));
  await db.exec(fatia(F17_80, 'create or replace function ideworks.status_for_move('));
  // As menções da F17.82, como estão no ar: a função e o gatilho de comentários.
  await db.exec(fatia(F17_82, 'create function ideworks.mentioned_people('));
  await db.exec(fatia(F17_82, 'create function ideworks.sync_text_mentions('));
  await db.exec(`create trigger task_comments_mentions after insert or update of body or delete
    on ideworks.task_comments for each row execute function ideworks.sync_text_mentions();`);

  // Duas vezes: as cinco precisam repetir sem erro.
  for (let i = 0; i < 2; i++) {
    for (const m of MIGRATIONS) await db.exec(readFileSync(m, 'utf8'));
  }

  await db.exec(`
    update ideworks.clients set approval_enabled = true;
    insert into ideworks.client_approval_links(client_id, token_hash, token_ciphertext)
      values ('${C1}', '${TOKEN_C1}', 'cifrado-1'), ('${C2}', '${TOKEN_C2}', 'cifrado-2');
    insert into ideworks.status_set_approval_targets(status_set_id, awaiting_status_id,
      approved_status_id, rejected_status_id)
      values ('${SET1}', '${AGUARDANDO}', '${APROVADO}', '${REFACAO}');
  `);
});

afterAll(() => db.close());

describe('o link do cliente', () => {
  it('o link vivo resolve para o cliente', async () => {
    const r = await db.query<{ c: string }>('select ideworks.resolve_approval_link($1) as c', [TOKEN_C1]);
    expect(r.rows[0].c).toBe(C1);
  });

  it('só um link vivo por cliente: o segundo é recusado pelo banco', async () => {
    await expect(
      db.query(
        `insert into ideworks.client_approval_links(client_id, token_hash, token_ciphertext)
         values ($1, $2, 'x')`,
        [C1, hash('c')],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('revogado, desligado ou inativo responde igual a inexistente', async () => {
    const resolve = async (t: string) =>
      (await db.query<{ c: string | null }>('select ideworks.resolve_approval_link($1) as c', [t])).rows[0].c;

    await db.exec('begin');
    await db.query('update ideworks.client_approval_links set revoked_at = now() where client_id = $1', [C2]);
    expect(await resolve(TOKEN_C2)).toBeNull();
    // Revogado o antigo, um novo pode nascer.
    await db.query(
      `insert into ideworks.client_approval_links(client_id, token_hash, token_ciphertext) values ($1, $2, 'y')`,
      [C2, hash('d')],
    );
    expect(await resolve(hash('d'))).toBe(C2);
    await db.exec('rollback');

    await db.exec('begin');
    await db.query('update ideworks.clients set approval_enabled = false where id = $1', [C2]);
    expect(await resolve(TOKEN_C2)).toBeNull();
    await db.exec('rollback');

    await db.exec('begin');
    await db.query('update ideworks.clients set is_active = false where id = $1', [C2]);
    expect(await resolve(TOKEN_C2)).toBeNull();
    await db.exec('rollback');

    expect(await resolve(hash('e'))).toBeNull();
    expect(await resolve(TOKEN_C2)).toBe(C2);
  });

  it('o link não se reescreve: hash e texto cifrado são fixos; revogar funciona e não se desfaz', async () => {
    await db.exec('begin');
    try {
      await expect(
        db.query('update ideworks.client_approval_links set token_hash = $1 where client_id = $2', [hash('9'), C2]),
      ).rejects.toMatchObject({ code: 'IW042', hint: 'link_immutable' });
    } finally {
      await db.exec('rollback');
    }
    await db.exec('begin');
    try {
      await expect(
        db.query(`update ideworks.client_approval_links set token_ciphertext = 'outro' where client_id = $1`, [C2]),
      ).rejects.toMatchObject({ code: 'IW042', hint: 'link_immutable' });
    } finally {
      await db.exec('rollback');
    }

    // Pelo papel do app, como o Worker: só as colunas da revogação têm update.
    const comoApp = async <T>(trabalho: () => Promise<T>) => {
      await db.exec('begin; set local role ideworks_app;');
      try {
        await db.query(
          `select set_config('app.user_id', $1, true), set_config('app.is_superadmin', 'true', true),
                  set_config('app.is_super', 'false', true)`,
          [EQUIPE],
        );
        return await trabalho();
      } finally {
        await db.exec('rollback');
      }
    };
    await expect(
      comoApp(() =>
        db.query('update ideworks.client_approval_links set token_hash = $1 where client_id = $2', [hash('9'), C1]),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    // Revogar funciona (pelo app, com a política) — e, revogado, não volta.
    await db.exec('begin');
    try {
      await db.exec('set local role ideworks_app');
      await db.query(
        `select set_config('app.user_id', $1, true), set_config('app.is_superadmin', 'true', true),
                set_config('app.is_super', 'false', true)`,
        [EQUIPE],
      );
      const r = await db.query(
        'update ideworks.client_approval_links set revoked_at = now(), revoked_by = $1 where client_id = $2 and revoked_at is null',
        [EQUIPE, C1],
      );
      expect(r.affectedRows).toBe(1);
      await db.exec('reset role');
      expect(
        (await db.query<{ c: string | null }>('select ideworks.resolve_approval_link($1) as c', [TOKEN_C1])).rows[0].c,
      ).toBeNull();
      await expect(
        db.query('update ideworks.client_approval_links set revoked_at = null, revoked_by = null where client_id = $1', [C1]),
      ).rejects.toMatchObject({ code: 'IW042', hint: 'link_immutable' });
    } finally {
      await db.exec('rollback');
    }

    expect(
      (await db.query<{ c: string | null }>('select ideworks.resolve_approval_link($1) as c', [TOKEN_C1])).rows[0].c,
    ).toBe(C1);
  });

  it('o hash precisa ser SHA-256 em hexadecimal', async () => {
    await expect(
      db.query(
        `insert into ideworks.client_approval_links(client_id, token_hash, token_ciphertext)
         values ($1, 'token-cru', 'x')`,
        [C2],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('os destinos da esteira', () => {
  it('destino apontando para etapa de outra esteira é recusado', async () => {
    await expect(
      db.query('update ideworks.status_set_approval_targets set approved_status_id = $1 where status_set_id = $2', [
        OUTRA_ESTEIRA,
        SET1,
      ]),
    ).rejects.toMatchObject({ code: 'IW042', hint: 'target_outside_status_set' });

    await expect(
      db.query(
        `insert into ideworks.status_set_approval_targets(status_set_id, awaiting_status_id) values ($1, $2)`,
        [SET2, AGUARDANDO],
      ),
    ).rejects.toMatchObject({ code: 'IW042', hint: 'target_outside_status_set' });
  });

  it('etapa usada como destino apagada: a configuração fica incompleta, sem quebrar', async () => {
    await db.exec('begin');
    await db.query('delete from ideworks.statuses where id = $1', [APROVADO]);
    const r = await db.query<{ approved_status_id: string | null; awaiting_status_id: string }>(
      'select approved_status_id, awaiting_status_id from ideworks.status_set_approval_targets where status_set_id = $1',
      [SET1],
    );
    expect(r.rows).toEqual([{ approved_status_id: null, awaiting_status_id: AGUARDANDO }]);
    await db.exec('rollback');
  });
});

describe('enviar para aprovação', () => {
  it('cria a versão 1 com os itens em ordem, copia a legenda e põe o card em "aguardando cliente"', async () => {
    const card = await novoCard('Post 1', 'Legenda original');
    const r = await enviar(card, 4);
    expect(r.version).toBe(1);
    expect(await etapa(card)).toBe(AGUARDANDO);

    // Editar a descrição depois não muda a rodada.
    await db.query(`update ideworks.tasks set description = 'mudou' where id = $1`, [card]);
    expect((await rodada(r.round_id)).caption).toBe('Legenda original');

    const it = await db.query<{ position: number; file_name: string; kind: string; dropbox_rev: string }>(
      'select position, file_name, kind, dropbox_rev from ideworks.approval_round_items where round_id = $1 order by position',
      [r.round_id],
    );
    expect(it.rows.map((x) => x.file_name)).toEqual(['peca-1.jpg', 'peca-2.jpg', 'peca-3.jpg', 'peca-4.mp4']);
    expect(it.rows[3]).toMatchObject({ position: 4, kind: 'video', dropbox_rev: 'rev4' });

    // O movimento de envio é À MÃO, com quem enviou de autor.
    expect(await eventos(card)).toEqual([
      { automation_name: null, automation_id: null, actor_id: EQUIPE, to_status_id: AGUARDANDO },
    ]);
  });

  it('segundo envio vira a versão 2 e a 1 fica "substituída"', async () => {
    const card = await novoCard('Post 2');
    const v1 = await enviar(card);
    const v2 = await enviar(card);
    expect(v2).toMatchObject({ version: 2, superseded: 1 });
    expect((await rodada(v1.round_id)).state).toBe('superseded');
    expect((await rodada(v1.round_id)).closed_at).not.toBeNull();
    expect((await rodada(v2.round_id)).state).toBe('open');
  });

  it('esteira sem os três destinos, cliente desligado e quem não alcança são recusados', async () => {
    const card = await novoCard('Post 3');

    await db.exec(`update ideworks.status_set_approval_targets set rejected_status_id = null where status_set_id = '${SET1}'`);
    await expect(enviar(card)).rejects.toMatchObject({ code: 'IW042', hint: 'approval_not_configured' });
    await db.exec(`update ideworks.status_set_approval_targets set rejected_status_id = '${REFACAO}' where status_set_id = '${SET1}'`);

    await db.exec(`update ideworks.clients set approval_enabled = false where id = '${C1}'`);
    await expect(enviar(card)).rejects.toMatchObject({ code: 'IW042', hint: 'approval_disabled' });
    await db.exec(`update ideworks.clients set approval_enabled = true where id = '${C1}'`);

    await expect(enviar(card, 1, FORA)).rejects.toMatchObject({ code: '42501' });

    await expect(
      comoPessoa(EQUIPE, () => db.query(`select ideworks.create_approval_round($1, '[]'::jsonb)`, [card])),
    ).rejects.toMatchObject({ code: 'IW042', hint: 'no_items' });

    expect(await etapa(card)).toBe(A_FAZER);
    const n = await db.query<{ n: number }>('select count(*)::int as n from ideworks.approval_rounds where task_id = $1', [card]);
    expect(n.rows[0].n).toBe(0);
  });
});

describe('itens sem a API do Dropbox (F42_5)', () => {
  const soLink = JSON.stringify([
    { dropbox_url: 'https://www.dropbox.com/scl/fi/abc/foto.jpg?rlkey=x&dl=0', kind: 'image', file_name: 'foto.jpg' },
    { dropbox_url: 'https://www.dropbox.com/scl/fo/pasta?rlkey=y&dl=0', kind: 'other', file_name: 'pasta' },
  ]);

  it('envio só com link grava os itens sem identificador nem versão, na ordem', async () => {
    const card = await novoCard('Só link');
    const r = await comoPessoa(EQUIPE, async () =>
      (await db.query<{ r: { round_id: string; version: number } }>(
        'select ideworks.create_approval_round($1, $2::jsonb) as r', [card, soLink])).rows[0].r);
    expect(r.version).toBe(1);
    const it = await db.query<{ position: number; file_name: string; dropbox_file_id: string | null; dropbox_rev: string | null }>(
      'select position, file_name, dropbox_file_id, dropbox_rev from ideworks.approval_round_items where round_id = $1 order by position',
      [r.round_id],
    );
    expect(it.rows).toEqual([
      { position: 1, file_name: 'foto.jpg', dropbox_file_id: null, dropbox_rev: null },
      { position: 2, file_name: 'pasta', dropbox_file_id: null, dropbox_rev: null },
    ]);
    expect(await etapa(card)).toBe(AGUARDANDO);
  });

  it('preenchidos, continuam sem poder ser vazios; o nome do arquivo segue obrigatório', async () => {
    const card = await novoCard('Vazios');
    const um = (extra: object) => JSON.stringify([{ dropbox_url: 'https://www.dropbox.com/scl/fi/a/b.jpg', kind: 'image', file_name: 'b.jpg', ...extra }]);
    for (const ruim of [um({ dropbox_file_id: ' ' }), um({ dropbox_rev: '' }), um({ file_name: ' ' })]) {
      await expect(
        comoPessoa(EQUIPE, () => db.query('select ideworks.create_approval_round($1, $2::jsonb)', [card, ruim])),
      ).rejects.toMatchObject({ code: '23514' });
    }
    const n = await db.query<{ n: number }>('select count(*)::int as n from ideworks.approval_rounds where task_id = $1', [card]);
    expect(n.rows[0].n).toBe(0);
  });
});

describe('decidir a rodada', () => {
  it('aprovar uma rodada aberta move o card para o destino de aprovado e grava task_events com "Aprovação do cliente"', async () => {
    const card = await novoCard('Aprovar');
    const { round_id } = await enviar(card);

    // Sessão com variáveis já declaradas: precisam voltar ao que eram.
    await db.exec('begin');
    await db.query(`select set_config('app.user_id', '', true), set_config('app.is_super', 'false', true)`);
    const r = await decidir(TOKEN_C1, round_id, 'approve');
    const depois = await db.query<{ u: string; s: string; n: string }>(
      `select current_setting('app.user_id', true) as u, current_setting('app.is_super', true) as s,
              current_setting('app.automation_name', true) as n`,
    );
    await db.exec('commit');

    expect(r).toMatchObject({ state: 'approved', moved: true, comment_id: null });
    expect(depois.rows[0]).toEqual({ u: '', s: 'false', n: '' });
    expect(await etapa(card)).toBe(APROVADO);
    expect((await eventos(card)).at(-1)).toEqual({
      automation_name: 'Aprovação do cliente',
      automation_id: null,
      actor_id: null,
      to_status_id: APROVADO,
    });
    const rr = await rodada(round_id);
    expect(rr).toMatchObject({ state: 'approved', decided_via: 'client_link' });
    expect(rr.decided_at).not.toBeNull();
  });

  it('decidir uma rodada já decidida é recusado e o card não se move', async () => {
    const card = await novoCard('Duas vezes');
    const { round_id } = await enviar(card);
    await decidir(TOKEN_C1, round_id, 'approve');
    const antes = await eventos(card);

    await expect(decidir(TOKEN_C1, round_id, 'reject', 'mudei de ideia')).rejects.toMatchObject({
      code: 'IW042',
      hint: 'round_not_open',
    });
    await expect(decidir(TOKEN_C1, round_id, 'approve')).rejects.toMatchObject({ hint: 'round_not_open' });

    expect(await etapa(card)).toBe(APROVADO);
    expect(await eventos(card)).toEqual(antes);
    expect((await rodada(round_id)).state).toBe('approved');
    const c = await db.query<{ n: number }>('select count(*)::int as n from ideworks.task_comments where task_id = $1', [card]);
    expect(c.rows[0].n).toBe(0);
  });

  it('reprovar sem comentário é recusado', async () => {
    const card = await novoCard('Sem motivo');
    const { round_id } = await enviar(card);
    for (const vazio of [null, '', '   ']) {
      await expect(decidir(TOKEN_C1, round_id, 'reject', vazio)).rejects.toMatchObject({
        code: 'IW042',
        hint: 'comment_required',
      });
    }
    expect((await rodada(round_id)).state).toBe('open');
    expect(await etapa(card)).toBe(AGUARDANDO);
  });

  it('reprovar com comentário: o comentário entra no card "do cliente", sem autor, e o card vai para refação', async () => {
    const card = await novoCard('Com motivo');
    const { round_id } = await enviar(card);
    const r = await decidir(TOKEN_C1, round_id, 'reject', '  Trocar a música  ');
    expect(r).toMatchObject({ state: 'rejected', moved: true });
    expect(await etapa(card)).toBe(REFACAO);

    const c = await db.query('select id, body, author_id, from_client, approval_round_id from ideworks.task_comments where task_id = $1', [card]);
    expect(c.rows).toEqual([
      { id: r.comment_id, body: 'Trocar a música', author_id: null, from_client: true, approval_round_id: round_id },
    ]);
    expect((await rodada(round_id)).decision_comment_id).toBe(r.comment_id);
  });

  it('reprovar com mais de 20 marcas de menção funciona: o comentário do cliente não passa pelas menções', async () => {
    const marcas = Array.from({ length: 25 }, (_, i) => `@[Pessoa ${i}](mention:${id(1000 + i)})`).join(' ');

    // Da equipe, o mesmo texto continua recusado pela F17.82 — o gatilho segue vivo.
    const card = await novoCard('Muitas menções');
    await expect(
      db.query('insert into ideworks.task_comments(task_id, body) values ($1, $2)', [card, marcas]),
    ).rejects.toMatchObject({ code: '23514' });

    const { round_id } = await enviar(card);
    const r = await decidir(TOKEN_C1, round_id, 'reject', `Refazer ${marcas}`);
    expect(r).toMatchObject({ state: 'rejected', moved: true });
    expect(await etapa(card)).toBe(REFACAO);
    const m = await db.query<{ n: number }>('select count(*)::int as n from ideworks.task_mentions where task_id = $1', [card]);
    expect(m.rows[0].n).toBe(0);
  });

  it('o card movido à mão vai para o destino a partir de onde estiver', async () => {
    const card = await novoCard('Movido');
    const { round_id } = await enviar(card);
    await db.query('update ideworks.tasks set status_id = $1 where id = $2', [A_FAZER, card]);
    await decidir(TOKEN_C1, round_id, 'approve');
    expect(await etapa(card)).toBe(APROVADO);
    expect((await eventos(card)).at(-1)).toMatchObject({ automation_name: 'Aprovação do cliente', to_status_id: APROVADO });
  });

  it('sem destino configurado: grava a decisão e não move', async () => {
    const card = await novoCard('Sem destino');
    const { round_id } = await enviar(card);
    const antes = await eventos(card);

    await db.exec('begin');
    await db.query('update ideworks.status_set_approval_targets set approved_status_id = null where status_set_id = $1', [SET1]);
    const r = await decidir(TOKEN_C1, round_id, 'approve');
    expect(r).toMatchObject({ state: 'approved', moved: false });
    expect(await etapa(card)).toBe(AGUARDANDO);
    expect(await eventos(card)).toEqual(antes);
    await db.exec('rollback');
  });

  it('token de outro cliente, token revogado e decisão inválida são recusados', async () => {
    const card = await novoCard('Token errado');
    const { round_id } = await enviar(card);
    await expect(decidir(TOKEN_C2, round_id, 'approve')).rejects.toMatchObject({ code: 'IW042', hint: 'round_not_found' });
    await expect(decidir(hash('f'), round_id, 'approve')).rejects.toMatchObject({ code: 'IW042', hint: 'link_invalid' });
    await expect(decidir(TOKEN_C1, round_id, 'talvez')).rejects.toMatchObject({ code: '22023' });

    await db.exec('begin');
    await db.query('update ideworks.client_approval_links set revoked_at = now() where client_id = $1', [C1]);
    await expect(decidir(TOKEN_C1, round_id, 'approve')).rejects.toMatchObject({ hint: 'link_invalid' });
    await db.exec('rollback');

    expect((await rodada(round_id)).state).toBe('open');
  });
});

describe('segurança por linha', () => {
  it('um usuário da equipe sem alcance ao cliente não lê as rodadas nem os itens', async () => {
    const card = await novoCard('RLS');
    const { round_id } = await enviar(card);

    const ler = async (quem: string) => {
      await db.exec('begin; set local role ideworks_app;');
      try {
        await db.query(`select set_config('app.user_id', $1, true)`, [quem]);
        const r = await db.query<{ n: number }>('select count(*)::int as n from ideworks.approval_rounds where id = $1', [round_id]);
        const i = await db.query<{ n: number }>('select count(*)::int as n from ideworks.approval_round_items where round_id = $1', [round_id]);
        return [r.rows[0].n, i.rows[0].n];
      } finally {
        await db.exec('rollback');
      }
    };

    expect(await ler(EQUIPE)).toEqual([1, 2]);
    expect(await ler(FORA)).toEqual([0, 0]);
  });

  it('o papel do app não escreve rodada direto: só pelas funções', async () => {
    await db.exec('begin; set local role ideworks_app;');
    try {
      await expect(
        db.query(`update ideworks.approval_rounds set state = 'approved'`),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await db.exec('rollback');
    }
  });

  it('comentário só aponta rodada do próprio card, e item daquela rodada', async () => {
    const card = await novoCard('Coerência A');
    const outro = await novoCard('Coerência B');
    const ra = (await enviar(card)).round_id;
    const rb = (await enviar(outro)).round_id;
    const itemDe = async (roundId: string) =>
      (
        await db.query<{ id: string }>(
          'select id from ideworks.approval_round_items where round_id = $1 order by position limit 1',
          [roundId],
        )
      ).rows[0].id;
    const ia = await itemDe(ra);
    const ib = await itemDe(rb);
    const comentar = (taskId: string, roundId: string | null, itemId: string | null) =>
      db.query<{ id: string }>(
        `insert into ideworks.task_comments(task_id, body, approval_round_id, approval_item_id)
         values ($1, 'oi', $2, $3) returning id`,
        [taskId, roundId, itemId],
      );

    // Rodada de outro card (de outro cliente, no mundo real): recusado.
    await expect(comentar(card, rb, null)).rejects.toMatchObject({ code: 'IW042', hint: 'comment_outside_round' });
    // Item de outra rodada: recusado.
    await expect(comentar(card, ra, ib)).rejects.toMatchObject({ code: 'IW042', hint: 'comment_outside_round' });
    // Item sem rodada: recusado pela restrição.
    await expect(comentar(card, null, ia)).rejects.toMatchObject({ code: '23514' });

    // O certo passa; e mudar o vínculo depois para outra rodada também é recusado.
    const ok = (await comentar(card, ra, ia)).rows[0].id;
    await expect(
      db.query('update ideworks.task_comments set approval_round_id = $1, approval_item_id = null where id = $2', [rb, ok]),
    ).rejects.toMatchObject({ code: 'IW042', hint: 'comment_outside_round' });

    // Apagar o card leva rodada, item e comentário sem tropeçar nas travas.
    await db.query('delete from ideworks.tasks where id = $1', [card]);
    const sobra = await db.query<{ n: number }>('select count(*)::int as n from ideworks.task_comments where id = $1', [ok]);
    expect(sobra.rows[0].n).toBe(0);
  });

  it('cliente apagado: a rodada some e o comentário perde rodada e item juntos, sem travar', async () => {
    await db.exec('begin');
    try {
      const c3 = id(12);
      await db.query(`insert into ideworks.clients(id, name, approval_enabled) values ($1, 'Três', true)`, [c3]);
      const card = (
        await db.query<{ id: string }>(
          `insert into ideworks.tasks(list_id, client_id, status_id, title) values ($1, null, $2, 'sem cliente') returning id`,
          [L1, A_FAZER],
        )
      ).rows[0].id;
      // Rodada e item gravados direto (o dono da tabela), para um cliente que vai sumir.
      const r = (
        await db.query<{ id: string }>(
          `insert into ideworks.approval_rounds(task_id, client_id, version) values ($1, $2, 1) returning id`,
          [card, c3],
        )
      ).rows[0].id;
      const it = (
        await db.query<{ id: string }>(
          `insert into ideworks.approval_round_items(round_id, position, dropbox_url, kind, file_name, dropbox_file_id, dropbox_rev)
           values ($1, 1, 'https://www.dropbox.com/x', 'image', 'a.jpg', 'id:a', 'r1') returning id`,
          [r],
        )
      ).rows[0].id;
      const cm = (
        await db.query<{ id: string }>(
          `insert into ideworks.task_comments(task_id, body, approval_round_id, approval_item_id)
           values ($1, 'oi', $2, $3) returning id`,
          [card, r, it],
        )
      ).rows[0].id;

      await db.query('delete from ideworks.clients where id = $1', [c3]);
      const c = await db.query('select approval_round_id, approval_item_id from ideworks.task_comments where id = $1', [cm]);
      expect(c.rows).toEqual([{ approval_round_id: null, approval_item_id: null }]);
    } finally {
      await db.exec('rollback');
    }
  });

  it('comentário "do cliente" com autor é recusado', async () => {
    const card = await novoCard('Autor');
    await expect(
      db.query(`insert into ideworks.task_comments(task_id, body, author_id, from_client) values ($1, 'oi', $2, true)`, [
        card,
        EQUIPE,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('o card muda', () => {
  it('card arquivado ou que muda de cliente cancela a rodada aberta', async () => {
    const card = await novoCard('Arquivar');
    const { round_id } = await enviar(card);
    await db.query('update ideworks.tasks set archived_at = now() where id = $1', [card]);
    expect((await rodada(round_id)).state).toBe('cancelled');
    await expect(decidir(TOKEN_C1, round_id, 'approve')).rejects.toMatchObject({ hint: 'round_not_open' });

    const outro = await novoCard('Muda de cliente');
    const r2 = await enviar(outro);
    await db.query('update ideworks.tasks set client_id = $1 where id = $2', [C2, outro]);
    expect((await rodada(r2.round_id)).state).toBe('cancelled');
  });
});

describe('reversão', () => {
  it('o rollback da F42_5 recusa enquanto houver item só por link, e não inventa identificador', async () => {
    await expect(db.exec(readFileSync(ROLLBACKS[0], 'utf8'))).rejects.toThrow(/sem identificador do Dropbox/);
    await db.exec('rollback').catch(() => undefined);
    const nulo = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns where table_schema = 'ideworks'
        and table_name = 'approval_round_items' and column_name = 'dropbox_rev'`,
    );
    expect(nulo.rows[0].is_nullable).toBe('YES');
  });

  it('os cinco rollbacks desfazem tudo e a migração volta a aplicar', async () => {
    await db.exec('delete from ideworks.approval_round_items where dropbox_file_id is null or dropbox_rev is null');
    await db.exec(readFileSync(ROLLBACKS[0], 'utf8'));
    const nulo = await db.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns where table_schema = 'ideworks'
        and table_name = 'approval_round_items' and column_name = 'dropbox_rev'`,
    );
    expect(nulo.rows[0].is_nullable).toBe('NO');
    for (const r of ROLLBACKS.slice(1)) await db.exec(readFileSync(r, 'utf8'));
    const sobra = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'ideworks' and table_name in
          ('client_approval_links', 'status_set_approval_targets', 'approval_rounds', 'approval_round_items')`,
    );
    expect(sobra.rows[0].n).toBe(0);
    const col = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns where table_schema = 'ideworks'
        and column_name in ('approval_enabled', 'from_client', 'approval_round_id', 'approval_item_id')`,
    );
    expect(col.rows[0].n).toBe(0);
    // move_task voltou ao da F17.80: sem o nome da automação.
    const corpo = await db.query<{ src: string }>(`select prosrc as src from pg_proc where proname = 'move_task'`);
    expect(corpo.rows[0].src).not.toContain('app.automation_name');
    // O gatilho de menções dos comentários voltou ao da F17.82: um só, sem condição.
    const gat = await db.query<{ tgname: string; def: string }>(
      `select tgname, pg_get_triggerdef(oid) as def from pg_trigger
        where tgrelid = 'ideworks.task_comments'::regclass and not tgisinternal order by tgname`,
    );
    expect(gat.rows.map((g) => g.tgname)).toEqual(['task_comments_mentions']);
    expect(gat.rows[0].def).toContain('OR DELETE');
    expect(gat.rows[0].def).not.toContain('WHEN');
    const fn = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname in
        ('client_approval_links_guard', 'task_comments_approval_coherent')`,
    );
    expect(fn.rows[0].n).toBe(0);

    for (const m of MIGRATIONS) await db.exec(readFileSync(m, 'utf8'));
  });
});
