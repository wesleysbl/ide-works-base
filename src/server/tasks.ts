/**
 * Tarefas — etapa F4.8.
 *
 * A tabela se chama `tasks` por causa da regra 10 do roteiro: o modelo de
 * tarefa é construído uma vez só, e o Pilar B vai reusar este. A interface diz
 * "Demandas". Ver a migration da F4.8.
 *
 * O NOME DE QUEM CUIDA SAI DO PERFIL, NÃO DA TAREFA
 *   O legado guarda `user_name` ao lado de `user_id` em quatro lugares. Cópia
 *   não se atualiza: quem muda de nome fica com o antigo colado em toda tarefa
 *   que já tocou. Aqui o nome é resolvido na leitura.
 *
 * MAS NÃO POR JUNÇÃO COM `profiles` — E ISSO QUASE PASSOU DESPERCEBIDO
 *   `profiles_select` deixa cada pessoa ver **o próprio** perfil, e mais nada.
 *   Uma junção com `profiles` aqui não daria erro: daria VAZIO. A tarefa
 *   atribuída a outra pessoa apareceria **sem responsável**, calada.
 *
 *   Por isso o nome vem de `ideworks.display_name()` e a lista de
 *   `ideworks.team_directory()` — funções com dono que devolvem só
 *   identificador e nome, sem afrouxar a política de `profiles`. Ver a
 *   migration da F4.8b.
 */

import { FRASE_SUBTAREFA_NAO_SAI_SOZINHA } from '@/server/board-task';
import { type Sql, arrayOuNulo, withActor } from '@/server/db';
import { tarefaForaDasOmitidas } from '@/server/omitidas';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export type TaskAssignee = { id: string; name: string };

export type Task = {
  id: string;
  clientId: string;
  title: string;
  description: string | null;
  dueOn: string | null;
  completedAt: string | null;
  completedBy: TaskAssignee | null;
  archivedAt: string | null;
  assignees: TaskAssignee[];
  createdAt: string;
};

export class TaskRefused extends Error {
  readonly status: 400 | 403 | 404;

  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.name = 'TaskRefused';
    this.status = status;
  }
}

const comoDia = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

const comoInstante = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

/** A frase que a tela mostra quando o banco recusa por política. */
function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  if (e.code === '42501') throw new TaskRefused(e.message ?? 'Sem permissão.', 403);
  if (e.constraint_name === 'tasks_title_not_blank') {
    throw new TaskRefused('A demanda precisa de um título.', 400);
  }
  // F44, Fase 8 — concluir e reabrir a demanda que está num quadro passam por
  // `move_task` (F44_6), e a automação da etapa pode recusar como no arrasto:
  // destino sem esteira (22023), etiqueta de outro espaço (23514), lista de
  // produção sem tipo (IW040), subtarefa que a regra tiraria da lista da mãe.
  // São frases escritas para gente — 400, e não 500.
  if (e.constraint_name === 'tasks_parent_same_list_fk') {
    throw new TaskRefused(FRASE_SUBTAREFA_NAO_SAI_SOZINHA, 400);
  }
  if (e.code === '22023' || e.code === '23514' || e.code === 'IW040') {
    throw new TaskRefused(emPortugues(e.message), 400);
  }
  throw erro;
}

/* ─────────────────────────── leitura ─────────────────────────── */

export async function readTasks(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  incluirArquivadas = false,
): Promise<Task[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // Uma consulta só, com os responsáveis agregados. Buscar os responsáveis
    // tarefa a tarefa daria N+1 idas ao banco numa tela que lista dezenas.
    const linhas = await tx`
      select t.id, t.client_id, t.title, t.description, t.due_on,
             t.completed_at, t.archived_at, t.created_at,
             t.completed_by,
             ideworks.display_name(t.completed_by) as completed_by_name,
             coalesce(
               (select json_agg(json_build_object(
                          'id', a.user_id,
                          'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                        order by ideworks.display_name(a.user_id))
                  from ideworks.task_assignees a
                 where a.task_id = t.id),
               '[]'::json
             ) as assignees
        from ideworks.tasks t
       where t.client_id = ${clientId}
         and (${incluirArquivadas} or t.archived_at is null)
         -- F31: tarefa em lista de espaço de empresa omitida não aparece no
         -- Checklist do cliente (a regra de tarefa de omitidas.ts).
         ${tarefaForaDasOmitidas(tx, actor)}
       order by t.created_at desc`;

    return linhas.map((r) => ({
      id: r.id as string,
      clientId: r.client_id as string,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      dueOn: comoDia(r.due_on),
      completedAt: comoInstante(r.completed_at),
      completedBy:
        r.completed_by === null
          ? null
          : {
              id: r.completed_by as string,
              name: (r.completed_by_name as string | null) ?? '(sem nome)',
            },
      archivedAt: comoInstante(r.archived_at),
      assignees: (r.assignees as TaskAssignee[]) ?? [],
      createdAt: comoInstante(r.created_at) as string,
    }));
  });
}

