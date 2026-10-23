/**
 * F9f — as publicações.
 *
 * O que se testa aqui é sobretudo a recusa a somar o que não se soma e a
 * escolha da mediana onde a média mentiria.
 */

import { describe, expect, it } from 'vitest';

import {
  type Publicacao,
  filtrarPorFormato,
  formatoDa,
  mediana,
  ordenar,
  porFormato,
  resumoDaLegenda,
  taxaDeEngajamento,
} from '@/meta/publicacoes';

const pub = (p: Partial<Publicacao> & { id: string }): Publicacao => ({
  mediaId: `m${p.id}`,
  productType: 'FEED',
  mediaType: 'IMAGE',
  permalink: null,
  caption: null,
  thumbnailUrl: null,
  postedAt: '2026-08-01T12:00:00+0000',
  reach: null,
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saved: null,
  totalInteractions: null,
  profileVisits: null,
  follows: null,
  replies: null,
  navigation: null,
  ...p,
});

describe('formatoDa — a língua de quem usa, não a da API', () => {
  it('separa os dois eixos que a Meta mistura', () => {
    // "reel" mora em product_type; "carrossel" mora em media_type. Só olhando
    // os dois é que se chega ao nome que a equipe usa.
    expect(formatoDa(pub({ id: '1', productType: 'REELS', mediaType: 'VIDEO' }))).toBe('reel');
    expect(formatoDa(pub({ id: '2', productType: 'FEED', mediaType: 'CAROUSEL_ALBUM' }))).toBe(
      'carrossel',
    );
    expect(formatoDa(pub({ id: '3', productType: 'FEED', mediaType: 'IMAGE' }))).toBe('foto');
    expect(formatoDa(pub({ id: '4', productType: 'FEED', mediaType: 'VIDEO' }))).toBe('video');
    expect(formatoDa(pub({ id: '5', productType: 'STORY', mediaType: 'IMAGE' }))).toBe('story');
  });

  it('story ganha do resto — é onde ele foi publicado que importa', () => {
    expect(formatoDa(pub({ id: '6', productType: 'STORY', mediaType: 'CAROUSEL_ALBUM' }))).toBe(
      'story',
    );
  });

  it('tipo desconhecido não vira foto por acidente', () => {
    expect(formatoDa(pub({ id: '7', mediaType: 'ALGO_NOVO' }))).toBe('outro');
    expect(formatoDa(pub({ id: '8', mediaType: null }))).toBe('outro');
  });
});

describe('taxaDeEngajamento', () => {
  it('é interações sobre alcance', () => {
    expect(taxaDeEngajamento(pub({ id: '1', reach: 1000, totalInteractions: 50 }))).toBe(0.05);
  });

  it('alcance zero não vira 0%', () => {
    // 0% diria "ninguém reagiu". A verdade é que não há como calcular.
    expect(taxaDeEngajamento(pub({ id: '2', reach: 0, totalInteractions: 5 }))).toBeNull();
  });

  it('falta de dado devolve null', () => {
    expect(taxaDeEngajamento(pub({ id: '3', reach: 100 }))).toBeNull();
    expect(taxaDeEngajamento(pub({ id: '4', totalInteractions: 10 }))).toBeNull();
  });

  it('interação negativa é taxa negativa, e não erro', () => {
    // A Meta devolve saldo: dia em que se removem salvamentos fecha negativo.
    expect(taxaDeEngajamento(pub({ id: '5', reach: 100, totalInteractions: -2 }))).toBe(-0.02);
  });
});

describe('mediana — por que não média', () => {
  it('ímpar devolve o do meio', () => {
    expect(mediana([1, 100, 5])).toBe(5);
  });

  it('par devolve a média dos dois centrais', () => {
    expect(mediana([1, 3, 5, 9])).toBe(4);
  });

  it('o viral não desloca a mediana', () => {
    // Dez posts de 500 e um de 50.000: a média diria 5.000, número que nenhum
    // post fez e que faria os dez parecerem fracasso.
    const valores = [...Array(10).fill(500), 50_000];
    const media = valores.reduce((s, v) => s + v, 0) / valores.length;
    expect(mediana(valores)).toBe(500);
    expect(media).toBeGreaterThan(4_000);
  });

  it('ignora o desconhecido em vez de tratá-lo como zero', () => {
    expect(mediana([null, 10, null, 20])).toBe(15);
  });

  it('sem nenhum valor conhecido devolve null', () => {
    expect(mediana([null, null])).toBeNull();
    expect(mediana([])).toBeNull();
  });
});

