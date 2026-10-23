/**
 * Escritas de tarefa pelo agente — F26.5.
 *
 * `create_task`, `update_task`, `assign_task`, `complete_task` e `reopen_task`
 * pelo mesmo caminho de `add_comment`/`move_task`: permissão, recorte da
 * conexão, chave de repetição, teto do dia, ensaio (`dryRun`) e o valor
 * anterior no registro. Port em memória — a suíte não fala com o banco (F0.4);
 * a prova contra o Postgres é `scripts/provar-tarefas-pela-ia.mjs`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  ASSIGN_TASK_PATH,
  COMPLETE_TASK_PATH,
  CREATE_TASK_PATH,
  INTEGRATION_WRITES_UNAVAILABLE_MESSAGE,
  REOPEN_TASK_PATH,
  UPDATE_TASK_PATH,
  assignTaskInputSchema,
  assignTaskOpenApiExample,
  assignTaskResponseSchema,
  completeTaskInputSchema,
  completeTaskOpenApiExample,
  completeTaskResponseSchema,
  createTaskInputSchema,
  createTaskOpenApiExample,
  createTaskResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
  reopenTaskInputSchema,
  reopenTaskOpenApiExample,
  reopenTaskResponseSchema,
  updateTaskInputSchema,
  updateTaskOpenApiExample,
  updateTaskResponseSchema,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { MemoryAgentWriteStore, type PersistedExecution } from '@/integrations/executions';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import {
  MCP_TASK_WRITE_TOOL_NAMES,
  executeTool,
  handleMcpRequest,
  type McpLoaded,
} from '@/integrations/mcp';
import { MemoryWorkCatalog } from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';
import {
  MemoryCommentBoard,
  MemoryMoveBoard,
  MemoryTaskBoard,
  type MemoryTaskAutomation,
  assignTaskWork,
  completeTaskWork,
  createTaskWork,
  reopenTaskWork,
  updateTaskWork,
  type WriteCtx,
} from '@/integrations/writes';

const agora = new Date('2026-09-22T15:00:00.000Z');
const ORIGIN = 'https://ideworks.test';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const LIST_A = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const LIST_B = 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2';
const LIST_MISSING = 'aaaaaaa9-aaa9-4aa9-8aa9-aaaaaaaaaaa9';
const LIST_A2 = 'aaaaaaa3-aaa3-4aa3-8aa3-aaaaaaaaaaa3';
const OPEN_A2 = 'bbbbbbb7-bbb7-4bb7-8bb7-bbbbbbbbbbb7';
const OPEN_A = 'bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1';
const CLOSED_A = 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2';
const TAG_A = 'ccccccc1-ccc1-4cc1-8cc1-ccccccccccc1';
const TAG_OTHER = 'ccccccc9-ccc9-4cc9-8cc9-ccccccccccc9';
const TASK_A = 'ddddddd1-ddd1-4dd1-8dd1-ddddddddddd1';
const TASK_B = 'ddddddd2-ddd2-4dd2-8dd2-ddddddddddd2';
const TASK_DONE = 'ddddddd3-ddd3-4dd3-8dd3-ddddddddddd3';
const HELENA = '33333333-3333-4333-8333-333333333333';
const CAROL_B = '44444444-4444-4444-8444-444444444444';
const LEGADO_B = '55555555-5555-4555-8555-555555555555';
const FORA = '66666666-6666-4666-8666-666666666666';

const TITULO = 'Roteiro secreto do vídeo de setembro';
const DESCRICAO = 'Briefing longo que nunca pode ir para o registro.';

/** O dono alcança as duas empresas; a concessão, recortada, só a A. */
const person: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a', 'empresa-b'],
  clientIds: ['cliente-a', 'cliente-b'],
  hasAllClientsAccess: false,
};

const TASK_CAPS = ['tasks:write', 'tasks:assign', 'tasks:complete'] as const;

const fullGrant: IntegrationGrant = {
  id: GRANT_ID,
  ownerId: OWNER_ID,
  oauthClientId: 'ideworks-claude',
  name: 'Claude da agência',
  capabilities: [...READ_CAPABILITIES, ...TASK_CAPS],
  allowedCompanyIds: ['empresa-a'],
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const writeOnlyGrant: IntegrationGrant = {
  ...fullGrant,
  capabilities: [...READ_CAPABILITIES, 'tasks:write'],
};

const readGrant: IntegrationGrant = { ...fullGrant, capabilities: [...READ_CAPABILITIES] };

function board(automations: readonly MemoryTaskAutomation[] = []) {
  return new MemoryTaskBoard({
    automations,
    lists: [
      {
        id: LIST_A,
        companyId: 'empresa-a',
        clientId: 'cliente-a',
        openStatusId: OPEN_A,
        closedStatusId: CLOSED_A,
        tagIds: [TAG_A],
      },
      {
        id: LIST_B,
        companyId: 'empresa-b',
        clientId: 'cliente-b',
        openStatusId: 'bbbbbbb5-bbb5-4bb5-8bb5-bbbbbbbbbbb5',
        closedStatusId: 'bbbbbbb6-bbb6-4bb6-8bb6-bbbbbbbbbbb6',
      },
      // F44, Fase 8 — o destino de uma regra dentro do recorte (mesma empresa).
      {
        id: LIST_A2,
        companyId: 'empresa-a',
        clientId: 'cliente-a',
        openStatusId: OPEN_A2,
        closedStatusId: 'bbbbbbb8-bbb8-4bb8-8bb8-bbbbbbbbbbb8',
      },
    ],
    people: [
      { id: OWNER_ID, companyIds: ['empresa-a', 'empresa-b'] },
      { id: HELENA, companyIds: ['empresa-a'] },
      { id: CAROL_B, companyIds: ['empresa-b'] },
      { id: LEGADO_B, companyIds: ['empresa-b'] },
    ],
    tasks: [
      { taskId: TASK_A, listId: LIST_A, title: 'Peça', dueOn: '2026-09-25', assigneeIds: [LEGADO_B] },
      { taskId: TASK_B, listId: LIST_B, title: 'Fora do recorte' },
      {
        taskId: TASK_DONE,
        listId: LIST_A,
        title: 'Entregue',
        completed: true,
        statusId: CLOSED_A,
        completedBy: OWNER_ID,
      },
    ],
  });
}

function setup(grant: IntegrationGrant = fullGrant, automations: readonly MemoryTaskAutomation[] = []) {
  const store = new MemoryAgentWriteStore();
  store.seedPerson(person);
  store.seedGrant(grant);
  const tasks = board(automations);
  const ctx: WriteCtx = {
    grant,
    person,
    origin: 'mcp',
    store,
    comments: new MemoryCommentBoard(OWNER_ID),
    tasks,
    now: agora,
  };
  return { store, tasks, ctx };
}

function rows(store: MemoryAgentWriteStore): PersistedExecution[] {
  return [...store.executions.values()];
}

/** O registro nunca guarda texto: nem as chaves proibidas, nem o título, nem a descrição. */
function expectNoText(row: PersistedExecution) {
  const json = JSON.stringify({ result: row.result, changes: row.changes });
  expect(json).not.toContain(TITULO);
  expect(json).not.toContain(DESCRICAO);
  for (const key of ['body', 'content', 'text', 'title', 'description']) {
    expect(Object.keys(row.changes)).not.toContain(key);
    expect(Object.keys(row.result)).not.toContain(key);
  }
}

const CATALOG = new MemoryCatalog(
  [
    { id: 'empresa-a', name: 'Agência Ide' },
    { id: 'empresa-b', name: 'Ide Filmes' },
  ],
  new Map([[OWNER_ID, 'Wesley Lourenço']]),
);

function adapters(grant: IntegrationGrant, extra: { writesEnabled?: boolean } = {}) {
  const { store, tasks } = setup(grant);
  return {
    store,
    tasks,
    shared: {
      grant,
      person,
      catalog: CATALOG,
      work: new MemoryWorkCatalog(),
      delivery: new MemoryDeliveryCatalog(),
      marketing: new MemoryMarketingCatalog(),
      writes: store,
      comments: new MemoryCommentBoard(OWNER_ID),
      tasks,
      displayNameFallback: 'Wesley Lourenço',
      now: agora,
      ...extra,
    },
  };
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

function httpPost(path: string, body: unknown, key?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  });
}

type ToolResult = {
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
};

