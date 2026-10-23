begin;
drop function ideworks.finish_expired_attachment(uuid, text);
drop function ideworks.expired_attachments();
drop trigger fix_attachment_expiration on ideworks.task_attachments;
drop function ideworks.fix_attachment_expiration();
alter table ideworks.task_attachments drop column expires_at;
commit;
