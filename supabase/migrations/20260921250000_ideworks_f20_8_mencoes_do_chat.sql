-- F20.8 — Menções com @ no chat caem no sino (molde F17.82).
-- Escrita só por gatilho. Destinatário revalidado na gravação. Limite 20.
-- Mencionar a si não avisa. Aviso some com edição sem menção, apagamento ou
-- vencimento da mensagem. Perder o alcance da conversa esconde o aviso (RLS).
-- Depende de ideworks.mentioned_people(text) da F17.82.
begin;

-- Pode mencionar nesta conversa? Ativo + alcança (Geral = ativo; grupo/direta = membro).
create or replace function ideworks.can_mention_in_conversation(
  p_user_id uuid,
  p_conversation_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ideworks, pg_temp
as $fn$
  select exists (
    select 1
      from ideworks.profiles p
      join ideworks.conversations c on c.id = p_conversation_id
     where p.id = p_user_id
       and p.is_active
       and coalesce(p.email, '') not like '%@ideworks.invalid'
       and (
            c.kind = 'general'
            or exists (
                 select 1
                   from ideworks.conversation_members m
                  where m.conversation_id = c.id
                    and m.user_id = p.id
               )
           )
  )
$fn$;

comment on function ideworks.can_mention_in_conversation(uuid, uuid) is
  'Destinatário de menção no chat: perfil ativo e com alcance à conversa '
  '(Geral = qualquer ativo; grupo/direta = membro).';

-- Candidatos ao @: quem alcança a conversa (ator precisa alcançá-la também).
create or replace function ideworks.mentionable_people_in_chat(p_conversation_id uuid)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ideworks, pg_temp
as $fn$
  select p.id,
         coalesce(nullif(btrim(p.full_name), ''), 'Pessoa sem nome')::text
    from ideworks.profiles p
   where ideworks.acting_user_id() is not null
     and ideworks.can_reach_conversation(p_conversation_id)
     and ideworks.can_mention_in_conversation(p.id, p_conversation_id)
   order by lower(coalesce(p.full_name, '')), p.id
$fn$;

comment on function ideworks.mentionable_people_in_chat(uuid) is
  'Pessoas mencionáveis numa conversa do chat. Ator precisa alcançá-la.';

create table ideworks.chat_mentions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ideworks.conversations(id) on delete cascade,
  message_id uuid not null references ideworks.messages(id) on delete cascade,
  recipient_id uuid not null references ideworks.profiles(id) on delete cascade,
  actor_id uuid not null references ideworks.profiles(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  unique (message_id, recipient_id)
);

create index chat_mentions_recipient_idx
  on ideworks.chat_mentions (recipient_id, occurred_at desc);
create index chat_mentions_conversation_idx
  on ideworks.chat_mentions (conversation_id);
create index chat_mentions_message_idx
  on ideworks.chat_mentions (message_id);
create index chat_mentions_actor_idx
  on ideworks.chat_mentions (actor_id);

comment on table ideworks.chat_mentions is
  'Aviso de menção no chat. Escrita exclusiva do gatilho em messages. '
  'Cai com a mensagem (editar sem menção, apagar, vencer/cascade).';

alter table ideworks.chat_mentions enable row level security;

create policy chat_mentions_select on ideworks.chat_mentions
  for select to ideworks_app
  using (
    recipient_id = (select ideworks.acting_user_id())
    and ideworks.can_reach_conversation(conversation_id)
  );

revoke all on ideworks.chat_mentions from public, anon, authenticated, ideworks_app;
grant select on ideworks.chat_mentions to ideworks_app;

-- Gatilho: só novos destinatários; revalida alcance; auto-menção não grava.
create or replace function ideworks.sync_chat_mentions() returns trigger
language plpgsql
security definer
set search_path = ideworks, pg_temp
as $fn$
declare
  v_old text := '';
  v_new text := '';
  v_ids uuid[];
  v_previous uuid[];
  v_person uuid;
  v_actor uuid := ideworks.acting_user_id();
begin
  if tg_op = 'DELETE' then
    delete from ideworks.chat_mentions where message_id = old.id;
    return old;
  end if;

  -- Lápide ou corpo vazio: some o aviso.
  if new.deleted_at is not null or coalesce(new.body, '') = '' then
    delete from ideworks.chat_mentions where message_id = new.id;
    return new;
  end if;

  -- Linha de sistema não gera menção.
  if new.kind <> 'person' then
    delete from ideworks.chat_mentions where message_id = new.id;
    return new;
  end if;

  v_new := new.body;
  if tg_op = 'UPDATE' then
    v_old := coalesce(old.body, '');
  end if;

  v_ids := ideworks.mentioned_people(v_new);
  v_previous := ideworks.mentioned_people(v_old);

  if cardinality(v_ids) > 20 then
    raise exception 'Use no máximo 20 pessoas mencionadas por texto.'
      using errcode = '23514';
  end if;

  delete from ideworks.chat_mentions
   where message_id = new.id
     and not (recipient_id = any (v_ids));

  if v_actor is null then
    return new;
  end if;

  foreach v_person in array v_ids loop
    if v_person = any (v_previous) then
      continue;
    end if;
    if not ideworks.can_mention_in_conversation(v_person, new.conversation_id) then
      raise exception
        'Esta pessoa não alcança a conversa. Escolha alguém da lista de menções.'
        using errcode = '23514';
    end if;
    if v_person <> v_actor then
      insert into ideworks.chat_mentions (
        conversation_id, message_id, recipient_id, actor_id
      ) values (
        new.conversation_id, new.id, v_person, v_actor
      )
      on conflict (message_id, recipient_id) do nothing;
    end if;
  end loop;

  return new;
end
$fn$;

comment on function ideworks.sync_chat_mentions() is
  'Sincroniza chat_mentions a partir do corpo. Só gatilho; sem API.';

create trigger messages_chat_mentions
  after insert or update of body, deleted_at or delete
  on ideworks.messages
  for each row
  execute function ideworks.sync_chat_mentions();

revoke all on function ideworks.can_mention_in_conversation(uuid, uuid)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.mentionable_people_in_chat(uuid)
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.sync_chat_mentions()
  from public, anon, authenticated, ideworks_app;

grant execute on function ideworks.mentionable_people_in_chat(uuid) to ideworks_app;

commit;
