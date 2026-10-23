/**
 * F9 — a geometria dos gráficos.
 *
 * Gráfico erra em silêncio: nada aqui quebraria o build. Por isso a conta é
 * conferida como número antes de virar tinta.
 */

import { describe, expect, it } from 'vitest';

import {
  type Ponto,
  alturasRelativas,
  caminho,
  caminhoDeArea,
  limites,
  marcasDoEixo,
  posicionar,
  resumoDaSerie,
  segmentos,
} from '@/ui/grafico';

const CAIXA = { largura: 100, altura: 50 };
const p = (dia: string, valor: number | null): Ponto => ({ dia, valor });

describe('limites — o eixo não pode exagerar nem dividir por zero', () => {
  it('o piso é zero mesmo quando o menor valor é alto', () => {
    // Começar o eixo em 900 faria uma variação de 10% parecer despencar.
    expect(limites([p('a', 900), p('b', 1000)]).min).toBe(0);
  });

  it('deixa um respiro acima do maior valor', () => {
    const l = limites([p('a', 100)]);
    expect(l.max).toBeGreaterThan(100);
  });

  it('desce abaixo de zero quando há valor negativo de verdade', () => {
    // Saldo de seguidores negativo existe, e tem que aparecer.
    expect(limites([p('a', -30), p('b', 10)]).min).toBe(-30);
  });

  it('série toda zero não divide por zero', () => {
    const l = limites([p('a', 0), p('b', 0)]);
    expect(l.max).toBeGreaterThan(l.min);
  });

  it('série toda null tem eixo utilizável', () => {
    const l = limites([p('a', null)]);
    expect(l.max).toBeGreaterThan(l.min);
  });

  it('série vazia não estoura', () => {
    expect(limites([])).toEqual({ min: 0, max: 1 });
  });
});

describe('posicionar', () => {
  it('espalha os pontos de borda a borda', () => {
    const r = posicionar([p('a', 1), p('b', 2), p('c', 3)], CAIXA);
    expect(r.map((x) => x.x)).toEqual([0, 50, 100]);
  });

  it('ponto único fica no meio, não colado na esquerda', () => {
    expect(posicionar([p('a', 1)], CAIXA)[0].x).toBe(50);
  });

  it('inverte o eixo vertical — valor maior desenha mais em cima', () => {
    const r = posicionar([p('a', 0), p('b', 100)], CAIXA, { min: 0, max: 100 });
    expect(r[0].y).toBe(50); // zero no chão da caixa
    expect(r[1].y).toBe(0); // máximo no topo
  });

  it('buraco continua buraco', () => {
    const r = posicionar([p('a', 1), p('b', null)], CAIXA);
    expect(r[1].y).toBeNull();
    // O x existe: o dia ocupa lugar no eixo mesmo sem valor.
    expect(r[1].x).toBe(100);
  });

  it('nenhum ponto cai fora da caixa', () => {
    const pontos = [p('a', 0), p('b', 37), p('c', 1200), p('d', -5)];
    for (const r of posicionar(pontos, CAIXA)) {
      if (r.y === null) continue;
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThanOrEqual(CAIXA.altura);
    }
  });
});

describe('segmentos — o buraco interrompe a linha', () => {
  it('quebra em dois traços', () => {
    const s = segmentos(
      posicionar([p('a', 1), p('b', null), p('c', 3)], CAIXA),
    );
    expect(s).toHaveLength(2);
    expect(s[0]).toHaveLength(1);
    expect(s[1]).toHaveLength(1);
  });

  it('série contínua vira um traço só', () => {
    expect(segmentos(posicionar([p('a', 1), p('b', 2)], CAIXA))).toHaveLength(1);
  });

  it('buracos nas pontas não geram traço vazio', () => {
    const s = segmentos(posicionar([p('a', null), p('b', 2), p('c', null)], CAIXA));
    expect(s).toHaveLength(1);
    expect(s[0]).toHaveLength(1);
  });

  it('série toda vazia não desenha nada', () => {
    expect(segmentos(posicionar([p('a', null), p('b', null)], CAIXA))).toEqual([]);
  });
});

