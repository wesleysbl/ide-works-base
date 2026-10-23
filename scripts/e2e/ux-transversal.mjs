/**
 * A VARREDURA TRANSVERSAL — F16 do plano UX (homologar a versão integrada).
 *
 * O que se prova aqui, no Chrome, com a API interceptada (`fixtures-ux.mjs`,
 * dados fictícios, nada sai para a rede):
 *
 *   UT1  Barra por TECLADO (1440): cada destino da barra e do menu da conta é
 *        alcançado com Tab, tem foco visível e abre com Enter; a tela nova tem
 *        título, estilos carregados e nenhuma rolagem lateral.
 *   UT2  Gaveta por TOQUE (390, touch): "Listas e atalhos" abre a gaveta, o
 *        toque no destino navega e fecha a gaveta; mesma conferência da tela.
 *   UT3  Estilos DEPOIS da navegação: indo de tela em tela pela barra (sem
 *        recarregar), a folha própria de cada família está aplicada — não
 *        basta a captura da primeira rota.
 *   UT4…UT10  As 27 ROTAS DIRETAS em 320, 390, 640 (equivalente a 1280 com
 *        zoom de 200%), 768, 1024, 1440 e 1920, claro e escuro alternados:
 *        título visível, tema aplicado, sem rolagem lateral do documento,
 *        sem erro de página.
 *
 * Quadros e tabelas rolam na horizontal DENTRO da região deles (decisão do
 * plano); o que se mede é o documento.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, pause } from './comum.mjs';
import { ROTAS, semSessao, servidorUX } from './fixtures-ux.mjs';

/** Ruído conhecido do ambiente (tempo real desligado, 401 da sessão ausente). */
const errosReais = (erros) =>
  erros.filter((e) => !/chat\/live|WebSocket|Failed to load resource|401|503|validateDOMNesting/i.test(e));

/** A tela pronta: um `<h1>` com texto, e nada de "carregando" no lugar dele. */
async function esperarTela(page) {
  await page.waitForFunction(
    () => {
      const h = [...document.querySelectorAll('h1')].find((x) => x.getBoundingClientRect().height > 0);
      // Na entrada o <h1> é a marca: o nome está no `aria-label` da imagem dentro dele.
      return Boolean(h && (h.textContent.trim() || h.getAttribute('aria-label') || h.querySelector('[aria-label]')));
    },
    null,
    { timeout: 15_000 },
  );
}

/** Ponto de partida das travessias: a ficha, cujo título não é o de nenhum destino. */
const PARTIDA = '/tarefa/t-ux-1';

/**
 * Chegou ao destino do `href` da barra? F43 Fase 4: o item Calendário leva a
 * `/planejamento?visao=calendario` — o caminho é o do Planejamento, e é a
 * consulta que diz a visão. Com consulta no `href`, compara caminho e
 * consulta; sem, só o caminho (como sempre: a tela pode acrescentar a dela).
 */
const chegouEm = (page, href) =>
  page.waitForFunction(
    (h) => (h.includes('?') ? location.pathname + location.search === h : location.pathname === h),
    href,
    { timeout: 10_000 },
  );

/** Depois de navegar: o `<h1>` da tela anterior precisa ter saído. */
const esperarTrocaDeTitulo = (page, anterior) =>
  page.waitForFunction(
    (a) => {
      const h = [...document.querySelectorAll('h1')].find((x) => x.getBoundingClientRect().height > 0);
      const t = (h?.textContent || h?.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim();
      return t !== '' && t !== a;
    },
    anterior,
    { timeout: 10_000 },
  );

const tituloAtual = (page) =>
  page.evaluate(() => [...document.querySelectorAll('h1')].find((x) => x.getBoundingClientRect().height > 0)?.textContent?.trim() ?? '');

/** O que toda tela precisa ter depois de aberta. */
async function conferirTela(page) {
  return page.evaluate(() => {
    const raiz = getComputedStyle(document.documentElement);
    const h1 = [...document.querySelectorAll('h1')].find((x) => x.getBoundingClientRect().height > 0);
    const fonte = h1 ? getComputedStyle(h1).fontFamily : '';
    return {
      rolagemLateral: document.documentElement.scrollWidth - window.innerWidth,
      // A régua de espaço vem de `acabamento.css`: sem ela, a folha não carregou.
      tokens: raiz.getPropertyValue('--iw-e-4').trim() !== '' && raiz.getPropertyValue('--ink-0').trim() !== '',
      fonteDoTitulo: fonte,
      fundo: getComputedStyle(document.body).backgroundColor,
      tema: document.documentElement.dataset.tema ?? null,
      titulo: (h1?.textContent || h1?.getAttribute('aria-label') || h1?.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim().slice(0, 60),
    };
  });
}

/** Foco visível: contorno com largura, ou anel por sombra. */
const focoVisivel = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const s = getComputedStyle(el);
    const contorno = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    const anel = s.boxShadow && s.boxShadow !== 'none';
    return contorno || anel;
  });

