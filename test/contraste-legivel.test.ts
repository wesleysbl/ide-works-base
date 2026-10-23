/**
 * Nenhum texto do sistema abaixo do mínimo legível.
 *
 * POR QUE ISTO VIROU TESTE
 *   O sistema foi descrito por quem usa como "muito apagado". Não era
 *   impressão: o tom mais fraco estava em 2.6 de contraste sobre o fundo,
 *   contra o mínimo de 4.5 — e ele aparecia 75 vezes nas telas.
 *
 *   O incômodo levou meses para virar reclamação, porque contraste ruim não
 *   quebra nada: cansa. E cansaço não aparece em teste de comportamento nem em
 *   revisão de código — só em alguém desistindo de ler um número.
 *
 * O CÁLCULO É O DA NORMA, A RÉGUA É DO PROJETO
 *   Luminância relativa e razão de contraste da WCAG 2.1 — a conta é a dela.
 *   O número não: a norma pede 4.5 para texto normal de qualquer tamanho, e
 *   este projeto pede 7, porque escreve entre 9 e 13px em quase toda peça.
 *
 * ⚠️ ELE MEDE TOKEN, E TOKEN NÃO SABE ONDE FOI PARAR
 *   Este arquivo lê um CSS e faz aritmética. Ele não vê `opacity-75` numa
 *   classe do Tailwind, não vê texto sobre degradê, não vê cor que veio do
 *   banco. Quem vê é `scripts/provar-a-letra.mjs`, que abre o Chrome e mede o
 *   fundo REAL de cada nó de texto da tela. Os dois são necessários: este
 *   guarda a paleta em cada `npm test`, aquele guarda o uso dela.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CORES_DE_PESSOA } from '@/board/cor-da-pessoa';

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'obsidian.css'),
  'utf8',
);

/** Lê um token dentro do bloco do tema pedido. */
function token(nome: string, tema: 'escuro' | 'claro'): string {
  const inicio = tema === 'claro' ? CSS.indexOf("[data-tema='claro']") : CSS.indexOf(':root {');
  const bloco = CSS.slice(inicio, inicio + 4000);
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
  return (
    0.2126 * canal((n >> 16) & 255) +
    0.7152 * canal((n >> 8) & 255) +
    0.0722 * canal(n & 255)
  );
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/**
 * A régua do texto MIÚDO, e ela é do projeto — não da norma.
 *
 * A WCAG 2.1 pede 4.5 para texto normal e não tem degrau para "pequeno": 10px
 * e 17px são a mesma exigência para ela. Este sistema escreve dica, contador e
 * carimbo entre 9 e 13px, e a queixa do usuário foi exatamente sobre esses.
 * Então a régua aqui é 7 — o que a norma chamaria de AAA — e ela vale para
 * TODOS os tons, porque não há tom neste sistema reservado a texto grande.
 */
const MINIMO = 7;

const TONS = ['plat', 'plat-dim', 'mute'] as const;

/**
 * O PIOR FUNDO NÃO É O MESMO NOS DOIS TEMAS — F17.37, e isto era um furo.
 *
 * A versão anterior media os dois contra `--ink-3` e chamava isso de pior caso.
 * No escuro está certo: `--ink-3` é a superfície mais clara, e tinta clara
 * sofre onde o fundo é mais claro. No CLARO a lógica inverte — ali `--ink-3` é
 * o branco puro, que é o MELHOR fundo possível para tinta escura. O pior é
 * `--ink-0`, o fundo da página.
 *
 * Medindo do lado errado, o teste dizia que `--mute` tinha 6,6 quando na tela
 * ele tinha 5,59, e que o tom mais apagado tinha 4,56 quando ele tinha 3,86 —
 * abaixo do mínimo que este mesmo arquivo dizia estar guardando.
 *
 * `--ink-4` fica de fora de propósito: ele é borda de campo e miolo de avatar,
 * e nenhum texto da escada de platina é escrito sobre ele. Ver
 * `scripts/provar-a-letra.mjs`, que mede o fundo REAL de cada nó na tela.
 */
const SUPERFICIES = ['ink-0', 'ink-1', 'ink-2', 'ink-3'] as const;

/**
 * F01 do plano UX: o pior fundo deixou de ser escrito à mão.
 *
 * O layout Foco pôs a página BRANCA no tema claro e a escada descendo para o
 * cinza — o pior fundo passou de `--ink-0` para `--ink-3`. Um nome fixo aqui
 * teria continuado verde medindo o melhor caso, que é exatamente o furo que a
 * F17.37 contou acima. Agora o teste procura, entre as quatro superfícies, a
 * que dá o MENOR contraste para cada tom.
 */
function piorFundo(tom: string, tema: 'escuro' | 'claro'): string {
  return SUPERFICIES.map((s) => token(s, tema)).sort(
    (a, b) => contraste(token(tom, tema), a) - contraste(token(tom, tema), b),
  )[0];
}

describe.each(['escuro', 'claro'] as const)('tema %s', (tema) => {

  it.each(TONS)(`--%s passa de ${MINIMO} sobre o pior fundo do tema`, (tom) => {
    const pior = piorFundo(tom, tema);
    const razao = contraste(token(tom, tema), pior);
    expect(razao, `--${tom} (${token(tom, tema)}) sobre ${pior} = ${razao.toFixed(2)}`).toBeGreaterThanOrEqual(
      MINIMO,
    );
  });

  it('a escada continua sendo uma escada — cada degrau se distingue do vizinho', () => {
    // Levantar o piso comprime a escada por baixo. Se dois tons de texto
    // chegarem perto demais, o sistema passa a ter três nomes para duas
    // tintas — e a hierarquia que sobrou de pé some junto com o contraste que
    // ganhou. Ver o comentário da platina em `obsidian.css`.
    for (let i = 0; i < TONS.length - 1; i += 1) {
      const r = contraste(token(TONS[i], tema), token(TONS[i + 1], tema));
      expect(r, `--${TONS[i]} → --${TONS[i + 1]} = ${r.toFixed(2)}`).toBeGreaterThan(1.2);
    }
  });

  it('o quarto degrau não voltou', () => {
    // `--faint` foi retirado, e não renomeado. Se ele reaparecer — num tema, num
    // contexto, numa folha nova — a escada volta a ter um tom cuja única função
    // é apagar, e esta etapa terá sido desfeita em silêncio.
    expect(CSS).not.toContain('--faint');
  });

  it('as superfícies se distinguem umas das outras', () => {
    // Sem separação entre os degraus, cartão e fundo viram a mesma coisa e a
    // tela fica CHAPADA — foi metade da queixa de "muito escuro". O olho
    // distingue a partir de ~1.04; abaixo disso são dois nomes para uma cor.
    const escada = ['ink-0', 'ink-1', 'ink-2', 'ink-3'];
    for (let i = 0; i < escada.length - 1; i += 1) {
      const r = contraste(token(escada[i], tema), token(escada[i + 1], tema));
      expect(r, `${escada[i]} → ${escada[i + 1]} = ${r.toFixed(3)}`).toBeGreaterThan(1.02);
    }
  });
});

describe('a luz como texto — verificação da F01', () => {
  // `--luz` é preenchimento e segue a cor escolhida. Como LETRA, o verde padrão
  // do claro (#00a344) dava 2,72 sobre `--ink-3`. `--luz-texto` é o que as
  // folhas usam em `color:`; no claro sem `data-cor` ele é um verde fechado.
  const bloco = CSS.slice(CSS.indexOf(":root[data-tema='claro']:not([data-cor])"));
  const valor = bloco.slice(bloco.indexOf('--luz-texto:')).match(/#[0-9a-f]{6}/i)?.[0] ?? '';

  it('o verde padrão como texto passa de 4,5 sobre toda superfície do claro', () => {
    expect(valor).toMatch(/^#[0-9a-f]{6}$/i);
    for (const s of SUPERFICIES) {
      const r = contraste(valor, token(s, 'claro'));
      expect(r, `--luz-texto (${valor}) sobre --${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('nenhuma folha escreve letra com `--luz` de preenchimento', () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const achados: string[] = [];
    const varrer = (dir: string) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const caminho = join(dir, item.name);
        if (item.isDirectory()) varrer(caminho);
        else if (item.name.endsWith('.css')) {
          readFileSync(caminho, 'utf8')
            .split('\n')
            .forEach((l, i) => {
              if (/(^|[^-\w])color:\s*var\(--luz\)/.test(l)) achados.push(`${caminho}:${i + 1}`);
            });
        }
      }
    };
    varrer(raiz);
    expect(achados).toEqual([]);
  });
});

describe('o prisma como texto — F11B (pendência da F01)', () => {
  // Vídeo, arte, foto e ads pintam barra e ícone com `--luz-*`; como LETRA (a
  // data da linha, o nome do tipo) a ficha do cliente lê `--luz-*-texto`. No
  // claro, #00a344/#0e8a52/#d15600 davam 3,1–4,1 sobre `--ink-3`.
  const inicio = CSS.indexOf("[data-tema='claro']");
  const blocoClaro = CSS.slice(inicio, CSS.indexOf('\n}', inicio));

  it.each(['agencia', 'estudio', 'lives', 'ia'])('--luz-%s-texto passa de 4,5 sobre toda superfície do claro', (nome) => {
    const valor = blocoClaro.slice(blocoClaro.indexOf(`--luz-${nome}-texto:`)).match(/#[0-9a-f]{6}/i)?.[0] ?? '';
    expect(valor).toMatch(/^#[0-9a-f]{6}$/i);
    for (const s of SUPERFICIES) {
      const r = contraste(valor, token(s, 'claro'));
      expect(r, `--luz-${nome}-texto (${valor}) sobre --${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('o "ok" calmo e a cor da arte — F43 Fase 5', () => {
  // O "ok" saiu do verde da marca e a arte ganhou cor própria. Os dois viram
  // LETRA (o selo "em dia", o "1 aprovada", a data da linha de arte), então
  // passam pela régua de texto nos dois temas — e o "ok" também sobre o
  // próprio soft, que é o fundo do selo. Lidos do bloco inteiro do tema, e não
  // da janela de 4000 caracteres de `token()`: eles moram depois de `--mute`.
  const bloco = (tema: 'escuro' | 'claro') => {
    const inicio = tema === 'claro' ? CSS.indexOf(":root[data-tema='claro'] {") : CSS.indexOf(':root {');
    return CSS.slice(inicio, CSS.indexOf('\n}', inicio));
  };
  const hex = (tema: 'escuro' | 'claro', nome: string) =>
    bloco(tema).slice(bloco(tema).indexOf(`--${nome}:`)).match(/#[0-9a-f]{6}/i)?.[0] ?? '';

  /** `rgba(r, g, b, a)` composto sobre um fundo sólido — o que o olho vê. */
  const sobre = (rgba: string, fundo: string): string => {
    const [r, g, b, a] = (rgba.match(/[\d.]+/g) ?? []).map(Number);
    const n = parseInt(fundo.slice(1), 16);
    const f = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const mistura = [r, g, b].map((c, i) => Math.round(c * a + f[i] * (1 - a)));
    return `#${mistura.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  };

  it.each(['escuro', 'claro'] as const)('--ok passa de 4,5 em toda superfície do %s, e sobre o próprio soft', (tema) => {
    const ok = hex(tema, 'ok');
    expect(ok).toMatch(/^#[0-9a-f]{6}$/i);
    const soft = bloco(tema).slice(bloco(tema).indexOf('--ok-soft:')).match(/rgba\([^)]+\)/)?.[0] ?? '';
    expect(soft).toMatch(/^rgba\(/);
    for (const s of SUPERFICIES) {
      const fundo = token(s, tema);
      const r = contraste(ok, fundo);
      expect(r, `--ok (${ok}) sobre --${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      const rs = contraste(ok, sobre(soft, fundo));
      expect(rs, `--ok sobre --ok-soft em --${s} = ${rs.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['escuro', 'claro'] as const)('o "ok" não é o verde da marca no %s', (tema) => {
    expect(hex(tema, 'ok').toLowerCase()).not.toBe(hex(tema, 'luz').toLowerCase());
  });

  it.each(['escuro', 'claro'] as const)('a arte como texto passa de 4,5 em toda superfície do %s', (tema) => {
    // No escuro `--tipo-arte-texto` é a própria `--tipo-arte`; no claro, um
    // passo mais fechado.
    const valor = tema === 'claro' ? hex(tema, 'tipo-arte-texto') : hex(tema, 'tipo-arte');
    expect(valor).toMatch(/^#[0-9a-f]{6}$/i);
    for (const s of SUPERFICIES) {
      const r = contraste(valor, token(s, tema));
      expect(r, `arte (${valor}) sobre --${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});


/** `rgba(r, g, b, a)` composto sobre um fundo sólido — o que o olho vê. */
function compor(rgba: string, fundo: string): string {
  const [r, g, b, a] = (rgba.match(/[\d.]+/g) ?? []).map(Number);
  const n = parseInt(fundo.slice(1), 16);
  const f = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mistura = [r, g, b].map((c, i) => Math.round(c * a + f[i] * (1 - a)));
  return `#${mistura.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe('o verde de letra sobre a névoa dele — revisão de acessibilidade (WCAG 1.4.3)', () => {
  // `bg-luz-soft text-luz` é o item ESCOLHIDO (o dia do período, o filtro
  // marcado): letra `--luz-texto` sobre a `--luz-soft` composta sobre a
  // superfície. O verde do claro dava 4,4 sobre `--ink-2` e 4,1 sobre `--ink-3`.
  it('no claro, `--luz-texto` passa de 4,5 sobre `--luz-soft` em toda superfície', () => {
    const bloco = CSS.slice(CSS.indexOf(":root[data-tema='claro']:not([data-cor])"));
    const texto = bloco.slice(bloco.indexOf('--luz-texto:')).match(/#[0-9a-f]{6}/i)?.[0] ?? '';
    const inicio = CSS.indexOf(":root[data-tema='claro'] {");
    const claro = CSS.slice(inicio, CSS.indexOf('\n}', inicio));
    const soft = claro.slice(claro.indexOf('--luz-soft:')).match(/rgba\([^)]+\)/)?.[0] ?? '';
    expect(texto).toMatch(/^#[0-9a-f]{6}$/i);
    expect(soft).toMatch(/^rgba\(/);
    for (const s of SUPERFICIES) {
      const r = contraste(texto, compor(soft, token(s, 'claro')));
      expect(r, `--luz-texto (${texto}) sobre --luz-soft em --${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('no escuro, `--luz` (a letra é o próprio verde) passa de 4,5 sobre `--luz-soft` em toda superfície', () => {
    const inicio = CSS.indexOf(':root {');
    const escuro = CSS.slice(inicio, CSS.indexOf('\n}', inicio));
    const luz = escuro.slice(escuro.indexOf('--luz:')).match(/#[0-9a-f]{6}/i)?.[0] ?? '';
    const soft = escuro.slice(escuro.indexOf('--luz-soft:')).match(/rgba\([^)]+\)/)?.[0] ?? '';
    for (const s of SUPERFICIES) {
      const r = contraste(luz, compor(soft, token(s, 'escuro')));
      expect(r, `--luz (${luz}) sobre --luz-soft em --${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('a inicial do avatar — revisão de acessibilidade (WCAG 1.4.3)', () => {
  // A inicial é `--ink-0` (branca no claro, quase preta no escuro) sobre um tom
  // do prisma ou semântico escolhido pelo id da pessoa. Com os tons de
  // preenchimento do prisma, o claro dava 3,3 (agência), 4,2 (lives) e 4,4
  // (estúdio). `CORES_DE_PESSOA` usa a variante `-texto`.
  it.each(['escuro', 'claro'] as const)('a inicial passa de 4,5 sobre toda cor de avatar, no tema %s', (tema) => {
    const bloco = (() => {
      const inicio = tema === 'claro' ? CSS.indexOf(":root[data-tema='claro'] {") : CSS.indexOf(':root {');
      return CSS.slice(inicio, CSS.indexOf('\n}', inicio));
    })();
    /** Resolve `var(--x)` até uma cor sólida, no bloco do tema (e, no claro, caindo no escuro). */
    const resolver = (v: string): string => {
      const nome = v.match(/var\((--[\w-]+)\)/)?.[1] ?? '';
      const noTema = bloco.slice(bloco.indexOf(`${nome}:`)).match(/^[^;]+;/)?.[0] ?? '';
      const noEscuro = (() => {
        const e = CSS.slice(CSS.indexOf(':root {'));
        return e.slice(e.indexOf(`${nome}:`)).match(/^[^;]+;/)?.[0] ?? '';
      })();
      const linha = bloco.includes(`${nome}:`) ? noTema : noEscuro;
      const hex = linha.match(/#[0-9a-f]{6}/i)?.[0];
      if (hex) return hex;
      const ref = linha.match(/var\((--[\w-]+)\)/)?.[0];
      if (!ref) throw new Error(`não achei o valor de ${nome} no tema ${tema}`);
      return resolver(ref);
    };
    const tinta = token('ink-0', tema);
    for (const cor of CORES_DE_PESSOA) {
      const fundo = resolver(cor);
      const r = contraste(tinta, fundo);
      expect(r, `inicial ${tinta} sobre ${cor} (${fundo}) = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('o prisma de preenchimento não escreve letra — revisão de acessibilidade', () => {
  it('nenhuma folha pinta `color:` com `--luz-agencia`, `--luz-estudio`, `--luz-lives` ou `--luz-ia`', () => {
    // As variantes `-texto` existem para isso (F11B). `.mm-conta-tipo` (IG, ADS) ainda
    // lia as de preenchimento: 3,3 e 4,2 sobre branco.
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const achados: string[] = [];
    const varrer = (dir: string) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const caminho = join(dir, item.name);
        if (item.isDirectory()) varrer(caminho);
        else if (item.name.endsWith('.css')) {
          readFileSync(caminho, 'utf8')
            .split('\n')
            .forEach((l, i) => {
              if (/(^|[^-\w])color:\s*var\(--luz-(agencia|estudio|lives|ia)\)/.test(l)) achados.push(`${caminho}:${i + 1}`);
            });
        }
      }
    };
    varrer(raiz);
    expect(achados).toEqual([]);
  });
});

describe('o dia do mês vizinho no calendário — revisão de acessibilidade (WCAG 1.4.3)', () => {
  // `.cu-cal-dia[data-fora]` esmaece o dia de outro mês, mas ele se clica como os
  // outros — é letra. A `--mute` a 0,55 de opacidade dava 2,6:1.
  const FOLHA = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'clickup.css'),
    'utf8',
  );
  const regra = FOLHA.match(/\.cu-cal-dia\[data-fora='true'\]\s*\{([^}]*)\}/)?.[1] ?? '';
  const opacidade = Number(regra.match(/opacity:\s*([\d.]+)/)?.[1] ?? 'NaN');

  it.each(['escuro', 'claro'] as const)('a letra esmaecida passa de 4,5 sobre toda superfície do %s', (tema) => {
    expect(opacidade).toBeGreaterThan(0);
    expect(opacidade).toBeLessThanOrEqual(1);
    for (const s of SUPERFICIES) {
      const fundo = token(s, tema);
      // Opacidade do elemento = a tinta composta sobre o fundo com essa opacidade.
      const mute = token('mute', tema);
      const [mr, mg, mb] = [16, 8, 0].map((sh) => (parseInt(mute.slice(1), 16) >> sh) & 255);
      const tinta = compor(`rgba(${mr}, ${mg}, ${mb}, ${opacidade})`, fundo);
      const r = contraste(tinta, fundo);
      expect(r, `--mute a ${opacidade} sobre --${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
