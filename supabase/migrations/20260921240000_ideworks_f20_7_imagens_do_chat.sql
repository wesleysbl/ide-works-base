-- =============================================================================
-- IDE WORKS — F20.7  Imagens e prints no chat
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   Da para colar, arrastar ou anexar PNG/JPEG numa mensagem; a imagem vive no
--   mesmo balde privado dos anexos, em diretorio proprio, e sai com a mensagem.
--
-- AS VERDADES DESTA ETAPA
--   1. Mesmo balde `ideworks-anexos`, prefixo `chat/{conversa}/…`. Teto 5 MB.
--      So PNG e JPEG, conferidos pelo conteudo real no Worker (nao na SQL).
--   2. Rascunho: message_id nulo, vence em 24 horas (prazo fixado pelo banco).
--      Ligado a mensagem: expires_at nulo — vive a janela da mensagem (30 dias).
--   3. Corpo vazio e aceito so quando ha imagem a ligar (p_image_ids).
--      O texto guarda `attachment:{uuid}`, nunca endereco assinado.
--   4. Limpeza: bytes primeiro, registro depois, mensagem por ultimo. Falha do
--      armazenamento deixa a mensagem para a volta seguinte (ja invisivel).
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria API, Worker, tela nem cron novo. Nao toca em F21. Nao regrava o
--   retrato do schema.
-- =============================================================================

begin;
set local lock_timeout = '15s';

-- =============================================================================
-- Tabela
-- =============================================================================

create table ideworks.chat_images (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null
    references ideworks.conversations (id) on delete cascade,
  message_id       uuid
    references ideworks.messages (id) on delete cascade,
  uploaded_by      uuid not null
    references ideworks.profiles (id) on delete cascade,
  file_name        text not null,
  content_type     text not null,
  byte_size        integer not null,
  storage_path     text not null,
  created_at       timestamptz not null default now(),
  -- Rascunho: preenchido (24 h). Ligado a mensagem: nulo.
  expires_at       timestamptz,

  constraint chat_images_name_is_a_name check (btrim(file_name) <> ''),
  constraint chat_images_content_type_ok check (
    content_type in ('image/png', 'image/jpeg')
  ),
  constraint chat_images_size_positive check (byte_size > 0),
  constraint chat_images_size_ceiling check (byte_size <= 5242880),
  constraint chat_images_path_not_empty check (btrim(storage_path) <> ''),
  constraint chat_images_draft_or_linked check (
    (message_id is null and expires_at is not null)
    or (message_id is not null and expires_at is null)
  )
);

comment on table ideworks.chat_images is
  'Imagem do chat. Rascunho (message_id nulo) vence em 24 h; ligada a mensagem '
  'vive a janela de 30 dias. Bytes no balde privado, prefixo chat/.';
comment on column ideworks.chat_images.expires_at is
  'So rascunho. Fixado em 24 h no INSERT; limpo ao ligar a mensagem.';
comment on column ideworks.chat_images.storage_path is
  'Caminho no balde ideworks-anexos. Nunca e URL assinada.';

create unique index chat_images_storage_path_uidx
  on ideworks.chat_images (storage_path);

create index chat_images_conversation_idx
  on ideworks.chat_images (conversation_id, created_at);

create index chat_images_message_idx
  on ideworks.chat_images (message_id)
  where message_id is not null;

create index chat_images_draft_expiration_idx
  on ideworks.chat_images (expires_at, id)
  where expires_at is not null;

-- =============================================================================
-- Prazo do rascunho — nasce no servidor, nao se renova
-- =============================================================================

create function ideworks.fix_chat_image_expiration() returns trigger
language plpgsql set search_path = ideworks, pg_temp as $fn$
begin
  if TG_OP = 'INSERT' then
    if new.message_id is null then
      new.expires_at := now() + interval '24 hours';
    else
      new.expires_at := null;
    end if;
  elsif old.message_id is null and new.message_id is not null then
    -- Ligacao no envio: sai do prazo de rascunho.
    new.expires_at := null;
  elsif new.expires_at is distinct from old.expires_at
     or new.storage_path is distinct from old.storage_path
     or (old.message_id is not null and new.message_id is distinct from old.message_id) then
    raise exception 'O prazo e o arquivo de uma imagem do chat nao podem ser alterados.'
      using errcode = '22023';
  end if;
  return new;
end;
$fn$;

create trigger fix_chat_image_expiration
  before insert or update on ideworks.chat_images
  for each row execute function ideworks.fix_chat_image_expiration();

revoke all on function ideworks.fix_chat_image_expiration()
  from public, anon, authenticated;

-- =============================================================================
-- RLS — so SELECT; escrita e dominio / coletor
-- =============================================================================

alter table ideworks.chat_images enable row level security;

drop policy if exists chat_images_select on ideworks.chat_images;
create policy chat_images_select on ideworks.chat_images
  for select to ideworks_app
  using (ideworks.can_reach_conversation(conversation_id));

revoke all on table ideworks.chat_images
  from public, anon, authenticated, ideworks_app;
grant select on table ideworks.chat_images to ideworks_app;

