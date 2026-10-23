/**
 * A FILA DAS GRAVAÇÕES DOS CHIPS DA FICHA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO, REPRODUZIDO NO NAVEGADOR (e2e `R2-multiplos-cliques`)
 *
 *   O menu de responsáveis (e o de etiquetas) fica aberto enquanto se marca.
 *   Cada marca é um `PATCH` com o CONJUNTO inteiro, e a ficha mandava todos em
 *   paralelo. Com a rede lenta — o `PATCH` relê a ficha inteira antes de
 *   responder —, três cliques a cada 300 ms davam `[a]`, `[a,b]`, `[a,c]`:
 *
 *     · a resposta do primeiro chegava no meio do terceiro e, ao ser assentada,
 *       devolvia o menu ao `[a]` — o `b` se desmarcava na tela;
 *     · o terceiro clique partia desse `[a]`, mandava `[a,c]`, e o `b` ficava
 *       perdido NO SERVIDOR, sem aviso nenhum.
 *
 *   E, em paralelo, nada garante que os pedidos sejam EXECUTADOS na ordem em que
 *   saíram: o último a chegar ao banco poderia ser o mais velho.
 *
 * A REGRA
 *   As gravações saem uma depois da outra, na ordem dos cliques (cada uma é um
 *   conjunto inteiro, então a última a executar é a que vale no servidor). E só
 *   a resposta da ÚLTIMA decide o que a tela mostra: as anteriores atualizam o
 *   que se sabe do servidor, mas não mexem no que a pessoa está marcando.
 *
 * SEM REACT, de propósito: a ordem e a contagem se provam com promessas
 * manuais (`fila-de-gravacoes.test.ts`), que é como a suíte roda.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type GravacaoNaFila<T> = {
  /** A resposta desta gravação — só começa a sair quando as anteriores terminarem. */
  resultado: Promise<T>;
  /** Nenhuma gravação mais nova foi enfileirada: a resposta desta é a palavra final. */
  ehAUltima: () => boolean;
  /**
   * Esta gravação terminou (bem ou mal). Devolve se não resta nenhuma no ar —
   * é o que desliga o "salvando". Chamar uma vez por gravação.
   */
  terminou: () => boolean;
};

export type FilaDeGravacoes = {
  enfileirar: <T>(gravar: () => Promise<T>) => GravacaoNaFila<T>;
};

export function criarFilaDeGravacoes(): FilaDeGravacoes {
  let cauda: Promise<unknown> = Promise.resolve();
  let emitidas = 0;
  let terminadas = 0;

  return {
    enfileirar<T>(gravar: () => Promise<T>): GravacaoNaFila<T> {
      emitidas += 1;
      const numero = emitidas;
      const resultado = cauda.then(gravar);
      // A seguinte espera esta terminar, e a falha desta não a trava: ela chega
      // só a quem a pediu, por `resultado`.
      cauda = resultado.then(
        () => undefined,
        () => undefined,
      );
      return {
        resultado,
        ehAUltima: () => numero === emitidas,
        terminou: () => {
          terminadas += 1;
          return terminadas === emitidas;
        },
      };
    },
  };
}
