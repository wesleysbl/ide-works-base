/**
 * UMA CHAMADA MCP, PONTA A PONTA, CONTADA NO FIO — perf do servidor, 08/10/2026.
 *
 * COMO SE MEDE
 *   A requisição entra por `handleIntegration` (o mesmo ponto do Worker), com
 *   uma credencial de automação, e atravessa o portão de verdade: conferência da
 *   credencial, leitura da pessoa, freio de chamadas, catálogo e despacho. O
 *   banco é o servidor de fio de `src/server/pg-falso.ts` com linhas combinadas,
 *   e o driver é o `postgres.js` de produção (`prepare: false`). Uma "ida" é um
 *   pacote que o servidor responde antes de o cliente falar de novo.
 *
 * O ANTES
 *   Os números "antes" abaixo foram medidos com ESTE MESMO arquivo rodando
 *   contra o código de 08/10/2026 anterior à otimização (commit `2264a4f`):
 *   cada porto abria a sua transação, com a declaração do ator por parâmetro e
 *   os ids como parâmetro.
 */
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarPgFalso, type PgFalso, type RespostaCombinada } from '@/server/pg-falso';
import { withRequestDb } from '@/server/db-request';

const holder: { falso: PgFalso | null } = { falso: null };

// O Worker abre o cliente por `connect` (Hyperdrive). Aqui ele aponta para o servidor de fio.
vi.mock('@/server/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/db')>();
  const { default: postgres } = await import('postgres');
  return {
    ...real,
    connect: () => postgres(holder.falso!.opcoesDoCliente()) as never,
  };
});

const { handleIntegration, AUTOMATION_SECRET_PREFIX } = await import('@/integrations/handler');

const DONO = '11111111-1111-4111-8111-111111111111';
const CONCESSAO = '22222222-2222-4222-8222-222222222222';
const EMPRESA = '33333333-3333-4333-8333-333333333333';
const SEGREDO = `${AUTOMATION_SECRET_PREFIX}${'a'.repeat(40)}`;

const respostas: RespostaCombinada[] = [
  {
    quando: /lookup_live_automation_credential/,
    colunas: [
      'credential_id',
      'grant_id',
      'owner_id',
      'oauth_client_id',
      'name',
      { nome: 'capabilities', oid: 114 },
      'allowed_company_ids',
      'allowed_client_ids',
      'expires_at',
      'revoked_at',
      { nome: 'policy_version', oid: 23 },
      'credential_expires_at',
    ],
    linhas: () => [
      [CONCESSAO, CONCESSAO, DONO, 'claude', 'Claude', '["boards:read","tasks:read"]', null, null, null, null, '1', null],
    ],
  },
  {
    quando: /from ideworks\.profiles/,
    colunas: ['id', { nome: 'is_active', oid: 16 }, { nome: 'is_superadmin', oid: 16 }, 'role', { nome: 'has_all_clients_access', oid: 16 }],
    linhas: () => [[DONO, 't', 'f', 'funcionario', 'f']],
  },
  { quando: /from ideworks\.user_categories uc/, colunas: ['id', 'name'], linhas: () => [[EMPRESA, 'Ide']] },
  { quando: /from ideworks\.user_clients/, colunas: ['id'], linhas: () => [['c-1']] },
  { quando: /from ideworks\.clients c/, colunas: ['id'], linhas: () => [['c-2']] },
  { quando: /integration_rate_count/, colunas: [{ nome: 'um', oid: 23 }, { nome: 'dois', oid: 23 }], linhas: () => [['0', '0']] },
  { quando: /integration_rate_record/, colunas: ['um', 'dois'], linhas: () => [['', '']] },
  { quando: /owner_currently_reaches_company/, colunas: ['id', 'name'], linhas: () => [[EMPRESA, 'Ide']] },
  { quando: /select ideworks\.display_name/, colunas: ['name'], linhas: () => [['Wesley Lourenço']] },
];

beforeAll(async () => {
  holder.falso = await criarPgFalso(respostas);
});

afterAll(async () => {
  await holder.falso?.fechar();
});

beforeEach(() => holder.falso!.zerar());

function ambiente() {
  return {
    IDEWORKS_INTEGRATIONS_ENABLED: 'true',
    IDEWORKS_PUBLIC_SUPABASE_URL: 'https://projeto.supabase.co',
    HYPERDRIVE: { connectionString: `postgres://u:p@127.0.0.1:${holder.falso!.porta}/d` },
  };
}

