/**
 * Leitura do painel — etapas F4.1 e F4.4.
 *
 * UMA CONSULTA, NÃO UMA POR CLIENTE
 *   O painel mostra todos os clientes com o medidor do mês. Buscar contrato e
 *   itens cliente a cliente daria 91 idas ao banco por carregamento — e o
 *   sistema pareceria lento sem que ninguém soubesse por quê.
 *
 *   Aqui são três consultas para a lista inteira, e o cálculo acontece em
 *   memória, pela mesma função que a tela do cliente usa. Uma fórmula só,
 *   inclusive entre telas.
 *
 * A CARTEIRA VEM DO BANCO, NÃO DAQUI
 *   Nenhuma destas consultas filtra por permissão. Não é esquecimento: as
 *   políticas do schema já recusam o que a pessoa não pode ver, e duplicar a
 *   regra aqui criaria uma segunda cópia para ficar desatualizada.
 *
 * O QUE A F4.4 ACRESCENTOU, E POR QUÊ
 *   O cockpit desenha selo de plano colorido, etiqueta colorida, data de
 *   renovação com a contagem de dias, e a borda por urgência. Tudo isso já
 *   estava no banco e parava aqui — a leitura antiga devolvia só o nome do
 *   plano e uma lista de nomes de etiqueta.
 *
 *   **Não há endpoint de agregado.** Os sete cartões de número do topo saem da
 *   soma desta mesma lista, na tela. Um segundo endpoint que agregasse no banco
 *   seria uma segunda verdade sobre o mesmo mês, livre para divergir da lista
 *   logo abaixo dela — exatamente a dívida 8.1 do legado, reencenada.
 *
 * A CONFERÊNCIA DA JUNÇÃO SAI DESTA MESMA LEITURA — F17.86
 *   Clientes ativos sem lista e listas de trabalho sem cliente. A classificação
 *   mora em `painel/conferencia.ts`; aqui só se lê o que a política já recorta.
 *   Um segundo GET para a conferência seria duas opiniões na tela.
 */

import { type DeliveryResult, calculateDeliveryLevel } from '@/delivery/level';
import type { DeliveryStatus } from '@/delivery/ultima-entrega';
import {
  type Conferencia,
  type ListaParaConferir,
  conferirVinculos,
} from '@/painel/conferencia';
import { clienteNoMesSql, diaDaPecaSql } from '@/server/cliente-no-periodo';
import { type Sql, inlineDate, inlineDateList, inlineUuidList, withActor } from '@/server/db';
import { readDeliveryStatus } from '@/server/delivery-status';
import { recorteDasOmitidas } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/** O selo do plano carrega as cores dele. Vêm do banco, não do código. */
export type PanelPlan = {
  id: string;
  name: string;
  colorBg: string;
  colorText: string;
  colorBorder: string;
};

export type PanelTag = { id: string; name: string; color: string };

export type PanelClient = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  /** A ordem escolhida na tela de catalogos. Nenhuma tela a le desde a F31
   *  (as abas de unidade do painel sairam); fica pelo contrato da resposta. */
  categorySortOrder: number;
  plan: PanelPlan | null;
  urgency: 'paz' | 'alerta' | 'perigo';
  isActive: boolean;
  /** Preenchido só quando inativo — o banco garante a coerência dos dois. */
  inactiveAt: string | null;
  financeOk: boolean;
  startedOn: string;
  renewsOn: string | null;
  tags: PanelTag[];
  /**
   * Produção **datada** dentro do intervalo escolhido.
   *
   * Separada do medidor de propósito: o medidor cobra contra o contrato do mês,
   * e o intervalo pode cortar o mês ao meio. Misturar os dois faria encolher a
   * janela parecer queda de entrega.
   */
  inPeriod: { scheduled: number; completed: number };
  delivery: DeliveryResult;
  /**
   * Última entrega, vencidas, vence hoje, sem dia e próxima — pela Semanal.
   * F38: a regra é `delivery/ultima-entrega.ts`, a mesma do MCP.
   *
   * NULO PARA CLIENTE INATIVO: cancelado não entra em leitura do presente.
   * Não depende do intervalo escolhido — "última entrega" é sempre até hoje.
   */
  deliveryStatus: DeliveryStatus | null;
};

