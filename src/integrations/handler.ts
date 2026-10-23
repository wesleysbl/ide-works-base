/**
 * Integração F16.2 — OAuth (2a) + gestão, revogação e limites (2b).
 *
 * Evolui a prova F16.0 no mesmo servidor: `/mcp`, `/oauth/*` e
 * `/.well-known/oauth-*` continuam ANTES do fallback `ASSETS`. Não há um
 * segundo provedor OAuth. A sessão de trabalho (`ideworks_sessao`,
 * SameSite=Strict) não viaja no primeiro GET vindo do agente; o pedido
 * OAuth (state/PKCE/redirect) mora num cookie Lax próprio e no KV, o
 * login existente identifica a pessoa, e só então o consentimento grava
 * a concessão.
 *
 * KV: o binding `OAUTH_KV` do `wrangler.toml` (namespace `ide-works-oauth`),
 * publicado em 21/09/2026. Sem binding — dev e suíte — cai em `MemoryKv`, que
 * é memória do isolado: em produção isso fazia `/oauth/register` e
 * `/oauth/authorize` caírem em isolados diferentes e devolvia
 * `400 Invalid client_id`. Segredos não entram no git.
 *
 * F16.2b: gestão mínima de conexões (sessão humana, não token de agente),
 * credencial de automação (só o verificador no store), revogação no domínio
 * — a fonte da verdade é o grant store, não o KV OAuth — e limites
 * distribuídos por integração/proprietário. `resolveIntegrationActor`
 * revalida concessão e perfil ativo em cada operação.
 *
 * F16.3a: `/api/integrations/v1` despacha o contrato HTTP (`get_context`).
 * F16.3b: as mesmas rotas leem trabalho recortado (`search`, quadro, ficha,
 * cliente, conversa). F16.3c: `list_people` e `get_person_work`; o Worker
 * liga `SqlWorkCatalog` quando há Hyperdrive, com `integration` no Actor.
 * F16.4a: `get_delivery_report` pela mesma fórmula de `calculateDeliveryLevel`;
 * `SqlDeliveryCatalog` no Worker. F16.4b: `get_marketing_report` lê o já
 * coletado via `@/meta/relatorio` (sem disparar coleta). F16.5: o MCP chama
 * as mesmas operações do HTTP; `get_context` deixa de ser sintético.
 */

import { createSqlAdminWeekCatalog, type AdminWeekCatalog } from '@/integrations/admin-semana';
import {
  AuthorizationError,
  OAuthProvider,
  getOAuthApi,
  type AuthRequest,
  type OAuthHelpers,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider';

import {
  CONNECTIONS_PATH,
  HTTP_INTEGRATIONS_PATH,
  INTEGRATION_UNAVAILABLE_MESSAGE,
  integrationError,
} from '@/integrations/contract';
import { handleMcpRequest } from '@/integrations/mcp';
import { EMPTY_CATALOG, type IntegrationCatalog } from '@/integrations/context';
import { createSqlIntegrationCatalog } from '@/integrations/sql-catalog';
import { EMPTY_WORK_CATALOG, type WorkCatalog } from '@/integrations/reads';
import {
  EMPTY_DELIVERY_CATALOG,
  createSqlDeliveryCatalog,
  type DeliveryCatalog,
} from '@/integrations/reports';
import {
  EMPTY_MARKETING_CATALOG,
  createSqlMarketingCatalog,
  type MarketingCatalog,
} from '@/integrations/marketing';
import { createSqlWorkCatalog } from '@/integrations/sql-work';
import {
  MAX_DAILY_WRITE_LIMIT,
  MemoryAgentWriteStore,
  agencyDayWindow,
  createSqlAgentWriteStore,
  directClientIdsQuery,
  reachableClientIdsInTx,
  resolveDailyWriteLimit,
  type AgentWriteStore,
} from '@/integrations/executions';
import {
  UndoRefused,
  createSqlUndoStore,
  parseUndoWindow,
  undoGrantWrites,
  type UndoStore,
} from '@/integrations/undo';
import {
  SQL_COMMENT_MUTATOR,
  type BoardMutator,
  type ClientRecordMutator,
  type CommentMutator,
  type TaskMutator,
} from '@/integrations/writes';
import {
  CAPABILITY_LABELS,
  INTEGRATION_CAPABILITIES,
  WRITE_CAPABILITIES,
  WRITE_DEPENDENCY_REASONS,
  WRITE_REQUIRES_READ,
  asIntegrationActor,
  assertWriteImpliesRead,
  companyOmitted,
  grantIsLive,
  hashAutomationSecret,
  isIntegrationCapability,
  type IntegrationCapability,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import { dispatchIntegrationHttp, isHttpIntegrationApiPath, isOpenApiPath, openApiResponse } from '@/integrations/http';
import {
  DeadlineExceededError,
  INTEGRATION_DEADLINE_MS,
  INTEGRATION_MAX_BODY_BYTES,
  INTEGRATION_RATE_LIMITS,
  IntegrationUnavailableError,
  MemoryRateLimitStore,
  admitIntegrationRateLimit,
  oversizedBody,
  rateLimitRetryMessage,
  resolveRequestId,
  withDeadline,
  withRequestId,
  type IntegrationRateLimitStore,
  type IntegrationRateRule,
  type IntegrationRateScope,
} from '@/integrations/limits';
import {
  arrayOuNulo,
  inlineSha256,
  inlineTimestamp,
  inlineUuid,
  inlineWord,
  userActor,
  withActor,
  type Actor,
  type ServerEnv,
  type Sql,
  type Tx,
} from '@/server/db';
import { borrowSql, withRequestDb } from '@/server/db-request';
import { conferirOmitidas, lerNomesOmitidos } from '@/server/omitidas';
import {
  CABECALHO_DE_MEDICAO,
  cabecalhoDeMedicao,
  medirBancoDaRequisicao,
  type MedicaoDeBanco,
} from '@/server/db-medicao';
import {
  asDbActor,
  resolveActor,
  type AuthenticatedActor,
  type SessionProvider,
  type SessionResult,
} from '@/server/session';

export const PROOF_REDIRECT_URI = 'https://agent.test/callback';
export const PROOF_SCOPE = 'mcp:read';
export const SYNTHETIC_SUBJECT = {
  id: 'proof-user',
  name: 'Agente de prova',
  kind: 'synthetic',
} as const;

export const OAUTH_REQUEST_COOKIE = 'ideworks_oauth_pedido';

/**
 * O id que `server.fetch` resolveu para cada requisição — auditoria de
 * 08/10/2026. O provedor OAuth entrega ao despacho o MESMO objeto `Request`,
 * e o id não viaja nele quando o chamador não mandou `X-Request-Id`. Sem isto,
 * a falha inesperada de uma ferramenta MCP iria para o log com um id que a
 * resposta não tem.
 */
const REQUEST_IDS = new WeakMap<Request, string>();
export const OAUTH_CSRF_COOKIE = 'ideworks_oauth_csrf';
export const OAUTH_AUTHORIZE_PATH = '/oauth/authorize';
export const OAUTH_CONSENT_PATH = '/oauth/consent';
export const LOGIN_NEXT = OAUTH_AUTHORIZE_PATH;
export { CONNECTIONS_PATH, GET_CONTEXT_PATH, HTTP_INTEGRATIONS_PATH, OPENAPI_PATH } from '@/integrations/contract';
/** Prefixo do segredo de automação. Distingue do token OAuth sem ir ao banco. */
export const AUTOMATION_SECRET_PREFIX = 'iw_at_';

export function mcpAudience(origin: string): string {
  return `${origin}/mcp`;
}

export function httpAudience(origin: string): string {
  return `${origin}${HTTP_INTEGRATIONS_PATH}`;
}

export function loginRedirectLocation(origin: string): string {
  return `${origin}/?next=${encodeURIComponent(LOGIN_NEXT)}`;
}

export type ProofKv = {
  get(key: string, options?: { type?: string }): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }>;
};

export type IntegrationEnv = Partial<ServerEnv> & {
  OAUTH_KV?: ProofKv;
  OAUTH_PROVIDER?: OAuthHelpers;
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY?: string;
  /**
   * Interruptor da superfície de agentes. Só o texto exato `'false'` desliga.
   * Ausência ou qualquer outro valor deixa ligado — o mesmo padrão de
   * `IDEWORKS_TEST_ACCOUNTS_ONLY` em `wrangler.toml`.
   */
  IDEWORKS_INTEGRATIONS_ENABLED?: string;
  /** Interruptor das escritas (`add_comment` / `move_task`). Mesma leitura. */
  IDEWORKS_INTEGRATION_WRITES_ENABLED?: string;
  /**
   * As empresas OMITIDAS das telas — F31, Fase 3b. A MESMA variável da API
   * humana (`wrangler.toml`), lida aqui para o agente ver o mesmo recorte que
   * a pessoa vê. Ausente ou vazia = nada omitido.
   */
  IDEWORKS_EMPRESAS_OMITIDAS?: string;
};

/** Só `'false'` (minúsculo, exato) desliga. Qualquer outro valor ou ausência deixa ligado. */
export function envFlagEnabled(value: string | undefined): boolean {
  return value !== 'false';
}

export function integrationsEnabled(env?: Pick<IntegrationEnv, 'IDEWORKS_INTEGRATIONS_ENABLED'>): boolean {
  return envFlagEnabled(env?.IDEWORKS_INTEGRATIONS_ENABLED);
}

export function integrationWritesEnabled(
  env?: Pick<IntegrationEnv, 'IDEWORKS_INTEGRATION_WRITES_ENABLED'>,
): boolean {
  return envFlagEnabled(env?.IDEWORKS_INTEGRATION_WRITES_ENABLED);
}

/** O que o agente lê no 401: a causa e o que fazer (quem reconecta é a pessoa, no site). */
const CONCESSAO_INVALIDA_MESSAGE = 'Concessão inválida ou revogada. Reconecte a IA em Conexões, no IDE Works, e tente de novo.';
const AUDIENCIA_RECUSADA_MESSAGE =
  'Concessão inválida ou audiência recusada. Reconecte a IA em Conexões, no IDE Works, e tente de novo.';

export function integrationDisabledResponse(): Response {
  return integrationError('unavailable', INTEGRATION_UNAVAILABLE_MESSAGE);
}

export type ProofEnv = IntegrationEnv;
export type ProofExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
  props?: unknown;
};

export type TokenProps = {
  grantId: string;
  ownerId: string;
  origin: 'mcp' | 'http' | 'automation';
  clientId: string;
  capabilities: IntegrationCapability[];
  subjectId: string;
  subjectKind: 'human' | 'synthetic';
  subjectName?: string;
  integration?: string;
  scopes?: string[];
};

