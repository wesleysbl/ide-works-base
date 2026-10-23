-- Publicar primeiro a versão anterior do Worker. O rollback remove os avisos
-- de menção; preserva os textos das tarefas e comentários.
begin;
drop trigger if exists tasks_mentions on ideworks.tasks;
drop trigger if exists task_comments_mentions on ideworks.task_comments;
drop trigger if exists task_checklists_mentions on ideworks.task_checklists;
drop trigger if exists checklist_items_mentions on ideworks.checklist_items;
drop function if exists ideworks.sync_text_mentions();
drop table if exists ideworks.task_mentions;
drop function if exists ideworks.mentionable_people(uuid, uuid);
drop function if exists ideworks.can_mention_person(uuid, uuid, uuid);
drop function if exists ideworks.mentioned_people(text);
commit;
