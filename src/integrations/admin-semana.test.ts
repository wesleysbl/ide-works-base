/**
 * O painel de controle da semana pela IA — F40, Fase 9.
 *
 * `get_admin_week` (leitura) e `release_task` (escrita), pelo MCP e pelo HTTP,
 * nos ports em memória (a suíte não fala com o banco, F0.4). A leitura contra o
 * Postgres de verdade (a MESMA função da rota) está em `admin-semana-banco.test.ts`.
 *
 * O que prova: só admin (e só com a concessão certa); a regra da tela
 * (destino por tipo, recusas com código próprio); registro, chave de repetição,
 * teto diário e ensaio; e o desfazer em lote devolvendo o card para
 * "atribuir demanda", sem responsável e com o prazo de antes.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { MemoryAdminWeekCatalog, getAdminWeek } from '@/integrations/admin-semana';
import {
  ERROR_STATUS,
  GET_ADMIN_WEEK_PATH,
  INTEGRATION_ERROR_CODES,
  RELEASE_TASK_PATH,
  getAdminWeekInputSchema,
  getAdminWeekOpenApiExample,
  getAdminWeekResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
  releaseTaskInputSchema,
  releaseTaskOpenApiExample,
  releaseTaskResponseSchema,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { MemoryAgentWriteStore, type PersistedExecution } from '@/integrations/executions';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { MemoryWorkCatalog } from '@/integrations/reads';
import { MemoryDeliveryCatalog } from '@/integrations/reports';
import { MemoryUndoStore, undoGrantWrites } from '@/integrations/undo';
import {
  MemoryCommentBoard,
  MemoryTaskBoard,
  RELEASE_ADMIN_ONLY,
  RELEASE_DENIED,
  assignTaskWork,
  releaseTaskWork,
  type WriteCtx,
} from '@/integrations/writes';
import type { ControleDaSemana } from '@/server/controle-da-semana';

const agora = new Date('2026-10-07T15:00:00.000Z');
const ORIGIN = 'https://ideworks.test';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const HELENA = '33333333-3333-4333-8333-333333333333';
const FORA = '66666666-6666-4666-8666-666666666666';
const LIST_PROD = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const LIST_SEM_ARTE = 'aaaaaaa2-aaa2-4aa2-8aa2-aaaaaaaaaaa2';
const S_ATRIBUIR = 'bbbbbbb1-bbb1-4bb1-8bb1-bbbbbbbbbbb1';
const S_AFAZER = 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2';
const S_AFAZER_VIDEO = 'bbbbbbb3-bbb3-4bb3-8bb3-bbbbbbbbbbb3';
const S_AFAZER_ARTE = 'bbbbbbb4-bbb4-4bb4-8bb4-bbbbbbbbbbb4';
const S_FEITO = 'bbbbbbb5-bbb5-4bb5-8bb5-bbbbbbbbbbb5';
const S2_ATRIBUIR = 'bbbbbbc1-bbc1-4bc1-8bc1-bbbbbbbbbbc1';
const S2_AFAZER_VIDEO = 'bbbbbbc3-bbc3-4bc3-8bc3-bbbbbbbbbbc3';
const T_VIDEO = 'ddddddd1-ddd1-4dd1-8dd1-ddddddddddd1';
const T_ARTE = 'ddddddd2-ddd2-4dd2-8dd2-ddddddddddd2';
const T_FOTO = 'ddddddd3-ddd3-4dd3-8dd3-ddddddddddd3';
const T_OUTROS = 'ddddddd4-ddd4-4dd4-8dd4-ddddddddddd4';
const T_SEM_TIPO = 'ddddddd5-ddd5-4dd5-8dd5-ddddddddddd5';
const T_SEM_ARTE = 'ddddddd6-ddd6-4dd6-8dd6-ddddddddddd6';
const T_JA_LIBERADO = 'ddddddd7-ddd7-4dd7-8dd7-ddddddddddd7';

const person: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a'],
  clientIds: ['cliente-a'],
  hasAllClientsAccess: true,
};
const funcionario: PersonAccess = { ...person, isSuperadmin: false };

const RELEASE_CAPS = ['tasks:assign', 'tasks:write', 'tasks:move'] as const;
const adminGrant: IntegrationGrant = {
  id: GRANT_ID,
  ownerId: OWNER_ID,
  oauthClientId: 'ideworks-claude',
  name: 'Claude da agência',
  capabilities: [...READ_CAPABILITIES, ...RELEASE_CAPS],
  allowedCompanyIds: ['empresa-a'],
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

function board() {
  const esteira = [
    { id: S_ATRIBUIR, name: 'Atribuir Demanda', color: null, type: 'open' as const },
    { id: S_AFAZER, name: 'A fazer', color: null, type: 'custom' as const },
    { id: S_AFAZER_VIDEO, name: 'A fazer Vídeo', color: null, type: 'custom' as const },
    { id: S_AFAZER_ARTE, name: 'a fazer arte', color: null, type: 'custom' as const },
    { id: S_FEITO, name: 'Feito', color: null, type: 'closed' as const },
  ];
  return new MemoryTaskBoard({
    lists: [
      {
        id: LIST_PROD,
        name: 'Clinimax',
        companyId: 'empresa-a',
        clientId: 'cliente-a',
        openStatusId: S_ATRIBUIR,
        closedStatusId: S_FEITO,
        statuses: esteira,
        isProduction: true,
      },
      {
        // Esteira SEM "a fazer arte".
        id: LIST_SEM_ARTE,
        name: 'Sem Arte',
        companyId: 'empresa-a',
        clientId: 'cliente-a',
        openStatusId: S2_ATRIBUIR,
        closedStatusId: S_FEITO,
        statuses: [
          { id: S2_ATRIBUIR, name: 'atribuir demanda', color: null, type: 'open' },
          { id: S2_AFAZER_VIDEO, name: 'a fazer video', color: null, type: 'custom' },
        ],
        isProduction: true,
      },
    ],
    people: [
      { id: OWNER_ID, companyIds: ['empresa-a'] },
      { id: HELENA, companyIds: ['empresa-a'] },
    ],
    tasks: [
      { taskId: T_VIDEO, listId: LIST_PROD, title: 'Reels', type: 'video', dueOn: '2026-10-02', statusId: S_ATRIBUIR },
      { taskId: T_ARTE, listId: LIST_PROD, title: 'Arte', type: 'arte', dueOn: '2026-10-02', statusId: S_ATRIBUIR },
      { taskId: T_FOTO, listId: LIST_PROD, title: 'Foto', type: 'foto', dueOn: '2026-10-02', statusId: S_ATRIBUIR },
      { taskId: T_OUTROS, listId: LIST_PROD, title: 'Outros', type: 'outros', dueOn: '2026-10-02', statusId: S_ATRIBUIR },
      { taskId: T_SEM_TIPO, listId: LIST_PROD, title: 'Sem tipo', dueOn: '2026-10-02', statusId: S_ATRIBUIR },
      { taskId: T_SEM_ARTE, listId: LIST_SEM_ARTE, title: 'Arte sem fila', type: 'arte', statusId: S2_ATRIBUIR },
      { taskId: T_JA_LIBERADO, listId: LIST_PROD, title: 'Já liberado', type: 'video', statusId: S_AFAZER_VIDEO },
    ],
  });
}

function setup(grant: IntegrationGrant = adminGrant, who: PersonAccess = person) {
  const store = new MemoryAgentWriteStore();
  store.seedPerson(who);
  store.seedGrant(grant);
  const tasks = board();
  const comments = new MemoryCommentBoard(OWNER_ID);
  const ctx: WriteCtx = { grant, person: who, origin: 'mcp', store, comments, tasks, now: agora };
  return { store, tasks, comments, ctx };
}

const rows = (store: MemoryAgentWriteStore): PersistedExecution[] => [...store.executions.values()];

const liberar = (taskId: string, extra: Record<string, unknown> = {}) => ({
  taskId,
  assigneeIds: [HELENA],
  dueOn: '2026-10-09',
  idempotencyKey: `k-${taskId}`,
  ...extra,
});

/* ───────────────────────────── a escrita ───────────────────────────── */

