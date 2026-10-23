/**
 * OS TRÊS SINAIS DE NÍVEL — espaço, pasta e lista. Etapa F17.25.
 *
 * POR QUE ELES SAÍRAM DE `ArvoreDoQuadro.tsx`
 *   A trilha do topo precisa desenhar EXATAMENTE o que a árvore desenha: o
 *   usuário pediu *"as imagens com o `>` indicando o caminho seguido"*, e a
 *   referência que ele mandou mostra o mesmo ícone nos dois lugares —
 *   `📁 FIORART / ✓≡ Fiorart (setup)`.
 *
 *   Copiar os desenhos daria dois pares parecidos, e eles divergiriam na
 *   primeira etapa que mexesse num só — o mesmo argumento que tirou o corpo do
 *   cartão de `pages/Quadro.tsx` na F17.18.
 *
 * ⚠️ E POR QUE NÃO IMPORTAR DIRETO DE `ArvoreDoQuadro`
 *   Aquele arquivo tem 57 KB e puxa junto a caixa de acesso, os menus de
 *   esteira e a API inteira da árvore. A ficha da tarefa não precisa de nada
 *   disso para desenhar três ícones — e passaria a carregar tudo.
 */

/* O mesmo traço da árvore: 1,7 de espessura, ponta e junta redondas. */
const traco = (c = 'h-3.5 w-3.5') => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: c,
  'aria-hidden': true,
});

/** 📁 — a pasta da referência. */
export const IconePasta = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
  </svg>
);

/**
 * ✓≡ — a folha com marcas, que é o ícone da LISTA na referência.
 *
 * Deliberadamente diferente do `IconeLista` de `menus.tsx` (três traços): ali
 * ele significa "escolher uma lista" dentro de um menu; aqui ele precisa
 * distinguir lista de PASTA na mesma coluna, e dois ícones parecidos lado a
 * lado não distinguem nada.
 */
export const IconeListaMarcada = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <path d="M3.5 6.5l1.5 1.5 2.5-2.5M3.5 12l1.5 1.5L7.5 11M3.5 17.5L5 19l2.5-2.5" />
    <path d="M11 6.5h9.5M11 12h9.5M11 17.5h9.5" />
  </svg>
);

/** A marca do espaço: quadrado com a inicial, na cor que veio do ClickUp. */
export function MarcaDoEspaco({ nome, cor }: { nome: string; cor: string | null }) {
  const inicial = (nome.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className="cu-marca-espaco"
      aria-hidden="true"
      /* As DUAS variáveis andam juntas — F17.37. A tinta escura só serve
         sobre o quadrado vivo; sem cor, quem lê o fundo `--ink-4` é a
         platina. Ver `.cu-marca-espaco` em `ui/clickup.css`. */
      style={
        cor
          ? { ['--cor-espaco' as string]: cor, ['--tinta-espaco' as string]: 'var(--ink-0)' }
          : undefined
      }
    >
      {inicial}
    </span>
  );
}

/** A TAREFA — o fim da trilha. O mesmo círculo que a ficha usa no chip de tipo. */
export const IconeTarefa = ({ c }: { c?: string }) => (
  <svg {...traco(c)}>
    <circle cx="12" cy="12" r="8" />
  </svg>
);
