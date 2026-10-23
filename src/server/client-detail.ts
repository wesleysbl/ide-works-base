/**
 * Tela do cliente — etapa F4.2.
 *
 * A SEPARAÇÃO QUE ORGANIZA ESTA TELA
 *   O contrato é **mensal**; a visão é **livre**. São coisas diferentes e a tela
 *   mostra as duas ao mesmo tempo:
 *
 *     medidor    sempre do MÊS inteiro, contra o contrato daquele mês
 *     listagem   do PERÍODO escolhido, de X a Y
 *
 *   Confundir os dois faria o medidor mudar ao arrastar o período, dando a
 *   impressão de que a entrega piorou quando só a janela encolheu.
 *
 * ITEM SEM DATA APARECE NO MÊS, NÃO NO PERÍODO
 *   73% dos itens do legado não têm data — são planejados, ainda não agendados.
 *   Filtrar por data os esconderia, e a pessoa acharia que sumiram. Eles vêm
 *   numa lista à parte, explicitamente.
 */

import { type DeliveryResult, calculateDeliveryLevel } from '@/delivery/level';
import { type Sql, inlineDate, inlineUuid, withActor } from '@/server/db';
import { firstDayOfMonth } from '@/server/panel';
import { diaDeSaoPaulo } from '@/server/semana-do-controle';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export type ClientItem = {
  id: string;
  contentType: string;
  platform: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  isExtra: boolean;
  title: string | null;
};

/**
 * A ficha — etapa F4.6.
 *
 * Tudo o que o cabeçalho e o cartão de informações mostram. Vem junto com o
 * resto numa chamada só: são a mesma tela, e duas idas fariam a ficha aparecer
 * depois do medidor, com o layout pulando no meio da leitura.
 */
