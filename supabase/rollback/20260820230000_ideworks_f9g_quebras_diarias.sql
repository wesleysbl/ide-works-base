-- Desfaz a F9g.
--
-- Nao remove o valor 'age_gender' do enum: o Postgres nao apaga valor de enum,
-- e um valor a mais nao usado nao faz mal.
drop function if exists ideworks.upsert_daily_breakdown(uuid, date, text, text, jsonb);
drop table if exists ideworks.meta_daily_breakdown;
