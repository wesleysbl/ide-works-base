-- Desfaz a F17.15. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F17.14: a tarefa não tem mãe, não há checklist, e
--   `move_task` volta a mover UMA linha.
--
--   ATENÇÃO — REVERTER APAGA DADO DE TRABALHO, E EM DOIS LUGARES DIFERENTES:
--     · `drop table ideworks.checklist_items` e `task_checklists` levam TODOS
--       os checklists de TODAS as tarefas. Não há como guardá-los: as tabelas
--       deixam de existir. Só um backup os traz de volta.
--     · `alter table ideworks.tasks drop column parent_id` apaga QUEM É FILHA DE
--       QUEM. As tarefas continuam todas lá — nenhuma linha some, porque a
--       coluna sai antes de qualquer cascata poder disparar —, mas a árvore de
--       subtarefas fica achatada: cinco subtarefas viram cinco tarefas soltas na
--       mesma lista, e ninguém consegue dizer de qual mãe elas vieram.
--
--   Isso é diferente da F17.3c, que só revertia recusa. Aqui há dado dentro.
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   view task_progress            → as três tabelas que ela lê
--   set_checklist_item_resolved   → can_reach_checklist  E  checklist_items
--   checklist_items               → task_checklists
--   task_checklists               → (as políticas caem com as tabelas)
--   can_reach_checklist           → (depois que as políticas que a usam caíram)
--   gatilho tasks_parent_guard    → a função dele
--   a chave estrangeira composta  → a restrição única que ela referencia
--
-- A VIEW É DEPENDÊNCIA REGISTRADA. `task_progress` lê `tasks`,
-- `task_checklists` e `checklist_items`: enquanto ela existir, qualquer
-- `drop table` responde `2BP01` dizendo que a view depende. Por isso ela sai
-- primeiro, e não porque ficaria bonito.
--
-- POLÍTICA → FUNÇÃO TAMBÉM É DEPENDÊNCIA REGISTRADA. `checklist_items_select` e
-- `checklist_items_write` executam `can_reach_checklist`: um `drop function`
-- antes de a tabela cair responderia `2BP01`. As políticas NÃO têm `drop policy`
-- solto — elas caem junto com a tabela. Um `drop policy` fora de ordem deixaria
-- a tabela com RLS ligada e nenhuma política permissiva, que é uma tabela viva e
-- ilegível.
--
-- FUNÇÃO → FUNÇÃO NÃO É DEPENDÊNCIA REGISTRADA, e aqui isso morde:
-- `set_checklist_item_resolved` chama `can_reach_checklist`, e o banco não
-- avisaria se a segunda saísse primeiro — ficaria uma função viva chamando
-- função que não existe, e o erro só apareceria na próxima marcação de item.
-- Erro silencioso é pior que erro ruidoso.
--
-- FUNÇÃO → TABELA TAMBÉM NÃO É. Foi medido na F17.2b: corpo escrito como
-- literal (`$fn$…$fn$`) NÃO registra dependência em `pg_depend`. Apagar
-- `checklist_items` antes de `set_checklist_item_resolved` não daria `2BP01`;
-- deixaria a função viva consultando tabela inexistente.
--
-- `can_reach_task_id` NÃO É APAGADA AQUI. Ela é da F17.3 e continua servindo
-- `task_assignees` e `task_watchers`. O rollback da F17.3 é que a leva.
-- `is_meaningful_name` é da F17.4, e continua servindo `task_tags`.
--
-- `move_task` NÃO SE APAGA, SE RESTAURA. Ela é da F17.3; um `drop function`
-- aqui apagaria uma função de outra etapa, e `create or replace` de volta é o
-- que a F17.3c já fez com `task_status_guard`. O texto abaixo é o da F17.3,
-- palavra por palavra, comentários do corpo inclusive.
--
-- A COLUNA SAI POR ÚLTIMO, E ANTES DELA A CHAVE ESTRANGEIRA. `alter table drop
-- column` levaria a chave estrangeira e o índice junto, em silêncio. Tirá-los à
-- mão, na ordem, é o que torna a reversão LEGÍVEL — e é o que impede que a
-- restrição única `tasks_id_list_key`, que não depende de `parent_id`, fique
-- para trás sem ninguém notar.

-- 1. A view, antes das tabelas que ela lê.
drop view if exists ideworks.task_progress;

-- 2. A ação, antes da tabela que ela escreve e da função que ela chama.
drop function if exists ideworks.set_checklist_item_resolved(uuid, boolean);

-- 3. As duas tabelas, filha antes de mãe. As políticas, os índices e a chave
--    estrangeira composta do item caem com elas, sem comando próprio.
drop table if exists ideworks.checklist_items;
drop table if exists ideworks.task_checklists;

