/**
 * Os menus flutuantes da tarefa — etapa F17.10b.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A GRAMÁTICA, QUE É O PONTO DESTA ETAPA
 *
 *   No ClickUp não existe "campo de prioridade". Existe uma FICHA (chip) escrita
 *   `Prioridade`, e clicar nela abre um MENU ANCORADO NELA, com quatro bandeiras
 *   coloridas e um `Limpar` depois de um fio. Não existe rótulo em cima, não
 *   existe caixa de seleção nativa, não existe botão "aplicar".
 *
 *   A F17.10 entregou `<select>` com `<option>`. Funcionava, e não era o
 *   ClickUp — o usuário abriu, comparou e reprovou. Fidelidade de interação
 *   acima de elegância de código: se a origem abre menu flutuante ancorado no
 *   chip, isto abre menu flutuante ancorado no chip.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE NENHUM DESTES MENUS FAZ
 *   Falar com o banco. Eles recebem o que mostrar e avisam o que a pessoa
 *   escolheu; quem escreve é a página e quem decide é o banco (F17.1..F17.4b).
 *   Um seletor que salva sozinho seria mais um lugar onde a regra pode divergir.
 *
 * COR
 *   Nenhuma literal. A do design system sai de `var(--…)`; a que vem do dado —
 *   status, etiqueta — entra como variável no elemento (decisão D10).
 */

import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  GRUPOS_DE_STATUS,
  GRUPO_DO_TIPO,
  type ListaNaArvore,
  espacosHomonimos,
  nomeDoEspaco,
} from '@/board/arvore';
import {
  type BoardStatus,
  type BoardTag,
  type Day,
  type Priority,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  type TreeSpace,
  initials,
  parseDay,
} from '@/board/board';
import {
  CABECALHO_DA_SEMANA,
  DIA_CURTO,
  ESPERA_DO_DIA_DIGITADO,
  MESES,
  atalhos,
  diaDaSemana,
  diaDigitadoVale,
  gradeDoMes,
  iso,
  mesVizinho,
  mesmoDia,
  nomeDoDia,
} from '@/board/calendario';
import { nomeCasaComABusca } from '@/board/busca-de-nome';
import { corDaPessoa } from '@/board/cor-da-pessoa';
import type { TaskPerson, TaskType } from '@/board/ficha';
import { useDevolverFoco } from '@/ui/foco';
import { type Lado, MARGEM, alturaDesejada, ondeCabe, rolarAteAparecer } from '@/ui/teto';
/**
 * A FOLHA VEM COM AS PEÇAS — dívida registrada da F17.42, paga na F17.45.
 *
 * `Ajuda`, `Balao` e os menus deste arquivo são desenhados por `clickup.css`,
 * e ela era importada pelas PÁGINAS do quadro (`Quadro`, `Espaco`, `Tarefa`…).
 * Em `Pessoas`, `Contas`, `Catalogos` e `Painel`, que não a importam, o `?`
 * aparecia PELADO: sem círculo, sem borda, sem tamanho — um `?` solto no meio
 * da frase. A folha era carregada pela vizinhança, e não pela peça.
 *
 * Importar daqui amarra a folha a quem a usa: quem monta um menu leva o
 * desenho dele junto, em qualquer tela. É a mesma decisão de `SeletorDeDia`.
 */
import '@/ui/clickup.css';

/* ───────────────────────────── ícones ───────────────────────────── */

const traco = (className = 'h-3.5 w-3.5') => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
});

export const IconeLista = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
);

export const IconeCirculo = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);

export const IconePessoa = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20a7 7 0 0114 0" />
  </svg>
);

/**
 * O CLIENTE — F17.43.
 *
 * A maleta, e não a pessoa nem o prédio. `IconePessoa` já é "quem alcança", e
 * o prédio foi o sinal da empresa na trilha até a F31; repetir um dos dois
 * faria o sistema dizer duas coisas com o mesmo desenho, que é o defeito que os
 * três sinais de nível existem para não ter.
 */
export const IconeCliente = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <rect x="3" y="7.5" width="18" height="12" rx="2" />
    <path d="M9 7.5V6a2 2 0 012-2h2a2 2 0 012 2v1.5M3 12.5h18" />
  </svg>
);

export const IconeCalendario = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
  </svg>
);

export const IconeBandeira = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <path d="M5 21V4M5 4h11l-1.6 3.5L16 11H5" />
  </svg>
);

export const IconeEtiqueta = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <path d="M3 12.5V5a2 2 0 012-2h7.5L21 11.5 12.5 20 3 12.5z" />
    <circle cx="7.8" cy="7.8" r="1.2" />
  </svg>
);

export const IconeMais = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
  </svg>
);

export const IconeSeta = ({ c }: { c?: string }) => (
  <svg {...traco(c ?? 'h-3 w-3')}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconeFechar = ({ c }: { c?: string }) => (
  <svg {...traco(c ?? 'h-4 w-4')}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** Minimizar: a seta diagonal do canto da referência. */
export const IconeMinimizar = ({ c }: { c?: string }) => (
  <svg {...traco(c ?? 'h-4 w-4')}>
    <path d="M20 4L9 15M9 15V9M9 15h6" />
  </svg>
);

export const IconeOlho = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconeCaixa = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M8 12.3l2.7 2.7L16.5 9" />
  </svg>
);

export const IconeArquivo = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
    <path d="M5 8.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19V8.5M10 12.5h4" />
  </svg>
);

export const IconeMarca = ({ c }: { c?: string }) => (
  <svg {...traco(c ?? 'h-3.5 w-3.5')}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

export const IconeLimpar = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6.2 17.8L17.8 6.2" />
  </svg>
);

/* ───────────────────────────── o balão ───────────────────────────── */

/* O tipo mora em `@/ui/teto`, junto da conta que o usa — F17.35. Ele continua
   saindo por aqui porque meia dúzia de telas o importam deste arquivo. */
export type { Lado };

/**
 * A ÂNCORA HERDADA — F17.50.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ELA EXISTE
 *
 *   O modo flutuante do balão (F17.24) resolve o empilhamento e o recorte, mas
 *   custa uma `prop` em cada `<Balao>`. Na árvore da barra lateral são SETE
 *   balões, escritos em quatro arquivos diferentes, e todos abrem a partir do
 *   MESMO botão: o `···` da linha. Passar `ancora` sete vezes seria copiar a
 *   mesma decisão sete vezes, e bastaria esquecer uma para o menu voltar a ser
 *   cortado — sem aviso, que é o pior jeito de um defeito voltar.
 *
 *   Com o provedor, quem ABRE o menu declara a âncora uma vez, e todo balão que
 *   nascer ali dentro flutua. É o mesmo remédio, dito no lugar onde a decisão
 *   de fato mora.
 *
 * ⚠️ O `ancora` ESCRITO NA `prop` CONTINUA MANDANDO. Um balão que já sabe em
 * que se ancorar — o `?` da ajuda, dentro de um menu que já flutua — não pode
 * ser redirigido para a âncora do menu de fora, ou abriria no lugar errado.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const AncoraHerdada = createContext<HTMLElement | null>(null);

/**
 * Declara a âncora para todo balão desenhado dentro.
 *
 * @param ancora O elemento de onde o menu nasce — em geral o botão que o abriu.
 */
export function ComAncora({
  ancora,
  children,
}: {
  ancora: HTMLElement | null;
  children: ReactNode;
}) {
  return <AncoraHerdada.Provider value={ancora}>{children}</AncoraHerdada.Provider>;
}

