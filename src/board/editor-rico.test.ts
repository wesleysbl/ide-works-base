/**
 * O editor rico — a ida e a volta. F17.10b.
 *
 * O QUE ESTES TESTES GUARDAM
 *   Que o briefing sobreviva a abrir e salvar. Um editor rico que perde a
 *   tabela na segunda vez que a ficha abre é pior do que a caixa de markdown
 *   que ele substituiu — lá pelo menos o que se via era o que estava gravado.
 *
 *   Por isso o teste central é o PONTO FIXO: `ida e volta` aplicada duas vezes
 *   tem que dar o mesmo texto da primeira. Estabilidade, e não só reversão.
 */

import { describe, expect, it } from 'vitest';

import {
  type NoRico,
  blocosParaNos,
  elemento,
  escaparInicioDeBloco,
  escaparTexto,
  idaEVolta,
  markdownParaNos,
  nosParaMarkdown,
  texto,
} from '@/board/editor-rico';
import { parseMarkdown } from '@/board/markdown';

/* ───────────────────────────── ida e volta ───────────────────────────── */

const BRIEFINGS: Array<[string, string]> = [
  ['parágrafo simples', 'Roteiro aprovado pelo cliente.'],
  ['negrito e itálico', 'Entregar **hoje** e *sem falta*.'],
  ['riscado', 'Isto ~~era~~ virou outra coisa.'],
  ['título de cada nível', '# Um\n\n## Dois\n\n### Três\n\n#### Quatro\n\n##### Cinco\n\n###### Seis'],
  ['lista com marcador', '- captação\n- edição\n- capa'],
  ['lista numerada', '1. roteiro\n2. captação\n3. entrega'],
  ['caixas de seleção', '- [ ] gravar\n- [x] editar'],
  ['lista aninhada', '- entrega\n  - reels\n  - carrossel'],
  ['link', 'O arquivo está no [Dropbox](https://dropbox.com/x).'],
  ['código em linha', 'Rodar `npm run build` antes.'],
  ['bloco de código', '```sql\nselect 1;\n```'],
  ['citação', '> o cliente pediu mais cor'],
  ['regra horizontal', 'antes\n\n---\n\ndepois'],
  ['emoji', 'Aprovado 🔥 pelo cliente ✅'],
  [
    'tabela',
    '| Formato | Prazo |\n| --- | --- |\n| Reels | 24/08 |\n| Carrossel | 26/08 |',
  ],
  [
    'tabela alinhada',
    '| Formato | Prazo |\n| :--- | ---: |\n| Reels | 24/08 |',
  ],
  [
    'o briefing inteiro',
    [
      '# Oferta VIP 4',
      '',
      'Gravar **na loja**, com o [roteiro](https://dropbox.com/r.pdf) aprovado.',
      '',
      '## Entregáveis',
      '',
      '- [x] roteiro',
      '- [ ] captação',
      '- [ ] edição',
      '',
      '| Peça | Formato |',
      '| --- | --- |',
      '| 1 | Reels |',
      '',
      '> não usar a trilha do mês passado',
    ].join('\n'),
  ],
];

describe('a ida e a volta do briefing', () => {
  for (const [nome, fonte] of BRIEFINGS) {
    it(`preserva ${nome}`, () => {
      expect(idaEVolta(fonte)).toBe(fonte);
    });
  }

  it('é ponto fixo — aplicar duas vezes dá o mesmo', () => {
    for (const [, fonte] of BRIEFINGS) {
      const uma = idaEVolta(fonte);
      expect(idaEVolta(uma)).toBe(uma);
    }
  });

  it('preserva a ÁRVORE, e não só o texto', () => {
    for (const [, fonte] of BRIEFINGS) {
      expect(parseMarkdown(idaEVolta(fonte))).toEqual(parseMarkdown(fonte));
    }
  });

  it('texto vazio continua vazio — nunca vira `\\n`', () => {
    expect(idaEVolta('')).toBe('');
    expect(idaEVolta('   \n\n  ')).toBe('');
    expect(nosParaMarkdown([])).toBe('');
  });
});

/* ───────────────────────────── o que o navegador produz ───────────────────────────── */

