/**
 * `Minhas tarefas` — a tela `Meu trabalho`. Etapa F17.18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PRIMEIRA TELA DO PILAR B QUE SERVE À PESSOA, E NÃO AO GESTOR
 *
 *   O quadro (F17.9a) começa numa LISTA e pergunta "o que há nesta esteira".
 *   Essa é a pergunta de quem organiza.
 *
 *   Quem executa faz a pergunta ao contrário: "o que é meu, e para quando".
 *   Nenhuma tela respondia isso — e a pessoa com trabalho em quatro clientes
 *   precisava abrir quatro quadros para montar o dia dela na cabeça.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ESTA TELA NÃO DECIDE
 *   Quem alcança o quê. A política de linha de `tasks` recorta antes de a
 *   resposta sair do banco. Se aparecer um `filtro de alcance` aqui, é defeito.
 *
 *   E não decide o que é `Delegado`: isso é `abaDaLinha`, em
 *   `@/board/meu-trabalho`, que é pura e tem teste — e desde a F17.AUD05 o
 *   servidor filtra a aba pela MESMA tabela, antes do teto.
 *
 * O GRUPO VAZIO FICA — F17.20 CORTOU A EXPLICAÇÃO, NÃO O GRUPO
 *   Some-lo faria "não vi" e "não tem" virarem a mesma imagem, e num painel de
 *   atrasos essa confusão é cara. O que saiu foram as SETE caixas de texto que
 *   descreviam a própria tela: o subtítulo, a frase da aba, a faixa de vazio, o
 *   rodapé. O grupo continua, com a contagem ao lado do nome — que é o que diz
 *   "é zero", em vez de um parágrafo dizendo o mesmo.
 *
 *   F06C (revisão de 28/09, R07): o grupo vazio fica QUANDO HÁ TAREFA em
 *   outro. A aba inteira vazia não desenha quatro "Nada…" — desenha um estado
 *   só, com a saída para `Delegado`/`Pendente` e `Todas as tarefas`.
 *
 * TAMBÉM EM QUADRO — F17.79
 *   Pedido da equipe: *"a aba 'minhas tarefas' (…) colocar a opção de quadro,
 *   porque só tem em lista"*. A tela ganhou o MESMO seletor `Lista | Quadro` de
 *   `Todas as tarefas` (hoje `SeletorDeModo`, `Lista | Kanban`, F18C), na linha das abas, à
 *   direita de `Pendente | Feito | Delegado`. O quadro é o MESMO `QuadroPorTipo`
 *   — colunas por TIPO de status, cartão que se lê e se abre, sem arrasto; o
 *   porquê está no cabeçalho dele. A escolha vai para o endereço em `?ver=`,
 *   com `replace` (F17.24). E a aba continua filtrando: o quadro desenha o que
 *   `Pendente`, `Feito` ou `Delegado` deixa passar, igual à lista.
 *
 * PAGINADA — F17.AUD06 (achado 4 da auditoria de 09/09/2026)
 *   Antes, uma leitura só (teto 500) e a tela separava as abas: 500 concluídas
 *   antigas escondiam a pendente posterior, e a aba dizia `Pendente 0`. Agora a
 *   tela pede UMA aba de cada vez, em lotes de 100 com continuação, e as
 *   contagens das três abas vêm contadas no banco inteiro — quem faz as contas
 *   e acumula os lotes é `@/board/paginacao-na-tela`, que é pura e tem teste.
 *   Esta tela só desenha as fases dela:
 *
 *     · `Carregar mais` é UM, embaixo da lista e embaixo do quadro. O quadro é
 *       por tipo de status, mas a paginação é do CONJUNTO da aba: o botão traz
 *       o próximo lote e as colunas se refazem. Trocar `Lista | Quadro` não
 *       relê nada — é o mesmo conjunto, desenhado de outro jeito.
 *     · Trocar de aba zera e abre bilhete novo; a resposta da aba anterior que
 *       chegar depois é jogada fora.
 *     · O erro no meio fica embaixo, onde a pessoa clicou, com o que já foi
 *       lido intacto e um "Tentar de novo" que repete o mesmo pedido. O erro
 *       inicial fica em cima, sem desenhar grupo nenhum: "Nada para hoje."
 *       debaixo de um erro seria a confusão que o cabeçalho acima descreve.
 *     · Enquanto a primeira resposta não chega, as abas não têm número — zero
 *       é resposta, não ausência (mesma regra de `Todas as tarefas`).
 *
 *   O PROGRESSO VAI PARA A ENTRADA DE NAVEGAÇÃO, E NÃO PARA O ARMAZENAMENTO.
 *   Quem carregou três lotes, abriu uma tarefa e voltou precisa achar os três
 *   — senão `LembrarRolagem` (F17.24) não alcança a altura guardada e a pessoa
 *   volta ao topo. O progresso (`aba`, `paginas`) vai em `history.state` por
 *   `navigate(…, { replace, state })`: é DESTA entrada, então o VOLTAR e o F5
 *   o encontram, e chegar de novo pela barra lateral (outra entrada) começa
 *   barato, na primeira página. `sessionStorage` por caminho, como a rolagem
 *   usa, faria toda visita reler N páginas — e cada página custa uma varredura
 *   de contagens (AUD05). Ao voltar, as páginas são RELIDAS em sequência, não
 *   guardadas: a tarefa que a pessoa acabou de editar volta como ficou.
 *   ⚠️ `setSearchParams` (aba, forma) apaga o `state` da entrada; o efeito que
 *   grava o progresso percebe e regrava — ver `ESCREVE O PROGRESSO` abaixo.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Folder } from 'lucide-react';

import { today } from '@/board/board';
import { TelaComBarra } from '@/board/TelaComBarra';
import { usePreferencias } from '@/ui/aparencia';
import { GruposDeTrabalho } from '@/board/GruposDeTrabalho';
import { QuadroPorTipo } from '@/board/QuadroPorTipo';
import { SeletorDeModo } from '@/board/SeletorDeForma';
import { useModoDaTela } from '@/board/usar-modo';
import { TETO_DA_BUSCA } from '@/board/filtro';
import {
  ABAS,
  type Aba,
  ROTULO_DA_ABA,
  type WorkRow,
  contarPorAba,
  enderecoDaBuscaGeral,
  filtrarPorAba,
  filtrarPorTexto,
  listasDestasTarefas,
  vazioDaAba,
} from '@/board/meu-trabalho';
import {
  type EstadoDaPaginacao,
  type PaginaDoTrabalho,
  type Pedido,
  comProgresso,
  criarPaginacaoNaTela,
  estadoInicial,
  lerProgresso,
} from '@/board/paginacao-na-tela';
import { ApiError, api, recuperavelAoLer, semSessao } from '@/lib/api';
import { useEscolhaNoEndereco, useParametrosNoEndereco, useTextoNoEndereco } from '@/ui/endereco';
import { idDaAba } from '@/ui/abas';
import { Abas } from '@/ui/AlternadorDeVista';
import { useAnuncioModerado } from '@/ui/anuncio';
import { useAoFecharAFichaAoLado } from '@/ui/usar-ficha-ao-lado';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { Aviso, CampoDeBusca, PaginaLarga } from '@/ui/primitivos';
import { ROTULO_DO_ITEM } from '@/ui/preferencias';
import { podeVer, useSessao } from '@/ui/sessao';
import { Topo } from '@/ui/Topo';
import '@/ui/quadro.css';
// O cartão do quadro (F17.79) abre a ficha pelo título, e `.q-abre` mora em
// `tarefa.css` — o mesmo motivo de `TodasAsTarefas` importá-la.
import '@/ui/tarefa.css';
import '@/ui/clickup.css';
import '@/ui/passos.css';

/* ───────────────────────────── a leitura ───────────────────────────── */

