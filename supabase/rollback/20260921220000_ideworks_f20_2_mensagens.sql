-- Desfaz a F20.2. Nome identico ao da migration, de proposito.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F20.1: conversas sem tabela de mensagens, e as
--   funcoes de dominio SEM gravar linha de sistema (corpo da F20.1).
--
--   ⚠️ REVERTER APAGA TODAS AS MENSAGENS. Sem recuperacao.
--
-- A ORDEM
--   1. Restaura as funcoes da F20.1 (sem referencia a messages).
--   2. Remove funcoes novas da F20.2.
--   3. Remove a tabela e o enum.
--
-- O QUE O ROLLBACK NAO ALCANCA
--   Tabelas/funcoes da F20.1, `public` e `auth`.

-- --- 1. Funcoes da F20.1 de volta (sem gravar mensagem) ---------------------

create or replace function ideworks.chat_pass_ownership_if_needed(
  p_conversation_id uuid,
  p_leaving_user_id uuid
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_owners integer;
  v_was_owner boolean;
  v_heir uuid;
begin
  select exists (
    select 1 from ideworks.conversation_members
     where conversation_id = p_conversation_id
       and user_id = p_leaving_user_id
       and role = 'owner'
  ) into v_was_owner;

  if not v_was_owner then return; end if;

  select count(*)::int into v_owners
    from ideworks.conversation_members
   where conversation_id = p_conversation_id
     and role = 'owner'
     and user_id <> p_leaving_user_id;

  if v_owners > 0 then return; end if;

  select m.user_id into v_heir
    from ideworks.conversation_members m
   where m.conversation_id = p_conversation_id
     and m.user_id <> p_leaving_user_id
   order by m.joined_at asc, m.user_id asc
   limit 1;

  if v_heir is not null then
    update ideworks.conversation_members
       set role = 'owner'
     where conversation_id = p_conversation_id
       and user_id = v_heir;
  end if;
end
$fn$;

create or replace function ideworks.create_group_conversation(
  p_name text,
  p_member_ids uuid[] default '{}'::uuid[]
) returns uuid
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_name  text := btrim(coalesce(p_name, ''));
  v_id    uuid;
  v_uid   uuid;
begin
  if v_name = '' then
    raise exception 'grupo precisa de nome' using errcode = '22023';
  end if;

  insert into ideworks.conversations (kind, name, created_by)
  values ('group', v_name, v_actor)
  returning id into v_id;

  insert into ideworks.conversation_members (conversation_id, user_id, role)
  values (v_id, v_actor, 'owner');

  foreach v_uid in array coalesce(p_member_ids, '{}'::uuid[]) loop
    if v_uid = v_actor then continue; end if;
    if not ideworks.chat_person_is_active(v_uid) then
      raise exception 'so pessoa ativa entra no grupo' using errcode = '22023';
    end if;
    insert into ideworks.conversation_members (conversation_id, user_id, role)
    values (v_id, v_uid, 'member')
    on conflict do nothing;
  end loop;

  return v_id;
end
$fn$;

create or replace function ideworks.rename_conversation(p_conversation_id uuid, p_name text)
  returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_kind  ideworks.conversation_kind;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  select kind into v_kind from ideworks.conversations where id = p_conversation_id;
  if not found then
    raise exception 'conversa nao encontrada' using errcode = '42501';
  end if;
  if v_kind = 'general' then
    raise exception 'o Geral nao se renomeia' using errcode = '22023';
  end if;
  if v_kind = 'direct' then
    raise exception 'conversa direta nao tem nome' using errcode = '22023';
  end if;
  if v_name = '' then
    raise exception 'grupo precisa de nome' using errcode = '22023';
  end if;
  if not ideworks.chat_actor_manages(p_conversation_id) then
    raise exception 'so o dono ou administrador renomeia o grupo'
      using errcode = '42501';
  end if;

  update ideworks.conversations
     set name = v_name, updated_at = now()
   where id = p_conversation_id;
end
$fn$;

create or replace function ideworks.add_conversation_member(
  p_conversation_id uuid,
  p_user_id uuid
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_kind  ideworks.conversation_kind;
  v_count integer;
begin
  select kind into v_kind from ideworks.conversations where id = p_conversation_id;
  if not found then
    raise exception 'conversa nao encontrada' using errcode = '42501';
  end if;
  if v_kind = 'general' then
    raise exception 'o Geral nao tem lista de membros para editar'
      using errcode = '22023';
  end if;
  if not ideworks.chat_actor_manages(p_conversation_id) then
    raise exception 'so o dono ou administrador adiciona membros'
      using errcode = '42501';
  end if;
  if not ideworks.chat_person_is_active(p_user_id) then
    raise exception 'so pessoa ativa e adicionada' using errcode = '22023';
  end if;

  if v_kind = 'direct' then
    select count(*)::int into v_count
      from ideworks.conversation_members
     where conversation_id = p_conversation_id;
    if v_count >= 2
       and not exists (
         select 1 from ideworks.conversation_members
          where conversation_id = p_conversation_id and user_id = p_user_id
       ) then
      raise exception 'conversa direta nao aceita terceira pessoa'
        using errcode = '22023';
    end if;
  end if;

  insert into ideworks.conversation_members (conversation_id, user_id, role)
  values (p_conversation_id, p_user_id, 'member')
  on conflict do nothing;

  update ideworks.conversations
     set archived_at = null, updated_at = now()
   where id = p_conversation_id
     and archived_at is not null;
end
$fn$;

create or replace function ideworks.remove_conversation_member(
  p_conversation_id uuid,
  p_user_id uuid
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_kind  ideworks.conversation_kind;
begin
  select kind into v_kind from ideworks.conversations where id = p_conversation_id;
  if not found then
    raise exception 'conversa nao encontrada' using errcode = '42501';
  end if;
  if v_kind = 'general' then
    raise exception 'ninguem sai do Geral por remocao de membro'
      using errcode = '22023';
  end if;
  if not ideworks.chat_actor_manages(p_conversation_id) then
    raise exception 'so o dono ou administrador remove membros'
      using errcode = '42501';
  end if;

  perform ideworks.chat_pass_ownership_if_needed(p_conversation_id, p_user_id);

  delete from ideworks.conversation_members
   where conversation_id = p_conversation_id
     and user_id = p_user_id;

  perform ideworks.chat_archive_if_empty(p_conversation_id);
end
$fn$;

create or replace function ideworks.leave_conversation(p_conversation_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_kind  ideworks.conversation_kind;
begin
  select kind into v_kind from ideworks.conversations where id = p_conversation_id;
  if not found then
    raise exception 'conversa nao encontrada' using errcode = '42501';
  end if;
  if v_kind = 'general' then
    raise exception 'ninguem sai do Geral' using errcode = '22023';
  end if;
  if not exists (
    select 1 from ideworks.conversation_members
     where conversation_id = p_conversation_id and user_id = v_actor
  ) then
    raise exception 'voce nao e membro desta conversa' using errcode = '42501';
  end if;

  perform ideworks.chat_pass_ownership_if_needed(p_conversation_id, v_actor);

  delete from ideworks.conversation_members
   where conversation_id = p_conversation_id
     and user_id = v_actor;

  perform ideworks.chat_archive_if_empty(p_conversation_id);
end
$fn$;

create or replace function ideworks.transfer_conversation_ownership(
  p_conversation_id uuid,
  p_new_owner_id uuid
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_kind  ideworks.conversation_kind;
begin
  select kind into v_kind from ideworks.conversations where id = p_conversation_id;
  if not found then
    raise exception 'conversa nao encontrada' using errcode = '42501';
  end if;
  if v_kind <> 'group' then
    raise exception 'so grupo tem dono para transferir' using errcode = '22023';
  end if;
  if not ideworks.chat_actor_manages(p_conversation_id) then
    raise exception 'so o dono ou administrador passa a posse'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from ideworks.conversation_members
     where conversation_id = p_conversation_id and user_id = p_new_owner_id
  ) then
    raise exception 'o novo dono precisa ser membro do grupo'
      using errcode = '22023';
  end if;

  update ideworks.conversation_members
     set role = 'member'
   where conversation_id = p_conversation_id
     and role = 'owner';

  update ideworks.conversation_members
     set role = 'owner'
   where conversation_id = p_conversation_id
     and user_id = p_new_owner_id;

  update ideworks.conversations
     set updated_at = now()
   where id = p_conversation_id;
end
$fn$;

-- --- 2. Funcoes novas da F20.2 (tabela antes: a politica usa chat_retention) --

drop function if exists ideworks.purge_expired_chat_messages(integer);
drop function if exists ideworks.mark_conversation_read(uuid, timestamptz);
drop function if exists ideworks.list_my_chat_conversations();
drop function if exists ideworks.list_chat_message_changes(uuid, timestamptz);
drop function if exists ideworks.list_chat_messages(uuid, timestamptz, uuid);
drop function if exists ideworks.delete_chat_message(uuid);
drop function if exists ideworks.edit_chat_message(uuid, text);
drop function if exists ideworks.send_chat_message(uuid, text, text);
drop function if exists ideworks.chat_insert_system_message(uuid, uuid, text);
drop function if exists ideworks.chat_recipient_ids(uuid);

-- --- 3. Tabela (cai a politica que depende de chat_retention) e enum --------

drop table if exists ideworks.messages;
drop function if exists ideworks.chat_retention();
drop type if exists ideworks.message_kind;
