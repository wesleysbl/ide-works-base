-- Desfaz a parte 2 da F40 Fase 1: o tipo deixa de ser obrigatório. O tipo gravado fica.
drop trigger if exists tasks_demand_type_guard on ideworks.tasks;
drop function if exists ideworks.task_demand_type_guard();
