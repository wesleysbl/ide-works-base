/**
 * O DIA DA PEÇA, NO SQL, É O DE SÃO PAULO — conferência de 09/10/2026.
 *
 * O QUE ESCAPAVA
 *   A rodada anterior pôs todas as telas do Planejamento no dia de São Paulo da
 *   peça (`diaDoInstante`). Sobraram os cortes em SQL: o `inPeriod` do Painel e
 *   as leituras do MCP (`get_delivery_report`, `get_client_delivery_history`,
 *   `get_delivery_trend`) cortavam o dia por `(scheduled_at at time zone
 *   'UTC')::date`. A peça marcada às 22h de Brasília no último dia do mês chega
 *   como 01h do dia seguinte em UTC — contava no mês SEGUINTE aqui e no mês
 *   certo no Planejamento e no Calendário. O mesmo cliente, números diferentes
 *   em telas diferentes.
 *
 *   O mês de um cliente CANCELADO muda junto: a regra única de
 *   `cliente-no-periodo.ts` compara o mês do cancelamento (São Paulo) com o mês
 *   do DIA da peça — com o dia em UTC, a peça das 22h do último dia do mês de
 *   cancelamento caía "depois do cancelamento" e sumia.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   O MESMO código de `server/*.ts` e `integrations/reports.ts`, sobre o PGlite
 *   (Postgres em WebAssembly, no processo — nenhuma rede), com peças a 01h UTC
 *   e a 02h UTC (22h e 23h do dia anterior em São Paulo):
 *     · o Painel, o relatório do MCP, a série mês a mês e o Calendário contam a
 *       peça no MESMO dia e no MESMO mês — o de São Paulo;
 *     · o SQL e o dublê em memória (`MemoryDeliveryCatalog`) não discordam;
 *     · o cliente cancelado no mês conta a peça das 22h do último dia dele.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha e as funções de concessão do banco: aqui dizem "sim".
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import type { Sql, Tx } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';

/* ───────────────────────────── o adaptador ───────────────────────────── */

type Fragmento = { readonly dublê: true; readonly strings: readonly string[]; readonly args: readonly unknown[] };
const ehFragmento = (v: unknown): v is Fragmento =>
  typeof v === 'object' && v !== null && (v as Fragmento).dublê === true;

function montar(f: Fragmento, params: unknown[]): string {
  let texto = f.strings[0] ?? '';
  f.args.forEach((a, i) => {
    if (ehFragmento(a)) texto += montar(a, params);
    else {
      params.push(a);
      texto += `$${params.length}`;
    }
    texto += f.strings[i + 1] ?? '';
  });
  return texto;
}

let db: PGlite;

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      return db.query(montar(f, params), params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) };

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (s: unknown) => Promise<unknown>) => work(sql),
}));

const { readPanel } = await import('@/server/panel');
const { readCalendar } = await import('@/server/calendar');
const { getCalendar, getClientMonth } = await import('@/integrations/client-month');
const { MemoryDeliveryCatalog, SqlDeliveryCatalog, getClientDeliveryHistory, getDeliveryReport, getDeliveryTrend } =
  await import('@/integrations/reports');

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const IDE = id(1);
/** Tem peças às 22h e 23h de Brasília nas viradas de mês. */
const C_NOITE = id(10);
/** Cancelado em 20/10/2026: outubro ainda é dele, novembro não. */
const C_CANCELADO = id(11);
const EU = id(99);

const ATOR = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };
const AGORA = new Date('2026-11-05T12:00:00.000Z');

const ator: AuthenticatedActor = {
  userId: EU,
  email: 'wesley@example.invalid',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
  areas: [],
  hasAllClientsAccess: true,
};

