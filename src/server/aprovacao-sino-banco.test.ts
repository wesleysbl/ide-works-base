/**
 * O SINO DA APROVAÇÃO DO CLIENTE, CONTRA UM POSTGRES DE VERDADE — F42, Fase 7.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   A fonte `deAprovacao` de `@/server/board-avisos` — o MESMO pedaço de SQL que
 *   a caixa e as duas contagens usam — rodando sobre as migrations da F42 (as
 *   mesmas de `aprovacao-do-cliente-banco.test.ts`), como o papel do app, com a
 *   política de linha das rodadas valendo:
 *     · reprovar gera "cliente pediu ajustes" para QUEM ENVIOU e para os
 *       RESPONSÁVEIS do card, com o motivo (o comentário da decisão);
 *     · aprovar gera "cliente aprovou";
 *     · quem não alcança o cliente não recebe (RLS), nem sendo responsável;
 *     · quem alcança mas não enviou nem é responsável não recebe;
 *     · rodada aberta ou substituída não avisa; card arquivado some;
 *     · quem enviou e é responsável recebe UM aviso, não dois;
 *     · marcar como visto é por pessoa e tira da conta só de quem marcou.
 *
 * O QUE ELE NÃO PROVA: o banco de produção. `scripts/provar-avisos.mjs` roda
 *   contra o banco real e fica para DEPOIS da publicação (a F42 Fase 7 não
 *   escreve em produção).
 *
 * NENHUMA REDE: o PGlite roda no próprio processo. O `tx` daqui é um montador
 * de texto com `$n` — o fragmento de `board-avisos.ts` entra intacto.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deAprovacao } from '@/server/board-avisos';
import type { Tx } from '@/server/db';

const MIGRATIONS = [
  'supabase/migrations/20261007150000_ideworks_f42_1_cliente_e_link.sql',
  'supabase/migrations/20261007150100_ideworks_f42_2_destinos_da_esteira.sql',
  'supabase/migrations/20261007150200_ideworks_f42_3_rodadas_de_aprovacao.sql',
  'supabase/migrations/20261007150300_ideworks_f42_4_enviar_e_decidir.sql',
  'supabase/migrations/20261007160000_ideworks_f42_5_itens_sem_api.sql',
];
const ESTEIRAS = 'supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql';
const F17_80 = 'supabase/migrations/20260909174220_ideworks_f17_80_preservar_etapa_ao_mover.sql';
const F17_82 = 'supabase/migrations/20260911180517_ideworks_f17_82_mencoes_e_notificacoes.sql';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const hash = (c: string) => c.repeat(64);

const EQUIPE = id(1); // quem ENVIA: alcança a lista L1 e o cliente C1
const FORA = id(2); // não alcança nada
const RESP = id(3); // responsável do card, alcança
const RESP_SEM_CLIENTE = id(4); // responsável, alcança a lista mas NÃO o cliente
const ALHEIO = id(5); // alcança tudo, mas não enviou nem é responsável
const C1 = id(10);
const C2 = id(11);
const ESPACO = id(20);
const L1 = id(30);
const L2 = id(31);
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

/* ── o montador: o `tx` de postgres.js como texto com $n, para o PGlite ── */

type Trecho = { __trecho: true; strings: readonly string[]; args: unknown[] };
const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => ({ __trecho: true, strings, args })) as unknown as Tx;
const ehTrecho = (v: unknown): v is Trecho => typeof v === 'object' && v !== null && '__trecho' in v;
function montar(t: Trecho, params: unknown[]): string {
  let texto = t.strings[0];
  t.args.forEach((a, i) => {
    if (ehTrecho(a)) texto += montar(a, params);
    else {
      params.push(a);
      texto += `$${params.length}`;
    }
    texto += t.strings[i + 1];
  });
  return texto;
}

/** Roda como o Worker roda: papel do app, pessoa declarada na transação. */
async function comoApp<T>(userId: string, trabalho: () => Promise<T>): Promise<T> {
  await db.exec('begin; set local role ideworks_app;');
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
}

