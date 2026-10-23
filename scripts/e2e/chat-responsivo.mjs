/** F34: altura, navegação e respostas fora de ordem; toda a API é fictícia. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BASE, criarSuite } from './comum.mjs';
import { clicarNaRegua, criarEstado, GERAL, EU, msgSeed } from './chat.mjs';

const OUTRA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const resposta = (messages) => ({ body: { ok: true, messages, reactions: [] } });
const lote = (inicio, fim, id = GERAL) => Array.from({ length: fim - inicio }, (_, i) => ({
  ...msgSeed(`Mensagem ${inicio + i} — conteúdo para ler no histórico.`, new Date(Date.UTC(2026, 8, 25, 12, inicio + i)).toISOString()),
  conversationId: id,
}));
function estadoLongo() {
  const estado = criarEstado({ iniciais: lote(50, 100) });
  for (let i = 0; i < 36; i++) estado.conversasExtra.push({
    id: i === 0 ? OUTRA : randomUUID(), kind: 'group', name: i === 0 ? 'Outra conversa' : `Equipe ${i}`,
    archivedAt: null, lastMessage: null, unreadCount: 0, lastReadAt: null,
    myRole: 'owner', peerUserId: null, peerName: null, peerIsActive: null,
    members: [{ id: EU, name: 'Ana', role: 'owner', isActive: true }],
  });
  return estado;
}
async function abrirChat(abrir, viewport, custom) {
  const state = await abrir({ viewport, custom });
  await state.context.route('**/api/chat/live', (route) => route.abort());
  return state;
}
async function dimensoes(page) {
  return page.evaluate(() => {
    const caixa = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height } : null; };
    return {
      w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      fio: caixa('.ch-fio-wrap'), compositor: caixa('.ch-escrever'), cabeca: caixa('.ch-painel-cabeca'),
      lista: caixa('.ch-lista'), grade: caixa('.ch-grade'),
    };
  });
}
function cabe(m, conversa = true) {
  const contexto = JSON.stringify(m);
  assert.ok(m.sw <= m.w + 1 && m.sh <= m.h + 1, `sem scroll externo: ${contexto}`);
  assert.ok(m.grade.bottom <= m.h + 1, contexto);
  if (conversa) {
    assert.ok(m.fio.height > 25, `histórico tem área útil: ${contexto}`);
    assert.ok(m.compositor.bottom <= m.h && m.compositor.top >= m.cabeca.bottom, contexto);
  }
}
async function voltar(page) {
  await page.getByRole('link', { name: 'Voltar às conversas', exact: true }).click();
  await page.waitForURL(BASE + '/chat');
}

