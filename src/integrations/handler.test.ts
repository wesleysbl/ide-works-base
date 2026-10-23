import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_LABELS,
  INTEGRATION_CAPABILITIES,
  WRITE_CAPABILITIES,
  WRITE_DEPENDENCY_REASONS,
  WRITE_REQUIRES_READ,
  grantIsLive,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import {
  AUTOMATION_SECRET_PREFIX,
  capabilitiesRefusalHtml,
  consentHtml,
  consentPayload,
  CONNECTIONS_PATH,
  HTTP_INTEGRATIONS_PATH,
  LOGIN_NEXT,
  MemoryGrantStore,
  MemoryKv,
  memoryKvOf,
  OAUTH_CONSENT_PATH,
  OAUTH_CSRF_COOKIE,
  OAUTH_REQUEST_COOKIE,
  PROOF_REDIRECT_URI,
  PROOF_SCOPE,
  createIntegrationHandler,
  handleIntegration,
  envFlagEnabled,
  httpAudience,
  integrationWritesEnabled,
  integrationsEnabled,
  isIntegrationPath,
  loginRedirectLocation,
  OAUTH_AUTHORIZE_PATH,
  mcpAudience,
  resolveIntegrationActor,
  type IntegrationEnv,
  type ProofKv,
  type IntegrationServer,
  type TokenProps,
} from '@/integrations/handler';
import { MCP_TOOL_NAMES } from '@/integrations/mcp';
import {
  DeadlineExceededError,
  INTEGRATION_MAX_BODY_BYTES,
  REQUEST_ID_HEADER,
  sanitizeIntegrationLog,
  withDeadline,
} from '@/integrations/limits';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE as HUMAN_SESSION,
  sessionCookieHeader,
} from '@/server/session';
import type { AuthenticatedActor, SessionResult } from '@/server/session';

const AQUI = dirname(fileURLToPath(import.meta.url));

function liveGrants(server: IntegrationServer): IntegrationGrant[] {
  return [...(server.grants as MemoryGrantStore).grants.values()].filter((grant) => grant.revokedAt === null);
}

function setCookieLines(response: Response): string[] {
  return response.headers.getSetCookie();
}

function setCookieBlob(response: Response): string {
  return setCookieLines(response).join('\n');
}

const ORIGIN = 'https://ideworks.test';
const MCP = mcpAudience(ORIGIN);
const HTTP = httpAudience(ORIGIN);
const HUMAN_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c3VhcmlvLWh1bWFubyIsImlzcyI6InN1cGFiYXNlIn0.';

const OWNER: AuthenticatedActor = {
  userId: '11111111-1111-1111-1111-111111111111',
  email: 'wesley@exemplo.com.br',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: ['entrega', 'quadro'],
  hasAllClientsAccess: false,
};

const PERSON: PersonAccess = {
  userId: OWNER.userId,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['22222222-2222-2222-2222-222222222222'],
  clientIds: ['33333333-3333-3333-3333-333333333333'],
  hasAllClientsAccess: false,
};

const DISABLED: SessionResult = {
  ok: false,
  status: 403,
  reason: 'account_disabled',
  message: 'Esta conta está desativada. Procure um administrador.',
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
  if (cookieHeader.includes(`${HUMAN_SESSION}=disabled`)) return DISABLED;
  if (!cookieHeader.includes(`${HUMAN_SESSION}=human-ok`)) {
    return { ok: false, status: 401, reason: 'no_token', message: 'Faltou o crachá.' };
  }
  return { ok: true, actor: OWNER };
}

async function createServer(): Promise<IntegrationServer> {
  const store = new MemoryGrantStore();
  store.seedPerson(PERSON);
  return createIntegrationHandler({
    grants: store,
    resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
  });
}

function authorizeUrl(clientId: string, challenge: string, resource = MCP): URL {
  const authorize = new URL('/oauth/authorize', ORIGIN);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', PROOF_REDIRECT_URI);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', 'oauth-state');
  authorize.searchParams.set('scope', PROOF_SCOPE);
  authorize.searchParams.set('resource', resource);
  return authorize;
}

async function startAuthorize(
  server: IntegrationServer,
  options?: { cookie?: string; resource?: string; challenge?: string },
): Promise<{ response: Response; cookies: string; challenge: string; verifier: string }> {
  const pair = options?.challenge ? { challenge: options.challenge, verifier: '' } : await pkce();
  const response = await server.fetch(
    new Request(authorizeUrl(server.clientId, pair.challenge, options?.resource).toString(), {
      headers: options?.cookie ? { Cookie: options.cookie } : undefined,
    }),
  );
  return {
    response,
    cookies: mergeCookies(options?.cookie ?? '', response),
    challenge: pair.challenge,
    verifier: pair.verifier,
  };
}

async function consentGet(
  server: IntegrationServer,
  cookie: string,
  challenge: string,
  resource = MCP,
): Promise<Response> {
  return server.fetch(
    new Request(authorizeUrl(server.clientId, challenge, resource).toString(), {
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
      },
    }),
  );
}

