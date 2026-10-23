-- Desfaz a F17.3c. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE, E ISTO É O MAIS IMPORTANTE DESTE ARQUIVO
--   O estado exato do fim da F17.4b — que é o estado com ONZE CAMINHOS DA
--   ÁRVORE ABERTOS e o carimbo da conclusão furado nas quatro formas. Reverter
--   aqui não devolve uma comodidade: devolve buracos que a sonda da F17.3c
--   atravessou um a um, o mais barato deles com um `insert` de uma linha:
--
--     `insert into ideworks.status_sets (list_id, ...)`   volta a passar, e o
--       status da tarefa parada deixa de pertencer à esteira resolvida da lista
--     `update ideworks.status_sets set space_id = <outro>` volta a deixar a
--       lista SEM esteira nenhuma
--     `update ideworks.statuses set status_set_id = ...`  volta a orfanar o
--       status da tarefa
--     `update ideworks.lists set space_id | folder_id`    volta a mudar a
--       esteira por baixo das tarefas da lista
--     `insert into ideworks.tasks (list_id, completed_at, ...)` volta a nascer
--       "concluída na ficha, aberta na coluna" — que é como a F17.11 grava
--
--   NÃO APAGA NADA. Nenhuma tabela, nenhuma linha, nenhuma coluna — esta etapa
--   não criou dado, criou recusa e coerência. Reverter é seguro para o conteúdo
--   do banco e perigoso só para a integridade dele.
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   três gatilhos → a função dos três. Depois, e SEPARADAMENTE, a restauração
--   de `task_status_guard`, que não é uma remoção.
--
-- GATILHO → FUNÇÃO É DEPENDÊNCIA REGISTRADA. `status_sets_workflow_guard`,
-- `statuses_workflow_guard` e `lists_workflow_guard` executam
-- `status_tree_guard()`: enquanto QUALQUER um dos três existir, o
-- `drop function` responde `2BP01` dizendo exatamente quem depende. A recusa é
-- a proteção, não o estorvo — por isso os três saem primeiro, e não porque
-- ficaria bonito.
--
-- OS TRÊS GATILHOS MORAM EM CASA ALHEIA, E OS TRÊS PRECISAM DE `drop trigger`
-- EXPLÍCITO. `ideworks.lists` é da F17.1, `ideworks.status_sets` e
-- `ideworks.statuses` são da F17.2, e nenhuma reversão desta série as apaga
-- antes desta rodar. Sem os `drop trigger`, as três tabelas ficariam com gatilho
-- apontando para função que não existe mais, e a primeira esteira mexida
-- quebraria com um erro que não diz de onde veio.
--
-- ENTRE FUNÇÃO E FUNÇÃO NÃO HÁ DEPENDÊNCIA REGISTRADA, e aqui isso morde de
-- verdade: `status_tree_guard` chama `ideworks.resolve_status_set` (F17.2), e
-- `task_status_guard` chama `resolve_status_set`, `closing_status`,
-- `first_open_status` e `acting_user_id`. Nenhuma delas é desta etapa, e este
-- arquivo NÃO as toca. Levá-las daqui deixaria funções órfãs em migrations
-- anteriores — pior que o erro ruidoso, porque só apareceria no primeiro
-- disparo.
--
-- `task_status_guard` NÃO SE APAGA, SE RESTAURA. Ela é da F17.3 e o gatilho
-- `tasks_status_guard`, que também é da F17.3, a executa. Um `drop function`
-- aqui responderia `2BP01` — e forçá-lo com `cascade` levaria o gatilho da
-- F17.3 junto, desfazendo uma etapa que não é esta. O que a F17.3c fez nela foi
-- `create or replace`; o que a reversão faz é `create or replace` de volta, com
-- o texto da F17.3 palavra por palavra, comentários do corpo inclusive.

-- 1. Os três gatilhos da árvore, e só então a função dos três.
drop trigger if exists status_sets_workflow_guard on ideworks.status_sets;
drop trigger if exists statuses_workflow_guard    on ideworks.statuses;
drop trigger if exists lists_workflow_guard       on ideworks.lists;

drop function if exists ideworks.status_tree_guard();

-- 2. O carimbo volta a ser o da F17.3 — texto literal daquela migration.
--    Com ele voltam os quatro furos do carimbo, listados no topo deste arquivo.
create or replace function ideworks.task_status_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_set        uuid;
  v_lista      text;
  v_tipo_novo  ideworks.status_type;
  v_tipo_velho ideworks.status_type;
  v_nome       text;
  v_mudou      boolean;
