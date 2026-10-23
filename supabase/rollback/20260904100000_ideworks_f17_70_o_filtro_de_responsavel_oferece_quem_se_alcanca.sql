-- =============================================================================
-- DESFAZER — F17.70  O filtro de responsavel oferece quem se alcanca
-- =============================================================================
-- A migration so CRIA uma funcao de leitura; nao reescreve nenhuma existente,
-- nao mexe em politica e nao toca em dado. Desfazer e derrubar a funcao.
--
-- ⚠️ O SERVIDOR PARA DE LER O QUADRO se esta funcao sumir sem que
-- `src/server/responsaveis-do-quadro.ts` volte junto. Desfazer aqui pede
-- desfazer o codigo tambem.
-- =============================================================================

drop function if exists ideworks.assignee_filter_people();
