import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { comportamentoDeRolagem, pediuMenosMovimento } from '@/ui/movimento';

afterEach(() => vi.unstubAllGlobals());

const comPreferencia = (reduzir: boolean) =>
  vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: reduzir && q.includes('reduce') }) });

describe('comportamentoDeRolagem', () => {
  it('quem pediu menos movimento rola instantâneo', () => {
    comPreferencia(true);
    expect(pediuMenosMovimento()).toBe(true);
    expect(comportamentoDeRolagem()).toBe('auto');
  });

  it('quem não pediu rola suave', () => {
    comPreferencia(false);
    expect(comportamentoDeRolagem()).toBe('smooth');
  });

  it('sem janela (a suíte desenha no servidor) cai no suave, sem lançar', () => {
    expect(pediuMenosMovimento()).toBe(false);
    expect(comportamentoDeRolagem()).toBe('smooth');
  });
});

describe('nenhuma rolagem por JavaScript ignora a preferência de menos movimento', () => {
  // O `behavior: 'smooth'` passado na chamada vence o `scroll-behavior: auto` que a
  // folha põe sob `prefers-reduced-motion`. O chat e a página do cliente rolavam
  // suave para quem pediu o contrário. Quem rola pergunta a `comportamentoDeRolagem`
  // (ou decide por `matchMedia`, como `GradeDoMes`, e nunca escreve a palavra seca).
  it('não há `behavior: \'smooth\'` escrito seco em src/', () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    const achados: string[] = [];
    const varrer = (dir: string) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const caminho = join(dir, item.name);
        if (item.isDirectory()) varrer(caminho);
        else if (/\.(ts|tsx)$/.test(item.name) && !item.name.endsWith('.test.ts')) {
          readFileSync(caminho, 'utf8')
            .split('\n')
            .forEach((l, i) => {
              if (/behavior:\s*['"]smooth['"]/.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//')) achados.push(`${caminho}:${i + 1}`);
            });
        }
      }
    };
    varrer(raiz);
    expect(achados).toEqual([]);
  });
});
