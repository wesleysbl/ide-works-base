/**
 * O QUE O CLIENTE LÊ E ESCREVE PELO LINK, CONTRA UM POSTGRES DE VERDADE — F42, Fase 5.
 *
 * As seis migrations da F42 (1→6) aplicadas duas vezes sobre o mesmo mínimo de
 * esquema de `aprovacao-do-cliente-banco.test.ts` (o preparo é copiado de lá).
 * O que se prova da F42_6:
 *   · a página do link: nome do cliente e só as chamadas DELE, abertas primeiro;
 *     substituída e cancelada ficam de fora;
 *   · nada interno: o JSON tem só as chaves permitidas; comentário interno, quem
 *     enviou, id do card, lista e etapa nunca aparecem;
 *   · cliente A não lê nada do cliente B (nem a página, nem a chamada por id);
 *   · link revogado, cliente desligado ou inativo → nada;
 *   · comentar sem decidir: entra "do cliente", sem autor, no item da rodada;
 *     item de outra rodada, texto vazio/só pontuação, longo demais e rodada já
 *     decidida são recusados;
 *   · decidir duas vezes: a segunda é recusada e há um `task_events` só;
 *   · o limite de pedidos: conta por token e por IP, barra no teto sem
 *     registrar, separa leitura de escrita;
 *   · o papel do app não executa a forma interna nem lê a tabela do limite;
 *   · o rollback da F42_6 desfaz tudo e a migração volta a aplicar.
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
  'supabase/migrations/20261007170000_ideworks_f42_6_leitura_publica.sql',
];
const ROLLBACK_F42_6 = 'supabase/rollback/20261007170000_ideworks_f42_6_leitura_publica.sql';
const F17_4 = 'supabase/migrations/20260825110000_ideworks_f17_4_etiquetas_e_tipos.sql';
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
  await db.exec(fatia(F17_4, 'create or replace function ideworks.is_meaningful_name('));
  // As menções da F17.82, como estão no ar: a função e o gatilho de comentários.
  await db.exec(fatia(F17_82, 'create function ideworks.mentioned_people('));
  await db.exec(fatia(F17_82, 'create function ideworks.sync_text_mentions('));
  await db.exec(`create trigger task_comments_mentions after insert or update of body or delete
    on ideworks.task_comments for each row execute function ideworks.sync_text_mentions();`);

  // Duas vezes: as seis precisam repetir sem erro.
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

/* ─────────────────────────── a F42_6 ─────────────────────────── */

type ChamadaDoBanco = {
  id: string;
  task_title: string;
  version: number;
  sent_at: string;
  caption: string | null;
  state: string;
  decided_at: string | null;
  items: { id: string; position: number; url: string; kind: string; file_name: string }[];
  comments: { id: string; body: string; created_at: string; item_id: string | null }[];
};
type PaginaDoBanco = { client_name: string; rounds: ChamadaDoBanco[] };

const CHAVES_DA_CHAMADA = ['caption', 'comments', 'decided_at', 'id', 'items', 'sent_at', 'state', 'task_title', 'version'];
const CHAVES_DO_ITEM = ['file_name', 'id', 'kind', 'position', 'url'];
const CHAVES_DO_COMENTARIO = ['body', 'created_at', 'id', 'item_id'];

const pagina = async (token: string) =>
  (await db.query<{ p: PaginaDoBanco | null }>('select ideworks.public_approval_page($1) as p', [token])).rows[0].p;

const chamada = async (token: string, roundId: string) =>
  (await db.query<{ c: ChamadaDoBanco | null }>('select ideworks.public_approval_round($1, $2) as c', [token, roundId]))
    .rows[0].c;

const comentar = async (token: string, roundId: string, itemId: string | null, texto: string | null) =>
  (
    await db.query<{ c: { id: string; body: string; item_id: string | null } }>(
      'select ideworks.comment_approval_round($1, $2, $3, $4) as c',
      [token, roundId, itemId, texto],
    )
  ).rows[0].c;

const limite = async (tipo: string, token: string, ip: string, maxToken = 3, maxIp = 5, janela = 60) =>
  (
    await db.query<{ r: { allowed: boolean; blocked_by?: string; retry_after?: number } }>(
      'select ideworks.approval_link_rate_hit($1, $2, $3, $4, $5, $6) as r',
      [tipo, token, ip, maxToken, maxIp, janela],
    )
  ).rows[0].r;

/** Recusa IW042 com a `hint` dada. */
const recusa = (hint: string) => expect.objectContaining({ code: 'IW042', hint });

let cardC1: string;
let abertaC1: string;
let aprovadaC1: string;
let substituidaC1: string;
let abertaC2: string;

