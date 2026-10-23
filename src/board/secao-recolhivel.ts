/**
 * A seção da árvore recolhe pelo título, como as outras — F29.
 *
 * ⚠️ POR QUE UM CONTEXTO, E NÃO UMA PROPRIEDADE DE `ArvoreDoQuadro`
 *   O título da árvore ("Compartilhado comigo", com o `+` de Novo espaço ao
 *   lado) é desenhado DENTRO de `ArvoreDoQuadro`, e em três telas (quadro,
 *   pasta, espaço) a árvore chega à barra PRONTA, montada pela página — ver o
 *   cabeçalho de `BarraLateral`. Uma propriedade nova obrigaria as três
 *   páginas a saber da preferência da barra, e a próxima tela que montasse a
 *   árvore esqueceria. Com o contexto, quem sabe é a barra, que é a dona da
 *   pergunta; a árvore só escuta.
 *
 *   Fora da barra (a suíte de desenho da árvore, qualquer uso futuro) não há
 *   contexto, e a árvore desenha como sempre: título simples, tudo à vista.
 *   É o mesmo desenho de `ContextoDeMencoes`, em `@/board/mencoes`.
 */

import { createContext, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';

import { usePreferencias } from '@/ui/aparencia';
import {
  type Aparencia,
  type ContextoDoShell,
  alternarAparencia,
  arvoreNaColuna,
  composicaoEfetiva,
} from '@/ui/preferencias';
import type { Preferencias } from '@/ui/preferencias';
import { podeVer, useSessao } from '@/ui/sessao';

export type SecaoRecolhivel = {
  /** Os itens estão guardados agora? */
  recolhida: boolean;
  /** O clique no título. */
  alternar: () => void;
  /** O `id` da caixa dos itens — é para onde o `aria-controls` do título aponta. */
  idDosItens: string;
};

/**
 * Nulo = fora da barra, barra em `Somente ícones` (lá não há título onde
 * clicar), ou árvore na coluna própria — F29: a coluna existe para MOSTRAR a
 * árvore, e uma coluna de altura inteira com os itens guardados seria uma
 * faixa de 16.5rem de nada. Lá o título é só título.
 */
export const ContextoDaSecaoDaArvore = createContext<SecaoRecolhivel | null>(null);

/**
 * O botão que solta a árvore numa coluna própria, e que a devolve — F29.
 *
 * Contexto pelo mesmo motivo do de cima: o título é desenhado DENTRO de
 * `ArvoreDoQuadro`, e o Quadro, a Pasta e o Espaço entregam a árvore pronta.
 * Quem sabe onde ela está é a barra; a árvore só desenha o botão.
 */
export type ColunaDaArvore = {
  /** A árvore está na coluna agora? É o `aria-pressed` do botão. */
  ligada: boolean;
  /** O clique no botão. */
  alternar: () => void;
  /**
   * Recolher SÓ as listas — F02B (R08). Presente apenas na coluna: é o `«`
   * dela, irmão do `«` do menu no alto da barra. Um botão diferente do de
   * encaixar (outro ícone, outro nome): encaixar muda onde a árvore mora,
   * recolher a tira da tela até a pessoa pedir de volta.
   */
  recolher?: () => void;
};

/**
 * Nulo = fora da barra, ou na gaveta do celular — a coluna só existe acima de
 * 1024px (decisão 5 do plano), e um botão que não muda nada na tela ensinaria
 * que ele não funciona.
 */
export const ContextoDaColunaDaArvore = createContext<ColunaDaArvore | null>(null);

/**
 * A árvore está na coluna própria? — a pergunta da GRADE, F29.
 *
 * ⚠️ A GRADE E A BARRA PRECISAM DA MESMA RESPOSTA. A barra desenha a coluna; a
 *   página monta a grade (`.q-tela`) e é ela quem tem de abrir a terceira
 *   faixa (`data-coluna`). Este gancho é a MESMA conta que a barra faz — a
 *   preferência e a área, por `arvoreNaColuna` —, para as oito telas que
 *   montam a grade não precisarem refazê-la à mão. Ver `arvoreNaColuna`.
 */
export function useArvoreNaColuna(): boolean {
  const [prefs] = usePreferencias();
  const { sessao } = useSessao();
  return arvoreNaColuna(prefs, (area) => podeVer(sessao, area));
}

/** O pedido que a trilha manda à árvore: a chave do nó, e um contador que faz
 *  o mesmo nó pedido duas vezes contar como dois pedidos. */
export type PedidoDeRevelar = { chave: string; n: number };

/**
 * O DEGRAU QUE REVELA O NÓ, COM A BARRA EM ÍCONES — F29 (Fase 4).
 *
 * No quadro, na pasta e no espaço, o degrau de espaço (e o de pasta, no quadro
 * da lista) não navega: ele REVELA o nó na árvore ao lado — a dívida escrita da
 * F17.25, mantida de propósito (ver o cabeçalho de `@/board/trilha`).
 *
 * ⚠️ COM A ÁRVORE FORA DA TELA O PEDIDO CAÍA NUM LUGAR QUE NÃO EXISTIA: o
 *   degrau clicava e nada acontecia — botão que parece morto. Então o pedido
 *   primeiro põe a árvore na tela, e o efeito de `revelar` em `ArvoreDoQuadro`
 *   roda na montagem e acha o nó. F02B (R08): com a árvore em coluna, isso é
 *   só REABRIR AS LISTAS — o menu fica como a pessoa deixou; com ela dentro da
 *   barra, é expandir a barra (F29). A conta é `preferenciasParaRevelar`.
 *
 * Só acima de 1024px: abaixo dali a barra é a gaveta, que ignora a aparência,
 *   e trocar a preferência ali não mudaria nada na tela — só a deixaria
 *   expandida, sem ninguém ter pedido, para quando a janela alargar.
 *
 * Um gancho, e não três cópias do `useState` que as três telas tinham: a
 *   próxima tela com trilha que revela não tem como esquecer a expansão.
 */
export function usePedidoDeRevelar(): [PedidoDeRevelar | null, (chave: string) => void] {
  const [prefs, definirPrefs] = usePreferencias();
  const [pedido, setPedido] = useState<PedidoDeRevelar | null>(null);
  const pedir = useCallback(
    (chave: string) => {
      const larga =
        typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches;
      if (larga) {
        const proxima = preferenciasParaRevelar(prefs);
        if (proxima !== prefs) definirPrefs(proxima);
      }
      setPedido((r) => ({ chave, n: (r?.n ?? 0) + 1 }));
    },
    [prefs, definirPrefs],
  );
  return [pedido, pedir];
}

/**
 * O QUE MUDA PARA A ÁRVORE APARECER — F02B (R08), a conta pura de
 * `usePedidoDeRevelar`. Devolve o MESMO objeto quando nada precisa mudar.
 *
 *   · Árvore em coluna: basta reabrir as listas. O menu fica como está —
 *     rail com coluna é uma das quatro combinações, e expandir o menu à força
 *     desfaria a escolha da pessoa.
 *   · Árvore dentro da barra: ela só existe com o menu expandido, então
 *     expandir é necessário (o comportamento da F29).
 */
export function preferenciasParaRevelar(p: Preferencias): Preferencias {
  if (p.arvoreEmColuna) return p.listasRecolhidas ? { ...p, listasRecolhidas: false } : p;
  return p.aparencia === 'icones' ? alternarAparencia(p) : p;
}

/**
 * O atalho de recolher a barra: `Ctrl + .` (ou `⌘ + .` no Mac) — F29.
 *
 * ⚠️ CONFERIDO CONTRA OS ATALHOS QUE JÁ EXISTEM, E NENHUM USA O PONTO: o
 *   editor tem `Ctrl/⌘ + B, I, K` e `Ctrl/⌘ + Shift + X`
 *   (`@/board/barra-de-comandos`), a ficha tem `Ctrl/⌘ + S` e o comentário
 *   `Ctrl/⌘ + Enter`. Com `Shift` ou `Alt` junto não conta: é outra tecla, e
 *   um atalho que dispara com modificador a mais é atalho que se aciona sem
 *   querer.
 *
 * ⚠️ E NÃO DISPARA COM O FOCO NUM CAMPO DE TEXTO — F29, achado da verificação
 *   da Fase 1. Quem está escrevendo um comentário, o título de uma tarefa ou
 *   uma mensagem do chat e esbarra no ponto com o `Ctrl` apertado não pediu
 *   que a barra encolhesse do lado. No campo o atalho some, e
 *   o gesto fica com o campo. Vale para `input`, `textarea`, `select` e tudo o
 *   que é `contenteditable` — o editor rico da ficha é um.
 *
 * Função pura, fora do componente, pelo mesmo motivo de `atalhoDeTecla`: a
 *   suíte roda sem navegador, e é assim que cada combinação é conferida.
 */
export function ehAtalhoDeRecolher(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** O alvo da tecla. Opcional: sem ele, conta como fora de campo. */
  target?: unknown;
}): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  if (e.shiftKey || e.altKey) return false;
  if (ehCampoDeTexto(e.target)) return false;
  return e.key === '.';
}

