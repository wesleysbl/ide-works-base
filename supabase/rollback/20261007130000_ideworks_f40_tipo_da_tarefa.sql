-- Desfaz a parte 1 da F40 Fase 1: a função de produção e o tipo da tarefa.
-- Se a parte 2 (gatilho) estiver aplicada, desfaça-a antes (a função guard depende do tipo).
-- O tipo já gravado nas tarefas some junto com a coluna.
-- Depois: node scripts/conferir-schema.mjs --gravar.
drop function if exists ideworks.list_is_production(uuid);
alter table ideworks.tasks drop column if exists demand_type;
drop type if exists ideworks.task_demand_type;
