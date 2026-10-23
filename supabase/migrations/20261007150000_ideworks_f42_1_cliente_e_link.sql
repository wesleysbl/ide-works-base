-- F42, Fase 1 (parte 1 de 4) — o CLIENTE ganha a chave da aprovação externa e o
-- LINK fixo dele.
--
-- O QUE MUDA
--   1. `clients.approval_enabled` (padrão desligado): só os clientes marcados usam
--      a aprovação por link. Quem liga e desliga é quem já escreve em `clients`
--      (política `clients_update`, só quem administra) — nenhuma política nova.
--   2. `ideworks.client_approval_links`: o link do cliente.
--        · `token_hash`  — SHA-256 em hexadecimal do token, no padrão do convite
--          (`src/auth/activation-code.ts`, `hashCode`). É por ele que o link se
--          resolve; o token cru nunca é gravado.
--        · `token_ciphertext` — o MESMO token, cifrado pelo Worker com a chave
--          que mora em segredo do Worker (fase 3). Existe porque o link é FIXO e
--          a equipe precisa copiá-lo de novo para reenviar pelo WhatsApp. O banco
--          só guarda o texto cifrado; não sabe decifrar.
--        · `created_at/created_by`, `revoked_at/revoked_by` — "gerar novo link"
--          revoga o vivo e cria outro, na mesma transação.
--      SÓ UM LINK VIVO POR CLIENTE: índice único parcial em `client_id` onde
--      `revoked_at is null`. O segundo link vivo é recusado pelo banco, não pela
--      tela.
--   3. `ideworks.resolve_approval_link(token_hash)`: devolve o cliente do link
--      VIVO, de cliente LIGADO e ATIVO — ou nulo. Link revogado, cliente desligado
--      e cliente inativo respondem igual a token inexistente (não revela qual
--      caso). `security definer`: quem chama é a rota pública, sem pessoa
--      declarada; a resposta é só um id, e só para quem tem o hash.
--
-- SEGURANÇA POR LINHA
--   Ler (inclusive o texto cifrado, para "copiar link"): quem enxerga o cliente
--   (`can_see_client`). Criar e revogar: quem administra E enxerga o cliente.
--   Apagar: ninguém — revogar é `update`, e o rastro fica.
--
-- O LINK NÃO SE REESCREVE: só se revoga
--   Três camadas, da mais larga à mais fina: o papel do app só tem `update` nas
--   colunas `revoked_at` e `revoked_by`; a política de update só alcança link
--   VIVO (revogado não volta a ser editável); e o gatilho
--   `client_approval_links_guard` recusa (SQLSTATE `IW042`, hint
--   `link_immutable`) qualquer mudança em hash, texto cifrado, cliente ou
--   criação, e qualquer mudança de link já revogado — desrevogar inclusive. A
--   única exceção é a do próprio banco: apagar a conta de quem criou ou revogou
--   anula `created_by`/`revoked_by` (`on delete set null`), e isso passa.
--
-- IDEMPOTENTE: pode ser aplicada duas vezes.
-- REVERSÃO: `supabase/rollback/20261007150000_ideworks_f42_1_cliente_e_link.sql`.

begin;
set local lock_timeout = '5s';

alter table ideworks.clients
  add column if not exists approval_enabled boolean not null default false;

comment on column ideworks.clients.approval_enabled is
  'F42: aprovação externa ligada. Só cliente ligado tem link que resolve e recebe '
  '"Solicitar aprovação". Desligar derruba o link sem apagá-lo.';

create table if not exists ideworks.client_approval_links (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references ideworks.clients (id) on delete cascade,
  token_hash       text not null,
  token_ciphertext text not null,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users (id) on delete set null,

  constraint client_approval_links_hash_is_sha256
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint client_approval_links_ciphertext_not_blank
    check (btrim(token_ciphertext) <> ''),
  constraint client_approval_links_revoked_coherent
    check (revoked_by is null or revoked_at is not null)
);

create unique index if not exists client_approval_links_hash_key
  on ideworks.client_approval_links (token_hash);

-- O "só um link vivo por cliente", no banco.
create unique index if not exists client_approval_links_one_live
  on ideworks.client_approval_links (client_id) where revoked_at is null;

comment on table ideworks.client_approval_links is
  'F42: o link fixo do cliente para a aprovação externa. Resolve-se por token_hash '
  '(SHA-256 hex); token_ciphertext é o token cifrado pelo Worker, para a equipe '
  'copiar o link de novo. Um único link vivo por cliente (índice parcial).';
