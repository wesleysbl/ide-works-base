/**
 * A ida e a volta pelo DOM — F17.10b.
 *
 * POR QUE ESTE TESTE EXISTE
 *   `editor-rico.test.ts` prova o serializador PURO: markdown → árvore →
 *   markdown. Falta a outra metade, que é a que o navegador executa: árvore →
 *   DOM → árvore. Sem ela, o briefing estaria testado até a porta do editor e
 *   não dentro dele.
 *
 * O DOCUMENTO DE MENTIRA, E POR QUE ELE BASTA
 *   `editor-dom.ts` encosta no DOM por seis chamadas: `createElement`,
 *   `createTextNode`, `appendChild`, `removeChild`, `setAttribute` e
 *   `getAttribute`. Um documento de sessenta linhas as implementa por inteiro —
 *   e um documento nosso tem uma vantagem sobre um navegador de mentira de
 *   biblioteca: ele **não conserta nada em silêncio**. `jsdom` normaliza HTML
 *   inválido, e essa gentileza esconderia exatamente o defeito que se procura.
 *
 * O QUE ELE NÃO PROVA
 *   Nada do que depende de seleção, cursor ou `execCommand` — isso é navegador
 *   de verdade e vai na conferência do usuário. Aqui se prova o que carrega e o
 *   que salva.
 */

import { describe, expect, it } from 'vitest';

import { criarNo, lerNos, preencher } from '@/board/editor-dom';
import { elemento, markdownParaNos, nosParaMarkdown, texto } from '@/board/editor-rico';

/* ───────────────────────────── o documento de mentira ───────────────────────────── */

type NoFalso = {
  nodeType: number;
  nodeValue: string | null;
  tagName: string;
  childNodes: NoFalso[] & { forEach: (f: (n: NoFalso) => void) => void };
  firstChild: NoFalso | null;
  atributos: Map<string, string>;
  textContent: string;
  appendChild: (n: NoFalso) => NoFalso;
  removeChild: (n: NoFalso) => NoFalso;
  setAttribute: (k: string, v: string) => void;
  getAttribute: (k: string) => string | null;
};

function elementoFalso(tag: string): NoFalso {
  const filhos: NoFalso[] = [];
  const atributos = new Map<string, string>();
  const no: NoFalso = {
    nodeType: 1,
    nodeValue: null,
    tagName: tag.toUpperCase(),
    childNodes: filhos as NoFalso['childNodes'],
    get firstChild() {
      return filhos[0] ?? null;
    },
    atributos,
    set textContent(v: string) {
      filhos.length = 0;
      if (v !== '') filhos.push(textoFalso(v));
    },
    get textContent() {
      return filhos.map((f) => (f.nodeType === 3 ? (f.nodeValue ?? '') : f.textContent)).join('');
    },
    appendChild: (f) => {
      filhos.push(f);
      return f;
    },
    removeChild: (f) => {
      const i = filhos.indexOf(f);
      if (i >= 0) filhos.splice(i, 1);
      return f;
    },
    setAttribute: (k, v) => void atributos.set(k, v),
    getAttribute: (k) => atributos.get(k) ?? null,
  };
  return no;
}

function textoFalso(t: string): NoFalso {
  return {
    ...elementoFalso('#text'),
    nodeType: 3,
    nodeValue: t,
    tagName: '#text',
  };
}

const documentoFalso = {
  createElement: (tag: string) => elementoFalso(tag),
  createTextNode: (t: string) => textoFalso(t),
} as unknown as Document;

/** markdown → nós → DOM → nós → markdown. O caminho inteiro do briefing. */
function pelaTela(fonte: string): string {
  const raiz = elementoFalso('div');
  preencher(raiz as unknown as HTMLElement, markdownParaNos(fonte), documentoFalso);
  return nosParaMarkdown(lerNos(raiz as unknown as Node));
}

/* ───────────────────────────── as provas ───────────────────────────── */

const BRIEFINGS: Array<[string, string]> = [
  ['parágrafo', 'Roteiro aprovado pelo cliente.'],
  ['negrito e itálico', 'Entregar **hoje** e *sem falta*.'],
  ['título', '# Oferta VIP 4'],
  ['lista', '- captação\n- edição'],
  ['lista numerada', '1. roteiro\n2. captação'],
  ['caixas', '- [ ] gravar\n- [x] editar'],
  ['aninhada', '- entrega\n  - reels\n  - carrossel'],
  ['link', 'Está no [Dropbox](https://dropbox.com/x).'],
  ['código', 'Rodar `npm run build` antes.'],
  ['bloco de código', '```sql\nselect 1;\n```'],
  ['citação', '> o cliente pediu mais cor'],
  ['regra', 'antes\n\n---\n\ndepois'],
  ['emoji', 'Aprovado 🔥'],
  ['tabela', '| Formato | Prazo |\n| --- | --- |\n| Reels | 24/08 |'],
  ['tabela alinhada', '| a | b |\n| :---: | ---: |\n| 1 | 2 |'],
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
      '',
      '| Peça | Formato |',
      '| --- | --- |',
      '| 1 | Reels |',
      '',
      '> não usar a trilha do mês passado',
    ].join('\n'),
  ],
];

