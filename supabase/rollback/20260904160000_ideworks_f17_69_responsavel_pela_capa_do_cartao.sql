-- =============================================================================
-- DESFAZER — F17.69  Definir responsavel sem abrir o cartao
-- =============================================================================
-- DUAS COISAS A DESFAZER, E ELAS NAO SAO IGUAIS
--
--   1. A funcao NOVA de leitura some. Nada depende dela no banco.
--
--   2. `set_task_assignees` VOLTA AO TEXTO DA F17.65 — o que estava no banco em
--      2026-09-04, lido com `pg_get_functiondef`. `drop` nao serve: a ficha da
--      tarefa, a criacao de tarefa, os passos e as automacoes chamam essa
--      funcao, e derruba-la pararia a escrita de responsavel no sistema
--      inteiro. Desfazer aqui e REPOR a versao anterior, inteira.
--
-- ⚠️ O QUE SE PERDE AO DESFAZER
--   A parede por empresa na ESCRITA. Volta a ser possivel pendurar uma tarefa
--   da Ide em alguem que so existe na Alma 9 — a divida antiga que a F17.69
--   fechou. Nenhum vinculo ja gravado e alterado nos dois sentidos: a guarda
--   olhava so quem ENTRAVA.
--
-- ⚠️ O SERVIDOR PARA DE ABRIR O MENU DA CAPA se a funcao de leitura sumir sem
-- que `src/server/responsaveis-da-tarefa.ts`, a rota do Worker e
-- `src/board/CartaoDeTarefa.tsx` voltem junto. Desfazer aqui pede desfazer o
-- codigo tambem.
-- =============================================================================

drop function if exists ideworks.assignable_people_for_task(uuid);

-- O TEXTO DA F17.65, PALAVRA POR PALAVRA, SEM O BLOCO DA F17.69.
create or replace function ideworks.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_antes   uuid[];
  v_depois  uuid[];
  v_tirados uuid[];
  v_postos  uuid[];
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id
       and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  -- O RETRATO DE ANTES, e ele é tirado AQUI e não depois: a escrita é um
  -- apaga-e-põe, e depois dela não há mais de onde saber quem estava.
  select coalesce(array_agg(a.user_id order by a.user_id), '{}'::uuid[])
    into v_antes
    from ideworks.task_assignees a
   where a.task_id = p_task_id;

  delete from ideworks.task_assignees where task_id = p_task_id;

  -- `distinct` porque a tela pode mandar repetido, e a chave primaria recusaria
  -- com uma mensagem que ninguem entende.
  insert into ideworks.task_assignees (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;

  -- ⚠️ O RETRATO DE DEPOIS SAI DA TABELA, e não de `p_user_ids`. Esta função
  -- DESCARTA em silêncio quem não tem perfil no IDE Works — está no comentário
  -- dela desde a F4.8 —, e registrar o que foi PEDIDO em vez do que FICOU faria
  -- o livro afirmar uma atribuição que não existe. É o mesmo argumento de
  -- `patchBoardTask`, que relê a ficha depois de escrever.
  select coalesce(array_agg(a.user_id order by a.user_id), '{}'::uuid[])
    into v_depois
    from ideworks.task_assignees a
   where a.task_id = p_task_id;

  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_tirados
    from unnest(v_antes) as x where not (x = any (v_depois));

  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_postos
    from unnest(v_depois) as x where not (x = any (v_antes));

  -- REGRAVAR A MESMA LISTA NÃO É EVENTO. A restrição do banco recusaria a linha
  -- em branco; recusar aqui é o mesmo que ela diz, com a diferença de não
  -- abortar uma gravação legítima que só não mudou nada.
  if v_tirados <> '{}'::uuid[] or v_postos <> '{}'::uuid[] then
    insert into ideworks.task_events
      (task_id, automation_id, automation_name,
       removed_user_ids, added_user_ids, actor_id)
    values
      (p_task_id, null, null,
       v_tirados, v_postos, ideworks.acting_user_id());
  end if;
end;
$fn$;
