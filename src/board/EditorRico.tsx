/**
 * O editor rico do briefing — a tela. Etapa F17.10b, refeita na F17.16.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU NA F17.16, E POR QUÊ
 *
 *   O usuário abriu o modal publicado, pôs o ClickUp dele ao lado e apontou:
 *   *"no ClickUp o modal é limpo"* — título, descrição, chips, botão. A faixa
 *   `Aa | B I S </> | • 1. ☑ | 🔗 ▦ ❝ — 🙂` ocupava uma linha inteira o tempo
 *   todo e fazia a caixa de tarefa parecer editor de documento.
 *
 *   Ele tem razão, e a correção é de GRAMÁTICA, não de estilo: no ClickUp a
 *   formatação não é uma faixa fixa, são DOIS gestos.
 *
 *     · **Selecionou texto** → uma bolha flutuante nasce ancorada na seleção,
 *       com o que age sobre texto selecionado: estilo do bloco, negrito,
 *       itálico, riscado, código e link. Some quando a seleção some.
 *     · **Cursor parado, digitou `/`** → um menu de comandos nasce no cursor,
 *       com o que se INSERE: títulos, as três listas, citação, bloco de código,
 *       tabela, regra horizontal e emoji.
 *
 *   Os dois caminhos juntos cobrem TUDO o que a faixa fazia. Nenhum comando
 *   ficou sem porta — ver a justificativa em `barra-de-comandos.ts`.
 *
 * ⚠️ OS ATALHOS DE TECLADO NÃO DEPENDEM DA BOLHA, E NUNCA DEPENDERAM
 *   `Ctrl+B`, `Ctrl+I`, `Ctrl+Shift+X` e `Ctrl+K` são tratados no `keydown` do
 *   próprio `contenteditable`, e continuam idênticos. Quem formata pelo teclado
 *   não perde nada com a faixa tendo sumido — e é por isso que a bolha pode
 *   abrir SEM FOCO (ver abaixo) sem tornar a formatação inalcançável.
 *
 * POR QUE A BOLHA ABRE SEM FOCO — a armadilha desta etapa
 *   O `Balao` de `menus.tsx` foca o primeiro item ao abrir, e é o certo para um
 *   menu que se alcança pelo teclado. Aqui seria fatal: o foco sairia do
 *   `contenteditable` no mesmo instante em que a bolha aparecesse, e
 *   `document.execCommand('bold')` passaria a mirar o BOTÃO. A bolha apareceria
 *   bonita e nenhum botão dela funcionaria.
 *
 *   Daí `semFoco` — acrescentado ao `Balao` nesta etapa — e daí, também, todo
 *   botão da bolha continuar agindo no `mousedown` com `preventDefault`: mudar
 *   o foco desfaz a seleção, e negrito aplicado a nada é o defeito clássico de
 *   barra flutuante.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A GARANTIA DE SEGURANÇA CONTINUA DE PÉ — e é o que mais importa neste arquivo
 *   O HTML copiado é analisado num documento inerte e convertido para os nós
 *   permitidos do editor. Só o HTML reconstruído desses nós é inserido; nunca
 *   os atributos, scripts ou IDs internos recebidos da área de transferência.
 *   Sem HTML, a colagem mantém o suporte a texto/Markdown.
 *
 * POR QUE O REACT NÃO BRIGA COM O `contenteditable`
 *   O React só mexe no DOM quando a ÁRVORE DELE muda entre dois desenhos. Este
 *   componente desenha o `div` editável **vazio** e o preenche num efeito, uma
 *   vez por `semente`. A bolha e o menu `/` são IRMÃOS do editável, nunca
 *   filhos: se fossem filhos, montar e desmontar um balão mexeria na árvore de
 *   dentro do `contenteditable` e o cursor pularia.
 *
 *   `semente` é o que diz "este é outro documento": trocar de tarefa, ou a
 *   ficha ser relida depois de salvar. Passar a descrição de volta como
 *   propriedade a cada tecla é o que faria o cursor pular para o começo.
 *
 * `execCommand` ESTÁ DEPRECIADO, E MESMO ASSIM É O CERTO AQUI
 *   Ele é o único caminho que preserva o desfazer NATIVO do navegador (Ctrl+Z)
 *   e a seleção. Reimplementar negrito à mão sobre `Range` custaria centenas de
 *   linhas e perderia o desfazer — que é o recurso que mais se usa num editor.
 *   Continua implementado em todos os navegadores de mesa. Ver a dívida no
 *   relatório da etapa.
 */

import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  COMANDOS_DE_SELECAO,
  ESTILOS_DE_BLOCO,
  type ChaveDeComando,
  type ChaveDeSelecao,
  acharBarra,
  atalhoDeTecla,
  filtrarComandos,
  rotuloDeSelecao,
} from '@/board/barra-de-comandos';
import { conteudoColado, inserirColagem } from '@/board/colar-formatado';
import { deveAnexar, ehTipoQueSeCola } from '@/board/colar-imagem';
import { imagensDoTexto } from '@/board/imagens-no-texto';
import { api } from '@/lib/api';
import '@/ui/imagens-no-texto.css';
import { criarNo, lerNos, marcaDeCaixa, preencher } from '@/board/editor-dom';
import { elemento, markdownParaNos, nosParaMarkdown, texto } from '@/board/editor-rico';
import { enderecoSeguro, linksDoTexto } from '@/board/markdown';
import { Ajuda, Balao, IconeSeta } from '@/board/menus';
import { PreviasDeLink, TETO_NO_TEXTO } from '@/ui/Markdown';
import { IconeClipe } from '@/ui/Icones';
import { useMencoes } from '@/board/use-mencoes';

/* ───────────────────────────── seleção ───────────────────────────── */

const selecao = () => (typeof window === 'undefined' ? null : window.getSelection());

function elementoDaSelecao(raiz: HTMLElement): HTMLElement | null {
  const s = selecao();
  if (!s || s.rangeCount === 0) return null;
  let no: Node | null = s.getRangeAt(0).startContainer;
  while (no && no !== raiz) {
    if (no.nodeType === Node.ELEMENT_NODE) return no as HTMLElement;
    no = no.parentNode;
  }
  return raiz;
}

