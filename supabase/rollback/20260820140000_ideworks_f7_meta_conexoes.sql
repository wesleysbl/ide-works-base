-- Desfaz a F7. Ordem inversa da aplicacao.
--
-- ATENCAO: apaga o MAPA de conexoes — qual conta da Meta pertence a qual
-- cliente. Nao apaga token nenhum, porque token nunca esteve aqui: ele e
-- segredo do Worker.

drop policy if exists meta_assets_write  on ideworks.meta_assets;
drop policy if exists meta_assets_select on ideworks.meta_assets;

drop index if exists ideworks.meta_assets_coleta_idx;
drop index if exists ideworks.meta_assets_client_idx;
drop table if exists ideworks.meta_assets;

drop type if exists ideworks.meta_asset_kind;
