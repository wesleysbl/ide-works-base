/**
 * O `?` — etapa F17.24.
 *
 * O QUE ESTE TESTE GUARDA
 *   A ajuda saiu da tela e foi para trás de um `?`. Isso só é uma melhora se
 *   o `?` for ALCANÇÁVEL: se ele virar um ícone morto, a explicação não ficou
 *   escondida — ela sumiu, e sumiu justamente para quem mais precisa dela.
 *
 *   Então três coisas são cobradas aqui, e as três são as que um `refactor`
 *   quebra sem querer:
 *     · ele é um `<button>` de verdade, com nome;
 *     · ele diz se está aberto (`aria-expanded`);
 *     · fechado, a explicação NÃO está no documento — que é o ponto: a frase
 *       colada no controle era o defeito.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado, e teste que
 *   não roda é pior que teste nenhum.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NIVEIS, O_QUE_O_NIVEL_PODE, ROTULO_DO_NIVEL } from '@/board/arvore';
import { Ajuda, Balao, ItemDeMenu } from '@/board/menus';

const html = (n: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(n);

describe('o `?` é um botão, e não um enfeite', () => {
  const desenhado = html(
    createElement(Ajuda, { sobre: 'cada nível de acesso', children: 'a explicação secreta' }),
  );

  it('é um `<button type="button">`', () => {
    expect(desenhado).toContain('<button');
    expect(desenhado).toContain('type="button"');
  });

  it('tem nome para quem usa leitor de tela', () => {
    expect(desenhado).toContain('aria-label="Explicar: cada nível de acesso"');
  });

  it('diz que está fechado', () => {
    expect(desenhado).toContain('aria-expanded="false"');
  });

  it('anuncia que abre alguma coisa', () => {
    expect(desenhado).toContain('aria-haspopup="dialog"');
  });

  it('⚠️ fechado, a explicação não ocupa a tela — que é o ponto da etapa', () => {
    expect(desenhado).not.toContain('a explicação secreta');
  });
});

describe('o balão que só explica não se anuncia como menu', () => {
  it('sem `papel`, continua sendo `menu` — nada do que já existia muda', () => {
    expect(html(createElement(Balao, { aoFechar: () => {}, children: 'x' }))).toContain(
      'role="menu"',
    );
  });

  it('com `papel="dialog"`, é diálogo', () => {
    expect(
      html(createElement(Balao, { aoFechar: () => {}, papel: 'dialog', children: 'x' })),
    ).toContain('role="dialog"');
  });

  it('sem âncora, ele é desenhado onde sempre foi — sem portal', () => {
    const saida = html(
      createElement(Balao, {
        aoFechar: () => {},
        children: createElement(ItemDeMenu, { aoEscolher: () => {}, children: 'um item' }),
      }),
    );
    expect(saida).toContain('cu-balao');
    expect(saida).toContain('um item');
    expect(saida).not.toContain('data-flutuante');
  });
});

describe('os quatro níveis continuam explicados', () => {
  /*
    A frase de cada nível saiu da tela e foi para dentro do `?`. Se um nível
    novo entrar no enum e ninguém escrever a frase dele, o `?` mostraria um
    rótulo sem explicação — e o defeito ficaria escondido atrás de um clique.
  */
  it('cada nível tem rótulo e frase', () => {
    for (const n of NIVEIS) {
      expect(ROTULO_DO_NIVEL[n]).toBeTruthy();
      expect(O_QUE_O_NIVEL_PODE[n]).toBeTruthy();
    }
  });

  it('são quatro, e não três nem cinco', () => {
    expect(NIVEIS).toHaveLength(4);
  });
});
