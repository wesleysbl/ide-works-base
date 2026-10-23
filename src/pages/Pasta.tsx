import { textoDasMencoes } from '@/board/mencoes';
import { useFocoDoCartao } from '@/board/foco-do-cartao';
/**
 * O QUADRO DA PASTA — todos os clientes juntos. Etapa F17.64.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO, TEXTUAL
 *
 *   *"quando aperta em `TIME HELENA` não aparece a tela geral (todos os
 *   clientes juntos, sabe?)"*
 *
 *   Até aqui, clicar numa pasta só abria e fechava o galho da árvore. A F17.26
 *   deu tela ao ESPAÇO; a pasta não tinha nenhuma.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ ELA NÃO É A VISÃO DO ESPAÇO COM OUTRO FILTRO
 *   A tela do espaço LISTA o que há dentro, com o progresso de cada lista. Esta
 *   JUNTA AS TAREFAS em colunas. Uma responde "como está cada cliente"; a
 *   outra, "o que há para fazer em arte hoje, de todo mundo".
 *
 * ⚠️ A COLUNA É O NOME DA ETAPA, E NÃO O STATUS
 *   `TIME HELENA` tem 25 listas e 24 esteiras — mas 15 nomes de etapa. As
 *   esteiras são cópias. A medição, a regra e as alternativas descartadas
 *   estão no cabeçalho de `@/board/quadro-da-pasta`, que é onde a decisão
 *   mora.
 *
 * ⚠️ ARRASTAR AQUI MUDA A ETAPA DENTRO DA LISTA DE ORIGEM
 *   O cartão do `Valentini` que sai de `a fazer arte` para `aprovação` continua
 *   sendo do `Valentini`. Quem move de LISTA é o `···` do cartão (F17.63), que
 *   continua aqui e continua sendo a mesma escrita — `ideworks.move_task`.
 *
 *   E quando a lista de origem NÃO TEM a etapa da coluna de destino, o
 *   movimento é recusado ANTES de ir ao banco, com a frase que nomeia a lista e
 *   a etapa. Deixar o cartão pular e voltar seria mostrar um destino que não
 *   existe. Ver `statusParaMover`.
 *
 * O QUE ESTA TELA NÃO FAZ, E É DE PROPÓSITO
 *   Não cria tarefa. `+ Adicionar tarefa` no pé da coluna e `+ Nova tarefa` no
 *   cabeçalho existem no quadro da LISTA, onde a pergunta "em qual lista?" já
 *   tem resposta. Aqui a coluna `a fazer arte` pertence a vinte e cinco listas,
 *   e um botão que precisasse perguntar o cliente antes de criar seria um
 *   formulário disfarçado de atalho. Está escrito como dívida no plano.
 *
 * LISTA | KANBAN — F18C (revisão de 28/09, R09)
 *   O Kanban é ESTE quadro, o que a equipe já usa: colunas por nome de etapa,
 *   arrasto, etapas vazias recolhidas, rolagem devolvida. A Lista é a peça
 *   comum da F18B (`TrabalhoDoEscopo`, escopo `pasta`): as mesmas listas vivas
 *   da pasta, paginadas no servidor, com cliente, etapa real, prazo e
 *   concluídas. Trocar de Kanban por fluxo (o do espaço) mudaria o que o time
 *   vê todo dia e o arrasto entre listas de esteira copiada — ficou como está.
 *   Na Lista esta tela não lê o quadro: o título e a trilha vêm da árvore.
 *
 * A TELA NÃO FALA SOBRE SI MESMA — F17.20. Sem rodapé explicativo.
 */

import { useMoverEntreListas } from '@/board/useMoverEntreListas';
import { SeletorDeModo } from '@/board/SeletorDeForma';
import { FiltrosSoDaLista, TrabalhoDoEscopo } from '@/board/TrabalhoDoEscopo';
import { useModoDaTela } from '@/board/usar-modo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { type BoardTask, CARTOES_POR_COLUNA, summarize, today } from '@/board/board';
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
import { BarraDeFiltro } from '@/board/BarraDeFiltro';
import { ContagemDoQuadro } from '@/board/CabecalhoDaLista';
import { type FiltroDeTarefas, lerFiltro, paraEndereco } from '@/board/filtro';
import { useParametrosNoEndereco } from '@/ui/endereco';
import { usePuxarParaRolar } from '@/board/rolagem';
// A rolagem de cada coluna e da faixa volta ao fechar o cartão — F32.
import { ROLADOR } from '@/ui/rolagem-interna';
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDaPasta, trilhaEmEspera } from '@/board/trilha';
import {
  type NoDeEspaco,
  acharListas,
  buildFullTree,
  paraNavegacao,
} from '@/board/arvore';
// A MESMA leitura da barra e das telas vizinhas — F17.CARGA02.
import { useArvoreCompleta } from '@/board/arvore-compartilhada';
import { useSessao } from '@/ui/sessao';
import { ArvoreDoQuadro } from '@/board/ArvoreDoQuadro';
import { avisoDaAutomacao } from '@/board/automacoes';
import { usePedidoDeRevelar } from '@/board/secao-recolhivel';
import { TelaComBarra } from '@/board/TelaComBarra';
import {
  type ColunaDaPasta,
  type EtapaDaPasta,
  type FolderBoard,
  type TarefaDaPasta,
  colunasDaPasta,
  etapaQueFechaNaPasta,
  orfasDaPasta,
  recusaDeEtapaAusente,
  resumoDaPasta,
  rotuloDeAbrangencia,
  statusParaMover,
} from '@/board/quadro-da-pasta';
import { useLugar } from '@/ui/aparencia';
import { lembrarRecente } from '@/ui/lugar';
import { ApiError, api, semSessao } from '@/lib/api';
import { Aviso, PaginaLarga } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';
import { entregar, useVez } from '@/ui/vez';
import { useAoFecharAFichaAoLado } from '@/ui/usar-ficha-ao-lado';
import '@/ui/quadro.css';
import '@/ui/tarefa.css';
import '@/ui/clickup.css';
import '@/ui/passos.css';

