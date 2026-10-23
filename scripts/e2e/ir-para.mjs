/**
 * "IR PARA…" (Ctrl + K) — F43, Fase 9, provado no Chrome real.
 *
 * A API é a do sistema inteiro com dados fictícios (`servidorUX`, a mesma da
 * varredura transversal): telas, a árvore de `lista-kanban` (espaço AGÊNCIA
 * TESTE, pastas TIME A e TIME B, listas Vídeos, Artes internas, Conteúdo mensal
 * e Avulsa) e uma sessão que alcança tudo.
 *
 *   IP1  Ctrl + K em Minhas tarefas abre a busca com o foco no campo; "plan" +
 *        Enter leva ao Planejamento, pelo roteador (sem recarregar a página).
 *   IP2  Esc fecha e o foco volta a quem abriu — o gatilho clicado, ou o link
 *        que tinha o foco quando a tecla foi apertada.
 *   IP3  O nome de uma lista leva ao quadro dela; ↓ escolhe a próxima opção
 *        (uma pasta); o clique também vai.
 *   IP4  "Procurar tarefas com …" leva a Todas as tarefas já filtrada.
 *   IP5  ⚠️ Ctrl + K DENTRO do editor rico NÃO abre a busca: a tecla é do
 *        editor, que abre o endereço do link.
 *   IP6  Com texto por salvar na ficha, ir pela busca passa pela guarda de
 *        saída ("Sair sem salvar?"), como a barra.
 *   IP7  Celular (390, toque): o gatilho mora dentro da gaveta; a janela cabe
 *        na tela, sem rolagem lateral, e o toque na opção navega.
 */

import assert from 'node:assert/strict';

import { BASE, abrirTarefaEditada, criarSuite, detail, janela, pause, row } from './comum.mjs';
import { servidorUX } from './fixtures-ux.mjs';
import { LK } from './lista-kanban.mjs';

const busca = (page) => page.getByRole('dialog', { name: 'Buscar ou ir para' });
const campo = (page) => page.getByRole('combobox', { name: 'Buscar telas, clientes e listas' });
const ativa = (page) => page.locator('[role="option"][aria-selected="true"]');
const gatilho = (page) => page.getByRole('button', { name: 'Buscar ou ir para…', exact: true });

/** A tela pronta: o `<h1>` do topo com texto. */
const esperarTela = (page, titulo) =>
  page.getByRole('heading', { level: 1, name: titulo, exact: true }).waitFor({ timeout: 15_000 });

/**
 * A tela NOVA montada, e não só o endereço trocado. O roteador troca o
 * endereço na hora e, na primeira visita a uma tela carregada sob demanda,
 * deixa a tela de antes à vista até o pedaço novo chegar — uma busca aberta
 * nesse meio-tempo seria a da tela que está saindo, e sumiria com ela.
 */
const esperarTitulo = (page, trecho) =>
  page.waitForFunction(
    (t) => [...document.querySelectorAll('h1')].some((h) => h.getBoundingClientRect().height > 0 && h.textContent.includes(t)),
    trecho,
    { timeout: 15_000 },
  );

