/**
 * QUEM NÃO DIZ SE É EXTRA, ANTES DE O MÊS ABRIR, PERGUNTA AO CADASTRO.
 *
 * O DEFEITO
 *   `POST /items` sem `isExtra` (o "+" da grade de Semanas do Planejamento e o
 *   "+ Peça"/"+ Marcar" do calendário) decidia "extra" comparando com
 *   `month_contract_items`. Mês ainda NÃO ABERTO não tem contrato — a conta
 *   dava cota zero, e toda peça planejada antes da abertura nascia
 *   `is_extra = true`. `open_month` congela a cota e não reclassifica nada:
 *   as peças ficavam extras para sempre, e a faixa do Planejamento lia "0
 *   entregues, 8 sem dia" num mês com tudo marcado.
 *
 * O QUE SE PROVA
 *   Exercita o Worker de verdade (`worker.fetch`) com o provedor e o banco
 *   simulados, no desenho de `ritual-do-mes-rotas.test.ts`. O banco dublê
 *   guarda o contrato do mês (se aberto), a cota do cadastro e as peças, e
 *   responde à conta da rota a partir disso.
 *   - mês sem contrato: vale a cota do CADASTRO (`client_quotas`), a mesma
 *     fonte de `resolvePlanningQuota`;
 *   - mês aberto: vale o contrato, mesmo vazio — como antes (F17.57);
 *   - `isExtra` mandado: vale o que veio, sem conta;
 *   - entrada inválida (tipo fora do enum, mês que não existe, cliente que não
 *     é uuid) é 400 com frase, antes de tocar o banco — e não 500.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';

/* ─────────────────────────── o banco dublê ─────────────────────────── */

const QUEM = '00000000-0000-0000-0000-0000000000a1';
const CLIENTE = '00000000-0000-0000-0000-00000000c001';
const MES = '2026-10-01';

type Tipo = 'video' | 'arte' | 'foto' | 'ads';

/** O contrato do mês: `undefined` é mês não aberto; `{}` é aberto e vazio. */
let contrato: Partial<Record<Tipo, number>> | undefined;
/** `client_quotas` — a cota de hoje, no cadastro. */
let cadastro: Partial<Record<Tipo, number>>;
/** As peças que já existem no mês. */
let pecas: { tipo: Tipo; extra: boolean }[];
/** O que a rota gravou. */
let inseridas: { tipo: string; extra: unknown }[];
const consultas: string[] = [];

function responder(texto: string, v: unknown[]): unknown[] {
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
    inseridas.push({ tipo: v[2] as string, extra: v[3] });
    return [{ id: '00000000-0000-0000-0000-0000000000e1' }];
  }
  if (texto.includes('as na_base')) {
    // A conta da rota: um tipo só, o primeiro valor tipado da consulta.
    const tipo = v.find((x) => x === 'video' || x === 'arte' || x === 'foto' || x === 'ads') as Tipo;
    return [
      {
        na_base: pecas.filter((p) => p.tipo === tipo && !p.extra).length,
        mes_aberto: contrato !== undefined,
        contratado: contrato?.[tipo] ?? 0,
        cadastrado: cadastro[tipo] ?? 0,
      },
    ];
  }
  throw new Error(`Consulta não prevista na prova: ${texto}`);
}

vi.mock('@/server/db', async (original) => ({
  ...(await original<typeof import('@/server/db')>()),
  connect: () => ({
    end: async () => {},
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        const texto = partes.join('?');
        consultas.push(texto);
        return responder(texto, valores);
      }),
  }),
}));

/* ─────────────────────────── o Worker ─────────────────────────── */

const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
};

