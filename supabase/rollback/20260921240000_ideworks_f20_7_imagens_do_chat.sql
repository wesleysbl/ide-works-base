-- =============================================================================
-- ROLLBACK — F20.7  Imagens e prints no chat
-- =============================================================================
-- Remove chat_images e devolve send_chat_message / purge à forma da F20.2
-- (corpo vazio sempre recusado; limpeza apaga qualquer mensagem vencida).
-- =============================================================================

begin;
set local lock_timeout = '15s';

drop function if exists ideworks.finish_expired_chat_message(uuid);
drop function if exists ideworks.expired_chat_messages_for_purge(integer);
drop function if exists ideworks.finish_expired_chat_draft_image(uuid, text);
drop function if exists ideworks.expired_chat_draft_images();
drop function if exists ideworks.finish_chat_image_row(uuid, text);
drop function if exists ideworks.chat_images_of_message(uuid);
drop function if exists ideworks.register_chat_image_draft(uuid, text, text, integer, text);

drop trigger if exists fix_chat_image_expiration on ideworks.chat_images;
drop function if exists ideworks.fix_chat_image_expiration();

drop table if exists ideworks.chat_images;

drop function if exists ideworks.send_chat_message(uuid, text, text, uuid[]);

-- Forma F20.2: corpo vazio sempre recusado; sem imagens.
create or replace function ideworks.send_chat_message(
  p_conversation_id uuid,
  p_body text,
  p_client_key text
) returns table (
  message_id uuid,
  conversation_id uuid,
  author_id uuid,
  body text,
  kind ideworks.message_kind,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  client_key text,
  recipient_ids uuid[]
)
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_actor   uuid := ideworks.chat_require_actor();
  v_body    text := btrim(coalesce(p_body, ''));
  v_key     text := btrim(coalesce(p_client_key, ''));
  v_existing ideworks.messages%rowtype;
  v_count   integer;
  v_row     ideworks.messages%rowtype;
  v_recipients uuid[];
begin
  if v_key = '' or char_length(v_key) > 128 then
    raise exception 'chave de envio obrigatoria' using errcode = '22023';
  end if;
  if v_body = '' then
    raise exception 'mensagem vazia nao e enviada' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'mensagem passa do teto de 4000 caracteres'
      using errcode = '22023';
  end if;
  if not ideworks.can_reach_conversation(p_conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;

  select m.* into v_existing
    from ideworks.messages m
   where m.author_id = v_actor
     and m.client_key = v_key;

  if found then
    if v_existing.conversation_id is distinct from p_conversation_id then
      raise exception 'chave de envio ja usada em outra conversa'
        using errcode = '22023';
    end if;
    v_recipients := ideworks.chat_recipient_ids(p_conversation_id);
    return query
      select v_existing.id, v_existing.conversation_id, v_existing.author_id,
             v_existing.body, v_existing.kind, v_existing.created_at,
             v_existing.edited_at, v_existing.deleted_at, v_existing.client_key,
             v_recipients;
    return;
  end if;

  select count(*)::int into v_count
    from ideworks.messages m
   where m.author_id = v_actor
     and m.kind = 'person'
     and m.created_at >= now() - interval '1 minute';

  if v_count >= 30 then
    raise exception
      'limite de 30 mensagens por minuto; espere um pouco e tente de novo'
      using errcode = '54000';
  end if;

  insert into ideworks.messages as msg (
    conversation_id, author_id, body, kind, client_key
  ) values (
    p_conversation_id, v_actor, v_body, 'person', v_key
  )
  returning msg.* into v_row;

  update ideworks.conversations as c
     set updated_at = now()
   where c.id = p_conversation_id;

  v_recipients := ideworks.chat_recipient_ids(p_conversation_id);

  return query
    select v_row.id, v_row.conversation_id, v_row.author_id,
           v_row.body, v_row.kind, v_row.created_at,
           v_row.edited_at, v_row.deleted_at, v_row.client_key,
           v_recipients;
end
$fn$;

comment on function ideworks.send_chat_message(uuid, text, text) is
  'Envia mensagem de pessoa. Reenvio com a mesma chave devolve a linha sem '
  'duplicar nem contar no teto. Devolve destinatarios na mesma transacao.';

create or replace function ideworks.purge_expired_chat_messages(
  p_limit integer default 100
) returns integer
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_n integer;
  v_limite integer := greatest(coalesce(p_limit, 100), 1);
begin
  perform ideworks.assert_collector();

  with doomed as (
    select m.id
      from ideworks.messages m
     where m.created_at < now() - ideworks.chat_retention()
     order by m.created_at asc, m.id asc
     limit v_limite
  ),
  deleted as (
    delete from ideworks.messages m
     using doomed d
     where m.id = d.id
    returning m.id
  )
  select count(*)::int into v_n from deleted;

  return coalesce(v_n, 0);
end
$fn$;

comment on function ideworks.purge_expired_chat_messages(integer) is
  'Apaga linhas de mensagem vencidas em lote. So pelo ator do servidor '
  '(assert_collector). Nesta fase so a linha — imagem e F20.7.';

revoke all on function ideworks.send_chat_message(uuid, text, text)
  from public, anon, authenticated;
grant execute on function ideworks.send_chat_message(uuid, text, text)
  to ideworks_app;
grant execute on function ideworks.purge_expired_chat_messages(integer)
  to ideworks_app;

commit;
