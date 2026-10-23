-- Desfaz a F26.2. Nome idêntico ao da migration, de propósito.
--
-- O QUE ELE DEVOLVE
--   As quatro tabelas (tarefas, eventos da tarefa, mural e histórico do
--   cliente) exatamente como estavam: sem as colunas de origem, sem as
--   checagens, índices e chaves estrangeiras delas, sem os seis gatilhos e sem
--   as duas funções. O retrato de `conferir-schema.mjs` anterior à F26.2 volta
--   a bater. A regra de edição sai junto: a IA volta a poder editar e apagar
--   qualquer nota e qualquer registro que a pessoa dona dela alcance — que é o
--   que o banco fazia antes, e o que a F26.1 não mudou.
--
-- ⚠️ A MARCA SE PERDE
--   Tirar a coluna apaga o dado dela. Não há cópia: toda tarefa, evento, nota
--   e registro que a IA criou passa a parecer escrito à mão. Quem quiser
--   guardar, consulte ANTES:
--     select id, via_grant_id, via_name from ideworks.tasks          where via_name is not null;
--     select id, via_grant_id, via_name from ideworks.task_events    where via_name is not null;
--     select id, via_grant_id, via_name from ideworks.mural_notes    where via_name is not null;
--     select id, via_grant_id, via_name from ideworks.client_history where via_name is not null;
--   O registro da integração (f16c) continua guardando o que o agente fez,
--   enquanto a conexão existir.
--
-- O QUE O ROLLBACK NÃO ALCANÇA
--   Código. Um Worker que já leia `via_name` passa a levar "coluna não existe"
--   nas telas de tarefa, mural e histórico. Reverta o Worker ANTES (fases 5, 6
--   e 9 da F26), e só depois rode este arquivo.

begin;
set local lock_timeout = '15s';

-- --- gatilhos ----------------------------------------------------------------
drop trigger if exists mural_notes_agent_guard    on ideworks.mural_notes;
drop trigger if exists client_history_agent_guard on ideworks.client_history;
drop trigger if exists tasks_via_origin           on ideworks.tasks;
drop trigger if exists task_events_via_origin     on ideworks.task_events;
drop trigger if exists mural_notes_via_origin     on ideworks.mural_notes;
drop trigger if exists client_history_via_origin  on ideworks.client_history;

-- --- funções -----------------------------------------------------------------
drop function if exists ideworks.agent_client_record_guard();
drop function if exists ideworks.stamp_agent_origin();

-- --- índices, checagens e colunas --------------------------------------------
-- Cair a coluna já levaria índice, checagem e chave estrangeira. Escrito
-- explícito para o rollback dizer o que tira, e para `if exists` tolerar um
-- banco onde a migration parou no meio.
drop index if exists ideworks.tasks_via_grant_idx;
drop index if exists ideworks.task_events_via_grant_idx;
drop index if exists ideworks.mural_notes_via_grant_idx;
drop index if exists ideworks.client_history_via_grant_idx;

alter table ideworks.tasks
  drop constraint if exists tasks_via_coherent,
  drop column if exists via_grant_id,
  drop column if exists via_name;

alter table ideworks.task_events
  drop constraint if exists task_events_via_coherent,
  drop column if exists via_grant_id,
  drop column if exists via_name;

alter table ideworks.mural_notes
  drop constraint if exists mural_notes_via_coherent,
  drop column if exists via_grant_id,
  drop column if exists via_name;

alter table ideworks.client_history
  drop constraint if exists client_history_via_coherent,
  drop column if exists via_grant_id,
  drop column if exists via_name;

commit;
