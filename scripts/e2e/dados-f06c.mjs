/**
 * OS DADOS DA F06C — colunas vazias e estados vazios de trabalho.
 *
 * Não é suíte (não está em `rodar.mjs`): é o servidor fictício que
 * `espacos-e-arrasto.mjs` e `paginacao.mjs` usam, e que o script de capturas
 * da fase também lê. A lista tem a FORMA do caso da revisão de 28/09 (R04):
 * dez tarefas, três abertas, e as duas primeiras etapas vazias. Nomes e
 * títulos são inventados.
 */

import { detail } from './comum.mjs';

export const F6C = {
  lista: '00000000-0000-0000-0000-0000000f06c1',
  pasta: 'f06cp',
};

const COR = ['#87909e', '#5f55ee', '#f8ae00', '#e16b16', '#1090e0', '#8d6fd1', '#008844'];
export const F6C_ETAPAS = ['A fazer', 'Em produção', 'Em aprovação', 'Ajustes', 'Enviado ao cliente', 'Agendado', 'Publicado'].map(
  (name, i) => ({ id: `f6c${i}`, name, type: i === 0 ? 'open' : i === 6 ? 'closed' : 'custom', color: COR[i], sortOrder: i }),
);

const cartao = (id, title, statusId, extra = {}) => ({
  id, title, statusId, priority: null, dueOn: null, startOn: null, completedAt: null,
  hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [],
  tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
  checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0, ...extra,
});

/** 10 tarefas: 1 em aprovação, 2 enviadas, 7 publicadas. As etapas 0, 1, 3 e 5 ficam vazias. */
export const F6C_CARTOES = [
  cartao('f6c-apr', 'Carrossel de lançamento para aprovação', 'f6c2', { priority: 'high' }),
  cartao('f6c-env1', 'Vídeo institucional versão final', 'f6c4'),
  cartao('f6c-env2', 'Roteiro da série de bastidores', 'f6c4'),
  ...Array.from({ length: 7 }, (_, i) => cartao(`f6c-pub${i}`, `Post publicado ${i + 1}`, 'f6c6', { completedAt: '2026-09-20T12:00:00Z' })),
];

/** O quadro da lista; `cartoes` muda quando o cenário move algo. */
export function f6cQuadro(url, cartoes = F6C_CARTOES) {
  const busca = (url?.searchParams.get('busca') ?? '').toLowerCase();
  const achadas = busca ? cartoes.filter((t) => t.title.toLowerCase().includes(busca)) : cartoes;
  const conta = (lista) => Object.fromEntries(F6C_ETAPAS.map((s) => [s.id, lista.filter((t) => t.statusId === s.id).length]));
  return {
    header: {
      listId: F6C.lista, listName: 'Conteúdo mensal', listContent: null, folderId: F6C.pasta, folderName: 'Clientes F06C',
      spaceId: 'f6ce', spaceName: 'Produção', categoryName: 'Ide', statusSetName: 'Fluxo de aprovação', inheritedFrom: 'list',
    },
    statuses: F6C_ETAPAS, tasks: achadas, availableTags: [], columnTotals: conta(cartoes), columnMatched: conta(achadas), perColumn: 50,
    assigneeOptions: [], unassignedTasks: cartoes.length, filter: { texto: busca, responsavel: null },
  };
}

/** A pasta: as mesmas etapas, uma lista só. */
export function f6cPasta(cartoes = F6C_CARTOES) {
  const chave = (s) => s.name.toLowerCase();
  const conta = Object.fromEntries(F6C_ETAPAS.map((s) => [chave(s), cartoes.filter((t) => t.statusId === s.id).length]));
  return {
    header: { folderId: F6C.pasta, folderName: 'Clientes F06C', folderArchivedAt: null, spaceId: 'f6ce', spaceName: 'Produção', categoryName: 'Ide', lists: 1 },
    etapas: F6C_ETAPAS.map((s) => ({ key: chave(s), name: s.name, type: s.type, color: s.color, lists: 1, ordem: s.sortOrder, statusByList: { [F6C.lista]: s.id } })),
    lists: [{ id: F6C.lista, name: 'Conteúdo mensal', tasks: cartoes.length }],
    tasks: cartoes.map((t) => ({ ...t, listId: F6C.lista, listName: 'Conteúdo mensal', columnKey: chave(F6C_ETAPAS.find((s) => s.id === t.statusId)) })),
    columnTotals: conta, columnMatched: conta,
    perColumn: 50, assigneeOptions: [], unassignedTasks: 0, availableTags: [], filter: { texto: '', responsavel: null },
  };
}