/** Normaliza para o primeiro dia do mês — a única forma que o banco aceita. */
export function firstDayOfMonth(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(`${input.slice(0, 10)}T00:00:00Z`) : input;
  if (Number.isNaN(d.getTime())) throw new Error(`Mês inválido: "${String(input)}".`);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Quantos meses de competência um intervalo toca — etapa F4.11.
 *
 * O CONTRATO É MENSAL; O INTERVALO É LIVRE
 *   O medidor cobra contra o contrato do mês. Um intervalo que corta o mês ao
 *   meio **não pode** cortar o contrato junto: "01 a 15 de agosto" não significa
 *   meio contrato. Então o medidor se faz sobre os MESES que o intervalo toca,
 *   inteiros — e os dias servem para outra leitura, a da produção datada.
 *
 *   É a mesma separação da tela do cliente: o medidor é do mês, a lista é do
 *   período. Aqui ela sobe para o painel.
 *
 * O TETO EXISTE PARA A CONTA NÃO SUMIR DE VISTA
 *   Somar 120 meses devolveria um número que ninguém sabe ler, depois de uma
 *   consulta que varre a base inteira. Recusa-se com a frase dizendo o limite,
 *   em vez de responder devagar e errado.
 */
export const MAX_MESES_NO_INTERVALO = 24;

export function monthsInRange(from: string, to: string): string[] {
  const inicio = firstDayOfMonth(from);
  const fim = firstDayOfMonth(to);
  if (inicio > fim) throw new Error(`Intervalo invertido: "${from}" vem depois de "${to}".`);

  const meses: string[] = [];
  const cursor = new Date(`${inicio}T00:00:00Z`);
  const ultimo = new Date(`${fim}T00:00:00Z`);

  while (cursor <= ultimo) {
    meses.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    if (meses.length > MAX_MESES_NO_INTERVALO) {
      throw new Error(
        `Intervalo grande demais: no máximo ${MAX_MESES_NO_INTERVALO} meses por vez.`,
      );
    }
  }
  return meses;
}

/** `date` do Postgres chega como Date do driver; a tela quer `YYYY-MM-DD`. */
function comoDia(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

export type PainelLido = {
  clients: PanelClient[];
  /**
   * A junção incompleta, no mesmo retrato da carteira.
   *
   * Sai daqui — e não de uma segunda rota — para a tela não ter duas
   * opiniões: uma da lista de clientes, outra de uma consulta à parte
   * que poderia chegar depois ou recortar diferente.
   */
  conferencia: Conferencia;
};

export async function readPanel(
  sql: Sql,
  actor: AuthenticatedActor,
  /** Dia inicial, inclusivo. */
  from: string,
  /** Dia final, inclusivo — é como as pessoas leem "de 1 a 20". */
  to: string,
  /** O instante do "hoje" da situação de entrega. Parâmetro só para a suíte e a prova. */
  agora: Date = new Date(),
): Promise<PainelLido> {
  const meses = monthsInRange(from, to);
  const primeiroDia = from.slice(0, 10);
  const ultimoDia = to.slice(0, 10);

  return withActor(sql, asDbActor(actor), async (tx) => {
    // AS SETE LEITURAS SAEM JUNTAS — perf do servidor, 08/10/2026
    //
    //   Eram sete consultas em fila (mais as três da situação de entrega), cada
    //   uma com parâmetro: 23 idas com `prepare: false`, na tela principal. Os
    //   meses, os dias e os ids das omitidas vão agora no TEXTO (`inlineDateList`,
    //   `inlineDate`, `inlineUuidList`; fora do formato seguem como parâmetro), e
    //   as sete saem numa ida só. O texto de cada consulta e a ordem em que o
    //   Postgres as executa são os de antes, sob o mesmo ator. `painel-idas.test.ts`
    //   conta no fio.
    //
    //   Carteira vazia paga as seis leituras seguintes à toa — um painel sem
    //   cliente nenhum não é o caso que importa.
    const semOmitidas = (ids: string[]) => inlineUuidList(tx, ids);
    const mesesNoTexto = inlineDateList(tx, meses);

    const [clientes, listasDaConferencia, contratos, mesesAbertos, cotasVigentes, itens, noPeriodo] =
      await Promise.all([
        // As etiquetas saem em `json_agg` em vez de `array_agg` porque agora são
        // objetos (nome + cor), e um `group by` com três colunas de plano mais duas
        // de etiqueta multiplicaria as linhas do agrupamento sem necessidade.
        //
        // F31 — cliente de empresa omitida não entra no Painel, e com ele saem as
        // renovações e a entrega dele (tudo abaixo parte desta lista). A
        // conferência também só olha listas de espaço não omitido: senão acusaria
        // "lista sem cliente" justamente para o que a omissão escondeu.
        tx`
      select c.id, c.name, c.category_id, cat.name as category_name,
             cat.sort_order as category_sort_order,
             c.urgency, c.is_active, c.inactive_at, c.finance_ok,
             c.started_on, c.renews_on,
             p.id as plan_id, p.name as plan_name,
             p.color_bg, p.color_text, p.color_border,
             coalesce(
               (select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)
                                order by t.name)
                  from ideworks.client_tag_assignments ta
                  join ideworks.client_tags t on t.id = ta.tag_id
                 where ta.client_id = c.id),
               '[]'::json
             ) as tags
        from ideworks.clients c
        join ideworks.client_categories cat on cat.id = c.category_id
        left join ideworks.plans p on p.id = c.plan_id
       ${recorteDasOmitidas(tx, actor, (ids) => tx`where c.category_id <> all(${semOmitidas(ids)}::uuid[])`)}
       order by c.name`,

        // A conferência lê as listas que a política já recortou — `lists_select`
        // pergunta `can_see_space`. Não há `security definer` aqui: alargar
        // mostraria trabalho de um time que a pessoa não alcança.
        tx`
      select l.id, l.name, l.client_id,
             (l.archived_at is not null) as archived,
             (s.archived_at is not null) as space_archived,
             s.name as space_name,
             (select count(*)::int from ideworks.tasks k
               where k.list_id = l.id
                 and k.archived_at is null) as task_count
        from ideworks.lists l
        join ideworks.spaces s on s.id = l.space_id
       ${recorteDasOmitidas(tx, actor, (ids) => tx`where s.category_id <> all(${semOmitidas(ids)}::uuid[])`)}`,

        // Meses INTEIROS, mesmo quando o intervalo corta o mês ao meio: contrato
        // não se corta. Ver a nota em `monthsInRange`.
        //
        // F38, Fase 5 — contrato e mês aberto de cliente cancelado só contam nos
        // meses até o do cancelamento (`cliente-no-periodo.ts`), como as peças
        // abaixo e o relatório: contrato que sobrou depois dele não vira 0%.
        tx`
      select c.client_id, i.content_type, i.quantity
        from ideworks.month_contracts c
        join ideworks.month_contract_items i on i.contract_id = c.id
       where c.reference_month = any(${mesesNoTexto}::date[])
         and ${clienteNoMesSql(tx, tx`c.client_id`, tx`c.reference_month`)}`,

        // F17.57 — o mês ABERTO e sem item congelado existe, e era anunciado como
        // "ainda não foi aberto". Quem abriu tem linha aqui mesmo sem cota nenhuma.
        tx`
      select distinct client_id
        from ideworks.month_contracts
       where reference_month = any(${mesesNoTexto}::date[])
         and ${clienteNoMesSql(tx, tx`month_contracts.client_id`, tx`month_contracts.reference_month`)}`,

        // O cadastro de hoje, não o congelado: é ele que separa "não contrata
        // conteúdo mensal" de "contrata, e o mês congelou vazio".
        tx`
      select distinct client_id
        from ideworks.client_quotas
       where quantity > 0`,

        // F38, Fases 4 e 5 (D6) — as peças do cliente cancelado só contam nos
        // meses até o do cancelamento, inclusive (`cliente-no-periodo.ts`): a peça
        // da cota pelo `reference_month`. Período no presente = carteira ativa;
        // período no passado = a carteira daquele mês.
        tx`
      select client_id, content_type, is_extra, (completed_at is not null) as is_completed
        from ideworks.content_items
       where reference_month = any(${mesesNoTexto}::date[])
         and ${clienteNoMesSql(tx, tx`content_items.client_id`, tx`content_items.reference_month`)}`,

        // A segunda leitura, a dos DIAS: só produção com data dentro da janela.
        // Item sem data não entra — não porque foi esquecido, mas porque não tem
        // dia para cair dentro de intervalo nenhum.
        //
        // O DIA É O DE SÃO PAULO (conferência de 09/10/2026), o mesmo do Calendário
        // e do Planejamento: a peça das 22h do último dia do mês é 01h UTC do dia
        // seguinte e, cortada em UTC, contava no mês errado só aqui.
        tx`
      select client_id,
             count(*)::int                                        as scheduled,
             count(*) filter (where completed_at is not null)::int as completed
        from ideworks.content_items
       where scheduled_at is not null
         and ${diaDaPecaSql(tx, tx`content_items.scheduled_at`)} between ${inlineDate(tx, primeiroDia)} and ${inlineDate(tx, ultimoDia)}
         and ${clienteNoMesSql(tx, tx`content_items.client_id`, diaDaPecaSql(tx, tx`content_items.scheduled_at`))}
       group by client_id`,
      ]);

    const conferencia = conferirVinculos(
      clientes.map((c) => ({
        id: c.id as string,
        name: c.name as string,
        isActive: c.is_active as boolean,
      })),
      (listasDaConferencia as unknown as Array<{
        id: string;
        name: string;
        client_id: string | null;
        archived: boolean;
        space_archived: boolean;
        space_name: string;
        task_count: number;
      }>).map(
        (r): ListaParaConferir => ({
          id: r.id,
          name: r.name,
          spaceName: r.space_name,
          clientId: r.client_id,
          archived: r.archived === true,
          spaceArchived: r.space_archived === true,
          taskCount: Number(r.task_count),
        }),
      ),
    );

    if (clientes.length === 0) return { clients: [], conferencia };

    // F38 — a situação de entrega pela Semanal, só dos ATIVOS desta mesma
    // lista (já recortada pela política e pelas omitidas). Cancelado fica nulo.
    // Fica DEPOIS da primeira leva porque precisa dos ids que ela trouxe.
    const situacaoDe = await readDeliveryStatus(
      tx,
      clientes.filter((c) => c.is_active === true).map((c) => c.id as string),
      agora,
    );

    const porCliente = <T extends { client_id: string }>(linhas: readonly T[]) => {
      const mapa = new Map<string, T[]>();
      for (const linha of linhas) {
        const lista = mapa.get(linha.client_id) ?? [];
        lista.push(linha);
        mapa.set(linha.client_id, lista);
      }
      return mapa;
    };

    const contratoDe = porCliente(
      contratos as unknown as Array<{
        client_id: string;
        content_type: string;
        quantity: number;
      }>,
    );
    const itensDe = porCliente(
      itens as unknown as Array<{
        client_id: string;
        content_type: string;
        is_extra: boolean;
        is_completed: boolean;
      }>,
    );

    const abriuOMes = new Set(
      (mesesAbertos as unknown as Array<{ client_id: string }>).map((r) => r.client_id),
    );
    const contrataConteudo = new Set(
      (cotasVigentes as unknown as Array<{ client_id: string }>).map((r) => r.client_id),
    );

    const periodoDe = new Map(
      (noPeriodo as unknown as Array<{ client_id: string; scheduled: number; completed: number }>)
        .map((r) => [r.client_id, { scheduled: r.scheduled, completed: r.completed }]),
    );

    return {
      conferencia,
      clients: clientes.map((c) => ({
        id: c.id as string,
        name: c.name as string,
        categoryId: c.category_id as string,
        categoryName: c.category_name as string,
        categorySortOrder: Number(c.category_sort_order),
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
        urgency: c.urgency as PanelClient['urgency'],
        isActive: c.is_active as boolean,
        inactiveAt: c.inactive_at === null ? null : new Date(c.inactive_at as string).toISOString(),
        financeOk: c.finance_ok as boolean,
        startedOn: comoDia(c.started_on) as string,
        renewsOn: comoDia(c.renews_on),
        tags: (c.tags as PanelTag[]) ?? [],
        inPeriod: periodoDe.get(c.id as string) ?? { scheduled: 0, completed: 0 },
        delivery: calculateDeliveryLevel(
          (contratoDe.get(c.id as string) ?? []).map((r) => ({
            contentType: r.content_type,
            quantity: Number(r.quantity),
          })),
          (itensDe.get(c.id as string) ?? []).map((r) => ({
            contentType: r.content_type,
            isExtra: r.is_extra,
            isCompleted: r.is_completed,
          })),
          {
            monthOpened: abriuOMes.has(c.id as string),
            hasContentContract: contrataConteudo.has(c.id as string),
          },
        ),
        deliveryStatus: situacaoDe.get(c.id as string) ?? null,
      })),
    };
  });
}
