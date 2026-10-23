-- Desfaz a F9d. AVISO: volta a descartar em silêncio toda métrica sem coluna.
alter table ideworks.meta_daily_organic drop column if exists likes;
alter table ideworks.meta_daily_organic drop column if exists comments;
alter table ideworks.meta_daily_organic drop column if exists shares;
alter table ideworks.meta_daily_organic drop column if exists saves;

create or replace function ideworks.upsert_organic_day(
  p_asset_id uuid, p_day date, p_metrics jsonb
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  insert into ideworks.meta_daily_organic (
    asset_id, day, reach, views, accounts_engaged, total_interactions,
    follows, unfollows, profile_links_taps, extra, collected_at
  ) values (
    p_asset_id, p_day,
    (p_metrics->>'reach')::int, (p_metrics->>'views')::int,
    (p_metrics->>'accounts_engaged')::int, (p_metrics->>'total_interactions')::int,
    (p_metrics->>'follows')::int, (p_metrics->>'unfollows')::int,
    (p_metrics->>'profile_links_taps')::int,
    coalesce(p_metrics->'extra', '{}'::jsonb), now()
  )
  on conflict (asset_id, day) do update set
    reach = excluded.reach, views = excluded.views,
    accounts_engaged = excluded.accounts_engaged,
    total_interactions = excluded.total_interactions,
    follows = excluded.follows, unfollows = excluded.unfollows,
    profile_links_taps = excluded.profile_links_taps,
    extra = excluded.extra, collected_at = now();
end;
$fn$;
