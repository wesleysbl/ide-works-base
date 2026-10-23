-- =============================================================================
-- IDE WORKS — F12  Administração de pessoas
-- =============================================================================
-- A LACUNA
--   O convite existia desde a F1: dava para trazer alguém para dentro. Não
--   existia nada para ver quem já estava, mudar papel, ativar, desativar, ou
--   dizer de quais clientes a pessoa cuida. Tudo isso vivia só como linha de
--   tabela, alcançável por quem soubesse escrever SQL.
--
-- POR QUE FUNÇÃO COM DONO, E NÃO POLÍTICA DE LINHA
--   `profiles_select` mostra só o PRÓPRIO perfil, e isso é deliberado desde a
--   F1 — ninguém precisa da lista de colegas para trabalhar. Administrar exige
--   ver todo mundo, e afrouxar a política daria essa visão a todos.
--
--   Função com dono resolve: ela confere o papel e só então responde. A
--   política continua fechada.
--
-- A REGRA QUE IMPEDE O TRANCO
--   Se o único administrador tirasse o próprio papel, ou se desativasse,
--   ninguém mais poderia administrar — e NÃO HÁ CONSERTO POR DENTRO, porque só
--   administrador muda papel. `auth.users` é compartilhado com o legado, então
--   também não dá para criar um administrador por fora.
--
--   A regra é sobre SI MESMO, e isso basta: com dois administradores, um pode
--   rebaixar o outro e continua havendo um. Nunca chega a zero.
--
-- A CARTEIRA SE DEFINE INTEIRA, NÃO EM PEDAÇOS
--   `set_user_clients` substitui. A tela mostra a carteira completa e manda a
--   completa de volta. Acrescentar exigiria uma segunda operação para remover,
--   e duas operações para um gesto é onde nasce o estado meio-salvo — a pessoa
--   fecha a tela no meio e fica com metade da carteira nova e metade da velha.
-- =============================================================================

create or replace function ideworks.admin_directory()
  returns table (
    id uuid,
    email text,
    full_name text,
    is_superadmin boolean,
    is_active boolean,
    has_all_clients_access boolean,
    clientes integer,
    created_at timestamptz
  )
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
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

create or replace function ideworks.admin_user_clients(p_user_id uuid)
  returns table (client_id uuid, name text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador ve a carteira de outra pessoa' using errcode = '42501';
  end if;

  return query
    select c.id, c.name
      from ideworks.user_clients uc
      join ideworks.clients c on c.id = uc.client_id
     where uc.user_id = p_user_id
     order by lower(c.name);
end;
$fn$;

create or replace function ideworks.set_user_role(
  p_user_id uuid, p_is_superadmin boolean, p_has_all_clients boolean
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador muda papel' using errcode = '42501';
  end if;

  -- NINGUEM SE REBAIXA. Ver o cabecalho.
  if p_user_id = ideworks.acting_user_id() and not p_is_superadmin then
    raise exception 'voce nao pode tirar o proprio papel de administrador'
      using errcode = '42501';
  end if;

  update ideworks.profiles
     set is_superadmin = p_is_superadmin,
         has_all_clients_access = p_has_all_clients,
         updated_at = now()
   where id = p_user_id;

  if not found then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_user_active(p_user_id uuid, p_active boolean)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador ativa ou desativa' using errcode = '42501';
  end if;

  -- Mesma razao: desativar a si mesmo tranca a porta por dentro.
  if p_user_id = ideworks.acting_user_id() and not p_active then
    raise exception 'voce nao pode desativar a si mesmo' using errcode = '42501';
  end if;

  update ideworks.profiles
     set is_active = p_active, updated_at = now()
   where id = p_user_id;

  if not found then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_user_clients(p_user_id uuid, p_client_ids uuid[])
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador define carteira' using errcode = '42501';
  end if;

  if not exists (select 1 from ideworks.profiles where id = p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  delete from ideworks.user_clients where user_id = p_user_id;

  insert into ideworks.user_clients (user_id, client_id)
  select p_user_id, c.id
    from ideworks.clients c
   where c.id = any(coalesce(p_client_ids, '{}'::uuid[]))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

grant execute on function ideworks.admin_directory() to ideworks_app;
grant execute on function ideworks.admin_user_clients(uuid) to ideworks_app;
grant execute on function ideworks.set_user_role(uuid, boolean, boolean) to ideworks_app;
grant execute on function ideworks.set_user_active(uuid, boolean) to ideworks_app;
grant execute on function ideworks.set_user_clients(uuid, uuid[]) to ideworks_app;
