-- =============================================================================
-- IDE WORKS — F8  O motor de coleta
-- =============================================================================
-- O ACHADO QUE REPOSICIONA ESTE PILAR (viabilidade, secao 7)
--   metrica de usuario fica na Meta por  90 dias
--   demografia cobre os ultimos          30 dias
--   insight de story evapora em          24 horas
--
--   **O historico nao existe na Meta. Ele so vai existir se for nosso.**
--
--   Consequencia dura: coleta perdida e dado perdido PARA SEMPRE. Por isso o
--   monitor de saude nasce junto com o motor, e nao na versao seguinte — e por
--   isso `meta_collection_runs` esta nesta migration, e nao numa futura.
--
-- GRANULARIDADE — decisao D12
--   Diario por CONTA no organico, diario por CAMPANHA no pago. Descer ao nivel
--   de anuncio depois e acrescentar tabela, nao reescrever esta.
--
-- SEM JOB ASSINCRONO — decisao D13
--   Comparacao de alcance acima de 13 meses fica fora da v1. Em 13 meses o
--   historico ja e nosso e o problema some sozinho.
--
-- POR QUE COLUNA ANULAVEL + `extra jsonb`, E NAO SO UMA COISA OU OUTRA
--   A secao 6.5 da viabilidade avisa: nomes de metrica DESAPARECEM entre
--   versoes da API. `impressions` ja foi descontinuada em favor de `views`.
--
--   Se as metricas fossem colunas obrigatorias, o dia em que a Meta aposentar
--   uma delas a insercao passa a falhar — em producao, sem ninguem ter mexido
--   em nada. Se fossem so `jsonb`, toda consulta de grafico viraria extracao de
--   JSON, e um erro de digitacao no nome do campo devolveria nulo em silencio.
--
--   Entao: coluna ANULAVEL para o punhado de metricas que o painel desenha, e
--   `extra` para tudo o que vier junto. Metrica que some vira coluna nula — o
--   grafico mostra buraco, que e a verdade — e metrica nova nao se perde
--   enquanto nao houver migration para promove-la a coluna.
--
-- A JANELA DE 28 DIAS — secao 6.2
--   Numero de anuncio continua mudando por ate 28 dias depois do fim. Gravar
--   uma vez e confiar produz relatorio errado. Por isso a chave e
--   (ativo, dia[, campanha]) e a escrita e UPSERT: reprocessar a janela e
--   idempotente, e `collected_at` mostra quando aquele dia foi confirmado pela
--   ultima vez.
-- =============================================================================

-- --- organico: um resumo por conta, por dia ------------------------------------
create table if not exists ideworks.meta_daily_organic (
  asset_id     uuid not null references ideworks.meta_assets (id) on delete cascade,
  day          date not null,

  -- O que o painel desenha. TODAS anulaveis, de proposito: ver o cabecalho.
  reach              integer,
  views              integer,
  accounts_engaged   integer,
  total_interactions integer,
  follows            integer,
  unfollows          integer,
  profile_links_taps integer,

  -- Tudo o mais que veio na resposta, sem interpretacao.
  extra        jsonb not null default '{}'::jsonb,

  collected_at timestamptz not null default now(),

  primary key (asset_id, day),

  constraint organic_nao_negativo check (
    coalesce(reach, 0) >= 0 and coalesce(views, 0) >= 0
    and coalesce(accounts_engaged, 0) >= 0 and coalesce(total_interactions, 0) >= 0
    and coalesce(follows, 0) >= 0 and coalesce(unfollows, 0) >= 0
    and coalesce(profile_links_taps, 0) >= 0
  )
);

create index if not exists organic_dia_idx on ideworks.meta_daily_organic (day);

comment on table ideworks.meta_daily_organic is
  'Serie historica do organico, um registro por conta por dia. As colunas de '
  'metrica sao TODAS anulaveis porque a Meta aposenta nome de metrica sem aviso '
  '— `impressions` ja foi. Metrica que some vira coluna nula, e o grafico mostra '
  'buraco, que e a verdade.';

-- --- pago: uma linha por campanha, por dia -------------------------------------
create table if not exists ideworks.meta_daily_campaign (
  asset_id      uuid not null references ideworks.meta_assets (id) on delete cascade,
  day           date not null,
  campaign_id   text not null,

  -- O nome muda quando renomeiam a campanha. Guarda-se o do dia da coleta, para
  -- o relatorio historico nao renomear o passado.
  campaign_name text,

  spend         numeric(14, 2),
  reach         integer,
  impressions   integer,
  clicks        integer,
  link_clicks   integer,
  conversions   integer,
  conversion_value numeric(14, 2),

  extra         jsonb not null default '{}'::jsonb,

  collected_at  timestamptz not null default now(),

  primary key (asset_id, day, campaign_id),

  constraint campaign_id_nao_vazio check (btrim(campaign_id) <> ''),
  constraint campaign_nao_negativo check (
    coalesce(spend, 0) >= 0 and coalesce(reach, 0) >= 0 and coalesce(impressions, 0) >= 0
    and coalesce(clicks, 0) >= 0 and coalesce(link_clicks, 0) >= 0
    and coalesce(conversions, 0) >= 0 and coalesce(conversion_value, 0) >= 0
  )
);

