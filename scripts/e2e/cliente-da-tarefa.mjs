/**
 * O CLIENTE DA TAREFA NO QUADRO — F38, Fase 7, no Chrome real (API simulada).
 *
 * As listas aqui são DE TESTE e só existem neste servidor fictício: a
 * "Atendimento e2e" começa interna e é o próprio cenário que liga a marca
 * "exige cliente" pelo menu da árvore — é isso que prova a tela de admin.
 * Nenhuma lista real é tocada (a API é interceptada; nada chega ao banco).
 *
 *   CT1  admin liga a marca na árvore (PATCH `requiresClient: true`), o item
 *        volta marcado; quem não administra não vê o item;
 *   CT2  modal de tarefa nova na lista marcada: Criar sem cliente mostra o
 *        erro no formulário e NÃO vai ao servidor; com cliente, cria e a
 *        ficha mostra o nome e "escolhido na tarefa";
 *   CT3  `+ Adicionar tarefa` na lista marcada: Enter sem cliente avisa na
 *        caixa e guarda o título; com o cliente escolhido, cria e o cartão
 *        da coluna mostra o nome;
 *   CT4  trocar o cliente no cartão da tarefa: grava (PUT) e a ficha mostra
 *        o novo nome; em lista compartilhada não há "Interna, sem cliente";
 *   CT5  lista de cliente: o cliente "da lista" não tem seletor; a tarefa
 *        movida com o cliente antigo mostra a diferença e volta ao da lista.
 *
 * ⚠️ O HISTÓRICO DA TROCA não é provado aqui: `task_events` não tem coluna de
 * cliente e a migration que a cria não foi aplicada (ver o relatório da Fase 7).
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, detail, sessaoDe } from './comum.mjs';

const ESPACO = '00000000-0000-0000-0000-0000000c7e01';
const PASTA = '00000000-0000-0000-0000-0000000c7e02';
const LISTA = '00000000-0000-0000-0000-0000000c7e03';
const LISTA_DO_CLIENTE = '00000000-0000-0000-0000-0000000c7e04';
const FER = '00000000-0000-0000-0000-0000000c7f01';
const CHARME = '00000000-0000-0000-0000-0000000c7f02';
const NOMES = { [FER]: 'Fonseca (teste)', [CHARME]: 'Charme (teste)' };
const FRASE_DO_SERVIDOR =
  'Esta lista é compartilhada: toda tarefa dela precisa de um cliente. Escolha o cliente ao criar, ou crie a tarefa na lista do cliente.';

const ETAPAS = [
  { id: 'ct-aberta', name: 'a fazer', type: 'open', color: null, sortOrder: 0 },
  { id: 'ct-feita', name: 'feito', type: 'closed', color: null, sortOrder: 1 },
];

const linha = (listId, listName, extra = {}) => ({
  spaceId: ESPACO, spaceName: 'AGÊNCIA IDE (teste)', spaceColor: null, spaceArchivedAt: null, categoryId: 'c1', categoryName: 'Ide',
  folderId: PASTA, folderName: 'ATENDIMENTO (teste)', folderArchivedAt: null, listContent: null, listArchivedAt: null, listIsLive: true,
  liveTasks: 0, totalTasks: 0, clientId: null, clientName: null, requiresClient: false, workflowName: 'Esteira', inheritedFrom: 'list',
  listId, listName, ...extra,
});

/** O servidor fictício. `estado` é a verdade: a marca, as tarefas e os pedidos. */
function servidor({ marcada = false, tarefas = [] } = {}) {
  const estado = { marcada, tarefas: tarefas.map((t) => ({ ...t })), patches: [], criadas: [], trocas: [], opcoesPedidas: 0 };

  const nomeDaLista = (id) => (id === LISTA ? 'Atendimento e2e' : 'Fonseca (teste) — lista');
  const clienteDaLista = (id) => (id === LISTA_DO_CLIENTE ? FER : null);
  const efetivo = (t) => t.own ?? clienteDaLista(t.listId);

  const cartao = (t) => ({
    id: t.id, title: t.title, statusId: t.statusId ?? 'ct-aberta', priority: null, dueOn: null, startOn: null, completedAt: null,
    hasDescription: false, hasAttachment: false, clientId: efetivo(t), clientName: NOMES[efetivo(t)] ?? null, assignees: [],
    tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
    checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0,
  });

  const quadro = (listId) => {
    const daLista = estado.tarefas.filter((t) => t.listId === listId);
    const conta = Object.fromEntries(ETAPAS.map((s) => [s.id, daLista.filter((t) => (t.statusId ?? 'ct-aberta') === s.id).length]));
    return {
      header: {
        listId, listName: nomeDaLista(listId), listContent: null, folderId: PASTA, folderName: 'ATENDIMENTO (teste)',
        spaceId: ESPACO, spaceName: 'AGÊNCIA IDE (teste)', categoryName: 'Ide', statusSetName: 'Esteira', inheritedFrom: 'list',
        clientId: clienteDaLista(listId), clientName: NOMES[clienteDaLista(listId)] ?? null,
        requiresClient: listId === LISTA && estado.marcada,
      },
      statuses: ETAPAS, tasks: daLista.map(cartao), availableTags: [], columnTotals: conta, columnMatched: conta,
      perColumn: 50, assigneeOptions: [], unassignedTasks: daLista.length, filter: { texto: '', responsavel: null },
    };
  };

  const ficha = (t) => ({
    ...detail,
    id: t.id, title: t.title, listId: t.listId, listName: nomeDaLista(t.listId),
    folderId: PASTA, folderName: 'ATENDIMENTO (teste)', spaceId: ESPACO, spaceName: 'AGÊNCIA IDE (teste)',
    clientId: efetivo(t), clientName: NOMES[efetivo(t)] ?? null,
    ownClientId: t.own ?? null, listClientId: clienteDaLista(t.listId), listClientName: NOMES[clienteDaLista(t.listId)] ?? null,
    listRequiresClient: t.listId === LISTA && estado.marcada,
    parentId: null, parentTitle: null, subtasks: [], history: t.history ?? [],
  });

  const custom = (url, req) => {
    const p = url.pathname;
    const metodo = req.method();
    if (p === '/api/board/tree/full')
      return {
        body: {
          ok: true, companies: [{ id: 'c1', name: 'Ide' }],
          spaces: [
            linha(LISTA, 'Atendimento e2e', { requiresClient: estado.marcada }),
            linha(LISTA_DO_CLIENTE, 'Fonseca (teste) — lista', { clientId: FER, clientName: NOMES[FER] }),
          ],
        },
      };
    if (p === `/api/board/lists/${LISTA}` && metodo === 'PATCH') {
      const b = req.postDataJSON();
      estado.patches.push(b);
      if (typeof b.requiresClient === 'boolean') estado.marcada = b.requiresClient;
      return { body: { ok: true, list: { id: LISTA, name: 'Atendimento e2e' } } };
    }
    const opcoes = /^\/api\/board\/lists\/([^/]+)\/client-options$/.exec(p);
    if (opcoes) {
      estado.opcoesPedidas += 1;
      return { body: { ok: true, clients: [{ id: CHARME, name: NOMES[CHARME] }, { id: FER, name: NOMES[FER] }] } };
    }
    const criar = /^\/api\/board\/lists\/([^/]+)\/tasks$/.exec(p);
    if (criar && metodo === 'POST') {
      const b = req.postDataJSON();
      estado.criadas.push(b);
      if (criar[1] === LISTA && estado.marcada && !b.clientId) return { status: 400, body: { message: FRASE_DO_SERVIDOR } };
      const t = { id: `ct-nova-${estado.tarefas.length + 1}`, title: b.title, listId: criar[1], own: b.clientId ?? clienteDaLista(criar[1]), statusId: b.statusId };
      estado.tarefas.push(t);
      return { status: 201, body: { ok: true, id: t.id, task: ficha(t) } };
    }
    const lista = /^\/api\/board\/lists\/([^/]+)$/.exec(p);
    if (lista && metodo === 'GET') return { body: { ok: true, board: quadro(lista[1]) } };
    const troca = /^\/api\/board\/tasks\/([^/]+)\/client$/.exec(p);
    if (troca && metodo === 'PUT') {
      const b = req.postDataJSON();
      estado.trocas.push({ id: troca[1], clientId: b.clientId });
      const t = estado.tarefas.find((x) => x.id === troca[1]);
      const antes = efetivo(t);
      t.own = b.clientId ?? clienteDaLista(t.listId);
      // O servidor de verdade grava um evento só quando o cliente muda de fato.
      if (efetivo(t) !== antes) {
        t.history = [
          ...(t.history ?? []),
          {
            id: String((t.history?.length ?? 0) + 1), automationName: null, actorName: 'Wesley',
            fromListName: null, toListName: null, fromStatusName: null, toStatusName: null,
            fromClientName: NOMES[antes] ?? null, toClientName: NOMES[efetivo(t)] ?? null,
            removed: [], added: [], occurredAt: new Date().toISOString(), viaName: null,
          },
        ];
      }
      return { body: { ok: true, task: ficha(t) } };
    }
    const umaFicha = /^\/api\/board\/tasks\/([^/]+)$/.exec(p);
    if (umaFicha && metodo === 'GET') {
      const t = estado.tarefas.find((x) => x.id === umaFicha[1]);
      if (t) return { body: { ok: true, task: ficha(t), storage: { ready: false, variable: '' } } };
    }
    return null;
  };

  return { estado, custom };
}

