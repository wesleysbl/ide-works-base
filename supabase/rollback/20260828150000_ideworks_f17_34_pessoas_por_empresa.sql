-- =============================================================================
-- ROLLBACK da F17.34 — a tela de Pessoas tambem respeita a empresa
-- =============================================================================
-- ⚠️ ISTO REABRE A FICHA DE TODO MUNDO PARA TODO ADMINISTRADOR
--   Aplicar este arquivo devolve as nove leituras da area de Pessoas ao estado
--   de antes da F17.34: quem administra `Ide`/`Ide Hub` volta a ler a lista
--   inteira de pessoas, as empresas de cada uma, a carteira de cada uma, a fila
--   de convites e o livro de auditoria — Alma 9 inclusa. E volta a poder mudar
--   papel, desativar e gerar codigo de senha de quem nao aparece na tela dele.
--
--   Nao ha "rollback seguro" aqui. Este arquivo existe porque toda migration
--   deste projeto tem irma reversivel, e nao porque reverter seja aceitavel.
--
-- ⚠️ O QUE ELE NAO DESFAZ SOZINHO, E QUE MAIS ENGANA
--   As duas funcoes novas — `can_see_person` e `can_see_invitation` — sao
--   APAGADAS aqui, no fim. Enquanto elas existirem sem que nenhuma politica as
--   consulte, quem for conferir vai ler a regra certa no banco e concluir que a
--   empresa esta valendo. Foi exatamente esse o modo de falhar da F17.32b: a
--   funcao certa, a politica aberta, e o numero errado.
--
--   Elas so podem ser apagadas DEPOIS de todas as politicas voltarem a nao
--   perguntar por elas — por isso o `drop function` e a ultima secao.
--
-- O QUE ELE NAO DESFAZ, E DE PROPOSITO
--   Nenhum dado. A F17.34 nao escreveu uma linha em nenhuma tabela: criou duas
--   funcoes de leitura, reescreveu seis funcoes e trocou politica por politica.
--
-- NENHUM MOMENTO SEM COBERTURA
--   Cada politica e derrubada e recriada na mesma transacao, e `user_clients`
--   volta de tres politicas nomeadas para a `for all` unica que tinha antes —
--   com a advertencia de sempre: `for all` inclui `select`, e e por ele que a
--   carteira de todo mundo volta a ser legivel.
--
-- ⚠️ O ROLLBACK DA F17.34b VEM ANTES DESTE
--   A F17.34b trocou a assinatura de `can_see_invitation` — de `(uuid)` para
--   `(text, uuid, uuid[])` — e apagou a primeira. Este arquivo recria as
--   politicas de `invitations` chamando a versao por identificador, que so
--   volta a existir quando o rollback da F17.34b for aplicado. Aplicar este
--   sozinho falha na secao 1, e falhar ali deixa `invitations` com a politica
--   nova e o resto do schema com a velha — um terceiro estado, que ninguem
--   provou.
--
-- ORDEM
--   Ao contrario da migration, aqui as politicas vem ANTES das funcoes: nada
--   pode consultar `can_see_person` no instante em que ela for apagada.
-- =============================================================================

-- --- 1. as cinco politicas de leitura, como estavam ---------------------------

drop policy if exists profiles_select on ideworks.profiles;
create policy profiles_select on ideworks.profiles for select using (
  id = ideworks.acting_user_id() or ideworks.acting_is_superadmin() or ideworks.is_preauth()
);

drop policy if exists user_categories_select on ideworks.user_categories;
create policy user_categories_select on ideworks.user_categories for select using (
  user_id = ideworks.acting_user_id() or ideworks.acting_is_superadmin()
);

drop policy if exists user_clients_select on ideworks.user_clients;
create policy user_clients_select on ideworks.user_clients for select using (
  user_id = ideworks.acting_user_id() or ideworks.acting_is_superadmin()
);

drop policy if exists invitations_select on ideworks.invitations;
create policy invitations_select on ideworks.invitations for select using (
  ideworks.acting_is_superadmin() or ideworks.is_preauth()
);

drop policy if exists admin_audit_select on ideworks.admin_audit;
create policy admin_audit_select on ideworks.admin_audit for select using (
  ideworks.acting_is_superadmin()
);

-- --- 2. as politicas de escrita, como estavam ---------------------------------

drop policy if exists profiles_update on ideworks.profiles;
create policy profiles_update on ideworks.profiles for update
  using (ideworks.acting_is_superadmin())
  with check (ideworks.acting_is_superadmin());

drop policy if exists invitations_update on ideworks.invitations;
create policy invitations_update on ideworks.invitations for update
  using (ideworks.acting_is_superadmin() or ideworks.is_preauth())
  with check (ideworks.acting_is_superadmin() or ideworks.is_preauth());

-- ⚠️ E o `for all` volta, com o furo de leitura dentro dele.
drop policy if exists user_clients_insert on ideworks.user_clients;
drop policy if exists user_clients_update on ideworks.user_clients;
drop policy if exists user_clients_delete on ideworks.user_clients;

