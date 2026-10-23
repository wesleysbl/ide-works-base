/**
 * Aviso à central de entrega ao vivo — F20.4.
 *
 * Sempre DEPOIS do commit. Falha aqui NÃO falha a escrita HTTP: a mensagem já
 * está no banco; quem perdeu o evento alcança ao reconectar.
 */

import {
  CHAT_CENTRAL_NAME,
  type ChatLiveEvent,
  type ChatLiveMessagePayload,
} from '@/server/chat-live';
import type { ChatMessage } from '@/server/chat';

/** Stub mínimo: só o que o Worker chama na central. */
export type ChatCentralStub = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type ChatCentralBinding = {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): ChatCentralStub;
};

export type EnvComCentral = {
  CHAT_CENTRAL?: ChatCentralBinding;
};

function stub(env: EnvComCentral): ChatCentralStub | null {
  if (!env.CHAT_CENTRAL) return null;
  return env.CHAT_CENTRAL.get(env.CHAT_CENTRAL.idFromName(CHAT_CENTRAL_NAME));
}

async function post(
  env: EnvComCentral,
  path: string,
  body: unknown,
): Promise<void> {
  const s = stub(env);
  if (!s) return;
  const resposta = await s.fetch(new Request(`https://chat-central.internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  if (!resposta.ok) {
    throw new Error(`Central do chat respondeu HTTP ${resposta.status} em ${path}.`);
  }
}

/** Entrega um evento às conexões das pessoas listadas. Sem destinatário = noop. */
export async function avisarCentral(
  env: EnvComCentral,
  recipientIds: readonly string[],
  event: ChatLiveEvent,
): Promise<void> {
  if (recipientIds.length === 0) return;
  await post(env, '/deliver', { recipientIds, event });
}

/** Um destino falhar não cancela os outros nem encerra waitUntil antes deles. */
export async function concluirAvisos(avisos: Promise<void>[]): Promise<void> {
  const resultados = await Promise.allSettled(avisos);
  const falhas = resultados.filter((r) => r.status === 'rejected');
  if (falhas.length) throw new AggregateError(falhas.map((r) => r.reason), 'Falha na entrega de avisos do chat.');
}

/** Corte ativo: pessoa desativada — derruba as conexões dela na hora. */
export async function derrubarPessoaNaCentral(
  env: EnvComCentral,
  userId: string,
): Promise<void> {
  await post(env, '/disconnect-user', { userId });
}

/** Chave do chat desligada: fecha todas as conexões abertas. */
export async function fecharTodasNaCentral(env: EnvComCentral): Promise<void> {
  await post(env, '/close-all', {});
}

/**
 * Encaminha o upgrade WebSocket já conferido (sessão + origem + chave) à
 * central, carimbado com a pessoa e o momento.
 */
export function entregarConexaoACentral(
  env: EnvComCentral,
  request: Request,
  personId: string,
  connectedAtMs: number,
): Promise<Response> {
  const s = stub(env);
  if (!s) {
    return Promise.resolve(
      new Response('Central de entrega indisponível neste Worker.', { status: 503 }),
    );
  }
  const headers = new Headers(request.headers);
  headers.set('X-Ideworks-Person-Id', personId);
  headers.set('X-Ideworks-Connected-At', String(connectedAtMs));
  // `new Request(request, …)` preserva o upgrade WebSocket do runtime.
  return s.fetch(new Request(request, { headers }));
}

export function mensagemParaEvento(message: ChatMessage): ChatLiveMessagePayload {
  return {
    id: message.id,
    conversationId: message.conversationId,
    authorId: message.authorId,
    body: message.body,
    kind: message.kind,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    clientKey: message.clientKey,
  };
}

/**
 * Dispara o aviso sem segurar a resposta HTTP.
 * `waitUntil` mantém o isolate vivo o bastante para a chamada à central.
 */
export function avisarDepoisDoCommit(
  ctx: { waitUntil(promise: Promise<unknown>): void } | undefined,
  trabalho: () => Promise<void>,
  log: (msg: string, err?: unknown) => void,
): void {
  const p = trabalho().catch((err) => {
    log('aviso à central do chat falhou (envio já gravado)', err);
  });
  if (ctx) ctx.waitUntil(p);
}

/**
 * Termine as consultas ANTES do finally que fecha sql. Só o envio à central
 * vai para waitUntil. Uma falha de preparação após commit também não pode
 * fazer a interface anunciar que a escrita falhou (e repetir a mensagem).
 */
export async function prepararAvisoDepoisDoCommit(
  ctx: { waitUntil(promise: Promise<unknown>): void } | undefined,
  preparar: () => Promise<() => Promise<void>>,
  log: (msg: string, err?: unknown) => void,
): Promise<void> {
  try {
    const enviar = await preparar();
    avisarDepoisDoCommit(ctx, enviar, log);
  } catch (err) {
    log('preparação do aviso do chat falhou (escrita já gravada)', err);
  }
}
