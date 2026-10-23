/**
 * API do chat da equipe — F20.3.
 *
 * TODA A REGRA ESTÁ NO BANCO
 *   Alcance, dono, Geral, direta única, teto por minuto, janela de 30 dias:
 *   as funções de domínio decidem. Este arquivo traduz entrada HTTP, declara o
 *   ator da sessão e devolve a frase do banco sem engolir o SQLSTATE.
 *
 * A CHAVE `IDEWORKS_CHAT`
 *   Três estados: desligado | piloto | ligado. Ausente ou texto inválido cai
 *   em desligado — o chat não nasce ligado. Piloto: só super admin (`isSuper`).
 *   Desligar esconde as rotas; a limpeza de mensagens vencidas no cron continua.
 *
 * DESTINATÁRIOS
 *   Enviar devolve a lista na mesma transação. Demais escritas consultam
 *   `chat_recipient_ids` depois do commit — a central (F20.4) só entrega nessa
 *   lista; não decide permissão.
 */

import { type Sql, type Tx, arrayOuNulo, withActor } from '@/server/db';
import { inlineUuid, inlineUuidList } from '@/server/db-literal';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/** Os três estados da chave. Qualquer outro texto vira `desligado`. */
export type ChatMode = 'desligado' | 'piloto' | 'ligado';

export const CHAT_MODES: readonly ChatMode[] = ['desligado', 'piloto', 'ligado'] as const;

/**
 * Lote e orçamento próprios da limpeza — não disputam a coleta da Meta nem a
 * limpeza de imagens temporárias da conversa da tarefa. O intervalo do cron
 * continua o de sempre. A orquestração (bytes → registro → mensagem) mora em
 * `chat-imagens.ts` desde a F20.7.
 */
export const CHAT_PURGE_BATCH = 100;
export const CHAT_PURGE_BUDGET_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ChatRefused extends Error {
  readonly status: 400 | 403 | 404 | 429 | 502 | 503;

  constructor(message: string, status: 400 | 403 | 404 | 429 | 502 | 503) {
    super(message);
    this.name = 'ChatRefused';
    this.status = status;
  }
}

/**
 * Lê a variável do Worker. Padrão: desligado. Texto fora da lista fechada também
 * cai em desligado — não há quarto estado silencioso.
 */
export function chatModeFromEnv(value: string | undefined): ChatMode {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'ligado') return 'ligado';
  if (v === 'piloto') return 'piloto';
  return 'desligado';
}

/**
 * A porta da chave. Chamar em toda rota humana do chat, depois da sessão.
 *
 * `isSuper` é o topo (super_admin), não o administrador comum — piloto é prova
 * com quem manda no sistema, não com quem gerencia carteira.
 */
export function assertChatAllowed(mode: ChatMode, isSuper: boolean): void {
  if (mode === 'desligado') {
    throw new ChatRefused(
      'O chat está desligado nesta instalação. Peça a um administrador para ligá-lo.',
      403,
    );
  }
  if (mode === 'piloto' && !isSuper) {
    throw new ChatRefused(
      'O chat está em piloto: só super admin entra por enquanto.',
      403,
    );
  }
}

function traduzir(erro: unknown): never {
  if (erro instanceof ChatRefused) throw erro;
  const e = erro as { code?: string; message?: string };
  const frase = emPortugues(e.message);

  // Política / alcance / "não encontrado" das funções do chat.
  if (e.code === '42501') throw new ChatRefused(frase || 'Fora do seu alcance.', 403);
  // Argumento inválido: nome vazio, Geral que não se renomeia, teto de tamanho…
  if (e.code === '22023') throw new ChatRefused(frase || 'Pedido recusado.', 400);
  // Trava escrita à mão nas funções do chat: lápide de mensagem, linha de
  // sistema, fora da janela de 30 dias (F24), menção recusada (F20.8). Sem
  // esta linha a frase do banco virava 500 genérico — recusa de propósito
  // parecendo servidor quebrado.
  if (e.code === '23514') throw new ChatRefused(frase || 'Pedido recusado.', 400);
  // Teto de 30 mensagens por minuto.
  if (e.code === '54000') throw new ChatRefused(frase || 'Limite de envio atingido.', 429);

  throw erro;
}

