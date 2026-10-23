/**
 * A TELA DE ERRO DE ROTA NO NAVEGADOR — conferência de 09/10/2026.
 *
 * Uma tela que estoura ao desenhar fazia o roteador trocar o app INTEIRO pelo
 * "Unexpected Application Error!" dele, com a pilha crua e sem barra lateral.
 * O caso real: `/catalogos` lê `r.plans.length` e estoura quando a resposta
 * vem sem as listas (aqui, a resposta genérica da API simulada).
 *
 * O QUE SE PROVA
 *   TE1  a tela estourada vira a tela amigável: a barra lateral continua, os
 *        dois botões existem, o erro vai ao console e a página padrão sumiu.
 *   TE2  "Tentar de novo" desenha a tela outra vez (e relê a API) sem acrescentar
 *        passo ao histórico — com a resposta certa, a tela abre.
 *   TE3  a barra lateral da tela de erro funciona: leva a outra tela, e a tela
 *        de erro vai embora.
 *   TE4  falha de PEDAÇO (o `import()` da tela não baixou): outro texto, só a
 *        "Recarregar a página" — e ela, depois que o pedaço volta, abre a tela.
 *   TE5  numa rota PÚBLICA a tela de erro não monta a barra: ela não busca a
 *        árvore de quem pode não ter sessão, e nada redireciona para a entrada.
 *   TE6  se a própria barra lateral estoura dentro da tela de erro (árvore com
 *        forma inesperada), a tela de erro cai para a versão sem barra — nunca
 *        para a página padrão da biblioteca.
 *
 * API simulada (`comum.mjs`): nada chega ao banco.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, pause } from './comum.mjs';

/** A resposta de `/catalogs/manage` com a FORMA certa. */
const CATALOGOS = {
  ok: true,
  plans: [],
  categories: [{ id: 'c1', name: 'Ide', isDefault: true, sortOrder: 0, clientCount: 0 }],
  tags: [],
};

/** Sem as listas — a forma que estoura `Catalogos`. */
const CATALOGOS_QUEBRADO = { ok: true };

const titulo = (page) => page.getByRole('heading', { name: 'Esta tela não abriu', level: 1 });
const padraoDaBiblioteca = (page) => page.getByText('Unexpected Application Error', { exact: false });

