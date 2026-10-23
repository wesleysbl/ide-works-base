/**
 * F21.5a — o dono governa a conexão: nome e teto diário, de um lugar só.
 *
 * O QUE ESTES CASOS PROTEGEM
 *   1. A tela recebe a cota JÁ RESOLVIDA (usada hoje e teto vigente), da mesma
 *      fonte que o freio usa para recusar. Nenhum número é recalculado na tela.
 *   2. MUDAR TETO E RENOMEAR SÃO DE GENTE. A rota é de sessão humana e só do
 *      DONO: um agente não aumenta o próprio teto nem se renomeia. No banco há
 *      uma segunda parede (`integration_grants_update` exige
 *      `acting_grant_id() is null`), e ela não depende deste código.
 *   3. O nome que o dono dá SUBSTITUI o que o cliente OAuth declarou. Esse
 *      nome IDENTIFICA, NÃO AUTORIZA — e é por isso que ele pode ser trocado
 *      sem que nada de permissão mude: as capacidades e o alcance seguem iguais.
 *   4. Entrada sem sentido é recusada em português, antes de chegar ao banco.
 */

import { describe, expect, it } from 'vitest';

import { CONNECTIONS_PATH } from '@/integrations/contract';
import {
  DEFAULT_DAILY_WRITE_LIMIT,
  MAX_DAILY_WRITE_LIMIT,
  resolveDailyWriteLimit,
} from '@/integrations/executions';
import { INTEGRATION_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { MemoryGrantStore, createIntegrationHandler, type IntegrationServer } from '@/integrations/handler';
import { SESSION_COOKIE as HUMAN_SESSION } from '@/server/session';
import type { AuthenticatedActor, SessionResult } from '@/server/session';

const ORIGIN = 'https://ideworks.test';
const HUMAN_COOKIE = `${HUMAN_SESSION}=human-ok`;
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const OUTRO_ID = '22222222-2222-2222-2222-222222222222';
const GRANT = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const TASK = '33333333-3333-4333-8333-333333333333';

/** O nome que o programa do agente DECLAROU — e que ele não deveria poder impor. */
const NOME_DECLARADO = 'Suporte oficial do IDE Works';

const OWNER: AuthenticatedActor = {
  userId: OWNER_ID,
  email: 'wesley@exemplo.com.br',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: ['entrega', 'quadro'],
  hasAllClientsAccess: true,
};

const PERSON: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [],
  clientIds: [],
  hasAllClientsAccess: true,
};

function grant(overrides: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: GRANT,
    ownerId: OWNER_ID,
    oauthClientId: 'cliente-mcp',
    name: NOME_DECLARADO,
    capabilities: [...INTEGRATION_CAPABILITIES],
    allowedCompanyIds: null,
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
    ...overrides,
  };
}

function sessionResult(cookie: string): SessionResult {
  if (!cookie.includes(`${HUMAN_SESSION}=human-ok`)) {
    return { ok: false, status: 401, reason: 'no_token', message: 'Faltou o crachá.' };
  }
  return { ok: true, actor: OWNER };
}

async function montar(escritasHoje = 0, overrides: Partial<IntegrationGrant> = {}) {
  const grants = new MemoryGrantStore();
  grants.seedPerson(PERSON);
  grants.grants.set(GRANT, grant(overrides));
  for (let i = 0; i < escritasHoje; i += 1) {
    grants.executions.push({
      id: `e-${i}`,
      grantId: GRANT,
      grantName: NOME_DECLARADO,
      ownerId: OWNER_ID,
      operation: 'add_comment',
      targetId: TASK,
      occurredAt: new Date().toISOString(),
      origin: 'http',
      active: true,
      result: { commentId: `c-${i}` },
      undoneAt: null,
    });
  }
  const server = await createIntegrationHandler({
    grants,
    resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
  });
  return { grants, server };
}

const listar = (server: IntegrationServer) =>
  server.fetch(new Request(`${ORIGIN}${CONNECTIONS_PATH}`, { headers: { Cookie: HUMAN_COOKIE } }));

