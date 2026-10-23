/**
 * O seletor de métricas — F10j.
 *
 * Separado do gancho `useMetricas` de propósito: um arquivo que exporta
 * componente E função perde o recarregamento rápido do Vite, e quem paga é
 * quem está mexendo na tela — a página inteira recarrega a cada letra.
 */

import { type Metrica } from '@/meta/metricas';
import { Gaveta } from '@/ui/Gaveta';

export function SeletorDeMetricas({
  catalogo,
  escolhidas,
  aoAlternar,
  aoLimpar,
}: {
  catalogo: Metrica[];
  escolhidas: string[];
  aoAlternar: (chave: string) => void;
  aoLimpar: () => void;
}) {
  return (
    <Gaveta
      rotulo="Métricas"
      // O grupo entra no rótulo para a busca alcançá-lo: digitar "custo" traz
      // todas as colunas de custo de uma vez.
      itens={catalogo.map((m) => ({
        valor: m.chave,
        rotulo: `${m.rotulo}  ·  ${m.grupo.toLowerCase()}`,
      }))}
      escolhidos={escolhidas}
      aoAlternar={aoAlternar}
      aoLimpar={aoLimpar}
      larguraDoBalao="w-96"
    />
  );
}
