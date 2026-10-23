-- Desfaz a F10a.
--
-- AVISO: apaga a serie por criativo. A Meta so devolve dentro da janela dela —
-- o que estiver fora nao volta.
drop function if exists ideworks.upsert_daily_ad(uuid, date, text, text, jsonb);
drop function if exists ideworks.upsert_ad(uuid, text, text, text, text, text, text, text);
drop function if exists ideworks.upsert_campaign(uuid, text, text, text, text, text);
drop table if exists ideworks.meta_daily_ad;
drop table if exists ideworks.meta_ads;
drop table if exists ideworks.meta_campaigns;
