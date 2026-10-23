/**
 * O markdown do briefing — etapa F17.10.
 *
 * POR QUE UM ANALISADOR NOSSO, E NÃO UMA BIBLIOTECA
 *   Três razões, e nenhuma é gosto.
 *
 *   1. **A saída é ÁRVORE, não texto de HTML.** Quem desenha é
 *      `src/ui/Markdown.tsx`, com elementos de React. Não existe
 *      `dangerouslySetInnerHTML` em lugar nenhum deste caminho — então não
 *      existe injeção de HTML a partir da descrição de uma tarefa, e não é
 *      preciso confiar num higienizador. A descrição é escrita por gente de
 *      dentro, mas "de dentro" não é garantia: o briefing vai ser colado do
 *      ClickUp, de documento, de e-mail.
 *
 *   2. **O que as tarefas reais usam é pequeno e conhecido.** Títulos, tabelas,
 *      listas, caixas `- [ ]`, links, negrito, emoji e regra horizontal. Foi
 *      medido no plano. Uma dependência traria também referência de nota de
 *      rodapé, HTML embutido e definição de link — superfície que ninguém pede.
 *
 *   3. **Ele é PURO e tem teste.** Nenhuma linha aqui toca em React, em rede ou
 *      em `document`. É o mesmo desenho de `board.ts`.
 *
 * O QUE ELE NÃO FAZ, E ISSO ESTÁ DECLARADO
 *   HTML embutido no meio do markdown vira TEXTO — `<b>oi</b>` aparece com os
 *   sinais de maior e menor. É a decisão da razão 1 levada até o fim: o dia em
 *   que ele passar a interpretar HTML é o dia em que a descrição de uma tarefa
 *   pode desenhar um formulário de senha.
 *
 *   Também não faz: nota de rodapé, definição de link (`[a]: url`), lista de
 *   definição, e cabeçalho `===`/`---` sublinhado (o `---` sozinho é regra
 *   horizontal, que é como as tarefas reais o usam).
 *
 * O ENDEREÇO DO LINK É FILTRADO — ver `enderecoSeguro`
 *   `javascript:` num link de markdown é um clique que executa código. Endereço
 *   que não passa no filtro vira texto puro, e o texto do link continua
 *   legível: some o clique, não some a informação.
 */

/* ───────────────────────────── a árvore ───────────────────────────── */

export type Inline =
  | { kind: 'attachment'; id: string; alt: string }
  | { kind: 'mention'; id: string; name: string }
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'del'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] };

export type ListItem = {
  /** `null` quando o item não é caixa; `false`/`true` quando é `- [ ]`/`- [x]`. */
  checked: boolean | null;
  content: Inline[];
  children: ListItem[];
};

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'rule' }
  | { kind: 'code'; lang: string | null; text: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'table'; header: Inline[][]; align: Align[]; rows: Inline[][][] };

/* ───────────────────────────── endereços ───────────────────────────── */

/**
 * O endereço que pode virar clique.
 *
 * Lista de permissão, e não de proibição: `javascript:`, `data:` e `vbscript:`
 * são os três conhecidos, mas quem escreve a lista de proibição fica devendo o
 * quarto. Aqui passa `http`, `https`, `mailto`, `tel`, o caminho relativo e a
 * âncora — e mais nada.
 *
 * Devolve `null` para o que não passa, e quem chama transforma em texto.
 */
export function enderecoSeguro(bruto: string): string | null {
  const url = bruto.trim();
  if (url === '') return null;

  // O espaco em branco e o caractere de controle saem ANTES de olhar o
  // esquema: `java\nscript:` ja foi usado para partir a palavra em duas e
  // passar por filtro de prefixo.
  // Escrito com `charCodeAt`, e nao com expressao regular: a que faria isso
  // teria caractere de controle dentro, e o `no-control-regex` do lint recusa —
  // com razao, porque esse e o padrao de quem escreve controle sem perceber.
  const limpo = [...url]
    .filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('');
  if (/^(?:https?|mailto|tel):/i.test(limpo)) return url;

  // `//outro.site` e endereco de outro site herdando o esquema da pagina. Nao
  // e caminho relativo, embora se pareca com um.
  if (limpo.startsWith('//')) return null;

  // Sem esquema NENHUM: caminho relativo, caminho do site, ou ancora.
  if (!/^[a-z0-9+.-]*:/i.test(limpo)) return url;

  return null;
}

/* ───────────────────────────── o que fica dentro da linha ───────────────────────────── */

