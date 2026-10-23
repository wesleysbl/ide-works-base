/**
 * Relatório de entrega — F16.4a. Série mês a mês — F26.7.
 *
 * UMA FÓRMULA SÓ: `calculateDeliveryLevel` de `src/delivery/level.ts`.
 * O sentido dos dados é o de `readPanel` (meses inteiros no medidor,
 * produção datada no intervalo). O recorte da concessão entra ANTES
 * de agregar. Mês sem contrato mensurável não vira 0%.
 *
 * F26.7: `get_client_delivery_history` e `get_delivery_trend` leem o intervalo
 * UMA vez (`loadMonthly`), repartem por mês no MESMO formato de retrato do
 * relatório (`snapshotsByMonth`) e passam cada mês pela MESMA `applyFormula`.
 * Por construção, o mês da série é o `get_delivery_report` daquele mês.
 *
 * Vitest bloqueia rede: a suíte injeta `MemoryDeliveryCatalog`. O Worker
 * liga `SqlDeliveryCatalog` quando há Hyperdrive.
 */

import {
  FORMULA_VERSION,
  UnknownContentType,
  calculateDeliveryLevel,
  type ContentType,
  type ContractItem,
  type DeliveredItem,
  type DeliveryResult,
} from '@/delivery/level';
import {
  DELIVERY_HISTORY_MAX_MONTHS,
  DELIVERY_MONTH_PATTERN,
  DELIVERY_SERIES_DEFAULT_MONTHS,
  DELIVERY_TREND_MAX_MONTHS,
  GET_CLIENT_DELIVERY_HISTORY_PATH,
  GET_DELIVERY_REPORT_PATH,
  GET_DELIVERY_STATUS_PATH,
  GET_DELIVERY_TREND_PATH,
  GET_PLANNING_WEEKS_PATH,
  INTEGRATION_UUID,
  getClientDeliveryHistoryResponseSchema,
  getDeliveryReportResponseSchema,
  getDeliveryStatusResponseSchema,
  getDeliveryTrendResponseSchema,
  getPlanningWeeksResponseSchema,
  type CancelledDelivery,
  type DeliveryTrendLevel,
  type GetClientDeliveryHistoryResponse,
  type GetDeliveryReportResponse,
  type GetDeliveryStatusResponse,
  type GetDeliveryTrendResponse,
  type GetPlanningWeeksResponse,
  type IntegrationErrorCode,
} from '@/integrations/contract';
import { getContext, type IntegrationCompany } from '@/integrations/context';
import {
  companyAllowed,
  effectiveCompanies,
  omittedIn,
  type IntegrationCapability,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import {
  comparePageKey,
  measureJsonBytes,
  overBudget,
  parsePageRequest,
  RESPONSE_BUDGET_BYTES,
} from '@/integrations/page';
import {
  asPageError,
  cancelledDetail,
  effectiveClients,
  pageAndFit,
  toWorkScope,
  type ReadFailure,
  type WorkScope,
} from '@/integrations/reads';
import { semanasDoMes } from '@/delivery/semanas';
import { deliveryStatusOf, diaNaAgencia, type WeeklyPiece } from '@/delivery/ultima-entrega';
import {
  agruparPorResponsavel,
  planejarSemanas,
  type PecaDoPlanejamento,
} from '@/painel/planejamento-semanal';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import {
  arrayOuNulo,
  withActor,
  type Actor,
  type ExecutionOrigin,
  type ServerEnv,
  type Tx,
} from '@/server/db';
import {
  clienteContaNoMes,
  clienteNoMesSql,
  diaDaPecaSql,
  type SituacaoNoCadastro,
} from '@/server/cliente-no-periodo';
import { borrowSql } from '@/server/db-request';
import { readWeeklyPieces } from '@/server/delivery-status';
import { MAX_MESES_NO_INTERVALO, firstDayOfMonth, monthsInRange } from '@/server/panel';
import {
  donosDoPlanejamento,
  quotasDoCadastro,
  quotasDoContrato,
  resolvePlanningQuota,
} from '@/server/planning-weeks';

export type DeliveryPeriodBound = { from: string; to: string };

export type DeliveryPeriodQuery = DeliveryPeriodBound & { months: readonly string[] };

export type DeliveryClientRow = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
};

export type DeliveryContractRow = {
  clientId: string;
  contentType: string;
  quantity: number;
};

export type DeliveryItemRow = {
  clientId: string;
  contentType: string;
  isExtra: boolean;
  isCompleted: boolean;
};

/** F38, Fase 5 — o cliente com o que o cadastro diz dele hoje (ativo ou o dia do cancelamento). */
export type DeliveryPeriodClientRow = DeliveryClientRow & SituacaoNoCadastro;

export type DeliveryPeriodCount = {
  clientId: string;
  scheduled: number;
  completed: number;
};

export type DeliverySnapshot = {
  clients: readonly DeliveryClientRow[];
  contracts: readonly DeliveryContractRow[];
  items: readonly DeliveryItemRow[];
  openedClientIds: readonly string[];
  contentContractClientIds: readonly string[];
  inPeriod: readonly DeliveryPeriodCount[];
};

/**
 * F26.7 — o retrato de um INTERVALO de meses, com o mês em cada linha. É o
 * `DeliverySnapshot` do relatório sem a soma dos meses: contrato, itens e mês
 * aberto pelo `reference_month`; a produção datada pelo mês civil do
 * `scheduled_at`, com o mesmo corte de dia do relatório.
 */
export type DeliveryMonthlySnapshot = {
  /**
   * F38, Fase 5 — TODOS os clientes do recorte, com a situação no cadastro: o
   * mês a mês decide, pela regra única (`clienteContaNoMes`), em que meses cada
   * um entra. As linhas abaixo já vêm só dos meses em que o cliente conta.
   */
  clients: readonly DeliveryPeriodClientRow[];
  contracts: readonly (DeliveryContractRow & { month: string })[];
  items: readonly (DeliveryItemRow & { month: string })[];
  opened: readonly { clientId: string; month: string }[];
  contentContractClientIds: readonly string[];
  inPeriod: readonly (DeliveryPeriodCount & { month: string })[];
};

/** O ritual de UM cliente num mês aberto — quando e por quem, sem o link do cliente. */
export type PlanningRitualRow = {
  clientId: string;
  planningDoneAt: string | null;
  planningDoneBy: { id: string; name: string } | null;
  clientApprovedAt: string | null;
  clientApprovedBy: { id: string; name: string } | null;
};

/**
 * F37 — o retrato de UM mês para o planejamento por semana: o que a rota
 * `GET /planning/weeks` do site lê (`readPlanningWeeks`), no recorte da
 * concessão. Só clientes ATIVOS, como a aba Semana.
 *
 * `contracts` traz uma linha por item do contrato do mês, e uma linha com
 * `contentType: null` para o mês aberto SEM item (junção à esquerda): é ela que
 * diz "mês aberto, cota zero". `registry` é a cota do cadastro de hoje.
 */
export type DeliveryPlanningSnapshot = {
  clients: readonly DeliveryClientRow[];
  contracts: readonly { clientId: string; contentType: string | null; quantity: number }[];
  /**
   * O ritual do mês (`month_contracts`): quando e por quem o mês foi marcado
   * "planejado" e "cliente aprovou". Uma linha por cliente com o mês ABERTO;
   * o link de aprovação do cliente (token) NUNCA entra aqui. Quem lê é
   * `get_month_attention`; `get_planning_weeks` não usa.
   */
  ritual: readonly PlanningRitualRow[];
  registry: readonly { clientId: string; contentType: string; quantity: number }[];
  /** Pasta (time) das listas do cliente. */
  folders: readonly { clientId: string; folderId: string; folderName: string }[];
  /** Carteira individual (`user_clients`): responsável quando não há pasta. */
  portfolio: readonly { clientId: string; userId: string; name: string }[];
  items: readonly (PecaDoPlanejamento & { clientId: string })[];
};

/**
 * F38, Fase 3 — os clientes ATIVOS do recorte e as peças da Semanal que a regra
 * de entrega (`deliveryStatusOf`) precisa. O catálogo só traz dados; a regra é
 * aplicada em `getDeliveryStatus`, uma vez, para o SQL e para o dublê.
 */
export type DeliveryStatusSnapshot = {
  clients: readonly DeliveryClientRow[];
  /** Por cliente. Cliente sem peça pode faltar no mapa: é "sem entrega registrada". */
  pieces: ReadonlyMap<string, readonly WeeklyPiece[]>;
};

/**
 * `get_calendar` — uma linha do calendário editorial: a peça com dia marcado
 * (`delivery`) ou o compromisso (`appointment`: reunião, gravação, viagem). O
 * dia é o de São Paulo. Compromisso não leva as observações (texto livre).
 */
export type CalendarEntryRow = {
  kind: 'delivery' | 'appointment';
  id: string;
  clientId: string;
  clientName: string;
  /** `AAAA-MM-DD`. */
  day: string;
  /** `HH:MM`. Só o compromisso tem. */
  time: string | null;
  /** Só a peça. */
  contentType: string | null;
  title: string | null;
  isCompleted: boolean;
  isExtra: boolean;
};

export type DeliveryCalendarSnapshot = {
  /** Só com `clientId` no pedido: o cliente, se ativo e no recorte (é como `get_calendar` distingue "sem nada no período" de "cliente que não existe para esta conexão"). Sem `clientId`, vazio. */
  clients: readonly DeliveryClientRow[];
  entries: readonly CalendarEntryRow[];
};

export type DeliveryCatalog = {
  load(scope: WorkScope, period: DeliveryPeriodQuery): Promise<DeliverySnapshot>;
  /**
   * G2 — as peças com dia e os compromissos de clientes ATIVOS do recorte, com o
   * dia entre `from` e `to` (`AAAA-MM-DD`, os dois dias inclusos, fuso de São
   * Paulo). Sem ordem garantida: quem chama ordena. `clientId` só pede a
   * confirmação do cliente em `clients`; quem estreita a leitura é o `scope`.
   */
  loadCalendar(
    scope: WorkScope,
    period: { from: string; to: string; clientId?: string },
  ): Promise<DeliveryCalendarSnapshot>;
  /** F38 — os clientes ativos do recorte e as peças da Semanal de cada um, com o "hoje" de `now`. */
  loadDeliveryStatus(scope: WorkScope, now: Date): Promise<DeliveryStatusSnapshot>;
  /** F37 — o mês (`AAAA-MM-01`) de cada cliente ativo do recorte, para dividir por semana. */
  loadPlanning(scope: WorkScope, month: string): Promise<DeliveryPlanningSnapshot>;
  /**
   * F26.7 — o intervalo inteiro numa leitura só (sem uma consulta por mês).
   * `months` são primeiros dias (`AAAA-MM-01`); `from`/`to` são o primeiro dia
   * do primeiro mês e o último dia do último, para a produção datada.
   */
  loadMonthly(scope: WorkScope, period: DeliveryPeriodQuery): Promise<DeliveryMonthlySnapshot>;
};

