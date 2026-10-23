-- Desfaz a F17.23. Ordem inversa da aplicacao.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F17.19b: a arvore volta a ter UMA barreira — a
--   empresa —, e nenhum no pode ser fechado.
--
--   ⚠️ REVERTER APAGA DADO DE ACESSO. `drop table ideworks.node_restrictions` e
--   `ideworks.node_grants` levam TODAS as paredes e TODAS as concessoes de
--   todos os espacos, pastas e listas. As tabelas deixam de existir; so um
--   backup as traz de volta.
--
--   E o efeito e o oposto do que se espera de um rollback: ele ABRE o que estava
--   fechado. Toda pasta restrita volta a ser lida por qualquer pessoa da empresa
--   dela, no mesmo instante. Se houver restricao em uso, LEIA-A e GUARDE-A antes
--   — `select * from ideworks.node_restrictions` e `... node_grants` —, porque
--   depois nao ha de onde tirar.
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE E USADO.
--
--   as politicas de tabela           → as funcoes de nivel que elas executam
--   set_node_access                  → node_access  E  as duas tabelas
--   node_access                      → chain_ceiling_for, reaches_company_for
--   as sete funcoes de acao          → can_act_on_task*, can_act_on_checklist
--   can_see_space/list/status_set,
--   can_reach_task, can_write_owner  → chain_level, node_level, node_ceiling
--   node_restrictions / node_grants  → (as politicas delas caem com as tabelas)
--   as funcoes de nivel              → o tipo access_level
--
-- POLITICA → FUNCAO E DEPENDENCIA REGISTRADA. `folders_write` executa
-- `can_act_on_chain`: um `drop function` antes de a politica voltar ao texto
-- antigo responde `2BP01`. Por isso TODAS as politicas sao restauradas primeiro,
-- e so depois as funcoes caem.
--
-- As politicas de `node_restrictions` e `node_grants` NAO tem `drop policy`
-- solto: elas caem junto com as tabelas. Um `drop policy` fora de ordem deixaria
-- a tabela com RLS ligada e nenhuma politica permissiva — tabela viva e
-- ilegivel.
--
-- FUNCAO → FUNCAO NAO E DEPENDENCIA REGISTRADA, e aqui isso morde em cadeia:
-- `can_see_space` chama `chain_level`, que chama `reaches_company` e
-- `chain_ceiling_for`. O banco nao avisaria se as de baixo saissem primeiro —
-- ficariam funcoes vivas chamando funcao inexistente, e o erro so apareceria na
-- proxima leitura de quadro. Erro silencioso e pior que erro ruidoso.
--
-- FUNCAO → TABELA TAMBEM NAO E. Foi medido na F17.2b: corpo escrito como
-- literal (`$fn$…$fn$`) NAO registra dependencia em `pg_depend`. Apagar
-- `node_grants` antes de `chain_ceiling_for` nao daria `2BP01`; deixaria a
-- funcao viva consultando tabela inexistente.
--
-- TIPO → FUNCAO E DEPENDENCIA REGISTRADA, e por assinatura: enquanto
-- `can_act_on_task(uuid, uuid, ideworks.access_level)` existir, `drop type
-- ideworks.access_level` responde `2BP01`. O tipo sai por ultimo.
--
-- O QUE NAO SE APAGA, SE RESTAURA: `can_see_space`, `can_see_list`,
-- `can_see_status_set`, `can_reach_task`, `can_write_owner` e as sete funcoes de
-- acao sao de etapas anteriores. Um `drop function` aqui apagaria funcao de
-- outra etapa e deixaria vinte politicas sem a regra delas. Os textos abaixo sao
-- os da F17.1, F17.2, F17.2b, F17.3, F17.4, F17.10 e F17.15, palavra por
-- palavra, comentarios do corpo inclusive.
--
-- `can_see_folder` NASCEU NA F17.23 e some aqui — nada de fora a usa depois que
-- `folders_select` volta ao texto antigo.
-- =============================================================================

