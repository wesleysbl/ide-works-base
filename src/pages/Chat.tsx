/**
 * Tela do chat da equipe — F20.5 / F20.6.
 *
 * Layout Obsidian: lista à esquerda (Geral no topo), painel à direita com
 * balões por autoria. F20.6: novo grupo, direta, painel de membros, não lidas
 * e marcar leitura só com conversa visível e aba em foco.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  Pencil,
  RotateCw,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';

import { TelaComBarra } from '@/board/TelaComBarra';
import { CampoComMencoes, ProvedorDeMencoes } from '@/board/CamposDeMencao';
import { Avatar } from '@/board/menus';
import { initials } from '@/board/board';
import {
  CHAT_BODY_MAX,
  FRASE_PAREDE_30_DIAS,
  chatVisivelNaBarra,
  modoDoChat,
} from '@/chat/chave';
import { faixaDoChat, type FaixaDoChat } from '@/chat/faixa';
import { useChatLive } from '@/chat/useChatLive';
import {
  aplicarMensagem,
  marcarFalha,
  mensagemOtimista,
  reconciliarEnvio,
  type MensagemNaTela,
} from '@/chat/envio';
import { enviarImagensDoChat } from '@/chat/enviar-imagens';
import {
  horarioDaConversa,
  nomeDaConversa,
  ordenarConversas,
  previaDaConversa,
  seloDeNaoLidas,
  sobreAConversa,
  type ConversaParaLista,
} from '@/chat/lista';
import {
  chaveDoDia,
  horaDaMensagem,
  instanteDaMensagem,
  montarPainel,
  statusVisualDaMensagem,
} from '@/chat/mensagens';
import {
  EMOJIS_DE_REACAO,
  agruparPorMensagem,
  alternarReacaoLocal,
  chaveDaReacao,
  definirReacao,
  desfazerPalpite,
  fundirMudancas,
  minhaReacao,
  relogioDaReposicao,
  rotuloDaReacao,
  saiuDoToqueLongo,
  type ReacaoNaTela,
} from '@/chat/reacoes';
import {
  abaEstaComFoco,
  idDaPrimeiraNova,
  podeMarcarComoLida,
  zerarNaoLidasDaConversa,
} from '@/chat/nao-lidas';
import { NovaDireta } from '@/chat/NovaDireta';
import { NovoGrupo } from '@/chat/NovoGrupo';
import { PainelDoGrupo } from '@/chat/PainelDoGrupo';
import { deveAnexar, ehTipoQueSeCola } from '@/board/colar-imagem';
import {
  imagemNoTexto,
  imagensDoTexto,
  juntarTextoEImagens,
  textoSemImagens,
} from '@/board/imagens-no-texto';
import { ApiError, api, semSessao } from '@/lib/api';
import type { ChatLiveEvent } from '@/server/chat-live';
import type { ChatMember } from '@/server/chat';
import { IconeClipe, IconeMais, IconePessoas } from '@/ui/Icones';
import { Markdown } from '@/ui/Markdown';
import { ROTULO_DO_ITEM } from '@/ui/preferencias';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { Aviso, PaginaLarga } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';
import { useSessao } from '@/ui/sessao';
import { comportamentoDeRolagem } from '@/ui/movimento';
import '@/ui/conversa.css';
import '@/ui/imagens-no-texto.css';
import '@/chat/chat.css';

const PAGINA = 50;
/** Antes da primeira medida: um palpite pela janela, sem piscar no celular. */
const faixaInicial = (): FaixaDoChat =>
  typeof window === 'undefined' ? 'duas' : window.innerWidth <= 720 ? 'uma' : window.innerWidth >= 1280 ? 'larga' : 'duas';

type Conversa = ConversaParaLista & {
  archivedAt: string | null;
  unreadCount: number;
  lastReadAt: string | null;
  myRole: 'owner' | 'member' | null;
  peerUserId: string | null;
  peerName: string | null;
  peerIsActive: boolean | null;
  members: ChatMember[];
};

type Pessoa = { id: string; name: string };

type CaixaAberta = 'grupo' | 'direta' | null;

function comoTela(
  m: {
    id: string;
    conversationId: string;
    authorId: string | null;
    body: string;
    kind: 'person' | 'system';
    createdAt: string;
    editedAt: string | null;
    deletedAt: string | null;
    clientKey: string | null;
  },
): MensagemNaTela {
  return { ...m, estado: 'confirmada', erro: null };
}

function nomeDoAutor(authorId: string | null, mapa: Map<string, string>, eu: string | null): string {
  if (!authorId) return 'Sistema';
  if (eu && authorId === eu) return 'Você';
  return mapa.get(authorId) ?? 'Colega';
}

/**
 * O ROSTO DA CONVERSA — F08. A forma diz o tipo antes do nome: pessoa é
 * círculo com a cor dela (o mesmo avatar das tarefas), grupo é quadrado com
 * as iniciais, e o Geral — a casa da equipe — é o único no verde da marca.
 */
function RostoDaConversa({ conversa, grande }: { conversa: Conversa; grande?: boolean }) {
  const nome = nomeDaConversa(conversa);
  return (
    <span className="ch-rosto" data-kind={conversa.kind} data-tamanho={grande ? 'grande' : undefined} aria-hidden="true">
      {conversa.kind === 'direct' ? (
        <Avatar pessoa={{ id: conversa.peerUserId ?? conversa.id, name: nome }} />
      ) : conversa.kind === 'general' ? (
        <span className="ch-rosto-marca">#</span>
      ) : (
        <span className="ch-rosto-grupo">{initials(nome)}</span>
      )}
    </span>
  );
}