const grant: IntegrationGrant = {
  id: id(200),
  ownerId: EU,
  oauthClientId: 'cliente-oauth',
  name: 'Claude',
  capabilities: ['reports:delivery:read'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

const pessoa: PersonAccess = {
  userId: EU,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [IDE],
  clientIds: [],
  hasAllClientsAccess: true,
};

/**
 * As peças. O instante em UTC e o dia/mês de São Paulo (UTC-3):
 *   P_31_OUT   01/11 01:00Z  →  31/10 22:00  (feita)
 *   P_30_SET   01/10 02:00Z  →  30/09 23:00
 *   P_15_OUT   15/10 15:00Z  →  15/10 12:00  (o meio-dia da grade: os dois relógios concordam)
 *   P_CANCEL   01/11 01:00Z  →  31/10 22:00  (do cliente cancelado em outubro)
 */
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create table ideworks.client_categories(id uuid primary key, name text, is_default boolean default false, sort_order int default 0);
    create table ideworks.plans(id uuid primary key, name text, color_bg text, color_text text, color_border text, is_active boolean default true, sort_order int default 0);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid, plan_id uuid,
      urgency text default 'normal', is_active boolean default true, inactive_at timestamptz,
      finance_ok boolean default true, started_on date default '2026-01-01', renews_on date);
    create table ideworks.client_tags(id uuid primary key, name text, color text);
    create table ideworks.client_tag_assignments(client_id uuid, tag_id uuid);
    create table ideworks.month_contracts(id uuid primary key default gen_random_uuid(), client_id uuid, reference_month date,
      planning_done_at timestamptz, planning_done_by uuid, client_approved_at timestamptz, client_approved_by uuid);
    create table ideworks.month_contract_items(contract_id uuid, content_type text, quantity int);
    create table ideworks.client_quotas(client_id uuid, content_type text, quantity int);
    create table ideworks.content_items(id uuid primary key default gen_random_uuid(), client_id uuid, reference_month date,
      content_type text, platform text, title text, is_extra boolean default false,
      scheduled_at timestamptz, completed_at timestamptz, created_at timestamptz default now());
    create table ideworks.appointments(id uuid primary key default gen_random_uuid(), client_id uuid, day date,
      start_time time, title text, notes text);
    create table ideworks.spaces(id uuid primary key, category_id uuid, name text, archived_at timestamptz);
    create table ideworks.folders(id uuid primary key, space_id uuid, name text, archived_at timestamptz);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, client_id uuid,
      archived_at timestamptz);
    create table ideworks.tasks(id uuid primary key, list_id uuid, archived_at timestamptz);
    create table ideworks.user_clients(user_id uuid, client_id uuid);
    create function ideworks.display_name(u uuid) returns text language sql as $$ select 'Pessoa' $$;
    create function ideworks.integration_allows_company(c uuid) returns boolean language sql as $$ select true $$;
    create function ideworks.integration_allows_client(c uuid) returns boolean language sql as $$ select true $$;

    insert into ideworks.client_categories values ('${IDE}', 'Ide', false, 1);
    insert into ideworks.clients(id, name, category_id, renews_on, is_active, inactive_at) values
      ('${C_NOITE}', 'Cliente Noite', '${IDE}', '2026-12-01', true, null),
      ('${C_CANCELADO}', 'Cliente Cancelado', '${IDE}', '2026-12-01', false, '2026-10-20 15:00+00');
    insert into ideworks.month_contracts(id, client_id, reference_month) values
      ('${id(300)}', '${C_NOITE}', '2026-10-01'),
      ('${id(301)}', '${C_NOITE}', '2026-09-01'),
      ('${id(302)}', '${C_CANCELADO}', '2026-10-01');
    insert into ideworks.month_contract_items values
      ('${id(300)}', 'video', 4), ('${id(301)}', 'video', 4), ('${id(302)}', 'video', 4);
    insert into ideworks.client_quotas values
      ('${C_NOITE}', 'video', 4), ('${C_CANCELADO}', 'video', 4);

    insert into ideworks.content_items(id, client_id, reference_month, content_type, title, scheduled_at, completed_at) values
      ('${id(400)}', '${C_NOITE}', '2026-10-01', 'video', 'P_31_OUT', '2026-11-01 01:00+00', '2026-11-01 02:00+00'),
      ('${id(401)}', '${C_NOITE}', '2026-09-01', 'video', 'P_30_SET', '2026-10-01 02:00+00', null),
      ('${id(402)}', '${C_NOITE}', '2026-10-01', 'video', 'P_15_OUT', '2026-10-15 15:00+00', null),
      ('${id(403)}', '${C_CANCELADO}', '2026-10-01', 'video', 'P_CANCEL', '2026-11-01 01:00+00', null);
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const periodo = (from: string, to: string) => readPanel(sql as unknown as Sql, ator, from, to);
const doCliente = (painel: Awaited<ReturnType<typeof periodo>>, cliente: string) =>
  painel.clients.find((c) => c.id === cliente)?.inPeriod;

const banco = () => new SqlDeliveryCatalog({} as never, ATOR as never);
const ctx = (delivery: InstanceType<typeof SqlDeliveryCatalog> | InstanceType<typeof MemoryDeliveryCatalog>) => ({
  grant,
  person: pessoa,
  origin: 'http' as const,
  companies: [{ id: IDE, name: 'Ide' }],
  displayName: 'Wesley',
  delivery,
  now: AGORA,
});

/* ───────────────────────────── o Painel ───────────────────────────── */