export type StoredAutomationCredential = {
  id: string;
  grantId: string;
  responsibleId: string;
  secretVerifier: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

export type IntegrationExecutionSummary = {
  id: string;
  grantId: string;
  grantName: string;
  ownerId: string;
  operation: string;
  targetId: string;
  occurredAt: string;
  origin: string;
  active: boolean;
  result: Record<string, unknown>;
  /** F21.2 — quando o dono desfez esta escrita. Nulo = continua valendo. */
  undoneAt: string | null;
};

export type GrantStore = {
  insert(input: {
    owner: AuthenticatedActor;
    oauthClientId: string;
    name: string;
    capabilities: readonly IntegrationCapability[];
    allowedCompanyIds: readonly string[] | null;
    allowedClientIds: readonly string[] | null;
  }): Promise<IntegrationGrant>;
  get(id: string, ownerId?: string): Promise<IntegrationGrant | null>;
  person(userId: string): Promise<PersonAccess | null>;
  /**
   * As duas leituras do portão numa ida só (perf do servidor, 08/10/2026):
   * `get(id, ownerId)` e `person(ownerId)` na MESMA transação, com o MESMO
   * resultado de cada uma. Opcional — quem não implementa responde pelos dois
   * métodos acima, um depois do outro (`loadGrantContext`).
   */
  getWithPerson?(
    id: string,
    ownerId: string,
  ): Promise<{ grant: IntegrationGrant | null; person: PersonAccess | null }>;
  list(ownerId: string): Promise<IntegrationGrant[]>;
  revoke(id: string, ownerId: string): Promise<IntegrationGrant | null>;
  issueCredential(
    grantId: string,
    ownerId: string,
    secretVerifier: string,
  ): Promise<StoredAutomationCredential | null>;
  lookupByVerifier(
    secretVerifier: string,
  ): Promise<{ grant: IntegrationGrant; credential: StoredAutomationCredential } | null>;
  /** Ledger recente do dono. Gestão humana; o agente não lista por aqui. */
  listExecutions(ownerId: string, limit?: number): Promise<IntegrationExecutionSummary[]>;
  /**
   * Cota gasta hoje, por concessão do dono (F21.5a). Conta a MESMA coisa que
   * `countWritesInWindow` conta na hora de recusar — se contasse outra, a tela
   * mostraria um número e o freio aplicaria outro.
   */
  countWritesToday(
    ownerId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ grantId: string; used: number }>>;
  /**
   * O dono troca o nome da conexão (F21.5a). O nome de nascença é o
   * `client_name` que o cliente OAuth declarou — ele IDENTIFICA, não AUTORIZA,
   * e nada no servidor decide nada a partir dele.
   */
  rename(id: string, ownerId: string, name: string): Promise<IntegrationGrant | null>;
  /** O dono muda o teto diário de escritas da concessão (F21.5a). */
  setDailyWriteLimit(id: string, ownerId: string, limit: number): Promise<IntegrationGrant | null>;
};

/**
 * KV efêmero do isolado — SÓ para dev e suíte.
 *
 *   A Cloudflare roda várias cópias do Worker e não compartilha esta memória
 *   entre elas, nem a preserva. Em produção quem entra é o namespace do
 *   binding `OAUTH_KV`; aqui o valor é ser determinístico e inspecionável
 *   (`store`, `cloneInto`, `expire*`) sem rede.
 */
export class MemoryKv implements ProofKv {
  readonly store = new Map<string, { value: string; expiresAt?: number }>();

  private read(key: string): string | null {
    const row = this.store.get(key);
    if (!row) return null;
    if (row.expiresAt !== undefined && row.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return row.value;
  }

  async get(key: string, options?: { type?: string }): Promise<unknown> {
    const value = this.read(key);
    if (value === null) return null;
    if (options?.type === 'json') return JSON.parse(value) as unknown;
    return value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt =
      options?.expirationTtl !== undefined ? Date.now() + options.expirationTtl * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix ?? '';
    const limit = options?.limit ?? 1000;
    const names = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = options?.cursor ? Number(options.cursor) : 0;
    const slice = names.slice(start, start + limit);
    const next = start + slice.length;
    return {
      keys: slice.map((name) => ({ name })),
      list_complete: next >= names.length,
      cursor: next >= names.length ? undefined : String(next),
    };
  }

  /** Simula expiração/revogação: o valor do token continua com o cliente, o registro some. */
  expireStoredTokens(): void {
    for (const key of [...this.store.keys()]) {
      if (key.startsWith('token:')) this.store.delete(key);
    }
  }

  /** Simula o TTL de 600s do código de autorização na biblioteca OAuth. */
  expireAuthorizationCodes(): void {
    for (const [key, row] of this.store) {
      if (key.startsWith('grant:')) row.expiresAt = Date.now() - 1;
    }
  }

  /** Copia o KV para outro isolado: o token continua lá, a grant store é outra história. */
  cloneInto(other: MemoryKv): void {
    for (const [key, row] of this.store) {
      other.store.set(key, { value: row.value, expiresAt: row.expiresAt });
    }
  }
}

export class MemoryProofKv extends MemoryKv {}

/**
 * O `MemoryKv` por tras de um servidor — SÓ para a suíte e o harness.
 *
 *   `IntegrationServer.kv` é `ProofKv` porque em produção ele é o namespace
 *   publicado, que não tem `store` nem `expire*`. Quem precisa desses atalhos
 *   está inspecionando um servidor de memória; se não for o caso, falhar aqui
 *   é melhor do que seguir com um objeto que não responde ao que se espera.
 */
export function memoryKvOf(server: { kv: ProofKv }): MemoryKv {
  if (!(server.kv instanceof MemoryKv)) {
    throw new Error('memoryKvOf: este servidor usa o KV publicado, não a memória do isolado.');
  }
  return server.kv;
}

export class MemoryGrantStore implements GrantStore {
  readonly grants = new Map<string, IntegrationGrant>();
  readonly people = new Map<string, PersonAccess>();
  readonly credentials = new Map<string, StoredAutomationCredential>();
  readonly executions: IntegrationExecutionSummary[] = [];

  seedPerson(person: PersonAccess): void {
    this.people.set(person.userId, person);
  }

  async insert(input: Parameters<GrantStore['insert']>[0]): Promise<IntegrationGrant> {
    for (const [id, grant] of this.grants) {
      if (grant.ownerId === input.owner.userId && grant.oauthClientId === input.oauthClientId && grant.revokedAt === null) {
        this.grants.set(id, { ...grant, revokedAt: new Date() });
      }
    }
    const grant: IntegrationGrant = {
      id: crypto.randomUUID(),
      ownerId: input.owner.userId,
      oauthClientId: input.oauthClientId,
      name: input.name,
      capabilities: [...input.capabilities],
      allowedCompanyIds: input.allowedCompanyIds,
      allowedClientIds: input.allowedClientIds,
      expiresAt: null,
      revokedAt: null,
      policyVersion: 1,
    };
    this.grants.set(grant.id, grant);
    return grant;
  }

  async get(id: string, ownerId?: string): Promise<IntegrationGrant | null> {
    const grant = this.grants.get(id) ?? null;
    if (!grant) return null;
    if (ownerId && grant.ownerId !== ownerId) return null;
    return grant;
  }

  async person(userId: string): Promise<PersonAccess | null> {
    return this.people.get(userId) ?? null;
  }

  async list(ownerId: string): Promise<IntegrationGrant[]> {
    return [...this.grants.values()].filter((grant) => grant.ownerId === ownerId);
  }

  async revoke(id: string, ownerId: string): Promise<IntegrationGrant | null> {
    const grant = await this.get(id, ownerId);
    if (!grant) return null;
    const revoked =
      grant.revokedAt === null ? { ...grant, revokedAt: new Date(), policyVersion: grant.policyVersion + 1 } : grant;
    this.grants.set(id, revoked);
    const now = revoked.revokedAt ?? new Date();
    for (const [credentialId, credential] of this.credentials) {
      if (credential.grantId === id && credential.revokedAt === null) {
        this.credentials.set(credentialId, { ...credential, revokedAt: now });
      }
    }
    return revoked;
  }

  async issueCredential(
    grantId: string,
    ownerId: string,
    secretVerifier: string,
  ): Promise<StoredAutomationCredential | null> {
    const grant = await this.get(grantId, ownerId);
    if (!grant || !grantIsLive(grant)) return null;
    const now = new Date();
    for (const [credentialId, credential] of this.credentials) {
      if (credential.grantId === grantId && credential.revokedAt === null) {
        this.credentials.set(credentialId, { ...credential, revokedAt: now });
      }
    }
    const record: StoredAutomationCredential = {
      id: crypto.randomUUID(),
      grantId,
      responsibleId: ownerId,
      secretVerifier,
      revokedAt: null,
      expiresAt: null,
    };
    this.credentials.set(record.id, record);
    return record;
  }

  async rename(id: string, ownerId: string, name: string): Promise<IntegrationGrant | null> {
    const grant = await this.get(id, ownerId);
    if (!grant) return null;
    const renomeada = { ...grant, name };
    this.grants.set(id, renomeada);
    return renomeada;
  }

  async setDailyWriteLimit(id: string, ownerId: string, limit: number): Promise<IntegrationGrant | null> {
    const grant = await this.get(id, ownerId);
    if (!grant) return null;
    const mudada = { ...grant, dailyWriteLimit: limit };
    this.grants.set(id, mudada);
    return mudada;
  }

  async countWritesToday(
    ownerId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ grantId: string; used: number }>> {
    const conta = new Map<string, number>();
    for (const row of this.executions) {
      if (row.ownerId !== ownerId) continue;
      const quando = new Date(row.occurredAt).getTime();
      if (quando < from.getTime() || quando >= to.getTime()) continue;
      conta.set(row.grantId, (conta.get(row.grantId) ?? 0) + 1);
    }
    return [...conta].map(([grantId, used]) => ({ grantId, used }));
  }

  async listExecutions(ownerId: string, limit = 50): Promise<IntegrationExecutionSummary[]> {
    const teto = Math.min(100, Math.max(1, limit));
    return this.executions
      .filter((row) => row.ownerId === ownerId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, teto);
  }

  async lookupByVerifier(
    secretVerifier: string,
  ): Promise<{ grant: IntegrationGrant; credential: StoredAutomationCredential } | null> {
    for (const credential of this.credentials.values()) {
      if (credential.secretVerifier !== secretVerifier) continue;
      if (credential.revokedAt !== null) continue;
      if (credential.expiresAt !== null && credential.expiresAt.getTime() <= Date.now()) continue;
      const grant = this.grants.get(credential.grantId);
      if (!grant) return null;
      return { grant, credential };
    }
    return null;
  }
}

export type CreateIntegrationOptions = {
  /**
   * Onde o estado do OAuth mora. `MemoryKv` na suíte; em produção é o
   * `KVNamespace` publicado (binding `OAUTH_KV`). Tipado por `ProofKv` — o
   * contrato mínimo — porque o namespace da Cloudflare NÃO é `instanceof
   * MemoryKv`, e exigir a classe fazia produção cair na memória do isolado.
   */
  kv?: ProofKv;
  accessTokenTTL?: number;
  refreshTokenTTL?: number;
  resolveSession?: (request: Request, env: IntegrationEnv) => Promise<SessionResult>;
  grants?: GrantStore;
  rateLimits?: IntegrationRateLimitStore;
  rateRules?: Record<IntegrationRateScope, IntegrationRateRule>;
  deadlineMs?: number;
  maxBodyBytes?: number;
  /**
   * Empresas e nome de exibição do dono, injetáveis. A suíte não fala com
   * Hyperdrive; produção pode ligar um catálogo real depois, sem mudar o contrato.
   */
  catalog?: IntegrationCatalog;
  /** Trabalho recortável (quadros/tarefas/clientes/comentários). Mesma ideia do catálogo de empresas. */
  work?: WorkCatalog;
  /** Relatório de entrega recortável. A suíte injeta memória; o Worker liga SQL. */
  delivery?: DeliveryCatalog;
  /** Relatório de marketing já coletado. A suíte injeta memória; o Worker liga SQL. */
  marketing?: MarketingCatalog;
  /** Ledger das escritas. A suíte injeta memória; o Worker liga SQL com `integration` no Actor. */
  writes?: AgentWriteStore;
  /** Miolo de comentário. A suíte injeta memória; produção usa `postCommentInTx`. */
  comments?: CommentMutator;
  /** Quadro injetável para `move_task`. A suíte usa memória; o Worker liga SQL. */
  board?: BoardMutator;
  /** F26.5 — escritas de tarefa. A suíte usa memória; o Worker liga SQL (miolos da F26.3). */
  tasks?: TaskMutator;
  /** F26.6 — mural e histórico. A suíte usa memória; o Worker liga SQL (miolos da F26.3). */
  clientRecords?: ClientRecordMutator;
  /** F40, Fase 9 — a leitura do painel dos admins. A suíte usa memória; o Worker liga SQL. */
  adminWeek?: AdminWeekCatalog;
  /**
   * Desfazer em lote (F21.2). A suíte injeta memória; o Worker abre a
   * transação com o ator do DONO — é o que faz o lote respeitar as permissões
   * dele sem nenhum `if` de permissão no caminho.
   */
  undo?: UndoStore;
  /**
   * Só a suíte F16.0. O Worker real nunca liga isto: consentimento sintético
   * concederia poderes sem a pessoa escolher capacidades.
   */
  syntheticConsent?: boolean;
  /**
   * Registra, ao montar, o cliente OAuth de prova (retorno
   * `PROOF_REDIRECT_URI`) cujo id sai em `IntegrationServer.clientId` — é por
   * ele que a suíte e o roteiro de prova começam o fluxo. Ausente = registra,
   * como sempre. O servidor do Worker passa `false`: cada montagem gravava um
   * cliente novo, sem prazo, no KV publicado (auditoria de 08/10/2026).
   */
  registerTestClient?: boolean;
};

export type IntegrationServer = {
  fetch(request: Request, env?: IntegrationEnv, ctx?: ProofExecutionContext): Promise<Response>;
  helpers: OAuthHelpers;
  /** O KV efetivamente em uso. Pode ser memória (suíte) ou o namespace publicado. */
  kv: ProofKv;
  /** O cliente OAuth de prova. Vazio quando ele não foi registrado (o Worker). */
  clientId: string;
  grants: GrantStore;
  rateLimits: IntegrationRateLimitStore;
};

export type CreateAgentProofOptions = Pick<CreateIntegrationOptions, 'kv' | 'accessTokenTTL' | 'refreshTokenTTL'>;
export type AgentProof = IntegrationServer;

export function isIntegrationPath(pathname: string): boolean {
  return (
    pathname === '/mcp' ||
    pathname.startsWith('/mcp/') ||
    pathname.startsWith('/oauth/') ||
    pathname.startsWith('/.well-known/oauth-authorization-server') ||
    pathname.startsWith('/.well-known/oauth-protected-resource') ||
    pathname === HTTP_INTEGRATIONS_PATH ||
    pathname.startsWith(`${HTTP_INTEGRATIONS_PATH}/`)
  );
}

export const isAgentProofPath = isIntegrationPath;

/**
 * Revalida a concessão no domínio mesmo que o KV ainda tenha o token.
 * Perfil desativado (`isActive=false`) recusa na próxima operação; grant
 * com `revoked_at` também — o KV OAuth de outro isolado não atravessa.
 */
export async function resolveIntegrationActor(input: {
  props: Partial<TokenProps>;
  grant: IntegrationGrant | null;
  person: PersonAccess | null;
  origin: TokenProps['origin'];
  now?: Date;
}): Promise<Actor | null> {
  const { props, grant, person, origin, now } = input;
  if (!grant || !person) return null;
  if (!person.isActive) return null;
  if (person.userId !== grant.ownerId) return null;
  if (props.grantId && props.grantId !== grant.id) return null;
  if (props.ownerId && props.ownerId !== grant.ownerId) return null;
  if (!grantIsLive(grant, now)) return null;
  return asIntegrationActor(
    { userId: person.userId, isSuperadmin: person.isSuperadmin, isSuper: person.isSuper },
    {
      integrationId: grant.id,
      grantId: grant.id,
      ownerId: grant.ownerId,
      origin,
    },
  );
}

function emptyCtx(): ProofExecutionContext {
  return { waitUntil() {}, passThroughOnException() {}, props: {} };
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)));
}

function cookieValue(request: Request, nome: string): string | null {
  const bruto = request.headers.get('Cookie');
  if (!bruto) return null;
  for (const par of bruto.split(';')) {
    const [chave, ...resto] = par.trim().split('=');
    if (chave === nome) return resto.join('=') || null;
  }
  return null;
}

