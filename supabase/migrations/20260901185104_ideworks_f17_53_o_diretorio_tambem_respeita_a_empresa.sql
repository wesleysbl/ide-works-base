-- =============================================================================
-- IDE WORKS — F17.53  O diretorio de responsaveis tambem respeita a empresa
-- =============================================================================
-- O QUE ESTA MIGRATION FECHA — achado A2 da auditoria de 2026-09-01
--   `ideworks.team_directory()` (F4.8b) e `security definer` e a unica guarda
--   dela era `acting_user_id() is not null`. Como e `definer`, a politica de
--   `profiles` nao a alcanca: ela devolvia TODA conta ativa do sistema, para
--   qualquer sessao. Sai em `GET /team`, que e a lista de quem pode receber
--   tarefa.
--
--   A F17.34 estreitou a TELA DE PESSOAS — a ficha, a carteira, a fila de
--   convites. Esta e outra superficie: o dicionario de nomes do seletor de
--   responsavel. Ficou aberta, e e a que esta migration fecha.
--
-- ⚠️ O NUMERO DO LAUDO COMPARA COM A REGRA ERRADA, E ISSO MUDA O QUE SE PROMETE
--   O laudo diz "o funcionario ve 5 nomes onde a regra permite 1". O "1" e
--   `ideworks.can_see_person()`, que e a regra da TELA DE PESSOAS: ela exige
--   `acting_is_superadmin()`, e quem nao administra so enxerga a si mesmo.
--
--   Aplicar `can_see_person` aqui daria ao funcionario um seletor de
--   responsavel com UMA pessoa — ele mesmo. Seria a tela de demandas quebrada,
--   que e exatamente o que a F4.8b existiu para evitar. O proprio laudo diz
--   isso na coluna do conserto: *"a regra certa nao e `can_see_person` (que
--   exige administrar), e 'compartilha empresa comigo, ou nao tem empresa'"*.
--
--   Medido como `ideworks_app`, declarando cada perfil, em 2026-09-01:
--
--     quem olha                      team_directory()  can_see_person  regra desta etapa
--     arte3@ (funcionario)                    5               1                  5
--     atendimento@ (admin)                          5               5                  5
--     gestao@      (admin)                          5               5                  5
--     joana@    (super admin)                    5               5                  5
--     teste-f19    (super admin)                    5               5                  5
--
--   Ou seja: NO DADO DE HOJE ESTA MIGRATION NAO TIRA UM NOME DE NINGUEM. E o
--   mesmo desfecho da F17.34, e pela mesma causa — as duas pessoas que o laudo
--   chama de "de outra empresa" tem ZERO empresa marcada:
--
--     Alma9        -> 0 pessoas       Ide     -> 3 pessoas
--     Sem categoria-> 0 pessoas       Ide Hub -> 3 pessoas
--
--   `Joana Duarte` aparece no laudo como "da Alma9". Ele nao esta em
--   `user_categories` nenhuma: o que e da Alma 9 e o DOMINIO DO E-MAIL dele.
--   Pela regra 3 da F17.34 — pessoa sem nenhuma empresa marcada e visivel —
--   ele continua, e deve continuar, no diretorio de todo mundo.
--
--   Entao O CENSO DE HOJE NAO PROVA NADA, e a prova desta etapa nao e censo: e
--   SONDA dentro de transacao desfeita. Ver `scripts/provar-o-diretorio.mjs`.
--
-- AS DUAS PERGUNTAS QUE NAO PODEM SAIR DA MESMA FUNCAO
--   1. "QUEM EU POSSO ATRIBUIR?" -> recorta pela empresa. E `team_directory()`.
--   2. "QUEM E ESTA PESSOA QUE JA ESTA ATRIBUIDA?" -> resolve o nome mesmo fora
--      do recorte, senao o cartao mente: a pessoa continua atribuida no banco e
--      o nome nao aparece na tela.
--
--   A segunda ja existe e nao se mexe nela: `ideworks.display_name(uuid)`, da
--   mesma F4.8b. Foi conferido que TODA leitura de nome de responsavel do
--   projeto passa por ela — `tasks.ts`, `board.ts`, `board-task.ts`,
--   `board-trabalho.ts`, `board-automacoes.ts`, `history.ts`,
--   `mural-e-captacao.ts` — e nenhuma resolve nome pela lista do diretorio. O
--   unico ponto do front que consulta a lista por identificador e
--   `src/board/ficha.ts:ignorados()`, e ele so nomeia quem a propria pessoa
--   ACABOU de pedir e o banco descartou; nunca responsavel ja gravado.
--
--   Medido antes de estreitar: `task_assignees` tem 123 linhas e 4 pessoas
--   distintas, e `display_name()` resolve as 5 de 5 para os 5 perfis. Com a
--   sonda ligada, continua resolvendo. ZERO responsaveis ja atribuidos deixam
--   de resolver.
--
-- ⚠️ POR QUE A REGRA TEM DE SER `SECURITY DEFINER`
--   A primeira medicao desta etapa escreveu a regra solta na consulta e leu
--   `user_categories` direto. Deu a resposta errada: aquela tabela tem
--   politica, o funcionario nao le a linha de empresa de outra pessoa, o
--   `not exists` deu verdadeiro por FALTA DE PERMISSAO, e a regra 3 disparou
--   para quem tinha empresa marcada. Dentro de uma funcao `definer` a leitura
--   nao passa por politica e a pergunta e respondida pelo dado, nao pelo
--   alcance de quem pergunta. E o mesmo motivo pelo qual `can_see_person` e
--   `definer`.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova, nenhuma politica nova. Uma funcao nova de LEITURA
--   (`can_assign_person`) e uma funcao existente reescrita (`team_directory`).
--   `display_name(uuid)` fica intacta, de proposito — ver acima.
-- =============================================================================

