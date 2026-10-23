import { describe, expect, it } from 'vitest';

import { limitarNoQuadro } from '@/clients/mural-posicao';

const NOTA = { width: 220, height: 180 };

describe('limitarNoQuadro', () => {
  it('a posição sai inteira, mesmo com o ponteiro e o quadro medindo em fração', () => {
    const p = limitarNoQuadro(NOTA, 100.4, 50.6, 1043.5, 900, 620);
    expect(p).toEqual({ positionX: 100, positionY: 51 });
  });

  it('na borda direita com quadro fracionário: o limite arredonda para dentro', () => {
    // 1043,5 − 220 = 823,5: gravar 823,5 é recusado pelo banco; 824 passaria meio pixel.
    const p = limitarNoQuadro(NOTA, 5000, 10, 1043.5, 900, 620);
    expect(p.positionX).toBe(823);
    expect(Number.isInteger(p.positionX)).toBe(true);
  });

  it('na borda de baixo: idem', () => {
    const p = limitarNoQuadro(NOTA, 10, 5000, 1043, 900, 620.7);
    expect(p.positionY).toBe(440);
  });

  it('coordenada negativa prende em zero', () => {
    expect(limitarNoQuadro(NOTA, -30.2, -4, 1000, 900, 620)).toEqual({ positionX: 0, positionY: 0 });
  });

  it('o plano nunca é menor que a nota mais distante (largura mínima)', () => {
    const p = limitarNoQuadro(NOTA, 5000, 0, 800, 1200, 620);
    expect(p.positionX).toBe(980);
  });

  it('quadro mais estreito que a nota não dá posição negativa', () => {
    expect(limitarNoQuadro(NOTA, 50, 0, 100, 100, 620).positionX).toBe(0);
  });
});
