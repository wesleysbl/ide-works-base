/**
 * Reagir a uma mensagem do chat com emoji — F24.4, no Chrome real.
 *
 * Cinco cenários:
 *   R1. reagir numa bolha e ver o rodapé com contagem 1; tocar o mesmo remove;
 *   R2. trocar de emoji: a contagem anterior some, a nova aparece;
 *   R3. a reação de outra sessão chega ao vivo e entra no rodapé sem recarregar;
 *   R4. reposição: o que aconteceu enquanto a central estava muda volta na
 *       reconexão (evento de foco), também sem recarregar;
 *   R5. a recusa da API desfaz SÓ o meu palpite — a reação que outra pessoa
 *       mandou no meio do caminho fica.
 *
 * Nada toca o banco: a API é a simulada de `chat.mjs`. Ver `comum.mjs`.
 */

import assert from 'node:assert/strict';

import { BIA, GERAL, abrirChat, clicarNaRegua, criarEstado, msgSeed } from './chat.mjs';
import { criarSuite } from './comum.mjs';

const UMA = msgSeed('combinado', '2026-09-21T12:00:00.000Z');

const comUmaMensagem = () => criarEstado({ iniciais: [structuredClone(UMA)] });

/** A bolha da mensagem semeada. */
const bolha = (page, id) => page.locator(`#chat-msg-${id}`);

/** Abre a barra dos seis e escolhe um emoji. */
async function reagir(page, id, emoji) {
  const b = bolha(page, id);
  await clicarNaRegua(b, 'Reagir');
  await b.getByRole('button', { name: `Reagir com ${emoji}`, exact: true }).click();
}

/** Dispara na página um evento da central, como se o WebSocket tivesse trazido. */
const aoVivo = (page, detail) =>
  page.evaluate((d) => {
    window.dispatchEvent(new CustomEvent('ideworks:chat-live', { detail: d }));
  }, detail);

/**
 * Religa a central: o `focus` da aba é o que dispara o alcance do que faltou.
 * Insiste até a tela chegar no estado esperado — com a máquina carregada, um
 * disparo só pode cair antes de a reposição anterior assentar (ver
 * [[e2e-do-chat-c8-c9-instaveis]]).
 */
async function religarAte(page, condicao, arg, tentativas = 6) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    try {
      await page.waitForFunction(condicao, arg, { timeout: 2000 });
      return;
    } catch (e) {
      ultimo = e;
    }
  }
  throw ultimo;
}

