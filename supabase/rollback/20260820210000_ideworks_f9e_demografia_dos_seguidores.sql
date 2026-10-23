-- Desfaz a F9e. AVISO: apaga a série de demografia, e ela não se recupera —
-- a Meta só responde "como está agora".
drop function if exists ideworks.upsert_follower_demographics(
  uuid, date, ideworks.demographic_dimension, jsonb);
drop table if exists ideworks.meta_follower_demographics;
drop type if exists ideworks.demographic_dimension;
