-- Desfaz a F13: todo mundo volta a alcancar todas as areas.
--
-- AVISO: nao ha meio-termo. Sem a coluna, a conferencia de area some e quem
-- entrar ve todas as telas — limitado so pela carteira de clientes.
drop function if exists ideworks.set_user_areas(uuid, ideworks.area[]);
drop function if exists ideworks.acting_areas();
drop function if exists ideworks.acting_can(ideworks.area);

drop function if exists ideworks.admin_directory();
create function ideworks.admin_directory()
  returns table (
    id uuid, email text, full_name text, is_superadmin boolean, is_active boolean,
    has_all_clients_access boolean, clientes integer, created_at timestamptz
  )
  language plpgsql stable security definer set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador ve a lista de pessoas' using errcode = '42501';
  end if;
  return query
    select p.id, p.email, p.full_name, p.is_superadmin, p.is_active,
           p.has_all_clients_access,
           (select count(*)::int from ideworks.user_clients uc where uc.user_id = p.id),
           p.created_at
      from ideworks.profiles p
     order by p.is_active desc, lower(coalesce(p.full_name, p.email));
end;
$fn$;
grant execute on function ideworks.admin_directory() to ideworks_app;

alter table ideworks.profiles drop column if exists areas;
drop type if exists ideworks.area;
