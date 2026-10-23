-- Desfaz a parte 1 da F38 Fase 6: a herança do cliente da lista e a marca "exige cliente".
-- Não mexe no cliente já gravado nas tarefas. Se a parte 2 já foi aplicada, a marca some junto com a coluna.
drop trigger if exists tasks_client_from_list on ideworks.tasks;
drop function if exists ideworks.task_client_from_list();
alter table ideworks.lists drop column if exists requires_client;