describe('release_task — a regra da tela', () => {
  it('cada tipo vai para a etapa certa (D3), com responsável e prazo, e o registro guarda antes e depois', async () => {
    const { ctx, tasks, store } = setup();
    const casos: Array<[string, string, string]> = [
      [T_VIDEO, S_AFAZER_VIDEO, 'A fazer Vídeo'],
      [T_ARTE, S_AFAZER_ARTE, 'a fazer arte'],
      [T_FOTO, S_AFAZER, 'A fazer'],
      [T_OUTROS, S_AFAZER, 'A fazer'],
    ];
    for (const [taskId, etapa, nome] of casos) {
      const r = await releaseTaskWork(ctx, liberar(taskId));
      if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
      const body = releaseTaskResponseSchema.parse(r.body);
      expect(body).toMatchObject({ operation: 'release_task', taskId, statusName: nome, dryRun: false, replay: false });
      expect(body.task).toMatchObject({ statusId: etapa, dueOn: '2026-10-09', assigneeIds: [HELENA] });
      const linha = tasks.tasks.get(taskId)!;
      expect(linha).toMatchObject({ statusId: etapa, dueOn: '2026-10-09', assigneeIds: [HELENA] });
    }
    // O registro: assign_task + released, com antes e depois dos três campos.
    const registro = rows(store).find((row) => row.targetId === T_VIDEO)!;
    expect(registro.operation).toBe('assign_task');
    expect(registro.changes).toMatchObject({
      released: true,
      before: { assigneeIds: [], dueOn: '2026-10-02', statusId: S_ATRIBUIR },
      after: { assigneeIds: [HELENA], dueOn: '2026-10-09', statusId: S_AFAZER_VIDEO },
    });
    expect(JSON.stringify(registro)).not.toContain('Reels');
  });

  it('as recusas da tela viram códigos próprios, e nada é gravado', async () => {
    const { ctx, tasks, store } = setup();

    const semTipo = await releaseTaskWork(ctx, liberar(T_SEM_TIPO));
    expect(semTipo).toMatchObject({ ok: false, code: 'type_required', taskId: T_SEM_TIPO });
    expect((semTipo as { typeOptions?: unknown[] }).typeOptions).toHaveLength(4);

    const semFila = await releaseTaskWork(ctx, liberar(T_SEM_ARTE));
    expect(semFila).toMatchObject({ ok: false, code: 'stage_missing' });
    expect((semFila as { message: string }).message).toContain('a fazer arte');
    expect((semFila as { message: string }).message).toContain('Sem Arte');

    const jaLiberado = await releaseTaskWork(ctx, liberar(T_JA_LIBERADO));
    expect(jaLiberado).toMatchObject({ ok: false, code: 'already_released' });

    // O schema do MCP já barra, mas a regra responde igual se chegar vazio ou torto.
    const semPessoa = await releaseTaskWork(ctx, liberar(T_VIDEO, { assigneeIds: [], idempotencyKey: 'k-a' }));
    expect(semPessoa).toMatchObject({ ok: false, code: 'assignee_required' });
    const semPrazo = await releaseTaskWork(ctx, liberar(T_VIDEO, { dueOn: 'amanhã', idempotencyKey: 'k-b' }));
    expect(semPrazo).toMatchObject({ ok: false, code: 'due_required' });

    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
    expect(tasks.tasks.get(T_VIDEO)).toMatchObject({ statusId: S_ATRIBUIR, assigneeIds: [] });
  });

  it('os quatro códigos novos têm status HTTP', () => {
    for (const code of ['assignee_required', 'due_required', 'already_released', 'stage_missing'] as const) {
      expect(INTEGRATION_ERROR_CODES).toContain(code);
    }
    expect(ERROR_STATUS).toMatchObject({
      assignee_required: 400,
      due_required: 400,
      already_released: 409,
      stage_missing: 409,
      type_required: 400,
    });
  });
});