async function callTool(shared: ReturnType<typeof adapters>['shared'], name: string, args: unknown) {
  const response = await handleMcpRequest({
    ...shared,
    origin: 'mcp',
    request: mcpPost('tools/call', { name, arguments: args }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { result: ToolResult }).result;
}

describe('contrato das cinco escritas de tarefa', () => {
  it('OpenAPI publica as cinco rotas só em POST, com os schemas iguais ao Zod', () => {
    const doc = integrationOpenApi();
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    const pares = [
      ['CreateTaskInput', createTaskInputSchema],
      ['CreateTaskResponse', createTaskResponseSchema],
      ['UpdateTaskInput', updateTaskInputSchema],
      ['UpdateTaskResponse', updateTaskResponseSchema],
      ['AssignTaskInput', assignTaskInputSchema],
      ['AssignTaskResponse', assignTaskResponseSchema],
      ['CompleteTaskInput', completeTaskInputSchema],
      ['CompleteTaskResponse', completeTaskResponseSchema],
      ['ReopenTaskInput', reopenTaskInputSchema],
      ['ReopenTaskResponse', reopenTaskResponseSchema],
    ] as const;
    for (const [nome, schema] of pares) expect(schemas[nome]).toEqual(jsonSchemaFromZod(schema));

    const paths = doc.paths as Record<string, { post?: { operationId?: string }; get?: unknown }>;
    for (const op of MCP_TASK_WRITE_TOOL_NAMES) {
      expect(paths[`/${op}`].post?.operationId).toBe(op);
      expect(paths[`/${op}`].get).toBeUndefined();
    }
    expect(createTaskResponseSchema.parse(createTaskOpenApiExample()).operation).toBe('create_task');
    expect(updateTaskResponseSchema.parse(updateTaskOpenApiExample()).operation).toBe('update_task');
    expect(assignTaskResponseSchema.parse(assignTaskOpenApiExample()).operation).toBe('assign_task');
    expect(completeTaskResponseSchema.parse(completeTaskOpenApiExample()).operation).toBe('complete_task');
    expect(reopenTaskResponseSchema.parse(reopenTaskOpenApiExample()).operation).toBe('reopen_task');
  });

  it('entrada estrita: autor no corpo, campo desconhecido e data inexistente são recusados', () => {
    const base = { listId: LIST_A, title: 'ok', idempotencyKey: 'k' };
    expect(createTaskInputSchema.safeParse(base).success).toBe(true);
    expect(createTaskInputSchema.safeParse({ ...base, createdBy: HELENA }).success).toBe(false);
    // F38, Fase 6.3: statusId passou a ser aceito no create_task; o update continua sem etapa.
    expect(createTaskInputSchema.safeParse({ ...base, statusId: OPEN_A }).success).toBe(true);
    expect(updateTaskInputSchema.safeParse({ taskId: TASK_A, statusId: OPEN_A, idempotencyKey: 'k' }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ ...base, dueOn: '2026-02-30' }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ ...base, dueOn: '30/09/2026' }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ ...base, priority: 'altissima' }).success).toBe(false);
    expect(updateTaskInputSchema.safeParse({ taskId: TASK_A, assigneeIds: [], idempotencyKey: 'k' }).success).toBe(
      false,
    );
    expect(completeTaskInputSchema.safeParse({ taskId: TASK_A, idempotencyKey: 'k', by: HELENA }).success).toBe(false);
  });
});

