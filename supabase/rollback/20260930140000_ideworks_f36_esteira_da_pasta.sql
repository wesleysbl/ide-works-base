-- Remove apenas a capacidade; não desfaz escolhas já feitas pelos usuários.
drop function if exists ideworks.folder_workflow(uuid,jsonb);
alter table ideworks.tasks drop constraint tasks_status_fk;
alter table ideworks.tasks add constraint tasks_status_fk foreign key(status_id)
  references ideworks.statuses(id) on delete restrict;
