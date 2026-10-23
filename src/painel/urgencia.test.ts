/**
 * A urgência como a tela a escreve — F30.
 *
 * O nome mudou ("Paz / Alerta / Perigo" → "Em dia / Atenção / Crítico") e a
 * chave não. Esta suíte cobra as duas metades: o rótulo novo, e que Painel e
 * tela do cliente leem do mesmo mapa em vez de guardar uma cópia cada.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { URGENCIA, URGENCIAS } from '@/painel/urgencia';
import { IconeAlerta, IconePaz, IconePerigo } from '@/ui/Icones';

describe('os três nomes da urgência', () => {
  it('paz é "Em dia", alerta é "Atenção", perigo é "Crítico"', () => {
    expect(URGENCIA.paz.rotulo).toBe('Em dia');
    expect(URGENCIA.alerta.rotulo).toBe('Atenção');
    expect(URGENCIA.perigo.rotulo).toBe('Crítico');
  });

  it('as chaves continuam as do banco, na ordem do calmo ao grave', () => {
    expect(URGENCIAS).toEqual(['paz', 'alerta', 'perigo']);
  });

  it('tom, cor e ícone não mudaram com o nome', () => {
    expect(URGENCIA.paz).toMatchObject({ tom: 'ok', cor: 'var(--ok)', Icone: IconePaz });
    expect(URGENCIA.alerta).toMatchObject({ tom: 'warn', cor: 'var(--warn)', Icone: IconeAlerta });
    expect(URGENCIA.perigo).toMatchObject({ tom: 'err', cor: 'var(--err)', Icone: IconePerigo });
  });
});

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (...p: string[]) => readFileSync(join(RAIZ, ...p), 'utf8');

describe('um mapa só', () => {
  it.each([['pages', 'Painel.tsx'], ['pages', 'Cliente.tsx']])(
    '%s/%s usa `painel/urgencia` e não guarda cópia',
    (...caminho) => {
      const fonte = ler(...caminho);
      expect(fonte).toContain("from '@/painel/urgencia'");
      expect(fonte).not.toMatch(/const URGENCIA\s*=/);
      expect(fonte).not.toMatch(/'(Paz|Alerta|Perigo)'/);
    },
  );
});
