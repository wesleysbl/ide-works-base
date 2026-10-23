-- Desfaz a F7d. ATENCAO: volta `client_id` a NOT NULL, o que so funciona se
-- nenhuma conta estiver sem cliente — e o desenho da F7d existe justamente para
-- permitir conta sem cliente. Na pratica, este rollback exige decidir antes o
-- que fazer com as contas orfas.

drop function if exists ideworks.set_asset_client(uuid, uuid);
drop function if exists ideworks.upsert_meta_asset(
  ideworks.meta_asset_kind, text, text, text, text, text, text);

drop index if exists ideworks.meta_assets_conta_unica;

alter table ideworks.meta_assets drop column if exists page_name;
alter table ideworks.meta_assets drop column if exists page_id;
alter table ideworks.meta_assets drop column if exists business_name;
alter table ideworks.meta_assets drop column if exists business_id;

delete from ideworks.meta_assets where client_id is null;
alter table ideworks.meta_assets alter column client_id set not null;

alter table ideworks.meta_assets
  add constraint meta_assets_unico_por_cliente unique (client_id, kind, external_id);
