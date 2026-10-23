/**
 * `get_month_attention` — conferência de 08/10/2026, lacuna G1.
 *
 * A PERGUNTA DO DONO: "quais clientes estão ficando para trás neste mês?". A
 * visão Contrato do Planejamento (F43) já responde na tela, com a faixa
 * "Precisa de atenção". Esta leitura entrega a MESMA resposta ao agente.
 *
 * NÃO TEM REGRA PRÓPRIA — e é de propósito. O ritual, o contrato por tipo nos
 * seis baldes, os motivos e a ordem vêm de `planejarMes`, `listaDeAtencao` e
 * `agruparMesPorResponsavel` (`src/painel/planejamento-do-mes.ts`), as funções
 * que a tela chama, sobre o MESMO retrato que `get_planning_weeks` carrega
 * (`DeliveryCatalog.loadPlanning`) mais o ritual de `month_contracts`. Uma
 * segunda cópia da regra ficaria para trás na primeira mudança — o erro que a
 * F38 corrigiu quando o relatório leu da fonte errada. Daqui sai só o FORMATO.
 *
 * O RECORTE (as lições da conferência de 08/10)
 *   · concessão: `toWorkScope` (empresas, clientes e capacidade), estreitado
 *     ANTES da leitura quando há `clientId`;
 *   · empresa omitida e cliente cancelado: o catálogo só devolve cliente ATIVO
 *     do recorte (`scopedClient` + `c.is_active`), e `clientId` de fora é a
 *     mesma recusa de um id que não existe;
 *   · pessoas: o nome de quem planejou/aprovou e o de responsável que é
 *     pessoa (carteira individual) só saem com `people:read`; o nome de pasta
 *     (time) é do relatório. O link de aprovação do cliente nunca é lido.
 */

import {
  GET_MONTH_ATTENTION_PATH,
  MONTH_ATTENTION_REASON_KEYS,
  DELIVERY_MONTH_PATTERN,
  getMonthAttentionResponseSchema,
  type GetMonthAttentionResponse,
} from '@/integrations/contract';
import { getContext } from '@/integrations/context';
import { overBudget, parsePageRequest } from '@/integrations/page';
import {
  asPageError,
  pageAndFit,
  toWorkScope,
  type ReadFailure,
} from '@/integrations/reads';
import type { IntegrationCapability } from '@/integrations/grants';
import {
  civilDate,
  coverageOf,
  criarDonoDe,
  narrowToClient,
  type DeliveryPlanningSnapshot,
  type ReportCtx,
} from '@/integrations/reports';
import {
  type LinhaDoMes,
  agruparMesPorResponsavel,
  listaDeAtencao,
  planejarMes,
} from '@/painel/planejamento-do-mes';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import type { PlanningRow } from '@/server/planning';
import {
  type PlanningWeeksRow,
  donosDoPlanejamento,
  quotasDoCadastro,
  quotasDoContrato,
  resolvePlanningQuota,
} from '@/server/planning-weeks';

export type MonthAttentionResult = { ok: true; body: GetMonthAttentionResponse } | ReadFailure;

const DENIED: ReadFailure = {
  ok: false,
  code: 'permission_denied',
  message: 'Fora do alcance desta integração.',
};

const OVER_BUDGET: ReadFailure = {
  ok: false,
  code: 'data_incomplete',
  message: 'Nem um cliente coube no orçamento de 64 KiB. Filtre por clientId.',
};

export type ClientRow = GetMonthAttentionResponse['clients'][number];
export type OwnerView = NonNullable<GetMonthAttentionResponse['groups'][number]['owner']>;

/**
 * O retrato do mês → as DUAS leituras que a tela junta (`GET /planning`, o
 * ritual, e `GET /planning/weeks`, as semanas). Aqui as duas saem do mesmo
 * retrato, então `planejarMes` vê sempre a leitura "completa".
 *
 * A cota, o mês aberto e os responsáveis usam os MESMOS auxiliares da rota
 * (`quotasDoContrato`, `quotasDoCadastro`, `resolvePlanningQuota`,
 * `donosDoPlanejamento`): só a montagem da linha é daqui.
 */
