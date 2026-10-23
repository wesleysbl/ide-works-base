/**
 * A LIMPEZA DIÁRIA DOS LIMITADORES, PELO `scheduled` REAL DO WORKER — F44, Fase 7.
 *
 * Mesmo molde de `cron-e-coleta-manual.test.ts`: o banco, a Meta e as outras
 * limpezas são dublês (`vi.mock`); o que roda de verdade é `scheduled` de
 * `worker/index.ts` e a decisão de batida de `server/limpeza-dos-limitadores`.
 *
 * O QUE ISTO TRAVA
 *
 *   1. UMA VEZ POR DIA. O gatilho bate a cada 15 minutos; só a batida das
 *      06:00 UTC limpa. As outras 95 não tocam nas tabelas dos limitadores.
 *
 *   2. PELA HORA MARCADA. `scheduledTime` do evento manda, e não o relógio:
 *      a batida das 06:00 que começa atrasada continua sendo a das 06:00.
 *
 *   3. A LIMPEZA QUE FALHA NÃO IMPEDE A COLETA, como as outras duas limpezas.
 *
 *   4. SEM TOKEN DA META, A LIMPEZA RODA — retenção não depende de credencial.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';

const estado = vi.hoisted(() => ({
  fechou: 0,
  coletas: 0,
  limpezaDosLimitadores: vi.fn(),
  registros: [] as string[],
}));

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {
      estado.fechou += 1;
    },
  }),
}));

vi.mock('@/server/meta-coleta', async (original) => ({
  ...(await original<typeof import('@/server/meta-coleta')>()),
  coletar: async () => {
    estado.coletas += 1;
    return {
      runId: 'r1',
      janela: { de: '2026-09-12', ate: '2026-10-09' },
      desfecho: 'ok',
      ativosTotal: 0,
      ativosOk: 0,
      ativosComFalha: 0,
      linhasGravadas: 0,
      primeiraFalha: null,
      interrompida: false,
    };
  },
}));

vi.mock('@/server/board-anexos', async (original) => ({
  ...(await original<typeof import('@/server/board-anexos')>()),
  purgeExpiredAttachments: async () => ({ removed: 0, failed: 0 }),
}));

vi.mock('@/server/chat-imagens', async (original) => ({
  ...(await original<typeof import('@/server/chat-imagens')>()),
  purgeExpiredChatMessages: async () => ({ removed: 0, failed: 0 }),
}));

vi.mock('@/server/limpeza-dos-limitadores', async (original) => ({
  ...(await original<typeof import('@/server/limpeza-dos-limitadores')>()),
  limparLimitadores: (...a: unknown[]) => estado.limpezaDosLimitadores(...a),
}));

const AMBIENTE = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
  IDEWORKS_META_TOKEN: 'token-da-ide',
} as unknown as Parameters<typeof worker.fetch>[1];

/** O evento como a plataforma manda: o padrão do gatilho e a hora marcada. */
const batida = (iso: string) =>
  ({ cron: '*/15 * * * *', scheduledTime: Date.parse(iso) }) as unknown as Parameters<typeof worker.scheduled>[0];

beforeEach(() => {
  estado.fechou = 0;
  estado.coletas = 0;
  estado.registros = [];
  estado.limpezaDosLimitadores = vi.fn(async () => ({ integracao: 3, tentativas: 2 }));
  // O `log` do Worker escreve em `console.error`.
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    estado.registros.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduled — limpeza dos limitadores', () => {
  it('a batida das 06:00 UTC limpa, uma vez, com a mesma conexão — e a coleta roda depois', async () => {
    await worker.scheduled(batida('2026-10-10T06:00:00.000Z'), AMBIENTE);

    expect(estado.limpezaDosLimitadores).toHaveBeenCalledOnce();
    // A conexão do gatilho, e não uma nova: `connect` (dublê) devolveu o objeto
    // que o `scheduled` fecha no fim.
    expect(estado.limpezaDosLimitadores.mock.calls[0][0]).toHaveProperty('end');
    expect(estado.coletas).toBe(1);
    expect(estado.fechou).toBe(1);
    expect(estado.registros.some((r) => r.includes('limitadores: 3 chamadas de agente e 2 tentativas'))).toBe(true);
  });

  it('das 96 batidas do dia, só a das 06:00 UTC limpa', async () => {
    const meiaNoite = Date.parse('2026-10-10T00:00:00.000Z');
    for (let i = 0; i < 96; i += 1) {
      const iso = new Date(meiaNoite + i * 15 * 60_000).toISOString();
      await worker.scheduled(batida(iso), AMBIENTE);
    }
    expect(estado.limpezaDosLimitadores).toHaveBeenCalledOnce();
    expect(estado.coletas).toBe(96);
  });

  it('vale a hora MARCADA: a batida das 06:00 que chega atrasada ainda limpa; a das 06:15 não', async () => {
    await worker.scheduled(batida('2026-10-10T06:00:07.420Z'), AMBIENTE);
    await worker.scheduled(batida('2026-10-10T06:15:00.000Z'), AMBIENTE);
    await worker.scheduled(batida('2026-10-10T05:45:00.000Z'), AMBIENTE);
    expect(estado.limpezaDosLimitadores).toHaveBeenCalledOnce();
  });

  it('a limpeza que falha vira log, e a coleta roda assim mesmo', async () => {
    estado.limpezaDosLimitadores = vi.fn(async () => {
      throw new Error('função ainda não existe no banco');
    });

    await worker.scheduled(batida('2026-10-10T06:00:00.000Z'), AMBIENTE);

    expect(estado.limpezaDosLimitadores).toHaveBeenCalledOnce();
    expect(estado.coletas).toBe(1);
    expect(estado.fechou).toBe(1);
    expect(estado.registros.some((r) => r.includes('limpeza dos limitadores falhou'))).toBe(true);
  });

  it('sem token da Meta, a limpeza roda e a coleta não', async () => {
    const semToken = { ...AMBIENTE, IDEWORKS_META_TOKEN: undefined } as unknown as Parameters<
      typeof worker.fetch
    >[1];

    await worker.scheduled(batida('2026-10-10T06:00:00.000Z'), semToken);

    expect(estado.limpezaDosLimitadores).toHaveBeenCalledOnce();
    expect(estado.coletas).toBe(0);
    expect(estado.fechou).toBe(1);
  });
});