async function consentPost(
  server: IntegrationServer,
  cookie: string,
  body: Record<string, unknown>,
  headers?: HeadersInit,
): Promise<Response> {
  return server.fetch(
    new Request(new URL(OAUTH_CONSENT_PATH, ORIGIN), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Cookie: cookie,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function csrfFrom(cookie: string, payload?: Record<string, unknown>): string {
  if (typeof payload?.csrf === 'string') return payload.csrf;
  const match = cookie.match(new RegExp(`${OAUTH_CSRF_COOKIE}=([^;]+)`));
  return match?.[1] ?? '';
}

async function exchangeCode(
  server: IntegrationServer,
  code: string,
  verifier: string,
  resource = MCP,
): Promise<Response> {
  return server.fetch(
    new Request(new URL('/oauth/token', ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: PROOF_REDIRECT_URI,
        client_id: server.clientId,
        code_verifier: verifier,
        resource,
      }),
    }),
  );
}

async function completeGrant(
  server: IntegrationServer,
  options?: {
    capabilities?: string[];
    resource?: string;
  },
): Promise<{ access: string; grantId: string }> {
  const pair = await pkce();
  const resource = options?.resource ?? MCP;
  const started = await startAuthorize(server, { challenge: pair.challenge, resource });
  expect(started.response.status).toBe(302);

  const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
  const page = await consentGet(server, withSession, pair.challenge, resource);
  expect(page.status).toBe(200);
  const payload = await parseJson(page);
  const cookies = mergeCookies(withSession, page);

  const posted = await consentPost(server, cookies, {
    csrf: csrfFrom(cookies, payload),
    capabilities: options?.capabilities ?? ['tasks:read', 'boards:read'],
    company_scope: 'all',
    client_scope: 'all',
  });
  expect(posted.status).toBe(302);
  const location = posted.headers.get('Location');
  expect(location).toBeTruthy();
  const code = new URL(location!).searchParams.get('code');
  expect(code).toBeTruthy();

  const tokenRes = await exchangeCode(server, code!, pair.verifier, resource);
  expect(tokenRes.status).toBe(200);
  const body = await parseJson(tokenRes);
  const access = String(body.access_token);
  const unwrapped = await server.helpers.unwrapToken(access);
  const grantId = String((unwrapped?.grant.props as TokenProps | undefined)?.grantId ?? '');
  return { access, grantId };
}

async function fullGrant(options?: {
  capabilities?: string[];
  resource?: string;
}): Promise<{
  server: IntegrationServer;
  access: string;
  grantId: string;
}> {
  const server = await createServer();
  const granted = await completeGrant(server, options);
  return { server, ...granted };
}

function mcpPost(token: string | null, method: string, params: unknown, id = 1): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request(MCP, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

describe('rotas de integração', () => {
  it('MCP, OAuth e HTTP de integrações ficam fora da API humana', () => {
    expect(isIntegrationPath('/mcp')).toBe(true);
    expect(isIntegrationPath('/oauth/consent')).toBe(true);
    expect(isIntegrationPath(HTTP_INTEGRATIONS_PATH)).toBe(true);
    expect(isIntegrationPath(CONNECTIONS_PATH)).toBe(true);
    expect(isIntegrationPath(`${CONNECTIONS_PATH}/abc/revoke`)).toBe(true);
    expect(isIntegrationPath('/api/health')).toBe(false);
    expect(isIntegrationPath('/painel')).toBe(false);
  });
});

describe('a tela de consentimento fala português e antecipa a dependência', () => {
  async function consentPage(): Promise<{ server: IntegrationServer; page: string }> {
    const server = await createServer();
    const { challenge } = await pkce();
    const resposta = await server.fetch(
      new Request(authorizeUrl(server.clientId, challenge).toString(), {
        headers: { Cookie: `${HUMAN_SESSION}=human-ok`, Accept: 'text/html' },
      }),
    );
    expect(resposta.status).toBe(200);
    return { server, page: await resposta.text() };
  }

  it('cada capacidade aparece com frase em português, e o nome técnico continua visível', async () => {
    const { page } = await consentPage();
    for (const cap of INTEGRATION_CAPABILITIES) {
      const rotulo = CAPABILITY_LABELS[cap];
      expect(rotulo, `falta rótulo em português para ${cap}`).toBeTruthy();
      expect(rotulo).not.toBe(cap);
      expect(page).toContain(rotulo);
      expect(page).toContain(`value="${cap}"`);
    }
  });

  it('o texto de cada permissão de leitura diz o que ela mostra hoje, curto e sem caractere que a página precise escapar', async () => {
    const { page } = await consentPage();
    const diz: Record<string, RegExp[]> = {
      // A ficha do cliente e a carteira inteira, não só "de quem é a tarefa".
      'clients:read': [/lista/, /plano/, /renova/, /urgência/, /cota/, /etiquetas/, /mural/, /histórico/],
      // As peças do mês, o calendário e quem marcou o ritual.
      'reports:delivery:read': [/peças/, /calendário/, /compromissos/, /Planejamento OK/, /Cliente aprovou/],
      // A ficha inteira da tarefa.
      'tasks:read': [/links/, /Dropbox/, /checklists/, /histórico/],
      // Quem fez o quê, e quando.
      'people:read': [/nomes/, /quem fez o quê/, /quando/, /histórico/],
    };
    for (const [cap, palavras] of Object.entries(diz)) {
      const rotulo = CAPABILITY_LABELS[cap as keyof typeof CAPABILITY_LABELS];
      for (const palavra of palavras) expect(rotulo, `${cap} precisa dizer ${palavra}`).toMatch(palavra);
      // Vira caixa de seleção: precisa caber numa frase, e sair na página como está escrito
      // (aspas retas, & e < viram entidade e a frase deixaria de aparecer igual).
      expect(rotulo.length, `${cap} está comprido demais`).toBeLessThanOrEqual(170);
      expect(rotulo).not.toMatch(/["'&<>]/);
      expect(page).toContain(rotulo);
    }
  });

  it('o mapa de dependências da tela é o WRITE_REQUIRES_READ do servidor', async () => {
    const { page } = await consentPage();
    const bloco = page.match(
      /<script id="dados-dependencia" type="application\/json">([\s\S]*?)<\/script>/,
    );
    expect(bloco, 'a tela precisa publicar o mapa de dependências').toBeTruthy();
    const dados = JSON.parse(bloco![1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')) as {
      requires: Record<string, string[]>;
      labels: Record<string, string>;
      reasons: Record<string, string>;
    };

    // Chaves idênticas: escrita nova sem entrada aqui quebra este teste.
    expect(Object.keys(dados.requires).sort()).toEqual([...WRITE_CAPABILITIES].sort());
    for (const write of WRITE_CAPABILITIES) {
      expect(dados.requires[write]).toEqual([...WRITE_REQUIRES_READ[write]]);
      expect(dados.reasons[write]).toBe(WRITE_DEPENDENCY_REASONS[write]);
      // A dependência também está escrita na página, para quem está sem script.
      for (const dep of WRITE_REQUIRES_READ[write]) {
        expect(dados.labels[dep]).toBe(CAPABILITY_LABELS[dep]);
        expect(page).toContain(CAPABILITY_LABELS[dep]);
      }
    }
    expect(Object.keys(dados.labels).sort()).toEqual([...INTEGRATION_CAPABILITIES].sort());
  });

  it('sem script, o servidor ainda recusa — e a recusa chega em português, não em JSON cru', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const payload = await parseJson(page);
    const cookies = mergeCookies(withSession, page);

    const posted = await server.fetch(
      new Request(new URL(OAUTH_CONSENT_PATH, ORIGIN), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
          Origin: ORIGIN,
          Cookie: cookies,
        },
        body: new URLSearchParams([
          ['csrf', csrfFrom(cookies, payload)],
          ['capability', 'comments:write'],
        ]),
      }),
    );
    expect(posted.status).toBe(400);
    expect(posted.headers.get('Content-Type')).toContain('text/html');
    const corpo = await posted.text();
    expect(corpo).not.toContain('invalid_capabilities');
    expect(corpo).toContain(CAPABILITY_LABELS['comments:write']);
    expect(corpo).toContain(CAPABILITY_LABELS['comments:read']);
    expect(corpo).toContain(CAPABILITY_LABELS['tasks:read']);
    expect(corpo).toContain('Nada foi concedido');
    expect(liveGrants(server)).toEqual([]);
  });

  /**
   * Auditoria de 08/10/2026 — o registro de cliente é aberto: qualquer um
   * registra um cliente chamado "Claude" com o endereço de retorno dele. A
   * tela só mostrava o nome (que o próprio cliente escolhe), e não para onde
   * o código de autorização seria entregue.
   */
  it('mostra para onde o acesso vai (o endereço de retorno) e pede para só autorizar se reconhecer', async () => {
    const server = await createServer();
    const registrado = await server.fetch(
      new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: ['https://atacante.example/callback'],
          token_endpoint_auth_method: 'none',
        }),
      }),
    );
    expect(registrado.status).toBeLessThan(300);
    const clientId = String((await parseJson(registrado)).client_id);
    const { challenge } = await pkce();
    const url = authorizeUrl(clientId, challenge);
    url.searchParams.set('redirect_uri', 'https://atacante.example/callback');
    const resposta = await server.fetch(
      new Request(url.toString(), { headers: { Cookie: `${HUMAN_SESSION}=human-ok`, Accept: 'text/html' } }),
    );
    expect(resposta.status).toBe(200);
    const page = await resposta.text();
    expect(page).toContain('Autorizar Claude');
    expect(page).toMatch(/Depois de autorizar, o acesso vai para:\s*<strong>atacante\.example<\/strong>/);
    expect(page).toContain('Só autorize se você reconhece este endereço');

    // O cliente que fala JSON recebe o mesmo dado.
    const json = await server.fetch(
      new Request(url.toString(), { headers: { Cookie: `${HUMAN_SESSION}=human-ok`, Accept: 'application/json' } }),
    );
    expect((await parseJson(json)).redirectHost).toBe('atacante.example');
  });

  it('retorno para este computador (agente de terminal) diz isso; o endereço sai escapado', () => {
    const local = consentHtml(
      consentPayload({
        clientId: 'c1',
        clientName: 'Claude Code',
        csrf: 'tok',
        person: PERSON,
        redirectUri: 'http://localhost:33418/callback',
      }),
    );
    expect(local).toMatch(/o acesso vai para:\s*<strong>localhost:33418<\/strong>/);
    expect(local).toContain('um programa neste computador');
    const semRetorno = consentHtml(consentPayload({ clientId: 'c1', clientName: 'X', csrf: 'tok', person: PERSON }));
    expect(semRetorno).not.toContain('o acesso vai para');
  });

  it('cliente que fala JSON continua recebendo a recusa em JSON', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const payload = await parseJson(page);
    const cookies = mergeCookies(withSession, page);

    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      capabilities: ['tasks:move', 'tasks:read'],
    });
    expect(posted.status).toBe(400);
    const corpo = await parseJson(posted);
    expect(corpo.error).toBe('invalid_capabilities');
    expect(String(corpo.message)).toContain(CAPABILITY_LABELS['boards:read']);
    expect(liveGrants(server)).toEqual([]);
  });
});

