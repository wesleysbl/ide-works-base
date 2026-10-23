-- Desfaz a F4.10. Ordem inversa da aplicacao.
--
-- ATENCAO: apaga as notas do mural e as gravacoes registradas.

drop policy if exists video_captures_write  on ideworks.video_captures;
drop policy if exists video_captures_select on ideworks.video_captures;
drop policy if exists mural_notes_write  on ideworks.mural_notes;
drop policy if exists mural_notes_select on ideworks.mural_notes;

drop index if exists ideworks.video_captures_client_idx;
drop table if exists ideworks.video_captures;

drop index if exists ideworks.mural_notes_client_idx;
drop table if exists ideworks.mural_notes;

-- Os tipos saem por ultimo: enquanto houver coluna usando, o drop e recusado.
drop type if exists ideworks.capture_kind;
drop type if exists ideworks.capture_status;
drop type if exists ideworks.note_color;