describe('release_task — concessão de admin', () => {
  it('pessoa que não é admin é recusada, mesmo com as três permissões', async () => {
    const { ctx, tasks, store } = setup(adminGrant, funcionario);
    const r = await releaseTaskWork(ctx, liberar(T_VIDEO));
    expect(r).toMatchObject({ ok: false, code: 'permission_denied', message: RELEASE_ADMIN_ONLY });
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
  });

  it('o papel relido DENTRO da transação também vale: quem deixou de ser admin entre o portão e a gravação é recusado', async () => {
    const { ctx, store, tasks } = setup();
    // O portão (ctx.person) ainda diz admin; o perfil relido na transação já não.
    store.seedPerson(funcionario);
    const r = await releaseTaskWork(ctx, liberar(T_VIDEO));
    expect(r).toMatchObject({ ok: false, code: 'permission_denied', message: RELEASE_ADMIN_ONLY });
    expect(tasks.mutations).toBe(0);
  });

  it('concessão sem uma das três permissões é recusada', async () => {
    for (const faltando of RELEASE_CAPS) {
      const grant = { ...adminGrant, capabilities: adminGrant.capabilities.filter((c) => c !== faltando) };
      const { ctx, tasks } = setup(grant);
      const r = await releaseTaskWork(ctx, liberar(T_VIDEO));
      expect(r).toMatchObject({ ok: false, code: 'permission_denied', message: RELEASE_DENIED });
      expect(tasks.mutations).toBe(0);
    }
  });

  it('responsável fora do alcance da concessão é recusado, como no assign_task', async () => {
    const { ctx, tasks } = setup();
    const r = await releaseTaskWork(ctx, liberar(T_VIDEO, { assigneeIds: [FORA] }));
    expect(r).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(tasks.mutations).toBe(0);
  });
});

