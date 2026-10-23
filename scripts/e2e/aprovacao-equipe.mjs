/**
 * DO LADO DA EQUIPE — F42, Fase 7, no Chrome real (API simulada).
 *
 * O servidor aqui é FICTÍCIO e tem estado: o card já tem a v1 enviada ao
 * cliente ("aguardando o cliente"). No meio do cenário o CLIENTE reprova pela
 * rota pública simulada (`POST /api/public/aprovacao/:token/chamadas/:id/reprovar`),
 * e o servidor faz o que `decide_approval_round` faz no banco: a rodada vira
 * "ajustes pedidos" com data e "pelo cliente", o motivo entra na conversa como
 * comentário DO CLIENTE (sem autor), o card vai para "refação" com o evento
 * "Aprovação do cliente", e o sino de quem enviou ganha um aviso
 * `approval:<rodada>`. A regra de quem recebe o aviso (quem enviou e os
 * responsáveis, só com alcance) está provada no Postgres em
 * `src/server/aprovacao-sino-banco.test.ts`; aqui se prova a TELA.
 *
 *   AQ1  depois do cliente reprovar: o card mostra o comentário com o selo
 *        "do cliente", "Cliente (pelo link)" e o material; a rodada "ajustes
 *        pedidos" com o motivo e "pelo cliente, pelo link"; o histórico tem
 *        "Aprovação do cliente"; o sino conta +1;
 *   AQ2  a caixa mostra "Cliente pediu ajustes", o atalho cai no comentário do
 *        cliente, e marcar como visto devolve o sino ao número de antes;
 *   AQ3  320 px: a ficha com o comentário do cliente e o motivo sem rolagem lateral.
 *
 * `APROVACAO_CAPTURAS=<pasta>` grava a ficha, a caixa e o 320 px.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, detail, sessaoDe } from './comum.mjs';

const CLIENTE = 'cx-1';
const LISTA = 'aq-l1';
const CARD = 'aq-t1';
const TOKEN = 'tok-cliente-horizonte';
const RODADA = 'rd-1';
const MOTIVO = 'A logo está pequena no segundo card e a música do vídeo está alta. Podem ajustar?';

const ETAPAS = [
  { id: 'aq-fazer', name: 'a fazer', type: 'open', color: '#8b8b8b', sortOrder: 0 },
  { id: 'aq-aguardando', name: 'aguardando cliente', type: 'custom', color: '#ffb020', sortOrder: 1 },
  { id: 'aq-aprovado', name: 'aprovado', type: 'custom', color: '#00c853', sortOrder: 2 },
  { id: 'aq-refacao', name: 'refação', type: 'custom', color: '#ff6b6b', sortOrder: 3 },
];

const ITENS = [
  { position: 1, url: 'https://www.dropbox.com/scl/fi/a1/arte-1.jpg?rlkey=k1&dl=0', kind: 'image', fileName: 'arte-1.jpg' },
  { position: 2, url: 'https://www.dropbox.com/scl/fi/a2/arte-2-com-um-nome-de-arquivo-bem-comprido-para-quebrar.png?rlkey=k2&dl=0', kind: 'image', fileName: 'arte-2-com-um-nome-de-arquivo-bem-comprido-para-quebrar.png' },
  { position: 3, url: 'https://www.dropbox.com/scl/fi/v1/reels-final.mp4?rlkey=k3&dl=0', kind: 'video', fileName: 'reels-final.mp4' },
];

/** Um aviso que já estava na caixa antes — para provar o +1, e não "virou 1". */
const AVISO_ANTIGO = {
  key: 'automation:9', tipo: 'automacao', taskId: 'outra', taskTitle: 'Post do dia das crianças', listName: 'Criação',
  clientName: 'Sabor Doce', occurredAt: '2026-10-07T12:00:00Z', dueOn: null, automationName: 'Passa para criação',
  fromListName: null, toListName: 'Criação', toStatusName: null, seen: false,
};

