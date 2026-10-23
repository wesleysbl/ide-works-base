/**
 * A TABELA DE PRÉ-CARGA ACOMPANHA A TABELA DE ROTAS — perf-front, 08/10/2026.
 *
 * `src/rotas-precarga.ts` diz ao `<head>` qual pedaço de código pedir para cada
 * endereço. Ela é uma cópia (o `vite.config.ts` não importa React), e cópia
 * envelhece: este teste LÊ `src/rotas.tsx` e compara. Uma rota nova sem entrada
 * aqui não quebra nada — só abre sem o adiantamento —, e é por isso mesmo que o
 * esquecimento precisa fazer barulho.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REGRAS_DE_PRECARGA, moduloDoCaminho } from '@/rotas-precarga';

const FONTE = readFileSync(join(import.meta.dirname, 'rotas.tsx'), 'utf8');

/** `const Quadro = lazy(() => import('@/pages/Quadro'));` → { Quadro: 'pages/Quadro' } */
const ADIADAS = new Map<string, string>(
  [...FONTE.matchAll(/const (\w+) = lazy\(\(\) => import\('@\/([\w/]+)'\)\);/g)].map((m) => [m[1], m[2]]),
);

/** `{ path: '/quadro/:listaId', element: <Quadro /> }` → [['/quadro/:listaId', 'Quadro'], …] */
const ROTAS_ESCRITAS = [...FONTE.matchAll(/path: '([^']+)', element: <(\w+) \/>/g)].map(
  (m) => [m[1], m[2]] as const,
);

/** Troca `:parametro` por um valor, para casar o endereço de verdade. */
const comValores = (padrao: string) => padrao.replace(/:\w+/g, 'algum-valor');

describe('a pré-carga da tela pelo endereço', () => {
  it('a leitura de rotas.tsx achou as rotas e as telas adiadas (a regex não ficou cega)', () => {
    expect(ROTAS_ESCRITAS.length).toBeGreaterThanOrEqual(20);
    expect(ADIADAS.size).toBeGreaterThanOrEqual(20);
  });

  it('toda rota de tela adiada tem entrada na tabela, e aponta para a tela certa', () => {
    const semEntrada: string[] = [];
    const erradas: string[] = [];
    for (const [caminho, componente] of ROTAS_ESCRITAS) {
      const modulo = ADIADAS.get(componente);
      if (modulo === undefined) continue; // `Entrar`, `CalendarioAntigo`: não adiadas
      // O "não encontrado" fica de fora de propósito: é raro e leve, e um
      // endereço digitado errado não merece adiantar pedaço nenhum.
      if (caminho === '*') continue;
      const achado = moduloDoCaminho(comValores(caminho), REGRAS_DE_PRECARGA);
      if (achado === null) semEntrada.push(caminho);
      else if (achado !== modulo) erradas.push(`${caminho} → ${achado}, esperado ${modulo}`);
    }
    expect(semEntrada).toEqual([]);
    expect(erradas).toEqual([]);
  });

  it('o desvio `/calendario` busca o Planejamento, para onde ele leva', () => {
    expect(moduloDoCaminho('/calendario', REGRAS_DE_PRECARGA)).toBe('pages/Planejamento');
  });

  it('nenhuma entrada da tabela aponta para um módulo que não é uma tela adiada', () => {
    const modulosAdiados = new Set(ADIADAS.values());
    for (const [padrao, modulo] of REGRAS_DE_PRECARGA) {
      expect(modulosAdiados.has(modulo), `${padrao} → ${modulo}`).toBe(true);
    }
  });

  it('o trecho fixo ganha do parâmetro, como no roteador', () => {
    expect(moduloDoCaminho('/meta/ranking', REGRAS_DE_PRECARGA)).toBe('pages/MetaRanking');
    expect(moduloDoCaminho('/meta/abc', REGRAS_DE_PRECARGA)).toBe('pages/MetaRelatorio');
    expect(moduloDoCaminho('/quadro', REGRAS_DE_PRECARGA)).toBe('pages/Quadro');
    expect(moduloDoCaminho('/quadro/abc', REGRAS_DE_PRECARGA)).toBe('pages/Quadro');
    expect(moduloDoCaminho('/quadro/espaco/abc', REGRAS_DE_PRECARGA)).toBe('pages/Espaco');
    expect(moduloDoCaminho('/quadro/pasta/abc', REGRAS_DE_PRECARGA)).toBe('pages/Pasta');
  });

  it('ignora maiúsculas e barra final (o roteador também), e devolve null para o resto', () => {
    expect(moduloDoCaminho('/Meu-Trabalho/', REGRAS_DE_PRECARGA)).toBe('pages/MeuTrabalho');
    expect(moduloDoCaminho('/', REGRAS_DE_PRECARGA)).toBeNull();
    expect(moduloDoCaminho('/nao-existe', REGRAS_DE_PRECARGA)).toBeNull();
    // A página do cliente tem o próprio pedaço e não passa por aqui.
    expect(moduloDoCaminho('/aprovar/token', REGRAS_DE_PRECARGA)).toBeNull();
  });

  it('a função serializada para o HTML não usa nada de fora de si', () => {
    // O `vite.config.ts` manda `moduloDoCaminho.toString()` ao navegador. Rodar
    // o texto num escopo vazio prova que ele se basta.
    const texto = moduloDoCaminho.toString();
    const isolada = new Function(`return (${texto})`)() as typeof moduloDoCaminho;
    expect(isolada('/painel', REGRAS_DE_PRECARGA)).toBe('pages/Painel');
    expect(isolada('/tarefa/xyz', REGRAS_DE_PRECARGA)).toBe('pages/Tarefa');
  });
});
