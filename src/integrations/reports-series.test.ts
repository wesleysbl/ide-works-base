/**
 * Entrega mês a mês — F26.7.
 *
 * A série NÃO tem fórmula própria: cada mês de `get_client_delivery_history`
 * e de `get_delivery_trend` tem de ser idêntico ao `get_delivery_report`
 * daquele mês, na mesma massa. Mês não aberto não vira 0%. Limites recusados
 * com frase. A carteira de 99 clientes × 6 meses cabe em 64 KiB. Recorte da
 * concessão igual ao do relatório, e a leitura só pede o que foi pedido.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  DELIVERY_HISTORY_MAX_MONTHS,
  DELIVERY_SERIES_DEFAULT_MONTHS,
  DELIVERY_TREND_MAX_MONTHS,
  GET_CLIENT_DELIVERY_HISTORY_PATH,
  GET_DELIVERY_TREND_PATH,
  getClientDeliveryHistoryInputSchema,
  getClientDeliveryHistoryOpenApiExample,
  getClientDeliveryHistoryResponseSchema,
  getDeliveryTrendInputSchema,
  getDeliveryTrendOpenApiExample,
  getDeliveryTrendResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import { MemoryMarketingCatalog } from '@/integrations/marketing';
import { handleMcpRequest } from '@/integrations/mcp';
import { measureJsonBytes, RESPONSE_BUDGET_BYTES } from '@/integrations/page';
import { EMPTY_WORK_CATALOG, type WorkScope } from '@/integrations/reads';
import {
  MemoryDeliveryCatalog,
  SqlDeliveryCatalog,
  getClientDeliveryHistory,
  getDeliveryReport,
  getDeliveryTrend,
  resolveDeliverySeries,
  type DeliveryCatalog,
  type DeliveryPeriodQuery,
  type MemoryDeliveryContract,
  type MemoryDeliveryItem,
  type ReportCtx,
} from '@/integrations/reports';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import { MAX_MESES_NO_INTERVALO } from '@/server/panel';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_A2 = 'cliente-rebrota';
const CLIENT_HUB = 'cliente-hub';
const CLIENT_B = 'cliente-filmes';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const ORIGIN = 'https://ideworks.test';
/** 22/09/2026, 09h em São Paulo. */
const AGORA = new Date('2026-09-22T12:00:00.000Z');
const JUL = '2026-07-01';
const AGO = '2026-08-01';
const SET = '2026-09-01';

const ADMIN: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [COMPANY_A, COMPANY_B],
  clientIds: [CLIENT_A, CLIENT_A2, CLIENT_HUB, CLIENT_B],
  hasAllClientsAccess: true,
};
const SUPER: PersonAccess = { ...ADMIN, isSuper: true };

function item(
  clientId: string,
  referenceMonth: string,
  contentType: string,
  isCompleted: boolean,
  scheduledOn: string | null,
  isExtra = false,
): MemoryDeliveryItem {
  return { clientId, referenceMonth, contentType, isExtra, isCompleted, scheduledOn };
}

/**
 * Três meses com casos diferentes. Jatobá: julho não aberto, agosto 100%,
 * setembro pela metade, com extra. Rebrota: nunca aberto. HUB: aberto sem cota
 * e sem contrato de conteúdo. Filmes: outra empresa. Há produção datada que
 * atravessa o mês de referência (item de agosto agendado em 01/09) — a
 * contagem `inPeriod` do mês é pelo dia, como no relatório.
 */
const CONTRACTS: MemoryDeliveryContract[] = [
  { clientId: CLIENT_A, referenceMonth: AGO, contentType: 'arte', quantity: 4 },
  { clientId: CLIENT_A, referenceMonth: SET, contentType: 'video', quantity: 2 },
  { clientId: CLIENT_A, referenceMonth: SET, contentType: 'arte', quantity: 4 },
  { clientId: CLIENT_B, referenceMonth: AGO, contentType: 'arte', quantity: 2 },
  { clientId: CLIENT_B, referenceMonth: SET, contentType: 'foto', quantity: 2 },
];
const ITEMS: MemoryDeliveryItem[] = [
  item(CLIENT_A, AGO, 'arte', true, '2026-08-05'),
  item(CLIENT_A, AGO, 'arte', true, '2026-08-12'),
  item(CLIENT_A, AGO, 'arte', true, '2026-08-19'),
  item(CLIENT_A, AGO, 'arte', true, '2026-09-01'),
  item(CLIENT_A, SET, 'video', true, '2026-09-03'),
  item(CLIENT_A, SET, 'video', false, '2026-09-25'),
  item(CLIENT_A, SET, 'arte', true, '2026-09-10'),
  item(CLIENT_A, SET, 'arte', false, null),
  item(CLIENT_A, SET, 'foto', true, '2026-09-11', true),
  item(CLIENT_B, AGO, 'arte', true, '2026-08-20'),
  item(CLIENT_B, SET, 'foto', true, '2026-09-15'),
  item(CLIENT_B, SET, 'foto', true, '2026-09-16'),
];

