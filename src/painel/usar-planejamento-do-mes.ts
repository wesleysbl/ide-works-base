/**
 * As duas leituras do mês, juntas — F43, Fase 2.
 *
 * POR QUE AS DUAS, E DE UMA VEZ
 *   A visão Contrato precisa do ritual (`GET /planning`: mês aberto, planejado,
 *   aprovado) E das semanas (`GET /planning/weeks`: responsáveis, contrato,
 *   peças) para dizer quem precisa de atenção. Pedidas juntas
 *   (`Promise.all`), as duas chegam ao mesmo tempo e a tela troca de mês uma
 *   vez só — e a visão Semanas usa a MESMA resposta: trocar de visão não
 *   relê nada nem perde o mês.
 *
 * OS DADOS LEVAM O MÊS DE QUE SÃO (a regra da F35)
 *   Ver `leituraDoMes`: os números de setembro nunca aparecem embaixo do nome
 *   de outubro, nem o erro de novembro sobre os números de outubro. A resposta
 *   de um mês que já se deixou para trás é descartada (`valida`).
 *
 * `clients` PODE NÃO VIR
 *   Uma resposta sem a lista (servidor antigo, ou a resposta genérica dos
 *   cenários de navegador) vira lista vazia, e não uma tela quebrada.
 *
 * `recarga` — depois de gravar (criar ou concluir peça), o mês é o mesmo e
 * nenhuma dependência mudou; o número força a releitura, como em
 * `useConteudosDoMes`. Os dados do mesmo mês ficam na tela enquanto isso.
 *
 * `proximaLeitura` — a releitura que se pode ESPERAR (revisão pós-F43): pedida
 * antes de aumentar `recarga`, termina quando o mês relido chega. É ela que
 * faz o `await aoMudar()` da `Semanal` do painel esperar de verdade. Ver
 * `criarEsperaDaReleitura`.
 */

import { useEffect, useState } from 'react';

import { ApiError, api, semSessao } from '@/lib/api';
import {
  type FalhaGuardada,
  type LeituraGuardada,
  criarEsperaDaReleitura,
  leituraDoMes,
} from '@/painel/visoes-do-planejamento';
import type { PlanningRow } from '@/server/planning';
import type { PlanningWeeksRow } from '@/server/planning-weeks';

export type LeiturasDoMes = { ritual: PlanningRow[]; semanas: PlanningWeeksRow[] };

/** @param mes `YYYY-MM`. */
export function usePlanejamentoDoMes(mes: string, recarga = 0) {
  const [guardada, setGuardada] = useState<LeituraGuardada<LeiturasDoMes> | null>(null);
  const [falha, setFalha] = useState<FalhaGuardada | null>(null);
  const [espera] = useState(criarEsperaDaReleitura);

  useEffect(() => {
    let valida = true;
    const geracao = espera.comecou();
    const dia = `${mes}-01`;
    Promise.all([api.planejamento(dia), api.planejamentoSemanal(dia)])
      .then(([ritual, semanas]) => {
        if (!valida) return;
        setGuardada({
          mes,
          valor: {
            ritual: (ritual.clients ?? []) as PlanningRow[],
            semanas: (semanas.clients ?? []) as PlanningWeeksRow[],
          },
        });
        setFalha(null);
        espera.chegou(geracao);
      })
      .catch((e: unknown) => {
        if (!valida) return;
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        setFalha({ mes, texto: e instanceof ApiError ? e.message : '' });
        espera.chegou(geracao);
      });
    return () => {
      valida = false;
    };
  }, [mes, recarga, espera]);

  return { ...leituraDoMes(guardada, falha, mes), proximaLeitura: espera.proxima };
}