/**
 * Inserir no cursor, e deixar o cursor DEPOIS do que se inseriu.
 *
 * ⚠️ UM FRAGMENTO FICA VAZIO E SEM PAI ASSIM QUE É INSERIDO.
 *   `insertNode` move os FILHOS do `DocumentFragment` para o documento e deixa
 *   o fragmento vazio, fora da árvore. `setStartAfter(fragmento)` depois disso
 *   levanta `InvalidNodeTypeError: the given Node has no parent` — e o erro
 *   corta o resto da função, inclusive o `avisar()` de quem chamou.
 *
 *   O sintoma era exatamente este, medido em 2026-08-26 num navegador de
 *   verdade: inserir tabela ou regra horizontal punha a peça na tela e NÃO a
 *   punha no markdown salvo, até a tecla seguinte. Defeito da F17.10b, quando
 *   os dois comandos passaram a montar fragmento; ele estava atrás da faixa
 *   fixa e passou a estar no menu `/`.
 *
 *   Guardar o último filho ANTES da inserção resolve: é ele que continua na
 *   árvore, e é depois dele que o cursor tem de ficar.
 */
function inserir(raiz: HTMLElement, no: Node): void {
  const s = selecao();
  const ultimo = no.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? no.lastChild : no;

  if (!s || s.rangeCount === 0 || !raiz.contains(s.getRangeAt(0).startContainer)) {
    raiz.appendChild(no);
    return;
  }
  const r = s.getRangeAt(0);
  r.deleteContents();
  r.insertNode(no);
  if (ultimo === null) return;
  r.setStartAfter(ultimo);
  r.collapse(true);
  s.removeAllRanges();
  s.addRange(r);
}

/** Reconhece a URL concluída sem reescrever o documento nem perder o desfazer. */
function linkifyAtCursor(root: HTMLElement): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return;
  if (node.parentElement?.closest('a, code, pre')) return;

  const before = (node.nodeValue ?? '').slice(0, range.startOffset);
  const match = /(?:^|\s)((?:https?:\/\/|www\.)\S+)$/i.exec(before);
  if (!match) return;
  const paragraph = markdownParaNos(match[1])[0];
  if (paragraph?.tipo !== 'elemento' || paragraph.tag !== 'p') return;
  const [link, ...suffix] = paragraph.filhos;
  if (link?.tipo !== 'elemento' || link.tag !== 'a' || !link.href) return;
  if (suffix.some((part) => part.tipo !== 'texto')) return;
  const suffixLength = suffix.reduce((length, part) => length + (part.tipo === 'texto' ? part.texto.length : 0), 0);
  const end = range.startOffset - suffixLength;
  range.setStart(node, before.length - match[1].length);
  range.setEnd(node, end);
  selection.removeAllRanges();
  selection.addRange(range);
  root.ownerDocument.execCommand('createLink', false, link.href);

  const anchor = elementoDaSelecao(root)?.closest('a');
  if (!anchor) return;
  const cursor = root.ownerDocument.createRange();
  const next = anchor.nextSibling;
  if (suffixLength && next?.nodeType === Node.TEXT_NODE) cursor.setStart(next, suffixLength);
  else cursor.setStartAfter(anchor);
  cursor.collapse(true);
  selection.removeAllRanges();
  selection.addRange(cursor);
}

/* ───────────────────────────── onde o balão nasce ───────────────────────── */

/**
 * O que flutua sobre o editor, e onde.
 *
 * ⚠️ `x` E `y` SÃO COORDENADAS DE JANELA, E O BALÃO É `position: fixed`.
 *   A primeira versão desta etapa as media em relação à caixa do editor, com
 *   `position: absolute`. Num navegador de verdade o menu `/` apareceu CORTADO
 *   ao terço: `.cu-corpo` — o corpo do modal — é o único contêiner que rola, e
 *   ele tem pouco mais de 8rem de altura. Um menu de doze linhas não cabe nele
 *   por nenhum lado, e `overflow-y: auto` decapita o que passar.
 *
 *   Com `fixed`, o balão sai de qualquer `overflow`. Dentro do modal ele se
 *   resolve contra `.cu-fundo` (que tem `backdrop-filter` e por isso vira bloco
 *   de contenção) — e `.cu-fundo` é `position: fixed; inset: 0`, ou seja, a
 *   própria janela. Na ficha da tarefa não há ancestral transformado nenhum, e
 *   ele se resolve contra a janela direto.
 *
 *   O preço é que `fixed` não acompanha rolagem: por isso o componente escuta
 *   `scroll` e `resize` e recalcula. Sem isso o menu ficaria parado no ar
 *   enquanto o texto rolasse por baixo.
 */
type ModoFlutuante = 'selecao' | 'barra' | 'emoji' | 'link';

type Flutuante = {
  modo: ModoFlutuante;
  x: number;
  y: number;
  lado: 'cima' | 'baixo';
  /** O que foi digitado depois do `/`. Vazio nos outros modos. */
  consulta: string;
};

/**
 * Largura mínima do balão, em pixels, para ele não sair pela direita.
 *
 * `.cu-balao` tem `min-width: 13rem` (208px) mais o recuo. O grude é
 * deliberadamente aproximado: errar 20px na horizontal é invisível, e medir o
 * balão exigiria desenhá-lo primeiro para depois movê-lo — que é o que produz
 * o piscar de menu flutuante mal feito.
 */
const LARGURA_DO_BALAO = 240;

/** Espaço acima da seleção abaixo do qual a bolha vira para baixo. */
const ALTURA_DA_BOLHA = 52;

function ondeAncorar(
  raiz: HTMLElement,
  preferido: 'cima' | 'baixo',
): { x: number; y: number; lado: 'cima' | 'baixo' } | null {
  const s = selecao();
  if (!s || s.rangeCount === 0) return null;

  const r = s.getRangeAt(0);
  let alvo = r.getBoundingClientRect();
  // Cursor parado em nó vazio devolve retângulo zerado em alguns navegadores.
  // O elemento que contém o cursor é a segunda melhor âncora, e é melhor que
  // um menu no canto superior esquerdo da tela.
  if (alvo.width === 0 && alvo.height === 0) {
    const el = elementoDaSelecao(raiz);
    if (!el) return null;
    alvo = el.getBoundingClientRect();
  }

  const teto = Math.max(0, window.innerWidth - LARGURA_DO_BALAO - 12);
  const x = Math.max(8, Math.min(alvo.left, teto));

  // Só a bolha de seleção vira: ela é baixa e cabe nos dois lados, e abrir por
  // cima é o que evita ela cobrir justamente o texto que se selecionou. O menu
  // `/` é alto e sempre abre para baixo.
  if (preferido === 'cima' && alvo.top >= ALTURA_DA_BOLHA) {
    return { x, y: alvo.top, lado: 'cima' };
  }
  return { x, y: alvo.bottom, lado: 'baixo' };
}

