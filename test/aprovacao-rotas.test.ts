/**
 * AS ROTAS DA CONFIGURAÇÃO DA APROVAÇÃO DO CLIENTE — F42, Fase 3.
 *
 * Exercita o Worker de verdade (`worker.fetch`) com o provedor e o banco
 * simulados, no desenho de `quem-sou-eu.test.ts`. O banco aqui é um dublê EM
 * MEMÓRIA que entende só as consultas destas rotas e imita as regras da Fase 1
 * que importam para elas: um link vivo por cliente, `resolve_approval_link`
 * (vivo + ligado + ativo), destino só de etapa da própria esteira (IW042). As
 * regras do banco de verdade estão provadas em `aprovacao-do-cliente-banco.test.ts`.
 *
 * O que se prova:
 *   - admin liga, gera, copia e regenera; o token antigo passa a 404 na rota
 *     pública, o novo responde 200, ambos com `no-referrer` e `noindex`;
 *   - não-admin recebe 403 em todas as rotas de configuração;
 *   - sem a chave do Worker: 503 nomeando o segredo (e a 403 vem antes);
 *   - desligado ou inativo: o link vivo responde 404;
 *   - destinos: lê as etapas da esteira resolvida; grava; etapa de outra
 *     esteira é recusada com a frase do banco; "aguardando" repetido é 400.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';
import { FRASE_SO_ADMIN } from '@/server/aprovacao-config';
import { SEGREDO_DA_CHAVE } from '@/server/link-de-aprovacao';

/* ─────────────────────────── o banco dublê ─────────────────────────── */

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const EQUIPE = '00000000-0000-0000-0000-0000000000b2';
const CLIENTE = '00000000-0000-0000-0000-00000000c001';
const FORA = '00000000-0000-0000-0000-00000000c0ff'; // fora do alcance
const LISTA = '00000000-0000-0000-0000-0000000001a1';
const ESTEIRA = '00000000-0000-0000-0000-0000000005e1';
const OUTRA_ESTEIRA = '00000000-0000-0000-0000-0000000005e2';
const E_FAZER = '00000000-0000-0000-0000-00000000e001';
const E_AGUARDANDO = '00000000-0000-0000-0000-00000000e002';
const E_APROVADO = '00000000-0000-0000-0000-00000000e003';
const E_REFACAO = '00000000-0000-0000-0000-00000000e004';
const E_DE_OUTRA = '00000000-0000-0000-0000-00000000e099';

type Link = { client_id: string; token_hash: string; token_ciphertext: string; created_at: Date; revoked_at: Date | null };

let quem = ADMIN;
let banco: {
  clientes: Map<string, { approval_enabled: boolean; is_active: boolean }>;
  links: Link[];
  alvos: Map<string, { awaiting: string | null; approved: string | null; rejected: string | null }>;
};
const consultas: string[] = [];