create index if not exists campaign_dia_idx on ideworks.meta_daily_campaign (day);
create index if not exists campaign_por_campanha_idx
  on ideworks.meta_daily_campaign (campaign_id, day);

comment on column ideworks.meta_daily_campaign.campaign_name is
  'O nome COMO ESTAVA no dia da coleta. Renomear a campanha na Meta nao pode '
  'renomear o passado no relatorio.';

-- --- o monitor de saude --------------------------------------------------------
-- Nasce com o motor, nao depois: coleta perdida e dado perdido para sempre, e
-- sem registro de execucao nao ha como saber que faltou.
do $$ begin
  create type ideworks.collection_outcome as enum ('running', 'ok', 'partial', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists ideworks.meta_collection_runs (
  id            uuid primary key default gen_random_uuid(),

  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  outcome       ideworks.collection_outcome not null default 'running',

  -- A janela reprocessada nesta execucao.
  window_from   date not null,
  window_to     date not null,

  assets_total  integer not null default 0,
  assets_ok     integer not null default 0,
  assets_failed integer not null default 0,
  rows_written  integer not null default 0,

  -- A primeira falha, para o alarme ter o que dizer. As demais ficam em
  -- `meta_assets.last_error`, cada uma no seu ativo.
  first_error   text,

  constraint runs_janela_coerente check (window_from <= window_to),
  constraint runs_terminou_com_desfecho check (
    (finished_at is null and outcome = 'running')
    or (finished_at is not null and outcome <> 'running')
  )
);

create index if not exists runs_recentes_idx on ideworks.meta_collection_runs (started_at desc);

comment on table ideworks.meta_collection_runs is
  'Livro de execucoes do motor. Existe desde a primeira versao porque coleta '
  'perdida e dado perdido PARA SEMPRE — sem registro, nao ha como saber que '
  'faltou. A restricao impede execucao "terminada" sem desfecho e desfecho sem '
  'termino.';

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.meta_daily_organic  enable row level security;
alter table ideworks.meta_daily_campaign enable row level security;
alter table ideworks.meta_collection_runs enable row level security;

-- Numero de cliente e do cliente: quem enxerga o cliente le a serie dele. A
-- ESCRITA nao tem politica de usuario nenhuma — quem escreve e o motor, que
-- roda com o papel do Worker fora de sessao de pessoa.
create policy organic_select on ideworks.meta_daily_organic for select
  using (exists (select 1 from ideworks.meta_assets a
                  where a.id = asset_id and ideworks.can_see_client(a.client_id)));

create policy campaign_select on ideworks.meta_daily_campaign for select
  using (exists (select 1 from ideworks.meta_assets a
                  where a.id = asset_id and ideworks.can_see_client(a.client_id)));

-- O livro de execucoes nao tem dado de cliente: e saude de sistema. Qualquer
-- pessoa identificada le, porque qualquer uma pode ser a que percebe que o
-- numero parou de atualizar.
create policy runs_select on ideworks.meta_collection_runs for select
  using (ideworks.acting_user_id() is not null);

-- --- a porta de escrita do motor ----------------------------------------------
-- NAO HA POLITICA DE INSERCAO NESTAS TRES TABELAS, e isso e deliberado: com RLS
-- ligada e sem politica, ninguem escreve por SQL comum — nem o papel do Worker.
-- A unica porta sao as funcoes abaixo.
--
-- E elas RECUSAM quando ha sessao de pessoa declarada. Metrica entra pelo motor
-- ou nao entra: se entrasse por sessao, bastaria uma rota mal escrita para
-- alguem forjar numero de cliente — e numero forjado numa serie historica e
-- indetectavel depois, porque nao ha com o que comparar.
create or replace function ideworks.assert_collector() returns void
  language plpgsql stable
  set search_path = ideworks, pg_temp
as $fn$
begin
  if ideworks.acting_user_id() is not null then
    raise exception 'metrica so entra pelo motor de coleta, nunca por sessao de pessoa'
      using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.upsert_organic_day(
  p_asset_id uuid,
  p_day      date,
  p_metrics  jsonb
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  -- As colunas conhecidas saem do jsonb por nome; o resto fica em `extra`. Uma
  -- metrica que a Meta aposentar simplesmente nao vem, e a coluna fica nula.
  insert into ideworks.meta_daily_organic (
    asset_id, day, reach, views, accounts_engaged, total_interactions,
    follows, unfollows, profile_links_taps, extra, collected_at
  )
  values (
    p_asset_id, p_day,
    (p_metrics->>'reach')::int,
    (p_metrics->>'views')::int,
    (p_metrics->>'accounts_engaged')::int,
    (p_metrics->>'total_interactions')::int,
    (p_metrics->>'follows')::int,
    (p_metrics->>'unfollows')::int,
    (p_metrics->>'profile_links_taps')::int,
    coalesce(p_metrics->'extra', '{}'::jsonb),
    now()
  )
  on conflict (asset_id, day) do update set
    reach = excluded.reach,
    views = excluded.views,
    accounts_engaged = excluded.accounts_engaged,
    total_interactions = excluded.total_interactions,
    follows = excluded.follows,
    unfollows = excluded.unfollows,
    profile_links_taps = excluded.profile_links_taps,
    extra = excluded.extra,
    collected_at = now();

end;
$fn$;

comment on function ideworks.upsert_organic_day(uuid, date, jsonb) is
  'Grava (ou regrava) o dia de uma conta. IDEMPOTENTE: reprocessar a janela de '
  '28 dias e a operacao normal, nao a excecao — numero de anuncio muda ate 28 '
  'dias depois. `collected_at` diz quando aquele dia foi confirmado pela ultima vez.';

create or replace function ideworks.upsert_campaign_day(
  p_asset_id      uuid,
  p_day           date,
  p_campaign_id   text,
  p_campaign_name text,
  p_metrics       jsonb
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  insert into ideworks.meta_daily_campaign (
    asset_id, day, campaign_id, campaign_name,
    spend, reach, impressions, clicks, link_clicks, conversions, conversion_value,
    extra, collected_at
  )
  values (
    p_asset_id, p_day, p_campaign_id, p_campaign_name,
    (p_metrics->>'spend')::numeric,
    (p_metrics->>'reach')::int,
    (p_metrics->>'impressions')::int,
    (p_metrics->>'clicks')::int,
    (p_metrics->>'link_clicks')::int,
    (p_metrics->>'conversions')::int,
    (p_metrics->>'conversion_value')::numeric,
    coalesce(p_metrics->'extra', '{}'::jsonb),
    now()
  )
  on conflict (asset_id, day, campaign_id) do update set
    campaign_name = excluded.campaign_name,
    spend = excluded.spend,
    reach = excluded.reach,
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    link_clicks = excluded.link_clicks,
    conversions = excluded.conversions,
    conversion_value = excluded.conversion_value,
    extra = excluded.extra,
    collected_at = now();
end;
$fn$;

-- --- o livro de execucoes -------------------------------------------------------
create or replace function ideworks.start_collection_run(p_from date, p_to date)
  returns uuid
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_id uuid;
begin
  perform ideworks.assert_collector();
  insert into ideworks.meta_collection_runs (window_from, window_to)
  values (p_from, p_to) returning id into v_id;
  return v_id;
end;
$fn$;

create or replace function ideworks.finish_collection_run(
  p_id            uuid,
  p_outcome       ideworks.collection_outcome,
  p_assets_total  integer,
  p_assets_ok     integer,
  p_assets_failed integer,
  p_rows_written  integer,
  p_first_error   text
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  if p_outcome = 'running' then
    raise exception 'uma execucao nao termina em "running"' using errcode = '22023';
  end if;

  update ideworks.meta_collection_runs
     set finished_at = now(), outcome = p_outcome,
         assets_total = p_assets_total, assets_ok = p_assets_ok,
         assets_failed = p_assets_failed, rows_written = p_rows_written,
         first_error = p_first_error
   where id = p_id;

  if not found then
    raise exception 'execucao nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;

-- Marca o ativo como visto, ou anota por que nao foi. E o que a tela de
-- conexoes mostra quando o dado para de chegar.
create or replace function ideworks.touch_asset(p_asset_id uuid, p_error text)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  update ideworks.meta_assets
     set last_seen_at = case when p_error is null then now() else last_seen_at end,
         last_error   = p_error,
         updated_at   = now()
   where id = p_asset_id;
end;
$fn$;

comment on function ideworks.touch_asset(uuid, text) is
  'Sucesso move `last_seen_at`; falha grava `last_error` e PRESERVA o '
  '`last_seen_at` antigo — porque "quando funcionou pela ultima vez" e a '
  'informacao que diz ha quanto tempo o dado parou.';

grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.upsert_organic_day(uuid, date, jsonb) to ideworks_app;
grant execute on function ideworks.upsert_campaign_day(uuid, date, text, text, jsonb) to ideworks_app;
grant execute on function ideworks.start_collection_run(date, date) to ideworks_app;
grant execute on function ideworks.finish_collection_run(
  uuid, ideworks.collection_outcome, integer, integer, integer, integer, text) to ideworks_app;
grant execute on function ideworks.touch_asset(uuid, text) to ideworks_app;
grant execute on function ideworks.assert_collector() to ideworks_app;
