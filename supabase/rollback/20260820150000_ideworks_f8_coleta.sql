-- Desfaz a F8. Ordem inversa da aplicacao.
--
-- ATENCAO: APAGA A SERIE HISTORICA. Este e o unico rollback do projeto que
-- destroi dado impossivel de recuperar: a Meta guarda metrica de usuario por 90
-- dias, demografia por 30 e story por 24 horas. O que sair daqui nao volta por
-- coleta nenhuma.

drop function if exists ideworks.touch_asset(uuid, text);
drop function if exists ideworks.finish_collection_run(
  uuid, ideworks.collection_outcome, integer, integer, integer, integer, text);
drop function if exists ideworks.start_collection_run(date, date);
drop function if exists ideworks.upsert_campaign_day(uuid, date, text, text, jsonb);
drop function if exists ideworks.upsert_organic_day(uuid, date, jsonb);
drop function if exists ideworks.assert_collector();

drop policy if exists runs_select     on ideworks.meta_collection_runs;
drop policy if exists campaign_select on ideworks.meta_daily_campaign;
drop policy if exists organic_select  on ideworks.meta_daily_organic;

drop table if exists ideworks.meta_collection_runs;
drop type  if exists ideworks.collection_outcome;
drop table if exists ideworks.meta_daily_campaign;
drop table if exists ideworks.meta_daily_organic;
