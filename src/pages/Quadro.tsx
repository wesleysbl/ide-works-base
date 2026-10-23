import { textoDasMencoes } from '@/board/mencoes';
import { useFocoDoCartao } from '@/board/foco-do-cartao';
import { ProvedorDeMencoes } from '@/board/CamposDeMencao';
/**
 * O quadro — etapa F17.9a.
 *
 * POR QUE ESTA TELA EXISTE ANTES DAS OUTRAS DO PILAR B
 *   Oito etapas construíram o modelo do quadro e nenhuma linha de tela. O
 *   usuário perguntou o que estava sendo feito, porque não via nada, e escolheu
 *   tela antes de mais dado. Esta etapa é a resposta: **um** quadro que abre.
 *
 *   Ela não é a F17.9 inteira. Não há motor de visualizações salvas (F17.8), não
 *   há Calendário nem Tabela, não há campo personalizado (F17.5) e não há anexo
 *   nem comentário (F17.6). Cortado de propósito.
 *
 * O QUE ESTA TELA NÃO DECIDE
 *   Quem alcança a lista, qual é a esteira dela, e o que acontece quando um
 *   cartão troca de coluna. As três respostas moram no banco desde a F17.1, e
 *   chegam prontas — a política de linha filtra, `list_workflow` resolve a
 *   herança, `move_task` escreve. Se alguma delas aparecer reimplementada aqui,
 *   é defeito.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A COR DO CLICKUP É DADO, E ENTRA COMO DADO — decisão D10
 *
 *   `status.color` e `tag.bgColor` vêm da origem e mudam de lista para lista.
 *   Eles NÃO viram classe: viram variável CSS posta no próprio elemento
 *   (`--cor-status`, `--cor-etiqueta-fundo`). `src/ui/quadro.css` lê essas
 *   variáveis e nada mais.
 *
 *   O resto — superfície, fio, platina, semânticos — sai de `var(--…)` do
 *   OBSIDIAN. Nenhuma cor literal do Tailwind nesta tela, nem uma.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O ESTADO VAZIO DIZ A VERDADE
 *   Hoje há 2 listas e 18 tarefas, **todas concluídas**. Então uma coluna fica
 *   cheia, a outra fica vazia, e o cartão aparece quase nu — sem responsável,
 *   sem etiqueta, sem prioridade, porque essas tabelas estão vazias.
 *
 *   Isso está certo, e a tela precisa DIZER que está certo. Um quadro com uma
 *   coluna vazia e nenhuma explicação é indistinguível de um quadro quebrado, e
 *   quem abrir vai procurar o defeito que não existe.
 *
 * LISTA | KANBAN — F18C (revisão de 28/09, R09)
 *   O Kanban é este quadro. A Lista é a peça comum da F18B (`TrabalhoDoEscopo`,
 *   escopo `lista`): as MESMAS tarefas e etapas desta lista, paginadas no
 *   servidor. O quadro continua sendo lido uma vez na Lista, porque é dele que
 *   vêm o título, o cliente, a descrição e o `+ Nova tarefa`; filtro trocado
 *   na Lista não relê o quadro, só a Lista.
 */

import { useMoverEntreListas } from '@/board/useMoverEntreListas';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SeletorDeModo } from '@/board/SeletorDeForma';
import { FiltrosSoDaLista, TrabalhoDoEscopo } from '@/board/TrabalhoDoEscopo';
import { useModoDaTela } from '@/board/usar-modo';
import { useNavigate, useParams } from 'react-router-dom';

import {
  type Board,
  type BoardStatus,
  type BoardTask,
  CARTOES_POR_COLUNA,
  INHERITED_LABEL,
  colunaCortada,
  orphanTasks,
  subtarefasEscondidas,
  summarize,
  summarizeBoard,
  toColumns,
  today,
  visiveisNoQuadro,
} from '@/board/board';
// O CORPO do cartão saiu daqui na F17.18: `Todas as tarefas` desenha o MESMO
// cartão, e duas cópias divergiriam na primeira etapa que mexesse numa só. O
// que ficou aqui é o `<li>` que ARRASTA — que é justamente o que aquela tela
// não tem. Ver o cabeçalho de `@/board/CartaoDeTarefa`.
import { ColunaVazia, CorpoDoCartao, type ConcluirDoCartao, type MoverDoCartao } from '@/board/CartaoDeTarefa';
/* Etapas vazias recolhidas e a navegação por etapas — F06C. */
import { RecolherEtapa, DobraDaEtapa, InterruptorDeVazias, NavegacaoDeEtapas } from '@/board/EtapasDoQuadro';
import { interruptorUtil, mostrarNavegacao, quantasVazias } from '@/board/etapas-vazias';
import { useEtapasDoQuadro } from '@/board/usar-etapas';
/* Definir responsavel pela capa do cartao — F17.69. */
import {
  type ResponsavelDoCartao,
  useResponsavelDoCartao,
} from '@/board/responsavel-do-cartao';
import { ProvedorDeMiniaturas } from '@/board/MiniaturaDoCartao';
// A lupa e o `Responsável` — F17.55. A MESMA peça de `Todas as tarefas`.
import { BarraDeFiltro } from '@/board/BarraDeFiltro';
import { type FiltroDeTarefas, lerFiltro, paraEndereco } from '@/board/filtro';
import { useParametrosNoEndereco } from '@/ui/endereco';
// O interruptor `Subtarefas` da barra de controle — F17.15.
import { rotuloDoInterruptor } from '@/board/passos';
// A roda do mouse e o arrasto do fundo — F17.25.
import { usePuxarParaRolar } from '@/board/rolagem';
// A rolagem de cada coluna e da faixa volta ao fechar o cartão — F32.
import { ROLADOR } from '@/ui/rolagem-interna';
// A trilha do topo — F17.25. A MESMA peça das outras três telas do Pilar B.
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDoQuadro, trilhaEmEspera } from '@/board/trilha';
// A árvore editável — F17.14. A barra lateral deixou de ser um desenho da view
// `tree` e passou a ser a árvore inteira, com o vazio e o arquivado dentro.
import {
  type NoDeEspaco,
  acharListas,
  buildFullTree,
  listaLevaAFicha,
  paraNavegacao,
  todasAsListas,
} from '@/board/arvore';
import { SinalDoClienteDaLista } from '@/board/SinalDoClienteDaLista';
// O cabeçalho da lista: descrição recolhível, esteira e contagens — F06A.
import { ContagemDoQuadro, DescricaoDaLista, SobreAEsteira } from '@/board/CabecalhoDaLista';
// A MESMA leitura da barra e das telas vizinhas — F17.CARGA02.
import { useArvoreCompleta } from '@/board/arvore-compartilhada';
import { useSessao } from '@/ui/sessao';
import { ArvoreDoQuadro } from '@/board/ArvoreDoQuadro';
// A frase de uma linha do que a automação fez — F17.41.
import { avisoDaAutomacao } from '@/board/automacoes';
// A barra lateral com seções — F17.18. A árvore passou a ser UMA delas.
import { usePedidoDeRevelar } from '@/board/secao-recolhivel';
import { TelaComBarra } from '@/board/TelaComBarra';
import { useLugar } from '@/ui/aparencia';
// Onde a pessoa estava — F17.24.
import { lembrarRecente, listaDeAbertura } from '@/ui/lugar';
import { ModalDeTarefa } from '@/board/ModalDeTarefa';
import { AdicionarNaColuna } from '@/board/pecas-da-ficha';
import type { ListaDoCliente } from '@/board/cliente-no-cartao';
import { type ListaDoTipo, type TipoDaTarefa, fraseDaRecusa } from '@/board/tipo-no-cartao';
import { ApiError, api, indisponivel, semSessao } from '@/lib/api';
import { Aviso, PaginaLarga } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';
// A vez — F17.AUD01. A resposta da lista (ou do filtro) anterior não pinta o quadro.
import { entregar, useVez } from '@/ui/vez';
import { useAoFecharAFichaAoLado } from '@/ui/usar-ficha-ao-lado';
import '@/ui/quadro.css';
// A F17.10 acrescentou o `+ Adicionar tarefa` no pé da coluna e o formulário
// completo; as classes dos dois moram em `tarefa.css`.
import '@/ui/tarefa.css';
// A gramática do ClickUp — a barra lateral da F17.14 mora nela.
import '@/ui/clickup.css';
// O selo de contagem do cartão (`⑂ 5`, `☑ 0/1`) mora com as duas seções da
// F17.15: é o MESMO desenho na ficha e no cartão, porque é o mesmo número.
import '@/ui/passos.css';

/* ───────────────────────────── ícone local ───────────────────────────── */
/*
  Desenhado aqui, e não em `src/ui/Icones.tsx`: é um traço que só o quadro usa,
  e o arquivo compartilhado está sendo mexido por outra sessão agora. Os três
  indicadores do cartão — descrição, anexo e conversa — foram junto com o corpo
  dele para `@/board/CartaoDeTarefa` na F17.18, porque agora dois quadros os
  desenham.
*/

const traco = (className?: string) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: className ?? 'h-4 w-4',
  'aria-hidden': true,
});

