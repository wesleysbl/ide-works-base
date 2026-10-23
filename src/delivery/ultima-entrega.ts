/**
 * Situação de entrega pela Semanal — F38, Fase 1.
 *
 * POR QUE ESTA REGRA EXISTE
 *   Em 06/10/2026 um relatório de "última entrega por cliente" disse que a
 *   Fonseca Moura não recebia nada desde 03/09. A Semanal dela mostrava arte
 *   entregue em 02/10 e em 05/10. O relatório tinha contado tarefas concluídas
 *   do quadro — e a entrega de conteúdo é controlada na Semanal: peças do mês,
 *   com dia marcado e ✓.
 *
 *   Esta é a regra ÚNICA. O Painel, o MCP e os testes perguntam aqui. Uma
 *   segunda cópia, em SQL ou em outra tela, seria a mesma dívida do medidor do
 *   legado (duas fórmulas, dois números) reencenada.
 *
 * AS DEFINIÇÕES (seção 1 do plano F38)
 *   Entrega       peça com ✓ cujo dia marcado é hoje ou anterior. Extra conta.
 *   Última        o dia marcado mais recente entre as entregas — NÃO a data em
 *                 que alguém clicou no ✓. A agência entrega no dia marcado.
 *   Vencida       peça sem ✓ com dia marcado anterior a hoje.
 *   Vence hoje    peça sem ✓ com dia marcado hoje. Não é vencida.
 *   Sem dia       peça sem dia marcado. Não entra em data nenhuma, só na conta
 *                 — mesmo com ✓: sem dia, não há "quando" para dizer.
 *   Próxima       o dia marcado futuro mais próximo, com ✓ ou sem.
 *
 * PEÇA ADIANTADA NÃO É ENTREGA
 *   Peça marcada para sexta e já com ✓ na terça: a regra é pelo dia marcado,
 *   então ela só vira entrega quando a sexta chegar. Até lá é a próxima marcada.
 *   Contar antes faria a "última entrega" apontar para o futuro.
 *
 * O DIA É O DE SÃO PAULO
 *   `scheduled_at` é um instante. Uma peça das 23h de ontem, em São Paulo, já é
 *   2h de hoje em UTC — e cortar o dia em UTC a jogaria para hoje. O dia de
 *   cada peça e o "hoje" saem do mesmo relógio: `hojeNaAgencia`, o da agenda.
 *
 * QUEM DECIDE O ALCANCE É QUEM CHAMA
 *   A regra conta o que recebe. "Sem dia do mês corrente" é recorte da
 *   leitura (`server/delivery-status.ts`), não daqui: a regra não sabe de mês,
 *   só de dia. Vencida não tem recorte nenhum desde 06/10 — toda peça sem ✓
 *   com dia passado, de cliente ativo, chega até aqui.
 */

import { parseDay } from '@/board/board';
import { diasDesdeEpoca } from '@/board/calendario';
import { hojeNaAgencia } from '@/ui/grade-do-mes';

/** Uma peça da Semanal, só com o que a regra precisa. */
export type WeeklyPiece = {
  /** O instante marcado. Nulo = peça sem dia. */
  scheduledAt: string | Date | null;
  /** Tem ✓. */
  isCompleted: boolean;
  /**
   * Extra conta como entrega igual a qualquer outra. O campo existe para quem
   * chama poder passar a peça como ela é — a regra não o lê, de propósito.
   */
  isExtra?: boolean;
};

export type DeliveryStatus = {
  /** O "hoje" usado na conta, `AAAA-MM-DD` em São Paulo. */
  today: string;
  /** Dia marcado da entrega mais recente. Nulo = sem entrega registrada. */
  lastDeliveryOn: string | null;
  /** Dias entre a última entrega e hoje. Nulo junto com `lastDeliveryOn`. */
  daysSinceLastDelivery: number | null;
  /** O dia de cada peça vencida, do mais antigo ao mais novo (repete se houver duas no dia). */
  overdue: string[];
  /** Peças sem ✓ marcadas para hoje. */
  dueToday: number;
  /** Peças sem dia marcado, com ✓ ou sem. */
  unscheduled: number;
  /** O dia marcado futuro mais próximo. Nulo = nada marcado para frente. */
  nextScheduledOn: string | null;
};

/** O dia, em São Paulo, de um instante marcado. */
export function diaNaAgencia(instante: string | Date): string {
  const d = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(d.getTime())) throw new Error(`Dia marcado inválido: "${String(instante)}".`);
  return hojeNaAgencia(d);
}

function diasEntre(de: string, ate: string): number {
  const a = parseDay(de);
  const b = parseDay(ate);
  if (a === null || b === null) throw new Error(`Dia inválido: "${de}" ou "${ate}".`);
  return diasDesdeEpoca(b) - diasDesdeEpoca(a);
}

/**
 * A situação de entrega de UM cliente.
 *
 * @param pieces as peças da Semanal desse cliente que interessam à conta
 * @param agora o instante de referência; o "hoje" é tirado dele, em São Paulo
 */
export function deliveryStatusOf(pieces: readonly WeeklyPiece[], agora: Date = new Date()): DeliveryStatus {
  const today = hojeNaAgencia(agora);

  let lastDeliveryOn: string | null = null;
  let nextScheduledOn: string | null = null;
  const overdue: string[] = [];
  let dueToday = 0;
  let unscheduled = 0;

  for (const piece of pieces) {
    if (piece.scheduledAt === null) {
      unscheduled += 1;
      continue;
    }
    const dia = diaNaAgencia(piece.scheduledAt);

    if (dia > today) {
      // Futura — com ✓ (adiantada) ou sem. Nunca é entrega ainda.
      if (nextScheduledOn === null || dia < nextScheduledOn) nextScheduledOn = dia;
      continue;
    }

    if (piece.isCompleted) {
      if (lastDeliveryOn === null || dia > lastDeliveryOn) lastDeliveryOn = dia;
    } else if (dia === today) {
      dueToday += 1;
    } else {
      overdue.push(dia);
    }
  }

  overdue.sort();

  return {
    today,
    lastDeliveryOn,
    daysSinceLastDelivery: lastDeliveryOn === null ? null : diasEntre(lastDeliveryOn, today),
    overdue,
    dueToday,
    unscheduled,
    nextScheduledOn,
  };
}
