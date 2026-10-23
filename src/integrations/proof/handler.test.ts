import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  LATEST_PROTOCOL_VERSION,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  PROOF_REDIRECT_URI,
  PROOF_SCOPE,
  SYNTHETIC_SUBJECT,
  createAgentProof,
  memoryKvOf,
  isAgentProofPath,
  type AgentProof,
} from '@/integrations/proof/handler';

const ORIGIN = 'https://ideworks.test';
const MCP = `${ORIGIN}/mcp`;
const OTHER_ORIGIN = 'https://other.test';

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

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function issueTokens(
  proof: AgentProof,
  options?: {
    origin?: string;
    redirectUri?: string;
    verifier?: string;
    challenge?: string;
    clientId?: string;
  },
): Promise<{ access_token: string; refresh_token: string; token_type: string }> {
  const origin = options?.origin ?? ORIGIN;
  const redirectUri = options?.redirectUri ?? PROOF_REDIRECT_URI;
  const clientId = options?.clientId ?? proof.clientId;
  const pair = options?.verifier
    ? { verifier: options.verifier, challenge: options.challenge ?? '' }
    : await pkce();

  const authorize = new URL('/oauth/authorize', origin);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('code_challenge', pair.challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', 'prova-state');
  authorize.searchParams.set('scope', PROOF_SCOPE);
  authorize.searchParams.set('resource', `${origin}/mcp`);

  const granted = await proof.fetch(new Request(authorize.toString()));
  expect(granted.status).toBe(302);
  const location = granted.headers.get('Location');
  expect(location).toBeTruthy();
  const redirected = new URL(location!);
  expect(redirected.searchParams.get('error')).toBeNull();
  const code = redirected.searchParams.get('code');
  expect(code).toBeTruthy();
  expect(redirected.searchParams.get('iss')).toBe(origin);

  const tokenRes = await proof.fetch(
    new Request(new URL('/oauth/token', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: pair.verifier,
        resource: `${origin}/mcp`,
      }),
    }),
  );
  expect(tokenRes.status).toBe(200);
  const body = await parseJson(tokenRes);
  expect(typeof body.access_token).toBe('string');
  expect(typeof body.refresh_token).toBe('string');
  return body as { access_token: string; refresh_token: string; token_type: string };
}

