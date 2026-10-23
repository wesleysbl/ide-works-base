-- =============================================================================
-- ROLLBACK da F9n — saber qual publicacao foi impulsionada
-- =============================================================================
-- VOLTA A CONFUSAO, e ela e silenciosa: sem o vinculo, um post impulsionado
-- volta a aparecer como um post organico que explodiu. Os numeros do Instagram
-- continuam somando a entrega paga — a diferenca e que ninguem mais fica
-- sabendo.
--
-- APAGA O QUE FOI COLETADO. `instagram_media_id` so se recupera coletando de
-- novo, e so enquanto o anuncio existir na Meta. Anuncio apagado la leva o
-- vinculo junto, e a publicacao daquele mes fica sem explicacao para sempre.
--
-- VOLTE O CODIGO JUNTO: `meta-relatorio.ts` faz juncao com estas colunas.
-- =============================================================================

drop function if exists ideworks.impulso_da_publicacao(text, date, date);

drop index if exists ideworks.meta_ads_por_media_do_instagram;

alter table ideworks.meta_ads
  drop column if exists instagram_media_id,
  drop column if exists instagram_permalink;

-- A funcao de lote volta a assinatura anterior, sem os dois campos. Sem isto o
-- motor tentaria gravar coluna que nao existe mais.
create or replace function ideworks.upsert_ads_lote(
  p_asset_id uuid, p_itens jsonb
) returns integer
  language plpgsql security definer set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  perform ideworks.assert_collector();

  with entrada as (
    select distinct on (x.ad_id)
           x.ad_id, x.campaign_id, x.adset_name, x.name,
           x.creative_id, x.thumbnail_url, x.effective_status
      from rows from (
             jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb))
               as (ad_id text, campaign_id text, adset_name text, name text,
                   creative_id text, thumbnail_url text, effective_status text)
           ) with ordinality
           as x(ad_id, campaign_id, adset_name, name, creative_id,
                thumbnail_url, effective_status, ord)
     where x.ad_id is not null
     order by x.ad_id, x.ord desc
  ), gravado as (
    insert into ideworks.meta_ads
      (asset_id, ad_id, campaign_id, adset_name, name, creative_id,
       thumbnail_url, effective_status)
    select p_asset_id, e.ad_id, e.campaign_id, e.adset_name, e.name,
           e.creative_id, e.thumbnail_url, e.effective_status
      from entrada e
    on conflict (asset_id, ad_id) do update set
      campaign_id = coalesce(excluded.campaign_id, ideworks.meta_ads.campaign_id),
      adset_name  = coalesce(excluded.adset_name,  ideworks.meta_ads.adset_name),
      name        = coalesce(excluded.name,        ideworks.meta_ads.name),
      creative_id = coalesce(excluded.creative_id, ideworks.meta_ads.creative_id),
      thumbnail_url = coalesce(excluded.thumbnail_url, ideworks.meta_ads.thumbnail_url),
      effective_status = excluded.effective_status,
      collected_at = now()
    returning 1
  )
  select count(*)::int into v_n from gravado;

  return v_n;
end;
$fn$;

grant execute on function ideworks.upsert_ads_lote(uuid, jsonb) to ideworks_app;
