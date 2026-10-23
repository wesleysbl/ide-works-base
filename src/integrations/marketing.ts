/**
 * Relatório de marketing — F16.4b.
 *
 * Lê orgânico/pago JÁ coletados. Não dispara coleta. As fórmulas saem de
 * `@/meta/relatorio` (`serie`, `serieDeDistinta`, `DISTINTAS`, `TETO_DE_DIAS`,
 * KPIs). A leitura inspira-se em `src/server/meta-relatorio.ts`, sem copiar
 * `janelaPedida` — aquele recorte silencioso (`ate > teto ? teto : ate`)
 * não entra neste contrato.
 *
 * Vitest bloqueia rede: a suíte injeta `MemoryMarketingCatalog`. O Worker
 * liga `SqlMarketingCatalog` quando há Hyperdrive.
 */

import type postgres from 'postgres';

import {
  GET_MARKETING_REPORT_PATH,
  getMarketingReportResponseSchema,
  type GetMarketingReportResponse,
  type IntegrationErrorCode,
} from '@/integrations/contract';
import { getContext, type IntegrationCompany } from '@/integrations/context';
import {
  companyAllowed,
  effectiveCompanies,
  omittedIn,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import { comparePageKey, measureJsonBytes, RESPONSE_BUDGET_BYTES } from '@/integrations/page';
import { effectiveClients, toWorkScope, type WorkScope } from '@/integrations/reads';
import { DIAS_DA_JANELA, saudeDaColeta } from '@/meta/coleta';
import {
  type DiaDeCampanha,
  type DiaOrganico,
  type MetricaDistinta,
  type Ponto,
  type PorDia,
  type ResumoDeCampanha,
  DISTINTAS,
  TETO_DE_DIAS,
  porCampanha,
  resumirOrganico,
  resumirPago,
  serie,
  serieDeDistinta,
} from '@/meta/relatorio';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import { clienteContaNoMes, clienteNoMesSql } from '@/server/cliente-no-periodo';
import {
  arrayOuNulo,
  withActor,
  type Actor,
  type ExecutionOrigin,
  type ServerEnv,
  type Tx,
} from '@/server/db';
import { borrowSql } from '@/server/db-request';
import { contaDaMetaForaDasOmitidas } from '@/server/omitidas';

export type MarketingPeriodBound = { from: string; to: string };

export type MarketingAssetKind = 'ad_account' | 'instagram_account';

export type MarketingAssetRow = {
  id: string;
  kind: MarketingAssetKind;
  displayName: string | null;
  externalId: string;
  clientId: string | null;
  clientName: string | null;
  /**
   * A empresa do CLIENTE ligado — F31, Fase 3b. Só o catálogo de memória da
   * suíte a usa (o SQL confere direto na consulta): conta ligada a cliente de
   * empresa omitida também sai. Ausente = não se sabe = não omite.
   */
  clientCompanyId?: string | null;
  /**
   * F38, Fase 6.2 — a situação do CLIENTE ligado no cadastro. Só o catálogo de
   * memória da suíte a usa (o SQL confere direto na consulta, com
   * `clienteNoMesSql`). Ausente = ativo.
   */
  clientIsActive?: boolean;
  /** Dia do cancelamento (`AAAA-MM-DD`, São Paulo). Só vale com `clientIsActive: false`. */
  clientCancelledOn?: string | null;
  companyId: string | null;
  companyName: string | null;
  /** ISO 4217. `null` = desconhecida — não vira BRL. */
  currency: string | null;
  lastSeenAt: string | null;
};

export type MarketingPaidDay = DiaDeCampanha & {
  assetId: string;
  collectedAt: string | null;
};

export type MarketingOrganicDay = DiaOrganico & {
  assetId: string;
  collectedAt: string | null;
};

export type MarketingCollectionRun = {
  startedAt: string;
  finishedAt: string | null;
  outcome: 'running' | 'ok' | 'partial' | 'failed';
  windowFrom: string;
  windowTo: string;
};

export type MarketingSnapshot = {
  assets: readonly MarketingAssetRow[];
  paidDays: readonly MarketingPaidDay[];
  organicDays: readonly MarketingOrganicDay[];
  lastRun: MarketingCollectionRun | null;
};

export type MarketingCatalog = {
  load(scope: WorkScope, period: MarketingPeriodBound): Promise<MarketingSnapshot>;
};

const EMPTY_SNAPSHOT: MarketingSnapshot = {
  assets: [],
  paidDays: [],
  organicDays: [],
  lastRun: null,
};

export const EMPTY_MARKETING_CATALOG: MarketingCatalog = {
  async load() {
    return EMPTY_SNAPSHOT;
  },
};

export type MemoryMarketingData = {
  assets?: readonly MarketingAssetRow[];
  paidDays?: readonly MarketingPaidDay[];
  organicDays?: readonly MarketingOrganicDay[];
  lastRun?: MarketingCollectionRun | null;
};

function assetVisible(scope: WorkScope, asset: MarketingAssetRow): boolean {
  // F31, Fase 3b — a regra de `contaDaMetaForaDasOmitidas`: a conta sai se a
  // empresa dela OU a do cliente ligado for omitida.
  const omitted = omittedIn(scope.companies);
  if (asset.clientCompanyId && omitted.includes(asset.clientCompanyId)) return false;
  if (asset.companyId === null) {
    if (scope.companies.kind !== 'all') return false;
  } else if (!companyAllowed(scope.companies, asset.companyId)) {
    return false;
  }
  if (asset.clientId === null) return scope.clients === 'all';
  if (scope.clients === 'none') return false;
  if (scope.clients === 'all') return true;
  return scope.clients.has(asset.clientId);
}

/**
 * F38, Fase 6.2 (D3/D6) — o cliente da conta conta no mês do dia `day`.
 * Conta sem cliente sempre conta. A regra é a de `clienteContaNoMes`.
 */
function assetCountsIn(asset: MarketingAssetRow, day: string): boolean {
  if (asset.clientId === null) return true;
  return clienteContaNoMes(
    { isActive: asset.clientIsActive ?? true, cancelledOn: asset.clientCancelledOn ?? null },
    day,
  );
}

export class MemoryMarketingCatalog implements MarketingCatalog {
  private readonly assets: readonly MarketingAssetRow[];
  private readonly paidDays: readonly MarketingPaidDay[];
  private readonly organicDays: readonly MarketingOrganicDay[];
  private readonly lastRun: MarketingCollectionRun | null;

  constructor(data: MemoryMarketingData = {}) {
    this.assets = data.assets ?? [];
    this.paidDays = data.paidDays ?? [];
    this.organicDays = data.organicDays ?? [];
    this.lastRun = data.lastRun ?? null;
  }

  async load(scope: WorkScope, period: MarketingPeriodBound): Promise<MarketingSnapshot> {
    // F38, Fase 6.2: a conta de cliente cancelado entra só se ele conta em
    // algum mês do período (o do começo ou depois), e só com os dias dos meses
    // em que ele conta — a mesma regra do SQL.
    const assets = this.assets.filter(
      (asset) => assetVisible(scope, asset) && assetCountsIn(asset, period.from),
    );
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const inWindow = (day: string) => day >= period.from && day <= period.to;
    const keep = (row: { assetId: string; day: string }) => {
      const asset = byId.get(row.assetId);
      return asset !== undefined && inWindow(row.day) && assetCountsIn(asset, row.day);
    };
    return {
      assets,
      paidDays: this.paidDays.filter(keep),
      organicDays: this.organicDays.filter(keep),
      lastRun: this.lastRun,
    };
  }
}

function companyList(scope: WorkScope): readonly string[] | null {
  if (scope.companies.kind === 'all') return null;
  if (scope.companies.kind === 'none') return [];
  return [...scope.companies.ids];
}

function clientList(scope: WorkScope): readonly string[] | null {
  if (scope.clients === 'all') return null;
  if (scope.clients === 'none') return [];
  return [...scope.clients];
}

function scopedAsset(tx: Tx, scope: WorkScope) {
  const companies = companyList(scope);
  const clients = clientList(scope);
  const companyPred =
    companies === null
      ? tx`(a.category_id is null or ideworks.integration_allows_company(a.category_id))`
      : tx`(a.category_id is not null
            and ideworks.integration_allows_company(a.category_id)
            and a.category_id = any(${arrayOuNulo(companies)}::uuid[]))`;
  const clientPred =
    clients === null
      ? tx`(a.client_id is null or ideworks.integration_allows_client(a.client_id))`
      : tx`(a.client_id is not null
            and ideworks.integration_allows_client(a.client_id)
            and a.client_id = any(${arrayOuNulo(clients)}::uuid[]))`;
  // F31, Fase 3b — a conta da empresa omitida, ou ligada a cliente dela, sai
  // do relatório de marketing pela MESMA regra das telas da Meta. Sem omitida
  // o trecho é vazio e a consulta é a de antes.
  const omitidas = contaDaMetaForaDasOmitidas(
    tx,
    { categoriasOmitidas: omittedIn(scope.companies) },
    { categoria: tx`a.category_id`, cliente: tx`a.client_id` },
  );
  return tx`${companyPred} and ${clientPred}${omitidas}`;
}

/**
 * F38, Fase 6.2 (D3/D6) — a conta ligada a cliente cancelado segue a regra de
 * período da Fase 5 (`clienteNoMesSql`): o cliente conta no mês M se está
 * ativo ou cancelou em M ou depois. `mes` é o começo do período (para a conta)
 * ou o dia da linha (para os dias). Conta sem cliente sempre passa.
 */
function assetClientCountsIn(tx: Tx, mes: postgres.PendingQuery<postgres.Row[]>) {
  return tx`(a.client_id is null or ${clienteNoMesSql(tx, tx`a.client_id`, mes)})`;
}

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

function instant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asKind(value: unknown): MarketingAssetKind | null {
  return value === 'ad_account' || value === 'instagram_account' ? value : null;
}

function asOutcome(value: unknown): MarketingCollectionRun['outcome'] | null {
  return value === 'running' || value === 'ok' || value === 'partial' || value === 'failed'
    ? value
    : null;
}

function parseCurrency(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (text === '' || text === 'UNKNOWN') return null;
  if (!/^[A-Z]{3}$/.test(text)) return null;
  return text;
}

export class SqlMarketingCatalog implements MarketingCatalog {
  constructor(
    private readonly env: ServerEnv,
    private readonly actor: Actor,
  ) {}

  /** Conexão emprestada da requisição (F22, Fase 2); o ator continua sendo o deste porto. */
  private async withTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return borrowSql(this.env, 'marketing', (sql) => withActor(sql, this.actor, work));
  }

  async load(scope: WorkScope, period: MarketingPeriodBound): Promise<MarketingSnapshot> {
    if (scope.companies.kind === 'none' || scope.clients === 'none') return EMPTY_SNAPSHOT;
    return this.withTx(async (tx) => {
      const assets = await tx`
        select a.id::text as id, a.kind::text as kind, a.display_name, a.external_id,
               a.client_id::text as client_id, c.name as client_name,
               a.category_id::text as company_id, cat.name as company_name,
               a.last_seen_at
          from ideworks.meta_assets a
          left join ideworks.clients c on c.id = a.client_id
          left join ideworks.client_categories cat on cat.id = a.category_id
         where a.kind in ('ad_account', 'instagram_account')
           and ${scopedAsset(tx, scope)}
           and ${assetClientCountsIn(tx, tx`${period.from}::date`)}
         order by lower(coalesce(a.display_name, a.external_id)), a.id`;

      const paid = await tx`
        select d.asset_id::text as asset_id, d.day::text as day, d.campaign_id, d.campaign_name,
               d.spend, d.reach, d.impressions, d.clicks, d.link_clicks,
               d.conversions, d.conversion_value, d.collected_at
          from ideworks.meta_daily_campaign d
          join ideworks.meta_assets a on a.id = d.asset_id
         where d.day between ${period.from}::date and ${period.to}::date
           and ${scopedAsset(tx, scope)}
           and ${assetClientCountsIn(tx, tx`d.day`)}
         order by d.day, d.campaign_id`;

      const organic = await tx`
        select d.asset_id::text as asset_id, d.day::text as day, d.reach, d.views,
               d.accounts_engaged, d.total_interactions, d.follows, d.unfollows,
               d.profile_links_taps, d.likes, d.comments, d.shares, d.saves,
               d.followers_total, d.media_count, d.collected_at
          from ideworks.meta_daily_organic d
          join ideworks.meta_assets a on a.id = d.asset_id
         where d.day between ${period.from}::date and ${period.to}::date
           and ${scopedAsset(tx, scope)}
           and ${assetClientCountsIn(tx, tx`d.day`)}
         order by d.day`;

      const [run] = await tx`
        select started_at, finished_at, outcome::text as outcome,
               window_from::text as window_from, window_to::text as window_to
          from ideworks.meta_collection_runs
         order by started_at desc
         limit 1`;

      const outcome = run ? asOutcome(run.outcome) : null;
      return {
        assets: assets.flatMap((row) => {
          const kind = asKind(row.kind);
          if (!kind) return [];
          return [
            {
              id: row.id as string,
              kind,
              displayName: (row.display_name as string | null) ?? null,
              externalId: row.external_id as string,
              clientId: (row.client_id as string | null) ?? null,
              clientName: (row.client_name as string | null) ?? null,
              companyId: (row.company_id as string | null) ?? null,
              companyName: (row.company_name as string | null) ?? null,
              currency: null,
              lastSeenAt: instant(row.last_seen_at),
            },
          ];
        }),
        paidDays: (
          paid as unknown as Array<Record<string, unknown>>
        ).map(
          (row): MarketingPaidDay => ({
            assetId: row.asset_id as string,
            day: row.day as string,
            campaignId: row.campaign_id as string,
            campaignName: (row.campaign_name as string | null) ?? null,
            spend: num(row.spend),
            reach: num(row.reach),
            impressions: num(row.impressions),
            clicks: num(row.clicks),
            linkClicks: num(row.link_clicks),
            conversions: num(row.conversions),
            conversionValue: num(row.conversion_value),
            collectedAt: instant(row.collected_at),
          }),
        ),
        organicDays: (
          organic as unknown as Array<Record<string, unknown>>
        ).map(
          (row): MarketingOrganicDay => ({
            assetId: row.asset_id as string,
            day: row.day as string,
            reach: num(row.reach),
            views: num(row.views),
            accountsEngaged: num(row.accounts_engaged),
            totalInteractions: num(row.total_interactions),
            follows: num(row.follows),
            unfollows: num(row.unfollows),
            profileLinksTaps: num(row.profile_links_taps),
            likes: num(row.likes),
            comments: num(row.comments),
            shares: num(row.shares),
            saves: num(row.saves),
            followersTotal: num(row.followers_total),
            mediaCount: num(row.media_count),
            collectedAt: instant(row.collected_at),
          }),
        ),
        lastRun:
          run && outcome
            ? {
                startedAt: instant(run.started_at) ?? String(run.started_at),
                finishedAt: instant(run.finished_at),
                outcome,
                windowFrom: String(run.window_from),
                windowTo: String(run.window_to),
              }
            : null,
      };
    });
  }
}

