/**
 * A LETRA PEQUENA — as quatro regras da F17.37, guardadas onde não custam nada.
 *
 * O QUE ESTE ARQUIVO GUARDA, E O QUE ELE NÃO CONSEGUE GUARDAR
 *   `scripts/provar-a-letra.mjs` abre o Chrome e mede o fundo real de cada nó
 *   de texto da tela. É a régua de verdade, e é a única que enxerga `opacity`,
 *   degradê e cor vinda do banco. Só que ela precisa de um navegador, de um
 *   servidor no ar e de uma sessão — e por isso não roda a cada `npm test`.
 *
 *   Este arquivo é o contrário: não enxerga tela nenhuma, e roda sempre. Ele
 *   guarda as quatro decisões que, se voltarem atrás, desfazem a etapa em
 *   silêncio — sem quebrar nada, sem falhar nada, só apagando a interface de
 *   novo. É o mesmo argumento de `contraste-legivel.test.ts`: contraste ruim
 *   não quebra, cansa.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const OBSIDIAN = readFileSync(join(RAIZ, 'src', 'ui', 'obsidian.css'), 'utf8');

/** Todo arquivo de código e de estilo que a interface usa. */
function fontes(pasta: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) achados.push(...fontes(caminho));
    else if (['.ts', '.tsx', '.css'].includes(extname(entrada.name))) achados.push(caminho);
  }
  return achados;
}

const TELA = fontes(join(RAIZ, 'src')).map((f) => [f, readFileSync(f, 'utf8')] as const);

describe('o quarto degrau da escada de texto não volta', () => {
  it('nenhum arquivo da interface pede `--faint` nem `text-faint`', () => {
    // Ele foi RETIRADO, e não renomeado. Um `--faint: var(--mute)` deixado como
    // ponte devolveria dois nomes para uma tinta — que é a decisão D10 ao
    // contrário — e um `--faint` novo com valor próprio devolveria o tom que
    // esta etapa mediu em 3,86 no fundo da página do tema claro.
    const reincidentes = TELA.filter(([, s]) => /--faint\b|\btext-faint\b/.test(s)).map(
      ([f]) => f.slice(RAIZ.length + 1),
    );
    expect(reincidentes, reincidentes.join(', ')).toEqual([]);
  });
});

describe('a régua do formulário mora num lugar só', () => {
  const valor = (nome: string) => {
    const m = new RegExp(`--${nome}:\\s*([0-9.]+)rem`).exec(OBSIDIAN);
    if (!m) throw new Error(`--${nome} não existe em obsidian.css`);
    return parseFloat(m[1]) * 16;
  };

  it('rótulo→campo e campo→dica são o MESMO número', () => {
    // Rótulo, campo e dica são uma peça só. Folga desigual por dentro de uma
    // peça é o que faz uma coluna de seis campos parecer torta sem que
    // ninguém saiba dizer por quê.
    expect(valor('gap-rotulo')).toBe(valor('gap-dica'));
  });

  it('o salto entre blocos é maior que a folga de dentro do bloco', () => {
    // Se fossem iguais, o formulário viraria uma lista de linhas sem grupos, e
    // o olho perderia onde uma pergunta termina e a seguinte começa.
    expect(valor('gap-bloco')).toBeGreaterThan(valor('gap-rotulo') * 2);
  });

  it('a folga do rótulo sai do token, e não de um número solto na regra', () => {
    const regra = /\.o-rotulo\s*\{[^}]*\}/.exec(OBSIDIAN)?.[0] ?? '';
    expect(regra).toContain('var(--gap-rotulo)');
  });
});

describe('monoespaçado é para dado que se alinha', () => {
  it('a dica embaixo do campo usa a família do TEXTO', () => {
    // Era `font-mono` a 10,6px. Mono empilha algarismo em coluna; em frase
    // corrida ele só afasta as letras e come a diferença entre `l`, `1` e `I`.
    const regra = /\.o-dica\s*\{[^}]*\}/.exec(OBSIDIAN)?.[0] ?? '';
    expect(regra).toContain('var(--f-body)');
    expect(regra).not.toContain('--f-mono');
  });

  it('a dica não é o menor texto do sistema', () => {
    const px = parseFloat(/\.o-dica\s*\{[^}]*font-size:\s*([0-9.]+)rem/.exec(OBSIDIAN)?.[1] ?? '0') * 16;
    // 10,6px era o tamanho anterior, e era menor que o carimbo de data, menor
    // que o contador da árvore, menor que qualquer dado da tela.
    expect(px).toBeGreaterThan(11);
  });
});

describe('a cor que vem do banco não pinta letra', () => {
  it('a etiqueta do cliente leva a cor no contorno e no ponto', () => {
    // Cor de etiqueta é escolhida por quem cadastra, e não passa por régua
    // nenhuma: as do painel foram medidas entre 1,93 e 4,60 como texto. O
    // sistema não pode trocá-la — pode escolher onde ela vai.
    const regra = /\.o-etiqueta\[data-cor\]\s*\{[^}]*\}/.exec(OBSIDIAN)?.[0] ?? '';
    expect(regra).toContain('border-color: var(--cor-etiqueta)');
    expect(regra).not.toMatch(/(?<!-)color:\s*var\(--cor-etiqueta\)/);
  });
});