const EMPTY_SNAPSHOT: DeliverySnapshot = {
  clients: [],
  contracts: [],
  items: [],
  openedClientIds: [],
  contentContractClientIds: [],
  inPeriod: [],
};

const EMPTY_MONTHLY_SNAPSHOT: DeliveryMonthlySnapshot = {
  clients: [],
  contracts: [],
  items: [],
  opened: [],
  contentContractClientIds: [],
  inPeriod: [],
};

const EMPTY_DELIVERY_STATUS_SNAPSHOT: DeliveryStatusSnapshot = { clients: [], pieces: new Map() };

const EMPTY_PLANNING_SNAPSHOT: DeliveryPlanningSnapshot = {
  clients: [],
  contracts: [],
  ritual: [],
  registry: [],
  folders: [],
  portfolio: [],
  items: [],
};

export const EMPTY_DELIVERY_CATALOG: DeliveryCatalog = {
  async load() {
    return EMPTY_SNAPSHOT;
  },
  async loadCalendar() {
    return { clients: [], entries: [] };
  },
  async loadPlanning() {
    return EMPTY_PLANNING_SNAPSHOT;
  },
  async loadDeliveryStatus() {
    return EMPTY_DELIVERY_STATUS_SNAPSHOT;
  },
  async loadMonthly() {
    return EMPTY_MONTHLY_SNAPSHOT;
  },
};

/**
 * `isActive` ausente = ativo. `cancelledOn` é o dia do cancelamento
 * (`AAAA-MM-DD`, São Paulo); cancelado sem ele não conta em mês nenhum (F38).
 */
export type MemoryDeliveryClient = DeliveryClientRow & { isActive?: boolean; cancelledOn?: string | null };

function situacaoDe(client: MemoryDeliveryClient): SituacaoNoCadastro {
  return { isActive: client.isActive !== false, cancelledOn: client.cancelledOn ?? null };
}
export type MemoryDeliveryContract = DeliveryContractRow & { referenceMonth: string };
export type MemoryDeliveryItem = DeliveryItemRow & {
  referenceMonth: string;
  scheduledOn: string | null;
  /** F37 (planejamento): sem eles, derivados de `scheduledOn`/`isCompleted`. */
  id?: string;
  scheduledAt?: string | null;
  completedAt?: string | null;
  title?: string | null;
};
export type MemoryDeliveryOpened = { clientId: string; referenceMonth: string };

export type MemoryDeliveryData = {
  clients?: readonly MemoryDeliveryClient[];
  contracts?: readonly MemoryDeliveryContract[];
  items?: readonly MemoryDeliveryItem[];
  opened?: readonly MemoryDeliveryOpened[];
  contentContractClientIds?: readonly string[];
  /** F37: a cota do cadastro (`client_quotas`), por tipo. */
  registry?: readonly { clientId: string; contentType: string; quantity: number }[];
  /**
   * F37: a pasta (time) das listas de cada cliente. `companyId` é a empresa do
   * ESPAÇO da pasta (no banco, `spaces.category_id`): sem ele a pasta vale em
   * qualquer recorte, como nos testes de antes.
   */
  folders?: readonly { clientId: string; folderId: string; folderName: string; companyId?: string }[];
  /** F37: a carteira individual (`user_clients`). */
  portfolio?: readonly { clientId: string; userId: string; name: string }[];
  /** `get_month_attention`: o ritual de cada mês aberto (quando e por quem). Quem está aqui tem o mês aberto. */
  ritual?: readonly (PlanningRitualRow & { referenceMonth: string })[];  /** `get_calendar`: os compromissos (reunião, gravação, viagem). A peça sai de `items`. */
  appointments?: readonly { id: string; clientId: string; day: string; time: string | null; title: string; notes?: string | null }[];
};

/**
 * O dia da peça no dublê: o de SÃO PAULO do instante (`scheduledAt`) quando o
 * item o traz — o mesmo dia do SQL (`diaDaPecaSql`) —, senão o `scheduledOn`
 * escrito à mão. Sem isto o dublê contava `scheduledOn` mesmo com o instante
 * dizendo outro dia, e a prova "SQL e memória não discordam" ficava cega à
 * peça das 22h.
 */
function diaDoItem(row: MemoryDeliveryItem): string | null {
  if (row.scheduledAt !== undefined) return row.scheduledAt === null ? null : diaNaAgencia(row.scheduledAt);
  return row.scheduledOn;
}

function clientVisible(scope: WorkScope, companyId: string, clientId: string): boolean {
  if (!companyAllowed(scope.companies, companyId)) return false;
  if (scope.clients === 'none') return false;
  if (scope.clients === 'all') return true;
  return scope.clients.has(clientId);
}

export class MemoryDeliveryCatalog implements DeliveryCatalog {
  private readonly clients: readonly MemoryDeliveryClient[];
  private readonly contracts: readonly MemoryDeliveryContract[];
  private readonly items: readonly MemoryDeliveryItem[];
  private readonly opened: readonly MemoryDeliveryOpened[];
  private readonly quotas: ReadonlySet<string>;
  private readonly registry: NonNullable<MemoryDeliveryData['registry']>;
  private readonly folders: NonNullable<MemoryDeliveryData['folders']>;
  private readonly portfolio: NonNullable<MemoryDeliveryData['portfolio']>;
  private readonly ritual: NonNullable<MemoryDeliveryData['ritual']>;
  private readonly appointments: NonNullable<MemoryDeliveryData['appointments']>;

  constructor(data: MemoryDeliveryData = {}) {
    this.appointments = data.appointments ?? [];
    this.ritual = data.ritual ?? [];
    this.registry = data.registry ?? [];
    this.folders = data.folders ?? [];
    this.portfolio = data.portfolio ?? [];
    this.clients = data.clients ?? [];
    this.contracts = data.contracts ?? [];
    this.items = data.items ?? [];
    this.opened = data.opened ?? [];
    this.quotas = new Set(data.contentContractClientIds ?? []);
  }

  async load(scope: WorkScope, period: DeliveryPeriodQuery): Promise<DeliverySnapshot> {
    const months = new Set(period.months);
    const firstMonth = [...period.months].sort()[0] ?? period.from;
    // F38, Fase 5 — o mesmo recorte do SQL: o cliente entra se conta no
    // primeiro mês do período; cada linha, se ele conta no mês dela.
    const visible = this.clients.filter(
      (client) => clientVisible(scope, client.companyId, client.id) && clienteContaNoMes(situacaoDe(client), firstMonth),
    );
    const clients = visible.map(({ id, name, companyId, companyName }) => ({ id, name, companyId, companyName }));
    const situacao = new Map(visible.map((client) => [client.id, situacaoDe(client)]));
    const allowed = new Set(clients.map((client) => client.id));
    const conta = (clientId: string, month: string) => {
      const sit = situacao.get(clientId);
      return sit !== undefined && clienteContaNoMes(sit, month);
    };
    const inWindow = (day: string | null) =>
      day !== null && day >= period.from && day <= period.to;

    const inPeriodMap = new Map<string, { scheduled: number; completed: number }>();
    for (const item of this.items) {
      if (!allowed.has(item.clientId)) continue;
      const dia = diaDoItem(item);
      if (!inWindow(dia)) continue;
      if (!conta(item.clientId, dia as string)) continue;
      const current = inPeriodMap.get(item.clientId) ?? { scheduled: 0, completed: 0 };
      current.scheduled += 1;
      if (item.isCompleted) current.completed += 1;
      inPeriodMap.set(item.clientId, current);
    }

    const noMes = (row: { clientId: string; referenceMonth: string }) =>
      allowed.has(row.clientId) && months.has(row.referenceMonth) && conta(row.clientId, row.referenceMonth);
    return {
      clients,
      contracts: this.contracts.filter(noMes),
      items: this.items.filter(noMes),
      openedClientIds: [...new Set(this.opened.filter(noMes).map((row) => row.clientId))],
      contentContractClientIds: [...this.quotas].filter((id) => allowed.has(id)),
      inPeriod: [...inPeriodMap.entries()].map(([clientId, counts]) => ({ clientId, ...counts })),
    };
  }

  /** O dublê de `loadCalendarInTx`: só cliente ativo do recorte; o dia da peça é o de São Paulo. */
  async loadCalendar(
    scope: WorkScope,
    period: { from: string; to: string; clientId?: string },
  ): Promise<DeliveryCalendarSnapshot> {
    const clients = new Map(
      this.clients
        .filter((client) => client.isActive !== false && clientVisible(scope, client.companyId, client.id))
        .map((client) => [client.id, client]),
    );
    const entries: CalendarEntryRow[] = [];
    this.items.forEach((row, index) => {
      const client = clients.get(row.clientId);
      if (!client) return;
      const scheduledAt =
        row.scheduledAt !== undefined
          ? row.scheduledAt
          : row.scheduledOn === null
            ? null
            : `${row.scheduledOn}T12:00:00.000Z`;
      if (scheduledAt === null) return;
      const day = diaNaAgencia(scheduledAt);
      if (day < period.from || day > period.to) return;
      entries.push({
        kind: 'delivery',
        id: row.id ?? `item-${index}`,
        clientId: client.id,
        clientName: client.name,
        day,
        time: null,
        contentType: row.contentType,
        title: row.title ?? null,
        isCompleted: row.isCompleted,
        isExtra: row.isExtra,
      });
    });
    for (const row of this.appointments) {
      const client = clients.get(row.clientId);
      if (!client || row.day < period.from || row.day > period.to) continue;
      entries.push({
        kind: 'appointment',
        id: row.id,
        clientId: client.id,
        clientName: client.name,
        day: row.day,
        time: row.time,
        contentType: null,
        title: row.title,
        isCompleted: false,
        isExtra: false,
      });
    }
    const confirmado = period.clientId === undefined ? undefined : clients.get(period.clientId);
    return {
      clients: confirmado
        ? [{ id: confirmado.id, name: confirmado.name, companyId: confirmado.companyId, companyName: confirmado.companyName }]
        : [],
      entries,
    };
  }

