-- =============================================================================
-- ROLLBACK — F17.75  O quadro que aguenta
-- =============================================================================
-- ⚠️ DESFAZER ISTO NAO MUDA RESPOSTA NENHUMA — MUDA O RELOGIO
--   Nem a memoria nem a divisao das politicas alteram uma linha de resposta. O
--   que volta e o custo. Medido em 2026-09-04, no banco de producao, como
--   `ideworks_app`:
--
--     `Todas as tarefas` .............. ~1,1 s  ->  ~3,1 s
--     quadro da PASTA (1.078 tarefas) . ~0,6 s  ->  ~1,9 s
--     quadro da lista GRANDE .......... ~0,5 s  ->  ~1,2 s
--     count(*) em task_assignees ...... ~0,05 s ->  ~0,53 s
--
--   E a projecao volta com ele: com as 1.313 tarefas sem dono atribuidas, a
--   leitura de `task_assignees` passava de 1,8 s. Reverter e escolher voltar
--   para a beira do `statement_timeout`.
--
-- ORDEM
--   1. As politicas primeiro, porque elas nao dependem das funcoes.
--   2. Depois o corpo antigo de volta em `node_ceiling` e `chain_level` —
--      enquanto a memoria existir, as `..._uncached` ainda estao sendo chamadas
--      por ela. So depois as funcoes separadas somem.
--
-- ⚠️ AS GUCs `ideworks_teto.*` E `ideworks_cadeia.*` NAO PRECISAM DE LIMPEZA
--   Foram gravadas com `is_local`, entao morreram no fim de cada transacao. Nao
--   ha estado a desfazer no banco: a memoria nunca chegou a existir fora de um
--   comando.
--
-- ⚠️ E ISTO REABRE UM CAMINHO DE LEITURA
--   Voltar as sete politicas para `for all` faz cada uma dessas tabelas ser
--   lida por DOIS caminhos de novo. Hoje isso nao muda o conjunto de linhas
--   (act implica reach, e a prova da F17.75 cobra isso), mas a redundancia e
--   silenciosa: no dia em que `can_reach_task_id` for apertada, o ramo de
--   escrita volta a ser a porta larga que a F17.32b fechou em outro lugar.
-- =============================================================================

set local lock_timeout = '15s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AS SETE POLITICAS VOLTAM A SER `for all`
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists task_assignees_insert on ideworks.task_assignees;
drop policy if exists task_assignees_update on ideworks.task_assignees;
drop policy if exists task_assignees_delete on ideworks.task_assignees;
create policy task_assignees_write on ideworks.task_assignees for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

drop policy if exists task_watchers_insert on ideworks.task_watchers;
drop policy if exists task_watchers_update on ideworks.task_watchers;
drop policy if exists task_watchers_delete on ideworks.task_watchers;
create policy task_watchers_write on ideworks.task_watchers for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

drop policy if exists task_attachments_insert on ideworks.task_attachments;
drop policy if exists task_attachments_update on ideworks.task_attachments;
drop policy if exists task_attachments_delete on ideworks.task_attachments;
create policy task_attachments_write on ideworks.task_attachments for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

drop policy if exists task_checklists_insert on ideworks.task_checklists;
drop policy if exists task_checklists_update on ideworks.task_checklists;
drop policy if exists task_checklists_delete on ideworks.task_checklists;
create policy task_checklists_write on ideworks.task_checklists for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

drop policy if exists task_links_insert on ideworks.task_links;
drop policy if exists task_links_update on ideworks.task_links;
drop policy if exists task_links_delete on ideworks.task_links;
create policy task_links_write on ideworks.task_links for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

drop policy if exists task_tag_assignments_insert on ideworks.task_tag_assignments;
drop policy if exists task_tag_assignments_update on ideworks.task_tag_assignments;
drop policy if exists task_tag_assignments_delete on ideworks.task_tag_assignments;
create policy task_tag_assignments_write on ideworks.task_tag_assignments for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

drop policy if exists checklist_items_insert on ideworks.checklist_items;
drop policy if exists checklist_items_update on ideworks.checklist_items;
drop policy if exists checklist_items_delete on ideworks.checklist_items;
create policy checklist_items_write on ideworks.checklist_items for all
  using      (ideworks.can_act_on_checklist(checklist_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_checklist(checklist_id, 'execute'::ideworks.access_level));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AS DUAS FUNCOES VOLTAM AO CORPO SEM MEMORIA
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function ideworks.node_ceiling(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_ceiling_for(
           ideworks.acting_user_id(), ideworks.acting_is_superadmin(),
           p_space_id, p_folder_id, p_list_id)
$fn$;

comment on function ideworks.node_ceiling(uuid, uuid, uuid) is null;

create or replace function ideworks.chain_level(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when not ideworks.reaches_company(p_space_id) then null
           else ideworks.chain_ceiling_for(
                  ideworks.acting_user_id(), ideworks.acting_is_superadmin(),
                  p_space_id, p_folder_id, p_list_id)
         end
$fn$;

comment on function ideworks.chain_level(uuid, uuid, uuid) is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AS IRMAS `..._uncached` SOMEM — so agora, que ninguem mais as chama
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists ideworks.node_ceiling_uncached(uuid, uuid, uuid);
drop function if exists ideworks.chain_level_uncached(uuid, uuid, uuid);
