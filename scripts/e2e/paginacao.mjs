/**
 * A paginação de `Minhas tarefas` — F17.AUD05 (contrato) e F17.AUD06 (tela),
 * provadas no Chrome real com 250 pendentes em três páginas de 100.
 *
 * O servidor aqui é fictício: responde `/api/board/my-tasks?aba=&cursor=` com
 * o contrato da AUD05 (`counts`, `returned`, `hasMore`, `nextCursor`). O que
 * se prova é a TELA: as abas sem zero antes da resposta, o "Carregar mais"
 * nas duas formas, a troca de aba com resposta atrasada, a volta de uma
 * tarefa do segundo lote com as páginas relidas, e os dois erros (inicial e
 * incremental). A consulta de verdade se prova com
 * `scripts/provar-paginacao-do-trabalho.mjs`, contra o Postgres.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, detail, esperarTitulo, pause, row, semEco, titulos, fecharFicha } from './comum.mjs';

const COUNTS = { pendente: 250, feito: 3, delegado: 1 };
const pendentes = Array.from({ length: 250 }, (_, i) => ({ ...row, id: 'p' + i, title: 'Pendente ' + i, dueOn: null }));
/** F05-5: o cenário NORMAL — prazos espalhados por hoje, atraso, próximos e sem data (o de cima é todo sem data). */
const diaDe = (d) => { const x = new Date(); x.setDate(x.getDate() + d); const n = (v) => String(v).padStart(2, '0'); return `${x.getFullYear()}-${n(x.getMonth() + 1)}-${n(x.getDate())}`; };
const PRAZOS = [0, 0, -2, 1, 3, null, 0, 5, -1, null];
const normais = Array.from({ length: 40 }, (_, i) => ({ ...row, id: 'n' + i, title: 'Tarefa normal ' + i, dueOn: PRAZOS[i % PRAZOS.length] === null ? null : diaDe(PRAZOS[i % PRAZOS.length]) }));
const feitos = Array.from({ length: 3 }, (_, i) => ({ ...row, id: 'f' + i, title: 'Feita ' + i, completedAt: '2026-08-01T00:00:00Z', statusType: 'closed' }));
const delegados = [{ ...row, id: 'd0', title: 'Delegada 0', assignedToMe: false, createdByMe: true, otherAssignees: 1 }];
const PAGINAS = { pendente: [pendentes.slice(0, 100), pendentes.slice(100, 200), pendentes.slice(200)], feito: [feitos], delegado: [delegados] };
const CURSORES = [null, 'c1', 'c2'];

function paginaDe(aba, cursor) {
  const i = Math.max(0, CURSORES.indexOf(cursor));
  const lista = PAGINAS[aba];
  const rows = lista[i] ?? [];
  const hasMore = i + 1 < lista.length;
  return { ok: true, work: { rows, total: COUNTS[aba], capped: false, aba, counts: COUNTS, returned: rows.length, hasMore, nextCursor: hasMore ? CURSORES[i + 1] : null } };
}

/** O servidor fictício da paginação; `antes(url)` pode atrasar ou substituir uma resposta. */
export const servidorPaginado = (antes = async () => null) => async (url, req) => {
  const custom = await antes(url, req);
  if (custom) return custom;
  if (url.pathname === '/api/board/my-tasks') {
    const aba = url.searchParams.get('aba');
    return { body: aba ? paginaDe(aba, url.searchParams.get('cursor')) : { ok: true, work: { rows: [row], total: 1, capped: false } } };
  }
  if (url.pathname.startsWith('/api/board/tasks/')) {
    const id = url.pathname.split('/').pop();
    const t = [...pendentes, ...feitos, ...delegados].find((r) => r.id === id) ?? row;
    return { body: { ok: true, task: { ...detail, id: t.id, title: t.title }, storage: { ready: false, variable: '' } } };
  }
  return null;
};

