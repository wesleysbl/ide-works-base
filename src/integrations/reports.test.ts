/**
 * Relatório de entrega — F16.4a.
 *
 * Massa conhecida bate com `calculateDeliveryLevel` nos mesmos itens.
 * Concessão parcial agrega só o recorte, marca coverage.partial e não
 * vaza cliente de outra empresa. OpenAPI = mesmo Zod.
 */

import { describe, expect, it } from 'vitest';

import { calculateDeliveryLevel, type ContractItem, type DeliveredItem } from '@/delivery/level';
import {
  GET_DELIVERY_REPORT_PATH,
  getDeliveryReportOpenApiExample,
  getDeliveryReportResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import {
  MemoryDeliveryCatalog,
  SqlDeliveryCatalog,
  getDeliveryReport,
  resolveDeliveryPeriod,
  summarizeDelivery,
  type ReportCtx,
} from '@/integrations/reports';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import { MAX_MESES_NO_INTERVALO } from '@/server/panel';
import { resumirCarteira, type ClienteDoPainel } from '@/painel/carteira';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_A2 = 'cliente-rebrota';
const CLIENT_HUB = 'cliente-hub';
const CLIENT_B = 'cliente-filmes';
const CLIENT_C = 'cliente-global';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const AGORA = new Date('2026-09-21T04:00:00.000Z');
const MES = '2026-09-01';
const FROM = '2026-09-01';
const TO = '2026-09-30';

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

const JATOBA_CONTRACT: ContractItem[] = [
  { contentType: 'video', quantity: 2 },
  { contentType: 'arte', quantity: 4 },
];
const JATOBA_DELIVERED: DeliveredItem[] = [
  { contentType: 'video', isExtra: false, isCompleted: true },
  { contentType: 'video', isExtra: false, isCompleted: true },
  { contentType: 'arte', isExtra: false, isCompleted: true },
  { contentType: 'arte', isExtra: false, isCompleted: true },
  { contentType: 'arte', isExtra: false, isCompleted: true },
  { contentType: 'arte', isExtra: false, isCompleted: true },
];
const FILMES_CONTRACT: ContractItem[] = [{ contentType: 'arte', quantity: 2 }];
const FILMES_DELIVERED: DeliveredItem[] = [
  { contentType: 'arte', isExtra: false, isCompleted: true },
];

const CATALOG = new MemoryDeliveryCatalog({
  clients: [
    { id: CLIENT_A, name: 'Jatobá', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_A2, name: 'Rebrota', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_HUB, name: 'Cliente HUB', companyId: COMPANY_A, companyName: 'Agência Ide' },
    { id: CLIENT_B, name: 'Cliente Filmes', companyId: COMPANY_B, companyName: 'Ide Filmes' },
    { id: CLIENT_C, name: 'Carteira global', companyId: COMPANY_C, companyName: 'Fora do recorte' },
  ],
  contracts: [
    ...JATOBA_CONTRACT.map((item) => ({ clientId: CLIENT_A, referenceMonth: MES, ...item })),
    ...FILMES_CONTRACT.map((item) => ({ clientId: CLIENT_B, referenceMonth: MES, ...item })),
    { clientId: CLIENT_C, referenceMonth: MES, contentType: 'video', quantity: 1 },
  ],
  items: [
    ...JATOBA_DELIVERED.map((item, index) => ({
      clientId: CLIENT_A,
      referenceMonth: MES,
      scheduledOn: index < 3 ? '2026-09-10' : null,
      ...item,
    })),
    {
      clientId: CLIENT_B,
      referenceMonth: MES,
      scheduledOn: '2026-09-15',
      ...FILMES_DELIVERED[0],
    },
    {
      clientId: CLIENT_C,
      referenceMonth: MES,
      scheduledOn: '2026-09-20',
      contentType: 'video',
      isExtra: false,
      isCompleted: true,
    },
  ],
  opened: [
    { clientId: CLIENT_A, referenceMonth: MES },
    { clientId: CLIENT_HUB, referenceMonth: MES },
    { clientId: CLIENT_B, referenceMonth: MES },
    { clientId: CLIENT_C, referenceMonth: MES },
  ],
  contentContractClientIds: [CLIENT_A, CLIENT_B, CLIENT_C],
});

function grant(partial: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: 'grant-entrega',
    ownerId: OWNER_ID,
    oauthClientId: 'claude',
    name: 'Claude da agência',
    capabilities: ['reports:delivery:read'],
    allowedCompanyIds: [COMPANY_A],
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
    ...partial,
  };
}

const COMPANIES = [
  { id: COMPANY_A, name: 'Agência Ide' },
  { id: COMPANY_B, name: 'Ide Filmes' },
  { id: COMPANY_C, name: 'Fora do recorte' },
];

function ctxFor(g: IntegrationGrant, person: PersonAccess = ADMIN): ReportCtx {
  return {
    grant: g,
    person,
    origin: 'http',
    companies: COMPANIES,
    displayName: 'Wesley Lourenço',
    delivery: CATALOG,
    now: AGORA,
  };
}

