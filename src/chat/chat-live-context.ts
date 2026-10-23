/**
 * Contexto da conexão ao vivo — F20.5 / F20.6.
 *
 * F20.6: a barra lateral lê `naoLidas` de qualquer tela; o gerente mantém o
 * número pela conexão ao vivo (e por alcance ao reconectar/foco).
 */

import { createContext } from 'react';

import type { ChatLiveEvent } from '@/server/chat-live';

export type ChatLiveStatus = 'desligado' | 'conectando' | 'conectado' | 'reconectando';

export type OuvinteDeEvento = (evento: ChatLiveEvent) => void;
export type OuvinteDeAlcance = () => void;

export type ChatLiveApi = {
  status: ChatLiveStatus;
  /** Total de não lidas em todas as conversas — alimenta o item Chat na barra. */
  naoLidas: number;
  aoEvento: (fn: OuvinteDeEvento) => () => void;
  aoPrecisarAlcance: (fn: OuvinteDeAlcance) => () => void;
  /** Recarrega a conta a partir da API (após marcar leitura na tela). */
  refrescarNaoLidas: () => void;
  /** ID da conversa aberta no momento (na tela cheia ou no widget) */
  conversaAbertaId: string | null;
  definirConversaAberta: (id: string | null) => void;
  /** Estado e ações do Widget Flutuante estilo Messenger */
  widgetAberto: boolean;
  alternarWidget: (abrir?: boolean) => void;
  abrirConversaNoWidget: (id: string) => void;
  /** Preferências de som */
  somHabilitado: boolean;
  alternarSom: () => void;
};

export const ChatLiveContext = createContext<ChatLiveApi | null>(null);

/** Evento de janela para o e2e injetar avisos da central sem WebSocket real. */
export const EVENTO_TESTE_CHAT_LIVE = 'ideworks:chat-live';
