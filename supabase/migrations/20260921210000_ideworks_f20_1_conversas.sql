-- =============================================================================
-- IDE WORKS — F20.1  O banco sabe o que e uma conversa
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   Existem conversas de tres tipos (geral, grupo, direta), com membros e donos,
--   e o banco recusa sozinho quem nao pertence.
--
-- AS TRES VERDADES DESTA ETAPA
--   1. Um Geral so, nascido aqui. Participacao e DERIVADA de perfil ativo —
--      nao se grava em membros (regra 1: uma verdade, um lugar).
--   2. Uma conversa direta por par de pessoas, sem ordem: A↔B e a mesma que B↔A.
--   3. Toda escrita passa por funcao de dominio. O papel da aplicacao le; nao
--      escreve direto em nenhuma das tres tabelas.
--
-- A PERGUNTA UNICA, COM MEMORIA POR COMANDO (licao F17.61)
--   `can_reach_conversation(id)` responde se o ator alcanca a conversa. Todas
--   as politicas chamam ELA, e ela calcula uma vez por conversa dentro do
--   comando — nao uma vez por linha de membro ou de marca de leitura.
--
-- O DIRETORIO DO CHAT E OUTRA FUNCAO (D24 / licao F17.53)
--   `chat_directory()` lista nome e identificador de TODA pessoa ativa, sem
--   recorte por empresa. `team_directory()` continua respeitando a empresa —
--   esta migration nao a toca.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria mensagem, imagem, mencao, API, Worker, Durable Object nem tela.
--   Nao cria a funcao que avanca a marca de leitura (F20.2). A tabela existe,
--   tem RLS, e o papel da aplicacao nao escreve nela. Nao grava linha de
--   sistema ("entrou"/"saiu") — isso tambem e F20.2. Nao toca em `public`
--   nem em `auth`. Nao expoe o chat a agentes.
-- =============================================================================

begin;
set local lock_timeout = '15s';

-- --- tipos -------------------------------------------------------------------
do $$ begin
  create type ideworks.conversation_kind as enum ('general', 'group', 'direct');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ideworks.conversation_member_role as enum ('owner', 'member');
exception when duplicate_object then null; end $$;

comment on type ideworks.conversation_kind is
  'Tipo da conversa do chat. Geral e unico; grupo e criado por qualquer um; '
  'direta e um par sem ordem.';
comment on type ideworks.conversation_member_role is
  'Papel do membro no grupo. Direta nao usa dono: os dois entram como membro.';

-- --- conversas ---------------------------------------------------------------
create table ideworks.conversations (
  id             uuid primary key default gen_random_uuid(),
  kind           ideworks.conversation_kind not null,
  name           text,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid references ideworks.profiles (id) on delete set null,
  updated_at     timestamptz not null default now(),
  -- Par canonicamente ordenado (a < b). So preenchido quando kind = direct.
  direct_user_a  uuid references ideworks.profiles (id) on delete cascade,
  direct_user_b  uuid references ideworks.profiles (id) on delete cascade,

  constraint conversations_name_for_kind check (
    (kind = 'general' and name is not null and btrim(name) <> '')
    or (kind = 'group' and name is not null and btrim(name) <> '')
    or (kind = 'direct' and name is null)
  ),
  constraint conversations_direct_pair check (
    (kind = 'direct'
      and direct_user_a is not null
      and direct_user_b is not null
      and direct_user_a < direct_user_b)
    or (kind <> 'direct'
      and direct_user_a is null
      and direct_user_b is null)
  )
);

comment on table ideworks.conversations is
  'Conversa do chat da equipe. Tres tipos: geral (um so), grupo e direta. '
  'Escrita so por funcao de dominio — o papel da aplicacao so le.';
comment on column ideworks.conversations.kind is
  'general | group | direct. O Geral nasce na migration e nao se cria de novo.';
comment on column ideworks.conversations.archived_at is
  'Preenchido quando um grupo fica sem membros. O Geral nunca arquiva.';
comment on column ideworks.conversations.direct_user_a is
  'Menor uuid do par da conversa direta. Com direct_user_b forma a chave unica.';

-- Exatamente um Geral. A constante true vira chave unica no indice parcial.
create unique index conversations_one_general_uidx
  on ideworks.conversations ((true))
  where kind = 'general';

-- Uma direta por par, sem ordem (o par ja nasce ordenado).
create unique index conversations_direct_pair_uidx
  on ideworks.conversations (direct_user_a, direct_user_b)
  where kind = 'direct';

create index conversations_kind_idx
  on ideworks.conversations (kind)
  where archived_at is null;

