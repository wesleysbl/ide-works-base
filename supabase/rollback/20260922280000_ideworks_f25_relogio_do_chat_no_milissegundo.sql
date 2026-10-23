-- Reversão da F25 — volta as três funções ao estado da F20.6 / F24.2, que
-- comparam instantes no microssegundo. Não há dado a desfazer: a F25 só mudou
-- a regra de comparação. Voltar devolve o defeito das marcas de leitura presas.
begin;
set local lock_timeout = '15s';

-- --- reposição de mensagens --------------------------------------------------

create or replace function ideworks.list_chat_message_changes(
  p_conversation_id uuid,
  p_since timestamptz
) returns setof ideworks.messages
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
    select m.*
      from ideworks.messages m
     where m.conversation_id = p_conversation_id
       and m.created_at >= now() - ideworks.chat_retention()
       and (
            m.created_at > p_since
            or coalesce(m.edited_at, '-infinity'::timestamptz) > p_since
            or coalesce(m.deleted_at, '-infinity'::timestamptz) > p_since
           )
     order by m.created_at asc, m.id asc;
end
$fn$;

-- --- reposição de reações ----------------------------------------------------

create or replace function ideworks.list_chat_reaction_changes(
  p_conversation_id uuid,
  p_since timestamptz
) returns table (
  message_id uuid,
  actor_id uuid,
  emoji ideworks.chat_reaction_emoji,
  reacted_at timestamptz,
  removed boolean
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
    select r.message_id,
           r.actor_id,
           r.emoji,
           r.changed_at,
           (r.removed_at is not null)
      from ideworks.chat_reactions r
      join ideworks.messages m on m.id = r.message_id
     where r.conversation_id = p_conversation_id
       and r.changed_at > p_since
       and m.created_at >= now() - ideworks.chat_retention()
     order by r.changed_at, r.id;
end
$fn$;

-- --- lista de conversas (não lidas) ------------------------------------------
--   Como na F20.6.

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
  unread_count bigint,
  last_read_at timestamptz,
  my_role ideworks.conversation_member_role,
  peer_user_id uuid,
  peer_name text,
  peer_is_active boolean,
  members jsonb
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
    ),
    member_rows as (
      select m.conversation_id,
             jsonb_agg(
               jsonb_build_object(
                 'id', m.user_id,
                 'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
                 'role', m.role::text,
                 'isActive', p.is_active
               )
               order by
                 case when m.role = 'owner' then 0 else 1 end,
                 coalesce(nullif(btrim(p.full_name), ''), p.email),
                 m.user_id
             ) as members
        from ideworks.conversation_members m
        join ideworks.profiles p on p.id = m.user_id
        join reachable a on a.id = m.conversation_id
       where a.kind in ('group', 'direct')
       group by m.conversation_id
    ),
    general_members as (
      select a.id as conversation_id,
             (
               select coalesce(
                 jsonb_agg(
                   jsonb_build_object(
                     'id', p.id,
                     'name', coalesce(nullif(btrim(p.full_name), ''), p.email),
                     'role', null,
                     'isActive', true
                   )
                   order by coalesce(nullif(btrim(p.full_name), ''), p.email), p.id
                 ),
                 '[]'::jsonb
               )
               from ideworks.profiles p
              where p.is_active
             ) as members
        from reachable a
       where a.kind = 'general'
    ),
    my_roles as (
      select m.conversation_id, m.role as my_role
        from ideworks.conversation_members m
       where m.user_id = v_actor
    ),
    peers as (
      select m.conversation_id,
             p.id as peer_user_id,
             coalesce(nullif(btrim(p.full_name), ''), p.email) as peer_name,
             p.is_active as peer_is_active
        from ideworks.conversation_members m
        join ideworks.profiles p on p.id = m.user_id
        join reachable a on a.id = m.conversation_id
       where a.kind = 'direct'
         and m.user_id <> v_actor
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
           coalesce(n.unread_count, 0::bigint),
           mk.last_read_at,
           mr.my_role,
           pe.peer_user_id,
           pe.peer_name,
           pe.peer_is_active,
           case
             when a.kind = 'general' then coalesce(gm.members, '[]'::jsonb)
             else coalesce(mb.members, '[]'::jsonb)
           end
      from reachable a
      left join latest u on u.conversation_id = a.id
      left join unreads n on n.conversation_id = a.id
      left join marks mk on mk.conversation_id = a.id
      left join my_roles mr on mr.conversation_id = a.id
      left join peers pe on pe.conversation_id = a.id
      left join member_rows mb on mb.conversation_id = a.id
      left join general_members gm on gm.conversation_id = a.id
     order by
       case when a.kind = 'general' then 0 else 1 end,
       u.last_message_at desc nulls last,
       a.id;
end
$fn$;

-- =============================================================================
-- Permissões (reafirmadas: `create or replace` as mantém, mas o arquivo diz)
-- =============================================================================

revoke all on function ideworks.list_chat_message_changes(uuid, timestamptz)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.list_chat_reaction_changes(uuid, timestamptz)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.list_my_chat_conversations()
  from public, anon, authenticated, ideworks_app;

grant execute on function ideworks.list_chat_message_changes(uuid, timestamptz) to ideworks_app;
grant execute on function ideworks.list_chat_reaction_changes(uuid, timestamptz) to ideworks_app;
grant execute on function ideworks.list_my_chat_conversations() to ideworks_app;

commit;
