/**
 * O menu `/` do editor de descrição — a parte PURA. Etapa F17.16.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE MENU PASSOU A EXISTIR NO EDITOR
 *
 *   A F17.16 tirou a faixa de formatação do estado normal: ela virou balão
 *   flutuante, e balão flutuante só aparece quando há TEXTO SELECIONADO. Isso
 *   resolve o que o usuário apontou — *"no ClickUp o modal é limpo"* — e cria um
 *   buraco: `inserir tabela`, `regra horizontal` e `emoji` não agem sobre
 *   seleção nenhuma. São INSERÇÕES, feitas com o cursor parado num ponto vazio,
 *   que é exatamente o momento em que a bolha de seleção não existe.
 *
 *   Sem um segundo caminho, esses três comandos ficariam inalcançáveis pela
 *   tela. Tirar função para melhorar aparência seria pior do que a faixa que se
 *   quis tirar.
 *
 *   O ClickUp resolve isso com o menu `/`, e a linha de subtarefa da F17.15 já
 *   tem um — mesma gramática, mesmo gesto, mesma frase de convite. Então o
 *   editor de descrição ganha o dele, e é aqui que ele mora.
 *
 * O CATÁLOGO É MAIOR QUE OS TRÊS ÓRFÃOS, DE PROPÓSITO
 *   Um menu `/` com três linhas seria uma gaveta de sobras. Ele traz também o
 *   que se faz com o cursor parado no começo de um bloco — título, citação,
 *   bloco de código, as três listas —, que é o conjunto que o `/` do ClickUp
 *   oferece. Nenhum deles some da bolha de seleção: os dois caminhos coexistem,
 *   como na referência.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POR QUE ISTO É UM ARQUIVO SEM DOM
 *   A suíte roda em ambiente `node`, sem navegador. Detecção do `/`, recorte da
 *   consulta e filtro dos comandos são texto puro — e por serem texto puro são
 *   testáveis. O que sobra em `EditorRico.tsx` é só `Range` e `Selection`, que
 *   é navegador de verdade e vai na conferência do usuário.
 */

/** O que uma linha do menu `/` faz quando é escolhida. */
export type ChaveDeComando =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'citacao'
  | 'codigo'
  | 'marcador'
  | 'numerada'
  | 'caixas'
  | 'tabela'
  | 'regra'
  | 'emoji';

export type ComandoDoEditor = {
  chave: ChaveDeComando;
  rotulo: string;
  /**
   * O que mais encontra este comando na busca.
   *
   * Quem digita `/` está com pressa e escreve o que tem na cabeça, não o rótulo
   * da tela: `/tab` para tabela, `/check` para a lista de caixinhas, `/hr` para
   * a regra. Sinônimo é o que evita o menu vazio no meio do gesto.
   */
  termos: string[];
  /** Só para a tela: o desenho pequeno que vai à esquerda do rótulo. */
  marca: string;
};

/**
 * O catálogo, na ordem em que aparece.
 *
 * A ORDEM É A DO USO, não a alfabética: as três listas e os títulos são o que
 * mais se digita num briefing, e tabela/regra/emoji — os três órfãos que
 * motivaram este menu — ficam logo abaixo, sem precisar rolar.
 */
export const COMANDOS_DO_EDITOR: readonly ComandoDoEditor[] = [
  { chave: 'h1', rotulo: 'Título 1', termos: ['titulo', 'h1', 'cabecalho'], marca: 'H1' },
  { chave: 'h2', rotulo: 'Título 2', termos: ['titulo', 'h2', 'cabecalho'], marca: 'H2' },
  { chave: 'h3', rotulo: 'Título 3', termos: ['titulo', 'h3', 'cabecalho'], marca: 'H3' },
  { chave: 'p', rotulo: 'Texto', termos: ['paragrafo', 'normal', 'p'], marca: '¶' },
  {
    chave: 'marcador',
    rotulo: 'Lista com marcador',
    termos: ['lista', 'bullet', 'ul', 'ponto'],
    marca: '•',
  },
  {
    chave: 'numerada',
    rotulo: 'Lista numerada',
    termos: ['lista', 'numero', 'ol', 'ordenada'],
    marca: '1.',
  },
  {
    chave: 'caixas',
    rotulo: 'Lista de tarefas',
    termos: ['checklist', 'check', 'caixa', 'tarefa', 'todo'],
    marca: '☑',
  },
  { chave: 'citacao', rotulo: 'Citação', termos: ['quote', 'citar'], marca: '❝' },
  {
    chave: 'codigo',
    rotulo: 'Bloco de código',
    termos: ['code', 'codigo', 'pre'],
    marca: '{}',
  },
  { chave: 'tabela', rotulo: 'Tabela', termos: ['table', 'grade', 'coluna'], marca: '▦' },
  {
    chave: 'regra',
    rotulo: 'Regra horizontal',
    termos: ['divisor', 'linha', 'hr', 'separador'],
    marca: '—',
  },
  { chave: 'emoji', rotulo: 'Emoji', termos: ['carinha', 'icone', 'smile'], marca: '🙂' },
];

/* ───────────────────────────── a bolha da seleção ───────────────────────── */

/**
 * O que a bolha flutuante faz — e o que os atalhos de teclado fazem.
 *
 * ⚠️ ESTE CATÁLOGO É A GARANTIA DE QUE NENHUM COMANDO SUMIU COM A FAIXA.
 *   A bolha é DESENHADA a partir daqui, e os atalhos são RESOLVIDOS a partir
 *   daqui (`atalhoDeTecla`). Tirar uma linha desta lista tira o botão e o
 *   atalho juntos, de uma vez, e o teste desta etapa acusa — que é muito melhor
 *   do que o botão sumir e o atalho ficar, ou o contrário.
 */
