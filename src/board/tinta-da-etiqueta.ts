/**
 * A TINTA DA ETIQUETA, LEGÍVEL SOBRE O FUNDO DELA — acessibilidade, WCAG 1.4.3.
 *
 * AS DUAS CORES VÊM DA ORIGEM, E NEM SEMPRE FUNCIONAM JUNTAS
 *   Uma etiqueta chega do ClickUp com `bg_color` e `fg_color` (ver `quadro.css`:
 *   "foram escolhidas para funcionar juntas"). Medido no navegador, não
 *   funcionam: a etiqueta `arte`, `#a18072` com `#fff`, dá 3,6:1 — e há muitas
 *   assim, porque o ClickUp põe branco em qualquer fundo médio. A etiqueta é
 *   letra de 10 a 12px num cartão que se lê o dia inteiro.
 *
 * A REGRA: A DA ORIGEM VALE QUANDO PASSA
 *   Se o par da origem chega a 4,5:1, ele fica como veio — a cor é dado, decisão
 *   D10 do plano. Só quando não chega a tinta é trocada pela que o fundo pede:
 *   branco ou preto, o que der mais contraste. O fundo
 *   (a cor da etiqueta) nunca muda.
 *
 * ONDE VALE
 *   Só onde o fundo da etiqueta é o dela, opaco (o cartão do quadro e o botão da
 *   ficha). A etiqueta do modal de nova tarefa pinta o fundo a 30% sobre a
 *   superfície, e ali a tinta do tema (`--plat`) é a certa — ver `ModalDeTarefa`.
 */

/** O contraste mínimo da WCAG 2.x para texto normal. */
export const CONTRASTE_MINIMO_DA_ETIQUETA = 4.5;

const BRANCO = '#ffffff';
const PRETO = '#000000';

type Rgb = readonly [number, number, number];

/** `#rgb` ou `#rrggbb` (e `#rrggbbaa`, de que só as seis primeiras contam). Outra coisa, `null`. */
function lerCor(valor: string | null | undefined): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec((valor ?? '').trim());
  if (m === null) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1].slice(0, 6);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const canal = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminancia = ([r, g, b]: Rgb) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);

/** A razão de contraste da WCAG entre duas cores. */
export function razaoDeContraste(a: Rgb, b: Rgb): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/**
 * A tinta para `tinta` (a da origem, ou `null`) sobre `fundo`. Devolve a da
 * origem se ela passa; senão branco ou preto, o que ler melhor (e com os dois puros nenhum
 * fundo fica abaixo de 4,58:1 — com um preto levantado, o cinza médio ficava em
 * 4,4); e, sem fundo
 * legível, a tinta como veio (o CSS cai no par do sistema).
 */
export function tintaDaEtiqueta(fundo: string | null | undefined, tinta: string | null | undefined): string | null {
  const f = lerCor(fundo);
  if (f === null) return tinta ?? null;
  const t = lerCor(tinta);
  if (t !== null && razaoDeContraste(t, f) >= CONTRASTE_MINIMO_DA_ETIQUETA) return tinta ?? null;
  const branco = lerCor(BRANCO) as Rgb;
  const preto = lerCor(PRETO) as Rgb;
  return razaoDeContraste(branco, f) >= razaoDeContraste(preto, f) ? BRANCO : PRETO;
}

/** O par de variáveis que o CSS lê (`--cor-etiqueta-fundo` e `--cor-etiqueta-tinta`). */
export function varsDaEtiqueta(
  fundo: string | null | undefined,
  tinta: string | null | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fundo) vars['--cor-etiqueta-fundo'] = fundo;
  const t = tintaDaEtiqueta(fundo, tinta);
  if (t) vars['--cor-etiqueta-tinta'] = t;
  return vars;
}
