/**
 * `get_client_month` e `get_calendar` — conferência de 08/10/2026, lacuna G2.
 *
 * As leituras não têm regra própria: o contrato, o ritual e os motivos são os da
 * visão Contrato; o medidor é `calculateDeliveryLevel` (a chamada da ficha do
 * cliente); o nome da peça é o da tela; o calendário ordena como o da tela. Os
 * testes provam o recorte da concessão (outra empresa, outro cliente da mesma
 * empresa, empresa omitida e cliente cancelado nunca aparecem), a projeção por
 * capacidade, que as observações dos compromissos e o link do cliente não saem, o
 * cursor andando até o fim e as três superfícies (função, HTTP, MCP) iguais.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import { nomesDosItens } from '@/clients/nome-do-item';
import { calculateDeliveryLevel } from '@/delivery/level';
import { getCalendar, getClientMonth } from '@/integrations/client-month';
import {
  CALENDAR_MAX_DAYS,
  GET_CALENDAR_PATH,
  GET_CLIENT_MONTH_PATH,
  getCalendarInputSchema,
  getCalendarOpenApiExample,
  getCalendarResponseSchema,
  getClientMonthInputSchema,
  getClientMonthOpenApiExample,
  getClientMonthResponseSchema,
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
  EMPTY_DELIVERY_CATALOG,
  MemoryDeliveryCatalog,
  type DeliveryCatalog,
  type MemoryDeliveryData,
  type MemoryDeliveryItem,
  type ReportCtx,
} from '@/integrations/reports';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_ALMA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_A2 = 'cliente-sabor-doce';
const CLIENT_B = 'cliente-filmes';
const CLIENT_ALMA = 'cliente-alma9';
const CLIENT_ZECA = 'cliente-zeca';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const FOLDER_HELENA = '22222222-2222-4222-8222-222222222222';
const USER_ANA = '33333333-3333-4333-8333-333333333333';
const USER_HELENA = '44444444-4444-4444-8444-444444444444';
const ORIGIN = 'https://ideworks.test';
/** Segunda-feira, 05/10/2026, 09h em São Paulo. */
const AGORA = new Date('2026-10-05T12:00:00.000Z');
const OUT = '2026-10-01';
const NOTA_DO_COMPROMISSO = 'Levar o tripé e falar com o João 11 99999-0000';

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
  clientIds: [CLIENT_A, CLIENT_A2, CLIENT_B, CLIENT_ALMA, CLIENT_ZECA],
  hasAllClientsAccess: true,
};
const SEM_ALMA: PersonAccess = { ...SUPER, omittedCompanyIds: [COMPANY_ALMA] };
/** Quem NÃO é o topo: alcança só a empresa A e os clientes dela. */
const DA_EMPRESA_A: PersonAccess = {
  ...SUPER,
  isSuper: false,
  isSuperadmin: false,
  hasAllClientsAccess: false,
  companyIds: [COMPANY_A],
  clientIds: [CLIENT_A, CLIENT_A2],
};

