-- Reversão da F24.2 — volta ao estado da F24.1 (reação sem lápide).
-- Publicar primeiro a versão anterior do Worker. As reações já removidas
-- (lápides) somem de vez; as vivas ficam.
begin;
set local lock_timeout = '15s';

-- A lápide deixa de existir: a linha morta vira linha apagada.
delete from ideworks.chat_reactions where removed_at is not null;

alter table ideworks.chat_reactions
  drop column if exists removed_at,
  drop column if exists changed_at;

drop index if exists ideworks.chat_reactions_message_idx;
create index chat_reactions_message_idx
  on ideworks.chat_reactions (message_id);

drop index if exists ideworks.chat_reactions_conversation_changed_idx;
create index chat_reactions_conversation_changed_idx
  on ideworks.chat_reactions (conversation_id, reacted_at desc);

-- Alternar volta a apagar a linha.
create or replace function ideworks.toggle_chat_reaction(
  p_message_id uuid,
  p_emoji ideworks.chat_reaction_emoji
) returns table (
  message_id uuid,
  conversation_id uuid,
  actor_id uuid,
  emoji ideworks.chat_reaction_emoji,
  reacted_at timestamptz,
  removed boolean,
  recipient_ids uuid[]
)
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_actor      uuid := ideworks.chat_require_actor();
  v_message    ideworks.messages%rowtype;
  v_existing   ideworks.chat_reactions%rowtype;
  v_row        ideworks.chat_reactions%rowtype;
  v_removed    boolean := false;
  v_recipients uuid[];
begin
  if p_emoji is null then
    raise exception 'escolha um dos seis emojis de reação' using errcode = '22023';
  end if;

  select m.* into v_message
    from ideworks.messages m
   where m.id = p_message_id;

  if not found then
    raise exception 'mensagem nao encontrada' using errcode = '42501';
  end if;
  if not ideworks.can_reach_conversation(v_message.conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;
  if v_message.deleted_at is not null then
    raise exception 'mensagem apagada nao recebe reacao' using errcode = '23514';
  end if;
  if v_message.kind <> 'person' then
    raise exception 'linha de sistema nao recebe reacao' using errcode = '23514';
  end if;
  if v_message.created_at < now() - ideworks.chat_retention() then
    raise exception 'mensagem fora da janela de 30 dias' using errcode = '23514';
  end if;

  select r.* into v_existing
    from ideworks.chat_reactions r
   where r.message_id = p_message_id
     and r.actor_id = v_actor
     for update;

  if found and v_existing.emoji = p_emoji then
    delete from ideworks.chat_reactions r where r.id = v_existing.id;
    v_removed := true;
    v_row := v_existing;
  elsif found then
    update ideworks.chat_reactions as r
       set emoji = p_emoji,
           reacted_at = now()
     where r.id = v_existing.id
    returning r.* into v_row;
  else
    insert into ideworks.chat_reactions as r (
      conversation_id, message_id, actor_id, emoji
    ) values (
      v_message.conversation_id, p_message_id, v_actor, p_emoji
    )
    returning r.* into v_row;
  end if;

  v_recipients := ideworks.chat_recipient_ids(v_message.conversation_id);

  return query
    select v_message.id,
           v_message.conversation_id,
           v_actor,
           case when v_removed then null::ideworks.chat_reaction_emoji
                else v_row.emoji end,
           case when v_removed then now() else v_row.reacted_at end,
           v_removed,
           v_recipients;
end
$fn$;

create or replace function ideworks.list_chat_reactions(
  p_conversation_id uuid,
  p_message_ids uuid[]
) returns table (
  message_id uuid,
  actor_id uuid,
  emoji ideworks.chat_reaction_emoji,
  reacted_at timestamptz
)
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.chat_require_actor();
  if not ideworks.can_reach_conversation(p_conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;
  if p_message_ids is null then
    raise exception 'lista de mensagens obrigatoria' using errcode = '22023';
  end if;
  if cardinality(p_message_ids) > 500 then
    raise exception 'peça as reações de no máximo 500 mensagens por vez'
      using errcode = '22023';
  end if;

  return query
    select r.message_id, r.actor_id, r.emoji, r.reacted_at
      from ideworks.chat_reactions r
      join ideworks.messages m on m.id = r.message_id
     where r.conversation_id = p_conversation_id
       and r.message_id = any (p_message_ids)
       and m.created_at >= now() - ideworks.chat_retention()
     order by r.reacted_at, r.id;
end
$fn$;

drop function if exists ideworks.list_chat_reaction_changes(uuid, timestamptz);

create function ideworks.list_chat_reaction_changes(
  p_conversation_id uuid,
  p_since timestamptz
) returns table (
  message_id uuid,
  actor_id uuid,
  emoji ideworks.chat_reaction_emoji,
  reacted_at timestamptz
)
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.chat_require_actor();
  if not ideworks.can_reach_conversation(p_conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;
  if p_since is null then
    raise exception 'momento de referencia obrigatorio' using errcode = '22023';
  end if;

  return query
    select r.message_id, r.actor_id, r.emoji, r.reacted_at
      from ideworks.chat_reactions r
      join ideworks.messages m on m.id = r.message_id
     where r.conversation_id = p_conversation_id
       and r.reacted_at > p_since
       and m.created_at >= now() - ideworks.chat_retention()
     order by r.reacted_at, r.id;
end
$fn$;

revoke all on function ideworks.list_chat_reaction_changes(uuid, timestamptz)
  from public, anon, authenticated, ideworks_app;
grant execute on function ideworks.list_chat_reaction_changes(uuid, timestamptz)
  to ideworks_app;

commit;
