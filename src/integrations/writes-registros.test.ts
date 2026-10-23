/**
 * Mural e histórico do cliente pelo agente — F26.6.
 *
 * Leituras (`get_client_mural`, `get_client_history`) sob `clients:read` e o
 * recorte da conexão; escritas (`add_mural_note`, `update_mural_note`,
 * `add_history_entry`, `update_history_entry`) pelo mesmo caminho das de
 * tarefa (F26.5): permissão, recorte, chave de repetição, teto do dia, ensaio
 * e registro sem texto. A regra "a IA só edita o que a IA da mesma pessoa
 * escreveu" é do BANCO (F26.2); aqui o port em memória a imita com a frase
 * literal, e a prova contra o Postgres é `scripts/provar-mural-e-historico-pela-ia.mjs`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  ADD_HISTORY_ENTRY_PATH,
  ADD_MURAL_NOTE_PATH,
  GET_CLIENT_HISTORY_PATH,
  GET_CLIENT_MURAL_PATH,
  INTEGRATION_WRITES_UNAVAILABLE_MESSAGE,
  MURAL_NOTE_COLORS,
  UPDATE_HISTORY_ENTRY_PATH,
  UPDATE_MURAL_NOTE_PATH,
  addHistoryEntryInputSchema,
  addHistoryEntryOpenApiExample,
  addHistoryEntryResponseSchema,
  addMuralNoteInputSchema,
  addMuralNoteOpenApiExample,
  addMuralNoteResponseSchema,
  getClientHistoryInputSchema,
  getClientHistoryOpenApiExample,
  getClientHistoryResponseSchema,
  getClientMuralInputSchema,
  getClientMuralOpenApiExample,
  getClientMuralResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
  updateHistoryEntryInputSchema,
  updateHistoryEntryOpenApiExample,
  updateHistoryEntryResponseSchema,
  updateMuralNoteInputSchema,
  updateMuralNoteOpenApiExample,
  updateMuralNoteResponseSchema,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import {
  AGENT_WRITE_OPERATIONS,
  MemoryAgentWriteStore,
  WRITE_OPERATION_CAPABILITY,
  type PersistedExecution,
} from '@/integrations/executions';
import {
  CAPABILITY_LABELS,
  READ_CAPABILITIES,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import {
  MCP_CLIENT_RECORD_WRITE_TOOL_NAMES,
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  handleMcpRequest,
} from '@/integrations/mcp';
import {
  MemoryWorkCatalog,
  getClientHistoryWork,
  getClientMuralWork,
  type MemoryHistoryEntry,
  type MemoryMuralNote,
  type ReadCtx,
} from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';
import {
  AGENT_HISTORY_GUARD_MESSAGE,
  AGENT_MURAL_GUARD_MESSAGE,
  MemoryClientRecordBoard,
  MemoryCommentBoard,
  addHistoryEntryWork,
  addMuralNoteWork,
  updateHistoryEntryWork,
  updateMuralNoteWork,
  type WriteCtx,
} from '@/integrations/writes';
import { CORES_DA_NOTA } from '@/server/mural-e-captacao';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const agora = new Date('2026-09-22T15:00:00.000Z');
const ORIGIN = 'https://ideworks.test';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const HELENA = '33333333-3333-4333-8333-333333333333';
const CAROL_B = '44444444-4444-4444-8444-444444444444';
const FORA = '66666666-6666-4666-8666-666666666666';
const CLIENTE_A = 'c1111111-1111-4111-8111-111111111111';
const CLIENTE_B = 'c2222222-2222-4222-8222-222222222222';
const CLIENTE_X = 'c9999999-9999-4999-8999-999999999999';
const NOTA_DA_IA = 'a1111111-1111-4111-8111-111111111111';
const NOTA_HUMANA = 'a2222222-2222-4222-8222-222222222222';
const NOTA_DE_OUTRA_IA = 'a3333333-3333-4333-8333-333333333333';
const NOTA_B = 'a4444444-4444-4444-8444-444444444444';
const REG_DA_IA = 'b1111111-1111-4111-8111-111111111111';
const REG_HUMANO = 'b2222222-2222-4222-8222-222222222222';

const TEXTO = 'Cliente pediu sigilo sobre a campanha de outubro — nunca vai para o registro.';
const TITULO = 'Título secreto da nota';
const RELATO = 'Relato longo da reunião, que também nunca vai para o registro.';

/** O dono alcança as duas empresas e os dois clientes; a concessão, só a empresa A. */
const person: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a', 'empresa-b'],
  clientIds: [CLIENTE_A, CLIENTE_B],
  hasAllClientsAccess: false,
};

const RECORD_CAPS = ['clients:mural:write', 'clients:history:write'] as const;