export function createSqlMarketingCatalog(env: ServerEnv, actor: Actor): MarketingCatalog {
  return new SqlMarketingCatalog(env, actor);
}

export type MarketingCtx = {
  grant: IntegrationGrant;
  person: PersonAccess;
  origin: ExecutionOrigin;
  companies: readonly IntegrationCompany[];
  displayName: string;
  marketing: MarketingCatalog;
  now?: Date;
};

export type MarketingFailure = {
  ok: false;
  code: Extract<
    IntegrationErrorCode,
    'permission_denied' | 'invalid_input' | 'limit_exceeded' | 'data_incomplete'
  >;
  message: string;
};

export type MarketingResult = { ok: true; body: GetMarketingReportResponse } | MarketingFailure;

const DENIED: MarketingFailure = {
  ok: false,
  code: 'permission_denied',
  message: 'Fora do alcance desta integração.',
};

const DISTINCT_NOTE =
  'Média e pico diários. Não é o total de pessoas únicas do período — alcance não se soma.';
const DISTINCT_SERIES_NOTE =
  'Curva aproximada para ver a forma. Os dias não se somam; as mesmas pessoas aparecem em vários.';

type CountMetric = GetMarketingReportResponse['paid']['totals']['impressions'];
type DistinctMetric = GetMarketingReportResponse['paid']['totals']['reach'];
type SeriesPoint = GetMarketingReportResponse['paid']['accounts'][number]['series']['spend']['points'][number];
type DistinctSeries = GetMarketingReportResponse['paid']['accounts'][number]['series']['reach'];
type PaidKpis = GetMarketingReportResponse['paid']['accounts'][number]['kpis'];
type OrganicKpis = GetMarketingReportResponse['organic']['totals'];

