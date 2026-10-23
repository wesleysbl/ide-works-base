/**
 * MARCAR PLANEJAMENTO E APROVAÇÃO SEM PERMISSÃO NÃO É "OK" — F43, Fase 3.
 *
 * O DEFEITO
 *   `POST/DELETE /clients/:id/months/:mes/(planning|approval)` fazia o
 *   `update` do contrato do mês sem conferir quantas linhas mudaram. Em
 *   produção a política `contracts_update` só deixa o administrador escrever —
 *   para o funcionário o `update` não falha, ele só não grava (zero linhas). A
 *   rota respondia `{ ok: true }` e a tela ligava a chave sobre um mês que
 *   continuava igual.
 *
 * O QUE SE PROVA
 *   Exercita o Worker de verdade (`worker.fetch`) com o provedor e o banco
 *   simulados, no desenho de `aprovacao-rotas.test.ts`. O banco dublê imita a
 *   política: a leitura do contrato vale para todos; o `update` só conta linha
 *   para o administrador (`count`, como o `postgres.js` devolve).
 *   - admin marca e desmarca: 200, e o dublê gravou;
 *   - funcionário: 403 com a frase clara, e nada gravado — nos dois passos e
 *     nos dois sentidos;
 *   - a ordem do ritual continua do servidor (409 antes do `update`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';
import { RECUSA_SO_ADMIN_MARCA } from '@/delivery/month-ritual';

/* ─────────────────────────── o banco dublê ─────────────────────────── */

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const EQUIPE = '00000000-0000-0000-0000-0000000000b2';
const CLIENTE = '00000000-0000-0000-0000-00000000c001';
const MES = '2026-10-01';

type Contrato = { planning_done_at: Date | null; client_approved_at: Date | null };

let quem = ADMIN;
let contratos: Map<string, Contrato>;
/** O que `open_month` lança, quando a prova quer que ele recuse. */
let falhaDoAbrir: Error | null = null;
const consultas: string[] = [];

/** O resultado de um `update` do `postgres.js`: lista vazia com `count`. */
const atualizadas = (n: number) => Object.assign([], { count: n });

