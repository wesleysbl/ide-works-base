-- =============================================================================
-- IDE WORKS — F20.2  A mensagem e gravada, lida e vence
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   Da para gravar, editar, apagar e ler mensagens pelo banco, e nada com mais
--   de 30 dias aparece em leitura nenhuma.
--
-- AS VERDADES DESTA ETAPA
--   1. O prazo mora em UM lugar: `chat_retention()`. Toda leitura filtra por
--      ele — o vencido some mesmo se a limpeza atrasar.
--   2. Escrita so por funcao de dominio. ideworks_app so le (e so dentro da
--      janela). Chave de envio (autor, chave) impede duplicata no reenvio.
--   3. Linha de sistema nasce so pelas funcoes de grupo (entrou/saiu/renomeou/
--      virou dono). Pessoa nunca grava tipo sistema. Autor da linha = quem
--      causou o fato.
--   4. Envio devolve destinatarios na mesma transacao (membros, ou ativos no
--      Geral), incluindo o autor — a central usa na F20.4.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria API, Worker, tela, imagem, mencao nem cron. A limpeza existe no
--   banco; liga-la ao cron e F20.3. Nao toca em `public` nem em `auth`.
--   Nao regrava o retrato do schema (desvio combinado com o dono).
-- =============================================================================

begin;
set local lock_timeout = '15s';

-- --- tipos -------------------------------------------------------------------
do $$ begin
  create type ideworks.message_kind as enum ('person', 'system');
exception when duplicate_object then null; end $$;

comment on type ideworks.message_kind is
  'Origem da mensagem. person = escrita por pessoa; system = fato de grupo '
  '(entrou/saiu/renomeou/virou dono), so por funcao.';

-- =============================================================================
-- JANELA DE 30 DIAS — um lugar so
-- =============================================================================

create or replace function ideworks.chat_retention()
  returns interval
  language sql
  immutable
  parallel safe
  set search_path = ideworks, pg_temp
as $fn$
  select interval '30 days'
$fn$;

comment on function ideworks.chat_retention() is
  'Prazo corrido de cada mensagem do chat. Toda leitura e a limpeza usam '
  'ESTA funcao — nao copie interval ''30 days'' em consulta.';

-- =============================================================================
-- Tabela de mensagens
-- =============================================================================

create table ideworks.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null
    references ideworks.conversations (id) on delete cascade,
  author_id        uuid not null
    references ideworks.profiles (id) on delete cascade,
  body             text not null default '',
  kind             ideworks.message_kind not null,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  -- Chave gerada pela tela. So mensagem de pessoa. Reenvio nao duplica.
  client_key       text,

  constraint messages_body_length check (char_length(body) <= 4000),
  constraint messages_person_needs_key check (
    (kind = 'person' and client_key is not null and btrim(client_key) <> '')
    or (kind = 'system' and client_key is null)
  ),
  constraint messages_system_not_edited check (
    kind = 'person' or (edited_at is null and deleted_at is null)
  ),
  constraint messages_tombstone_empty_body check (
    deleted_at is null or body = ''
  )
);

comment on table ideworks.messages is
  'Mensagem do chat. Escrita so por funcao. Leitura filtrada pela janela de '
  'chat_retention() — vencido some mesmo sem limpeza.';
comment on column ideworks.messages.kind is
  'person | system. send_chat_message so cria person; system so por funcao.';
comment on column ideworks.messages.client_key is
  'Chave de envio da tela. Unica por (autor, chave). System fica nula.';
comment on column ideworks.messages.deleted_at is
  'Lapide: preenchido ao apagar; corpo vira string vazia. Continua na janela.';

-- Reenvio: mesma chave do mesmo autor = mesma linha.
create unique index messages_author_client_key_uidx
  on ideworks.messages (author_id, client_key)
  where client_key is not null;

create index messages_conversation_created_idx
  on ideworks.messages (conversation_id, created_at desc, id desc);

create index messages_author_minute_idx
  on ideworks.messages (author_id, created_at desc)
  where kind = 'person';

create index messages_created_at_idx
  on ideworks.messages (created_at);

-- =============================================================================
-- RLS — so SELECT; escrita e dominio. Janela na propria politica.
-- =============================================================================

