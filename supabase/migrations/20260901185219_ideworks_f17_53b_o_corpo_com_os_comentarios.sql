-- =============================================================================
-- IDE WORKS — F17.53b  O corpo das duas funcoes, com os comentarios
-- =============================================================================
-- POR QUE ESTE ARQUIVO EXISTE, E ELE E HONESTO SOBRE O ERRO
--   A F17.53 foi aplicada em duas idas ao banco. A primeira passou com os
--   corpos das duas funcoes SEM os comentarios de dentro do `$fn$`. O texto de
--   dentro do corpo nao muda o que a funcao faz, mas MUDA `pg_proc.prosrc` — e
--   `prosrc` e exatamente o que `scripts/conferir-schema.mjs` guarda no
--   retrato desde a F17.2c, justamente para que ninguem troque o corpo de uma
--   funcao de permissao sem a rede ver.
--
--   Deixar assim faria o arquivo da F17.53 e o banco divergirem em silencio:
--   quem reconstruisse o banco a partir dos arquivos teria um `prosrc`
--   diferente do gravado, e a proxima conferencia acusaria diferenca sem ter
--   havido mudanca de regra nenhuma. Entao os corpos foram reaplicados como
--   estao escritos no arquivo da F17.53, e este arquivo registra o segundo
--   passo, para que a lista de migrations do banco tenha um arquivo por linha.
--
-- ⚠️ NAO MUDA COMPORTAMENTO. Os dois `create or replace` abaixo sao os mesmos
--   da F17.53, palavra por palavra. Reaplicar num banco que ja tem a F17.53
--   inteira e um no-op.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova, nenhuma politica tocada.
-- =============================================================================

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

revoke all on function ideworks.can_assign_person(uuid) from public;
grant execute on function ideworks.can_assign_person(uuid) to ideworks_app;
revoke all on function ideworks.team_directory() from public;
grant execute on function ideworks.team_directory() to ideworks_app;
