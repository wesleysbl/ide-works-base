/**
 * `get_client_month` e `get_calendar` — conferência de 08/10/2026, lacuna G2.
 *
 * SEM ISTO A IA SABE QUANTAS PEÇAS FALTAM, E NÃO QUAIS. `get_month_attention`
 * conta o contrato do mês em seis baldes; estas duas leituras mostram as peças
 * uma a uma — o que a ficha do cliente (`readClientDetail`) e o Calendário
 * (`readCalendar`) mostram na tela.
 *
 * NENHUMA REGRA NOVA
 *   · `get_client_month`: o contrato por tipo, o ritual e os motivos vêm das
 *     funções da visão Contrato (`planejarMes`, como em `get_month_attention`);
 *     o medidor é `calculateDeliveryLevel`, a MESMA chamada da ficha do cliente,
 *     com o contrato congelado e as peças do mês de competência; o nome da peça
 *     é `nomesDosItens`, o da tela; o sinal (✓ / ● / ✕) é `sinalDaPeca`.
 *   · `get_calendar`: as duas leituras do calendário da tela (a peça pelo dia de
 *     São Paulo, o compromisso pelo `day`), ordenadas como o calendário.
 *
 * O RECORTE (as lições da conferência de 08/10)
 *   Os dois catálogos (`loadPlanning`, `loadCalendar`) leem pelo `scopedClient`:
 *   empresa, cliente e empresa omitida da concessão no `where`, e só cliente
 *   ATIVO. `clientId` de fora, inexistente, cancelado ou de empresa omitida é a
 *   mesma recusa. O compromisso sai sem as observações (texto livre), e o link
 *   de aprovação do cliente não está em nenhum retrato.
 */

import { type ContentType, CONTENT_TYPES, UnknownContentType, calculateDeliveryLevel } from '@/delivery/level';
import { semanaDaData } from '@/delivery/semanas';
import {
  CALENDAR_MAX_DAYS,
  DELIVERY_MONTH_PATTERN,
  GET_CALENDAR_PATH,
  GET_CLIENT_MONTH_PATH,
  diaValido,
  getCalendarResponseSchema,
  getClientMonthResponseSchema,
  type GetCalendarResponse,
  type GetClientMonthResponse,
} from '@/integrations/contract';
import { getContext } from '@/integrations/context';
import { criarProjecao, leiturasDoRetrato } from '@/integrations/month-attention';
import { overBudget, parsePageRequest } from '@/integrations/page';
import { asPageError, pageAndFit, toWorkScope, type ReadFailure } from '@/integrations/reads';
import {
  civilDate,
  coverageOf,
  narrowToClient,
  type CalendarEntryRow,
  type ReportCtx,
} from '@/integrations/reports';
import { nomesDosItens } from '@/clients/nome-do-item';
import { listaDeAtencao, planejarMes } from '@/painel/planejamento-do-mes';
import { diaDaPeca, sinalDaPeca } from '@/painel/planejamento-semanal';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import { quotasDoCadastro, quotasDoContrato, resolvePlanningQuota } from '@/server/planning-weeks';

const DENIED: ReadFailure = {
  ok: false,
  code: 'permission_denied',
  message: 'Fora do alcance desta integração.',
};

const OVER_BUDGET: ReadFailure = {
  ok: false,
  code: 'data_incomplete',
  message: 'A página não coube no orçamento de 64 KiB.',
};

/* ------------------------------------------------------------------------ */
/* get_client_month                                                          */
/* ------------------------------------------------------------------------ */

export type ClientMonthResult = { ok: true; body: GetClientMonthResponse } | ReadFailure;

