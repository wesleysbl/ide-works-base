-- Desfaz a F10f.
--
-- AVISO: apaga a curva de crescimento de seguidores, e ela NAO se recupera — a
-- Meta so devolve o ganho do dia, nunca o total de ontem.
alter table ideworks.meta_daily_organic drop column if exists followers_total;
alter table ideworks.meta_daily_organic drop column if exists media_count;
