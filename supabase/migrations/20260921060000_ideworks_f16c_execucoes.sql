-- =============================================================================
-- IDE WORKS — F16.6a  Registro, idempotência e prévia das escritas de agente
-- =============================================================================
-- O PEDIDO
--   Uma escrita de agente precisa poder ser repetida com segurança e sempre
--   possuir resultado e autoria registrados. Comentário e movimento ainda NÃO
--   saem por HTTP/MCP nesta etapa: aqui mora o ledger, a chave e a prévia.
--
-- O QUE NÃO ENTRA NESTA TABELA
--   O corpo do comentário. O JSON do resultado é o EFEITO (id do comentário,
--   destino do movimento, quantas subtarefas, se houve automação). Quem quiser
--   o texto lê a conversa, com a capacidade de leitura. Conteúdo de tarefa
--   também não é instrução de sistema — a operação vem do contrato e da
--   concessão, nunca do texto do card.
--
-- IDEMPOTÊNCIA
--   Uma chave identifica a mesma intenção na mesma concessão e operação.
--   Unique parcial em (grant_id, operation, idempotency_key) WHERE active:
--   duas transações simultâneas não confirmam duas mutações. Dentro de 24h,
--   o mesmo hash de parâmetros devolve o resultado persistido; hash diferente
--   é conflito. Depois da janela, a linha antiga deixa de ser ativa e a chave
--   pode escrever de novo — o histórico permanece.
--
-- PRÉVIA
--   Aprovação verificável mora em integration_write_approvals: id, hash dos
--   parâmetros, revisão da política e prazo, gravados no SERVIDOR. Não existe
--   coluna `approved`. Um campo enviado pelo modelo não prova nada.
-- =============================================================================

-- --- ledger -----------------------------------------------------------------
create table ideworks.integration_executions (
  id                uuid primary key default gen_random_uuid(),
  grant_id          uuid not null,
  owner_id          uuid not null,
  operation         text not null,
  target_id         uuid not null,
  occurred_at       timestamptz not null default now(),
  result            jsonb not null,
  changes           jsonb not null default '{}'::jsonb,
  idempotency_key   text not null,
  params_hash       text not null,
  policy_version    integer not null,
  origin            text not null,
  active            boolean not null default true,

  foreign key (grant_id, owner_id)
    references ideworks.integration_grants (id, owner_id)
    on delete cascade,

  constraint integration_executions_operation_sane
    check (operation in ('add_comment', 'move_task')),
  constraint integration_executions_origin_sane
    check (origin in ('mcp', 'http', 'automation')),
  constraint integration_executions_key_sane
    check (char_length(idempotency_key) between 1 and 128),
  constraint integration_executions_hash_sane
    check (params_hash ~ '^[0-9a-f]{64}$'),
  constraint integration_executions_version_sane
    check (policy_version >= 1),
  constraint integration_executions_result_object
    check (jsonb_typeof(result) = 'object' and jsonb_typeof(changes) = 'object'),
  constraint integration_executions_result_compact
    check (
      not (result ?| array['body', 'content', 'text', 'comment_body', 'commentBody'])
      and not (changes ?| array['body', 'content', 'text', 'comment_body', 'commentBody'])
    )
);

comment on table ideworks.integration_executions is
  'Ledger das escritas de agente. Resultado compacto — nunca o corpo do '
  'comentário. Texto de tarefa não amplia acesso.';
comment on column ideworks.integration_executions.result is
  'JSON do efeito (ids, destino, contagens). Proibido body/content/text.';
comment on column ideworks.integration_executions.params_hash is
  'SHA-256 hex dos parâmetros canônicos. Compara intenção; não guarda o texto.';
comment on column ideworks.integration_executions.idempotency_key is
  'Chave da intenção, única por concessão+operação enquanto active.';
comment on column ideworks.integration_executions.policy_version is
  'Revisão da concessão no instante da escrita. Não é o número que o modelo mandou.';
comment on column ideworks.integration_executions.active is
  'Falso depois da janela de 24h, para a chave poder escrever de novo. A linha fica.';
comment on column ideworks.integration_executions.owner_id is
  'Pessoa em cujo nome o agente escreveu. Autoria; não é um autor forjado na entrada.';

-- Concorrência real: o segundo INSERT com a mesma chave ativa leva unique_violation
-- (23505), a mutação da transação perdedora NÃO confirma, e a repetição lê o vencedor.
create unique index integration_executions_idempotency_live_idx
  on ideworks.integration_executions (grant_id, operation, idempotency_key)
  where active;

create index integration_executions_grant_idx
  on ideworks.integration_executions (grant_id, occurred_at desc);

