-- Desfaz a F17.43. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F17.41: `ideworks.lists` sem coluna de cliente, e
--   nenhum guarda de vínculo.
--
--   ⚠️ REVERTER APAGA O VÍNCULO, E ELE NÃO TEM OUTRA FONTE.
--     `drop column client_id` leva embora QUAL lista é de QUAL cliente. As
--     listas ficam — com o nome que receberam do cliente, as tarefas dentro e
--     todo o trabalho —, mas voltam a ser textos que não sabem que são
--     clientes, e refazer o vínculo é escolher de novo, cliente por cliente.
--
--     Nenhum cliente é tocado: o vínculo mora na lista, e nunca morou nele.
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   gatilho          → função de gatilho
--   função           → coluna (ela consulta `new.client_id`)
--   índices          → coluna
--   chave estrangeira → coluna
--
-- O `drop column ... cascade` levaria a chave e os dois índices sozinho, mas
-- cada um sai nomeado, e por dois motivos: `cascade` num rollback é uma
-- promessa de que ninguém acrescentou nada em cima — e o rollback é justamente
-- o momento em que ninguém tem tempo de conferir isso.
-- =============================================================================

-- --- 1. o gatilho, antes da função que ele chama ------------------------------
drop trigger if exists lists_client_reach_guard on ideworks.lists;
drop function if exists ideworks.list_client_reach_guard();

-- --- 2. os índices ------------------------------------------------------------
drop index if exists ideworks.lists_client_idx;
drop index if exists ideworks.lists_client_key;

-- --- 3. a chave estrangeira ---------------------------------------------------
alter table ideworks.lists
  drop constraint if exists lists_client_fk;

-- --- 4. e só então a coluna ---------------------------------------------------
alter table ideworks.lists
  drop column if exists client_id;