function laxCookie(nome: string, valor: string, maxAgeSeconds: number): string {
  return [`${nome}=${valor}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure', `Max-Age=${maxAgeSeconds}`].join('; ');
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(body: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function unavailableResponse(error: IntegrationUnavailableError): Response {
  const message =
    error.code === 'grant_store_unavailable'
      ? 'Não foi possível confirmar a concessão. A operação não foi executada.'
      : error.code === 'undo_store_unavailable'
        ? 'Não foi possível abrir o desfazer em lote. Nenhum comentário foi apagado.'
        : 'Não foi possível confirmar o limite de chamadas. A operação não foi executada.';
  return json({ error: error.code, message }, 503);
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  return json(
    {
      error: 'rate_limited',
      message: rateLimitRetryMessage(retryAfterSeconds),
      retryAfterSeconds,
    },
    429,
    { 'Retry-After': String(retryAfterSeconds) },
  );
}

function deadlineResponse(deadlineMs: number): Response {
  return json(
    {
      error: 'deadline_exceeded',
      message: `A operação estourou o prazo de ${Math.max(1, Math.round(deadlineMs / 1000))}s. Peça menos de uma vez (período menor, limit menor, filtro por cliente) e tente de novo; se repetir, avise quem conectou. Se era uma escrita, confira o resultado antes de repetir (a mesma idempotencyKey não grava de novo).`,
    },
    504,
  );
}

function isManagementPath(pathname: string): boolean {
  return pathname === CONNECTIONS_PATH || pathname.startsWith(`${CONNECTIONS_PATH}/`);
}

export function isAutomationSecret(value: string): boolean {
  return value.startsWith(AUTOMATION_SECRET_PREFIX) && value.length >= 32;
}

function grantFromRow(row: Record<string, unknown>): IntegrationGrant {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    oauthClientId: row.oauth_client_id as string,
    name: row.name as string,
    capabilities: (row.capabilities as IntegrationCapability[]) ?? [],
    allowedCompanyIds: (row.allowed_company_ids as string[] | null) ?? null,
    allowedClientIds: (row.allowed_client_ids as string[] | null) ?? null,
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
    policyVersion: row.policy_version as number,
    // Quando a pessoa autorizou (F44, Fase 9). Ausente = linha de dublê.
    createdAt: row.created_at ? new Date(row.created_at as string) : null,
    // Ausente = a migration da F21.1 ainda não chegou neste banco. Nulo aqui
    // vira o padrão em `resolveDailyWriteLimit` — nunca "sem teto".
    dailyWriteLimit:
      row.daily_write_limit === null || row.daily_write_limit === undefined
        ? null
        : Number(row.daily_write_limit),
  };
}

function canConnect(env: IntegrationEnv): boolean {
  return Boolean(env.HYPERDRIVE?.connectionString || (env.IDEWORKS_SERVER_DB_USER && env.IDEWORKS_SERVER_DB_PASSWORD));
}

/**
 * O catálogo de empresas e nomes. Mesmo padrão dos outros três: injeção tem
 * precedência (a suíte manda um `MemoryCatalog`), sem banco cai no vazio, e
 * com banco lê o banco. Antes daqui o Worker despachava sempre o vazio, e
 * `get_context` respondia `companies: []` em produção.
 */
export function catalogFor(
  env: IntegrationEnv,
  options: CreateIntegrationOptions,
  actor: Actor,
): IntegrationCatalog {
  if (options.catalog) return options.catalog;
  if (!canConnect(env)) return EMPTY_CATALOG;
  return createSqlIntegrationCatalog(env as ServerEnv, actor);
}

function workCatalogFor(env: IntegrationEnv, options: CreateIntegrationOptions, actor: Actor): WorkCatalog {
  if (options.work) return options.work;
  if (!canConnect(env)) return EMPTY_WORK_CATALOG;
  return createSqlWorkCatalog(env as ServerEnv, actor);
}

function deliveryCatalogFor(
  env: IntegrationEnv,
  options: CreateIntegrationOptions,
  actor: Actor,
): DeliveryCatalog {
  if (options.delivery) return options.delivery;
  if (!canConnect(env)) return EMPTY_DELIVERY_CATALOG;
  return createSqlDeliveryCatalog(env as ServerEnv, actor);
}

function marketingCatalogFor(
  env: IntegrationEnv,
  options: CreateIntegrationOptions,
  actor: Actor,
): MarketingCatalog {
  if (options.marketing) return options.marketing;
  if (!canConnect(env)) return EMPTY_MARKETING_CATALOG;
  return createSqlMarketingCatalog(env as ServerEnv, actor);
}

function writePortsFor(
  env: IntegrationEnv,
  options: CreateIntegrationOptions,
  actor: Actor,
): {
  writes: AgentWriteStore;
  comments: CommentMutator;
  board?: BoardMutator;
  tasks?: TaskMutator;
  clientRecords?: ClientRecordMutator;
  adminWeek?: AdminWeekCatalog;
} {
  const writes =
    options.writes ??
    (canConnect(env) ? createSqlAgentWriteStore(env as ServerEnv, actor) : new MemoryAgentWriteStore());
  return {
    writes,
    comments: options.comments ?? SQL_COMMENT_MUTATOR,
    ...(options.board ? { board: options.board } : {}),
    ...(options.tasks ? { tasks: options.tasks } : {}),
    ...(options.clientRecords ? { clientRecords: options.clientRecords } : {}),
    // F40, Fase 9 — sem injeção e sem banco, a leitura fica de fora (a ferramenta responde `unavailable`).
    ...(options.adminWeek
      ? { adminWeek: options.adminWeek }
      : canConnect(env)
        ? { adminWeek: createSqlAdminWeekCatalog(env as ServerEnv, actor) }
        : {}),
  };
}

/**
 * Onde o desfazer escreve. A suíte injeta; o Worker abre a transação com o
 * ator do DONO — nunca o da integração. Sem banco e sem injeção não há
 * desfazer possível, e dizer isso é melhor do que responder "0 removidos".
 */
function undoStoreFor(
  env: IntegrationEnv,
  options: CreateIntegrationOptions,
  owner: AuthenticatedActor,
): UndoStore {
  if (options.undo) return options.undo;
  if (!canConnect(env)) throw new Error('desfazer em lote exige banco ou store injetado');
  return createSqlUndoStore(env as ServerEnv, owner);
}

async function resolveHumanSession(
  request: Request,
  env: IntegrationEnv,
  options: CreateIntegrationOptions,
): Promise<SessionResult> {
  if (options.resolveSession) return options.resolveSession(request, env);
  if (options.syntheticConsent) {
    return {
      ok: true,
      actor: {
        userId: SYNTHETIC_SUBJECT.id,
        email: 'proof@ideworks.test',
        papel: 'funcionario',
        isSuperadmin: false,
        isSuper: false,
        areas: [],
        hasAllClientsAccess: false,
      },
    };
  }
  const provider = sessionProvider(env);
  if (!provider || !canConnect(env)) {
    return { ok: false, status: 401, reason: 'no_token', message: 'Faltou o crachá.' };
  }
  // Conexão emprestada da requisição (F22, Fase 2).
  return borrowSql(env as ServerEnv, 'sessao', (sql) => resolveActor(request, sql, provider));
}

async function grantStoreFor(
  env: IntegrationEnv,
  options: CreateIntegrationOptions,
  fallback: GrantStore,
): Promise<GrantStore> {
  if (options.grants) return options.grants;
  if (canConnect(env)) return createSqlGrantStore(env);
  return fallback;
}

async function rateStoreFor(
  env: IntegrationEnv,
  options: CreateIntegrationOptions,
  fallback: IntegrationRateLimitStore,
): Promise<IntegrationRateLimitStore> {
  if (options.rateLimits) return options.rateLimits;
  if (canConnect(env)) return createSqlRateLimitStore(env);
  return fallback;
}

/**
 * O GET no `/mcp` pede o canal de avisos do servidor — e este servidor não tem.
 *
 * Sem sessão (`sessionIdGenerator: undefined`) e com resposta em JSON, não há
 * o que avisar por ali. Antes disto o GET passava pelo portão, lia concessão,
 * pessoa e catálogo, e o transporte segurava um fluxo vazio por ~4,4 s; o
 * claude.ai reabria a cada ~3 s, gastando 20 das 60 chamadas por minuto da
 * concessão (medido em 22/09/2026). A especificação do MCP (Streamable HTTP)
 * manda responder 405 nesse caso, e o cliente para de pedir.
 *
 * Só depois de o token ser aceito: sem token, o 401 é o que ensina o cliente
 * a descobrir o OAuth.
 */
function mcpSemCanalDeAvisos(request: Request): Response | null {
  if (request.method !== 'GET') return null;
  return json(
    { error: 'method_not_allowed', message: 'Este servidor MCP não abre canal de avisos; use POST.' },
    405,
    { Allow: 'POST' },
  );
}

async function enforceAgentRateLimit(
  who: { grantId: string; ownerId: string },
  store: IntegrationRateLimitStore,
  rules: Record<IntegrationRateScope, IntegrationRateRule>,
): Promise<Response | null> {
  const verdict = await admitIntegrationRateLimit(who, store, new Date(), rules);
  if (!verdict.allowed) return rateLimitedResponse(verdict.retryAfterSeconds);
  return null;
}

/** O 42703 do Postgres: coluna que a migration ainda não criou neste banco. */
function colunaAusente(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === '42703') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /daily_write_limit/.test(message) && /column|coluna/i.test(message);
}

function connectionPayload(
  grant: IntegrationGrant,
  usedToday = 0,
  /**
   * As omitidas do dono — F31, Fase 3b. A concessão guardada continua a mesma
   * (ela segue VÁLIDA), mas o resumo "{n} empresa(s)" em Conexões conta só o
   * que o agente de fato alcança: a omitida sai da lista, no mesmo formato.
   */
  omitidas: readonly string[] = [],
) {
  return {
    id: grant.id,
    name: grant.name,
    /**
     * O teto VIGENTE e a cota JÁ GASTA hoje (F21.5a). Os dois saem da mesma
     * fonte que o freio usa quando recusa — a linha da concessão e o próprio
     * ledger. A tela não recalcula nada; se recalculasse, mostraria um número
     * e a escrita aplicaria outro.
     */
    dailyWriteLimit: resolveDailyWriteLimit(grant),
    usedToday,
    oauthClientId: grant.oauthClientId,
    capabilities: [...grant.capabilities],
    reach: {
      companies:
        grant.allowedCompanyIds === null || omitidas.length === 0
          ? grant.allowedCompanyIds
          : grant.allowedCompanyIds.filter((id) => !omitidas.includes(id)),
      clients: grant.allowedClientIds,
    },
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    policyVersion: grant.policyVersion,
    live: grantIsLive(grant),
    /**
     * Quando a conexão foi autorizada (F44, Fase 9) — a tela avisa as que são
     * anteriores a 09/10/2026, quando "ler clientes" passou a mostrar plano,
     * renovação, cota e etiquetas. Nulo = a linha não trouxe a data.
     */
    authorizedAt: grant.createdAt?.toISOString() ?? null,
  };
}

function executionPayload(row: IntegrationExecutionSummary) {
  const result = row.result ?? {};
  const actedAs =
    result.actedAs && typeof result.actedAs === 'object'
      ? (result.actedAs as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    grantId: row.grantId,
    grantName: row.grantName,
    operation: row.operation,
    targetId: row.targetId,
    occurredAt: row.occurredAt,
    origin: row.origin,
    active: row.active,
    undoneAt: row.undoneAt,
    result,
    actedAs,
    commentId: typeof result.commentId === 'string' ? result.commentId : null,
  };
}

/**
 * A cota gasta hoje, por concessão do dono. Em memória (suíte) a fonte é o
 * mesmo store de escrita que aplica o freio; em Postgres é o mesmo ledger que
 * `countWritesInWindow` conta. Nunca uma terceira contagem.
 */
async function ownerUsageToday(
  ownerId: string,
  store: GrantStore,
  options: CreateIntegrationOptions,
  day: { start: Date; end: Date },
): Promise<Map<string, number>> {
  const conta = new Map<string, number>();
  if (options.writes instanceof MemoryAgentWriteStore) {
    for (const row of options.writes.executions.values()) {
      if (row.ownerId !== ownerId) continue;
      const quando = row.occurredAt.getTime();
      if (quando < day.start.getTime() || quando >= day.end.getTime()) continue;
      conta.set(row.grantId, (conta.get(row.grantId) ?? 0) + 1);
    }
    return conta;
  }
  for (const linha of await store.countWritesToday(ownerId, day.start, day.end)) {
    conta.set(linha.grantId, linha.used);
  }
  return conta;
}

async function listOwnerExecutions(
  ownerId: string,
  store: GrantStore,
  options: CreateIntegrationOptions,
  limit: number,
): Promise<IntegrationExecutionSummary[]> {
  if (options.writes instanceof MemoryAgentWriteStore) {
    const names = new Map((await store.list(ownerId)).map((grant) => [grant.id, grant.name]));
    return [...options.writes.executions.values()]
      .filter((row) => row.ownerId === ownerId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        grantId: row.grantId,
        grantName: names.get(row.grantId) ?? row.grantId,
        ownerId: row.ownerId,
        operation: row.operation,
        targetId: row.targetId,
        occurredAt: row.occurredAt.toISOString(),
        origin: row.origin,
        active: row.active,
        result: row.result as Record<string, unknown>,
        undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
      }));
  }
  return store.listExecutions(ownerId, limit);
}

function redirectWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function html(body: string, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { status, headers });
}

function wantsJson(request: Request): boolean {
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function authorizationBearer(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const [tipo, valor] = header.split(' ');
  if (tipo?.toLowerCase() === 'bearer' && valor) return valor;
  return null;
}

function originAllowed(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      return new URL(origin).origin === expected;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * O nome da concessão — o que a tela de conexões e o aviso de agente (F21.3)
 * mostram para a pessoa reconhecer qual conexão agiu.
 *
 * ⚠️ É TEXTO DECLARADO POR QUEM SE CONECTA: vem do `client_name` que o próprio
 * cliente OAuth registra, e o dono nunca o digitou. Nada impede um cliente de
 * se anunciar como "Sistema Ide" ou "Suporte oficial", então este nome
 * IDENTIFICA, e não AUTORIZA: nenhuma decisão do servidor pode depender dele,
 * e nenhuma frase de tela pode usá-lo como autoridade. O corte em 80
 * caracteres é o freio de tamanho — um nome de quilobytes estouraria toda
 * lista que o desenha.
 */
function grantName(clientName: string | undefined): string {
  const trimmed = (clientName ?? 'Integração').trim();
  return trimmed.slice(0, 80) || 'Integração';
}

function allowedResource(origin: string, resource: string | string[] | undefined): string | null {
  const mcp = mcpAudience(origin);
  const http = httpAudience(origin);
  const value = Array.isArray(resource) ? resource[0] : resource;
  if (!value) return mcp;
  if (value === mcp || value === http) return value;
  return null;
}

function executionOrigin(resource: string, origin: string): TokenProps['origin'] {
  return resource === httpAudience(origin) ? 'http' : 'mcp';
}

function sessionProvider(env: IntegrationEnv): SessionProvider | null {
  if (!env.IDEWORKS_PUBLIC_SUPABASE_URL || !env.IDEWORKS_PUBLIC_SUPABASE_ANON_KEY) return null;
  return {
    url: env.IDEWORKS_PUBLIC_SUPABASE_URL,
    anonKey: env.IDEWORKS_PUBLIC_SUPABASE_ANON_KEY,
    // F31, Fase 3b — a sessão HUMANA da integração (Conexões e consentimento)
    // carrega as omitidas no ator, como a API humana. Sem caminho, não há
    // endereço a barrar; com a resolução guardada, não há ida ao banco.
    empresasOmitidas: env.IDEWORKS_EMPRESAS_OMITIDAS,
  };
}

/**
 * As omitidas, em ids, para o dono de uma concessão — F31, Fase 3b.
 *
 * A MESMA resolução da API humana (`conferirOmitidas`, guardada um minuto por
 * isolado) e a MESMA garantia de `resolveActor`: se a conferência falhar, o
 * pedido segue SEM omitir, com aviso no log. Omitir é cosmético — o alcance
 * continua sendo das políticas do banco —, e um tropeço aqui derrubaria toda
 * chamada de agente.
 *
 * Fora da transação da pessoa de propósito: uma consulta que falha dentro de
 * uma transação a envenena ("current transaction is aborted"), e a leitura da
 * pessoa, que decide se o agente entra, cairia junto.
 */
async function omitidasDoDono(sql: Sql, env: IntegrationEnv, userId: string): Promise<string[]> {
  const nomes = lerNomesOmitidos(env.IDEWORKS_EMPRESAS_OMITIDAS);
  if (nomes.length === 0) return [];
  try {
    return (await conferirOmitidas(sql, humanActor(userId), nomes, undefined)).ids;
  } catch (erro) {
    console.warn(
      `[ide-works] F31: a conferência de IDEWORKS_EMPRESAS_OMITIDAS falhou para o agente — nada omitido neste pedido: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
    return [];
  }
}

function humanActor(userId: string): Actor {
  return userActor({ userId, isSuperadmin: false, isSuper: false });
}

/** A concessão do dono, como o portão a lê (`GrantStore.get`). */
async function lerConcessao(tx: Tx, id: string, ownerId: string): Promise<IntegrationGrant | null> {
  const rows = await tx`
    select g.id, g.owner_id, g.oauth_client_id, g.name, g.capabilities,
           g.allowed_company_ids, g.allowed_client_ids, g.expires_at,
           g.revoked_at, g.policy_version, g.created_at,
           to_jsonb(g) ->> 'daily_write_limit' as daily_write_limit
      from ideworks.integration_grants g
     where g.id = ${inlineUuid(tx, id)} and g.owner_id = ${inlineUuid(tx, ownerId)}`;
  const row = rows[0];
  if (!row) return null;
  return grantFromRow(row as Record<string, unknown>);
}

/**
 * A pessoa do dono, como o portão a lê (`GrantStore.person`), no `tx` de quem
 * chama — que já declarou o ator.
 *
 * O perfil, as empresas e os vínculos diretos de cliente não dependem uns dos
 * outros e saem na MESMA ida (o id vai no texto; ver `inlineUuid`). Só os
 * clientes pelas empresas esperam o perfil, porque quem é topo ou vê todos os
 * clientes não precisa deles.
 */
async function lerPessoa(tx: Tx, userId: string, omitidas: readonly string[]): Promise<PersonAccess | null> {
  const dono = inlineUuid(tx, userId);
  const [perfil, companies, diretos] = await Promise.all([
    tx`
      select id, is_active, is_superadmin, role::text as role, has_all_clients_access
        from ideworks.profiles where id = ${dono}`,
    // O nome vem junto, na MESMA consulta: a página de consentimento
    // mostra "Ide", e não um UUID (F31, Fase 3b).
    tx`
      select uc.category_id::text as id, cc.name
        from ideworks.user_categories uc
        left join ideworks.client_categories cc on cc.id = uc.category_id
       where uc.user_id = ${dono}`,
    directClientIdsQuery(tx, userId),
  ]);
  const row = perfil[0];
  if (!row) return null;
  const isSuper = row.role === 'super_admin';
  const hasAllClientsAccess = row.has_all_clients_access as boolean;
  // Vínculo direto E cliente das empresas dela — a regra de
  // `can_see_client` (F17.32). É o que o recorte, as escritas e o
  // consentimento leem.
  const clientIds = await reachableClientIdsInTx(
    tx,
    { userId, isSuper, hasAllClientsAccess },
    omitidas,
    diretos,
  );
  const companyNames: Record<string, string> = {};
  for (const c of companies) {
    if (typeof c.name === 'string' && c.name.trim() !== '') companyNames[c.id as string] = c.name;
  }
  return {
    userId: row.id as string,
    isActive: row.is_active as boolean,
    isSuperadmin: row.is_superadmin as boolean,
    isSuper,
    companyIds: companies.map((c) => c.id as string),
    clientIds,
    hasAllClientsAccess,
    companyNames,
    // Só com omitida: sem ela a pessoa é a de antes, campo a campo.
    ...(omitidas.length > 0 ? { omittedCompanyIds: [...omitidas] } : {}),
  } satisfies PersonAccess;
}

/**
 * O porto de concessões sobre o banco. Exportado para a suíte da F31 provar,
 * contra o PGlite, que a pessoa lida aqui leva as omitidas e os nomes das
 * empresas (`omitidas-banco.test.ts`); o Worker o alcança por `grantStoreFor`.
 */
