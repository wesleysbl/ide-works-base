/**
 * O foco das janelas — etapa F17.33.
 *
 * Mora fora de `@/ui/janela` por uma regra do `eslint`: um arquivo que exporta
 * componentes não deve exportar mais nada, senão o recarregamento rápido do Vite
 * perde o fio. A REGRA da etapa — o que ganha `X`, o que ganha `Esc`, o que
 * ganha clique fora, e o que havia antes — está no cabeçalho de `@/ui/janela`.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * O foco que faz o `Esc` da janela existir.
 *
 * O ouvinte de `Escape` de cada janela mora no elemento dela — é assim desde a
 * F17.10, e é o que permite a uma janela de dentro tratar a tecla e parar a
 * propagação antes de a de fora vê-la. Só que ouvinte em elemento só ouve o que
 * passa por ele, e a tecla passa por onde está o FOCO.
 *
 * ⚠️ O ELEMENTO PRECISA DE `tabIndex={-1}`. Sem ele, `.focus()` num `<div>`
 * falha calado — foi exatamente o que aconteceu com o `?` da F17.24, e está
 * escrito lá no cabeçalho de `Balao`.
 *
 * ⚠️ E O FOCO DE DENTRO GANHA. Uma janela que abre com um campo em `autoFocus`
 * já pôs o foco onde ele serve; roubá-lo para o `<div>` de fora trocaria um
 * `Esc` funcionando por um cursor perdido — e a tecla chega à janela de
 * qualquer jeito, porque o campo está dentro dela.
 */
export function useFocoDaJanela<T extends HTMLElement>() {
  const alvo = useRef<T>(null);

  useEffect(() => {
    const n = alvo.current;
    if (n === null) return;
    if (typeof document !== 'undefined' && n.contains(document.activeElement)) return;
    n.focus();
  }, []);

  return alvo;
}

/**
 * O foco VOLTA para quem abriu a janela ao fechá-la — F13 do plano UX.
 *
 * Quem abre "Redefinir" numa lista de vinte pessoas e fecha a janela precisa
 * continuar na linha de onde saiu; sem isto o foco cai no `<body>` e o próximo
 * `Tab` recomeça do topo da página.
 *
 * ⚠️ O ELEMENTO É LIDO NO PRIMEIRO DESENHO, e não num efeito: quando o efeito
 * roda, um campo em `autoFocus` de dentro da janela já tomou o foco, e o
 * "quem abriu" seria o próprio campo. Se ele não estiver mais na página ao
 * fechar (a lista recarregou e a linha sumiu), nada acontece.
 *
 * `Janela`, `PainelLateral` e `Balao` o usam. Na `Janela` é o padrão desde a revisão
 * de acessibilidade: antes ele era opcional e as janelas antigas deixavam o foco no
 * `<body>` ao fechar (a de "Marcar no dia", a de "Sair sem salvar?").
 */
export function useDevolverFoco(ativo: boolean | HTMLElement | null) {
  // Um elemento dado vale mais que o foco de agora: quando a janela abre
  // depois de um pedido, o botão que a pediu estava travado (`disabled`) e o
  // foco já tinha caído no `<body>`.
  const [origem] = useState<HTMLElement | null>(() => {
    // Sem DOM (a suíte desenha no servidor) não há foco a devolver.
    if (typeof document === 'undefined' || ativo === false || ativo === null) return null;
    if (ativo !== true) return ativo;
    return document.activeElement instanceof HTMLElement ? document.activeElement : null;
  });
  useEffect(() => {
    if (origem === null) return;
    return () => {
      if (origem.isConnected && origem !== document.body) {
        // Depois do desenho, e só se o foco ficou sem dono: no `StrictMode`
        // (dev) o React desmonta e remonta a janela de mentira logo ao abrir, e
        // um `focus()` incondicional roubaria o foco da janela ainda aberta — o
        // `Esc` morria.
        const tentar = (restantes: number) => {
          const decisao = decidirDevolucaoDoFoco({
            conectado: origem.isConnected,
            focoSemDono: document.activeElement === null || document.activeElement === document.body,
            desabilitado: origem instanceof HTMLButtonElement && origem.disabled,
            restantes,
          });
          if (decisao === 'devolver') origem.focus();
          // O botão que abriu a janela fica travado enquanto a gravação
          // termina (o chip da ficha, durante o PATCH): `focus()` num botão
          // `disabled` falha calado e o foco ficava no `<body>`. Espera um
          // pouco, e desiste — quem escolhe, no meio disso, outro lugar para o
          // foco não é desfeito (`focoSemDono`).
          else if (decisao === 'esperar') window.setTimeout(() => tentar(restantes - 1), ESPERA_DO_BOTAO_TRAVADO);
        };
        requestAnimationFrame(() => tentar(TENTATIVAS_COM_O_BOTAO_TRAVADO));
      }
    };
  }, [origem]);
}

