-- Desfaz a F20.1. Nome identico ao da migration, de proposito.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F16/F17: schema sem conversa de chat nenhuma.
--
--   ⚠️ REVERTER APAGA TODAS AS CONVERSAS E MEMBROS. Nao ha mensagem ainda
--   nesta etapa, mas os grupos e diretas criados somem sem recuperacao.
--
-- A ORDEM
--   Tabelas primeiro (as politicas caem com elas e liberam as funcoes de
--   alcance), depois funcoes de dominio, auxiliares e enums.
--
-- O QUE O ROLLBACK NAO ALCANCA
--   `team_directory`, `profiles`, `public` e `auth` — nenhum foi tocado.

drop table if exists ideworks.conversation_read_marks;
drop table if exists ideworks.conversation_members;
drop table if exists ideworks.conversations;

drop function if exists ideworks.chat_directory();
drop function if exists ideworks.open_direct_conversation(uuid);
drop function if exists ideworks.transfer_conversation_ownership(uuid, uuid);
drop function if exists ideworks.leave_conversation(uuid);
drop function if exists ideworks.remove_conversation_member(uuid, uuid);
drop function if exists ideworks.add_conversation_member(uuid, uuid);
drop function if exists ideworks.rename_conversation(uuid, text);
drop function if exists ideworks.create_group_conversation(text, uuid[]);

drop function if exists ideworks.chat_pass_ownership_if_needed(uuid, uuid);
drop function if exists ideworks.chat_archive_if_empty(uuid);
drop function if exists ideworks.chat_actor_manages(uuid);
drop function if exists ideworks.chat_person_is_active(uuid);
drop function if exists ideworks.chat_require_actor();

drop function if exists ideworks.can_reach_conversation(uuid);
drop function if exists ideworks.can_reach_conversation_uncached(uuid);

drop type if exists ideworks.conversation_member_role;
drop type if exists ideworks.conversation_kind;
