/**
 * Como um número vira texto na área Meta — etapa F9n.
 *
 * POR QUE ISTO EXISTE
 *   `dinheiro` estava escrito TRÊS vezes, idêntico, em três telas. Não é
 *   duplicação inofensiva: no dia em que alguém decidir mostrar centavos, ou
 *   trocar de moeda, ou encurtar mil para "1,2 mil", uma das três vai ficar
 *   para trás — e a tela que ficar vai discordar das outras sobre o mesmo
 *   valor.
 *
 *   O traço para valor ausente é o mesmo pelo mesmo motivo: `—` e `0` dizem
 *   coisas diferentes, e é o tipo de distinção que se perde quando cada tela
 *   escolhe a sua.
 */

/** Valor que NÃO existe. Diferente de zero, que existe e é zero. */
export const TRACO = '—';

export const dinheiro = (v: number | null | undefined) =>
  v === null || v === undefined
    ? TRACO
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// `inteiro` e `percentual` NAO moram aqui de proposito: as telas que os usam
// arredondam de formas diferentes, e unificar mudaria numero que alguem ja le.
// Compartilhar so o que e de fato igual — o resto e coincidencia de nome.
