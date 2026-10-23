/**
 * F9e — o retrato do público.
 *
 * O ponto destes testes é que cada quebra pede uma ordem diferente, e uma
 * função só ordenando tudo igual erraria em duas das três.
 */

import { describe, expect, it } from 'vitest';

import {
  type Faixa,
  faixaDominante,
  ordenarFaixas,
  percentuais,
  rotularBucket,
} from '@/meta/demografia';

const f = (bucket: string, value: number): Faixa => ({ bucket, value });

describe('ordenarFaixas — idade tem ordem natural', () => {
  it('respeita a ordem das faixas, e não o tamanho delas', () => {
    // Chegando embaralhado, como a API às vezes devolve.
    const r = ordenarFaixas('age', [f('45-54', 49_806), f('13-17', 179), f('25-34', 19_696)]);
    expect(r.visiveis.map((x) => x.bucket)).toEqual(['13-17', '25-34', '45-54']);
  });

  it('NÃO corta faixa etária — cortar destruiria a curva', () => {
    const sete = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'].map((b, i) =>
      f(b, i),
    );
    const r = ordenarFaixas('age', sete, 3);
    expect(r.visiveis).toHaveLength(7);
    expect(r.outras).toBeNull();
  });

  it('faixa desconhecida vai para o FIM, não para o começo', () => {
    // `indexOf` devolve -1 para o que não está na lista, e -1 ordenaria antes
    // de tudo — a faixa nova apareceria como se fosse a mais jovem.
    const r = ordenarFaixas('age', [f('65+', 1), f('99-120', 2), f('13-17', 3)]);
    expect(r.visiveis.map((x) => x.bucket)).toEqual(['13-17', '65+', '99-120']);
  });
});

describe('ordenarFaixas — gênero tem ordem convencional', () => {
  it('feminino, masculino, não informado', () => {
    const r = ordenarFaixas('gender', [f('U', 11_980), f('M', 6_399), f('F', 135_014)]);
    expect(r.visiveis.map((x) => x.bucket)).toEqual(['F', 'M', 'U']);
  });

  it('traduz a sigla — "F" não é rótulo de tela', () => {
    expect(rotularBucket('gender', 'F')).toBe('Feminino');
    expect(rotularBucket('gender', 'M')).toBe('Masculino');
    expect(rotularBucket('gender', 'U')).toBe('Não informado');
  });

  it('sigla desconhecida aparece como veio, em vez de sumir', () => {
    expect(rotularBucket('gender', 'X')).toBe('X');
  });

  it('cidade e país não se traduzem', () => {
    expect(rotularBucket('country', 'BR')).toBe('BR');
  });
});

describe('ordenarFaixas — cidade e país: por tamanho, com cauda somada', () => {
  const cidades = Array.from({ length: 12 }, (_, i) => f(`Cidade ${i}`, (12 - i) * 10));

  it('ordena do maior para o menor', () => {
    const r = ordenarFaixas('city', cidades, 3);
    expect(r.visiveis.map((x) => x.value)).toEqual([120, 110, 100]);
  });

  it('a cauda vira UMA linha somada, e não some', () => {
    // Mostrar 3 de 12 e descartar 9 faria o público parecer concentrado numa
    // cidade quando não está.
    const r = ordenarFaixas('city', cidades, 3);
    expect(r.outras?.value).toBe(cidades.slice(3).reduce((s, x) => s + x.value, 0));
    expect(r.outras?.bucket).toContain('9');
  });

  it('sem cauda, não inventa a linha "outras"', () => {
    expect(ordenarFaixas('city', cidades.slice(0, 3), 8).outras).toBeNull();
  });

  it('empate de valor desempata pelo nome, para a ordem não dançar', () => {
    const r = ordenarFaixas('country', [f('PT', 5), f('AR', 5)], 8);
    expect(r.visiveis.map((x) => x.bucket)).toEqual(['AR', 'PT']);
  });
});

describe('percentuais', () => {
  it('cada faixa sobre o total da quebra', () => {
    const p = percentuais([f('F', 75), f('M', 25)]);
    expect(p.get('F')).toBe(0.75);
    expect(p.get('M')).toBe(0.25);
  });

  it('fecha em 100%', () => {
    const faixas = [f('a', 3), f('b', 5), f('c', 7)];
    // O acumulador começa em zero explícito: `reduce` sem valor inicial toma o
    // primeiro item da lista, que aqui é `number | null` — e somar a partir de
    // um possível nulo é justamente o defeito que este arquivo cobra do código.
    const soma = [...percentuais(faixas).values()].reduce<number>((s, v) => s + (v ?? 0), 0);
    expect(soma).toBeCloseTo(1);
  });

  it('total zero devolve null, e não divisão por zero', () => {
    expect(percentuais([f('a', 0)]).get('a')).toBeNull();
  });
});

describe('faixaDominante', () => {
  it('devolve a maior', () => {
    expect(faixaDominante('age', [f('25-34', 10), f('45-54', 90)])?.bucket).toBe('45-54');
  });

  it('empate fica com a primeira na ordem NATURAL, não com a primeira da lista', () => {
    // Sorteio disfarçado seria dizer "o público é 45-54" quando 35-44 empata.
    const r = faixaDominante('age', [f('45-54', 50), f('35-44', 50)]);
    expect(r?.bucket).toBe('35-44');
  });

  it('sem faixa nenhuma devolve null', () => {
    expect(faixaDominante('city', [])).toBeNull();
  });
});
