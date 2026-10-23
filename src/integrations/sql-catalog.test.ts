/**
 * A fiação do catálogo de empresas.
 *
 * O defeito que estes testes travam: `get_context` autenticava, trazia as
 * capacidades certas e `effectiveScope.companies: []`. O handler despachava
 * `EMPTY_CATALOG` sempre — não existia versão SQL — e escopo `'all'` é
 * "mapeie o catálogo", que no vazio dá vazio. O agente não alcançava quadro,
 * cliente nem pessoa nenhuma.
 */

import { describe, expect, it } from 'vitest';

import { EMPTY_CATALOG, MemoryCatalog, getContext } from '@/integrations/context';
import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import { catalogFor, type IntegrationEnv } from '@/integrations/handler';
import { SqlIntegrationCatalog } from '@/integrations/sql-catalog';
import type { Actor } from '@/server/db';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_A = '22222222-2222-4222-8222-222222222222';
const COMPANY_B = '33333333-3333-4333-8333-333333333333';

const ACTOR: Actor = {
  kind: 'user',
  userId: OWNER_ID,
  isSuperadmin: true,
  isSuper: true,
};

const CATALOG = new MemoryCatalog(
  [
    { id: COMPANY_A, name: 'Agência Ide' },
    { id: COMPANY_B, name: 'Ide Filmes' },
  ],
  new Map([[OWNER_ID, 'Wesley Lourenço']]),
);

const SUPER_PERSON: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [],
  clientIds: [],
  hasAllClientsAccess: true,
};

/** Concessão sem allowlist de empresa: o recorte é o alcance do dono. */
const GRANT_ALL: IntegrationGrant = {
  id: 'grant-todas',
  ownerId: OWNER_ID,
  oauthClientId: 'claude',
  name: 'Claude',
  capabilities: ['boards:read'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 3,
};

const SEM_BANCO = {} as IntegrationEnv;
const COM_BANCO = {
  IDEWORKS_SERVER_DB_USER: 'ideworks_app',
  IDEWORKS_SERVER_DB_PASSWORD: 'segredo',
} as unknown as IntegrationEnv;

describe('catalogFor', () => {
  it('dá precedência ao catálogo injetado, mesmo com banco configurado', () => {
    expect(catalogFor(COM_BANCO, { catalog: CATALOG }, ACTOR)).toBe(CATALOG);
  });

  it('sem banco e sem injeção cai no catálogo vazio', () => {
    expect(catalogFor(SEM_BANCO, {}, ACTOR)).toBe(EMPTY_CATALOG);
  });

  it('com banco e sem injeção usa a versão SQL — era esta que não existia', () => {
    expect(catalogFor(COM_BANCO, {}, ACTOR)).toBeInstanceOf(SqlIntegrationCatalog);
  });
});

describe('get_context com escopo "todas as que eu alcanço"', () => {
  it('devolve as empresas do catálogo, não uma lista vazia', async () => {
    const companies = await CATALOG.companies();
    const context = getContext({
      grant: GRANT_ALL,
      person: SUPER_PERSON,
      origin: 'http',
      companies,
      displayName: 'Wesley Lourenço',
      now: new Date('2026-09-21T12:00:00.000Z'),
    });

    expect(context.effectiveScope.companyScope).toBe('all');
    // A regressão exata do relato do usuário: aqui vinha `[]`.
    expect(context.effectiveScope.companies).not.toEqual([]);
    expect(context.effectiveScope.companies.map((company) => company.name)).toEqual([
      'Agência Ide',
      'Ide Filmes',
    ]);
  });

  it('catálogo vazio ainda devolve vazio — o catálogo não inventa empresa', async () => {
    const context = getContext({
      grant: GRANT_ALL,
      person: SUPER_PERSON,
      origin: 'http',
      companies: await EMPTY_CATALOG.companies(),
      displayName: 'Wesley Lourenço',
      now: new Date('2026-09-21T12:00:00.000Z'),
    });
    expect(context.effectiveScope.companies).toEqual([]);
  });
});

describe('SqlIntegrationCatalog.displayName', () => {
  it('id que não é uuid não vira consulta', async () => {
    const catalog = new SqlIntegrationCatalog({} as never, ACTOR);
    await expect(catalog.displayName('nao-e-uuid')).resolves.toBeNull();
  });
});
