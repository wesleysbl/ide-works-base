/**
 * F21.2 — desfazer em lote o que um agente publicou.
 *
 * A suíte não fala com o banco (F0.4): o ledger, o quadro de comentários e a
 * transação do desfazer são os mesmos objetos de memória que as escritas
 * usam, para a prova ser sobre o estado real e não sobre um espelho.
 *
 * O que estes casos protegem, em uma linha cada: o lote não passa do recorte
 * pedido; o que o dono não alcança fica de pé e é reportado; o ledger sobrevive
 * ao desfazer; repetir não conta duas vezes; e falhar ao registrar não deixa
 * comentário apagado sem registro.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MemoryAgentWriteStore, type PersistedExecution } from '@/integrations/executions';
import { INTEGRATION_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { CONNECTIONS_PATH } from '@/integrations/contract';
import { MemoryGrantStore, createIntegrationHandler } from '@/integrations/handler';
import {
  MemoryUndoStore,
  parseUndoWindow,
  undoGrantWrites,
  UndoRefused,
  type UndoOutcome,
} from '@/integrations/undo';
import {
  MemoryClientRecordBoard,
  MemoryCommentBoard,
  MemoryTaskBoard,
  type MemoryTaskAutomation,
  addHistoryEntryWork,
  addMuralNoteWork,
  assignTaskWork,
  completeTaskWork,
  createTaskWork,
  updateMuralNoteWork,
  updateTaskWork,
  type WriteCtx,
} from '@/integrations/writes';
import { SESSION_COOKIE as HUMAN_SESSION } from '@/server/session';
import type { AuthenticatedActor, SessionResult } from '@/server/session';

const ORIGIN = 'https://ideworks.test';
const HUMAN_COOKIE = `${HUMAN_SESSION}=human-ok`;
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const OUTRO_ID = '22222222-2222-2222-2222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const GRANT_A = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const GRANT_B = 'bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1';

const OWNER: AuthenticatedActor = {
  userId: OWNER_ID,
  email: 'wesley@exemplo.com.br',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: ['entrega', 'quadro'],
  hasAllClientsAccess: true,
};

const PERSON: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [],
  clientIds: [],
  hasAllClientsAccess: true,
};

function grant(id: string, overrides: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id,
    ownerId: OWNER_ID,
    oauthClientId: 'cliente-mcp',
    name: `Agente ${id.slice(0, 4)}`,
    capabilities: [...INTEGRATION_CAPABILITIES],
    allowedCompanyIds: null,
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
    ...overrides,
  };
}

function execucao(
  id: string,
  grantId: string,
  commentId: string,
  occurredAt: string,
  overrides: Partial<PersistedExecution> = {},
): PersistedExecution {
  return {
    id,
    grantId,
    ownerId: OWNER_ID,
    operation: 'add_comment',
    targetId: TASK,
    occurredAt: new Date(occurredAt),
    result: { commentId },
    changes: { commentsAdded: 1 },
    idempotencyKey: `idem-${id}`,
    paramsHash: 'a'.repeat(64),
    policyVersion: 1,
    origin: 'http',
    active: true,
    undoneAt: null,
    undoneBy: null,
    ...overrides,
  };
}

/**
 * Um mundo pequeno e completo: dois agentes do mesmo dono, um comentário
 * humano e um comentário de outra pessoa que o dono NÃO pode apagar.
 */
function cenario() {
  const ledger = new MemoryAgentWriteStore();
  ledger.seedPerson(PERSON);
  ledger.seedGrant(grant(GRANT_A));
  ledger.seedGrant(grant(GRANT_B));

  const board = new MemoryCommentBoard(OWNER_ID, {
    comments: [
      { id: 'c-a1', taskId: TASK, parentId: null, body: 'agente A, manhã', authorId: OWNER_ID },
      { id: 'c-a2', taskId: TASK, parentId: null, body: 'agente A, tarde', authorId: OWNER_ID },
      { id: 'c-b1', taskId: TASK, parentId: null, body: 'agente B', authorId: OWNER_ID },
      { id: 'c-humano', taskId: TASK, parentId: null, body: 'fala de gente', authorId: OWNER_ID },
      { id: 'c-alheio', taskId: TASK, parentId: null, body: 'de outra pessoa', authorId: OUTRO_ID },
    ],
  });

  ledger.executions.set('e-a1', execucao('e-a1', GRANT_A, 'c-a1', '2026-09-21T09:00:00.000Z'));
  ledger.executions.set('e-a2', execucao('e-a2', GRANT_A, 'c-a2', '2026-09-21T18:00:00.000Z'));
  ledger.executions.set('e-b1', execucao('e-b1', GRANT_B, 'c-b1', '2026-09-21T10:00:00.000Z'));

  const store = new MemoryUndoStore(ledger, board, OWNER_ID);
  return { ledger, board, store };
}

const AGORA = new Date('2026-09-22T12:00:00.000Z');

