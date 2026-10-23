-- Desfaz a F17.41. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F17.40: `move_task` volta a ser a da F17.15, as
--   perguntas de alcance voltam a ser as da F17.23 e da F17.32, e não há
--   automação nenhuma.
--
--   ATENÇÃO — REVERTER APAGA DADO DE TRABALHO, EM DOIS LUGARES:
--     · `drop table ideworks.task_automations` leva TODAS as regras de
--       automação de TODAS as listas. Só um backup as traz de volta.
--     · `drop table ideworks.task_events` leva O REGISTRO INTEIRO do que a
--       automação já fez — quem saiu de qual tarefa, por qual regra, quando.
--       Este é o dado que a etapa existe para criar, e ele não tem outra fonte:
--       a tarefa em si guarda só o estado de agora, nunca o caminho.
--
--   O que NÃO se perde: as tarefas. Elas ficam onde a automação as deixou, com
--   os responsáveis que a automação lhes deu. Reverter não desfaz movimento —
--   desfaz a capacidade de movimentar.
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   move_task                 → task_automations, task_events, can_reach_task_for
--   set_task_automation       → sweep_automation_stages E as duas tabelas
--   delete_task_automation    → sweep_automation_stages
--   task_events               → task_automations
--   task_automations          → automation_stages
--   can_see_client            → can_see_client_for
--   node_ceiling / node_level → node_ceiling_for / node_level_for
--
-- FUNÇÃO → TABELA NÃO É DEPENDÊNCIA REGISTRADA. Medido na F17.2b: corpo escrito
-- como literal (`$fn$…$fn$`) NÃO registra dependência em `pg_depend`. Apagar as
-- tabelas antes de restaurar `move_task` não daria `2BP01`; deixaria a função
-- viva consultando tabela inexistente, e o erro só apareceria no próximo
-- arrasto de cartão. Erro silencioso é pior que erro ruidoso — por isso
-- `move_task` é a PRIMEIRA coisa restaurada.
--
-- FUNÇÃO → FUNÇÃO TAMBÉM NÃO É, e aqui isso morde duas vezes: `can_see_client`,
-- `node_ceiling` e `node_level` passaram a DELEGAR às versões `_for`. As três
-- voltam ao corpo antigo ANTES de as `_for` serem apagadas.
--
-- `move_task` NÃO SE APAGA, SE RESTAURA. Ela é da F17.3, reescrita pela F17.15;
-- um `drop function` aqui apagaria função de outra etapa. O texto abaixo é o da
-- F17.15, palavra por palavra, comentários do corpo inclusive.
-- =============================================================================

-- --- 1. `move_task` volta a ser a da F17.15 ----------------------------------
create or replace function ideworks.move_task(
  p_task_id   uuid,
  p_list_id   uuid,
  p_status_id uuid default null)
  returns jsonb
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_status_antes uuid;
  v_lista_antes  uuid;
  v_set          uuid;
  v_novo         uuid;
  v_mexidas      integer;
begin
  if p_list_id is null then
    raise exception
      'mover exige a lista de destino. Para tirar a tarefa do quadro sem apaga-la, arquive-a com ideworks.set_task_archived.'
      using errcode = '22023';
  end if;

  -- Filtrado pela politica: tarefa fora do alcance simplesmente nao aparece.
  select t.status_id, t.list_id into v_status_antes, v_lista_antes
    from ideworks.tasks t where t.id = p_task_id;

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  if not ideworks.can_see_list(p_list_id) then
    raise exception
      'a lista de destino nao existe ou esta fora do seu alcance'
      using errcode = '42501';
  end if;

  v_set := ideworks.resolve_status_set(p_list_id);

  if v_set is null then
    raise exception
      'a lista de destino nao tem esteira: nem ela, nem a pasta dela, nem o espaco declaram um conjunto de status. Crie a esteira antes de mover a tarefa para la.'
      using errcode = '22023';
  end if;

  if p_status_id is not null then
    -- Escolhido por quem chama. O gatilho confere se pertence; aqui so passa.
    v_novo := p_status_id;
  elsif exists (
    select 1 from ideworks.statuses s
     where s.id = v_status_antes and s.status_set_id = v_set
  ) then
    -- A esteira nova e a mesma, ou tem por acaso o mesmo status: nao se mexe no
    -- que a equipe ja tinha marcado.
    v_novo := v_status_antes;
  else
    v_novo := ideworks.first_open_status(v_set);

    if v_novo is null then
      raise exception
        'a esteira da lista de destino nao tem nenhum status que abra: so ha o que fecha. A tarefa ficaria em estado inexistente, entao nada foi movido.'
        using errcode = '22023';
    end if;
  end if;

  -- AS DUAS COLUNAS NA MESMA ESCRITA, E AGORA A SUBÁRVORE INTEIRA TAMBÉM. Em
  -- dois comandos, uma falha no meio deixaria a tarefa numa lista cujo quadro
  -- não tem a coluna dela — e, com subtarefa, deixaria filhas numa lista e mãe
  -- em outra, que a chave estrangeira composta recusaria no fim.
  --
  -- `passo` é o mesmo teto de segurança do guarda: o ciclo é impossível daqui
  -- para a frente, mas uma recursão sem freio sobre dado torto não termina.
  with recursive familia as (
    select t.id, 1 as passo
      from ideworks.tasks t
     where t.id = p_task_id
    union all
    select f.id, m.passo + 1
      from ideworks.tasks f
      join familia m on f.parent_id = m.id
     where m.passo < 200
  )
  update ideworks.tasks t
     set list_id    = p_list_id,
         status_id  = case
                        when t.id = p_task_id then v_novo
                        when exists (select 1 from ideworks.statuses s
                                      where s.id = t.status_id
                                        and s.status_set_id = v_set)
                          then t.status_id
                        else ideworks.first_open_status(v_set)
                      end,
         updated_at = now()
    from familia fa
   where t.id = fa.id;

  get diagnostics v_mexidas = row_count;

  if v_mexidas = 0 then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  -- O gatilho pode ter trocado o status (nao trocou, neste caminho) e carimbado
  -- a conclusao. Le-se de volta o que FICOU, e nao o que se pretendia.
  select t.status_id into v_novo from ideworks.tasks t where t.id = p_task_id;

  -- "E a mudanca fica registrada": a operacao DEVOLVE o que fez, para quem
  -- chama registrar e para a tela poder dizer "o status foi reposicionado".
  -- `subtasks_moved` e novo na F17.15: a tela avisa quando um arrasto levou
  -- trabalho junto, porque mover cinco subtarefas sem dizer nada e um efeito
  -- colateral invisivel.
  return jsonb_build_object(
    'task_id',             p_task_id,
    'list_id',             p_list_id,
    'previous_list_id',    v_lista_antes,
    'status_id',           v_novo,
    'previous_status_id',  v_status_antes,
    'status_repositioned', v_novo is distinct from v_status_antes,
    'subtasks_moved',      v_mexidas - 1);