beforeAll(async () => {
  await db.query('insert into ideworks.user_clients values ($1, $2)', [EQUIPE, C2]);

  // C1: um card com a v1 substituída pela v2 (aberta); outro card já aprovado.
  cardC1 = await novoCard('Post de lançamento', 'Legenda com link https://www.dropbox.com/scl/fi/abc/x.jpg?rlkey=1');
  substituidaC1 = (await enviar(cardC1, 1)).round_id;
  abertaC1 = (await enviar(cardC1, 3)).round_id;
  const outroC1 = await novoCard('Arte do dia das mães');
  aprovadaC1 = (await enviar(outroC1, 1)).round_id;
  await decidir(TOKEN_C1, aprovadaC1, 'approve', 'Perfeito!');

  // Conversa INTERNA nos dois cards de C1: nunca pode aparecer.
  await db.query(
    `insert into ideworks.task_comments (task_id, body, author_id) values ($1, 'INTERNO: cliente chato', $2),
       ($3, 'INTERNO: refazer a cor', $2)`,
    [cardC1, EQUIPE, outroC1],
  );

  // C2: um card dele, aberto.
  const cardC2 = (
    await db.query<{ id: string }>(
      `insert into ideworks.tasks(list_id, client_id, status_id, title, description)
       values ($1, $2, $3, 'Segredo do cliente dois', 'legenda dois') returning id`,
      [L1, C2, A_FAZER],
    )
  ).rows[0].id;
  abertaC2 = (await enviar(cardC2, 1)).round_id;
});