create policy user_clients_write on ideworks.user_clients for all
  using (ideworks.acting_is_superadmin())
  with check (ideworks.acting_is_superadmin());

-- --- 3. as quatro funcoes da tela de Pessoas, sem o filtro --------------------

create or replace function ideworks.admin_directory()
  returns table (
    id uuid, email text, full_name text, role ideworks.papel,
    is_superadmin boolean, is_active boolean, has_all_clients_access boolean,
    areas ideworks.area[], clientes integer, empresas integer,
    created_at timestamptz)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve a lista de pessoas' using errcode = '42501';
  end if;

  return query
    select p.id, p.email, p.full_name, p.role,
           p.is_superadmin, p.is_active, p.has_all_clients_access, p.areas,
           (select count(*)::int from ideworks.user_clients uc where uc.user_id = p.id),
           (select count(*)::int from ideworks.user_categories ucat where ucat.user_id = p.id),
           p.created_at
      from ideworks.profiles p
     order by p.role, p.is_active desc, lower(coalesce(p.full_name, p.email));
end;
$fn$;

-- ⚠️ Ela NAO tinha comentario antes da F17.34 — conferido no banco em
-- 2026-08-28. Devolver `null` e o que faz o retrato de schema voltar a bater;
-- deixar o texto da F17.34 de pe faria o banco descrever uma regra que ele
-- deixou de aplicar, que e o modo de falhar de que este projeto ja tem historico.
comment on function ideworks.admin_directory() is null;

revoke all on function ideworks.admin_directory() from public;
grant execute on function ideworks.admin_directory() to ideworks_app;

create or replace function ideworks.admin_pending_invitations()
  returns table (
    id uuid, email text, expires_at timestamptz, failed_attempts integer,
    created_at timestamptz, vencido boolean, purpose ideworks.invitation_purpose)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve a fila' using errcode = '42501';
  end if;

  return query
    select i.id, i.email, i.expires_at, i.failed_attempts, i.created_at,
           i.expires_at < now(), i.purpose
      from ideworks.invitations i
     where i.status = 'pending'
     order by i.created_at desc;
end;
$fn$;

-- O texto exato que a F17.31 deixou, palavra por palavra.
comment on function ideworks.admin_pending_invitations() is
  'Os codigos que existem e ainda nao foram usados — de acesso e de senha, '
  'ditos pela intencao. O de senha entra aqui desde a F17.31 porque codigo '
  'pendente e credencial viva: escondido, ninguem o cancelaria.';

revoke all on function ideworks.admin_pending_invitations() from public;
grant execute on function ideworks.admin_pending_invitations() to ideworks_app;

