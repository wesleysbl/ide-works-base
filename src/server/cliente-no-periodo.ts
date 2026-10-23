/**
 * O CLIENTE CANCELADO NOS MESES DO PASSADO — F38, Fase 5 (D3 e D6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA, UMA SÓ
 *
 *   Um cliente entra no mês M se está ATIVO (`is_active`) ou se o mês do
 *   cancelamento é M ou depois. O mês do cancelamento é o mês civil de
 *   `inactive_at` no fuso de São Paulo. Cancelado em 30/12/2025 conta até
 *   dezembro de 2025, inclusive, e some a partir de janeiro de 2026.
 *
 *   Por isso um cancelado nunca muda o passado: os meses anteriores ao
 *   cancelamento continuam com ele, como eram. E um cancelado nunca suja o
 *   presente: do mês seguinte em diante ele não existe para relatório,
 *   calendário geral nem Painel.
 *
 * QUAL É O "MÊS" DE CADA COISA (quem chama escolhe, a regra não muda)
 *
 *   · contrato, mês aberto e peça na COTA: o `reference_month` da linha;
 *   · produção datada no relatório, na série mês a mês e no Painel (`inPeriod`):
 *     o mês do mesmo dia que a janela usa para contar — o DIA DE SÃO PAULO da
 *     peça (`diaDaPecaSql`). Era o dia de UTC; a conferência de 09/10/2026
 *     mudou, porque a peça marcada às 22h de Brasília no último dia do mês é
 *     01h UTC do dia seguinte e contava no mês errado só aqui, enquanto o
 *     Planejamento e o Calendário a punham no certo;
 *   · CALENDÁRIO geral: o mês do dia exibido — o da entrega em São Paulo e o
 *     `day` do compromisso. O calendário é de dias, e o compromisso nem tem
 *     mês de referência; usar o dia mostrado deixa a grade inteira de um mês
 *     com o mesmo conjunto de clientes.
 *
 * DUAS FORMAS, UM LUGAR
 *
 *   `clienteNoMesSql` é a regra dentro da consulta (calendário, Painel e o
 *   catálogo SQL dos relatórios); `clienteContaNoMes` é a mesma regra em
 *   TypeScript, para o que já chegou lido (o catálogo em memória, os meses de
 *   `get_delivery_trend` e `get_client_delivery_history`). O teste de banco
 *   (`omitidas-banco.test.ts`, PGlite) roda as duas na mesma massa, inclusive
 *   na virada do mês em São Paulo, e elas têm de concordar.
 *
 * O QUE ELA NÃO SABE
 *
 *   · Cliente REATIVADO: `is_active` volta a `true` e `inactive_at` é apagado.
 *     O banco não guarda os períodos em que ele esteve cancelado, então ele
 *     conta em todos os meses — inclusive os em que esteve fora. Guardar o
 *     histórico de cancelamentos seria outro plano.
 *   · Cancelado SEM data (`is_active = false` e `inactive_at` nulo): não conta
 *     em mês nenhum. Medido em 06/10/2026: não existe nenhum.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type postgres from 'postgres';

import { AGENCY_TIMEZONE } from '@/server/calendar';
import type { Tx } from '@/server/db';
import { inlineText } from '@/server/db-literal';

/** Fragmento montado com o mesmo `tx` da consulta que o recebe. */
type Trecho = postgres.PendingQuery<postgres.Row[]>;

/** O que o cadastro diz do cliente hoje. */
export type SituacaoNoCadastro = {
  isActive: boolean;
  /** Dia civil do cancelamento (`AAAA-MM-DD`, São Paulo). Só vale com `isActive: false`. */
  cancelledOn: string | null;
};

/**
 * A regra em TypeScript. `month` é `AAAA-MM` ou `AAAA-MM-DD` (só o mês conta).
 */
export function clienteContaNoMes(situacao: SituacaoNoCadastro, month: string): boolean {
  if (situacao.isActive) return true;
  if (situacao.cancelledOn === null) return false;
  return situacao.cancelledOn.slice(0, 7) >= month.slice(0, 7);
}

/**
 * O DIA DA PEÇA, DENTRO DA CONSULTA: o dia civil de São Paulo de um instante
 * (`scheduled_at`, `completed_at`) — uma expressão `date`.
 *
 * É o mesmo dia do Calendário (`readCalendar`), da grade semanal, da "última
 * entrega" e das leituras do MCP (`diaDoInstante`, `diaNaAgencia`). Cortar a
 * coluna em UTC (`at time zone 'UTC'`, ou o `::date` direto, que usa o fuso da
 * sessão do banco — UTC) joga a peça das 21h às 23h59 de Brasília no dia
 * seguinte e, no último dia do mês, no mês seguinte: o mesmo cliente com
 * números diferentes no Painel e no Planejamento. `test/o-dia-da-peca-e-o-de-
 * sao-paulo.test.ts` proíbe o corte em UTC nas fontes.
 */
export function diaDaPecaSql(tx: Tx, instante: Trecho): Trecho {
  return tx`(${instante} at time zone ${inlineText(tx, AGENCY_TIMEZONE)})::date`;
}

/**
 * A regra dentro da consulta: verdadeiro quando o cliente `clienteId` entra no
 * mês `mes` (uma expressão `date`; só o mês dela conta). Lê o cliente pela
 * chave, então serve tanto para consulta que já junta `clients` quanto para a
 * que não junta. O apelido `periodo` não se confunde com o `c` de quem chama.
 */
export function clienteNoMesSql(tx: Tx, clienteId: Trecho, mes: Trecho): Trecho {
  return tx`exists (
    select 1 from ideworks.clients periodo
     where periodo.id = ${clienteId}
       and (
             periodo.is_active
          or date_trunc('month', periodo.inactive_at at time zone ${inlineText(tx, AGENCY_TIMEZONE)})::date
               >= date_trunc('month', ${mes})::date
           )
  )`;
}