const juntarTexto = (nos: Inline[]): Inline[] => {
  const saida: Inline[] = [];
  for (const no of nos) {
    const ultimo = saida[saida.length - 1];
    if (no.kind === 'text' && ultimo?.kind === 'text') ultimo.text += no.text;
    else saida.push(no);
  }
  return saida.filter((n) => n.kind !== 'text' || n.text !== '');
};

/**
 * LINK NÃO ANINHA DENTRO DE LINK — e sem esta função ele aninhava.
 *
 * ⚠️ ISTO É CONSERTO DE DEFEITO ENCONTRADO, NÃO ENFEITE. `[[a](b)](c)` é
 * markdown válido de escrever, e `acharFecho` — que respeita aninhamento de
 * colchete de propósito — casava o colchete de FORA. O rótulo `[a](b)` voltava
 * para `parseInline`, que via um link ali dentro, e a árvore saía com um nó
 * `link` dentro de outro. `Markdown.tsx` desenha nó `link` como `<a>`: o
 * resultado era `<a>` dentro de `<a>` no HTML.
 *
 * É exatamente o defeito que a F17.6 mediu por outro caminho — lá vinham de
 * duas regras concorrentes, aqui vem de uma só, chamada de novo sobre o próprio
 * rótulo. O medo da F17.21 era acordá-lo; ele já estava acordado.
 *
 * A ESCOLHA: fica o link de FORA, e o de dentro vira o texto dele. É o que
 * quem escreveu pediu como alvo do clique — o colchete externo é o que envolve
 * a frase inteira. O CommonMark decide ao contrário (o de dentro ganha), e a
 * diferença só aparece num caso que nenhum briefing real tem; o que os dois
 * têm em comum, e é o que importa, é que **sobra um `<a>` só**.
 */
function semLinksDentro(nos: readonly Inline[]): Inline[] {
  const saida: Inline[] = [];
  for (const no of nos) {
    if (no.kind === 'link') saida.push(...semLinksDentro(no.children));
    else if (no.kind === 'attachment') saida.push({ kind: 'text', text: no.alt });
    else if (no.kind === 'strong') saida.push({ kind: 'strong', children: semLinksDentro(no.children) });
    else if (no.kind === 'em') saida.push({ kind: 'em', children: semLinksDentro(no.children) });
    else if (no.kind === 'del') saida.push({ kind: 'del', children: semLinksDentro(no.children) });
    else saida.push(no);
  }
  return juntarTexto(saida);
}

/**
 * OS ENDEREÇOS QUE ESTE PEDAÇO DE TEXTO CARREGA — etapa F17.21.
 *
 * ⚠️ ELA NÃO PROCURA LINK NENHUM, E É O PONTO DELA.
 *   Quem acha link neste projeto é `parseInline`, uma vez só: o colchete, o
 *   `<…>` e a regra `URL_SOLTA`, que existe porque "as tarefas reais colam
 *   link do Dropbox e do Google Docs sem colchete nenhum". Esta função apenas
 *   **colhe da árvore** o que aquela já achou.
 *
 *   Escrever aqui uma segunda expressão de endereço seria repetir a F17.6, que
 *   pôs uma regra concorrente ao lado da que já existia e só descobriu o `<a>`
 *   dentro de `<a>` depois de medir o HTML. A prévia se SOMA ao que existe.
 *
 * Só `http` e `https`: `mailto:`, `tel:`, âncora e caminho relativo não têm
 * cartão para mostrar. Repetido e na ordem em que aparecem — um mesmo endereço
 * colado duas vezes no mesmo parágrafo é um cartão, não dois.
 */
export function linksDoConteudo(nos: readonly Inline[]): string[] {
  const saida: string[] = [];
  const vistos = new Set<string>();

  const percorrer = (lista: readonly Inline[]) => {
    for (const no of lista) {
      if (no.kind === 'link') {
        if (/^https?:\/\//i.test(no.href) && !vistos.has(no.href)) {
          vistos.add(no.href);
          saida.push(no.href);
        }
        continue;
      }
      if (no.kind === 'strong' || no.kind === 'em' || no.kind === 'del') percorrer(no.children);
    }
  };

  percorrer(nos);
  return saida;
}

/**
 * O mesmo, para o texto INTEIRO — é o que a descrição usa.
 *
 * O briefing vive dentro de um editor, e lá não há como pôr cartão no meio do
 * que está sendo digitado. Os cartões dele ficam embaixo do editor, e para isso
 * a conta é do documento todo, não de um parágrafo.
 */
