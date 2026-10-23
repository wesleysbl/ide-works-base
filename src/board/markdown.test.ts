/**
 * O markdown do briefing — F17.10.
 *
 * O QUE ESTE TESTE COBRE, E POR QUE ESSES CASOS
 *   A lista não é a do CommonMark inteiro: é a do que as tarefas REAIS usam,
 *   medida no plano — títulos, tabelas, listas, caixas `- [ ]`, links, negrito,
 *   emoji e regra horizontal.
 *
 *   E mais um bloco que nada tem a ver com desenho: o FILTRO DE ENDEREÇO. Ele é
 *   a única superfície de segurança desta etapa, porque é a única coisa da
 *   descrição de uma tarefa que vira um clique.
 */

import { describe, expect, it } from 'vitest';

import {
  type Block,
  type Inline,
  enderecoSeguro,
  parseInline,
  parseMarkdown,
  resumirMarkdown,
} from '@/board/markdown';

/** O texto puro de uma sequência de nós, para conferir sem depender da forma. */
function texto(nos: readonly Inline[]): string {
  return nos
    .map((n) => {
      if (n.kind === 'text') return n.text;
      if (n.kind === 'code') return n.text;
      return texto((n as { children: Inline[] }).children);
    })
    .join('');
}

const tipos = (bs: readonly Block[]) => bs.map((b) => b.kind);

describe('endereço que pode virar clique', () => {
  it('aceita o que a equipe realmente usa', () => {
    expect(enderecoSeguro('https://www.dropbox.com/s/abc')).toBe('https://www.dropbox.com/s/abc');
    expect(enderecoSeguro('http://exemplo.com')).toBe('http://exemplo.com');
    expect(enderecoSeguro('mailto:alguem@ide.com')).toBe('mailto:alguem@ide.com');
    expect(enderecoSeguro('/quadro/abc')).toBe('/quadro/abc');
    expect(enderecoSeguro('#secao')).toBe('#secao');
    expect(enderecoSeguro('pasta/arquivo.pdf')).toBe('pasta/arquivo.pdf');
  });

  it('RECUSA o que executa código', () => {
    expect(enderecoSeguro('javascript:alert(1)')).toBeNull();
    expect(enderecoSeguro('JaVaScRiPt:alert(1)')).toBeNull();
    expect(enderecoSeguro('data:text/html,<script>x</script>')).toBeNull();
    expect(enderecoSeguro('vbscript:msgbox')).toBeNull();
  });

  it('RECUSA o esquema partido por espaço em branco — o truque clássico', () => {
    // `java\nscript:` passa por qualquer filtro que olhe só o começo da string.
    expect(enderecoSeguro('java\nscript:alert(1)')).toBeNull();
    expect(enderecoSeguro('java\tscript:alert(1)')).toBeNull();
    expect(enderecoSeguro(' javascript:alert(1)')).toBeNull();
  });

  it('RECUSA o endereço que herda o esquema da página', () => {
    // Parece caminho relativo e não é: `//outro.site` sai do IDE Works.
    expect(enderecoSeguro('//outro.site/x')).toBeNull();
  });

  it('o link recusado vira TEXTO, e o rótulo sobrevive', () => {
    const nos = parseInline('[clique aqui](javascript:alert(1))');
    expect(nos.some((n) => n.kind === 'link')).toBe(false);
    expect(texto(nos)).toContain('clique aqui');
  });
});

describe('o que fica dentro da linha', () => {
  it('negrito, itálico, riscado e código', () => {
    expect(parseInline('**forte**')[0].kind).toBe('strong');
    expect(parseInline('*leve*')[0].kind).toBe('em');
    expect(parseInline('~~fora~~')[0].kind).toBe('del');
    expect(parseInline('`x = 1`')[0]).toEqual({ kind: 'code', text: 'x = 1' });
  });

  it('`**` ganha de `*` — senão o negrito viraria dois itálicos vazios', () => {
    const nos = parseInline('**duplo**');
    expect(nos).toHaveLength(1);
    expect(nos[0].kind).toBe('strong');
    expect(texto(nos)).toBe('duplo');
  });

  it('multiplicação não vira itálico', () => {
    // A regra de flanqueamento: marca colada em espaço não abre.
    expect(parseInline('2 * 3 * 4').every((n) => n.kind === 'text')).toBe(true);
  });

  it('`_` no meio de palavra não vira itálico — `custom_item_id` é nome de coluna', () => {
    expect(texto(parseInline('custom_item_id'))).toBe('custom_item_id');
    expect(parseInline('custom_item_id').every((n) => n.kind === 'text')).toBe(true);
  });

  it('link com rótulo, e link solto no meio da frase', () => {
    const comRotulo = parseInline('veja o [roteiro](https://dropbox.com/r.pdf) hoje');
    const elo = comRotulo.find((n) => n.kind === 'link');
    expect(elo).toBeDefined();
    expect(elo && elo.kind === 'link' && elo.href).toBe('https://dropbox.com/r.pdf');

    // As tarefas reais colam o endereço do Dropbox sem colchete nenhum.
    const solto = parseInline('material em https://dropbox.com/s/abc, confere');
    const elo2 = solto.find((n) => n.kind === 'link');
    expect(elo2 && elo2.kind === 'link' && elo2.href).toBe('https://dropbox.com/s/abc');
  });

  it('emoji atravessa sem transformação nenhuma', () => {
    expect(texto(parseInline('prazo 🔥 apertado'))).toBe('prazo 🔥 apertado');
  });

  it('a barra invertida entrega o próximo caractere como texto', () => {
    expect(texto(parseInline('\\*não é itálico\\*'))).toBe('*não é itálico*');
  });
});

