/**
 * O GATILHO DE TEMPO E A COLETA MANUAL, PELAS ROTAS REAIS DO WORKER.
 *
 * O banco e a Meta são trocados por dublês (`vi.mock`); o que roda de verdade é
 * `scheduled` e a rota `POST /meta/collect` de `worker/index.ts`.
 *
 * O QUE ISTO TRAVA
 *
 *   1. A COLETA MANUAL TEM O MESMO LOTE E O MESMO RELÓGIO DO GATILHO.
 *      A rota chamava `coletar(sql, credenciais)` sem limite e sem relógio:
 *      uma varredura completa (de 100 contas, 23 a 52 segundos cada) numa só
 *      requisição HTTP. Ela nunca termina — o cliente desiste, a plataforma
 *      cancela o pedido no meio de uma conta, e o livro fica `running` por 15
 *      minutos segurando a batida seguinte do cron. Com o lote, cada chamada faz
 *      uma volta curta e devolve `interrompida`; chamar de novo continua o rodízio.
 *
 *   2. A LIMPEZA QUE FALHA NÃO IMPEDE A COLETA. As duas limpezas (imagens
 *      temporárias e mensagens do chat) rodam ANTES da coleta, que é o produto.
 *      Um erro nelas tem de virar log, e a coleta tem de rodar assim mesmo.
 *
 *   4. TOKEN POR EMPRESA BASTA (F44, Fase 9). Só `IDEWORKS_META_TOKEN_<EMPRESA>`,
 *      sem o geral, também faz a coleta rodar — no gatilho e na rota manual.
 *
 *   3. SEM TOKEN, LIMPA E SAI. Sem `IDEWORKS_META_TOKEN` a coleta não roda, mas a
 *      retenção do chat (30 dias) continua valendo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';
import { CONTAS_POR_EXECUCAO, TETO_DE_TEMPO_MS } from '@/server/meta-coleta';

const estado = vi.hoisted(() => ({
  fechou: 0,
  coletas: [] as unknown[][],
  limpezaDeImagens: vi.fn(),
  limpezaDoChat: vi.fn(),
}));

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {
      estado.fechou += 1;
    },
  }),
}));

vi.mock('@/server/session', async (original) => ({
  ...(await original<typeof import('@/server/session')>()),
  resolveActor: async () => ({
    ok: true,
    actor: { userId: 'u1', isSuper: true, isSuperadmin: true },
  }),
}));

vi.mock('@/server/meta-coleta', async (original) => ({
  ...(await original<typeof import('@/server/meta-coleta')>()),
  coletar: async (...argumentos: unknown[]) => {
    estado.coletas.push(argumentos);
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
  purgeExpiredAttachments: (...a: unknown[]) => estado.limpezaDeImagens(...a),
}));

vi.mock('@/server/chat-imagens', async (original) => ({
  ...(await original<typeof import('@/server/chat-imagens')>()),
  purgeExpiredChatMessages: (...a: unknown[]) => estado.limpezaDoChat(...a),
}));

const AMBIENTE = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
  IDEWORKS_META_TOKEN: 'token-da-ide',
} as unknown as Parameters<typeof worker.fetch>[1];

beforeEach(() => {
  estado.fechou = 0;
  estado.coletas = [];
  estado.limpezaDeImagens = vi.fn(async () => ({ removed: 0, failed: 0 }));
  estado.limpezaDoChat = vi.fn(async () => ({ removed: 0, failed: 0 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /meta/collect', () => {
  it('leva o mesmo lote e o mesmo relógio do gatilho — não varre a carteira inteira numa requisição', async () => {
    const resposta = await worker.fetch(
      new Request('https://app.invalid/api/meta/collect', { method: 'POST' }),
      AMBIENTE,
    );

    expect(resposta.status).toBe(200);
    expect(estado.coletas).toHaveLength(1);
    const [, , , limite, teto] = estado.coletas[0];
    expect(limite).toBe(CONTAS_POR_EXECUCAO);
    expect(teto).toBe(TETO_DE_TEMPO_MS);
  });
});

describe('só com token de empresa (sem IDEWORKS_META_TOKEN)', () => {
  const soDaIde = {
    ...AMBIENTE,
    IDEWORKS_META_TOKEN: undefined,
    IDEWORKS_META_TOKEN_IDE: 'token-so-da-ide',
  } as unknown as Parameters<typeof worker.fetch>[1];

  it('o gatilho coleta', async () => {
    await worker.scheduled({ cron: '*/15 * * * *' }, soDaIde);
    expect(estado.coletas).toHaveLength(1);
  });

  it('a rota manual coleta', async () => {
    const resposta = await worker.fetch(
      new Request('https://app.invalid/api/meta/collect', { method: 'POST' }),
      soDaIde,
    );
    expect(resposta.status).toBe(200);
    expect(estado.coletas).toHaveLength(1);
  });

  it('segredo vazio de empresa não conta como token', async () => {
    const vazio = { ...soDaIde, IDEWORKS_META_TOKEN_IDE: '  ' } as unknown as Parameters<
      typeof worker.fetch
    >[1];
    await worker.scheduled({ cron: '*/15 * * * *' }, vazio);
    expect(estado.coletas).toHaveLength(0);
  });
});

describe('scheduled', () => {
  it('a limpeza que falha vira log, e a coleta roda assim mesmo', async () => {
    estado.limpezaDeImagens = vi.fn(async () => {
      throw new Error('storage fora do ar');
    });
    estado.limpezaDoChat = vi.fn(async () => {
      throw new Error('banco recusou');
    });

    await worker.scheduled({ cron: '*/15 * * * *' }, AMBIENTE);

    expect(estado.limpezaDeImagens).toHaveBeenCalledOnce();
    expect(estado.limpezaDoChat).toHaveBeenCalledOnce();
    expect(estado.coletas).toHaveLength(1);
    expect(estado.coletas[0][3]).toBe(CONTAS_POR_EXECUCAO);
    expect(estado.coletas[0][4]).toBe(TETO_DE_TEMPO_MS);
    expect(estado.fechou).toBe(1);
  });

  it('sem token da Meta, as duas limpezas rodam e a coleta não', async () => {
    const semToken = { ...AMBIENTE, IDEWORKS_META_TOKEN: undefined } as unknown as Parameters<
      typeof worker.fetch
    >[1];

    await worker.scheduled({ cron: '*/15 * * * *' }, semToken);

    expect(estado.limpezaDeImagens).toHaveBeenCalledOnce();
    expect(estado.limpezaDoChat).toHaveBeenCalledOnce();
    expect(estado.coletas).toHaveLength(0);
    expect(estado.fechou).toBe(1);
  });
});