/**
 * O menu flutuante, ancorado no que o abriu.
 *
 * FECHA POR FORA E POR `Esc`, E AS SETAS ANDAM NOS ITENS. É o que o ClickUp faz,
 * e é também o mínimo para o menu ser alcançável sem mouse. O `mousedown` do
 * documento olha a ÂNCORA inteira, e não só o balão: sem isso, clicar no próprio
 * chip fecharia e reabriria o menu no mesmo gesto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O MODO FLUTUANTE — F17.24, E ELE EXISTE POR UMA ARMADILHA MEDIDA DUAS VEZES
 *
 *   Sem `ancora`, o balão é `position: absolute` dentro do `.cu-ancora` que o
 *   abriu. É o desenho de sempre, e ele continua sendo o padrão.
 *
 *   ⚠️ Mas dentro da BARRA LATERAL isso não basta. `.bl-barra` e
 *   `.q-barra` são `position: sticky`, e **sticky cria contexto de
 *   empilhamento mesmo com `z-index: auto`**. Medido em Chrome com
 *   `document.elementsFromPoint`, a cadeia de ancestrais do balão da árvore é:
 *
 *     div.cu-balao (z 120) → span.cu-ancora → aside.q-barra.cu-arvore (z 1,
 *     sticky) → div.bl-barra (z auto, STICKY)
 *
 *   O `z-index: 120` do balão vale DENTRO de `.bl-barra`, e não na página. E
 *   `.bl-barra` disputa a página na camada dos `z-index: 0` — a mesma em que
 *   entra qualquer irmão posterior que crie contexto próprio. `.q-cartao`
 *   ganha `transform: translateY(-1px)` no `:hover` (medido:
 *   `matrix(1, 0, 0, 1, 0, -1)`), e `transform` cria contexto. Um cartão sob o
 *   ponteiro passa por cima da barra inteira, balão junto.
 *
 *   `position: fixed` NÃO escapa disso — fixed também é filho do contexto do
 *   ancestral transformado. **Portal escapa**, porque muda o lugar do nó na
 *   ÁRVORE, e não só a caixa dele. É o mesmo remédio que a F17.22 usou no
 *   painel `Personalizar`.
 *
 *   Com `ancora`, o balão é desenhado em `document.body` e posicionado em
 *   `fixed` a partir da caixa da âncora — e acompanha rolagem e redimensão.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function Balao({
  className,
  lado = 'baixo',
  aoFechar,
  rotulo,
  semFoco,
  ancora,
  papel = 'menu',
  nome,
  children,
}: {
  className?: string;
  lado?: Lado;
  aoFechar: () => void;
  rotulo?: string;
  /**
   * O NOME para quem usa leitor de tela, quando o balão não desenha título
   * (`rotulo`). Menu sem nome é anunciado só como "menu" — o menu da conta, o
   * de responsáveis e o de datas eram assim (WCAG 4.1.2). `rotulo`, quando
   * existe, já é o nome e ganha.
   */
  nome?: string;
  /**
   * A âncora, quando o balão precisa FUGIR do contexto de empilhamento em que
   * nasceu. Ver o cabeçalho. Ausente, nada muda: é o balão de sempre.
   */
  ancora?: HTMLElement | null;
  /**
   * O papel para quem usa leitor de tela. `menu` é o certo para uma lista de
   * escolhas; um balão que só EXPLICA não é um menu, e anunciá-lo como menu
   * faz o leitor prometer itens que não existem.
   */
  papel?: 'menu' | 'dialog';
  /**
   * Abrir SEM tomar o foco. Acrescentado na F17.16.
   *
   * ⚠️ É o que torna a bolha de formatação possível. Ela aparece porque há TEXTO
   * SELECIONADO no editor; se o balão puxasse o foco ao abrir, o foco sairia do
   * `contenteditable` no mesmo instante — e `document.execCommand('bold')`
   * passaria a mirar o botão, não o texto. O menu apareceria e nenhum botão
   * dele funcionaria.
   *
   * Os menus que se alcançam pelo teclado continuam focando: quem chega ao chip
   * com Tab precisa cair dentro do menu que abriu. Só a bolha, que nasce de um
   * gesto de seleção, abre sem foco — e ela é alcançável pelos atalhos
   * (`Ctrl+B`, `Ctrl+I`, `Ctrl+K`), que não dependem dela.
   */
  semFoco?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** O título escrito (`rotulo`) também é o NOME do balão para o leitor de
      tela — F06A: sem ele o `dialog` da esteira era anunciado sem nome. */
  const idDoTitulo = useId();
  /* A `prop` primeiro, o provedor depois — ver `ComAncora`.

     ⚠️ `undefined` e `null` NÃO são a mesma coisa aqui. Quem não escreve a
     `prop` está pedindo o que o provedor tiver; quem a escreve e ainda não tem
     o elemento (o `?` da ajuda, no primeiro quadro, antes de a `ref` chegar)
     está dizendo "a minha, e ela ainda não existe" — herdar a de fora abriria
     o balão preso ao botão errado. */
  const herdada = useContext(AncoraHerdada);
  const alvoDaAncora = ancora !== undefined ? ancora : herdada;
  const flutuante = alvoDaAncora !== null;

  /* O FOCO VOLTA A QUEM ABRIU O BALÃO — acessibilidade, WCAG 2.4.3.
     Medido no Chrome: `Esc` num menu da árvore, no `?` da ajuda ou num chip da
     ficha fechava o balão e deixava o foco no `<body>`. O `Tab` seguinte
     recomeçava do alto da barra lateral — quem navega por teclado perdia o
     lugar onde estava. Agora o botão que abriu volta a ter o foco (a `Janela` e
     o painel lateral já faziam isto desde a F13).

     A âncora, quando é um botão, vale mais que o foco de agora: no Safari o
     clique não foca o botão, e o foco de agora seria o `<body>`. `semFoco` (a
     bolha de formatação) fica de fora: o foco dela mora, de propósito, no
     editor. `tagName`, e não `instanceof`, porque a suíte desenha isto no
     servidor, onde `HTMLButtonElement` não existe. */
  useDevolverFoco(semFoco === true ? false : alvoDaAncora?.tagName === 'BUTTON' ? alvoDaAncora : true);

  /**
   * A caixa do balão flutuante.
   *
   * Começa escondida, e não em (0,0): um balão que aparecesse no canto e
   * pulasse para o lugar no quadro seguinte seria pior do que um quadro
   * invisível. `useEffect` e não `useLayoutEffect` de propósito — a suíte
   * desenha estas telas com `renderToStaticMarkup`, e `useLayoutEffect` no
   * servidor é aviso em toda execução.
   */
  const [caixa, setCaixa] = useState<CSSProperties | null>(null);

  /**
   * O LADO ONDE O MENU CABE E O TETO DELE — F17.35.
   *
   * Vale nos DOIS modos, e não só no flutuante: um menu preso em `absolute`
   * dentro da `.cu-ancora` não muda de lugar por conta própria, mas o teto
   * dele é o mesmo espaço medido, e virar de `baixo` para `cima` é só trocar
   * o `data-lado` que a folha lê. Ver `@/ui/teto`.
   */
  const [ajuste, setAjuste] = useState<{ lado: Lado; teto: number } | null>(null);

  /** O foco automático acontece UMA vez por abertura. Ver o efeito lá embaixo. */
  const focado = useRef(false);

  /**
   * A MEDIDA, QUE RODA A CADA RENDERIZAÇÃO — F17.35.
   *
   * ⚠️ Ela morava dentro de um `useEffect` com dependências `[ancora, flutuante,
   * lado]`, e isso a fazia cega para a mudança que mais importa: a do CONTEÚDO.
   * Medido: no `···` da árvore, ir do menu da lista para `Mover a lista para…`
   * NÃO desmonta o balão — os dois nascem na mesma posição da árvore de
   * elementos e com o mesmo `lado`, então o React reconcilia e nenhuma
   * dependência muda. O menu de dez destinos herdava o teto do menu de cinco
   * itens: a 1280×1200 ele abria para baixo com 296px de lista para 454px de
   * conteúdo, tendo 767px livres acima.
   *
   * A mesma cegueira valia para a busca do menu de pessoas (a lista encolhe ao
   * filtrar) e para a caixa de acesso, que nasce vazia e se preenche quando o
   * banco responde.
   *
   * Rodar sempre é seguro porque as duas escritas de estado guardam identidade:
   * quando a medida não mudou, elas devolvem o que já estava, e a volta para.
   */
  const FOLGA = 5;

  /**
   * ⚠️ TUDO EM `top`/`left`, e nunca em `bottom`/`right`.
   *
   * Medido: com `right: innerWidth - ancora.right`, o `?` do nível — que
   * fica a uns 100px da borda, dentro da barra lateral — punha um balão de
   * 208px em **x = −9,6**. Uma parte da explicação nascia fora da tela.
   *
   * Com a caixa do próprio balão em mãos dá para PRENDER nas bordas, e é o
   * que este cálculo faz nos dois eixos: encosta no lado pedido, e quando
   * não cabe, vira para o outro lado ou desliza para dentro. Nunca some.
   */
  const medir = () => {
    /* A ÂNCORA DO MODO PRESO É A `.cu-ancora` QUE ENVOLVE O BALÃO — F17.35.
       É dela que a folha já tira a posição (`.cu-balao` é `absolute` e ela é
       `relative`), então é dela que sai o espaço até a borda da janela. */
    const alvo = flutuante ? alvoDaAncora : ref.current?.parentElement;
    if (!alvo) return;
    const a = alvo.getBoundingClientRect();
    const b = ref.current?.getBoundingClientRect();
    const largura = b?.width ?? 0;
    const altura = b?.height ?? 0;
    const janelaL = window.innerWidth;
    const janelaA = window.innerHeight;

    /* DE QUE TAMANHO ESTE MENU QUER SER: a altura de agora mais tudo o que
       sobrou de fora — do próprio balão e da lista de dentro. Não depende do
       teto que já esteja valendo, e é isso que impede a conta de se alimentar
       do próprio efeito. Ver `alturaDesejada` em `@/ui/teto`. */
    const dentro = ref.current?.querySelector('.cu-rolagem') ?? null;
    const desejada =
      ref.current === null
        ? 0
        : alturaDesejada({
            altura,
            sobraDoBalao: ref.current.scrollHeight - ref.current.clientHeight,
            sobraDaLista: dentro === null ? 0 : dentro.scrollHeight - dentro.clientHeight,
          });

    /* O lado e o teto saem da mesma conta nos dois modos. A conta é pura e
       mora em `@/ui/teto`, onde ela se prova sem navegador. */
    const escolha = ondeCabe(a, { largura: janelaL, altura: janelaA }, lado, largura, desejada);
    setAjuste((tinha) =>
      tinha !== null && tinha.lado === escolha.lado && tinha.teto === escolha.teto
        ? tinha
        : { lado: escolha.lado, teto: escolha.teto },
    );

    // No modo preso a folha já põe o balão no lugar. Daqui para baixo é só
    // do flutuante, que não tem `.cu-ancora` de quem herdar posição.
    if (!flutuante) return;

    const paraDireita = escolha.lado === 'baixo' || escolha.lado === 'cima';
    let esquerda = paraDireita ? a.left : a.right - largura;
    esquerda = Math.min(esquerda, janelaL - largura - MARGEM);
    esquerda = Math.max(MARGEM, esquerda);

    /* O desvio de "não coube, vira para o outro lado" saiu daqui: quem
       escolhe o lado agora é `ondeCabe`, pelo ESPAÇO, e não pela altura
       medida — que a partir desta etapa já é a altura cortada pelo teto, e
       portanto cabe sempre, o que apagava a decisão. */
    const paraBaixo = escolha.lado === 'baixo' || escolha.lado === 'baixo-direita';
    let topo = paraBaixo ? a.bottom + FOLGA : a.top - altura - FOLGA;
    topo = Math.min(topo, janelaA - altura - MARGEM);
    topo = Math.max(MARGEM, topo);

    /* ⚠️ COM GUARDA DE IDENTIDADE — e ela não é enfeite. Este cálculo passou
       a rodar A CADA RENDERIZAÇÃO (ver o efeito lá embaixo), e uma caixa nova
       a cada volta seria um estado novo a cada volta: renderiza, mede, guarda,
       renderiza. Devolvendo a MESMA caixa quando nada mudou, a volta para. */
    setCaixa((tinha) =>
      tinha !== null && tinha.top === topo && tinha.left === esquerda
        ? tinha
        : {
            position: 'fixed',
            top: topo,
            left: esquerda,
            // Os dois em `auto` porque `.cu-balao[data-lado]` escreve `bottom` e
            // `right` para dois dos quatro lados: sem zerá-los, a regra da folha e
            // este cálculo puxariam o balão para lados opostos.
            right: 'auto',
            bottom: 'auto',
          },
    );
  };

  /** A última medida, para os ouvintes não se reinscreverem a cada volta. */
  const medirAgora = useRef(medir);

  // Depois de CADA renderização. É este que enxerga a troca de conteúdo.
  useEffect(() => {
    medirAgora.current = medir;
    medir();
  });

  useEffect(() => {
    const agora = () => medirAgora.current();
    // Uma segunda medida no quadro seguinte. A primeira acontece antes de a
    // fonte assentar e antes de a animação sair do 0%, e uma diferença de dois
    // pixels na altura vira dois pixels de desalinho num balão que abre para
    // cima. Custa um quadro e fecha a classe inteira de erro de medida.
    const quadro = window.requestAnimationFrame(agora);
    // `true` na captura: a rolagem que importa pode ser a de uma caixa interna,
    // e o evento de rolagem de elemento não sobe por borbulhamento.
    window.addEventListener('scroll', agora, true);
    window.addEventListener('resize', agora);
    return () => {
      window.cancelAnimationFrame(quadro);
      window.removeEventListener('scroll', agora, true);
      window.removeEventListener('resize', agora);
    };
  }, []);

  useEffect(() => {
    const dono = flutuante ? alvoDaAncora : (ref.current?.parentElement ?? null);
    const foraDaqui = (e: MouseEvent) => {
      const alvo = e.target as Node;
      // O BALÃO TAMBÉM CONTA, e não só a âncora. No modo flutuante ele vive em
      // `document.body`: sem esta linha, clicar dentro do próprio balão seria
      // "clicar fora" e ele se fecharia sozinho ao primeiro toque.
      if (ref.current?.contains(alvo) === true) return;
      if (dono && !dono.contains(alvo)) aoFechar();
    };
    document.addEventListener('mousedown', foraDaqui);
    return () => document.removeEventListener('mousedown', foraDaqui);
  }, [aoFechar, alvoDaAncora, flutuante]);

  /**
   * ⚠️ O `Esc` ANTES DE O FOCO CHEGAR AO BALÃO — verificação da F06B, medido.
   *
   * O ouvinte de tecla mora no `div` do balão, e o foco só entra nele pelo
   * efeito de foco lá embaixo — que, no modo flutuante, espera a medida. Entre
   * o balão aparecer e o foco chegar há uma janela (um quadro; vários com a
   * máquina ocupada) em que o foco ainda está no botão que o abriu. Um `Esc`
   * nessa janela não chegava a ninguém: o balão do responsável no cartão
   * ficava aberto. Pior, dentro de uma janela modal o `Esc` subia do botão
   * até ela e fechava a JANELA inteira, com o balão por cima.
   *
   * Por isso este ouvinte na CAPTURA do documento, que só age quando o foco
   * está na âncora (ou em lugar nenhum) e FORA do balão: dentro dele quem
   * responde é `andar`, como sempre. `semFoco` fica de fora — ali o foco
   * mora de propósito no editor, que trata o próprio `Esc`.
   */
  useEffect(() => {
    if (semFoco === true) return;
    const dono = flutuante ? alvoDaAncora : (ref.current?.parentElement ?? null);
    const escAntesDoFoco = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const foco = document.activeElement;
      if (foco === null || ref.current?.contains(foco) === true) return;
      const naAncora = dono !== null && dono.contains(foco);
      if (!naAncora && foco !== document.body) return;
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
    };
    document.addEventListener('keydown', escAntesDoFoco, true);
    return () => document.removeEventListener('keydown', escAntesDoFoco, true);
  }, [aoFechar, alvoDaAncora, flutuante, semFoco]);

  useEffect(() => {
    // O primeiro item recebe o foco: menu que abre sem foco obriga a pegar o
    // mouse depois de ter chegado nele pelo teclado.
    //
    // ⚠️ SÓ O CAMPO MARCADO COM `data-foco`, e não "o primeiro `input`". No
    // seletor de data os dois primeiros campos são `Data inicial` e
    // `Data de vencimento`, e focar o primeiro DISPARA o `onFocus` dele — o
    // calendário passaria a escrever a data inicial mesmo para quem abriu o
    // chip de prazo. Foco automático que muda o significado do clique seguinte
    // é pior do que foco automático nenhum.
    if (semFoco === true) return;
    /**
     * ⚠️ NO MODO FLUTUANTE, SÓ DEPOIS DE POSICIONADO — e isto foi medido.
     *
     * Até `medir()` rodar, o balão sai com `visibility: hidden` (para não
     * piscar no canto da tela), e **elemento escondido não recebe foco**: o
     * `.focus()` falhava calado, o foco ficava no `<body>` e o `Esc` não
     * fechava o `?`. Como `medir()` guarda a caixa em estado, esperar por ela
     * é esperar o balão existir de verdade.
     *
     * A trava de uma vez só é o que impede o outro defeito: sem ela, cada
     * rolagem recalcula a caixa e roubaria o foco de volta para o balão.
     */
    if (flutuante && caixa === null) return;
    if (focado.current) return;
    focado.current = true;
    const alvo = ref.current?.querySelector<HTMLElement>(
      '[data-foco="1"], [data-item="1"]:not([disabled])',
    );
    /**
     * ⚠️ O BALÃO QUE SÓ EXPLICA FOCA A SI MESMO — e SÓ ele. F17.24.
     *
     * Sem isto o `Esc` não fecha o `?`: o ouvinte de tecla está neste `div`, e
     * um balão sem item nenhum nunca recebia foco.
     *
     * E o `papel === 'dialog'` na condição não é enfeite — foi medido. Numa
     * primeira versão o desvio valia para qualquer balão sem item focável, e a
     * caixa de acesso passou a roubar o foco ao abrir: ela monta com os itens
     * `disabled` enquanto lê o banco, então `alvo` é nulo naquele instante. O
     * efeito colateral era grave e escondido — com o foco na caixa de FORA, um
     * `Esc` dado para fechar o `?` fechava a caixa inteira e jogava fora o que
     * a pessoa tinha acabado de escolher.
     */
    (alvo ?? (papel === 'dialog' ? ref.current : null))?.focus();
  }, [semFoco, papel, flutuante, caixa]);

  /**
   * O TECLADO DENTRO DO MENU.
   *
   * Setas andam e dão a volta; `Home` e `End` vão às pontas — F17.35. As duas
   * pontas passaram a valer a pena quando o menu ganhou teto: com trinta itens
   * e catorze visíveis, chegar ao último pela seta é catorze toques.
   *
   * ⚠️ E o item que recebe o foco ROLA ATÉ APARECER. Sem isso a etapa se
   * contradiz: o teto esconde o que passa, e o foco iria para um item fora da
   * vista — a pessoa apertaria `Enter` sem saber no quê.
   */
  const andar = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      aoFechar();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    const itens = [
      ...(ref.current?.querySelectorAll<HTMLElement>('[data-item="1"]:not([disabled])') ?? []),
    ];
    if (itens.length === 0) return;
    e.preventDefault();
    const atual = itens.indexOf(document.activeElement as HTMLElement);
    let proximo: number;
    if (e.key === 'Home') proximo = 0;
    else if (e.key === 'End') proximo = itens.length - 1;
    else {
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      proximo =
        atual < 0
          ? passo === 1
            ? 0
            : itens.length - 1
          : (atual + passo + itens.length) % itens.length;
    }
    itens[proximo].focus();
    rolarAteAparecer(itens[proximo]);
  };

  const corpo = (
    <div
      ref={ref}
      className={['cu-balao', className].filter(Boolean).join(' ')}
      /* O lado MEDIDO, e não o pedido — F17.35. Enquanto não há medida vale o
         pedido, que é o palpite certo na maioria das aberturas. */
      data-lado={ajuste?.lado ?? lado}
      data-flutuante={flutuante ? '1' : undefined}
      role={papel}
      aria-labelledby={rotulo ? idDoTitulo : undefined}
      aria-label={rotulo ? undefined : nome}
      // `-1`: alcançável por programa (o foco acima), nunca pelo `Tab` — um
      // parágrafo não é parada de tabulação.
      tabIndex={-1}
      /**
       * ⚠️ O QUADRO ANTES DE MEDIR: CANTO DA TELA, e não `visibility: hidden`
       * nem `left: -9999px`. As duas alternativas foram tentadas e MEDIDAS,
       * e cada uma quebrou uma coisa:
       *
       *   · `visibility: hidden` — elemento escondido não recebe foco. O
       *     `.focus()` falhava calado, o foco ficava no `<body>`, e o `Esc`
       *     não fechava o `?`.
       *
       *   · `left: -9999px` — o balão nasce fora da tela e a caixa que se mede
       *     ali não é a que ele terá. Medido: `altura` saiu ~690px em vez de
       *     179px, e o cálculo de "abrir para cima" jogou o balão para o canto
       *     superior esquerdo, longe do `?` que o abriu.
       *
       * No canto, com a caixa certa, os dois problemas somem — e ninguém vê o
       * quadro: a animação `ac-surgir` começa em `opacity: 0`, que é
       * exatamente o estado deste primeiro quadro.
       */
      /* `--cu-teto` é o espaço que existe entre a âncora e a borda, em pixels.
         A folha o lê em `max-height` (ver `.cu-balao` em `clickup.css`). Sem
         medida ainda, a folha usa a própria rede de `100vh`. */
      style={{
        ...(flutuante ? (caixa ?? { position: 'fixed', top: 0, left: 0 }) : {}),
        ...(ajuste === null ? {} : ({ '--cu-teto': `${ajuste.teto}px` } as CSSProperties)),
      }}
      onKeyDown={andar}
    >
      {/*
        O TÍTULO GANHOU UM `X` — F17.33.

        ⚠️ SÓ O BALÃO COM TÍTULO, e a linha é a mesma do resto da etapa (ver
        `@/ui/janela`): quem tem cabeçalho próprio é PAINEL e ganha `X`; quem é
        menu de escolha fecha ao escolher e não ganha. Na prática o balão com
        título é o `?` da F17.24 — um balão que só EXPLICA, onde não há nada
        para escolher e portanto nada que o feche por dentro.

        `Esc` e clique fora ele já tinha. O `X` é o pedido do usuário: *"as
        telas menores devem ter um X para sair delas e voltarem"*.
      */}
      {rotulo && (
        <div className="cu-balao-titulo flex items-center justify-between gap-2">
          <span id={idDoTitulo}>{rotulo}</span>
          <button
            type="button"
            aria-label="Fechar"
            className="shrink-0 rounded p-0.5 leading-none"
            onClick={aoFechar}
          >
            <IconeFechar c="h-3 w-3" />
          </button>
        </div>
      )}
      {children}
    </div>
  );

  // ⚠️ `document.body`, e não um contêiner do app: é a única forma de sair do
  // contexto de empilhamento da barra presa. Ver o cabeçalho.
  if (!flutuante) return corpo;
  if (typeof document === 'undefined') return corpo;
  return createPortal(corpo, document.body);
}

