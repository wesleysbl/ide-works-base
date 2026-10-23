import { describe, expect, it } from 'vitest';

import { razaoDeContraste, tintaDaEtiqueta, varsDaEtiqueta } from '@/board/tinta-da-etiqueta';

const cor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

describe('tintaDaEtiqueta', () => {
  it('o par da origem fica como veio quando passa de 4,5:1 — a cor é dado', () => {
    expect(tintaDaEtiqueta('#1f2937', '#ffffff')).toBe('#ffffff');
    expect(tintaDaEtiqueta('#ffd966', '#000000')).toBe('#000000');
  });

  it('a etiqueta `arte` do ClickUp (#a18072 com #fff dá 3,6:1) ganha a tinta que o fundo pede', () => {
    const tinta = tintaDaEtiqueta('#a18072', '#fff');
    expect(tinta).toBe('#000000');
    expect(razaoDeContraste(cor(tinta as string), cor('#a18072'))).toBeGreaterThanOrEqual(4.5);
  });

  it('sem tinta da origem, escolhe branco ou preto pelo fundo', () => {
    expect(tintaDaEtiqueta('#101820', null)).toBe('#ffffff');
    expect(tintaDaEtiqueta('#f4c542', null)).toBe('#000000');
  });

  it('qualquer fundo termina com 4,5:1 ou mais — o pior caso é o cinza médio, 4,58', () => {
    for (let v = 0; v <= 255; v += 5) {
      const fundo = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
      const tinta = tintaDaEtiqueta(fundo, '#ffffff') as string;
      expect(razaoDeContraste(cor(tinta), cor(fundo)), `${tinta} sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const fundo of ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ffff00', '#808000', '#008080', '#800080', '#ff8800']) {
      const tinta = tintaDaEtiqueta(fundo, null) as string;
      expect(razaoDeContraste(cor(tinta), cor(fundo)), `${tinta} sobre ${fundo}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('lê `#rgb`, `#rrggbb` e `#rrggbbaa`', () => {
    expect(tintaDaEtiqueta('#000', '#fff')).toBe('#fff');
    expect(tintaDaEtiqueta('#000000ff', '#ffffff')).toBe('#ffffff');
  });

  it('um fundo que não é cor deixa a tinta como veio — o CSS cai no par do sistema', () => {
    expect(tintaDaEtiqueta(null, '#fff')).toBe('#fff');
    expect(tintaDaEtiqueta('var(--x)', null)).toBeNull();
    expect(tintaDaEtiqueta('', '#abc')).toBe('#abc');
  });
});

describe('varsDaEtiqueta', () => {
  it('escreve as duas variáveis, e só as que existem', () => {
    expect(varsDaEtiqueta('#a18072', '#fff')).toEqual({ '--cor-etiqueta-fundo': '#a18072', '--cor-etiqueta-tinta': '#000000' });
    expect(varsDaEtiqueta(null, null)).toEqual({});
    expect(varsDaEtiqueta('#101820', '#fff')).toEqual({ '--cor-etiqueta-fundo': '#101820', '--cor-etiqueta-tinta': '#fff' });
  });
});