export function leiturasDoRetrato(snapshot: DeliveryPlanningSnapshot): {
  ritual: PlanningRow[];
  semanas: PlanningWeeksRow[];
} {
  const { opened, byClient: doContrato } = quotasDoContrato(snapshot.contracts);
  const doCadastro = quotasDoCadastro(snapshot.registry);
  const donosDe = donosDoPlanejamento(snapshot.folders, snapshot.portfolio);
  const marcosDe = new Map(snapshot.ritual.map((marco) => [marco.clientId, marco]));
  const pecasDe = new Map<string, PlanningWeeksRow['items']>();
  for (const { clientId, ...peca } of snapshot.items) {
    const lista = pecasDe.get(clientId) ?? [];
    lista.push(peca);
    pecasDe.set(clientId, lista);
  }

  const ritual: PlanningRow[] = [];
  const semanas: PlanningWeeksRow[] = [];
  for (const client of snapshot.clients) {
    const aberto = opened.has(client.id);
    const marcos = marcosDe.get(client.id);
    ritual.push({
      id: client.id,
      name: client.name,
      categoryId: client.companyId,
      categoryName: client.companyName,
      plan: null,
      monthOpened: aberto,
      planningDoneAt: marcos?.planningDoneAt ?? null,
      clientApprovedAt: marcos?.clientApprovedAt ?? null,
    });
    const { quotaSource, quota, hasContentContract } = resolvePlanningQuota({
      opened: aberto,
      contract: doContrato.get(client.id),
      registry: doCadastro.get(client.id),
    });
    semanas.push({
      id: client.id,
      name: client.name,
      categoryId: client.companyId,
      categoryName: client.companyName,
      plan: null,
      owners: (donosDe.get(client.id) ?? []).map((owner) => ({
        id: owner.id,
        name: owner.name.trim() || 'Pessoa sem nome',
      })),
      quotaSource,
      quota,
      hasContentContract,
      items: pecasDe.get(client.id) ?? [],
    });
  }
  return { ritual, semanas };
}

/**
 * A PROJEÇÃO por capacidade, num lugar só: a mesma linha de cliente serve a
 * `get_month_attention` e a `get_client_month`, e as duas escondem o que a
 * concessão não lê do mesmo jeito.
 *
 *   · `people:read`: o nome de quem planejou/aprovou e o de responsável que é
 *     PESSOA (carteira individual) — sem ela, nulo. O nome de pasta (time) é do
 *     relatório. O id fica: sem ele o filtro `ownerId` e os grupos não fechariam.
 *   · o link de aprovação do cliente não está no retrato, então não há o que vazar.
 */
export function criarProjecao(
  snapshot: DeliveryPlanningSnapshot,
  capabilities: ReadonlySet<IntegrationCapability>,
  precisa: ReadonlySet<string>,
) {
  const podePessoas = capabilities.has('people:read');
  // A regra do responsável mora em `criarDonoDe` (reports.ts): `get_planning_weeks` usa a mesma.
  const donoDe: (owner: { id: string; name: string }) => OwnerView = criarDonoDe(snapshot.portfolio, capabilities);
  const marcosDe = new Map(snapshot.ritual.map((marco) => [marco.clientId, marco]));
  const pessoa = (quem: { id: string; name: string } | null | undefined) =>
    podePessoas && quem ? { id: quem.id, name: quem.name } : null;

  const linhaParaSaida = (linha: LinhaDoMes): ClientRow => {
    const marcos = marcosDe.get(linha.id);
    return {
      id: linha.id,
      name: linha.name,
      company: { id: linha.categoryId, name: linha.categoryName },
      owners: linha.owners.map(donoDe),
      stage: linha.estagio,
      stageLabel: linha.rotuloDoEstagio,
      ritual: {
        monthOpened: linha.monthOpened,
        planningDoneAt: linha.planningDoneAt,
        planningDoneBy: pessoa(marcos?.planningDoneBy),
        clientApprovedAt: linha.clientApprovedAt,
        clientApprovedBy: pessoa(marcos?.clientApprovedBy),
      },
      hasContract: linha.temContrato,
      quotaSource: linha.quotaSource,
      when: linha.quando,
      currentWeek: linha.semanaAtual
        ? { number: linha.semanaAtual.numero, from: linha.semanaAtual.de, to: linha.semanaAtual.ate }
        : null,
      needsAttention: precisa.has(linha.id),
      weight: linha.peso,
      reasons: linha.motivos.map((motivo) => ({ key: motivo.chave, text: motivo.texto, weight: motivo.peso })),
      types: linha.tipos.map((tipo) => ({
        type: tipo.tipo,
        contract: tipo.contrato,
        delivered: tipo.entregues,
        scheduled: tipo.marcadas,
        late: tipo.atrasadas,
        outsideMonth: tipo.foraDoMes,
        withoutDay: tipo.semDia,
        notCreated: tipo.naoCriadas,
        missingToSchedule: tipo.faltaMarcar,
        extras: tipo.extras,
        pendingExtras: tipo.extrasPendentes,
        lateExtras: tipo.extrasAtrasadas,
        week: tipo.semana
          ? {
              goal: tipo.semana.meta,
              done: tipo.semana.feitas,
              scheduled: tipo.semana.marcadas,
              late: tipo.semana.atrasadas,
              state: tipo.semana.estado,
            }
          : null,
      })),
    };
  };

  return { donoDe, linhaParaSaida };
}

