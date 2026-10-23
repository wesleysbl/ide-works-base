-- Desfaz a F14.
--
-- AVISO: a separacao por empresa some. Todo mundo volta a enxergar pela
-- carteira individual, e quem so tinha empresa fica sem cliente nenhum.
drop function if exists ideworks.set_user_categories(uuid, uuid[]);
drop function if exists ideworks.acting_is_super();

create or replace function ideworks.can_see_client(target uuid)
  returns boolean language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_superadmin()
      or exists (select 1 from ideworks.profiles p
                  where p.id = ideworks.acting_user_id() and p.has_all_clients_access)
      or exists (select 1 from ideworks.user_clients uc
                  where uc.client_id = target and uc.user_id = ideworks.acting_user_id())
$fn$;

drop table if exists ideworks.user_categories;

alter table ideworks.profiles drop column is_superadmin;
alter table ideworks.profiles add column is_superadmin boolean not null default false;
update ideworks.profiles set is_superadmin = (role in ('super_admin','admin'));
alter table ideworks.profiles drop column role;
drop type if exists ideworks.papel;
