-- Desfaz a F16.6a. Nome idêntico ao da migration, de propósito.
--
-- O QUE ELE DEVOLVE
--   O schema do IDE Works com concessões (f16a) e limites (f16b) intactos,
--   sem o ledger de escritas de agente e sem aprovações de prévia.
--
--   ⚠️ REVERTER APAGA O HISTÓRICO DE EXECUÇÃO E AS PRÉVIAS CONFIRMADAS.
--   Não há cópia. Comentários e movimentos humanos não moram nestas tabelas
--   — o rollback não os toca. HTTP/MCP de escrita ainda não existia nesta etapa.
--
-- A ORDEM
--   Gatilho primeiro. Tabelas por último: levam índice, RLS e a unique
--   parcial da concorrência.

drop trigger if exists integration_executions_guard on ideworks.integration_executions;
drop function if exists ideworks.integration_executions_guard();

drop table if exists ideworks.integration_executions;
drop table if exists ideworks.integration_write_approvals;