/**
 * `get_month_attention`: o mês de cada cliente ativo do recorte, com o ritual,
 * o contrato por tipo e os motivos de atenção — a visão Contrato do Planejamento.
 */
export async function getMonthAttention(
  ctx: ReportCtx,
  input: {
    month?: string;
    clientId?: string;
    ownerId?: string;
    onlyAttention?: boolean;
    limit?: number;
    cursor?: string;
  },
): Promise<MonthAttentionResult> {
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

  // A MESMA regra da tela: junta as leituras, conta o contrato, acha os motivos.
  const { ritual, semanas } = leiturasDoRetrato(snapshot);
  const doMes = planejarMes({ ritual, semanas, mes: month, hoje: today });
  const linhas =
    input.ownerId === undefined
      ? doMes
      : doMes.filter((linha) => linha.owners.some((owner) => owner.id === input.ownerId));

  // Quem precisa de atenção vem primeiro, na ordem da faixa da tela
  // (`listaDeAtencao`: motivo mais pesado, depois o nome); o resto, por nome.
  const atencao = listaDeAtencao(linhas);
  const precisa = new Set(atencao.map((linha) => linha.id));
  const resto = linhas.filter((linha) => !precisa.has(linha.id));
  const ordenadas = input.onlyAttention === true ? atencao : [...atencao, ...resto];

  const { donoDe, linhaParaSaida } = criarProjecao(snapshot, scope.capabilities, precisa);

  // Os totais valem para o filtro inteiro; a página só recorta `clients`.
  const summary: GetMonthAttentionResponse['summary'] = {
    clients: linhas.length,
    withContract: linhas.filter((linha) => linha.temContrato).length,
    needingAttention: atencao.length,
    byStage: {
      fechado: linhas.filter((linha) => linha.estagio === 'fechado').length,
      aberto: linhas.filter((linha) => linha.estagio === 'aberto').length,
      planejado: linhas.filter((linha) => linha.estagio === 'planejado').length,
      aprovado: linhas.filter((linha) => linha.estagio === 'aprovado').length,
    },
    byReason: MONTH_ATTENTION_REASON_KEYS.map((key) => ({
      key,
      clients: atencao.filter((linha) => linha.motivos.some((motivo) => motivo.chave === key)).length,
    })),
  };

  // A posição na ordem da tela vira a chave do cursor (zeros à esquerda): a
  // paginação ordena a chave como texto, e a ordem pt-BR da faixa não é a do
  // código de caractere.
  const entradas = ordenadas.map((linha, posicao) => ({
    linha,
    posicao: String(posicao).padStart(6, '0'),
  }));
  const meta = getContext({
    grant: ctx.grant,
    person: ctx.person,
    origin: ctx.origin,
    companies: ctx.companies,
    displayName: ctx.displayName,
    now,
  });
  const self =
    `${GET_MONTH_ATTENTION_PATH}?month=${month}` +
    (input.clientId === undefined ? '' : `&clientId=${encodeURIComponent(input.clientId)}`) +
    (input.ownerId === undefined ? '' : `&ownerId=${encodeURIComponent(input.ownerId)}`) +
    (input.onlyAttention === true ? '&onlyAttention=true' : '');
  const assemble = (page: { items: typeof entradas; hasMore: boolean; nextCursor: string | null }) => ({
    operation: 'get_month_attention' as const,
    queriedAt: meta.queriedAt,
    self,
    effectiveScope: meta.effectiveScope,
    coverage: coverageOf(ctx.person, ctx.grant),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    month,
    today,
    timezone: AGENCY_TIMEZONE,
    summary,
    clients: page.items.map((entrada) => linhaParaSaida(entrada.linha)),
    groups: agruparMesPorResponsavel(page.items.map((entrada) => entrada.linha)).map((grupo) => ({
      owner:
        grupo.id === null
          ? null
          : donoDe({ id: grupo.id, name: grupo.nome }),
      clientIds: grupo.linhas.map((linha) => linha.id),
      needingAttention: grupo.linhas.filter((linha) => precisa.has(linha.id)).length,
      atRisk: grupo.emRisco,
    })),
  });

  const paged = pageAndFit(entradas, {
    limit: input.limit,
    cursor: input.cursor,
    key: (entrada) => ({ k: entrada.posicao, id: entrada.linha.id }),
    envelopeOf: assemble,
  });
  if (!('items' in paged)) return asPageError(paged);

  const body = getMonthAttentionResponseSchema.parse(assemble(paged));
  if (overBudget(body)) return OVER_BUDGET;
  return { ok: true, body };
}
