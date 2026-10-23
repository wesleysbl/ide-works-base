-- =============================================================================
-- ROLLBACK — F17.53  O diretorio de responsaveis tambem respeita a empresa
-- =============================================================================
-- Devolve `ideworks.team_directory()` ao corpo da F4.8b — a lista de TODA conta
-- ativa, guardada apenas por `acting_user_id() is not null` — e apaga
-- `can_assign_person`, que nasceu nesta etapa.
--
-- ⚠️ DESFAZER ISTO REABRE O ACHADO A2: o diretorio volta a devolver o nome de
-- quem e de outra empresa para qualquer sessao. So rode se a estreitada tiver
-- quebrado o seletor de responsavel.
--
-- `display_name(uuid)` nao foi tocada pela migration; aqui so o comentario dela
-- volta ao texto da F4.8b.
-- =============================================================================

create or replace function ideworks.team_directory()
  returns table (id uuid, name text)
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select p.id, coalesce(p.full_name, p.email)
    from ideworks.profiles p
   where p.is_active
     and ideworks.acting_user_id() is not null
   order by coalesce(p.full_name, p.email)
$fn$;

comment on function ideworks.team_directory() is
  'Quem pode receber tarefa: identificador e nome das contas ativas. Duas '
  'colunas, de proposito — nao expoe e-mail separado, papel, nem se a pessoa e '
  'administradora.';

-- A F4.8b nao tinha `revoke ... from public` nesta funcao; o rollback nao
-- desfaz o revoke, porque devolver `execute` a PUBLIC seria alargar, e rollback
-- de correcao de seguranca nunca alarga mais do que o que ele desfaz.
grant execute on function ideworks.team_directory() to ideworks_app;

drop function if exists ideworks.can_assign_person(uuid);

comment on function ideworks.display_name(uuid) is
  'Nome de exibicao de uma pessoa, para quem estiver identificado. Existe '
  'porque `profiles_select` so mostra o proprio perfil, e sem isto o nome do '
  'responsavel por uma tarefa viria vazio em vez de errado — silenciosamente. '
  'Devolve NOME ou e-mail, nunca papel nem estado da conta.';
