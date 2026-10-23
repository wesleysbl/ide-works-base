/**
 * `get_planning_weeks` — F37, Fase 4.
 *
 * A leitura NÃO tem conta própria: a divisão em semanas, a meta e o estado vêm
 * de `src/painel/planejamento-semanal.ts` (a regra da aba Semana do site). Os
 * testes provam três coisas: o recorte da concessão (cliente fora do recorte e
 * empresa omitida nunca aparecem), os números iguais aos da regra da tela para
 * o mesmo mês, e as três superfícies (função, HTTP, MCP) dizendo o mesmo.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { semanasDoMes } from '@/delivery/semanas';
import {
  GET_PLANNING_WEEKS_PATH,
  getPlanningWeeksInputSchema,
  getPlanningWeeksOpenApiExample,
  getPlanningWeeksResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { measureJsonBytes, RESPONSE_BUDGET_BYTES } from '@/integrations/page';
import { EMPTY_WORK_CATALOG } from '@/integrations/reads';
import {
  MemoryDeliveryCatalog,
  SqlDeliveryCatalog,
  getPlanningWeeks,
  type DeliveryCatalog,
  type MemoryDeliveryData,
  type MemoryDeliveryItem,
  type ReportCtx,
} from '@/integrations/reports';
import { dividirMeta, planejarSemanas, type PecaDoPlanejamento } from '@/painel/planejamento-semanal';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_ALMA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_REBROTA = 'cliente-rebrota';
const CLIENT_HUB = 'cliente-hub';
const CLIENT_B = 'cliente-filmes';
const CLIENT_ALMA = 'cliente-alma9';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const FOLDER_HELENA = '22222222-2222-4222-8222-222222222222';
const USER_ANA = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'https://ideworks.test';
/** Segunda-feira, 05/10/2026, 09h em São Paulo. */
const AGORA = new Date('2026-10-05T12:00:00.000Z');
const OUT = '2026-10-01';

const COMPANIES = [
  { id: COMPANY_A, name: 'Agência Ide' },
  { id: COMPANY_B, name: 'Ide Filmes' },
  { id: COMPANY_ALMA, name: 'Alma Nove' },
];

const SUPER: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [COMPANY_A, COMPANY_B, COMPANY_ALMA],
  clientIds: [CLIENT_A, CLIENT_REBROTA, CLIENT_HUB, CLIENT_B, CLIENT_ALMA],
  hasAllClientsAccess: true,
};
const SEM_ALMA: PersonAccess = { ...SUPER, omittedCompanyIds: [COMPANY_ALMA] };

function grant(partial: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: 'grant-planejamento',
    ownerId: OWNER_ID,
    oauthClientId: 'claude',
    name: 'Claude da agência',
    capabilities: ['reports:delivery:read'],
    allowedCompanyIds: null,
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
    ...partial,
  };
}

function peca(
  clientId: string,
  contentType: string,
  scheduledOn: string | null,
  completed: boolean,
  extra: Partial<MemoryDeliveryItem> = {},
): MemoryDeliveryItem {
  return {
    clientId,
    referenceMonth: OUT,
    contentType,
    isExtra: false,
    isCompleted: completed,
    scheduledOn,
    ...extra,
  };
}

/**
 * Jatobá: mês aberto, vídeo 8 e arte 4; um vídeo feito (02/10), um atrasado
 * (03/10), um agendado (08/10), um sem dia; uma arte agendada (12/10); pasta
 * TIME HELENA. Rebrota: mês NÃO aberto, cota do cadastro (arte 3), carteira da
 * Ana. HUB: aberto, sem cota e sem peça. Filmes: outra empresa. Alma Nove:
 * empresa omitida.
 */
const ITEMS: MemoryDeliveryItem[] = [
  peca(CLIENT_A, 'video', '2026-10-02', true, { id: 'v-feito', title: 'Reels de abertura' }),
  peca(CLIENT_A, 'video', '2026-10-03', false, { id: 'v-atrasado' }),
  peca(CLIENT_A, 'video', '2026-10-08', false, { id: 'v-agendado' }),
  peca(CLIENT_A, 'video', null, false, { id: 'v-sem-dia' }),
  peca(CLIENT_A, 'arte', '2026-10-12', false, { id: 'a-agendada' }),
  peca(CLIENT_B, 'foto', '2026-10-14', true, { id: 'f-feita' }),
  peca(CLIENT_ALMA, 'video', '2026-10-06', true, { id: 'alma-v' }),
];

