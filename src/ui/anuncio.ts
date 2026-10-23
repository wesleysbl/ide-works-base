/**
 * ANUNCIAR COM MODERAÇÃO — F03 do plano UX (§6: "mensagens de estado devem ser
 * anunciadas com moderação").
 *
 * Uma busca que filtra a cada letra muda o "12 encontradas" a cada tecla. Se
 * esse texto mora numa região viva, o leitor de tela lê "12 encontradas, 7
 * encontradas, 3 encontradas…" por cima do que a pessoa digita. O olho quer o
 * número na hora; o ouvido quer só o último, quando a digitação assenta.
 *
 * Este gancho devolve o texto ATRASADO: ele só muda depois de `espera` ms sem
 * mudança. A tela mostra o texto vivo e põe na região `role="status"` o
 * texto moderado.
 */

import { useEffect, useState } from 'react';

export function useAnuncioModerado(texto: string, espera = 700): string {
  const [dito, setDito] = useState(texto);
  useEffect(() => {
    if (texto === dito) return;
    const relogio = setTimeout(() => setDito(texto), espera);
    return () => clearTimeout(relogio);
  }, [texto, dito, espera]);
  return dito;
}