/* ───────────────────────────── o componente ───────────────────────────── */

const EMOJIS = [
  '🔥', '✅', '❌', '⚠️', '🚀', '🎯', '📌', '📎', '🗓️', '⏰',
  '💡', '📝', '🎬', '📸', '🎨', '🎵', '💬', '👀', '👍', '🙏',
  '😀', '😅', '🤔', '😍', '🥳', '😱', '💪', '🤝', '⭐', '❤️',
];

/**
 * O desenho de cada peça da bolha. O RÓTULO vem do catálogo, não daqui — aqui
 * só mora o que é puramente visual, que é o que não pode virar regra.
 */
const MARCA_DA_SELECAO: Record<ChaveDeSelecao, ReactNode> = {
  estilo: 'Aa',
  negrito: <b>B</b>,
  italico: <i>I</i>,
  riscado: <s>S</s>,
  codigo: <span className="o-mono">{'</>'}</span>,
  link: '🔗',
};

function Ferramenta({
  titulo,
  aoClicar,
  pressionado,
  children,
}: {
  titulo: string;
  aoClicar: () => void;
  pressionado?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="cu-ferramenta"
      title={titulo}
      aria-label={titulo}
      aria-pressed={pressionado}
      // `mousedown` e não `click`: o `click` só chega depois do foco mudar, e
      // mudar o foco DESFAZ a seleção do editor — o negrito sairia aplicado a
      // nada. Com `preventDefault` no `mousedown` a seleção sobrevive.
      onMouseDown={(e) => {
        e.preventDefault();
        aoClicar();
      }}
    >
      {children}
    </button>
  );
}

