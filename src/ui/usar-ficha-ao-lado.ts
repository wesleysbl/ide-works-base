/**
 * RELER QUANDO A FICHA AO LADO FECHA — F43, Fase 7.
 *
 * O gancho das telas que abrem o card ao lado (Quadro, Pasta, Espaço, Minhas
 * tarefas, Todas as tarefas). Cada uma passa a SUA releitura silenciosa — a
 * mesma que ela já usa depois de mover um cartão —, e o gancho a chama quando
 * a ficha que estava ao lado sai da entrada (✕, `Esc`, clique fora, Voltar).
 * O porquê está em `fichaAoLadoFechou` (`@/ui/ficha-ao-lado`).
 *
 * A releitura mais nova é a que vale: o gancho guarda a última função a cada
 * desenho, e não reinscreve nada quando ela muda de identidade.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { fichaAoLadoDe, fichaAoLadoFechou } from '@/ui/ficha-ao-lado';

export function useAoFecharAFichaAoLado(reler: () => void): void {
  const { state } = useLocation();
  const aberta = fichaAoLadoDe(state);
  const antes = useRef(aberta);
  const releitura = useRef(reler);

  useEffect(() => {
    releitura.current = reler;
  });

  useEffect(() => {
    const tinha = antes.current;
    antes.current = aberta;
    if (fichaAoLadoFechou(tinha, aberta)) releitura.current();
  }, [aberta]);
}
