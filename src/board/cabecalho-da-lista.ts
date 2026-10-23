/**
 * A regra da descrição recolhível do quadro — F06A do plano UX. Pura, fora do
 * `.tsx` do cabeçalho (`CabecalhoDaLista`) para o Fast Refresh.
 */

/**
 * Quando a descrição passa a ser recolhida. Uma linha curta cabe inteira na
 * largura do quadro (≈ 120 caracteres a 13 px em 1440); com quebra de linha
 * escrita pela equipe, ela já não é uma linha.
 */
export const DESCRICAO_CURTA = 120;

export function descricaoLonga(texto: string): boolean {
  return texto.length > DESCRICAO_CURTA || texto.includes('\n');
}