export default async function rodar(browser) {
  const suite = criarSuite(browser);

  await suite.cenario('TE1', 'tela que estoura: tela amigável, barra lateral de pé, botões e log no console', async (abrir) => {
    const { page, erros } = await abrir({
      custom: (url) => (url.pathname === '/api/catalogs/manage' ? { body: CATALOGOS_QUEBRADO } : null),
    });
    await page.goto(BASE + '/catalogos');
    await titulo(page).waitFor();

    assert.equal(await padraoDaBiblioteca(page).count(), 0, 'a página padrão da biblioteca não pode aparecer');
    // Em desenvolvimento (é o servidor destes cenários) os detalhes técnicos existem, mas recolhidos.
    const detalhes = page.locator('.iw-erro-de-rota details');
    assert.equal(await detalhes.count(), 1);
    assert.equal(await detalhes.evaluate((d) => d.open), false, 'os detalhes técnicos vêm recolhidos');
    await page.getByRole('alert').getByText('Algo deu errado ao montar esta tela', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Recarregar a página', exact: true }).waitFor();

    // A moldura de navegação continua: a barra lateral está na tela, com o item Painel.
    await page.locator('.bl-barra').waitFor();
    await page.getByRole('navigation', { name: 'Entrega' }).getByRole('link', { name: 'Painel', exact: true }).waitFor();

    assert.ok(
      erros.some((e) => e.includes('[ide-works] A tela /catalogos falhou ao abrir')),
      'o erro precisa ir ao console com o caminho da tela; vi: ' + JSON.stringify(erros.slice(0, 4)),
    );
  });

  await suite.cenario('TE2', '"Tentar de novo" redesenha a tela e relê a API, sem passo novo no histórico', async (abrir) => {
    // Quebrada até a pessoa apertar o botão: o modo de desenvolvimento monta duas
    // vezes (StrictMode), então contar leituras para decidir a resposta seria
    // decidir pelo eco, e não pelo botão.
    let quebrado = true;
    let leiturasDepois = 0;
    const { page } = await abrir({
      custom(url) {
        if (url.pathname !== '/api/catalogs/manage') return null;
        if (!quebrado) leiturasDepois += 1;
        return { body: quebrado ? CATALOGOS_QUEBRADO : CATALOGOS };
      },
    });
    await page.goto(BASE + '/catalogos');
    await titulo(page).waitFor();
    const antes = await page.evaluate(() => ({ idx: history.state.idx, tamanho: history.length }));

    quebrado = false;
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();

    await page.getByRole('heading', { name: 'Catálogos', level: 1 }).waitFor();
    assert.equal(await titulo(page).count(), 0, 'a tela de erro saiu');
    assert.ok(leiturasDepois >= 1, 'a tela releu a API ao reerguer');
    assert.equal(new URL(page.url()).pathname, '/catalogos');
    const depois = await page.evaluate(() => ({ idx: history.state.idx, tamanho: history.length }));
    assert.deepEqual(depois, antes, 'o `replace` não acrescenta passo ao histórico');
  });

  await suite.cenario('TE2b', 'se a tela estoura de novo, a tela de erro volta — sem laço e sem tela em branco', async (abrir) => {
    const { page } = await abrir({
      custom: (url) => (url.pathname === '/api/catalogs/manage' ? { body: CATALOGOS_QUEBRADO } : null),
    });
    await page.goto(BASE + '/catalogos');
    await titulo(page).waitFor();
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await pause(400);
    await titulo(page).waitFor();
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).waitFor();
    assert.equal(await padraoDaBiblioteca(page).count(), 0);
  });

  await suite.cenario('TE3', 'a barra lateral da tela de erro leva a outra tela, e a de erro vai embora', async (abrir) => {
    const { page } = await abrir({
      custom: (url) => (url.pathname === '/api/catalogs/manage' ? { body: CATALOGOS_QUEBRADO } : null),
    });
    await page.goto(BASE + '/catalogos');
    await titulo(page).waitFor();

    await page.getByRole('navigation', { name: 'Entrega' }).getByRole('link', { name: 'Painel', exact: true }).click();
    await page.waitForURL('**/painel');
    await page.getByRole('heading', { name: 'Painel', level: 1 }).waitFor();
    assert.equal(await titulo(page).count(), 0);
    assert.equal(await padraoDaBiblioteca(page).count(), 0);
  });

  await suite.cenario('TE4', 'pedaço da tela que não baixou: pede a recarga, sem "Tentar de novo"; recarregar abre a tela', async (abrir) => {
    const { page, context } = await abrir({
      custom: (url) => (url.pathname === '/api/catalogs/manage' ? { body: CATALOGOS } : null),
    });
    let bloqueado = true;
    await context.route('**/src/pages/Catalogos.tsx*', (rota) => (bloqueado ? rota.abort() : rota.continue()));
    await page.goto(BASE + '/catalogos');
    await titulo(page).waitFor();

    await page.getByRole('alert').getByText('versão nova', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Tentar de novo', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Recarregar a página', exact: true }).waitFor();
    await page.locator('.bl-barra').waitFor();

    bloqueado = false;
    await page.getByRole('button', { name: 'Recarregar a página', exact: true }).click();
    await page.getByRole('heading', { name: 'Catálogos', level: 1 }).waitFor();
  });

  await suite.cenario('TE5', 'rota pública que estoura: tela de erro sem barra, sem chamada autenticada e sem ir para a entrada', async (abrir) => {
    const { page, context } = await abrir();
    const chamadas = [];
    await context.route('**/api/**', async (rota) => {
      chamadas.push(new URL(rota.request().url()).pathname);
      await rota.fallback();
    });
    await context.route('**/src/pages/Ativar.tsx*', (rota) => rota.abort());
    await page.goto(BASE + '/ativar');
    await titulo(page).waitFor();
    await pause(800); // tempo para um laço (barra → 401 → `/`) aparecer, se existisse

    assert.equal(new URL(page.url()).pathname, '/ativar', 'não pode redirecionar');
    assert.equal(await page.locator('.bl-barra').count(), 0, 'rota pública não monta a barra');
    // (`/api/auth/me` é do gerente do chat, que mora na moldura e já perguntava antes.)
    assert.deepEqual(
      chamadas.filter((c) => c.startsWith('/api/board/')),
      [],
      'a barra não pode buscar a árvore de quem pode não ter sessão; vi: ' + JSON.stringify(chamadas),
    );
    await page.getByRole('button', { name: 'Recarregar a página', exact: true }).waitFor();
  });

  await suite.cenario('TE6', 'a barra lateral que estoura dentro da tela de erro: cai para a versão sem barra', async (abrir) => {
    const { page } = await abrir({
      custom(url) {
        if (url.pathname === '/api/catalogs/manage') return { body: CATALOGOS_QUEBRADO };
        // A árvore que a barra lê, com a forma errada: a barra estoura ao desenhar.
        if (url.pathname.startsWith('/api/board/tree')) return { body: { ok: true, spaces: 5, companies: 7 } };
        return null;
      },
    });
    await page.goto(BASE + '/catalogos');
    await titulo(page).waitFor();
    await page.getByRole('button', { name: 'Recarregar a página', exact: true }).waitFor();
    assert.equal(await padraoDaBiblioteca(page).count(), 0, 'a página padrão da biblioteca não pode aparecer');
    assert.equal(await page.locator('.bl-barra').count(), 0, 'sem a barra que estourou');
  });

  return suite.resultados;
}
