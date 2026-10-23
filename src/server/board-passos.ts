/**
 * Os passos da tarefa — subtarefa e checklist. Etapa F17.15.
 *
 * ARQUIVO PRÓPRIO, PELA MESMA RAZÃO QUE A F17.10 SEPAROU `board-task.ts`
 *   `server/board.ts` lê o quadro, `board-task.ts` escreve a tarefa, e este
 *   escreve o que está DENTRO dela. Três arquivos, três assuntos.
 *
 * NENHUMA DECISÃO DE DOMÍNIO ACONTECE AQUI — e nesta etapa isso é quase literal.
 *   A F17.15 pôs praticamente todas as regras no banco, e a maioria delas em
 *   forma DECLARATIVA:
 *
 *     "a subtarefa mora na lista da mãe" ..... `tasks_parent_same_list_fk`
 *     "apagar a mãe leva as filhas" .......... `on delete cascade` da mesma
 *     "mover a mãe leva as filhas" ........... `on update cascade` da mesma
 *     "o item filho é de um nível só" ........ `checklist_items_parent_fk`
 *     "o nome não pode ser `{}`" ............. `is_meaningful_name` (F17.4)
 *     "ciclo é proibido" ..................... `tasks_parent_guard`
 *     "quem alcança a tarefa alcança tudo" ... as quatro políticas da F17.15
 *     "o primeiro instante se preserva" ...... `set_checklist_item_resolved`
 *
 *   O que sobra aqui é `insert`, `update` de nome e `delete` — e a ordem
 *   (`sort_order`), que não tem regra atrás dela.
 *
 * A SUBTAREFA NÃO RECEBE `list_id`, E ISSO É O PONTO
 *   `createSubtask` insere `parent_id` e NÃO insere lista. Quem preenche é
 *   `tasks_parent_guard`, que copia a lista e o cliente da mãe — e por isso a
 *   subtarefa herda a esteira, o espaço e o alcance sem que uma linha de
 *   TypeScript decida nada. Mandar a lista daqui seria uma segunda versão da
 *   regra, e a segunda é sempre a errada.
 *
 * TODA ESCRITA DEVOLVE A FICHA DA TAREFA, RELIDA
 *   Mesma decisão da F17.10, e aqui ela vale mais: marcar um item muda a
 *   contagem do checklist, criar uma subtarefa muda a contagem do cartão, e as
 *   duas saem de `ideworks.task_progress`. Devolver o que se pediu, em vez do
 *   que ficou, faria a tela mostrar um número que não é o do banco.
 *
 *   A releitura é feita DENTRO da mesma transação — se abrisse a própria, veria
 *   o mundo de antes da escrita.
 */

import type { TaskDetail } from '@/board/ficha';
import type { NewSubtask } from '@/board/passos';
import { BoardRefused } from '@/server/board';
import { lerFicha } from '@/server/board-task';
import { type Sql, type Tx, arrayOuNulo, withActor } from '@/server/db';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/**
 * A frase que a tela mostra quando o banco recusa.
 *
 * AS RESTRIÇÕES NOVAS DESTA ETAPA TÊM TRADUÇÃO PRÓPRIA, e não é enfeite: uma
 * chave estrangeira composta responde `23503` com o nome da restrição e nada
 * mais. "violates foreign key constraint tasks_parent_same_list_fk" não diz a
 * ninguém que a subtarefa mora na lista da mãe.
 *
 * Os códigos das travas escritas à mão (`42501`, `23514`, `22023`) continuam
 * saindo com a FRASE DO BANCO, inteira — as onze travas da F17 nomeiam o que
 * está no caminho e o que fazer, e trocá-las por "algo deu errado" jogaria fora
 * o trabalho delas.
 */