-- --- 1. as politicas voltam ao texto anterior --------------------------------
drop policy if exists folders_select on ideworks.folders;
create policy folders_select on ideworks.folders for select
  using (ideworks.can_see_space(space_id));

drop policy if exists folders_write on ideworks.folders;
create policy folders_write on ideworks.folders for all
  using (ideworks.can_see_space(space_id))
  with check (ideworks.can_see_space(space_id));

drop policy if exists lists_select on ideworks.lists;
create policy lists_select on ideworks.lists for select
  using (ideworks.can_see_space(space_id));

drop policy if exists lists_write on ideworks.lists;
create policy lists_write on ideworks.lists for all
  using (ideworks.can_see_space(space_id))
  with check (ideworks.can_see_space(space_id));

drop policy if exists tasks_insert on ideworks.tasks;
create policy tasks_insert on ideworks.tasks for insert
  with check (ideworks.can_reach_task(list_id, client_id));

drop policy if exists tasks_update on ideworks.tasks;
create policy tasks_update on ideworks.tasks for update
  using      (ideworks.can_reach_task(list_id, client_id))
  with check (ideworks.can_reach_task(list_id, client_id));

drop policy if exists tasks_delete on ideworks.tasks;
create policy tasks_delete on ideworks.tasks for delete
  using (ideworks.can_reach_task(list_id, client_id));

drop policy if exists task_assignees_write on ideworks.task_assignees;
create policy task_assignees_write on ideworks.task_assignees for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

drop policy if exists task_watchers_write on ideworks.task_watchers;
create policy task_watchers_write on ideworks.task_watchers for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

drop policy if exists task_tag_assignments_write on ideworks.task_tag_assignments;
create policy task_tag_assignments_write on ideworks.task_tag_assignments for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

drop policy if exists task_attachments_write on ideworks.task_attachments;
create policy task_attachments_write on ideworks.task_attachments for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

drop policy if exists task_links_write on ideworks.task_links;
create policy task_links_write on ideworks.task_links for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

drop policy if exists task_checklists_write on ideworks.task_checklists;
create policy task_checklists_write on ideworks.task_checklists for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

drop policy if exists checklist_items_write on ideworks.checklist_items;
create policy checklist_items_write on ideworks.checklist_items for all
  using      (ideworks.can_reach_checklist(checklist_id))
  with check (ideworks.can_reach_checklist(checklist_id));

drop policy if exists task_comments_insert on ideworks.task_comments;
create policy task_comments_insert on ideworks.task_comments for insert
  with check (ideworks.can_reach_task_id(task_id)
              and author_id = ideworks.acting_user_id());

drop policy if exists task_comments_update on ideworks.task_comments;
create policy task_comments_update on ideworks.task_comments for update
  using      (ideworks.can_reach_task_id(task_id)
              and author_id = ideworks.acting_user_id())
  with check (ideworks.can_reach_task_id(task_id)
              and author_id = ideworks.acting_user_id());

drop policy if exists task_comments_delete on ideworks.task_comments;
create policy task_comments_delete on ideworks.task_comments for delete
  using (ideworks.can_reach_task_id(task_id)
         and author_id = ideworks.acting_user_id());

drop policy if exists task_tags_select on ideworks.task_tags;
create policy task_tags_select on ideworks.task_tags for select
  using (ideworks.can_see_space(space_id));

drop policy if exists task_tags_write on ideworks.task_tags;
create policy task_tags_write on ideworks.task_tags for all
  using      (ideworks.can_see_space(space_id))
  with check (ideworks.can_see_space(space_id));

drop policy if exists status_sets_select on ideworks.status_sets;
create policy status_sets_select on ideworks.status_sets for select
  using (ideworks.can_see_space(ideworks.owner_space(space_id, folder_id, list_id)));

