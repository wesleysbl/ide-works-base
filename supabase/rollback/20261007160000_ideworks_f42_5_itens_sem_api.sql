-- Desfaz a F42_5: `dropbox_file_id` e `dropbox_rev` voltam a ser obrigatórios e a
-- restrição volta a exigir os dois não vazios (como na F42_3).
--
-- ⚠️ RECUSA se já houver item gravado sem identificador ou sem versão (todo envio
-- do piloto, que é só por link). O livro não se reescreve: inventar um
-- identificador mentiria sobre qual arquivo foi enviado. Para reverter mesmo
-- assim, decida antes o que fazer com essas rodadas (apagar os itens, ou
-- desfazer também a F42_3) — conte-os com:
--   select count(*) from ideworks.approval_round_items
--    where dropbox_file_id is null or dropbox_rev is null;
-- Depois: node scripts/conferir-schema.mjs --gravar.

begin;
set local lock_timeout = '5s';

do $do$
declare
  v_sem integer;
begin
  select count(*) into v_sem from ideworks.approval_round_items
   where dropbox_file_id is null or dropbox_rev is null;
  if v_sem > 0 then
    raise exception 'há % item(ns) de rodada sem identificador do Dropbox (envios só por link); o rollback não inventa um. Resolva esses itens antes.', v_sem
      using errcode = '55000';
  end if;
end
$do$;

alter table ideworks.approval_round_items
  drop constraint if exists approval_round_items_file_not_blank;
alter table ideworks.approval_round_items
  alter column dropbox_file_id set not null,
  alter column dropbox_rev set not null;
alter table ideworks.approval_round_items
  add constraint approval_round_items_file_not_blank
  check (btrim(file_name) <> '' and btrim(dropbox_file_id) <> '' and btrim(dropbox_rev) <> '');

comment on table ideworks.approval_round_items is
  'F42: o material de uma rodada, na ordem do carrossel. dropbox_file_id e dropbox_rev '
  'provam qual versão de cada arquivo foi enviada; dropbox_path é o caminho dentro '
  'do link quando o link é de pasta.';

commit;
