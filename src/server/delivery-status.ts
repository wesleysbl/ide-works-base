/**
 * Leitura da situação de entrega pela Semanal — F38, Fase 1.
 *
 * A REGRA NÃO MORA AQUI
 *   Esta leitura só traz as peças do banco e entrega a `deliveryStatusOf`
 *   (`delivery/ultima-entrega.ts`). Nenhuma data é decidida em SQL além do
 *   necessário para não trazer a tabela inteira — e o que o SQL corta é
 *   escolhido para dar o MESMO resultado que a regra daria sobre tudo.
 *
 * O QUE SE BUSCA, E POR QUÊ (três consultas para a carteira inteira)
 *   1. A última entrega de cada cliente, AGREGADA no banco (`distinct on`):
 *      a peça com ✓ de dia marcado mais recente, até hoje. Uma linha por
 *      cliente, por mais antiga que seja — a Cartão +Vitta entregou em agosto,
 *      e um recorte de meses a mostraria como "sem entrega". Ela entra na
 *      regra como uma peça entre as outras; como a regra fica com o maior dia,
 *      passar só a maior dá o mesmo que passar todas.
 *   2. As peças em aberto ou futuras: TODA peça sem ✓ com dia marcado até
 *      hoje (vencida ou que vence hoje), por mais antiga que seja, e todas as
 *      de dia futuro (com ✓ ou sem — a adiantada é a próxima marcada).
 *      ⚠️ SEM CORTE DE MESES — decisão do Wesley em 06/10 (F38, Fase 2). A
 *      Fase 1 olhava só dois meses para trás, e a Pró-Forma tinha uma peça
 *      vencida de 01/08 que sumia da conta: pendência que ninguém marcou
 *      continua sendo pendência. O volume é o das peças SEM ✓ com dia, que é
 *      pequeno e só cresce se ninguém marcar nada — e aí é o número que se
 *      quer ver. Cliente cancelado não entra (ver "O ALCANCE"), então a peça
 *      esquecida de quem saiu não pesa aqui.
 *   3. As peças sem dia do mês corrente (mês de referência, em São Paulo).
 *      Vêm como linhas e não como contagem porque é a regra quem conta — uma
 *      contagem pronta seria uma segunda definição de "sem dia". São poucas:
 *      só um mês, só as sem data.
 *
 *   O dia é cortado em São Paulo nos dois lados: no SQL pelo `at time zone`, e
 *   na regra por `hojeNaAgencia`. O "hoje" vai do código para o SQL como
 *   parâmetro, para os dois não discordarem na virada da meia-noite.
 *
 * O ALCANCE É O DO PAINEL
 *   Quem chama passa os ids dos clientes ATIVOS que já leu sob a política de
 *   quem pede (e com as empresas omitidas fora). A política de
 *   `content_items` (`can_see_client`) recorta de novo — mas a lista de ids
 *   é que garante que cancelado não entra: cliente inativo não chega aqui.
 *   Desde a F38, Fase 4, cada consulta também exige `is_active` do cliente da
 *   peça (`soAtivos`) — a regra deixa de depender só de quem chama.
 */

import { AGENCY_TIMEZONE } from '@/server/calendar';
import type { Tx } from '@/server/db';
import { inlineDate, inlineText, inlineUuidList } from '@/server/db-literal';
import { type DeliveryStatus, type WeeklyPiece, deliveryStatusOf } from '@/delivery/ultima-entrega';
import { hojeNaAgencia } from '@/ui/grade-do-mes';

/**
 * F38, Fase 4 — a peça só entra se o cliente dela está ATIVO, na própria
 * consulta. Quem chama já passa só ids de ativos (Painel e
 * `get_delivery_status`); este trecho faz a regra valer mesmo que um dia
 * alguém passe um id de cancelado. O apelido `ativo` é de propósito: não
 * se confunde com o `c` das consultas de cliente.
 */