function grant(partial: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: 'grant-mes-do-cliente',
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
 * Jatobá: mês aberto e PLANEJADO por Helena, vídeo 8 e arte 4, cinco peças
 * (feita 02/10, atrasada 03/10, agendada 08/10, arte 12/10, vídeo sem dia) e
 * dois compromissos. Sabor Doce: aprovado. Filmes: outra empresa. Alma Nove:
 * empresa omitida. Zeca: CANCELADO.
 */
const ITEMS: MemoryDeliveryItem[] = [
  peca(CLIENT_A, 'video', '2026-10-02', true, { id: 'v-feito', title: 'Reels de abertura', completedAt: '2026-10-02T15:00:00.000Z' }),
  peca(CLIENT_A, 'video', '2026-10-03', false, { id: 'v-atrasado' }),
  peca(CLIENT_A, 'video', '2026-10-08', false, { id: 'v-agendado' }),
  peca(CLIENT_A, 'video', null, false, { id: 'v-sem-dia' }),
  peca(CLIENT_A, 'arte', '2026-10-12', false, { id: 'a-agendada', title: 'Post de lançamento' }),
  peca(CLIENT_A2, 'arte', '2026-10-06', false, { id: 'sd-a2' }),
  peca(CLIENT_B, 'foto', '2026-10-14', true, { id: 'f-feita' }),
  peca(CLIENT_ALMA, 'video', '2026-10-06', true, { id: 'alma-v' }),
  peca(CLIENT_ZECA, 'video', '2026-10-03', false, { id: 'zeca-v' }),
  // Fora de outubro: nem o calendário de outubro nem o mês de competência de outubro.
  peca(CLIENT_A, 'arte', '2026-11-03', false, { id: 'a-novembro', referenceMonth: '2026-11-01' }),
];

const DATA: MemoryDeliveryData = {
  clients: [
    { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_A2, name: 'Sabor Doce', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes' },
    { id: CLIENT_ALMA, name: 'Cliente Alma', companyId: COMPANY_ALMA, companyName: 'Alma Nove' },
    {
      id: CLIENT_ZECA,
      name: 'Zeca',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      isActive: false,
      cancelledOn: '2026-10-04',
    },
  ],
  contracts: [
    { clientId: CLIENT_A, referenceMonth: OUT, contentType: 'video', quantity: 8 },
    { clientId: CLIENT_A, referenceMonth: OUT, contentType: 'arte', quantity: 4 },
    { clientId: CLIENT_A2, referenceMonth: OUT, contentType: 'arte', quantity: 2 },
    { clientId: CLIENT_B, referenceMonth: OUT, contentType: 'foto', quantity: 2 },
  ],
  items: ITEMS,
  opened: [
    { clientId: CLIENT_A, referenceMonth: OUT },
    { clientId: CLIENT_A2, referenceMonth: OUT },
    { clientId: CLIENT_B, referenceMonth: OUT },
  ],
  ritual: [
    {
      clientId: CLIENT_A,
      referenceMonth: OUT,
      planningDoneAt: '2026-10-02T13:00:00.000Z',
      planningDoneBy: { id: USER_HELENA, name: 'Helena' },
      clientApprovedAt: null,
      clientApprovedBy: null,
    },
    {
      clientId: CLIENT_A2,
      referenceMonth: OUT,
      planningDoneAt: '2026-10-01T13:00:00.000Z',
      planningDoneBy: { id: USER_HELENA, name: 'Helena' },
      clientApprovedAt: '2026-10-02T15:00:00.000Z',
      clientApprovedBy: { id: USER_ANA, name: 'Ana' },
    },
  ],
  registry: [
    { clientId: CLIENT_A, contentType: 'video', quantity: 8 },
    { clientId: CLIENT_A2, contentType: 'arte', quantity: 2 },
  ],
  folders: [
    { clientId: CLIENT_A, folderId: FOLDER_HELENA, folderName: 'TIME HELENA' },
    { clientId: CLIENT_A2, folderId: FOLDER_HELENA, folderName: 'TIME HELENA' },
  ],
  portfolio: [{ clientId: CLIENT_B, userId: USER_ANA, name: 'Ana' }],
  appointments: [
    { id: 'ap-gravacao', clientId: CLIENT_A, day: '2026-10-06', time: '14:30', title: 'Gravação na loja', notes: NOTA_DO_COMPROMISSO },
    { id: 'ap-reuniao', clientId: CLIENT_A, day: '2026-10-08', time: null, title: 'Reunião de alinhamento', notes: null },
    { id: 'ap-filmes', clientId: CLIENT_B, day: '2026-10-08', time: '09:00', title: 'Reunião Filmes' },
    { id: 'ap-alma', clientId: CLIENT_ALMA, day: '2026-10-07', time: '10:00', title: 'Reunião Alma' },
    { id: 'ap-zeca', clientId: CLIENT_ZECA, day: '2026-10-02', time: '10:00', title: 'Reunião Zeca' },
    { id: 'ap-novembro', clientId: CLIENT_A, day: '2026-11-10', time: null, title: 'Fora do período' },
  ],
};
const CATALOG = new MemoryDeliveryCatalog(DATA);

function ctxFor(
  g: IntegrationGrant = grant(),
  person: PersonAccess = SUPER,
  delivery: DeliveryCatalog = CATALOG,
): ReportCtx {
  return { grant: g, person, origin: 'http', companies: COMPANIES, displayName: 'Wesley Lourenço', delivery, now: AGORA };
}

const NEGADO = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };

async function mes(input: Parameters<typeof getClientMonth>[1], ctx: ReportCtx = ctxFor()) {
  const result = await getClientMonth(ctx, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.body;
}

async function cal(input: Parameters<typeof getCalendar>[1], ctx: ReportCtx = ctxFor()) {
  const result = await getCalendar(ctx, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.body;
}

describe('get_client_month — a leitura', () => {
  it('contrato, ritual, medidor e cada peça: id, nome, tipo, dia, ✓, extra', async () => {
    const body = await mes({ clientId: CLIENT_A, month: '2026-10' });
    expect(body.operation).toBe('get_client_month');
    expect(body.month).toBe('2026-10');
    expect(body.today).toBe('2026-10-05');
    expect(body.self).toBe(`${GET_CLIENT_MONTH_PATH}?clientId=${CLIENT_A}&month=2026-10`);
    expect(body.client).toMatchObject({
      id: CLIENT_A,
      name: 'Jatobá',
      stage: 'planejado',
      hasContract: true,
      needsAttention: true,
    });
    expect(body.client.reasons.map((r) => r.key)).toEqual(['atrasadas', 'semana-em-risco', 'sem-dia']);
    expect(body.contract).toEqual({
      monthOpened: true,
      source: 'contrato',
      items: [
        { type: 'video', quantity: 8 },
        { type: 'arte', quantity: 4 },
      ],
    });

    // O medidor é a chamada da ficha do cliente: contrato congelado + peças do mês.
    const esperado = calculateDeliveryLevel(
      [
        { contentType: 'video', quantity: 8 },
        { contentType: 'arte', quantity: 4 },
      ],
      [
        { contentType: 'video', isExtra: false, isCompleted: true },
        { contentType: 'video', isExtra: false, isCompleted: false },
        { contentType: 'video', isExtra: false, isCompleted: false },
        { contentType: 'video', isExtra: false, isCompleted: false },
        { contentType: 'arte', isExtra: false, isCompleted: false },
      ],
      { monthOpened: true, hasContentContract: true },
    );
    expect(body.meter).toEqual(esperado);
    expect(body.meter.measurable).toBe(true);

    // Por dia, sem dia por último; o sinal e a semana são os da aba Semana.
    expect(body.pieces.map((p) => [p.id, p.day, p.signal, p.week, p.done, p.type])).toEqual([
      ['v-feito', '2026-10-02', 'feita', 1, true, 'video'],
      ['v-atrasado', '2026-10-03', 'atrasada', 1, false, 'video'],
      ['v-agendado', '2026-10-08', 'agendada', 2, false, 'video'],
      ['a-agendada', '2026-10-12', 'agendada', 3, false, 'arte'],
      ['v-sem-dia', null, null, null, false, 'video'],
    ]);
    expect(body.pieces[0]).toMatchObject({
      name: 'Vídeo “Reels de abertura”, dia 02/10',
      title: 'Reels de abertura',
      completedAt: '2026-10-02T15:00:00.000Z',
      extra: false,
    });
    // A peça de novembro (outro mês de competência) não está no mês de outubro.
    expect(body.pieces.map((p) => p.id)).not.toContain('a-novembro');
  });

  it('o nome da peça é o da tela, com "(n de m)" onde se repete', async () => {
    const duas = new MemoryDeliveryCatalog({
      ...DATA,
      items: [peca(CLIENT_A, 'video', null, false, { id: 'u1' }), peca(CLIENT_A, 'video', null, false, { id: 'u2' })],
    });
    const body = await mes({ clientId: CLIENT_A, month: '2026-10' }, ctxFor(grant(), SUPER, duas));
    expect(body.pieces.map((p) => p.name)).toEqual(['Vídeo sem título, sem data (1 de 2)', 'Vídeo sem título, sem data (2 de 2)']);
    const esperados = nomesDosItens([
      { id: 'u1', contentType: 'video', scheduledAt: null, isExtra: false, title: null },
      { id: 'u2', contentType: 'video', scheduledAt: null, isExtra: false, title: null },
    ]);
    expect(body.pieces.map((p) => p.name)).toEqual([esperados.get('u1'), esperados.get('u2')]);
  });

  it('mês não aberto: a cota do cadastro, source cadastro, medidor não mensurável (nunca 0%)', async () => {
    const body = await mes({ clientId: CLIENT_A, month: '2026-11' });
    expect(body.contract).toEqual({ monthOpened: false, source: 'cadastro', items: [{ type: 'video', quantity: 8 }] });
    expect(body.meter).toMatchObject({ measurable: false, reason: 'no_contract' });
    expect(body.client.stage).toBe('fechado');
    expect(body.client.reasons.map((r) => r.key)).toEqual(['mes-nao-aberto']);
    expect(body.pieces.map((p) => p.id)).toEqual(['a-novembro']);
  });

  it('sem month: o mês atual da agência', async () => {
    expect((await mes({ clientId: CLIENT_A })).month).toBe('2026-10');
  });

  it('peça extra: não paga contrato e aparece como extra', async () => {
    const comExtra = new MemoryDeliveryCatalog({
      ...DATA,
      items: [...ITEMS, peca(CLIENT_A, 'video', '2026-10-09', true, { id: 'v-extra', isExtra: true })],
    });
    const body = await mes({ clientId: CLIENT_A, month: '2026-10' }, ctxFor(grant(), SUPER, comExtra));
    expect(body.pieces.find((p) => p.id === 'v-extra')).toMatchObject({ extra: true, done: true, signal: 'feita' });
    expect(body.client.types.find((t) => t.type === 'video')).toMatchObject({ extras: 1, delivered: 1 });
  });
});

describe('get_client_month — o recorte e a projeção', () => {
  it('outra empresa, outro cliente da mesma empresa, omitida, cancelado e inexistente: a MESMA recusa', async () => {
    const recusas = await Promise.all([
      getClientMonth(ctxFor(grant({ allowedCompanyIds: [COMPANY_B] })), { clientId: CLIENT_A, month: '2026-10' }),
      getClientMonth(ctxFor(grant({ allowedClientIds: [CLIENT_A2] })), { clientId: CLIENT_A, month: '2026-10' }),
      getClientMonth(ctxFor(grant(), SEM_ALMA), { clientId: CLIENT_ALMA, month: '2026-10' }),
      getClientMonth(ctxFor(), { clientId: CLIENT_ZECA, month: '2026-10' }),
      getClientMonth(ctxFor(), { clientId: 'cliente-que-nao-existe', month: '2026-10' }),
      getClientMonth(ctxFor(grant(), DA_EMPRESA_A), { clientId: CLIENT_B, month: '2026-10' }),
    ]);
    for (const recusa of recusas) expect(recusa).toEqual(NEGADO);
  });

  it('a mesma pessoa/concessão enxerga o cliente permitido; o recorte nunca vaza o vizinho', async () => {
    const body = await mes({ clientId: CLIENT_A, month: '2026-10' }, ctxFor(grant({ allowedClientIds: [CLIENT_A] })));
    expect(body.client.id).toBe(CLIENT_A);
    expect(body.coverage.kind).toBe('partial');
    expect(JSON.stringify(body)).not.toContain('Sabor Doce');
  });

  it('só lê o cliente pedido: o recorte chega estreitado a ele', async () => {
    const escopos: unknown[] = [];
    const espiao: DeliveryCatalog = {
      ...EMPTY_DELIVERY_CATALOG,
      load: (scope, period) => CATALOG.load(scope, period),
      loadCalendar: (scope, period) => CATALOG.loadCalendar(scope, period),
      loadMonthly: (scope, period) => CATALOG.loadMonthly(scope, period),
      loadDeliveryStatus: (scope, now) => CATALOG.loadDeliveryStatus(scope, now),
      loadPlanning: (scope, month) => {
        escopos.push(scope.clients);
        return CATALOG.loadPlanning(scope, month);
      },
    };
    await mes({ clientId: CLIENT_A, month: '2026-10' }, ctxFor(grant(), SUPER, espiao));
    expect(escopos).toEqual([new Set([CLIENT_A])]);
  });

  it('sem reports:delivery:read: permission_denied antes de qualquer outra checagem', async () => {
    const semCapacidade = grant({ capabilities: ['boards:read'] });
    expect(await getClientMonth(ctxFor(semCapacidade), { clientId: CLIENT_A, month: '2026-10' })).toEqual(NEGADO);
    expect(await getClientMonth(ctxFor(semCapacidade), { clientId: CLIENT_A, month: '2026-13' })).toEqual(NEGADO);
  });

  it('mês fora do formato é invalid_input', async () => {
    const r = await getClientMonth(ctxFor(), { clientId: CLIENT_A, month: '2026-13' });
    expect(r.ok === false && r.code).toBe('invalid_input');
  });

  it('nome de pessoa só com people:read (quem planejou/aprovou e o responsável da carteira)', async () => {
    const sem = await mes({ clientId: CLIENT_A2, month: '2026-10' });
    expect(sem.client.ritual.planningDoneBy).toBeNull();
    expect(sem.client.ritual.clientApprovedBy).toBeNull();
    expect(sem.client.ritual.planningDoneAt).not.toBeNull();
    const com = await mes({ clientId: CLIENT_A2, month: '2026-10' }, ctxFor(grant({ capabilities: ['reports:delivery:read', 'people:read'] })));
    expect(com.client.ritual.planningDoneBy).toEqual({ id: USER_HELENA, name: 'Helena' });
    expect(com.client.ritual.clientApprovedBy).toEqual({ id: USER_ANA, name: 'Ana' });
    // Responsável da carteira (pessoa): nome nulo sem people:read.
    const filmes = await mes({ clientId: CLIENT_B, month: '2026-10' });
    expect(filmes.client.owners).toEqual([{ id: USER_ANA, name: null, kind: 'person' }]);
  });
});

describe('get_calendar — a leitura', () => {
  it('peças e compromissos do período, na ordem do calendário da tela', async () => {
    const body = await cal({ from: '2026-10-01', to: '2026-10-31' });
    expect(body.operation).toBe('get_calendar');
    expect(body.period).toEqual({ from: '2026-10-01', to: '2026-10-31', days: 31 });
    // Dia a dia: com hora antes de sem hora; depois o nome do cliente.
    expect(body.entries.map((e) => [e.day, e.time, e.kind, e.id])).toEqual([
      ['2026-10-02', null, 'delivery', 'v-feito'],
      ['2026-10-03', null, 'delivery', 'v-atrasado'],
      ['2026-10-06', '14:30', 'appointment', 'ap-gravacao'],
      ['2026-10-06', null, 'delivery', 'alma-v'],
      ['2026-10-06', null, 'delivery', 'sd-a2'],
      ['2026-10-07', '10:00', 'appointment', 'ap-alma'],
      ['2026-10-08', '09:00', 'appointment', 'ap-filmes'],
      ['2026-10-08', null, 'appointment', 'ap-reuniao'],
      ['2026-10-08', null, 'delivery', 'v-agendado'],
      ['2026-10-12', null, 'delivery', 'a-agendada'],
      ['2026-10-14', null, 'delivery', 'f-feita'],
    ]);
  });

  it('o resumo conta o período inteiro; peça fora do período e do cancelado não entram', async () => {
    const body = await cal({ from: '2026-10-05', to: '2026-10-09' }, ctxFor(grant(), SEM_ALMA));
    expect(body.summary).toEqual({ deliveries: 2, deliveriesDone: 0, appointments: 3 });
    expect(body.entries.map((e) => e.id)).toEqual(['ap-gravacao', 'sd-a2', 'ap-filmes', 'ap-reuniao', 'v-agendado']);
    expect(JSON.stringify(body)).not.toContain('Zeca');
    expect(JSON.stringify(body)).not.toContain('Alma');
  });

  it('a peça leva tipo, título, ✓ e extra; o compromisso leva hora e nenhum desses', async () => {
    const body = await cal({ from: '2026-10-02', to: '2026-10-02' });
    expect(body.entries).toEqual([
      {
        kind: 'delivery',
        id: 'v-feito',
        day: '2026-10-02',
        time: null,
        client: { id: CLIENT_A, name: 'Jatobá' },
        type: 'video',
        title: 'Reels de abertura',
        done: true,
        extra: false,
      },
    ]);
    const compromisso = (await cal({ from: '2026-10-06', to: '2026-10-06' })).entries.find((e) => e.kind === 'appointment');
    expect(compromisso).toEqual({
      kind: 'appointment',
      id: 'ap-gravacao',
      day: '2026-10-06',
      time: '14:30',
      client: { id: CLIENT_A, name: 'Jatobá' },
      type: null,
      title: 'Gravação na loja',
      done: null,
      extra: null,
    });
  });

  it('as observações do compromisso (texto livre) nunca saem', async () => {
    const todo = JSON.stringify(await cal({ from: '2026-10-01', to: '2026-10-31' }));
    expect(todo).not.toContain('tripé');
    expect(todo).not.toContain('99999');
    expect(todo).not.toContain('notes');
  });

  it('com clientId: só o cliente; período sem nada dele é lista vazia, não recusa', async () => {
    const um = await cal({ from: '2026-10-01', to: '2026-10-31', clientId: CLIENT_A });
    expect(new Set(um.entries.map((e) => e.client.id))).toEqual(new Set([CLIENT_A]));
    expect(um.self).toBe(`${GET_CALENDAR_PATH}?from=2026-10-01&to=2026-10-31&clientId=${CLIENT_A}`);
    const vazio = await cal({ from: '2026-12-01', to: '2026-12-31', clientId: CLIENT_A });
    expect(vazio.entries).toEqual([]);
    expect(vazio.summary).toEqual({ deliveries: 0, deliveriesDone: 0, appointments: 0 });
  });

  it('período: um dia só vale; 62 dias valem; 63 é limit_exceeded; data impossível e from > to são invalid_input', async () => {
    expect((await cal({ from: '2026-10-05', to: '2026-10-05' })).period.days).toBe(1);
    expect((await cal({ from: '2026-10-01', to: '2026-12-01' })).period.days).toBe(CALENDAR_MAX_DAYS);
    const longo = await getCalendar(ctxFor(), { from: '2026-10-01', to: '2026-12-02' });
    expect(longo.ok === false && longo.code).toBe('limit_exceeded');
    for (const ruim of [
      { from: '2026-02-30', to: '2026-03-02' },
      { from: '2026-10-10', to: '2026-10-01' },
    ]) {
      const r = await getCalendar(ctxFor(), ruim);
      expect(r.ok === false && r.code).toBe('invalid_input');
    }
  });
});

describe('get_calendar — o recorte, a projeção e a paginação', () => {
  it('outra empresa, outro cliente da mesma empresa, omitida e cancelado: nunca aparecem', async () => {
    const soB = await cal({ from: '2026-10-01', to: '2026-10-31' }, ctxFor(grant({ allowedCompanyIds: [COMPANY_B] })));
    expect(new Set(soB.entries.map((e) => e.client.id))).toEqual(new Set([CLIENT_B]));

    const soSonho = await cal({ from: '2026-10-01', to: '2026-10-31' }, ctxFor(grant({ allowedClientIds: [CLIENT_A2] })));
    expect(soSonho.entries.map((e) => e.id)).toEqual(['sd-a2']);
    expect(soSonho.coverage.kind).toBe('partial');

    const daEmpresaA = await cal({ from: '2026-10-01', to: '2026-10-31' }, ctxFor(grant(), DA_EMPRESA_A));
    expect(new Set(daEmpresaA.entries.map((e) => e.client.id))).toEqual(new Set([CLIENT_A, CLIENT_A2]));

    const semAlma = await cal({ from: '2026-10-01', to: '2026-10-31' }, ctxFor(grant(), SEM_ALMA));
    expect(semAlma.entries.map((e) => e.client.id)).not.toContain(CLIENT_ALMA);
    expect(semAlma.entries.map((e) => e.client.id)).not.toContain(CLIENT_ZECA);
  });

  it('clientId de fora (outro cliente, outra empresa, omitida, cancelado, inexistente): a MESMA recusa', async () => {
    const periodo = { from: '2026-10-01', to: '2026-10-31' };
    const recusas = await Promise.all([
      getCalendar(ctxFor(grant({ allowedClientIds: [CLIENT_A2] })), { ...periodo, clientId: CLIENT_A }),
      getCalendar(ctxFor(grant({ allowedCompanyIds: [COMPANY_B] })), { ...periodo, clientId: CLIENT_A }),
      getCalendar(ctxFor(grant(), SEM_ALMA), { ...periodo, clientId: CLIENT_ALMA }),
      getCalendar(ctxFor(), { ...periodo, clientId: CLIENT_ZECA }),
      getCalendar(ctxFor(), { ...periodo, clientId: 'cliente-que-nao-existe' }),
    ]);
    for (const recusa of recusas) expect(recusa).toEqual(NEGADO);
  });

  it('sem reports:delivery:read: permission_denied antes de validar o período', async () => {
    const semCapacidade = grant({ capabilities: ['boards:read'] });
    expect(await getCalendar(ctxFor(semCapacidade), { from: '2026-10-01', to: '2026-10-31' })).toEqual(NEGADO);
    expect(await getCalendar(ctxFor(semCapacidade), { from: 'x', to: 'y' })).toEqual(NEGADO);
  });

  it('limite e cursor ruins são recusados antes de ler o banco', async () => {
    let lidas = 0;
    const espiao: DeliveryCatalog = {
      ...EMPTY_DELIVERY_CATALOG,
      load: (scope, period) => CATALOG.load(scope, period),
      loadMonthly: (scope, period) => CATALOG.loadMonthly(scope, period),
      loadDeliveryStatus: (scope, now) => CATALOG.loadDeliveryStatus(scope, now),
      loadPlanning: (scope, month) => CATALOG.loadPlanning(scope, month),
      loadCalendar: (scope, period) => {
        lidas += 1;
        return CATALOG.loadCalendar(scope, period);
      },
    };
    const periodo = { from: '2026-10-01', to: '2026-10-31' };
    const ctx = ctxFor(grant(), SUPER, espiao);
    expect((await getCalendar(ctx, { ...periodo, limit: 101 })).ok).toBe(false);
    expect((await getCalendar(ctx, { ...periodo, cursor: 'lixo!' })).ok).toBe(false);
    expect((await getCalendar(ctx, { from: '2026-01-01', to: '2026-12-31' })).ok).toBe(false);
    expect(lidas).toBe(0);
  });

  it('o cursor anda até o fim: as páginas cobrem as entradas uma vez só, na ordem do calendário', async () => {
    const periodo = { from: '2026-10-01', to: '2026-10-31' };
    const todas = (await cal(periodo)).entries.map((e) => e.id);
    const vistas: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const pagina = await cal({ ...periodo, limit: 3, cursor });
      expect(pagina.entries.length).toBeLessThanOrEqual(3);
      expect(pagina.summary.deliveries + pagina.summary.appointments).toBe(todas.length);
      vistas.push(...pagina.entries.map((e) => e.id));
      cursor = pagina.nextCursor ?? undefined;
      expect(pagina.hasMore).toBe(cursor !== undefined);
      paginas += 1;
    } while (cursor !== undefined && paginas < 20);
    expect(vistas).toEqual(todas);
    expect(paginas).toBe(Math.ceil(todas.length / 3));
  });

  it('muitas peças: cada página cabe em 64 KiB e o cursor traz todas, uma vez só', async () => {
    const clients = Array.from({ length: 40 }, (_, i) => ({
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      name: `Cliente de nome bem comprido para pesar no orçamento número ${String(i).padStart(2, '0')}`,
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
    }));
    const items = clients.flatMap((client, c) =>
      Array.from({ length: 30 }, (_, n) =>
        peca(client.id, ['video', 'arte', 'foto', 'ads'][n % 4] as string, `2026-10-${String((n % 28) + 1).padStart(2, '0')}`, n % 3 === 0, {
          id: `p-${c}-${n}`,
          title: `Peça de título comprido para ocupar espaço no corpo da resposta ${c}-${n}`,
        }),
      ),
    );
    const catalog = new MemoryDeliveryCatalog({ clients, items });
    const vistas: string[] = [];
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const pagina = await cal({ from: '2026-10-01', to: '2026-10-31', limit: 100, cursor }, ctxFor(grant(), SUPER, catalog));
      expect(measureJsonBytes(pagina)).toBeLessThanOrEqual(RESPONSE_BUDGET_BYTES);
      vistas.push(...pagina.entries.map((e) => e.id));
      cursor = pagina.nextCursor ?? undefined;
      expect(pagina.hasMore).toBe(cursor !== undefined);
      paginas += 1;
    } while (cursor !== undefined && paginas < 50);
    expect(vistas).toHaveLength(1200);
    expect(new Set(vistas).size).toBe(1200);
    expect(paginas).toBeGreaterThan(1);
  }, 30_000);
});

describe('get_client_month e get_calendar — contrato, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']]));

  it('OpenAPI publica GET e POST, schemas iguais ao Zod e exemplos válidos; entrada estrita', () => {
    const doc = integrationOpenApi() as {
      info: { description: string };
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    for (const caminho of ['/get_client_month', '/get_calendar']) {
      expect(Object.keys(doc.paths[caminho] ?? {}).sort()).toEqual(['get', 'post']);
    }
    expect(doc.components.schemas.GetClientMonthInput).toEqual(jsonSchemaFromZod(getClientMonthInputSchema));
    expect(doc.components.schemas.GetClientMonthResponse).toEqual(jsonSchemaFromZod(getClientMonthResponseSchema));
    expect(doc.components.schemas.GetCalendarInput).toEqual(jsonSchemaFromZod(getCalendarInputSchema));
    expect(doc.components.schemas.GetCalendarResponse).toEqual(jsonSchemaFromZod(getCalendarResponseSchema));
    expect(doc.info.description).toContain('get_client_month');
    expect(doc.info.description).toContain('get_calendar');
    getClientMonthResponseSchema.parse(getClientMonthOpenApiExample());
    expect(getCalendarResponseSchema.parse(getCalendarOpenApiExample()).entries.length).toBeGreaterThan(0);

    expect(getClientMonthInputSchema.safeParse({ clientId: 'x' }).success).toBe(true);
    expect(getClientMonthInputSchema.safeParse({}).success).toBe(false);
    expect(getClientMonthInputSchema.safeParse({ clientId: 'x', month: '2026-10-01' }).success).toBe(false);
    expect(getClientMonthInputSchema.safeParse({ clientId: 'x', extra: 1 }).success).toBe(false);
    expect(getCalendarInputSchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
    expect(getCalendarInputSchema.safeParse({ from: '2026-10-01' }).success).toBe(false);
    expect(getCalendarInputSchema.safeParse({ from: '2026-10', to: '2026-11' }).success).toBe(false);
    expect(getCalendarInputSchema.safeParse({ from: '2026-10-01', to: '2026-10-31', extra: 1 }).success).toBe(false);
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

  async function callTool(name: string, args: unknown, g: IntegrationGrant = grant()) {
    const response = await handleMcpRequest({
      request: new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      }),
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

  it('get_client_month: HTTP GET, POST, MCP e a função devolvem o mesmo corpo', async () => {
    const direto = await mes({ clientId: CLIENT_A, month: '2026-10' });
    const get = await http(`${GET_CLIENT_MONTH_PATH}?clientId=${CLIENT_A}&month=2026-10`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);
    const post = await http(GET_CLIENT_MONTH_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_A, month: '2026-10' }),
    });
    expect(await post.json()).toEqual(direto);
    const mcp = await callTool('get_client_month', { clientId: CLIENT_A, month: '2026-10' });
    expect(mcp.isError).toBeUndefined();
    expect(mcp.structuredContent).toEqual(direto);
    expect(mcp.content[0]?.text).toContain('Jatobá');
    expect(mcp.content[0]?.text).toContain('5 peça(s), 1 com ✓');
  });

  it('get_calendar: HTTP GET, POST, MCP e a função devolvem o mesmo corpo; a segunda página pelo cursor', async () => {
    const direto = await cal({ from: '2026-10-01', to: '2026-10-31', limit: 4 });
    const get = await http(`${GET_CALENDAR_PATH}?from=2026-10-01&to=2026-10-31&limit=4`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(direto);
    const post = await http(GET_CALENDAR_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '2026-10-01', to: '2026-10-31', limit: 4 }),
    });
    expect(await post.json()).toEqual(direto);
    const mcp = await callTool('get_calendar', { from: '2026-10-01', to: '2026-10-31', limit: 4 });
    expect(mcp.structuredContent).toEqual(direto);
    expect(mcp.content[0]?.text).toContain('calendário 2026-10-01–2026-10-31');
    const segunda = await http(
      `${GET_CALENDAR_PATH}?from=2026-10-01&to=2026-10-31&limit=4&cursor=${encodeURIComponent(direto.nextCursor as string)}`,
    );
    const corpo = getCalendarResponseSchema.parse(await segunda.json());
    expect(corpo.entries.map((e) => e.id)).not.toContain(direto.entries[0]?.id);
    expect(corpo.entries.length).toBeGreaterThan(0);
  });

  it('HTTP: 403 sem a permissão, 400 com entrada inválida, 400 com período grande, 403 com cliente de fora', async () => {
    const sem = grant({ capabilities: ['boards:read'] });
    expect((await http(`${GET_CLIENT_MONTH_PATH}?clientId=${CLIENT_A}`, undefined, sem)).status).toBe(403);
    expect((await http(`${GET_CALENDAR_PATH}?from=2026-10-01&to=2026-10-31`, undefined, sem)).status).toBe(403);
    expect((await http(GET_CLIENT_MONTH_PATH)).status).toBe(400);
    expect((await http(`${GET_CLIENT_MONTH_PATH}?clientId=${CLIENT_A}&month=2026-1`)).status).toBe(400);
    expect((await http(`${GET_CALENDAR_PATH}?from=2026-10-01`)).status).toBe(400);
    expect((await http(`${GET_CALENDAR_PATH}?from=2026-10-01&to=2026-10-31&foo=1`)).status).toBe(400);
    const longo = await http(`${GET_CALENDAR_PATH}?from=2026-01-01&to=2026-12-31`);
    expect(longo.status).toBe(400);
    expect(((await longo.json()) as { error: string }).error).toBe('limit_exceeded');
    const cursor = await http(`${GET_CALENDAR_PATH}?from=2026-10-01&to=2026-10-31&cursor=lixo!`);
    expect(((await cursor.json()) as { error: string }).error).toBe('invalid_cursor');
    const fora = await http(`${GET_CLIENT_MONTH_PATH}?clientId=${CLIENT_B}`, undefined, grant({ allowedClientIds: [CLIENT_A] }));
    expect(fora.status).toBe(403);
  });

  it('MCP: recusa com o código estável e campo desconhecido', async () => {
    const semMes = await callTool('get_client_month', { clientId: CLIENT_A }, grant({ capabilities: ['boards:read'] }));
    expect(semMes.isError).toBe(true);
    expect((JSON.parse(semMes.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');
    const fora = await callTool('get_calendar', { from: '2026-10-01', to: '2026-10-31', clientId: CLIENT_B }, grant({ allowedClientIds: [CLIENT_A] }));
    expect(fora.isError).toBe(true);
    expect((JSON.parse(fora.content[0]?.text ?? '{}') as { error: string }).error).toBe('permission_denied');
    expect((await callTool('get_calendar', { from: '2026-10-01', to: '2026-10-31', foo: 1 })).isError).toBe(true);
    expect((await callTool('get_client_month', { month: '2026-10' })).isError).toBe(true);
  });
});