const CATALOG = new MemoryDeliveryCatalog({
  clients: [
    { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_A2, name: 'Rebrota', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_HUB, name: 'Cliente HUB', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes' },
  ],
  contracts: CONTRACTS,
  items: ITEMS,
  opened: [
    { clientId: CLIENT_A, referenceMonth: AGO },
    { clientId: CLIENT_A, referenceMonth: SET },
    { clientId: CLIENT_HUB, referenceMonth: AGO },
    { clientId: CLIENT_HUB, referenceMonth: SET },
    { clientId: CLIENT_B, referenceMonth: AGO },
    { clientId: CLIENT_B, referenceMonth: SET },
  ],
  contentContractClientIds: [CLIENT_A, CLIENT_B],
});

const COMPANIES = [
  { id: COMPANY_A, name: 'Agência Ide' },
  { id: COMPANY_B, name: 'Ide Filmes' },
];

function grant(partial: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: 'grant-entrega',
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

function ctxFor(
  g: IntegrationGrant = grant(),
  person: PersonAccess = SUPER,
  delivery: DeliveryCatalog = CATALOG,
  now: Date = AGORA,
): ReportCtx {
  return {
    grant: g,
    person,
    origin: 'http',
    companies: COMPANIES,
    displayName: 'Wesley Lourenço',
    delivery,
    now,
  };
}

function lastDay(first: string): string {
  const d = new Date(`${first}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

/** O relatório de UM mês — a referência contra a qual a série é conferida. */
async function reportOfMonth(first: string, ctx: ReportCtx = ctxFor()) {
  const page = await getDeliveryReport(ctx, { from: first, to: lastDay(first) });
  if (!page.ok) throw new Error(page.message);
  return page.body;
}

describe('cada mês da série é o get_delivery_report daquele mês', () => {
  it('get_client_delivery_history: delivery e inPeriod idênticos ao relatório de cada mês', async () => {
    const history = await getClientDeliveryHistory(ctxFor(), { clientId: CLIENT_A, from: '2026-07', to: '2026-09' });
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.body.months.map((row) => row.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    for (const [i, first] of [JUL, AGO, SET].entries()) {
      const report = await reportOfMonth(first);
      const linha = report.clients.find((client) => client.id === CLIENT_A);
      expect(history.body.months[i]?.delivery).toEqual(linha?.delivery);
      expect(history.body.months[i]?.inPeriod).toEqual(linha?.inPeriod);
    }
    // A massa tem forma: 100% em agosto, e setembro com bônus da foto fora do contrato.
    const [, agosto, setembro] = history.body.months;
    expect(agosto?.delivery.measurable && agosto.delivery.level).toBe(100);
    expect(agosto?.inPeriod).toEqual({ scheduled: 3, completed: 3 });
    expect(setembro?.delivery.measurable).toBe(true);
    if (setembro?.delivery.measurable) {
      expect(setembro.delivery.breakdown.map((line) => line.contentType)).toEqual(['video', 'arte', 'foto']);
      expect(setembro.delivery.bonus).toBeGreaterThan(0);
    }
    // O item de agosto agendado em 01/09 conta na produção datada de setembro.
    expect(setembro?.inPeriod).toEqual({ scheduled: 5, completed: 4 });
  });

  it('get_delivery_trend: o nível de cada cliente em cada mês bate com o relatório daquele mês', async () => {
    const trend = await getDeliveryTrend(ctxFor(), { from: '2026-07', to: '2026-09' });
    expect(trend.ok).toBe(true);
    if (!trend.ok) return;
    expect(trend.body.months).toEqual(['2026-07', '2026-08', '2026-09']);
    for (const [i, first] of [JUL, AGO, SET].entries()) {
      const report = await reportOfMonth(first);
      expect(trend.body.clients.map((client) => client.id)).toEqual(report.clients.map((client) => client.id));
      for (const client of report.clients) {
        const serie = trend.body.clients.find((row) => row.id === client.id);
        const esperado = client.delivery.measurable ? client.delivery.level : client.delivery.reason;
        expect(serie?.levels[i]).toBe(esperado);
      }
      expect(trend.body.summary[i]).toEqual({
        month: first.slice(0, 7),
        clients: report.summary.clients,
        measurable: report.summary.measurable,
        unmeasurable: report.summary.unmeasurable,
        averageLevel: report.summary.averageLevel,
      });
    }
  });

  it('change é o penúltimo → último mês quando os dois são mensuráveis, e nulo quando não', async () => {
    const trend = await getDeliveryTrend(ctxFor(), { from: '2026-08', to: '2026-09' });
    expect(trend.ok).toBe(true);
    if (!trend.ok) return;
    const jatoba = trend.body.clients.find((row) => row.id === CLIENT_A);
    const [agosto, setembro] = jatoba?.levels ?? [];
    expect(typeof agosto).toBe('number');
    expect(typeof setembro).toBe('number');
    expect(jatoba?.change).toBe((setembro as number) - (agosto as number));
    expect(trend.body.clients.find((row) => row.id === CLIENT_A2)?.change).toBeNull();
    expect(trend.body.clients.find((row) => row.id === CLIENT_HUB)?.change).toBeNull();

    const umMes = await getDeliveryTrend(ctxFor(), { from: '2026-09', to: '2026-09' });
    expect(umMes.ok && umMes.body.clients.every((row) => row.change === null)).toBe(true);
  });
});

describe('não mensurável continua não mensurável', () => {
  it('mês não aberto não vira 0%: motivo no lugar do número', async () => {
    const history = await getClientDeliveryHistory(ctxFor(), { clientId: CLIENT_A2, from: '2026-07', to: '2026-09' });
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    for (const row of history.body.months) {
      expect(row.delivery.measurable).toBe(false);
      if (!row.delivery.measurable) {
        expect(row.delivery.reason).toBe('no_contract');
        expect(row.delivery.message).toContain('ainda não foi aberto');
      }
    }
    expect(JSON.stringify(history.body)).not.toContain('"level":0');

    const trend = await getDeliveryTrend(ctxFor(), { from: '2026-07', to: '2026-09' });
    expect(trend.ok).toBe(true);
    if (!trend.ok) return;
    expect(trend.body.clients.find((row) => row.id === CLIENT_A2)?.levels).toEqual([
      'no_contract',
      'no_contract',
      'no_contract',
    ]);
    expect(trend.body.clients.find((row) => row.id === CLIENT_HUB)?.levels).toEqual([
      'no_contract',
      'no_content_contract',
      'no_content_contract',
    ]);
    expect(trend.body.clients.find((row) => row.id === CLIENT_A)?.levels[0]).toBe('no_contract');
    // A média do mês ignora quem não é mensurável, como no relatório.
    expect(trend.body.summary[0]).toEqual({
      month: '2026-07',
      clients: 4,
      measurable: 0,
      unmeasurable: 4,
      averageLevel: null,
    });
  });
});

describe('intervalo em meses: padrão, limites e formato', () => {
  it('sem from/to: os 6 meses que terminam no mês atual da agência, não o do UTC', () => {
    const virada = new Date('2026-09-01T02:00:00.000Z'); // ainda 31/08 em São Paulo
    const period = resolveDeliverySeries({}, virada, { max: 24, tooLarge: () => 'x' });
    expect(period.ok).toBe(true);
    if (!period.ok) return;
    expect(DELIVERY_SERIES_DEFAULT_MONTHS).toBe(6);
    expect(period.currentMonth).toBe('2026-08');
    expect(period.effective).toEqual({ from: '2026-03', to: '2026-08' });
    expect(period.months).toEqual([
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
    ]);
    expect(period.bounds).toEqual({ from: '2026-03-01', to: '2026-08-31' });
  });

  it('só to: 6 meses terminando nele, atravessando o ano', () => {
    const period = resolveDeliverySeries({ to: '2026-02' }, AGORA, { max: 24, tooLarge: () => 'x' });
    expect(period.ok && period.effective).toEqual({ from: '2025-09', to: '2026-02' });
  });

  it(`um cliente: ${DELIVERY_HISTORY_MAX_MONTHS} meses passam, 25 são recusados com o limite na frase`, async () => {
    expect(DELIVERY_HISTORY_MAX_MONTHS).toBe(MAX_MESES_NO_INTERVALO);
    const cabe = await getClientDeliveryHistory(ctxFor(), { clientId: CLIENT_A, from: '2024-10', to: '2026-09' });
    expect(cabe.ok).toBe(true);
    if (cabe.ok) expect(cabe.body.months).toHaveLength(24);

    const grande = await getClientDeliveryHistory(ctxFor(), { clientId: CLIENT_A, from: '2024-09', to: '2026-09' });
    expect(grande).toEqual({
      ok: false,
      code: 'limit_exceeded',
      message: 'Intervalo grande demais: no máximo 24 meses por vez para um cliente (pedido: 25).',
    });
  });

  it(`todos: ${DELIVERY_TREND_MAX_MONTHS} meses passam, 7 são recusados com o limite e a saída na frase`, async () => {
    const cabe = await getDeliveryTrend(ctxFor(), { from: '2026-04', to: '2026-09' });
    expect(cabe.ok).toBe(true);
    const grande = await getDeliveryTrend(ctxFor(), { from: '2026-03', to: '2026-09' });
    expect(grande.ok).toBe(false);
    if (grande.ok) return;
    expect(grande.code).toBe('limit_exceeded');
    expect(grande.message).toContain('no máximo 6 meses');
    expect(grande.message).toContain('(pedido: 7)');
    expect(grande.message).toContain('get_client_delivery_history');
  });

  it('intervalo invertido é invalid_input com frase; mês fora do formato é recusado no contrato', async () => {
    const invertido = await getDeliveryTrend(ctxFor(), { from: '2026-09', to: '2026-08' });
    expect(invertido).toEqual({
      ok: false,
      code: 'invalid_input',
      message: 'Intervalo invertido: "2026-09" vem depois de "2026-08".',
    });
    expect(getDeliveryTrendInputSchema.safeParse({ from: '2026-8' }).success).toBe(false);
    expect(getDeliveryTrendInputSchema.safeParse({ from: '2026-13' }).success).toBe(false);
    expect(getDeliveryTrendInputSchema.safeParse({ from: '2026-08-01' }).success).toBe(false);
    expect(getDeliveryTrendInputSchema.safeParse({ from: '2026-08', months: 3 }).success).toBe(false);
    expect(getClientDeliveryHistoryInputSchema.safeParse({ from: '2026-08' }).success).toBe(false);
    const direto = await getDeliveryTrend(ctxFor(), { from: '2026-8' });
    expect(direto.ok === false && direto.code).toBe('invalid_input');
  });
});

describe('orçamento de 64 KiB', () => {
  it('get_delivery_trend com 99 clientes × 6 meses cabe, com nomes longos e motivos em todo mês', async () => {
    const meses = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
    const clients = Array.from({ length: 99 }, (_, i) => ({
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      name: `Cliente de nome bem comprido para pesar no orçamento número ${String(i).padStart(2, '0')}`,
      companyId: COMPANY_A,
      companyName: 'Agência Ide — unidade de nome comprido',
    }));
    // Metade mensurável (nível de três dígitos), metade no motivo mais longo.
    const mensuraveis = clients.filter((_, i) => i % 2 === 0);
    const catalog = new MemoryDeliveryCatalog({
      clients,
      contracts: mensuraveis.flatMap((client) =>
        meses.map((mes) => ({ clientId: client.id, referenceMonth: mes, contentType: 'arte', quantity: 1 })),
      ),
      items: mensuraveis.flatMap((client) =>
        meses.flatMap((mes) => [
          item(client.id, mes, 'arte', true, `${mes.slice(0, 8)}10`),
          item(client.id, mes, 'video', true, `${mes.slice(0, 8)}11`, true),
        ]),
      ),
      opened: clients.flatMap((client) => meses.map((mes) => ({ clientId: client.id, referenceMonth: mes }))),
      contentContractClientIds: mensuraveis.map((client) => client.id),
    });
    const trend = await getDeliveryTrend(ctxFor(grant(), SUPER, catalog), { from: '2026-04', to: '2026-09' });
    expect(trend.ok).toBe(true);
    if (!trend.ok) return;
    expect(trend.body.clients).toHaveLength(99);
    expect(trend.body.clients[1]?.levels).toEqual(Array(6).fill('no_content_contract'));
    expect(trend.body.clients[0]?.levels).toEqual(Array(6).fill(400));
    const bytes = measureJsonBytes(trend.body);
    expect(bytes).toBeLessThan(RESPONSE_BUDGET_BYTES);
    // Folga: mesmo com nomes de 70 caracteres, ~33 KB — abaixo de 3/4 do orçamento.
    expect(bytes).toBeLessThan(RESPONSE_BUDGET_BYTES * 0.75);
  });

  it('get_client_delivery_history com 24 meses e os quatro tipos em todo mês cabe', async () => {
    const meses = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 9 + i, 1));
      return d.toISOString().slice(0, 10);
    });
    const catalog = new MemoryDeliveryCatalog({
      clients: [{ id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' }],
      contracts: meses.flatMap((mes) =>
        (['video', 'arte', 'foto', 'ads'] as const).map((tipo) => ({
          clientId: CLIENT_A,
          referenceMonth: mes,
          contentType: tipo,
          quantity: 3,
        })),
      ),
      items: meses.flatMap((mes) =>
        (['video', 'arte', 'foto', 'ads'] as const).map((tipo) => item(CLIENT_A, mes, tipo, true, null)),
      ),
      opened: meses.map((mes) => ({ clientId: CLIENT_A, referenceMonth: mes })),
      contentContractClientIds: [CLIENT_A],
    });
    const history = await getClientDeliveryHistory(ctxFor(grant(), SUPER, catalog), {
      clientId: CLIENT_A,
      from: '2024-10',
      to: '2026-09',
    });
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.body.months).toHaveLength(24);
    expect(measureJsonBytes(history.body)).toBeLessThan(RESPONSE_BUDGET_BYTES);
  });
});

describe('recorte da concessão, igual ao do relatório', () => {
  it('concessão recortada por empresa: trend só com o recorte, cobertura parcial, sem vazar a outra empresa', async () => {
    const g = grant({ allowedCompanyIds: [COMPANY_A] });
    const trend = await getDeliveryTrend(ctxFor(g, ADMIN), { from: '2026-08', to: '2026-09' });
    expect(trend.ok).toBe(true);
    if (!trend.ok) return;
    expect(trend.body.coverage.kind).toBe('partial');
    expect(trend.body.coverage.reason).toMatch(/concessão recorta/);
    expect(trend.body.clients.map((row) => row.id).sort()).toEqual([CLIENT_A, CLIENT_A2, CLIENT_HUB].sort());
    expect(JSON.stringify(trend.body)).not.toContain('Cliente Filmes');
    expect(JSON.stringify(trend.body)).not.toContain(CLIENT_B);
    // E coincide com o relatório recortado do mesmo mês.
    const report = await reportOfMonth(SET, ctxFor(g, ADMIN));
    expect(trend.body.summary[1]?.averageLevel).toBe(report.summary.averageLevel);
  });

  it('super sem recorte marca cobertura full', async () => {
    const trend = await getDeliveryTrend(ctxFor(), { from: '2026-09', to: '2026-09' });
    expect(trend.ok && trend.body.coverage).toEqual({ kind: 'full' });
  });

  it('cliente fora do recorte e cliente inexistente dão a MESMA recusa', async () => {
    const g = grant({ allowedCompanyIds: [COMPANY_A] });
    const fora = await getClientDeliveryHistory(ctxFor(g, ADMIN), { clientId: CLIENT_B });
    const inexistente = await getClientDeliveryHistory(ctxFor(g, ADMIN), { clientId: 'cliente-que-nao-existe' });
    const esperado = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };
    expect(fora).toEqual(esperado);
    expect(inexistente).toEqual(esperado);

    const porCliente = await getClientDeliveryHistory(ctxFor(grant({ allowedClientIds: [CLIENT_A] }), ADMIN), {
      clientId: CLIENT_A2,
    });
    expect(porCliente).toEqual(esperado);
    const dentro = await getClientDeliveryHistory(ctxFor(grant({ allowedClientIds: [CLIENT_A] }), ADMIN), {
      clientId: CLIENT_A,
    });
    expect(dentro.ok && dentro.body.coverage.kind).toBe('partial');
  });

  it('sem reports:delivery:read: permission_denied nas duas', async () => {
    const g = grant({ capabilities: ['clients:read'] });
    const esperado = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };
    expect(await getClientDeliveryHistory(ctxFor(g), { clientId: CLIENT_A })).toEqual(esperado);
    expect(await getDeliveryTrend(ctxFor(g), {})).toEqual(esperado);
  });
});

describe('a leitura só pede o que foi pedido', () => {
  function espiao() {
    const chamadas: Array<{ scope: WorkScope; period: DeliveryPeriodQuery }> = [];
    const catalog: DeliveryCatalog = {
      load: (scope, period) => CATALOG.load(scope, period),
      loadCalendar: (scope, period) => CATALOG.loadCalendar(scope, period),
      loadPlanning: (scope, month) => CATALOG.loadPlanning(scope, month),
      loadDeliveryStatus: (scope, now) => CATALOG.loadDeliveryStatus(scope, now),
      loadMonthly: (scope, period) => {
        chamadas.push({ scope, period });
        return CATALOG.loadMonthly(scope, period);
      },
    };
    return { catalog, chamadas };
  }

  it('um cliente: UMA leitura, estreitada ao cliente, com exatamente os meses pedidos', async () => {
    const { catalog, chamadas } = espiao();
    const history = await getClientDeliveryHistory(ctxFor(grant(), SUPER, catalog), {
      clientId: CLIENT_A,
      from: '2026-08',
      to: '2026-09',
    });
    expect(history.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    const [chamada] = chamadas;
    expect(chamada?.scope.clients).toEqual(new Set([CLIENT_A]));
    expect(chamada?.period).toEqual({ from: '2026-08-01', to: '2026-09-30', months: [AGO, SET] });
  });

  it('cliente fora do recorte nem chega ao catálogo; limite estourado também não', async () => {
    const { catalog, chamadas } = espiao();
    await getClientDeliveryHistory(ctxFor(grant({ allowedClientIds: [CLIENT_A] }), ADMIN, catalog), {
      clientId: CLIENT_B,
    });
    await getDeliveryTrend(ctxFor(grant(), SUPER, catalog), { from: '2020-01', to: '2026-09' });
    expect(chamadas).toHaveLength(0);
  });

  it('todos: UMA leitura para os seis meses, com o recorte da concessão', async () => {
    const { catalog, chamadas } = espiao();
    await getDeliveryTrend(ctxFor(grant({ allowedCompanyIds: [COMPANY_A] }), ADMIN, catalog), {
      from: '2026-04',
      to: '2026-09',
    });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.period.months).toHaveLength(6);
    expect(chamadas[0]?.scope.companies).toEqual({ kind: 'ids', ids: new Set([COMPANY_A]) });
  });

  it('SqlDeliveryCatalog.loadMonthly: escopo vazio e id que não é UUID respondem vazio sem falar com o banco', async () => {
    const catalog = new SqlDeliveryCatalog({} as never, { kind: 'preauth' });
    const period = { from: '2026-09-01', to: '2026-09-30', months: [SET] };
    const vazio = await catalog.loadMonthly(
      { companies: { kind: 'none' }, clients: 'none', capabilities: new Set(['reports:delivery:read']) },
      period,
    );
    expect(vazio.clients).toEqual([]);
    const naoUuid = await catalog.loadMonthly(
      { companies: { kind: 'all' }, clients: new Set(['cliente-x']), capabilities: new Set(['reports:delivery:read']) },
      period,
    );
    expect(naoUuid.clients).toEqual([]);
    expect(naoUuid.contracts).toEqual([]);
  });

  it('tipo de conteúdo desconhecido é data_incomplete, como no relatório', async () => {
    const catalog = new MemoryDeliveryCatalog({
      clients: [{ id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' }],
      contracts: [{ clientId: CLIENT_A, referenceMonth: SET, contentType: 'reels', quantity: 1 }],
      opened: [{ clientId: CLIENT_A, referenceMonth: SET }],
    });
    const history = await getClientDeliveryHistory(ctxFor(grant(), SUPER, catalog), { clientId: CLIENT_A });
    expect(history.ok === false && history.code).toBe('data_incomplete');
  });
});

describe('contrato, OpenAPI, HTTP e MCP', () => {
  const memoryCatalog = new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']]));

  it('OpenAPI publica as duas rotas (GET e POST) com schemas iguais ao Zod e exemplos válidos', () => {
    const doc = integrationOpenApi() as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    for (const path of ['/get_client_delivery_history', '/get_delivery_trend']) {
      expect(Object.keys(doc.paths[path] ?? {}).sort()).toEqual(['get', 'post']);
    }
    expect(doc.components.schemas.GetClientDeliveryHistoryResponse).toEqual(
      jsonSchemaFromZod(getClientDeliveryHistoryResponseSchema),
    );
    expect(doc.components.schemas.GetClientDeliveryHistoryInput).toEqual(
      jsonSchemaFromZod(getClientDeliveryHistoryInputSchema),
    );
    expect(doc.components.schemas.GetDeliveryTrendResponse).toEqual(jsonSchemaFromZod(getDeliveryTrendResponseSchema));
    expect(doc.components.schemas.GetDeliveryTrendInput).toEqual(jsonSchemaFromZod(getDeliveryTrendInputSchema));
    const history = getClientDeliveryHistoryResponseSchema.parse(getClientDeliveryHistoryOpenApiExample());
    expect(history.months.some((row) => row.delivery.measurable === false)).toBe(true);
    const trend = getDeliveryTrendResponseSchema.parse(getDeliveryTrendOpenApiExample());
    expect(trend.clients.every((row) => row.levels.length === trend.months.length)).toBe(true);
  });

  it('HTTP GET com query devolve o mesmo corpo da operação, e 400 com o limite', async () => {
    const response = await dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${GET_CLIENT_DELIVERY_HISTORY_PATH}?clientId=${CLIENT_A}&from=2026-08&to=2026-09`),
      grant: grant(),
      person: SUPER,
      origin: 'http',
      catalog: memoryCatalog,
      delivery: CATALOG,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const body = getClientDeliveryHistoryResponseSchema.parse(await response.json());
    const direto = await getClientDeliveryHistory(ctxFor(), { clientId: CLIENT_A, from: '2026-08', to: '2026-09' });
    expect(direto.ok && direto.body).toEqual(body);
    expect(body.self).toBe(`${GET_CLIENT_DELIVERY_HISTORY_PATH}?clientId=${CLIENT_A}&from=2026-08&to=2026-09`);
    expect(body.period).toEqual({
      requested: { from: '2026-08', to: '2026-09' },
      effective: { from: '2026-08', to: '2026-09' },
      currentMonth: '2026-09',
      timezone: AGENCY_TIMEZONE,
    });

    const grande = await dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${GET_DELIVERY_TREND_PATH}?from=2026-01&to=2026-09`),
      grant: grant(),
      person: SUPER,
      origin: 'http',
      catalog: memoryCatalog,
      delivery: CATALOG,
      now: AGORA,
    });
    expect(grande.status).toBe(400);
    const erro = (await grande.json()) as { error: string; message: string };
    expect(erro.error).toBe('limit_exceeded');
    expect(erro.message).toContain('6 meses');

    const post = await dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${GET_DELIVERY_TREND_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '2026-08', to: '2026-09' }),
      }),
      grant: grant(),
      person: SUPER,
      origin: 'http',
      catalog: memoryCatalog,
      delivery: CATALOG,
      now: AGORA,
    });
    expect(post.status).toBe(200);
    expect(getDeliveryTrendResponseSchema.parse(await post.json()).months).toEqual(['2026-08', '2026-09']);
  });

  it('HTTP sem a permissão devolve 403', async () => {
    const response = await dispatchIntegrationHttp({
      request: new Request(`${ORIGIN}${GET_DELIVERY_TREND_PATH}`),
      grant: grant({ capabilities: ['boards:read'] }),
      person: SUPER,
      origin: 'http',
      catalog: memoryCatalog,
      delivery: CATALOG,
      now: AGORA,
    });
    expect(response.status).toBe(403);
  });

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

  async function callTool(name: string, args: unknown) {
    const response = await handleMcpRequest({
      request: mcpPost('tools/call', { name, arguments: args }),
      grant: grant(),
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

  it('MCP: as duas ferramentas respondem o mesmo corpo da operação, com resumo legível', async () => {
    const history = await callTool('get_client_delivery_history', { clientId: CLIENT_A, from: '2026-08', to: '2026-09' });
    expect(history.isError).toBeUndefined();
    const direto = await getClientDeliveryHistory(ctxFor(), { clientId: CLIENT_A, from: '2026-08', to: '2026-09' });
    expect(direto.ok && direto.body).toEqual(history.structuredContent);
    expect(history.content[0]?.text).toContain('Jatobá · 2026-08 100%');

    const trend = await callTool('get_delivery_trend', { from: '2026-08', to: '2026-09' });
    expect(trend.isError).toBeUndefined();
    expect(trend.content[0]?.text).toContain('tendência 2026-08–2026-09');
    expect(trend.content[0]?.text).toContain('maiores quedas no último mês: Jatobá');
  });

  it('MCP: campo desconhecido e limite estourado viram recusa com frase', async () => {
    const extra = await callTool('get_delivery_trend', { from: '2026-08', months: 3 });
    expect(extra.isError).toBe(true);
    // O SDK valida o schema antes do despacho; a frase do erro cita o campo.
    expect(extra.content[0]?.text).toMatch(/months|invalid_input|Unrecognized/);

    const grande = await callTool('get_client_delivery_history', { clientId: CLIENT_A, from: '2024-01', to: '2026-09' });
    expect(grande.isError).toBe(true);
    const payload = JSON.parse(grande.content[0]?.text ?? '{}') as { error: string; message: string };
    expect(payload.error).toBe('limit_exceeded');
    expect(payload.message).toContain('no máximo 24 meses');
  });
});

describe('F38, Fase 5 — cliente cancelado conta até o mês do cancelamento, inclusive', () => {
  const OUT = '2026-10-01';
  const ZECA = 'cliente-zeca';
  const ANTIGO = 'cliente-antigo';
  const SEM_DATA = 'cliente-sem-data';

  /**
   * A massa da série mais três cancelados. Zeca cancela em 15/09: tem contrato
   * e peças em agosto, setembro e outubro (a de outubro é sobra no banco, não
   * pode contar). Antigo cancelou em junho e não tem nada em agosto. Sem data é
   * `is_active = false` sem `inactive_at`.
   */
  const dados = (cancelados: boolean) =>
    new MemoryDeliveryCatalog({
      clients: [
        { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' },
        { id: CLIENT_A2, name: 'Rebrota', companyId: COMPANY_A, companyName: 'Agência Ide' },
        { id: CLIENT_HUB, name: 'Cliente HUB', companyId: COMPANY_A, companyName: 'Agência Ide' },
        { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes' },
        {
          id: ZECA,
          name: 'Zeca',
          companyId: COMPANY_A,
          companyName: 'Agência Ide',
          ...(cancelados ? { isActive: false, cancelledOn: '2026-09-15' } : {}),
        },
        {
          id: ANTIGO,
          name: 'Antigo',
          companyId: COMPANY_A,
          companyName: 'Agência Ide',
          ...(cancelados ? { isActive: false, cancelledOn: '2026-06-30' } : {}),
        },
        {
          id: SEM_DATA,
          name: 'Sem Data',
          companyId: COMPANY_A,
          companyName: 'Agência Ide',
          ...(cancelados ? { isActive: false, cancelledOn: null } : {}),
        },
      ],
      contracts: [
        ...CONTRACTS,
        { clientId: ZECA, referenceMonth: AGO, contentType: 'arte', quantity: 2 },
        { clientId: ZECA, referenceMonth: SET, contentType: 'arte', quantity: 2 },
        { clientId: ZECA, referenceMonth: OUT, contentType: 'arte', quantity: 2 },
      ],
      items: [
        ...ITEMS,
        item(ZECA, AGO, 'arte', true, '2026-08-10'),
        item(ZECA, AGO, 'arte', false, '2026-08-20'),
        item(ZECA, SET, 'arte', true, '2026-09-05'),
        item(ZECA, SET, 'arte', true, '2026-09-12'),
        item(ZECA, OUT, 'arte', true, '2026-10-02'),
      ],
      opened: [
        { clientId: CLIENT_A, referenceMonth: AGO },
        { clientId: CLIENT_A, referenceMonth: SET },
        { clientId: CLIENT_HUB, referenceMonth: AGO },
        { clientId: CLIENT_HUB, referenceMonth: SET },
        { clientId: CLIENT_B, referenceMonth: AGO },
        { clientId: CLIENT_B, referenceMonth: SET },
        { clientId: ZECA, referenceMonth: AGO },
        { clientId: ZECA, referenceMonth: SET },
        { clientId: ZECA, referenceMonth: OUT },
      ],
      contentContractClientIds: [CLIENT_A, CLIENT_B, ZECA],
    });
  /** Depois da Fase 5. */
  const AGORA_CTX = ctxFor(grant(), SUPER, dados(true));
  /** "Antes": a mesma massa sem ninguém cancelado — o que o relatório contava até a Fase 4. */
  const ANTES_CTX = ctxFor(grant(), SUPER, dados(false));

  it('get_delivery_report: cancelado em setembro aparece em agosto e em setembro, e não aparece em outubro', async () => {
    const agosto = await reportOfMonth(AGO, AGORA_CTX);
    const setembro = await reportOfMonth(SET, AGORA_CTX);
    const outubro = await reportOfMonth(OUT, AGORA_CTX);
    expect(agosto.clients.map((c) => c.id)).toContain(ZECA);
    expect(setembro.clients.map((c) => c.id)).toContain(ZECA);
    expect(outubro.clients.map((c) => c.id)).not.toContain(ZECA);
    // Cancelado antes do mês e cancelado sem data não aparecem em mês nenhum.
    for (const relatorio of [agosto, setembro, outubro]) {
      expect(relatorio.clients.map((c) => c.id)).not.toContain(ANTIGO);
      expect(relatorio.clients.map((c) => c.id)).not.toContain(SEM_DATA);
    }
    // A peça de outubro do Zeca (sobra no banco) não entra em lugar nenhum.
    const outubroAntes = await reportOfMonth(OUT, ANTES_CTX);
    expect(outubroAntes.summary.inPeriod.scheduled - outubro.summary.inPeriod.scheduled).toBe(1);
    // Os meses do Zeca na carteira são os de antes, sem mudança.
    const agostoAntes = await reportOfMonth(AGO, ANTES_CTX);
    const setembroAntes = await reportOfMonth(SET, ANTES_CTX);
    expect(agosto.clients.find((c) => c.id === ZECA)).toEqual(agostoAntes.clients.find((c) => c.id === ZECA));
    expect(setembro.clients.find((c) => c.id === ZECA)).toEqual(setembroAntes.clients.find((c) => c.id === ZECA));
  });

  it('período de vários meses: o cancelado entra só com o que é dos meses dele', async () => {
    const tudo = await getDeliveryReport(AGORA_CTX, { from: AGO, to: '2026-10-31' });
    const ateSetembro = await getDeliveryReport(ANTES_CTX, { from: AGO, to: '2026-09-30' });
    expect(tudo.ok && ateSetembro.ok).toBe(true);
    if (!tudo.ok || !ateSetembro.ok) return;
    const zeca = tudo.body.clients.find((c) => c.id === ZECA);
    expect(zeca).toEqual(ateSetembro.body.clients.find((c) => c.id === ZECA));
    const deOutubro = await getDeliveryReport(AGORA_CTX, { from: OUT, to: '2026-10-31' });
    expect(deOutubro.ok && deOutubro.body.clients.some((c) => c.id === ZECA)).toBe(false);
  });

  it('get_delivery_trend: a média de agosto continua igual à de antes; outubro sai sem o cancelado, que aparece como "cancelled"', async () => {
    const depois = await getDeliveryTrend(AGORA_CTX, { from: '2026-08', to: '2026-10' });
    const antes = await getDeliveryTrend(ANTES_CTX, { from: '2026-08', to: '2026-10' });
    expect(depois.ok && antes.ok).toBe(true);
    if (!depois.ok || !antes.ok) return;

    const [agoDepois, setDepois, outDepois] = depois.body.summary;
    const [agoAntes, setAntes, outAntes] = antes.body.summary;
    expect(agoDepois?.averageLevel).toBe(agoAntes?.averageLevel);
    expect(agoDepois?.measurable).toBe(agoAntes?.measurable);
    expect(setDepois?.averageLevel).toBe(setAntes?.averageLevel);
    // Antigo e Sem Data saem de todos os meses; o Zeca, só de outubro.
    expect(agoDepois?.clients).toBe((agoAntes?.clients ?? 0) - 2);
    expect(outDepois?.clients).toBe((outAntes?.clients ?? 0) - 3);
    expect(outDepois?.measurable).toBe((outAntes?.measurable ?? 0) - 1);

    const zeca = depois.body.clients.find((row) => row.id === ZECA);
    const zecaAntes = antes.body.clients.find((row) => row.id === ZECA);
    expect(zeca?.levels.slice(0, 2)).toEqual(zecaAntes?.levels.slice(0, 2));
    expect(typeof zeca?.levels[0]).toBe('number');
    expect(zeca?.levels[2]).toBe('cancelled');
    expect(zeca?.change).toBeNull();
    expect(depois.body.clients.map((row) => row.id)).not.toContain(ANTIGO);
    expect(depois.body.clients.map((row) => row.id)).not.toContain(SEM_DATA);
    // Nenhum outro cliente mudou.
    for (const row of depois.body.clients.filter((r) => r.id !== ZECA)) {
      expect(row).toEqual(antes.body.clients.find((r) => r.id === row.id));
    }
  });

  it('get_client_delivery_history: meses do cancelado iguais aos de antes até o cancelamento; depois, "cancelled" com o dia', async () => {
    const zeca = await getClientDeliveryHistory(AGORA_CTX, { clientId: ZECA, from: '2026-08', to: '2026-10' });
    const zecaAntes = await getClientDeliveryHistory(ANTES_CTX, { clientId: ZECA, from: '2026-08', to: '2026-10' });
    expect(zeca.ok && zecaAntes.ok).toBe(true);
    if (!zeca.ok || !zecaAntes.ok) return;
    expect(zeca.body.months.slice(0, 2)).toEqual(zecaAntes.body.months.slice(0, 2));
    expect(zeca.body.months[2]).toEqual({
      month: '2026-10',
      inPeriod: { scheduled: 0, completed: 0 },
      delivery: expect.objectContaining({
        measurable: false,
        reason: 'cancelled',
        cancelledOn: '2026-09-15',
        message: 'Cliente cancelado em 15/09/2026: fora da carteira a partir do mês seguinte.',
      }),
    });
    expect(getClientDeliveryHistoryResponseSchema.safeParse(zeca.body).success).toBe(true);

    // Cancelado antes do intervalo inteiro: todos os meses "cancelled", não recusa.
    const antigo = await getClientDeliveryHistory(AGORA_CTX, { clientId: ANTIGO, from: '2026-08', to: '2026-10' });
    expect(antigo.ok).toBe(true);
    if (!antigo.ok) return;
    expect(antigo.body.months.map((row) => row.delivery.measurable === false && row.delivery.reason)).toEqual([
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
  });
});
