/**
 * A tela do cliente — etapas F4.2 e F4.6.
 *
 * O MEDIDOR É DO MÊS; A LISTA É DO PERÍODO
 *   Arrastar o período **não** muda o percentual. Se mudasse, encolher a janela
 *   pareceria queda de entrega, e a pessoa acharia que perdeu produção quando só
 *   mudou o que está olhando.
 *
 *   O contrato é mensal — é assim que a agência vende. A visão é livre.
 *
 * AS SEIS ABAS DO SISTEMA IDE ESTÃO TODAS AQUI — E UMA SÉTIMA QUE ELE NÃO TEM
 *   Conteúdos, Checklist, Semanal, Captação, Mural e Histórico. A última entrou
 *   na F4.10; até então as que faltavam apareciam desligadas com o nome da etapa
 *   que as traria — aba ausente faz a pessoa procurar e concluir que o sistema é
 *   menor do que é.
 *
 *   `Calendário` é a sétima, da F17.40. No legado o mês de um cliente só existe
 *   dentro do calendário geral, de todos juntos — quem quer o de um cliente
 *   procura. A aba desenha o mês DELE, na mesma grade da tela geral.
 *
 * A OPERAÇÃO PERTO DO TOPO, O CADASTRO A UM CLIQUE — F11B do plano UX
 *   Topo (nome, editar, vizinhos) → resumo do mês (entrega, competência,
 *   estágio, urgência, financeiro) → "Dados do cliente" recolhido → as sete
 *   áreas → a área. Área, competência e período moram no endereço
 *   (`@/clients/contexto`), e a resposta atrasada não pinta outro contexto
 *   (`@/ui/vez`).
 *
 * DUAS PERMISSÕES NO MESMO CABEÇALHO
 *   Urgência e Financeiro OK: quem enxerga o cliente muda. Ativo: só
 *   administrador. A recusa vem do banco com a frase certa — a tela não tenta
 *   adivinhar quem pode o quê, porque essa cópia da regra ficaria para trás.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { TelaComBarra } from '@/board/TelaComBarra';
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDeDetalhe } from '@/board/trilha';
import { Ajuda } from '@/board/menus';
import { FichaDeCliente } from '@/clients/FichaDeCliente';
import { CalendarioDoCliente } from '@/clients/CalendarioDoCliente';
import { Captacao } from '@/clients/Captacao';
import { Checklist } from '@/clients/Checklist';
import { type ColunaDeEstado, QuadroDeEstados } from '@/clients/QuadroDeEstados';
import { SeletorDeModo } from '@/board/SeletorDeForma';
import { useModoDaTela } from '@/board/usar-modo';
import { ContasDaMeta } from '@/clients/ContasDaMeta';
import { AprovacaoExterna } from '@/clients/AprovacaoExterna';
import { type ContaDaMeta, resumoDaMeta } from '@/clients/contas-vazias';
import {
  AREAS,
  type Contexto,
  ROTULO_DA_AREA,
  chaveDaLeitura,
  contextoParaEndereco,
  enderecoDoCliente,
  lerContexto,
  observacoesLongas,
} from '@/clients/contexto';
import { Mural } from '@/clients/Mural';
import { nomesDosItens } from '@/clients/nome-do-item';
import { Historico } from '@/clients/Historico';
import { Semanal } from '@/clients/Semanal';
import { formatarDocumento, formatarTelefone } from '@/clients/formulario';
import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { RITUAL_LABEL, ritualStage } from '@/delivery/month-ritual';
import { diasAteRenovar } from '@/painel/carteira';
import { SO_ADMIN_ABRE, SO_ADMIN_MARCA } from '@/painel/painel-do-cliente';
import { destinoDoPainel } from '@/painel/recorte';
import { URGENCIA, URGENCIAS } from '@/painel/urgencia';
import { ApiError, api, semSessao } from '@/lib/api';
import { idDaAba } from '@/ui/abas';
import { Abas } from '@/ui/AlternadorDeVista';
import { useParametrosNoEndereco } from '@/ui/endereco';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { entregar, useVez } from '@/ui/vez';
import {
  IconeAds,
  IconeArte,
  IconeCalendario,
  IconeChevron,
  IconeDireita,
  IconeEsquerda,
  IconeFoto,
  IconeLapis,
  IconeVideo,
} from '@/ui/Icones';
// O fim do intervalo é EXCLUSIVO na API; o seletor mostra inclusivo. A conta
// era feita aqui com `new Date(...).toISOString().slice(0, 10)` e virou a mesma
// aritmética de dia que a grade do mês usa — F17.40.
import { diaDoInstante, hojeNaAgencia, somarUmDia } from '@/ui/grade-do-mes';
import { Aviso, Barra, Chave, Etiqueta, Medidor, PaginaLarga, Selo } from '@/ui/primitivos';
import { type Periodo, SeletorDePeriodo } from '@/ui/SeletorDePeriodo';
import { ROTULO_DO_ITEM } from '@/ui/preferencias';
import { ehAdmin, useSessao } from '@/ui/sessao';
import { Topo } from '@/ui/Topo';
/*
 * ⚠️ A BARRA SEM ESTA FOLHA APARECE — E DEITA. Medido na F17.62.
 *
 * `.q-tela` (a grade de duas colunas) e `.q-barra` moram em `quadro.css`, que
 * NÃO é global: cada tela do quadro a importa. `clickup.css` chegava aqui de
 * carona pelo `Ajuda` de `@/board/menus`, então a barra vinha desenhada — mas
 * sem a grade ela virava uma faixa de 1.366px de largura com o conteúdo
 * EMPURRADO 892px para baixo. As duas folhas andam juntas nas outras quatro
 * telas que desenham a barra, e aqui também.
 */
import '@/ui/quadro.css';
import '@/ui/clickup.css';

/* ─────────────────────────── formas ─────────────────────────── */

type Delivery =
  | { measurable: false; reason: string; message: string }
  | {
      measurable: true;
      level: number;
      base: number;
      bonus: number;
      breakdown: Array<{
        contentType: string;
        contracted: number;
        delivered: number;
        extras: number;
      }>;
    };

type Item = {
  id: string;
  contentType: string;
  scheduledAt: string | null;
  completedAt: string | null;
  isExtra: boolean;
  title: string | null;
};

