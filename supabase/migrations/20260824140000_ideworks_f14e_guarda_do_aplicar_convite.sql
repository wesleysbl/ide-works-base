-- =============================================================================
-- IDE WORKS — F14e  `aplicar_convite` passa a se defender sozinha
-- =============================================================================
-- ACHADO NA AUDITORIA DE 2026-08-24
--   Das 57 funcoes SECURITY DEFINER alcancaveis pelo papel da aplicacao, 56 se
--   protegiam sozinhas. `aplicar_convite` era a unica que nao — ela dependia
--   INTEIRAMENTE de a rota de ativacao estar correta.
--
--   A auditoria a encontrou perguntando ao banco quais funcoes privilegiadas
--   nao mencionam nenhuma das guardas conhecidas. Uma consulta, um achado.
--
-- POR QUE IMPORTA, MESMO SEM CAMINHO DE ATAQUE CONHECIDO
--   Ela concede acesso: cria perfil, define papel, area e empresa. E SECURITY
--   DEFINER, entao roda por cima de toda politica.
--
--   Hoje so a rota de ativacao a chama, e nao ha rota que aceite SQL de fora —
--   entao nao ha exploracao conhecida. Mas "nao ha caminho hoje" e propriedade
--   do codigo de cima, que muda toda semana. A funcao precisa continuar segura
--   quando alguem escrever a rota seguinte sem ler esta.
--
--   O desenho deste projeto e que a guarda mora na funcao. Uma excecao nao e
--   uma excecao: e o comeco da erosao.
--
-- A GUARDA ESCOLHIDA, E AS DUAS QUE NAO SERVIRIAM
--   `acting_is_superadmin()` — o mesmo que a rota ja declara: ela age em nome
--   de QUEM CONVIDOU.
--
--   Exigir a pessoa que esta ativando nao serve: no momento da chamada ela
--   ainda nao tem perfil, que e justamente o que a funcao vai criar. E exigir
--   super admin nao serve: administrador comum tambem convida.
--
--   Continua valendo a trava que ja existia — o convite precisa estar
--   `pending`. E ela que impede reaplicar um convite ja usado.
--
-- CONFERIDO DEPOIS: convite -> ativacao -> login, tudo 200.
-- =============================================================================

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
  -- A GUARDA QUE FALTAVA. Ver o cabecalho.
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra aplica um convite' using errcode = '42501';
  end if;

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
