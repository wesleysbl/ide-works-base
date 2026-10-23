-- =============================================================================
-- ROLLBACK da F17.19 — a esteira volta a NAO poder mudar com tarefa dentro.
--
-- O QUE ELE DESFAZ, NESTA ORDEM
--   1. apaga `ideworks.set_list_workflow` — a funcao que migra as tarefas;
--   2. devolve ao `status_tree_guard` a frase da F17.3c, com `ideworks.move_task`
--      e o "ou conclua-as" que nao funciona;
--   3. devolve `status_sets_workflow_guard` a condicao de gatilho IMEDIATO.
--
-- ⚠️ DEPOIS DELE, A TELA DE ESTEIRA VOLTA A RECUSAR lista com tarefa dentro.
--   Nao ha estrago de dado: nenhuma coluna, tabela ou linha e tocada aqui. O que
--   volta e a recusa — e ela era o defeito que a etapa veio consertar.
--
-- A camada de traducao do aplicativo (`src/server/recusas.ts`) continua tirando
-- o nome da funcao do caminho do olho mesmo com a frase velha de volta: ela foi
-- escrita justamente para essa janela.
-- =============================================================================

drop function if exists ideworks.set_list_workflow(uuid, text, jsonb, jsonb, uuid);

-- --- a funcao com a frase da F17.3c, palavra por palavra ---------------------
create or replace function ideworks.status_tree_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_tarefas    uuid[];
  v_old_space  uuid;
  v_old_folder uuid;
  v_old_list   uuid;
  v_tarefa     text;
  v_status     text;
  v_esteira    text;
  v_lista      text;
  v_resolvida  text;
  v_agora      text;
  v_quantas    integer;
