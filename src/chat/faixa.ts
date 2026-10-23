/**
 * A LARGURA DO MÓDULO, E NÃO A DA JANELA — F02 do plano UX (faixas revistas na F08).
 *
 * Até a F02 a regra de uma área por vez olhava a janela (`max-width: 720px`).
 * Em 1024 com a barra expandida e a árvore na coluna, a janela era larga, o
 * módulo tinha 400 px e a conversa ficava com 142 — "Geral" letra a letra
 * (UX01). Agora quem manda é a caixa `.ch-grade`, medida:
 *   · abaixo de 720 px — uma área por vez: a lista OU a conversa, pela rota;
 *   · de 720 a 1039 — lista e conversa; membros em sobreposição;
 *   · a partir de 1040 — os membros cabem ao lado sem a conversa descer de
 *     480: lista até 288 + vão 12 + conversa 480 + membros 240 + vão 12.
 */
export type FaixaDoChat = 'uma' | 'duas' | 'larga';
export const faixaDoChat = (largura: number): FaixaDoChat =>
  largura < 720 ? 'uma' : largura < 1040 ? 'duas' : 'larga';