type Linha = { key: string; task_id: string; decision: string; version: number; comment_id: string | null; seen: boolean };

/** A caixa desta pessoa, pela fonte de verdade (a mesma da listagem). */
const caixa = (eu: string) =>
  comoApp(eu, async () => {
    const params: unknown[] = [];
    const texto = montar(
      tx`select 'approval:' || r.id::text as key, r.task_id::text as task_id, r.state::text as decision,
                r.version, r.decision_comment_id::text as comment_id, (nr.user_id is not null) as seen
           ${deAprovacao(tx, eu, { categoriasOmitidas: [] })}
          order by r.decided_at desc, r.id desc` as unknown as Trecho,
      params,
    );
    return (await db.query<Linha>(texto, params)).rows;
  });

/** A conta de não vistos, pelo mesmo pedaço (o das duas contagens). */
const naoVistos = (eu: string) =>
  comoApp(eu, async () => {
    const params: unknown[] = [];
    const texto = montar(
      tx`select count(*) filter (where nr.user_id is null)::int as n ${deAprovacao(tx, eu, { categoriasOmitidas: [] })}` as unknown as Trecho,
      params,
    );
    return (await db.query<{ n: number }>(texto, params)).rows[0].n;
  });

/** Marcar como visto: o mesmo `insert` de `markNotice`, como o app. */
const marcar = (eu: string, chave: string) =>
  comoApp(eu, () =>
    db.query('insert into ideworks.notice_reads (user_id, notice_key) values ($1, $2) on conflict do nothing', [eu, chave]),
  );

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

const itens = JSON.stringify([
  { dropbox_url: 'https://www.dropbox.com/scl/fi/a/arte.jpg', kind: 'image', file_name: 'arte.jpg' },
  { dropbox_url: 'https://www.dropbox.com/scl/fi/b/reels.mp4', kind: 'video', file_name: 'reels.mp4' },
]);

const enviar = (taskId: string) =>
  comoPessoa(EQUIPE, async () => {
    const r = await db.query<{ r: { round_id: string } }>('select ideworks.create_approval_round($1, $2::jsonb) as r', [
      taskId,
      itens,
    ]);
    return r.rows[0].r.round_id;
  });

const decidir = async (roundId: string, decisao: 'approve' | 'reject', comentario: string | null = null) =>
  (
    await db.query<{ r: { comment_id: string | null } }>('select ideworks.decide_approval_round($1, $2, $3, $4) as r', [
      TOKEN_C1,
      roundId,
      decisao,
      comentario,
    ])
  ).rows[0].r;

const novoCard = async (titulo: string, responsaveis: string[] = [RESP, RESP_SEM_CLIENTE]) => {
  const card = (
    await db.query<{ id: string }>(
      `insert into ideworks.tasks(list_id, client_id, status_id, title, description)
       values ($1, $2, $3, $4, 'Legenda') returning id`,
      [L1, C1, A_FAZER, titulo],
    )
  ).rows[0].id;
  for (const r of responsaveis) await db.query('insert into ideworks.task_assignees values ($1, $2)', [card, r]);
  return card;
};

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

  // O que a fonte lê além das tabelas da F42: a árvore (nome da lista) e o visto.
  await db.exec(`
    create table ideworks.tree(list_id uuid primary key, list_name text);
    insert into ideworks.tree values ('${L1}', 'Cliente Um');
    create table ideworks.notice_reads(user_id uuid not null references auth.users on delete cascade,
      notice_key text not null, read_at timestamptz not null default now(), primary key (user_id, notice_key));
    alter table ideworks.notice_reads enable row level security;
    create policy notice_reads_own on ideworks.notice_reads
      using (user_id = ideworks.acting_user_id()) with check (user_id = ideworks.acting_user_id());
    grant select on ideworks.tasks, ideworks.tree, ideworks.clients, ideworks.task_assignees to ideworks_app;
    grant select, insert, delete on ideworks.notice_reads to ideworks_app;

    insert into auth.users values ('${RESP}'), ('${RESP_SEM_CLIENTE}'), ('${ALHEIO}');
    insert into ideworks.user_clients values ('${RESP}', '${C1}'), ('${ALHEIO}', '${C1}');
    insert into ideworks.list_access values ('${RESP}', '${L1}'), ('${RESP_SEM_CLIENTE}', '${L1}'), ('${ALHEIO}', '${L1}');
  `);
});