export default async function(browser) {
  const { cenario, resultados } = criarSuite(browser);
  for (const [width, height] of [[320, 640], [390, 844], [768, 900], [1440, 900], [390, 360], [768, 360]]) {
    await cenario(`F34-tela-${width}-${height}`, 'lista e histórico internos, compositor visível e membros sem esmagar', async (abrir) => {
      const estado = estadoLongo();
      const { page, erros } = await abrirChat(abrir, { width, height }, estado.handler);
      await page.goto(BASE + '/chat');
      await page.locator('.ch-item').first().waitFor();
      const lista = page.locator('.ch-lista-itens');
      assert.ok(await lista.evaluate((e) => e.scrollHeight > e.clientHeight));
      await lista.evaluate((e) => { e.scrollTop = 250; });
      assert.ok(await lista.evaluate((e) => e.scrollTop) > 0);
      assert.equal(await page.evaluate(() => scrollY), 0);
      if (width <= 720) {
        assert.equal(new URL(page.url()).pathname, '/chat');
        assert.equal(await page.locator('.ch-painel').isVisible(), false);
        cabe(await dimensoes(page), false);
        await page.screenshot({ path: `/tmp/ide-f34-lista-${width}-${height}.png` });
        await page.locator(`.ch-item[href='/chat/${GERAL}']`).click();
        await page.locator('.ch-lista').waitFor({ state: 'hidden' });
      } else await page.waitForURL(`${BASE}/chat/${GERAL}`);
      await page.locator('.c-fala').last().waitFor();
      await page.waitForTimeout(100);
      cabe(await dimensoes(page));
      const fio = page.locator('.ch-fio-wrap');
      await fio.evaluate((e) => { e.scrollTop = e.scrollHeight / 2; });
      const antes = await fio.evaluate((e) => e.scrollTop);
      await fio.hover();
      await page.mouse.wheel(0, -180);
      await page.waitForTimeout(150);
      assert.ok(await fio.evaluate((e) => e.scrollTop) < antes, 'roda move só o histórico');
      cabe(await dimensoes(page));
      const largura = (await dimensoes(page)).fio.right - (await dimensoes(page)).fio.left;
      await page.getByRole('button', { name: 'Membros', exact: true }).click();
      await page.locator('.ch-painel-grupo').waitFor();
      const membro = await page.locator('.ch-painel-grupo').boundingBox();
      assert.ok(membro.x >= 0 && membro.x + membro.width <= width);
      if (width < 1024) assert.equal((await dimensoes(page)).fio.right - (await dimensoes(page)).fio.left, largura);
      await page.getByRole('button', { name: 'Ocultar membros', exact: true }).click();
      await page.getByLabel('Escrever mensagem', { exact: true }).fill('Um rascunho longo\n'.repeat(30));
      cabe(await dimensoes(page));
      await page.getByLabel('Escrever mensagem', { exact: true }).fill('');
      await page.screenshot({ path: `/tmp/ide-f34-chat-${width}-${height}.png` });
      assert.deepEqual(erros.filter((e) => !/WebSocket.*chat\/live/i.test(e)), []);
      assert.equal(estado.envios.length, 0);
    });
  }

  await cenario('F34-navegacao', 'lista, outra conversa, histórico do navegador, link direto e indisponível', async (abrir) => {
    const estado = estadoLongo();
    const { page } = await abrirChat(abrir, { width: 390, height: 844 }, estado.handler);
    await page.goto(BASE + '/chat');
    await page.locator(`.ch-item[href='/chat/${GERAL}']`).click();
    await page.locator('.ch-fio-wrap').waitFor();
    await voltar(page);
    await page.locator(`.ch-item[href='/chat/${OUTRA}']`).click();
    await page.locator('.ch-painel-nome').getByText('Outra conversa', { exact: true }).waitFor();
    await page.goBack();
    assert.equal(new URL(page.url()).pathname, '/chat');
    await page.locator('.ch-lista').waitFor({ state: 'visible' });
    await page.goForward();
    assert.equal(new URL(page.url()).pathname, `/chat/${OUTRA}`);
    await page.locator('.ch-lista').waitFor({ state: 'hidden' });
    await page.goto(`${BASE}/chat/${GERAL}`);
    await page.locator('.c-fala').last().waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.ch-lista').waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.ch-lista').waitFor({ state: 'hidden' });
    estado.recusarConversa(OUTRA);
    await page.goto(`${BASE}/chat/${OUTRA}`);
    await page.getByText('Fora do seu alcance.').last().waitFor();
    await voltar(page);
    await page.locator('.ch-lista').waitFor({ state: 'visible' });
  });

  await cenario('F34-leitura-e-teclado', 'novas mensagens preservam leitura e janela visual reduzida mantém compositor', async (abrir) => {
    const estado = estadoLongo();
    const { page } = await abrirChat(abrir, { width: 390, height: 844 }, estado.handler);
    await page.goto(`${BASE}/chat/${GERAL}`);
    await page.locator('.c-fala').last().waitFor();
    const fio = page.locator('.ch-fio-wrap');
    await fio.evaluate((e) => { e.scrollTop = e.scrollHeight / 2; });
    await page.waitForTimeout(100);
    const antes = await fio.evaluate((e) => e.scrollTop);
    await page.evaluate((message) => window.dispatchEvent(new CustomEvent('ideworks:chat-live', {
      detail: { type: 'message_new', message },
    })), msgSeed('Mensagem que chegou durante a leitura', '2026-09-25T15:00:00.000Z'));
    await page.getByRole('button', { name: 'novas mensagens', exact: true }).waitFor();
    assert.ok(Math.abs(await fio.evaluate((e) => e.scrollTop) - antes) <= 2);
    await page.getByRole('button', { name: 'novas mensagens', exact: true }).click();
    assert.ok(await fio.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight) < 80);
    // Simula a janela visual que o teclado reduz sem redimensionar o layout.
    await page.getByLabel('Escrever mensagem', { exact: true }).focus();
    await page.evaluate(() => {
      Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => 400 });
      visualViewport.dispatchEvent(new Event('resize'));
    });
    const m = await dimensoes(page);
    assert.ok(m.compositor.bottom <= 400 && m.fio.height > 25, JSON.stringify(m));
  });

  await cenario('F34-lista-atrasada', 'lista atrasada não troca rota e histórico inicial aparece no fim', async (abrir) => {
    const estado = estadoLongo();
    let soltar, avisarHistorico;
    const lista = new Promise((r) => { soltar = r; });
    const historico = new Promise((r) => { avisarHistorico = r; });
    const { page } = await abrirChat(abrir, { width: 1440, height: 900 }, async (url, req) => {
      if (url.pathname === '/api/chat/conversations') await lista;
      if (url.pathname === `/api/chat/conversations/${OUTRA}/messages`) {
        avisarHistorico();
        return resposta(lote(50, 100, OUTRA));
      }
      return estado.handler(url, req);
    });
    await page.goto(BASE + '/chat');
    await page.evaluate((id) => {
      history.pushState({}, '', `/chat/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, OUTRA);
    await historico;
    await page.waitForTimeout(100);
    soltar();
    await page.locator('.c-fala').last().waitFor();
    assert.equal(new URL(page.url()).pathname, `/chat/${OUTRA}`);
    assert.ok(await page.locator('.ch-fio-wrap').evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight) < 2);
  });

  await cenario('F34-ancora', 'prepend mantém a mensagem visível e só dispara um pedido por cursor', async (abrir) => {
    const estado = estadoLongo();
    let anteriores = 0;
    let soltar;
    const trava = new Promise((r) => { soltar = r; });
    const antigos = lote(0, 50);
    const { page } = await abrirChat(abrir, { width: 390, height: 844 }, async (url, req) => {
      if (url.pathname.endsWith('/messages') && url.searchParams.has('beforeId')) {
        anteriores++;
        await trava;
        return resposta(antigos);
      }
      return estado.handler(url, req);
    });
    await page.goto(`${BASE}/chat/${GERAL}`);
    await page.locator('.c-fala').last().waitFor();
    await page.waitForTimeout(100);
    await page.locator('.ch-fio-wrap').evaluate((e) => { e.scrollTop = 45; e.dispatchEvent(new Event('scroll')); e.dispatchEvent(new Event('scroll')); });
    await page.getByRole('status').filter({ hasText: 'Carregando mensagens anteriores' }).waitFor();
    const medir = () => page.evaluate(() => {
      const fio = document.querySelector('.ch-fio-wrap');
      const primeira = [...fio.querySelectorAll('.c-fala')].find((m) => m.getBoundingClientRect().bottom > fio.getBoundingClientRect().top);
      return { id: primeira.id, top: primeira.getBoundingClientRect().top };
    });
    const antes = await medir();
    soltar();
    await page.locator('.c-fala').first().filter({ hasText: 'Mensagem 0 —' }).waitFor();
    const depois = await page.locator(`#${antes.id}`).boundingBox();
    assert.ok(Math.abs(depois.y - antes.top) <= 2, JSON.stringify({ antes, depois }));
    assert.equal(anteriores, 1);
  });

  /* ───────────── F02 do plano UX: a navegação não esmaga a conversa ─────────────
     UX01: 1024×768, barra expandida e árvore na coluna. Antes: módulo 400,
     conversa 142, "Geral" letra por letra — e `scrollWidth` não via nada.
     Aqui a régua é a LARGURA DE LEITURA, e a preferência gravada é vigiada. */
  const PREF_UX01 = JSON.stringify({ arvoreEmColuna: true, aparencia: 'icones-e-rotulos', versao: 2 });
  async function comPreferencia(state, pref = PREF_UX01) {
    await state.context.addInitScript((p) => {
      if (!sessionStorage.getItem('f02-semeado')) {
        localStorage.setItem('ideworks:barra', p);
        sessionStorage.setItem('f02-semeado', '1');
      }
      // Toda gravação da barra fica registrada: adaptar ao espaço não grava.
      const gravar = Storage.prototype.setItem;
      window.__gravacoesDaBarra = 0;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'ideworks:barra') window.__gravacoesDaBarra++;
        return gravar.call(this, k, v);
      };
    }, pref);
  }
  const leitura = (page) => page.evaluate(() => {
    const caixa = (s) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const visivel = (s) => { const r = caixa(s); return Boolean(r && r.width > 0 && r.height > 0); };
    const q = document.querySelector('.q-tela');
    return {
      w: innerWidth, sw: document.documentElement.scrollWidth,
      modulo: caixa('.ch-grade')?.width ?? 0, lista: visivel('.ch-lista') ? caixa('.ch-lista').width : 0,
      conversa: visivel('.ch-painel') ? caixa('.ch-painel').width : 0,
      fio: caixa('.ch-fio-wrap')?.width ?? 0,
      nome: caixa('.ch-painel-nome')?.height ?? 0,
      coluna: visivel('.bl-coluna'), barra: q?.dataset.barra, faixa: document.querySelector('.ch-grade')?.dataset.faixa,
      guardado: localStorage.getItem('ideworks:barra'), gravacoes: window.__gravacoesDaBarra,
    };
  });

  await cenario('F02-1024-arvore', 'UX01: conversa legível a 1024 com árvore na coluna; ampliar restaura sem gravar', async (abrir) => {
    const estado = estadoLongo();
    const state = await abrirChat(abrir, { width: 1024, height: 768 }, estado.handler);
    await comPreferencia(state);
    const { page, erros } = state;
    await page.goto(`${BASE}/chat/${GERAL}`);
    await page.locator('.c-fala').last().waitFor();
    await page.waitForTimeout(150);
    let m = await leitura(page);
    const ctx = JSON.stringify(m);
    assert.ok(m.sw <= m.w + 1, `sem scroll externo: ${ctx}`);
    assert.equal(m.coluna, false, `a árvore não abre coluna no chat: ${ctx}`);
    assert.ok(m.modulo >= 720, `módulo com lista + conversa: ${ctx}`);
    assert.ok(m.conversa >= 480, `conversa com largura de leitura (era 142): ${ctx}`);
    assert.ok(m.fio >= 440, `histórico legível: ${ctx}`);
    assert.ok(m.nome > 0 && m.nome <= 32, `"Geral" numa linha, não letra por letra: ${ctx}`);
    assert.equal(m.barra, 'icones', `a barra cedeu ao rail: ${ctx}`);
    assert.equal(m.guardado, PREF_UX01, 'a escolha guardada não mudou');
    assert.equal(m.gravacoes, 0, 'adaptar não gravou nada');
    await page.screenshot({ path: '/tmp/ide-f02-chat-1024-arvore.png' });

    // Expandir na mão: vale só nesta tela, não grava — e o chat vira uma área.
    await page.getByRole('button', { name: 'Expandir a barra', exact: true }).click();
    await page.waitForTimeout(150);
    m = await leitura(page);
    assert.equal(m.barra, 'icones-e-rotulos', JSON.stringify(m));
    assert.equal(m.gravacoes, 0, 'expandir por cima do rail não grava');
    assert.ok(m.modulo < 720 && m.faixa === 'uma', `módulo estreito → uma área: ${JSON.stringify(m)}`);
    assert.equal(m.lista, 0, 'só a conversa aparece');
    assert.ok(m.conversa >= 480 && m.nome <= 32, JSON.stringify(m));
    await page.getByRole('link', { name: 'Voltar às conversas', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Recolher a barra', exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal((await leitura(page)).barra, 'icones');

    // Ampliar a janela: no chat a barra SEGUE em rail (F08: o contexto é a
    // lista de Conversas), sem escolha nova; fora do chat a expandida volta.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    m = await leitura(page);
    assert.equal(m.barra, 'icones', JSON.stringify(m));
    assert.ok(m.conversa >= 480 && m.lista > 0, JSON.stringify(m));
    assert.equal(m.guardado, PREF_UX01);
    assert.equal(m.gravacoes, 0);

    // Fora do chat, a 1440 a coluna escolhida volta; a 1024 cede, e a 1280 cabe.
    await page.goto(`${BASE}/meu-trabalho`);
    await page.locator('.iw-trabalho').waitFor();
    const trabalho = () => page.evaluate(() => ({
      coluna: Boolean(document.querySelector('.bl-coluna')?.getBoundingClientRect().width),
      conteudo: document.querySelector('.iw-trabalho')?.getBoundingClientRect().width ?? 0,
      guardado: localStorage.getItem('ideworks:barra'), gravacoes: window.__gravacoesDaBarra,
    }));
    await page.waitForTimeout(150);
    assert.equal((await trabalho()).coluna, true);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);
    let t = await trabalho();
    assert.ok(!t.coluna && t.conteudo >= 560, JSON.stringify(t));
    // A árvore voltou para dentro da barra, e não sumiu.
    assert.ok(await page.locator('.bl-barra .cu-arvore').isVisible());
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    t = await trabalho();
    assert.ok(t.coluna && t.conteudo >= 560, JSON.stringify(t));
    assert.equal(t.guardado, PREF_UX01);
    assert.equal(t.gravacoes, 0);
    assert.deepEqual(erros.filter((e) => !/WebSocket.*chat\/live/i.test(e)), []);
  });

  for (const width of [721, 740]) {
    await cenario(`F02-modulo-${width}`, 'módulo abaixo de 720 px: uma área utilizável por vez', async (abrir) => {
      const estado = estadoLongo();
      const { page } = await abrirChat(abrir, { width, height: 800 }, estado.handler);
      await page.goto(BASE + '/chat');
      await page.locator('.ch-item').first().waitFor();
      await page.waitForTimeout(150);
      let m = await leitura(page);
      assert.ok(m.modulo < 720 && m.faixa === 'uma', JSON.stringify(m));
      assert.equal(new URL(page.url()).pathname, '/chat', 'lista, sem pular para Geral');
      assert.ok(m.lista > 0 && m.conversa === 0, JSON.stringify(m));
      await page.locator(`.ch-item[href='/chat/${GERAL}']`).click();
      await page.locator('.c-fala').last().waitFor();
      m = await leitura(page);
      assert.ok(m.lista === 0 && m.conversa >= 480 && m.nome <= 32, JSON.stringify(m));
      assert.ok(m.sw <= m.w + 1);
    });
  }

  await cenario('F02-gaveta', 'gaveta: foco entra, Esc fecha e o foco volta ao botão', async (abrir) => {
    const estado = estadoLongo();
    const { page } = await abrirChat(abrir, { width: 768, height: 900 }, estado.handler);
    await page.goto(`${BASE}/chat/${GERAL}`);
    await page.locator('.c-fala').last().waitFor();
    const botao = page.getByRole('button', { name: 'Listas e atalhos', exact: true });
    await botao.click();
    await page.locator('.bl-barra[data-gaveta="aberta"]').waitFor();
    assert.ok(await page.evaluate(() => document.querySelector('#barra-lateral').contains(document.activeElement)), 'foco dentro da gaveta');
    await page.keyboard.press('Escape');
    await page.locator('.bl-barra[data-gaveta="fechada"]').waitFor({ state: 'attached' });
    assert.ok(await botao.evaluate((b) => b === document.activeElement), 'foco voltou ao botão');
    assert.equal(await botao.getAttribute('aria-expanded'), 'false');
  });

  /* ───────────── F08 do plano UX: rail + Conversas + conversa ─────────────
     A régua segue sendo a largura de leitura, agora com a lista de Conversas
     como contexto: no chat a barra fica em rail a partir de 1024 (a árvore e
     os atalhos do trabalho não voltam ao lado de "Conversas"), a preferência
     guardada não muda, e membros só ficam ao lado com folga. */
  const f08 = (page) => page.evaluate(() => {
    const caixa = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? r : null; };
    const lar = (s) => Math.round(caixa(s)?.width ?? 0);
    const ativo = document.activeElement;
    return {
      w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      barra: document.querySelector('.q-tela')?.dataset.barra, faixa: document.querySelector('.ch-grade')?.dataset.faixa,
      coluna: Boolean(caixa('.bl-coluna')), modulo: lar('.ch-grade'), lista: lar('.ch-lista'), conversa: lar('.ch-painel'),
      fio: lar('.ch-fio-wrap'), membros: lar('.ch-painel-grupo'), sobreposto: document.querySelector('.ch-painel-grupo')?.dataset.sobreposto ?? null,
      nome: Math.round(caixa('.ch-painel-nome')?.height ?? 0), topo: Math.round(caixa('.o-topo')?.height ?? 0),
      compositor: caixa('.ch-escrever') ? { top: caixa('.ch-escrever').top, bottom: caixa('.ch-escrever').bottom } : null,
      atual: document.querySelector('.ch-item[aria-current="page"] .ch-item-nome')?.textContent ?? null,
      foco: ativo?.id || ativo?.getAttribute('aria-label') || ativo?.textContent?.trim().slice(0, 30) || ativo?.tagName,
      guardado: localStorage.getItem('ideworks:barra'), gravacoes: window.__gravacoesDaBarra,
    };
  });

  for (const [width, height] of [[720, 900], [768, 900], [1023, 768], [1024, 768], [1280, 800], [1440, 900]]) {
    await cenario(`F08-largura-${width}`, 'árvore persistida e barra expandida: lista + conversa legíveis, nada de terceira navegação', async (abrir) => {
      const estado = estadoLongo();
      const state = await abrirChat(abrir, { width, height }, estado.handler);
      await comPreferencia(state);
      const { page, erros } = state;
      await page.goto(`${BASE}/chat/${GERAL}`);
      await page.locator('.c-fala').last().waitFor();
      await page.waitForTimeout(150);
      const m = await f08(page);
      const ctx = JSON.stringify(m);
      assert.ok(m.sw <= m.w + 1 && m.sh <= m.h + 1, `sem rolagem da página: ${ctx}`);
      assert.equal(m.coluna, false, `nenhuma coluna de árvore no chat: ${ctx}`);
      assert.ok(m.topo <= 1, `o título "Chat" não gasta faixa: ${ctx}`);
      assert.ok(m.nome > 0 && m.nome <= 32, `nome da conversa numa linha: ${ctx}`);
      if (width >= 1024) assert.equal(m.barra, 'icones', `barra em rail no chat: ${ctx}`);
      if (m.faixa === 'uma') {
        assert.ok(m.lista === 0 && m.conversa >= 480, `uma área, conversa inteira: ${ctx}`);
      } else {
        assert.ok(m.lista >= 240 && m.conversa >= 480 && m.fio >= 440, `lista + conversa legíveis: ${ctx}`);
        assert.equal(m.atual, 'Geral', `a conversa aberta é a selecionada na lista: ${ctx}`);
      }
      assert.equal(m.guardado, PREF_UX01, 'a escolha guardada não mudou');
      assert.equal(m.gravacoes, 0, 'adaptar não gravou');
      if (process.env.F08_CAPTURAS) await page.screenshot({ path: `${process.env.F08_CAPTURAS}/e2e-f08-${width}.png` });
      assert.deepEqual(erros.filter((e) => !/WebSocket.*chat\/live/i.test(e)), []);
    });
  }

  await cenario('F08-barra-na-mao', 'expandir a barra no chat vale só nesta tela; recolher devolve o rail; nada grava', async (abrir) => {
    const estado = estadoLongo();
    const state = await abrirChat(abrir, { width: 1440, height: 900 }, estado.handler);
    await comPreferencia(state);
    const { page } = state;
    await page.goto(`${BASE}/chat/${GERAL}`);
    await page.locator('.c-fala').last().waitFor();
    await page.getByRole('button', { name: 'Expandir a barra', exact: true }).click();
    await page.waitForTimeout(150);
    let m = await f08(page);
    assert.equal(m.barra, 'icones-e-rotulos', JSON.stringify(m));
    assert.equal(m.coluna, false, `nem expandida a árvore abre coluna no chat: ${JSON.stringify(m)}`);
    assert.ok(m.lista >= 240 && m.conversa >= 480, JSON.stringify(m));
    await page.getByRole('button', { name: 'Recolher a barra', exact: true }).click();
    await page.waitForTimeout(150);
    m = await f08(page);
    assert.equal(m.barra, 'icones', JSON.stringify(m));
    assert.equal(m.guardado, PREF_UX01);
    assert.equal(m.gravacoes, 0);
  });

  for (const [width, height, lado] of [[1440, 900, true], [1024, 768, false], [390, 844, false]]) {
    await cenario(`F08-membros-${width}`, `membros ${lado ? 'ao lado' : 'por cima'} sem espremer a conversa; Esc fecha e o foco volta`, async (abrir) => {
      const estado = estadoLongo();
      const { page } = await abrirChat(abrir, { width, height }, estado.handler);
      await page.goto(`${BASE}/chat/${GERAL}`);
      await page.locator('.c-fala').last().waitFor();
      await page.waitForTimeout(150);
      const antes = await f08(page);
      const botao = page.getByRole('button', { name: 'Membros', exact: true });
      await botao.click();
      await page.locator('#ch-membros').waitFor();
      await page.waitForTimeout(100);
      let m = await f08(page);
      const ctx = JSON.stringify({ antes, m });
      assert.ok(m.sw <= m.w + 1, ctx);
      if (lado) {
        assert.equal(m.sobreposto, null, ctx);
        assert.ok(m.fio >= 480, `ao lado, a leitura não desce de 480: ${ctx}`);
        assert.ok(m.membros >= 200, ctx);
        // Ao lado ele não rouba o foco; Esc fecha quando o foco está nele.
        await page.locator('#ch-membros').getByRole('button', { name: 'Fechar', exact: true }).focus();
      } else {
        assert.equal(m.sobreposto, 'true', ctx);
        assert.equal(m.fio, antes.fio, `por cima, a leitura não encolhe: ${ctx}`);
        assert.equal(m.foco, 'ch-membros', `o foco vai ao painel: ${ctx}`);
        assert.ok(m.compositor && m.compositor.bottom <= m.h, `o compositor segue à vista: ${ctx}`);
      }
      await page.keyboard.press('Escape');
      await page.locator('#ch-membros').waitFor({ state: 'detached' });
      assert.ok(await botao.evaluate((b) => b === document.activeElement), 'o foco voltou ao botão Membros');
      assert.equal(await botao.getAttribute('aria-expanded'), 'false');
      m = await f08(page);
      assert.equal(m.fio, antes.fio, 'fechar devolve a largura de leitura');
      // O botão também fecha, e Fechar dentro do painel devolve o foco.
      await botao.click();
      await page.locator('#ch-membros').getByRole('button', { name: 'Fechar', exact: true }).click();
      await page.locator('#ch-membros').waitFor({ state: 'detached' });
      assert.ok(await botao.evaluate((b) => b === document.activeElement), 'Fechar devolve o foco');
    });
  }

  await cenario('F08-zoom-200', 'janela de 1280×900 a 200% (640×450 CSS): uma área, sem ação só de desktop', async (abrir) => {
    const estado = estadoLongo();
    const { page } = await abrirChat(abrir, { width: 640, height: 450 }, estado.handler);
    await page.goto(BASE + '/chat');
    await page.locator('.ch-item').first().waitFor();
    let m = await f08(page);
    assert.ok(m.faixa === 'uma' && m.lista > 0 && m.conversa === 0 && m.sw <= m.w + 1, JSON.stringify(m));
    assert.ok(await page.getByRole('button', { name: 'Nova conversa', exact: true }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Listas e atalhos', exact: true }).isVisible());
    await page.locator(`.ch-item[href='/chat/${GERAL}']`).click();
    await page.locator('.c-fala').last().waitFor();
    m = await f08(page);
    assert.ok(m.lista === 0 && m.conversa > 0 && m.fio > 0, JSON.stringify(m));
    assert.ok(m.compositor && m.compositor.bottom <= m.h + 1, `compositor à vista: ${JSON.stringify(m)}`);
    assert.ok(await page.getByRole('button', { name: 'Membros', exact: true }).isVisible());
    await voltar(page);
  });

  await cenario('F08-rascunho-na-largura', 'mudar a largura não perde a mensagem em escrita nem a edição aberta', async (abrir) => {
    const estado = estadoLongo();
    const { page } = await abrirChat(abrir, { width: 1440, height: 900 }, estado.handler);
    await page.goto(`${BASE}/chat/${GERAL}`);
    await page.locator('.c-fala').last().waitFor();
    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    await campo.fill('Rascunho que atravessa larguras');
    const ultima = page.locator('.c-fala').last();
    await clicarNaRegua(ultima, 'Editar');
    const edicao = page.getByLabel('Editar mensagem', { exact: true });
    await edicao.fill('Edição em curso');
    for (const [width, height] of [[390, 844], [768, 900], [1024, 768], [320, 640], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(200);
      const ctx = `${width}×${height}`;
      // O campo com menções é editável, não `<textarea>`: lê-se o texto.
      const valor = (l) => l.evaluate((e) => ('value' in e ? e.value : e.innerText).trim());
      assert.equal(await valor(campo), 'Rascunho que atravessa larguras', ctx);
      assert.equal(await valor(edicao), 'Edição em curso', ctx);
      assert.equal(new URL(page.url()).pathname, `/chat/${GERAL}`, ctx);
      const m = await f08(page);
      assert.ok(m.sw <= m.w + 1 && m.conversa > 0, `${ctx}: ${JSON.stringify(m)}`);
    }
    assert.equal(estado.envios.length, 0, 'nada foi enviado');
  });

  for (const tipo of ['inicial', 'anteriores', 'alcance']) {
    await cenario(`F34-tardia-${tipo}`, 'resposta da abertura anterior não contamina A → B → A', async (abrir) => {
      const estado = estadoLongo();
      let soltar, avisarPedido;
      const trava = new Promise((r) => { soltar = r; });
      const pedido = new Promise((r) => { avisarPedido = r; });
      let segurar = true;
      const intrusa = { ...msgSeed('NÃO EXIBIR RESPOSTA ANTIGA', '2026-09-25T14:00:00.000Z') };
      const { page } = await abrirChat(abrir, { width: 390, height: 844 }, async (url, req) => {
        const caminho = `/api/chat/conversations/${GERAL}`;
        const alvo = tipo === 'alcance' ? url.pathname === `${caminho}/changes`
          : url.pathname === `${caminho}/messages` && url.searchParams.has('beforeId') === (tipo === 'anteriores');
        if (segurar && alvo) {
          segurar = false;
          avisarPedido();
          await trava;
          return resposta([intrusa]);
        }
        return estado.handler(url, req);
      });
      await page.goto(`${BASE}/chat/${GERAL}`);
      await page.locator('.ch-painel-nome').getByText('Geral', { exact: true }).waitFor();
      if (tipo !== 'inicial') {
        await page.locator('.c-fala').last().waitFor();
        await page.waitForTimeout(100);
        if (tipo === 'anteriores') await page.locator('.ch-fio-wrap').evaluate((e) => { e.scrollTop = 45; });
        else await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      }
      await Promise.race([pedido, new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('pedido não iniciou')), 5000))]);
      await voltar(page);
      await page.locator(`.ch-item[href='/chat/${OUTRA}']`).click();
      await page.locator('.ch-painel-nome').getByText('Outra conversa', { exact: true }).waitFor();
      await voltar(page);
      await page.locator(`.ch-item[href='/chat/${GERAL}']`).click();
      await page.locator('.c-fala').last().waitFor();
      soltar();
      await page.waitForTimeout(250);
      assert.equal(await page.getByText(intrusa.body, { exact: true }).count(), 0);
      assert.equal(await page.locator('.c-fala').count(), 50);
    });
  }
  return resultados;
}
