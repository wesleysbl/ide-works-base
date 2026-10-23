/**
 * Prova local da F44.3 — as cinco trancas que só o banco fecha.
 *
 * Banco de verdade (PGlite) com as migrations do chat aplicadas pelo TEXTO dos
 * arquivos, as políticas do convite e o livro da coleta tirados das próprias
 * migrations, e a F44.3 por cima — sob `ideworks_app`, o papel do servidor. As
 * funções de empresa e de "quem vê o convite" são dublês: o que se mede aqui é
 * a regra nova, não as antigas.
 *
 * O último caso desfaz pelo rollback e confere contra `schema-esperado.json`
 * (o retrato do banco de produção) que tudo voltou letra por letra — e reaplica.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addConversationMember } from '@/server/chat';
import type { Sql } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [alice, bob, carla, fora, admin, topo] = [1, 2, 3, 4, 5, 6].map(id);
const migration = (nome: string) => readFileSync(`supabase/migrations/${nome}`, 'utf8');
const F44 = '20261009110000_ideworks_f44_3_trancas.sql';
type Retrato = { funcoes: string[]; politicas_expressao: string[] };
/** O retrato de produção de HOJE (já com a F44_3 aplicada e regravado). */
const retratoAtualDeProducao = JSON.parse(readFileSync('supabase/schema-esperado.json', 'utf8')) as Retrato;
/**
 * O retrato de ANTES da F44_3, congelado do commit 7754038. Depois que a
 * migration foi aplicada em produção o `schema-esperado.json` passou a trazer os
 * corpos novos; o caso do rollback precisa do estado anterior, que não muda mais.
 */
const retratoAnterior = JSON.parse(
  readFileSync('src/server/trancas-f44-retrato-anterior.json', 'utf8'),
) as Retrato;
const normalizar = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();
/**
 * O retrato de produção guarda os corpos do chat SEM comentário (as F20 entraram
 * assim); aqui as migrations entram com eles. Para comparar o que é regra, o
 * comentário sai — do lado do PGlite, que ainda tem as quebras de linha.
 */
const semComentario = (t: string) => t.replace(/--[^\n]*/g, '');

/** Um trecho de migration, achado pelo começo e terminado no primeiro `;` de fim de linha. */
const trecho = (nome: string, comeco: RegExp) => {
  const texto = migration(nome);
  const m = texto.match(new RegExp(`${comeco.source}[\\s\\S]*?\\);\\s*$`, 'm'));
  if (!m) throw new Error(`trecho não achado em ${nome}: ${comeco}`);
  return m[0];
};

const db = new PGlite();
let aclAntes = '';

/** Declara quem age, como `withActor` faz, e desce para o papel do servidor. */
async function como(
  userId: string | null,
  o: { administra?: boolean; topo?: boolean; preauth?: boolean } = {},
) {
  await db.exec('reset role');
  await db.query(
    `select set_config('app.user_id', $1, false), set_config('app.is_superadmin', $2, false),
            set_config('app.is_super', $3, false), set_config('app.preauth', $4, false)`,
    [userId ?? '', String(Boolean(o.administra || o.topo)), String(Boolean(o.topo)), String(Boolean(o.preauth))],
  );
  await db.exec('set role ideworks_app');
}
const comoDono = () => db.exec('reset role');
const linhas = async <T = Record<string, unknown>>(q: string, v: unknown[] = []) =>
  (await db.query<T>(q, v)).rows;

/** Adaptador só de transporte para o código da aplicação (mesmo de chat-mencoes-banco). */
const sql = {
  begin: async (run: (tx: unknown) => Promise<unknown>) => {
    const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, '');
      return (await db.query(q, values)).rows;
    };
    await db.exec('begin; set local role ideworks_app');
    try {
      const r = await run(tx);
      await db.exec('commit');
      return r;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  },
} as unknown as Sql;
const ator = (userId: string, administra = false) =>
  ({ userId, isSuper: false, isSuperadmin: administra }) as AuthenticatedActor;

