/**
 * As decisões do gesto de rolagem — etapa F17.25.
 *
 * O QUE ESTE ARQUIVO GUARDA, E O QUE ELE NÃO GUARDA
 *   Guarda as REGRAS: onde o arrasto pode começar, quando um movimento deixa
 *   de ser clique, quando a faixa pode avançar e como o impulso desacelera.
 *   A roda nativa e seus eixos independentes são provados no E2E F34.
 *
 *   Não guarda que o gesto FUNCIONA — isso é o Chrome quem responde, com
 *   ponteiro de verdade, e foi medido na sonda da etapa. Um teste de unidade
 *   que fingisse dispatchar `pointerdown` estaria testando o próprio fingimento.
 *
 * A REGRA MAIS IMPORTANTE É A PRIMEIRA
 *   `podePuxar` é o que separa "puxar o quadro" de "arrastar o cartão". Se ela
 *   afrouxar, mover um cartão de coluna — a única função da F17.9a — vira rolar
 *   a tela. É por isso que ela é pura e testada, e não uma condição escrita no
 *   meio de um manipulador de evento.
 */

import { describe, expect, it } from 'vitest';

import {
  ATRITO,
  BORDA_DO_ARRASTO,
  IMPULSO_MINIMO,
  LIMIAR,
  PASSO_DO_ARRASTO,
  PASSO_MINIMO_DO_ARRASTO,
  comAtrito,
  passoDoArrasto,
  passouDoLimiar,
  podeAbsorver,
  podePuxar,
  velocidade,
} from '@/board/rolagem';

/** Um alvo de mentira: só sabe responder `closest`, que é tudo o que a regra usa. */
const alvo = (casa: readonly string[]) => ({
  closest: (seletor: string) =>
    seletor
      .split(',')
      .map((s) => s.trim())
      .some((s) => casa.includes(s))
      ? {}
      : null,
});

describe('onde o arrasto de rolagem pode começar', () => {
  it('no fundo do quadro, sim', () => {
    expect(podePuxar(alvo([]))).toBe(true);
  });

  it('EM CIMA DO CARTÃO, NÃO — o arrasto dele muda o status', () => {
    // Esta é a briga que a etapa não pode perder. Ver o cabeçalho.
    expect(podePuxar(alvo(['.q-cartao']))).toBe(false);
  });

  it('em cima de botão, link, campo e rótulo, não', () => {
    for (const peca of ['button', 'a', 'input', 'textarea', 'select', 'label']) {
      expect(podePuxar(alvo([peca]))).toBe(false);
    }
  });

  it('em cima de qualquer coisa arrastável que apareça depois, não', () => {
    // O seletor pega `[draggable="true"]` de propósito: um gesto novo criado em
    // outra etapa não precisa lembrar de voltar aqui para não brigar.
    expect(podePuxar(alvo(['[draggable="true"]']))).toBe(false);
  });

  it('em cima de um campo de texto rico, não', () => {
    expect(podePuxar(alvo(['[contenteditable]']))).toBe(false);
  });

  it('sem alvo, não — não se puxa o que não existe', () => {
    expect(podePuxar(null)).toBe(false);
  });

  /**
   * O `···` DO CARTÃO — F17.63.
   *
   * A etapa pôs um botão DENTRO do cartão, e o cartão é justamente o que esta
   * regra existe para proteger. Duas coisas se provam aqui, e as duas são
   * negativas:
   *
   *   · o botão não começa rolagem, porque `button` já está no seletor — a
   *     F17.25 escreveu "qualquer coisa que já tenha gesto", e um botão de
   *     menu é exatamente isso;
   *   · o `.q-cartao` em volta dele também não — ou seja, a proteção continua
   *     valendo pelo cartão E pelo botão, e não passou a depender de um deles.
   *
   * O que este arquivo NÃO prova: que arrastar o cartão continua movendo de
   * coluna no Chrome. Isso é pixel e ponteiro, e mora em
   * `scripts/provar-mover-do-cartao.mjs`.
   */
  it('EM CIMA DO `···` DO CARTÃO, NÃO — F17.63', () => {
    expect(podePuxar(alvo(['button', '.q-cartao']))).toBe(false);
    expect(podePuxar(alvo(['button']))).toBe(false);
  });
});

describe('clique não é arrasto', () => {
  it('a tremida de um clique fica abaixo do limiar', () => {
    expect(passouDoLimiar(2, 1)).toBe(false);
    expect(passouDoLimiar(0, 0)).toBe(false);
  });

  it('um movimento de verdade passa', () => {
    expect(passouDoLimiar(40, 0)).toBe(true);
    expect(passouDoLimiar(0, -40)).toBe(true);
  });

  it('a distância é a diagonal, e não um eixo só', () => {
    // Arrastar 4 para o lado e 4 para baixo é um movimento de 5,6 px — é
    // arrasto. Medir só o eixo x diria que não foi.
    expect(passouDoLimiar(4, 4)).toBe(true);
    expect(LIMIAR).toBeLessThanOrEqual(5);
  });
});

describe('o arrasto na borda só avança enquanto há espaço no sentido pedido', () => {
  it('no meio, ela absorve nos dois sentidos', () => {
    expect(podeAbsorver(500, 3000, 1000, 300)).toBe(true);
    expect(podeAbsorver(500, 3000, 1000, -300)).toBe(true);
  });

  it('na ponta esquerda, não avança para trás', () => {
    expect(podeAbsorver(0, 3000, 1000, -300)).toBe(false);
    expect(podeAbsorver(0, 3000, 1000, 300)).toBe(true);
  });

  it('na ponta direita, não avança para frente', () => {
    expect(podeAbsorver(2000, 3000, 1000, 300)).toBe(false);
    expect(podeAbsorver(2000, 3000, 1000, -300)).toBe(true);
  });

  it('quadro que cabe na tela não absorve nada', () => {
    expect(podeAbsorver(0, 900, 1000, 300)).toBe(false);
  });
});

