-- Desfaz a F16.2b. Nome idêntico ao da migration, de propósito.
--
-- O QUE ELE DEVOLVE
--   O schema do IDE Works com concessões da F16.1 intactas, sem a tabela de
--   limites nem a função que confere o verificador de automação. A conferência
--   do segredo volta a não ter caminho no banco — o Worker em memória/store
--   injetável continua, o caminho SQL some.
--
--   ⚠️ REVERTER APAGA O HISTÓRICO DE CHAMADAS DO LIMITADOR. Não há cópia.
--   Concessões e verificadores da F16.1 permanecem.
--
-- A ORDEM
--   Funções primeiro (o papel da aplicação só passa por elas). Tabela por
--   último: leva índice e RLS.

drop function if exists ideworks.lookup_live_automation_credential(text);
drop function if exists ideworks.integration_rate_oldest(text, text, timestamptz);
drop function if exists ideworks.integration_rate_record(text, text);
drop function if exists ideworks.integration_rate_count(text, text, timestamptz);

drop table if exists ideworks.integration_rate_events;
