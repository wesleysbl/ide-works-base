-- =============================================================================
-- IDE WORKS — F16.1  Concessões e identidade da integração
-- =============================================================================
-- O PEDIDO
--   Toda chamada de agente precisa de uma integração identificada e de um
--   limite de acesso verificável. Sem isto, o token da F16.0 é só prova de
--   protocolo: não recorta empresa, não recorta capacidade, não sobrevive a
--   revogação no domínio.
--
-- A REGRA, E ELA NÃO É OPCIONAL
--   Acesso efetivo = acesso atual da pessoa ∩ concessão ∩ operação ∩ regras
--   do recurso. Quem administra o sistema e concede só-leitura NÃO transforma
--   o agente em administrador. O papel amplia a pessoa na interface; a
--   concessão é que recorta o agente.
--
-- POR QUE NÃO MEXER NAS POLÍTICAS ANTIGAS DE TAREFA/CLIENTE
--   Elas respondem pela interface humana. Apertá-las aqui faria o quadro
--   sumir para quem não é agente. O recorte da integração mora em funções
--   próprias, consultadas quando há `app.grant_id` na sessão. Sem concessão
--   declarada, essas funções devolvem verdadeiro — o caminho humano não muda.
--
-- CONEXÃO E CONCESSÃO SÃO A MESMA LINHA NESTA ETAPA
--   Proprietário, cliente OAuth, nome, capacidades, empresas, clientes,
--   validade, revogação e versão da política cabem numa tabela. A F16.2 pode
--   separar consentimento de conexão sem migrar o GUC: `app.integration_id` e
--   `app.grant_id` já existem como variáveis distintas e, hoje, recebem o
--   mesmo identificador.
--
-- CREDENCIAL DE AUTOMAÇÃO NÃO É CONTA
--   O responsável é `profiles.id` que já existe. Guarda-se só a impressão
--   digital SHA-256, no molde de `invitations.code_hash`. Não há insert em
--   Auth, não há papel novo, não há linha no legado.
--
-- ESCRITA EXIGE A LEITURA DO MESMO RECURSO
--   `comments:write` pede `comments:read` e `tasks:read` — comentar precisa
--   identificar a tarefa. `tasks:move` pede `tasks:read` e `boards:read` —
--   movimento é operação de quadro. A recusa é no CHECK, não num ajuste
--   silencioso que completaria a leitura por trás do consentimento.
-- =============================================================================

-- --- capacidades fechadas ----------------------------------------------------
-- Enum, não texto livre: capacidade desconhecida tem de quebrar na gravação,
-- não virar "autorizado" num `else` que ninguém lê. Os nomes são o contrato
-- da F16; as etapas seguintes não inventam sinônimo.

create type ideworks.integration_capability as enum (
  'boards:read',
  'tasks:read',
  'clients:read',
  'people:read',
  'comments:read',
  'reports:delivery:read',
  'reports:marketing:read',
  'comments:write',
  'tasks:move'
);

comment on type ideworks.integration_capability is
  'Capacidades operacionais da integração. Escrita exige a leitura do mesmo '
  'recurso; o CHECK da tabela é que recusa o par incompleto.';

-- --- a concessão -------------------------------------------------------------
create table ideworks.integration_grants (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references ideworks.profiles (id) on delete cascade,
  oauth_client_id      text not null,
  name                 text not null,
  capabilities         ideworks.integration_capability[] not null default '{}',
  -- null = todas as empresas que o responsável alcança AGORA. Array vazio =
  -- nenhuma. A interseção com user_categories (ou o topo) acontece na função,
  -- não nesta coluna: guardar um recorte morto faria a concessão sobreviver
  -- à perda de empresa.
  allowed_company_ids  uuid[],
  allowed_client_ids   uuid[],
  expires_at           timestamptz,
  revoked_at           timestamptz,
  policy_version       integer not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- A FK composta das credenciais aponta para (id, owner_id). A PK já torna
  -- `id` único; este unique só existe para o Postgres aceitar a referência
  -- que amarra o responsável humano ao dono da concessão, sem trigger.
  unique (id, owner_id),

  constraint integration_grants_name_sane
    check (char_length(btrim(name)) between 1 and 80),
  constraint integration_grants_client_sane
    check (char_length(oauth_client_id) between 1 and 200),
  constraint integration_grants_version_sane
    check (policy_version >= 1),
  constraint integration_grants_revoked_sane
    check (revoked_at is null or revoked_at >= created_at),
  constraint integration_grants_write_implies_read check (
    (
      not ('comments:write'::ideworks.integration_capability = any (capabilities))
      or (
        'comments:read'::ideworks.integration_capability = any (capabilities)
        and 'tasks:read'::ideworks.integration_capability = any (capabilities)
      )
    )
    and (
      not ('tasks:move'::ideworks.integration_capability = any (capabilities))
      or (
        'tasks:read'::ideworks.integration_capability = any (capabilities)
        and 'boards:read'::ideworks.integration_capability = any (capabilities)
      )
    )
  )
);