describe('desfazer em lote (F21.2)', () => {
  it('apaga só o que a concessão pedida escreveu, e não toca no resto', async () => {
    const { ledger, board, store } = cenario();

    const outcome = await undoGrantWrites({ store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(outcome.examined).toBe(2);
    expect(outcome.removed).toBe(2);
    expect(outcome.kept).toBe(0);
    expect(board.comments.has('c-a1')).toBe(false);
    expect(board.comments.has('c-a2')).toBe(false);
    // Outra concessão e fala humana continuam de pé.
    expect(board.comments.has('c-b1')).toBe(true);
    expect(board.comments.has('c-humano')).toBe(true);
    expect(ledger.executions.get('e-b1')?.undoneAt ?? null).toBeNull();
  });

  it('aceita recorte por janela de tempo', async () => {
    const { board, store } = cenario();

    const outcome = await undoGrantWrites({
      store,
      grantId: GRANT_A,
      ownerId: OWNER_ID,
      window: parseUndoWindow({ since: '2026-09-21T12:00:00.000Z' }),
      now: AGORA,
    });

    expect(outcome.removed).toBe(1);
    expect(board.comments.has('c-a1')).toBe(true);
    expect(board.comments.has('c-a2')).toBe(false);
  });

  it('deixa de pé o comentário que o dono não pode apagar, e diz quantos e por quê', async () => {
    const { ledger, board, store } = cenario();
    ledger.executions.set('e-a3', execucao('e-a3', GRANT_A, 'c-alheio', '2026-09-21T11:00:00.000Z'));

    const outcome = await undoGrantWrites({ store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(outcome.removed).toBe(2);
    expect(outcome.kept).toBe(1);
    expect(outcome.keptComments[0].commentId).toBe('c-alheio');
    expect(outcome.keptComments[0].reason).toBe('permission_denied');
    expect(outcome.keptComments[0].message).toMatch(/só o autor apaga/i);
    expect(board.comments.has('c-alheio')).toBe(true);
    // O que ficou NÃO é marcado como desfeito: o ledger não pode mentir sobre
    // o que continua na conversa.
    expect(ledger.executions.get('e-a3')?.undoneAt ?? null).toBeNull();
  });

  it('marca o ledger como desfeito, com quem desfez e quando — sem apagar a linha', async () => {
    const { ledger, store } = cenario();

    await undoGrantWrites({ store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    const row = ledger.executions.get('e-a1');
    expect(row).toBeTruthy();
    expect(row?.undoneAt?.toISOString()).toBe(AGORA.toISOString());
    expect(row?.undoneBy).toBe(OWNER_ID);
    expect(row?.result.commentId).toBe('c-a1');
  });

  it('desfazer duas vezes não quebra nem conta duas vezes', async () => {
    const { ledger, store } = cenario();

    const primeiro = await undoGrantWrites({ store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });
    const segundo = await undoGrantWrites({
      store,
      grantId: GRANT_A,
      ownerId: OWNER_ID,
      now: new Date('2026-09-23T12:00:00.000Z'),
    });

    expect(primeiro.removed).toBe(2);
    expect(segundo.examined).toBe(0);
    expect(segundo.removed).toBe(0);
    expect(segundo.kept).toBe(0);
    // A data do desfazer é a do primeiro: repetir não reescreve o registro.
    expect(ledger.executions.get('e-a1')?.undoneAt?.toISOString()).toBe(AGORA.toISOString());
  });

  it('comentário que já não existia conta como ido, não como removido agora', async () => {
    const { ledger, board, store } = cenario();
    board.comments.delete('c-a1');

    const outcome = await undoGrantWrites({ store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(outcome.removed).toBe(1);
    expect(outcome.alreadyGone).toBe(1);
    expect(outcome.kept).toBe(0);
    expect(ledger.executions.get('e-a1')?.undoneAt).toBeTruthy();
  });

  it('falhar ao registrar o desfazer derruba o lote inteiro — nada fica apagado', async () => {
    const { ledger, board, store } = cenario();
    store.failMarkUndone = true;

    await expect(
      undoGrantWrites({ store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA }),
    ).rejects.toThrow(/registrar o desfazer/);

    expect(board.comments.has('c-a1')).toBe(true);
    expect(board.comments.has('c-a2')).toBe(true);
    expect(ledger.executions.get('e-a1')?.undoneAt ?? null).toBeNull();
  });

  it('recusa janela sem sentido em vez de interpretá-la como "tudo"', () => {
    expect(() => parseUndoWindow({ since: 'ontem de manhã' })).toThrow(UndoRefused);
    expect(() =>
      parseUndoWindow({ since: '2026-09-21T12:00:00.000Z', until: '2026-09-20T12:00:00.000Z' }),
    ).toThrow(/antes de/);
    expect(parseUndoWindow({})).toEqual({ from: null, to: null });
  });
});

function sessionResult(cookieHeader: string): SessionResult {
  if (!cookieHeader.includes(`${HUMAN_SESSION}=human-ok`)) {
    return { ok: false, status: 401, reason: 'no_token', message: 'Faltou o crachá.' };
  }
  return { ok: true, actor: OWNER };
}

async function montarServidor(undo: MemoryUndoStore, grants: MemoryGrantStore) {
  grants.seedPerson(PERSON);
  return createIntegrationHandler({
    grants,
    undo,
    resolveSession: async (request) => sessionResult(request.headers.get('Cookie') ?? ''),
  });
}

describe('rota de desfazer (sessão humana)', () => {
  it('desfaz pela sessão do dono e recusa a credencial de agente', async () => {
    const { board, store } = cenario();
    const grants = new MemoryGrantStore();
    grants.grants.set(GRANT_A, grant(GRANT_A));
    const server = await montarServidor(store, grants);
    const url = `${ORIGIN}${CONNECTIONS_PATH}/${GRANT_A}/undo`;

    const comoAgente = await server.fetch(
      new Request(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ideworks_auto_qualquer', Origin: ORIGIN },
      }),
    );
    expect(comoAgente.status).toBe(401);
    expect(board.comments.has('c-a1')).toBe(true);

    const comoDono = await server.fetch(
      new Request(url, {
        method: 'POST',
        headers: { Cookie: HUMAN_COOKIE, Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(comoDono.status).toBe(200);
    const body = (await comoDono.json()) as Record<string, unknown>;
    expect(body.removed).toBe(2);
    expect(board.comments.has('c-a1')).toBe(false);
  });

  it('a concessão revogada continua desfazível — o ledger sobrevive à revogação', async () => {
    const { board, store } = cenario();
    const grants = new MemoryGrantStore();
    grants.grants.set(GRANT_A, grant(GRANT_A, { revokedAt: new Date('2026-09-21T20:00:00.000Z') }));
    const server = await montarServidor(store, grants);

    const resposta = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${GRANT_A}/undo`, {
        method: 'POST',
        headers: { Cookie: HUMAN_COOKIE, Origin: ORIGIN },
      }),
    );
    expect(resposta.status).toBe(200);
    expect(board.comments.has('c-a2')).toBe(false);
  });

  it('não desfaz concessão que não é da pessoa', async () => {
    const { board, store } = cenario();
    const grants = new MemoryGrantStore();
    grants.grants.set(GRANT_A, grant(GRANT_A, { ownerId: OUTRO_ID }));
    const server = await montarServidor(store, grants);

    const resposta = await server.fetch(
      new Request(`${ORIGIN}${CONNECTIONS_PATH}/${GRANT_A}/undo`, {
        method: 'POST',
        headers: { Cookie: HUMAN_COOKIE, Origin: ORIGIN },
      }),
    );
    expect(resposta.status).toBe(404);
    expect(board.comments.has('c-a1')).toBe(true);
  });
});

describe('migration F21.2 fecha no BANCO quem pode carimbar o desfazer', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const nome = '20260921213000_ideworks_f21_2_desfazer_em_lote.sql';
  const sql = readFileSync(join(raiz, 'supabase', 'migrations', nome), 'utf8');
  const rollback = readFileSync(join(raiz, 'supabase', 'rollback', nome), 'utf8');
  const gatilho = sql.slice(sql.indexOf('create or replace function'));
  const caminhoDoCarimbo = gatilho.slice(gatilho.indexOf('new.undone_at is distinct from old.undone_at'));

  it('é aditiva e acrescenta só o que o desfazer precisa', () => {
    expect(nome).toMatch(/^\d{14}_ideworks_f\d+[a-z]*_/);
    expect(sql).toContain('add column undone_at timestamptz');
    expect(sql).toContain('integration_executions_undone_pair');
    expect(sql).not.toMatch(/drop\s+(table|column|constraint)/i);
    expect(sql).not.toMatch(/create\s+table/i);
    expect(sql).not.toMatch(/\bpublic\.\w+/);
  });

  /**
   * A FRESTA QUE ESTE CASO GUARDA
   *   A política `integration_executions_update` da f16c exige apenas
   *   `active = false` no `with check`. Numa linha JÁ desativada, `active` não
   *   muda — então, sem esta condição no gatilho, um agente de concessão viva
   *   gravaria `undone_at` numa escrita própria que CONTINUA na conversa, e o
   *   ledger passaria a mentir. Fechar isso no servidor não bastaria: quem
   *   fala com o banco por outro caminho passaria por fora.
   */
  it('o carimbo do desfazer exige sessão humana no próprio gatilho', () => {
    expect(caminhoDoCarimbo).toContain('ideworks.acting_grant_id() is not null');
    expect(caminhoDoCarimbo).toMatch(/raise exception 'só sessão humana desfaz/);
    // E a recusa vem ANTES de qualquer aceitação do carimbo.
    expect(caminhoDoCarimbo.indexOf('acting_grant_id() is not null')).toBeLessThan(
      caminhoDoCarimbo.indexOf('return new;'),
    );
  });

  it('o carimbo é de uma vez só, e não mexe na janela de idempotência', () => {
    expect(caminhoDoCarimbo).toContain("raise exception 'esta execução já foi desfeita'");
    expect(caminhoDoCarimbo).toContain("raise exception 'desfazer não mexe na janela de idempotência'");
  });

  it('o rollback devolve o gatilho da f16c e não derruba o ledger', () => {
    expect(rollback.length).toBeGreaterThan(100);
    expect(rollback).toContain('drop column if exists undone_at');
    expect(rollback).toContain('create or replace function ideworks.integration_executions_guard()');
    expect(rollback).not.toMatch(/drop\s+table/i);
  });
});

describe('a listagem do ledger não fica refém da migration', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const fonte = readFileSync(join(raiz, 'src', 'integrations', 'handler.ts'), 'utf8');

  /**
   * `/connections/executions` já está no ar. Um deploy que chegue antes da
   * migration não pode derrubá-la: `e.undone_at` numa coluna inexistente é
   * 42703 cru, 500 sem frase, tela viva quebrada por um recurso que ainda
   * não nasceu. Lido do registro inteiro, o campo ausente vira nulo.
   */
  it('lê undone_at do registro inteiro, e não da coluna direto', () => {
    expect(fonte).toContain("to_jsonb(e) ->> 'undone_at' as undone_at");
    expect(fonte).not.toMatch(/e\.active, e\.result, e\.undone_at/);
  });
});

/* ─────────────────────── F26.8: as escritas novas ─────────────────────── */
/*
 * O mundo é montado pelas ESCRITAS DE VERDADE (`createTaskWork`,
 * `assignTaskWork`…), nos mesmos ports em memória que o desfazer lê. Assim o
 * `changes` que o desfazer consulta é o que as escritas gravaram, e não um
 * espelho escrito à mão no teste.
 */

const LISTA = 'f2600001-0000-4000-8000-000000000001';
const ABERTA = 'f2600002-0000-4000-8000-000000000001';
const FECHADA = 'f2600002-0000-4000-8000-000000000002';
const EM_PRODUCAO = 'f2600002-0000-4000-8000-000000000003';
const LISTA_2 = 'f2600001-0000-4000-8000-000000000002';
const ABERTA_2 = 'f2600002-0000-4000-8000-000000000004';
const FECHADA_2 = 'f2600002-0000-4000-8000-000000000005';
const ETIQUETA = 'f2600004-0000-4000-8000-000000000001';
const CLIENTE = 'f2600003-0000-4000-8000-000000000001';
const HELENA = '33333333-3333-4333-8333-333333333333';

const PESSOA_F26: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a'],
  clientIds: [CLIENTE],
  hasAllClientsAccess: true,
};

function mundoF26(automations: readonly MemoryTaskAutomation[] = []) {
  const ledger = new MemoryAgentWriteStore();
  ledger.seedPerson(PESSOA_F26);
  const grantA = grant(GRANT_A);
  const grantB = grant(GRANT_B);
  ledger.seedGrant(grantA);
  ledger.seedGrant(grantB);
  const comments = new MemoryCommentBoard(OWNER_ID);
  const pessoas = [
    { id: OWNER_ID, companyIds: ['empresa-a'] },
    { id: HELENA, companyIds: ['empresa-a'] },
  ];
  const tasks = new MemoryTaskBoard({
    automations,
    lists: [
      {
        id: LISTA,
        companyId: 'empresa-a',
        clientId: CLIENTE,
        openStatusId: ABERTA,
        closedStatusId: FECHADA,
        tagIds: [ETIQUETA],
      },
      // F44, Fase 8 — o destino de uma regra que encaminha.
      { id: LISTA_2, companyId: 'empresa-a', clientId: CLIENTE, openStatusId: ABERTA_2, closedStatusId: FECHADA_2 },
    ],
    people: pessoas,
  });
  const records = new MemoryClientRecordBoard(
    { ownerId: OWNER_ID, viaName: grantA.name },
    { clients: [{ id: CLIENTE, companyId: 'empresa-a' }], people: pessoas },
  );
  // Cada escrita 5 minutos depois da anterior, como numa conversa de verdade.
  let relogio = new Date('2026-09-22T10:00:00.000Z').getTime();
  const ctx = (g: IntegrationGrant = grantA): WriteCtx => {
    relogio += 5 * 60_000;
    return {
      grant: g,
      person: PESSOA_F26,
      origin: 'mcp',
      store: ledger,
      comments,
      tasks,
      clientRecords: records,
      now: new Date(relogio),
    };
  };
  const store = new MemoryUndoStore(ledger, comments, OWNER_ID, { tasks, records });
  return { ledger, comments, tasks, records, store, ctx, grantA, grantB };
}

type Mundo = ReturnType<typeof mundoF26>;

function ok<T>(r: { ok: true; body: T } | { ok: false; code: string; message: string }): T {
  if (!r.ok) throw new Error(`escrita recusada no preparo do teste: ${r.code} — ${r.message}`);
  return r.body;
}

/** O lote misto da decisão 3: criar, atribuir, concluir, nota e registro. */
async function loteMisto(m: Mundo) {
  const criada = ok(
    await createTaskWork(m.ctx(), { listId: LISTA, title: 'Pauta de outubro', dueOn: '2026-09-30', idempotencyKey: 'k-criar' }),
  );
  const taskId = criada.taskId!;
  ok(await assignTaskWork(m.ctx(), { taskId, assigneeIds: [HELENA], idempotencyKey: 'k-atribuir' }));
  ok(await completeTaskWork(m.ctx(), { taskId, idempotencyKey: 'k-concluir' }));
  const nota = ok(await addMuralNoteWork(m.ctx(), { clientId: CLIENTE, content: 'Ligar na segunda', idempotencyKey: 'k-nota' }));
  const registro = ok(
    await addHistoryEntryWork(m.ctx(), {
      clientId: CLIENTE,
      happenedOn: '2026-09-22',
      title: 'Reunião de pauta',
      body: 'Relato da reunião',
      idempotencyKey: 'k-registro',
    }),
  );
  return { taskId, noteId: nota.noteId!, entryId: registro.entryId! };
}

function itemDe(outcome: UndoOutcome, operation: string) {
  const item = outcome.items.find((i) => i.operation === operation);
  if (!item) throw new Error(`sem item para ${operation}`);
  return item;
}

function execucoesDe(m: Mundo, operation: string) {
  return [...m.ledger.executions.values()].filter((row) => row.operation === operation);
}

describe('desfazer em lote das escritas novas (F26.8)', () => {
  it('lote misto: volta tudo o que pode — tarefa arquivada, nota e registro apagados', async () => {
    const m = mundoF26();
    const { taskId, noteId, entryId } = await loteMisto(m);
    expect(m.tasks.tasks.get(taskId)?.completed).toBe(true);

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(outcome.examined).toBe(5);
    expect(outcome.undone).toBe(5);
    expect(outcome.skipped).toBe(0);
    expect(outcome.notUndoable).toBe(0);
    const tarefa = m.tasks.tasks.get(taskId)!;
    expect(tarefa.archived).toBe(true);
    expect(tarefa.completed).toBe(false);
    expect(tarefa.statusId).toBe(ABERTA);
    expect(tarefa.assigneeIds).toEqual([]);
    expect(m.records.notes.has(noteId)).toBe(false);
    expect(m.records.entries.has(entryId)).toBe(false);
    expect(itemDe(outcome, 'create_task').message).toMatch(/arquivada/);
  });

  it('volta da mais nova para a mais antiga: a atribuição e a conclusão voltam antes do arquivamento', async () => {
    const m = mundoF26();
    await loteMisto(m);

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(outcome.items.map((i) => i.operation)).toEqual([
      'add_history_entry',
      'add_mural_note',
      'complete_task',
      'assign_task',
      'create_task',
    ]);
  });

  it('F38, Fase 6.3: criar já na etapa concluída e desfazer arquiva a tarefa inteira', async () => {
    const m = mundoF26();
    const criada = ok(
      await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', statusId: FECHADA, idempotencyKey: 'k-etapa' }),
    );
    const taskId = criada.taskId!;
    expect(m.tasks.tasks.get(taskId)).toMatchObject({ statusId: FECHADA, completed: true, archived: false });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(outcome.undone).toBe(1);
    expect(m.tasks.tasks.get(taskId)?.archived).toBe(true);
  });

  it('F38, Fase 6.4: subtarefa criada pela IA (parentId) é arquivada no lote; a mãe da pessoa fica', async () => {
    const m = mundoF26();
    const MAE = 'f2600005-0000-4000-8000-000000000001';
    m.tasks.tasks.set(MAE, {
      taskId: MAE,
      listId: LISTA,
      statusId: ABERTA,
      completed: false,
      dueOn: null,
      startOn: null,
      priority: null,
      assigneeIds: [],
      tagIds: [],
      companyId: 'empresa-a',
      clientId: CLIENTE,
      archived: false,
      title: 'Mãe criada por gente',
      description: null,
      createdBy: OWNER_ID,
      completedBy: null,
    });
    const criada = ok(await createTaskWork(m.ctx(), { parentId: MAE, title: 'Passo', idempotencyKey: 'k-sub' }));
    const subId = criada.taskId!;
    expect(criada.parentId).toBe(MAE);
    expect(m.tasks.tasks.get(subId)).toMatchObject({ listId: LISTA, clientId: CLIENTE, parentId: MAE, archived: false });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(outcome.undone).toBe(1);
    expect(itemDe(outcome, 'create_task').status).toBe('undone');
    expect(m.tasks.tasks.get(subId)?.archived).toBe(true);
    expect(m.tasks.tasks.get(MAE)?.archived).toBe(false);
  });

  it('duas trocas de prazo seguidas voltam uma de cada vez, até o valor original', async () => {
    const m = mundoF26();
    const criada = ok(await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', dueOn: '2026-09-30', idempotencyKey: 'k1' }));
    const taskId = criada.taskId!;
    ok(await updateTaskWork(m.ctx(), { taskId, dueOn: '2026-10-01', idempotencyKey: 'k2' }));
    ok(await updateTaskWork(m.ctx(), { taskId, dueOn: '2026-10-05', priority: 'high', idempotencyKey: 'k3' }));

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(outcome.undone).toBe(3);
    const tarefa = m.tasks.tasks.get(taskId)!;
    expect(tarefa.dueOn).toBe('2026-09-30');
    expect(tarefa.priority).toBeNull();
    expect(tarefa.archived).toBe(true);
  });

  it('pessoa mudou o prazo depois: a troca de prazo é pulada, com motivo, e a criação também', async () => {
    const m = mundoF26();
    const criada = ok(await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', dueOn: '2026-09-30', idempotencyKey: 'k1' }));
    const taskId = criada.taskId!;
    ok(await updateTaskWork(m.ctx(), { taskId, dueOn: '2026-10-01', idempotencyKey: 'k2' }));
    // A Helena, pela tela, empurra o prazo.
    m.tasks.tasks.set(taskId, { ...m.tasks.tasks.get(taskId)!, dueOn: '2026-10-20' });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    const troca = itemDe(outcome, 'update_task');
    expect(troca.status).toBe('skipped');
    expect(troca.reason).toBe('changed_later');
    expect(troca.message).toMatch(/O prazo: uma pessoa mudou isso depois/);
    const criacao = itemDe(outcome, 'create_task');
    expect(criacao.status).toBe('skipped');
    expect(criacao.reason).toBe('touched_later');
    expect(criacao.message).toMatch(/uma pessoa mudou o prazo/i);
    // Nada mexido, nada carimbado: o registro não mente sobre o que ficou.
    expect(m.tasks.tasks.get(taskId)).toMatchObject({ dueOn: '2026-10-20', archived: false });
    expect(outcome.undone).toBe(0);
    expect([...m.ledger.executions.values()].every((row) => !row.undoneAt)).toBe(true);
  });

  it('pessoa trocou o responsável depois: a atribuição e a criação ficam, a conclusão volta', async () => {
    const m = mundoF26();
    const { taskId } = await loteMisto(m);
    m.tasks.tasks.set(taskId, { ...m.tasks.tasks.get(taskId)!, assigneeIds: [OWNER_ID] });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(itemDe(outcome, 'complete_task').status).toBe('undone');
    expect(itemDe(outcome, 'assign_task')).toMatchObject({ status: 'skipped', reason: 'changed_later' });
    expect(itemDe(outcome, 'assign_task').message).toMatch(/Os responsáveis/);
    expect(itemDe(outcome, 'create_task')).toMatchObject({ status: 'skipped', reason: 'touched_later' });
    expect(m.tasks.tasks.get(taskId)).toMatchObject({ archived: false, completed: false, assigneeIds: [OWNER_ID] });
    expect(execucoesDe(m, 'assign_task')[0].undoneAt ?? null).toBeNull();
    expect(execucoesDe(m, 'complete_task')[0].undoneAt).toBeTruthy();
  });

  it('outra escrita de IA mudou o campo depois: a frase manda desfazê-la antes', async () => {
    const m = mundoF26();
    const criada = ok(await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', idempotencyKey: 'k1' }));
    const taskId = criada.taskId!;
    ok(await updateTaskWork(m.ctx(), { taskId, dueOn: '2026-10-01', idempotencyKey: 'k2' }));
    ok(await updateTaskWork(m.ctx(m.grantB), { taskId, dueOn: '2026-10-09', idempotencyKey: 'k3' }));

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(itemDe(outcome, 'update_task').message).toMatch(/escrita posterior de IA mudou o prazo/);
    // A outra conexão é da MESMA pessoa: não é mexida de gente, e a criação arquiva.
    expect(itemDe(outcome, 'create_task').status).toBe('undone');
  });

  it('comentário de pessoa, evento sem marca, anexo ou edição à mão: a tarefa não é arquivada', async () => {
    const casos: Array<[string, (m: Mundo, taskId: string) => void, RegExp]> = [
      [
        'comentário',
        (m, taskId) =>
          m.comments.comments.set('c-gente', { id: 'c-gente', taskId, parentId: null, body: 'oi', authorId: HELENA }),
        /comentário de pessoa/,
      ],
      [
        'evento',
        (m, taskId) =>
          m.store.taskMeta.set(taskId, { unmarkedEvents: [{ at: new Date('2026-09-22T11:00:00Z'), actorId: HELENA }] }),
        /moveu esta tarefa ou trocou os responsáveis/,
      ],
      ['anexo', (m, taskId) => m.store.taskMeta.set(taskId, { extras: 1 }), /subtarefa, checklist, link ou anexo/],
      [
        'edição à mão',
        (m, taskId) =>
          m.store.taskMeta.set(taskId, {
            createdAt: new Date('2026-09-22T10:05:00Z'),
            updatedAt: new Date('2026-09-22T11:30:00Z'),
          }),
        /editou esta tarefa depois/,
      ],
    ];
    for (const [nome, mexer, frase] of casos) {
      const m = mundoF26();
      const criada = ok(await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', idempotencyKey: `k-${nome}` }));
      mexer(m, criada.taskId!);

      const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

      const item = itemDe(outcome, 'create_task');
      expect(item.status, nome).toBe('skipped');
      expect(item.message, nome).toMatch(frase);
      expect(m.tasks.tasks.get(criada.taskId!)?.archived, nome).toBe(false);
    }
  });

  it('a própria escrita da IA dentro da folga do relógio não conta como mexida de gente', async () => {
    const m = mundoF26();
    const criada = ok(await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', idempotencyKey: 'k1' }));
    const taskId = criada.taskId!;
    const troca = ok(await updateTaskWork(m.ctx(), { taskId, title: 'Peça revista', idempotencyKey: 'k2' }));
    expect(troca.replay).toBe(false);
    const quando = execucoesDe(m, 'update_task')[0].occurredAt.getTime();
    // O `updated_at` do banco caiu 20 s depois do relógio do registro.
    m.store.taskMeta.set(taskId, { createdAt: new Date(quando - 300_000), updatedAt: new Date(quando + 20_000) });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(itemDe(outcome, 'create_task').status).toBe('undone');
  });

  it('texto editado não se desfaz; a parte pequena de uma edição mista volta', async () => {
    const m = mundoF26();
    const criada = ok(await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', idempotencyKey: 'k1' }));
    const taskId = criada.taskId!;
    ok(await updateTaskWork(m.ctx(), { taskId, title: 'Só o título', idempotencyKey: 'k2' }));
    ok(await updateTaskWork(m.ctx(), { taskId, description: 'nova', priority: 'urgent', idempotencyKey: 'k3' }));
    const { noteId } = await (async () => {
      const nota = ok(await addMuralNoteWork(m.ctx(), { clientId: CLIENTE, content: 'Nota', idempotencyKey: 'k4' }));
      ok(await updateMuralNoteWork(m.ctx(), { noteId: nota.noteId!, content: 'Nota revista', idempotencyKey: 'k5' }));
      return { noteId: nota.noteId! };
    })();
    // Um movimento de card, direto no registro (o molde de `execucao`).
    m.ledger.executions.set(
      'e-move',
      execucao('e-move', GRANT_A, '', '2026-09-22T11:55:00.000Z', {
        operation: 'move_task',
        targetId: taskId,
        result: { taskId, statusId: EM_PRODUCAO, completed: false },
        changes: { subtasksMoved: 0, automation: false },
      }),
    );
    m.tasks.tasks.set(taskId, { ...m.tasks.tasks.get(taskId)!, statusId: EM_PRODUCAO });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    const [soTexto, mista] = outcome.items.filter((i) => i.operation === 'update_task').reverse();
    expect(soTexto).toMatchObject({ status: 'not_undoable', reason: 'text_edit' });
    expect(mista).toMatchObject({ status: 'undone', textNotUndone: ['description'] });
    expect(mista.message).toMatch(/A prioridade voltou ao valor anterior\. O texto editado \(descrição\) não volta/);
    expect(itemDe(outcome, 'update_mural_note')).toMatchObject({ status: 'not_undoable', reason: 'text_edit' });
    expect(itemDe(outcome, 'move_task')).toMatchObject({ status: 'not_undoable', reason: 'move' });
    expect(outcome.notUndoable).toBe(3);
    // A nota editada pela PRÓPRIA IA é apagada; a tarefa movida pela IA, arquivada.
    expect(m.records.notes.has(noteId)).toBe(false);
    expect(m.tasks.tasks.get(taskId)?.archived).toBe(true);
    expect(m.tasks.tasks.get(taskId)?.priority).toBeNull();
    // O que não se desfaz NÃO é carimbado: continua valendo.
    expect(m.ledger.executions.get('e-move')?.undoneAt ?? null).toBeNull();
    expect(execucoesDe(m, 'update_mural_note')[0].undoneAt ?? null).toBeNull();
  });

  it('nota editada ou arrastada por pessoa, e registro com documento, ficam', async () => {
    const m = mundoF26();
    const { noteId, entryId } = await loteMisto(m);
    m.store.recordMeta.set(noteId, {
      createdAt: new Date('2026-09-22T10:20:00Z'),
      updatedAt: new Date('2026-09-22T11:40:00Z'),
    });
    m.store.recordMeta.set(entryId, { documents: 1 });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(itemDe(outcome, 'add_mural_note')).toMatchObject({ status: 'skipped', reason: 'touched_later' });
    expect(itemDe(outcome, 'add_mural_note').message).toMatch(/arrastou/);
    expect(itemDe(outcome, 'add_history_entry').message).toMatch(/documento/);
    expect(m.records.notes.has(noteId)).toBe(true);
    expect(m.records.entries.has(entryId)).toBe(true);
    expect(itemDe(outcome, 'create_task').status).toBe('undone');
  });

  it('respeita a janela de tempo: o que ficou fora não volta nem é carimbado', async () => {
    const m = mundoF26();
    const { taskId, noteId } = await loteMisto(m);
    const conclusao = execucoesDe(m, 'complete_task')[0].occurredAt;

    const outcome = await undoGrantWrites({
      store: m.store,
      grantId: GRANT_A,
      ownerId: OWNER_ID,
      window: { from: conclusao, to: null },
      now: AGORA,
    });

    expect(outcome.items.map((i) => i.operation)).toEqual(['add_history_entry', 'add_mural_note', 'complete_task']);
    expect(m.tasks.tasks.get(taskId)).toMatchObject({ archived: false, completed: false, assigneeIds: [HELENA] });
    expect(m.records.notes.has(noteId)).toBe(false);
    expect(execucoesDe(m, 'create_task')[0].undoneAt ?? null).toBeNull();
    expect(execucoesDe(m, 'assign_task')[0].undoneAt ?? null).toBeNull();
  });

  it('o carimbo é do DONO, e desfazer duas vezes não faz nada', async () => {
    const m = mundoF26();
    const { taskId } = await loteMisto(m);

    await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });
    const carimbos = [...m.ledger.executions.values()];
    expect(carimbos.every((row) => row.undoneBy === OWNER_ID && row.undoneAt?.getTime() === AGORA.getTime())).toBe(true);

    const mutacoesAntes = m.tasks.mutations;
    const retrato = structuredClone(m.tasks.tasks.get(taskId));
    const segundo = await undoGrantWrites({
      store: m.store,
      grantId: GRANT_A,
      ownerId: OWNER_ID,
      now: new Date('2026-09-23T12:00:00.000Z'),
    });

    expect(segundo.examined).toBe(0);
    expect(segundo.items).toEqual([]);
    expect(m.tasks.mutations).toBe(mutacoesAntes);
    expect(m.tasks.tasks.get(taskId)).toEqual(retrato);
    expect(execucoesDe(m, 'create_task')[0].undoneAt?.getTime()).toBe(AGORA.getTime());
  });

  it('sem alcance para arquivar: pula com o motivo, e o resto do lote segue', async () => {
    const m = mundoF26();
    const { taskId, noteId } = await loteMisto(m);
    m.store.denied.add(taskId);

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(itemDe(outcome, 'create_task')).toMatchObject({ status: 'skipped', reason: 'permission_denied' });
    expect(itemDe(outcome, 'complete_task')).toMatchObject({ status: 'skipped', reason: 'permission_denied' });
    expect(m.records.notes.has(noteId)).toBe(false);
    expect(execucoesDe(m, 'create_task')[0].undoneAt ?? null).toBeNull();
  });

  it('o que alguém já apagou ou arquivou conta como ido; o que saiu do alcance fica pulado', async () => {
    const m = mundoF26();
    const { taskId, noteId, entryId } = await loteMisto(m);
    m.tasks.tasks.set(taskId, { ...m.tasks.tasks.get(taskId)!, archived: true });
    m.records.notes.delete(noteId);
    m.records.entries.delete(entryId);
    m.store.visibleContainers.add(CLIENTE);

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(itemDe(outcome, 'create_task')).toMatchObject({ status: 'already_gone' });
    expect(itemDe(outcome, 'add_mural_note')).toMatchObject({ status: 'already_gone' });
    expect(itemDe(outcome, 'complete_task')).toMatchObject({ status: 'skipped', reason: 'archived' });
    expect(execucoesDe(m, 'add_mural_note')[0].undoneAt).toBeTruthy();

    const fora = mundoF26();
    const lote = await loteMisto(fora);
    fora.records.notes.delete(lote.noteId);
    const semAlcance = await undoGrantWrites({ store: fora.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });
    expect(itemDe(semAlcance, 'add_mural_note')).toMatchObject({ status: 'skipped', reason: 'not_found' });
  });

  it('falhar ao carimbar derruba o lote inteiro — nada volta', async () => {
    const m = mundoF26();
    const { taskId, noteId } = await loteMisto(m);
    m.store.failMarkUndone = true;

    await expect(undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA })).rejects.toThrow(
      /registrar o desfazer/,
    );

    expect(m.tasks.tasks.get(taskId)).toMatchObject({ archived: false, completed: true, assigneeIds: [HELENA] });
    expect(m.records.notes.has(noteId)).toBe(true);
  });

  it('o agente não desfaz por conta própria: a rota recusa o token dele, e o dono desfaz', async () => {
    const m = mundoF26();
    const { taskId } = await loteMisto(m);
    const grants = new MemoryGrantStore();
    grants.grants.set(GRANT_A, m.grantA);
    const server = await montarServidor(m.store, grants);
    const url = `${ORIGIN}${CONNECTIONS_PATH}/${GRANT_A}/undo`;

    const comoAgente = await server.fetch(
      new Request(url, { method: 'POST', headers: { Authorization: 'Bearer ideworks_auto_qualquer', Origin: ORIGIN } }),
    );
    expect(comoAgente.status).toBe(401);
    expect(m.tasks.tasks.get(taskId)?.archived).toBe(false);
    expect([...m.ledger.executions.values()].every((row) => !row.undoneAt)).toBe(true);

    const comoDono = await server.fetch(
      new Request(url, { method: 'POST', headers: { Cookie: HUMAN_COOKIE, Origin: ORIGIN } }),
    );
    expect(comoDono.status).toBe(200);
    const body = (await comoDono.json()) as UndoOutcome;
    expect(body.undone).toBe(5);
    expect(body.items).toHaveLength(5);
    expect(m.tasks.tasks.get(taskId)?.archived).toBe(true);
  });
});

describe('desfazer concluir que rodou a automação da etapa (F44, Fase 8)', () => {
  it('a regra trocou quem cuida: o desfazer volta a etapa E os responsáveis, sem passar pela primeira que abre', async () => {
    const m = mundoF26([
      { sourceListId: LISTA, triggerStatusId: FECHADA, assigneeId: OWNER_ID },
      // Uma regra na primeira que abre: o desfazer NÃO pode dispará-la — a
      // tarefa estava em produção, e volta direto para lá. Se passasse pela
      // primeira que abre, os responsáveis terminariam no dono, e não na Helena.
      { sourceListId: LISTA, triggerStatusId: ABERTA, assigneeId: OWNER_ID },
    ]);
    const criada = ok(
      await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', assigneeIds: [HELENA], idempotencyKey: 'k-criar' }),
    );
    const taskId = criada.taskId!;
    // Uma pessoa levou a tarefa para "em produção" pelo quadro.
    m.tasks.tasks.set(taskId, { ...m.tasks.tasks.get(taskId)!, statusId: EM_PRODUCAO });
    const concluida = ok(await completeTaskWork(m.ctx(), { taskId, idempotencyKey: 'k-concluir' }));
    expect(concluida.task).toMatchObject({ completed: true, statusId: FECHADA, assigneeIds: [OWNER_ID] });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(itemDe(outcome, 'complete_task').status).toBe('undone');
    expect(m.tasks.tasks.get(taskId)).toMatchObject({ completed: false, statusId: EM_PRODUCAO, assigneeIds: [HELENA] });
  });

  it('a regra levou a tarefa para outra lista: é movimento de card, não se desfaz, e o registro fica sem carimbo', async () => {
    const m = mundoF26([{ sourceListId: LISTA, triggerStatusId: FECHADA, targetListId: LISTA_2 }]);
    const criada = ok(await createTaskWork(m.ctx(), { listId: LISTA, title: 'Peça', idempotencyKey: 'k-criar' }));
    const taskId = criada.taskId!;
    ok(await completeTaskWork(m.ctx(), { taskId, idempotencyKey: 'k-concluir' }));
    expect(m.tasks.tasks.get(taskId)).toMatchObject({ listId: LISTA_2, statusId: ABERTA_2, completed: false });

    const outcome = await undoGrantWrites({ store: m.store, grantId: GRANT_A, ownerId: OWNER_ID, now: AGORA });

    expect(itemDe(outcome, 'complete_task')).toMatchObject({ status: 'not_undoable', reason: 'move' });
    expect(itemDe(outcome, 'complete_task').message).toMatch(/levou a tarefa para outra lista/);
    expect(execucoesDe(m, 'complete_task')[0].undoneAt ?? null).toBeNull();
    expect(m.tasks.tasks.get(taskId)).toMatchObject({ listId: LISTA_2, statusId: ABERTA_2 });
  });
});
