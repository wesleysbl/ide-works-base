-- =============================================================================
-- IDE WORKS — F13  Áreas por pessoa
-- =============================================================================
-- RECONSTRUÍDA A PARTIR DO BANCO EM 2026-08-24, NUMA AUDITORIA.
--   Esta migração foi APLICADA em produção e nunca versionada — o rollback dela
--   existia sozinho na pasta, o que foi o que denunciou a falta.
--
--   Uma migração aplicada e não versionada é pior que uma não aplicada:
--   reconstruir o banco a partir dos arquivos daria um banco DIFERENTE do que
--   está no ar, e a diferença só apareceria quando alguém tentasse.
--
--   O conteúdo abaixo foi lido do banco (`pg_get_functiondef`), não escrito de
--   memória. É o que está rodando.
--
-- O QUE ELA RESOLVE
--   Entrar não é alcançar tudo. Uma pessoa que cuida de entrega não precisa da
--   área Meta, e quem só olha relatório não precisa mexer em catálogo. A área é
--   o segundo eixo do acesso — o primeiro é a carteira de clientes, o terceiro
--   (F14) é a empresa.
--
-- A CONFERÊNCIA MORA NA SESSÃO, E NÃO EM CADA ROTA
--   `resolveActor` recebe o caminho e recusa antes de a rota rodar. Espalhá-la
--   pelas rotas seria N lugares para esquecer de um — e o que faltasse não daria
--   sinal nenhum.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'ideworks' and t.typname = 'area') then
    create type ideworks.area as enum ('entrega', 'meta', 'catalogos', 'pessoas');
  end if;
end $$;

-- `entrega` como padrão, e não `{}`: uma pessoa nova precisa conseguir
-- trabalhar. Vazio seria alguém que entra e não alcança nada — estado válido,
-- mas péssimo padrão.
alter table ideworks.profiles
  add column if not exists areas ideworks.area[] not null default '{entrega}';

comment on column ideworks.profiles.areas is
  'As partes do sistema que esta pessoa alcanca. Quem administra alcanca todas '
  'sem depender desta coluna — ver `acting_areas`.';

-- --- as perguntas que as politicas e a sessao fazem ----------------------------
create or replace function ideworks.acting_areas()
  returns ideworks.area[]
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when ideworks.acting_is_superadmin()
             then '{entrega,meta,catalogos,pessoas}'::ideworks.area[]
           else coalesce(
             (select p.areas from ideworks.profiles p where p.id = ideworks.acting_user_id()),
             '{}'::ideworks.area[]
           )
         end;
$fn$;

create or replace function ideworks.acting_can(p_area ideworks.area)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_superadmin()
      or exists (
        select 1 from ideworks.profiles p
         where p.id = ideworks.acting_user_id()
           and p_area = any(p.areas)
      );
$fn$;

create or replace function ideworks.set_user_areas(p_user_id uuid, p_areas ideworks.area[])
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador define areas' using errcode = '42501';
  end if;

  update ideworks.profiles
     set areas = coalesce(p_areas, '{}'::ideworks.area[]),
         updated_at = now()
   where id = p_user_id;

  if not found then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  select array_length(coalesce(p_areas, '{}'::ideworks.area[]), 1) into v_n;
  return coalesce(v_n, 0);
end;
$fn$;

grant execute on function ideworks.acting_areas()                            to ideworks_app;
grant execute on function ideworks.acting_can(ideworks.area)                 to ideworks_app;
grant execute on function ideworks.set_user_areas(uuid, ideworks.area[])     to ideworks_app;
