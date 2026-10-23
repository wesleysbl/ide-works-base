/**
 * A SEMANA DO PAINEL DE CONTROLE DOS ADMINS — F40, Fase 5 (a regra, sem banco).
 *
 * SEMANA
 *   Segunda a domingo, no fuso de São Paulo, identificada pela data da
 *   segunda (`YYYY-MM-DD`). Card com prazo no domingo é da semana que termina.
 *   O prazo (`due_on`) já é uma DATA de calendário, sem hora: não há fuso a
 *   converter nele. O fuso só entra para saber "que dia é hoje" aqui.
 *
 * META DA SEMANA — SEM SEGUNDA REGRA
 *   A repartição é a do Planejamento (F35): a cota do mês vai para as semanas
 *   do mês (`semanasDoMes`) pelos dias úteis, resto pelo maior resíduo
 *   (`dividirMeta`). Uma semana segunda–domingo que coincide com uma semana do
 *   Planejamento tem EXATAMENTE a meta da célula dela. Onde a célula do
 *   Planejamento atravessa a borda da semana (ponta curta absorvida pelo
 *   vizinho, virada de mês), a meta da célula se reparte entre os DIAS dela
 *   (de novo `dividirMeta`, um dia por "semana") e a semana leva os dias que
 *   são dela. A semana que cruza setembro e outubro soma a parte de cada mês,
 *   cada uma com a cota do SEU mês. A soma de todos os dias do mês é a cota.
 *   A busca da cota (contrato do mês → cadastro → nenhuma) é a do Planejamento
 *   (`resolvePlanningQuota`) e mora na leitura.
 */

import { type Semana, semanasDoMes } from '@/delivery/semanas';
import { dividirMeta } from '@/painel/planejamento-semanal';
import { AGENCY_TIMEZONE } from '@/server/calendar';

/** Só estes três têm meta pela cota (ads e "outros" não). */
export const TIPOS_COM_META = ['video', 'arte', 'foto'] as const;
export type TipoComMeta = (typeof TIPOS_COM_META)[number];

export type CotaPorTipo = Partial<Record<TipoComMeta, number>>;

const UM_DIA = 86_400_000;

const noMeioDia = (dia: string) => new Date(`${dia}T12:00:00Z`);
const comoDia = (d: Date) => d.toISOString().slice(0, 10);

/** `YYYY-MM-DD` que existe no calendário? (`2026-02-30` não.) */
export function ehDiaValido(dia: unknown): dia is string {
  if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const d = noMeioDia(dia);
  return !Number.isNaN(d.getTime()) && comoDia(d) === dia;
}

/** A segunda-feira da semana que contém o dia. */
export function segundaDaSemana(dia: string): string {
  const d = noMeioDia(dia);
  const desdeSegunda = (d.getUTCDay() + 6) % 7; // segunda = 0 … domingo = 6
  return comoDia(new Date(d.getTime() - desdeSegunda * UM_DIA));
}

/** O dia de calendário de um instante, em São Paulo. */
export function diaDeSaoPaulo(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AGENCY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** A segunda da semana em que o instante cai, no fuso de São Paulo. */
export function semanaDoInstante(instante: Date): string {
  return segundaDaSemana(diaDeSaoPaulo(instante));
}

/** Os sete dias, segunda a domingo. */
export function diasDaSemana(segunda: string): string[] {
  const base = noMeioDia(segunda).getTime();
  return Array.from({ length: 7 }, (_, i) => comoDia(new Date(base + i * UM_DIA)));
}

export function domingoDaSemana(segunda: string): string {
  return diasDaSemana(segunda)[6];
}

/** Segunda da semana vizinha (`+1` seguinte, `-1` anterior). */
export function semanaVizinha(segunda: string, passo: number): string {
  return comoDia(new Date(noMeioDia(segunda).getTime() + passo * 7 * UM_DIA));
}

/** Os meses (`YYYY-MM-01`) que a semana toca — um ou dois. */
export function mesesDaSemana(segunda: string): string[] {
  return [...new Set(diasDaSemana(segunda).map((d) => `${d.slice(0, 7)}-01`))];
}

/**
 * A meta da semana de UM cliente, por tipo. `cotaDoMes` devolve a cota do mês
 * (`YYYY-MM-01`) já resolvida (contrato → cadastro → nenhuma). Tipo sem cota
 * não aparece no resultado.
 */
export function metaDaSemana(
  segunda: string,
  cotaDoMes: (mes: string) => CotaPorTipo,
): Partial<Record<TipoComMeta, number>> {
  const semana = new Set(diasDaSemana(segunda));
  const soma: Partial<Record<TipoComMeta, number>> = {};
  for (const mes of mesesDaSemana(segunda)) {
    const cota = cotaDoMes(mes);
    // As semanas do Planejamento deste mês: a MESMA divisão que a aba Semana usa.
    const celulas = semanasDoMes(mes);
    for (const tipo of TIPOS_COM_META) {
      const total = cota[tipo] ?? 0;
      if (total <= 0) continue;
      const metas = dividirMeta(total, celulas);
      celulas.forEach((celula, i) => {
        if (metas[i] <= 0) return;
        const dias = diasEntre(celula.de, celula.ate);
        // Toda a célula dentro da semana (o caso comum): a meta dela, inteira.
        if (dias.every((d) => semana.has(d))) {
          soma[tipo] = (soma[tipo] ?? 0) + metas[i];
          return;
        }
        // Célula que atravessa a borda da semana (ponta absorvida, virada de
        // mês): a meta dela se reparte entre os DIAS dela, pelo mesmo critério.
        const unidades: Semana[] = dias.map((dia, n) => ({ numero: n + 1, de: dia, ate: dia, dias: 1 }));
        const porDia = dividirMeta(metas[i], unidades);
        dias.forEach((dia, n) => {
          if (semana.has(dia)) soma[tipo] = (soma[tipo] ?? 0) + porDia[n];
        });
      });
    }
  }
  for (const tipo of TIPOS_COM_META) if (!soma[tipo]) delete soma[tipo];
  return soma;
}

function diasEntre(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let d = noMeioDia(de); comoDia(d) <= ate; d = new Date(d.getTime() + UM_DIA)) dias.push(comoDia(d));
  return dias;
}