  async loadPlanning(scope: WorkScope, month: string): Promise<DeliveryPlanningSnapshot> {
    // Só cliente ATIVO, como o SQL (`c.is_active`): cliente cancelado fica fora do planejamento.
    const clients = this.clients.filter(
      (client) => client.isActive !== false && clientVisible(scope, client.companyId, client.id),
    );
    const allowed = new Set(clients.map((client) => client.id));
    const ritual = this.ritual.filter((row) => row.referenceMonth === month && allowed.has(row.clientId));
    const opened = new Set<string>(
      [
        ...this.opened.filter((row) => row.referenceMonth === month).map((row) => row.clientId),
        ...this.contracts.filter((row) => row.referenceMonth === month).map((row) => row.clientId),
        ...ritual.map((row) => row.clientId),
      ].filter((id) => allowed.has(id)),
    );
    const contracts: DeliveryPlanningSnapshot['contracts'][number][] = [];
    for (const clientId of opened) {
      const rows = this.contracts.filter((row) => row.clientId === clientId && row.referenceMonth === month);
      if (rows.length === 0) contracts.push({ clientId, contentType: null, quantity: 0 });
      for (const row of rows) contracts.push({ clientId, contentType: row.contentType, quantity: row.quantity });
    }
    return {
      clients,
      contracts,
      ritual: [...opened].map((clientId) => {
        const marcos = ritual.find((row) => row.clientId === clientId);
        return {
          clientId,
          planningDoneAt: marcos?.planningDoneAt ?? null,
          planningDoneBy: marcos?.planningDoneBy ?? null,
          clientApprovedAt: marcos?.clientApprovedAt ?? null,
          clientApprovedBy: marcos?.clientApprovedBy ?? null,
        };
      }),
      registry: this.registry.filter((row) => allowed.has(row.clientId)),
      // O dublê do `scopedSpace`: a pasta cujo espaço está fora do recorte não sai.
      folders: this.folders
        .filter(
          (row) =>
            allowed.has(row.clientId) && (row.companyId === undefined || companyAllowed(scope.companies, row.companyId)),
        )
        .map(({ clientId, folderId, folderName }) => ({ clientId, folderId, folderName })),
      portfolio: this.portfolio.filter((row) => allowed.has(row.clientId)),
      items: this.items
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => allowed.has(row.clientId) && row.referenceMonth === month)
        .map(({ row, index }) => {
          const scheduledAt =
            row.scheduledAt !== undefined
              ? row.scheduledAt
              : row.scheduledOn === null
                ? null
                : `${row.scheduledOn}T12:00:00.000Z`;
          return {
            id: row.id ?? `item-${index}`,
            clientId: row.clientId,
            contentType: row.contentType,
            scheduledAt,
            completedAt:
              row.completedAt !== undefined
                ? row.completedAt
                : row.isCompleted
                  ? (scheduledAt ?? `${row.referenceMonth}T12:00:00.000Z`)
                  : null,
            isExtra: row.isExtra,
            title: row.title ?? null,
          };
        }),
    };
  }

  /**
   * O dublê de `readWeeklyPieces`: só cliente ativo; peça com dia vai inteira (a
   * regra fica com o que importa), peça sem dia só a do mês corrente — o mesmo
   * recorte do SQL. `scheduledOn` vira meio-dia UTC (09h em São Paulo).
   */
  async loadDeliveryStatus(scope: WorkScope, now: Date): Promise<DeliveryStatusSnapshot> {
    const clients = this.clients
      .filter((client) => client.isActive !== false && clientVisible(scope, client.companyId, client.id))
      .map(({ id, name, companyId, companyName }) => ({ id, name, companyId, companyName }));
    const allowed = new Set(clients.map((client) => client.id));
    const currentMonth = firstDayOfMonth(civilDate(now, AGENCY_TIMEZONE));
    const pieces = new Map<string, WeeklyPiece[]>();
    for (const row of this.items) {
      if (!allowed.has(row.clientId)) continue;
      const scheduledAt =
        row.scheduledAt !== undefined
          ? row.scheduledAt
          : row.scheduledOn === null
            ? null
            : `${row.scheduledOn}T12:00:00.000Z`;
      if (scheduledAt === null && row.referenceMonth !== currentMonth) continue;
      const list = pieces.get(row.clientId) ?? [];
      list.push({ scheduledAt, isCompleted: row.isCompleted, isExtra: row.isExtra });
      pieces.set(row.clientId, list);
    }
    return { clients, pieces };
  }

  async loadMonthly(scope: WorkScope, period: DeliveryPeriodQuery): Promise<DeliveryMonthlySnapshot> {
    const months = new Set(period.months);
    const clients: DeliveryPeriodClientRow[] = this.clients
      .filter((client) => clientVisible(scope, client.companyId, client.id))
      .map((client) => ({
        id: client.id,
        name: client.name,
        companyId: client.companyId,
        companyName: client.companyName,
        ...situacaoDe(client),
      }));
    const allowed = new Set(clients.map((client) => client.id));
    // F38, Fase 5 — as linhas só dos meses em que o cliente conta, como no SQL.
    const situacao = new Map(clients.map((client) => [client.id, client]));
    const conta = (clientId: string, month: string) => {
      const sit = situacao.get(clientId);
      return sit !== undefined && clienteContaNoMes(sit, month);
    };
    const inWindow = (day: string | null): day is string =>
      day !== null && day >= period.from && day <= period.to;

    const inPeriodMap = new Map<string, DeliveryPeriodCount & { month: string }>();
    for (const item of this.items) {
      if (!allowed.has(item.clientId)) continue;
      const dia = diaDoItem(item);
      if (!inWindow(dia)) continue;
      const month = firstDayOfMonth(dia);
      if (!conta(item.clientId, month)) continue;
      const key = `${item.clientId}|${month}`;
      const current = inPeriodMap.get(key) ?? { clientId: item.clientId, month, scheduled: 0, completed: 0 };
      current.scheduled += 1;
      if (item.isCompleted) current.completed += 1;
      inPeriodMap.set(key, current);
    }

    const opened = new Map<string, { clientId: string; month: string }>();
    for (const row of this.opened) {
      if (!allowed.has(row.clientId) || !months.has(row.referenceMonth)) continue;
      if (!conta(row.clientId, row.referenceMonth)) continue;
      opened.set(`${row.clientId}|${row.referenceMonth}`, { clientId: row.clientId, month: row.referenceMonth });
    }

    return {
      clients,
      contracts: this.contracts
        .filter((row) => allowed.has(row.clientId) && months.has(row.referenceMonth) && conta(row.clientId, row.referenceMonth))
        .map((row) => ({
          clientId: row.clientId,
          month: row.referenceMonth,
          contentType: row.contentType,
          quantity: row.quantity,
        })),
      items: this.items
        .filter((row) => allowed.has(row.clientId) && months.has(row.referenceMonth) && conta(row.clientId, row.referenceMonth))
        .map((row) => ({
          clientId: row.clientId,
          month: row.referenceMonth,
          contentType: row.contentType,
          isExtra: row.isExtra,
          isCompleted: row.isCompleted,
        })),
      opened: [...opened.values()],
      contentContractClientIds: [...this.quotas].filter((id) => allowed.has(id)),
      inPeriod: [...inPeriodMap.values()],
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

function scopedClient(tx: Tx, scope: WorkScope) {
  const companies = companyList(scope);
  const clients = clientList(scope);
  // F31, Fase 3b — com recorte `all`, o cliente de empresa omitida sai do
  // relatório de entrega e da tendência (com `ids` ela já saiu da lista). Sem
  // omitida o trecho não existe: a consulta fica a de antes.
  const omitidas = scope.companies.kind === 'all' ? omittedIn(scope.companies) : [];
  return tx`
    ideworks.integration_allows_company(c.category_id)
    and (${companies}::uuid[] is null or c.category_id = any(${arrayOuNulo(companies)}::uuid[]))
    and ideworks.integration_allows_client(c.id)
    and (${clients}::uuid[] is null or c.id = any(${arrayOuNulo(clients)}::uuid[]))${
      omitidas.length === 0 ? tx`` : tx`
    and not (c.category_id = any(${arrayOuNulo(omitidas)}::uuid[]))`
    }`;
}

/**
 * O mesmo recorte de empresa do `scopedClient`, sobre o ESPAÇO `sp` de uma
 * pasta (time): a concessão (`integration_allows_company` + a lista de empresas
 * dela) e, com recorte `all`, a empresa omitida (F31) fora. A pasta é de um
 * espaço, e o espaço é de uma empresa — a do CLIENTE ligado à lista pode ser
 * outra. Sem este recorte, o nome do time de um espaço omitido ou fora da
 * concessão virava "responsável" de um cliente que está no recorte.
 */
function scopedSpace(tx: Tx, scope: WorkScope) {
  const companies = companyList(scope);
  const omitidas = scope.companies.kind === 'all' ? omittedIn(scope.companies) : [];
  return tx`
    ideworks.integration_allows_company(sp.category_id)
    and (${companies}::uuid[] is null or sp.category_id = any(${arrayOuNulo(companies)}::uuid[]))${
      omitidas.length === 0 ? tx`` : tx`
    and not (sp.category_id = any(${arrayOuNulo(omitidas)}::uuid[]))`
    }`;
}

export class SqlDeliveryCatalog implements DeliveryCatalog {
  constructor(
    private readonly env: ServerEnv,
    private readonly actor: Actor,
  ) {}

  /** Conexão emprestada da requisição (F22, Fase 2); o ator continua sendo o deste porto. */
  private async withTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return borrowSql(this.env, 'entrega', (sql) => withActor(sql, this.actor, work));
  }

  async load(scope: WorkScope, period: DeliveryPeriodQuery): Promise<DeliverySnapshot> {
    if (scope.companies.kind === 'none' || scope.clients === 'none') return EMPTY_SNAPSHOT;
    const meses = [...period.months];
    const primeiroMes = [...period.months].sort()[0] ?? period.from;
    return this.withTx(async (tx) => {
      // F38, Fase 5 — cliente cancelado entra se conta no PRIMEIRO mês do
      // período (cancelou nele ou depois), e cada linha só se ele conta no mês
      // dela: a regra única de `cliente-no-periodo.ts`.
      const clients = await tx`
        select c.id::text as id, c.name,
               c.category_id::text as company_id, cat.name as company_name
          from ideworks.clients c
          join ideworks.client_categories cat on cat.id = c.category_id
         where ${scopedClient(tx, scope)}
           and ${clienteNoMesSql(tx, tx`c.id`, tx`${primeiroMes}::date`)}
         order by lower(c.name), c.id`;

      const contratos = await tx`
        select mc.client_id::text as client_id, i.content_type, i.quantity
          from ideworks.month_contracts mc
          join ideworks.month_contract_items i on i.contract_id = mc.id
          join ideworks.clients c on c.id = mc.client_id
         where mc.reference_month = any(${meses}::date[])
           and ${scopedClient(tx, scope)}
           and ${clienteNoMesSql(tx, tx`c.id`, tx`mc.reference_month`)}`;

      const abertos = await tx`
        select distinct mc.client_id::text as client_id
          from ideworks.month_contracts mc
          join ideworks.clients c on c.id = mc.client_id
         where mc.reference_month = any(${meses}::date[])
           and ${scopedClient(tx, scope)}
           and ${clienteNoMesSql(tx, tx`c.id`, tx`mc.reference_month`)}`;

      const cotas = await tx`
        select distinct cq.client_id::text as client_id
          from ideworks.client_quotas cq
          join ideworks.clients c on c.id = cq.client_id
         where cq.quantity > 0
           and ${scopedClient(tx, scope)}`;

      const itens = await tx`
        select i.client_id::text as client_id, i.content_type, i.is_extra,
               (i.completed_at is not null) as is_completed
          from ideworks.content_items i
          join ideworks.clients c on c.id = i.client_id
         where i.reference_month = any(${meses}::date[])
           and ${scopedClient(tx, scope)}
           and ${clienteNoMesSql(tx, tx`c.id`, tx`i.reference_month`)}`;

      // O DIA DA PEÇA É O DE SÃO PAULO (conferência de 09/10/2026) — o do
      // Calendário, do Planejamento e do Painel. Em UTC, a peça das 22h do
      // último dia do mês contava no mês seguinte só aqui.
      const diaDaPeca = () => diaDaPecaSql(tx, tx`i.scheduled_at`);
      const noPeriodo = await tx`
        select i.client_id::text as client_id,
               count(*)::int as scheduled,
               count(*) filter (where i.completed_at is not null)::int as completed
          from ideworks.content_items i
          join ideworks.clients c on c.id = i.client_id
         where i.scheduled_at is not null
           and ${diaDaPeca()} between ${period.from} and ${period.to}
           and ${scopedClient(tx, scope)}
           and ${clienteNoMesSql(tx, tx`c.id`, diaDaPeca())}
         group by i.client_id`;

      return {
        clients: clients.map((row) => ({
          id: row.id as string,
          name: row.name as string,
          companyId: row.company_id as string,
          companyName: row.company_name as string,
        })),
        contracts: (
          contratos as unknown as Array<{ client_id: string; content_type: string; quantity: number }>
        ).map((row) => ({
          clientId: row.client_id,
          contentType: row.content_type,
          quantity: Number(row.quantity),
        })),
        items: (
          itens as unknown as Array<{
            client_id: string;
            content_type: string;
            is_extra: boolean;
            is_completed: boolean;
          }>
        ).map((row) => ({
          clientId: row.client_id,
          contentType: row.content_type,
          isExtra: row.is_extra === true,
          isCompleted: row.is_completed === true,
        })),
        openedClientIds: (abertos as unknown as Array<{ client_id: string }>).map((row) => row.client_id),
        contentContractClientIds: (cotas as unknown as Array<{ client_id: string }>).map(
          (row) => row.client_id,
        ),
        inPeriod: (
          noPeriodo as unknown as Array<{ client_id: string; scheduled: number; completed: number }>
        ).map((row) => ({
          clientId: row.client_id,
          scheduled: Number(row.scheduled),
          completed: Number(row.completed),
        })),
      };
    });
  }

  async loadCalendar(
    scope: WorkScope,
    period: { from: string; to: string; clientId?: string },
  ): Promise<DeliveryCalendarSnapshot> {
    if (scope.companies.kind === 'none' || scope.clients === 'none') return { clients: [], entries: [] };
    // Mesma guarda do `loadMonthly`: id que não é UUID não existe no banco.
    if (scope.clients !== 'all' && [...scope.clients].some((id) => !INTEGRATION_UUID.test(id))) {
      const validos = new Set([...scope.clients].filter((id) => INTEGRATION_UUID.test(id)));
      if (validos.size === 0) return { clients: [], entries: [] };
      scope = { ...scope, clients: validos };
    }
    const recorte = scope;
    return this.withTx((tx) => loadCalendarInTx(tx, recorte, period));
  }

  async loadPlanning(scope: WorkScope, month: string): Promise<DeliveryPlanningSnapshot> {
    if (scope.companies.kind === 'none' || scope.clients === 'none') return EMPTY_PLANNING_SNAPSHOT;
    // Mesma guarda do `loadMonthly`: id que não é UUID não existe no banco.
    if (scope.clients !== 'all' && [...scope.clients].some((id) => !INTEGRATION_UUID.test(id))) {
      const validos = new Set([...scope.clients].filter((id) => INTEGRATION_UUID.test(id)));
      if (validos.size === 0) return EMPTY_PLANNING_SNAPSHOT;
      scope = { ...scope, clients: validos };
    }
    const recorte = scope;
    return this.withTx((tx) => loadPlanningInTx(tx, recorte, month));
  }

  /**
   * F38 — os clientes ativos do recorte (`scopedClient`, o mesmo das outras
   * leituras: concessão, empresa e omitidas no `where`) e as peças pela MESMA
   * leitura do Painel (`readWeeklyPieces`). Nenhuma consulta de peça mora aqui.
   */
  async loadDeliveryStatus(scope: WorkScope, now: Date): Promise<DeliveryStatusSnapshot> {
    if (scope.companies.kind === 'none' || scope.clients === 'none') return EMPTY_DELIVERY_STATUS_SNAPSHOT;
    // Mesma guarda do `loadMonthly`: id que não é UUID não existe no banco.
    if (scope.clients !== 'all' && [...scope.clients].some((id) => !INTEGRATION_UUID.test(id))) {
      const validos = new Set([...scope.clients].filter((id) => INTEGRATION_UUID.test(id)));
      if (validos.size === 0) return EMPTY_DELIVERY_STATUS_SNAPSHOT;
      scope = { ...scope, clients: validos };
    }
    const recorte = scope;
    return this.withTx((tx) => loadDeliveryStatusInTx(tx, recorte, now));
  }

  async loadMonthly(scope: WorkScope, period: DeliveryPeriodQuery): Promise<DeliveryMonthlySnapshot> {
    if (scope.companies.kind === 'none' || scope.clients === 'none') return EMPTY_MONTHLY_SNAPSHOT;
    // Id que não é UUID não existe no banco: responder vazio (→ recusa de quem
    // chama) em vez de deixar o `::uuid[]` estourar como erro de servidor.
    if (scope.clients !== 'all' && [...scope.clients].some((id) => !INTEGRATION_UUID.test(id))) {
      const validos = new Set([...scope.clients].filter((id) => INTEGRATION_UUID.test(id)));
      if (validos.size === 0) return EMPTY_MONTHLY_SNAPSHOT;
      scope = { ...scope, clients: validos };
    }
    const recorte = scope;
    return this.withTx((tx) => loadMonthlyInTx(tx, recorte, period));
  }
}

/**
 * F26.7 — `loadMonthly` do catálogo SQL. As MESMAS seis leituras de `load`, com
 * o mês em cada linha: o número de consultas não cresce com os meses, e o
 * recorte (`scopedClient`) corta clientes fora da concessão e meses fora do
 * pedido no próprio `where` — nada fora do pedido é lido para depois ser
 * descartado (a lição do `limit` que não cortava antes do trabalho pesado).
 */
async function loadMonthlyInTx(
  tx: Tx,
  scope: WorkScope,
  period: DeliveryPeriodQuery,
): Promise<DeliveryMonthlySnapshot> {
  const meses = [...period.months];
  // F38, Fase 5 — todos os clientes do recorte, com a situação no cadastro (o
  // mês a mês decide em que meses cada um entra); as linhas, só dos meses em
  // que o cliente conta (`clienteNoMesSql`).
  const clients = await tx`
    select c.id::text as id, c.name,
           c.category_id::text as company_id, cat.name as company_name,
           c.is_active,
           to_char(c.inactive_at at time zone ${AGENCY_TIMEZONE}, 'YYYY-MM-DD') as cancelled_on
      from ideworks.clients c
      join ideworks.client_categories cat on cat.id = c.category_id
     where ${scopedClient(tx, scope)}
     order by lower(c.name), c.id`;

  const contratos = await tx`
    select mc.client_id::text as client_id, to_char(mc.reference_month, 'YYYY-MM-DD') as month,
           i.content_type, i.quantity
      from ideworks.month_contracts mc
      join ideworks.month_contract_items i on i.contract_id = mc.id
      join ideworks.clients c on c.id = mc.client_id
     where mc.reference_month = any(${meses}::date[])
       and ${scopedClient(tx, scope)}
       and ${clienteNoMesSql(tx, tx`c.id`, tx`mc.reference_month`)}`;

  const abertos = await tx`
    select distinct mc.client_id::text as client_id, to_char(mc.reference_month, 'YYYY-MM-DD') as month
      from ideworks.month_contracts mc
      join ideworks.clients c on c.id = mc.client_id
     where mc.reference_month = any(${meses}::date[])
       and ${scopedClient(tx, scope)}
       and ${clienteNoMesSql(tx, tx`c.id`, tx`mc.reference_month`)}`;

  const cotas = await tx`
    select distinct cq.client_id::text as client_id
      from ideworks.client_quotas cq
      join ideworks.clients c on c.id = cq.client_id
     where cq.quantity > 0
       and ${scopedClient(tx, scope)}`;

  const itens = await tx`
    select i.client_id::text as client_id, to_char(i.reference_month, 'YYYY-MM-DD') as month,
           i.content_type, i.is_extra, (i.completed_at is not null) as is_completed
      from ideworks.content_items i
      join ideworks.clients c on c.id = i.client_id
     where i.reference_month = any(${meses}::date[])
       and ${scopedClient(tx, scope)}
       and ${clienteNoMesSql(tx, tx`c.id`, tx`i.reference_month`)}`;

  // O mesmo corte de dia do relatório: o DIA DE SÃO PAULO da peça (`diaDaPecaSql`).
  // Agrupar pelo mês desse dia dá, mês a mês, a contagem que o relatório daria
  // pedido com o primeiro e o último dia daquele mês.
  const diaDaPeca = () => diaDaPecaSql(tx, tx`i.scheduled_at`);
  const noPeriodo = await tx`
    select i.client_id::text as client_id,
           to_char(date_trunc('month', ${diaDaPeca()}), 'YYYY-MM-DD') as month,
           count(*)::int as scheduled,
           count(*) filter (where i.completed_at is not null)::int as completed
      from ideworks.content_items i
      join ideworks.clients c on c.id = i.client_id
     where i.scheduled_at is not null
       and ${diaDaPeca()} between ${period.from} and ${period.to}
       and ${scopedClient(tx, scope)}
       and ${clienteNoMesSql(tx, tx`c.id`, diaDaPeca())}
     group by 1, 2`;

  return {
    clients: clients.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      companyId: row.company_id as string,
      companyName: row.company_name as string,
      isActive: row.is_active !== false,
      cancelledOn: (row.cancelled_on as string | null) ?? null,
    })),
    contracts: (
      contratos as unknown as Array<{ client_id: string; month: string; content_type: string; quantity: number }>
    ).map((row) => ({
      clientId: row.client_id,
      month: row.month,
      contentType: row.content_type,
      quantity: Number(row.quantity),
    })),
    items: (
      itens as unknown as Array<{
        client_id: string;
        month: string;
        content_type: string;
        is_extra: boolean;
        is_completed: boolean;
      }>
    ).map((row) => ({
      clientId: row.client_id,
      month: row.month,
      contentType: row.content_type,
      isExtra: row.is_extra === true,
      isCompleted: row.is_completed === true,
    })),
    opened: (abertos as unknown as Array<{ client_id: string; month: string }>).map((row) => ({
      clientId: row.client_id,
      month: row.month,
    })),
    contentContractClientIds: (cotas as unknown as Array<{ client_id: string }>).map((row) => row.client_id),
    inPeriod: (
      noPeriodo as unknown as Array<{ client_id: string; month: string; scheduled: number; completed: number }>
    ).map((row) => ({
      clientId: row.client_id,
      month: row.month,
      scheduled: Number(row.scheduled),
      completed: Number(row.completed),
    })),
  };
}