-- --- 2. as sete funcoes de acao voltam ao alcance sem nivel -------------------
create or replace function ideworks.complete_task(p_task_id uuid, p_by uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks t
     set status_id    = case
                          when t.list_id is null then t.status_id
                          else coalesce(
                                 ideworks.closing_status(
                                   ideworks.resolve_status_set(t.list_id)),
                                 t.status_id)
                        end,
         completed_at = coalesce(t.completed_at, now()),
         completed_by = coalesce(t.completed_by, p_by),
         updated_at   = now()
   where t.id = p_task_id
     and ideworks.can_reach_task(t.list_id, t.client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.uncomplete_task(p_task_id uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  -- Desmarcar num quadro devolve a tarefa ao comeco da esteira. Deixa-la no
  -- status que fecha com `completed_at` nulo criaria a tarefa "concluida na
  -- coluna, nao concluida na ficha" — a contradicao que este desenho evita.
  update ideworks.tasks t
     set status_id    = case
                          when t.list_id is null then t.status_id
                          else coalesce(
                                 ideworks.first_open_status(
                                   ideworks.resolve_status_set(t.list_id)),
                                 t.status_id)
                        end,
         completed_at = null,
         completed_by = null,
         updated_at   = now()
   where t.id = p_task_id
     and ideworks.can_reach_task(t.list_id, t.client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_task_archived(p_task_id uuid, p_archived boolean)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks t
     set archived_at = case when p_archived then coalesce(t.archived_at, now()) else null end,
         updated_at  = now()
   where t.id = p_task_id
     and ideworks.can_reach_task(t.list_id, t.client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id and ideworks.can_reach_task(t.list_id, t.client_id)
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.task_assignees where task_id = p_task_id;

  -- `distinct` porque a tela pode mandar repetido, e a chave primaria recusaria
  -- com uma mensagem que ninguem entende.
  insert into ideworks.task_assignees (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;
end;
$fn$;

create or replace function ideworks.set_task_tags(p_task_id uuid, p_tag_ids uuid[])
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id and ideworks.can_reach_task(t.list_id, t.client_id)
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.task_tag_assignments where task_id = p_task_id;

  -- `group by` em vez de `distinct on`: a tela pode mandar id repetido, e a
  -- chave primaria recusaria com uma mensagem que ninguem entende.
  insert into ideworks.task_tag_assignments (task_id, tag_id)
  select p_task_id, g
    from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as g
   where exists (select 1 from ideworks.task_tags tg where tg.id = g)
   group by g;
end;
$fn$;

create or replace function ideworks.set_task_watchers(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id and ideworks.can_reach_task(t.list_id, t.client_id)
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.task_watchers where task_id = p_task_id;

  insert into ideworks.task_watchers (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;
end;
$fn$;

create or replace function ideworks.set_checklist_item_resolved(
  p_item_id  uuid,
  p_resolved boolean)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  update ideworks.checklist_items i
     set resolved_at = case
                         when p_resolved then coalesce(i.resolved_at, now())
                         else null
                       end,
         updated_at  = now()
   where i.id = p_item_id
     and ideworks.can_reach_checklist(i.checklist_id);

  if not found then
    raise exception 'item de checklist nao encontrado ou fora do seu alcance'
      using errcode = '42501';
  end if;
end;
$fn$;

-- --- 3. as cinco funcoes de alcance voltam ao texto anterior ------------------
create or replace function ideworks.can_see_space(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_superadmin()
      or exists (
           select 1 from ideworks.profiles p
            where p.id = ideworks.acting_user_id() and p.has_all_clients_access)
      or exists (
           select 1
             from ideworks.spaces s
             join ideworks.user_categories uc
               on uc.category_id = s.category_id
              and uc.user_id = ideworks.acting_user_id()
            where s.id = target)
$fn$;

comment on function ideworks.can_see_space(uuid) is
  'A regra de alcance do quadro, num lugar so. Sai da empresa (client_categories '
  'via user_categories), que e como a F14 ja separa Ide de Alma9.';

create or replace function ideworks.can_see_list(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_see_space(
           (select l.space_id from ideworks.lists l where l.id = target))
$fn$;

comment on function ideworks.can_see_list(uuid) is
  'O alcance da lista e o alcance do espaco dela — `can_see_space` da F17.1, '
  'nao uma segunda regra.';

create or replace function ideworks.can_see_status_set(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_see_space(
           (select ideworks.owner_space(ss.space_id, ss.folder_id, ss.list_id)
              from ideworks.status_sets ss where ss.id = target))
$fn$;

comment on function ideworks.can_see_status_set(uuid) is
  'O alcance da esteira e o alcance do espaco dela — `can_see_space` da F17.1, '
  'nao uma segunda regra. Os status usam esta funcao para nao ter politica '
  'propria.';

create or replace function ideworks.can_reach_task(p_list_id uuid, p_client_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select (p_list_id   is not null and ideworks.can_see_list(p_list_id))
      or (p_client_id is not null and ideworks.can_see_client(p_client_id))
$fn$;

comment on function ideworks.can_reach_task(uuid, uuid) is
  'A regra de alcance da tarefa, num lugar so: enxerga quem enxerga a LISTA '
  'dela; quando ela tem CLIENTE, o alcance do cliente tambem vale. Uniao, e nao '
  'intersecao — recusar o segundo caminho esconderia trabalho de quem o faz.';

create or replace function ideworks.can_write_owner(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when p_space_id is not null then ideworks.acting_is_superadmin()
           else ideworks.can_see_space(
                  ideworks.owner_space(p_space_id, p_folder_id, p_list_id))
         end
$fn$;

comment on function ideworks.can_write_owner(uuid, uuid, uuid) is
  'Quem escreve numa coisa de tres niveis: espaco e so administrador; pasta e '
  'lista sao de quem alcanca o espaco. Par de `owner_space` — a F17.5 (campos) '
  'e a F17.8 (visualizacoes) tem a MESMA forma de posse e chamam esta funcao, '
  'em vez de copiar a regra.';

-- --- 4. as funcoes que nasceram na F17.23 caem, de cima para baixo ------------
drop function if exists ideworks.set_node_access(uuid, uuid, uuid, boolean, jsonb);
drop function if exists ideworks.node_access(uuid, uuid, uuid);
drop function if exists ideworks.can_grant_on(uuid, uuid, uuid);
drop function if exists ideworks.can_act_on_checklist(uuid, ideworks.access_level);
drop function if exists ideworks.can_act_on_task_id(uuid, ideworks.access_level);
drop function if exists ideworks.can_act_on_task(uuid, uuid, ideworks.access_level);
drop function if exists ideworks.can_see_folder(uuid);
drop function if exists ideworks.can_act_on_chain(uuid, uuid, uuid, ideworks.access_level);

-- --- 5. as duas tabelas, com as politicas delas junto -------------------------
-- ⚠️ AQUI SE PERDEM AS PAREDES E AS CONCESSOES. Ver o aviso do cabecalho.
drop table if exists ideworks.node_grants;
drop table if exists ideworks.node_restrictions;

-- --- 6. o miolo da regra, agora que ninguem mais o chama ----------------------
drop function if exists ideworks.node_level(uuid, uuid, uuid);
drop function if exists ideworks.node_ceiling(uuid, uuid, uuid);
drop function if exists ideworks.chain_level(uuid, uuid, uuid);
drop function if exists ideworks.chain_ceiling_for(uuid, boolean, uuid, uuid, uuid);
drop function if exists ideworks.reaches_company(uuid);
drop function if exists ideworks.reaches_company_for(uuid, boolean, uuid);

-- --- 7. o tipo, por ultimo ----------------------------------------------------
drop type if exists ideworks.access_level;
