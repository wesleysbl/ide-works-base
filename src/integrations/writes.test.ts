/**
 * Comentários e movimentos por agentes — F16.7 + F16.8.
 *
 * Port injetável (memória). A suíte não fala com o banco. OpenAPI = Zod.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  ADD_COMMENT_PATH,
  GET_CONTEXT_PATH,
  INTEGRATION_WRITES_UNAVAILABLE_MESSAGE,
  MOVE_TASK_PATH,
  PREVIEW_MOVE_PATH,
  addCommentInputSchema,
  addCommentOpenApiExample,
  addCommentResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
  moveTaskInputSchema,
  moveTaskOpenApiExample,
  moveTaskResponseSchema,
  previewMoveInputSchema,
  previewMoveOpenApiExample,
  previewMoveResponseSchema,
  statusChoiceRequiredSchema,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { MemoryAgentWriteStore, hashWriteParams } from '@/integrations/executions';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { handleMcpRequest, MCP_READ_TOOL_NAMES, MCP_TOOL_NAMES } from '@/integrations/mcp';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { MemoryWorkCatalog } from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';
import {
  COMMENT_BODY_MAX_BYTES,
  MemoryCommentBoard,
  MemoryMoveBoard,
  addCommentWork,
  mentionedPeople,
  moveTaskWork,
  previewMoveWork,
} from '@/integrations/writes';

const agora = new Date('2026-09-21T06:00:00.000Z');
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const PARENT_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_PARENT = '55555555-5555-4555-8555-555555555555';
const OTHER_TASK = '66666666-6666-4666-8666-666666666666';
const MENTION_OK = '77777777-7777-4777-8777-777777777777';
const MENTION_OUT = '88888888-8888-4888-8888-888888888888';
const KEY = 'idem-comentario-1';
const ORIGIN = 'https://ideworks.test';
const LIST_ORIGIN = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const LIST_DEST = 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2';
const LIST_OUT = 'aaaaaaa3-aaa3-4aa3-8aa3-aaaaaaaaaaa3';
const LIST_MISSING = 'aaaaaaa4-aaa4-4aa4-8aa4-aaaaaaaaaaa4';
const ST_REF_O = 'bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1';
const ST_APROV_O = 'bbbbbbb7-bbb7-4bb7-8bb7-bbbbbbbbbbb7';
const ST_REF_D = 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2';
const ST_TODO_D = 'bbbbbbb3-bbb3-4bb3-8bb3-bbbbbbbbbbb3';
const ST_APROV_D = 'bbbbbbb4-bbb4-4bb4-8bb4-bbbbbbbbbbb4';
const ST_CLOSED_D = 'bbbbbbb5-bbb5-4bb5-8bb5-bbbbbbbbbbb5';
const ST_OUT = 'bbbbbbb6-bbb6-4bb6-8bb6-bbbbbbbbbbb6';
const MOVE_ID = 'ccccccc1-ccc1-4cc1-8cc1-ccccccccccc1';
const MOVE_CHILD = 'ccccccc2-ccc2-4cc2-8cc2-ccccccccccc2';
const MOVE_KEY = 'idem-movimento-1';

const person: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a'],
  clientIds: ['cliente-a'],
  hasAllClientsAccess: false,
};

const writeGrant: IntegrationGrant = {
  id: GRANT_ID,
  ownerId: OWNER_ID,
  oauthClientId: 'ideworks-claude',
  name: 'Claude da agência',
  capabilities: [...READ_CAPABILITIES, 'comments:write'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const readGrant: IntegrationGrant = {
  ...writeGrant,
  capabilities: [...READ_CAPABILITIES],
};

const moveGrant: IntegrationGrant = {
  ...writeGrant,
  capabilities: [...READ_CAPABILITIES, 'comments:write', 'tasks:move'],
};

function mention(id: string, name = 'Helena'): string {
  return `@[${name}](mention:${id})`;
}

function seeded() {
  const store = new MemoryAgentWriteStore();
  store.seedPerson(person);
  store.seedGrant(writeGrant);
  const comments = new MemoryCommentBoard(OWNER_ID, {
    comments: [
      { id: PARENT_ID, taskId: TASK_ID, parentId: null, body: 'pai', authorId: OWNER_ID },
      { id: OTHER_PARENT, taskId: OTHER_TASK, parentId: null, body: 'outra tarefa', authorId: OWNER_ID },
    ],
    mentionable: new Map([[TASK_ID, [MENTION_OK]]]),
    taskCompanies: new Map([
      [TASK_ID, 'empresa-a'],
      [OTHER_TASK, 'empresa-a'],
    ]),
    taskClients: new Map([
      [TASK_ID, 'cliente-a'],
      [OTHER_TASK, 'cliente-a'],
    ]),
    peopleCompanies: new Map([[MENTION_OK, ['empresa-a']]]),
  });
  return { store, comments };
}

function ctx(extra: Partial<Parameters<typeof addCommentWork>[0]> = {}) {
  const { store, comments } = seeded();
  return {
    ports: { store, comments },
    ctx: {
      grant: writeGrant,
      person,
      origin: 'http' as const,
      store,
      comments,
      now: agora,
      ...extra,
    },
  };
}

const CATALOG = new MemoryCatalog(
  [{ id: 'empresa-a', name: 'Agência Ide' }],
  new Map([[OWNER_ID, 'Wesley Lourenço']]),
);

function adapters(
  grant: IntegrationGrant,
  store: MemoryAgentWriteStore,
  comments: MemoryCommentBoard,
  board?: MemoryMoveBoard,
) {
  store.seedPerson(person);
  store.seedGrant(grant);
  const shared = {
    grant,
    person,
    catalog: CATALOG,
    work: new MemoryWorkCatalog(),
    delivery: new MemoryDeliveryCatalog(),
    marketing: new MemoryMarketingCatalog(),
    writes: store,
    comments,
    board,
    displayNameFallback: 'Wesley Lourenço',
    now: agora,
  };
  return shared;
}

function mcpPost(method: string, params: unknown, id = 1): Request {
  return new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('contrato OpenAPI = Zod', () => {
  it('o documento descreve os mesmos campos do schema Zod', () => {
    const doc = integrationOpenApi();
    const schemas = (
      doc.components as {
        schemas: {
          AddCommentInput: unknown;
          AddCommentResponse: unknown;
          PreviewMoveInput: unknown;
          PreviewMoveResponse: unknown;
          MoveTaskInput: unknown;
          MoveTaskResponse: unknown;
        };
      }
    ).schemas;
    expect(schemas.AddCommentInput).toEqual(jsonSchemaFromZod(addCommentInputSchema));
    expect(schemas.AddCommentResponse).toEqual(jsonSchemaFromZod(addCommentResponseSchema));
    expect(schemas.PreviewMoveInput).toEqual(jsonSchemaFromZod(previewMoveInputSchema));
    expect(schemas.PreviewMoveResponse).toEqual(jsonSchemaFromZod(previewMoveResponseSchema));
    expect(schemas.MoveTaskInput).toEqual(jsonSchemaFromZod(moveTaskInputSchema));
    expect(schemas.MoveTaskResponse).toEqual(jsonSchemaFromZod(moveTaskResponseSchema));
    expect(addCommentResponseSchema.parse(addCommentOpenApiExample()).operation).toBe('add_comment');
    expect(previewMoveResponseSchema.parse(previewMoveOpenApiExample()).operation).toBe('preview_move');
    expect(moveTaskResponseSchema.parse(moveTaskOpenApiExample()).operation).toBe('move_task');
    expect(JSON.stringify(addCommentOpenApiExample())).not.toMatch(/Arte pronta/);
    const paths = doc.paths as Record<string, { post?: unknown; get?: unknown }>;
    expect(paths['/add_comment'].post).toBeTruthy();
    expect(paths['/add_comment'].get).toBeUndefined();
    expect(paths['/preview_move'].post).toBeTruthy();
    expect(paths['/preview_move'].get).toBeUndefined();
    expect(paths['/move_task'].post).toBeTruthy();
    expect(paths['/move_task'].get).toBeUndefined();
  });

  it('approved do modelo é recusado pelo schema estrito de move_task', () => {
    const parsed = moveTaskInputSchema.safeParse({
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: { listId: LIST_ORIGIN, statusId: ST_REF_O },
      idempotencyKey: MOVE_KEY,
      approved: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('authorId é recusado pelo schema estrito', () => {
    const parsed = addCommentInputSchema.safeParse({
      taskId: TASK_ID,
      body: 'ok na arte',
      idempotencyKey: KEY,
      authorId: 'outro',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('add_comment', () => {
  it('comentário simples identifica a integração e não guarda o body no ledger', async () => {
    const { ctx: input, ports } = ctx();
    const result = await addCommentWork(input, {
      taskId: TASK_ID,
      body: 'ok na arte',
      idempotencyKey: KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.commentId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.body.taskId).toBe(TASK_ID);
    expect(result.body.parentId).toBeNull();
    expect(result.body.replay).toBe(false);
    expect(result.body.actedAs).toEqual({
      ownerId: OWNER_ID,
      integrationId: GRANT_ID,
      integrationName: 'Claude da agência',
    });
    expect(JSON.stringify(result.body)).not.toContain('ok na arte');
    expect(result.body).not.toHaveProperty('task');
    const posted = [...ports.comments.comments.values()].find((row) => row.id === result.body.commentId);
    expect(posted?.authorId).toBe(OWNER_ID);
    expect(posted?.taskId).toBe(TASK_ID);
    expect(posted?.body).toBe('ok na arte');
    expect(ports.comments.mutations).toBe(1);
    const ledger = [...ports.store.executions.values()];
    expect(ledger).toHaveLength(1);
    expect(ledger[0].targetId).toBe(TASK_ID);
    expect(ledger[0].result).not.toHaveProperty('body');
    expect(ledger[0].changes).not.toHaveProperty('body');
    expect(JSON.stringify(ledger[0])).not.toContain('ok na arte');
  });

  it('resposta válida herda a tarefa do pai', async () => {
    const { ctx: input, ports } = ctx();
    const result = await addCommentWork(input, {
      taskId: TASK_ID,
      body: 'concordo',
      parentId: PARENT_ID,
      idempotencyKey: 'idem-resposta',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.parentId).toBe(PARENT_ID);
    expect(result.body.taskId).toBe(TASK_ID);
    expect(ports.comments.mutations).toBe(1);
  });

  it('resposta para comentário de outra tarefa é state_conflict', async () => {
    const { ctx: input, ports } = ctx();
    const result = await addCommentWork(input, {
      taskId: TASK_ID,
      body: 'não deveria',
      parentId: OTHER_PARENT,
      idempotencyKey: 'idem-outra',
    });
    expect(result).toMatchObject({ ok: false, code: 'state_conflict' });
    expect(ports.comments.mutations).toBe(0);
    expect([...ports.store.executions.values()]).toHaveLength(0);
  });

  it('replay da mesma chave não duplica mutação nem aviso', async () => {
    const { ctx: input, ports } = ctx();
    const first = await addCommentWork(input, {
      taskId: TASK_ID,
      body: mention(MENTION_OK),
      idempotencyKey: KEY,
    });
    const second = await addCommentWork(input, {
      taskId: TASK_ID,
      body: mention(MENTION_OK),
      idempotencyKey: KEY,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.body.replay).toBe(true);
    expect(second.body.commentId).toBe(first.body.commentId);
    expect(second.body.executionId).toBe(first.body.executionId);
    expect(ports.comments.mutations).toBe(1);
    expect(ports.comments.notifications).toEqual([MENTION_OK]);
  });

  it('menção fora do alcance recusa e não notifica — o banco humano também recusa (sync_text_mentions)', async () => {
    expect(mentionedPeople(mention(MENTION_OUT))).toEqual([MENTION_OUT]);
    const { ctx: input, ports } = ctx();
    const result = await addCommentWork(input, {
      taskId: TASK_ID,
      body: `oi ${mention(MENTION_OUT)}`,
      idempotencyKey: 'idem-mencao',
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'invalid_input',
      message: expect.stringMatching(/não tem acesso à tarefa/i),
    });
    expect(ports.comments.mutations).toBe(0);
    expect(ports.comments.notifications).toEqual([]);
  });

  it('corpo vazio e teto da conversa', async () => {
    const { ctx: input } = ctx();
    expect(
      await addCommentWork(input, { taskId: TASK_ID, body: '   ', idempotencyKey: 'vazio' }),
    ).toMatchObject({ ok: false, code: 'invalid_input' });
    const huge = 'x'.repeat(COMMENT_BODY_MAX_BYTES + 1);
    expect(
      await addCommentWork(input, { taskId: TASK_ID, body: huge, idempotencyKey: 'grande' }),
    ).toMatchObject({ ok: false, code: 'payload_too_large' });
  });
});

/**
 * Auditoria de 08/10/2026 — `add_comment` só conferia a capacidade. Uma
 * concessão recortada para a empresa A / cliente A comentava em tarefa da
 * empresa B, e a menção avisava gente de fora do recorte.
 */