create function ideworks.integration_executions_guard()
  returns trigger
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  g ideworks.integration_grants%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into g from ideworks.integration_grants where id = new.grant_id;
    if not found then
      raise exception 'concessão inexistente para a execução';
    end if;
    if new.owner_id is distinct from g.owner_id then
      raise exception 'dono da execução difere da concessão';
    end if;
    if new.policy_version is distinct from g.policy_version then
      raise exception 'policy_version da execução difere da concessão viva';
    end if;
    return new;
  end if;

  -- UPDATE: só desativar chave expirada. O restante do registro é imutável.
  if new.id is distinct from old.id
     or new.grant_id is distinct from old.grant_id
     or new.owner_id is distinct from old.owner_id
     or new.operation is distinct from old.operation
     or new.target_id is distinct from old.target_id
     or new.occurred_at is distinct from old.occurred_at
     or new.result is distinct from old.result
     or new.changes is distinct from old.changes
     or new.idempotency_key is distinct from old.idempotency_key
     or new.params_hash is distinct from old.params_hash
     or new.policy_version is distinct from old.policy_version
     or new.origin is distinct from old.origin then
    raise exception 'registro de execução é imutável';
  end if;
  if old.active is not true or new.active is not false then
    raise exception 'execução só pode ser desativada uma vez';
  end if;
  if old.occurred_at > now() - interval '24 hours' then
    raise exception 'chave de idempotência ainda está na janela de 24h';
  end if;
  return new;
end;
$fn$;

create trigger integration_executions_guard
  before insert or update on ideworks.integration_executions
  for each row execute function ideworks.integration_executions_guard();

-- --- aprovação verificável (prévia) -----------------------------------------
create table ideworks.integration_write_approvals (
  id               uuid primary key default gen_random_uuid(),
  grant_id         uuid not null,
  owner_id         uuid not null,
  operation        text not null,
  params_hash      text not null,
  policy_version   integer not null,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),

  foreign key (grant_id, owner_id)
    references ideworks.integration_grants (id, owner_id)
    on delete cascade,

  constraint integration_write_approvals_operation_sane
    check (operation in ('add_comment', 'move_task')),
  constraint integration_write_approvals_hash_sane
    check (params_hash ~ '^[0-9a-f]{64}$'),
  constraint integration_write_approvals_version_sane
    check (policy_version >= 1),
  constraint integration_write_approvals_expiry_sane
    check (expires_at > created_at)
);

comment on table ideworks.integration_write_approvals is
  'Prévia confirmada no servidor: id + hash dos parâmetros + revisão + prazo. '
  'Não há coluna approved. O modelo não prova a própria aprovação.';

create index integration_write_approvals_grant_idx
  on ideworks.integration_write_approvals (grant_id, expires_at);

-- --- RLS ---------------------------------------------------------------------
-- Sem política, o Postgres nega. Agente não lista aprovação alheia nem inventa
-- uma. Ledger é da concessão que escreveu (ou do humano dono, na gestão).

alter table ideworks.integration_executions enable row level security;
alter table ideworks.integration_write_approvals enable row level security;

revoke all on table ideworks.integration_executions from public, anon, authenticated;
revoke all on table ideworks.integration_write_approvals from public, anon, authenticated;

create policy integration_executions_select on ideworks.integration_executions
  for select to ideworks_app
  using (
    ideworks.acting_user_id() is not null
    and (
      (
        grant_id = ideworks.acting_grant_id()
        and owner_id = ideworks.acting_user_id()
        and ideworks.acting_grant_is_live()
      )
      or (
        ideworks.acting_grant_id() is null
        and (
          owner_id = ideworks.acting_user_id()
          or ideworks.acting_is_super()
        )
      )
    )
  );

create policy integration_executions_insert on ideworks.integration_executions
  for insert to ideworks_app
  with check (
    ideworks.acting_grant_is_live()
    and grant_id = ideworks.acting_grant_id()
    and owner_id = ideworks.acting_user_id()
    and owner_id = ideworks.acting_integration_owner_id()
  );

-- Só desativar chave expirada. O gatilho recusa qualquer outra alteração.
create policy integration_executions_update on ideworks.integration_executions
  for update to ideworks_app
  using (
    ideworks.acting_grant_is_live()
    and grant_id = ideworks.acting_grant_id()
    and owner_id = ideworks.acting_user_id()
  )
  with check (
    ideworks.acting_grant_is_live()
    and grant_id = ideworks.acting_grant_id()
    and owner_id = ideworks.acting_user_id()
    and active = false
  );

create policy integration_write_approvals_select on ideworks.integration_write_approvals
  for select to ideworks_app
  using (
    ideworks.acting_user_id() is not null
    and (
      (
        grant_id = ideworks.acting_grant_id()
        and owner_id = ideworks.acting_user_id()
        and ideworks.acting_grant_is_live()
      )
      or (
        ideworks.acting_grant_id() is null
        and (
          owner_id = ideworks.acting_user_id()
          or ideworks.acting_is_super()
        )
      )
    )
  );

-- Agente não grava aprovação. Humano dono (ou o topo) registra a prévia.
create policy integration_write_approvals_insert on ideworks.integration_write_approvals
  for insert to ideworks_app
  with check (
    ideworks.acting_grant_id() is null
    and ideworks.acting_user_id() is not null
    and (
      owner_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  );

grant select, insert, update on ideworks.integration_executions to ideworks_app;
grant select, insert on ideworks.integration_write_approvals to ideworks_app;