export type ChaveDeSelecao = 'estilo' | 'negrito' | 'italico' | 'riscado' | 'codigo' | 'link';

export type ComandoDeSelecao = {
  chave: ChaveDeSelecao;
  titulo: string;
  /** O atalho, escrito como a pessoa o digita. Nulo quando não há. */
  atalho: string | null;
  /** Um fio antes desta peça, como na barra da referência. */
  fio?: boolean;
};

export const COMANDOS_DE_SELECAO: readonly ComandoDeSelecao[] = [
  // `Aa` — o menu de estilo do bloco. Único que abre um segundo balão.
  { chave: 'estilo', titulo: 'Estilo do parágrafo', atalho: null },
  { chave: 'negrito', titulo: 'Negrito', atalho: 'Ctrl+B', fio: true },
  { chave: 'italico', titulo: 'Itálico', atalho: 'Ctrl+I' },
  { chave: 'riscado', titulo: 'Riscado', atalho: 'Ctrl+Shift+X' },
  { chave: 'codigo', titulo: 'Código', atalho: null },
  { chave: 'link', titulo: 'Link', atalho: 'Ctrl+K', fio: true },
];

/** `Negrito (Ctrl+B)` — o que vai no `title` e no `aria-label`. */
export const rotuloDeSelecao = (c: ComandoDeSelecao): string =>
  c.atalho === null ? c.titulo : `${c.titulo} (${c.atalho})`;

/**
 * A tecla que a pessoa apertou, traduzida em comando.
 *
 * ⚠️ A ORDEM DAS CONFERÊNCIAS É A DA F17.10b, DE PROPÓSITO.
 *   `Ctrl+B` é conferido ANTES de `Ctrl+Shift+X`, e sem excluir `shift`. A
 *   consequência é que `Ctrl+Shift+B` também aplica negrito — comportamento que
 *   já existia e que ninguém pediu para mudar. Reordenar para "arrumar" isso
 *   seria mudar o teclado de quem já usa o sistema publicado numa etapa de
 *   acabamento.
 *
 *   Estar aqui, e não dentro do componente, é o que torna isto conferível sem
 *   navegador: o teste da etapa passa cada combinação por esta função.
 */
export function atalhoDeTecla(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): ChaveDeSelecao | null {
  if (!e.ctrlKey && !e.metaKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'b') return 'negrito';
  if (k === 'i') return 'italico';
  if (e.shiftKey && k === 'x') return 'riscado';
  if (k === 'k') return 'link';
  return null;
}

/**
 * Os comandos que TRANSFORMAM o bloco onde o cursor está.
 *
 * É o menu `Aa` da bolha de seleção: título, texto, citação, bloco de código e
 * as três listas. Eles também estão no menu `/` — e é de propósito, porque são
 * duas perguntas diferentes: `Aa` é *"transforme ISTO que eu selecionei"* e `/`
 * é *"comece uma coisa nova aqui"*. O ClickUp tem os dois caminhos.
 *
 * O que fica de fora são as três INSERÇÕES — tabela, regra, emoji —, que não
 * transformam nada e por isso não fazem sentido num menu de estilo.
 */
export const ESTILOS_DE_BLOCO: readonly ComandoDoEditor[] = COMANDOS_DO_EDITOR.filter(
  (c) => c.chave !== 'tabela' && c.chave !== 'regra' && c.chave !== 'emoji',
);

/* ───────────────────────────── achar o `/` ───────────────────────────── */

/** Onde a barra começou, e o que se digitou depois dela. */
export type BarraNoTexto = {
  /** O índice do `/` dentro do texto recebido — é o que a tela apaga depois. */
  inicio: number;
  /** O que veio depois do `/`, sem espaço. Vazio logo que ele é digitado. */
  consulta: string;
};

/**
 * A barra está aberta?
 *
 * ⚠️ O `/` SÓ ABRE MENU NO COMEÇO DE UMA PALAVRA.
 *   `https://` tem duas barras, `24/08` tem uma, e `a/b` outra. Se qualquer `/`
 *   abrisse o menu, escrever uma data num briefing viraria uma briga com um
 *   balão que não devia estar ali — e briefing real tem data em quase toda
 *   linha (`24/08 - [Reels] Oferta VIP 4`).
 *
 *   Então: só depois de espaço, ou no começo do texto. É a mesma regra do
 *   ClickUp, e é a que faz o menu nunca aparecer sozinho.
 *
 * @param antes o texto do nó ATÉ o cursor — nunca o texto inteiro.
 */
export function acharBarra(antes: string): BarraNoTexto | null {
  // `\s` do JavaScript já inclui o espaço rígido (U+00A0), que é o que o
  // `contenteditable` insere ao teclar espaço no fim da linha.
  const achado = /(?:^|\s)\/([^\s/]*)$/.exec(antes);
  if (achado === null) return null;
  return { inicio: antes.length - achado[1].length - 1, consulta: achado[1] };
}

/* ───────────────────────────── filtrar ───────────────────────────── */

/** Sem acento e em minúsculas: quem digita `/titulo` acha `Título 1`. */
const dobrar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * Os comandos que casam com a consulta.
 *
 * Consulta vazia devolve o catálogo inteiro — o `/` sozinho é "me mostre o que
 * dá para fazer", e responder com nada seria transformar o convite em recusa.
 */
export function filtrarComandos(consulta: string): ComandoDoEditor[] {
  const q = dobrar(consulta);
  if (q === '') return [...COMANDOS_DO_EDITOR];
  return COMANDOS_DO_EDITOR.filter(
    (c) => dobrar(c.rotulo).includes(q) || c.termos.some((t) => dobrar(t).includes(q)),
  );
}