export function asCount(value: number | null): CountMetric {
  if (value === null) return { value: null, status: 'absent' };
  return { value, status: 'present' };
}

export function asDistinct(por: PorDia): DistinctMetric {
  const absent = por.dias === 0 && por.media === null && por.pico === null;
  return {
    kind: 'approximate',
    distinctPeople: false,
    average: por.media,
    peak: por.pico,
    peakOn: por.diaDoPico,
    days: por.dias,
    status: absent ? 'absent' : 'present',
    note: DISTINCT_NOTE,
  };
}

export function asSeries(points: readonly Ponto[]): SeriesPoint[] {
  return points.map((point) => ({
    day: point.dia,
    value: point.valor,
    status: point.valor === null ? 'absent' : 'present',
  }));
}

export function asDistinctSeries(metric: MetricaDistinta, points: readonly Ponto[]): DistinctSeries {
  if (!(DISTINTAS as readonly string[]).includes(metric)) {
    throw new Error(`"${metric}" não é métrica de pessoas distintas.`);
  }
  return {
    metric,
    kind: 'approximate',
    distinctPeople: false,
    note: DISTINCT_SERIES_NOTE,
    points: asSeries(points),
  };
}

function presentPaid(resumo: ResumoDeCampanha): PaidKpis {
  return {
    spend: asCount(resumo.spend),
    impressions: asCount(resumo.impressions),
    clicks: asCount(resumo.clicks),
    linkClicks: asCount(resumo.linkClicks),
    conversions: asCount(resumo.conversions),
    conversionValue: asCount(resumo.conversionValue),
    reach: asDistinct(resumo.alcance),
    ctr: asCount(resumo.ctr),
    cpc: asCount(resumo.cpc),
    cpm: asCount(resumo.cpm),
    cpa: asCount(resumo.cpa),
    roas: asCount(resumo.roas),
    days: resumo.dias,
  };
}