export function EditorRico({
  valorInicial,
  semente,
  aoMudar,
  desativado,
  placeholder = "Adicione uma descrição, ou digite '/' para inserir",
  minAltura,
  aoAnexarImagens,
}: {
  valorInicial: string;
  /** Trocar isto reescreve o editor. Ver o cabeçalho: é o que evita o cursor pular. */
  semente: string | number;
  aoMudar: (markdown: string) => void;
  desativado?: boolean;
  placeholder?: string;
  minAltura?: string;
  aoAnexarImagens?: (arquivos: File[]) => Promise<string[]>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const colarSemFormato = useRef(false);
  const arquivoInput = useRef<HTMLInputElement>(null);
  const imagemRange = useRef<Range | null>(null);
  const geracaoImagem = useRef(0);
  const enviandoImagemRef = useRef(false);
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [imagens, setImagens] = useState('');
  const [erroImagem, setErroImagem] = useState<string | null>(null);

  const [flutua, setFlutua] = useState<Flutuante | null>(null);
  const [menuDeEstilo, setMenuDeEstilo] = useState(false);
  /** Os endereços do briefing, para os cartões de baixo. Ver `anotarLinks`. */
  const [enderecos, setEnderecos] = useState<readonly string[]>([]);
  const [destaque, setDestaque] = useState(0);
  const [endereco, setEndereco] = useState('');
  const intervaloGuardado = useRef<Range | null>(null);

  /**
   * O modo aberto, também num `ref` — e atualizado NA MESMA LINHA do estado.
   *
   * Duas razões, e as duas já morderam:
   *
   *   1. O ouvinte de `selectionchange` é registrado uma vez e precisa saber o
   *      que está aberto AGORA. Lê-lo do estado capturado no fechamento daria
   *      sempre o valor do primeiro desenho.
   *
   *   2. `selectionchange` é despachado de forma ASSÍNCRONA. Escolher `Emoji`
   *      no menu `/` apaga o `/emoji` do texto — o que muda a seleção — e a
   *      grade de emoji abre no mesmo gesto. Se o `ref` só fosse atualizado no
   *      efeito, o ouvinte poderia rodar antes dele, ver `barra` como modo
   *      aberto, não achar mais a barra no texto e FECHAR a grade que acabara
   *      de abrir.
   */
  const modoAberto = useRef<ModoFlutuante | null>(null);

  const mostrar = useCallback((f: Flutuante | null) => {
    modoAberto.current = f?.modo ?? null;
    setFlutua(f);
    if (f === null || f.modo !== 'selecao') setMenuDeEstilo(false);
  }, []);

  const fecharFlutuante = useCallback(() => mostrar(null), [mostrar]);

  /**
   * OS LINKS DO BRIEFING, para os cartões de prévia — F17.21.
   *
   * ⚠️ SÓ TROCA O ESTADO QUANDO O CONJUNTO MUDA.
   *   `avisar` roda a cada tecla. Guardar a lista sem comparar faria um desenho
   *   por caractere digitado, e o `contenteditable` já é a peça mais sensível
   *   desta tela a desenho de sobra. Comparar duas listas curtas de texto custa
   *   menos que um desenho, e o caso comum — digitar uma frase sem link — não
   *   troca nada.
   */
  const anotarLinks = useCallback((markdown: string) => {
    setImagens(imagensDoTexto(markdown).join(','));
    const achados = linksDoTexto(markdown);
    setEnderecos((antes) => (antes.join('\n') === achados.join('\n') ? antes : achados));
  }, []);

  /* --- carregar, uma vez por documento ---------------------------------- */

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    preencher(el, markdownParaNos(valorInicial), el.ownerDocument);
    el.setAttribute('data-vazio', String(valorInicial.trim() === ''));
    // Os cartões da tarefa que ACABOU de abrir. Sem isto eles só apareceriam
    // depois da primeira tecla — e ninguém digita para ver o que já está lá.
    anotarLinks(valorInicial);
    // `valorInicial` de propósito FORA das dependências: ele muda a cada tecla
    // no pai, e recarregar aqui apagaria o que está sendo digitado. Quem diz
    // "é outro documento" é a semente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semente]);

  useEffect(() => {
    const geracao = ++geracaoImagem.current;
    enviandoImagemRef.current = false;
    setEnviandoImagem(false);
    setErroImagem(null);
    return () => { geracaoImagem.current = geracao + 1; };
  }, [semente]);

  useEffect(() => {
    let vivo = true;
    const ids = imagens ? imagens.split(',') : [];
    if (!ids.length) return;
    void api.enderecosDosAnexos(ids).then((r) => {
      if (!vivo) return;
      ref.current?.querySelectorAll<HTMLImageElement>('img[data-attachment-id]').forEach((img) => {
        const url = r.urls[img.dataset.attachmentId ?? '']?.url;
        if (url) {
          img.referrerPolicy = 'no-referrer';
          img.src = url;
          img.onerror = () => { img.removeAttribute('src'); img.alt = 'Imagem expirada ou indisponível.'; };
        } else {
          img.removeAttribute('src');
          img.alt = 'Imagem expirada ou indisponível.';
        }
      });
    }).catch(() => { if (vivo) setErroImagem('Não foi possível carregar as imagens. Reabra a tarefa para tentar novamente.'); });
    return () => { vivo = false; };
  }, [imagens, semente]);

  /* --- normalizar e avisar ---------------------------------------------- */

  /**
   * A caixa de seleção sobrevive ao Enter.
   *
   * Ao dividir um `li`, o navegador copia o ATRIBUTO mas não necessariamente a
   * marca — ou copia as duas coisas e sobra marca. Esta passada faz as duas
   * convergirem depois de qualquer edição, e é o que impede a lista de tarefas
   * de virar meia lista de tarefas.
   */
  const normalizar = useCallback((el: HTMLElement) => {
    const doc = el.ownerDocument;
    el.querySelectorAll('a[href]').forEach((link) => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.setAttribute('title', 'Clique para abrir · Alt/Option + clique para editar o link');
    });
    el.querySelectorAll('li').forEach((li) => {
      const marcas = [...li.querySelectorAll(':scope > .cu-caixa')];
      const temAtributo = li.hasAttribute('data-caixa');

      if (marcas.length > 0) {
        const primeira = marcas[0];
        for (const extra of marcas.slice(1)) extra.remove();
        if (li.firstChild !== primeira) li.insertBefore(primeira, li.firstChild);
        li.setAttribute('data-caixa', primeira.getAttribute('data-caixa') === '1' ? '1' : '0');
        return;
      }
      if (temAtributo) {
        li.insertBefore(marcaDeCaixa(li.getAttribute('data-caixa') === '1', doc), li.firstChild);
      }
    });
  }, []);

  const avisar = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    normalizar(el);
    const vazio = el.textContent?.trim() === '' && el.querySelector('table, hr, img') === null;
    el.setAttribute('data-vazio', String(vazio));
    const markdown = vazio ? '' : nosParaMarkdown(lerNos(el));
    anotarLinks(markdown);
    aoMudar(markdown);
  }, [anotarLinks, aoMudar, normalizar]);
  const mencoes = useMencoes(ref, avisar, desativado || enviandoImagem);

  /* --- a bolha e o menu `/`, que vêm da SELEÇÃO --------------------------- */

  /**
   * Um só ouvinte decide os dois: seleção viva abre a bolha, cursor parado
   * depois de um `/` abre o menu de comandos, e nada disso abre nada.
   *
   * `selectionchange` é o evento certo porque ele cobre TODAS as formas de
   * mexer na seleção — mouse, teclado, `execCommand`, colar — e escutar `mouseup`
   * mais `keyup` deixaria de fora justamente a seleção feita por
   * `Ctrl+Shift+seta`.
   */
  const olharSelecao = useCallback(() => {
    if (desativado === true) return;
    const el = ref.current;
    if (!el) return;

    const modo = modoAberto.current;
    // Emoji e link foram abertos por escolha de quem estava editando: eles
    // fecham quando a pessoa escolhe ou desiste, nunca porque a seleção mudou —
    // o campo de endereço do link TEM que roubar o foco para ser digitado.
    if (modo === 'emoji' || modo === 'link') return;

    const s = selecao();
    if (!s || s.rangeCount === 0 || !el.contains(s.getRangeAt(0).startContainer)) {
      if (modo !== null) fecharFlutuante();
      return;
    }

    const r = s.getRangeAt(0);

    if (!r.collapsed && s.toString().trim() !== '') {
      const onde = ondeAncorar(el, 'cima');
      if (onde) mostrar({ modo: 'selecao', ...onde, consulta: '' });
      return;
    }

    // Cursor parado: só a barra abre menu, e só no começo de palavra. A regra
    // inteira — e o porquê de `24/08` não abrir nada — está em
    // `barra-de-comandos.ts`.
    const no = r.startContainer;
    const barra =
      no.nodeType === Node.TEXT_NODE
        ? acharBarra((no.nodeValue ?? '').slice(0, r.startOffset))
        : null;

    if (barra !== null) {
      const onde = ondeAncorar(el, 'baixo');
      if (onde) {
        mostrar({ modo: 'barra', ...onde, consulta: barra.consulta });
        setDestaque(0);
      }
      return;
    }

    if (modo !== null) fecharFlutuante();
  }, [desativado, fecharFlutuante, mostrar]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('selectionchange', olharSelecao);

    // ⚠️ O BALÃO É `position: fixed`, E FIXO NÃO ACOMPANHA ROLAGEM.
    //   Sem estes dois, rolar o corpo do modal deixaria o menu parado no ar
    //   enquanto o texto passa por baixo. `capture` porque quem rola é
    //   `.cu-corpo`, um elemento interno — evento de rolagem de elemento não
    //   sobe até `window` na fase de borbulha.
    window.addEventListener('scroll', olharSelecao, { capture: true, passive: true });
    window.addEventListener('resize', olharSelecao, { passive: true });

    return () => {
      document.removeEventListener('selectionchange', olharSelecao);
      window.removeEventListener('scroll', olharSelecao, { capture: true });
      window.removeEventListener('resize', olharSelecao);
    };
  }, [olharSelecao]);

  /* --- comandos ---------------------------------------------------------- */

  const focar = () => ref.current?.focus();

  const comando = useCallback(
    (nome: string, valor?: string) => {
      focar();
      document.execCommand(nome, false, valor);
      avisar();
    },
    [avisar],
  );

  const guardarIntervalo = () => {
    const s = selecao();
    intervaloGuardado.current = s && s.rangeCount > 0 ? s.getRangeAt(0).cloneRange() : null;
  };

  const restaurarIntervalo = () => {
    const s = selecao();
    const r = intervaloGuardado.current;
    if (!s || !r) return;
    s.removeAllRanges();
    s.addRange(r);
  };

  const inserirNo = useCallback(
    (construir: (doc: Document) => Node) => {
      const el = ref.current;
      if (!el) return;
      focar();
      inserir(el, construir(el.ownerDocument));
      avisar();
    },
    [avisar],
  );

  /** A lista de tarefas: `- [ ]` no ClickUp, `li[data-caixa]` aqui. */
  const alternarCaixas = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    focar();
    let alvo = elementoDaSelecao(el)?.closest('li') ?? null;
    if (alvo === null) {
      document.execCommand('insertUnorderedList');
      alvo = elementoDaSelecao(el)?.closest('li') ?? null;
    }
    if (alvo === null) return;

    if (alvo.hasAttribute('data-caixa')) {
      alvo.removeAttribute('data-caixa');
      alvo.querySelectorAll(':scope > .cu-caixa').forEach((m) => m.remove());
    } else {
      alvo.setAttribute('data-caixa', '0');
    }
    avisar();
  }, [avisar]);

  const inserirTabela = useCallback(() => {
    inserirNo((doc) => {
      const frag = doc.createDocumentFragment();
      frag.appendChild(
        criarNo(
          elemento('table', [
            elemento('thead', [
              elemento('tr', [
                elemento('th', [texto('Coluna')]),
                elemento('th', [texto('Coluna')]),
                elemento('th', [texto('Coluna')]),
              ]),
            ]),
            elemento('tbody', [
              elemento('tr', [elemento('td'), elemento('td'), elemento('td')]),
              elemento('tr', [elemento('td'), elemento('td'), elemento('td')]),
            ]),
          ]),
          doc,
        ),
      );
      // Um parágrafo depois da tabela, senão não há para onde levar o cursor —
      // tabela no fim do documento vira uma parede.
      frag.appendChild(criarNo(elemento('p'), doc));
      return frag;
    });
  }, [inserirNo]);

  const inserirRegra = useCallback(() => {
    inserirNo((doc) => {
      const frag = doc.createDocumentFragment();
      frag.appendChild(criarNo(elemento('hr'), doc));
      frag.appendChild(criarNo(elemento('p'), doc));
      return frag;
    });
  }, [inserirNo]);

  const codigoEmLinha = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    focar();
    const s = selecao();
    if (!s || s.rangeCount === 0) return;
    const r = s.getRangeAt(0);
    const dentro = r.toString();
    if (dentro === '') return;
    r.deleteContents();
    const code = el.ownerDocument.createElement('code');
    code.textContent = dentro;
    r.insertNode(code);
    r.setStartAfter(code);
    r.collapse(true);
    s.removeAllRanges();
    s.addRange(r);
    avisar();
  }, [avisar]);

  const aplicarLink = useCallback(() => {
    const alvo = enderecoSeguro(endereco);
    fecharFlutuante();
    setEndereco('');
    if (alvo === null) return;
    focar();
    restaurarIntervalo();
    document.execCommand('createLink', false, alvo);
    avisar();
  }, [endereco, avisar, fecharFlutuante]);

  const abrirLink = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const link = elementoDaSelecao(el)?.closest('a[href]');
    if (link && el.contains(link)) {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(link);
      const selection = selecao();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    setEndereco(link?.getAttribute('href') ?? '');
    guardarIntervalo();
    const onde = ondeAncorar(el, 'baixo') ?? { x: 0, y: 0, lado: 'baixo' as const };
    mostrar({ modo: 'link', ...onde, consulta: '' });
  }, [mostrar]);

  /**
   * Um comando da bolha — venha ele do botão ou do atalho de teclado.
   *
   * O BOTÃO E O ATALHO CHEGAM AQUI PELO MESMO CAMINHO, e é isso que impede os
   * dois de divergirem. Antes desta etapa `Ctrl+B` e o botão `B` chamavam
   * `comando('bold')` em dois lugares diferentes do arquivo.
   */
  const agirNaSelecao = useCallback(
    (chave: ChaveDeSelecao) => {
      switch (chave) {
        case 'negrito':
          comando('bold');
          return;
        case 'italico':
          comando('italic');
          return;
        case 'riscado':
          comando('strikeThrough');
          return;
        case 'codigo':
          codigoEmLinha();
          return;
        case 'link':
          abrirLink();
          return;
        case 'estilo':
          setMenuDeEstilo((v) => !v);
          return;
      }
    },
    [comando, codigoEmLinha, abrirLink],
  );

  /* --- o menu `/` -------------------------------------------------------- */

  const comandos = useMemo(
    () => (flutua?.modo === 'barra' ? filtrarComandos(flutua.consulta) : []),
    [flutua],
  );
  const escolhido = comandos.length === 0 ? 0 : Math.min(destaque, comandos.length - 1);

  /**
   * Apaga o `/consulta` que abriu o menu.
   *
   * Ele foi um ATALHO, não texto do briefing — deixá-lo no documento faria toda
   * tabela inserida pelo menu nascer precedida de `/tabela`. O intervalo é
   * relido do DOM na hora, e não guardado no estado: entre abrir o menu e
   * escolher, a pessoa pode ter digitado mais letras.
   */
  const apagarBarra = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const s = selecao();
    if (!s || s.rangeCount === 0) return;
    const r = s.getRangeAt(0);
    const no = r.startContainer;
    if (no.nodeType !== Node.TEXT_NODE || !el.contains(no)) return;

    const t = no as Text;
    const achado = acharBarra((t.nodeValue ?? '').slice(0, r.startOffset));
    if (achado === null) return;

    t.deleteData(achado.inicio, r.startOffset - achado.inicio);
    const novo = el.ownerDocument.createRange();
    novo.setStart(t, achado.inicio);
    novo.collapse(true);
    s.removeAllRanges();
    s.addRange(novo);
  }, []);

  const executar = useCallback(
    (chave: ChaveDeComando) => {
      switch (chave) {
        case 'p':
          comando('formatBlock', '<p>');
          return;
        case 'h1':
          comando('formatBlock', '<h1>');
          return;
        case 'h2':
          comando('formatBlock', '<h2>');
          return;
        case 'h3':
          comando('formatBlock', '<h3>');
          return;
        case 'citacao':
          comando('formatBlock', '<blockquote>');
          return;
        case 'codigo':
          comando('formatBlock', '<pre>');
          return;
        case 'marcador':
          comando('insertUnorderedList');
          return;
        case 'numerada':
          comando('insertOrderedList');
          return;
        case 'caixas':
          alternarCaixas();
          return;
        case 'tabela':
          inserirTabela();
          return;
        case 'regra':
          inserirRegra();
          return;
        case 'emoji':
          // O único que não age sozinho: ele TROCA o menu pela grade de emoji.
          // Quem faz essa troca é `usarComando`, porque ela precisa acontecer
          // DEPOIS de o `/emoji` sair do texto — e o `switch` aqui não tem
          // como saber disso. Um `case` que não faz nada é melhor que um
          // `default` calado: valor novo no enum passa a quebrar a compilação.
          return;
      }
    },
    [comando, alternarCaixas, inserirTabela, inserirRegra],
  );

  const usarComando = useCallback(
    (chave: ChaveDeComando) => {
      focar();
      // O `/consulta` sai ANTES do comando: inserir a tabela primeiro deixaria
      // `/tabela` escrito acima dela para sempre.
      apagarBarra();

      if (chave === 'emoji') {
        const el = ref.current;
        const onde = el ? ondeAncorar(el, 'baixo') : null;
        mostrar({
          modo: 'emoji',
          ...(onde ?? { x: 0, y: 0, lado: 'baixo' as const }),
          consulta: '',
        });
        avisar();
        return;
      }

      fecharFlutuante();
      executar(chave);
      avisar();
    },
    [apagarBarra, executar, avisar, fecharFlutuante, mostrar],
  );

  const anexarImagens = useCallback(async (arquivos: File[]) => {
    const el = ref.current;
    if (!el || !aoAnexarImagens || desativado || enviandoImagemRef.current) return;
    const geracao = geracaoImagem.current;
    enviandoImagemRef.current = true;
    setEnviandoImagem(true);
    setErroImagem(null);
    const range = imagemRange.current;
    try {
      const ids = await aoAnexarImagens(arquivos);
      if (geracao !== geracaoImagem.current) return;
      if (!ids.length) return;
      el.focus();
      if (range && el.contains(range.startContainer)) {
        const sel = selecao();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      const fragmento = el.ownerDocument.createDocumentFragment();
      for (const id of ids) {
        fragmento.appendChild(criarNo(elemento('img', [], { attachmentId: id, alt: 'Imagem anexada' }), el.ownerDocument));
        fragmento.appendChild(el.ownerDocument.createElement('br'));
      }
      inserir(el, fragmento);
      avisar();
    } catch {
      if (geracao === geracaoImagem.current) setErroImagem('Não foi possível enviar a imagem. Tente novamente.');
    } finally {
      if (geracao === geracaoImagem.current) {
        enviandoImagemRef.current = false;
        setEnviandoImagem(false);
      }
    }
  }, [aoAnexarImagens, avisar, desativado]);

  /* --- colar: estrutura formatada segura, com fallback para texto -------- */

  const colar = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = ref.current;
      const semFormato = colarSemFormato.current;
      colarSemFormato.current = false;
      if (!el || desativado || enviandoImagemRef.current) return;

      if (aoAnexarImagens && deveAnexar(Array.from(e.clipboardData.items).map((i) => ({ kind: i.kind, type: i.type })))) {
        const sel = selecao();
        imagemRange.current = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        void anexarImagens(Array.from(e.clipboardData.files).filter((f) => ehTipoQueSeCola(f.type)));
        return;
      }

      const nos = conteudoColado(
        e.clipboardData.getData('text/html'),
        e.clipboardData.getData('text/plain'),
        el.ownerDocument,
        semFormato,
      );
      inserirColagem(el, nos);
      avisar();
    },
    [avisar, aoAnexarImagens, anexarImagens, desativado],
  );

  /* --- teclado ----------------------------------------------------------- */

  const teclas = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      /*
        O MENU `/` ANDA PELO TECLADO A PARTIR DAQUI, e não de dentro do balão.

        O balão abre SEM FOCO — se ele tomasse o foco, a pessoa não conseguiria
        continuar digitando o que filtra o menu. Como o foco fica no editor, é o
        editor que precisa entender ↑ ↓ Enter e Esc enquanto o menu está aberto.
      */
      if (flutua?.modo === 'barra' && comandos.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const passo = e.key === 'ArrowDown' ? 1 : -1;
          setDestaque((d) => {
            const base = Math.min(d, comandos.length - 1);
            return (base + passo + comandos.length) % comandos.length;
          });
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          usarComando(comandos[escolhido].chave);
          return;
        }
      }

      if (e.key === 'Escape' && flutua !== null) {
        // ⚠️ `stopPropagation` OBRIGATÓRIO: sem ele o `Esc` sobe até o modal e
        // minimiza a tarefa inteira. Fechar um menu e fechar a janela não podem
        // ser o mesmo gesto.
        e.preventDefault();
        e.stopPropagation();
        fecharFlutuante();
        return;
      }

      /*
        OS ATALHOS SAEM DO MESMO CATÁLOGO QUE A BOLHA.

        `atalhoDeTecla` é função pura, em `barra-de-comandos.ts`, e o teste da
        etapa passa cada combinação por ela. É o que garante que tirar a faixa
        fixa da tela não tirou `Ctrl+B`, `Ctrl+I`, `Ctrl+Shift+X` nem
        `Ctrl+K` junto — a preocupação declarada desta etapa.
      */
      const atalho = atalhoDeTecla(e);
      if (atalho !== null) {
        e.preventDefault();
        agirNaSelecao(atalho);
        return;
      }

      if (!e.nativeEvent.isComposing && (e.key === ' ' || e.key === 'Enter') && ref.current) {
        linkifyAtCursor(ref.current);
      }

      // Tab dentro de tabela anda de célula, e na última cria linha. É o gesto
      // que o ClickUp tem e sem o qual tabela em editor rico não se preenche.
      if (e.key === 'Tab' && ref.current) {
        const celula = elementoDaSelecao(ref.current)?.closest('td, th');
        if (!celula) return;
        e.preventDefault();
        const todas = [...(ref.current.querySelectorAll('td, th') ?? [])];
        const i = todas.indexOf(celula);
        const proxima = todas[i + (e.shiftKey ? -1 : 1)];
        if (proxima) {
          const r = ref.current.ownerDocument.createRange();
          r.selectNodeContents(proxima);
          r.collapse(true);
          const s = selecao();
          s?.removeAllRanges();
          s?.addRange(r);
          return;
        }
        if (e.shiftKey) return;

        const linha = celula.closest('tr');
        const corpo = linha?.parentElement;
        if (!linha || !corpo) return;
        const nova = ref.current.ownerDocument.createElement('tr');
        for (let k = 0; k < linha.children.length; k += 1) {
          nova.appendChild(criarNo(elemento('td'), ref.current.ownerDocument));
        }
        corpo.appendChild(nova);
        const r = ref.current.ownerDocument.createRange();
        r.selectNodeContents(nova.firstChild as Node);
        r.collapse(true);
        const s = selecao();
        s?.removeAllRanges();
        s?.addRange(r);
        avisar();
      }
    },
    [avisar, agirNaSelecao, flutua, comandos, escolhido, usarComando, fecharFlutuante],
  );

  // O mousedown ocorre antes de o navegador pôr o cursor no texto do link.
  const linkMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest?.('a[href]')) e.preventDefault();
  }, []);

  /** Clique abre o link; Alt/Option + clique permite editar o endereço. */
  const clique = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const link = (e.target as HTMLElement).closest?.('a[href]');
      if (link) {
        e.preventDefault();
        e.stopPropagation();

        if (e.altKey && !desativado) {
          const range = link.ownerDocument.createRange();
          range.selectNodeContents(link);
          const selection = selecao();
          selection?.removeAllRanges();
          selection?.addRange(range);
          abrirLink();
          return;
        }
        const href = enderecoSeguro(link.getAttribute('href') ?? '');
        if (href) {
          fecharFlutuante();
          void window.open(href, '_blank', 'noopener,noreferrer');
        }

        return;
      }

      const marca = (e.target as HTMLElement).closest?.('.cu-caixa');
      if (!marca) return;
      e.preventDefault();
      const marcada = marca.getAttribute('data-caixa') === '1';
      marca.setAttribute('data-caixa', marcada ? '0' : '1');
      marca.setAttribute('aria-checked', marcada ? 'false' : 'true');
      marca.textContent = marcada ? '' : '✓';
      marca.closest('li')?.setAttribute('data-caixa', marcada ? '0' : '1');
      avisar();
    },
    [avisar, abrirLink, desativado, fecharFlutuante],
  );

  /**
   * Sair do editor salva e recolhe o que flutuava.
   *
   * `emoji` e `link` NÃO se recolhem aqui: o campo de endereço do link precisa
   * do foco para ser digitado, e tirá-lo do editor dispara este `blur`. Fechar
   * o painel no gesto de alcançá-lo seria uma porta que se fecha na mão.
   */
  const aoSair = useCallback(() => {
    if (!desativado && ref.current) linkifyAtCursor(ref.current);
    avisar();
    const modo = modoAberto.current;
    if (modo === 'selecao' || modo === 'barra') fecharFlutuante();
  }, [avisar, desativado, fecharFlutuante]);

  /* --- desenho ------------------------------------------------------------ */

  /**
   * A bolha é DESENHADA a partir do catálogo, e não escrita à mão.
   *
   * O catálogo é o mesmo que resolve os atalhos de teclado — ver
   * `atalhoDeTecla`. Um comando tirado de lá some do botão e do atalho juntos,
   * e o teste da etapa acusa; escrever a barra à mão permitiria que os dois
   * divergissem em silêncio, que é exatamente o risco de mexer numa barra que
   * acabou de mudar de forma.
   */
  const bolhaDeSelecao = (
    <Balao className="cu-balao-formatacao" lado={flutua?.lado ?? 'cima'} semFoco aoFechar={fecharFlutuante}>
      <div className="cu-bolha">
        {COMANDOS_DE_SELECAO.map((c) => (
          <Fragment key={c.chave}>
            {c.fio === true && <span className="cu-sep-vertical" />}

            {c.chave === 'estilo' ? (
              <span className="cu-ancora">
                <button
                  type="button"
                  className="cu-ferramenta"
                  aria-expanded={menuDeEstilo}
                  title={rotuloDeSelecao(c)}
                  aria-label={rotuloDeSelecao(c)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMenuDeEstilo((v) => !v)}
                >
                  Aa
                  <IconeSeta />
                </button>
                {menuDeEstilo && (
                  <Balao
                    className="cu-menu-estilos"
                    lado="baixo"
                    semFoco
                    aoFechar={() => setMenuDeEstilo(false)}
                    rotulo="Transformar em"
                  >
                    {ESTILOS_DE_BLOCO.map((x) => (
                      <button
                        key={x.chave}
                        type="button"
                        data-item="1"
                        className="cu-item"
                        onMouseDown={(e) => {
                          // Mesmo motivo do `Ferramenta`: mudar o foco desfaz a
                          // seleção, e o estilo sairia aplicado a nada.
                          e.preventDefault();
                          setMenuDeEstilo(false);
                          executar(x.chave);
                        }}
                      >
                        <span className="cu-marca-comando" aria-hidden="true">{x.marca}</span>
                        {x.rotulo}
                      </button>
                    ))}
                  </Balao>
                )}
              </span>
            ) : (
              <Ferramenta titulo={rotuloDeSelecao(c)} aoClicar={() => agirNaSelecao(c.chave)}>
                {MARCA_DA_SELECAO[c.chave]}
              </Ferramenta>
            )}
          </Fragment>
        ))}
      </div>
    </Balao>
  );

  const menuDaBarra = (
    <Balao lado={flutua?.lado ?? 'baixo'} semFoco aoFechar={fecharFlutuante} rotulo="Comandos">
      {comandos.length === 0 && (
        <p className="cu-vazio">
          Nada com esse nome. Apague o que veio depois da barra para ver a lista inteira.
        </p>
      )}
      <div className="cu-rolagem">
        {comandos.map((c, i) => (
          <button
            key={c.chave}
            type="button"
            data-item="1"
            className="cu-item"
            data-ativo={i === escolhido}
            // Mesmo motivo do `Ferramenta`: clicar não pode tirar o foco do
            // editor, senão o comando age sobre o botão.
            onMouseDown={(e) => {
              e.preventDefault();
              usarComando(c.chave);
            }}
          >
            <span className="cu-marca-comando" aria-hidden="true">
              {c.marca}
            </span>
            {c.rotulo}
          </button>
        ))}
      </div>
    </Balao>
  );

  const gradeDeEmoji = (
    <Balao lado={flutua?.lado ?? 'baixo'} semFoco aoFechar={fecharFlutuante} rotulo="Emoji">
      <div className="cu-emojis">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            data-item="1"
            className="cu-ferramenta"
            onMouseDown={(x) => {
              x.preventDefault();
              fecharFlutuante();
              inserirNo((doc) => doc.createTextNode(e));
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </Balao>
  );

  const campoDeLink = (
    <Balao lado={flutua?.lado ?? 'baixo'} aoFechar={fecharFlutuante} rotulo="Endereço do link">
      <input
        className="cu-busca"
        data-foco="1"
        value={endereco}
        placeholder="https://…"
        aria-label="Endereço do link"
        onChange={(e) => setEndereco(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            fecharFlutuante();
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          aplicarLink();
        }}
      />
      <button type="button" data-item="1" className="cu-item" onClick={aplicarLink}>
        Aplicar ao texto selecionado
      </button>
      {/* A LISTA DE ESQUEMAS VIROU `?` — F17.24. Ela é verdadeira e importa,
          mas ninguém que vai colar um endereço do Dropbox precisa ler sobre
          `mailto` e `javascript:` antes. O aviso continua a um clique. */}
      <p className="cu-vazio cu-com-ajuda">
        <span>Endereço da web, ou caminho do próprio sistema.</span>
        <Ajuda sobre="os endereços aceitos" lado="baixo">
          <p>
            Passam <b>http</b>, <b>https</b>, <b>mailto</b>, <b>tel</b> e caminho relativo.
          </p>
          <p>
            O resto é recusado: <b>javascript:</b> num link é um clique que executa código.
          </p>
        </Ajuda>
      </p>
    </Balao>
  );

  return (
    <div className="cu-editor-caixa">
      <div
        ref={ref}
        className="cu-editor"
        role="textbox"
        aria-multiline="true"
        aria-label="Descrição da tarefa"
        contentEditable={!desativado && !enviandoImagem}
        suppressContentEditableWarning
        spellCheck
        data-vazio-texto={placeholder}
        style={minAltura ? { minHeight: minAltura } : undefined}
        onInput={() => { avisar(); mencoes.olhar(); }}
        onBlur={() => { colarSemFormato.current = false; aoSair(); }}
        onPaste={colar}
        onKeyDown={(e) => {
          colarSemFormato.current = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v';
          if (!mencoes.teclas(e)) teclas(e);
        }}
        onKeyUp={(e) => { colarSemFormato.current = false; if (!['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.key)) mencoes.olhar(); }}
        onMouseDown={linkMouseDown}
        onClick={clique}
      />

      {mencoes.menu}
      {aoAnexarImagens && <div className="editor-inserir-imagem">
        <input ref={arquivoInput} type="file" accept="image/png,image/jpeg" multiple hidden
          aria-label="Selecionar imagens para a descrição"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (arquivos.length) void anexarImagens(arquivos);
          }} />
        <button type="button" className="o-btn o-btn-fantasma o-btn-icone" disabled={desativado || enviandoImagem}
          aria-label="Inserir imagem" aria-busy={enviandoImagem}
          title="Inserir imagem · PNG ou JPEG, até 5 MB · disponível por 10 dias"
          onMouseDown={(e) => {
            e.preventDefault();
            const sel = selecao();
            imagemRange.current = sel?.rangeCount && ref.current?.contains(sel.getRangeAt(0).startContainer)
              ? sel.getRangeAt(0).cloneRange() : null;
          }}
          onClick={() => arquivoInput.current?.click()}>
          <IconeClipe />
        </button>
        <span className="a-nota" role={enviandoImagem ? 'status' : undefined}>
          {enviandoImagem ? 'Enviando imagem…' : 'Cole um print ou use o clipe · até 5 MB · disponível por 10 dias'}
        </span>
      </div>}
      {erroImagem && <p className="a-erro" role="alert">{erroImagem}</p>}

      {/*
        OS CARTÕES DO BRIEFING — F17.21.

        ⚠️ IRMÃOS DO EDITÁVEL, NUNCA FILHOS, e por três motivos que se somam:

          1. Dentro de um `contenteditable` eles virariam CONTEÚDO EDITÁVEL: dava
             para pôr o cursor no meio do cartão e apagá-lo com a tecla de
             espaço. E `nosParaMarkdown` os leria de volta como texto do
             briefing, gravando no banco a peça que a tela desenhou.
          2. Montar e desmontar um cartão mexeria na árvore que o cursor habita,
             e o cursor pularia — a mesma razão que já põe a bolha e o menu `/`
             aqui fora.
          3. `<a>` DENTRO DE `<a>`: o texto do editor já desenha o link como
             `<a>`; um cartão clicável ali dentro seria o segundo.

        O texto também abre o destino: o tratamento do mouse acima impede
        que o clique de navegação posicione o cursor dentro do link.
      */}
      <PreviasDeLink enderecos={enderecos} teto={TETO_NO_TEXTO} />

      {/*
        A ÂNCORA FLUTUANTE. Ela é irmã do editável, nunca filha: um balão dentro
        do `contenteditable` viraria conteúdo editável, e montá-lo mexeria na
        árvore que o cursor habita.

        Ela tem tamanho zero e é `position: fixed` nas coordenadas de JANELA da
        seleção — é assim que o balão sai do `overflow` do corpo do modal. Quem o
        posiciona em relação a ela é o `data-lado` do `Balao`, que já existia.
      */}
      {desativado !== true && flutua !== null && (
        <span
          className="cu-ancora cu-flutua"
          style={{ left: `${flutua.x}px`, top: `${flutua.y}px` }}
        >
          {flutua.modo === 'selecao' && bolhaDeSelecao}
          {flutua.modo === 'barra' && menuDaBarra}
          {flutua.modo === 'emoji' && gradeDeEmoji}
          {flutua.modo === 'link' && campoDeLink}
        </span>
      )}
    </div>
  );
}