-- --- membros -----------------------------------------------------------------
create table ideworks.conversation_members (
  conversation_id uuid not null
    references ideworks.conversations (id) on delete cascade,
  user_id         uuid not null
    references ideworks.profiles (id) on delete cascade,
  role            ideworks.conversation_member_role not null
    default 'member',
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

comment on table ideworks.conversation_members is
  'Membros de grupo e de direta. O Geral NAO grava membros: quem tem perfil '
  'ativo alcanca por derivacao.';
comment on column ideworks.conversation_members.role is
  'owner ou member. So grupo usa dono; direta entra os dois como member.';
comment on column ideworks.conversation_members.joined_at is
  'Desempate da posse: o membro mais antigo recebe o cargo quando o ultimo '
  'dono sai.';

create index conversation_members_user_idx
  on ideworks.conversation_members (user_id);

create index conversation_members_owners_idx
  on ideworks.conversation_members (conversation_id, joined_at)
  where role = 'owner';

-- --- marca de leitura --------------------------------------------------------
-- A funcao que avanca a marca e F20.2. Aqui a tabela existe, tem RLS, e o
-- papel da aplicacao nao escreve nela.
create table ideworks.conversation_read_marks (
  conversation_id uuid not null
    references ideworks.conversations (id) on delete cascade,
  user_id         uuid not null
    references ideworks.profiles (id) on delete cascade,
  last_read_at    timestamptz not null default '-infinity'::timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

comment on table ideworks.conversation_read_marks is
  'Ate onde cada pessoa leu em cada conversa. Escrita so por funcao (F20.2); '
  'nesta etapa o papel da aplicacao so le a propria marca.';
comment on column ideworks.conversation_read_marks.last_read_at is
  'Cursor de leitura. Comeca em -infinity: tudo que existir ainda e nao lido.';

create index conversation_read_marks_user_idx
  on ideworks.conversation_read_marks (user_id);

-- --- o Geral nasce aqui ------------------------------------------------------
insert into ideworks.conversations (kind, name)
values ('general', 'Geral');

-- =============================================================================
-- ALCANCE: a pergunta unica, com memoria por comando (molde F17.61)
-- =============================================================================

create or replace function ideworks.can_reach_conversation_uncached(p_conversation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
  select exists (
    select 1
      from ideworks.conversations c
      join ideworks.profiles me
        on me.id = ideworks.acting_user_id()
       and me.is_active
     where c.id = p_conversation_id
       and (
            -- Geral: todo perfil ativo. Participacao derivada, nao gravada.
            c.kind = 'general'
            -- Grupo e direta: so membro.
            or exists (
                 select 1
                   from ideworks.conversation_members m
                  where m.conversation_id = c.id
                    and m.user_id = me.id
               )
           )
  )
$fn$;

comment on function ideworks.can_reach_conversation_uncached(uuid) is
  'A regra de alcance do chat, calculada do zero. Geral = perfil ativo; grupo '
  'e direta = ser membro. Existe separada para a memoria por comando de '
  '`can_reach_conversation` — licao F17.61.';

create or replace function ideworks.can_reach_conversation(p_conversation_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
declare
  marca    text;
  chave    text;
  lido     text;
  resposta boolean;
begin
  -- A marca do comando e de quem pergunta. Muda o comando, morre a memoria.
  marca := pg_catalog.statement_timestamp()::text
        || coalesce(pg_catalog.current_setting('app.user_id', true), '')
        || coalesce(pg_catalog.current_setting('app.is_superadmin', true), '')
        || coalesce(pg_catalog.current_setting('app.is_super', true), '');

  chave := 'ideworks_chat.k' || pg_catalog.md5(coalesce(p_conversation_id::text, ''));

  lido := pg_catalog.current_setting(chave, true);
  if lido = marca || 't' then return true;  end if;
  if lido = marca || 'f' then return false; end if;

  resposta := ideworks.can_reach_conversation_uncached(p_conversation_id);

  if resposta is not null then
    perform pg_catalog.set_config(
      chave, marca || (case when resposta then 't' else 'f' end), true);
  end if;
  return resposta;
end
$fn$;

comment on function ideworks.can_reach_conversation(uuid) is
  'Quem alcanca uma conversa do chat. A regra e `can_reach_conversation_uncached`; '
  'esta so evita perguntar duas vezes pela mesma conversa dentro do mesmo '
  'comando. Memoria por COMANDO com marca de ator — molde F17.61.';

-- =============================================================================
-- RLS — na mesma migration, em todas. So SELECT; escrita e por funcao.
-- =============================================================================

alter table ideworks.conversations enable row level security;
alter table ideworks.conversation_members enable row level security;
alter table ideworks.conversation_read_marks enable row level security;

drop policy if exists conversations_select on ideworks.conversations;
create policy conversations_select on ideworks.conversations
  for select to ideworks_app
  using (ideworks.can_reach_conversation(id));

drop policy if exists conversation_members_select on ideworks.conversation_members;
create policy conversation_members_select on ideworks.conversation_members
  for select to ideworks_app
  using (ideworks.can_reach_conversation(conversation_id));

drop policy if exists conversation_read_marks_select on ideworks.conversation_read_marks;
create policy conversation_read_marks_select on ideworks.conversation_read_marks
  for select to ideworks_app
  using (
    user_id = ideworks.acting_user_id()
    and ideworks.can_reach_conversation(conversation_id)
  );

-- Default privileges da F0.2b daria ALL. Aqui so leitura: escrita e dominio.
revoke all on table ideworks.conversations from public, anon, authenticated, ideworks_app;
revoke all on table ideworks.conversation_members from public, anon, authenticated, ideworks_app;
revoke all on table ideworks.conversation_read_marks from public, anon, authenticated, ideworks_app;
grant select on table ideworks.conversations to ideworks_app;
grant select on table ideworks.conversation_members to ideworks_app;
grant select on table ideworks.conversation_read_marks to ideworks_app;

-- =============================================================================
-- Auxiliares internos das funcoes de dominio
-- =============================================================================

create or replace function ideworks.chat_require_actor()
  returns uuid
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_id uuid := ideworks.acting_user_id();
begin
  if v_id is null then
    raise exception 'e preciso estar identificado para usar o chat'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from ideworks.profiles p where p.id = v_id and p.is_active
  ) then
    raise exception 'conta desativada nao usa o chat'
      using errcode = '42501';
  end if;
  return v_id;
end
$fn$;

comment on function ideworks.chat_require_actor() is
  'Guarda interna: devolve o ator ativo ou recusa. Nao e API do Worker.';

create or replace function ideworks.chat_person_is_active(p_user_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  select exists (
    select 1 from ideworks.profiles p
     where p.id = p_user_id and p.is_active
  )
$fn$;

create or replace function ideworks.chat_actor_manages(p_conversation_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- Dono do grupo OU administrador (acting_is_superadmin — o mesmo conceito
  -- de quem administra o sistema). Nao inventa papel novo.
  select ideworks.acting_is_superadmin()
      or exists (
           select 1
             from ideworks.conversation_members m
            where m.conversation_id = p_conversation_id
              and m.user_id = ideworks.acting_user_id()
              and m.role = 'owner'
         )
$fn$;

create or replace function ideworks.chat_archive_if_empty(p_conversation_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_kind ideworks.conversation_kind;
begin
  select kind into v_kind from ideworks.conversations where id = p_conversation_id;
  if not found then return; end if;
  if v_kind = 'general' then
    raise exception 'o Geral nao se arquiva' using errcode = '22023';
  end if;
  if not exists (
    select 1 from ideworks.conversation_members where conversation_id = p_conversation_id
  ) then
    update ideworks.conversations
       set archived_at = coalesce(archived_at, now()),
           updated_at  = now()
     where id = p_conversation_id;
  end if;
end
$fn$;

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

  -- Ainda sobra dono: nada a fazer.
  if v_owners > 0 then return; end if;

  -- Ultimo dono saindo: passa ao membro mais antigo que fica.
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

-- =============================================================================
-- Funcoes de dominio
-- =============================================================================

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

comment on function ideworks.create_group_conversation(text, uuid[]) is
  'Cria um grupo. O criador vira dono. Nomes repetidos sao aceitos. So pessoa '
  'ativa entra na lista inicial.';

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

comment on function ideworks.rename_conversation(uuid, text) is
  'Renomeia um grupo. O Geral recusa. Direta nao tem nome.';

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

  -- Se estava arquivado e voltou gente, desarquiva.
  update ideworks.conversations
     set archived_at = null, updated_at = now()
   where id = p_conversation_id
     and archived_at is not null;
end
$fn$;

comment on function ideworks.add_conversation_member(uuid, uuid) is
  'Adiciona membro ativo a grupo (ou reabre direta). Dono ou administrador. '
  'Direta recusa terceira pessoa. Sem linha de sistema nesta etapa (F20.2).';

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

comment on function ideworks.remove_conversation_member(uuid, uuid) is
  'Remove membro. Ultimo dono removido passa a posse ao membro mais antigo. '
  'Grupo vazio arquiva.';

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

comment on function ideworks.leave_conversation(uuid) is
  'Sair do grupo ou da direta. O Geral recusa. Ultimo dono passa a posse; '
  'grupo vazio arquiva.';

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

comment on function ideworks.transfer_conversation_ownership(uuid, uuid) is
  'Passa a posse do grupo a outro membro. Dono ou administrador.';

create or replace function ideworks.open_direct_conversation(p_other_user_id uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.chat_require_actor();
  v_a     uuid;
  v_b     uuid;
  v_id    uuid;
begin
  if p_other_user_id is null or p_other_user_id = v_actor then
    raise exception 'conversa direta e com outra pessoa' using errcode = '22023';
  end if;
  if not ideworks.chat_person_is_active(p_other_user_id) then
    raise exception 'so pessoa ativa abre conversa direta' using errcode = '22023';
  end if;

  v_a := least(v_actor, p_other_user_id);
  v_b := greatest(v_actor, p_other_user_id);

  select c.id into v_id
    from ideworks.conversations c
   where c.kind = 'direct'
     and c.direct_user_a = v_a
     and c.direct_user_b = v_b;

  if v_id is null then
    insert into ideworks.conversations (kind, name, created_by, direct_user_a, direct_user_b)
    values ('direct', null, v_actor, v_a, v_b)
    returning id into v_id;
  end if;

  -- Garante os dois como membros (reabre quem tinha saido).
  insert into ideworks.conversation_members (conversation_id, user_id, role)
  values (v_id, v_a, 'member'), (v_id, v_b, 'member')
  on conflict do nothing;

  update ideworks.conversations
     set archived_at = null, updated_at = now()
   where id = v_id
     and archived_at is not null;

  return v_id;
end
$fn$;

comment on function ideworks.open_direct_conversation(uuid) is
  'Abre (ou devolve) a conversa direta unica entre o ator e a outra pessoa. '
  'Pedir de novo, em qualquer ordem do par, devolve o mesmo identificador.';

-- Diretorio do chat: TODA pessoa ativa, sem recorte por empresa (D24).
-- team_directory() continua intacta e respeitando empresa.
create or replace function ideworks.chat_directory()
  returns table (id uuid, name text)
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email)::text
    from ideworks.profiles p
   where ideworks.acting_user_id() is not null
     and exists (
       select 1 from ideworks.profiles me
        where me.id = ideworks.acting_user_id() and me.is_active
     )
     and p.is_active
   order by lower(coalesce(nullif(btrim(p.full_name), ''), p.email)), p.id
$fn$;

comment on function ideworks.chat_directory() is
  'Diretorio do chat: identificador e nome de toda pessoa ativa, SEM recorte '
  'por empresa (D24). Nao substitui team_directory(), que continua respeitando '
  'a empresa. Super admin com zero empresas aparece aqui como qualquer ativo.';

-- --- privilegios das funcoes -------------------------------------------------
revoke all on function ideworks.can_reach_conversation_uncached(uuid)
  from public, anon, authenticated;
revoke all on function ideworks.can_reach_conversation(uuid)
  from public, anon, authenticated;
revoke all on function ideworks.chat_require_actor()
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.chat_person_is_active(uuid)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.chat_actor_manages(uuid)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.chat_archive_if_empty(uuid)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.chat_pass_ownership_if_needed(uuid, uuid)
  from public, anon, authenticated, ideworks_app;

grant execute on function ideworks.can_reach_conversation_uncached(uuid) to ideworks_app;
grant execute on function ideworks.can_reach_conversation(uuid) to ideworks_app;

revoke all on function ideworks.create_group_conversation(text, uuid[])
  from public, anon, authenticated;
revoke all on function ideworks.rename_conversation(uuid, text)
  from public, anon, authenticated;
revoke all on function ideworks.add_conversation_member(uuid, uuid)
  from public, anon, authenticated;
revoke all on function ideworks.remove_conversation_member(uuid, uuid)
  from public, anon, authenticated;
revoke all on function ideworks.leave_conversation(uuid)
  from public, anon, authenticated;
revoke all on function ideworks.transfer_conversation_ownership(uuid, uuid)
  from public, anon, authenticated;
revoke all on function ideworks.open_direct_conversation(uuid)
  from public, anon, authenticated;
revoke all on function ideworks.chat_directory()
  from public, anon, authenticated;

grant execute on function ideworks.create_group_conversation(text, uuid[]) to ideworks_app;
grant execute on function ideworks.rename_conversation(uuid, text) to ideworks_app;
grant execute on function ideworks.add_conversation_member(uuid, uuid) to ideworks_app;
grant execute on function ideworks.remove_conversation_member(uuid, uuid) to ideworks_app;
grant execute on function ideworks.leave_conversation(uuid) to ideworks_app;
grant execute on function ideworks.transfer_conversation_ownership(uuid, uuid) to ideworks_app;
grant execute on function ideworks.open_direct_conversation(uuid) to ideworks_app;
grant execute on function ideworks.chat_directory() to ideworks_app;

commit;
