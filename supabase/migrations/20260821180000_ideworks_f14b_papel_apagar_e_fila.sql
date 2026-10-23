-- =============================================================================
-- IDE WORKS — F14b  Papel com hierarquia, apagar pessoa, e a fila
-- =============================================================================
-- AS QUATRO TRAVAS DE `set_user_role`, E O QUE CADA UMA IMPEDE
--
--   1. Só quem administra muda papel.
--   2. Só super admin CRIA super admin — sem isso um administrador se
--      promoveria e a hierarquia viraria enfeite.
--   3. Só super admin MEXE num super admin — sem isso um administrador
--      rebaixaria o dono e tomaria o lugar.
--   4. Ninguém muda o PRÓPRIO papel — o último super admin se trancaria para
--      fora, e não há conserto por dentro.
--
-- APAGAR: O QUE ISTO APAGA, E O QUE NÃO APAGA
--   Apaga o PERFIL do IDE Works, e com ele a carteira e as empresas por
--   cascata. A pessoa deixa de entrar aqui.
--
--   NÃO apaga de `auth.users`, e não pode: aquele cadastro é COMPARTILHADO com
--   o Sistema IDE em produção. Apagar de lá tiraria a pessoa do sistema antigo
--   também — que ninguém pediu, e que não teria volta.
--
-- A FILA NÃO É DE APROVAÇÃO
--   No legado qualquer um se cadastrava e alguém auditava depois. Aqui não há
--   autocadastro (decisão D3), então a fila é outra coisa: os convites que
--   existem e ainda não viraram conta.
--
--   Cancelar APAGA o convite em vez de marcar como cancelado: convite pendente
--   é um código vivo, e um registro "cancelado" que continuasse valendo seria o
--   pior dos dois mundos.
-- =============================================================================

create or replace function ideworks.set_user_role(
  p_user_id uuid, p_role ideworks.papel, p_has_all_clients boolean
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_alvo ideworks.papel;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra muda papel' using errcode = '42501';
  end if;

  select role into v_alvo from ideworks.profiles where id = p_user_id;
  if v_alvo is null then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  if p_role = 'super_admin' and not ideworks.acting_is_super() then
    raise exception 'so o super admin cria outro super admin' using errcode = '42501';
  end if;

  if v_alvo = 'super_admin' and not ideworks.acting_is_super() then
    raise exception 'so o super admin mexe em outro super admin' using errcode = '42501';
  end if;

  if p_user_id = ideworks.acting_user_id() and p_role <> v_alvo then
    raise exception 'voce nao pode mudar o proprio papel' using errcode = '42501';
  end if;

  update ideworks.profiles
     set role = p_role, has_all_clients_access = p_has_all_clients, updated_at = now()
   where id = p_user_id;
end;
$fn$;

create or replace function ideworks.delete_user(p_user_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_alvo ideworks.papel;
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin apaga pessoa' using errcode = '42501';
  end if;

  if p_user_id = ideworks.acting_user_id() then
    raise exception 'voce nao pode apagar a si mesmo' using errcode = '42501';
  end if;

  select role into v_alvo from ideworks.profiles where id = p_user_id;
  if v_alvo is null then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  -- So o perfil. Ver o cabecalho sobre `auth.users`.
  delete from ideworks.profiles where id = p_user_id;
end;
$fn$;

drop function if exists ideworks.admin_directory();
create function ideworks.admin_directory()
  returns table (
    id uuid, email text, full_name text,
    role ideworks.papel,
    is_superadmin boolean, is_active boolean, has_all_clients_access boolean,
    areas ideworks.area[], clientes integer, empresas integer,
    created_at timestamptz
  )
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve a lista de pessoas' using errcode = '42501';
  end if;

  return query
    select p.id, p.email, p.full_name, p.role,
           p.is_superadmin, p.is_active, p.has_all_clients_access, p.areas,
           (select count(*)::int from ideworks.user_clients uc where uc.user_id = p.id),
           (select count(*)::int from ideworks.user_categories ucat where ucat.user_id = p.id),
           p.created_at
      from ideworks.profiles p
     order by p.role, p.is_active desc, lower(coalesce(p.full_name, p.email));
end;
$fn$;

create or replace function ideworks.admin_user_categories(p_user_id uuid)
  returns table (category_id uuid, name text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve as empresas de outra pessoa' using errcode = '42501';
  end if;

  return query
    select c.id, c.name
      from ideworks.user_categories uc
      join ideworks.client_categories c on c.id = uc.category_id
     where uc.user_id = p_user_id
     order by lower(c.name);
end;
$fn$;

create or replace function ideworks.admin_pending_invitations()
  returns table (
    id uuid, email text, expires_at timestamptz,
    failed_attempts integer, created_at timestamptz, vencido boolean
  )
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve a fila' using errcode = '42501';
  end if;

  return query
    select i.id, i.email, i.expires_at, i.failed_attempts, i.created_at,
           i.expires_at < now()
      from ideworks.invitations i
     where i.status = 'pending'
     order by i.created_at desc;
end;
$fn$;

create or replace function ideworks.revoke_invitation(p_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra cancela convite' using errcode = '42501';
  end if;

  delete from ideworks.invitations where id = p_id and status = 'pending';

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
  end if;
end;
$fn$;

-- A ASSINATURA ANTIGA MORRE.
--
-- Deixar as duas faria o app chamar a de booleano sem erro nenhum, e a
-- hierarquia inteira viraria enfeite — foi exatamente o que aconteceu na F9h
-- com `meta_assets_para_coleta`.
drop function if exists ideworks.set_user_role(uuid, boolean, boolean);

grant execute on function ideworks.set_user_role(uuid, ideworks.papel, boolean) to ideworks_app;
grant execute on function ideworks.delete_user(uuid) to ideworks_app;
grant execute on function ideworks.admin_directory() to ideworks_app;
grant execute on function ideworks.admin_user_categories(uuid) to ideworks_app;
grant execute on function ideworks.admin_pending_invitations() to ideworks_app;
grant execute on function ideworks.revoke_invitation(uuid) to ideworks_app;
