/**
 * A ficha inteira da tarefa no `get_task` — conferência de 08/10/2026, lacuna G6.
 *
 * O `get_task` entregava a tarefa pela metade: sem etiquetas, seguidores, mãe,
 * checklists, links do Dropbox (o material da entrega e da aprovação), criador
 * e quem concluiu, pasta e espaço, e o histórico de movimentação. Tudo isso já
 * está em `readTaskDetail` (`src/board/ficha.ts`); aqui mora só a PROJEÇÃO
 * desses dados por capacidade, no mesmo molde de `projectTask`:
 *
 *   · `people:read`  → seguidores, quem criou, quem concluiu, responsável de
 *                      item de checklist e o nome de quem agiu no histórico;
 *   · `clients:read` → o nome do cliente dentro das frases do histórico;
 *   · `boards:read`  → o nome de lista e de etapa dentro das frases do histórico
 *                      (o nome de pasta e espaço é projetado pelo catálogo, como
 *                      o do quadro).
 *
 * As frases do histórico são as da ficha (`frasesDoEvento`, a mesma da linha do
 * tempo da tela): para uma capacidade faltando, o dado SAI do evento antes de a
 * frase ser montada — a frase "removeu o responsável: Murilo" nem existe sem
 * `people:read`. Evento que fica sem nenhuma frase some, e `historyTotal` conta
 * só o que a concessão enxerga.
 */

import { frasesDoEvento, foiAutomacao, quemFez, type EventoDaTarefa } from '@/board/historico';
import {
  GET_TASK_CHECKLISTS_MAX,
  GET_TASK_CHECKLIST_ITEMS_MAX,
  GET_TASK_HISTORY_MAX,
  GET_TASK_LINKS_MAX,
  type GetTaskResponse,
} from '@/integrations/contract';
import type { IntegrationCapability } from '@/integrations/grants';
import type { WorkTaskView } from '@/integrations/reads';

/** Os campos novos do `get_task`, todos opcionais. */
export type FichaDaTarefa = Pick<
  GetTaskResponse['task'],
  | 'tags'
  | 'watchers'
  | 'parentId'
  | 'parentTitle'
  | 'checklists'
  | 'checklistItemTotal'
  | 'links'
  | 'linkTotal'
  | 'history'
  | 'historyTotal'
  | 'createdBy'
  | 'completedBy'
  | 'createdVia'
  | 'createdAt'
  | 'folder'
  | 'space'
>;

/** Quanto de cada grupo grande entra. Os níveis menores existem para a ficha caber no orçamento de 64 KiB. */
export type TetosDaFicha = {
  checklists: number;
  checklistItems: number;
  links: number;
  history: number;
};

export const TETOS_CHEIOS: TetosDaFicha = {
  checklists: GET_TASK_CHECKLISTS_MAX,
  checklistItems: GET_TASK_CHECKLIST_ITEMS_MAX,
  links: GET_TASK_LINKS_MAX,
  history: GET_TASK_HISTORY_MAX,
};
export const TETOS_REDUZIDOS: TetosDaFicha = { checklists: 5, checklistItems: 20, links: 10, history: 10 };
/** Só o que é pequeno de verdade (etiquetas, seguidores, mãe, criador): os grupos grandes saem. */
export const TETOS_MINIMOS: TetosDaFicha = { checklists: 0, checklistItems: 0, links: 0, history: 0 };

/**
 * O evento como a concessão pode vê-lo: o dado cuja leitura falta SAI antes da
 * frase. Devolve `null` quando não sobra frase nenhuma.
 */
type EventoDoHistorico = NonNullable<GetTaskResponse['task']['history']>[number];

