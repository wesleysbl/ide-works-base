/**
 * Contrato HTTP, contexto recortado e helpers de página — F16.3a.
 *
 * OpenAPI e a resposta efetiva de `get_context` passam no mesmo schema Zod.
 * A suíte injeta grant store + empresas; não fala com Hyperdrive.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  GET_CONTEXT_PATH,
  HTTP_INTEGRATIONS_PATH,
  INTEGRATION_ERROR_CODES,
  OPENAPI_PATH,
  getContextOpenApiExample,
  getContextResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
} from '@/integrations/contract';
import { MemoryCatalog, getContext } from '@/integrations/context';
import { type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import {
  CONNECTIONS_PATH,
  MemoryGrantStore,
  OAUTH_CONSENT_PATH,
  OAUTH_CSRF_COOKIE,
  PROOF_REDIRECT_URI,
  PROOF_SCOPE,
  createIntegrationHandler,
  httpAudience,
  type IntegrationServer,
} from '@/integrations/handler';
import { RESPONSE_BUDGET_BYTES, fitItemsToBudget, measureJsonBytes, paginateStable } from '@/integrations/page';
import { SESSION_COOKIE as HUMAN_SESSION } from '@/server/session';
import type { AuthenticatedActor, SessionResult } from '@/server/session';

const ORIGIN = 'https://ideworks.test';
const HTTP = httpAudience(ORIGIN);
const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const OWNER: AuthenticatedActor = {
  userId: '11111111-1111-1111-1111-111111111111',
  email: 'wesley@exemplo.com.br',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: ['entrega'],
  hasAllClientsAccess: false,
};

const ADMIN: PersonAccess = {
  userId: OWNER.userId,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [COMPANY_A, COMPANY_B],
  clientIds: [],
  hasAllClientsAccess: false,
};

const CATALOG = new MemoryCatalog(
  [
    { id: COMPANY_A, name: 'Agência Ide' },
    { id: COMPANY_B, name: 'Ide Filmes' },
    { id: COMPANY_C, name: 'Carteira global' },
  ],
  new Map([[OWNER.userId, 'Wesley Lourenço']]),
);

const RESTRICTED: IntegrationGrant = {
  id: 'grant-restrito',
  ownerId: OWNER.userId,
  oauthClientId: 'claude',
  name: 'Claude da agência',
  capabilities: ['boards:read'],
  allowedCompanyIds: [COMPANY_A],
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 3,
};

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function mergeCookies(previous: string, response: Response): string {
  const map = new Map<string, string>();
  for (const part of previous.split(';').map((item) => item.trim()).filter(Boolean)) {
    const [key, ...rest] = part.split('=');
    map.set(key, rest.join('='));
  }
  for (const set of response.headers.getSetCookie()) {
    const pair = set.split(';')[0] ?? '';
    const [key, ...rest] = pair.split('=');
    const value = rest.join('=');
    if (!key) continue;
    if (value === '') map.delete(key);
    else map.set(key, value);
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function sessionResult(cookieHeader: string): SessionResult {
  if (!cookieHeader.includes(`${HUMAN_SESSION}=human-ok`)) {
    return { ok: false, status: 401, reason: 'no_token', message: 'Faltou o crachá.' };
  }
  return { ok: true, actor: OWNER };
}

async function createServer(): Promise<IntegrationServer> {
  const store = new MemoryGrantStore();
  store.seedPerson(ADMIN);
  return createIntegrationHandler({
    grants: store,
    catalog: CATALOG,
    resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
  });
}

async function httpToken(server: IntegrationServer): Promise<string> {
  const pair = await pkce();
  const authorize = new URL('/oauth/authorize', ORIGIN);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', server.clientId);
  authorize.searchParams.set('redirect_uri', PROOF_REDIRECT_URI);
  authorize.searchParams.set('code_challenge', pair.challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', 'v1');
  authorize.searchParams.set('scope', PROOF_SCOPE);
  authorize.searchParams.set('resource', HTTP);

  const started = await server.fetch(new Request(authorize.toString()));
  const withSession = `${mergeCookies('', started)}; ${HUMAN_SESSION}=human-ok`;
  const page = await server.fetch(
    new Request(authorize.toString(), { headers: { Cookie: withSession, Accept: 'application/json' } }),
  );
  const payload = (await page.json()) as { csrf?: string };
  const cookies = mergeCookies(withSession, page);
  const csrf =
    typeof payload.csrf === 'string'
      ? payload.csrf
      : (cookies.match(new RegExp(`${OAUTH_CSRF_COOKIE}=([^;]+)`))?.[1] ?? '');

  const posted = await server.fetch(
    new Request(new URL(OAUTH_CONSENT_PATH, ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookies },
      body: JSON.stringify({
        csrf,
        capabilities: ['boards:read'],
        company_scope: 'ids',
        companies: [COMPANY_A],
      }),
    }),
  );
  const code = new URL(posted.headers.get('Location')!).searchParams.get('code');
  const tokenRes = await server.fetch(
    new Request(new URL('/oauth/token', ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: PROOF_REDIRECT_URI,
        client_id: server.clientId,
        code_verifier: pair.verifier,
        resource: HTTP,
      }),
    }),
  );
  const body = (await tokenRes.json()) as { access_token: string };
  return body.access_token;
}

function assertContextShape(value: unknown) {
  const parsed = getContextResponseSchema.parse(value);
  expect(parsed.operation).toBe('get_context');
  expect(parsed.self).toBe(GET_CONTEXT_PATH);
  expect(parsed.effectiveScope).toBeTruthy();
  expect(parsed.queriedAt).toBeTruthy();
  expect(parsed).not.toHaveProperty('email');
  expect(parsed).not.toHaveProperty('isSuperadmin');
  expect(parsed).not.toHaveProperty('role');
  expect(parsed.owner).not.toHaveProperty('email');
  return parsed;
}

describe('OpenAPI e get_context passam na mesma validação', () => {
  it('o documento descreve os mesmos campos do schema Zod, e o exemplo fecha o contrato', () => {
    const doc = integrationOpenApi();
    const schema = (
      doc.components as {
        schemas: { GetContextResponse: { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean } };
      }
    ).schemas.GetContextResponse;
    expect(schema).toEqual(jsonSchemaFromZod(getContextResponseSchema));
    expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(getContextResponseSchema.shape).sort());
    expect([...schema.required].sort()).toEqual(Object.keys(getContextResponseSchema.shape).sort());
    expect(schema.additionalProperties).toBe(false);

    const example = getContextOpenApiExample();
    expect(assertContextShape(example).effectiveScope.capabilities).toEqual(['boards:read']);

    const errors = (
      doc.components as { schemas: { IntegrationError: { properties: { error: { enum: string[] } } } } }
    ).schemas.IntegrationError.properties.error.enum;
    for (const code of [
      'permission_denied',
      'ambiguous_match',
      'rate_limited',
      'data_incomplete',
      'invalid_token',
      'payload_too_large',
      'deadline_exceeded',
    ]) {
      expect(errors).toContain(code);
      expect(INTEGRATION_ERROR_CODES).toContain(code);
    }
  });

  it('a resposta efetiva de get_context (HTTP) valida no mesmo schema do OpenAPI', async () => {
    const server = await createServer();
    const openapi = await server.fetch(new Request(`${ORIGIN}${OPENAPI_PATH}`));
    expect(openapi.status).toBe(200);
    const doc = (await openapi.json()) as {
      paths: {
        '/get_context': {
          get: { responses: { '200': { content: { 'application/json': { example: unknown } } } } };
        };
      };
    };
    const example = doc.paths['/get_context'].get.responses['200'].content['application/json'].example;
    const fromOpenApi = assertContextShape(example);

    const access = await httpToken(server);
    const response = await server.fetch(
      new Request(`${ORIGIN}${GET_CONTEXT_PATH}`, { headers: { Authorization: `Bearer ${access}` } }),
    );
    expect(response.status).toBe(200);
    const fromHttp = assertContextShape(await response.json());
    expect(Object.keys(fromHttp).sort()).toEqual(Object.keys(fromOpenApi).sort());
    expect(fromHttp.effectiveScope.companies).toEqual([{ id: COMPANY_A, name: 'Agência Ide' }]);
    expect(fromHttp.effectiveScope.capabilities).toEqual(['boards:read']);
    expect(fromHttp.owner.displayName).toBe('Wesley Lourenço');
    expect(fromHttp.owner.displayName).not.toBe(OWNER.email);
    expect(JSON.stringify(fromHttp)).not.toContain('comments:write');
    expect(JSON.stringify(fromHttp)).not.toContain('Ide Filmes');
    expect(JSON.stringify(fromHttp)).not.toContain('Carteira global');
    expect(fromHttp.origin).toBe('http');
  });
});

describe('a concessão corta o admin na montagem do contexto', () => {
  it('admin com boards:read e uma empresa não vê as outras nem comments:write', () => {
    const agora = new Date('2026-09-21T04:00:00.000Z');
    const context = getContext({
      grant: RESTRICTED,
      person: ADMIN,
      origin: 'http',
      companies: CATALOG.companyList,
      displayName: 'Wesley Lourenço',
      now: agora,
    });
    expect(context.queriedAt).toBe(agora.toISOString());
    expect(context.effectiveScope.policyVersion).toBe(3);
    expect(context.effectiveScope.companyScope).toBe('ids');
    expect(context.effectiveScope.companies).toEqual([{ id: COMPANY_A, name: 'Agência Ide' }]);
    expect(context.effectiveScope.capabilities).toEqual(['boards:read']);
    expect(context.effectiveScope.capabilities).not.toContain('comments:write');
    expect(context.effectiveScope.capabilities).not.toContain('tasks:read');
    expect(ADMIN.isSuperadmin).toBe(true);
    expect(JSON.stringify(context)).not.toMatch(/isSuperadmin|papel|"email"/);
  });
});

describe('helpers de página', () => {
  const massa = Array.from({ length: 120 }, (_, index) => {
    const n = String(index + 1).padStart(3, '0');
    return { id: `item-${n}`, label: `Item ${n}` };
  });
  const key = (item: { id: string; label: string }) => ({ k: item.label.toLowerCase(), id: item.id });

  it('recusa limit acima de 100', () => {
    const recusa = paginateStable(massa, { limit: 101, key });
    expect(recusa).toMatchObject({ ok: false, code: 'limit_exceeded' });
  });

  it('pagina 50 por padrão e continua sem duplicar IDs numa massa estável', () => {
    const primeira = paginateStable(massa, { key });
    expect(primeira).toMatchObject({ returned: 50, hasMore: true });
    if ('ok' in primeira) throw new Error('esperava página');
    expect(primeira.items).toHaveLength(50);
    expect(primeira.nextCursor).toBeTruthy();

    const segunda = paginateStable(massa, { cursor: primeira.nextCursor, key });
    if ('ok' in segunda) throw new Error('esperava página');
    expect(segunda.returned).toBe(50);
    expect(segunda.hasMore).toBe(true);

    const terceira = paginateStable(massa, { cursor: segunda.nextCursor, key });
    if ('ok' in terceira) throw new Error('esperava página');
    expect(terceira.returned).toBe(20);
    expect(terceira.hasMore).toBe(false);
    expect(terceira.nextCursor).toBeNull();

    const ids = [...primeira.items, ...segunda.items, ...terceira.items].map((item) => item.id);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);
    expect(ids).toEqual(massa.map((item) => item.id));
  });

  it('sinaliza continuação ao estourar o orçamento de 64 KiB', () => {
    const bulky = Array.from({ length: 80 }, (_, index) => ({
      id: `blob-${String(index).padStart(3, '0')}`,
      payload: 'x'.repeat(1200),
    }));
    expect(measureJsonBytes(bulky)).toBeGreaterThan(RESPONSE_BUDGET_BYTES);
    const fitted = fitItemsToBudget(bulky, { key: (item) => ({ k: item.id, id: item.id }) });
    expect(fitted.hasMore).toBe(true);
    expect(fitted.nextCursor).toBeTruthy();
    expect(fitted.returned).toBeGreaterThan(0);
    expect(fitted.returned).toBeLessThan(bulky.length);
    expect(measureJsonBytes(fitted.items)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
  });
});

describe('adaptador HTTP /api/integrations/v1', () => {
  it('prefixo e /get_context devolvem o mesmo contexto; campo extra é recusado', async () => {
    const server = await createServer();
    const access = await httpToken(server);
    const headers = { Authorization: `Bearer ${access}` };
    const prefixo = await server.fetch(new Request(HTTP, { headers }));
    const nomeada = await server.fetch(new Request(`${ORIGIN}${GET_CONTEXT_PATH}`, { headers }));
    expect(prefixo.status).toBe(200);
    expect(nomeada.status).toBe(200);
    const a = assertContextShape(await prefixo.json());
    const b = assertContextShape(await nomeada.json());
    expect(a.effectiveScope).toEqual(b.effectiveScope);
    expect(a.owner).toEqual(b.owner);

    const extra = await server.fetch(
      new Request(`${ORIGIN}${GET_CONTEXT_PATH}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 1 }),
      }),
    );
    expect(extra.status).toBe(400);
    const recusa = (await extra.json()) as { error: string };
    expect(recusa.error).toBe('invalid_input');

    const delivery = await server.fetch(
      new Request(`${ORIGIN}${HTTP_INTEGRATIONS_PATH}/get_delivery_report`, { headers }),
    );
    expect(delivery.status).toBe(403);
    expect(((await delivery.json()) as { error: string }).error).toBe('permission_denied');

    const marketing = await server.fetch(
      new Request(`${ORIGIN}${HTTP_INTEGRATIONS_PATH}/get_marketing_report`, { headers }),
    );
    expect(marketing.status).toBe(403);
    expect(((await marketing.json()) as { error: string }).error).toBe('permission_denied');

    const unknown = await server.fetch(
      new Request(`${ORIGIN}${HTTP_INTEGRATIONS_PATH}/get_not_published`, { headers }),
    );
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: string }).error).toBe('unknown_operation');

    const people = await server.fetch(
      new Request(`${ORIGIN}${HTTP_INTEGRATIONS_PATH}/list_people`, { headers }),
    );
    expect(people.status).toBe(403);
    const denied = (await people.json()) as { error: string; items?: unknown };
    expect(denied.error).toBe('permission_denied');
    expect(denied).not.toHaveProperty('items');
  });

  it('token MCP não abre o HTTP; gestão /connections continua fora deste despacho', async () => {
    const server = await createServer();
    const pair = await pkce();
    const authorize = new URL('/oauth/authorize', ORIGIN);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', server.clientId);
    authorize.searchParams.set('redirect_uri', PROOF_REDIRECT_URI);
    authorize.searchParams.set('code_challenge', pair.challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('scope', PROOF_SCOPE);
    authorize.searchParams.set('resource', `${ORIGIN}/mcp`);
    const started = await server.fetch(new Request(authorize.toString()));
    const withSession = `${mergeCookies('', started)}; ${HUMAN_SESSION}=human-ok`;
    const page = await server.fetch(
      new Request(authorize.toString(), { headers: { Cookie: withSession, Accept: 'application/json' } }),
    );
    const payload = (await page.json()) as { csrf?: string };
    const cookies = mergeCookies(withSession, page);
    const csrf = typeof payload.csrf === 'string' ? payload.csrf : '';
    const posted = await server.fetch(
      new Request(new URL(OAUTH_CONSENT_PATH, ORIGIN), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookies },
        body: JSON.stringify({ csrf, capabilities: ['boards:read'] }),
      }),
    );
    const code = new URL(posted.headers.get('Location')!).searchParams.get('code');
    const tokenRes = await server.fetch(
      new Request(new URL('/oauth/token', ORIGIN), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: PROOF_REDIRECT_URI,
          client_id: server.clientId,
          code_verifier: pair.verifier,
          resource: `${ORIGIN}/mcp`,
        }),
      }),
    );
    const mcpToken = String(((await tokenRes.json()) as { access_token: string }).access_token);
    const http = await server.fetch(new Request(HTTP, { headers: { Authorization: `Bearer ${mcpToken}` } }));
    expect(http.status).toBe(401);

    const init = await server.fetch(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mcpToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'v1', version: '0' },
          },
        }),
      }),
    );
    expect(init.status).toBe(200);

    const listed = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}`, { headers: { Authorization: `Bearer ${mcpToken}` } }),
    );
    expect(listed.status).toBe(401);
  });
});
