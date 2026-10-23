-- =============================================================================
-- ROLLBACK da F17.34b — a regra do convite volta a LER a tabela do convite
-- =============================================================================
-- ⚠️ ISTO QUEBRA `insert ... returning` EM `ideworks.invitations`, DE NOVO
--   Voltar `can_see_invitation` para a assinatura por identificador faz a
--   politica de leitura da tabela ir BUSCAR a linha na propria tabela. Como a
--   funcao e `stable`, ela enxerga o retrato de antes da instrucao — onde a
--   linha recem-inserida ainda nao existe — e o `returning` e recusado com
--   "new row violates row-level security policy for table invitations".
--
--   Nao e falha teorica: foi medida em 2026-08-28 em
--   `scripts/provar-nome-da-pessoa.mjs` e `scripts/provar-redefinir-senha.mjs`,
--   e foi por isso que a F17.34b existe.
--
--   Aplicar este arquivo exige, junto, trocar todo `insert ... returning` sobre
--   `ideworks.invitations` por insercao com identificador gerado de fora — do
--   jeito que a F17.32b fez em `src/server/client-write.ts`. Sem isso, cadastrar
--   convite pelos scripts de prova para de funcionar.
--
-- O QUE ELE NAO DESFAZ, E DE PROPOSITO
--   Nenhum dado, e nenhuma regra. Os tres ramos sao os mesmos nas duas versoes:
--   este arquivo troca COMO a regra e perguntada, e nao O QUE ela responde.
--
-- ORDEM
--   A funcao velha volta primeiro, porque as politicas passam a chama-la; a
--   nova sai por ultimo, quando ninguem mais depende dela.
-- =============================================================================

-- --- 1. a assinatura por identificador volta ---------------------------------
create or replace function ideworks.can_see_invitation(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select exists (
    select 1
      from ideworks.invitations i
     where i.id = target
       and (
         -- o topo atravessa
         ideworks.acting_is_super()

         -- e so quem administra ve fila de convite, como sempre foi
         or (ideworks.acting_is_superadmin() and (

              -- FOI VOCE QUEM CONVIDOU: ninguem perde de vista o proprio
              -- convite. E o equivalente, para o convite, de "ninguem some da
              -- propria tela".
              i.created_by = ideworks.acting_user_id()

              -- JA HA CONTA COM ESTE E-MAIL: o convite segue a pessoa.
              or exists (
                   select 1 from ideworks.profiles p
                    where lower(p.email) = lower(i.email)
                      and ideworks.can_see_person(p.id))

              -- AINDA NAO HA CONTA: vale a empresa marcada no convite, pela
              -- mesma regra de tres ramos — compartilha, ou nenhuma marcada.
              or (not exists (
                    select 1 from ideworks.profiles p
                     where lower(p.email) = lower(i.email))
                  and (coalesce(array_length(i.categories, 1), 0) = 0
                       or exists (
                            select 1 from ideworks.user_categories minha
                             where minha.user_id = ideworks.acting_user_id()
                               and minha.category_id = any(i.categories))))
            ))
       ))
$fn$;

comment on function ideworks.can_see_invitation(uuid) is
  'A UNICA regra de quem enxerga qual convite — F17.34. Se ja ha conta com o '
  'e-mail, o convite segue a PESSOA (senao um codigo de senha, que nasce sem '
  'empresa, entregaria o e-mail de quem e de outra empresa). Se nao ha conta, '
  'vale a empresa marcada no convite. Quem convidou sempre ve o proprio.';

grant execute on function ideworks.can_see_invitation(uuid) to ideworks_app;

-- --- 2. as duas politicas voltam a perguntar pelo identificador --------------
drop policy if exists invitations_select on ideworks.invitations;
create policy invitations_select on ideworks.invitations for select using (
  ideworks.is_preauth() or ideworks.can_see_invitation(id)
);

drop policy if exists invitations_update on ideworks.invitations;
create policy invitations_update on ideworks.invitations for update
  using (
    ideworks.is_preauth()
    or (ideworks.acting_is_superadmin() and ideworks.can_see_invitation(id)))
  with check (ideworks.acting_is_superadmin() or ideworks.is_preauth());

-- --- 3. a fila e o cancelamento, como a F17.34 os deixou ---------------------
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
       -- ⚠️ F17.34. A fila mostrava o e-mail de quem esta sendo convidado para
       -- QUALQUER empresa.
       and ideworks.can_see_invitation(i.id)
     order by i.created_at desc;
end;
$fn$;

comment on function ideworks.admin_pending_invitations() is
  'Os codigos que existem e ainda nao foram usados — de acesso e de senha, '
  'ditos pela intencao. O de senha entra aqui desde a F17.31 porque codigo '
  'pendente e credencial viva: escondido, ninguem o cancelaria. F17.34: a fila '
  'passou a respeitar a empresa, pela regra de `can_see_invitation`.';

revoke all on function ideworks.admin_pending_invitations() from public;
grant execute on function ideworks.admin_pending_invitations() to ideworks_app;

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
  --
  -- ⚠️ F17.34: e so o convite que quem administra enxerga. A frase de recusa
  -- ja existente serve para os dois casos, e e a certa: para ele, aquele
  -- convite nao existe.
  delete from ideworks.invitations
   where id = p_id and status = 'pending' and ideworks.can_see_invitation(p_id);

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
  end if;
end;
$fn$;

-- --- 4. e a assinatura por colunas sai ---------------------------------------
drop function if exists ideworks.can_see_invitation(text, uuid, uuid[]);