const ETAPAS = [
  { id: E_FAZER, name: 'a fazer', type: 'open', color: '#888888', set: ESTEIRA },
  { id: E_AGUARDANDO, name: 'aguardando cliente', type: 'custom', color: null, set: ESTEIRA },
  { id: E_APROVADO, name: 'aprovado', type: 'custom', color: null, set: ESTEIRA },
  { id: E_REFACAO, name: 'refação', type: 'custom', color: null, set: ESTEIRA },
  { id: E_DE_OUTRA, name: 'de outra', type: 'open', color: null, set: OUTRA_ESTEIRA },
];

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
        areas: ['entrega', 'quadro'],
      },
    ];
  }
  // F42, Fase 5: o limite de pedidos sempre libera aqui (o 429 está provado em
  // `aprovacao-publica-rotas.test.ts`); a página resolve o link como acima.
  if (texto.includes('approval_link_rate_hit')) return [{ r: { allowed: true } }];
  if (texto.includes('public_approval_page')) {
    const l = banco.links.find((x) => x.token_hash === v[0] && x.revoked_at === null);
    const c = l ? banco.clientes.get(l.client_id) : undefined;
    return [{ p: l && c?.approval_enabled && c.is_active ? { client_name: 'Cliente Teste', rounds: [] } : null }];
  }
  if (texto.includes('resolve_approval_link')) {
    const l = banco.links.find((x) => x.token_hash === v[0] && x.revoked_at === null);
    const c = l ? banco.clientes.get(l.client_id) : undefined;
    return [{ client_id: l && c?.approval_enabled && c.is_active ? l.client_id : null }];
  }
  if (texto.includes('update ideworks.clients set approval_enabled')) {
    const c = banco.clientes.get(v[1] as string);
    if (!c) return [];
    c.approval_enabled = v[0] as boolean;
    return [{ id: v[1] }];
  }
  if (texto.includes('select c.id, c.approval_enabled, c.is_active')) {
    const c = banco.clientes.get(v[0] as string);
    return c ? [{ id: v[0], ...c }] : [];
  }
  if (texto.includes('select c.id from ideworks.clients c')) {
    return banco.clientes.has(v[0] as string) ? [{ id: v[0] }] : [];
  }
  if (texto.includes('update ideworks.client_approval_links')) {
    const vivos = banco.links.filter((l) => l.client_id === v[1] && l.revoked_at === null);
    for (const l of vivos) l.revoked_at = new Date();
    return vivos.map(() => ({ id: 'x' }));
  }
  if (texto.includes('insert into ideworks.client_approval_links')) {
    if (banco.links.some((l) => l.client_id === v[0] && l.revoked_at === null)) {
      throw Object.assign(new Error('duplicate key'), { code: '23505', constraint_name: 'client_approval_links_one_live' });
    }
    const novo: Link = {
      client_id: v[0] as string,
      token_hash: v[1] as string,
      token_ciphertext: v[2] as string,
      created_at: new Date('2026-10-07T18:00:00Z'),
      revoked_at: null,
    };
    banco.links.push(novo);
    return [{ created_at: novo.created_at }];
  }
  if (texto.includes('from ideworks.client_approval_links l')) {
    const l = banco.links.find((x) => x.client_id === v[0] && x.revoked_at === null);
    return l ? [{ created_at: l.created_at, token_ciphertext: l.token_ciphertext }] : [];
  }
  if (texto.includes('resolve_status_set')) return [{ set_id: v[0] === LISTA ? ESTEIRA : null }];
  if (texto.includes('from ideworks.status_sets ss')) {
    return v[0] === ESTEIRA ? [{ id: ESTEIRA, name: 'Fluxo de criação', origem: 'folder' }] : [];
  }
  if (texto.includes('from ideworks.statuses s')) {
    return ETAPAS.filter((e) => e.set === v[0]).map(({ id, name, type, color }) => ({ id, name, type, color }));
  }
  if (texto.includes('approval_targets_for')) {
    const a = banco.alvos.get(v[0] as string);
    return a ? [{ awaiting_status_id: a.awaiting, approved_status_id: a.approved, rejected_status_id: a.rejected }] : [];
  }
  if (texto.includes('insert into ideworks.status_set_approval_targets')) {
    const [set, awaiting, approved, rejected] = v as (string | null)[];
    for (const id of [awaiting, approved, rejected]) {
      if (id !== null && ETAPAS.find((e) => e.id === id)?.set !== set) {
        throw Object.assign(
          new Error(
            'Cada destino da aprovação tem de ser uma etapa desta mesma esteira. Escolha as etapas na lista desta esteira.',
          ),
          { code: 'IW042', hint: 'target_outside_status_set' },
        );
      }
    }
    banco.alvos.set(set as string, { awaiting, approved, rejected });
    return [];
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

const CHAVE = Buffer.alloc(32, 5).toString('base64');
const envCom = (extra: Record<string, string> = {}) => ({
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
  [SEGREDO_DA_CHAVE]: CHAVE,
  ...extra,
});
let env = envCom();

const pedir = (metodo: string, caminho: string, corpo?: unknown) =>
  worker.fetch(
    new Request(`https://app.invalid/api${caminho}`, {
      method: metodo,
      headers: { Cookie: 'ideworks_sessao=test-access', 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    env as never,
  );

const publica = (token: string) => worker.fetch(new Request(`https://app.invalid/api/public/aprovacao/${token}`), env as never);

const tokenDe = (url: string) => url.split('/aprovar/')[1];

let fetchOriginal: typeof fetch;

beforeEach(() => {
  quem = ADMIN;
  env = envCom();
  consultas.length = 0;
  banco = {
    clientes: new Map([[CLIENTE, { approval_enabled: false, is_active: true }]]),
    links: [],
    alvos: new Map(),
  };
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

/* ─────────────────────────── o cliente e o link ─────────────────────────── */

describe('o admin liga o cliente e gera o link', () => {
  it('lê o estado inicial: desligado, sem link', async () => {
    const r = await pedir('GET', `/clients/${CLIENTE}/approval`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      ok: true,
      approval: { clientId: CLIENTE, enabled: false, active: true, link: null },
    });
  });

  it('liga, gera, copia e regenera: o token antigo passa a 404 e o novo responde 200', async () => {
    const ligado = await pedir('POST', `/clients/${CLIENTE}/approval`, { enabled: true });
    expect(ligado.status).toBe(200);
    expect(((await ligado.json()) as { approval: { enabled: boolean } }).approval.enabled).toBe(true);

    const primeiro = await pedir('POST', `/clients/${CLIENTE}/approval/link`);
    expect(primeiro.status).toBe(201);
    const p1 = (await primeiro.json()) as { url: string; revoked: number };
    expect(p1.url).toMatch(/^https:\/\/app\.invalid\/aprovar\/[A-Za-z0-9_-]{43}$/);
    expect(p1.revoked).toBe(0);
    const antigo = tokenDe(p1.url);

    // O banco guarda hash e cifrado — nunca o token cru.
    expect(banco.links[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(banco.links[0].token_ciphertext).not.toContain(antigo);
    expect(JSON.stringify(banco.links)).not.toContain(antigo);

    const vale = await publica(antigo);
    expect(vale.status).toBe(200);
    expect(await vale.json()).toEqual({ ok: true, cliente: { nome: 'Cliente Teste' }, chamadas: [] });
    expect(vale.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(vale.headers.get('X-Robots-Tag')).toContain('noindex');

    // "Copiar link" decifra e devolve a MESMA URL.
    const copia = await pedir('GET', `/clients/${CLIENTE}/approval/link`);
    expect(copia.status).toBe(200);
    expect(((await copia.json()) as { url: string }).url).toBe(p1.url);

    const segundo = await pedir('POST', `/clients/${CLIENTE}/approval/link`);
    expect(segundo.status).toBe(201);
    const p2 = (await segundo.json()) as { url: string; revoked: number };
    expect(p2.revoked).toBe(1);
    expect(p2.url).not.toBe(p1.url);

    const morto = await publica(antigo);
    expect(morto.status).toBe(404);
    expect(morto.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(morto.headers.get('X-Robots-Tag')).toContain('noindex');
    expect((await publica(tokenDe(p2.url))).status).toBe(200);

    // Um só vivo.
    expect(banco.links.filter((l) => l.revoked_at === null)).toHaveLength(1);
  });

  it('desligado ou inativo: o link vivo responde 404, igual a inexistente', async () => {
    await pedir('POST', `/clients/${CLIENTE}/approval`, { enabled: true });
    const token = tokenDe(((await (await pedir('POST', `/clients/${CLIENTE}/approval/link`)).json()) as { url: string }).url);
    expect((await publica(token)).status).toBe(200);

    await pedir('POST', `/clients/${CLIENTE}/approval`, { enabled: false });
    expect((await publica(token)).status).toBe(404);

    await pedir('POST', `/clients/${CLIENTE}/approval`, { enabled: true });
    expect((await publica(token)).status).toBe(200);
    banco.clientes.get(CLIENTE)!.is_active = false;
    expect((await publica(token)).status).toBe(404);
  });

  it('DELETE revoga sem gerar outro', async () => {
    await pedir('POST', `/clients/${CLIENTE}/approval`, { enabled: true });
    const token = tokenDe(((await (await pedir('POST', `/clients/${CLIENTE}/approval/link`)).json()) as { url: string }).url);
    const r = await pedir('DELETE', `/clients/${CLIENTE}/approval/link`);
    expect(await r.json()).toEqual({ ok: true, revoked: 1 });
    expect((await publica(token)).status).toBe(404);
    const copia = await pedir('GET', `/clients/${CLIENTE}/approval/link`);
    expect(copia.status).toBe(404);
  });

  it('falha do banco na rota pública: o token não vai para o log', async () => {
    const token = 'A'.repeat(43);
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {});
    banco.links = null as never; // a consulta de resolver explode
    try {
      const r = await publica(token);
      expect(r.status).toBe(500);
      const registrado = erros.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(registrado).toContain('/public/aprovacao/:token');
      expect(registrado).not.toContain(token);
      // F42, Fase 4: a falha também sai sem `Referer` e fora de buscador.
      expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(r.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      expect(r.headers.get('Cache-Control')).toBe('no-store');
    } finally {
      erros.mockRestore();
    }
  });

  it('token fora do formato nem vai ao banco', async () => {
    consultas.length = 0;
    const r = await publica('curto');
    expect(r.status).toBe(404);
    expect(r.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(consultas).toEqual([]);
  });

  it('cliente fora do alcance (ou inexistente): 404', async () => {
    expect((await pedir('GET', `/clients/${FORA}/approval`)).status).toBe(404);
    expect((await pedir('POST', `/clients/${FORA}/approval/link`)).status).toBe(404);
  });

  it('corpo sem `enabled` booleano: 400', async () => {
    expect((await pedir('POST', `/clients/${CLIENTE}/approval`, { enabled: 'sim' })).status).toBe(400);
  });
});

describe('sem a chave do Worker', () => {
  it('gerar e copiar respondem 503 nomeando o segredo; nada é gravado', async () => {
    env = envCom({ [SEGREDO_DA_CHAVE]: '' });
    const r = await pedir('POST', `/clients/${CLIENTE}/approval/link`);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { message: string }).message).toContain(SEGREDO_DA_CHAVE);
    expect(banco.links).toHaveLength(0);
    expect((await pedir('GET', `/clients/${CLIENTE}/approval/link`)).status).toBe(503);
  });

  it('para quem não administra, a 403 vem antes da 503', async () => {
    env = envCom({ [SEGREDO_DA_CHAVE]: '' });
    quem = EQUIPE;
    expect((await pedir('POST', `/clients/${CLIENTE}/approval/link`)).status).toBe(403);
  });
});

describe('quem não administra recebe 403 em toda rota de configuração', () => {
  it('POST /clients/:id/approval: 403 antes de conferir o corpo (F42, Fase 4)', async () => {
    quem = EQUIPE;
    const r = await pedir('POST', `/clients/${CLIENTE}/approval`, { enabled: 'sim' });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { message: string }).message).toBe(FRASE_SO_ADMIN);
  });

  it.each([
    ['GET', `/clients/${CLIENTE}/approval`, undefined],
    ['POST', `/clients/${CLIENTE}/approval`, { enabled: true }],
    ['GET', `/clients/${CLIENTE}/approval/link`, undefined],
    ['POST', `/clients/${CLIENTE}/approval/link`, undefined],
    ['DELETE', `/clients/${CLIENTE}/approval/link`, undefined],
    ['GET', `/board/lists/${LISTA}/approval-targets`, undefined],
    ['PUT', `/board/lists/${LISTA}/approval-targets`, { awaitingStatusId: E_AGUARDANDO }],
  ])('%s %s → 403', async (metodo, caminho, corpo) => {
    quem = EQUIPE;
    const r = await pedir(metodo, caminho, corpo);
    expect(r.status).toBe(403);
    expect(((await r.json()) as { message: string }).message).toBe(FRASE_SO_ADMIN);
    expect(banco.links).toHaveLength(0);
    expect(banco.clientes.get(CLIENTE)!.approval_enabled).toBe(false);
    expect(banco.alvos.size).toBe(0);
  });
});

/* ─────────────────────────── os destinos da esteira ─────────────────────────── */

describe('os destinos da esteira', () => {
  it('lê as etapas da esteira resolvida e a configuração vazia como incompleta', async () => {
    const r = await pedir('GET', `/board/lists/${LISTA}/approval-targets`);
    expect(r.status).toBe(200);
    const { approval } = (await r.json()) as {
      approval: { statusSetId: string; inheritedFrom: string; statuses: { id: string }[]; complete: boolean; targets: unknown };
    };
    expect(approval.statusSetId).toBe(ESTEIRA);
    expect(approval.inheritedFrom).toBe('folder');
    expect(approval.statuses.map((s) => s.id)).toEqual([E_FAZER, E_AGUARDANDO, E_APROVADO, E_REFACAO]);
    expect(approval.complete).toBe(false);
    expect(approval.targets).toEqual({ awaitingStatusId: null, approvedStatusId: null, rejectedStatusId: null });
  });

  it('grava os três e relê completa', async () => {
    const r = await pedir('PUT', `/board/lists/${LISTA}/approval-targets`, {
      awaitingStatusId: E_AGUARDANDO,
      approvedStatusId: E_APROVADO,
      rejectedStatusId: E_REFACAO,
    });
    expect(r.status).toBe(200);
    const { approval } = (await r.json()) as { approval: { complete: boolean; targets: unknown } };
    expect(approval.complete).toBe(true);
    expect(approval.targets).toEqual({
      awaitingStatusId: E_AGUARDANDO,
      approvedStatusId: E_APROVADO,
      rejectedStatusId: E_REFACAO,
    });
    const relida = (await (await pedir('GET', `/board/lists/${LISTA}/approval-targets`)).json()) as {
      approval: { complete: boolean };
    };
    expect(relida.approval.complete).toBe(true);
  });

  it('grava parcial: fica incompleta', async () => {
    const r = await pedir('PUT', `/board/lists/${LISTA}/approval-targets`, { awaitingStatusId: E_AGUARDANDO });
    expect(((await r.json()) as { approval: { complete: boolean } }).approval.complete).toBe(false);
  });

  it('etapa de outra esteira: 409 com a frase do banco', async () => {
    const r = await pedir('PUT', `/board/lists/${LISTA}/approval-targets`, {
      awaitingStatusId: E_AGUARDANDO,
      approvedStatusId: E_DE_OUTRA,
      rejectedStatusId: E_REFACAO,
    });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toMatch(/etapa desta mesma esteira/);
    expect(banco.alvos.size).toBe(0);
  });

  it('"aguardando" igual a aprovado: 400 antes do banco; id que não é uuid: 400', async () => {
    const r = await pedir('PUT', `/board/lists/${LISTA}/approval-targets`, {
      awaitingStatusId: E_APROVADO,
      approvedStatusId: E_APROVADO,
    });
    expect(r.status).toBe(400);
    expect((await pedir('PUT', `/board/lists/${LISTA}/approval-targets`, { awaitingStatusId: 'x' })).status).toBe(400);
    expect(banco.alvos.size).toBe(0);
  });

  it('lista que não resolve esteira (fora do alcance): 404', async () => {
    const r = await pedir('GET', `/board/lists/00000000-0000-0000-0000-000000000999/approval-targets`);
    expect(r.status).toBe(404);
  });
});