function fraseApi(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** O histórico que não veio: sem acesso (403/404) ou falha que vale repetir. */
type FalhaDoHistorico = { tipo: 'acesso' | 'erro'; frase: string };

/**
 * A CONEXÃO SÓ APARECE QUANDO FAZ FALTA — F09. O estado é o real do gerente
 * (`useChatLive().status`); aqui só se decide QUANDO dizer. Um "reconectando"
 * de dois segundos é ruído: o aviso espera um pouco e some assim que volta.
 * Nada de "conectado" decorativo (§5 da especificação).
 */
function useReconectandoVisivel(status: string, esperaMs = 3000): boolean {
  const [visivel, setVisivel] = useState(false);
  useEffect(() => {
    if (status !== 'reconectando') {
      setVisivel(false);
      return;
    }
    const t = window.setTimeout(() => setVisivel(true), esperaMs);
    return () => window.clearTimeout(t);
  }, [status, esperaMs]);
  return visivel;
}

export default function Chat() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { sessao, carregando } = useSessao();
  const eu = sessao?.userId ?? null;
  const live = useChatLive();
  const { refrescarNaoLidas } = live;

  const chatOk = chatVisivelNaBarra(
    modoDoChat(),
    carregando ? null : (sessao?.isSuper ?? false),
  );

  const [faixa, setFaixa] = useState<FaixaDoChat>(faixaInicial);
  const telaPequena = faixa === 'uma';
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const [mensagens, setMensagens] = useState<MensagemNaTela[]>([]);
  const [diretorio, setDiretorio] = useState<Pessoa[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * A LEITURA DA LISTA DE CONVERSAS FALHOU — conferência de 09/10/2026.
   *
   * Antes a falha fazia `setConversas([])`: a lista esvaziava e a tela passava a
   * afirmar "Nenhuma conversa ainda" e, num link direto (ou com uma conversa
   * já aberta), "Esta conversa não está disponível para você" — duas mentiras
   * de rede caída. E `lerConversas` roda a cada mensagem que chega e a cada
   * envio: uma falha passageira no meio da conversa tirava a conversa da tela.
   * Agora a lista que já estava fica como estava, e esta marca só diz que a
   * última leitura falhou (para o aviso oferecer "Tentar de novo" e, na
   * primeira leitura, a lista não ficar em "Carregando…" para sempre).
   */
  const [falhouLerConversas, setFalhouLerConversas] = useState(false);
  const [avisoEstrutura, setAvisoEstrutura] = useState<string | null>(null);
  const [parede, setParede] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [texto, setTexto] = useState('');
  const [avisoTeto, setAvisoTeto] = useState<string | null>(null);
  const [avisoImagem, setAvisoImagem] = useState<string | null>(null);
  const [subindoImagem, setSubindoImagem] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunhoEdicao, setRascunhoEdicao] = useState('');
  const [temNovas, setTemNovas] = useState(false);
  const [caixa, setCaixa] = useState<CaixaAberta>(null);
  /* OS DOIS BOTÕES QUE ABREM BALÃO — F33. Em estado, e não em `ref`, pelo mesmo
     motivo do chip da conta (`ContaNoPe`): o balão precisa do elemento na
     renderização para se ancorar nele e sair da `.ch-lista`, que o recortava. */
  const [botaoGrupo, setBotaoGrupo] = useState<HTMLButtonElement | null>(null);
  const [botaoDireta, setBotaoDireta] = useState<HTMLButtonElement | null>(null);
  const [painelMembros, setPainelMembros] = useState(false);
  /* O botão Membros, para o foco voltar a ele quando o painel fecha (F08). */
  const botaoMembrosRef = useRef<HTMLButtonElement | null>(null);
  const [reacoes, setReacoes] = useState<ReacaoNaTela[]>([]);
  const [barraDeReacao, setBarraDeReacao] = useState<string | null>(null);
  const [pressionada, setPressionada] = useState<string | null>(null);
  const [salvandoEstrutura, setSalvandoEstrutura] = useState(false);
  /* F09: o histórico tem estado próprio — carregando, sem acesso ou falha que
     se repete —, em vez de um painel em branco com o erro lá no topo. */
  const [lendoHistorico, setLendoHistorico] = useState(false);
  /** De qual conversa é o histórico já lido — F10: só depois dele dá para dizer
   *  que a mensagem apontada por uma notificação não está entre as mostradas. */
  const [historicoDe, setHistoricoDe] = useState<string | null>(null);
  const [falhaHistorico, setFalhaHistorico] = useState<FalhaDoHistorico | null>(null);
  /* F36: Momento da última leitura do contato para os checks WhatsApp azuis */
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(null);
  /* No toque não há hover: um toque na bolha mostra as ações dela (F09). */
  const [ativaId, setAtivaId] = useState<string | null>(null);
  const ultimoPonteiro = useRef<string>('mouse');
  const reconectando = useReconectandoVisivel(live.status);

  // F36: Registra qual conversa está aberta para a supressão de som estrita
  useEffect(() => {
    live.definirConversaAberta(conversationId ?? null);
    return () => {
      live.definirConversaAberta(null);
    };
  }, [conversationId, live]);

  const gradeRef = useRef<HTMLDivElement | null>(null);
  const sessaoHistoricoRef = useRef(0);
  const inicioNoPeRef = useRef<number | null>(null);
  const historicoEmVooRef = useRef<number | null>(null);
  const anterioresEmVooRef = useRef<number | null>(null);
  const alcanceEmVooRef = useRef<number | null>(null);
  const ancoraRef = useRef<{ sessao: number; id?: string; topo: number; altura: number; rolagem: number } | null>(null);
  const fioRef = useRef<HTMLDivElement | null>(null);
  const noPeRef = useRef(true);
  const sinceRef = useRef<string>(new Date().toISOString());
  /* Relógio próprio da reposição das reações: a rota de mudanças anda por
     `changed_at`, que não é o `createdAt` das mensagens (F24.4). */
  const sinceReacoesRef = useRef<string>(new Date().toISOString());
  /* Palpites de reação ainda sem resposta da API, por `chaveDaReacao`. A
     reposição não pisa neles. */
  const emVooRef = useRef<Set<string>>(new Set<string>());
  /* Espelho da lista de reações para ler o estado de AGORA fora do render —
     mesmo truque do `textoAtual`. */
  const reacoesAtuais = useRef<ReacaoNaTela[]>([]);
  const conversaAbertaRef = useRef<string | undefined>(conversationId);
  const lastReadRef = useRef<string | null>(null);
  const entradaDeImagem = useRef<HTMLInputElement>(null);
  const entradasDeArrasto = useRef(0);
  const toqueRef = useRef<number | null>(null);
  const origemDoToque = useRef<{ x: number; y: number } | null>(null);
  const textoAtual = useRef(texto);
  textoAtual.current = texto;
  reacoesAtuais.current = reacoes;

  useLayoutEffect(() => {
    conversaAbertaRef.current = conversationId;
    sessaoHistoricoRef.current += 1;
    historicoEmVooRef.current = null;
    inicioNoPeRef.current = null;
    anterioresEmVooRef.current = null;
    alcanceEmVooRef.current = null;
    ancoraRef.current = null;
    setMensagens([]);
    setReacoes([]);
    setCarregandoMais(false);
    setParede(false);
    setTemNovas(false);
    setErro(null);
    setPainelMembros(false);
    setEditandoId(null);
    setBarraDeReacao(null);
    setAtivaId(null);
    setFalhaHistorico(null);
    setLendoHistorico(false);
    /* F10: o histórico lido é o da conversa ANTERIOR — sem isto, voltar a uma
       conversa já lida (ou cuja nova leitura falhar) diria "mensagem ausente"
       por um quadro, antes de a leitura dela começar. */
    setHistoricoDe(null);
    noPeRef.current = true;
    sinceRef.current = new Date().toISOString();
    return () => { sessaoHistoricoRef.current += 1; };
  }, [conversationId]);

  /* O módulo é medido antes da pintura: a primeira tela já sai com uma área
     ou duas, sem a conversa esmagada por um quadro. */
  useLayoutEffect(() => {
    const grade = gradeRef.current;
    if (!grade) return;
    const medir = () => {
      const largura = grade.getBoundingClientRect().width;
      if (largura > 0) setFaixa(faixaDoChat(largura));
    };
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const olho = new ResizeObserver(medir);
    olho.observe(grade);
    return () => olho.disconnect();
  }, [chatOk]);

  // O teclado pode reduzir só a janela visual, sem alterar 100dvh.
  useEffect(() => {
    const janela = window.visualViewport;
    const pagina = gradeRef.current?.closest('main');
    if (!janela || !pagina) return;
    const medir = () => {
      if (janela.scale === 1) pagina.style.setProperty('--ch-altura', `${janela.height}px`);
      else pagina.style.removeProperty('--ch-altura');
    };
    medir();
    janela.addEventListener('resize', medir);
    return () => janela.removeEventListener('resize', medir);
  }, [chatOk]);

  const mapaNomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of diretorio) m.set(p.id, p.name);
    return m;
  }, [diretorio]);

  const listaOrdenada = useMemo(
    () => (conversas ? ordenarConversas(conversas) : []),
    [conversas],
  );

  const aberta = useMemo(
    () => listaOrdenada.find((c) => c.id === conversationId) ?? null,
    [listaOrdenada, conversationId],
  );

  /* A LISTA DE BLOCOS E OS GRUPOS DE REAÇÃO SÓ MUDAM QUANDO O DADO MUDA —
     perf-front, 08/10/2026. Antes eram refeitos a cada desenho, e digitar uma
     letra no campo de escrever desenha a conversa inteira: `montarPainel`
     ordena e agrupa todas as mensagens, `agruparPorMensagem` ordena todas as
     reações (com `localeCompare`). O dia de hoje entra na chave porque os
     rótulos "Hoje" e "Ontem" dos separadores dependem dele: uma aba aberta
     pela virada da meia-noite continua se corrigindo no desenho seguinte. */
  const hojeDoPainel = chaveDoDia(new Date().toISOString());
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `hojeDoPainel` não é lido: é a validade dos rótulos.
  const blocos = useMemo(() => montarPainel(mensagens), [mensagens, hojeDoPainel]);
  const reacoesPorMensagem = useMemo(() => agruparPorMensagem(reacoes, eu), [reacoes, eu]);

  useLayoutEffect(() => {
    const ancora = ancoraRef.current;
    const el = fioRef.current;
    if (el && inicioNoPeRef.current === sessaoHistoricoRef.current) {
      el.scrollTop = el.scrollHeight;
      inicioNoPeRef.current = null;
      noPeRef.current = true;
    }
    if (!ancora || !el || ancora.sessao !== sessaoHistoricoRef.current) return;
    const mensagem = ancora.id ? document.getElementById(ancora.id) : null;
    el.scrollTop = mensagem
      ? el.scrollTop + mensagem.getBoundingClientRect().top - ancora.topo
      : ancora.rolagem + el.scrollHeight - ancora.altura;
    ancoraRef.current = null;
  }, [mensagens, aberta?.id]);

  /* NO PÉ, FICA NO PÉ — F09. Conteúdo que cresce DEPOIS do primeiro quadro
     (a imagem que chega do armazenamento, a reação que entra, a bolha que ganha
     "editada") empurrava o fim para fora da vista de quem estava no pé. Quem
     está lendo o passado (`noPeRef` falso) não é movido: as molduras de imagem
     têm altura fixa para que nada mude acima dele. */
  useEffect(() => {
    const wrap = fioRef.current;
    const fio = wrap?.querySelector('.ch-fio');
    if (!wrap || !fio || typeof ResizeObserver === 'undefined') return;
    const olho = new ResizeObserver(() => {
      if (noPeRef.current) wrap.scrollTop = wrap.scrollHeight;
    });
    olho.observe(fio);
    return () => olho.disconnect();
  }, [aberta?.id, conversationId]);

  useEffect(() => {
    lastReadRef.current = aberta?.lastReadAt ?? null;
  }, [aberta?.lastReadAt, conversationId]);

  const tentarMarcarLida = useCallback(
    (id: string, readAt: string) => {
      if (!podeMarcarComoLida(conversaAbertaRef.current === id, abaEstaComFoco())) {
        return;
      }
      void api
        .chatMarcarLida(id, readAt)
        .then((r) => {
          if (conversaAbertaRef.current === id) lastReadRef.current = r.lastReadAt;
          setConversas((atual) =>
            atual ? zerarNaoLidasDaConversa(atual, id).map((c) =>
              c.id === id ? { ...c, lastReadAt: r.lastReadAt, unreadCount: 0 } : c,
            ) : atual,
          );
          refrescarNaoLidas();
        })
        .catch(() => {});
    },
    [refrescarNaoLidas],
  );

  const lerConversas = useCallback(async () => {
    try {
      const r = await api.chatConversas();
      setConversas(r.conversations as Conversa[]);
      setErro(null);
      setFalhouLerConversas(false);
      refrescarNaoLidas();
      return r.conversations as Conversa[];
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return [];
      }
      // NÃO esvazia a lista: ver `falhouLerConversas`.
      setErro(fraseApi(e, 'Não foi possível carregar as conversas.'));
      setFalhouLerConversas(true);
      return [];
    }
  }, [refrescarNaoLidas]);

  const lerHistorico = useCallback(
    async (id: string) => {
      /* O relógio da reposição começa ANTES da leitura: o que mudar durante a
         viagem da resposta ainda cai na próxima janela, em vez de sumir. */
      const abertura = new Date().toISOString();
      const sessao = sessaoHistoricoRef.current;
      historicoEmVooRef.current = sessao;
      const atual = () => sessaoHistoricoRef.current === sessao && conversaAbertaRef.current === id;
      setLendoHistorico(true);
      setFalhaHistorico(null);
      try {
        const r = await api.chatMensagens(id);
        if (!atual()) return;
        const lista = r.messages.map(comoTela);
        inicioNoPeRef.current = sessao;
        setTemNovas(false);
        setMensagens(lista);
        setHistoricoDe(id);
        setReacoes(r.reactions ?? []);
        sinceReacoesRef.current = abertura;
        emVooRef.current.clear();
        setBarraDeReacao(null);
        setParede(r.messages.length < PAGINA);
        if (lista.length > 0) {
          const ultimo = lista[lista.length - 1];
          sinceRef.current = ultimo.createdAt;
          tentarMarcarLida(id, ultimo.createdAt);
        }
        setErro(null);
      } catch (e) {
        if (!atual()) return;
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        setMensagens([]);
        setReacoes([]);
        // Recusa de alcance (link direto de conversa fora do alcance): mostra a
        // frase da API no painel, sem derrubar a barra nem a lista. Outra falha
        // é recuperável: o painel oferece Tentar de novo (F09).
        const semAcesso = e instanceof ApiError && (e.status === 403 || e.status === 404);
        setFalhaHistorico({
          tipo: semAcesso ? 'acesso' : 'erro',
          frase: fraseApi(e, 'Não foi possível carregar as mensagens.'),
        });
      } finally {
        if (atual()) {
          historicoEmVooRef.current = null;
          setLendoHistorico(false);
        }
      }
    },
    [tentarMarcarLida],
  );

  const alcançarOQueFaltou = useCallback(async () => {
    const id = conversaAbertaRef.current;
    void lerConversas();
    const sessao = sessaoHistoricoRef.current;
    if (!id || historicoEmVooRef.current === sessao || alcanceEmVooRef.current === sessao) return;
    alcanceEmVooRef.current = sessao;
    const atual = () => sessaoHistoricoRef.current === sessao && conversaAbertaRef.current === id;
    /* Reações mudadas desde o último instante conhecido — ao lado das
       mensagens, e sem derrubar a reposição delas se esta falhar (F24.4). */
    void api
      .chatReacoesMudadas(id, sinceReacoesRef.current)
      .then((rr) => {
        if (!atual() || rr.reactions.length === 0) return;
        setReacoes((atual) => fundirMudancas(atual, rr.reactions, emVooRef.current));
        sinceReacoesRef.current = relogioDaReposicao(sinceReacoesRef.current, rr.reactions);
      })
      .catch((e) => {
        /* A reposição das mensagens não pode regredir por causa desta aqui, então
           o erro não vira tela. Mas mudo ele não fica: sem voz, uma rota quebrada
           (deploy sem a migration, 500) faria só quem ficou offline perder reação,
           para sempre e sem sinal nenhum. */
        console.warn(
          `[ide-works:chat] reposição das reações falhou: ${fraseApi(e, 'motivo desconhecido')}`,
        );
      });
    try {
      const r = await api.chatMudancas(id, sinceRef.current);
      if (!atual() || r.messages.length === 0) return;
      setMensagens((atual) => {
        let proxima = atual;
        for (const m of r.messages) proxima = aplicarMensagem(proxima, m);
        return proxima;
      });
      const maxAt = r.messages.reduce(
        (acc, m) => (m.createdAt > acc ? m.createdAt : acc),
        sinceRef.current,
      );
      sinceRef.current = maxAt;
      if (noPeRef.current) {
        requestAnimationFrame(() => {
          if (!atual()) return;
          const el = fioRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
        tentarMarcarLida(id, maxAt);
      } else {
        setTemNovas(true);
      }
    } catch {
      /* alcance em silêncio: próxima volta tenta de novo */
    } finally {
      if (atual()) alcanceEmVooRef.current = null;
    }
  }, [lerConversas, tentarMarcarLida]);

  useEffect(() => {
    if (!chatOk) return;
    void lerConversas();
    void api.chatDiretorio().then((r) => setDiretorio(r.people)).catch(() => {});
  }, [chatOk, lerConversas]);

  useEffect(() => {
    // A rota vazia é a lista no celular. O redirecionamento não fica preso
    // à resposta assíncrona de uma rota que a pessoa já abandonou.
    if (!chatOk || telaPequena || conversationId) return;
    const geral = conversas?.find((c) => c.kind === 'general');
    if (geral) navigate(`/chat/${geral.id}`, { replace: true });
  }, [chatOk, telaPequena, conversationId, conversas, navigate]);

  useEffect(() => {
    if (!chatOk || !conversationId) return;
    void lerHistorico(conversationId);
  }, [chatOk, conversationId, lerHistorico]);

  /* F10: a mensagem apontada pela notificação não está no histórico lido. */
  const alvoDoAviso = /^#chat-msg-([0-9a-f-]+)$/i.exec(hash)?.[1] ?? null;
  const alvoAusente =
    alvoDoAviso !== null &&
    conversationId !== undefined &&
    historicoDe === conversationId &&
    !lendoHistorico &&
    !mensagens.some((m) => m.id === alvoDoAviso);

  /* Destaque vindo do aviso de menção — F20.8 (`#chat-msg-…`). */
  useEffect(() => {
    if (!/^#chat-msg-[0-9a-f-]+$/i.test(hash)) return;
    const destino = document.getElementById(hash.slice(1));
    if (!destino) return;
    destino.dataset.destacado = 'true';
    /* Quem chega pelo link da menção está lendo AQUELA mensagem: sair do "pé"
       impede que uma imagem carregando depois o arraste para o fim (F09). */
    noPeRef.current = false;
    destino.scrollIntoView({ block: 'center', behavior: comportamentoDeRolagem() });
    return () => {
      delete destino.dataset.destacado;
    };
  }, [hash, mensagens, conversationId]);

  useEffect(() => live.aoPrecisarAlcance(() => void alcançarOQueFaltou()), [live, alcançarOQueFaltou]);

  useEffect(() => {
    return live.aoEvento((evento: ChatLiveEvent) => {
      if (evento.type === 'conversation_read') {
        setConversas((atual) =>
          atual
            ? zerarNaoLidasDaConversa(atual, evento.conversationId).map((c) =>
                c.id === evento.conversationId
                  ? { ...c, lastReadAt: evento.readAt, unreadCount: 0 }
                  : c,
              )
            : atual,
        );
        if (evento.conversationId === conversaAbertaRef.current) {
          lastReadRef.current = evento.readAt;
          if (eu != null && evento.personId !== eu) {
            setPeerLastReadAt((atual) =>
              !atual || evento.readAt > atual ? evento.readAt : atual,
            );
          }
        }
        return;
      }
      if (
        evento.type === 'conversation_created' ||
        evento.type === 'conversation_changed' ||
        evento.type === 'conversation_left'
      ) {
        void lerConversas();
        if (evento.type === 'conversation_left' && evento.conversationId === conversaAbertaRef.current) {
          setAvisoEstrutura('Você saiu desta conversa — ou foi removido dela.');
          setPainelMembros(false);
          navigate('/chat', { replace: true });
        }
        return;
      }
      if (evento.type === 'chat_reaction') {
        // Reação de conversa que não está aberta não tem bolha para atualizar.
        if (evento.conversationId !== conversaAbertaRef.current) return;
        setReacoes((atual) =>
          definirReacao(atual, {
            messageId: evento.messageId,
            actorId: evento.actorId,
            emoji: evento.removed ? null : evento.emoji,
            reactedAt: evento.reactedAt,
          }),
        );
        return;
      }
      if (
        evento.type !== 'message_new' &&
        evento.type !== 'message_edited' &&
        evento.type !== 'message_deleted'
      ) {
        return;
      }
      const msg = evento.message;
      if (msg.conversationId !== conversaAbertaRef.current) {
        void lerConversas();
        return;
      }
      setMensagens((atual) => aplicarMensagem(atual, msg));
      sinceRef.current =
        msg.createdAt > sinceRef.current ? msg.createdAt : sinceRef.current;
      void lerConversas();
      if (evento.type === 'message_new') {
        const sessao = sessaoHistoricoRef.current;
        if (noPeRef.current) {
          requestAnimationFrame(() => {
            if (sessaoHistoricoRef.current !== sessao) return;
            const el = fioRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          });
          tentarMarcarLida(msg.conversationId, msg.createdAt);
        } else {
          setTemNovas(true);
        }
      }
    });
  }, [live, lerConversas, navigate, tentarMarcarLida, eu]);

  // Esc fecha a barra dos seis emojis, de onde quer que o foco esteja.
  useEffect(() => {
    if (!barraDeReacao) return;
    /* A barra é desenhada ANTES do botão "Reagir" (ela mora dentro do balão, e
       o botão vem depois): o Tab seguinte passaria direto por ela, para Editar.
       Levar o foco ao primeiro emoji é o que faz "só teclado" alcançar a barra
       indo para frente, e não só com Shift+Tab. */
    const bolha = document.getElementById(`chat-msg-${barraDeReacao}`);
    bolha?.querySelector<HTMLButtonElement>('.ch-barra-emoji')?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setBarraDeReacao(null);
      // Esc devolve o foco a quem abriu; sem isso ele cai no começo da página.
      bolha?.querySelector<HTMLButtonElement>('.c-acoes .c-acao')?.focus();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [barraDeReacao]);

  /* MEMBROS FECHA PELO TECLADO — F08. Sobreposto (sem folga para a terceira
     faixa), o painel cobre a leitura: abre com o foco nele, `Esc` fecha de onde
     o foco estiver e o foco volta ao botão Membros. Ao lado (faixa larga), ele
     não cobre nada: o foco fica onde a pessoa estava, e `Esc` fecha quando o
     foco está dentro dele. Balão aberto (Novo grupo…) fecha primeiro. */
  const membrosSobrepostos = faixa !== 'larga';
  const sobrepostosRef = useRef(membrosSobrepostos);
  sobrepostosRef.current = membrosSobrepostos;
  const fecharMembros = useCallback(() => {
    setPainelMembros(false);
    botaoMembrosRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!painelMembros) return;
    if (sobrepostosRef.current) document.getElementById('ch-membros')?.focus();
  }, [painelMembros]);
  useEffect(() => {
    if (!painelMembros) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.cu-balao')) return;
      const dentro = document.getElementById('ch-membros')?.contains(document.activeElement);
      if (!sobrepostosRef.current && !dentro) return;
      e.preventDefault();
      fecharMembros();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [painelMembros, fecharMembros]);

  // Ao voltar o foco na aba com a conversa aberta e no pé, marca o que ficou.
  useEffect(() => {
    const aoFoco = () => {
      const id = conversaAbertaRef.current;
      if (!id || !noPeRef.current) return;
      if (!podeMarcarComoLida(true, abaEstaComFoco())) return;
      const ultimo = sinceRef.current;
      if (ultimo) tentarMarcarLida(id, ultimo);
    };
    window.addEventListener('focus', aoFoco);
    document.addEventListener('visibilitychange', aoFoco);
    return () => {
      window.removeEventListener('focus', aoFoco);
      document.removeEventListener('visibilitychange', aoFoco);
    };
  }, [tentarMarcarLida]);

  const carregarAnteriores = useCallback(async () => {
    const sessao = sessaoHistoricoRef.current;
    if (!conversationId || parede || mensagens.length === 0 ||
      historicoEmVooRef.current === sessao || anterioresEmVooRef.current === sessao) return;
    const maisAntiga = mensagens.find((m) => !m.id.startsWith('local:'));
    if (!maisAntiga) return;
    anterioresEmVooRef.current = sessao;
    setCarregandoMais(true);
    const atual = () => sessaoHistoricoRef.current === sessao && conversaAbertaRef.current === conversationId;
    try {
      const r = await api.chatMensagens(conversationId, {
        beforeAt: maisAntiga.createdAt,
        beforeId: maisAntiga.id,
      });
      if (!atual()) return;
      const el = fioRef.current;
      if (el) {
        const topo = el.getBoundingClientRect().top;
        const visivel = Array.from(el.querySelectorAll<HTMLElement>('.c-fala[id]'))
          .find((m) => m.getBoundingClientRect().bottom > topo);
        ancoraRef.current = {
          sessao, id: visivel?.id, topo: visivel?.getBoundingClientRect().top ?? 0,
          altura: el.scrollHeight, rolagem: el.scrollTop,
        };
      }
      if (r.messages.length < PAGINA) setParede(true);
      setMensagens((atual) => {
        const ids = new Set(atual.map((m) => m.id));
        const novas = r.messages.map(comoTela).filter((m) => !ids.has(m.id));
        return [...novas, ...atual];
      });
      const chegaram = r.reactions ?? [];
      if (chegaram.length > 0) {
        setReacoes((atual) => {
          let proxima: ReacaoNaTela[] = atual;
          for (const x of chegaram) proxima = definirReacao(proxima, { ...x, emoji: x.emoji });
          return proxima;
        });
      }
    } catch (e) {
      if (atual() && !semSessao(e)) {
        setErro(fraseApi(e, 'Não foi possível carregar mensagens antigas.'));
      }
    } finally {
      if (atual()) {
        anterioresEmVooRef.current = null;
        setCarregandoMais(false);
      }
    }
  }, [conversationId, parede, mensagens]);

  const aoRolar = () => {
    const el = fioRef.current;
    if (!el) return;
    const distanciaDoPe = el.scrollHeight - el.scrollTop - el.clientHeight;
    noPeRef.current = distanciaDoPe < 80;
    if (noPeRef.current) {
      setTemNovas(false);
      if (conversationId && sinceRef.current) {
        tentarMarcarLida(conversationId, sinceRef.current);
      }
    }
    if (el.scrollTop < 80) void carregarAnteriores();
  };

  const irParaNovas = () => {
    const el = fioRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    noPeRef.current = true;
    setTemNovas(false);
    if (conversationId && sinceRef.current) {
      tentarMarcarLida(conversationId, sinceRef.current);
    }
  };

  const pedirEnderecosDoChat = useCallback(
    (ids: readonly string[]) => api.enderecosDasImagensDoChat(ids),
    [],
  );

  const enviarComChave = async (corpo: string, clientKey: string, imageIds: string[] = []) => {
    if (!conversationId || !sessao) return;
    /* A resposta volta para a conversa que ENVIOU: se a pessoa trocou de
       conversa no meio da viagem, a confirmação não entra no histórico da
       outra (F09). A lista de conversas se atualiza do mesmo jeito. */
    const sessaoDoEnvio = sessaoHistoricoRef.current;
    const mesmaConversa = () =>
      sessaoHistoricoRef.current === sessaoDoEnvio && conversaAbertaRef.current === conversationId;
    const otimista = mensagemOtimista({
      conversationId,
      authorId: sessao.userId,
      body: corpo,
      clientKey,
      agoraIso: new Date().toISOString(),
    });
    setMensagens((atual) => {
      const sem = atual.filter((m) => m.clientKey !== clientKey);
      return [...sem, otimista];
    });
    requestAnimationFrame(() => {
      const el = fioRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      noPeRef.current = true;
      setTemNovas(false);
    });
    try {
      const r = await api.chatEnviar(conversationId, corpo, clientKey, imageIds);
      void lerConversas();
      if (!mesmaConversa()) return;
      setMensagens((atual) => reconciliarEnvio(atual, r.message));
      if (r.message.createdAt > sinceRef.current) sinceRef.current = r.message.createdAt;
    } catch (e) {
      if (!mesmaConversa()) return;
      setMensagens((atual) =>
        marcarFalha(atual, clientKey, fraseApi(e, 'Não foi possível enviar.')),
      );
    }
  };

  const anexarImagens = async (arquivos: File[]) => {
    if (!conversationId || subindoImagem) return;
    setSubindoImagem(true);
    setAvisoImagem(null);
    const origem = conversationId;
    try {
      const { ids, erros } = await enviarImagensDoChat(conversationId, arquivos);
      /* A imagem subiu para a conversa de ORIGEM: não vai parar no rascunho
         de outra conversa aberta no meio do envio. */
      if (conversaAbertaRef.current !== origem) return;
      if (erros.length) setAvisoImagem(erros.join(' · '));
      if (ids.length) {
        setTexto(
          juntarTextoEImagens(textoSemImagens(textoAtual.current), [
            ...imagensDoTexto(textoAtual.current),
            ...ids,
          ]),
        );
      }
    } finally {
      setSubindoImagem(false);
    }
  };

  const enviar = () => {
    if (!conversationId || !sessao || subindoImagem) return;
    const ids = imagensDoTexto(texto);
    const corpoTexto = textoSemImagens(texto).trim();
    if (!corpoTexto && ids.length === 0) return;
    const corpo = juntarTextoEImagens(corpoTexto, ids);
    if (corpo.length > CHAT_BODY_MAX) {
      setAvisoTeto(
        `A mensagem passa do teto de ${CHAT_BODY_MAX} caracteres (${corpo.length}). Encurte antes de enviar.`,
      );
      return;
    }
    setAvisoTeto(null);
    setAvisoImagem(null);
    setTexto('');
    void enviarComChave(corpo, crypto.randomUUID(), ids);
  };

  const tentarDeNovo = (m: MensagemNaTela) => {
    if (!m.clientKey || m.estado !== 'falha') return;
    void enviarComChave(m.body, m.clientKey, imagensDoTexto(m.body));
  };

  const salvarEdicao = async (id: string) => {
    const original = mensagens.find((m) => m.id === id);
    const ids = original ? imagensDoTexto(original.body) : [];
    const corpoTexto = rascunhoEdicao.trim();
    if (!corpoTexto && ids.length === 0) return;
    const corpo = juntarTextoEImagens(corpoTexto, ids);
    if (corpo.length > CHAT_BODY_MAX) {
      setAvisoTeto(
        `A mensagem passa do teto de ${CHAT_BODY_MAX} caracteres (${corpo.length}). Encurte antes de salvar.`,
      );
      return;
    }
    const sessaoDaEdicao = sessaoHistoricoRef.current;
    try {
      const r = await api.chatEditar(id, corpo);
      if (sessaoHistoricoRef.current !== sessaoDaEdicao) return;
      setMensagens((atual) => aplicarMensagem(atual, r.message));
      setEditandoId(null);
      setAvisoTeto(null);
    } catch (e) {
      setErro(fraseApi(e, 'Não foi possível editar.'));
    }
  };

  const apagar = async (id: string) => {
    const certeza = window.confirm('Apagar esta mensagem? Quem já leu verá que ela foi apagada.');
    if (!certeza) return;
    const sessaoDoApagar = sessaoHistoricoRef.current;
    try {
      const r = await api.chatApagar(id);
      if (sessaoHistoricoRef.current !== sessaoDoApagar) return;
      setMensagens((atual) => aplicarMensagem(atual, r.message));
    } catch (e) {
      setErro(fraseApi(e, 'Não foi possível apagar.'));
    }
  };

  /**
   * Reagir é otimista, como o envio: o rodapé muda no mesmo toque e volta ao
   * que era se a API recusar, mostrando a frase da recusa.
   */
  const reagir = async (messageId: string, emoji: string) => {
    if (!sessao) return;
    setBarraDeReacao(null);
    const euId = sessao.userId;
    const agora = new Date().toISOString();
    const antes = reacoesAtuais.current;
    /* Só a MINHA reação de antes — é tudo o que a recusa precisa devolver. */
    const minhaDeAntes = {
      messageId,
      actorId: euId,
      emoji: minhaReacao(antes, messageId, euId),
      reactedAt: antes.find((r) => r.messageId === messageId && r.actorId === euId)
        ?.reactedAt ?? agora,
    };
    const chave = chaveDaReacao(messageId, euId);
    emVooRef.current.add(chave);
    setReacoes(
      alternarReacaoLocal(antes, { messageId, actorId: euId, emoji, reactedAt: agora }).lista,
    );
    try {
      const r = await api.chatReagir(messageId, emoji);
      setReacoes((atual) =>
        definirReacao(atual, {
          messageId: r.reaction.messageId,
          actorId: r.reaction.actorId,
          emoji: r.reaction.removed ? null : r.reaction.emoji,
          reactedAt: r.reaction.reactedAt,
        }),
      );
    } catch (e) {
      /* Desfaz SÓ o meu palpite: voltar a lista inteira apagaria a reação que
         outra pessoa mandou pelo evento ao vivo enquanto isto ia e voltava. */
      setReacoes((atual) => desfazerPalpite(atual, minhaDeAntes));
      setErro(fraseApi(e, 'Não foi possível reagir. Tente de novo.'));
    } finally {
      emVooRef.current.delete(chave);
    }
  };

  /* Toque longo na bolha abre a barra no celular. O `pressionada` some com o
     dedo e serve só para o CSS suspender a seleção de texto durante a espera —
     sem isso o Android já sai marcando a mensagem inteira. */
  const comecarToque = (id: string, tipo: string, ponto: { x: number; y: number }) => {
    ultimoPonteiro.current = tipo;
    if (tipo !== 'touch') return;
    origemDoToque.current = ponto;
    setPressionada(id);
    if (toqueRef.current) window.clearTimeout(toqueRef.current);
    toqueRef.current = window.setTimeout(() => {
      window.getSelection()?.removeAllRanges();
      setBarraDeReacao(id);
      setAtivaId(id);
      setPressionada(null);
    }, 450);
  };

  const soltarToque = () => {
    if (toqueRef.current) window.clearTimeout(toqueRef.current);
    toqueRef.current = null;
    origemDoToque.current = null;
    setPressionada(null);
  };

  /* Andar um pouco NÃO cancela: só sai do toque longo quem passa da tolerância
     (ver `TOLERANCIA_DO_TOQUE_PX`) — aí o gesto virou rolagem. */
  const moverToque = (ponto: { x: number; y: number }) => {
    if (toqueRef.current === null) return;
    if (saiuDoToqueLongo(origemDoToque.current, ponto)) soltarToque();
  };

  /* TOCAR A BOLHA MOSTRA AS AÇÕES — F09. No ponteiro, Reagir/Editar/Apagar
     aparecem no hover e no foco; no toque não há hover, e deixá-las impressas
     sob cada bolha era a folga que sobrava embaixo de todas. Um toque curto
     (fora de link e botão) mostra as ações daquela bolha; tocar fora esconde. */
  const tocarBolha = (id: string, alvo: EventTarget) => {
    if (ultimoPonteiro.current !== 'touch') return;
    if (alvo instanceof Element && alvo.closest('a, button, [contenteditable="true"]')) return;
    if (window.getSelection()?.toString()) return;
    setAtivaId((a) => (a === id ? null : id));
  };
  useEffect(() => {
    if (!ativaId) return;
    const fora = (e: PointerEvent) => {
      const bolha = document.getElementById(`chat-msg-${ativaId}`);
      if (bolha && e.target instanceof Node && bolha.contains(e.target)) return;
      setAtivaId(null);
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [ativaId]);

  /* FECHAR DEVOLVE O FOCO AO BOTÃO — F33. O balão agora mora em
     `document.body`; fechado pelo `Esc` ou pelo `X`, o foco cairia no `<body>`
     e quem navega pelo teclado recomeçaria do topo da página. */
  const fecharCaixa = () => {
    const botao = caixa === 'grupo' ? botaoGrupo : caixa === 'direta' ? botaoDireta : null;
    setCaixa(null);
    botao?.focus();
  };

  /* O BALÃO NÃO FICA ÓRFÃO — F33. Em portal, o balão segue o botão na rolagem,
     mas quando o botão sai de vista (a `.ch-lista` rolou, ou a página) o
     `Balao` o prende na borda da janela: medido a 390×844 com a lista rolada
     400px, ele ficava pregado no topo, por cima de "Listas e atalhos", longe
     do botão escondido. Preso ao botão, como era antes, ele sumia junto; aqui
     ele fecha. Sem devolver o foco: `focus()` rolaria o botão de volta. */
  useEffect(() => {
    const botao = caixa === 'grupo' ? botaoGrupo : caixa === 'direta' ? botaoDireta : null;
    if (!botao) return;
    const aoRolar = () => {
      const b = botao.getBoundingClientRect();
      const lista = botao.closest('.ch-lista')?.getBoundingClientRect();
      const topo = Math.max(0, lista?.top ?? 0);
      const base = Math.min(window.innerHeight, lista?.bottom ?? window.innerHeight);
      if (b.bottom <= topo || b.top >= base) setCaixa(null);
    };
    window.addEventListener('scroll', aoRolar, true);
    return () => window.removeEventListener('scroll', aoRolar, true);
  }, [caixa, botaoGrupo, botaoDireta]);

  const comEstrutura = async (fn: () => Promise<void>) => {
    setSalvandoEstrutura(true);
    try {
      await fn();
    } finally {
      setSalvandoEstrutura(false);
    }
  };

  const criarGrupo = async (nome: string, memberIds: string[]) => {
    await comEstrutura(async () => {
      const r = await api.chatCriarGrupo(nome, memberIds);
      setCaixa(null);
      await lerConversas();
      navigate(`/chat/${r.id}`);
    });
  };

  const abrirDireta = async (userId: string) => {
    await comEstrutura(async () => {
      const r = await api.chatAbrirDireta(userId);
      setCaixa(null);
      await lerConversas();
      navigate(`/chat/${r.id}`);
    });
  };

  // Desligado: avisa na hora, sem esperar a sessão. Piloto sem super: espera
  // a sessão carregar para não piscar o aviso no super admin.
  const chatRecusado =
    modoDoChat() === 'desligado' || (!carregando && !chatOk);

  if (chatRecusado) {
    return (
      <PaginaLarga>
        <TelaComBarra>
          <Topo titulo={ROTULO_DO_ITEM.chat} variante="compacta" />
          {/* F09: não é alarme — é o lugar dizendo que não está aberto para
              esta pessoa, e para onde ir. */}
          <EstadoDaPagina
            tipo="sem-acesso"
            titulo="O chat não está disponível para você"
            acao={{ rotulo: 'Ir para Minhas tarefas', para: '/meu-trabalho' }}
          >
            O chat está desligado nesta instalação, ou você ainda não entra no piloto.
          </EstadoDaPagina>
        </TelaComBarra>
      </PaginaLarga>
    );
  }

  const primeiraNovaId = idDaPrimeiraNova(mensagens, lastReadRef.current, eu);
  const diretaBloqueada =
    aberta?.kind === 'direct' && aberta.peerIsActive === false;
  const conversaForaDaLista =
    Boolean(conversationId) && conversas !== null && !aberta;
  /* A saída de quem perdeu o acesso: o Geral, que é de toda a equipe. O
     "‹ Conversas" do cabeçalho segue sendo a volta à lista no celular. */
  const geralId = conversas?.find((c) => c.kind === 'general')?.id;
  const irAoGeral =
    geralId && geralId !== conversationId ? { rotulo: 'Abrir o Geral', para: `/chat/${geralId}` } : undefined;

  return (
    /* O TOPO — F29 (Fase 4). Tela principal: só o título, sem trilha e sem
       Voltar. Até aqui a moldura desenhava `‹ Voltar` para o Painel (`acima`),
       um "acima" que o Chat não tem — ele é irmão do Painel, e o caminho entre
       os dois é a barra. */
    <PaginaLarga altura="tela" className="ch-pagina">
      <TelaComBarra atual="chat" contexto="chat" altura="tela">
        {/* F08: o título da página continua sendo o `<h1>` e o alvo do "Pular
            para o conteúdo", mas não gasta uma faixa inteira repetindo "Chat":
            quem diz onde se está é o cabeçalho de Conversas e o da conversa. */}
        <Topo titulo={ROTULO_DO_ITEM.chat} variante="compacta" className="ch-topo" />
        {(erro || falhouLerConversas) && (
          <div className="mb-3">
            {/* "Tentar de novo" só quando é a LISTA que falhou — o aviso das
                outras falhas (editar, apagar, reagir) tem o próprio caminho. */}
            <Aviso
              tipo="erro"
              acao={falhouLerConversas ? { rotulo: 'Tentar de novo', aoClicar: () => void lerConversas() } : undefined}
            >
              {erro ?? 'Não foi possível carregar as conversas.'}
            </Aviso>
          </div>
        )}
        {avisoEstrutura && (
          <div className="mb-3">
            <Aviso tipo="atencao">{avisoEstrutura}</Aviso>
          </div>
        )}
        <div
          className="ch-grade"
          ref={gradeRef}
          data-conversa-aberta={Boolean(conversationId)}
          data-faixa={faixa}
        >
          <aside className="ch-lista" aria-labelledby="ch-lista-titulo">
            <div className="ch-lista-cabeca">
              <h2 className="ch-lista-titulo" id="ch-lista-titulo">Conversas</h2>
              <div className="ch-lista-acoes">
                <span className="ch-lista-acoes-wrap">
                  <button
                    ref={setBotaoDireta}
                    type="button"
                    className="o-btn ch-criar"
                    /* O nome inteiro é o acessível; à vista, "+ Conversa" — o
                       texto visível está contido no nome (WCAG 2.5.3) e cabe
                       na lista de 240 px sem reticências. */
                    aria-label="Nova conversa"
                    aria-expanded={caixa === 'direta'}
                    onClick={() => setCaixa((c) => (c === 'direta' ? null : 'direta'))}
                  >
                    <IconeMais />
                    <span>Conversa</span>
                  </button>
                  {caixa === 'direta' && (
                    <NovaDireta
                      pessoas={diretorio}
                      euId={eu}
                      salvando={salvandoEstrutura}
                      ancora={botaoDireta}
                      aoFechar={fecharCaixa}
                      aoAbrir={abrirDireta}
                    />
                  )}
                </span>
                <span className="ch-lista-acoes-wrap">
                  <button
                    ref={setBotaoGrupo}
                    type="button"
                    className="o-btn ch-criar"
                    aria-label="Novo grupo"
                    aria-expanded={caixa === 'grupo'}
                    onClick={() => setCaixa((c) => (c === 'grupo' ? null : 'grupo'))}
                  >
                    <IconeMais />
                    <span>Grupo</span>
                  </button>
                  {caixa === 'grupo' && (
                    <NovoGrupo
                      pessoas={diretorio}
                      euId={eu}
                      salvando={salvandoEstrutura}
                      ancora={botaoGrupo}
                      aoFechar={fecharCaixa}
                      aoCriar={criarGrupo}
                    />
                  )}
                </span>
              </div>
            </div>
            <nav className="ch-lista-itens" aria-label="Lista de conversas">
            {conversas === null && !falhouLerConversas && <p className="ch-vazio" role="status">Carregando conversas…</p>}
            {conversas !== null && listaOrdenada.length === 0 && (
              <p className="ch-vazio">Nenhuma conversa ainda. Comece uma em Nova conversa.</p>
            )}
            {listaOrdenada.map((c) => {
              const nome = nomeDaConversa(c);
              const selo = seloDeNaoLidas(c.unreadCount);
              const atual = c.id === conversationId;
              const quando = horarioDaConversa(c.lastMessage?.at);
              return (
                <Link
                  key={c.id}
                  to={`/chat/${c.id}`}
                  className="ch-item"
                  data-atual={atual}
                  data-kind={c.kind}
                  data-nao-lidas={selo ? 'true' : undefined}
                  aria-current={atual ? 'page' : undefined}
                  title={nome}
                  onClick={() => setAvisoEstrutura(null)}
                >
                  <RostoDaConversa conversa={c} />
                  <span className="ch-item-texto">
                    <span className="ch-item-linha">
                      <span className="ch-item-nome">{nome}</span>
                      {quando && (
                        <time className="ch-item-quando tnum" dateTime={c.lastMessage?.at ?? undefined}>
                          {quando}
                        </time>
                      )}
                    </span>
                    <span className="ch-item-linha">
                      <span className="ch-item-previa">{previaDaConversa(c)}</span>
                      {selo && (
                        <span className="ch-item-selo tnum">
                          {selo}
                          <span className="sr-only">{c.unreadCount === 1 ? ' não lida' : ' não lidas'}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              );
            })}
            </nav>
          </aside>

          <section className="ch-painel" aria-label="Conversa">
            {conversationId && (
              <header className="ch-painel-cabeca">
                <Link to="/chat" className="o-btn o-btn-fantasma ch-voltar" aria-label="Voltar às conversas">
                  {/* A seta em texto, como antes da F08: é a troca lista ↔ conversa
                      da faixa de uma área (§3.3), e não um voltar de página — a
                      regra de `toda-tela-diz-onde-esta` barra o ícone em Link. */}
                  <span className="ch-voltar-seta" aria-hidden="true">‹</span>
                  <span className="ch-voltar-rotulo" aria-hidden="true">Conversas</span>
                </Link>
                {aberta && <RostoDaConversa conversa={aberta} grande />}
                <span className="ch-painel-identidade">
                  <h2 className="ch-painel-nome" title={aberta ? nomeDaConversa(aberta) : undefined}>
                    {aberta ? nomeDaConversa(aberta) : 'Conversa'}
                  </h2>
                  {aberta && (
                    <span className="ch-painel-sobre">
                      <span className="ch-painel-sobre-texto">{sobreAConversa(aberta)}</span>
                      {/* O estado REAL do gerente, e só quando falta (F09). */}
                      <span
                        className="ch-conexao"
                        role="status"
                        title={reconectando ? 'Sem tempo real agora: mensagens novas podem atrasar. O envio continua funcionando.' : undefined}
                      >
                        {reconectando && (
                          <>
                            <span className="ch-conexao-ponto" aria-hidden="true" />
                            Reconectando…
                            <span className="sr-only"> Mensagens novas podem atrasar; o envio continua funcionando.</span>
                          </>
                        )}
                      </span>
                    </span>
                  )}
                </span>
                {aberta && (aberta.kind === 'group' || aberta.kind === 'general') && (
                  <button
                    ref={botaoMembrosRef}
                    type="button"
                    className="o-btn o-btn-fantasma ch-membros-botao"
                    aria-expanded={painelMembros}
                    aria-controls={painelMembros ? 'ch-membros' : undefined}
                    data-aberto={painelMembros}
                    onClick={() => (painelMembros ? fecharMembros() : setPainelMembros(true))}
                  >
                    <IconePessoas />
                    <span>{painelMembros ? 'Ocultar membros' : 'Membros'}</span>
                  </button>
                )}
              </header>
            )}
            {conversationId && conversas === null ? (
              <div className="ch-painel-estado">
                {falhouLerConversas ? (
                  /* A lista não chegou: não dá para dizer que a conversa não
                     existe nem que falta acesso. O aviso de cima tem o botão. */
                  <EstadoDaPagina tipo="vazio" titulo="Esta conversa ainda não abriu">
                    A lista de conversas não carregou. Use “Tentar de novo” no aviso acima.
                  </EstadoDaPagina>
                ) : (
                  <EstadoDaPagina tipo="carregando" titulo="Carregando a conversa…" />
                )}
              </div>
            ) : conversaForaDaLista ? (
              <div className="ch-painel-estado">
                <EstadoDaPagina
                  tipo="sem-acesso"
                  titulo="Esta conversa não está disponível para você"
                  acao={irAoGeral}
                >
                  {falhaHistorico?.frase ??
                    'Você pode ter saído dela, ou ela não inclui você.'}
                </EstadoDaPagina>
              </div>
            ) : !conversationId || !aberta ? (
              <div className="ch-painel-estado">
                <EstadoDaPagina tipo="vazio" titulo="Escolha uma conversa">
                  Abra uma conversa na lista, ou comece uma nova em + Conversa.
                </EstadoDaPagina>
              </div>
            ) : (
              <>
                {/* DESTINO DE NOTIFICAÇÃO QUE NÃO ESTÁ AQUI — F10. O link da caixa
                    aponta `#chat-msg-<id>`; se o histórico lido não tem essa
                    mensagem (apagada, ou antes das carregadas), a conversa abre
                    normal e esta linha diz por que nada foi destacado. Não mostra
                    nada da mensagem: só o que a pessoa já alcança. */}
                {alvoAusente && (
                  <p className="ch-alvo-ausente" role="status" data-alvo-ausente="">
                    {parede
                      ? 'A mensagem desta notificação não está mais disponível: ela pode ter sido apagada.'
                      : 'A mensagem desta notificação não está entre as mostradas: ela pode ter sido apagada ou ser mais antiga — role para cima para ver as anteriores.'}
                  </p>
                )}
                <div className="ch-painel-corpo">
                  <div className="ch-fio-wrap" ref={fioRef} onScroll={aoRolar}>
                    {parede && mensagens.length > 0 && (
                      <p className="ch-parede" data-parede="30-dias">
                        {FRASE_PAREDE_30_DIAS}
                      </p>
                    )}
                    {carregandoMais && <p className="ch-carregando" role="status">Carregando mensagens anteriores…</p>}
                    {mensagens.length === 0 && (
                      <div className="ch-fio-estado">
                        {falhaHistorico?.tipo === 'acesso' ? (
                          <EstadoDaPagina
                            tipo="sem-acesso"
                            titulo="Você não tem mais acesso a esta conversa"
                            acao={irAoGeral}
                          >
                            {falhaHistorico.frase}
                          </EstadoDaPagina>
                        ) : falhaHistorico ? (
                          <EstadoDaPagina
                            tipo="erro"
                            titulo={falhaHistorico.frase}
                            acao={{ rotulo: 'Tentar de novo', aoClicar: () => void lerHistorico(aberta.id) }}
                          />
                        ) : lendoHistorico ? (
                          <EstadoDaPagina tipo="carregando" titulo="Carregando mensagens…" linhas={4} />
                        ) : (
                          <EstadoDaPagina
                            tipo="vazio"
                            titulo={
                              aberta.kind === 'direct'
                                ? `Nenhuma mensagem com ${nomeDaConversa(aberta)} ainda`
                                : 'Nenhuma mensagem por aqui ainda'
                            }
                          >
                            {diretaBloqueada
                              ? 'Esta pessoa foi desativada; não dá para começar a conversa.'
                              : `Escreva a primeira no campo abaixo. ${FRASE_PAREDE_30_DIAS}.`}
                          </EstadoDaPagina>
                        )}
                      </div>
                    )}
                    <div className="c-fio ch-fio">
                      {blocos.map((b) => {
                        if (b.tipo === 'dia') {
                          return (
                            <div key={`dia-${b.chave}`} className="ch-dia" role="separator" aria-label={b.rotulo}>
                              <span className="ch-dia-rotulo">{b.rotulo}</span>
                            </div>
                          );
                        }
                        if (b.tipo === 'sistema') {
                          return (
                            <p key={b.mensagem.id} className="ch-sistema">
                              {b.mensagem.body}
                            </p>
                          );
                        }
                        const m = b.mensagem as MensagemNaTela;
                        const minha = eu != null && m.authorId === eu;
                        const hora = horaDaMensagem(m.createdAt);
                        const instante = instanteDaMensagem(m.createdAt) ?? undefined;
                        const autor = nomeDoAutor(m.authorId, mapaNomes, eu);
                        /* Reagir vale para QUALQUER mensagem — a minha e a dos
                           outros. O que não se reage é lápide, linha de sistema
                           (que nem chega aqui) e mensagem ainda em voo. */
                        const reagivel =
                          m.estado === 'confirmada' && !m.deletedAt && editandoId !== m.id;
                        const grupos = reacoesPorMensagem.get(m.id) ?? [];
                        const soImagem =
                          !m.deletedAt && textoSemImagens(m.body).trim() === '' && imagensDoTexto(m.body).length > 0;
                        return (
                          <div key={m.id} className="ch-linha" data-minha={minha} data-seguida={!b.primeiraDoAutor}>
                            {primeiraNovaId === m.id && (
                              <div className="ch-divisor-novas" data-divisor="novas">
                                novas mensagens
                              </div>
                            )}
                            <div
                              className="c-fala"
                              data-minha={minha}
                              /* Mensagem seguida do mesmo autor não repete o
                                 avatar nem o nome; o vão do avatar fica
                                 reservado para a coluna não sair torta. */
                              data-seguida={!b.primeiraDoAutor}
                              data-estado={m.estado}
                              data-pressionada={pressionada === m.id}
                              data-ativa={ativaId === m.id || barraDeReacao === m.id}
                              id={`chat-msg-${m.id}`}
                              onPointerDown={
                                reagivel
                                  ? (e) =>
                                      comecarToque(m.id, e.pointerType, {
                                        x: e.clientX,
                                        y: e.clientY,
                                      })
                                  : undefined
                              }
                              onPointerUp={reagivel ? soltarToque : undefined}
                              onPointerMove={
                                reagivel
                                  ? (e) => moverToque({ x: e.clientX, y: e.clientY })
                                  : undefined
                              }
                              onPointerCancel={reagivel ? soltarToque : undefined}
                              onClick={reagivel ? (e) => tocarBolha(m.id, e.target) : undefined}
                            >
                              {/* A minha não leva rosto: o lado já diz quem fala. */}
                              {b.primeiraDoAutor && !minha && (
                                <Avatar pessoa={{ id: m.authorId ?? m.id, name: autor }} />
                              )}
                              {!b.primeiraDoAutor && hora && (
                                /* O horário da fala seguida mora na calha, e
                                   aparece no hover e no foco (é lido sempre). */
                                <time className="ch-hora-calha tnum" dateTime={m.createdAt} title={instante}>
                                  {hora}
                                </time>
                              )}
                              <div className="c-corpo" data-so-imagem={soImagem || undefined}>
                                {b.primeiraDoAutor && !minha && (
                                  <div className="c-cabeca">
                                    <span className="c-autor">{autor}</span>
                                    {hora && (
                                      <time className="c-quando tnum" dateTime={m.createdAt} title={instante}>
                                        {hora}
                                      </time>
                                    )}
                                  </div>
                                )}
                                {m.deletedAt ? (
                                  <p className="ch-lapide">Mensagem apagada</p>
                                ) : editandoId === m.id ? (
                                  <div className="c-escrever c-escrever-resposta">
                                    <ProvedorDeMencoes conversationId={conversationId}>
                                      <CampoComMencoes
                                        aria-label="Editar mensagem"
                                        value={rascunhoEdicao}
                                        aoMudar={setRascunhoEdicao}
                                        rows={3}
                                      />
                                    </ProvedorDeMencoes>
                                    <div className="ch-escrever-acoes">
                                      <button
                                        type="button"
                                        className="o-btn o-btn-fantasma o-btn-sm"
                                        onClick={() => setEditandoId(null)}
                                      >
                                        Cancelar
                                      </button>
                                      <button
                                        type="button"
                                        className="o-btn o-btn-primario o-btn-sm"
                                        onClick={() => void salvarEdicao(m.id)}
                                      >
                                        Salvar
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="c-texto selecionavel">
                                    <Markdown fonte={m.body} pedirEnderecos={pedirEnderecosDoChat} />
                                  </div>
                                )}
                                {/* O pé: "editada", "Enviando…" e — na minha, que não
                                    tem cabeçalho — o nome (só para o leitor) e a hora. */}
                                {((minha) || b.primeiraDoAutor || m.estado === 'pendente' || (m.editedAt && !m.deletedAt)) && (
                                  <div className="ch-fala-pe">
                                    {minha && b.primeiraDoAutor && <span className="sr-only">{autor}</span>}
                                    {m.editedAt && !m.deletedAt && (
                                      <span
                                        className="c-editado"
                                        title={`Editada em ${instanteDaMensagem(m.editedAt) ?? ''}`}
                                      >
                                        editada
                                      </span>
                                    )}
                                    {m.estado === 'pendente' && (
                                      <span className="ch-envio" data-envio="pendente">
                                        <Clock3 aria-hidden="true" />
                                        Enviando…
                                      </span>
                                    )}
                                    {minha && hora && (
                                      <time className="c-quando tnum" dateTime={m.createdAt} title={instante}>
                                        {hora}
                                      </time>
                                    )}
                                    {minha && (
                                      <span
                                        className="ch-status-msg"
                                        data-status={statusVisualDaMensagem(m, peerLastReadAt)}
                                        title={
                                          statusVisualDaMensagem(m, peerLastReadAt) === 'pendente'
                                            ? 'Enviando…'
                                            : statusVisualDaMensagem(m, peerLastReadAt) === 'lida'
                                              ? 'Lida'
                                              : 'Entregue'
                                        }
                                      >
                                        {statusVisualDaMensagem(m, peerLastReadAt) === 'pendente' && (
                                          <Clock3 aria-hidden="true" />
                                        )}
                                        {statusVisualDaMensagem(m, peerLastReadAt) === 'enviada' && (
                                          <Check aria-hidden="true" />
                                        )}
                                        {statusVisualDaMensagem(m, peerLastReadAt) === 'entregue' && (
                                          <CheckCheck aria-hidden="true" />
                                        )}
                                        {statusVisualDaMensagem(m, peerLastReadAt) === 'lida' && (
                                          <CheckCheck aria-hidden="true" />
                                        )}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {grupos.length > 0 && (
                                  <div className="ch-reacoes">
                                    {grupos.map((g) => (
                                      <button
                                        key={g.emoji}
                                        type="button"
                                        className="ch-reacao"
                                        data-minha={g.minha}
                                        aria-pressed={g.minha}
                                        aria-label={rotuloDaReacao(g)}
                                        disabled={!reagivel}
                                        onClick={() => void reagir(m.id, g.emoji)}
                                      >
                                        <span aria-hidden="true">{g.emoji}</span>
                                        <span aria-hidden="true" className="tnum">
                                          {g.contagem}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {reagivel && barraDeReacao === m.id && (
                                  <div
                                    className="ch-barra-reacoes"
                                    role="group"
                                    aria-label="Escolha um emoji para reagir"
                                  >
                                    {EMOJIS_DE_REACAO.map((emoji) => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        className="ch-barra-emoji"
                                        aria-label={`Reagir com ${emoji}`}
                                        onClick={() => void reagir(m.id, emoji)}
                                      >
                                        <span aria-hidden="true">{emoji}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {reagivel && (
                                  /* A régua flutua sobre a borda da bolha: não
                                     reserva altura embaixo de cada mensagem. */
                                  <div className="c-acoes" role="group" aria-label={`Ações da mensagem de ${autor}`}>
                                    <button
                                      type="button"
                                      className="c-acao"
                                      aria-label="Reagir"
                                      title="Reagir"
                                      aria-expanded={barraDeReacao === m.id}
                                      onClick={() =>
                                        setBarraDeReacao((a) => (a === m.id ? null : m.id))
                                      }
                                    >
                                      <SmilePlus aria-hidden="true" />
                                    </button>
                                    {minha && (
                                      <>
                                        <button
                                          type="button"
                                          className="c-acao"
                                          aria-label="Editar"
                                          title="Editar"
                                          onClick={() => {
                                            setEditandoId(m.id);
                                            setRascunhoEdicao(textoSemImagens(m.body));
                                          }}
                                        >
                                          <Pencil aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          className="c-acao"
                                          data-perigo="true"
                                          aria-label="Apagar"
                                          title="Apagar"
                                          onClick={() => void apagar(m.id)}
                                        >
                                          <Trash2 aria-hidden="true" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            {m.estado === 'falha' && (
                              /* A falha fica COLADA na bolha e diz o que fazer.
                                 Tentar de novo reusa a mesma chave de envio: a
                                 mensagem não duplica, e texto e imagens seguem
                                 na bolha até a confirmação. */
                              <div className="ch-falha" data-falha="envio" role="alert">
                                <span className="ch-falha-frase">
                                  <CircleAlert aria-hidden="true" />
                                  <span>Não enviada. {m.erro ?? ''}</span>
                                </span>
                                <button
                                  type="button"
                                  className="o-btn o-btn-sm ch-falha-repetir"
                                  onClick={() => tentarDeNovo(m)}
                                >
                                  <RotateCw aria-hidden="true" />
                                  Tentar de novo
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {temNovas && (
                      <button type="button" className="o-btn o-btn-primario ch-novas" onClick={irParaNovas}>
                        <ArrowDown aria-hidden="true" className="ch-novas-seta" />
                        novas mensagens
                      </button>
                    )}
                  </div>
                  {painelMembros && (aberta.kind === 'group' || aberta.kind === 'general') && (
                    <PainelDoGrupo
                      kind={aberta.kind}
                      nome={nomeDaConversa(aberta)}
                      members={aberta.members}
                      myRole={aberta.myRole}
                      euId={eu}
                      isSuperadmin={sessao?.isSuperadmin ?? false}
                      diretorio={diretorio}
                      salvando={salvandoEstrutura}
                      sobreposto={membrosSobrepostos}
                      aoFechar={fecharMembros}
                      aoRenomear={async (nome) => {
                        await comEstrutura(async () => {
                          await api.chatRenomear(aberta.id, nome);
                          await lerConversas();
                        });
                      }}
                      aoAdicionar={async (userId) => {
                        await comEstrutura(async () => {
                          await api.chatAdicionarMembro(aberta.id, userId);
                          await lerConversas();
                        });
                      }}
                      aoRemover={async (userId) => {
                        await comEstrutura(async () => {
                          await api.chatRemoverMembro(aberta.id, userId);
                          await lerConversas();
                        });
                      }}
                      aoSair={async () => {
                        await comEstrutura(async () => {
                          await api.chatSair(aberta.id);
                          setAvisoEstrutura('Você saiu do grupo.');
                          setPainelMembros(false);
                          await lerConversas();
                          navigate('/chat', { replace: true });
                        });
                      }}
                      aoPassarPosse={async (userId) => {
                        await comEstrutura(async () => {
                          await api.chatPassarPosse(aberta.id, userId);
                          await lerConversas();
                        });
                      }}
                    />
                  )}
                </div>
                <div className="ch-escrever c-escrever">
                  {diretaBloqueada ? (
                    <Aviso tipo="atencao">
                      Esta pessoa foi desativada. Você ainda pode ler o histórico
                      até as mensagens vencerem; não dá para enviar novas.
                    </Aviso>
                  ) : falhaHistorico?.tipo === 'acesso' ? null : (
                    <>
                      {avisoTeto && <Aviso tipo="atencao">{avisoTeto}</Aviso>}
                      {avisoImagem && <Aviso tipo="atencao">{avisoImagem}</Aviso>}
                      {/* O COMPOSITOR — F09. Uma caixa só: clipe · campo · Enviar
                          na MESMA linha em qualquer largura (a 320 px o clipe e o
                          Enviar desciam para baixo do campo). As imagens do
                          rascunho entram como miniaturas no alto da caixa. */}
                      <div
                        className="c-editor-com-imagens ch-compositor"
                        data-arrastando={arrastando && !subindoImagem}
                        data-ocupado={subindoImagem || undefined}
                        onDragEnter={(e) => {
                          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
                          e.preventDefault();
                          entradasDeArrasto.current += 1;
                          setArrastando(!subindoImagem);
                        }}
                        onDragOver={(e) => {
                          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = subindoImagem ? 'none' : 'copy';
                        }}
                        onDragLeave={() => {
                          entradasDeArrasto.current = Math.max(0, entradasDeArrasto.current - 1);
                          if (entradasDeArrasto.current === 0) setArrastando(false);
                        }}
                        onDrop={(e) => {
                          entradasDeArrasto.current = 0;
                          setArrastando(false);
                          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const arquivos = Array.from(e.dataTransfer.files);
                          if (arquivos.length) void anexarImagens(arquivos);
                        }}
                      >
                        {arrastando && !subindoImagem && (
                          <span className="c-soltar-imagem">Solte as imagens para anexar</span>
                        )}
                        {(imagensDoTexto(texto).length > 0 || subindoImagem) && (
                          <div className="imagens-do-rascunho">
                            {imagensDoTexto(texto).map((id) => (
                              <div key={id} className="imagem-do-rascunho">
                                <Markdown
                                  fonte={imagemNoTexto(id)}
                                  pedirEnderecos={pedirEnderecosDoChat}
                                />
                                <button
                                  type="button"
                                  className="ch-remover-imagem"
                                  aria-label="Remover imagem"
                                  title="Remover imagem"
                                  disabled={subindoImagem}
                                  onClick={() =>
                                    setTexto(
                                      juntarTextoEImagens(
                                        textoSemImagens(texto),
                                        imagensDoTexto(texto).filter((x) => x !== id),
                                      ),
                                    )
                                  }
                                >
                                  <X aria-hidden="true" />
                                </button>
                              </div>
                            ))}
                            {subindoImagem && (
                              <span className="ch-subindo" role="status">
                                <span className="ch-subindo-giro" aria-hidden="true" />
                                Enviando imagem…
                              </span>
                            )}
                          </div>
                        )}
                        <div className="ch-compositor-linha">
                          <input
                            ref={entradaDeImagem}
                            type="file"
                            accept="image/png,image/jpeg"
                            multiple
                            hidden
                            disabled={subindoImagem}
                            aria-label="Selecionar imagens"
                            onChange={(e) => {
                              const arquivos = Array.from(e.target.files ?? []);
                              e.target.value = '';
                              if (arquivos.length) void anexarImagens(arquivos);
                            }}
                          />
                          <button
                            type="button"
                            className="ch-compositor-botao c-anexar-imagem"
                            aria-label="Anexar imagem"
                            disabled={subindoImagem}
                            title="Anexar imagem · PNG ou JPEG, até 5 MB"
                            onClick={() => entradaDeImagem.current?.click()}
                          >
                            <IconeClipe />
                          </button>
                          <ProvedorDeMencoes conversationId={conversationId}>
                            <CampoComMencoes
                              aria-label="Escrever mensagem"
                              aria-describedby="ch-escrever-dica"
                              className="c-caixa"
                              value={textoSemImagens(texto)}
                              disabled={subindoImagem}
                              aoMudar={(v) => {
                                setTexto(
                                  juntarTextoEImagens(v, imagensDoTexto(texto)),
                                );
                                if (v.length <= CHAT_BODY_MAX) setAvisoTeto(null);
                              }}
                              onPaste={(e) => {
                                if (subindoImagem) return;
                                const dados = e.clipboardData;
                                if (!dados) return;
                                const itens = Array.from(dados.items ?? []).map((i) => ({
                                  kind: i.kind,
                                  type: i.type,
                                }));
                                if (!deveAnexar(itens)) return;
                                const arquivos = Array.from(dados.files ?? []).filter((f) =>
                                  ehTipoQueSeCola(f.type),
                                );
                                if (arquivos.length === 0) return;
                                e.preventDefault();
                                void anexarImagens(arquivos);
                              }}
                              onKeyDown={(e) => {
                                /* IME (japonês, emoji do teclado, acento morto): o
                                   Enter que CONFIRMA a composição não envia. O
                                   `keyCode` 229 cobre o Safari, que solta o Enter
                                   da confirmação já com `isComposing` falso. */
                                if (
                                  e.key === 'Enter' &&
                                  !e.shiftKey &&
                                  !e.nativeEvent.isComposing &&
                                  e.nativeEvent.keyCode !== 229
                                ) {
                                  e.preventDefault();
                                  enviar();
                                }
                              }}
                              placeholder={
                                aberta.kind === 'direct'
                                  ? `Mensagem para ${nomeDaConversa(aberta)}`
                                  : `Mensagem em ${nomeDaConversa(aberta)}`
                              }
                            />
                          </ProvedorDeMencoes>
                          <button
                            type="button"
                            className="ch-compositor-botao ch-enviar"
                            aria-label="Enviar"
                            title="Enviar (Enter)"
                            disabled={
                              subindoImagem ||
                              (textoSemImagens(texto).trim() === '' &&
                                imagensDoTexto(texto).length === 0)
                            }
                            onClick={enviar}
                          >
                            <ArrowUp aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      {/* A dica mora FORA da caixa: é rodapé do campo, e some no
                          celular, onde o Enter do teclado virtual é outro. */}
                      <span className="ch-escrever-dica" id="ch-escrever-dica">
                        <span className="ch-escrever-dica-teclas">Enter envia · Shift+Enter quebra linha</span>
                        {textoSemImagens(texto).length > CHAT_BODY_MAX - 200 && (
                          <span className="ch-escrever-conta tnum" data-no-teto={textoSemImagens(texto).length > CHAT_BODY_MAX || undefined}>
                            {textoSemImagens(texto).length}/{CHAT_BODY_MAX}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </TelaComBarra>
    </PaginaLarga>
  );
}