describe('[f26.4] as cinco escritas novas no consentimento', () => {
  const NOVAS = [
    'tasks:write',
    'tasks:assign',
    'tasks:complete',
    'clients:mural:write',
    'clients:history:write',
  ] as const;

  async function preparar(): Promise<{
    server: IntegrationServer;
    cookies: string;
    csrf: string;
    page: string;
    verifier: string;
  }> {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const html = await server.fetch(
      new Request(authorizeUrl(server.clientId, pair.challenge).toString(), {
        headers: { Cookie: withSession, Accept: 'text/html' },
      }),
    );
    const page = await html.text();
    const consent = await consentGet(server, withSession, pair.challenge);
    const payload = await parseJson(consent);
    const cookies = mergeCookies(withSession, consent);
    return { server, cookies, csrf: csrfFrom(cookies, payload), page, verifier: pair.verifier };
  }

  it('cada uma aparece com a frase, a caixa e a leitura que vem junto', async () => {
    const { page } = await preparar();
    for (const cap of NOVAS) {
      expect(page).toContain(`value="${cap}"`);
      expect(page).toContain(CAPABILITY_LABELS[cap]);
      // O motivo da dependência está escrito ao lado, para quem está sem script.
      expect(page).toContain(WRITE_DEPENDENCY_REASONS[cap]);
    }
    const bloco = page.match(
      /<script id="dados-dependencia" type="application\/json">([\s\S]*?)<\/script>/,
    );
    const dados = JSON.parse(bloco![1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')) as {
      requires: Record<string, string[]>;
    };
    // O script da tela marca sozinho a leitura: ele lê este mapa.
    expect(dados.requires['tasks:write']).toEqual(['tasks:read', 'boards:read']);
    expect(dados.requires['tasks:assign']).toEqual(['tasks:read', 'boards:read']);
    expect(dados.requires['tasks:complete']).toEqual(['tasks:read', 'boards:read']);
    expect(dados.requires['clients:mural:write']).toEqual(['clients:read']);
    expect(dados.requires['clients:history:write']).toEqual(['clients:read']);
  });

  it('escrita nova marcada sem a leitura é recusada em português, e nada é concedido', async () => {
    for (const [escrita, falta] of [
      ['tasks:write', 'boards:read'],
      ['tasks:assign', 'tasks:read'],
      ['tasks:complete', 'boards:read'],
      ['clients:mural:write', 'clients:read'],
      ['clients:history:write', 'clients:read'],
    ] as const) {
      const { server, cookies, csrf } = await preparar();
      const marcadas = [escrita, ...WRITE_REQUIRES_READ[escrita].filter((dep) => dep !== falta)];
      const posted = await consentPost(server, cookies, { csrf, capabilities: marcadas });
      expect(posted.status, escrita).toBe(400);
      const corpo = await parseJson(posted);
      expect(corpo.error).toBe('invalid_capabilities');
      expect(String(corpo.message)).toContain(CAPABILITY_LABELS[escrita]);
      expect(String(corpo.message)).toContain(CAPABILITY_LABELS[falta]);
      expect(String(corpo.message)).toContain(WRITE_DEPENDENCY_REASONS[escrita]);
      expect(liveGrants(server)).toEqual([]);
    }
  });

  it('a concessão com as cinco e as leituras delas é gravada, e o agente as enxerga', async () => {
    const { server, cookies, csrf, verifier } = await preparar();
    const pedidas = [...NOVAS, 'tasks:read', 'boards:read', 'clients:read'];
    const posted = await consentPost(server, cookies, { csrf, capabilities: pedidas });
    expect(posted.status).toBe(302);
    const grants = liveGrants(server);
    expect(grants).toHaveLength(1);
    expect([...grants[0].capabilities].sort()).toEqual([...pedidas].sort());

    // O contexto do agente devolve as cinco — o esquema de resposta as aceita.
    const code = new URL(posted.headers.get('Location')!).searchParams.get('code');
    const access = String((await parseJson(await exchangeCode(server, code!, verifier))).access_token);
    const rpc = await parseJson(
      await server.fetch(mcpPost(access, 'tools/call', { name: 'get_context', arguments: {} }, 3)),
    );
    const contexto = (rpc.result as { structuredContent: { effectiveScope: { capabilities: string[] } } })
      .structuredContent;
    expect([...contexto.effectiveScope.capabilities].sort()).toEqual([...pedidas].sort());
  });

  it('nesta fase as cinco não abrem ferramenta nova nem liberam comentar ou mover', async () => {
    const { server, cookies, csrf, verifier } = await preparar();
    const pedidas = [...NOVAS, 'tasks:read', 'boards:read', 'clients:read'];
    const posted = await consentPost(server, cookies, { csrf, capabilities: pedidas });
    const code = new URL(posted.headers.get('Location')!).searchParams.get('code');
    const access = String((await parseJson(await exchangeCode(server, code!, verifier))).access_token);

    const lista = await parseJson(await server.fetch(mcpPost(access, 'tools/list', {}, 4)));
    const nomes = (lista.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort();
    expect(nomes).toEqual([...MCP_TOOL_NAMES].sort());

    const comentar = await parseJson(
      await server.fetch(
        mcpPost(
          access,
          'tools/call',
          {
            name: 'add_comment',
            arguments: { taskId: '33333333-3333-4333-8333-333333333333', body: 'oi', idempotencyKey: 'k-f26-4' },
          },
          5,
        ),
      ),
    );
    // Recusa pela concessão (não por escrita desligada): tasks:write não é comments:write.
    expect(JSON.stringify(comentar)).toContain('permission_denied');
    expect(JSON.stringify(comentar)).toContain('não autoriza comentar');
  });
});

describe('consentimento lista capacidades e alcance', () => {
  it('HTML e JSON mostram as catorze capacidades e o alcance da pessoa', async () => {
    const server = await createServer();
    const { challenge } = await pkce();
    const html = await server.fetch(
      new Request(authorizeUrl(server.clientId, challenge).toString(), {
        headers: { Cookie: `${HUMAN_SESSION}=human-ok`, Accept: 'text/html' },
      }),
    );
    expect(html.status).toBe(200);
    const page = await html.text();
    for (const cap of INTEGRATION_CAPABILITIES) expect(page).toContain(cap);
    // Uma caixa por capacidade: as nove da F16 e as cinco escritas da F26.
    expect(INTEGRATION_CAPABILITIES).toHaveLength(14);
    expect(page.match(/name="capability"/g)).toHaveLength(14);
    expect(page).toContain('name="capability"');
    expect(page).toContain('name="company"');
    expect(page).toContain('name="client"');
    expect(page).toContain('name="company_scope"');
    expect(page).toContain('name="client_scope"');
    expect(page).toContain(PERSON.companyIds[0]);
    expect(page).toContain(PERSON.clientIds[0]);
    expect(page).toContain('Aceitar o nome do cliente');
    expect(liveGrants(server)).toEqual([]);

    const jsonPage = await server.fetch(
      new Request(authorizeUrl(server.clientId, challenge).toString(), {
        headers: { Cookie: `${HUMAN_SESSION}=human-ok`, Accept: 'application/json' },
      }),
    );
    const body = await parseJson(jsonPage);
    expect(body.capabilities).toEqual([...INTEGRATION_CAPABILITIES]);
    expect((body.reach as { companies: string[] }).companies).toEqual([...PERSON.companyIds]);
    expect((body.reach as { clients: string[] }).clients).toEqual([...PERSON.clientIds]);
    expect((body.client as { name: string }).name).toBeTruthy();
    expect(liveGrants(server)).toEqual([]);
  });

  it('escolhe alcance e o store persiste a escolha; o nome do cliente no POST não vira poder', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const payload = await parseJson(page);
    const cookies = mergeCookies(withSession, page);

    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      client_name: 'Cliente Onipotente',
      capabilities: ['tasks:read'],
      company_scope: 'ids',
      companies: [PERSON.companyIds[0]],
      client_scope: 'ids',
      clients: [PERSON.clientIds[0]],
    });
    expect(posted.status).toBe(302);
    const grants = liveGrants(server);
    expect(grants).toHaveLength(1);
    expect(grants[0].name).not.toBe('Cliente Onipotente');
    expect(grants[0].capabilities).toEqual(['tasks:read']);
    expect(grants[0].allowedCompanyIds).toEqual([PERSON.companyIds[0]]);
    expect(grants[0].allowedClientIds).toEqual([PERSON.clientIds[0]]);
  });

  it('POST sem escolha não emite token com poderes extras; aceitar o nome do cliente não concede nada', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const payload = await parseJson(page);
    const cookies = mergeCookies(withSession, page);

    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      client_name: 'Cliente Onipotente',
    });
    expect(posted.status).toBe(302);
    const grants = liveGrants(server);
    expect(grants).toHaveLength(1);
    expect(grants[0].capabilities).toEqual([]);
    expect(grants[0].name).not.toBe('Cliente Onipotente');

    const code = new URL(posted.headers.get('Location')!).searchParams.get('code');
    const tokenRes = await exchangeCode(server, code!, pair.verifier);
    const access = String((await parseJson(tokenRes)).access_token);

    const call = await server.fetch(
      mcpPost(access, 'tools/call', { name: 'get_context', arguments: {} }, 3),
    );
    const rpc = await parseJson(call);
    const context = (rpc.result as { structuredContent: { effectiveScope: { capabilities: string[] } } })
      .structuredContent;
    expect(context.effectiveScope.capabilities).toEqual([]);
    expect(context.effectiveScope.capabilities).not.toContain('tasks:read');
    expect(context.effectiveScope.capabilities).not.toContain('comments:write');
  });
});

