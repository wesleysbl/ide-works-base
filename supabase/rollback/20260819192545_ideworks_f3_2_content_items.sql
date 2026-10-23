-- =============================================================================
-- REVERSAO de 20260819192545_ideworks_f3_2_content_items
-- =============================================================================
-- CIRURGICA: nomeia o schema em toda linha. Este projeto hospeda o Sistema IDE
-- EM PRODUCAO em `public`.
--
-- ATENCAO: isto apaga TODO o registro de producao — a grade, o calendario e o
-- historico de conclusao de uma vez, porque no IDE Works os tres sao a mesma
-- tabela. No legado eram tres, e apagar uma deixava as outras. Aqui nao ha essa
-- rede: exporte antes.
-- =============================================================================

drop policy if exists content_items_delete on ideworks.content_items;
drop policy if exists content_items_update on ideworks.content_items;
drop policy if exists content_items_insert on ideworks.content_items;
drop policy if exists content_items_select on ideworks.content_items;

drop function if exists ideworks.uncomplete_item(uuid);
drop function if exists ideworks.complete_item(uuid, uuid);

drop table if exists ideworks.content_items;

drop type if exists ideworks.platform;