function exigirUuid(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !UUID.test(valor)) {
    throw new ChatRefused(`${campo} inválido.`, 400);
  }
  return valor;
}

function comoInstante(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return new Date(v as string).toISOString();
}

function comoNumero(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/* ───────────────────────────── tipos da resposta ─────────────────────────── */

export type ChatMemberRole = 'owner' | 'member';

export type ChatMember = {
  id: string;
  name: string;
  role: ChatMemberRole | null;
  isActive: boolean;
};

export type ChatConversation = {
  id: string;
  kind: 'general' | 'group' | 'direct';
  name: string | null;
  archivedAt: string | null;
  lastMessage: {
    id: string;
    body: string | null;
    kind: 'person' | 'system' | null;
    authorId: string | null;
    at: string | null;
    deletedAt: string | null;
  } | null;
  unreadCount: number;
  /** F20.6 — marca de leitura (para o divisor "novas mensagens"). */
  lastReadAt: string | null;
  /** Papel do ator no grupo/direta; null no Geral. */
  myRole: ChatMemberRole | null;
  /** Outra pessoa da direta (null fora de direta). */
  peerUserId: string | null;
  peerName: string | null;
  peerIsActive: boolean | null;
  members: ChatMember[];
};

export type ChatMessage = {
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

export type SentChatMessage = ChatMessage & { recipientIds: string[] };

export type ChatPerson = { id: string; name: string };

/* ───────────────────────────── reações (F24) ─────────────────────────────── */

/**
 * Os seis emojis de reação. Lista fechada, espelho do tipo enumerado do banco
 * (`ideworks.chat_reaction_emoji`). Barrar aqui é mais barato que levar um
 * `22P02` cru do Postgres de volta — e a frase fica melhor.
 */
export const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export type ChatReactionEmoji = (typeof CHAT_REACTION_EMOJIS)[number];

export function isChatReactionEmoji(v: unknown): v is ChatReactionEmoji {
  return typeof v === 'string' && (CHAT_REACTION_EMOJIS as readonly string[]).includes(v);
}

/** Uma reação viva na bolha. */
export type ChatReaction = {
  messageId: string;
  actorId: string;
  emoji: ChatReactionEmoji;
  reactedAt: string;
};

/**
 * Uma mudança de reação desde um instante — inclui a removida (`removed`),
 * que é como a reação fantasma morre depois de um tempo offline.
 */
export type ChatReactionChange = ChatReaction & { removed: boolean };

/** O resultado de alternar: o estado final mais os destinatários do evento. */
export type ToggledChatReaction = ChatReactionChange & {
  conversationId: string;
  recipientIds: string[];
};


/* ───────────────────────────── mapeamento ────────────────────────────────── */

function mapMember(raw: unknown): ChatMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : null;
  if (!id) return null;
  const role =
    o.role === 'owner' || o.role === 'member' ? (o.role as ChatMemberRole) : null;
  return {
    id,
    name: typeof o.name === 'string' && o.name.trim() !== '' ? o.name.trim() : 'Colega',
    role,
    isActive: o.isActive !== false && o.is_active !== false,
  };
}

function mapMembers(raw: unknown): ChatMember[] {
  if (Array.isArray(raw)) {
    return raw.map(mapMember).filter((m): m is ChatMember => m != null);
  }
  if (typeof raw === 'string') {
    try {
      return mapMembers(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function mapConversation(r: Record<string, unknown>): ChatConversation {
  const lastId = r.last_message_id as string | null;
  const myRole =
    r.my_role === 'owner' || r.my_role === 'member'
      ? (r.my_role as ChatMemberRole)
      : null;
  return {
    id: r.conversation_id as string,
    kind: r.kind as ChatConversation['kind'],
    name: (r.name as string | null) ?? null,
    archivedAt: comoInstante(r.archived_at),
    lastMessage:
      lastId == null
        ? null
        : {
            id: lastId,
            body: (r.last_message_body as string | null) ?? null,
            kind: (r.last_message_kind as ChatMessage['kind'] | null) ?? null,
            authorId: (r.last_message_author_id as string | null) ?? null,
            at: comoInstante(r.last_message_at),
            deletedAt: comoInstante(r.last_message_deleted_at),
          },
    unreadCount: comoNumero(r.unread_count),
    lastReadAt: comoInstante(r.last_read_at),
    myRole,
    peerUserId: (r.peer_user_id as string | null) ?? null,
    peerName: (r.peer_name as string | null) ?? null,
    peerIsActive:
      r.peer_is_active === null || r.peer_is_active === undefined
        ? null
        : Boolean(r.peer_is_active),
    members: mapMembers(r.members),
  };
}

function mapMessage(r: Record<string, unknown>): ChatMessage {
  return {
    id: r.id as string,
    conversationId: r.conversation_id as string,
    authorId: (r.author_id as string | null) ?? null,
    body: (r.body as string | null) ?? '',
    kind: r.kind as ChatMessage['kind'],
    createdAt: comoInstante(r.created_at)!,
    editedAt: comoInstante(r.edited_at),
    deletedAt: comoInstante(r.deleted_at),
    clientKey: (r.client_key as string | null) ?? null,
  };
}

function mapSent(r: Record<string, unknown>): SentChatMessage {
  const recipients = (r.recipient_ids as string[] | null) ?? [];
  return {
    id: r.message_id as string,
    conversationId: r.conversation_id as string,
    authorId: (r.author_id as string | null) ?? null,
    body: (r.body as string | null) ?? '',
    kind: r.kind as ChatMessage['kind'],
    createdAt: comoInstante(r.created_at)!,
    editedAt: comoInstante(r.edited_at),
    deletedAt: comoInstante(r.deleted_at),
    clientKey: (r.client_key as string | null) ?? null,
    recipientIds: recipients,
  };
}

function mapReaction(r: Record<string, unknown>): ChatReaction {
  return {
    messageId: r.message_id as string,
    actorId: r.actor_id as string,
    emoji: r.emoji as ChatReactionEmoji,
    reactedAt: comoInstante(r.reacted_at)!,
  };
}

function mapReactionChange(r: Record<string, unknown>): ChatReactionChange {
  return { ...mapReaction(r), removed: r.removed === true };
}

/* ───────────────────────────── leituras ──────────────────────────────────── */

export async function listMyChatConversations(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<ChatConversation[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`select * from ideworks.list_my_chat_conversations()`;
      return rows.map((r) => mapConversation(r as Record<string, unknown>));
    } catch (e) {
      traduzir(e);
    }
  });
}

/** As mensagens, no `tx` de quem chama (que já declarou o ator). O id vai no texto — ver `inlineUuid`. */
async function lerMensagens(
  tx: Tx,
  id: string,
  cursor?: { beforeAt: string; beforeId: string } | null,
): Promise<ChatMessage[]> {
  try {
    const conversa = inlineUuid(tx, id);
    const rows = cursor
      ? await tx`select * from ideworks.list_chat_messages(
          ${conversa}::uuid, ${cursor.beforeAt}::timestamptz, ${inlineUuid(tx, cursor.beforeId)}::uuid)`
      : await tx`select * from ideworks.list_chat_messages(${conversa}::uuid, null, null)`;
    return rows.map((r) => mapMessage(r as Record<string, unknown>));
  } catch (e) {
    traduzir(e);
  }
}

function validarPedidoDeMensagens(
  conversationId: string,
  cursor?: { beforeAt: string; beforeId: string } | null,
): string {
  const id = exigirUuid(conversationId, 'Conversa');
  if (cursor) {
    exigirUuid(cursor.beforeId, 'Cursor');
    if (Number.isNaN(Date.parse(cursor.beforeAt))) {
      throw new ChatRefused('Cursor de histórico inválido.', 400);
    }
  }
  return id;
}

export async function listChatMessages(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  cursor?: { beforeAt: string; beforeId: string } | null,
): Promise<ChatMessage[]> {
  const id = validarPedidoDeMensagens(conversationId, cursor);
  return withActor(sql, asDbActor(actor), (tx) => lerMensagens(tx, id, cursor));
}

/**
 * As mensagens E as reações do mesmo lote, numa transação só — perf do servidor,
 * 08/10/2026.
 *
 * Abrir uma conversa pedia as duas coisas em duas transações seguidas (begin,
 * declaração do ator, consulta, commit, duas vezes). São as MESMAS duas
 * leituras, com as mesmas validações e o mesmo ator, no mesmo bloco: as
 * reações só dependem dos ids que as mensagens trouxeram, então continuam
 * depois delas, mas sem uma transação a mais no meio.
 */
export async function listChatMessagesWithReactions(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  cursor?: { beforeAt: string; beforeId: string } | null,
): Promise<{ messages: ChatMessage[]; reactions: ChatReaction[] }> {
  const id = validarPedidoDeMensagens(conversationId, cursor);
  return withActor(sql, asDbActor(actor), async (tx) => {
    const messages = await lerMensagens(tx, id, cursor);
    const ids = validarIdsDeReacoes(messages.map((m) => m.id));
    const reactions = await lerReacoes(tx, id, ids);
    return { messages, reactions };
  });
}

export async function listChatMessageChanges(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  since: string,
): Promise<ChatMessage[]> {
  const id = exigirUuid(conversationId, 'Conversa');
  if (!since || Number.isNaN(Date.parse(since))) {
    throw new ChatRefused('Informe o momento de referência (since).', 400);
  }
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`select * from ideworks.list_chat_message_changes(
        ${inlineUuid(tx, id)}::uuid, ${since}::timestamptz)`;
      return rows.map((r) => mapMessage(r as Record<string, unknown>));
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function chatDirectory(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<ChatPerson[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`select * from ideworks.chat_directory()`;
      return rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
      }));
    } catch (e) {
      traduzir(e);
    }
  });
}

