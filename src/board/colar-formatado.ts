/** Importa somente a estrutura que a descrição consegue salvar em Markdown.
 * O HTML externo é lido num template inerte de um documento sem janela. Nunca
 * é conectado à página: nós, atributos e estilos são reconstruídos pela lista
 * permitida do editor. Não reutilizar lerNos: ele aceita IDs internos.
 */
import { criarNo } from '@/board/editor-dom';
import { elemento, texto, TAGS_CONHECIDAS, TAGS_DE_BLOCO, markdownParaNos, nosParaMarkdown, type NoRico } from '@/board/editor-rico';
import { enderecoSeguro } from '@/board/markdown';

const DESCARTAR = new Set(['script', 'style', 'meta', 'link', 'base', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'input', 'button', 'select', 'textarea']);
const ALIASES: Record<string, string> = { b: 'strong', i: 'em', s: 'del', strike: 'del', section: 'div', article: 'div', header: 'div', footer: 'div' };

function envolver(tag: string, filhos: NoRico[]): NoRico[] {
  // Delimitadores Markdown precisam ficar junto do texto, não dos espaços.
  const primeiro = filhos[0];
  const ultimo = filhos[filhos.length - 1];
  let antes = '', depois = '';
  if (primeiro?.tipo === 'texto') {
    antes = /^\s*/.exec(primeiro.texto)![0];
    primeiro.texto = primeiro.texto.slice(antes.length);
  }
  if (ultimo?.tipo === 'texto') {
    depois = /\s*$/.exec(ultimo.texto)![0];
    ultimo.texto = ultimo.texto.slice(0, ultimo.texto.length - depois.length);
  }
  return [...(antes ? [texto(antes)] : []), elemento(tag, filhos), ...(depois ? [texto(depois)] : [])];
}

function lerFilhos(pai: Node, literal = false): NoRico[] {
  const saida: NoRico[] = [];
  // O Word representa listas como parágrafos MsoListParagraph + mso-list.
  const listas: { nivel: number; id: string; tag: string; no: Extract<NoRico, { tipo: 'elemento' }> }[] = [];
  for (const no of Array.from(pai.childNodes)) {
    if (no.nodeType === 3) {
      const valor = (no.nodeValue ?? '').replace(/\u00a0/g, ' ');
      if (!literal && !valor.trim() && /[\n\r]/.test(valor)) continue;
      if (valor) saida.push(texto(literal ? valor : valor.replace(/[\t\r\n ]+/g, ' ')));
      continue;
    }
    if (no.nodeType !== 1) continue;
    const el = no as HTMLElement;
    const bruto = el.tagName.toLowerCase();
    const estilo = el.getAttribute('style') ?? '';
    if (DESCARTAR.has(bruto) || el.hidden || el.style.display === 'none' || el.style.visibility === 'hidden' || /mso-list\s*:\s*ignore/i.test(estilo)) continue;
    // Imagens externas não viram anexos internos nem provocam downloads.
    if (bruto === 'img') {
      const alt = el.getAttribute('alt');
      if (alt) saida.push(texto(alt));
      continue;
    }
    let tag = ALIASES[bruto] ?? bruto;
    const filhos = lerFilhos(el, literal || tag === 'pre' || tag === 'code');
    const listaWord = /mso-list\s*:\s*(l\d+)\s+level(\d+)(?:\s+(lfo\d+))?/i.exec(estilo);
    if (listaWord && (tag === 'p' || tag === 'div')) {
      const marcador = el.querySelector('[style*="mso-list"]')?.textContent ?? '';
      const tipo = /^\s*(?:\d+|[a-zA-Z]+)[.)]/.test(marcador) ? 'ol' : 'ul';
      const nivel = Number(listaWord[2]);
      const id = `${listaWord[1]}:${listaWord[3] ?? ''}`;
      while (listas.length && (listas.at(-1)!.nivel > nivel || listas.at(-1)!.id !== id || (listas.at(-1)!.nivel === nivel && listas.at(-1)!.tag !== tipo))) listas.pop();
      if (!listas.length || listas.at(-1)!.nivel < nivel) {
        const lista = elemento(tipo) as Extract<NoRico, { tipo: 'elemento' }>;
        const paiLista = listas.at(-1)?.no.filhos.at(-1);
        if (paiLista?.tipo === 'elemento') paiLista.filhos.push(lista);
        else saida.push(lista);
        listas.push({ nivel, id, tag: tipo, no: lista });
      }
      listas.at(-1)!.no.filhos.push(elemento('li', filhos));
      continue;
    }
    listas.length = 0;
    const peso = el.style.fontWeight;
    const italico = el.style.fontStyle;
    if ((tag === 'strong' && (peso === 'normal' || (peso && Number(peso) < 600))) || (tag === 'em' && italico === 'normal')) tag = 'span';
    let conteudo = filhos;
    // Não envolver blocos em marcas de linha (ex.: wrapper do Google Docs).
    const temBlocos = conteudo.some((f) => f.tipo === 'elemento' && TAGS_DE_BLOCO.has(f.tag));
    if (!literal && tag !== 'pre' && tag !== 'code' && !temBlocos) {
      if (tag !== 'strong' && (peso === 'bold' || Number(peso) >= 600)) conteudo = envolver('strong', conteudo);
      if (tag !== 'em' && /^(italic|oblique)$/.test(italico)) conteudo = envolver('em', conteudo);
      if (tag !== 'del' && /line-through/.test(el.style.textDecoration + el.style.textDecorationLine)) conteudo = envolver('del', conteudo);
    }
    if (tag === 'strong' || tag === 'em' || tag === 'del') {
      saida.push(...envolver(tag, conteudo));
    } else if (tag === 'a') {
      const href = enderecoSeguro(el.getAttribute('href') ?? '');
      saida.push(...(href ? [elemento('a', conteudo, { href })] : conteudo));
    } else if (tag === 'td' || tag === 'th') {
      const al = el.style.textAlign || el.getAttribute('align');
      saida.push(elemento(tag, conteudo, al === 'left' || al === 'center' || al === 'right' ? { alinhamento: al } : {}));
    } else if (TAGS_CONHECIDAS.has(tag)) {
      saida.push(elemento(tag, conteudo));
    } else {
      saida.push(...conteudo);
    }
  }
  return saida;
}

