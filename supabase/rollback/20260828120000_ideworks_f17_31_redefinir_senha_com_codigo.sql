-- =============================================================================
-- ROLLBACK da F17.31 — redefinir senha, com codigo
-- =============================================================================
-- VOLTA O BURACO: ninguem redefine a senha de ninguem. Quem escolheu uma senha
-- que foi descartada pelo caminho de vinculo da F17.30 fica de fora do sistema
-- ate alguem reaplicar esta migration.
--
-- VOLTE O CODIGO JUNTO. A rota `POST /admin/people/:id/password-reset` chama
-- `ideworks.issue_password_reset`, e `POST /auth/reset-password` chama
-- `ideworks.find_reset_account`. Apagar as duas sem desfazer as rotas troca
-- uma frase em portugues por um erro de banco na tela — que e pior que o
-- defeito original, porque nao diz nada a quem esta trancado do lado de fora.
--
-- ⚠️ A ORDEM IMPORTA: a coluna `purpose` so cai DEPOIS de `aplicar_convite`
-- voltar a ser a versao da F17.29, que nao a le. Ao contrario, a funcao ficaria
-- apontando para uma coluna que nao existe e a ativacao inteira pararia.
--
-- ⚠️ O QUE ESTE ARQUIVO NAO DESFAZ, E DE PROPOSITO
--   · nenhuma senha trocada volta ao que era. Senha nao tem historico, e
--     escrever a antiga de novo exigiria conhece-la — este projeto nunca a
--     conheceu;
--   · nenhuma linha de auditoria e apagada. O livro nao se reescreve: e a
--     unica coisa que compensa o risco de quem gera o codigo poder usa-lo;
--   · nenhuma conta e criada ou apagada aqui. Nunca.
--
-- As linhas de intencao `reset` que ainda estiverem pendentes viram convite
-- comum ao perder a coluna. Por isso elas sao REVOGADAS antes: um codigo de
-- senha que virasse codigo de acesso daria a quem o tem o papel padrao e o
-- perfil — que e exatamente o que a guarda de `aplicar_convite` impedia.
-- =============================================================================

-- 1. os codigos de senha pendentes morrem, antes de perderem a intencao.
update ideworks.invitations set status = 'revoked'
 where status = 'pending' and purpose = 'reset';

-- 2. a fila volta a listar so o que listava.
drop function if exists ideworks.admin_pending_invitations();

create function ideworks.admin_pending_invitations()
  returns table (
    id uuid, email text, expires_at timestamptz,
    failed_attempts integer, created_at timestamptz, vencido boolean
  )
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve a fila' using errcode = '42501';
  end if;

  return query
    select i.id, i.email, i.expires_at, i.failed_attempts, i.created_at,
           i.expires_at < now()
      from ideworks.invitations i
     where i.status = 'pending'
     order by i.created_at desc;
end;
$fn$;

grant execute on function ideworks.admin_pending_invitations() to ideworks_app;

-- 3. as duas portas da redefinicao somem.
drop function if exists ideworks.find_reset_account(text, uuid);
drop function if exists ideworks.issue_password_reset(uuid, text, timestamptz);

-- 4. `aplicar_convite` volta a versao da F17.29 — sem a leitura da intencao.
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
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra aplica um convite' using errcode = '42501';
  end if;

  select categories, areas, role, full_name
    into v_categories, v_areas, v_role, v_sugerido
    from ideworks.invitations
   where id = p_invitation_id and status = 'pending';

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
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

-- 5. so entao a coluna e o tipo.
alter table ideworks.invitations drop column if exists purpose;
drop type if exists ideworks.invitation_purpose;

comment on table ideworks.invitations is
  'Convite de acesso. Redefinir senha gera um convite novo — um mecanismo so.';
