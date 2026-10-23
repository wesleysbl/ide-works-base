/**
 * Como a área Meta diz o CONTEXTO de um número — F14 do plano UX.
 *
 * Nada aqui calcula métrica: a conta mora em `@/meta/relatorio`, `@/meta/ranking`
 * e `@/meta/objetivos`, que têm teste próprio. Este módulo responde às
 * perguntas que vêm antes de ler o número — "de que período?", "quantos dias
 * têm dado?", "o período veio do endereço ou é o padrão?" — e as escreve do
 * mesmo jeito nas três telas.
 *
 * O PERÍODO MORA NO ENDEREÇO
 *   Antes ele vivia no estado da tela: recarregar, voltar do navegador ou
 *   mandar o link a alguém devolvia os últimos 28 dias, e o número que a
 *   pessoa estava olhando sumia sem aviso. Agora `?de=&ate=` é o período; sem
 *   eles, vale a janela padrão da coleta.
 */

import { diasDoIntervalo } from '@/meta/relatorio';
import { hojeNaAgencia } from '@/ui/grade-do-mes';

export type Periodo = { de: string; ate: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Os últimos 28 dias até HOJE EM SÃO PAULO — a janela que a coleta mantém.
 *
 * ⚠️ Era o hoje de UTC (conferência de 08/10): das 21h à meia-noite a janela
 * terminava AMANHÃ, enquanto o seletor de período já mede no fuso da agência —
 * o relatório e o ranking abriam num período que o seletor não reconhecia.
 */
export function janelaPadrao(hoje = new Date()): Periodo {
  const ate = new Date(`${hojeNaAgencia(hoje)}T12:00:00Z`);
  const de = new Date(ate);
  de.setUTCDate(de.getUTCDate() - 27);
  return { de: de.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10) };
}

/**
 * O período pedido no endereço, ou `null` se não há um VÁLIDO.
 *
 * Data malformada ou intervalo invertido não viram erro de tela: viram a
 * janela padrão, e o endereço deixa de mandar. Um link velho ou digitado à mão
 * não pode quebrar a leitura.
 */
export function periodoDoEndereco(params: URLSearchParams): Periodo | null {
  const de = params.get('de');
  const ate = params.get('ate');
  if (de === null || ate === null || !DATA.test(de) || !DATA.test(ate) || de > ate) return null;
  if (Number.isNaN(Date.parse(`${de}T00:00:00Z`)) || Number.isNaN(Date.parse(`${ate}T00:00:00Z`))) return null;
  return { de, ate };
}

/** "1 dia", "28 dias" — o plural escrito, e não "dia(s)". */
export const dias = (n: number) => `${n.toLocaleString('pt-BR')} ${n === 1 ? 'dia' : 'dias'}`;

/** Quantos dias o período tem, contando as duas pontas. */
export const tamanhoDoPeriodo = (p: Periodo) => diasDoIntervalo(p.de, p.ate).length;

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dma = (iso: string) => `${dm(iso)}/${iso.slice(0, 4)}`;

/**
 * "02/09 – 29/09/2026"; com anos diferentes, os dois anos aparecem. É a mesma
 * escrita em contexto, relatório e ranking — antes eram três.
 */
export function rotuloDoPeriodo(p: Periodo): string {
  if (p.de === p.ate) return dma(p.de);
  return p.de.slice(0, 4) === p.ate.slice(0, 4) ? `${dm(p.de)} – ${dma(p.ate)}` : `${dma(p.de)} – ${dma(p.ate)}`;
}

/**
 * Quantos dias do período TÊM dado. É fato, não diagnóstico: um dia sem linha
 * pode ser coleta que não veio ou campanha que não rodou — a tela diz o número
 * e não adivinha o motivo.
 */
export function coberturaDoPeriodo(
  linhas: readonly { day: string }[],
  p: Periodo,
): { comDado: number; total: number } {
  const doPeriodo = new Set(diasDoIntervalo(p.de, p.ate));
  const comDado = new Set(linhas.map((l) => l.day).filter((d) => doPeriodo.has(d))).size;
  return { comDado, total: doPeriodo.size };
}

/** Data e hora curtas de um carimbo ISO, no fuso de quem olha. */
export function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
