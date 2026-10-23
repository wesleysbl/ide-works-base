/**
 * O GANCHO DAS TAREFAS DE UM ESCOPO — F18B (R09). Fala com
 * `GET /board/scope-tasks` (F18A) e guarda os lotes.
 *
 * AS QUATRO REGRAS
 *   1. UMA LEITURA POR RECORTE. Lista e Kanban usam o MESMO estado: trocar o
 *      modo não pede nada ao servidor, e os dois contam o mesmo universo.
 *   2. A LEITURA ANTIGA É CANCELADA E, SE CHEGAR, DESCARTADA. Cada recorte
 *      (escopo + filtros) abre uma vez (`@/ui/vez`) e aborta o pedido anterior
 *      (`AbortController`). Uma resposta lenta da busca "antiga" nunca pinta
 *      por cima da busca "nova".
 *   3. O LOTE SEGUINTE É DO MESMO RECORTE. `carregarMais` usa `reabrir`: se o
 *      filtro mudou no meio, o lote que chega é jogado fora.
 *   4. VOLTAR DA FICHA NÃO PERDE O QUE ESTAVA CARREGADO. Quantas linhas havia
 *      fica guardado por tela (caminho + busca, a chave da F32) na aba; ao
 *      remontar, a leitura busca até lá — e só então a rolagem da página,
 *      que `LembrarRolagem` devolve, tem onde cair.
 *
 * O CATÁLOGO (menus e fluxos) só vem na PRIMEIRA página; os lotes seguintes
 * trazem só linhas e contagens. Contagens sempre do lote mais novo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  type CatalogoDoEscopo,
  type ContagensDoEscopo,
  LOTE_DO_ESCOPO,
  LOTE_MAXIMO_DO_ESCOPO,
  type LinhaDoEscopo,
  type PedidoDoEscopo,
  type TarefasDoEscopo,
  enderecoDoEscopo,
} from '@/board/tarefas-do-escopo';
import { ApiError, api, indisponivel, semSessao } from '@/lib/api';
import { chaveDaTela } from '@/ui/rolagem-interna';
import { entregar, useVez } from '@/ui/vez';

export type EstadoDoEscopo = {
  /** `null` até a primeira resposta deste recorte (ou do anterior, enquanto o novo vem). */
  linhas: LinhaDoEscopo[] | null;
  counts: ContagensDoEscopo | null;
  statusCounts: Record<string, { total: number; matched: number }>;
  catalogo: CatalogoDoEscopo | null;
  cabecalho: TarefasDoEscopo['header'] | null;
  /** O filtro que o SERVIDOR aplicou — é dele que as frases saem. */
  aplicado: TarefasDoEscopo['filter'] | null;
  hasMore: boolean;
  nextCursor: string | null;
  /** Há leitura do recorte em voo (a primeira, ou a de um filtro novo). */
  carregando: boolean;
  carregandoMais: boolean;
  erro: string | null;
  /** O erro é passageiro: "Tentar de novo" faz sentido. */
  recuperavel: boolean;
  erroMais: string | null;
};

const VAZIO: EstadoDoEscopo = {
  linhas: null,
  counts: null,
  statusCounts: {},
  catalogo: null,
  cabecalho: null,
  aplicado: null,
  hasMore: false,
  nextCursor: null,
  carregando: true,
  carregandoMais: false,
  erro: null,
  recuperavel: false,
  erroMais: null,
};

/** A chave do recorte: o endereço sem cursor nem lote. */
export const chaveDoRecorte = (p: PedidoDoEscopo): string =>
  enderecoDoEscopo({ escopo: p.escopo, id: p.id, filtro: p.filtro });

const PREFIXO = 'ideworks:escopo-carregadas:';

