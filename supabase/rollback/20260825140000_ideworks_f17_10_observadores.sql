-- Desfaz a F17.10. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F17.3c: a tarefa tem responsáveis e não tem
--   observadores. Nada mais desta etapa mora no banco — a criação da tarefa, a
--   ficha e o editor de markdown são TELA, e tela não se reverte por migration.
--
--   ATENÇÃO: reverter APAGA todos os observadores de todas as tarefas. Não há
--   como guardá-los — a tabela deixa de existir. Quem acompanha o quê é dado da
--   equipe, não metadado de importação, e só um backup o traz de volta.
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   set_task_watchers → tabela (as políticas e o índice caem com ela)
--
-- A FUNÇÃO SAI ANTES DA TABELA, E O BANCO NÃO AVISARIA SE FOSSE AO CONTRÁRIO.
--   Foi medido na F17.2b: corpo escrito como literal (`$fn$…$fn$`) NÃO registra
--   dependência em `pg_depend` — só `begin atomic` registraria. Apagar a tabela
--   primeiro não daria `2BP01`; deixaria uma função viva consultando tabela
--   inexistente, que só quebra na próxima escrita. Erro silencioso é pior que
--   erro ruidoso, e a ordem aqui existe para não produzir nenhum dos dois.
--
-- AS POLÍTICAS NÃO TÊM `drop policy` SOLTO. Elas caem junto com a tabela. Um
-- `drop policy` fora de ordem deixaria a tabela com RLS ligada e nenhuma
-- política permissiva — que é uma tabela viva e ilegível.
--
-- `can_reach_task_id` NÃO É APAGADA AQUI. Ela é da F17.3 e continua servindo
-- `task_assignees`. O rollback da F17.3 é que a leva.

-- 1. A ação, antes da tabela que ela escreve.
drop function if exists ideworks.set_task_watchers(uuid, uuid[]);

-- 2. A tabela. O índice `task_watchers_user_idx` e as duas políticas caem com
--    ela, sem comando próprio.
drop table if exists ideworks.task_watchers;

-- ============================================== O QUE ESTE ARQUIVO NÃO FAZ ===
-- NÃO TOCA EM `task_assignees`. São coisas diferentes: responsável faz,
-- observador acompanha. Confundi-las na reversão apagaria a atribuição de
-- trabalho que ninguém pediu para apagar.
--
-- NÃO TOCA EM `tasks`. Nenhuma coluna dela nasceu nesta etapa.
--
-- ESTE ARQUIVO PODE DEIXAR DE RODAR SOZINHO — E ISSO É CORRETO
--   A F17.6 (comentários e anexos) vai pendurar a notificação no observador. A
--   partir daí a reversão dela tem que vir antes desta, e o `restrict` implícito
--   recusa com `2BP01` dizendo exatamente quem depende.