comment on table ideworks.integration_grants is
  'Conexão e concessão da integração, na mesma linha. O agente herda o acesso '
  'atual do proprietário recortado por estas colunas — nunca o contrário.';
comment on column ideworks.integration_grants.owner_id is
  'Pessoa responsável. Tem de existir em profiles; não se cria conta no Auth.';
comment on column ideworks.integration_grants.oauth_client_id is
  'Identificador do cliente OAuth (Codex, Claude, ChatGPT, n8n…). Não é o '
  'cliente da carteira.';
comment on column ideworks.integration_grants.allowed_company_ids is
  'Allowlist de empresas. Null = as que o responsável alcança agora; vazio = nenhuma.';
comment on column ideworks.integration_grants.policy_version is
  'Sobe quando capacidade, alcance, prazo ou revogação mudam. Token da F16.2 '
  'amarra nesta revisão para uma concessão alterada invalidar o que já foi emitido.';

create unique index integration_grants_live_client_idx
  on ideworks.integration_grants (owner_id, oauth_client_id)
  where revoked_at is null;

create index integration_grants_owner_idx
  on ideworks.integration_grants (owner_id, revoked_at);

-- Versão da política é do servidor. Aceitar o número que o cliente mandou
-- permitiria baixar a revisão depois de estreitar o alcance, e um token antigo
-- voltaria a passar. O gatilho ignora o valor recebido e só incrementa quando
-- o recorte de verdade muda.
create function ideworks.bump_grant_policy_version()
  returns trigger
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
begin
  new.policy_version := old.policy_version;
  new.updated_at := now();
  if new.capabilities is distinct from old.capabilities
     or new.allowed_company_ids is distinct from old.allowed_company_ids
     or new.allowed_client_ids is distinct from old.allowed_client_ids
     or new.revoked_at is distinct from old.revoked_at
     or new.expires_at is distinct from old.expires_at then
    new.policy_version := old.policy_version + 1;
  end if;
  return new;
end;
$fn$;

create trigger integration_grants_policy_version
  before update on ideworks.integration_grants
  for each row execute function ideworks.bump_grant_policy_version();

-- --- credencial opaca de automação -------------------------------------------
create table ideworks.integration_credentials (
  id               uuid primary key default gen_random_uuid(),
  grant_id         uuid not null,
  responsible_id   uuid not null references ideworks.profiles (id) on delete cascade,
  -- Impressão digital SHA-256 em hex, 64 caracteres. O segredo NUNCA entra.
  -- O CHECK recusa texto solto: uma credencial em claro não tem 64 hex.
  secret_verifier  text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  last_used_at     timestamptz,

  unique (secret_verifier),
  foreign key (grant_id, responsible_id)
    references ideworks.integration_grants (id, owner_id)
    on delete cascade,

  constraint integration_credentials_verifier_sha256
    check (secret_verifier ~ '^[0-9a-f]{64}$'),
  constraint integration_credentials_revoked_sane
    check (revoked_at is null or revoked_at >= created_at)
);

comment on table ideworks.integration_credentials is
  'Credencial de automação. O responsável é o dono da concessão — a FK composta '
  'impede amarrar a outro perfil, e nenhum insert cria conta no Auth.';
comment on column ideworks.integration_credentials.secret_verifier is
  'SHA-256 do segredo, hex. Perdido, gira-se outro. Igual a invitations.code_hash.';
comment on column ideworks.integration_credentials.responsible_id is
  'Humano existente em profiles. É o owner_id da concessão, por construção.';

create index integration_credentials_grant_idx
  on ideworks.integration_credentials (grant_id);

-- --- leitores da sessão (F16.1 acrescenta quatro GUCs) -----------------------
-- current_setting(..., true) devolve nulo quando a variável não foi definida,
-- e nulo cai nas políticas como "sem integração". Ator humano não declara nada
-- além do que já declarava; withActor zera as quatro para não herdar recorte.

create function ideworks.acting_integration_id() returns uuid
  language sql stable as $fn$
  select nullif(current_setting('app.integration_id', true), '')::uuid
$fn$;

create function ideworks.acting_grant_id() returns uuid
  language sql stable as $fn$
  select nullif(current_setting('app.grant_id', true), '')::uuid
$fn$;

create function ideworks.acting_integration_owner_id() returns uuid
  language sql stable as $fn$
  select nullif(current_setting('app.integration_owner_id', true), '')::uuid
$fn$;

