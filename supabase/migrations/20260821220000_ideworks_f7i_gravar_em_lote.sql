-- =============================================================================
-- IDE WORKS — F7i  Gravar em lote, e nao linha por linha
-- =============================================================================
-- A CONTA QUE NAO CABE
--   A "Pro Forma" tem 300 anuncios e 901 linhas diarias. Do jeito antigo,
--   coletar essa conta era:
--
--       300 chamadas   upsert_ad
--       901 chamadas   upsert_daily_ad
--       ~20 chamadas   upsert_campaign
--     ------
--     ~1.220 idas e voltas ao banco DENTRO de uma execucao do Worker
--
--   Cada ida dessas conta como sub-requisicao na plataforma, e o teto e da
--   ordem de mil por execucao. A conta nao estourava por ser lenta: estourava
--   por ser MUITA — e o Worker morria sem chegar a gravar nada, quatro
--   execucoes seguidas, em 2026-08-21.
--
--   Depois destas funcoes, a mesma conta custa TRES chamadas.
--
-- POR QUE `jsonb_to_recordset`, E NAO VARIOS `values`
--   Montar um `insert` com mil tuplas no cliente faria a consulta crescer sem
--   limite e trocaria o teto de sub-requisicoes pelo de tamanho de consulta.
--   Com jsonb o texto da consulta e FIXO: o volume viaja como um parametro so.
--
-- A ARMADILHA QUE ISTO PRECISA DESVIAR: CHAVE REPETIDA NO MESMO LOTE
--   `on conflict do update` recusa afetar a mesma linha duas vezes na mesma
--   instrucao — "cannot affect row a second time". Linha por linha isso nunca
--   aparecia, porque cada chamada era uma instrucao propria: a segunda
--   simplesmente sobrescrevia a primeira.
--
--   Em lote, uma unica repeticao derruba o lote INTEIRO. E a Meta repete: o
--   mesmo anuncio volta em paginas diferentes quando algo muda no meio da
--   paginacao. Por isso cada funcao faz `distinct on` na chave antes de
--   inserir, com `with ordinality` para a ULTIMA do lote vencer — que e o mesmo
--   desfecho de quando era uma chamada por linha.
--
--   Provado antes de publicar, com lote contendo chave repetida de proposito:
--   duas campanhas iguais gravam uma, e o nome que fica e o da segunda.
--
-- A SINTAXE QUE PARECE CERTA E NAO E
--   `jsonb_to_recordset(...) with ordinality as x(col text, ..., ord bigint)`
--   e RECUSADO: "WITH ORDINALITY cannot be used with a column definition list".
--   A forma que funciona e `rows from (funcao(...) as (colunas)) with
--   ordinality as x(colunas, ord)` — a lista de tipos vai DENTRO do `rows
--   from`, e o apelido de fora so nomeia.
--
-- O QUE NAO MUDA
--   A regra de cada campo e identica a das funcoes de uma linha so: `coalesce`
--   onde havia `coalesce`, sobrescrita onde havia sobrescrita. Isto e mudanca
--   de TRANSPORTE, nao de significado — e as funcoes antigas continuam
--   existindo, porque as provas e os scripts as usam.
-- =============================================================================

create or replace function ideworks.upsert_campaigns_lote(
  p_asset_id uuid, p_itens jsonb
) returns integer
  language plpgsql security definer set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  perform ideworks.assert_collector();

  with entrada as (
    select distinct on (x.campaign_id)
           x.campaign_id, x.name, x.objective, x.status, x.effective_status
      from rows from (
             jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb))
               as (campaign_id text, name text, objective text, status text,
                   effective_status text)
           ) with ordinality
           as x(campaign_id, name, objective, status, effective_status, ord)
     where x.campaign_id is not null
     -- A ULTIMA DO LOTE VENCE.
     order by x.campaign_id, x.ord desc
  ), gravado as (
    insert into ideworks.meta_campaigns
      (asset_id, campaign_id, name, objective, status, effective_status)
    select p_asset_id, e.campaign_id, e.name, e.objective, e.status, e.effective_status
      from entrada e
    on conflict (asset_id, campaign_id) do update set
      name = coalesce(excluded.name, ideworks.meta_campaigns.name),
      objective = coalesce(excluded.objective, ideworks.meta_campaigns.objective),
      status = excluded.status,
      effective_status = excluded.effective_status,
      collected_at = now()
    returning 1
  )
  select count(*)::int into v_n from gravado;

  return v_n;
end;
$fn$;

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

create or replace function ideworks.upsert_daily_ads_lote(
  p_asset_id uuid, p_itens jsonb
) returns integer
  language plpgsql security definer set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  perform ideworks.assert_collector();

  with entrada as (
    select distinct on (x.day, x.ad_id)
           x.day, x.ad_id, x.campaign_id, x.metrics
      from rows from (
             jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb))
               as (day date, ad_id text, campaign_id text, metrics jsonb)
           ) with ordinality
           as x(day, ad_id, campaign_id, metrics, ord)
     where x.day is not null and x.ad_id is not null
     order by x.day, x.ad_id, x.ord desc
  ), gravado as (
    insert into ideworks.meta_daily_ad
      (asset_id, day, ad_id, campaign_id, spend, reach, impressions, clicks,
       link_clicks, actions)
    select p_asset_id, e.day, e.ad_id, e.campaign_id,
           (e.metrics->>'spend')::numeric,
           (e.metrics->>'reach')::int,
           (e.metrics->>'impressions')::int,
           (e.metrics->>'clicks')::int,
           (e.metrics->>'link_clicks')::int,
           coalesce(e.metrics->'actions', '[]'::jsonb)
      from entrada e
    on conflict (asset_id, day, ad_id) do update set
      campaign_id = coalesce(excluded.campaign_id, ideworks.meta_daily_ad.campaign_id),
      spend = excluded.spend, reach = excluded.reach,
      impressions = excluded.impressions, clicks = excluded.clicks,
      link_clicks = excluded.link_clicks, actions = excluded.actions,
      collected_at = now()
    returning 1
  )
  select count(*)::int into v_n from gravado;

  return v_n;
end;
$fn$;

grant execute on function ideworks.upsert_campaigns_lote(uuid, jsonb)  to ideworks_app;
grant execute on function ideworks.upsert_ads_lote(uuid, jsonb)        to ideworks_app;
grant execute on function ideworks.upsert_daily_ads_lote(uuid, jsonb)  to ideworks_app;
