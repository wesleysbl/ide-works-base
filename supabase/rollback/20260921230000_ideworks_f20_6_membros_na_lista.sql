-- =============================================================================
-- ROLLBACK — F20.6  Membros e parceiro na lista
-- =============================================================================
-- Devolve `list_my_chat_conversations` à assinatura da F20.2 (sem membros,
-- marca, papel nem parceiro).
-- =============================================================================

begin;
set local lock_timeout = '15s';

drop function if exists ideworks.list_my_chat_conversations();

create or replace function ideworks.list_my_chat_conversations()
  returns table (
    conversation_id uuid,
    kind ideworks.conversation_kind,
    name text,
    archived_at timestamptz,
    last_message_id uuid,
    last_message_body text,
    last_message_kind ideworks.message_kind,
    last_message_author_id uuid,
    last_message_at timestamptz,
    last_message_deleted_at timestamptz,
    unread_count bigint
  )
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_actor uuid := ideworks.chat_require_actor();
begin
  return query
    with reachable as (
      select c.id, c.kind, c.name, c.archived_at
        from ideworks.conversations c
       where ideworks.can_reach_conversation(c.id)
    ),
    marks as (
      select r.conversation_id, r.last_read_at
        from ideworks.conversation_read_marks r
       where r.user_id = v_actor
    ),
    latest as (
      select distinct on (m.conversation_id)
             m.conversation_id,
             m.id as last_message_id,
             m.body as last_message_body,
             m.kind as last_message_kind,
             m.author_id as last_message_author_id,
             m.created_at as last_message_at,
             m.deleted_at as last_message_deleted_at
        from ideworks.messages m
        join reachable a on a.id = m.conversation_id
       where m.created_at >= now() - ideworks.chat_retention()
       order by m.conversation_id, m.created_at desc, m.id desc
    ),
    unreads as (
      select m.conversation_id, count(*)::bigint as unread_count
        from ideworks.messages m
        join reachable a on a.id = m.conversation_id
        left join marks mk on mk.conversation_id = m.conversation_id
       where m.created_at >= now() - ideworks.chat_retention()
         and m.kind = 'person'
         and m.author_id <> v_actor
         and m.deleted_at is null
         and m.created_at > coalesce(mk.last_read_at, '-infinity'::timestamptz)
       group by m.conversation_id
    )
    select a.id,
           a.kind,
           a.name,
           a.archived_at,
           u.last_message_id,
           u.last_message_body,
           u.last_message_kind,
           u.last_message_author_id,
           u.last_message_at,
           u.last_message_deleted_at,
           coalesce(n.unread_count, 0::bigint)
      from reachable a
      left join latest u on u.conversation_id = a.id
      left join unreads n on n.conversation_id = a.id
     order by
       case when a.kind = 'general' then 0 else 1 end,
       u.last_message_at desc nulls last,
       a.id;
end
$fn$;

comment on function ideworks.list_my_chat_conversations() is
  'Minhas conversas: ultima mensagem (lapide incluida) e contagem de nao '
  'lidas. Nao lida = pessoa, outro autor, nao apagada, na janela, apos a marca.';

revoke all on function ideworks.list_my_chat_conversations()
  from public, anon, authenticated;
grant execute on function ideworks.list_my_chat_conversations() to ideworks_app;

commit;