function presentOrganic(resumo: ReturnType<typeof resumirOrganico>): OrganicKpis {
  return {
    views: asCount(resumo.views),
    totalInteractions: asCount(resumo.totalInteractions),
    follows: asCount(resumo.follows),
    unfollows: asCount(resumo.unfollows),
    profileLinksTaps: asCount(resumo.profileLinksTaps),
    followerBalance: asCount(resumo.saldoDeSeguidores),
    reach: asDistinct(resumo.alcance),
    accountsEngaged: asDistinct(resumo.contasEngajadas),
    engagementRate: asCount(resumo.taxaDeEngajamento),
    followers: asCount(resumo.seguidores),
    publications: asCount(resumo.publicacoes),
    days: resumo.dias,
  };
}

function civilDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function addUtcDays(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function parseDay(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) {
    throw new Error('Intervalo inválido.');
  }
  return ms;
}

/** Conta inclusiva sem passar por `diasDoIntervalo`, que corta em silêncio no teto. */
export function inclusiveDayCount(from: string, to: string): number {
  const start = parseDay(from);
  const end = parseDay(to);
  return Math.round((end - start) / 86_400_000) + 1;
}

type ResolvedPeriod =
  | {
      ok: true;
      requested: { from: string | null; to: string | null };
      effective: MarketingPeriodBound;
      truncated: false;
    }
  | MarketingFailure;