describe('porFormato', () => {
  const lista = [
    pub({ id: 'a', productType: 'REELS', mediaType: 'VIDEO', reach: 1000, totalInteractions: 100 }),
    pub({ id: 'b', productType: 'REELS', mediaType: 'VIDEO', reach: 3000, totalInteractions: 300 }),
    pub({ id: 'c', productType: 'FEED', mediaType: 'IMAGE', reach: 500, totalInteractions: 10 }),
  ];

  it('agrupa e ordena pelo alcance mediano', () => {
    const r = porFormato(lista);
    expect(r.map((x) => x.formato)).toEqual(['reel', 'foto']);
    expect(r[0].quantidade).toBe(2);
    expect(r[0].alcanceMediano).toBe(2000);
  });

  it('soma interações — elas são eventos', () => {
    expect(porFormato(lista)[0].interacoes).toBe(400);
  });

  it('NÃO soma alcance: guarda o melhor e diz qual foi', () => {
    const r = porFormato(lista)[0];
    // 1.000 + 3.000 = 4.000 seria a mentira: são os mesmos seguidores.
    expect(r).not.toHaveProperty('alcanceTotal');
    expect(r.melhorAlcance).toBe(3000);
    expect(r.melhorId).toBe('b');
  });

  it('formato sem alcance conhecido cai para o fim', () => {
    const r = porFormato([...lista, pub({ id: 'z', productType: 'STORY', reach: null })]);
    expect(r[r.length - 1].formato).toBe('story');
  });

  it('lista vazia não estoura', () => {
    expect(porFormato([])).toEqual([]);
  });
});

describe('ordenar — o desconhecido nunca sobe ao topo', () => {
  const lista = [
    pub({ id: 'a', reach: 100, postedAt: '2026-08-01T00:00:00+0000' }),
    pub({ id: 'b', reach: null, postedAt: '2026-08-05T00:00:00+0000' }),
    pub({ id: 'c', reach: 900, postedAt: '2026-08-03T00:00:00+0000' }),
  ];

  it('por alcance, do maior para o menor', () => {
    expect(ordenar(lista, 'alcance').map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('sem alcance fica no fim, e não em primeiro', () => {
    // Publicação sem alcance não é a de menor alcance: é a que não se sabe.
    expect(ordenar(lista, 'alcance').at(-1)?.id).toBe('b');
  });

  it('por mais recentes', () => {
    expect(ordenar(lista, 'recentes').map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('sem data também fica no fim', () => {
    const r = ordenar([...lista, pub({ id: 'x', postedAt: null })], 'recentes');
    expect(r.at(-1)?.id).toBe('x');
  });

  it('não altera a lista original', () => {
    const antes = lista.map((p) => p.id);
    ordenar(lista, 'alcance');
    expect(lista.map((p) => p.id)).toEqual(antes);
  });
});

describe('filtrarPorFormato', () => {
  const lista = [
    pub({ id: 'a', productType: 'REELS', mediaType: 'VIDEO' }),
    pub({ id: 'b', productType: 'FEED', mediaType: 'IMAGE' }),
  ];

  it('filtra pelo formato pedido', () => {
    expect(filtrarPorFormato(lista, 'reel').map((p) => p.id)).toEqual(['a']);
  });

  it('null devolve tudo', () => {
    expect(filtrarPorFormato(lista, null)).toHaveLength(2);
  });
});

describe('resumoDaLegenda', () => {
  it('usa só a primeira linha', () => {
    expect(resumoDaLegenda('Primeira\nSegunda')).toBe('Primeira');
  });

  it('legenda curta passa inteira', () => {
    expect(resumoDaLegenda('Oi')).toBe('Oi');
  });

  it('corta na palavra, não no meio dela', () => {
    const original = 'alguns momentos da rotina merecem ser guardados para sempre';
    const r = resumoDaLegenda(original, 30);
    expect(r.endsWith('…')).toBe(true);

    // A prova é que o pedaço mantido, mais um espaço, continua sendo começo do
    // original — é isso que significa "não cortou no meio da palavra". Corte no
    // caractere daria "alguns momentos da rotina mere", e `'mere '` não aparece
    // no texto.
    const mantido = r.slice(0, -1);
    expect(original.startsWith(`${mantido} `)).toBe(true);
    expect(mantido.length).toBeLessThanOrEqual(30);
  });

  it('sem legenda diz que não há, em vez de ficar em branco', () => {
    expect(resumoDaLegenda(null)).toBe('(sem legenda)');
  });
});
