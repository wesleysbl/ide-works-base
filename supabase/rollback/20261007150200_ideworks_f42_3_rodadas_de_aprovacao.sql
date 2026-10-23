-- Desfaz a parte 3 da F42 Fase 1: rodadas, itens, a marca "do cliente" nos
-- comentários e o gatilho que cancela rodadas.
-- Desfaça antes a parte 4. ⚠️ Comentários escritos pelo cliente CONTINUAM no card
-- (sem autor), mas perdem a marca "do cliente" e o vínculo com a rodada; as
-- rodadas e os itens somem. Depois: node scripts/conferir-schema.mjs --gravar.
-- O gatilho de menções volta ao da F17.82 (antes de a coluna `from_client` sair,
-- porque a condição nova a lê).
begin;
set local lock_timeout = '5s';

drop trigger if exists task_comments_mentions_delete on ideworks.task_comments;
drop trigger if exists task_comments_mentions on ideworks.task_comments;
create trigger task_comments_mentions after insert or update of body or delete
  on ideworks.task_comments for each row execute function ideworks.sync_text_mentions();

drop trigger if exists task_comments_approval_coherent on ideworks.task_comments;
drop function if exists ideworks.task_comments_approval_coherent();

drop trigger if exists tasks_approval_rounds_cancel on ideworks.tasks;
drop function if exists ideworks.approval_rounds_cancel_on_task_change();

drop index if exists ideworks.task_comments_round_idx;
alter table ideworks.task_comments drop constraint if exists task_comments_item_needs_round;
alter table ideworks.task_comments drop constraint if exists task_comments_client_has_no_author;
alter table ideworks.task_comments
  drop column if exists approval_item_id,
  drop column if exists approval_round_id,
  drop column if exists from_client;

drop table if exists ideworks.approval_round_items;
drop table if exists ideworks.approval_rounds;

drop type if exists ideworks.approval_decision_via;
drop type if exists ideworks.approval_item_kind;
drop type if exists ideworks.approval_round_state;

commit;