export function resolveMarketingPeriod(
  input: { from?: string; to?: string },
  now: Date,
): ResolvedPeriod {
  const hasFrom = input.from !== undefined;
  const hasTo = input.to !== undefined;
  if (hasFrom !== hasTo) {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'Informe from e to juntos, em AAAA-MM-DD.',
    };
  }

  const requested = { from: input.from ?? null, to: input.to ?? null };
  const today = civilDate(now, AGENCY_TIMEZONE);
  const effective = hasFrom
    ? { from: input.from as string, to: input.to as string }
    : { from: addUtcDays(today, -(DIAS_DA_JANELA - 1)), to: today };

  try {
    const days = inclusiveDayCount(effective.from, effective.to);
    if (days < 1) {
      return { ok: false, code: 'invalid_input', message: 'O fim vem antes do começo.' };
    }
    if (days > TETO_DE_DIAS) {
      return {
        ok: false,
        code: 'limit_exceeded',
        message: `Intervalo grande demais: no máximo ${TETO_DE_DIAS} dias por vez.`,
      };
    }
    return { ok: true, requested, effective, truncated: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Período inválido.';
    return { ok: false, code: 'invalid_input', message };
  }
}

function grantCoverage(
  person: PersonAccess,
  grant: IntegrationGrant,
): Pick<GetMarketingReportResponse['coverage'], 'kind' | 'reason'> {
  const companies = effectiveCompanies(person, grant);
  const clients = effectiveClients(person, grant);
  const allowlistCuts = grant.allowedCompanyIds !== null || grant.allowedClientIds !== null;
  const companiesCut = companies.kind !== 'all';
  const clientsCut = clients !== 'all';
  if (!allowlistCuts && !companiesCut && !clientsCut) return { kind: 'full' };
  return {
    kind: 'partial',
    reason: allowlistCuts
      ? 'A concessão recorta empresas ou clientes; o agregado não é a carteira global.'
      : 'O recorte efetivo não cobre todas as empresas e clientes.',
  };
}

