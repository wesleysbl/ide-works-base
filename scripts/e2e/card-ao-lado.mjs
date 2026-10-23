/**
 * O CARD AO LADO DO QUADRO — F43, Fase 7, provado no Chrome real.
 *
 * O pedido: clicar num cartão do Quadro, da Pasta, do Espaço, de Minhas
 * tarefas e de Todas as tarefas abre a ficha num painel à direita, com a tela
 * de trás visível e parada onde estava; o endereço mostra `/tarefa/:id` (dá
 * para copiar); Voltar, `Esc` e o ✕ fecham e devolvem a tela como estava.
 *
 * E a regra do Wesley (08/10): "Toma cuidado para não esconder nenhum botão
 * sem querer… ou função". Por isso há um cenário que LISTA os controles da
 * ficha no painel e na página cheia, para a mesma tarefa, e compara — e outro
 * que abre cada menu da ficha dentro do painel e mede se ele cabe.
 *
 * O que continua igual também se prova aqui: o `href` é `/tarefa/:id`, o
 * Ctrl+clique abre a página cheia numa aba nova, o link colado abre a página
 * cheia, e os links de dentro da ficha (a subtarefa) levam à página cheia.
 */

import assert from 'node:assert/strict';

import { BASE, X, campoTitulo, criarSuite, detail, fecharFicha, janela, lerTitulo, painelDaFicha, pause, row } from './comum.mjs';
import { LK, novoEstadoLK, servidorLK } from './lista-kanban.mjs';

