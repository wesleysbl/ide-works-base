/**
 * Gerente de conexão ao vivo — F20.5 / F20.6 / D22.
 *
 * Uma conexão WebSocket por aba. Reconecta com espera crescente e sorteada.
 * Ao reconectar e ao voltar o foco, avisa os ouvintes para buscar "o que
 * mudou desde" — a central não guarda nada.
 *
 * F20.6: mantém o total de não lidas para a barra lateral, em qualquer tela.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

import { chatVisivelNaBarra, modoDoChat } from '@/chat/chave';
import {
  ChatLiveContext,
  EVENTO_TESTE_CHAT_LIVE,
  type ChatLiveStatus,
  type OuvinteDeAlcance,
  type OuvinteDeEvento,
} from '@/chat/chat-live-context';
import { conversaEmVista, somarNaoLidas } from '@/chat/nao-lidas';
import {
  desbloquearAudio,
  deveDispararNotificacaoDesktop,
  deveTocarSom,
  dispararNotificacaoNativa,
  lerPreferenciaDesktop,
  lerPreferenciaSom,
  permissaoNotificacaoNativa,
  resumoDoTextoNotificacao,
  salvarPreferenciaSom,
  tocarSomNotificacao,
} from '@/chat/notificador';
import { criarAtualizadorLimitado, iniciarRecuperacaoDoChat, lerComPrazo } from '@/chat/recuperacao';
import { depoisDeFecharSemAbrir } from '@/chat/sessao-do-canal';
import { WidgetDoChat } from '@/chat/WidgetDoChat';
import { api } from '@/lib/api';
import type { ChatLiveEvent } from '@/server/chat-live';
import { useSessao } from '@/ui/sessao';

function urlDoLive(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/chat/live`;
}

function lerEvento(dado: string): ChatLiveEvent | null {
  try {
    const o = JSON.parse(dado) as ChatLiveEvent;
    if (!o || typeof o !== 'object' || typeof (o as { type?: unknown }).type !== 'string') {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function GerenteDeConexao({ children }: { children: ReactNode }) {
  const { sessao, carregando } = useSessao();
  const isSuper = carregando ? null : (sessao?.isSuper ?? false);
  const habilitado =
    sessao != null && chatVisivelNaBarra(modoDoChat(), isSuper);

  const [status, setStatus] = useState<ChatLiveStatus>('desligado');
  const pessoaId = sessao?.userId;
  const [contagem, setContagem] = useState({ pessoaId, total: 0 });
  const naoLidas = habilitado && contagem.pessoaId === pessoaId ? contagem.total : 0;
  const eventosRef = useRef(new Set<OuvinteDeEvento>());
  const alcanceRef = useRef(new Set<OuvinteDeAlcance>());
  const atualizarRef = useRef<() => void>(() => {});
  const refrescarNaoLidas = useCallback(() => atualizarRef.current(), []);

  // F36: Controle da conversa aberta na tela e widget flutuante
  const [conversaAbertaId, setConversaAbertaId] = useState<string | null>(null);
  const [widgetAberto, setWidgetAberto] = useState<boolean>(false);
  const [somHabilitado, setSomHabilitado] = useState<boolean>(() => lerPreferenciaSom());

  /* A conversa que a pessoa está VENDO: a aberta só conta na tela do Chat ou
     com a janelinha aberta — o X da janelinha a esconde sem fechar a conversa
     (ver `conversaEmVista`). É ela, e não a aberta, que sai da conta do selo e
     cala o som e o aviso do sistema. */
  const naTelaDoChat = useLocation().pathname.startsWith('/chat');
  const emVistaRef = useRef<string | null>(null);
  emVistaRef.current = conversaEmVista({ naTelaDoChat, widgetAberto, conversaAbertaId });
  const somHabilitadoRef = useRef(somHabilitado);
  somHabilitadoRef.current = somHabilitado;

  const alternarSom = useCallback(() => {
    setSomHabilitado((prev) => {
      const proximo = !prev;
      salvarPreferenciaSom(proximo);
      return proximo;
    });
  }, []);

  const definirConversaAberta = useCallback(
    (id: string | null) => {
      setConversaAbertaId(id);
      if (id) {
        refrescarNaoLidas();
      }
    },
    [refrescarNaoLidas],
  );

  const alternarWidget = useCallback((abrir?: boolean) => {
    setWidgetAberto((atual) => (abrir !== undefined ? abrir : !atual));
  }, []);

  const abrirConversaNoWidget = useCallback(
    (id: string) => {
      setWidgetAberto(true);
      setConversaAbertaId(id);
      refrescarNaoLidas();
    },
    [refrescarNaoLidas],
  );

  // Desbloqueia AudioContext na primeira interação do usuário
  useEffect(() => {
    const aoInteragir = () => {
      desbloquearAudio();
      window.removeEventListener('pointerdown', aoInteragir);
      window.removeEventListener('keydown', aoInteragir);
    };
    window.addEventListener('pointerdown', aoInteragir, { passive: true });
    window.addEventListener('keydown', aoInteragir, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', aoInteragir);
      window.removeEventListener('keydown', aoInteragir);
    };
  }, []);

  const emitirAlcance = useCallback(() => {
    for (const fn of alcanceRef.current) {
      try {
        fn();
      } catch {
        /* ouvinte não pode derrubar o gerente */
      }
    }
    refrescarNaoLidas();
  }, [refrescarNaoLidas]);

  const emitirEvento = useCallback(
    (evento: ChatLiveEvent) => {
      for (const fn of eventosRef.current) {
        try {
          fn(evento);
        } catch {
          /* idem */
        }
      }
      if (
        evento.type === 'message_new' ||
        evento.type === 'conversation_created' ||
        evento.type === 'conversation_changed' ||
        evento.type === 'conversation_left' ||
        evento.type === 'conversation_read'
      ) {
        refrescarNaoLidas();
      }

      // F36: Notificação sonora inteligente e desktop ao vivo
      if (evento.type === 'message_new') {
        const janelaFocada =
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible' &&
          document.hasFocus();

        const convId = evento.message.conversationId;

        const toca = deveTocarSom({
          authorId: evento.message.authorId,
          meuUserId: pessoaId ?? null,
          conversationId: convId,
          conversaAbertaId: emVistaRef.current,
          somHabilitado: somHabilitadoRef.current,
          janelaFocada,
        });

        if (toca) {
          tocarSomNotificacao();
        }

        const disparaDesktop = deveDispararNotificacaoDesktop({
          authorId: evento.message.authorId,
          meuUserId: pessoaId ?? null,
          conversationId: convId,
          conversaAbertaId: emVistaRef.current,
          notificacoesHabilitadas: lerPreferenciaDesktop(),
          permissao: permissaoNotificacaoNativa(),
          janelaFocada,
        });

        if (disparaDesktop) {
          dispararNotificacaoNativa({
            title: 'Nova mensagem no chat',
            body: resumoDoTextoNotificacao(evento.message.body),
            conversationId: convId,
            aoClicar: () => {
              abrirConversaNoWidget(convId);
            },
          });
        }
      }
    },
    [refrescarNaoLidas, pessoaId, abrirConversaNoWidget],
  );

  useEffect(() => {
    if (!habilitado) {
      setStatus('desligado');
      return;
    }

    const leituras = new AbortController();
    const contador = criarAtualizadorLimitado(
      () => lerComPrazo((sinal) => api.chatConversas(sinal), leituras.signal),
      (r) => {
        const aberta = emVistaRef.current;
        const lista = aberta
          ? r.conversations.map((c) =>
              c.id === aberta ? { ...c, unreadCount: 0 } : c,
            )
          : r.conversations;
        setContagem({ pessoaId, total: somarNaoLidas(lista) });
      },
    );
    atualizarRef.current = contador.atualizar;
    contador.atualizar();
    const conexao = iniciarRecuperacaoDoChat({
      abrir: () => new WebSocket(urlDoLive()),
      visivel: () => document.visibilityState !== 'hidden',
      status: setStatus,
      mensagem: (dado) => {
        const evento = lerEvento(dado);
        if (evento) emitirEvento(evento);
      },
      alcance: emitirAlcance,
      contador: contador.atualizar,
      conferirSessao: () => depoisDeFecharSemAbrir(() => lerComPrazo((sinal) => api.eu(sinal), leituras.signal)),
    });
    const aoFoco = () => conexao.aoVisibilidade();
    window.addEventListener('focus', aoFoco);
    document.addEventListener('visibilitychange', aoFoco);

    // Costura de teste / e2e: injeta evento da central sem WebSocket real.
    const aoTeste = (ev: Event) => {
      const detail = (ev as CustomEvent<ChatLiveEvent>).detail;
      if (detail && typeof detail === 'object' && typeof detail.type === 'string') {
        emitirEvento(detail);
      }
    };
    window.addEventListener(EVENTO_TESTE_CHAT_LIVE, aoTeste);

    return () => {
      atualizarRef.current = () => {};
      contador.encerrar();
      conexao.encerrar();
      leituras.abort();
      window.removeEventListener('focus', aoFoco);
      document.removeEventListener('visibilitychange', aoFoco);
      window.removeEventListener(EVENTO_TESTE_CHAT_LIVE, aoTeste);
    };
  }, [habilitado, pessoaId, emitirAlcance, emitirEvento]);

  const aoEvento = useCallback((fn: OuvinteDeEvento) => {
    eventosRef.current.add(fn);
    return () => {
      eventosRef.current.delete(fn);
    };
  }, []);

  const aoPrecisarAlcance = useCallback((fn: OuvinteDeAlcance) => {
    alcanceRef.current.add(fn);
    return () => {
      alcanceRef.current.delete(fn);
    };
  }, []);

  const apiLive = useMemo(
    () => ({
      status,
      naoLidas,
      aoEvento,
      aoPrecisarAlcance,
      refrescarNaoLidas,
      conversaAbertaId,
      definirConversaAberta,
      widgetAberto,
      alternarWidget,
      abrirConversaNoWidget,
      somHabilitado,
      alternarSom,
    }),
    [
      status,
      naoLidas,
      aoEvento,
      aoPrecisarAlcance,
      refrescarNaoLidas,
      conversaAbertaId,
      definirConversaAberta,
      widgetAberto,
      alternarWidget,
      abrirConversaNoWidget,
      somHabilitado,
      alternarSom,
    ],
  );

  return (
    <ChatLiveContext.Provider value={apiLive}>
      {children}
      {habilitado && <WidgetDoChat />}
    </ChatLiveContext.Provider>
  );
}
