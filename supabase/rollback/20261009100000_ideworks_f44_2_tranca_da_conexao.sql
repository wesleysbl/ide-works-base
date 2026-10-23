-- Desfaz a F44_2 (F44, Fase 5): a segunda tranca das conexões de IA sai do banco.
--
-- O QUE VOLTA
--   Exatamente as políticas de hoje: a migration não tocou em nenhuma política
--   permissiva — só ACRESCENTOU uma restritiva por tabela. Apagando as 25
--   restritivas, a regra de cada tabela é de novo só a da pessoa, e o recorte da
--   conexão de IA volta a morar só no código (`src/integrations/sql-work.ts`,
--   `writes.ts`). Nenhum dado é tocado.
--
-- ORDEM: as políticas antes das funções — elas dependem das funções, e um
-- `drop function` com política pendurada é recusado.
--
-- Depois: node scripts/conferir-schema.mjs --gravar (o retrato volta ao de antes).

begin;
set local lock_timeout = '5s';

drop policy if exists spaces_tranca_da_conexao on ideworks.spaces;
drop policy if exists folders_tranca_da_conexao on ideworks.folders;
drop policy if exists lists_tranca_da_conexao on ideworks.lists;
drop policy if exists tasks_tranca_da_conexao on ideworks.tasks;
drop policy if exists task_comments_tranca_da_conexao on ideworks.task_comments;
drop policy if exists task_events_tranca_da_conexao on ideworks.task_events;
drop policy if exists task_assignees_tranca_da_conexao on ideworks.task_assignees;
drop policy if exists task_watchers_tranca_da_conexao on ideworks.task_watchers;
drop policy if exists task_tag_assignments_tranca_da_conexao on ideworks.task_tag_assignments;
drop policy if exists task_checklists_tranca_da_conexao on ideworks.task_checklists;
drop policy if exists checklist_items_tranca_da_conexao on ideworks.checklist_items;
drop policy if exists task_links_tranca_da_conexao on ideworks.task_links;
drop policy if exists task_attachments_tranca_da_conexao on ideworks.task_attachments;
drop policy if exists approval_rounds_tranca_da_conexao on ideworks.approval_rounds;
drop policy if exists approval_round_items_tranca_da_conexao on ideworks.approval_round_items;
drop policy if exists clients_tranca_da_conexao on ideworks.clients;
drop policy if exists mural_notes_tranca_da_conexao on ideworks.mural_notes;
drop policy if exists client_history_tranca_da_conexao on ideworks.client_history;
drop policy if exists history_documents_tranca_da_conexao on ideworks.history_documents;
drop policy if exists content_items_tranca_da_conexao on ideworks.content_items;
drop policy if exists month_contracts_tranca_da_conexao on ideworks.month_contracts;
drop policy if exists month_contract_items_tranca_da_conexao on ideworks.month_contract_items;
drop policy if exists client_quotas_tranca_da_conexao on ideworks.client_quotas;
drop policy if exists client_tag_assignments_tranca_da_conexao on ideworks.client_tag_assignments;
drop policy if exists appointments_tranca_da_conexao on ideworks.appointments;

drop function if exists ideworks.integration_board_ids();
drop function if exists ideworks.integration_client_ids();
drop function if exists ideworks.integration_list_ids();
drop function if exists ideworks.integration_space_ids();
drop function if exists ideworks.integration_company_ids();
drop function if exists ideworks.no_integration_declared();

commit;
