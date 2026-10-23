-- =============================================================================
-- ROLLBACK da F11d — links, etiquetas, historico, captacoes, mural e tarefas
-- =============================================================================
-- Apaga a ponte, nao o dado. Mesma regra da F11a e da F11b.
--
-- Para esvaziar o que foi migrado, os `delete` correspondentes usam o id de
-- origem como chave — o mesmo que torna a migracao repetivel:
--
--   -- delete from ideworks.client_links      where id in (select id from public.client_links);
--   -- delete from ideworks.client_history    where id in (select id from public.client_history);
--   -- delete from ideworks.video_captures    where id in (select id from public.video_captures);
--   -- delete from ideworks.mural_notes       where id in (select id from public.client_notes);
--   -- delete from ideworks.tasks             where id in (select id from public.demands);
--   -- delete from ideworks.client_tag_assignments a
--   --  using public.client_tag_assignments o
--   --  where a.client_id = o.client_id and a.tag_id = o.tag_id;
--   -- delete from ideworks.client_tags       where id in (select id from public.client_tags);
--
-- O legado nunca e tocado por nada disto.
-- =============================================================================

drop function if exists ideworks.migrar_o_resto(boolean);
drop function if exists ideworks.migracao_resto_previa(boolean);
