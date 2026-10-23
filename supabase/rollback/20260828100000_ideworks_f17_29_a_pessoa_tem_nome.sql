-- =============================================================================
-- ROLLBACK da F17.29 — a pessoa tem nome
-- =============================================================================
-- VOLTA O BURACO: quem entrar pelo convite volta a nascer sem nome e a
-- aparecer pelo e-mail na lista de responsaveis, nos avatares do cartao, nos
-- comentarios e em quem observa.
--
-- VOLTE O CODIGO JUNTO. A rota de ativacao chama `aplicar_convite` com QUATRO
-- argumentos; sem desfazer o codigo, a ativacao quebra e a pessoa fica com
-- conta criada no cadastro compartilhado e sem perfil — o mesmo defeito
-- consertado em 2026-08-24. A rota do convite tambem grava a coluna que este
-- arquivo apaga.
--
-- O QUE SE PERDE E NAO VOLTA: a sugestao de nome dos convites ainda
-- PENDENTES. Ela so existe nesta coluna, e nao ha de onde tira-la de volta.
-- Quem ja ativou fica com o nome em `profiles`, que este arquivo nao toca —
-- de proposito: o nome e da pessoa, nao da coluna que o trouxe.
-- =============================================================================

-- A assinatura de tres argumentos volta INTEIRA, como estava DEPOIS DA F14e —
-- com a guarda de quem administra, e nao a versao crua da F14d. Recriar so a
-- assinatura, sem o corpo, deixaria a funcao existindo e sem fazer nada;
-- recriar a versao anterior a F14e desfaria uma correcao de auditoria.
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
  -- A GUARDA QUE FALTAVA. Ver o cabecalho da F14e.
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

grant execute on function ideworks.aplicar_convite(uuid, text, uuid) to ideworks_app;

comment on function ideworks.aplicar_convite(uuid, text, uuid) is
  'Cria o perfil E aplica empresa, areas e papel prometidos no convite, numa '
  'transacao so. Metade aplicada deixaria a pessoa dentro com acesso que '
  'ninguem escolheu.';

drop function if exists ideworks.aplicar_convite(uuid, text, uuid, text);

alter table ideworks.invitations
  drop column if exists full_name;