/* ───────────────────────────── ícone local ───────────────────────────── */

const IconePastaCheia = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className ?? 'h-4 w-4'}
    aria-hidden
  >
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M8 12h8M8 15h5" />
  </svg>
);

/* ───────────────────────────── o cartão ───────────────────────────── */

/**
 * O `<li>` QUE ARRASTA — a MESMA casca do quadro da lista, com uma diferença: o
 * corpo recebe `lista`, e é ela que diz de quem é a tarefa.
 *
 * As três armadilhas do portal (F17.63) valem igual aqui, e por isso as duas
 * guardas `e.target !== e.currentTarget` vieram junto: sem elas, arrastar texto
 * dentro do balão de `Mover para` faria o quadro achar que o cartão está sendo
 * movido, e as setas do menu MOVERIAM a tarefa de coluna no meio da escolha.
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
}: {
  tarefa: TarefaDaPasta;
  hoje: ReturnType<typeof today>;
  arrastando: boolean;
  salvando: boolean;
  aoIniciarArrasto: () => void;
  aoTerminarArrasto: () => void;
  aoMoverPeloTeclado: (direcao: -1 | 1) => void;
  mover: MoverDoCartao;
  /** O ✓ de concluir — ausente quando a lista da tarefa não tem etapa que feche, ou ela já está nela. */
  concluir?: ConcluirDoCartao;
  /** As iniciais que se clicam — F17.69. Ver `ResponsavelDoCartao`. */
  responsavel: ResponsavelDoCartao;
}) {
  return (
    <li
      className="q-cartao"
      // O foco acha o cartão por aqui depois de trocar de etapa pelas setas.
      data-cartao={tarefa.id}
      draggable={!salvando}
      data-arrastando={arrastando}
      data-salvando={salvando}
      tabIndex={0}
      aria-label={`${textoDasMencoes(tarefa.title)}, da lista ${tarefa.listName}. Use as setas para a esquerda e para a direita para mudar de etapa.`}
      onDragStart={(e) => {
        if (e.target !== e.currentTarget) return;
        e.dataTransfer.setData('text/plain', tarefa.id);
        e.dataTransfer.effectAllowed = 'move';
        aoIniciarArrasto();
      }}
      onDragEnd={aoTerminarArrasto}
      onKeyDown={(e) => {
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
        lista={{ id: tarefa.listId, name: tarefa.listName }}
      />
    </li>
  );
}

/* ───────────────────────────── a coluna ───────────────────────────── */

function Coluna({
  coluna,
  listasDaPasta,
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
  moverDoCartao,
  concluirDoCartao,
  responsavelDoCartao,
  recolhida,
  aoAbrir,
  aoRecolher,
  idDoNome,
}: {
  coluna: ColunaDaPasta;
  /** Quantas listas a pasta tem — é o denominador de `10 de 25 listas`. */
  listasDaPasta: number;
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
  moverDoCartao: (tarefa: TarefaDaPasta) => MoverDoCartao;
  /** O ✓ de UM cartão; `undefined` quando a lista dele não tem etapa que feche ou ele já está nela. */
  concluirDoCartao: (tarefa: TarefaDaPasta) => ConcluirDoCartao | undefined;
  /** O seletor de responsavel de UM cartao — F17.69. */
  responsavelDoCartao: (tarefa: TarefaDaPasta) => ResponsavelDoCartao;
  /** Etapa vazia recolhida — F06C. Ver `@/board/etapas-vazias`. */
  recolhida: boolean;
  aoAbrir: () => void;
  aoRecolher?: () => void;
  /** A chave da etapa é um nome (pode ter espaço): o id vem pronto, pela posição. */
  idDoNome: string;
}) {
  const { etapa } = coluna;
  const abrangencia = rotuloDeAbrangencia(etapa, listasDaPasta);

  return (
    <section
      className="q-coluna"
      data-etapa={etapa.key}
      data-recolhida={recolhida ? 'true' : undefined}
      tabIndex={-1}
      aria-labelledby={idDoNome}
      data-alvo={alvo}
      /* A ÚNICA COR QUE VEM DO CLICKUP. Como variável, nunca como classe (D10). */
      style={etapa.color ? { ['--cor-status' as string]: etapa.color } : undefined}
      onDragOver={(e) => {
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
      {recolhida ? (
        <DobraDaEtapa nome={etapa.name} idDoNome={idDoNome} aoAbrir={aoAbrir} />
      ) : (
      <>
      <header className="q-coluna-topo">
        <span className="q-ponto" />
        <h2 className="q-coluna-nome truncate" id={idDoNome}>{etapa.name}</h2>

        {/* ⚠️ EM QUANTAS LISTAS ESTA ETAPA EXISTE — e só quando não são todas.
            `no radar` está em 10 das 25 listas de `TIME HELENA`: sem esta
            linha, a coluna pareceria vazia por falta de trabalho quando na
            verdade quinze clientes não têm essa etapa. */}
        {abrangencia && (
          <span
            className="q-abrangencia"
            title={`Esta etapa existe em ${etapa.lists} das ${listasDaPasta} listas da pasta. As outras não a têm, e o cartão delas não pode ser solto aqui.`}
          >
            {abrangencia}
          </span>
        )}

        <span className="tnum ml-auto text-[0.72rem] text-plat-dim">
          {coluna.matched === coluna.total ? coluna.total : `${coluna.matched} de ${coluna.total}`}
        </span>
        <RecolherEtapa nome={etapa.name} aoRecolher={aoRecolher} />
      </header>

      {/* O nome da caixa — F32. É por ele que a rolagem desta coluna volta
          depois de abrir e fechar um cartão. Ver `@/ui/rolagem-interna`. */}
      <ul className="q-coluna-corpo" data-rolagem={ROLADOR.coluna(etapa.key)}>
        {coluna.tasks.map((t) => (
          <Cartao
            key={t.id}
            tarefa={t}
            hoje={hoje}
            arrastando={arrastando === t.id}
            salvando={salvando.has(t.id)}
            aoIniciarArrasto={() => aoIniciarArrasto(t.id)}
            aoTerminarArrasto={aoTerminarArrasto}
            aoMoverPeloTeclado={(d) => aoMoverPeloTeclado(t.id, d)}
            mover={moverDoCartao(t)}
            concluir={concluirDoCartao(t)}
            responsavel={responsavelDoCartao(t)}
          />
        ))}

        {/* F06B: vazia pelo filtro não é vazia de verdade. */}
        {coluna.tasks.length === 0 && <ColunaVazia filtrada={coluna.matched < coluna.total} total={coluna.total} />}
      </ul>

      {/* O CORTE, DITO EM VOZ ALTA — F17.50. Medido contra `matched`, e não
          contra `total`: com filtro, uma coluna de 133 pode ter 27 achados, e
          os 27 cabem na janela de 50 — não há nada a mostrar a mais. */}
      {coluna.tasks.length < coluna.matched && (
        <div className="q-coluna-corte">
          <span className="tnum" aria-live="polite">
            {coluna.tasks.length} de {coluna.matched}
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
      </>
      )}
    </section>
  );
}

/* ───────────────────────────── a tela ───────────────────────────── */

export default function Pasta() {
  const { mover: moverEntreListas, janela: janelaDaMudanca } = useMoverEntreListas();
  const { pastaId } = useParams<{ pastaId?: string }>();
  const navigate = useNavigate();
  const [lugar, definirLugar] = useLugar();

  /* A ÁRVORE VEM DA CONSULTA COMPARTILHADA — F17.CARGA02. Ver
     `@/board/arvore-compartilhada`: a recusa e o 401 moram lá, iguais para as
     quatro telas que a desenham. */
  const {
    linhas: linhasDaArvore,
    empresas,
    recusa: treeError,
    estado: leituraDaArvore,
    recarregar: lerArvore,
  } = useArvoreCompleta();
  /* Quem administra liga e desliga a marca "exige cliente" na árvore — F38, Fase 7. */
  const { sessao: sessaoDaArvore } = useSessao();
  const [avisoDaArvore, setAvisoDaArvore] = useState<string | null>(null);
  const [quadro, setQuadro] = useState<FolderBoard | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoDoMovimento, setAvisoDoMovimento] = useState<string | null>(null);

  /* A JANELA DA COLUNA — F17.50. `ref` e não `state` pela mesma razão do quadro
     da lista: `lerQuadro` é relida a cada movimento, e a janela precisa
     acompanhá-la sem recriar a função. */
  const janelaDaColuna = useRef<number | undefined>(undefined);
  const [buscandoMais, setBuscandoMais] = useState(false);

  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<Set<string>>(() => new Set());
  const [menuDoCartao, setMenuDoCartao] = useState<string | null>(null);

  /* F29: em `Somente ícones` o pedido expande a barra antes — ver o gancho. */
  const [revelar, pedirRevelar] = usePedidoDeRevelar();
  const [trilhaAberta, setTrilhaAberta] = useState(false);

  const hoje = useRef(today()).current;
  const faixaDeColunas = usePuxarParaRolar<HTMLDivElement>();

  /* LISTA | KANBAN — F18C. Ver o cabeçalho. Padrão: Kanban (o de sempre). */
  const [modo, escolherModo] = useModoDaTela('pasta', pastaId ?? null);

  /* A BUSCA E O RESPONSÁVEL MORAM NO ENDEREÇO — F17.55, pela regra da F17.24. */
  const [parametros, definirParametros] = useParametrosNoEndereco();
  const busca = parametros.get('busca') ?? '';
  const responsavelPedido = parametros.get('responsavel') ?? '';
  const filtro = useMemo(() => lerFiltro(busca, responsavelPedido), [busca, responsavelPedido]);
  const trocarFiltro = useCallback(
    (proximo: FiltroDeTarefas) => {
      janelaDaColuna.current = undefined;
      const endereco = paraEndereco(proximo);
      definirParametros({ busca: endereco.busca ?? '', responsavel: endereco.responsavel ?? '' });
    },
    [definirParametros],
  );

  const paraLogin = (e: unknown) => {
    if (semSessao(e)) {
      window.location.replace('/');
      return true;
    }
    return false;
  };

  /* --- a árvore --- */

  const arvore: NoDeEspaco[] = useMemo(
    () => (linhasDaArvore === null ? [] : buildFullTree(linhasDaArvore)),
    [linhasDaArvore],
  );
  const arvoreViva = useMemo(() => paraNavegacao(arvore), [arvore]);

  /* --- o quadro --- */

  const vez = useVez();
  const lerQuadro = useCallback(
    async (id: string, silencioso = false) => {
      const ticket = silencioso ? vez.reabrir(id) : vez.abrir(id);
      if (ticket === null) return;
      if (!silencioso) {
        setCarregando(true);
        setErro(null);
      }
      await entregar(vez, ticket, api.quadroDaPasta(id, janelaDaColuna.current, filtro), {
        chegou: (r) => {
          setQuadro(r.board as FolderBoard);
          setErro(null);
        },
        falhou: (e) => {
          if (paraLogin(e)) return;
          if (!silencioso) setQuadro(null);
          setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar o quadro da pasta.');
        },
        terminou: () => setCarregando(false),
      });
    },
    [vez, filtro],
  );

  /* NA LISTA, O QUADRO NÃO É LIDO — F18C. Ao voltar para o Kanban, relê só
     se a pasta ou o filtro mudou desde a última leitura (`lidoCom`). */
  const lidoCom = useRef<string | null>(null);
  /* Desmontar esquece a leitura: a vez (`@/ui/vez`) descarta o pedido em voo, e
     a montagem seguinte — inclusive a segunda do modo estrito — precisa pedir de novo. */
  useEffect(() => () => {
    lidoCom.current = null;
  }, []);
  useEffect(() => {
    if (!pastaId || modo !== 'kanban') return;
    const chave = `${pastaId}\u0000${busca}\u0000${responsavelPedido}`;
    if (lidoCom.current === chave) return;
    lidoCom.current = chave;
    janelaDaColuna.current = undefined;
    void lerQuadro(pastaId);
    // `busca`/`responsavel` já chegam por `lerQuadro` (o filtro é dependência dela).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastaId, lerQuadro, modo]);

  /* O CARD AO LADO FECHOU — F43, Fase 7: relê em silêncio o quadro que ficou
     atrás do painel. Ver o mesmo trecho em `Quadro`. */
  useAoFecharAFichaAoLado(() => {
    if (pastaId && modo === 'kanban') void lerQuadro(pastaId, true);
  });

  /* A pasta NA ÁRVORE — o título e a trilha da Lista, que não lê o quadro. */
  const pastaNaArvore = useMemo(() => {
    for (const e of arvore) {
      const f = e.folders.find((x) => x.id === pastaId);
      if (f) return { pasta: f, espaco: e };
    }
    return null;
  }, [arvore, pastaId]);
  const cabecalho = quadro
    ? {
        spaceId: quadro.header.spaceId,
        spaceName: quadro.header.spaceName,
        folderId: quadro.header.folderId,
        folderName: quadro.header.folderName,
        arquivada: quadro.header.folderArchivedAt !== null,
      }
    : pastaNaArvore
      ? {
          spaceId: pastaNaArvore.espaco.id,
          spaceName: pastaNaArvore.espaco.name,
          folderId: pastaNaArvore.pasta.id,
          folderName: pastaNaArvore.pasta.name,
          arquivada: pastaNaArvore.pasta.archivedAt !== null,
        }
      : null;
  const naLista = modo === 'lista';

  /* --- derivados --- */

  const colunas = useMemo(
    () =>
      quadro === null
        ? []
        : colunasDaPasta(quadro.etapas, quadro.tasks, quadro.columnTotals, quadro.columnMatched),
    [quadro],
  );

  /* AS ETAPAS VAZIAS E A NAVEGAÇÃO — F06C. */
  const paraRecolher = useMemo(
    () => colunas.map((c) => ({ chave: c.etapa.key, total: c.total, aVista: c.tasks.length })),
    [colunas],
  );
  const etapas = useEtapasDoQuadro({
    quadroId: quadro?.header.folderId ?? null,
    colunas: paraRecolher,
    recolher: lugar.vazias,
    puxar: faixaDeColunas,
  });

  const artesNaTela = useMemo(
    () => (quadro === null ? [] : quadro.tasks.map((t) => t.previewAttachmentId)),
    [quadro],
  );

  const orfas = useMemo(
    () => (quadro === null ? [] : orfasDaPasta(quadro.etapas, quadro.tasks)),
    [quadro],
  );

  const resumo = useMemo(
    () => (quadro === null ? summarize([] as BoardTask[]) : resumoDaPasta(quadro)),
    [quadro],
  );
  const achado = useMemo(
    () => (quadro === null ? summarize([] as BoardTask[]) : resumoDaPasta(quadro, 'achadas')),
    [quadro],
  );

  /* --- mover de ETAPA (o arrasto) --- */

  /**
   * ⚠️ O DESTINO É RESOLVIDO CONTRA A LISTA DA TAREFA, e é aqui que esta tela
   * difere do quadro da lista.
   *
   * A coluna é um NOME de etapa; o que o banco entende é um `status_id`, e cada
   * lista tem o seu. `statusParaMover` faz a tradução com o mapa que o servidor
   * já mandou — e devolve nulo quando a lista de origem simplesmente não tem
   * aquela etapa. Nesse caso o movimento é recusado ANTES de ir ao banco, com a
   * frase que nomeia a lista e a etapa: deixar o cartão pular e voltar seria
   * mostrar um destino que nunca existiu.
   *
   * A escrita, quando acontece, é a de sempre — `ideworks.move_task` com a
   * lista DA PRÓPRIA TAREFA. A tarefa não muda de lista arrastando aqui.
   */
  const moverEtapa = useCallback(
    async (taskId: string, etapa: EtapaDaPasta) => {
      setAlvo(null);
      setArrastando(null);

      const atual = quadro;
      if (!atual) return;

      const tarefa = atual.tasks.find((t) => t.id === taskId);
      if (!tarefa || tarefa.columnKey === etapa.key) return;
      if (salvando.has(taskId)) return;

      const destino = statusParaMover(etapa, tarefa.listId);
      if (destino === null) {
        setAvisoDoMovimento(recusaDeEtapaAusente(tarefa.listName, etapa.name));
        return;
      }

      const anterior = { chave: tarefa.columnKey, status: tarefa.statusId };
      const aplicar = (chave: string | null, statusId: string | null) =>
        setQuadro((q) =>
          q === null
            ? q
            : {
                ...q,
                tasks: q.tasks.map((t) =>
                  t.id === taskId ? { ...t, columnKey: chave, statusId } : t,
                ),
              },
        );

      aplicar(etapa.key, destino);
      setAvisoDoMovimento(null);
      setSalvando((s) => new Set(s).add(taskId));

      try {
        const r = await api.moverTarefaNoQuadro(taskId, tarefa.listId, destino);

        if (r.move.statusRepositioned && r.move.statusId !== destino) {
          setAvisoDoMovimento(
            'O banco reposicionou o cartão: a etapa pedida não valia para a lista dele.',
          );
        }
        if (r.move.subtasksMoved > 0) {
          setAvisoDoMovimento(
            `${r.move.subtasksMoved} subtarefa(s) foram junto — a subtarefa mora na lista da mãe, e o banco as move em bloco.`,
          );
        }
        if (r.move.automation !== null) setAvisoDoMovimento(avisoDaAutomacao(r.move.automation));

        // RELER, e não deduzir: mover para a etapa que fecha carimba a conclusão
        // (gatilho `task_status_guard`), e a única forma de a tela saber disso
        // sem reimplementar a regra é perguntar.
        if (pastaId) await lerQuadro(pastaId, true);
        await lerArvore();
      } catch (e) {
        if (paraLogin(e)) return;
        aplicar(anterior.chave, anterior.status);
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
    [quadro, salvando, pastaId, lerQuadro, lerArvore],
  );

  /* O FOCO ACOMPANHA O CARTÃO e a mudança é DITA — ver `@/board/foco-do-cartao`. */
  const { seguir: seguirOCartao, aviso: avisoDoCartao } = useFocoDoCartao();
  const moverPeloTeclado = useCallback(
    (taskId: string, direcao: -1 | 1) => {
      const tarefa = quadro?.tasks.find((t) => t.id === taskId);
      if (!tarefa) return;
      const i = colunas.findIndex((c) => c.etapa.key === tarefa.columnKey);
      const destino = colunas[i + direcao];
      if (i < 0 || !destino) return;
      seguirOCartao(taskId, textoDasMencoes(tarefa.title), destino.etapa.key, destino.etapa.name);
      void moverEtapa(taskId, destino.etapa);
    },
    [quadro, colunas, moverEtapa, seguirOCartao],
  );

  /* O ✓ DO CARTÃO: leva a tarefa à etapa que FECHA na lista DELA — a mesma
     escrita do arrasto (`moverEtapa`), então o banco carimba a conclusão. */
  const concluirDoCartao = useCallback(
    (tarefa: TarefaDaPasta): ConcluirDoCartao | undefined => {
      const etapa = etapaQueFechaNaPasta(quadro?.etapas ?? [], tarefa);
      if (etapa === null) return undefined;
      return { desativado: salvando.has(tarefa.id), aoConcluir: () => void moverEtapa(tarefa.id, etapa) };
    },
    [quadro, salvando, moverEtapa],
  );

  /* --- mover de LISTA, direto do cartão (F17.63) --- */

  /**
   * O `···` continua sendo quem move de LISTA — e aqui ele é a única forma.
   *
   * ⚠️ `listaAtual` VEM DA TAREFA, e não da tela. No quadro da lista as duas
   * coisas eram a mesma; aqui a coluna tem cartão de vinte e cinco listas, e um
   * `listaAtual` fixo marcaria a lista errada como "onde ela está" em vinte e
   * quatro deles.
   */
  const recentesAchados = useMemo(
    () => acharListas(arvoreViva, lugar.recentes),
    [arvoreViva, lugar.recentes],
  );

  const moverParaLista = useCallback(
    async (tarefa: TarefaDaPasta, listId: string) => {
      if (salvando.has(tarefa.id)) return;
      setMenuDoCartao(null);
      if (tarefa.listId === listId) return;

      setAvisoDoMovimento(null);
      setSalvando((s) => new Set(s).add(tarefa.id));

      try {
        const r = await moverEntreListas(tarefa.id, listId);
        if (!r) return;

        const destino = acharListas(arvoreViva, [listId])[0];
        const partes = [`Movida para ${destino?.nome ?? 'a outra lista'}.`];
        if (r.move.statusRepositioned) {
          partes.push('A esteira de lá é outra, e o banco reposicionou a etapa.');
        }
        if (r.move.subtasksMoved > 0) {
          partes.push(
            `${r.move.subtasksMoved} subtarefa(s) foram junto — a subtarefa mora na lista da mãe.`,
          );
        }
        if (r.move.automation !== null) partes.push(avisoDaAutomacao(r.move.automation));
        setAvisoDoMovimento(partes.join(' '));

        definirLugar((l) => ({ ...l, recentes: lembrarRecente(l.recentes, listId) }));

        if (pastaId) await lerQuadro(pastaId, true);
        await lerArvore();
      } catch (e) {
        if (paraLogin(e)) return;
        setAvisoDoMovimento(
          e instanceof ApiError ? e.message : 'Não foi possível mover. A tarefa ficou onde estava.',
        );
      } finally {
        setSalvando((s) => {
          const proximo = new Set(s);
          proximo.delete(tarefa.id);
          return proximo;
        });
      }
    },
    [moverEntreListas, salvando, arvoreViva, definirLugar, pastaId, lerQuadro, lerArvore],
  );

  const moverDoCartao = useCallback(
    (tarefa: TarefaDaPasta): MoverDoCartao => ({
      arvore: arvoreViva,
      recentes: recentesAchados,
      listaAtual: tarefa.listId,
      aberto: menuDoCartao === tarefa.id,
      desativado: salvando.has(tarefa.id),
      aoAlternar: () => setMenuDoCartao((atual) => (atual === tarefa.id ? null : tarefa.id)),
      aoFechar: () => setMenuDoCartao(null),
      aoEscolher: (listId) => void moverParaLista(tarefa, listId),
    }),
    [arvoreViva, recentesAchados, menuDoCartao, salvando, moverParaLista],
  );

  /* --- definir responsável pela capa do cartão (F17.69) --- */

  /**
   * ⚠️ É O MESMO GANCHO DO QUADRO DA LISTA, e essa é a razão de ele existir.
   *
   * `@/board/responsavel-do-cartao` guarda o estado, o otimismo e o desfazer;
   * esta página só diz onde a frase aparece e como reler. Se o laço morasse nas
   * duas páginas, um dos dois quadros ganharia o próximo conserto e o outro
   * não — foi o que aconteceu antes de `CorpoDoCartao` existir (F17.18).
   *
   * ⚠️ AQUI A LISTA DE GENTE MUDA DE CARTÃO PARA CARTÃO, e o quadro da pasta é
   * onde isso importa: a coluna `a fazer arte` junta tarefas de vinte e cinco
   * clientes, e quem alcança a lista de um cartão pode não alcançar a do
   * vizinho. Por isso a lista é pedida por tarefa, e nunca reaproveitada.
   */
  const responsavelDoCartao = useResponsavelDoCartao({
    aoAvisar: setAvisoDoMovimento,
    aoTerminar: async () => {
      // `pastaId` vem do endereço e é opcional no tipo — mesma guarda das outras
      // releituras desta página.
      if (pastaId) await lerQuadro(pastaId, true);
    },
  });

  /* --- `Mostrar mais` (F17.50) --- */

  const mostrarMais = useCallback(() => {
    if (pastaId === undefined || buscandoMais) return;
    const agora = quadro?.perColumn ?? CARTOES_POR_COLUNA;
    janelaDaColuna.current = agora * 2;
    setBuscandoMais(true);
    void lerQuadro(pastaId, true).finally(() => setBuscandoMais(false));
  }, [pastaId, buscandoMais, quadro, lerQuadro]);

  /* --- desenho --- */

  return (
    /* SEM VOLTAR — F29 (Fase 4). A moldura desenhava `‹ Voltar`, que levava à
       visão do espaço desta pasta (F17.33) ou ao passo anterior, sem dizer
       qual. A saída agora é a trilha do topo, com o nome de cada lugar. */
    <PaginaLarga altura={naLista ? 'natural' : 'tela'}>
      {/* A MOLDURA COMUM — F04. A grade à mão (barra + composição medida +
          coluna) virou a peça das outras telas; a árvore pronta, a lista ativa
          e a cadeia de altura seguem pelas props dela. */}
      <TelaComBarra
        atual="quadro"
        listaAtiva={null}
        arvore={
          <ArvoreDoQuadro
            podeMarcarCompartilhada={sessaoDaArvore?.isSuperadmin === true}
            titulo="Compartilhado comigo"
            arvore={arvore}
            companies={empresas}
            /* Espera, falha e ausência de espaços são três coisas — F17.CARGA03. */
            leitura={leituraDaArvore}
            listaAtiva={null}
            pastaAtiva={pastaId ?? null}
            mostrarArquivados={lugar.arquivados}
            aoAlternarArquivados={(m) => definirLugar((l) => ({ ...l, arquivados: m }))}
            aoEscolher={(id) => navigate(`/quadro/${id}`)}
            aoAbrirEspaco={(id) => navigate(`/quadro/espaco/${id}`)}
            /* Clicar no NOME da pasta abre o quadro dela — F17.64. A setinha
               ao lado continua sanfonando o galho. */
            aoAbrirPasta={(id) => navigate(`/quadro/pasta/${id}`)}
            aoAbrirCliente={(id) => navigate(`/cliente/${id}`)}
            aoRecarregar={lerArvore}
            aoRecusar={setAvisoDaArvore}
            revelar={revelar}
          />
        }
        altura={naLista ? undefined : 'tela'}
      >
        {/* O TOPO — F29: trilha + título, no alto da coluna de conteúdo. O
            degrau do espaço continua REVELANDO o nó na árvore ao lado. */}
        {/* O NOME DA PASTA É O TÍTULO — F06A, a mesma regra do quadro da
            lista: `Pasta` só enquanto ela não chegou. */}
        <Topo
          titulo={cabecalho ? cabecalho.folderName : 'Pasta'}
          acoes={cabecalho ? <SeletorDeModo contexto="pasta" valor={modo} aoEscolher={escolherModo} /> : undefined}
          marca={
            cabecalho ? (
              <span className="o-topo-marca" title="Pasta">
                <IconePastaCheia className="h-4 w-4" />
              </span>
            ) : undefined
          }
          junto={
            /* O SELO DA EMPRESA SAIU — F31 ("será apenas Ide", Wesley, 25/09). */
            cabecalho && cabecalho.arquivada ? (
              <span className="cu-selo-morto">arquivada</span>
            ) : undefined
          }
          trilha={
            <Trilha
              degraus={
                cabecalho
                  ? trilhaDaPasta({
                      spaceId: cabecalho.spaceId,
                      spaceName: cabecalho.spaceName,
                      folderId: cabecalho.folderId,
                      folderName: cabecalho.folderName,
                    })
                  : trilhaEmEspera('Pasta')
              }
              aoRevelar={pedirRevelar}
              expandida={trilhaAberta}
              aoExpandir={() => setTrilhaAberta(true)}
            />
          }
        />

        {/* F04: os avisos moram NA COLUNA, abaixo do título — e não acima da
            grade em largura inteira, empurrando a barra para baixo. */}
        {naLista && pastaId && (
          /* A LISTA DA PASTA — F18C. As tarefas das listas vivas desta pasta,
             pela consulta paginada da F18A (escopo `pasta`). */
          <TrabalhoDoEscopo escopo="pasta" id={pastaId} modo="lista" nomeDoEscopo="nesta pasta" />
        )}

        {!naLista && erro && (
          <div className="mb-3">
            <Aviso tipo="erro" acao={!carregando && pastaId ? {
              rotulo: 'Tentar de novo',
              aoClicar: () => { void lerQuadro(pastaId); },
            } : undefined}>{erro}</Aviso>
          </div>
        )}

        {treeError && (
          <div className="mb-3">
            <Aviso tipo="erro" acao={{ rotulo: 'Tentar de novo', aoClicar: () => { void lerArvore(); } }}>
              {treeError}
            </Aviso>
          </div>
        )}

        {avisoDaArvore && (
          <div className="mb-3">
            <Aviso tipo="erro">{avisoDaArvore}</Aviso>
          </div>
        )}

        {!naLista && carregando && quadro === null && !erro && (
          <p className="eyebrow">Carregando o quadro da pasta…</p>
        )}

        {!naLista && quadro && (
          <>
            <FiltrosSoDaLista aoVerNaLista={() => escolherModo('lista')} />

            {/* AS FERRAMENTAS — F06A. O cartão do resumo saiu; o nome subiu
                para o título. Ficam a busca, o responsável e a frase de
                quanto há — com QUANTAS LISTAS entraram e quantas etapas
                saíram delas, que é o que explica a tela: quinze colunas para
                vinte e cinco esteiras só faz sentido se estiver dito que são
                vinte e cinco listas juntas. */}
            <div className="q-ferramentas">
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

              {interruptorUtil(paraRecolher) && (
                <InterruptorDeVazias
                  ligado={lugar.vazias}
                  vazias={quantasVazias(paraRecolher)}
                  aoAlternar={() => definirLugar((l) => ({ ...l, vazias: !l.vazias }))}
                />
              )}

              <div className="q-ferramentas-fim">
                <ContagemDoQuadro
                  total={resumo.total}
                  abertas={resumo.open}
                  feitas={resumo.done}
                  antes={
                    <span className="q-contagem-origem">
                      {quadro.header.lists} {quadro.header.lists === 1 ? 'lista' : 'listas'}
                      <span aria-hidden="true"> · </span>
                      {quadro.etapas.length} {quadro.etapas.length === 1 ? 'etapa' : 'etapas'}
                    </span>
                  }
                />
              </div>
            </div>

            {avisoDoMovimento && (
              <div className="mb-3">
                <Aviso tipo="erro">{avisoDoMovimento}</Aviso>
              </div>
            )}

            {quadro.header.lists === 0 && (
              <Aviso tipo="info">
                Esta pasta não tem lista viva ao seu alcance. Use o{' '}
                <b className="text-plat">···</b> dela na barra lateral para criar a primeira.
              </Aviso>
            )}

            {mostrarNavegacao(colunas.length, etapas.transborda) && (
              <NavegacaoDeEtapas
                etapas={colunas.map((c) => ({
                  chave: c.etapa.key,
                  nome: c.etapa.name,
                  cor: c.etapa.color,
                  achadas: c.matched,
                  total: c.total,
                  recolhida: etapas.recolhidas.has(c.etapa.key),
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
              <ProvedorDeMiniaturas ids={artesNaTela}>
                {colunas.map((c, i) => (
                  <Coluna
                    key={c.etapa.key}
                    coluna={c}
                    listasDaPasta={quadro.header.lists}
                    buscandoMais={buscandoMais}
                    aoMostrarMais={mostrarMais}
                    hoje={hoje}
                    alvo={alvo === c.etapa.key}
                    arrastando={arrastando}
                    salvando={salvando}
                    aoEntrar={() => setAlvo(c.etapa.key)}
                    aoSair={() => setAlvo((a) => (a === c.etapa.key ? null : a))}
                    aoSoltar={(taskId) => void moverEtapa(taskId, c.etapa)}
                    aoIniciarArrasto={setArrastando}
                    aoTerminarArrasto={() => {
                      setArrastando(null);
                      setAlvo(null);
                    }}
                    aoMoverPeloTeclado={moverPeloTeclado}
                    moverDoCartao={moverDoCartao}
                    concluirDoCartao={concluirDoCartao}
                    responsavelDoCartao={responsavelDoCartao}
                    recolhida={etapas.recolhidas.has(c.etapa.key)}
                    aoAbrir={() => etapas.abrir(c.etapa.key)}
                    aoRecolher={etapas.recolhiveis.has(c.etapa.key) ? () => etapas.fechar(c.etapa.key) : undefined}
                    idDoNome={`q-etapa-pasta-${i}`}
                  />
                ))}
              </ProvedorDeMiniaturas>
            </div>

            {orfas.length > 0 && (
              <div className="mt-3">
                <Aviso tipo="atencao">
                  {orfas.length} {orfas.length === 1 ? 'tarefa está' : 'tarefas estão'} com etapa
                  fora da esteira da lista delas e não{' '}
                  {orfas.length === 1 ? 'cabe' : 'cabem'} em coluna nenhuma:{' '}
                  {orfas.map((t) => `${textoDasMencoes(t.title)} (${t.listName})`).join(', ')}.
                </Aviso>
              </div>
            )}
          </>
        )}
      </TelaComBarra>
      {janelaDaMudanca}
    </PaginaLarga>
  );
}
