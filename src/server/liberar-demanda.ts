/**
 * LIBERAR A DEMANDA (O "OK" DO PAINEL DOS ADMINS) — F40, Fase 6.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE FAZ, NUMA TRANSAÇÃO SÓ
 *   1. trava a linha do card (`select … for update`) — dois admins ao mesmo
 *      tempo: o segundo espera, relê o estado e recebe a recusa "já liberado";
 *   2. confere: card existe e não está arquivado, está na etapa
 *      "atribuir demanda", tem tipo, e a esteira da LISTA tem a etapa de
 *      destino do tipo (D3);
 *   3. grava responsáveis e prazo — por `patchBoardTaskInTx`, a mesma escrita
 *      da ficha (que chama `set_task_assignees`);
 *   4. move para a etapa de destino, na MESMA lista, por `moveTaskOnBoardInTx`
 *      (⇒ `ideworks.move_task`): automações disparam e o histórico
 *      (`task_events`) registra "<admin> alterou o status de Atribuir Demanda
 *      para A fazer video".
 *
 * D3 — DESTINO POR TIPO
 *   video → "a fazer video" · arte → "a fazer arte" · foto e outros → "a fazer".
 *   A etapa é achada pelo NOME normalizado (sem acento, sem maiúscula, espaços
 *   colapsados), IGUALDADE EXATA: "a fazer" nunca casa com "a fazer video".
 *
 * ORIGEM "CONTROLE DA SEMANA"
 *   Não há campo de origem para movimento humano: `task_events.via_name` é a
 *   marca da IA (F26.2) e o gatilho FORÇA nulo em escrita humana. Não se criou
 *   migration para isso. O movimento fica no histórico com o admin como autor
 *   (`actor_id`), e a mensagem do evento é a de qualquer mudança de etapa.
 *
 * SÓ ADMIN (`actor.isSuperadmin`, D7) — 403 antes de qualquer consulta.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { patchBoardTaskInTx } from '@/server/board-task';
import { BoardRefused, TypeRequired, moveTaskOnBoardInTx } from '@/server/board';
import { type Sql, type Tx, withActor } from '@/server/db';
import { tarefaForaDasOmitidas } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';
import { type TipoDaTarefa, comoTipoLido } from '@/server/tipo-da-tarefa';

export const ETAPA_DE_ORIGEM = 'atribuir demanda';

/** D3. Nomes já normalizados. */
export const ETAPA_DE_DESTINO: Record<TipoDaTarefa, string> = {
  video: 'a fazer video',
  arte: 'a fazer arte',
  foto: 'a fazer',
  outros: 'a fazer',
};

export const FRASE_LIBERAR_SO_ADMIN = 'Liberar demanda é só para administradores.';
export const FRASE_SEM_PESSOA = 'Escolha pelo menos uma pessoa para a demanda.';
export const FRASE_SEM_PRAZO = 'Escolha o prazo da demanda.';

export type CodigoDaLiberacao = 'already_released' | 'stage_missing' | 'assignee_required' | 'due_required';

/** Recusa da liberação com um `code` que a tela e a IA podem ler. */
export class LiberarRecusado extends BoardRefused {
  constructor(
    message: string,
    status: 400 | 403 | 404 | 409,
    readonly code: CodigoDaLiberacao,
  ) {
    super(message, status);
    this.name = 'LiberarRecusado';
  }
}

export type LiberarInput = {
  taskId: string;
  assigneeIds: string[];
  /** AAAA-MM-DD. */
  dueOn: string;
};

export type LiberarResultado = {
  taskId: string;
  listId: string;
  statusId: string;
  statusName: string;
  previousStatusId: string | null;
  type: TipoDaTarefa;
  assigneeIds: string[];
  dueOn: string;
  automation: unknown;
};

/** Sem acento, sem maiúscula, espaços colapsados. */
export function normalizarEtapa(nome: unknown): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const AAAA_MM_DD = /^(\d{4})-(\d{2})-(\d{2})$/;
function dataValida(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = AAAA_MM_DD.exec(v);
  if (!m) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const horaDeSaoPaulo = (instante: unknown): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instante as string));

