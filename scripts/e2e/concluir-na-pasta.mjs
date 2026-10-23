/**
 * O ✓ de concluir no quadro da PASTA, provado no Chrome real (API simulada).
 *
 * Defeito: na tela `/quadro/pasta/:id` o atalho ✓ do cartão não aparecia (só no
 * quadro da lista e na visão por escopo). Aqui: duas listas, cada uma com a SUA
 * etapa `closed` ("demanda concluída") e statusId próprio. O ✓ de um cartão da
 * lista B tem de mandar o status DE B; o cartão já na coluna concluída não tem ✓.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite } from './comum.mjs';
import { F6C_ARVORE } from './dados-f06c.mjs';

const PASTA = 'cp-pasta';
const L1 = '00000000-0000-0000-0000-00000000c0a1';
const L2 = '00000000-0000-0000-0000-00000000c0a2';

const cartao = (id, title, listId, listName, statusId, columnKey) => ({
  id, title, statusId, priority: null, dueOn: null, startOn: null, completedAt: null,
  hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [],
  tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
  checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0,
  listId, listName, columnKey,
});

const pasta = (tasks) => {
  const conta = (k) => tasks.filter((t) => t.columnKey === k).length;
  const totais = { 'a fazer': conta('a fazer'), 'demanda concluída': conta('demanda concluída') };
  return {
    header: { folderId: PASTA, folderName: 'TIME CP', folderArchivedAt: null, spaceId: 'cpe', spaceName: 'Produção', categoryName: 'Ide', lists: 2 },
    etapas: [
      { key: 'a fazer', name: 'A FAZER', type: 'open', color: '#87909e', lists: 2, ordem: 0, statusByList: { [L1]: 'l1-fazer', [L2]: 'l2-fazer' } },
      { key: 'demanda concluída', name: 'DEMANDA CONCLUÍDA', type: 'closed', color: '#008844', lists: 2, ordem: 1, statusByList: { [L1]: 'l1-fim', [L2]: 'l2-fim' } },
    ],
    lists: [{ id: L1, name: 'Lista Um', tasks: 2 }, { id: L2, name: 'Lista Dois', tasks: 1 }],
    tasks, columnTotals: totais, columnMatched: totais,
    perColumn: 50, assigneeOptions: [], unassignedTasks: 0, availableTags: [], filter: { texto: '', responsavel: null },
  };
};

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('PASTA-CONCLUIR', 'pasta: o ✓ aparece, conclui na lista DO cartão com o status DELA, e não há ✓ no que já está concluído', async (abrir) => {
    const tasks = [
      cartao('cp-a', 'Tarefa da lista um', L1, 'Lista Um', 'l1-fazer', 'a fazer'),
      cartao('cp-b', 'Tarefa da lista dois', L2, 'Lista Dois', 'l2-fazer', 'a fazer'),
      cartao('cp-c', 'Tarefa já concluída', L1, 'Lista Um', 'l1-fim', 'demanda concluída'),
    ];
    const moves = [];
    const { page } = await abrir({
      viewport: { width: 1440, height: 900 },
      custom: (url, req) => {
        const p = url.pathname;
        if (p === '/api/board/tree/full') return { body: F6C_ARVORE };
        if (p.startsWith(`/api/board/folders/${PASTA}`)) return { body: { ok: true, board: pasta(tasks) } };
        if (p.endsWith('/move') && req.method() === 'POST') {
          const b = req.postDataJSON();
          const id = p.split('/').slice(-2)[0];
          moves.push({ id, listId: b.listId, statusId: b.statusId });
          const t = tasks.find((x) => x.id === id);
          if (t) { t.statusId = b.statusId; t.columnKey = 'demanda concluída'; }
          return { body: { ok: true, move: { taskId: id, listId: b.listId, statusId: b.statusId, previousStatusId: null, statusRepositioned: false, subtasksMoved: 0, automation: null } } };
        }
        return null;
      },
    });
    await page.goto(`${BASE}/quadro/pasta/${PASTA}`);
    await page.locator('.q-cartao').first().waitFor();

    const cartaoDe = (txt) => page.locator('.q-cartao', { hasText: txt });
    const concluir = (txt) => cartaoDe(txt).getByRole('button', { name: /^Concluir/ });

    // O que já está concluído não oferece ✓.
    assert.equal(await concluir('Tarefa já concluída').count(), 0, 'cartão já concluído não tem ✓');

    // O da lista dois: o ✓ existe, e o pedido sai com a lista e o status DELA.
    await cartaoDe('Tarefa da lista dois').hover();
    const botao = concluir('Tarefa da lista dois');
    assert.equal(await botao.count(), 1, 'cartão aberto tem ✓');
    assert.match(await botao.getAttribute('aria-label'), /^Concluir Tarefa da lista dois/);
    await botao.click();
    await page.waitForFunction(() => document.querySelector('.q-coluna[data-etapa="demanda concluída"]')?.textContent.includes('Tarefa da lista dois'), null, { timeout: 5000 });
    assert.deepEqual(moves, [{ id: 'cp-b', listId: L2, statusId: 'l2-fim' }], 'o ✓ escreve na lista do cartão com o status dela');

    // Agora ele está concluído: o ✓ some.
    assert.equal(await concluir('Tarefa da lista dois').count(), 0, 'depois de concluir, sem ✓');

    // O da lista um sobe com o status da lista um.
    await cartaoDe('Tarefa da lista um').hover();
    await concluir('Tarefa da lista um').click();
    await page.waitForFunction(() => document.querySelector('.q-coluna[data-etapa="a fazer"]')?.querySelectorAll('.q-cartao').length === 0, null, { timeout: 5000 });
    assert.deepEqual(moves.at(-1), { id: 'cp-a', listId: L1, statusId: 'l1-fim' });
    assert.equal(moves.length, 2);
    return `movimentos ${moves.map((m) => m.statusId).join(', ')}`;
  });

  return resultados;
}