/**
 * F37 — `loadPlanning` do catálogo SQL. As MESMAS seis leituras de
 * `readPlanningWeeks` (a rota `GET /planning/weeks` do site), cada uma com o
 * recorte da concessão (`scopedClient`) e só cliente ativo, no próprio `where`:
 * cliente fora da concessão ou de empresa omitida nunca é lido.
 */
async function loadPlanningInTx(tx: Tx, scope: WorkScope, month: string): Promise<DeliveryPlanningSnapshot> {
  const clients = await tx`
    select c.id::text as id, c.name,
           c.category_id::text as company_id, cat.name as company_name
      from ideworks.clients c
      join ideworks.client_categories cat on cat.id = c.category_id
     where c.is_active
       and ${scopedClient(tx, scope)}
     order by lower(c.name), c.id`;

  // Junção à esquerda: mês aberto sem item aparece como "aberto, cota zero".
  // As colunas do ritual (quando e por quem) vêm na MESMA leitura — o mês
  // aberto é a linha do contrato —, repetidas em cada item e juntadas por
  // cliente abaixo. O token do link de aprovação do cliente NÃO é lido.
  const contratos = await tx`
    select mc.client_id::text as client_id, i.content_type, i.quantity,
           mc.planning_done_at, mc.planning_done_by::text as planning_done_by,
           case when mc.planning_done_by is null then null
                else ideworks.display_name(mc.planning_done_by) end as planning_done_by_name,
           mc.client_approved_at, mc.client_approved_by::text as client_approved_by,
           case when mc.client_approved_by is null then null
                else ideworks.display_name(mc.client_approved_by) end as client_approved_by_name
      from ideworks.month_contracts mc
      left join ideworks.month_contract_items i on i.contract_id = mc.id
      join ideworks.clients c on c.id = mc.client_id
     where mc.reference_month = ${month}::date
       and c.is_active
       and ${scopedClient(tx, scope)}`;

  const cadastro = await tx`
    select cq.client_id::text as client_id, cq.content_type, cq.quantity
      from ideworks.client_quotas cq
      join ideworks.clients c on c.id = cq.client_id
     where cq.quantity > 0
       and c.is_active
       and ${scopedClient(tx, scope)}`;

  // A pasta é de um ESPAÇO, e o espaço de uma empresa que pode não ser a do
  // cliente: o nome do time só sai se o espaço dele também está no recorte
  // (concessão e omitidas), senão virava "responsável" do cliente.
  const pastas = await tx`
    select distinct l.client_id::text as client_id, f.id::text as folder_id, f.name as folder_name
      from ideworks.lists l
      join ideworks.folders f on f.id = l.folder_id
      join ideworks.spaces sp on sp.id = f.space_id
      join ideworks.clients c on c.id = l.client_id
     where l.archived_at is null
       and f.archived_at is null
       and c.is_active
       and ${scopedClient(tx, scope)}
       and ${scopedSpace(tx, scope)}
     order by f.name`;

  const carteira = await tx`
    select uc.client_id::text as client_id, uc.user_id::text as user_id,
           ideworks.display_name(uc.user_id) as name
      from ideworks.user_clients uc
      join ideworks.clients c on c.id = uc.client_id
     where c.is_active
       and ${scopedClient(tx, scope)}
     order by 3`;

  // Só o mês de REFERÊNCIA, como a grade semanal da ficha.
  const itens = await tx`
    select i.id::text as id, i.client_id::text as client_id, i.content_type,
           i.scheduled_at, i.completed_at, i.is_extra, i.title
      from ideworks.content_items i
      join ideworks.clients c on c.id = i.client_id
     where i.reference_month = ${month}::date
       and c.is_active
       and ${scopedClient(tx, scope)}
     order by i.scheduled_at nulls last, i.created_at`;

  const iso = (value: unknown): string | null => (value ? new Date(value as string).toISOString() : null);
  const quem = (id: unknown, name: unknown): { id: string; name: string } | null =>
    typeof id === 'string' && id.length > 0 ? { id, name: ((name as string | null) ?? '').trim() || 'Pessoa sem nome' } : null;
  const ritual = new Map<string, PlanningRitualRow>();
  for (const row of contratos) {
    const clientId = row.client_id as string;
    if (ritual.has(clientId)) continue;
    ritual.set(clientId, {
      clientId,
      planningDoneAt: iso(row.planning_done_at),
      planningDoneBy: quem(row.planning_done_by, row.planning_done_by_name),
      clientApprovedAt: iso(row.client_approved_at),
      clientApprovedBy: quem(row.client_approved_by, row.client_approved_by_name),
    });
  }
  return {
    clients: clients.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      companyId: row.company_id as string,
      companyName: row.company_name as string,
    })),
    contracts: contratos.map((row) => ({
      clientId: row.client_id as string,
      contentType: (row.content_type as string | null) ?? null,
      quantity: Number(row.quantity ?? 0),
    })),
    ritual: [...ritual.values()],
    registry: cadastro.map((row) => ({
      clientId: row.client_id as string,
      contentType: row.content_type as string,
      quantity: Number(row.quantity),
    })),
    folders: pastas.map((row) => ({
      clientId: row.client_id as string,
      folderId: row.folder_id as string,
      folderName: (row.folder_name as string | null) ?? '',
    })),
    portfolio: carteira.map((row) => ({
      clientId: row.client_id as string,
      userId: row.user_id as string,
      name: (row.name as string | null) ?? '',
    })),
    items: itens.map((row) => ({
      id: row.id as string,
      clientId: row.client_id as string,
      contentType: row.content_type as string,
      scheduledAt: iso(row.scheduled_at),
      completedAt: iso(row.completed_at),
      isExtra: row.is_extra === true,
      title: (row.title as string | null) ?? null,
    })),
  };
}