describe('release_task — chave de repetição, ensaio e teto', () => {
  it('a mesma chave é replay: não libera nem registra de novo', async () => {
    const { ctx, tasks, store } = setup();
    const input = liberar(T_VIDEO);
    const primeira = await releaseTaskWork(ctx, input);
    const segunda = await releaseTaskWork(ctx, input);
    expect(primeira.ok && primeira.body.replay).toBe(false);
    expect(segunda).toMatchObject({ ok: true, body: { replay: true, statusName: 'A fazer Vídeo' } });
    expect(tasks.mutations).toBe(1);
    expect(rows(store)).toHaveLength(1);
  });

  it('a mesma chave com outro corpo, ou num assign_task, é conflito — nunca replay', async () => {
    const { ctx, tasks } = setup();
    await releaseTaskWork(ctx, liberar(T_VIDEO, { idempotencyKey: 'k-x' }));
    const outroPrazo = await releaseTaskWork(ctx, liberar(T_VIDEO, { dueOn: '2026-10-10', idempotencyKey: 'k-x' }));
    expect(outroPrazo.ok).toBe(false);
    const comoAtribuir = await assignTaskWork(ctx, { taskId: T_VIDEO, assigneeIds: [HELENA], idempotencyKey: 'k-x' });
    expect(comoAtribuir.ok).toBe(false);
    expect(tasks.mutations).toBe(1);
  });

  it('dryRun mostra o que faria, sem gravar, sem registro e sem gastar teto', async () => {
    const { ctx, tasks, store } = setup();
    const r = await releaseTaskWork(ctx, liberar(T_ARTE, { dryRun: true }));
    expect(r).toMatchObject({
      ok: true,
      body: { dryRun: true, statusName: 'a fazer arte', executionId: null, task: { statusId: S_AFAZER_ARTE } },
    });
    expect(tasks.mutations).toBe(0);
    expect(rows(store)).toHaveLength(0);
    expect(tasks.tasks.get(T_ARTE)).toMatchObject({ statusId: S_ATRIBUIR, assigneeIds: [] });
    // E a recusa do ensaio é a da escrita real.
    const ensaio = await releaseTaskWork(ctx, liberar(T_SEM_TIPO, { dryRun: true, idempotencyKey: 'k-e' }));
    expect(ensaio).toMatchObject({ ok: false, code: 'type_required' });
  });

  it('a 51ª escrita do dia é recusada com daily_write_limit', async () => {
    const { ctx, tasks } = setup();
    for (let i = 0; i < 50; i += 1) {
      const ok = await assignTaskWork(ctx, { taskId: T_JA_LIBERADO, assigneeIds: [HELENA], idempotencyKey: `laco-${i}` });
      expect(ok.ok).toBe(true);
    }
    const r = await releaseTaskWork(ctx, liberar(T_VIDEO));
    expect(r).toMatchObject({ ok: false, code: 'daily_write_limit', dailyWrites: { used: 50, limit: 50 } });
    expect(tasks.tasks.get(T_VIDEO)).toMatchObject({ statusId: S_ATRIBUIR });
  });
});

describe('release_task — desfazer em lote', () => {
  it('volta o card para "atribuir demanda", sem responsável e com o prazo de antes', async () => {
    const { ctx, tasks, store, comments } = setup();
    const feito = await releaseTaskWork(ctx, liberar(T_VIDEO));
    expect(feito.ok).toBe(true);
    expect(tasks.tasks.get(T_VIDEO)).toMatchObject({ statusId: S_AFAZER_VIDEO, assigneeIds: [HELENA], dueOn: '2026-10-09' });

    const undo = new MemoryUndoStore(store, comments, OWNER_ID, { tasks });
    const outcome = await undoGrantWrites({ store: undo, grantId: GRANT_ID, ownerId: OWNER_ID, now: agora });

    expect(outcome).toMatchObject({ examined: 1, undone: 1, skipped: 0 });
    expect(outcome.items[0].message).toMatch(/atribuir demanda.*sem os responsáveis.*prazo de antes/);
    expect(tasks.tasks.get(T_VIDEO)).toMatchObject({ statusId: S_ATRIBUIR, assigneeIds: [], dueOn: '2026-10-02' });
  });

  it('se uma pessoa mexeu no card depois, o desfazer deixa como está', async () => {
    const { ctx, tasks, store, comments } = setup();
    await releaseTaskWork(ctx, liberar(T_VIDEO));
    // Uma pessoa moveu o card para "feito" depois.
    const linha = tasks.tasks.get(T_VIDEO)!;
    tasks.tasks.set(T_VIDEO, { ...linha, statusId: S_FEITO });
    const undo = new MemoryUndoStore(store, comments, OWNER_ID, { tasks });
    const outcome = await undoGrantWrites({ store: undo, grantId: GRANT_ID, ownerId: OWNER_ID, now: agora });
    expect(outcome).toMatchObject({ undone: 0, skipped: 1 });
    expect(tasks.tasks.get(T_VIDEO)).toMatchObject({ statusId: S_FEITO, assigneeIds: [HELENA] });
  });
});