alter table ideworks.messages enable row level security;

drop policy if exists messages_select on ideworks.messages;
create policy messages_select on ideworks.messages
  for select to ideworks_app
  using (
    ideworks.can_reach_conversation(conversation_id)
    and created_at >= now() - ideworks.chat_retention()
  );

revoke all on table ideworks.messages from public, anon, authenticated, ideworks_app;
grant select on table ideworks.messages to ideworks_app;

-- =============================================================================
-- Auxiliares internos
-- =============================================================================

create or replace function ideworks.chat_recipient_ids(p_conversation_id uuid)
  returns uuid[]
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_kind ideworks.conversation_kind;
  v_ids  uuid[];
begin
  select kind into v_kind
    from ideworks.conversations
   where id = p_conversation_id;
  if not found then
    return '{}'::uuid[];
  end if;

  if v_kind = 'general' then
    select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
      into v_ids
      from ideworks.profiles p
     where p.is_active;
  else
    select coalesce(array_agg(m.user_id order by m.user_id), '{}'::uuid[])
      into v_ids
      from ideworks.conversation_members m
     where m.conversation_id = p_conversation_id;
  end if;

  return v_ids;
end
$fn$;

comment on function ideworks.chat_recipient_ids(uuid) is
  'Destinatarios de uma conversa: membros, ou todos os perfis ativos no Geral. '
  'Inclui quem enviou. Uso interno do envio (F20.4).';

create or replace function ideworks.chat_insert_system_message(
  p_conversation_id uuid,
  p_author_id uuid,
  p_body text
) returns uuid
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_id   uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_body = '' or char_length(v_body) > 4000 then
    raise exception 'linha de sistema invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from ideworks.conversations where id = p_conversation_id) then
    raise exception 'conversa nao encontrada' using errcode = '42501';
  end if;

  insert into ideworks.messages (
    conversation_id, author_id, body, kind, client_key
  ) values (
    p_conversation_id, p_author_id, v_body, 'system', null
  )
  returning id into v_id;

  update ideworks.conversations
     set updated_at = now()
   where id = p_conversation_id;

  return v_id;
end
$fn$;

comment on function ideworks.chat_insert_system_message(uuid, uuid, text) is
  'Grava linha de sistema. So chamada por funcoes de dominio — nao e API.';

-- =============================================================================
-- Funcoes de dominio: enviar, editar, apagar
-- =============================================================================

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

  -- Chave ANTES do teto: reenvio devolve a linha e nao conta de novo.
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

create or replace function ideworks.edit_chat_message(
  p_message_id uuid,
  p_body text
) returns ideworks.messages
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_body  text := btrim(coalesce(p_body, ''));
  v_row   ideworks.messages%rowtype;
