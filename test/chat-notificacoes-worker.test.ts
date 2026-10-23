/** Rotas reais: fanout continua após sql.end sem reusar a conexão encerrada. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { chatMentionRecipientIds } from '@/server/chat';

const estado = vi.hoisted(() => ({ fechado: false, consultas: 0 }));
const conv = '00000000-0000-0000-0000-000000000010';
const mensagem = '00000000-0000-0000-0000-000000000020';
const eu = '00000000-0000-0000-0000-000000000001';
const outro = '00000000-0000-0000-0000-000000000002';
vi.mock('@/server/db', async (original) => ({
  ...await original<typeof import('@/server/db')>(),
  connect: () => ({ end: async () => { estado.fechado = true; } }),
}));
vi.mock('@/server/session', async (original) => ({
  ...await original<typeof import('@/server/session')>(),
  resolveActor: async () => ({ ok: true, actor: { userId: eu, isSuper: false } }),
}));
vi.mock('@/server/chat', async (original) => {
  const conferir = async () => {
    await Promise.resolve();
    if (estado.fechado) throw new Error('consulta depois de sql.end');
    estado.consultas++;
  };
  const escrita = async () => {
    await conferir();
    return { id: mensagem, conversationId: conv, authorId: eu, body: 'Oi', kind: 'person',
      recipientIds: [eu, outro], createdAt: '2026-09-26T10:00:00Z', editedAt: null, deletedAt: null, clientKey: 'k' };
  };
  return {
    ...await original<typeof import('@/server/chat')>(),
    sendChatMessage: escrita, editChatMessage: escrita,
    markConversationRead: async () => { await conferir(); return '2026-09-26T10:00:00Z'; },
    addConversationMember: conferir, removeConversationMember: conferir, leaveConversation: conferir,
    transferConversationOwnership: conferir, renameConversation: conferir,
    chatRecipientIds: async () => { await conferir(); return [eu, outro]; },
    chatMentionRecipientIds: vi.fn(async () => { await conferir(); return [outro]; }),
  };
});
vi.mock('@/server/chat-imagens', async (original) => ({
  ...await original<typeof import('@/server/chat-imagens')>(),
  deleteChatMessageWithImages: async () => ({ id: mensagem, conversationId: conv,
    authorId: eu, body: '', kind: 'person', deletedAt: '2026-09-26T10:00:00Z' }),
}));

beforeEach(() => { estado.fechado = false; estado.consultas = 0; });
afterEach(() => { vi.restoreAllMocks(); });

async function chamar(method: string, path: string) {
  const entregas: Array<{ recipientIds: string[]; event: { type: string } }> = [];
  const resolver: Array<(r: Response) => void> = [];
  const pendentes: Promise<unknown>[] = [];
  const resposta = await worker.fetch(new Request(`https://app.invalid/api/chat/${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Oi', clientKey: 'k', userId: outro, readAt: '2026-09-26T10:00:00Z' }),
  }), {
    IDEWORKS_CHAT: 'ligado', IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
    IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
    CHAT_CENTRAL: {
      idFromName: () => ({ toString: () => 'central' }),
      get: () => ({ fetch: async (request: RequestInfo | URL) => {
        entregas.push(await (request as Request).json());
        return new Promise<Response>((r) => resolver.push(r));
      } }),
    } as unknown as NonNullable<Parameters<typeof worker.fetch>[1]['CHAT_CENTRAL']>,
  }, { waitUntil: (p) => { pendentes.push(p); } });
  // A central lê o corpo do aviso de forma assíncrona, e quantos ciclos isso
  // leva muda entre versões do Node. Uma volta do laço de eventos basta.
  await new Promise<void>((r) => setTimeout(r, 0));
  return { resposta, entregas, resolver, pendentes };
}

it.each([
  ['POST', `conversations/${conv}/messages`, 201, 'message_new'],
  ['PATCH', `messages/${mensagem}`, 200, 'message_edited'],
  ['DELETE', `messages/${mensagem}`, 200, 'message_deleted'],
  ['POST', `conversations/${conv}/members`, 200, 'conversation_changed'],
  ['DELETE', `conversations/${conv}/members/${outro}`, 200, 'conversation_changed'],
  ['POST', `conversations/${conv}/ownership`, 200, 'conversation_changed'],
  ['PATCH', `conversations/${conv}`, 200, 'conversation_changed'],
  ['POST', `conversations/${conv}/read`, 200, 'conversation_read'],
])('%s %s prepara SQL antes do finally e entrega depois', async (method, path, status, evento) => {
  const r = await chamar(method as string, path as string);
  expect(r.resposta.status).toBe(status);
  expect(estado.fechado).toBe(true);
  const consultas = estado.consultas;
  expect(r.entregas[0].event.type).toBe(evento);
  // Libere os avisos à central sem interromper o trabalho em segundo plano.
  for (let i = 0; i < 3; i++) {
    r.resolver.splice(0).forEach((resolve) => resolve(new Response('{}')));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await Promise.all(r.pendentes);
  expect(estado.consultas).toBe(consultas);
  if (evento.toString().startsWith('message_')) {
    expect(r.entregas.find((e) => e.event.type === 'chat_mention')?.recipientIds).toEqual([outro]);
  }
});

it('consulta de menções falha após commit: mantém 201 e entrega message_new', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(chatMentionRecipientIds).mockRejectedValueOnce(new Error('banco indisponível'));
  const r = await chamar('POST', `conversations/${conv}/messages`);
  expect(r.resposta.status).toBe(201);
  expect(r.entregas.map((e) => e.event.type)).toEqual(['message_new']);
  r.resolver.forEach((resolve) => resolve(new Response('{}')));
  await Promise.all(r.pendentes);
  expect(log).toHaveBeenCalled();
});

it('HTTP 503 é registrado e waitUntil espera o outro aviso pendente', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const r = await chamar('POST', `conversations/${conv}/messages`);
  let terminou = false;
  void Promise.all(r.pendentes).then(() => { terminou = true; });
  r.resolver[0](new Response('falhou', { status: 503 }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(terminou).toBe(false);
  expect(r.resposta.status).toBe(201);
  r.resolver[1](new Response('{}'));
  await Promise.all(r.pendentes);
  expect(log).toHaveBeenCalled();
  expect(String(log.mock.calls[0][1])).toContain('Falha na entrega');
});

it.each([
  ['DELETE', `conversations/${conv}/members/${outro}`, outro],
  ['POST', `conversations/${conv}/leave`, eu],
])('%s %s avisa quem saiu mesmo quando falha o aviso aos demais', async (method, path, saiu) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const r = await chamar(method, path);
  expect(r.resposta.status).toBe(200);
  expect(estado.fechado).toBe(true);
  expect(r.entregas.map((e) => e.event.type)).toEqual(['conversation_changed', 'conversation_left']);
  expect(r.entregas[1].recipientIds).toEqual([saiu]);
  let terminou = false;
  void Promise.all(r.pendentes).then(() => { terminou = true; });
  r.resolver[0](new Response('falhou', { status: 503 }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(terminou).toBe(false);
  r.resolver[1](new Response('{}'));
  await Promise.all(r.pendentes);
  expect(log).toHaveBeenCalled();
});
