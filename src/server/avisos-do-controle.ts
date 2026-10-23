/**
 * F40, Fase 8 — o aviso do Controle da semana, calculado na leitura.
 *
 * UM aviso-resumo por admin e por semana (e não um por cliente: com todo
 * cliente em falta eram 47 linhas de uma vez). Pura em `avisosDoControle`:
 * recebe o que `readControleDaSemana` devolveu e devolve o aviso, sem banco e
 * sem relógio. Não refaz a regra de "faltando" nem de "atrasado" — a regra mora
 * na leitura da semana (Fase 5), e a caixa só a repete em números.
 *
 * A CHAVE DO "JÁ VI" CARREGA OS NÚMEROS (como o aviso de prazo carrega a data):
 *   controle:<segunda>:falta:<clientes em falta>:atrasado:<clientes atrasados>
 * Se um número muda, a chave é outra e o aviso volta como não visto; tudo
 * zerado não gera aviso, então some sem linha para limpar. `notice_reads`
 * guarda texto livre de até 200 caracteres, sem chave estrangeira.
 *
 * O CÁLCULO FICA GUARDADO 5 MINUTOS por isolado (`avisosDoControleGuardados`):
 * o sino roda em toda tela e a leitura da semana leva ~1,4 s. A aba
 * /controle-da-semana e o MCP não passam por aqui: leem ao vivo.
 */

import type { Aviso } from '@/board/avisos';
import { type ControleDaSemana, readControleDaSemana } from '@/server/controle-da-semana';
import type { Sql } from '@/server/db';
import { idsOmitidos } from '@/server/omitidas';
import { diaDeSaoPaulo } from '@/server/semana-do-controle';
import type { AuthenticatedActor } from '@/server/session';

/** Um aviso ainda sem o `seen`, que vem do registro de leitura. */
export type AvisoDoControle = Omit<Aviso, 'seen'>;

export function avisosDoControle(c: ControleDaSemana): AvisoDoControle[] {
  const semana = c.week.start;
  const emFalta = new Set(c.missing.items.filter((i) => i.missing > 0).map((i) => i.clientId)).size;
  const atrasados = new Set(c.missing.overdue.map((o) => o.clientId)).size;
  if (emFalta === 0 && atrasados === 0) return [];
  return [
    {
      key: `controle:${semana}:falta:${emFalta}:atrasado:${atrasados}`,
      tipo: 'controle',
      taskId: '',
      taskTitle: 'Controle da semana',
      listId: null,
      listName: null,
      clientName: null,
      clientId: null,
      occurredAt: null,
      dueOn: null,
      automationName: null,
      fromListName: null,
      toListName: null,
      toStatusName: null,
      weekStart: semana,
      clientesEmFalta: emFalta,
      clientesAtrasados: atrasados,
    },
  ];
}

/** Quanto o cálculo vale no isolado: 5 minutos. */
export const VALIDADE_DO_AVISO_DO_CONTROLE_MS = 5 * 60_000;

/**
 * Memória do isolado, como `omitidas.ts` (resolução e empresa do alvo): o
 * projeto não usa Cache API nem KV para isto. A CHAVE é o dia de São Paulo (que
 * decide a semana) + as empresas omitidas do ator + QUEM é o ator.
 *
 * ⚠️ A PESSOA ENTRA NA CHAVE, E "SÓ ADMIN CHEGA AQUI" NÃO BASTA. Administrar
 * não é ver tudo (F17.32): só o topo enxerga a carteira inteira; cada
 * administrador vê os clientes das empresas de que participa, e a leitura da
 * semana roda sob as políticas DELE. Com a chave só do dia, o primeiro a abrir
 * a caixa fixava os números do sino de todos os outros por 5 minutos — "3
 * clientes em falta" de uma empresa aparecia para quem nem a enxerga.
 */
const guardados = new Map<string, { avisos: AvisoDoControle[]; vence: number }>();

/** Só para a suíte: cada teste começa sem nada guardado. */
export function esquecerAvisosDoControle(): void {
  guardados.clear();
}

export async function avisosDoControleGuardados(
  sql: Sql,
  actor: AuthenticatedActor,
  agora: number = Date.now(),
): Promise<AvisoDoControle[]> {
  const chave = `${diaDeSaoPaulo(new Date(agora))}|${actor.userId}|${[...idsOmitidos(actor)].sort().join(',')}`;
  const guardado = guardados.get(chave);
  if (guardado && guardado.vence > agora) return guardado.avisos;
  const avisos = avisosDoControle(await readControleDaSemana(sql, actor, null, new Date(agora)));
  guardados.set(chave, { avisos, vence: agora + VALIDADE_DO_AVISO_DO_CONTROLE_MS });
  return avisos;
}
