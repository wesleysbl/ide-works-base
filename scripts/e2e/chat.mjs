/**
 * Chat ao vivo no Chrome com API simulada — F20.5.
 *
 * Três cenários:
 *   1. abrir o Chat, ver o Geral, enviar "bom dia", balão confirmado;
 *   2. falha no envio → "Tentar de novo" → uma mensagem só no histórico;
 *   3. parede "As mensagens ficam guardadas por 30 dias" e rolar não
 *      dispara novas leituras.
 *
 * Nada toca o banco. Ver `comum.mjs`.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { BASE, criarSuite, respostaPadrao, sessaoDe } from './comum.mjs';

export const GERAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const EU = 'u-ana';
export const BIA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function conversaGeral(lastBody = null, extras = {}) {
  return {
    id: GERAL,
    kind: 'general',
    name: null,
    archivedAt: null,
    lastMessage: lastBody
      ? {
          id: randomUUID(),
          body: lastBody,
          kind: 'person',
          authorId: EU,
          at: '2026-09-21T12:00:00.000Z',
          deletedAt: null,
        }
      : null,
    unreadCount: 0,
    lastReadAt: null,
    myRole: null,
    peerUserId: null,
    peerName: null,
    peerIsActive: null,
    members: [{ id: EU, name: 'Ana', role: null, isActive: true }],
    ...extras,
  };
}

export function msgSeed(body, at) {
  return {
    id: randomUUID(),
    conversationId: GERAL,
    authorId: EU,
    body,
    kind: 'person',
    createdAt: at,
    editedAt: null,
    deletedAt: null,
    clientKey: null,
    recipientIds: [EU],
  };
}

/**
 * Estado mutável da API simulada — o histórico cresce com os envios.
 * F20.6: também grupos, direta e contagem de leituras.
 */
