/**
 * O estado de uma demanda diante do prazo — etapa F4.8.
 *
 * POR QUE ISTO NÃO É UM `if` DENTRO DA TELA
 *   "Atrasada" é a única informação que o Checklist realmente vende, e ela é
 *   fácil de errar de dois jeitos:
 *
 *   1. Comparando INSTANTE com DIA. Prazo é um dia inteiro, não um horário: às
 *      22h do dia do prazo a tarefa **não** está atrasada. Uma conta baseada em
 *      `Date.now()` contra meia-noite diz que está.
 *
 *   2. Chamando de atrasada uma tarefa **já concluída**. Ela foi entregue; o
 *      prazo virou história. Pintar de vermelho o que já foi feito ensina a
 *      equipe a ignorar o vermelho.
 *
 * ITEM SEM PRAZO NÃO ESTÁ ATRASADO
 *   No legado `prazo` é obrigatório, então quem não tinha prazo ganhava uma
 *   data inventada — e data inventada vence. Aqui a ausência de prazo é um
 *   estado, e ele nunca é vermelho.
 */

import { hojeNaAgencia } from '@/ui/grade-do-mes';

export type Demanda = {
  id: string;
  title: string;
  description: string | null;
  dueOn: string | null;
  completedAt: string | null;
  completedBy: { id: string; name: string } | null;
  archivedAt: string | null;
  assignees: Array<{ id: string; name: string }>;
  createdAt: string;
};

export type EstadoDaDemanda = 'concluida' | 'atrasada' | 'hoje' | 'em_dia' | 'sem_prazo';

export const ROTULO_DO_ESTADO: Record<EstadoDaDemanda, string> = {
  concluida: 'Concluída',
  atrasada: 'Atrasada',
  hoje: 'Vence hoje',
  em_dia: 'Em dia',
  sem_prazo: 'Sem prazo',
};

/**
 * O dia de hoje NO FUSO DA AGÊNCIA, como `YYYY-MM-DD`.
 *
 * Era o dia UTC: em Brasília, a partir das 21h o "hoje" já era o dia seguinte, e
 * o Checklist chamava de "Atrasada" o que vence hoje — enquanto o quadro e o
 * calendário, que medem pelo dia de São Paulo, ainda diziam "hoje". O prazo
 * (`due_on`) é uma data de calendário, sem hora; só o "que dia é hoje" depende
 * do fuso, e ele é o mesmo relógio de `hojeNaAgencia`.
 */
const hojeEmDia = (agora: Date) => hojeNaAgencia(agora);

export function estadoDaDemanda(d: Demanda, agora = new Date()): EstadoDaDemanda {
  // Concluída vence qualquer outra leitura, inclusive prazo estourado.
  if (d.completedAt !== null) return 'concluida';
  if (d.dueOn === null) return 'sem_prazo';

  const hoje = hojeEmDia(agora);
  if (d.dueOn < hoje) return 'atrasada';
  if (d.dueOn === hoje) return 'hoje';
  return 'em_dia';
}

/** Dias até o prazo. Negativo = venceu. Nulo quando não há prazo. */
export function diasAteOPrazo(dueOn: string | null, agora = new Date()): number | null {
  if (dueOn === null) return null;
  const alvo = Date.UTC(
    Number(dueOn.slice(0, 4)),
    Number(dueOn.slice(5, 7)) - 1,
    Number(dueOn.slice(8, 10)),
  );
  const hoje = hojeEmDia(agora);
  const base = Date.UTC(
    Number(hoje.slice(0, 4)),
    Number(hoje.slice(5, 7)) - 1,
    Number(hoje.slice(8, 10)),
  );
  return Math.round((alvo - base) / 86_400_000);
}

/**
 * A ordem do Checklist: o que cobra atenção primeiro.
 *
 *   atrasadas → vence hoje → em dia → sem prazo → concluídas
 *
 * Dentro de cada grupo, prazo mais próximo primeiro; sem prazo, a mais antiga
 * primeiro, porque tarefa esquecida tende a ser a mais velha.
 */
const PESO: Record<EstadoDaDemanda, number> = {
  atrasada: 0,
  hoje: 1,
  em_dia: 2,
  sem_prazo: 3,
  concluida: 4,
};

export function ordenarDemandas(demandas: readonly Demanda[], agora = new Date()): Demanda[] {
  return [...demandas].sort((a, b) => {
    const pa = PESO[estadoDaDemanda(a, agora)];
    const pb = PESO[estadoDaDemanda(b, agora)];
    if (pa !== pb) return pa - pb;

    if (a.dueOn !== null && b.dueOn !== null && a.dueOn !== b.dueOn) {
      return a.dueOn < b.dueOn ? -1 : 1;
    }
    if (a.dueOn !== null && b.dueOn === null) return -1;
    if (a.dueOn === null && b.dueOn !== null) return 1;

    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

export type ResumoDeDemandas = {
  pendentes: number;
  atrasadas: number;
  vencemHoje: number;
  concluidas: number;
};

export function resumirDemandas(
  demandas: readonly Demanda[],
  agora = new Date(),
): ResumoDeDemandas {
  const r: ResumoDeDemandas = { pendentes: 0, atrasadas: 0, vencemHoje: 0, concluidas: 0 };
  for (const d of demandas) {
    const estado = estadoDaDemanda(d, agora);
    if (estado === 'concluida') {
      r.concluidas += 1;
      continue;
    }
    r.pendentes += 1;
    if (estado === 'atrasada') r.atrasadas += 1;
    if (estado === 'hoje') r.vencemHoje += 1;
  }
  return r;
}

/**
 * Os três grupos do Checklist — F11C do plano UX.
 *
 *   pendentes → concluídas → arquivadas
 *
 * Com "Ver arquivadas" ligado a API devolve as arquivadas JUNTO das outras, e
 * a lista única as misturava pela ordem do prazo: uma arquivada atrasada subia
 * acima do que ainda cobra atenção. Arquivada é um grupo à parte, sempre por
 * último, qualquer que seja o estado dela; e o resumo do topo conta só o que
 * não está arquivado (senão ligar "Ver arquivadas" mudava os números).
 *
 * Cada grupo guarda a ordem de `ordenarDemandas`. Nenhuma demanda some nem
 * aparece duas vezes: a soma dos três é a lista de entrada.
 */
export type DemandasAgrupadas = {
  pendentes: Demanda[];
  concluidas: Demanda[];
  arquivadas: Demanda[];
};

export function agruparDemandas(demandas: readonly Demanda[], agora = new Date()): DemandasAgrupadas {
  const grupos: DemandasAgrupadas = { pendentes: [], concluidas: [], arquivadas: [] };
  for (const d of ordenarDemandas(demandas, agora)) {
    if (d.archivedAt !== null) grupos.arquivadas.push(d);
    else if (d.completedAt !== null) grupos.concluidas.push(d);
    else grupos.pendentes.push(d);
  }
  return grupos;
}
