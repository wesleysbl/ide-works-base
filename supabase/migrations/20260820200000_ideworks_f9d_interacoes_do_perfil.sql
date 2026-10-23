-- =============================================================================
-- IDE WORKS — F9d  Curtidas, comentários, compartilhamentos e salvos
-- =============================================================================
-- O QUE ESTAVA ERRADO, E ERA PIOR DO QUE "FALTAVA COLUNA"
--   A coleta JÁ PEDIA essas quatro métricas à Meta em toda execução. Elas
--   chegavam, e a função de gravação simplesmente não as mapeava — e `extra`
--   recebia só `p_metrics->'extra'`, então tudo o que não tinha coluna era
--   descartado em silêncio.
--
--   Conferido em 2026-08-20: `extra` tinha UMA chave em 588 linhas
--   (`follows_and_unfollows`). Curtidas, comentários, compartilhamentos e
--   salvos foram buscados 588 vezes e jogados fora 588 vezes.
--
--   Eu tinha dito ao usuário que estavam "em extra". Não estavam.
--
-- A CORREÇÃO DE FUNDO
--   Não basta acrescentar as quatro colunas: enquanto `extra` receber só o que
--   se chama `extra`, a próxima métrica nova some do mesmo jeito. Agora sobra
--   para `extra` tudo o que não foi mapeado — `p_metrics - conhecidas`.
--
--   Métrica nova da Meta passa a ser guardada sozinha, e promovê-la a coluna
--   vira uma migration em vez de uma recoleta impossível.
--
-- AS QUATRO SÃO SALDO
--   Como `total_interactions`, elas podem ser negativas: a Meta desconta o que
--   foi desfeito. Ficam fora da restrição de não-negativo. Alcance,
--   visualizações, contas engajadas, toques e seguidores continuam barrados —
--   nenhum deles pode diminuir dentro de um dia.
-- =============================================================================

alter table ideworks.meta_daily_organic add column if not exists likes    integer;
alter table ideworks.meta_daily_organic add column if not exists comments integer;
alter table ideworks.meta_daily_organic add column if not exists shares   integer;
alter table ideworks.meta_daily_organic add column if not exists saves    integer;

comment on column ideworks.meta_daily_organic.saves is
  'SALDO do dia: negativo quando mais gente removeu o salvamento do que salvou. '
  'Medido em 2026-08-20 — foi o que derrubou a primeira coleta. Ver F7f.';

alter table ideworks.meta_daily_organic drop constraint organic_nao_negativo;
alter table ideworks.meta_daily_organic add constraint organic_nao_negativo check (
  coalesce(reach, 0) >= 0
  and coalesce(views, 0) >= 0
  and coalesce(accounts_engaged, 0) >= 0
  and coalesce(follows, 0) >= 0
  and coalesce(unfollows, 0) >= 0
  and coalesce(profile_links_taps, 0) >= 0
);

create or replace function ideworks.upsert_organic_day(
  p_asset_id uuid, p_day date, p_metrics jsonb
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_conhecidas constant text[] := array[
    'reach','views','accounts_engaged','total_interactions','follows','unfollows',
    'profile_links_taps','likes','comments','shares','saves','extra'
  ];
  v_extra jsonb;
begin
  perform ideworks.assert_collector();

  -- O QUE NAO TEM COLUNA NAO SE PERDE MAIS. Ver o cabecalho.
  v_extra := coalesce(p_metrics->'extra', '{}'::jsonb)
             || (p_metrics - v_conhecidas);

  insert into ideworks.meta_daily_organic (
    asset_id, day, reach, views, accounts_engaged, total_interactions,
    follows, unfollows, profile_links_taps, likes, comments, shares, saves,
    extra, collected_at
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
    (p_metrics->>'likes')::int,
    (p_metrics->>'comments')::int,
    (p_metrics->>'shares')::int,
    (p_metrics->>'saves')::int,
    v_extra,
    now()
  )
  on conflict (asset_id, day) do update set
    reach = excluded.reach, views = excluded.views,
    accounts_engaged = excluded.accounts_engaged,
    total_interactions = excluded.total_interactions,
    follows = excluded.follows, unfollows = excluded.unfollows,
    profile_links_taps = excluded.profile_links_taps,
    likes = excluded.likes, comments = excluded.comments,
    shares = excluded.shares, saves = excluded.saves,
    extra = excluded.extra, collected_at = now();
end;
$fn$;