export function ItemDeMenu({
  marcado,
  aoEscolher,
  fim,
  desativado,
  children,
}: {
  marcado?: boolean;
  aoEscolher: () => void;
  fim?: ReactNode;
  desativado?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      data-item="1"
      aria-checked={marcado === true}
      disabled={desativado}
      className="cu-item"
      onClick={aoEscolher}
    >
      {children}
      {fim !== undefined && <span className="fim">{fim}</span>}
      {marcado === true && (
        <span className="marca" aria-hidden="true" style={{ marginLeft: 'auto' }}>
          <IconeMarca />
        </span>
      )}
    </button>
  );
}

export const Separador = () => <hr className="cu-sep" />;

/* ───────────────────────────── o `?` ───────────────────────────── */

/**
 * A PEÇA DE AJUDA — etapa F17.24.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE ONDE ELA VEIO
 *
 *   O usuário mandou a foto da caixa `Quem alcança o espaço`. Ao lado do
 *   seletor de nível havia a frase do nível, e ela brigava com o seletor e
 *   quebrava em duas linhas:
 *
 *     [ Criar ▾ ] ⊘   Tudo de Executar, mais
 *                     criar tarefa, lista e pasta.
 *
 *   Palavras dele: *"talvez um símbolo de `?` com a explicação ao clicar já
 *   possa resolver."*
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A REGRA DE QUANDO USAR, QUE É A MESMA DA F17.20
 *   *"Explica a tela" vira `?`; "avisa de uma consequência" fica escrito.*
 *   "Tudo de Executar, mais criar tarefa…" explica o que um controle faz — é
 *   `?`. "Quem não passa por lá não chega aqui" avisa que o gesto pode não ter
 *   o efeito esperado — fica.
 *
 * ⚠️ É UM BOTÃO, E NÃO UM ÍCONE
 *   `<button>` de verdade: chega pelo `Tab`, abre com `Enter` e `Espaço`, e
 *   anuncia o que explica. Um `<span>` com `onClick` seria ajuda que só existe
 *   para quem usa mouse — e ajuda inalcançável é pior que ajuda nenhuma,
 *   porque some a frase que estava lá.
 *
 * ⚠️ E ELE ABRE EM PORTAL, SEMPRE
 *   O primeiro lugar onde ele foi aplicado é a caixa de acesso, que vive
 *   DENTRO da barra lateral presa. Ver a armadilha do empilhamento no
 *   cabeçalho de `Balao`: sem portal, este `?` nasceria com o defeito que já
 *   mordeu duas vezes esta semana.
 */
