/**
 * O tipo da tarefa pelo MCP e pela API de integração — F40, Fase 3.
 *
 * `create_task` e `update_task` aceitam `type` (video, arte, foto, outros);
 * em lista de PRODUÇÃO a criação sem tipo é recusada com `type_required` e as
 * quatro opções, a MESMA recusa da tela. O ensaio (`dryRun`) mostra o tipo, o
 * desfazer em lote devolve o tipo anterior, e as leituras (`get_task`,
 * `get_board`, `get_person_work`, `get_workflow`) devolvem o tipo e dizem se a
 * lista é de produção. Port em memória: a prova contra o Postgres é feita à
 * parte (a regra mora em `ideworks.list_is_production`).
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  CREATE_TASK_PATH,
  ERROR_STATUS,
  INTEGRATION_ERROR_CODES,
  TASK_DEMAND_TYPES,
  createTaskInputSchema,
  getTaskResponseSchema,
  getWorkflowResponseSchema,
  integrationOpenApi,
  typeRequiredSchema,
  updateTaskInputSchema,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { MemoryAgentWriteStore } from '@/integrations/executions';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import {
  MemoryWorkCatalog,
  getBoardWork,
  getPersonWork,
  getTaskWork,
  getWorkflowWork,
  type MemoryBoard,
  type ReadCtx,
} from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';
import { MemoryUndoStore, undoGrantWrites } from '@/integrations/undo';
import {
  MemoryCommentBoard,
  MemoryTaskBoard,
  createTaskWork,
  updateTaskWork,
  type WriteCtx,
} from '@/integrations/writes';
import { FRASE_TIPO_OBRIGATORIO, OPCOES_DO_TIPO, TIPOS_DA_TAREFA } from '@/server/tipo-da-tarefa';

const agora = new Date('2026-10-07T15:00:00.000Z');
const ORIGIN = 'https://ideworks.test';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCAO = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const INTERNA = 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2';
const ABERTA = 'bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1';
const FECHADA = 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2';
const MAE = 'ddddddd1-ddd1-4dd1-8dd1-ddddddddddd1';
const CARD_ANTIGO = 'ddddddd2-ddd2-4dd2-8dd2-ddddddddddd2';
const CARD_INTERNO = 'ddddddd3-ddd3-4dd3-8dd3-ddddddddddd3';

const person: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a'],
  clientIds: ['cliente-a'],
  hasAllClientsAccess: false,
};

const grant: IntegrationGrant = {
  id: GRANT_ID,
  ownerId: OWNER_ID,
  oauthClientId: 'ideworks-claude',
  name: 'Claude da agência',
  capabilities: [...READ_CAPABILITIES, 'tasks:write', 'tasks:assign', 'tasks:complete'],
  allowedCompanyIds: ['empresa-a'],
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

function mundo() {
  const store = new MemoryAgentWriteStore();
  store.seedPerson(person);
  store.seedGrant(grant);
  const comments = new MemoryCommentBoard(OWNER_ID);
  const tasks = new MemoryTaskBoard({
    lists: [
      {
        id: PRODUCAO,
        name: 'Produção do cliente',
        companyId: 'empresa-a',
        clientId: 'cliente-a',
        openStatusId: ABERTA,
        closedStatusId: FECHADA,
        isProduction: true,
      },
      { id: INTERNA, companyId: 'empresa-a', clientId: null, openStatusId: ABERTA, closedStatusId: FECHADA },
    ],
    people: [{ id: OWNER_ID, companyIds: ['empresa-a'] }],
    tasks: [
      // Card de antes do F40, numa lista de produção: sem tipo.
      { taskId: CARD_ANTIGO, listId: PRODUCAO, title: 'Card antigo' },
      { taskId: CARD_INTERNO, listId: INTERNA, title: 'Interna' },
      { taskId: MAE, listId: PRODUCAO, title: 'Mãe', type: 'video' },
    ],
  });
  // Cada escrita 5 minutos depois da anterior, como numa conversa de verdade.
  let relogio = agora.getTime();
  const ctx = (): WriteCtx => {
    relogio += 5 * 60_000;
    return { grant, person, origin: 'mcp', store, comments, tasks, now: new Date(relogio) };
  };
  const undo = new MemoryUndoStore(store, comments, OWNER_ID, { tasks });
  const tipoDe = async (taskId: string) => (await tasks.snapshot({} as never, taskId))?.type;
  return { store, tasks, ctx, undo, tipoDe, comments };
}

const OPCOES = [
  { value: 'video', label: 'Vídeo' },
  { value: 'arte', label: 'Arte' },
  { value: 'foto', label: 'Foto' },
  { value: 'outros', label: 'Outros' },
];

describe('contrato do tipo', () => {
  it('o vocabulário do contrato é o do servidor, e a recusa é um código próprio com status 400', () => {
    expect([...TASK_DEMAND_TYPES]).toEqual([...TIPOS_DA_TAREFA]);
    expect(INTEGRATION_ERROR_CODES).toContain('type_required');
    expect(ERROR_STATUS.type_required).toBe(400);
  });

  it('create_task aceita os quatro tipos e recusa outro; update_task aceita null para apagar', () => {
    for (const type of TASK_DEMAND_TYPES) {
      expect(createTaskInputSchema.safeParse({ listId: PRODUCAO, title: 'x', type, idempotencyKey: 'k' }).success).toBe(true);
    }
    expect(createTaskInputSchema.safeParse({ listId: PRODUCAO, title: 'x', type: 'audio', idempotencyKey: 'k' }).success).toBe(false);
    expect(updateTaskInputSchema.safeParse({ taskId: MAE, type: null, idempotencyKey: 'k' }).success).toBe(true);
    expect(updateTaskInputSchema.safeParse({ taskId: MAE, type: 'audio', idempotencyKey: 'k' }).success).toBe(false);
  });

  it('o OpenAPI publica o tipo nas entradas e o erro type_required nos componentes', () => {
    const doc = integrationOpenApi() as unknown as {
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    expect(doc.components.schemas.CreateTaskInput.properties).toHaveProperty('type');
    expect(doc.components.schemas.UpdateTaskInput.properties).toHaveProperty('type');
    expect(doc.components.schemas.TypeRequired).toBeDefined();
    expect(doc.components.schemas.IntegrationError.properties).toHaveProperty('error');
  });
});

describe('create_task e o tipo', () => {
  it('lista de produção sem tipo: type_required com a frase da tela e as quatro opções; nada é criado, nem no ensaio', async () => {
    const m = mundo();
    for (const dryRun of [false, true]) {
      const r = await createTaskWork(m.ctx(), {
        listId: PRODUCAO,
        title: 'Peça',
        idempotencyKey: `sem-tipo-${dryRun}`,
        dryRun,
      });
      expect(r).toMatchObject({ ok: false, code: 'type_required', listId: PRODUCAO });
      if (r.ok) return;
      expect(r.message.startsWith(FRASE_TIPO_OBRIGATORIO)).toBe(true);
      expect(r.typeOptions).toEqual(OPCOES);
      expect(r.typeOptions).toEqual(OPCOES_DO_TIPO);
    }
    expect(m.tasks.mutations).toBe(0);
    expect(m.store.executions.size).toBe(0);
  });

  it('com tipo grava, devolve task.type e o registro guarda o tipo', async () => {
    const m = mundo();
    const r = await createTaskWork(m.ctx(), { listId: PRODUCAO, title: 'Peça', type: 'video', idempotencyKey: 'com-tipo' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.task.type).toBe('video');
    expect(await m.tipoDe(r.body.taskId!)).toBe('video');
    const [row] = [...m.store.executions.values()];
    expect((row.changes.after as Record<string, unknown>).type).toBe('video');
  });

  it('em lista interna o tipo é opcional: sem ele vem null, com ele grava', async () => {
    const m = mundo();
    const sem = await createTaskWork(m.ctx(), { listId: INTERNA, title: 'Interna', idempotencyKey: 'interna-1' });
    expect(sem.ok && sem.body.task.type).toBeNull();
    const com = await createTaskWork(m.ctx(), { listId: INTERNA, title: 'Interna 2', type: 'foto', idempotencyKey: 'interna-2' });
    expect(com.ok && com.body.task.type).toBe('foto');
  });

  it('o ensaio mostra o tipo sem gravar nada', async () => {
    const m = mundo();
    const r = await createTaskWork(m.ctx(), {
      listId: PRODUCAO,
      title: 'Peça',
      type: 'arte',
      idempotencyKey: 'ensaio',
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toMatchObject({ dryRun: true, taskId: null, task: { type: 'arte' } });
    expect(m.tasks.mutations).toBe(0);
    expect(m.store.executions.size).toBe(0);
  });

  it('a chave de repetição cobre o tipo: mesma chave com outro tipo é conflito', async () => {
    const m = mundo();
    const a = await createTaskWork(m.ctx(), { listId: PRODUCAO, title: 'Peça', type: 'arte', idempotencyKey: 'mesma' });
    expect(a.ok).toBe(true);
    const b = await createTaskWork(m.ctx(), { listId: PRODUCAO, title: 'Peça', type: 'foto', idempotencyKey: 'mesma' });
    expect(b.ok).toBe(false);
  });

  it('subtarefa não tem tipo: type com parentId é invalid_input, e sem type a subtarefa nasce', async () => {
    const m = mundo();
    const com = await createTaskWork(m.ctx(), { parentId: MAE, title: 'Legenda', type: 'video', idempotencyKey: 'sub-1' });
    expect(com).toMatchObject({ ok: false, code: 'invalid_input' });
    const sem = await createTaskWork(m.ctx(), { parentId: MAE, title: 'Legenda', idempotencyKey: 'sub-2' });
    expect(sem.ok).toBe(true);
    expect(sem.ok && sem.body.task.type).toBeNull();
  });
});

describe('update_task e o tipo', () => {
  it('troca o tipo, o registro guarda antes e depois, e o desfazer em lote volta o anterior', async () => {
    const m = mundo();
    const criada = await createTaskWork(m.ctx(), { listId: PRODUCAO, title: 'Peça', type: 'video', idempotencyKey: 'k1' });
    if (!criada.ok) throw new Error('preparo');
    const taskId = criada.body.taskId!;
    const troca = await updateTaskWork(m.ctx(), { taskId, type: 'arte', idempotencyKey: 'k2' });
    expect(troca.ok && troca.body.task.type).toBe('arte');
    const row = [...m.store.executions.values()].find((r) => r.operation === 'update_task')!;
    expect(row.changes).toMatchObject({ before: { type: 'video' }, after: { type: 'arte' } });

    const outcome = await undoGrantWrites({ store: m.undo, grantId: GRANT_ID, ownerId: OWNER_ID, now: agora });
    const item = outcome.items.find((i) => i.operation === 'update_task')!;
    expect(item.status).toBe('undone');
    expect(item.message).toMatch(/o tipo voltou ao valor anterior/i);
    // A criação foi desfeita junto (arquivada), mas o tipo da troca voltou antes disso.
    expect(m.tasks.tasks.get(taskId)).toMatchObject({ type: 'video', archived: true });
  });

  it('o desfazer devolve null quando o tipo anterior era vazio (lista interna)', async () => {
    const m = mundo();
    const troca = await updateTaskWork(m.ctx(), { taskId: CARD_INTERNO, type: 'foto', idempotencyKey: 'k1' });
    expect(troca.ok && troca.body.task.type).toBe('foto');
    const outcome = await undoGrantWrites({ store: m.undo, grantId: GRANT_ID, ownerId: OWNER_ID, now: agora });
    expect(outcome.undone).toBe(1);
    expect(await m.tipoDe(CARD_INTERNO)).toBeNull();
  });

  it('card antigo sem tipo em lista de produção: ganha tipo; apagar de novo é type_required com o taskId', async () => {
    const m = mundo();
    const ganha = await updateTaskWork(m.ctx(), { taskId: CARD_ANTIGO, type: 'outros', idempotencyKey: 'k1' });
    expect(ganha.ok && ganha.body.task.type).toBe('outros');
    const apaga = await updateTaskWork(m.ctx(), { taskId: CARD_ANTIGO, type: null, idempotencyKey: 'k2' });
    expect(apaga).toMatchObject({ ok: false, code: 'type_required', taskId: CARD_ANTIGO });
    if (apaga.ok) return;
    expect(apaga.typeOptions).toEqual(OPCOES);
    expect(await m.tipoDe(CARD_ANTIGO)).toBe('outros');
  });

  it('em lista de produção o desfazer NÃO apaga o tipo: a volta é recusada com a frase do banco e o tipo fica', async () => {
    const m = mundo();
    await updateTaskWork(m.ctx(), { taskId: CARD_ANTIGO, type: 'arte', idempotencyKey: 'k1' });
    const outcome = await undoGrantWrites({ store: m.undo, grantId: GRANT_ID, ownerId: OWNER_ID, now: agora });
    const item = outcome.items.find((i) => i.operation === 'update_task')!;
    expect(item.status).toBe('skipped');
    expect(item.message).toContain(FRASE_TIPO_OBRIGATORIO);
    expect(await m.tipoDe(CARD_ANTIGO)).toBe('arte');
  });

  it('o ensaio mostra o tipo novo sem mexer na tarefa', async () => {
    const m = mundo();
    const r = await updateTaskWork(m.ctx(), { taskId: CARD_ANTIGO, type: 'foto', idempotencyKey: 'k1', dryRun: true });
    expect(r.ok && r.body.task.type).toBe('foto');
    expect(await m.tipoDe(CARD_ANTIGO)).toBeNull();
  });
});

describe('o tipo pelo MCP e pela HTTP', () => {
  function shared() {
    const m = mundo();
    return {
      m,
      shared: {
        grant,
        person,
        catalog: new MemoryCatalog([{ id: 'empresa-a', name: 'Agência Ide' }], new Map([[OWNER_ID, 'Wesley Lourenço']])),
        work: new MemoryWorkCatalog(),
        delivery: new MemoryDeliveryCatalog(),
        marketing: new MemoryMarketingCatalog(),
        writes: m.store,
        comments: m.comments,
        tasks: m.tasks,
        displayNameFallback: 'Wesley Lourenço',
        now: agora,
      },
    };
  }

  async function chamar(s: ReturnType<typeof shared>['shared'], name: string, args: unknown) {
    const response = await handleMcpRequest({
      ...s,
      origin: 'mcp',
      request: new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }),
    });
    return ((await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
    }).result;
  }

  it('create_task sem tipo chega como type_required, com as opções e a lista; com tipo grava', async () => {
    const { m, shared: s } = shared();
    const recusa = await chamar(s, 'create_task', { listId: PRODUCAO, title: 'Peça', idempotencyKey: 'mcp-1' });
    expect(recusa.isError).toBe(true);
    const payload = JSON.parse(recusa.content[0].text) as Record<string, unknown>;
    expect(typeRequiredSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({ error: 'type_required', listId: PRODUCAO, options: OPCOES });
    expect(String(payload.message).startsWith(FRASE_TIPO_OBRIGATORIO)).toBe(true);
    expect(m.tasks.mutations).toBe(0);

    const ok = await chamar(s, 'create_task', { listId: PRODUCAO, title: 'Peça', type: 'video', idempotencyKey: 'mcp-2' });
    expect(ok.isError).toBeFalsy();
    expect((ok.structuredContent as { task: { type: string } }).task.type).toBe('video');
    expect(ok.content[0].text).toContain('tipo video');
  });

  it('update_task troca o tipo; apagar em lista de produção chega como type_required com o taskId', async () => {
    const { shared: s } = shared();
    const troca = await chamar(s, 'update_task', { taskId: MAE, type: 'arte', idempotencyKey: 'mcp-3' });
    expect((troca.structuredContent as { task: { type: string } }).task.type).toBe('arte');
    const apaga = await chamar(s, 'update_task', { taskId: MAE, type: null, idempotencyKey: 'mcp-4' });
    expect(apaga.isError).toBe(true);
    expect(JSON.parse(apaga.content[0].text)).toMatchObject({ error: 'type_required', taskId: MAE, options: OPCOES });
  });

  it('as descrições das ferramentas dizem que o tipo é obrigatório em lista de produção e como saber', async () => {
    const { shared: s } = shared();
    const response = await handleMcpRequest({
      ...s,
      origin: 'mcp',
      request: new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
    });
    const { result } = (await response.json()) as {
      result: { tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, unknown> } }> };
    };
    const create = result.tools.find((t) => t.name === 'create_task')!;
    expect(create.inputSchema.properties).toHaveProperty('type');
    expect(create.description).toMatch(/type_required/);
    expect(create.description).toMatch(/isProduction/);
    expect(create.description).toMatch(/atribuir demanda/);
    const update = result.tools.find((t) => t.name === 'update_task')!;
    expect(update.inputSchema.properties).toHaveProperty('type');
  });

  it('HTTP: create_task sem tipo é 400 com type_required e as opções', async () => {
    const { shared: s } = shared();
    const response = await dispatchIntegrationHttp({
      ...s,
      origin: 'http',
      request: new Request(`${ORIGIN}${CREATE_TASK_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'http-1' },
        body: JSON.stringify({ listId: PRODUCAO, title: 'Peça' }),
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeRequiredSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ error: 'type_required', options: OPCOES });
  });
});

describe('as leituras devolvem o tipo e dizem se a lista é de produção', () => {
  const L_PROD = '00000000-0000-4000-8000-000000000001';
  const L_NORMAL = '00000000-0000-4000-8000-000000000002';
  const F_PASTA = '00000000-0000-4000-8000-000000000010';
  const T_VIDEO = '00000000-0000-4000-8000-000000000101';
  const T_SEM = '00000000-0000-4000-8000-000000000102';
  const PESSOA = '00000000-0000-4000-8000-000000000201';
  const etapas = (nomeDaPrimeira: string) => [
    { id: '00000000-0000-4000-8000-000000000301', name: nomeDaPrimeira, sortOrder: 0, type: 'open' as const },
    { id: '00000000-0000-4000-8000-000000000302', name: 'Feito', sortOrder: 1, type: 'closed' as const },
  ];
  const board = (id: string, name: string, statuses: MemoryBoard['statuses'], extra: Partial<MemoryBoard> = {}): MemoryBoard => ({
    id,
    name,
    companyId: 'empresa-a',
    companyName: 'Agência Ide',
    spaceId: 'espaco',
    spaceName: 'CLIENTES',
    folderId: null,
    folderName: null,
    clientId: null,
    clientName: null,
    canSeeSpace: true,
    statuses,
    ...extra,
  });
  const work = new MemoryWorkCatalog({
    boards: [
      // Sem `isProduction` explícito: o dublê deduz pelo nome da etapa, sem acento e sem maiúscula.
      board(L_PROD, 'Produção', etapas('Atribuir Demanda')),
      board(L_NORMAL, 'Interna', etapas('A fazer')),
    ],
    folders: [
      {
        id: F_PASTA,
        name: 'Pasta',
        companyId: 'empresa-a',
        companyName: 'Agência Ide',
        canSeeSpace: true,
        workflow: { inheritedFrom: 'space', ownerId: 'espaco', ownerName: 'CLIENTES', name: 'Padrão' },
        statuses: etapas('Atribuir demanda'),
      },
    ],
    tasks: [
      {
        id: T_VIDEO,
        title: 'Com tipo',
        description: null,
        companyId: 'empresa-a',
        companyName: 'Agência Ide',
        boardId: L_PROD,
        clientId: null,
        clientName: null,
        statusId: '00000000-0000-4000-8000-000000000301',
        dueOn: null,
        type: 'video',
        people: [{ id: PESSOA, name: 'Helena' }],
      },
      {
        id: T_SEM,
        title: 'Sem tipo',
        description: null,
        companyId: 'empresa-a',
        companyName: 'Agência Ide',
        boardId: L_NORMAL,
        clientId: null,
        clientName: null,
        statusId: '00000000-0000-4000-8000-000000000301',
        dueOn: null,
        people: [{ id: PESSOA, name: 'Helena' }],
      },
    ],
    people: [
      { id: PESSOA, name: 'Helena', companyId: 'empresa-a', companyName: 'Agência Ide', detail: null },
    ],
  });
  const ctx: ReadCtx = {
    grant: { ...grant, capabilities: [...READ_CAPABILITIES] },
    person,
    origin: 'http',
    companies: [{ id: 'empresa-a', name: 'Agência Ide' }],
    displayName: 'Wesley Lourenço',
    work,
    now: agora,
  };

  it('get_task devolve o tipo (e null quando não tem)', async () => {
    const com = await getTaskWork(ctx, { id: T_VIDEO });
    expect(com.ok && com.body.task.type).toBe('video');
    if (com.ok) expect(getTaskResponseSchema.safeParse(com.body).success).toBe(true);
    const sem = await getTaskWork(ctx, { id: T_SEM });
    expect(sem.ok && sem.body.task.type).toBeNull();
  });

  it('get_board devolve o tipo em cada cartão', async () => {
    const r = await getBoardWork(ctx, { id: L_PROD });
    expect(r.ok && r.body.board.tasks.map((t) => [t.id, t.type])).toEqual([[T_VIDEO, 'video']]);
  });

  it('get_person_work devolve o tipo em cada item', async () => {
    const r = await getPersonWork(ctx, { id: PESSOA });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const porId = Object.fromEntries(r.body.items.map((item) => [item.id, item.type]));
    expect(porId).toEqual({ [T_VIDEO]: 'video', [T_SEM]: null });
  });

  it('get_workflow diz isProduction para a lista (true na de produção, false na outra) e null para a pasta', async () => {
    const producao = await getWorkflowWork(ctx, { listId: L_PROD });
    expect(producao.ok && producao.body.workflow.isProduction).toBe(true);
    if (producao.ok) expect(getWorkflowResponseSchema.safeParse(producao.body).success).toBe(true);
    const normal = await getWorkflowWork(ctx, { listId: L_NORMAL });
    expect(normal.ok && normal.body.workflow.isProduction).toBe(false);
    const pasta = await getWorkflowWork(ctx, { folderId: F_PASTA });
    expect(pasta.ok && pasta.body.workflow.isProduction).toBeNull();
  });
});