export async function getClientMonth(
  ctx: ReportCtx,
  input: { clientId: string; month?: string },
): Promise<ClientMonthResult> {
  const now = ctx.now ?? new Date();
  const scope = toWorkScope(ctx.person, ctx.grant, now);
  if (!scope.capabilities.has('reports:delivery:read')) return DENIED;

  const today = civilDate(now, AGENCY_TIMEZONE);
  const month = input.month ?? today.slice(0, 7);
  if (!DELIVERY_MONTH_PATTERN.test(month)) {
    return { ok: false, code: 'invalid_input', message: 'Informe month em AAAA-MM (ex.: 2026-10), ou omita.' };
  }

  // O recorte estreitado ANTES da leitura: só este cliente é lido.
  const narrowed = narrowToClient(scope, input.clientId);
  if (narrowed.clients === 'none' || narrowed.companies.kind === 'none') return DENIED;

  const snapshot = await ctx.delivery.loadPlanning(narrowed, `${month}-01`);
  if (!snapshot.clients.some((client) => client.id === input.clientId)) return DENIED;

  // O cliente no mês, pela regra da visão Contrato (a mesma de get_month_attention).
  const { ritual, semanas } = leiturasDoRetrato(snapshot);
  const linha = planejarMes({ ritual, semanas, mes: month, hoje: today }).find((l) => l.id === input.clientId);
  if (!linha) return DENIED;
  const precisa = new Set(listaDeAtencao([linha]).map((l) => l.id));
  const { linhaParaSaida } = criarProjecao(snapshot, scope.capabilities, precisa);

  // O contrato do mês: o congelado (mês aberto, mesmo vazio) ou a cota do cadastro de hoje.
  const { opened, byClient: doContrato } = quotasDoContrato(snapshot.contracts);
  const { quotaSource, quota, hasContentContract } = resolvePlanningQuota({
    opened: opened.has(input.clientId),
    contract: doContrato.get(input.clientId),
    registry: quotasDoCadastro(snapshot.registry).get(input.clientId),
  });

  // O medidor: a MESMA chamada da ficha do cliente (`readClientDetail`), com o
  // contrato congelado e as peças do mês inteiro de competência.
  const pecas = snapshot.items.filter((peca) => peca.clientId === input.clientId);
  let meter: GetClientMonthResponse['meter'];
  try {
    meter = calculateDeliveryLevel(
      snapshot.contracts
        .filter((row) => row.clientId === input.clientId && row.contentType !== null)
        .map((row) => ({ contentType: row.contentType as string, quantity: row.quantity })),
      pecas.map((peca) => ({
        contentType: peca.contentType,
        isExtra: peca.isExtra,
        isCompleted: peca.completedAt !== null,
      })),
      { monthOpened: opened.has(input.clientId), hasContentContract },
    );
  } catch (error) {
    if (error instanceof UnknownContentType) {
      return { ok: false, code: 'data_incomplete', message: error.message };
    }
    throw error;
  }

  // As peças com o nome da tela ("Vídeo “Reels”, dia 12/10"), na ordem da leitura
  // (a que desempata "(n de m)"); a saída vai por dia, sem dia por último.
  const nomes = nomesDosItens(pecas);
  const pieces = pecas
    .map((peca, posicao) => ({ peca, posicao, dia: diaDaPeca(peca) }))
    .sort(
      (a, b) =>
        (a.dia === null ? 1 : 0) - (b.dia === null ? 1 : 0) ||
        (a.dia ?? '').localeCompare(b.dia ?? '') ||
        a.posicao - b.posicao,
    )
    .map(({ peca, dia }): GetClientMonthResponse['pieces'][number] => ({
      id: peca.id,
      name: nomes.get(peca.id) ?? peca.id,
      title: peca.title?.trim() ? peca.title.trim() : null,
      type: peca.contentType as ContentType,
      day: dia,
      done: peca.completedAt !== null,
      completedAt: peca.completedAt,
      extra: peca.isExtra,
      signal: sinalDaPeca(peca, today),
      // A semana do DIA de São Paulo, e não do instante: `semanaDaData` corta a
      // string em dez posições, e a peça das 22h de sábado 31/10 chega como
      // 01h UTC de 01/11 — caía "fora do mês" (week: null).
      week: dia === null ? null : semanaDaData(month, dia),
    }));

  const meta = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now,
  });
  const body = getClientMonthResponseSchema.parse({
    operation: 'get_client_month' as const,
    queriedAt: meta.queriedAt,
    self: `${GET_CLIENT_MONTH_PATH}?clientId=${encodeURIComponent(input.clientId)}&month=${month}`,
    effectiveScope: meta.effectiveScope,
    coverage: coverageOf(ctx.person, ctx.grant),
    hasMore: false,
    nextCursor: null,
    month,
    today,
    timezone: AGENCY_TIMEZONE,
    client: linhaParaSaida(linha),
    contract: {
      monthOpened: opened.has(input.clientId),
      source: quotaSource,
      items: CONTENT_TYPES.flatMap((type) => {
        const quantity = quota[type] ?? 0;
        return quantity > 0 ? [{ type, quantity }] : [];
      }),
    },
    meter,
    pieces,
  });
  if (overBudget(body)) return OVER_BUDGET;
  return { ok: true, body };
}

