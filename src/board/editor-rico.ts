/**
 * O editor rico do briefing — a camada PURA. Etapa F17.10b.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O ERRO QUE ESTE ARQUIVO CONSERTA
 *
 *   A F17.10 pôs uma caixa de markdown na tela. O usuário abriu e disse:
 *   *"Texto em markdown? Horrível."*
 *
 *   Ele tem razão, e o erro tem nome: markdown foi tratado como INTERFACE. No
 *   ClickUp ele é FORMATO DE ARMAZENAMENTO — a tela é editor rico e a API
 *   devolve markdown. Quem escreve vê negrito em negrito e tabela em grade;
 *   markdown é o que vai para o banco.
 *
 *   Então o caminho se inverte:
 *
 *     abrir   → markdown → `parseMarkdown` → árvore → NÓS → DOM editável
 *     salvar  → DOM → NÓS → markdown → banco
 *
 *   `tasks.description` continua sendo markdown. O modelo não muda, e os
 *   briefings reais continuam legíveis por quem os lê por fora.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POR QUE UMA ÁRVORE NEUTRA NO MEIO, E NÃO O DOM DIRETO
 *   Duas razões, e as duas se pagam.
 *
 *   1. **A suíte roda em `node`, sem DOM.** `vitest.config.ts` diz
 *      `environment: 'node'`. Um serializador escrito contra `HTMLElement` não
 *      teria teste nenhum — e serializador sem teste é onde o briefing de
 *      alguém some. Aqui o serializador é função pura sobre `NoRico[]`, e o que
 *      encosta no DOM são vinte linhas de adaptador em `EditorRico.tsx`.
 *
 *   2. **A garantia de segurança continua de pé.** O DOM editável é montado
 *      com `createElement`/`createTextNode` a partir desta árvore permitida e
 *      lido com `nodeName`/`textContent`. HTML externo é analisado num documento
 *      inerte em `colar-formatado.ts`; apenas os nós normalizados e os
 *      atributos permitidos chegam ao editor.
 *
 * O QUE SE PERDE NA IDA E VOLTA, DECLARADO
 *   - **Sublinhado** não existe em markdown. `<u>` vira texto sem sublinhado.
 *     Por isso o editor não oferece o botão: ver a regra de "nada de botão
 *     morto".
 *   - **Quebra simples** (`Shift+Enter`) vira PARÁGRAFO. O analisador do
 *     briefing junta linhas de um mesmo parágrafo com espaço — que é o certo
 *     para markdown — então guardar a quebra como quebra a perderia na volta.
 *     Virar parágrafo preserva o que a pessoa viu.
 *   - **Cor e tamanho de fonte** colados de fora somem. Markdown não os tem, e
 *     o OBSIDIAN não aceitaria cor literal vinda de um briefing.
 */

import { ATTACHMENT_ID, imagemNoTexto } from '@/board/imagens-no-texto';
import { mencao, UUID_MENCAO } from '@/board/mencoes';
import { type Align, type Block, type Inline, type ListItem, enderecoSeguro, parseMarkdown } from '@/board/markdown';

/* ───────────────────────────── a árvore neutra ───────────────────────────── */

/**
 * Um nó do editor.
 *
 * `tag` é sempre minúscula e sempre da lista branca — o adaptador do DOM
 * normaliza `B`→`strong`, `I`→`em`, `S`→`del`, e joga fora o que não conhece
 * (mantendo os filhos, para o texto nunca sumir).
 */
export type NoRico =
  | { tipo: 'texto'; texto: string }
  | {
      tipo: 'elemento';
      tag: string;
      filhos: NoRico[];
      /** Só em `a`. Já filtrado por `enderecoSeguro` na entrada e na saída. */
      attachmentId?: string;
      mentionId?: string;
      mentionName?: string;
      alt?: string;
      href?: string;
      /** Só em `li`: `undefined` = item comum; `false`/`true` = `- [ ]`/`- [x]`. */
      caixa?: boolean;
      /** Só em `th`/`td`. */
      alinhamento?: Align;
      /** Só em `pre`. */
      lingua?: string | null;
    };