export function createSqlGrantStore(env: IntegrationEnv): GrantStore {
  /** Conexão emprestada da requisição (F22, Fase 2): este porto não abre a sua. */
  async function withSql<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    return borrowSql(env as ServerEnv, 'concessoes', work);
  }

  return {
    async insert(input) {
      return withSql(async (sql) =>
        withActor(sql, asDbActor(input.owner), async (tx) => {
          await tx`
            update ideworks.integration_grants
               set revoked_at = now()
             where owner_id = ${input.owner.userId}
               and oauth_client_id = ${input.oauthClientId}
               and revoked_at is null`;
          const rows = await tx`
            insert into ideworks.integration_grants
              (owner_id, oauth_client_id, name, capabilities, allowed_company_ids, allowed_client_ids)
            values (
              ${input.owner.userId},
              ${input.oauthClientId},
              ${input.name},
              coalesce(${arrayOuNulo(input.capabilities)}::ideworks.integration_capability[], '{}'),
              ${arrayOuNulo(input.allowedCompanyIds)}::uuid[],
              ${arrayOuNulo(input.allowedClientIds)}::uuid[]
            )
            returning id, owner_id, oauth_client_id, name, capabilities,
                      allowed_company_ids, allowed_client_ids, expires_at, revoked_at, policy_version,
                      created_at`;
          return grantFromRow(rows[0] as Record<string, unknown>);
        }),
      );
    },
    async get(id, ownerId) {
      if (!ownerId) return null;
      return withSql(async (sql) =>
        withActor(sql, humanActor(ownerId), (tx) => lerConcessao(tx, id, ownerId)),
      );
    },
    async person(userId) {
      return withSql(async (sql) => {
        // F31, Fase 3b — as omitidas entram na pessoa, e com elas no recorte
        // de TODA operação do agente (`effectiveCompanies`).
        const omitidas = await omitidasDoDono(sql, env, userId);
        return withActor(sql, humanActor(userId), (tx) => lerPessoa(tx, userId, omitidas));
      });
    },
    /**
     * A CONCESSÃO E A PESSOA NUMA TRANSAÇÃO SÓ — perf do servidor, 08/10/2026.
     *
     * O portão de toda chamada de agente lia as duas em transações separadas,
     * com o MESMO ator (o dono). Aqui são as mesmas leituras (`lerConcessao` e
     * `lerPessoa`, as mesmas funções que `get` e `person` usam) no mesmo bloco:
     * um begin e um commit a menos, e como as consultas levam o id no texto as
     * quatro leituras independentes saem na mesma ida. O ator é o de sempre —
     * `humanActor(ownerId)` — e a conferência das omitidas continua FORA da
     * transação (ver `omitidasDoDono`).
     */
    async getWithPerson(id, ownerId) {
      return withSql(async (sql) => {
        const omitidas = await omitidasDoDono(sql, env, ownerId);
        return withActor(sql, humanActor(ownerId), async (tx) => {
          const [grant, person] = await Promise.all([
            lerConcessao(tx, id, ownerId),
            lerPessoa(tx, ownerId, omitidas),
          ]);
          return { grant, person };
        });
      });
    },
    async list(ownerId) {
      return withSql(async (sql) =>
        withActor(sql, humanActor(ownerId), async (tx) => {
          // `to_jsonb(g) ->> 'daily_write_limit'` E NÃO `g.daily_write_limit`,
          // pelo mesmo motivo da listagem do ledger na F21.2: a migration da
          // F21.1 pode não ter chegado neste banco, e a coluna direta
          // derrubaria a TELA DE CONEXÕES INTEIRA com um 42703 cru. Ausente,
          // o teto cai no padrão — que é o teto que a escrita de fato aplica
          // enquanto a coluna não existe.
          const rows = await tx`
            select g.id, g.owner_id, g.oauth_client_id, g.name, g.capabilities,
                   g.allowed_company_ids, g.allowed_client_ids, g.expires_at,
                   g.revoked_at, g.policy_version, g.created_at,
                   to_jsonb(g) ->> 'daily_write_limit' as daily_write_limit
              from ideworks.integration_grants g
             where g.owner_id = ${ownerId}
             order by g.created_at desc`;
          return rows.map((row) => grantFromRow(row as Record<string, unknown>));
        }),
      );
    },
    async listExecutions(ownerId, limit = 50) {
      const teto = Math.min(100, Math.max(1, limit));
      // `to_jsonb(e) ->> 'undone_at'` E NÃO `e.undone_at`, de propósito:
      // esta rota já está no ar e funciona. Se o deploy chegar antes da
      // migration da F21.2, a coluna ainda não existe, e a coluna direto
      // derrubaria a listagem inteira do ledger com um 42703 cru — uma tela
      // viva quebrada por causa de um recurso que ainda não nasceu. Lido do
      // registro inteiro, o campo ausente vira nulo, que é exatamente o que
      // ele significa: nada foi desfeito.
      return withSql(async (sql) =>
        withActor(sql, humanActor(ownerId), async (tx) => {
          const rows = await tx`
            select e.id, e.grant_id, g.name as grant_name, e.owner_id, e.operation,
                   e.target_id, e.occurred_at, e.origin, e.active, e.result,
                   to_jsonb(e) ->> 'undone_at' as undone_at
              from ideworks.integration_executions e
              join ideworks.integration_grants g on g.id = e.grant_id
             where e.owner_id = ${ownerId}
             order by e.occurred_at desc
             limit ${teto}`;
          return rows.map((row) => {
            const result =
              row.result && typeof row.result === 'object'
                ? (row.result as Record<string, unknown>)
                : {};
            return {
              id: String(row.id),
              grantId: String(row.grant_id),
              grantName: String(row.grant_name),
              ownerId: String(row.owner_id),
              operation: String(row.operation),
              targetId: String(row.target_id),
              occurredAt: new Date(row.occurred_at as string | Date).toISOString(),
              origin: String(row.origin),
              active: row.active === true,
              result,
              undoneAt: row.undone_at
                ? new Date(row.undone_at as string | Date).toISOString()
                : null,
            } satisfies IntegrationExecutionSummary;
          });
        }),
      );
    },
    async countWritesToday(ownerId, from, to) {
      return withSql(async (sql) =>
        withActor(sql, humanActor(ownerId), async (tx) => {
          const rows = await tx`
            select grant_id, count(*)::int as used
              from ideworks.integration_executions
             where owner_id = ${ownerId}
               and occurred_at >= ${from}
               and occurred_at < ${to}
             group by grant_id`;
          return rows.map((row) => ({
            grantId: String(row.grant_id),
            used: Number(row.used ?? 0),
          }));
        }),
      );
    },
    async rename(id, ownerId, name) {
      // O nome é coluna que já existe: renomear NÃO precisa de migration, e o
      // texto novo aparece sozinho em todo lugar que já lia `g.name` — a caixa
      // de entrada, o ledger, o selo da conversa. O nome de nascença não se
      // perde: ele continua no cliente OAuth (`oauth_client_id`).
      //
      // O gatilho `bump_grant_policy_version` NÃO conta o nome como mudança de
      // política, e está certo: renomear não muda o que o agente pode fazer, e
      // não deve invalidar o cache da concessão dele.
      return withSql(async (sql) =>
        withActor(sql, humanActor(ownerId), async (tx) => {
          const rows = await tx`
            update ideworks.integration_grants g
               set name = ${name}
             where g.id = ${id} and g.owner_id = ${ownerId}
             returning g.id, g.owner_id, g.oauth_client_id, g.name, g.capabilities,
                       g.allowed_company_ids, g.allowed_client_ids, g.expires_at,
                       g.revoked_at, g.policy_version, g.created_at,
                       to_jsonb(g) ->> 'daily_write_limit' as daily_write_limit`;
          const row = rows[0];
          return row ? grantFromRow(row as Record<string, unknown>) : null;
        }),
      );
    },
    async setDailyWriteLimit(id, ownerId, limit) {
      return withSql(async (sql) =>
        withActor(sql, humanActor(ownerId), async (tx) => {
          const rows = await tx`
            update ideworks.integration_grants g
               set daily_write_limit = ${limit}
             where g.id = ${id} and g.owner_id = ${ownerId}
             returning g.id, g.owner_id, g.oauth_client_id, g.name, g.capabilities,
                       g.allowed_company_ids, g.allowed_client_ids, g.expires_at,
                       g.revoked_at, g.policy_version, g.created_at,
                       to_jsonb(g) ->> 'daily_write_limit' as daily_write_limit`;
          const row = rows[0];
          return row ? grantFromRow(row as Record<string, unknown>) : null;
        }),
      );
    },
    async revoke(id, ownerId) {
      return withSql(async (sql) =>
        withActor(sql, humanActor(ownerId), async (tx) => {
          const rows = await tx`
            update ideworks.integration_grants
               set revoked_at = coalesce(revoked_at, now())
             where id = ${id} and owner_id = ${ownerId}
             returning id, owner_id, oauth_client_id, name, capabilities,
                       allowed_company_ids, allowed_client_ids, expires_at, revoked_at, policy_version,
                      created_at`;
          const row = rows[0];
          if (!row) return null;
          await tx`
            update ideworks.integration_credentials
               set revoked_at = coalesce(revoked_at, now())
             where grant_id = ${id} and revoked_at is null`;
          return grantFromRow(row as Record<string, unknown>);
        }),
      );
    },
    async issueCredential(grantId, ownerId, secretVerifier) {
      return withSql(async (sql) =>
        withActor(sql, humanActor(ownerId), async (tx) => {
          const grants = await tx`
            select id, owner_id, oauth_client_id, name, capabilities,
                   allowed_company_ids, allowed_client_ids, expires_at, revoked_at, policy_version
              from ideworks.integration_grants
             where id = ${grantId} and owner_id = ${ownerId}`;
          const grant = grants[0] ? grantFromRow(grants[0] as Record<string, unknown>) : null;
          if (!grant || !grantIsLive(grant)) return null;
          await tx`
            update ideworks.integration_credentials
               set revoked_at = now()
             where grant_id = ${grantId} and revoked_at is null`;
          const inserted = await tx`
            insert into ideworks.integration_credentials (grant_id, responsible_id, secret_verifier)
            values (${grantId}, ${ownerId}, ${secretVerifier})
            returning id, grant_id, responsible_id, secret_verifier, revoked_at, expires_at`;
          const row = inserted[0];
          return {
            id: row.id as string,
            grantId: row.grant_id as string,
            responsibleId: row.responsible_id as string,
            secretVerifier: row.secret_verifier as string,
            revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
            expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
          } satisfies StoredAutomationCredential;
        }),
      );
    },
    async lookupByVerifier(secretVerifier) {
      return withSql(async (sql) =>
        withActor(sql, { kind: 'preauth' }, async (tx) => {
          const rows = await tx`
            select credential_id, grant_id, owner_id, oauth_client_id, name, capabilities,
                   allowed_company_ids, allowed_client_ids, expires_at, revoked_at, policy_version,
                   credential_expires_at
              from ideworks.lookup_live_automation_credential(${inlineSha256(tx, secretVerifier)})`;
          const row = rows[0];
          if (!row) return null;
          return {
            grant: grantFromRow({
              id: row.grant_id,
              owner_id: row.owner_id,
              oauth_client_id: row.oauth_client_id,
              name: row.name,
              capabilities: row.capabilities,
              allowed_company_ids: row.allowed_company_ids,
              allowed_client_ids: row.allowed_client_ids,
              expires_at: row.expires_at,
              revoked_at: row.revoked_at,
              policy_version: row.policy_version,
            }),
            credential: {
              id: row.credential_id as string,
              grantId: row.grant_id as string,
              responsibleId: row.owner_id as string,
              secretVerifier,
              revokedAt: null,
              expiresAt: row.credential_expires_at ? new Date(row.credential_expires_at as string) : null,
            },
          };
        }),
      );
    },
  };
}

/**
 * O freio de chamadas sobre o banco. Exportado para a suíte provar, contra o
 * Postgres de verdade (PGlite) e contra o fio, que a versão de uma transação só
 * decide e registra como a de várias (`freio-banco.test.ts`, `mcp-idas.test.ts`).
 */
export function createSqlRateLimitStore(env: IntegrationEnv): IntegrationRateLimitStore {
  /** Conexão emprestada da requisição (F22, Fase 2): este porto não abre a sua. */
  async function withSql<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    return borrowSql(env as ServerEnv, 'freio', work);
  }

  /**
   * Os argumentos de uma chamada do freio, no texto da consulta quando têm
   * formato conhecido (escopo da lista fechada, chave UUID, instante) e sem
   * parâmetro nenhum — uma consulta sem parâmetro sai numa ida só e viaja junto
   * da declaração do ator. Fora do formato, parâmetro, como sempre foi.
   */
  const ESCOPOS: readonly string[] = ['grant', 'owner'];
  const escopo = (tx: Tx, scope: IntegrationRateScope) => inlineWord(tx, scope, ESCOPOS);

  return {
    async count(scope, key, since) {
      return withSql(async (sql) =>
        withActor(sql, { kind: 'preauth' }, async (tx) => {
          const rows = await tx`
            select ideworks.integration_rate_count(
                     ${escopo(tx, scope)}, ${inlineUuid(tx, key)}, ${inlineTimestamp(tx, since)}) as n`;
          return Number(rows[0].n);
        }),
      );
    },
    async record(scope, key) {
      await withSql(async (sql) =>
        withActor(sql, { kind: 'preauth' }, async (tx) => {
          await tx`select ideworks.integration_rate_record(${escopo(tx, scope)}, ${inlineUuid(tx, key)})`;
        }),
      );
    },
    /**
     * AS DUAS CONTAGENS NUMA IDA SÓ — F22, Fase 2.
     *
     * Eram duas viagens ao banco (concessão e dono) para uma decisão que o
     * Postgres responde num `select`. A função chamada é a MESMA de `count()`:
     * nenhuma regra nova aqui, só menos idas.
     *
     * POR QUE DUAS COLUNAS, E NÃO `unnest` DE ARRAY
     *   O chamador é um só e pergunta sempre por dois escopos. Duas colunas
     *   nomeadas repetem uma chamada que já roda em produção há tempo, sem
     *   estrear serialização de array nem `with ordinality` no caminho de TODA
     *   requisição — e este código não tem como ser provado contra o banco de
     *   dentro da suíte. Qualquer outro tamanho de lista cai no caminho antigo,
     *   uma pergunta por vez, que continua correto.
     *
     * A ORDEM DA RESPOSTA É CONTRATO: a posição N responde a sonda N. Trocá-la
     * trocaria o teto da concessão pelo do dono.
     */
    async countMany(probes) {
      if (probes.length !== 2) {
        const out: number[] = [];
        for (const probe of probes) out.push(await this.count(probe.scope, probe.key, probe.since));
        return out;
      }
      const [um, dois] = probes;
      return withSql(async (sql) =>
        withActor(sql, { kind: 'preauth' }, async (tx) => {
          const rows = await tx`
            select ideworks.integration_rate_count(
                     ${escopo(tx, um.scope)}, ${inlineUuid(tx, um.key)}, ${inlineTimestamp(tx, um.since)}) as um,
                   ideworks.integration_rate_count(
                     ${escopo(tx, dois.scope)}, ${inlineUuid(tx, dois.key)}, ${inlineTimestamp(tx, dois.since)}) as dois`;
          return [Number(rows[0].um), Number(rows[0].dois)];
        }),
      );
    },
    /** Os dois registros numa ida só, pela mesma função de `record()`. */
    async recordMany(entries) {
      if (entries.length !== 2) {
        for (const entry of entries) await this.record(entry.scope, entry.key);
        return;
      }
      const [um, dois] = entries;
      await withSql(async (sql) =>
        withActor(sql, { kind: 'preauth' }, async (tx) => {
          await tx`
            select ideworks.integration_rate_record(${escopo(tx, um.scope)}, ${inlineUuid(tx, um.key)}) as um,
                   ideworks.integration_rate_record(${escopo(tx, dois.scope)}, ${inlineUuid(tx, dois.key)}) as dois`;
        }),
      );
    },
    /**
     * CONTAR E REGISTRAR NA MESMA TRANSAÇÃO — perf do servidor, 08/10/2026.
     *
     * As mesmas duas consultas de `countMany` e `recordMany`, na mesma ordem e
     * pelas mesmas funções do banco, num bloco só: um begin, uma declaração e
     * um commit a menos em toda chamada de agente. O registro só acontece se
     * TODA contagem couber no teto da sua posição — chamada recusada não entra
     * na janela, como no caminho antigo. Com tamanho diferente de dois, cai no
     * caminho antigo (contar tudo, depois registrar).
     */
    async countThenRecord(probes, entries, maxima) {
      if (probes.length !== 2 || entries.length !== 2) {
        const counts = await this.countMany!(probes);
        const cabe = counts.every((n, i) => n < (maxima[i] ?? 0));
        if (cabe) await this.recordMany!(entries);
        return { counts, recorded: cabe };
      }
      const [um, dois] = probes;
      const [r1, r2] = entries;
      return withSql(async (sql) =>
        withActor(sql, { kind: 'preauth' }, async (tx) => {
          const rows = await tx`
            select ideworks.integration_rate_count(
                     ${escopo(tx, um.scope)}, ${inlineUuid(tx, um.key)}, ${inlineTimestamp(tx, um.since)}) as um,
                   ideworks.integration_rate_count(
                     ${escopo(tx, dois.scope)}, ${inlineUuid(tx, dois.key)}, ${inlineTimestamp(tx, dois.since)}) as dois`;
          const counts = [Number(rows[0].um), Number(rows[0].dois)];
          const cabe = counts.every((n, i) => n < (maxima[i] ?? 0));
          if (cabe) {
            await tx`
              select ideworks.integration_rate_record(${escopo(tx, r1.scope)}, ${inlineUuid(tx, r1.key)}) as um,
                     ideworks.integration_rate_record(${escopo(tx, r2.scope)}, ${inlineUuid(tx, r2.key)}) as dois`;
          }
          return { counts, recorded: cabe };
        }),
      );
    },
    async oldest(scope, key, since) {
      return withSql(async (sql) =>
        withActor(sql, { kind: 'preauth' }, async (tx) => {
          const rows = await tx`
            select ideworks.integration_rate_oldest(
                     ${escopo(tx, scope)}, ${inlineUuid(tx, key)}, ${inlineTimestamp(tx, since)}) as t`;
          const value = rows[0]?.t;
          return value ? new Date(value as string) : null;
        }),
      );
    },
  };
}

