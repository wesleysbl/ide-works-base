-- =============================================================================
-- ROLLBACK da F17.39b — o convite de quem ja tem conta define a senha
-- =============================================================================
-- VOLTA O DEFEITO, E ELE E O DE 19 PESSOAS: quem ja tem conta no cadastro
-- compartilhado — que hoje e a MAIORIA da agencia — volta a digitar uma senha
-- que sera descartada, e a so descobrir isso depois, na tela de fim.
--
-- VOLTE O CODIGO JUNTO. A rota de ativacao chama `ideworks.find_invite_account`
-- e a rota do convite chama `ideworks.purpose_for_new_invitation` DENTRO do
-- insert. Apagar as duas sem desfazer as rotas troca a tela em portugues por um
-- erro de banco — que e pior do que o defeito original, porque agora ele nao
-- diz nada. E o convite deixaria de ser criado.
--
-- AS LINHAS PENDENTES VOLTAM A SER CONVITE COMUM, e isso e o unico jeito
-- honesto: uma linha `invite_with_password` num sistema que nao sabe mais o que
-- isso e seria recusada por `aplicar_convite` com a frase da redefinicao de
-- senha, e a pessoa ficaria trancada sem entender. Convertida, ela volta a ser
-- o que era antes desta etapa — um convite que vincula e nao toca a senha.
--
-- O QUE ESTE ARQUIVO NAO DESFAZ, E DE PROPOSITO
--   Nenhuma senha ja definida por este caminho. A pessoa escolheu aquela senha,
--   entrou com ela e esta trabalhando; devolver a antiga tiraria o acesso de
--   gente de verdade, e nao ha para onde "devolver" — a antiga nunca foi
--   guardada em lugar nenhum. Nenhum perfil criado tambem sai: quem entrou,
--   entrou por decisao de quem convidou. E nenhuma conta e tocada aqui — este
--   projeto nao apaga conta.
--
--   O valor `invite_with_password` continua no tipo. Ver o rollback da F17.39.
-- =============================================================================

-- --- 1. as linhas pendentes voltam a ser convite comum ------------------------
update ideworks.invitations
   set purpose = 'invite'
 where purpose = 'invite_with_password'
   and status = 'pending';

-- --- 2. as duas portas novas saem --------------------------------------------
drop function if exists ideworks.find_invite_account(text, uuid);
drop function if exists ideworks.purpose_for_new_invitation(text);

-- --- 3. aplicar_convite volta a recusar tudo o que nao e `invite` -------------
-- Corpo identico ao da F17.31, que era o vigente ate a F17.39b.
create or replace function ideworks.aplicar_convite(
  p_user_id uuid, p_email text, p_invitation_id uuid, p_full_name text
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_categories uuid[];
  v_areas ideworks.area[];
  v_role ideworks.papel;
  v_sugerido text;
  v_nome text;
  v_purpose ideworks.invitation_purpose;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra aplica um convite' using errcode = '42501';
  end if;

  select categories, areas, role, full_name, purpose
    into v_categories, v_areas, v_role, v_sugerido, v_purpose
    from ideworks.invitations
   where id = p_invitation_id and status = 'pending';

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
  end if;

  if v_purpose <> 'invite' then
    raise exception 'este codigo serve para escolher uma senha nova, e nao para dar acesso'
      using errcode = '42501';
  end if;

  v_nome := coalesce(
    nullif(regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), ''),
    nullif(regexp_replace(btrim(coalesce(v_sugerido, '')), '\s+', ' ', 'g'), ''));

  insert into ideworks.profiles (id, email, full_name, is_active, role)
  values (p_user_id, p_email, v_nome, true, v_role)
  on conflict (id) do update set
    is_active = true,
    role = excluded.role,
    full_name = coalesce(excluded.full_name, ideworks.profiles.full_name),
    updated_at = now();

  if array_length(v_areas, 1) is not null then
    update ideworks.profiles set areas = v_areas, updated_at = now()
     where id = p_user_id;
  end if;

  delete from ideworks.user_categories where user_id = p_user_id;
  if array_length(v_categories, 1) is not null then
    insert into ideworks.user_categories (user_id, category_id)
    select p_user_id, unnest(v_categories)
    on conflict do nothing;
  end if;

  update ideworks.invitations
     set status = 'used', used_at = now()
   where id = p_invitation_id;
end;
$fn$;

comment on function ideworks.aplicar_convite(uuid, text, uuid, text) is
  'Cria o perfil E aplica nome, empresa, areas e papel prometidos no convite, '
  'numa transacao so. RECUSA codigo de redefinicao de senha (F17.31): aquele '
  'nasce sem acesso escolhido, e aplica-lo apagaria a empresa e as areas de '
  'quem so quis trocar a senha.';

-- --- 4. a fila volta a devolver a intencao crua -------------------------------
-- Corpo identico ao da F17.34b.
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
       and ideworks.can_see_invitation(i.email, i.created_by, i.categories)
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
