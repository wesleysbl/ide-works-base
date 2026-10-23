/**
 * Roteamento puro da central de entrega ao vivo — F20.4 / D22.
 *
 * A CENTRAL NÃO DECIDE PERMISSÃO
 *   Quem pode ler é o banco. Este módulo só mapeia a lista de destinatários
 *   (já devolvida na mesma transação da escrita) para conexões abertas,
 *   aplica o teto de abas e a validade da conexão. Evento para pessoa sem
 *   conexão é descartado sem erro.
 */

/** Limite de abas por pessoa — decisão do orquestrador na F20.4. */
export const MAX_CONNECTIONS_PER_PERSON = 4;

/**
 * Validade da conexão = vida do crachá de acesso do provedor (uma hora).
 *
 * Medido no projeto: `exp - iat` = 3.600 s. Depois disso a tela reconecta e
 * passa de novo pela conferência completa (crachá, perfil, ativo). Não é o
 * teto de sessão (doze horas / trinta dias): aquele cobre a renovação.
 */
export const CONNECTION_MAX_AGE_MS = 60 * 60 * 1_000;

/**
 * Código de fechamento da conexão EXPULSA pelo limite de abas.
 *
 * POR QUE NÃO O 1000 COMUM
 *   O navegador reconecta toda conexão que cai depois de aberta, com a espera
 *   zerada (250–500 ms). A aba expulsa reconectava na hora, expulsando a
 *   seguinte, que reconectava... Com cinco abas abertas era uma ciranda sem
 *   fim: um `resolveActor` no banco e uma releitura da lista de conversas a
 *   cada meio segundo, mesmo com as abas escondidas.
 *
 *   Com um código próprio o cliente sabe que foi trocado por outra aba da mesma
 *   pessoa: fica quieta e só reconecta quando a pessoa volta para ela (foco).
 *   Faixa 4000–4999 é a reservada à aplicação; 4001–4003 já têm dono em
 *   `worker/chat-central.ts` (conta desativada, chat desligado, sessão vencida).
 */
export const CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS = 4004;

export const CHAT_LIVE_PING = 'ping';
export const CHAT_LIVE_PONG = 'pong';

/** Nome estável da única central da instalação. */
export const CHAT_CENTRAL_NAME = 'ideworks-chat';

export type LiveConnectionMeta = {
  /** Identificador opaco da conexão (tag no Durable Object). */
  connectionId: string;
  personId: string;
  /** Instantâneo em que a conexão foi carimbada na conferência de sessão. */
  connectedAtMs: number;
};

export type ChatLiveMessagePayload = {
  id: string;
  conversationId: string;
  authorId: string | null;
  body: string;
  kind: 'person' | 'system';
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientKey: string | null;
};

export type ChatLiveEvent =
  | { type: 'message_new'; message: ChatLiveMessagePayload }
  | { type: 'message_edited'; message: ChatLiveMessagePayload }
  | { type: 'message_deleted'; message: ChatLiveMessagePayload }
  | {
      type: 'conversation_created';
      conversationId: string;
      kind: 'general' | 'group' | 'direct';
      name: string | null;
    }
  | { type: 'conversation_changed'; conversationId: string }
  | { type: 'conversation_left'; conversationId: string }
  | {
      type: 'conversation_read';
      conversationId: string;
      readAt: string;
      personId: string;
    }
  /** Menção no chat — o sino atualiza na hora (F20.8). */
  | {
      type: 'chat_mention';
      conversationId: string;
      messageId: string;
    }
  /**
   * Reação alternada numa mensagem (F24.2). Carrega o suficiente para a tela
   * achar a bolha e refazer o rodapé sem pedir nada: a conversa, a mensagem,
   * quem reagiu, com qual emoji, se foi uma remoção e quando.
   */
  | {
      type: 'chat_reaction';
      conversationId: string;
      messageId: string;
      actorId: string;
      emoji: string;
      removed: boolean;
      reactedAt: string;
    };

/**
 * Quais conexões devem receber o evento: só as de pessoas na lista.
 * Pessoa sem conexão → omitida, sem erro.
 */