export const elemento = (
  tag: string,
  filhos: NoRico[] = [],
  extra: Omit<Extract<NoRico, { tipo: 'elemento' }>, 'tipo' | 'tag' | 'filhos'> = {},
): NoRico => ({ tipo: 'elemento', tag, filhos, ...extra });

export const texto = (t: string): NoRico => ({ tipo: 'texto', texto: t });

/** As etiquetas que o editor sabe escrever e ler. Nada fora daqui vira DOM. */
export const TAGS_DE_BLOCO = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);

export const TAGS_DE_LINHA = new Set(['strong', 'em', 'del', 'code', 'a', 'br', 'img']);

export const TAGS_CONHECIDAS = new Set([...TAGS_DE_BLOCO, ...TAGS_DE_LINHA]);

const ehElemento = (n: NoRico): n is Extract<NoRico, { tipo: 'elemento' }> => n.tipo === 'elemento';

const ehBloco = (n: NoRico): boolean => ehElemento(n) && TAGS_DE_BLOCO.has(n.tag);

const filhosDeTag = (n: Extract<NoRico, { tipo: 'elemento' }>, tags: string[]): NoRico[] =>
  n.filhos.filter((f) => ehElemento(f) && tags.includes(f.tag));

/* ───────────────────────────── escape ───────────────────────────── */

const LETRA_OU_NUMERO = /[\p{L}\p{N}]/u;

/**
 * O texto que vai para o markdown sem virar marcação por acidente.
 *
 * `_` só escapa em borda de palavra, que é exatamente a regra que
 * `parseInline` usa para decidir se ele delimita — sem isso, `nome_do_campo`
 * sairia do editor como `nome\_do\_campo` e poluiria todo briefing técnico.
 */
export function escaparTexto(t: string): string {
  let saida = '';
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (c === '\\' || c === '`' || c === '*' || c === '[' || c === ']') {
      saida += `\\${c}`;
      continue;
    }
    if (c === '_') {
      const antes = t[i - 1];
      const depois = t[i + 1];
      const borda =
        antes === undefined ||
        depois === undefined ||
        !LETRA_OU_NUMERO.test(antes) ||
        !LETRA_OU_NUMERO.test(depois);
      saida += borda ? '\\_' : '_';
      continue;
    }
    saida += c;
  }
  return saida;
}

/**
 * O começo de linha que viraria outro bloco.
 *
 * Um parágrafo que comece com `- ` vira item de lista na volta; um que comece
 * com `# ` vira título. Escapar o primeiro caractere é o que faz o texto voltar
 * como ele foi escrito.
 *
 * ⚠️ `*` NÃO ENTRA AQUI, e a primeira versão errou nisso: ela transformava um
 * parágrafo que começa em **negrito** — `**hoje** é o prazo` — em
 * `\**hoje** é o prazo`, e o negrito sumia na volta. Asterisco de TEXTO já sai
 * escapado de `escaparTexto`; o que chega aqui como `*` é marcação nossa.
 *
 * Pela mesma razão a exigência de espaço depois do traço e do número é literal:
 * `- ` abre lista, `-abraço` não.
 */
