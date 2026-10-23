-- Só novos prints da conversa recebem prazo; anexos existentes continuam permanentes.
begin;
alter table ideworks.task_attachments add column expires_at timestamptz;
alter table ideworks.task_attachments add constraint task_attachments_temporary_image
  check (expires_at is null or content_type in ('image/png', 'image/jpeg'));
create index task_attachments_expiration_idx on ideworks.task_attachments (expires_at, id)
  where expires_at is not null;

-- O prazo nasce no servidor e não pode ser renovado por uma edição concorrente.
create function ideworks.fix_attachment_expiration() returns trigger
language plpgsql set search_path = ideworks, pg_temp as $fn$
begin
  if TG_OP = 'INSERT' then
    if new.expires_at is not null then new.expires_at := now() + interval '240 hours'; end if;
  elsif new.expires_at is distinct from old.expires_at
     or (old.expires_at is not null and new.storage_path is distinct from old.storage_path) then
    raise exception 'O prazo e o arquivo de uma imagem temporária não podem ser alterados.';
  end if;
  return new;
end;
$fn$;
create trigger fix_attachment_expiration before insert or update on ideworks.task_attachments
  for each row execute function ideworks.fix_attachment_expiration();
revoke all on function ideworks.fix_attachment_expiration() from public, anon, authenticated;

-- Funções internas do Worker, sem sessão de pessoa, como o coletor existente.
-- O papel restrito só lista vencidos e só confirma exclusão de um vencido.
create function ideworks.expired_attachments() returns table (id uuid, storage_path text)
language plpgsql security definer set search_path = ideworks, pg_temp as $fn$
begin
  perform ideworks.assert_collector();
  return query select a.id, a.storage_path from ideworks.task_attachments a
    where a.expires_at <= now() order by a.expires_at, a.id limit 100;
end;
$fn$;
create function ideworks.finish_expired_attachment(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = ideworks, pg_temp as $fn$
begin
  perform ideworks.assert_collector();
  delete from ideworks.task_attachments
    where id = p_id and storage_path = p_path and expires_at <= now();
end;
$fn$;
revoke all on function ideworks.expired_attachments() from public, anon, authenticated;
revoke all on function ideworks.finish_expired_attachment(uuid, text) from public, anon, authenticated;
grant execute on function ideworks.expired_attachments() to ideworks_app;
grant execute on function ideworks.finish_expired_attachment(uuid, text) to ideworks_app;
commit;
