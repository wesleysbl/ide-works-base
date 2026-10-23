-- =============================================================================
-- IDE WORKS — F2.1  Cliente, plano, categoria e etiqueta
-- =============================================================================
-- Reconstrucao do cadastro do Sistema IDE, corrigindo tres coisas que o legado
-- carrega e que estao medidas em CONTEXTO/sistema-ide-legado.md:
--
--   1. REFERENCIA POR NOME. La, `clients.categoria` e `clients.plano` apontam
--      para outra tabela PELO NOME, com cascata. Renomear uma categoria
--      reescreve linhas de cliente. Aqui a referencia e por identificador: o
--      nome vira rotulo, e mudar rotulo nao mexe em dado alheio.
--
--   2. TABELA GORDA. As 27 colunas do legado misturam identificacao, contato,
--      dados do proprietario, estado comercial e a cota contratada. Aqui os
--      grupos ficam separados, e a COTA SAI DAQUI — ela vira o contrato do mes,
--      na F3.1, justamente porque hoje ela diverge da meta semanal em 27% dos
--      casos (259 de 973 pares, 33 clientes, 14 meses).
--
--   3. TEXTO LIVRE ONDE CABE ENUM. `urgency_level` tem tres valores reais
--      (paz, alerta, perigo) e e texto. Falhar alto, regra 3 do roteiro.
--
-- Toda tabela nasce com seguranca por linha ligada, e as politicas seguem o
-- modelo da F1.9 — o servidor declara em nome de quem age, e sem declaracao o
-- banco devolve vazio.
-- =============================================================================

do $$ begin
  create type ideworks.urgency_level as enum ('paz', 'alerta', 'perigo');
exception when duplicate_object then null; end $$;

comment on type ideworks.urgency_level is
  'Os tres valores reais do legado, medidos em 2026-08-19. Ordem crescente de gravidade.';

-- --- planos -------------------------------------------------------------------
create table if not exists ideworks.plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color_bg    text not null default '#1f2937',
  color_text  text not null default '#f9fafb',
  color_border text not null default '#374151',
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists plans_name_key on ideworks.plans (lower(name));

comment on table ideworks.plans is
  'Planos vendidos. O cliente aponta para ca por ID, nao por nome como no legado.';

-- --- categorias (as abas de unidade de negocio) -------------------------------
create table if not exists ideworks.client_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_default  boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists client_categories_name_key
  on ideworks.client_categories (lower(name));

-- Exatamente uma categoria padrao. O legado garante isso por disciplina; aqui e
-- o banco que recusa a segunda.
create unique index if not exists client_categories_single_default
  on ideworks.client_categories ((true)) where is_default;

comment on table ideworks.client_categories is
  'Unidades de negocio da agencia — as abas do topo do painel. Exatamente uma e '
  'padrao, e o indice parcial garante isso no banco, nao na aplicacao.';

-- --- clientes -----------------------------------------------------------------
create table if not exists ideworks.clients (
  id            uuid primary key default gen_random_uuid(),

  -- identificacao
  name          text not null,
  tax_id        text,
  company_email text,

  -- contrato
  plan_id       uuid references ideworks.plans (id) on delete restrict,
  category_id   uuid not null references ideworks.client_categories (id) on delete restrict,
  started_on    date not null,
  renews_on     date,

  -- contato
  phone         text,
  whatsapp      text,
  address       text,

  -- proprietario
  owner_name      text,
  owner_phone     text,
  owner_whatsapp  text,

  -- estado
  is_active     boolean not null default true,
  inactive_at   timestamptz,
  urgency       ideworks.urgency_level not null default 'paz',
  finance_ok    boolean not null default false,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Estado desligado precisa de data, e ligado nao pode ter. O legado deixa os
  -- dois soltos, e ai "inativo desde quando?" nao tem resposta.
  constraint clients_inactive_has_date
    check ((is_active and inactive_at is null) or (not is_active and inactive_at is not null))
);

create index if not exists clients_category_idx on ideworks.clients (category_id);
create index if not exists clients_active_idx on ideworks.clients (is_active) where is_active;