const COMECO_DE_BLOCO = /^\s*(?:[-+]\s|-{3,}\s*$|#{1,6}\s|>|\d{1,9}[.)]\s|\|)/;

export function escaparInicioDeBloco(linha: string): string {
  if (COMECO_DE_BLOCO.test(linha)) {
    const i = linha.search(/\S/);
    return `${linha.slice(0, i)}\\${linha.slice(i)}`;
  }
  return linha;
}

/* ───────────────────────────── nós → markdown ───────────────────────────── */

/** O texto cru de uma subárvore — usado pelo bloco de código, onde nada é marcação. */
function textoCru(nos: readonly NoRico[]): string {
  return nos
    .map((n) => {
      if (n.tipo === 'texto') return n.texto;
      if (n.tag === 'br') return '\n';
      const dentro = textoCru(n.filhos);
      return TAGS_DE_BLOCO.has(n.tag) && n.tag !== 'code' ? `${dentro}\n` : dentro;
    })
    .join('')
    .replace(/\n+$/, '');
}

/** A cerca de crase do tamanho que couber — `` `a` `` cabe dentro de ``` ``…`` ```. */
function codigoEmLinha(t: string): string {
  const maior = [...t.matchAll(/`+/g)].reduce((m, x) => Math.max(m, x[0].length), 0);
  const cerca = '`'.repeat(maior + 1);
  const folga = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
  return `${cerca}${folga}${t}${folga}${cerca}`;
}

export function nosParaMarkdownEmLinha(nos: readonly NoRico[]): string {
  let saida = '';
  for (const n of nos) {
    if (n.tipo === 'texto') {
      saida += escaparTexto(n.texto);
      continue;
    }
    if (n.mentionId && UUID_MENCAO.test(n.mentionId)) {
      saida += mencao({ id: n.mentionId, name: n.mentionName ?? '' }); continue;
    }
    const dentro = nosParaMarkdownEmLinha(n.filhos);
    switch (n.tag) {
      case 'img':
        if (n.attachmentId && ATTACHMENT_ID.test(n.attachmentId)) saida += imagemNoTexto(n.attachmentId);
        break;
      case 'strong':
        saida += dentro.trim() === '' ? dentro : `**${dentro}**`;
        break;
      case 'em':
        saida += dentro.trim() === '' ? dentro : `*${dentro}*`;
        break;
      case 'del':
        saida += dentro.trim() === '' ? dentro : `~~${dentro}~~`;
        break;
      case 'code':
        saida += codigoEmLinha(textoCru(n.filhos));
        break;
      case 'a': {
        const alvo = n.href === undefined ? null : enderecoSeguro(n.href);
        // Endereço recusado vira texto: some o clique, fica a informação. É a
        // mesma decisão de `markdown.ts`, do outro lado do caminho.
        saida += alvo === null ? dentro : `[${dentro}](${alvo})`;
        break;
      }
      case 'br':
        saida += ' ';
        break;
      default:
        // `span`, `u`, `font`, `mark`: transparentes. O texto nunca some.
        saida += dentro;
    }
  }
  return saida;
}

/**
 * A marca de "aqui a pessoa deixou uma linha vazia" na lista de blocos.
 *
 * String vazia porque nenhum bloco de verdade sai vazio: título sem texto,
 * lista sem item e tabela sem linha devolvem `[]`, não `''`.
 */
const LINHA_VAZIA = '';

/**
 * Um parágrafo pode virar VÁRIOS: `br` no meio parte o bloco. Ver o cabeçalho.
 *
 * ⚠️ PEDAÇO VAZIO É LINHA EM BRANCO, E NÃO SOME — 2026-09-17.
 *   A primeira versão filtrava tudo o que saía vazio, e o "Enter a mais" que a
 *   pessoa dá para separar o briefing (`<p><br></p>`) sumia ao salvar. Na volta
 *   o texto vinha espremido. Agora ele sai como `LINHA_VAZIA`, e `nosParaMarkdown`
 *   o escreve como uma linha em branco a mais.
 *
 *   O ÚLTIMO `br` não conta quando há texto antes dele: é o que o navegador põe
 *   no fim da linha para ela ter altura, e não uma linha que alguém pediu.
 */
function paragrafos(nos: readonly NoRico[]): string[] {
  const pedacos: NoRico[][] = [[]];
  for (const n of nos) {
    if (ehElemento(n) && n.tag === 'br') {
      pedacos.push([]);
      continue;
    }
    pedacos[pedacos.length - 1].push(n);
  }
  const linhas = pedacos.map((p) => nosParaMarkdownEmLinha(p).replace(/\s+$/, ''));
  if (linhas.length > 1 && linhas[linhas.length - 1].trim() === '') linhas.pop();
  return linhas.map((t) =>
    t.trim() === ''
      ? LINHA_VAZIA
      : // Quebra dentro do nó de texto não é linha vazia pedida pelo editor:
        // continua no máximo uma separação de parágrafo, como sempre foi.
        escaparInicioDeBloco(t.replace(/\n{3,}/g, '\n\n')),
  );
}

function celula(nos: readonly NoRico[]): string {
  return nosParaMarkdownEmLinha(nos).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
}

function linhasDaTabela(no: Extract<NoRico, { tipo: 'elemento' }>): NoRico[] {
  const saida: NoRico[] = [];
  for (const f of no.filhos) {
    if (!ehElemento(f)) continue;
    if (f.tag === 'tr') saida.push(f);
    else if (f.tag === 'thead' || f.tag === 'tbody' || f.tag === 'tfoot') {
      saida.push(...linhasDaTabela(f));
    }
  }
  return saida;
}

const TRACO_POR_ALINHAMENTO: Record<string, string> = {
  left: ':---',
  center: ':---:',
  right: '---:',
};

function tabela(no: Extract<NoRico, { tipo: 'elemento' }>): string[] {
  const linhas = linhasDaTabela(no).filter(ehElemento);
  if (linhas.length === 0) return [];

  const celulasDe = (tr: Extract<NoRico, { tipo: 'elemento' }>) =>
    tr.filhos.filter((f): f is Extract<NoRico, { tipo: 'elemento' }> =>
      ehElemento(f) && (f.tag === 'th' || f.tag === 'td'),
    );

  const cabecalho = celulasDe(linhas[0]);
  const largura = Math.max(1, cabecalho.length);
  const escrever = (tr: Extract<NoRico, { tipo: 'elemento' }>) => {
    const c = celulasDe(tr);
    return `| ${Array.from({ length: largura }, (_, i) => celula(c[i]?.filhos ?? [])).join(' | ')} |`;
  };

  const separador = `| ${Array.from(
    { length: largura },
    (_, i) => TRACO_POR_ALINHAMENTO[cabecalho[i]?.alinhamento ?? ''] ?? '---',
  ).join(' | ')} |`;

  return [[escrever(linhas[0]), separador, ...linhas.slice(1).map(escrever)].join('\n')];
}

function lista(no: Extract<NoRico, { tipo: 'elemento' }>, nivel: number): string {
  const ordenada = no.tag === 'ol';
  const linhas: string[] = [];
  let n = 1;

  for (const item of filhosDeTag(no, ['li'])) {
    if (!ehElemento(item)) continue;
    const sublistas = filhosDeTag(item, ['ul', 'ol']);
    const conteudo = item.filhos.filter((f) => !(ehElemento(f) && (f.tag === 'ul' || f.tag === 'ol')));

    const marcador = ordenada ? `${n}. ` : '- ';
    n += 1;
    const caixa = item.caixa === undefined ? '' : item.caixa ? '[x] ' : '[ ] ';
    const texto = nosParaMarkdownEmLinha(achatarParagrafos(conteudo))
      .replace(/\s*\n\s*/g, ' ')
      .trim();

    linhas.push(`${'  '.repeat(nivel)}${marcador}${caixa}${texto}`);
    for (const sub of sublistas) {
      if (ehElemento(sub)) linhas.push(lista(sub, nivel + 1));
    }
  }

  return linhas.join('\n');
}

/** `li > p > texto` vira `li > texto`: o item de lista é uma linha só. */
function achatarParagrafos(nos: readonly NoRico[]): NoRico[] {
  return nos.flatMap((n) =>
    ehElemento(n) && (n.tag === 'p' || n.tag === 'div') ? achatarParagrafos(n.filhos) : [n],
  );
}

function blocosDe(nos: readonly NoRico[]): string[] {
  const saida: string[] = [];
  let solto: NoRico[] = [];

  const despejar = () => {
    if (solto.length > 0) saida.push(...paragrafos(solto));
    solto = [];
  };

  for (const n of nos) {
    if (!ehBloco(n)) {
      solto.push(n);
      continue;
    }
    despejar();
    saida.push(...umBloco(n as Extract<NoRico, { tipo: 'elemento' }>));
  }

  despejar();
  return saida;
}

function umBloco(n: Extract<NoRico, { tipo: 'elemento' }>): string[] {
  switch (n.tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const t = nosParaMarkdownEmLinha(n.filhos).replace(/\s*\n\s*/g, ' ').trim();
      // Título vazio é o que sobra do Enter no COMEÇO de um título: o navegador
      // parte o `h3` em dois e deixa o de cima sem texto. Na tela é uma linha
      // em branco — e é assim que ele é guardado.
      return t === '' ? [LINHA_VAZIA] : [`${'#'.repeat(Number(n.tag[1]))} ${t}`];
    }
    case 'hr':
      return ['---'];
    case 'pre': {
      const cru = textoCru(n.filhos);
      // A cerca cresce se o próprio código tiver três crases dentro.
      const maior = [...cru.matchAll(/^ {0,3}(`{3,})/gm)].reduce(
        (m, x) => Math.max(m, x[1].length),
        2,
      );
      const cerca = '`'.repeat(Math.max(3, maior + 1));
      return [`${cerca}${n.lingua ?? ''}\n${cru}\n${cerca}`];
    }
    case 'blockquote': {
      // Dentro da citação a linha vazia não tem como ser guardada — `>` sozinho
      // já é a separação —, e o analisador também não a lê ali.
      const dentro = blocosDe(n.filhos).filter((b) => b !== LINHA_VAZIA);
      if (dentro.length === 0) return [];
      return [
        dentro
          .map((b) => b.split('\n').map((l) => (l === '' ? '>' : `> ${l}`)).join('\n'))
          .join('\n>\n'),
      ];
    }
    case 'ul':
    case 'ol': {
      const t = lista(n, 0);
      return t === '' ? [] : [t];
    }
    case 'table':
      return tabela(n);
    case 'p':
    case 'div':
    case 'li':
    case 'thead':
    case 'tbody':
    case 'tr':
    case 'th':
    case 'td':
      /*
        Contêiner que pode ter bloco dentro. Se tiver, atravessa; se não, é
        parágrafo.

        ⚠️ `p` ENTRA AQUI, e a primeira versão o tratava como parágrafo puro.
        Medido no Chrome em 2026-08-25: `insertUnorderedList` com o cursor num
        parágrafo vazio produz `<p><ul><li>…</li></ul></p>` — HTML inválido que
        o navegador aceita e mantém. Serializando o `p` só como linha, a lista
        inteira virava texto corrido e as caixas de seleção sumiam.
      */
      return n.filhos.some(ehBloco) ? blocosDe(n.filhos) : paragrafos(n.filhos);
    default:
      return paragrafos(n.filhos);
  }
}

/**
 * A descrição inteira, em markdown. Vazio devolve string vazia, não `'\n'`.
 *
 * Os blocos se separam por uma linha em branco, e cada `LINHA_VAZIA` entre eles
 * soma mais uma — é o que `parseMarkdown` lê de volta como parágrafo vazio. As
 * do começo e as do fim caem: espaço nas pontas não é organização, é sobra.
 *
 * ⚠️ AQUI HAVIA UM `.replace(/\n{3,}/g, '\n\n')` NO TEXTO INTEIRO, e ele saiu.
 *   Era ele que espremia as linhas em branco — e, de quebra, as de dentro de
 *   bloco de código, que não são de ninguém mexer. O teto de duas quebras agora
 *   vale só para o texto de parágrafo, em `paragrafos`.
 */
export function nosParaMarkdown(nos: readonly NoRico[]): string {
  let saida = '';
  let vazias = 0;
  for (const b of blocosDe(nos)) {
    if (b === LINHA_VAZIA) {
      if (saida !== '') vazias += 1;
      continue;
    }
    if (saida !== '') saida += `\n\n${'\n'.repeat(vazias)}`;
    saida += b;
    vazias = 0;
  }
  return saida.trim();
}

/* ───────────────────────────── markdown → nós ───────────────────────────── */

function inlineParaNos(nos: readonly Inline[]): NoRico[] {
  return nos.map((n) => {
    switch (n.kind) {
      case 'attachment':
        return elemento('img', [], { attachmentId: n.id, alt: n.alt });
      case 'mention':
        return elemento('span', [], { mentionId: n.id, mentionName: n.name });
      case 'text':
        return texto(n.text);
      case 'strong':
        return elemento('strong', inlineParaNos(n.children));
      case 'em':
        return elemento('em', inlineParaNos(n.children));
      case 'del':
        return elemento('del', inlineParaNos(n.children));
      case 'code':
        return elemento('code', [texto(n.text)]);
      case 'link':
        return elemento('a', inlineParaNos(n.children), { href: n.href });
      default:
        return texto('');
    }
  });
}

function itensParaNos(itens: readonly ListItem[], ordenada: boolean): NoRico[] {
  return itens.map((item) => {
    const filhos = inlineParaNos(item.content);
    if (item.children.length > 0) {
      filhos.push(elemento(ordenada ? 'ol' : 'ul', itensParaNos(item.children, ordenada)));
    }
    return elemento('li', filhos, item.checked === null ? {} : { caixa: item.checked });
  });
}

function blocoParaNo(b: Block): NoRico {
  switch (b.kind) {
    case 'heading':
      return elemento(`h${b.level}`, inlineParaNos(b.content));
    case 'paragraph':
      return elemento('p', inlineParaNos(b.content));
    case 'rule':
      return elemento('hr');
    case 'code':
      return elemento('pre', [elemento('code', [texto(b.text)])], { lingua: b.lang });
    case 'quote':
      return elemento('blockquote', b.blocks.map(blocoParaNo));
    case 'list':
      return elemento(b.ordered ? 'ol' : 'ul', itensParaNos(b.items, b.ordered));
    case 'table':
      return elemento('table', [
        elemento('thead', [
          elemento(
            'tr',
            b.header.map((c, i) =>
              elemento('th', inlineParaNos(c), { alinhamento: b.align[i] ?? null }),
            ),
          ),
        ]),
        elemento(
          'tbody',
          b.rows.map((linha) =>
            elemento(
              'tr',
              linha.map((c, i) => elemento('td', inlineParaNos(c), { alinhamento: b.align[i] ?? null })),
            ),
          ),
        ),
      ]);
    default:
      return elemento('p');
  }
}

export function blocosParaNos(blocos: readonly Block[]): NoRico[] {
  return blocos.map(blocoParaNo);
}

/** O caminho de abrir: markdown do banco → o que o editor desenha. */
export function markdownParaNos(fonte: string): NoRico[] {
  return blocosParaNos(parseMarkdown(fonte));
}

/* ───────────────────────────── medida da ida e volta ───────────────────────────── */

/**
 * O texto é estável no editor?
 *
 * Serve à prova e ao desenvolvimento: um briefing que muda de forma toda vez que
 * a ficha abre e fecha é um briefing que a equipe deixa de confiar.
 */
export function idaEVolta(fonte: string): string {
  return nosParaMarkdown(markdownParaNos(fonte));
}
