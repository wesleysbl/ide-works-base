/**
 * Relatório de marketing — F16.4b.
 *
 * Série com buraco ≠ zero. Alcance aproximado, não pessoas únicas.
 * Período enorme informa/recusa. collectedAt antigo ≠ queriedAt.
 * Admin com concessão parcial não vaza outra empresa. OpenAPI = mesmo Zod.
 */

import { describe, expect, it } from 'vitest';

import {
  GET_MARKETING_REPORT_PATH,
  getMarketingReportOpenApiExample,
  getMarketingReportResponseSchema,
  integrationOpenApi,
  jsonSchemaFromZod,
} from '@/integrations/contract';
import { MemoryCatalog } from '@/integrations/context';
import { type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { dispatchIntegrationHttp } from '@/integrations/http';
import {
  MemoryMarketingCatalog,
  SqlMarketingCatalog,
  asDistinct,
  getMarketingReport,
  resolveMarketingPeriod,
  type MarketingCtx,
  type MarketingPaidDay,
  type MarketingOrganicDay,
} from '@/integrations/marketing';
import { DISTINTAS, TETO_DE_DIAS, porDia, resumirPago, serie, serieDeDistinta } from '@/meta/relatorio';

const COMPANY_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const COMPANY_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_A = 'cliente-jatoba';
const CLIENT_B = 'cliente-filmes';
const CLIENT_C = 'cliente-global';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const AGORA = new Date('2026-09-21T04:00:00.000Z');
const FROM = '2026-09-01';
const TO = '2026-09-03';
const PAID_A = 'conta-anuncio-jatoba';
const PAID_B = 'conta-anuncio-filmes';
const PAID_C = 'conta-anuncio-global';
const ORG_A = 'conta-ig-jatoba';
const COLLECTED = '2026-08-01T12:00:00.000Z';

const ADMIN: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [COMPANY_A, COMPANY_B],
  clientIds: [CLIENT_A, CLIENT_B],
  hasAllClientsAccess: true,
};

const SUPER: PersonAccess = { ...ADMIN, isSuper: true };

const paidDay = (
  partial: Partial<MarketingPaidDay> & { day: string; assetId: string },
): MarketingPaidDay => ({
  campaignId: 'camp-1',
  campaignName: 'Campanha',
  spend: null,
  reach: null,
  impressions: null,
  clicks: null,
  linkClicks: null,
  conversions: null,
  conversionValue: null,
  collectedAt: COLLECTED,
  ...partial,
});

const orgDay = (
  partial: Partial<MarketingOrganicDay> & { day: string; assetId: string },
): MarketingOrganicDay => ({
  reach: null,
  views: null,
  accountsEngaged: null,
  totalInteractions: null,
  follows: null,
  unfollows: null,
  profileLinksTaps: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  followersTotal: null,
  mediaCount: null,
  collectedAt: COLLECTED,
  ...partial,
});

const CATALOG = new MemoryMarketingCatalog({
  assets: [
    {
      id: PAID_A,
      kind: 'ad_account',
      displayName: 'Jatobá Ads',
      externalId: 'act_1',
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      currency: 'BRL',
      lastSeenAt: COLLECTED,
    },
    {
      id: ORG_A,
      kind: 'instagram_account',
      displayName: 'Jatobá IG',
      externalId: 'ig_1',
      clientId: CLIENT_A,
      clientName: 'Jatobá',
      companyId: COMPANY_A,
      companyName: 'Agência Ide',
      currency: null,
      lastSeenAt: COLLECTED,
    },
    {
      id: PAID_B,
      kind: 'ad_account',
      displayName: 'Filmes Ads',
      externalId: 'act_2',
      clientId: CLIENT_B,
      clientName: 'Cliente Filmes',
      companyId: COMPANY_B,
      companyName: 'Ide Filmes',
      currency: 'USD',
      lastSeenAt: COLLECTED,
    },
    {
      id: PAID_C,
      kind: 'ad_account',
      displayName: 'Carteira global',
      externalId: 'act_3',
      clientId: CLIENT_C,
      clientName: 'Carteira global',
      companyId: COMPANY_C,
      companyName: 'Fora do recorte',
      currency: null,
      lastSeenAt: COLLECTED,
    },
  ],
  paidDays: [
    paidDay({
      assetId: PAID_A,
      day: '2026-09-01',
      spend: 10,
      reach: 100,
      impressions: 200,
      clicks: 4,
      conversions: 0,
    }),
    paidDay({
      assetId: PAID_A,
      day: '2026-09-03',
      spend: 0,
      reach: 0,
      impressions: 0,
      clicks: 0,
    }),
    paidDay({
      assetId: PAID_B,
      day: '2026-09-01',
      campaignId: 'camp-filmes',
      campaignName: 'Filmes',
      spend: 999,
      reach: 5000,
      impressions: 8000,
      clicks: 80,
    }),
    paidDay({
      assetId: PAID_C,
      day: '2026-09-01',
      campaignId: 'camp-global',
      campaignName: 'Global',
      spend: 50,
      reach: 400,
      impressions: 100,
      clicks: 1,
    }),
  ],
  organicDays: [
    orgDay({
      assetId: ORG_A,
      day: '2026-09-01',
      reach: 80,
      views: 50,
      accountsEngaged: 10,
      follows: 2,
      unfollows: 0,
      followersTotal: 1000,
    }),
  ],
  lastRun: {
    startedAt: '2026-08-01T11:50:00.000Z',
    finishedAt: COLLECTED,
    outcome: 'ok',
    windowFrom: '2026-07-04',
    windowTo: '2026-08-01',
  },
});

