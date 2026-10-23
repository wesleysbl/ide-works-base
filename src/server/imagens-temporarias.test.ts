import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sql } from '@/server/db';
import { purgeExpiredAttachments, uploadAttachment } from '@/server/board-anexos';

vi.mock('@/server/db', () => ({
  withActor: (sql: unknown, _actor: unknown, action: (tx: unknown) => unknown) => action(sql),
}));
vi.mock('@/server/board-task', () => ({ lerFicha: vi.fn(async () => ({ id: 'tarefa' })) }));

const storage = { supabaseUrl: 'https://storage.invalid', serviceKey: 'test-only' };
afterEach(() => vi.unstubAllGlobals());

describe('limpeza de imagens temporárias', () => {
  it('remove os bytes antes do registro e preserva falhas para nova tentativa', async () => {
    const tx = vi.fn().mockResolvedValueOnce([
      { id: 'a', storage_path: 'tarefa/a.png' },
      { id: 'b', storage_path: 'tarefa/b.png' },
      { id: 'c', storage_path: 'tarefa/c.png' },
    ]).mockResolvedValue([]);
    const fetch = vi.fn()
      .mockImplementationOnce(async () => {
        expect(tx).toHaveBeenCalledTimes(1);
        return new Response('[]', { status: 200 });
      })
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new Error('rede'));
    vi.stubGlobal('fetch', fetch);
    expect(await purgeExpiredAttachments(tx as unknown as Sql, storage))
      .toEqual({ removed: 1, failed: 2 });
    expect(tx).toHaveBeenCalledTimes(2);
    expect(tx.mock.calls[1].slice(1)).toEqual(['a', 'tarefa/a.png']);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ prefixes: ['tarefa/a.png'] });
  });

  it('retenta a remoção quando os bytes já saíram e a confirmação no banco falhou', async () => {
    const item = [{ id: 'a', storage_path: 'tarefa/a.png' }];
    const tx = vi.fn().mockResolvedValueOnce(item).mockRejectedValueOnce(new Error('banco'))
      .mockResolvedValueOnce(item).mockResolvedValueOnce([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    expect(await purgeExpiredAttachments(tx as unknown as Sql, storage)).toEqual({ removed: 0, failed: 1 });
    expect(await purgeExpiredAttachments(tx as unknown as Sql, storage)).toEqual({ removed: 1, failed: 0 });
  });

  it('diz POR QUE cada remoção falhou — falha sem causa no log é falha que ninguém conserta', async () => {
    const tx = vi.fn().mockResolvedValueOnce([
      { id: 'a', storage_path: 'tarefa/a.png' },
      { id: 'b', storage_path: 'tarefa/b.png' },
    ]).mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockRejectedValueOnce(new Error('rede caiu')));
    const registro: Array<[string, unknown]> = [];

    await purgeExpiredAttachments(tx as unknown as Sql, storage, (m, e) => registro.push([m, e]));

    expect(registro).toHaveLength(2);
    expect(registro[0][0]).toMatch(/a\b.*401/);
    expect(registro[1][0]).toMatch(/b\b/);
    expect((registro[1][1] as Error).message).toBe('rede caiu');
    // A chave de serviço nunca vai para o registro.
    expect(JSON.stringify(registro)).not.toContain('test-only');
  });

  it('não inunda o log: cem falhas iguais viram poucas linhas e um resumo', async () => {
    const itens = Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, storage_path: `t/${i}.png` }));
    const tx = vi.fn().mockResolvedValueOnce(itens).mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const linhas: string[] = [];

    const r = await purgeExpiredAttachments(tx as unknown as Sql, storage, (m) => linhas.push(m));

    expect(r.failed).toBe(40);
    expect(linhas.length).toBeLessThanOrEqual(6);
    expect(linhas.at(-1)).toMatch(/40/);
  });

  it('sem chave não apaga nem consulta registros', async () => {
    const tx = vi.fn();
    await expect(purgeExpiredAttachments(tx as unknown as Sql, { supabaseUrl: storage.supabaseUrl }))
      .rejects.toThrow();
    expect(tx).not.toHaveBeenCalled();
  });

  it('recusa imagem temporária falsa antes de acessar banco ou Storage', async () => {
    const tx = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(uploadAttachment(tx as unknown as Sql,
      { userId: 'u', email: 'teste@example.invalid', papel: 'funcionario',
        isSuperadmin: false, isSuper: false, areas: [], hasAllClientsAccess: false }, storage, 'tarefa', {
        fileName: 'print.png', contentType: 'image/png', temporary: true,
        bytes: new TextEncoder().encode('<html>não é uma imagem</html>').buffer,
      })).rejects.toThrow('PNG ou JPEG');
    expect(tx).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