const IconeQuadro = ({ className }: { className?: string }) => (
  <svg {...traco(className)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v10" />
  </svg>
);

/* ───────────────────────────── o cartão ───────────────────────────── */

/**
 * O `<li>` QUE ARRASTA. O conteúdo é `CorpoDoCartao`, compartilhado.
 *
 * Esta casca é o que `Todas as tarefas` (F17.18) não tem: lá o quadro agrupa
 * por TIPO de status, e soltar num tipo não diria em qual status daquela
 * esteira a tarefa deve cair. Cartão arrastável que não pode ser solto é botão
 * morto com gesto.
 */
function Cartao({
  tarefa,
  hoje,
  arrastando,
  salvando,
  aoIniciarArrasto,
  aoTerminarArrasto,
  aoMoverPeloTeclado,
  mover,
  concluir,
  responsavel,
  clienteDaVisao,
}: {
  tarefa: BoardTask;
  hoje: ReturnType<typeof today>;
  arrastando: boolean;
  salvando: boolean;
  aoIniciarArrasto: () => void;
  aoTerminarArrasto: () => void;
  aoMoverPeloTeclado: (direcao: -1 | 1) => void;
  /** O `···` da F17.63. Ver `MoverDoCartao`. */
  mover: MoverDoCartao;
  /** O ✓ de concluir — ausente quando não cabe. */
  concluir?: ConcluirDoCartao;
  /** As iniciais que se clicam — F17.69. Ver `ResponsavelDoCartao`. */
  responsavel: ResponsavelDoCartao;
  /** O cliente que o topo já mostra — F06B. Ver `CorpoDoCartao`. */
  clienteDaVisao: string | null;
}) {
  return (
    <li
      className="q-cartao"
      /* O foco acha o cartão por aqui depois de ele trocar de coluna pelas
         setas — ver `@/board/foco-do-cartao`. */
      data-cartao={tarefa.id}
      draggable={!salvando}
      data-arrastando={arrastando}
      data-salvando={salvando}
      tabIndex={0}
      aria-label={`${textoDasMencoes(tarefa.title)}. Use as setas para a esquerda e para a direita para mover de coluna.`}
      onDragStart={(e) => {
        /**
         * ⚠️ SÓ O PRÓPRIO `<li>` COMEÇA O ARRASTO — F17.63.
         *
         * O balão de `Mover para` sai por PORTAL para `document.body`, mas em
         * React o evento sobe pela ÁRVORE DE COMPONENTES, e não pela do DOM:
         * um `dragstart` nascido dentro do balão (arrastar texto selecionado
         * na caixa de busca, por exemplo) chegaria aqui e o quadro passaria a
         * achar que o cartão está sendo movido — com o cartão parado.
         *
         * `e.target === e.currentTarget` é a linha que separa os dois casos: o
         * arrasto de verdade nasce NO `<li>`, porque é ele que é `draggable`.
         */
        if (e.target !== e.currentTarget) return;
        e.dataTransfer.setData('text/plain', tarefa.id);
        e.dataTransfer.effectAllowed = 'move';
        aoIniciarArrasto();
      }}
      onDragEnd={aoTerminarArrasto}
      // ARRASTAR É GESTO DE PONTEIRO, E NEM TODO MUNDO USA PONTEIRO.
      // As setas fazem o mesmo movimento com o cartão em foco. São seis linhas,
      // e sem elas a única função nova desta etapa seria inalcançável pelo
      // teclado.
      onKeyDown={(e) => {
        /**
         * ⚠️ A MESMA ARMADILHA DO PORTAL, E ESTA MOVERIA A TAREFA DE VERDADE —
         * F17.63. As setas do menu `Mover para` andam nos itens e as setas da
         * caixa de busca andam no texto; sem esta linha, as duas subiriam pela
         * árvore de componentes até aqui e MOVERIAM O CARTÃO DE COLUNA no meio
         * de quem estava só escolhendo o destino.
         */
        if (e.target !== e.currentTarget) return;
        if (salvando) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          aoMoverPeloTeclado(-1);
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          aoMoverPeloTeclado(1);
        }
      }}
    >
      <CorpoDoCartao
        tarefa={tarefa}
        hoje={hoje}
        mover={mover}
        concluir={concluir}
        responsavel={responsavel}
        clienteDaVisao={clienteDaVisao}
      />
    </li>
  );
}

/* ───────────────────────────── a coluna ───────────────────────────── */

function Coluna({
  status,
  tarefas,
  total,
  achadas,
  carregadas,
  buscandoMais,
  aoMostrarMais,
  hoje,
  alvo,
  arrastando,
  salvando,
  aoEntrar,
  aoSair,
  aoSoltar,
  aoIniciarArrasto,
  aoTerminarArrasto,
  aoMoverPeloTeclado,
  aoCriarNaColuna,
  listaDoQuadro,
  moverDoCartao,
  concluirDoCartao,
  responsavelDoCartao,
  clienteDaVisao,
  recolhida,
  aoAbrir,
  aoRecolher,
}: {
  status: BoardStatus;
  tarefas: BoardTask[];
  /** Quantas há na coluna de verdade — F17.50. Ver `Column.total`. */
  total: number;
  /**
   * Quantas passaram pelo filtro — F17.55. Igual a `total` quando não há
   * filtro, e é a diferença entre os dois que dá ao cabeçalho o que dizer a
   * mais. Ver `Column.matched`.
   */
  achadas: number;
  /** Quantos cartões chegaram, os escondidos pelo interruptor `Subtarefas` incluídos. Ver `Column.carregadas`. */
  carregadas: number;
  /** Buscando a janela maior agora. Só chega `true` na coluna cortada. */
  buscandoMais: boolean;
  aoMostrarMais: () => void;
  hoje: ReturnType<typeof today>;
  alvo: boolean;
  arrastando: string | null;
  salvando: Set<string>;
  aoEntrar: () => void;
  aoSair: () => void;
  aoSoltar: (taskId: string) => void;
  aoIniciarArrasto: (taskId: string) => void;
  aoTerminarArrasto: () => void;
  aoMoverPeloTeclado: (taskId: string, direcao: -1 | 1) => void;
  aoCriarNaColuna: (
    titulo: string,
    statusId: string,
    clientId?: string | null,
    type?: TipoDaTarefa | null,
  ) => Promise<boolean>;
  /** A lista do quadro, para o `+ Adicionar tarefa` saber se pede o cliente (F38) e o tipo (F40). */
  listaDoQuadro?: ListaDoCliente & ListaDoTipo & { listId: string };
  /**
   * O `···` de UM cartão — F17.63.
   *
   * Uma fábrica, e não um objeto pronto: o que muda de cartão para cartão é
   * qual deles está com o menu aberto e qual está esperando o banco. Montar o
   * objeto aqui em cima faria os cinquenta cartões compartilharem o mesmo
   * `aberto`.
   */
  moverDoCartao: (taskId: string) => MoverDoCartao;
  /** O ✓ de UM cartão; `undefined` quando a lista não tem coluna que feche ou o cartão já está nela. */
  concluirDoCartao: (taskId: string, statusId: string | null) => ConcluirDoCartao | undefined;
  /** O seletor de responsável de UM cartão — F17.69, mesma razão da fábrica acima. */
  responsavelDoCartao: (tarefa: BoardTask) => ResponsavelDoCartao;
  /** O cliente que o topo já mostra — F06B. Ver `CorpoDoCartao`. */
  clienteDaVisao: string | null;
  /** Etapa vazia recolhida numa faixa estreita — F06C. Ver `@/board/etapas-vazias`. */
  recolhida: boolean;
  aoAbrir: () => void;
  aoRecolher?: () => void;
}) {
  const idDoNome = `q-etapa-${status.id}`;
  return (
    <section
      className="q-coluna"
      /* F06C: a navegação por etapas acha a coluna por aqui, e a foca. */
      data-etapa={status.id}
      data-recolhida={recolhida ? 'true' : undefined}
      tabIndex={-1}
      aria-labelledby={idDoNome}
      data-alvo={alvo}
      /* A ÚNICA COR QUE VEM DO CLICKUP NESTA COLUNA. Como variável, nunca como
         classe — ela muda de lista para lista. */
      style={status.color ? { ['--cor-status' as string]: status.color } : undefined}
      onDragOver={(e) => {
        // Sem `preventDefault` o navegador recusa a soltura, e o arrasto termina
        // sem que nada aconteça — o defeito mais confuso possível.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        aoEntrar();
      }}
      onDragLeave={aoSair}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain') || arrastando;
        if (id) aoSoltar(id);
      }}
    >
      {/* RECOLHIDA — F06C. A section em volta é a mesma: soltar um cartão
          aqui continua movendo para esta etapa. */}
      {recolhida ? (
        <DobraDaEtapa nome={status.name} idDoNome={idDoNome} aoAbrir={aoAbrir} />
      ) : (
      <>
      <header className="q-coluna-topo">
        <span className="q-ponto" />
        <h2 className="q-coluna-nome truncate" id={idDoNome}>{status.name}</h2>
        {/* O NÚMERO É O TOTAL DA COLUNA, e não o dos cartões que chegaram —
            F17.50. Ver `Column.total`.

            COM FILTRO SÃO DOIS — F17.55. `4 de 13` diz o que `4` sozinho
            esconderia: que a coluna tem treze, e que nove não batem com o que
            se procura. Sem o segundo número, quem chegasse por um endereço
            filtrado leria `4` como o tamanho da coluna. */}
        <span className="tnum ml-auto text-[0.72rem] text-plat-dim">
          {achadas === total ? total : `${achadas} de ${total}`}
        </span>
        <RecolherEtapa nome={status.name} aoRecolher={aoRecolher} />
      </header>

      {/* O nome da caixa — F32. É por ele que a rolagem desta coluna volta
          depois de abrir e fechar um cartão. Ver `@/ui/rolagem-interna`. */}
      <ul className="q-coluna-corpo" data-rolagem={ROLADOR.coluna(status.id)}>
        {tarefas.map((t) => (
          <Cartao
            key={t.id}
            tarefa={t}
            hoje={hoje}
            arrastando={arrastando === t.id}
            salvando={salvando.has(t.id)}
            aoIniciarArrasto={() => aoIniciarArrasto(t.id)}
            aoTerminarArrasto={aoTerminarArrasto}
            aoMoverPeloTeclado={(d) => aoMoverPeloTeclado(t.id, d)}
            mover={moverDoCartao(t.id)}
            concluir={concluirDoCartao(t.id, t.statusId)}
            responsavel={responsavelDoCartao(t)}
            clienteDaVisao={clienteDaVisao}
          />
        ))}

        {/* F06B: vazia pelo filtro não é vazia de verdade. */}
        {tarefas.length === 0 && <ColunaVazia filtrada={achadas < total} total={total} />}
      </ul>

      {/*
        O CORTE, DITO EM VOZ ALTA — F17.50.

        Só aparece na coluna que foi cortada, e diz os dois números: o que está
        à mostra e o que existe. Sem esta linha, a coluna diria `1.049` no topo
        e teria cinquenta cartões, e a diferença seria um mistério — que é
        exatamente a lista que esconde tarefa sem avisar.

        `aria-live` porque o número muda sem a página recarregar: quem usa
        leitor de tela precisa ouvir que agora há mais.
      */}
      {/* ⚠️ O CORTE SE MEDE CONTRA `achadas`, E NÃO CONTRA `total` — F17.55.
          Com filtro, uma coluna de 1.050 pode ter 27 achados, e os 27 cabem na
          janela de 50: não há nada a mostrar a mais. Comparando com o total,
          esta linha ofereceria `Mostrar mais` para trazer o que o filtro
          acabou de tirar — e o clique não mudaria nada.

          ⚠️ E CONTRA O QUE CHEGOU (`carregadas`), E NÃO CONTRA O QUE ESTÁ À
          VISTA. Com o interruptor `Subtarefas` desligado as filhas chegam e não
          viram cartão; contar só os cartões à vista fazia a coluna dizer
          `1 de 3 · Mostrar mais` sem nada a buscar. Ver `colunaCortada`. */}
      {colunaCortada({ carregadas, matched: achadas }) && (
        <div className="q-coluna-corte">
          <span className="tnum" aria-live="polite">
            {carregadas} de {achadas}
          </span>
          <button
            type="button"
            className="q-coluna-mais"
            onClick={aoMostrarMais}
            disabled={buscandoMais}
          >
            {buscandoMais ? 'Buscando…' : 'Mostrar mais'}
          </button>
        </div>
      )}

      {/* Fora da lista rolante: o botão de criar não deve sumir quando a coluna
          tem trinta cartões. */}
      <div className="px-2 pb-2">
        <AdicionarNaColuna statusId={status.id} aoCriar={aoCriarNaColuna} lista={listaDoQuadro} />
      </div>
      </>
      )}
    </section>
  );
}

