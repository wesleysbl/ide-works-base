/**
 * O foco que acompanha o cartão — o que é puro do gancho. A prova no Chrome
 * (a seta leva o cartão e o foco vai junto, nos três quadros) é
 * `scripts/e2e/acessibilidade.mjs` AC5.
 */

import { describe, expect, it } from 'vitest';

import { fraseDoMovimento, seletorDoCartao } from '@/board/foco-do-cartao';

describe('fraseDoMovimento', () => {
  it('diz quem foi e para onde', () => {
    expect(fraseDoMovimento('Peça 01 — FOCUS', 'Edição')).toBe('Peça 01 — FOCUS movida para Edição.');
  });

  it('não diz "movida" de um título vazio — cai em "Tarefa"', () => {
    expect(fraseDoMovimento('   ', 'Revisão')).toBe('Tarefa movida para Revisão.');
  });
});

describe('seletorDoCartao', () => {
  it('acha o cartão DENTRO da coluna de destino — e não o que ainda está na de origem', () => {
    expect(seletorDoCartao('e-2', 't-9')).toBe('[data-etapa="e-2"] [data-cartao="t-9"]');
  });

  it('escapa o que viria de dado (aspas e barras num id)', () => {
    expect(seletorDoCartao('a"b', 'c\\d')).toBe('[data-etapa="a\\"b"] [data-cartao="c\\\\d"]');
  });
});
