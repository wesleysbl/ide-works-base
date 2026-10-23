-- =============================================================================
-- REVERSAO de 20260819123141_ideworks_f0_2b_restricted_role
-- =============================================================================
-- Remove o papel restrito do IDE Works.
--
-- ATENCAO: rodar isto DEIXA O DESENVOLVIMENTO SEM REDE DE SEGURANCA. Sem este
-- papel, a separacao entre o IDE Works e o Sistema IDE em producao volta a
-- depender apenas de disciplina humana. So reverta se for para substituir por
-- algo equivalente ou melhor.
--
-- A ordem importa: privilegios padrao precisam ser retirados ANTES do papel,
-- senao o `drop role` falha dizendo que o papel ainda e referenciado.
-- =============================================================================

alter default privileges in schema ideworks
  revoke all privileges on functions from ideworks_app;
alter default privileges in schema ideworks
  revoke all privileges on sequences from ideworks_app;
alter default privileges in schema ideworks
  revoke all privileges on tables from ideworks_app;

revoke all privileges on all functions in schema ideworks from ideworks_app;
revoke all privileges on all sequences in schema ideworks from ideworks_app;
revoke all privileges on all tables    in schema ideworks from ideworks_app;
revoke all on schema ideworks from ideworks_app;

drop role if exists ideworks_app;
