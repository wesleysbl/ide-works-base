/**
 * O canal ao vivo recusado passa pela sessão antes de tentar de novo.
 *
 * O DEFEITO (22/09/2026, em produção)
 *   Com o crachá vencido, a abertura do WebSocket leva 401 — e o navegador não
 *   conta o motivo ao JavaScript, só o `close`. O gerente reagendava para
 *   sempre sem nenhuma chamada HTTP no meio, e é a chamada HTTP que renova o
 *   crachá. Uma aba parada ficou 5h30 assim.
 *
 * Aqui a abertura falha porque não há API atrás do proxy do Vite — para a
 * página é idêntico: fecha sem ter aberto.
 *
 * Nada toca o banco. Ver `comum.mjs`.
 */

import assert from 'node:assert/strict';

import { abrirChat, criarEstado } from './chat.mjs';
import { criarSuite, pause } from './comum.mjs';

/**
 * Conta cada tentativa de abrir o canal. `context.route` não alcança
 * WebSocket; o evento `websocket` da página, sim. Sem API em 8787 atrás do
 * proxy do Vite, a abertura falha de verdade — fecha sem ter aberto, como a
 * recusa de produção.
 */
function contarTentativas(page) {
  const tentativas = [];
  page.on('websocket', (ws) => {
    if (ws.url().includes('/api/chat/live')) tentativas.push(Date.now());
  });
  return tentativas;
}

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario(
    'L1',
    'canal recusado: confere a sessão (que renova o login) antes de cada nova tentativa',
    async (abrir) => {
      const estado = criarEstado();
      const base = estado.handler;
      const ordem = [];
      estado.handler = (url, req) => {
        if (url.pathname === '/api/auth/me') ordem.push('me');
        return base(url, req);
      };
      const state = await abrirChat(abrir, estado);
      const vivo = contarTentativas(state.page);
      const inicio = ordem.length;
      await pause(6000);

      assert.ok(vivo.length >= 3, `esperava ao menos 3 tentativas do canal, vieram ${vivo.length}`);
      const conferencias = ordem.length - inicio;
      assert.ok(
        conferencias >= vivo.length - 1,
        `cada tentativa recusada deve passar pela sessão antes da próxima: ` +
          `${vivo.length} tentativas, ${conferencias} conferências de sessão`,
      );
      return `${vivo.length} tentativas, ${conferencias} conferências de sessão`;
    },
  );

  await cenario('L2', 'sessão encerrada de vez: o canal para de tentar', async (abrir) => {
    const estado = criarEstado();
    const base = estado.handler;
    let encerrada = false;
    estado.handler = (url, req) => {
      if (encerrada && (url.pathname === '/api/auth/me' || url.pathname === '/api/auth/refresh')) {
        return { status: 401, body: { message: 'Sessão inválida ou expirada. Entre novamente.' } };
      }
      return base(url, req);
    };
    const state = await abrirChat(abrir, estado);
    const vivo = contarTentativas(state.page);
    encerrada = true;
    await pause(4000);
    const depoisDeEncerrar = vivo.length;
    await pause(8000);
    assert.equal(
      vivo.length,
      depoisDeEncerrar,
      `depois da sessão encerrada o canal não deveria tentar mais: ${depoisDeEncerrar} → ${vivo.length}`,
    );
    return `${depoisDeEncerrar} tentativa(s) até perceber, nenhuma depois`;
  });

  return resultados;
}
