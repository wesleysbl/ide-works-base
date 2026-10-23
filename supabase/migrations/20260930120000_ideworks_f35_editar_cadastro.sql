-- Comando protegido enviado pelo Worker na Admin API do Auth. A atualização
-- local acontece dentro da transação do Auth: qualquer recusa desfaz TUDO.
-- user_metadata não é lido. Fluxos do Auth que não mudam este comando não
-- executam nenhuma escrita no IdeWorks. Não altera perfis de outros sistemas.
create or replace function ideworks.apply_profile_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  comando jsonb := new.raw_app_meta_data -> 'ideworks_profile_edit';
  ator ideworks.profiles%rowtype;
  alvo ideworks.profiles%rowtype;
  v_nome text;
  v_email text;
begin
  if comando is null or comando is not distinct from (old.raw_app_meta_data -> 'ideworks_profile_edit') then return new; end if;
  if jsonb_typeof(comando) <> 'object' or nullif(comando ->> 'request_id', '') is null then
    raise exception 'Comando de cadastro inválido' using errcode = '22023';
  end if;
  select * into ator from ideworks.profiles where id = (comando ->> 'actor_id')::uuid for share;
  if not found or not ator.is_active or ator.role::text <> 'super_admin' then
    raise exception 'Só um superadministrador ativo pode editar o cadastro' using errcode = '42501';
  end if;
  select * into alvo from ideworks.profiles where id = new.id for update;
  if not found then raise exception 'Pessoa não encontrada' using errcode = 'P0002'; end if;
  v_nome := btrim(comando ->> 'nome');
  v_email := lower(btrim(comando ->> 'email'));
  if v_nome is null or length(v_nome) not between 1 and 160 or v_email is null
     or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or lower(new.email) is distinct from v_email then
    raise exception 'Nome ou e-mail inválido' using errcode = '22023';
  end if;
  if alvo.full_name = v_nome and alvo.email = v_email then return new; end if;
  if not (comando ? 'anterior') or not ((comando -> 'anterior') ? 'nome')
     or alvo.full_name is distinct from (comando #>> '{anterior,nome}')
     or alvo.email is distinct from (comando #>> '{anterior,email}') then
    raise exception 'O cadastro mudou; reabra antes de editar' using errcode = '40001';
  end if;
  if exists(select 1 from ideworks.profiles where id <> new.id and lower(profiles.email) = v_email) then
    raise exception 'E-mail já utilizado' using errcode = '23505';
  end if;
  update ideworks.profiles set full_name = v_nome, email = v_email, updated_at = now() where id = new.id;
  if alvo.email is distinct from v_email then
    -- Códigos emitidos para o endereço antigo não continuam utilizáveis.
    update ideworks.invitations set status = 'revoked'
      where lower(invitations.email) in (lower(alvo.email), v_email) and status = 'pending';
  end if;
  insert into ideworks.admin_audit(actor_id, actor_email, action, target_id, target_email, context)
    values(ator.id, ator.email, 'edit_profile', new.id, v_email,
      jsonb_build_object('nome_anterior', alvo.full_name, 'email_anterior', alvo.email, 'nome', v_nome, 'email', v_email));
  return new;
end;
$$;
revoke all on function ideworks.apply_profile_edit() from public, anon, authenticated, ideworks_app;
drop trigger if exists ideworks_profile_edit on auth.users;
create trigger ideworks_profile_edit after update of raw_app_meta_data on auth.users
for each row execute function ideworks.apply_profile_edit();