/* ------------------------------------------------------------------------ */
/* get_calendar                                                              */
/* ------------------------------------------------------------------------ */

export type CalendarResult = { ok: true; body: GetCalendarResponse } | ReadFailure;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * A ordem do calendário da tela: o dia; dentro dele quem tem hora vem antes de
 * quem não tem; depois o nome do cliente. O id desempata (a paginação precisa de
 * ordem total).
 */
function antesNoCalendario(a: CalendarEntryRow, b: CalendarEntryRow): number {
  if (a.day !== b.day) return a.day.localeCompare(b.day);
  if (a.time !== null && b.time !== null && a.time !== b.time) return a.time.localeCompare(b.time);
  if ((a.time === null) !== (b.time === null)) return a.time === null ? 1 : -1;
  return a.clientName.localeCompare(b.clientName, 'pt-BR') || a.id.localeCompare(b.id);
}

export async function getCalendar(
  ctx: ReportCtx,
  input: { from: string; to: string; clientId?: string; limit?: number; cursor?: string },
): Promise<CalendarResult> {
  const now = ctx.now ?? new Date();
  const scope = toWorkScope(ctx.person, ctx.grant, now);
  if (!scope.capabilities.has('reports:delivery:read')) return DENIED;

  // Período, limite e cursor ruins são recusados ANTES de ler o banco.
  if (!diaValido(input.from) || !diaValido(input.to)) {
    return { ok: false, code: 'invalid_input', message: 'Informe from e to em AAAA-MM-DD, dias que existem.' };
  }
  if (input.from > input.to) {
    return { ok: false, code: 'invalid_input', message: 'from não pode ser depois de to.' };
  }
  const days = Math.round((Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / MS_POR_DIA) + 1;
  if (days > CALENDAR_MAX_DAYS) {
    return {
      ok: false,
      code: 'limit_exceeded',
      message: `Período grande demais: no máximo ${CALENDAR_MAX_DAYS} dias por vez (pediu ${days}).`,
    };
  }
  const pedido = parsePageRequest({ limit: input.limit, cursor: input.cursor });
  if (!pedido.ok) return asPageError(pedido);

  const narrowed = input.clientId === undefined ? scope : narrowToClient(scope, input.clientId);
  if (narrowed.clients === 'none' || narrowed.companies.kind === 'none') return DENIED;

  const snapshot = await ctx.delivery.loadCalendar(narrowed, {
    from: input.from,
    to: input.to,
    clientId: input.clientId,
  });
  if (input.clientId !== undefined && !snapshot.clients.some((client) => client.id === input.clientId)) {
    return DENIED;
  }

  const ordenadas = [...snapshot.entries].sort(antesNoCalendario);
  const summary = {
    deliveries: ordenadas.filter((entry) => entry.kind === 'delivery').length,
    deliveriesDone: ordenadas.filter((entry) => entry.kind === 'delivery' && entry.isCompleted).length,
    appointments: ordenadas.filter((entry) => entry.kind === 'appointment').length,
  };
  // A posição na ordem do calendário vira a chave do cursor (zeros à esquerda).
  const entradas = ordenadas.map((entry, posicao) => ({ entry, posicao: String(posicao).padStart(6, '0') }));

  const meta = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now,
  });
  const self =
    `${GET_CALENDAR_PATH}?from=${input.from}&to=${input.to}` +
    (input.clientId === undefined ? '' : `&clientId=${encodeURIComponent(input.clientId)}`);
  const assemble = (page: { items: typeof entradas; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'get_calendar' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    coverage: coverageOf(ctx.person, ctx.grant),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    period: { from: input.from, to: input.to, days },
    timezone: AGENCY_TIMEZONE,
    summary,
    entries: page.items.map(({ entry }) => ({
      kind: entry.kind,
      id: entry.id,
      day: entry.day,
      time: entry.time,
      client: { id: entry.clientId, name: entry.clientName },
      type: entry.kind === 'delivery' ? (entry.contentType as ContentType) : null,
      title: entry.title,
      done: entry.kind === 'delivery' ? entry.isCompleted : null,
      extra: entry.kind === 'delivery' ? entry.isExtra : null,
    })),
  });

  const paged = pageAndFit(entradas, {
    limit: input.limit,
    cursor: input.cursor,
    key: ({ entry, posicao }) => ({ k: posicao, id: entry.id }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = getCalendarResponseSchema.parse(assemble(paged));
  if (overBudget(body)) return OVER_BUDGET;
  return { ok: true, body };
}