function servidor() {
  const estado = {
    statusId: 'aq-aguardando',
    rodada: { state: 'open', decidedAt: null, decidedVia: null, decisionComment: null },
    comentarios: [
      {
        id: 'cm-equipe', parentId: null, body: 'Enviado ao cliente pelo link.', author: { id: 'u-ana', name: 'Ana Revisora' },
        createdAt: '2026-10-07T19:11:00Z', editedAt: null, replyCount: 0, mine: true, replies: [],
      },
    ],
    eventos: [],
    avisos: [{ ...AVISO_ANTIGO }],
    decisoes: 0,
  };

  const tarefa = () => ({
    ...detail,
    id: CARD,
    title: 'Carrossel da promoção de outubro',
    description: 'Legenda: chegou a coleção nova!',
    listId: LISTA,
    listName: 'Conteúdo mensal',
    clientId: CLIENTE,
    clientName: 'Horizonte Studio',
    statusId: estado.statusId,
    statuses: ETAPAS,
    statusSetName: 'Fluxo de aprovação',
    comments: estado.comentarios.map((c) => ({ ...c })),
    history: estado.eventos.map((e) => ({ ...e })),
  });

  const aprovacao = () => ({
    taskId: CARD,
    listId: LISTA,
    clientId: CLIENTE,
    clientName: 'Horizonte Studio',
    enabled: true,
    configured: true,
    missing: [],
    awaitingStatusName: 'aguardando cliente',
    canConfigure: true,
    canCopyLink: true,
    rounds: [
      {
        id: RODADA,
        version: 1,
        state: estado.rodada.state,
        sentAt: '2026-10-07T19:11:00Z',
        sentBy: 'Ana Revisora',
        decidedAt: estado.rodada.decidedAt,
        decidedVia: estado.rodada.decidedVia,
        decisionComment: estado.rodada.decisionComment,
        closedAt: null,
        items: ITENS,
      },
    ],
  });

  /** O que `decide_approval_round` faz no banco, em miniatura. Decisão única. */
  const reprovar = (comentario) => {
    if (estado.rodada.state !== 'open') return { status: 409, body: { ok: false, message: 'Esta chamada já foi decidida.' } };
    if (!comentario || !comentario.trim()) return { status: 400, body: { ok: false, message: 'Diga o que precisa mudar.' } };
    estado.decisoes += 1;
    const quando = '2026-10-08T13:05:00Z';
    // Um comentário do cliente sobre um material, antes, e o da decisão.
    estado.comentarios.push(
      {
        id: 'cm-cliente-item', parentId: null, body: 'Essa arte ficou escura no celular.', author: null, fromClient: true,
        approvalItemName: ITENS[1].fileName, approvalItemPosition: 2, approvalVersion: 1,
        createdAt: '2026-10-08T13:02:00Z', editedAt: null, replyCount: 0, mine: false, replies: [],
      },
      {
        id: 'cm-cliente-decisao', parentId: null, body: comentario.trim(), author: null, fromClient: true,
        approvalItemName: null, approvalItemPosition: null, approvalVersion: 1,
        createdAt: quando, editedAt: null, replyCount: 0, mine: false, replies: [],
      },
    );
    estado.rodada = { state: 'rejected', decidedAt: quando, decidedVia: 'client_link', decisionComment: comentario.trim() };
    estado.statusId = 'aq-refacao';
    estado.eventos.push({
      id: '501', automationName: 'Aprovação do cliente', actorName: null, fromListName: null, toListName: null,
      fromStatusName: 'aguardando cliente', toStatusName: 'refação', removed: [], added: [], occurredAt: quando, viaName: null,
    });
    estado.avisos.unshift({
      key: `approval:${RODADA}`, tipo: 'aprovacao', taskId: CARD, taskTitle: 'Carrossel da promoção de outubro', listId: LISTA,
      listName: 'Conteúdo mensal', clientName: 'Horizonte Studio', occurredAt: quando, dueOn: null, automationName: null,
      fromListName: null, toListName: null, toStatusName: null, commentId: 'cm-cliente-decisao',
      approvalDecision: 'rejected', approvalVersion: 1, seen: false,
    });
    return { body: { ok: true, chamada: { id: RODADA, estado: 'reprovada' } } };
  };

  const naoVistos = () => estado.avisos.filter((a) => !a.seen).length;
  const caixa = (vistos) => ({
    ok: true,
    notices: { notices: vistos ? estado.avisos.filter((a) => a.seen) : estado.avisos.filter((a) => !a.seen), unread: naoVistos(), capped: false },
  });

  const custom = (url, req) => {
    const p = url.pathname;
    const metodo = req.method();
    if (p === '/api/auth/me') return { body: { ...sessaoDe('u-ana'), areas: ['entrega', 'quadro'] } };

    // A rota PÚBLICA do cliente — sem sessão, pelo token. Só o reprovar importa aqui.
    const publica = /^\/api\/public\/aprovacao\/([^/]+)\/chamadas\/([^/]+)\/reprovar$/.exec(p);
    if (publica && metodo === 'POST') {
      if (publica[1] !== TOKEN || publica[2] !== RODADA) return { status: 404, body: { ok: false, message: 'Link inválido.' } };
      return reprovar((req.postDataJSON() ?? {}).comentario);
    }

    if (p === `/api/board/tasks/${CARD}/approval-rounds` && metodo === 'GET') return { body: { ok: true, approval: aprovacao() } };
    if (p === `/api/board/tasks/${CARD}` && metodo === 'GET') {
      return { body: { ok: true, task: tarefa(), storage: { ready: false, variable: '' } } };
    }

    if (p === '/api/board/notices/count') return { body: { ok: true, unread: naoVistos() } };
    if (p === '/api/board/notices' && metodo === 'GET') return { body: caixa(url.searchParams.get('vistos') === '1') };
    if (p === '/api/board/notices/read' && metodo === 'POST') {
      const b = req.postDataJSON() ?? {};
      const a = estado.avisos.find((x) => x.key === b.key);
      if (a) a.seen = b.read !== false;
      return { body: caixa(url.searchParams.get('vistos') === '1') };
    }
    return null;
  };
  return { estado, custom };
}