const CAPTURAS = process.env.CARD_CAPTURAS ?? '';
const capturar = async (page, nome) => {
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nome}.png` });
};

/* ───────────────────────────── os dados ───────────────────────────── */

export const LISTA = '00000000-0000-0000-0000-00000000c7a0';
const PASTA = '00000000-0000-0000-0000-00000000c7f0';
const ESPACO = '00000000-0000-0000-0000-00000000c7e0';
const ETAPAS = [
  { id: 'c7-a', name: 'A fazer', type: 'open', color: '#87909e', sortOrder: 0 },
  { id: 'c7-b', name: 'Em produção', type: 'custom', color: '#5f55ee', sortOrder: 1 },
  { id: 'c7-c', name: 'Concluído', type: 'closed', color: '#008844', sortOrder: 2 },
];
const idDe = (i) => `00000000-0000-0000-0000-0000c7${String(i).padStart(6, '0')}`;
/** A tarefa que os cenários abrem: a 25ª da coluna longa, lá embaixo. */
export const ALVO = idDe(24);
/** Uma tarefa SEM subtarefa — só ela deixa trocar o cliente (a subtarefa herda). */
export const SEM_SUB = idDe(31);

const cartao = (i, titulo, statusId) => ({
  id: idDe(i), title: titulo, statusId, priority: null, dueOn: null, startOn: null, completedAt: null,
  hasDescription: true, hasAttachment: false, clientId: null, clientName: null, assignees: [],
  tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 1,
  checklistDone: 0, checklistTotal: 0, commentCount: 1, previewAttachmentId: null, previewCount: 0,
});

/** O estado do servidor: os títulos mudam com o PATCH, e o quadro relido mostra o novo. */
export function novoEstado() {
  const titulos = new Map(Array.from({ length: 33 }, (_, i) => [idDe(i), `Peça ${String(i + 1).padStart(2, '0')} da campanha`]));
  return { titulos, leiturasDoQuadro: 0, leiturasDaPasta: 0, leiturasDeMinhas: 0, leiturasDeTodas: 0, writes: [] };
}

const etapaDe = (i) => (i < 30 ? 'c7-a' : 'c7-b');
const cartoes = (estado) => [...estado.titulos].map(([id, t], i) => cartao(i, t, etapaDe(i)));

function quadro(estado) {
  const tasks = cartoes(estado);
  const conta = Object.fromEntries(ETAPAS.map((s) => [s.id, tasks.filter((t) => t.statusId === s.id).length]));
  return {
    header: {
      listId: LISTA, listName: 'Criação e conteúdo', listContent: null, folderId: PASTA, folderName: 'Clientes',
      spaceId: ESPACO, spaceName: 'Produção', categoryName: 'Ide', statusSetName: 'Fluxo de criação', inheritedFrom: 'list',
    },
    statuses: ETAPAS, tasks, availableTags: [], columnTotals: conta, columnMatched: conta, perColumn: 50,
    assigneeOptions: [], unassignedTasks: 0, filter: { texto: '', responsavel: null },
  };
}

const chave = (s) => s.name.toLowerCase();
function pasta(estado) {
  const tasks = cartoes(estado).map((t) => ({ ...t, listId: LISTA, listName: 'Criação e conteúdo', columnKey: chave(ETAPAS.find((s) => s.id === t.statusId)) }));
  const conta = Object.fromEntries(ETAPAS.map((s) => [chave(s), tasks.filter((t) => t.statusId === s.id).length]));
  return {
    header: { folderId: PASTA, folderName: 'Clientes', folderArchivedAt: null, spaceId: ESPACO, spaceName: 'Produção', categoryName: 'Ide', lists: 1 },
    etapas: ETAPAS.map((s) => ({ key: chave(s), name: s.name, type: s.type, color: null, lists: 1, ordem: s.sortOrder, statusByList: { [LISTA]: s.id } })),
    lists: [{ id: LISTA, name: 'Criação e conteúdo', tasks: tasks.length }],
    tasks, columnTotals: conta, columnMatched: conta, perColumn: 50, assigneeOptions: [], unassignedTasks: 0, availableTags: [],
    filter: { texto: '', responsavel: null },
  };
}

const linhas = (estado) =>
  cartoes(estado).map((t) => ({
    ...row, ...t, statusName: 'A fazer', statusType: 'open', statusColor: '#87909e', dueOn: null,
    listId: LISTA, listName: 'Criação e conteúdo', folderName: 'Clientes', spaceName: 'Produção', listLive: true,
  }));

const ARVORE = {
  ok: true,
  companies: [{ id: 'c1', name: 'Ide' }],
  spaces: [{
    spaceId: ESPACO, spaceName: 'Produção', spaceColor: '#1f8a5b', spaceArchivedAt: null, categoryId: 'c1', categoryName: 'Ide',
    folderId: PASTA, folderName: 'Clientes', folderArchivedAt: null, listId: LISTA, listName: 'Criação e conteúdo', listContent: null,
    listArchivedAt: null, listIsLive: true, liveTasks: 33, totalTasks: 33, clientId: null, clientName: null,
    workflowName: 'Fluxo de criação', inheritedFrom: 'list',
  }],
};

const SUB = {
  id: 'sub-c7', title: 'Separar as fotos do ensaio', statusId: 'c7-a', statusName: 'A fazer', statusColor: '#87909e',
  statusType: 'open', priority: null, dueOn: null, completedAt: null, archivedAt: null, assignees: [], subtaskCount: 0,
};

/** A ficha CHEIA — subtarefa, checklist, link, comentário, tipo antigo — para a comparação de controles. */
const fichaCheia = (id, titulo) => ({
  ...detail,
  id, title: titulo, description: 'Carrossel de 6 telas para a campanha de primavera.',
  listId: LISTA, listName: 'Criação e conteúdo', folderId: PASTA, folderName: 'Clientes', spaceId: ESPACO, spaceName: 'Produção',
  statusId: 'c7-a', statuses: ETAPAS, statusSetName: 'Fluxo de criação',
  availableTypes: [{ id: 'tt1', customItemId: 7, name: 'Arte antiga' }], taskTypeName: 'Arte antiga',
  subtasks: id === 'sub-c7' || id === SEM_SUB ? [] : [SUB],
  parentId: id === 'sub-c7' ? ALVO : null, parentTitle: id === 'sub-c7' ? 'A mãe' : null,
  checklists: [{ id: 'k1', name: 'Checklist', sortOrder: 0, items: [] }],
  links: [{ id: 'l1', label: 'Dropbox', url: 'https://www.dropbox.com/scl/fo/a', sortOrder: 0, createdBy: null, createdAt: '2026-10-01T12:00:00.000Z' }],
  comments: [{
    id: 'c1', parentId: null, body: 'Segue a pasta com as fotos.', author: { id: 'a', name: 'Ana Designer' },
    createdAt: '2026-10-01T10:00:00.000Z', editedAt: null, replyCount: 0, mine: true, replies: [],
  }],
  progress: { ...detail.progress, subtaskCount: 1, checklistCount: 1, linkCount: 1, commentCount: 1 },
});

export const servidor = (estado) => (url, req) => {
  const p = url.pathname;
  if (p === `/api/board/lists/${LISTA}`) {
    estado.leiturasDoQuadro += 1;
    return { body: { ok: true, board: quadro(estado) } };
  }
  if (p.startsWith(`/api/board/folders/${PASTA}`)) {
    estado.leiturasDaPasta += 1;
    return { body: { ok: true, board: pasta(estado) } };
  }
  if (p === '/api/board/tree/full') return { body: ARVORE };
  if (p === `/api/board/lists/${LISTA}/client-options`)
    return { body: { ok: true, clients: [{ id: 'cli-1', name: 'Horizonte Studio' }, { id: 'cli-2', name: 'Café do Bairro' }] } };
  if (p === '/api/board/my-tasks') {
    estado.leiturasDeMinhas += 1;
    const aba = url.searchParams.get('aba') ?? 'pendente';
    const rows = aba === 'pendente' ? linhas(estado) : [];
    return { body: { ok: true, work: { rows, total: rows.length, capped: false, aba, counts: { pendente: rows.length, feito: 0, delegado: 0 }, returned: rows.length, hasMore: false, nextCursor: null } } };
  }
  if (p === '/api/board/all-tasks') {
    estado.leiturasDeTodas += 1;
    const rows = linhas(estado);
    return { body: { ok: true, work: { rows, total: rows.length, matched: rows.length, capped: false, assigneeOptions: [], unassignedTasks: 0 } } };
  }
  const tarefa = /^\/api\/board\/tasks\/([^/]+)$/.exec(p);
  if (tarefa) {
    const id = tarefa[1];
    if (req.method() === 'PATCH') {
      const corpo = req.postDataJSON() ?? {};
      estado.writes.push({ id, corpo });
      if (typeof corpo.title === 'string') estado.titulos.set(id, corpo.title);
    }
    const titulo = estado.titulos.get(id) ?? (id === 'sub-c7' ? SUB.title : 'Tarefa ' + id);
    return { body: { ok: true, task: fichaCheia(id, titulo), storage: { ready: false, variable: '' } } };
  }
  return null;
};

/* ───────────────────────────── a régua ───────────────────────────── */

const painel = painelDaFicha;
const fecharPainel = fecharFicha;
const telaCheia = (page) => painel(page).getByRole('link', { name: 'Abrir em tela cheia', exact: true });
const cartaoAlvo = (page) => page.locator(`.q-coluna a.q-titulo-cartao[href="/tarefa/${ALVO}"]`);
const colunaLonga = (page) => page.locator('.q-coluna').first().locator('[data-rolagem]');

/** Abre o quadro e rola a coluna longa até o cartão-alvo estar à vista. Devolve as rolagens. */
async function quadroRolado(page) {
  await page.goto(`${BASE}/quadro/${LISTA}`);
  await cartaoAlvo(page).waitFor();
  await cartaoAlvo(page).scrollIntoViewIfNeeded();
  await pause(250);
  return rolagens(page);
}

const rolagens = (page) =>
  page.evaluate(() => ({
    janela: Math.round(scrollY),
    colunas: [...document.querySelectorAll('[data-rolagem]')].map((el) => Math.round(el.scrollTop)),
  }));

/**
 * Os controles visíveis dentro de `raiz`, por papel + nome acessível — o mesmo
 * critério de `ux.local/inventario.mjs` (o inventário da regra "nenhum botão
 * some"). A trilha fica de fora: ela encurta conforme a largura, e é do topo.
 */
const controles = (page, seletorDaRaiz) =>
  page.evaluate((sel) => {
    const raiz = document.querySelector(sel);
    if (!raiz) return null;
    const alvos = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [role=link], [role=textbox], summary';
    const visivel = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const nome = (e) => {
      const al = e.getAttribute('aria-label');
      if (al) return al;
      if (e.labels && e.labels[0]) return e.labels[0].textContent;
      const t = (e.innerText || e.textContent || '').trim();
      return t || e.getAttribute('title') || e.getAttribute('placeholder') || '';
    };
    const papel = (e) => e.getAttribute('role') || (e.tagName === 'A' ? 'link' : e.tagName === 'INPUT' ? `input:${e.type}` : e.tagName.toLowerCase());
    return [...raiz.querySelectorAll(alvos)]
      .filter((e) => visivel(e) && !e.closest('.tr-trilha'))
      .map((e) => `${papel(e)} | ${nome(e).replace(/\s+/g, ' ').trim().slice(0, 70)}`);
  }, seletorDaRaiz);

const contar = (lista) => lista.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map());
const diferenca = (a, b) => {
  const ca = contar(a), cb = contar(b);
  return [...ca].filter(([s, n]) => (cb.get(s) ?? 0) < n).map(([s]) => s);
};

const semRuido = (erros) => erros.filter((e) => !/chat\/live|WebSocket|validateDOMNesting|Failed to load resource/i.test(e));

/* ───────────────────────────── os cenários ───────────────────────────── */

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('CL1', 'clicar no cartão abre o painel com o quadro atrás e o endereço /tarefa/:id; Esc fecha e o quadro fica como estava (e relê)', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ custom: servidor(estado) });
    const antes = await quadroRolado(page);
    const rolada = Math.max(...antes.colunas);
    assert.ok(rolada > 200, `a coluna longa está rolada (${JSON.stringify(antes)})`);
    assert.equal(await cartaoAlvo(page).getAttribute('href'), `/tarefa/${ALVO}`, 'o href continua o da página cheia');
    const leituras = estado.leiturasDoQuadro;
    const historico = await page.evaluate(() => history.length);

    await cartaoAlvo(page).click();
    await painel(page).waitFor();
    await campoTitulo(page).waitFor();
    assert.equal(new URL(page.url()).pathname, `/tarefa/${ALVO}`, 'o endereço mostra a tarefa');
    assert.equal(await lerTitulo(campoTitulo(page)), 'Peça 25 da campanha');
    assert.equal(await page.evaluate(() => history.length), historico + 1, 'o painel é uma entrada nova (Voltar fecha)');
    assert.equal(await painel(page).getAttribute('aria-label'), 'Tarefa: Peça 25 da campanha');
    // O quadro continua ali atrás — montado e visível à esquerda do painel.
    const atras = await page.evaluate(() => {
      const q = document.querySelector('.q-coluna');
      const p = document.querySelector('[data-painel-lateral] [role="dialog"]').getBoundingClientRect();
      const r = q.getBoundingClientRect();
      return { colunaX: Math.round(r.left), colunaVisivel: r.width > 0 && r.left < p.left, painelX: Math.round(p.left), painelL: Math.round(p.width), paginaCheia: document.querySelector('.t-cabeca') !== null };
    });
    assert.equal(atras.colunaVisivel, true, `a coluna do quadro aparece à esquerda do painel (${JSON.stringify(atras)})`);
    assert.equal(atras.paginaCheia, false, 'não é a página cheia');
    assert.equal(atras.painelL, 1024, 'o painel tem 64rem a 1440');
    assert.deepEqual(await rolagens(page), antes, 'abrir não mexe em rolagem nenhuma');
    await capturar(page, 'cl1-painel-1440');

    await page.keyboard.press('Escape');
    await painel(page).waitFor({ state: 'detached' });
    await page.waitForURL((u) => u.pathname === `/quadro/${LISTA}`);
    await pause(400);
    assert.deepEqual(await rolagens(page), antes, 'fechar devolve o quadro na mesma rolagem');
    assert.equal(estado.leiturasDoQuadro, leituras + 1, 'fechar relê o quadro (uma vez, em silêncio)');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), `/tarefa/${ALVO}`, 'o foco volta ao cartão');
    assert.deepEqual(semRuido(erros), []);
    return `coluna ${rolada}px preservada; painel ${atras.painelL}px em x=${atras.painelX}`;
  });

  await cenario('CL2', 'texto por salvar: ✕, Esc e Voltar perguntam como na página; Continuar fica; Descartar fecha sem gravar', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ custom: servidor(estado) });
    await quadroRolado(page);
    await cartaoAlvo(page).click();
    const titulo = campoTitulo(page);
    await titulo.waitFor();
    await titulo.fill('EDIÇÃO QUE NÃO PODE SUMIR');
    await painel(page).getByText('há alterações por salvar', { exact: true }).waitFor();

    // ✕ → a pergunta, com o endereço ainda na tarefa.
    await fecharPainel(page).click();
    await janela(page).waitFor();
    assert.equal(new URL(page.url()).pathname, `/tarefa/${ALVO}`);
    await capturar(page, 'cl2-pergunta-1440');
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(await lerTitulo(titulo), 'EDIÇÃO QUE NÃO PODE SUMIR', 'continuar mantém o texto');
    assert.equal(await painel(page).count(), 1, 'e o painel');

    // Esc no campo de texto NÃO fecha (desfaz/limpa como na página); fora dele, pergunta.
    await titulo.focus();
    await page.keyboard.press('Escape');
    await pause(300);
    assert.equal(await janela(page).count(), 0, 'Esc dentro do título não fecha o painel');
    await painel(page).focus();
    await pause(650);
    await page.keyboard.press('Escape');
    await janela(page).waitFor();
    await page.keyboard.press('Escape'); // Esc na janela = continuar
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(await painel(page).count(), 1);

    // Voltar do navegador = a mesma pergunta; Descartar fecha e não grava.
    await pause(650);
    await page.goBack();
    await janela(page).waitFor();
    assert.equal(new URL(page.url()).pathname, `/tarefa/${ALVO}`, 'o endereço volta para a tarefa enquanto se decide');
    await page.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await painel(page).waitFor({ state: 'detached' });
    await page.waitForURL((u) => u.pathname === `/quadro/${LISTA}`);
    assert.equal(estado.writes.length, 0, 'nada foi gravado');
    assert.equal(await cartaoAlvo(page).innerText(), 'Peça 25 da campanha');

    // Reabrir: o título é o do banco, e não há rascunho oferecido.
    await cartaoAlvo(page).click();
    await titulo.waitFor();
    assert.equal(await lerTitulo(titulo), 'Peça 25 da campanha');
    await pause(400);
    assert.equal(await page.getByText('Há um rascunho do título', { exact: false }).count(), 0, 'descartar não deixa rascunho');
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('CL3', 'Salvar e sair pelo painel grava uma vez, fecha, e o cartão de trás mostra o título novo', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ custom: servidor(estado) });
    await quadroRolado(page);
    const antes = await rolagens(page);
    await cartaoAlvo(page).click();
    const titulo = campoTitulo(page);
    await titulo.waitFor();
    await titulo.fill('Peça 25 — título novo');
    await painel(page).getByText('há alterações por salvar', { exact: true }).waitFor();
    await fecharPainel(page).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await painel(page).waitFor({ state: 'detached' });
    await page.waitForURL((u) => u.pathname === `/quadro/${LISTA}`);
    assert.equal(estado.writes.length, 1);
    assert.equal(estado.writes[0].corpo.title, 'Peça 25 — título novo');
    // O quadro de trás foi relido: o cartão mostra o que se gravou no painel.
    await page.locator(`.q-coluna a.q-titulo-cartao[href="/tarefa/${ALVO}"]`, { hasText: 'título novo' }).waitFor({ timeout: 4000 });
    await pause(300);
    assert.deepEqual(await rolagens(page), antes, 'a rolagem continua onde estava');
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('CL4', '"Abrir em tela cheia" troca o painel pela página; o X da página volta ao quadro', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ custom: servidor(estado) });
    await quadroRolado(page);
    await cartaoAlvo(page).click();
    await campoTitulo(page).waitFor();
    assert.equal(await telaCheia(page).getAttribute('href'), `/tarefa/${ALVO}`);
    await telaCheia(page).click();
    await page.locator('.t-cabeca').waitFor();
    assert.equal(await painel(page).count(), 0, 'sem painel');
    assert.equal(new URL(page.url()).pathname, `/tarefa/${ALVO}`);
    await campoTitulo(page).waitFor();
    await page.getByRole('button', X).click();
    await page.waitForURL((u) => u.pathname === `/quadro/${LISTA}`);
    await cartaoAlvo(page).waitFor();
    assert.equal(await painel(page).count(), 0, 'voltar da página cheia leva ao quadro, e não ao painel trocado');
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('CL5', 'Ctrl+clique é do navegador: abre /tarefa/:id (página cheia) numa aba nova; o quadro fica sem painel', async (abrir) => {
    const estado = novoEstado();
    const { page, context, erros } = await abrir({ custom: servidor(estado) });
    await quadroRolado(page);
    const nova = context.waitForEvent('page');
    await cartaoAlvo(page).click({ modifiers: ['Control'] });
    const aba = await nova;
    await aba.waitForLoadState('domcontentloaded');
    await aba.locator('.t-cabeca').waitFor();
    assert.equal(new URL(aba.url()).pathname, `/tarefa/${ALVO}`);
    assert.equal(await aba.locator('[data-painel-lateral]').count(), 0, 'a aba nova é a página cheia');
    await pause(300);
    assert.equal(await painel(page).count(), 0, 'a aba de origem não abriu painel');
    assert.equal(new URL(page.url()).pathname, `/quadro/${LISTA}`);
    // O link colado (aba nova, endereço digitado) é a página cheia também.
    const colada = await context.newPage();
    await colada.goto(`${BASE}/tarefa/${ALVO}`);
    await colada.locator('.t-cabeca').waitFor();
    assert.equal(await colada.locator('[data-painel-lateral]').count(), 0);
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('CL6', 'F5 com o painel aberto reabre o MESMO quadro com a ficha ao lado; Esc fecha', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ custom: servidor(estado) });
    await quadroRolado(page);
    await cartaoAlvo(page).click();
    await campoTitulo(page).waitFor();
    await page.reload();
    await painel(page).waitFor();
    await campoTitulo(page).waitFor();
    assert.equal(new URL(page.url()).pathname, `/tarefa/${ALVO}`);
    assert.equal(await lerTitulo(campoTitulo(page)), 'Peça 25 da campanha');
    assert.equal(await page.locator('.q-coluna').count() > 0, true, 'o quadro está atrás');
    assert.equal(await page.locator('.t-cabeca').count(), 0, 'não virou página cheia');
    await painel(page).focus();
    await page.keyboard.press('Escape');
    await painel(page).waitFor({ state: 'detached' });
    await page.waitForURL((u) => u.pathname === `/quadro/${LISTA}`);
    await cartaoAlvo(page).waitFor();
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('CL7', 'a 390 e a 800 px o painel cobre a tela inteira; a 1366 fica com 64rem', async (abrir) => {
    const saida = [];
    for (const [w, h] of [[390, 844], [800, 900], [1366, 768]]) {
      const estado = novoEstado();
      const { page, erros } = await abrir({ custom: servidor(estado), viewport: { width: w, height: h }, tema: w === 1366 ? 'escuro' : undefined });
      await page.goto(`${BASE}/quadro/${LISTA}`);
      await cartaoAlvo(page).waitFor();
      await cartaoAlvo(page).scrollIntoViewIfNeeded();
      await cartaoAlvo(page).click();
      await campoTitulo(page).waitFor();
      await pause(450);
      const caixa = await painel(page).boundingBox();
      const rola = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (w < 1024) {
        assert.equal(Math.round(caixa.x), 0, `${w}: o painel começa na borda`);
        assert.equal(Math.round(caixa.width), w, `${w}: o painel cobre a largura`);
      } else {
        assert.equal(Math.round(caixa.width), 1024, `${w}: 64rem`);
      }
      assert.equal(rola, false, `${w}: sem rolagem lateral da página`);
      // O topo cabe: trilha, "Abrir em tela cheia" e ✕ à vista.
      for (const alvo of [telaCheia(page), fecharPainel(page)]) {
        const b = await alvo.boundingBox();
        assert.ok(b && b.x >= 0 && b.x + b.width <= w + 1, `${w}: controle do topo dentro da tela`);
      }
      await capturar(page, `cl7-painel-${w}`);
      assert.deepEqual(semRuido(erros), []);
      saida.push(`${w}: x=${Math.round(caixa.x)} l=${Math.round(caixa.width)}`);
    }
    return saida.join(' · ');
  });

  await cenario('CL8', 'Pasta, Minhas (lista e kanban) e Todas também abrem ao lado, e releem ao fechar', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ custom: servidor(estado) });
    const saida = [];
    for (const [nome, rota, link, leitura] of [
      ['pasta', `/quadro/pasta/${PASTA}`, `.q-coluna a.q-titulo-cartao[href="/tarefa/${ALVO}"]`, 'leiturasDaPasta'],
      ['minhas', '/meu-trabalho?ver=lista', `a.mt-titulo[href="/tarefa/${ALVO}"]`, 'leiturasDeMinhas'],
      ['minhas-kanban', '/meu-trabalho?ver=kanban', `a.q-titulo-cartao[href="/tarefa/${ALVO}"]`, 'leiturasDeMinhas'],
      ['todas', '/tarefas?ver=lista', `a.mt-titulo[href="/tarefa/${ALVO}"]`, 'leiturasDeTodas'],
    ]) {
      await page.goto(BASE + rota);
      const alvo = page.locator(link).first();
      await alvo.waitFor();
      // A memória de rolagem do documento é por CAMINHO (`LembrarRolagem`): a
      // lista de Minhas deixou 1174px guardados, e o Kanban, no mesmo caminho,
      // começa reservando essa altura. Mede-se depois que a reserva sai.
      await page.waitForFunction(() => document.documentElement.style.minHeight === '', null, { timeout: 5000 });
      await alvo.scrollIntoViewIfNeeded();
      await pause(250);
      const antes = await rolagens(page);
      const lidas = estado[leitura];
      await alvo.click();
      await painel(page).waitFor();
      await campoTitulo(page).waitFor();
      assert.equal(new URL(page.url()).pathname, `/tarefa/${ALVO}`, `${nome}: endereço da tarefa`);
      await fecharPainel(page).click();
      await painel(page).waitFor({ state: 'detached' });
      await page.waitForURL((u) => u.pathname + u.search === rota);
      await pause(500);
      assert.ok(estado[leitura] > lidas, `${nome}: releu ao fechar`);
      const depois = await rolagens(page);
      assert.ok(Math.abs(depois.janela - antes.janela) <= 2, `${nome}: rolagem ${antes.janela} → ${depois.janela}`);
      saida.push(`${nome} ✓ (y ${antes.janela})`);
    }
    assert.deepEqual(semRuido(erros), []);
    return saida.join(' · ');
  });

  await cenario('CL9', 'Espaço (Lista e Kanban do escopo) abre ao lado e relê ao fechar', async (abrir) => {
    const lk = novoEstadoLK();
    const { page, erros } = await abrir({ custom: servidorLK(lk) });
    const rota = `/quadro/espaco/${LK.espaco}`;
    for (const [modo, seletor] of [['lista', 'a.ek-titulo'], ['kanban', '.ek-kanban a.q-titulo-cartao']]) {
      await page.goto(`${BASE}${rota}?ver=${modo}`);
      const alvo = page.locator(seletor).nth(3);
      await alvo.waitFor();
      const href = await alvo.getAttribute('href');
      const pedidos = lk.pedidos.length;
      await alvo.click();
      await painel(page).waitFor();
      assert.equal(new URL(page.url()).pathname, href, `${modo}: endereço da tarefa`);
      await page.goBack();
      await painel(page).waitFor({ state: 'detached' });
      await page.waitForURL((u) => u.pathname === rota && u.searchParams.get('ver') === modo);
      await pause(500);
      assert.ok(lk.pedidos.length > pedidos, `${modo}: releu o escopo ao fechar`);
    }
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('CL10', 'nenhum controle some: a ficha no painel tem os mesmos controles da página cheia (menos o topo), a 1440 e a 390', async (abrir) => {
    const saida = [];
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const estado = novoEstado();
      const { page, erros } = await abrir({ custom: servidor(estado), viewport: { width: w, height: h } });
      // A página cheia, pelo endereço (o link colado).
      await page.goto(`${BASE}/tarefa/${ALVO}`);
      await campoTitulo(page).waitFor();
      await page.getByRole('button', { name: 'Comentar', exact: true }).waitFor();
      await pause(500);
      const naPagina = await page.evaluate(() => {
        const c = document.querySelector('.t-cabeca')?.parentElement;
        if (c) c.setAttribute('data-coluna-da-ficha', '');
        return c !== null && c !== undefined;
      });
      assert.equal(naPagina, true);
      const pagina = await controles(page, '[data-coluna-da-ficha]');
      // O painel, pelo cartão do quadro.
      await page.goto(`${BASE}/quadro/${LISTA}`);
      await cartaoAlvo(page).waitFor();
      await cartaoAlvo(page).scrollIntoViewIfNeeded();
      await cartaoAlvo(page).click();
      await campoTitulo(page).waitFor();
      await painel(page).getByRole('button', { name: 'Comentar', exact: true }).waitFor();
      await pause(500);
      const noPainel = await controles(page, '[data-painel-lateral] [role="dialog"]');
      const soNaPagina = diferenca(pagina, noPainel);
      const soNoPainel = diferenca(noPainel, pagina);
      assert.deepEqual(soNaPagina, ['button | Fechar tarefa e voltar'], `${w}: só na página: ${JSON.stringify(soNaPagina)}`);
      assert.deepEqual(soNoPainel.sort(), ['button | Fechar', 'link | Abrir em tela cheia'], `${w}: só no painel: ${JSON.stringify(soNoPainel)}`);
      assert.ok(noPainel.length >= 25, `${w}: a ficha cheia tem controles (${noPainel.length})`);
      assert.deepEqual(semRuido(erros), []);
      saida.push(`${w}: ${pagina.length} na página · ${noPainel.length} no painel`);
    }
    return `${saida.join(' · ')} · diferença só no topo (X ↔ "Abrir em tela cheia" + ✕)`;
  });

  await cenario('CL11', 'os menus da ficha abrem inteiros dentro do painel (1440 e 1366), por cima de tudo', async (abrir) => {
    const saida = [];
    for (const [w, h] of [[1440, 900], [1366, 768]]) {
      const estado = novoEstado();
      const { page, erros } = await abrir({ custom: servidor(estado), viewport: { width: w, height: h } });
      await page.goto(`${BASE}/quadro/${LISTA}`);
      const semSub = page.locator(`.q-coluna a.q-titulo-cartao[href="/tarefa/${SEM_SUB}"]`);
      await semSub.waitFor();
      await semSub.click();
      await campoTitulo(page).waitFor();
      await pause(400);
      const gatilhos = [
        ['lista', painel(page).locator('.t-lugar > .cu-seletor')],
        ['tipo antigo', painel(page).locator('.t-tipo > .cu-seletor')],
        ['···', painel(page).getByRole('button', { name: 'Mais ações da tarefa', exact: true })],
        ['etapa', painel(page).locator('.t-prop', { hasText: 'Etapa' }).locator('.cu-chip').first()],
        ['responsáveis', painel(page).locator('.t-prop', { hasText: 'Responsáveis' }).locator('.cu-chip')],
        ['prazo', painel(page).locator('.t-prop', { hasText: 'Prazo' }).locator('.cu-chip')],
        ['prioridade', painel(page).locator('.t-prop', { hasText: 'Prioridade' }).locator('.cu-chip')],
        ['etiquetas', painel(page).locator('.t-prop', { hasText: 'Etiquetas' }).locator('.cu-chip')],
        ['cliente', painel(page).locator('[data-prop="cliente"] button').first()],
      ];
      for (const [nome, gatilho] of gatilhos) {
        await gatilho.scrollIntoViewIfNeeded();
        await gatilho.click();
        await page
          .waitForFunction(
            () => [...document.querySelectorAll('.cu-balao')].some((b) => b.getBoundingClientRect().height > 0),
            null,
            { timeout: 3000 },
          )
          .catch(() => {
            throw new Error(`${w} ${nome}: o balão não abriu`);
          });
        await pause(250);
        const m = await page.evaluate(() => {
          const b = [...document.querySelectorAll('.cu-balao')].filter((x) => x.getBoundingClientRect().height > 0).at(-1);
          if (!b) return null;
          const r = b.getBoundingClientRect();
          const corpo = document.querySelector('[data-painel-lateral] .pll-corpo').getBoundingClientRect();
          // O ponto do meio do balão é dele mesmo (nada o cobre) e ele cabe na janela.
          const meio = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
          const preso = b.closest('.pll-corpo') !== null;
          return {
            dentroDaJanela: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
            // Preso dentro do corpo que rola: tem de caber na parte VISÍVEL do corpo.
            cabeNoCorpo: !preso || (r.top >= corpo.top - 1 && r.bottom <= corpo.bottom + 1 && r.left >= corpo.left - 1 && r.right <= corpo.right + 1),
            porCima: b.contains(meio),
            caixa: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          };
        });
        assert.ok(m, `${w} ${nome}: o balão abriu`);
        assert.ok(m.dentroDaJanela && m.cabeNoCorpo && m.porCima, `${w} ${nome}: balão inteiro e por cima ${JSON.stringify(m)}`);
        if (w === 1440 && nome === 'responsáveis') await capturar(page, 'cl11-menu-no-painel');
        await page.keyboard.press('Escape');
        await pause(200);
        assert.equal(await painel(page).count(), 1, `${w} ${nome}: o Esc do menu não fecha o painel`);
        // Alguns seletores mantêm o foco no balão aberto; garante fechado antes do próximo.
        if (await page.locator('.cu-balao').count()) {
          await painel(page).locator('.pll-topo').click({ position: { x: 5, y: 5 } });
          await pause(150);
        }
      }
      assert.deepEqual(semRuido(erros), []);
      saida.push(`${w}: ${gatilhos.length} menus`);
    }
    return saida.join(' · ');
  });

  await cenario('CL12', 'os links de dentro da ficha levam à página cheia; Voltar devolve o painel sobre o quadro', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ custom: servidor(estado) });
    await quadroRolado(page);
    await cartaoAlvo(page).click();
    await campoTitulo(page).waitFor();
    await painel(page).getByRole('link', { name: SUB.title }).click();
    await page.waitForURL((u) => u.pathname === '/tarefa/sub-c7');
    await page.locator('.t-cabeca').waitFor();
    assert.equal(await painel(page).count(), 0, 'a subtarefa abriu na página cheia');
    await page.goBack();
    await painel(page).waitFor();
    assert.equal(new URL(page.url()).pathname, `/tarefa/${ALVO}`);
    await campoTitulo(page).waitFor();
    assert.equal(await lerTitulo(campoTitulo(page)), 'Peça 25 da campanha');
    await page.goBack();
    await painel(page).waitFor({ state: 'detached' });
    await page.waitForURL((u) => u.pathname === `/quadro/${LISTA}`);
    assert.deepEqual(semRuido(erros), []);
  });

  /* A BUSCA PENDENTE NÃO FECHA O PAINEL — revisão pós-F43. A caixa do quadro
     grava a busca no endereço 350 ms depois da última tecla, com `replace` e
     sem `state`. Digitar e clicar num cartão antes disso: o painel abria e,
     no disparo do relógio, a entrada dele era trocada por uma sem o painel —
     o painel sumia. Agora a busca é gravada quando o foco sai da caixa (o
     `mousedown` do cartão, antes do clique), e o relógio não escreve por cima
     de outra entrada. */
  await cenario('CL13', 'digitar a busca e clicar logo num cartão: o painel fica aberto depois da espera, e ao fechar o quadro tem a busca no endereço', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ custom: servidor(estado) });
    await quadroRolado(page);
    const caixa = page.getByRole('textbox', { name: 'Buscar tarefa pelo nome' });
    // Digitar e clicar no MESMO gesto, dentro da espera de 350 ms.
    const inicio = Date.now();
    await caixa.fill('Peça');
    await cartaoAlvo(page).click();
    const decorrido = Date.now() - inicio;
    await painel(page).waitFor();
    await campoTitulo(page).waitFor();
    await pause(900); // a espera da busca passou com folga
    assert.equal(await painel(page).count(), 1, 'o painel continua aberto depois da espera da busca');
    assert.equal(new URL(page.url()).pathname, `/tarefa/${ALVO}`, 'o endereço continua o da tarefa');

    await page.keyboard.press('Escape');
    await painel(page).waitFor({ state: 'detached' });
    await page.waitForURL((u) => u.pathname === `/quadro/${LISTA}`);
    assert.equal(new URL(page.url()).searchParams.get('busca'), 'Peça', 'a busca digitada está no endereço do quadro');
    assert.equal(await caixa.inputValue(), 'Peça', 'e na caixa');

    // Quem digita e FICA também recebe a busca no endereço, depois da espera.
    await caixa.fill('Peça 2');
    await page.waitForURL((u) => u.searchParams.get('busca') === 'Peça 2');
    assert.deepEqual(semRuido(erros), []);
    return `digitar → clique em ${decorrido} ms`;
  });

  return resultados;
}
