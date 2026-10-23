-- =============================================================================
-- ROLLBACK da F17.36c — administrador reparte, mas so o que ele tem
-- =============================================================================
-- Volta a regra anterior: SO o super admin define empresa, e o convite nao
-- confere empresa nenhuma na politica de escrita.
--
-- ⚠️ O QUE ESTE ROLLBACK NAO DESFAZ
--   As empresas que quem administra tiver concedido enquanto a F17.36c esteve
--   de pe. Elas ficam onde estao — sao vinculos legitimos, feitos por uma regra
--   que valia. Desfaze-los as cegas tiraria acesso de gente que trabalha.
--
--   Se a intencao for justamente reverter concessoes, o `admin_audit` diz quem
--   mexeu no que, e a correcao e a mao, pessoa por pessoa.
--
--   ⚠️ E ele reabre o convite: com a politica velha de volta, quem administra
--   pode marcar QUALQUER empresa num convite pelo banco. O que segura isso na
--   versao velha e a conferencia do servidor em `worker/index.ts` — entao rode
--   este rollback junto com o codigo velho, nunca sozinho.
--
-- A funcao `can_grant_categories` e apagada por ultimo: enquanto a politica
-- velha nao estiver de pe, ela ainda esta em uso.
-- =============================================================================

create or replace function ideworks.set_user_categories(p_user_id uuid, p_ids uuid[])
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  -- SO SUPER ADMIN mexe em empresa. Foi pedido assim, e faz sentido: mudar a
  -- empresa de alguem muda a carteira inteira que ele enxerga de uma vez.
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin define empresas' using errcode = '42501';
  end if;

  if not exists (select 1 from ideworks.profiles where id = p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  delete from ideworks.user_categories where user_id = p_user_id;

  insert into ideworks.user_categories (user_id, category_id)
  select p_user_id, c.id
    from ideworks.client_categories c
   where c.id = any(coalesce(p_ids, '{}'::uuid[]))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

comment on function ideworks.set_user_categories(uuid, uuid[]) is null;

drop policy if exists invitations_insert on ideworks.invitations;
create policy invitations_insert on ideworks.invitations for insert with check (
  ideworks.acting_is_superadmin()
);

drop function if exists ideworks.can_grant_categories(uuid[]);
