/**
 * Ritual mensal — etapa F5.2.
 *
 * O CICLO TEM COMEÇO E FIM EXPLÍCITOS
 *   Três marcos por cliente por mês, e eles acontecem nesta ordem:
 *
 *     1. abrir       o contrato é congelado (F3.1). Sem isso não há o que cobrar.
 *     2. planejar    a equipe montou o mês.
 *     3. aprovar     o cliente concordou com o que foi planejado.
 *
 * A ORDEM NÃO É DECORAÇÃO
 *   Aprovação é aprovação **de um plano**. Marcar "cliente aprovou" num mês que
 *   ninguém planejou é registrar concordância com o nada — e depois ninguém
 *   consegue dizer com o quê o cliente concordou.
 *
 *   Pelo mesmo motivo, desmarcar o planejamento de um mês já aprovado é
 *   recusado: apagaria o objeto da aprovação, deixando a aprovação órfã. Quem
 *   quiser refazer o plano tira a aprovação primeiro — e isso fica registrado,
 *   que é justamente o ponto.
 */

export type RitualState = {
  monthOpened: boolean;
  planningDoneAt: string | null;
  clientApprovedAt: string | null;
};

export type RitualStep = 'planning' | 'approval';

export type RitualChange = { step: RitualStep; done: boolean };

export type RitualRefusal =
  | 'month_not_opened'
  | 'planning_required_first'
  | 'approval_must_be_undone_first';

export type RitualDecision =
  | { ok: true; note?: string }
  | { ok: false; reason: RitualRefusal; message: string };

export function decideRitualChange(
  state: RitualState,
  change: RitualChange,
): RitualDecision {
  if (!state.monthOpened) {
    return {
      ok: false,
      reason: 'month_not_opened',
      message:
        'Este mês ainda não foi aberto para o cliente. ' +
        'Abrir o mês congela o contrato — é o começo do ciclo.',
    };
  }

  if (change.step === 'approval' && change.done && state.planningDoneAt === null) {
    return {
      ok: false,
      reason: 'planning_required_first',
      message:
        'Marque o mês como planejado antes de registrar a aprovação do cliente. ' +
        'Aprovação é aprovação de um plano; sem plano, ninguém saberá depois com o ' +
        'que o cliente concordou.',
    };
  }

  if (change.step === 'planning' && !change.done && state.clientApprovedAt !== null) {
    return {
      ok: false,
      reason: 'approval_must_be_undone_first',
      message:
        'Este mês já foi aprovado pelo cliente. Retire a aprovação antes de reabrir o ' +
        'planejamento — senão a aprovação ficaria sem plano para apontar.',
    };
  }

  if (change.step === 'planning' && !change.done) {
    return {
      ok: true,
      note: 'O planejamento foi reaberto. Quem e quando fica registrado.',
    };
  }

  return { ok: true };
}

/**
 * A recusa de quem não pode marcar planejamento nem aprovação — F43, Fase 3.
 *
 * A política do banco (`contracts_update`) só deixa o administrador mudar o
 * contrato do mês. Para os outros, o `update` não falha: ele atualiza ZERO
 * linhas, em silêncio. A rota respondia `{ ok: true }` assim mesmo — a pessoa
 * via a chave ligar e nada ficava gravado. Agora a rota confere as linhas e
 * devolve esta frase (403); a tela a mostra como veio.
 */
export const RECUSA_SO_ADMIN_MARCA =
  'Só um administrador marca o planejamento e a aprovação do mês. Nada foi gravado.';

/** Em que ponto do ciclo o mês está, para a tela mostrar sem calcular. */
export function ritualStage(state: RitualState): 'fechado' | 'aberto' | 'planejado' | 'aprovado' {
  if (!state.monthOpened) return 'fechado';
  if (state.clientApprovedAt !== null) return 'aprovado';
  if (state.planningDoneAt !== null) return 'planejado';
  return 'aberto';
}

export const RITUAL_LABEL: Record<ReturnType<typeof ritualStage>, string> = {
  fechado: 'mês não aberto',
  aberto: 'aberto, falta planejar',
  planejado: 'planejado, falta aprovação',
  aprovado: 'aprovado pelo cliente',
};
