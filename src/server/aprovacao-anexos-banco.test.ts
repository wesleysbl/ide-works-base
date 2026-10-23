/**
 * AS ARTES ANEXADAS COMO MATERIAL, CONTRA UM POSTGRES DE VERDADE — F42, Fase 9.
 *
 * As sete migrations da F42 (1→7) aplicadas duas vezes sobre o mesmo mínimo de
 * esquema de `aprovacao-publica-banco.test.ts` (o preparo é copiado de lá, com
 * `task_attachments` a mais). O que se prova da F42_7:
 *   · rodada com 3 anexos + 1 link do Dropbox grava os 4 na ordem; nome, tipo
 *     e tamanho do anexo vêm da linha do anexo, não do que o Worker disse;
 *   · item com os dois (link e anexo) ou com nenhum é recusado, nada gravado;
 *   · anexo de outro card, temporário ou que não é imagem é recusado;
 *   · a cópia só mora debaixo da própria rodada (`aprovacoes/<rodada>/…`);
 *   · o JSON do cliente diz `attachment` e NUNCA traz o caminho do balde;
 *   · `public_approval_item_object`: só o token certo, só chamada visível dele,
 *     só item de anexo; substituída ou de outro cliente → nulo;
 *   · anexo apagado depois: o item fica, a cópia continua servível;
 *   · o limite conta `media` à parte da leitura;
 *   · o rollback recusa com anexo gravado; sem anexo, desfaz e reaplica.
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
  'supabase/migrations/20261007200000_ideworks_f42_7_anexos_como_material.sql',
];
const ROLLBACK_F42_7 = 'supabase/rollback/20261007200000_ideworks_f42_7_anexos_como_material.sql';
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
    -- O anexo do card (F17.6 + F17.81), só as colunas que a F42_7 lê.
    create table ideworks.task_attachments(id uuid primary key default gen_random_uuid(),
      task_id uuid not null references ideworks.tasks on delete cascade, file_name text not null,
      content_type text not null, byte_size bigint not null, storage_path text not null unique,
      expires_at timestamptz);
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

  // Duas vezes: as sete precisam repetir sem erro.
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

/* ─────────────────────────── a F42_7 ─────────────────────────── */

const pagina = async (token: string) =>
  (await db.query<{ p: unknown }>('select ideworks.public_approval_page($1) as p', [token])).rows[0].p;

const chamada = async (token: string, roundId: string) =>
  (await db.query<{ c: { items: unknown[] } | null }>('select ideworks.public_approval_round($1, $2) as c', [token, roundId]))
    .rows[0].c;

/** Recusa IW042 com a `hint` dada. */
const recusa = (hint: string) => expect.objectContaining({ code: 'IW042', hint });


const RODADA_NOVA = () => crypto.randomUUID();

const anexo = async (
  taskId: string,
  nome: string,
  extra: { content_type?: string; byte_size?: number; expires_at?: string | null } = {},
) =>
  (
    await db.query<{ id: string }>(
      `insert into ideworks.task_attachments(task_id, file_name, content_type, byte_size, storage_path, expires_at)
       values ($1::uuid, $2, $3, $4, $1::text || '/' || gen_random_uuid() || '.png', $5) returning id`,
      [taskId, nome, extra.content_type ?? 'image/png', extra.byte_size ?? 1000, extra.expires_at ?? null],
    )
  ).rows[0].id;

const doAnexo = (roundId: string, pos: number, attachmentId: string) => ({
  attachment_id: attachmentId,
  storage_path: `aprovacoes/${roundId}/${pos}-arte.png`,
});
const doLink = (n: number) => ({
  dropbox_url: `https://www.dropbox.com/scl/fi/video${n}/reels.mp4`,
  kind: 'video',
  file_name: 'reels.mp4',
});

