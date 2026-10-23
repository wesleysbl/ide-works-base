-- =============================================================================
-- ROLLBACK da F7g — De qual empresa e cada conta da Meta
-- =============================================================================
-- O QUE ESTE ROLLBACK APAGA DE VERDADE
--   O carimbo de empresa das contas. Se alguem ja tiver corrigido a empresa de
--   alguma conta a mao, essa correcao se perde — e nao ha de onde tirar de
--   volta, porque o dado nao existe em outro lugar.
--
--   A METRICA NAO E TOCADA. As colunas somem, a serie historica fica.
--
-- E O QUE ELE QUEBRA ENQUANTO NAO SE VOLTA O CODIGO
--   As funcoes voltam a assinatura antiga. Se o Worker novo continuar no ar,
--   ele vai chamar `meta_assets_para_coleta` esperando quatro colunas e receber
--   tres — entao volte o codigo junto, nao depois.
-- =============================================================================

drop function if exists ideworks.set_asset_category(uuid, uuid);

-- --- as funcoes voltam a assinatura anterior -----------------------------------
drop function if exists ideworks.meta_assets_para_coleta(integer);

create function ideworks.meta_assets_para_coleta(p_limite integer default 0)
  returns table(id uuid, kind ideworks.meta_asset_kind, external_id text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  return query
    select a.id, a.kind, a.external_id
      from ideworks.meta_assets a
      left join ideworks.clients c on c.id = a.client_id
     where a.is_active
       and (a.client_id is null or c.is_active)
       and a.kind in ('instagram_account', 'ad_account')
     order by a.last_attempt_at asc nulls first, a.kind, a.external_id
     limit case when p_limite > 0 then p_limite else null end;
end;
$fn$;

grant execute on function ideworks.meta_assets_para_coleta(integer) to ideworks_app;

drop function if exists ideworks.upsert_meta_asset(
  ideworks.meta_asset_kind, text, text, text, text, text, text, uuid);

create function ideworks.upsert_meta_asset(
  p_kind          ideworks.meta_asset_kind,
  p_external_id   text,
  p_display_name  text,
  p_business_id   text,
  p_business_name text,
  p_page_id       text,
  p_page_name     text
) returns uuid
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_id uuid;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador importa contas da Meta' using errcode = '42501';
  end if;

  insert into ideworks.meta_assets
    (kind, external_id, display_name, business_id, business_name, page_id, page_name)
  values
    (p_kind, p_external_id, nullif(btrim(p_display_name), ''), p_business_id,
     p_business_name, p_page_id, p_page_name)
  on conflict (kind, external_id) do update set
    display_name  = coalesce(nullif(btrim(p_display_name), ''), ideworks.meta_assets.display_name),
    business_id   = coalesce(p_business_id,   ideworks.meta_assets.business_id),
    business_name = coalesce(p_business_name, ideworks.meta_assets.business_name),
    page_id       = coalesce(p_page_id,       ideworks.meta_assets.page_id),
    page_name     = coalesce(p_page_name,     ideworks.meta_assets.page_name),
    updated_at    = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function ideworks.upsert_meta_asset(
  ideworks.meta_asset_kind, text, text, text, text, text, text) to ideworks_app;

-- --- e as colunas somem --------------------------------------------------------
drop index if exists ideworks.meta_assets_por_empresa;
alter table ideworks.meta_assets drop column if exists category_id;

alter table ideworks.client_categories
  drop constraint if exists client_categories_meta_secret_e_nome;
alter table ideworks.client_categories drop column if exists meta_secret_name;