const CAPTURAS = process.env.APROVACAO_CAPTURAS;
const capturar = async (page, nome, alvo = null) => {
  if (!CAPTURAS) return;
  await page.waitForTimeout(400);
  if (alvo) await alvo.screenshot({ path: `${CAPTURAS}/${nome}.png` });
  else await page.screenshot({ path: `${CAPTURAS}/${nome}.png`, fullPage: false });
};

const semRolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const seloDaBarra = (page) =>
  page.evaluate(() => document.querySelector('.bl-item[href="/avisos"] .bl-selo')?.textContent?.trim() ?? '');

async function abrirFicha(page) {
  await page.goto(`${BASE}/tarefa/${CARD}`);
  await page.getByRole('textbox', { name: 'Título da tarefa', exact: true }).waitFor({ timeout: 10000 });
}

/** O cliente reprova pela rota pública (o pedido sai sem sessão nenhuma da equipe). */
const clienteReprova = (page, comentario = MOTIVO) =>
  page.evaluate(
    async ({ token, rodada, comentario }) => {
      const r = await fetch(`/api/public/aprovacao/${token}/chamadas/${rodada}/reprovar`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comentario }),
      });
      return r.status;
    },
    { token: TOKEN, rodada: RODADA, comentario },
  );

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('AQ1', 'depois do cliente reprovar: comentário "do cliente", rodada "ajustes pedidos" com o motivo, histórico e sino +1', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom });
    await abrirFicha(page);
    const secao = page.locator('[data-aprovacao-card]');
    await secao.locator('[data-rodada="1"][data-estado="open"]').waitFor();
    await page.waitForFunction(() => document.querySelector('.bl-item[href="/avisos"] .bl-selo')?.textContent?.trim() === '1');
    const antes = Number(await seloDaBarra(page));
    assert.equal(await page.locator('[data-do-cliente]').count(), 0, 'nada do cliente antes da decisão');

    assert.equal(await clienteReprova(page), 200);
    assert.equal(await clienteReprova(page), 409, 'a segunda decisão é recusada');
    assert.equal(s.estado.decisoes, 1);

    // A equipe recarrega a ficha (o sino sobe sozinho no foco e a cada 30 s).
    await abrirFicha(page);

    // O comentário do cliente, com o selo e o material.
    const decisao = page.locator('#comentario-cm-cliente-decisao');
    await decisao.waitFor();
    assert.equal(await decisao.getAttribute('data-do-cliente'), 'true');
    const cabeca = await decisao.locator('.c-cabeca').innerText();
    assert.match(cabeca, /Cliente \(pelo link\)/);
    assert.match(cabeca, /do cliente/i);
    assert.match(cabeca, /v1/);
    assert.match(await decisao.innerText(), /A logo está pequena no segundo card/);
    assert.equal(await decisao.getByRole('button', { name: 'Editar', exact: true }).count(), 0, 'ninguém edita o que o cliente escreveu');
    assert.equal(await decisao.getByRole('button', { name: 'Apagar', exact: true }).count(), 0, 'ninguém apaga o que o cliente escreveu');
    const doItem = page.locator('#comentario-cm-cliente-item');
    assert.match(await doItem.locator('[data-material-do-cliente]').innerText(), /sobre arte-2-com-um-nome.*\.png · v1/);
    assert.doesNotMatch(await page.locator('.c-fala').allInnerTexts().then((t) => t.join('\n')), /autor sem perfil/);

    // A rodada: "ajustes pedidos", quem decidiu e quando, e o motivo.
    const linha = secao.locator('[data-rodada="1"]');
    await linha.waitFor();
    assert.equal(await linha.getAttribute('data-estado'), 'rejected');
    const textoDaLinha = await linha.innerText();
    assert.match(textoDaLinha, /ajustes pedidos/i);
    assert.match(await linha.locator('[data-decisao]').innerText(), /^ajustes pedidos em 08\/10 10:05 · pelo cliente, pelo link$/);
    assert.match(await linha.locator('[data-motivo]').innerText(), /Motivo do cliente:\s+A logo está pequena/);

    // O histórico: o movimento feito pelo cliente, com "Aprovação do cliente" como autor.
    const mudanca = page.locator('.c-mudanca', { hasText: 'Aprovação do cliente' });
    await mudanca.waitFor();
    assert.match(await mudanca.innerText(), /alterou o status de aguardando cliente para refação/);
    assert.match(await mudanca.innerText(), /automação/);

    // O sino: +1.
    await page.waitForFunction((n) => document.querySelector('.bl-item[href="/avisos"] .bl-selo')?.textContent?.trim() === String(n), antes + 1);
    assert.equal(Number(await seloDaBarra(page)), antes + 1);

    await secao.scrollIntoViewIfNeeded();
    await capturar(page, 'f7-ficha-rodada', secao);
    await decisao.scrollIntoViewIfNeeded();
    await capturar(page, 'f7-comentario-do-cliente');
    return `selo "do cliente" + material; v1 "ajustes pedidos" com motivo; histórico "Aprovação do cliente"; sino ${antes} → ${antes + 1}`;
  });

  await cenario('AQ2', 'a caixa mostra "Cliente pediu ajustes"; o atalho cai no comentário; marcar como visto devolve o sino', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/avisos`);
    await page.getByRole('link', { name: 'Post do dia das crianças', exact: true }).waitFor();
    assert.equal(await clienteReprova(page), 200);
    await page.reload();

    const grupo = page.locator('section.av-grupo', { hasText: 'O cliente respondeu' });
    await grupo.waitFor();
    const linha = page.locator('li.av-linha[data-aviso="approval:rd-1"]');
    await linha.waitFor();
    assert.match(await linha.innerText(), /Cliente pediu ajustes na versão 1 pelo link/);
    assert.match(await linha.innerText(), /Horizonte Studio/);
    await page.waitForFunction(() => document.querySelector('.bl-item[href="/avisos"] .bl-selo')?.textContent?.trim() === '2');
    await capturar(page, 'f7-caixa');

    // O atalho cai no comentário do cliente, e a ficha o destaca (sem "não está mais aqui").
    await linha.getByRole('link', { name: 'Ver o que o cliente escreveu', exact: true }).click();
    await page.waitForURL(`**/tarefa/${CARD}#comentario-cm-cliente-decisao`);
    await page.locator('#comentario-cm-cliente-decisao').waitFor();
    assert.equal(await page.locator('[data-alvo-ausente]').count(), 0);
    assert.equal(s.estado.avisos.find((a) => a.key === 'approval:rd-1').seen, false, 'abrir não marca');

    // Marcar como visto: sai de Novos e o sino volta a 1.
    await page.goto(`${BASE}/avisos`);
    await linha.getByRole('button', { name: 'Marcar como visto', exact: true }).click();
    await linha.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.bl-item[href="/avisos"] .bl-selo')?.textContent?.trim() === '1');
    assert.equal(s.estado.avisos.find((a) => a.key === 'approval:rd-1').seen, true);
    return 'aviso no grupo "O cliente respondeu"; atalho → #comentario-cm-cliente-decisao; visto: sino 2 → 1';
  });

  await cenario('AQ3', '320 px: ficha com o comentário do cliente e o motivo sem rolagem lateral', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom, viewport: { width: 320, height: 720 } });
    await abrirFicha(page);
    assert.equal(await clienteReprova(page), 200);
    await abrirFicha(page);
    const motivo = page.locator('[data-aprovacao-card] [data-rodada="1"] [data-motivo]');
    await motivo.waitFor();
    await motivo.scrollIntoViewIfNeeded();
    assert.equal(await semRolagemLateral(page), true, 'rodada com motivo a 320 sem rolagem lateral');
    await capturar(page, 'f7-rodada-320');
    const doItem = page.locator('#comentario-cm-cliente-item');
    await doItem.scrollIntoViewIfNeeded();
    assert.equal(await semRolagemLateral(page), true, 'comentário do cliente a 320 sem rolagem lateral');
    const caixa = await doItem.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right };
    });
    assert.ok(caixa.left >= 0 && caixa.right <= 320, `a fala cabe (left=${caixa.left}, right=${caixa.right})`);
    await capturar(page, 'f7-comentario-320');
    return 'rodada e comentário do cliente cabem em 320 px';
  });

  return resultados;
}
