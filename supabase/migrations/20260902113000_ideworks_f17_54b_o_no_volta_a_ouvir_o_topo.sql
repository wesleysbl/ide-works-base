-- =============================================================================
-- IDE WORKS — F17.54b  O no volta a ouvir o topo pela porta de quem age
-- =============================================================================
-- O QUE A PROVA PAR-A-PAR ACUSOU, E ELA ACUSOU NA PRIMEIRA RODADA
--   A F17.54 fez `node_level_for` mandar `false` para a barreira da empresa e
--   deixou `reaches_category_for` LER O PERFIL para saber quem e o topo. Para
--   quem tem perfil isso e exato. Mas `node_level` — a porta de QUEM ESTA
--   AGINDO — delega a `node_level_for` desde a F17.41, e com isso a arvore
--   deixou de ouvir o GUC `app.is_super`:
--
--     medido em 2026-09-02, com `app.user_id` de uma sessao sem perfil e
--     `app.is_super = true`:
--       conjuntos de status visiveis   44 -> 6
--       tarefas visiveis             1797 -> 1322
--
--   `can_see_space` continuava certo, porque `chain_level` pergunta a
--   `reaches_company()`, que le o GUC. `can_see_folder`, `can_see_list`,
--   `can_see_status_set`, `node_grants_select`, `node_restrictions_select`,
--   `can_write_owner` e `can_grant_on` passam por `node_level`, e essas
--   divergiam. Uma arvore em que o espaco aparece e a lista dentro dele nao e
--   pior do que a arvore errada: e a arvore MENTINDO.
--
-- A REGRA, DITA DE UMA VEZ
--   Ha DUAS perguntas diferentes, e cada uma tem a sua fonte de verdade:
--
--     · "quem esta agindo agora e o topo?"  -> o GUC `app.is_super`, declarado
--       pelo servidor em `src/server/db.ts` so para `role = 'super_admin'`. E a
--       fonte que a F17.32 fixou para `can_see_client` e `can_see_asset`.
--
--     · "aquela OUTRA pessoa e o topo?"     -> o PERFIL dela. Nao ha GUC de
--       terceiro, e inventar um seria repetir o achado A1 com outro nome. E o
--       que `can_reach_task_for` ja faz desde a F17.41.
--
--   `node_level` e a primeira pergunta; `node_level_for` e a segunda. Elas
--   voltam a ser duas funcoes, e nao uma delegando para a outra.
--
-- O QUE MUDA, E SO ISSO
--   `node_level` volta ao corpo da F17.23: a empresa por `reaches_company` (que
--   le o GUC) e o teto por `node_ceiling` (que le `acting_is_superadmin`). O
--   `node_level_for` da F17.54 fica como esta.
-- =============================================================================

set local lock_timeout = '15s';

create or replace function ideworks.node_level(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when not ideworks.reaches_company(
                     ideworks.owner_space(p_space_id, p_folder_id, p_list_id))
             then null
           else ideworks.node_ceiling(p_space_id, p_folder_id, p_list_id)
         end
$fn$;

comment on function ideworks.node_level(uuid, uuid, uuid) is
  'O nivel efetivo de um no para quem esta agindo agora: a EMPRESA primeiro '
  '(`reaches_company`, que le o GUC `app.is_super`), o teto da corrente depois. '
  'F17.54b: deixou de delegar a `node_level_for` — aquela responde por OUTRA '
  'pessoa e tira o topo do perfil, porque de terceiro nao ha GUC. E a funcao que '
  '`can_write_owner` consulta, e por isso as esteiras herdaram a camada de no '
  'sem uma segunda regra.';
