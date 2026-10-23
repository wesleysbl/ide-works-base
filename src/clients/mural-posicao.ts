/**
 * Onde a nota do mural pode ficar — conferência de 08/10/2026.
 *
 * O quadro mede em pixels CSS, e `getBoundingClientRect` e o ponteiro devolvem
 * FRAÇÃO (quadro de 1043,5 px, dedo num ecrã de toque, zoom do navegador). A
 * posição grava em coluna `integer`: a fração chegava ao banco, que a recusa, e
 * mover a nota até a borda direita dava "Não foi possível mover a nota". A
 * posição sai INTEIRA daqui, e a borda arredonda para dentro (para baixo): a
 * nota nunca passa do quadro por meio pixel.
 */

export type Medidas = { width: number; height: number };

export function limitarNoQuadro(
  nota: Medidas,
  x: number,
  y: number,
  /** A largura medida do plano, e a mínima que as notas já impõem a ele. */
  larguraDoPlano: number,
  larguraMinima: number,
  alturaDoPlano: number,
): { positionX: number; positionY: number } {
  const maxX = Math.floor(Math.max(larguraDoPlano, larguraMinima) - nota.width);
  const maxY = Math.floor(alturaDoPlano - nota.height);
  return {
    // Presa dentro do quadro: coordenada negativa jogaria a nota para fora da
    // área visível, e ela sumiria sem ter sido apagada — que é o que a
    // restrição do banco também recusa.
    positionX: Math.max(0, Math.min(Math.round(x), maxX)),
    positionY: Math.max(0, Math.min(Math.round(y), maxY)),
  };
}
