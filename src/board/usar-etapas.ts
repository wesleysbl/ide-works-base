/**
 * O GANCHO DAS ETAPAS DO QUADRO — F06C. As decisões são de `./etapas-vazias`
 * (puras); aqui mora só o que precisa da tela: a faixa de verdade, a medida de
 * "não cabe", as etapas à vista e o gesto de ir a uma etapa.
 *
 * ⚠️ A FAIXA TEM DOIS DONOS DE REF. `usePuxarParaRolar` (F17.25) liga a roda e
 * o arrasto do fundo por uma ref de callback; este gancho precisa do mesmo nó
 * para medir e rolar. A ref devolvida aqui chama as duas — e é estável
 * (`useCallback`), senão o React desligaria e religaria os ouvintes do
 * arrasto a cada desenho.
 *
 * ⚠️ IR A UMA ETAPA NÃO GRAVA NADA À MÃO. A rolagem programada dispara o
 * `scroll` da faixa, e é esse evento que `LembrarRolagemInterna` (F32) já
 * grava: voltar da ficha devolve a faixa onde a navegação a deixou.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  colunasRecolhidas,
  deslocamentoAte,
  deslocamentoParaVer,
  gravarAbertas,
  lerAbertas,
  type ColunaParaRecolher,
} from '@/board/etapas-vazias';
import { chaveDaTela } from '@/ui/rolagem-interna';

const NENHUMA: ReadonlySet<string> = new Set();

/** `sessionStorage`, ou `null` quando o navegador nega — o mesmo da F32. */
function abrirArmazem(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Quem pediu menos movimento no sistema operacional. */
const menosMovimento = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A coluna de uma etapa, achada pelo atributo — a chave pode ter espaço e acento (pasta). */
function colunaDe(faixa: HTMLElement, chave: string): HTMLElement | null {
  for (const filho of Array.from(faixa.children)) {
    if (filho instanceof HTMLElement && filho.dataset.etapa === chave) return filho;
  }
  return null;
}

type Pedido = { chave: string; modo: 'inicio' | 'ver' | 'recolher'; n: number };

export function useEtapasDoQuadro({
  quadroId,
  faixaDaTela,
  colunas,
  recolher,
  puxar,
}: {
  /**
   * Quando a MESMA tela tem várias faixas (o Kanban do escopo: uma por fluxo),
   * cada uma guarda as suas abertas à parte — senão abrir uma etapa numa faixa
   * apagava as abertas da outra na volta da ficha.
   */
  faixaDaTela?: string;
  /** Outra lista/pasta zera as etapas abertas à mão. */
  quadroId: string | null;
  colunas: readonly ColunaParaRecolher[];
  /** A preferência `vazias` de `@/ui/lugar`. */
  recolher: boolean;
  /** A ref de `usePuxarParaRolar`. */
  puxar: (no: HTMLDivElement | null) => void;
}) {
  /* As abertas à mão pertencem a UMA tela (caminho + busca, a chave da F32)
     e sobrevivem à ida à ficha: são guardadas na aba e lidas no PRIMEIRO
     desenho, antes de `LembrarRolagemInterna` devolver o `scrollLeft` — senão
     a faixa voltava ao mesmo número com a coluna encolhida (conteúdo ~236 px
     deslocado). Desligar o interruptor esquece todas: religar começa do zero. */
  const { pathname, search } = useLocation();
  const tela = chaveDaTela(pathname, search) + (faixaDaTela ? `#${faixaDaTela}` : '');
  const dono = `${tela}|${quadroId ?? ''}|${recolher ? 1 : 0}`;
  const guardadas = useMemo<ReadonlySet<string>>(
    () => (recolher ? lerAbertas(abrirArmazem(), tela) : NENHUMA),
    [tela, recolher],
  );
  const [abertas, setAbertas] = useState<{ dono: string; chaves: ReadonlySet<string> }>(() => ({
    dono,
    chaves: guardadas,
  }));
  const abertasAgora = abertas.dono === dono ? abertas.chaves : guardadas;
  // Trocar a preferência/tela também descarta o estado anterior em memória.
  if (abertas.dono !== dono) setAbertas({ dono, chaves: guardadas });
  useEffect(() => {
    if (!recolher) gravarAbertas(abrirArmazem(), tela, NENHUMA);
  }, [recolher, tela]);

  const recolhidas = useMemo(
    () => colunasRecolhidas(colunas, recolher, abertasAgora),
    [colunas, recolher, abertasAgora],
  );

  const [faixa, setFaixa] = useState<HTMLDivElement | null>(null);
  const ref = useCallback(
    (no: HTMLDivElement | null) => {
      puxar(no);
      setFaixa(no);
    },
    [puxar],
  );

  /* --- não cabe? e quais etapas estão à vista --- */
  const [transborda, setTransborda] = useState(false);
  const [aVista, setAVista] = useState<readonly string[]>([]);
  const assinatura = colunas.map((c) => c.chave).join('\u0000') + '|' + [...recolhidas].join('\u0000');

  useEffect(() => {
    if (faixa === null) return;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      setTransborda(faixa.scrollWidth > faixa.clientWidth + 1);
      const f = faixa.getBoundingClientRect();
      const vistas: string[] = [];
      for (const filho of Array.from(faixa.children)) {
        if (!(filho instanceof HTMLElement) || filho.dataset.etapa === undefined) continue;
        const r = filho.getBoundingClientRect();
        // À vista = pelo menos metade dela dentro da faixa.
        const dentro = Math.min(r.right, f.right) - Math.max(r.left, f.left);
        if (r.width > 0 && dentro >= r.width / 2) vistas.push(filho.dataset.etapa);
      }
      setAVista((antes) => (antes.join('\u0000') === vistas.join('\u0000') ? antes : vistas));
    };
    const agendar = () => {
      if (quadro === 0) quadro = requestAnimationFrame(medir);
    };
    medir();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(agendar) : null;
    ro?.observe(faixa);
    for (const filho of Array.from(faixa.children)) ro?.observe(filho);
    faixa.addEventListener('scroll', agendar, { passive: true });
    return () => {
      ro?.disconnect();
      faixa.removeEventListener('scroll', agendar);
      if (quadro !== 0) cancelAnimationFrame(quadro);
    };
  }, [faixa, assinatura]);

  /* --- ir a uma etapa --- */
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const contador = useRef(0);

  const abrirEIr = useCallback(
    (chave: string, modo: Pedido['modo']) => {
      if (recolhidas.has(chave)) {
        const chaves = new Set(abertasAgora);
        chaves.add(chave);
        setAbertas({ dono, chaves });
        gravarAbertas(abrirArmazem(), tela, chaves);
      }
      contador.current += 1;
      setPedido({ chave, modo, n: contador.current });
    },
    [recolhidas, dono, abertasAgora, tela],
  );

  /** Pela navegação: a coluna encosta na borda esquerda da faixa. */
  const irPara = useCallback((chave: string) => abrirEIr(chave, 'inicio'), [abrirEIr]);
  /** Pela faixa recolhida: abre e rola só o necessário para vê-la inteira. */
  const abrir = useCallback((chave: string) => abrirEIr(chave, 'ver'), [abrirEIr]);

  const recolhiveis = useMemo(
    () => colunasRecolhidas(colunas, recolher, NENHUMA),
    [colunas, recolher],
  );
  const fechar = useCallback((chave: string) => {
    if (!recolhiveis.has(chave)) return;
    const chaves = new Set(abertasAgora);
    chaves.delete(chave);
    setAbertas({ dono, chaves });
    gravarAbertas(abrirArmazem(), tela, chaves);
    contador.current += 1;
    setPedido({ chave, modo: 'recolher', n: contador.current });
  }, [recolhiveis, abertasAgora, dono, tela]);

  useEffect(() => {
    if (pedido === null || faixa === null) return;
    // Depois do desenho: a coluna aberta agora já tem a largura dela.
    const coluna = colunaDe(faixa, pedido.chave);
    if (coluna === null) return;
    if (pedido.modo === 'recolher') {
      coluna.querySelector<HTMLElement>('.q-dobra')?.focus({ preventScroll: true });
      return;
    }
    const f = faixa.getBoundingClientRect();
    const c = coluna.getBoundingClientRect();
    const medidas = {
      left: f.left, right: f.right, scrollLeft: faixa.scrollLeft,
      scrollWidth: faixa.scrollWidth, clientWidth: faixa.clientWidth,
    };
    const alvo = pedido.modo === 'inicio' ? deslocamentoAte(medidas, c.left) : deslocamentoParaVer(medidas, c);
    if (alvo !== Math.round(faixa.scrollLeft)) {
      faixa.scrollTo({ left: alvo, behavior: menosMovimento() ? 'auto' : 'smooth' });
    }
    // O foco vai para dentro da etapa: o primeiro controle dela (o
    // `Adicionar tarefa` de uma etapa vazia) ou a própria coluna.
    const alvoDoFoco =
      pedido.modo === 'ver'
        ? coluna.querySelector<HTMLElement>('.q-coluna-corpo ~ * button, .q-coluna-corpo button') ?? coluna
        : coluna;
    alvoDoFoco.focus({ preventScroll: true });
  }, [pedido, faixa]);

  return { ref, recolhidas, recolhiveis, transborda, aVista, irPara, abrir, fechar };
}
