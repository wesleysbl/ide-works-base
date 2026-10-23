/**
 * O TIPO DO CARD NO QUADRO — F40, Fase 4, no Chrome real (API simulada).
 *
 * As listas aqui são DE TESTE, só existem neste servidor fictício. A "Cliente
 * e2e (produção)" responde `isProduction: true`; a "Interna e2e" responde
 * `false`. Quem recusa sem tipo é o servidor fictício, com a mesma resposta do
 * real (400, `code: type_required`). Nada chega ao banco.
 *
 *   TT1  `+ Adicionar tarefa` em lista de produção: Enter sem tipo não vai ao
 *        servidor e mostra a frase; com "Vídeo", cria e o selo aparece no card;
 *   TT2  modal: botão de criar desabilitado com a frase até escolher; com
 *        "Vídeo" cria (pedido leva `type: 'video'`) e a ficha mostra o tipo;
 *   TT3  ficha de card antigo sem tipo: diz "Sem tipo", escolher grava
 *        (PATCH `{type}`);
 *   TT4  lista interna: seletor opcional, sem a frase, cria sem tipo;
 *   TT5  recusa `type_required` do servidor (tela de antes da marca) vira a
 *        MESMA frase, não o texto cru.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, detail } from './comum.mjs';

const ESPACO = '00000000-0000-0000-0000-0000000d4e01';
const PASTA = '00000000-0000-0000-0000-0000000d4e02';
const PRODUCAO = '00000000-0000-0000-0000-0000000d4e03';
const INTERNA = '00000000-0000-0000-0000-0000000d4e04';
const FRASE = 'Escolha o tipo: Vídeo, Arte, Foto ou Outros';
const CRU = 'trigger tasks_demand_type_guard: IW040';

const ETAPAS = [
  { id: 'tt-atribuir', name: 'atribuir demanda', type: 'open', color: null, sortOrder: 0 },
  { id: 'tt-feita', name: 'feito', type: 'closed', color: null, sortOrder: 1 },
];

const linha = (listId, listName) => ({
  spaceId: ESPACO, spaceName: 'AGÊNCIA IDE (teste)', spaceColor: null, spaceArchivedAt: null, categoryId: 'c1', categoryName: 'Ide',
  folderId: PASTA, folderName: 'PASTA (teste)', folderArchivedAt: null, listContent: null, listArchivedAt: null, listIsLive: true,
  liveTasks: 0, totalTasks: 0, clientId: null, clientName: null, requiresClient: false, workflowName: 'Esteira', inheritedFrom: 'list',
  listId, listName,
});

/** `marcaDeProducao`: o que o quadro diz (a tela de antes da marca não diz nada). */
function servidor({ tarefas = [], mente = false } = {}) {
  const estado = { tarefas: tarefas.map((t) => ({ ...t })), criadas: [], patches: [] };
  const producao = (id) => id === PRODUCAO;
  const nome = (id) => (id === PRODUCAO ? 'Cliente e2e (produção)' : 'Interna e2e');

  const cartao = (t) => ({
    id: t.id, title: t.title, statusId: t.statusId ?? 'tt-atribuir', priority: null, dueOn: null, startOn: null, completedAt: null,
    hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [], tags: [], taskTypeName: null,
    type: t.type ?? null, parentId: null, parentTitle: null, subtaskCount: 0, checklistDone: 0, checklistTotal: 0,
    commentCount: 0, previewAttachmentId: null, previewCount: 0,
  });

  const quadro = (listId) => {
    const daLista = estado.tarefas.filter((t) => t.listId === listId);
    const conta = Object.fromEntries(ETAPAS.map((s) => [s.id, daLista.filter((t) => (t.statusId ?? 'tt-atribuir') === s.id).length]));
    return {
      header: {
        listId, listName: nome(listId), listContent: null, folderId: PASTA, folderName: 'PASTA (teste)', spaceId: ESPACO,
        spaceName: 'AGÊNCIA IDE (teste)', categoryName: 'Ide', statusSetName: 'Esteira', inheritedFrom: 'list',
        clientId: null, clientName: null, requiresClient: false,
        ...(mente ? {} : { isProduction: producao(listId) }),
      },
      statuses: ETAPAS, tasks: daLista.map(cartao), availableTags: [], columnTotals: conta, columnMatched: conta,
      perColumn: 50, assigneeOptions: [], unassignedTasks: daLista.length, filter: { texto: '', responsavel: null },
    };
  };

  const ficha = (t) => ({
    ...detail,
    id: t.id, title: t.title, listId: t.listId, listName: nome(t.listId), folderId: PASTA, folderName: 'PASTA (teste)',
    spaceId: ESPACO, spaceName: 'AGÊNCIA IDE (teste)', clientId: null, clientName: null, ownClientId: null, listClientId: null,
    listClientName: null, listRequiresClient: false, parentId: null, parentTitle: null, subtasks: [], history: [],
    type: t.type ?? null, listIsProduction: producao(t.listId),
  });

  const custom = (url, req) => {
    const p = url.pathname;
    const metodo = req.method();
    if (p === '/api/board/tree/full')
      return { body: { ok: true, companies: [{ id: 'c1', name: 'Ide' }], spaces: [linha(PRODUCAO, nome(PRODUCAO)), linha(INTERNA, nome(INTERNA))] } };
    const criar = /^\/api\/board\/lists\/([^/]+)\/tasks$/.exec(p);
    if (criar && metodo === 'POST') {
      const b = req.postDataJSON();
      estado.criadas.push(b);
      if (producao(criar[1]) && !b.type)
        return { status: 400, body: { message: mente ? CRU : FRASE, code: 'type_required', options: [] } };
      const t = { id: `tt-nova-${estado.tarefas.length + 1}`, title: b.title, listId: criar[1], type: b.type ?? null, statusId: b.statusId };
      estado.tarefas.push(t);
      return { status: 201, body: { ok: true, id: t.id, task: ficha(t) } };
    }
    const lista = /^\/api\/board\/lists\/([^/]+)$/.exec(p);
    if (lista && metodo === 'GET') return { body: { ok: true, board: quadro(lista[1]) } };
    const umaFicha = /^\/api\/board\/tasks\/([^/]+)$/.exec(p);
    if (umaFicha) {
      const t = estado.tarefas.find((x) => x.id === umaFicha[1]);
      if (!t) return null;
      if (metodo === 'PATCH') {
        const b = req.postDataJSON();
        estado.patches.push(b);
        if ('type' in b) t.type = b.type;
      }
      return { body: { ok: true, task: ficha(t), storage: { ready: false, variable: '' } } };
    }
    return null;
  };

  return { estado, custom };
}

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('TT1', '+ Adicionar tarefa em lista de produção: sem tipo não vai ao servidor; com "Vídeo" cria e o selo aparece no card', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/quadro/${PRODUCAO}`);
    const coluna = page.locator('.q-coluna').first();
    await coluna.getByRole('button', { name: '+ Adicionar tarefa' }).click();
    const caixa = coluna.getByRole('textbox', { name: 'Título da tarefa nova' });
    await caixa.click();
    await page.keyboard.type('Reels de outubro');
    await coluna.locator('[data-tipo-rapido]').getByText(FRASE).waitFor();
    assert.equal(await coluna.getByRole('button', { name: 'Criar', exact: true }).isDisabled(), true, 'Criar espera o tipo');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(s.estado.criadas.length, 0, 'sem tipo, nada foi ao servidor');
    assert.equal((await caixa.textContent()).trim(), 'Reels de outubro', 'o título fica');

    await coluna.locator('[data-tipo-rapido] button[data-tipo="video"]').click();
    await coluna.getByRole('button', { name: 'Criar', exact: true }).click();
    const card = page.locator('.q-cartao', { hasText: 'Reels de outubro' });
    await card.locator('[data-selo-tipo="video"]').waitFor();
    assert.equal(s.estado.criadas.length, 1);
    assert.equal(s.estado.criadas[0].type, 'video');
    return 'sem tipo: bloqueado; com Vídeo: type=video no pedido e selo "Vídeo" no card';
  });

  await cenario('TT2', 'modal em lista de produção: botão desabilitado com a frase; com "Vídeo" cria e a ficha mostra o tipo', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/quadro/${PRODUCAO}`);
    await page.getByRole('button', { name: '+ Nova tarefa' }).click();
    const modal = page.getByRole('dialog', { name: 'Nova tarefa' });
    await modal.waitFor();
    await modal.getByRole('textbox', { name: 'Nome da tarefa' }).click();
    await page.keyboard.type('Arte do feriado');
    await modal.getByText(FRASE).waitFor();
    assert.equal(await modal.getByRole('button', { name: 'Criar Tarefa' }).isDisabled(), true, 'desabilitado sem tipo');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(s.estado.criadas.length, 0, 'Enter sem tipo não cria');

    await modal.locator('[data-tipo-seletor] button[data-tipo="video"]').click();
    assert.equal(await modal.getByText(FRASE).count(), 0, 'a frase sai ao escolher');
    await modal.getByRole('button', { name: 'Criar Tarefa' }).click();
    await page.waitForURL(/\/tarefa\/tt-nova-1$/);
    assert.equal(s.estado.criadas[0].type, 'video');
    const prop = page.locator('[data-prop="tipo"]');
    await prop.locator('button[data-tipo="video"][aria-pressed="true"]').waitFor();
    assert.equal(await prop.getByRole('button', { name: 'Nenhum' }).count(), 0, 'produção não tem "Nenhum"');
    return 'Criar desabilitado sem tipo; com Vídeo cria; ficha com Vídeo marcado e sem "Nenhum"';
  });

  await cenario('TT3', 'ficha de card antigo sem tipo em produção: "Sem tipo", escolher grava o tipo', async (abrir) => {
    const s = servidor({ tarefas: [{ id: 'tt-velho', title: 'Card antigo', listId: PRODUCAO, type: null }] });
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/tarefa/tt-velho`);
    const prop = page.locator('[data-prop="tipo"]');
    await prop.getByText('Sem tipo').waitFor();
    assert.equal(await prop.locator('button[aria-pressed="true"]').count(), 0, 'nenhum marcado');
    await prop.locator('button[data-tipo="arte"]').click();
    await prop.locator('button[data-tipo="arte"][aria-pressed="true"]').waitFor();
    assert.deepEqual(s.estado.patches, [{ type: 'arte' }], 'a escrita é só o tipo');
    // Escolhido, em produção clicar de novo NÃO apaga.
    await prop.locator('button[data-tipo="arte"]').click();
    await page.waitForTimeout(300);
    assert.equal(s.estado.patches.filter((p) => p.type === null).length, 0, 'produção nunca manda type:null');
    return 'PATCH {type:"arte"}; sem apagar';
  });

  await cenario('TT4', 'lista interna: seletor opcional, sem frase, cria sem tipo', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/quadro/${INTERNA}`);
    await page.getByRole('button', { name: '+ Nova tarefa' }).click();
    const modal = page.getByRole('dialog', { name: 'Nova tarefa' });
    await modal.waitFor();
    await modal.locator('[data-tipo-seletor]').waitFor();
    assert.equal(await modal.locator('[data-tipo-seletor][data-obrigatorio]').count(), 0, 'não é obrigatório');
    await modal.getByRole('textbox', { name: 'Nome da tarefa' }).click();
    await page.keyboard.type('Pauta interna');
    assert.equal(await modal.getByText(FRASE).count(), 0, 'sem frase');
    await modal.getByRole('button', { name: 'Criar Tarefa' }).click();
    await page.waitForURL(/\/tarefa\/tt-nova-1$/);
    assert.equal(s.estado.criadas[0].type ?? null, null, 'foi sem tipo');
    return 'criada sem tipo em lista interna';
  });

  await cenario('TT5', 'o servidor recusa com type_required (tela sem a marca): a frase é a mesma, não o texto cru', async (abrir) => {
    const s = servidor({ mente: true });
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/quadro/${PRODUCAO}`);
    await page.getByRole('button', { name: '+ Nova tarefa' }).click();
    const modal = page.getByRole('dialog', { name: 'Nova tarefa' });
    await modal.waitFor();
    await modal.getByRole('textbox', { name: 'Nome da tarefa' }).click();
    await page.keyboard.type('Sem marca');
    await modal.getByRole('button', { name: 'Criar Tarefa' }).click();
    await modal.getByText(FRASE).waitFor();
    assert.equal(await modal.getByText(CRU).count(), 0, 'o texto cru não aparece');
    assert.equal(s.estado.criadas.length, 1, 'chegou ao servidor, que recusou');
    return 'erro do servidor virou a frase padrão';
  });

  return resultados;
}
