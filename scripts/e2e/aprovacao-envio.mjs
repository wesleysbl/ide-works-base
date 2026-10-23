/**
 * "SOLICITAR APROVAÇÃO" NO CARD — F42, Fase 4, no Chrome real (API simulada).
 *
 * O servidor aqui é FICTÍCIO e tem estado: ele imita a rota de verdade
 * (`POST/GET /api/board/tasks/:id/approval-rounds`) nas regras que importam
 * para a tela — só link do Dropbox (400 com a frase, nada gravado), versão
 * seguinte, a aberta vira "substituída", o card vai para "aguardando cliente".
 * Os pedidos ao Dropbox (a prévia) são respondidos aqui também: imagem vira um
 * SVG local; vídeo responde 404 (a tela diz que não carregou). Nada sai da
 * máquina. As regras da rota e do banco estão provadas em
 * `test/aprovacao-envio-rotas.test.ts` e `src/server/aprovacao-do-cliente-banco.test.ts`.
 *
 *   AE1  3 imagens + 1 vídeo: a janela pré-lista os links do card (anexos,
 *        descrição, comentário), a pessoa inclui, reordena pelo teclado e
 *        envia; a v1 é gravada NA ORDEM escolhida e o card aparece em
 *        "Aguardando cliente"; a ficha mostra a rodada;
 *   AE2  link que não é do Dropbox é recusado com a frase e nada é gravado;
 *   AE3  segundo envio no mesmo card cria a v2 e a v1 aparece "substituída";
 *   AE4  cliente sem a chave: a ficha não mostra o botão (nem a seção);
 *   AE5  esteira sem os três destinos: a seção diz o que falta e o admin abre a
 *        configuração dali mesmo; o "Salvar destinos" está à vista sem rolar;
 *   AE6  320 px: ficha com a seção e a janela sem rolagem lateral.
 *   AE7  F42, Fase 9: as artes ANEXADAS ao card aparecem como sugestão com
 *        miniatura (imagem permanente; PDF e print temporário ficam de fora),
 *        entram no carrossel junto de um link do Dropbox, na ordem, e vão no
 *        corpo como `{ anexo }` / `{ link }`.
 *
 * `APROVACAO_CAPTURAS=<pasta>` grava janela, prévia, ficha com rodadas e 320 px.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, detail, sessaoDe } from './comum.mjs';

const CLIENTE = 'cx-1';
const CLIENTE_DESLIGADO = 'cx-2';
const LISTA = 'ap-l1';
const CARD = 'ap-t1';
const CARD_DESLIGADO = 'ap-t2';

const ETAPAS = [
  { id: 'ap-fazer', name: 'a fazer', type: 'open', color: '#8b8b8b', sortOrder: 0 },
  { id: 'ap-aguardando', name: 'aguardando cliente', type: 'custom', color: '#ffb020', sortOrder: 1 },
  { id: 'ap-aprovado', name: 'aprovado', type: 'custom', color: '#00c853', sortOrder: 2 },
  { id: 'ap-refacao', name: 'refação', type: 'custom', color: '#ff6b6b', sortOrder: 3 },
];

const DBX = {
  arte1: 'https://www.dropbox.com/scl/fi/a1/arte-1.jpg?rlkey=k1&dl=0',
  arte2: 'https://www.dropbox.com/scl/fi/a2/arte-2.png?rlkey=k2&dl=0',
  arte3: 'https://www.dropbox.com/scl/fi/a3/arte-3.webp?rlkey=k3&dl=0',
  video: 'https://www.dropbox.com/scl/fi/v1/reels-final.mp4?rlkey=k4&dl=0',
  pasta: 'https://www.dropbox.com/scl/fo/p1/AAchave?rlkey=k5&dl=0',
};

const nomeDe = (url) => (/\/scl\/fo\//.test(url) ? 'Pasta do Dropbox' : decodeURIComponent(new URL(url).pathname.split('/')[4] ?? ''));
const tipoDe = (url) =>
  /\/scl\/fo\//.test(url) ? 'other' : /\.(mp4|mov|m4v|webm)$/i.test(nomeDe(url)) ? 'video' : /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(nomeDe(url)) ? 'image' : 'other';

const pessoa = (id, name) => ({ id, name });

// F42, Fase 9 — as artes anexadas ao card (a do comentário é citada nele).
const ANEXOS = [
  { id: '00000000-0000-0000-0000-0000000a0001', fileName: 'capa-outubro.png', extension: 'png', contentType: 'image/png', byteSize: 120000, uploadedBy: null, createdAt: '2026-10-07T11:00:00Z', expiresAt: null },
  { id: '00000000-0000-0000-0000-0000000a0002', fileName: 'miolo.jpg', extension: 'jpg', contentType: 'image/jpeg', byteSize: 420000, uploadedBy: null, createdAt: '2026-10-07T11:01:00Z', expiresAt: null },
  { id: '00000000-0000-0000-0000-0000000a0003', fileName: 'roteiro.pdf', extension: 'pdf', contentType: 'application/pdf', byteSize: 9000, uploadedBy: null, createdAt: '2026-10-07T11:02:00Z', expiresAt: null },
  { id: '00000000-0000-0000-0000-0000000a0004', fileName: 'print.png', extension: 'png', contentType: 'image/png', byteSize: 9000, uploadedBy: null, createdAt: '2026-10-07T11:03:00Z', expiresAt: '2026-10-17T11:03:00Z', inText: true },
];

/** Os materiais do corpo, como a tela os manda: `{ link }` ou `{ anexo }`; a forma antiga `{ links }` também. */
const materiaisDe = (corpo) => corpo.materiais ?? (corpo.links ?? []).map((link) => ({ link }));
const rotuloDe = (m) => (m.link ? m.link : `anexo:${m.anexo}`);