/** O dia seguinte, em `AAAA-MM-DD` (o fim do calendário é exclusivo no SQL). */
function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * G2 — `loadCalendar` do catálogo SQL: as MESMAS duas leituras do calendário da
 * tela (`readCalendar` + `readAppointments`: a peça pelo dia de São Paulo, o
 * compromisso pelo `day`), sem o `recorteDasOmitidas` do ator humano — aqui o
 * recorte é o da concessão (`scopedClient`: empresa, cliente e omitidas no
 * `where`) e só cliente ATIVO. As observações do compromisso não são lidas.
 */
export async function loadCalendarInTx(
  tx: Tx,
  scope: WorkScope,
  period: { from: string; to: string; clientId?: string },
): Promise<DeliveryCalendarSnapshot> {
  const ate = diaSeguinte(period.to);
  const clientes =
    period.clientId === undefined || !INTEGRATION_UUID.test(period.clientId)
      ? []
      : await tx`
          select c.id::text as id, c.name,
                 c.category_id::text as company_id, cat.name as company_name
            from ideworks.clients c
            join ideworks.client_categories cat on cat.id = c.category_id
           where c.id = ${period.clientId}::uuid
             and c.is_active
             and ${scopedClient(tx, scope)}`;
  const pecas = await tx`
    select i.id::text as id, i.client_id::text as client_id, c.name as client_name,
           i.content_type,
           to_char(i.scheduled_at at time zone ${AGENCY_TIMEZONE}, 'YYYY-MM-DD') as day,
           i.title, i.is_extra, (i.completed_at is not null) as is_completed
      from ideworks.content_items i
      join ideworks.clients c on c.id = i.client_id
     where i.scheduled_at is not null
       and (i.scheduled_at at time zone ${AGENCY_TIMEZONE}) >= ${period.from}::timestamp
       and (i.scheduled_at at time zone ${AGENCY_TIMEZONE}) < ${ate}::timestamp
       and c.is_active
       and ${scopedClient(tx, scope)}
     order by i.scheduled_at, c.name`;
  const compromissos = await tx`
    select a.id::text as id, a.client_id::text as client_id, c.name as client_name,
           to_char(a.day, 'YYYY-MM-DD') as day,
           to_char(a.start_time, 'HH24:MI') as time,
           a.title
      from ideworks.appointments a
      join ideworks.clients c on c.id = a.client_id
     where a.day >= ${period.from}::date
       and a.day <= ${period.to}::date
       and c.is_active
       and ${scopedClient(tx, scope)}
     order by a.day, a.start_time nulls last, c.name`;
  return {
    clients: clientes.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      companyId: row.company_id as string,
      companyName: row.company_name as string,
    })),
    entries: [
      ...pecas.map(
        (row): CalendarEntryRow => ({
          kind: 'delivery',
          id: row.id as string,
          clientId: row.client_id as string,
          clientName: row.client_name as string,
          day: row.day as string,
          time: null,
          contentType: row.content_type as string,
          title: (row.title as string | null) ?? null,
          isCompleted: row.is_completed === true,
          isExtra: row.is_extra === true,
        }),
      ),
      ...compromissos.map(
        (row): CalendarEntryRow => ({
          kind: 'appointment',
          id: row.id as string,
          clientId: row.client_id as string,
          clientName: row.client_name as string,
          day: row.day as string,
          time: (row.time as string | null) ?? null,
          contentType: null,
          title: (row.title as string | null) ?? null,
          isCompleted: false,
          isExtra: false,
        }),
      ),
    ],
  };
}

/** F38 — `loadDeliveryStatus` do catálogo SQL. Exportada para a prova em banco. */
export async function loadDeliveryStatusInTx(
  tx: Tx,
  scope: WorkScope,
  now: Date,
): Promise<DeliveryStatusSnapshot> {
  const rows = await tx`
    select c.id::text as id, c.name,
           c.category_id::text as company_id, cat.name as company_name
      from ideworks.clients c
      join ideworks.client_categories cat on cat.id = c.category_id
     where c.is_active
       and ${scopedClient(tx, scope)}
     order by lower(c.name), c.id`;
  const clients = rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    companyId: row.company_id as string,
    companyName: row.company_name as string,
  }));
  const pieces = await readWeeklyPieces(
    tx,
    clients.map((client) => client.id),
    now,
  );
  return { clients, pieces };
}

export function createSqlDeliveryCatalog(env: ServerEnv, actor: Actor): DeliveryCatalog {
  return new SqlDeliveryCatalog(env, actor);
}

export type ReportCtx = {
  grant: IntegrationGrant;
  person: PersonAccess;
  origin: ExecutionOrigin;
  companies: readonly IntegrationCompany[];
  displayName: string;
  delivery: DeliveryCatalog;
  now?: Date;
};

export type ReportFailure = {
  ok: false;
  code: Extract<
    IntegrationErrorCode,
    'permission_denied' | 'invalid_input' | 'limit_exceeded' | 'data_incomplete'
  >;
  message: string;
};

export type ReportResult = { ok: true; body: GetDeliveryReportResponse } | ReportFailure;

const DENIED: ReportFailure = {
  ok: false,
  code: 'permission_denied',
  message: 'Fora do alcance desta integração.',
};

