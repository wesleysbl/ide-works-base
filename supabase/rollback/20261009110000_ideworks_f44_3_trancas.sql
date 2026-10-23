-- =============================================================================
-- ROLLBACK — F44.3  As trancas que só o banco fecha
-- =============================================================================
-- Devolve os cinco objetos exatamente como estavam antes (o retrato de
-- `supabase/schema-esperado.json` de 09/10):
--   · `add_conversation_member` — forma da F20.2 (administrador volta a poder
--     se pôr em qualquer grupo);
--   · `invitations_insert` (F17.36c) e `invitations_update` (F17.34b) — o papel
--     do convite volta a não ser conferido pela política;
--   · `meta_collection_runs` — `select` na tabela inteira de novo para
--     `ideworks_app`, e `recent_collection_runs` sai;
--   · `send_chat_message` e `chat_images_of_message` — forma da F20.7.
--
-- ⚠️ REVERTA A PUBLICAÇÃO DO WORKER ANTES. O Worker desta etapa lê o livro da
-- coleta por `recent_collection_runs`; sem a função, `GET /meta/health` falha
-- e o alarme da /meta mostra "Não foi possível conferir a coleta agora".
--
-- ⚠️ E ele REABRE as cinco portas. Na versão velha o que as segura é só o
-- Worker: `POST /admin/invitations` recusa super admin a quem não é o topo,
-- `deleteChatMessageWithImages` confere o autor, o chat não oferece "entrar"
-- em grupo alheio e `GET /meta/health` volta a mandar `first_error` a quem tem
-- a área. O rascunho vencido volta a se ligar. Rode junto com o código velho.
--
-- OS CORPOS VOLTAM SEM COMENTÁRIO DENTRO, como o retrato de produção os guarda
-- (as F20 entraram assim). Por isso a linha "Corpo so com imagens…" da F20.7
-- não está aqui: com ela, `conferir-schema` acusaria diferença sem haver uma.
--
-- Depois: node scripts/conferir-schema.mjs (o retrato de 09/10 volta a bater).
-- =============================================================================

begin;
set local lock_timeout = '5s';

-- --- 5. imagens da mensagem: forma da F20.7 ------------------------------------
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

-- --- 4. envio: forma da F20.7 ---------------------------------------------------
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

-- --- 3. livro da coleta: a tabela inteira de novo -------------------------------
drop function if exists ideworks.recent_collection_runs(integer);

-- As colunas concedidas uma a uma saem antes; o `grant` da tabela volta a valer
-- para todas, como desde a F8.
revoke select (
  id, started_at, finished_at, outcome, window_from, window_to,
  assets_total, assets_ok, assets_failed, rows_written
) on table ideworks.meta_collection_runs from ideworks_app;
grant select on table ideworks.meta_collection_runs to ideworks_app;

-- --- 2. convite: as expressões da F17.36c e da F17.34b ---------------------------
drop policy if exists invitations_update on ideworks.invitations;
create policy invitations_update on ideworks.invitations for update
  using (
    ideworks.is_preauth()
    or (ideworks.acting_is_superadmin()
        and ideworks.can_see_invitation(email, created_by, categories)))
  with check (ideworks.acting_is_superadmin() or ideworks.is_preauth());

drop policy if exists invitations_insert on ideworks.invitations;
create policy invitations_insert on ideworks.invitations for insert with check (
  ideworks.acting_is_superadmin()
  and ideworks.can_grant_categories(categories)
);

-- --- 1. membro do chat: forma da F20.2 -------------------------------------------
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

commit;
