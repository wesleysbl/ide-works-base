-- =============================================================================
-- IDE WORKS — F3.1  Tipos de conteudo, cota padrao e contrato do mes
-- =============================================================================
-- A DIVIDA QUE ESTA ETAPA ELIMINA
--   No Sistema IDE a cota contratada mora em `clients.quantidade_*` — um valor
--   ATUAL — enquanto as metas semanais sao HISTORICAS. Medido em 2026-08-19:
--   de 973 pares (cliente x mes x tipo), **259 divergem (27%)**, atingindo 33
--   clientes e 14 meses.
--
--   Nem toda divergencia e corrupcao. Quando o plano de um cliente muda, os
--   meses passados NAO DEVERIAM mudar junto. Elas divergem porque deveriam — e
--   ninguem modelou isso.
--
-- A CORRECAO
--   Duas coisas com nomes diferentes, porque sao coisas diferentes:
--
--     cota padrao      o que o cliente contrata HOJE. Muda quando o plano muda.
--     contrato do mes  o que foi contratado NAQUELE mes. Nasce copiando a cota
--                      padrao e nunca mais muda sozinho.
--
--   Assim, alterar a cota em setembro nao reescreve agosto.
--
-- DUAS OUTRAS DIVIDAS, DE QUEBRA
--   `month_year` e TEXT em seis tabelas do legado. Aqui e `date`, sempre o
--   primeiro dia do mes, com restricao que recusa qualquer outro dia. Regra 4.
--
--   `content_type` e TEXT em duas tabelas que usam VOCABULARIOS DIFERENTES:
--   `videos/artes/fotos/ads` na grade, `Video/Arte/Foto/ADS` no calendario. O
--   mapa de 11 grafias do legado existe para ligar os dois dialetos. Aqui ha um
--   vocabulario so, e o banco recusa o que estiver fora. Regra 3.
-- =============================================================================

do $$ begin
  create type ideworks.content_type as enum ('video', 'arte', 'foto', 'ads');
exception when duplicate_object then null; end $$;

comment on type ideworks.content_type is
  'UM vocabulario. O legado tem dois — `videos/artes/fotos/ads` na grade semanal '
  'e `Video/Arte/Foto/ADS` no calendario — e um mapa de 11 grafias para liga-los, '
  'cujo valor padrao faz tipo desconhecido valer peso 1, calado.';

-- --- cota padrao do cliente ---------------------------------------------------
create table if not exists ideworks.client_quotas (
  client_id    uuid not null references ideworks.clients (id) on delete cascade,
  content_type ideworks.content_type not null,
  quantity     integer not null,
  updated_at   timestamptz not null default now(),
  primary key (client_id, content_type),
  constraint client_quotas_non_negative check (quantity >= 0)
);

comment on table ideworks.client_quotas is
  'Cota ATUAL do cliente. Mudar aqui NAO altera nenhum contrato de mes ja aberto '
  '— e exatamente essa separacao que resolve os 259 casos divergentes do legado.';

-- --- contrato do mes ----------------------------------------------------------
create table if not exists ideworks.month_contracts (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references ideworks.clients (id) on delete cascade,
  reference_month date not null,
  opened_at       timestamptz not null default now(),
  opened_by       uuid references auth.users (id) on delete set null,

  -- As duas travas do ritual mensal (F5.2), aqui desde ja porque pertencem ao
  -- contrato, nao a uma tabela separada.
  planning_done_at   timestamptz,
  planning_done_by   uuid references auth.users (id) on delete set null,
  client_approved_at timestamptz,
  client_approved_by uuid references auth.users (id) on delete set null,

  unique (client_id, reference_month),

  -- Mes e uma DATA, e sempre o primeiro dia. No legado e texto livre em seis
  -- tabelas, e nada impede '2026-8' convivendo com '2026-08'.
  constraint month_contracts_first_day check (reference_month = date_trunc('month', reference_month)::date)
);

create index if not exists month_contracts_month_idx
  on ideworks.month_contracts (reference_month desc);

comment on table ideworks.month_contracts is
  'O que foi contratado NAQUELE mes. Nasce copiando a cota padrao e nao muda '
  'sozinho depois. Alterar a cota do cliente em setembro nao reescreve agosto.';
comment on column ideworks.month_contracts.reference_month is
  'Primeiro dia do mes, como DATE. A restricao recusa qualquer outro dia.';

create table if not exists ideworks.month_contract_items (
  contract_id  uuid not null references ideworks.month_contracts (id) on delete cascade,
  content_type ideworks.content_type not null,
  quantity     integer not null,
  primary key (contract_id, content_type),
  constraint month_contract_items_non_negative check (quantity >= 0)
);

comment on table ideworks.month_contract_items is
  'A cota congelada daquele mes, por tipo. Copia da cota padrao no momento da '
  'abertura.';

-- --- a acao de abrir o mes ----------------------------------------------------
-- Regra 9 do roteiro: escrita de dominio e transacional. Cria o contrato e
-- copia a cota em bloco, ou nao faz nada. Idempotente: abrir duas vezes nao
-- duplica nem sobrescreve o que ja foi congelado.
create or replace function ideworks.open_month(
  p_client_id uuid,
  p_month     date,
  p_opened_by uuid
) returns uuid
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_month    date := date_trunc('month', p_month)::date;
  v_contract uuid;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador abre o mes' using errcode = '42501';
  end if;

  select id into v_contract
    from ideworks.month_contracts
   where client_id = p_client_id and reference_month = v_month;

  -- Ja aberto: devolve o que existe, sem tocar no que foi congelado. Reabrir
  -- por engano nao pode reescrever a historia daquele mes.
  if v_contract is not null then
    return v_contract;
  end if;

  insert into ideworks.month_contracts (client_id, reference_month, opened_by)
  values (p_client_id, v_month, p_opened_by)
  returning id into v_contract;

  insert into ideworks.month_contract_items (contract_id, content_type, quantity)
  select v_contract, q.content_type, q.quantity
    from ideworks.client_quotas q
   where q.client_id = p_client_id;

  return v_contract;
end;
$fn$;

comment on function ideworks.open_month(uuid, date, uuid) is
  'Abre o mes de um cliente: cria o contrato e CONGELA a cota vigente. '
  'Idempotente — chamar de novo devolve o contrato existente sem reescrever '
  'nada, porque reabrir por engano nao pode alterar a historia do mes.';

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.client_quotas         enable row level security;
alter table ideworks.month_contracts       enable row level security;
alter table ideworks.month_contract_items  enable row level security;

create policy quotas_select on ideworks.client_quotas for select
  using (ideworks.can_see_client(client_id));
create policy quotas_write on ideworks.client_quotas for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

create policy contracts_select on ideworks.month_contracts for select
  using (ideworks.can_see_client(client_id));
create policy contracts_write on ideworks.month_contracts for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- Os itens do contrato seguem a visibilidade do contrato a que pertencem.
create policy contract_items_select on ideworks.month_contract_items for select
  using (exists (
    select 1 from ideworks.month_contracts c
     where c.id = contract_id and ideworks.can_see_client(c.client_id)));
create policy contract_items_write on ideworks.month_contract_items for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.open_month(uuid, date, uuid) to ideworks_app;