export function civilDate(now: Date, timeZone: string): string {
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

function lastInclusiveDayOfMonth(first: string): string {
  const start = new Date(`${first}T00:00:00Z`);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

function defaultMonth(now: Date): DeliveryPeriodBound {
  const first = firstDayOfMonth(civilDate(now, AGENCY_TIMEZONE));
  return { from: first, to: lastInclusiveDayOfMonth(first) };
}

type ResolvedPeriod =
  | {
      ok: true;
      requested: { from: string | null; to: string | null };
      effective: DeliveryPeriodBound;
      months: string[];
    }
  | ReportFailure;

export function resolveDeliveryPeriod(
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
  const effective = hasFrom ? { from: input.from as string, to: input.to as string } : defaultMonth(now);

  try {
    const months = monthsInRange(effective.from, effective.to);
    return { ok: true, requested, effective, months };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Período inválido.';
    if (message.includes('meses por vez')) {
      return {
        ok: false,
        code: 'limit_exceeded',
        message: `Intervalo grande demais: no máximo ${MAX_MESES_NO_INTERVALO} meses por vez.`,
      };
    }
    return { ok: false, code: 'invalid_input', message };
  }
}

export function coverageOf(
  person: PersonAccess,
  grant: IntegrationGrant,
): GetDeliveryReportResponse['coverage'] {
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

function groupByClient<T extends { clientId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.clientId) ?? [];
    list.push(row);
    map.set(row.clientId, list);
  }
  return map;
}

function emptyTypeTotals(): Record<ContentType, { contracted: number; delivered: number; extras: number }> {
  return {
    video: { contracted: 0, delivered: 0, extras: 0 },
    arte: { contracted: 0, delivered: 0, extras: 0 },
    foto: { contracted: 0, delivered: 0, extras: 0 },
    ads: { contracted: 0, delivered: 0, extras: 0 },
  };
}

/** Mesma regra de `resumirCarteira`: quem não é mensurável não entra na média. */
export function summarizeDelivery(
  clients: GetDeliveryReportResponse['clients'],
): GetDeliveryReportResponse['summary'] {
  const byType = emptyTypeTotals();
  let soma = 0;
  let measurable = 0;
  let scheduled = 0;
  let completed = 0;
  for (const client of clients) {
    scheduled += client.inPeriod.scheduled;
    completed += client.inPeriod.completed;
    if (!client.delivery.measurable) continue;
    measurable += 1;
    soma += client.delivery.level;
    for (const line of client.delivery.breakdown) {
      const alvo = byType[line.contentType];
      alvo.contracted += line.contracted;
      alvo.delivered += line.delivered;
      alvo.extras += line.extras;
    }
  }
  return {
    clients: clients.length,
    measurable,
    unmeasurable: clients.length - measurable,
    averageLevel: measurable === 0 ? null : Math.round(soma / measurable),
    inPeriod: { scheduled, completed },
    byType,
  };
}

function applyFormula(snapshot: DeliverySnapshot): GetDeliveryReportResponse['clients'] {
  const contracts = groupByClient(snapshot.contracts);
  const items = groupByClient(snapshot.items);
  const opened = new Set(snapshot.openedClientIds);
  const quotas = new Set(snapshot.contentContractClientIds);
  const inPeriod = new Map(snapshot.inPeriod.map((row) => [row.clientId, row]));

  const rows = snapshot.clients.map((client) => {
    const delivery: DeliveryResult = calculateDeliveryLevel(
      (contracts.get(client.id) ?? []).map(
        (row): ContractItem => ({ contentType: row.contentType, quantity: row.quantity }),
      ),
      (items.get(client.id) ?? []).map(
        (row): DeliveredItem => ({
          contentType: row.contentType,
          isExtra: row.isExtra,
          isCompleted: row.isCompleted,
        }),
      ),
      { monthOpened: opened.has(client.id), hasContentContract: quotas.has(client.id) },
    );
    return {
      id: client.id,
      name: client.name,
      company: { id: client.companyId, name: client.companyName },
      inPeriod: {
        scheduled: inPeriod.get(client.id)?.scheduled ?? 0,
        completed: inPeriod.get(client.id)?.completed ?? 0,
      },
      delivery,
    };
  });

  rows.sort((a, b) =>
    comparePageKey({ k: a.name.toLowerCase(), id: a.id }, { k: b.name.toLowerCase(), id: b.id }),
  );
  return rows;
}

export async function getDeliveryReport(
  ctx: ReportCtx,
  input: { from?: string; to?: string },
): Promise<ReportResult> {
  const now = ctx.now ?? new Date();
  const scope = toWorkScope(ctx.person, ctx.grant, now);
  if (!scope.capabilities.has('reports:delivery:read')) return DENIED;

  const period = resolveDeliveryPeriod(input, now);
  if (!period.ok) return period;

  let snapshot: DeliverySnapshot;
  try {
    snapshot = await ctx.delivery.load(scope, {
      from: period.effective.from,
      to: period.effective.to,
      months: period.months,
    });
  } catch (error) {
    if (error instanceof UnknownContentType) {
      return { ok: false, code: 'data_incomplete', message: error.message };
    }
    throw error;
  }

  let clients: GetDeliveryReportResponse['clients'];
  try {
    clients = applyFormula(snapshot);
  } catch (error) {
    if (error instanceof UnknownContentType) {
      return { ok: false, code: 'data_incomplete', message: error.message };
    }
    throw error;
  }

  const meta = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now,
  });
  const self = `${GET_DELIVERY_REPORT_PATH}?from=${encodeURIComponent(period.effective.from)}&to=${encodeURIComponent(period.effective.to)}`;
  const body = getDeliveryReportResponseSchema.parse({
    operation: 'get_delivery_report',
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    period: {
      requested: period.requested,
      effective: period.effective,
      timezone: AGENCY_TIMEZONE,
    },
    coverage: coverageOf(ctx.person, ctx.grant),
    summary: summarizeDelivery(clients),
    clients,
  });

  if (measureJsonBytes(body) > RESPONSE_BUDGET_BYTES) {
    return { ok: false, code: 'data_incomplete', message: 'A página não coube no orçamento de 64 KiB.' };
  }
  return { ok: true, body };
}

/* ------------------------------------------------------------------------ */
/* F26.7 — a entrega mês a mês                                              */
/* ------------------------------------------------------------------------ */

export type DeliverySeriesFailure = ReportFailure;

export type ClientDeliveryHistoryResult =
  | { ok: true; body: GetClientDeliveryHistoryResponse }
  | DeliverySeriesFailure;

export type DeliveryTrendResult = { ok: true; body: GetDeliveryTrendResponse } | DeliverySeriesFailure;

/** `AAAA-MM` → número de meses desde o ano zero, para contar sem laço. */
function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1);
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export type DeliverySeriesPeriod = {
  ok: true;
  requested: { from: string | null; to: string | null };
  /** Em `AAAA-MM`. */
  effective: { from: string; to: string };
  /** O mês em curso na agência, `AAAA-MM`. */
  currentMonth: string;
  /** Primeiros dias, `AAAA-MM-01`, do mais antigo para o mais novo. */
  months: string[];
  /** O primeiro dia do primeiro mês e o último dia do último: a produção datada. */
  bounds: DeliveryPeriodBound;
};

/**
 * O intervalo de meses da série. Sem `to`: o mês atual da agência (fuso de
 * São Paulo, não UTC). Sem `from`: `DELIVERY_SERIES_DEFAULT_MONTHS` meses
 * terminando em `to`. Acima do teto é recusa com o limite na frase — nunca um
 * corte silencioso — e a conta é feita ANTES de listar qualquer mês.
 */
export function resolveDeliverySeries(
  input: { from?: string; to?: string },
  now: Date,
  limit: { max: number; tooLarge: (requested: number) => string },
): DeliverySeriesPeriod | DeliverySeriesFailure {
  for (const value of [input.from, input.to]) {
    if (value !== undefined && !DELIVERY_MONTH_PATTERN.test(value)) {
      return { ok: false, code: 'invalid_input', message: 'Informe from e to em AAAA-MM (ex.: 2026-08), ou omita.' };
    }
  }
  const currentMonth = civilDate(now, AGENCY_TIMEZONE).slice(0, 7);
  const to = input.to ?? currentMonth;
  const from = input.from ?? monthFromIndex(monthIndex(to) - (DELIVERY_SERIES_DEFAULT_MONTHS - 1));
  const count = monthIndex(to) - monthIndex(from) + 1;
  if (count < 1) {
    return {
      ok: false,
      code: 'invalid_input',
      message: `Intervalo invertido: "${from}" vem depois de "${to}".`,
    };
  }
  if (count > limit.max) {
    return { ok: false, code: 'limit_exceeded', message: limit.tooLarge(count) };
  }
  const months: string[] = [];
  for (let index = monthIndex(from); index <= monthIndex(to); index += 1) {
    months.push(`${monthFromIndex(index)}-01`);
  }
  const first = months[0] as string;
  const last = months[months.length - 1] as string;
  return {
    ok: true,
    requested: { from: input.from ?? null, to: input.to ?? null },
    effective: { from, to },
    currentMonth,
    months,
    bounds: { from: first, to: lastInclusiveDayOfMonth(last) },
  };
}

const HISTORY_LIMIT = {
  max: DELIVERY_HISTORY_MAX_MONTHS,
  tooLarge: (requested: number) =>
    `Intervalo grande demais: no máximo ${DELIVERY_HISTORY_MAX_MONTHS} meses por vez para um cliente (pedido: ${requested}).`,
};

const TREND_LIMIT = {
  max: DELIVERY_TREND_MAX_MONTHS,
  tooLarge: (requested: number) =>
    `Intervalo grande demais: no máximo ${DELIVERY_TREND_MAX_MONTHS} meses por vez para todos os clientes (pedido: ${requested}). ` +
    `Para um cliente só, get_client_delivery_history vai até ${DELIVERY_HISTORY_MAX_MONTHS} meses.`,
};

/**
 * Um retrato do intervalo → um retrato POR MÊS, no formato exato que
 * `getDeliveryReport` monta quando pedido só com aquele mês: contrato, itens e
 * mês aberto daquele `reference_month`; a cota do cadastro (que não tem mês)
 * igual para todos; a produção datada daquele mês civil.
 *
 * F38, Fase 5 — os clientes de cada mês são os que CONTAM nele
 * (`clienteContaNoMes`): o cancelado até o mês do cancelamento, inclusive.
 * É o mesmo conjunto que o relatório daquele mês devolve.
 */
export function snapshotsByMonth(
  snapshot: DeliveryMonthlySnapshot,
  months: readonly string[],
): Map<string, DeliverySnapshot> {
  type Mutavel = {
    contracts: DeliveryContractRow[];
    items: DeliveryItemRow[];
    openedClientIds: string[];
    inPeriod: DeliveryPeriodCount[];
  };
  const porMes = new Map<string, Mutavel>(
    months.map((month) => [month, { contracts: [], items: [], openedClientIds: [], inPeriod: [] }]),
  );
  for (const row of snapshot.contracts) {
    porMes.get(row.month)?.contracts.push({
      clientId: row.clientId,
      contentType: row.contentType,
      quantity: row.quantity,
    });
  }
  for (const row of snapshot.items) {
    porMes.get(row.month)?.items.push({
      clientId: row.clientId,
      contentType: row.contentType,
      isExtra: row.isExtra,
      isCompleted: row.isCompleted,
    });
  }
  for (const row of snapshot.opened) porMes.get(row.month)?.openedClientIds.push(row.clientId);
  for (const row of snapshot.inPeriod) {
    porMes.get(row.month)?.inPeriod.push({
      clientId: row.clientId,
      scheduled: row.scheduled,
      completed: row.completed,
    });
  }

  const out = new Map<string, DeliverySnapshot>();
  for (const [month, parte] of porMes) {
    out.set(month, {
      clients: snapshot.clients.filter((client) => clienteContaNoMes(client, month)),
      contracts: parte.contracts,
      items: parte.items,
      openedClientIds: parte.openedClientIds,
      contentContractClientIds: snapshot.contentContractClientIds,
      inPeriod: parte.inPeriod,
    });
  }
  return out;
}

