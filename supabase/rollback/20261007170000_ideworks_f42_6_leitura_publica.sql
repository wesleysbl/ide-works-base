-- Desfaz a F42_6: as leituras e o comentário do cliente pelo link, e o limite de
-- pedidos da rota pública. Os comentários que o cliente já escreveu FICAM no card
-- (são linhas de `task_comments`, da F42_3). A contagem de pedidos some junto.
-- Com isto desfeito, a rota pública do Worker responde 500 até voltar à versão
-- anterior: reverta a publicação ANTES deste rollback.
-- Depois: node scripts/conferir-schema.mjs --gravar.

begin;
set local lock_timeout = '5s';

drop function if exists ideworks.approval_link_rate_hit(text, text, text, integer, integer, integer);
drop table if exists ideworks.approval_link_rate_events;
drop function if exists ideworks.comment_approval_round(text, uuid, uuid, text);
drop function if exists ideworks.public_approval_round(text, uuid);
drop function if exists ideworks.public_approval_page(text);
drop function if exists ideworks.approval_round_public_json(uuid);

commit;
