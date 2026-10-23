-- =============================================================================
-- IDE WORKS — F10a  O objetivo da campanha e o criativo
-- =============================================================================
-- O QUE FALTAVA
--   A tela mostrava as mesmas colunas para toda campanha. Só que "resultado"
--   não é uma coisa só: mensagem quer CONVERSA INICIADA, vendas querem COMPRA,
--   engajamento quer curtida e comentário, alcance quer gente vendo. Mostrar
--   "11 resultados" para uma e "612" para outra, na mesma coluna, é comparar o
--   que não se compara — e a leitura sai errada nas duas.
--
--   E não havia como responder "qual criativo rendeu mais", porque a coleta
--   parava no nível da campanha.
--
-- MEDIDO ANTES DE MODELAR (2026-08-21, carteira real)
--   Dez objetivos em uso, das DUAS gerações de vocabulário da Meta:
--     OUTCOME_ENGAGEMENT 175 · OUTCOME_SALES 60 · MESSAGES 59 · LINK_CLICKS 34
--     OUTCOME_LEADS 34 · OUTCOME_TRAFFIC 24 · POST_ENGAGEMENT 10
--     OUTCOME_AWARENESS 6 · LEAD_GENERATION 4 · CONVERSIONS 2
--
--   E o mesmo anúncio devolve `OUTCOME_TRAFFIC` quando se pergunta à campanha e
--   `LINK_CLICKS` quando se pergunta ao insight. Por isso o objetivo é gravado
--   CRU e a tradução para família acontece na leitura, em `meta/objetivos.ts`:
--   traduzir na gravação congelaria o mapa enquanto a Meta ainda migra.
--
-- O CUSTO DE DESCER AO CRIATIVO É O MESMO
--   Uma chamada com `level=ad&time_increment=1` traz a série inteira. Medido na
--   maior conta: 901 linhas (57 anúncios com veiculação × 27 dias) em 27
--   segundos — e a paginação é obrigatória, porque a primeira resposta vem com
--   exatamente 500 e o resto fica atrás de `paging.next`. Sem seguir, 44% do
--   dado sumiria em silêncio.
--
-- AS AÇÕES VÃO CRUAS
--   Qual delas é "o resultado" depende do objetivo, e o objetivo muda. Guardar
--   só a que interessa hoje jogaria fora a resposta de amanhã — e a Meta não
--   devolve o passado.
-- =============================================================================

create table ideworks.meta_campaigns (
  asset_id     uuid not null references ideworks.meta_assets(id) on delete cascade,
  campaign_id  text not null,
  name         text,
  objective    text,
  status           text,
  effective_status text,
  first_seen_at timestamptz not null default now(),
  collected_at  timestamptz not null default now(),
  primary key (asset_id, campaign_id)
);

create table ideworks.meta_ads (
  asset_id     uuid not null references ideworks.meta_assets(id) on delete cascade,
  ad_id        text not null,
  campaign_id  text,
  adset_name   text,
  name         text,
  creative_id  text,
  -- O endereco do CDN da Meta expira. A tela esconde o quadro quando quebra.
  thumbnail_url text,
  effective_status text,
  first_seen_at timestamptz not null default now(),
  collected_at  timestamptz not null default now(),
  primary key (asset_id, ad_id)
);

create index meta_ads_por_campanha on ideworks.meta_ads (asset_id, campaign_id);

create table ideworks.meta_daily_ad (
  asset_id    uuid not null references ideworks.meta_assets(id) on delete cascade,
  day         date not null,
  ad_id       text not null,
  campaign_id text,
  spend       numeric(14,2),
  reach       integer,
  impressions integer,
  clicks      integer,
  link_clicks integer,
  actions     jsonb not null default '[]'::jsonb,
  collected_at timestamptz not null default now(),
  primary key (asset_id, day, ad_id),
  constraint daily_ad_nao_negativo check (
    coalesce(spend, 0) >= 0 and coalesce(reach, 0) >= 0
    and coalesce(impressions, 0) >= 0 and coalesce(clicks, 0) >= 0
    and coalesce(link_clicks, 0) >= 0
  )
);

create index meta_daily_ad_por_campanha on ideworks.meta_daily_ad (asset_id, campaign_id, day desc);

alter table ideworks.meta_campaigns enable row level security;
alter table ideworks.meta_ads       enable row level security;
alter table ideworks.meta_daily_ad  enable row level security;

