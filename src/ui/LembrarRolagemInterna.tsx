/**
 * AS CAIXAS QUE ROLAM POR DENTRO VOLTAM PARA ONDE ESTAVAM — F32 (Fase 2).
 *
 * O relato de 25/09, o que foi medido e as regras estão em
 * `@/ui/rolagem-interna`, que é a parte pura e tem teste. Aqui é só o DOM: o
 * par da `LembrarRolagem` (F17.24) para quem não é o documento — o corpo de
 * cada coluna do quadro e a faixa que rola de lado.
 *
 * ONDE ELE MORA
 *   Uma vez só, na `Moldura`, ao lado da `LembrarRolagem`, pelo mesmo motivo
 *   dela: uma cópia por tela seria um lugar por tela para a regra divergir. As
 *   telas só MARCAM as caixas (`data-rolagem`, ver `ROLADOR`); quem guarda e
 *   devolve é esta peça.
 *
 * ⚠️ GUARDA-SE ENQUANTO ROLA, E NÃO AO SAIR
 *   Ao sair da tela o quadro já foi desmontado quando qualquer efeito roda — as
 *   caixas não estão mais no documento, e uma caixa fora do documento diz
 *   `scrollTop` 0. Então o retrato é tirado a cada `scroll` (um ouvinte só, na
 *   fase de CAPTURA do documento: `scroll` de elemento não sobe, mas desce), e
 *   gravado uma vez por quadro. O `pagehide` e a limpeza só descarregam o
 *   retrato que já está em memória — nunca leem o DOM.
 *
 * ⚠️ ENQUANTO UMA CAIXA É RESTAURADA, O `scroll` DELA NÃO GRAVA
 *   Pôr `scrollTop = 2420` numa coluna que ainda tem 500 de conteúdo dá 500 e
 *   dispara `scroll` — gravar isso apagaria o lugar que se está justamente
 *   devolvendo. É a mesma armadilha que a `LembrarRolagem` mediu no documento.
 *
 * ⚠️ O GESTO DA PESSOA CANCELA — SÓ DA CAIXA ONDE ELE ACONTECEU
 *   Roda, toque, clique (inclusive na barra de rolagem) ou tecla de rolagem
 *   dentro de uma caixa marcada tira ESSA caixa (e as marcadas acima dela, como
 *   a faixa em volta da coluna) da restauração. As outras colunas continuam
 *   voltando. A roda sobre o fundo que a F32.1 converte em rolagem lateral e o
 *   arrasto com inércia da F17.25 começam com um desses gestos, então a
 *   restauração nunca briga com eles pela faixa.
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import {
  ATRIBUTO,
  type Armazem,
  LIMITE,
  PASSO,
  type Posicao,
  type Rolagens,
  TECLAS_DE_ROLAGEM,
  chaveDaTela,
  comPosicao,
  gravarRolagens,
  lerRolagens,
  passoDaRestauracao,
} from '@/ui/rolagem-interna';

/** `sessionStorage`, ou `null` quando o navegador nega (privado, bloqueado). */
function abrirArmazem(): Armazem | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Os nomes marcados do alvo para cima — quem o gesto alcança. */
function nomesAcima(alvo: EventTarget | null): string[] {
  const nomes: string[] = [];
  let no = alvo instanceof Element ? alvo.closest(`[${ATRIBUTO}]`) : null;
  while (no !== null) {
    const nome = no.getAttribute(ATRIBUTO);
    if (nome) nomes.push(nome);
    no = no.parentElement?.closest(`[${ATRIBUTO}]`) ?? null;
  }
  return nomes;
}

/** As caixas marcadas que estão no documento agora, pelo nome. */
function caixasNaTela(): Map<string, HTMLElement> {
  const mapa = new Map<string, HTMLElement>();
  for (const el of document.querySelectorAll<HTMLElement>(`[${ATRIBUTO}]`)) {
    const nome = el.getAttribute(ATRIBUTO);
    if (nome && !mapa.has(nome)) mapa.set(nome, el);
  }
  return mapa;
}

const por = (el: HTMLElement, alvo: Posicao) => {
  // Sem `behavior`: instantâneo, como a `LembrarRolagem` — rolagem animada a
  // cada volta de tela é o "efeito" que a F17.20 tirou do sistema.
  el.scrollLeft = alvo.x;
  el.scrollTop = alvo.y;
};

