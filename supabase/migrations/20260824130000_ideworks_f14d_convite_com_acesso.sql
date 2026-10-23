-- =============================================================================
-- IDE WORKS — F14d  O convite já carrega o acesso
-- =============================================================================
-- O PROBLEMA ERA A JANELA ENTRE DOIS PASSOS
--   Convidava-se a pessoa, ela ativava, e SÓ DEPOIS alguém abria a ficha dela
--   para dizer de qual empresa é e quais telas alcança. Entre uma coisa e outra
--   a pessoa já estava dentro — com o padrão, que é `funcionario` e a área
--   `entrega`.
--
--   Não é buraco de segurança grave: o padrão é o mínimo. É que a decisão de
--   acesso ficava separada do ato de dar acesso, e decisão separada do ato é
--   decisão que alguém esquece.
--
--   Agora quem convida diz TUDO de uma vez, e a ativação só aplica.
--
-- POR QUE A INTENÇÃO MORA NO CONVITE, E NÃO NUM PERFIL CRIADO ANTES
--   Criar o perfil no momento do convite pareceria mais simples, e estaria
--   errado: `profiles.id` aponta para o cadastro de login, que ainda não existe
--   — a pessoa nem escolheu senha. O convite é o único lugar onde a intenção
--   pode esperar.
--
-- QUEM PODE PROMETER O QUÊ
--   `set_user_categories` já exigia super admin para mexer em empresa. O mesmo
--   vale aqui: um administrador comum convida, mas não decide empresa. Sem essa
--   trava, o convite viraria o caminho de contornar a regra — bastaria
--   convidar em vez de editar.
--
--   Vale a pena dizer o que ESTA migração não faz: ela guarda a intenção. Quem
--   a confere é a rota do convite, e quem a aplica é a rota de ativação.
-- =============================================================================

alter table ideworks.invitations
  add column if not exists categories uuid[] not null default '{}',
  add column if not exists areas ideworks.area[] not null default '{}',
  add column if not exists role ideworks.papel not null default 'funcionario';

comment on column ideworks.invitations.categories is
  'De quais empresas a pessoa sera, decidido por quem convidou. Aplicado na '
  'ativacao. Vazio significa nenhuma — e nenhuma empresa e um estado valido: '
  'quem so tem carteira propria nao precisa de empresa.';
comment on column ideworks.invitations.areas is
  'Quais telas a pessoa alcanca. Vazio significa o padrao da coluna de '
  'profiles, e nao "nenhuma" — convite antigo nao tinha esta coluna.';
comment on column ideworks.invitations.role is
  'O papel prometido. Super admin so pode ser prometido por super admin, e a '
  'trava esta na rota — nao aqui, porque o banco nao sabe quem chamou a rota.';

-- --- aplicar a promessa, na ativacao -------------------------------------------
-- Uma funcao, e nao tres comandos soltos na rota: o perfil, as empresas e as
-- areas precisam nascer juntos ou nao nascer. Metade aplicada seria pior que
-- nada — a pessoa entra com acesso que ninguem escolheu.
create or replace function ideworks.aplicar_convite(
  p_user_id uuid, p_email text, p_invitation_id uuid
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_categories uuid[];
  v_areas ideworks.area[];
  v_role ideworks.papel;
begin
  select categories, areas, role
    into v_categories, v_areas, v_role
    from ideworks.invitations
   where id = p_invitation_id and status = 'pending';

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
  end if;

  insert into ideworks.profiles (id, email, is_active, role)
  values (p_user_id, p_email, true, v_role)
  on conflict (id) do update set
    is_active = true,
    role = excluded.role,
    updated_at = now();

  -- `areas` vazio quer dizer "nao foi escolhido", e nao "nenhuma": convite
  -- criado antes desta migracao tem o padrao da coluna. Mexer nele apagaria o
  -- acesso que a coluna de `profiles` ja daria.
  if array_length(v_areas, 1) is not null then
    update ideworks.profiles set areas = v_areas, updated_at = now()
     where id = p_user_id;
  end if;

  -- Empresas SUBSTITUEM o que houver: quem convidou decidiu a lista inteira.
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

grant execute on function ideworks.aplicar_convite(uuid, text, uuid) to ideworks_app;

comment on function ideworks.aplicar_convite(uuid, text, uuid) is
  'Cria o perfil E aplica empresa, areas e papel prometidos no convite, numa '
  'transacao so. Metade aplicada deixaria a pessoa dentro com acesso que '
  'ninguem escolheu.';
