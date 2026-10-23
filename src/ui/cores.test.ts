/**
 * As cores do tema passam do mínimo legível — etapa F17.18.
 *
 * POR QUE ISTO É TESTE, E NÃO OLHÔMETRO
 *   `--luz` não é enfeite: ele aparece como TEXTO (o nome da lista selecionada
 *   na árvore, a marca do item de menu, o título da linha em foco) e como FUNDO
 *   (o botão sólido, o dia escolhido no calendário). Uma cor bonita e fraca
 *   deixaria dez telas ilegíveis de uma vez, e o defeito não quebra nada — ele
 *   cansa, que é o que `test/contraste-legivel.test.ts` já argumenta.
 *
 *   Então cada tom oferecido é medido nos DOIS papéis, contra a pior superfície
 *   do tema em que vive. O cálculo é o da WCAG 2.1, o mesmo daquele arquivo.
 *
 * ELE LÊ AS FOLHAS, E NÃO UMA CÓPIA DOS NÚMEROS
 *   Os valores saem de `src/ui/cores-do-tema.css` e as superfícies de
 *   `src/ui/obsidian.css`. Uma tabela repetida aqui passaria a ser a segunda
 *   verdade, e ela continuaria verde depois de alguém trocar a folha.
 *
 * ⚠️ DÍVIDA CONHECIDA, MEDIDA E NÃO CONSERTADA AQUI
 *   `ide` — o verde da agência, o padrão — NÃO passa no tema claro como TEXTO:
 *   `#00a344` sobre `#ffffff` dá 3,32. Isso é anterior a esta etapa e vem de
 *   `obsidian.css`, que é a cor da MARCA. Está no relatório como dívida; não se
 *   conserta por efeito colateral de uma etapa de barra lateral.
 *
 *   Como FUNDO do botão sólido ele deixou de ser dívida na F17.58: a tinta
 *   parou de ser `--ink-0` (o fundo da página, quase branco no tema claro) e
 *   passou a ser `--tinta-solido`, escura. De 1,43 para 4,86 no pior ponto do
 *   degradê. Os 7:1 do projeto continuam fora de alcance sobre `#00a344` —
 *   nem preto puro passa de 5,22 ali —, e chegar lá seria mudar o verde.
 *
 *   As dez cores NOVAS passam. Elas é que este arquivo cobra.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CHAVES_DE_COR, ROTULO_DA_COR } from '@/ui/cores';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CORES = readFileSync(join(AQUI, 'cores-do-tema.css'), 'utf8');
const OBSIDIAN = readFileSync(join(AQUI, 'obsidian.css'), 'utf8');

/**
 * Lê um token dentro do bloco do tema pedido, na folha pedida.
 *
 * ⚠️ A ÂNCORA DO TEMA CLARO INCLUI A CHAVE — `:root[data-tema='claro'] {`.
 * Sem ela, o `indexOf` casava com a MENÇÃO ao seletor dentro do comentário de
 * cabeçalho, e a janela de leitura começava antes do bloco escuro: o teste do
 * tema claro media os valores do escuro e reprovava seis cores certas. Foi o
 * que aconteceu na primeira execução.
 */
function token(css: string, nome: string, tema: 'escuro' | 'claro'): string {
  const inicio =
    tema === 'claro' ? css.indexOf(":root[data-tema='claro'] {") : css.indexOf(':root {');
  if (inicio < 0) throw new Error(`o bloco do tema ${tema} não existe nesta folha`);
  const bloco = css.slice(inicio, inicio + 4000);
  const p = bloco.indexOf(`--${nome}:`);
  if (p < 0) throw new Error(`token --${nome} não existe no tema ${tema}`);
  const linha = bloco.slice(p, bloco.indexOf(';', p));
  const h = linha.indexOf('#');
  if (h < 0) throw new Error(`--${nome} no tema ${tema} não é uma cor sólida`);
  return linha.slice(h, h + 7);
}