describe('get_delivery_report reusa calculateDeliveryLevel', () => {
  it('massa conhecida coincide com a fórmula direta nos mesmos itens', async () => {
    const direto = calculateDeliveryLevel(JATOBA_CONTRACT, JATOBA_DELIVERED, {
      monthOpened: true,
      hasContentContract: true,
    });
    const page = await getDeliveryReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const jatoba = page.body.clients.find((client) => client.id === CLIENT_A);
    expect(jatoba?.delivery).toEqual(direto);
    expect(direto.measurable).toBe(true);
    if (direto.measurable) expect(direto.level).toBe(100);
  });

  it('mês sem contrato mensurável não vira 0%', async () => {
    const page = await getDeliveryReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const rebrota = page.body.clients.find((client) => client.id === CLIENT_A2);
    const hub = page.body.clients.find((client) => client.id === CLIENT_HUB);
    expect(rebrota?.delivery).toEqual(
      calculateDeliveryLevel([], [], { monthOpened: false, hasContentContract: false }),
    );
    expect(hub?.delivery).toEqual(
      calculateDeliveryLevel([], [], { monthOpened: true, hasContentContract: false }),
    );
    expect(rebrota?.delivery.measurable).toBe(false);
    expect(hub?.delivery.measurable).toBe(false);
    if (rebrota && !rebrota.delivery.measurable) {
      expect(rebrota.delivery.reason).toBe('no_contract');
      expect(rebrota.delivery.message).toContain('ainda não foi aberto');
    }
    if (hub && !hub.delivery.measurable) {
      expect(hub.delivery.reason).toBe('no_content_contract');
    }
    expect(JSON.stringify(rebrota?.delivery)).not.toContain('"level":0');
    expect(page.body.summary.unmeasurable).toBe(2);
    expect(page.body.summary.averageLevel).toBe(100);
  });

  it('média ignora não mensurável como resumirCarteira', async () => {
    const page = await getDeliveryReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const carteira = page.body.clients.map(
      (client): ClienteDoPainel => ({
        id: client.id,
        name: client.name,
        categoryId: client.company.id,
        categoryName: client.company.name,
        categorySortOrder: 0,
        plan: null,
        urgency: 'paz',
        isActive: true,
        inactiveAt: null,
        financeOk: true,
        startedOn: '2026-01-01',
        renewsOn: null,
        tags: [],
        inPeriod: client.inPeriod,
        delivery: client.delivery,
        deliveryStatus: null,
      }),
    );
    const resumo = resumirCarteira(carteira);
    const summary = summarizeDelivery(page.body.clients);
    expect(summary.averageLevel).toBe(resumo.nivelMedio);
    expect(summary.measurable).toBe(resumo.mensuraveis);
    expect(summary.byType).toEqual(resumo.porTipo);
  });
});

describe('recorte antes de agregar', () => {
  it('admin com concessão parcial agrega só o recorte, marca partial e não vaza outra empresa', async () => {
    const page = await getDeliveryReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.coverage.kind).toBe('partial');
    expect(page.body.coverage.reason).toMatch(/concessão recorta/);
    expect(page.body.clients.map((client) => client.id).sort()).toEqual(
      [CLIENT_HUB, CLIENT_A, CLIENT_A2].sort(),
    );
    expect(JSON.stringify(page.body)).not.toContain('Cliente Filmes');
    expect(JSON.stringify(page.body)).not.toContain('Carteira global');
    expect(JSON.stringify(page.body)).not.toContain(CLIENT_B);
    expect(JSON.stringify(page.body)).not.toContain(CLIENT_C);
    expect(page.body.summary.clients).toBe(3);
    expect(page.body.summary.averageLevel).toBe(100);
    expect(page.body.summary.inPeriod).toEqual({ scheduled: 3, completed: 3 });
  });

  it('allowlist de cliente não inclui o outro cliente da mesma empresa', async () => {
    const page = await getDeliveryReport(ctxFor(grant({ allowedClientIds: [CLIENT_A] })), {
      from: FROM,
      to: TO,
    });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.coverage.kind).toBe('partial');
    expect(page.body.clients).toHaveLength(1);
    expect(page.body.clients[0]?.id).toBe(CLIENT_A);
    expect(JSON.stringify(page.body)).not.toContain('Rebrota');
    expect(JSON.stringify(page.body)).not.toContain('Cliente Filmes');
  });

  it('super sem allowlist cobre a carteira injetada e marca full', async () => {
    const page = await getDeliveryReport(
      ctxFor(grant({ allowedCompanyIds: null, allowedClientIds: null }), SUPER),
      { from: FROM, to: TO },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.coverage.kind).toBe('full');
    expect(page.body.coverage.reason).toBeUndefined();
    expect(page.body.clients.map((client) => client.id).sort()).toEqual(
      [CLIENT_HUB, CLIENT_B, CLIENT_C, CLIENT_A, CLIENT_A2].sort(),
    );
    const filmes = page.body.clients.find((client) => client.id === CLIENT_B)?.delivery;
    expect(filmes).toEqual(
      calculateDeliveryLevel(FILMES_CONTRACT, FILMES_DELIVERED, {
        monthOpened: true,
        hasContentContract: true,
      }),
    );
  });

  it('sem reports:delivery:read é permission_denied, não lista vazia', async () => {
    const denied = await getDeliveryReport(ctxFor(grant({ capabilities: ['clients:read'] })), {
      from: FROM,
      to: TO,
    });
    expect(denied).toEqual({
      ok: false,
      code: 'permission_denied',
      message: 'Fora do alcance desta integração.',
    });
  });
});