describe('o que fica entre as linhas', () => {
  it('título de um a seis', () => {
    const bs = parseMarkdown('# um\n## dois\n###### seis');
    expect(tipos(bs)).toEqual(['heading', 'heading', 'heading']);
    expect(bs.map((b) => (b.kind === 'heading' ? b.level : 0))).toEqual([1, 2, 6]);
  });

  it('regra horizontal', () => {
    expect(tipos(parseMarkdown('a\n\n---\n\nb'))).toEqual(['paragraph', 'rule', 'paragraph']);
  });

  it('lista simples, e lista numerada', () => {
    const bs = parseMarkdown('- um\n- dois\n\n1. a\n2. b');
    expect(tipos(bs)).toEqual(['list', 'list']);
    expect(bs[0].kind === 'list' && bs[0].ordered).toBe(false);
    expect(bs[1].kind === 'list' && bs[1].ordered).toBe(true);
    expect(bs[0].kind === 'list' && bs[0].items).toHaveLength(2);
  });

  it('caixa marcada e caixa vazia', () => {
    const bs = parseMarkdown('- [ ] fazer\n- [x] feito\n- [X] feito também');
    const itens = bs[0].kind === 'list' ? bs[0].items : [];
    expect(itens.map((i) => i.checked)).toEqual([false, true, true]);
    // O `- [ ]` sai do texto: ele virou estado, não pode aparecer duas vezes.
    expect(texto(itens[0].content)).toBe('fazer');
  });

  it('lista dentro de lista, pela indentação', () => {
    const bs = parseMarkdown('- mãe\n  - filha\n  - outra\n- tia');
    const itens = bs[0].kind === 'list' ? bs[0].items : [];
    expect(itens).toHaveLength(2);
    expect(itens[0].children).toHaveLength(2);
    expect(texto(itens[0].children[0].content)).toBe('filha');
  });

  it('tabela com alinhamento — o bloco que mais quebra no briefing real', () => {
    const bs = parseMarkdown(
      '| Data | Formato | Valor |\n| :--- | :---: | ---: |\n| 24/08 | Reels | 10 |\n| 25/08 | Estático | 20 |',
    );
    expect(tipos(bs)).toEqual(['table']);
    const t = bs[0];
    if (t.kind !== 'table') throw new Error('não é tabela');
    expect(t.header.map(texto)).toEqual(['Data', 'Formato', 'Valor']);
    expect(t.align).toEqual(['left', 'center', 'right']);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1].map(texto)).toEqual(['25/08', 'Estático', '20']);
  });

  it('frase com barra vertical NÃO vira tabela sem a linha de traços', () => {
    expect(tipos(parseMarkdown('entrega | segunda ou terça'))).toEqual(['paragraph']);
  });

  it('linha de tabela mais curta é completada, e a tabela sobrevive', () => {
    // Tabela real vem torta. Recusar a tabela inteira esconderia o resto dela.
    const bs = parseMarkdown('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |');
    const t = bs[0];
    if (t.kind !== 'table') throw new Error('não é tabela');
    expect(t.rows[0]).toHaveLength(3);
    expect(texto(t.rows[0][2])).toBe('');
  });

  it('bloco de código não é interpretado por dentro', () => {
    const bs = parseMarkdown('```sql\nselect * from x -- **não é negrito**\n```');
    expect(tipos(bs)).toEqual(['code']);
    expect(bs[0].kind === 'code' && bs[0].lang).toBe('sql');
    expect(bs[0].kind === 'code' && bs[0].text).toContain('**não é negrito**');
  });

  it('citação', () => {
    const bs = parseMarkdown('> palavra do cliente\n> na segunda linha');
    expect(tipos(bs)).toEqual(['quote']);
  });

  it('quebra simples junta o parágrafo — briefing colado de outro editor', () => {
    const bs = parseMarkdown('primeira linha\nsegunda linha');
    expect(tipos(bs)).toEqual(['paragraph']);
    expect(bs[0].kind === 'paragraph' && texto(bs[0].content)).toBe('primeira linha segunda linha');
  });

  it('cada linha em branco ALÉM da primeira vira um parágrafo vazio', () => {
    // O "Enter a mais" que a pessoa dá para arejar o briefing. Antes era jogado
    // fora, e a tarefa reabria com o texto espremido.
    // Duas linhas em branco (`\n\n\n`) = um vazio; três (`\n\n\n\n`) = dois.
    const bs = parseMarkdown('CARROSSEL\n\n\nCAPA\n\n\n\nSLIDE 1');
    expect(bs.map((b) => (b.kind === 'paragraph' ? texto(b.content) : '?'))).toEqual([
      'CARROSSEL',
      '',
      'CAPA',
      '',
      '',
      'SLIDE 1',
    ]);
  });

  it('uma linha em branco só separa, e não cria parágrafo vazio', () => {
    expect(tipos(parseMarkdown('a\n\nb'))).toEqual(['paragraph', 'paragraph']);
  });

  it('linha em branco nas pontas do texto não vira parágrafo vazio', () => {
    expect(tipos(parseMarkdown('\n\n\n\na\n\n\n\n'))).toEqual(['paragraph']);
  });

  it('a linha em branco a mais vale depois de lista, e não junta as duas listas', () => {
    const bs = parseMarkdown('- a\n\n\n- b');
    expect(tipos(bs)).toEqual(['list', 'paragraph', 'list']);
  });

  it('dentro da citação a linha em branco continua sendo só separação', () => {
    const bs = parseMarkdown('> a\n>\n>\n> b');
    expect(tipos(bs)).toEqual(['quote']);
    expect(bs[0].kind === 'quote' && tipos(bs[0].blocks)).toEqual(['paragraph', 'paragraph']);
  });

  it('`\\r\\n` e tabulação são normalizados na entrada', () => {
    // O briefing chega colado do ClickUp, do Word e do Google Docs.
    expect(tipos(parseMarkdown('# a\r\n\r\n- b'))).toEqual(['heading', 'list']);
  });

  it('HTML embutido vira TEXTO, e isso é a decisão de segurança', () => {
    const bs = parseMarkdown('<script>roubar()</script>');
    expect(tipos(bs)).toEqual(['paragraph']);
    expect(bs[0].kind === 'paragraph' && texto(bs[0].content)).toContain('<script>');
  });
});