describe('o briefing atravessa o DOM e volta igual', () => {
  for (const [nome, fonte] of BRIEFINGS) {
    it(`preserva ${nome}`, () => {
      expect(pelaTela(fonte)).toBe(fonte);
    });
  }

  it('é ponto fixo — abrir e salvar duas vezes não muda mais nada', () => {
    for (const [, fonte] of BRIEFINGS) {
      const uma = pelaTela(fonte);
      expect(pelaTela(uma)).toBe(uma);
    }
  });

  it('a linha em branco que a pessoa deixou atravessa o DOM e volta — 2026-09-17', () => {
    // O parágrafo vazio nasce com `<br>` para o cursor ter onde ficar, e é esse
    // `<br>` que `lerNos` devolve. Ele precisa voltar como linha em branco, e
    // não sumir — era o defeito.
    for (const fonte of ['CARROSSEL\n\n\nCAPA', 'a\n\n\n\nb', '# Oferta\n\n\n- item']) {
      expect(pelaTela(fonte)).toBe(fonte);
      expect(pelaTela(pelaTela(fonte))).toBe(fonte);
    }
  });

  it('descrição vazia continua vazia depois de abrir o editor', () => {
    // `preencher` põe um parágrafo com `<br>` para o cursor ter onde ficar. Ele
    // NÃO pode virar texto no banco — senão toda tarefa sem briefing passaria a
    // ter um briefing de uma linha em branco.
    expect(pelaTela('')).toBe('');
  });
});

describe('a caixa de seleção', () => {
  it('nasce com a marca e com o atributo, e a marca não vira texto', () => {
    const raiz = elementoFalso('div');
    preencher(raiz as unknown as HTMLElement, markdownParaNos('- [x] feito'), documentoFalso);

    const li = raiz.childNodes[0].childNodes[0];
    expect(li.tagName).toBe('LI');
    expect(li.getAttribute('data-caixa')).toBe('1');

    const marca = li.childNodes[0];
    expect(marca.getAttribute('class')).toBe('cu-caixa');
    expect(marca.getAttribute('contenteditable')).toBe('false');
    expect(marca.textContent).toBe('✓');

    // E o `✓` NÃO aparece no markdown: quem guarda o estado é o atributo.
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe('- [x] feito');
  });

  it('desmarcar a marca desmarca o markdown', () => {
    const raiz = elementoFalso('div');
    preencher(raiz as unknown as HTMLElement, markdownParaNos('- [x] feito'), documentoFalso);
    const li = raiz.childNodes[0].childNodes[0];
    li.setAttribute('data-caixa', '0');
    li.childNodes[0].setAttribute('data-caixa', '0');
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe('- [ ] feito');
  });
});

describe('a lista branca de etiquetas', () => {
  it('etiqueta desconhecida vira `span`, e o texto sobrevive', () => {
    const raiz = elementoFalso('div');
    raiz.appendChild(
      criarNo(elemento('p', [elemento('script', [texto('roubar()')])]), documentoFalso) as unknown as NoFalso,
    );
    expect(raiz.childNodes[0].childNodes[0].tagName).toBe('SPAN');
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe('roubar()');
  });

  it('`javascript:` nunca chega a virar `href`', () => {
    const raiz = elementoFalso('div');
    raiz.appendChild(
      criarNo(
        elemento('p', [elemento('a', [texto('clique')], { href: 'javascript:alert(1)' })]),
        documentoFalso,
      ) as unknown as NoFalso,
    );
    const a = raiz.childNodes[0].childNodes[0];
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBeNull();
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe('clique');
  });

  it('link bom leva `noopener noreferrer` — o Dropbox não precisa saber de onde viemos', () => {
    const raiz = elementoFalso('div');
    raiz.appendChild(
      criarNo(
        elemento('p', [elemento('a', [texto('doc')], { href: 'https://x.com/a' })]),
        documentoFalso,
      ) as unknown as NoFalso,
    );
    const a = raiz.childNodes[0].childNodes[0];
    expect(a.getAttribute('href')).toBe('https://x.com/a');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('o que o navegador deixa no meio do caminho', () => {
  it('`b`, `i` e `s` viram `strong`, `em` e `del`', () => {
    const raiz = elementoFalso('div');
    const p = elementoFalso('p');
    const b = elementoFalso('b');
    b.appendChild(textoFalso('forte'));
    p.appendChild(b);
    const i = elementoFalso('i');
    i.appendChild(textoFalso('torto'));
    p.appendChild(i);
    raiz.appendChild(p);
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe('**forte***torto*');
  });

  it('o `&nbsp;` que o navegador insere vira espaço comum', () => {
    const raiz = elementoFalso('div');
    const p = elementoFalso('p');
    p.appendChild(textoFalso('a\u00a0b'));
    raiz.appendChild(p);
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe('a b');
  });

  it('`div` solto — o que o Enter cria em alguns navegadores — vira parágrafo', () => {
    const raiz = elementoFalso('div');
    for (const t of ['primeira', 'segunda']) {
      const d = elementoFalso('div');
      d.appendChild(textoFalso(t));
      raiz.appendChild(d);
    }
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe('primeira\n\nsegunda');
  });

  it('trocar o conteúdo do editor não deixa resto do anterior', () => {
    const raiz = elementoFalso('div');
    preencher(raiz as unknown as HTMLElement, markdownParaNos('# antigo'), documentoFalso);
    preencher(raiz as unknown as HTMLElement, markdownParaNos('# novo'), documentoFalso);
    expect(raiz.childNodes).toHaveLength(1);
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe('# novo');
  });
});

describe('imagem privada no editor', () => {
  it('preserva a posição e o identificador, sem salvar a URL temporária de leitura', () => {
    const id = '12345678-1234-1234-1234-123456789abc';
    const md = `Antes ![Imagem anexada](attachment:${id}) depois`;
    const raiz = elementoFalso('div');
    preencher(raiz as unknown as HTMLElement, markdownParaNos(md), documentoFalso);
    const img = raiz.childNodes[0].childNodes.find((n) => n.tagName === 'IMG');
    expect(img).toBeDefined();
    img!.setAttribute('src', 'https://storage.invalid/assinada?token=segredo-de-teste');
    expect(nosParaMarkdown(lerNos(raiz as unknown as Node))).toBe(md);
  });
});
