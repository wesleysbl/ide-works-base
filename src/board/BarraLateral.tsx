/**
 * A barra lateral do trabalho — etapa F17.18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ELA PASSA A SER
 *
 *   Até a F17.14 a barra era a ÁRVORE, e só. Árvore é a navegação de quem
 *   ORGANIZA — ela começa no espaço e desce até a lista.
 *
 *   O usuário pediu o outro lado: *"a lateral esquerda é para o controle dos
 *   funcionários — as tarefas do dia, o que está atrasado, o histórico"*. Então
 *   a barra ganha seções, e a árvore vira UMA delas.
 *
 *   Quatro seções, e as quatro levam a telas que existem:
 *     · `Meu trabalho`          — Notificações · Chat · Minhas tarefas ·
 *                                 Todas as tarefas · Quadro
 *     · `Entrega`               — Painel · Calendário · Planejamento
 *     · `Gestão`                — Controle da semana (só quem administra)
 *     · `Compartilhado comigo`  — a árvore da F17.14, inteira
 *   (nesta ordem desde a F28 — ver `SECOES_DA_BARRA`; `Gestão` desde a F43.)
 *
 * ⚠️ UMA BARRA SÓ — F43, Fase 8.
 *   O layout Foco pôs à esquerda da barra um trilho de ícones sem nome
 *   (Início, Notificações, Chat, Painel) e, acima de 1024px, escondia as cópias
 *   com nome desses mesmos itens. Eram duas navegações para os mesmos lugares,
 *   uma delas muda — o sino só se reconhecia passando o mouse — e três destinos
 *   existiam duas vezes no HTML. O trilho saiu: cada destino aparece UMA vez,
 *   com o nome, em qualquer largura. A coluna de ícones que continua existindo
 *   é a de `Somente ícones`, que a pessoa escolhe (ou o chat pede), e nela os
 *   nomes vão para o `title` e o `aria-label` do mesmo item.
 *
 * "BUSCAR OU IR PARA…" — F43, Fase 9.
 *   Abaixo da marca, um campo que abre a busca de destinos (telas, clientes,
 *   espaços, pastas e listas, e "Procurar tarefas com …"); `Ctrl + K` abre a
 *   mesma busca de qualquer tela. As regras moram em `@/board/ir-para`; o
 *   gatilho e a janela, em `@/board/IrPara`. Nada da barra mudou de lugar nem
 *   de nome por causa dele.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ O QUE **NÃO** ESTÁ AQUI, E POR QUÊ
 *   A referência do ClickUp tem Caixa de entrada, Respostas, Comentários
 *   atribuídos, Atividade do chat, Rascunhos e enviadas, Posts, Reuniões,
 *   Canais, Mensagens diretas, Habilidades, Planilhas de horas, Quadros
 *   brancos, Formulários, Clipes, Painéis e Planejador.
 *
 *   Nenhum deles está desenhado. Todos dependem de etapas que não existem, e
 *   botão morto é pior que botão ausente — é regra do projeto, e
 *   `tela-do-trabalho.test.ts` falha se algum desses nomes aparecer no HTML.
 *
 *   Meta, Pessoas e Catálogos também ficam de fora das SEÇÕES, por outro
 *   motivo: eles são de ÁREAS diferentes (ver `src/auth/areas.ts`), e um
 *   funcionário sem a área levaria 403 ao clicar. Isso é botão morto com um
 *   passo a mais. Desde a F29 eles moram no menu da conta, no pé
 *   (`ContaNoPe`), e só aparecem para quem tem a área — `podeVer`.
 *
 * QUEM É O DONO DA ÁRVORE
 *   No `/quadro`, a árvore já está carregada pela página — ela precisa dela
 *   para saber qual lista abrir. Então a página PASSA a árvore pronta, e a
 *   barra não busca de novo.
 *
 *   Nas outras telas não há ninguém para passar, e a barra busca sozinha. É a
 *   razão de `arvore` ser uma propriedade opcional, e não um dado que este
 *   componente sempre carrega: duas buscas por tela seria o preço de uma
 *   simetria que não serve a ninguém.
 *
 *   ⚠️ E DESDE A F17.CARGA02 A PERGUNTA MUDOU DE PESO. A leitura é uma consulta
 *   compartilhada (`useArvoreCompleta`): duas telas que a peçam ao mesmo tempo
 *   dividem UM pedido, e a segunda dentro da validade não pede nada. A
 *   propriedade continua existindo porque a página que já montou a árvore
 *   precisa passar a MESMA instância — com os nós revelados e o quadro ativo —,
 *   e não porque a busca ainda seria cara.
 */

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { type Area } from '@/auth/areas';
import { type NoDeEspaco, buildFullTree } from '@/board/arvore';
import { useArvoreCompleta } from '@/board/arvore-compartilhada';
import { ArvoreDoQuadro } from '@/board/ArvoreDoQuadro';
import { selo } from '@/board/avisos';
import { ContaNoPe } from '@/board/ContaNoPe';
import { GatilhoDoIrPara, JanelaDoIrPara } from '@/board/IrPara';
import {
  type Destino,
  ehAtalhoDaBusca,
  plataformaDoNavegador,
  teclaDoAtalho,
  telasDoIrPara,
} from '@/board/ir-para';
import { Personalizar } from '@/board/Personalizar';
import {
  ContextoDaColunaDaArvore,
  ContextoDaSecaoDaArvore,
  type ComposicaoDaBarra,
  ehAtalhoDeRecolher,
} from '@/board/secao-recolhivel';
import { chatVisivelNaBarra, modoDoChat } from '@/chat/chave';
import { useChatLive } from '@/chat/useChatLive';
import { api } from '@/lib/api';
import { useLugar, usePreferencias } from '@/ui/aparencia';
import { IconeArvore, IconeCasa, IconeChevron, IconeExpandir, IconeRecolher } from '@/ui/Icones';
import {
  type ItemDaBarra,
  type SecaoDaBarra,
  DESTINO_DO_ITEM,
  ROTULO_DA_SECAO,
  ROTULO_DO_ITEM,
  alternarAparencia,
  alternarArvoreEmColuna,
  alternarListas,
  alternarRecolhida,
  arvoreNaColuna,
  itensVisiveis,
  secoesVisiveis,
} from '@/ui/preferencias';
import { ehAdmin, podeVer, useSessao } from '@/ui/sessao';
import { Marca } from '@/ui/Marca';

/* ───────────────────────────── os ícones dos itens ───────────────────────────── */

/*
  Desenhados aqui, e não em `src/ui/Icones.tsx`: o arquivo compartilhado está
  sendo mexido por outra sessão agora, e estes só a barra usa. Quando um
  segundo lugar precisar deles, eles sobem. (O plugue e a engrenagem do pé
  foram com o pé para `ContaNoPe` — F29.)

  A casa do `Início` (F28) é a exceção, e nasceu lá: o arquivo compartilhado
  já não está em disputa, e casa é ícone que outra tela vai querer.
*/
const traco = (c = 'h-4 w-4') => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: c,
  'aria-hidden': true,
});