/** O recorte da concessão estreitado a UM cliente, sem alargar nada. */
export function narrowToClient(scope: WorkScope, clientId: string): WorkScope {
  if (scope.clients === 'none') return scope;
  if (scope.clients !== 'all' && !scope.clients.has(clientId)) return { ...scope, clients: 'none' };
  return { ...scope, clients: new Set([clientId]) };
}

/** Leitura + fórmula, com o tipo desconhecido virando `data_incomplete` como no relatório. */
async function monthlyRows(
  ctx: ReportCtx,
  scope: WorkScope,
  period: DeliverySeriesPeriod,
): Promise<
  | { ok: true; snapshot: DeliveryMonthlySnapshot; rows: Map<string, GetDeliveryReportResponse['clients']> }
  | DeliverySeriesFailure
> {
  try {
    const snapshot = await ctx.delivery.loadMonthly(scope, {
      from: period.bounds.from,
      to: period.bounds.to,
      months: period.months,
    });
    const porMes = snapshotsByMonth(snapshot, period.months);
    const rows = new Map<string, GetDeliveryReportResponse['clients']>();
    for (const month of period.months) {
      const doMes = porMes.get(month);
      if (!doMes) throw new Error(`Mês ${month} fora do retrato.`);
      rows.set(month, applyFormula(doMes));
    }
    return { ok: true, snapshot, rows };
  } catch (error) {
    if (error instanceof UnknownContentType) {
      return { ok: false, code: 'data_incomplete', message: error.message };
    }
    throw error;
  }
}

function seriesEnvelope(ctx: ReportCtx, now: Date, period: DeliverySeriesPeriod) {
  const meta = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now,
  });
  return {
    queriedAt: meta.queriedAt,
    effectiveScope: meta.effectiveScope,
    period: {
      requested: period.requested,
      effective: period.effective,
      currentMonth: period.currentMonth,
      timezone: AGENCY_TIMEZONE,
    },
    coverage: coverageOf(ctx.person, ctx.grant),
  };
}

const HISTORY_OVER_BUDGET: DeliverySeriesFailure = {
  ok: false,
  code: 'data_incomplete',
  message: 'A série não coube no orçamento de 64 KiB. Peça menos meses.',
};

/**
 * F26.7 — `get_client_delivery_history`: um cliente, até 24 meses, cada mês
 * com o objeto `delivery` completo (nível, base, bônus, pontos, detalhe por
 * tipo) ou o motivo de não ser mensurável.
 *
 * Cliente fora do recorte e cliente inexistente dão a MESMA recusa: a resposta
 * não pode servir para descobrir se um id existe.
 */
export async function getClientDeliveryHistory(
  ctx: ReportCtx,
  input: { clientId: string; from?: string; to?: string },
): Promise<ClientDeliveryHistoryResult> {
  const now = ctx.now ?? new Date();
  const scope = toWorkScope(ctx.person, ctx.grant, now);
  if (!scope.capabilities.has('reports:delivery:read')) return DENIED;

  const period = resolveDeliverySeries(input, now, HISTORY_LIMIT);
  if (!period.ok) return period;

  // O recorte estreitado ANTES da leitura: só este cliente é lido.
  const narrowed = narrowToClient(scope, input.clientId);
  if (narrowed.clients === 'none' || narrowed.companies.kind === 'none') return DENIED;

  const lido = await monthlyRows(ctx, narrowed, period);
  if (!lido.ok) return lido;
  const client = lido.snapshot.clients.find((row) => row.id === input.clientId);
  if (!client) return DENIED;

  // F38, Fase 5 — do mês seguinte ao cancelamento em diante, o mês diz
  // "cancelled" (nunca 0%): o cliente não está na carteira daquele mês.
  const months = period.months.map((month) => {
    if (!clienteContaNoMes(client, month)) {
      return { month: month.slice(0, 7), inPeriod: { scheduled: 0, completed: 0 }, delivery: cancelledDelivery(client) };
    }
    const row = (lido.rows.get(month) ?? []).find((linha) => linha.id === client.id);
    if (!row) throw new Error(`Mês ${month} sem a linha do cliente ${client.id}.`);
    return { month: month.slice(0, 7), inPeriod: row.inPeriod, delivery: row.delivery };
  });

  const self =
    `${GET_CLIENT_DELIVERY_HISTORY_PATH}?clientId=${encodeURIComponent(client.id)}` +
    `&from=${period.effective.from}&to=${period.effective.to}`;
  const envelope = seriesEnvelope(ctx, now, period);
  const body = getClientDeliveryHistoryResponseSchema.parse({
    operation: 'get_client_delivery_history',
    queriedAt: envelope.queriedAt,
    self,
    effectiveScope: envelope.effectiveScope,
    period: envelope.period,
    coverage: envelope.coverage,
    client: { id: client.id, name: client.name, company: { id: client.companyId, name: client.companyName } },
    months,
  });
  if (overBudget(body)) return HISTORY_OVER_BUDGET;
  return { ok: true, body };
}

const TREND_OVER_BUDGET: DeliverySeriesFailure = {
  ok: false,
  code: 'data_incomplete',
  message:
    'A série não coube no orçamento de 64 KiB. Peça menos meses, ou veja cliente a cliente com get_client_delivery_history.',
};

function trendLevel(delivery: DeliveryResult): DeliveryTrendLevel {
  return delivery.measurable ? delivery.level : delivery.reason;
}

/**
 * F38, Fase 5 — o mês de um cliente que já estava cancelado: não mensurável,
 * com o motivo `cancelled` e o dia, no lugar de 0%.
 */
function cancelledDelivery(client: SituacaoNoCadastro): CancelledDelivery {
  return {
    measurable: false,
    reason: 'cancelled',
    message: `Cliente ${cancelledDetail(client.cancelledOn)}: fora da carteira a partir do mês seguinte.`,
    cancelledOn: client.cancelledOn,
    formulaVersion: FORMULA_VERSION,
  };
}

/**
 * F26.7 — `get_delivery_trend`: todos os clientes do recorte, até 6 meses, só
 * o nível (ou o motivo) por mês. `change` é a variação do penúltimo para o
 * último mês quando os dois são mensuráveis — o que responde "quem caiu".
 */
export async function getDeliveryTrend(
  ctx: ReportCtx,
  input: { from?: string; to?: string },
): Promise<DeliveryTrendResult> {
  const now = ctx.now ?? new Date();
  const scope = toWorkScope(ctx.person, ctx.grant, now);
  if (!scope.capabilities.has('reports:delivery:read')) return DENIED;

  const period = resolveDeliverySeries(input, now, TREND_LIMIT);
  if (!period.ok) return period;

  const lido = await monthlyRows(ctx, scope, period);
  if (!lido.ok) return lido;

  // F38, Fase 5 — o mês em que o cliente não conta (já estava cancelado) vira
  // `cancelled` na série dele e fica fora do resumo daquele mês. Cancelado
  // antes do intervalo inteiro não aparece: não conta em mês nenhum dele.
  const porCliente = new Map<string, DeliveryTrendLevel[]>();
  const summary = period.months.map((month) => {
    const rows = lido.rows.get(month) ?? [];
    const doMes = new Map(rows.map((row) => [row.id, row]));
    for (const client of lido.snapshot.clients) {
      const row = doMes.get(client.id);
      const levels = porCliente.get(client.id) ?? [];
      levels.push(row ? trendLevel(row.delivery) : 'cancelled');
      porCliente.set(client.id, levels);
    }
    const resumo = summarizeDelivery(rows);
    return {
      month: month.slice(0, 7),
      clients: resumo.clients,
      measurable: resumo.measurable,
      unmeasurable: resumo.unmeasurable,
      averageLevel: resumo.averageLevel,
    };
  });

  // A ordem de `applyFormula` (nome, depois id): a mesma em todos os meses. O
  // primeiro mês tem todo cliente que conta em algum mês do intervalo — quem
  // conta num mês conta em todos os anteriores.
  const ordem = lido.rows.get(period.months[0] as string) ?? [];
  const clients = ordem.map((row) => {
    const levels = porCliente.get(row.id) ?? [];
    const ultimo = levels[levels.length - 1];
    const penultimo = levels[levels.length - 2];
    const change =
      levels.length >= 2 && typeof ultimo === 'number' && typeof penultimo === 'number'
        ? ultimo - penultimo
        : null;
    return { id: row.id, name: row.name, company: row.company, levels, change };
  });

  const envelope = seriesEnvelope(ctx, now, period);
  const body = getDeliveryTrendResponseSchema.parse({
    operation: 'get_delivery_trend',
    queriedAt: envelope.queriedAt,
    self: `${GET_DELIVERY_TREND_PATH}?from=${period.effective.from}&to=${period.effective.to}`,
    effectiveScope: envelope.effectiveScope,
    period: envelope.period,
    coverage: envelope.coverage,
    months: period.months.map((month) => month.slice(0, 7)),
    summary,
    clients,
  });
  if (overBudget(body)) return TREND_OVER_BUDGET;
  return { ok: true, body };
}

/* ------------------------------------------------------------------------ */
/* F37 — o planejamento por semana                                          */
/* ------------------------------------------------------------------------ */

export type PlanningWeeksResult = { ok: true; body: GetPlanningWeeksResponse } | ReadFailure;

const PLANNING_OVER_BUDGET: ReadFailure = {
  ok: false,
  code: 'data_incomplete',
  message: 'Nem um cliente coube no orçamento de 64 KiB. Filtre por clientId.',
};

type PlanningWeeksClient = GetPlanningWeeksResponse['clients'][number];

/**
 * Um responsável do planejamento como a leitura o entrega: o id da pasta (time)
 * ou da pessoa, o nome e o tipo. O NOME de uma PESSOA (carteira individual,
 * `user_clients`) só sai com `people:read` — sem ela é nulo, e o id fica (sem
 * ele o filtro `ownerId` e os grupos não fechariam). O nome de pasta (time) é do
 * relatório. É a mesma regra de `get_month_attention`/`get_client_month`
 * (`criarProjecao().donoDe` usa esta função), e `get_planning_weeks` a usa para
 * não entregar o nome de gente que `people:read` não concedeu.
 */