begin
  if v_body = '' then
    raise exception 'mensagem vazia nao e enviada' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'mensagem passa do teto de 4000 caracteres'
      using errcode = '22023';
  end if;

  select * into v_row from ideworks.messages where id = p_message_id;
  if not found then
    raise exception 'mensagem nao encontrada' using errcode = '42501';
  end if;
  if not ideworks.can_reach_conversation(v_row.conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;
  if v_row.kind <> 'person' then
    raise exception 'linha de sistema nao se edita' using errcode = '22023';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'mensagem apagada nao se edita' using errcode = '22023';
  end if;
  if v_row.author_id <> v_actor then
    raise exception 'so o autor edita a mensagem' using errcode = '42501';
  end if;
  if v_row.created_at < now() - ideworks.chat_retention() then
    raise exception 'mensagem fora da janela de 30 dias' using errcode = '22023';
  end if;

  update ideworks.messages
     set body = v_body,
         edited_at = now()
   where id = p_message_id
  returning * into v_row;

  update ideworks.conversations
     set updated_at = now()
   where id = v_row.conversation_id;

  return v_row;
end
$fn$;

comment on function ideworks.edit_chat_message(uuid, text) is
  'Edita o corpo. So o autor, so mensagem de pessoa, dentro da janela.';

create or replace function ideworks.delete_chat_message(p_message_id uuid)
  returns ideworks.messages
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_row   ideworks.messages%rowtype;
begin
  select * into v_row from ideworks.messages where id = p_message_id;
  if not found then
    raise exception 'mensagem nao encontrada' using errcode = '42501';
  end if;
  if not ideworks.can_reach_conversation(v_row.conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;
  if v_row.kind <> 'person' then
    raise exception 'linha de sistema nao se apaga' using errcode = '22023';
  end if;
  if v_row.deleted_at is not null then
    return v_row;
  end if;
  if v_row.author_id <> v_actor then
    raise exception 'so o autor apaga a mensagem' using errcode = '42501';
  end if;
  if v_row.created_at < now() - ideworks.chat_retention() then
    raise exception 'mensagem fora da janela de 30 dias' using errcode = '22023';
  end if;

  update ideworks.messages
     set body = '',
         deleted_at = now()
   where id = p_message_id
  returning * into v_row;

  update ideworks.conversations
     set updated_at = now()
   where id = v_row.conversation_id;

  return v_row;
end
$fn$;

comment on function ideworks.delete_chat_message(uuid) is
  'Apaga virando lapide: corpo vazio, deleted_at preenchido. So o autor.';

-- =============================================================================
-- Leituras (sempre filtradas por chat_retention)
-- =============================================================================

create or replace function ideworks.list_chat_messages(
  p_conversation_id uuid,
  p_before_at timestamptz default null,
  p_before_id uuid default null
) returns setof ideworks.messages
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
begin
  if not ideworks.can_reach_conversation(p_conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;

  return query
    select m.*
      from ideworks.messages m
     where m.conversation_id = p_conversation_id
       and m.created_at >= now() - ideworks.chat_retention()
       and (
            p_before_at is null
            or (m.created_at, m.id) < (p_before_at, p_before_id)
           )
     order by m.created_at desc, m.id desc
     limit 50;
end
$fn$;

comment on function ideworks.list_chat_messages(uuid, timestamptz, uuid) is
  'Historico paginado (50). Cursor (created_at, id) — o id desempata. '
  'So dentro da janela de chat_retention().';

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

comment on function ideworks.list_chat_message_changes(uuid, timestamptz) is
  'O que mudou desde um momento: novas, editadas e apagadas, dentro da janela.';

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

create or replace function ideworks.mark_conversation_read(
  p_conversation_id uuid,
  p_read_at timestamptz
) returns timestamptz
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_now   timestamptz := now();
  v_mark  timestamptz;
begin
  if p_read_at is null then
    raise exception 'momento de leitura obrigatorio' using errcode = '22023';
  end if;
  if not ideworks.can_reach_conversation(p_conversation_id) then
    raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
  end if;

  -- A marca so avanca. Nunca volta atras.
  insert into ideworks.conversation_read_marks (
    conversation_id, user_id, last_read_at, updated_at
  ) values (
    p_conversation_id, v_actor, least(p_read_at, v_now), v_now
  )
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(
          ideworks.conversation_read_marks.last_read_at,
          least(excluded.last_read_at, v_now)
        ),
        updated_at = v_now
  returning last_read_at into v_mark;

  return v_mark;
end
$fn$;

comment on function ideworks.mark_conversation_read(uuid, timestamptz) is
  'Avanca a marca de leitura ate o momento (nao volta atras).';

-- =============================================================================
-- Limpeza em lotes — so ator do servidor (molde assert_collector)
-- =============================================================================

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

-- =============================================================================
-- F20.1 passa a gravar linhas de sistema (create or replace)
-- =============================================================================

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
    perform ideworks.chat_insert_system_message(
      p_conversation_id, v_heir, 'became_owner');
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
    on conflict do nothing
    returning user_id into v_uid;
    if found then
      perform ideworks.chat_insert_system_message(v_id, v_uid, 'joined');
    end if;
  end loop;

  return v_id;
end
$fn$;

comment on function ideworks.create_group_conversation(text, uuid[]) is
  'Cria um grupo. O criador vira dono. Membros iniciais geram linha de sistema '
  '"joined". So pessoa ativa entra na lista inicial.';

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

  perform ideworks.chat_insert_system_message(
    p_conversation_id, v_actor, 'renamed');
end
$fn$;

comment on function ideworks.rename_conversation(uuid, text) is
  'Renomeia um grupo e grava linha de sistema. O Geral recusa.';

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
  v_inserted boolean := false;
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
  on conflict do nothing
  returning true into v_inserted;
  v_inserted := coalesce(v_inserted, false);

  update ideworks.conversations
     set archived_at = null, updated_at = now()
   where id = p_conversation_id
     and archived_at is not null;

  if v_inserted and v_kind = 'group' then
    perform ideworks.chat_insert_system_message(
      p_conversation_id, p_user_id, 'joined');
  end if;
end
$fn$;

comment on function ideworks.add_conversation_member(uuid, uuid) is
  'Adiciona membro ativo a grupo. Em grupo novo membro gera linha "joined".';

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
  v_was   boolean;
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

  select exists (
    select 1 from ideworks.conversation_members
     where conversation_id = p_conversation_id and user_id = p_user_id
  ) into v_was;

  perform ideworks.chat_pass_ownership_if_needed(p_conversation_id, p_user_id);

  delete from ideworks.conversation_members
   where conversation_id = p_conversation_id
     and user_id = p_user_id;

  if v_was and v_kind = 'group' then
    perform ideworks.chat_insert_system_message(
      p_conversation_id, p_user_id, 'left');
  end if;

  perform ideworks.chat_archive_if_empty(p_conversation_id);
end
$fn$;

comment on function ideworks.remove_conversation_member(uuid, uuid) is
  'Remove membro e grava linha "left". Ultimo dono passa a posse.';

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

  if v_kind = 'group' then
    perform ideworks.chat_insert_system_message(
      p_conversation_id, v_actor, 'left');
  end if;

  perform ideworks.chat_archive_if_empty(p_conversation_id);
end
$fn$;

comment on function ideworks.leave_conversation(uuid) is
  'Sair do grupo ou da direta. Em grupo grava linha "left".';

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

  perform ideworks.chat_insert_system_message(
    p_conversation_id, p_new_owner_id, 'became_owner');
end
$fn$;

comment on function ideworks.transfer_conversation_ownership(uuid, uuid) is
  'Passa a posse e grava linha "became_owner" com autor = novo dono.';

-- --- privilegios -------------------------------------------------------------
revoke all on function ideworks.chat_retention()
  from public, anon, authenticated;
revoke all on function ideworks.chat_recipient_ids(uuid)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.chat_insert_system_message(uuid, uuid, text)
  from public, anon, authenticated, ideworks_app;

revoke all on function ideworks.send_chat_message(uuid, text, text)
  from public, anon, authenticated;
revoke all on function ideworks.edit_chat_message(uuid, text)
  from public, anon, authenticated;
revoke all on function ideworks.delete_chat_message(uuid)
  from public, anon, authenticated;
revoke all on function ideworks.list_chat_messages(uuid, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function ideworks.list_chat_message_changes(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function ideworks.list_my_chat_conversations()
  from public, anon, authenticated;
revoke all on function ideworks.mark_conversation_read(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function ideworks.purge_expired_chat_messages(integer)
  from public, anon, authenticated;

grant execute on function ideworks.chat_retention() to ideworks_app;
-- F20.4: a central precisa da lista depois de editar/apagar/membros (envio já
-- devolve na mesma transação). Continua security definer; quem chama é o app.
grant execute on function ideworks.chat_recipient_ids(uuid) to ideworks_app;
grant execute on function ideworks.send_chat_message(uuid, text, text) to ideworks_app;
grant execute on function ideworks.edit_chat_message(uuid, text) to ideworks_app;
grant execute on function ideworks.delete_chat_message(uuid) to ideworks_app;
grant execute on function ideworks.list_chat_messages(uuid, timestamptz, uuid) to ideworks_app;
grant execute on function ideworks.list_chat_message_changes(uuid, timestamptz) to ideworks_app;
grant execute on function ideworks.list_my_chat_conversations() to ideworks_app;
grant execute on function ideworks.mark_conversation_read(uuid, timestamptz) to ideworks_app;
grant execute on function ideworks.purge_expired_chat_messages(integer) to ideworks_app;

commit;