/**
 * Se o alvo de uma tecla é um lugar onde se escreve.
 *
 * Lê só `tagName` e `isContentEditable`, e não `instanceof HTMLElement`: a
 * suíte roda em `node`, onde não há `HTMLElement`, e um objeto com os mesmos
 * dois campos prova a mesma regra. `isContentEditable` já é herdado pelos
 * filhos de um `[contenteditable]` no navegador — o parágrafo dentro do editor
 * responde `true` sozinho.
 */
export function ehCampoDeTexto(alvo: unknown): boolean {
  if (typeof alvo !== 'object' || alvo === null) return false;
  const el = alvo as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * O desenho EFETIVO que a moldura mediu — F02. A grade e a barra têm de
 * concordar: quem monta a grade chama `useComposicaoDoShell` e passa isto à
 * `BarraLateral`.
 */
export type ComposicaoDaBarra = {
  aparencia: Aparencia;
  arvoreNaColuna: boolean;
  /** A coluna caberia se a pessoa pedisse? Senão o botão de soltar some. */
  colunaCabe: boolean;
  /**
   * Com as listas reabertas, a coluna apareceria AGORA (com o menu desenhado
   * como está)? — F02B. É o que decide se o ícone da árvore no rail alterna as
   * listas (sim) ou expande o menu, como antes (não: no chat, sem espaço, ou
   * árvore dentro da barra).
   */
  listasCabem: boolean;
  /** Recolher/expandir: no rail automático não grava — só vale nesta tela. */
  alternarBarra: () => void;
};

/**
 * A COMPOSIÇÃO DO SHELL, MEDIDA — F02 do plano UX.
 *
 * ⚠️ O DEFEITO QUE ELA FECHA (UX01): 1024×768, barra expandida e árvore na
 *   coluna — a grade dava 288 + 264 de navegação e sobravam 400 px para o
 *   chat inteiro; a conversa ficava com 142 e "Geral" quebrava letra a letra.
 *   A janela não transbordava, então medir `scrollWidth` não via nada.
 *
 * O gancho mede a GRADE (`.q-tela`, por `ResizeObserver`) — o espaço do
 * contêiner, e não o da janela — e pergunta a `composicaoEfetiva` o que
 * desenhar: primeiro a árvore volta para dentro da barra, depois a barra vira
 * rail. A escolha guardada NUNCA é reescrita por falta de espaço: ampliar a
 * janela devolve o desenho escolhido sozinho.
 *
 * Quem monta a grade à mão (Minhas tarefas, Quadro, Pasta…) chama o mesmo
 * gancho e passa `composicao` à barra — a grade e a barra têm de concordar,
 * senão a grade reserva a faixa de uma coluna que não veio. Sem a propriedade,
 * a barra segue só a preferência, como antes (retrocompatível).
 */
const useAntesDaPintura = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useComposicaoDoShell(contexto: ContextoDoShell) {
  const [prefs, definirPrefs] = usePreferencias();
  const { sessao } = useSessao();
  const alcanca = useCallback((area: Parameters<typeof podeVer>[1]) => podeVer(sessao, area), [sessao]);
  const [grade, setGrade] = useState<HTMLDivElement | null>(null);
  const [medida, setMedida] = useState<{ largura: number; vao: number; rem: number } | null>(null);
  /* A pessoa expandiu a barra por cima do rail automático. Só nesta montagem:
     não é escolha para gravar, é "agora eu quero ver os nomes". */
  const [expandidaNaMao, setExpandidaNaMao] = useState(false);

  /* Antes da pintura — F08: no chat a barra desenhada (rail) difere da
     escolhida (expandida) em qualquer largura; medida depois da pintura, a
     tela piscava a barra larga por um quadro. No servidor não há o que medir. */
  useAntesDaPintura(() => {
    if (!grade) return;
    const larga = window.matchMedia?.('(min-width: 1024px)');
    const medir = () => {
      if (larga && !larga.matches) {
        setMedida(null);
        return;
      }
      const estilo = getComputedStyle(grade);
      const vao = parseFloat(estilo.columnGap) || 0;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const largura = Math.round(grade.clientWidth);
      setMedida((m) =>
        m && m.largura === largura && m.vao === vao && m.rem === rem ? m : { largura, vao, rem },
      );
    };
    medir();
    const olho = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    olho?.observe(grade);
    larga?.addEventListener('change', medir);
    return () => {
      olho?.disconnect();
      larga?.removeEventListener('change', medir);
    };
  }, [grade]);

  const base = {
    contexto,
    largura: medida?.largura ?? null,
    vao: medida?.vao ?? 0,
    rem: medida?.rem,
  };
  const comp = composicaoEfetiva(prefs, { ...base, expandidaNaMao }, alcanca);
  /* O rail que o espaço pediria, sem a mão da pessoa — é o que o botão desfaz. */
  const semMao = composicaoEfetiva(prefs, base, alcanca);
  const railAutomatico = semMao.aparencia === 'icones' && prefs.aparencia !== 'icones';
  /* Caberia a coluna, se a pessoa pedisse? Senão o botão de soltar some. */
  const colunaCabe = composicaoEfetiva(
    { ...prefs, arvoreEmColuna: true, listasRecolhidas: false, aparencia: 'icones-e-rotulos' },
    { ...base, expandidaNaMao: true },
    alcanca,
  ).arvoreNaColuna;
  /* F02B: reabrindo as listas, a coluna viria? Mesma medida, mesma mão. */
  const listasCabem = composicaoEfetiva(
    { ...prefs, listasRecolhidas: false },
    { ...base, expandidaNaMao },
    alcanca,
  ).arvoreNaColuna;

  /* O espaço voltou: a mão deixa de valer, para não sobrar numa próxima vez. */
  useEffect(() => {
    if (expandidaNaMao && !railAutomatico) setExpandidaNaMao(false);
  }, [expandidaNaMao, railAutomatico]);

  const alternarBarra = useCallback(() => {
    if (railAutomatico) {
      setExpandidaNaMao((v) => !v);
      return;
    }
    definirPrefs(alternarAparencia(prefs));
  }, [railAutomatico, prefs, definirPrefs]);

  const composicao: ComposicaoDaBarra = useMemo(
    () => ({
      aparencia: comp.aparencia,
      arvoreNaColuna: comp.arvoreNaColuna,
      colunaCabe,
      listasCabem,
      alternarBarra,
    }),
    [comp.aparencia, comp.arvoreNaColuna, colunaCabe, listasCabem, alternarBarra],
  );

  return {
    ref: setGrade,
    composicao,
    atributos: {
      'data-barra': comp.aparencia,
      'data-coluna': comp.arvoreNaColuna ? 'arvore' : undefined,
      'data-contexto': contexto,
      /* Diz ao teste e à folha que o desenho não é o guardado — o espaço mandou. */
      'data-adaptada': comp.adaptada ? 'true' : undefined,
    } as const,
  };
}