export async function liberarDemandaInTx(
  tx: Tx,
  actor: AuthenticatedActor,
  input: LiberarInput,
): Promise<LiberarResultado> {
  if (!actor.isSuperadmin) throw new BoardRefused(FRASE_LIBERAR_SO_ADMIN, 403);

  const pessoas = Array.isArray(input.assigneeIds)
    ? [...new Set(input.assigneeIds.filter((p): p is string => typeof p === 'string' && p !== ''))]
    : [];
  if (pessoas.length === 0) throw new LiberarRecusado(FRASE_SEM_PESSOA, 400, 'assignee_required');
  if (!dataValida(input.dueOn)) throw new LiberarRecusado(FRASE_SEM_PRAZO, 400, 'due_required');

  // A trava. `for update of t`: a junção com a etapa não é travada.
  const [card] = await tx`
    select t.id, t.list_id, t.status_id, t.demand_type::text as demand_type,
           s.name as status_name, l.name as list_name
      from ideworks.tasks t
      left join ideworks.statuses s on s.id = t.status_id
      left join ideworks.lists l on l.id = t.list_id
     where t.id = ${input.taskId}
       and t.archived_at is null
       ${tarefaForaDasOmitidas(tx, actor)}
       for update of t`;
  if (!card) throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 404);

  if (normalizarEtapa(card.status_name) !== ETAPA_DE_ORIGEM) {
    const [ultimo] = await tx`
      select e.occurred_at, ideworks.display_name(e.actor_id) as quem
        from ideworks.task_events e
       where e.task_id = ${input.taskId}
         and (e.to_status_id is distinct from e.from_status_id
              or e.to_list_id is distinct from e.from_list_id)
       order by e.occurred_at desc, e.id desc
       limit 1`;
    const frase = ultimo
      ? `Já liberado por ${ultimo.quem ?? 'outra pessoa'} às ${horaDeSaoPaulo(ultimo.occurred_at)}.`
      : `Este card não está mais em "Atribuir demanda" (etapa atual: ${card.status_name ?? 'sem etapa'}).`;
    throw new LiberarRecusado(frase, 409, 'already_released');
  }

  const tipo = comoTipoLido(card.demand_type);
  if (tipo === null) throw new TypeRequired();

  if (card.list_id == null) {
    throw new BoardRefused('Este card não está em lista nenhuma.', 400);
  }
  const listId = String(card.list_id);

  // A esteira EFETIVA da lista (lista → pasta → espaço), pelo banco.
  const etapas = await tx`
    select s.id, s.name
      from ideworks.statuses s
     where s.status_set_id = ideworks.resolve_status_set(${listId}::uuid)
     order by s.sort_order, s.name, s.id`;
  const nomeDoDestino = ETAPA_DE_DESTINO[tipo];
  const destino = etapas.find((e) => normalizarEtapa(e.name) === nomeDoDestino);
  if (!destino) {
    throw new LiberarRecusado(
      `A lista "${card.list_name ?? ''}" não tem a etapa "${nomeDoDestino}" na esteira. Crie a etapa antes de liberar este card.`,
      409,
      'stage_missing',
    );
  }

  await patchBoardTaskInTx(tx, input.taskId, { assigneeIds: pessoas, dueOn: input.dueOn });
  const mov = await moveTaskOnBoardInTx(tx, input.taskId, listId, String(destino.id));

  return {
    taskId: mov.taskId,
    listId: mov.listId,
    statusId: mov.statusId,
    statusName: String(destino.name),
    previousStatusId: mov.previousStatusId,
    type: tipo,
    assigneeIds: pessoas,
    dueOn: input.dueOn,
    automation: mov.automation,
  };
}

export async function liberarDemanda(
  sql: Sql,
  actor: AuthenticatedActor,
  input: LiberarInput,
): Promise<LiberarResultado> {
  // 403 antes de abrir transação.
  if (!actor.isSuperadmin) throw new BoardRefused(FRASE_LIBERAR_SO_ADMIN, 403);
  return withActor(sql, asDbActor(actor), (tx) => liberarDemandaInTx(tx, actor, input));
}