const linhaDaArvore = {
  spaceId: 'f6ce', spaceName: 'Produção', spaceColor: null, spaceArchivedAt: null, categoryId: 'c1', categoryName: 'Ide',
  folderId: F6C.pasta, folderName: 'Clientes F06C', folderArchivedAt: null, listContent: null, listArchivedAt: null, listIsLive: true,
  liveTasks: 10, totalTasks: 10, clientId: null, clientName: null, workflowName: 'Fluxo de aprovação', inheritedFrom: 'list',
  listId: F6C.lista, listName: 'Conteúdo mensal',
};
export const F6C_ARVORE = { ok: true, companies: [{ id: 'c1', name: 'Ide' }], spaces: [linhaDaArvore] };

/**
 * O servidor fictício. `estado.cartoes` é a verdade: um `move` troca o status
 * nela, e a releitura que o quadro faz depois de mover devolve o novo estado.
 * `estado.movimentos` guarda cada pedido de mudança de etapa.
 */
export const novoEstado = () => ({ cartoes: F6C_CARTOES.map((c) => ({ ...c })), movimentos: [], criadas: [] });

export function f6cServidor(estado = novoEstado()) {
  return (url, req) => {
    const p = url.pathname;
    if (p === '/api/board/tree/full') return { body: F6C_ARVORE };
    if (p === `/api/board/lists/${F6C.lista}/tasks` && req.method() === 'POST') {
      const b = req.postDataJSON();
      const id = `f6c-nova-${estado.cartoes.length}`;
      estado.cartoes.push(cartao(id, b.title, b.statusId));
      (estado.criadas ??= []).push({ title: b.title, statusId: b.statusId });
      return { body: { ok: true, id, task: {} } };
    }
    if (p === `/api/board/lists/${F6C.lista}`) return { body: { ok: true, board: f6cQuadro(url, estado.cartoes) } };
    if (p.startsWith(`/api/board/folders/${F6C.pasta}`)) return { body: { ok: true, board: f6cPasta(estado.cartoes) } };
    if (p.endsWith('/move') && req.method() === 'POST') {
      const b = req.postDataJSON();
      const id = p.split('/').slice(-2)[0];
      const c = estado.cartoes.find((t) => t.id === id);
      const antes = c?.statusId ?? null;
      if (c) c.statusId = b.statusId;
      estado.movimentos.push({ id, statusId: b.statusId });
      return { body: { ok: true, move: { taskId: id, listId: F6C.lista, statusId: b.statusId, previousStatusId: antes, statusRepositioned: false, subtasksMoved: 0, automation: null } } };
    }
    if (p.startsWith('/api/board/tasks/') && req.method() === 'GET') {
      const id = p.split('/').pop();
      const c = estado.cartoes.find((t) => t.id === id);
      return { body: { ok: true, task: { ...detail, id, title: c?.title ?? id }, storage: { ready: false, variable: '' } } };
    }
    return null;
  };
}

/** `Minhas tarefas` sem nada nas três abas. */
export const minhasVazia = (url) => {
  if (url.pathname !== '/api/board/my-tasks') return null;
  const aba = url.searchParams.get('aba') ?? 'pendente';
  return { body: { ok: true, work: { rows: [], total: 0, capped: false, aba, counts: { pendente: 0, feito: 0, delegado: 0 }, returned: 0, hasMore: false, nextCursor: null } } };
};