describe('fluxo authorize → login → consentimento → token MCP', () => {
  it('sem cookie preserva o pedido, depois da sessão humana consente e lê get_context', async () => {
    const { server, access } = await fullGrant();

    const init = await server.fetch(
      mcpPost(access, 'initialize', {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'f16-2a', version: '0' },
      }),
    );
    expect(init.status).toBe(200);

    const read = await server.fetch(
      mcpPost(access, 'tools/call', { name: 'get_context', arguments: {} }, 3),
    );
    expect(read.status).toBe(200);
    const rpc = await parseJson(read);
    const context = (
      rpc.result as {
        structuredContent: {
          operation: string;
          owner: { id: string };
          integration: { id: string };
          effectiveScope: { capabilities: string[] };
        };
      }
    ).structuredContent;
    expect(context.operation).toBe('get_context');
    expect(context.owner.id).toBe(OWNER.userId);
    expect(context.effectiveScope.capabilities).toEqual(['boards:read', 'tasks:read']);
    expect(context.integration.id).toBeTruthy();
  });

  it('authorize sem sessão redireciona ao login existente e guarda o pedido em cookie Lax', async () => {
    const server = await createServer();
    const started = await startAuthorize(server);
    expect(started.response.status).toBe(302);
    expect(started.response.headers.get('Location')).toBe(loginRedirectLocation(ORIGIN));
    expect(loginRedirectLocation(ORIGIN)).toContain(`next=${encodeURIComponent(LOGIN_NEXT)}`);
    const setCookie = started.response.headers.getSetCookie().join('; ');
    expect(setCookie).toContain(`${OAUTH_REQUEST_COOKIE}=`);
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).not.toContain(`${HUMAN_SESSION}=`);
  });

  it('conta desativada não autoriza', async () => {
    const server = await createServer();
    const { challenge } = await pkce();
    const response = await server.fetch(
      new Request(authorizeUrl(server.clientId, challenge).toString(), {
        headers: { Cookie: `${HUMAN_SESSION}=disabled` },
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/desativada/);
  });
});