/**
 * Uma página do servidor, na forma que a máquina entende — F17.AUD06.
 *
 * ⚠️ RESPOSTA SEM `aba` É DE UM SERVIDOR DE ANTES DA AUD05. A interface e o
 * Worker publicam juntos (AUD08), então isso não acontece em produção — mas
 * se acontecer, a tela não quebra: a rede grossa vira uma página única,
 * recortada aqui pela mesma regra de sempre. É o comportamento de antes, e não
 * uma tela em branco.
 */
async function lerPagina(pedido: Pedido): Promise<PaginaDoTrabalho> {
  const r = await api.meuTrabalho({ aba: pedido.aba, cursor: pedido.cursor });
  const w = r.work;
  const rows = w.rows as WorkRow[];
  if (w.aba === undefined || w.counts === undefined) {
    return {
      aba: pedido.aba,
      rows: filtrarPorAba(rows, pedido.aba),
      counts: contarPorAba(rows),
      hasMore: false,
      nextCursor: null,
    };
  }
  return {
    aba: w.aba,
    rows,
    counts: w.counts,
    hasMore: w.hasMore === true,
    nextCursor: w.nextCursor ?? null,
  };
}

const FRASE_DO_ERRO = 'Não foi possível carregar o seu trabalho.';

/* ───────────────────────────── a tela ───────────────────────────── */

