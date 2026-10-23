/**
 * MENOS MOVIMENTO — acessibilidade, WCAG 2.3.3 (Animação por interação) e a
 * preferência `prefers-reduced-motion`.
 *
 * O CSS do sistema já zera `animation`, `transition` e `scroll-behavior` quando a
 * pessoa pediu menos movimento (`obsidian.css` e `acabamento.css`). Só que o
 * `behavior: 'smooth'` PASSADO NA CHAMADA de `scrollIntoView`/`scrollTo` vence o
 * `scroll-behavior` da folha — o chat e a página do cliente rolavam suave de
 * qualquer jeito. Quem rola por JavaScript pergunta aqui o que usar.
 */

/** A pessoa pediu ao sistema operacional para reduzir o movimento? */
export function pediuMenosMovimento(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** O `behavior` da rolagem: instantâneo para quem pediu menos movimento, suave para os outros. */
export function comportamentoDeRolagem(): ScrollBehavior {
  return pediuMenosMovimento() ? 'auto' : 'smooth';
}