/* ───────────────────────────── escritas ──────────────────────────────────── */

export async function createGroupConversation(
  sql: Sql,
  actor: AuthenticatedActor,
  name: unknown,
  memberIds: unknown,
): Promise<string> {
  const nome = typeof name === 'string' ? name.trim() : '';
  if (nome === '') throw new ChatRefused('Dê um nome ao grupo.', 400);
  const ids = Array.isArray(memberIds)
    ? memberIds.map((m, i) => exigirUuid(m, `Membro ${i + 1}`))
    : [];
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [r] = await tx`
        select ideworks.create_group_conversation(
          ${nome}, ${arrayOuNulo(ids)}::uuid[]) as id`;
      return r.id as string;
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function renameConversation(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  name: unknown,
): Promise<void> {
  const id = exigirUuid(conversationId, 'Conversa');
  const nome = typeof name === 'string' ? name.trim() : '';
  if (nome === '') throw new ChatRefused('Dê um nome ao grupo.', 400);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.rename_conversation(${id}::uuid, ${nome})`;
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function addConversationMember(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  userId: unknown,
): Promise<void> {
  const id = exigirUuid(conversationId, 'Conversa');
  const uid = exigirUuid(userId, 'Pessoa');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.add_conversation_member(${id}::uuid, ${uid}::uuid)`;
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function removeConversationMember(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  userId: string,
): Promise<void> {
  const id = exigirUuid(conversationId, 'Conversa');
  const uid = exigirUuid(userId, 'Pessoa');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.remove_conversation_member(${id}::uuid, ${uid}::uuid)`;
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function leaveConversation(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
): Promise<void> {
  const id = exigirUuid(conversationId, 'Conversa');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.leave_conversation(${id}::uuid)`;
    } catch (e) {
      traduzir(e);
    }
  });
}

