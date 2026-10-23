/**
 * Conta de não lidas e quando marcar leitura — F20.6.
 *
 * Módulo puro: a barra e a tela usam as mesmas regras.
 */

export type ConversaComNaoLidas = { unreadCount: number };

/** Soma das não lidas de todas as conversas alcançáveis. */
export function somarNaoLidas(conversas: readonly ConversaComNaoLidas[]): number {
  let total = 0;
  for (const c of conversas) {
    const n = c.unreadCount;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) total += Math.floor(n);
  }
  return total;
}

/**
 * Marca como lida só com a conversa na tela e a aba em foco.
 *
 * `abaComFoco` = `document.visibilityState === 'visible'` (e, se informado,
 * `document.hasFocus()`). Sem isso, mensagem chega e a não lida permanece.
 */
export function podeMarcarComoLida(conversaVisivel: boolean, abaComFoco: boolean): boolean {
  return conversaVisivel && abaComFoco;
}

/**
 * A JANELINHA (WidgetDoChat, F36) marca leitura só quando é ela que está na
 * frente — conferência de 08/10. Ela escuta o ao vivo em qualquer tela, e
 * `conversaAbertaId` é COMPARTILHADO com a tela do Chat: marcava "lida" com o
 * relógio de agora em toda mensagem nova da conversa aberta, mesmo com a aba
 * escondida, na tela cheia do Chat ou com a janelinha fechada. Quem estava
 * longe perdia a não lida (o C6 do e2e pegava às vezes).
 */
export function widgetPodeMarcarLida(input: {
  widgetAberto: boolean;
  naTelaDoChat: boolean;
  conversaNaJanela: boolean;
  abaComFoco: boolean;
}): boolean {
  return input.widgetAberto && !input.naTelaDoChat && podeMarcarComoLida(input.conversaNaJanela, input.abaComFoco);
}

/**
 * A conversa que a pessoa está de fato VENDO agora — ou `null`.
 *
 * `conversaAbertaId` é UM só para a tela cheia e para a janelinha, e o X da
 * janelinha apenas a esconde: a conversa seguia "aberta" para o gerente, que a
 * tirava da conta do selo e calava som e aviso do sistema para ela. Quem fechou
 * a janelinha deixava de saber que o colega respondeu. Só conta como à vista a
 * da rota do Chat, ou a da janelinha enquanto ela está aberta.
 */
export function conversaEmVista(input: {
  naTelaDoChat: boolean;
  widgetAberto: boolean;
  conversaAbertaId: string | null;
}): string | null {
  return input.naTelaDoChat || input.widgetAberto ? input.conversaAbertaId : null;
}

/** Aba em foco no sentido do plano: visível no navegador. */
export function abaEstaComFoco(
  visibilityState: DocumentVisibilityState = typeof document !== 'undefined'
    ? document.visibilityState
    : 'visible',
  hasFocus: boolean = typeof document !== 'undefined' ? document.hasFocus() : true,
): boolean {
  return visibilityState === 'visible' && hasFocus;
}

/**
 * Id da primeira mensagem "nova" (pessoa, de outro, depois da marca).
 * `null` se não há divisor a desenhar.
 */
export function idDaPrimeiraNova(
  mensagens: readonly {
    id: string;
    kind: 'person' | 'system';
    authorId: string | null;
    createdAt: string;
    deletedAt: string | null;
  }[],
  lastReadAt: string | null,
  euId: string | null,
): string | null {
  if (!euId) return null;
  const marca = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY;
  const marcaOk = Number.isFinite(marca) ? marca : Number.NEGATIVE_INFINITY;
  for (const m of mensagens) {
    if (m.kind !== 'person') continue;
    if (m.deletedAt) continue;
    if (m.authorId === euId) continue;
    const t = Date.parse(m.createdAt);
    if (!Number.isFinite(t)) continue;
    if (t > marcaOk) return m.id;
  }
  return null;
}

/** Zera a conversa na lista local (evento `conversation_read` de outra aba). */
export function zerarNaoLidasDaConversa<T extends { id: string; unreadCount: number }>(
  conversas: readonly T[],
  conversationId: string,
): T[] {
  return conversas.map((c) =>
    c.id === conversationId ? { ...c, unreadCount: 0 } : c,
  );
}

/** Dono ou administrador (superadmin) gerencia membros do grupo — não o Geral. */
export function podeGerenciarGrupo(
  kind: 'general' | 'group' | 'direct',
  myRole: 'owner' | 'member' | null,
  isSuperadmin: boolean,
): boolean {
  if (kind !== 'group') return false;
  return myRole === 'owner' || isSuperadmin;
}