function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  const frase = emPortugues(e.message);

  if (
    e.constraint_name === 'task_checklists_name_is_a_name' ||
    e.constraint_name === 'checklist_items_name_is_a_name'
  ) {
    throw new BoardRefused(
      'O nome precisa ter alguma coisa além de pontuação e espaço — é a trava que impede o `{}` do Trello de nascer aqui.',
      400,
    );
  }
  if (e.constraint_name === 'tasks_parent_same_list_fk') {
    throw new BoardRefused(
      'A subtarefa mora na MESMA lista da mãe, e a mãe informada não está nela (ou não existe). Mover a mãe de lista leva as subtarefas junto; mover só a subtarefa não é possível.',
      400,
    );
  }
  if (e.constraint_name === 'checklist_items_parent_fk') {
    throw new BoardRefused(
      'O subitem tem que estar no mesmo checklist e um nível abaixo do pai. O checklist aceita UM nível de aninhamento — subitem de subitem é recusado pelo banco.',
      400,
    );
  }
  if (e.constraint_name === 'tasks_title_not_blank') {
    throw new BoardRefused('A subtarefa precisa de um título.', 400);
  }

  if (e.code === '42501') throw new BoardRefused(frase || 'Fora do seu alcance.', 403);
  if (e.code === '22023') throw new BoardRefused(frase || 'Escrita recusada.', 400);
  if (e.code === '23514') throw new BoardRefused(frase || 'Escrita recusada.', 400);
  if (e.code === '23503') throw new BoardRefused(frase || 'Escrita recusada.', 400);
  if (e.code === '22007' || e.code === '22008') throw new BoardRefused('Data inválida.', 400);

  throw erro;
}

/**
 * A tarefa a que este checklist (ou item) pertence.
 *
 * A POLÍTICA JÁ RECORTOU: `checklist_items_select` e `task_checklists_select`
 * chamam `can_reach_checklist` e `can_reach_task_id`, então uma linha fora do
 * alcance simplesmente não aparece. Ausência aqui é "não existe OU não é sua", e
 * as duas respondem igual de propósito — distinguir contaria que existe.
 *
 * ESCRITA VAZIA É RECUSA — correção da revisão pós-F43. Achar aqui não é poder
 * escrever: a leitura vale para o nível "ver", e as políticas de escrita
 * (F17.75) pedem `execute`. Para quem só vê, o `update`/`delete` não falha —
 * só não acha linha —, e as escritas abaixo devolviam a ficha com 200 sem ter
 * gravado nada. Por isso todas levam `returning` e recusam com 403 quando nada
 * volta, como `deleteAttachment`.
 */
async function tarefaDoChecklist(tx: Tx, checklistId: string): Promise<string> {
  const [linha] = await tx`
    select k.task_id from ideworks.task_checklists k where k.id = ${checklistId}`;
  if (!linha) throw new BoardRefused('Checklist não encontrado, ou fora do seu alcance.', 404);
  return linha.task_id as string;
}

async function tarefaDoItem(tx: Tx, itemId: string): Promise<string> {
  const [linha] = await tx`
    select k.task_id
      from ideworks.checklist_items i
      join ideworks.task_checklists k on k.id = i.checklist_id
     where i.id = ${itemId}`;
  if (!linha) throw new BoardRefused('Item não encontrado, ou fora do seu alcance.', 404);
  return linha.task_id as string;
}

/* ───────────────────────────── subtarefa ───────────────────────────── */

/**
 * A subtarefa, dentro da mãe.
 *
 * O QUE NÃO SE MANDA, E POR QUÊ
 *   · `list_id` — `tasks_parent_guard` copia a da mãe. É o que faz "a subtarefa
 *     herda a lista" ser verdade no modelo, e não só no chamador.
 *   · `client_id` — mesma coisa, pela mesma razão: com clientes diferentes, mãe
 *     e filha seriam lidas por gente diferente.
 *   · `status_id` pode vir, e quando não vem `tasks_status_guard` põe o primeiro
 *     que ABRE da esteira resolvida. É o caminho normal da criação inline.
 *
 * TUDO NO MESMO BLOCO (regra 9): criar e atribuir em duas chamadas deixaria
 * subtarefa sem dono se a segunda falhasse, e ninguém percebe uma atribuição
 * que não aconteceu.
 */
