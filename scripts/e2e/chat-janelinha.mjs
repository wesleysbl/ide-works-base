/**
 * A janelinha do chat (WidgetDoChat) no Chrome real, com a API simulada — conferência de 08/10/2026.
 *
 * A janelinha escuta o canal ao vivo em qualquer tela e desenha a conversa
 * aberta nela. A tela cheia do Chat tinha a conta feita (reconciliar pela
 * chave de envio, aplicar edição e apagamento pelo id); a janelinha não:
 *
 *   J1. a mensagem que EU envio da janelinha chega também pelo canal ao vivo
 *       (o autor é destinatário de si mesmo). Se o evento passa na frente da
 *       resposta do POST, a bolha aparecia DUAS vezes — a otimista e a do
 *       evento, com o mesmo id depois da resposta;
 *   J2. alguém APAGA uma mensagem enquanto a janelinha está aberta nela: o
 *       texto tem de sair da tela (ficava até fechar e reabrir);
 *   J3. alguém EDITA uma mensagem: o texto novo entra e a bolha diz "editada";
 *   J4. a mensagem apagada que vem do histórico desenha "Mensagem apagada", e
 *       não uma bolha vazia; a imagem sem texto desenha "Imagem", e não o
 *       markdown cru.
 *
 * Nada toca o banco: a API é a simulada de `chat.mjs`. Ver `comum.mjs`.
 */

import assert from 'node:assert/strict';

import { BIA, EU, GERAL, criarEstado, msgSeed } from './chat.mjs';
import { BASE, criarSuite } from './comum.mjs';

/** Dispara na página um evento da central, como se o WebSocket tivesse trazido. */
const aoVivo = (page, detail) =>
  page.evaluate((d) => {
    window.dispatchEvent(new CustomEvent('ideworks:chat-live', { detail: d }));
  }, detail);

/** Uma mensagem de OUTRA pessoa (Bia) no Geral. */
const deBia = (body, at, extras = {}) => ({ ...msgSeed(body, at), authorId: BIA, ...extras });

/**
 * Abre a janelinha numa tela que NÃO é o Chat, e entra no Geral.
 * `segurarEnvio`: o POST de mensagem responde só quando o cenário soltar.
 */