describe('sessão humana sobrevive ao OAuth', () => {
  it('completar OAuth não manda Set-Cookie apagando ideworks_sessao nem ideworks_renovacao', async () => {
    expect(sessionCookieHeader('human-ok', 60)).toContain('SameSite=Strict');
    expect(HUMAN_SESSION).toBe('ideworks_sessao');
    expect(REFRESH_COOKIE).toBe('ideworks_renovacao');

    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok; ${REFRESH_COOKIE}=refresh~9999999999`;
    const page = await consentGet(server, withSession, pair.challenge);
    const cookies = mergeCookies(withSession, page);
    const payload = await parseJson(page);
    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      capabilities: ['tasks:read'],
    });
    expect(posted.status).toBe(302);

    for (const response of [started.response, page, posted]) {
      const blob = setCookieBlob(response);
      expect(blob).not.toContain(`${HUMAN_SESSION}=`);
      expect(blob).not.toContain(`${REFRESH_COOKIE}=`);
      for (const line of setCookieLines(response)) {
        expect(line).toContain('SameSite=Lax');
        expect(line).not.toContain('SameSite=Strict');
      }
    }
    expect(cookies).toContain(`${HUMAN_SESSION}=human-ok`);
    expect(cookies).toContain(`${REFRESH_COOKIE}=refresh~9999999999`);
  });

  it('Entrar só devolve ao OAuth por next exacto /oauth/authorize, e por navegação de documento', () => {
    // A decisão saiu de `Entrar.tsx` para `pages/saida-do-login.ts`, porque
    // agora ela diz também COMO sair: `/oauth/authorize` é rota do Worker e
    // `navigate` do roteador cairia em "Página não encontrada".
    const saida = readFileSync(join(AQUI, '../pages/saida-do-login.ts'), 'utf8');
    expect(LOGIN_NEXT).toBe('/oauth/authorize');
    expect(saida).toContain("next === '/oauth/authorize'");
    expect(saida).toContain("{ tipo: 'documento', destino: '/oauth/authorize' }");
    expect(saida).toContain("{ tipo: 'aplicacao', destino: '/painel' }");
  });
});

describe('audiências', () => {
  it('token MCP na API humana é 401; JWT humano no MCP é 401', async () => {
    const { server, access } = await fullGrant();
    expect(await server.helpers.unwrapToken(access)).toBeTruthy();
    expect(await server.helpers.unwrapToken(HUMAN_JWT)).toBeNull();

    const destinos: string[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      destinos.push(input instanceof Request ? input.url : String(input));
      return previousFetch(input, init);
    }) as typeof fetch;
    try {
      const humanApi = await server.fetch(
        new Request(`${ORIGIN}/api/board/tree`, { headers: { Authorization: `Bearer ${access}` } }),
      );
      expect(humanApi.status).toBe(401);
      const body = await parseJson(humanApi);
      expect(body.error).toBe('invalid_token');
      expect(String(body.error_description)).toMatch(/API humana/);
      expect(destinos.some((destino) => destino.includes('/auth/v1/'))).toBe(false);
    } finally {
      globalThis.fetch = previousFetch;
    }

    const mcpHuman = await server.fetch(mcpPost(HUMAN_JWT, 'initialize', {}));
    expect(mcpHuman.status).toBe(401);
  });

  it('Worker recusa o token de integração antes de tratar Bearer humano', () => {
    const worker = readFileSync(join(AQUI, '../../worker/index.ts'), 'utf8');
    const integrationGate = worker.indexOf('if (isIntegrationPath(url.pathname))');
    const recusa = worker.indexOf('const recusaIntegracao = await refuseHumanApiIfIntegrationToken');
    const rota = worker.indexOf('const rota = `${request.method} ${caminho}`');
    const primeiroAtor = worker.indexOf('resolveActor(request, sql, provider, caminho)');
    expect(integrationGate).toBeGreaterThan(-1);
    expect(recusa).toBeGreaterThan(integrationGate);
    expect(rota).toBeGreaterThan(recusa);
    expect(primeiroAtor).toBeGreaterThan(recusa);

    const handler = readFileSync(join(AQUI, 'handler.ts'), 'utf8');
    const fetchStart = handler.indexOf('async fetch(request, env = {}, ctx = emptyCtx())');
    const recusaNoFetch = handler.indexOf('const human = await refuseIfIntegrationBearer(request)', fetchStart);
    const provedor = handler.indexOf('return providerFor(url.origin).fetch', fetchStart);
    expect(recusaNoFetch).toBeGreaterThan(fetchStart);
    expect(provedor).toBeGreaterThan(recusaNoFetch);
    expect(handler).toContain("error_description: 'Token de integração não autentica a API humana.'");
  });

  it('token MCP não abre o HTTP de integrações, e o HTTP não abre o MCP', async () => {
    const mcpGrant = await fullGrant({ resource: MCP });
    const httpWithMcp = await mcpGrant.server.fetch(
      new Request(HTTP, { headers: { Authorization: `Bearer ${mcpGrant.access}` } }),
    );
    expect(httpWithMcp.status).toBe(401);

    const httpGrant = await fullGrant({ resource: HTTP });
    const mcpWithHttp = await httpGrant.server.fetch(
      mcpPost(httpGrant.access, 'initialize', {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'wrong-aud', version: '0' },
      }),
    );
    expect(mcpWithHttp.status).toBe(401);

    const httpOk = await httpGrant.server.fetch(
      new Request(HTTP, { headers: { Authorization: `Bearer ${httpGrant.access}` } }),
    );
    expect(httpOk.status).toBe(200);
    const body = await parseJson(httpOk);
    expect(body.operation).toBe('get_context');
    expect(body.origin).toBe('http');
  });
});

describe('PKCE, redirect, código expirado e reutilizado', () => {
  it('redirect_uri não cadastrado não conclui', async () => {
    const server = await createServer();
    const { challenge } = await pkce();
    const authorize = authorizeUrl(server.clientId, challenge);
    authorize.searchParams.set('redirect_uri', 'https://evil.test/callback');
    const response = await server.fetch(new Request(authorize.toString()));
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
    expect(liveGrants(server)).toEqual([]);
  });

  it('verificador PKCE incorreto não troca o código por token', async () => {
    const server = await createServer();
    const pair = await pkce();
    const other = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const cookies = mergeCookies(withSession, page);
    const payload = await parseJson(page);
    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      capabilities: ['tasks:read'],
    });
    expect(liveGrants(server)).toHaveLength(1);
    const code = new URL(posted.headers.get('Location')!).searchParams.get('code');
    const tokenRes = await exchangeCode(server, code!, other.verifier);
    expect(tokenRes.status).toBeGreaterThanOrEqual(400);
    const body = await parseJson(tokenRes);
    expect(body.error).toBeTruthy();
    expect(body.access_token).toBeUndefined();
    expect(liveGrants(server)).toHaveLength(1);
  });

  it('código reutilizado não emite segundo token', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const cookies = mergeCookies(withSession, page);
    const payload = await parseJson(page);
    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      capabilities: ['tasks:read'],
    });
    const code = new URL(posted.headers.get('Location')!).searchParams.get('code')!;
    const first = await exchangeCode(server, code, pair.verifier);
    expect(first.status).toBe(200);
    const second = await exchangeCode(server, code, pair.verifier);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect((await parseJson(second)).access_token).toBeUndefined();
  });

  it('código expirado não emite token', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const cookies = mergeCookies(withSession, page);
    const payload = await parseJson(page);
    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      capabilities: ['tasks:read'],
    });
    const code = new URL(posted.headers.get('Location')!).searchParams.get('code')!;
    memoryKvOf(server).expireAuthorizationCodes();
    const tokenRes = await exchangeCode(server, code, pair.verifier);
    expect(tokenRes.status).toBeGreaterThanOrEqual(400);
    expect((await parseJson(tokenRes)).access_token).toBeUndefined();
  });
});

describe('CSRF do consentimento', () => {
  it('POST sem CSRF ou com Origin estranho é recusado', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const cookies = mergeCookies(withSession, page);
    const payload = await parseJson(page);

    const semCsrf = await consentPost(server, cookies, {
      capabilities: ['tasks:read'],
      client_name: 'forjado',
    });
    expect(semCsrf.status).toBe(403);
    expect(liveGrants(server)).toEqual([]);

    const originEstranho = await consentPost(
      server,
      cookies,
      { csrf: csrfFrom(cookies, payload), capabilities: ['tasks:read'] },
      { Origin: 'https://evil.test' },
    );
    expect(originEstranho.status).toBe(403);
    expect(liveGrants(server)).toEqual([]);
  });
});

describe('revalidação da concessão', () => {
  it('resolveIntegrationActor recusa concessão morta mesmo com props de token', async () => {
    const grant: IntegrationGrant = {
      id: 'grant-1',
      ownerId: PERSON.userId,
      oauthClientId: 'client',
      name: 'Agente',
      capabilities: ['tasks:read'],
      allowedCompanyIds: null,
      allowedClientIds: null,
      expiresAt: null,
      revokedAt: new Date('2026-09-21T00:00:00Z'),
      policyVersion: 2,
    };
    const actor = await resolveIntegrationActor({
      props: { grantId: grant.id, ownerId: grant.ownerId, origin: 'mcp' },
      grant,
      person: PERSON,
      origin: 'mcp',
    });
    expect(actor).toBeNull();
    expect(grantIsLive(grant)).toBe(false);
  });

  it('MCP recusa quando a concessão some do domínio e o KV ainda tem o token', async () => {
    const { server, access, grantId } = await fullGrant();
    const store = server.grants as MemoryGrantStore;
    store.grants.delete(grantId);
    const call = await server.fetch(
      mcpPost(access, 'initialize', {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'revoked', version: '0' },
      }),
    );
    expect(call.status).toBe(401);
  });
});

const HUMAN_COOKIE = `${HUMAN_SESSION}=human-ok`;

function managementHeaders(extra?: HeadersInit): HeadersInit {
  return { Cookie: HUMAN_COOKIE, Origin: ORIGIN, ...extra };
}

describe('gestão mínima de conexões (sessão humana)', () => {
  it('lista alcance, capacidades e validade; token de agente não entra', async () => {
    const { server, access, grantId } = await fullGrant({ capabilities: ['tasks:read'] });

    const asAgent = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}`, { headers: { Authorization: `Bearer ${access}` } }),
    );
    expect(asAgent.status).toBe(401);

    const listed = await server.fetch(new Request(`${ORIGIN}${CONNECTIONS_PATH}`, { headers: managementHeaders() }));
    expect(listed.status).toBe(200);
    expect(listed.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    const body = await parseJson(listed);
    const connections = body.connections as Array<Record<string, unknown>>;
    expect(connections).toHaveLength(1);
    expect(connections[0].id).toBe(grantId);
    expect(connections[0].capabilities).toEqual(['tasks:read']);
    expect(connections[0].live).toBe(true);
    expect(connections[0].revokedAt).toBeNull();
    expect((connections[0].reach as { companies: null }).companies).toBeNull();
  });

  it('POST/DELETE revoga no domínio; ecoa X-Request-Id', async () => {
    const { server, grantId } = await fullGrant();
    const revoked = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${grantId}/revoke`, {
        method: 'POST',
        headers: { ...managementHeaders(), [REQUEST_ID_HEADER]: 'req-revogar' },
      }),
    );
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get(REQUEST_ID_HEADER)).toBe('req-revogar');
    const body = await parseJson(revoked);
    expect(body.ok).toBe(true);
    expect(body.revokedAt).toBeTruthy();
    expect(grantIsLive((server.grants as MemoryGrantStore).grants.get(grantId)!)).toBe(false);
  });
});

describe('credencial de automação', () => {
  it('emite o segredo uma vez, guarda só o hash, e a rotação invalida o anterior', async () => {
    const { server, grantId } = await fullGrant();
    const first = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${grantId}/credentials`, {
        method: 'POST',
        headers: managementHeaders(),
      }),
    );
    expect(first.status).toBe(201);
    const issued = await parseJson(first);
    const secret = String(issued.secret);
    expect(secret.startsWith(AUTOMATION_SECRET_PREFIX)).toBe(true);
    expect(secret.length).toBeGreaterThanOrEqual(32);

    const store = server.grants as MemoryGrantStore;
    const dumped = JSON.stringify([...store.credentials.values()]);
    expect(dumped).not.toContain(secret);
    for (const credential of store.credentials.values()) {
      expect(credential.secretVerifier).toMatch(/^[0-9a-f]{64}$/);
    }

    const httpOk = await server.fetch(
      new Request(HTTP, { headers: { Authorization: `Bearer ${secret}` } }),
    );
    expect(httpOk.status).toBe(200);
    expect((await parseJson(httpOk)).origin).toBe('automation');

    const mcpOk = await server.fetch(mcpPost(secret, 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'auto', version: '0' },
    }));
    expect(mcpOk.status).toBe(200);

    const second = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${grantId}/credentials`, {
        method: 'POST',
        headers: managementHeaders(),
      }),
    );
    expect(second.status).toBe(201);
    const rotated = String((await parseJson(second)).secret);
    expect(rotated).not.toBe(secret);

    const oldHttp = await server.fetch(
      new Request(HTTP, { headers: { Authorization: `Bearer ${secret}` } }),
    );
    expect(oldHttp.status).toBe(401);
    const newHttp = await server.fetch(
      new Request(HTTP, { headers: { Authorization: `Bearer ${rotated}` } }),
    );
    expect(newHttp.status).toBe(200);
  });
});

/**
 * Auditoria de 08/10/2026 — a suspeita era que o `try` da credencial de
 * automação cobrisse o despacho inteiro, e que QUALQUER falha, até depois de
 * gravar, virasse 503 "A operação não foi executada". Não cobre: o despacho é
 * devolvido sem `await`, e a rejeição dele passa ao largo do `catch`. Estes
 * casos fixam isso — um `return await` ali mudaria a frase de quem já gravou.
 * Só a leitura da credencial é "não deu para confirmar a concessão"; o resto
 * sobe para a rede de contenção (500, "pode não ter sido concluída"), como no
 * caminho OAuth.
 */
describe('credencial de automação: o 503 é só da leitura da credencial', () => {
  async function comCredencial(
    opcoes: { grants?: MemoryGrantStore; catalog?: NonNullable<Parameters<typeof createIntegrationHandler>[0]>['catalog'] } = {},
  ): Promise<{ server: IntegrationServer; secret: string }> {
    const store = opcoes.grants ?? new MemoryGrantStore();
    store.seedPerson(PERSON);
    const server = await createIntegrationHandler({
      grants: store,
      ...(opcoes.catalog ? { catalog: opcoes.catalog } : {}),
      resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
    });
    const { grantId } = await completeGrant(server);
    const issued = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${grantId}/credentials`, {
        method: 'POST',
        headers: managementHeaders(),
      }),
    );
    expect(issued.status).toBe(201);
    return { server, secret: String((await parseJson(issued)).secret) };
  }

  it('falha DEPOIS da credencial não vira "não foi executada": sobe para a rede de contenção', async () => {
    const catalog = {
      async companies() {
        return [];
      },
      async displayName(): Promise<string | null> {
        throw new Error('o catálogo caiu depois do portão');
      },
    };
    const { server, secret } = await comCredencial({ catalog });
    await expect(
      server.fetch(new Request(HTTP, { headers: { Authorization: `Bearer ${secret}` } })),
    ).rejects.toThrow('o catálogo caiu depois do portão');
  });

  it('falha ao LER a credencial continua 503, "não foi executada"', async () => {
    class StoreQueCai extends MemoryGrantStore {
      caiu = false;
      override async lookupByVerifier(
        ...args: Parameters<MemoryGrantStore['lookupByVerifier']>
      ): ReturnType<MemoryGrantStore['lookupByVerifier']> {
        if (this.caiu) throw new Error('banco fora');
        return super.lookupByVerifier(...args);
      }
    }
    const grants = new StoreQueCai();
    const { server, secret } = await comCredencial({ grants });
    grants.caiu = true;
    const response = await server.fetch(new Request(HTTP, { headers: { Authorization: `Bearer ${secret}` } }));
    expect(response.status).toBe(503);
    expect(await parseJson(response)).toMatchObject({
      error: 'grant_store_unavailable',
      message: expect.stringMatching(/não foi executada/),
    });
  });
});