/** O pedaço do retrato que esta migration toca, lido do banco como `conferir-schema` lê. */
async function retratoAtual(tirarComentario: boolean) {
  await comoDono();
  await db.exec('set search_path = ideworks');
  try {
    const funcoes = await linhas<{ linha: string }>(`
      select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
             || case when p.prosecdef then 'definer' else 'invoker' end || '|'
             || coalesce(array_to_string(p.proconfig, ','), '') || '|' || p.prosrc as linha
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'ideworks'
         and p.proname in ('add_conversation_member', 'chat_actor_manages',
                           'send_chat_message', 'chat_images_of_message',
                           'recent_collection_runs')`);
    const politicas = await linhas<{ linha: string }>(`
      select tablename || '|' || policyname || '|' || cmd || '|'
             || (select string_agg(r, ',' order by r) from unnest(roles::text[]) r) || '|'
             || coalesce(qual, '') || '|' || coalesce(with_check, '') as linha
        from pg_policies
       where schemaname = 'ideworks'
         and policyname in ('invitations_insert', 'invitations_update', 'runs_select')`);
    return {
      funcoes: funcoes.map((f) => {
        const [assinatura, definer, config, ...corpo] = f.linha.split('|');
        const texto = corpo.join('|');
        return `${assinatura}|${definer}|${config}|${normalizar(tirarComentario ? semComentario(texto) : texto)}`;
      }).sort(),
      politicas: politicas.map((p) => {
        const [t, n, c, r, u, w] = p.linha.split('|');
        return [t, n, c, r, normalizar(u), normalizar(w)].join('|');
      }).sort(),
    };
  } finally {
    await db.exec('reset search_path');
  }
}

/** As mesmas linhas, tiradas de um retrato de produção (sem dono nem permissões). */
function esperado(retrato: Retrato, tirarComentario = false) {
  const nomes = ['add_conversation_member', 'chat_actor_manages', 'send_chat_message', 'chat_images_of_message'];
  const funcoes = retrato.funcoes
    .filter((f) => nomes.includes(f.split('(')[0]))
    .map((f) => {
      const [assinatura, , definer, , , , config, ...corpo] = f.split('|');
      const texto = corpo.join('|');
      return `${assinatura}|${definer}|${config}|${normalizar(tirarComentario ? semComentario(texto) : texto)}`;
    })
    .sort();
  const politicas = retrato.politicas_expressao
    .filter((p) => ['invitations_insert', 'invitations_update', 'runs_select'].includes(p.split('|')[1]))
    .sort();
  return { funcoes, politicas };
}

