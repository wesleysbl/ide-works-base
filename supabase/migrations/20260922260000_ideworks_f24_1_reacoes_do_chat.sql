-- =============================================================================
-- IDE WORKS — F24.1  O banco sabe o que é uma reação
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   Dá para reagir a uma mensagem do chat com um dos seis emojis, uma reação
--   por pessoa por mensagem, e só quem alcança a conversa enxerga.
--
-- AS VERDADES DESTA ETAPA
--   1. Seis emojis fixos, num tipo enumerado: o banco recusa sozinho qualquer
--      outro valor — a tela não é a guardiã da lista.
--   2. Uma reação por pessoa por mensagem: unique (message_id, actor_id).
--      Tocar outro emoji troca; tocar o mesmo remove.
--   3. Escrita só por função de domínio. ideworks_app só lê (e só dentro da
--      janela de chat_retention()).
--   4. Reação cai junto com a mensagem e com a conversa (cascade), e some da
--      leitura quando a mensagem vence — sem a API saber disso.
--   5. Não se reage a lápide nem a linha de sistema.
--   6. Alternar devolve o estado final e os destinatários na mesma transação —
--      a central ao vivo usa isso na Fase 2.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--   Não cria API, Worker, evento ao vivo nem tela. Não toca no sino, na lista
--   lateral de conversas nem em `conversations.updated_at`. Não toca em
--   `public` nem em `auth`.
-- =============================================================================

begin;
set local lock_timeout = '15s';

-- --- tipos -------------------------------------------------------------------
do $$ begin
  create type ideworks.chat_reaction_emoji as enum
    ('👍', '❤️', '😂', '😮', '😢', '🙏');
exception when duplicate_object then null; end $$;

comment on type ideworks.chat_reaction_emoji is
  'Os seis emojis de reação do chat. Lista fechada: o banco recusa o resto.';

-- =============================================================================
-- Tabela de reações
-- =============================================================================

create table ideworks.chat_reactions (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null
    references ideworks.conversations (id) on delete cascade,
  message_id       uuid not null
    references ideworks.messages (id) on delete cascade,
  actor_id         uuid not null
    references ideworks.profiles (id) on delete cascade,
  emoji            ideworks.chat_reaction_emoji not null,
  reacted_at       timestamptz not null default now(),

  unique (message_id, actor_id)
);

comment on table ideworks.chat_reactions is
  'Reação de uma pessoa a uma mensagem do chat. Uma por pessoa por mensagem. '
  'Escrita só por toggle_chat_reaction(); leitura filtrada por chat_retention().';
comment on column ideworks.chat_reactions.conversation_id is
  'Repetido da mensagem de propósito: a RLS pergunta o alcance sem join.';
comment on column ideworks.chat_reactions.emoji is
  'Um dos seis do tipo chat_reaction_emoji. Trocar sobrescreve esta coluna.';

-- Leitura 1: as reações de um lote de mensagens (o histórico que acabou de abrir).
create index chat_reactions_message_idx
  on ideworks.chat_reactions (message_id);

-- Leitura 2: o que mudou desde um instante numa conversa (reposição offline).
create index chat_reactions_conversation_changed_idx
  on ideworks.chat_reactions (conversation_id, reacted_at desc);

create index chat_reactions_actor_idx
  on ideworks.chat_reactions (actor_id);

-- =============================================================================
-- RLS — só SELECT; escrita é domínio. Alcance da conversa na própria política.
-- =============================================================================

alter table ideworks.chat_reactions enable row level security;

drop policy if exists chat_reactions_select on ideworks.chat_reactions;
create policy chat_reactions_select on ideworks.chat_reactions
  for select to ideworks_app
  using (ideworks.can_reach_conversation(conversation_id));

revoke all on table ideworks.chat_reactions
  from public, anon, authenticated, ideworks_app;
grant select on table ideworks.chat_reactions to ideworks_app;

-- =============================================================================
-- Função de domínio: alternar a reação
-- =============================================================================

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
    -- Mesmo emoji de novo: remove.
    delete from ideworks.chat_reactions r where r.id = v_existing.id;
    v_removed := true;
    v_row := v_existing;
  elsif found then
    -- Outro emoji: troca, sem criar uma segunda linha.
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

comment on function ideworks.toggle_chat_reaction(uuid, ideworks.chat_reaction_emoji) is
  'Alterna a reação do ator numa mensagem: grava, troca ou apaga. Recusa sem '
  'alcance (42501), em lápide, em linha de sistema e fora da janela (23514). '
  'Devolve o estado final e os destinatários na mesma transação.';

-- =============================================================================
-- Leituras (sempre filtradas por chat_retention)
-- =============================================================================

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

comment on function ideworks.list_chat_reactions(uuid, uuid[]) is
  'Reações de um lote de mensagens de uma conversa. Só dentro da janela de '
  'chat_retention(). Ator precisa alcançar a conversa.';

create or replace function ideworks.list_chat_reaction_changes(
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

comment on function ideworks.list_chat_reaction_changes(uuid, timestamptz) is
  'Reações criadas ou trocadas desde um instante numa conversa, para repor o '
  'que a tela perdeu offline. Remoção apaga a linha e não aparece aqui — o '
  'evento ao vivo cobre isso (F24.2).';

-- =============================================================================
-- Permissões
-- =============================================================================

revoke all on function ideworks.toggle_chat_reaction(uuid, ideworks.chat_reaction_emoji)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.list_chat_reactions(uuid, uuid[])
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.list_chat_reaction_changes(uuid, timestamptz)
  from public, anon, authenticated, ideworks_app;

grant execute on function ideworks.toggle_chat_reaction(uuid, ideworks.chat_reaction_emoji)
  to ideworks_app;
grant execute on function ideworks.list_chat_reactions(uuid, uuid[]) to ideworks_app;
grant execute on function ideworks.list_chat_reaction_changes(uuid, timestamptz)
  to ideworks_app;

commit;
