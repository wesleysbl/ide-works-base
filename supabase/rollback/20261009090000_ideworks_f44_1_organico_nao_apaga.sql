-- Desfaz a F44_1: `upsert_organic_day` volta à F10f, sem mudança — o corpo como
-- está no banco antes da F44_1 (com o comentário do conflito que o retrato
-- `schema-esperado.json` registra), mesma assinatura, segurança e permissões.
--
-- ⚠️ VOLTA O DEFEITO: regravar o dia só com o alcance grava NULL em todas as
-- outras métricas. Com o Worker SEM o paliativo no ar (F44, Fase 2), cada coleta
-- (15 min) apaga as métricas dos dias com mais de 7 dias. Reverta a publicação
-- do Worker ANTES, para a versão com o paliativo `gravarDiasOrganicos` (PR #2).
--
-- Não há dado a desfazer: a F44_1 só mudou a regra de regravar. O que ela
-- manteve nas linhas continua lá.
--
-- Depois: node scripts/conferir-schema.mjs --gravar.

begin;
set local lock_timeout = '5s';

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
    -- COALESCE nestes dois, e nao substituicao seca: eles so vem carimbados no
    -- ULTIMO dia da janela. Uma coleta que reprocessa um dia antigo nao traria
    -- os campos, e a substituicao apagaria o total que ja estava la.
    followers_total = coalesce(excluded.followers_total, ideworks.meta_daily_organic.followers_total),
    media_count     = coalesce(excluded.media_count,     ideworks.meta_daily_organic.media_count),
    extra = excluded.extra, collected_at = now();
end;
$fn$;

grant execute on function ideworks.upsert_organic_day(uuid, date, jsonb) to ideworks_app;

commit;