describe('o que o `contenteditable` deixa no DOM', () => {
  it('LISTA DENTRO DE PARÁGRAFO continua sendo lista', () => {
    // Medido no Chrome, 2026-08-25: `insertUnorderedList` com o cursor num
    // parágrafo vazio produz `<p><ul><li>…</li></ul></p>`. É HTML inválido, o
    // navegador o mantém, e a primeira versão do serializador transformava a
    // lista inteira em texto corrido — as caixas de seleção sumiam.
    const nos: NoRico[] = [
      elemento('p', [
        elemento('ul', [
          elemento('li', [texto('gravar')], { caixa: false }),
          elemento('li', [texto('editar')], { caixa: true }),
        ]),
      ]),
    ];
    expect(nosParaMarkdown(nos)).toBe('- [ ] gravar\n- [x] editar');
  });

  it('atravessa `div` solto, que é o que o Enter cria em alguns navegadores', () => {
    const nos: NoRico[] = [
      elemento('div', [texto('primeira')]),
      elemento('div', [texto('segunda')]),
    ];
    expect(nosParaMarkdown(nos)).toBe('primeira\n\nsegunda');
  });

  it('trata `b`, `i` e `s` já normalizados como `strong`, `em` e `del`', () => {
    expect(nosParaMarkdown([elemento('p', [elemento('strong', [texto('x')])])])).toBe('**x**');
  });

  it('deixa passar o texto de etiqueta que não conhece, sem a etiqueta', () => {
    const nos = [elemento('p', [elemento('span', [texto('cor de fora')])])];
    expect(nosParaMarkdown(nos)).toBe('cor de fora');
  });

  it('sublinhado vira texto — markdown não tem sublinhado', () => {
    expect(nosParaMarkdown([elemento('p', [elemento('u', [texto('a')])])])).toBe('a');
  });

  it('`br` parte o parágrafo em dois, e não some', () => {
    const nos = [elemento('p', [texto('linha um'), elemento('br'), texto('linha dois')])];
    expect(nosParaMarkdown(nos)).toBe('linha um\n\nlinha dois');
  });

  it('parágrafo vazio NAS PONTAS não vira bloco', () => {
    expect(nosParaMarkdown([elemento('p'), elemento('p', [texto('x')]), elemento('p')])).toBe('x');
  });

  it('tabela sem linha nenhuma não vira tabela quebrada', () => {
    expect(nosParaMarkdown([elemento('table', [elemento('tbody')])])).toBe('');
  });
});

/* ───────────────────────────── a linha em branco ───────────────────────────── */

describe('a linha em branco que a pessoa deixou — 2026-09-17', () => {
  /**
   * O DEFEITO: *"eu separo com enter para deixar organizado, ele salva, mas
   * quando entro novamente na tarefa, esses espaços somem"*. O Enter a mais é
   * um `<p><br></p>` no editor, e o serializador jogava fora todo parágrafo
   * vazio. Estes testes guardam que ele agora vai para o banco e volta.
   */
  const p = (t: string) => elemento('p', [texto(t)]);
  const vazio = () => elemento('p', [elemento('br')]);

  it('o parágrafo vazio entre dois textos vira uma linha em branco a mais', () => {
    expect(nosParaMarkdown([p('a'), vazio(), p('b')])).toBe('a\n\n\nb');
  });

  it('dois Enters a mais, duas linhas a mais', () => {
    expect(nosParaMarkdown([p('a'), vazio(), vazio(), p('b')])).toBe('a\n\n\n\nb');
  });

  it('abrir e salvar devolve os mesmos espaços, e é ponto fixo', () => {
    for (const fonte of ['a\n\n\nb', 'a\n\n\n\nb', '# Título\n\n\ntexto', '- a\n\n\n- b']) {
      expect(idaEVolta(fonte)).toBe(fonte);
      expect(idaEVolta(idaEVolta(fonte))).toBe(fonte);
    }
  });

  it('o briefing do print volta com os espaços onde eles estavam', () => {
    const fonte = [
      '**CARROSSEL - 1080X1350**',
      '',
      '',
      '### CAPA.',
      '',
      'SEU E-COMMERCE AINDA FAZ TUDO MANUALMENTE?',
      '',
      '',
      'SLIDE 1',
      '',
      'ANTES DE AUTOMATIZAR... ORGANIZE.',
      '',
      '',
      'SLIDE 2',
    ].join('\n');
    expect(idaEVolta(fonte)).toBe(fonte);
  });

  it('o `br` do fim da linha é do navegador, e não uma linha a mais', () => {
    const nos = [elemento('p', [texto('a'), elemento('br')]), p('b')];
    expect(nosParaMarkdown(nos)).toBe('a\n\nb');
  });

  it('dois `br` seguidos no meio da linha deixam a linha vazia que se vê', () => {
    const nos = [elemento('p', [texto('a'), elemento('br'), elemento('br'), texto('b')])];
    expect(nosParaMarkdown(nos)).toBe('a\n\n\nb');
  });

  it('o vazio com negrito ligado também conta — o navegador guarda o `b` na linha vazia', () => {
    const nos = [p('a'), elemento('p', [elemento('strong', [elemento('br')])]), p('b')];
    expect(nosParaMarkdown(nos)).toBe('a\n\n\nb');
  });

  it('título vazio, que sobra do Enter no começo do título, é linha em branco', () => {
    expect(nosParaMarkdown([p('a'), elemento('h3', [elemento('br')]), elemento('h3', [texto('CAPA')])])).toBe(
      'a\n\n\n### CAPA',
    );
  });

  it('as linhas em branco de dentro do bloco de código não são espremidas', () => {
    const fonte = '```\nprimeira\n\n\n\nsegunda\n```';
    expect(idaEVolta(fonte)).toBe(fonte);
  });

  it('o texto colado com três quebras dentro de um parágrafo continua sendo só dois parágrafos', () => {
    expect(nosParaMarkdown([elemento('p', [texto('a\n\n\n\nb')])])).toBe('a\n\nb');
  });
});