const canal = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function luminancia(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

const MINIMO = 4.5;

/** A folha sem os comentários dela — para procurar CÓDIGO e não prosa. */
const semComentario = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** As dez desta etapa. `ide` fica de fora — ver a dívida no cabeçalho. */
const NOVAS = CHAVES_DE_COR.filter((c) => c !== 'ide');

describe.each(['escuro', 'claro'] as const)('tema %s', (tema) => {
  /** A superfície mais clara — o pior caso para o tom como TEXTO. */
  const piorFundo = token(OBSIDIAN, 'ink-3', tema);
  /**
   * A tinta que o botão sólido usa em cima do tom.
   *
   * Continua sendo `--ink-0` PARA ESTAS DEZ CORES, e por escrito: desde a
   * F17.58 o OBSIDIAN fixa `--tinta-solido` em escuro, e `cores-do-tema.css`
   * a devolve a `--ink-0` sob `:root[data-cor]` — o teste logo abaixo cobra
   * essa linha. Se ela sumir, este número deixa de valer.
   */
  const tintaDoSolido = token(OBSIDIAN, 'ink-0', tema);

  it.each(NOVAS)(`--cor-%s passa de ${MINIMO} como TEXTO`, (cor) => {
    const valor = token(CORES, `cor-${cor}`, tema);
    const razao = contraste(valor, piorFundo);
    expect(
      razao,
      `${ROTULO_DA_COR[cor]} (${valor}) sobre ${piorFundo} = ${razao.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(MINIMO);
  });

  it.each(NOVAS)(`--cor-%s passa de ${MINIMO} como FUNDO do botão sólido`, (cor) => {
    const valor = token(CORES, `cor-${cor}`, tema);
    const razao = contraste(valor, tintaDoSolido);
    expect(
      razao,
      `tinta ${tintaDoSolido} sobre ${ROTULO_DA_COR[cor]} (${valor}) = ${razao.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(MINIMO);
  });
});

describe('a folha e a lista de chaves não podem divergir', () => {
  it.each([...CHAVES_DE_COR])('--cor-%s existe nos dois temas', (cor) => {
    expect(() => token(CORES, `cor-${cor}`, 'escuro')).not.toThrow();
    expect(() => token(CORES, `cor-${cor}`, 'claro')).not.toThrow();
  });

  it.each([...NOVAS])('a escolha `%s` redefine --luz', (cor) => {
    // Sem esta regra a amostra pintaria a cor e a tela continuaria verde — o
    // pior defeito possível num seletor de cor: ele parece funcionar.
    expect(CORES).toContain(`:root[data-cor='${cor}']`);
    expect(CORES).toMatch(new RegExp(`\\[data-cor='${cor}'\\]\\s*\\{\\s*--luz:\\s*var\\(--cor-${cor}\\)`));
  });

  it('`ide` NÃO tem regra de escolha — o padrão não carimba atributo nenhum', () => {
    // É o que mantém o sistema byte a byte como era antes desta etapa quando
    // ninguém escolheu cor.
    expect(CORES).not.toContain(":root[data-cor='ide']");
  });

  it('o degradê do botão sólido não tem mais verde escrito — ele deriva de --luz', () => {
    // ERA um verde LITERAL (`#00e65c`) no segundo ponto do degradê, e por isso
    // esta folha precisava substituir o degradê inteiro quando havia cor
    // escolhida: sem a substituição o botão saía roxo→VERDE.
    //
    // A F17.58 tirou o literal de `obsidian.css`: lá o segundo ponto passou a
    // ser `--luz` escurecida, que é o que o verde escrito sempre foi. A regra
    // daqui continua, porque ela escolhe OUTRO grau de escurecimento (86%
    // contra 90%) — é afinação da paleta, não mais um remendo.
    //
    // ⚠️ A busca ignora COMENTÁRIO. O comentário que conta esta história cita
    // o valor antigo, e uma verificação que não distingue código de prosa
    // reprovaria justamente a explicação da ausência — é o que
    // `scripts/proibido.mjs` existe para lembrar.
    expect(semComentario(OBSIDIAN)).not.toContain('#00e65c');
    expect(OBSIDIAN).toMatch(
      /\.o-btn-solido\s*\{[^}]*linear-gradient\(180deg,\s*var\(--luz\),\s*color-mix\(/,
    );
    expect(CORES).toContain(':root[data-cor] .o-btn-solido');
  });

  it('a tinta do botão sólido volta a --ink-0 quando há cor escolhida', () => {
    // O OBSIDIAN fixou `--tinta-solido` em escuro (o verde da marca é claro nos
    // dois temas). As dez cores daqui invertem com o tema — vivas no escuro,
    // escuras no claro —, que é exatamente o desenho de `--ink-0`. Sem esta
    // linha, o botão roxo do tema claro sairia tinta escura sobre roxo escuro.
    expect(CORES).toMatch(/:root\[data-cor\]\s*\{[^}]*--tinta-solido:\s*var\(--ink-0\)/);
  });
});