/**
 * Quem pode receber uma tarefa.
 *
 * Só contas ativas do IDE Works. Atribuir a quem não entra no sistema é
 * atribuir a ninguém — e a função do banco descarta esses ids de qualquer
 * forma; oferecê-los na tela só produziria a atribuição que some ao salvar.
 *
 * Lê pelo diretório, e não por `profiles`: a política daquela tabela mostra
 * apenas o próprio perfil, e uma consulta direta traria o seletor com uma
 * pessoa só — quem está olhando.
 */
export async function readTeam(sql: Sql, actor: AuthenticatedActor): Promise<TaskAssignee[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`select id, name from ideworks.team_directory()`;
    return linhas.map((r) => ({ id: r.id as string, name: r.name as string }));
  });
}

/* ─────────────────────────── escrita ─────────────────────────── */

export type EntradaDeTarefa = {
  title: string;
  description: string | null;
  dueOn: string | null;
  assigneeIds: string[];
};

/** Valida o que a tela deveria ter validado — nunca se confia em quem chama. */
function conferir(e: EntradaDeTarefa) {
  if (e.title.trim() === '') throw new TaskRefused('A demanda precisa de um título.', 400);
  if (e.dueOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(e.dueOn)) {
    throw new TaskRefused('Prazo inválido.', 400);
  }
}

export async function createTask(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  entrada: EntradaDeTarefa,
): Promise<string> {
  conferir(entrada);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // A tarefa e os responsáveis saem no mesmo bloco. Regra 9: criar a tarefa
      // e depois atribuir, em duas chamadas, deixaria tarefa órfã de dono se a
      // segunda falhasse — e ninguém percebe uma atribuição que não aconteceu.
      const [criada] = await tx`
        insert into ideworks.tasks (client_id, title, description, due_on, created_by)
        values (${clientId}, ${entrada.title.trim()},
                ${entrada.description}, ${entrada.dueOn}, ${actor.userId})
        returning id`;

      if (!criada) throw new TaskRefused('Cliente não encontrado, ou fora do seu alcance.', 403);

      const id = criada.id as string;
      await tx`select ideworks.set_task_assignees(${id}, ${arrayOuNulo(entrada.assigneeIds)}::uuid[])`;
      return id;
    } catch (erro) {
      if (erro instanceof TaskRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function updateTask(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  entrada: EntradaDeTarefa,
): Promise<void> {
  conferir(entrada);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const alteradas = await tx`
        update ideworks.tasks
           set title = ${entrada.title.trim()},
               description = ${entrada.description},
               due_on = ${entrada.dueOn},
               updated_at = now()
         where id = ${taskId}
         returning id`;

      if (alteradas.length === 0) {
        throw new TaskRefused('Demanda não encontrada, ou fora do seu alcance.', 404);
      }
      await tx`select ideworks.set_task_assignees(${taskId}, ${arrayOuNulo(entrada.assigneeIds)}::uuid[])`;
    } catch (erro) {
      if (erro instanceof TaskRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function setTaskCompleted(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  concluida: boolean,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await (concluida
        ? tx`select ideworks.complete_task(${taskId}, ${actor.userId})`
        : tx`select ideworks.uncomplete_task(${taskId})`);
    } catch (erro) {
      traduzir(erro);
    }
  });
}

export async function setTaskArchived(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  arquivada: boolean,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.set_task_archived(${taskId}, ${arquivada})`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}

export async function deleteTask(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const apagadas = await tx`delete from ideworks.tasks where id = ${taskId} returning id`;
    if (apagadas.length === 0) {
      throw new TaskRefused('Demanda não encontrada, ou fora do seu alcance.', 404);
    }
  });
}
