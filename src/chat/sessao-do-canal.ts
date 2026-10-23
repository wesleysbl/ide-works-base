/**
 * O canal ao vivo que fecha sem ter aberto — o laço do login vencido.
 *
 * O DEFEITO (22/09/2026)
 *   O crachá vale uma hora e o canal só o confere ao abrir. Quando o canal cai
 *   depois disso (publicação, wi-fi), a reconexão leva o crachá vencido e o
 *   servidor recusa com 401. Só que o navegador NÃO conta ao JavaScript por que
 *   a abertura de um WebSocket falhou: chega um `close` e mais nada. O gerente
 *   reagendava para sempre, e a renovação do crachá — que só acontece quando
 *   uma chamada HTTP leva 401 (`criarRenovacao` em `lib/api.ts`) — nunca
 *   rodava numa aba parada. Em produção, uma aba ficou 5h30 assim, sem receber
 *   mensagem nenhuma.
 *
 * O QUE ESTE MÓDULO DECIDE
 *   Antes de tentar de novo, passa por uma chamada HTTP comum (`conferir`).
 *   Se o crachá venceu, ela o renova pelo caminho de sempre. Se a sessão acabou
 *   de vez (401 definitivo), parar é melhor que bater na porta a cada 30 s.
 *   Qualquer outra falha — rede, renovação indisponível — não é veredito sobre
 *   a sessão: tenta de novo.
 */

import { ApiError } from '@/lib/api';

export type DepoisDeFechar = 'tentar-de-novo' | 'parar';

export async function depoisDeFecharSemAbrir(
  conferir: () => Promise<unknown>,
): Promise<DepoisDeFechar> {
  try {
    await conferir();
    return 'tentar-de-novo';
  } catch (erro) {
    if (erro instanceof ApiError && erro.status === 401 && !erro.temporario) return 'parar';
    return 'tentar-de-novo';
  }
}