function mcpPost(
  origin: string,
  token: string | null,
  message: unknown,
  protocolVersion = LATEST_PROTOCOL_VERSION,
): Request {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': protocolVersion,
  });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request(`${origin}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
}

async function rawRpc(
  proof: AgentProof,
  token: string,
  method: string,
  params: unknown,
  id: number,
  protocolVersion = LATEST_PROTOCOL_VERSION,
  origin = ORIGIN,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await proof.fetch(mcpPost(origin, token, { jsonrpc: '2.0', id, method, params }, protocolVersion));
  return { status: response.status, body: await parseJson(response) };
}

describe('descoberta OAuth e recorte das rotas', () => {
  it('MCP e OAuth ficam fora de /api e fora do HTML do site', () => {
    expect(isAgentProofPath('/mcp')).toBe(true);
    expect(isAgentProofPath('/oauth/token')).toBe(true);
    expect(isAgentProofPath('/.well-known/oauth-authorization-server')).toBe(true);
    expect(isAgentProofPath('/.well-known/oauth-protected-resource/mcp')).toBe(true);
    expect(isAgentProofPath('/api/health')).toBe(false);
    expect(isAgentProofPath('/painel')).toBe(false);
  });

  it('publica metadata do recurso e do servidor de autorização', async () => {
    const proof = await createAgentProof();
    const resource = await proof.fetch(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
    expect(resource.status).toBe(200);
    const resourceBody = await parseJson(resource);
    expect(resourceBody.resource).toBe(MCP);
    expect(resourceBody.authorization_servers).toEqual([ORIGIN]);

    const as = await proof.fetch(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
    expect(as.status).toBe(200);
    const asBody = await parseJson(as);
    expect(asBody.issuer).toBe(ORIGIN);
    expect(asBody.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(asBody.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(asBody.code_challenge_methods_supported).toEqual(['S256']);
    expect(asBody.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
  });

  it('MCP sem token devolve 401 com ponteiro para o metadata do recurso', async () => {
    const proof = await createAgentProof();
    const response = await proof.fetch(new Request(MCP, { method: 'POST' }));
    expect(response.status).toBe(401);
    const challenge = response.headers.get('WWW-Authenticate') ?? '';
    expect(challenge).toMatch(/resource_metadata=/);
    expect(challenge).toContain('oauth-protected-resource');
  });
});

describe('PKCE, callback e renovação', () => {
  it('redirect_uri não cadastrado não conclui a autorização', async () => {
    const proof = await createAgentProof();
    const { challenge } = await pkce();
    const authorize = new URL('/oauth/authorize', ORIGIN);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', proof.clientId);
    authorize.searchParams.set('redirect_uri', 'https://evil.test/callback');
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('resource', MCP);

    const response = await proof.fetch(new Request(authorize.toString()));
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
    expect(await response.text()).toMatch(/redirect/i);
    expect(proof.grants instanceof Object).toBe(true);
    expect([...(proof.grants as unknown as { grants: Map<string, unknown> }).grants.keys()]).toEqual([]);
  });

  it('verificador PKCE incorreto não troca o código por token', async () => {
    const proof = await createAgentProof();
    const { challenge } = await pkce();
    const other = await pkce();
    const authorize = new URL('/oauth/authorize', ORIGIN);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', proof.clientId);
    authorize.searchParams.set('redirect_uri', PROOF_REDIRECT_URI);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('state', 'x');
    authorize.searchParams.set('resource', MCP);

    const granted = await proof.fetch(new Request(authorize.toString()));
    const code = new URL(granted.headers.get('Location')!).searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenRes = await proof.fetch(
      new Request(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: PROOF_REDIRECT_URI,
          client_id: proof.clientId,
          code_verifier: other.verifier,
          resource: MCP,
        }),
      }),
    );
    expect(tokenRes.status).toBeGreaterThanOrEqual(400);
    const body = await parseJson(tokenRes);
    expect(body.error).toBeTruthy();
    expect(body.access_token).toBeUndefined();
  });

  it('renova o acesso com refresh_token rotacionado', async () => {
    const proof = await createAgentProof();
    const issued = await issueTokens(proof);
    const refreshed = await proof.fetch(
      new Request(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: issued.refresh_token,
          client_id: proof.clientId,
          resource: MCP,
        }),
      }),
    );
    expect(refreshed.status).toBe(200);
    const body = await parseJson(refreshed);
    expect(typeof body.access_token).toBe('string');
    expect(body.access_token).not.toBe(issued.access_token);
    expect(typeof body.refresh_token).toBe('string');

    const call = await rawRpc(proof, String(body.access_token), 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'refresh-client', version: '0' },
    }, 1);
    expect(call.status).toBe(200);
    expect(call.body.result).toBeTruthy();
  });
});

describe('token ausente, expirado e de outra audiência', () => {
  it('Bearer de sessão humana (JWT) não autentica o MCP', async () => {
    const proof = await createAgentProof();
    const fakeSession =
      'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c3VhcmlvLWh1bWFubyIsImlzcyI6InN1cGFiYXNlIn0.';
    const response = await proof.fetch(mcpPost(ORIGIN, fakeSession, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    expect(response.status).toBe(401);
  });

  it('token apagado do armazenamento (expirado/revogado) é recusado', async () => {
    const proof = await createAgentProof();
    const issued = await issueTokens(proof);
    memoryKvOf(proof).expireStoredTokens();
    const response = await proof.fetch(
      mcpPost(ORIGIN, issued.access_token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'expired', version: '0' },
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('token emitido para outro recurso não abre este MCP', async () => {
    const proof = await createAgentProof();
    const issued = await issueTokens(proof, { origin: OTHER_ORIGIN });
    const response = await proof.fetch(
      mcpPost(ORIGIN, issued.access_token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'wrong-aud', version: '0' },
        },
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe('dois clientes distintos leem o contexto real da concessão', () => {
  it('cliente HTTP Streamable cru autoriza, lê e não encontra escrita', async () => {
    const proof = await createAgentProof();
    const issued = await issueTokens(proof);
    const started = performance.now();

    const init = await rawRpc(proof, issued.access_token, 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'http-cru', version: '0.0.1' },
    }, 1);
    expect(init.status).toBe(200);
    const initResult = init.body.result as { protocolVersion?: string };
    expect(initResult.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);

    await proof.fetch(
      mcpPost(ORIGIN, issued.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' }),
    );

    const listed = await rawRpc(proof, issued.access_token, 'tools/list', {}, 2);
    const tools = (listed.body.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(tools).toContain('get_context');
    expect(tools).toContain('add_comment');
    expect(tools).toContain('move_task');
    expect(tools).toContain('preview_move');

    const read = await rawRpc(proof, issued.access_token, 'tools/call', { name: 'get_context', arguments: {} }, 3);
    const elapsedMs = performance.now() - started;
    const bytes = new TextEncoder().encode(JSON.stringify(read.body)).length;
    console.info('[f16.0] leitura get_context http-cru', { elapsedMs: Math.round(elapsedMs), bytes });
    expect(read.status).toBe(200);
    const readResult = read.body.result as {
      content: Array<{ text: string }>;
      isError?: boolean;
      structuredContent?: { operation?: string; owner?: { id: string } };
    };
    expect(readResult.isError).toBeFalsy();
    expect(readResult.structuredContent?.operation).toBe('get_context');
    expect(readResult.structuredContent?.owner?.id).toBe(SYNTHETIC_SUBJECT.id);
    expect(elapsedMs).toBeLessThan(2000);
    expect(bytes).toBeGreaterThan(40);

    const write = await rawRpc(
      proof,
      issued.access_token,
      'tools/call',
      { name: 'add_comment', arguments: { taskId: '33333333-3333-4333-8333-333333333333', body: 'não deve gravar', idempotencyKey: 'idem-prova' } },
      4,
    );
    const writeResult = write.body.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(writeResult.isError).toBe(true);
    expect(writeResult.content[0].text).toMatch(/permission_denied/);
    expect(writeResult.content[0].text).not.toMatch(/"operation"\s*:/);
  });

  it('SDK MCP oficial autoriza e executa a mesma leitura', async () => {
    const proof = await createAgentProof();
    const issued = await issueTokens(proof);
    /* O PRAZO É DO SERVIDOR — conferência de 09/10. O cliente oficial compila,
       ao listar, o `outputSchema` de cada ferramenta (ajv); com 38 ferramentas
       isso sozinho levava ~1 s numa máquina ocupada e passava dos 2 s sob carga,
       sem nada mudar do nosso lado (o cliente cru, acima, mede 44 ms). Conta-se o
       tempo dentro de `proof.fetch` — o que o servidor gasta —, e o total segue
       no registro. */
    let tempoNoServidorMs = 0;
    const transport = new StreamableHTTPClientTransport(new URL(MCP), {
      requestInit: { headers: { Authorization: `Bearer ${issued.access_token}` } },
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const inicio = performance.now();
        try {
          return await proof.fetch(request);
        } finally {
          tempoNoServidorMs += performance.now() - inicio;
        }
      },
    });
    const client = new Client({ name: 'sdk-oficial', version: '0.0.1' });
    const started = performance.now();
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('get_context');
    expect(tools.tools.map((tool) => tool.name)).toContain('add_comment');
    expect(tools.tools.map((tool) => tool.name)).toContain('move_task');
    const result = await client.callTool({ name: 'get_context', arguments: {} });
    const elapsedMs = performance.now() - started;
    const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
    console.info('[f16.0] leitura get_context sdk-oficial', {
      elapsedMs: Math.round(elapsedMs),
      servidorMs: Math.round(tempoNoServidorMs),
      bytes,
    });
    expect(result.isError).toBeFalsy();
    const body = result.structuredContent as { operation?: string; owner?: { id: string } };
    expect(body.operation).toBe('get_context');
    expect(body.owner?.id).toBe(SYNTHETIC_SUBJECT.id);
    expect(tempoNoServidorMs).toBeLessThan(2000);
    expect(bytes).toBeGreaterThan(40);
    await client.close();
  });
});

describe('negociação de protocolo 2025', () => {
  it.each([LATEST_PROTOCOL_VERSION, DEFAULT_NEGOTIATED_PROTOCOL_VERSION, '2025-06-18'] as const)(
    'aceita initialize com %s',
    async (version) => {
      const proof = await createAgentProof();
      const issued = await issueTokens(proof);
      const init = await rawRpc(
        proof,
        issued.access_token,
        'initialize',
        {
          protocolVersion: version,
          capabilities: {},
          clientInfo: { name: 'protocolo', version: '0' },
        },
        1,
        version,
      );
      expect(init.status).toBe(200);
      const negotiated = (init.body.result as { protocolVersion: string }).protocolVersion;
      expect(['2025-11-25', '2025-06-18', '2025-03-26']).toContain(negotiated);
    },
  );
});
