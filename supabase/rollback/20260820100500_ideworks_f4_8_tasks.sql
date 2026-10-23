-- Desfaz a F4.8. Ordem inversa da aplicacao.
--
-- ATENCAO: apaga as tarefas cadastradas, sem recuperacao fora de backup.

drop function if exists ideworks.set_task_assignees(uuid, uuid[]);
drop function if exists ideworks.set_task_archived(uuid, boolean);
drop function if exists ideworks.uncomplete_task(uuid);
drop function if exists ideworks.complete_task(uuid, uuid);

drop policy if exists task_assignees_write  on ideworks.task_assignees;
drop policy if exists task_assignees_select on ideworks.task_assignees;
drop policy if exists tasks_delete on ideworks.tasks;
drop policy if exists tasks_update on ideworks.tasks;
drop policy if exists tasks_insert on ideworks.tasks;
drop policy if exists tasks_select on ideworks.tasks;

drop index if exists ideworks.task_assignees_user_idx;
drop table if exists ideworks.task_assignees;

drop index if exists ideworks.tasks_client_idx;
drop index if exists ideworks.tasks_client_pending_idx;
drop table if exists ideworks.tasks;
