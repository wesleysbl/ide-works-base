-- =============================================================================
-- ROLLBACK — F17.54b  O no volta a ouvir o topo pela porta de quem age
-- =============================================================================
-- ⚠️ DESFAZER ISTO FAZ A ARVORE MENTIR DE NOVO: `can_see_space` continua
--   ouvindo o GUC `app.is_super` (por `chain_level`), mas `can_see_folder`,
--   `can_see_list`, `can_see_status_set` e as duas portas de escrita de no
--   voltam a ignora-lo. Medido: uma sessao do topo sem perfil correspondente
--   passa de 44 conjuntos de status para 6, e de 1797 tarefas para 1322 — o
--   espaco aparece e o que esta dentro dele some.
--
--   `node_level` volta a delegar a `node_level_for`, que e o estado deixado
--   pela F17.41 e mantido pela F17.54.
-- =============================================================================

create or replace function ideworks.node_level(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_level_for(
           ideworks.acting_user_id(), ideworks.acting_is_superadmin(),
           p_space_id, p_folder_id, p_list_id)
$fn$;

comment on function ideworks.node_level(uuid, uuid, uuid) is
  'O nivel efetivo de um no para quem esta agindo agora. Desde a F17.41 delega '
  'a `node_level_for`. E a funcao que `can_write_owner` consulta, e por isso as '
  'esteiras herdaram a camada de no sem uma segunda regra.';
