-- =============================================================================
-- IDE WORKS — F24.2  Lápide da reação e fim da corrida de duas abas
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   Remover uma reação deixa lápide em vez de apagar a linha, e duas abas da
--   mesma pessoa reagindo juntas não estouram mais `23505` — vence a última.
--
-- POR QUE
--   1. Quem ficava offline na hora de uma remoção voltava com reação fantasma:
--      `list_chat_reaction_changes` só via linha viva, e remover apagava a
--      linha. Agora a remoção carimba `removed_at` e volta na reposição.
--   2. Duas reações simultâneas da mesma pessoa caíam no unique com
--      "duplicate key", que não é frase de gente. A gravação passa a resolver
--      o conflito atualizando a linha.
--
-- AS VERDADES DESTA ETAPA
--   - Continua uma linha por (mensagem, pessoa) — o unique da F24.1 fica de pé.
--     "Uma reação viva por pessoa por mensagem" vira `removed_at is null`.
--   - `changed_at` é o relógio da reposição: muda em toda gravação (criar,
--     trocar, remover). `reacted_at` continua sendo quando a reação viva nasceu.
--   - `list_chat_reactions` só devolve reação viva.
--   - `list_chat_reaction_changes` devolve viva e removida, com a coluna
--     `removed`, para a tela consertar a bolha ao voltar de offline.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--   Não cria API, Worker, evento ao vivo nem tela. Não mexe em mensagens.
-- =============================================================================

begin;
set local lock_timeout = '15s';

-- --- lápide ------------------------------------------------------------------

alter table ideworks.chat_reactions
  add column if not exists removed_at timestamptz,
  add column if not exists changed_at timestamptz not null default now();

comment on column ideworks.chat_reactions.removed_at is
  'Lápide: quando a pessoa tirou a reação. Nulo = reação viva. A linha fica '
  'para a reposição offline saber que a reação sumiu.';
comment on column ideworks.chat_reactions.changed_at is
  'Relógio da reposição: muda a cada gravação (criar, trocar, remover).';

-- Linhas da F24.1 nasceram vivas; o relógio delas é o instante da reação.
-- Guarda deliberada: só toca reação VIVA. Sem isso, reaplicar esta migration
-- zeraria o relógio de toda reação trocada ou removida e a lápide sumiria da
-- reposição offline — exatamente o defeito que esta migration veio consertar.
update ideworks.chat_reactions
   set changed_at = reacted_at
 where removed_at is null
   and changed_at is distinct from reacted_at;

-- Leitura 2 (reposição offline) passa a andar pelo relógio novo.
drop index if exists ideworks.chat_reactions_conversation_changed_idx;
create index chat_reactions_conversation_changed_idx
  on ideworks.chat_reactions (conversation_id, changed_at desc);

-- Leitura 1 (rodapé da bolha) só olha reação viva.
drop index if exists ideworks.chat_reactions_message_idx;
create index chat_reactions_message_idx
  on ideworks.chat_reactions (message_id) where removed_at is null;

-- =============================================================================
-- Alternar a reação — agora com lápide e sem corrida
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

  if found and v_existing.removed_at is null and v_existing.emoji = p_emoji then
    -- Mesmo emoji de novo: vira lápide, a linha fica.
    update ideworks.chat_reactions as r
       set removed_at = now(),
           changed_at = now()
     where r.id = v_existing.id
    returning r.* into v_row;
    v_removed := true;
  else
    -- Criar, trocar ou ressuscitar. O `on conflict` é o que desfaz a corrida
    -- de duas abas: em vez de estourar 23505, a última gravação vence.
    insert into ideworks.chat_reactions as r (
      conversation_id, message_id, actor_id, emoji, reacted_at, removed_at, changed_at
    ) values (
      v_message.conversation_id, p_message_id, v_actor, p_emoji, now(), null, now()
    )
    on conflict (message_id, actor_id) do update
       set emoji = excluded.emoji,
           reacted_at = excluded.reacted_at,
           removed_at = null,
           changed_at = excluded.changed_at
    returning r.* into v_row;
  end if;

  v_recipients := ideworks.chat_recipient_ids(v_message.conversation_id);

  return query
    select v_message.id,
           v_message.conversation_id,
           v_actor,
           v_row.emoji,
           case when v_removed then v_row.removed_at else v_row.reacted_at end,
           v_removed,
           v_recipients;
end
$fn$;

comment on function ideworks.toggle_chat_reaction(uuid, ideworks.chat_reaction_emoji) is
  'Alterna a reação do ator numa mensagem: grava, troca ou carimba lápide. '
  'Recusa sem alcance (42501), em lápide de mensagem, em linha de sistema e '
  'fora da janela (23514). Duas abas simultâneas não estouram unique: vence a '
  'última. Devolve o estado final e os destinatários na mesma transação.';

-- =============================================================================
-- Leituras
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
       and r.removed_at is null
       and m.created_at >= now() - ideworks.chat_retention()
     order by r.reacted_at, r.id;
end
$fn$;

comment on function ideworks.list_chat_reactions(uuid, uuid[]) is
  'Reações VIVAS de um lote de mensagens de uma conversa. Só dentro da janela '
  'de chat_retention(). Ator precisa alcançar a conversa.';

-- A forma de retorno muda (ganha `removed`): precisa cair antes de nascer.
drop function if exists ideworks.list_chat_reaction_changes(uuid, timestamptz);

create function ideworks.list_chat_reaction_changes(
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

comment on function ideworks.list_chat_reaction_changes(uuid, timestamptz) is
  'Reações criadas, trocadas OU removidas desde um instante numa conversa, '
  'para repor o que a tela perdeu offline. Remoção vem com removed = true — é '
  'assim que a reação fantasma morre.';

-- =============================================================================
-- Permissões (a função recriada perde as concessões)
-- =============================================================================

revoke all on function ideworks.list_chat_reaction_changes(uuid, timestamptz)
  from public, anon, authenticated, ideworks_app;
grant execute on function ideworks.list_chat_reaction_changes(uuid, timestamptz)
  to ideworks_app;

commit;