/** O foco está no campo da busca? */
const focoNoCampo = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox');

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('IP1', 'Ctrl+K em Minhas tarefas abre a busca; "plan" + Enter leva ao Planejamento pelo roteador', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/meu-trabalho');
    await esperarTela(page, 'Minhas tarefas');
    // Marca a página: um recarregamento inteiro apagaria a marca.
    await page.evaluate(() => { window.__semRecarregar = true; });
    await page.locator('body').click({ position: { x: 900, y: 500 } });
    await page.keyboard.press('Control+k');
    await busca(page).waitFor();
    assert.ok(await focoNoCampo(page), 'o foco nasce no campo');
    // Vazio: a lista das telas, na ordem da barra.
    assert.match((await ativa(page).textContent()) ?? '', /^Notificações/);
    assert.equal(await page.getByRole('option', { name: 'Planejamento', exact: true }).count(), 1);
    await page.keyboard.type('plan');
    await page.waitForFunction(() => document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.startsWith('Planejamento'));
    // O campo aponta para a ativa (`aria-activedescendant`).
    const apontada = await campo(page).getAttribute('aria-activedescendant');
    assert.equal(await page.evaluate((id) => document.getElementById(id)?.getAttribute('aria-selected'), apontada), 'true');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname === '/planejamento', null, { timeout: 10_000 });
    await busca(page).waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__semRecarregar === true), true, 'navegou pelo roteador, sem recarregar');
    assert.deepEqual(erros.filter((e) => !/chat\/live|WebSocket|Failed to load resource|401|503/i.test(e)), []);
  });

  await cenario('IP2', 'Esc fecha e devolve o foco: ao gatilho clicado, e ao link focado quando Ctrl+K foi apertado', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/meu-trabalho');
    await esperarTela(page, 'Minhas tarefas');
    await gatilho(page).click();
    await busca(page).waitFor();
    assert.ok(await focoNoCampo(page));
    assert.equal(await gatilho(page).getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    await busca(page).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.classList.contains('bl-ir'));
    assert.equal(await gatilho(page).getAttribute('aria-expanded'), 'false');

    // Pelo teclado, a partir do `Início`: Ctrl+K, Esc, e o foco volta para ele.
    const inicio = page.locator('a.bl-inicio');
    await inicio.focus();
    await page.keyboard.press('Control+k');
    await busca(page).waitFor();
    await page.keyboard.type('xyz');
    await page.keyboard.press('Escape');
    await busca(page).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.classList.contains('bl-inicio'));
    assert.equal(new URL(page.url()).pathname, '/meu-trabalho', 'Esc não navega');

    // Reabrir começa do zero, e Ctrl+K com a busca aberta a fecha.
    await page.keyboard.press('Control+k');
    await busca(page).waitFor();
    assert.equal(await campo(page).inputValue(), '');
    await page.keyboard.press('Control+k');
    await busca(page).waitFor({ state: 'hidden' });
  });

  await cenario('IP3', 'o nome de uma lista leva ao quadro dela; ↓ escolhe a próxima; o clique também vai', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/meu-trabalho');
    await esperarTela(page, 'Minhas tarefas');
    await page.keyboard.press('Control+k');
    await busca(page).waitFor();
    await page.keyboard.type('avulsa');
    await page.waitForFunction(() => document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.startsWith('Avulsa'));
    assert.match((await ativa(page).textContent()) ?? '', /Lista · AGÊNCIA TESTE/);
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.pathname === `/quadro/${id}`, LK.l4, { timeout: 10_000 });
    await esperarTitulo(page, 'Avulsa');

    // ↓: "time" acha TIME A e TIME B (pastas) — a seta passa à segunda.
    await page.keyboard.press('Control+k');
    await busca(page).waitFor();
    await page.keyboard.type('time');
    await page.waitForFunction(() => document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.startsWith('TIME A'));
    await page.keyboard.press('ArrowDown');
    assert.match((await ativa(page).textContent()) ?? '', /^TIME B/);
    // ↑ do primeiro dá a volta até o último: a busca de tarefas.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.match((await ativa(page).textContent()) ?? '', /^Procurar tarefas com “time”/);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.pathname === `/quadro/pasta/${id}`, LK.timeB, { timeout: 10_000 });
    await esperarTitulo(page, 'TIME B');

    // O clique: "cal" e o Calendário.
    await gatilho(page).click();
    await busca(page).waitFor();
    await page.keyboard.type('cal');
    await page.getByRole('option', { name: 'Calendário', exact: true }).click();
    // F43 Fase 4: o Calendário mora no Planejamento (a busca usa o destino da barra).
    await page.waitForFunction(
      () => location.pathname === '/planejamento' && new URLSearchParams(location.search).get('visao') === 'calendario',
      null,
      { timeout: 10_000 },
    );
    await busca(page).waitFor({ state: 'hidden' });
  });

  await cenario('IP4', '"Procurar tarefas com …" leva a Todas as tarefas filtrada pelo texto', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/meu-trabalho');
    await esperarTela(page, 'Minhas tarefas');
    await page.keyboard.press('Control+k');
    await busca(page).waitFor();
    await page.keyboard.type('depoimento');
    const procurar = page.getByRole('option', { name: /^Procurar tarefas com “depoimento”/ });
    await procurar.waitFor();
    await procurar.click();
    await page.waitForFunction(() => location.pathname === '/tarefas', null, { timeout: 10_000 });
    assert.equal(new URL(page.url()).searchParams.get('busca'), 'depoimento');
    await esperarTela(page, 'Todas as tarefas');
    assert.equal(await page.getByRole('textbox', { name: 'Buscar tarefa pelo nome' }).inputValue(), 'depoimento');
  });

  await cenario('IP5', '⚠️ Ctrl+K dentro do editor rico NÃO abre a busca — a tecla é do editor (endereço do link)', async (abrir) => {
    const { page } = await abrir({
      custom: (url) =>
        url.pathname.startsWith('/api/board/tasks/')
          ? { body: { ok: true, task: { ...detail, id: row.id, description: 'Texto para virar link' }, storage: { ready: false, variable: '' } } }
          : null,
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(`${BASE}/tarefa/${row.id}`);
    const editor = page.getByRole('textbox', { name: 'Descrição da tarefa', exact: true });
    await editor.waitFor();
    await editor.evaluate((el) => {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
    });
    await page.keyboard.press('Control+k');
    // O editor abre o endereço do link…
    await page.getByRole('textbox', { name: 'Endereço do link', exact: true }).waitFor({ timeout: 5000 });
    // …e a busca não abriu.
    await pause(300);
    assert.equal(await busca(page).count(), 0, 'a busca não abriu dentro do editor');
    // Fora do editor, na mesma tela, a tecla volta a ser da busca.
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+k');
    await busca(page).waitFor();
  });

  await cenario('IP6', 'com texto por salvar, ir pela busca passa pela guarda de saída (Sair sem salvar?)', async (abrir) => {
    const { page, writes } = await abrir({ viewport: { width: 1440, height: 900 } });
    await abrirTarefaEditada(page);
    const ficha = new URL(page.url()).pathname;
    // No título a tecla é do campo: tira o foco dele antes.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+k');
    await busca(page).waitFor();
    await page.keyboard.type('plan');
    await page.waitForFunction(() => document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.startsWith('Planejamento'));
    await page.keyboard.press('Enter');
    await janela(page).waitFor();
    assert.equal(await busca(page).count(), 0, 'a busca fechou antes da pergunta');
    assert.equal(new URL(page.url()).pathname, ficha, 'a guarda segurou a saída');
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).pathname, ficha);
    assert.equal(writes.length, 0, 'nada gravado sem pedir');
  });

  await cenario('IP7', 'celular 390 (toque): o gatilho mora na gaveta, a janela cabe sem rolagem lateral e o toque navega', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 390, height: 844 }, toque: true });
    await page.goto(BASE + '/meu-trabalho');
    await esperarTela(page, 'Minhas tarefas');
    await page.getByRole('button', { name: 'Listas e atalhos' }).tap();
    await page.locator('.bl-barra[data-gaveta="aberta"]').waitFor();
    const caixa = await gatilho(page).boundingBox();
    assert.ok(caixa && caixa.height >= 40, `alvo de toque do gatilho: ${JSON.stringify(caixa)}`);
    await gatilho(page).tap();
    await busca(page).waitFor();
    const medida = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Buscar ou ir para"]').getBoundingClientRect();
      return { esquerda: d.left, direita: d.right, largura: innerWidth, lateral: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(medida.esquerda >= 0 && medida.direita <= medida.largura, `a janela cabe: ${JSON.stringify(medida)}`);
    assert.ok(medida.lateral <= 0, `sem rolagem lateral: ${JSON.stringify(medida)}`);
    await campo(page).fill('plan');
    await page.getByRole('option', { name: 'Planejamento', exact: true }).tap();
    await page.waitForFunction(() => location.pathname === '/planejamento', null, { timeout: 10_000 });
    await busca(page).waitFor({ state: 'hidden' });
  });

  return resultados;
}