/* Notificações de menções, automações e prazos. */
const IconeAvisos = () => (
  <svg {...traco()}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
  </svg>
);

const IconeMinhas = () => (
  <svg {...traco()}>
    <path d="M4 6h10M4 12h10M4 18h7" />
    <path d="M17 6.5l1.6 1.6L22 4.7" />
  </svg>
);

const IconeTodas = () => (
  <svg {...traco()}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M9 9v11" />
  </svg>
);

const IconeQuadro = () => (
  <svg {...traco()}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v10" />
  </svg>
);

const IconePainel = () => (
  <svg {...traco()}>
    <path d="M3 13h6V4H3zM15 20h6v-9h-6zM3 20h6v-4H3zM15 8h6V4h-6z" />
  </svg>
);

const IconeCalendario = () => (
  <svg {...traco()}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const IconePlanejamento = () => (
  <svg {...traco()}>
    <path d="M4 5h16M4 12h10M4 19h13" />
    <circle cx="18" cy="12" r="2" />
  </svg>
);

const IconeChat = () => (
  <svg {...traco()}>
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
  </svg>
);

const IconeControle = () => (
  <svg {...traco()}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
    <path d="m9 16 2 2 4-4" />
  </svg>
);

const ICONE_DO_ITEM: Record<ItemDaBarra, () => JSX.Element> = {
  avisos: IconeAvisos,
  chat: IconeChat,
  minhas: IconeMinhas,
  todas: IconeTodas,
  quadro: IconeQuadro,
  painel: IconePainel,
  calendario: IconeCalendario,
  planejamento: IconePlanejamento,
  controle: IconeControle,
};

/* ───────────────────────────── a árvore que se busca sozinha ───────────────────────────── */

/**
 * A árvore, quando a página não a passou.
 *
 * Ela navega para `/quadro/:id`, que é onde a lista abre — a barra não desenha
 * quadro nenhum. Escrever e apagar continuam funcionando aqui: é a MESMA barra
 * do `/quadro`, e uma barra que edita numa tela e não edita na outra ensinaria
 * que a função some.
 */
function ArvoreBuscada({ listaAtiva, titulo }: { listaAtiva: string | null; titulo: string }) {
  // Navegação pelo ROTEADOR, e não `window.location`: escolher uma lista a
  // partir de `Minhas tarefas` recarregaria a página inteira, e a barra
  // piscaria junto com ela.
  const navigate = useNavigate();
  // `Ver arquivados` sobrevive ao F5 — F17.24. É o MESMO campo que o `/quadro`
  // usa: alternar aqui e ir para lá encontraria o interruptor como se deixou.
  const [lugar, definirLugar] = useLugar();
  /* A recusa de ESCRITA — a frase que o banco devolve ao criar, renomear ou
     arquivar. Ela é do gesto, e não da leitura, e por isso continua morando
     aqui; a da leitura vem da consulta compartilhada. */
  const [recusa, setRecusa] = useState<string | null>(null);
  /* Quem administra liga e desliga a marca "exige cliente" — F38, Fase 7. */
  const { sessao } = useSessao();

  const {
    linhas,
    empresas,
    recusa: recusaDaLeitura,
    recuperavel,
    estado,
    recarregar,
  } = useArvoreCompleta();

  const arvore: NoDeEspaco[] = useMemo(
    () => (linhas === null ? [] : buildFullTree(linhas)),
    [linhas],
  );

  /* A frase que está na tela agora, e se ela é da LEITURA. A do gesto vem
     primeiro: ela é a resposta ao que a pessoa acabou de fazer, e a da leitura
     já estava ali antes. */
  const frase = recusa ?? recusaDaLeitura;

  return (
    <>
      {frase && (
        <p className="bl-recusa">
          <span>{frase}</span>
          {/*
            ⚠️ A FALHA GANHOU TENTATIVA PRÓPRIA — F17.CARGA03.
            Até aqui esta barra ENGOLIA a recusa numa linha discreta sem saída:
            `Quadro` e `Pasta` ofereciam `Tentar de novo` e as outras catorze
            telas que desenham a barra, não. Quem estava em `Minhas tarefas`
            quando o wi-fi caiu ficava com um mapa vazio e uma frase, e a única
            saída era o F5 — que joga fora todo o resto da tela junto.

            Só quando a recusa é PASSAGEIRA, e o julgamento não é daqui: quem
            decide é `indisponivel`, em `@/lib/api`. Contra uma conta desativada
            (403) o botão não aparece — oferecer nova tentativa ali seria
            convidar a pessoa a bater na mesma porta.

            E só para a recusa da LEITURA: a do gesto (criar, renomear,
            arquivar) não se refaz relendo a árvore.
          */}
          {recusa === null && recuperavel && (
            <button type="button" className="bl-recusa-acao" onClick={() => void recarregar()}>
              Tentar de novo
            </button>
          )}
        </p>
      )}
      <ArvoreDoQuadro
        podeMarcarCompartilhada={sessao?.isSuperadmin === true}
        titulo={titulo}
        arvore={arvore}
        companies={empresas}
        leitura={estado}
        listaAtiva={listaAtiva}
        mostrarArquivados={lugar.arquivados}
        aoAlternarArquivados={(m) => definirLugar((l) => ({ ...l, arquivados: m }))}
        aoEscolher={(id) => navigate(`/quadro/${id}`)}
        /* O nome do espaço abre a visão geral — F17.26. Vale em TODAS as telas
           que desenham esta barra: uma função que existe no quadro e some em
           `Minhas tarefas` ensina que ela é instável. */
        aoAbrirEspaco={(id) => navigate(`/quadro/espaco/${id}`)}
        /* O nome da pasta abre o quadro dela — F17.64. Mesma regra do
           espaço: vale em TODAS as telas que desenham esta barra. */
        aoAbrirPasta={(id) => navigate(`/quadro/pasta/${id}`)}
        /* A lista trazida leva à ficha do cliente dela — F17.43. Vale em
           TODAS as telas que desenham esta barra, pela mesma razão de
           `aoAbrirEspaco`: função que existe numa tela e some na outra
           ensina que ela é instável. */
        aoAbrirCliente={(id) => navigate(`/cliente/${id}`)}
        aoRecarregar={recarregar}
        aoRecusar={setRecusa}
      />
    </>
  );
}

/* ───────────────────────────── a barra ───────────────────────────── */

export function BarraLateral({
  atual,
  arvore,
  listaAtiva = null,
  naoVistos,
  composicao,
}: {
  /**
   * Qual item está aberto agora. É o que ganha o fundo, como na referência.
   *
   * ⚠️ OPCIONAL DESDE A F17.67, e a ausência é uma resposta.
   *   A barra chegou a telas que não SÃO nenhum dos sete itens dela —
   *   `Catálogos`, `Pessoas`, a ficha da tarefa, as três da Meta. Acender um
   *   item ali seria a barra dizendo que a pessoa está num lugar onde ela não
   *   está; e mapa que mente é pior que mapa ausente, que é justamente o
   *   defeito que a etapa veio consertar. Sem `atual`, nada fica aceso.
   */
  atual?: ItemDaBarra;
  /**
   * A árvore já montada pela página. Quando ausente, a barra busca a sua —
   * ver o cabeçalho.
   */
  arvore?: ReactNode;
  listaAtiva?: string | null;
  /**
   * Quantos avisos ainda não foram vistos — F17.46.
   *
   * Vem de fora quando a PÁGINA já sabe o número, que é o caso da própria caixa
   * de entrada: lá a pessoa marca um aviso e a pastilha tem de cair no mesmo
   * instante. Nas outras telas ninguém sabe, e a barra pergunta sozinha — pelo
   * mesmo desenho da árvore, e pelo mesmo motivo.
   */
  naoVistos?: number;
  /**
   * O desenho adaptado ao espaço — F02. Ausente (grade montada à mão sem o
   * gancho), a barra segue a preferência guardada, como sempre fez.
   */
  composicao?: ComposicaoDaBarra;
}) {
  const [prefs, definirPrefs] = usePreferencias();
  /* Recolher e expandir passam por aqui: com a composição medida, o rail que
     o espaço impôs não vira escolha gravada (F02). */
  const alternarBarra = useCallback(
    () => (composicao ? composicao.alternarBarra() : definirPrefs(alternarAparencia(prefs))),
    [composicao, prefs, definirPrefs],
  );
  const [personalizando, setPersonalizando] = useState(false);
  const { sessao, carregando } = useSessao();

  /**
   * A GAVETA — F17.75, e ela só existe abaixo de 1024px.
   *
   * ⚠️ POR QUE A BARRA PRECISOU SAIR DO FLUXO
   *   Medido no Chrome, quadro da pasta `TIME HELENA` em 820×900: `.q-tela`
   *   começa em y=112 e o quadro (`.q-conteudo`) só começa em **y=1.627**. Os
   *   1.515px do meio são a barra empilhada em cima dele. A página inteira dava
   *   2.593px numa janela de 900 — e o quadro pedia 942 desses.
   *
   *   Era esse empilhamento, e nada mais, que impedia a cadeia de altura da
   *   F17.27 de valer na faixa estreita. Com a barra fora do fluxo a razão
   *   morre, e a mesma cadeia de sempre passa a servir em qualquer largura.
   *
   * ⚠️ ATÉ A F29 O ESTADO NÃO SE FECHAVA SOZINHO AO ALARGAR, E AGORA FECHA
   *   Acima de 1024px a folha esconde o botão e o véu e devolve a barra à grade,
   *   e um `aberta` esquecido não desenhava nada — um `resize` ouvido aqui
   *   seria só um segundo lugar dizendo o que a media query já diz.
   *
   *   A F29 deu peso ao estado: a gaveta abre SEMPRE expandida, mesmo com a
   *   preferência em `Somente ícones` (ver `soIcones`). Uma gaveta esquecida
   *   aberta ao alargar a janela desenharia os rótulos na coluna de 3.5rem da
   *   grade em ícones. Então a travessia da largura fecha a gaveta — ouvindo a
   *   MESMA fronteira da folha (`matchMedia`), e não o `resize` inteiro.
   */
  const [gavetaAberta, setGavetaAberta] = useState(false);

  useEffect(() => {
    const larga = window.matchMedia?.('(min-width: 1024px)');
    if (!larga) return;
    const aoCruzar = () => {
      if (larga.matches) setGavetaAberta(false);
    };
    larga.addEventListener('change', aoCruzar);
    return () => larga.removeEventListener('change', aoCruzar);
  }, []);

  /**
   * A GAVETA COMO JANELA — F02: foco entra, `Esc` fecha, o foco volta.
   *
   * Abrindo, o foco vai ao primeiro item da gaveta (quem abriu pelo teclado
   * não precisa atravessar a página para chegar nela). `Esc` fecha, e `Tab`
   * não escapa para a página escurecida atrás do véu: do último item volta ao
   * primeiro, e vice-versa. Fechando — por `Esc`, pelo véu ou por um item —,
   * o foco volta ao botão `Listas e atalhos` se ele ainda estiver na tela.
   */
  const abrirRef = useRef<HTMLButtonElement>(null);
  const gavetaJaAbriu = useRef(false);
  useEffect(() => {
    if (!gavetaAberta) {
      if (gavetaJaAbriu.current) {
        gavetaJaAbriu.current = false;
        const botao = abrirRef.current;
        if (botao && botao.isConnected && !botao.contains(document.activeElement)) {
          const foco = document.activeElement;
          /* Um item da gaveta que navegou leva o foco com a página nova: só
             devolve se o foco ficou perdido (no `body`) ou dentro da gaveta. */
          if (!foco || foco === document.body || barraRef.current?.contains(foco)) botao.focus();
        }
      }
      return;
    }
    gavetaJaAbriu.current = true;
    const barra = barraRef.current;
    const focaveis = () =>
      Array.from(
        barra?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex="0"]') ?? [],
      ).filter((el) => el.offsetParent !== null);
    focaveis()[0]?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        /* Um menu aberto dentro da gaveta (Personalizar, a conta) fecha
           primeiro, pelo próprio `Esc` dele. */
        if (e.defaultPrevented) return;
        e.preventDefault();
        setGavetaAberta(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = focaveis();
      if (lista.length === 0) return;
      const primeiro = lista[0];
      const ultimo = lista[lista.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [gavetaAberta]);

  /**
   * RECOLHER A BARRA PELO TECLADO — F29: `Ctrl + .` (`⌘ + .` no Mac).
   *
   * Só acima de 1024px: abaixo dali a barra é a gaveta, que abre sempre
   * expandida, e o atalho trocaria uma preferência sem nada mudar na tela —
   * um gesto sem resposta visível ensina que o atalho não funciona. A lista
   * dos atalhos que já existem, e por que este não colide, está em
   * `ehAtalhoDeRecolher`.
   */
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (!ehAtalhoDeRecolher(e)) return;
      if (!window.matchMedia?.('(min-width: 1024px)').matches) return;
      e.preventDefault();
      alternarBarra();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [alternarBarra]);

  /**
   * ONDE A BARRA COMEÇA NA PÁGINA — F28.
   *
   * ⚠️ O TETO DA BARRA É `100vh` MENOS ISTO, e não menos um chute. Medido em
   *   1280×720 com a página no topo: `/painel` ia de 63 a 759 e `Minhas
   *   tarefas` de 72 a 768 — o pé ("Agentes de IA") abaixo da dobra, porque o
   *   `calc(100vh - 1.5rem)` da F17.50 contava a barra como se ela nascesse no
   *   topo da janela. Ver o bloco de `.bl-barra` em `ui/clickup.css`.
   *
   * Mede a GRADE (o pai), e não a barra: a barra é `sticky`, e com a página
   *   rolada a caixa dela diz onde ela grudou, não onde ela nasce.
   *
   * Remede quando a página muda de tamanho — o cabeçalho acima da grade pode
   *   quebrar em duas linhas numa janela mais estreita. Guarda identidade: sem
   *   mudança, nenhum desenho novo. `useEffect`, e não `useLayoutEffect`, pelo
   *   mesmo motivo de `Balao`: a suíte desenha com `renderToStaticMarkup`, e lá
   *   este efeito não roda — a folha cai no teto de antes.
   *
   * Nas telas de cadeia de altura (quadro e pasta) a variável existe e não
   *   manda: `.q-tela[data-altura='tela'] > .bl-barra` põe `max-height: 100%`
   *   e ganha por especificidade. A cadeia da F17.27/F17.72 não é tocada.
   */
  const barraRef = useRef<HTMLDivElement>(null);
  const [inicio, setInicio] = useState<number | null>(null);
  useEffect(() => {
    const grade = barraRef.current?.parentElement;
    if (!grade) return;
    const medir = () => {
      const y = Math.round(grade.getBoundingClientRect().top + window.scrollY);
      setInicio((v) => (v === y ? v : y));
    };
    medir();
    window.addEventListener('resize', medir);
    const olho = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    olho?.observe(document.body);
    return () => {
      window.removeEventListener('resize', medir);
      olho?.disconnect();
    };
  }, []);

  /* ⚠️ A PASTILHA É O QUE FAZ ISTO SER AVISO, E NÃO MAIS UMA TELA.
     Sem ela, "isto chegou para você" mora numa página que a pessoa precisa
     LEMBRAR de abrir — que é exatamente o defeito que a etapa veio consertar:
     *"a tarefa cai na tela da pessoa e ela descobre quando abrir"*.

     A conta tem rota própria (`/board/notices/count`) porque roda em toda tela
     que desenha esta barra. Falha em silêncio de propósito: uma barra lateral
     que mostra recusa por causa de um número seria a moldura reclamando de si
     mesma em todas as telas de uma vez. */
  const [contados, setContados] = useState<number | null>(null);

  useEffect(() => {
    if (naoVistos !== undefined) return;
    let vivo = true;
    const ler = () => {
      if (document.visibilityState === 'hidden') return;
      void api.contarAvisos().then((r) => { if (vivo) setContados(r.unread); }).catch(() => {});
    };
    ler();
    const timer = window.setInterval(ler, 30000);
    window.addEventListener('focus', ler);
    document.addEventListener('visibilitychange', ler);
    return () => {
      vivo = false; window.clearInterval(timer);
      window.removeEventListener('focus', ler); document.removeEventListener('visibilitychange', ler);
    };
  }, [naoVistos]);

  /* Não lidas do chat — F20.6. Qualquer tela: o gerente de conexão mantém o
     número pela conexão ao vivo. Falha em silêncio (o gerente já engole). */
  const { naoLidas: chatNaoLidas, aoEvento } = useChatLive();
  const pastilhaChat = selo(chatNaoLidas);

  /* Menção no chat — F20.8: o sino sobe na hora, sem esperar os 30 s. */
  useEffect(() => {
    if (naoVistos !== undefined) return;
    return aoEvento((evento) => {
      if (evento.type !== 'chat_mention') return;
      void api.contarAvisos().then((r) => setContados(r.unread)).catch(() => {});
    });
  }, [naoVistos, aoEvento]);

  const pastilha = selo(naoVistos ?? contados ?? 0);

  /* ⚠️ A ÁREA ENTRA NA CONTA — F17.36.
     Enquanto o quadro era parte da entrega, quem chegava a esta barra
     alcançava tudo o que ela oferece. Com `quadro` separado, alguém pode ter o
     quadro e não ter a entrega — e Painel, Calendário e Planejamento viravam
     botão que responde 403.

     Enquanto a sessão carrega, `podeVer` diz sim a tudo: esconder e revelar faz
     o menu piscar e empurra o botão para debaixo do cursor no instante do
     clique. Quem recusa de verdade é o servidor. */
  const alcanca = useCallback((area: Area) => podeVer(sessao, area), [sessao]);
  /* F40, Fase 7: o `Controle da semana` é por PAPEL — ver `ITENS_SO_ADMIN`. */
  const souAdmin = ehAdmin(sessao);

  /* A chave do chat (IDEWORKS_CHAT) esconde o item — F20.5. Piloto: só super. */
  const chatOk = chatVisivelNaBarra(
    modoDoChat(),
    carregando ? null : (sessao?.isSuper ?? false),
  );
  const itensDaSecao = useCallback(
    (secao: Parameters<typeof itensVisiveis>[1]) =>
      itensVisiveis(prefs, secao, alcanca, souAdmin).filter((i) => i !== 'chat' || chatOk),
    [prefs, alcanca, chatOk, souAdmin],
  );

  /**
   * "IR PARA…" — F43, Fase 9: `Ctrl + K` (`⌘ + K` no Mac) de qualquer tela, ou
   * o campo no alto da barra.
   *
   * MORA AQUI porque a barra é a única peça presente em TODA tela com sessão
   *   (`toda-tela-tem-barra`) e já sabe o que a sessão alcança — `alcanca`,
   *   `souAdmin` e `chatOk` logo acima são os mesmos números que decidem os
   *   itens. Uma janela só, fechada por padrão; aberta, ela mora em portal.
   *
   * O OUVIDO É DA JANELA DO NAVEGADOR, e quem decide é `ehAtalhoDaBusca`: fora
   *   de campo de texto (o editor rico continua com o `Ctrl + K` dele, "inserir
   *   link") e fora de outra janela aberta. Abre — e não alterna: com a busca
   *   aberta o foco está no campo dela, e quem fecha com a mesma tecla é ela.
   *   Vale também com a gaveta do celular fechada: quem tem teclado não precisa
   *   abrir a gaveta para buscar.
   */
  const [irPara, setIrPara] = useState(false);
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (!ehAtalhoDaBusca(e)) return;
      e.preventDefault();
      setIrPara(true);
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);
  const teclaDaBusca = useMemo(() => teclaDoAtalho(plataformaDoNavegador()), []);
  const telasDaBusca = useMemo(
    () => telasDoIrPara({ alcanca, souAdmin, chatOk }),
    [alcanca, souAdmin, chatOk],
  );
  /* PELO ROTEADOR, e não `window.location`: é o `navigate` que passa pela
     guarda de saída da ficha ("Sair sem salvar?", `Moldura`). A janela fecha
     ANTES — se a guarda perguntar, a pergunta aparece sozinha na tela, e não
     embaixo da busca. A gaveta fecha junto: ir para outra lista da mesma tela
     (o `/quadro` não desmonta) deixaria a gaveta aberta por cima do destino. */
  const navigate = useNavigate();
  const irAoDestino = useCallback(
    (destino: Destino) => {
      setIrPara(false);
      setGavetaAberta(false);
      navigate(destino.para);
    },
    [navigate],
  );

  const secoes = secoesVisiveis(prefs, alcanca, souAdmin).filter((s) => {
    if (s === 'arvore') return true;
    return itensDaSecao(s).length > 0;
  });
  /* ⚠️ A GAVETA ABRE SEMPRE EXPANDIDA — F29. Abaixo de 1024px a barra é uma
     gaveta de 20rem, e não uma coluna estreita: ícones soltos ali seriam
     espaço jogado fora e nomes escondidos de quem mais precisa lê-los (o
     telefone não tem `title` ao passar o mouse). A PREFERÊNCIA não muda: ela
     volta a valer quando a gaveta fecha e a janela alarga. */
  const soIcones = (composicao?.aparencia ?? prefs.aparencia) === 'icones' && !gavetaAberta;

  /**
   * SEÇÃO RECOLHIDA PELO TÍTULO — F29.
   *
   * Em `Somente ícones` o recolhido é IGNORADO e todos os ícones aparecem: ali
   * o título não é desenhado, e uma seção fechada não teria onde ser reaberta
   * sem expandir a barra antes — o item sumiria sem caminho de volta à vista.
   * A escolha fica guardada e volta a valer quando a barra expande.
   */
  const recolhida = (secao: SecaoDaBarra) => !soIcones && prefs.recolhidas[secao];

  /**
   * A ÁRVORE NA COLUNA PRÓPRIA — F29 (decisão 5 do plano).
   *
   * A conta é `arvoreNaColuna`, a MESMA que a página faz para abrir a terceira
   * faixa da grade (`useArvoreNaColuna`): se a barra desenhasse a coluna e a
   * grade não a esperasse, a coluna cairia no lugar do conteúdo — e o
   * contrário deixaria 16.5rem vazios. A gaveta aberta é a única coisa que só
   * a barra sabe, e ela não mexe na grade: abaixo de 1024px a grade não tem
   * três faixas e a coluna não é desenhada pela folha. Com a gaveta aberta a
   * árvore volta para dentro dela — no celular ela fica sempre dentro.
   *
   * ⚠️ A ÁRVORE É A MESMA INSTÂNCIA, só muda de lugar: a que o Quadro, a Pasta
   *   e o Espaço passam pronta (`arvore`), ou a `ArvoreBuscada` — que lê a
   *   consulta compartilhada, então trocar de lugar não busca de novo.
   */
  const naColuna =
    (composicao ? composicao.arvoreNaColuna : arvoreNaColuna(prefs, alcanca)) && !gavetaAberta;
  /* AS LISTAS RECOLHIDAS — F02B (R08). Uma coluna de cada vez: o menu não
     esconde mais as listas, e as listas têm o próprio `«`. Recolhidas, a barra
     mostra no lugar da árvore o caminho de volta (a linha "Compartilhado
     comigo", ou o ícone no rail). Na gaveta a árvore fica sempre dentro. */
  const listasRecolhidas =
    prefs.arvoreEmColuna && prefs.listasRecolhidas && !gavetaAberta && secoes.includes('arvore');
  /* Reabrindo as listas, a coluna viria com o menu como está? Decide o que o
     ícone da árvore faz no rail: alterna as listas, ou expande o menu (F29). */
  const listasCabem =
    (composicao
      ? composicao.listasCabem
      : arvoreNaColuna({ ...prefs, listasRecolhidas: false }, alcanca)) && !gavetaAberta;
  /* O foco segue o botão que some — o mesmo cuidado de `focarOBotaoDaColuna`:
     o `«` da coluna some com ela, e a linha de reabrir some ao reabrir. O
     ícone do rail não some, e o foco fica nele. */
  const focarAsListas = useRef(false);
  /* ⚠️ A ROLAGEM DA ÁRVORE SOBREVIVE A RECOLHER E REABRIR AS LISTAS —
     verificação da F02B (Aceite do R08). Recolher desmonta a coluna, e a
     árvore remontada nascia no topo. Seleção e grupos abertos já voltam
     (moram no `lugar`); a rolagem mora no DOM, então é lida AO RECOLHER — com
     a coluna ainda na tela — e devolvida quando ela volta. Quem rola é a
     própria `.cu-arvore` (ver `.q-barra.cu-arvore` em `clickup.css`). */
  const rolagemDasListas = useRef<number | null>(null);
  const alternarAsListas = useCallback(
    (moverFoco: boolean) => {
      focarAsListas.current = moverFoco;
      if (!prefs.listasRecolhidas) {
        const topo = document.querySelector<HTMLElement>('#bl-coluna-listas .cu-arvore')?.scrollTop;
        rolagemDasListas.current = topo ? topo : null;
      }
      definirPrefs(alternarListas(prefs));
    },
    [prefs, definirPrefs],
  );
  useEffect(() => {
    const alvo = rolagemDasListas.current;
    if (!naColuna || alvo === null) return;
    rolagemDasListas.current = null;
    /* A árvore buscada pode chegar depois da montagem: tenta por até 60
       quadros (~1 s) até a altura comportar a posição. */
    let voltas = 0;
    let quadro = 0;
    const tentar = () => {
      const el = document.querySelector<HTMLElement>('#bl-coluna-listas .cu-arvore');
      if (el) {
        el.scrollTop = alvo;
        if (el.scrollTop >= alvo - 1) return;
      }
      if (++voltas < 60) quadro = requestAnimationFrame(tentar);
    };
    tentar();
    return () => cancelAnimationFrame(quadro);
  }, [naColuna]);
  useEffect(() => {
    if (!focarAsListas.current) return;
    focarAsListas.current = false;
    const alvo = listasRecolhidas
      ? '.bl-barra .bl-item-arvore'
      : naColuna
        ? '.bl-coluna .bl-recolher-listas'
        : '.bl-barra .cu-arvore-topo .bl-secao-alternar';
    barraRef.current?.parentElement?.querySelector<HTMLElement>(alvo)?.focus();
  }, [listasRecolhidas, naColuna]);
  /* ⚠️ O FOCO ACOMPANHA O BOTÃO — F29 (verificação da Fase 3). O botão que
     foi clicado some com a árvore (ela troca de lugar e é montada de novo), e
     o foco caía no `body`: quem alterna pelo teclado tinha de começar a
     tabulação do zero. A marca só nasce no clique, então uma troca vinda de
     outra aba (a preferência é compartilhada) não rouba o foco de ninguém. */
  const focarOBotaoDaColuna = useRef(false);
  const alternarColuna = useCallback(() => {
    focarOBotaoDaColuna.current = true;
    definirPrefs(alternarArvoreEmColuna(prefs));
  }, [prefs, definirPrefs]);
  useEffect(() => {
    if (!focarOBotaoDaColuna.current) return;
    focarOBotaoDaColuna.current = false;
    barraRef.current?.parentElement
      ?.querySelector<HTMLElement>(naColuna ? '.bl-coluna .bl-soltar-arvore' : '.bl-barra .bl-soltar-arvore')
      ?.focus();
  }, [naColuna]);
  /* ⚠️ O FOCO SEGUE O ÍCONE ÚNICO DA ÁRVORE — F29 (Fase 4, achado da
     verificação da Fase 3). Em `Somente ícones` a árvore é um ícone que
     EXPANDE a barra; o ícone some com a expansão e o foco caía no `body`. Ele
     vai para o título da árvore, que é o que a pessoa pediu para ver: o botão
     que recolhe a seção, na barra; o próprio título, na coluna (lá ele não é
     botão, e recebe o foco por `tabIndex={-1}` em `ArvoreDoQuadro`). Mesmo
     desenho de `focarOBotaoDaColuna`: a marca só nasce no clique. */
  const focarOTituloDaArvore = useRef(false);
  useEffect(() => {
    if (!focarOTituloDaArvore.current || soIcones) return;
    focarOTituloDaArvore.current = false;
    barraRef.current?.parentElement
      ?.querySelector<HTMLElement>(
        naColuna ? '.bl-coluna .cu-arvore-topo h2' : '.bl-barra .cu-arvore-topo .bl-secao-alternar',
      )
      ?.focus();
  }, [soIcones, naColuna]);
  /* O botão só existe onde a coluna pode existir — ver `ContextoDaColunaDaArvore`. */
  const colunaNaBarra = useMemo(
    () =>
      gavetaAberta || composicao?.colunaCabe === false
        ? null
        : { ligada: false, alternar: alternarColuna },
    [gavetaAberta, composicao?.colunaCabe, alternarColuna],
  );
  const colunaLigada = useMemo(
    () => ({ ligada: true, alternar: alternarColuna, recolher: () => alternarAsListas(true) }),
    [alternarColuna, alternarAsListas],
  );

  /* A árvore, onde quer que ela more agora: a pronta da página, ou a buscada. */
  const aArvore = arvore ?? (
    <ArvoreBuscada listaAtiva={listaAtiva} titulo={ROTULO_DA_SECAO.arvore} />
  );

  /* O mesmo teto da barra vale para a coluna: as duas nascem na mesma linha
     da grade. Ver o bloco de `inicio` acima e `.bl-coluna` em `clickup.css`. */
  const estiloDoInicio =
    inicio === null ? undefined : ({ '--bl-inicio': `${inicio}px` } as CSSProperties);

  /* A seção da árvore escuta pelo contexto — ver `@/board/secao-recolhivel`.
     Nulo em `Somente ícones`: a árvore desenha o título simples, como antes. */
  const secaoDaArvore = useMemo(
    () =>
      soIcones
        ? null
        : {
            recolhida: prefs.recolhidas.arvore,
            alternar: () => definirPrefs(alternarRecolhida(prefs, 'arvore')),
            idDosItens: 'bl-itens-arvore',
          },
    [soIcones, prefs, definirPrefs],
  );

  const item = (chave: ItemDaBarra) => {
    const Icone = ICONE_DO_ITEM[chave];
    const conta =
      chave === 'avisos' ? pastilha : chave === 'chat' ? pastilhaChat : null;
    /* O número entra no NOME acessível, e não só no desenho: quem usa leitor de
       tela ouve "Caixa de entrada, 3 novos" em vez de ouvir o rótulo e perder
       a única informação que muda sozinha. */
    const unidade =
      chave === 'chat'
        ? conta === '1'
          ? 'não lida'
          : 'não lidas'
        : conta === '1'
          ? 'novo'
          : 'novos';
    const nome =
      conta === null
        ? ROTULO_DO_ITEM[chave]
        : `${ROTULO_DO_ITEM[chave]}, ${conta} ${unidade}`;
    return (
      <Link
        key={chave}
        to={DESTINO_DO_ITEM[chave]}
        className="bl-item"
        data-atual={atual === chave}
        title={nome}
        aria-label={nome}
        aria-current={atual === chave ? 'page' : undefined}
      >
        <Icone />
        {/* Em `Somente ícones` o nome sai do desenho e fica no `title` e no
            `aria-label`: some para o olho, nunca para o leitor de tela. */}
        {!soIcones && <span className="bl-item-nome">{ROTULO_DO_ITEM[chave]}</span>}
        {/* A pastilha FICA mesmo em `Somente ícones`: ela é o aviso, e um aviso
            que some quando a barra encolhe é um aviso que não se pode
            depender. `aria-hidden` porque o nome acima já a diz por extenso —
            sem isso, o leitor de tela leria o número duas vezes. */}
        {conta !== null && (
          <span className="bl-selo tnum" aria-hidden>
            {conta}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* PULAR PARA O CONTEÚDO — F29 (Fase 5a, achado da verificação da 4).

          Sem o `‹ Voltar`, a primeira saída do topo de cada tela ficou a ~250
          Tabs: a barra vem antes da coluna de conteúdo no HTML, e a árvore
          dela tem um item por lista. Este link é o PRIMEIRO item focável de
          toda tela com barra — por isso mora aqui, e não em cada tela: toda
          tela com barra passa por esta peça — e leva o foco ao topo da página
          (`#conteudo`, o `Topo`).

          Invisível até receber foco (`.bl-pular`, em `clickup.css`), e fora da
          grade quando aparece: é `position: fixed`, então não ocupa célula nem
          empurra a barra.

          ⚠️ O CLIQUE NÃO DEIXA O NAVEGADOR SEGUIR A ÂNCORA. Seguir `#conteudo`
          criaria uma entrada de histórico sem o índice do roteador, e o X da
          ficha da tarefa (`comoVoltar`) leria "não há passo anterior" logo
          depois de a pessoa ter navegado. O `href` fica pelo significado —
          leitor de tela anuncia "link, mesma página" — e sem o alvo na tela o
          navegador faz o de sempre. */}
      <a
        href="#conteudo"
        className="bl-pular"
        onClick={(e) => {
          const alvo = document.getElementById('conteudo');
          if (alvo === null) return;
          e.preventDefault();
          alvo.focus({ preventScroll: true });
          window.scrollTo({ top: 0 });
        }}
      >
        Pular para o conteúdo
      </a>

      {/* ⚠️ O BOTÃO DA GAVETA É O ÚNICO ITEM NOVO NO DESENHO, e ele some acima
          de 1024px. Ele fica no FLUXO, e não flutuando: um botão fixo no canto
          cobre o que estiver embaixo dele — a colisão que a F17.27 mediu por
          cima do `+ Adicionar tarefa`, e a razão de o botão fixo de tema ter
          saído em 2026-09-11. */}
      <button
        type="button"
        ref={abrirRef}
        className="bl-abrir"
        onClick={() => setGavetaAberta(true)}
        aria-expanded={gavetaAberta}
        aria-controls="barra-lateral"
      >
        <span aria-hidden>☰</span>
        Listas e atalhos
      </button>

      {/* O VÉU. Ele é um botão, e não uma `div` com `onClick`: fechar a gaveta
          precisa estar no caminho do teclado, e `Esc` sozinho não basta para
          quem navega por tabulação. */}
      {gavetaAberta && (
        <button
          type="button"
          className="bl-veu"
          onClick={() => setGavetaAberta(false)}
          aria-label="Fechar as listas e atalhos"
        />
      )}

      <div
        ref={barraRef}
        id="barra-lateral"
        className="bl-barra"
        /* A aparência DESENHADA, e não a guardada — F29: a gaveta é sempre
           expandida, e todas as regras de `Somente ícones` da folha olham
           este atributo. */
        data-aparencia={soIcones ? 'icones' : 'icones-e-rotulos'}
        data-gaveta={gavetaAberta ? 'aberta' : 'fechada'}
        /* F29: sem a árvore (ícone único, ou ela na coluna), a barra perde a
           única peça que crescia até o pé — e o chip da conta subia para o
           meio da janela. A folha devolve a altura e o chip ao pé por este
           atributo. Ver `.bl-barra[data-arvore='fora']` em `clickup.css`. */
        data-arvore={soIcones || naColuna || listasRecolhidas ? 'fora' : undefined}
        style={estiloDoInicio}
      >
      {/*
        A LINHA DO ALTO — F29: a marca e o botão de recolher, como a barra do
        Claude que o Wesley mostrou.

        Recolher é a aparência `Somente ícones`, que já existia (e continua) em
        `Personalizar`: o botão só a põe a um clique, e grava pelo MESMO
        `definirPrefs` — um lugar só guardando a escolha, e a grade de cada
        página (`.q-tela[data-barra]`) ouve a troca pelo evento de sempre.

        Recolhida, a linha fica só com o botão de expandir: a marca não cabe
        ao lado dele numa coluna de 3.5rem sem espremer os dois, e o botão é o
        que a pessoa precisa achar ali.

        ⚠️ A MARCA VOLTOU À BARRA. A F28 a tirou daqui porque repetia o "ide"
        do cabeçalho da página; a F29 a quer AQUI e tira a do cabeçalho (fases
        4 e 5a do plano). Desde a Fase 5a nenhuma tela a escreve no título
        (`@/ui/Topo`): a marca mora só aqui.

        Na gaveta o botão não aparece: abaixo de 1024px recolher não se aplica.
      */}
      <div className="bl-topo">
        {!soIcones && <Marca className="bl-topo-marca" />}
        {!gavetaAberta && (
          <button
            type="button"
            className="bl-recolher"
            onClick={alternarBarra}
            aria-label={soIcones ? 'Expandir a barra' : 'Recolher a barra'}
            title={soIcones ? 'Expandir a barra (Ctrl ou ⌘ + .)' : 'Recolher a barra (Ctrl ou ⌘ + .)'}
            aria-expanded={!soIcones}
          >
            {soIcones ? <IconeExpandir /> : <IconeRecolher />}
          </button>
        )}
      </div>

      {/* "BUSCAR OU IR PARA…" — F43, Fase 9. Logo abaixo da marca e antes do
          `Início`: é o primeiro gesto de quem sabe o nome do lugar, e mora no
          alto como a busca de qualquer barra. Um botão (abre a janela), e não
          um campo — ver `GatilhoDoIrPara`. Ele não tira nada do lugar: o
          `Pular para o conteúdo` continua o primeiro focável da tela, a marca e
          o `Recolher` continuam na linha de cima, e o `Início` e as seções
          seguem logo abaixo, na mesma ordem. Na gaveta do celular ele vem
          junto, dentro dela; com teclado, o `Ctrl + K` vale de gaveta fechada. */}
      <GatilhoDoIrPara
        soIcones={soIcones}
        tecla={teclaDaBusca}
        aberto={irPara}
        aoAbrir={() => setIrPara(true)}
      />

      {/* O topo: para onde `Início` mandou. Ver a aba `Início` do painel.

          ⚠️ ERA A MARCA ("ide Trabalho") ATÉ A F28, e deixou de ser porque
          repetia: o cabeçalho de `PaginaLarga` já escreve "ide" logo acima da
          barra, e a mesma marca duas vezes em 100px é ruído que ninguém lê. O
          que o topo FAZIA — levar à tela inicial escolhida — continua, agora
          com a cara de um item: ícone de casa e o nome do gesto.

          Ele usa `.bl-item` (o mesmo desenho, o mesmo hover, o mesmo modo
          `Somente ícones`) e não ganha `data-atual`: `Início` não é uma tela,
          é um atalho para uma delas — e o item dessa tela já acende sozinho
          logo abaixo. Dois itens acesos para o mesmo lugar seriam um a mais.

          F43 Fase 8: ele é o ÚNICO `Início` da barra. O trilho do layout Foco
          tinha outro, só com a casa, e este ficava escondido acima de 1024px. */}
      <Link
        to={DESTINO_DO_ITEM[prefs.telaInicial]}
        className="bl-item bl-inicio"
        title={`Início — abre em ${ROTULO_DO_ITEM[prefs.telaInicial]}`}
        aria-label={`Início — abre em ${ROTULO_DO_ITEM[prefs.telaInicial]}`}
      >
        <IconeCasa />
        {!soIcones && <span className="bl-item-nome">Início</span>}
      </Link>

      {secoes.map((secao) => {
        if (secao === 'arvore') {
          /*
            EM `Somente ícones`, UM ÍCONE SÓ NO LUGAR DA ÁRVORE — F29.
            Medido na Fase 1: numa coluna de 3.5rem a árvore inteira vazava da
            borda — cinquenta ícones de espaço além dela, sem nome que se lesse.
            A árvore é navegação de quem ORGANIZA, e organizar pede os nomes:
            o ícone expande a barra, e a árvore volta onde estava (na barra, ou
            na coluna, se o modo estiver ligado — `arvoreEmColuna` não muda com
            a aparência). Botão, e não link: ele não leva a lugar nenhum.
          */
          /* F02B: árvore em coluna que cabe — o ícone alterna SÓ as listas,
             e o menu fica em rail. `aria-expanded` diz se a coluna está à
             vista; o nome diz o que o clique faz. */
          if (soIcones && listasCabem) {
            const nome = `${ROTULO_DA_SECAO.arvore} — ${naColuna ? 'recolher listas' : 'mostrar listas'}`;
            return (
              <div key={secao} className="bl-secao">
                <button
                  type="button"
                  className="bl-item bl-item-arvore"
                  aria-label={nome}
                  title={nome}
                  aria-expanded={naColuna}
                  aria-controls={naColuna ? 'bl-coluna-listas' : undefined}
                  onClick={() => alternarAsListas(false)}
                >
                  <IconeArvore />
                </button>
              </div>
            );
          }
          if (soIcones) {
            return (
              <div key={secao} className="bl-secao">
                <button
                  type="button"
                  className="bl-item bl-item-arvore"
                  aria-label={`${ROTULO_DA_SECAO.arvore} — expandir a barra`}
                  title={`${ROTULO_DA_SECAO.arvore} — expandir a barra`}
                  onClick={() => {
                    focarOTituloDaArvore.current = true;
                    alternarBarra();
                  }}
                >
                  <IconeArvore />
                </button>
              </div>
            );
          }
          /* Na coluna própria, a barra perde a seção — ela está ao lado. */
          if (naColuna) return null;
          /* F02B: LISTAS RECOLHIDAS, COM O MENU ABERTO — a linha que as
             reabre, no lugar onde a árvore morava. O nome visível é o da
             seção (a pessoa a reconhece), e o » à direita diz "abre ao lado".
             Onde a coluna não cabe (chat, janela estreita), reabrir traz a
             árvore para dentro da barra — ela nunca some sem caminho de volta. */
          if (listasRecolhidas) {
            const nome = `${ROTULO_DA_SECAO.arvore} — mostrar listas`;
            return (
              <div key={secao} className="bl-secao">
                <button
                  type="button"
                  className="bl-item bl-item-arvore bl-mostrar-listas"
                  aria-label={nome}
                  title={nome}
                  aria-expanded={false}
                  onClick={() => alternarAsListas(true)}
                >
                  <IconeArvore />
                  <span className="bl-item-nome">{ROTULO_DA_SECAO.arvore}</span>
                  <IconeExpandir className="bl-mostrar-listas-seta" />
                </button>
              </div>
            );
          }
          return (
            <ContextoDaSecaoDaArvore.Provider key={secao} value={secaoDaArvore}>
              <ContextoDaColunaDaArvore.Provider value={colunaNaBarra}>
                <div className="bl-secao bl-secao-arvore">{aArvore}</div>
              </ContextoDaColunaDaArvore.Provider>
            </ContextoDaSecaoDaArvore.Provider>
          );
        }
        const fechada = recolhida(secao);
        const idDosItens = `bl-itens-${secao}`;
        return (
          <nav key={secao} className="o-card bl-secao p-2" aria-label={ROTULO_DA_SECAO[secao]}>
            {/* O TÍTULO É O BOTÃO — F29. Botão dentro do `h2`, e não o
                contrário: o título continua sendo o nome da seção para quem
                navega por cabeçalhos, e o botão diz se ela está aberta. */}
            {!soIcones && (
              <h2 className="eyebrow bl-secao-titulo">
                <button
                  type="button"
                  className="bl-secao-alternar"
                  aria-expanded={!fechada}
                  aria-controls={idDosItens}
                  onClick={() => definirPrefs(alternarRecolhida(prefs, secao))}
                >
                  {/* F29: SVG, girado pela folha a partir do `aria-expanded`. */}
                  <IconeChevron className="bl-seta" />
                  {ROTULO_DA_SECAO[secao]}
                </button>
              </h2>
            )}
            {/* A caixa fica mesmo vazia: é o alvo do `aria-controls`. */}
            <div id={idDosItens} className="bl-secao-itens">
              {!fechada && itensDaSecao(secao).map((chave) => item(chave))}
            </div>
          </nav>
        );
      })}

      {/*
        O PÉ É A CONTA, E O CHIP NUNCA SOME — F29. É A MESMA TRAVA DE ANTES.
        Até a F28 o pé eram dois botões soltos, `Personalizar a barra lateral`
        e `Agentes de IA`. Os dois moram agora no menu do chip (ver
        `ContaNoPe`), e as duas razões que os punham aqui continuam valendo
        para o chip:

          · ele fica FORA das seções: escondendo as três, a barra fica vazia —
            e sem ele não haveria como desfazer. Uma personalização que se
            tranca por fora é pior do que não ter personalização.
          · ele não é item de `ITENS_DA_BARRA`, e por isso não entra em
            `Personalizar` nem pode ser escondido: a tela de `Agentes de IA`
            (F16.9b) é onde a pessoa REVOGA o acesso de uma IA aos dados da
            agência, e ela não pode depender de ninguém ter deixado um item
            ligado. Sem `podeVer` para ela: a rota da API é `livre` em
            `auth/areas.ts`, qualquer autenticado gerencia as PRÓPRIAS
            conexões.
      */}
      <ContaNoPe soIcones={soIcones} aoPersonalizar={() => setPersonalizando(true)} />

      {personalizando && (
        <Personalizar
          preferencias={prefs}
          aoMudar={definirPrefs}
          aoFechar={() => setPersonalizando(false)}
          souAdmin={souAdmin}
        />
      )}

      {/* A janela do "Ir para…" — em portal no `body` (ver `JanelaDoIrPara`),
          então morar dentro da barra é só endereço: nenhuma regra de altura,
          de `sticky` ou da gaveta a alcança. */}
      {irPara && (
        <JanelaDoIrPara
          telas={telasDaBusca}
          podeVerClientes={alcanca('entrega')}
          procurarTarefasOk={alcanca('quadro')}
          aoIr={irAoDestino}
          aoFechar={() => setIrPara(false)}
        />
      )}
      </div>

      {/*
        A COLUNA DA ÁRVORE — F29. Irmã da barra, e não filha: é a GRADE que
        abre espaço para ela (`.q-tela[data-coluna='arvore']`), entre a barra e
        o conteúdo, e a barra continua sendo o item de grade que sempre foi —
        com as regras de altura da F17.72 intactas.

        Sem o contexto da seção: na coluna o título não recolhe (ver
        `ContextoDaSecaoDaArvore`). Com o da coluna ligado: o mesmo botão que
        a soltou é o que a devolve.
      */}
      {naColuna && (
        <div id="bl-coluna-listas" className="bl-coluna" style={estiloDoInicio}>
          <ContextoDaColunaDaArvore.Provider value={colunaLigada}>
            {aArvore}
          </ContextoDaColunaDaArvore.Provider>
        </div>
      )}
    </>
  );
}
