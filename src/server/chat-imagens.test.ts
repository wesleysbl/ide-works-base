/**
 * Limpeza e upload de imagens do chat — F20.7.
 * Molde: src/server/imagens-temporarias.test.ts (F17.81).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Sql } from '@/server/db';
import {
  deleteChatMessageWithImages,
  purgeExpiredChatMessages,
  uploadChatImageDraft,
} from '@/server/chat-imagens';

vi.mock('@/server/db', () => ({
  withActor: (sql: unknown, _actor: unknown, action: (tx: unknown) => unknown) => action(sql),
}));

const storage = { supabaseUrl: 'https://storage.invalid', serviceKey: 'test-only' };
const ator = {
  userId: '00000000-0000-0000-0000-000000000001',
  email: 'teste@example.invalid',
  papel: 'funcionario' as const,
  isSuperadmin: false,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: false,
};

afterEach(() => vi.unstubAllGlobals());

/** PNG 1×1 mínimo (assinatura válida). */
function pngMinimo(): ArrayBuffer {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return bytes.buffer;
}

describe('limpeza de imagens e mensagens do chat', () => {
  it('remove bytes antes do registro e preserva falhas para nova tentativa', async () => {
    const chamadas: string[] = [];
    const tx = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      chamadas.push(sql);
      if (sql.includes('expired_chat_draft_images')) {
        return Promise.resolve([
          { id: 'a', storage_path: 'chat/c/a.png' },
          { id: 'b', storage_path: 'chat/c/b.png' },
          { id: 'c', storage_path: 'chat/c/c.png' },
        ]);
      }
      if (sql.includes('expired_chat_messages_for_purge')) {
        return Promise.resolve([]);
      }
      if (sql.includes('finish_expired_chat_draft_image')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new Error('rede'));
    vi.stubGlobal('fetch', fetch);

    expect(await purgeExpiredChatMessages(tx as unknown as Sql, storage)).toEqual({
      removed: 1,
      failed: 2,
    });
    expect(fetch).toHaveBeenCalled();
    expect(chamadas.some((c) => c.includes('finish_expired_chat_draft_image'))).toBe(true);
  });

  it('retenta quando os bytes saíram e a confirmação no banco falhou', async () => {
    let rodada = 0;
    const tx = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('expired_chat_draft_images')) {
        rodada += 1;
        return Promise.resolve(
          rodada <= 2 ? [{ id: 'a', storage_path: 'chat/c/a.png' }] : [],
        );
      }
      if (sql.includes('finish_expired_chat_draft_image')) {
        if (rodada === 1) return Promise.reject(new Error('banco'));
        return Promise.resolve([]);
      }
      if (sql.includes('expired_chat_messages_for_purge')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));

    expect(await purgeExpiredChatMessages(tx as unknown as Sql, storage)).toEqual({
      removed: 0,
      failed: 1,
    });
    expect(await purgeExpiredChatMessages(tx as unknown as Sql, storage)).toEqual({
      removed: 1,
      failed: 0,
    });
  });

  it('mensagem vencida com falha de armazenamento permanece; na volta seguinte bytes→registro→mensagem', async () => {
    const msg = '00000000-0000-0000-0000-000000000099';
    const ordem: string[] = [];
    let finishMsg = 0;
    let imagemAindaExiste = true;
    const tx = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('expired_chat_draft_images')) return Promise.resolve([]);
      if (sql.includes('expired_chat_messages_for_purge')) {
        return Promise.resolve(imagemAindaExiste || finishMsg === 0 ? [{ message_id: msg }] : []);
      }
      if (sql.includes('chat_images_of_message')) {
        return Promise.resolve(
          imagemAindaExiste ? [{ id: 'img1', storage_path: 'chat/c/x.png' }] : [],
        );
      }
      if (sql.includes('finish_chat_image_row')) {
        ordem.push('registro');
        imagemAindaExiste = false;
        return Promise.resolve([]);
      }
      if (sql.includes('finish_expired_chat_message')) {
        ordem.push('mensagem');
        finishMsg += 1;
        return Promise.resolve([{ ok: true }]);
      }
      return Promise.resolve([]);
    });

    // 1ª volta: armazenamento falha — mensagem e registro ficam.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const falha = await purgeExpiredChatMessages(tx as unknown as Sql, storage);
    expect(falha.failed).toBeGreaterThanOrEqual(1);
    expect(finishMsg).toBe(0);
    expect(imagemAindaExiste).toBe(true);
    expect(ordem).toEqual([]);

    // 2ª volta: armazenamento responde — bytes, depois registro, depois mensagem.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        ordem.push('bytes');
        return new Response('[]', { status: 200 });
      }),
    );
    const ok = await purgeExpiredChatMessages(tx as unknown as Sql, storage);
    expect(ok.removed).toBe(1);
    expect(ok.failed).toBe(0);
    expect(finishMsg).toBe(1);
    expect(ordem).toEqual(['bytes', 'registro', 'mensagem']);
  });

  it('diz POR QUE cada remoção falhou, dos rascunhos e das mensagens', async () => {
    const msg = '00000000-0000-0000-0000-000000000077';
    const tx = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('expired_chat_draft_images')) {
        return Promise.resolve([{ id: 'd1', storage_path: 'chat/c/d1.png' }]);
      }
      if (sql.includes('expired_chat_messages_for_purge')) return Promise.resolve([{ message_id: msg }]);
      if (sql.includes('chat_images_of_message')) {
        return Promise.resolve([{ id: 'img1', storage_path: 'chat/c/x.png' }]);
      }
      return Promise.resolve([]);
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const registro: string[] = [];

    await purgeExpiredChatMessages(tx as unknown as Sql, storage, (m) => registro.push(m));

    expect(registro.some((m) => /d1/.test(m) && /401/.test(m))).toBe(true);
    expect(registro.some((m) => m.includes(msg) && /401/.test(m))).toBe(true);
    expect(JSON.stringify(registro)).not.toContain('test-only');
  });

  it('sem chave não apaga nem consulta registros', async () => {
    const tx = vi.fn();
    await expect(
      purgeExpiredChatMessages(tx as unknown as Sql, { supabaseUrl: storage.supabaseUrl }),
    ).rejects.toThrow();
    expect(tx).not.toHaveBeenCalled();
  });
});

