/**
 * F10c — o ranking de criativos.
 *
 * O ponto: o resultado de um criativo depende da CAMPANHA em que ele rodou, e
 * em custo por resultado o primeiro lugar é o menor número.
 */

import { describe, expect, it } from 'vitest';

import {
  type Criativo,
  contarPorFamilia,
  familiaDoCriativo,
  filtrarPorFamilia,
  ordenarRanking,
  valorNoRanking,
} from '@/meta/ranking';

const cr = (p: Partial<Criativo> & { adId: string }): Criativo => ({
  nome: `criativo ${p.adId}`,
  campanha: null,
  objetivo: 'OUTCOME_ENGAGEMENT',
  conta: null,
  gerenciador: null,
  miniatura: null,
  situacao: 'ACTIVE',
  spend: null,
  impressions: null,
  clicks: null,
  linkClicks: null,
  alcanceAprox: null,
  dias: 1,
  acoes: [],
  ...p,
});

const acao = (tipo: string, valor: number) => ({ action_type: tipo, value: valor });

describe('familiaDoCriativo — vem da campanha, não do anúncio', () => {
  it('o criativo herda o objetivo da campanha em que rodou', () => {
    // Um anúncio não tem objetivo. Quem tem é a campanha.
    expect(familiaDoCriativo(cr({ adId: '1', objetivo: 'MESSAGES' }))).toBe('mensagem');
    expect(familiaDoCriativo(cr({ adId: '2', objetivo: 'OUTCOME_SALES' }))).toBe('vendas');
  });
});

describe('valorNoRanking — resultado', () => {
  it('lê a ação certa para a família da campanha', () => {
    const mensagem = cr({
      adId: 'm',
      objetivo: 'MESSAGES',
      acoes: [
        acao('onsite_conversion.messaging_conversation_started_7d', 12),
        acao('link_click', 400),
      ],
    });
    expect(valorNoRanking(mensagem, 'resultado')).toBe(12);
  });

  it('o MESMO criativo vale coisas diferentes em campanhas diferentes', () => {
    const acoes = [
      acao('onsite_conversion.messaging_conversation_started_7d', 12),
      acao('landing_page_view', 90),
    ];
    expect(valorNoRanking(cr({ adId: 'a', objetivo: 'MESSAGES', acoes }), 'resultado')).toBe(12);
    expect(valorNoRanking(cr({ adId: 'a', objetivo: 'OUTCOME_TRAFFIC', acoes }), 'resultado')).toBe(
      90,
    );
  });

  it('alcance vem da coluna, mesmo sendo aproximado', () => {
    const c = cr({ adId: 'x', objetivo: 'OUTCOME_AWARENESS', alcanceAprox: 5_000 });
    expect(valorNoRanking(c, 'resultado')).toBe(5_000);
  });
});

describe('valorNoRanking — custo por resultado', () => {
  it('divide o gasto pelo resultado da família', () => {
    const c = cr({
      adId: 'c',
      objetivo: 'OUTCOME_LEADS',
      spend: 100,
      acoes: [acao('lead', 4)],
    });
    expect(valorNoRanking(c, 'custo_por_resultado')).toBe(25);
  });

  it('resultado zero com gasto NÃO vira custo zero', () => {
    // Custo zero seria o primeiro lugar do ranking de mais barato — premiando
    // exatamente quem não entregou nada.
    const c = cr({ adId: 'z', objetivo: 'OUTCOME_LEADS', spend: 500, acoes: [acao('lead', 0)] });
    expect(valorNoRanking(c, 'custo_por_resultado')).toBeNull();
  });

  it('sem gasto conhecido não há custo', () => {
    const c = cr({ adId: 'y', objetivo: 'OUTCOME_LEADS', acoes: [acao('lead', 3)] });
    expect(valorNoRanking(c, 'custo_por_resultado')).toBeNull();
  });
});

describe('valorNoRanking — as perguntas de engajamento', () => {
  const c = cr({
    adId: 'e',
    acoes: [
      acao('post_reaction', 110),
      acao('comment', 6),
      acao('onsite_conversion.post_save', 44),
      acao('video_view', 900),
      acao('link_click', 1065),
    ],
    alcanceAprox: 12_844,
    impressions: 30_000,
  });

  it('cada aba lê a sua ação', () => {
    expect(valorNoRanking(c, 'curtidas')).toBe(110);
    expect(valorNoRanking(c, 'comentarios')).toBe(6);
    expect(valorNoRanking(c, 'salvamentos')).toBe(44);
    expect(valorNoRanking(c, 'visualizacoes')).toBe(900);
    expect(valorNoRanking(c, 'cliques')).toBe(1065);
    expect(valorNoRanking(c, 'alcance')).toBe(12_844);
  });

  it('ação ausente é null, e não zero', () => {
    expect(valorNoRanking(cr({ adId: 'v' }), 'curtidas')).toBeNull();
  });
});

describe('ordenarRanking', () => {
  const lista = [
    cr({ adId: 'a', objetivo: 'OUTCOME_LEADS', spend: 100, acoes: [acao('lead', 10)] }),
    cr({ adId: 'b', objetivo: 'OUTCOME_LEADS', spend: 100, acoes: [acao('lead', 2)] }),
    cr({ adId: 'c', objetivo: 'OUTCOME_LEADS', spend: 100, acoes: [] }),
  ];

  it('mais resultado primeiro', () => {
    expect(ordenarRanking(lista, 'resultado').map((x) => x.criativo.adId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('em CUSTO, o primeiro lugar é o MENOR', () => {
    // 100/10 = 10 é mais barato que 100/2 = 50.
    const r = ordenarRanking(lista, 'custo_por_resultado');
    expect(r[0].criativo.adId).toBe('a');
    expect(r[0].valor).toBe(10);
    expect(r[1].valor).toBe(50);
  });

  it('o desconhecido fica no fim NAS DUAS direções', () => {
    // Criativo sem lead não é o de menor custo por lead: é o que não tem custo
    // por lead. Subir ao topo faria a tela premiar quem não entregou.
    expect(ordenarRanking(lista, 'resultado').at(-1)?.criativo.adId).toBe('c');
    expect(ordenarRanking(lista, 'custo_por_resultado').at(-1)?.criativo.adId).toBe('c');
  });

  it('não altera a lista original', () => {
    const antes = lista.map((c) => c.adId);
    ordenarRanking(lista, 'resultado');
    expect(lista.map((c) => c.adId)).toEqual(antes);
  });

  it('lista vazia não estoura', () => {
    expect(ordenarRanking([], 'resultado')).toEqual([]);
  });
});

describe('filtrarPorFamilia e contarPorFamilia', () => {
  const lista = [
    cr({ adId: '1', objetivo: 'MESSAGES' }),
    cr({ adId: '2', objetivo: 'OUTCOME_ENGAGEMENT' }),
    cr({ adId: '3', objetivo: 'POST_ENGAGEMENT' }),
  ];

  it('filtra pela família', () => {
    expect(filtrarPorFamilia(lista, 'mensagem').map((c) => c.adId)).toEqual(['1']);
  });

  it('as duas gerações de nome caem na mesma família', () => {
    // OUTCOME_ENGAGEMENT e POST_ENGAGEMENT são o mesmo objetivo com nomes de
    // épocas diferentes. Contá-los separado partiria a aba em duas.
    expect(filtrarPorFamilia(lista, 'engajamento')).toHaveLength(2);
    expect(contarPorFamilia(lista).get('engajamento')).toBe(2);
  });

  it('null devolve tudo', () => {
    expect(filtrarPorFamilia(lista, null)).toHaveLength(3);
  });
});
