/** Prova local: consulta REAL da aplicação com withActor e RLS, sem rede. */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { chatMentionRecipientIds, editChatMessage, sendChatMessage, deleteChatMessage } from '@/server/chat';
import type { Sql } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';

it('autor descobre alvos sem ler a caixa alheia; edição, remoção e alcance continuam restritos', async () => {
  const db = new PGlite();
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const [alice, bob, carla, fora] = [1, 2, 3, 4].map(id);
  const token = (p: string) => `@[Pessoa](mention:${p})`;
  const actor = (userId: string) => ({ userId, isSuper: false, isSuperadmin: false } as AuthenticatedActor);
  const migration = (name: string) => readFileSync(`supabase/migrations/${name}`, 'utf8');
  try {
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
      create function ideworks.assert_collector() returns void language plpgsql as $$ begin
        if ideworks.acting_user_id() is not null then raise exception 'collector only'; end if;
      end $$;
      insert into ideworks.profiles(id, full_name, email) values
        ('${alice}', 'Alice', 'alice@example.invalid'), ('${bob}', 'Bob', 'bob@example.invalid'),
        ('${carla}', 'Carla', 'carla@example.invalid'), ('${fora}', 'Fora', 'fora@example.invalid');
    `);
    const f17 = migration('20260911180517_ideworks_f17_82_mencoes_e_notificacoes.sql');
    await db.exec(f17.match(/create function ideworks\.mentioned_people[\s\S]*?\$fn\$;/)![0]);
    // Produção não concede este auxiliar ao papel da aplicação.
    await db.exec('revoke all on function ideworks.mentioned_people(text) from public, ideworks_app');
    for (const nome of [
      '20260921210000_ideworks_f20_1_conversas.sql',
      '20260921220000_ideworks_f20_2_mensagens.sql',
      '20260921230000_ideworks_f20_6_membros_na_lista.sql',
      '20260921240000_ideworks_f20_7_imagens_do_chat.sql',
      '20260921250000_ideworks_f20_8_mencoes_do_chat.sql',
    ]) await db.exec(migration(nome));

    // Adaptador só de transporte. A identidade é declarada pelo withActor REAL.
    const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, '');
      return (await db.query(query, values)).rows;
    };
    const sql = { begin: async (run: (tx: unknown) => Promise<unknown>) => {
      await db.exec('begin; set local role ideworks_app');
      try { const r = await run(tx); await db.exec('commit'); return r; }
      catch (e) { await db.exec('rollback'); throw e; }
    } } as unknown as Sql;
    await db.query("select set_config('app.user_id', $1, false)", [alice]);
    const grupo = (await db.query<{ id: string }>(
      'select ideworks.create_group_conversation($1, $2::uuid[]) as id', ['Squad', [bob, carla]],
    )).rows[0].id;

    const msg = await sendChatMessage(sql, actor(alice), grupo, `${token(alice)} ${token(bob)} ${token(bob)}`, 'k1');
    expect(await chatMentionRecipientIds(sql, actor(alice), msg.id)).toEqual([bob]);
    expect(await chatMentionRecipientIds(sql, actor(fora), msg.id)).toEqual([]);
    await db.exec('set role ideworks_app');
    expect((await db.query('select * from ideworks.chat_mentions')).rows).toHaveLength(0);
    await db.query("select set_config('app.user_id', $1, false)", [bob]);
    expect((await db.query('select * from ideworks.chat_mentions')).rows).toHaveLength(1);
    await db.exec('reset role');

    // A mesma chave confirma a mesma mensagem e não duplica aviso persistido.
    const repetida = await sendChatMessage(sql, actor(alice), grupo, 'corpo ignorado no reenvio', 'k1');
    expect(repetida.id).toBe(msg.id);
    expect(await chatMentionRecipientIds(sql, actor(alice), repetida.id)).toEqual([bob]);
    expect((await db.query('select * from ideworks.chat_mentions')).rows).toHaveLength(1);
    const antes = await chatMentionRecipientIds(sql, actor(alice), msg.id);
    await editChatMessage(sql, actor(alice), msg.id, token(carla));
    const depois = await chatMentionRecipientIds(sql, actor(alice), msg.id);
    expect(antes).toEqual([bob]);
    expect(depois).toEqual([carla]);
    expect((await db.query<{ recipient_id: string }>('select recipient_id from ideworks.chat_mentions')).rows[0].recipient_id).toBe(carla);
    await expect(editChatMessage(sql, actor(alice), msg.id, token(fora))).rejects.toMatchObject({ status: 400 });
    await editChatMessage(sql, actor(alice), msg.id, 'Sem menção');
    expect(await chatMentionRecipientIds(sql, actor(alice), msg.id)).toEqual([]);
    expect((await db.query('select * from ideworks.chat_mentions')).rows).toHaveLength(0);

    await editChatMessage(sql, actor(alice), msg.id, token(carla));
    await db.query('update ideworks.profiles set is_active = false where id = $1', [carla]);
    expect(await chatMentionRecipientIds(sql, actor(alice), msg.id)).toEqual([]);
    await db.query('update ideworks.profiles set is_active = true where id = $1', [carla]);
    await db.query('delete from ideworks.conversation_members where conversation_id = $1 and user_id = $2', [grupo, carla]);
    expect(await chatMentionRecipientIds(sql, actor(alice), msg.id)).toEqual([]);
    await editChatMessage(sql, actor(alice), msg.id, token(bob));
    await deleteChatMessage(sql, actor(alice), msg.id);
    expect(await chatMentionRecipientIds(sql, actor(alice), msg.id)).toEqual([]);
    expect((await db.query('select * from ideworks.chat_mentions')).rows).toHaveLength(0);
  } finally { await db.close(); }
}, 30_000);