const DATA: MemoryDeliveryData = {
  clients: [
    { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_REBROTA, name: 'Rebrota', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_HUB, name: 'Cliente HUB', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes' },
    { id: CLIENT_ALMA, name: 'Cliente Alma', companyId: COMPANY_ALMA, companyName: 'Alma Nove' },
  ],
  contracts: [
    { clientId: CLIENT_A, referenceMonth: OUT, contentType: 'video', quantity: 8 },
    { clientId: CLIENT_A, referenceMonth: OUT, contentType: 'arte', quantity: 4 },
    { clientId: CLIENT_B, referenceMonth: OUT, contentType: 'foto', quantity: 2 },
    { clientId: CLIENT_ALMA, referenceMonth: OUT, contentType: 'video', quantity: 4 },
  ],
  items: ITEMS,
  opened: [
    { clientId: CLIENT_A, referenceMonth: OUT },
    { clientId: CLIENT_HUB, referenceMonth: OUT },
    { clientId: CLIENT_B, referenceMonth: OUT },
    { clientId: CLIENT_ALMA, referenceMonth: OUT },
  ],
  registry: [
    { clientId: CLIENT_REBROTA, contentType: 'arte', quantity: 3 },
    { clientId: CLIENT_A, contentType: 'video', quantity: 8 },
  ],
  folders: [{ clientId: CLIENT_A, folderId: FOLDER_HELENA, folderName: 'TIME HELENA' }],
  portfolio: [{ clientId: CLIENT_REBROTA, userId: USER_ANA, name: 'Ana' }],
};
const CATALOG = new MemoryDeliveryCatalog(DATA);

function ctxFor(
  g: IntegrationGrant = grant(),
  person: PersonAccess = SUPER,
  delivery: DeliveryCatalog = CATALOG,
): ReportCtx {
  return { grant: g, person, origin: 'http', companies: COMPANIES, displayName: 'Wesley Lourenço', delivery, now: AGORA };
}

async function ok(input: Parameters<typeof getPlanningWeeks>[1], ctx: ReportCtx = ctxFor()) {
  const result = await getPlanningWeeks(ctx, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.body;
}

describe('get_planning_weeks — a leitura', () => {
  it('mês com cota: semanas do mês, meta, entregue, atrasado e o que falta, por cliente e tipo', async () => {
    const body = await ok({ month: '2026-10' });
    expect(body.operation).toBe('get_planning_weeks');
    expect(body.month).toBe('2026-10');
    expect(body.today).toBe('2026-10-05');
    expect(body.weeks.map((w) => [w.number, w.from, w.to])).toEqual([
      [1, '2026-10-01', '2026-10-04'],
      [2, '2026-10-05', '2026-10-11'],
      [3, '2026-10-12', '2026-10-18'],
      [4, '2026-10-19', '2026-10-25'],
      [5, '2026-10-26', '2026-10-31'],
    ]);
    // HUB (aberto, sem cota e sem peça) fica de fora e é contado.
    expect(body.clients.map((c) => c.name)).toEqual(['Cliente Alma', 'Cliente Filmes', 'Jatobá', 'Rebrota']);
    expect(body.omittedWithoutQuota).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();

    const jatoba = body.clients.find((c) => c.id === CLIENT_A);
    expect(jatoba?.quotaSource).toBe('contrato');
    expect(jatoba?.noQuota).toBe(false);
    expect(jatoba?.owners).toEqual([{ id: FOLDER_HELENA, name: 'TIME HELENA', kind: 'folder' }]);
    const video = jatoba?.types.find((t) => t.type === 'video');
    expect(video).toMatchObject({ quota: 8, done: 1, missing: 7, withoutDay: 1, outsideMonth: 0 });
    expect(video?.weeks.map((w) => w.goal)).toEqual([0, 2, 2, 2, 2]);
    expect(video?.weeks.reduce((soma, w) => soma + w.goal, 0)).toBe(8);
    // Semana 1: o feito do dia 02 bateu uma meta 0; o do dia 03 está atrasado.
    expect(video?.weeks[0]).toEqual({ number: 1, goal: 0, done: 1, scheduled: 0, late: 1, missing: 0, state: 'bateu' });
    // Semana 2 (a corrente): o agendado do dia 08 não cobre a meta 2 → risco.
    expect(video?.weeks[1]).toEqual({ number: 2, goal: 2, done: 0, scheduled: 1, late: 0, missing: 2, state: 'risco' });
    expect(video?.weeks[2]?.state).toBe('futura');
    expect(jatoba?.atRisk).toBe(true);

    // Mês NÃO aberto usa a cota do cadastro, e diz isso.
    const rebrota = body.clients.find((c) => c.id === CLIENT_REBROTA);
    expect(rebrota?.quotaSource).toBe('cadastro');
    // Sem `people:read` o nome da pessoa da carteira é nulo (o id e o tipo ficam).
    expect(rebrota?.owners).toEqual([{ id: USER_ANA, name: null, kind: 'person' }]);
    expect(rebrota?.types).toHaveLength(1);
    expect(rebrota?.types[0]).toMatchObject({ type: 'arte', quota: 3, done: 0, missing: 3 });
  });

  it('groups: por responsável, "Sem responsável" fora do mapa; em risco primeiro', async () => {
    const body = await ok({ month: '2026-10' });
    const nomes = body.groups.map((g) => g.owner?.name ?? null);
    // A ordem é a dos nomes de verdade; o nome da PESSOA só sai com people:read.
    expect(body.groups.map((g) => g.owner?.id ?? null)).toEqual([USER_ANA, FOLDER_HELENA, null]);
    expect(nomes).toEqual([null, 'TIME HELENA', null]);
    expect(body.groups.find((g) => g.owner?.id === FOLDER_HELENA)).toMatchObject({
      clientIds: [CLIENT_A],
      atRisk: 1,
    });
    // Filmes e Alma não têm responsável.
    expect(body.groups.at(-1)?.owner).toBeNull();
    expect(new Set(body.groups.at(-1)?.clientIds)).toEqual(new Set([CLIENT_B, CLIENT_ALMA]));
  });

  it('people:read: o nome da pessoa da carteira volta (clients[].owners e groups[].owner), igual ao de get_month_attention', async () => {
    const comPessoas = ctxFor(grant({ capabilities: ['reports:delivery:read', 'people:read'] }));
    const body = await ok({ month: '2026-10' }, comPessoas);
    expect(body.clients.find((c) => c.id === CLIENT_REBROTA)?.owners).toEqual([{ id: USER_ANA, name: 'Ana', kind: 'person' }]);
    expect(body.groups.map((g) => g.owner?.name ?? null)).toEqual(['Ana', 'TIME HELENA', null]);
    const semPessoas = await ok({ month: '2026-10' });
    expect(JSON.stringify(semPessoas)).not.toContain('Ana');
  });

  it('filtro de responsável: só os clientes dele; responsável sem cliente é lista vazia', async () => {
    const helena = await ok({ month: '2026-10', ownerId: FOLDER_HELENA });
    expect(helena.clients.map((c) => c.id)).toEqual([CLIENT_A]);
    const ninguem = await ok({ month: '2026-10', ownerId: '99999999-9999-4999-8999-999999999999' });
    expect(ninguem.clients).toEqual([]);
  });

  it('cliente fora do recorte nunca aparece: concessão por cliente e por empresa', async () => {
    const soJatoba = await ok({ month: '2026-10' }, ctxFor(grant({ allowedClientIds: [CLIENT_A] })));
    expect(soJatoba.clients.map((c) => c.id)).toEqual([CLIENT_A]);
    expect(soJatoba.coverage.kind).toBe('partial');

    const soEmpresaA = await ok({ month: '2026-10' }, ctxFor(grant({ allowedCompanyIds: [COMPANY_A] })));
    expect(soEmpresaA.clients.map((c) => c.id)).toEqual([CLIENT_A, CLIENT_REBROTA]);
    expect(JSON.stringify(soEmpresaA)).not.toContain('Cliente Filmes');
    expect(JSON.stringify(soEmpresaA)).not.toContain('Cliente Alma');

    // Pedir pelo id um cliente de fora é a MESMA recusa de um id que não existe.
    const fora = await getPlanningWeeks(ctxFor(grant({ allowedClientIds: [CLIENT_A] })), {
      month: '2026-10',
      clientId: CLIENT_B,
    });
    const inexistente = await getPlanningWeeks(ctxFor(), { month: '2026-10', clientId: 'cliente-que-nao-existe' });
    expect(fora).toEqual({ ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' });
    expect(inexistente).toEqual(fora);
  });

  it('cliente da empresa omitida (Alma Nove) não aparece, nem pelo id', async () => {
    const body = await ok({ month: '2026-10' }, ctxFor(grant(), SEM_ALMA));
    expect(body.clients.map((c) => c.id)).not.toContain(CLIENT_ALMA);
    expect(JSON.stringify(body)).not.toContain('Alma');
    expect(body.groups.flatMap((g) => g.clientIds)).not.toContain(CLIENT_ALMA);

    const pelaId = await getPlanningWeeks(ctxFor(grant(), SEM_ALMA), { month: '2026-10', clientId: CLIENT_ALMA });
    expect(pelaId.ok).toBe(false);
    if (!pelaId.ok) expect(pelaId.code).toBe('permission_denied');
  });

  it('mês sem contrato nem peça: lista vazia, não erro; as semanas do mês continuam lá', async () => {
    const semCadastro = new MemoryDeliveryCatalog({
      clients: DATA.clients,
      contracts: DATA.contracts,
      items: DATA.items,
      opened: DATA.opened,
    });
    const body = await ok({ month: '2026-11' }, ctxFor(grant(), SUPER, semCadastro));
    expect(body.clients).toEqual([]);
    expect(body.groups).toEqual([]);
    expect(body.omittedWithoutQuota).toBe(5);
    expect(body.month).toBe('2026-11');
    expect(body.weeks.length).toBeGreaterThanOrEqual(4);
    expect(body.weeks[0]?.from).toBe('2026-11-01');
    // Catálogo vazio (sem Hyperdrive) é o mesmo: vazio, não erro.
    const vazio = await ok({ month: '2026-10' }, ctxFor(grant(), SUPER, new MemoryDeliveryCatalog()));
    expect(vazio.clients).toEqual([]);
  });

  it('sem month: o mês atual da agência', async () => {
    const body = await ok({});
    expect(body.month).toBe('2026-10');
    expect(body.self).toBe(`${GET_PLANNING_WEEKS_PATH}?month=2026-10`);
  });

  it('permission_denied sem reports:delivery:read, checado antes de qualquer outra coisa', async () => {
    const negado = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };
    const semCapacidade = grant({ capabilities: ['boards:read'] });
    expect(await getPlanningWeeks(ctxFor(semCapacidade), { month: '2026-10' })).toEqual(negado);
    // Mês e limite inválidos não vazam o que a validação pensa: a recusa é a de permissão.
    expect(await getPlanningWeeks(ctxFor(semCapacidade), { month: '2026-13', limit: 0 })).toEqual(negado);
  });

  it('entrada inválida: mês fora do formato, limite e cursor ruins são recusados antes de ler o banco', async () => {
    let lidas = 0;
    const espiao: DeliveryCatalog = {
      load: (scope, period) => CATALOG.load(scope, period),
      loadCalendar: (scope, period) => CATALOG.loadCalendar(scope, period),
      loadMonthly: (scope, period) => CATALOG.loadMonthly(scope, period),
      loadDeliveryStatus: (scope, now) => CATALOG.loadDeliveryStatus(scope, now),
      loadPlanning: (scope, month) => {
        lidas += 1;
        return CATALOG.loadPlanning(scope, month);
      },
    };
    const ctx = ctxFor(grant(), SUPER, espiao);
    const mes = await getPlanningWeeks(ctx, { month: '2026-13' });
    expect(mes.ok === false && mes.code).toBe('invalid_input');
    const limite = await getPlanningWeeks(ctx, { month: '2026-10', limit: 101 });
    expect(limite.ok === false && limite.code).toBe('limit_exceeded');
    const zero = await getPlanningWeeks(ctx, { month: '2026-10', limit: 0 });
    expect(zero.ok === false && zero.code).toBe('invalid_input');
    const cursor = await getPlanningWeeks(ctx, { month: '2026-10', cursor: 'lixo!' });
    expect(cursor.ok === false && cursor.code).toBe('invalid_cursor');
    expect(lidas).toBe(0);
  });

  it('com clientId: UMA leitura, estreitada ao cliente', async () => {
    const escopos: unknown[] = [];
    const espiao: DeliveryCatalog = {
      load: (scope, period) => CATALOG.load(scope, period),
      loadCalendar: (scope, period) => CATALOG.loadCalendar(scope, period),
      loadMonthly: (scope, period) => CATALOG.loadMonthly(scope, period),
      loadDeliveryStatus: (scope, now) => CATALOG.loadDeliveryStatus(scope, now),
      loadPlanning: (scope, month) => {
        escopos.push(scope.clients);
        return CATALOG.loadPlanning(scope, month);
      },
    };
    const body = await ok({ month: '2026-10', clientId: CLIENT_A }, ctxFor(grant(), SUPER, espiao));
    expect(body.clients.map((c) => c.id)).toEqual([CLIENT_A]);
    expect(escopos).toEqual([new Set([CLIENT_A])]);
    expect(body.self).toBe(`${GET_PLANNING_WEEKS_PATH}?month=2026-10&clientId=${CLIENT_A}`);
  });
});

describe('get_planning_weeks — os números são os da regra da tela', () => {
  it('semana a semana, meta, entregue e estado batem com planejarSemanas para o mesmo mês e as mesmas peças', async () => {
    const body = await ok({ month: '2026-10', clientId: CLIENT_A });
    const cliente = body.clients[0];
    expect(cliente).toBeDefined();

    // A mesma entrada que a tela entrega à regra: a cota do mês, as peças com
    // dia e conclusão (ISO) e o "hoje" da agência.
    const pecas: PecaDoPlanejamento[] = [
      { id: 'v-feito', contentType: 'video', scheduledAt: '2026-10-02T12:00:00.000Z', completedAt: '2026-10-02T12:00:00.000Z', isExtra: false, title: 'Reels de abertura' },
      { id: 'v-atrasado', contentType: 'video', scheduledAt: '2026-10-03T12:00:00.000Z', completedAt: null, isExtra: false, title: null },
      { id: 'v-agendado', contentType: 'video', scheduledAt: '2026-10-08T12:00:00.000Z', completedAt: null, isExtra: false, title: null },
      { id: 'v-sem-dia', contentType: 'video', scheduledAt: null, completedAt: null, isExtra: false, title: null },
      { id: 'a-agendada', contentType: 'arte', scheduledAt: '2026-10-12T12:00:00.000Z', completedAt: null, isExtra: false, title: null },
    ];
    const regra = planejarSemanas({ mes: '2026-10', cota: { video: 8, arte: 4 }, pecas, hoje: '2026-10-05' });

    expect(body.weeks).toEqual(
      regra.semanas.map((s) => ({ number: s.numero, from: s.de, to: s.ate, days: s.dias })),
    );
    expect(body.weeks).toEqual(
      semanasDoMes('2026-10').map((s) => ({ number: s.numero, from: s.de, to: s.ate, days: s.dias })),
    );
    expect(cliente?.types.map((t) => t.type)).toEqual(regra.tipos.map((t) => t.tipo));
    for (const linha of regra.tipos) {
      const lido = cliente?.types.find((t) => t.type === linha.tipo);
      expect(lido?.quota).toBe(linha.cota);
      expect(lido?.done).toBe(linha.mes.feito);
      expect(lido?.withoutDay).toBe(linha.mes.semDia);
      expect(lido?.weeks.map((w) => [w.goal, w.done, w.state])).toEqual(
        linha.celulas.map((c) => [c.meta, c.feito, c.estado]),
      );
    }
    // A meta é a divisão por dias úteis, soma = cota.
    expect(cliente?.types.find((t) => t.type === 'video')?.weeks.map((w) => w.goal)).toEqual(
      dividirMeta(8, semanasDoMes('2026-10')),
    );
    expect(cliente?.atRisk).toBe(regra.emRisco);
    expect(cliente?.below).toBe(regra.abaixo);
    expect(cliente?.noQuota).toBe(regra.semCota);
  });
});

describe('get_planning_weeks — paginação e orçamento', () => {
  it('limit e cursor: duas páginas cobrem os clientes uma vez só, em ordem de nome', async () => {
    const primeira = await ok({ month: '2026-10', limit: 2 });
    expect(primeira.clients.map((c) => c.name)).toEqual(['Cliente Alma', 'Cliente Filmes']);
    expect(primeira.hasMore).toBe(true);
    expect(primeira.nextCursor).not.toBeNull();
    // Os grupos descrevem só a página.
    expect(primeira.groups.flatMap((g) => g.clientIds).sort()).toEqual([CLIENT_ALMA, CLIENT_B].sort());

    const segunda = await ok({ month: '2026-10', limit: 2, cursor: primeira.nextCursor as string });
    expect(segunda.clients.map((c) => c.name)).toEqual(['Jatobá', 'Rebrota']);
    expect(segunda.hasMore).toBe(false);
    expect(segunda.nextCursor).toBeNull();
  });

  it('99 clientes com os quatro tipos cabem em 64 KiB por página, e as páginas juntas trazem todos', async () => {
    const clients = Array.from({ length: 99 }, (_, i) => ({
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      name: `Cliente de nome bem comprido para pesar no orçamento número ${String(i).padStart(2, '0')}`,
      companyId: COMPANY_A,
      companyName: 'Agência Ide — unidade de nome comprido',
    }));
    const tipos = ['video', 'arte', 'foto', 'ads'] as const;
    const catalog = new MemoryDeliveryCatalog({
      clients,
      contracts: clients.flatMap((client) =>
        tipos.map((tipo) => ({ clientId: client.id, referenceMonth: OUT, contentType: tipo, quantity: 8 })),
      ),
      items: clients.flatMap((client) =>
        tipos.flatMap((tipo) => [
          peca(client.id, tipo, '2026-10-06', true),
          peca(client.id, tipo, '2026-10-13', false),
        ]),
      ),
      opened: clients.map((client) => ({ clientId: client.id, referenceMonth: OUT })),
    });
    const vistos: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const body = await ok({ month: '2026-10', limit: 100, cursor }, ctxFor(grant(), SUPER, catalog));
      expect(measureJsonBytes(body)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      vistos.push(...body.clients.map((c) => c.id));
      cursor = body.nextCursor ?? undefined;
      paginas += 1;
      expect(body.hasMore).toBe(cursor !== undefined);
    } while (cursor !== undefined && paginas < 20);
    expect(vistos).toHaveLength(99);
    expect(new Set(vistos).size).toBe(99);
    // O orçamento corta: não coube tudo numa página só.
    expect(paginas).toBeGreaterThan(1);
  });
});

describe('get_planning_weeks — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']]));

  it('OpenAPI publica GET e POST, schemas iguais ao Zod e exemplo válido; entrada estrita', () => {
    const doc = integrationOpenApi() as {
      info: { description: string };
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths['/get_planning_weeks'] ?? {}).sort()).toEqual(['get', 'post']);
    expect(doc.components.schemas.GetPlanningWeeksInput).toEqual(jsonSchemaFromZod(getPlanningWeeksInputSchema));
    expect(doc.components.schemas.GetPlanningWeeksResponse).toEqual(
      jsonSchemaFromZod(getPlanningWeeksResponseSchema),
    );
    expect(doc.info.description).toContain('get_planning_weeks');
    const exemplo = getPlanningWeeksResponseSchema.parse(getPlanningWeeksOpenApiExample());
    expect(exemplo.clients[0]?.types[0]?.weeks).toHaveLength(exemplo.weeks.length);

    expect(getPlanningWeeksInputSchema.safeParse({ month: '2026-10', ownerId: FOLDER_HELENA }).success).toBe(true);
    expect(getPlanningWeeksInputSchema.safeParse({ month: '2026-10-01' }).success).toBe(false);
    expect(getPlanningWeeksInputSchema.safeParse({ ownerId: 'nao-e-uuid' }).success).toBe(false);
    expect(getPlanningWeeksInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  function http(path: string, init?: RequestInit, g: IntegrationGrant = grant(), person: PersonAccess = SUPER) {
    return dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${path}`, init),
      grant: g,
      person,
      origin: 'http',
      catalog: memoryCatalog,
      delivery: CATALOG,
      now: AGORA,
    });
  }

  function mcpPost(method: string, params: unknown): Request {
    return new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  }

  async function callTool(args: unknown, g: IntegrationGrant = grant()) {
    const response = await handleMcpRequest({
      request: mcpPost('tools/call', { name: 'get_planning_weeks', arguments: args }),
      grant: g,
      person: SUPER,
      origin: 'mcp',
      catalog: memoryCatalog,
      work: EMPTY_WORK_CATALOG,
      delivery: CATALOG,
      marketing: new MemoryMarketingCatalog(),
      now: AGORA,
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as {
      result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
    }).result;
  }

  it('paridade: HTTP GET, HTTP POST, MCP e a função devolvem o mesmo corpo', async () => {
    const direto = await ok({ month: '2026-10', ownerId: FOLDER_HELENA });

    const get = await http(`${GET_PLANNING_WEEKS_PATH}?month=2026-10&ownerId=${FOLDER_HELENA}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);

    const post = await http(GET_PLANNING_WEEKS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month: '2026-10', ownerId: FOLDER_HELENA }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual(direto);

    const mcp = await callTool({ month: '2026-10', ownerId: FOLDER_HELENA });
    expect(mcp.isError).toBeUndefined();
    expect(mcp.structuredContent).toEqual(direto);
    expect(mcp.content[0]?.text).toContain('planejamento 2026-10');
    expect(mcp.content[0]?.text).toContain('em risco: Jatobá');
  });

  it('HTTP GET com limit na query é número, e a segunda página segue o cursor', async () => {
    const primeira = await http(`${GET_PLANNING_WEEKS_PATH}?month=2026-10&limit=3`);
    expect(primeira.status).toBe(200);
    const corpo = getPlanningWeeksResponseSchema.parse(await primeira.json());
    expect(corpo.clients).toHaveLength(3);
    expect(corpo.hasMore).toBe(true);
    const segunda = await http(
      `${GET_PLANNING_WEEKS_PATH}?month=2026-10&limit=3&cursor=${encodeURIComponent(corpo.nextCursor as string)}`,
    );
    expect(getPlanningWeeksResponseSchema.parse(await segunda.json()).clients).toHaveLength(1);
  });

  it('HTTP: 403 sem a permissão, 400 com entrada inválida e 400 com cursor ruim', async () => {
    const sem = await http(GET_PLANNING_WEEKS_PATH, undefined, grant({ capabilities: ['boards:read'] }));
    expect(sem.status).toBe(403);
    const mes = await http(`${GET_PLANNING_WEEKS_PATH}?month=2026-1`);
    expect(mes.status).toBe(400);
    expect(((await mes.json()) as { error: string }).error).toBe('invalid_input');
    const extra = await http(`${GET_PLANNING_WEEKS_PATH}?month=2026-10&foo=1`);
    expect(extra.status).toBe(400);
    const cursor = await http(`${GET_PLANNING_WEEKS_PATH}?month=2026-10&cursor=lixo!`);
    expect(cursor.status).toBe(400);
    expect(((await cursor.json()) as { error: string }).error).toBe('invalid_cursor');
  });

  it('MCP: recusa com o código estável (sem permissão, cliente de fora) e campo desconhecido', async () => {
    const sem = await callTool({ month: '2026-10' }, grant({ capabilities: ['boards:read'] }));
    expect(sem.isError).toBe(true);
    expect((JSON.parse(sem.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');

    const fora = await callTool({ month: '2026-10', clientId: CLIENT_B }, grant({ allowedClientIds: [CLIENT_A] }));
    expect(fora.isError).toBe(true);
    expect((JSON.parse(fora.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');

    const extra = await callTool({ month: '2026-10', foo: 1 });
    expect(extra.isError).toBe(true);
  });
});

describe('SqlDeliveryCatalog.loadPlanning', () => {
  it('escopo vazio e id que não é UUID respondem vazio sem falar com o banco', async () => {
    const catalog = new SqlDeliveryCatalog({} as never, { kind: 'preauth' });
    const capabilities = new Set(['reports:delivery:read']) as never;
    const vazio = await catalog.loadPlanning({ companies: { kind: 'none' }, clients: 'none', capabilities }, OUT);
    expect(vazio.clients).toEqual([]);
    const naoUuid = await catalog.loadPlanning(
      { companies: { kind: 'all' }, clients: new Set(['cliente-x']), capabilities },
      OUT,
    );
    expect(naoUuid.clients).toEqual([]);
    expect(naoUuid.items).toEqual([]);
  });
});
