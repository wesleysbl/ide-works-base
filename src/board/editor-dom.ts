/**
 * A ponte entre o editor rico e o DOM — etapa F17.10b.
 *
 * POR QUE ELA MORA FORA DO COMPONENTE
 *   Duas razões, e a segunda é a que importa.
 *
 *   1. `EditorRico.tsx` exporta um componente; exportar função dele quebra o
 *      recarregamento rápido do Vite (`react-refresh/only-export-components`).
 *
 *   2. **Ela precisa de teste, e o componente não é testável sem navegador.**
 *      A suíte roda em `node`. Estas quatro funções encostam no DOM por uma
 *      superfície minúscula — `createElement`, `createTextNode`, `appendChild`,
 *      `setAttribute`, `childNodes` — e por isso um documento de mentira de
 *      sessenta linhas basta para provar a ida e a volta inteira. É o que
 *      `editor-dom.test.ts` faz.
 *
 *      Sem isso, metade do caminho do briefing ficaria sem prova: o
 *      serializador puro estaria testado e o adaptador que o alimenta, não.
 *
 * A GARANTIA DE SEGURANÇA VIVE AQUI
 *   **Não existe `innerHTML` neste arquivo, nem leitura nem escrita.** O
 *   documento é montado nó a nó, só com as etiquetas da lista branca de
 *   `editor-rico.ts`, e é lido por `nodeType`/`nodeValue`/`getAttribute`.
 *
 *   `criarNo` filtra o endereço do link com `enderecoSeguro` ANTES de escrevê-lo
 *   — `javascript:` colado num briefing nunca vira `href`.
 *
 * `nodeType` VAI COMO NÚMERO, E NÃO COMO `Node.TEXT_NODE`
 *   `Node` é global do navegador. Usá-lo aqui amarraria o arquivo a um ambiente
 *   que a suíte não tem, e o teste do adaptador é justamente o ponto.
 *   `1` é elemento e `3` é texto, na norma, desde sempre.
 */

import { ATTACHMENT_ID } from '@/board/imagens-no-texto';
import { noDeMencao, UUID_MENCAO } from '@/board/mencoes';
import {
  type NoRico,
  TAGS_CONHECIDAS,
  elemento,
  texto,
} from '@/board/editor-rico';
import { enderecoSeguro } from '@/board/markdown';

const TIPO_ELEMENTO = 1;
const TIPO_TEXTO = 3;

/** O que o navegador cria e o markdown chama de outro jeito. */
const NORMALIZAR: Record<string, string> = {
  b: 'strong',
  i: 'em',
  s: 'del',
  strike: 'del',
};