export function linksDoTexto(fonte: string): string[] {
  const saida: string[] = [];
  const vistos = new Set<string>();

  const guardar = (nos: readonly Inline[]) => {
    for (const href of linksDoConteudo(nos)) {
      if (vistos.has(href)) continue;
      vistos.add(href);
      saida.push(href);
    }
  };

  const percorrerItens = (itens: readonly ListItem[]) => {
    for (const it of itens) {
      guardar(it.content);
      percorrerItens(it.children);
    }
  };

  const percorrer = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (b.kind === 'paragraph' || b.kind === 'heading') guardar(b.content);
      else if (b.kind === 'list') percorrerItens(b.items);
      else if (b.kind === 'quote') percorrer(b.blocks);
      else if (b.kind === 'table') {
        for (const celula of b.header) guardar(celula);
        for (const linha of b.rows) for (const celula of linha) guardar(celula);
      }
    }
  };

  percorrer(parseMarkdown(fonte));
  return saida;
}

/** `_` só delimita entre não-letras — senão `nome_do_campo` viraria itálico. */
const bordaDeSublinhado = (c: string | undefined) => c === undefined || !/[\p{L}\p{N}]/u.test(c);

const URL_SOLTA = /^(?:https?:\/\/|www\.)[^\s<>()[\]]+[^\s<>()[\].,;:!?]/i;