comment on table ideworks.clients is
  'Cliente da agencia. A COTA CONTRATADA NAO MORA AQUI — ela e o contrato do mes '
  '(F3.1). No legado ela morava, e divergia da meta semanal em 27% dos casos, '
  'porque a cota e o valor de hoje e a meta e historica.';
comment on column ideworks.clients.category_id is
  'Por ID, nao por nome. No legado a referencia e por nome com cascata: renomear '
  'a categoria reescreve linhas de cliente.';

-- --- etiquetas ----------------------------------------------------------------
create table if not exists ideworks.client_tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#6b7280',
  created_at timestamptz not null default now()
);

create unique index if not exists client_tags_name_key on ideworks.client_tags (lower(name));

create table if not exists ideworks.client_tag_assignments (
  client_id uuid not null references ideworks.clients (id) on delete cascade,
  tag_id    uuid not null references ideworks.client_tags (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (client_id, tag_id)
);

-- --- quem enxerga quais clientes ----------------------------------------------
create table if not exists ideworks.user_clients (
  user_id    uuid not null references auth.users (id) on delete cascade,
  client_id  uuid not null references ideworks.clients (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

comment on table ideworks.user_clients is
  'Vinculo pessoa-cliente, para quem NAO tem acesso a todos. As politicas de '
  'cliente consultam esta tabela — o vazamento de carteira alheia seria o erro '
  'mais caro deste modulo.';

alter table ideworks.profiles
  add column if not exists has_all_clients_access boolean not null default false;

comment on column ideworks.profiles.has_all_clients_access is
  'Quem tem isto le todos os clientes. Quem nao tem le apenas os de user_clients.';

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.plans                  enable row level security;
alter table ideworks.client_categories      enable row level security;
alter table ideworks.clients                enable row level security;
alter table ideworks.client_tags            enable row level security;
alter table ideworks.client_tag_assignments enable row level security;
alter table ideworks.user_clients           enable row level security;

-- Quem enxerga este cliente? Superadmin ve tudo; quem tem acesso amplo tambem;
-- os demais, so o que lhes foi atribuido. Sem ator declarado: ninguem.
create or replace function ideworks.can_see_client(target uuid) returns boolean
  language sql stable security definer set search_path = ideworks, pg_temp as $fn$
  select ideworks.acting_is_superadmin()
      or exists (
           select 1 from ideworks.profiles p
            where p.id = ideworks.acting_user_id() and p.has_all_clients_access)
      or exists (
           select 1 from ideworks.user_clients uc
            where uc.client_id = target and uc.user_id = ideworks.acting_user_id())
$fn$;

comment on function ideworks.can_see_client(uuid) is
  'A regra de carteira, num lugar so. Espalhada pelas politicas, uma copia '
  'ficaria para tras na primeira mudanca.';

-- Catalogos: qualquer pessoa identificada le; so administrador escreve.
create policy plans_select on ideworks.plans for select
  using (ideworks.acting_user_id() is not null);
create policy plans_write on ideworks.plans for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

create policy categories_select on ideworks.client_categories for select
  using (ideworks.acting_user_id() is not null);
create policy categories_write on ideworks.client_categories for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

create policy tags_select on ideworks.client_tags for select
  using (ideworks.acting_user_id() is not null);
create policy tags_write on ideworks.client_tags for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- Clientes: a regra da carteira.
create policy clients_select on ideworks.clients for select
  using (ideworks.can_see_client(id));
create policy clients_write on ideworks.clients for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

create policy tag_assign_select on ideworks.client_tag_assignments for select
  using (ideworks.can_see_client(client_id));
create policy tag_assign_write on ideworks.client_tag_assignments for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- Vinculos: a pessoa ve os proprios; administrador ve e mexe em todos.
create policy user_clients_select on ideworks.user_clients for select
  using (user_id = ideworks.acting_user_id() or ideworks.acting_is_superadmin());
create policy user_clients_write on ideworks.user_clients for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.can_see_client(uuid) to ideworks_app;