function fichaDe(id, { clientId, clientName, statusId = 'ap-fazer' }) {
  return {
    ...detail,
    id,
    title: 'Carrossel da promoção de outubro',
    description: `Legenda: chegou a coleção nova! Corre que é por tempo limitado.\n\nVídeo: ${DBX.video}`,
    listId: LISTA,
    listName: 'Conteúdo mensal',
    clientId,
    clientName,
    statusId,
    statuses: ETAPAS,
    statusSetName: 'Fluxo de aprovação',
    attachments: ANEXOS,
    links: [
      { id: 'lk1', label: 'Arte 1', url: DBX.arte1, sortOrder: 0, createdBy: pessoa('u1', 'Helena'), createdAt: '2026-10-07T12:00:00Z' },
      { id: 'lk2', label: 'Arte 2', url: DBX.arte2, sortOrder: 1, createdBy: pessoa('u1', 'Helena'), createdAt: '2026-10-07T12:00:00Z' },
      { id: 'lk3', label: 'Arte 3', url: DBX.arte3, sortOrder: 2, createdBy: pessoa('u1', 'Helena'), createdAt: '2026-10-07T12:00:00Z' },
      { id: 'lk4', label: 'Roteiro', url: 'https://docs.google.com/document/d/abc/edit', sortOrder: 3, createdBy: null, createdAt: '2026-10-07T12:00:00Z' },
    ],
    comments: [
      {
        id: 'cm1', parentId: null, body: `Brutos na pasta: ${DBX.pasta}`, author: pessoa('u2', 'Juca'),
        createdAt: '2026-10-07T13:00:00Z', editedAt: null, replyCount: 0, mine: false, replies: [],
      },
      {
        id: 'cm2', parentId: null, body: `Miolo aprovado internamente ![Imagem anexada](attachment:${ANEXOS[1].id})`, author: pessoa('u1', 'Helena'),
        createdAt: '2026-10-07T13:10:00Z', editedAt: null, replyCount: 0, mine: false, replies: [],
      },
    ],
  };
}