export type ClientProfile = {
  taxId: string | null;
  companyEmail: string | null;
  plan: { id: string; name: string; colorBg: string; colorText: string; colorBorder: string } | null;
  categoryId: string;
  startedOn: string;
  renewsOn: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerWhatsapp: string | null;
  notes: string | null;
  financeOk: boolean;
  inactiveAt: string | null;
  links: Array<{ id: string; title: string; url: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  /** Cota vigente — o que o cliente contrata HOJE, não o do mês. */
  quotas: Array<{ contentType: string; quantity: number }>;
};

export type ClientDetail = {
  id: string;
  name: string;
  categoryName: string;
  planName: string | null;
  urgency: string;
  isActive: boolean;
  profile: ClientProfile;
  /** Vizinhos na ordem alfabética, para as setas ‹ › do cabeçalho. */
  neighbors: { previous: string | null; next: string | null };
  month: string;
  monthOpened: boolean;
  planningDoneAt: string | null;
  clientApprovedAt: string | null;
  contract: Array<{ contentType: string; quantity: number }>;
  delivery: DeliveryResult;
  /**
   * Itens com data dentro do período escolhido — ou, sem período escolhido,
   * todos os do mês que têm data (ver `repartirItensDoMes`).
   */
  scheduled: ClientItem[];
  /** Itens do mês ainda sem data. Vêm à parte para não parecerem sumidos. */
  unscheduled: ClientItem[];
  /**
   * O mês inteiro, sem recorte de período — etapa F4.7.
   *
   * A grade semanal precisa das cinco semanas sempre completas. Se ela lesse
   * `scheduled`, encolher o período faria semanas inteiras esvaziarem na tela
   * enquanto o medidor, que é do mês, continuaria alto — a mesma confusão que a
   * separação medidor/período existe para evitar.
   *
   * Os três campos saem da MESMA consulta. É a ideia da F3.2 levada à API: a
   * grade, o calendário e o medidor são leituras de um dado só.
   */
  monthItems: ClientItem[];
};

/** `date` do Postgres chega como Date do driver; a tela quer `YYYY-MM-DD`. */
function comoDia(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

/**
 * O item com data cai dentro do período? O fim é exclusivo.
 *
 * O DIA É O DE SÃO PAULO — o mesmo do Calendário (`readCalendar`), da grade
 * semanal e da "última entrega". Com o dia de UTC (`toISOString().slice(0, 10)`)
 * a peça marcada às 22h do último dia do período (01h UTC do dia seguinte) saía
 * da lista da ficha enquanto o Calendário da mesma ficha a mostrava.
 */
export function itemNoPeriodo(agendadoEm: unknown, janela: { from: string; to: string }): boolean {
  if (!agendadoEm) return false;
  const instante = new Date(agendadoEm as string);
  if (Number.isNaN(instante.getTime())) return false;
  const dia = diaDeSaoPaulo(instante);
  return dia >= janela.from && dia < janela.to;
}

/**
 * Reparte os itens do mês em "com data" e "sem data" para a lista de Conteúdos.
 *
 * SEM PERÍODO ESCOLHIDO, "COM DATA" É TUDO O QUE TEM DATA — INCLUSIVE A DE OUTRO
 * MÊS. O padrão da ficha é "o mês", mas o mês aqui é o de COMPETÊNCIA: a peça
 * de agosto agendada para 2 de setembro conta no medidor de agosto e na
 * Semanal ("agendado fora deste mês"). Filtrá-la pela janela do mês a tirava
 * da lista de Conteúdos — o medidor dizia "2 de 3", e o terceiro não estava em
 * lugar nenhum da lista, nem para desmarcar. Com período escolhido a lista
 * respeita o recorte pedido, como sempre.
 */
export function repartirItensDoMes<T extends Record<string, unknown>>(
  doMes: readonly T[],
  period?: { from: string; to: string },
): { agendados: T[]; semData: T[] } {
  return {
    agendados: doMes.filter((r) => (period === undefined ? Boolean(r.scheduled_at) : itemNoPeriodo(r.scheduled_at, period))),
    semData: doMes.filter((r) => !r.scheduled_at),
  };
}

export class ClientNotVisible extends Error {
  constructor() {
    super('Cliente não encontrado.');
    this.name = 'ClientNotVisible';
  }
}

export type Period = { from: string; to: string };

/** Período padrão: o mês inteiro. */
export function defaultPeriod(month: string): Period {
  const inicio = firstDayOfMonth(month);
  const d = new Date(`${inicio}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return { from: inicio, to: d.toISOString().slice(0, 10) };
}

export async function readClientDetail(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  month: string,
  period?: Period,
): Promise<ClientDetail> {
  const referenceMonth = firstDayOfMonth(month);

  return withActor(sql, asDbActor(actor), async (tx) => {
    // O id do cliente e o mês vão no TEXTO das consultas (`inlineUuid`,
    // `inlineDate`; fora do formato seguem como parâmetro) e as oito saem na
    // mesma ida. Eram oito consultas em fila, cada uma com parâmetro: duas
    // idas por consulta com `prepare: false`, ~16 idas para abrir a tela de um
    // cliente. `client-detail-idas.test.ts` conta no fio: 20 -> 4. O texto de
    // cada consulta e a ordem em que o Postgres as executa são os de antes, sob
    // o mesmo ator.
    //
    // Cliente que não existe (ou que a política não deixa ver) paga as sete
    // leituras pequenas a mais antes de a recusa sair — raro, e barato perto
    // das idas que as outras telas economizam.
    const cliente = inlineUuid(tx, clientId);
    const mes = inlineDate(tx, referenceMonth);

    const [clientes, links, etiquetas, cotas, vizinhosLinhas, marcos, contrato, doMes] = await Promise.all([
      tx`
      select c.id, c.name, c.category_id, cat.name as category_name,
             c.urgency, c.is_active, c.inactive_at, c.finance_ok,
             c.tax_id, c.company_email, c.started_on, c.renews_on,
             c.phone, c.whatsapp, c.address,
             c.owner_name, c.owner_phone, c.owner_whatsapp, c.notes,
             p.id as plan_id, p.name as plan_name,
             p.color_bg, p.color_text, p.color_border
        from ideworks.clients c
        join ideworks.client_categories cat on cat.id = c.category_id
        left join ideworks.plans p on p.id = c.plan_id
       where c.id = ${cliente}`,

      tx`
      select id, title, url from ideworks.client_links
       where client_id = ${cliente} order by sort_order, title`,

      tx`
      select t.id, t.name, t.color
        from ideworks.client_tag_assignments ta
        join ideworks.client_tags t on t.id = ta.tag_id
       where ta.client_id = ${cliente} order by t.name`,

      tx`
      select content_type, quantity from ideworks.client_quotas
       where client_id = ${cliente} order by content_type`,

      // As setas ‹ › caminham DENTRO do mesmo estado: partindo de um cliente
      // arquivado percorre-se o arquivo, não a carteira ativa. Sem a partição, a
      // seta pularia de um inativo para um ativo sem aviso, e a pessoa acharia
      // que voltou para a lista errada.
      //
      // A janela corre sobre o que a POLÍTICA deixa ver, não sobre a tabela
      // inteira — então cada pessoa navega a própria carteira, e a seta nunca
      // revela a existência de um cliente que ela não poderia abrir.
      tx`
      with ordenados as (
        select id,
               lag(id)  over (partition by is_active order by name, id) as anterior,
               lead(id) over (partition by is_active order by name, id) as proximo
          from ideworks.clients
      )
      select anterior, proximo from ordenados where id = ${cliente}`,

      tx`
      select planning_done_at, client_approved_at
        from ideworks.month_contracts
       where client_id = ${cliente} and reference_month = ${mes}`,

      tx`
      select i.content_type, i.quantity
        from ideworks.month_contracts mc
        join ideworks.month_contract_items i on i.contract_id = mc.id
       where mc.client_id = ${cliente} and mc.reference_month = ${mes}
       order by i.content_type`,

      tx`
      select id, content_type, platform, scheduled_at, completed_at, is_extra, title
        from ideworks.content_items
       where client_id = ${cliente} and reference_month = ${mes}
       order by scheduled_at nulls last, created_at`,
    ]);

    // A política do schema já filtrou. Zero linhas aqui significa "não pode
    // ver" ou "não existe" — e a mensagem é a mesma nos dois casos, de
    // propósito: distinguir entregaria a existência de clientes alheios.
    if (clientes.length === 0) throw new ClientNotVisible();
    const c = clientes[0];
    const vizinhos = vizinhosLinhas[0];

    const paraTela = (r: Record<string, unknown>): ClientItem => ({
      id: r.id as string,
      contentType: r.content_type as string,
      platform: (r.platform as string | null) ?? null,
      scheduledAt: r.scheduled_at ? new Date(r.scheduled_at as string).toISOString() : null,
      completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
      isExtra: r.is_extra as boolean,
      title: (r.title as string | null) ?? null,
    });

    const { agendados, semData } = repartirItensDoMes(doMes, period);

    return {
      id: c.id as string,
      name: c.name as string,
      categoryName: c.category_name as string,
      planName: (c.plan_name as string | null) ?? null,
      urgency: c.urgency as string,
      isActive: c.is_active as boolean,
      profile: {
        taxId: (c.tax_id as string | null) ?? null,
        companyEmail: (c.company_email as string | null) ?? null,
        plan:
          c.plan_id === null
            ? null
            : {
                id: c.plan_id as string,
                name: c.plan_name as string,
                colorBg: c.color_bg as string,
                colorText: c.color_text as string,
                colorBorder: c.color_border as string,
              },
        categoryId: c.category_id as string,
        startedOn: comoDia(c.started_on) as string,
        renewsOn: comoDia(c.renews_on),
        phone: (c.phone as string | null) ?? null,
        whatsapp: (c.whatsapp as string | null) ?? null,
        address: (c.address as string | null) ?? null,
        ownerName: (c.owner_name as string | null) ?? null,
        ownerPhone: (c.owner_phone as string | null) ?? null,
        ownerWhatsapp: (c.owner_whatsapp as string | null) ?? null,
        notes: (c.notes as string | null) ?? null,
        financeOk: c.finance_ok as boolean,
        inactiveAt: c.inactive_at ? new Date(c.inactive_at as string).toISOString() : null,
        links: links.map((l) => ({
          id: l.id as string,
          title: l.title as string,
          url: l.url as string,
        })),
        tags: etiquetas.map((t) => ({
          id: t.id as string,
          name: t.name as string,
          color: t.color as string,
        })),
        quotas: cotas.map((q) => ({
          contentType: q.content_type as string,
          quantity: Number(q.quantity),
        })),
      },
      neighbors: {
        previous: (vizinhos?.anterior as string | null) ?? null,
        next: (vizinhos?.proximo as string | null) ?? null,
      },
      month: referenceMonth,
      monthOpened: contrato.length > 0 || marcos.length > 0,
      planningDoneAt: marcos[0]?.planning_done_at
        ? new Date(marcos[0].planning_done_at as string).toISOString()
        : null,
      clientApprovedAt: marcos[0]?.client_approved_at
        ? new Date(marcos[0].client_approved_at as string).toISOString()
        : null,
      contract: contrato.map((r) => ({
        contentType: r.content_type as string,
        quantity: Number(r.quantity),
      })),
      // Sempre o mês inteiro, nunca o período. Ver a nota no topo.
      delivery: calculateDeliveryLevel(
        contrato.map((r) => ({
          contentType: r.content_type as string,
          quantity: Number(r.quantity),
        })),
        doMes.map((r) => ({
          contentType: r.content_type as string,
          isExtra: r.is_extra as boolean,
          isCompleted: r.completed_at !== null,
        })),
        // F17.57: sem estes dois, um mês ABERTO e sem item congelado era
        // anunciado como "ainda não foi aberto" — a mesma caixa que, logo
        // abaixo, mostrava o ciclo em "aberto, falta planejar".
        {
          monthOpened: contrato.length > 0 || marcos.length > 0,
          hasContentContract: cotas.some((q) => Number(q.quantity) > 0),
        },
      ),
      scheduled: agendados.map(paraTela),
      unscheduled: semData.map(paraTela),
      monthItems: doMes.map(paraTela),
    };
  });
}
