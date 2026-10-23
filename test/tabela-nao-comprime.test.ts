/**
 * A tabela de números rola — ela não comprime. F19h.
 *
 * O QUE ESTE TESTE PROTEGE
 *   Com onze métricas escolhidas, a tabela de anúncios apareceu assim:
 *
 *       LEAD          INVEST        R$ 157,7
 *       S             IDO           5
 *
 *   Dois defeitos ao mesmo tempo, e os dois nossos:
 *
 *     1. `w-full` prendia a tabela na largura do cartão, e tabela presa não
 *        transborda — ela espreme as colunas até caber.
 *     2. `overflow-wrap: anywhere` (a regra que impede nome de cliente de
 *        estourar o cartão) partia número no meio. "R$ 157,7 / 5" não é um
 *        número apertado: é um número ERRADO por meio segundo, e meio segundo
 *        basta para alguém ler 157,7 e seguir em frente.
 *
 * O QUE ELE NÃO FAZ
 *   Não renderiza nem mede nada — não há motor de CSS aqui. Ele confere que as
 *   regras e as classes continuam escritas, que é o que pega a REGRESSÃO: um
 *   `w-full` reposto sem querer, ou a neutralização removida por limpeza.
 *   Provar o resultado visual continua sendo trabalho de olhar a tela.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (...p: string[]) => readFileSync(join(RAIZ, ...p), 'utf8');

const CSS = ler('src', 'ui', 'obsidian.css');
const TABELAS = [
  ['campanhas', ler('src', 'meta', 'CampanhasPorObjetivo.tsx')],
  ['anúncios', ler('src', 'meta', 'AnunciosDaCampanha.tsx')],
] as const;

/** O corpo de uma regra, para conferir declaração e não só a existência. */
function regra(seletor: string): string {
  const i = CSS.indexOf(seletor);
  if (i < 0) return '';
  const abre = CSS.indexOf('{', i);
  return CSS.slice(abre + 1, CSS.indexOf('}', abre));
}

describe('o dado não quebra no meio', () => {
  it('a célula de dado é nowrap', () => {
    expect(regra('.o-tab-rola tbody td')).toMatch(/white-space:\s*nowrap/);
  });

  it('e desfaz a quebra em qualquer ponto que o cartão impõe', () => {
    // Sem isto, `.o-card { overflow-wrap: anywhere }` volta a valer aqui
    // dentro — foi ela que partiu "R$ 157,75".
    const corpo = regra('.o-tab-rola tbody td');
    expect(corpo).toMatch(/overflow-wrap:\s*normal/);
    expect(corpo).toMatch(/word-break:\s*normal/);
  });

  it('a regra do cartão continua existindo, porque ela protege outra coisa', () => {
    // Nome de cliente comprido estourando o cartão é um defeito de verdade.
    // A resposta certa foi limitar o alcance dela, não apagá-la.
    expect(CSS).toMatch(/\.o-card,\s*\.o-linha\s*\{\s*overflow-wrap:\s*anywhere/);
  });

  it('e a nossa vence por ser mais específica, não por vir depois', () => {
    // `.o-card` é (0,1,0); `.o-tab-rola tbody td` é (0,1,2). Se algum dia isto
    // depender da ordem no arquivo, uma reordenação inocente devolve o defeito.
    expect(regra('.o-tab-rola tbody td')).not.toBe('');
  });
});

describe('o cabeçalho quebra só entre palavras', () => {
  it('nunca no meio da palavra', () => {
    // "LEAD / S" foi o que apareceu na tela.
    const corpo = regra('.o-tab-rola thead th');
    expect(corpo).toMatch(/word-break:\s*normal/);
    expect(corpo).toMatch(/overflow-wrap:\s*normal/);
  });

  it('e tem piso de largura, para rótulo comprido não virar uma letra por linha', () => {
    expect(regra('.o-tab-rola thead th + th')).toMatch(/min-width/);
  });
});

describe('a largura vem do conteúdo, com o cartão como piso', () => {
  it('a tabela não é capada em 100%', () => {
    expect(regra('.o-tab-rola')).toMatch(/min-width:\s*100%/);
  });

  it.each(TABELAS)('a tabela de %s não usa w-full', (_nome, fonte) => {
    // `w-full` é `width: 100%`: teto, não piso. É ele que espreme.
    const tabelas = fonte.match(/<table[\s\S]*?>/g) ?? [];
    expect(tabelas.length).toBeGreaterThan(0);
    for (const t of tabelas) expect(t).not.toMatch(/\bw-full\b/);
  });

  it.each(TABELAS)('a tabela de %s pede o comportamento de rolar', (_nome, fonte) => {
    expect(fonte).toContain('o-tab-rola');
  });
});

describe('o quadro que rola', () => {
  it('rola nos dois eixos e tem teto de altura', () => {
    // Sem teto, o contêiner cresce com o conteúdo, nunca rola na vertical, e o
    // cabeçalho grudado não tem em que grudar.
    const corpo = regra('.o-tab-caixa');
    expect(corpo).toMatch(/overflow:\s*auto/);
    expect(corpo).toMatch(/max-height/);
  });

  it('e o cabeçalho fica grudado no topo dele', () => {
    const corpo = regra('.o-tab-rola thead th {\n  position');
    expect(corpo).toMatch(/position:\s*sticky/);
    expect(corpo).toMatch(/top:\s*0/);
    // Com border-collapse, a borda não viaja junto com a célula grudada.
    expect(corpo).toMatch(/box-shadow/);
  });
});

describe('o balão do seletor não fica dentro do quadro que corta', () => {
  it('o seletor de métricas dos anúncios vem antes do quadro', () => {
    // Caixa com `overflow` corta o que sai dela. Dentro, o menu que escolhe as
    // colunas apareceria cortado pela própria tabela que ele configura.
    const fonte = ler('src', 'meta', 'AnunciosDaCampanha.tsx');
    expect(fonte.indexOf('<SeletorDeMetricas')).toBeLessThan(fonte.indexOf('o-tab-caixa'));
  });

  it('e o cartão das campanhas não virou quadro com teto', () => {
    // O seletor das campanhas mora num cartão próprio acima da tabela; pôr
    // teto de altura no cartão da tabela cortaria o balão dele.
    expect(ler('src', 'meta', 'CampanhasPorObjetivo.tsx')).not.toMatch(
      /o-card[^"]*o-tab-caixa/,
    );
  });
});
