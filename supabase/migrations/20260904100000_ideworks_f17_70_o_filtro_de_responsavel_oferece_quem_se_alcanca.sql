-- =============================================================================
-- IDE WORKS — F17.70  O filtro de responsavel oferece quem se alcanca
-- =============================================================================
-- O DEFEITO
--   O menu `Filtrar por responsavel` do quadro montava a lista a partir de quem
--   APARECE em `task_assignees` naquele quadro. Medido em 2026-09-04, como
--   `ideworks_app`:
--
--     perfis ativos no sistema ................ 17
--     pessoas com ALGUMA tarefa ................  7
--     pessoas com ZERO tarefas ................. 10
--
--   O menu escondia exatamente as dez sem tarefa — o dono do sistema incluido.
--   E o pior recorte possivel: some justamente quem se procura para descobrir
--   que esta sem trabalho.
--
-- ⚠️ O CONSERTO NAO E "TODOS OS USUARIOS"
--   Enumerar gente de outra empresa JA E VAZAR, mesmo que so o nome saia. A
--   lista certa e "todo mundo que QUEM ESTA OLHANDO alcanca", que e a regra que
--   a F17.34 escreveu para a tela de pessoas e a F17.53 escreveu para o seletor
--   de responsavel: `ideworks.can_assign_person(uuid)`.
--
--   Esta migration NAO ESCREVE REGRA NOVA. Ela reusa `can_assign_person` inteira
--   — os tres ramos da F17.53, com `acting_is_super()` (o topo) e nao
--   `acting_is_superadmin()` (quem administra), que foi a troca que causou a
--   F17.32, a F17.38 e a F17.54.
--
-- POR QUE NAO REUSAR `team_directory()` DIRETO
--   Ela responde outra pergunta — "a quem posso ATRIBUIR" — e sai em `GET
--   /team`. Duas diferencas a separam do filtro:
--
--   1. CONTA DE SISTEMA. `teste-f19@ideworks.invalid` e uma conta fixa de
--      verificacao, e hoje ela tem 1 tarefa. No seletor de atribuicao ela ate
--      pode aparecer (atribuir a ela e um ato deliberado de quem esta testando);
--      no FILTRO ela seria oferecida como se fosse gente, para toda a equipe,
--      em todo quadro. Aqui ela sai.
--
--      ⚠️ Sai da lista, NAO do dado: nenhum perfil e apagado nem desativado, e a
--      tarefa dela continua contada em `Sem responsavel`/`com dono` como sempre.
--      Quando ela JA e responsavel naquele quadro, o servidor a traz de volta
--      pela outra metade da uniao (ver `src/server/responsaveis-do-quadro.ts`) —
--      senao aquela tarefa ficaria sem nenhum jeito de ser filtrada.
--
--   2. FORMA. `team_directory()` devolve a lista pronta e ordenada; o filtro
--      precisa dela para uma juncao com a contagem daquele quadro. Mudar a forma
--      de `team_directory()` mexeria em `GET /team`, que nao e o defeito desta
--      etapa.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova, nenhuma politica nova, nenhuma funcao existente
--   reescrita. Uma funcao nova de LEITURA. Ela e `security definer` pela MESMA
--   razao de `team_directory()`: `profiles_select` mostra so o proprio perfil, e
--   uma leitura sob politica devolveria UMA linha — o filtro de todo mundo
--   passaria a ter so a propria pessoa. Sendo `definer`, a regra tem de ser
--   perguntada de proposito, e ela e: `can_assign_person(p.id)`.
--
--   `execute` so para `ideworks_app`. `public` nao alcanca.
-- =============================================================================

create or replace function ideworks.assignee_filter_people()
  returns table (id uuid, name text)
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select p.id, coalesce(p.full_name, p.email)
    from ideworks.profiles p
   where p.is_active

     -- A REGRA, INTEIRA E EMPRESTADA. Sem esta linha a lista seria o sistema
     -- inteiro, e quem administra a Ide passaria a enumerar a gente da Alma 9.
     -- A guarda "ha alguem declarado" mora dentro dela — a janela de
     -- pre-autenticacao nao le nome de gente por aqui.
     and ideworks.can_assign_person(p.id)

     -- CONTA DE SISTEMA NAO E GENTE. As contas fixas de verificacao vivem em
     -- `@ideworks.invalid` (dominio reservado, nao roteavel) e existem para as
     -- provas automatizadas. Oferecer uma delas no menu da equipe seria
     -- oferecer um colega que nao existe.
     and coalesce(p.email, '') not like '%@ideworks.invalid'

   order by coalesce(p.full_name, p.email)
$fn$;

comment on function ideworks.assignee_filter_people() is
  'Quem o menu `Filtrar por responsavel` do quadro pode OFERECER — F17.70. '
  'Contas ativas que a regra de empresa alcanca (can_assign_person, da F17.53), '
  'menos as contas de sistema em @ideworks.invalid. NAO e a lista de quem ja e '
  'responsavel: o servidor une esta lista com a contagem daquele quadro, e quem '
  'ja tem tarefa la aparece mesmo fora deste recorte — senao a tarefa dele '
  'ficaria sem jeito de ser filtrada, com o nome dele visivel no cartao. Quem '
  'esta aqui e nao tem tarefa aparece com ZERO, e esse e o caso util.';

revoke all on function ideworks.assignee_filter_people() from public;
grant execute on function ideworks.assignee_filter_people() to ideworks_app;