function chamar(method: string, params: unknown): Promise<Response> {
  return handleIntegration(
    new Request('https://ideworks.test/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SEGREDO}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    ambiente() as never,
  );
}

/** Transações abertas na requisição: cada `begin` do fio é uma. */
const transacoes = () => holder.falso!.consultas.filter((c) => c.trim() === 'begin').length;
const idas = () => holder.falso!.idas.length;

describe('uma chamada MCP, ponta a ponta', () => {
  it('tools/list: o portão e mais nada — sem catálogo', async () => {
    const resposta = await chamar('tools/list', {});
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as { result: { tools: unknown[] } };
    expect(corpo.result.tools.length).toBeGreaterThan(10);

    // Antes (medido em 2264a4f): 6 transações — credencial, pessoa, freio ×2, catálogo ×2 — e 39 idas.
    expect(transacoes()).toBe(3); // credencial · pessoa · freio (conta e registra juntos)
    expect(idas()).toBe(12);
    expect(holder.falso!.consultas.some((c) => /ideworks\.display_name|owner_currently_reaches_company/.test(c))).toBe(false);
  });

  it('get_context: o portão e o catálogo lido uma vez', async () => {
    const resposta = await chamar('tools/call', { name: 'get_context', arguments: {} });
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as {
      result: { structuredContent: { owner: { displayName: string }; effectiveScope: { companies: Array<{ name: string }> } } };
    };
    expect(corpo.result.structuredContent.owner.displayName).toBe('Wesley Lourenço');
    expect(corpo.result.structuredContent.effectiveScope.companies).toEqual([{ id: EMPRESA, name: 'Ide' }]);

    // Antes (medido em 2264a4f): 6 transações e 39 idas — o catálogo era lido em toda chamada.
    expect(transacoes()).toBe(4); // credencial · pessoa · freio · catálogo (empresas + nome juntos)
    expect(idas()).toBe(15);
  });

  it('o recorte da chamada continua vindo da pessoa lida: empresa e clientes alcançados', async () => {
    await chamar('tools/list', {});
    const consultas = holder.falso!.consultas.map((c) => c.replace(/\s+/g, ' '));
    // A leitura da pessoa roda sob o ator DONO da concessão; a credencial e o freio, pré-autenticados.
    expect(consultas.filter((c) => c.includes("set_config('app.user_id'"))).toHaveLength(1);
    expect(consultas.filter((c) => c.includes("set_config('app.preauth'"))).toHaveLength(2);
    // O portão leu o perfil, as empresas e os vínculos do dono, e os clientes pelas empresas.
    for (const trecho of ['from ideworks.profiles', 'from ideworks.user_categories uc', 'from ideworks.user_clients', 'from ideworks.clients c']) {
      expect(consultas.some((c) => c.includes(trecho)), trecho).toBe(true);
    }
  });
});

describe('o portão do OAuth: concessão + pessoa', () => {
  it('numa transação só (eram duas), com o mesmo resultado', async () => {
    const { createSqlGrantStore } = await import('@/integrations/handler');
    const ambienteSql = ambiente() as never;

    const separado = await withRequestDb(async () => {
      const store = createSqlGrantStore(ambienteSql);
      holder.falso!.zerar();
      const grant = await store.get(CONCESSAO, DONO);
      const person = await store.person(DONO);
      return { grant, person, tx: transacoes(), idas: idas() };
    });
    const junto = await withRequestDb(async () => {
      const store = createSqlGrantStore(ambienteSql);
      holder.falso!.zerar();
      const lido = await store.getWithPerson!(CONCESSAO, DONO);
      return { ...lido, tx: transacoes(), idas: idas() };
    });

    expect(junto.grant).toEqual(separado.grant);
    expect(junto.person).toEqual(separado.person);
    expect([...(junto.person?.clientIds ?? [])].sort()).toEqual(['c-1', 'c-2']);
    expect(separado.tx).toBe(2);
    expect(junto.tx).toBe(1);
    // Antes (medido em 2264a4f): `get` + `person` = 18 idas — ids e declaração por
    // parâmetro, quatro leituras da pessoa uma atrás da outra. Hoje: 7 separados, 4 juntos.
    expect(separado.idas).toBe(7);
    expect(junto.idas).toBe(4);
  });
});
