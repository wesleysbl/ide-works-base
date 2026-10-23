/**
 * Operação compartilhada `get_context` — F16.3a.
 *
 * Monta o recorte DENTRO da operação: capacidades só da concessão, empresas
 * só da interseção pessoa ∩ grant. Administrar o sistema não amplia o
 * agente. Sem e-mail de terceiros, sem papel administrativo, sem carteira
 * global de clientes.
 *
 * Empresas chegam injetadas (suíte sem Hyperdrive). `companyScope: 'all'`
 * não enumera o universo: lista só o catálogo injetado. Produção deve
 * injetar as empresas que o dono alcança agora, nunca a ficha de clientes.
 */

import {
  GET_CONTEXT_PATH,
  getContextResponseSchema,
  type GetContextResponse,
} from '@/integrations/contract';
import {
  effectiveCapabilities,
  effectiveCompanies,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import { comparePageKey } from '@/integrations/page';
import type { ExecutionOrigin } from '@/server/db';

export type IntegrationCompany = { id: string; name: string };

export type IntegrationCatalog = {
  companies(): Promise<readonly IntegrationCompany[]>;
  displayName(ownerId: string): Promise<string | null>;
  /**
   * As duas leituras numa ida só (perf do servidor, 08/10/2026).
   *
   * Cada uma abria a sua transação — begin, declaração do ator, consulta,
   * commit — e `get_context` pagava as duas. O porto que sabe juntá-las
   * implementa este método; quem não implementa continua respondendo pelos
   * dois métodos acima, um depois do outro (`lerEscopoDoCatalogo`). O
   * resultado é o MESMO: `companies` é a lista de `companies()` e `displayName`
   * é o de `displayName(ownerId)`.
   */
  scope?(ownerId: string): Promise<IntegrationScope>;
};

export type IntegrationScope = {
  companies: readonly IntegrationCompany[];
  displayName: string | null;
};

/**
 * O catálogo lido do jeito mais barato que ele sabe: `scope()` quando existe,
 * senão `displayName()` e depois `companies()` — a ordem que as rotas sempre
 * usaram.
 */
export async function lerEscopoDoCatalogo(
  catalog: IntegrationCatalog,
  ownerId: string,
): Promise<IntegrationScope> {
  if (catalog.scope) return catalog.scope(ownerId);
  const displayName = await catalog.displayName(ownerId);
  return { displayName, companies: await catalog.companies() };
}

export const EMPTY_CATALOG: IntegrationCatalog = {
  async companies() {
    return [];
  },
  async displayName() {
    return null;
  },
};

export class MemoryCatalog implements IntegrationCatalog {
  constructor(
    readonly companyList: readonly IntegrationCompany[] = [],
    readonly names: ReadonlyMap<string, string> = new Map(),
  ) {}

  async companies(): Promise<readonly IntegrationCompany[]> {
    return this.companyList;
  }

  async displayName(ownerId: string): Promise<string | null> {
    return this.names.get(ownerId) ?? null;
  }
}

export type GetContextInput = {
  grant: IntegrationGrant;
  person: PersonAccess;
  origin: ExecutionOrigin;
  companies?: readonly IntegrationCompany[];
  displayName: string;
  now?: Date;
};

function ownerDisplayName(raw: string, ownerId: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : ownerId;
}

function listEffectiveCompanies(
  person: PersonAccess,
  grant: IntegrationGrant,
  catalog: readonly IntegrationCompany[],
): { companyScope: GetContextResponse['effectiveScope']['companyScope']; companies: IntegrationCompany[] } {
  const scope = effectiveCompanies(person, grant);
  const byId = new Map(catalog.map((company) => [company.id, company.name]));
  const asRef = (id: string): IntegrationCompany => ({
    id,
    name: byId.get(id) ?? id,
  });

  let companies: IntegrationCompany[];
  if (scope.kind === 'none') companies = [];
  // F31, Fase 3b: "todas" não lista a empresa omitida — o `companyScope`
  // continua `all` (o formato do contrato não muda), só a lista encolhe.
  else if (scope.kind === 'all')
    companies = catalog
      .filter((company) => !scope.omitted?.has(company.id))
      .map((company) => ({ id: company.id, name: company.name }));
  else companies = [...scope.ids].map(asRef);

  companies.sort((a, b) => comparePageKey({ k: a.name.toLowerCase(), id: a.id }, { k: b.name.toLowerCase(), id: b.id }));
  return { companyScope: scope.kind, companies };
}

export function getContext(input: GetContextInput): GetContextResponse {
  const now = input.now ?? new Date();
  const capabilities = [...effectiveCapabilities(input.person, input.grant, now)].sort();
  const { companyScope, companies } = listEffectiveCompanies(
    input.person,
    input.grant,
    input.companies ?? [],
  );
  const result: GetContextResponse = {
    operation: 'get_context',
    queriedAt: now.toISOString(),
    self: GET_CONTEXT_PATH,
    origin: input.origin,
    owner: {
      id: input.grant.ownerId,
      displayName: ownerDisplayName(input.displayName, input.grant.ownerId),
    },
    integration: {
      id: input.grant.id,
      name: input.grant.name,
    },
    effectiveScope: {
      companies,
      capabilities,
      policyVersion: input.grant.policyVersion,
      companyScope,
    },
  };
  return getContextResponseSchema.parse(result);
}
