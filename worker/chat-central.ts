/**
 * Central de entrega ao vivo — Durable Object com hibernação (F20.4 / D22).
 *
 * UMA central por instalação (`idFromName`). Não guarda mensagem e não decide
 * permissão: só entrega o evento à lista de destinatários que o Worker manda
 * depois do commit no banco.
 */

import { DurableObject } from 'cloudflare:workers';

import {
  CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS,
  CHAT_LIVE_PING,
  CHAT_LIVE_PONG,
  CONNECTION_MAX_AGE_MS,
  connectionIdsToEvictForNewTab,
  connectionsForRecipients,
  encodeLiveEvent,
  isConnectionExpired,
  metaFromTags,
  tagsForConnection,
  type ChatLiveEvent,
  type LiveConnectionMeta,
} from '@/server/chat-live';

type CentralEnv = {
  CHAT_CENTRAL: DurableObjectNamespace;
};

export class ChatCentral extends DurableObject<CentralEnv> {
  constructor(ctx: DurableObjectState, env: CentralEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(CHAT_LIVE_PING, CHAT_LIVE_PONG),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.acceptPerson(request);
    }

    if (url.pathname === '/deliver' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as {
        recipientIds?: unknown;
        event?: ChatLiveEvent;
      } | null;
      if (!body || !Array.isArray(body.recipientIds) || !body.event) {
        return Response.json({ ok: false, message: 'Pedido incompleto.' }, { status: 400 });
      }
      const recipientIds = body.recipientIds.filter((id): id is string => typeof id === 'string');
      this.deliver(recipientIds, body.event);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/disconnect-user' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
      if (!body || typeof body.userId !== 'string') {
        return Response.json({ ok: false, message: 'Informe a pessoa.' }, { status: 400 });
      }
      this.disconnectUser(body.userId);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/close-all' && request.method === 'POST') {
      this.closeAll();
      return Response.json({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  }

  private acceptPerson(request: Request): Response {
    const personId = request.headers.get('X-Ideworks-Person-Id') ?? '';
    const connectedAtRaw = request.headers.get('X-Ideworks-Connected-At') ?? '';
    const connectedAtMs = Number(connectedAtRaw);
    if (!personId || !Number.isFinite(connectedAtMs)) {
      return new Response('Conexão sem carimbo de pessoa.', { status: 400 });
    }

    this.pruneExpired(Date.now());

    const existentes = this.metasForPerson(personId);
    for (const id of connectionIdsToEvictForNewTab(existentes)) {
      // Código próprio: com o 1000 comum a aba expulsa reconecta na hora e
      // expulsa a seguinte — ver `CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS`.
      this.closeByConnectionId(id, CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS, 'aba-limite');
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const connectionId = crypto.randomUUID();
    this.ctx.acceptWebSocket(server, tagsForConnection(personId, connectedAtMs, connectionId));

    return new Response(null, { status: 101, webSocket: client });
  }

  private deliver(recipientIds: string[], event: ChatLiveEvent): void {
    const now = Date.now();
    this.pruneExpired(now);
    const payload = encodeLiveEvent(event);
    const alvos = connectionsForRecipients(this.allMetas(), recipientIds);
    for (const meta of alvos) {
      for (const ws of this.ctx.getWebSockets(`conn:${meta.connectionId}`)) {
        try {
          ws.send(payload);
        } catch {
          // Conexão morta: o próximo prune / close limpa.
        }
      }
    }
  }

  disconnectUser(userId: string): void {
    for (const ws of this.ctx.getWebSockets(`person:${userId}`)) {
      try {
        ws.close(4001, 'conta-desativada');
      } catch {
        /* já fechada */
      }
    }
  }

  closeAll(): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4002, 'chat-desligado');
      } catch {
        /* já fechada */
      }
    }
  }

  private pruneExpired(nowMs: number): void {
    for (const meta of this.allMetas()) {
      if (isConnectionExpired(meta, nowMs, CONNECTION_MAX_AGE_MS)) {
        this.closeByConnectionId(meta.connectionId, 4003, 'sessao-venccida');
      }
    }
  }

  private closeByConnectionId(connectionId: string, code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets(`conn:${connectionId}`)) {
      try {
        ws.close(code, reason);
      } catch {
        /* já fechada */
      }
    }
  }

  private allMetas(): LiveConnectionMeta[] {
    const out: LiveConnectionMeta[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const meta = metaFromTags(this.ctx.getTags(ws));
      if (meta) out.push(meta);
    }
    return out;
  }

  private metasForPerson(personId: string): LiveConnectionMeta[] {
    const out: LiveConnectionMeta[] = [];
    for (const ws of this.ctx.getWebSockets(`person:${personId}`)) {
      const meta = metaFromTags(this.ctx.getTags(ws));
      if (meta) out.push(meta);
    }
    return out;
  }

  async webSocketMessage(): Promise<void> {
    // Sinais de vida (`ping`) respondem via setWebSocketAutoResponse, sem acordar.
    // Qualquer outra mensagem do cliente é ignorada — a central não recebe texto.
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* já fechada */
    }
  }
}