export function LembrarRolagemInterna() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    const armazem = abrirArmazem();
    const chave = chaveDaTela(pathname, search);
    const guardadas = lerRolagens(armazem, chave);

    /**
     * O retrato da tela, em memória. Começa com o que estava guardado: uma
     * coluna que não chegou a ser desenhada nesta visita (ou que ainda está
     * voltando) continua com a posição dela, em vez de ser esquecida.
     */
    let retrato: Rolagens = guardadas;
    /** As caixas ainda a devolver, com o lugar de cada uma. */
    const pendentes = new Map<string, Posicao>(Object.entries(guardadas));
    /** Por quantas voltas o tamanho de cada caixa não muda — ver `ESTAVEL`. */
    const paradas = new Map<string, { tamanho: string; voltas: number }>();

    let tentativas = 0;
    let relogio: ReturnType<typeof setInterval> | null = null;

    const parar = () => {
      pendentes.clear();
      if (relogio !== null) {
        clearInterval(relogio);
        relogio = null;
      }
    };

    const tentar = () => {
      tentativas += 1;
      const caixas = caixasNaTela();
      for (const [nome, alvo] of pendentes) {
        const el = caixas.get(nome);
        if (el === undefined) {
          paradas.delete(nome);
          continue;
        }
        const tamanho = `${el.scrollWidth}x${el.scrollHeight}x${el.clientWidth}x${el.clientHeight}`;
        const antes = paradas.get(nome);
        const voltas = antes !== undefined && antes.tamanho === tamanho ? antes.voltas + 1 : 0;
        paradas.set(nome, { tamanho, voltas });

        const passo = passoDaRestauracao(el, alvo, voltas);
        if (passo === 'esperar') continue;
        por(el, alvo);
        if (passo === 'concluir') pendentes.delete(nome);
      }
      if (pendentes.size === 0 || tentativas >= LIMITE) parar();
    };

    if (pendentes.size > 0) {
      tentar();
      if (pendentes.size > 0) relogio = setInterval(tentar, PASSO);
    }

    /* --- o gesto cancela, caixa por caixa --- */
    const desistir = (e: Event) => {
      if (pendentes.size === 0) return;
      for (const nome of nomesAcima(e.target)) pendentes.delete(nome);
    };
    const teclaDeRolagem = (e: KeyboardEvent) => {
      if (TECLAS_DE_ROLAGEM.includes(e.key)) desistir(e);
    };

    /* --- guardar enquanto rola --- */
    let quadro: number | null = null;
    const descarregar = () => {
      if (quadro !== null) {
        cancelAnimationFrame(quadro);
        quadro = null;
      }
      gravarRolagens(armazem, chave, retrato);
    };
    const aoRolar = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const nome = el.getAttribute(ATRIBUTO);
      if (!nome || pendentes.has(nome)) return;
      retrato = comPosicao(retrato, nome, { x: el.scrollLeft, y: el.scrollTop });
      // Uma gravação por quadro: `scroll` dispara dezenas de vezes por segundo
      // e `sessionStorage` é síncrono.
      if (quadro === null) {
        quadro = requestAnimationFrame(() => {
          quadro = null;
          gravarRolagens(armazem, chave, retrato);
        });
      }
    };

    const captura = { capture: true, passive: true } as const;
    document.addEventListener('scroll', aoRolar, captura);
    document.addEventListener('wheel', desistir, captura);
    document.addEventListener('touchmove', desistir, captura);
    document.addEventListener('pointerdown', desistir, captura);
    document.addEventListener('keydown', teclaDeRolagem, true);
    window.addEventListener('pagehide', descarregar);

    return () => {
      parar();
      // Descarrega o retrato em MEMÓRIA — não lê o DOM (ver o cabeçalho). No
      // desmonte do `StrictMode` ele ainda é o que foi lido, e regravar o que
      // foi lido não muda nada.
      if (quadro !== null) descarregar();
      document.removeEventListener('scroll', aoRolar, captura);
      document.removeEventListener('wheel', desistir, captura);
      document.removeEventListener('touchmove', desistir, captura);
      document.removeEventListener('pointerdown', desistir, captura);
      document.removeEventListener('keydown', teclaDeRolagem, true);
      window.removeEventListener('pagehide', descarregar);
    };
  }, [pathname, search]);

  return null;
}
