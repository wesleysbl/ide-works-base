/**
 * Planejamento do mês, para todos os clientes — etapa F5.3.
 *
 * POR QUE UMA LEITURA PRÓPRIA, E NÃO UM CAMPO A MAIS NO PAINEL
 *   São perguntas diferentes. O painel responde "quem está no vermelho"; esta
 *   tela responde "de quem ainda falta fechar o mês". Quem opera o ritual
 *   mensal percorre a lista inteira de uma vez, marcando — e não quer os
 *   medidores, os filtros nem os cartões no caminho.
 *
 *   Além disso o painel já fala em INTERVALO desde a F4.11, e o ritual é
 *   estritamente mensal: o contrato do mês é que se planeja e se aprova.
 *
 * SÓ CLIENTE ATIVO
 *   Planejar o mês de quem saiu não significa nada, e a lista com os inativos
 *   junto faria o contador de "faltam N" nunca chegar a zero.
 */

import { type Sql, inlineDate, inlineUuidList, withActor } from '@/server/db';
import { recorteDasOmitidas } from '@/server/omitidas';
import { firstDayOfMonth } from '@/server/panel';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export type PlanningRow = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  plan: { id: string; name: string; colorBg: string; colorText: string; colorBorder: string } | null;
  /** Falso quando o mês nem foi aberto — e aí não há o que planejar ainda. */
  monthOpened: boolean;
  planningDoneAt: string | null;
  clientApprovedAt: string | null;
};

export async function readPlanning(
  sql: Sql,
  actor: AuthenticatedActor,
  month: string,
): Promise<PlanningRow[]> {
  const referenceMonth = firstDayOfMonth(month);

  return withActor(sql, asDbActor(actor), async (tx) => {
    // Junção à esquerda com o contrato: cliente sem mês aberto PRECISA aparecer,
    // porque "ninguém abriu agosto para este cliente" é justamente o que esta
    // tela existe para mostrar. Uma junção interna o esconderia.
    const linhas = await tx`
      select c.id, c.name, c.category_id, cat.name as category_name,
             p.id as plan_id, p.name as plan_name,
             p.color_bg, p.color_text, p.color_border,
             mc.id is not null as month_opened,
             mc.planning_done_at, mc.client_approved_at
        from ideworks.clients c
        join ideworks.client_categories cat on cat.id = c.category_id
        left join ideworks.plans p on p.id = c.plan_id
        left join ideworks.month_contracts mc
               on mc.client_id = c.id and mc.reference_month = ${inlineDate(tx, referenceMonth)}
       where c.is_active
         -- F31: cliente de empresa omitida fora do planejamento.
         ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.category_id <> all(${inlineUuidList(tx, ids)}::uuid[])`)}
       order by c.name`;

    return linhas.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      categoryId: r.category_id as string,
      categoryName: r.category_name as string,
      plan:
        r.plan_id === null
          ? null
          : {
              id: r.plan_id as string,
              name: r.plan_name as string,
              colorBg: r.color_bg as string,
              colorText: r.color_text as string,
              colorBorder: r.color_border as string,
            },
      monthOpened: r.month_opened as boolean,
      planningDoneAt: r.planning_done_at
        ? new Date(r.planning_done_at as string).toISOString()
        : null,
      clientApprovedAt: r.client_approved_at
        ? new Date(r.client_approved_at as string).toISOString()
        : null,
    }));
  });
}
