/**
 * O AGENTE DE IA SEM A EMPRESA OMITIDA — F31, Fase 3b: contexto, escritas,
 * consentimento e Conexões.
 *
 * As LEITURAS SQL contra Postgres estão em `omitidas-banco.test.ts`. Aqui, com
 * os ports de memória da suíte (F0.4, sem rede):
 *   · `get_context` não lista a empresa omitida, e o contrato não muda de forma;
 *   · toda escrita com ALVO omitido responde "não encontrado", com a frase que
 *     a escrita já dá para um id que não existe — nunca "fora da concessão",
 *     que contaria que a coisa existe;
 *   · a página de consentimento mostra o NOME da empresa e não oferece a
 *     omitida; Conexões conta só o que o agente alcança.
 *
 * O PONTO QUE ESTES TESTES SEGURAM NAS ESCRITAS
 *   `runAgentWrite` RELÊ a pessoa dentro da transação (`loadGrant`), e essa
 *   releitura não conhece a variável do Worker. Por isso o store abaixo é
 *   semeado com a pessoa SEM omissão, e só `ctx.person` a tem — como em
 *   produção. Se a escrita confiasse só na releitura, a omissão sumiria.
 */

import { describe, expect, it } from 'vitest';

import { getContext } from '@/integrations/context';
import { MemoryAgentWriteStore } from '@/integrations/executions';
import {
  READ_CAPABILITIES,
  companyAllowed,
  effectiveCompanies,
  omittedIn,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import {
  CONNECTIONS_PATH,
  MemoryGrantStore,
  PROOF_REDIRECT_URI,
  PROOF_SCOPE,
  createIntegrationHandler,
  mcpAudience,
} from '@/integrations/handler';
import { MemoryMarketingCatalog, type MarketingAssetRow } from '@/integrations/marketing';
import { toWorkScope } from '@/integrations/reads';
import {
  MemoryClientRecordBoard,
  MemoryCommentBoard,
  MemoryMoveBoard,
  MemoryTaskBoard,
  addCommentWork,
  addHistoryEntryWork,
  addMuralNoteWork,
  assignTaskWork,
  createTaskWork,
  moveTaskWork,
  previewMoveWork,
  updateMuralNoteWork,
  updateTaskWork,
  type WriteCtx,
} from '@/integrations/writes';
import { SESSION_COOKIE } from '@/server/session';
import type { AuthenticatedActor } from '@/server/session';

const agora = new Date('2026-09-25T15:00:00.000Z');

const IDE = 'aaaaaaa1-0000-4000-8000-000000000001';
const ALMA = 'aaaaaaa3-0000-4000-8000-000000000003';
const OWNER = '11111111-1111-4111-8111-111111111111';
const GRANT_ID = '22222222-2222-4222-8222-222222222222';
const C_IDE = 'cccccc10-0000-4000-8000-000000000010';
const C_ALMA = 'cccccc11-0000-4000-8000-000000000011';
const L_IDE = 'dddddd40-0000-4000-8000-000000000040';
const L_ALMA = 'dddddd41-0000-4000-8000-000000000041';
const L_IDE_2 = 'dddddd43-0000-4000-8000-000000000043';
const T_IDE = 'eeeeee50-0000-4000-8000-000000000050';
const T_ALMA = 'eeeeee51-0000-4000-8000-000000000051';
const N_ALMA = 'ffffff70-0000-4000-8000-000000000070';
const P_ALMA = '99999961-0000-4000-8000-000000000061';
const ST_ABERTA = '77777771-0000-4000-8000-000000000071';
const ST_FECHADA = '77777772-0000-4000-8000-000000000072';

/** O dono é super admin, alcança as duas empresas; a concessão não recorta. */
const semOmissao: PersonAccess = {
  userId: OWNER,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [IDE, ALMA],
  clientIds: [],
  hasAllClientsAccess: true,
};
const comOmissao: PersonAccess = { ...semOmissao, omittedCompanyIds: [ALMA] };

const grant: IntegrationGrant = {
  id: GRANT_ID,
  ownerId: OWNER,
  oauthClientId: 'cliente-oauth',
  name: 'Claude',
  capabilities: [
    ...READ_CAPABILITIES,
    'comments:write',
    'tasks:move',
    'tasks:write',
    'tasks:assign',
    'tasks:complete',
    'clients:mural:write',
    'clients:history:write',
  ],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

/* ───────────────────────────── o recorte ───────────────────────────── */

describe('F31.3b — effectiveCompanies com omitida', () => {
  it('sem omitida: exatamente o recorte de antes (nem o campo `omitted` existe)', () => {
    expect(effectiveCompanies(semOmissao, grant)).toEqual({ kind: 'all' });
    expect(effectiveCompanies({ ...semOmissao, isSuper: false }, grant)).toEqual({
      kind: 'ids',
      ids: new Set([IDE, ALMA]),
    });
  });

  it('super admin, concessão sem recorte: "todas menos a omitida"', () => {
    const r = effectiveCompanies(comOmissao, grant);
    expect(r.kind).toBe('all');
    expect(omittedIn(r)).toEqual([ALMA]);
    expect(companyAllowed(r, IDE)).toBe(true);
    expect(companyAllowed(r, ALMA)).toBe(false);
  });

  it('quem não é super: a omitida sai da lista da pessoa', () => {
    const r = effectiveCompanies({ ...comOmissao, isSuper: false }, grant);
    expect(r.kind === 'ids' && [...r.ids]).toEqual([IDE]);
  });

  it('concessão guardada com a omitida continua VÁLIDA: a omitida só some', () => {
    const r = effectiveCompanies(comOmissao, { ...grant, allowedCompanyIds: [IDE, ALMA] });
    expect(r.kind === 'ids' && [...r.ids]).toEqual([IDE]);
    // Concessão só da omitida: não alcança nada visível — o `none` de sempre.
    expect(effectiveCompanies(comOmissao, { ...grant, allowedCompanyIds: [ALMA] })).toEqual({ kind: 'none' });
    // Desligada, a mesma concessão volta a alcançar a Alma9.
    const volta = effectiveCompanies(semOmissao, { ...grant, allowedCompanyIds: [ALMA] });
    expect(volta.kind === 'ids' && [...volta.ids]).toEqual([ALMA]);
  });
});

describe('F31.3b — get_context', () => {
  const catalogo = [
    { id: IDE, name: 'Ide' },
    { id: ALMA, name: 'Alma9' },
  ];
  const contexto = (person: PersonAccess, g: IntegrationGrant = grant) =>
    getContext({ grant: g, person, origin: 'mcp', companies: catalogo, displayName: 'Wesley', now: agora });

  it('ligada: a empresa omitida não é listada, e `companyScope` continua `all`', () => {
    const r = contexto(comOmissao);
    expect(r.effectiveScope.companyScope).toBe('all');
    expect(r.effectiveScope.companies).toEqual([{ id: IDE, name: 'Ide' }]);
  });

  it('ligada, concessão que lista a omitida: `ids` só com a Ide', () => {
    const r = contexto(comOmissao, { ...grant, allowedCompanyIds: [IDE, ALMA] });
    expect(r.effectiveScope.companyScope).toBe('ids');
    expect(r.effectiveScope.companies.map((c) => c.id)).toEqual([IDE]);
  });

  it('desligada: as duas, como sempre', () => {
    expect(contexto(semOmissao).effectiveScope.companies.map((c) => c.name)).toEqual(['Alma9', 'Ide']);
  });
});

describe('F31.3b — marketing em memória segue a regra da conta da Meta', () => {
  const conta = (id: string, companyId: string | null, clientCompanyId: string | null): MarketingAssetRow => ({
    id,
    kind: 'ad_account',
    displayName: id,
    externalId: id,
    clientId: clientCompanyId ? `cliente-${id}` : null,
    clientName: null,
    clientCompanyId,
    companyId,
    companyName: null,
    currency: null,
    lastSeenAt: null,
  });
  const catalogo = new MemoryMarketingCatalog({
    assets: [conta('ide', IDE, IDE), conta('alma', ALMA, null), conta('alma-cide', ALMA, IDE), conta('ide-calma', IDE, ALMA)],
  });
  const periodo = { from: '2026-09-01', to: '2026-09-30' };

  it('ligada: só a conta da Ide; desligada: as quatro', async () => {
    expect((await catalogo.load(toWorkScope(comOmissao, grant, agora), periodo)).assets.map((a) => a.id)).toEqual([
      'ide',
    ]);
    expect((await catalogo.load(toWorkScope(semOmissao, grant, agora), periodo)).assets).toHaveLength(4);
  });
});

/* ───────────────────────────── as escritas ───────────────────────────── */

function montar(person: PersonAccess) {
  const store = new MemoryAgentWriteStore();
  // A releitura da transação NÃO conhece a omissão — como `loadGrant` no SQL.
  store.seedPerson(semOmissao);
  store.seedGrant(grant);
  const tasks = new MemoryTaskBoard({
    lists: [
      { id: L_IDE, companyId: IDE, clientId: C_IDE, openStatusId: ST_ABERTA, closedStatusId: ST_FECHADA },
      { id: L_ALMA, companyId: ALMA, clientId: C_ALMA, openStatusId: ST_ABERTA, closedStatusId: ST_FECHADA },
    ],
    people: [
      { id: OWNER, companyIds: [IDE, ALMA] },
      { id: P_ALMA, companyIds: [ALMA] },
    ],
    tasks: [
      { taskId: T_IDE, listId: L_IDE, title: 'Da Ide' },
      { taskId: T_ALMA, listId: L_ALMA, title: 'Da Alma' },
    ],
  });
  const records = new MemoryClientRecordBoard(
    { ownerId: OWNER, viaName: 'Claude' },
    {
      clients: [
        { id: C_IDE, companyId: IDE },
        { id: C_ALMA, companyId: ALMA },
      ],
      notes: [{ noteId: N_ALMA, clientId: C_ALMA, createdBy: OWNER, viaName: 'Claude' }],
    },
  );
  const statuses = [
    { id: ST_ABERTA, name: 'A FAZER', type: 'open' as const, color: null },
    { id: ST_FECHADA, name: 'Concluída', type: 'closed' as const, color: null },
  ];
  const board = new MemoryMoveBoard({
    lists: [
      { id: L_IDE, name: 'Ide', companyId: IDE, clientId: C_IDE, statuses },
      { id: L_IDE_2, name: 'Ide 2', companyId: IDE, clientId: C_IDE, statuses },
      { id: L_ALMA, name: 'Alma', companyId: ALMA, clientId: C_ALMA, statuses },
    ],
    tasks: [
      { id: T_IDE, title: 'Da Ide', listId: L_IDE, statusId: ST_ABERTA, parentId: null, clientId: C_IDE, companyId: IDE, completedAt: null },
      { id: T_ALMA, title: 'Da Alma', listId: L_ALMA, statusId: ST_ABERTA, parentId: null, clientId: C_ALMA, companyId: ALMA, completedAt: null },
    ],
  });
  const comments = new MemoryCommentBoard(OWNER, {
    taskCompanies: new Map([
      [T_IDE, IDE],
      [T_ALMA, ALMA],
    ]),
  });
  const ctx: WriteCtx = {
    grant,
    person,
    origin: 'mcp',
    store,
    comments,
    board,
    tasks,
    clientRecords: records,
    now: agora,
  };
  return { ctx, tasks, records, board, comments, store };
}

const TAREFA_SUMIDA = { ok: false, code: 'not_found', message: 'Tarefa não encontrada, ou fora do seu alcance.' };
const LISTA_SUMIDA = { ok: false, code: 'not_found', message: 'Lista não encontrada, ou fora do seu alcance.' };
const CLIENTE_SUMIDO = { ok: false, code: 'not_found', message: 'Cliente não encontrado, ou fora do seu alcance.' };
const NOTA_SUMIDA = { ok: false, code: 'not_found', message: 'Nota não encontrada, ou fora do seu alcance.' };

describe('F31.3b — escrita com alvo omitido é "não encontrado"', () => {
  it('editar, atribuir e concluir tarefa da Alma9', async () => {
    const { ctx, tasks, store } = montar(comOmissao);
    expect(await updateTaskWork(ctx, { taskId: T_ALMA, title: 'x', idempotencyKey: 'u1' })).toEqual(TAREFA_SUMIDA);
    expect(await assignTaskWork(ctx, { taskId: T_ALMA, assigneeIds: [], idempotencyKey: 'a1' })).toEqual(TAREFA_SUMIDA);
    expect(tasks.mutations).toBe(0);
    expect(store.executions.size).toBe(0);
  });

  it('criar tarefa em lista da Alma9', async () => {
    const { ctx, tasks } = montar(comOmissao);
    expect(await createTaskWork(ctx, { listId: L_ALMA, title: 'Nova', idempotencyKey: 'c1' })).toEqual(LISTA_SUMIDA);
    expect(tasks.mutations).toBe(0);
  });

  it('nota e histórico no cliente da Alma9; editar a nota dele', async () => {
    const { ctx, records } = montar(comOmissao);
    expect(await addMuralNoteWork(ctx, { clientId: C_ALMA, content: 'x', idempotencyKey: 'n1' })).toEqual(CLIENTE_SUMIDO);
    expect(
      await addHistoryEntryWork(ctx, { clientId: C_ALMA, happenedOn: '2026-09-25', title: 'x', body: 'y', idempotencyKey: 'h1' }),
    ).toEqual(CLIENTE_SUMIDO);
    expect(await updateMuralNoteWork(ctx, { noteId: N_ALMA, content: 'z', idempotencyKey: 'n2' })).toEqual(NOTA_SUMIDA);
    expect(records.mutations).toBe(0);
  });

  it('mover: tarefa da Alma9, ou para lista da Alma9 — na prévia e no movimento', async () => {
    const { ctx, board } = montar(comOmissao);
    const daAlma = { taskId: T_ALMA, listId: L_IDE_2, from: { listId: L_ALMA, statusId: ST_ABERTA } };
    const paraAlma = { taskId: T_IDE, listId: L_ALMA, from: { listId: L_IDE, statusId: ST_ABERTA } };
    // No movimento, a omitida responde IGUAL à que não existe — nem o código
    // de erro pode distinguir as duas.
    const FANTASMA = 'eeeeee99-0000-4000-8000-000000000099';
    const LISTA_FANTASMA = 'dddddd99-0000-4000-8000-000000000099';
    const tarefaQueNaoExiste = await previewMoveWork(ctx, { ...daAlma, taskId: FANTASMA });
    const destinoQueNaoExiste = await previewMoveWork(ctx, { ...paraAlma, listId: LISTA_FANTASMA });
    expect(tarefaQueNaoExiste).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(destinoQueNaoExiste).toMatchObject({ ok: false, code: 'permission_denied' });
    expect(await previewMoveWork(ctx, daAlma)).toEqual(tarefaQueNaoExiste);
    expect(await moveTaskWork(ctx, { ...daAlma, idempotencyKey: 'm1' })).toEqual(tarefaQueNaoExiste);
    expect(await previewMoveWork(ctx, paraAlma)).toEqual(destinoQueNaoExiste);
    expect(await moveTaskWork(ctx, { ...paraAlma, idempotencyKey: 'm2' })).toEqual(destinoQueNaoExiste);
    // A origem desatualizada NÃO devolve a etapa atual da tarefa omitida.
    const velha = await moveTaskWork(ctx, { ...daAlma, from: { listId: L_IDE, statusId: null }, idempotencyKey: 'm3' });
    expect(velha).toEqual(tarefaQueNaoExiste);
    expect(board.mutations).toBe(0);
  });

  it('comentar em tarefa da Alma9', async () => {
    const { ctx, comments } = montar(comOmissao);
    expect(await addCommentWork(ctx, { taskId: T_ALMA, body: 'oi', idempotencyKey: 'k1' })).toEqual(TAREFA_SUMIDA);
    expect(comments.mutations).toBe(0);
    // Na da Ide, comenta normalmente.
    expect((await addCommentWork(ctx, { taskId: T_IDE, body: 'oi', idempotencyKey: 'k2' })).ok).toBe(true);
  });

  it('responsável que é SÓ da Alma9 não entra — como não aparece em list_people', async () => {
    const { ctx } = montar(comOmissao);
    const r = await assignTaskWork(ctx, { taskId: T_IDE, assigneeIds: [P_ALMA], idempotencyKey: 'a2' });
    expect(r).toMatchObject({ ok: false, code: 'permission_denied' });
  });

  it('na Ide, com a variável ligada, tudo segue', async () => {
    const { ctx } = montar(comOmissao);
    expect((await updateTaskWork(ctx, { taskId: T_IDE, title: 'Novo', idempotencyKey: 'u2' })).ok).toBe(true);
    expect((await createTaskWork(ctx, { listId: L_IDE, title: 'Nova', idempotencyKey: 'c2' })).ok).toBe(true);
    expect((await addMuralNoteWork(ctx, { clientId: C_IDE, content: 'x', idempotencyKey: 'n3' })).ok).toBe(true);
  });

  it('desligada: a Alma9 é empresa como as outras', async () => {
    const { ctx } = montar(semOmissao);
    expect((await updateTaskWork(ctx, { taskId: T_ALMA, title: 'x', idempotencyKey: 'u3' })).ok).toBe(true);
    expect((await createTaskWork(ctx, { listId: L_ALMA, title: 'Nova', idempotencyKey: 'c3' })).ok).toBe(true);
    expect((await addMuralNoteWork(ctx, { clientId: C_ALMA, content: 'x', idempotencyKey: 'n4' })).ok).toBe(true);
    expect((await addCommentWork(ctx, { taskId: T_ALMA, body: 'oi', idempotencyKey: 'k3' })).ok).toBe(true);
    expect((await assignTaskWork(ctx, { taskId: T_ALMA, assigneeIds: [P_ALMA], idempotencyKey: 'a3' })).ok).toBe(true);
  });
});

/* ───────────────────────────── consentimento e Conexões ───────────────────────────── */

const ORIGIN = 'https://ideworks.test';

const HUMANO: AuthenticatedActor = {
  userId: OWNER,
  email: 'wesley@example.invalid',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
  areas: [],
  hasAllClientsAccess: true,
};

async function servidor(pessoa: PersonAccess, ator: AuthenticatedActor = HUMANO) {
  const store = new MemoryGrantStore();
  store.seedPerson(pessoa);
  const server = await createIntegrationHandler({
    grants: store,
    resolveSession: async (request) =>
      (request.headers.get('Cookie') ?? '').includes(`${SESSION_COOKIE}=ok`)
        ? { ok: true, actor: ator }
        : { ok: false, status: 401, reason: 'no_token', message: 'Faltou o crachá.' },
  });
  return { server, store };
}

async function consentimento(pessoa: PersonAccess, accept: 'text/html' | 'application/json') {
  const { server } = await servidor(pessoa);
  const url = new URL('/oauth/authorize', ORIGIN);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', server.clientId);
  url.searchParams.set('redirect_uri', PROOF_REDIRECT_URI);
  url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', 's');
  url.searchParams.set('scope', PROOF_SCOPE);
  url.searchParams.set('resource', mcpAudience(ORIGIN));
  const r = await server.fetch(
    new Request(url.toString(), { headers: { Cookie: `${SESSION_COOKIE}=ok`, Accept: accept } }),
  );
  expect(r.status).toBe(200);
  return r;
}

const comNomes = (p: PersonAccess): PersonAccess => ({ ...p, companyNames: { [IDE]: 'Ide', [ALMA]: 'Alma9' } });

describe('F31.3b — a página de consentimento', () => {
  it('ligada: a caixinha diz "Ide" (o valor segue o id), e a Alma9 não é oferecida', async () => {
    const pagina = await (await consentimento(comNomes(comOmissao), 'text/html')).text();
    expect(pagina).toContain(`<input type="checkbox" name="company" value="${IDE}"> Ide</label>`);
    expect(pagina).not.toContain(ALMA);
    expect(pagina).not.toContain('Alma9');
  });

  it('ligada, JSON: o mesmo formato (lista de ids), sem a omitida, com os nomes ao lado', async () => {
    const corpo = (await (await consentimento(comNomes(comOmissao), 'application/json')).json()) as {
      reach: { companies: string[] };
      companyNames: Record<string, string>;
    };
    expect(corpo.reach.companies).toEqual([IDE]);
    expect(corpo.companyNames).toEqual({ [IDE]: 'Ide' });
  });

  it('desligada: as duas empresas, cada uma pelo nome', async () => {
    const pagina = await (await consentimento(comNomes(semOmissao), 'text/html')).text();
    expect(pagina).toContain('> Ide</label>');
    expect(pagina).toContain('> Alma9</label>');
  });

  it('sem nome conhecido, cai no id — como antes', async () => {
    const pagina = await (await consentimento(semOmissao, 'text/html')).text();
    expect(pagina).toContain(`value="${IDE}"> ${IDE}</label>`);
  });
});

describe('F31.3b — Conexões conta só o que o agente alcança', () => {
  async function listar(ator: AuthenticatedActor) {
    const { server, store } = await servidor(semOmissao, ator);
    store.grants.set(GRANT_ID, { ...grant, allowedCompanyIds: [IDE, ALMA] });
    const r = await server.fetch(
      new Request(new URL(CONNECTIONS_PATH, ORIGIN), { headers: { Cookie: `${SESSION_COOKIE}=ok` } }),
    );
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { connections: Array<{ reach: { companies: string[] | null } }> };
    return corpo.connections[0].reach.companies;
  }

  it('ligada: "1 empresa(s)" — a concessão guardada continua com as duas', async () => {
    expect(await listar({ ...HUMANO, categoriasOmitidas: [ALMA] })).toEqual([IDE]);
  });

  it('desligada: as duas', async () => {
    expect(await listar(HUMANO)).toEqual([IDE, ALMA]);
  });
});