const corteTexto = (page) => page.locator('.mt-corte').evaluate((el) => Array.from(el.children).map((c) => c.textContent.trim()).join(' '));
const abaTexto = async (page, rotulo) => (await page.getByRole('tab', { name: new RegExp('^' + rotulo) }).textContent()).trim();
const contasDasAbas = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Situação das tarefas"] [role="tab"]')).map((b) => b.textContent.trim()));
/** F03: Lista × Kanban (antes "Quadro", F18C) são botões pressionáveis num grupo, não abas. */
const forma = (page, rotulo) => page.getByRole('group', { name: 'Forma de ver' }).getByRole('button', { name: rotulo, exact: true });
const carregarMais = (page) => page.getByRole('button', { name: 'Carregar mais', exact: true });

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('1', 'abas 250/3/1 vindas do servidor; nenhum zero antes da primeira resposta', async (abrir) => {
    const { page } = await abrir({
      custom: servidorPaginado(async (url) => {
        if (url.pathname === '/api/board/my-tasks' && url.searchParams.get('aba') === 'pendente' && !url.searchParams.get('cursor')) await pause(1200);
        return null;
      }),
    });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByText('Carregando…', { exact: true }).waitFor();
    const duranteEspera = await contasDasAbas(page);
    assert.deepEqual(duranteEspera, ['Pendente', 'Feito', 'Delegado'], 'abas sem número durante a espera');
    assert.equal(await page.locator('.iw-segmento-conta').count(), 0);
    assert.equal(await page.getByText('Nada para hoje').count(), 0);
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor({ timeout: 5000 });
    assert.deepEqual(await contasDasAbas(page), ['Pendente250', 'Feito3', 'Delegado1']);
    return `durante a espera ${JSON.stringify(duranteEspera)}; depois 250/3/1`;
  });

  await cenario('2', 'lista: 100 → "100 de 250 · Carregar mais" → 200 → 250, botão some, sem duplicata; a tarefa 240 abre', async (abrir) => {
    const { page, pedidos } = await abrir({ custom: servidorPaginado() });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
    assert.equal((await titulos(page)).length, 100);
    assert.equal(await corteTexto(page), '100 de 250 Carregar mais');
    await carregarMais(page).scrollIntoViewIfNeeded();
    const alvo = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent.trim() === 'Carregar mais'); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.className; });
    assert.equal(alvo, 'q-coluna-mais', 'o botão é o que recebe o clique no canto (não o botão de tema)');
    await carregarMais(page).click();
    await page.locator('.mt-corte', { hasText: '200 de 250' }).waitFor();
    assert.equal((await titulos(page)).length, 200);
    assert.equal(await abaTexto(page, 'Pendente'), 'Pendente250', 'contagem não muda ao carregar mais');
    await carregarMais(page).click();
    await page.getByText('Pendente 249', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length === 250);
    const t = await titulos(page);
    assert.equal(new Set(t).size, 250, 'sem títulos duplicados');
    assert.equal(await page.locator('.mt-corte').count(), 0, 'faixa some no fim');
    assert.equal(await carregarMais(page).count(), 0);
    assert.deepEqual(semEco(pedidos), [{ aba: 'pendente', cursor: null }, { aba: 'pendente', cursor: 'c1' }, { aba: 'pendente', cursor: 'c2' }]);
    await page.getByRole('link', { name: 'Pendente 240', exact: true }).click();
    await page.waitForURL('**/tarefa/p240');
    await esperarTitulo(page, 'Pendente 240');
    return `pedidos ${JSON.stringify(semEco(pedidos).map((p) => p.cursor))}; 250 títulos únicos`;
  });

  await cenario('3', 'Lista → Quadro não relê e mostra o mesmo conjunto; Carregar mais no quadro; a tarefa 150 abre pelo quadro', async (abrir) => {
    const { page, pedidos } = await abrir({ custom: servidorPaginado() });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
    await carregarMais(page).click();
    await page.locator('.mt-corte', { hasText: '200 de 250' }).waitFor();
    const antes = await titulos(page);
    const nPedidos = pedidos.length;
    await forma(page, 'Kanban').click();
    await page.waitForURL('**/meu-trabalho?ver=kanban');
    await page.locator('.q-titulo-cartao').first().waitFor();
    await pause(600);
    assert.equal(pedidos.length, nPedidos, 'trocar a forma não faz novo pedido');
    const depois = await titulos(page);
    assert.deepEqual(depois, antes, 'o quadro mostra o MESMO conjunto, na mesma ordem');
    assert.equal(await corteTexto(page), '200 de 250 Carregar mais', 'Carregar mais também no quadro');
    await carregarMais(page).click();
    await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length === 250);
    assert.equal(await page.locator('.mt-corte').count(), 0);
    const n2 = pedidos.length;
    await forma(page, 'Lista').click();
    await page.waitForURL('**/meu-trabalho?ver=lista');
    await pause(400);
    assert.equal(pedidos.length, n2);
    assert.equal((await titulos(page)).length, 250);
    await forma(page, 'Kanban').click();
    await page.getByRole('link', { name: 'Pendente 150', exact: true }).click();
    await page.waitForURL('**/tarefa/p150');
    await esperarTitulo(page, 'Pendente 150');
    return `${n2} pedidos no total; 200 títulos idênticos entre lista e quadro`;
  });

  await cenario('4', 'trocar de aba com a resposta anterior atrasada: nada de pendente entra em feito', async (abrir) => {
    const { page, pedidos } = await abrir({
      custom: servidorPaginado(async (url) => {
        if (url.pathname !== '/api/board/my-tasks') return null;
        const aba = url.searchParams.get('aba');
        const cursor = url.searchParams.get('cursor');
        if (aba === 'pendente' && !cursor) await pause(1500);
        if (aba === 'pendente' && cursor === 'c1') await pause(1500);
        return null;
      }),
    });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByText('Carregando…', { exact: true }).waitFor();
    await page.getByRole('tab', { name: /^Feito/ }).click();
    await page.waitForURL('**/meu-trabalho?aba=feito');
    await page.getByRole('link', { name: 'Feita 2', exact: true }).waitFor();
    await pause(1700);
    assert.deepEqual(await titulos(page), ['Feita 0', 'Feita 1', 'Feita 2'], 'nada de pendente entrou em feito');
    assert.equal(await page.locator('.mt-corte').count(), 0);
    assert.deepEqual(await contasDasAbas(page), ['Pendente250', 'Feito3', 'Delegado1']);
    assert.equal(await page.getByRole('tab', { name: /^Feito/ }).getAttribute('aria-selected'), 'true');
    // Variante: continuação de pendente em voo quando se troca para feito.
    await page.getByRole('tab', { name: /^Pendente/ }).click();
    await page.getByText('Pendente 99', { exact: true }).waitFor({ timeout: 5000 });
    await carregarMais(page).click();
    await page.getByRole('button', { name: 'Buscando…' }).waitFor();
    await page.getByRole('tab', { name: /^Feito/ }).click();
    await page.getByRole('link', { name: 'Feita 2', exact: true }).waitFor();
    await pause(1800);
    assert.deepEqual(await titulos(page), ['Feita 0', 'Feita 1', 'Feita 2'], 'a continuação de pendente não entrou em feito');
    assert.equal(await page.locator('.mt-corte').count(), 0, 'a faixa de pendente não apareceu em feito');
    assert.equal(await page.getByText('Carregando…').count(), 0);
    return `pedidos ${JSON.stringify(pedidos.map((p) => `${p.aba}/${p.cursor}`))}`;
  });

  await cenario('5', 'quadro: abrir a tarefa 150 (2º lote) e voltar restaura aba, forma e as 200 linhas; F5 relê as 2 páginas', async (abrir) => {
    const { page, pedidos } = await abrir({ custom: servidorPaginado() });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
    await carregarMais(page).click();
    await page.locator('.mt-corte', { hasText: '200 de 250' }).waitFor();
    const estadoAntes = await page.evaluate(() => window.history.state?.usr ?? null);
    assert.deepEqual(estadoAntes, { progresso: { aba: 'pendente', paginas: 2 } }, 'history.state tem o progresso antes de navegar');
    await forma(page, 'Kanban').click();
    await page.waitForURL('**/meu-trabalho?ver=kanban');
    await page.waitForFunction(() => window.history.state?.usr?.progresso?.paginas === 2);
    const link = page.getByRole('link', { name: 'Pendente 150', exact: true });
    await link.scrollIntoViewIfNeeded();
    await pause(400);
    const nAntes = pedidos.length;
    await link.click();
    await page.waitForURL('**/tarefa/p150');
    await esperarTitulo(page, 'Pendente 150');
    // F43, Fase 7: a ficha abre AO LADO e o quadro nem sai da tela; fechar (o
    // ✕ do painel) relê as mesmas duas páginas, sem esvaziar nada.
    await fecharFicha(page).click();
    await page.waitForURL('**/meu-trabalho?ver=kanban');
    await page.getByRole('link', { name: 'Pendente 150', exact: true }).waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length === 200);
    await pause(1200);
    const refeitos = semEco(pedidos.slice(nAntes));
    assert.deepEqual(refeitos, [{ aba: 'pendente', cursor: null }, { aba: 'pendente', cursor: 'c1' }], 'as duas páginas foram RELIDAS');
    assert.equal(await forma(page, 'Kanban').getAttribute('aria-pressed'), 'true', 'forma preservada');
    assert.equal(await page.getByRole('tab', { name: /^Pendente/ }).getAttribute('aria-selected'), 'true', 'aba preservada');
    assert.equal(await corteTexto(page), '200 de 250 Carregar mais');
    const nF5 = pedidos.length;
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length === 200, null, { timeout: 5000 });
    await pause(500);
    assert.deepEqual(semEco(pedidos.slice(nF5)), [{ aba: 'pendente', cursor: null }, { aba: 'pendente', cursor: 'c1' }], 'F5 relê as 2 páginas');
    return 'voltar releu [null, c1] e desenhou 200 cartões no quadro; F5 idem';
  });

  await cenario('5c', 'lista: abrir a tarefa 150 rolada e voltar — 200 linhas relidas e a rolagem restaurada', async (abrir) => {
    const { page, pedidos } = await abrir({
      custom: servidorPaginado(async (url) => { if (url.pathname === '/api/board/my-tasks') await pause(300); return null; }),
    });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
    await carregarMais(page).click();
    await page.locator('.mt-corte', { hasText: '200 de 250' }).waitFor();
    const link = page.getByRole('link', { name: 'Pendente 150', exact: true });
    await link.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, -120); // um gesto de rolagem de verdade, para o LembrarRolagem gravar
    await pause(400);
    const rolagemAntes = await page.evaluate(() => Math.round(window.scrollY));
    const nAntes = pedidos.length;
    await link.click();
    await page.waitForURL('**/tarefa/p150');
    await esperarTitulo(page, 'Pendente 150');
    // F43, Fase 7: a ficha abre ao lado; fechar é o ✕ do painel (ver o 5).
    await fecharFicha(page).click();
    await page.waitForURL('**/meu-trabalho');
    await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length === 200, null, { timeout: 8000 });
    await pause(1500);
    assert.deepEqual(semEco(pedidos.slice(nAntes)), [{ aba: 'pendente', cursor: null }, { aba: 'pendente', cursor: 'c1' }]);
    const rolagemDepois = await page.evaluate(() => Math.round(window.scrollY));
    const visivel = await page.getByRole('link', { name: 'Pendente 150', exact: true }).evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    assert.equal(await page.getByRole('tab', { name: /^Pendente/ }).getAttribute('aria-selected'), 'true');
    assert.equal(await forma(page, 'Lista').getAttribute('aria-pressed'), 'true');
    assert.ok(Math.abs(rolagemAntes - rolagemDepois) <= 4, `rolagem restaurada: antes=${rolagemAntes} depois=${rolagemDepois}`);
    assert.ok(visivel, 'a tarefa 150 está visível ao voltar');
    return `rolagem ${rolagemAntes} → ${rolagemDepois}; tarefa 150 visível`;
  });

  await cenario('6', 'falha 500 no 2º lote: as 100 ficam, Tentar de novo repete o mesmo cursor e chega a 200', async (abrir) => {
    let falhas = 1;
    const { page, pedidos } = await abrir({
      custom: servidorPaginado((url) => {
        if (url.pathname === '/api/board/my-tasks' && url.searchParams.get('cursor') === 'c1' && falhas > 0) { falhas -= 1; return { status: 500, body: { ok: false, message: 'Falhou de propósito' } }; }
        return null;
      }),
    });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
    await carregarMais(page).click();
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).waitFor({ timeout: 5000 });
    assert.equal((await titulos(page)).length, 100, 'as 100 ficam');
    assert.equal(await carregarMais(page).count(), 0, 'no erro, Carregar mais cede lugar ao Tentar de novo');
    assert.equal(await corteTexto(page), '100 de 250');
    assert.equal(await abaTexto(page, 'Pendente'), 'Pendente250');
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await page.locator('.mt-corte', { hasText: '200 de 250' }).waitFor({ timeout: 5000 });
    assert.equal((await titulos(page)).length, 200);
    assert.equal(await page.getByRole('button', { name: 'Tentar de novo' }).count(), 0);
    assert.deepEqual(semEco(pedidos).map((p) => p.cursor), [null, 'c1', 'c1'], 'o mesmo cursor foi repetido');
  });

  await cenario('7', 'erro INICIAL (401 + renovação 503): abas sem número, sem grupo, a tela fica; Tentar de novo → 100 linhas e 250/3/1', async (abrir) => {
    let falhas = 2;
    const { page } = await abrir({
      custom: servidorPaginado((url) => {
        if (url.pathname === '/api/board/my-tasks' && !url.searchParams.get('cursor') && falhas > 0) { falhas -= 1; return { status: 401, body: { message: 'Sessão expirada' } }; }
        if (url.pathname === '/api/auth/refresh') return { status: 503, body: { message: 'Não foi possível renovar agora. Tente de novo.' } };
        return null;
      }),
    });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).waitFor({ timeout: 5000 });
    assert.deepEqual(await contasDasAbas(page), ['Pendente', 'Feito', 'Delegado'], 'erro inicial: sem número, sem zero');
    assert.equal(await page.getByText('Nada para hoje').count(), 0, 'erro inicial: nenhum grupo desenhado');
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
    assert.equal((await titulos(page)).length, 100);
  });

  await cenario('8', 'F03 — teclado: abas de situação com ←/→/Home/End e foco móvel; forma com Tab e Espaço', async (abrir) => {
    const { page } = await abrir({ custom: servidorPaginado() });
    await page.goto(BASE + '/meu-trabalho');
    const pendente = page.getByRole('tab', { name: /^Pendente\s*250$/ });
    await pendente.waitFor();
    // Só a aba selecionada entra no Tab; o painel diz quem o nomeia.
    const tabIndices = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Situação das tarefas"] [role="tab"]')).map((b) => b.tabIndex));
    assert.deepEqual(tabIndices, [0, -1, -1]);
    const painel = await page.evaluate(() => { const p = document.getElementById('mt-painel'); return { role: p?.getAttribute('role'), nome: document.getElementById(p?.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() }; });
    assert.deepEqual(painel, { role: 'tabpanel', nome: 'Pendente250' });
    await pendente.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForURL('**/meu-trabalho?aba=feito');
    const focada = () => page.evaluate(() => document.activeElement?.textContent?.trim());
    // O foco e o endereço mudam em momentos diferentes do mesmo gesto; espera o foco assentar.
    const focoEm = (t) => page.waitForFunction((x) => document.activeElement?.textContent?.trim() === x, t, { timeout: 3000 }).then(() => t, async () => (await focada()) + ' ' + page.url() + ' ' + (await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((b) => b.textContent.trim() + ':' + b.tabIndex + ':' + b.getAttribute('aria-selected')).join(' '))));
    assert.equal(await focoEm('Feito3'), 'Feito3');
    await page.locator('[role="tab"][aria-selected="true"]', { hasText: 'Feito' }).waitFor({ timeout: 3000 });
    await page.keyboard.press('End');
    await page.waitForURL('**/meu-trabalho?aba=delegado');
    assert.equal(await focoEm('Delegado1'), 'Delegado1');
    await page.keyboard.press('ArrowRight'); // dá a volta
    await page.waitForURL('**/meu-trabalho?aba=pendente');
    assert.equal(await focoEm('Pendente250'), 'Pendente250');
    await page.keyboard.press('Home');
    assert.equal(await focoEm('Pendente250'), 'Pendente250');
    // Tab sai das abas (as outras não estão no Tab) para a busca — F05: a
    // ordem é situação → busca → forma, a mesma do desenho — e dela à forma.
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.activeElement?.getAttribute('type') === 'search', null, { timeout: 3000 });
    await page.keyboard.press('Tab');
    assert.equal(await focoEm('Lista'), 'Lista');
    await page.keyboard.press('Tab');
    assert.equal(await focoEm('Kanban'), 'Kanban');
    await page.keyboard.press('Space');
    await page.waitForURL('**ver=kanban');
    await page.locator('[aria-label="Forma de ver"] [aria-pressed="true"]', { hasText: 'Kanban' }).waitFor({ timeout: 3000 });
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await page.waitForURL('**ver=lista');
    await page.locator('[aria-label="Forma de ver"] [aria-pressed="true"]', { hasText: 'Lista' }).waitFor({ timeout: 3000 });
    return 'setas, Home/End e volta nas pontas; Tab → Lista → Quadro; Espaço e Enter trocam a forma';
  });

  /* ───────────── F05 do plano UX: a busca pessoal com alcance dito ───────────── */

  const campo = (page) => page.getByRole('searchbox', { name: 'Buscar nas tarefas carregadas' });
  const resultado = (page) => page.locator('.iw-resultado p').evaluate((el) => el.textContent.trim());
  const paramsDe = (page) => Object.fromEntries(new URL(page.url()).searchParams);

  await cenario('F05-1', 'busca com acento/caixa no LOTE: alcance dito (lote ≠ total da aba), endereço por replace sem histórico por letra; Carregar mais amplia', async (abrir) => {
    const { page } = await abrir({ custom: servidorPaginado() });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
    const historico = await page.evaluate(() => history.length);
    // Digitação letra a letra, com acento e caixa que o dado não tem.
    await campo(page).pressSequentially('PENDÊNTE 24', { delay: 40 });
    await page.waitForFunction(() => new URL(location.href).searchParams.get('busca') === 'PENDÊNTE 24', null, { timeout: 4000 });
    assert.equal(await page.evaluate(() => history.length), historico, 'nenhuma entrada de histórico por letra (replace)');
    assert.deepEqual(await titulos(page), ['Pendente 24'], 'acha sem acento e sem caixa, só no lote');
    assert.equal(await resultado(page), '1 encontrada nas 100 carregadas, de 250 em Pendente. Carregue mais para ampliar a busca.');
    assert.equal(await abaTexto(page, 'Pendente'), 'Pendente250', 'a contagem da aba é do banco, não do achado');
    assert.equal(await corteTexto(page), '100 de 250 Carregar mais', 'Carregar mais continua, com o cursor');
    await carregarMais(page).click();
    await page.locator('.mt-corte', { hasText: '200 de 250' }).waitFor();
    await carregarMais(page).click();
    await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length === 11);
    assert.equal(await resultado(page), '11 encontradas nas 250 de Pendente.', 'lote inteiro: o alcance é a aba');
    assert.equal(await abaTexto(page, 'Pendente'), 'Pendente250');
    // Todos os grupos vazios somem com filtro — "Nada para hoje" seria falso.
    assert.equal(await page.getByText('Nada para hoje.', { exact: true }).count(), 0);
    return `histórico ${historico} → ${await page.evaluate(() => history.length)}; 1 no lote de 100 → 11 no de 250`;
  });

  await cenario('F05-2', '"Nenhuma correspondência" ≠ sem tarefas: Limpar busca, Carregar mais presente, passagem para Todas com o texto e aviso de alcance; voltar devolve a busca', async (abrir) => {
    const pedidosTodas = [];
    const { page } = await abrir({
      custom: servidorPaginado(async (url) => {
        if (url.pathname === '/api/board/all-tasks') {
          pedidosTodas.push(url.searchParams.get('busca'));
          return { body: { ok: true, work: { rows: [], total: 1768, matched: 0, capped: false, assigneeOptions: [], unassignedTasks: 0 } } };
        }
        return null;
      }),
    });
    await page.goto(BASE + '/meu-trabalho?busca=x%C3%ADcara');
    await page.getByText('Nenhuma correspondência nas tarefas carregadas', { exact: true }).waitFor();
    assert.equal(await campo(page).inputValue(), 'xícara', 'o endereço devolve o texto na caixa');
    assert.equal(await page.getByText('Você não tem', { exact: false }).count(), 0);
    assert.equal(await page.locator('.mt-linha').count(), 0);
    assert.equal(await corteTexto(page), '100 de 250 Carregar mais', 'sem correspondência, o cursor continua oferecido');
    assert.equal(await abaTexto(page, 'Pendente'), 'Pendente250');
    // A passagem para a busca geral, com o texto, e o aviso de que o alcance mudou.
    await page.getByRole('link', { name: 'Buscar em Todas as tarefas' }).click();
    await page.waitForURL('**/tarefas?busca=x%C3%ADcara');
    await page.locator('.iw-alcance').waitFor();
    assert.match(await page.locator('.iw-alcance').textContent(), /todas as tarefas ao seu alcance/);
    assert.equal(await page.getByRole('textbox', { name: 'Buscar tarefa pelo nome' }).inputValue(), 'xícara');
    await page.getByText('Nenhuma tarefa com este filtro', { exact: true }).waitFor();
    assert.ok(pedidosTodas.includes('xícara'), `a consulta geral levou o texto: ${JSON.stringify(pedidosTodas)}`);
    // VOLTAR devolve a busca pessoal.
    await page.goBack();
    await page.waitForURL('**/meu-trabalho?busca=x%C3%ADcara');
    await page.getByText('Nenhuma correspondência nas tarefas carregadas', { exact: true }).waitFor();
    assert.equal(await campo(page).inputValue(), 'xícara');
    // Limpar busca: volta a lista, e o endereço fica limpo.
    await page.getByRole('button', { name: 'Limpar busca', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length === 100);
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('busca'));
    return `todas pediu ${JSON.stringify(pedidosTodas)}; voltar e limpar ok`;
  });

  await cenario('F05-3', 'trocar de aba conserva a busca e a reaplica no lote novo; a resposta atrasada da aba antiga não entra', async (abrir) => {
    const { page } = await abrir({
      custom: servidorPaginado(async (url) => {
        if (url.pathname === '/api/board/my-tasks' && url.searchParams.get('aba') === 'pendente') await pause(1200);
        return null;
      }),
    });
    await page.goto(BASE + '/meu-trabalho?ver=quadro&busca=feita%201');
    await page.getByText('Carregando…', { exact: true }).waitFor();
    // Troca ANTES de a primeira página de Pendente chegar.
    await page.getByRole('tab', { name: /^Feito/ }).click();
    await page.waitForURL((u) => u.searchParams.get('aba') === 'feito');
    assert.deepEqual(paramsDe(page), { ver: 'quadro', busca: 'feita 1', aba: 'feito' }, 'aba nova, busca e forma juntas');
    await page.getByRole('link', { name: 'Feita 1', exact: true }).waitFor();
    await pause(1500); // a resposta de Pendente chega agora, atrasada
    assert.deepEqual(await titulos(page), ['Feita 1'], 'nada de Pendente entrou, e a busca foi reaplicada');
    assert.equal(await campo(page).inputValue(), 'feita 1');
    assert.equal(await resultado(page), '1 encontrada nas 3 de Feito.');
    assert.equal(await forma(page, 'Kanban').getAttribute('aria-pressed'), 'true');
    // Digitar e trocar de aba no mesmo instante: a busca pendente não se perde.
    await campo(page).fill('');
    await campo(page).pressSequentially('pend', { delay: 20 });
    await page.getByRole('tab', { name: /^Pendente/ }).click();
    await page.waitForURL((u) => u.searchParams.get('aba') === 'pendente' && u.searchParams.get('busca') === 'pend', { timeout: 4000 });
    await page.getByRole('link', { name: 'Pendente 0', exact: true }).waitFor({ timeout: 5000 });
    return JSON.stringify(paramsDe(page));
  });

  await cenario('F05-4', 'abrir uma tarefa logo depois de digitar e voltar: busca, aba e forma conservadas; F5 idem', async (abrir) => {
    const { page } = await abrir({ custom: servidorPaginado() });
    await page.goto(BASE + '/meu-trabalho?aba=pendente&ver=lista');
    await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
    await campo(page).pressSequentially('pendente 7', { delay: 20 });
    // Sem esperar a gravação atrasada: o clique vem logo em seguida.
    await page.getByRole('link', { name: 'Pendente 77', exact: true }).click();
    await page.waitForURL('**/tarefa/p77');
    await esperarTitulo(page, 'Pendente 77');
    // F43, Fase 7: a ficha abriu AO LADO. A busca gravada no mesmo gesto do
    // clique (o foco saiu da caixa) tem de estar ATRÁS do painel também — a
    // lista de trás não pode perder o filtro ao abrir o card.
    await pause(400);
    const atras = await page.evaluate(() => [...document.querySelectorAll('a[href^="/tarefa/"]')].filter((a) => !a.closest('[data-painel-lateral]')).length);
    assert.equal(atras, 11, 'atrás do painel, a lista continua com a busca');
    await fecharFicha(page).click();
    await page.waitForURL('**/meu-trabalho?**');
    await page.getByRole('link', { name: 'Pendente 77', exact: true }).waitFor({ timeout: 5000 });
    assert.deepEqual(paramsDe(page), { aba: 'pendente', ver: 'lista', busca: 'pendente 7' });
    assert.equal(await campo(page).inputValue(), 'pendente 7');
    assert.equal((await titulos(page)).length, 11, 'Pendente 7 e 70–79 no lote de 100');
    await page.reload();
    await page.getByRole('link', { name: 'Pendente 77', exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await campo(page).inputValue(), 'pendente 7');
    assert.equal(await page.getByRole('tab', { name: /^Pendente/ }).getAttribute('aria-selected'), 'true');
    assert.equal(await forma(page, 'Lista').getAttribute('aria-pressed'), 'true');
    return JSON.stringify(paramsDe(page));
  });

  await cenario('F05-5', '390 × 844, cenário normal (prazos de hoje, atraso, próximos e sem data): primeira tarefa antes de 40% da altura, sem rolagem lateral', async (abrir) => {
    const { page } = await abrir({
      viewport: { width: 390, height: 844 },
      custom: servidorPaginado(async (url) => {
        if (url.pathname !== '/api/board/my-tasks') return null;
        const aba = url.searchParams.get('aba');
        const rows = aba === 'pendente' ? normais : [];
        return { body: { ok: true, work: { rows, total: 40, capped: false, aba, counts: { pendente: 40, feito: 0, delegado: 0 }, returned: rows.length, hasMore: false, nextCursor: null } } };
      }),
    });
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('tab', { name: /^Pendente\s*40$/ }).waitFor();
    const m = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/tarefa/"]').getBoundingClientRect();
      return { topo: Math.round(a.top), fracao: a.top / innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    assert.ok(m.fracao < 0.4, `primeira tarefa em ${m.topo}px (${(m.fracao * 100).toFixed(1)}%)`);
    assert.equal(m.sw, m.iw, 'sem rolagem lateral');
    // A forma virou ícones, mas o nome continua sendo a palavra.
    assert.equal(await forma(page, 'Lista').getAttribute('aria-pressed'), 'true');
    return `primeira tarefa em ${m.topo}px = ${(m.fracao * 100).toFixed(1)}% de 844`;
  });

  /* F06C (revisão de 28/09, R07): a aba toda vazia é UM estado com as saídas,
     e não quatro grupos "Nada…"; com tarefa, o agrupamento volta. */
  const F6C_CAPTURAS = process.env.F06C_CAPTURAS ?? '';
  const minhasSoDelegadas = servidorPaginado(async (url) => {
    if (url.pathname !== '/api/board/my-tasks') return null;
    const aba = url.searchParams.get('aba');
    const rows = aba === 'delegado' ? delegados : [];
    return { body: { ok: true, work: { rows, total: rows.length, capped: false, aba, counts: { pendente: 0, feito: 0, delegado: 1 }, returned: rows.length, hasMore: false, nextCursor: null } } };
  });
  for (const [largura, tema] of [[1440, 'claro'], [1440, 'escuro'], [390, 'claro'], [390, 'escuro']]) {
    await cenario(`F06C-minhas-vazia-${largura}-${tema}`, 'Pendente vazia: um estado só, com Ver delegadas e Todas as tarefas; Delegado com item volta aos grupos', async (abrir) => {
      const { page, erros } = await abrir({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, tema, custom: minhasSoDelegadas });
      await page.goto(BASE + '/meu-trabalho');
      const estado = page.locator('.iw-estado[data-estado="vazio"]');
      await estado.waitFor();
      assert.equal(await estado.locator('.iw-estado-titulo').innerText(), 'Nada pendente com você');
      assert.equal(await page.locator('.mt-grupo').count(), 0, 'nenhum grupo "Nada…" empilhado');
      assert.equal(await page.getByText('Nada para hoje').count(), 0);
      assert.equal(await estado.getByRole('link', { name: 'Todas as tarefas', exact: true }).getAttribute('href'), '/tarefas');
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, h: Math.round(document.querySelector('.iw-estado').getBoundingClientRect().height) }));
      assert.ok(m.sw <= m.iw, 'sem rolagem lateral');
      await pause(300);
      if (F6C_CAPTURAS) await page.screenshot({ path: `${F6C_CAPTURAS}/f06c-minhas-vazia-${largura}-${tema}.png` });
      // Em quadro, o mesmo estado (e nenhuma coluna vazia).
      await forma(page, 'Kanban').click();
      await estado.waitFor();
      assert.equal(await page.locator('.q-coluna').count(), 0, 'em quadro, também um estado só');
      // A saída leva à aba que tem algo, e ali os grupos voltam.
      await estado.getByRole('button', { name: 'Ver delegadas (1)' }).click();
      await page.getByRole('tab', { name: /^Delegado/ }).and(page.locator('[aria-selected="true"]')).waitFor();
      await forma(page, 'Lista').click();
      await page.locator('.mt-grupo').first().waitFor();
      assert.equal(await page.locator('.iw-estado[data-estado="vazio"]').count(), 0, 'com item, sem o estado vazio');
      assert.deepEqual(erros.filter((e) => !/validateDOMNesting|chat\/live|WebSocket/i.test(e)), []);
      return `estado com ${m.h}px de altura`;
    });
  }

  return resultados;
}