export function criarEstado({ falharProximo = false, iniciais = [] } = {}) {
  const mensagens = iniciais.slice();
  let falhar = falharProximo;
  const envios = [];
  const leituras = [];
  const conversasExtra = [];
  const uploads = [];
  /* Reações do chat — F24. Uma por pessoa por mensagem, com lápide
     (`removed`) e relógio próprio (`changedAt`), como o banco. */
  const reacoes = [];
  const reacoesPedidas = [];
  let unreadGeral = 0;
  /** Faz a PRÓXIMA reação ser recusada pela API — prova o desfazer. */
  let recusarProximaReacao = false;
  /** Segura a resposta da PRÓXIMA reação até o cenário soltar (janela em voo). */
  let travaDaReacao = null;
  let diretaId = null;
  /** Conversas cujo GET de mensagens responde 403 (fora do alcance). */
  const recusadas = new Set();
  /** Avisos de menção no chat — F20.8 (API simulada). */
  const avisos = [];
  const mentionableHits = [];
  let avisosNaoVistos = 0;

  const sincronizarAvisos = () => {
    avisosNaoVistos = avisos.filter((a) => !a.seen).length;
  };

  /** Alterna a reação de alguém numa mensagem: mesmo emoji remove, outro troca. */
  const alternarReacao = (messageId, actorId, emoji) => {
    const changedAt = new Date().toISOString();
    const viva = reacoes.find(
      (x) => x.messageId === messageId && x.actorId === actorId && !x.removed,
    );
    const removida = Boolean(viva) && viva.emoji === emoji;
    for (let i = reacoes.length - 1; i >= 0; i--) {
      if (reacoes[i].messageId === messageId && reacoes[i].actorId === actorId) {
        reacoes.splice(i, 1);
      }
    }
    reacoes.push({ messageId, actorId, emoji, reactedAt: changedAt, removed: removida });
    return { messageId, actorId, emoji, reactedAt: changedAt, removed: removida };
  };

  return {
    envios,
    mensagens,
    reacoes,
    reacoesPedidas,
    alternarReacao,
    vivas() {
      return reacoes.filter((x) => !x.removed);
    },
    leituras,
    conversasExtra,
    uploads,
    avisos,
    mentionableHits,
    get unreadGeral() {
      return unreadGeral;
    },
    setUnreadGeral(n) {
      unreadGeral = n;
    },
    get avisosNaoVistos() {
      return avisosNaoVistos;
    },
    semearAvisoMencao({ messageId, conversationId = GERAL, titulo = 'Geral' }) {
      const key = `chat_mention:${randomUUID()}`;
      avisos.push({
        key,
        tipo: 'mencao_chat',
        taskId: '',
        taskTitle: titulo,
        listId: null,
        listName: 'Geral',
        clientName: null,
        actorName: 'Bia',
        commentId: null,
        conversationId,
        messageId,
        occurredAt: new Date().toISOString(),
        dueOn: null,
        automationName: null,
        fromListName: null,
        toListName: null,
        toStatusName: null,
        seen: false,
      });
      sincronizarAvisos();
      return key;
    },
    limparAvisosDaMensagem(messageId) {
      for (let i = avisos.length - 1; i >= 0; i--) {
        if (avisos[i].messageId === messageId) avisos.splice(i, 1);
      }
      sincronizarAvisos();
    },
    get diretaId() {
      return diretaId;
    },
    setFalhar(v) {
      falhar = v;
    },
    recusarReacao() {
      recusarProximaReacao = true;
    },
    /**
     * Segura a resposta do próximo POST de reação e devolve a função que a
     * solta. É o que abre a janela do palpite em voo: entre o clique e a
     * resposta dá para fazer outra pessoa reagir ao vivo.
     */
    segurarReacao() {
      let soltar;
      travaDaReacao = new Promise((r) => {
        soltar = r;
      });
      return soltar;
    },
    recusarConversa(id) {
      recusadas.add(id);
      const i = conversasExtra.findIndex((c) => c.id === id);
      if (i >= 0) conversasExtra.splice(i, 1);
    },
    handler(url, req) {
      const p = url.pathname;
      if (p === '/api/config') {
        return { body: { ok: true, trustedImageHosts: '', chat: 'ligado' } };
      }
      if (p === '/api/auth/me') return { body: sessaoDe(EU) };
      if (p === '/api/board/notices/count') {
        return { body: { ok: true, unread: avisosNaoVistos } };
      }
      if (p === '/api/board/notices' || p.startsWith('/api/board/notices?')) {
        const vistos = url.searchParams.get('vistos') === '1';
        const lista = vistos ? avisos.slice() : avisos.filter((a) => !a.seen);
        return {
          body: {
            ok: true,
            notices: { notices: lista, unread: avisosNaoVistos, capped: false },
          },
        };
      }
      if (p === '/api/board/notices/read' && req.method() === 'POST') {
        const corpo = req.postDataJSON() ?? {};
        const a = avisos.find((x) => x.key === corpo.key);
        if (a) a.seen = corpo.read !== false;
        sincronizarAvisos();
        const vistos = url.searchParams.get('vistos') === '1';
        const lista = vistos ? avisos.slice() : avisos.filter((x) => !x.seen);
        return {
          body: {
            ok: true,
            notices: { notices: lista, unread: avisosNaoVistos, capped: false },
          },
        };
      }
      if (p === '/api/chat/conversations' && req.method() === 'GET') {
        const last = mensagens[mensagens.length - 1] ?? null;
        return {
          body: {
            ok: true,
            conversations: [
              conversaGeral(last?.body ?? null, { unreadCount: unreadGeral }),
              ...conversasExtra,
            ],
          },
        };
      }
      if (p === '/api/chat/conversations/groups' && req.method() === 'POST') {
        const corpo = req.postDataJSON() ?? {};
        const id = randomUUID();
        conversasExtra.push({
          id,
          kind: 'group',
          name: corpo.name ?? 'Grupo',
          archivedAt: null,
          lastMessage: null,
          unreadCount: 0,
          lastReadAt: null,
          myRole: 'owner',
          peerUserId: null,
          peerName: null,
          peerIsActive: null,
          members: [
            { id: EU, name: 'Ana', role: 'owner', isActive: true },
            ...(Array.isArray(corpo.memberIds)
              ? corpo.memberIds.map((mid) => ({
                  id: mid,
                  name: 'Colega',
                  role: 'member',
                  isActive: true,
                }))
              : []),
          ],
        });
        return { status: 201, body: { ok: true, id } };
      }
      if (p === '/api/chat/conversations/direct' && req.method() === 'POST') {
        if (!diretaId) {
          diretaId = randomUUID();
          conversasExtra.push({
            id: diretaId,
            kind: 'direct',
            name: null,
            archivedAt: null,
            lastMessage: null,
            unreadCount: 0,
            lastReadAt: null,
            myRole: 'member',
            peerUserId: BIA,
            peerName: 'Bia',
            peerIsActive: true,
            members: [
              { id: EU, name: 'Ana', role: 'member', isActive: true },
              { id: BIA, name: 'Bia', role: 'member', isActive: true },
            ],
          });
        }
        return { status: 201, body: { ok: true, id: diretaId } };
      }
      const mentionable = p.match(
        /^\/api\/chat\/conversations\/([0-9a-f-]{36})\/mentionable$/i,
      );
      if (mentionable && req.method() === 'GET') {
        mentionableHits.push(mentionable[1]);
        return {
          body: {
            ok: true,
            people: [
              { id: EU, name: 'Ana' },
              { id: BIA, name: 'Bia' },
            ],
          },
        };
      }
      const msgGet = p.match(/^\/api\/chat\/conversations\/([0-9a-f-]{36})\/messages$/i);
      if (msgGet && req.method() === 'GET') {
        const convId = msgGet[1];
        if (recusadas.has(convId)) {
          return { status: 403, body: { message: 'Fora do seu alcance.' } };
        }
        leituras.push({
          beforeAt: url.searchParams.get('beforeAt'),
          beforeId: url.searchParams.get('beforeId'),
        });
        const beforeAt = url.searchParams.get('beforeAt');
        const beforeId = url.searchParams.get('beforeId');
        let lista = convId === GERAL ? mensagens.slice() : [];
        if (beforeAt && beforeId) {
          lista = [];
        }
        const vivasDoLote = reacoes
          .filter((x) => !x.removed && lista.some((m) => m.id === x.messageId))
          .map(({ messageId, actorId, emoji, reactedAt }) => ({
            messageId,
            actorId,
            emoji,
            reactedAt,
          }));
        return { body: { ok: true, messages: lista, reactions: vivasDoLote } };
      }
      if (p === `/api/chat/conversations/${GERAL}/changes`) {
        return { body: { ok: true, messages: [] } };
      }
      const reacoesChanges = p.match(
        /^\/api\/chat\/conversations\/([0-9a-f-]{36})\/reactions\/changes$/i,
      );
      if (reacoesChanges && req.method() === 'GET') {
        const since = url.searchParams.get('since') ?? '';
        reacoesPedidas.push(since);
        return {
          body: { ok: true, reactions: reacoes.filter((x) => x.reactedAt > since) },
        };
      }
      const reacaoPost = p.match(/^\/api\/chat\/messages\/([0-9a-f-]{36})\/reactions$/i);
      if (reacaoPost && req.method() === 'POST') {
        const corpo = req.postDataJSON() ?? {};
        const responder = () => {
          if (recusarProximaReacao) {
            recusarProximaReacao = false;
            return { status: 409, body: { message: 'Esta mensagem foi apagada.' } };
          }
          return {
            status: 201,
            body: { ok: true, reaction: alternarReacao(reacaoPost[1], EU, corpo.emoji) },
          };
        };
        const trava = travaDaReacao;
        travaDaReacao = null;
        return trava ? trava.then(responder) : responder();
      }
      if (p === `/api/chat/conversations/${GERAL}/messages` && req.method() === 'POST') {
        const corpo = req.postDataJSON() ?? {};
        envios.push(corpo);
        if (falhar) {
          falhar = false;
          return { status: 503, body: { message: 'Serviço indisponível de propósito.' } };
        }
        const existente = mensagens.find((m) => m.clientKey === corpo.clientKey);
        if (existente) {
          return { status: 201, body: { ok: true, message: { ...existente, recipientIds: [EU] } } };
        }
        const message = {
          id: randomUUID(),
          conversationId: GERAL,
          authorId: EU,
          body: corpo.body,
          kind: 'person',
          createdAt: new Date().toISOString(),
          editedAt: null,
          deletedAt: null,
          clientKey: corpo.clientKey,
          recipientIds: [EU],
        };
        mensagens.push(message);
        return { status: 201, body: { ok: true, message } };
      }
      const msgPatch = p.match(/^\/api\/chat\/messages\/([0-9a-f-]{36})$/i);
      if (msgPatch && req.method() === 'PATCH') {
        const corpo = req.postDataJSON() ?? {};
        const m = mensagens.find((x) => x.id === msgPatch[1]);
        if (!m) return { status: 404, body: { message: 'Mensagem não encontrada.' } };
        m.body = corpo.body ?? m.body;
        m.editedAt = new Date().toISOString();
        if (!/mention:[0-9a-f-]{36}/i.test(m.body)) {
          // Edição sem menção: o aviso some (espelha o gatilho).
          for (let i = avisos.length - 1; i >= 0; i--) {
            if (avisos[i].messageId === m.id) avisos.splice(i, 1);
          }
          sincronizarAvisos();
        }
        return { body: { ok: true, message: { ...m, recipientIds: [EU] } } };
      }
      if (p === `/api/chat/conversations/${GERAL}/read`) {
        leituras.push({ read: true, at: (req.postDataJSON() ?? {}).readAt ?? null });
        unreadGeral = 0;
        return { body: { ok: true, lastReadAt: new Date().toISOString() } };
      }
      if (p.match(/^\/api\/chat\/conversations\/[0-9a-f-]{36}\/read$/i)) {
        leituras.push({ read: true });
        return { body: { ok: true, lastReadAt: new Date().toISOString() } };
      }
      if (p === '/api/chat/directory') {
        return {
          body: {
            ok: true,
            people: [
              { id: EU, name: 'Ana' },
              { id: BIA, name: 'Bia' },
            ],
          },
        };
      }
      // F20.7 — imagens
      const imgPost = p.match(/^\/api\/chat\/conversations\/([0-9a-f-]{36})\/images$/i);
      if (imgPost && req.method() === 'POST') {
        const id = randomUUID();
        uploads.push({ conversationId: imgPost[1], id });
        return { status: 201, body: { ok: true, id } };
      }
      if (p === '/api/chat/images/urls' && req.method() === 'POST') {
        const corpo = req.postDataJSON() ?? {};
        const ids = Array.isArray(corpo.ids) ? corpo.ids : [];
        const urls = {};
        for (const id of ids) {
          urls[id] = {
            url: `https://storage.invalid/signed/${id}.png?download=print.png`,
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          };
        }
        return { body: { ok: true, urls } };
      }
      const imgUrl = p.match(/^\/api\/chat\/images\/([0-9a-f-]{36})\/url$/i);
      if (imgUrl && req.method() === 'GET') {
        return {
          body: {
            ok: true,
            url: `https://storage.invalid/signed/${imgUrl[1]}.png?download=print.png`,
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
            fileName: 'print.png',
            contentType: 'image/png',
          },
        };
      }
      return null;
    },
  };
}