describe('revogação vence o KV de outro isolado', () => {
  it('Isolado A revoga no store compartilhado; Isolado B ainda tem o token no KV e recusa MCP e HTTP', async () => {
    const store = new MemoryGrantStore();
    store.seedPerson(PERSON);
    const session = async (request: Request) => sessionResult(request.headers.get('Cookie') ?? '');
    const kvA = new MemoryKv();
    const kvB = new MemoryKv();
    const serverA = await createIntegrationHandler({ kv: kvA, grants: store, resolveSession: session });
    const serverB = await createIntegrationHandler({ kv: kvB, grants: store, resolveSession: session });

    const mcpGrant = await completeGrant(serverA, { resource: MCP });
    kvA.cloneInto(kvB);
    expect(await serverB.helpers.unwrapToken(mcpGrant.access)).toBeTruthy();

    const revokeMcp = await serverA.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${mcpGrant.grantId}/revoke`, {
        method: 'DELETE',
        headers: managementHeaders(),
      }),
    );
    expect(revokeMcp.status).toBe(200);
    expect(await serverB.helpers.unwrapToken(mcpGrant.access)).toBeTruthy();

    const mcpB = await serverB.fetch(
      mcpPost(mcpGrant.access, 'initialize', {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'isolado-b', version: '0' },
      }),
    );
    expect(mcpB.status).toBe(401);

    const httpGrant = await completeGrant(serverA, { resource: HTTP });
    kvA.cloneInto(kvB);
    expect(await serverB.helpers.unwrapToken(httpGrant.access)).toBeTruthy();

    const revokeHttp = await serverA.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${httpGrant.grantId}/revoke`, {
        method: 'POST',
        headers: managementHeaders(),
      }),
    );
    expect(revokeHttp.status).toBe(200);
    expect(await serverB.helpers.unwrapToken(httpGrant.access)).toBeTruthy();

    const httpB = await serverB.fetch(
      new Request(HTTP, { headers: { Authorization: `Bearer ${httpGrant.access}` } }),
    );
    expect(httpB.status).toBe(401);
  });
});

describe('responsável desativado', () => {
  it('a próxima operação recusa depois de isActive=false no store de perfil', async () => {
    const { server, access, grantId } = await fullGrant();
    const ok = await server.fetch(
      mcpPost(access, 'initialize', {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'antes', version: '0' },
      }),
    );
    expect(ok.status).toBe(200);

    (server.grants as MemoryGrantStore).seedPerson({ ...PERSON, isActive: false });
    expect(await server.helpers.unwrapToken(access)).toBeTruthy();
    expect(grantIsLive((server.grants as MemoryGrantStore).grants.get(grantId)!)).toBe(true);

    const recusa = await server.fetch(
      mcpPost(access, 'initialize', {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'depois', version: '0' },
      }),
    );
    expect(recusa.status).toBe(401);
    expect(await server.helpers.unwrapToken(access)).toBeTruthy();
  });
});

describe('limites, prazo, corpo e log', () => {
  it('excesso de chamadas devolve 429, rate_limited, orientação de espera e Retry-After', async () => {
    const store = new MemoryGrantStore();
    store.seedPerson(PERSON);
    const server = await createIntegrationHandler({
      grants: store,
      resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
      rateRules: {
        grant: { max: 2, windowMs: 60_000 },
        owner: { max: 10, windowMs: 60_000 },
      },
    });
    const { access } = await completeGrant(server);
    const call = () =>
      server.fetch(
        mcpPost(access, 'initialize', {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'limite', version: '0' },
        }),
      );
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    const body = await parseJson(blocked);
    expect(body.error).toBe('rate_limited');
    expect(String(body.message)).toMatch(/Espere \d+ segundo/);
    expect(Number(body.retryAfterSeconds)).toBeGreaterThanOrEqual(1);
  });

  it('log sanitizado não conserva Bearer, cookie, senha nem verificador', () => {
    const bruto =
      'Authorization: Bearer super-secreto Cookie: ideworks_sessao=jwt.aqui password=hunter2 secret_verifier=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const limpo = sanitizeIntegrationLog(bruto);
    expect(limpo).not.toMatch(/super-secreto/);
    expect(limpo).not.toMatch(/ideworks_sessao=jwt/);
    expect(limpo).not.toMatch(/hunter2/);
    expect(limpo).not.toMatch(/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    expect(limpo).toMatch(/Bearer \[redacted\]/);
  });

  it('body acima de 64 KiB é recusado', async () => {
    const server = await createServer();
    const oversized = 'x'.repeat(INTEGRATION_MAX_BODY_BYTES + 1);
    const recusa = await server.fetch(
      new Request(MCP, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(oversized.length),
        },
        body: oversized,
      }),
    );
    expect(recusa.status).toBe(413);
    const corpo = await parseJson(recusa);
    expect(corpo.error).toBe('payload_too_large');
    // A recusa diz o que fazer: mandar menos texto por chamada.
    expect(String(corpo.message)).toMatch(/divida o conteúdo em várias/);
  });

  it('prazo de execução estourado recusa com deadline_exceeded', async () => {
    await expect(withDeadline(5, () => new Promise((resolve) => setTimeout(resolve, 50)))).rejects.toBeInstanceOf(
      DeadlineExceededError,
    );

    const store = new MemoryGrantStore();
    store.seedPerson(PERSON);
    store.list = async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return [];
    };
    const server = await createIntegrationHandler({
      grants: store,
      deadlineMs: 5,
      resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
    });
    const recusa = await server.fetch(new Request(`${ORIGIN}${CONNECTIONS_PATH}`, { headers: managementHeaders() }));
    expect(recusa.status).toBe(504);
    const corpo = await parseJson(recusa);
    expect(corpo.error).toBe('deadline_exceeded');
    // A recusa diz o que fazer: pedir menos de uma vez, e conferir antes de repetir uma escrita.
    expect(String(corpo.message)).toMatch(/Peça menos de uma vez/);
    expect(String(corpo.message)).toMatch(/idempotencyKey/);
  });
});