/** Desvio F20.3: o plano da fase não listava a rota; a tela da F20.6 passa a posse. */
export async function transferConversationOwnership(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  newOwnerId: unknown,
): Promise<void> {
  const id = exigirUuid(conversationId, 'Conversa');
  const uid = exigirUuid(newOwnerId, 'Novo dono');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.transfer_conversation_ownership(${id}::uuid, ${uid}::uuid)`;
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function openDirectConversation(
  sql: Sql,
  actor: AuthenticatedActor,
  otherUserId: unknown,
): Promise<string> {
  const uid = exigirUuid(otherUserId, 'Pessoa');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [r] = await tx`select ideworks.open_direct_conversation(${uid}::uuid) as id`;
      return r.id as string;
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function sendChatMessage(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  body: unknown,
  clientKey: unknown,
  imageIds?: unknown,
): Promise<SentChatMessage> {
  const id = exigirUuid(conversationId, 'Conversa');
  const texto = typeof body === 'string' ? body.trim() : '';
  const ids = Array.isArray(imageIds)
    ? imageIds.map((x, i) => exigirUuid(x, `Imagem ${i + 1}`))
    : [];
  if (texto === '' && ids.length === 0) {
    throw new ChatRefused('Escreva a mensagem antes de enviar.', 400);
  }
  const chave = typeof clientKey === 'string' ? clientKey.trim() : '';
  if (chave === '') throw new ChatRefused('Faltou a chave de envio (para não duplicar).', 400);
  if (chave.length > 128) throw new ChatRefused('Chave de envio longa demais.', 400);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`select * from ideworks.send_chat_message(
        ${id}::uuid, ${texto}, ${chave}, ${arrayOuNulo(ids)}::uuid[])`;
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new ChatRefused('Não foi possível enviar a mensagem.', 400);
      return mapSent(row);
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function editChatMessage(
  sql: Sql,
  actor: AuthenticatedActor,
  messageId: string,
  body: unknown,
): Promise<ChatMessage> {
  const id = exigirUuid(messageId, 'Mensagem');
  const texto = typeof body === 'string' ? body.trim() : '';
  if (texto === '') throw new ChatRefused('Escreva a mensagem antes de salvar.', 400);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`select * from ideworks.edit_chat_message(${id}::uuid, ${texto})`;
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new ChatRefused('Mensagem não encontrada.', 404);
      return mapMessage(row);
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function deleteChatMessage(
  sql: Sql,
  actor: AuthenticatedActor,
  messageId: string,
): Promise<ChatMessage> {
  const id = exigirUuid(messageId, 'Mensagem');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`select * from ideworks.delete_chat_message(${id}::uuid)`;
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new ChatRefused('Mensagem não encontrada.', 404);
      return mapMessage(row);
    } catch (e) {
      traduzir(e);
    }
  });
}

export async function markConversationRead(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  readAt: unknown,
): Promise<string> {
  const id = exigirUuid(conversationId, 'Conversa');
  const quando = typeof readAt === 'string' ? readAt : '';
  if (!quando || Number.isNaN(Date.parse(quando))) {
    throw new ChatRefused('Informe o momento da leitura.', 400);
  }
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [r] = await tx`
        select ideworks.mark_conversation_read(${id}::uuid, ${quando}::timestamptz) as last_read_at`;
      return comoInstante(r.last_read_at)!;
    } catch (e) {
      traduzir(e);
    }
  });
}

/**
 * Destinatários atuais de uma conversa (membros, ou ativos no Geral).
 *
 * Uso pós-commit nas escritas que não devolvem a lista na mesma transação
 * (editar, apagar, membros…). Quem alcança ainda é o banco; aqui só se lê.
 */
export async function chatRecipientIds(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
): Promise<string[]> {
  const id = exigirUuid(conversationId, 'Conversa');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [r] = await tx`select ideworks.chat_recipient_ids(${id}::uuid) as ids`;
      return ((r?.ids as string[] | null) ?? []).filter(Boolean);
    } catch (e) {
      traduzir(e);
    }
  });
}

/** Quem aparece no menu @ desta conversa (F20.8). */
export async function listChatMentionable(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
): Promise<ChatPerson[]> {
  const id = exigirUuid(conversationId, 'Conversa');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`
        select id, name from ideworks.mentionable_people_in_chat(${id}::uuid)`;
      return rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
      }));
    } catch (e) {
      traduzir(e);
    }
  });
}

/**
 * Alvos para reconciliar o sino de uma mensagem alcançável.
 * A caixa chat_mentions é privada do destinatário, portanto o autor não pode
 * consultá-la. Lemos o texto sob RLS e cruzamos os tokens com os candidatos
 * autorizados pelo banco. O evento apenas pede releitura da caixa privada.
 */
export async function chatMentionRecipientIds(
  sql: Sql,
  actor: AuthenticatedActor,
  messageId: string,
): Promise<string[]> {
  const id = exigirUuid(messageId, 'Mensagem');
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // Mesmo formato aceito por mentioned_people no gatilho (F17.82).
      const padrao = String.raw`@\[[^\]\r\n]{1,120}\]\(mention:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)`;
      const rows = await tx`
        select distinct p.id as recipient_id
          from ideworks.messages m
          cross join lateral regexp_matches(m.body, ${padrao}, 'g') token
          join lateral ideworks.mentionable_people_in_chat(m.conversation_id) p
            on p.id = token[1]::uuid
         where m.id = ${id}::uuid
           and m.kind = 'person' and m.deleted_at is null
           and p.id <> m.author_id`;
      return rows.map((r) => r.recipient_id as string).filter(Boolean);
    } catch (e) {
      traduzir(e);
    }
  });
}

/* ───────────────────────────── reações (F24.2) ───────────────────────────── */

/**
 * Alterna a reação do ator numa mensagem: grava, troca ou tira.
 *
 * O emoji é conferido aqui contra a lista fechada — recusa mais barata que
 * deixar o Postgres devolver `22P02` cru para um valor fora do enum.
 * O resto (alcance, lápide, linha de sistema, janela de 30 dias) é do banco,
 * e a lista de destinatários vem na mesma transação, como no envio.
 */
export async function toggleChatReaction(
  sql: Sql,
  actor: AuthenticatedActor,
  messageId: string,
  emoji: unknown,
): Promise<ToggledChatReaction> {
  const id = exigirUuid(messageId, 'Mensagem');
  if (!isChatReactionEmoji(emoji)) {
    throw new ChatRefused('Escolha um dos seis emojis de reação.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`select * from ideworks.toggle_chat_reaction(
        ${id}::uuid, ${emoji}::ideworks.chat_reaction_emoji)`;
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new ChatRefused('Mensagem não encontrada.', 404);
      return {
        ...mapReactionChange(row),
        conversationId: row.conversation_id as string,
        recipientIds: ((row.recipient_ids as string[] | null) ?? []).filter(Boolean),
      };
    } catch (e) {
      traduzir(e);
    }
  });
}

/** Os ids de um lote de reações, validados — com o teto de 500. */
function validarIdsDeReacoes(messageIds: readonly string[]): string[] {
  const ids = messageIds.map((x, i) => exigirUuid(x, `Mensagem ${i + 1}`));
  if (ids.length > 500) {
    throw new ChatRefused('Peça as reações de no máximo 500 mensagens por vez.', 400);
  }
  return ids;
}

/** As reações vivas do lote, no `tx` de quem chama. Lote vazio não vai ao banco. */
async function lerReacoes(tx: Tx, conversationId: string, ids: readonly string[]): Promise<ChatReaction[]> {
  if (ids.length === 0) return [];
  try {
    const rows = await tx`select * from ideworks.list_chat_reactions(
      ${inlineUuid(tx, conversationId)}::uuid, ${inlineUuidList(tx, ids)}::uuid[])`;
    return rows.map((r) => mapReaction(r as Record<string, unknown>));
  } catch (e) {
    traduzir(e);
  }
}

/** Reações vivas de um lote de mensagens — o rodapé nasce certo (teto de 500). */
export async function listChatReactions(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  messageIds: readonly string[],
): Promise<ChatReaction[]> {
  const id = exigirUuid(conversationId, 'Conversa');
  const ids = validarIdsDeReacoes(messageIds);
  if (ids.length === 0) return [];
  return withActor(sql, asDbActor(actor), (tx) => lerReacoes(tx, id, ids));
}

/** O que mudou nas reações desde um instante — inclui remoção (`removed`). */
export async function listChatReactionChanges(
  sql: Sql,
  actor: AuthenticatedActor,
  conversationId: string,
  since: string,
): Promise<ChatReactionChange[]> {
  const id = exigirUuid(conversationId, 'Conversa');
  if (!since || Number.isNaN(Date.parse(since))) {
    throw new ChatRefused('Informe o momento de referência (since).', 400);
  }
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const rows = await tx`select * from ideworks.list_chat_reaction_changes(
        ${inlineUuid(tx, id)}::uuid, ${since}::timestamptz)`;
      return rows.map((r) => mapReactionChange(r as Record<string, unknown>));
    } catch (e) {
      traduzir(e);
    }
  });
}

/* Limpeza com imagens: ver `purgeExpiredChatMessages` em chat-imagens.ts (F20.7). */
