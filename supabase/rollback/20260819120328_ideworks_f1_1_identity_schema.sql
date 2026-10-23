-- =============================================================================
-- REVERSAO de 20260819120328_ideworks_f1_1_identity_schema
-- =============================================================================
-- CIRURGICA de proposito: nomeia o schema em toda linha e nao usa nenhum comando
-- capaz de alcancar `public` ou `auth`. Este projeto de banco hospeda o Sistema
-- IDE EM PRODUCAO, com 91 clientes reais.
--
-- Antes de rodar, confira que voce esta no lugar certo:
--   select count(*) from information_schema.tables where table_schema = 'public';
-- Guarde o numero. Depois da reversao ele precisa ser IDENTICO.
-- =============================================================================

drop table if exists ideworks.admin_audit;
drop table if exists ideworks.auth_attempts;
drop table if exists ideworks.invitations;
drop table if exists ideworks.profiles;

drop type if exists ideworks.attempt_purpose;
drop type if exists ideworks.attempt_scope;
drop type if exists ideworks.invitation_status;

-- `restrict` e nao `cascade`: se sobrou algum objeto que esta reversao nao
-- conhece, o comando FALHA em vez de apagar em silencio. Falhar alto, regra 3.
drop schema if exists ideworks restrict;