function oauthErrorResponse(error: AuthorizationError): Response {
  if (!error.redirectUri) {
    return new Response(error.description, { status: 400 });
  }
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set('error', error.code);
  redirect.searchParams.set('error_description', error.description);
  if (error.state) redirect.searchParams.set('state', error.state);
  if (error.issuer) redirect.searchParams.set('iss', error.issuer);
  return Response.redirect(redirect.toString(), 302);
}

/**
 * A recusa do servidor em português: diz qual escrita ficou sem a leitura
 * que ela exige, pelo nome que a pessoa leu na tela.
 */
function capabilitiesRefusalText(capabilities: readonly IntegrationCapability[]): string {
  const marcadas = new Set<string>(capabilities);
  const frases: string[] = [];
  for (const write of WRITE_CAPABILITIES) {
    if (!marcadas.has(write)) continue;
    const faltando = WRITE_REQUIRES_READ[write].filter((dep) => !marcadas.has(dep));
    if (faltando.length === 0) continue;
    frases.push(
      `Para "${CAPABILITY_LABELS[write]}" também é preciso marcar ` +
        `${faltando.map((dep) => `"${CAPABILITY_LABELS[dep]}"`).join(' e ')}. ` +
        WRITE_DEPENDENCY_REASONS[write],
    );
  }
  if (frases.length === 0) return 'Escolha de capacidades inválida. Volte e revise o que foi marcado.';
  return frases.join(' ');
}

/**
 * CSS das páginas HTML do fluxo OAuth (consentimento, recusa, conta inativa).
 *
 * Autônomo de propósito: o Worker serve esta página sem o bundle do site, então
 * nada de fonte, imagem ou folha externa — tudo inline. Os tokens têm os nomes
 * e os valores do OBSIDIAN (`src/ui/obsidian.css`) e são DEFINIDOS aqui mesmo:
 * `var(--nao-existe)` apaga o estilo em silêncio, então cada `var()` abaixo tem
 * um `--x:` correspondente em `:root`. Escuro é o padrão da marca; o claro vem
 * de `prefers-color-scheme`. O `body` tem fundo explícito nos dois.
 */
const OAUTH_PAGE_CSS = `
  :root {
    color-scheme: dark light;
    --ink-0: #17181a; --ink-1: #202123; --ink-2: #27282b; --ink-4: #3b3c42;
    --hair: rgba(244, 241, 234, 0.14); --hair-2: rgba(244, 241, 234, 0.22);
    --txt: #f4f1ea; --mute: #bfc0c6;
    --luz: #00ff66; --luz-soft: rgba(0, 255, 102, 0.16); --luz-texto: #00ff66;
    --tinta-solido: #04130a;
    --warn: #ffb020; --warn-soft: rgba(255, 176, 32, 0.14); --warn-texto: #ffb020;
    --err: #ff6b6b; --err-soft: rgba(255, 107, 107, 0.14);
    --sombra: 0 24px 60px -20px rgba(0, 0, 0, 0.7);
    --f-body: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif;
    --f-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --ink-0: #ffffff; --ink-1: #f7f7f8; --ink-2: #f0f0f2; --ink-4: #d4d4d8;
      --hair: rgba(16, 16, 20, 0.14); --hair-2: rgba(16, 16, 20, 0.22);
      --txt: #16161a; --mute: #4a4a54;
      --luz: #00a344; --luz-soft: rgba(0, 163, 68, 0.14); --luz-texto: #007537;
      --tinta-solido: #ffffff;
      --warn: #8f5b00; --warn-soft: rgba(143, 91, 0, 0.12); --warn-texto: #8f5b00;
      --err: #b42318; --err-soft: rgba(180, 35, 24, 0.1);
      --sombra: 0 24px 60px -24px rgba(16, 16, 20, 0.28);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { background: var(--ink-0); }
  body {
    margin: 0; min-height: 100vh; background: var(--ink-0); color: var(--txt);
    font-family: var(--f-body); font-size: 16px; line-height: 1.5;
    -webkit-text-size-adjust: 100%; overflow-wrap: anywhere;
  }
  main { max-width: 40rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
  .marca { display: flex; align-items: center; gap: .55rem; margin: .5rem 0 1.25rem; font-size: 1.35rem; letter-spacing: -.01em; }
  .marca .ponto { width: .6rem; height: .6rem; border-radius: 50%; background: var(--luz); box-shadow: 0 0 12px var(--luz-soft); }
  .marca b { font-weight: 800; }
  .marca span.w { font-weight: 400; color: var(--mute); }
  .cartao {
    background: var(--ink-1); border: 1px solid var(--hair); border-radius: 14px;
    padding: 1.1rem 1rem; margin: 0 0 1rem; box-shadow: var(--sombra); min-width: 0;
  }
  .cartao.topo { padding: 1.25rem 1rem; }
  h1 { margin: 0 0 .4rem; font-size: 1.5rem; line-height: 1.25; letter-spacing: -.01em; }
  p { margin: 0 0 .6rem; }
  .nota { color: var(--mute); font-size: .95rem; }
  code { font-family: var(--f-mono); font-size: .82em; color: var(--mute); background: var(--ink-2); border: 1px solid var(--hair); border-radius: 6px; padding: .05rem .35rem; }
  fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
  legend { padding: 0; margin: 0 0 .15rem; font-size: 1.05rem; font-weight: 700; }
  .dica { color: var(--mute); font-size: .9rem; margin: 0 0 .75rem; }
  .acoes { display: flex; flex-wrap: wrap; gap: .5rem; margin: .5rem 0 .75rem; }
  button { font: inherit; cursor: pointer; }
  .sec {
    min-height: 44px; padding: .5rem .9rem; border-radius: 10px; font-weight: 600; font-size: .95rem;
    background: var(--ink-2); color: var(--txt); border: 1px solid var(--hair-2);
  }
  .sec:hover { border-color: var(--luz); }
  .cap, .opcao {
    display: block; margin: .35rem 0; border: 1px solid var(--hair); border-radius: 10px;
    background: var(--ink-0); min-width: 0;
  }
  .cap.escrita { border-left: 3px solid var(--warn); }
  .cap label, .opcao {
    display: flex; align-items: flex-start; gap: .7rem; min-height: 44px; padding: .65rem .75rem; cursor: pointer;
  }
  .cap label { margin: 0; }
  .opcao { margin: .35rem 0; }
  input[type='checkbox'], input[type='radio'] {
    flex: none; width: 1.35rem; height: 1.35rem; margin: .1rem 0 0; accent-color: var(--luz); cursor: pointer;
  }
  .texto { display: flex; flex-direction: column; gap: .15rem; min-width: 0; flex: 1; }
  .rotulo { font-weight: 600; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .5rem; }
  .selo {
    font-size: .72rem; font-weight: 700; letter-spacing: .03em; text-transform: uppercase;
    padding: .08rem .45rem; border-radius: 999px; border: 1px solid var(--hair-2); color: var(--mute);
  }
  .selo.altera { color: var(--warn-texto); background: var(--warn-soft); border-color: transparent; }
  .exige { display: block; margin: -.2rem .75rem .65rem 2.8rem; font-size: .85rem; color: var(--mute); }
  #aviso-dependencia:empty { display: none; }
  #aviso-dependencia {
    margin: .6rem 0 0; padding: .6rem .8rem; border-radius: 10px; font-size: .92rem;
    background: var(--luz-soft); border-left: 3px solid var(--luz);
  }
  .primario {
    display: block; width: 100%; min-height: 48px; padding: .75rem 1.25rem; border-radius: 999px; font-size: 1.05rem; font-weight: 700;
    background: linear-gradient(180deg, var(--luz), color-mix(in srgb, var(--luz) 90%, #000));
    color: var(--tinta-solido); border: 1px solid var(--luz); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35);
  }
  .primario:hover { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35), 0 0 18px var(--luz-soft); }
  .vazio { color: var(--mute); font-size: .92rem; margin: .5rem 0 0; }
  .destino {
    padding: .6rem .8rem; border-radius: 10px; font-size: .98rem;
    background: var(--warn-soft); border-left: 3px solid var(--warn);
  }
  .destino strong { font-family: var(--f-mono); font-size: 1.02em; }
  .erro { border-color: var(--err); }
  .erro h1 { color: var(--err); }
  :focus-visible { outline: 3px solid var(--luz); outline-offset: 2px; }
  .cap label:has(:focus-visible), .opcao:has(:focus-visible) { outline: 3px solid var(--luz); outline-offset: 1px; }
  input:focus-visible { outline: none; }
  @media (min-width: 640px) {
    main { padding-top: 3rem; }
    .cartao { padding: 1.4rem 1.4rem; }
    .primario { width: auto; min-width: 12rem; margin-left: auto; }
  }
`;

/** Moldura única das páginas do fluxo OAuth: marca no topo, cartões embaixo. */
function oauthPage(input: { title: string; body: string; scripts?: string }): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(input.title)} — IDE Works</title>
<style>${OAUTH_PAGE_CSS}</style>
</head>
<body>
<main>
  <div class="marca" role="img" aria-label="Ide Works"><span class="ponto" aria-hidden="true"></span><span><b>Ide</b> <span class="w">Works</span></span></div>