export function eventoVisivel(
  evento: EventoDaTarefa,
  caps: ReadonlySet<IntegrationCapability>,
): EventoDoHistorico | null {
  const podePessoas = caps.has('people:read');
  const podeClientes = caps.has('clients:read');
  const podeQuadro = caps.has('boards:read');
  const visto: EventoDaTarefa = {
    ...evento,
    actorName: podePessoas ? evento.actorName : null,
    removed: podePessoas ? evento.removed : [],
    added: podePessoas ? evento.added : [],
    fromClientName: podeClientes ? (evento.fromClientName ?? null) : null,
    toClientName: podeClientes ? (evento.toClientName ?? null) : null,
    fromListName: podeQuadro ? evento.fromListName : null,
    toListName: podeQuadro ? evento.toListName : null,
    fromStatusName: podeQuadro ? evento.fromStatusName : null,
    toStatusName: podeQuadro ? evento.toStatusName : null,
  };
  const changes = frasesDoEvento(visto);
  if (changes.length === 0) return null;
  const regra = foiAutomacao(visto);
  return {
    id: visto.id,
    at: visto.occurredAt,
    // `quemFez` cai em "Alguém" sem ator; aqui a ausência é nulo, que é o que ela é.
    by: regra ? visto.automationName : visto.actorName === null ? null : quemFez(visto),
    automation: regra,
    via: visto.viaName ?? null,
    changes,
  };
}

/**
 * A ficha do `get_task` para esta concessão, nos tetos dados. Dado que o
 * catálogo não trouxe (dublê antigo, ficha de antes da G6) fica de fora: campo
 * ausente quer dizer "não veio", nunca "vazio".
 */
export function projetarFicha(
  task: WorkTaskView,
  caps: ReadonlySet<IntegrationCapability>,
  tetos: TetosDaFicha,
): FichaDaTarefa {
  const podePessoas = caps.has('people:read');
  const out: FichaDaTarefa = {};

  if (task.tags !== undefined) out.tags = task.tags.map((tag) => ({ ...tag }));
  if (task.watchers !== undefined) out.watchers = podePessoas ? task.watchers.map((w) => ({ ...w })) : null;
  if (task.parent !== undefined) {
    out.parentId = task.parent?.id ?? null;
    out.parentTitle = task.parent?.title ?? null;
  }

  if (task.checklists !== undefined && tetos.checklists > 0) {
    let restantes = tetos.checklistItems;
    const listas: NonNullable<FichaDaTarefa['checklists']> = [];
    for (const lista of task.checklists.slice(0, tetos.checklists)) {
      const items = lista.items.slice(0, Math.max(0, restantes)).map((item) => ({
        id: item.id,
        name: item.name,
        parentItemId: item.parentItemId,
        resolved: item.resolvedAt !== null,
        resolvedAt: item.resolvedAt,
        assignee: podePessoas && item.assignee ? { ...item.assignee } : null,
      }));
      restantes -= items.length;
      listas.push({ id: lista.id, name: lista.name, items });
    }
    out.checklists = listas;
    out.checklistItemTotal = task.checklistItemTotal ?? task.checklists.reduce((n, l) => n + l.items.length, 0);
  }

  if (task.links !== undefined && tetos.links > 0) {
    out.links = task.links.slice(0, tetos.links).map((link) => ({ ...link }));
    out.linkTotal = task.linkTotal ?? task.links.length;
  }

  if (task.history !== undefined && tetos.history > 0) {
    const visiveis = task.history
      .map((evento) => eventoVisivel(evento, caps))
      .filter((evento): evento is NonNullable<typeof evento> => evento !== null);
    out.historyTotal = visiveis.length;
    // Cortado, ficam os mais recentes (o livro vem do mais antigo ao mais novo).
    out.history = visiveis.slice(-tetos.history);
  }

  if (task.createdBy !== undefined) out.createdBy = podePessoas && task.createdBy ? { ...task.createdBy } : null;
  if (task.completedBy !== undefined) out.completedBy = podePessoas && task.completedBy ? { ...task.completedBy } : null;
  if (task.createdVia !== undefined) out.createdVia = task.createdVia;
  if (task.createdAt !== undefined) out.createdAt = task.createdAt;
  if (task.folder !== undefined) out.folder = task.folder;
  if (task.space !== undefined) out.space = task.space;
  return out;
}