describe('create_task', () => {
  it('cria com o dono como autor, o alvo do registro é a tarefa nova e o registro não guarda texto', async () => {
    const { ctx, store, tasks } = setup();
    const result = await createTaskWork(ctx, {
      listId: LIST_A,
      title: TITULO,
      description: DESCRICAO,
      dueOn: '2026-09-30',
      priority: 'high',
      tagIds: [TAG_A],
      assigneeIds: [HELENA],
      idempotencyKey: 'criar-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const taskId = result.body.taskId!;
    expect(result.body).toMatchObject({
      operation: 'create_task',
      dryRun: false,
      replay: false,
      task: {
        listId: LIST_A,
        statusId: OPEN_A,
        completed: false,
        dueOn: '2026-09-30',
        priority: 'high',
        assigneeIds: [HELENA],
        tagIds: [TAG_A],
      },
      actedAs: { ownerId: OWNER_ID, integrationName: 'Claude da agência' },
    });
    expect(tasks.authorOf(taskId)?.createdBy).toBe(OWNER_ID);
    expect(tasks.mutations).toBe(1);

    const [row] = rows(store);
    expect(row.operation).toBe('create_task');
    expect(row.targetId).toBe(taskId);
    expect(row.changes).toMatchObject({
      created: true,
      listId: LIST_A,
      after: { assigneeIds: [HELENA], dueOn: '2026-09-30', priority: 'high', tagIds: [TAG_A], completed: false },
    });
    expectNoText(row);
  });

  it('responsáveis na criação sem tasks:assign recusam com frase, e nada é criado', async () => {
    const { ctx, store, tasks } = setup(writeOnlyGrant);
    const result = await createTaskWork(ctx, {
      listId: LIST_A,
      title: TITULO,
      assigneeIds: [HELENA],
      idempotencyKey: 'criar-sem-assign',
    });
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    if (!result.ok) expect(result.message).toMatch(/tasks:assign/);
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);

    // Sem responsáveis, a mesma concessão cria.
    const semResponsavel = await createTaskWork(ctx, { listId: LIST_A, title: TITULO, idempotencyKey: 'criar-2' });
    expect(semResponsavel.ok).toBe(true);
  });

  it('lista fora do recorte da conexão recusa antes de gravar, mesmo o dono alcançando a empresa', async () => {
    const { ctx, store, tasks } = setup();
    const result = await createTaskWork(ctx, { listId: LIST_B, title: TITULO, idempotencyKey: 'criar-b' });
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    if (!result.ok) expect(result.message).toMatch(/recorte desta conexão/);
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);

    const inexistente = await createTaskWork(ctx, { listId: LIST_MISSING, title: TITULO, idempotencyKey: 'criar-x' });
    expect(inexistente).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('responsável fora do recorte (ou fora do diretório do dono) recusa dizendo quem, e nada é gravado', async () => {
    const { ctx, store, tasks } = setup();
    const result = await createTaskWork(ctx, {
      listId: LIST_A,
      title: TITULO,
      assigneeIds: [HELENA, CAROL_B, FORA],
      idempotencyKey: 'criar-fora',
    });
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    if (!result.ok) {
      expect(result.message).toContain(CAROL_B);
      expect(result.message).toContain(FORA);
      expect(result.message).not.toContain(HELENA);
      expect(result.message).toMatch(/list_people/);
    }
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('repetir a mesma chave não cria outra tarefa; chave com outro conteúdo é conflito', async () => {
    const { ctx, store, tasks } = setup();
    const input = { listId: LIST_A, title: TITULO, idempotencyKey: 'criar-repetido' };
    const primeira = await createTaskWork(ctx, input);
    const segunda = await createTaskWork(ctx, input);
    expect(primeira.ok && segunda.ok).toBe(true);
    if (!primeira.ok || !segunda.ok) return;
    expect(segunda.body.replay).toBe(true);
    expect(segunda.body.taskId).toBe(primeira.body.taskId);
    expect(segunda.body.executionId).toBe(primeira.body.executionId);
    expect(tasks.mutations).toBe(1);
    expect(rows(store)).toHaveLength(1);

    const outra = await createTaskWork(ctx, { ...input, title: 'Outro título' });
    expect(outra).toMatchObject({ ok: false, code: 'state_conflict' });
    expect(tasks.mutations).toBe(1);
  });

  it('a 51ª escrita do dia é recusada com daily_write_limit, e o ensaio devolve a mesma recusa', async () => {
    const { ctx, store, tasks } = setup();
    for (let i = 0; i < 50; i += 1) {
      const ok = await createTaskWork(ctx, { listId: LIST_A, title: `Pauta ${i}`, idempotencyKey: `laco-${i}` });
      expect(ok.ok).toBe(true);
    }
    const input = { listId: LIST_A, title: 'A 51ª', idempotencyKey: 'laco-51' };
    const real = await createTaskWork(ctx, input);
    expect(real).toMatchObject({ ok: false, code: 'daily_write_limit', dailyWrites: { used: 50, limit: 50 } });
    const ensaio = await createTaskWork(ctx, { ...input, dryRun: true });
    expect(ensaio).toEqual(real);
    expect(tasks.mutations).toBe(50);
    expect(rows(store)).toHaveLength(50);
  });
});

describe('dryRun — o ensaio', () => {
  it('não grava, não entra no registro, não conta no teto, e responde o que faria', async () => {
    const { ctx, store, tasks } = setup();
    const ensaio = await createTaskWork(ctx, {
      listId: LIST_A,
      title: TITULO,
      assigneeIds: [HELENA],
      dueOn: '2026-10-01',
      idempotencyKey: 'ensaio-1',
      dryRun: true,
    });
    expect(ensaio.ok).toBe(true);
    if (!ensaio.ok) return;
    expect(ensaio.body).toMatchObject({
      operation: 'create_task',
      dryRun: true,
      taskId: null,
      executionId: null,
      replay: false,
      task: { listId: LIST_A, statusId: OPEN_A, assigneeIds: [HELENA], dueOn: '2026-10-01' },
      dailyWrites: { used: 0, limit: 50 },
    });
    expect(tasks.mutations).toBe(0);
    expect(tasks.tasks.size).toBe(3);
    expect(rows(store)).toHaveLength(0);

    // A mesma chave, agora de verdade, escreve — o ensaio não a gastou.
    const real = await createTaskWork(ctx, {
      listId: LIST_A,
      title: TITULO,
      assigneeIds: [HELENA],
      dueOn: '2026-10-01',
      idempotencyKey: 'ensaio-1',
    });
    expect(real.ok && real.body.replay).toBe(false);
    expect(rows(store)).toHaveLength(1);
    expect(tasks.mutations).toBe(1);
  });

  it('a recusa do ensaio é a mesma da escrita real (responsável fora do recorte, regra do banco, já concluída)', async () => {
    const { ctx, tasks, store } = setup();
    const fora = { listId: LIST_A, title: TITULO, assigneeIds: [CAROL_B], idempotencyKey: 'e-fora' };
    expect(await createTaskWork(ctx, { ...fora, dryRun: true })).toEqual(await createTaskWork(ctx, fora));

    const etiqueta = { taskId: TASK_A, tagIds: [TAG_OTHER], idempotencyKey: 'e-tag' };
    const etiquetaReal = await updateTaskWork(ctx, etiqueta);
    expect(etiquetaReal).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(await updateTaskWork(ctx, { ...etiqueta, dryRun: true })).toEqual(etiquetaReal);

    const concluida = { taskId: TASK_DONE, idempotencyKey: 'e-concluida' };
    const concluidaReal = await completeTaskWork(ctx, concluida);
    expect(concluidaReal).toMatchObject({ ok: false, code: 'state_conflict' });
    expect(await completeTaskWork(ctx, { ...concluida, dryRun: true })).toEqual(concluidaReal);

    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('ensaio de mudança em tarefa existente mostra o estado final sem mexer na tarefa', async () => {
    const { ctx, tasks, store } = setup();
    const ensaio = await completeTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'e-concluir', dryRun: true });
    expect(ensaio.ok).toBe(true);
    if (!ensaio.ok) return;
    expect(ensaio.body).toMatchObject({ dryRun: true, taskId: TASK_A, executionId: null, task: { completed: true } });
    expect(tasks.tasks.get(TASK_A)?.completed).toBe(false);
    expect(rows(store)).toHaveLength(0);
  });
});

describe('update_task', () => {
  it('só os campos enviados mudam; o registro guarda antes/depois dos pequenos e só o NOME do texto editado', async () => {
    const { ctx, store, tasks } = setup();
    const result = await updateTaskWork(ctx, {
      taskId: TASK_A,
      title: TITULO,
      description: DESCRICAO,
      dueOn: '2026-10-02',
      idempotencyKey: 'editar-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.task).toMatchObject({ dueOn: '2026-10-02', priority: null, assigneeIds: [LEGADO_B] });
    expect(tasks.tasks.get(TASK_A)?.title).toBe(TITULO);

    const [row] = rows(store);
    expect(row.operation).toBe('update_task');
    expect(row.targetId).toBe(TASK_A);
    expect(row.changes).toEqual({
      before: { dueOn: '2026-09-25' },
      after: { dueOn: '2026-10-02' },
      textEdited: ['title', 'description'],
    });
    expectNoText(row);
  });

  it('sem nenhum campo é invalid_input; sem tasks:write é permission_denied', async () => {
    const { ctx } = setup();
    expect(await updateTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'vazio' })).toMatchObject({
      ok: false,
      code: 'invalid_input',
    });
    const semPermissao = setup(readGrant);
    expect(
      await updateTaskWork(semPermissao.ctx, { taskId: TASK_A, dueOn: null, idempotencyKey: 'x' }),
    ).toMatchObject({ ok: false, code: 'permission_denied' });
  });

  it('tarefa fora do recorte da conexão recusa, e nada muda', async () => {
    const { ctx, tasks, store } = setup();
    const result = await updateTaskWork(ctx, { taskId: TASK_B, priority: 'low', idempotencyKey: 'editar-b' });
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(tasks.tasks.get(TASK_B)?.priority).toBeNull();
    expect(rows(store)).toHaveLength(0);
  });
});

describe('assign_task', () => {
  it('troca a lista inteira; quem já estava fica mesmo fora do recorte; antes/depois no registro', async () => {
    const { ctx, store } = setup();
    const result = await assignTaskWork(ctx, {
      taskId: TASK_A,
      assigneeIds: [HELENA, LEGADO_B],
      idempotencyKey: 'atribuir-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.task.assigneeIds).toEqual([HELENA, LEGADO_B].sort());
    const [row] = rows(store);
    expect(row.changes).toEqual({
      before: { assigneeIds: [LEGADO_B] },
      after: { assigneeIds: [HELENA, LEGADO_B].sort() },
    });
  });

  it('pessoa NOVA fora do recorte recusa; sem tasks:assign recusa; [] tira todos', async () => {
    const { ctx, tasks } = setup();
    const fora = await assignTaskWork(ctx, { taskId: TASK_A, assigneeIds: [CAROL_B], idempotencyKey: 'a-fora' });
    expect(fora).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(tasks.tasks.get(TASK_A)?.assigneeIds).toEqual([LEGADO_B]);

    const semAssign = setup(writeOnlyGrant);
    expect(
      await assignTaskWork(semAssign.ctx, { taskId: TASK_A, assigneeIds: [], idempotencyKey: 'a-sem' }),
    ).toMatchObject({ ok: false, code: 'permission_denied' });

    const limpa = await assignTaskWork(ctx, { taskId: TASK_A, assigneeIds: [], idempotencyKey: 'a-limpa' });
    expect(limpa.ok && limpa.body.task.assigneeIds).toEqual([]);
  });
});

describe('complete_task e reopen_task', () => {
  it('concluir assina com o dono, vai para a etapa que fecha e guarda antes/depois', async () => {
    const { ctx, store, tasks } = setup();
    const result = await completeTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'concluir-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.task).toMatchObject({ completed: true, statusId: CLOSED_A });
    expect(tasks.authorOf(TASK_A)?.completedBy).toBe(OWNER_ID);
    const [row] = rows(store);
    expect(row.operation).toBe('complete_task');
    expect(row.changes).toEqual({
      before: { completed: false, statusId: OPEN_A },
      after: { completed: true, statusId: CLOSED_A },
    });

    const reaberta = await reopenTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'reabrir-1' });
    expect(reaberta.ok && reaberta.body.task).toMatchObject({ completed: false, statusId: OPEN_A });
    expect(rows(store).map((r) => r.operation)).toEqual(['complete_task', 'reopen_task']);
  });

  it('reabrir tarefa aberta é state_conflict e não mexe na etapa; sem tasks:complete recusa', async () => {
    const { ctx, tasks } = setup();
    expect(await reopenTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'r-aberta' })).toMatchObject({
      ok: false,
      code: 'state_conflict',
    });
    expect(tasks.mutations).toBe(0);
    const semComplete = setup(writeOnlyGrant);
    expect(await completeTaskWork(semComplete.ctx, { taskId: TASK_A, idempotencyKey: 'c' })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
  });
});

describe('complete_task e reopen_task rodam a automação da etapa (F44, Fase 8)', () => {
  it('a regra da etapa que fecha troca quem cuida: a resposta mostra, e o antes/depois guarda os responsáveis', async () => {
    const { ctx, store } = setup(fullGrant, [{ sourceListId: LIST_A, triggerStatusId: CLOSED_A, assigneeId: HELENA }]);
    const result = await completeTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'f44-regra-pessoa' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.task).toMatchObject({ completed: true, statusId: CLOSED_A, assigneeIds: [HELENA] });
    const [row] = rows(store);
    // Os responsáveis entram no registro: o desfazer em lote os volta junto com a etapa.
    expect(row.changes).toEqual({
      before: { completed: false, statusId: OPEN_A, assigneeIds: [LEGADO_B] },
      after: { completed: true, statusId: CLOSED_A, assigneeIds: [HELENA] },
    });
  });

  it('reabrir roda a regra da primeira etapa que abre', async () => {
    const { ctx } = setup(fullGrant, [{ sourceListId: LIST_A, triggerStatusId: OPEN_A, assigneeId: HELENA }]);
    const reaberta = await reopenTaskWork(ctx, { taskId: TASK_DONE, idempotencyKey: 'f44-reabrir-regra' });
    expect(reaberta.ok && reaberta.body.task).toMatchObject({ completed: false, statusId: OPEN_A, assigneeIds: [HELENA] });
  });

  it('a regra leva a tarefa para outra lista dentro do recorte: vale, e o registro marca o movimento', async () => {
    const { ctx, store } = setup(fullGrant, [{ sourceListId: LIST_A, triggerStatusId: CLOSED_A, targetListId: LIST_A2 }]);
    const result = await completeTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'f44-regra-lista' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A fila da lista nova abre: a tarefa termina aberta lá, como no arrasto.
    expect(result.body.task).toMatchObject({ listId: LIST_A2, statusId: OPEN_A2, completed: false });
    expect(rows(store)[0].changes).toMatchObject({ movedByAutomation: true });
  });

  it('a regra leva a tarefa para fora do recorte: permission_denied, como o move_task do agente, e nada fica no registro', async () => {
    const { ctx, store } = setup(fullGrant, [{ sourceListId: LIST_A, triggerStatusId: CLOSED_A, targetListId: LIST_B }]);
    const result = await completeTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'f44-regra-fora' });
    expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(!result.ok && result.message).toMatch(/automação desta etapa leva a tarefa para fora do recorte/);
    // No banco a transação inteira volta; aqui, o registro não guarda nada.
    expect(rows(store)).toHaveLength(0);
  });

  it('sem regra na etapa, nada muda: o mesmo registro de antes da F44', async () => {
    const { ctx, store } = setup(fullGrant, [{ sourceListId: LIST_A, triggerStatusId: OPEN_A, assigneeId: HELENA }]);
    expect((await completeTaskWork(ctx, { taskId: TASK_A, idempotencyKey: 'f44-sem-regra' })).ok).toBe(true);
    expect(rows(store)[0].changes).toEqual({
      before: { completed: false, statusId: OPEN_A },
      after: { completed: true, statusId: CLOSED_A },
    });
  });
});

