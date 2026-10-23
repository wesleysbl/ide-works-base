/**
 * O ESTADO DA FICHA QUE O `<html>` PRECISA SABER — perf-front, 08/10/2026.
 *
 * O QUE ERA
 *   `tarefa.css` reservava espaço no alto da página da ficha (`scroll-padding-
 *   top`, no `html`, que é quem rola) com duas regras ancoradas na raiz:
 *
 *       html:has(.t-cabeca)                                              { 4rem }
 *       html:has(.t-cabeca ~ .cu-ficha > .cu-trilha[data-por-salvar]…)   { 7,5rem }
 *
 *   `:has()` com a RAIZ como alvo é uma pergunta sobre o documento inteiro: a
 *   cada inserção ou remoção de nó em QUALQUER lugar da página (abrir o painel
 *   de um cartão, um menu, uma notificação), o Chrome precisa revalidar a
 *   resposta, e o que ele faz é recalcular o estilo de todos os elementos.
 *   Medido no Quadro com 500 cartões (14,9 mil nós, 29,8 mil elementos com os
 *   pseudo-elementos): UMA passada de 312 ms (Chrome em Linux, CPU sem
 *   estrangulamento) em cada abrir e em cada fechar do painel do cartão — nas
 *   telas que NEM TÊM a ficha em página cheia. Tirar só uma das duas regras não
 *   muda nada: qualquer uma sozinha dispara o mesmo custo.
 *
 * O QUE É AGORA
 *   O mesmo efeito, dito por atributo no `<html>`, que não custa nada:
 *
 *       :root[data-ficha-em-pagina]                                   { 4rem }
 *       :root[data-ficha-em-pagina][data-ficha-por-salvar='true']     { 7,5rem }
 *
 *   - `data-ficha-em-pagina`: ligado enquanto a página `/tarefa/:id` está
 *     montada — a única tela que tem `.t-cabeca`;
 *   - `data-ficha-por-salvar`: espelho do `data-por-salvar` da linha de controle
 *     da ficha. A ficha do painel também o escreve, mas a regra só vale junto
 *     com `data-ficha-em-pagina`, como a de antes só valia com `.t-cabeca`.
 */

const RAIZ = () => (typeof document === 'undefined' ? null : document.documentElement);

/** Liga `data-ficha-em-pagina` e devolve quem o desliga (o retorno de um efeito). */
export function marcarFichaEmPagina(): () => void {
  const raiz = RAIZ();
  if (raiz === null) return () => {};
  raiz.dataset.fichaEmPagina = 'true';
  return () => {
    delete raiz.dataset.fichaEmPagina;
    delete raiz.dataset.fichaPorSalvar;
  };
}

/** Espelha "há texto por salvar" no `<html>` e devolve quem o desliga. */
export function marcarPorSalvar(porSalvar: boolean): () => void {
  const raiz = RAIZ();
  if (raiz === null) return () => {};
  if (porSalvar) raiz.dataset.fichaPorSalvar = 'true';
  else delete raiz.dataset.fichaPorSalvar;
  return () => {
    delete raiz.dataset.fichaPorSalvar;
  };
}
