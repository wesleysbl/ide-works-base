-- Desfaz a F9f.
--
-- AVISO: apaga os STORIES guardados, e eles não voltam — a Meta os descarta em
-- 24 horas, e depois disso a nossa linha era a única cópia que existia.
drop function if exists ideworks.upsert_media(
  uuid, text, ideworks.media_product, text, text, text, text, timestamptz, jsonb);
drop table if exists ideworks.meta_media;
drop type if exists ideworks.media_product;
