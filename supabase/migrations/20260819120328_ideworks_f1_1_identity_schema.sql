-- =============================================================================
-- IDE WORKS — F1.1  Modelo de identidade
-- =============================================================================
-- Este schema pertence ao IDE WORKS, o sistema novo. NADA aqui tem relacao com
-- o Sistema IDE legado, que vive inteiro no schema `public`.
--
--   ideworks.*  ->  sistema NOVO  (IDE Works)
--   public.*    ->  sistema ANTIGO (Sistema IDE) — nao tocar
--
-- Convencao (decisao D5 do roteiro mestre): identificadores em ingles,
-- interface em portugues.
--
-- Comportamento de acesso conforme COMO-FUNCIONA-O-ACESSO.md: ninguem se
-- cadastra sozinho; toda conta nasce de convite com codigo de uso unico.
--
-- ATENCAO: `auth.users` e COMPARTILHADO com o sistema legado neste projeto.
-- Nenhuma migration do IDE Works pode criar ou apagar usuario.
-- =============================================================================

create schema if not exists ideworks;

comment on schema ideworks is
  'Sistema NOVO (IDE Works). O Sistema IDE legado vive em public. Nao misturar.';

-- --- tipos --------------------------------------------------------------------
-- Regra 3 do roteiro: falhar alto em valor desconhecido. Enum, nunca texto livre
-- com fallback silencioso — foi assim que o legado fez video valer peso 1.

do $$ begin
  create type ideworks.invitation_status as enum ('pending', 'used', 'expired', 'revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ideworks.attempt_scope as enum ('email', 'ip');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ideworks.attempt_purpose as enum ('activation', 'login');
exception when duplicate_object then null; end $$;

-- --- profiles -----------------------------------------------------------------
create table if not exists ideworks.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null,
  full_name       text,
  is_superadmin   boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table ideworks.profiles is
  'Perfil do IDE Works. Referencia auth.users, que e COMPARTILHADO com o legado: '
  'existir aqui e o que da acesso ao IDE Works, nao o mero existir em auth.users.';
comment on column ideworks.profiles.is_active is
  'Conta desativada tem senha valida e mesmo assim e barrada, com motivo proprio. Reversivel.';

create unique index if not exists profiles_email_key on ideworks.profiles (lower(email));

-- --- invitations --------------------------------------------------------------
create table if not exists ideworks.invitations (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  code_hash       text not null,
  status          ideworks.invitation_status not null default 'pending',
  expires_at      timestamptz not null,
  failed_attempts integer not null default 0,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  used_at         timestamptz,
  constraint invitations_failed_attempts_sane check (failed_attempts >= 0)
);

comment on table ideworks.invitations is
  'Convite de acesso. Redefinir senha gera um convite novo — um mecanismo so.';
comment on column ideworks.invitations.code_hash is
  'SHA-256 do codigo. O codigo NUNCA e guardado: perdido, gera-se outro. '
  'Conferencia deve ser em tempo constante.';
comment on column ideworks.invitations.failed_attempts is
  'Teto de 10 ao longo da vida do convite. Passou disso, o convite trava.';

create index if not exists invitations_email_pending_idx
  on ideworks.invitations (lower(email)) where status = 'pending';

-- --- auth_attempts ------------------------------------------------------------
create table if not exists ideworks.auth_attempts (
  id           bigint generated always as identity primary key,
  scope        ideworks.attempt_scope not null,
  scope_key    text not null,
  purpose      ideworks.attempt_purpose not null,
  occurred_at  timestamptz not null default now()
);

comment on table ideworks.auth_attempts is
  'Limitador de tentativas. Mora no BANCO de proposito: contador em memoria de '
  'servidor nao funciona com mais de uma instancia — da a aparencia de uma trava '
  'sem ser uma. Dois tetos que nao se substituem: por conta e por origem.';

create index if not exists auth_attempts_window_idx
  on ideworks.auth_attempts (purpose, scope, scope_key, occurred_at desc);

-- --- admin_audit --------------------------------------------------------------
create table if not exists ideworks.admin_audit (
  id            bigint generated always as identity primary key,
  actor_id      uuid,
  actor_email   text not null,
  action        text not null,
  target_id     uuid,
  target_email  text,
  context       jsonb,
  occurred_at   timestamptz not null default now()
);

comment on table ideworks.admin_audit is
  'Livro de decisoes administrativas. Guarda COPIAS, nao atalhos: o e-mail do alvo '
  'vai em texto, sem chave estrangeira, para o livro continuar legivel depois de a '
  'conta ser excluida. Ninguem logado escreve aqui — nem superadmin.';
comment on column ideworks.admin_audit.context is
  'Campo livre. Um filtro recursivo DESCARTA qualquer chave que sugira segredo '
  '(senha, codigo, token, hash, chave, secret) antes de gravar. Apaga em vez de '
  'mascarar: saber o tamanho ja ajuda quem procura.';

create index if not exists admin_audit_occurred_idx on ideworks.admin_audit (occurred_at desc);
create index if not exists admin_audit_target_idx on ideworks.admin_audit (target_id);

-- --- RLS ----------------------------------------------------------------------
-- Regra 5 do roteiro: RLS em toda tabela, sem excecao. Nenhuma policy e criada
-- aqui de proposito — sem policy, o Postgres nega tudo. As permissoes de leitura
-- entram nas etapas que realmente precisam delas (F1.7), nunca antes.

alter table ideworks.profiles      enable row level security;
alter table ideworks.invitations   enable row level security;
alter table ideworks.auth_attempts enable row level security;
alter table ideworks.admin_audit   enable row level security;

-- O schema NAO e exposto na API por padrao (so `public` e os schemas listados na
-- configuracao do projeto). Isso e uma protecao, nao um esquecimento: expor exige
-- decisao explicita.
revoke all on schema ideworks from anon, authenticated;
revoke all on all tables in schema ideworks from anon, authenticated;