/* ───────────────────────────── a leitura ───────────────────────────── */

const SEMANA: ControleDaSemana = {
  week: { start: '2026-10-05', end: '2026-10-11', today: '2026-10-07', isCurrent: true, previous: '2026-09-28', next: '2026-10-12' },
  toAssign: [
    {
      clientId: 'cliente-a',
      clientName: 'Clinimax',
      type: 'video',
      cards: [{ id: T_VIDEO, title: 'Reels', createdBy: { id: HELENA, name: 'Helena' }, suggestedDueOn: '2026-10-09', list: { id: LIST_PROD, name: 'Clinimax' } }],
    },
    { clientId: 'cliente-a', clientName: 'Clinimax', type: null, cards: [] },
  ],
  progress: [{ clientId: 'cliente-a', clientName: 'Clinimax', type: 'video', awaiting: 1, todo: 0, doing: 1, done: 0 }],
  missing: {
    items: [{ clientId: 'cliente-a', clientName: 'Clinimax', type: 'video', target: 2, cards: 1, missing: 1 }],
    overdue: [
      {
        id: T_ARTE,
        title: 'Arte',
        dueOn: '2026-10-02',
        clientId: 'cliente-a',
        clientName: 'Clinimax',
        type: 'arte',
        list: { id: LIST_PROD, name: 'Clinimax' },
        statusName: 'Atribuir Demanda',
        assignees: [],
      },
    ],
    overdueTotal: 1,
  },
};

/** O corpo da ferramenta sem o que é da chamada (operação, instante, auto-link). */
function semMeta(body: Record<string, unknown>): Record<string, unknown> {
  const copia = { ...body };
  delete copia.operation;
  delete copia.queriedAt;
  delete copia.self;
  return copia;
}

function leitor() {
  const catalogo = new MemoryAdminWeekCatalog(async () => SEMANA);
  return catalogo;
}