describe('caminho', () => {
  it('monta M seguido de L', () => {
    expect(caminho([{ x: 0, y: 10 }, { x: 50, y: 0 }])).toBe('M 0 10 L 50 0');
  });

  it('dia isolado vira um traço mínimo — some se virar ponto sem largura', () => {
    const d = caminho([{ x: 50, y: 10 }]);
    expect(d).toBe('M 49.5 10 L 50.5 10');
  });

  it('trecho vazio devolve string vazia, e não "M undefined"', () => {
    expect(caminho([])).toBe('');
  });

  it('não emite NaN', () => {
    const d = caminho(segmentos(posicionar([p('a', 0), p('b', 0)], CAIXA))[0]);
    expect(d).not.toMatch(/NaN/);
  });
});

describe('caminhoDeArea', () => {
  it('fecha no chão da caixa e volta ao começo', () => {
    const d = caminhoDeArea([{ x: 0, y: 10 }, { x: 100, y: 0 }], CAIXA);
    expect(d).toBe('M 0 10 L 100 0 L 100 50 L 0 50 Z');
  });

  it('trecho vazio não vira área', () => {
    expect(caminhoDeArea([], CAIXA)).toBe('');
  });
});

describe('marcasDoEixo', () => {
  it('poucos pontos recebem todos os rótulos', () => {
    expect(marcasDoEixo([p('a', 1), p('b', 2)], 5)).toEqual([0, 1]);
  });

  it('mês inteiro recebe no máximo o teto pedido', () => {
    const trinta = Array.from({ length: 30 }, (_, i) => p(`d${i}`, i));
    const m = marcasDoEixo(trinta, 5);
    expect(m.length).toBeLessThanOrEqual(5);
    // As pontas sempre entram: sem elas ninguém sabe onde o período começa.
    expect(m[0]).toBe(0);
    expect(m[m.length - 1]).toBe(29);
  });

  it('não repete índice', () => {
    const m = marcasDoEixo(Array.from({ length: 7 }, (_, i) => p(`d${i}`, i)), 5);
    expect(new Set(m).size).toBe(m.length);
  });

  it('série vazia não tem marca', () => {
    expect(marcasDoEixo([])).toEqual([]);
  });
});

describe('alturasRelativas', () => {
  it('a maior barra ocupa tudo e as outras a proporção', () => {
    expect(alturasRelativas([50, 100, 25])).toEqual([0.5, 1, 0.25]);
  });

  it('tudo zero não vira tudo cheio', () => {
    // A divisão por zero encheria todas as barras — o oposto da verdade.
    expect(alturasRelativas([0, 0])).toEqual([0, 0]);
  });

  it('null é barra ausente, não barra cheia', () => {
    expect(alturasRelativas([null, 10])).toEqual([0, 1]);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(alturasRelativas([])).toEqual([]);
  });
});

describe('resumoDaSerie — F14: a curva tem leitura em texto', () => {
  const fmt = (v: number) => v.toLocaleString('pt-BR');
  it('diz o intervalo, o maior dia e quantos dias faltam', () => {
    const pontos = [
      { dia: '2026-09-01', valor: 10 },
      { dia: '2026-09-02', valor: null },
      { dia: '2026-09-03', valor: 1200 },
    ];
    expect(resumoDaSerie(pontos, fmt)).toBe('01/09 a 03/09; maior valor 1.200 em 03/09; 1 dia sem coleta');
  });
  it('sem nenhum dado, não inventa maior valor', () => {
    expect(resumoDaSerie([{ dia: '2026-09-01', valor: null }], fmt)).toBe('nenhum dia do período tem dado');
  });
  it('zero medido é valor, não falta', () => {
    expect(resumoDaSerie([{ dia: '2026-09-01', valor: 0 }], fmt)).toBe('01/09 a 01/09; maior valor 0 em 01/09');
  });
});