const abrirMenuDaLista = async (page, nome) => {
  // O `···` só aparece com o ponteiro na linha: espera existir, passa por
  // cima da linha e então clica.
  const botao = page.getByRole('button', { name: `Ações de ${nome}`, exact: true });
  await botao.waitFor({ state: 'attached' });
  await page.locator('.cu-no').filter({ has: botao }).hover();
  await botao.click();
};

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('CT1', 'admin liga "exige cliente" na árvore; o item volta marcado; quem não administra não o vê', async (abrir) => {
    const s = servidor();
    const { page, erros } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/quadro/${LISTA}`);
    await abrirMenuDaLista(page, 'Atendimento e2e');
    const item = page.getByRole('menuitemcheckbox', { name: 'Exige cliente em toda tarefa' });
    await item.waitFor();
    assert.equal(await item.getAttribute('aria-checked'), 'false', 'nasce interna');
    await item.click();
    for (let i = 0; i < 50 && s.estado.patches.length === 0; i += 1) await page.waitForTimeout(100);
    assert.deepEqual(s.estado.patches, [{ requiresClient: true }], 'a escrita é a marca, e só ela');

    // Relida a árvore, o item volta marcado.
    await abrirMenuDaLista(page, 'Atendimento e2e');
    await page.waitForFunction(
      () => [...document.querySelectorAll('[role="menuitemcheckbox"]')].some((b) => b.textContent.includes('Exige cliente') && b.getAttribute('aria-checked') === 'true'),
      null,
      { timeout: 5000 },
    );
    await page.keyboard.press('Escape');

    // A lista DE CLIENTE não oferece a marca.
    await abrirMenuDaLista(page, 'Fonseca (teste) — lista');
    await page.getByRole('menuitemcheckbox', { name: /Ficha de/ }).waitFor();
    assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Exige cliente em toda tarefa' }).count(), 0, 'lista de cliente não tem a marca');

    // Quem não administra não vê o item.
    const s2 = servidor();
    const { page: outra } = await abrir({
      custom: (url, req) =>
        url.pathname === '/api/auth/me'
          ? { body: { ...sessaoDe('u-bia'), isSuperadmin: false, isSuper: false, papel: 'funcionario', areas: ['quadro'] } }
          : s2.custom(url, req),
    });
    await outra.goto(`${BASE}/quadro/${LISTA}`);
    await abrirMenuDaLista(outra, 'Atendimento e2e');
    await outra.getByRole('menuitemcheckbox', { name: 'Quem alcança…' }).waitFor();
    assert.equal(await outra.getByRole('menuitemcheckbox', { name: 'Exige cliente em toda tarefa' }).count(), 0, 'funcionário não vê a marca');
    assert.deepEqual(erros.filter((e) => !e.includes('favicon')), [], 'sem erro de console');
    return 'PATCH {requiresClient:true}; item marcado; ausente na lista de cliente e para funcionário';
  });

  await cenario('CT2', 'lista marcada pela árvore, SEM recarregar: o modal sem cliente mostra o erro e não envia; com cliente cria e a ficha mostra o nome', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/quadro/${LISTA}`);
    // A marca é ligada AQUI, pela tela de admin, com o quadro aberto: o
    // formulário passa a pedir o cliente sem recarregar a página.
    await abrirMenuDaLista(page, 'Atendimento e2e');
    await page.getByRole('menuitemcheckbox', { name: 'Exige cliente em toda tarefa' }).click();
    for (let i = 0; i < 50 && !s.estado.marcada; i += 1) await page.waitForTimeout(100);
    assert.equal(s.estado.marcada, true, 'a lista de teste ficou marcada');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '+ Nova tarefa' }).click();
    const modal = page.getByRole('dialog', { name: 'Nova tarefa' });
    await modal.waitFor();
    const chip = modal.locator('button[data-cliente-da-criacao="compartilhada"]');
    assert.match(await chip.textContent(), /Cliente \(obrigatório\)/);

    await modal.getByRole('textbox', { name: 'Nome da tarefa' }).click();
    await page.keyboard.type('Arte do feriado');
    await modal.getByRole('button', { name: 'Criar Tarefa' }).click();
    await modal.getByText('Esta lista é compartilhada: escolha o cliente da tarefa antes de criar.').waitFor();
    assert.equal(await chip.getAttribute('data-erro'), 'true', 'o chip fica em erro');
    assert.equal(s.estado.criadas.length, 0, 'sem cliente, nada foi ao servidor');

    await chip.click();
    await page.getByRole('menuitemcheckbox', { name: NOMES[FER] }).click();
    assert.match(await chip.textContent(), /Fonseca \(teste\)/);
    assert.equal(await modal.getByText('Esta lista é compartilhada: escolha o cliente').count(), 0, 'o erro sai ao escolher');
    await modal.getByRole('button', { name: 'Criar Tarefa' }).click();
    await page.waitForURL(/\/tarefa\/ct-nova-1$/);
    assert.equal(s.estado.criadas.length, 1);
    assert.equal(s.estado.criadas[0].clientId, FER, 'o cliente vai no pedido');
    assert.equal(s.estado.criadas[0].title, 'Arte do feriado');

    const prop = page.locator('[data-prop="cliente"]');
    await prop.getByText(NOMES[FER], { exact: true }).waitFor();
    await prop.getByText('escolhido na tarefa').waitFor();
    return `criada com clientId=${FER.slice(-4)}`;
  });

  await cenario('CT3', '+ Adicionar tarefa na lista marcada: Enter sem cliente avisa e guarda o título; com cliente cria e o cartão mostra o nome', async (abrir) => {
    const s = servidor({ marcada: true });
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/quadro/${LISTA}`);
    const coluna = page.locator('.q-coluna').first();
    await coluna.getByRole('button', { name: '+ Adicionar tarefa' }).click();
    const caixa = coluna.getByRole('textbox', { name: 'Título da tarefa nova' });
    await caixa.click();
    await page.keyboard.type('Story da promoção');
    await page.keyboard.press('Enter');
    await coluna.getByRole('alert').getByText('Esta lista é compartilhada: escolha o cliente da tarefa antes de criar.').waitFor();
    assert.equal(s.estado.criadas.length, 0, 'sem cliente, nada foi ao servidor');
    assert.equal((await caixa.textContent()).trim(), 'Story da promoção', 'o título fica');

    await coluna.locator('[data-cliente-rapido] button').click();
    await page.getByRole('menuitemcheckbox', { name: NOMES[CHARME] }).click();
    await coluna.getByRole('button', { name: 'Criar', exact: true }).click();
    await page.locator('.q-cartao', { hasText: 'Story da promoção' }).locator('.q-cartao-cliente', { hasText: NOMES[CHARME] }).waitFor();
    assert.equal(s.estado.criadas.length, 1);
    assert.equal(s.estado.criadas[0].clientId, CHARME);
    assert.equal(s.estado.criadas[0].statusId, 'ct-aberta', 'nasce na coluna clicada');

    // O cliente FICA para a próxima — quem despeja uma reunião despeja várias.
    await caixa.click();
    await page.keyboard.type('Carrossel da promoção');
    await page.keyboard.press('Enter');
    await page.locator('.q-cartao', { hasText: 'Carrossel da promoção' }).waitFor();
    assert.equal(s.estado.criadas[1].clientId, CHARME, 'o segundo leva o mesmo cliente');
    return 'duas criadas com o cliente escolhido; a primeira tentativa sem cliente ficou na tela';
  });

  await cenario('CT4', 'trocar o cliente no cartão: grava (PUT), a ficha mostra o novo e o histórico diz a troca; sem "Interna, sem cliente" na compartilhada', async (abrir) => {
    const s = servidor({ marcada: true, tarefas: [{ id: 'ct-t1', title: 'Post do mês', listId: LISTA, own: FER }] });
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/tarefa/ct-t1`);
    const prop = page.locator('[data-prop="cliente"]');
    const chip = prop.getByRole('button', { name: `Cliente: ${NOMES[FER]}. Trocar o cliente` });
    await chip.click();
    await page.getByRole('menuitemcheckbox', { name: NOMES[CHARME] }).waitFor();
    assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Interna, sem cliente' }).count(), 0, 'compartilhada não oferece sem cliente');
    await page.getByRole('menuitemcheckbox', { name: NOMES[CHARME] }).click();
    await prop.getByRole('button', { name: `Cliente: ${NOMES[CHARME]}. Trocar o cliente` }).waitFor();
    await page.getByText('Cliente trocado.').waitFor();
    assert.deepEqual(s.estado.trocas, [{ id: 'ct-t1', clientId: CHARME }]);
    // A troca entra no histórico da ficha, na linha do tempo da conversa.
    await page.getByText(`trocou o cliente de ${NOMES[FER]} para ${NOMES[CHARME]}`).waitFor();
    assert.equal(s.estado.opcoesPedidas, 1, 'a lista de clientes é lida uma vez, ao abrir');
    return 'PUT /board/tasks/ct-t1/client {clientId: Charme}; histórico: trocou o cliente de Fonseca para Charme';
  });

  await cenario('CT5', 'lista de cliente: "da lista" sem seletor; a tarefa movida mostra a diferença e volta ao da lista', async (abrir) => {
    const s = servidor({
      tarefas: [
        { id: 'ct-h', title: 'Herdada', listId: LISTA_DO_CLIENTE, own: FER },
        { id: 'ct-m', title: 'Movida', listId: LISTA_DO_CLIENTE, own: CHARME },
      ],
    });
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/tarefa/ct-h`);
    const prop = page.locator('[data-prop="cliente"]');
    await prop.getByText('da lista', { exact: true }).waitFor();
    assert.equal(await prop.getByRole('button').count(), 0, 'herdado não tem seletor');

    await page.goto(`${BASE}/tarefa/ct-m`);
    await prop.getByText(`diferente do da lista (lista: ${NOMES[FER]})`).waitFor();
    await prop.getByRole('button', { name: /Trocar o cliente/ }).click();
    await page.getByRole('menuitemcheckbox', { name: `Usar o da lista (${NOMES[FER]})` }).click();
    await prop.getByText('da lista', { exact: true }).waitFor();
    assert.deepEqual(s.estado.trocas, [{ id: 'ct-m', clientId: null }]);
    return 'herdada sem seletor; movida voltou ao da lista com {clientId:null}';
  });

  return resultados;
}