create function ideworks.acting_execution_origin() returns text
  language sql stable as $fn$
  select nullif(current_setting('app.execution_origin', true), '')
$fn$;

comment on function ideworks.acting_grant_id() is
  'Concessão declarada nesta transação. Nulo no caminho humano.';
comment on function ideworks.acting_integration_owner_id() is
  'Proprietário da integração, distinto da origem (MCP/HTTP/automação). '
  'Tem de coincidir com app.user_id — o RLS antigo continua vendo a pessoa.';
comment on function ideworks.acting_execution_origin() is
  'mcp, http ou automation. Vazio é a interface humana.';

-- A concessão está viva, pertence à pessoa declarada, e essa pessoa está ativa.
-- security definer: lê grants/profiles sem morder a própria política.
create function ideworks.acting_grant_is_live()
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select exists (
    select 1
      from ideworks.integration_grants g
      join ideworks.profiles p on p.id = g.owner_id
     where g.id = ideworks.acting_grant_id()
       and g.owner_id = ideworks.acting_user_id()
       and g.owner_id = ideworks.acting_integration_owner_id()
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       and p.is_active
  )
$fn$;

comment on function ideworks.acting_grant_is_live() is
  'A concessão da sessão existe, não venceu, não foi revogada, e o dono é a '
  'pessoa ativa declarada. Papel de administrador não entra nesta pergunta.';

-- Sem concessão na sessão: verdadeiro, para o caminho humano não mudar.
-- Com concessão: só o que ela lista. is_superadmin NÃO acrescenta capacidade.
create function ideworks.integration_allows_capability(p_capability text)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
    when ideworks.acting_grant_id() is null then true
    else ideworks.acting_grant_is_live()
     and exists (
           select 1 from ideworks.integration_grants g
            where g.id = ideworks.acting_grant_id()
              and p_capability = any (g.capabilities::text[]))
  end
$fn$;

comment on function ideworks.integration_allows_capability(text) is
  'Capacidade efetiva da integração. Administrador com concessão só-leitura '
  'continua sem comments:write e sem tasks:move.';

