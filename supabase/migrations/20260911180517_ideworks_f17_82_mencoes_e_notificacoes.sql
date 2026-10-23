-- Menções são parte do texto; apenas novos destinatários geram avisos.
-- Nenhum backfill: textos antigos não disparam notificações retroativas.
begin;

create function ideworks.mentioned_people(p_text text) returns uuid[]
language sql immutable set search_path = ideworks, pg_temp as $fn$
  select coalesce(array_agg(distinct m[1]::uuid), '{}'::uuid[])
  from regexp_matches(coalesce(p_text, ''),
    '@\[[^\]\r\n]{1,120}\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)', 'g') m
$fn$;

create function ideworks.can_mention_person(p_user_id uuid, p_list_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path = ideworks, pg_temp as $fn$
  select exists (select 1 from ideworks.profiles p
    where p.id = p_user_id and p.is_active
      and coalesce(p.email, '') not like '%@ideworks.invalid'
      and ideworks.can_reach_task_for(p.id, p_list_id, p_client_id))
$fn$;

create function ideworks.mentionable_people(p_task_id uuid, p_list_id uuid)
returns table(id uuid, name text)
language sql stable security definer set search_path = ideworks, pg_temp as $fn$
  with target as (
    select t.list_id, t.client_id from ideworks.tasks t
     where p_task_id is not null and t.id = p_task_id
       and ideworks.can_reach_task(t.list_id, t.client_id)
    union all
    select l.id, null::uuid from ideworks.lists l
     where p_task_id is null and l.id = p_list_id
       and ideworks.can_reach_task(l.id, null)
  )
  select p.id, coalesce(nullif(p.full_name, ''), 'Pessoa sem nome')::text
    from ideworks.profiles p cross join target t
   where ideworks.acting_user_id() is not null
     and ideworks.can_mention_person(p.id, t.list_id, t.client_id)
   order by lower(coalesce(p.full_name, '')), p.id
$fn$;

create table ideworks.task_mentions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references ideworks.tasks(id) on delete cascade,
  source_type text not null check (source_type in ('task', 'comment', 'checklist', 'item')),
  source_id uuid not null,
  recipient_id uuid not null references ideworks.profiles(id) on delete cascade,
  actor_id uuid not null references ideworks.profiles(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  unique (source_type, source_id, recipient_id)
);
create index task_mentions_recipient_idx on ideworks.task_mentions(recipient_id, occurred_at desc);
create index task_mentions_task_idx on ideworks.task_mentions(task_id);
create index task_mentions_actor_idx on ideworks.task_mentions(actor_id);
alter table ideworks.task_mentions enable row level security;
create policy task_mentions_select on ideworks.task_mentions for select to ideworks_app
  using (recipient_id = (select ideworks.acting_user_id()) and ideworks.can_reach_task_id(task_id));
revoke all on ideworks.task_mentions from public, anon, authenticated, ideworks_app;
grant select on ideworks.task_mentions to ideworks_app;

-- Escrita exclusiva dos gatilhos: não é uma API chamável pelo Worker.
create function ideworks.sync_text_mentions() returns trigger
language plpgsql security definer set search_path = ideworks, pg_temp as $fn$
declare
  v_task uuid; v_source text; v_old text := ''; v_new text := '';
  v_ids uuid[]; v_previous uuid[]; v_person uuid;
  v_actor uuid := ideworks.acting_user_id(); v_list uuid; v_client uuid;
begin
  v_source := case tg_table_name when 'tasks' then 'task' when 'task_comments' then 'comment'
    when 'task_checklists' then 'checklist' else 'item' end;
  if tg_op = 'DELETE' then
    delete from ideworks.task_mentions where source_type = v_source and source_id = old.id;
    return old;
  end if;
  if tg_table_name = 'tasks' then
    v_task := new.id; v_new := coalesce(new.title, '') || E'\n' || coalesce(new.description, '');
    if tg_op = 'UPDATE' then v_old := coalesce(old.title, '') || E'\n' || coalesce(old.description, ''); end if;
  elsif tg_table_name = 'task_comments' then
    v_task := new.task_id; v_new := new.body;
    if tg_op = 'UPDATE' then v_old := old.body; end if;
  elsif tg_table_name = 'task_checklists' then
    v_task := new.task_id; v_new := new.name;
    if tg_op = 'UPDATE' then v_old := old.name; end if;
  else
    select task_id into v_task from ideworks.task_checklists where id = new.checklist_id;
    v_new := new.name;
    if tg_op = 'UPDATE' then v_old := old.name; end if;
  end if;
  v_ids := ideworks.mentioned_people(v_new); v_previous := ideworks.mentioned_people(v_old);
  if cardinality(v_ids) > 20 then raise exception 'Use no máximo 20 pessoas mencionadas por texto.' using errcode = '23514'; end if;
  delete from ideworks.task_mentions where source_type = v_source and source_id = new.id
    and not (recipient_id = any(v_ids));
  if v_actor is null then return new; end if;
  select list_id, client_id into v_list, v_client from ideworks.tasks where id = v_task;
  foreach v_person in array v_ids loop
    if v_person = any(v_previous) then continue; end if;
    if not ideworks.can_mention_person(v_person, v_list, v_client) then
      raise exception 'Esta pessoa não tem acesso à tarefa. Escolha alguém da lista de menções.' using errcode = '23514';
    end if;
    if v_person <> v_actor then
      insert into ideworks.task_mentions(task_id, source_type, source_id, recipient_id, actor_id)
      values (v_task, v_source, new.id, v_person, v_actor)
      on conflict (source_type, source_id, recipient_id) do nothing;
    end if;
  end loop;
  return new;
end
$fn$;

create trigger tasks_mentions after insert or update of title, description or delete
  on ideworks.tasks for each row execute function ideworks.sync_text_mentions();
create trigger task_comments_mentions after insert or update of body or delete
  on ideworks.task_comments for each row execute function ideworks.sync_text_mentions();
create trigger task_checklists_mentions after insert or update of name or delete
  on ideworks.task_checklists for each row execute function ideworks.sync_text_mentions();
create trigger checklist_items_mentions after insert or update of name or delete
  on ideworks.checklist_items for each row execute function ideworks.sync_text_mentions();

revoke all on function ideworks.mentioned_people(text), ideworks.can_mention_person(uuid, uuid, uuid),
  ideworks.mentionable_people(uuid, uuid), ideworks.sync_text_mentions() from public, anon, authenticated, ideworks_app;
grant execute on function ideworks.mentionable_people(uuid, uuid) to ideworks_app;
commit;