comment on column ideworks.client_approval_links.token_ciphertext is
  'Token cifrado pelo Worker (chave em segredo do Worker). O banco não decifra.';

alter table ideworks.client_approval_links enable row level security;

drop policy if exists client_approval_links_select on ideworks.client_approval_links;
create policy client_approval_links_select on ideworks.client_approval_links
  for select using (ideworks.can_see_client(client_id));

drop policy if exists client_approval_links_insert on ideworks.client_approval_links;
create policy client_approval_links_insert on ideworks.client_approval_links
  for insert with check (ideworks.acting_is_superadmin() and ideworks.can_see_client(client_id));

drop policy if exists client_approval_links_update on ideworks.client_approval_links;
create policy client_approval_links_update on ideworks.client_approval_links
  for update using (ideworks.acting_is_superadmin() and ideworks.can_see_client(client_id)
                    and revoked_at is null)
  with check (ideworks.acting_is_superadmin() and ideworks.can_see_client(client_id));

-- Sem política de delete, de propósito: revogar é update.

revoke all on table ideworks.client_approval_links from public, anon, authenticated, ideworks_app;
grant select, insert on table ideworks.client_approval_links to ideworks_app;
grant update (revoked_at, revoked_by) on table ideworks.client_approval_links to ideworks_app;

-- O gatilho vale também para quem não passa pela política (dono da tabela,
-- funções `security definer`): é a regra do link, não do papel.
create or replace function ideworks.client_approval_links_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  -- Conta apagada: o `on delete set null` anula o autor depois que a conta já
  -- saiu de `auth.users`. É o único jeito de um autor virar nulo.
  if new.created_by is distinct from old.created_by
     and not (new.created_by is null
              and not exists (select 1 from auth.users u where u.id = old.created_by)) then
    raise exception 'O link de aprovacao nao se reescreve: so se revoga.'
      using errcode = 'IW042', hint = 'link_immutable';
  end if;

  if new.id is distinct from old.id
     or new.client_id is distinct from old.client_id
     or new.token_hash is distinct from old.token_hash
     or new.token_ciphertext is distinct from old.token_ciphertext
     or new.created_at is distinct from old.created_at then
    raise exception 'O link de aprovacao nao se reescreve: so se revoga.'
      using errcode = 'IW042', hint = 'link_immutable';
  end if;

  -- Revogado é para sempre: nem desrevogar, nem trocar quando nem quem.
  if old.revoked_at is not null
     and (new.revoked_at is distinct from old.revoked_at
          or (new.revoked_by is distinct from old.revoked_by
              and not (new.revoked_by is null
                       and not exists (select 1 from auth.users u where u.id = old.revoked_by)))) then
    raise exception 'Este link ja foi revogado. Gere um link novo.'
      using errcode = 'IW042', hint = 'link_immutable';
  end if;

  return new;
end;
$fn$;

comment on function ideworks.client_approval_links_guard() is
  'F42: o link de aprovação só muda para ser revogado (revoked_at/revoked_by, de nulo '
  'para preenchido). Hash, texto cifrado, cliente e criação são fixos; revogado não '
  'volta. Exceção: conta apagada anula created_by/revoked_by.';

revoke all on function ideworks.client_approval_links_guard() from public, anon, authenticated, ideworks_app;

drop trigger if exists client_approval_links_guard on ideworks.client_approval_links;
create trigger client_approval_links_guard
  before update on ideworks.client_approval_links
  for each row execute function ideworks.client_approval_links_guard();

create or replace function ideworks.resolve_approval_link(p_token_hash text)
  returns uuid
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- Link vivo, de cliente ligado e ativo. Qualquer outro caso: nulo, igual a
  -- token inexistente.
  select l.client_id
    from ideworks.client_approval_links l
    join ideworks.clients c on c.id = l.client_id
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and c.approval_enabled
     and c.is_active
$fn$;

comment on function ideworks.resolve_approval_link(text) is
  'F42: o cliente do link de aprovação VIVO (cliente ligado e ativo), pelo hash do '
  'token; nulo em qualquer outro caso — revogado, desligado, inativo e inexistente '
  'respondem igual.';

revoke all on function ideworks.resolve_approval_link(text) from public, anon, authenticated;
grant execute on function ideworks.resolve_approval_link(text) to ideworks_app;

commit;