function grant(partial: Partial<IntegrationGrant> = {}): IntegrationGrant {
  return {
    id: 'grant-marketing',
    ownerId: OWNER_ID,
    oauthClientId: 'claude',
    name: 'Claude da agência',
    capabilities: ['reports:marketing:read'],
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

function ctxFor(g: IntegrationGrant, person: PersonAccess = ADMIN): MarketingCtx {
  return {
    grant: g,
    person,
    origin: 'http',
    companies: COMPANIES,
    displayName: 'Wesley Lourenço',
    marketing: CATALOG,
    now: AGORA,
  };
}

describe('série com buraco não vira zero', () => {
  it('dia sem linha é absent/null; zero coletado permanece 0 com status present', async () => {
    const page = await getMarketingReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const account = page.body.paid.accounts.find((item) => item.id === PAID_A);
    expect(account).toBeDefined();
    const spend = account?.series.spend.points ?? [];
    expect(spend).toEqual([
      { day: '2026-09-01', value: 10, status: 'present' },
      { day: '2026-09-02', value: null, status: 'absent' },
      { day: '2026-09-03', value: 0, status: 'present' },
    ]);
    expect(spend[1]?.value).not.toBe(0);
    const direto = serie(
      [
        { day: '2026-09-01', spend: 10 },
        { day: '2026-09-03', spend: 0 },
      ],
      'spend',
      FROM,
      TO,
    );
    expect(spend.map((point) => point.value)).toEqual(direto.map((point) => point.valor));
  });
});

describe('alcance aproximado, nunca pessoas únicas do período', () => {
  it('marca kind approximate e distinctPeople false; reusa porDia, não soma os dias', async () => {
    expect(DISTINTAS).toContain('reach');
    expect(DISTINTAS).toContain('accountsEngaged');
    const page = await getMarketingReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const account = page.body.paid.accounts.find((item) => item.id === PAID_A);
    const esperado = asDistinct(porDia([{ day: '2026-09-01', valor: 100 }, { day: '2026-09-03', valor: 0 }]));
    expect(account?.kpis.reach).toEqual(esperado);
    expect(account?.kpis.reach.kind).toBe('approximate');
    expect(account?.kpis.reach.distinctPeople).toBe(false);
    expect(account?.kpis.reach).not.toHaveProperty('total');
    expect(account?.series.reach.kind).toBe('approximate');
    expect(account?.series.reach.distinctPeople).toBe(false);
    expect(account?.series.reach.metric).toBe('reach');
    expect(JSON.stringify(account?.kpis.reach)).not.toContain('"total"');
    const somaDosDias = 100 + 0;
    expect(account?.kpis.reach.average).not.toBe(somaDosDias);
    expect(() =>
      serie(
        [
          { day: '2026-09-01', reach: 100 },
          { day: '2026-09-03', reach: 0 },
        ],
        'reach',
        FROM,
        TO,
      ),
    ).toThrow(/serieDeDistinta/);
    const curva = serieDeDistinta(
      [
        { day: '2026-09-01', reach: 100 },
        { day: '2026-09-03', reach: 0 },
      ],
      'reach',
      FROM,
      TO,
    );
    expect(account?.series.reach.points.map((point) => point.value)).toEqual(curva.map((point) => point.valor));

    const ig = page.body.organic.accounts.find((item) => item.id === ORG_A);
    expect(ig?.kpis.accountsEngaged.kind).toBe('approximate');
    expect(ig?.kpis.accountsEngaged.distinctPeople).toBe(false);
    expect(ig?.series.accountsEngaged.metric).toBe('accountsEngaged');
  });

  it('CTR com denominador 0 é null/absent, não 0%', async () => {
    const page = await getMarketingReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const account = page.body.paid.accounts.find((item) => item.id === PAID_A);
    const direto = resumirPago([
      {
        day: '2026-09-01',
        campaignId: 'camp-1',
        campaignName: 'Campanha',
        spend: 10,
        reach: 100,
        impressions: 200,
        clicks: 4,
        linkClicks: null,
        conversions: 0,
        conversionValue: null,
      },
      {
        day: '2026-09-03',
        campaignId: 'camp-1',
        campaignName: 'Campanha',
        spend: 0,
        reach: 0,
        impressions: 0,
        clicks: 0,
        linkClicks: null,
        conversions: null,
        conversionValue: null,
      },
    ]);
    expect(account?.kpis.ctr.value).toBe(direto.ctr);
    expect(account?.kpis.cpa.status).toBe('absent');
    expect(account?.kpis.cpa.value).toBeNull();
    expect(account?.kpis.conversions).toEqual({ value: 0, status: 'present' });

    const soZero = await getMarketingReport(ctxFor(grant()), { from: '2026-09-03', to: '2026-09-03' });
    expect(soZero.ok).toBe(true);
    if (!soZero.ok) return;
    const diaZero = soZero.body.paid.accounts.find((item) => item.id === PAID_A);
    expect(diaZero?.kpis.impressions).toEqual({ value: 0, status: 'present' });
    expect(diaZero?.kpis.ctr).toEqual({ value: null, status: 'absent' });
  });
});

describe('período acima do teto informa, nunca encolhe em silêncio', () => {
  it('recusa limit_exceeded e cita TETO_DE_DIAS', async () => {
    const page = await getMarketingReport(ctxFor(grant()), { from: '2020-01-01', to: '2030-01-01' });
    expect(page).toEqual({
      ok: false,
      code: 'limit_exceeded',
      message: `Intervalo grande demais: no máximo ${TETO_DE_DIAS} dias por vez.`,
    });
  });

  it('sucesso traz truncated false e o teto no envelope', async () => {
    const page = await getMarketingReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.period.truncated).toBe(false);
    expect(page.body.period.maxDays).toBe(TETO_DE_DIAS);
    expect(page.body.period.effective).toEqual({ from: FROM, to: TO });
  });

  it('intervalo invertido é invalid_input', async () => {
    const page = await getMarketingReport(ctxFor(grant()), { from: '2026-09-03', to: '2026-09-01' });
    expect(page.ok).toBe(false);
    if (page.ok) return;
    expect(page.code).toBe('invalid_input');
  });

  it('sem from/to usa 28 dias civis da agência, não o UTC', () => {
    const virada = new Date('2026-09-01T02:00:00.000Z');
    const resolved = resolveMarketingPeriod({}, virada);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.requested).toEqual({ from: null, to: null });
    expect(resolved.effective.to).toBe('2026-08-31');
    expect(resolved.truncated).toBe(false);
  });
});

