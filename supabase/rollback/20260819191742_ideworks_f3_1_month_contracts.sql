-- =============================================================================
-- REVERSAO de 20260819191742_ideworks_f3_1_month_contracts
-- =============================================================================
-- CIRURGICA: nomeia o schema em toda linha. Este projeto hospeda o Sistema IDE
-- EM PRODUCAO em `public`.
--
-- ATENCAO: isto apaga os contratos ja congelados. Sao o registro do que foi
-- vendido em cada mes — a informacao que o legado nao consegue reconstruir. Se
-- houver mes aberto com dado real, exporte antes.
-- =============================================================================

drop policy if exists contract_items_write  on ideworks.month_contract_items;
drop policy if exists contract_items_select on ideworks.month_contract_items;
drop policy if exists contracts_write       on ideworks.month_contracts;
drop policy if exists contracts_select      on ideworks.month_contracts;
drop policy if exists quotas_write          on ideworks.client_quotas;
drop policy if exists quotas_select         on ideworks.client_quotas;

drop function if exists ideworks.open_month(uuid, date, uuid);

drop table if exists ideworks.month_contract_items;
drop table if exists ideworks.month_contracts;
drop table if exists ideworks.client_quotas;

drop type if exists ideworks.content_type;
