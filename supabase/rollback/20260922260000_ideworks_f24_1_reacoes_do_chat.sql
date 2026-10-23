-- Reversão da F24.1 — as reações do chat.
-- Publicar primeiro a versão anterior do Worker. Apaga todas as reações
-- gravadas; preserva as mensagens e tudo mais do chat.
begin;

drop function if exists ideworks.list_chat_reaction_changes(uuid, timestamptz);
drop function if exists ideworks.list_chat_reactions(uuid, uuid[]);
drop function if exists ideworks.toggle_chat_reaction(uuid, ideworks.chat_reaction_emoji);
drop table if exists ideworks.chat_reactions;
drop type if exists ideworks.chat_reaction_emoji;

commit;