describe('collectedAt antigo não parece coleta de agora', () => {
  it('queriedAt é agora e collectedAt é a última execução conhecida, stale', async () => {
    const page = await getMarketingReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.queriedAt).toBe(AGORA.toISOString());
    expect(page.body.coverage.collectedAt).toBe(COLLECTED);
    expect(page.body.coverage.collectedAt).not.toBe(page.body.queriedAt);
    expect(page.body.coverage.collection.status).toBe('stale');
    expect(page.body.coverage.collection.triggeredNow).toBe(false);
    expect(page.body.coverage.collection.message).toMatch(/já estava no port/);
    expect(page.body.coverage.collection.message).toMatch(/sem disparar coleta/);
    const account = page.body.paid.accounts.find((item) => item.id === PAID_A);
    expect(account?.collectedAt).toBe(COLLECTED);
  });
});

describe('recorte antes de agregar', () => {
  it('admin com concessão parcial agrega só o recorte, marca partial e não vaza outra empresa', async () => {
    const page = await getMarketingReport(ctxFor(grant()), { from: FROM, to: TO });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.coverage.kind).toBe('partial');
    expect(page.body.coverage.reason).toMatch(/concessão recorta/);
    expect(page.body.paid.accounts.map((item) => item.id)).toEqual([PAID_A]);
    expect(page.body.organic.accounts.map((item) => item.id)).toEqual([ORG_A]);
    const json = JSON.stringify(page.body);
    expect(json).not.toContain('Cliente Filmes');
    expect(json).not.toContain('Carteira global');
    expect(json).not.toContain(PAID_B);
    expect(json).not.toContain(PAID_C);
    expect(json).not.toContain('999');
    expect(page.body.paid.spendByCurrency).toEqual([
      expect.objectContaining({ currency: 'BRL', currencyKnown: true }),
    ]);
    expect(page.body.paid.spendByCurrency.some((bucket) => bucket.currency === 'USD')).toBe(false);
  });

  it('não soma moedas diferentes e não assume BRL na desconhecida', async () => {
    const page = await getMarketingReport(
      ctxFor(grant({ allowedCompanyIds: null, allowedClientIds: null }), SUPER),
      { from: FROM, to: TO },
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.body.coverage.kind).toBe('full');
    const currencies = page.body.paid.spendByCurrency.map((bucket) => bucket.currency).sort();
    expect(currencies).toEqual(['BRL', 'USD', null].sort());
    const unknown = page.body.paid.spendByCurrency.find((bucket) => bucket.currency === null);
    expect(unknown?.currencyKnown).toBe(false);
    expect(unknown?.spend.value).toBe(50);
    const brl = page.body.paid.spendByCurrency.find((bucket) => bucket.currency === 'BRL');
    const usd = page.body.paid.spendByCurrency.find((bucket) => bucket.currency === 'USD');
    expect(brl?.spend.value).toBe(10);
    expect(usd?.spend.value).toBe(999);
    const json = JSON.stringify(page.body.paid);
    expect(json).not.toMatch(/"spend":\s*1059/);
    expect(page.body.paid).not.toHaveProperty('spend');
  });

  it('sem reports:marketing:read é permission_denied, não lista vazia', async () => {
    const denied = await getMarketingReport(ctxFor(grant({ capabilities: ['clients:read'] })), {
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

describe('OpenAPI e HTTP efetivo fecham o mesmo Zod', () => {
  it('documento, exemplo e resposta efetiva passam no schema', async () => {
    const doc = integrationOpenApi();
    const schema = (
      doc.components as { schemas: { GetMarketingReportResponse: Record<string, unknown> } }
    ).schemas.GetMarketingReportResponse;
    expect(schema).toEqual(jsonSchemaFromZod(getMarketingReportResponseSchema));
    const example = getMarketingReportResponseSchema.parse(getMarketingReportOpenApiExample());
    expect(example.operation).toBe('get_marketing_report');
    expect(example.paid.accounts[0]?.kpis.reach.distinctPeople).toBe(false);
    expect(example.paid.accounts[0]?.series.spend.points.some((point) => point.status === 'absent')).toBe(
      true,
    );
    expect(example.coverage.collectedAt).not.toBe(example.queriedAt);

    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_MARKETING_REPORT_PATH}?from=${FROM}&to=${TO}`),
      grant: grant(),
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      marketing: CATALOG,
      now: AGORA,
    });
    expect(response.status).toBe(200);
    const body = getMarketingReportResponseSchema.parse(await response.json());
    expect(body.coverage.kind).toBe('partial');
    expect(body.period.truncated).toBe(false);
    expect(JSON.stringify(body)).not.toContain('Cliente Filmes');
  });

  it('HTTP sem a capacidade devolve 403', async () => {
    const response = await dispatchIntegrationHttp({
      request: new Request(`https://ideworks.test${GET_MARKETING_REPORT_PATH}?from=${FROM}&to=${TO}`),
      grant: grant({ capabilities: ['boards:read'] }),
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      marketing: CATALOG,
      now: AGORA,
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: string }).error).toBe('permission_denied');
  });

  it('HTTP recusa intervalo grande com limit_exceeded e o teto na mensagem', async () => {
    const response = await dispatchIntegrationHttp({
      request: new Request(
        `https://ideworks.test${GET_MARKETING_REPORT_PATH}?from=2020-01-01&to=2030-01-01`,
      ),
      grant: grant(),
      person: ADMIN,
      origin: 'http',
      catalog: new MemoryCatalog(COMPANIES, new Map([[OWNER_ID, 'Wesley Lourenço']])),
      marketing: CATALOG,
      now: AGORA,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe('limit_exceeded');
    expect(body.message).toContain(String(TETO_DE_DIAS));
  });
});

describe('SqlMarketingCatalog recorta no escopo vazio sem falar com o banco', () => {
  it('load vazio quando a concessão não tem empresa', async () => {
    const catalog = new SqlMarketingCatalog({} as never, { kind: 'preauth' });
    const snapshot = await catalog.load(
      {
        companies: { kind: 'none' },
        clients: 'none',
        capabilities: new Set(['reports:marketing:read']),
      },
      { from: FROM, to: TO },
    );
    expect(snapshot.assets).toEqual([]);
    expect(snapshot.paidDays).toEqual([]);
    expect(snapshot.organicDays).toEqual([]);
  });
});