-- Empresa que o RESPONSÁVEL alcança agora. O topo atravessa; quem administra
-- respeita user_categories — a mesma parede da F17.32. Sem isto, perder a
-- empresa na ficha deixaria a concessão antiga aberta.
create function ideworks.owner_currently_reaches_company(p_category_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_super()
      or exists (
           select 1 from ideworks.user_categories uc
            where uc.user_id = ideworks.acting_user_id()
              and uc.category_id = p_category_id)
$fn$;

create function ideworks.integration_allows_company(p_category_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
    when ideworks.acting_grant_id() is null then true
    else ideworks.acting_grant_is_live()
     and ideworks.owner_currently_reaches_company(p_category_id)
     and exists (
           select 1 from ideworks.integration_grants g
            where g.id = ideworks.acting_grant_id()
              and (
                g.allowed_company_ids is null
                or p_category_id = any (g.allowed_company_ids)
              ))
  end
$fn$;

comment on function ideworks.integration_allows_company(uuid) is
  'Empresa efetiva: allowlist da concessão ∩ alcance atual do responsável. '
  'Perder a empresa na ficha perde a empresa no agente, mesmo com a '
  'concessão intacta.';

create function ideworks.integration_allows_client(p_client_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
    when ideworks.acting_grant_id() is null then true
    else ideworks.acting_grant_is_live()
     and ideworks.can_see_client(p_client_id)
     and exists (
           select 1
             from ideworks.integration_grants g
             join ideworks.clients c on c.id = p_client_id
            where g.id = ideworks.acting_grant_id()
              and (g.allowed_client_ids is null
                   or p_client_id = any (g.allowed_client_ids))
              and ideworks.integration_allows_company(c.category_id))
  end
$fn$;

-- Tarefa visível não vaza relação cuja leitura não foi concedida.
-- Sem concessão na sessão, devolve o que recebeu (caminho humano).
create function ideworks.project_task_relations(
  p_client jsonb,
  p_people jsonb,
  p_comments jsonb
)
  returns table (client jsonb, people jsonb, comments jsonb)
  language sql stable
as $fn$
  select
    case when ideworks.integration_allows_capability('clients:read')
         then p_client else null end,
    case when ideworks.integration_allows_capability('people:read')
         then p_people else null end,
    case when ideworks.integration_allows_capability('comments:read')
         then p_comments else null end
$fn$;

comment on function ideworks.project_task_relations(jsonb, jsonb, jsonb) is
  'Recorta cliente, pessoa e comentário da ficha da tarefa. Identificador e '
  'título ficam fora: são a própria tarefa, não uma relação.';

-- --- RLS ---------------------------------------------------------------------
-- Sem política, o Postgres nega. Políticas partidas em select/insert/update/
-- delete: `for all` inclui select e reabriria o que o recorte da concessão
-- fechou — a lição da F17.32b.

alter table ideworks.integration_grants enable row level security;
alter table ideworks.integration_credentials enable row level security;

-- Humano (sem grant_id na sessão) vê as próprias; o topo vê todas.
-- Agente vê só a concessão que ele mesmo declarou — não lista as outras do dono.
create policy integration_grants_select on ideworks.integration_grants
  for select to ideworks_app
  using (
    ideworks.acting_user_id() is not null
    and (
      (
        owner_id = ideworks.acting_user_id()
        and (
          ideworks.acting_grant_id() is null
          or id = ideworks.acting_grant_id()
        )
      )
      or (
        ideworks.acting_is_super()
        and ideworks.acting_grant_id() is null
      )
    )
  );

-- Agente não cria concessão. Humano dono cria a sua; o topo pode criar para outro.
create policy integration_grants_insert on ideworks.integration_grants
  for insert to ideworks_app
  with check (
    ideworks.acting_grant_id() is null
    and ideworks.acting_user_id() is not null
    and (
      owner_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  );

create policy integration_grants_update on ideworks.integration_grants
  for update to ideworks_app
  using (
    ideworks.acting_grant_id() is null
    and (
      owner_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  )
  with check (
    ideworks.acting_grant_id() is null
    and (
      owner_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  );

create policy integration_grants_delete on ideworks.integration_grants
  for delete to ideworks_app
  using (
    ideworks.acting_grant_id() is null
    and (
      owner_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  );

-- Credencial: só o humano responsável (ou o topo) lê o verificador.
-- Agente não enumera hash. A conferência do segredo, na F16.2, entra por
-- função própria — não por SELECT aberto na tabela.
create policy integration_credentials_select on ideworks.integration_credentials
  for select to ideworks_app
  using (
    ideworks.acting_grant_id() is null
    and (
      responsible_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  );

create policy integration_credentials_insert on ideworks.integration_credentials
  for insert to ideworks_app
  with check (
    ideworks.acting_grant_id() is null
    and (
      responsible_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  );

create policy integration_credentials_update on ideworks.integration_credentials
  for update to ideworks_app
  using (
    ideworks.acting_grant_id() is null
    and (
      responsible_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  )
  with check (
    ideworks.acting_grant_id() is null
    and (
      responsible_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  );

create policy integration_credentials_delete on ideworks.integration_credentials
  for delete to ideworks_app
  using (
    ideworks.acting_grant_id() is null
    and (
      responsible_id = ideworks.acting_user_id()
      or ideworks.acting_is_super()
    )
  );

-- --- privilégios -------------------------------------------------------------
-- Tabela nova não herda o `grant all on all tables` de 2026-08-24. Sem as
-- linhas abaixo o Worker levaria "permission denied", que é erro de dono, não
-- de política. anon/authenticated não recebem nada: a API humana não fala
-- com estas tabelas, e o agente não conecta como JWT do Supabase.

revoke all on table ideworks.integration_grants from public, anon, authenticated;
revoke all on table ideworks.integration_credentials from public, anon, authenticated;
grant select, insert, update, delete on ideworks.integration_grants to ideworks_app;
grant select, insert, update, delete on ideworks.integration_credentials to ideworks_app;

revoke all on function ideworks.acting_integration_id() from public;
revoke all on function ideworks.acting_grant_id() from public;
revoke all on function ideworks.acting_integration_owner_id() from public;
revoke all on function ideworks.acting_execution_origin() from public;
revoke all on function ideworks.acting_grant_is_live() from public;
revoke all on function ideworks.integration_allows_capability(text) from public;
revoke all on function ideworks.owner_currently_reaches_company(uuid) from public;
revoke all on function ideworks.integration_allows_company(uuid) from public;
revoke all on function ideworks.integration_allows_client(uuid) from public;
revoke all on function ideworks.project_task_relations(jsonb, jsonb, jsonb) from public;

grant execute on function ideworks.acting_integration_id() to ideworks_app;
grant execute on function ideworks.acting_grant_id() to ideworks_app;
grant execute on function ideworks.acting_integration_owner_id() to ideworks_app;
grant execute on function ideworks.acting_execution_origin() to ideworks_app;
grant execute on function ideworks.acting_grant_is_live() to ideworks_app;
grant execute on function ideworks.integration_allows_capability(text) to ideworks_app;
grant execute on function ideworks.owner_currently_reaches_company(uuid) to ideworks_app;
grant execute on function ideworks.integration_allows_company(uuid) to ideworks_app;
grant execute on function ideworks.integration_allows_client(uuid) to ideworks_app;
grant execute on function ideworks.project_task_relations(jsonb, jsonb, jsonb) to ideworks_app;