describe('upload de rascunho do chat', () => {
  it('recusa imagem falsa antes de acessar banco ou Storage', async () => {
    const tx = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      uploadChatImageDraft(
        tx as unknown as Sql,
        ator,
        storage,
        '00000000-0000-0000-0000-000000000010',
        {
          fileName: 'print.png',
          contentType: 'image/png',
          bytes: new TextEncoder().encode('<html>não é uma imagem</html>').buffer,
        },
      ),
    ).rejects.toThrow(/PNG ou JPEG/);
    expect(tx).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('recusa arquivo acima de 5 MB antes do Storage', async () => {
    const tx = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const grande = new Uint8Array(5 * 1024 * 1024 + 1);
    grande[0] = 0x89;
    grande[1] = 0x50;
    grande[2] = 0x4e;
    grande[3] = 0x47;
    grande[4] = 0x0d;
    grande[5] = 0x0a;
    grande[6] = 0x1a;
    grande[7] = 0x0a;
    await expect(
      uploadChatImageDraft(
        tx as unknown as Sql,
        ator,
        storage,
        '00000000-0000-0000-0000-000000000010',
        {
          fileName: 'grande.png',
          contentType: 'image/png',
          bytes: grande.buffer,
        },
      ),
    ).rejects.toThrow(/teto/i);
    expect(tx).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('compensa os bytes se o banco recusar o registro', async () => {
    const tx = vi
      .fn()
      .mockResolvedValueOnce([{ id: '00000000-0000-0000-0000-000000000010' }])
      .mockRejectedValueOnce(
        Object.assign(new Error('caminho de armazenamento invalido'), { code: '22023' }),
      );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadChatImageDraft(
        tx as unknown as Sql,
        ator,
        storage,
        '00000000-0000-0000-0000-000000000010',
        {
          fileName: 'ok.png',
          contentType: 'image/png',
          bytes: pngMinimo(),
        },
      ),
    ).rejects.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].method).toBe('DELETE');
  });
});

describe('apagar mensagem com imagem', () => {
  const MSG = '00000000-0000-0000-0000-0000000000aa';
  const OUTRO = '00000000-0000-0000-0000-0000000000bb';

  /**
   * Um banco de brinquedo: a mensagem é de `autor`, tem uma imagem, e quem
   * chama alcança a conversa (como qualquer membro do Geral).
   */
  function banco(autor: string) {
    const chamadas: string[] = [];
    const tx = vi.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      chamadas.push(sql);
      if (sql.includes('from ideworks.messages')) return Promise.resolve([{ author_id: autor }]);
      if (sql.includes('chat_images_of_message')) {
        return Promise.resolve([{ id: 'img1', storage_path: 'chat/c/x.png' }]);
      }
      return Promise.resolve([]);
    });
    return { tx, chamadas };
  }

  const apagarMensagem = vi.fn(async () => ({ id: MSG }) as never);

  it('quem não é o autor leva 403 ANTES de os bytes da imagem saírem do balde', async () => {
    // `chat_images_of_message` entrega as imagens de QUALQUER mensagem que o ator
    // alcança, e quem recusa o apagar é só a última etapa (`delete_chat_message`:
    // "só o autor"). Com os bytes apagados na frente, qualquer membro do Geral
    // destruía a imagem de um colega — levava o 403 e a imagem já não existia.
    const { tx, chamadas } = banco(OUTRO);
    const fetch = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      deleteChatMessageWithImages(tx as unknown as Sql, ator, storage, MSG, apagarMensagem),
    ).rejects.toMatchObject({ status: 403 });

    expect(fetch).not.toHaveBeenCalled();
    expect(chamadas.some((c) => c.includes('finish_chat_image_row'))).toBe(false);
    expect(apagarMensagem).not.toHaveBeenCalled();
  });

  it('o autor apaga: bytes, registro e depois a lápide', async () => {
    const { tx, chamadas } = banco(ator.userId);
    const ordem: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        ordem.push('bytes');
        return new Response('[]', { status: 200 });
      }),
    );
    const lapide = vi.fn(async () => {
      ordem.push('lapide');
      return { id: MSG } as never;
    });

    await deleteChatMessageWithImages(tx as unknown as Sql, ator, storage, MSG, lapide);

    expect(chamadas.some((c) => c.includes('finish_chat_image_row'))).toBe(true);
    expect(ordem).toEqual(['bytes', 'lapide']);
  });

  it('mensagem que a pessoa nem alcança segue o caminho de sempre (a lápide recusa)', async () => {
    const tx = vi.fn().mockResolvedValue([]);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const recusa = vi.fn(async () => {
      throw new Error('mensagem não encontrada');
    });
    await expect(
      deleteChatMessageWithImages(tx as unknown as Sql, ator, storage, MSG, recusa),
    ).rejects.toThrow('mensagem não encontrada');
    expect(fetch).not.toHaveBeenCalled();
  });
});