describe('get_admin_week', () => {
  it('devolve os três blocos da função do servidor, sem refazer a regra, e passa a semana pedida', async () => {
    const adminWeek = leitor();
    const r = await getAdminWeek({ grant: adminGrant, person, adminWeek, now: agora }, { week: '2026-10-07' });
    if (!r.ok) throw new Error(r.message);
    expect(semMeta(getAdminWeekResponseSchema.parse(r.body))).toEqual(SEMANA);
    expect(adminWeek.calls).toEqual([
      { userId: OWNER_ID, week: '2026-10-07', scope: { companyIds: ['empresa-a'], clientIds: null } },
    ]);
    // Sem week: o catálogo recebe nulo e a função do servidor decide "a atual".
    await getAdminWeek({ grant: adminGrant, person, adminWeek, now: agora }, {});
    expect(adminWeek.calls[1].week).toBeNull();
  });

  it('recusa quem não é admin e a concessão sem boards:read ou tasks:read, sem tocar na leitura', async () => {
    const adminWeek = leitor();
    const naoAdmin = await getAdminWeek({ grant: adminGrant, person: funcionario, adminWeek, now: agora }, {});
    expect(naoAdmin).toMatchObject({ ok: false, code: 'permission_denied' });
    for (const faltando of ['boards:read', 'tasks:read'] as const) {
      const grant = { ...adminGrant, capabilities: adminGrant.capabilities.filter((c) => c !== faltando) };
      const r = await getAdminWeek({ grant, person, adminWeek, now: agora }, {});
      expect(r).toMatchObject({ ok: false, code: 'permission_denied' });
    }
    expect(adminWeek.calls).toHaveLength(0);
  });

  it('sem leitura ligada responde unavailable; semana inválida da função vira invalid_input', async () => {
    const semLeitura = await getAdminWeek({ grant: adminGrant, person, now: agora }, {});
    expect(semLeitura).toMatchObject({ ok: false, code: 'unavailable' });
    const { BoardRefused } = await import('@/server/board');
    const torta = new MemoryAdminWeekCatalog(async () => {
      throw new BoardRefused('Semana inválida.', 400);
    });
    const r = await getAdminWeek({ grant: adminGrant, person, adminWeek: torta, now: agora }, { week: '2026-10-07' });
    expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
  });

  /**
   * Auditoria de 08/10/2026 — a leitura ignorava o recorte da conexão (o
   * comentário dizia que o RLS cortava pela concessão; não corta: as
   * políticas de linha são as do DONO) e devolvia nomes de cliente e de
   * pessoa sem `clients:read`/`people:read`.
   */
  it('passa à leitura o recorte da CONEXÃO: empresas e clientes que ela alcança', async () => {
    const adminWeek = leitor();
    const recortada = { ...adminGrant, allowedClientIds: ['cliente-a'] };
    await getAdminWeek({ grant: recortada, person, adminWeek, now: agora }, {});
    expect(adminWeek.calls[0].scope).toEqual({ companyIds: ['empresa-a'], clientIds: ['cliente-a'] });
    // Pessoa que não alcança todos os clientes: só os dela, mesmo sem recorte de cliente na conexão.
    await getAdminWeek({ grant: adminGrant, person: { ...person, hasAllClientsAccess: false }, adminWeek, now: agora }, {});
    expect(adminWeek.calls[1].scope).toEqual({ companyIds: ['empresa-a'], clientIds: ['cliente-a'] });
    // Topo, conexão sem recorte: nada a cortar (nulo nos dois eixos).
    const topo = { ...person, isSuper: true };
    await getAdminWeek({ grant: { ...adminGrant, allowedCompanyIds: null }, person: topo, adminWeek, now: agora }, {});
    expect(adminWeek.calls[2].scope).toEqual({ companyIds: null, clientIds: null });
  });

  it('sem clients:read o nome do cliente vem nulo; sem people:read, quem lançou e os responsáveis não vêm', async () => {
    const comResponsavel: ControleDaSemana = {
      ...SEMANA,
      missing: {
        ...SEMANA.missing,
        overdue: SEMANA.missing.overdue.map((c) => ({ ...c, assignees: [{ id: HELENA, name: 'Helena' }] })),
      },
    };
    const adminWeek = new MemoryAdminWeekCatalog(async () => comResponsavel);
    const semRelacoes = {
      ...adminGrant,
      capabilities: adminGrant.capabilities.filter((c) => c !== 'clients:read' && c !== 'people:read'),
    };
    const r = await getAdminWeek({ grant: semRelacoes, person, adminWeek, now: agora }, {});
    if (!r.ok) throw new Error(r.message);
    const body = getAdminWeekResponseSchema.parse(r.body);
    // "Clinimax" continua no nome da LISTA (boards:read); o do cliente sai.
    expect(JSON.stringify(body)).not.toContain('Helena');
    expect(body.toAssign.every((g) => g.clientName === null && g.cards.every((c) => c.createdBy === null))).toBe(true);
    expect(body.progress.every((l) => l.clientName === null)).toBe(true);
    expect(body.missing.items.every((l) => l.clientName === null)).toBe(true);
    expect(body.missing.overdue.every((c) => c.clientName === null && c.assignees.length === 0)).toBe(true);
    // Os ids continuam: são o que liga a linha ao cliente e ao card.
    expect(body.toAssign[0].clientId).toBe('cliente-a');
  });

  it('a entrada é estrita e a data tem de existir', () => {
    expect(getAdminWeekInputSchema.safeParse({}).success).toBe(true);
    expect(getAdminWeekInputSchema.safeParse({ week: '2026-10-07' }).success).toBe(true);
    expect(getAdminWeekInputSchema.safeParse({ week: '2026-02-30' }).success).toBe(false);
    expect(getAdminWeekInputSchema.safeParse({ week: '2026-10-07', extra: 1 }).success).toBe(false);
  });
});

/* ───────────────────────── MCP, HTTP e contrato ───────────────────────── */

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

const CATALOG = new MemoryCatalog([{ id: 'empresa-a', name: 'Agência Ide' }], new Map([[OWNER_ID, 'Wesley Lourenço']]));