beforeAll(async () => {
  await db.exec(`
    create role ideworks_app; create role anon; create role authenticated;
    create schema ideworks;
    grant usage on schema ideworks to ideworks_app;
    alter default privileges in schema ideworks grant all on tables to ideworks_app;
    alter default privileges in schema ideworks grant execute on functions to ideworks_app;
    create table ideworks.profiles (id uuid primary key, full_name text, email text not null, is_active boolean not null default true);
    create function ideworks.acting_user_id() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create function ideworks.acting_is_superadmin() returns boolean language sql stable as $$ select coalesce(current_setting('app.is_superadmin', true), 'false') = 'true' $$;
    create function ideworks.acting_is_super() returns boolean language sql stable as $$ select coalesce(current_setting('app.is_super', true), 'false') = 'true' $$;
    create function ideworks.is_preauth() returns boolean language sql stable as $$ select coalesce(current_setting('app.preauth', true), 'false') = 'true' $$;
    create function ideworks.assert_collector() returns void language plpgsql as $$ begin
      if ideworks.acting_user_id() is not null then raise exception 'collector only' using errcode = '42501'; end if;
    end $$;
    insert into ideworks.profiles(id, full_name, email) values
      ('${alice}', 'Alice', 'alice@example.invalid'), ('${bob}', 'Bob', 'bob@example.invalid'),
      ('${carla}', 'Carla', 'carla@example.invalid'), ('${fora}', 'Fora', 'fora@example.invalid'),
      ('${admin}', 'Admin', 'admin@example.invalid'), ('${topo}', 'Topo', 'topo@example.invalid');

    -- Convite: só as colunas que as políticas leem. Dublês para as regras antigas.
    create type ideworks.papel as enum ('super_admin', 'admin', 'funcionario');
    create table ideworks.invitations (
      id uuid primary key default gen_random_uuid(), email text not null,
      created_by uuid, categories uuid[] not null default '{}'::uuid[],
      role ideworks.papel not null default 'funcionario', status text not null default 'pending');
    alter table ideworks.invitations enable row level security;
    create function ideworks.can_grant_categories(p_ids uuid[]) returns boolean language sql stable as $$ select true $$;
    create function ideworks.can_see_invitation(p_email text, p_created_by uuid, p_categories uuid[])
      returns boolean language sql stable as $$
      select ideworks.acting_is_super() or (ideworks.acting_is_superadmin() and p_created_by = ideworks.acting_user_id()) $$;
    create policy invitations_select on ideworks.invitations for select using (
      ideworks.is_preauth() or ideworks.can_see_invitation(email, created_by, categories));
  `);

  // As políticas de HOJE, pelo texto das migrations que as criaram.
  await db.exec(trecho('20260828190000_ideworks_f17_36c_administrador_reparte_o_que_tem.sql', /create policy invitations_insert/));
  await db.exec(trecho('20260828160000_ideworks_f17_34b_a_regra_do_convite_nao_se_le.sql', /create policy invitations_update/));

  // O livro da coleta, como a F8 o criou (tabela, tipo, RLS e política).
  await db.exec(`create type ideworks.collection_outcome as enum ('running', 'ok', 'partial', 'failed');`);
  await db.exec(trecho('20260820150000_ideworks_f8_coleta.sql', /create table if not exists ideworks\.meta_collection_runs/));
  await db.exec('alter table ideworks.meta_collection_runs enable row level security;');
  await db.exec(trecho('20260820150000_ideworks_f8_coleta.sql', /create policy runs_select/));

  // O chat, migration por migration (mesma sequência de chat-mencoes-banco).
  const f17 = migration('20260911180517_ideworks_f17_82_mencoes_e_notificacoes.sql');
  await db.exec(f17.match(/create function ideworks\.mentioned_people[\s\S]*?\$fn\$;/)![0]);
  await db.exec('revoke all on function ideworks.mentioned_people(text) from public, ideworks_app');
  for (const nome of [
    '20260921210000_ideworks_f20_1_conversas.sql',
    '20260921220000_ideworks_f20_2_mensagens.sql',
    '20260921230000_ideworks_f20_6_membros_na_lista.sql',
    '20260921240000_ideworks_f20_7_imagens_do_chat.sql',
    '20260921250000_ideworks_f20_8_mencoes_do_chat.sql',
  ]) await db.exec(migration(nome));

  aclAntes = (await linhas<{ acl: string }>(
    `select relacl::text as acl from pg_class where oid = 'ideworks.meta_collection_runs'::regclass`))[0].acl;

  // Antes da F44: as funções e políticas aqui são as do retrato de produção.
  expect(await retratoAtual(true)).toEqual(esperado(retratoAnterior));

  await db.exec(migration(F44));
}, 60_000);

afterAll(() => db.close());