function armazem(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Quantas estavam carregadas nesta tela, ao sair. Tolerante. */
export function lerCarregadas(texto: string | null): number {
  const n = Number.parseInt(texto ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 0;
}

/** O lote da primeira leitura: o que havia, com piso e teto do contrato. */
export const primeiroLote = (carregadas: number): number =>
  Math.min(LOTE_MAXIMO_DO_ESCOPO, Math.max(LOTE_DO_ESCOPO, carregadas));

/** Junta um lote ao que já havia, sem repetir tarefa (o cursor não repete; isto é cinto). */
export function juntarLote(antes: readonly LinhaDoEscopo[], lote: readonly LinhaDoEscopo[]): LinhaDoEscopo[] {
  const vistas = new Set(antes.map((l) => l.id));
  return [...antes, ...lote.filter((l) => !vistas.has(l.id))];
}

/**
 * A primeira página e, se `ate` pedir mais do que o teto de um lote, as
 * seguintes — tudo antes de pintar. É a releitura depois de mover: quem tinha
 * 180 carregadas continua com 180 (e não cai para as 100 do teto), sem a lista
 * encolher e crescer de novo na frente da pessoa. Catálogo, cabeçalho e filtro
 * vêm da primeira página; contagens e cursor, da última.
 */
async function lerAte(
  p: PedidoDoEscopo,
  limite: number | undefined,
  ate: number,
  sinal: AbortSignal,
): Promise<{ t: TarefasDoEscopo; linhas: LinhaDoEscopo[] }> {
  const primeira = (await api.tarefasDoEscopo({ ...p, cursor: null, limite }, sinal)).tasks;
  let linhas = primeira.rows;
  let ultima = primeira;
  while (linhas.length < ate && ultima.hasMore && ultima.nextCursor !== null) {
    const falta = ate - linhas.length;
    const lote = Math.min(LOTE_MAXIMO_DO_ESCOPO, Math.max(LOTE_DO_ESCOPO, falta));
    ultima = (await api.tarefasDoEscopo({ ...p, cursor: ultima.nextCursor, limite: lote }, sinal)).tasks;
    const antes = linhas.length;
    linhas = juntarLote(linhas, ultima.rows);
    if (linhas.length === antes) break; // cinto: página sem novidade não prende o laço
  }
  return {
    t: { ...primeira, counts: ultima.counts, statusCounts: ultima.statusCounts, hasMore: ultima.hasMore, nextCursor: ultima.nextCursor },
    linhas,
  };
}

const mensagem = (e: unknown, padrao: string) => (e instanceof ApiError ? e.message : padrao);
const abortado = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function useTarefasDoEscopo(pedido: PedidoDoEscopo | null) {
  const [estado, setEstado] = useState<EstadoDoEscopo>(VAZIO);
  const vez = useVez();
  const { pathname, search } = useLocation();
  const tela = chaveDaTela(pathname, search);

  const chave = pedido === null ? null : chaveDoRecorte(pedido);
  // O pedido estável por chave: o objeto do chamador pode ser novo a cada desenho.
  const pedidoAtual = useRef(pedido);
  pedidoAtual.current = pedido;

  const controle = useRef<AbortController | null>(null);
  const controleMais = useRef<AbortController | null>(null);
  const estadoAtual = useRef(estado);
  estadoAtual.current = estado;
  /** Até quantas linhas carregar sozinho (a volta da ficha). */
  const alvo = useRef(0);

  const ler = useCallback(
    async (opcoes: { limite?: number; ate?: number } = {}) => {
      const p = pedidoAtual.current;
      if (p === null) return;
      const k = chaveDoRecorte(p);
      controle.current?.abort();
      controleMais.current?.abort();
      const c = new AbortController();
      controle.current = c;
      const bilhete = vez.abrir(k);
      setEstado((e) => ({ ...e, carregando: true, carregandoMais: false, erro: null, erroMais: null }));
      await entregar(vez, bilhete, lerAte(p, opcoes.limite, opcoes.ate ?? 0, c.signal), {
        chegou: ({ t, linhas }) => {
          setEstado({
            linhas,
            counts: t.counts,
            statusCounts: t.statusCounts,
            catalogo: t.catalog ?? null,
            cabecalho: t.header,
            aplicado: t.filter,
            hasMore: t.hasMore,
            nextCursor: t.nextCursor,
            carregando: false,
            carregandoMais: false,
            erro: null,
            recuperavel: false,
            erroMais: null,
          });
        },
        falhou: (e) => {
          if (abortado(e)) return;
          if (semSessao(e)) {
            window.location.replace('/');
            return;
          }
          // Falha passageira (rede, 5xx) diz o que falhou e oferece de novo; a
          // recusa do servidor (404, 400) é dita com as palavras dele.
          const passageira = indisponivel(e) || !(e instanceof ApiError);
          setEstado((antes) => ({
            ...antes,
            carregando: false,
            erro: passageira ? 'Não foi possível carregar as tarefas agora.' : mensagem(e, 'Não foi possível carregar as tarefas.'),
            recuperavel: passageira,
          }));
        },
      });
    },
    [vez],
  );

  const carregarMais = useCallback(async () => {
    const p = pedidoAtual.current;
    const agora = estadoAtual.current;
    if (p === null || agora.nextCursor === null || agora.carregandoMais || agora.carregando) return;
    const bilhete = vez.reabrir(chaveDoRecorte(p));
    if (bilhete === null) return;
    const c = new AbortController();
    controleMais.current = c;
    setEstado((e) => ({ ...e, carregandoMais: true, erroMais: null }));
    await entregar(vez, bilhete, api.tarefasDoEscopo({ ...p, cursor: agora.nextCursor }, c.signal), {
      chegou: (r) => {
        const t = r.tasks;
        setEstado((e) => ({
          ...e,
          linhas: juntarLote(e.linhas ?? [], t.rows),
          counts: t.counts,
          statusCounts: t.statusCounts,
          hasMore: t.hasMore,
          nextCursor: t.nextCursor,
          carregandoMais: false,
        }));
      },
      falhou: (e) => {
        if (abortado(e)) return;
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        setEstado((antes) => ({ ...antes, carregandoMais: false, erroMais: mensagem(e, 'Não foi possível carregar mais tarefas.') }));
      },
    });
  }, [vez]);

  /* O recorte mudou (ou a tela montou): lê de novo, até o que havia ao sair. */
  useEffect(() => {
    if (chave === null) return;
    alvo.current = lerCarregadas(armazem()?.getItem(PREFIXO + tela) ?? null);
    void ler({ limite: primeiroLote(alvo.current) });
    // `tela` fica de fora: ela muda junto com a chave (filtros no endereço) ou
    // por um parâmetro que não é do recorte (`ver`), e aí não há o que reler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, ler]);

  /* Aborta o que estiver em voo ao sair da tela. */
  useEffect(
    () => () => {
      controle.current?.abort();
      controleMais.current?.abort();
    },
    [],
  );

  /* A volta da ficha: segue carregando até alcançar o que havia. */
  useEffect(() => {
    const n = estado.linhas?.length ?? 0;
    if (alvo.current > n && estado.hasMore && !estado.carregando && !estado.carregandoMais && estado.erroMais === null) {
      void carregarMais();
    } else if (!estado.carregando && !estado.carregandoMais) {
      alvo.current = 0;
    }
  }, [estado.linhas, estado.hasMore, estado.carregando, estado.carregandoMais, estado.erroMais, carregarMais]);

  /* Guarda quantas há — é o que a volta da ficha usa. */
  useEffect(() => {
    const n = estado.linhas?.length ?? 0;
    if (estado.carregando || n === 0) return;
    try {
      armazem()?.setItem(PREFIXO + tela, String(n));
    } catch {
      /* cofre cheio ou negado: a volta só recarrega o primeiro lote */
    }
  }, [estado.linhas, estado.carregando, tela]);

  /**
   * Relê o recorte sem esvaziar a tela e sem perder o que estava carregado:
   * a primeira página até o teto e as seguintes até alcançar quantas havia.
   */
  const recarregar = useCallback(() => {
    const n = estadoAtual.current.linhas?.length ?? 0;
    return ler({ limite: primeiroLote(n), ate: n });
  }, [ler]);

  /** A tela aplicou uma mudança por conta própria (mover de etapa). */
  const ajustar = useCallback((mudar: (e: EstadoDoEscopo) => EstadoDoEscopo) => setEstado(mudar), []);

  return useMemo(
    () => ({ ...estado, carregarMais, recarregar, tentarDeNovo: recarregar, ajustar }),
    [estado, carregarMais, recarregar, ajustar],
  );
}