describe('Painel — `inPeriod` corta o dia da peça em São Paulo', () => {
  it('a peça das 22h de 31/10 (01h UTC de 01/11) é de outubro, e não de novembro', async () => {
    const outubro = await periodo('2026-10-01', '2026-10-31');
    expect(doCliente(outubro, C_NOITE)).toEqual({ scheduled: 2, completed: 1 });

    const novembro = await periodo('2026-11-01', '2026-11-30');
    expect(doCliente(novembro, C_NOITE)).toEqual({ scheduled: 0, completed: 0 });
  });

  it('a peça das 23h de 30/09 (02h UTC de 01/10) é de setembro, e não de outubro', async () => {
    const setembro = await periodo('2026-09-01', '2026-09-30');
    expect(doCliente(setembro, C_NOITE)).toEqual({ scheduled: 1, completed: 0 });
  });

  it('o intervalo que acaba em 31/10 conta a peça das 22h do último dia; o que começa em 01/11, não', async () => {
    expect(doCliente(await periodo('2026-10-31', '2026-10-31'), C_NOITE)).toEqual({ scheduled: 1, completed: 1 });
    expect(doCliente(await periodo('2026-11-01', '2026-11-01'), C_NOITE)).toEqual({ scheduled: 0, completed: 0 });
  });

  it('cliente cancelado em outubro: a peça das 22h de 31/10 ainda é do mês dele', async () => {
    const outubro = await periodo('2026-10-01', '2026-10-31');
    expect(doCliente(outubro, C_CANCELADO)).toEqual({ scheduled: 1, completed: 0 });
    const novembro = await periodo('2026-11-01', '2026-11-30');
    expect(doCliente(novembro, C_CANCELADO)).toEqual({ scheduled: 0, completed: 0 });
  });
});

/* ───────────────────────────── o MCP ───────────────────────────── */

describe('MCP — o relatório e a série contam o mesmo dia que o Painel', () => {
  it('get_delivery_report de outubro: as mesmas contagens do Painel', async () => {
    const r = await getDeliveryReport(ctx(banco()), { from: '2026-10-01', to: '2026-10-31' });
    if (!r.ok) throw new Error(r.message);
    const porId = new Map(r.body.clients.map((c) => [c.id, c.inPeriod]));
    expect(porId.get(C_NOITE)).toEqual({ scheduled: 2, completed: 1 });
    expect(porId.get(C_CANCELADO)).toEqual({ scheduled: 1, completed: 0 });
    expect(r.body.summary.inPeriod).toEqual({ scheduled: 3, completed: 1 });
  });

  it('get_delivery_report de novembro não traz a peça das 22h de 31/10', async () => {
    const r = await getDeliveryReport(ctx(banco()), { from: '2026-11-01', to: '2026-11-30' });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.summary.inPeriod).toEqual({ scheduled: 0, completed: 0 });
  });

  it('get_client_delivery_history: setembro, outubro e novembro pelo mês de São Paulo', async () => {
    const r = await getClientDeliveryHistory(ctx(banco()), { clientId: C_NOITE, from: '2026-09', to: '2026-11' });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.months.map((m) => [m.month, m.inPeriod])).toEqual([
      ['2026-09', { scheduled: 1, completed: 0 }],
      ['2026-10', { scheduled: 2, completed: 1 }],
      ['2026-11', { scheduled: 0, completed: 0 }],
    ]);
  });

  it('a série de cada mês é igual ao relatório pedido só com aquele mês', async () => {
    const historia = await getClientDeliveryHistory(ctx(banco()), { clientId: C_NOITE, from: '2026-09', to: '2026-10' });
    if (!historia.ok) throw new Error(historia.message);
    for (const [mes, de, ate] of [
      ['2026-09', '2026-09-01', '2026-09-30'],
      ['2026-10', '2026-10-01', '2026-10-31'],
    ] as const) {
      const relatorio = await getDeliveryReport(ctx(banco()), { from: de, to: ate });
      if (!relatorio.ok) throw new Error(relatorio.message);
      const linha = relatorio.body.clients.find((c) => c.id === C_NOITE);
      expect(historia.body.months.find((m) => m.month === mes)?.inPeriod).toEqual(linha?.inPeriod);
    }
  });

  it('get_delivery_trend roda com o mesmo corte (o cancelado de outubro some em novembro)', async () => {
    const r = await getDeliveryTrend(ctx(banco()), { from: '2026-10', to: '2026-11' });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.summary.map((m) => [m.month, m.clients])).toEqual([
      ['2026-10', 2],
      ['2026-11', 1],
    ]);
  });
});

/* ───────────────────────────── o Calendário ───────────────────────────── */

