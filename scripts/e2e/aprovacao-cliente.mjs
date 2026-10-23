/**
 * A PÁGINA DO CLIENTE (`/aprovar/:token`) — F42, Fase 6, no Chrome real.
 *
 * O servidor aqui é FICTÍCIO e tem estado: ele imita a API pública da Fase 5
 * (`/api/public/aprovacao/:token/…`) nas regras que importam para a tela —
 * 404 com a mesma frase para token desconhecido, 409 "já respondida em…",
 * reprovar exige comentário, comentar só em chamada aberta, 429. As regras de
 * verdade estão provadas em `test/aprovacao-publica-rotas.test.ts` e no banco.
 * O Dropbox também é respondido aqui: imagem vira um SVG local, o vídeo é um
 * WebM gravado no próprio Chrome (canvas → MediaRecorder). Nada sai da máquina.
 *
 *   AC1  abrir o link SEM sessão: lista com "Para você responder" e as já
 *        respondidas com o selo; metas no-referrer/noindex no <head>; só
 *        `/api/public/aprovacao/…` é pedido (nenhum `/auth/*`, nem `/config`);
 *   AC2  ver a chamada (versão, "Enviado em…", carrossel na ordem, imagens e
 *        vídeo carregados, legenda), comentar um material e a chamada inteira,
 *        aprovar com confirmação → "Aprovado em…" sem botões; na lista ela
 *        passa para "Já respondidas";
 *   AC3  "Pedir ajustes" sem motivo não envia nada; com motivo envia o POST de
 *        reprovar e a chamada vira "Ajustes pedidos em…";
 *   AC4  link inválido: tela de link inválido, sem erro no console;
 *   AC5  decidida em outra aba: o 409 relê a chamada e mostra a frase, só leitura;
 *   AC6  material que não carregou: "Não abriu? Tente de novo ou fale com o
 *        atendimento", e "Tentar de novo" carrega quando o Dropbox volta;
 *   AC7  429 ao abrir: "Aguarde um instante", e tentar de novo abre;
 *   AC8  nada pendente;
 *   AC9  320 e 390 px (toque) e 1440: sem rolagem horizontal na lista, na
 *        chamada aberta e no painel de ajustes; botões com alvo ≥ 44 px.
 *   AC10 F42, Fase 9: a arte ANEXADA ao card (`forma: 'anexo'`, sem endereço
 *        na resposta) aparece no carrossel pela rota da imagem do próprio link
 *        (`…/chamadas/:id/itens/:item/imagem`), sem Referer, junto do vídeo do
 *        Dropbox; se não carregar, a mesma orientação de "não abriu".
 *
 * `APROVACAO_CAPTURAS=<pasta>` grava as telas (celular 390 e 320, desktop) com
 * dados de exemplo — elas vão para o tutorial dos colaboradores.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite } from './comum.mjs';

const TOKEN = 'k3J9xQ2mZr7Vt5Lp8NwYc4Hs6Fd1Gb0Ea2Ui9Oq7Xe';
const TOKEN_REVOGADO = 'Z'.repeat(43);
const FRASE_404 = 'Link inválido ou desativado.';

const CAPTURAS = process.env.APROVACAO_CAPTURAS;
async function capturar(page, nome, opcoes = {}) {
  if (!CAPTURAS) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${CAPTURAS}/${nome}.png`, ...opcoes });
}

/* ─────────────────────────── datas ─────────────────────────── */