export function connectionsForRecipients(
  connections: readonly LiveConnectionMeta[],
  recipientIds: readonly string[],
): LiveConnectionMeta[] {
  if (recipientIds.length === 0) return [];
  const wanted = new Set(recipientIds);
  return connections.filter((c) => wanted.has(c.personId));
}

/** Conexão mais velha que a validade da sessão de acesso. */
export function isConnectionExpired(
  connection: LiveConnectionMeta,
  nowMs: number,
  maxAgeMs: number = CONNECTION_MAX_AGE_MS,
): boolean {
  return nowMs - connection.connectedAtMs >= maxAgeMs;
}

/**
 * Ao abrir uma aba a mais, quais conexões da mesma pessoa fechar para caber
 * no limite. Sempre as mais antigas. Se já há espaço, lista vazia.
 */
export function connectionIdsToEvictForNewTab(
  existingForPerson: readonly LiveConnectionMeta[],
  limit: number = MAX_CONNECTIONS_PER_PERSON,
): string[] {
  if (limit < 1) return existingForPerson.map((c) => c.connectionId);
  // Depois de aceitar a nova, o total será existing + 1. Precisamos fechar
  // o excesso sobre (limit - 1) nas atuais, ou seja existing.length - (limit - 1).
  const overflow = existingForPerson.length - (limit - 1);
  if (overflow <= 0) return [];
  const ordered = [...existingForPerson].sort(
    (a, b) => a.connectedAtMs - b.connectedAtMs || a.connectionId.localeCompare(b.connectionId),
  );
  return ordered.slice(0, overflow).map((c) => c.connectionId);
}

/**
 * Confere a origem da página — espelho da checagem usada na superfície de
 * integrações (`originAllowed` em handler.ts), com folga para o proxy do Vite
 * (front em :8080, API em :8787) na máquina local.
 */
export function origemDaPaginaConfere(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      const o = new URL(origin).origin;
      if (o === expected) return true;
      if (origemLocalDeDev(expected) && origemLocalDeDev(o)) return true;
      return false;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      const r = new URL(referer).origin;
      if (r === expected) return true;
      if (origemLocalDeDev(expected) && origemLocalDeDev(r)) return true;
      return false;
    } catch {
      return false;
    }
  }
  // Sem Origin nem Referer: recusa. O navegador envia Origin no upgrade WS;
  // chamada programática sem origem não abre a central.
  return false;
}

export function origemLocalDeDev(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === '[::1]' ||
      u.hostname === '::1'
    );
  } catch {
    return false;
  }
}

/** Serializa o evento para o fio. */
export function encodeLiveEvent(event: ChatLiveEvent): string {
  return JSON.stringify(event);
}

/** Tags gravadas no acceptWebSocket: pessoa + instante + id da conexão. */
export function tagsForConnection(
  personId: string,
  connectedAtMs: number,
  connectionId: string,
): string[] {
  return [`person:${personId}`, `at:${connectedAtMs}`, `conn:${connectionId}`];
}

export function personIdFromTags(tags: readonly string[]): string | null {
  const t = tags.find((x) => x.startsWith('person:'));
  return t ? t.slice('person:'.length) : null;
}

export function connectedAtFromTags(tags: readonly string[]): number | null {
  const t = tags.find((x) => x.startsWith('at:'));
  if (!t) return null;
  const n = Number(t.slice('at:'.length));
  return Number.isFinite(n) ? n : null;
}

export function connectionIdFromTags(tags: readonly string[]): string | null {
  const t = tags.find((x) => x.startsWith('conn:'));
  return t ? t.slice('conn:'.length) : null;
}

export function metaFromTags(tags: readonly string[]): LiveConnectionMeta | null {
  const personId = personIdFromTags(tags);
  const connectedAtMs = connectedAtFromTags(tags);
  const connectionId = connectionIdFromTags(tags);
  if (!personId || connectedAtMs == null || !connectionId) return null;
  return { personId, connectedAtMs, connectionId };
}