function laterInstant(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

function collectedAtOf(
  snapshot: MarketingSnapshot,
  assetId: string,
  lastSeenAt: string | null,
): string | null {
  let latest = lastSeenAt;
  for (const row of snapshot.paidDays) {
    if (row.assetId !== assetId) continue;
    latest = laterInstant(latest, row.collectedAt);
  }
  for (const row of snapshot.organicDays) {
    if (row.assetId !== assetId) continue;
    latest = laterInstant(latest, row.collectedAt);
  }
  return latest;
}

function portCollectedAt(snapshot: MarketingSnapshot): string | null {
  let latest = snapshot.lastRun?.finishedAt ?? snapshot.lastRun?.startedAt ?? null;
  for (const asset of snapshot.assets) {
    latest = laterInstant(latest, asset.lastSeenAt);
  }
  for (const row of snapshot.paidDays) latest = laterInstant(latest, row.collectedAt);
  for (const row of snapshot.organicDays) latest = laterInstant(latest, row.collectedAt);
  return latest;
}

function collectionCoverage(
  collectedAt: string | null,
  lastRun: MarketingCollectionRun | null,
  now: Date,
): GetMarketingReportResponse['coverage']['collection'] {
  const health = saudeDaColeta(collectedAt, now);
  const lastRunAt = lastRun?.finishedAt ?? lastRun?.startedAt ?? collectedAt;
  const lastRunOutcome = lastRun?.outcome ?? null;
  if (health === 'nunca_coletou') {
    return {
      status: 'none',
      lastRunAt,
      lastRunOutcome,
      triggeredNow: false,
      message: 'Não há coleta conhecida neste port. Esta operação não dispara coleta na Meta.',
    };
  }
  if (health === 'atrasado') {
    return {
      status: 'stale',
      lastRunAt,
      lastRunOutcome,
      triggeredNow: false,
      message: `Última coleta em ${collectedAt}. Esta resposta lê o que já estava no port, sem disparar coleta agora.`,
    };
  }
  return {
    status: 'current',
    lastRunAt,
    lastRunOutcome,
    triggeredNow: false,
    message: `Coleta conhecida em ${collectedAt}. Esta operação não dispara coleta na Meta.`,
  };
}

function namedCompany(asset: MarketingAssetRow): { id: string; name: string } | null {
  if (!asset.companyId) return null;
  return { id: asset.companyId, name: asset.companyName && asset.companyName.length > 0 ? asset.companyName : asset.companyId };
}

function namedClient(asset: MarketingAssetRow): { id: string; name: string } | null {
  if (!asset.clientId) return null;
  return { id: asset.clientId, name: asset.clientName && asset.clientName.length > 0 ? asset.clientName : asset.clientId };
}

function dropPaid(day: MarketingPaidDay): DiaDeCampanha {
  const { assetId, collectedAt, ...rest } = day;
  void assetId;
  void collectedAt;
  return rest;
}

function dropOrganic(day: MarketingOrganicDay): DiaOrganico {
  const { assetId, collectedAt, ...rest } = day;
  void assetId;
  void collectedAt;
  return rest;
}

function currencyOf(asset: MarketingAssetRow): string | null {
  return parseCurrency(asset.currency);
}

function countableSeries<T extends { day: string }>(
  metric: keyof T & string,
  days: readonly T[],
  period: MarketingPeriodBound,
): GetMarketingReportResponse['paid']['accounts'][number]['series']['spend'] {
  return {
    metric,
    points: asSeries(serie(days, metric, period.from, period.to)),
  };
}

function distinctCurve<T extends { day: string }>(
  metric: MetricaDistinta,
  days: readonly T[],
  period: MarketingPeriodBound,
): DistinctSeries {
  return asDistinctSeries(metric, serieDeDistinta(days, metric, period.from, period.to));
}

function spendBuckets(
  paidAssets: readonly MarketingAssetRow[],
  paidDays: readonly MarketingPaidDay[],
): GetMarketingReportResponse['paid']['spendByCurrency'] {
  const groups = new Map<string | null, MarketingPaidDay[]>();
  const currencyByAsset = new Map(paidAssets.map((asset) => [asset.id, currencyOf(asset)]));
  for (const day of paidDays) {
    const currency = currencyByAsset.get(day.assetId) ?? null;
    const list = groups.get(currency) ?? [];
    list.push(day);
    groups.set(currency, list);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b);
  });
  return keys.map((currency) => {
    const resumo = resumirPago((groups.get(currency) ?? []).map(dropPaid));
    return {
      currency,
      currencyKnown: currency !== null,
      spend: asCount(resumo.spend),
      conversionValue: asCount(resumo.conversionValue),
      cpc: asCount(resumo.cpc),
      cpm: asCount(resumo.cpm),
      cpa: asCount(resumo.cpa),
      roas: asCount(resumo.roas),
    };
  });
}