describe('F44.3 — trancas que só o banco fecha', () => {
  let grupo = '';

  it('1. quem administra não se põe num grupo alheio, mas segue pondo outras pessoas', async () => {
    await como(alice);
    grupo = (await linhas<{ id: string }>(
      'select ideworks.create_group_conversation($1, $2::uuid[]) as id', ['Squad', [bob]]))[0].id;

    // O administrador, que não é membro, tenta se pôr — pelo banco e pela rota.
    await como(admin, { administra: true });
    await expect(db.query('select ideworks.add_conversation_member($1, $2)', [grupo, admin]))
      .rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/ninguem se adiciona/) });
    await comoDono();
    await expect(addConversationMember(sql, ator(admin, true), grupo, admin))
      .rejects.toMatchObject({ status: 403 });

    // E continua gerenciando: põe a Carla, como hoje.
    await addConversationMember(sql, ator(admin, true), grupo, carla);
    const membros = await linhas<{ user_id: string }>(
      'select user_id from ideworks.conversation_members where conversation_id = $1 order by user_id', [grupo]);
    expect(membros.map((m) => m.user_id)).toEqual([alice, bob, carla]);

    // Quem já é membro "se pôr" de novo não muda nada e não é recusado.
    await como(alice);
    await db.query('select ideworks.add_conversation_member($1, $2)', [grupo, alice]);
    // Membro comum segue sem gerenciar.
    await como(bob);
    await expect(db.query('select ideworks.add_conversation_member($1, $2)', [grupo, fora]))
      .rejects.toMatchObject({ message: expect.stringMatching(/so o dono ou administrador/) });
    await comoDono();
  });

  it('2. convite de super admin só pelo topo — nem na criação, nem trocando o papel depois', async () => {
    const convidar = (quem: string, papel: string) =>
      db.query(
        `insert into ideworks.invitations (email, created_by, role) values ($1, $2, $3::ideworks.papel)`,
        [`sonda-${papel}-${quem.slice(-2)}-${Math.random()}@example.invalid`, quem, papel],
      );

    await como(admin, { administra: true });
    await expect(convidar(admin, 'super_admin')).rejects.toMatchObject({ code: '42501' });
    await convidar(admin, 'funcionario');
    await convidar(admin, 'admin');
    // A porta dos fundos: convidar como funcionário e trocar o papel.
    await expect(db.query(
      `update ideworks.invitations set role = 'super_admin' where created_by = $1 and role = 'funcionario'`, [admin],
    )).rejects.toMatchObject({ code: '42501' });

    await como(topo, { topo: true });
    await convidar(topo, 'super_admin');

    // A ativação (antes da sessão) gasta o convite de super admin normalmente.
    await como(null, { preauth: true });
    const gastos = await db.query(
      `update ideworks.invitations set status = 'used' where role = 'super_admin' and status = 'pending'`);
    expect(gastos.affectedRows).toBe(1);
    await comoDono();
  });

  it('3. o erro cru da coleta só para quem administra; as linhas seguem de todos', async () => {
    await comoDono();
    await db.exec(`
      insert into ideworks.meta_collection_runs (window_from, window_to, outcome, finished_at, first_error)
      values (current_date, current_date, 'partial', now(), 'Invalid OAuth access token - conta 123');`);

    await como(bob);
    await expect(db.query('select first_error from ideworks.meta_collection_runs'))
      .rejects.toMatchObject({ code: '42501' });
    // O alarme e o relatório leem data e desfecho — isso continua.
    expect(await linhas('select started_at, outcome::text as outcome from ideworks.meta_collection_runs'))
      .toHaveLength(1);
    expect((await linhas<{ n: number }>('select count(*)::int as n from ideworks.meta_collection_runs'))[0].n).toBe(1);
    const doBob = await linhas<{ outcome: string; first_error: string | null }>(
      'select outcome::text as outcome, first_error from ideworks.recent_collection_runs(20)');
    expect(doBob).toEqual([{ outcome: 'partial', first_error: null }]);

    await como(admin, { administra: true });
    const doAdmin = await linhas<{ first_error: string | null }>(
      'select first_error from ideworks.recent_collection_runs(20)');
    expect(doAdmin).toEqual([{ first_error: 'Invalid OAuth access token - conta 123' }]);

    // Sem pessoa declarada a função não devolve nada (mesmo recorte de runs_select).
    await como(null);
    expect(await linhas('select * from ideworks.recent_collection_runs(20)')).toHaveLength(0);
    await comoDono();
  });

  let comImagem = '';

  it('4. rascunho de imagem vencido não se liga; válido liga', async () => {
    const rascunho = async (n: number) => {
      await como(alice);
      return (await linhas<{ id: string }>(
        `select ideworks.register_chat_image_draft($1, $2, 'image/png', 10, $3) as id`,
        [grupo, `print-${n}.png`, `chat/${grupo}/print-${n}.png`],
      ))[0].id;
    };
    const vencido = await rascunho(1);
    const valido = await rascunho(2);

    // O prazo não se muda por UPDATE (gatilho da F20.7); envelhece-se por fora.
    await comoDono();
    await db.exec('alter table ideworks.chat_images disable trigger fix_chat_image_expiration');
    await db.query(`update ideworks.chat_images set expires_at = now() - interval '1 minute' where id = $1`, [vencido]);
    await db.exec('alter table ideworks.chat_images enable trigger fix_chat_image_expiration');

    await como(alice);
    const enviar = (chave: string, imagens: string[]) =>
      db.query('select * from ideworks.send_chat_message($1, $2, $3, $4::uuid[])', [grupo, '', chave, imagens]);
    await expect(enviar('k-vencido', [vencido]))
      .rejects.toMatchObject({ code: '22023', message: expect.stringMatching(/venceu/) });
    await expect(enviar('k-misto', [valido, vencido])).rejects.toMatchObject({ code: '22023' });

    const r = await enviar('k-valido', [valido]);
    comImagem = (r.rows[0] as { message_id: string }).message_id;

    await comoDono();
    const imgs = await linhas<{ id: string; message_id: string | null; expires_at: string | null }>(
      'select id, message_id, expires_at from ideworks.chat_images order by file_name');
    expect(imgs).toEqual([
      { id: vencido, message_id: null, expires_at: expect.anything() },
      { id: valido, message_id: comImagem, expires_at: null },
    ]);
    // A recusa desfez a mensagem inteira: só a do envio válido existe.
    expect(await linhas(`select id from ideworks.messages where kind = 'person'`)).toHaveLength(1);
  });

  it('5. os caminhos das imagens de uma mensagem só para o autor (e para a limpeza)', async () => {
    const listar = () => db.query('select * from ideworks.chat_images_of_message($1)', [comImagem]);

    await como(bob); // membro, mas não autor
    await expect(listar()).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/so o autor/) });
    await como(admin, { administra: true }); // administra, mas nem alcança
    await expect(listar()).rejects.toMatchObject({ code: '42501', message: expect.stringMatching(/nao alcanca/) });
    await como(alice);
    expect((await listar()).rows).toHaveLength(1);
    await como(null); // o coletor
    expect((await listar()).rows).toHaveLength(1);
    await comoDono();
  });

  it('com a F44_3 aplicada, o banco bate com o retrato de produção de hoje', async () => {
    // O retrato guarda o corpo numa linha só (espaços colapsados), então o
    // `semComentario` por linha não serve do lado dele: engoliria o resto da
    // função. Como a F44_3 foi aplicada por `db query -f`, que preserva os
    // comentários "F44", compara-se COM comentário dos dois lados, espaços
    // colapsados. A ACL e o dono não entram aqui.
    const hoje = esperado(retratoAtualDeProducao);
    const aplicado = await retratoAtual(false);
    // Só as três funções que a F44_3 reescreve: `chat_actor_manages` não muda e,
    // vinda da F20, tem comentário no PGlite que o retrato não guarda.
    const reescritas = ['add_conversation_member(', 'send_chat_message(', 'chat_images_of_message('];
    const dasTres = (l: string[]) => l.filter((f) => reescritas.some((r) => f.startsWith(r)));
    expect(dasTres(aplicado.funcoes)).toHaveLength(3);
    expect(dasTres(aplicado.funcoes)).toEqual(dasTres(hoje.funcoes));
    expect(aplicado.politicas.filter((p) => p.split('|')[1].startsWith('invitations_')))
      .toEqual(hoje.politicas.filter((p) => p.split('|')[1].startsWith('invitations_')));
  });

  it('o rollback devolve exatamente o retrato de hoje, e a migration reaplica', async () => {
    const depois = await retratoAtual(false);
    expect(depois.funcoes.some((f) => f.startsWith('recent_collection_runs(p_limit integer)|definer|'))).toBe(true);

    await comoDono();
    await db.exec(readFileSync(`supabase/rollback/${F44}`, 'utf8'));
    expect(await retratoAtual(true)).toEqual(esperado(retratoAnterior));
    // E os três corpos que o rollback reescreve voltam LETRA POR LETRA, sem
    // tirar comentário nenhum: é o que `conferir-schema` vai comparar.
    const restaurados = ['add_conversation_member(', 'send_chat_message(', 'chat_images_of_message('];
    const soOsRestaurados = (l: string[]) => l.filter((f) => restaurados.some((r) => f.startsWith(r)));
    expect(soOsRestaurados((await retratoAtual(false)).funcoes)).toEqual(soOsRestaurados(esperado(retratoAnterior).funcoes));
    const [acl] = await linhas<{ acl: string; colunas: number }>(`
      select c.relacl::text as acl,
             (select count(*)::int from pg_attribute a
               where a.attrelid = c.oid and coalesce(cardinality(a.attacl), 0) > 0) as colunas
        from pg_class c where c.oid = 'ideworks.meta_collection_runs'::regclass`);
    expect(acl).toEqual({ acl: aclAntes, colunas: 0 });

    // E de volta: a tranca 1 vale de novo depois de reaplicar.
    await db.exec(migration(F44));
    expect(await retratoAtual(false)).toEqual(depois);
    await como(admin, { administra: true });
    await expect(db.query('select ideworks.add_conversation_member($1, $2)', [grupo, admin]))
      .rejects.toMatchObject({ code: '42501' });
    await comoDono();
  });
});