export function Ajuda({
  sobre,
  lado = 'baixo-direita',
  children,
}: {
  /** O que ele explica, em duas ou três palavras. Vira o nome do botão para
   *  quem usa leitor de tela, e o título do balão. */
  sobre: string;
  lado?: Lado;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [ancora, setAncora] = useState<HTMLElement | null>(null);

  return (
    <>
      <button
        ref={setAncora}
        type="button"
        className="cu-ajuda"
        aria-expanded={aberto}
        aria-haspopup="dialog"
        /* `Explicar: …` e não `O que é …`: o segundo lê torto quando o assunto
           já começa com uma pergunta ("O que é por que o envio está
           desligado"). O prefixo neutro serve a todos os assuntos. */
        aria-label={`Explicar: ${sobre}`}
        onClick={() => setAberto((v) => !v)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {aberto && (
        <Balao
          lado={lado}
          ancora={ancora}
          papel="dialog"
          rotulo={sobre}
          aoFechar={() => setAberto(false)}
        >
          <div className="cu-ajuda-corpo">{children}</div>
        </Balao>
      )}
    </>
  );
}

/* ───────────────────────────── prioridade ───────────────────────────── */

/** A ordem é a da urgência, que é a do enum `ideworks.task_priority`. */
const PRIORIDADES: Priority[] = ['urgent', 'high', 'normal', 'low'];

export function MenuDePrioridade({
  valor,
  aoEscolher,
  aoFechar,
  lado,
}: {
  valor: Priority | null;
  aoEscolher: (p: Priority | null) => void;
  aoFechar: () => void;
  lado?: Lado;
}) {
  return (
    <Balao lado={lado} aoFechar={aoFechar} rotulo="Prioridade">
      {PRIORIDADES.map((p) => (
        <ItemDeMenu
          key={p}
          marcado={valor === p}
          aoEscolher={() => {
            aoEscolher(p);
            aoFechar();
          }}
        >
          <span className="cu-bandeira" style={{ ['--cor-bandeira' as string]: PRIORITY_TOKEN[p] }}>
            <IconeBandeira />
          </span>
          {PRIORITY_LABEL[p]}
        </ItemDeMenu>
      ))}

      {/* O fio antes do `Limpar` está na referência, e ele não é enfeite:
          separa escolher de desfazer. A coluna é anulável — limpar grava nulo. */}
      <Separador />
      <ItemDeMenu
        aoEscolher={() => {
          aoEscolher(null);
          aoFechar();
        }}
        desativado={valor === null}
      >
        <span className="cu-bandeira">
          <IconeLimpar />
        </span>
        Limpar
      </ItemDeMenu>
    </Balao>
  );
}

/* ───────────────────────────── data ───────────────────────────── */

/**
 * Um campo de dia que não engole o prazo do ano 82025 (ver `board.ts`) e que só
 * entrega o que foi digitado quando assenta.
 *
 * ⚠️ O CAMPO NATIVO ENTREGA UM VALOR A CADA DÍGITO — e na ficha cada entrega é
 * uma gravação. Digitar `15/10/2026` mandava `…-01`, `…-15`, `0002-10-15`,
 * `0020-10-15`, `0202-10-15` e `2026-10-15` ao banco, e a resposta de uma tecla
 * antiga, chegando com a pessoa na seguinte, devolvia o campo ao valor velho no
 * meio da digitação. Agora o campo mostra o que se digita, entrega depois de
 * `ESPERA_DO_DIA_DIGITADO` sem teclas (ou ao sair do campo, ou ao fechar o
 * menu), e só entrega o que `diaDigitadoVale` aceita. Escolher no calendário
 * ou num atalho não passa por aqui.
 */
function CampoDeDia({
  rotulo,
  valor,
  ativo,
  aoMudar,
  aoFocar,
}: {
  rotulo: string;
  valor: string;
  ativo: boolean;
  aoMudar: (v: string) => void;
  aoFocar: () => void;
}) {
  // O campo nativo não sabe mostrar ano de cinco dígitos: ele apresenta VAZIO,
  // e vazio é indistinguível de "sem prazo". Valor torto cai num campo de
  // texto, com o que está no banco à mostra.
  const nativoAceita = valor === '' || /^\d{4}-\d{2}-\d{2}$/.test(valor);

  const [texto, setTexto] = useState(valor);
  // O que foi digitado e ainda não foi entregue; `null` = nada esperando.
  const pendente = useRef<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sempre o `aoMudar` do último desenho: o relógio e o fechar do menu o chamam depois.
  const entregar = useRef(aoMudar);
  entregar.current = aoMudar;

  // O valor de fora volta ao campo — um dia escolhido no calendário, a ficha
  // relida —, MENOS enquanto há texto digitado esperando: aí quem manda é a mão.
  useEffect(() => {
    if (pendente.current === null) setTexto(valor);
  }, [valor]);

  /**
   * Entrega o que está esperando, se vale, e esquece o resto. Devolve o que
   * aconteceu: `nada` (não havia texto esperando), `entregue` ou `descartado`
   * (era um ano pela metade, ou um segmento apagado no meio da digitação).
   */
  const assentar = (aoSair: boolean): 'nada' | 'entregue' | 'descartado' => {
    if (relogio.current !== null) clearTimeout(relogio.current);
    relogio.current = null;
    const digitado = pendente.current;
    pendente.current = null;
    if (digitado === null) return 'nada';
    if (!diaDigitadoVale(digitado, aoSair)) return 'descartado';
    entregar.current(digitado);
    return 'entregue';
  };
  // Fechar o menu com texto esperando (Esc, clique fora) também entrega.
  const assentarAoDesmontar = useRef(assentar);
  assentarAoDesmontar.current = assentar;
  useEffect(() => () => void assentarAoDesmontar.current(true), []);

  return (
    <label className="cu-data-campo">
      <span>{rotulo}</span>
      <input
        type={nativoAceita ? 'date' : 'text'}
        value={texto}
        onFocus={aoFocar}
        onClick={aoFocar}
        onChange={(e) => {
          const digitado = e.target.value;
          setTexto(digitado);
          pendente.current = digitado;
          if (relogio.current !== null) clearTimeout(relogio.current);
          relogio.current = diaDigitadoVale(digitado)
            ? setTimeout(() => assentar(false), ESPERA_DO_DIA_DIGITADO)
            : null;
        }}
        onBlur={() => {
          // Saiu do campo com algo que não vale (ano pela metade): o campo volta
          // ao que está gravado, e não fica mostrando uma data que não existe.
          if (assentar(true) === 'descartado') setTexto(valor);
        }}
        style={ativo ? { borderColor: 'var(--luz)' } : undefined}
      />
    </label>
  );
}

export function MenuDeData({
  inicio,
  vencimento,
  hoje,
  focoInicial = 'vencimento',
  aoMudar,
  aoFechar,
  lado,
}: {
  inicio: string;
  vencimento: string;
  hoje: Day;
  focoInicial?: 'inicio' | 'vencimento';
  aoMudar: (campo: 'inicio' | 'vencimento', valor: string) => void;
  aoFechar: () => void;
  lado?: Lado;
}) {
  const [alvo, setAlvo] = useState<'inicio' | 'vencimento'>(focoInicial);

  const escolhido = parseDay(alvo === 'inicio' ? inicio : vencimento);
  const outro = parseDay(alvo === 'inicio' ? vencimento : inicio);

  const [mes, setMes] = useState(() => ({
    ano: escolhido?.year ?? hoje.year,
    mes: escolhido?.month ?? hoje.month,
  }));

  const grade = useMemo(() => gradeDoMes(mes.ano, mes.mes), [mes]);
  const lista = useMemo(() => atalhos(hoje), [hoje]);

  const escrever = (d: Day) => aoMudar(alvo, iso(d));

  return (
    <Balao lado={lado} aoFechar={aoFechar} nome="Datas da tarefa">
      <div className="cu-data-campos">
        <CampoDeDia
          rotulo="Data inicial"
          valor={inicio}
          ativo={alvo === 'inicio'}
          aoFocar={() => setAlvo('inicio')}
          aoMudar={(v) => aoMudar('inicio', v)}
        />
        <CampoDeDia
          rotulo="Data de vencimento"
          valor={vencimento}
          ativo={alvo === 'vencimento'}
          aoFocar={() => setAlvo('vencimento')}
          aoMudar={(v) => aoMudar('vencimento', v)}
        />
      </div>

      <div className="cu-data">
        <div className="cu-atalhos">
          {lista.map((a) => (
            <ItemDeMenu
              key={a.chave}
              aoEscolher={() => {
                escrever(a.dia);
                aoFechar();
              }}
              fim={DIA_CURTO[diaDaSemana(a.dia)]}
            >
              {a.rotulo}
            </ItemDeMenu>
          ))}
          <Separador />
          <ItemDeMenu
            aoEscolher={() => aoMudar(alvo, '')}
            desativado={(alvo === 'inicio' ? inicio : vencimento) === ''}
          >
            <span className="cu-bandeira">
              <IconeLimpar />
            </span>
            Limpar
          </ItemDeMenu>
        </div>

        <div className="cu-cal">
          <div className="cu-cal-topo">
            <button
              type="button"
              className="cu-icone-btn"
              aria-label="Mês anterior"
              onClick={() => setMes((m) => mesVizinho(m.ano, m.mes, -1))}
            >
              <span style={{ transform: 'rotate(90deg)', display: 'inline-flex' }}>
                <IconeSeta />
              </span>
            </button>
            <span className="cu-cal-mes">
              {MESES[mes.mes - 1]} {mes.ano}
            </span>
            <button
              type="button"
              className="cu-icone-btn"
              aria-label="Próximo mês"
              onClick={() => setMes((m) => mesVizinho(m.ano, m.mes, 1))}
            >
              <span style={{ transform: 'rotate(-90deg)', display: 'inline-flex' }}>
                <IconeSeta />
              </span>
            </button>
            <button
              type="button"
              className="cu-ferramenta"
              style={{ marginLeft: 'auto' }}
              onClick={() => setMes({ ano: hoje.year, mes: hoje.month })}
            >
              Hoje
            </button>
          </div>

          <div className="cu-cal-grade">
            {CABECALHO_DA_SEMANA.map((d) => (
              <div key={d} className="cu-cal-cabecalho">
                {d}
              </div>
            ))}
            {grade.map((casa) => (
              <button
                key={iso(casa.dia)}
                type="button"
                className="cu-cal-dia"
                /* O NOME E O ESTADO DO DIA — WCAG 4.1.2 e 1.4.1. O dia escolhido
                   e o de hoje só existiam como cor e anel (`data-*`); o leitor
                   de tela ouvia "15, botão" sem mês nem se estava escolhido. */
                aria-label={nomeDoDia(casa.dia)}
                aria-pressed={escolhido !== null && mesmoDia(casa.dia, escolhido)}
                aria-current={mesmoDia(casa.dia, hoje) ? 'date' : undefined}
                data-fora={!casa.doMes}
                data-hoje={mesmoDia(casa.dia, hoje)}
                data-escolhido={escolhido !== null && mesmoDia(casa.dia, escolhido)}
                data-inicio={outro !== null && mesmoDia(casa.dia, outro)}
                onClick={() => {
                  escrever(casa.dia);
                  aoFechar();
                }}
              >
                {casa.dia.day}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Balao>
  );
}

/* ───────────────────────────── pessoas ───────────────────────────── */

/* A cor do avatar mora em `@/board/cor-da-pessoa` — pura, para a suíte medir o
   contraste da inicial sobre cada uma. */

export function Avatar({
  pessoa,
  mini,
  decorativo,
}: {
  pessoa: TaskPerson;
  mini?: boolean;
  /**
   * O avatar dentro de um controle que já se chama pelo nome da pessoa (o botão
   * da conta, com `aria-label`): as iniciais soltas ("RE") ficam fora do que o
   * leitor de tela lê e do que um comando de voz procura — WCAG 2.5.3 (o
   * rótulo visível, "review@…", é o que está no nome).
   */
  decorativo?: boolean;
}) {
  return (
    <span
      aria-hidden={decorativo ? true : undefined}
      className="cu-avatar"
      data-tamanho={mini ? 'mini' : undefined}
      title={pessoa.name}
      style={{ ['--cor-pessoa' as string]: corDaPessoa(pessoa.id) }}
    >
      {initials(pessoa.name)}
    </span>
  );
}

/**
 * O seletor de responsável.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A BUSCA FILTRA NOME **E** E-MAIL — E ISSO É MENOS DO QUE PARECE, HOJE
 *
 *   `ideworks.team_directory()` devolve `coalesce(full_name, email)` numa
 *   coluna só, e o comentário da F4.8b diz por quê: *"não expõe e-mail
 *   separado, papel, nem se a pessoa é administradora"*. É decisão de
 *   privacidade, não descuido — e desfazê-la exigiria migration.
 *
 *   Consequência medida em 2026-08-25: dos 8 perfis ativos, **6 não têm nome**,
 *   e para esses seis o que a busca compara JÁ É o e-mail. Para os dois com
 *   nome, o e-mail não chega até aqui e não há o que filtrar.
 *
 *   A `Equipes` da referência não existe: o modelo não tem grupo.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function MenuDePessoas({
  diretorio,
  escolhidos,
  meuId,
  rotulo = 'Pessoas',
  carregando = false,
  aoMudar,
  aoFechar,
  lado,
}: {
  diretorio: readonly TaskPerson[];
  escolhidos: readonly string[];
  meuId: string | null;
  rotulo?: string;
  /**
   * A LISTA AINDA NÃO CHEGOU — F17.69.
   *
   * Na ficha ela vem carregada com a tela, e o valor de partida (`false`) é o
   * que estava escrito antes desta etapa. Na capa do cartão ela é pedida no
   * clique, para AQUELA tarefa (ver `board/responsavel-do-cartao`), e sem esta
   * distinção o balão diria "Ninguém com acesso ao IDE Works" durante a espera
   * — uma frase errada e assustadora no lugar de uma frase de espera.
   */
  carregando?: boolean;
  aoMudar: (ids: string[]) => void;
  aoFechar: () => void;
  lado?: Lado;
}) {
  const [busca, setBusca] = useState('');
  const marcados = new Set(escolhidos);

  // `Eu` no topo — é quem mais se atribui tarefa, e procurar o próprio nome
  // numa lista alfabética é o gesto mais repetido que dá para poupar.
  const ordenado = useMemo(() => {
    const copia = [...diretorio];
    copia.sort((a, b) => {
      if (a.id === meuId) return -1;
      if (b.id === meuId) return 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return copia;
  }, [diretorio, meuId]);

  const filtrado = useMemo(
    () => ordenado.filter((p) => nomeCasaComABusca(p.name, busca)),
    [ordenado, busca],
  );

  const alternar = (id: string) => {
    const proximo = new Set(marcados);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    aoMudar([...proximo]);
  };

  return (
    <Balao lado={lado} aoFechar={aoFechar} nome="Responsáveis">
      <input
        className="cu-busca"
        data-foco="1"
        value={busca}
        placeholder="Busque ou insira o e-mail…"
        aria-label="Buscar pessoa"
        onChange={(e) => setBusca(e.target.value)}
      />

      <div className="cu-balao-titulo">{rotulo}</div>

      <div className="cu-rolagem">
        {filtrado.length === 0 && (
          <p className="cu-vazio">
            {carregando
              ? 'Buscando quem pode ficar com esta tarefa…'
              : diretorio.length === 0
                ? 'Ninguém com acesso ao IDE Works para atribuir.'
                : 'Nenhuma pessoa com esse nome.'}
          </p>
        )}

        {filtrado.map((p) => (
          <ItemDeMenu key={p.id} marcado={marcados.has(p.id)} aoEscolher={() => alternar(p.id)}>
            <Avatar pessoa={p} />
            <span className="rotulo" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.id === meuId ? 'Eu' : p.name}
            </span>
          </ItemDeMenu>
        ))}
      </div>

      {/* A trava da F4.8, dita em voz alta: `set_task_assignees` descarta em
          silêncio quem não tem perfil aqui. Esconder isso faria parecer que a
          equipe sumiu — são 8 perfis contra 35 membros no ClickUp. */}
      {/* Enquanto a lista não chegou, "hoje 0 pessoas" seria um número falso —
          e é o número que a frase existe para dizer. F17.69. */}
      {!carregando && (
        <p className="cu-vazio">
          Só aparece quem tem acesso ao IDE Works — hoje {diretorio.length}{' '}
          {diretorio.length === 1 ? 'pessoa' : 'pessoas'}. Quem está no ClickUp e ainda não entrou
          aqui não pode receber tarefa.
        </p>
      )}
    </Balao>
  );
}

/* ───────────────────────────── status ───────────────────────────── */

export function MenuDeStatus({
  statuses,
  valor,
  aoEscolher,
  aoFechar,
  lado,
}: {
  statuses: readonly BoardStatus[];
  valor: string | null;
  aoEscolher: (id: string) => void;
  aoFechar: () => void;
  lado?: Lado;
}) {
  /*
    O MENU É AGRUPADO POR TIPO — F17.19, e é como a referência mostra:

      Não iniciado   IDÉIAS · A FAZER
      Ativo          EM ANDAMENTO · REFAÇÃO
      Feito          REVISÃO INTERNA · EM APROVAÇÃO DO CLIENTE
      Fechado        CONCLUÍDO

    Numa esteira de oito colunas, a lista corrida obriga a ler as oito para
    achar "aquela do meio". O cabeçalho corta a busca em quatro pedaços de duas.

    A ORDEM DENTRO DO GRUPO É A DA ESTEIRA, e não alfabética: a esteira TEM
    ordem, e reordená-la aqui apagaria a informação que o quadro desenha.

    Grupo vazio não aparece. Cabeçalho sobre nada é rótulo que só descreve
    estado — exatamente o que a F17.20 tirou da tela.
  */
  const grupos = GRUPOS_DE_STATUS.map((grupo) => ({
    grupo,
    itens: statuses.filter((s) => GRUPO_DO_TIPO[s.type] === grupo),
  })).filter((g) => g.itens.length > 0);

  return (
    <Balao lado={lado} aoFechar={aoFechar} rotulo="Status">
      {/* F43, Fase 6: "esteira resolvida" era vocabulário do banco; na tela, "etapas". */}
      {statuses.length === 0 && <p className="cu-vazio">Esta lista não tem etapas definidas.</p>}
      <div className="cu-rolagem">
        {grupos.map((g) => (
          <div key={g.grupo}>
            <div className="cu-grupo-titulo">{g.grupo}</div>
            {g.itens.map((s) => (
              <ItemDeMenu
                key={s.id}
                marcado={valor === s.id}
                aoEscolher={() => {
                  aoEscolher(s.id);
                  aoFechar();
                }}
              >
                {/* Cor do ClickUp: dado, por variável no elemento. Decisão D10. */}
                <span
                  className="cu-ponto"
                  style={s.color ? { ['--cor-status' as string]: s.color } : undefined}
                />
                <span>{s.name}</span>
              </ItemDeMenu>
            ))}
          </div>
        ))}
      </div>
    </Balao>
  );
}

/* ───────────────────────────── etiquetas ───────────────────────────── */

export function MenuDeEtiquetas({
  disponiveis,
  escolhidas,
  aoMudar,
  aoCriar,
  aoFechar,
  lado,
}: {
  disponiveis: readonly BoardTag[];
  escolhidas: readonly string[];
  aoMudar: (ids: string[]) => void;
  /** Ausente quando não há espaço (tarefa fora de lista) — some o campo. */
  aoCriar?: (nome: string, cor: string) => Promise<void>;
  aoFechar: () => void;
  lado?: Lado;
}) {
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState('#7c8cff');
  const [salvando, setSalvando] = useState(false);
  const idCor = useId();
  const marcadas = new Set(escolhidas);

  const alternar = (id: string) => {
    const proximo = new Set(marcadas);
    if (proximo.has(id)) proximo.delete(id);
    else proximo.add(id);
    aoMudar([...proximo]);
  };

  return (
    <Balao lado={lado} aoFechar={aoFechar} rotulo="Etiquetas">
      {disponiveis.length === 0 && (
        <p className="cu-vazio">Este espaço ainda não tem etiqueta nenhuma. A primeira nasce aqui.</p>
      )}

      <div className="cu-rolagem">
        {disponiveis.map((g) => (
          <ItemDeMenu key={g.id} marcado={marcadas.has(g.id)} aoEscolher={() => alternar(g.id)}>
            <span
              className="cu-amostra"
              style={g.bgColor ? { ['--cor-etiqueta-fundo' as string]: g.bgColor } : undefined}
            />
            {g.name}
          </ItemDeMenu>
        ))}
      </div>

      {aoCriar && (
        <>
          <Separador />
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', padding: '0 0.15rem' }}>
            <input
              className="cu-busca"
              style={{ marginBottom: 0 }}
              value={nome}
              maxLength={60}
              placeholder="Etiqueta nova"
              aria-label="Nome da etiqueta nova"
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || nome.trim() === '' || salvando) return;
                e.preventDefault();
                setSalvando(true);
                void aoCriar(nome.trim(), cor).finally(() => {
                  setSalvando(false);
                  setNome('');
                });
              }}
            />
            <input
              id={idCor}
              type="color"
              value={cor}
              aria-label="Cor da etiqueta nova"
              onChange={(e) => setCor(e.target.value)}
              style={{ width: '1.9rem', height: '1.75rem', background: 'transparent', border: 0, padding: 0 }}
            />
            <button
              type="button"
              className="cu-ferramenta"
              disabled={salvando || nome.trim() === ''}
              onClick={() => {
                setSalvando(true);
                void aoCriar(nome.trim(), cor).finally(() => {
                  setSalvando(false);
                  setNome('');
                });
              }}
            >
              {salvando ? '…' : '+'}
            </button>
          </div>
        </>
      )}
    </Balao>
  );
}

/* ───────────────────────────── lista e tipo ───────────────────────────── */

/**
 * Trocar a lista: no modal escolhe onde nasce; na ficha e no cartão é
 * `move_task`.
 *
 * A SEÇÃO `Recentes` — F17.63.
 *   O ClickUp abre este seletor com as últimas listas usadas em cima da árvore,
 *   e é o que faz mover em dois cliques em vez de cinco. Ela só aparece com a
 *   BUSCA VAZIA: quem digitou já disse o que procura, e uma seção fixa em cima
 *   do resultado empurraria para fora justamente o que foi pedido.
 *
 *   ⚠️ ELA NÃO TEM CAMINHO PRÓPRIO ATÉ O BANCO. Quem chama resolve os ids
 *   contra a MESMA árvore que desenha o resto (`acharListas`, em
 *   `@/board/arvore`), e por isso a seção herda o alcance em vez de o repetir.
 */
export function MenuDeListas({
  arvore,
  listaAtual,
  recentes,
  rotulo,
  aoEscolher,
  aoFechar,
  lado,
}: {
  arvore: readonly TreeSpace[];
  listaAtual: string | null;
  /**
   * Os últimos destinos, JÁ ACHADOS na árvore e na ordem de uso. Ausente ou
   * vazio, a seção não é desenhada — um `Recentes` sem nada dentro é uma
   * promessa vazia ocupando a primeira linha do menu.
   */
  recentes?: readonly ListaNaArvore[];
  /** O título do balão, que traz o `X` de fechar junto (F17.33). */
  rotulo?: string;
  aoEscolher: (listId: string) => void;
  aoFechar: () => void;
  lado?: Lado;
}) {
  const [busca, setBusca] = useState('');
  const q = busca.trim();

  const cabe = (nome: string) => nomeCasaComABusca(nome, q);

  /* A lista onde a tarefa JÁ está não é destino. Ela continua marcada lá
     embaixo, na árvore, para ninguém perder de onde a coisa veio. */
  const recentesAqui = (recentes ?? []).filter((l) => l.id !== listaAtual);

  /* A empresa só entra no título do espaço para desfazer homônimo — F31. Conta
     sobre a árvore INTEIRA, e não a filtrada pela busca: o título não pode
     mudar de nome conforme se digita. */
  const homonimos = useMemo(() => espacosHomonimos(arvore), [arvore]);

  return (
    <Balao lado={lado} aoFechar={aoFechar} rotulo={rotulo} nome="Listas">
      <input
        className="cu-busca"
        data-foco="1"
        value={busca}
        placeholder="Buscar lista…"
        aria-label="Buscar lista"
        onChange={(e) => setBusca(e.target.value)}
      />
      <div className="cu-rolagem">
        {arvore.length === 0 && <p className="cu-vazio">Nenhuma lista ao seu alcance.</p>}

        {/* Ver o cabeçalho: só com a busca vazia, e só quando há o que mostrar. */}
        {q === '' && recentesAqui.length > 0 && (
          <div>
            <div className="cu-balao-titulo">Recentes</div>
            {recentesAqui.map((lista) => (
              <ItemDeMenu
                key={`recente:${lista.id}`}
                aoEscolher={() => {
                  aoEscolher(lista.id);
                  aoFechar();
                }}
                fim={lista.liveTasks > 0 ? String(lista.liveTasks) : undefined}
              >
                <IconeLista />
                {/* O CAMINHO INTEIRO, e não só o nome: duas listas `Demandas`
                    em espaços diferentes são o caso normal aqui, e `Recentes`
                    tira justamente o cabeçalho de espaço que as separaria. */}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {lista.espaco} / {lista.pasta ? `${lista.pasta} / ` : ''}
                  {lista.nome}
                </span>
              </ItemDeMenu>
            ))}
          </div>
        )}

        {arvore.map((espaco) => {
          const soltas = espaco.lists.filter((l) => cabe(l.name));
          const pastas = espaco.folders
            .map((f) => ({ ...f, lists: f.lists.filter((l) => cabe(l.name)) }))
            .filter((f) => f.lists.length > 0);
          if (soltas.length === 0 && pastas.length === 0) return null;

          return (
            <div key={espaco.id}>
              <div className="cu-balao-titulo">{nomeDoEspaco(espaco, homonimos)}</div>
              {[...soltas.map((l) => ({ pasta: null, lista: l })), ...pastas.flatMap((f) =>
                f.lists.map((l) => ({ pasta: f.name, lista: l })),
              )].map(({ pasta, lista }) => (
                <ItemDeMenu
                  key={lista.id}
                  marcado={listaAtual === lista.id}
                  aoEscolher={() => {
                    aoEscolher(lista.id);
                    aoFechar();
                  }}
                  fim={lista.liveTasks > 0 ? String(lista.liveTasks) : undefined}
                >
                  <IconeLista />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {pasta ? `${pasta} / ` : ''}
                    {lista.name}
                  </span>
                </ItemDeMenu>
              ))}
            </div>
          );
        })}
      </div>
    </Balao>
  );
}

/**
 * O tipo de tarefa (`Task`, `Client` na origem).
 *
 * ⚠️ QUEM CHAMA SÓ DEVE DESENHAR O SELETOR QUANDO HÁ CATÁLOGO. Medido em
 * 2026-08-25: `ideworks.task_types` tem **zero linhas** no schema inteiro. Um
 * seletor com uma opção fixa seria botão morto, e botão morto é pior que botão
 * ausente.
 */
export function MenuDeTipos({
  tipos,
  valor,
  aoEscolher,
  aoFechar,
  lado,
}: {
  tipos: readonly TaskType[];
  valor: number | null;
  aoEscolher: (customItemId: number | null) => void;
  aoFechar: () => void;
  lado?: Lado;
}) {
  return (
    <Balao lado={lado} aoFechar={aoFechar} rotulo="Tipo de tarefa">
      <ItemDeMenu
        marcado={valor === null}
        aoEscolher={() => {
          aoEscolher(null);
          aoFechar();
        }}
      >
        <IconeCirculo />
        Tarefa
      </ItemDeMenu>
      {tipos.map((t) => (
        <ItemDeMenu
          key={t.id}
          marcado={valor === t.customItemId}
          aoEscolher={() => {
            aoEscolher(t.customItemId);
            aoFechar();
          }}
        >
          <IconeCirculo />
          {t.name}
        </ItemDeMenu>
      ))}
    </Balao>
  );
}
