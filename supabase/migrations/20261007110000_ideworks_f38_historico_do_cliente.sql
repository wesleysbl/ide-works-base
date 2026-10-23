-- PROPOSTA (NÃO APLICADA) — F38, Fase 7: a troca de cliente entra no histórico da tarefa.
-- Nome sugerido: supabase/migrations/20261007110000_ideworks_f38_historico_do_cliente.sql
--
-- POR QUE PRECISA: `ideworks.task_events` não tem coluna de cliente, e o check
-- `task_events_says_something` recusaria uma linha que só troca o cliente.
-- Aditiva: nada existente muda de sentido.

alter table ideworks.task_events
  add column if not exists from_client_id   uuid references ideworks.clients (id) on delete set null,
  add column if not exists to_client_id     uuid references ideworks.clients (id) on delete set null,
  -- Paraquedas, como from_list_name/from_status_name (F17.65): só valem quando o id virou nulo.
  add column if not exists from_client_name text,
  add column if not exists to_client_name   text;

alter table ideworks.task_events drop constraint if exists task_events_says_something;
alter table ideworks.task_events
  add constraint task_events_says_something
  check (
    from_list_id   is distinct from to_list_id
    or from_status_id is distinct from to_status_id
    or removed_user_ids <> '{}'::uuid[]
    or added_user_ids   <> '{}'::uuid[]
    or added_user_id    is not null
    or from_client_id   is distinct from to_client_id
  );

comment on column ideworks.task_events.from_client_id is
  'F38, Fase 7: o cliente da tarefa ANTES de uma troca feita no cartão (nulo = sem cliente).';
comment on column ideworks.task_events.to_client_id is
  'F38, Fase 7: o cliente da tarefa DEPOIS da troca (nulo = sem cliente).';

-- Grants: nada a fazer. `ideworks_app` já tem INSERT/SELECT na tabela inteira
-- (conferido em 07/10 em information_schema.table_privileges), e privilégio de
-- tabela cobre coluna nova. A política `task_events_insert`
-- (can_reach_task_id) continua sendo a regra.

-- ROLLBACK (supabase/rollback/20261007110000_ideworks_f38_historico_do_cliente.sql):
--   alter table ideworks.task_events drop constraint if exists task_events_says_something;
--   delete from ideworks.task_events
--    where from_list_id is not distinct from to_list_id
--      and from_status_id is not distinct from to_status_id
--      and removed_user_ids = '{}'::uuid[] and added_user_ids = '{}'::uuid[]
--      and added_user_id is null;           -- as linhas que só trocavam cliente
--   alter table ideworks.task_events add constraint task_events_says_something check (
--     from_list_id is distinct from to_list_id or from_status_id is distinct from to_status_id
--     or removed_user_ids <> '{}'::uuid[] or added_user_ids <> '{}'::uuid[] or added_user_id is not null);
--   alter table ideworks.task_events
--     drop column if exists from_client_id, drop column if exists to_client_id,
--     drop column if exists from_client_name, drop column if exists to_client_name;
--
-- Depois de aplicada, o código (a fazer): `setBoardTaskClientInTx` grava
--   insert into ideworks.task_events (task_id, automation_name, from_client_id, to_client_id,
--                                     from_client_name, to_client_name, actor_id)
--   values (:task, null, :antes, :depois, :nome_antes, :nome_depois, ideworks.acting_user_id());
-- e `lerFicha`/`EventoDaTarefa`/`board/historico.ts` passam a ler e escrever
-- "trocou o cliente de X para Y".