end;
$fn$;

comment on function ideworks.move_task(uuid, uuid, uuid) is
  'Troca lista e status em bloco (regra 9), porque o status antigo pode nao '
  'existir na esteira nova. Desde a F17.15 move a SUBARVORE inteira na mesma '
  'escrita: mover so a mae seria recusado pela cascata da chave estrangeira '
  'batendo em tasks_status_guard. Sem status escolhido: mantem o atual se ele '
  'existir la, senao cai no primeiro que abre. Devolve o que fez, inclusive '
  'quantas subtarefas foram junto.';

-- --- 2. as funções da etapa --------------------------------------------------
drop function if exists ideworks.set_task_automation(uuid, uuid, uuid, text, uuid, uuid, uuid, boolean, uuid);
drop function if exists ideworks.delete_task_automation(uuid);
drop function if exists ideworks.sweep_automation_stages();

-- --- 3. as tabelas -----------------------------------------------------------
-- As políticas caem junto com as tabelas. Um `drop policy` solto deixaria a
-- tabela viva com segurança por linha ligada e nenhuma política permissiva, que
-- é uma tabela viva e ilegível.
drop table if exists ideworks.task_events;
drop table if exists ideworks.task_automations;
drop table if exists ideworks.automation_stages;

-- --- 4. as perguntas de alcance voltam a NÃO delegar -------------------------
-- Corpo da F17.32, palavra por palavra.
create or replace function ideworks.can_see_client(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_super()
      or exists (
           select 1 from ideworks.profiles p
            where p.id = ideworks.acting_user_id() and p.has_all_clients_access)
      or exists (
           select 1 from ideworks.user_clients uc
            where uc.client_id = target and uc.user_id = ideworks.acting_user_id())
      or exists (
           select 1
             from ideworks.clients c
             join ideworks.user_categories ucat
               on ucat.category_id = c.category_id
              and ucat.user_id = ideworks.acting_user_id()
            where c.id = target)
$fn$;

comment on function ideworks.can_see_client(uuid) is
  'A UNICA regra de quem enxerga cliente. F17.32: o primeiro ramo passou de '
  '`acting_is_superadmin` (administra) para `acting_is_super` (so o topo) — '
  'quem administra passou a respeitar a empresa, como todo mundo.';

-- Corpos da F17.23, palavra por palavra.
create or replace function ideworks.node_ceiling(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when ideworks.owner_space(p_space_id, p_folder_id, p_list_id) is null
             then null
           else ideworks.chain_ceiling_for(
                  ideworks.acting_user_id(),
                  ideworks.acting_is_superadmin(),
                  ideworks.owner_space(p_space_id, p_folder_id, p_list_id),
                  coalesce(p_folder_id,
                           (select l.folder_id from ideworks.lists l
                             where l.id = p_list_id)),
                  p_list_id)
         end
$fn$;

comment on function ideworks.node_ceiling(uuid, uuid, uuid) is
  'O teto de um no de tres niveis — espaco, pasta OU lista —, com a corrente '
  'resolvida a partir dele. Sem a empresa: e o que a uniao da F17.3 precisa para '
  'aplicar o teto ao caminho do CLIENTE.';

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
  'O nivel efetivo de um no de tres niveis: a EMPRESA primeiro, o teto da '
  'corrente depois. E a funcao que `can_write_owner` passou a consultar, e por '
  'isso as esteiras herdaram a camada nova sem uma segunda regra.';

-- --- 5. e só então as versões `_for` desta etapa saem ------------------------
drop function if exists ideworks.can_reach_task_for(uuid, uuid, uuid);
drop function if exists ideworks.can_see_list_for(uuid, boolean, uuid);
drop function if exists ideworks.node_level_for(uuid, boolean, uuid, uuid, uuid);
drop function if exists ideworks.node_ceiling_for(uuid, boolean, uuid, uuid, uuid);
drop function if exists ideworks.can_see_client_for(uuid, boolean, uuid);
