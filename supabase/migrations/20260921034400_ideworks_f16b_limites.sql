-- =============================================================================
-- IDE WORKS — F16.2b  Limites distribuídos e conferência da credencial
-- =============================================================================
-- O PEDIDO
--   O Worker tem várias instâncias. Contar chamada de agente na memória do
--   isolado é a trava de teatro da F1.4: quem espalha nunca reencontra o
--   contador. A revogação já mora em integration_grants; o teto precisa da
--   mesma fonte compartilhada.
--
-- POR QUE FUNÇÕES, E NÃO SELECT ABERTO
--   A conferência do segredo de automação, na F16.1, ficou de propósito fora
--   do SELECT da tabela: o agente não enumera hash. Esta etapa entrega a
--   função security definer que recebe o verificador (SHA-256 hex) e devolve
--   a concessão viva. O limitador segue o mesmo molde — o papel da aplicação
--   executa a função, não vasculha a tabela.
--
-- FALHA FECHADA
--   Sem estas funções o Worker recusa a operação. Diferente do login, que
--   falha aberto se auth_attempts cair.
-- =============================================================================

create table ideworks.integration_rate_events (
  id           bigint generated always as identity primary key,
  scope        text not null,
  scope_key    text not null,
  occurred_at  timestamptz not null default now(),

  constraint integration_rate_events_scope_sane
    check (scope in ('grant', 'owner')),
  constraint integration_rate_events_key_sane
    check (char_length(scope_key) between 1 and 80)
);

comment on table ideworks.integration_rate_events is
  'Contagem distribuída de chamadas de integração. Mora no BANCO de propósito: '
  'contador em memória de isolado não atravessa instância. Dois tetos que não '
  'se substituem: por concessão (grant) e por proprietário (owner).';

create index integration_rate_events_window_idx
  on ideworks.integration_rate_events (scope, scope_key, occurred_at desc);

alter table ideworks.integration_rate_events enable row level security;

-- Sem policy de SELECT/INSERT direto: a aplicação só passa pelas funções.
revoke all on table ideworks.integration_rate_events from public, anon, authenticated;

create function ideworks.integration_rate_count(
  p_scope text,
  p_key text,
  p_since timestamptz
) returns integer
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  select count(*)::int
    from ideworks.integration_rate_events
   where scope = p_scope
     and scope_key = p_key
     and occurred_at >= p_since
     and p_scope in ('grant', 'owner')
$fn$;

create function ideworks.integration_rate_record(
  p_scope text,
  p_key text
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if p_scope not in ('grant', 'owner') then
    raise exception 'escopo de limite de integração inválido';
  end if;
  insert into ideworks.integration_rate_events (scope, scope_key)
  values (p_scope, p_key);
end;
$fn$;

create function ideworks.integration_rate_oldest(
  p_scope text,
  p_key text,
  p_since timestamptz
) returns timestamptz
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  select min(occurred_at)
    from ideworks.integration_rate_events
   where scope = p_scope
     and scope_key = p_key
     and occurred_at >= p_since
     and p_scope in ('grant', 'owner')
$fn$;

comment on function ideworks.integration_rate_count(text, text, timestamptz) is
  'Quantas chamadas desta chave na janela. Security definer: o agente não lê a tabela.';
comment on function ideworks.integration_rate_record(text, text) is
  'Registra uma chamada. Falhar aqui, no Worker, recusa a operação (falha fechada).';

create function ideworks.lookup_live_automation_credential(p_verifier text)
returns table (
  credential_id          uuid,
  grant_id               uuid,
  owner_id               uuid,
  oauth_client_id        text,
  name                   text,
  capabilities           ideworks.integration_capability[],
  allowed_company_ids    uuid[],
  allowed_client_ids     uuid[],
  expires_at             timestamptz,
  revoked_at             timestamptz,
  policy_version         integer,
  credential_expires_at  timestamptz
)
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  select c.id,
         g.id,
         g.owner_id,
         g.oauth_client_id,
         g.name,
         g.capabilities,
         g.allowed_company_ids,
         g.allowed_client_ids,
         g.expires_at,
         g.revoked_at,
         g.policy_version,
         c.expires_at
    from ideworks.integration_credentials c
    join ideworks.integration_grants g on g.id = c.grant_id and g.owner_id = c.responsible_id
    join ideworks.profiles p on p.id = g.owner_id
   where p_verifier ~ '^[0-9a-f]{64}$'
     and c.secret_verifier = p_verifier
     and c.revoked_at is null
     and (c.expires_at is null or c.expires_at > now())
     and g.revoked_at is null
     and (g.expires_at is null or g.expires_at > now())
     and p.is_active
$fn$;

comment on function ideworks.lookup_live_automation_credential(text) is
  'Confere o verificador SHA-256 da credencial de automação e devolve a '
  'concessão viva. Não lista hash. Perfil inativo ou grant revogada somem.';

revoke all on function ideworks.integration_rate_count(text, text, timestamptz) from public;
revoke all on function ideworks.integration_rate_record(text, text) from public;
revoke all on function ideworks.integration_rate_oldest(text, text, timestamptz) from public;
revoke all on function ideworks.lookup_live_automation_credential(text) from public;

grant execute on function ideworks.integration_rate_count(text, text, timestamptz) to ideworks_app;
grant execute on function ideworks.integration_rate_record(text, text) to ideworks_app;
grant execute on function ideworks.integration_rate_oldest(text, text, timestamptz) to ideworks_app;
grant execute on function ideworks.lookup_live_automation_credential(text) to ideworks_app;
