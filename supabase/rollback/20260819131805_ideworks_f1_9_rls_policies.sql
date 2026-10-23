-- =============================================================================
-- REVERSAO de ideworks_f1_9_rls_policies
-- =============================================================================
-- Remove as politicas e os leitores de contexto.
--
-- ATENCAO: sem policy, as tabelas voltam a NEGAR TUDO (a RLS continua ligada).
-- Isso e seguro, nao perigoso — o sistema para de funcionar em vez de abrir.
-- Reverter aqui derruba o acesso; nao expoe dado.
-- =============================================================================

drop policy if exists admin_audit_select   on ideworks.admin_audit;
drop policy if exists admin_audit_insert   on ideworks.admin_audit;
drop policy if exists auth_attempts_select on ideworks.auth_attempts;
drop policy if exists auth_attempts_insert on ideworks.auth_attempts;
drop policy if exists invitations_update   on ideworks.invitations;
drop policy if exists invitations_insert   on ideworks.invitations;
drop policy if exists invitations_select   on ideworks.invitations;
drop policy if exists profiles_update      on ideworks.profiles;
drop policy if exists profiles_insert      on ideworks.profiles;
drop policy if exists profiles_select      on ideworks.profiles;

drop function if exists ideworks.is_preauth();
drop function if exists ideworks.acting_is_superadmin();
drop function if exists ideworks.acting_user_id();
