-- Desfaz o histórico da troca de cliente (F38 Fase 7). Apaga as linhas que só trocavam cliente,
-- porque a regra antiga não as aceitaria.
alter table ideworks.task_events drop constraint if exists task_events_says_something;
delete from ideworks.task_events
 where from_list_id is not distinct from to_list_id
   and from_status_id is not distinct from to_status_id
   and removed_user_ids = '{}'::uuid[] and added_user_ids = '{}'::uuid[]
   and added_user_id is null;
alter table ideworks.task_events add constraint task_events_says_something check (
  from_list_id is distinct from to_list_id or from_status_id is distinct from to_status_id
  or removed_user_ids <> '{}'::uuid[] or added_user_ids <> '{}'::uuid[] or added_user_id is not null);
alter table ideworks.task_events
  drop column if exists from_client_id, drop column if exists to_client_id,
  drop column if exists from_client_name, drop column if exists to_client_name;