const partes = (iso, opcoes) => {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...opcoes }).formatToParts(new Date(iso));
  return (t) => p.find((x) => x.type === t)?.value ?? '';
};
const diaEMes = (iso) => {
  const p = partes(iso, { day: '2-digit', month: '2-digit' });
  return `${p('day')}/${p('month')}`;
};
const dataEHora = (iso) => {
  const p = partes(iso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${p('day')}/${p('month')}/${p('year')} às ${p('hour')}:${p('minute')}`;
};
const horasAtras = (h) => new Date(Date.now() - h * 3600e3).toISOString();

/* ─────────────────────────── os dados de exemplo ─────────────────────────── */

const DBX = (pasta, nome) => `https://www.dropbox.com/scl/fi/${pasta}/${nome}?rlkey=exemplo${pasta}&raw=1`;

function dadosDeExemplo() {
  return {
    cliente: { nome: 'Loja Exemplo' },
    chamadas: [
      {
        id: '5b1f3c2a-0000-4000-8000-000000000002',
        titulo: 'Reels — lançamento outubro',
        versao: 2,
        enviadaEm: horasAtras(2),
        legenda:
          'A coleção de outubro chegou! 🍂\nPeças novas, cores da estação e aquele caimento que você já conhece.\n\nCorre que é por tempo limitado — link na bio.\n#lojaexemplo #colecaooutubro',
        estado: 'aberta',
        decididaEm: null,
        itens: [
          { id: 'a1f0c000-0000-4000-8000-000000000001', ordem: 1, tipo: 'image', nome: 'capa-colecao.jpg', forma: 'arquivo', exibicao: DBX('a1', 'capa-colecao.jpg'), abrirNoDropbox: null },
          { id: 'a1f0c000-0000-4000-8000-000000000002', ordem: 2, tipo: 'image', nome: 'detalhe-tecido.jpg', forma: 'arquivo', exibicao: DBX('a2', 'detalhe-tecido.jpg'), abrirNoDropbox: null },
          { id: 'a1f0c000-0000-4000-8000-000000000003', ordem: 3, tipo: 'image', nome: 'precos.png', forma: 'arquivo', exibicao: DBX('a3', 'precos.png'), abrirNoDropbox: null },
          { id: 'a1f0c000-0000-4000-8000-000000000004', ordem: 4, tipo: 'video', nome: 'reels-final.mp4', forma: 'arquivo', exibicao: DBX('v1', 'reels-final.mp4'), abrirNoDropbox: null },
        ],
        comentarios: [],
      },
      {
        id: '5b1f3c2a-0000-4000-8000-000000000001',
        titulo: 'Reels — lançamento outubro',
        versao: 1,
        enviadaEm: horasAtras(50),
        legenda: 'A coleção de outubro chegou!',
        estado: 'reprovada',
        decididaEm: horasAtras(46),
        itens: [
          { id: 'b1f0c000-0000-4000-8000-000000000001', ordem: 1, tipo: 'image', nome: 'capa-colecao.jpg', forma: 'arquivo', exibicao: DBX('b1', 'capa-colecao.jpg'), abrirNoDropbox: null },
        ],
        comentarios: [
          { id: 'c0000000-0000-4000-8000-000000000001', texto: 'Trocar a foto da capa pela da modelo de vestido verde e colocar o preço no último slide.', criadoEm: horasAtras(46), itemId: null },
        ],
      },
      {
        id: '5b1f3c2a-0000-4000-8000-000000000003',
        titulo: 'Carrossel — Dia das Crianças',
        versao: 1,
        enviadaEm: horasAtras(130),
        legenda: 'Presente bom é presente que dura. 🎁',
        estado: 'aprovada',
        decididaEm: horasAtras(120),
        itens: [
          { id: 'd1f0c000-0000-4000-8000-000000000001', ordem: 1, tipo: 'image', nome: 'criancas-1.jpg', forma: 'arquivo', exibicao: DBX('d1', 'criancas-1.jpg'), abrirNoDropbox: null },
          { id: 'd1f0c000-0000-4000-8000-000000000002', ordem: 2, tipo: 'other', nome: 'Pasta do Dropbox', forma: 'pasta', exibicao: null, abrirNoDropbox: 'https://www.dropbox.com/scl/fo/p1/AAexemplo?rlkey=exemplop1&dl=0' },
        ],
        comentarios: [],
      },
    ],
  };
}

const ABERTA = '5b1f3c2a-0000-4000-8000-000000000002';

/* ─────────────────────────── o servidor fictício ─────────────────────────── */

function servidor({ dados = dadosDeExemplo(), limite = 0, decididaEmOutraAba = false } = {}) {
  const estado = { dados, pedidos: [], limite, decididaEmOutraAba, seq: 0 };
  const ordenadas = () => [...estado.dados.chamadas].sort((a, b) => (a.estado === 'aberta' ? 0 : 1) - (b.estado === 'aberta' ? 0 : 1));
  const custom = (url, req) => {
    const p = url.pathname;
    const metodo = req.method();
    let corpo = null;
    try {
      corpo = metodo === 'POST' ? req.postDataJSON() : null;
    } catch {
      corpo = '(não é JSON)';
    }
    estado.pedidos.push({ metodo, caminho: p, corpo, tipo: req.headers()['content-type'] ?? null });
    const m = p.match(/^\/api\/public\/aprovacao\/([^/]+)(?:\/chamadas\/([^/]+)(?:\/(comentarios|aprovar|reprovar))?)?$/);
    // Qualquer outra rota da API é "do sistema", com sessão: aqui não há.
    if (!m) return { status: 401, body: { message: 'Sem sessão.' } };
    const [, token, id, acao] = m;
    if (estado.limite > 0) {
      estado.limite -= 1;
      return { status: 429, body: { message: 'Muitos pedidos em pouco tempo. Espere um minuto e tente de novo.' } };
    }
    if (token !== TOKEN) return { status: 404, body: { message: FRASE_404 } };
    if (!id) return { body: { ok: true, cliente: estado.dados.cliente, chamadas: ordenadas() } };
    const c = estado.dados.chamadas.find((x) => x.id === id);
    if (!c) return { status: 404, body: { message: FRASE_404 } };
    if (!acao) return { body: { ok: true, chamada: c } };
    if (metodo !== 'POST') return { status: 404, body: { message: FRASE_404 } };
    if (estado.decididaEmOutraAba && c.estado === 'aberta') {
      c.estado = 'aprovada';
      c.decididaEm = horasAtras(0.2);
    }
    if (c.estado !== 'aberta') {
      return { status: 409, body: { message: `Você já respondeu este envio em ${dataEHora(c.decididaEm)}.`, estado: c.estado, decididaEm: c.decididaEm } };
    }
    const agora = new Date().toISOString();
    const novoId = () => `c0000000-0000-4000-8000-${String(++estado.seq).padStart(12, '0')}`;
    if (acao === 'comentarios') {
      if (!corpo?.texto?.trim()) return { status: 400, body: { message: 'Escreva o comentário.' } };
      const comentario = { id: novoId(), texto: corpo.texto.trim(), criadoEm: agora, itemId: corpo.itemId ?? null };
      c.comentarios.push(comentario);
      return { status: 201, body: { ok: true, comentario } };
    }
    if (acao === 'reprovar') {
      if (!corpo?.comentario?.trim()) return { status: 400, body: { message: 'Para pedir ajustes, escreva o que precisa mudar.' } };
      c.comentarios.push({ id: novoId(), texto: corpo.comentario.trim(), criadoEm: agora, itemId: null });
      c.estado = 'reprovada';
    } else {
      c.estado = 'aprovada';
    }
    c.decididaEm = agora;
    return { body: { ok: true, chamada: c } };
  };
  return { estado, custom };
}

/* ─────────────────────────── o Dropbox fictício ─────────────────────────── */

const CORES = {
  'capa-colecao.jpg': ['#c2410c', '#7c2d12', 'Coleção outubro', 'Slide 1'],
  'detalhe-tecido.jpg': ['#a16207', '#422006', 'Detalhe do tecido', 'Slide 2'],
  'precos.png': ['#be185d', '#500724', 'A partir de R$ 89,90', 'Slide 3'],
  'criancas-1.jpg': ['#0369a1', '#082f49', 'Dia das Crianças', 'Slide 1'],
};

const svgDe = (nome) => {
  const [a, b, titulo, slide] = CORES[nome] ?? ['#444', '#111', nome, ''];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="1080" height="1350" fill="url(#g)"/>
<circle cx="860" cy="260" r="190" fill="#ffffff" opacity="0.10"/>
<text x="90" y="1060" font-family="Helvetica, Arial, sans-serif" font-size="96" font-weight="700" fill="#ffffff">${titulo}</text>
<text x="90" y="1160" font-family="Helvetica, Arial, sans-serif" font-size="48" fill="#ffffff" opacity="0.8">LOJA EXEMPLO · ${slide}</text>
</svg>`;
};

/** Um WebM de ~1,5 s gravado no próprio Chrome. `null` se o navegador não gravar. */
async function gravarVideo(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 360;
      c.height = 640;
      const ctx = c.getContext('2d');
      const tipo = ['video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
      if (!tipo) return null;
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: tipo });
      const pedacos = [];
      rec.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
      const fim = new Promise((ok) => (rec.onstop = ok));
      rec.start();
      const t0 = performance.now();
      await new Promise((ok) => {
        const quadro = () => {
          const t = (performance.now() - t0) / 1500;
          const g = ctx.createLinearGradient(0, 0, 360, 640);
          g.addColorStop(0, '#7c2d12');
          g.addColorStop(1, '#c2410c');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 360, 640);
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.beginPath();
          ctx.arc(60 + 240 * t, 200, 70, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 34px Helvetica, Arial';
          ctx.fillText('REELS', 32, 520);
          ctx.font = '22px Helvetica, Arial';
          ctx.fillText('Lançamento outubro', 32, 556);
          if (t < 1) requestAnimationFrame(quadro);
          else ok();
        };
        quadro();
      });
      rec.stop();
      await fim;
      const buf = new Uint8Array(await new Blob(pedacos, { type: 'video/webm' }).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return btoa(s);
    });
    return b64 ? Buffer.from(b64, 'base64') : null;
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Responde o Dropbox no contexto. `falhar(nome)` decide se aquele arquivo dá
 * 404 agora (para o cenário do material que não carregou).
 */
async function dropbox(context, video, falhar = () => false) {
  const pedidos = [];
  await context.route('https://www.dropbox.com/**', async (route) => {
    const url = new URL(route.request().url());
    const nome = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    pedidos.push({ nome, referer: route.request().headers()['referer'] ?? null });
    if (falhar(nome)) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    if (/\.mp4$/i.test(nome)) {
      if (!video) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'sem vídeo' });
      return route.fulfill({ status: 200, contentType: 'video/webm', body: video });
    }
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svgDe(nome) });
  });
  return pedidos;
}

/* ─────────────────────────── conferências ─────────────────────────── */

/** O console: fora a linha de rede do próprio Chrome ("Failed to load resource"), nada. */
const errosDeApp = (erros) => erros.filter((e) => !/Failed to load resource/i.test(e));

/** Todo pedido da página a `/api/` precisa ser da API pública do link. */
function vigiarPedidos(page) {
  const fora = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(BASE).origin) return;
    if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/public/aprovacao/')) fora.push(u.pathname);
    if (u.pathname.startsWith('/auth')) fora.push(u.pathname);
  });
  return fora;
}

const rolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function abrirLink(page, token = TOKEN, busca = '') {
  await page.goto(`${BASE}/aprovar/${token}${busca}`);
  await page.waitForFunction(() => {
    const h = document.querySelector('h1');
    return h && !/Abrindo/.test(h.textContent ?? '');
  });
}

async function abrirChamada(page) {
  await page.getByRole('link', { name: /Ver e responder/ }).first().click();
  await page.getByRole('heading', { level: 1, name: 'Reels — lançamento outubro' }).waitFor();
}

/* ─────────────────────────── os cenários ─────────────────────────── */

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);
  const video = await gravarVideo(browser);
  const MOVEL = { viewport: { width: 390, height: 844 }, toque: true };

  await cenario('AC1', 'abrir o link sem sessão: lista com abertas e respondidas, metas no <head>, só a API pública', async (abrir) => {
    const srv = servidor();
    const { page, context, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    assert.equal((await context.cookies()).length, 0, 'nenhum cookie: sem sessão');
    await dropbox(context, video);
    const fora = vigiarPedidos(page);
    await abrirLink(page);
    await page.getByRole('heading', { level: 1, name: 'Materiais para aprovação' }).waitFor();
    assert.ok(await page.getByText('Loja Exemplo', { exact: true }).isVisible());
    const abertas = page.locator('section', { has: page.getByRole('heading', { name: /Para você responder/ }) });
    assert.equal(await abertas.getByRole('link').count(), 1, 'uma chamada aberta');
    const respondidas = page.locator('section', { has: page.getByRole('heading', { name: /Já respondidas/ }) });
    const textoRespondidas = await respondidas.innerText();
    assert.match(textoRespondidas, new RegExp(`Ajustes pedidos em ${diaEMes(horasAtras(46))}`));
    assert.match(textoRespondidas, new RegExp(`Aprovado em ${diaEMes(horasAtras(120))}`));
    const metas = await page.evaluate(() => ({
      referrer: document.querySelector('meta[name="referrer"]')?.getAttribute('content'),
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content'),
      tema: document.documentElement.dataset.tema,
      titulo: document.title,
    }));
    assert.deepEqual(metas, { referrer: 'no-referrer', robots: 'noindex, nofollow', tema: 'escuro', titulo: 'Aprovação · Agência Ide' });
    assert.deepEqual(fora, [], `pedidos fora da API pública: ${fora.join(', ')}`);
    assert.ok(srv.estado.pedidos.every((p) => p.caminho.startsWith('/api/public/aprovacao/')));
    assert.deepEqual(errosDeApp(erros), []);
    await capturar(page, '01-lista-celular-390');
    return `pedidos: ${srv.estado.pedidos.map((p) => `${p.metodo} ${p.caminho.replace(TOKEN, ':token')}`).join(', ')}`;
  });

  await cenario('AC2', 'ver a chamada, comentar (material e geral), aprovar com confirmação → "Aprovado em…" sem botões', async (abrir) => {
    const srv = servidor();
    const { page, context, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    const dbx = await dropbox(context, video);
    const fora = vigiarPedidos(page);
    await abrirLink(page);
    await abrirChamada(page);
    assert.match(page.url(), new RegExp(`\\?chamada=${ABERTA}$`));
    const texto = await page.locator('main').innerText();
    assert.match(texto, /Versão 2/i);
    assert.match(texto, new RegExp(`Enviado em ${dataEHora(horasAtras(2)).replace(/\d\d$/, '\\d\\d')}`));
    // Carrossel na ordem, imagens e vídeo carregados.
    const nomes = await page.locator('.apc-slide figcaption').allInnerTexts();
    assert.deepEqual(nomes.map((n) => n.replace(/^\d+\s*/, '')), ['capa-colecao.jpg', 'detalhe-tecido.jpg', 'precos.png', 'reels-final.mp4']);
    await page.waitForFunction(() => [...document.querySelectorAll('.apc-slide img')].every((i) => i.complete && i.naturalWidth > 0));
    const v = page.locator('.apc-slide video');
    assert.equal(await v.count(), 1);
    assert.deepEqual(await v.evaluate((el) => [el.controls, el.playsInline, el.preload, el.referrerPolicy ?? null]).then((x) => x.slice(0, 3)), [true, true, 'metadata']);
    assert.ok(dbx.every((d) => d.referer === null), `o Dropbox não recebe Referer: ${JSON.stringify(dbx)}`);
    assert.ok(await page.getByText('Corre que é por tempo limitado', { exact: false }).isVisible());
    await capturar(page, '02-chamada-celular-390');
    await page.getByRole('heading', { name: 'Legenda' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -90));
    await capturar(page, '02b-chamada-celular-390-legenda');

    // O carrossel anda pelos botões.
    await page.getByRole('button', { name: 'Próximo material' }).click();
    await page.getByText('Material 2 de 4', { exact: true }).waitFor();

    // Comentar o material 2.
    const slide2 = page.locator('.apc-slide').nth(1);
    await slide2.getByRole('button', { name: 'Comentar este material' }).click();
    await slide2.getByLabel('Comentário sobre o material 2').fill('Dá para clarear um pouco essa foto?');
    await slide2.getByRole('button', { name: 'Enviar comentário' }).click();
    await slide2.getByText('Dá para clarear um pouco essa foto?').waitFor();
    const comentarioItem = srv.estado.pedidos.find((p) => p.caminho.endsWith('/comentarios'));
    assert.deepEqual(comentarioItem.corpo, { texto: 'Dá para clarear um pouco essa foto?', itemId: 'a1f0c000-0000-4000-8000-000000000002' });
    assert.match(comentarioItem.tipo, /application\/json/);

    // Comentário geral.
    await page.getByRole('button', { name: 'Escrever um comentário geral' }).click();
    await page.getByLabel('Comentário sobre o envio inteiro').fill('Ficou ótimo, só esse detalhe.');
    await page.getByRole('button', { name: 'Enviar comentário' }).click();
    await page.getByText('Ficou ótimo, só esse detalhe.').waitFor();
    assert.deepEqual(srv.estado.pedidos.filter((p) => p.caminho.endsWith('/comentarios')).at(-1).corpo, { texto: 'Ficou ótimo, só esse detalhe.' });

    // Aprovar: primeiro a confirmação, nada enviado ainda.
    await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await page.getByRole('group', { name: /Aprovar “Reels — lançamento outubro”\?/ }).waitFor();
    assert.equal(srv.estado.pedidos.filter((p) => p.caminho.endsWith('/aprovar')).length, 0, 'nada enviado antes de confirmar');
    await capturar(page, '03-confirmar-aprovacao-390');
    await page.getByRole('button', { name: 'Sim, aprovar' }).click();
    await page.getByText(/^Aprovado em \d\d\/\d\d\/\d{4} às \d\d:\d\d$/).waitFor();
    assert.equal(srv.estado.pedidos.filter((p) => p.caminho.endsWith('/aprovar')).length, 1);
    assert.equal(await page.getByRole('button', { name: 'Aprovar', exact: true }).count(), 0, 'sem botão Aprovar');
    assert.equal(await page.getByRole('button', { name: 'Pedir ajustes' }).count(), 0, 'sem botão Pedir ajustes');
    assert.equal(await page.locator('textarea').count(), 0, 'sem campos');
    assert.equal(await page.getByRole('button', { name: /Comentar/ }).count(), 0, 'sem comentar');
    await page.getByText('Pronto! Sua aprovação foi registrada.', { exact: false }).waitFor();
    await capturar(page, '04-aprovado-390');

    // De volta à lista: ela foi para "Já respondidas" com o selo de hoje.
    await page.getByRole('link', { name: /Voltar à lista/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Materiais para aprovação' }).waitFor();
    assert.ok(await page.getByText('Nada pendente por aqui.').isVisible());
    const hoje = diaEMes(new Date().toISOString());
    const respondidas = page.locator('section', { has: page.getByRole('heading', { name: /Já respondidas/ }) });
    assert.match(await respondidas.innerText(), new RegExp(`Aprovado em ${hoje}`));
    assert.deepEqual(fora, []);
    assert.deepEqual(errosDeApp(erros), []);
  });

  await cenario('AC3', '"Pedir ajustes" sem motivo não envia; com motivo envia o POST de reprovar → "Ajustes pedidos em…"', async (abrir) => {
    const srv = servidor();
    const { page, context, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    await dropbox(context, video);
    const fora = vigiarPedidos(page);
    await abrirLink(page, TOKEN, `?chamada=${ABERTA}`);
    await page.getByRole('button', { name: 'Pedir ajustes' }).click();
    const campo = page.getByLabel(/O que precisa mudar\?/);
    await campo.waitFor();
    assert.ok(await campo.evaluate((el) => el === document.activeElement), 'o foco vai ao campo do motivo');
    await page.getByRole('button', { name: 'Enviar pedido de ajustes' }).click();
    await page.getByText('Para pedir ajustes, escreva o que precisa mudar.').waitFor();
    await campo.fill('   ');
    await page.getByRole('button', { name: 'Enviar pedido de ajustes' }).click();
    assert.equal(srv.estado.pedidos.filter((p) => p.caminho.endsWith('/reprovar')).length, 0, 'sem motivo, nada vai ao servidor');
    assert.equal(await rolagemLateral(page), 0);
    await campo.fill('Trocar a música do vídeo por uma mais animada e aumentar o preço no slide 3.');
    await capturar(page, '05-pedir-ajustes-390');
    await page.getByRole('button', { name: 'Enviar pedido de ajustes' }).click();
    await page.getByText(/^Ajustes pedidos em \d\d\/\d\d\/\d{4} às \d\d:\d\d$/).waitFor();
    const reprovar = srv.estado.pedidos.filter((p) => p.caminho.endsWith('/reprovar'));
    assert.equal(reprovar.length, 1);
    assert.deepEqual(reprovar[0].corpo, { comentario: 'Trocar a música do vídeo por uma mais animada e aumentar o preço no slide 3.' });
    assert.equal(await page.getByRole('button', { name: 'Aprovar', exact: true }).count(), 0);
    assert.ok(await page.getByText('Trocar a música do vídeo', { exact: false }).isVisible(), 'o motivo aparece nos comentários');
    await page.getByText('Pronto! Seu pedido de ajustes foi enviado à Ide.').waitFor();
    await capturar(page, '06-ajustes-pedidos-390');
    // O vídeo (4º material) pelo carrossel: carrega e fica pronto para tocar.
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Próximo material' }).click();
    await page.getByText('Material 4 de 4', { exact: true }).waitFor();
    if (video) await page.waitForFunction(() => (document.querySelector('.apc-slide video')?.readyState ?? 0) >= 1);
    await page.locator('.apc-slide').nth(3).scrollIntoViewIfNeeded();
    await capturar(page, '02c-video-390');
    assert.deepEqual(fora, []);
    assert.deepEqual(errosDeApp(erros), []);
  });

  await cenario('AC4', 'link inválido: tela de link inválido, sem erro no console, só a API pública', async (abrir) => {
    const srv = servidor();
    const { page, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    const fora = vigiarPedidos(page);
    await abrirLink(page, TOKEN_REVOGADO);
    await page.getByRole('heading', { level: 1, name: 'Link inválido ou desativado' }).waitFor();
    assert.ok(await page.getByText('Fale com o atendimento da Ide', { exact: true }).isVisible());
    assert.deepEqual(errosDeApp(erros), [], `erros: ${erros.join(' | ')}`);
    assert.deepEqual(fora, []);
    await capturar(page, '07-link-invalido-390');
    return `console: ${erros.length} linha(s) de rede do Chrome (404 esperado), nenhuma da página`;
  });

  await cenario('AC2b', 'aprovar vendo só o 1º material pergunta "Você viu 1 de 4"; "Ver os outros" leva ao 2º', async (abrir) => {
    const srv = servidor();
    const { page, context, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    await dropbox(context, video);
    await abrirLink(page, TOKEN, `?chamada=${ABERTA}`);
    await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await page.getByText('Você viu 1 de 4 materiais. Quer aprovar mesmo assim?', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Ver os outros' }).click();
    await page.getByText('Material 2 de 4', { exact: true }).waitFor();
    assert.equal(srv.estado.pedidos.filter((p) => p.caminho.endsWith('/aprovar')).length, 0, 'não aprovou ao voltar');
    // Vê os quatro: a pergunta some.
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Próximo material' }).click();
    await page.getByText('Material 4 de 4', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await page.getByRole('group', { name: /Aprovar “Reels — lançamento outubro”\?/ }).waitFor();
    assert.equal(await page.getByText(/Você viu \d de 4/).count(), 0);
    assert.deepEqual(errosDeApp(erros), []);
  });

  await cenario('AC5', 'decidida em outra aba: o 409 relê a chamada, mostra "já foi respondida em…" e fica só leitura', async (abrir) => {
    const srv = servidor({ decididaEmOutraAba: true });
    const { page, context, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    await dropbox(context, video);
    await abrirLink(page, TOKEN, `?chamada=${ABERTA}`);
    await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
    await page.getByRole('button', { name: 'Sim, aprovar' }).click();
    await page.getByText(/^Você já respondeu este envio em \d\d\/\d\d\/\d{4} às \d\d:\d\d\.$/).waitFor();
    await page.getByText(/^Aprovado em /).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Sim, aprovar' }).count(), 0);
    const releu = srv.estado.pedidos.filter((p) => p.metodo === 'GET' && p.caminho.endsWith(`/chamadas/${ABERTA}`));
    assert.equal(releu.length, 1, 'a chamada foi relida depois do 409');
    assert.deepEqual(errosDeApp(erros), []);
  });

  await cenario('AC6', 'material que não carregou: "Não abriu? Tente de novo…", e tentar de novo carrega', async (abrir) => {
    const srv = servidor();
    const { page, context, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    let fora = true;
    await dropbox(context, video, (nome) => fora && nome === 'capa-colecao.jpg');
    await abrirLink(page, TOKEN, `?chamada=${ABERTA}`);
    const slide1 = page.locator('.apc-slide').first();
    await slide1.getByText('Não abriu? Tente de novo ou fale com o atendimento.').waitFor();
    await capturar(page, '08-material-nao-abriu-390');
    fora = false;
    await slide1.getByRole('button', { name: 'Tentar de novo' }).click();
    await page.waitForFunction(() => {
      const i = document.querySelector('.apc-slide img');
      return i && i.complete && i.naturalWidth > 0;
    });
    assert.equal(await slide1.getByText('Não abriu?', { exact: false }).count(), 0);
    assert.deepEqual(errosDeApp(erros), []);
  });

  await cenario('AC7', '429 ao abrir: "Aguarde um instante"; tentar de novo abre', async (abrir) => {
    const srv = servidor({ limite: 2 });
    const { page, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    await abrirLink(page);
    await page.getByRole('heading', { level: 1, name: 'Aguarde um instante' }).waitFor();
    srv.estado.limite = 0;
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await page.getByRole('heading', { level: 1, name: 'Materiais para aprovação' }).waitFor();
    assert.deepEqual(errosDeApp(erros), []);
  });

  await cenario('AC8', 'nada pendente: a página diz e mostra as respondidas', async (abrir) => {
    const dados = dadosDeExemplo();
    dados.chamadas = dados.chamadas.filter((c) => c.estado !== 'aberta');
    const srv = servidor({ dados });
    const { page, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    await abrirLink(page);
    await page.getByText('Nada pendente por aqui.').waitFor();
    assert.equal(await page.getByRole('link', { name: /Ver e responder/ }).count(), 0);
    await capturar(page, '09-nada-pendente-390');
    assert.deepEqual(errosDeApp(erros), []);
  });

  await cenario('AC9', '320 px, 390 (toque) e 1440: sem rolagem horizontal; botões com alvo ≥ 44 px', async (abrir) => {
    const medidas = [];
    for (const [largura, altura, toque] of [[320, 640, true], [390, 844, true], [1440, 900, false]]) {
      const srv = servidor();
      const { page, context, erros } = await abrir({ custom: srv.custom, viewport: { width: largura, height: altura }, toque });
      await dropbox(context, video);
      await abrirLink(page);
      assert.equal(await rolagemLateral(page), 0, `${largura}: lista com rolagem lateral`);
      if (largura !== 390) await capturar(page, `10-lista-${largura}`);
      await abrirChamada(page);
      await page.waitForFunction(() => [...document.querySelectorAll('.apc-slide img')].every((i) => i.complete));
      assert.equal(await rolagemLateral(page), 0, `${largura}: chamada com rolagem lateral`);
      for (const nome of ['Aprovar', 'Pedir ajustes']) {
        const caixa = await page.getByRole('button', { name: nome, exact: true }).boundingBox();
        assert.ok(caixa && caixa.height >= 44, `${largura}: "${nome}" com ${caixa?.height}px de altura`);
        assert.ok(caixa.x >= 0 && caixa.x + caixa.width <= largura, `${largura}: "${nome}" dentro da tela`);
      }
      // Os botões ficam à vista sem rolar (presos ao pé).
      const aprovar = await page.getByRole('button', { name: 'Aprovar', exact: true }).boundingBox();
      assert.ok(aprovar.y + aprovar.height <= altura, `${largura}: "Aprovar" à vista sem rolar (y=${aprovar.y})`);
      if (largura !== 390) {
        await capturar(page, `11-chamada-${largura}`);
      }
      await page.getByRole('button', { name: 'Pedir ajustes' }).click();
      await page.getByLabel(/O que precisa mudar\?/).waitFor();
      assert.equal(await rolagemLateral(page), 0, `${largura}: painel de ajustes com rolagem lateral`);
      assert.deepEqual(errosDeApp(erros), []);
      medidas.push(`${largura}px ok`);
    }
    return medidas.join(' · ');
  });

  await cenario('AC10', 'a arte anexada aparece no carrossel pela rota da imagem do link, junto do vídeo do Dropbox', async (abrir) => {
    const dados = dadosDeExemplo();
    const aberta = dados.chamadas.find((c) => c.id === ABERTA);
    const ARTE = 'a1f0c000-0000-4000-8000-0000000000a9';
    aberta.itens = [
      { id: ARTE, ordem: 1, tipo: 'image', nome: 'capa-anexada.png', forma: 'anexo', exibicao: null, abrirNoDropbox: null },
      ...aberta.itens.filter((i) => i.tipo === 'video').map((i) => ({ ...i, ordem: 2 })),
    ];
    const srv = servidor({ dados });
    const { page, context, erros } = await abrir({ custom: srv.custom, ...MOVEL });
    await dropbox(context, video);
    const imagens = [];
    let falhar = false;
    // Registrada depois da API fictícia: esta rota vence para a imagem.
    await context.route(/\/api\/public\/aprovacao\/[^/]+\/chamadas\/[^/]+\/itens\/[^/]+\/imagem$/, async (route) => {
      imagens.push({ caminho: new URL(route.request().url()).pathname, referer: route.request().headers()['referer'] ?? null });
      if (falhar) return route.fulfill({ status: 502, contentType: 'application/json', body: '{"message":"x"}' });
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svgDe('capa-colecao.jpg') });
    });
    const fora = vigiarPedidos(page);
    await abrirLink(page);
    await abrirChamada(page);
    const slide = page.locator('.apc-slide[data-forma="anexo"]');
    await slide.waitFor();
    const nomes = await page.locator('.apc-slide figcaption').allInnerTexts();
    assert.deepEqual(nomes.map((n) => n.replace(/^\d+\s*/, '')), ['capa-anexada.png', 'reels-final.mp4']);
    const src = await slide.locator('img').getAttribute('src');
    assert.equal(src, `/api/public/aprovacao/${TOKEN}/chamadas/${ABERTA}/itens/${ARTE}/imagem`);
    await page.waitForFunction(() => {
      const i = document.querySelector('.apc-slide[data-forma="anexo"] img');
      return i && i.complete && i.naturalWidth > 0;
    });
    assert.ok(imagens.length >= 1 && imagens.every((x) => x.referer === null), `a imagem sai sem Referer: ${JSON.stringify(imagens)}`);
    assert.deepEqual(fora, [], 'só a API pública do link');
    await capturar(page, '12-arte-anexada-390');

    // A arte que não carrega recebe a mesma orientação, e "Tentar de novo" carrega.
    falhar = true;
    await page.reload();
    await page.locator('.apc-slide[data-forma="anexo"]').getByText('Não abriu? Tente de novo ou fale com o atendimento.').waitFor();
    falhar = false;
    await page.locator('.apc-slide[data-forma="anexo"]').getByRole('button', { name: 'Tentar de novo' }).click();
    await page.waitForFunction(() => {
      const i = document.querySelector('.apc-slide[data-forma="anexo"] img');
      return i && i.complete && i.naturalWidth > 0;
    });
    assert.deepEqual(errosDeApp(erros), []);
    return `arte anexada pela rota do link (${imagens.length} pedidos, sem Referer) + vídeo do Dropbox`;
  });

  if (!video) console.log('  (aviso: o Chrome não gravou o vídeo de exemplo; o vídeo responde 404 nas capturas)');
  return resultados;
}
