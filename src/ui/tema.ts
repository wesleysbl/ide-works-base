/**
 * Claro ou escuro — etapa F10d.
 *
 * TRÊS ESTADOS, E NÃO DOIS
 *   "Claro" e "escuro" são escolhas. **"Sistema"** é a ausência de escolha, e
 *   precisa existir separada: quem não escolheu quer que a tela acompanhe o
 *   aparelho — inclusive quando ele muda de tarde para noite sozinho.
 *
 *   Guardar só um par de valores obrigaria a gravar uma escolha que ninguém
 *   fez, e a tela pararia de acompanhar o sistema para sempre por causa de um
 *   clique que nunca houve.
 *
 * O QUE FICA GRAVADO É A ESCOLHA, NÃO O RESULTADO
 *   `localStorage` guarda `claro`, `escuro` ou nada. Gravar o resultado —
 *   "agora está escuro" — congelaria o valor de um momento e quebraria o modo
 *   sistema.
 *
 * POR QUE ISTO É UM MÓDULO E NÃO CÓDIGO NO COMPONENTE
 *   Porque tem regra: precedência entre escolha e sistema, leitura de um
 *   armazenamento que pode estar bloqueado, e um valor de partida que precisa
 *   valer antes de o React montar. Regra se testa; efeito colateral dentro de
 *   componente, não.
 */

export type Escolha = 'claro' | 'escuro' | 'sistema';
export type Tema = 'claro' | 'escuro';

export const CHAVE = 'ideworks:tema';

/** O que o aparelho prefere. Sem `matchMedia`, assume escuro — é a cara do OBSIDIAN. */
export function temaDoSistema(
  combina: (consulta: string) => boolean = (c) =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(c).matches
      : false,
): Tema {
  return combina('(prefers-color-scheme: light)') ? 'claro' : 'escuro';
}

/**
 * A escolha guardada.
 *
 * Valor estranho vira `sistema` em vez de estourar: o armazenamento é do
 * navegador e qualquer coisa pode estar lá — inclusive de uma versão futura.
 */
export function escolhaGuardada(ler: (k: string) => string | null): Escolha {
  const v = ler(CHAVE);
  return v === 'claro' || v === 'escuro' ? v : 'sistema';
}

/** O tema que vale, dada a escolha e o que o aparelho prefere. */
export const temaEfetivo = (escolha: Escolha, doSistema: Tema): Tema =>
  escolha === 'sistema' ? doSistema : escolha;

export const ROTULO_DA_ESCOLHA: Record<Escolha, string> = {
  escuro: 'Escuro',
  claro: 'Claro',
  sistema: 'Segue o sistema',
};