${input.body}
</main>
${input.scripts ?? ''}
</body>
</html>`;
}

function mensagemPaginaHtml(titulo: string, mensagem: string, rodape?: string): string {
  return oauthPage({
    title: titulo,
    body: `  <section class="cartao topo erro">
    <h1>${escapeHtml(titulo)}</h1>
    <p>${escapeHtml(mensagem)}</p>
    ${rodape ? `<p class="nota">${escapeHtml(rodape)}</p>` : ''}
  </section>`,
  });
}

export function capabilitiesRefusalHtml(mensagem: string): string {
  return mensagemPaginaHtml(
    'Autorização não concluída',
    mensagem,
    'Nada foi concedido. Volte à tela anterior e marque as leituras que faltaram.',
  );
}

/**
 * O host do endereço de retorno — para onde o código de autorização vai.
 * Auditoria de 08/10/2026: o registro de cliente é aberto, e o NOME na tela é
 * o que o próprio cliente escolheu ("Claude" serve a qualquer um). O endereço
 * é o que diz quem recebe o acesso. `URL` devolve o host já em minúsculas e,
 * para domínio com acento, em `xn--` — o que ajuda a ver um nome disfarçado.
 */
function redirectHostOf(redirectUri: string | undefined): string | null {
  if (!redirectUri) return null;
  try {
    return new URL(redirectUri).host || null;
  } catch {
    return null;
  }
}

/** Retorno para a própria máquina: o fluxo dos agentes de terminal. */
function loopbackHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '');
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

export function consentPayload(input: {
  clientId: string;
  clientName: string;
  csrf: string;
  person: PersonAccess;
  capabilities?: readonly IntegrationCapability[];
  /** O `redirect_uri` do pedido. Ausente = a tela não diz para onde o acesso vai. */
  redirectUri?: string;
}) {
  return {
    client: { id: input.clientId, name: input.clientName },
    /** Para onde o código de autorização vai (só o host). */
    redirectHost: redirectHostOf(input.redirectUri),
    notice: 'Aceitar o nome do cliente OAuth não concede capacidades. Escolha o que o agente pode fazer.',
    capabilities: [...INTEGRATION_CAPABILITIES],
    /** Frase em português por capacidade — o nome técnico fica em segundo plano. */
    labels: { ...CAPABILITY_LABELS },
    /**
     * O mapa de dependências da TELA é o próprio `WRITE_REQUIRES_READ` do
     * servidor, copiado aqui. Não existe segunda lista para esquecer de
     * atualizar: acrescentar uma escrita muda a tela no mesmo instante.
     */
    requires: Object.fromEntries(
      WRITE_CAPABILITIES.map((write) => [write, [...WRITE_REQUIRES_READ[write]]]),
    ) as Record<(typeof WRITE_CAPABILITIES)[number], IntegrationCapability[]>,
    reasons: { ...WRITE_DEPENDENCY_REASONS },
    reach: {
      // F31, Fase 3b — a empresa omitida não é oferecida: consentir nela
      // seria dar ao agente uma porta que não leva a nada. O FORMATO fica o
      // mesmo (lista de ids); `companyNames` vem ao lado, para a página
      // mostrar o nome em vez do UUID.
      companies: input.person.companyIds.filter((id) => !companyOmitted(input.person, id)),
      clients: [...input.person.clientIds],
    },
    companyNames: Object.fromEntries(
      input.person.companyIds
        .filter((id) => !companyOmitted(input.person, id))
        .map((id) => [id, input.person.companyNames?.[id] ?? id]),
    ) as Record<string, string>,
    csrf: input.csrf,
  };
}

/** JSON seguro para ir dentro de `<script>`: fecha-tag não escapa do bloco. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function capabilityCheckbox(
  cap: IntegrationCapability,
  requires: readonly IntegrationCapability[] | undefined,
  reason: string | undefined,
): string {
  const rotulo = CAPABILITY_LABELS[cap];
  // `WRITE_CAPABILITIES` é a fonte de verdade de quem altera dados: a tela
  // distingue escrita de leitura por ela, não por um sufixo no nome.
  const escrita = (WRITE_CAPABILITIES as readonly string[]).includes(cap);
  const exigencias =
    requires && requires.length > 0
      ? `<span class="exige">Vem junto com: ${requires
          .map((dep) => escapeHtml(CAPABILITY_LABELS[dep]))
          .join(' · ')}. ${escapeHtml(reason ?? '')}</span>`
      : '';
  return `<div class="cap${escrita ? ' escrita' : ''}">
      <label>
        <input type="checkbox" name="capability" value="${escapeHtml(cap)}"
               data-capability="${escapeHtml(cap)}">
        <span class="texto">
          <span class="rotulo">${escapeHtml(rotulo)}</span>
          <span class="meta">
            <span class="selo${escrita ? ' altera' : ''}">${escrita ? 'Altera dados' : 'Só leitura'}</span>
            <code class="tecnico">${escapeHtml(cap)}</code>
          </span>
        </span>
      </label>
      ${exigencias}
    </div>`;
}

export function consentHtml(payload: ReturnType<typeof consentPayload>): string {
  const requires = payload.requires as Record<string, IntegrationCapability[] | undefined>;
  const reasons = payload.reasons as Record<string, string | undefined>;
  const caps = payload.capabilities
    .map((cap) => capabilityCheckbox(cap, requires[cap], reasons[cap]))
    .join('\n');
  // O NOME da empresa, e não o UUID — F31, Fase 3b. Quem autoriza é gente da
  // agência: "Ide" ela reconhece; `3f2a…` não. O valor enviado continua o id.
  const companies = payload.reach.companies
    .map(
      (id) =>
        `<label class="opcao"><input type="checkbox" name="company" value="${escapeHtml(id)}"> ${escapeHtml(
          payload.companyNames[id] ?? id,
        )}</label>`,
    )
    .join('\n');
  const clients = payload.reach.clients
    .map(
      (id) =>
        `<label class="opcao"><input type="checkbox" name="client" value="${escapeHtml(id)}"> ${escapeHtml(id)}</label>`,
    )
    .join('\n');
  // Para onde o acesso vai, logo abaixo do nome: o nome o cliente escolhe; o
  // endereço é quem recebe. Sem lista de endereços conhecidos no sistema, a
  // tela mostra o host e pede para a pessoa só seguir se o reconhecer.
  const destino = payload.redirectHost
    ? `<p class="destino">Depois de autorizar, o acesso vai para: <strong>${escapeHtml(payload.redirectHost)}</strong>${
        loopbackHost(payload.redirectHost)
          ? ' — um programa neste computador (como um agente no terminal)'
          : ''
      }</p>
    <p class="nota">Só autorize se você reconhece este endereço. O nome acima é o que o próprio cliente informou; o endereço é para onde a autorização é entregue.</p>`
    : '';
  const body = `  <section class="cartao topo">
    <h1>Autorizar ${escapeHtml(payload.client.name)}</h1>
    ${destino}
    <p>${escapeHtml(payload.notice)}</p>
    <p class="nota">Cliente OAuth: <code>${escapeHtml(payload.client.id)}</code></p>
  </section>
  <form method="post" action="${OAUTH_CONSENT_PATH}">
    <input type="hidden" name="csrf" value="${escapeHtml(payload.csrf)}">
    <section class="cartao">
    <fieldset>
      <legend>O que o agente vai poder fazer</legend>
      <p class="dica">Nada vem marcado. As permissões que alteram dados trazem o selo "Altera dados".</p>
      <!-- Sem JavaScript os dois botões ficam ocultos (atributo hidden): botão morto
           é pior que botão ausente, e a pessoa ainda marca à mão. -->
      <div class="acoes" id="acoes-capacidades" hidden>
        <button type="button" class="sec" id="marcar-todas" aria-label="Marcar todas as permissões do agente">Marcar todas</button>
        <button type="button" class="sec" id="limpar-capacidades" aria-label="Limpar a escolha de permissões do agente">Limpar</button>
      </div>
      ${caps}
      <p id="aviso-dependencia" role="status" aria-live="polite"></p>
    </fieldset>
    </section>
    <section class="cartao">
    <fieldset>
      <legend>Empresas</legend>
      <label class="opcao"><input type="radio" name="company_scope" value="all" checked> <span class="texto">Todas que eu alcanço agora</span></label>
      <label class="opcao"><input type="radio" name="company_scope" value="ids"> <span class="texto">Só as marcadas</span></label>
      ${companies || '<p class="vazio">Nenhuma empresa listada nesta sessão.</p>'}
    </fieldset>
    </section>
    <section class="cartao">
    <fieldset>
      <legend>Clientes</legend>
      <label class="opcao"><input type="radio" name="client_scope" value="all" checked> <span class="texto">Todos que eu alcanço agora</span></label>
      <label class="opcao"><input type="radio" name="client_scope" value="ids"> <span class="texto">Só os marcados</span></label>
      ${clients || '<p class="vazio">Nenhum cliente listado nesta sessão.</p>'}
    </fieldset>
    </section>
    <button type="submit" class="primario">Autorizar</button>
  </form>`;
  const scripts = `  <script id="dados-dependencia" type="application/json">${jsonForScript({
    requires: payload.requires,
    labels: payload.labels,
    reasons: payload.reasons,
  })}</script>
  <script>
  (function () {
    // Sem JavaScript a tela continua utilizável: cada escrita já traz escrito
    // ao lado o que ela exige, e o servidor continua recusando o inválido.
    // Com JavaScript, evitamos que a pessoa chegue até o fim numa escolha
    // que já nascia recusada.
    var dados = document.getElementById('dados-dependencia');
    if (!dados) return;
    var mapa;
    try { mapa = JSON.parse(dados.textContent || '{}'); } catch (e) { return; }
    var exige = mapa.requires || {};
    var rotulos = mapa.labels || {};
    var motivos = mapa.reasons || {};
    var aviso = document.getElementById('aviso-dependencia');
    function caixa(nome) {
      return document.querySelector('input[data-capability="' + nome.replace(/"/g, '') + '"]');
    }
    function dizer(texto) { if (aviso) aviso.textContent = texto; }
    function todas() { return document.querySelectorAll('input[data-capability]'); }
    // "Marcar todas" e "Limpar" só mexem nas CAPACIDADES: empresas e clientes
    // ("Só as marcadas") ficam como a pessoa deixou. Marcar todas respeita a
    // dependência por construção — todas marcadas inclui as leituras exigidas.
    var acoes = document.getElementById('acoes-capacidades');
    var botaoTodas = document.getElementById('marcar-todas');
    var botaoLimpar = document.getElementById('limpar-capacidades');
    if (acoes) acoes.hidden = false;
    if (botaoTodas) botaoTodas.addEventListener('click', function () {
      var lista = todas();
      for (var i = 0; i < lista.length; i++) lista[i].checked = true;
      dizer(lista.length + ' de ' + lista.length + ' permissões marcadas.');
    });
    if (botaoLimpar) botaoLimpar.addEventListener('click', function () {
      var lista = todas();
      for (var i = 0; i < lista.length; i++) lista[i].checked = false;
      dizer('');
    });
    document.addEventListener('change', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.dataset || !alvo.dataset.capability) return;
      var nome = alvo.dataset.capability;
      if (alvo.checked && exige[nome]) {
        // Marcar uma escrita marca sozinha as leituras que ela exige.
        var vieram = [];
        exige[nome].forEach(function (dep) {
          var c = caixa(dep);
          if (c && !c.checked) { c.checked = true; vieram.push(rotulos[dep] || dep); }
        });
        if (vieram.length > 0) {
          dizer('Marquei também: ' + vieram.join(' e ') + '. ' + (motivos[nome] || ''));
        } else {
          dizer('');
        }
        return;
      }
      if (!alvo.checked) {
        // Desmarcar uma leitura exigida NÃO pode deixar a escolha inválida.
        // Desmarcamos a escrita junto em vez de impedir o clique: impedir
        // deixaria a pessoa presa sem entender o porquê; desmarcar respeita
        // o que ela pediu (tirar a leitura) e diz o que isso custou.
        var soltas = [];
        Object.keys(exige).forEach(function (escrita) {
          if (exige[escrita].indexOf(nome) === -1) return;
          var c = caixa(escrita);
          if (c && c.checked) { c.checked = false; soltas.push(rotulos[escrita] || escrita); }
        });
        if (soltas.length > 0) {
          dizer('Desmarquei também: ' + soltas.join(' e ') + ' — sem essa leitura o agente escreveria às cegas.');
        } else {
          dizer('');
        }
      }
    });
  })();
  </script>`;
  return oauthPage({ title: 'Autorizar integração', body, scripts });
}

type PendingAuth = {
  request: AuthRequest;
  resource: string;
};

function parseCapabilities(values: string[]): IntegrationCapability[] {
  const selected: IntegrationCapability[] = [];
  for (const value of values) {
    if (isIntegrationCapability(value) && !selected.includes(value)) selected.push(value);
  }
  return selected;
}

export async function createIntegrationHandler(
  options: CreateIntegrationOptions = {},
): Promise<IntegrationServer> {
  const kv = options.kv ?? new MemoryKv();
  const grants = options.grants ?? new MemoryGrantStore();
  const rateLimits = options.rateLimits ?? new MemoryRateLimitStore();
  const rateRules = options.rateRules ?? INTEGRATION_RATE_LIMITS;
  const deadlineMs = options.deadlineMs ?? INTEGRATION_DEADLINE_MS;
  const maxBodyBytes = options.maxBodyBytes ?? INTEGRATION_MAX_BODY_BYTES;
  const ttl = {
    access: options.accessTokenTTL ?? 3600,
    refresh: options.refreshTokenTTL ?? 86_400,
  };
  const providers = new Map<string, OAuthProvider>();
  const synthetic = options.syntheticConsent === true;

  const helpers = getOAuthApi(oauthOptions('https://ideworks.test', ttl, kv, grants, options, rateLimits), {
    OAUTH_KV: kv,
  } as never);
  const created =
    options.registerTestClient === false
      ? { clientId: '' }
      : await helpers.createClient({
          clientName: synthetic ? 'Cliente de prova F16.0' : 'Cliente de integração',
          tokenEndpointAuthMethod: 'none',
          redirectUris: [PROOF_REDIRECT_URI],
          grantTypes: ['authorization_code', 'refresh_token'],
          responseTypes: ['code'],
        });

  if (synthetic && grants instanceof MemoryGrantStore) {
    grants.seedPerson({
      userId: SYNTHETIC_SUBJECT.id,
      isActive: true,
      isSuperadmin: false,
      isSuper: false,
      companyIds: [],
      clientIds: [],
      hasAllClientsAccess: false,
    });
  }

  function providerFor(origin: string): OAuthProvider {
    const cached = providers.get(origin);
    if (cached) return cached;
    const createdProvider = new OAuthProvider(oauthOptions(origin, ttl, kv, grants, options, rateLimits));
    providers.set(origin, createdProvider);
    return createdProvider;
  }

  async function refuseIfIntegrationBearer(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith('/api') || pathname.startsWith(HTTP_INTEGRATIONS_PATH)) return null;
    const token = authorizationBearer(request);
    if (!token) return null;
    if (isAutomationSecret(token)) {
      return json(
        { error: 'invalid_token', error_description: 'Token de integração não autentica a API humana.' },
        401,
      );
    }
    const unwrapped = await helpers.unwrapToken(token);
    if (!unwrapped) return null;
    return json(
      { error: 'invalid_token', error_description: 'Token de integração não autentica a API humana.' },
      401,
    );
  }

  async function handleManagement(request: Request, env: IntegrationEnv): Promise<Response> {
    if (authorizationBearer(request)) {
      return json(
        { error: 'invalid_token', message: 'Gestão de conexões usa a sessão de trabalho, não o token do agente.' },
        401,
      );
    }
    const session = await resolveHumanSession(request, env, options);
    if (!session.ok) {
      if (session.reason === 'account_disabled') {
        return json({ error: 'account_disabled', message: session.message }, 403);
      }
      return json({ error: 'unauthenticated', message: session.message }, 401);
    }

    const url = new URL(request.url);
    const rest = url.pathname.slice(CONNECTIONS_PATH.length);
    let store: GrantStore;
    try {
      store = await grantStoreFor(env, options, grants);
    } catch (error) {
      throw new IntegrationUnavailableError('grant_store_unavailable', error);
    }

    if (rest === '' && request.method === 'GET') {
      const list = await store.list(session.actor.userId);
      const dia = agencyDayWindow(new Date());
      const cota = await ownerUsageToday(session.actor.userId, store, options, dia);
      return json({
        connections: list.map((grant) =>
          connectionPayload(grant, cota.get(grant.id) ?? 0, session.actor.categoriasOmitidas),
        ),
        dayResetsAt: dia.end.toISOString(),
      });
    }

    if ((rest === '/executions' || rest === '/executions/') && request.method === 'GET') {
      const raw = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(raw) ? Math.min(100, Math.max(1, Math.trunc(raw))) : 50;
      const list = await listOwnerExecutions(session.actor.userId, store, options, limit);
      return json({ executions: list.map(executionPayload) });
    }

    const match = rest.match(/^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(credentials|revoke|undo))?$/i);
    if (!match) return json({ error: 'not_found', message: 'Rota de conexão desconhecida.' }, 404);
    const grantId = match[1];
    const action = match[2];

    if (request.method === 'POST' || request.method === 'DELETE' || request.method === 'PATCH') {
      if (!originAllowed(request)) {
        return json({ error: 'csrf', message: 'Origem da solicitação recusada.' }, 403);
      }
    }

    if (action === 'credentials' && request.method === 'POST') {
      const secret = `${AUTOMATION_SECRET_PREFIX}${randomToken()}`;
      const verifier = await hashAutomationSecret(secret);
      const issued = await store.issueCredential(grantId, session.actor.userId, verifier);
      if (!issued) return json({ error: 'not_found', message: 'Conexão inexistente ou revogada.' }, 404);
      return json({ secret, credentialId: issued.id, grantId: issued.grantId }, 201);
    }

    // GOVERNO DA CONEXÃO (F21.5a): renomear e mudar o teto diário.
    //
    // ⚠️ ISTO É DE GENTE, E SÓ DO DONO. Duas paredes, e nenhuma delas é um
    // `if` escrito aqui: (1) o topo desta função recusa qualquer
    // `Authorization: Bearer`, então um agente nunca chega até aqui; (2) a
    // política `integration_grants_update` do banco exige
    // `acting_grant_id() is null` e `owner_id = acting_user_id()`, então nem
    // um caminho novo de código conseguiria um agente aumentando o próprio
    // teto ou se renomeando.
    if (!action && request.method === 'PATCH') {
      let body: Record<string, unknown> = {};
      try {
        const raw: unknown = await request.json();
        if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
          body = raw as Record<string, unknown>;
        }
      } catch {
        body = {};
      }

      const temNome = Object.prototype.hasOwnProperty.call(body, 'name');
      const temTeto = Object.prototype.hasOwnProperty.call(body, 'dailyWriteLimit');
      if (!temNome && !temTeto) {
        return json(
          { error: 'invalid_input', message: 'Diga o que mudar: o nome ou o teto diário.' },
          400,
        );
      }

      let nome: string | null = null;
      if (temNome) {
        const cru = typeof body.name === 'string' ? body.name.trim() : '';
        if (cru.length === 0 || cru.length > 80) {
          return json(
            { error: 'invalid_input', message: 'O nome da conexão tem de ter de 1 a 80 caracteres.' },
            400,
          );
        }
        nome = cru;
      }

      let teto: number | null = null;
      if (temTeto) {
        const cru = typeof body.dailyWriteLimit === 'number' ? body.dailyWriteLimit : Number.NaN;
        if (!Number.isFinite(cru) || !Number.isInteger(cru) || cru < 0 || cru > MAX_DAILY_WRITE_LIMIT) {
          return json(
            {
              error: 'invalid_input',
              message: `O teto diário é um número inteiro de 0 a ${MAX_DAILY_WRITE_LIMIT}. Zero suspende as escritas sem revogar a conexão.`,
            },
            400,
          );
        }
        teto = cru;
      }

      let grant = await store.get(grantId, session.actor.userId);
      if (!grant) return json({ error: 'not_found', message: 'Conexão inexistente.' }, 404);

      if (nome !== null) {
        const renomeada = await store.rename(grantId, session.actor.userId, nome);
        if (!renomeada) return json({ error: 'not_found', message: 'Conexão inexistente.' }, 404);
        grant = renomeada;
      }

      if (teto !== null) {
        try {
          const mudada = await store.setDailyWriteLimit(grantId, session.actor.userId, teto);
          if (!mudada) return json({ error: 'not_found', message: 'Conexão inexistente.' }, 404);
          grant = mudada;
        } catch (error) {
          // A coluna do teto nasce na migration da F21.1, que pode ainda não
          // ter chegado a este banco. Dizer isso em português é melhor que um
          // 42703 cru — e o resto da tela continua de pé.
          if (colunaAusente(error)) {
            return json(
              {
                error: 'daily_limit_unavailable',
                message:
                  'O teto por conexão ainda não existe neste banco: falta aplicar a migration do teto diário. Enquanto isso vale o padrão de 50 escritas por dia.',
              },
              409,
            );
          }
          throw error;
        }
      }

      const dia = agencyDayWindow(new Date());
      const cota = await ownerUsageToday(session.actor.userId, store, options, dia);
      return json({
        ok: true,
        connection: connectionPayload(grant, cota.get(grant.id) ?? 0, session.actor.categoriasOmitidas),
        dayResetsAt: dia.end.toISOString(),
      });
    }

    // DESFAZER EM LOTE (F21.2). Sessão humana — a recusa do token de agente
    // já aconteceu no topo desta função, e é ela que garante o princípio: um
    // agente não desfaz as próprias escritas nem as de outro.
    if (action === 'undo' && request.method === 'POST') {
      // A concessão tem de ser DESTA pessoa. Revogada serve: o ledger
      // sobrevive à revogação, e revogar antes de desfazer é o caminho
      // recomendado quando o agente ainda está escrevendo.
      const grant = await store.get(grantId, session.actor.userId);
      if (!grant) return json({ error: 'not_found', message: 'Conexão inexistente.' }, 404);

      let body: Record<string, unknown> = {};
      try {
        const raw: unknown = await request.json();
        if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
          body = raw as Record<string, unknown>;
        }
      } catch {
        // Corpo ausente ou ilegível é o caso comum "desfaz tudo": o recorte
        // é opcional, e exigir `{}` seria fricção sem ganho.
        body = {};
      }

      let undoStore: UndoStore;
      try {
        undoStore = undoStoreFor(env, options, session.actor);
      } catch (error) {
        throw new IntegrationUnavailableError('undo_store_unavailable', error);
      }

      try {
        const outcome = await undoGrantWrites({
          store: undoStore,
          grantId,
          ownerId: session.actor.userId,
          window: parseUndoWindow({ since: body.since, until: body.until }),
        });
        return json({ ok: true, ...outcome });
      } catch (error) {
        if (error instanceof UndoRefused) {
          return json({ error: error.code, message: error.message }, 400);
        }
        throw error;
      }
    }

    if ((action === 'revoke' && (request.method === 'POST' || request.method === 'DELETE')) || (!action && request.method === 'DELETE')) {
      const revoked = await store.revoke(grantId, session.actor.userId);
      if (!revoked) return json({ error: 'not_found', message: 'Conexão inexistente.' }, 404);
      return json({
        ok: true,
        id: revoked.id,
        revokedAt: revoked.revokedAt?.toISOString() ?? null,
      });
    }

    return json({ error: 'method_not_allowed', message: 'Método não permitido.' }, 405);
  }

  async function handleAutomation(request: Request, env: IntegrationEnv, secret: string): Promise<Response> {
    const url = new URL(request.url);
    const isMcp = url.pathname === '/mcp' || url.pathname.startsWith('/mcp/');
    const isHttp = isHttpIntegrationApiPath(url.pathname);
    if (!isMcp && !isHttp) {
      return json({ error: 'invalid_token', message: 'Credencial de automação não autentica esta rota.' }, 401);
    }

    if (isMcp) {
      const semCanal = mcpSemCanalDeAvisos(request);
      if (semCanal) return semCanal;
    }

    try {
      const store = await grantStoreFor(env, options, grants);
      const verifier = await hashAutomationSecret(secret);
      const lookup = await store.lookupByVerifier(verifier);
      const person = lookup ? await store.person(lookup.grant.ownerId) : null;
      const actor = await resolveIntegrationActor({
        props: {
          grantId: lookup?.grant.id,
          ownerId: lookup?.grant.ownerId,
          origin: 'automation',
        },
        grant: lookup?.grant ?? null,
        person,
        origin: 'automation',
      });
      if (!actor || !lookup || !person) {
        return json(
          { error: 'invalid_token', error_description: CONCESSAO_INVALIDA_MESSAGE },
          401,
          { 'WWW-Authenticate': 'Bearer realm="OAuth"' },
        );
      }

      const limited = await enforceAgentRateLimit(
        { grantId: lookup.grant.id, ownerId: lookup.grant.ownerId },
        await rateStoreFor(env, options, rateLimits),
        rateRules,
      );
      if (limited) return limited;

      if (isMcp) {
        return handleMcpRequest({
          request,
          requestId: REQUEST_IDS.get(request),
          grant: lookup.grant,
          person,
          origin: 'automation',
          catalog: catalogFor(env, options, actor),
          work: workCatalogFor(env, options, actor),
          delivery: deliveryCatalogFor(env, options, actor),
          marketing: marketingCatalogFor(env, options, actor),
          ...writePortsFor(env, options, actor),
          writesEnabled: integrationWritesEnabled(env),
          displayNameFallback: lookup.grant.ownerId,
        });
      }
      return dispatchIntegrationHttp({
        request,
        grant: lookup.grant,
        person,
        origin: 'automation',
        catalog: catalogFor(env, options, actor),
        work: workCatalogFor(env, options, actor),
        delivery: deliveryCatalogFor(env, options, actor),
        marketing: marketingCatalogFor(env, options, actor),
        ...writePortsFor(env, options, actor),
        writesEnabled: integrationWritesEnabled(env),
        displayNameFallback: lookup.grant.ownerId,
      });
    } catch (error) {
      if (error instanceof IntegrationUnavailableError) return unavailableResponse(error);
      throw new IntegrationUnavailableError('grant_store_unavailable', error);
    }
  }

  const server: IntegrationServer = {
    helpers,
    kv,
    grants,
    rateLimits,
    clientId: created.clientId,
    async fetch(request, env = {}, ctx = emptyCtx()) {
      /**
   * O id da requisição, resolvido AQUI TAMBÉM — e de propósito.
   *
   *   O `server.fetch` resolve o seu para as respostas normais. Quando ele
   *   explode antes de responder, essa resposta nunca existiu: o cliente nunca
   *   viu aquele id. O id que vale é este — o mesmo que vai no corpo, no
   *   cabeçalho e no log. Se o chamador mandou `X-Request-Id`, os dois são o
   *   mesmo valor, porque `resolveRequestId` prefere o que veio.
   */
  const requestId = resolveRequestId(request);
      REQUEST_IDS.set(request, requestId);
      const attach = (response: Response) => withRequestId(response, requestId);
      try {
        if (!integrationsEnabled(env)) {
          return attach(integrationDisabledResponse());
        }
        if (oversizedBody(request, maxBodyBytes)) {
          return attach(
            json(
              {
                error: 'payload_too_large',
                message: `O pedido passa de ${INTEGRATION_MAX_BODY_BYTES} bytes (64 KiB). Mande menos texto por chamada (divida o conteúdo em várias) e tente de novo.`,
              },
              413,
            ),
          );
        }
        if (!integrationsEnabled(env)) {
          return attach(integrationDisabledResponse());
        }
        const response = await withDeadline(deadlineMs, async () => {
          const url = new URL(request.url);
          if (isOpenApiPath(url.pathname)) {
            if (request.method !== 'GET') {
              return json({ error: 'method_not_allowed', message: 'Método não permitido.' }, 405);
            }
            return openApiResponse();
          }
          if (isManagementPath(url.pathname)) {
            return handleManagement(request, env);
          }
          const bearer = authorizationBearer(request);
          if (bearer && isAutomationSecret(bearer)) {
            return handleAutomation(request, env, bearer);
          }
          const human = await refuseIfIntegrationBearer(request);
          if (human) return human;

          if (
            url.pathname === '/.well-known/oauth-protected-resource' ||
            url.pathname.startsWith('/.well-known/oauth-protected-resource/')
          ) {
            const resource = url.pathname.includes(HTTP_INTEGRATIONS_PATH)
              ? httpAudience(url.origin)
              : mcpAudience(url.origin);
            return json({
              resource,
              authorization_servers: [url.origin],
              scopes_supported: [PROOF_SCOPE, ...INTEGRATION_CAPABILITIES],
              bearer_methods_supported: ['header'],
              resource_name:
                resource === httpAudience(url.origin) ? 'IDE Works (HTTP integrações)' : 'IDE Works (MCP)',
            });
          }

          const bound = { ...env, OAUTH_KV: kv };
          return providerFor(url.origin).fetch(request, bound as never, ctx as never);
        });
        return attach(response);
      } catch (error) {
        if (error instanceof DeadlineExceededError) return attach(deadlineResponse(deadlineMs));
        if (error instanceof IntegrationUnavailableError) return attach(unavailableResponse(error));
        throw error;
      }
    },
  };
  return server;
}

function oauthOptions(
  origin: string,
  ttl: { access: number; refresh: number },
  kv: ProofKv,
  grants: GrantStore,
  options: CreateIntegrationOptions,
  rateLimits: IntegrationRateLimitStore,
): OAuthProviderOptions {
  async function resolveSession(request: Request, env: IntegrationEnv): Promise<SessionResult> {
    return resolveHumanSession(request, env, options);
  }

  async function storeFor(env: IntegrationEnv): Promise<GrantStore> {
    return grantStoreFor(env, options, grants);
  }

  /**
   * A concessão e a pessoa, lidas UMA VEZ por requisição — F22, Fase 2.
   *
   * Eram lidas duas vezes: aqui, para montar o crachá, e outra vez no
   * despacho, para o mesmo par. Quatro idas ao banco para dois fatos que não
   * mudam no meio da requisição. Agora quem abre o portão já entrega o que
   * leu, e o despacho não repergunta.
   */
  async function loadGrantContext(
    props: Partial<TokenProps>,
    env: IntegrationEnv,
  ): Promise<{ grant: IntegrationGrant | null; person: PersonAccess | null }> {
    try {
      const store = await storeFor(env);
      const grantId = props.grantId as string;
      const ownerId = props.ownerId as string;
      // Numa transação só quando o porto sabe (o SQL sabe); senão, como sempre.
      if (store.getWithPerson) return await store.getWithPerson(grantId, ownerId);
      const grant = await store.get(grantId, ownerId);
      const person = await store.person(ownerId);
      return { grant, person };
    } catch (error) {
      if (error instanceof IntegrationUnavailableError) throw error;
      throw new IntegrationUnavailableError('grant_store_unavailable', error);
    }
  }

  /** O que o portão entrega quando deixa passar: o ator E o que foi lido para montá-lo. */
  type GatedContext = {
    actor: Actor;
    grant: IntegrationGrant;
    person: PersonAccess;
  };

  async function gatedActor(
    props: Partial<TokenProps>,
    env: IntegrationEnv,
    invalidMessage: string,
  ): Promise<GatedContext | Response> {
    const invalid = () =>
      json({ error: 'invalid_token', error_description: invalidMessage }, 401, {
        'WWW-Authenticate': 'Bearer realm="OAuth"',
      });
    if (!props.grantId || !props.ownerId || !props.origin) return invalid();
    const { grant, person } = await loadGrantContext(props, env);
    const actor = await resolveIntegrationActor({ props, grant, person, origin: props.origin });
    if (!actor || !grant || !person) return invalid();
    const limited = await enforceAgentRateLimit(
      { grantId: props.grantId, ownerId: props.ownerId },
      await rateStoreFor(env, options, rateLimits),
      options.rateRules ?? INTEGRATION_RATE_LIMITS,
    );
    if (limited) return limited;
    return { actor, grant, person };
  }

  async function persistPending(request: AuthRequest, resource: string): Promise<{ id: string; header: string }> {
    const id = randomToken();
    const pending: PendingAuth = { request, resource };
    await kv.put(`pending-oauth:${id}`, JSON.stringify(pending), { expirationTtl: 600 });
    return { id, header: laxCookie(OAUTH_REQUEST_COOKIE, id, 600) };
  }

  async function loadPending(request: Request): Promise<PendingAuth | null> {
    const id = cookieValue(request, OAUTH_REQUEST_COOKIE);
    if (!id) return null;
    const stored = await kv.get(`pending-oauth:${id}`, { type: 'json' });
    if (!stored || typeof stored !== 'object') return null;
    return stored as PendingAuth;
  }

  async function dispatchMcp(
    request: Request,
    env: IntegrationEnv,
    gated: GatedContext,
    props: Partial<TokenProps>,
    invalidMessage: string,
  ): Promise<Response> {
    if (!props.grantId || !props.ownerId || !props.origin) {
      return json({ error: 'invalid_token', error_description: invalidMessage }, 401, {
        'WWW-Authenticate': 'Bearer realm="OAuth"',
      });
    }
    // A concessão e a pessoa vêm do portão, já lidas. Reler aqui era a
    // duplicação que a F22 matou.
    const { actor, grant, person } = gated;
    return handleMcpRequest({
      request,
      requestId: REQUEST_IDS.get(request),
      grant,
      person,
      origin: props.origin,
      catalog: catalogFor(env, options, actor),
      work: workCatalogFor(env, options, actor),
      delivery: deliveryCatalogFor(env, options, actor),
      marketing: marketingCatalogFor(env, options, actor),
      ...writePortsFor(env, options, actor),
      writesEnabled: integrationWritesEnabled(env),
      displayNameFallback: props.subjectName ?? props.ownerId,
    });
  }

  async function authorize(request: Request, env: IntegrationEnv): Promise<Response> {
    const url = new URL(request.url);
    const helpersBound = env.OAUTH_PROVIDER;
    if (!helpersBound) return new Response('Provedor OAuth ausente.', { status: 500 });

    if (url.pathname === OAUTH_CONSENT_PATH && request.method === 'POST') {
      return handleConsentPost(request, env, helpersBound);
    }
    if (url.pathname !== OAUTH_AUTHORIZE_PATH && url.pathname !== OAUTH_CONSENT_PATH) {
      return new Response('Não encontrado.', { status: 404 });
    }
    if (request.method !== 'GET' && url.pathname === OAUTH_AUTHORIZE_PATH) {
      return new Response('Método não permitido.', { status: 405 });
    }

    try {
      let pending = await loadPending(request);
      let oauthRequest: AuthRequest;
      let resource: string;
      const hasQuery = url.searchParams.has('client_id');

      if (hasQuery) {
        oauthRequest = await helpersBound.parseAuthRequest(request);
        const bound = allowedResource(origin, oauthRequest.resource);
        if (!bound) {
          throw new AuthorizationError('invalid_target', {
            description: 'O recurso pedido não é o MCP nem a API de integrações.',
            redirectUri: oauthRequest.redirectUri,
            state: oauthRequest.state,
            issuer: oauthRequest.issuer,
          });
        }
        resource = bound;
        pending = { request: oauthRequest, resource };
      } else if (pending) {
        oauthRequest = pending.request;
        resource = pending.resource;
      } else {
        return new Response('Pedido OAuth ausente ou expirado.', { status: 400 });
      }

      const client = await helpersBound.lookupClient(oauthRequest.clientId);
      if (!client) return new Response('Cliente OAuth desconhecido.', { status: 400 });

      const saved = await persistPending(oauthRequest, resource);
      const session = await resolveSession(request, env);

      if (!session.ok) {
        if (session.reason === 'account_disabled') {
          const recusa = html(mensagemPaginaHtml('Acesso indisponível', session.message), 403);
          recusa.headers.append('Set-Cookie', saved.header);
          return recusa;
        }
        const login = new Response(null, {
          status: 302,
          headers: { Location: loginRedirectLocation(origin) },
        });
        login.headers.append('Set-Cookie', saved.header);
        return login;
      }

      if (options.syntheticConsent) {
        const granted = oauthRequest.scope.filter((scope) => scope === PROOF_SCOPE);
        const { redirectTo } = await helpersBound.completeAuthorization({
          request: { ...oauthRequest, resource },
          userId: SYNTHETIC_SUBJECT.id,
          metadata: { proof: true, clientName: client.clientName },
          scope: granted.length > 0 ? granted : [PROOF_SCOPE],
          props: {
            grantId: 'proof-grant',
            ownerId: SYNTHETIC_SUBJECT.id,
            origin: executionOrigin(resource, origin),
            clientId: client.clientId,
            capabilities: [],
            subjectId: SYNTHETIC_SUBJECT.id,
            subjectKind: 'synthetic',
            subjectName: SYNTHETIC_SUBJECT.name,
            integration: 'f16-proof',
            scopes: granted.length > 0 ? granted : [PROOF_SCOPE],
          } satisfies TokenProps,
        });
        if (grants instanceof MemoryGrantStore) {
          grants.grants.set('proof-grant', {
            id: 'proof-grant',
            ownerId: SYNTHETIC_SUBJECT.id,
            oauthClientId: client.clientId,
            name: grantName(client.clientName),
            capabilities: [],
            allowedCompanyIds: null,
            allowedClientIds: null,
            expiresAt: null,
            revokedAt: null,
            policyVersion: 1,
          });
        }
        return redirectWithCookies(redirectTo, [laxCookie(OAUTH_REQUEST_COOKIE, '', 0)]);
      }

      const store = await storeFor(env);
      const person =
        (await store.person(session.actor.userId)) ??
        ({
          userId: session.actor.userId,
          isActive: true,
          isSuperadmin: session.actor.isSuperadmin,
          isSuper: session.actor.isSuper,
          companyIds: [],
          clientIds: [],
          hasAllClientsAccess: session.actor.hasAllClientsAccess,
        } satisfies PersonAccess);

      const csrf = randomToken();
      const payload = consentPayload({
        clientId: client.clientId,
        clientName: client.clientName ?? grantName(undefined),
        csrf,
        person,
        redirectUri: oauthRequest.redirectUri,
      });
      const headers = new Headers();
      headers.append('Set-Cookie', saved.header);
      headers.append('Set-Cookie', laxCookie(OAUTH_CSRF_COOKIE, csrf, 600));
      if (wantsJson(request) || url.pathname === OAUTH_CONSENT_PATH) {
        return json(payload, 200, headers);
      }
      return html(consentHtml(payload), 200, headers);
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      return oauthErrorResponse(error);
    }
  }

  async function handleConsentPost(
    request: Request,
    env: IntegrationEnv,
    helpersBound: OAuthHelpers,
  ): Promise<Response> {
    if (!originAllowed(request)) {
      return json({ error: 'csrf', message: 'Origem da solicitação recusada.' }, 403);
    }
    const cookieCsrf = cookieValue(request, OAUTH_CSRF_COOKIE);
    const contentType = request.headers.get('Content-Type') ?? '';
    let postedCsrf = '';
    let capabilityValues: string[] = [];
    let companyScope = 'all';
    let clientScope = 'all';
    let companyIds: string[] = [];
    let clientIds: string[] = [];
    let postedClientName = '';

    if (contentType.includes('application/json')) {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      postedCsrf = typeof body.csrf === 'string' ? body.csrf : '';
      capabilityValues = Array.isArray(body.capabilities)
        ? body.capabilities.map(String)
        : Array.isArray(body.capability)
          ? body.capability.map(String)
          : [];
      companyScope = typeof body.company_scope === 'string' ? body.company_scope : 'all';
      clientScope = typeof body.client_scope === 'string' ? body.client_scope : 'all';
      companyIds = Array.isArray(body.companies) ? body.companies.map(String) : [];
      clientIds = Array.isArray(body.clients) ? body.clients.map(String) : [];
      postedClientName = typeof body.client_name === 'string' ? body.client_name : '';
    } else {
      const form = await request.formData();
      postedCsrf = String(form.get('csrf') ?? '');
      capabilityValues = form.getAll('capability').map(String);
      companyScope = String(form.get('company_scope') ?? 'all');
      clientScope = String(form.get('client_scope') ?? 'all');
      companyIds = form.getAll('company').map(String);
      clientIds = form.getAll('client').map(String);
      postedClientName = String(form.get('client_name') ?? '');
    }

    if (!cookieCsrf || !postedCsrf || !sameSecret(cookieCsrf, postedCsrf)) {
      return json({ error: 'csrf', message: 'Pedido de consentimento forjado.' }, 403);
    }

    const session = await resolveSession(request, env);
    if (!session.ok) {
      if (session.reason === 'account_disabled') {
        return html(mensagemPaginaHtml('Acesso indisponível', session.message), 403);
      }
      return new Response(null, { status: 302, headers: { Location: loginRedirectLocation(origin) } });
    }

    const pending = await loadPending(request);
    if (!pending) return new Response('Pedido OAuth ausente ou expirado.', { status: 400 });

    const client = await helpersBound.lookupClient(pending.request.clientId);
    if (!client) return new Response('Cliente OAuth desconhecido.', { status: 400 });

    // client_name no POST é informativo. Não concede capacidade nenhuma.
    void postedClientName;

    const capabilities = parseCapabilities(capabilityValues);
    try {
      // Última linha de defesa: a tela passou a evitar o caso, o servidor
      // continua recusando se algo furar (script desligado, cliente próprio).
      assertWriteImpliesRead(capabilities);
    } catch (error) {
      const detalhe = capabilitiesRefusalText(capabilities);
      // Quem falou JSON continua ouvindo JSON; navegador recebe página.
      if (wantsJson(request) || contentType.includes('application/json')) {
        return json(
          { error: 'invalid_capabilities', message: detalhe, detail: (error as Error).message },
          400,
        );
      }
      return html(capabilitiesRefusalHtml(detalhe), 400);
    }

    const companies = companyScope === 'ids' ? companyIds : null;
    const clientsSelected = clientScope === 'ids' ? clientIds : null;

    const { redirectTo } = await (async () => {
      const store = await storeFor(env);
      const grant = await store.insert({
        owner: session.actor,
        oauthClientId: client.clientId,
        name: grantName(client.clientName),
        capabilities,
        allowedCompanyIds: companies,
        allowedClientIds: clientsSelected,
      });
      const originKind = executionOrigin(pending.resource, origin);
      return helpersBound.completeAuthorization({
        request: { ...pending.request, resource: pending.resource },
        userId: session.actor.userId,
        metadata: { grantId: grant.id, clientName: client.clientName },
        scope: [PROOF_SCOPE],
        props: {
          grantId: grant.id,
          ownerId: session.actor.userId,
          origin: originKind,
          clientId: client.clientId,
          capabilities,
          subjectId: session.actor.userId,
          subjectKind: 'human',
          subjectName: session.actor.email,
          integration: 'ide-works',
          scopes: [PROOF_SCOPE],
        } satisfies TokenProps,
      });
    })();

    const pendingId = cookieValue(request, OAUTH_REQUEST_COOKIE);
    if (pendingId) await kv.delete(`pending-oauth:${pendingId}`);
    return redirectWithCookies(redirectTo, [
      laxCookie(OAUTH_REQUEST_COOKIE, '', 0),
      laxCookie(OAUTH_CSRF_COOKIE, '', 0),
    ]);
  }

  return {
    apiHandlers: {
      '/mcp': {
        fetch(request: Request, env: IntegrationEnv, ctx: ProofExecutionContext) {
          const semCanal = mcpSemCanalDeAvisos(request);
          if (semCanal) return Promise.resolve(semCanal);
          const props = (ctx.props ?? {}) as Partial<TokenProps>;
          return gatedActor(props, env, CONCESSAO_INVALIDA_MESSAGE)
            .then((gated) =>
              gated instanceof Response
                ? gated
                : dispatchMcp(request, env, gated, props, CONCESSAO_INVALIDA_MESSAGE),
            )
            .catch((error) => {
              if (error instanceof IntegrationUnavailableError) return unavailableResponse(error);
              throw error;
            });
        },
      },
      [HTTP_INTEGRATIONS_PATH]: {
        fetch(request: Request, env: IntegrationEnv, ctx: ProofExecutionContext) {
          const props = (ctx.props ?? {}) as Partial<TokenProps>;
          return gatedActor(props, env, AUDIENCIA_RECUSADA_MESSAGE)
            .then(async (gated) => {
              if (gated instanceof Response) return gated;
              if (!props.grantId || !props.ownerId || !props.origin) {
                return json({ error: 'invalid_token', error_description: AUDIENCIA_RECUSADA_MESSAGE }, 401, {
                  'WWW-Authenticate': 'Bearer realm="OAuth"',
                });
              }
              // Concessão e pessoa vêm do portão (F22, Fase 2): sem segunda leitura.
              const { actor, grant, person } = gated;
              return dispatchIntegrationHttp({
                request,
                grant,
                person,
                origin: props.origin,
                catalog: catalogFor(env, options, actor),
                work: workCatalogFor(env, options, actor),
                delivery: deliveryCatalogFor(env, options, actor),
                marketing: marketingCatalogFor(env, options, actor),
                ...writePortsFor(env, options, actor),
                writesEnabled: integrationWritesEnabled(env),
                displayNameFallback: props.subjectName ?? props.ownerId,
              });
            })
            .catch((error) => {
              if (error instanceof IntegrationUnavailableError) return unavailableResponse(error);
              throw error;
            });
        },
      },
    },
    defaultHandler: {
      fetch(request: Request, env: IntegrationEnv) {
        return authorize(request, env);
      },
    },
    authorizeEndpoint: OAUTH_AUTHORIZE_PATH,
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    accessTokenTTL: ttl.access,
    refreshTokenTTL: ttl.refresh,
    scopesSupported: [PROOF_SCOPE, ...INTEGRATION_CAPABILITIES],
    allowImplicitFlow: false,
    allowPlainPKCE: false,
    clientIdMetadataDocumentEnabled: false,
    resourceMetadata: {
      authorization_servers: [origin],
      scopes_supported: [PROOF_SCOPE, ...INTEGRATION_CAPABILITIES],
      bearer_methods_supported: ['header'],
      resource_name: 'IDE Works',
    },
  };
}

export async function createAgentProof(options: CreateAgentProofOptions = {}): Promise<AgentProof> {
  return createIntegrationHandler({ ...options, syntheticConsent: true });
}

/**
 * Cache de módulo do servidor — POR QUE ELE PRECISA LEMBRAR DE QUAL KV NASCEU
 *
 *   O servidor guarda o KV que recebeu no nascimento (ver `bound` em
 *   `oauthOptions`): trocar o binding depois não tem efeito. Um `??=` puro
 *   amarraria o primeiro KV visto para sempre dentro do isolado — se a
 *   primeira requisição chegasse sem binding, TODAS as seguintes cairiam na
 *   memória, mesmo com o namespace publicado ao lado. Guardar a identidade do
 *   KV e refazer o servidor quando ela muda custa uma comparação e elimina
 *   essa classe inteira de defeito.
 */
let workerServer: Promise<IntegrationServer> | undefined;
let workerServerKv: ProofKv | undefined;

/**
 * O KV do binding quando ele existe; memória quando não existe.
 *
 *   Sem binding, `createIntegrationHandler` cria um `MemoryKv` — memória do
 *   isolado, que a Cloudflare não compartilha entre isolados nem preserva.
 *   Era esse o defeito de 21/09/2026: `POST /oauth/register` gravava o cliente
 *   num isolado e `/oauth/authorize` caía em outro, devolvendo
 *   `400 Invalid client_id`. Dev e testes continuam na memória de propósito.
 */
function integrationServerFor(env: IntegrationEnv): Promise<IntegrationServer> {
  const kv = env.OAUTH_KV;
  if (!workerServer || workerServerKv !== kv) {
    workerServerKv = kv;
    // Sem o cliente de prova: ninguém do Worker o usa, e registrá-lo gravaria
    // um cliente novo e permanente no KV publicado a cada isolado.
    workerServer = createIntegrationHandler({ kv, registerTestClient: false });
  }
  return workerServer;
}

/**
 * Cola a medição de banco na resposta — F22, Fase 1.
 *
 *   A medição precisa ser lida DE FORA, em produção, sem abrir o painel da
 *   Cloudflare: é por isso que ela sai em cabeçalho e não em log. O cabeçalho
 *   carrega só contagem, tempos e rótulos escritos no código — nenhum
 *   identificador, nenhuma credencial, nenhum pedaço de conteúdo.
 *
 *   Tudo aqui é envolto em `try`: se anexar o cabeçalho falhar por qualquer
 *   motivo, a resposta original segue como estava. Medir não pode custar uma
 *   requisição.
 */
function comMedicao(resposta: Response, medicao: MedicaoDeBanco): Response {
  try {
    // 101 e 204 não aceitam corpo; reconstruir uma resposta dessas lança. Nem
    // vale a pena — não há conexão de banco num upgrade de WebSocket.
    if (resposta.status === 101 || resposta.status === 204 || resposta.status === 304) return resposta;
    const cabecalhos = new Headers(resposta.headers);
    cabecalhos.set(CABECALHO_DE_MEDICAO, cabecalhoDeMedicao(medicao));
    // O corpo passa por referência: nada é lido, nada é copiado, streaming
    // continua streaming.
    return new Response(resposta.body, {
      status: resposta.status,
      statusText: resposta.statusText,
      headers: cabecalhos,
    });
  } catch {
    return resposta;
  }
}

/**
 * A REDE DE CONTENÇÃO DE ÚLTIMO NÍVEL — F23, incidente de 22/09/2026.
 *
 * O QUE ACONTECEU
 *   `add_comment` gravava o comentário e devolvia `502 Bad gateway` a quem
 *   chamou. `search` e `get_board` faziam o mesmo quando muitas linhas casavam.
 *   O agente lia 502, concluía "falhou" e REPETIA — comentário duplicado numa
 *   tarefa real.
 *
 * POR QUE ISTO NÃO ERA DIAGNOSTICÁVEL
 *   Exceção DENTRO de uma ferramenta MCP não vira 502: o SDK converte todo
 *   `throw` do handler em resposta JSON-RPC de erro com HTTP 200. Logo a falha
 *   nascia FORA do handler — e não havia `try/catch` de último nível em lugar
 *   nenhum. O `catch` do `server.fetch` só converte prazo e indisponibilidade,
 *   e RE-LANÇA o resto; `handleIntegration`, `medirBancoDaRequisicao` e o
 *   `fetch` do Worker não tinham `catch`. O erro subia até a borda da
 *   Cloudflare, que desenha a própria página: sem corpo JSON, sem
 *   `X-Request-Id`, sem `x-ideworks-db`. Os `ray_id` do incidente não eram
 *   consultáveis, porque a observabilidade também estava desligada.
 *
 *   Resultado: um diagnóstico inteiro para descobrir que o problema era a
 *   AUSÊNCIA de rede, não a presença de um defeito conhecido.
 *
 * O QUE ESTA FUNÇÃO FAZ, E O QUE ELA NÃO FAZ
 *   Ela NÃO conserta a causa — conserta o fato de a causa ser invisível. Quem
 *   escapar daqui em diante vira `500` com corpo JSON legível e com o
 *   `X-Request-Id` que já existia, e a pilha vai para o log (ligado no
 *   `wrangler.toml`, bloco `[observability]`).
 *
 *   Ela não engole nada que já funcionava: prazo continua 504,
 *   indisponibilidade continua 503, e recusa de negócio nem chega aqui — ela
 *   já respondeu com o próprio código lá dentro.
 *
 * O QUE VAI PARA O CLIENTE
 *   Uma frase curta e o id da requisição. NADA de pilha, SQL, token, cookie,
 *   id de concessão ou pedaço de comentário: quem chama é um agente de fora, e
 *   mensagem de erro é a superfície mais fácil de vazar detalhe interno.
 */
function redeDeContencao(erro: unknown, request: Request, requestId: string): Response {
  // O que já tem tradução continua com ela — a rede pega só o que escapa.
  if (erro instanceof DeadlineExceededError) return deadlineResponse(INTEGRATION_DEADLINE_MS);
  if (erro instanceof IntegrationUnavailableError) return unavailableResponse(erro);

  // O LOG. Método e caminho bastam para achar a chamada; nem cabeçalho, nem
  // corpo, nem busca da URL entram aqui — `?q=` de uma busca é conteúdo.
  const caminho = (() => {
    try {
      return new URL(request.url).pathname;
    } catch {
      return '(url ilegível)';
    }
  })();
  console.error(
    `[ide-works] falha inesperada em ${request.method} ${caminho} (request_id=${requestId})`,
    erro,
  );

  return json(
    {
      error: 'internal',
      message:
        'Falha inesperada no servidor. A operação pode não ter sido concluída — ' +
        'o id desta requisição identifica a ocorrência no registro.',
      requestId,
    },
    500,
  );
}

export async function handleIntegration(
  request: Request,
  env: IntegrationEnv,
  ctx: ProofExecutionContext = emptyCtx(),
): Promise<Response> {
  if (!integrationsEnabled(env)) return integrationDisabledResponse();

  const requestId = resolveRequestId(request);

  /**
   * `withRequestDb` POR DENTRO DA MEDIÇÃO, e não por fora — F22, Fase 2.
   *
   *   O fechamento da conexão acontece no `finally` dele. Se a medição fechasse
   *   a conta antes disso, o cabeçalho diria `closed=0` numa conexão que fechou
   *   certinho, e a prova desta fase mentiria. Aninhado assim, o cabeçalho de
   *   uma chamada MCP passa a dizer `conns=1; closed=1`.
   *
   *   Este é também o único ponto onde o fechamento cobre TODOS os desfechos:
   *   resposta, erro, recusa e prazo estourado — o `withDeadline` mora lá
   *   dentro, e o trabalho que ele abandona termina de drenar no `end()`.
   */
  const { resultado, medicao } = await medirBancoDaRequisicao(async () => {
    // Montar o servidor também pode explodir (KV ruim, opções inválidas) — e
    // isso acontece antes de qualquer `withRequestDb`. Sem este `catch`
    // sobraria exatamente um caminho capaz de voltar a virar 502 opaco, que é
    // o que a rede existe para acabar. DENTRO da medição, para a resposta de
    // falha sair com `x-ideworks-db` como qualquer outra.
    let server: IntegrationServer;
    try {
      server = await integrationServerFor(env);
    } catch (erro) {
      return withRequestId(redeDeContencao(erro, request, requestId), requestId);
    }

    return withRequestDb(async () => {
      try {
        return await server.fetch(request, env, ctx);
      } catch (erro) {
        // A rede POR DENTRO da medição: assim a resposta de 500 ainda sai com
        // `x-ideworks-db`, e uma falha continua dizendo quantas conexões a
        // requisição chegou a abrir — que é justamente o que se quer saber
        // quando algo estoura.
        return withRequestId(redeDeContencao(erro, request, requestId), requestId);
      }
    }, {
      /**
       * O `waitUntil` da plataforma tira o fechamento lento do caminho da
       * resposta. Ele importa no desfecho de `deadline_exceeded`: ali a
       * consulta órfã ainda está em voo e o dreno pode levar os cinco segundos
       * do `end()` — quem já esperou os 8 s do prazo esperaria treze.
       * `db-request.ts` explica a carência curta que continua sendo esperada
       * para o cabeçalho da Fase 1 seguir dizendo `closed=1` no caminho feliz.
       */
        ...(typeof ctx.waitUntil === 'function'
          ? { waitUntil: (promise: Promise<unknown>) => ctx.waitUntil(promise) }
          : {}),
      },
    );
  });
  return comMedicao(resultado, medicao);
}

export const handleAgentProof = handleIntegration;

export async function refuseHumanApiIfIntegrationToken(
  request: Request,
  env: IntegrationEnv,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith('/api') || isIntegrationPath(pathname)) return null;
  const token = authorizationBearer(request);
  if (!token) return null;
  if (isAutomationSecret(token)) {
    return json(
      { error: 'invalid_token', error_description: 'Token de integração não autentica a API humana.' },
      401,
    );
  }
  const server = await integrationServerFor(env);
  const unwrapped = await server.helpers.unwrapToken(token);
  if (!unwrapped) return null;
  return json(
    { error: 'invalid_token', error_description: 'Token de integração não autentica a API humana.' },
    401,
  );
}
