/**
 * O ritual mensal visto de cima — etapa F5.3.
 *
 * A REGRA DE ORDEM É O TRABALHO QUE FALTA
 *   Esta tela existe para uma pessoa percorrer a lista marcando até acabar.
 *   Então ela ordena pelo que ainda falta fazer, não por nome: mês fechado
 *   primeiro (ninguém abriu), depois o que falta planejar, depois o que falta
 *   o cliente aprovar, e por último o que já está pronto.
 *
 *   Ordenar por nome faria a pessoa varrer a lista inteira toda vez para achar
 *   os três que sobraram.
 */

import { type RitualState, decideRitualChange, ritualStage } from '@/delivery/month-ritual';

export type LinhaDePlanejamento = RitualState & {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  plan: { id: string; name: string; colorBg: string; colorText: string; colorBorder: string } | null;
};

export type EstagioDoRitual = ReturnType<typeof ritualStage>;

const PESO: Record<EstagioDoRitual, number> = {
  fechado: 0,
  aberto: 1,
  planejado: 2,
  aprovado: 3,
};

export function ordenarPorRitual(
  linhas: readonly LinhaDePlanejamento[],
): LinhaDePlanejamento[] {
  return [...linhas].sort((a, b) => {
    const pa = PESO[ritualStage(a)];
    const pb = PESO[ritualStage(b)];
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

export type ResumoDoRitual = {
  total: number;
  fechado: number;
  aberto: number;
  planejado: number;
  aprovado: number;
  /** Quantos ainda não estão prontos — o número que a tela existe para zerar. */
  faltam: number;
};

/**
 * Quantos clientes em cada etapa do mês. Pede só o estado do ritual: a visão
 * Contrato (F43, Fase 4) conta as linhas dela, que têm o ritual mas não a
 * categoria nem o plano do `GET /planning`.
 */
export function resumirRitual(linhas: readonly RitualState[]): ResumoDoRitual {
  const r: ResumoDoRitual = {
    total: linhas.length,
    fechado: 0,
    aberto: 0,
    planejado: 0,
    aprovado: 0,
    faltam: 0,
  };

  for (const linha of linhas) {
    const estagio = ritualStage(linha);
    r[estagio] += 1;
    if (estagio !== 'aprovado') r.faltam += 1;
  }
  return r;
}

/* ─────────────────────── estado e próxima ação — F12 ───────────────────────
   A lista dizia o estado ("aberto, falta planejar") e oferecia as duas chaves
   em toda linha — inclusive "Cliente aprovou" num mês que ninguém planejou,
   que o servidor recusava depois do clique. Agora cada linha diz o PRÓXIMO
   passo, e a chave de aprovação só aparece quando a regra do ritual a aceita.

   A regra é a de `decideRitualChange` — a MESMA função que o servidor usa, e
   não uma cópia: se a ordem do ritual mudar lá, a tela muda junto. */


export type ProximoPasso = {
  acao: 'abrir' | 'planejar' | 'aprovar' | 'nenhuma';
  /** A frase curta da linha. */
  texto: string;
};

export function proximoPasso(linha: LinhaDePlanejamento): ProximoPasso {
  switch (ritualStage(linha)) {
    case 'fechado':
      return { acao: 'abrir', texto: 'Abrir o mês para congelar o contrato' };
    case 'aberto':
      return { acao: 'planejar', texto: 'Montar o plano e marcar Planejamento OK' };
    case 'planejado':
      return { acao: 'aprovar', texto: 'Registrar a aprovação do cliente' };
    default:
      return { acao: 'nenhuma', texto: 'Mês fechado com o cliente' };
  }
}

/**
 * A chave "Cliente aprovou" aparece? Só com o mês aberto e, antes da
 * aprovação, só quando a regra deixa aprovar (planejamento marcado). Depois
 * de aprovado ela fica — é por ela que se retira a aprovação.
 */
export function ofereceAprovacao(linha: LinhaDePlanejamento): boolean {
  if (!linha.monthOpened) return false;
  if (linha.clientApprovedAt !== null) return true;
  return decideRitualChange(linha, { step: 'approval', done: true }).ok;
}

/**
 * Por que a chave "Planejamento OK" está travada — ou `null` se ela pode
 * mudar. Com o mês aprovado, desmarcar o planejamento é recusado; a frase é a
 * da regra, e a tela a mostra antes do clique em vez de depois.
 */
export function travaDoPlanejamento(linha: LinhaDePlanejamento): string | null {
  if (!linha.monthOpened) return null;
  const mudanca = { step: 'planning' as const, done: linha.planningDoneAt === null };
  const d = decideRitualChange(linha, mudanca);
  return d.ok ? null : d.message;
}