/** Blocos onde o cursor precisa de âncora quando estão vazios. */
const PRECISA_DE_ANCORA = ['p', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

const SEM_FILHO = new Set(['hr', 'br', 'img']);

/* ───────────────────────────── árvore → DOM ───────────────────────────── */

/**
 * A marca da caixa de seleção.
 *
 * `contenteditable="false"` para o cursor não entrar nela — sem isso a pessoa
 * digita DENTRO da caixinha e o texto some do markdown. Ela é ENFEITE: quem
 * guarda o estado é o atributo `data-caixa` do `li`, e `lerNos` a ignora.
 */
export function marcaDeCaixa(marcada: boolean, doc: Document): HTMLElement {
  const s = doc.createElement('span');
  s.setAttribute('class', 'cu-caixa');
  s.setAttribute('contenteditable', 'false');
  s.setAttribute('data-caixa', marcada ? '1' : '0');
  s.setAttribute('role', 'checkbox');
  s.setAttribute('aria-checked', marcada ? 'true' : 'false');
  s.textContent = marcada ? '✓' : '';
  return s;
}

export function criarNo(n: NoRico, doc: Document): Node {
  if (n.tipo === 'texto') return doc.createTextNode(n.texto);
  if (n.mentionId && UUID_MENCAO.test(n.mentionId)) return noDeMencao({ id: n.mentionId, name: n.mentionName ?? '' }, doc);

  // Etiqueta fora da lista branca vira `span`: o texto nunca some, e nada que
  // não esteja previsto em `editor-rico.ts` chega a existir no documento.
  const tag = TAGS_CONHECIDAS.has(n.tag) ? n.tag : 'span';
  const el = doc.createElement(tag);

  if (tag === 'img' && n.attachmentId && ATTACHMENT_ID.test(n.attachmentId)) {
    el.setAttribute('data-attachment-id', n.attachmentId);
    el.setAttribute('alt', n.alt || 'Imagem anexada');
    el.setAttribute('class', 'imagem-no-texto');
    el.setAttribute('draggable', 'false');
    el.setAttribute('contenteditable', 'false');
  }
  if (tag === 'a') {
    const alvo = n.href === undefined ? null : enderecoSeguro(n.href);
    if (alvo !== null) {
      el.setAttribute('href', alvo);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
      el.setAttribute('title', 'Clique para abrir · Alt/Option + clique para editar o link');
    }
  }
  if (tag === 'li' && n.caixa !== undefined) {
    el.setAttribute('data-caixa', n.caixa ? '1' : '0');
    el.appendChild(marcaDeCaixa(n.caixa, doc));
  }
  if ((tag === 'th' || tag === 'td') && n.alinhamento) {
    el.setAttribute('data-al', n.alinhamento);
    el.setAttribute('style', `text-align:${n.alinhamento}`);
  }
  // A LÍNGUA DO BLOCO DE CÓDIGO NÃO TEM ONDE MORAR NO DOM, e sem este atributo
  // ela some na primeira ida e volta: ```sql viraria ```. Achado pelo teste do
  // ponto fixo, não pela leitura — é exatamente o que ele existe para pegar.
  if (tag === 'pre' && n.lingua) el.setAttribute('data-lingua', n.lingua);

  if (!SEM_FILHO.has(tag)) {
    for (const f of n.filhos) el.appendChild(criarNo(f, doc));
    if (el.childNodes.length === 0 && PRECISA_DE_ANCORA.includes(tag)) {
      el.appendChild(doc.createElement('br'));
    }
  }

  return el;
}

/** Troca o conteúdo do editor. Documento vazio nasce com um parágrafo. */
export function preencher(alvo: HTMLElement, nos: readonly NoRico[], doc: Document): void {
  while (alvo.firstChild) alvo.removeChild(alvo.firstChild);
  if (nos.length === 0) {
    alvo.appendChild(criarNo(elemento('p'), doc));
    return;
  }
  for (const n of nos) alvo.appendChild(criarNo(n, doc));
}

/* ───────────────────────────── DOM → árvore ───────────────────────────── */

const ehMarcaDeCaixa = (el: Element) =>
  (el.getAttribute('class') ?? '').split(/\s+/).includes('cu-caixa');

export function lerNos(pai: Node): NoRico[] {
  const saida: NoRico[] = [];

  pai.childNodes.forEach((no) => {
    if (no.nodeType === TIPO_TEXTO) {
      // O navegador põe `&nbsp;` para segurar espaço no fim da linha. No texto
      // ele é indistinguível de espaço, e no markdown vira sujeira invisível.
      const t = (no.nodeValue ?? '').replace(/\u00a0/g, ' ');
      if (t !== '') saida.push(texto(t));
      return;
    }
    if (no.nodeType !== TIPO_ELEMENTO) return;

    const el = no as HTMLElement;
    if (ehMarcaDeCaixa(el)) return;
    const mencionado = el.getAttribute('data-mention-id');
    if (mencionado && UUID_MENCAO.test(mencionado)) {
      saida.push(elemento('span', [], { mentionId: mencionado, mentionName: el.getAttribute('data-mention-name') ?? '' })); return;
    }

    const bruto = el.tagName.toLowerCase();
    const tag = NORMALIZAR[bruto] ?? bruto;

    if (tag === 'br') {
      saida.push(elemento('br'));
      return;
    }

    if (tag === 'img') {
      const id = el.getAttribute('data-attachment-id');
      if (id && ATTACHMENT_ID.test(id)) saida.push(elemento('img', [], { attachmentId: id, alt: el.getAttribute('alt') ?? '' }));
      return;
    }

    const extra: {
      href?: string;
      caixa?: boolean;
      alinhamento?: 'left' | 'center' | 'right';
      lingua?: string | null;
    } = {};
    if (tag === 'pre') extra.lingua = el.getAttribute('data-lingua');
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href !== null) extra.href = href;
    }
    if (tag === 'li' && el.getAttribute('data-caixa') !== null) {
      extra.caixa = el.getAttribute('data-caixa') === '1';
    }
    if (tag === 'th' || tag === 'td') {
      const al = el.getAttribute('data-al');
      if (al === 'left' || al === 'center' || al === 'right') extra.alinhamento = al;
    }

    saida.push(elemento(tag, lerNos(el), extra));
  });

  return saida;
}
