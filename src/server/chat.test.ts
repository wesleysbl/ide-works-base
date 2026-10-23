/**
 * F20.3 — chave do chat e módulo de servidor.
 *
 * A sessão sem crachá é da borda (`resolveActor`); o token de integração é
 * recusado antes da API humana (testado em `integrations/handler.test.ts`).
 * Aqui medimos o que este módulo decide: a chave e as chamadas às funções.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';
import {
  ChatRefused,
  assertChatAllowed,
  chatModeFromEnv,
  listChatReactionChanges,
  listChatReactions,
  listMyChatConversations,
  sendChatMessage,
  toggleChatReaction,
} from '@/server/chat';

vi.mock('@/server/db', () => ({
  withActor: (sql: unknown, _actor: unknown, run: (tx: unknown) => unknown) => run(sql),
  arrayOuNulo: <T>(v: readonly T[] | null | undefined) => (v && v.length > 0 ? [...v] : null),
}));

const funcionario = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'func@example.invalid',
  papel: 'funcionario',
  isSuperadmin: false,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: false,
} as AuthenticatedActor;

const superAdmin = {
  ...funcionario,
  userId: '00000000-0000-0000-0000-000000000099',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
} as AuthenticatedActor;

type Query = { text: string; values: unknown[] };

function database(responder?: (q: Query) => unknown[]) {
  const queries: Query[] = [];
  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    const q: Query = { text: strings[0], values: [] };
    args.forEach((arg, i) => {
      q.text += '?';
      q.values.push(arg);
      q.text += strings[i + 1];
    });
    return Object.assign(q, {
      then(resolve: (rows: unknown[]) => void, reject?: (e: unknown) => void) {
        queries.push(q);
        try {
          resolve(responder ? responder(q) : []);
        } catch (e) {
          if (reject) reject(e);
          else throw e;
        }
      },
    });
  }) as unknown as Tx;
  return { sql: tx as unknown as Sql, queries };
}

describe('chave do chat (IDEWORKS_CHAT)', () => {
  it('ausente e texto inválido caem em desligado', () => {
    expect(chatModeFromEnv(undefined)).toBe('desligado');
    expect(chatModeFromEnv('')).toBe('desligado');
    expect(chatModeFromEnv('true')).toBe('desligado');
    expect(chatModeFromEnv('on')).toBe('desligado');
    expect(chatModeFromEnv('DESLIGADO')).toBe('desligado');
  });

  it('reconhece os três estados, sem case', () => {
    expect(chatModeFromEnv('ligado')).toBe('ligado');
    expect(chatModeFromEnv('LIGADO')).toBe('ligado');
    expect(chatModeFromEnv(' piloto ')).toBe('piloto');
    expect(chatModeFromEnv('desligado')).toBe('desligado');
  });

  it('desligado recusa todo mundo', () => {
    expect(() => assertChatAllowed('desligado', true)).toThrow(ChatRefused);
    expect(() => assertChatAllowed('desligado', false)).toThrow(/desligado/i);
  });

  it('piloto só super admin', () => {
    expect(() => assertChatAllowed('piloto', false)).toThrow(/piloto/i);
    expect(() => assertChatAllowed('piloto', true)).not.toThrow();
  });

  it('ligado passa para qualquer autenticado', () => {
    expect(() => assertChatAllowed('ligado', false)).not.toThrow();
    expect(() => assertChatAllowed('ligado', true)).not.toThrow();
  });
});

describe('listMyChatConversations', () => {
  it('chama a função de domínio sob o ator e mapeia a lista', async () => {
    const { sql, queries } = database(() => [
      {
        conversation_id: '00000000-0000-0000-0000-000000000010',
        kind: 'general',
        name: 'Geral',
        archived_at: null,
        last_message_id: null,
        last_message_body: null,
        last_message_kind: null,
        last_message_author_id: null,
        last_message_at: null,
        last_message_deleted_at: null,
        unread_count: '0',
        last_read_at: null,
        my_role: null,
        peer_user_id: null,
        peer_name: null,
        peer_is_active: null,
        members: [],
      },
    ]);

    const lista = await listMyChatConversations(sql, funcionario);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      id: '00000000-0000-0000-0000-000000000010',
      kind: 'general',
      name: 'Geral',
      unreadCount: 0,
      lastMessage: null,
      lastReadAt: null,
      myRole: null,
      peerUserId: null,
      members: [],
    });
    expect(queries[0].text).toContain('list_my_chat_conversations()');
  });

  it('a frase e o SQLSTATE do banco chegam como ChatRefused', async () => {
    const { sql } = database(() => {
      const err = new Error('voce nao alcanca esta conversa') as Error & { code: string };
      err.code = '42501';
      throw err;
    });
    await expect(listMyChatConversations(sql, funcionario)).rejects.toMatchObject({
      name: 'ChatRefused',
      status: 403,
      message: expect.stringMatching(/alcanca|alcance/i),
    });
  });
});

describe('sendChatMessage', () => {
  it('devolve a mensagem gravada para a tela confirmar o envio', async () => {
    const conv = '00000000-0000-0000-0000-000000000010';
    const { sql, queries } = database(() => [
      {
        message_id: '00000000-0000-0000-0000-000000000020',
        conversation_id: conv,
        author_id: funcionario.userId,
        body: 'oi',
        kind: 'person',
        created_at: '2026-09-21T12:00:00Z',
        edited_at: null,
        deleted_at: null,
        client_key: 'k1',
        recipient_ids: [funcionario.userId, superAdmin.userId],
      },
    ]);

    const msg = await sendChatMessage(sql, funcionario, conv, 'oi', 'k1');
    expect(msg).toMatchObject({
      id: '00000000-0000-0000-0000-000000000020',
      body: 'oi',
      clientKey: 'k1',
      recipientIds: [funcionario.userId, superAdmin.userId],
    });
    expect(queries[0].text).toContain('send_chat_message');
  });

  it('valida entrada antes de tocar no banco', async () => {
    const { sql, queries } = database();
    await expect(sendChatMessage(sql, funcionario, 'nao-uuid', 'oi', 'k')).rejects.toThrow(
      /inválido/i,
    );
    await expect(
      sendChatMessage(sql, funcionario, '00000000-0000-0000-0000-000000000010', '', 'k'),
    ).rejects.toThrow(/mensagem/i);
    expect(queries).toHaveLength(0);
  });

  it('teto por minuto (54000) vira 429 com a frase do banco', async () => {
    const { sql } = database(() => {
      const err = new Error(
        'limite de 30 mensagens por minuto; espere um pouco e tente de novo',
      ) as Error & { code: string };
      err.code = '54000';
      throw err;
    });
    await expect(
      sendChatMessage(
        sql,
        funcionario,
        '00000000-0000-0000-0000-000000000010',
        'oi',
        'k2',
      ),
    ).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/30 mensagens/i) });
  });
});

describe('sendChatMessage com imagem', () => {
  it('aceita corpo vazio quando há imageIds', async () => {
    const { sql, queries } = database(() => [
      {
        message_id: '00000000-0000-0000-0000-000000000020',
        conversation_id: '00000000-0000-0000-0000-000000000010',
        author_id: funcionario.userId,
        body: '![Imagem anexada](attachment:00000000-0000-0000-0000-000000000030)',
        kind: 'person',
        created_at: '2026-09-21T12:00:00Z',
        edited_at: null,
        deleted_at: null,
        client_key: 'k-img',
        recipient_ids: [funcionario.userId],
      },
    ]);
    const r = await sendChatMessage(
      sql,
      funcionario,
      '00000000-0000-0000-0000-000000000010',
      '',
      'k-img',
      ['00000000-0000-0000-0000-000000000030'],
    );
    expect(r.id).toBe('00000000-0000-0000-0000-000000000020');
    expect(queries[0].text).toContain('send_chat_message');
  });

  it('recusa corpo vazio sem imagem', async () => {
    const { sql } = database();
    await expect(
      sendChatMessage(
        sql,
        funcionario,
        '00000000-0000-0000-0000-000000000010',
        '   ',
        'k-vazio',
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/escreva/i) });
  });
});

describe('reações do chat (F24.2)', () => {
  const msg = '00000000-0000-0000-0000-000000000020';
  const conv = '00000000-0000-0000-0000-000000000010';

  it('alternar devolve o estado final e os destinatários da mesma transação', async () => {
    const { sql, queries } = database(() => [
      {
        message_id: msg,
        conversation_id: conv,
        actor_id: funcionario.userId,
        emoji: '👍',
        reacted_at: '2026-09-22T12:00:00Z',
        removed: false,
        recipient_ids: [funcionario.userId, superAdmin.userId],
      },
    ]);

    const r = await toggleChatReaction(sql, funcionario, msg, '👍');
    expect(r).toMatchObject({
      messageId: msg,
      conversationId: conv,
      actorId: funcionario.userId,
      emoji: '👍',
      removed: false,
      recipientIds: [funcionario.userId, superAdmin.userId],
    });
    expect(queries[0].text).toContain('toggle_chat_reaction');
  });

  it('remoção volta com removed = true', async () => {
    const { sql } = database(() => [
      {
        message_id: msg,
        conversation_id: conv,
        actor_id: funcionario.userId,
        emoji: '👍',
        reacted_at: '2026-09-22T12:05:00Z',
        removed: true,
        recipient_ids: [funcionario.userId],
      },
    ]);
    await expect(toggleChatReaction(sql, funcionario, msg, '👍')).resolves.toMatchObject({
      removed: true,
    });
  });

  it('emoji fora dos seis é barrado antes de tocar no banco', async () => {
    const { sql, queries } = database();
    await expect(toggleChatReaction(sql, funcionario, msg, '🐸')).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/seis emojis/i),
    });
    await expect(toggleChatReaction(sql, funcionario, msg, null)).rejects.toThrow(ChatRefused);
    expect(queries).toHaveLength(0);
  });

  it('mensagem que não é uuid nem chega ao banco', async () => {
    const { sql, queries } = database();
    await expect(toggleChatReaction(sql, funcionario, 'nao-uuid', '👍')).rejects.toThrow(
      /inválid/i,
    );
    expect(queries).toHaveLength(0);
  });

  it('lápide de mensagem (23514) sobe com a frase do banco', async () => {
    const { sql } = database(() => {
      const err = new Error('mensagem apagada nao recebe reacao') as Error & { code: string };
      err.code = '23514';
      throw err;
    });
    await expect(toggleChatReaction(sql, funcionario, msg, '❤️')).rejects.toMatchObject({
      // 400, e não 500: recusa de propósito não é servidor quebrado.
      status: 400,
      message: expect.stringMatching(/apagada/i),
    });
  });

  it('ler um lote vazio não consulta o banco', async () => {
    const { sql, queries } = database();
    await expect(listChatReactions(sql, funcionario, conv, [])).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it('ler um lote mapeia as reações vivas', async () => {
    const { sql, queries } = database(() => [
      {
        message_id: msg,
        actor_id: funcionario.userId,
        emoji: '🙏',
        reacted_at: '2026-09-22T12:00:00Z',
      },
    ]);
    const lista = await listChatReactions(sql, funcionario, conv, [msg]);
    expect(lista).toEqual([
      {
        messageId: msg,
        actorId: funcionario.userId,
        emoji: '🙏',
        reactedAt: '2026-09-22T12:00:00.000Z',
      },
    ]);
    expect(queries[0].text).toContain('list_chat_reactions');
  });

  it('o que mudou desde um instante traz também a removida', async () => {
    const { sql, queries } = database(() => [
      {
        message_id: msg,
        actor_id: funcionario.userId,
        emoji: '😂',
        reacted_at: '2026-09-22T12:10:00Z',
        removed: true,
      },
    ]);
    const lista = await listChatReactionChanges(
      sql,
      funcionario,
      conv,
      '2026-09-22T12:00:00Z',
    );
    expect(lista[0]).toMatchObject({ messageId: msg, emoji: '😂', removed: true });
    expect(queries[0].text).toContain('list_chat_reaction_changes');
  });

  it('since inválido é recusado antes do banco', async () => {
    const { sql, queries } = database();
    await expect(
      listChatReactionChanges(sql, funcionario, conv, 'ontem'),
    ).rejects.toMatchObject({ status: 400 });
    expect(queries).toHaveLength(0);
  });
});