describe('o briefing inteiro, como as tarefas reais o escrevem', () => {
  const BRIEFING = [
    '# [A] JATOBÁ — NÚMERO ALTO DE INVESTIDORES',
    '',
    '**Data:** 24/08 · **Formato:** [Reels]',
    '',
    '## Objetivo',
    'Aumentar a procura por lotes, com foco em investidor. 🔥',
    '',
    '| Peça | Prazo | Responsável |',
    '| --- | --- | --- |',
    '| Roteiro | 20/08 | Time |',
    '| Captação | 22/08 | Estúdio |',
    '',
    '## Checklist',
    '- [x] roteiro aprovado',
    '- [ ] captação agendada',
    '- [ ] arte de capa',
    '',
    '---',
    '',
    'Material em https://dropbox.com/s/jatoba',
  ].join('\n');

  it('os blocos saem na ordem, e nenhum se perde', () => {
    expect(tipos(parseMarkdown(BRIEFING))).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
      'table',
      'heading',
      'list',
      'rule',
      'paragraph',
    ]);
  });

  it('o resumo conta o que a tela mostra embaixo do editor', () => {
    const r = resumirMarkdown(parseMarkdown(BRIEFING));
    expect(r.vazio).toBe(false);
    expect(r.tabelas).toBe(1);
    expect(r.caixas).toBe(3);
    expect(r.caixasMarcadas).toBe(1);
  });

  it('texto vazio é vazio, e a tela sabe disso sem adivinhar', () => {
    expect(resumirMarkdown(parseMarkdown('')).vazio).toBe(true);
    expect(resumirMarkdown(parseMarkdown('   \n\n  ')).vazio).toBe(true);
  });
});