export async function createSubtask(
  sql: Sql,
  actor: AuthenticatedActor,
  parentId: string,
  entrada: NewSubtask,
): Promise<{ id: string; task: TaskDetail }> {
  if (entrada.title.trim() === '') {
    throw new BoardRefused('A subtarefa precisa de um título.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    const id = await createSubtaskInTx(tx, parentId, entrada, actor.userId);
    try {
      return { id, task: await lerFicha(tx, parentId) };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/**
 * O que o MIOLO da subtarefa aceita: o pedido da tela e, para o caminho do
 * agente (F38, Fase 6.4), a descrição — o `create_task` do MCP a aceita, e a
 * tela simplesmente não a manda.
 */
export type NewSubtaskInTx = NewSubtask & { description?: string | null };

/**
 * O MIOLO do criar subtarefa, no `Tx` de quem chama — F38, Fase 6.4, mesmo
 * padrão de `createBoardTaskInTx` (F26.3).
 *
 * Recebe um `Tx` JÁ ABERTO, com o ator já declarado. Não chama `withActor`. A
 * tela chama por `createSubtask`; o `create_task` do agente com `parentId`
 * chama direto de dentro do `mutate` de `runAgentWrite`, no `sqlTx` do registro
 * — chamar o invólucro de lá abriria uma segunda transação fora do ledger.
 *
 * `autorId` vem de código confiável (a pessoa logada, ou o dono da concessão),
 * nunca do corpo do pedido — a mesma regra de `createBoardTaskInTx`.
 *
 * O CLIENTE NÃO É MANDADO, e não por esquecimento: `tasks_parent_guard` copia o
 * `client_id` GRAVADO da mãe, e recusa (23514) qualquer outro — inclusive o da
 * lista quando a mãe legada não tem cliente gravado. Pela regra de leitura
 * (`clienteDaTarefa*`: o da tarefa, senão o da lista), a filha lê o mesmo
 * cliente efetivo da mãe nos dois casos, porque mora na mesma lista. Devolve o
 * id da subtarefa nova; a releitura é de quem chama.
 */
export async function createSubtaskInTx(
  tx: Tx,
  parentId: string,
  entrada: NewSubtaskInTx,
  autorId: string,
): Promise<string> {
  if (entrada.title.trim() === '') {
    throw new BoardRefused('A subtarefa precisa de um título.', 400);
  }

  try {
    // A mãe tem que ser alcançável ANTES de escrever. O guarda também confere
    // — e é ele quem vale —, mas conferir aqui dá 404 em vez de deixar a
    // política filtrar em silêncio e o `insert` parecer que funcionou.
    const [mae] = await tx`select t.id from ideworks.tasks t where t.id = ${parentId}`;
    if (!mae) throw new BoardRefused('Tarefa mãe não encontrada, ou fora do seu alcance.', 404);

    const [criada] = await tx`
      insert into ideworks.tasks
             (parent_id, title, description, due_on, start_on, priority, status_id, created_by)
      values (${parentId}, ${entrada.title.trim()}, ${entrada.description ?? null},
              ${entrada.dueOn}::date, ${entrada.startOn}::date,
              ${entrada.priority}::ideworks.task_priority,
              ${entrada.statusId}, ${autorId})
      returning id`;

    // A política `tasks_insert` filtra em silêncio: sem `returning` a recusa
    // por alcance pareceria sucesso.
    if (!criada) {
      throw new BoardRefused('Tarefa mãe não encontrada, ou fora do seu alcance.', 403);
    }

    const id = criada.id as string;

    if (entrada.assigneeIds.length > 0) {
      await tx`select ideworks.set_task_assignees(${id}, ${arrayOuNulo(entrada.assigneeIds)}::uuid[])`;
    }
    if (entrada.tagIds.length > 0) {
      await tx`select ideworks.set_task_tags(${id}, ${arrayOuNulo(entrada.tagIds)}::uuid[])`;
    }

    return id;
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

/**
 * Prender ou soltar uma tarefa de uma mãe.
 *
 * SOLTAR É O ÚNICO CAMINHO DE VOLTA que não apaga trabalho. Apagar a mãe leva as
 * filhas (`on delete cascade`), então sem isto a única forma de "tirar da mãe"
 * seria destrutiva.
 *
 * PRENDER passa pelas duas travas: `tasks_parent_guard` recusa ciclo, mãe fora
 * do alcance e mãe de si mesma; `tasks_parent_same_list_fk` recusa mãe de outra
 * lista. Nenhuma das duas é reimplementada aqui.
 */
export async function setTaskParent(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  parentId: string | null,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const alteradas = await tx`
        update ideworks.tasks t
           set parent_id  = ${parentId},
               updated_at = now()
         where t.id = ${taskId}
         returning t.id`;

      if (alteradas.length === 0) {
        throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 404);
      }
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/* ───────────────────────────── checklist ───────────────────────────── */

/**
 * A próxima posição, calculada no banco.
 *
 * `max + 1`, e não `count`: apagar o item do meio deixaria dois com a mesma
 * posição, e a ordem passaria a depender do desempate por nome — o item novo
 * apareceria no meio da lista sem ninguém ter pedido.
 */
export async function createChecklist(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  name: string,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [criada] = await tx`
        insert into ideworks.task_checklists (task_id, name, sort_order, created_by)
        select ${taskId}, ${name.trim()},
               coalesce(max(k.sort_order) + 1, 0), ${actor.userId}
          from ideworks.task_checklists k
         where k.task_id = ${taskId}
        returning id`;

      if (!criada) {
        throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 403);
      }
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function renameChecklist(
  sql: Sql,
  actor: AuthenticatedActor,
  checklistId: string,
  name: string,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const taskId = await tarefaDoChecklist(tx, checklistId);
      const mudadas = await tx`
        update ideworks.task_checklists
           set name = ${name.trim()}, updated_at = now()
         where id = ${checklistId}
        returning id`;
      // Achou na leitura e não escreveu: é a política de escrita (`execute`)
      // barrando quem só vê a tarefa. Ver `ESCRITA VAZIA É RECUSA`, acima.
      if (mudadas.length === 0) throw new BoardRefused('Você não pode mexer neste checklist.', 403);
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/**
 * Apagar o checklist inteiro.
 *
 * `on delete cascade` leva os itens — eles são parte dele e fora dele não querem
 * dizer nada. É a mesma decisão de `task_tags` na F17.4: metadado do dono se vai
 * com o dono; trabalho de outro dono é que se recusa a apagar.
 */
export async function deleteChecklist(
  sql: Sql,
  actor: AuthenticatedActor,
  checklistId: string,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const taskId = await tarefaDoChecklist(tx, checklistId);
      const apagadas = await tx`
        delete from ideworks.task_checklists where id = ${checklistId} returning id`;
      if (apagadas.length === 0) throw new BoardRefused('Você não pode apagar este checklist.', 403);
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/* ───────────────────────────── o item ───────────────────────────── */

export async function addChecklistItem(
  sql: Sql,
  actor: AuthenticatedActor,
  checklistId: string,
  entrada: { name: string; parentItemId: string | null },
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const taskId = await tarefaDoChecklist(tx, checklistId);

      const [criado] = await tx`
        insert into ideworks.checklist_items
               (checklist_id, parent_item_id, name, sort_order, created_by)
        select ${checklistId}, ${entrada.parentItemId}, ${entrada.name.trim()},
               coalesce(max(i.sort_order) + 1, 0), ${actor.userId}
          from ideworks.checklist_items i
         where i.checklist_id = ${checklistId}
        returning id`;

      if (!criado) {
        throw new BoardRefused('Checklist não encontrado, ou fora do seu alcance.', 403);
      }
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/**
 * O que muda num item: o nome, o responsável e o resolvido.
 *
 * O RESOLVIDO NÃO É UM `update`, É `set_checklist_item_resolved` — porque há
 * regra atrás dele: o PRIMEIRO instante se preserva (marcar de novo não
 * reescreve quando foi) e desmarcar limpa. Escrever `resolved_at = now()` aqui
 * seria uma segunda versão dessa regra.
 *
 * CAMPO AUSENTE É CAMPO NÃO MEXIDO, como no `PATCH` da ficha: marcar o item não
 * pode apagar o responsável dele.
 */
export async function patchChecklistItem(
  sql: Sql,
  actor: AuthenticatedActor,
  itemId: string,
  patch: { name?: string; resolved?: boolean; assigneeId?: string | null },
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const taskId = await tarefaDoItem(tx, itemId);

      if (patch.name !== undefined || patch.assigneeId !== undefined) {
        const mudados = await tx`
          update ideworks.checklist_items i
             set name        = case when ${patch.name !== undefined}
                                    then ${patch.name ?? ''}::text else i.name end,
                 assignee_id = case when ${patch.assigneeId !== undefined}
                                    then ${patch.assigneeId ?? null}::uuid
                                    else i.assignee_id end,
                 updated_at  = now()
           where i.id = ${itemId}
          returning i.id`;
        if (mudados.length === 0) throw new BoardRefused('Você não pode mexer neste item.', 403);
      }

      if (patch.resolved !== undefined) {
        await tx`select ideworks.set_checklist_item_resolved(${itemId}, ${patch.resolved})`;
      }

      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/** Apagar o item leva os filhos dele — `checklist_items_parent_fk on delete cascade`. */
export async function deleteChecklistItem(
  sql: Sql,
  actor: AuthenticatedActor,
  itemId: string,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const taskId = await tarefaDoItem(tx, itemId);
      const apagados = await tx`
        delete from ideworks.checklist_items where id = ${itemId} returning id`;
      if (apagados.length === 0) throw new BoardRefused('Você não pode apagar este item.', 403);
      return await lerFicha(tx, taskId);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}