begin
  if new.list_id is not null then
    select l.name into v_lista from ideworks.lists l where l.id = new.list_id;

    -- Factual: dentro de `definer`, `resolve_status_set` volta a enxergar tudo.
    v_set := ideworks.resolve_status_set(new.list_id);

    if v_set is null then
      raise exception
        'a lista "%" nao tem esteira: nem ela, nem a pasta dela, nem o espaco declaram um conjunto de status. Crie a esteira com ideworks.create_status_set antes de por tarefa nela — sem esteira o quadro nao tem coluna nenhuma.',
        coalesce(v_lista, new.list_id::text)
        using errcode = '22023';
    end if;

    if new.status_id is null then
      new.status_id := ideworks.first_open_status(v_set);

      if new.status_id is null then
        raise exception
          'a esteira da lista "%" nao tem nenhum status que abra: so ha o que fecha. Acrescente ao menos um status de tipo "open" antes de por tarefa nela.',
          coalesce(v_lista, new.list_id::text)
          using errcode = '22023';
      end if;

    elsif not exists (
      select 1 from ideworks.statuses s
       where s.id = new.status_id and s.status_set_id = v_set
    ) then
      select s.name into v_nome from ideworks.statuses s where s.id = new.status_id;

      raise exception
        'o status % nao pertence a esteira da lista "%". O status da tarefa tem que sair da esteira RESOLVIDA da lista dela (lista -> pasta -> espaco); consulte ideworks.list_workflow para ver quais valem, ou use ideworks.move_task, que reposiciona sozinho.',
        coalesce(quote_literal(v_nome), 'informado'),
        coalesce(v_lista, new.list_id::text)
        using errcode = '23514';
    end if;
  end if;

  -- --- os instantes seguem o tipo do status ---------------------------------
  -- Só quando o status realmente mudou. Sem esta guarda, editar o título de uma
  -- tarefa concluída reescreveria `completed_by` para quem editou.
  v_mudou := new.status_id is distinct from (case when tg_op = 'UPDATE' then old.status_id end);

  if v_mudou then
    if new.status_id is not null then
      select s.type into v_tipo_novo from ideworks.statuses s where s.id = new.status_id;
    end if;
    if tg_op = 'UPDATE' and old.status_id is not null then
      select s.type into v_tipo_velho from ideworks.statuses s where s.id = old.status_id;
    end if;

    if v_tipo_novo = 'closed'::ideworks.status_type then
      -- `coalesce` pelo mesmo motivo de `complete_task`: quem concluiu e quando
      -- se guarda uma vez. Passar de novo pelo status que fecha nao reescreve
      -- historia.
      new.completed_at := coalesce(new.completed_at, now());
      new.completed_by := coalesce(new.completed_by, ideworks.acting_user_id());

    elsif v_tipo_velho = 'closed'::ideworks.status_type then
      -- Voltou para o quadro: a conclusao deixa de existir, inclusive o autor.
      -- Guardar o instante antigo faria "concluida desde" mentir na proxima vez
      -- — a mesma decisao que `set_task_archived` tomou na F4.8.
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;

  return new;
end;
$fn$;

comment on function ideworks.task_status_guard() is
  'O segundo gatilho do projeto, e so porque restricao nao alcanca: "o status '
  'pertence a esteira resolvida da lista" atravessa quatro tabelas e a '
  'resolucao e uma funcao. Recusa status de fora, preenche o primeiro que abre '
  'quando nao vem nenhum, e carimba a conclusao a partir do TIPO do status.';

-- ============================================== O QUE ESTE ARQUIVO NÃO FAZ ===
-- NÃO TOCA NO GATILHO `tasks_status_guard`. Ele é da F17.3, a F17.3c não o
-- recriou, e recriá-lo aqui mudaria uma coisa que a etapa nunca mudou.
--
-- NÃO TOCA NOS GUARDAS DA ETIQUETA. `task_tag_assignments_space_guard`,
-- `tasks_tag_space_guard`, `lists_tag_space_guard` e `task_tags_space_guard`
-- continuam onde estão. `lists_tag_space_guard` mora na MESMA tabela que
-- `lists_workflow_guard` e é de outra etapa: levá-lo daqui desfaria a F17.4b
-- por engano.
--
-- NÃO TOCA NOS GATILHOS DE RESTRIÇÃO DA F17.2. `status_sets_must_close` e
-- `statuses_must_close` também moram nas tabelas mexidas aqui, e também são de
-- outra etapa.
--
-- NÃO DESFAZ O `comment on column ideworks.tasks.completed_at`. O comentário
-- volta a descrever um comportamento que a reversão acabou de tirar, e isso é
-- proposital: um comentário desatualizado é ruído, mas apagá-lo devolveria o
-- da F4.8, que este arquivo não tem como saber qual era. Quem reverter que
-- reescreva — e é bom que a divergência fique visível.
--
-- ESTE ARQUIVO TEM QUE RODAR ANTES DO ROLLBACK DA F17.3, e a ordem é a
-- cronológica: `20260825130000` desfaz antes de `20260825100000`. Se alguém
-- inverter, a F17.3 restaura `task_status_guard` na versão dela e este arquivo
-- a restaura de novo — inofensivo por acaso —, mas os três gatilhos da árvore
-- ficariam apontando para uma função que o `drop` da F17.3 nunca vai tirar,
-- porque ela não é dela. A ordem cronológica invertida é a regra do projeto
-- justamente para não depender de acaso.
