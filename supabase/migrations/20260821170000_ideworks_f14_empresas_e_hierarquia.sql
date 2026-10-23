-- =============================================================================
-- IDE WORKS — F14  As empresas e a hierarquia de três níveis
-- =============================================================================
-- O PEDIDO
--   "Somos uma agência com sócios, diferentes empresas: Ide cuida de uma
--   carteira, Alma Nove de outra. O funcionário de uma não pode ver o da outra
--   a não ser que seja permitido."
--
--   E depois: "futuramente vou conectar o app Alma 9 também, que vai puxar os
--   clientes do portfólio A9 — por isso já preciso fazer a separação. Já o Ide
--   Hub são os compartilhados, tanto A9 quanto Ide."
--
-- A EMPRESA JÁ EXISTIA, COM OUTRO NOME
--   As "unidades de negócio" do cockpit são Alma9, Ide e Ide Hub — exatamente
--   as empresas. Os clientes já estão classificados: NENHUM DADO MIGRA.
--
--   "Ide Hub" é o balde do compartilhado, e uma lista de empresas por pessoa
--   resolve isso sem inventar conceito: quem é da A9 recebe {Alma9, Ide Hub};
--   quem é da Ide recebe {Ide, Ide Hub}.
--
-- TRÊS NÍVEIS, E CADA UM EXISTE POR UM MOTIVO
--   super_admin   cria outro super admin, apaga pessoa, define empresa
--   admin         convida, define carteira e áreas, ativa e desativa
--   funcionario   trabalha
--
--   As três coisas que só o topo faz são as irreversíveis ou as que mudam o
--   alcance inteiro de alguém de uma vez.
--
-- `is_superadmin` VIRA DERIVADA
--   Duas colunas dizendo a mesma coisa, e uma ficando para trás, é a forma mais
--   comum de permissão errada. Gerada a partir de `role`, elas não têm como
--   divergir — e as vinte políticas que chamam `acting_is_superadmin()`
--   continuam funcionando sem uma linha de mudança, porque aquela função lê
--   variável de SESSÃO, não a coluna.
--
-- O PRIMEIRO SUPER ADMIN SÓ NASCE AQUI
--   Só super admin cria super admin — então o primeiro não pode vir pela tela.
--   Ele vem desta migration. É a resposta honesta ao problema do ovo e da
--   galinha, não um esquecimento.
-- =============================================================================

create type ideworks.papel as enum ('super_admin', 'admin', 'funcionario');

alter table ideworks.profiles
  add column if not exists role ideworks.papel not null default 'funcionario';

update ideworks.profiles set role = case when is_superadmin then 'super_admin'::ideworks.papel
                                         else 'funcionario'::ideworks.papel end;

comment on column ideworks.profiles.role is
  'A hierarquia: super_admin > admin > funcionario. `is_superadmin` e derivada '
  'desta coluna e significa "administra" — os dois primeiros niveis.';

alter table ideworks.profiles drop column is_superadmin;
alter table ideworks.profiles
  add column is_superadmin boolean
  generated always as (role in ('super_admin', 'admin')) stored;

create table ideworks.user_categories (
  user_id     uuid not null references ideworks.profiles(id) on delete cascade,
  category_id uuid not null references ideworks.client_categories(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

alter table ideworks.user_categories enable row level security;

create policy user_categories_select on ideworks.user_categories for select
  using (user_id = ideworks.acting_user_id() or ideworks.acting_is_superadmin());

-- Quem enxerga qual cliente ganha a clausula da EMPRESA. A carteira por cliente
-- continua valendo para o caso fino: alguem de fora que precisa de UM cliente.
create or replace function ideworks.can_see_client(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_superadmin()
      or exists (
           select 1 from ideworks.profiles p
            where p.id = ideworks.acting_user_id() and p.has_all_clients_access)
      or exists (
           select 1 from ideworks.user_clients uc
            where uc.client_id = target and uc.user_id = ideworks.acting_user_id())
      or exists (
           select 1
             from ideworks.clients c
             join ideworks.user_categories ucat
               on ucat.category_id = c.category_id
              and ucat.user_id = ideworks.acting_user_id()
            where c.id = target)
$fn$;

-- So o topo. Le variavel de sessao, como `acting_is_superadmin` — o app
-- declara, o banco confere.
create or replace function ideworks.acting_is_super()
  returns boolean
  language sql stable
as $fn$
  select coalesce(current_setting('app.is_super', true), 'false') = 'true'
$fn$;

create or replace function ideworks.set_user_categories(p_user_id uuid, p_ids uuid[])
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  -- SO SUPER ADMIN: mudar a empresa de alguem muda a carteira inteira que ele
  -- enxerga, de uma vez.
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin define empresas' using errcode = '42501';
  end if;

  if not exists (select 1 from ideworks.profiles where id = p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  delete from ideworks.user_categories where user_id = p_user_id;

  insert into ideworks.user_categories (user_id, category_id)
  select p_user_id, c.id
    from ideworks.client_categories c
   where c.id = any(coalesce(p_ids, '{}'::uuid[]))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

grant select on ideworks.user_categories to ideworks_app;
grant execute on function ideworks.acting_is_super() to ideworks_app;
grant execute on function ideworks.set_user_categories(uuid, uuid[]) to ideworks_app;