describe('adaptador MCP', () => {
  it('lista as cinco como escrita e cada uma funciona pelo tools/call', async () => {
    const { shared, store } = adapters(fullGrant);
    const listed = await handleMcpRequest({ ...shared, origin: 'mcp', request: mcpPost('tools/list', {}, 2) });
    const tools = ((await listed.json()) as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
    for (const name of MCP_TASK_WRITE_TOOL_NAMES) {
      const tool = tools.find((row) => row.name === name);
      expect((tool?.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(false);
    }
    const assign = tools.find((row) => row.name === 'assign_task');
    expect(String(assign?.description)).toMatch(/list_people.*people:read/);

    const criada = await callTool(shared, 'create_task', { listId: LIST_A, title: TITULO, idempotencyKey: 'm-1' });
    expect(criada.isError).toBeFalsy();
    const body = createTaskResponseSchema.parse(criada.structuredContent);
    expect(criada.content[0].text).not.toContain(TITULO);
    const taskId = body.taskId!;

    const editada = await callTool(shared, 'update_task', { taskId, priority: 'urgent', idempotencyKey: 'm-2' });
    expect(updateTaskResponseSchema.parse(editada.structuredContent).task.priority).toBe('urgent');
    const atribuida = await callTool(shared, 'assign_task', {
      taskId,
      assigneeIds: [HELENA],
      idempotencyKey: 'm-3',
    });
    expect(assignTaskResponseSchema.parse(atribuida.structuredContent).task.assigneeIds).toEqual([HELENA]);
    const concluida = await callTool(shared, 'complete_task', { taskId, idempotencyKey: 'm-4' });
    expect(completeTaskResponseSchema.parse(concluida.structuredContent).task.completed).toBe(true);
    const reaberta = await callTool(shared, 'reopen_task', { taskId, idempotencyKey: 'm-5' });
    expect(reopenTaskResponseSchema.parse(reaberta.structuredContent).task.completed).toBe(false);

    expect(rows(store).map((row) => row.operation)).toEqual([
      'create_task',
      'update_task',
      'assign_task',
      'complete_task',
      'reopen_task',
    ]);
    expect(rows(store).every((row) => row.origin === 'mcp' && row.targetId === taskId)).toBe(true);
  });

  it('sem a permissão, cada ferramenta recusa com permission_denied e nada é gravado', async () => {
    const { shared, store, tasks } = adapters(readGrant);
    const chamadas: Array<[string, unknown]> = [
      ['create_task', { listId: LIST_A, title: 'x', idempotencyKey: 'p-1' }],
      ['update_task', { taskId: TASK_A, dueOn: null, idempotencyKey: 'p-2' }],
      ['assign_task', { taskId: TASK_A, assigneeIds: [], idempotencyKey: 'p-3' }],
      ['complete_task', { taskId: TASK_A, idempotencyKey: 'p-4' }],
      ['reopen_task', { taskId: TASK_DONE, idempotencyKey: 'p-5' }],
    ];
    for (const [name, args] of chamadas) {
      const result = await callTool(shared, name, args);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toMatchObject({ error: 'permission_denied' });
    }
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('nome de ferramenta desconhecido é recusado — nunca vira comentário', async () => {
    const { shared } = adapters(fullGrant);
    const comments = new MemoryCommentBoard(OWNER_ID, {
      mentionable: new Map([[TASK_A, [OWNER_ID]]]),
    });
    const loaded: McpLoaded = {
      grant: { ...fullGrant, capabilities: [...fullGrant.capabilities, 'comments:write'] },
      person,
      origin: 'mcp',
      companies: [],
      displayName: 'Wesley Lourenço',
      work: shared.work,
      delivery: shared.delivery,
      marketing: shared.marketing,
      writes: shared.writes,
      comments,
      board: new MemoryMoveBoard(),
      tasks: shared.tasks,
      now: agora,
      writesEnabled: true,
    };
    const args = { taskId: TASK_A, body: 'não deve publicar', idempotencyKey: 'u-1' };
    const result = await executeTool('delete_everything', args, loaded);
    expect(result).toMatchObject({ ok: false, code: 'unknown_operation' });
    expect(comments.mutations).toBe(0);

    // Pelo protocolo também: o SDK recusa, e nada é escrito.
    const rpc = await callTool(shared, 'delete_everything', args);
    expect(rpc.isError).toBe(true);
    expect(rows(shared.writes)).toHaveLength(0);
  });

  it('escritas desligadas recusam as cinco, inclusive o ensaio', async () => {
    const { shared, tasks } = adapters(fullGrant, { writesEnabled: false });
    // Entradas VÁLIDAS: o SDK confere o schema antes de chamar a ferramenta.
    const validas: Record<string, Record<string, unknown>> = {
      create_task: { listId: LIST_A, title: 'x' },
      update_task: { taskId: TASK_A, dueOn: null },
      assign_task: { taskId: TASK_A, assigneeIds: [] },
      complete_task: { taskId: TASK_A },
      reopen_task: { taskId: TASK_DONE },
    };
    for (const name of MCP_TASK_WRITE_TOOL_NAMES) {
      const result = await callTool(shared, name, { ...validas[name], idempotencyKey: 'off', dryRun: true });
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        error: 'unavailable',
        message: INTEGRATION_WRITES_UNAVAILABLE_MESSAGE,
      });
    }
    expect(tasks.mutations).toBe(0);
  });
});

describe('adaptador HTTP', () => {
  it('as cinco rotas escrevem com a chave no cabeçalho e respondem o contrato', async () => {
    const { shared, store } = adapters(fullGrant);
    const criar = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: httpPost(CREATE_TASK_PATH, { listId: LIST_A, title: TITULO, assigneeIds: [HELENA] }, 'h-1'),
    });
    expect(criar.status).toBe(200);
    const criada = createTaskResponseSchema.parse(await criar.json());
    const taskId = criada.taskId!;

    const passos: Array<[string, Record<string, unknown>, (value: unknown) => unknown]> = [
      [UPDATE_TASK_PATH, { taskId, startOn: '2026-09-23' }, (v) => updateTaskResponseSchema.parse(v)],
      [ASSIGN_TASK_PATH, { taskId, assigneeIds: [] }, (v) => assignTaskResponseSchema.parse(v)],
      [COMPLETE_TASK_PATH, { taskId }, (v) => completeTaskResponseSchema.parse(v)],
      [REOPEN_TASK_PATH, { taskId }, (v) => reopenTaskResponseSchema.parse(v)],
    ];
    let n = 2;
    for (const [path, body, parse] of passos) {
      const response = await dispatchIntegrationHttp({
        ...shared,
        origin: 'http',
        request: httpPost(path, body, `h-${n++}`),
      });
      expect(response.status).toBe(200);
      parse(await response.json());
    }
    expect(rows(store).map((row) => row.operation)).toEqual([
      'create_task',
      'update_task',
      'assign_task',
      'complete_task',
      'reopen_task',
    ]);
    expect(rows(store).every((row) => row.origin === 'http')).toBe(true);
  });

  it('GET é 405, sem permissão é 403, sem chave é 400 e escritas desligadas é 503', async () => {
    const { shared } = adapters(fullGrant);
    const get = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${COMPLETE_TASK_PATH}?taskId=${TASK_A}`),
    });
    expect(get.status).toBe(405);

    const semChave = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: httpPost(COMPLETE_TASK_PATH, { taskId: TASK_A }),
    });
    expect(semChave.status).toBe(400);

    const leitura = adapters(readGrant);
    const negado = await dispatchIntegrationHttp({
      ...leitura.shared,
      origin: 'http',
      request: httpPost(ASSIGN_TASK_PATH, { taskId: TASK_A, assigneeIds: [] }, 'h-x'),
    });
    expect(negado.status).toBe(403);
    expect(await negado.json()).toMatchObject({ error: 'permission_denied' });

    const desligado = adapters(fullGrant, { writesEnabled: false });
    const off = await dispatchIntegrationHttp({
      ...desligado.shared,
      origin: 'http',
      request: httpPost(CREATE_TASK_PATH, { listId: LIST_A, title: 'x', dryRun: true }, 'h-off'),
    });
    expect(off.status).toBe(503);
    expect(desligado.tasks.mutations).toBe(0);
  });

  it('responsável fora do recorte pela HTTP recusa com 403 e a frase diz quem', async () => {
    const { shared, tasks } = adapters(fullGrant);
    const response = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: httpPost(ASSIGN_TASK_PATH, { taskId: TASK_A, assigneeIds: [CAROL_B] }, 'h-fora'),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('permission_denied');
    expect(body.message).toContain(CAROL_B);
    expect(tasks.mutations).toBe(0);
  });
});

describe('o caminho SQL usa os miolos da Fase 3 no Tx do registro', () => {
  it('writes.ts chama só os …InTx, e a sessão da escrita declara app.grant_id (a marca de origem)', () => {
    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const writes = readFileSync(join(raiz, 'src', 'integrations', 'writes.ts'), 'utf8');
    for (const miolo of ['createBoardTaskInTx', 'patchBoardTaskInTx', 'setBoardTaskCompletedInTx', 'createSubtaskInTx']) {
      expect(writes).toContain(miolo);
    }
    // F38, Fase 6.4 — a subtarefa vem do miolo do quadro, não do invólucro (`createSubtask` abre a própria transação).
    expect(writes).toMatch(/import \{ createSubtaskInTx, type NewSubtaskInTx \} from '@\/server\/board-passos'/);
    // Os invólucros da tela abrem a própria transação — fora do registro.
    expect(writes).not.toMatch(/\bcreateBoardTask\s*\(/);
    expect(writes).not.toMatch(/\bpatchBoardTask\s*\(/);
    expect(writes).not.toMatch(/\bsetBoardTaskCompleted\s*\(/);
    // O gatilho `stamp_agent_origin` (F26.2) lê `app.grant_id`; `withActor` o declara.
    const db = readFileSync(join(raiz, 'src', 'server', 'db.ts'), 'utf8');
    expect(db).toMatch(/set_config\('app\.grant_id', \$\{integration\?\.grantId \?\? ''\}, true\)/);
  });
});

/* ───────── F38, Fase 6 — a tarefa nasce com cliente ───────── */

describe('create_task e o cliente da tarefa (F38, Fase 6)', () => {
  const SHARED = 'aaaaaaa3-aaa3-4aa3-8aa3-aaaaaaaaaaa3';
  const INTERNAL = 'aaaaaaa4-aaa4-4aa4-8aa4-aaaaaaaaaaa4';
  const LIST_CANCELADA = 'aaaaaaa5-aaa5-4aa5-8aa5-aaaaaaaaaaa5';
  const OPEN_S = 'bbbbbbb7-bbb7-4bb7-8bb7-bbbbbbbbbbb7';
  const CLOSED_S = 'bbbbbbb8-bbb8-4bb8-8bb8-bbbbbbbbbbb8';
  /** O dono alcança também o cancelado e o "da empresa B". */
  const dono: PersonAccess = { ...person, clientIds: ['cliente-a', 'cliente-b', 'cliente-cancelado', 'cliente-a2'] };

  function cenario(grant: IntegrationGrant = fullGrant) {
    const store = new MemoryAgentWriteStore();
    store.seedPerson(dono);
    store.seedGrant(grant);
    const tasks = new MemoryTaskBoard({
      lists: [
        { id: LIST_A, companyId: 'empresa-a', clientId: 'cliente-a', openStatusId: OPEN_A, closedStatusId: CLOSED_A },
        { id: SHARED, companyId: 'empresa-a', clientId: null, requiresClient: true, openStatusId: OPEN_S, closedStatusId: CLOSED_S },
        { id: INTERNAL, companyId: 'empresa-a', clientId: null, openStatusId: OPEN_S, closedStatusId: CLOSED_S },
        { id: LIST_CANCELADA, companyId: 'empresa-a', clientId: 'cliente-cancelado', openStatusId: OPEN_S, closedStatusId: CLOSED_S },
      ],
      clients: [
        { id: 'cliente-a', name: 'Fonseca Moura', companyId: 'empresa-a' },
        { id: 'cliente-a2', name: 'Hiper Center', companyId: 'empresa-a' },
        { id: 'cliente-b', name: 'Cliente da Filmes', companyId: 'empresa-b' },
        { id: 'cliente-cancelado', name: 'Zeca', companyId: 'empresa-a', isActive: false, cancelledOn: '2025-12-30' },
      ],
      people: [{ id: OWNER_ID, companyIds: ['empresa-a', 'empresa-b'] }],
    });
    const ctx: WriteCtx = {
      grant,
      person: dono,
      origin: 'mcp',
      store,
      comments: new MemoryCommentBoard(OWNER_ID),
      tasks,
      now: agora,
    };
    const clienteDe = async (taskId: string) => (await tasks.snapshot({} as never, taskId))?.clientId;
    return { ctx, store, tasks, clienteDe };
  }

  it('em lista de cliente a tarefa herda o cliente da lista', async () => {
    const { ctx, clienteDe } = cenario();
    const r = await createTaskWork(ctx, { listId: LIST_A, title: 'Peça', idempotencyKey: 'herda' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await clienteDe(r.body.taskId!)).toBe('cliente-a');
  });

  it('em lista compartilhada sem clientId recusa com a frase exata, e nada é criado — inclusive no ensaio', async () => {
    const { ctx, store, tasks } = cenario();
    const r = await createTaskWork(ctx, { listId: SHARED, title: 'Atendimento', idempotencyKey: 'sem-cliente' });
    expect(r).toEqual({
      ok: false,
      code: 'invalid_input',
      message: 'Esta lista é compartilhada: informe o cliente (clientId de search)',
    });
    const ensaio = await createTaskWork(ctx, {
      listId: SHARED,
      title: 'Atendimento',
      idempotencyKey: 'sem-cliente-ensaio',
      dryRun: true,
    });
    expect(ensaio).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('em lista compartilhada com clientId cria com o cliente escolhido, e a chave cobre o cliente', async () => {
    const { ctx, clienteDe } = cenario();
    const input = { listId: SHARED, clientId: 'cliente-a', title: 'Atendimento', idempotencyKey: 'com-cliente' };
    const r = await createTaskWork(ctx, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await clienteDe(r.body.taskId!)).toBe('cliente-a');
    // A mesma chave com OUTRO cliente é outro pedido: conflito, não repetição.
    const outro = await createTaskWork(ctx, { ...input, clientId: 'cliente-a2' });
    expect(outro).toMatchObject({ ok: false, code: 'state_conflict' });
  });

  it('em lista interna o cliente é opcional', async () => {
    const { ctx, clienteDe } = cenario();
    const sem = await createTaskWork(ctx, { listId: INTERNAL, title: 'Rotina', idempotencyKey: 'interna' });
    expect(sem.ok).toBe(true);
    if (sem.ok) expect(await clienteDe(sem.body.taskId!)).toBeNull();
    const com = await createTaskWork(ctx, {
      listId: INTERNAL,
      clientId: 'cliente-a2',
      title: 'Rotina',
      idempotencyKey: 'interna-com',
    });
    expect(com.ok).toBe(true);
    if (com.ok) expect(await clienteDe(com.body.taskId!)).toBe('cliente-a2');
  });

  it('cliente cancelado é recusado, e a frase diz que está cancelado e desde quando', async () => {
    const { ctx, tasks } = cenario();
    const r = await createTaskWork(ctx, {
      listId: SHARED,
      clientId: 'cliente-cancelado',
      title: 'Atendimento',
      idempotencyKey: 'cancelado',
    });
    expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
    if (!r.ok) expect(r.message).toMatch(/Zeca foi cancelado em 30\/12\/2025/);
    expect(tasks.mutations).toBe(0);
  });

  it('na lista de cliente cancelado, sem clientId, a herança também é recusada — como a escolha explícita', async () => {
    // Auditoria de 08/10/2026: a tarefa raiz herdava o cliente da lista sem
    // conferir se ele estava ativo (a subtarefa e a escolha explícita já
    // conferiam).
    const { ctx, tasks, store } = cenario();
    const r = await createTaskWork(ctx, { listId: LIST_CANCELADA, title: 'Peça', idempotencyKey: 'herda-cancelado' });
    expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
    if (!r.ok) expect(r.message).toMatch(/Zeca foi cancelado em 30\/12\/2025/);
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('cliente fora do alcance do dono ou do recorte da conexão é permission_denied', async () => {
    const { ctx, tasks } = cenario();
    const invisivel = await createTaskWork(ctx, {
      listId: SHARED,
      clientId: 'cliente-que-nao-existe',
      title: 'X',
      idempotencyKey: 'invisivel',
    });
    expect(invisivel).toMatchObject({ ok: false, code: 'permission_denied' });
    // O dono alcança o cliente da empresa B; a conexão está recortada na A.
    const foraDoRecorte = await createTaskWork(ctx, {
      listId: SHARED,
      clientId: 'cliente-b',
      title: 'X',
      idempotencyKey: 'fora-do-recorte',
    });
    expect(foraDoRecorte).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(tasks.mutations).toBe(0);
    // Conexão recortada no cliente A: o cliente A2, que o dono alcança, fica fora.
    const recortada = cenario({ ...fullGrant, allowedClientIds: ['cliente-a'] });
    const soOutroCliente = await createTaskWork(recortada.ctx, {
      listId: SHARED,
      clientId: 'cliente-a2',
      title: 'X',
      idempotencyKey: 'so-a',
    });
    expect(soOutroCliente).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(recortada.tasks.mutations).toBe(0);
  });

  it('outro cliente numa lista de cliente é recusado: a tarefa herda o da lista', async () => {
    const { ctx, tasks } = cenario();
    const r = await createTaskWork(ctx, { listId: LIST_A, clientId: 'cliente-a2', title: 'X', idempotencyKey: 'outro' });
    expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
    if (!r.ok) expect(r.message).toMatch(/outro cliente/);
    // O MESMO cliente da lista passa.
    const mesmo = await createTaskWork(ctx, { listId: LIST_A, clientId: 'cliente-a', title: 'X', idempotencyKey: 'mesmo' });
    expect(mesmo.ok).toBe(true);
    expect(tasks.mutations).toBe(1);
  });

  it('o contrato aceita clientId (UUID) e recusa o que não é UUID', () => {
    expect(
      createTaskInputSchema.safeParse({ listId: LIST_A, clientId: LIST_B, title: 'X', idempotencyKey: 'k' }).success,
    ).toBe(true);
    expect(
      createTaskInputSchema.safeParse({ listId: LIST_A, clientId: 'zeca', title: 'X', idempotencyKey: 'k' }).success,
    ).toBe(false);
  });

  it('pelo MCP, a recusa da lista compartilhada chega com a frase exata', async () => {
    const store = new MemoryAgentWriteStore();
    store.seedPerson(dono);
    store.seedGrant(fullGrant);
    const { tasks } = cenario();
    const response = await handleMcpRequest({
      grant: fullGrant,
      person: dono,
      catalog: CATALOG,
      work: new MemoryWorkCatalog(),
      delivery: new MemoryDeliveryCatalog(),
      marketing: new MemoryMarketingCatalog(),
      writes: store,
      comments: new MemoryCommentBoard(OWNER_ID),
      tasks,
      displayNameFallback: 'Wesley Lourenço',
      now: agora,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'create_task',
        arguments: { listId: SHARED, title: 'Atendimento', idempotencyKey: 'mcp-sem-cliente' },
      }),
    });
    const result = ((await response.json()) as { result: ToolResult }).result;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('Esta lista é compartilhada: informe o cliente (clientId de search)');
    expect(tasks.mutations).toBe(0);
  });
});

describe('create_task escolhe a etapa (F38, Fase 6.3)', () => {
  const LISTA_E = 'aaaaaaa5-aaa5-4aa5-8aa5-aaaaaaaaaaa5';
  const OUTRA_E = 'aaaaaaa6-aaa6-4aa6-8aa6-aaaaaaaaaaa6';
  const A_FAZER = 'eeeeeee1-eee1-4ee1-8ee1-eeeeeeeeeee1';
  const EM_PRODUCAO = 'eeeeeee2-eee2-4ee2-8ee2-eeeeeeeeeee2';
  const APROVACAO = 'eeeeeee3-eee3-4ee3-8ee3-eeeeeeeeeee3';
  const CONCLUIDO = 'eeeeeee4-eee4-4ee4-8ee4-eeeeeeeeeee4';
  const DA_OUTRA = 'eeeeeee5-eee5-4ee5-8ee5-eeeeeeeeeee5';

  function cenario() {
    const store = new MemoryAgentWriteStore();
    store.seedPerson(person);
    store.seedGrant(fullGrant);
    const tasks = new MemoryTaskBoard({
      lists: [
        {
          id: LISTA_E,
          name: 'Fonseca Moura',
          companyId: 'empresa-a',
          clientId: 'cliente-a',
          openStatusId: A_FAZER,
          closedStatusId: CONCLUIDO,
          statuses: [
            { id: A_FAZER, name: 'a fazer', color: null, type: 'open' },
            { id: EM_PRODUCAO, name: 'em produção', color: '#f90', type: 'custom' },
            { id: APROVACAO, name: 'aprovação', color: null, type: 'custom' },
            { id: CONCLUIDO, name: 'concluído', color: null, type: 'closed' },
          ],
        },
        {
          id: OUTRA_E,
          name: 'Outra lista',
          companyId: 'empresa-a',
          clientId: 'cliente-a',
          openStatusId: DA_OUTRA,
          closedStatusId: DA_OUTRA,
          statuses: [{ id: DA_OUTRA, name: 'a fazer', color: null, type: 'open' }],
        },
      ],
      people: [{ id: OWNER_ID, companyIds: ['empresa-a'] }],
    });
    const ctx: WriteCtx = {
      grant: fullGrant,
      person,
      origin: 'mcp',
      store,
      comments: new MemoryCommentBoard(OWNER_ID),
      tasks,
      now: agora,
    };
    const lida = async (taskId: string) => (await tasks.snapshot({} as never, taskId))!;
    return { ctx, store, tasks, lida };
  }

  it('sem statusId a tarefa cai na primeira etapa, como sempre', async () => {
    const { ctx, lida } = cenario();
    const r = await createTaskWork(ctx, { listId: LISTA_E, title: 'Peça', idempotencyKey: 'sem-etapa' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await lida(r.body.taskId!)).toMatchObject({ statusId: A_FAZER, completed: false });
    expect(r.body.task.statusId).toBe(A_FAZER);
  });

  it('etapa válida da lista grava nela, aberta, e o registro guarda a etapa', async () => {
    const { ctx, lida, store } = cenario();
    const r = await createTaskWork(ctx, {
      listId: LISTA_E,
      title: 'Peça',
      statusId: EM_PRODUCAO.toUpperCase(),
      idempotencyKey: 'em-producao',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await lida(r.body.taskId!)).toMatchObject({ statusId: EM_PRODUCAO, completed: false });
    expect(r.body.task).toMatchObject({ statusId: EM_PRODUCAO, completed: false });
    const [row] = rows(store);
    expect(JSON.stringify(row.changes)).toContain(EM_PRODUCAO);
  });

  it('etapa de outra lista é recusada com status_choice_required e as opções da lista; nada é criado', async () => {
    const { ctx, tasks, store } = cenario();
    const r = await createTaskWork(ctx, {
      listId: LISTA_E,
      title: 'Peça',
      statusId: DA_OUTRA,
      idempotencyKey: 'outra-lista',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('status_choice_required');
    expect(r.listId).toBe(LISTA_E);
    expect(r.listName).toBe('Fonseca Moura');
    expect(r.taskId).toBeUndefined();
    expect(r.options?.map((o) => o.id)).toEqual([A_FAZER, EM_PRODUCAO, APROVACAO, CONCLUIDO]);
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('etapa do tipo concluída nasce concluída', async () => {
    const { ctx, lida } = cenario();
    const r = await createTaskWork(ctx, { listId: LISTA_E, title: 'Peça', statusId: CONCLUIDO, idempotencyKey: 'concluida' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await lida(r.body.taskId!)).toMatchObject({ statusId: CONCLUIDO, completed: true });
    expect(r.body.task).toMatchObject({ statusId: CONCLUIDO, completed: true });
  });

  it('o ensaio mostra a etapa escolhida sem gravar, e a recusa dele é a mesma', async () => {
    const { ctx, tasks, store } = cenario();
    const ensaio = await createTaskWork(ctx, {
      listId: LISTA_E,
      title: 'Peça',
      statusId: APROVACAO,
      idempotencyKey: 'ensaio',
      dryRun: true,
    });
    expect(ensaio.ok).toBe(true);
    if (!ensaio.ok) return;
    expect(ensaio.body.dryRun).toBe(true);
    expect(ensaio.body.taskId).toBeNull();
    expect(ensaio.body.task.statusId).toBe(APROVACAO);
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);

    const recusa = await createTaskWork(ctx, {
      listId: LISTA_E,
      title: 'Peça',
      statusId: DA_OUTRA,
      idempotencyKey: 'ensaio-recusa',
      dryRun: true,
    });
    expect(recusa.ok).toBe(false);
    if (!recusa.ok) expect(recusa.code).toBe('status_choice_required');
  });

  it('a chave de repetição cobre a etapa só quando ela vem', async () => {
    const { ctx, tasks } = cenario();
    const sem = { listId: LISTA_E, title: 'Peça', idempotencyKey: 'mesma' };
    const a = await createTaskWork(ctx, sem);
    const b = await createTaskWork(ctx, sem);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.body.replay).toBe(true);
    expect(b.body.taskId).toBe(a.body.taskId);
    expect(tasks.mutations).toBe(1);
    // A mesma chave com etapa é outro pedido: conflito, não repetição.
    const outra = await createTaskWork(ctx, { ...sem, statusId: EM_PRODUCAO });
    expect(outra.ok).toBe(false);
    if (!outra.ok) expect(outra.code).toBe('state_conflict');
  });

  it('o contrato aceita statusId (UUID) e recusa o que não é UUID', () => {
    const base = { listId: LISTA_E, title: 'X', idempotencyKey: 'k' };
    expect(createTaskInputSchema.safeParse({ ...base, statusId: EM_PRODUCAO }).success).toBe(true);
    expect(createTaskInputSchema.safeParse({ ...base, statusId: 'em-producao' }).success).toBe(false);
    expect(createTaskInputSchema.safeParse(base).success).toBe(true);
  });

  it('pelo MCP, a etapa de outra lista chega com status_choice_required e as opções', async () => {
    const { ctx, tasks, store } = cenario();
    const response = await handleMcpRequest({
      grant: fullGrant,
      person,
      catalog: CATALOG,
      work: new MemoryWorkCatalog(),
      delivery: new MemoryDeliveryCatalog(),
      marketing: new MemoryMarketingCatalog(),
      writes: store,
      comments: new MemoryCommentBoard(OWNER_ID),
      tasks,
      displayNameFallback: 'Wesley Lourenço',
      now: agora,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'create_task',
        arguments: { listId: LISTA_E, title: 'Peça', statusId: DA_OUTRA, idempotencyKey: 'mcp-outra' },
      }),
    });
    const result = ((await response.json()) as { result: ToolResult }).result;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('status_choice_required');
    expect(JSON.stringify(result)).toContain(EM_PRODUCAO);
    expect(tasks.mutations).toBe(0);
    void ctx;
  });
});

/* ───────── F38, Fase 6.4 — subtarefa pelo create_task, herdando o cliente da mãe ───────── */

describe('create_task cria subtarefa (F38, Fase 6.4)', () => {
  const SHARED = 'aaaaaaa3-aaa3-4aa3-8aa3-aaaaaaaaaaa3';
  const OPEN_S = 'bbbbbbb7-bbb7-4bb7-8bb7-bbbbbbbbbbb7';
  const CLOSED_S = 'bbbbbbb8-bbb8-4bb8-8bb8-bbbbbbbbbbb8';
  const EM_PRODUCAO = 'bbbbbbb9-bbb9-4bb9-8bb9-bbbbbbbbbbb9';
  const MAE = 'fffffff1-fff1-4ff1-8ff1-fffffffffff1';
  const MAE_ATENDIMENTO = 'fffffff2-fff2-4ff2-8ff2-fffffffffff2';
  const MAE_ARQUIVADA = 'fffffff3-fff3-4ff3-8ff3-fffffffffff3';
  const MAE_FORA = 'fffffff4-fff4-4ff4-8ff4-fffffffffff4';
  const MAE_CANCELADA = 'fffffff5-fff5-4ff5-8ff5-fffffffffff5';
  const FILHA = 'fffffff6-fff6-4ff6-8ff6-fffffffffff6';
  const NAO_EXISTE = 'fffffff9-fff9-4ff9-8ff9-fffffffffff9';
  const CLIENTE_A2 = 'c11e0002-0000-4000-8000-000000000002';
  const dono: PersonAccess = { ...person, clientIds: ['cliente-a', 'cliente-b', 'cliente-cancelado', CLIENTE_A2] };

  function cenario(grant: IntegrationGrant = fullGrant) {
    const store = new MemoryAgentWriteStore();
    store.seedPerson(dono);
    store.seedGrant(grant);
    const tasks = new MemoryTaskBoard({
      lists: [
        {
          id: LIST_A,
          name: 'Fonseca Moura',
          companyId: 'empresa-a',
          clientId: 'cliente-a',
          openStatusId: OPEN_A,
          closedStatusId: CLOSED_A,
          tagIds: [TAG_A],
          statuses: [
            { id: OPEN_A, name: 'a fazer', color: null, type: 'open' },
            { id: EM_PRODUCAO, name: 'em produção', color: null, type: 'custom' },
            { id: CLOSED_A, name: 'concluído', color: null, type: 'closed' },
          ],
        },
        {
          id: LIST_B,
          companyId: 'empresa-b',
          clientId: 'cliente-b',
          openStatusId: 'bbbbbbb5-bbb5-4bb5-8bb5-bbbbbbbbbbb5',
          closedStatusId: 'bbbbbbb6-bbb6-4bb6-8bb6-bbbbbbbbbbb6',
        },
        { id: SHARED, companyId: 'empresa-a', clientId: null, requiresClient: true, openStatusId: OPEN_S, closedStatusId: CLOSED_S },
      ],
      clients: [
        { id: 'cliente-a', name: 'Fonseca Moura', companyId: 'empresa-a' },
        { id: CLIENTE_A2, name: 'Hiper Center', companyId: 'empresa-a' },
        { id: 'cliente-b', name: 'Cliente da Filmes', companyId: 'empresa-b' },
        { id: 'cliente-cancelado', name: 'Zeca', companyId: 'empresa-a', isActive: false, cancelledOn: '2025-12-30' },
      ],
      people: [
        { id: OWNER_ID, companyIds: ['empresa-a', 'empresa-b'] },
        { id: HELENA, companyIds: ['empresa-a'] },
      ],
      tasks: [
        { taskId: MAE, listId: LIST_A, title: 'Vídeo de outubro' },
        { taskId: MAE_ATENDIMENTO, listId: SHARED, clientId: CLIENTE_A2, title: 'Atendimento do Hiper' },
        { taskId: MAE_ARQUIVADA, listId: LIST_A, title: 'Arquivada', archived: true },
        { taskId: MAE_FORA, listId: LIST_B, title: 'Da Filmes' },
        { taskId: MAE_CANCELADA, listId: SHARED, clientId: 'cliente-cancelado', title: 'Do Zeca' },
        { taskId: FILHA, listId: LIST_A, title: 'Roteiro', parentId: MAE },
      ],
    });
    const ctx: WriteCtx = {
      grant,
      person: dono,
      origin: 'mcp',
      store,
      comments: new MemoryCommentBoard(OWNER_ID),
      tasks,
      now: agora,
    };
    const lida = async (taskId: string) => (await tasks.snapshot({} as never, taskId))!;
    return { ctx, store, tasks, lida };
  }

  it('nasce na lista da mãe, herda o cliente dela, e a resposta e o registro trazem a mãe', async () => {
    const { ctx, store, tasks, lida } = cenario();
    const r = await createTaskWork(ctx, { parentId: MAE, title: TITULO, description: DESCRICAO, idempotencyKey: 'sub' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.body.taskId!;
    expect(r.body.parentId).toBe(MAE);
    expect(await lida(id)).toMatchObject({ listId: LIST_A, clientId: 'cliente-a', statusId: OPEN_A, completed: false });
    expect(tasks.parentOf(id)).toBe(MAE);
    expect(tasks.authorOf(id)).toEqual({ createdBy: OWNER_ID, completedBy: null });
    const [row] = rows(store);
    expect(row).toMatchObject({ operation: 'create_task', targetId: id });
    expect(row.changes).toMatchObject({ created: true, listId: LIST_A, parentId: MAE });
    expectNoText(row);
  });

  it('mãe numa lista compartilhada com cliente: a filha herda o cliente da mãe, sem informar clientId', async () => {
    const { ctx, lida } = cenario();
    const r = await createTaskWork(ctx, { parentId: MAE_ATENDIMENTO, title: 'Passo', idempotencyKey: 'sub-atend' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(await lida(r.body.taskId!)).toMatchObject({ listId: SHARED, clientId: CLIENTE_A2 });
  });

  it('clientId diferente do da mãe é recusado; o mesmo passa', async () => {
    const { ctx, tasks } = cenario();
    const outro = await createTaskWork(ctx, { parentId: MAE, clientId: CLIENTE_A2, title: 'X', idempotencyKey: 'outro-cli' });
    expect(outro).toMatchObject({ ok: false, code: 'invalid_input' });
    if (!outro.ok) expect(outro.message).toMatch(/herda o cliente da tarefa-mãe/);
    expect(tasks.mutations).toBe(0);
    const mesmo = await createTaskWork(ctx, {
      parentId: MAE_ATENDIMENTO,
      clientId: CLIENTE_A2.toUpperCase(),
      title: 'X',
      idempotencyKey: 'mesmo-cli',
    });
    expect(mesmo.ok).toBe(true);
  });

  it('listId diferente do da mãe é recusado; o mesmo passa', async () => {
    const { ctx, tasks } = cenario();
    const outra = await createTaskWork(ctx, { parentId: MAE, listId: SHARED, title: 'X', idempotencyKey: 'outra-lista' });
    expect(outra).toMatchObject({ ok: false, code: 'invalid_input' });
    if (!outra.ok) expect(outra.message).toMatch(/lista da tarefa-mãe/);
    expect(tasks.mutations).toBe(0);
    const mesma = await createTaskWork(ctx, { parentId: MAE, listId: LIST_A, title: 'X', idempotencyKey: 'mesma-lista' });
    expect(mesma.ok).toBe(true);
  });

  it('mãe arquivada, fora do recorte, inexistente ou de cliente cancelado: recusa com motivo e nada é criado', async () => {
    const { ctx, tasks, store } = cenario();
    expect(await createTaskWork(ctx, { parentId: MAE_ARQUIVADA, title: 'X', idempotencyKey: 'arq' })).toMatchObject({
      ok: false,
      code: 'state_conflict',
      message: expect.stringContaining('arquivada'),
    });
    // O dono alcança a empresa B; a conexão está recortada na A.
    expect(await createTaskWork(ctx, { parentId: MAE_FORA, title: 'X', idempotencyKey: 'fora' })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
    expect(await createTaskWork(ctx, { parentId: NAO_EXISTE, title: 'X', idempotencyKey: 'nada' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    const cancelada = await createTaskWork(ctx, { parentId: MAE_CANCELADA, title: 'X', idempotencyKey: 'cancelada' });
    expect(cancelada).toMatchObject({ ok: false, code: 'invalid_input' });
    if (!cancelada.ok) expect(cancelada.message).toMatch(/Zeca foi cancelado em 30\/12\/2025/);
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
    // Conexão recortada no cliente A: a mãe do Hiper Center fica fora.
    const recortada = cenario({ ...fullGrant, allowedClientIds: ['cliente-a'] });
    expect(
      await createTaskWork(recortada.ctx, { parentId: MAE_ATENDIMENTO, title: 'X', idempotencyKey: 'so-a' }),
    ).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(recortada.tasks.mutations).toBe(0);
  });

  it('subtarefa de subtarefa é aceita (o quadro tem profundidade livre) e herda o mesmo cliente', async () => {
    const { ctx, tasks, lida } = cenario();
    const r = await createTaskWork(ctx, { parentId: FILHA, title: 'Neta', idempotencyKey: 'neta' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(tasks.parentOf(r.body.taskId!)).toBe(FILHA);
    expect(await lida(r.body.taskId!)).toMatchObject({ listId: LIST_A, clientId: 'cliente-a' });
  });

  it('statusId vale a esteira da lista da mãe; de outra lista é status_choice_required com as opções da lista da mãe', async () => {
    const { ctx, tasks, lida } = cenario();
    const r = await createTaskWork(ctx, { parentId: MAE, statusId: EM_PRODUCAO, title: 'X', idempotencyKey: 'etapa' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(await lida(r.body.taskId!)).toMatchObject({ statusId: EM_PRODUCAO, completed: false });
    const fechada = await createTaskWork(ctx, { parentId: MAE, statusId: CLOSED_A, title: 'X', idempotencyKey: 'etapa-f' });
    expect(fechada.ok && fechada.body.task.completed).toBe(true);
    const alheia = await createTaskWork(ctx, { parentId: MAE, statusId: OPEN_S, title: 'X', idempotencyKey: 'etapa-x' });
    expect(alheia).toMatchObject({ ok: false, code: 'status_choice_required', listId: LIST_A, listName: 'Fonseca Moura' });
    if (!alheia.ok) expect(alheia.options?.map((o) => o.id)).toEqual([OPEN_A, EM_PRODUCAO, CLOSED_A]);
    expect(tasks.mutations).toBe(2);
  });

  it('o ensaio confere tudo, mostra a mãe e não grava; a recusa do ensaio é a mesma', async () => {
    const { ctx, tasks, store } = cenario();
    const ensaio = await createTaskWork(ctx, { parentId: MAE, title: 'X', idempotencyKey: 'ensaio', dryRun: true });
    expect(ensaio.ok).toBe(true);
    if (!ensaio.ok) return;
    expect(ensaio.body).toMatchObject({ dryRun: true, taskId: null, parentId: MAE, task: { listId: LIST_A } });
    expect(ensaio.body.dailyWrites).toMatchObject({ used: 0, limit: 50 });
    const recusa = await createTaskWork(ctx, { parentId: MAE_ARQUIVADA, title: 'X', idempotencyKey: 'ensaio-r', dryRun: true });
    expect(recusa).toMatchObject({ ok: false, code: 'state_conflict' });
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('chave de repetição: repetir não duplica; a mesma chave sem a mãe é outro pedido; sem listId nem parentId é invalid_input', async () => {
    const { ctx, tasks } = cenario();
    const input = { parentId: MAE, title: 'Passo', idempotencyKey: 'mesma' };
    const a = await createTaskWork(ctx, input);
    const b = await createTaskWork(ctx, input);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.body).toMatchObject({ replay: true, taskId: a.body.taskId, parentId: MAE });
    expect(tasks.mutations).toBe(1);
    const semMae = await createTaskWork(ctx, { listId: LIST_A, title: 'Passo', idempotencyKey: 'mesma' });
    expect(semMae).toMatchObject({ ok: false, code: 'state_conflict' });
    const nenhum = await createTaskWork(ctx, { title: 'Passo', idempotencyKey: 'nenhum' });
    expect(nenhum).toMatchObject({ ok: false, code: 'invalid_input', message: expect.stringContaining('parentId') });
  });

  it('entra no teto diário: depois de 50 escritas, a subtarefa é recusada com daily_write_limit', async () => {
    const { ctx, tasks } = cenario();
    for (let i = 0; i < 50; i += 1) {
      expect((await createTaskWork(ctx, { parentId: MAE, title: `Passo ${i}`, idempotencyKey: `laco-${i}` })).ok).toBe(true);
    }
    expect(await createTaskWork(ctx, { parentId: MAE, title: 'A 51ª', idempotencyKey: 'laco-51' })).toMatchObject({
      ok: false,
      code: 'daily_write_limit',
    });
    expect(tasks.mutations).toBe(50);
  });

  it('responsáveis e etiquetas valem na subtarefa, com as mesmas conferências da criação', async () => {
    const { ctx, lida } = cenario();
    const r = await createTaskWork(ctx, {
      parentId: MAE,
      title: 'X',
      assigneeIds: [HELENA],
      tagIds: [TAG_A],
      idempotencyKey: 'pessoas',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(await lida(r.body.taskId!)).toMatchObject({ assigneeIds: [HELENA], tagIds: [TAG_A] });
    const fora = await createTaskWork(ctx, { parentId: MAE, title: 'X', tagIds: [TAG_OTHER], idempotencyKey: 'etiqueta' });
    expect(fora.ok).toBe(false);
  });

  it('o contrato aceita parentId sem listId e recusa parentId que não é UUID; pedidos antigos seguem válidos', () => {
    expect(createTaskInputSchema.safeParse({ parentId: MAE, title: 'X', idempotencyKey: 'k' }).success).toBe(true);
    expect(createTaskInputSchema.safeParse({ parentId: 'mae', title: 'X', idempotencyKey: 'k' }).success).toBe(false);
    expect(createTaskInputSchema.safeParse({ listId: LIST_A, title: 'X', idempotencyKey: 'k' }).success).toBe(true);
    const json = jsonSchemaFromZod(createTaskInputSchema) as { required?: string[]; properties: Record<string, unknown> };
    expect(json.required).toEqual(['title', 'idempotencyKey']);
    expect(Object.keys(json.properties)).toContain('parentId');
  });

  it('pelo MCP, create_task com parentId cria a subtarefa e a resposta traz a mãe', async () => {
    const { tasks, store } = cenario();
    const response = await handleMcpRequest({
      grant: fullGrant,
      person: dono,
      catalog: CATALOG,
      work: new MemoryWorkCatalog(),
      delivery: new MemoryDeliveryCatalog(),
      marketing: new MemoryMarketingCatalog(),
      writes: store,
      comments: new MemoryCommentBoard(OWNER_ID),
      tasks,
      displayNameFallback: 'Wesley Lourenço',
      now: agora,
      origin: 'mcp',
      request: mcpPost('tools/call', {
        name: 'create_task',
        arguments: { parentId: MAE, title: 'Passo', idempotencyKey: 'mcp-sub' },
      }),
    });
    const result = ((await response.json()) as { result: ToolResult }).result;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ operation: 'create_task', parentId: MAE });
    expect(tasks.parentOf(String(result.structuredContent?.taskId))).toBe(MAE);
  });
});