/**
 * Clica um botão da régua de ações como gente com ponteiro: sobre a bolha
 * primeiro (a régua escondida não recebe clique — F09). Se a lista redesenhar
 * a bolha entre o hover e o clique (histórico chegando), passa de novo.
 */
export async function clicarNaRegua(bolha, nome) {
  for (let tentativa = 1; ; tentativa++) {
    await bolha.hover();
    try {
      await bolha.getByRole('button', { name: nome, exact: true }).click({ timeout: 3000 });
      return;
    } catch (e) {
      if (tentativa >= 4) throw e;
    }
  }
}

/** PNG 1×1 servido pelo armazenamento fictício (ver `abrirChat`). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function abrirChat(abrir, estado) {
  const state = await abrir({
    custom: (url, req) => estado.handler(url, req),
  });
  // WebSocket da central: abortar evita ruído no console; a tela sobrevive sem ele.
  await state.context.route('**/api/chat/live', (route) => route.abort());
  // F16 — a CAUSA do C8 intermitente ("Ampliar imagem" visível → desligado do
  // DOM): o endereço assinado fictício (`storage.invalid`) não resolve, o
  // `<img>` dispara `error`, `aoFalhar` pede de novo e o botão troca por
  // "Carregando imagem…" / "indisponível". O clique só passava quando chegava
  // antes do erro de DNS — sob carga, perdia (3 de 12 numa reprodução
  // isolada). Era o teste, não a tela: a imagem real carrega e fica. Agora o
  // armazenamento fictício devolve um PNG de verdade.
  await state.context.route('https://storage.invalid/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }),
  );
  await state.page.goto(BASE + '/chat');
  await state.page.getByRole('heading', { name: /Chat/ }).waitFor();
  await state.page.getByText('Geral', { exact: true }).first().waitFor();
  return state;
}

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('C1', 'abrir o Chat, ver o Geral, enviar bom dia e ver o balão confirmado', async (abrir) => {
    const estado = criarEstado();
    const { page, erros } = await abrirChat(abrir, estado);

    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    await campo.fill('bom dia');
    await campo.press('Enter');

    await page.locator('.c-fala[data-estado="confirmada"]').filter({ hasText: 'bom dia' }).waitFor();
    assert.equal(estado.mensagens.length, 1);
    assert.equal(estado.mensagens[0].body, 'bom dia');
    assert.equal(estado.envios.length, 1);
    // Sem erro de página (WS abortado pode gerar um console.error — filtramos).
    const graves = erros.filter((e) => !/WebSocket|chat\/live|Failed to fetch|network/i.test(e));
    assert.deepEqual(graves, [], graves.join('\n'));
  });

  await cenario('C2', 'falha no envio: tentar de novo sem duplicar', async (abrir) => {
    const estado = criarEstado({ falharProximo: true });
    const { page } = await abrirChat(abrir, estado);

    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    await campo.fill('bom dia');
    await campo.press('Enter');

    await page.locator('.c-fala[data-estado="falha"]').waitFor();
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await page.locator('.c-fala[data-estado="confirmada"]').filter({ hasText: 'bom dia' }).waitFor();

    assert.equal(estado.envios.length, 2, 'dois pedidos HTTP (falha + sucesso)');
    assert.equal(estado.envios[0].clientKey, estado.envios[1].clientKey, 'mesma chave de envio');
    assert.equal(estado.mensagens.length, 1, 'uma mensagem no histórico, não duas');
  });

  await cenario('C3', 'parede dos 30 dias e sem novas leituras ao rolar', async (abrir) => {
    const estado = criarEstado({
      iniciais: [
        msgSeed('antiga', '2026-09-01T12:00:00.000Z'),
        msgSeed('recente', '2026-09-21T12:00:00.000Z'),
      ],
    });
    const { page } = await abrirChat(abrir, estado);

    const parede = page.locator('[data-parede="30-dias"]');
    await parede.waitFor();
    assert.equal(
      (await parede.innerText()).trim(),
      'As mensagens ficam guardadas por 30 dias',
    );

    // Conta só GET de mensagens (paginação). POST /read pode repetir no
    // scroll com fio curto (topo = pé) — isso é marcar lida (F20.6), não página.
    const fetchesAntes = estado.leituras.filter((l) => !l.read).length;
    const paginasAnterioresAntes = estado.leituras.filter((l) => l.beforeAt).length;

    // Rola ao topo do fio (fim do histórico) e insiste — com a parede, não
    // deve pedir página anterior de novo.
    await page.locator('.ch-fio-wrap').evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);
    await page.locator('.ch-fio-wrap').evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);

    assert.equal(
      (await parede.innerText()).trim(),
      'As mensagens ficam guardadas por 30 dias',
    );
    assert.equal(
      estado.leituras.filter((l) => l.beforeAt).length,
      paginasAnterioresAntes,
      'rolar com a parede não dispara leitura de página anterior',
    );
    assert.equal(
      estado.leituras.filter((l) => !l.read).length,
      fetchesAntes,
      'rolar com a parede não dispara GET novo de mensagens',
    );
  });

  await cenario('C4', 'nova conversa direta duas vezes não duplica na lista', async (abrir) => {
    const estado = criarEstado();
    const { page } = await abrirChat(abrir, estado);

    await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: /Bia/ }).click();
    await page.getByText('Bia', { exact: true }).first().waitFor();

    await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: /Bia/ }).click();
    await page.waitForTimeout(200);

    const itensBia = await page.locator('.ch-item').filter({ hasText: 'Bia' }).count();
    assert.equal(itensBia, 1, 'uma conversa direta só na lista');
    assert.ok(estado.diretaId, 'API devolveu id estável');
  });

  await cenario('C5', 'criar grupo e ver na lista; não lidas sobem sem recarregar', async (abrir) => {
    const estado = criarEstado();
    const { page } = await abrirChat(abrir, estado);

    await page.getByRole('button', { name: 'Novo grupo', exact: true }).click();
    await page.getByLabel('Nome do grupo').fill('Teste F20');
    await page.getByRole('menuitemcheckbox', { name: /Bia/ }).click();
    await page.getByRole('button', { name: 'Criar grupo', exact: true }).click();
    await page.getByText('Teste F20', { exact: true }).first().waitFor();

    // Simula evento da central (WS abortado): sobe não lidas no Geral.
    estado.setUnreadGeral(3);
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('ideworks:chat-live', {
          detail: {
            type: 'message_new',
            message: {
              id: 'm-x',
              conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              authorId: 'u-bia',
              body: 'oi',
              kind: 'person',
              createdAt: new Date().toISOString(),
              editedAt: null,
              deletedAt: null,
              clientKey: null,
            },
          },
        }),
      );
    });
    await page.waitForTimeout(300);
    // Layout Foco: o Chat existe no rail E na lista; só um aparece por vez.
    const selo = page.locator('.bl-item[href="/chat"]:visible .bl-selo');
    await selo.waitFor({ timeout: 3000 });
    assert.match((await selo.innerText()).trim(), /3/);

    // Outra aba leu: conversation_read zera o selo sem recarregar.
    estado.setUnreadGeral(0);
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('ideworks:chat-live', {
          detail: {
            type: 'conversation_read',
            conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            readAt: new Date().toISOString(),
            personId: 'u-ana',
          },
        }),
      );
    });
    await page.waitForTimeout(400);
    assert.equal(await selo.count(), 0, 'selo some após conversation_read');
  });

  await cenario('C6', 'mensagem com aba sem foco não marca como lida', async (abrir) => {
    const estado = criarEstado();
    estado.setUnreadGeral(2);
    const { page } = await abrirChat(abrir, estado);

    /* O QUE SE MEDE É A MARCA QUE COBRE A MENSAGEM DA ABA OCULTA — conferência
       de 08/10. Contar marcas antes e depois falhava em ~1 de 3 sob carga: a
       marca da ABERTURA da conversa (a aba ganha foco, `aoFoco` marca até
       `sinceRef`) às vezes chegava ao servidor dublê depois da contagem
       "antes". Ela é legítima e nunca cobre a mensagem nova: medido em 30
       rodadas, o `readAt` dela é sempre anterior à mensagem da aba oculta. */
    const criadaEm = await page.evaluate(() => {
      const quando = new Date().toISOString();
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      Object.defineProperty(document, 'hasFocus', {
        configurable: true,
        value: () => false,
      });
      window.dispatchEvent(
        new CustomEvent('ideworks:chat-live', {
          detail: {
            type: 'message_new',
            message: {
              id: 'm-hidden',
              conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              authorId: 'u-bia',
              body: 'sem foco',
              kind: 'person',
              createdAt: quando,
              editedAt: null,
              deletedAt: null,
              clientKey: null,
            },
          },
        }),
      );
      return quando;
    });
    await page.waitForTimeout(400);

    const cobrem = estado.leituras.filter((l) => l.read && (l.at === null || l.at >= criadaEm));
    assert.deepEqual(
      cobrem,
      [],
      'aba oculta não dispara mark_conversation_read que cubra a mensagem nova (só a do carregamento inicial)',
    );
  });

  await cenario('C7', 'removido da conversa volta para a lista com aviso', async (abrir) => {
    const estado = criarEstado();
    const { page } = await abrirChat(abrir, estado);

    await page.getByRole('button', { name: 'Novo grupo', exact: true }).click();
    await page.getByLabel('Nome do grupo').fill('Saída');
    await page.getByRole('button', { name: 'Criar grupo', exact: true }).click();
    await page.getByText('Saída', { exact: true }).first().waitFor();
    const grupoId = estado.conversasExtra[0]?.id;
    assert.ok(grupoId);

    await page.evaluate((id) => {
      window.dispatchEvent(
        new CustomEvent('ideworks:chat-live', {
          detail: { type: 'conversation_left', conversationId: id },
        }),
      );
    }, grupoId);

    await page.getByText(/saiu desta conversa|foi removido/i).waitFor();
    assert.ok(page.url().endsWith('/chat') || !page.url().includes(grupoId));

    // Link direto da conversa após remoção: API recusa, tela mostra a frase.
    estado.recusarConversa(grupoId);
    await page.goto(BASE + `/chat/${grupoId}`);
    // F09: sem acesso é o estado do painel (EstadoDaPagina "sem-acesso"), não
    // alarme — com a frase da API e a saída para o Geral.
    const semAcesso = page.locator('.ch-painel [data-estado="sem-acesso"]');
    await semAcesso.getByText(/Fora do seu alcance/i).waitFor({ timeout: 5000 });
    await semAcesso.getByRole('link', { name: 'Abrir o Geral', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Escrever mensagem', { exact: true }).count(), 0, 'sem acesso não oferece o campo');
  });

  // ─── F20.7: imagens e prints ─────────────────────────────────────────────

  /** PNG 1×1 mínimo (assinatura válida). */
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  await cenario('C8', 'anexar imagem, ver prévia, enviar e ampliar no balão', async (abrir) => {
    const estado = criarEstado();
    const { page } = await abrirChat(abrir, estado);

    await page.getByLabel('Selecionar imagens').setInputFiles({
      name: 'print.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });
    await page.locator('.imagens-do-rascunho .imagem-no-texto').waitFor({ timeout: 8000 });
    assert.equal(estado.uploads.length, 1, 'rascunho subiu');

    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.locator('.c-fala[data-estado="confirmada"] .imagem-no-texto').waitFor({
      timeout: 8000,
    });
    assert.ok(estado.mensagens.length >= 1);
    assert.match(estado.mensagens[0].body, /attachment:/i);
    assert.ok(estado.envios[0].imageIds?.length >= 1);

    await page.getByRole('button', { name: 'Ampliar imagem', exact: true }).click();
    await page.getByRole('dialog').waitFor({ timeout: 3000 });
  });

  await cenario('C9', 'mensagem só com imagem', async (abrir) => {
    const estado = criarEstado();
    const { page } = await abrirChat(abrir, estado);

    await page.getByLabel('Selecionar imagens').setInputFiles({
      name: 'so-img.png',
      mimeType: 'image/png',
      buffer: pngBytes,
    });
    await page.locator('.imagens-do-rascunho').waitFor({ timeout: 8000 });
    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    assert.equal(((await campo.textContent()) ?? '').trim(), '');
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.locator('.c-fala[data-estado="confirmada"] .imagem-no-texto').waitFor({
      timeout: 8000,
    });
    assert.match(estado.mensagens[0].body, /attachment:/i);
  });

  await cenario('C10', '6 MB e texto disfarçado de imagem são recusados sem subir', async (abrir) => {
    const estado = criarEstado();
    const { page } = await abrirChat(abrir, estado);

    const grande = Buffer.alloc(6 * 1024 * 1024, 1);
    // Assinatura PNG no início para passar da assinatura e cair no teto.
    pngBytes.copy(grande, 0);
    await page.getByLabel('Selecionar imagens').setInputFiles({
      name: 'grande.png',
      mimeType: 'image/png',
      buffer: grande,
    });
    await page.getByRole('alert').getByText(/teto|5 MB|megabyte/i).waitFor({ timeout: 5000 });
    assert.equal(estado.uploads.length, 0, '6 MB não sobe');

    await page.getByLabel('Selecionar imagens').setInputFiles({
      name: 'falso.png',
      mimeType: 'image/png',
      buffer: Buffer.from('isto nao e uma imagem png de verdade'),
    });
    await page
      .getByRole('alert')
      .getByText(/não é uma imagem PNG ou JPEG|PNG ou JPEG válida/i)
      .waitFor({ timeout: 5000 });
    assert.equal(estado.uploads.length, 0, 'falso não sobe');
  });

  await cenario('C11', 'colar print no campo aparece na prévia', async (abrir) => {
    const estado = criarEstado();
    const { page } = await abrirChat(abrir, estado);

    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    await campo.focus();
    await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], 'print.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const el = document.querySelector('[aria-label="Escrever mensagem"]');
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }, pngBytes.toString('base64'));

    await page.locator('.imagens-do-rascunho .imagem-no-texto').waitFor({ timeout: 8000 });
    assert.equal(estado.uploads.length, 1, 'colar subiu rascunho');
  });

  // ─── F20.8: menção com @ → sino ──────────────────────────────────────────

  await cenario(
    'C12',
    'mencionar, sino sobe, abrir aviso com mensagem destacada, editar tirando a menção',
    async (abrir) => {
      const msgId = randomUUID();
      const corpoMencao = `Oi @[Bia](mention:${BIA}) confira`;
      const estado = criarEstado({
        iniciais: [
          {
            id: msgId,
            conversationId: GERAL,
            authorId: EU,
            body: corpoMencao,
            kind: 'person',
            createdAt: '2026-09-21T15:00:00.000Z',
            editedAt: null,
            deletedAt: null,
            clientKey: 'seed-mencao',
            recipientIds: [EU, BIA],
          },
        ],
      });
      estado.semearAvisoMencao({ messageId: msgId });

      const { page } = await abrirChat(abrir, estado);

      // Sino sobe na hora via evento ao vivo (sem esperar 30 s).
      await page.evaluate((detail) => {
        window.dispatchEvent(new CustomEvent('ideworks:chat-live', { detail }));
      }, { type: 'chat_mention', conversationId: GERAL, messageId: msgId });

      // `:visible` — F08: no chat a barra fica em rail, e o primeiro link de
      // Notificações (o atalho da barra expandida) está escondido.
      await page.locator('.bl-item[href="/avisos"]:visible').first().waitFor({ timeout: 5000 });
      // A pastilha do sino carrega o número após o evento. A classe é
      // `bl-selo`, a da barra lateral — `mt-conta` é a contagem de OUTRA tela e
      // nunca casa aqui, o que fazia este cenário esperar por nada.
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.bl-item[href="/avisos"] .bl-selo');
          return el && el.textContent?.trim() === '1';
        },
        null,
        { timeout: 5000 },
      );

      await page.goto(BASE + '/avisos');
      await page.getByText('Mencionaram você no chat').waitFor({ timeout: 5000 });
      await page.getByRole('link', { name: 'Geral', exact: true }).first().click();
      await page.waitForURL(new RegExp(`/chat/${GERAL}#chat-msg-${msgId}`));
      await page.locator(`#chat-msg-${msgId}[data-destacado="true"]`).waitFor({
        timeout: 5000,
      });

      // Campo @: digitar e escolher.
      const campo = page.getByLabel('Escrever mensagem', { exact: true });
      await campo.click();
      await campo.pressSequentially('ola @Bi');
      await page.getByRole('option', { name: 'Bia' }).waitFor({ timeout: 5000 });
      assert.ok(estado.mentionableHits.includes(GERAL));
      await page.getByRole('option', { name: 'Bia' }).click();
      await page.getByRole('button', { name: 'Enviar', exact: true }).click();
      await page.locator('.c-fala[data-estado="confirmada"] .mencao').first().waitFor({
        timeout: 8000,
      });
      const enviada = estado.envios[estado.envios.length - 1];
      assert.match(enviada.body, new RegExp(`mention:${BIA}`, 'i'));

      // Editar tirando a menção: aviso some e o sino cai.
      const minha = estado.mensagens.find((m) => m.id === msgId);
      assert.ok(minha);
      // Como gente com ponteiro: sobre a bolha, a régua aparece e vira alvo.
      await clicarNaRegua(page.locator(`#chat-msg-${msgId}`), 'Editar');
      const edicao = page.getByLabel('Editar mensagem', { exact: true });
      await edicao.fill('Texto sem menção nenhuma');
      await page.getByRole('button', { name: 'Salvar', exact: true }).click();
      await page.locator(`#chat-msg-${msgId}`).getByText('Texto sem menção nenhuma').waitFor();
      assert.equal(estado.avisosNaoVistos, 0);

      await page.evaluate((detail) => {
        window.dispatchEvent(new CustomEvent('ideworks:chat-live', { detail }));
      }, { type: 'chat_mention', conversationId: GERAL, messageId: msgId });

      await page.waitForFunction(
        () => {
          const el = document.querySelector('.bl-item[href="/avisos"] .bl-selo');
          return !el || el.textContent?.trim() === '' || el.textContent?.trim() === '0';
        },
        null,
        { timeout: 5000 },
      );
    },
  );

  // ─── F10 (plano UX): a menção aponta uma mensagem que não está mais lá ───
  await cenario(
    'F10-mencao-ausente',
    'aviso de menção cuja mensagem sumiu: a conversa abre e diz por quê, sem mostrar o texto',
    async (abrir) => {
      const presente = randomUUID();
      const apagada = randomUUID();
      const estado = criarEstado({
        iniciais: [
          { id: presente, conversationId: GERAL, authorId: BIA, body: 'Mensagem que continua aqui', kind: 'person', createdAt: '2026-09-21T15:00:00.000Z', editedAt: null, deletedAt: null, clientKey: 'seed-f10', recipientIds: [EU, BIA] },
        ],
      });
      estado.semearAvisoMencao({ messageId: apagada });
      const { page } = await abrirChat(abrir, estado);
      await page.goto(BASE + '/avisos');
      await page.getByText('Mencionaram você no chat').waitFor({ timeout: 5000 });
      await page.getByRole('link', { name: 'Geral', exact: true }).first().click();
      await page.waitForURL(new RegExp(`/chat/${GERAL}#chat-msg-${apagada}`));
      const nota = page.locator('[data-alvo-ausente]');
      await nota.waitFor({ timeout: 5000 });
      assert.match(await nota.textContent(), /A mensagem desta notificação não/);
      await page.locator(`#chat-msg-${presente}`).waitFor();
      assert.equal(await page.locator('[data-destacado="true"]').count(), 0, 'nada destacado por engano');
      // O caminho feliz ao lado: a mensagem existente é destacada e a nota some.
      await page.goto(BASE + `/chat/${GERAL}#chat-msg-${presente}`);
      await page.locator(`#chat-msg-${presente}[data-destacado="true"]`).waitFor({ timeout: 5000 });
      assert.equal(await page.locator('[data-alvo-ausente]').count(), 0);
      return 'mensagem ausente → nota de status, conversa aberta; presente → destacada, sem nota';
    },
  );

  // ─── F33: o balão de começar conversa aparece inteiro ────────────────────
  //
  // Preso ao botão, o balão morava dentro da `.ch-lista` (`overflow: auto`):
  // mais largo que a coluna, era cortado na divisa com a conversa e a coluna
  // ganhava rolagem lateral; no celular o corte era por baixo. E dizia o
  // título duas vezes. Agora ele flutua em `document.body`, ancorado no botão.

  const LONGO = 'Waldemar Gomes da Silva Pereira';
  const diretorioLongo = (estado) => (url, req) =>
    url.pathname === '/api/chat/directory'
      ? {
          body: {
            ok: true,
            people: [
              { id: EU, name: 'Ana' },
              { id: BIA, name: 'Bia' },
              { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: LONGO },
            ],
          },
        }
      : estado.handler(url, req);

  /** Caixa do balão, da lista, do nome longo e o texto do balão, numa leitura só. */
  const medirBalao = (page) =>
    page.evaluate((longo) => {
      const b = document.querySelector('.cu-balao');
      const l = document.querySelector('.ch-lista');
      const nome = [...b.querySelectorAll('.rotulo')].find((e) => e.textContent === longo);
      const caixa = (e) => {
        const r = e.getBoundingClientRect();
        return { x: r.left, y: r.top, r: r.right, b: r.bottom };
      };
      return {
        balao: caixa(b),
        nome: nome ? caixa(nome) : null,
        noBody: b.parentElement === document.body,
        janela: { w: window.innerWidth, h: window.innerHeight },
        lista: { sw: l.scrollWidth, cw: l.clientWidth },
        texto: b.innerText,
      };
    }, LONGO);

  for (const [largura, altura] of [
    [1280, 720],
    [390, 844],
  ]) {
    await cenario(
      `C13-${largura}`,
      `Nova conversa e Novo grupo inteiros na janela, um título, sem rolagem lateral (${largura}×${altura})`,
      async (abrir) => {
        const estado = criarEstado();
        const state = await abrir({
          viewport: { width: largura, height: altura },
          custom: diretorioLongo(estado),
        });
        await state.context.route('**/api/chat/live', (route) => route.abort());
        const { page } = state;
        await page.goto(BASE + '/chat');
        await page.getByText('Geral', { exact: true }).first().waitFor();

        for (const qual of ['Novo grupo', 'Nova conversa']) {
          const botao = page.getByRole('button', { name: qual, exact: true });
          await botao.click();
          await page.locator('.cu-balao').waitFor();
          const busca = page.getByLabel('Buscar pessoa', { exact: true });
          await busca.fill('WE');
          await page.locator('.cu-balao .rotulo', { hasText: LONGO }).waitFor();
          // Um quadro para a medida do balão assentar (ela roda depois de pintar).
          await page.waitForTimeout(150);
          const m = await medirBalao(page);
          const ctx = `${qual}: ${JSON.stringify(m)}`;
          assert.ok(m.noBody, `balão em portal — ${ctx}`);
          assert.ok(m.balao.x >= 0 && m.balao.y >= 0, `balão começa dentro da janela — ${ctx}`);
          assert.ok(m.balao.r <= m.janela.w && m.balao.b <= m.janela.h, `balão termina dentro da janela — ${ctx}`);
          assert.ok(m.nome && m.nome.r <= m.balao.r, `nome longo dentro do balão — ${ctx}`);
          assert.ok(m.lista.sw <= m.lista.cw, `.ch-lista sem rolagem lateral — ${ctx}`);
          assert.equal(m.texto.split(qual).length - 1, 1, `"${qual}" uma vez no balão — ${ctx}`);

          // A busca é o campo de `Nova conversa`; no grupo o foco vai ao nome.
          if (qual === 'Nova conversa') {
            assert.equal(await busca.evaluate((e) => e === document.activeElement), true, 'foco na busca');
            // A seta desce da busca para o primeiro item.
            await page.keyboard.press('ArrowDown');
            assert.equal(
              await page.evaluate(() => document.activeElement?.textContent?.trim()),
              LONGO,
              'a seta anda nos itens',
            );
          }

          // Esc fecha e devolve o foco ao botão que abriu.
          await page.keyboard.press('Escape');
          await page.locator('.cu-balao').waitFor({ state: 'detached' });
          assert.equal(await botao.evaluate((e) => e === document.activeElement), true, `foco volta a "${qual}"`);
        }

        // Escolher uma pessoa abre a conversa.
        await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
        await page.getByRole('menuitemcheckbox', { name: /Bia/ }).click();
        // `/chat` já abre em `/chat/<Geral>`: esperar QUALQUER conversa passaria
        // antes do clique. Espera-se a direta que a API acabou de abrir.
        await page.waitForURL((u) => estado.diretaId !== null && u.pathname === `/chat/${estado.diretaId}`);
        assert.equal(await page.locator('.cu-balao').count(), 0, 'o balão fecha ao escolher');
      },
    );
  }

  // ─── F09 do plano UX: leitura, compositor e estados ─────────────────────────
  const OUTRA = 'cccccccc-cccc-4ccc-8ccc-0000000000f9';
  const comOutra = (estado) => {
    estado.conversasExtra.push({
      id: OUTRA, kind: 'group', name: 'Outra conversa', archivedAt: null, lastMessage: null,
      unreadCount: 0, lastReadAt: null, myRole: 'owner', peerUserId: null, peerName: null,
      peerIsActive: null, members: [{ id: EU, name: 'Ana', role: 'owner', isActive: true }],
    });
    return estado;
  };

  await cenario('F09-alternar', 'resposta de envio atrasada não entra na conversa aberta depois', async (abrir) => {
    const estado = comOutra(criarEstado());
    let soltar;
    const trava = new Promise((r) => { soltar = r; });
    const state = await abrir({
      custom: async (url, req) => {
        if (url.pathname === `/api/chat/conversations/${GERAL}/messages` && req.method() === 'POST') await trava;
        return estado.handler(url, req);
      },
    });
    await state.context.route('**/api/chat/live', (route) => route.abort());
    const { page } = state;
    await page.goto(BASE + `/chat/${GERAL}`);
    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    await campo.fill('resposta atrasada');
    await campo.press('Enter');
    await page.locator('.c-fala[data-estado="pendente"]').waitFor();
    await page.locator(`.ch-item[href='/chat/${OUTRA}']`).click();
    await page.locator('.ch-painel-nome').getByText('Outra conversa', { exact: true }).waitFor();
    soltar();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.c-fala').filter({ hasText: 'resposta atrasada' }).count(), 0, 'nada da Geral na Outra');
    assert.equal(estado.mensagens.length, 1, 'o servidor guardou uma');
    await page.locator(`.ch-item[href='/chat/${GERAL}']`).click();
    await page.locator('.c-fala[data-estado="confirmada"]').filter({ hasText: 'resposta atrasada' }).waitFor();
    assert.equal(await page.locator('.c-fala').filter({ hasText: 'resposta atrasada' }).count(), 1, 'uma bolha, não duas');
  });

  await cenario('F09-falha-imagem', 'falha com imagem: Tentar de novo reenvia texto e imagem com a mesma chave, uma bolha', async (abrir) => {
    const estado = criarEstado({ falharProximo: true });
    const { page } = await abrirChat(abrir, estado);
    await page.locator('input[type="file"][aria-label="Selecionar imagens"]').setInputFiles({
      name: 'print.png', mimeType: 'image/png', buffer: pngBytes,
    });
    await page.locator('.imagens-do-rascunho .imagem-no-texto').waitFor({ timeout: 8000 });
    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    await campo.fill('segue o print');
    await campo.press('Enter');
    const falha = page.locator('[data-falha="envio"]');
    await falha.waitFor();
    assert.match(await falha.innerText(), /Não enviada\. Serviço indisponível de propósito\./);
    assert.equal(await page.locator('.c-fala[data-estado="falha"] .imagem-no-texto, .c-fala[data-estado="falha"] .imagem-no-texto-aviso').count(), 1, 'a imagem segue na bolha que falhou');
    await falha.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await page.locator('.c-fala[data-estado="confirmada"]').filter({ hasText: 'segue o print' }).waitFor();
    assert.equal(await page.locator('[data-falha="envio"]').count(), 0);
    assert.equal(await page.locator('.c-fala').count(), 1, 'uma bolha');
    assert.equal(estado.envios.length, 2);
    assert.equal(estado.envios[0].clientKey, estado.envios[1].clientKey);
    assert.deepEqual(estado.envios[1].imageIds, estado.envios[0].imageIds);
    assert.equal(estado.envios[1].imageIds.length, 1);
  });

  await cenario('F09-ime', 'Enter durante composição (IME) não envia; Enter depois envia; Shift+Enter quebra', async (abrir) => {
    const estado = criarEstado();
    const { page } = await abrirChat(abrir, estado);
    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    await campo.fill('かな');
    await campo.evaluate((e) => {
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(300);
    assert.equal(estado.envios.length, 0, 'a confirmação do IME não envia');
    await campo.press('Shift+Enter');
    await page.waitForTimeout(100);
    assert.equal(estado.envios.length, 0, 'Shift+Enter não envia');
    await campo.press('Enter');
    await page.locator('.c-fala[data-estado="confirmada"]').waitFor();
    assert.equal(estado.envios.length, 1);
  });

  for (const [largura, altura] of [[320, 640], [390, 844]]) {
    await cenario(`F09-compositor-${largura}`, 'clipe, campo e Enviar na mesma linha; Enviar desabilitado sem texto', async (abrir) => {
      const estado = criarEstado({ iniciais: [msgSeed('olá', '2026-09-21T12:00:00.000Z')] });
      const state = await abrir({ viewport: { width: largura, height: altura }, custom: estado.handler });
      await state.context.route('**/api/chat/live', (route) => route.abort());
      const { page } = state;
      await page.goto(BASE + `/chat/${GERAL}`);
      await page.locator('.c-fala').first().waitFor();
      const enviar = page.getByRole('button', { name: 'Enviar', exact: true });
      assert.equal(await enviar.isDisabled(), true, 'vazio: Enviar desabilitado');
      const caixa = async (s) => page.locator(s).first().boundingBox();
      const clipe = await caixa('.c-anexar-imagem');
      const campo = await caixa('.ch-compositor .c-caixa');
      const botao = await caixa('.ch-enviar');
      const ctx = JSON.stringify({ clipe, campo, botao });
      const meio = (b) => b.y + b.height / 2;
      assert.ok(Math.abs(meio(clipe) - meio(botao)) <= 2, `clipe e Enviar na mesma linha: ${ctx}`);
      assert.ok(clipe.x + clipe.width <= campo.x + 1 && campo.x + campo.width <= botao.x + 1, `clipe · campo · Enviar: ${ctx}`);
      assert.ok(botao.x + botao.width <= largura, `Enviar dentro da janela: ${ctx}`);
      assert.ok(campo.width >= 150, `o campo tem largura de escrever: ${ctx}`);
      assert.ok(botao.width >= 36 && botao.height >= 36, `alvo do Enviar: ${ctx}`);
      await page.getByLabel('Escrever mensagem', { exact: true }).fill('linha\n'.repeat(40));
      const cheio = await caixa('.ch-compositor .c-caixa');
      assert.ok(cheio.height <= Math.max(160, altura * 0.28) + 2, `crescimento com teto: ${JSON.stringify(cheio)}`);
      assert.equal(await enviar.isDisabled(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
  }

  await cenario('F09-estados', 'conversa vazia, histórico carregando e erro recuperável com Tentar de novo', async (abrir) => {
    const estado = comOutra(criarEstado({ iniciais: [msgSeed('volta', '2026-09-21T12:00:00.000Z')] }));
    let falhar = true;
    let soltar;
    const lento = new Promise((r) => { soltar = r; });
    const state = await abrir({
      custom: async (url, req) => {
        if (url.pathname === `/api/chat/conversations/${OUTRA}/messages`) await lento;
        if (url.pathname === `/api/chat/conversations/${GERAL}/messages` && req.method() === 'GET' && falhar) {
          return { status: 500, body: { message: 'O servidor tropeçou.' } };
        }
        return estado.handler(url, req);
      },
    });
    await state.context.route('**/api/chat/live', (route) => route.abort());
    const { page } = state;
    await page.goto(BASE + `/chat/${GERAL}`);
    const erro = page.locator('.ch-fio-estado [data-estado="erro"]');
    await erro.getByText('O servidor tropeçou.').waitFor();
    falhar = false;
    await erro.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await page.locator('.c-fala').filter({ hasText: 'volta' }).waitFor();
    assert.equal(await page.locator('.ch-fio-estado').count(), 0);

    await page.locator(`.ch-item[href='/chat/${OUTRA}']`).click();
    await page.locator('.ch-fio-estado [data-estado="carregando"]').waitFor();
    assert.equal(await page.locator('.ch-fio-estado [data-estado="vazio"]').count(), 0, 'carregando não é vazio');
    soltar();
    const vazio = page.locator('.ch-fio-estado [data-estado="vazio"]');
    await vazio.getByText('Nenhuma mensagem por aqui ainda').waitFor();
    assert.equal(await page.getByLabel('Escrever mensagem', { exact: true }).count(), 1, 'o campo segue para começar');
  });

  await cenario('F09-toque', 'no toque, as ações aparecem ao tocar a bolha e somem ao tocar fora; o horário da fala seguida é lido', async () => {
    const estado = criarEstado({
      iniciais: [
        msgSeed('primeira', '2026-09-21T12:00:00.000Z'),
        msgSeed('seguida', '2026-09-21T12:01:00.000Z'),
      ],
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      await context.route('**/api/chat/live', (route) => route.abort());
      await context.route('**/api/**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const r = await estado.handler(url, req);
        await route.fulfill({ status: r?.status ?? 200, contentType: 'application/json', body: JSON.stringify(r?.body ?? respostaPadrao(url, req)) }).catch(() => {});
      });
      const page = await context.newPage();
      await page.goto(BASE + `/chat/${GERAL}`);
      const [a, b] = estado.mensagens.map((m) => page.locator(`#chat-msg-${m.id}`));
      await b.waitFor();
      assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true, 'contexto de toque');
      const opacidade = (loc) => loc.locator('.c-acoes').evaluate((e) => Number(getComputedStyle(e).opacity));
      assert.equal(await opacidade(b), 0, 'escondidas antes do toque');
      assert.equal(await b.locator('.ch-hora-calha').count(), 1, 'fala seguida tem hora na calha');
      await b.locator('.c-texto').tap();
      await page.waitForTimeout(250);
      assert.equal(await b.getAttribute('data-ativa'), 'true');
      assert.equal(await opacidade(b), 1, 'aparecem com o toque');
      await b.getByRole('button', { name: 'Reagir', exact: true }).tap();
      await b.getByRole('button', { name: 'Reagir com 👍', exact: true }).tap();
      await b.locator('.ch-reacao[data-minha="true"]').waitFor();
      await page.locator('.ch-painel-cabeca').tap();
      await page.waitForTimeout(250);
      assert.notEqual(await b.getAttribute('data-ativa'), 'true', 'tocar fora esconde');
      assert.notEqual(await a.getAttribute('data-ativa'), 'true');
    } finally {
      await context.close();
    }
  });

  await cenario('F09-regua', 'régua escondida não recebe clique fora da bolha nem toque; Tab alcança e mostra', async (abrir) => {
    const estado = criarEstado({
      iniciais: [
        msgSeed('primeira fala com texto', '2026-09-21T12:00:00.000Z'),
        msgSeed('seguida', '2026-09-21T12:01:00.000Z'),
      ],
    });
    const state = await abrir({ custom: estado.handler });
    await state.context.route('**/api/chat/live', (route) => route.abort());
    const { page } = state;
    const dialogos = [];
    page.on('dialog', (d) => { dialogos.push(d.message()); void d.dismiss(); });
    await page.goto(BASE + `/chat/${GERAL}`);
    const [, b] = estado.mensagens.map((m) => page.locator(`#chat-msg-${m.id}`));
    await b.waitFor();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const bolhaB = await b.boundingBox();
    const reguaB = b.locator('.c-acoes');
    const opacidade = () => reguaB.evaluate((e) => Number(getComputedStyle(e).opacity));
    assert.equal(await opacidade(), 0, 'escondida sem hover');
    const editarEdit = page.getByLabel('Editar mensagem', { exact: true });
    // Cada botão da régua, no pedaço que fica FORA da bolha (acima dela): clique direto.
    for (const nome of ['Reagir', 'Editar', 'Apagar']) {
      await page.mouse.move(2, 2);
      await page.waitForTimeout(150);
      const agora = await b.boundingBox();
      const caixa = await b.getByRole('button', { name: nome, exact: true }).boundingBox();
      const y = Math.min(caixa.y + caixa.height / 2, agora.y - 3);
      assert.ok(y >= caixa.y, `o botão ${nome} tem pedaço fora da bolha: ${JSON.stringify({ caixa, agora })}`);
      await page.mouse.click(caixa.x + caixa.width / 2, y);
      await page.waitForTimeout(250);
      assert.deepEqual(dialogos, [], `clique fora da bolha em ${nome} não abre confirmação`);
      assert.equal(await editarEdit.count(), 0, `clique fora da bolha em ${nome} não entra em edição`);
      assert.equal(await b.getByRole('button', { name: 'Reagir com 👍', exact: true }).count(), 0, `clique fora em ${nome} não abre emojis`);
    }
    // Com o ponteiro DENTRO da bolha, a régua aparece e responde (é o uso pretendido).
    await page.mouse.move(bolhaB.x + bolhaB.width / 2, bolhaB.y + bolhaB.height / 2);
    await page.waitForTimeout(300);
    assert.equal(await opacidade(), 1, 'hover na bolha mostra a régua');
    // Bolha curta ("seguida"): a régua segue numa linha só e não passa da borda direita da bolha.
    const botoes = await reguaB.locator('.c-acao').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
    assert.equal(new Set(botoes.map((r) => Math.round(r.y))).size, 1, `régua numa linha: ${JSON.stringify(botoes)}`);
    assert.ok(Math.max(...botoes.map((r) => r.right)) <= bolhaB.x + bolhaB.width + 1, 'régua não passa da borda da minha bolha');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    // Teclado: Tab chega a um botão da régua e ela aparece; Enter em Apagar pede confirmação.
    await page.locator('body').focus();
    let naRegua = false;
    for (let i = 0; i < 60 && !naRegua; i++) {
      await page.keyboard.press('Tab');
      naRegua = await page.evaluate(() => Boolean(document.activeElement?.closest('.c-acoes')));
    }
    assert.ok(naRegua, 'Tab alcança a régua');
    await page.waitForTimeout(300);
    const visivel = await page.evaluate(() => {
      const r = document.activeElement.closest('.c-acoes');
      const s = getComputedStyle(r);
      return { op: Number(s.opacity), pe: s.pointerEvents, anel: getComputedStyle(document.activeElement).outlineStyle };
    });
    assert.equal(visivel.op, 1, 'régua focada aparece');
    assert.equal(visivel.pe, 'auto');
    assert.notEqual(visivel.anel, 'none', 'foco visível no botão');
    const primeiroApagar = page.getByRole('button', { name: 'Apagar', exact: true }).first();
    await primeiroApagar.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    assert.equal(dialogos.length, 1, 'Apagar pelo teclado pede confirmação');
    assert.equal(await page.locator('.c-fala').count(), 2, 'recusar a confirmação não apaga');
  });

  await cenario('F09-regua-toque', 'no toque, tocar onde a régua escondida estaria não aciona nada', async () => {
    const estado = criarEstado({
      iniciais: [
        msgSeed('primeira fala com texto', '2026-09-21T12:00:00.000Z'),
        msgSeed('seguida', '2026-09-21T12:01:00.000Z'),
      ],
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      await context.route('**/api/chat/live', (route) => route.abort());
      await context.route('**/api/**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const r = await estado.handler(url, req);
        await route.fulfill({ status: r?.status ?? 200, contentType: 'application/json', body: JSON.stringify(r?.body ?? respostaPadrao(url, req)) }).catch(() => {});
      });
      const page = await context.newPage();
      const dialogos = [];
      page.on('dialog', (d) => { dialogos.push(d.message()); void d.dismiss(); });
      await page.goto(BASE + `/chat/${GERAL}`);
      const [, b] = estado.mensagens.map((m) => page.locator(`#chat-msg-${m.id}`));
      await b.waitFor();
      for (const nome of ['Editar', 'Apagar']) {
        const caixa = await b.getByRole('button', { name: nome, exact: true }).boundingBox();
        await page.touchscreen.tap(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
        await page.waitForTimeout(250);
        assert.deepEqual(dialogos, [], `toque em ${nome} escondido não confirma nada`);
        assert.equal(await page.getByLabel('Editar mensagem', { exact: true }).count(), 0, `toque em ${nome} escondido não edita`);
        await page.locator('.ch-painel-cabeca').tap();
        await page.waitForTimeout(250);
      }
    } finally {
      await context.close();
    }
  });

  await cenario('F09-conexao','canal caído mostra "Reconectando…" discreto no cabeçalho, com o estado real do gerente', async (abrir) => {
    const estado = criarEstado();
    const state = await abrir({ custom: estado.handler });
    // Canal falso: a primeira conexão abre e cai; as seguintes ficam pendentes.
    await state.context.addInitScript(() => {
      const Real = window.WebSocket;
      let n = 0;
      class Falso extends EventTarget {
        constructor(u) {
          super();
          this.readyState = 0;
          if (!String(u).includes('/api/chat/live')) return new Real(u);
          if (n++ === 0) {
            setTimeout(() => {
              this.readyState = 1;
              this.onopen?.(new Event('open'));
              setTimeout(() => { this.readyState = 3; this.onclose?.(new CloseEvent('close', { code: 1006 })); }, 300);
            }, 50);
          }
        }
        send() {}
        close() { this.readyState = 3; }
      }
      window.WebSocket = Falso;
    });
    const { page } = state;
    await page.goto(BASE + `/chat/${GERAL}`);
    await page.locator('.ch-painel-nome').waitFor();
    const conexao = page.locator('.ch-conexao[role="status"]');
    assert.equal((await conexao.innerText()).trim(), '', 'não pisca no primeiro instante');
    await conexao.getByText('Reconectando…').waitFor({ timeout: 10000 });
    const cabeca = await page.locator('.ch-painel-cabeca').boundingBox();
    assert.ok(cabeca.height <= 72, `não cresce o cabeçalho: ${JSON.stringify(cabeca)}`);
  });

  return resultados;
}