describe('add_comment respeita o recorte da concessão', () => {
  const TASK_B = '33333333-3333-4333-8333-3333333333bb';
  const TASK_A_OUTRO_CLIENTE = '33333333-3333-4333-8333-3333333333ac';
  const TASK_FANTASMA = '33333333-3333-4333-8333-3333333333ff';
  const P_DENTRO = '77777777-7777-4777-8777-7777777777aa';
  const P_FORA = '77777777-7777-4777-8777-7777777777bb';
  const pessoa: PersonAccess = {
    ...person,
    companyIds: ['empresa-a', 'empresa-b'],
    clientIds: ['cliente-a', 'cliente-b'],
    hasAllClientsAccess: true,
  };
  const recortada: IntegrationGrant = {
    ...writeGrant,
    allowedCompanyIds: ['empresa-a'],
    allowedClientIds: ['cliente-a'],
  };

  function montar() {
    const store = new MemoryAgentWriteStore();
    store.seedPerson(pessoa);
    store.seedGrant(recortada);
    const comments = new MemoryCommentBoard(OWNER_ID, {
      taskCompanies: new Map([
        [TASK_ID, 'empresa-a'],
        [TASK_A_OUTRO_CLIENTE, 'empresa-a'],
        [TASK_B, 'empresa-b'],
      ]),
      taskClients: new Map([
        [TASK_ID, 'cliente-a'],
        [TASK_A_OUTRO_CLIENTE, 'cliente-b'],
        [TASK_B, 'cliente-b'],
      ]),
      // Pelo alcance HUMANO do dono as duas podem ser mencionadas; é o
      // recorte da conexão que separa uma da outra.
      mentionable: new Map([[TASK_ID, [P_DENTRO, P_FORA]]]),
      peopleCompanies: new Map([
        [P_DENTRO, ['empresa-a']],
        [P_FORA, ['empresa-b']],
      ]),
    });
    const input = { grant: recortada, person: pessoa, origin: 'mcp' as const, store, comments, now: agora };
    return { store, comments, input };
  }

  it('tarefa de empresa fora da concessão: permission_denied, nada gravado', async () => {
    const { store, comments, input } = montar();
    const result = await addCommentWork(input, { taskId: TASK_B, body: 'oi', idempotencyKey: 'k-b' });
    expect(result).toMatchObject({
      ok: false,
      code: 'permission_denied',
      message: expect.stringMatching(/fora do recorte desta conexão/),
    });
    expect(comments.mutations).toBe(0);
    expect(store.executions.size).toBe(0);
  });

  it('tarefa de cliente fora da concessão, na empresa concedida: permission_denied', async () => {
    const { comments, input } = montar();
    const result = await addCommentWork(input, { taskId: TASK_A_OUTRO_CLIENTE, body: 'oi', idempotencyKey: 'k-c' });
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(comments.mutations).toBe(0);
  });

  it('tarefa que não existe (ou que o dono não enxerga): not_found', async () => {
    const { comments, input } = montar();
    const result = await addCommentWork(input, { taskId: TASK_FANTASMA, body: 'oi', idempotencyKey: 'k-f' });
    expect(result).toMatchObject({ ok: false, code: 'not_found' });
    expect(comments.mutations).toBe(0);
  });

  it('menção a pessoa fora do recorte: invalid_input, sem comentário e sem aviso', async () => {
    const { comments, input } = montar();
    const result = await addCommentWork(input, {
      taskId: TASK_ID,
      body: `oi ${mention(P_DENTRO)} e ${mention(P_FORA, 'Fora')}`,
      idempotencyKey: 'k-m',
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'invalid_input',
      message: expect.stringMatching(/não tem acesso à tarefa/i),
    });
    expect(comments.mutations).toBe(0);
    expect(comments.notifications).toEqual([]);
  });

  it('dentro do recorte comenta e avisa quem foi mencionado', async () => {
    const { comments, input } = montar();
    const result = await addCommentWork(input, {
      taskId: TASK_ID,
      body: `oi ${mention(P_DENTRO)}`,
      idempotencyKey: 'k-ok',
    });
    expect(result.ok).toBe(true);
    expect(comments.mutations).toBe(1);
    expect(comments.notifications).toEqual([P_DENTRO]);
  });
});