export function parseInline(src: string): Inline[] {
  const saida: Inline[] = [];
  let i = 0;

  const texto = (t: string) => saida.push({ kind: 'text', text: t });

  while (i < src.length) {
    const c = src[i];
    if (c === '@') {
      const m = /^@\[([^\]\r\n]{1,120})\]\(mention:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i.exec(src.slice(i));
      if (m) { saida.push({ kind: 'mention', id: m[2].toLowerCase(), name: m[1] }); i += m[0].length; continue; }
    }

    // A barra invertida entrega o próximo caractere como texto puro. É o que
    // permite escrever `\*` sem virar itálico.
    if (c === '\\' && i + 1 < src.length) {
      texto(src[i + 1]);
      i += 2;
      continue;
    }

    // Código em linha. A cerca é do tamanho que abriu, para `` `a` `` caber
    // dentro de ``` ``a`b`` ```.
    if (c === '`') {
      let cerca = 0;
      while (src[i + cerca] === '`') cerca += 1;
      const marca = '`'.repeat(cerca);
      const fim = src.indexOf(marca, i + cerca);
      if (fim !== -1) {
        saida.push({ kind: 'code', text: src.slice(i + cerca, fim).trim() });
        i = fim + cerca;
        continue;
      }
    }

    // Imagem do nosso armazenamento: só um identificador, sem URL persistida.
    if (c === '!') {
      const imagem = /^!\[([^\]\n]*)\]\(attachment:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i.exec(src.slice(i));
      if (imagem) {
        saida.push({ kind: 'attachment', id: imagem[2].toLowerCase(), alt: imagem[1] });
        i += imagem[0].length;
        continue;
      }
    }

    // Link. O texto do link é analisado de novo, porque `[**a**](x)` existe.
    if (c === '[') {
      const fechaTexto = acharFecho(src, i, '[', ']');
      if (fechaTexto !== -1 && src[fechaTexto + 1] === '(') {
        const fechaUrl = acharFecho(src, fechaTexto + 1, '(', ')');
        if (fechaUrl !== -1) {
          const rotulo = src.slice(i + 1, fechaTexto);
          // `[a](url "título")` — o título é descartado, não desenhado.
          const alvo = src.slice(fechaTexto + 2, fechaUrl).split(/\s+/)[0] ?? '';
          const href = enderecoSeguro(alvo);
          if (href === null) {
            // Endereço recusado: fica o texto, some o clique.
            saida.push(...parseInline(rotulo));
          } else {
            // `semLinksDentro`: o rótulo é analisado de novo, e um `[x](y)`
            // dentro dele traria um segundo `<a>` para dentro deste. Ver a
            // função — é defeito medido, não precaução.
            saida.push({ kind: 'link', href, children: semLinksDentro(parseInline(rotulo)) });
          }
          i = fechaUrl + 1;
          continue;
        }
      }
    }

    // `<https://…>` — a forma explícita.
    if (c === '<') {
      const fim = src.indexOf('>', i);
      if (fim !== -1) {
        const dentro = src.slice(i + 1, fim);
        if (/^(?:https?:\/\/|mailto:)\S+$/i.test(dentro)) {
          const href = enderecoSeguro(dentro);
          if (href !== null) {
            saida.push({ kind: 'link', href, children: [{ kind: 'text', text: dentro }] });
            i = fim + 1;
            continue;
          }
        }
      }
    }

    // Endereço solto no meio da frase. As tarefas reais colam link do Dropbox e
    // do Google Docs sem colchete nenhum — sem isto eles não clicam.
    if ((c === 'h' || c === 'w') && (i === 0 || /[\s(]/.test(src[i - 1]))) {
      const m = URL_SOLTA.exec(src.slice(i));
      if (m) {
        const bruto = m[0];
        const href = enderecoSeguro(bruto.startsWith('www.') ? `https://${bruto}` : bruto);
        if (href !== null) {
          saida.push({ kind: 'link', href, children: [{ kind: 'text', text: bruto }] });
          i += bruto.length;
          continue;
        }
      }
    }

    const par = (marca: string, kind: 'strong' | 'em' | 'del'): boolean => {
      if (!src.startsWith(marca, i)) return false;
      if (marca === '_' && !bordaDeSublinhado(src[i - 1])) return false;
      // Marca colada em espaço não abre. É o que impede `2 * 3 * 4` de virar
      // itálico — a regra de flanqueamento do CommonMark, na forma curta.
      if (/\s/.test(src[i + marca.length] ?? ' ')) return false;
      const fim = acharMarca(src, i + marca.length, marca);
      if (fim === -1) return false;
      const dentro = src.slice(i + marca.length, fim);
      if (dentro.trim() === '') return false;
      // E marca precedida de espaço não fecha.
      if (/\s/.test(src[fim - 1] ?? ' ')) return false;
      if (marca === '_' && !bordaDeSublinhado(src[fim + marca.length])) return false;
      saida.push({ kind, children: parseInline(dentro) });
      i = fim + marca.length;
      return true;
    };

    // A ordem importa: `**` antes de `*`, senão o negrito vira dois itálicos
    // vazios.
    if (par('***', 'strong') || par('**', 'strong') || par('__', 'strong')) continue;
    if (par('~~', 'del')) continue;
    if (par('*', 'em') || par('_', 'em')) continue;

    texto(c);
    i += 1;
  }

  return juntarTexto(saida);
}

/** Acha o fecho respeitando aninhamento — `[a [b] c]` fecha no último. */
function acharFecho(src: string, inicio: number, abre: string, fecha: string): number {
  let nivel = 0;
  for (let i = inicio; i < src.length; i += 1) {
    if (src[i] === '\\') {
      i += 1;
      continue;
    }
    if (src[i] === abre) nivel += 1;
    else if (src[i] === fecha) {
      nivel -= 1;
      if (nivel === 0) return i;
    }
  }
  return -1;
}

/** Acha a marca de fechamento, pulando o que a barra invertida escapa. */
function acharMarca(src: string, inicio: number, marca: string): number {
  for (let i = inicio; i <= src.length - marca.length; i += 1) {
    if (src[i] === '\\') {
      i += 1;
      continue;
    }
    if (src.startsWith(marca, i)) return i;
  }
  return -1;
}

/* ───────────────────────────── o que fica entre as linhas ───────────────────────────── */

const REGRA = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TITULO = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const CERCA = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const CITACAO = /^ {0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const CAIXA = /^\[([ xX])\]\s+(.*)$/;
const SEPARADOR_DE_TABELA = /^ {0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Parte uma linha de tabela em células, respeitando `\|`. */
function celulas(linha: string): string[] {
  const bruto = linha.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  const saida: string[] = [];
  let atual = '';
  for (let i = 0; i < bruto.length; i += 1) {
    if (bruto[i] === '\\' && bruto[i + 1] === '|') {
      atual += '|';
      i += 1;
      continue;
    }
    if (bruto[i] === '|') {
      saida.push(atual.trim());
      atual = '';
      continue;
    }
    atual += bruto[i];
  }
  saida.push(atual.trim());
  return saida;
}

const alinhamento = (marca: string): Align => {
  const m = marca.trim();
  if (m.startsWith(':') && m.endsWith(':')) return 'center';
  if (m.endsWith(':')) return 'right';
  if (m.startsWith(':')) return 'left';
  return null;
};

/**
 * O briefing inteiro, em blocos.
 *
 * `\r\n` e `\t` são normalizados na entrada: o briefing chega colado do
 * ClickUp, do Word e do Google Docs, e cada um traz o seu. A tabulação vira
 * quatro espaços porque a indentação de lista é contada em espaços.
 *
 * A LINHA EM BRANCO A MAIS É ESPAÇO QUE ALGUÉM DEIXOU — 2026-09-17.
 *   Uma linha em branco separa dois blocos, como manda o markdown. Cada linha
 *   em branco ALÉM dessa vira um parágrafo vazio: é como o editor guarda o
 *   "Enter a mais" que a pessoa deu para arejar o briefing, e é também como o
 *   ClickUp exporta a linha vazia (`\n\n\n`). Antes disto o espaço era jogado
 *   fora, e o briefing voltava espremido na segunda vez que a tarefa abria.
 *
 *   Só no nível de cima: começo e fim do texto não contam, e dentro da citação
 *   a linha em branco continua sendo só separação.
 */
export function parseMarkdown(fonte: string): Block[] {
  const linhas = fonte.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return blocos(linhas, true);
}

function blocos(linhas: string[], comLinhaVazia = false): Block[] {
  const saida: Block[] = [];
  let i = 0;
  let emBranco = 0;

  while (i < linhas.length) {
    const linha = linhas[i];

    if (linha.trim() === '') {
      emBranco += 1;
      i += 1;
      continue;
    }

    if (comLinhaVazia && saida.length > 0) {
      for (let k = 1; k < emBranco; k += 1) saida.push({ kind: 'paragraph', content: [] });
    }
    emBranco = 0;

    // Cerca de código: vem antes de tudo, porque lá dentro nada é markdown.
    const cerca = CERCA.exec(linha);
    if (cerca) {
      // Fecha com a MESMA marca que abriu — `~~~` dentro de ``` é conteúdo.
      const fecha = cerca[1][0] === '`' ? /^ {0,3}`{3,}\s*$/ : /^ {0,3}~{3,}\s*$/;
      const corpo: string[] = [];
      i += 1;
      while (i < linhas.length && !fecha.test(linhas[i])) {
        corpo.push(linhas[i]);
        i += 1;
      }
      // Cerca sem fecho: o resto do texto é o bloco. Perder o conteúdo seria
      // pior do que desenhar um bloco grande demais.
      i += 1;
      saida.push({ kind: 'code', lang: cerca[2] || null, text: corpo.join('\n') });
      continue;
    }

    if (REGRA.test(linha)) {
      saida.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    const titulo = TITULO.exec(linha);
    if (titulo) {
      saida.push({
        kind: 'heading',
        level: titulo[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parseInline(titulo[2]),
      });
      i += 1;
      continue;
    }

    if (CITACAO.test(linha)) {
      const dentro: string[] = [];
      while (i < linhas.length) {
        const m = CITACAO.exec(linhas[i]);
        if (m) {
          dentro.push(m[1]);
          i += 1;
          continue;
        }
        break;
      }
      saida.push({ kind: 'quote', blocks: blocos(dentro, false) });
      continue;
    }

    // Tabela: só é tabela se a linha seguinte for o separador. Sem essa
    // exigência, qualquer frase com uma barra vertical viraria grade.
    if (linha.includes('|') && i + 1 < linhas.length && SEPARADOR_DE_TABELA.test(linhas[i + 1])) {
      const cabecalho = celulas(linha);
      const align = celulas(linhas[i + 1]).map(alinhamento);
      i += 2;
      const linhasDaTabela: Inline[][][] = [];
      while (i < linhas.length && linhas[i].includes('|') && linhas[i].trim() !== '') {
        const c = celulas(linhas[i]);
        // Linha curta é completada e linha longa é cortada: tabela real vem
        // torta, e recusar a tabela inteira por causa de uma célula faltando
        // esconderia o resto.
        const ajustada = Array.from({ length: cabecalho.length }, (_, k) => parseInline(c[k] ?? ''));
        linhasDaTabela.push(ajustada);
        i += 1;
      }
      saida.push({
        kind: 'table',
        header: cabecalho.map(parseInline),
        align: Array.from({ length: cabecalho.length }, (_, k) => align[k] ?? null),
        rows: linhasDaTabela,
      });
      continue;
    }

    const item = ITEM.exec(linha);
    if (item) {
      const [lista, proximo] = umaLista(linhas, i);
      saida.push(lista);
      i = proximo;
      continue;
    }

    // Parágrafo: junta até a linha em branco ou até algo que comece outro bloco.
    const paragrafo: string[] = [];
    while (i < linhas.length) {
      const l = linhas[i];
      if (l.trim() === '') break;
      if (REGRA.test(l) || TITULO.test(l) || CERCA.test(l) || CITACAO.test(l) || ITEM.test(l)) break;
      if (l.includes('|') && i + 1 < linhas.length && SEPARADOR_DE_TABELA.test(linhas[i + 1])) break;
      paragrafo.push(l.trim());
      i += 1;
    }
    // A quebra simples vira espaço, como manda o markdown — e é o que faz o
    // briefing colado de outro editor não sair picado.
    saida.push({ kind: 'paragraph', content: parseInline(paragrafo.join(' ')) });
  }

  return saida;
}

/** Uma lista inteira, com o aninhamento por indentação. Devolve onde parou. */
function umaLista(linhas: string[], inicio: number): [Block, number] {
  const primeiro = ITEM.exec(linhas[inicio]) as RegExpExecArray;
  const ordered = /\d/.test(primeiro[2]);
  const start = ordered ? Number.parseInt(primeiro[2], 10) : 1;
  const base = primeiro[1].length;

  type Cru = { indent: number; checked: boolean | null; texto: string };
  const crus: Cru[] = [];
  let i = inicio;

  while (i < linhas.length) {
    const l = linhas[i];
    if (l.trim() === '') {
      // Uma linha em branco no meio não fecha a lista; duas fecham.
      if (i + 1 < linhas.length && ITEM.test(linhas[i + 1])) {
        i += 1;
        continue;
      }
      break;
    }
    const m = ITEM.exec(l);
    if (!m) {
      // Continuação do item anterior, indentada. Vira mais texto do mesmo item.
      if (crus.length > 0 && /^\s{2,}\S/.test(l)) {
        crus[crus.length - 1].texto += ` ${l.trim()}`;
        i += 1;
        continue;
      }
      break;
    }
    if (m[1].length < base) break;
    if (/\d/.test(m[2]) !== ordered && m[1].length === base) break;

    const caixa = CAIXA.exec(m[3]);
    crus.push({
      indent: m[1].length,
      checked: caixa ? caixa[1].toLowerCase() === 'x' : null,
      texto: caixa ? caixa[2] : m[3],
    });
    i += 1;
  }

  // A indentação vira profundidade: os recuos distintos são ordenados e a
  // posição de cada um é o nível. Assim 2, 4 e 8 espaços dão 0, 1 e 2 sem
  // exigir que o briefing use múltiplo exato de nada.
  const recuos = [...new Set(crus.map((c) => c.indent))].sort((a, b) => a - b);
  const raiz: ListItem[] = [];
  const pilha: ListItem[][] = [raiz];

  for (const cru of crus) {
    const nivel = Math.min(recuos.indexOf(cru.indent), pilha.length - 1);
    pilha.length = nivel + 1;
    const item: ListItem = { checked: cru.checked, content: parseInline(cru.texto), children: [] };
    pilha[nivel].push(item);
    pilha.push(item.children);
  }

  return [{ kind: 'list', ordered, start, items: raiz }, i];
}

/* ───────────────────────────── medidas para a tela ───────────────────────────── */

export type MarkdownResumo = {
  vazio: boolean;
  blocos: number;
  tabelas: number;
  /** `- [ ]` e `- [x]`: as duas contagens que o cabeçalho da ficha mostra. */
  caixas: number;
  caixasMarcadas: number;
};

/**
 * O que o editor mostra embaixo, para quem escreve saber que o texto virou
 * estrutura. Sem isto, "pré-visualização" é só uma segunda caixa de texto.
 */
export function resumirMarkdown(blocosDoTexto: readonly Block[]): MarkdownResumo {
  let tabelas = 0;
  let caixas = 0;
  let marcadas = 0;

  const percorrerItens = (itens: readonly ListItem[]) => {
    for (const it of itens) {
      if (it.checked !== null) {
        caixas += 1;
        if (it.checked) marcadas += 1;
      }
      percorrerItens(it.children);
    }
  };

  const percorrer = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (b.kind === 'table') tabelas += 1;
      if (b.kind === 'list') percorrerItens(b.items);
      if (b.kind === 'quote') percorrer(b.blocks);
    }
  };

  percorrer(blocosDoTexto);

  return {
    vazio: blocosDoTexto.length === 0,
    blocos: blocosDoTexto.length,
    tabelas,
    caixas,
    caixasMarcadas: marcadas,
  };
}