begin
  if tg_table_name = 'lists' then
    -- `after update of space_id, folder_id` dispara quando o comando MENCIONA
    -- qualquer uma das duas, mesmo sem mudar o valor. Sem esta saída, um
    -- `update` genérico que reescreva a lista inteira pagaria a varredura por
    -- nada — e a lista pode ter centenas de tarefas. Mencionar as DUAS é o que
    -- cobre `set space_id = X, folder_id = null` na mesma escrita, a porta
    -- disfarçada que a F17.4b quase deixou passar.
    if new.space_id  is not distinct from old.space_id
   and new.folder_id is not distinct from old.folder_id then
      return null;
    end if;

    select array_agg(t.id) into v_tarefas
      from ideworks.tasks t
     where t.list_id = new.id and t.status_id is not null;

  elsif tg_table_name = 'statuses' then
    if new.status_set_id is not distinct from old.status_set_id then
      return null;
    end if;

    -- Escopo exato: só quem está NESTE status pode ficar órfão por ele mudar de
    -- esteira. Gatilho de linha, então um `update` em lote dispara por linha.
    select array_agg(t.id) into v_tarefas
      from ideworks.tasks t
     where t.status_id = new.id;

  else
    -- `status_sets`. No `INSERT` não há `old`, e ler `old.qualquer_coisa` ali
    -- estoura antes de a consulta rodar — plpgsql passa a variável como
    -- parâmetro, e `and` de SQL não garante curto-circuito. Por isso os três
    -- valores velhos passam por variáveis, atribuídas só quando existem.
    if tg_op = 'UPDATE' then
      if new.space_id  is not distinct from old.space_id
     and new.folder_id is not distinct from old.folder_id
     and new.list_id   is not distinct from old.list_id then
        return null;
      end if;

      v_old_space  := old.space_id;
      v_old_folder := old.folder_id;
      v_old_list   := old.list_id;
    end if;

    -- Os DOIS lados: o dono novo (que passa a valer para as listas de baixo
    -- dele) e o dono velho (que deixa de valer para as de baixo do outro). Com
    -- a coluna nula a comparação devolve nulo e simplesmente não casa — não
    -- precisa de caso especial por nível.
    select array_agg(t.id) into v_tarefas
      from ideworks.tasks t
      join ideworks.lists l on l.id = t.list_id
     where t.status_id is not null
       and (l.id        = new.list_id
         or l.folder_id = new.folder_id
         or l.space_id  = new.space_id
         or l.id        = v_old_list
         or l.folder_id = v_old_folder
         or l.space_id  = v_old_space);
  end if;

  if v_tarefas is null then
    return null;
  end if;

  -- A FRASE DA F17.3, CONFERIDA DEPOIS DA ESCRITA. `resolve_status_set` já
  -- enxerga o mundo novo porque este gatilho é `AFTER` — ver o cabeçalho.
  --
  -- `count(*) over ()` conta TODAS as linhas que casam, e não só a que o
  -- `limit 1` traz: a janela se calcula antes do limite. É o que permite dizer
  -- "são N no caminho" mostrando uma, em vez de despejar a lista inteira na
  -- mensagem de erro.
  --
  -- O `left join` da esteira NOVA é o que permite a mensagem dizer para onde a
  -- lista foi parar — ou que ela não foi parar em lugar nenhum.
  select t.title, s.name, ss.name, l.name, nova.name, count(*) over ()
    into v_tarefa, v_status, v_esteira, v_lista, v_resolvida, v_quantas
    from ideworks.tasks t
    join ideworks.statuses     s    on s.id  = t.status_id
    join ideworks.status_sets  ss   on ss.id = s.status_set_id
    join ideworks.lists        l    on l.id  = t.list_id
    left join ideworks.status_sets nova
           on nova.id = ideworks.resolve_status_set(t.list_id)
   where t.id = any (v_tarefas)
     and s.status_set_id is distinct from ideworks.resolve_status_set(t.list_id)
   order by l.name, t.created_at, t.id
   limit 1;

  if found then
    -- Duas frases, porque os dois estragos são diferentes e o que fazer também:
    -- ficar sem esteira nenhuma é o quadro sumir, e trocar de esteira é o cartão
    -- ficar numa coluna que aquele quadro não tem.
    v_agora := case
                 when v_resolvida is null
                 then 'e a lista ficaria SEM esteira nenhuma: o quadro dela nao teria coluna'
                 else format('e a esteira resolvida dessa lista passaria a ser "%s"',
                             v_resolvida)
               end;

    raise exception
      'a tarefa "%" da lista "%" esta no status %, da esteira "%", %. Sao % tarefa(s) no caminho. A esteira de uma lista so pode mudar quando nenhuma tarefa depende dela: mova essas tarefas para outra lista com ideworks.move_task (ou conclua-as), mude a esteira, e traga-as de volta — move_task reposiciona o status sozinho e diz que reposicionou. Nada foi mudado.',
      v_tarefa, v_lista, quote_literal(v_status), v_esteira, v_agora, v_quantas
      using errcode = '23514';
  end if;

  return null;
end;
$fn$;


comment on function ideworks.status_tree_guard() is
  'As portas da ARVORE da invariante da F17.3: `tasks_status_guard` guarda as '
  'colunas da TAREFA, e esta funcao guarda as que mudam a arvore por baixo dela '
  '— quem e o dono da esteira, de que esteira e o status, e onde a lista mora. '
  'Uma funcao para tres gatilhos, como `status_set_must_close`, porque a regra e '
  'uma so. Recusa em vez de reposicionar: reposicionar precisa de destino, e em '
  'cinco dos caminhos medidos a lista fica sem esteira nenhuma.';

-- --- o gatilho do conjunto volta a ser imediato ------------------------------
drop trigger if exists status_sets_workflow_guard on ideworks.status_sets;
create trigger status_sets_workflow_guard
  after insert or update on ideworks.status_sets
  for each row execute function ideworks.status_tree_guard();

-- Os outros dois nunca mudaram; recriados para o arquivo descrever o estado
-- inteiro dos tres, como a migration faz.
drop trigger if exists statuses_workflow_guard on ideworks.statuses;
create trigger statuses_workflow_guard
  after update of status_set_id on ideworks.statuses
  for each row execute function ideworks.status_tree_guard();

drop trigger if exists lists_workflow_guard on ideworks.lists;
create trigger lists_workflow_guard
  after update of space_id, folder_id on ideworks.lists
  for each row execute function ideworks.status_tree_guard();