function responder(texto: string, v: unknown[]): unknown[] {
  if (texto.includes('set_config')) return [];
  if (texto.includes('from ideworks.profiles')) {
    const admin = quem === ADMIN;
    return [
      {
        id: quem,
        email: admin ? 'admin@example.invalid' : 'equipe@example.invalid',
        full_name: null,
        role: admin ? 'admin' : 'funcionario',
        is_superadmin: admin,
        is_active: true,
        has_all_clients_access: true,
        areas: ['entrega'],
      },
    ];
  }
  if (texto.includes('ideworks.open_month')) {
    if (falhaDoAbrir) throw falhaDoAbrir;
    return [{ id: 'contrato-novo' }];
  }
  if (texto.includes('from ideworks.month_contracts')) {
    const c = contratos.get(v[0] as string);
    return c ? [{ ...c }] : [];
  }
  if (texto.includes('update ideworks.month_contracts')) {
    // A política `contracts_update`: só administrador escreve. Para os outros
    // o banco não reclama — só não acha linha para mudar.
    const c = contratos.get(v[2] as string);
    if (!c || quem !== ADMIN) return atualizadas(0);
    if (texto.includes('set planning_done_at')) c.planning_done_at = v[0] as Date | null;
    else c.client_approved_at = v[0] as Date | null;
    return atualizadas(1);
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

const marcar = (metodo: 'POST' | 'DELETE', passo: 'planning' | 'approval') =>
  worker.fetch(
    new Request(`https://app.invalid/api/clients/${CLIENTE}/months/${MES}/${passo}`, {
      method: metodo,
      headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
      body: metodo === 'POST' ? '{}' : undefined,
    }),
    env as never,
  );

let fetchOriginal: typeof fetch;

beforeEach(() => {
  quem = ADMIN;
  falhaDoAbrir = null;
  consultas.length = 0;
  contratos = new Map([[CLIENTE, { planning_done_at: null, client_approved_at: null }]]);
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url === 'https://provider.invalid/auth/v1/user') {
      return new Response(JSON.stringify({ id: quem, email: 'x@example.invalid' }), { status: 200 });
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('o administrador marca o mês', () => {
  it('Planejamento OK: 200 e o contrato do mês fica marcado', async () => {
    const r = await marcar('POST', 'planning');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(contratos.get(CLIENTE)?.planning_done_at).toBeInstanceOf(Date);
  });

  it('Cliente aprovou e desfazer: 200 nos dois sentidos', async () => {
    contratos.set(CLIENTE, { planning_done_at: new Date('2026-10-02T12:00:00Z'), client_approved_at: null });
    expect((await marcar('POST', 'approval')).status).toBe(200);
    expect(contratos.get(CLIENTE)?.client_approved_at).toBeInstanceOf(Date);
    expect((await marcar('DELETE', 'approval')).status).toBe(200);
    expect(contratos.get(CLIENTE)?.client_approved_at).toBeNull();
  });
});

describe('quem não é administrador recebe a recusa, e nada é gravado', () => {
  beforeEach(() => {
    quem = EQUIPE;
  });

  it('Planejamento OK: 403 com a frase clara — e não mais `ok` sem gravar', async () => {
    const r = await marcar('POST', 'planning');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ message: RECUSA_SO_ADMIN_MARCA });
    expect(RECUSA_SO_ADMIN_MARCA).toBe('Só um administrador marca o planejamento e a aprovação do mês. Nada foi gravado.');
    expect(contratos.get(CLIENTE)).toEqual({ planning_done_at: null, client_approved_at: null });
    // O `update` foi tentado: a recusa é a do banco, e não um palpite da rota.
    expect(consultas.some((c) => c.includes('update ideworks.month_contracts'))).toBe(true);
  });

  it('Cliente aprovou e desmarcar o planejamento: a mesma recusa', async () => {
    const planejado = { planning_done_at: new Date('2026-10-02T12:00:00Z'), client_approved_at: null };
    contratos.set(CLIENTE, { ...planejado });

    const aprovar = await marcar('POST', 'approval');
    expect(aprovar.status).toBe(403);
    expect(((await aprovar.json()) as { message: string }).message).toBe(RECUSA_SO_ADMIN_MARCA);

    const desmarcar = await marcar('DELETE', 'planning');
    expect(desmarcar.status).toBe(403);
    expect(contratos.get(CLIENTE)).toEqual(planejado);
  });

  it('a ordem do ritual continua antes: aprovar sem plano é 409, sem tentar gravar', async () => {
    const r = await marcar('POST', 'approval');
    expect(r.status).toBe(409);
    expect(((await r.json()) as { reason: string }).reason).toBe('planning_required_first');
    expect(consultas.some((c) => c.includes('update ideworks.month_contracts'))).toBe(false);
  });
});

/* ─────────── o passo é exato, e a data tem de existir ─────────── */

const pedir = (metodo: 'POST' | 'DELETE', mes: string, passo: string) =>
  worker.fetch(
    new Request(`https://app.invalid/api/clients/${CLIENTE}/months/${mes}/${passo}`, {
      method: metodo,
      headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
      body: metodo === 'POST' ? '{}' : undefined,
    }),
    env as never,
  );

describe('o passo do ritual casa exato, e nunca vira aprovação por engano', () => {
  // A rota casava `(open|planning|approval)` com `/i`, e comparava `=== 'planning'`
  // depois: `/Planning` caía no ramo da APROVAÇÃO e gravava "cliente aprovou".
  it('`/Planning` (P maiúsculo) é 404, e nada é gravado', async () => {
    const planejado = { planning_done_at: new Date('2026-10-02T12:00:00Z'), client_approved_at: null };
    contratos.set(CLIENTE, { ...planejado });
    for (const passo of ['Planning', 'APPROVAL', 'Open']) {
      const r = await pedir('POST', MES, passo);
      expect(r.status, passo).toBe(404);
    }
    expect(contratos.get(CLIENTE)).toEqual(planejado);
    expect(consultas.some((c) => c.includes('update ideworks.month_contracts'))).toBe(false);
  });

  it('o id do cliente em maiúsculas continua valendo — só o passo ficou exato', async () => {
    const r = await worker.fetch(
      new Request(`https://app.invalid/api/clients/${CLIENTE.toUpperCase()}/months/${MES}/planning`, {
        method: 'POST',
        headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
        body: '{}',
      }),
      env as never,
    );
    expect(r.status).not.toBe(404);
  });
});

describe('a data do mês tem de existir no calendário', () => {
  it('`2026-02-30` é 400 com frase, sem chegar ao `::date` do banco', async () => {
    for (const passo of ['planning', 'approval', 'open'] as const) {
      const r = await pedir('POST', '2026-02-30', passo);
      expect(r.status, passo).toBe(400);
      expect(((await r.json()) as { message: string }).message).toMatch(/mês/i);
    }
    expect(consultas.some((c) => c.includes('month_contracts') || c.includes('open_month'))).toBe(false);
  });

  it('id com 36 caracteres que não é uuid: 400, e não o 500 do banco', async () => {
    const torto = '0000000000000000000000000000000-c001';
    expect(torto).toHaveLength(36);
    const r = await worker.fetch(
      new Request(`https://app.invalid/api/clients/${torto}/months/${MES}/open`, {
        method: 'POST',
        headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
        body: '{}',
      }),
      env as never,
    );
    expect(r.status).toBe(400);
    expect(consultas.some((c) => c.includes('open_month'))).toBe(false);
  });
});

describe('abrir o mês: só a recusa do banco vira 403', () => {
  it('o banco recusa quem não é administrador (42501): 403 com a frase', async () => {
    falhaDoAbrir = Object.assign(new Error('so administrador abre o mes'), { code: '42501' });
    const r = await pedir('POST', MES, 'open');
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ message: 'Só um administrador abre o mês.' });
  });

  it('o banco fora do ar NÃO é "só administrador": é a falha genérica (500)', async () => {
    falhaDoAbrir = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const r = await pedir('POST', MES, 'open');
    expect(r.status).toBe(500);
    expect(((await r.json()) as { message: string }).message).not.toMatch(/administrador/);
  });

  it('cliente que não existe (chave estrangeira, 23503): 404, e não "só administrador"', async () => {
    falhaDoAbrir = Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
    const r = await pedir('POST', MES, 'open');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ message: 'Cliente não encontrado.' });
  });

  it('o administrador abre: 200 com o contrato', async () => {
    const r = await pedir('POST', MES, 'open');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, contractId: 'contrato-novo' });
  });
});
