/**
 * ABRIR UMA CONVERSA DO CHAT, CONTADO NO FIO — perf do servidor, 08/10/2026.
 *
 * `GET /api/chat/conversations/:id/messages` pedia as mensagens numa transação
 * e as reações do mesmo lote em outra, cada uma com o id como parâmetro. Agora
 * são as mesmas duas leituras, com as mesmas validações, numa transação só e com
 * os ids no texto.
 *
 * O QUE ESTE ARQUIVO PROVA (driver real + servidor de fio)
 *   · abrir a conversa: de 12 para 4 idas (begin, mensagens + declaração,
 *     reações, commit); a lista de conversas (a atualização de 30 s) e o
 *     "o que mudou" também perdem a ida do parâmetro;
 *   · o resultado é o das duas funções antigas, chamadas uma depois da outra;
 *   · as mesmas recusas: id torto, cursor torto, lote de reações grande demais.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ChatRefused,
  listChatMessageChanges,
  listChatMessages,
  listChatMessagesWithReactions,
  listChatReactions,
  listMyChatConversations,
} from '@/server/chat';
import type { Sql } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CONVERSA = id(1);
const EU = id(99);
const ator: AuthenticatedActor = {
  userId: EU,
  email: 'eu@ide.com',
  papel: 'funcionario',
  isSuperadmin: false,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: false,
};

const COLUNAS_DA_MENSAGEM = ['id', 'conversation_id', 'author_id', 'body', 'kind', 'created_at', 'edited_at', 'deleted_at', 'client_key'];
const mensagem = (n: number) => [id(100 + n), CONVERSA, EU, `Oi ${n}`, 'text', `2026-10-08T12:0${n}:00.000Z`, null, null, null];

describe('chat — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      { quando: /list_chat_messages/, colunas: COLUNAS_DA_MENSAGEM, linhas: () => [mensagem(1), mensagem(2), mensagem(3)] },
      {
        quando: /list_chat_reactions/,
        colunas: ['message_id', 'actor_id', 'emoji', 'reacted_at'],
        linhas: (p) => [[id(101), EU, '👍', '2026-10-08T12:05:00.000Z'], [id(102), EU, '❤️', `${p.length}`]],
      },
      { quando: /list_chat_message_changes/, colunas: COLUNAS_DA_MENSAGEM, linhas: () => [mensagem(4)] },
      { quando: /list_my_chat_conversations/, colunas: ['id', 'kind', 'name'], linhas: () => [] },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('abrir a conversa (mensagens + reações): 4 idas, sem parâmetro — eram 12', async () => {
    falso.zerar();
    const { messages, reactions } = await listChatMessagesWithReactions(sql, ator, CONVERSA);
    expect(messages.map((m) => m.body)).toEqual(['Oi 1', 'Oi 2', 'Oi 3']);
    expect(reactions).toHaveLength(2);
    // Antes (medido em 2264a4f): 12 idas — duas transações (begin, set_config (2), consulta (2), commit).
    expect(falso.idas).toHaveLength(4);
    expect(falso.parametros.flat()).toEqual([]);
    // As reações pediram exatamente os ids que as mensagens trouxeram.
    const consultaDasReacoes = falso.consultas.find((c) => c.includes('list_chat_reactions')) ?? '';
    expect(consultaDasReacoes).toContain(`array['${id(101)}','${id(102)}','${id(103)}']`);
  });

  it('o resultado é o das duas funções antigas, uma depois da outra', async () => {
    const junto = await listChatMessagesWithReactions(sql, ator, CONVERSA);
    const mensagens = await listChatMessages(sql, ator, CONVERSA);
    const reacoes = await listChatReactions(sql, ator, CONVERSA, mensagens.map((m) => m.id));
    expect(junto).toEqual({ messages: mensagens, reactions: reacoes });
  });

  it('com cursor de histórico: o cursor também vai no texto', async () => {
    falso.zerar();
    await listChatMessagesWithReactions(sql, ator, CONVERSA, { beforeAt: '2026-10-08T12:00:00.000Z', beforeId: id(50) });
    expect(falso.parametros.flat()).toEqual(['2026-10-08T12:00:00.000Z']);
    expect(falso.consultas.some((c) => c.includes(`'${id(50)}'::uuid`))).toBe(true);
  });

  it('o "o que mudou" e a lista de conversas: 3 idas cada, sem a ida do tipo do parâmetro de id', async () => {
    falso.zerar();
    await listMyChatConversations(sql, ator);
    expect(falso.idas).toHaveLength(3);
    falso.zerar();
    await listChatMessageChanges(sql, ator, CONVERSA, '2026-10-08T12:00:00.000Z');
    // O `since` continua parâmetro (instante digitado pelo cliente): duas idas na consulta.
    expect(falso.idas).toHaveLength(4);
    expect(falso.consultas.some((c) => c.includes(`'${CONVERSA}'::uuid`))).toBe(true);
  });

  it('as mesmas recusas de antes: id torto, cursor torto, lote grande, e nada vai ao banco', async () => {
    falso.zerar();
    await expect(listChatMessagesWithReactions(sql, ator, 'nao-e-uuid')).rejects.toBeInstanceOf(ChatRefused);
    await expect(
      listChatMessagesWithReactions(sql, ator, CONVERSA, { beforeAt: 'ontem', beforeId: id(50) }),
    ).rejects.toMatchObject({ status: 400, message: 'Cursor de histórico inválido.' });
    await expect(
      listChatReactions(sql, ator, CONVERSA, Array.from({ length: 501 }, (_, i) => id(1000 + i))),
    ).rejects.toMatchObject({ status: 400 });
    expect(falso.consultas).toEqual([]);
  });
});