export default function MeuTrabalho() {
  const [prefs] = usePreferencias();
  const { sessao } = useSessao();

  /**
   * A BUSCA MORA NO ENDEREÇO — F05 do plano UX (UX05).
   *
   * Antes era `useState('')`: um F5, o VOLTAR de uma tarefa ou a troca de aba
   * a apagavam. Agora vai em `?busca=`, como a de `Todas as tarefas`, com
   * `replace` quando a digitação assenta — nenhuma entrada de histórico por
   * letra. Ver `useTextoNoEndereco`.
   *
   * TROCAR DE SITUAÇÃO NÃO APAGA A BUSCA (decisão da especificação, §5): o
   * lote novo chega, a mesma busca é reaplicada e a linha de resultado diz o
   * alcance de novo. Quem busca "carrossel" em Pendente e passa para Feito
   * quer ver o carrossel feito — e não recomeçar a digitar.
   */
  const busca = useTextoNoEndereco('busca', { teto: TETO_DA_BUSCA });
  const [, definirParametros] = useParametrosNoEndereco();

  /**
   * A ABA MORA NO ENDEREÇO — F17.24.
   *
   * Antes ela era `useState(prefs.abaInicial)`, e um F5 em `Feito` voltava
   * para `Pendente`. Medido no Chrome, e é o defeito que o usuário descreveu:
   * *"recarregar rebobina a página ao começo"*.
   *
   * Foi para o ENDEREÇO, e não para o armazenamento do navegador, pela regra
   * da etapa: "qual aba" é uma coisa que outra pessoa, abrindo o mesmo
   * endereço, precisa ver igual. `/meu-trabalho?aba=feito` colado num
   * comentário abre em `Feito` para quem receber.
   *
   * Sem parâmetro, vale a aba que `Personalizar` → `Início` escolheu — o
   * comportamento de antes fica intacto para quem chega pela barra lateral.
   */
  const [aba] = useEscolhaNoEndereco<Aba>('aba', ABAS, prefs.abaInicial);
  // A forma também — F17.79, pela mesma regra: `/meu-trabalho?ver=quadro`
  // colado num comentário abre no quadro para quem receber.
  /* F18C: `Lista | Kanban` pela regra comum (`useModoDaTela`): endereço ›
     escolha desta tela › padrão Lista; `?ver=quadro` antigo abre no Kanban. */
  const [view, trocarForma] = useModoDaTela('pessoal', null, {
    explicito: true,
    escrever: (ver) => definirParametros(busca.comOTexto({ ver })),
  });
  /* ⚠️ AS DUAS SE GRAVAM COM A BUSCA JUNTO — F05. O `setSearchParams` parte
     dos parâmetros do último desenho: gravar a aba sozinha, no mesmo gesto em
     que a busca pendente é gravada (o foco sai da caixa no clique), apagaria
     a busca do endereço. Uma gravação só, com tudo. */
  const trocarAba = (a: Aba) => definirParametros(busca.comOTexto({ aba: a }));

  const location = useLocation();
  const navigate = useNavigate();

  // "Hoje" fixado uma vez por montagem — recalcular a cada render faria os
  // grupos trocarem de nome no meio de uma leitura que atravessa a meia-noite.
  const hoje = useRef(today()).current;

  /**
   * A MÁQUINA DE PAGINAÇÃO — F17.AUD06. Uma por montagem; o estado dela é
   * espelhado aqui por `aoMudar`, e é o espelho que a tela desenha.
   */
  const [estado, setEstado] = useState<EstadoDaPaginacao>(() => estadoInicial(aba));
  const [maquina] = useState(() =>
    criarPaginacaoNaTela({ ler: lerPagina, aba, aoMudar: setEstado }),
  );
  useEffect(() => () => maquina.encerrar(), [maquina]);

  /**
   * O estado da entrada de navegação, como está AGORA — lido na hora de abrir
   * a aba, e não no primeiro desenho. Assim, ir de `Pendente` (três lotes)
   * para `Feito` e voltar para `Pendente` não relê três lotes por engano: a
   * entrada já diz `feito, 1`, que é de outra aba, e é ignorado.
   */
  const entrada = useRef<unknown>(location.state);
  useEffect(() => {
    entrada.current = location.state;
  }, [location.state]);

  /**
   * ABRE A ABA — a cada troca, e uma vez na montagem. Bilhete novo: a
   * resposta da aba anterior que chegar depois é jogada fora. Trocar só a
   * FORMA não passa por aqui: é o mesmo conjunto, desenhado de outro jeito.
   */
  useEffect(() => {
    maquina.abrir(aba, lerProgresso(entrada.current, ABAS));
  }, [maquina, aba]);

  /**
   * O CARD AO LADO FECHOU — F43, Fase 7. A lista não desmontou (a ficha abriu
   * num painel por cima dela), então a volta da ficha não passa por `abrir`.
   * `reler` relê as mesmas páginas por fora e troca a lista de uma vez — sem
   * esvaziar, para a rolagem de quem estava no terceiro lote não ir ao topo.
   */
  useAoFecharAFichaAoLado(() => maquina.reler());

  /**
   * ESCREVE O PROGRESSO NA ENTRADA — ver o cabeçalho.
   *
   * Só quando o que está na tela difere do que a entrada diz, e só depois de
   * a restauração cobrir o alvo: no meio dela, gravar `1` por cima de `3`
   * jogaria fora o progresso que ela está justamente reconstruindo. Cada
   * gravação é um `replace` no mesmo endereço — não cria entrada, não relê
   * nada, e o `useBlocker` da moldura ignora destino com o mesmo caminho.
   * Converge: depois do `replace`, entrada e tela dizem o mesmo, e para.
   * Também é o que regrava depois de `setSearchParams` apagar o `state`.
   *
   * ⚠️ E só quando a aba da máquina é a do ENDEREÇO. Na troca de aba, este
   * efeito roda antes de a máquina zerar (o `state` acabou de ser apagado),
   * e sem esta linha gravaria o progresso da aba antiga na entrada da nova.
   */
  useEffect(() => {
    if (estado.aba !== aba) return;
    if (estado.paginas === 0 || estado.paginas < estado.alvo) return;
    /* ⚠️ O ENDEREÇO JÁ ANDOU — verificação da F03. O React Router 7 troca o
       endereço num `startTransition`: `location` aqui é o do DESENHO, que pode
       estar atrás do da barra (Quadro e, antes de desenhar, Lista). Regravar
       `location.search` devolvia `?ver=quadro` por cima do `?ver=lista` que a
       pessoa acabou de escolher (e2e `paginacao` 8). Espera o desenho alcançar
       — o efeito roda de novo com o `location` novo. */
    if (window.location.pathname !== location.pathname || window.location.search !== location.search) return;
    const guardado = lerProgresso(location.state, ABAS);
    if (guardado !== null && guardado.aba === estado.aba && guardado.paginas === estado.paginas) return;
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: comProgresso({ aba: estado.aba, paginas: estado.paginas }) },
    );
  }, [aba, estado.aba, estado.paginas, estado.alvo, location, navigate]);

  /**
   * O erro, traduzido — F17.AUD04, achado 5.
   *
   * Sessão vencida com a renovação fora do ar mandava esta tela para o login.
   * Agora ela fica, e o aviso ganha "Tentar de novo", que repete o mesmo
   * pedido com a aba e a forma que já estão no endereço — nada se perde.
   * Sessão realmente inválida continua indo para a entrada.
   */
  const erro = useMemo(() => {
    if (estado.erro === null) return null;
    const e = estado.erro;
    return {
      mensagem: e instanceof ApiError ? e.message : FRASE_DO_ERRO,
      /* F04 (verificação): o 500 do servidor também se tenta de novo — é uma
         leitura, sem efeito colateral, e antes a tela parava na frase sem
         saída. Recusa (4xx: conta desativada, sem acesso) continua sem botão. */
      recuperavel: recuperavelAoLer(e),
    };
  }, [estado.erro]);
  useEffect(() => {
    if (estado.erro !== null && semSessao(estado.erro)) window.location.replace('/');
  }, [estado.erro]);

  const { fase, linhas, counts } = estado;
  // Sem acento e sem caixa — `filtrarPorTexto`, puro e testado.
  const linhasVisiveis = useMemo(() => filtrarPorTexto(linhas, busca.texto), [linhas, busca.texto]);
  /* `Listas destas tarefas` — F05. Saem das linhas À VISTA (com a busca, as
     das achadas), por id; ver `listasDestasTarefas`. */
  const listas = useMemo(() => listasDestasTarefas(linhasVisiveis), [linhasVisiveis]);
  const total = counts === null ? null : counts[aba];
  /** Há linhas para desenhar — inclusive o vazio confirmado, que desenha os grupos vazios. */
  const desenha =
    fase === 'pronto' ||
    fase === 'carregando-mais' ||
    fase === 'fim' ||
    fase === 'vazio' ||
    fase === 'erro-ao-carregar-mais';
  /** A faixa de `Carregar mais` — some quando o conjunto acabou. */
  const temMais = fase === 'pronto' || fase === 'carregando-mais' || fase === 'erro-ao-carregar-mais';

  const tentarDeNovo = { rotulo: 'Tentar de novo', aoClicar: () => maquina.tentarDeNovo() };
  /**
   * No erro INICIAL o botão aparece na falha passageira (AUD04: rede,
   * renovação fora do ar) e, desde a F04, também no erro do servidor (5xx);
   * não aparece numa recusa (4xx), que outra tentativa não muda. No erro AO CARREGAR MAIS ele aparece SEMPRE: é uma leitura, que
   * se repete sem efeito colateral, e a pessoa está no meio de uma lista que
   * já leu — mandá-la recarregar a página para pedir o lote de novo seria
   * cobrar por um pedido que ela já fez.
   */
  const acaoInicial = erro?.recuperavel ? tentarDeNovo : undefined;

  /* A BUSCA, DITA — F03. O número aparece na hora para o olho; para o leitor
     de tela ele só é dito quando a digitação assenta (`useAnuncioModerado`),
     e não a cada letra. */
  const buscando = busca.texto.trim() !== '';
  /* O ALCANCE, DITO — F05. O número achado é do LOTE, e o total da aba é do
     banco; a frase dá os dois, com nome, para um não passar pelo outro:
     "3 de 100 carregadas · 142 em Pendente". Sem mais lote, o lote É a aba. */
  const encontradas = `${linhasVisiveis.length} encontrada${linhasVisiveis.length === 1 ? '' : 's'}`;
  const resultadoDaBusca = !buscando || linhas.length === 0
    ? ''
    : temMais
      ? `${encontradas} nas ${linhas.length} carregadas, de ${total ?? '…'} em ${ROTULO_DA_ABA[aba]}.`
      : `${encontradas} nas ${linhas.length} de ${ROTULO_DA_ABA[aba]}.`;
  const resultadoAnunciado = useAnuncioModerado(resultadoDaBusca);
  /** Há tarefas carregadas, e o texto não achou nenhuma — não é "vazio". */
  const buscaSemResultado = desenha && buscando && linhas.length > 0 && linhasVisiveis.length === 0;
  /**
   * A PASSAGEM PARA A BUSCA GERAL — F05. Só para quem alcança `Todas as
   * tarefas` (a mesma área que a barra consulta). O texto vai no `?busca=` que
   * ela já lê, e o `state` avisa lá que o alcance mudou.
   */
  /**
   * A ABA SEM NADA — F06C (revisão de 28/09, R07). Confirmada pelo servidor e
   * sem lote a mais: um estado só, com as saídas, no lugar dos quatro grupos
   * "Nada…". Com uma tarefa que seja, o agrupamento volta.
   */
  const abaVazia = desenha && linhas.length === 0 && !temMais;
  const vazio = abaVazia ? vazioDaAba(aba, counts, podeVer(sessao, 'quadro')) : null;
  const buscaGeral = buscando && podeVer(sessao, 'quadro') ? enderecoDaBuscaGeral(busca.texto, TETO_DA_BUSCA) : null;
  const irParaBuscaGeral = buscaGeral !== null && (
    <Link to={buscaGeral} state={{ alcanceDe: 'minhas' }} className="iw-passagem" onPointerDown={busca.gravarJa}>
      Buscar em {ROTULO_DO_ITEM.todas}
      <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
    </Link>
  );

  return (
    <PaginaLarga>
      {/* A MOLDURA COMUM — F04. Esta tela montava a grade à mão (a barra, a
          composição medida da F02, a coluna); agora é a mesma peça das outras
          dezessete, e a regra de largura que mudar lá vale aqui. A classe
          `iw-trabalho` vai na própria coluna de conteúdo. */}
      <TelaComBarra atual="minhas" classeDoConteudo="iw-trabalho">
        {/* O TOPO — F29 (Fase 4). Tela principal: só o título, e ele é o
            nome do item da barra (`Minhas tarefas`), e não mais `ide Meu
            trabalho` num cabeçalho acima da grade.

            ⚠️ A TRILHA SAIU DAQUI, e é decisão. Ela era `Meu trabalho ›
            Minhas tarefas` (F17.25): o primeiro degrau não clicava (seção
            não é lugar) e o segundo era onde já se estava — nenhum dos dois
            levava a lugar nenhum. Com o título dizendo o nome da tela, a
            trilha só repetia. As telas principais são irmãs, e o caminho
            entre elas é a barra. */}
        <Topo titulo={ROTULO_DO_ITEM.minhas} />

        {/* O erro INICIAL fica em cima da coluna — não há lista debaixo dele.
            F04: DENTRO da coluna de conteúdo, logo abaixo do título, e não
            mais acima da grade em largura inteira: a barra continua no alto,
            utilizável, e a mensagem fica ao lado de quem ela explica. */}
        {erro !== null && fase === 'erro-inicial' && (
          <div className="mb-3">
            <Aviso tipo="erro" acao={acaoInicial}>
              {erro.mensagem}
            </Aviso>
          </div>
        )}

        {/* OS CONTROLES, NUMA FAIXA SÓ — F05 do plano UX.
            A introdução ("Seu espaço de trabalho / O que vamos entregar
            hoje?") saiu: ela prometia HOJE acima de grupos que incluem
            Próximo e Não programado, e empurrava a primeira tarefa para
            ~51% da altura no celular. O título já diz onde se está.

            Ordem (é a do teclado também): QUAL conjunto (situação, abas de
            verdade, com painel) → buscar NELE → COMO ver (botões
            pressionáveis). No computador os três cabem numa linha; no
            celular a situação ocupa a primeira e a busca divide a segunda com
            o par de ícones da forma. Mesma ordem de `Todas as tarefas`:
            busca no meio, forma na ponta.

            `onBlur` grava a busca pendente quando o foco sai da caixa — é o
            que acontece no `mousedown` de uma tarefa, antes de o clique
            navegar; o VOLTAR a encontra. Ver `useTextoNoEndereco`. */}
        <div className="mt-controles" onBlur={busca.gravarJa}>
          <Abas
            rotulo="Situação das tarefas"
            base="mt-situacao"
            idDoPainel="mt-painel"
            className="cu-abas mt-situacao"
            classeDaAba="cu-aba"
            valor={aba}
            aoEscolher={trocarAba}
            opcoes={ABAS.map((a) => ({
              valor: a,
              rotulo: ROTULO_DA_ABA[a],
              /* O NÚMERO É O DO BANCO INTEIRO — F17.AUD06 —, e não o das
                 linhas que chegaram. E enquanto não chegou, não há número:
                 zero é resposta, não ausência. */
              contagem: counts !== null ? counts[a] : undefined,
            }))}
          />

          <CampoDeBusca
            className="mt-busca"
            rotulo="Buscar nas tarefas carregadas"
            /* O nome inteiro é o rótulo (leitor de tela); o texto de dentro
               encurta para caber ao lado da forma no celular sem cortar. */
            exemplo="Buscar nas carregadas…"
            valor={busca.texto}
            aoMudar={busca.definir}
          />

          <SeletorDeModo contexto="pessoal" valor={view} aoEscolher={trocarForma} />
        </div>

        <div role="tabpanel" id="mt-painel" aria-labelledby={idDaAba('mt-situacao', aba)}>
          {fase === 'carregando' && <EstadoDaPagina tipo="carregando" />}

          {/* A aba já veio recortada do servidor; a forma só muda o desenho.
              A aba TODA vazia vira um estado só (F06C); com alguma tarefa, os
              grupos vazios continuam — ver `O GRUPO VAZIO FICA` no cabeçalho. */}
          {desenha && resultadoDaBusca !== '' && !buscaSemResultado && (
            <div className="iw-resultado">
              <p aria-hidden="true">
                {resultadoDaBusca}
                {temMais && <span className="iw-resultado-dica"> Carregue mais para ampliar a busca.</span>}
              </p>
              <span className="sr-only" role="status">{resultadoAnunciado}</span>
              {irParaBuscaGeral}
            </div>
          )}
          {/* F03: a busca que não acha nada NÃO é "você não tem tarefas" —
              é "nada com esse texto nas que chegaram", com a saída ao lado. */}
          {buscaSemResultado ? (
            <EstadoDaPagina
              tipo="sem-resultado"
              titulo="Nenhuma correspondência nas tarefas carregadas"
              acao={{ rotulo: 'Limpar busca', aoClicar: () => busca.definir('') }}
            >
              {temMais
                ? `A busca olhou as ${linhas.length} carregadas, de ${total ?? '…'} em ${ROTULO_DA_ABA[aba]}. Carregue mais ou tente outro termo.`
                : `A busca olhou as ${linhas.length} de ${ROTULO_DA_ABA[aba]}. Tente outro termo.`}
              {/* A saída para o alcance maior — e dizendo que é MAIOR: lá a
                  busca é pelo nome, em todas as tarefas que a pessoa vê. */}
              {irParaBuscaGeral && (
                <span className="iw-passagem-linha">
                  {irParaBuscaGeral}
                  <span className="iw-passagem-alcance"> — pelo nome, em todas as tarefas ao seu alcance, não só nas suas.</span>
                </span>
              )}
            </EstadoDaPagina>
          ) : vazio !== null ? (
            <EstadoDaPagina
              tipo="vazio"
              titulo={vazio.titulo}
              acao={vazio.saidas.map((a) =>
                a.tipo === 'aba'
                  ? { rotulo: a.rotulo, aoClicar: () => trocarAba(a.aba) }
                  : { rotulo: a.rotulo, para: '/tarefas' },
              )}
            >
              {vazio.frase}
            </EstadoDaPagina>
          ) : (
            <>
              {desenha && view === 'lista' && <GruposDeTrabalho linhas={linhasVisiveis} hoje={hoje} semVazios={buscando && linhas.length > 0} />}
              {desenha && view === 'kanban' && <QuadroPorTipo linhas={linhasVisiveis} hoje={hoje} filtrada={buscando} porEtapa={{ base: linhas }} />}
            </>
          )}

          {/* O CORTE, DITO — F17.AUD06. Um só, para as duas formas: `87 de
              312` e `Carregar mais`. Some quando o conjunto acabou. É a mesma
              linha que a coluna cortada do quadro da lista desenha (F17.50),
              pelo mesmo motivo: o número no topo e a lista à vista precisam
              bater, ou a diferença vira mistério. `aria-live` porque o número
              muda sem a página recarregar. O botão fica AO LADO do número
              (`.mt-corte .q-coluna-mais`), longe do canto do botão de tema. */}
          {temMais && (
            <div className="mt-corte">
              <span className="tnum" aria-live="polite">
                {linhas.length} de {total ?? '…'}
              </span>
              {fase !== 'erro-ao-carregar-mais' && (
                <button
                  type="button"
                  className="q-coluna-mais"
                  onClick={() => maquina.carregarMais()}
                  disabled={fase === 'carregando-mais'}
                >
                  {fase === 'carregando-mais' ? 'Buscando…' : 'Carregar mais'}
                </button>
              )}
            </div>
          )}

          {/* O erro NO MEIO fica embaixo, onde a pessoa clicou — e o que já foi
              lido continua em cima, intacto. "Tentar de novo" repete o MESMO
              pedido: mesma aba, mesmo cursor.

              ⚠️ `pb-10`, como a última seção de `Cliente` e `Painel`. O botão
              do `Aviso` fica à direita, e este é o último elemento da página:
              sem a folga ele encosta no canto inferior direito. A folga nasceu
              por causa do botão fixo de tema que morava lá e cobria o
              `Tentar de novo`; ele saiu em 2026-09-11, e a folga ficou. */}
          {erro !== null && fase === 'erro-ao-carregar-mais' && (
            <div className="mt-3 pb-10">
              <Aviso tipo="erro" acao={tentarDeNovo}>
                {erro.mensagem}
              </Aviso>
            </div>
          )}
        </div>
        {/* `LISTAS DESTAS TAREFAS` — F05 (era `Suas listas`, UX06). O nome
            diz a origem: as listas das linhas à vista, as mais cheias antes,
            e não um histórico de acesso. Vínculo pelo id; nome repetido
            ganha o lugar ao lado. */}
        {desenha && listas.length > 0 && (
          <nav className="iw-listas" aria-labelledby="mt-listas-titulo">
            <h2 id="mt-listas-titulo">Listas destas tarefas</h2>
            <div>{listas.map((l) => (
              <Link key={l.id} to={`/quadro/${l.id}`}>
                <Folder size={15} aria-hidden="true" />
                <span className="iw-listas-nome">{l.nome}</span>
                {l.lugar !== null && <span className="iw-listas-lugar">{l.lugar}</span>}
                <span className="iw-listas-conta tnum" aria-label={`${l.tarefas} ${l.tarefas === 1 ? 'tarefa' : 'tarefas'}`}>{l.tarefas}</span>
              </Link>
            ))}</div>
          </nav>
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}