afterAll(() => db.close());

describe('o sino da aprovação do cliente', () => {
  it('reprovar avisa quem enviou e os responsáveis que alcançam o cliente — com o motivo; os demais não', async () => {
    const card = await novoCard('Carrossel de outubro');
    const rodada = await enviar(card);

    // Aberta: ninguém recebe nada ainda.
    for (const quem of [EQUIPE, RESP, RESP_SEM_CLIENTE, ALHEIO, FORA]) expect(await caixa(quem)).toEqual([]);

    const { comment_id } = await decidir(rodada, 'reject', 'A logo está pequena.');
    expect(comment_id).not.toBeNull();

    const esperado = [{ key: `approval:${rodada}`, task_id: card, decision: 'rejected', version: 1, comment_id, seen: false }];
    expect(await caixa(EQUIPE)).toEqual(esperado);
    expect(await caixa(RESP)).toEqual(esperado);
    expect(await naoVistos(EQUIPE)).toBe(1);
    expect(await naoVistos(RESP)).toBe(1);

    // Responsável sem alcance ao CLIENTE: a política das rodadas esconde.
    expect(await caixa(RESP_SEM_CLIENTE)).toEqual([]);
    expect(await naoVistos(RESP_SEM_CLIENTE)).toBe(0);
    // Alcança, mas não enviou nem cuida do card: não é com ele.
    expect(await caixa(ALHEIO)).toEqual([]);
    // Não alcança nada.
    expect(await caixa(FORA)).toEqual([]);
  });

  it('marcar como visto é por pessoa: some da conta de quem marcou, e só dela', async () => {
    const card = await novoCard('Vídeo institucional');
    const rodada = await enviar(card);
    await decidir(rodada, 'approve');
    const chave = `approval:${rodada}`;

    const antes = await naoVistos(EQUIPE);
    expect((await caixa(RESP)).find((l) => l.key === chave)).toMatchObject({ decision: 'approved', comment_id: null, seen: false });

    await marcar(EQUIPE, chave);
    await marcar(EQUIPE, chave); // duas vezes é o mesmo que uma
    expect(await naoVistos(EQUIPE)).toBe(antes - 1);
    expect((await caixa(EQUIPE)).find((l) => l.key === chave)?.seen).toBe(true);
    // O responsável continua com o dele.
    expect((await caixa(RESP)).find((l) => l.key === chave)?.seen).toBe(false);

    // Desmarcar devolve.
    await comoApp(EQUIPE, () =>
      db.query('delete from ideworks.notice_reads where user_id = $1 and notice_key = $2', [EQUIPE, chave]),
    );
    expect(await naoVistos(EQUIPE)).toBe(antes);
  });

  it('quem enviou E é responsável recebe UM aviso; substituída não avisa; card arquivado some', async () => {
    const card = await novoCard('Arte do dia das crianças', [EQUIPE]);
    const v1 = await enviar(card);
    const v2 = await enviar(card); // a v1 vira "substituída": sem decisão, sem aviso
    await decidir(v2, 'approve');

    const meus = (await caixa(EQUIPE)).filter((l) => l.task_id === card);
    expect(meus.map((l) => l.key)).toEqual([`approval:${v2}`]);
    expect(meus.map((l) => l.key)).not.toContain(`approval:${v1}`);

    await db.query('update ideworks.tasks set archived_at = now() where id = $1', [card]);
    expect((await caixa(EQUIPE)).filter((l) => l.task_id === card)).toEqual([]);
  });
});
