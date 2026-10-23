-- =============================================================================
-- ROLLBACK da F7i — Gravar em lote
-- =============================================================================
-- SEGURO: nao apaga dado nenhum. As funcoes de uma linha so nunca foram
-- removidas, entao voltar o codigo do motor basta — estas aqui so deixam de ser
-- chamadas.
--
-- MAS VOLTE O CODIGO JUNTO. Sem elas, a coleta de conta de anuncio volta a
-- fazer mais de mil idas ao banco por execucao, e a "Pro Forma" volta a
-- matar o Worker. Era esse o estado de 2026-08-21, e ele levou quatro
-- execucoes seguidas a nao gravar nada.
-- =============================================================================

drop function if exists ideworks.upsert_campaigns_lote(uuid, jsonb);
drop function if exists ideworks.upsert_ads_lote(uuid, jsonb);
drop function if exists ideworks.upsert_daily_ads_lote(uuid, jsonb);