const fullGrant: IntegrationGrant = {
  id: GRANT_ID,
  ownerId: OWNER_ID,
  oauthClientId: 'ideworks-claude',
  name: 'Claude da agência',
  capabilities: [...READ_CAPABILITIES, ...RECORD_CAPS],
  allowedCompanyIds: ['empresa-a'],
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const readGrant: IntegrationGrant = { ...fullGrant, capabilities: [...READ_CAPABILITIES] };
const muralOnlyGrant: IntegrationGrant = {
  ...fullGrant,
  capabilities: [...READ_CAPABILITIES, 'clients:mural:write'],
};

function board() {
  return new MemoryClientRecordBoard(
    { ownerId: OWNER_ID, viaName: 'Claude da agência' },
    {
      clients: [
        { id: CLIENTE_A, companyId: 'empresa-a' },
        { id: CLIENTE_B, companyId: 'empresa-b' },
      ],
      people: [
        { id: OWNER_ID, companyIds: ['empresa-a', 'empresa-b'] },
        { id: HELENA, companyIds: ['empresa-a'] },
        { id: CAROL_B, companyIds: ['empresa-b'] },
      ],
      notes: [
        { noteId: NOTA_DA_IA, clientId: CLIENTE_A, content: 'nota da IA', createdBy: OWNER_ID, viaName: 'ChatGPT' },
        { noteId: NOTA_HUMANA, clientId: CLIENTE_A, content: 'nota à mão', createdBy: OWNER_ID, viaName: null },
        { noteId: NOTA_DE_OUTRA_IA, clientId: CLIENTE_A, content: 'da Helena', createdBy: HELENA, viaName: 'Claude' },
        { noteId: NOTA_B, clientId: CLIENTE_B, content: 'fora do recorte', createdBy: OWNER_ID, viaName: 'Claude' },
      ],
      entries: [
        {
          entryId: REG_DA_IA,
          clientId: CLIENTE_A,
          happenedOn: '2026-09-10',
          title: 'Reunião',
          subtitle: 'Kickoff',
          body: 'relato antigo',
          ledBy: HELENA,
          createdBy: OWNER_ID,
          viaName: 'Claude da agência',
        },
        { entryId: REG_HUMANO, clientId: CLIENTE_A, createdBy: OWNER_ID, viaName: null },
      ],
    },
  );
}

function setup(grant: IntegrationGrant = fullGrant) {
  const store = new MemoryAgentWriteStore();
  store.seedPerson(person);
  store.seedGrant(grant);
  const records = board();
  const ctx: WriteCtx = {
    grant,
    person,
    origin: 'mcp',
    store,
    comments: new MemoryCommentBoard(OWNER_ID),
    clientRecords: records,
    now: agora,
  };
  return { store, records, ctx };
}

function rows(store: MemoryAgentWriteStore): PersistedExecution[] {
  return [...store.executions.values()];
}

/** O registro nunca guarda texto: nem as chaves proibidas, nem o conteúdo, em lugar nenhum. */
function expectNoText(row: PersistedExecution) {
  const json = JSON.stringify({ result: row.result, changes: row.changes });
  for (const text of [TEXTO, TITULO, RELATO]) expect(json).not.toContain(text);
  for (const key of ['body', 'content', 'text', 'title', 'subtitle', 'ledByNote']) {
    expect(Object.keys(row.changes)).not.toContain(key);
    expect(Object.keys(row.result)).not.toContain(key);
  }
}

/* --- a massa de leitura ---------------------------------------------------- */

const nota = (extra: Partial<MemoryMuralNote> & { id: string; createdAt: string }): MemoryMuralNote => ({
  clientId: CLIENTE_A,
  title: null,
  content: 'texto',
  color: 'yellow',
  author: { id: OWNER_ID, name: 'Wesley Lourenço' },
  createdById: OWNER_ID,
  viaName: null,
  updatedAt: extra.createdAt,
  ...extra,
});

const registro = (
  extra: Partial<MemoryHistoryEntry> & { id: string; happenedOn: string; createdAt: string },
): MemoryHistoryEntry => ({
  clientId: CLIENTE_A,
  title: 'Registro',
  subtitle: null,
  body: 'relato',
  ledBy: { id: HELENA, name: 'Helena' },
  ledByNote: null,
  author: { id: OWNER_ID, name: 'Wesley Lourenço' },
  createdById: OWNER_ID,
  viaName: null,
  documentCount: 0,
  updatedAt: extra.createdAt,
  ...extra,
});

const WORK = new MemoryWorkCatalog({
  clients: [
    { id: CLIENTE_A, name: 'Clinimax', companyId: 'empresa-a', companyName: 'Agência Ide', listIds: [] },
    { id: CLIENTE_B, name: 'Rebrota', companyId: 'empresa-b', companyName: 'Ide Filmes', listIds: [] },
  ],
  muralNotes: [
    nota({ id: 'n-1', createdAt: '2026-09-01T10:00:00.000Z', title: 'Mais antiga' }),
    nota({ id: 'n-2', createdAt: '2026-09-20T10:00:00.000Z', viaName: 'Claude da agência' }),
    nota({ id: 'n-3', createdAt: '2026-09-10T10:00:00.000Z', viaName: 'Claude', createdById: HELENA }),
    nota({ id: 'n-b', clientId: CLIENTE_B, createdAt: '2026-09-21T10:00:00.000Z', content: 'segredo da Rebrota' }),
  ],
  historyEntries: [
    registro({ id: 'h-1', happenedOn: '2026-08-01', createdAt: '2026-09-15T10:00:00.000Z' }),
    registro({ id: 'h-2', happenedOn: '2026-09-18', createdAt: '2026-09-18T12:00:00.000Z', documentCount: 2 }),
    registro({ id: 'h-3', happenedOn: '2026-09-18', createdAt: '2026-09-19T09:00:00.000Z', viaName: 'Claude da agência' }),
    registro({ id: 'h-b', clientId: CLIENTE_B, happenedOn: '2026-09-20', createdAt: '2026-09-20T10:00:00.000Z' }),
  ],
});

const COMPANIES = [
  { id: 'empresa-a', name: 'Agência Ide' },
  { id: 'empresa-b', name: 'Ide Filmes' },
];

function readCtx(grant: IntegrationGrant = fullGrant): ReadCtx {
  return {
    grant,
    person,
    origin: 'mcp',
    companies: COMPANIES,
    displayName: 'Wesley Lourenço',
    work: WORK,
    now: agora,
  };
}

const CATALOG = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']]));

function adapters(grant: IntegrationGrant, extra: { writesEnabled?: boolean } = {}) {
  const { store, records } = setup(grant);
  return {
    store,
    records,
    shared: {
      grant,
      person,
      catalog: CATALOG,
      work: WORK,
      delivery: new MemoryDeliveryCatalog(),
      marketing: new MemoryMarketingCatalog(),
      writes: store,
      comments: new MemoryCommentBoard(OWNER_ID),
      clientRecords: records,
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

/* ─────────────────────────────── o contrato ─────────────────────────────── */

describe('contrato de mural e histórico', () => {
  it('OpenAPI publica as duas leituras (GET e POST) e as quatro escritas (só POST), com schemas iguais ao Zod', () => {
    const doc = integrationOpenApi();
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    const pares = [
      ['GetClientMuralInput', getClientMuralInputSchema],
      ['GetClientMuralResponse', getClientMuralResponseSchema],
      ['GetClientHistoryInput', getClientHistoryInputSchema],
      ['GetClientHistoryResponse', getClientHistoryResponseSchema],
      ['AddMuralNoteInput', addMuralNoteInputSchema],
      ['AddMuralNoteResponse', addMuralNoteResponseSchema],
      ['UpdateMuralNoteInput', updateMuralNoteInputSchema],
      ['UpdateMuralNoteResponse', updateMuralNoteResponseSchema],
      ['AddHistoryEntryInput', addHistoryEntryInputSchema],
      ['AddHistoryEntryResponse', addHistoryEntryResponseSchema],
      ['UpdateHistoryEntryInput', updateHistoryEntryInputSchema],
      ['UpdateHistoryEntryResponse', updateHistoryEntryResponseSchema],
    ] as const;
    for (const [nome, schema] of pares) expect(schemas[nome]).toEqual(jsonSchemaFromZod(schema));

    const paths = doc.paths as Record<string, { post?: { operationId?: string }; get?: { operationId?: string } }>;
    for (const op of ['get_client_mural', 'get_client_history']) {
      expect(paths[`/${op}`].get?.operationId).toBe(op);
      expect(paths[`/${op}`].post?.operationId).toBe(`${op}_post`);
    }
    for (const op of MCP_CLIENT_RECORD_WRITE_TOOL_NAMES) {
      expect(paths[`/${op}`].post?.operationId).toBe(op);
      expect(paths[`/${op}`].get).toBeUndefined();
    }
    expect(getClientMuralResponseSchema.parse(getClientMuralOpenApiExample()).operation).toBe('get_client_mural');
    expect(getClientHistoryResponseSchema.parse(getClientHistoryOpenApiExample()).operation).toBe('get_client_history');
    expect(addMuralNoteResponseSchema.parse(addMuralNoteOpenApiExample()).operation).toBe('add_mural_note');
    expect(updateMuralNoteResponseSchema.parse(updateMuralNoteOpenApiExample()).operation).toBe('update_mural_note');
    expect(addHistoryEntryResponseSchema.parse(addHistoryEntryOpenApiExample()).operation).toBe('add_history_entry');
    expect(updateHistoryEntryResponseSchema.parse(updateHistoryEntryOpenApiExample()).operation).toBe(
      'update_history_entry',
    );
    // O exemplo de leitura do histórico não carrega link de documento.
    expect(JSON.stringify(getClientHistoryOpenApiExample())).not.toMatch(/url|path|signed/i);
  });

  it('entrada estrita: autor, posição, cor desconhecida e data inexistente são recusados', () => {
    const nova = { clientId: CLIENTE_A, content: 'ok', idempotencyKey: 'k' };
    expect(addMuralNoteInputSchema.safeParse(nova).success).toBe(true);
    expect(addMuralNoteInputSchema.safeParse({ ...nova, createdBy: HELENA }).success).toBe(false);
    expect(addMuralNoteInputSchema.safeParse({ ...nova, positionX: 10 }).success).toBe(false);
    expect(addMuralNoteInputSchema.safeParse({ ...nova, color: 'purple' }).success).toBe(false);
    expect(addMuralNoteInputSchema.safeParse({ ...nova, clientId: 'cliente-a' }).success).toBe(false);
    const reg = { clientId: CLIENTE_A, happenedOn: '2026-09-21', title: 't', body: 'b', idempotencyKey: 'k' };
    expect(addHistoryEntryInputSchema.safeParse(reg).success).toBe(true);
    expect(addHistoryEntryInputSchema.safeParse({ ...reg, happenedOn: '2026-02-30' }).success).toBe(false);
    expect(addHistoryEntryInputSchema.safeParse({ ...reg, createdBy: HELENA }).success).toBe(false);
    expect(addHistoryEntryInputSchema.safeParse({ ...reg, ledBy: 'Helena' }).success).toBe(false);
    expect(updateHistoryEntryInputSchema.safeParse({ entryId: REG_DA_IA, documents: [], idempotencyKey: 'k' }).success).toBe(
      false,
    );
  });

  it('o vocabulário de cor é o mesmo da tela e do banco', () => {
    expect([...MURAL_NOTE_COLORS]).toEqual([...CORES_DA_NOTA]);
  });

  it('as quatro operações estão registradas com a permissão certa, e o texto de clients:read fala do mural e do histórico', () => {
    for (const op of MCP_CLIENT_RECORD_WRITE_TOOL_NAMES) {
      expect(AGENT_WRITE_OPERATIONS).toContain(op);
    }
    expect(WRITE_OPERATION_CAPABILITY.add_mural_note).toBe('clients:mural:write');
    expect(WRITE_OPERATION_CAPABILITY.update_mural_note).toBe('clients:mural:write');
    expect(WRITE_OPERATION_CAPABILITY.add_history_entry).toBe('clients:history:write');
    expect(WRITE_OPERATION_CAPABILITY.update_history_entry).toBe('clients:history:write');
    expect(CAPABILITY_LABELS['clients:read']).toMatch(/mural/);
    expect(CAPABILITY_LABELS['clients:read']).toMatch(/histórico/);
  });

  it('as frases que o port em memória usa são as do gatilho do banco, palavra por palavra', () => {
    const migration = readFileSync(
      join(RAIZ, 'supabase', 'migrations', '20260922300000_ideworks_f26_2_marca_de_origem_da_ia.sql'),
      'utf8',
    );
    const semQuebra = migration.replace(/'\s*\n\s*'/g, '');
    expect(semQuebra).toContain(AGENT_MURAL_GUARD_MESSAGE);
    expect(semQuebra).toContain(AGENT_HISTORY_GUARD_MESSAGE);
  });
});

/* ─────────────────────────────── as leituras ─────────────────────────────── */

describe('get_client_mural', () => {
  it('traz as notas do cliente, das mais novas para as mais antigas, com a marca e quem pode editar', async () => {
    const result = await getClientMuralWork(readCtx(), { clientId: CLIENTE_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.client).toEqual({ id: CLIENTE_A, name: 'Clinimax' });
    expect(result.body.items.map((item) => item.id)).toEqual(['n-2', 'n-3', 'n-1']);
    const [daIa, deOutraPessoa, humana] = result.body.items;
    expect(daIa).toMatchObject({ viaName: 'Claude da agência', agentEditable: true });
    // Escrita por IA, mas da Helena: esta conexão não edita.
    expect(deOutraPessoa).toMatchObject({ viaName: 'Claude', agentEditable: false });
    expect(humana).toMatchObject({ viaName: null, agentEditable: false, title: 'Mais antiga' });
    expect(JSON.stringify(result.body)).not.toContain('createdById');
    expect(JSON.stringify(result.body)).not.toContain('segredo da Rebrota');
  });

  it('respeita o recorte: cliente de outra empresa, cliente fora da lista e sem clients:read são recusa', async () => {
    expect(await getClientMuralWork(readCtx(), { clientId: CLIENTE_B })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
    const soOutroCliente: IntegrationGrant = { ...fullGrant, allowedCompanyIds: null, allowedClientIds: [CLIENTE_B] };
    expect(await getClientMuralWork(readCtx(soOutroCliente), { clientId: CLIENTE_A })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
    const semCliente: IntegrationGrant = {
      ...fullGrant,
      capabilities: fullGrant.capabilities.filter((cap) => cap !== 'clients:read' && !cap.startsWith('clients:')),
    };
    expect(await getClientMuralWork(readCtx(semCliente), { clientId: CLIENTE_A })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
    expect(await getClientMuralWork(readCtx(), { clientId: CLIENTE_X })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
  });

  it('sem people:read o autor some, e a página continua por cursor sem repetir nem perder nota', async () => {
    const semPessoas: IntegrationGrant = {
      ...fullGrant,
      capabilities: fullGrant.capabilities.filter((cap) => cap !== 'people:read'),
    };
    const vistos: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i += 1) {
      const page = await getClientMuralWork(readCtx(semPessoas), { clientId: CLIENTE_A, limit: 1, cursor });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      for (const item of page.body.items) {
        expect(item.author).toBeNull();
        vistos.push(item.id);
      }
      if (!page.body.hasMore) break;
      cursor = page.body.nextCursor ?? undefined;
    }
    expect(vistos).toEqual(['n-2', 'n-3', 'n-1']);
  });
});

describe('get_client_history', () => {
  it('ordena pelo fato (happenedOn), desempata pelo registro, conta documentos e não dá link', async () => {
    const result = await getClientHistoryWork(readCtx(), { clientId: CLIENTE_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.items.map((item) => item.id)).toEqual(['h-3', 'h-2', 'h-1']);
    expect(result.body.items[0]).toMatchObject({ viaName: 'Claude da agência', agentEditable: true });
    expect(result.body.items[1]).toMatchObject({ documentCount: 2, agentEditable: false });
    expect(result.body.items[1].ledBy).toEqual({ id: HELENA, name: 'Helena' });
    expect(JSON.stringify(result.body)).not.toMatch(/"documents"|url|storage/i);
  });

  it('sem people:read some quem conduziu (pessoa) e o autor; o texto livre fica', async () => {
    const semPessoas: IntegrationGrant = {
      ...fullGrant,
      capabilities: fullGrant.capabilities.filter((cap) => cap !== 'people:read'),
    };
    const result = await getClientHistoryWork(readCtx(semPessoas), { clientId: CLIENTE_A });
    expect(result.ok && result.body.items.every((item) => item.ledBy === null && item.author === null)).toBe(true);
    expect(await getClientHistoryWork(readCtx(), { clientId: CLIENTE_B })).toMatchObject({
      ok: false,
      code: 'permission_denied',
    });
  });
});

/* ─────────────────────────────── as escritas ─────────────────────────────── */

describe('add_mural_note', () => {
  it('cria com o dono como autor, sai marcada com a conexão, e o registro não guarda o texto', async () => {
    const { ctx, store, records } = setup();
    const result = await addMuralNoteWork(ctx, {
      clientId: CLIENTE_A,
      title: TITULO,
      content: TEXTO,
      color: 'blue',
      idempotencyKey: 'nota-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const noteId = result.body.noteId!;
    expect(result.body).toMatchObject({
      operation: 'add_mural_note',
      dryRun: false,
      replay: false,
      note: { clientId: CLIENTE_A, color: 'blue', viaName: 'Claude da agência' },
      actedAs: { ownerId: OWNER_ID, integrationName: 'Claude da agência' },
    });
    // O autor que `…Work` manda ao miolo é o DONO — nunca algo do pedido.
    expect(records.authorArgs).toEqual([OWNER_ID]);
    expect(records.notes.get(noteId)).toMatchObject({ content: TEXTO, title: TITULO, createdBy: OWNER_ID });
    expect(JSON.stringify(result.body)).not.toContain(TEXTO);

    const [row] = rows(store);
    expect(row.operation).toBe('add_mural_note');
    expect(row.targetId).toBe(noteId);
    expect(row.changes).toEqual({ created: true, clientId: CLIENTE_A, after: { color: 'blue' } });
    expectNoText(row);
  });

  it('cliente fora do recorte recusa antes de gravar; cliente inexistente é not_found; sem a permissão, permission_denied', async () => {
    const { ctx, store, records } = setup();
    const fora = await addMuralNoteWork(ctx, { clientId: CLIENTE_B, content: TEXTO, idempotencyKey: 'n-b' });
    expect(fora).toMatchObject({ ok: false, code: 'permission_denied' });
    if (!fora.ok) expect(fora.message).toMatch(/recorte desta conexão/);
    const sumido = await addMuralNoteWork(ctx, { clientId: CLIENTE_X, content: TEXTO, idempotencyKey: 'n-x' });
    expect(sumido).toMatchObject({ ok: false, code: 'not_found' });
    const semPermissao = setup(readGrant);
    expect(
      await addMuralNoteWork(semPermissao.ctx, { clientId: CLIENTE_A, content: TEXTO, idempotencyKey: 'n-p' }),
    ).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(records.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('dryRun não grava, não entra no registro, não conta no teto, e responde o que faria', async () => {
    const { ctx, store, records } = setup();
    const ensaio = await addMuralNoteWork(ctx, {
      clientId: CLIENTE_A,
      content: TEXTO,
      idempotencyKey: 'ensaio-nota',
      dryRun: true,
    });
    expect(ensaio.ok).toBe(true);
    if (!ensaio.ok) return;
    expect(ensaio.body).toMatchObject({
      dryRun: true,
      noteId: null,
      executionId: null,
      note: { clientId: CLIENTE_A, color: 'yellow', viaName: 'Claude da agência' },
      dailyWrites: { used: 0, limit: 50 },
    });
    expect(records.mutations).toBe(0);
    expect(records.notes.size).toBe(4);
    expect(rows(store)).toHaveLength(0);
  });

  it('repetir a mesma chave não cria outra nota; a mesma chave com outro texto é conflito', async () => {
    const { ctx, store, records } = setup();
    const input = { clientId: CLIENTE_A, content: TEXTO, idempotencyKey: 'repetida' };
    const primeira = await addMuralNoteWork(ctx, input);
    const segunda = await addMuralNoteWork(ctx, input);
    expect(primeira.ok && segunda.ok).toBe(true);
    if (!primeira.ok || !segunda.ok) return;
    expect(segunda.body.replay).toBe(true);
    expect(segunda.body.noteId).toBe(primeira.body.noteId);
    expect(records.mutations).toBe(1);
    expect(rows(store)).toHaveLength(1);
    expect(await addMuralNoteWork(ctx, { ...input, content: 'outro' })).toMatchObject({
      ok: false,
      code: 'state_conflict',
    });
  });

  it('texto acima de 32 KiB é payload_too_large, antes de qualquer escrita', async () => {
    const { ctx, records } = setup();
    const grande = 'x'.repeat(32 * 1024 + 1);
    expect(await addMuralNoteWork(ctx, { clientId: CLIENTE_A, content: grande, idempotencyKey: 'g' })).toMatchObject({
      ok: false,
      code: 'payload_too_large',
    });
    expect(records.mutations).toBe(0);
  });
});

describe('update_mural_note — a IA só edita o que a IA da mesma pessoa escreveu', () => {
  it('editar a própria passa (mesmo escrita por outra IA DA MESMA pessoa); o registro guarda cor e o NOME do texto editado', async () => {
    const { ctx, store, records } = setup();
    const result = await updateMuralNoteWork(ctx, {
      noteId: NOTA_DA_IA,
      content: TEXTO,
      color: 'red',
      idempotencyKey: 'editar-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({ noteId: NOTA_DA_IA, note: { color: 'red', viaName: 'ChatGPT' } });
    expect(records.notes.get(NOTA_DA_IA)?.content).toBe(TEXTO);
    const [row] = rows(store);
    expect(row.targetId).toBe(NOTA_DA_IA);
    expect(row.changes).toEqual({
      clientId: CLIENTE_A,
      before: { color: 'yellow' },
      after: { color: 'red' },
      textEdited: ['content'],
    });
    expectNoText(row);
  });

  it('nota escrita à mão, ou pela IA de outra pessoa, recusa com a frase do banco — e o ensaio também', async () => {
    const { ctx, store, records } = setup();
    for (const noteId of [NOTA_HUMANA, NOTA_DE_OUTRA_IA]) {
      const input = { noteId, content: TEXTO, idempotencyKey: `outra-${noteId}` };
      const real = await updateMuralNoteWork(ctx, input);
      expect(real).toEqual({ ok: false, code: 'permission_denied', message: AGENT_MURAL_GUARD_MESSAGE });
      expect(await updateMuralNoteWork(ctx, { ...input, dryRun: true })).toEqual(real);
    }
    expect(records.notes.get(NOTA_HUMANA)?.content).toBe('nota à mão');
    expect(records.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('nota de cliente fora do recorte recusa antes do banco; sem campo é invalid_input; nota sumida é not_found', async () => {
    const { ctx, records } = setup();
    const fora = await updateMuralNoteWork(ctx, { noteId: NOTA_B, color: 'green', idempotencyKey: 'u-b' });
    expect(fora).toMatchObject({ ok: false, code: 'permission_denied' });
    if (!fora.ok) expect(fora.message).not.toBe(AGENT_MURAL_GUARD_MESSAGE);
    expect(await updateMuralNoteWork(ctx, { noteId: NOTA_DA_IA, idempotencyKey: 'u-0' })).toMatchObject({
      ok: false,
      code: 'invalid_input',
    });
    expect(
      await updateMuralNoteWork(ctx, { noteId: 'a9999999-9999-4999-8999-999999999999', color: 'red', idempotencyKey: 'u-x' }),
    ).toMatchObject({ ok: false, code: 'not_found' });
    expect(records.mutations).toBe(0);
  });

  it('title null tira o título', async () => {
    const { ctx, records } = setup();
    records.notes.get(NOTA_DA_IA)!.title = 'Velho';
    const result = await updateMuralNoteWork(ctx, { noteId: NOTA_DA_IA, title: null, idempotencyKey: 't-null' });
    expect(result.ok).toBe(true);
    expect(records.notes.get(NOTA_DA_IA)?.title).toBeNull();
  });
});

describe('add_history_entry e update_history_entry', () => {
  it('registrar cria marcado, confere quem conduziu contra o recorte e guarda só data e pessoa no registro', async () => {
    const { ctx, store, records } = setup();
    const result = await addHistoryEntryWork(ctx, {
      clientId: CLIENTE_A,
      happenedOn: '2026-09-21',
      title: TITULO,
      subtitle: 'Sub secreto',
      body: RELATO,
      ledBy: HELENA,
      ledByNote: 'Dr. Paulo, do cliente',
      idempotencyKey: 'reg-1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entryId = result.body.entryId!;
    expect(result.body.entry).toEqual({
      clientId: CLIENTE_A,
      happenedOn: '2026-09-21',
      ledById: HELENA,
      viaName: 'Claude da agência',
    });
    expect(records.authorArgs).toEqual([OWNER_ID]);
    const [row] = rows(store);
    expect(row.operation).toBe('add_history_entry');
    expect(row.targetId).toBe(entryId);
    expect(row.changes).toEqual({
      created: true,
      clientId: CLIENTE_A,
      after: { happenedOn: '2026-09-21', ledById: HELENA },
    });
    expectNoText(row);
    expect(JSON.stringify(row)).not.toContain('Sub secreto');
    expect(JSON.stringify(row)).not.toContain('Dr. Paulo');
  });

  it('quem conduziu fora do recorte (ou fora do diretório) recusa dizendo quem, e nada é gravado', async () => {
    const { ctx, store, records } = setup();
    for (const ledBy of [CAROL_B, FORA]) {
      const result = await addHistoryEntryWork(ctx, {
        clientId: CLIENTE_A,
        happenedOn: '2026-09-21',
        title: 't',
        body: 'b',
        ledBy,
        idempotencyKey: `led-${ledBy}`,
      });
      expect(result).toMatchObject({ ok: false, code: 'permission_denied' });
      if (!result.ok) {
        expect(result.message).toContain(ledBy);
        expect(result.message).toMatch(/list_people/);
      }
    }
    expect(records.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('editar o próprio registro muda só o que veio e mantém o resto', async () => {
    const { ctx, store, records } = setup();
    const result = await updateHistoryEntryWork(ctx, {
      entryId: REG_DA_IA,
      happenedOn: '2026-09-11',
      body: RELATO,
      idempotencyKey: 'ed-reg',
    });
    expect(result.ok).toBe(true);
    const depois = records.entries.get(REG_DA_IA)!;
    expect(depois).toMatchObject({
      happenedOn: '2026-09-11',
      body: RELATO,
      title: 'Reunião',
      subtitle: 'Kickoff',
      ledBy: HELENA,
    });
    const [row] = rows(store);
    expect(row.changes).toEqual({
      clientId: CLIENTE_A,
      before: { happenedOn: '2026-09-10' },
      after: { happenedOn: '2026-09-11' },
      textEdited: ['body'],
    });
    expectNoText(row);
  });

  it('registro escrito por gente recusa com a frase do banco, e nada muda', async () => {
    const { ctx, store, records } = setup();
    const result = await updateHistoryEntryWork(ctx, {
      entryId: REG_HUMANO,
      title: 'Outro',
      idempotencyKey: 'ed-humano',
    });
    expect(result).toEqual({ ok: false, code: 'permission_denied', message: AGENT_HISTORY_GUARD_MESSAGE });
    expect(records.entries.get(REG_HUMANO)?.title).toBe('Registro');
    expect(rows(store)).toHaveLength(0);
  });

  it('sem clients:history:write recusa, mesmo com a do mural', async () => {
    const { ctx } = setup(muralOnlyGrant);
    expect(
      await addHistoryEntryWork(ctx, {
        clientId: CLIENTE_A,
        happenedOn: '2026-09-21',
        title: 't',
        body: 'b',
        idempotencyKey: 'sem-hist',
      }),
    ).toMatchObject({ ok: false, code: 'permission_denied' });
  });
});

describe('o teto do dia vale para mural e histórico', () => {
  it('a 51ª escrita é recusada com daily_write_limit, e o ensaio devolve a mesma recusa', async () => {
    const { ctx, store, records } = setup();
    for (let i = 0; i < 50; i += 1) {
      const ok =
        i % 2 === 0
          ? await addMuralNoteWork(ctx, { clientId: CLIENTE_A, content: `nota ${i}`, idempotencyKey: `laco-${i}` })
          : await addHistoryEntryWork(ctx, {
              clientId: CLIENTE_A,
              happenedOn: '2026-09-22',
              title: `reg ${i}`,
              body: 'b',
              idempotencyKey: `laco-${i}`,
            });
      expect(ok.ok).toBe(true);
    }
    const input = { clientId: CLIENTE_A, content: 'a 51ª', idempotencyKey: 'laco-51' };
    const real = await addMuralNoteWork(ctx, input);
    expect(real).toMatchObject({ ok: false, code: 'daily_write_limit', dailyWrites: { used: 50, limit: 50 } });
    expect(await addMuralNoteWork(ctx, { ...input, dryRun: true })).toEqual(real);
    expect(records.mutations).toBe(50);
    expect(rows(store)).toHaveLength(50);
  });
});

/* ─────────────────────────────── os adaptadores ─────────────────────────────── */

describe('adaptador MCP', () => {
  it('lista as leituras como leitura e as quatro escritas como escrita, na ordem registrada', async () => {
    const { shared } = adapters(fullGrant);
    const listed = await handleMcpRequest({ ...shared, origin: 'mcp', request: mcpPost('tools/list', {}, 2) });
    const tools = ((await listed.json()) as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
    for (const name of ['get_client_mural', 'get_client_history']) {
      expect((MCP_READ_TOOL_NAMES as readonly string[]).includes(name)).toBe(true);
      const tool = tools.find((row) => row.name === name);
      expect((tool?.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(true);
    }
    for (const name of MCP_CLIENT_RECORD_WRITE_TOOL_NAMES) {
      const tool = tools.find((row) => row.name === name);
      expect((tool?.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(false);
    }
  });

  it('lê e escreve pelo tools/call, e o resumo em texto não repete o conteúdo', async () => {
    const { shared, store } = adapters(fullGrant);
    const mural = await callTool(shared, 'get_client_mural', { clientId: CLIENTE_A });
    expect(getClientMuralResponseSchema.parse(mural.structuredContent).items).toHaveLength(3);
    const historico = await callTool(shared, 'get_client_history', { clientId: CLIENTE_A, limit: 2 });
    const pagina = getClientHistoryResponseSchema.parse(historico.structuredContent);
    expect(pagina.items).toHaveLength(2);
    expect(pagina.hasMore).toBe(true);

    const criada = await callTool(shared, 'add_mural_note', { clientId: CLIENTE_A, content: TEXTO, idempotencyKey: 'm-1' });
    expect(criada.isError).toBeFalsy();
    expect(criada.content[0].text).not.toContain(TEXTO);
    const noteId = addMuralNoteResponseSchema.parse(criada.structuredContent).noteId!;
    const editada = await callTool(shared, 'update_mural_note', { noteId, color: 'green', idempotencyKey: 'm-2' });
    expect(updateMuralNoteResponseSchema.parse(editada.structuredContent).note.color).toBe('green');
    const registrado = await callTool(shared, 'add_history_entry', {
      clientId: CLIENTE_A,
      happenedOn: '2026-09-22',
      title: TITULO,
      body: RELATO,
      idempotencyKey: 'm-3',
    });
    expect(registrado.content[0].text).not.toContain(RELATO);
    const entryId = addHistoryEntryResponseSchema.parse(registrado.structuredContent).entryId!;
    const reeditado = await callTool(shared, 'update_history_entry', {
      entryId,
      subtitle: null,
      idempotencyKey: 'm-4',
    });
    expect(updateHistoryEntryResponseSchema.parse(reeditado.structuredContent).entryId).toBe(entryId);

    expect(rows(store).map((row) => row.operation)).toEqual([
      'add_mural_note',
      'update_mural_note',
      'add_history_entry',
      'update_history_entry',
    ]);
    expect(rows(store).every((row) => row.origin === 'mcp')).toBe(true);
    for (const row of rows(store)) expectNoText(row);
  });

  it('editar nota humana pelo MCP devolve permission_denied com a frase do banco', async () => {
    const { shared, records } = adapters(fullGrant);
    const result = await callTool(shared, 'update_mural_note', {
      noteId: NOTA_HUMANA,
      content: 'x',
      idempotencyKey: 'h-1',
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: 'permission_denied',
      message: AGENT_MURAL_GUARD_MESSAGE,
    });
    expect(records.mutations).toBe(0);
  });

  it('sem a permissão cada escrita recusa; com as escritas desligadas, todas recusam (inclusive o ensaio) e as leituras seguem', async () => {
    const semPermissao = adapters(readGrant);
    const validas: Record<string, Record<string, unknown>> = {
      add_mural_note: { clientId: CLIENTE_A, content: 'x' },
      update_mural_note: { noteId: NOTA_DA_IA, color: 'red' },
      add_history_entry: { clientId: CLIENTE_A, happenedOn: '2026-09-22', title: 't', body: 'b' },
      update_history_entry: { entryId: REG_DA_IA, title: 't' },
    };
    for (const name of MCP_CLIENT_RECORD_WRITE_TOOL_NAMES) {
      const result = await callTool(semPermissao.shared, name, { ...validas[name], idempotencyKey: 'p' });
      expect(JSON.parse(result.content[0].text)).toMatchObject({ error: 'permission_denied' });
    }
    expect(semPermissao.records.mutations).toBe(0);

    const desligado = adapters(fullGrant, { writesEnabled: false });
    for (const name of MCP_CLIENT_RECORD_WRITE_TOOL_NAMES) {
      const result = await callTool(desligado.shared, name, { ...validas[name], idempotencyKey: 'off', dryRun: true });
      expect(JSON.parse(result.content[0].text)).toMatchObject({
        error: 'unavailable',
        message: INTEGRATION_WRITES_UNAVAILABLE_MESSAGE,
      });
    }
    const leitura = await callTool(desligado.shared, 'get_client_mural', { clientId: CLIENTE_A });
    expect(leitura.isError).toBeFalsy();
    expect(desligado.records.mutations).toBe(0);
  });
});

describe('adaptador HTTP', () => {
  it('as leituras respondem em GET com o contrato, e o recorte vale igual', async () => {
    const { shared } = adapters(fullGrant);
    const mural = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${GET_CLIENT_MURAL_PATH}?clientId=${CLIENTE_A}&limit=2`),
    });
    expect(mural.status).toBe(200);
    const body = getClientMuralResponseSchema.parse(await mural.json());
    expect(body.items).toHaveLength(2);
    expect(body.self).toBe(`${GET_CLIENT_MURAL_PATH}?clientId=${CLIENTE_A}`);

    const fora = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${GET_CLIENT_HISTORY_PATH}?clientId=${CLIENTE_B}`),
    });
    expect(fora.status).toBe(403);
  });

  it('as quatro rotas escrevem com a chave no cabeçalho; GET é 405 e escritas desligadas é 503', async () => {
    const { shared, store } = adapters(fullGrant);
    const criar = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: httpPost(ADD_MURAL_NOTE_PATH, { clientId: CLIENTE_A, content: TEXTO }, 'h-1'),
    });
    expect(criar.status).toBe(200);
    const noteId = addMuralNoteResponseSchema.parse(await criar.json()).noteId!;
    const registrar = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: httpPost(
        ADD_HISTORY_ENTRY_PATH,
        { clientId: CLIENTE_A, happenedOn: '2026-09-22', title: 't', body: RELATO },
        'h-2',
      ),
    });
    expect(registrar.status).toBe(200);
    const entryId = addHistoryEntryResponseSchema.parse(await registrar.json()).entryId!;
    const passos: Array<[string, Record<string, unknown>]> = [
      [UPDATE_MURAL_NOTE_PATH, { noteId, color: 'red' }],
      [UPDATE_HISTORY_ENTRY_PATH, { entryId, happenedOn: '2026-09-20' }],
    ];
    let n = 3;
    for (const [path, corpo] of passos) {
      const response = await dispatchIntegrationHttp({
        ...shared,
        origin: 'http',
        request: httpPost(path, corpo, `h-${n++}`),
      });
      expect(response.status).toBe(200);
    }
    expect(rows(store).map((row) => row.operation)).toEqual([
      'add_mural_note',
      'add_history_entry',
      'update_mural_note',
      'update_history_entry',
    ]);
    expect(rows(store).every((row) => row.origin === 'http')).toBe(true);

    const get = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${ADD_MURAL_NOTE_PATH}?clientId=${CLIENTE_A}`),
    });
    expect(get.status).toBe(405);

    const humana = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: httpPost(UPDATE_MURAL_NOTE_PATH, { noteId: NOTA_HUMANA, color: 'red' }, 'h-humana'),
    });
    expect(humana.status).toBe(403);
    expect(await humana.json()).toMatchObject({ error: 'permission_denied', message: AGENT_MURAL_GUARD_MESSAGE });

    const desligado = adapters(fullGrant, { writesEnabled: false });
    const off = await dispatchIntegrationHttp({
      ...desligado.shared,
      origin: 'http',
      request: httpPost(ADD_MURAL_NOTE_PATH, { clientId: CLIENTE_A, content: 'x', dryRun: true }, 'h-off'),
    });
    expect(off.status).toBe(503);
    expect(desligado.records.mutations).toBe(0);
  });
});

describe('o caminho SQL usa os miolos da F26.3 no Tx do registro', () => {
  it('writes.ts chama só os …InTx de mural e histórico, nunca os invólucros da tela', () => {
    const writes = readFileSync(join(RAIZ, 'src', 'integrations', 'writes.ts'), 'utf8');
    for (const miolo of ['createNotaInTx', 'updateNotaInTx', 'createEventInTx', 'updateEventInTx']) {
      expect(writes).toContain(miolo);
    }
    expect(writes).not.toMatch(/\bcreateNota\s*\(/);
    expect(writes).not.toMatch(/\bupdateNota\s*\(/);
    expect(writes).not.toMatch(/\bcreateEvent\s*\(/);
    expect(writes).not.toMatch(/\bupdateEvent\s*\(/);
  });
});
