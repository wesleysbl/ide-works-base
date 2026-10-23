-- Publicar primeiro a versão anterior do Worker. Remove avisos de menção do
-- chat; preserva o texto das mensagens.
begin;

drop trigger if exists messages_chat_mentions on ideworks.messages;
drop function if exists ideworks.sync_chat_mentions();
drop table if exists ideworks.chat_mentions;
drop function if exists ideworks.mentionable_people_in_chat(uuid);
drop function if exists ideworks.can_mention_in_conversation(uuid, uuid);

commit;