/** De quanto em quanto tempo se vê se o botão destravou. */
const ESPERA_DO_BOTAO_TRAVADO = 100;
/** Quantas vezes: 15 × 100 ms — mais que uma gravação normal, menos que uma queda de rede. */
const TENTATIVAS_COM_O_BOTAO_TRAVADO = 15;

/**
 * O que fazer com o foco quando a janela, o menu ou o painel fecha. Pura — a
 * regra mora aqui para se provar sem navegador.
 *   `devolver` — o foco ficou sem dono e o botão aceita foco;
 *   `esperar`  — o foco ficou sem dono, mas o botão está travado (e ainda há
 *                tentativas): volta daqui a pouco;
 *   `deixar`   — alguém já tem o foco, ou o botão saiu da página: não mexe.
 */
export function decidirDevolucaoDoFoco(e: {
  conectado: boolean;
  focoSemDono: boolean;
  desabilitado: boolean;
  restantes: number;
}): 'devolver' | 'esperar' | 'deixar' {
  if (!e.conectado || !e.focoSemDono) return 'deixar';
  if (e.desabilitado) return e.restantes > 0 ? 'esperar' : 'deixar';
  return 'devolver';
}

/* ───────────────────────────── o Tab preso — F43, Fase 3 ─────────────────────────────

   O PAINEL LATERAL É MODAL, E O TAB TEM DE SABER DISSO
     A `Janela` abre no meio da tela e quase nada fica alcançável atrás dela
     com o mouse — mas pelo teclado a página inteira continuava lá: o `Tab`
     saía do último botão e caía na tabela de trás, coberta pelo véu, onde a
     pessoa não vê o que está focado. O painel lateral (`@/ui/PainelLateral`)
     declara `aria-modal`; o `Tab` precisa cumprir o que ele declara.

   SÓ AS PONTAS
     No meio do painel quem anda é o navegador, como sempre. A regra só age
     quando o `Tab` sairia da caixa: do último volta ao primeiro, e o
     `Shift+Tab` do primeiro (ou da própria caixa, que recebe o foco ao abrir)
     vai ao último. */

/** O que o `Tab` alcança — sem os desligados e sem `tabindex="-1"`. */
const SELETOR_ALCANCAVEL = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Para onde o `Tab` vai quando ele SAIRIA da caixa — ou `null` para deixar o
 * navegador andar. Puro: `atual` é a posição do foco entre os `total`
 * alcançáveis (`-1` quando o foco está na própria caixa).
 */
export function voltaDoTab(atual: number, total: number, paraTras: boolean): number | null {
  if (total === 0) return null;
  if (paraTras) return atual <= 0 ? total - 1 : null;
  return atual >= total - 1 ? 0 : null;
}

/**
 * O `onKeyDown` do `Tab` preso em `caixa`. Só age quando o alvo da tecla mora
 * na própria caixa e não numa janela aberta DENTRO dela (a `MarcarNoDia` do
 * painel, ou um balão em portal, cujo evento sobe pela árvore do React): a de
 * dentro é quem cuida do próprio teclado.
 */
/** O que o `Tab` alcança DENTRO da caixa — fora das janelas abertas nela. */
export function alcancaveisDe(caixa: HTMLElement): HTMLElement[] {
  return [...caixa.querySelectorAll<HTMLElement>(SELETOR_ALCANCAVEL)].filter(
    (el) => el.closest('[role="dialog"]') === caixa && el.getClientRects().length > 0,
  );
}

export function prenderOTab(
  e: { key: string; shiftKey: boolean; target: EventTarget; preventDefault: () => void },
  caixa: HTMLElement | null,
): void {
  if (e.key !== 'Tab' || caixa === null) return;
  const alvo = e.target as Element | null;
  if (alvo === null || !caixa.contains(alvo)) return;
  if (alvo !== caixa && alvo.closest('[role="dialog"]') !== caixa) return;
  const alcancaveis = alcancaveisDe(caixa);
  const destino = voltaDoTab(alcancaveis.indexOf(alvo as HTMLElement), alcancaveis.length, e.shiftKey);
  if (destino === null) {
    // Nada alcançável: o foco fica na caixa, e não escapa para trás do véu.
    if (alcancaveis.length === 0) e.preventDefault();
    return;
  }
  e.preventDefault();
  alcancaveis[destino].focus();
}
