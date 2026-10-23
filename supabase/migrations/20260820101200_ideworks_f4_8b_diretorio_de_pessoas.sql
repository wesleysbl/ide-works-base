-- =============================================================================
-- IDE WORKS — F4.8b  O diretorio de pessoas
-- =============================================================================
-- O PROBLEMA QUE ISTO RESOLVE, ACHADO ANTES DE LIGAR A TELA
--   `profiles_select` deixa cada pessoa ver O PROPRIO perfil, e mais nada
--   (superadmin ve tudo). Correto para e-mail, papel e estado da conta.
--
--   Mas a aba de demandas precisa de duas coisas triviais: a LISTA de quem pode
--   receber tarefa, e o NOME de quem ja recebeu. Sem isso:
--
--     - o seletor de responsavel viria com uma pessoa so — quem esta olhando;
--     - a juncao para pegar o nome do responsavel devolveria VAZIO, e a tarefa
--       atribuida a outra pessoa apareceria SEM RESPONSAVEL. Sem erro, sem
--       aviso: so a informacao errada.
--
--   A saida nao e afrouxar a politica de `profiles` — isso entregaria e-mail e
--   papel de todo mundo. E dar acesso ao MINIMO: identificador e nome.
-- =============================================================================

create or replace function ideworks.display_name(p_user_id uuid)
  returns text
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select coalesce(p.full_name, p.email)
    from ideworks.profiles p
   where p.id = p_user_id
     and ideworks.acting_user_id() is not null
$fn$;

comment on function ideworks.display_name(uuid) is
  'Nome de exibicao de uma pessoa, para quem estiver identificado. Existe '
  'porque `profiles_select` so mostra o proprio perfil, e sem isto o nome do '
  'responsavel por uma tarefa viria vazio em vez de errado — silenciosamente. '
  'Devolve NOME ou e-mail, nunca papel nem estado da conta.';

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

grant execute on function ideworks.display_name(uuid) to ideworks_app;
grant execute on function ideworks.team_directory()   to ideworks_app;
