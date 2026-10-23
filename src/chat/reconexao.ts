/**
 * Espera crescente e sorteada da reconexão — F20.5.
 *
 * Depois de um deploy, ~25 abas não devem bater na central no mesmo segundo.
 * A base dobra a cada tentativa (teto 30 s); o sorteio espalha dentro da
 * metade superior do intervalo.
 */

export const RECONEXAO_TETO_MS = 30_000;
export const RECONEXAO_BASE_MS = 500;

/**
 * `tentativa` começa em 0. `sorte` ∈ [0, 1) — injetável nos testes.
 */
export function esperaDeReconexao(
  tentativa: number,
  sorte: number = Math.random(),
): number {
  const n = Math.max(0, Math.floor(tentativa));
  const s = Number.isFinite(sorte) ? Math.min(1, Math.max(0, sorte)) : 0;
  const teto = Math.min(RECONEXAO_TETO_MS, RECONEXAO_BASE_MS * 2 ** Math.min(n, 6));
  // Metade fixa + metade sorteada: nunca zero, nunca todas iguais.
  return Math.floor(teto * (0.5 + s * 0.5));
}