export async function getMarketingReport(
  ctx: MarketingCtx,
  input: { from?: string; to?: string },
): Promise<MarketingResult> {
  const now = ctx.now ?? new Date();
  const scope = toWorkScope(ctx.person, ctx.grant, now);
  if (!scope.capabilities.has('reports:marketing:read')) return DENIED;

  const period = resolveMarketingPeriod(input, now);
  if (!period.ok) return period;

  const snapshot = await ctx.marketing.load(scope, period.effective);
  const paidAssets = snapshot.assets.filter((asset) => asset.kind === 'ad_account');
  const organicAssets = snapshot.assets.filter((asset) => asset.kind === 'instagram_account');

  const paidAccounts: GetMarketingReportResponse['paid']['accounts'] = paidAssets.map((asset) => {
    const days = snapshot.paidDays.filter((row) => row.assetId === asset.id);
    const linhas = days.map(dropPaid);
    const currency = currencyOf(asset);
    return {
      id: asset.id,
      kind: 'ad_account' as const,
      displayName: asset.displayName,
      externalId: asset.externalId,
      client: namedClient(asset),
      company: namedCompany(asset),
      currency,
      currencyKnown: currency !== null,
      collectedAt: collectedAtOf(snapshot, asset.id, asset.lastSeenAt),
      kpis: presentPaid(resumirPago(linhas)),
      campaigns: porCampanha(linhas).map((campaign) => ({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        kpis: presentPaid(campaign),
      })),
      series: {
        spend: countableSeries('spend', linhas, period.effective),
        impressions: countableSeries('impressions', linhas, period.effective),
        reach: distinctCurve('reach', linhas, period.effective),
      },
    };
  });

  const organicAccounts: GetMarketingReportResponse['organic']['accounts'] = organicAssets.map(
    (asset) => {
      const days = snapshot.organicDays.filter((row) => row.assetId === asset.id);
      const linhas = days.map(dropOrganic);
      return {
        id: asset.id,
        kind: 'instagram_account' as const,
        displayName: asset.displayName,
        externalId: asset.externalId,
        client: namedClient(asset),
        company: namedCompany(asset),
        collectedAt: collectedAtOf(snapshot, asset.id, asset.lastSeenAt),
        kpis: presentOrganic(resumirOrganico(linhas)),
        series: {
          views: countableSeries('views', linhas, period.effective),
          reach: distinctCurve('reach', linhas, period.effective),
          accountsEngaged: distinctCurve('accountsEngaged', linhas, period.effective),
        },
      };
    },
  );

  paidAccounts.sort((a, b) =>
    comparePageKey(
      { k: (a.displayName ?? a.externalId).toLowerCase(), id: a.id },
      { k: (b.displayName ?? b.externalId).toLowerCase(), id: b.id },
    ),
  );
  organicAccounts.sort((a, b) =>
    comparePageKey(
      { k: (a.displayName ?? a.externalId).toLowerCase(), id: a.id },
      { k: (b.displayName ?? b.externalId).toLowerCase(), id: b.id },
    ),
  );

  const paidLinhas = snapshot.paidDays.map(dropPaid);
  const paidTotals = resumirPago(paidLinhas);
  const organicTotals = presentOrganic(resumirOrganico(snapshot.organicDays.map(dropOrganic)));

  const collectedAt = portCollectedAt(snapshot);
  const meta = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now,
  });
  const self = `${GET_MARKETING_REPORT_PATH}?from=${encodeURIComponent(period.effective.from)}&to=${encodeURIComponent(period.effective.to)}`;
  const coverageBase = grantCoverage(ctx.person, ctx.grant);
  const body = getMarketingReportResponseSchema.parse({
    operation: 'get_marketing_report',
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    period: {
      requested: period.requested,
      effective: period.effective,
      truncated: false,
      timezone: AGENCY_TIMEZONE,
      maxDays: TETO_DE_DIAS,
    },
    coverage: {
      ...coverageBase,
      collectedAt,
      collection: collectionCoverage(collectedAt, snapshot.lastRun, now),
    },
    paid: {
      accounts: paidAccounts,
      totals: {
        impressions: asCount(paidTotals.impressions),
        clicks: asCount(paidTotals.clicks),
        linkClicks: asCount(paidTotals.linkClicks),
        conversions: asCount(paidTotals.conversions),
        reach: asDistinct(paidTotals.alcance),
        ctr: asCount(paidTotals.ctr),
        days: paidTotals.dias,
      },
      spendByCurrency: spendBuckets(paidAssets, snapshot.paidDays),
    },
    organic: {
      accounts: organicAccounts,
      totals: organicTotals,
    },
  });

  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}
