/**
 * F20.4 — módulo puro da central de entrega ao vivo.
 */

import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS,
  CONNECTION_MAX_AGE_MS,
  MAX_CONNECTIONS_PER_PERSON,
  connectionIdsToEvictForNewTab,
  connectionsForRecipients,
  isConnectionExpired,
  metaFromTags,
  origemDaPaginaConfere,
  tagsForConnection,
  encodeLiveEvent,
  type ChatLiveEvent,
  type LiveConnectionMeta,
} from '@/server/chat-live';

const conn = (
  personId: string,
  connectedAtMs: number,
  connectionId: string,
): LiveConnectionMeta => ({ personId, connectedAtMs, connectionId });

describe('connectionsForRecipients', () => {
  const lista = [
    conn('a', 1, 'c1'),
    conn('a', 2, 'c2'),
    conn('b', 3, 'c3'),
    conn('c', 4, 'c4'),
  ];

  it('entrega só aos destinatários', () => {
    const r = connectionsForRecipients(lista, ['a', 'b']);
    expect(r.map((x) => x.connectionId).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('evento para pessoa sem conexão é descartado sem erro', () => {
    expect(connectionsForRecipients(lista, ['z'])).toEqual([]);
    expect(connectionsForRecipients(lista, [])).toEqual([]);
  });
});

describe('limite de abas', () => {
  it('com espaço, não fecha ninguém', () => {
    const atuais = [conn('a', 1, 'c1'), conn('a', 2, 'c2'), conn('a', 3, 'c3')];
    expect(connectionIdsToEvictForNewTab(atuais, 4)).toEqual([]);
  });

  it('acima do limite, fecha a mais antiga', () => {
    const atuais = [
      conn('a', 10, 'old'),
      conn('a', 20, 'mid'),
      conn('a', 30, 'new'),
      conn('a', 40, 'newer'),
    ];
    expect(connectionIdsToEvictForNewTab(atuais, MAX_CONNECTIONS_PER_PERSON)).toEqual([
      'old',
    ]);
  });

  it('com excesso maior, fecha várias antigas', () => {
    const atuais = [
      conn('a', 1, 'a'),
      conn('a', 2, 'b'),
      conn('a', 3, 'c'),
      conn('a', 4, 'd'),
      conn('a', 5, 'e'),
    ];
    expect(connectionIdsToEvictForNewTab(atuais, 4)).toEqual(['a', 'b']);
  });
});

describe('validade da conexão', () => {
  it('fecha conexão mais velha que a validade (uma hora)', () => {
    const agora = 10_000_000;
    const viva = conn('a', agora - CONNECTION_MAX_AGE_MS + 1, 'c1');
    const morta = conn('a', agora - CONNECTION_MAX_AGE_MS, 'c2');
    expect(isConnectionExpired(viva, agora)).toBe(false);
    expect(isConnectionExpired(morta, agora)).toBe(true);
  });
});

describe('tags da conexão', () => {
  it('redonda pessoa, instante e id', () => {
    const tags = tagsForConnection('user-1', 12345, 'conn-9');
    expect(metaFromTags(tags)).toEqual({
      personId: 'user-1',
      connectedAtMs: 12345,
      connectionId: 'conn-9',
    });
  });
});

describe('origemDaPaginaConfere', () => {
  it('aceita a mesma origem', () => {
    const r = new Request('https://works.exemplo.com.br/api/chat/live', {
      headers: { Origin: 'https://works.exemplo.com.br' },
    });
    expect(origemDaPaginaConfere(r)).toBe(true);
  });

  it('recusa origem de outro site', () => {
    const r = new Request('https://works.exemplo.com.br/api/chat/live', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(origemDaPaginaConfere(r)).toBe(false);
  });

  it('no desenvolvimento, aceita Vite (:8080) falando com a API (:8787)', () => {
    const r = new Request('http://127.0.0.1:8787/api/chat/live', {
      headers: { Origin: 'http://localhost:8080' },
    });
    expect(origemDaPaginaConfere(r)).toBe(true);
  });

  it('sem Origin nem Referer recusa', () => {
    const r = new Request('https://works.exemplo.com.br/api/chat/live');
    expect(origemDaPaginaConfere(r)).toBe(false);
  });
});

describe('evento de reação (F24.2)', () => {
  it('leva o bastante para a tela achar a bolha e refazer o rodapé', () => {
    const evento: ChatLiveEvent = {
      type: 'chat_reaction',
      conversationId: '00000000-0000-0000-0000-000000000010',
      messageId: '00000000-0000-0000-0000-000000000020',
      actorId: '00000000-0000-0000-0000-000000000001',
      emoji: '👍',
      removed: false,
      reactedAt: '2026-09-22T12:00:00.000Z',
    };
    expect(JSON.parse(encodeLiveEvent(evento))).toEqual(evento);
  });

  it('a remoção viaja com removed = true', () => {
    const evento: ChatLiveEvent = {
      type: 'chat_reaction',
      conversationId: '00000000-0000-0000-0000-000000000010',
      messageId: '00000000-0000-0000-0000-000000000020',
      actorId: '00000000-0000-0000-0000-000000000001',
      emoji: '👍',
      removed: true,
      reactedAt: '2026-09-22T12:05:00.000Z',
    };
    const lido = JSON.parse(encodeLiveEvent(evento));
    expect(lido.type).toBe('chat_reaction');
    expect(lido.removed).toBe(true);
  });
});

describe('o código de fechamento por limite de abas', () => {
  it('é um código de aplicação (4000–4999), distinto dos que a central já usa', () => {
    expect(CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS).toBeGreaterThanOrEqual(4000);
    expect(CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS).toBeLessThanOrEqual(4999);
    // 4001 conta-desativada, 4002 chat-desligado, 4003 sessao-vencida, 4000 o
    // próprio navegador (silêncio).
    expect([4000, 4001, 4002, 4003]).not.toContain(CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS);
  });

  it('a central expulsa a aba antiga com ele — o 1000 comum faria o navegador reconectar na hora', () => {
    const central = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker', 'chat-central.ts'),
      'utf8',
    );
    expect(central).toMatch(
      /connectionIdsToEvictForNewTab\([^)]*\)\)\s*\{[^}]*?this\.closeByConnectionId\(id,\s*CHAT_LIVE_FECHADA_POR_LIMITE_DE_ABAS,/,
    );
  });
});
