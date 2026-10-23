/**
 * O teclado das abas — F03 do plano UX. Separado de `AlternadorDeVista.tsx`
 * para ser função pura (testável sem navegador) e para o Fast Refresh, que só
 * aceita componentes num arquivo `.tsx`.
 */

import { useId } from 'react';

/* ───────────────────────────── teclado ───────────────────────────── */

/**
 * Para onde a tecla leva, numa fila de `total` abas a partir de `atual`.
 * `null` = a tecla não é de navegação (Tab, letras, Enter…), e o evento segue.
 * As setas dão a volta nas pontas, como na APG.
 */
export function indiceDaTecla(tecla: string, atual: number, total: number): number | null {
  if (total <= 0) return null;
  switch (tecla) {
    case 'ArrowRight':
      return (atual + 1) % total;
    case 'ArrowLeft':
      return (atual - 1 + total) % total;
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
}

/** O `id` de uma aba — é por ele que o painel diz quem o nomeia. */
export const idDaAba = (base: string, valor: string) => `${base}-aba-${valor}`;

/** Um `base` estável e seguro para `id` (o `useId` do React traz `:`). */
export function useIdDasAbas(prefixo: string): string {
  return `${prefixo}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
