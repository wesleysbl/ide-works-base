/**
 * A ESPERA DA BUSCA DO QUADRO — F17.55, corrigida na revisão pós-F43.
 *
 * A caixa "Buscar tarefa pelo nome…" (`BarraDeFiltro`) não pergunta ao
 * servidor a cada tecla: espera 350 ms (ver o cabeçalho de lá) e só então
 * grava a busca no endereço, com `replace` e sem `state`.
 *
 * ⚠️ O PENDENTE NÃO PODE DISPARAR DEPOIS DE O ENDEREÇO ANDAR — F43, Fase 7.
 *   Com o card ao lado, clicar num cartão EMPURRA uma entrada no mesmo lugar,
 *   com a ficha no estado e o endereço mascarado (`LinkDaTarefa`). Digitar e
 *   clicar antes dos 350 ms: o relógio disparava depois do clique, e o
 *   `replace` sem estado trocava a entrada do painel por uma sem ele — o painel
 *   que acabara de abrir sumia. Duas travas, as duas daqui:
 *
 *   1. SAIR DA CAIXA GRAVA NA HORA (`gravarJa`, no `blur`). O `mousedown` do
 *      cartão tira o foco da caixa ANTES do clique navegar; a busca entra na
 *      entrada do quadro, e o painel é empurrado por cima dela — fechar o
 *      painel devolve o quadro com a busca. É o padrão de
 *      `useTextoNoEndereco.gravarJa` (Minhas tarefas, F05).
 *   2. O RELÓGIO NÃO ESCREVE EM OUTRA ENTRADA. Ele lembra em que entrada do
 *      histórico se digitou (`ondeEstou`); se ela mudou quando o tempo acaba
 *      (Voltar pelo teclado, um atalho que abriu outra coisa), o pendente é
 *      esquecido — gravá-lo escreveria a busca por cima da entrada nova.
 *
 * Fora do React e sem navegador de propósito: o relógio e as duas travas se
 * provam com relógio falso (`espera-da-busca.test.ts`).
 */

/** A pausa antes de perguntar ao servidor. Ver o cabeçalho de `BarraDeFiltro`. */
export const ESPERA_DA_BUSCA = 350;

export type EsperaDaBusca = {
  /** Uma tecla: guarda o texto e arma o relógio de novo. */
  digitar: (texto: string) => void;
  /** Grava o pendente agora — o foco saiu da caixa. Sem pendente, nada. */
  gravarJa: () => void;
  /** Esquece o pendente sem gravar: `Enter`/`Esc`/X gravaram por outro caminho, ou a peça saiu. */
  cancelar: () => void;
};

export function esperaDaBusca({
  espera,
  gravar,
  ondeEstou,
}: {
  espera: number;
  /** Grava o texto no endereço (o `aoMudar` da barra, com o filtro de agora). */
  gravar: (texto: string) => void;
  /** A entrada do histórico em que se está agora — ver a trava 2. */
  ondeEstou: () => string | null;
}): EsperaDaBusca {
  let relogio: ReturnType<typeof setTimeout> | null = null;
  let pendente: { texto: string; onde: string | null } | null = null;

  const parar = () => {
    if (relogio !== null) clearTimeout(relogio);
    relogio = null;
  };

  const cancelar = () => {
    parar();
    pendente = null;
  };

  return {
    digitar(texto) {
      parar();
      pendente = { texto, onde: ondeEstou() };
      relogio = setTimeout(() => {
        relogio = null;
        const p = pendente;
        pendente = null;
        if (p !== null && p.onde === ondeEstou()) gravar(p.texto);
      }, espera);
    },
    gravarJa() {
      const p = pendente;
      cancelar();
      if (p !== null) gravar(p.texto);
    },
    cancelar,
  };
}

/**
 * A entrada do histórico de agora: a chave que o roteador grava em cada uma
 * (`history.state.key`). Muda a cada navegação — inclusive a do painel ao lado.
 */
export function entradaDoHistorico(): string | null {
  if (typeof window === 'undefined') return null;
  const h = window.history.state as { key?: unknown } | null;
  return typeof h?.key === 'string' ? h.key : null;
}