async function abrirJanelinha(abrir, estado, { segurarEnvio = false } = {}) {
  let soltar = () => {};
  const portao = new Promise((r) => {
    soltar = r;
  });
  const state = await abrir({
    custom: (url, req) => {
      const resposta = estado.handler(url, req);
      const ehEnvio = url.pathname === `/api/chat/conversations/${GERAL}/messages` && req.method() === 'POST';
      return segurarEnvio && ehEnvio ? portao.then(() => resposta) : resposta;
    },
  });
  await state.context.route('**/api/chat/live', (route) => route.abort());
  await state.page.goto(BASE + '/meu-trabalho');
  await state.page.getByRole('button', { name: 'Abrir Chat', exact: true }).click();
  const janela = state.page.getByRole('complementary', { name: 'Chat Flutuante' });
  await janela.getByRole('button', { name: /Geral/ }).click();
  await janela.getByPlaceholder('Escreva uma mensagem…').waitFor();
  return { ...state, janela, soltar };
}

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('J1', 'a minha mensagem não duplica quando o evento passa na frente da resposta', async (abrir) => {
    const estado = criarEstado();
    const { page, janela, soltar } = await abrirJanelinha(abrir, estado, { segurarEnvio: true });

    const campo = janela.getByPlaceholder('Escreva uma mensagem…');
    await campo.fill('combinado das dez');
    await campo.press('Enter');
    await janela.getByText('combinado das dez').waitFor();

    // O servidor já gravou (o dublê empilha na hora); a RESPOSTA fica presa.
    // O canal ao vivo entrega o evento primeiro, como o Worker faz.
    await page.waitForFunction(() => true);
    for (let i = 0; i < 40 && estado.mensagens.length === 0; i++) await page.waitForTimeout(50);
    assert.equal(estado.mensagens.length, 1, 'o dublê recebeu o envio');
    const { recipientIds, ...gravada } = estado.mensagens[0];
    void recipientIds;
    await aoVivo(page, { type: 'message_new', message: gravada });
    await page.waitForTimeout(150);
    soltar();
    await page.waitForTimeout(400);

    assert.equal(
      await janela.getByText('combinado das dez').count(),
      1,
      'uma bolha só, e não a otimista mais a do evento',
    );
  });

  await cenario('J2', 'mensagem apagada por outra pessoa sai da janelinha', async (abrir) => {
    const estado = criarEstado({ iniciais: [deBia('segredo do cliente', '2026-09-21T12:00:00.000Z')] });
    const { page, janela } = await abrirJanelinha(abrir, estado);
    await janela.getByText('segredo do cliente').waitFor();

    const m = estado.mensagens[0];
    await aoVivo(page, {
      type: 'message_deleted',
      message: { ...m, body: '', deletedAt: new Date().toISOString() },
    });

    await janela.getByText('Mensagem apagada', { exact: true }).waitFor({ timeout: 3000 });
    assert.equal(await janela.getByText('segredo do cliente').count(), 0, 'o texto apagado não fica na tela');
  });

  await cenario('J3', 'mensagem editada por outra pessoa entra na janelinha', async (abrir) => {
    const estado = criarEstado({ iniciais: [deBia('reunião às 9', '2026-09-21T12:00:00.000Z')] });
    const { page, janela } = await abrirJanelinha(abrir, estado);
    await janela.getByText('reunião às 9').waitFor();

    const m = estado.mensagens[0];
    await aoVivo(page, {
      type: 'message_edited',
      message: { ...m, body: 'reunião às 10', editedAt: new Date().toISOString() },
    });

    await janela.getByText('reunião às 10').waitFor({ timeout: 3000 });
    assert.equal(await janela.getByText('reunião às 9', { exact: true }).count(), 0, 'o texto velho sai');
    await janela.getByText('editada', { exact: true }).waitFor();
  });

  await cenario('J4', 'apagada e imagem vindas do histórico não desenham bolha vazia nem markdown cru', async (abrir) => {
    const imagem = '![Imagem anexada](attachment:11111111-1111-4111-8111-111111111111)';
    const estado = criarEstado({
      iniciais: [
        deBia('', '2026-09-21T12:00:00.000Z', { deletedAt: '2026-09-21T12:05:00.000Z' }),
        deBia(imagem, '2026-09-21T12:10:00.000Z'),
      ],
    });
    const { janela } = await abrirJanelinha(abrir, estado);

    await janela.getByText('Mensagem apagada', { exact: true }).waitFor({ timeout: 3000 });
    await janela.getByText('Imagem', { exact: true }).waitFor({ timeout: 3000 });
    assert.equal(await janela.getByText('attachment:').count(), 0, 'o markdown cru não aparece');
  });

  await cenario('J5', 'janelinha fechada: a conversa que ela deixou aberta volta a contar não lida', async (abrir) => {
    // A conversa "aberta" é compartilhada com a tela cheia e valia também com a
    // janelinha FECHADA (o X só a esconde): o gerente zerava a conversa na conta
    // do selo e calava som e aviso do sistema para ela — a pessoa fechava a
    // janelinha e deixava de saber que o colega respondeu.
    const estado = criarEstado();
    const { page, janela } = await abrirJanelinha(abrir, estado);

    await janela.getByRole('button', { name: 'Fechar', exact: true }).click();
    await janela.waitFor({ state: 'detached' });

    estado.setUnreadGeral(1);
    await aoVivo(page, {
      type: 'message_new',
      message: {
        id: 'm-depois-de-fechar',
        conversationId: GERAL,
        authorId: BIA,
        body: 'responde aí?',
        kind: 'person',
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        clientKey: null,
      },
    });

    const botao = page.getByRole('button', { name: 'Abrir Chat', exact: true });
    await botao.waitFor();
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="Abrir Chat"]')?.textContent?.trim() === '1',
      null,
      { timeout: 3000 },
    );
  });

  void EU;
  return resultados;
}