describe('interruptores F16.9a', () => {
  it('só o texto exato false desliga', () => {
    expect(envFlagEnabled(undefined)).toBe(true);
    expect(integrationsEnabled()).toBe(true);
    expect(integrationsEnabled({})).toBe(true);
    expect(integrationsEnabled({ IDEWORKS_INTEGRATIONS_ENABLED: 'true' })).toBe(true);
    expect(integrationsEnabled({ IDEWORKS_INTEGRATIONS_ENABLED: '1' })).toBe(true);
    expect(integrationsEnabled({ IDEWORKS_INTEGRATIONS_ENABLED: 'FALSE' })).toBe(true);
    expect(integrationsEnabled({ IDEWORKS_INTEGRATIONS_ENABLED: 'false' })).toBe(false);
    expect(integrationWritesEnabled({ IDEWORKS_INTEGRATION_WRITES_ENABLED: 'false' })).toBe(false);
    expect(integrationWritesEnabled({ IDEWORKS_INTEGRATION_WRITES_ENABLED: 'true' })).toBe(true);
  });

  it('integração OFF recusa MCP, OAuth e HTTP de agentes com 503 estável', async () => {
    const server = await createServer();
    const off = { IDEWORKS_INTEGRATIONS_ENABLED: 'false' };
    const paths = [
      '/mcp',
      '/oauth/authorize',
      '/oauth/token',
      '/oauth/register',
      '/.well-known/oauth-authorization-server',
      HTTP_INTEGRATIONS_PATH,
      `${HTTP_INTEGRATIONS_PATH}/get_context`,
      CONNECTIONS_PATH,
    ];
    for (const path of paths) {
      const response = await server.fetch(new Request(`${ORIGIN}${path}`), off);
      expect(response.status).toBe(503);
      expect(await parseJson(response)).toMatchObject({ error: 'unavailable' });
    }
    expect(isIntegrationPath('/api/health')).toBe(false);
    expect(isIntegrationPath('/api/auth/login')).toBe(false);
    expect(isIntegrationPath('/painel')).toBe(false);
  });

  it('Worker despacha integração antes de ASSETS e da API humana', () => {
    const worker = readFileSync(join(AQUI, '../../worker/index.ts'), 'utf8');
    const integrationGate = worker.indexOf('if (isIntegrationPath(url.pathname))');
    const assets = worker.indexOf("if (!url.pathname.startsWith('/api'))");
    const health = worker.indexOf("if (rota === 'GET /health')");
    expect(integrationGate).toBeGreaterThan(-1);
    expect(assets).toBeGreaterThan(integrationGate);
    expect(health).toBeGreaterThan(assets);
    expect(worker).toContain('IDEWORKS_INTEGRATIONS_ENABLED');
  });

  it('escritas OFF recusam add_comment e mantêm get_context', async () => {
    const granted = await fullGrant({
      capabilities: ['tasks:read', 'boards:read', 'comments:read', 'comments:write'],
      resource: HTTP,
    });
    const off = { IDEWORKS_INTEGRATION_WRITES_ENABLED: 'false' };
    const context = await granted.server.fetch(
      new Request(`${ORIGIN}${HTTP_INTEGRATIONS_PATH}/get_context`, {
        headers: { Authorization: `Bearer ${granted.access}` },
      }),
      off,
    );
    expect(context.status).toBe(200);

    const comment = await granted.server.fetch(
      new Request(`${ORIGIN}${HTTP_INTEGRATIONS_PATH}/add_comment`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${granted.access}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId: '33333333-3333-4333-8333-333333333333',
          body: 'não deve gravar',
          idempotencyKey: 'idem-off',
        }),
      }),
      off,
    );
    expect(comment.status).toBe(503);
    expect(await parseJson(comment)).toMatchObject({ error: 'unavailable' });
  });
});

/**
 * O DEFEITO DE 21/09/2026 — `400 Invalid client_id` ao conectar o Claude.
 *
 *   O registro do cliente morava na memória do isolado. A Cloudflare roda
 *   várias cópias do Worker: `POST /oauth/register` caiu numa,
 *   `GET /oauth/authorize` caiu noutra, que não conhecia o cliente.
 *
 *   O que estes testes travam é ONDE O ESTADO MORA — não o fluxo OAuth, que
 *   não mudou. Com binding, o registro tem que estar no KV do binding, e ser
 *   encontrado por um isolado que nunca viu o registro acontecer.
 */
describe('o OAuth de agentes guarda o estado no KV do binding', () => {
  /**
   * Um KV que NÃO é `MemoryKv` — é esse o ponto.
   *
   *   O `KVNamespace` da Cloudflare atende `ProofKv` por forma, e nunca vai
   *   passar num `instanceof MemoryKv`. Era exatamente isso que fazia o
   *   handler descartar o binding e criar memória por dentro. Uma classe que
   *   herda de `MemoryKv` passaria no teste sem provar nada.
   */
  class KvEspiao implements ProofKv {
    readonly gravadas: string[] = [];
    private readonly interno = new MemoryKv();

    async get(key: string, options?: { type?: string }): Promise<unknown> {
      return this.interno.get(key, options);
    }
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      this.gravadas.push(key);
      await this.interno.put(key, value, options);
    }
    async delete(key: string): Promise<void> {
      await this.interno.delete(key);
    }
    async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
      return this.interno.list(options);
    }
    /** O mesmo namespace visto por outro isolado: os dados atravessam, o objeto não. */
    clonarPara(outro: KvEspiao): void {
      this.interno.cloneInto(outro.interno);
    }
  }

  async function registrar(env: IntegrationEnv): Promise<string> {
    const response = await handleIntegration(
      new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [PROOF_REDIRECT_URI],
          token_endpoint_auth_method: 'none',
        }),
      }),
      env,
    );
    expect(response.status).toBeLessThan(300);
    const body = (await parseJson(response)) as { client_id?: string };
    expect(body.client_id).toBeTruthy();
    return body.client_id!;
  }

  it('com binding, o registro vai para o KV publicado e outro isolado o encontra', async () => {
    const kv = new KvEspiao();
    const clientId = await registrar({ OAUTH_KV: kv });
    expect(kv.gravadas.some((chave) => chave.startsWith('client:'))).toBe(true);

    /* O "outro isolado": env novo, servidor refeito, MESMO KV — é o que o binding garante. */
    const outroIsolado = new KvEspiao();
    kv.clonarPara(outroIsolado);
    const authorize = await handleIntegration(
      new Request(
        `${ORIGIN}${OAUTH_AUTHORIZE_PATH}?response_type=code&client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(PROOF_REDIRECT_URI)}&scope=${encodeURIComponent(PROOF_SCOPE)}` +
          '&state=xyz&code_challenge=abc&code_challenge_method=S256',
      ),
      { OAUTH_KV: outroIsolado },
    );
    expect(authorize.status).not.toBe(400);
    expect(await authorize.clone().text()).not.toContain('Invalid client_id');
  });

  /**
   * Auditoria de 08/10/2026 — montar o servidor (cada isolado novo, a cada
   * troca de KV) registrava um cliente OAuth de prova ("Cliente de integração",
   * retorno `https://agent.test/callback`) no KV PUBLICADO, sem prazo. Lixo
   * permanente que se acumula; só a suíte precisa desse cliente.
   */
  it('montar o servidor de produção não registra cliente OAuth nenhum no KV', async () => {
    const kv = new KvEspiao();
    const resposta = await handleIntegration(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`), {
      OAUTH_KV: kv,
    });
    expect(resposta.status).toBe(200);
    expect(kv.gravadas.filter((chave) => chave.startsWith('client:'))).toEqual([]);
  });

  it('sem binding cai na memória do isolado — e é só isso que dev e suíte usam', async () => {
    const kv = new KvEspiao();
    await registrar({});
    expect(kv.gravadas).toHaveLength(0);
  });

  it('wrangler.toml publica o binding com o nome que o código lê', () => {
    const wrangler = readFileSync(join(AQUI, '../../wrangler.toml'), 'utf8');
    expect(wrangler).toMatch(/\[\[kv_namespaces\]\]\s*\nbinding = "OAUTH_KV"\nid = "[0-9a-f]{32}"/);
    const worker = readFileSync(join(AQUI, '../../worker/index.ts'), 'utf8');
    expect(worker).toContain('OAUTH_KV');
  });
});

/**
 * F22, Fase 1 — a medição sai pelo cabeçalho, e a resposta não muda por causa dela.
 */
describe('cabeçalho de medição de banco', () => {
  it('toda resposta da integração traz a contagem de conexões', async () => {
    const response = await handleIntegration(
      new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
          token_endpoint_auth_method: 'none',
        }),
      }),
      {},
    );

    const medicao = response.headers.get('x-ideworks-db');
    // Registrar cliente não toca no banco: zero conexões é a resposta certa,
    // e serve de prova de que a contagem não inventa número.
    expect(medicao).toMatch(/^conns=0; closed=0; db=0ms; req=\d+ms; parts=-$/);
    // O corpo continua chegando inteiro — o cabeçalho não consome o fluxo.
    expect(response.status).toBeLessThan(300);
    expect(((await response.json()) as { client_id?: string }).client_id).toBeTruthy();
  });

  it('não vaza token, cookie nem conteúdo', async () => {
    const response = await handleIntegration(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { authorization: 'Bearer segredo-do-token', cookie: 'sessao=segredo' },
        body: '{}',
      }),
      {},
    );

    const medicao = response.headers.get('x-ideworks-db') ?? '';
    expect(medicao).not.toContain('segredo');
    expect(medicao).toMatch(/^conns=\d+; closed=\d+; db=\d+ms; req=\d+ms; parts=/);
  });
});

/**
 * F23 — A REDE DE CONTENÇÃO DE ÚLTIMO NÍVEL.
 *
 * Em 22/09/2026 `add_comment` gravava o comentário e devolvia `502 Bad
 * gateway`: o erro nascia fora do handler MCP, não havia `try/catch` de último
 * nível, e a borda da Cloudflare respondia com a própria página — sem corpo
 * JSON, sem `X-Request-Id`, sem `x-ideworks-db`. Estes testes provam que um
 * erro inesperado deixa de escapar.
 */
describe('rede de contenção de último nível', () => {
  /**
   * Um KV que explode do jeito que ninguém previu — o caso que a rede existe
   * para pegar. Ele LÊ normalmente (senão o servidor nem se monta) e falha na
   * gravação, que é onde uma falha de plataforma de verdade aparece.
   */
  class KvQueExplode implements ProofKv {
    async get(): Promise<string | null> {
      return null;
    }
    async put(): Promise<void> {
      throw new Error('detalhe interno: senha=hunter2 no host 10.0.0.7');
    }
    async delete(): Promise<void> {
      throw new Error('detalhe interno: senha=hunter2 no host 10.0.0.7');
    }
    async list(): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }> {
      throw new Error('detalhe interno: senha=hunter2 no host 10.0.0.7');
    }
  }

  async function explodir(): Promise<Response> {
    return handleIntegration(
      new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'prova-f23' },
        body: JSON.stringify({
          client_name: 'Claude',
          redirect_uris: [PROOF_REDIRECT_URI],
          token_endpoint_auth_method: 'none',
        }),
      }),
      { OAUTH_KV: new KvQueExplode() },
    );
  }

  it('erro inesperado vira 500 JSON com o id da requisição, e não escapa', async () => {
    const response = await explodir();

    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('prova-f23');
    // A medição sobrevive à falha: saber quantas conexões a requisição abriu é
    // justamente o que se quer quando algo estoura.
    expect(response.headers.get('x-ideworks-db')).toMatch(/^conns=\d+; closed=\d+;/);

    const body = (await response.json()) as { error?: string; message?: string; requestId?: string };
    expect(body.error).toBe('internal');
    expect(body.requestId).toBe('prova-f23');
    expect(body.message).toMatch(/Falha inesperada/i);
  });

  it('a mensagem não leva detalhe interno nenhum', async () => {
    const texto = await (await explodir()).text();
    expect(texto).not.toContain('hunter2');
    expect(texto).not.toContain('10.0.0.7');
    expect(texto).not.toContain('senha');
    expect(texto.toLowerCase()).not.toContain('stack');
    expect(texto).not.toContain('at ');
  });

  it('prazo e indisponibilidade continuam com os códigos deles', async () => {
    // A rede não pode engolir o que já funcionava: 504 e 503 são traduções
    // deliberadas, e continuam nascendo antes dela.
    const fonte = readFileSync(join(AQUI, 'handler.ts'), 'utf8');
    const rede = fonte.slice(
      fonte.indexOf('function redeDeContencao('),
      fonte.indexOf('export async function handleIntegration('),
    );
    expect(rede).toMatch(/DeadlineExceededError[\s\S]*deadlineResponse/);
    expect(rede).toMatch(/IntegrationUnavailableError[\s\S]*unavailableResponse/);
  });

  it('o wrangler.toml liga a observabilidade — sem ela o 500 não tem pilha para ler', () => {
    const wrangler = readFileSync(join(AQUI, '../../wrangler.toml'), 'utf8');
    expect(wrangler).toMatch(/\[observability\]\nenabled = true\nhead_sampling_rate = 1/);
  });

  it('o fetch do Worker também tem rede — o site e a /api humana não caem na borda', () => {
    const worker = readFileSync(join(AQUI, '../../worker/index.ts'), 'utf8');
    expect(worker).toContain('redeDeContencaoDoWorker');
    expect(worker).toMatch(/return await atenderRequisicao\(request, env, ctx\);\s*\} catch/);
  });
});

/**
 * O GET no `/mcp` é o canal de avisos do servidor, que este servidor não tem.
 *
 * Em 22/09/2026 o claude.ai abria esse canal a cada ~3 s: cada GET passava pelo
 * portão (concessão, pessoa, freio), carregava o catálogo do banco e ficava
 * ~4,4 s aberto sem dizer nada — e gastava 20 das 60 chamadas por minuto da
 * concessão. A especificação do MCP manda responder 405 quando não há canal.
 */
describe('GET no /mcp', () => {
  it('responde 405 sem abrir canal e sem gastar a cota do freio', async () => {
    const { server, access } = await fullGrant({ resource: MCP });
    const get = () =>
      server.fetch(
        new Request(MCP, {
          method: 'GET',
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${access}` },
        }),
      );

    const primeira = await get();
    expect(primeira.status).toBe(405);
    expect(primeira.headers.get('Allow')).toBe('POST');

    // 70 GETs: mais que as 60 chamadas por minuto da concessão.
    for (let i = 0; i < 69; i += 1) expect((await get()).status).toBe(405);

    const call = await server.fetch(
      mcpPost(access, 'tools/call', { name: 'get_context', arguments: {} }, 3),
    );
    expect(call.status).toBe(200);
  });

  it('sem token continua 401 — o cliente precisa descobrir o OAuth', async () => {
    const server = await createServer();
    const response = await server.fetch(new Request(MCP, { method: 'GET' }));
    expect(response.status).toBe(401);
  });
});