const ajustar = (server: IntegrationServer, corpo: unknown, headers?: HeadersInit) =>
  server.fetch(
    new Request(`${ORIGIN}${CONNECTIONS_PATH}/${GRANT}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: HUMAN_COOKIE, Origin: ORIGIN, ...headers },
      body: JSON.stringify(corpo),
    }),
  );

const corpo = async (r: Response) => (await r.json()) as Record<string, never>;

describe('data da autorização na tela (F44, Fase 9)', () => {
  it('a listagem traz authorizedAt da concessão; sem data guardada, nulo', async () => {
    const { server } = await montar(0, { createdAt: new Date('2026-09-22T12:00:00.000Z') });
    const conexoes = (await corpo(await listar(server))).connections as unknown as Array<Record<string, unknown>>;
    expect(conexoes[0].authorizedAt).toBe('2026-09-22T12:00:00.000Z');

    const { server: semData } = await montar();
    const outras = (await corpo(await listar(semData))).connections as unknown as Array<Record<string, unknown>>;
    expect(outras[0].authorizedAt).toBeNull();
  });
});

describe('cota na tela (F21.5a)', () => {
  it('a listagem traz o teto vigente, o que já foi gasto hoje e a hora da virada', async () => {
    const { server } = await montar(3);

    const resposta = await listar(server);
    expect(resposta.status).toBe(200);
    const body = await corpo(resposta);
    const conexoes = body.connections as unknown as Array<Record<string, unknown>>;
    expect(conexoes).toHaveLength(1);
    expect(conexoes[0].dailyWriteLimit).toBe(DEFAULT_DAILY_WRITE_LIMIT);
    expect(conexoes[0].usedToday).toBe(3);
    expect(typeof body.dayResetsAt).toBe('string');
    // A virada é no futuro: é o fim do dia corrente, não o começo.
    expect(new Date(body.dayResetsAt as unknown as string).getTime()).toBeGreaterThan(Date.now());
  });

  it('escrita de ontem não conta na cota de hoje', async () => {
    const { grants, server } = await montar(1);
    grants.executions[0] = {
      ...grants.executions[0],
      occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const body = await corpo(await listar(server));
    const conexoes = body.connections as unknown as Array<Record<string, unknown>>;
    expect(conexoes[0].usedToday).toBe(0);
  });

  it('o teto guardado na concessão é o que a tela mostra, e o mesmo que o freio lê', async () => {
    const { grants, server } = await montar(0, { dailyWriteLimit: 7 });

    const body = await corpo(await listar(server));
    const conexoes = body.connections as unknown as Array<Record<string, unknown>>;
    expect(conexoes[0].dailyWriteLimit).toBe(7);
    expect(resolveDailyWriteLimit(grants.grants.get(GRANT)!)).toBe(7);
  });
});

describe('renomear e mudar o teto (F21.5a)', () => {
  it('o dono renomeia, e o nome declarado pelo cliente deixa de ser o exibido', async () => {
    const { grants, server } = await montar();

    const resposta = await ajustar(server, { name: 'Agente do Wesley' });
    expect(resposta.status).toBe(200);
    const body = await corpo(resposta);
    expect((body.connection as unknown as Record<string, unknown>).name).toBe('Agente do Wesley');

    const depois = await corpo(await listar(server));
    const conexoes = depois.connections as unknown as Array<Record<string, unknown>>;
    expect(conexoes[0].name).toBe('Agente do Wesley');
    expect(conexoes[0].name).not.toBe(NOME_DECLARADO);
    // Renomear NÃO mexe em permissão: o nome identifica, não autoriza.
    expect(conexoes[0].capabilities).toEqual([...INTEGRATION_CAPABILITIES]);
    expect(grants.grants.get(GRANT)!.policyVersion).toBe(1);
  });

  it('mudar o teto muda o número que a próxima escrita vai ler', async () => {
    const { grants, server } = await montar(2);

    const resposta = await ajustar(server, { dailyWriteLimit: 2 });
    expect(resposta.status).toBe(200);
    const body = await corpo(resposta);
    const conexao = body.connection as unknown as Record<string, unknown>;
    expect(conexao.dailyWriteLimit).toBe(2);
    expect(conexao.usedToday).toBe(2);
    expect(resolveDailyWriteLimit(grants.grants.get(GRANT)!)).toBe(2);
  });

  it('teto zero suspende sem revogar: a conexão continua viva', async () => {
    const { grants, server } = await montar();

    const body = await corpo(await ajustar(server, { dailyWriteLimit: 0 }));
    const conexao = body.connection as unknown as Record<string, unknown>;
    expect(conexao.dailyWriteLimit).toBe(0);
    expect(conexao.live).toBe(true);
    expect(grants.grants.get(GRANT)!.revokedAt).toBeNull();
  });

  it('nome e teto na mesma chamada', async () => {
    const { server } = await montar();

    const body = await corpo(await ajustar(server, { name: 'Robô da entrega', dailyWriteLimit: 12 }));
    const conexao = body.connection as unknown as Record<string, unknown>;
    expect(conexao.name).toBe('Robô da entrega');
    expect(conexao.dailyWriteLimit).toBe(12);
  });
});

describe('quem NÃO pode governar a conexão (F21.5a)', () => {
  it('⚠️ um agente não se renomeia nem aumenta o próprio teto', async () => {
    const { grants, server } = await montar();

    const comoAgente = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${GRANT}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ideworks_auto_qualquercoisa',
          Origin: ORIGIN,
        },
        body: JSON.stringify({ name: 'Suporte oficial', dailyWriteLimit: MAX_DAILY_WRITE_LIMIT }),
      }),
    );

    expect(comoAgente.status).toBe(401);
    expect(grants.grants.get(GRANT)!.name).toBe(NOME_DECLARADO);
    expect(resolveDailyWriteLimit(grants.grants.get(GRANT)!)).toBe(DEFAULT_DAILY_WRITE_LIMIT);
  });

  it('sem sessão não muda nada', async () => {
    const { grants, server } = await montar();
    const resposta = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${GRANT}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ name: 'de ninguém' }),
      }),
    );
    expect(resposta.status).toBe(401);
    expect(grants.grants.get(GRANT)!.name).toBe(NOME_DECLARADO);
  });

  it('a conexão de outra pessoa não é encontrada', async () => {
    const { grants, server } = await montar();
    grants.grants.set(GRANT, grant({ ownerId: OUTRO_ID }));

    const resposta = await ajustar(server, { name: 'alheia' });
    expect(resposta.status).toBe(404);
    expect(grants.grants.get(GRANT)!.name).toBe(NOME_DECLARADO);
  });

  it('pedido de outra origem é recusado antes de mudar qualquer coisa', async () => {
    const { grants, server } = await montar();

    const resposta = await ajustar(server, { name: 'de fora' }, { Origin: 'https://outro.site' });

    expect(resposta.status).toBe(403);
    expect(grants.grants.get(GRANT)!.name).toBe(NOME_DECLARADO);
  });
});

describe('entrada sem sentido é recusada em português (F21.5a)', () => {
  const casos: Array<[string, unknown]> = [
    ['nome vazio', { name: '   ' }],
    ['nome longo demais', { name: 'x'.repeat(81) }],
    ['nome que não é texto', { name: 42 }],
    ['teto negativo', { dailyWriteLimit: -1 }],
    ['teto quebrado', { dailyWriteLimit: 2.5 }],
    ['teto acima do máximo', { dailyWriteLimit: MAX_DAILY_WRITE_LIMIT + 1 }],
    ['teto que não é número', { dailyWriteLimit: '10' }],
    ['nada a mudar', {}],
  ];

  for (const [nome, pedido] of casos) {
    it(`recusa: ${nome}`, async () => {
      const { grants, server } = await montar();
      const resposta = await ajustar(server, pedido);
      expect(resposta.status).toBe(400);
      const body = await corpo(resposta);
      expect(body.error).toBe('invalid_input');
      expect(typeof body.message).toBe('string');
      expect(grants.grants.get(GRANT)!.name).toBe(NOME_DECLARADO);
      expect(resolveDailyWriteLimit(grants.grants.get(GRANT)!)).toBe(DEFAULT_DAILY_WRITE_LIMIT);
    });
  }
});