const reacaoDe = (messageId, actorId, emoji, removed = false) => ({
  type: 'chat_reaction',
  conversationId: GERAL,
  messageId,
  actorId,
  emoji,
  removed,
  reactedAt: new Date().toISOString(),
});

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('R1', 'reagir mostra o emoji com contagem 1; tocar o mesmo remove', async (abrir) => {
    const estado = comUmaMensagem();
    const { page } = await abrirChat(abrir, estado);
    const id = estado.mensagens[0].id;

    await reagir(page, id, '👍');
    const botao = bolha(page, id).locator('.ch-reacao');
    await botao.waitFor({ timeout: 5000 });
    assert.match(await botao.getAttribute('aria-label'), /👍, 1 pessoa, incluindo você/);
    assert.equal(await botao.getAttribute('aria-pressed'), 'true');
    assert.equal(estado.vivas().length, 1, 'a API guardou uma reação viva');

    await botao.click();
    await bolha(page, id).locator('.ch-reacao').waitFor({ state: 'detached', timeout: 5000 });
    assert.equal(estado.vivas().length, 0, 'o mesmo emoji removeu no servidor');
  });

  await cenario('R2', 'trocar de emoji: a anterior some e a nova aparece', async (abrir) => {
    const estado = comUmaMensagem();
    const { page } = await abrirChat(abrir, estado);
    const id = estado.mensagens[0].id;

    await reagir(page, id, '👍');
    await bolha(page, id).locator('.ch-reacao').waitFor({ timeout: 5000 });
    await reagir(page, id, '❤️');

    const botoes = bolha(page, id).locator('.ch-reacao');
    await page.waitForFunction(
      (msgId) => {
        const nos = document.querySelectorAll(`#chat-msg-${msgId} .ch-reacao`);
        return nos.length === 1 && nos[0].textContent.includes('❤️');
      },
      id,
      { timeout: 5000 },
    );
    assert.equal(await botoes.count(), 1, 'uma reação por pessoa, não duas');
    assert.equal(estado.vivas().length, 1);
    assert.equal(estado.vivas()[0].emoji, '❤️');
  });

  await cenario('R3', 'a reação da outra sessão aparece sem recarregar', async (abrir) => {
    const estado = comUmaMensagem();
    const { page } = await abrirChat(abrir, estado);
    const id = estado.mensagens[0].id;

    await reagir(page, id, '👍');
    await bolha(page, id).locator('.ch-reacao').waitFor({ timeout: 5000 });

    // A outra sessão (Bia) reage com o MESMO emoji: a contagem vira 2.
    await aoVivo(page, reacaoDe(id, BIA, '👍'));
    await page.waitForFunction(
      (msgId) => {
        const b = document.querySelector(`#chat-msg-${msgId} .ch-reacao`);
        return b && /2 pessoas/.test(b.getAttribute('aria-label') ?? '');
      },
      id,
      { timeout: 5000 },
    );

    // E some quando ela desfaz.
    await aoVivo(page, reacaoDe(id, BIA, '👍', true));
    await page.waitForFunction(
      (msgId) => {
        const b = document.querySelector(`#chat-msg-${msgId} .ch-reacao`);
        return b && /1 pessoa,/.test(b.getAttribute('aria-label') ?? '');
      },
      id,
      { timeout: 5000 },
    );

    // Reação de conversa que não está aberta é ignorada.
    await aoVivo(page, { ...reacaoDe(id, BIA, '🙏'), conversationId: '11111111-1111-4111-8111-111111111111' });
    await page.waitForTimeout(300);
    assert.equal(await bolha(page, id).locator('.ch-reacao').count(), 1);
  });

  await cenario('R4', 'o que passou offline volta na reconexão, sem recarregar', async (abrir) => {
    const estado = comUmaMensagem();
    const { page } = await abrirChat(abrir, estado);
    const id = estado.mensagens[0].id;
    // O histórico já desenhou: semear antes disso corre com a leitura inicial.
    await bolha(page, id).waitFor({ timeout: 5000 });

    // Enquanto a central está muda, Bia reage direto no "servidor".
    estado.alternarReacao(id, BIA, '🙏');
    assert.equal(await bolha(page, id).locator('.ch-reacao').count(), 0, 'nada na tela ainda');

    // Reconexão: o foco da aba pede o alcance do que faltou.
    await religarAte(
      page,
      (msgId) => {
        const b = document.querySelector(`#chat-msg-${msgId} .ch-reacao`);
        return b && /🙏, 1 pessoa —/.test(b.getAttribute('aria-label') ?? '');
      },
      id,
    );
    assert.ok(estado.reacoesPedidas.length >= 1, 'a tela pediu as mudanças de reação');

    // Bia desfaz offline: a reposição traz a REMOÇÃO (lápide), não a fantasma.
    estado.alternarReacao(id, BIA, '🙏');
    await religarAte(
      page,
      (msgId) => document.querySelectorAll(`#chat-msg-${msgId} .ch-reacao`).length === 0,
      id,
    );
  });

  await cenario(
    'R5',
    'a recusa desfaz só o meu palpite: a reação que chegou no meio do caminho fica',
    async (abrir) => {
      const estado = comUmaMensagem();
      const { page } = await abrirChat(abrir, estado);
      const id = estado.mensagens[0].id;

      /* A JANELA QUE IMPORTA é entre o meu toque e a recusa: é só aí que
         devolver a lista inteira capturada no render apaga a reação de outra
         pessoa. Então a resposta do POST fica presa, a Bia reage nesse meio, e
         só depois a API recusa. */
      const soltarRecusa = estado.segurarReacao();
      estado.recusarReacao();
      await reagir(page, id, '👍');

      // O palpite já está na tela, e a API ainda não respondeu.
      await page.waitForFunction(
        (msgId) => {
          const b = document.querySelector(`#chat-msg-${msgId} .ch-reacao`);
          return b && /👍, 1 pessoa, incluindo você/.test(b.getAttribute('aria-label') ?? '');
        },
        id,
        { timeout: 5000 },
      );

      // Agora, em voo, chega a reação da Bia pelo evento ao vivo.
      await aoVivo(page, reacaoDe(id, BIA, '🙏'));
      await page.waitForFunction(
        (msgId) => document.querySelectorAll(`#chat-msg-${msgId} .ch-reacao`).length === 2,
        id,
        { timeout: 5000 },
      );

      soltarRecusa();

      await page.getByRole('alert').getByText(/Esta mensagem foi apagada/i).waitFor({ timeout: 5000 });
      // O meu palpite some; o 🙏 da Bia, que chegou no meio, FICA.
      await page.waitForFunction(
        (msgId) => {
          const nos = Array.from(document.querySelectorAll(`#chat-msg-${msgId} .ch-reacao`));
          return nos.length === 1 && /🙏/.test(nos[0].textContent);
        },
        id,
        { timeout: 5000 },
      );
      await page.waitForTimeout(300);
      const nos = bolha(page, id).locator('.ch-reacao');
      assert.equal(await nos.count(), 1, 'sobra só a reação da Bia');
      assert.match(await nos.first().getAttribute('aria-label'), /🙏, 1 pessoa —/);
      assert.equal(estado.vivas().length, 0, 'a recusa não gravou nada no servidor');
    },
  );

  return resultados;
}
