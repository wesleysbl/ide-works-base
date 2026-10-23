/**
 * Gancho da conexão ao vivo — F20.5.
 *
 * Separado do provedor para o recarregamento rápido do Vite não reclamar
 * de arquivo que mistura componente e constante.
 */

import { useContext } from 'react';

import {
  ChatLiveContext,
  type ChatLiveApi,
} from '@/chat/chat-live-context';

export type { ChatLiveApi, ChatLiveStatus } from '@/chat/chat-live-context';

export function useChatLive(): ChatLiveApi {
  const ctx = useContext(ChatLiveContext);
  if (!ctx) {
    return {
      status: 'desligado',
      naoLidas: 0,
      aoEvento: () => () => {},
      aoPrecisarAlcance: () => () => {},
      refrescarNaoLidas: () => {},
      conversaAbertaId: null,
      definirConversaAberta: () => {},
      widgetAberto: false,
      alternarWidget: () => {},
      abrirConversaNoWidget: () => {},
      somHabilitado: true,
      alternarSom: () => {},
    };
  }
  return ctx;
}
