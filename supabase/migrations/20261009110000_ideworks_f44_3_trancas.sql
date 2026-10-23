-- =============================================================================
-- IDE WORKS — F44.3  As trancas que só o banco fecha
-- =============================================================================
-- POR QUE
--   A revisão de segurança de 08/10 (`docs/REVISOES/2026-10-08-conferencia-mcp/
--   README.md`, "Banco — segurança" e rodada 3) achou cinco portas que o banco
--   deixava abertas: quatro eram fechadas só pelo Worker (ou pela tela não
--   oferecer o botão) e uma — o rascunho de imagem vencido — por ninguém.
--   Defesa em profundidade é isto: uma rota mal escrita, um POST montado à mão
--   ou uma consulta nova sob `ideworks_app` não podem ser o que separa uma
--   pessoa de um dado que não é dela. Neste sistema quem julga é o banco.
--
-- O QUE MUDA (cinco itens; o resto de cada objeto fica letra por letra)
--   1. `add_conversation_member` — quem administra continua gerenciando
--      qualquer grupo (`chat_actor_manages` NÃO muda: renomear, remover, passar
--      posse e pôr OUTRAS pessoas seguem como hoje), mas ninguém SE PÕE numa
--      conversa de que não é membro. Pôr a si mesmo só vale para quem já está
--      lá — o dono é membro —, e aí não muda nada (`on conflict do nothing`).
--      Antes: administrador sabia o identificador de um grupo alheio, se
--      adicionava e passava a ler tudo.
--   2. `invitations_insert` — convite com papel `super_admin` só sai de quem é
--      o topo (`acting_is_super()`). `invitations_update` ganha a MESMA
--      condição no `with check`: sem ela, quem administra convidaria como
--      `funcionario` e trocaria o papel no passo seguinte — a porta de
--      contornar a primeira. O caminho de antes da sessão (`is_preauth`, que
--      conta tentativas e gasta o código) segue passando: ele não escolhe papel.
--      Nenhuma tela atualiza convite pela política (o cancelamento é
--      `revoke_invitation`, `security definer`), então nada some da tela.
--   3. `meta_collection_runs.first_error` — a primeira falha da coleta traz o
--      texto cru da Meta (conta, token, permissão) e só quem administra o vê.
--      ESCOLHA: a política é por LINHA e as linhas continuam de todos os
--      identificados — o alarme da coleta (`src/meta/AlarmeDaColeta.tsx`, em
--      /meta, para quem tem a área) e o relatório de marketing
--      (`src/integrations/marketing.ts`) leem a data e o desfecho da última
--      execução, e "qualquer pessoa pode ser a que percebe que o número parou"
--      (F8). Então a tranca é de COLUNA: `ideworks_app` perde `select` na
--      tabela e recebe `select` só nas colunas sem texto de erro. Quem precisa
--      do erro lê por `recent_collection_runs(limite)`, `security definer`, que
--      devolve `first_error` nulo para quem não administra. `runs_select` fica
--      como está.
--      ⚠️ COLUNA NOVA nesta tabela nasce INVISÍVEL para `ideworks_app` — o
--      `grant` abaixo lista as colunas uma a uma. Quem acrescentar uma, concede.
--   4. `send_chat_message` — só liga rascunho de imagem AINDA VÁLIDO
--      (`expires_at > now()`; o prazo de 24 h nasce no gatilho
--      `fix_chat_image_expiration`). Antes ligava rascunho vencido que a
--      limpeza ainda não tinha alcançado — e a limpeza podia apagar os bytes no
--      meio. Vencido recusa com frase própria: "anexe de novo".
--   5. `chat_images_of_message` — para pessoa, só o AUTOR da mensagem lista os
--      caminhos das imagens dela (o coletor segue sem filtro). É a mesma
--      conferência que `deleteChatMessageWithImages` (`src/server/
--      chat-imagens.ts`) já faz, agora também no banco: antes qualquer membro
--      que alcançasse a conversa recebia os caminhos — e, para mensagem fora
--      da janela de 30 dias, a conferência do Worker nem via a mensagem.
--
-- O QUE NÃO MUDA
--   `chat_actor_manages`, `runs_select`, as demais funções do chat e do
--   convite. Cota de rascunhos de imagem e de anexos temporários por pessoa
--   NÃO entra aqui (decisão de 09/10: risco baixo, o cron limpa).
--
-- PAR COM O WORKER
--   `GET /meta/health` passa a ler por `recent_collection_runs(20)` (mesmo
--   commit). Aplique a migration e publique o Worker juntos: entre um e outro,
--   o Worker antigo pede `first_error` à tabela (sem permissão) ou o novo pede
--   uma função que não existe — nos dois casos o alarme da /meta mostra "Não
--   foi possível conferir a coleta agora", com "Tentar de novo". Nada mais
--   lê `first_error` pela tabela.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s.
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261009110000_ideworks_f44_3_trancas.sql`
-- (reverta a publicação do Worker ANTES — ver o aviso lá).
-- =============================================================================

begin;
set local lock_timeout = '5s';

-- =============================================================================
-- 1. Ninguém se põe sozinho numa conversa alheia
-- =============================================================================
-- Parte da versão da F20.2 (`20260921220000_ideworks_f20_2_mensagens.sql`); só
-- o bloco marcado "F44" é novo.

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
  -- F44: administrar o grupo nao e fazer parte dele. Quem administra poe
  -- OUTRAS pessoas (como sempre), mas nao a si mesmo numa conversa de que nao
  -- e membro — seria ler a conversa alheia inteira com um pedido. Quem ja e
  -- membro (o dono e membro) passa: o `on conflict` abaixo nao muda nada.
  if p_user_id = v_actor
     and not exists (
       select 1 from ideworks.conversation_members
        where conversation_id = p_conversation_id and user_id = v_actor
     ) then
    raise exception 'ninguem se adiciona a uma conversa de que nao e membro'
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
  'Adiciona membro ativo a grupo. Em grupo novo membro gera linha "joined". '
  'Dono ou administrador poe outras pessoas; ninguem se poe numa conversa de '
  'que nao e membro (F44).';

-- =============================================================================
-- 2. Super admin só nasce do topo — pelo convite e pela troca do convite
-- =============================================================================
-- TROCADAS, e não somadas: políticas permissivas se somam com OU, e uma nova ao
-- lado da velha não apertaria nada (a armadilha da F17.32b, F17.34 e F17.36c).
-- O resto de cada expressão é o da F17.36c (insert) e da F17.34b (update).

drop policy if exists invitations_insert on ideworks.invitations;
create policy invitations_insert on ideworks.invitations for insert with check (
  ideworks.acting_is_superadmin()
  and ideworks.can_grant_categories(categories)
  -- F44: `set_user_role` e o Worker já exigem o topo para criar super admin;
  -- sem isto, o convite era o caminho de contornar os dois.
  and (role <> 'super_admin'::ideworks.papel or ideworks.acting_is_super())
);

drop policy if exists invitations_update on ideworks.invitations;
create policy invitations_update on ideworks.invitations for update
  using (
    ideworks.is_preauth()
    or (ideworks.acting_is_superadmin()
        and ideworks.can_see_invitation(email, created_by, categories)))
  with check (
    (ideworks.acting_is_superadmin() or ideworks.is_preauth())
    -- F44: a mesma regra do insert, para "convidar como funcionário e trocar o
    -- papel depois" não ser a porta dos fundos.
    and (role <> 'super_admin'::ideworks.papel
         or ideworks.acting_is_super()
         or ideworks.is_preauth()));

-- =============================================================================
-- 3. O erro cru da coleta só para quem administra
-- =============================================================================

-- As linhas continuam de todos os identificados (`runs_select`, F8); a coluna
-- do erro sai do alcance do papel da aplicação.
revoke select on table ideworks.meta_collection_runs from ideworks_app;
grant select (
  id, started_at, finished_at, outcome, window_from, window_to,
  assets_total, assets_ok, assets_failed, rows_written
) on table ideworks.meta_collection_runs to ideworks_app;

create or replace function ideworks.recent_collection_runs(p_limit integer default 20)
  returns table (
    id            uuid,
    started_at    timestamptz,
    finished_at   timestamptz,
    outcome       ideworks.collection_outcome,
    window_from   date,
    window_to     date,
    assets_total  integer,
    assets_ok     integer,
    assets_failed integer,
    rows_written  integer,
    first_error   text
  )
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- Mesmo recorte de `runs_select` (pessoa identificada), mais o da coluna:
  -- `first_error` so para quem administra. Teto de 100 linhas.
  select r.id, r.started_at, r.finished_at, r.outcome, r.window_from, r.window_to,
         r.assets_total, r.assets_ok, r.assets_failed, r.rows_written,
         case when ideworks.acting_is_superadmin() then r.first_error end
    from ideworks.meta_collection_runs r
   where ideworks.acting_user_id() is not null
   order by r.started_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
$fn$;

comment on function ideworks.recent_collection_runs(integer) is
  'Livro de execucoes da coleta, mais recentes primeiro (teto 100), para quem '
  'esta identificado. `first_error` (texto cru da Meta) so para quem administra '
  '— F44. O papel da aplicacao nao le essa coluna pela tabela.';

revoke all on function ideworks.recent_collection_runs(integer)
  from public, anon, authenticated;
grant execute on function ideworks.recent_collection_runs(integer) to ideworks_app;

-- =============================================================================
-- 4. Rascunho de imagem vencido não se liga a mensagem
-- =============================================================================
-- Parte da versão da F20.7 (`20260921240000_ideworks_f20_7_imagens_do_chat.sql`);
-- muda só o bloco das imagens, marcado "F44".

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
    -- F44: so rascunho AINDA VALIDO. O prazo nasce no gatilho e nao se renova;
    -- vencido e o que a limpeza vai apagar, talvez no meio deste envio.
    update ideworks.chat_images ci
       set message_id = v_row.id
     where ci.id = any (v_images)
       and ci.conversation_id = p_conversation_id
       and ci.uploaded_by = v_actor
       and ci.message_id is null
       and ci.expires_at > now();
    get diagnostics v_linked = row_count;
    if v_linked <> v_expected then
      if exists (
        select 1 from ideworks.chat_images ci
         where ci.id = any (v_images)
           and ci.uploaded_by = v_actor
           and ci.message_id is null
           and ci.expires_at <= now()
      ) then
        raise exception 'a imagem anexada venceu; anexe de novo'
          using errcode = '22023';
      end if;
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
  'ainda validos na mesma transacao (vencido recusa — F44). Reenvio pela chave '
  'nao duplica.';

-- =============================================================================
-- 5. Os caminhos das imagens de uma mensagem são do autor dela
-- =============================================================================
-- Parte da versão da F20.7; só o bloco marcado "F44" é novo.

create or replace function ideworks.chat_images_of_message(p_message_id uuid)
  returns table (id uuid, storage_path text)
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_conv   uuid;
  v_author uuid;
begin
  select m.conversation_id, m.author_id into v_conv, v_author
    from ideworks.messages m
   where m.id = p_message_id;
  if not found then
    return;
  end if;
  if ideworks.acting_user_id() is not null then
    if not ideworks.can_reach_conversation(v_conv) then
      raise exception 'voce nao alcanca esta conversa' using errcode = '42501';
    end if;
    -- F44: a mesma conferencia de `deleteChatMessageWithImages`, agora antes de
    -- qualquer caminho sair daqui. Pessoa so lista para apagar a PROPRIA
    -- mensagem; quem le a conversa ve as imagens pela politica de chat_images.
    if v_author is distinct from ideworks.acting_user_id() then
      raise exception 'so o autor apaga a mensagem' using errcode = '42501';
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
  'Lista id e caminho das imagens de uma mensagem. Pessoa: so o autor, que '
  'alcanca a conversa (F44); coletor usa na limpeza.';

commit;
