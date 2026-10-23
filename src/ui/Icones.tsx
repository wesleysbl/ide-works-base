/**
 * Ícones — etapa F4.3.
 *
 * Desenhados à mão, em traço, e não importados de uma biblioteca. Motivo
 * prático: o cockpit usa quinze ícones, e trazer um pacote inteiro para isso
 * custa mais peso de download do que o painel inteiro pesa hoje.
 *
 * Todos herdam `currentColor` e o tamanho do texto ao redor, então mudam de
 * cor junto com o estado do botão sem uma linha de código a mais.
 */

type Props = { className?: string };

const base = (className?: string) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: className ?? 'h-4 w-4',
  'aria-hidden': true,
});

export const IconeBusca = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

export const IconeClipe = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.19a3.67 3.67 0 0 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 0 1-2.59-2.6l8.5-8.49" />
  </svg>
);

export const IconeCalendario = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const IconeFoguete = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M5 15c-1.5 1.5-2 6-2 6s4.5-.5 6-2" />
    <path d="M13.5 4.5C16 2 20 2 22 2c0 2 0 6-2.5 8.5L14 16l-6-6 5.5-5.5z" />
    <circle cx="16" cy="8" r="1.4" />
  </svg>
);

export const IconeSair = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" />
    <path d="M10 17l-5-5 5-5M5 12h11" />
  </svg>
);

export const IconeVideo = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="2" y="6" width="13" height="12" rx="2" />
    <path d="M15 10l7-4v12l-7-4" />
  </svg>
);

export const IconeArte = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M21 16l-5-5-9 9" />
  </svg>
);

export const IconeFoto = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 8a2 2 0 012-2h2.5L9 4h6l1.5 2H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </svg>
);

export const IconeAds = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 10v4a1 1 0 001 1h3l5 4V5L7 9H4a1 1 0 00-1 1z" />
    <path d="M17 9a4 4 0 010 6" />
  </svg>
);

export const IconePaz = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
  </svg>
);

export const IconeAlerta = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M12 4l9 16H3l9-16z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
);

export const IconePerigo = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5v.01" />
  </svg>
);

export const IconeEsquerda = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const IconeDireita = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);

/** O X — o MESMO traço do `IconeFechar` de `@/board/menus`, para o X da ficha
 *  (F17.78) e o do modal do quadro serem o mesmo desenho. Mora aqui também
 *  porque `@/ui` não importa de `@/board` para buscar ícone. */
export const IconeFechar = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconeEtiqueta = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 12V4h8l10 10-8 8L3 12z" />
    <circle cx="7.5" cy="7.5" r="1.3" />
  </svg>
);

export const IconeDinheiro = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.8 3 2 3 .8 3 2-1.3 2-3 2c-1.3 0-2.4-.5-3-1.5M12 6.5v11" />
  </svg>
);

export const IconeMais = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconePessoas = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <path d="M16 5.2a3.2 3.2 0 010 5.6M18 14.8c2 .8 3 2.7 3 5.2" />
  </svg>
);

export const IconeLapis = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M4 20h4L20 8a2.8 2.8 0 00-4-4L4 16v4z" />
    <path d="M14.5 5.5l4 4" />
  </svg>
);

/** Olho aberto e olho riscado — o par do botão que mostra a senha digitada. */
export const IconeOlho = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconeOlhoRiscado = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M10.6 5.1A10.6 10.6 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-2.9 3.9M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a10 10 0 005.4-1.6" />
    <path d="M9.9 9.9a3 3 0 004.2 4.2M3 3l18 18" />
  </svg>
);

export const IconeArquivo = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4" />
  </svg>
);


/** Lixeira — o único gesto irreversível do sistema, e por isso desenhado à parte. */
export const IconeLixeira = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
    <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

/** Casa — o `Início` no topo da barra lateral (F28), no lugar da marca repetida. */
export const IconeCasa = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" />
  </svg>
);

/** « — recolher a barra lateral em ícones (F29). Duas setas, e não uma: uma só
 *  é o `‹` de voltar, e este botão não volta para lugar nenhum. */
export const IconeRecolher = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
  </svg>
);

/** » — expandir a barra lateral de volta aos rótulos (F29). O espelho de `IconeRecolher`. */
export const IconeExpandir = ({ className }: Props) => (
  <svg {...base(className)}>
    <path d="M13 7l5 5-5 5M6 7l5 5-5 5" />
  </svg>
);

/** Meio círculo cheio — o `Tema` do menu da conta (F29). Um só desenho para os
 *  dois sentidos: o rótulo ao lado é que diz para qual tema o clique leva. */
export const IconeTema = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" />
  </svg>
);

/** Um relógio — `Já bateu seu ponto hoje?`, o item do menu da conta que leva
 *  ao Ponto Ide (F30). */
export const IconeRelogio = ({ className }: Props) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/** Três faixas: barra, coluna e conteúdo — o botão que solta a árvore numa
 *  coluna própria ao lado da barra, e que a devolve (F29). */
export const IconeColuna = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 4v16M13 4v16" />
  </svg>
);

/** Galhos: um nó em cima e dois pendurados — `Compartilhado comigo`, a árvore
 *  de espaços, pastas e listas, quando a barra está em ícones (F29). */
export const IconeArvore = ({ className }: Props) => (
  <svg {...base(className)}>
    <rect x="3" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="10" width="7" height="4.5" rx="1" />
    <rect x="14" y="16.5" width="7" height="4.5" rx="1" />
    <path d="M6.5 8v10.75H14M6.5 12.25H14" />
  </svg>
);

/**
 * › — a seta dos títulos de seção e do chip da conta (F29). Aponta para a
 * direita; quem a gira é a folha, lendo o `aria-expanded` do botão.
 *
 * ⚠️ NÃO É O `IconeDireita`, e a diferença é a espessura. Ela é desenhada a
 * 0,75rem, e o traço de 1,7 numa caixa de 24 vira 0,85px na tela — a seta
 * voltaria a ler como um ponto, que é o defeito que ela veio consertar (o `▸`
 * da Fase 1). Traço mais grosso, e o desenho ocupando a caixa inteira.
 */
export const IconeChevron = ({ className }: Props) => (
  <svg {...base(className)} strokeWidth={2.6}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);
