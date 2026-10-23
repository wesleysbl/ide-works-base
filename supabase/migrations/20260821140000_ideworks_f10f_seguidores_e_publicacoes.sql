-- =============================================================================
-- IDE WORKS — F10f  Seguidores e publicações
-- =============================================================================
-- NÃO SÃO MÉTRICA DE DIA, SÃO O ESTADO DO PERFIL
--   A Meta devolve os dois num campo direto, sem insight nenhum. Vão carimbados
--   no ÚLTIMO dia da janela de cada coleta — e é isso que os transforma em
--   série.
--
--   `follows` dá o GANHO do dia. O TOTAL de ontem a Meta não devolve nunca.
--   Então a curva de crescimento de seguidores só passa a existir porque
--   guardamos um retrato por coleta. Sem isso, a pergunta "cresceu quanto neste
--   trimestre?" fica sem resposta para sempre.
--
-- POR QUE `coalesce` NO CONFLITO, E NÃO SUBSTITUIÇÃO SECA
--   Os dois campos só vêm no último dia da janela. Uma coleta que reprocessa um
--   dia antigo não os traz, e a substituição seca apagaria o total que já
--   estava gravado ali. `coalesce` mantém.
--
-- ELES ENTRAM NA RESTRIÇÃO DE NÃO-NEGATIVO
--   Diferente das colunas de interação, que são SALDO e podem ser negativas,
--   estes dois são TOTAIS. Total negativo é defeito, não informação.
-- =============================================================================

alter table ideworks.meta_daily_organic add column if not exists followers_total integer;
alter table ideworks.meta_daily_organic add column if not exists media_count     integer;

comment on column ideworks.meta_daily_organic.followers_total is
  'O TOTAL de seguidores no dia da coleta — nao o ganho. E o que constroi a '
  'curva de crescimento: a Meta nao a devolve. `follower_count` da o ganho do '
  'dia e nunca o total de ontem, entao a serie so existe se for nossa.';

comment on column ideworks.meta_daily_organic.media_count is
  'Quantas publicacoes o perfil tem no dia da coleta.';

alter table ideworks.meta_daily_organic drop constraint organic_nao_negativo;
alter table ideworks.meta_daily_organic add constraint organic_nao_negativo check (
  coalesce(reach, 0) >= 0
  and coalesce(views, 0) >= 0
  and coalesce(accounts_engaged, 0) >= 0
  and coalesce(follows, 0) >= 0
  and coalesce(unfollows, 0) >= 0
  and coalesce(profile_links_taps, 0) >= 0
  and coalesce(followers_total, 0) >= 0
  and coalesce(media_count, 0) >= 0
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
    'profile_links_taps','likes','comments','shares','saves',
    'followers_total','media_count','extra'
  ];
  v_extra jsonb;
begin
  perform ideworks.assert_collector();

  v_extra := coalesce(p_metrics->'extra', '{}'::jsonb)
             || (p_metrics - v_conhecidas);

  insert into ideworks.meta_daily_organic (
    asset_id, day, reach, views, accounts_engaged, total_interactions,
    follows, unfollows, profile_links_taps, likes, comments, shares, saves,
    followers_total, media_count, extra, collected_at
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
    (p_metrics->>'followers_total')::int,
    (p_metrics->>'media_count')::int,
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
    followers_total = coalesce(excluded.followers_total, ideworks.meta_daily_organic.followers_total),
    media_count     = coalesce(excluded.media_count,     ideworks.meta_daily_organic.media_count),
    extra = excluded.extra, collected_at = now();
end;
$fn$;