/* ───────────────────────────── a tela ───────────────────────────── */

export default function Quadro() {
  const { mover: moverEntreListas, janela: janelaDaMudanca } = useMoverEntreListas();
  const { listaId } = useParams<{ listaId?: string }>();
  const navigate = useNavigate();

  // A largura da barra segue a aparência escolhida em `Personalizar` — F17.18.

  /**
   * ONDE EU ESTAVA — F17.24.
   *
   * Guarda a última lista aberta, o `Ver arquivados` e o interruptor
   * `Subtarefas`. Os três eram `useState` e voltavam ao começo a cada F5. Ver
   * `@/ui/lugar` para a razão de cada um estar no navegador e não no endereço.
   */
  const [lugar, definirLugar] = useLugar();

  /* A ÁRVORE VEM DA CONSULTA COMPARTILHADA — F17.CARGA02. Esta tela, a barra
     lateral que ela desenha e as telas vizinhas dividem a MESMA leitura, e
     voltar da tarefa dentro da validade não pede nada. A recusa e o "é
     passageiro" chegam prontos; o 401 já mandou ao login lá dentro. Ver
     `@/board/arvore-compartilhada`. */
  const {
    linhas: linhasDaArvore,
    empresas,
    recusa: erroDaArvore,
    recuperavel: arvoreRecuperavel,
    estado: leituraDaArvore,
    recarregar: lerArvore,
  } = useArvoreCompleta();
  /* Quem administra liga e desliga a marca "exige cliente" na árvore — F38, Fase 7. */
  const { sessao: sessaoDaArvore } = useSessao();
  // Arquivar não apaga (F17.1), então precisa haver como VER o arquivado — sem
  // isto o botão de arquivar seria uma porta sem volta.
  const mostrarArquivados = lugar.arquivados;
  const [avisoDaArvore, setAvisoDaArvore] = useState<string | null>(null);
  const [quadro, setQuadro] = useState<Board | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroDoQuadro, setErro] = useState<string | null>(null);
  /* O erro é PASSAGEIRO e as leituras podem ser refeitas — F17.AUD04, achado
     5. `erro` só nasce das duas leituras (árvore e quadro); o "Tentar de novo"
     refaz as duas, com a lista e o filtro que já estão no endereço. */
  const [quadroRecuperavel, setRecuperavel] = useState(false);

  /* UM AVISO SÓ, como antes — e a ordem é a de quem chegou por último a mexer:
     a falha do quadro é sobre o que a pessoa está OLHANDO; a da árvore é sobre
     o mapa ao lado. */
  const erro = erroDoQuadro ?? erroDaArvore;
  const recuperavel = erroDoQuadro === null ? arvoreRecuperavel : quadroRecuperavel;
  /**
   * A JANELA DA COLUNA — F17.50.
   *
   * Quantos cartões por coluna esta tela está pedindo. `undefined` é "o padrão
   * do servidor". Cresce quando alguém aperta `Mostrar mais`, e volta ao padrão
   * ao trocar de lista — a janela é da lista aberta, não da sessão.
   *
   * ⚠️ `ref` E NÃO `state`: `lerQuadro` é relido a cada movimento de cartão, e
   * a janela precisa acompanhá-lo sem recriar a função (o que dispararia a
   * releitura inteira do quadro a cada gesto — o defeito que a nota das
   * dependências deste arquivo já descreve).
   */
  const janelaDaColuna = useRef<number | undefined>(undefined);
  const [buscandoMais, setBuscandoMais] = useState(false);
  /**
   * A BUSCA E O RESPONSÁVEL MORAM NO ENDEREÇO — F17.55, pela regra da F17.24.
   *
   * "Quem procurou o quê" é o que outra pessoa precisa ver igual ao abrir o
   * mesmo endereço: `/quadro/…?busca=sonho` colado num comentário abre no
   * mesmo resultado. E o botão VOLTAR desfaz a busca, que é o que ele promete.
   *
   * ⚠️ `janelaDaColuna` volta ao padrão a cada troca de filtro. Uma busca que
   * herdasse a janela de 400 do `Mostrar mais` anterior pagaria o preço da
   * maior coluna já aberta para mostrar doze achados.
   */
  const [parametros, definirParametros] = useParametrosNoEndereco();
  const busca = parametros.get('busca') ?? '';
  const responsavelPedido = parametros.get('responsavel') ?? '';
  /* ⚠️ `useMemo` sobre os DOIS TEXTOS, e não sobre `parametros`. `lerFiltro`
     devolve um objeto novo a cada chamada; sem isto, todo desenho traria um
     filtro com identidade nova, `lerQuadro` seria refeita, e o efeito que
     depende dela releria o quadro — um laço infinito de idas ao banco. */
  const filtro = useMemo(() => lerFiltro(busca, responsavelPedido), [busca, responsavelPedido]);

  /* LISTA | KANBAN — F18C. Padrão: Kanban (o quadro de sempre). */
  const [modo, escolherModo] = useModoDaTela('lista', listaId ?? null);
  const naLista = modo === 'lista';

  const trocarFiltro = useCallback(
    (proximo: FiltroDeTarefas) => {
      janelaDaColuna.current = undefined;
      const endereco = paraEndereco(proximo);
      definirParametros({ busca: endereco.busca ?? '', responsavel: endereco.responsavel ?? '' });
    },
    [definirParametros],
  );
  const [avisoDoMovimento, setAvisoDoMovimento] = useState<string | null>(null);

  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<Set<string>>(() => new Set());

  /**
   * QUAL CARTÃO ESTÁ COM O `···` ABERTO — F17.63.
   *
   * Um só, e por isso o estado mora aqui e não em cada cartão: a coluna desenha
   * cinquenta, e dois seletores de destino abertos ao mesmo tempo seriam dois
   * menus disputando a mesma tecla `Esc`.
   */
  const [menuDoCartao, setMenuDoCartao] = useState<string | null>(null);

  // O formulário completo de tarefa nova — F17.10.
  const [formularioAberto, setFormularioAberto] = useState(false);

  // "Hoje" fixado uma vez por montagem. Recalcular a cada render faria a tela
  // trocar o destaque de prazo no meio de um arrasto que atravessa a meia-noite.
  const hoje = useRef(today()).current;

  // A faixa que rola de lado — F17.25. A roda e o arrasto do fundo entram por
  // aqui; a barra de rolagem continua onde estava.
  const faixaDeColunas = usePuxarParaRolar<HTMLDivElement>();

  /**
   * A TRILHA DO TOPO — F17.25.
   *
   * `revelar` é o pedido que ela manda para a árvore quando alguém clica num
   * degrau que é nó SEM endereço. Desde 28/09 espaço e pasta levam às telas
   * deles (ver `@/board/trilha`), e o pedido sobra para esse caso. O contador junto da chave é o que faz o segundo clique no mesmo
   * degrau valer — ver a propriedade `revelar` de `ArvoreDoQuadro`.
   *
   * F29: com a barra em `Somente ícones` a árvore não está montada, e o pedido
   * expande a barra antes — ver `usePedidoDeRevelar`.
   */
  const [revelar, pedirRevelar] = usePedidoDeRevelar();
  const [trilhaAberta, setTrilhaAberta] = useState(false);

  const paraLogin = (e: unknown) => {
    if (semSessao(e)) {
      window.location.replace('/');
      return true;
    }
    return false;
  };

  /* --- a árvore --- */

  /*
    A ÁRVORE INTEIRA — F17.14, compartilhada desde a F17.CARGA02.

    Esta leitura NÃO é `GET /board/tree`, que parte da view `tree` e só conhece
    lista viva: aquela não sabe representar o espaço recém-criado (que ainda não
    tem lista), a pasta recém-criada, nem o que foi arquivado — os três
    exatamente o que a F17.14 passou a criar e desarquivar.

    ⚠️ E `lerArvore` DEIXOU DE LER: ele INVALIDA. A diferença aparece nos gestos
    mais abaixo — mover, criar, arquivar. Antes, cada tela relia a sua cópia e a
    barra ao lado ficava com a contagem velha; agora é uma releitura só, e ela
    chega às duas.
  */
  const arvore: NoDeEspaco[] = useMemo(
    () => (linhasDaArvore === null ? [] : buildFullTree(linhasDaArvore)),
    [linhasDaArvore],
  );

  /**
   * A mesma forma que o modal de tarefa fala.
   *
   * `MenuDeListas` recebe `TreeSpace[]`, e só o que está VIVO passa: criar
   * tarefa numa lista arquivada é criar trabalho num lugar que ninguém vê.
   */
  const arvoreViva = useMemo(() => paraNavegacao(arvore), [arvore]);

  const listasVivas = useMemo(
    () => todasAsListas(arvore).filter((l) => l.live),
    [arvore],
  );

  /**
   * De que cliente a lista aberta é — o mesmo vínculo da barra, agora no
   * cabeçalho. Vem da árvore já carregada: segunda consulta sobre o mesmo
   * fato seria segunda opinião, e alargar o `readBoard` para trazer o
   * cliente seria outro caminho de alcance.
   */
  const listaAberta = useMemo(
    () => (listaId ? (todasAsListas(arvore).find((l) => l.id === listaId) ?? null) : null),
    [arvore, listaId],
  );

  /**
   * Sem lista escolhida, abre A ÚLTIMA QUE EU ABRI — F17.24.
   *
   * Antes abria sempre a PRIMEIRA, e essa é a metade do defeito que o usuário
   * descreveu: quem trabalhava na terceira lista e clicava em `Quadro` na barra
   * lateral (que aponta para `/quadro`, sem id) voltava para a primeira.
   *
   * ⚠️ O ENDEREÇO CONTINUA MANDANDO. `/quadro/:id` não mudou em nada: id na
   * mão vence a memória, sempre. A memória só responde a pergunta que o
   * endereço não faz — "e quando não há id?" —, e por isso ela não cabe no
   * endereço: se coubesse, o endereço seria `/quadro/:id`, que já existe.
   *
   * ARQUIVAR A LISTA ABERTA CAI AQUI TAMBÉM — F17.14. Ela some da árvore viva,
   * e `listaDeAbertura` cai na primeira em vez de deixar a tela mostrando o
   * quadro de uma lista que acabou de sair de circulação.
   */
  useEffect(() => {
    if (listasVivas.length === 0) return;
    if (listaId && listasVivas.some((l) => l.id === listaId)) return;
    const destino = listaDeAbertura(lugar.lista, listasVivas);
    if (destino === null) return;
    navigate(`/quadro/${destino}`, { replace: true });
  }, [listaId, listasVivas, lugar.lista, navigate]);

  /**
   * Guardar a lista aberta.
   *
   * Só quando ela EXISTE e está viva: um id digitado errado, ou de uma lista
   * arquivada, não deve virar o ponto de partida de todo dia seguinte.
   */
  useEffect(() => {
    if (!listaId) return;
    if (!listasVivas.some((l) => l.id === listaId)) return;
    definirLugar((l) => (l.lista === listaId ? l : { ...l, lista: listaId }));
  }, [listaId, listasVivas, definirLugar]);

  /* --- o quadro --- */

  /**
   * A VEZ DESTE QUADRO — F17.AUD01, achado 6 da auditoria de 09/09/2026.
   *
   * O efeito de abertura tinha `let cancelado = false`, mas só conferia DEPOIS
   * de `lerQuadro` já ter feito `setQuadro`: trocar de lista (ou de filtro)
   * durante uma carga lenta deixava a resposta antiga chegar por último e
   * pintar o quadro errado, sem erro nenhum. Agora cada leitura pega um
   * bilhete, e só a última entra. Ver o cabeçalho de `@/ui/vez`.
   */
  const vez = useVez();

  /**
   * `silencioso` é a RELEITURA depois de um gesto — mover, criar, `Mostrar
   * mais`. Ela relê o que já está na tela, e só se ainda estiver: se a pessoa
   * trocou de lista no meio do gesto, a releitura da lista antiga não tem mais
   * para onde ir, e reabri-la tornaria a lista antiga a vez de novo com o
   * endereço da nova.
   */
  const lerQuadro = useCallback(
    async (id: string, silencioso = false) => {
      const bilhete = silencioso ? vez.reabrir(id) : vez.abrir(id);
      if (bilhete === null) return;
      if (!silencioso) {
        setCarregando(true);
        setErro(null);
        setRecuperavel(false);
      }
      await entregar(vez, bilhete, api.quadroDaLista(id, janelaDaColuna.current, filtro), {
        chegou: (r) => {
          setQuadro(r.board as Board);
          // Qualquer leitura que chega apaga o aviso da que falhou: com o quadro
          // mantido na falha da silenciosa, o aviso velho ficaria na tela.
          setErro(null);
        },
        falhou: (e) => {
          if (paraLogin(e)) return;
          // A RELEITURA SILENCIOSA QUE FALHA NÃO APAGA O QUADRO — o mesmo desenho
          // de `Pasta`. Ela vem depois de um gesto que JÁ deu certo (mover, criar,
          // `Mostrar mais`, fechar o card ao lado), e o que está na tela é o que
          // o gesto produziu; tirar o quadro por causa de uma releitura que
          // tropeçou punia quem não fez nada. O aviso fica, com "Tentar de novo".
          if (!silencioso) setQuadro(null);
          setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar o quadro.');
          setRecuperavel(indisponivel(e));
        },
        // Quem desliga o `carregando` é a leitura da VEZ, silenciosa ou não: a
        // de abertura pode ter sido superada por uma releitura, e aí é a
        // releitura quem termina — senão o "Carregando…" ficaria preso ligado.
        terminou: () => setCarregando(false),
      });
    },
    // O FILTRO ENTRA AQUI, e é ele que faz a busca acontecer: trocando de
    // peneira, esta função é refeita e o efeito abaixo relê o quadro. Ver o
    // `useMemo` que mantém a identidade dele estável.
    [vez, filtro],
  );

  // A ÁRVORE NÃO ENTRA NAS DEPENDÊNCIAS, e isso é medido: cada movimento relê a
  // árvore para a contagem da barra lateral não mentir, e a árvore relida é um
  // array NOVO. Com ela aqui, todo arrasto disparava uma segunda leitura do
  // quadro em cima da que `mover` já faz — o dobro de idas ao banco por gesto.
  /* F18C: `lidoCom` guarda com que lista e filtro o quadro foi lido. Na Lista,
     basta o quadro DESTA lista (o cabeçalho); filtro trocado ali não relê o
     quadro. Voltar ao Kanban relê só se o filtro mudou nesse meio-tempo. */
  const lidoCom = useRef<string | null>(null);
  /* Desmontar esquece a leitura: a vez (`@/ui/vez`) descarta o pedido em voo, e
     a montagem seguinte — inclusive a segunda do modo estrito — precisa pedir de novo. */
  useEffect(() => () => {
    lidoCom.current = null;
  }, []);
  useEffect(() => {
    if (!listaId) return;
    const chave = `${listaId}\u0000${busca}\u0000${responsavelPedido}`;
    if (lidoCom.current === chave) return;
    if (naLista && lidoCom.current?.startsWith(`${listaId}\u0000`)) return;
    lidoCom.current = chave;
    /* Lista nova, janela nova. Levar a janela grande da lista anterior faria a
       primeira abertura de toda lista pagar o preço da maior já aberta. */
    janelaDaColuna.current = undefined;
    // Trocar de lista ou de filtro durante uma carga lenta abre um bilhete novo
    // em `lerQuadro`; a resposta antiga chega, não vale, e não pinta nada.
    void lerQuadro(listaId);
    // `busca`/`responsavel` chegam por `lerQuadro` (o filtro é dependência dela).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listaId, lerQuadro, naLista]);

  /* O CARD AO LADO FECHOU — F43, Fase 7. O quadro não desmontou (a ficha abriu
     num painel por cima dele), então o que mudou lá dentro não chegou aqui.
     A mesma releitura silenciosa de depois de mover um cartão: sem esvaziar,
     com a mesma janela de cartões por coluna. Na Lista quem relê é a peça
     comum (`TrabalhoDoEscopo`). */
  useAoFecharAFichaAoLado(() => {
    if (listaId && !naLista) void lerQuadro(listaId, true);
  });

  /* --- mover o cartão --- */

  /**
   * Otimista na ida, com desfazimento VISÍVEL na recusa.
   *
   * O cartão pula de coluna na hora — arrasto que espera meio segundo para
   * confirmar parece travado. Se o banco recusar, ele volta sozinho e a recusa
   * aparece escrita, com a frase que o banco mandou: as dez travas da F17 dizem
   * o que está no caminho, e trocá-las por "algo deu errado" jogaria fora o
   * trabalho delas.
   *
   * Na volta bem-sucedida, o quadro é RELIDO em silêncio. Não é desconfiança do
   * servidor: mover para a coluna que fecha carimba a conclusão da tarefa (é o
   * gatilho `task_status_guard` fazendo isso), e a única forma de a tela saber
   * disso sem reimplementar a regra é perguntar.
   */
  const mover = useCallback(
    async (taskId: string, statusId: string) => {
      setAlvo(null);
      setArrastando(null);

      const atual = quadro;
      if (!atual) return;

      const tarefa = atual.tasks.find((t) => t.id === taskId);
      if (!tarefa || tarefa.statusId === statusId) return;
      if (salvando.has(taskId)) return;

      const anterior = tarefa.statusId;
      const aplicar = (destino: string | null) =>
        setQuadro((q) =>
          q === null
            ? q
            : { ...q, tasks: q.tasks.map((t) => (t.id === taskId ? { ...t, statusId: destino } : t)) },
        );

      aplicar(statusId);
      setAvisoDoMovimento(null);
      setSalvando((s) => new Set(s).add(taskId));

      try {
        const r = await api.moverTarefaNoQuadro(taskId, atual.header.listId, statusId);

        // O banco pode ter posto o cartão em outra coluna — a regra do Caso de
        // Borda da F17.3. Quando isso acontece, a tela CONTA, em vez de deixar o
        // cartão aparecer num lugar que ninguém pediu.
        if (r.move.statusRepositioned && r.move.statusId !== statusId) {
          setAvisoDoMovimento(
            'O banco reposicionou o cartão: o status pedido não valia para esta lista.',
          );
        }

        // MOVER A MÃE LEVA AS FILHAS — F17.15. `move_task` move a subárvore
        // inteira na mesma escrita, porque mover só a mãe seria recusado pela
        // cascata da chave estrangeira batendo no guarda do status. Levar cinco
        // subtarefas sem dizer nada seria um efeito colateral invisível.
        if (r.move.subtasksMoved > 0) {
          setAvisoDoMovimento(
            `${r.move.subtasksMoved} subtarefa(s) foram junto — a subtarefa mora na lista da mãe, e o banco as move em bloco.`,
          );
        }

        // A AUTOMAÇÃO DA ETAPA — F17.41, e este aviso é o motivo de ela existir
        // com rastro. Sem ele o cartão sai da coluna debaixo do dedo de quem
        // arrastou, muda de lista e some, e nada explica por quê. O registro
        // completo fica na tarefa; aqui vai a frase de uma linha.
        if (r.move.automation !== null) {
          setAvisoDoMovimento(avisoDaAutomacao(r.move.automation));
        }

        await lerQuadro(atual.header.listId, true);
        await lerArvore();
      } catch (e) {
        if (paraLogin(e)) return;
        aplicar(anterior);
        setAvisoDoMovimento(
          e instanceof ApiError ? e.message : 'Não foi possível mover. O cartão voltou.',
        );
      } finally {
        setSalvando((s) => {
          const proximo = new Set(s);
          proximo.delete(taskId);
          return proximo;
        });
      }
    },
    [quadro, salvando, lerQuadro, lerArvore],
  );

  /* --- mover de LISTA, direto do cartão (F17.63) --- */

  /**
   * `Mover para` — a palavra do usuário: *"eu uso para mover algumas demandas
   * para outra lista, sabe"*.
   *
   * ⚠️ É A MESMA ESCRITA DO ARRASTO, E ISSO É O PONTO. `api.moverTarefaNoQuadro`
   * chama `ideworks.move_task`, que troca lista e status na MESMA escrita,
   * confere o alcance do destino e resolve a esteira. A única diferença entre
   * mover de coluna e mover de lista é qual dos dois argumentos muda — não há
   * um segundo caminho aqui, e a regra 9 existe para não haver.
   *
   * O STATUS VAI NULO: a pessoa escolheu uma lista, não uma coluna. A esteira
   * de destino pode ser outra, e é `move_task` quem sabe reposicionar. Quando ela
   * reposiciona, a tela CONTA — a mesma frase que a ficha usa desde a F17.4b.
   *
   * NÃO É OTIMISTA, e é a diferença para o arrasto. Ali o cartão pula de coluna
   * e continua à vista; aqui ele SAI DO QUADRO, e um cartão que some antes da
   * confirmação some duas vezes quando o banco recusa. Ele fica em espera
   * (`data-salvando`) até a releitura trazer o quadro sem ele.
   */
  const moverParaLista = useCallback(
    async (taskId: string, listId: string) => {
      const atual = quadro;
      if (!atual) return;
      const tarefa = atual.tasks.find((t) => t.id === taskId);
      if (!tarefa) return;
      if (salvando.has(taskId)) return;

      setMenuDoCartao(null);

      // Escolher a lista onde a tarefa JÁ está não é movimento. O menu marca
      // essa lista justamente para se poder ver de onde a coisa veio.
      if (atual.header.listId === listId) return;

      setAvisoDoMovimento(null);
      setSalvando((s) => new Set(s).add(taskId));

      try {
        const r = await moverEntreListas(taskId, listId);
        if (!r) return;

        // O DESTINO PELO NOME, e não pelo id: quem moveu quer ler para onde
        // foi. O nome sai da MESMA árvore que desenhou o menu.
        const destino = acharListas(arvoreViva, [listId])[0];
        const partes = [`Movida para ${destino?.nome ?? 'a outra lista'}.`];
        if (r.move.statusRepositioned) {
          partes.push('A esteira de lá é outra, e o banco reposicionou o status.');
        }
        if (r.move.subtasksMoved > 0) {
          partes.push(
            `${r.move.subtasksMoved} subtarefa(s) foram junto — a subtarefa mora na lista da mãe.`,
          );
        }
        if (r.move.automation !== null) partes.push(avisoDaAutomacao(r.move.automation));
        setAvisoDoMovimento(partes.join(' '));

        // O DESTINO SÓ VIRA `Recente` DEPOIS DE O BANCO ACEITAR. Guardar antes
        // encheria a seção de listas que a pessoa não alcança — que é o atalho
        // trabalhando contra quem o usa.
        definirLugar((l) => ({ ...l, recentes: lembrarRecente(l.recentes, listId) }));

        await lerQuadro(atual.header.listId, true);
        await lerArvore();
      } catch (e) {
        if (paraLogin(e)) return;
        setAvisoDoMovimento(
          e instanceof ApiError ? e.message : 'Não foi possível mover. A tarefa ficou onde estava.',
        );
      } finally {
        setSalvando((s) => {
          const proximo = new Set(s);
          proximo.delete(taskId);
          return proximo;
        });
      }
    },
    [moverEntreListas, quadro, salvando, arvoreViva, definirLugar, lerQuadro, lerArvore],
  );

  /**
   * A seção `Recentes` do seletor — F17.63.
   *
   * ⚠️ OS IDS SÃO DO NAVEGADOR; OS NOMES SÃO DA ÁRVORE. `acharListas` resolve
   * um contra o outro, e é aí que a seção herda o alcance: id lembrado de uma
   * lista que a pessoa não alcança mais não é achado, e não vira linha de menu.
   */
  const recentesAchados = useMemo(
    () => acharListas(arvoreViva, lugar.recentes),
    [arvoreViva, lugar.recentes],
  );

  const moverDoCartao = useCallback(
    (taskId: string): MoverDoCartao => ({
      arvore: arvoreViva,
      recentes: recentesAchados,
      listaAtual: quadro?.header.listId ?? null,
      aberto: menuDoCartao === taskId,
      desativado: salvando.has(taskId),
      aoAlternar: () => setMenuDoCartao((atual) => (atual === taskId ? null : taskId)),
      aoFechar: () => setMenuDoCartao(null),
      aoEscolher: (listId) => void moverParaLista(taskId, listId),
    }),
    [arvoreViva, recentesAchados, quadro?.header.listId, menuDoCartao, salvando, moverParaLista],
  );

  /* --- definir responsável pela capa do cartão (F17.69) --- */

  /**
   * ⚠️ O LAÇO MORA EM `@/board/responsavel-do-cartao`, E NÃO AQUI.
   *
   * O mesmo gesto tem de funcionar no quadro da PASTA (F17.64), que é outro
   * arquivo. Escrever o laço nas duas páginas é o que faz um quadro ganhar o
   * conserto e o outro não — foi assim que `CorpoDoCartao` nasceu na F17.18.
   *
   * Esta página dá duas coisas ao gancho: onde a frase aparece (a MESMA faixa
   * do `Mover para`, e não uma segunda), e como reler o quadro depois. O
   * otimismo e o desfazer ficam lá dentro.
   *
   * ⚠️ RELÊ SEM PISCAR (`true`): a segunda leitura do quadro mantém os cartões
   * na tela, como já faz o movimento de lista. Trocar por uma leitura com
   * esqueleto faria o quadro inteiro apagar por causa de um clique num avatar.
   */
  const responsavelDoCartao = useResponsavelDoCartao({
    aoAvisar: setAvisoDoMovimento,
    aoTerminar: async () => {
      if (quadro) await lerQuadro(quadro.header.listId, true);
    },
  });

  /* --- criar na coluna (F17.10) --- */

  /**
   * O `+ Adicionar tarefa` do pé da coluna.
   *
   * O CARTÃO NASCE NA COLUNA EM QUE SE CLICOU, e o status vai declarado: sem
   * ele o gatilho `tasks_status_guard` poria o primeiro que ABRE, e o cartão
   * apareceria longe de onde a pessoa apontou.
   *
   * Devolve se deu certo, para a caixa saber se limpa o texto. Quando dá
   * errado, a frase do banco aparece em cima e o que foi digitado FICA — perder
   * o título por causa de uma recusa seria punir quem não errou.
   */
  const criarNaColuna = useCallback(
    async (
      titulo: string,
      statusId: string,
      clientId?: string | null,
      type?: TipoDaTarefa | null,
    ): Promise<boolean> => {
      if (!quadro) return false;
      setAvisoDoMovimento(null);
      try {
        await api.criarTarefaNoQuadro(quadro.header.listId, {
          title: titulo,
          description: null,
          dueOn: null,
          priority: null,
          statusId,
          customItemId: null,
          assigneeIds: [],
          tagIds: [],
          // F38, Fase 7: o cliente escolhido na caixinha (lista compartilhada).
          ...(clientId ? { clientId } : {}),
          // F40, Fase 4: o tipo escolhido na caixinha (obrigatório em produção).
          ...(type ? { type } : {}),
        });
        await lerQuadro(quadro.header.listId, true);
        await lerArvore();
        return true;
      } catch (e) {
        if (paraLogin(e)) return false;
        setAvisoDoMovimento(
          e instanceof ApiError ? fraseDaRecusa(e) : 'Não foi possível criar a tarefa.',
        );
        return false;
      }
    },
    [quadro, lerQuadro, lerArvore],
  );

  /* --- derivados --- */

  /**
   * O interruptor `Subtarefas` — F17.15.
   *
   * A subtarefa É um cartão da mesma lista (`tasks_parent_same_list_fk`), então
   * ela já vem no quadro. O interruptor ESCONDE, e o padrão é escondido: uma
   * `Etapa 1` com cinco subtarefas viraria seis cartões, e a coluna passaria a
   * mostrar o mesmo trabalho seis vezes.
   *
   * Isso só é honesto porque o cartão da mãe CONTA. O número diz que há cinco lá
   * dentro; o interruptor mostra quais são. Um sem o outro seria trabalho
   * invisível.
   */
  const mostrarSubtarefas = lugar.subtarefas;

  const noQuadro = useMemo(
    () => (quadro === null ? [] : visiveisNoQuadro(quadro.tasks, mostrarSubtarefas)),
    [quadro, mostrarSubtarefas],
  );
  const escondidas = useMemo(
    () => (quadro === null ? 0 : subtarefasEscondidas(quadro.tasks)),
    [quadro],
  );

  /* A lista do quadro no que a regra do cliente precisa — F38, Fase 7.
     A MARCA vem da árvore quando ela já tem esta lista: é a árvore que se
     relê depois de o administrador ligar ou desligar "exige cliente" no menu,
     e o quadro aberto passa a pedir o cliente sem precisar recarregar. */
  const listaDoQuadro = useMemo(
    () =>
      quadro === null
        ? undefined
        : {
            listId: quadro.header.listId,
            clientId: quadro.header.clientId ?? null,
            clientName: quadro.header.clientName ?? null,
            isProduction: quadro.header.isProduction === true,
            requiresClient:
              listaAberta && listaAberta.id === quadro.header.listId
                ? listaAberta.requiresClient
                : quadro.header.requiresClient === true,
          },
    [quadro, listaAberta],
  );

  const colunas = useMemo(
    () =>
      quadro === null
        ? []
        : toColumns(quadro.statuses, noQuadro, quadro.columnTotals, quadro.columnMatched, quadro.tasks),
    [quadro, noQuadro],
  );

  /* AS ETAPAS VAZIAS E A NAVEGAÇÃO — F06C. `total` é o do banco; `aVista`
     sobe antes dele quando um cartão é solto numa etapa vazia. */
  const paraRecolher = useMemo(
    () => colunas.map((c) => ({ chave: c.status.id, total: c.total, aVista: c.tasks.length })),
    [colunas],
  );
  const etapas = useEtapasDoQuadro({
    quadroId: quadro?.header.listId ?? null,
    colunas: paraRecolher,
    recolher: lugar.vazias,
    puxar: faixaDeColunas,
  });

  /**
   * As artes que ESTA tela desenha — F17.56.
   *
   * Sai de `noQuadro`, e não de `quadro.tasks`: com o interruptor `Subtarefas`
   * desligado, as filhas não viram cartão, e pedir endereço para elas seria
   * pagar assinatura por imagem que ninguém vai ver. A lista alimenta um pedido
   * ÚNICO — ver `ProvedorDeMiniaturas`.
   */
  const artesNaTela = useMemo(() => noQuadro.map((t) => t.previewAttachmentId), [noQuadro]);

  /**
   * `Mostrar mais` — F17.50.
   *
   * Alarga a janela de TODAS as colunas, e não só da que foi apertada. Parece
   * grosseiro e não é: o preço é por cartão que chega, e a coluna que já veio
   * inteira não traz nem um a mais por causa disto. Quem paga o alargamento é
   * exatamente a coluna que estava cortada.
   *
   * O passo é o dobro. Somar cinquenta faria vinte cliques para atravessar uma
   * coluna de mil; dobrando, cinco chegam lá — e o primeiro clique continua
   * sendo barato, que é o que importa para quem só queria ver mais um pouco.
   */
  const mostrarMais = useCallback(() => {
    if (listaId === undefined || buscandoMais) return;
    const agora = quadro?.perColumn ?? CARTOES_POR_COLUNA;
    janelaDaColuna.current = agora * 2;
    setBuscandoMais(true);
    void lerQuadro(listaId, true).finally(() => setBuscandoMais(false));
  }, [listaId, buscandoMais, quadro, lerQuadro]);
  const orfas = useMemo(
    () => (quadro === null ? [] : orphanTasks(quadro.statuses, noQuadro)),
    [quadro, noQuadro],
  );
  // O RESUMO CONTA TUDO, inclusive o que o interruptor esconde: "quantas tarefas
  // há nesta lista" é uma pergunta sobre o banco, e não sobre o que está à
  // mostra. Esconder cartão não pode mudar o total.
  //
  // ⚠️ E, DESDE A F17.50, TAMBÉM CONTA O QUE A JANELA NÃO TROUXE. O quadro passa
  // a trazer uma janela de cada coluna; contar os cartões que chegaram faria o
  // cabeçalho anunciar `71 tarefas` sobre uma lista de 1.070. Ver
  // `summarizeBoard`.
  const resumo = useMemo(
    () => (quadro === null ? summarize([]) : summarizeBoard(quadro)),
    [quadro],
  );
  /* O MESMO CÁLCULO, SOBRE O OUTRO MAPA — F17.55. Sai da mesma função, de
     propósito: duas contas parecidas, cada uma com sua conta de órfã,
     divergiriam na primeira etapa que mexesse numa só, e a tela mostraria um
     filtrado maior que o total. Ver `summarizeBoard`. */
  const achado = useMemo(
    () => (quadro === null ? summarize([]) : summarizeBoard(quadro, 'achadas')),
    [quadro],
  );

  /* O ✓ DO CARTÃO: leva a tarefa à coluna que FECHA (`demanda concluída`) —
     o mesmo caminho do arrasto, então o banco carimba a conclusão. */
  const colunaQueFecha = useMemo(
    () => quadro?.statuses.find((s) => s.type === 'closed') ?? null,
    [quadro],
  );
  const concluirDoCartao = useCallback(
    (taskId: string, statusId: string | null): ConcluirDoCartao | undefined => {
      if (colunaQueFecha === null || statusId === colunaQueFecha.id) return undefined;
      return {
        desativado: salvando.has(taskId),
        aoConcluir: () => void mover(taskId, colunaQueFecha.id),
      };
    },
    [colunaQueFecha, salvando, mover],
  );

  /* O FOCO ACOMPANHA O CARTÃO e a mudança é DITA — ver `@/board/foco-do-cartao`. */
  const { seguir: seguirOCartao, aviso: avisoDoCartao } = useFocoDoCartao();
  const moverPeloTeclado = useCallback(
    (taskId: string, direcao: -1 | 1) => {
      const tarefa = quadro?.tasks.find((t) => t.id === taskId);
      if (!tarefa) return;
      const i = colunas.findIndex((c) => c.status.id === tarefa.statusId);
      const destino = colunas[i + direcao];
      if (i < 0 || !destino) return;
      seguirOCartao(taskId, textoDasMencoes(tarefa.title), destino.status.id, destino.status.name);
      void mover(taskId, destino.status.id);
    },
    [quadro, colunas, mover, seguirOCartao],
  );

  /* --- desenho --- */

  return (
    /* `altura="tela"` — F17.27. A cadeia de altura que faz o quadro ocupar o que
       sobra da janela começa aqui e termina em `.q-tela[data-altura='tela']`
       (`ui/quadro.css`). Sem ela a faixa de colunas fica com a altura da coluna
       mais alta, e a barra de rolagem horizontal nasce no meio da tela. */
    /*
      SEM VOLTAR — F29 (Fase 4). Até aqui a moldura desenhava `‹ Voltar`, que
      levava à visão do espaço desta lista (F17.33) — ou ao passo anterior, se
      houvesse histórico, e o botão não dizia qual dos dois. A saída agora é a
      trilha do topo, e cada degrau diz o nome do lugar a que leva. (A prop
      `comTopo` que marcava isto saiu na Fase 5a: toda tela usa o topo.)
    */
    <PaginaLarga altura={naLista ? 'natural' : 'tela'}>
      {/* A MOLDURA COMUM — F04. A grade à mão (barra + composição medida +
          coluna) virou a peça das outras telas; a árvore pronta, a lista ativa
          e a cadeia de altura seguem pelas props dela. */}
      {/* A ÁRVORE VIROU UMA SEÇÃO DA BARRA — F17.18. A árvore vai PRONTA:
          esta página já a carregou para saber qual lista abrir, e deixar a
          barra buscá-la de novo custaria duas idas ao servidor por abertura
          de quadro. Ver o cabeçalho de `@/board/BarraLateral`. */}
      <TelaComBarra
        atual="quadro"
        listaAtiva={listaId ?? null}
        arvore={
          <ArvoreDoQuadro
            podeMarcarCompartilhada={sessaoDaArvore?.isSuperadmin === true}
            titulo="Compartilhado comigo"
            arvore={arvore}
            companies={empresas}
            /* Espera, falha e ausência de espaços são três coisas — F17.CARGA03.
               Ver `EstadoDaLeitura`, em `@/board/arvore-compartilhada`. */
            leitura={leituraDaArvore}
            listaAtiva={listaId ?? null}
            mostrarArquivados={mostrarArquivados}
            aoAlternarArquivados={(m) => definirLugar((l) => ({ ...l, arquivados: m }))}
            aoEscolher={(id) => navigate(`/quadro/${id}`)}
            /* Clicar no NOME do espaço abre a visão geral dele — F17.26.
               A setinha ao lado continua sanfonando o galho. */
            aoAbrirEspaco={(id) => navigate(`/quadro/espaco/${id}`)}
            /* Clicar no NOME da pasta abre o quadro dela — F17.64.
               A setinha ao lado continua sanfonando o galho. */
            aoAbrirPasta={(id) => navigate(`/quadro/pasta/${id}`)}
            /* A lista trazida leva à ficha do cliente dela — F17.43. */
            aoAbrirCliente={(id) => navigate(`/cliente/${id}`)}
            aoRecarregar={lerArvore}
            aoRecusar={setAvisoDaArvore}
            revelar={revelar}
          />
        }
        altura={naLista ? undefined : 'tela'}
      >
        {/*
          O TOPO — F29: trilha + título, a primeira coisa da coluna de
          conteúdo. O título `Quadro` desceu do cabeçalho acima da grade (onde
          dividia a linha com o `‹ Voltar` e a marca), e a trilha continua
          onde a F17.25 a pôs — agora dentro do topo.

          A TRILHA — F17.25. PRIMEIRA COISA DA COLUNA DE CONTEÚDO, e é o mesmo
          lugar nas quatro telas do Pilar B.

          Aqui havia três `<span>` dentro do cartão de resumo, com dois
          separadores diferentes (`·` entre empresa e espaço, `/` no resto),
          sem ícone e sem clique. A mesma informação aparecia com outra forma
          na ficha da tarefa, e não aparecia nas duas telas de trabalho.

          Sem lista escolhida a trilha ainda diz onde se está — desde a
          F29.5b `Compartilhado comigo › Quadro`, com a raiz clicável
          (`trilhaEmEspera`); antes era `Meu trabalho › Quadro`, sem saída —,
          porque uma tela sem trilha é justamente o que esta etapa veio tirar.

          Espaço e pasta REVELAM o nó na árvore ao lado: é onde eles existem.
        */}
        {/* O NOME DA LISTA É O TÍTULO — F06A. Até aqui o `<h1>` dizia
            `Quadro` (a FORMA) e o nome real vinha num cartão logo abaixo,
            repetido. Agora o nome é a coisa mais forte da coluna; `Quadro`
            continua sendo o título enquanto a lista não chegou, e o ícone
            diz a forma. O cliente mora na linha do nome, e `Nova tarefa` é a
            ação da página. */}
        <Topo
          titulo={quadro ? quadro.header.listName : 'Quadro'}
          marca={
            quadro ? (
              <span className="o-topo-marca" title="Quadro">
                <IconeQuadro className="h-4 w-4" />
              </span>
            ) : undefined
          }
          junto={
            quadro ? (
              <>
                {/* Some quando não há nome — a lista sem cliente e o cliente
                    fora do alcance não ganham chip (`listaLevaAFicha`). */}
                <SinalDoClienteDaLista
                  clientId={listaAberta?.clientId ?? null}
                  clientName={listaAberta?.clientName ?? null}
                />
                {listaAberta && !listaAberta.live && (
                  <span className="cu-selo-morto">
                    {listaAberta.archivedAt !== null ? 'arquivada' : 'em lugar arquivado'}
                  </span>
                )}
              </>
            ) : undefined
          }
          acoes={
            quadro ? (
              <>
                <SeletorDeModo contexto="lista" valor={modo} aoEscolher={escolherModo} />
                {/* O formulário completo — o outro jeito de criar. F17.10. */}
                <button
                  type="button"
                  className="o-btn o-btn-primario o-btn-sm"
                  onClick={() => setFormularioAberto(true)}
                >
                  + Nova tarefa
                </button>
              </>
            ) : undefined
          }
          trilha={
            <Trilha
              degraus={quadro ? trilhaDoQuadro(quadro.header) : trilhaEmEspera('Quadro')}
              aoRevelar={pedirRevelar}
              expandida={trilhaAberta}
              aoExpandir={() => setTrilhaAberta(true)}
            />
          }
        />

        {/* F04: os avisos moram NA COLUNA, abaixo do título — e não acima da
            grade em largura inteira, empurrando a barra para baixo. */}
        {erro && (
          <div className="mb-3">
            <Aviso
              tipo="erro"
              acao={
                recuperavel
                  ? {
                      rotulo: 'Tentar de novo',
                      aoClicar: () => {
                        void lerArvore();
                        if (listaId) void lerQuadro(listaId);
                      },
                    }
                  : undefined
              }
            >
              {erro}
            </Aviso>
          </div>
        )}

        {/* A RECUSA DA ÁRVORE FICA EM CIMA, E INTEIRA — F17.14. As dez travas da
            F17 nomeiam a tarefa, a etiqueta e o espaço que estão no caminho.
            Cortar essa frase, ou trocá-la por "erro ao mover", jogaria fora o
            trabalho de três etapas. */}
        {avisoDaArvore && (
          <div className="mb-3">
            <Aviso tipo="erro">{avisoDaArvore}</Aviso>
          </div>
        )}

        {/* --- nada em lugar nenhum ------------------------------------- */}
        {linhasDaArvore !== null && listasVivas.length === 0 && !erro && (
          <Aviso tipo="info">
            Nenhuma lista viva ao seu alcance. Use o <b className="text-plat">+</b> da barra
            lateral para criar um espaço, ou o <b className="text-plat">···</b> de um espaço
            para criar a primeira pasta e a primeira lista.
          </Aviso>
        )}

        {carregando && quadro === null && listasVivas.length > 0 && (
          <p className="eyebrow">Carregando o quadro…</p>
        )}

        {quadro && (
          <>
            {/* --- a descrição e as ferramentas — F06A ------------------
                O cartão do resumo SAIU: o nome subiu para o título, o cliente
                para a linha dele e `Nova tarefa` para as ações da página. O
                que ficou aqui é o que se usa PARA TRABALHAR na lista, numa
                faixa só, sem moldura — a altura é das colunas. */}
            {quadro.header.listContent && (
              /* `key`: outra lista abre recolhida de novo. */
              <DescricaoDaLista key={quadro.header.listId} texto={quadro.header.listContent} />
            )}

            {naLista ? (
              /* A LISTA DESTA LISTA — F18C. Mesmas tarefas e etapas, pela
                 consulta paginada da F18A (escopo `lista`). */
              <TrabalhoDoEscopo escopo="lista" id={quadro.header.listId} modo="lista" nomeDoEscopo="nesta lista" />
            ) : (
            <>
            <FiltrosSoDaLista aoVerNaLista={() => escolherModo('lista')} />

            <div className="q-ferramentas">
              {/* A LUPA E O `Responsável` — F17.55. A MESMA peça de `Todas
                  as tarefas`, agora com a altura da busca das outras telas. */}
              <BarraDeFiltro
                filtro={filtro}
                aplicado={quadro.filter}
                opcoes={quadro.assigneeOptions}
                semResponsavel={quadro.unassignedTasks}
                achadas={achado.total}
                total={resumo.total}
                ocupado={carregando}
                aoMudar={trocarFiltro}
              />

              {/* O INTERRUPTOR `Subtarefas` da barra de controle — F17.15.
                  Ele NOMEIA quantos cartões estão escondidos: um botão que
                  só diz "Subtarefas" deixa a pessoa sem saber se há algo do
                  outro lado, e quem criou uma subtarefa e não a vê conclui
                  que o sistema a perdeu. */}
              <button
                type="button"
                className="q-interruptor"
                aria-pressed={mostrarSubtarefas}
                title={
                  mostrarSubtarefas
                    ? 'As subtarefas aparecem como cartão próprio, com o nome da mãe em cima'
                    : 'As subtarefas estão escondidas — o número no cartão da mãe diz quantas são'
                }
                onClick={() => definirLugar((l) => ({ ...l, subtarefas: !l.subtarefas }))}
              >
                {rotuloDoInterruptor(escondidas, mostrarSubtarefas)}
              </button>

              {/* F06C: só aparece quando muda alguma coisa. */}
              {interruptorUtil(paraRecolher) && (
                <InterruptorDeVazias
                  ligado={lugar.vazias}
                  vazias={quantasVazias(paraRecolher)}
                  aoAlternar={() => definirLugar((l) => ({ ...l, vazias: !l.vazias }))}
                />
              )}

              <div className="q-ferramentas-fim">
                <ContagemDoQuadro total={resumo.total} abertas={resumo.open} feitas={resumo.done} />

                {/* De onde a esteira veio. Vem pronto de `list_workflow`, e é
                    o que explica por que duas listas diferentes mostram as
                    mesmas colunas — agora a um clique, e não sempre aceso. */}
                <SobreAEsteira
                  nome={quadro.header.statusSetName}
                  heranca={quadro.header.inheritedFrom}
                  rotuloDaHeranca={INHERITED_LABEL[quadro.header.inheritedFrom]}
                />
              </div>
            </div>

            {avisoDoMovimento && (
              <div className="mb-3">
                <Aviso tipo="erro">{avisoDoMovimento}</Aviso>
              </div>
            )}

            {/* ⚠️ AQUI HAVIA DUAS FAIXAS AZUIS DE ESTADO VAZIO, E ELAS SAÍRAM
                NA F17.20. Uma dizia "esta lista não tem nenhuma tarefa"; a
                outra, "as N tarefas estão concluídas". As duas descreviam o
                que a linha de resumo logo acima já conta em números — `14
                tarefas · 0 em aberto · 14 concluídas` — e cada coluna vazia
                diz de novo, uma por uma. Três vezes a mesma informação.

                O que elas de fato guardavam era "coluna vazia não é leitura
                que falhou", e isso continua guardado: a coluna existe mesmo
                sem cartão, com o nome e o zero à vista. */}

            {/* --- as colunas ------------------------------------------- */}
            {/* A faixa RECEBE OS DOIS GESTOS DA F17.25 — a roda do mouse e o
                arrasto do fundo. O arrasto começa só onde não há gesto: o
                cartão continua sendo do `dragstart` que move de coluna. Ver
                as três armadilhas no cabeçalho de `@/board/rolagem`. */}
            {/* A NAVEGAÇÃO POR ETAPAS — F06C. Só quando a faixa não cabe. */}
            {mostrarNavegacao(colunas.length, etapas.transborda) && (
              <NavegacaoDeEtapas
                etapas={colunas.map((c) => ({
                  chave: c.status.id,
                  nome: c.status.name,
                  cor: c.status.color,
                  achadas: c.matched,
                  total: c.total,
                  recolhida: etapas.recolhidas.has(c.status.id),
                }))}
                aVista={etapas.aVista}
                aoIr={etapas.irPara}
              />
            )}
            {/* O que o teclado fez, dito — ver `@/board/foco-do-cartao`. */}
            <p className="sr-only" role="status">{avisoDoCartao}</p>
            <div
              className="q-colunas"
              ref={etapas.ref}
              data-rolagem={ROLADOR.faixa}
              data-recolhe={etapas.recolhidas.size > 0 ? 'true' : undefined}
            >
              {/* Um pedido só para a tela inteira — F17.56. Ele envolve as
                  colunas, e não a página: o que precisa de arte é cartão. */}
              <ProvedorDeMencoes listId={quadro.header.listId}><ProvedorDeMiniaturas ids={artesNaTela}>
              {colunas.map((c) => (
                <Coluna
                  key={c.status.id}
                  status={c.status}
                  tarefas={c.tasks}
                  total={c.total}
                  achadas={c.matched}
                  carregadas={c.carregadas}
                  buscandoMais={buscandoMais}
                  aoMostrarMais={mostrarMais}
                  hoje={hoje}
                  alvo={alvo === c.status.id}
                  arrastando={arrastando}
                  salvando={salvando}
                  aoEntrar={() => setAlvo(c.status.id)}
                  aoSair={() => setAlvo((a) => (a === c.status.id ? null : a))}
                  aoSoltar={(taskId) => void mover(taskId, c.status.id)}
                  aoIniciarArrasto={setArrastando}
                  aoTerminarArrasto={() => {
                    setArrastando(null);
                    setAlvo(null);
                  }}
                  aoMoverPeloTeclado={moverPeloTeclado}
                  aoCriarNaColuna={criarNaColuna}
                  listaDoQuadro={listaDoQuadro}
                  moverDoCartao={moverDoCartao}
                  concluirDoCartao={concluirDoCartao}
                  responsavelDoCartao={responsavelDoCartao}
                  /* Só quando o chip do cliente está no topo (vínculo E nome
                     ao alcance): aí o nome no cartão é repetição — F06B. */
                  clienteDaVisao={listaAberta && listaLevaAFicha(listaAberta) ? listaAberta.clientId : null}
                  recolhida={etapas.recolhidas.has(c.status.id)}
                  aoAbrir={() => etapas.abrir(c.status.id)}
                  aoRecolher={etapas.recolhiveis.has(c.status.id) ? () => etapas.fechar(c.status.id) : undefined}
                />
              ))}
              </ProvedorDeMiniaturas></ProvedorDeMencoes>
            </div>

            {/* Não deveria acontecer: o gatilho recusa status fora da esteira.
                Se acontecer, some-las esconderia trabalho — que é o pior
                defeito possível num quadro. */}
            {orfas.length > 0 && (
              <div className="mt-3">
                <Aviso tipo="atencao">
                  {orfas.length} {orfas.length === 1 ? 'tarefa está' : 'tarefas estão'} com
                  status fora da esteira desta lista e não {orfas.length === 1 ? 'cabe' : 'cabem'}{' '}
                  em coluna nenhuma: {orfas.map((t) => textoDasMencoes(t.title)).join(', ')}.
                </Aviso>
              </div>
            )}
            </>
            )}

          </>
        )}

        {/* O MODAL de tarefa nova — F17.10b. Substituiu o formulário da
            F17.10: o ClickUp não tem formulário de tarefa, tem um modal com
            fila de chips e um menu flutuante por chip. Ver `ModalDeTarefa`. */}
        {formularioAberto && quadro && (
          <ModalDeTarefa
            quadro={
              listaDoQuadro
                ? { ...quadro, header: { ...quadro.header, requiresClient: listaDoQuadro.requiresClient } }
                : quadro
            }
            /* Só o que está vivo: o menu de listas do modal escolhe ONDE a
               tarefa nasce, e lista arquivada não é lugar de nascer. */
            arvore={arvoreViva}
            aoFechar={() => setFormularioAberto(false)}
            aoCriar={(taskId) => {
              setFormularioAberto(false);
              navigate(`/tarefa/${taskId}`);
            }}
          />
        )}
      </TelaComBarra>
      {janelaDaMudanca}
    </PaginaLarga>
  );
}