describe('adaptadores HTTP e MCP', () => {
  it('credencial só-leitura é permission_denied nos dois', async () => {
    const store = new MemoryAgentWriteStore();
    const comments = new MemoryCommentBoard(OWNER_ID);
    const shared = adapters(readGrant, store, comments);
    const http = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${ADD_COMMENT_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: TASK_ID, body: 'não deve gravar', idempotencyKey: KEY }),
      }),
    });
    expect(http.status).toBe(403);
    expect(await parseJson(http)).toMatchObject({ error: 'permission_denied' });

    const mcp = await handleMcpRequest({
      ...shared,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'add_comment',
        arguments: { taskId: TASK_ID, body: 'não deve gravar', idempotencyKey: KEY },
      }),
    });
    expect(mcp.status).toBe(200);
    const rpc = await parseJson(mcp);
    const result = rpc.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ error: 'permission_denied' });
    expect(comments.mutations).toBe(0);
  });

  it('HTTP publica comentário compacto com autoria', async () => {
    const { store, comments } = seeded();
    const shared = adapters(writeGrant, store, comments);
    const http = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${ADD_COMMENT_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
        body: JSON.stringify({ taskId: TASK_ID, body: 'ok na arte' }),
      }),
    });
    expect(http.status).toBe(200);
    const body = addCommentResponseSchema.parse(await parseJson(http));
    expect(body.actedAs.integrationName).toBe('Claude da agência');
    expect(body.actedAs.ownerId).toBe(OWNER_ID);
    expect(JSON.stringify(body)).not.toContain('ok na arte');
    expect(body).not.toHaveProperty('task');
    expect(comments.mutations).toBe(1);
  });

  it('MCP add_comment publica uma vez, compacto, sem authorId', async () => {
    const { store, comments } = seeded();
    const shared = adapters(writeGrant, store, comments);
    const mcp = await handleMcpRequest({
      ...shared,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'add_comment',
        arguments: { taskId: TASK_ID, body: 'ok na arte', idempotencyKey: KEY },
      }),
    });
    expect(mcp.status).toBe(200);
    const rpc = await parseJson(mcp);
    const tool = rpc.result as {
      isError?: boolean;
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
    };
    expect(tool.isError).toBeFalsy();
    const body = addCommentResponseSchema.parse(tool.structuredContent);
    expect(body.operation).toBe('add_comment');
    expect(body.taskId).toBe(TASK_ID);
    expect(body.actedAs.integrationName).toBe('Claude da agência');
    expect(body.actedAs.ownerId).toBe(OWNER_ID);
    expect(JSON.stringify(body)).not.toContain('ok na arte');
    expect(JSON.stringify(body)).not.toMatch(/authorId/i);
    expect(body).not.toHaveProperty('task');
    expect(tool.content[0].text).toMatch(/Claude da agência/);
    expect(comments.mutations).toBe(1);
    expect([...comments.comments.values()].filter((row) => row.body === 'ok na arte')).toHaveLength(1);
  });

  it('MCP publica preview_move read-only e move_task com escrita', async () => {
    const { store, comments } = seeded();
    const shared = adapters(moveGrant, store, comments, new MemoryMoveBoard());
    const listed = await handleMcpRequest({
      ...shared,
      origin: 'mcp',
      request: mcpPost('tools/list', {}, 2),
    });
    const tools = ((await parseJson(listed)).result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    const reads = tools.filter((tool) => (MCP_READ_TOOL_NAMES as readonly string[]).includes(String(tool.name)));
    expect(reads.every((tool) => (tool.annotations as { readOnlyHint?: boolean }).readOnlyHint === true)).toBe(true);
    const preview = tools.find((tool) => tool.name === 'preview_move');
    expect((preview?.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(true);
    const comment = tools.find((tool) => tool.name === 'add_comment');
    expect((comment?.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(false);
    const move = tools.find((tool) => tool.name === 'move_task');
    expect((move?.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(false);
  });

  it('escritas OFF recusam add_comment e move_task e mantêm preview_move e get_context', async () => {
    const store = new MemoryAgentWriteStore();
    const comments = new MemoryCommentBoard(OWNER_ID);
    const board = moveBoard();
    const shared = { ...adapters(moveGrant, store, comments, board), writesEnabled: false };
    const from = { listId: LIST_ORIGIN, statusId: ST_REF_O };
    const commentHttp = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${ADD_COMMENT_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: TASK_ID, body: 'não deve gravar', idempotencyKey: KEY }),
      }),
    });
    expect(commentHttp.status).toBe(503);
    expect(await parseJson(commentHttp)).toMatchObject({
      error: 'unavailable',
      message: INTEGRATION_WRITES_UNAVAILABLE_MESSAGE,
    });
    expect(comments.mutations).toBe(0);

    const moveHttp = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${MOVE_TASK_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: MOVE_ID,
          listId: LIST_DEST,
          from,
          idempotencyKey: MOVE_KEY,
        }),
      }),
    });
    expect(moveHttp.status).toBe(503);
    expect(await parseJson(moveHttp)).toMatchObject({ error: 'unavailable' });
    expect(board.mutations).toBe(0);

    const previewHttp = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${PREVIEW_MOVE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: MOVE_ID, listId: LIST_DEST, from }),
      }),
    });
    expect(previewHttp.status).toBe(200);
    expect((await parseJson(previewHttp)).operation).toBe('preview_move');
    expect(board.mutations).toBe(0);

    const contextHttp = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${GET_CONTEXT_PATH}`, { method: 'GET' }),
    });
    expect(contextHttp.status).toBe(200);
    expect((await parseJson(contextHttp)).operation).toBe('get_context');

    const mcpComment = await handleMcpRequest({
      ...shared,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'add_comment',
        arguments: { taskId: TASK_ID, body: 'não deve gravar', idempotencyKey: KEY },
      }),
    });
    const commentRpc = await parseJson(mcpComment);
    const commentTool = commentRpc.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(commentTool.isError).toBe(true);
    expect(JSON.parse(commentTool.content[0].text)).toMatchObject({ error: 'unavailable' });

    const mcpMove = await handleMcpRequest({
      ...shared,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'move_task',
        arguments: {
          taskId: MOVE_ID,
          listId: LIST_DEST,
          from,
          idempotencyKey: MOVE_KEY,
        },
      }),
    });
    const moveRpc = await parseJson(mcpMove);
    const moveTool = moveRpc.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(moveTool.isError).toBe(true);
    expect(JSON.parse(moveTool.content[0].text)).toMatchObject({ error: 'unavailable' });

    const mcpPreview = await handleMcpRequest({
      ...shared,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'preview_move',
        arguments: { taskId: MOVE_ID, listId: LIST_DEST, from },
      }),
    });
    const previewRpc = await parseJson(mcpPreview);
    const previewTool = previewRpc.result as { isError?: boolean; structuredContent?: { operation?: string } };
    expect(previewTool.isError).toBeFalsy();
    expect(previewTool.structuredContent?.operation).toBe('preview_move');
    expect(board.mutations).toBe(0);
  });
});

describe('store SQL abre uma withActor e põe sqlTx', () => {
  it('o gancho da F16.6b permanece: um withActor, sqlTx, sem segundo begin no miolo', () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const executions = readFileSync(join(raiz, 'src', 'integrations', 'executions.ts'), 'utf8');
    const writes = readFileSync(join(raiz, 'src', 'integrations', 'writes.ts'), 'utf8');
    const sqlStore = executions.slice(executions.indexOf('export function createSqlAgentWriteStore'));
    expect(sqlStore).toMatch(/withActor\s*\(/);
    expect(sqlStore).toMatch(/sqlLedger\s*\(\s*tx\s*\)/);
    expect(sqlStore.match(/withActor\s*\(/g)?.length).toBe(1);
    expect(writes).toContain('postCommentInTx');
    expect(writes).not.toMatch(/\bpostComment\s*\(/);
    expect(writes).toContain('moveTaskOnBoardInTx');
    expect(writes).not.toMatch(/\bmoveTaskOnBoard\s*\(/);
    expect(writes).toContain('decideWriteImpact');
  });
});

function originStatuses() {
  return [
    { id: ST_REF_O, name: 'Refação', type: 'custom' as const, color: null },
    { id: ST_APROV_O, name: 'Aprovação', type: 'custom' as const, color: null },
  ];
}

function destStatuses(noEquivalent = false) {
  if (noEquivalent) {
    return [
      { id: ST_TODO_D, name: 'na fila', type: 'open' as const, color: null },
      { id: ST_CLOSED_D, name: 'fim', type: 'closed' as const, color: null },
    ];
  }
  return [
    { id: ST_TODO_D, name: 'A FAZER', type: 'open' as const, color: null },
    { id: ST_REF_D, name: 'REFAÇÃO', type: 'custom' as const, color: null },
    { id: ST_APROV_D, name: 'Aprovação', type: 'custom' as const, color: null },
    { id: ST_CLOSED_D, name: 'Concluída', type: 'closed' as const, color: null },
  ];
}

function moveBoard(extra: {
  child?: boolean;
  automationOut?: boolean;
  automationIn?: boolean;
  noEquivalent?: boolean;
  currentStatus?: string;
} = {}) {
  const tasks: Array<{
    id: string;
    title: string;
    listId: string;
    statusId: string;
    parentId: string | null;
    clientId: string | null;
    companyId: string;
    completedAt: string | null;
  }> = [
    {
      id: MOVE_ID,
      title: 'Peça da campanha',
      listId: LIST_ORIGIN,
      statusId: extra.currentStatus ?? ST_REF_O,
      parentId: null,
      clientId: 'cliente-a',
      companyId: 'empresa-a',
      completedAt: null,
    },
  ];
  if (extra.child) {
    tasks.push({
      id: MOVE_CHILD,
      title: 'Subtarefa',
      listId: LIST_ORIGIN,
      statusId: ST_REF_O,
      parentId: MOVE_ID,
      clientId: 'cliente-a',
      companyId: 'empresa-a',
      completedAt: null,
    });
  }
  const automations = [];
  if (extra.automationOut) {
    automations.push({
      name: 'Encaminha para fora',
      sourceListId: LIST_DEST,
      triggerStatusId: ST_REF_D,
      targetListId: LIST_OUT,
      targetStatusId: ST_OUT,
    });
  }
  if (extra.automationIn) {
    automations.push({
      name: 'Encaminha na mesma empresa',
      sourceListId: LIST_DEST,
      triggerStatusId: ST_REF_D,
      targetListId: LIST_MISSING,
      targetStatusId: ST_TODO_D,
    });
  }
  return new MemoryMoveBoard({
    lists: [
      {
        id: LIST_ORIGIN,
        name: 'Atendimento',
        companyId: 'empresa-a',
        clientId: 'cliente-a',
        statuses: originStatuses(),
      },
      {
        id: LIST_DEST,
        name: 'Blue Sky',
        companyId: 'empresa-a',
        clientId: 'cliente-a',
        statuses: destStatuses(extra.noEquivalent),
      },
      {
        id: LIST_MISSING,
        name: 'Fila interna',
        companyId: 'empresa-a',
        clientId: 'cliente-a',
        statuses: destStatuses(true),
      },
      {
        id: LIST_OUT,
        name: 'Fora do recorte',
        companyId: 'empresa-b',
        clientId: 'cliente-b',
        statuses: [{ id: ST_OUT, name: 'Encaminhado', type: 'custom', color: null }],
      },
    ],
    tasks,
    automations,
  });
}

function moveCtx(board: MemoryMoveBoard, extra: Partial<Parameters<typeof moveTaskWork>[0]> = {}) {
  const store = new MemoryAgentWriteStore();
  store.seedPerson(person);
  store.seedGrant(moveGrant);
  const comments = new MemoryCommentBoard(OWNER_ID);
  return {
    ports: { store, comments, board },
    ctx: {
      grant: moveGrant,
      person,
      origin: 'http' as const,
      store,
      comments,
      board,
      now: agora,
      ...extra,
    },
  };
}

const seen = { listId: LIST_ORIGIN, statusId: ST_REF_O };

describe('preview_move e move_task', () => {
  it('movimento na mesma lista devolve destino compacto', async () => {
    const { ctx: input, ports } = moveCtx(moveBoard());
    const result = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_ORIGIN,
      statusId: ST_APROV_O,
      from: seen,
      idempotencyKey: MOVE_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      operation: 'move_task',
      taskId: MOVE_ID,
      listId: LIST_ORIGIN,
      statusId: ST_APROV_O,
      statusName: 'Aprovação',
      completed: false,
      reopened: false,
      subtasksMoved: 0,
      automation: null,
      replay: false,
    });
    expect(result.body).not.toHaveProperty('task');
    expect(result.body).not.toHaveProperty('title');
    expect(ports.board.writes).toEqual([[MOVE_ID, LIST_ORIGIN, ST_APROV_O]]);
    expect(ports.board.mutations).toBe(1);
    expect(ports.board.tasks.get(MOVE_ID)?.statusId).toBe(ST_APROV_O);
  });

  it('entre listas usa a etapa equivalente e não a primeira', async () => {
    const { ctx: input, ports } = moveCtx(moveBoard());
    const preview = await previewMoveWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.body.statusId).toBe(ST_REF_D);
    expect(preview.body.statusName).toBe('REFAÇÃO');
    expect(preview.body.listId).toBe(LIST_DEST);
    expect(preview.body.writeImpact).toBe('auto');
    expect(ports.board.mutations).toBe(0);
    expect([...ports.store.executions.values()]).toHaveLength(0);

    const moved = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: MOVE_KEY,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.body.statusId).toBe(ST_REF_D);
    expect(moved.body.statusId).not.toBe(ST_TODO_D);
    expect(ports.board.writes).toEqual([[MOVE_ID, LIST_DEST, ST_REF_D]]);
  });

  it('etapa diferente explícita prevalece sobre o equivalente', async () => {
    const { ctx: input, ports } = moveCtx(moveBoard());
    const result = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      statusId: ST_APROV_D,
      from: seen,
      idempotencyKey: 'idem-etapa-dif',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.statusId).toBe(ST_APROV_D);
    expect(result.body.statusName).toBe('Aprovação');
    expect(ports.board.writes).toEqual([[MOVE_ID, LIST_DEST, ST_APROV_D]]);
  });

  it('sem equivalente nenhuma tarefa muda e devolve as opções', async () => {
    const { ctx: input, ports } = moveCtx(moveBoard({ noEquivalent: true }));
    const result = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: 'idem-sem-eq',
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'status_choice_required',
      listName: 'Blue Sky',
    });
    if (result.ok) return;
    const choice = statusChoiceRequiredSchema.parse({
      error: result.code,
      message: result.message,
      taskId: result.taskId,
      listId: result.listId,
      listName: result.listName,
      options: result.options,
    });
    expect(choice.options.map((row) => row.id)).toEqual([ST_TODO_D, ST_CLOSED_D]);
    expect(choice.options[0].id).not.toBe(ST_REF_O);
    expect(ports.board.writes).toEqual([]);
    expect(ports.board.mutations).toBe(0);
    expect(ports.board.tasks.get(MOVE_ID)?.listId).toBe(LIST_ORIGIN);
  });

  it('origem divergente é state_conflict e não sobrescreve', async () => {
    const { ctx: input, ports } = moveCtx(moveBoard({ currentStatus: ST_APROV_O }));
    const result = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: 'idem-concorrencia',
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'state_conflict',
      current: { listId: LIST_ORIGIN, statusId: ST_APROV_O },
    });
    expect(ports.board.writes).toEqual([]);
    expect(ports.board.tasks.get(MOVE_ID)?.statusId).toBe(ST_APROV_O);
  });

  it('subárvore exige prévia F16.6a; approved do modelo não vale; com aprovação move as filhas', async () => {
    const { ctx: input, ports } = moveCtx(moveBoard({ child: true }));
    const preview = await previewMoveWork(input, { taskId: MOVE_ID, listId: LIST_DEST, from: seen });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.body.subtasksWouldMove).toBe(1);
    expect(preview.body.writeImpact).toBe('preview_required');
    expect(ports.board.mutations).toBe(0);

    const refused = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: 'idem-sub',
    });
    expect(refused).toMatchObject({ ok: false, code: 'state_conflict' });
    expect(refused.ok === false && refused.message).toMatch(/approved: true/i);
    expect(ports.board.writes).toEqual([]);

    const params = { taskId: MOVE_ID, listId: LIST_DEST, statusId: null, from: seen };
    const paramsHash = await hashWriteParams(params);
    ports.store.seedApproval({
      id: 'apr-subarvore',
      grantId: GRANT_ID,
      ownerId: OWNER_ID,
      operation: 'move_task',
      paramsHash,
      policyVersion: 1,
      expiresAt: new Date(agora.getTime() + 10 * 60 * 1000),
    });
    const moved = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: 'idem-sub',
      approvalId: 'apr-subarvore',
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.body.subtasksMoved).toBe(1);
    expect(ports.board.tasks.get(MOVE_CHILD)?.listId).toBe(LIST_DEST);
    expect(ports.board.tasks.get(MOVE_CHILD)?.statusId).toBe(ST_REF_D);
  });

  it('automação fora do recorte recusa tudo, zero alteração parcial', async () => {
    const { ctx: input, ports } = moveCtx(moveBoard({ automationOut: true }));
    const result = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: 'idem-auto-fora',
    });
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(ports.board.writes).toEqual([]);
    expect(ports.board.mutations).toBe(0);
    expect(ports.board.automationRuns).toBe(0);
    expect(ports.board.tasks.get(MOVE_ID)?.listId).toBe(LIST_ORIGIN);
  });

  it('replay idempotente não dispara a automação duas vezes', async () => {
    const { ctx: input, ports } = moveCtx(moveBoard({ automationIn: true }));
    const params = { taskId: MOVE_ID, listId: LIST_DEST, statusId: null, from: seen };
    const paramsHash = await hashWriteParams(params);
    ports.store.seedApproval({
      id: 'apr-auto',
      grantId: GRANT_ID,
      ownerId: OWNER_ID,
      operation: 'move_task',
      paramsHash,
      policyVersion: 1,
      expiresAt: new Date(agora.getTime() + 10 * 60 * 1000),
    });
    const first = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: MOVE_KEY,
      approvalId: 'apr-auto',
    });
    const second = await moveTaskWork(input, {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: MOVE_KEY,
      approvalId: 'apr-auto',
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.body.automation?.name).toBe('Encaminha na mesma empresa');
    expect(first.body.listId).toBe(LIST_MISSING);
    expect(second.body.replay).toBe(true);
    expect(second.body.executionId).toBe(first.body.executionId);
    expect(second.body.listId).toBe(first.body.listId);
    expect(ports.board.mutations).toBe(1);
    expect(ports.board.automationRuns).toBe(1);
    expect(ports.board.writes).toHaveLength(1);
  });

  it('sem origem recusa e pede reler; sem tasks:move é permission_denied nos dois adaptadores', async () => {
    const { ports } = moveCtx(moveBoard());
    const missing = moveTaskInputSchema.safeParse({
      taskId: MOVE_ID,
      listId: LIST_DEST,
      idempotencyKey: MOVE_KEY,
    });
    expect(missing.success).toBe(false);

    const store = new MemoryAgentWriteStore();
    const comments = new MemoryCommentBoard(OWNER_ID);
    const board = moveBoard();
    const shared = adapters(readGrant, store, comments, board);
    const payload = {
      taskId: MOVE_ID,
      listId: LIST_DEST,
      from: seen,
      idempotencyKey: MOVE_KEY,
    };
    const http = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${MOVE_TASK_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    });
    expect(http.status).toBe(403);
    expect(await parseJson(http)).toMatchObject({ error: 'permission_denied' });

    const previewHttp = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${PREVIEW_MOVE_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: MOVE_ID, listId: LIST_DEST, from: seen }),
      }),
    });
    expect(previewHttp.status).toBe(403);

    const mcp = await handleMcpRequest({
      ...shared,
      origin: 'mcp',
      request: mcpPost('tools/call', { name: 'move_task', arguments: payload }),
    });
    const rpc = await parseJson(mcp);
    const tool = rpc.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(tool.isError).toBe(true);
    expect(JSON.parse(tool.content[0].text)).toMatchObject({ error: 'permission_denied' });
    expect(board.mutations).toBe(0);
    expect(ports.board.mutations).toBe(0);
  });

  it('HTTP move_task devolve compacto e MCP preview_move não escreve', async () => {
    const store = new MemoryAgentWriteStore();
    const comments = new MemoryCommentBoard(OWNER_ID);
    const board = moveBoard();
    const shared = adapters(moveGrant, store, comments, board);
    const http = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${MOVE_TASK_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': MOVE_KEY },
        body: JSON.stringify({ taskId: MOVE_ID, listId: LIST_DEST, from: seen }),
      }),
    });
    expect(http.status).toBe(200);
    const body = moveTaskResponseSchema.parse(await parseJson(http));
    expect(body.statusId).toBe(ST_REF_D);
    expect(body.actedAs.integrationName).toBe('Claude da agência');
    expect(body).not.toHaveProperty('title');
    expect(board.mutations).toBe(1);

    const board2 = moveBoard();
    const shared2 = adapters(moveGrant, new MemoryAgentWriteStore(), comments, board2);
    shared2.writes.seedPerson(person);
    shared2.writes.seedGrant(moveGrant);
    const mcp = await handleMcpRequest({
      ...shared2,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'preview_move',
        arguments: { taskId: MOVE_ID, listId: LIST_DEST, from: seen },
      }),
    });
    const rpc = await parseJson(mcp);
    const tool = rpc.result as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    expect(tool.isError).toBeFalsy();
    const preview = previewMoveResponseSchema.parse(tool.structuredContent);
    expect(preview.operation).toBe('preview_move');
    expect(preview.writeImpact).toBe('auto');
    expect(board2.mutations).toBe(0);
  });
});

/**
 * Auditoria de 08/10/2026 — o recorte da concessão vem ANTES da origem
 * observada. A comparação da origem vinha primeiro, e uma origem errada sobre
 * tarefa fora da concessão devolvia `state_conflict` com a lista e a etapa
 * ATUAIS dela. E o plano da escrita usa a concessão relida na transação.
 */
describe('preview_move e move_task: recorte da concessão antes da origem', () => {
  const MOVE_FORA = 'ccccccc3-ccc3-4cc3-8cc3-ccccccccccc3';
  const pessoa: PersonAccess = {
    ...person,
    companyIds: ['empresa-a', 'empresa-b'],
    clientIds: ['cliente-a', 'cliente-b'],
    hasAllClientsAccess: true,
  };
  const recortada: IntegrationGrant = { ...moveGrant, allowedCompanyIds: ['empresa-a'] };
  const errada = { listId: LIST_ORIGIN, statusId: ST_APROV_O };

  function montar(relida: IntegrationGrant = recortada) {
    const board = moveBoard();
    board.tasks.set(MOVE_FORA, {
      id: MOVE_FORA,
      title: 'Peça de outra empresa',
      listId: LIST_OUT,
      statusId: ST_OUT,
      parentId: null,
      clientId: 'cliente-b',
      companyId: 'empresa-b',
      completedAt: null,
    });
    const store = new MemoryAgentWriteStore();
    store.seedPerson(pessoa);
    store.seedGrant(relida);
    const input = {
      grant: recortada,
      person: pessoa,
      origin: 'mcp' as const,
      store,
      comments: new MemoryCommentBoard(OWNER_ID),
      board,
      now: agora,
    };
    return { board, input };
  }

  it('tarefa fora da concessão com origem errada: permission_denied, sem a etapa atual', async () => {
    const { board, input } = montar();
    const comErrada = await previewMoveWork(input, { taskId: MOVE_FORA, listId: LIST_DEST, from: errada });
    expect(comErrada).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(comErrada).not.toHaveProperty('current');
    // Origem certa ou errada, a resposta é a mesma: nada conta onde ela está.
    const comCerta = await previewMoveWork(input, {
      taskId: MOVE_FORA,
      listId: LIST_DEST,
      from: { listId: LIST_OUT, statusId: ST_OUT },
    });
    expect(comErrada).toEqual(comCerta);
    const movida = await moveTaskWork(input, {
      taskId: MOVE_FORA,
      listId: LIST_DEST,
      from: errada,
      idempotencyKey: 'idem-fora-errada',
    });
    expect(movida).toEqual(comCerta);
    expect(board.mutations).toBe(0);
  });

  it('destino fora da concessão com origem errada: permission_denied, sem a etapa atual', async () => {
    const { board, input } = montar();
    const result = await previewMoveWork(input, { taskId: MOVE_ID, listId: LIST_OUT, from: errada });
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(result).not.toHaveProperty('current');
    expect(board.mutations).toBe(0);
  });

  it('o movimento planeja com a concessão RELIDA, não com a que chegou no pedido', async () => {
    // Entre o portão e a transação a conexão foi recortada para a empresa B.
    const { board, input } = montar({ ...moveGrant, allowedCompanyIds: ['empresa-b'] });
    const result = await moveTaskWork(
      { ...input, grant: moveGrant },
      { taskId: MOVE_ID, listId: LIST_DEST, from: seen, idempotencyKey: 'idem-relida' },
    );
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(board.mutations).toBe(0);
    expect(board.tasks.get(MOVE_ID)?.listId).toBe(LIST_ORIGIN);
  });
});