const enviarItens = (taskId: string, itensJson: unknown[], roundId: string | null) =>
  comoPessoa(EQUIPE, async () => {
    const r = await db.query<{ r: { round_id: string; version: number } }>(
      'select ideworks.create_approval_round($1, $2::jsonb, $3::uuid) as r',
      [taskId, JSON.stringify(itensJson), roundId],
    );
    return r.rows[0].r;
  });

const contarRodadas = async (taskId: string) =>
  (await db.query<{ n: number }>('select count(*)::int as n from ideworks.approval_rounds where task_id = $1', [taskId]))
    .rows[0].n;

const objeto = async (token: string, roundId: string, itemId: string) =>
  (
    await db.query<{ o: { storage_path: string; content_type: string } | null }>(
      'select ideworks.public_approval_item_object($1, $2, $3) as o',
      [token, roundId, itemId],
    )
  ).rows[0].o;

describe('enviar com anexos (create_approval_round)', () => {
  it('3 anexos + 1 link do Dropbox: os 4 na ordem; nome, tipo e tamanho vêm do anexo', async () => {
    const card = await novoCard('Artes do carrossel');
    const a1 = await anexo(card, 'capa.png', { byte_size: 120_000 });
    const a2 = await anexo(card, 'miolo.jpg', { content_type: 'image/jpeg', byte_size: 920_000 });
    const a3 = await anexo(card, 'fim.webp', { content_type: 'image/webp' });
    const rid = RODADA_NOVA();
    const r = await enviarItens(card, [doAnexo(rid, 1, a1), doLink(1), doAnexo(rid, 3, a2), doAnexo(rid, 4, a3)], rid);
    expect(r.round_id).toBe(rid);
    const linhas = await db.query(
      `select position, kind::text as kind, file_name, dropbox_url, storage_path, content_type, byte_size::int as byte_size,
              source_attachment_id
         from ideworks.approval_round_items where round_id = $1 order by position`,
      [rid],
    );
    expect(linhas.rows).toEqual([
      { position: 1, kind: 'image', file_name: 'capa.png', dropbox_url: null, storage_path: `aprovacoes/${rid}/1-arte.png`, content_type: 'image/png', byte_size: 120000, source_attachment_id: a1 },
      { position: 2, kind: 'video', file_name: 'reels.mp4', dropbox_url: 'https://www.dropbox.com/scl/fi/video1/reels.mp4', storage_path: null, content_type: null, byte_size: null, source_attachment_id: null },
      { position: 3, kind: 'image', file_name: 'miolo.jpg', dropbox_url: null, storage_path: `aprovacoes/${rid}/3-arte.png`, content_type: 'image/jpeg', byte_size: 920000, source_attachment_id: a2 },
      { position: 4, kind: 'image', file_name: 'fim.webp', dropbox_url: null, storage_path: `aprovacoes/${rid}/4-arte.png`, content_type: 'image/webp', byte_size: 1000, source_attachment_id: a3 },
    ]);
    expect(await etapa(card)).toBe(AGUARDANDO);
  });

  it('o que o Worker diz de nome/tipo não vale: o anexo manda', async () => {
    const card = await novoCard('Nome inventado');
    const a = await anexo(card, 'verdadeiro.png');
    const rid = RODADA_NOVA();
    await enviarItens(card, [{ ...doAnexo(rid, 1, a), file_name: 'mentira.exe', kind: 'video' }], rid);
    const l = await db.query<{ file_name: string; kind: string }>(
      'select file_name, kind::text as kind from ideworks.approval_round_items where round_id = $1',
      [rid],
    );
    expect(l.rows[0]).toEqual({ file_name: 'verdadeiro.png', kind: 'image' });
  });

  it('item com os dois ou com nenhum é recusado, e nada é gravado', async () => {
    const card = await novoCard('Item torto');
    const a = await anexo(card, 'x.png');
    const rid = RODADA_NOVA();
    for (const torto of [{ ...doAnexo(rid, 1, a), ...doLink(1) }, { kind: 'image', file_name: 'nada.png' }]) {
      await expect(enviarItens(card, [torto], rid)).rejects.toMatchObject(recusa('item_invalid'));
    }
    expect(await contarRodadas(card)).toBe(0);
    expect(await etapa(card)).toBe(A_FAZER);
  });

  it('anexo de outro card, temporário ou que não é imagem: recusado, nada gravado', async () => {
    const card = await novoCard('Recusas');
    const outro = await novoCard('Outro card');
    const deOutro = await anexo(outro, 'alheio.png');
    const temporario = await anexo(card, 'print.png', { expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const pdf = await anexo(card, 'roteiro.pdf', { content_type: 'application/pdf' });
    for (const ruim of [deOutro, temporario, pdf, id(999)]) {
      const rid = RODADA_NOVA();
      await expect(enviarItens(card, [doAnexo(rid, 1, ruim)], rid)).rejects.toMatchObject(recusa('attachment_invalid'));
    }
    expect(await contarRodadas(card)).toBe(0);
  });

  it('a cópia só mora debaixo da própria rodada; sem id de rodada, anexo não entra', async () => {
    const card = await novoCard('Caminho alheio');
    const a = await anexo(card, 'x.png');
    const rid = RODADA_NOVA();
    const fora = { attachment_id: a, storage_path: `${card}/roubado.png` };
    await expect(enviarItens(card, [fora], rid)).rejects.toMatchObject({ code: '23514' });
    const outraRodada = { attachment_id: a, storage_path: `aprovacoes/${RODADA_NOVA()}/1-x.png` };
    await expect(enviarItens(card, [outraRodada], rid)).rejects.toMatchObject({ code: '23514' });
    await expect(enviarItens(card, [doAnexo(rid, 1, a)], null)).rejects.toMatchObject({ code: '23514' });
    expect(await contarRodadas(card)).toBe(0);
  });

  it('a chamada antiga, de 2 argumentos e só link, continua funcionando', async () => {
    const card = await novoCard('Worker antigo');
    const r = await enviar(card, 2);
    expect(r.version).toBe(1);
  });
});

describe('o cliente vê a arte (F42_7)', () => {
  let card: string;
  let rid: string;
  let itemAnexo: string;
  let itemLink: string;
  let a1: string;

  beforeAll(async () => {
    card = await novoCard('Arte para o cliente');
    a1 = await anexo(card, 'arte-final.png');
    rid = RODADA_NOVA();
    await enviarItens(card, [doAnexo(rid, 1, a1), doLink(9)], rid);
    const it = await db.query<{ id: string; position: number }>(
      'select id, position from ideworks.approval_round_items where round_id = $1 order by position',
      [rid],
    );
    itemAnexo = it.rows[0].id;
    itemLink = it.rows[1].id;
  });

  it('o JSON público diz "attachment" e nunca traz o caminho do balde', async () => {
    const c = await chamada(TOKEN_C1, rid);
    const itensDaChamada = c!.items as unknown as Record<string, unknown>[];
    expect(Object.keys(itensDaChamada[0]).sort()).toEqual(['attachment', 'file_name', 'id', 'kind', 'position', 'url']);
    expect(itensDaChamada[0]).toMatchObject({ attachment: true, url: null, kind: 'image', file_name: 'arte-final.png' });
    expect(itensDaChamada[1]).toMatchObject({ attachment: false, kind: 'video' });
    expect(JSON.stringify(await pagina(TOKEN_C1))).not.toContain('aprovacoes/');
  });

  it('o objeto: só com o token certo, só item de anexo da chamada visível', async () => {
    expect(await objeto(TOKEN_C1, rid, itemAnexo)).toEqual({
      storage_path: `aprovacoes/${rid}/1-arte.png`,
      content_type: 'image/png',
    });
    expect(await objeto(TOKEN_C2, rid, itemAnexo)).toBeNull();
    expect(await objeto(hash('z'), rid, itemAnexo)).toBeNull();
    expect(await objeto(TOKEN_C1, rid, itemLink)).toBeNull();
    expect(await objeto(TOKEN_C1, abertaDeOutroCard(), itemAnexo)).toBeNull();
  });

  it('anexo apagado depois: o item fica e a cópia continua servível', async () => {
    await db.query('delete from ideworks.task_attachments where id = $1', [a1]);
    const l = await db.query<{ source_attachment_id: string | null; storage_path: string }>(
      'select source_attachment_id, storage_path from ideworks.approval_round_items where id = $1',
      [itemAnexo],
    );
    expect(l.rows[0]).toEqual({ source_attachment_id: null, storage_path: `aprovacoes/${rid}/1-arte.png` });
    expect(await objeto(TOKEN_C1, rid, itemAnexo)).not.toBeNull();
  });

  it('substituída: a imagem some para o cliente', async () => {
    const a2 = await anexo(card, 'v2.png');
    const rid2 = RODADA_NOVA();
    await enviarItens(card, [doAnexo(rid2, 1, a2)], rid2);
    expect(await objeto(TOKEN_C1, rid, itemAnexo)).toBeNull();
    const novo = await db.query<{ id: string }>('select id from ideworks.approval_round_items where round_id = $1', [rid2]);
    expect(await objeto(TOKEN_C1, rid2, novo.rows[0].id)).not.toBeNull();
  });
});

/** Um id de rodada que não é a do item (rodada inexistente). */
const abertaDeOutroCard = () => id(777);

describe('o limite conta as imagens à parte', () => {
  const limite = async (tipo: string, token: string, ip: string) =>
    (
      await db.query<{ r: { allowed: boolean; blocked_by?: string } }>(
        'select ideworks.approval_link_rate_hit($1, $2, $3, 2, 5, 60) as r',
        [tipo, token, ip],
      )
    ).rows[0].r;

  it('media tem teto próprio e não gasta a leitura', async () => {
    expect((await limite('media', 'tok-m', 'ip-m')).allowed).toBe(true);
    expect((await limite('media', 'tok-m', 'ip-m')).allowed).toBe(true);
    expect(await limite('media', 'tok-m', 'ip-m')).toMatchObject({ allowed: false, blocked_by: 'token' });
    expect((await limite('read', 'tok-m', 'ip-m')).allowed).toBe(true);
    await expect(limite('outro', 'tok-m', 'ip-m')).rejects.toMatchObject({ code: '22023' });
  });
});

describe('reversão da F42_7', () => {
  it('recusa enquanto houver item de anexo; sem anexo, desfaz e a migração volta a aplicar', async () => {
    await expect(db.exec(readFileSync(ROLLBACK_F42_7, 'utf8'))).rejects.toThrow(/anexos/);
    await db.exec('rollback').catch(() => undefined);

    await db.exec(`delete from ideworks.approval_rounds r where exists
      (select 1 from ideworks.approval_round_items i where i.round_id = r.id and i.storage_path is not null)`);
    await db.exec(readFileSync(ROLLBACK_F42_7, 'utf8'));
    const col = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns where table_schema = 'ideworks'
        and table_name = 'approval_round_items' and column_name in ('storage_path', 'content_type', 'byte_size', 'source_attachment_id')`,
    );
    expect(col.rows[0].n).toBe(0);
    const fn = await db.query<{ args: string }>(
      `select pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'create_approval_round'`,
    );
    expect(fn.rows.map((f) => f.args)).toEqual(['p_task_id uuid, p_items jsonb']);
    const obj = await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'public_approval_item_object'`);
    expect(obj.rows[0].n).toBe(0);
    const card = await novoCard('Depois do rollback');
    expect((await enviar(card, 1)).version).toBe(1);

    await db.exec(readFileSync(MIGRATIONS[MIGRATIONS.length - 1], 'utf8'));
    const c2 = await novoCard('Reaplicada');
    const a = await anexo(c2, 'z.png');
    const rid = RODADA_NOVA();
    expect((await enviarItens(c2, [doAnexo(rid, 1, a)], rid)).round_id).toBe(rid);
  });
});