function servidor({ admin = true, destinos = true } = {}) {
  const estado = {
    statusId: 'ap-fazer',
    rodadas: [], // { version, state, links, sentAt }
    envios: [], // corpo de cada POST
    alvos: destinos ? { a: 'ap-aguardando', b: 'ap-aprovado', c: 'ap-refacao' } : { a: 'ap-aguardando', b: null, c: null },
    escritasDaEsteira: [],
  };
  const tarefa = (id) =>
    id === CARD
      ? fichaDe(CARD, { clientId: CLIENTE, clientName: 'Horizonte Studio', statusId: estado.statusId })
      : fichaDe(CARD_DESLIGADO, { clientId: CLIENTE_DESLIGADO, clientName: 'Charme Modas' });

  const aprovacao = (id) => {
    const ligado = id === CARD;
    const missing = [!estado.alvos.a && 'aguardando cliente', !estado.alvos.b && 'aprovado', !estado.alvos.c && 'reprovado'].filter(Boolean);
    return {
      taskId: id,
      listId: LISTA,
      clientId: ligado ? CLIENTE : CLIENTE_DESLIGADO,
      clientName: ligado ? 'Horizonte Studio' : 'Charme Modas',
      enabled: ligado,
      configured: missing.length === 0,
      missing,
      awaitingStatusName: 'aguardando cliente',
      canConfigure: admin,
      canCopyLink: admin,
      rounds: ligado
        ? [...estado.rodadas]
            .sort((x, y) => y.version - x.version)
            .map((r) => ({
              id: `rd-${r.version}`,
              version: r.version,
              state: r.state,
              sentAt: r.sentAt,
              sentBy: 'Ana Revisora',
              decidedAt: null,
              closedAt: r.state === 'open' ? null : r.sentAt,
              items: r.materiais.map((m, i) =>
                m.link
                  ? { position: i + 1, url: m.link, kind: tipoDe(m.link), fileName: nomeDe(m.link), source: 'dropbox' }
                  : { position: i + 1, url: null, kind: 'image', fileName: ANEXOS.find((a) => a.id === m.anexo)?.fileName ?? 'arte', source: 'anexo' },
              ),
            }))
        : [],
    };
  };

  const custom = (url, req) => {
    const p = url.pathname;
    const metodo = req.method();
    if (p === '/api/auth/me')
      return { body: { ...sessaoDe(), isSuperadmin: admin, isSuper: admin, papel: admin ? 'super_admin' : 'funcionario', areas: ['entrega', 'quadro'] } };

    const rodadas = /^\/api\/board\/tasks\/([^/]+)\/approval-rounds$/.exec(p);
    if (rodadas) {
      const id = rodadas[1];
      if (metodo === 'GET') return { body: { ok: true, approval: aprovacao(id) } };
      const corpo = req.postDataJSON();
      const materiais = materiaisDe(corpo);
      estado.envios.push({ ...corpo, links: materiais.map(rotuloDe) });
      const ruim = materiais.findIndex((m) =>
        m.link
          ? !/^https:\/\/(www\.)?dropbox\.com\/(scl\/fi|scl\/fo|s|sh)\//.test(m.link)
          : !ANEXOS.some((a) => a.id === m.anexo && a.contentType.startsWith('image/') && !a.expiresAt),
      );
      if (ruim >= 0) return { status: 400, body: { message: `O ${ruim + 1}º material não pode ir ao cliente.` } };
      let superseded = 0;
      for (const r of estado.rodadas) if (r.state === 'open') { r.state = 'superseded'; superseded++; }
      const version = estado.rodadas.length + 1;
      estado.rodadas.push({ version, state: 'open', materiais, sentAt: `2026-10-07T19:${String(10 + version).padStart(2, '0')}:00Z` });
      estado.statusId = 'ap-aguardando';
      return { status: 201, body: { ok: true, roundId: `rd-${version}`, version, superseded, approval: aprovacao(id), task: tarefa(id) } };
    }
    if (p === '/api/board/attachments/urls' && metodo === 'POST') {
      const { ids } = req.postDataJSON();
      estado.lotesDeMiniaturas = [...(estado.lotesDeMiniaturas ?? []), ids];
      const urls = Object.fromEntries(
        ids.map((id) => [id, { url: `https://storage.invalid/assinado/${id}.png?token=t`, expiresAt: '2026-10-07T20:00:00Z' }]),
      );
      return { body: { ok: true, urls } };
    }
    const ficha = /^\/api\/board\/tasks\/([^/]+)$/.exec(p);
    if (ficha && metodo === 'GET') return { body: { ok: true, task: tarefa(ficha[1]), storage: { ready: false, variable: '' } } };

    if (p === `/api/board/lists/${LISTA}/approval-targets`) {
      if (metodo === 'PUT') {
        const b = req.postDataJSON();
        estado.escritasDaEsteira.push(b);
        estado.alvos = { a: b.awaitingStatusId, b: b.approvedStatusId, c: b.rejectedStatusId };
      }
      return {
        body: {
          ok: true,
          approval: {
            listId: LISTA,
            statusSetId: 'set-ap',
            statusSetName: 'Fluxo de aprovação',
            inheritedFrom: 'list',
            statuses: ETAPAS.map(({ id, name, type, color }) => ({ id, name, type, color })),
            targets: { awaitingStatusId: estado.alvos.a, approvedStatusId: estado.alvos.b, rejectedStatusId: estado.alvos.c },
            complete: Boolean(estado.alvos.a && estado.alvos.b && estado.alvos.c),
          },
        },
      };
    }
    return null;
  };
  return { estado, custom };
}