/** A folha própria de cada família: um elemento e uma propriedade que só ela dá. */
const FOLHA_DA_FAMILIA = {
  '/painel': ['.pn-carteira', 'display', 'grid'],
  // F43 Fase 4: o item Calendário da barra leva à visão Calendário do
  // Planejamento; a folha do calendário (`.cal-grade`) continua a prova.
  '/planejamento?visao=calendario': ['.cal-grade', 'display', 'grid'],
  '/chat': ['.ch-grade', 'display', 'grid'],
  '/meta': ['.mm-filtros', 'display', 'flex'],
  '/pessoas': ['.ad-lista', 'list-style-type', 'none'],
};

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  /* ─────────────── UT1 — a barra inteira pelo teclado ─────────────── */

  await cenario('UT1', 'barra e menu da conta por teclado (1440): foco visível, Enter navega, tela com estilos e sem rolagem lateral', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + PARTIDA);
    await esperarTela(page);
    const destinos = await page.$$eval('nav a.bl-item[href], .bl-barra a.bl-item[href]', (as) =>
      [...new Set(as.filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('href')))],
    );
    assert.ok(destinos.length >= 6, `a barra mostra os destinos (${destinos.join(', ')})`);
    const feitos = [];
    for (const href of destinos) {
      await page.goto(BASE + PARTIDA);
      await esperarTela(page);
      const deOnde = await tituloAtual(page);
      // Tab até o link deste destino, a partir do começo da página.
      let achou = false;
      await page.locator('body').focus();
      for (let i = 0; i < 120 && !achou; i++) {
        await page.keyboard.press('Tab');
        achou = await page.evaluate((h) => document.activeElement?.matches?.(`a.bl-item[href="${h}"]`) ?? false, href);
      }
      assert.ok(achou, `o Tab alcança ${href}`);
      assert.ok(await focoVisivel(page), `${href}: o foco é visível`);
      await page.keyboard.press('Enter');
      await chegouEm(page, href);
      await esperarTrocaDeTitulo(page, deOnde);
      const t = await conferirTela(page);
      assert.ok(t.tokens, `${href}: tokens da folha carregados`);
      assert.ok(t.rolagemLateral <= 0, `${href}: rolagem lateral de ${t.rolagemLateral}px`);
      feitos.push(`${href} "${t.titulo}"`);
    }

    // O menu da conta: Pessoas, Catálogos, Meta e o que mais a sessão alcança.
    await page.goto(BASE + PARTIDA);
    await esperarTela(page);
    const chip = page.locator('button[aria-haspopup="menu"][aria-label^="Sua conta"]');
    await chip.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await menu.waitFor();
    const itens = await menu.locator('a[role="menuitem"][href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    assert.ok(itens.includes('/pessoas') && itens.includes('/meta'), `o menu da conta tem as telas de área (${itens.join(', ')})`);
    await page.keyboard.press('Escape');
    for (const href of itens) {
      await page.goto(BASE + PARTIDA);
      await esperarTela(page);
      const deOnde = await tituloAtual(page);
      await chip.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menu').waitFor();
      // O menu leva o foco ao primeiro item num efeito: seta antes disso cai no chip.
      await page.waitForFunction(() => document.activeElement?.closest?.('[role="menu"]') != null);
      let achou = false;
      for (let i = 0; i < 12 && !achou; i++) {
        achou = await page.evaluate((h) => document.activeElement?.getAttribute?.('href') === h, href);
        if (!achou) await page.keyboard.press('ArrowDown');
      }
      assert.ok(achou, `as setas alcançam ${href} no menu`);
      assert.ok(await focoVisivel(page), `${href} (menu): o foco é visível`);
      await page.keyboard.press('Enter');
      await page.waitForFunction((p) => location.pathname === p, href, { timeout: 10_000 });
      await esperarTrocaDeTitulo(page, deOnde);
      const t = await conferirTela(page);
      assert.ok(t.rolagemLateral <= 0, `${href}: rolagem lateral de ${t.rolagemLateral}px`);
      feitos.push(`${href} "${t.titulo}"`);
    }
    assert.deepEqual(errosReais(erros), [], 'nenhum erro de página');
    return `${feitos.length} destinos por teclado: ${feitos.join(' · ')}`;
  });

  /* ─────────────── UT2 — a gaveta pelo toque ─────────────── */

  await cenario('UT2', 'gaveta por toque (390): abrir, tocar o destino, a gaveta fecha e a tela abre sem rolagem lateral', async (abrir) => {
    const s = await abrir({ custom: servidorUX(), viewport: { width: 390, height: 844 } });
    // Contexto de toque de verdade: `hasTouch` exige um contexto próprio.
    await s.context.close();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const servidor = servidorUX();
    const { respostaPadrao } = await import('./comum.mjs');
    await context.route('**/api/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const r = await servidor(url, req);
      await route
        .fulfill({ status: r?.status ?? 200, contentType: 'application/json', body: JSON.stringify(r?.body ?? respostaPadrao(url, req)) })
        .catch(() => {});
    });
    try {
      const page = await context.newPage();
      const erros = [];
      page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
      await page.goto(BASE + PARTIDA);
      await esperarTela(page);
      const abrirGaveta = page.getByRole('button', { name: 'Listas e atalhos' });
      await abrirGaveta.tap();
      await page.locator('.bl-barra[data-gaveta="aberta"]').waitFor();
      const destinos = await page.$$eval('.bl-barra a.bl-item[href]', (as) =>
        [...new Set(as.filter((a) => a.getBoundingClientRect().width > 0).map((a) => a.getAttribute('href')))],
      );
      assert.ok(destinos.length >= 6, `a gaveta mostra os destinos (${destinos.join(', ')})`);
      const feitos = [];
      for (const href of destinos) {
        if ((await page.locator('.bl-barra[data-gaveta="aberta"]').count()) === 0) {
          await abrirGaveta.tap();
          await page.locator('.bl-barra[data-gaveta="aberta"]').waitFor();
        }
        const deOnde = await tituloAtual(page);
        const link = page.locator(`.bl-barra a.bl-item[href="${href}"]:visible`).first();
        const caixa = await link.boundingBox();
        assert.ok(caixa && caixa.height >= 40, `${href}: alvo de toque com ${caixa?.height}px de altura`);
        await link.tap();
        await chegouEm(page, href);
        await esperarTrocaDeTitulo(page, deOnde);
        // Fechada, a barra sai da tela (não fica "visível"): espera o atributo.
        await page.waitForFunction(() => document.querySelector('.bl-barra')?.dataset.gaveta === 'fechada');
        await esperarTela(page);
        const t = await conferirTela(page);
        assert.ok(t.rolagemLateral <= 0, `${href}: rolagem lateral de ${t.rolagemLateral}px`);
        feitos.push(`${href} "${t.titulo}"`);
        await page.goto(BASE + PARTIDA);
        await esperarTela(page);
        await abrirGaveta.tap();
        await page.locator('.bl-barra[data-gaveta="aberta"]').waitFor();
      }
      assert.deepEqual(errosReais(erros), [], 'nenhum erro de página');
      return `${feitos.length} destinos por toque: ${feitos.join(', ')}`;
    } finally {
      await context.close().catch(() => {});
    }
  });

  /* ─────────────── UT3 — estilos depois de navegar ─────────────── */

  await cenario('UT3', 'estilos de cada família aplicados depois de navegar pela barra (sem recarregar)', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/meu-trabalho');
    await esperarTela(page);
    const feitos = [];
    const irPelaBarra = async (href) => {
      await page.locator(`a.bl-item[href="${href}"]:visible`).first().click();
      await chegouEm(page, href);
      await esperarTela(page);
    };
    const irPeloMenu = async (href) => {
      await page.locator('button[aria-haspopup="menu"][aria-label^="Sua conta"]').click();
      await page.getByRole('menu').locator(`a[href="${href}"]`).click();
      await page.waitForFunction((p) => location.pathname === p, href);
      await esperarTela(page);
    };
    for (const [href, [seletor, prop, valor]] of Object.entries(FOLHA_DA_FAMILIA)) {
      if (['/meta', '/pessoas'].includes(href)) await irPeloMenu(href);
      else await irPelaBarra(href);
      await page.locator(seletor).first().waitFor({ timeout: 10_000 });
      const lido = await page.locator(seletor).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
      assert.equal(lido, valor, `${href}: ${seletor} { ${prop} } = ${lido} (a folha da família não carregou?)`);
      feitos.push(`${href} ${seletor}=${lido}`);
    }
    assert.deepEqual(errosReais(erros), [], 'nenhum erro de página');
    return feitos.join(' · ');
  });

  /* ─────────────── UT4…UT10 — as 27 rotas em cada largura ─────────────── */

  const LARGURAS = [
    { id: 'UT4', largura: 320, altura: 640, tema: 'claro' },
    { id: 'UT5', largura: 390, altura: 844, tema: 'escuro' },
    { id: 'UT6', largura: 640, altura: 450, tema: 'claro', nota: 'equivale a 1280 × 900 com zoom de 200%' },
    { id: 'UT7', largura: 768, altura: 900, tema: 'escuro' },
    { id: 'UT8', largura: 1024, altura: 768, tema: 'claro' },
    { id: 'UT9', largura: 1440, altura: 900, tema: 'escuro' },
    { id: 'UT10', largura: 1920, altura: 1080, tema: 'claro' },
  ];

  for (const { id, largura, altura, tema, nota } of LARGURAS) {
    await cenario(id, `as ${ROTAS.length} rotas diretas a ${largura}×${altura}, tema ${tema}${nota ? ` (${nota})` : ''}: título, tema, sem rolagem lateral, sem erro`, async (abrir) => {
      const viewport = { width: largura, height: altura };
      const autenticado = await abrir({ custom: servidorUX(), viewport, tema });
      const publico = await abrir({ custom: semSessao, viewport, tema });
      const problemas = [];
      for (const r of ROTAS) {
        const { page, erros } = r.publica ? publico : autenticado;
        const antes = erros.length;
        await page.goto(BASE + r.caminho);
        try {
          await esperarTela(page);
        } catch {
          problemas.push(`${r.rota}: sem título visível`);
          continue;
        }
        await pause(150);
        const t = await conferirTela(page);
        if (t.rolagemLateral > 0) problemas.push(`${r.rota}: rolagem lateral de ${t.rolagemLateral}px`);
        if (!t.tokens) problemas.push(`${r.rota}: tokens ausentes`);
        // A página do cliente (F42) tem o tema fixo da marca: `temaFixo`.
        if (t.tema !== (r.temaFixo ?? tema)) problemas.push(`${r.rota}: tema ${t.tema} ≠ ${r.temaFixo ?? tema}`);
        if (/Times/i.test(t.fonteDoTitulo)) problemas.push(`${r.rota}: título na fonte padrão (${t.fonteDoTitulo})`);
        const novos = errosReais(erros.slice(antes));
        if (novos.length) problemas.push(`${r.rota}: ${novos[0].slice(0, 120)}`);
      }
      assert.deepEqual(problemas, [], problemas.join('\n'));
      return `${ROTAS.length} rotas ok (${ROTAS.filter((r) => r.publica).length} sem sessão)`;
    });
  }

  return resultados;
}