-- 4. Só agora a função de alcance: as políticas que a executavam já não existem.
drop function if exists ideworks.can_reach_checklist(uuid);

-- 5. O gatilho da mãe, e só então a função dele.
drop trigger if exists tasks_parent_guard on ideworks.tasks;
drop function if exists ideworks.task_parent_guard();

-- 6. `move_task` volta a ser a da F17.3 — texto literal daquela migration.
--    Com ela volta o buraco medido: mover uma tarefa COM subtarefas para uma
--    lista de esteira diferente passa a ser recusado com `23514`, porque a
--    cascata da chave estrangeira bate em `tasks_status_guard`. Como a chave
--    estrangeira também sai logo abaixo, o buraco fecha por não haver mais
--    subtarefa nenhuma.
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

  -- As duas colunas na MESMA escrita. Em dois comandos, uma falha no meio
  -- deixaria a tarefa numa lista cujo quadro nao tem a coluna dela.
  update ideworks.tasks
     set list_id    = p_list_id,
         status_id  = v_novo,
         updated_at = now()
   where id = p_task_id;

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  -- O gatilho pode ter trocado o status (nao trocou, neste caminho) e carimbado
  -- a conclusao. Le-se de volta o que FICOU, e nao o que se pretendia.
  select t.status_id into v_novo from ideworks.tasks t where t.id = p_task_id;

  -- "E a mudanca fica registrada": a operacao DEVOLVE o que fez, para quem
  -- chama registrar e para a tela poder dizer "o status foi reposicionado".
  -- A linha do tempo da tarefa e a F17.10, e inventar aqui a tabela de eventos
  -- que ela vai desenhar seria adivinhar a forma dela.
  return jsonb_build_object(
    'task_id',             p_task_id,
    'list_id',             p_list_id,
    'previous_list_id',    v_lista_antes,
    'status_id',           v_novo,
    'previous_status_id',  v_status_antes,
    'status_repositioned', v_novo is distinct from v_status_antes);
end;
$fn$;

comment on function ideworks.move_task(uuid, uuid, uuid) is
  'Troca lista e status em bloco (regra 9), porque o status antigo pode nao '
  'existir na esteira nova. Sem status escolhido: mantem o atual se ele existir '
  'la, senao cai no primeiro que abre. Devolve o que fez, inclusive se '
  'reposicionou.';


-- 7. A âncora da subtarefa, na ordem: a chave estrangeira que usa, depois a
--    restrição única que é usada, depois o índice, e só então a coluna.
alter table ideworks.tasks drop constraint if exists tasks_parent_same_list_fk;
alter table ideworks.tasks drop constraint if exists tasks_id_list_key;
drop index if exists ideworks.tasks_parent_idx;

-- ISTO APAGA QUEM É FILHA DE QUEM. Nenhuma tarefa some — a chave estrangeira já
-- saiu, então não há cascata para disparar —, mas a árvore fica achatada.
alter table ideworks.tasks drop column if exists parent_id;

-- ============================================== O QUE ESTE ARQUIVO NÃO FAZ ===
-- NÃO TOCA EM `tasks_status_guard` NEM EM `tasks_tag_space_guard`. Os dois moram
-- na MESMA tabela que `tasks_parent_guard` e são de outras etapas — a F17.3/
-- F17.3c e a F17.4b. Levá-los daqui desfaria etapas que não são esta.
--
-- NÃO TOCA EM `tasks_list_fk`, `tasks_status_fk`, `tasks_anchored` nem
-- `tasks_status_needs_list`. Todas da F17.3.
--
-- NÃO TOCA EM `complete_task`, `uncomplete_task`, `set_task_archived` NEM
-- `set_task_assignees`. A F17.15 não mexeu em nenhuma delas: concluir a mãe
-- continua não concluindo as filhas, e arquivar a mãe continua não arquivando
-- as filhas — as duas decisões estão no cabeçalho da migration.
--
-- NÃO TOCA EM `is_meaningful_name`. Ela é da F17.4 e continua sendo a regra de
-- nome de `task_tags`. As duas restrições que a usavam aqui caíram junto com as
-- tabelas.
--
-- ESTE ARQUIVO TEM QUE RODAR ANTES DO ROLLBACK DA F17.3, e a ordem é a
-- cronológica: `20260826100000` desfaz antes de `20260825100000`. Se alguém
-- inverter, a F17.3 restaura `move_task` na versão dela e este arquivo a
-- restaura de novo — inofensivo por acaso —, mas `tasks_parent_same_list_fk`
-- ficaria apontando para uma restrição única que o `drop` da F17.3 nunca vai
-- tirar, porque ela não é dela. A ordem cronológica invertida é a regra do
-- projeto justamente para não depender de acaso.
