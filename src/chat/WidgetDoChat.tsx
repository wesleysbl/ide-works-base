/**
 * Widget Flutuante do Chat — F36.
 *
 * Popup estilo Messenger do Meta acessível de qualquer tela do sistema
 * (Quadro, Planejamento, Tarefas, Clientes, etc.), com balão flutuante,
 * badge de não lidas, lista de conversas, envio rápido e status de
 * mensagem estilo WhatsApp (checks e duplo check azul).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Check,
  CheckCheck,
  ChevronLeft,
  Clock3,
  ExternalLink,
  MessageSquare,
  Search,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import { useChatLive } from '@/chat/useChatLive';
import { aplicarMensagem, marcarFalha } from '@/chat/envio';
import { previaDaConversa } from '@/chat/lista';
import { horaDaMensagem, statusVisualDaMensagem, textoNaJanelinha } from '@/chat/mensagens';
import { abaEstaComFoco, widgetPodeMarcarLida, zerarNaoLidasDaConversa } from '@/chat/nao-lidas';
import { api } from '@/lib/api';
import type { ChatConversation, ChatMessage } from '@/server/chat';
import { Avatar } from '@/board/menus';
import { comportamentoDeRolagem } from '@/ui/movimento';
import { useSessao } from '@/ui/sessao';
import '@/chat/chat.css';

type MensagemLocal = ChatMessage & {
  estado: 'confirmada' | 'pendente' | 'falha';
};

export function WidgetDoChat() {
  const { sessao } = useSessao();
  const eu = sessao?.userId ?? null;
  const location = useLocation();
  const navigate = useNavigate();

  const {
    naoLidas,
    refrescarNaoLidas,
    widgetAberto,
    alternarWidget,
    conversaAbertaId,
    definirConversaAberta,
    aoEvento,
    somHabilitado,
    alternarSom,
  } = useChatLive();

  // Não exibe o widget flutuante se o usuário já estiver na página cheia de chat
  const naTelaDoChat = location.pathname.startsWith('/chat');

  const [conversas, setConversas] = useState<ChatConversation[] | null>(null);
  const [diretorio, setDiretorio] = useState<Array<{ id: string; name: string }>>([]);
  const [busca, setBusca] = useState('');
  const [mensagens, setMensagens] = useState<MensagemLocal[]>([]);
  const [carregandoMensagens, setCarregandoMensagens] = useState(false);
  const [rascunho, setRascunho] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [peerLastReadAt, setPeerLastReadAt] = useState<string | null>(null);

  const mensagensFimRef = useRef<HTMLDivElement | null>(null);
  const conversaAbertaRef = useRef<string | null>(null);
  conversaAbertaRef.current = conversaAbertaId;
  /** A mensagem mais nova que chegou sem poder marcar (aba escondida). */
  const pendenteDeLeituraRef = useRef<string | null>(null);

  // Carrega a lista de conversas sempre que abrir o widget ou voltar
  const carregarConversas = useCallback(async () => {
    try {
      const res = await api.chatConversas();
      const abertaId = conversaAbertaRef.current;
      setConversas((atual) => {
        const mapaZeradas = new Set(
          (atual || [])
            .filter((c) => c.unreadCount === 0)
            .map((c) => c.id),
        );
        if (abertaId) mapaZeradas.add(abertaId);

        return res.conversations.map((c) => {
          if (mapaZeradas.has(c.id)) {
            const anterior = atual?.find((a) => a.id === c.id);
            const mesmaMensagem = anterior?.lastMessage?.id === c.lastMessage?.id;
            if (mesmaMensagem || c.id === abertaId) {
              return { ...c, unreadCount: 0 };
            }
          }
          return c;
        });
      });
    } catch {
      /* se falhar, mantém lista atual */
    }
  }, []);

  const abrirConversa = useCallback(
    (id: string) => {
      definirConversaAberta(id);
      setConversas((atual) => (atual ? zerarNaoLidasDaConversa(atual, id) : atual));
      refrescarNaoLidas();
    },
    [definirConversaAberta, refrescarNaoLidas],
  );

  const voltarParaLista = useCallback(() => {
    if (conversaAbertaId) {
      setConversas((atual) =>
        atual ? zerarNaoLidasDaConversa(atual, conversaAbertaId) : atual,
      );
    }
    definirConversaAberta(null);
    void carregarConversas();
    refrescarNaoLidas();
  }, [conversaAbertaId, definirConversaAberta, carregarConversas, refrescarNaoLidas]);

  useEffect(() => {
    if (widgetAberto && !naTelaDoChat) {
      void carregarConversas();
      void api
        .chatDiretorio()
        .then((res) => {
          if (res.people) setDiretorio(res.people);
        })
        .catch(() => {});
    }
  }, [widgetAberto, naTelaDoChat, carregarConversas]);

  // Carrega mensagens ao selecionar uma conversa
  useEffect(() => {
    if (!conversaAbertaId || !widgetAberto || naTelaDoChat) {
      setMensagens([]);
      setPeerLastReadAt(null);
      return;
    }

    let cancelado = false;
    setCarregandoMensagens(true);

    // Zera imediatamente no estado local otimista
    setConversas((atual) =>
      atual ? zerarNaoLidasDaConversa(atual, conversaAbertaId) : atual,
    );

    // Marca como lida na API imediatamente ao abrir
    const agoraIso = new Date().toISOString();
    api
      .chatMarcarLida(conversaAbertaId, agoraIso)
      .then((r) => {
        if (cancelado) return;
        setConversas((atual) =>
          atual
            ? zerarNaoLidasDaConversa(atual, conversaAbertaId).map((c) =>
                c.id === conversaAbertaId
                  ? { ...c, lastReadAt: r.lastReadAt, unreadCount: 0 }
                  : c,
              )
            : atual,
        );
        refrescarNaoLidas();
      })
      .catch(() => {});

    api
      .chatMensagens(conversaAbertaId)
      .then((res) => {
        if (cancelado) return;
        const msgs = (res.messages || []).map(
          (m): MensagemLocal => ({
            ...m,
            estado: 'confirmada',
          }),
        );
        // Inverte porque o endpoint entrega do mais novo para o mais velho
        setMensagens(msgs.slice().reverse());
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setCarregandoMensagens(false);
      });

    return () => {
      cancelado = true;
    };
  }, [conversaAbertaId, widgetAberto, naTelaDoChat, refrescarNaoLidas]);

  // Rola até o final das mensagens
  useEffect(() => {
    if (mensagensFimRef.current) {
      mensagensFimRef.current.scrollIntoView({ behavior: comportamentoDeRolagem() });
    }
  }, [mensagens]);

  // Escuta eventos ao vivo para a conversa aberta
  useEffect(() => {
    return aoEvento((ev) => {
      if (ev.type === 'message_edited' || ev.type === 'message_deleted') {
        // EDITAR E APAGAR CHEGAM À JANELINHA TAMBÉM. Sem isto a mensagem apagada
        // por um colega continuava legível na janelinha aberta (até fechar e
        // reabrir), e a editada ficava com o texto velho. Só atualiza o que já
        // está na tela: a janelinha não ordena, e anexar aqui uma mensagem
        // antiga a poria no fim da conversa.
        if (conversaAbertaId && ev.message.conversationId === conversaAbertaId) {
          setMensagens((atual) =>
            atual.some((m) => m.id === ev.message.id)
              ? (aplicarMensagem(atual, ev.message) as MensagemLocal[])
              : atual,
          );
        }
        // A prévia da lista também muda quando a última mensagem é a editada/apagada.
        void carregarConversas();
      } else if (ev.type === 'message_new') {
        // Se for na conversa ativa no widget
        if (conversaAbertaId && ev.message.conversationId === conversaAbertaId) {
          const nova: MensagemLocal = {
            ...ev.message,
            estado: 'confirmada',
          };
          // RECONCILIA PELA CHAVE DE ENVIO, como a tela cheia. O autor é
          // destinatário do próprio evento: se ele passa na frente da resposta
          // do POST, a bolha otimista e a do evento viravam DUAS, com o mesmo
          // id depois da resposta.
          setMensagens((atual) => aplicarMensagem(atual, nova) as MensagemLocal[]);
          // Marca como lida SÓ com a janelinha aberta, fora da tela do Chat e a
          // aba em foco (`widgetPodeMarcarLida`). O que chegar sem isso fica
          // não lido e é marcado quando a aba voltar ao foco (logo abaixo).
          if (
            !widgetPodeMarcarLida({
              widgetAberto,
              naTelaDoChat,
              conversaNaJanela: true,
              abaComFoco: abaEstaComFoco(),
            })
          ) {
            // Na tela do Chat, quem conta e marca é ela; aqui só a barra e a lista.
            if (naTelaDoChat) return;
            if (widgetAberto) {
              pendenteDeLeituraRef.current = nova.createdAt;
              void carregarConversas();
            }
            refrescarNaoLidas();
            return;
          }
          api
            .chatMarcarLida(conversaAbertaId, nova.createdAt)
            .then((r) => {
              setConversas((atual) =>
                atual
                  ? zerarNaoLidasDaConversa(atual, conversaAbertaId).map((c) =>
                      c.id === conversaAbertaId
                        ? {
                            ...c,
                            lastReadAt: r.lastReadAt,
                            unreadCount: 0,
                            lastMessage: {
                              id: nova.id,
                              body: nova.body,
                              authorId: nova.authorId,
                              at: nova.createdAt,
                              kind: nova.kind,
                              deletedAt: null,
                            },
                          }
                        : c,
                    )
                  : atual,
              );
              refrescarNaoLidas();
            })
            .catch(() => {});
        } else {
          // Atualiza lista de conversas caso seja mensagem em outra conversa
          void carregarConversas();
        }
      } else if (ev.type === 'conversation_read') {
        setConversas((atual) =>
          atual
            ? zerarNaoLidasDaConversa(atual, ev.conversationId).map((c) =>
                c.id === ev.conversationId
                  ? { ...c, lastReadAt: ev.readAt, unreadCount: 0 }
                  : c,
              )
            : atual,
        );
        refrescarNaoLidas();
        if (conversaAbertaId && ev.conversationId === conversaAbertaId) {
          if (ev.personId !== eu) {
            setPeerLastReadAt((atual) =>
              !atual || ev.readAt > atual ? ev.readAt : atual,
            );
          }
        }
      }
    });
  }, [aoEvento, conversaAbertaId, carregarConversas, eu, refrescarNaoLidas, widgetAberto, naTelaDoChat]);

  // A aba voltou ao foco com a janelinha aberta na conversa: marca o que
  // chegou enquanto ela estava escondida — o `aoFoco` da tela do Chat.
  useEffect(() => {
    if (!widgetAberto || naTelaDoChat || !conversaAbertaId) {
      pendenteDeLeituraRef.current = null;
      return;
    }
    const aoFoco = () => {
      const ate = pendenteDeLeituraRef.current;
      if (!ate) return;
      if (
        !widgetPodeMarcarLida({ widgetAberto, naTelaDoChat, conversaNaJanela: true, abaComFoco: abaEstaComFoco() })
      ) {
        return;
      }
      pendenteDeLeituraRef.current = null;
      void api
        .chatMarcarLida(conversaAbertaId, ate)
        .then(() => refrescarNaoLidas())
        .catch(() => {
          pendenteDeLeituraRef.current = ate;
        });
    };
    window.addEventListener('focus', aoFoco);
    document.addEventListener('visibilitychange', aoFoco);
    return () => {
      window.removeEventListener('focus', aoFoco);
      document.removeEventListener('visibilitychange', aoFoco);
    };
  }, [widgetAberto, naTelaDoChat, conversaAbertaId, refrescarNaoLidas]);

  // Conversa ativa selecionada
  const conversaAtiva = useMemo(() => {
    if (!conversaAbertaId || !conversas) return null;
    return conversas.find((c) => c.id === conversaAbertaId) ?? null;
  }, [conversaAbertaId, conversas]);

  // Título e avatar da conversa ativa
  const tituloConversaAtiva = useMemo(() => {
    if (!conversaAtiva) return 'Conversa';
    if (conversaAtiva.kind === 'general') return 'Geral';
    if (conversaAtiva.kind === 'direct') return conversaAtiva.peerName || 'Colega';
    return conversaAtiva.name || 'Grupo';
  }, [conversaAtiva]);

  // Nome do autor para exibição em canais e grupos
  const nomeDoAutor = useCallback(
    (authorId: string | null) => {
      if (!authorId) return 'Sistema';
      if (authorId === eu) return 'Você';
      const pessoa = diretorio.find((p) => p.id === authorId);
      if (pessoa) return pessoa.name;
      if (conversaAtiva?.peerUserId === authorId && conversaAtiva.peerName) {
        return conversaAtiva.peerName;
      }
      return 'Colega';
    },
    [diretorio, eu, conversaAtiva],
  );

  // Conversas filtradas pela busca
  const conversasFiltradas = useMemo(() => {
    if (!conversas) return [];
    if (!busca.trim()) return conversas;
    const termo = busca.toLowerCase();
    return conversas.filter((c) => {
      const nome =
        c.kind === 'general' ? 'Geral' : c.kind === 'direct' ? c.peerName : c.name;
      return (
        nome?.toLowerCase().includes(termo) ||
        c.lastMessage?.body?.toLowerCase().includes(termo)
      );
    });
  }, [conversas, busca]);

  // Envio de mensagem
  const aoEnviar = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const texto = rascunho.trim();
    if (!texto || !conversaAbertaId || enviando) return;

    setEnviando(true);
    const clientKey = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const agoraIso = new Date().toISOString();

    const otimista: MensagemLocal = {
      id: clientKey,
      conversationId: conversaAbertaId,
      authorId: eu,
      body: texto,
      kind: 'person',
      createdAt: agoraIso,
      editedAt: null,
      deletedAt: null,
      clientKey,
      estado: 'pendente',
    };

    setMensagens((atual) => [...atual, otimista]);
    setRascunho('');

    try {
      const res = await api.chatEnviar(conversaAbertaId, texto, clientKey);
      setMensagens((atual) =>
        atual.map((m) =>
          m.clientKey === clientKey
            ? { ...m, id: res.message.id, estado: 'confirmada' }
            : m,
        ),
      );
      void carregarConversas();
    } catch {
      // `marcarFalha` poupa a que o canal ao vivo já confirmou: a resposta pode
      // se perder e a mensagem ter sido gravada, e ela não vira "falha".
      setMensagens((atual) =>
        marcarFalha(atual, clientKey, 'Não foi possível enviar.') as MensagemLocal[],
      );
    } finally {
      setEnviando(false);
    }
  };

  const aoPressionarTecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void aoEnviar();
    }
  };

  /* O FOCO DO WIDGET — WCAG 2.4.3. Abrir trocava o botão flutuante (que tinha o
     foco) pela janelinha, e fechar fazia o contrário: nos dois sentidos o foco
     caía no `<body>`. Agora abrir leva o foco ao primeiro campo (a busca, ou a
     mensagem — `autoFocus` abaixo), `Esc` e o `X` fecham, e o foco volta ao
     botão que abriu. */
  const botaoDoChat = useRef<HTMLButtonElement | null>(null);
  const campoDeBusca = useRef<HTMLInputElement | null>(null);
  const devolverAoBotao = useRef(false);
  /** O foco entra na janelinha SÓ quando a pessoa a abriu agora — o widget volta a aparecer aberto ao sair da tela do chat, e roubar o foco ali seria pior. */
  const focarAoAbrir = useRef(false);
  const fechar = () => {
    devolverAoBotao.current = true;
    alternarWidget(false);
  };
  const abrir = () => {
    focarAoAbrir.current = true;
    alternarWidget(true);
  };
  useEffect(() => {
    if (widgetAberto) {
      if (!focarAoAbrir.current) return;
      focarAoAbrir.current = false;
      // Na lista, o campo de busca; numa conversa, o campo de mensagem já tem `autoFocus`.
      campoDeBusca.current?.focus();
      return;
    }
    if (!devolverAoBotao.current) return;
    devolverAoBotao.current = false;
    botaoDoChat.current?.focus();
  }, [widgetAberto]);

  /* O BOTÃO NÃO ESCONDE O FOCO — WCAG 2.4.11 (Foco não obscurecido). O botão
     flutuante fica `fixed` no canto de baixo, em toda tela, e o foco de teclado
     que parava num controle do canto (o `Editar` da última linha do Painel, o
     `Apagar` do Catálogos, o `Redefinir` de Pessoas) ficava INTEIRO por baixo
     dele: medido, o `elementFromPoint` do centro do controle devolvia o botão do
     chat. Rolar não adianta — o botão acompanha a janela. Enquanto o foco está
     num controle que o botão cobre, ele recua (some, e deixa de pegar o clique);
     volta quando o foco sai dali. O botão continua no fim da ordem do Tab. */
  useEffect(() => {
    let quadro = 0;
    const avaliar = () => {
      quadro = 0;
      const botao = botaoDoChat.current;
      if (botao === null) return;
      const foco = document.activeElement;
      let cobre = false;
      if (foco instanceof HTMLElement && foco !== botao && foco !== document.body) {
        const a = foco.getBoundingClientRect();
        const f = botao.getBoundingClientRect();
        cobre = a.width > 0 && a.height > 0 && a.left < f.right && a.right > f.left && a.top < f.bottom && a.bottom > f.top;
      }
      if (cobre) botao.dataset.recuado = 'true';
      else delete botao.dataset.recuado;
    };
    // Depois do quadro: o navegador rola o foco para a vista antes (ou logo depois) do evento.
    const agendar = () => {
      if (quadro === 0) quadro = window.requestAnimationFrame(avaliar);
    };
    document.addEventListener('focusin', agendar);
    document.addEventListener('focusout', agendar);
    window.addEventListener('scroll', agendar, true);
    window.addEventListener('resize', agendar);
    return () => {
      if (quadro !== 0) window.cancelAnimationFrame(quadro);
      document.removeEventListener('focusin', agendar);
      document.removeEventListener('focusout', agendar);
      window.removeEventListener('scroll', agendar, true);
      window.removeEventListener('resize', agendar);
    };
  }, []);

  const irParaTelaCheia = () => {
    alternarWidget(false);
    if (conversaAbertaId) {
      navigate(`/chat/${conversaAbertaId}`);
    } else {
      navigate('/chat');
    }
  };

  // Se estiver na tela do chat, oculta totalmente o widget flutuante
  if (naTelaDoChat) return null;

  return (
    <>
      {/* ── BOTÃO FLUTUANTE (TRIGGER TIPO MESSENGER) ──
          F43 Fase 5: era um círculo no verde da arte, o maior ponto verde da
          tela, em TODAS as telas — competia com o botão principal de cada uma.
          Agora é uma peça neutra que sobe do fundo (topo da escada, letra
          plena, sombra); o que chama atenção é o número vermelho, quando há. */}
      {!widgetAberto && (
        <button
          ref={botaoDoChat}
          type="button"
          onClick={abrir}
          className="ch-fab fixed bottom-6 right-6 z-40 flex items-center justify-center w-14 h-14 rounded-full bg-[var(--ink-3)] text-[var(--plat)] shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--iw-foco)]"
          title="Abrir Chat da Equipe"
          aria-label="Abrir Chat"
        >
          <MessageSquare className="w-6 h-6 stroke-[2.2]" />
          {naoLidas > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold text-white bg-red-500 rounded-full border-2 border-[var(--iw-fundo)] animate-pulse">
              {naoLidas > 99 ? '99+' : naoLidas}
            </span>
          )}
        </button>
      )}

      {/* ── POPUP FLUTUANTE (WIDGET COMPACTO) ── */}
      {widgetAberto && (
        <aside
          role="complementary"
          aria-label="Chat Flutuante"
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            e.preventDefault();
            fechar();
          }}
          className="fixed bottom-6 right-6 z-50 w-[380px] h-[540px] max-h-[85vh] max-w-[calc(100vw-32px)] flex flex-col bg-[var(--iw-fundo)] border border-[var(--iw-linha)] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          {/* CABEÇALHO DO WIDGET */}
          <header className="flex items-center justify-between px-3.5 py-2.5 bg-[var(--iw-lateral)] border-b border-[var(--iw-linha)]">
            <div className="flex items-center gap-2 min-w-0">
              {conversaAbertaId && (
                <button
                  type="button"
                  onClick={voltarParaLista}
                  className="p-1 rounded-lg text-[var(--iw-texto-2)] hover:text-[var(--iw-texto)] hover:bg-[var(--iw-hover)] transition-colors"
                  title="Voltar para a lista"
                  aria-label="Voltar"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              {conversaAbertaId && conversaAtiva ? (
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar
                    pessoa={{
                      id: conversaAtiva.peerUserId ?? conversaAtiva.id,
                      name: tituloConversaAtiva,
                    }}
                  />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate leading-tight text-[var(--iw-texto)]">
                      {tituloConversaAtiva}
                    </h3>
                    <span className="text-[11px] text-[var(--iw-texto-3)]">
                      {conversaAtiva.kind === 'direct' ? 'Conversa Direta' : 'Canal'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[var(--iw-verde-marca-texto)]" />
                  <h3 className="text-sm font-semibold text-[var(--iw-texto)]">
                    Chat da Equipe
                  </h3>
                  {naoLidas > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-semibold">
                      {naoLidas}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Ações do cabeçalho */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={alternarSom}
                className="p-1.5 rounded-lg text-[var(--iw-texto-3)] hover:text-[var(--iw-texto)] hover:bg-[var(--iw-hover)] transition-colors"
                title={somHabilitado ? 'Silenciar som' : 'Ativar som de notificação'}
                aria-label={somHabilitado ? 'Silenciar som' : 'Ativar som'}
              >
                {somHabilitado ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4 text-red-400" />
                )}
              </button>
              <button
                type="button"
                onClick={irParaTelaCheia}
                className="p-1.5 rounded-lg text-[var(--iw-texto-3)] hover:text-[var(--iw-texto)] hover:bg-[var(--iw-hover)] transition-colors"
                title="Abrir em tela cheia"
                aria-label="Tela cheia"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={fechar}
                className="p-1.5 rounded-lg text-[var(--iw-texto-3)] hover:text-[var(--iw-texto)] hover:bg-[var(--iw-hover)] transition-colors"
                title="Minimizar chat"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* CORPO DO WIDGET */}
          {!conversaAbertaId ? (
            /* ── MODO 1: LISTA DE CONVERSAS ── */
            <div className="flex-1 flex flex-col min-h-0 bg-[var(--iw-fundo)]">
              {/* Barra de busca */}
              <div className="p-2.5 border-b border-[var(--iw-linha)] bg-[var(--iw-lateral)]">
                <div className="relative flex items-center">
                  <Search className="absolute left-2.5 w-3.5 h-3.5 text-[var(--iw-texto-3)] pointer-events-none" />
                  <input
                    type="text"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar conversa ou colega…"
                    aria-label="Buscar conversa ou colega"
                    ref={campoDeBusca}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--iw-fundo)] border border-[var(--iw-linha)] text-[var(--iw-texto)] placeholder:text-[var(--iw-texto-3)] focus:outline-none focus:border-[var(--iw-foco)] transition-colors"
                  />
                </div>
              </div>

              {/* Lista com rolagem */}
              <div className="flex-1 overflow-y-auto divide-y divide-[var(--iw-linha)] ch-widget-scroll">
                {conversas === null ? (
                  <div className="p-6 text-center text-xs text-[var(--iw-texto-3)]">
                    Carregando conversas…
                  </div>
                ) : conversasFiltradas.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--iw-texto-3)]">
                    Nenhuma conversa encontrada.
                  </div>
                ) : (
                  conversasFiltradas.map((c) => {
                    const nome =
                      c.kind === 'general'
                        ? 'Geral'
                        : c.kind === 'direct'
                          ? c.peerName || 'Colega'
                          : c.name || 'Grupo';
                     const hora = c.lastMessage?.at
                      ? horaDaMensagem(c.lastMessage.at)
                      : '';
                    const temNaoLidas = c.unreadCount > 0;

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => abrirConversa(c.id)}
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--iw-hover)] transition-colors"
                      >
                        <Avatar
                          pessoa={{
                            id: c.peerUserId ?? c.id,
                            name: nome,
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span
                              className={`text-xs truncate ${
                                temNaoLidas
                                  ? 'font-bold text-[var(--iw-texto)]'
                                  : 'font-medium text-[var(--iw-texto)]'
                              }`}
                            >
                              {nome}
                            </span>
                            {hora && (
                              <span className="text-[10px] text-[var(--iw-texto-3)] whitespace-nowrap">
                                {hora}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] text-[var(--iw-texto-3)] truncate">
                              {c.lastMessage ? previaDaConversa(c) : 'Nenhuma mensagem recente'}
                            </p>
                            {temNaoLidas && (
                              <span className="min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full flex items-center justify-center">
                                {c.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* ── MODO 2: CONVERSA ATIVA COM STATUS WHATSAPP ── */
            <div className="flex-1 flex flex-col min-h-0 bg-[var(--iw-fundo)]">
              {/* Área de mensagens */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3 ch-widget-scroll bg-[var(--iw-fundo)]">
                {carregandoMensagens ? (
                  <div className="p-6 text-center text-xs text-[var(--iw-texto-3)]">
                    Carregando mensagens…
                  </div>
                ) : mensagens.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[var(--iw-texto-3)]">
                    Inicie a conversa enviando uma mensagem abaixo.
                  </div>
                ) : (
                  mensagens.map((m) => {
                    const minha = eu != null && m.authorId === eu;
                    const hora = horaDaMensagem(m.createdAt);
                    const statusVisual = statusVisualDaMensagem(m, peerLastReadAt);
                    const ehCanal =
                      conversaAtiva?.kind === 'general' || conversaAtiva?.kind === 'group';

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${
                          minha ? 'items-end' : 'items-start'
                        }`}
                      >
                        <div
                          className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-xs shadow-xs break-words ${
                            minha
                              ? 'ch-widget-bolha-minha rounded-br-xs'
                              : 'ch-widget-bolha-outro rounded-bl-xs'
                          }`}
                        >
                          {/* Nome do remetente em canais coletivos */}
                          {!minha && ehCanal && (
                            <span className="text-[11px] font-semibold text-[var(--iw-verde-marca-texto)] mb-1 block">
                              {nomeDoAutor(m.authorId)}
                            </span>
                          )}

                          <p
                            className={`whitespace-pre-wrap leading-relaxed text-xs ${
                              m.deletedAt ? 'italic text-[var(--iw-texto-3)]' : ''
                            }`}
                          >
                            {textoNaJanelinha(m)}
                          </p>

                          <div
                            className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                              minha ? 'text-[var(--iw-texto-2)]' : 'text-[var(--iw-texto-3)]'
                            }`}
                          >
                            {m.editedAt && !m.deletedAt && <span>editada</span>}
                            {hora && <span>{hora}</span>}

                            {/* INDICADOR DE STATUS ESTILO WHATSAPP (RELÓGIO / 1 CHECK / 2 CHECKS / DUPLO AZUL) */}
                            {minha && (
                              <span
                                className="inline-flex items-center ml-0.5"
                                title={
                                  statusVisual === 'pendente'
                                    ? 'Enviando…'
                                    : statusVisual === 'lida'
                                      ? 'Lida'
                                      : 'Entregue'
                                }
                              >
                                {statusVisual === 'pendente' && (
                                  <Clock3 className="w-3 h-3 text-[var(--iw-texto-3)] animate-spin" />
                                )}
                                {statusVisual === 'enviada' && (
                                  <Check className="w-3.5 h-3.5 text-[var(--iw-texto-3)]" />
                                )}
                                {statusVisual === 'entregue' && (
                                  <CheckCheck className="w-3.5 h-3.5 text-[var(--iw-texto-3)]" />
                                )}
                                {statusVisual === 'lida' && (
                                  <CheckCheck className="w-3.5 h-3.5 text-sky-500 font-bold" />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={mensagensFimRef} />
              </div>

              {/* Barra inferior de digitação */}
              <form
                onSubmit={aoEnviar}
                className="p-2.5 border-t border-[var(--iw-linha)] bg-[var(--iw-lateral)] flex items-center gap-2"
              >
                <input
                  type="text"
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  onKeyDown={aoPressionarTecla}
                  placeholder="Escreva uma mensagem…"
                  aria-label="Escrever mensagem"
                  autoFocus
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-[var(--iw-fundo)] border border-[var(--iw-linha)] text-[var(--iw-texto)] placeholder:text-[var(--iw-texto-3)] focus:outline-none focus:border-[var(--iw-foco)] focus:ring-1 focus:ring-[var(--iw-foco)] transition-colors"
                />
                <button
                  type="submit"
                  disabled={!rascunho.trim() || enviando}
                  className="p-2 rounded-xl ch-enviar disabled:opacity-50 hover:brightness-105 active:scale-95 transition-all flex items-center justify-center shrink-0"
                  title="Enviar mensagem"
                  aria-label="Enviar"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