/** As mídias da prévia: imagem é um SVG daqui; vídeo, 404. Nada vai ao Dropbox. */
async function dropboxLocal(context) {
  await context.route('https://www.dropbox.com/**', async (route) => {
    const u = new URL(route.request().url());
    const nome = u.pathname.split('/').pop() ?? '';
    if (/\.(jpe?g|png|webp)$/i.test(nome)) {
      const cor = { 'arte-1.jpg': '#ffb020', 'arte-2.png': '#00c853', 'arte-3.webp': '#5b8cff' }[nome] ?? '#888';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="${cor}"/><text x="540" y="560" font-size="96" text-anchor="middle" fill="#111">${nome}</text></svg>`;
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });
  // A miniatura assinada das artes anexadas (F42, Fase 9): um SVG daqui.
  await context.route('https://storage.invalid/**', async (route) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#c084fc"/></svg>';
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
  });
}

const CAPTURAS = process.env.APROVACAO_CAPTURAS;
const capturar = async (page, nome, alvo = null) => {
  if (!CAPTURAS) return;
  await page.waitForTimeout(500);
  if (alvo) await alvo.screenshot({ path: `${CAPTURAS}/${nome}.png` });
  else await page.screenshot({ path: `${CAPTURAS}/${nome}.png`, fullPage: false });
};

const semRolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function abrirFicha(page, id = CARD) {
  await page.goto(`${BASE}/tarefa/${id}`);
  await page.getByRole('textbox', { name: 'Título da tarefa', exact: true }).waitFor({ timeout: 10000 });
}

const janelaDe = (page) => page.getByRole('dialog', { name: 'Solicitar aprovação do cliente' });

const ordemNaJanela = (janela) =>
  janela.locator('[data-ordem-aprovacao] [data-material]').evaluateAll((els) => els.map((e) => e.getAttribute('data-material')));

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('AE1', '3 imagens + 1 vídeo: inclui do card, reordena pelo teclado, envia; v1 na ordem e card em "Aguardando cliente"', async (abrir) => {
    const s = servidor();
    const { page, context } = await abrir({ custom: s.custom });
    await dropboxLocal(context);
    await abrirFicha(page);
    const secao = page.locator('[data-aprovacao-card]');
    await secao.waitFor();
    await secao.getByRole('button', { name: 'Solicitar aprovação', exact: true }).click();
    const janela = janelaDe(page);
    await janela.waitFor();

    // Pré-lista: 3 anexos + o vídeo da descrição + a pasta do comentário. O Google Doc fica de fora.
    const sugestoes = await janela.locator('[data-sugestao]').evaluateAll((els) => els.map((e) => e.getAttribute('data-sugestao')));
    assert.deepEqual(sugestoes, [DBX.arte1, DBX.arte2, DBX.arte3, DBX.video, DBX.pasta]);
    await janela.getByText('· comentário de Juca').waitFor();
    assert.equal(await janela.locator('[data-enviar-aprovacao]').isDisabled(), true, 'sem material, não envia');

    // O vídeo primeiro, depois as três artes.
    await janela.getByRole('button', { name: 'Incluir reels-final.mp4', exact: true }).click();
    for (const n of ['arte-1.jpg', 'arte-2.png', 'arte-3.webp']) await janela.getByRole('button', { name: `Incluir ${n}`, exact: true }).click();
    assert.deepEqual(await ordemNaJanela(janela), [DBX.video, DBX.arte1, DBX.arte2, DBX.arte3]);

    // Reordena PELO TECLADO: a arte 3 sobe duas posições (vira 2ª, atrás do
    // vídeo); depois o vídeo desce até o fim.
    await janela.getByRole('button', { name: 'Subir arte-3.webp', exact: true }).focus();
    await page.keyboard.press('Enter');
    await janela.getByRole('button', { name: 'Subir arte-3.webp', exact: true }).focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 3; i++) {
      await janela.getByRole('button', { name: 'Descer reels-final.mp4', exact: true }).focus();
      await page.keyboard.press('Enter');
    }
    const escolhida = [DBX.arte3, DBX.arte1, DBX.arte2, DBX.video];
    assert.deepEqual(await ordemNaJanela(janela), escolhida);

    // A legenda à vista, e a prévia "como o cliente verá".
    assert.match(await janela.locator('[data-legenda]').innerText(), /chegou a coleção nova/);
    await capturar(page, 'f4-janela');
    await janela.getByRole('button', { name: 'Ver como o cliente verá', exact: true }).click();
    const previa = janela.locator('[data-previa-aprovacao]');
    await previa.waitFor();
    const srcs = await previa.locator('img').evaluateAll((els) => els.map((e) => [e.getAttribute('src'), e.referrerPolicy]));
    assert.deepEqual(srcs.map((x) => x[0]), [
      'https://www.dropbox.com/scl/fi/a3/arte-3.webp?rlkey=k3&raw=1',
      'https://www.dropbox.com/scl/fi/a1/arte-1.jpg?rlkey=k1&raw=1',
      'https://www.dropbox.com/scl/fi/a2/arte-2.png?rlkey=k2&raw=1',
    ]);
    assert.ok(srcs.every((x) => x[1] === 'no-referrer'), 'imagens sem Referer');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-previa-aprovacao] img')].every((i) => i.complete && i.naturalWidth > 0));
    await previa.locator('[data-previa-tipo="image"]').first().scrollIntoViewIfNeeded();
    await capturar(page, 'f4-previa');

    await janela.locator('[data-enviar-aprovacao]').click();
    await janela.waitFor({ state: 'detached' });
    assert.equal(s.estado.envios.length, 1);
    assert.deepEqual(s.estado.envios[0].links, escolhida, 'gravado na ordem escolhida');
    assert.equal(s.estado.rodadas[0].version, 1);

    await page.getByText('Versão 1 enviada. O card foi para "aguardando cliente".').waitFor();
    // F43, Fase 6: o rótulo "Status" da ficha virou "Etapa".
    const status = page.locator('.t-prop', { has: page.locator('dt', { hasText: 'Etapa' }) });
    await status.getByText('Aguardando cliente', { exact: true }).waitFor();
    const linha = secao.locator('[data-rodada="1"]');
    await linha.waitFor();
    assert.equal(await linha.getAttribute('data-estado'), 'open');
    assert.match(await linha.innerText(), /aguardando o cliente/);
    assert.match(await linha.innerText(), /4 materiais/);
    await secao.getByRole('button', { name: 'Enviar nova versão', exact: true }).waitFor();
    await secao.scrollIntoViewIfNeeded();
    await capturar(page, 'f4-ficha-v1', secao);
    return `v1: ${escolhida.map(nomeDe).join(' → ')}; card em "Aguardando cliente"`;
  });

  await cenario('AE2', 'link que não é do Dropbox: recusado com a frase e nada é gravado', async (abrir) => {
    const s = servidor();
    const { page, context } = await abrir({ custom: s.custom });
    await dropboxLocal(context);
    await abrirFicha(page);
    await page.locator('[data-aprovacao-card]').getByRole('button', { name: 'Solicitar aprovação', exact: true }).click();
    const janela = janelaDe(page);
    await janela.getByRole('textbox', { name: /Colar links do Dropbox/ }).fill('https://drive.google.com/file/d/xyz/view');
    await janela.getByRole('button', { name: 'Adicionar', exact: true }).click();
    const recusa = janela.locator('[data-recusa-link]');
    await recusa.waitFor();
    assert.match(await recusa.innerText(), /^O 1º link não é um link de compartilhamento do Dropbox/);
    assert.equal(await janela.locator('[data-ordem-aprovacao]').count(), 0, 'nada entrou no carrossel');
    assert.equal(await janela.locator('[data-enviar-aprovacao]').isDisabled(), true);

    // Um link bom colado sem `https://` entra normalizado.
    await janela.getByRole('textbox', { name: /Colar links do Dropbox/ }).fill('www.dropbox.com/scl/fi/zz/extra.jpg?rlkey=q&dl=0');
    await janela.getByRole('button', { name: 'Adicionar', exact: true }).click();
    assert.deepEqual(await ordemNaJanela(janela), ['https://www.dropbox.com/scl/fi/zz/extra.jpg?rlkey=q&dl=0']);
    await janela.getByRole('button', { name: 'Tirar extra.jpg', exact: true }).click();
    await janela.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await janela.waitFor({ state: 'detached' });
    assert.equal(s.estado.envios.length, 0, 'nenhum envio');
    assert.equal(s.estado.rodadas.length, 0, 'nada gravado');

    // O servidor recusa do mesmo jeito (a tela não é a trava).
    const r = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/board/tasks/${id}/approval-rounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links: ['https://drive.google.com/file/d/xyz/view'] }),
      });
      return resp.status;
    }, CARD);
    assert.equal(r, 400);
    assert.equal(s.estado.rodadas.length, 0);
    return 'frase na janela; 0 rodadas gravadas';
  });

  await cenario('AE3', 'segundo envio no mesmo card: v2 aberta e v1 "substituída"', async (abrir) => {
    const s = servidor();
    const { page, context } = await abrir({ custom: s.custom });
    await dropboxLocal(context);
    await abrirFicha(page);
    const secao = page.locator('[data-aprovacao-card]');
    await secao.getByRole('button', { name: 'Solicitar aprovação', exact: true }).click();
    let janela = janelaDe(page);
    await janela.getByRole('button', { name: 'Incluir todos', exact: true }).click();
    await janela.getByRole('button', { name: 'Tirar Pasta do Dropbox', exact: true }).click();
    await janela.locator('[data-enviar-aprovacao]').click();
    await janela.waitFor({ state: 'detached' });
    await secao.locator('[data-rodada="1"]').waitFor();

    await secao.getByRole('button', { name: 'Enviar nova versão', exact: true }).click();
    janela = janelaDe(page);
    await janela.getByText('A versão 1, ainda aberta, será substituída.', { exact: false }).waitFor();
    await janela.getByRole('button', { name: 'Incluir arte-2.png', exact: true }).click();
    await janela.getByRole('button', { name: 'Incluir reels-final.mp4', exact: true }).click();
    await janela.locator('[data-enviar-aprovacao]').click();
    await janela.waitFor({ state: 'detached' });

    await page.getByText('Versão 2 enviada (a anterior foi substituída).', { exact: false }).waitFor();
    const v2 = secao.locator('[data-rodada="2"]');
    const v1 = secao.locator('[data-rodada="1"]');
    await v2.waitFor();
    assert.equal(await v2.getAttribute('data-estado'), 'open');
    assert.equal(await v1.getAttribute('data-estado'), 'superseded');
    assert.match(await v1.innerText(), /substituída/);
    const ordem = await secao.locator('[data-rodada]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rodada')));
    assert.deepEqual(ordem, ['2', '1'], 'a mais nova primeiro');
    assert.deepEqual(s.estado.envios[1].links, [DBX.arte2, DBX.video]);
    await secao.scrollIntoViewIfNeeded();
    await capturar(page, 'f4-ficha-com-rodadas', secao);
    return 'v2 aberta; v1 substituída';
  });

  await cenario('AE4', 'cliente sem a chave: a ficha não mostra o botão', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom });
    let pediu = false;
    page.on('request', (r) => { if (r.url().includes(`/tasks/${CARD_DESLIGADO}/approval-rounds`)) pediu = true; });
    await abrirFicha(page, CARD_DESLIGADO);
    await page.waitForFunction(() => document.querySelector('.cu-carimbos') !== null);
    await page.waitForTimeout(400);
    assert.equal(pediu, true, 'a ficha perguntou');
    assert.equal(await page.locator('[data-aprovacao-card]').count(), 0, 'sem seção');
    assert.equal(await page.getByRole('button', { name: 'Solicitar aprovação' }).count(), 0, 'sem botão');
    return 'sem seção e sem botão';
  });

  await cenario('AE5', 'esteira sem destinos: diz o que falta e o admin configura dali; "Salvar destinos" à vista sem rolar', async (abrir) => {
    const s = servidor({ destinos: false });
    const { page } = await abrir({ custom: s.custom });
    await abrirFicha(page);
    const secao = page.locator('[data-aprovacao-card][data-situacao="sem-destinos"]');
    await secao.waitFor();
    await secao.getByText('Falta escolher: "aprovado", "reprovado".', { exact: false }).waitFor();
    assert.equal(await secao.getByRole('button', { name: 'Solicitar aprovação' }).count(), 0);
    // F43, Fase 6: "Configurar a esteira" virou "Configurar as etapas" (o vocabulário da ficha).
    await secao.getByRole('button', { name: 'Configurar as etapas', exact: true }).click();
    const caixa = page.locator('[data-aprovacao-esteira]');
    await caixa.waitFor();
    const salvar = caixa.getByRole('button', { name: 'Salvar destinos', exact: true });
    // O botão está DENTRO da parte visível do balão e da janela, sem rolar nada.
    const dentro = await salvar.evaluate((b) => {
      const balao = b.closest('.cu-balao');
      const rb = b.getBoundingClientRect();
      const rl = balao.getBoundingClientRect();
      return rb.top >= rl.top && rb.bottom <= rl.bottom + 1 && rb.bottom <= window.innerHeight && rb.top >= 0;
    });
    assert.equal(dentro, true, 'Salvar destinos à vista');
    await caixa.getByRole('combobox', { name: 'Etapa de Aprovado' }).selectOption('ap-aprovado');
    await caixa.getByRole('combobox', { name: 'Etapa de Reprovado (refação)' }).selectOption('ap-refacao');
    await capturar(page, 'f4-configurar-do-card');
    await salvar.click();
    await caixa.getByText('Salvo.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('[data-aprovacao-card][data-situacao="pronto"]').getByRole('button', { name: 'Solicitar aprovação', exact: true }).waitFor();
    return 'faltava aprovado/reprovado; salvo do card; botão apareceu';
  });

  await cenario('AE6', '320 px: ficha com a seção e a janela sem rolagem lateral', async (abrir) => {
    const s = servidor();
    const { page, context } = await abrir({ custom: s.custom, viewport: { width: 320, height: 720 } });
    await dropboxLocal(context);
    await abrirFicha(page);
    const secao = page.locator('[data-aprovacao-card]');
    await secao.scrollIntoViewIfNeeded();
    assert.equal(await semRolagemLateral(page), true, 'ficha a 320 sem rolagem lateral');
    await secao.getByRole('button', { name: 'Solicitar aprovação', exact: true }).click();
    const janela = janelaDe(page);
    await janela.getByRole('button', { name: 'Incluir todos', exact: true }).click();
    await janela.getByRole('button', { name: 'Ver como o cliente verá', exact: true }).click();
    await janela.locator('[data-previa-aprovacao]').waitFor();
    assert.equal(await semRolagemLateral(page), true, 'janela a 320 sem rolagem lateral');
    const r = await janela.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, scroll: el.scrollWidth <= el.clientWidth };
    });
    assert.ok(r.left >= 0 && r.right <= 320, `a janela cabe (left=${r.left}, right=${r.right})`);
    assert.equal(r.scroll, true, 'nada rola de lado dentro da janela');
    await capturar(page, 'f4-janela-320');
    await janela.locator('[data-enviar-aprovacao]').click();
    await janela.waitFor({ state: 'detached' });
    await secao.locator('[data-rodada="1"]').waitFor();
    await secao.scrollIntoViewIfNeeded();
    assert.equal(await semRolagemLateral(page), true, 'ficha com a rodada a 320 sem rolagem lateral');
    await capturar(page, 'f4-ficha-320');
    return 'ficha e janela cabem em 320 px';
  });

  await cenario('AE7', 'artes anexadas: sugeridas com miniatura, enviadas junto de um link do Dropbox, na ordem', async (abrir) => {
    const s = servidor();
    const { page, context } = await abrir({ custom: s.custom });
    await dropboxLocal(context);
    await abrirFicha(page);
    const secao = page.locator('[data-aprovacao-card]');
    await page.waitForTimeout(600);
    const lotesAntes = (s.estado.lotesDeMiniaturas ?? []).length;
    await secao.getByRole('button', { name: 'Solicitar aprovação', exact: true }).click();
    const janela = janelaDe(page);
    await janela.waitFor();

    // Só imagem permanente: o PDF e o print temporário da conversa ficam de fora.
    const artes = janela.locator('[data-sugestao-anexo]');
    await artes.first().waitFor();
    assert.deepEqual(
      await artes.evaluateAll((els) => els.map((e) => e.getAttribute('data-sugestao-anexo'))),
      [ANEXOS[0].id, ANEXOS[1].id],
    );
    await janela.getByText('· comentário de Helena').waitFor();
    // Miniaturas assinadas num pedido só, ao abrir a janela (a ficha assina as
    // imagens dela por conta própria; o lote da janela é o das duas artes).
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-sugestao-anexo] img[data-miniatura]')].length === 2 &&
      [...document.querySelectorAll('[data-sugestao-anexo] img[data-miniatura]')].every((i) => i.complete && i.naturalWidth > 0),
    );
    const lotesDaJanela = s.estado.lotesDeMiniaturas.slice(lotesAntes);
    assert.deepEqual(lotesDaJanela, [[ANEXOS[0].id, ANEXOS[1].id]], `um lote só, ao abrir a janela (antes: ${lotesAntes})`);
    await capturar(page, 'f9-janela-anexos');

    // Carrossel: capa (anexo) → vídeo (Dropbox) → miolo (anexo).
    await janela.getByRole('button', { name: 'Incluir capa-outubro.png', exact: true }).click();
    await janela.getByRole('button', { name: 'Incluir reels-final.mp4', exact: true }).click();
    await janela.getByRole('button', { name: 'Incluir miolo.jpg', exact: true }).click();
    assert.deepEqual(await ordemNaJanela(janela), [`anexo:${ANEXOS[0].id}`, DBX.video, `anexo:${ANEXOS[1].id}`]);
    await janela.getByText('Todas já estão no carrossel.').waitFor();

    // A prévia mostra as artes como o cliente verá.
    await janela.getByRole('button', { name: 'Ver como o cliente verá', exact: true }).click();
    const previa = janela.locator('[data-previa-aprovacao]');
    await previa.waitFor();
    assert.equal(await previa.locator('[data-previa-tipo="anexo"] img').count(), 2);
    await capturar(page, 'f9-previa-anexos');

    await janela.locator('[data-enviar-aprovacao]').click();
    await janela.waitFor({ state: 'detached' });
    assert.deepEqual(s.estado.envios[0].materiais, [{ anexo: ANEXOS[0].id }, { link: DBX.video }, { anexo: ANEXOS[1].id }]);
    await page.getByText('Versão 1 enviada. O card foi para "aguardando cliente".').waitFor();
    assert.match(await secao.locator('[data-rodada="1"]').innerText(), /3 materiais/);
    return '2 artes com miniatura + 1 vídeo, enviados na ordem como { anexo } / { link }';
  });

  return resultados;
}