type Perfil = {
  taxId: string | null;
  companyEmail: string | null;
  plan: { id: string; name: string; colorBg: string; colorText: string; colorBorder: string } | null;
  startedOn: string;
  renewsOn: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerWhatsapp: string | null;
  notes: string | null;
  financeOk: boolean;
  inactiveAt: string | null;
  links: Array<{ id: string; title: string; url: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  quotas: Array<{ contentType: string; quantity: number }>;
};

type Detalhe = {
  id: string;
  name: string;
  categoryName: string;
  planName: string | null;
  urgency: 'paz' | 'alerta' | 'perigo';
  isActive: boolean;
  profile: Perfil;
  neighbors: { previous: string | null; next: string | null };
  month: string;
  monthOpened: boolean;
  planningDoneAt: string | null;
  clientApprovedAt: string | null;
  delivery: Delivery;
  scheduled: Item[];
  unscheduled: Item[];
  /** O mês inteiro, sem recorte de período — é o que a grade semanal lê. */
  monthItems: Item[];
};

/* ─────────────────────────── vocabulário ─────────────────────────── */

/* `cor` pinta barra e ícone; `texto` é a mesma cor quando vira LETRA — no
   claro ela desce um passo para passar de 4,5 (F11B, `--luz-*-texto`). A arte
   saiu do verde da marca na F43 Fase 5 e tem par próprio (`--tipo-arte*`). */
const TIPO = {
  video: { rotulo: 'Vídeo', plural: 'Vídeos', Icone: IconeVideo, cor: 'var(--luz-ia)', texto: 'var(--luz-ia-texto)' },
  arte: { rotulo: 'Arte', plural: 'Artes', Icone: IconeArte, cor: 'var(--tipo-arte)', texto: 'var(--tipo-arte-texto)' },
  foto: { rotulo: 'Foto', plural: 'Fotos', Icone: IconeFoto, cor: 'var(--luz-estudio)', texto: 'var(--luz-estudio-texto)' },
  ads: { rotulo: 'Ads', plural: 'ADS', Icone: IconeAds, cor: 'var(--luz-lives)', texto: 'var(--luz-lives-texto)' },
} as const satisfies Record<ContentType, unknown>;

const rotuloDoTipo = (t: string) => TIPO[t as ContentType]?.rotulo ?? t;

/* A urgência — rótulo e ícone — mora em `painel/urgencia.ts`, a mesma do
   Painel (F30): "Em dia / Atenção / Crítico" aqui e lá, pela mesma fonte. */

/**
 * Por que o medidor está em travessão — F17.57.
 *
 * A frase curta vem da API (`delivery.message`); o porquê inteiro fica no `?`.
 * A regra da F17.37 é essa: a tela em voz alta diz o ESTADO e o PRÓXIMO PASSO,
 * e o detalhe que se aprende uma vez não fica embaixo do medidor toda vez.
 */
const AJUDA_SEM_MEDIDA: Record<string, { sobre: string; texto: string }> = {
  no_contract: {
    sobre: 'por que não há medida',
    texto:
      'Abrir o mês congela o contrato: o que foi vendido naquele mês para de ' +
      'depender do plano de hoje. Enquanto ninguém abrir, o medidor mostra ' +
      'travessão e não zero — sem contrato, não há o que cobrar.',
  },
  no_content_contract: {
    sobre: 'por que este cliente não tem medida',
    texto:
      'Ele não compra conteúdo por mês — é job avulso, HUB ou interno. O zero ' +
      'aqui é o combinado, não trabalho em falta, e por isso o medidor fica em ' +
      'travessão em vez de 0%.',
  },
  empty_contract: {
    sobre: 'por que o mês congelou sem cota',
    texto:
      'O mês foi aberto quando a cota deste cliente ainda estava em zero, e mês ' +
      'congelado não se reescreve — mudá-lo agora mexeria no que já foi cobrado. ' +
      'O que a equipe lançar neste mês nasce extra, e a base do medidor volta no ' +
      'mês seguinte, aberto já com a cota do cadastro.',
  },
};

/* As sete áreas (Conteúdos, Calendário, Checklist, Semanal, Captação, Mural e
   Histórico) moram em `@/clients/contexto` desde a F11B, junto com o contrato
   do endereço. `Calendário` segue em segundo (F17.40): vizinho de Conteúdos é
   onde quem procura "o mês deste cliente" olha primeiro. */

const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const nomeDoMes = (mes: string) => {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${mes}-01T12:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

const deslocarMes = (mes: string, passos: number) => {
  const [ano, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, m - 1 + passos, 1)).toISOString().slice(0, 7);
};

/* ─────────────────────────── peças ─────────────────────────── */

function LinhaDaFicha({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="o-linha">
      <span className="k">{k}</span>
      <span className="v text-right">{children}</span>
    </div>
  );
}

/** "qua" — o dia da semana ajuda a achar o item no mês sem abrir o calendário. */
const diaDaSemana = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso.slice(0, 10)}T12:00:00Z`))
    .replace('.', '');

/**
 * Uma linha de Conteúdos — F11C (R47).
 *
 * A LINHA INTEIRA É O RÓTULO DA CAIXA: tocar no título marca, e o alvo deixa
 * de ser um quadradinho de 13 px. O nome acessível vem de `nomesDosItens` —
 * tipo, título e dia, com "(n de m)" quando ainda empata —, o mesmo que a
 * Semanal usa na pastilha do dia. "marcar Vídeo" repetido três vezes acabou.
 *
 * Colunas: caixa · dia · tipo · título · extra. O dia vem primeiro porque a
 * lista está na ordem do dia, e é por ele que se procura.
 */
function Linha({ item, nome, aoAlternar }: { item: Item; nome: string; aoAlternar: (i: Item) => void }) {
  return (
    <li>
      <CorpoDoConteudo item={item} nome={nome} aoAlternar={aoAlternar} />
    </li>
  );
}

/**
 * A caixa, o dia, o tipo e o título de um conteúdo — a linha da Lista e o
 * cartão do Kanban (F18C). No cartão estreito, a mesma disposição em duas
 * linhas do celular (`.cl-cartao .cl-conteudo`).
 */
function CorpoDoConteudo({ item, nome, aoAlternar }: { item: Item; nome: string; aoAlternar: (i: Item) => void }) {
  const feito = item.completedAt !== null;
  const { Icone, texto } = TIPO[item.contentType as ContentType] ?? TIPO.arte;
  const titulo = item.title?.trim() ?? '';

  return (
    <label className="cl-conteudo" data-feito={feito || undefined}>
      <input
        type="checkbox"
        className="cl-marca"
        checked={feito}
        onChange={() => aoAlternar(item)}
        aria-label={nome}
      />
      {item.scheduledAt ? (
        <span className="cl-dia">
          {dia(diaDoInstante(item.scheduledAt))}
          <small>{diaDaSemana(diaDoInstante(item.scheduledAt))}</small>
        </span>
      ) : (
        <span className="cl-dia" data-sem>
          sem data
        </span>
      )}
      <span className="cl-conteudo-tipo" style={{ color: texto }}>
        <Icone className="h-3.5 w-3.5 shrink-0" />
        {rotuloDoTipo(item.contentType)}
      </span>
      <span className="cl-conteudo-titulo" data-sem={titulo === '' || undefined}>
        {titulo === '' ? 'sem título' : titulo}
      </span>
      <span className="cl-conteudo-fim">
        {item.isExtra && <Selo tom="ok">extra</Selo>}
      </span>
    </label>
  );
}

/**
 * O KANBAN DE CONTEÚDOS — F18C (R09). Duas colunas, os dois estados que o item
 * tem: `A entregar` (os agendados na ordem do dia, depois os sem data) e
 * `Entregues`. Mudar de coluna é marcar/desmarcar — a MESMA escrita da caixa
 * (`alternarConclusao`), com o mesmo efeito na cota. Nada vira tarefa.
 */
function KanbanDeConteudos({
  agendados,
  semData,
  nomes,
  aoAlternar,
}: {
  agendados: Item[];
  semData: Item[];
  nomes: Map<string, string>;
  aoAlternar: (i: Item) => Promise<string | null>;
}) {
  const todos = [...agendados, ...semData];
  /* ENTREGA É DADO DE NEGÓCIO (cota, nível). Um arrasto sem querer é mais
     provável que um clique sem querer na caixa: depois de mover, a frase diz o
     que mudou e oferece "Desfazer" — o mesmo gesto de volta, pela mesma
     escrita. Se o servidor recusar, a releitura devolve o cartão e a frase diz
     por quê, aqui, ao lado do quadro (o aviso do topo pode estar fora da tela). */
  const [aviso, setAviso] = useState<
    { tipo: 'movido'; id: string; entregue: boolean; texto: string } | { tipo: 'recusa'; texto: string } | null
  >(null);
  const [esperando, setEsperando] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (aviso?.tipo !== 'movido') return;
    const t = window.setTimeout(() => setAviso(null), 10_000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  async function mover(item: Item, desfazendo: boolean) {
    if (esperando.has(item.id)) return;
    setEsperando((s) => new Set(s).add(item.id));
    const nome = nomes.get(item.id) ?? 'conteúdo';
    const entregando = item.completedAt === null;
    const recusa = await aoAlternar(item);
    setEsperando((s) => {
      const proximo = new Set(s);
      proximo.delete(item.id);
      return proximo;
    });
    if (recusa !== null) {
      setAviso({ tipo: 'recusa', texto: `${recusa} O cartão voltou para onde estava.` });
    } else if (desfazendo) {
      setAviso(null);
    } else {
      setAviso({
        tipo: 'movido',
        id: item.id,
        entregue: entregando,
        texto: `“${nome}” ${entregando ? 'marcado como entregue' : 'voltou para A entregar'}.`,
      });
    }
  }
  const colunas: ColunaDeEstado<Item>[] = [
    {
      chave: 'a-entregar',
      nome: 'A entregar',
      cor: 'var(--hair-3)',
      itens: todos.filter((i) => i.completedAt === null),
      aceita: true,
      vazia: 'Nada a entregar neste período.',
    },
    {
      chave: 'entregues',
      nome: 'Entregues',
      cor: 'var(--luz)',
      itens: todos.filter((i) => i.completedAt !== null),
      aceita: true,
      vazia: 'Nada entregue ainda.',
    },
  ];
  const quadro = (
    <QuadroDeEstados
      rotulo="Conteúdos por entrega"
      colunas={colunas}
      idDoItem={(i) => i.id}
      nomeDoItem={(i) => nomes.get(i.id) ?? i.id}
      ocupados={esperando}
      aoMover={(i) => void mover(i, false)}
      desenhar={(i) => <CorpoDoConteudo item={i} nome={nomes.get(i.id) ?? i.id} aoAlternar={aoAlternar} />}
    />
  );
  /* Desfazer é a escrita CONTRÁRIA à que foi feita — não "alternar de novo"
     sobre o que a tela mostra agora: se outra pessoa já mexeu, desfazer não
     pode virar uma segunda entrega. */
  const atual = aviso?.tipo === 'movido' ? todos.find((i) => i.id === aviso.id) : undefined;
  const desfeito =
    aviso?.tipo === 'movido' && atual
      ? { ...atual, completedAt: aviso.entregue ? (atual.completedAt ?? 'agora') : null }
      : undefined;
  return (
    <>
      <div className="cl-kanban-aviso">
        {aviso?.tipo === 'recusa' && <Aviso tipo="erro">{aviso.texto}</Aviso>}
        {aviso?.tipo === 'movido' && (
          <Aviso
            tipo="info"
            acao={desfeito ? { rotulo: 'Desfazer', aoClicar: () => void mover(desfeito, true) } : undefined}
          >
            {aviso.texto}
          </Aviso>
        )}
      </div>
      {quadro}
    </>
  );
}

/* ─────────────────────────── a tela ─────────────────────────── */

/** O lugar acima da ficha, na trilha — F29 (Fase 5a). Ver o topo da tela. */
const PAINEL = { nome: ROTULO_DO_ITEM.painel, destino: '/painel' };

/** Onde a abertura de "Dados do cliente" fica lembrada — conveniência de quem vê. */
const CHAVE_DOS_DADOS = 'ideworks:cliente-dados-aberto';

function lerDadosAbertos(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DOS_DADOS) === '1';
  } catch {
    return false;
  }
}

function gravarDadosAbertos(aberto: boolean) {
  try {
    window.localStorage.setItem(CHAVE_DOS_DADOS, aberto ? '1' : '0');
  } catch {
    /* sem cofre: a escolha vale só até sair da tela */
  }
}

const BASE_DAS_AREAS = 'cl-areas';
const PAINEL_DA_AREA = 'cl-area';

export default function Cliente() {
  const { id = '' } = useParams();
  /* Conteúdos: Lista | Kanban (F18C). Preferência deste cliente, fora do
     endereço — a área já mora em `?area=`. */
  const [modoDosConteudos, escolherModoDosConteudos] = useModoDaTela('conteudos', id || null, { endereco: false });
  const navegar = useNavigate();
  // O degrau `Painel` volta ao recorte de onde se veio — F11A (`destinoDoPainel`).
  const { state: estadoDaEntrada } = useLocation();
  const painel = { ...PAINEL, destino: destinoDoPainel(estadoDaEntrada) };

  /*
   * ÁREA, COMPETÊNCIA E PERÍODO MORAM NO ENDEREÇO — F11B (`@/clients/contexto`).
   *
   * Gravar lê o endereço VIVO (`window.location`), não o do último desenho: o
   * React Router troca o endereço na hora e redesenha numa transição, e dois
   * gestos seguidos (trocar o mês e logo a área) fariam o segundo partir de
   * antes do primeiro — o que o Painel já aprendeu na F11A. E `manterEstado`
   * conserva o `state` da entrada, que é onde mora o recorte do Painel: sem
   * ele, trocar de área apagaria o caminho de volta.
   */
  const [parametros, definirParametros] = useParametrosNoEndereco();
  /* O dia de São Paulo: no último dia do mês, a partir das 21h, o dia UTC já é do mês
     seguinte e a ficha abria na competência errada. */
  const [hoje] = useState(() => hojeNaAgencia());
  const mesPadrao = hoje.slice(0, 7);
  const contexto = lerContexto(parametros, mesPadrao);
  const { area, mes } = contexto;
  const periodoDe = contexto.periodo?.de ?? null;
  const periodoAte = contexto.periodo?.ate ?? null;
  const periodo = useMemo<Periodo | null>(
    () => (periodoDe !== null && periodoAte !== null ? { de: periodoDe, ate: periodoAte } : null),
    [periodoDe, periodoAte],
  );

  const mudarContexto = useCallback(
    (mudanca: Partial<Contexto>) => {
      const vivo = lerContexto(new URLSearchParams(window.location.search), mesPadrao);
      definirParametros(contextoParaEndereco({ ...vivo, ...mudanca }, mesPadrao), { manterEstado: true });
    },
    [definirParametros, mesPadrao],
  );

  const [dados, setDados] = useState<Detalhe | null>(null);
  /** De que leitura (`chaveDaLeitura`) são os `dados` na tela. */
  const [chaveDosDados, setChaveDosDados] = useState<string | null>(null);
  /** A leitura falhou: sem ficha, é a tela de erro; com ficha, um aviso em cima. */
  const [erroDaLeitura, setErroDaLeitura] = useState<string | null>(null);
  /**
   * A recusa de um gesto (marcar, abrir o mês, mudar a urgência). Separada da
   * leitura DE PROPÓSITO — F11B: a releitura que vem depois de todo gesto
   * apagava o erro no mesmo instante (`setErro(null)` no começo de
   * `carregar`), e a frase do servidor nunca chegava à tela.
   */
  const [erroDoGesto, setErroDoGesto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [dadosAbertos, setDadosAbertos] = useState(lerDadosAbertos);
  const [observacoesInteiras, setObservacoesInteiras] = useState(false);
  const [contasDaMeta, setContasDaMeta] = useState<ContaDaMeta[] | null>(null);
  const botaoEditar = useRef<HTMLButtonElement>(null);

  const chaveAtual = chaveDaLeitura(id, { mes, periodo });

  /*
   * A RESPOSTA ATRASADA NÃO PINTA OUTRO CLIENTE NEM OUTRO MÊS — F11B.
   *
   * Trocar de cliente (anterior/próximo) ou de mês depressa dispara leituras
   * em sequência, e a rede não devolve na ordem. Sem a vez (`@/ui/vez`), a
   * resposta do cliente de antes chegava depois e pintava a ficha com o
   * endereço do cliente novo. Toda leitura pega um bilhete; só a última vale.
   */
  const vez = useVez();
  const carregar = useCallback(async () => {
    const chave = chaveDaLeitura(id, { mes, periodo });
    const bilhete = vez.abrir(chave);
    await entregar(
      vez,
      bilhete,
      api.cliente(id, `${mes}-01`, periodo?.de, periodo ? somarUmDia(periodo.ate) : undefined),
      {
        chegou: (r) => {
          setDados(r.client as Detalhe);
          setChaveDosDados(chave);
          setErroDaLeitura(null);
        },
        falhou: (e) => {
          if (semSessao(e)) {
            window.location.replace('/');
            return;
          }
          setErroDaLeitura(e instanceof ApiError ? e.message : 'Não foi possível carregar.');
        },
        terminou: () => setCarregando(false),
      },
    );
  }, [id, mes, periodo, vez]);

  /** A releitura depois de um gesto é sempre a do contexto de AGORA. */
  const carregarAtual = useRef(carregar);
  useEffect(() => {
    carregarAtual.current = carregar;
  }, [carregar]);
  const reler = useCallback(() => carregarAtual.current(), []);

  useEffect(() => {
    setCarregando(true);
    void carregar();
  }, [carregar]);

  // Outro cliente: a recusa do anterior não é deste.
  useEffect(() => {
    setErroDoGesto(null);
    setObservacoesInteiras(false);
  }, [id]);

  /** Devolve a frase da recusa, ou `null` se gravou — o Kanban avisa ao lado do cartão. */
  async function alternar(item: Item): Promise<string | null> {
    // Otimista: a marca aparece antes da resposta. Se falhar, a recarga desfaz
    // — melhor do que a caixa "grudar" enquanto a rede pensa.
    const virar = (i: Item) =>
      i.id === item.id ? { ...i, completedAt: i.completedAt ? null : 'agora' } : i;
    setDados((d) =>
      d === null ? d : { ...d, scheduled: d.scheduled.map(virar), unscheduled: d.unscheduled.map(virar) },
    );
    setErroDoGesto(null);
    let recusa: string | null = null;
    try {
      await api.alternarConclusao(item.id, item.completedAt === null);
    } catch (e) {
      recusa = e instanceof ApiError ? e.message : 'Não foi possível marcar.';
      setErroDoGesto(recusa);
    }
    await reler();
    return recusa;
  }

  /** Roda uma escrita e recarrega. A frase da recusa é sempre a do servidor. */
  const executar = useCallback(
    async (acao: () => Promise<unknown>) => {
      setErroDoGesto(null);
      try {
        await acao();
      } catch (e) {
        setErroDoGesto(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
      }
      await reler();
    },
    [reler],
  );

  /*
   * AS CHAVES DO MÊS SÃO DE ADMINISTRADOR — F43, Fase 3.
   *
   * A política do banco só deixa o administrador abrir o mês e marcar
   * planejamento e aprovação. Até a F43 o servidor respondia "ok" sem gravar
   * para os outros, e a chave parecia ligada sobre um mês que continuava
   * igual. O servidor agora recusa com frase (403); a ficha não espera a
   * recusa: para quem não administra, os botões vêm desligados e o porquê
   * fica escrito ao lado. Sem sessão lida ainda, nada muda — o administrador
   * vê a ficha exatamente como antes.
   */
  const { sessao } = useSessao();
  const semPermissaoNoMes = sessao !== null && !ehAdmin(sessao);

  const estagio = ritualStage({
    monthOpened: dados?.monthOpened ?? false,
    planningDoneAt: dados?.planningDoneAt ?? null,
    clientApprovedAt: dados?.clientApprovedAt ?? null,
  });

  /**
   * O contratado DAQUELE mês, por tipo — não a cota vigente do cliente.
   *
   * São coisas diferentes desde a F3.1: mudar a cota em setembro não pode
   * reescrever agosto. A grade semanal distribui o que foi contratado no mês
   * que está aberto, então lê o contrato, não a cota.
   */
  const contratadoNoMes = useMemo(() => {
    const mapa = Object.fromEntries(CONTENT_TYPES.map((t) => [t, 0])) as Record<
      ContentType,
      number
    >;
    if (dados?.delivery.measurable) {
      for (const b of dados.delivery.breakdown) {
        if (b.contentType in mapa) mapa[b.contentType as ContentType] = b.contracted;
      }
    }
    return mapa;
  }, [dados]);

  const cotaPorTipo = useMemo(() => {
    const mapa = new Map(dados?.profile.quotas.map((q) => [q.contentType, q.quantity]) ?? []);
    return (t: ContentType) => mapa.get(t) ?? 0;
  }, [dados]);

  /**
   * O cliente não compra conteúdo por mês — F17.57.
   *
   * Sai do CADASTRO, não do mês congelado: é justamente o que separa este caso
   * do `Hiper Center`, que contrata 12 e teve um mês congelar vazio. Os dois
   * mostravam a mesma fila de zeros, e a tela precisa dizer coisas diferentes.
   */
  const semContratoDeConteudo = useMemo(
    () => (dados?.profile.quotas ?? []).every((q) => q.quantity === 0),
    [dados],
  );

  /** O nome de cada item de Conteúdos — tipo, título e dia (R47). */
  const nomesDosConteudos = useMemo(
    () => nomesDosItens([...(dados?.scheduled ?? []), ...(dados?.unscheduled ?? [])]),
    [dados],
  );

  const alternarDados = () => {
    setDadosAbertos((a) => {
      gravarDadosAbertos(!a);
      return !a;
    });
  };

  /*
    ⚠️ CARREGANDO E ERRO TAMBÉM TÊM BARRA E TOPO — F29 (Fase 5a).

    Um cliente que não existe ou que a pessoa não alcança não pode virar uma
    tela SEM SAÍDA: os dois estados ganham o topo da ficha — `Painel ›
    Cliente`, com o degrau `Painel` de volta — e a barra.

    F11B: a ficha de OUTRO cliente também é "carregando". Com o anterior/
    próximo a tela não desmonta, e o cliente de antes ficaria à vista com o
    endereço do novo até a resposta chegar.
  */
  const outroCliente = dados !== null && dados.id !== id;
  if (dados === null || outroCliente) {
    const falhou = erroDaLeitura !== null && !carregando;
    return (
      <PaginaLarga>
        <TelaComBarra>
          <Topo titulo="Cliente" trilha={<Trilha degraus={trilhaDeDetalhe(painel, 'Cliente')} />} />
          {falhou ? (
            /* "TENTAR DE NOVO" TAMBÉM AQUI — conferência de 09/10/2026. Sem
               ficha na tela, a falha da primeira leitura (ou a do cliente para
               onde se acabou de ir) deixava só o aviso: a saída era recarregar
               a página. O botão relê com o endereço de agora, como o do aviso
               da ficha já aberta (abaixo). */
            <Aviso
              tipo="erro"
              acao={{
                rotulo: 'Tentar de novo',
                aoClicar: () => {
                  setCarregando(true);
                  void reler();
                },
              }}
            >
              {erroDaLeitura}
            </Aviso>
          ) : (
            <EstadoDaPagina tipo="carregando" titulo="Carregando o cliente…" />
          )}
        </TelaComBarra>
      </PaginaLarga>
    );
  }

  const p = dados.profile;
  const dias = diasAteRenovar(p.renewsOn);
  /** A ficha na tela ainda é de outra competência ou de outro período. */
  const atualizando = chaveDosDados !== chaveAtual;
  const resumoMeta = resumoDaMeta(contasDaMeta, dados.id);
  const contatoPrincipal = p.companyEmail ?? (p.whatsapp ? formatarTelefone(p.whatsapp) : null) ?? (p.phone ? formatarTelefone(p.phone) : null);
  const observacoesCompridas = observacoesLongas(p.notes);

  return (
    <PaginaLarga>
      {/* A barra lateral entra na ficha — F17.62. Mesma moldura das outras
          telas, por `TelaComBarra`; sem `atual` (F17.67): a ficha não é o
          Painel, e acender `Painel` aqui seria apontar o lugar errado. */}
      <TelaComBarra>
        {/* --- o topo — F29 (Fase 5a), enxugado na F11B ---------------------

            O topo diz QUEM é e oferece o que muda o cliente inteiro: editar o
            cadastro e passar ao vizinho. Urgência e financeiro desceram para o
            resumo, onde têm nome escrito (a 390 px eram três ícones soltos). */}
        <Topo
          className="cl-topo"
          titulo={dados.name}
          trilha={
            <div className="cl-trilha">
              <div className="min-w-0 flex-1">
                <Trilha degraus={trilhaDeDetalhe(painel, dados.name)} />
              </div>
              {/* O anterior e o próximo moram na linha da trilha: é "onde
                  estou na carteira", e no celular não gastam uma linha. Levam
                  área, competência, período e o recorte do Painel junto. */}
              <nav className="cl-vizinhos" aria-label="Outros clientes">
                <button
                  type="button"
                  className="o-btn o-btn-fantasma o-btn-icone"
                  title="Cliente anterior"
                  aria-label="Cliente anterior"
                  disabled={dados.neighbors.previous === null}
                  onClick={() =>
                    dados.neighbors.previous &&
                    navegar(enderecoDoCliente(dados.neighbors.previous, contexto, mesPadrao), {
                      state: estadoDaEntrada,
                    })
                  }
                >
                  <IconeEsquerda />
                </button>
                <button
                  type="button"
                  className="o-btn o-btn-fantasma o-btn-icone"
                  title="Próximo cliente"
                  aria-label="Próximo cliente"
                  disabled={dados.neighbors.next === null}
                  onClick={() =>
                    dados.neighbors.next &&
                    navegar(enderecoDoCliente(dados.neighbors.next, contexto, mesPadrao), {
                      state: estadoDaEntrada,
                    })
                  }
                >
                  <IconeDireita />
                </button>
              </nav>
            </div>
          }
          junto={
            // O dia do cancelamento é o de São Paulo (`diaDoInstante`), o mesmo
            // da regra do mês do cancelamento (conferência de 09/10): pelo dia
            // UTC, o cancelado às 22h do dia 31 aparecia "inativo desde" o dia
            // 1º do mês seguinte, e a regra ainda o contava no mês anterior.
            !dados.isActive ? (
              <Selo tom="warn" titulo="Fora da carteira ativa. Reative pelo interruptor Ativo, ao lado do Financeiro OK.">
                {p.inactiveAt ? `Inativo desde ${dataCurta(diaDoInstante(p.inactiveAt))}` : 'Inativo'}
              </Selo>
            ) : undefined
          }
          acoes={
            <>
              {/* URGÊNCIA NO CABEÇALHO, COM A PALAVRA — F11B (UX13).
                  Quem enxerga o cliente muda. No desktop, três botões com
                  ícone e nome; no celular, uma lista com o nome escrito — três
                  ícones soltos não diziam o estado. São o mesmo controle, e só
                  um aparece por largura. */}
              <div className="cl-urgencia" data-tom={URGENCIA[dados.urgency].tom}>
                <span className="cl-rotulo" id="cl-urgencia-rotulo">
                  Urgência
                </span>
                <div role="group" aria-labelledby="cl-urgencia-rotulo" className="iw-segmentos cl-urgencia-botoes">
                  {URGENCIAS.map((u) => {
                    const { rotulo, Icone, tom } = URGENCIA[u];
                    return (
                      <button
                        key={u}
                        type="button"
                        className="iw-segmento"
                        data-tom={tom}
                        aria-pressed={dados.urgency === u}
                        title={`Marcar como ${rotulo}`}
                        onClick={() =>
                          dados.urgency !== u && executar(() => api.chavesDoCliente(dados.id, { urgency: u }))
                        }
                      >
                        <Icone className="h-3.5 w-3.5" />
                        {rotulo}
                      </button>
                    );
                  })}
                </div>
                <select
                  className="o-campo o-select cl-urgencia-lista"
                  aria-labelledby="cl-urgencia-rotulo"
                  value={dados.urgency}
                  onChange={(e) =>
                    executar(() => api.chavesDoCliente(dados.id, { urgency: e.target.value as Detalhe['urgency'] }))
                  }
                >
                  {URGENCIAS.map((u) => (
                    <option key={u} value={u}>
                      {URGENCIA[u].rotulo}
                    </option>
                  ))}
                </select>
              </div>
              {/* No celular, "Dados do cliente" sobe para cá: a linha própria
                  dela custava a altura que separa as áreas do topo. */}
              <button
                type="button"
                className="o-btn o-btn-vidro o-btn-sm cl-dados-botao"
                aria-expanded={dadosAbertos}
                aria-controls="cl-dados-painel"
                onClick={alternarDados}
              >
                Dados
              </button>
              <button
                ref={botaoEditar}
                type="button"
                className="o-btn o-btn-vidro o-btn-sm cl-editar"
                aria-label="Editar cadastro"
                title="Editar cadastro"
                onClick={() => setEditando(true)}
              >
                <IconeLapis className="h-3.5 w-3.5" />
                <span className="cl-editar-texto">Editar cadastro</span>
              </button>
            </>
          }
        />

        {(erroDoGesto || erroDaLeitura) && (
          <div className="mb-3 grid gap-2">
            {erroDoGesto && <Aviso tipo="erro">{erroDoGesto}</Aviso>}
            {erroDaLeitura && (
              <Aviso tipo="erro" acao={{ rotulo: 'Tentar de novo', aoClicar: () => void reler() }}>
                {erroDaLeitura} A ficha abaixo é a da última leitura.
              </Aviso>
            )}
          </div>
        )}

        {/* --- o resumo operacional — F11B -------------------------------------

            Era um cartão de 20rem com o medidor de 150 px, o mês e o ritual,
            ao lado de quatro cartões de cadastro: a navegação das áreas ficava
            em y≈816 no desktop e y≈1690 no celular. Agora é UMA faixa com o que
            se consulta toda visita — entrega, competência, estágio do mês,
            urgência e financeiro —, cada um com o nome escrito. */}
        <section
          className="cl-resumo"
          aria-label="Resumo do mês"
          aria-busy={atualizando || undefined}
          data-atualizando={atualizando || undefined}
        >
          <div className="cl-entrega" data-sem-medida={!dados.delivery.measurable || undefined}>
            <Medidor valor={dados.delivery.measurable ? dados.delivery.level : null} tamanho={52} espessura={5} />
            <div className="min-w-0">
              <div className="o-rotulo-linha">
                <span className="cl-rotulo">Nível de entrega</span>
                {/* O rótulo ganhou o `?` na F17.57: o anel sozinho não diz o que mede. */}
                <Ajuda sobre="o nível de entrega" lado="baixo-direita">
                  Quanto do conteúdo contratado naquele mês já está marcado como
                  feito. Cada tipo pesa o que custa: vídeo 3, foto 1,5, arte e ads
                  1 — dez artes não valem dez vídeos. O que passa do contratado
                  entra como extra, e o medidor passa de 100%.
                </Ajuda>
              </div>
              {dados.delivery.measurable ? (
                <p className="cl-entrega-detalhe tnum">
                  base {dados.delivery.base}%
                  {dados.delivery.bonus > 0 && (
                    <span style={{ color: 'var(--luz-lives-texto)' }}> · extras +{dados.delivery.bonus}%</span>
                  )}
                </p>
              ) : (
                <p className="cl-entrega-detalhe cl-entrega-sem">
                  <span>{dados.delivery.message}</span>
                  {AJUDA_SEM_MEDIDA[dados.delivery.reason] && (
                    <Ajuda sobre={AJUDA_SEM_MEDIDA[dados.delivery.reason].sobre} lado="baixo-direita">
                      {AJUDA_SEM_MEDIDA[dados.delivery.reason].texto}
                    </Ajuda>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* COMPETÊNCIA E PERÍODO SÃO DOIS CONTROLES, COM DOIS NOMES — F11B.
              A competência é o mês do CONTRATO: o que se abre, planeja, aprova
              e o que o medidor mede. O período (na barra de cada área) só
              recorta a lista — e nunca muda a competência por acidente. */}
          <div className="cl-competencia" role="group" aria-label="Competência do contrato">
            <span className="cl-rotulo">Competência do contrato</span>
            <div className="cl-mes">
              <button
                type="button"
                className="o-btn o-btn-fantasma o-btn-icone"
                onClick={() => mudarContexto({ mes: deslocarMes(mes, -1) })}
                title="Competência anterior"
                aria-label="Competência anterior"
              >
                <IconeEsquerda />
              </button>
              <span className="cl-mes-nome tnum" aria-live="polite">
                {nomeDoMes(mes)}
              </span>
              <button
                type="button"
                className="o-btn o-btn-fantasma o-btn-icone"
                onClick={() => mudarContexto({ mes: deslocarMes(mes, 1) })}
                title="Próxima competência"
                aria-label="Próxima competência"
              >
                <IconeDireita />
              </button>
            </div>
          </div>

          {/* O ritual do mês: abrir, planejar, aprovar. A ordem importa, e a
              tela mostra onde o ciclo está em vez de deixar quem opera
              adivinhar. Enquanto a competência nova não chega, os botões
              esperam: marcar agora gravaria no mês certo o estado do mês
              errado. */}
          <div className="cl-ritual" role="group" aria-label={`Ciclo do mês: ${RITUAL_LABEL[estagio]}`}>
            {/* O estágio vai ESCRITO ao lado do nome (era o selo embaixo do
                medidor) — o ✓ sozinho não diz "falta aprovação". No celular o
                rótulo sai por altura, e os botões curtos dizem o mesmo com
                verbo (pendente) ou particípio (feito): "Planejar"/"✓ Planejado",
                "Aprovar"/"✓ Aprovado". O leitor de tela ouve o nome do grupo. */}
            <span className="cl-rotulo" aria-hidden>
              Ciclo do mês · <span className="cl-ritual-estado">{RITUAL_LABEL[estagio]}</span>
            </span>
            <div className="cl-ritual-linha">
              {estagio === 'fechado' ? (
                <>
                  <button
                    type="button"
                    className="o-btn o-btn-solido o-btn-sm"
                    disabled={atualizando || semPermissaoNoMes}
                    onClick={() => executar(() => api.abrirMes(dados.id, `${mes}-01`))}
                  >
                    Abrir o mês
                  </button>
                  {/* Era um parágrafo embaixo do botão; virou `?` na F17.37. */}
                  <Ajuda sobre="o que abrir o mês faz">
                    Abrir o mês congela o contrato — o que foi vendido naquele mês
                    para de depender do plano de hoje. Enquanto não abrir, o medidor
                    mostra travessão, não zero: sem contrato, não há o que cobrar.
                  </Ajuda>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-pressed={dados.planningDoneAt !== null}
                    aria-label={dados.planningDoneAt ? 'Mês planejado' : 'Marcar mês como planejado'}
                    className="o-btn o-btn-vidro o-btn-sm"
                    disabled={atualizando || semPermissaoNoMes}
                    /* F17.57: o rótulo é a ação, o título é a consequência. */
                    title={
                      dados.planningDoneAt
                        ? 'Este mês já está marcado como planejado. Clique para desmarcar.'
                        : 'Registra que a equipe terminou de montar o mês. Só depois disso dá para registrar a aprovação do cliente.'
                    }
                    onClick={() =>
                      executar(() =>
                        api.marcarRitual(dados.id, `${mes}-01`, 'planning', dados.planningDoneAt === null),
                      )
                    }
                  >
                    <span className="cl-longo">{dados.planningDoneAt ? '✓ Mês planejado' : 'Marcar mês como planejado'}</span>
                    <span className="cl-curto" aria-hidden>
                      {dados.planningDoneAt ? '✓ Planejado' : 'Planejar'}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={dados.clientApprovedAt !== null}
                    aria-label={dados.clientApprovedAt ? 'Cliente aprovou' : 'Registrar aprovação do cliente'}
                    className="o-btn o-btn-vidro o-btn-sm"
                    disabled={atualizando || semPermissaoNoMes}
                    title={
                      dados.clientApprovedAt
                        ? 'O cliente já aprovou este mês. Clique para retirar a aprovação.'
                        : 'Registra que o cliente concordou com o mês planejado. Fecha o ciclo do mês.'
                    }
                    onClick={() =>
                      executar(() =>
                        api.marcarRitual(dados.id, `${mes}-01`, 'approval', dados.clientApprovedAt === null),
                      )
                    }
                  >
                    <span className="cl-longo">
                      {dados.clientApprovedAt ? '✓ Cliente aprovou' : 'Registrar aprovação do cliente'}
                    </span>
                    <span className="cl-curto" aria-hidden>
                      {dados.clientApprovedAt ? '✓ Aprovado' : 'Aprovar'}
                    </span>
                  </button>
                </>
              )}
            </div>
            {/* O PORQUÊ À VISTA — F43, Fase 3. Fora da linha dos botões, que
                no celular não quebra: a frase desce para a linha de baixo. */}
            {semPermissaoNoMes && (
              <span className="cl-ritual-motivo">{estagio === 'fechado' ? SO_ADMIN_ABRE : SO_ADMIN_MARCA}</span>
            )}
          </div>

          {/* Financeiro OK: quem enxerga o cliente muda. É o combinado com o
              financeiro da agência, não um pagamento registrado aqui. */}
          <div className="cl-estado">
            <div className="cl-financeiro" data-pendente={!p.financeOk || undefined}>
              <Chave
                rotulo="Financeiro OK"
                ligada={p.financeOk}
                aoMudar={(v) => executar(() => api.chavesDoCliente(dados.id, { financeOk: v }))}
              />
              {!p.financeOk && <span className="cl-financeiro-estado">pendente</span>}
            </div>
            {/* ATIVO / INATIVO ao lado do Financeiro OK, onde sempre esteve. Só o
                administrador muda; a recusa vem do banco com a frase certa. */}
            <div className="cl-financeiro" data-pendente={!dados.isActive || undefined}>
              <Chave
                rotulo="Ativo"
                ligada={dados.isActive}
                aoMudar={(v) => executar(() => api.ativarCliente(dados.id, v))}
              />
              {!dados.isActive && <span className="cl-financeiro-estado">inativo</span>}
            </div>
          </div>
        </section>

        {/* --- dados do cliente — F11B -----------------------------------------

            Contrato, cota vigente, contato, links, Meta, etiquetas e
            observações: o cadastro inteiro continua a um clique, mas fechado
            por padrão, com uma linha que diz o essencial (plano, renovação,
            contato, Meta). O painel fica montado e escondido, e não
            desmontado: as contas da Meta são lidas uma vez, e é delas que
            vem a linha "Meta: …". */}
        <section className="cl-dados" data-aberto={dadosAbertos || undefined}>
          <button
            type="button"
            className="cl-dados-alternar"
            aria-expanded={dadosAbertos}
            aria-controls="cl-dados-painel"
            onClick={alternarDados}
          >
            <IconeChevron className="cl-dados-seta" />
            <span className="cl-dados-titulo">Dados do cliente</span>
            <span className="cl-dados-resumo">
              <span>{p.plan?.name ?? 'sem plano'}</span>
              {p.renewsOn && (
                <span data-tom={dias !== null && dias < 0 ? 'err' : dias !== null && dias <= 30 ? 'warn' : undefined}>
                  renova {dataCurta(p.renewsOn)}
                  {dias !== null && ` · ${dias < 0 ? `${Math.abs(dias)}d vencido` : `${dias}d`}`}
                </span>
              )}
              {contatoPrincipal && <span>{contatoPrincipal}</span>}
              {resumoMeta && <span>{resumoMeta}</span>}
              {p.notes && <span>observações</span>}
            </span>
          </button>

          <div id="cl-dados-painel" className="cl-dados-painel" hidden={!dadosAbertos}>
            <div className="o-card overflow-hidden">
              <h2 className="eyebrow px-3 pt-3">Contrato</h2>
              <div className="mt-2">
                <LinhaDaFicha k="Plano">
                  {p.plan ? (
                    <Selo
                      estilo={{
                        background: p.plan.colorBg,
                        color: p.plan.colorText,
                        borderColor: p.plan.colorBorder,
                      }}
                    >
                      {p.plan.name}
                    </Selo>
                  ) : (
                    <span className="text-mute">sem plano</span>
                  )}
                </LinhaDaFicha>
                <LinhaDaFicha k="Categoria">{dados.categoryName}</LinhaDaFicha>
                <LinhaDaFicha k="Início">{dataCurta(p.startedOn)}</LinhaDaFicha>
                <LinhaDaFicha k="Renovação">
                  {p.renewsOn ? (
                    <>
                      {dataCurta(p.renewsOn)}
                      {dias !== null && (
                        <span
                          className="tnum ml-2 font-mono text-[0.70rem]"
                          style={{
                            color: dias < 0 ? 'var(--err)' : dias <= 30 ? 'var(--warn)' : 'var(--mute)',
                          }}
                        >
                          {dias < 0 ? `${Math.abs(dias)}d vencido` : `${dias}d`}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-mute">não definida</span>
                  )}
                </LinhaDaFicha>
                {p.taxId && <LinhaDaFicha k="CPF/CNPJ">{formatarDocumento(p.taxId)}</LinhaDaFicha>}
                {/* EXCLUIR: só cliente já inativo, e só o administrador (o banco recusa
                    os demais). O passo antes é o interruptor `Ativo` do topo. */}
                {!dados.isActive && (
                  <LinhaDaFicha k="Excluir cliente">
                    <span className="inline-flex items-center gap-2">
                      {p.inactiveAt && (
                        <span className="text-mute">inativo desde {dataCurta(diaDoInstante(p.inactiveAt))}</span>
                      )}
                      <button
                        type="button"
                        className="o-btn o-btn-vidro o-btn-sm"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Excluir o cliente "${dados.name}" de vez? Contratos, conteúdos, demandas e histórico dele saem junto. Isso não pode ser desfeito.`,
                            )
                          )
                            return;
                          setErroDoGesto(null);
                          try {
                            await api.excluirCliente(dados.id);
                            navegar(painel.destino);
                          } catch (e) {
                            setErroDoGesto(e instanceof ApiError ? e.message : 'Não foi possível excluir.');
                          }
                        }}
                      >
                        Excluir
                      </button>
                    </span>
                  </LinhaDaFicha>
                )}
              </div>

              <h3 className="o-rotulo-linha px-3 pb-1 pt-4">
                <span className="eyebrow">Cota vigente</span>
                <Ajuda sobre="a cota vigente">
                  É o que vale hoje, e o que o próximo mês congela ao abrir. O mês
                  já aberto guarda a cota daquele mês — é ela que aparece em
                  Conteúdos e na Semanal.
                </Ajuda>
              </h3>
              {/* QUATRO ZEROS NÃO SÃO UMA COTA — F17.57. */}
              {semContratoDeConteudo ? (
                <p className="px-3 pb-3 pt-1 text-sm text-mute">Este cliente não contrata conteúdo mensal.</p>
              ) : (
                <div className="cl-cota grid grid-cols-4 gap-2 p-3 pt-1">
                  {CONTENT_TYPES.map((t) => {
                    const { Icone, texto, plural } = TIPO[t];
                    return (
                      <div key={t} className="text-center">
                        <Icone className="mx-auto h-3.5 w-3.5" />
                        <div className="tnum mt-1 text-sm text-plat">{cotaPorTipo(t)}</div>
                        <div className="font-mono text-[0.72rem] uppercase tracking-wider" style={{ color: texto }}>
                          {plural}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="o-card overflow-hidden">
              <h2 className="eyebrow px-3 pt-3">Contato</h2>
              <div className="mt-2">
                {p.phone && <LinhaDaFicha k="Telefone">{formatarTelefone(p.phone)}</LinhaDaFicha>}
                {p.whatsapp && <LinhaDaFicha k="WhatsApp">{formatarTelefone(p.whatsapp)}</LinhaDaFicha>}
                {p.companyEmail && <LinhaDaFicha k="E-mail">{p.companyEmail}</LinhaDaFicha>}
                {p.address && <LinhaDaFicha k="Endereço">{p.address}</LinhaDaFicha>}
                {p.ownerName && <LinhaDaFicha k="Proprietário">{p.ownerName}</LinhaDaFicha>}
                {p.ownerPhone && <LinhaDaFicha k="Celular">{formatarTelefone(p.ownerPhone)}</LinhaDaFicha>}
                {p.ownerWhatsapp && (
                  <LinhaDaFicha k="WhatsApp dele">{formatarTelefone(p.ownerWhatsapp)}</LinhaDaFicha>
                )}
                {!p.phone && !p.whatsapp && !p.companyEmail && !p.address && !p.ownerName && (
                  <p className="px-3 pb-3 text-sm text-mute">Nenhum contato cadastrado.</p>
                )}
              </div>

              {p.links.length > 0 && (
                <>
                  <h3 className="eyebrow px-3 pb-1 pt-4">Links</h3>
                  <div className="flex flex-wrap gap-1.5 p-3 pt-1">
                    {p.links.map((l) => (
                      <a
                        key={l.id}
                        href={l.url}
                        target="_blank"
                        // `noreferrer` junto com `noopener`: um link de cliente
                        // não precisa contar de onde o clique veio.
                        rel="noopener noreferrer"
                        className="o-btn o-btn-vidro o-btn-sm"
                      >
                        {l.title} ↗
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="o-card cl-notas p-3">
              {p.tags.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="eyebrow mr-1">Etiquetas</span>
                  {p.tags.map((t) => (
                    <Etiqueta key={t.id} cor={t.color}>
                      {t.name}
                    </Etiqueta>
                  ))}
                </div>
              )}
              <h2 className="eyebrow mb-1">Observações</h2>
              {p.notes ? (
                <>
                  {/* Nada cortado nem descartado: o texto longo mostra o
                      começo, e o inteiro — com as quebras de linha — está a
                      um clique. */}
                  <p
                    id="cl-observacoes"
                    className="cl-observacoes whitespace-pre-wrap text-sm text-plat-dim"
                    data-recolhida={(observacoesCompridas && !observacoesInteiras) || undefined}
                  >
                    {p.notes}
                  </p>
                  {observacoesCompridas && (
                    <button
                      type="button"
                      className="o-btn o-btn-fantasma o-btn-sm mt-1 -ml-2"
                      aria-expanded={observacoesInteiras}
                      aria-controls="cl-observacoes"
                      onClick={() => setObservacoesInteiras((v) => !v)}
                    >
                      {observacoesInteiras ? 'Mostrar menos' : 'Mostrar observações inteiras'}
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-mute">Nenhuma observação.</p>
              )}
            </div>

            {/* A ponte com a área Meta. Fica na ficha porque quem sabe de quem
                é a conta é quem cuida da carteira — a Meta não tem essa
                informação. Ligar, soltar e o porquê do vazio continuam aqui. */}
            <div className="cl-dados-largo">
              <ContasDaMeta clienteId={dados.id} clienteNome={dados.name} aoCarregar={setContasDaMeta} />
            </div>

            {/* A APROVAÇÃO EXTERNA — F42, Fase 3. Configuração de uma vez (chave
                e link fixo do cliente), por isso aqui dentro e não no topo. Só
                admin a vê; a leitura sai quando o painel abre. */}
            <div className="cl-dados-largo">
              <AprovacaoExterna clientId={dados.id} aberto={dadosAbertos} />
            </div>
          </div>
        </section>

        {/* --- as sete áreas — F11B: logo abaixo do resumo -------------------- */}
        <Abas
          rotulo="Áreas do cliente"
          base={BASE_DAS_AREAS}
          className="cl-areas"
          opcoes={AREAS.map((a) => ({ valor: a, rotulo: ROTULO_DA_AREA[a] }))}
          valor={area}
          aoEscolher={(a) => mudarContexto({ area: a })}
          idDoPainel={PAINEL_DA_AREA}
        />

        <div
          key={dados.id}
          id={PAINEL_DA_AREA}
          role="tabpanel"
          aria-labelledby={idDaAba(BASE_DAS_AREAS, area)}
          aria-busy={atualizando || undefined}
          className="cl-area"
          data-atualizando={atualizando || undefined}
        >
          {/* --- conteúdos ------------------------------------------------------ */}
          {area === 'conteudos' && (
            <section className="pb-10">
              {/* O CONTRATADO DO MÊS, CONGELADO — não a cota vigente. Uma
                  régua baixa, e não quatro cartões: no celular eles empilhavam
                  240 px antes do primeiro item da produção. */}
              {dados.delivery.measurable && (
                <div className="cl-tipos" role="group" aria-label={`Contratado em ${nomeDoMes(mes)}`}>
                  <span className="cl-tipos-rotulo o-rotulo-linha">
                    <span>Contratado em {nomeDoMes(mes)}</span>
                    <Ajuda sobre="o contratado do mês">
                      É a cota que este mês congelou ao ser aberto — mudar o plano
                      hoje não a reescreve. A cota vigente, que vale para os
                      próximos meses, fica em Dados do cliente.
                    </Ajuda>
                  </span>
                  {CONTENT_TYPES.map((t) => {
                    const b = dados.delivery.measurable
                      ? dados.delivery.breakdown.find((x) => x.contentType === t)
                      : undefined;
                    const contratado = b?.contracted ?? 0;
                    const entregue = b?.delivered ?? 0;
                    const extras = b?.extras ?? 0;
                    if (contratado === 0 && entregue === 0 && extras === 0) return null;

                    const { Icone, cor, texto, plural } = TIPO[t];
                    return (
                      <div key={t} className="cl-tipo">
                        <div className="cl-tipo-linha">
                          <span className="cl-tipo-nome">
                            <span className="inline-flex shrink-0" style={{ color: texto }}>
                              <Icone className="h-3.5 w-3.5" />
                            </span>
                            {plural}
                          </span>
                          <span className="cl-tipo-conta tnum">
                            <b>{entregue}</b>/{contratado}
                            {extras > 0 && <span style={{ color: 'var(--luz-lives-texto)' }}> +{extras}</span>}
                          </span>
                        </div>
                        <Barra pct={contratado === 0 ? 100 : Math.round((entregue / contratado) * 100)} cor={cor} />
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="cl-barra-da-area">
                <h2 className="cl-area-titulo">Produção</h2>
                <div className="cl-periodo" role="group" aria-labelledby="cl-periodo-rotulo">
                  <IconeCalendario className="h-4 w-4 text-mute" />
                  <span className="cl-rotulo" id="cl-periodo-rotulo">
                    Período da produção
                  </span>
                  <SeletorDePeriodo
                    valor={periodo}
                    mesDeReferencia={`${mes}-01`}
                    aoMudar={(novo) => mudarContexto({ periodo: novo })}
                  />
                </div>
                <SeletorDeModo contexto="conteudos" valor={modoDosConteudos} aoEscolher={escolherModoDosConteudos} />
              </div>

              {modoDosConteudos === 'kanban' ? (
                <div className="mt-2">
                  {dados.scheduled.length + dados.unscheduled.length === 0 ? (
                    <p className="cl-lista-vazia">{periodo ? 'Nada agendado neste período.' : 'Nada agendado neste mês.'}</p>
                  ) : (
                    <KanbanDeConteudos
                      agendados={dados.scheduled}
                      semData={dados.unscheduled}
                      nomes={nomesDosConteudos}
                      aoAlternar={alternar}
                    />
                  )}
                </div>
              ) : (
              <>
              <ul className="cl-lista mt-2" aria-label="Agendados">
                {dados.scheduled.map((i) => (
                  <Linha key={i.id} item={i} nome={nomesDosConteudos.get(i.id) ?? i.id} aoAlternar={alternar} />
                ))}
                {dados.scheduled.length === 0 && (
                  <li className="cl-lista-vazia">
                    {periodo ? 'Nada agendado neste período.' : 'Nada agendado neste mês.'}
                    {periodo && (
                      <button
                        type="button"
                        className="o-btn o-btn-fantasma o-btn-sm"
                        onClick={() => mudarContexto({ periodo: null })}
                      >
                        Ver o mês inteiro
                      </button>
                    )}
                  </li>
                )}
              </ul>

              {dados.unscheduled.length > 0 && (
                <div className="cl-grupo">
                  <h3 className="cl-grupo-titulo">
                    Planejados, ainda sem data <span className="tnum">{dados.unscheduled.length}</span>
                  </h3>
                  <ul className="cl-lista" aria-label="Planejados, ainda sem data">
                    {dados.unscheduled.map((i) => (
                      <Linha key={i.id} item={i} nome={nomesDosConteudos.get(i.id) ?? i.id} aoAlternar={alternar} />
                    ))}
                  </ul>
                </div>
              )}
              </>
              )}

              {/* O extra passa da cota do mês: nasce sem dia e entra na lista
                  de cima; a data se dá na Semanal ou no Calendário. */}
              {dados.monthOpened && (
                <div className="cl-extras" role="group" aria-labelledby="cl-extras-rotulo">
                  <span className="cl-rotulo" id="cl-extras-rotulo">
                    Acrescentar extra
                  </span>
                  {CONTENT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="o-btn o-btn-vidro o-btn-sm"
                      disabled={atualizando}
                      onClick={() => executar(() => api.criarItem(dados.id, `${mes}-01`, t, true))}
                    >
                      + {TIPO[t].rotulo} extra
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* --- calendário ---------------------------------------------------- */}
          {area === 'calendario' && (
            <CalendarioDoCliente
              clienteId={dados.id}
              mes={mes}
              // O período é o MESMO de Conteúdos, de propósito: um cliente, uma
              // janela — e ele mora no endereço junto com a área.
              periodo={periodo}
              aoMudarPeriodo={(novo) => mudarContexto({ periodo: novo })}
              // F17.44: marcar pelo calendário mexe na cota do mês; o medidor e
              // a Semanal releem pela mesma leitura.
              aoMudar={reler}
            />
          )}

          {area === 'checklist' && <Checklist clienteId={dados.id} />}

          {area === 'captacao' && (
            <Captacao
              clienteId={dados.id}
              mes={mes}
              // A cota DAQUELE mês, não a vigente: a captação de agosto se mede
              // contra o que agosto contratou.
              cotaDeVideoNoMes={contratadoNoMes.video}
            />
          )}

          {area === 'mural' && <Mural clienteId={dados.id} />}

          {area === 'historico' && <Historico clienteId={dados.id} />}

          {area === 'semanal' && (
            <Semanal
              clienteId={dados.id}
              mes={mes}
              itens={dados.monthItems}
              contratado={contratadoNoMes}
              mesAberto={dados.monthOpened}
              semContratoDeConteudo={semContratoDeConteudo}
              hoje={hoje}
              aoMudar={reler}
            />
          )}
        </div>

      </TelaComBarra>

      {editando && (
        <FichaDeCliente
          clienteId={dados.id}
          aoFechar={() => {
            setEditando(false);
            // O foco volta a quem abriu — F11B: fechar o cadastro devolve a
            // leitura à ficha, no mesmo ponto.
            requestAnimationFrame(() => botaoEditar.current?.focus());
          }}
          aoSalvar={() => {
            setEditando(false);
            void reler();
            requestAnimationFrame(() => botaoEditar.current?.focus());
          }}
        />
      )}
    </PaginaLarga>
  );
}