describe('o impulso', () => {
  it('a velocidade sai das amostras recentes, em pixels por milissegundo', () => {
    const v = velocidade(
      [
        { t: 1000, x: 500 },
        { t: 1050, x: 400 },
      ],
      1050,
    );
    expect(v).toBeCloseTo(-2, 5);
  });

  it('quem arrastou, PAROU e soltou não recebe impulso', () => {
    // As amostras antigas ficam fora da janela; a última fração de segundo é
    // parada, e é ela que conta.
    const v = velocidade(
      [
        { t: 0, x: 900 },
        { t: 50, x: 500 },
        { t: 900, x: 300 },
        { t: 950, x: 300 },
      ],
      950,
    );
    expect(Math.abs(v)).toBeLessThan(IMPULSO_MINIMO);
  });

  it('uma amostra só não dá velocidade', () => {
    expect(velocidade([{ t: 10, x: 5 }], 10)).toBe(0);
    expect(velocidade([], 10)).toBe(0);
  });

  it('o atrito derruba a velocidade, e nunca a inverte', () => {
    expect(comAtrito(2, 16)).toBeCloseTo(2 * ATRITO, 6);
    expect(comAtrito(2, 320)).toBeLessThan(2);
    expect(comAtrito(2, 320)).toBeGreaterThan(0);
    expect(comAtrito(-2, 320)).toBeLessThan(0);
  });
});

describe('o cartão arrastado até a borda da faixa — 2026-09-17', () => {
  /**
   * O DEFEITO: arrastar o cartão para o lado não rolava o quadro, e a coluna
   * fora da tela ficava inalcançável sem soltar o cartão. A faixa abaixo é um
   * quadro de 1000px de largura começando em 200px, numa janela de 1400px.
   */
  const faixa = { left: 200, right: 1200, top: 100, bottom: 700 };
  const JANELA = 1400;
  const passo = (x: number, y = 400) => passoDoArrasto(x, y, faixa, JANELA);

  it('no miolo da faixa, parado — soltar numa coluna do meio não vira rolagem', () => {
    expect(passo(700)).toBe(0);
    expect(passo(200 + BORDA_DO_ARRASTO)).toBe(0);
    expect(passo(1200 - BORDA_DO_ARRASTO)).toBe(0);
  });

  it('na borda direita anda para a direita, e na esquerda para a esquerda', () => {
    expect(passo(1190)).toBeGreaterThan(0);
    expect(passo(210)).toBeLessThan(0);
  });

  it('quanto mais perto da beirada, mais rápido', () => {
    expect(passo(1195)).toBeGreaterThan(passo(1150));
    expect(passo(1150)).toBeGreaterThanOrEqual(passo(1125));
    expect(passo(1200)).toBe(PASSO_DO_ARRASTO);
    expect(passo(200)).toBe(-PASSO_DO_ARRASTO);
  });

  it('entrar na borda já anda num passo que se vê — a rampa do zero parecia travada', () => {
    expect(passo(1200 - BORDA_DO_ARRASTO + 1)).toBe(PASSO_MINIMO_DO_ARRASTO);
    expect(passo(200 + BORDA_DO_ARRASTO - 1)).toBe(-PASSO_MINIMO_DO_ARRASTO);
  });

  it('onde a mão segura o cartão — o ponteiro a 120px da borda — já é passo de verdade', () => {
    // Medido no Chrome: com a rampa antiga, 147px em dois segundos.
    expect(passo(1200 - 120)).toBeGreaterThanOrEqual(8);
  });

  it('passar um pouco da beirada — a margem da página — ainda puxa, na força máxima', () => {
    expect(passo(1230)).toBe(PASSO_DO_ARRASTO);
    expect(passo(170)).toBe(-PASSO_DO_ARRASTO);
  });

  it('longe da faixa, nada — a barra lateral não é borda do quadro', () => {
    expect(passo(1200 + BORDA_DO_ARRASTO + 1)).toBe(0);
    expect(passo(200 - BORDA_DO_ARRASTO - 1)).toBe(0);
  });

  it('acima ou abaixo da faixa, nada — o cabeçalho da página não rola o quadro', () => {
    expect(passo(1195, 50)).toBe(0);
    expect(passo(1195, 750)).toBe(0);
  });

  it('a borda é a da parte VISÍVEL: faixa maior que a janela rola na beirada da janela', () => {
    const larga = { left: 200, right: 3000, top: 100, bottom: 700 };
    expect(passoDoArrasto(1395, 400, larga, JANELA)).toBeGreaterThan(0);
    expect(passoDoArrasto(2990, 400, larga, JANELA)).toBe(0);
  });

  it('faixa estreita encolhe a borda, e o miolo continua sendo lugar de soltar', () => {
    const estreita = { left: 0, right: 200, top: 0, bottom: 500 };
    expect(passoDoArrasto(100, 250, estreita, JANELA)).toBe(0);
    expect(passoDoArrasto(195, 250, estreita, JANELA)).toBeGreaterThan(0);
  });

  it('faixa sem largura nenhuma não rola', () => {
    expect(passoDoArrasto(0, 0, { left: 0, right: 0, top: 0, bottom: 0 }, JANELA)).toBe(0);
  });
});