function adapters(grant: IntegrationGrant = adminGrant, who: PersonAccess = person) {
  const { store, tasks, comments } = setup(grant, who);
  const adminWeek = leitor();
  return {
    store,
    tasks,
    adminWeek,
    shared: {
      grant,
      person: who,
      catalog: CATALOG,
      work: new MemoryWorkCatalog(),
      delivery: new MemoryDeliveryCatalog(),
      marketing: new MemoryMarketingCatalog(),
      writes: store,
      comments,
      tasks,
      adminWeek,
      displayNameFallback: 'Wesley Lourenço',
      now: agora,
    },
  };
}

type ToolResult = { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };

async function callTool(shared: ReturnType<typeof adapters>['shared'], name: string, args: unknown) {
  const response = await handleMcpRequest({ ...shared, origin: 'mcp', request: mcpPost('tools/call', { name, arguments: args }) });
  expect(response.status).toBe(200);
  return ((await response.json()) as { result: ToolResult }).result;
}

describe('pelo MCP', () => {
  it('lista as duas ferramentas: a leitura como leitura e a liberação como escrita, com descrição clara', async () => {
    const { shared } = adapters();
    const listed = await handleMcpRequest({ ...shared, origin: 'mcp', request: mcpPost('tools/list', {}, 2) });
    const tools = ((await listed.json()) as { result: { tools: Array<Record<string, unknown>> } }).result.tools;
    const leitura = tools.find((t) => t.name === 'get_admin_week')!;
    const escrita = tools.find((t) => t.name === 'release_task')!;
    expect((leitura.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(true);
    expect((escrita.annotations as { readOnlyHint?: boolean }).readOnlyHint).toBe(false);
    expect(String(leitura.description)).toMatch(/o que falta nesta semana/);
    expect(String(escrita.description)).toMatch(/tasks:assign, tasks:write e tasks:move/);
    expect(String(escrita.description)).toMatch(/get_admin_week/);
  });

  it('get_admin_week responde com o mesmo conteúdo da função, e release_task libera e passa pelo registro', async () => {
    const { shared, tasks, store } = adapters();
    const semana = await callTool(shared, 'get_admin_week', { week: '2026-10-05' });
    expect(semana.isError).toBeFalsy();
    expect(getAdminWeekResponseSchema.parse(semana.structuredContent).missing.items[0].missing).toBe(1);
    expect(semana.content[0].text).toMatch(/controle da semana 2026-10-05–2026-10-11 · 1 card\(s\) para atribuir/);
    expect(semana.content[0].text).toContain('Clinimax video −1');

    const liberado = await callTool(shared, 'release_task', liberar(T_VIDEO));
    expect(liberado.isError).toBeFalsy();
    expect(releaseTaskResponseSchema.parse(liberado.structuredContent)).toMatchObject({ statusName: 'A fazer Vídeo' });
    expect(liberado.content[0].text).toMatch(/demanda liberada .* etapa A fazer Vídeo · prazo 2026-10-09 · 1 responsável/);
    expect(tasks.tasks.get(T_VIDEO)?.statusId).toBe(S_AFAZER_VIDEO);
    expect(rows(store)).toHaveLength(1);
  });

  it('sem concessão de admin as duas devolvem permission_denied (isError)', async () => {
    const { shared, tasks, adminWeek } = adapters(adminGrant, funcionario);
    const leitura = await callTool(shared, 'get_admin_week', {});
    expect(leitura.isError).toBe(true);
    expect(JSON.parse(leitura.content[0].text)).toMatchObject({ error: 'permission_denied' });
    const escrita = await callTool(shared, 'release_task', liberar(T_VIDEO));
    expect(escrita.isError).toBe(true);
    expect(JSON.parse(escrita.content[0].text)).toMatchObject({ error: 'permission_denied' });
    expect(tasks.mutations).toBe(0);
    expect(adminWeek.calls).toHaveLength(0);

    const semMover = adapters({ ...adminGrant, capabilities: adminGrant.capabilities.filter((c) => c !== 'tasks:move') });
    const recusada = await callTool(semMover.shared, 'release_task', liberar(T_VIDEO));
    expect(JSON.parse(recusada.content[0].text)).toMatchObject({ error: 'permission_denied' });
  });

  it('as recusas chegam com o código e, no type_required, com as quatro opções', async () => {
    const { shared } = adapters();
    const semTipo = await callTool(shared, 'release_task', liberar(T_SEM_TIPO));
    expect(semTipo.isError).toBe(true);
    const corpo = JSON.parse(semTipo.content[0].text) as { error: string; options: unknown[]; taskId: string };
    expect(corpo).toMatchObject({ error: 'type_required', taskId: T_SEM_TIPO });
    expect(corpo.options).toHaveLength(4);
    const ja = await callTool(shared, 'release_task', liberar(T_JA_LIBERADO));
    expect(JSON.parse(ja.content[0].text)).toMatchObject({ error: 'already_released' });
    const falta = await callTool(shared, 'release_task', liberar(T_SEM_ARTE));
    expect(JSON.parse(falta.content[0].text)).toMatchObject({ error: 'stage_missing' });
  });
});

describe('pelo HTTP', () => {
  const post = (path: string, body: unknown, key?: string) =>
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });

  it('GET /get_admin_week lê, e POST /release_task libera com a chave no cabeçalho', async () => {
    const { shared, tasks } = adapters();
    const lida = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: new Request(`${ORIGIN}${GET_ADMIN_WEEK_PATH}?week=2026-10-05`),
    });
    expect(lida.status).toBe(200);
    expect(getAdminWeekResponseSchema.parse(await lida.json()).week.start).toBe('2026-10-05');
    expect(shared.adminWeek.calls[0].week).toBe('2026-10-05');

    const semChave: Record<string, unknown> = liberar(T_ARTE);
    delete semChave.idempotencyKey;
    const feita = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: post(RELEASE_TASK_PATH, semChave, 'h-1'),
    });
    expect(feita.status).toBe(200);
    expect(releaseTaskResponseSchema.parse(await feita.json()).statusName).toBe('a fazer arte');
    expect(tasks.tasks.get(T_ARTE)?.statusId).toBe(S_AFAZER_ARTE);

    const repetida = await dispatchIntegrationHttp({
      ...shared,
      origin: 'http',
      request: post(RELEASE_TASK_PATH, liberar(T_ARTE), 'h-2'),
    });
    expect(repetida.status).toBe(409);
    expect(await repetida.json()).toMatchObject({ error: 'already_released' });
  });

  it('sem admin: 403 nas duas rotas', async () => {
    const { shared } = adapters(adminGrant, funcionario);
    const lida = await dispatchIntegrationHttp({ ...shared, origin: 'http', request: new Request(`${ORIGIN}${GET_ADMIN_WEEK_PATH}`) });
    expect(lida.status).toBe(403);
    const feita = await dispatchIntegrationHttp({ ...shared, origin: 'http', request: post(RELEASE_TASK_PATH, liberar(T_VIDEO)) });
    expect(feita.status).toBe(403);
  });
});