/* ───────────────────────────── segurança ───────────────────────────── */

describe('o endereço do link é filtrado nos DOIS sentidos', () => {
  it('`javascript:` colado no editor vira texto ao salvar', () => {
    const nos = [
      elemento('p', [elemento('a', [texto('clique')], { href: 'javascript:alert(1)' })]),
    ];
    expect(nosParaMarkdown(nos)).toBe('clique');
  });

  it('endereço bom continua clicável', () => {
    const nos = [elemento('p', [elemento('a', [texto('doc')], { href: 'https://x.com/a' })])];
    expect(nosParaMarkdown(nos)).toBe('[doc](https://x.com/a)');
  });
});

/* ───────────────────────────── escape ───────────────────────────── */

describe('o escape do texto', () => {
  it('protege o que viraria marcação', () => {
    expect(escaparTexto('2 * 3 [x] `a`')).toBe('2 \\* 3 \\[x\\] \\`a\\`');
  });

  it('NÃO escapa sublinhado no meio da palavra', () => {
    expect(escaparTexto('nome_do_campo')).toBe('nome_do_campo');
    expect(escaparTexto('_isto_')).toBe('\\_isto\\_');
  });

  it('protege o começo de linha que viraria outro bloco', () => {
    expect(escaparInicioDeBloco('- não é lista')).toBe('\\- não é lista');
    expect(escaparInicioDeBloco('# não é título')).toBe('\\# não é título');
    expect(escaparInicioDeBloco('1. não é numerada')).toBe('\\1. não é numerada');
    expect(escaparInicioDeBloco('texto normal')).toBe('texto normal');
  });

  it('o texto escapado volta idêntico', () => {
    for (const cru of ['2 * 3', 'a_b_c', '# não é título', '- não é lista', 'a | b', '`x`']) {
      expect(idaEVolta(nosParaMarkdown([elemento('p', [texto(cru)])]))).toBe(
        nosParaMarkdown([elemento('p', [texto(cru)])]),
      );
      // E o que se lê de volta é o texto original, sem as barras.
      const arvore = parseMarkdown(nosParaMarkdown([elemento('p', [texto(cru)])]));
      expect(arvore).toHaveLength(1);
    }
  });
});

/* ───────────────────────────── rehidratação ───────────────────────────── */

describe('markdown vira nós que o editor sabe desenhar', () => {
  it('a caixa de seleção vira `li` com a marca, e não texto', () => {
    const nos = markdownParaNos('- [x] feito');
    const lista = nos[0];
    expect(lista.tipo === 'elemento' && lista.tag).toBe('ul');
    const item = lista.tipo === 'elemento' ? lista.filhos[0] : null;
    expect(item?.tipo === 'elemento' && item.caixa).toBe(true);
  });

  it('a tabela vira `thead` e `tbody`, com o alinhamento guardado', () => {
    const nos = markdownParaNos('| a | b |\n| :---: | ---: |\n| 1 | 2 |');
    const tabela = nos[0];
    expect(tabela.tipo === 'elemento' && tabela.tag).toBe('table');
    const cabecalho =
      tabela.tipo === 'elemento' && tabela.filhos[0].tipo === 'elemento'
        ? tabela.filhos[0].filhos[0]
        : null;
    const th = cabecalho?.tipo === 'elemento' ? cabecalho.filhos[0] : null;
    expect(th?.tipo === 'elemento' && th.alinhamento).toBe('center');
  });

  it('blocos vazios não viram nós fantasma', () => {
    expect(blocosParaNos(parseMarkdown(''))).toEqual([]);
  });
});