describe('a página do link (public_approval_page)', () => {
  it('traz o nome do cliente e só as chamadas dele: aberta primeiro, substituída de fora', async () => {
    const p = await pagina(TOKEN_C1);
    expect(p?.client_name).toBe('Cliente Um');
    const ids = p!.rounds.map((r) => r.id);
    expect(ids[0]).toBe(abertaC1);
    expect(ids).toContain(aprovadaC1);
    expect(ids).not.toContain(substituidaC1);
    expect(ids).not.toContain(abertaC2);
    expect(p!.rounds.find((r) => r.id === abertaC1)?.state).toBe('open');
    expect(p!.rounds.find((r) => r.id === aprovadaC1)?.state).toBe('approved');
    expect(p!.rounds.find((r) => r.id === aprovadaC1)?.decided_at).not.toBeNull();
  });

  it('só as chaves permitidas; nada de comentário interno, autor, card, lista ou etapa', async () => {
    const p = await pagina(TOKEN_C1);
    expect(Object.keys(p!).sort()).toEqual(['client_name', 'rounds']);
    for (const r of p!.rounds) {
      expect(Object.keys(r).sort()).toEqual(CHAVES_DA_CHAMADA);
      for (const i of r.items) expect(Object.keys(i).sort()).toEqual(CHAVES_DO_ITEM);
      for (const c of r.comments) expect(Object.keys(c).sort()).toEqual(CHAVES_DO_COMENTARIO);
    }
    const texto = JSON.stringify(p);
    expect(texto).not.toContain('INTERNO');
    expect(texto).not.toContain(EQUIPE);
    expect(texto).not.toContain(cardC1);
    expect(texto).not.toContain(L1);
    expect(texto).not.toContain(A_FAZER);
    expect(texto).not.toContain(AGUARDANDO);
    // O comentário do cliente na decisão aparece; é dele.
    expect(p!.rounds.find((r) => r.id === aprovadaC1)?.comments.map((c) => c.body)).toEqual(['Perfeito!']);
  });

  it('os itens vêm na ordem do envio, com a legenda copiada intacta (a limpeza é do Worker)', async () => {
    const c = (await pagina(TOKEN_C1))!.rounds.find((r) => r.id === abertaC1)!;
    expect(c.items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(c.items.map((i) => i.kind)).toEqual(['image', 'image', 'video']);
    expect(c.caption).toContain('https://www.dropbox.com/scl/fi/abc/x.jpg');
    expect(c.task_title).toBe('Post de lançamento');
    expect(c.version).toBe(2);
  });

  it('cliente A não lê nada do cliente B', async () => {
    const p2 = await pagina(TOKEN_C2);
    expect(p2?.client_name).toBe('Cliente Dois');
    expect(p2!.rounds.map((r) => r.id)).toEqual([abertaC2]);
    expect(await chamada(TOKEN_C1, abertaC2)).toBeNull();
    expect(await chamada(TOKEN_C2, abertaC1)).toBeNull();
    expect(JSON.stringify(await pagina(TOKEN_C1))).not.toContain('Segredo do cliente dois');
  });

  it('link revogado, cliente desligado, inativo e inexistente: nada', async () => {
    for (const mexer of [
      `update ideworks.client_approval_links set revoked_at = now() where client_id = '${C1}'`,
      `update ideworks.clients set approval_enabled = false where id = '${C1}'`,
      `update ideworks.clients set is_active = false where id = '${C1}'`,
    ]) {
      await db.exec('begin');
      await db.exec(mexer);
      expect(await pagina(TOKEN_C1)).toBeNull();
      expect(await chamada(TOKEN_C1, abertaC1)).toBeNull();
      await expect(comentar(TOKEN_C1, abertaC1, null, 'oi')).rejects.toMatchObject(recusa('link_invalid'));
      await db.exec('rollback');
    }
    expect(await pagina(hash('f'))).toBeNull();
  });
});

describe('uma chamada (public_approval_round)', () => {
  it('a do próprio cliente vem; substituída e de id inexistente não', async () => {
    expect((await chamada(TOKEN_C1, abertaC1))?.id).toBe(abertaC1);
    expect(await chamada(TOKEN_C1, substituidaC1)).toBeNull();
    expect(await chamada(TOKEN_C1, id(999))).toBeNull();
  });
});

describe('comentar sem decidir (comment_approval_round)', () => {
  it('entra no card "do cliente", sem autor, no item da rodada, e aparece para o cliente', async () => {
    const item = (await chamada(TOKEN_C1, abertaC1))!.items[1];
    const c = await comentar(TOKEN_C1, abertaC1, item.id, '  A segunda foto está escura.  ');
    expect(c.body).toBe('A segunda foto está escura.');
    expect(c.item_id).toBe(item.id);
    const linha = (
      await db.query<{ from_client: boolean; author_id: string | null; approval_round_id: string; task_id: string }>(
        'select from_client, author_id, approval_round_id, task_id from ideworks.task_comments where id = $1',
        [c.id],
      )
    ).rows[0];
    expect(linha).toEqual({ from_client: true, author_id: null, approval_round_id: abertaC1, task_id: cardC1 });
    const lida = await chamada(TOKEN_C1, abertaC1);
    expect(lida!.comments.map((x) => [x.body, x.item_id])).toEqual([['A segunda foto está escura.', item.id]]);
    // Comentar não decide: a rodada continua aberta.
    expect((await rodada(abertaC1)).state).toBe('open');
  });

  it('comentário da rodada inteira (sem item) também vale', async () => {
    const c = await comentar(TOKEN_C1, abertaC1, null, 'No geral, gostei.');
    expect(c.item_id).toBeNull();
  });

  it('item de outra rodada, texto vazio ou só pontuação e texto longo demais são recusados', async () => {
    const itemDeOutra = (await chamada(TOKEN_C1, aprovadaC1))!.items[0];
    await expect(comentar(TOKEN_C1, abertaC1, itemDeOutra.id, 'oi')).rejects.toMatchObject(recusa('item_not_found'));
    await expect(comentar(TOKEN_C1, abertaC1, null, '   ')).rejects.toMatchObject(recusa('comment_required'));
    await expect(comentar(TOKEN_C1, abertaC1, null, '...')).rejects.toMatchObject(recusa('comment_required'));
    await expect(comentar(TOKEN_C1, abertaC1, null, null)).rejects.toMatchObject(recusa('comment_required'));
    await expect(comentar(TOKEN_C1, abertaC1, null, 'a'.repeat(2001))).rejects.toMatchObject(recusa('comment_too_long'));
  });

  it('rodada já decidida, substituída ou de outro cliente: recusado', async () => {
    await expect(comentar(TOKEN_C1, aprovadaC1, null, 'mudei de ideia')).rejects.toMatchObject(recusa('round_not_open'));
    await expect(comentar(TOKEN_C1, substituidaC1, null, 'oi')).rejects.toMatchObject(recusa('round_not_found'));
    await expect(comentar(TOKEN_C1, abertaC2, null, 'oi')).rejects.toMatchObject(recusa('round_not_found'));
  });
});

describe('decidir pelo link', () => {
  it('a segunda decisão é recusada e o card se move uma vez só (um task_events da aprovação)', async () => {
    const card = await novoCard('Card da decisão dupla');
    const r = (await enviar(card, 1)).round_id;
    await decidir(TOKEN_C1, r, 'approve');
    await expect(decidir(TOKEN_C1, r, 'approve')).rejects.toMatchObject(recusa('round_not_open'));
    await expect(decidir(TOKEN_C1, r, 'reject', 'não')).rejects.toMatchObject(recusa('round_not_open'));
    const daAprovacao = (await eventos(card)).filter((e) => e.automation_name === 'Aprovação do cliente');
    expect(daAprovacao).toHaveLength(1);
    expect(await etapa(card)).toBe(APROVADO);
  });
});

describe('o limite de pedidos (approval_link_rate_hit)', () => {
  it('libera até o teto do token e barra depois, sem registrar o barrado', async () => {
    for (let i = 0; i < 3; i++) expect((await limite('read', 'tok-a', 'ip-1')).allowed).toBe(true);
    const barrado = await limite('read', 'tok-a', 'ip-1');
    expect(barrado).toMatchObject({ allowed: false, blocked_by: 'token' });
    expect(barrado.retry_after).toBeGreaterThanOrEqual(1);
    expect(barrado.retry_after).toBeLessThanOrEqual(60);
    const n = await db.query<{ n: number }>(
      `select count(*)::int as n from ideworks.approval_link_rate_events where scope = 'token' and scope_key = 'tok-a'`,
    );
    expect(n.rows[0].n).toBe(3);
  });

  it('o teto do IP vale entre tokens diferentes; leitura e escrita contam à parte', async () => {
    for (let i = 0; i < 5; i++) expect((await limite('read', `tok-ip-${i}`, 'ip-2')).allowed).toBe(true);
    expect(await limite('read', 'tok-ip-novo', 'ip-2')).toMatchObject({ allowed: false, blocked_by: 'ip' });
    expect((await limite('write', 'tok-ip-novo', 'ip-2')).allowed).toBe(true);
  });

  it('a janela desliza: o que saiu dela não conta', async () => {
    for (let i = 0; i < 3; i++) await limite('write', 'tok-velho', 'ip-3');
    await db.exec(`update ideworks.approval_link_rate_events set occurred_at = now() - interval '2 minutes'
                    where scope_key in ('tok-velho', 'ip-3')`);
    expect((await limite('write', 'tok-velho', 'ip-3')).allowed).toBe(true);
  });

  it('teto fora da faixa e tipo inválido são recusados', async () => {
    await expect(limite('outro', 't', 'i')).rejects.toMatchObject({ code: '22023' });
    await expect(limite('read', 't', 'i', 0)).rejects.toMatchObject({ code: '22023' });
    await expect(limite('read', '', 'i')).rejects.toMatchObject({ code: '22023' });
  });
});

describe('o papel do app', () => {
  it('executa as funções públicas, mas não a forma interna nem a tabela do limite', async () => {
    const pode = async (fn: string) =>
      (await db.query<{ ok: boolean }>(`select has_function_privilege('ideworks_app', $1, 'execute') as ok`, [fn])).rows[0].ok;
    expect(await pode('ideworks.public_approval_page(text)')).toBe(true);
    expect(await pode('ideworks.public_approval_round(text, uuid)')).toBe(true);
    expect(await pode('ideworks.comment_approval_round(text, uuid, uuid, text)')).toBe(true);
    expect(await pode('ideworks.approval_link_rate_hit(text, text, text, integer, integer, integer)')).toBe(true);
    expect(await pode('ideworks.approval_round_public_json(uuid)')).toBe(false);
    const tabela = await db.query<{ ok: boolean }>(
      `select has_table_privilege('ideworks_app', 'ideworks.approval_link_rate_events', 'select') as ok`,
    );
    expect(tabela.rows[0].ok).toBe(false);
  });
});

describe('reversão', () => {
  it('o rollback da F42_6 desfaz tudo, os comentários do cliente ficam, e a migração volta a aplicar', async () => {
    const antes = await db.query<{ n: number }>('select count(*)::int as n from ideworks.task_comments where from_client');
    await db.exec(readFileSync(ROLLBACK_F42_6, 'utf8'));
    const fn = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_proc where proname in ('approval_round_public_json', 'public_approval_page',
         'public_approval_round', 'comment_approval_round', 'approval_link_rate_hit')`,
    );
    expect(fn.rows[0].n).toBe(0);
    const tab = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.tables where table_schema = 'ideworks'
         and table_name = 'approval_link_rate_events'`,
    );
    expect(tab.rows[0].n).toBe(0);
    const depois = await db.query<{ n: number }>('select count(*)::int as n from ideworks.task_comments where from_client');
    expect(depois.rows[0].n).toBe(antes.rows[0].n);

    await db.exec(readFileSync(MIGRATIONS[MIGRATIONS.length - 1], 'utf8'));
    expect((await pagina(TOKEN_C1))?.client_name).toBe('Cliente Um');
  });
});
