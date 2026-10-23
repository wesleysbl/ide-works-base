-- F42, Fase 1 (parte 2 de 4) — a ESTEIRA ganha os três destinos da aprovação do
-- cliente: aguardando cliente, aprovado e reprovado.
--
-- O QUE MUDA
--   1. `ideworks.status_set_approval_targets`, uma linha por esteira
--      (`status_sets`): três colunas, cada uma apontando para uma etapa
--      (`statuses`). Tabela à parte, e não três colunas em `status_sets`, para não
--      criar referência circular entre as duas tabelas (statuses já aponta para
--      status_sets) e para a esteira sem aprovação não carregar nada.
--   2. TRAVA: cada destino tem de ser uma etapa DA PRÓPRIA esteira. Gatilho
--      `status_set_approval_targets_guard` recusa etapa de outra esteira
--      (SQLSTATE `IW042`, hint `target_outside_status_set`).
--   3. ETAPA APAGADA: as chaves estrangeiras são `on delete set null`. Apagar uma
--      etapa usada como destino deixa a configuração INCOMPLETA — não quebra, não
--      apaga a linha. Quem envia (`create_approval_round`) recusa enquanto
--      faltar destino; quem decide (`decide_approval_round`) grava a decisão e
--      não move.
--   4. `ideworks.approval_targets_for(status_set_id)`: os três destinos que
--      VALEM agora (nulo onde faltar ou onde a etapa tiver saído da esteira).
--      É a leitura única que o envio e a decisão usam.
--
-- SEGURANÇA POR LINHA
--   Ler: quem enxerga a esteira (`can_see_status_set`). Gravar: quem administra
--   E pode escrever na esteira (`can_write_status_set`) — a fase 3 responde 403
--   a quem não é admin; o banco recusa do mesmo jeito.
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261007150100_ideworks_f42_2_destinos_da_esteira.sql`.

begin;
set local lock_timeout = '5s';

create table if not exists ideworks.status_set_approval_targets (
  status_set_id      uuid primary key references ideworks.status_sets (id) on delete cascade,
  awaiting_status_id uuid references ideworks.statuses (id) on delete set null,
  approved_status_id uuid references ideworks.statuses (id) on delete set null,
  rejected_status_id uuid references ideworks.statuses (id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null
);

comment on table ideworks.status_set_approval_targets is
  'F42: para onde o card vai na aprovação do cliente, por esteira — aguardando '
  'cliente, aprovado, reprovado. Cada destino é etapa da PRÓPRIA esteira (gatilho). '
  'Etapa apagada vira nulo: configuração incompleta, nada quebra.';

create or replace function ideworks.status_set_approval_targets_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if exists (
    select 1
      from unnest(array[new.awaiting_status_id, new.approved_status_id, new.rejected_status_id]) d(status_id)
     where d.status_id is not null
       and not exists (
         select 1 from ideworks.statuses s
          where s.id = d.status_id and s.status_set_id = new.status_set_id)
  ) then
    raise exception
      'Cada destino da aprovação tem de ser uma etapa desta mesma esteira. Escolha as etapas na lista desta esteira.'
      using errcode = 'IW042', hint = 'target_outside_status_set';
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

comment on function ideworks.status_set_approval_targets_guard() is
  'F42: recusa destino da aprovação que não seja etapa da própria esteira (IW042, '
  'hint target_outside_status_set).';

drop trigger if exists status_set_approval_targets_guard on ideworks.status_set_approval_targets;
-- `update of` as quatro colunas: o `set null` da etapa apagada mexe só na coluna
-- do destino, e nulo passa reto no gatilho.
create trigger status_set_approval_targets_guard
  before insert or update of status_set_id, awaiting_status_id, approved_status_id, rejected_status_id
  on ideworks.status_set_approval_targets
  for each row execute function ideworks.status_set_approval_targets_guard();

alter table ideworks.status_set_approval_targets enable row level security;

drop policy if exists status_set_approval_targets_select on ideworks.status_set_approval_targets;
create policy status_set_approval_targets_select on ideworks.status_set_approval_targets
  for select using (ideworks.can_see_status_set(status_set_id));

drop policy if exists status_set_approval_targets_write on ideworks.status_set_approval_targets;
create policy status_set_approval_targets_write on ideworks.status_set_approval_targets
  for all using (ideworks.acting_is_superadmin() and ideworks.can_write_status_set(status_set_id))
  with check (ideworks.acting_is_superadmin() and ideworks.can_write_status_set(status_set_id));

revoke all on table ideworks.status_set_approval_targets from public, anon, authenticated, ideworks_app;
grant select, insert, update, delete on table ideworks.status_set_approval_targets to ideworks_app;

create or replace function ideworks.approval_targets_for(p_status_set_id uuid)
  returns table (awaiting_status_id uuid, approved_status_id uuid, rejected_status_id uuid)
  language sql
  stable
  security invoker
  set search_path = ideworks, pg_temp
as $fn$
  -- `security invoker`: respeita a política de quem chama; dentro de
  -- `create_approval_round` e `decide_approval_round` (definer) enxerga tudo.
  -- Só vale destino que AINDA é etapa desta esteira. A trava do gatilho garante
  -- isso na escrita; aqui repete-se na leitura porque uma etapa pode trocar de
  -- esteira depois (raro, mas `move_task` recusaria e a decisão quebraria).
  select
    (select s.id from ideworks.statuses s
      where s.id = t.awaiting_status_id and s.status_set_id = t.status_set_id),
    (select s.id from ideworks.statuses s
      where s.id = t.approved_status_id and s.status_set_id = t.status_set_id),
    (select s.id from ideworks.statuses s
      where s.id = t.rejected_status_id and s.status_set_id = t.status_set_id)
    from ideworks.status_set_approval_targets t
   where t.status_set_id = p_status_set_id
$fn$;

comment on function ideworks.approval_targets_for(uuid) is
  'F42: os três destinos da aprovação que valem agora para a esteira (nulo onde '
  'falta ou onde a etapa saiu da esteira). Nenhuma linha quando nada foi configurado.';

revoke all on function ideworks.approval_targets_for(uuid) from public, anon, authenticated;
revoke all on function ideworks.status_set_approval_targets_guard() from public, anon, authenticated;
grant execute on function ideworks.approval_targets_for(uuid) to ideworks_app;

commit;
