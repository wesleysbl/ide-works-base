/**
 * O PADRÃO DAS ROTAS DE LEITURA É O MÊS DE SÃO PAULO — conferência de 08/10/2026.
 *
 * O DEFEITO
 *   `GET /clients` (sem `from`/`to`), `GET /clients/:id`, `GET /planning` e
 *   `GET /planning/weeks` (sem `month`) caíam no mês de `new Date()` em UTC. No
 *   último dia do mês, a partir das 21h de Brasília, o UTC já está no mês
 *   seguinte: quem chamasse sem dizer o mês (script, link antigo, outra tela)
 *   recebia a competência errada, sem aviso. As telas do app sempre mandam o
 *   mês; o padrão é o que sobra para quem não manda.
 *
 * O QUE SE PROVA
 *   Com o relógio em 22h de 31/10/2026 em Brasília (01h de 01/11 em UTC), cada
 *   rota lê OUTUBRO — o mês de quem está olhando.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';
import { readClientDetail } from '@/server/client-detail';
import { readPanel } from '@/server/panel';
import { readPlanning } from '@/server/planning';
import { readPlanningWeeks } from '@/server/planning-weeks';

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const CLIENTE = '00000000-0000-0000-0000-00000000c001';
/** 22h de 31/10/2026 em Brasília = 01h de 01/11/2026 em UTC. */
const NOITE_DE_31_DE_OUTUBRO = new Date('2026-11-01T01:00:00Z');

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {},
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work(async (partes: TemplateStringsArray) => {
        const texto = partes.join('?');
        if (texto.includes('from ideworks.profiles')) {
          return [
            {
              id: ADMIN,
              email: 'admin@example.invalid',
              full_name: null,
              role: 'admin',
              is_superadmin: true,
              is_active: true,
              has_all_clients_access: true,
              areas: ['entrega'],
            },
          ];
        }
        return [];
      }),
  }),
}));
vi.mock('@/server/panel', async (original) => ({
  ...(await original<typeof import('@/server/panel')>()),
  readPanel: vi.fn(async () => ({ clients: [], conferencia: {} })),
}));
vi.mock('@/server/client-detail', async (original) => ({
  ...(await original<typeof import('@/server/client-detail')>()),
  readClientDetail: vi.fn(async () => ({})),
}));
vi.mock('@/server/planning', () => ({ readPlanning: vi.fn(async () => []) }));
vi.mock('@/server/planning-weeks', async (original) => ({
  ...(await original<typeof import('@/server/planning-weeks')>()),
  readPlanningWeeks: vi.fn(async () => []),
}));

const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
};

const pedir = (caminho: string) =>
  worker.fetch(
    new Request(`https://app.invalid/api${caminho}`, { headers: { Cookie: 'ideworks_sessao=test-access' } }),
    env as never,
  );

let fetchOriginal: typeof fetch;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOITE_DE_31_DE_OUTUBRO);
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url === 'https://provider.invalid/auth/v1/user') {
      return new Response(JSON.stringify({ id: ADMIN, email: 'admin@example.invalid' }), { status: 200 });
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  globalThis.fetch = fetchOriginal;
});

describe('sem dizer o mês, a rota lê o mês de quem está olhando (São Paulo)', () => {
  it('o painel da carteira: de 01/10 a 31/10', async () => {
    expect((await pedir('/clients')).status).toBe(200);
    expect(vi.mocked(readPanel).mock.calls[0].slice(2)).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('a ficha do cliente: outubro', async () => {
    expect((await pedir(`/clients/${CLIENTE}`)).status).toBe(200);
    expect(String(vi.mocked(readClientDetail).mock.calls[0][3]).slice(0, 7)).toBe('2026-10');
  });

  it('o planejamento do mês: outubro', async () => {
    const r = await pedir('/planning');
    expect(((await r.json()) as { month: string }).month).toBe('2026-10-01');
    expect(String(vi.mocked(readPlanning).mock.calls[0][2]).slice(0, 7)).toBe('2026-10');
  });

  it('o planejamento por semana: outubro', async () => {
    const r = await pedir('/planning/weeks');
    expect(((await r.json()) as { month: string }).month).toBe('2026-10-01');
    expect(String(vi.mocked(readPlanningWeeks).mock.calls[0][2]).slice(0, 7)).toBe('2026-10');
  });

  it('o mês dito na chamada continua mandando', async () => {
    await pedir('/planning?month=2026-09-01');
    expect(String(vi.mocked(readPlanning).mock.calls[0][2]).slice(0, 7)).toBe('2026-09');
  });
});