-- =============================================================================
-- Registrar rascunho (depois dos bytes no balde)
-- =============================================================================

create or replace function ideworks.register_chat_image_draft(
  p_conversation_id uuid,
  p_file_name text,
  p_content_type text,
  p_byte_size integer,
  p_storage_path text
) returns uuid
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_id    uuid;
  v_name  text := btrim(coalesce(p_file_name, ''));
  v_path  text := btrim(coalesce(p_storage_path, ''));
  v_type  text := lower(btrim(coalesce(p_content_type, '')));
begin
  if not ideworks.can_reach_conversation(p_conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'O arquivo precisa de um nome.' using errcode = '22023';
  end if;
  if v_path = '' or v_path not like 'chat/%' then
    raise exception 'caminho de armazenamento invalido' using errcode = '22023';
  end if;
  if v_type not in ('image/png', 'image/jpeg') then
    raise exception 'Envie uma imagem PNG ou JPEG.' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size <= 0 then
    raise exception 'Arquivo vazio — zero byte e arquivo que nao subiu.'
      using errcode = '22023';
  end if;
  if p_byte_size > 5242880 then
    raise exception 'O arquivo passa de 5 MB. Para algo maior, ponha o link ao lado.'
      using errcode = '22023';
  end if;

  insert into ideworks.chat_images (
    conversation_id, message_id, uploaded_by,
    file_name, content_type, byte_size, storage_path
  ) values (
    p_conversation_id, null, v_actor,
    v_name, v_type, p_byte_size, v_path
  )
  returning id into v_id;

  return v_id;
end
$fn$;

comment on function ideworks.register_chat_image_draft(uuid, text, text, integer, text) is
  'Confirma rascunho depois dos bytes. Prazo de 24 h nasce no gatilho.';

-- =============================================================================
-- Envio: corpo vazio ok com imagem; liga rascunhos a mensagem
-- =============================================================================

drop function if exists ideworks.send_chat_message(uuid, text, text);

create or replace function ideworks.send_chat_message(
  p_conversation_id uuid,
  p_body text,
  p_client_key text,
  p_image_ids uuid[] default '{}'
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
  v_images  uuid[] := coalesce(p_image_ids, '{}'::uuid[]);
  v_existing ideworks.messages%rowtype;
  v_count   integer;
  v_row     ideworks.messages%rowtype;
  v_recipients uuid[];
  v_linked  integer;
  v_expected integer;
begin
  if v_key = '' or char_length(v_key) > 128 then
    raise exception 'chave de envio obrigatoria' using errcode = '22023';
  end if;
  if v_body = '' and cardinality(v_images) = 0 then
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

  -- Corpo so com imagens: grava as referencias no texto (nunca URL assinada).
  if v_body = '' and cardinality(v_images) > 0 then
    select string_agg(
             format('![Imagem anexada](attachment:%s)', x.id::text),
             E'\n\n'
             order by x.ord
           )
      into v_body
      from unnest(v_images) with ordinality as x(id, ord);
  end if;

  insert into ideworks.messages as msg (
    conversation_id, author_id, body, kind, client_key
  ) values (
    p_conversation_id, v_actor, v_body, 'person', v_key
  )
  returning msg.* into v_row;

  if cardinality(v_images) > 0 then
    v_expected := cardinality(v_images);
    update ideworks.chat_images ci
       set message_id = v_row.id
     where ci.id = any (v_images)
       and ci.conversation_id = p_conversation_id
       and ci.uploaded_by = v_actor
       and ci.message_id is null;
    get diagnostics v_linked = row_count;
    if v_linked <> v_expected then
      raise exception
        'uma ou mais imagens nao puderam ser ligadas a mensagem'
        using errcode = '22023';
    end if;
  end if;

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

comment on function ideworks.send_chat_message(uuid, text, text, uuid[]) is
  'Envia mensagem de pessoa. Corpo vazio so com p_image_ids. Liga rascunhos '
  'na mesma transacao. Reenvio pela chave nao duplica.';

-- =============================================================================
-- Imagens de uma mensagem (ator: alcance; coletor: sem filtro de janela)
-- =============================================================================

create or replace function ideworks.chat_images_of_message(p_message_id uuid)
  returns table (id uuid, storage_path text)
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_conv uuid;
begin
  select m.conversation_id into v_conv
    from ideworks.messages m
   where m.id = p_message_id;
  if not found then
    return;
  end if;
  if ideworks.acting_user_id() is not null then
    if not ideworks.can_reach_conversation(v_conv) then
      raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
    end if;
  else
    perform ideworks.assert_collector();
  end if;

  return query
    select i.id, i.storage_path
      from ideworks.chat_images i
     where i.message_id = p_message_id
     order by i.created_at, i.id;
end
$fn$;

comment on function ideworks.chat_images_of_message(uuid) is
  'Lista id e caminho das imagens de uma mensagem. Ator precisa alcancar; '
  'coletor usa na limpeza.';

create or replace function ideworks.finish_chat_image_row(
  p_id uuid,
  p_path text
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.acting_user_id();
  v_row   ideworks.chat_images%rowtype;
begin
  select * into v_row from ideworks.chat_images where id = p_id;
  if not found then
    return;
  end if;
  if v_row.storage_path is distinct from p_path then
    raise exception 'caminho nao confere' using errcode = '22023';
  end if;

  if v_actor is not null then
    if not ideworks.can_reach_conversation(v_row.conversation_id) then
      raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
    end if;
    -- Pessoa: so o autor da mensagem (ou do rascunho) remove na hora.
    if v_row.message_id is not null then
      if not exists (
        select 1 from ideworks.messages m
         where m.id = v_row.message_id and m.author_id = v_actor
      ) then
        raise exception 'so o autor apaga a imagem da mensagem'
          using errcode = '42501';
      end if;
    elsif v_row.uploaded_by <> v_actor then
      raise exception 'so quem enviou o rascunho pode remove-lo'
        using errcode = '42501';
    end if;
  else
    perform ideworks.assert_collector();
  end if;

  delete from ideworks.chat_images
   where id = p_id and storage_path = p_path;
end
$fn$;

comment on function ideworks.finish_chat_image_row(uuid, text) is
  'Apaga o registro da imagem depois dos bytes. Ator (autor) ou coletor.';

-- =============================================================================
-- Limpeza do coletor — rascunhos e mensagens vencidas
-- =============================================================================

create or replace function ideworks.expired_chat_draft_images()
  returns table (id uuid, storage_path text)
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  return query
    select i.id, i.storage_path
      from ideworks.chat_images i
     where i.message_id is null
       and i.expires_at <= now()
     order by i.expires_at, i.id
     limit 100;
end
$fn$;

create or replace function ideworks.finish_expired_chat_draft_image(
  p_id uuid,
  p_path text
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  delete from ideworks.chat_images
   where id = p_id
     and storage_path = p_path
     and message_id is null
     and expires_at <= now();
end
$fn$;

create or replace function ideworks.expired_chat_messages_for_purge(
  p_limit integer default 100
) returns table (message_id uuid)
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_limite integer := greatest(coalesce(p_limit, 100), 1);
begin
  perform ideworks.assert_collector();
  return query
    select m.id
      from ideworks.messages m
     where m.created_at < now() - ideworks.chat_retention()
     order by m.created_at asc, m.id asc
     limit v_limite;
end
$fn$;

create or replace function ideworks.finish_expired_chat_message(p_message_id uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_n integer;
begin
  perform ideworks.assert_collector();
  -- So apaga se nao restar imagem (bytes+registro ja tratados pelo Worker).
  if exists (
    select 1 from ideworks.chat_images i where i.message_id = p_message_id
  ) then
    return false;
  end if;

  delete from ideworks.messages m
   where m.id = p_message_id
     and m.created_at < now() - ideworks.chat_retention();
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$fn$;

-- A limpeza em lote pura da F20.2 passa a so remover mensagens SEM imagem.
-- Mensagens com imagem ficam para o Worker (bytes → registro → mensagem).
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
       and not exists (
         select 1 from ideworks.chat_images i where i.message_id = m.id
       )
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
  'Apaga mensagens vencidas SEM imagem restante. Com imagem, o Worker remove '
  'bytes e registro antes (F20.7).';

-- =============================================================================
-- Permissoes
-- =============================================================================

revoke all on function ideworks.register_chat_image_draft(uuid, text, text, integer, text)
  from public, anon, authenticated;
revoke all on function ideworks.send_chat_message(uuid, text, text, uuid[])
  from public, anon, authenticated;
revoke all on function ideworks.chat_images_of_message(uuid)
  from public, anon, authenticated;
revoke all on function ideworks.finish_chat_image_row(uuid, text)
  from public, anon, authenticated;
revoke all on function ideworks.expired_chat_draft_images()
  from public, anon, authenticated;
revoke all on function ideworks.finish_expired_chat_draft_image(uuid, text)
  from public, anon, authenticated;
revoke all on function ideworks.expired_chat_messages_for_purge(integer)
  from public, anon, authenticated;
revoke all on function ideworks.finish_expired_chat_message(uuid)
  from public, anon, authenticated;
revoke all on function ideworks.purge_expired_chat_messages(integer)
  from public, anon, authenticated;

grant execute on function ideworks.register_chat_image_draft(uuid, text, text, integer, text)
  to ideworks_app;
grant execute on function ideworks.send_chat_message(uuid, text, text, uuid[])
  to ideworks_app;
grant execute on function ideworks.chat_images_of_message(uuid)
  to ideworks_app;
grant execute on function ideworks.finish_chat_image_row(uuid, text)
  to ideworks_app;
grant execute on function ideworks.expired_chat_draft_images()
  to ideworks_app;
grant execute on function ideworks.finish_expired_chat_draft_image(uuid, text)
  to ideworks_app;
grant execute on function ideworks.expired_chat_messages_for_purge(integer)
  to ideworks_app;
grant execute on function ideworks.finish_expired_chat_message(uuid)
  to ideworks_app;
grant execute on function ideworks.purge_expired_chat_messages(integer)
  to ideworks_app;

commit;