const soAtivos = (tx: Tx) =>
  tx`exists (select 1 from ideworks.clients ativo where ativo.id = i.client_id and ativo.is_active)`;

type LinhaDePeca = {
  client_id: string;
  scheduled_at: Date | string | null;
  is_completed: boolean;
};

/**
 * As peças da Semanal que a regra precisa, por cliente — as três consultas de
 * cima. Exportada para a leitura `get_delivery_status` das integrações (F38,
 * Fase 3) buscar EXATAMENTE as mesmas peças e passá-las à mesma regra: a IA e
 * o Painel não podem discordar por uma consulta diferente.
 *
 * Cliente sem peça nenhuma não aparece no mapa — quem chama decide que isso é
 * "sem entrega registrada".
 */
export async function readWeeklyPieces(
  tx: Tx,
  clientIds: readonly string[],
  agora: Date = new Date(),
): Promise<Map<string, WeeklyPiece[]>> {
  const pecasDe = new Map<string, WeeklyPiece[]>();
  if (clientIds.length === 0) return pecasDe;

  // As três consultas só dependem dos ids, do dia e do fuso — que vão no TEXTO
  // (`inlineUuidList`, `inlineDate`, `inlineText`; fora do formato seguem como
  // parâmetro) — e saem juntas na mesma ida. Eram três consultas em fila, cada
  // uma com três parâmetros: seis idas com `prepare: false`, contra uma.
  const ids = inlineUuidList(tx, clientIds);
  const hoje = inlineDate(tx, hojeNaAgencia(agora));
  const fuso = inlineText(tx, AGENCY_TIMEZONE);

  const [ultimas, abertasOuFuturas, semDia] = await Promise.all([
    tx`
    select distinct on (i.client_id)
           i.client_id, i.scheduled_at, true as is_completed
      from ideworks.content_items i
     where i.client_id = any(${ids}::uuid[])
       and ${soAtivos(tx)}
       and i.completed_at is not null
       and i.scheduled_at is not null
       and (i.scheduled_at at time zone ${fuso})::date <= ${hoje}::date
     order by i.client_id, i.scheduled_at desc`,

    tx`
    select i.client_id, i.scheduled_at, (i.completed_at is not null) as is_completed
      from ideworks.content_items i
     where i.client_id = any(${ids}::uuid[])
       and ${soAtivos(tx)}
       and i.scheduled_at is not null
       and (
             i.completed_at is null
          or (i.scheduled_at at time zone ${fuso})::date > ${hoje}::date
           )`,

    tx`
    select i.client_id, null::timestamptz as scheduled_at, (i.completed_at is not null) as is_completed
      from ideworks.content_items i
     where i.client_id = any(${ids}::uuid[])
       and ${soAtivos(tx)}
       and i.scheduled_at is null
       and i.reference_month = date_trunc('month', ${hoje}::date)::date`,
  ]);

  for (const linhas of [ultimas, abertasOuFuturas, semDia]) {
    for (const l of linhas as unknown as LinhaDePeca[]) {
      const lista = pecasDe.get(String(l.client_id)) ?? [];
      lista.push({ scheduledAt: l.scheduled_at, isCompleted: l.is_completed === true });
      pecasDe.set(String(l.client_id), lista);
    }
  }
  return pecasDe;
}

/**
 * A situação de entrega de cada cliente da lista, pela mesma regra.
 *
 * Todo id da lista volta no mapa — cliente sem peça nenhuma volta com
 * "sem entrega registrada", nunca some.
 */
export async function readDeliveryStatus(
  tx: Tx,
  clientIds: readonly string[],
  agora: Date = new Date(),
): Promise<Map<string, DeliveryStatus>> {
  const resultado = new Map<string, DeliveryStatus>();
  if (clientIds.length === 0) return resultado;

  const pecasDe = await readWeeklyPieces(tx, clientIds, agora);
  for (const id of clientIds) resultado.set(id, deliveryStatusOf(pecasDe.get(id) ?? [], agora));
  return resultado;
}