create policy campaigns_select on ideworks.meta_campaigns for select
  using (exists (select 1 from ideworks.meta_assets a where a.id = asset_id
                  and (ideworks.acting_is_superadmin()
                       or (a.client_id is not null and ideworks.can_see_client(a.client_id)))));
create policy ads_select on ideworks.meta_ads for select
  using (exists (select 1 from ideworks.meta_assets a where a.id = asset_id
                  and (ideworks.acting_is_superadmin()
                       or (a.client_id is not null and ideworks.can_see_client(a.client_id)))));
create policy daily_ad_select on ideworks.meta_daily_ad for select
  using (exists (select 1 from ideworks.meta_assets a where a.id = asset_id
                  and (ideworks.acting_is_superadmin()
                       or (a.client_id is not null and ideworks.can_see_client(a.client_id)))));

-- Nenhuma politica de escrita, de proposito: entra pelo motor ou nao entra.

create or replace function ideworks.upsert_campaign(
  p_asset_id uuid, p_campaign_id text, p_name text, p_objective text,
  p_status text, p_effective_status text
) returns void
  language plpgsql security definer set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  insert into ideworks.meta_campaigns
    (asset_id, campaign_id, name, objective, status, effective_status)
  values (p_asset_id, p_campaign_id, p_name, p_objective, p_status, p_effective_status)
  on conflict (asset_id, campaign_id) do update set
    name = coalesce(excluded.name, ideworks.meta_campaigns.name),
    objective = coalesce(excluded.objective, ideworks.meta_campaigns.objective),
    status = excluded.status,
    effective_status = excluded.effective_status,
    collected_at = now();
end;
$fn$;

create or replace function ideworks.upsert_ad(
  p_asset_id uuid, p_ad_id text, p_campaign_id text, p_adset_name text,
  p_name text, p_creative_id text, p_thumbnail_url text, p_effective_status text
) returns void
  language plpgsql security definer set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  insert into ideworks.meta_ads
    (asset_id, ad_id, campaign_id, adset_name, name, creative_id, thumbnail_url, effective_status)
  values (p_asset_id, p_ad_id, p_campaign_id, p_adset_name, p_name, p_creative_id,
          p_thumbnail_url, p_effective_status)
  on conflict (asset_id, ad_id) do update set
    campaign_id = coalesce(excluded.campaign_id, ideworks.meta_ads.campaign_id),
    adset_name  = coalesce(excluded.adset_name,  ideworks.meta_ads.adset_name),
    name        = coalesce(excluded.name,        ideworks.meta_ads.name),
    creative_id = coalesce(excluded.creative_id, ideworks.meta_ads.creative_id),
    thumbnail_url = coalesce(excluded.thumbnail_url, ideworks.meta_ads.thumbnail_url),
    effective_status = excluded.effective_status,
    collected_at = now();
end;
$fn$;

create or replace function ideworks.upsert_daily_ad(
  p_asset_id uuid, p_day date, p_ad_id text, p_campaign_id text, p_metrics jsonb
) returns void
  language plpgsql security definer set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  insert into ideworks.meta_daily_ad
    (asset_id, day, ad_id, campaign_id, spend, reach, impressions, clicks, link_clicks, actions)
  values (
    p_asset_id, p_day, p_ad_id, p_campaign_id,
    (p_metrics->>'spend')::numeric,
    (p_metrics->>'reach')::int,
    (p_metrics->>'impressions')::int,
    (p_metrics->>'clicks')::int,
    (p_metrics->>'link_clicks')::int,
    coalesce(p_metrics->'actions', '[]'::jsonb)
  )
  on conflict (asset_id, day, ad_id) do update set
    campaign_id = coalesce(excluded.campaign_id, ideworks.meta_daily_ad.campaign_id),
    spend = excluded.spend, reach = excluded.reach,
    impressions = excluded.impressions, clicks = excluded.clicks,
    link_clicks = excluded.link_clicks, actions = excluded.actions,
    collected_at = now();
end;
$fn$;

grant select on ideworks.meta_campaigns, ideworks.meta_ads, ideworks.meta_daily_ad to ideworks_app;
grant execute on function ideworks.upsert_campaign(uuid, text, text, text, text, text) to ideworks_app;
grant execute on function ideworks.upsert_ad(uuid, text, text, text, text, text, text, text) to ideworks_app;
grant execute on function ideworks.upsert_daily_ad(uuid, date, text, text, jsonb) to ideworks_app;