describe('Calendário e Painel dizem o mesmo número de outubro', () => {
  it('as entregas de outubro do Calendário (dia de São Paulo) somam o `inPeriod` do Painel', async () => {
    const entradas = await readCalendar(sql as unknown as Sql, ator, { from: '2026-10-01', to: '2026-11-01' });
    const entregas = entradas.filter((e) => e.kind === 'delivery');
    expect(entregas.map((e) => [e.clientName, e.day])).toEqual([
      ['Cliente Noite', '2026-10-15'],
      ['Cliente Cancelado', '2026-10-31'],
      ['Cliente Noite', '2026-10-31'],
    ]);

    const painel = await periodo('2026-10-01', '2026-10-31');
    const doPainel = painel.clients.reduce((soma, c) => soma + c.inPeriod.scheduled, 0);
    expect(doPainel).toBe(entregas.length);
  });

  it('get_calendar do MCP põe a peça das 22h em 31/10, como o Calendário da tela', async () => {
    const cal = await getCalendar(ctx(banco()), { from: '2026-10-01', to: '2026-10-31', clientId: C_NOITE });
    if (!cal.ok) throw new Error(cal.message);
    const dias = cal.body.entries.filter((e) => e.kind === 'delivery').map((e) => e.day);
    expect(dias).toEqual(['2026-10-15', '2026-10-31']);
  });
});

/* ───────────────────────────── o dublê ───────────────────────────── */

describe('o dublê em memória conta o dia como o SQL', () => {
  const memoria = () =>
    new MemoryDeliveryCatalog({
      clients: [
        { id: C_NOITE, name: 'Cliente Noite', companyId: IDE, companyName: 'Ide' },
        { id: C_CANCELADO, name: 'Cliente Cancelado', companyId: IDE, companyName: 'Ide', isActive: false, cancelledOn: '2026-10-20' },
      ],
      contracts: [
        { clientId: C_NOITE, referenceMonth: '2026-10-01', contentType: 'video', quantity: 4 },
        { clientId: C_NOITE, referenceMonth: '2026-09-01', contentType: 'video', quantity: 4 },
        { clientId: C_CANCELADO, referenceMonth: '2026-10-01', contentType: 'video', quantity: 4 },
      ],
      items: [
        { id: id(400), clientId: C_NOITE, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: true, scheduledOn: null, scheduledAt: '2026-11-01T01:00:00.000Z' },
        { id: id(401), clientId: C_NOITE, referenceMonth: '2026-09-01', contentType: 'video', isExtra: false, isCompleted: false, scheduledOn: null, scheduledAt: '2026-10-01T02:00:00.000Z' },
        { id: id(402), clientId: C_NOITE, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: false, scheduledOn: null, scheduledAt: '2026-10-15T15:00:00.000Z' },
        { id: id(403), clientId: C_CANCELADO, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: false, scheduledOn: null, scheduledAt: '2026-11-01T01:00:00.000Z' },
      ],
      contentContractClientIds: [C_NOITE, C_CANCELADO],
    });

  it('relatório de outubro e série de set–nov saem iguais do banco e da memória', async () => {
    const entrada = { from: '2026-10-01', to: '2026-10-31' };
    const doBanco = await getDeliveryReport(ctx(banco()), entrada);
    const daMemoria = await getDeliveryReport(ctx(memoria()), entrada);
    if (!doBanco.ok || !daMemoria.ok) throw new Error('relatório recusado');
    expect(daMemoria.body.clients.map((c) => [c.id, c.inPeriod])).toEqual(
      doBanco.body.clients.map((c) => [c.id, c.inPeriod]),
    );

    const serie = { clientId: C_NOITE, from: '2026-09', to: '2026-11' };
    const historiaBanco = await getClientDeliveryHistory(ctx(banco()), serie);
    const historiaMemoria = await getClientDeliveryHistory(ctx(memoria()), serie);
    if (!historiaBanco.ok || !historiaMemoria.ok) throw new Error('série recusada');
    expect(historiaMemoria.body.months.map((m) => [m.month, m.inPeriod])).toEqual(
      historiaBanco.body.months.map((m) => [m.month, m.inPeriod]),
    );
  });
});

/* ───────────────────────────── a semana da peça ───────────────────────────── */

describe('get_client_month — a semana é a do dia de São Paulo', () => {
  it('a peça das 22h de sábado 31/10 está na última semana de outubro (e não "fora do mês")', async () => {
    const r = await getClientMonth(ctx(banco()), { clientId: C_NOITE, month: '2026-10' });
    if (!r.ok) throw new Error(r.message);
    const peca = r.body.pieces.find((p) => p.title === 'P_31_OUT');
    expect(peca?.day).toBe('2026-10-31');
    expect(peca?.week).toBe(5);
  });
});