describe('período, fuso e teto de meses', () => {
  it('envelope traz queriedAt, self, recorte, período pedido/efetivo e fuso da agência', async () => {
    const page = await getDeliveryReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.operation).toBe('get_delivery_report');
    expect(page.body.queriedAt).toBe(AGORA.toISOString());
    expect(page.body.self).toBe(`${GET_DELIVERY_REPORT_PATH}?from=${FROM}&to=${TO}`);
    expect(page.body.effectiveScope.companies).toEqual([{ id: COMPANY_A, name: 'Agência Ide' }]);
    expect(page.body.period).toEqual({
      requested: { from: FROM, to: TO },
      effective: { from: FROM, to: TO },
      timezone: AGENCY_TIMEZONE,
    });
  });

  it('sem from/to usa o mês civil da agência, não o UTC', () => {
    const virada = new Date('2026-09-01T02:00:00.000Z');
    const resolved = resolveDeliveryPeriod({}, virada);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.requested).toEqual({ from: null, to: null });
    expect(resolved.effective).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(resolved.months).toEqual(['2026-08-01']);
  });

  it('intervalo acima do teto é recusado com código estável e informa o limite', async () => {
    const page = await getDeliveryReport(ctxFor(grant()), { from: '2020-01-01', to: '2030-01-01' });
    expect(page).toEqual({
      ok: false,
      code: 'limit_exceeded',
      message: `Intervalo grande demais: no máximo ${MAX_MESES_NO_INTERVALO} meses por vez.`,
    });
  });

  it('intervalo invertido é invalid_input, sem lista vazia', async () => {
    const page = await getDeliveryReport(ctxFor(grant()), { from: '2026-09-01', to: '2026-08-01' });
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.code).toBe('invalid_input');
    expect(page.message).toMatch(/invertido/);
  });
});

describe('OpenAPI e HTTP efetivo fecham o mesmo Zod', () => {
  it('documento, exemplo e resposta efetiva passam no schema', async () => {
    const doc = integrationOpenApi();
    const schema = (
      doc.components as { schemas: { GetDeliveryReportResponse: Record<string, unknown> } }
    ).schemas.GetDeliveryReportResponse;
    expect(schema).toEqual(jsonSchemaFromZod(getDeliveryReportResponseSchema));
    const example = getDeliveryReportResponseSchema.parse(getDeliveryReportOpenApiExample());
    expect(example.operation).toBe('get_delivery_report');
    expect(example.clients.some((client) => client.delivery.measurable === false)).toBe(true);

    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_DELIVERY_REPORT_PATH}?from=${FROM}&to=${TO}`),
      grant: grant(),
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      delivery: CATALOG,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const body = getDeliveryReportResponseSchema.parse(await response.json());
    expect(body.coverage.kind).toBe('partial');
    expect(body.clients.some((client) => client.id === CLIENT_A)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Cliente Filmes');
  });

  it('HTTP sem a capacidade devolve 403', async () => {
    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_DELIVERY_REPORT_PATH}?from=${FROM}&to=${TO}`),
      grant: grant({ capabilities: ['boards:read'] }),
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      delivery: CATALOG,
      now: AGORA,
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('permission_denied');
  });

  it('HTTP recusa intervalo grande com limit_exceeded e o teto na mensagem', async () => {
    const response = await dispatchIntegrationHttp({
      request: new Request(
        `https://ideworks.test${GET_DELIVERY_REPORT_PATH}?from=2020-01-01&to=2030-01-01`,
      ),
      grant: grant(),
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      delivery: CATALOG,
      now: AGORA,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('limit_exceeded');
    expect(body.message).toContain(String(MAX_MESES_NO_INTERVALO));
  });
});

describe('SqlDeliveryCatalog recorta no escopo vazio sem falar com o banco', () => {
  it('load vazio quando a concessão não tem empresa', async () => {
    const catalog = new SqlDeliveryCatalog({} as never, { kind: 'preauth' });
    const snapshot = await catalog.load(
      {
        companies: { kind: 'none' },
        clients: 'none',
        capabilities: new Set(['reports:delivery:read']),
      },
      { from: FROM, to: TO, months: [MES] },
    );
    expect(snapshot.clients).toEqual([]);
    expect(snapshot.contracts).toEqual([]);
    expect(snapshot.items).toEqual([]);
  });
});
