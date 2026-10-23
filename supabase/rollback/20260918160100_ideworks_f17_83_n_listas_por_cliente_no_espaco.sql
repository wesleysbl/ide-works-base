-- Desfaz a F17.83: devolve o índice único `(space_id, client_id)` que a F17.43
-- pôs e esta etapa tirou. O índice de busca `lists_client_idx` NÃO é tocado —
-- ele nunca saiu. O guarda `list_client_reach_guard` também não: a F17.83
-- não mexeu nele.
--
-- ⚠️ SE JÁ EXISTIREM DUAS LISTAS DO MESMO CLIENTE NO MESMO ESPAÇO, ESTE
--    ROLLBACK FALHA AO RECRIAR O ÍNDICE.
--
--    A mensagem crua do Postgres é `could not create unique index
--    "lists_client_key"` / `Key (space_id, client_id)=(…) is duplicated`.
--    Ela não diz o que fazer.
--
--    O QUE FAZER
--      1. Achar os pares:
--           select space_id, client_id, count(*)
--             from ideworks.lists
--            where client_id is not null
--            group by space_id, client_id
--           having count(*) > 1;
--      2. Decidir qual lista fica com o vínculo e soltar o `client_id` das
--         outras (`update … set client_id = null`). Soltar NÃO apaga a lista
--         nem as tarefas — o vínculo mora na coluna, e a lista continua.
--      3. Rodar este rollback de novo.
--
--    Não apague lista para desfazer duplicata. A lista guarda o trabalho.

begin;

create unique index if not exists lists_client_key
  on ideworks.lists (space_id, client_id) where client_id is not null;

commit;
