-- =============================================================================
-- REVERSAO de 20260819150956_ideworks_f2_1_clients
-- =============================================================================
-- CIRURGICA: nomeia o schema em toda linha. Este projeto hospeda o Sistema IDE
-- EM PRODUCAO, com 91 clientes reais em `public`.
--
-- Ordem: dependentes antes dos dependidos, senao a chave estrangeira recusa.
--
-- Antes de rodar, guarde o numero:
--   select count(*) from information_schema.tables where table_schema = 'public';
-- Depois da reversao ele precisa ser IDENTICO.
-- =============================================================================

drop policy if exists user_clients_write   on ideworks.user_clients;
drop policy if exists user_clients_select  on ideworks.user_clients;
drop policy if exists tag_assign_write     on ideworks.client_tag_assignments;
drop policy if exists tag_assign_select    on ideworks.client_tag_assignments;
drop policy if exists clients_write        on ideworks.clients;
drop policy if exists clients_select       on ideworks.clients;
drop policy if exists tags_write           on ideworks.client_tags;
drop policy if exists tags_select          on ideworks.client_tags;
drop policy if exists categories_write     on ideworks.client_categories;
drop policy if exists categories_select    on ideworks.client_categories;
drop policy if exists plans_write          on ideworks.plans;
drop policy if exists plans_select         on ideworks.plans;

drop function if exists ideworks.can_see_client(uuid);

drop table if exists ideworks.user_clients;
drop table if exists ideworks.client_tag_assignments;
drop table if exists ideworks.client_tags;
drop table if exists ideworks.clients;
drop table if exists ideworks.client_categories;
drop table if exists ideworks.plans;

drop type if exists ideworks.urgency_level;

-- A coluna de acesso amplo foi acrescentada em `profiles`, que e da F1.1. Ela
-- sai junto: sem clientes, ela nao significa nada.
alter table ideworks.profiles drop column if exists has_all_clients_access;