create or replace function ideworks.admin_user_categories(p_user_id uuid)
  returns table (category_id uuid, name text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve as empresas de outra pessoa' using errcode = '42501';
  end if;

  return query
    select c.id, c.name
      from ideworks.user_categories uc
      join ideworks.client_categories c on c.id = uc.category_id
     where uc.user_id = p_user_id
     order by lower(c.name);
end;
$fn$;

comment on function ideworks.admin_user_categories(uuid) is null;

revoke all on function ideworks.admin_user_categories(uuid) from public;
grant execute on function ideworks.admin_user_categories(uuid) to ideworks_app;

create or replace function ideworks.admin_user_clients(p_user_id uuid)
  returns table (client_id uuid, name text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador ve a carteira de outra pessoa' using errcode = '42501';
  end if;

  return query
    select c.id, c.name
      from ideworks.user_clients uc
      join ideworks.clients c on c.id = uc.client_id
     where uc.user_id = p_user_id
     order by lower(c.name);
end;
$fn$;

comment on function ideworks.admin_user_clients(uuid) is null;

revoke all on function ideworks.admin_user_clients(uuid) from public;
grant execute on function ideworks.admin_user_clients(uuid) to ideworks_app;

-- --- 4. as seis escritas, sem a linha nova ------------------------------------

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

create or replace function ideworks.set_user_active(p_user_id uuid, p_active boolean)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador ativa ou desativa' using errcode = '42501';
  end if;

  -- Mesma razao da regra acima: desativar a si mesmo tranca a porta por dentro.
  if p_user_id = ideworks.acting_user_id() and not p_active then
    raise exception 'voce nao pode desativar a si mesmo' using errcode = '42501';
  end if;

  update ideworks.profiles
     set is_active = p_active, updated_at = now()
   where id = p_user_id;

  if not found then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_user_role(
    p_user_id uuid, p_role ideworks.papel, p_has_all_clients boolean)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_alvo ideworks.papel;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra muda papel' using errcode = '42501';
  end if;

  select role into v_alvo from ideworks.profiles where id = p_user_id;
  if v_alvo is null then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  -- SO SUPER ADMIN CRIA SUPER ADMIN. Foi o pedido, e sem isso a hierarquia nao
  -- existe: um administrador se promoveria e a distincao viraria enfeite.
  if p_role = 'super_admin' and not ideworks.acting_is_super() then
    raise exception 'so o super admin cria outro super admin' using errcode = '42501';
  end if;

  -- E so super admin MEXE num super admin. Sem isto, um administrador
  -- rebaixaria o super admin e tomaria o lugar dele.
  if v_alvo = 'super_admin' and not ideworks.acting_is_super() then
    raise exception 'so o super admin mexe em outro super admin' using errcode = '42501';
  end if;

  -- NINGUEM SE REBAIXA: o ultimo super admin se trancaria para fora, e nao ha
  -- conserto por dentro.
  if p_user_id = ideworks.acting_user_id() and p_role <> v_alvo then
    raise exception 'voce nao pode mudar o proprio papel' using errcode = '42501';
  end if;

  update ideworks.profiles
     set role = p_role, has_all_clients_access = p_has_all_clients, updated_at = now()
   where id = p_user_id;
end;
$fn$;

create or replace function ideworks.set_user_clients(p_user_id uuid, p_client_ids uuid[])
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador define carteira' using errcode = '42501';
  end if;

  if not exists (select 1 from ideworks.profiles where id = p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  delete from ideworks.user_clients where user_id = p_user_id;

  insert into ideworks.user_clients (user_id, client_id)
  select p_user_id, c.id
    from ideworks.clients c
   where c.id = any(coalesce(p_client_ids, '{}'::uuid[]))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function ideworks.issue_password_reset(
    p_user_id uuid, p_code_hash text, p_expires_at timestamptz)
  returns table (new_invitation_id uuid, target_email text, revoked_count integer)
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.acting_user_id();
  v_actor_email text;
  v_email text;
  v_revoked integer;
  v_id uuid;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra gera um codigo de senha' using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'sem saber quem pediu, nao ha rastro — e sem rastro nao se gera codigo'
      using errcode = '42501';
  end if;

  -- NEM PARA SI MESMO. Quem tem sessao aberta troca a senha por onde se troca
  -- senha; quem nao tem nao chega ate aqui. Permitir aqui so faria o codigo
  -- nunca sair da mao de quem o gerou.
  if v_actor = p_user_id then
    raise exception 'a recuperacao e feita por outra pessoa, e nao por voce mesmo'
      using errcode = '42501';
  end if;

  select p.email into v_email from ideworks.profiles p where p.id = p_user_id;
  if v_email is null then
    raise exception 'nao ha conta do IDE Works para esta pessoa' using errcode = '42501';
  end if;

  select p.email into v_actor_email from ideworks.profiles p where p.id = v_actor;

  -- CODIGOS ANTERIORES MORREM — os dois tipos, e de proposito.
  --
  -- Deixar dois validos ao mesmo tempo dobraria a janela de quem tivesse
  -- interceptado o primeiro, e ninguem saberia qual dos dois foi usado. E o
  -- convite pendente cai junto porque a pessoa ja tem conta: aquele codigo nao
  -- tem mais o que ativar.
  with mortos as (
    update ideworks.invitations
       set status = 'revoked'
     where lower(invitations.email) = lower(v_email)
       and status = 'pending'
    returning 1)
  select count(*)::integer into v_revoked from mortos;

  insert into ideworks.invitations
    (email, code_hash, expires_at, created_by, purpose)
  values (lower(v_email), p_code_hash, p_expires_at, v_actor, 'reset')
  returning id into v_id;

  -- O RASTRO, NA MESMA TRANSACAO. Quem pediu, para quem, e quando.
  --
  -- O e-mail do alvo vai em TEXTO, e nao como referencia: quando a conta for
  -- excluida a referencia apontaria para o nada, e o livro precisa continuar
  -- legivel depois de o mundo ao redor ter mudado.
  insert into ideworks.admin_audit
    (actor_id, actor_email, action, target_id, target_email)
  values (v_actor, coalesce(v_actor_email, 'sistema'),
          'account_password_reset', p_user_id, v_email);

  return query select v_id, lower(v_email), v_revoked;
end;
$fn$;

create or replace function ideworks.revoke_invitation(p_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra cancela convite' using errcode = '42501';
  end if;

  -- Apaga, e nao marca como cancelado: convite pendente e um codigo vivo. Um
  -- registro "cancelado" que continuasse valendo seria o pior dos dois mundos.
  delete from ideworks.invitations where id = p_id and status = 'pending';

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
  end if;
end;
$fn$;

-- --- 5. e so agora as duas funcoes saem --------------------------------------
--
-- ⚠️ Por ultimo, e nao por primeiro: deixar `can_see_person` de pe sem que
-- ninguem a consulte e o pior estado possivel — a regra certa escrita no banco,
-- a tela aberta, e quem conferir lendo a funcao e concluindo que esta fechado.
drop function if exists ideworks.can_see_invitation(uuid);
drop function if exists ideworks.can_see_person(uuid);
