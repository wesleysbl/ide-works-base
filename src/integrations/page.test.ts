/**
 * O cursor de página (`page.ts`) — o que ele aceita e o que recusa antes de a
 * chave descer ao SQL. Os cursores forjados que chegam ao banco estão em
 * `leituras-cruzadas-banco.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { decodePageCursor, encodePageCursor, parsePageRequest } from '@/integrations/page';

const forjar = (cursor: Record<string, unknown>) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

describe('decodePageCursor', () => {
  it('ida e volta: o que a ferramenta entrega, ela lê', () => {
    const cursor = encodePageCursor({ v: 1, k: 'atrasada de vídeo', id: '00000000-0000-4000-8000-000000000001' });
    expect(decodePageCursor(cursor)).toEqual({
      ok: true,
      cursor: { v: 1, k: 'atrasada de vídeo', id: '00000000-0000-4000-8000-000000000001' },
    });
  });

  it('recusa cursor com NUL na chave ou no id: o Postgres não guarda NUL em texto e viraria erro interno', () => {
    for (const cursor of [
      { v: 1, k: 'a\u0000b', id: 'x' },
      { v: 1, k: 'a', id: 'x\u0000' },
      { v: 1, k: '\u0000', id: '\u0000' },
    ]) {
      expect(decodePageCursor(forjar(cursor))).toMatchObject({ ok: false });
      expect(parsePageRequest({ cursor: forjar(cursor) })).toMatchObject({ ok: false, code: 'invalid_cursor' });
    }
  });

  it('continua recusando o que já recusava', () => {
    expect(decodePageCursor('lixo!')).toMatchObject({ ok: false });
    expect(decodePageCursor(forjar({ v: 2, k: 'a', id: 'b' }))).toMatchObject({ ok: false });
    expect(decodePageCursor(forjar({ v: 1, k: '', id: 'b' }))).toMatchObject({ ok: false });
    expect(decodePageCursor(forjar({ v: 1, k: 'a' }))).toMatchObject({ ok: false });
  });
});
