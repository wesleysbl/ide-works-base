/**
 * ENTRADA INVÁLIDA É 400 COM A FRASE, E NÃO O 500 DO BANCO — conferência de 08/10/2026.
 *
 * O DEFEITO
 *   Quatro rotas passavam o texto do endereço ou do corpo direto ao `::date`,
 *   `::timestamp` ou `::boolean` do Postgres. Quem chamasse com uma data que não
 *   existe, ou um `financeOk` que não é booleano, levava "Não foi possível
 *   concluir. Tente de novo." (500) — um erro de servidor para um pedido torto,
 *   que ninguém sabe se vale repetir. A recusa de pedido torto é 400, com a
 *   frase, antes de abrir transação.
 *
 * O QUE SE PROVA
 *   O Worker de verdade (`worker.fetch`), com o provedor e o banco dublês no
 *   desenho de `ritual-do-mes-rotas.test.ts`. O dublê do banco LANÇA o erro
 *   que o Postgres lançaria ao receber o texto torto, e registra o que foi
 *   consultado: a rota certa responde 400 sem consultar nada além do perfil.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const ITEM = '00000000-0000-0000-0000-0000000000b1';
const CLIENTE = '00000000-0000-0000-0000-00000000c001';

const consultas: string[] = [];

/** O que o Postgres diz de uma data/hora que não existe. */
const erroDoBanco = (code: string, message: string) => Object.assign(new Error(message), { code });

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {},
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        const texto = partes.join('?');
        if (texto.includes('set_config')) return [];
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
        consultas.push(texto);
        const textoTorto = valores.find(
          (v) => typeof v === 'string' && /^(2026-02-30|nunca|2026-13-01)/.test(v),
        );
        if (textoTorto !== undefined) throw erroDoBanco('22008', `date/time field value out of range: "${textoTorto}"`);
        if (valores.some((v) => v === 'talvez')) throw erroDoBanco('22P02', 'invalid input syntax for type boolean: "talvez"');
        return [];
      }),
  }),
}));

const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
};

const chamar = (metodo: string, caminho: string, corpo?: unknown) =>
  worker.fetch(
    new Request(`https://app.invalid/api${caminho}`, {
      method: metodo,
      headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env as never,
  );

let fetchOriginal: typeof fetch;

beforeEach(() => {
  consultas.length = 0;
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
  globalThis.fetch = fetchOriginal;
});

describe('o calendário: o período torto é 400', () => {
  it.each([
    ['from=2026-02-30&to=2026-03-31', 'dia que não existe'],
    ['from=nunca&to=2026-03-31', 'texto'],
    ['from=2026-03-01&to=2026-13-01', 'mês 13'],
  ])('%s (%s)', async (consulta) => {
    const r = await chamar('GET', `/calendar?${consulta}`);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toMatch(/período/i);
    expect(consultas).toEqual([]);
  });

  it('o período certo segue para a leitura', async () => {
    const r = await chamar('GET', '/calendar?from=2026-10-01&to=2026-11-01');
    expect(r.status).toBe(200);
    expect(consultas.length).toBeGreaterThan(0);
  });
});

describe('marcar o dia de um item: a data torta é 400', () => {
  it.each(['2026-02-30T12:00:00Z', 'nunca', '2026-13-01T12:00:00Z', 20261001])('at=%j', async (at) => {
    const r = await chamar('POST', `/items/${ITEM}/schedule`, { at });
    expect(r.status).toBe(400);
    expect(consultas).toEqual([]);
  });

  it('a data de sempre (meio-dia UTC do dia) continua valendo', async () => {
    const r = await chamar('POST', `/items/${ITEM}/schedule`, { at: '2026-10-08T12:00:00Z' });
    expect(r.status).toBe(404); // o dublê não acha o item: a recusa é a do item, e não a da data
    expect(consultas.length).toBeGreaterThan(0);
  });
});

describe('criar item com dia: a data torta é 400', () => {
  it('scheduledAt que não existe', async () => {
    const r = await chamar('POST', '/items', {
      clientId: CLIENTE,
      month: '2026-10-01',
      contentType: 'video',
      isExtra: false,
      scheduledAt: '2026-02-30T12:00:00Z',
    });
    expect(r.status).toBe(400);
    expect(consultas).toEqual([]);
  });
});

describe('as chaves do cliente: financeOk precisa ser verdadeiro ou falso', () => {
  it('"talvez" é 400, antes do banco', async () => {
    const r = await chamar('POST', `/clients/${CLIENTE}/flags`, { financeOk: 'talvez' });
    expect(r.status).toBe(400);
    expect(consultas).toEqual([]);
  });
});
