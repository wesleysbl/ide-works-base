-- Desfaz a F16.1. Nome idêntico ao da migration, de propósito.
--
-- O QUE ELE DEVOLVE
--   O schema do IDE Works sem concessões, sem credencial de automação e sem
--   as quatro variáveis de sessão da integração. O caminho humano
--   (`app.user_id` / `app.is_superadmin` / `app.is_super`) permanece.
--
--   ⚠️ REVERTER APAGA TODA CONCESSÃO E TODO VERIFICADOR. Não há cópia no
--   legado nem na prova F16.0 (aquela mora em memória). Token de agente
--   amarrado a estas linhas deixa de ter o que consultar.
--
-- A ORDEM
--   Funções primeiro — várias leem as tabelas. Tabelas em seguida (levam
--   políticas, índices, gatilho e a unique composta). Tipo por último:
--   a coluna `capabilities` depende dele, e o CHECK também.
--
-- O QUE O ROLLBACK NÃO ALCANÇA
--   `src/server/db.ts` e `src/integrations/grants.ts` são código. Voltar
--   só esta migration devolve o banco; o Worker ainda saberia declarar
--   GUCs que ninguém lê.

drop function if exists ideworks.project_task_relations(jsonb, jsonb, jsonb);
drop function if exists ideworks.integration_allows_client(uuid);
drop function if exists ideworks.integration_allows_company(uuid);
drop function if exists ideworks.owner_currently_reaches_company(uuid);
drop function if exists ideworks.integration_allows_capability(text);
drop function if exists ideworks.acting_grant_is_live();
drop function if exists ideworks.acting_execution_origin();
drop function if exists ideworks.acting_integration_owner_id();
drop function if exists ideworks.acting_grant_id();
drop function if exists ideworks.acting_integration_id();

drop trigger if exists integration_grants_policy_version on ideworks.integration_grants;
drop function if exists ideworks.bump_grant_policy_version();

drop table if exists ideworks.integration_credentials;
drop table if exists ideworks.integration_grants;

drop type if exists ideworks.integration_capability;