describe('contrato OpenAPI', () => {
  it('publica as duas rotas com schemas iguais ao Zod e exemplos válidos', () => {
    const doc = integrationOpenApi() as {
      paths: Record<string, { get?: { operationId?: string }; post?: { operationId?: string } }>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.paths['/get_admin_week'].get?.operationId).toBe('get_admin_week');
    expect(doc.paths['/release_task'].post?.operationId).toBe('release_task');
    expect(doc.paths['/release_task'].get).toBeUndefined();
    const { schemas } = doc.components;
    expect(schemas.GetAdminWeekInput).toEqual(jsonSchemaFromZod(getAdminWeekInputSchema));
    expect(schemas.ReleaseTaskInput).toEqual(jsonSchemaFromZod(releaseTaskInputSchema));
    expect(schemas.ReleaseTaskResponse).toEqual(jsonSchemaFromZod(releaseTaskResponseSchema));
    expect(getAdminWeekResponseSchema.parse(getAdminWeekOpenApiExample()).operation).toBe('get_admin_week');
    expect(releaseTaskResponseSchema.parse(releaseTaskOpenApiExample()).operation).toBe('release_task');
  });

  it('a entrada da liberação exige pessoa, prazo real e chave, e recusa autor e campo extra', () => {
    const base = liberar(T_VIDEO);
    expect(releaseTaskInputSchema.safeParse(base).success).toBe(true);
    expect(releaseTaskInputSchema.safeParse({ ...base, assigneeIds: [] }).success).toBe(false);
    expect(releaseTaskInputSchema.safeParse({ ...base, dueOn: '2026-02-30' }).success).toBe(false);
    expect(releaseTaskInputSchema.safeParse({ ...base, createdBy: HELENA }).success).toBe(false);
    const semChave: Record<string, unknown> = { ...base };
    delete semChave.idempotencyKey;
    expect(releaseTaskInputSchema.safeParse(semChave).success).toBe(false);
  });
});
