/**
 * `POST /items` COM DIA PURO GRAVA O MEIO-DIA DE SÃO PAULO — conferência de 09/10/2026.
 *
 * O DEFEITO
 *   `scheduledAt: '2026-10-31'` (só o dia, sem hora) ia direto à coluna
 *   `timestamptz`, e o banco o lia no fuso da SESSÃO — UTC —, gravando a
 *   meia-noite UTC: 21h do dia ANTERIOR em São Paulo. A peça criada para 31/10
 *   aparecia no Calendário em 30/10 (e a de 1º do mês, no mês anterior).
 *   `scheduleItem` (mover a peça) já ancorava no fuso da agência
 *   (`timezone(AGENCY_TIMEZONE, …)`); criar e mover discordavam.
 *
 * A REGRA
 *   Dia puro vira o MEIO-DIA de São Paulo — o que a tela manda
 *   (`meioDiaDoDia`), longe de qualquer virada de fuso. Instante com hora
 *   (`…T12:00:00Z`, `…T15:00:00.000Z`) segue como sempre foi: o banco o lê como
 *   instante, sem reinterpretar.
 *
 * O QUE SE PROVA
 *   Exercita o Worker de verdade (`worker.fetch`) com o provedor simulado e o
 *   INSERT rodando num Postgres de verdade (PGlite, no processo, nenhuma rede):
 *   o instante gravado, lido pelo dia de São Paulo, é o dia pedido.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';

const QUEM = '00000000-0000-0000-0000-0000000000a1';
const CLIENTE = '00000000-0000-0000-0000-00000000c001';
const MES = '2026-10-01';

let db: PGlite;

/**
 * Tudo o que a rota pergunta antes do INSERT tem resposta pronta; o INSERT roda
 * no PGlite com o texto e os valores que a rota montou.
 */
async function responder(partes: readonly string[], v: unknown[]): Promise<unknown[]> {
  const texto = partes.join('?');
  if (texto.includes('set_config')) return [];
  if (texto.includes('from ideworks.profiles')) {
    return [
      {
        id: QUEM,
        email: 'equipe@example.invalid',
        full_name: null,
        role: 'funcionario',
        is_superadmin: false,
        is_active: true,
        has_all_clients_access: true,
        areas: ['entrega'],
      },
    ];
  }
  if (texto.includes('insert into ideworks.content_items')) {
    const numerado = partes.reduce((acc, parte, i) => acc + parte + (i < v.length ? `$${i + 1}` : ''), '');
    return (await db.query(numerado, v)).rows;
  }
  throw new Error(`Consulta não prevista na prova: ${texto}`);
}

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {},
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work((partes: TemplateStringsArray, ...valores: unknown[]) => responder(partes, valores)),
  }),
}));

const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
};

const criar = (scheduledAt: string | null | undefined) =>
  worker.fetch(
    new Request('https://app.invalid/api/items', {
      method: 'POST',
      headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: CLIENTE,
        month: MES,
        contentType: 'arte',
        isExtra: false,
        ...(scheduledAt === undefined ? {} : { scheduledAt }),
        title: 'Peça de prova',
      }),
    }),
    env as never,
  );

/** O que ficou gravado: o instante em UTC e o dia/hora de São Paulo. */
async function gravada() {
  const { rows } = await db.query<{ utc: string | null; dia: string | null; hora: string | null }>(`
    select to_char(scheduled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as utc,
           to_char(scheduled_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia,
           to_char(scheduled_at at time zone 'America/Sao_Paulo', 'HH24:MI') as hora
      from ideworks.content_items`);
  expect(rows).toHaveLength(1);
  return rows[0];
}

let fetchOriginal: typeof fetch;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create type ideworks.content_type as enum ('video', 'arte', 'foto', 'ads');
    create table ideworks.content_items(id uuid primary key default gen_random_uuid(), client_id uuid,
      reference_month date, content_type ideworks.content_type, is_extra boolean default false,
      scheduled_at timestamptz, title text);
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('delete from ideworks.content_items');
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url === 'https://provider.invalid/auth/v1/user') {
      return new Response(JSON.stringify({ id: QUEM, email: 'x@example.invalid' }), { status: 200 });
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('dia puro: meio-dia de São Paulo', () => {
  it('31/10 grava 31/10 ao meio-dia de Brasília (e não 30/10 às 21h)', async () => {
    const r = await criar('2026-10-31');
    expect(r.status).toBe(201);
    expect(await gravada()).toEqual({ utc: '2026-10-31T15:00:00Z', dia: '2026-10-31', hora: '12:00' });
  });

  it('o 1º do mês grava no mês dele, e não no anterior', async () => {
    await criar('2026-11-01');
    expect(await gravada()).toMatchObject({ dia: '2026-11-01', hora: '12:00' });
  });

  it('o mesmo dia que o `scheduleItem` dá ao mesmo texto', async () => {
    await criar('2026-10-31');
    const { rows } = await db.query<{ dia: string }>(`
      select to_char(timezone('America/Sao_Paulo', cast(cast('2026-10-31' as text) as timestamp))
                       at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as dia`);
    expect((await gravada()).dia).toBe(rows[0].dia);
  });
});

describe('instante com hora: segue como sempre', () => {
  it('o meio-dia UTC que a grade manda (`meioDiaDoDia`) é o mesmo dia de São Paulo', async () => {
    await criar('2026-10-31T12:00:00Z');
    expect(await gravada()).toEqual({ utc: '2026-10-31T12:00:00Z', dia: '2026-10-31', hora: '09:00' });
  });

  it('um instante real não é reinterpretado: 01h UTC de 01/11 é 22h de 31/10 em Brasília', async () => {
    await criar('2026-11-01T01:00:00.000Z');
    expect(await gravada()).toEqual({ utc: '2026-11-01T01:00:00Z', dia: '2026-10-31', hora: '22:00' });
  });

  it('sem data: a peça nasce sem dia', async () => {
    for (const valor of [undefined, null]) {
      await db.exec('delete from ideworks.content_items');
      const r = await criar(valor);
      expect(r.status).toBe(201);
      expect(await gravada()).toEqual({ utc: null, dia: null, hora: null });
    }
  });
});