const criar = (corpo: Record<string, unknown>) =>
  worker.fetch(
    new Request('https://app.invalid/api/items', {
      method: 'POST',
      headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
    env as never,
  );

/** O corpo do "+" da grade e do "+ Peça": SEM `isExtra`. */
const peca = (tipo: Tipo = 'arte') => ({
  clientId: CLIENTE,
  month: MES,
  contentType: tipo,
  scheduledAt: '2026-10-14T15:00:00.000Z',
});

let fetchOriginal: typeof fetch;

beforeEach(() => {
  contrato = undefined;
  cadastro = {};
  pecas = [];
  inseridas = [];
  consultas.length = 0;
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

describe('mês ainda não aberto: a cota é a do cadastro', () => {
  it('a primeira peça de um cliente com 8 artes no cadastro nasce NA BASE, e não extra', async () => {
    cadastro = { arte: 8 };
    const r = await criar(peca('arte'));
    expect(r.status).toBe(201);
    expect(inseridas).toEqual([{ tipo: 'arte', extra: false }]);
  });

  it('as oito planejadas antes da abertura entram todas na base; a nona é extra', async () => {
    cadastro = { arte: 8 };
    for (let i = 0; i < 9; i += 1) {
      await criar(peca('arte'));
      const ultima = inseridas[inseridas.length - 1];
      pecas.push({ tipo: 'arte', extra: ultima.extra as boolean });
    }
    expect(inseridas.map((p) => p.extra)).toEqual([false, false, false, false, false, false, false, false, true]);
  });

  it('tipo que o cadastro não tem continua nascendo extra', async () => {
    cadastro = { arte: 8 };
    await criar(peca('video'));
    expect(inseridas).toEqual([{ tipo: 'video', extra: true }]);
  });

  it('cliente sem cota nenhuma no cadastro: extra, como antes', async () => {
    await criar(peca('arte'));
    expect(inseridas).toEqual([{ tipo: 'arte', extra: true }]);
  });
});

describe('mês aberto: o contrato congelado continua mandando', () => {
  it('contrato com 3 artes e 1 na base: a próxima entra na base', async () => {
    contrato = { arte: 3 };
    cadastro = { arte: 1 };
    pecas = [{ tipo: 'arte', extra: false }];
    await criar(peca('arte'));
    expect(inseridas).toEqual([{ tipo: 'arte', extra: false }]);
  });

  it('contrato aberto VAZIO vale zero, mesmo com cota no cadastro (F17.57)', async () => {
    contrato = {};
    cadastro = { arte: 8 };
    await criar(peca('arte'));
    expect(inseridas).toEqual([{ tipo: 'arte', extra: true }]);
  });

  it('base cheia pelo contrato: extra, mesmo que o cadastro de hoje tenha subido', async () => {
    contrato = { arte: 2 };
    cadastro = { arte: 10 };
    pecas = [
      { tipo: 'arte', extra: false },
      { tipo: 'arte', extra: false },
    ];
    await criar(peca('arte'));
    expect(inseridas).toEqual([{ tipo: 'arte', extra: true }]);
  });
});

describe('quem manda `isExtra` não passa pela conta', () => {
  it('o valor mandado é o gravado, e a conta nem é feita', async () => {
    cadastro = { arte: 8 };
    await criar({ ...peca('arte'), isExtra: true });
    expect(inseridas).toEqual([{ tipo: 'arte', extra: true }]);
    expect(consultas.some((c) => c.includes('as na_base'))).toBe(false);
  });
});

describe('entrada inválida é 400 com frase, antes do banco', () => {
  const semGravar = () => {
    expect(inseridas).toEqual([]);
    expect(consultas.some((c) => c.includes('content_items'))).toBe(false);
  };

  it('tipo de conteúdo fora do enum', async () => {
    const r = await criar({ ...peca(), contentType: 'carrossel' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toMatch(/tipo de conteúdo/i);
    semGravar();
  });

  it('mês que não existe no calendário, ou fora do formato', async () => {
    for (const month of ['2026-02-30', '2026-13-01', 'outubro', '10/2026']) {
      const r = await criar({ ...peca(), month });
      expect(r.status, month).toBe(400);
      expect(((await r.json()) as { message: string }).message).toMatch(/mês/i);
    }
    semGravar();
  });

  it('cliente que não é uuid', async () => {
    const r = await criar({ ...peca(), clientId: 'cliente-1' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toMatch(/cliente/i);
    semGravar();
  });

  it('o mês no formato que as telas mandam (`AAAA-MM-01`) continua valendo', async () => {
    cadastro = { arte: 8 };
    expect((await criar({ ...peca(), month: '2026-10-01' })).status).toBe(201);
  });
});
