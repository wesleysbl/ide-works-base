-- =============================================================================
-- F17.83 — O MESMO CLIENTE PODE TER N LISTAS NO MESMO ESPAÇO
--
-- O QUE A F17.43 GARANTIU DEMAIS
--   A coluna `lists.client_id` nasceu certa: uma lista pertence a no máximo um
--   cliente. O que errou o domínio foi o índice único `lists_client_key` em
--   `(space_id, client_id)`: ele fazia "cliente já trazido some da escolha" ser
--   verdade no banco, descrevendo a caixa de trazer — e não o cliente real.
--   A carteira tem cliente com mais de uma frente de trabalho no mesmo time.
--
-- O QUE SAI, E O QUE FICA
--   Sai só o índice único. O índice de busca `lists_client_idx` (client_id)
--   FICA: é ele que responde "que listas são deste cliente".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ O GUARDA DE ALCANCE NÃO É TOCADO, E ISSO NÃO É ESQUECIMENTO
--
--   `lists_client_reach_guard` / `list_client_reach_guard()` nunca falou de
--   quantidade. Ele só responde "posso ligar a um cliente que eu enxergo".
--   Derrubar unicidade não alarga alcance: o vínculo continua não dando
--   visibilidade a ninguém. Mexer no guarda aqui misturaria duas decisões.
-- ─────────────────────────────────────────────────────────────────────────────
-- =============================================================================

begin;

drop index if exists ideworks.lists_client_key;

commit;