export function conteudoColado(html: string, simples: string, doc: Document, semFormato = false): NoRico[] {
  if (semFormato) return simples.split(/\r?\n/).map((linha) => elemento('p', [texto(linha)]));
  if (html.trim()) {
    const inerte = doc.implementation.createHTMLDocument('');
    const molde = inerte.createElement('template');
    molde.innerHTML = html; // Apenas análise inerte; nenhum nó deste template entra no editor.
    const md = nosParaMarkdown(lerFilhos(molde.content));
    if (md.trim()) return markdownParaNos(md);
  }
  // Mantém a compatibilidade com texto/Markdown copiado sem HTML.
  return markdownParaNos(simples);
}

/** A inserção nativa agrupa a colagem em uma ação de desfazer/refazer. */
export function inserirColagem(raiz: HTMLElement, nos: NoRico[]): void {
  const doc = raiz.ownerDocument;
  const caixa = doc.createElement('div');
  const primeiro = nos[0];
  const soltos = nos.length === 1 && primeiro.tipo === 'elemento' && primeiro.tag === 'p' ? primeiro.filhos : nos;
  for (const n of soltos) caixa.appendChild(criarNo(n, doc));
  if (!caixa.childNodes.length) return;
  raiz.focus();
  const selecao = doc.getSelection();
  if (!selecao) return;
  if (!selecao.rangeCount || !raiz.contains(selecao.getRangeAt(0).commonAncestorContainer)) {
    const fim = doc.createRange();
    fim.selectNodeContents(raiz);
    fim.collapse(false);
    selecao.removeAllRanges();
    selecao.addRange(fim);
  }
  // HTML gerado EXCLUSIVAMENTE pelos nós seguros acima, nunca o clipboard.
  if (doc.execCommand('insertHTML', false, caixa.innerHTML)) return;
  const range = selecao.getRangeAt(0);
  const fragmento = doc.createDocumentFragment();
  while (caixa.firstChild) fragmento.appendChild(caixa.firstChild);
  const ultimo = fragmento.lastChild;
  range.deleteContents();
  range.insertNode(fragmento);
  if (ultimo) range.setStartAfter(ultimo);
  range.collapse(true);
  selecao.removeAllRanges();
  selecao.addRange(range);
}
