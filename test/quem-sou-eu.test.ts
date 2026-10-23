/**
 * `GET /auth/me` devolve o NOME da pessoa — F29.
 *
 * Exercita a rota real do Worker com banco e provedor simulados, no desenho de
 * `login-persistente.test.ts`. O que se prova:
 *   - o nome sai da coluna que a tela de Pessoas mostra (`profiles.full_name`),
 *     lida na MESMA consulta da conferência do crachá, e não numa segunda;
 *   - sem nome (nulo, vazio, só espaços), o campo vem `null` — a tela mostra o
 *     e-mail;
 *   - os campos que já existiam continuam iguais: o nome só se acrescenta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import worker from '../worker/index';

const consultas: string[] = [];
let perfil: Record<string, unknown> | undefined;

vi.mock('@/server/db', async (original) => ({
  ...await original<typeof import('@/server/db')>(),
  connect: () => ({
    end: async () => {},
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work(async (partes: TemplateStringsArray) => {
        const texto = partes.join('?');
        consultas.push(texto);
        if (texto.includes('set_config')) return [];
        if (texto.includes('from ideworks.profiles')) return perfil ? [perfil] : [];
        throw new Error(`Consulta não prevista na prova: ${texto}`);
      }),
  }),
}));

const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://provider.invalid',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
};

const PERFIL_BASE = {
  id: '00000000-0000-0000-0000-00000000000a',
  email: 'pessoa@example.invalid',
  role: 'admin',
  is_superadmin: true,
  is_active: true,
  has_all_clients_access: true,
  areas: ['pessoas', 'catalogos'],
};

const pedirEu = () => worker.fetch(
  new Request('https://app.invalid/api/auth/me', {
    headers: { Cookie: 'ideworks_sessao=test-access' },
  }),
  env,
);

let fetchOriginal: typeof fetch;

beforeEach(() => {
  consultas.length = 0;
  perfil = undefined;
  fetchOriginal = globalThis.fetch;
  // O provedor responde "este crachá é da pessoa X". Qualquer outro destino
  // continua barrado pela trava de rede da suíte.
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url === 'https://provider.invalid/auth/v1/user') {
      return new Response(JSON.stringify({ id: PERFIL_BASE.id, email: PERFIL_BASE.email }), { status: 200 });
    }
    return fetchOriginal(entrada, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('GET /auth/me devolve o nome da pessoa', () => {
  it('com nome no perfil, devolve o nome — e os campos de antes, iguais', async () => {
    perfil = { ...PERFIL_BASE, full_name: 'Wesley Lourenço' };
    const resposta = await pedirEu();
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      ok: true,
      userId: PERFIL_BASE.id,
      email: PERFIL_BASE.email,
      nome: 'Wesley Lourenço',
      isSuperadmin: true,
      isSuper: false,
      papel: 'admin',
      areas: ['pessoas', 'catalogos'],
      crachaValePor: null,
    });
  });

  it('o nome vem da mesma consulta da conferência, e não de uma segunda ida ao banco', async () => {
    perfil = { ...PERFIL_BASE, full_name: 'Wesley Lourenço' };
    await pedirEu();
    const doPerfil = consultas.filter((c) => c.includes('from ideworks.profiles'));
    expect(doPerfil).toHaveLength(1);
    expect(doPerfil[0]).toMatch(/\bfull_name\b/);
  });

  it.each([
    ['nulo', null],
    ['ausente', undefined],
    ['vazio', ''],
    ['só espaços', '   '],
  ])('nome %s vira null, e o e-mail continua lá para a tela mostrar', async (_rotulo, valor) => {
    perfil = { ...PERFIL_BASE, full_name: valor };
    const corpo = (await (await pedirEu()).json()) as { nome: unknown; email: string };
    expect(corpo.nome).toBeNull();
    expect(corpo.email).toBe(PERFIL_BASE.email);
  });

  it('espaço nas pontas do nome não vai para o chip', async () => {
    perfil = { ...PERFIL_BASE, full_name: '  Alice  ' };
    const corpo = (await (await pedirEu()).json()) as { nome: unknown };
    expect(corpo.nome).toBe('Alice');
  });

  it('sem perfil, a recusa é a de sempre — o nome não abre porta nenhuma', async () => {
    perfil = undefined;
    const resposta = await pedirEu();
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).not.toHaveProperty('nome');
  });
});
