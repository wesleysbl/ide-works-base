-- Desfaz a F17.84: derruba a função de leitura das listas do cliente.
--
-- A migration só CRIA uma função de leitura; não reescreve nenhuma existente,
-- não mexe em política, não toca em dado, não toca em `lists.client_id` nem
-- em `lists_client_idx`. Desfazer é derrubar a função.
--
-- ⚠️ O SERVIDOR PARA DE LER AS LISTAS DO CLIENTE se esta função sumir sem
-- que `src/server/client-board-lists.ts` volte junto. Desfazer aqui pede
-- desfazer o código também.

drop function if exists ideworks.client_board_lists(uuid);