export function criarDonoDe(
  portfolio: DeliveryPlanningSnapshot['portfolio'],
  capabilities: ReadonlySet<IntegrationCapability>,
) {
  const podePessoas = capabilities.has('people:read');
  const pessoasDaCarteira = new Set(portfolio.map((dono) => dono.userId));
  return (owner: { id: string; name: string }): { id: string; name: string | null; kind: 'folder' | 'person' } => {
    const ehPessoa = pessoasDaCarteira.has(owner.id);
    return {
      id: owner.id,
      name: ehPessoa && !podePessoas ? null : owner.name,
      kind: ehPessoa ? 'person' : 'folder',
    };
  };
}

/**
 * F37 — `get_planning_weeks`: o mês de cada cliente ativo do recorte, por
 * semana — a aba Semana do Planejamento.
 *
 * NÃO TEM CONTA PRÓPRIA. A divisão em semanas, a meta, o sinal e o estado de
 * cada semana vêm de `planejarSemanas` (`src/painel/planejamento-semanal.ts`),
 * a cota e os responsáveis de `src/server/planning-weeks.ts`, e o agrupamento
 * por responsável de `agruparPorResponsavel` — os mesmos que a tela chama. Só o
 * "hoje" é daqui: o dia civil da agência (a tela usa o do navegador, no mesmo
 * fuso).
 *
 * Cliente sem cota e sem peça no mês (nem sublinha para desenhar) fica de fora
 * e é contado em `omittedWithoutQuota`; a tela o mostra como "sem cota", aqui
 * seria ruído. O mês sem nada a planejar é lista vazia, não erro.
 */
export async function getPlanningWeeks(
  ctx: ReportCtx,
  input: { month?: string; clientId?: string; ownerId?: string; limit?: number; cursor?: string },
): Promise<PlanningWeeksResult> {
  const now = ctx.now ?? new Date();
  const scope = toWorkScope(ctx.person, ctx.grant, now);
  if (!scope.capabilities.has('reports:delivery:read')) return DENIED;

  const today = civilDate(now, AGENCY_TIMEZONE);
  const month = input.month ?? today.slice(0, 7);
  if (!DELIVERY_MONTH_PATTERN.test(month)) {
    return { ok: false, code: 'invalid_input', message: 'Informe month em AAAA-MM (ex.: 2026-10), ou omita.' };
  }
  // Limite e cursor ruins são recusados ANTES de ler o banco.
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  // O recorte estreitado ANTES da leitura: com clientId, só ele é lido.
  const narrowed = input.clientId === undefined ? scope : narrowToClient(scope, input.clientId);
  if (narrowed.clients === 'none' || narrowed.companies.kind === 'none') return DENIED;

  const snapshot = await ctx.delivery.loadPlanning(narrowed, `${month}-01`);
  if (input.clientId !== undefined && !snapshot.clients.some((client) => client.id === input.clientId)) {
    return DENIED;
  }

  const { opened, byClient: fromContract } = quotasDoContrato(snapshot.contracts);
  const fromRegistry = quotasDoCadastro(snapshot.registry);
  const ownersOf = donosDoPlanejamento(snapshot.folders, snapshot.portfolio);
  const donoDe = criarDonoDe(snapshot.portfolio, scope.capabilities);
  const piecesOf = new Map<string, PecaDoPlanejamento[]>();
  for (const { clientId, ...peca } of snapshot.items) {
    const list = piecesOf.get(clientId) ?? [];
    list.push(peca);
    piecesOf.set(clientId, list);
  }

  type Linha = {
    id: string;
    name: string;
    owners: { id: string; name: string }[];
    planejamento: ReturnType<typeof planejarSemanas>;
  };
  type Entrada = { client: PlanningWeeksClient; linha: Linha };

  const entries: Entrada[] = [];
  let omittedWithoutQuota = 0;
  // As semanas são as do mês, iguais para todo cliente (a mesma divisão da tela).
  const weeks: GetPlanningWeeksResponse['weeks'] = semanasDoMes(month).map((semana) => ({
    number: semana.numero,
    from: semana.de,
    to: semana.ate,
    days: semana.dias,
  }));
  for (const client of snapshot.clients) {
    // `owners` (com o nome inteiro) só serve ao filtro e ao agrupamento; o que SAI
    // passa por `donoDe`, que tira o nome da pessoa sem `people:read`.
    const owners = (ownersOf.get(client.id) ?? []).map((owner) => ({
      id: owner.id,
      name: owner.name.trim() || 'Pessoa sem nome',
    }));
    if (input.ownerId !== undefined && !owners.some((owner) => owner.id === input.ownerId)) continue;

    const { quotaSource, quota } = resolvePlanningQuota({
      opened: opened.has(client.id),
      contract: fromContract.get(client.id),
      registry: fromRegistry.get(client.id),
    });
    const planejamento = planejarSemanas({
      mes: month,
      cota: quota,
      pecas: piecesOf.get(client.id) ?? [],
      hoje: today,
    });
    if (planejamento.tipos.length === 0) {
      omittedWithoutQuota += 1;
      continue;
    }

    entries.push({
      linha: { id: client.id, name: client.name, owners, planejamento },
      client: {
        id: client.id,
        name: client.name,
        company: { id: client.companyId, name: client.companyName },
        quotaSource,
        noQuota: planejamento.semCota,
        atRisk: planejamento.emRisco,
        below: planejamento.abaixo,
        owners: owners.map(donoDe),
        types: planejamento.tipos.map((tipo) => ({
          type: tipo.tipo,
          quota: tipo.cota,
          done: tipo.mes.feito,
          missing: Math.max(0, tipo.cota - tipo.mes.feito),
          withoutDay: tipo.mes.semDia,
          outsideMonth: tipo.mes.foraDoMes,
          weeks: tipo.celulas.map((celula) => ({
            number: celula.semana.numero,
            goal: celula.meta,
            done: celula.feito,
            scheduled: celula.sinais.filter((sinal) => sinal.sinal === 'agendada').length,
            late: celula.sinais.filter((sinal) => sinal.sinal === 'atrasada').length,
            missing: Math.max(0, celula.meta - celula.feito),
            state: celula.estado,
          })),
        })),
      },
    });
  }
  const meta = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now,
  });
  const self =
    `${GET_PLANNING_WEEKS_PATH}?month=${month}` +
    (input.clientId === undefined ? '' : `&clientId=${encodeURIComponent(input.clientId)}`) +
    (input.ownerId === undefined ? '' : `&ownerId=${encodeURIComponent(input.ownerId)}`);
  const assemble = (page: { items: Entrada[]; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'get_planning_weeks' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    coverage: coverageOf(ctx.person, ctx.grant),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    month,
    today,
    timezone: AGENCY_TIMEZONE,
    weeks,
    omittedWithoutQuota,
    clients: page.items.map((entry) => entry.client),
    groups: agruparPorResponsavel(page.items.map((entry) => entry.linha)).map((grupo) => ({
      owner: grupo.id === null ? null : donoDe({ id: grupo.id, name: grupo.nome }),
      clientIds: grupo.linhas.map((linha) => linha.id),
      atRisk: grupo.emRisco,
    })),
  });

  const paged = pageAndFit(entries, {
    limit: input.limit,
    cursor: input.cursor,
    key: (entry) => ({ k: entry.client.name.toLowerCase(), id: entry.client.id }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = getPlanningWeeksResponseSchema.parse(assemble(paged));
  if (overBudget(body)) return PLANNING_OVER_BUDGET;
  return { ok: true, body };
}

/* ------------------------------------------------------------------------ */
/* F38 — a última entrega e as vencidas, pela Semanal                        */
/* ------------------------------------------------------------------------ */

export type DeliveryStatusResult = { ok: true; body: GetDeliveryStatusResponse } | ReadFailure;

const DELIVERY_STATUS_OVER_BUDGET: ReadFailure = {
  ok: false,
  code: 'data_incomplete',
  message: 'Nem um cliente coube no orçamento de 64 KiB. Filtre por clientId.',
};

type DeliveryStatusClient = GetDeliveryStatusResponse['clients'][number];

/**
 * F38, Fase 3 — `get_delivery_status`: por cliente ATIVO do recorte, a última
 * entrega, as peças vencidas, as que vencem hoje, as sem dia e a próxima
 * marcada — o cartão do Painel.
 *
 * NÃO TEM REGRA PRÓPRIA. As peças vêm de `readWeeklyPieces` (a leitura do
 * Painel) e a conta é `deliveryStatusOf` (`src/delivery/ultima-entrega.ts`),
 * com o mesmo instante `now` para o "hoje" das duas. Daqui só sai o formato.
 *
 * Cliente cancelado (`is_active = false`) não é lido: nem na lista, nem pelo
 * clientId — que dá a mesma recusa de um id de fora do recorte.
 */
export async function getDeliveryStatus(
  ctx: ReportCtx,
  input: { clientId?: string; limit?: number; cursor?: string },
): Promise<DeliveryStatusResult> {
  const now = ctx.now ?? new Date();
  const scope = toWorkScope(ctx.person, ctx.grant, now);
  if (!scope.capabilities.has('reports:delivery:read')) return DENIED;

  // Limite e cursor ruins são recusados ANTES de ler o banco.
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  // O recorte estreitado ANTES da leitura: com clientId, só ele é lido.
  const narrowed = input.clientId === undefined ? scope : narrowToClient(scope, input.clientId);
  if (narrowed.clients === 'none' || narrowed.companies.kind === 'none') return DENIED;

  const snapshot = await ctx.delivery.loadDeliveryStatus(narrowed, now);
  if (input.clientId !== undefined && !snapshot.clients.some((client) => client.id === input.clientId)) {
    return DENIED;
  }

  const entries: DeliveryStatusClient[] = snapshot.clients.map((client) => {
    const status = deliveryStatusOf(snapshot.pieces.get(client.id) ?? [], now);
    return {
      id: client.id,
      name: client.name,
      company: { id: client.companyId, name: client.companyName },
      lastDeliveryOn: status.lastDeliveryOn,
      daysSinceLastDelivery: status.daysSinceLastDelivery,
      overdueCount: status.overdue.length,
      overdueDays: status.overdue,
      dueToday: status.dueToday,
      unscheduled: status.unscheduled,
      nextScheduledOn: status.nextScheduledOn,
    };
  });

  const meta = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now,
  });
  const self =
    GET_DELIVERY_STATUS_PATH +
    (input.clientId === undefined ? '' : `?clientId=${encodeURIComponent(input.clientId)}`);
  const assemble = (page: { items: DeliveryStatusClient[]; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'get_delivery_status' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    coverage: coverageOf(ctx.person, ctx.grant),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    source: 'semanal' as const,
    today: civilDate(now, AGENCY_TIMEZONE),
    timezone: AGENCY_TIMEZONE,
    activeClients: entries.length,
    clients: page.items,
  });

  const paged = pageAndFit(entries, {
    limit: input.limit,
    cursor: input.cursor,
    key: (entry) => ({ k: entry.name.toLowerCase(), id: entry.id }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = getDeliveryStatusResponseSchema.parse(assemble(paged));
  if (overBudget(body)) return DELIVERY_STATUS_OVER_BUDGET;
  return { ok: true, body };
}
