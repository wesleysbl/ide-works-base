-- Desfaz a parte 2 da F42 Fase 1: os destinos da aprovação por esteira.
-- Desfaça antes a parte 4 (as funções de enviar e decidir leem esta tabela).
-- A configuração gravada some junto. Depois: node scripts/conferir-schema.mjs --gravar.
drop function if exists ideworks.approval_targets_for(uuid);
drop table if exists ideworks.status_set_approval_targets;
drop function if exists ideworks.status_set_approval_targets_guard();