describe('[f37b] "Marcar todas" e "Limpar" na tela de autorização', () => {
  async function paginaHtml(): Promise<{ server: IntegrationServer; page: string }> {
    const server = await createServer();
    const { challenge } = await pkce();
    const resposta = await server.fetch(
      new Request(authorizeUrl(server.clientId, challenge).toString(), {
        headers: { Cookie: `${HUMAN_SESSION}=human-ok`, Accept: 'text/html' },
      }),
    );
    expect(resposta.status).toBe(200);
    return { server, page: await resposta.text() };
  }

  it('a página tem os dois botões type="button", ocultos até o script ligar, e as 14 caixas', async () => {
    const { page } = await paginaHtml();
    expect(page).toMatch(/<button type="button"[^>]*id="marcar-todas"[^>]*aria-label="[^"]+"[^>]*>Marcar todas<\/button>/);
    expect(page).toMatch(/<button type="button"[^>]*id="limpar-capacidades"[^>]*aria-label="[^"]+"[^>]*>Limpar<\/button>/);
    // Sem JavaScript os botões ficam ocultos: nada de botão morto.
    expect(page).toMatch(/id="acoes-capacidades" hidden/);
    // O único submit é o "Autorizar".
    expect(page.match(/<button type="submit"/g)).toHaveLength(1);
    expect([...page.matchAll(/data-capability="([a-z:]+)"/g)]).toHaveLength(INTEGRATION_CAPABILITIES.length);
    expect(page.match(/name="capability"/g)).toHaveLength(14);
    // As caixas seguem a ordem do servidor, e o selo de escrita vem de WRITE_CAPABILITIES.
    const ordem = [...page.matchAll(/data-capability="([a-z:]+)">/g)].map((m) => m[1]);
    expect(ordem).toEqual([...INTEGRATION_CAPABILITIES]);
    expect(page.match(/class="selo altera"/g)).toHaveLength(WRITE_CAPABILITIES.length);
  });

  it('o nome do cliente OAuth com HTML sai escapado, na tela e na recusa', () => {
    const payload = consentPayload({
      clientId: 'c1',
      clientName: '<img src=x onerror=alert(1)>',
      csrf: 'tok',
      person: PERSON,
    });
    const pagina = consentHtml(payload);
    expect(pagina).not.toContain('<img src=x');
    expect(pagina).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(capabilitiesRefusalHtml('<b>x</b>')).not.toContain('<b>x</b>');
  });

  it('as 14 capacidades marcadas de uma vez são aceitas pelo servidor', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const payload = await parseJson(page);
    const cookies = mergeCookies(withSession, page);
    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      capabilities: [...INTEGRATION_CAPABILITIES],
    });
    expect(posted.status).toBe(302);
    const grants = liveGrants(server);
    expect(grants).toHaveLength(1);
    expect([...grants[0].capabilities].sort()).toEqual([...INTEGRATION_CAPABILITIES].sort());
  });

  it('a escrita sem a leitura continua recusada', async () => {
    const server = await createServer();
    const pair = await pkce();
    const started = await startAuthorize(server, { challenge: pair.challenge });
    const withSession = `${started.cookies}; ${HUMAN_SESSION}=human-ok`;
    const page = await consentGet(server, withSession, pair.challenge);
    const payload = await parseJson(page);
    const cookies = mergeCookies(withSession, page);
    const posted = await consentPost(server, cookies, {
      csrf: csrfFrom(cookies, payload),
      capabilities: ['tasks:write'],
    });
    expect(posted.status).toBe(400);
    expect(liveGrants(server)).toEqual([]);
  });
});
