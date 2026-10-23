/**
 * O ALTERNADOR E AS ABAS — F03 do plano UX (UX09, W04).
 *
 * O que se prova aqui, sem navegador: a SEMÂNTICA que cada peça promete ao
 * leitor de tela e ao teclado (papéis, estado, quem entra no Tab, qual painel
 * cada aba controla) e a função pura que decide para onde cada tecla leva.
 * O teclado de verdade — foco movendo com as setas, Espaço e Enter no Chrome —
 * é o cenário 8 de `scripts/e2e/paginacao.mjs`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { idDaAba, indiceDaTecla } from '@/ui/abas';
import { Abas, AlternadorDeVista } from '@/ui/AlternadorDeVista';

const nada = () => undefined;

/** Os `<button>` do HTML, cada um como o texto do seu marcador de abertura + rótulo. */
const botoes = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((m) => ({ attrs: m[1], texto: m[2] }));

describe('para onde a tecla leva — `indiceDaTecla`', () => {
  it('→ e ← andam uma e dão a volta nas pontas', () => {
    expect(indiceDaTecla('ArrowRight', 0, 3)).toBe(1);
    expect(indiceDaTecla('ArrowRight', 2, 3)).toBe(0);
    expect(indiceDaTecla('ArrowLeft', 0, 3)).toBe(2);
    expect(indiceDaTecla('ArrowLeft', 2, 3)).toBe(1);
  });

  it('Home e End vão às pontas', () => {
    expect(indiceDaTecla('Home', 2, 3)).toBe(0);
    expect(indiceDaTecla('End', 0, 3)).toBe(2);
  });

  it('Tab, Enter, Espaço e letras não são dela — o evento segue o caminho normal', () => {
    for (const t of ['Tab', 'Enter', ' ', 'a', 'ArrowDown', 'ArrowUp']) expect(indiceDaTecla(t, 1, 3)).toBeNull();
  });

  it('fila vazia não navega', () => {
    expect(indiceDaTecla('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('`AlternadorDeVista` — botões pressionáveis, não abas', () => {
  const html = renderToStaticMarkup(
    createElement(AlternadorDeVista<'lista' | 'quadro'>, {
      rotulo: 'Forma de ver',
      valor: 'quadro',
      aoEscolher: nada,
      opcoes: [
        { valor: 'lista', rotulo: 'Lista' },
        { valor: 'quadro', rotulo: 'Quadro' },
      ],
    }),
  );

  it('é um grupo com nome, e nenhum papel de aba', () => {
    expect(html).toMatch(/^<div role="group" aria-label="Forma de ver"/);
    expect(html).not.toContain('role="tab');
    expect(html).not.toContain('aria-selected');
  });

  it('a escolhida é a pressionada; todas são botões comuns no Tab (Enter e Espaço nativos)', () => {
    const b = botoes(html);
    expect(b.map((x) => x.texto)).toEqual(['Lista', 'Quadro']);
    expect(b[0].attrs).toContain('aria-pressed="false"');
    expect(b[1].attrs).toContain('aria-pressed="true"');
    for (const x of b) {
      expect(x.attrs).toContain('type="button"');
      expect(x.attrs).not.toContain('tabindex');
    }
  });
});

describe('`Abas` — o padrão completo da APG', () => {
  const desenhar = (valor: 'a' | 'b' | 'c', contagens?: [number | undefined, number | undefined, number | undefined]) =>
    renderToStaticMarkup(
      createElement(Abas<'a' | 'b' | 'c'>, {
        rotulo: 'Situação',
        base: 'sit',
        idDoPainel: 'painel',
        valor,
        aoEscolher: nada,
        opcoes: (['a', 'b', 'c'] as const).map((v, i) => ({ valor: v, rotulo: v.toUpperCase(), contagem: contagens?.[i] })),
      }),
    );

  it('tablist com nome; cada aba com id, estado e o painel que controla', () => {
    const html = desenhar('b');
    expect(html).toMatch(/^<div role="tablist" aria-label="Situação"/);
    const b = botoes(html);
    expect(b).toHaveLength(3);
    b.forEach((x, i) => {
      const v = ['a', 'b', 'c'][i];
      expect(x.attrs).toContain(`id="${idDaAba('sit', v)}"`);
      expect(x.attrs).toContain('role="tab"');
      expect(x.attrs).toContain('aria-controls="painel"');
      expect(x.attrs).toContain(`aria-selected="${v === 'b'}"`);
    });
  });

  it('foco móvel: só a selecionada entra no Tab', () => {
    const b = botoes(desenhar('c'));
    expect(b.map((x) => /tabindex="(-?\d)"/.exec(x.attrs)?.[1])).toEqual(['-1', '-1', '0']);
  });

  it('um painel por aba quando `idDoPainel` é função', () => {
    const html = renderToStaticMarkup(
      createElement(Abas<'x' | 'y'>, {
        rotulo: 'P',
        base: 'pz',
        idDoPainel: (v) => `pz-painel-${v}`,
        valor: 'x',
        aoEscolher: nada,
        opcoes: [
          { valor: 'x', rotulo: 'X' },
          { valor: 'y', rotulo: 'Y' },
        ],
      }),
    );
    expect(html).toContain('aria-controls="pz-painel-x"');
    expect(html).toContain('aria-controls="pz-painel-y"');
  });

  it('zero é número e aparece; sem contagem, nenhum número — "não chegou" ≠ "zero"', () => {
    const com = desenhar('a', [0, 3, undefined]);
    expect(com).toMatch(/>A<span class="iw-segmento-conta tnum">0<\/span>/);
    expect(com).toMatch(/>B<span class="iw-segmento-conta tnum">3<\/span>/);
    expect(com).toMatch(/>C<\/button>/);
    expect(desenhar('a')).not.toContain('iw-segmento-conta');
  });
});