-- --- 1. a regra: a quem EU posso atribuir -----------------------------------
--
-- Os ramos sao os da F17.34, menos a porta de `acting_is_superadmin()`:
-- atribuir tarefa nao e administrar pessoa, e exigir que administre trancaria
-- o funcionario num seletor de uma linha so.
create or replace function ideworks.can_assign_person(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- SEM ATOR DECLARADO, NINGUEM. E a guarda que a F4.8b ja tinha, e ela fica
  -- de fora dos ramos de proposito: dentro deles, `target = acting_user_id()`
  -- daria nulo (que nao e verdadeiro), mas `not exists (...)` daria VERDADEIRO
  -- para toda pessoa sem empresa — e a janela de pre-autenticacao passaria a
  -- ler nome de gente.
  select ideworks.acting_user_id() is not null
     and (
          -- REGRA 2 da F17.34: e ela mesma. Ninguem some da propria tela, e
          -- todo mundo pode atribuir uma tarefa a si.
          target = ideworks.acting_user_id()

          -- O TOPO ATRAVESSA. `acting_is_super`, e nao `acting_is_superadmin`:
          -- o segundo quer dizer "administra", e foi ele que a F17.32 tirou das
          -- funcoes de cliente e a F17.34 manteve fora das de pessoa.
          or ideworks.acting_is_super()

          -- REGRA 1: compartilha empresa comigo. E o caso comum.
          or exists (
               select 1
                 from ideworks.user_categories minha
                 join ideworks.user_categories dela
                   on dela.category_id = minha.category_id
                where minha.user_id = ideworks.acting_user_id()
                  and dela.user_id = target)

          -- REGRA 3: a pessoa nao tem NENHUMA empresa marcada. Nao e frouxidao,
          -- e a saida da armadilha descrita na F17.34: sem ela, convidar alguem
          -- e esquecer de marcar a empresa cria uma pessoa a quem NINGUEM pode
          -- atribuir tarefa — e quem esqueceu de marcar e justamente quem nao
          -- vai lembrar de conferir.
          or not exists (
               select 1 from ideworks.user_categories dela
                where dela.user_id = target)
     )
$fn$;

comment on function ideworks.can_assign_person(uuid) is
  'A UNICA regra de a quem se pode ATRIBUIR tarefa — F17.53. Tres ramos, os '
  'mesmos da F17.34: e ela mesma, ou o topo atravessa, ou compartilha empresa '
  'comigo; e passa tambem quem nao tem NENHUMA empresa marcada. NAO exige '
  'administrar, ao contrario de can_see_person: quem nao administra tambem '
  'atribui tarefa. Nao responde a quem pergunta o nome de responsavel JA '
  'atribuido — isso e display_name(uuid), e estreita-la faria o cartao mentir.';

revoke all on function ideworks.can_assign_person(uuid) from public;
grant execute on function ideworks.can_assign_person(uuid) to ideworks_app;

-- --- 2. o diretorio passa a perguntar a regra ---------------------------------
create or replace function ideworks.team_directory()
  returns table (id uuid, name text)
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select p.id, coalesce(p.full_name, p.email)
    from ideworks.profiles p
   where p.is_active
     -- F17.53. Sem esta linha a lista era o sistema inteiro. A funcao e
     -- `security definer`, entao a politica de `profiles` nao a alcanca: aqui a
     -- regra tem de ser perguntada de proposito. Era `acting_user_id() is not
     -- null`, que agora mora DENTRO de `can_assign_person`.
     and ideworks.can_assign_person(p.id)
   order by coalesce(p.full_name, p.email)
$fn$;

comment on function ideworks.team_directory() is
  'Quem pode receber tarefa: identificador e nome das contas ativas que a regra '
  'de empresa alcanca — F4.8b, estreitada na F17.53. Duas colunas, de '
  'proposito: nao expoe e-mail separado, papel, nem se a pessoa e '
  'administradora. Quem ja esta atribuido tem o nome resolvido por '
  'display_name(uuid), que NAO recorta — senao o cartao esconderia responsavel.';

revoke all on function ideworks.team_directory() from public;
grant execute on function ideworks.team_directory() to ideworks_app;

-- --- 3. o outro lado da divisao, dito em voz alta -----------------------------
--
-- `display_name` NAO MUDA. O comentario passa a dizer por que ela nao muda, para
-- que a proxima auditoria nao a "conserte" e apague responsavel dos cartoes.
comment on function ideworks.display_name(uuid) is
  'Nome de exibicao de uma pessoa, para quem estiver identificado. Existe '
  'porque profiles_select so mostra o proprio perfil, e sem isto o nome do '
  'responsavel por uma tarefa viria vazio em vez de errado — silenciosamente. '
  'Devolve NOME ou e-mail, nunca papel nem estado da conta. F17.53: ela NAO '
  'recorta por empresa, e isso e deliberado. Ela responde "quem e esta pessoa '
  'que ja esta atribuida", e nao "a quem posso atribuir" — que e '
  'can_assign_person. Estreita-la esconderia responsavel ja gravado: a pessoa '
  'continuaria atribuida no banco e o cartao apareceria sem ninguem.';
