/**
 * A PAGINAÇÃO DE `Minhas tarefas` NA TELA — respostas fora de ordem, lotes
 * acumulados e a volta de uma ficha. Etapa F17.AUD06.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   O achado 4 da auditoria de 09/09/2026, do lado da tela: a aba que o
 *   servidor já filtrou chega em lotes, e a tela precisa (1) acumulá-los sem
 *   repetir e sem reordenar, (2) mostrar a contagem do banco e não a do lote,
 *   (3) jogar fora a resposta da aba anterior, (4) manter o que já leu quando
 *   um lote seguinte falha, e (5) reconstruir a janela ao voltar de uma ficha.
 *
 * O SERVIDOR DE MENTIRA
 *   `servidor()` responde a cada pedido (`aba`, `cursor`) com o que o teste
 *   programou — atraso, página ou erro — e anota tudo o que lhe pediram. As
 *   esperas são timers falsos, como em `ui/vez.test.ts`: a ordem de chegada é
 *   a que o teste escolhe, não a da rede.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BoardTask } from '@/board/board';
import { type Aba, ABAS, type WorkRow } from '@/board/meu-trabalho';
import {
  type EstadoDaPaginacao,
  type Leitor,
  type PaginaDoTrabalho,
  type Pedido,
  TETO_DA_RESTAURACAO,
  comProgresso,
  criarPaginacaoNaTela,
  estadoInicial,
  lerProgresso,
} from '@/board/paginacao-na-tela';

/* ───────────────────────────── as linhas ───────────────────────────── */

const base: BoardTask = {
  id: 'x',
  title: 'Tarefa',
  statusId: 's1',
  priority: null,
  dueOn: null,
  startOn: null,
  completedAt: null,
  hasDescription: false,
  hasAttachment: false,
  clientId: null,
  clientName: null,
  assignees: [],
  tags: [],
  taskTypeName: null,
  parentId: null,
  parentTitle: null,
  subtaskCount: 0,
  checklistDone: 0,
  checklistTotal: 0,
  commentCount: 0,
  previewAttachmentId: null,
  previewCount: 0,
};

/** Uma linha que `abaDaLinha` põe na aba pedida. */
const linha = (id: string, aba: Aba = 'pendente'): WorkRow => ({
  ...base,
  id,
  title: `Tarefa ${id}`,
  categoryName: null,
  spaceName: null,
  folderName: null,
  listId: 'l1',
  listName: 'Lista',
  listLive: true,
  statusName: 'a fazer',
  statusType: 'open',
  statusColor: null,
  completedAt: aba === 'feito' ? '2026-09-01T00:00:00Z' : null,
  assignedToMe: aba !== 'delegado',
  createdByMe: aba === 'delegado',
  otherAssignees: aba === 'delegado' ? 1 : 0,
});

const CONTAS: Record<Aba, number> = { pendente: 312, feito: 40, delegado: 3 };

const pagina = (
  aba: Aba,
  ids: readonly string[],
  mais: string | null = null,
  extras: Partial<PaginaDoTrabalho> = {},
): PaginaDoTrabalho => ({
  aba,
  rows: ids.map((id) => linha(id, aba)),
  counts: CONTAS,
  hasMore: mais !== null,
  nextCursor: mais,
  ...extras,
});

/* ───────────────────────────── o servidor de mentira ───────────────────────────── */

type Resposta = { atraso: number; pagina?: PaginaDoTrabalho; erro?: unknown };

function servidor() {
  const pedidos: Pedido[] = [];
  const respostas = new Map<string, Resposta[]>();
  const chave = (aba: Aba, cursor: string | null) => `${aba}|${cursor ?? ''}`;

  const ler: Leitor = (pedido) => {
    pedidos.push(pedido);
    const fila = respostas.get(chave(pedido.aba, pedido.cursor));
    const r = fila?.shift();
    if (r === undefined) {
      return Promise.reject(new Error(`sem resposta programada para ${chave(pedido.aba, pedido.cursor)}`));
    }
    return new Promise<PaginaDoTrabalho>((resolver, recusar) =>
      setTimeout(() => {
        if (r.pagina !== undefined) resolver(r.pagina);
        else recusar(r.erro);
      }, r.atraso),
    );
  };

  /** Programa a próxima resposta para (`aba`, `cursor`). Em ordem, uma por pedido. */
  const responde = (aba: Aba, cursor: string | null, r: Resposta) => {
    const k = chave(aba, cursor);
    respostas.set(k, [...(respostas.get(k) ?? []), r]);
  };

  return { ler, pedidos, responde };
}

/** A máquina com o espelho da tela: tudo o que `aoMudar` entregou, na ordem. */
function tela(aba: Aba = 'pendente') {
  const s = servidor();
  const fases: string[] = [];
  const maquina = criarPaginacaoNaTela({
    ler: s.ler,
    aba,
    aoMudar: (e: EstadoDaPaginacao) => fases.push(e.fase),
  });
  return { ...s, maquina, fases, ids: () => maquina.estado().linhas.map((l) => l.id) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/* ───────────────────────────── a primeira página ───────────────────────────── */

describe('a primeira página', () => {
  it('nasce carregando e sem contagem: zero não aparece enquanto se espera', () => {
    const e = estadoInicial('pendente');
    expect(e.fase).toBe('carregando');
    expect(e.counts).toBeNull();
    expect(e.linhas).toEqual([]);
    expect(e.paginas).toBe(0);
  });

  it('assenta em `pronto` com as contagens do BANCO, e não as do lote', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 100, pagina: pagina('pendente', ['a', 'b'], 'c1') });
    t.maquina.abrir('pendente');
    expect(t.maquina.estado().fase).toBe('carregando');

    await vi.advanceTimersByTimeAsync(100);
    const e = t.maquina.estado();
    expect(e.fase).toBe('pronto');
    expect(e.counts).toEqual(CONTAS);
    // 312 é a contagem do banco; o lote tem 2. É a diferença que o achado 4 nomeia.
    expect(e.counts?.pendente).toBe(312);
    expect(t.ids()).toEqual(['a', 'b']);
    expect(e.hasMore).toBe(true);
    expect(e.paginas).toBe(1);
    expect(t.maquina.progresso()).toEqual({ aba: 'pendente', paginas: 1 });
  });

  it('sem continuação, assenta em `fim`', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a']) });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.maquina.estado().fase).toBe('fim');
    expect(t.maquina.estado().hasMore).toBe(false);
  });

  it('zero linhas confirmadas é `vazio` — que não é `carregando`', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', []) });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.maquina.estado().fase).toBe('vazio');
    expect(t.maquina.estado().counts).toEqual(CONTAS);
  });

  it('`hasMore` sem cursor é tratado como fim — nunca um pedido sem posição', async () => {
    const t = tela();
    t.responde('pendente', null, {
      atraso: 10,
      pagina: pagina('pendente', ['a'], null, { hasMore: true, nextCursor: null }),
    });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.maquina.estado().fase).toBe('fim');
    t.maquina.carregarMais();
    expect(t.pedidos).toHaveLength(1);
  });

  it('a falha inicial é `erro-inicial`, sem linhas; Tentar de novo repete o pedido do começo', async () => {
    const t = tela();
    const caiu = new Error('caiu');
    t.responde('pendente', null, { atraso: 10, erro: caiu });
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a'], 'c1') });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.maquina.estado().fase).toBe('erro-inicial');
    expect(t.maquina.estado().erro).toBe(caiu);
    expect(t.ids()).toEqual([]);

    t.maquina.tentarDeNovo();
    expect(t.maquina.estado().fase).toBe('carregando');
    expect(t.maquina.estado().erro).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.pedidos).toEqual([
      { aba: 'pendente', cursor: null },
      { aba: 'pendente', cursor: null },
    ]);
    expect(t.maquina.estado().fase).toBe('pronto');
    expect(t.ids()).toEqual(['a']);
  });
});

/* ───────────────────────────── carregar mais ───────────────────────────── */

describe('carregar mais — mais de uma página', () => {
  const duasPaginas = () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a', 'b'], 'c1') });
    t.responde('pendente', 'c1', { atraso: 10, pagina: pagina('pendente', ['c', 'd'], 'c2') });
    t.responde('pendente', 'c2', { atraso: 10, pagina: pagina('pendente', ['e']) });
    return t;
  };

  it('acumula na ordem de chegada, e cada lote pede o cursor do anterior', async () => {
    const t = duasPaginas();
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);

    t.maquina.carregarMais();
    expect(t.maquina.estado().fase).toBe('carregando-mais');
    // As linhas FICAM enquanto o próximo lote vem.
    expect(t.ids()).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(t.maquina.estado().paginas).toBe(2);
    expect(t.maquina.estado().fase).toBe('pronto');

    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(t.maquina.estado().fase).toBe('fim');
    expect(t.pedidos.map((p) => p.cursor)).toEqual([null, 'c1', 'c2']);
  });

  it('a mesma tarefa em dois lotes entra UMA vez, onde chegou primeiro', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a', 'b'], 'c1') });
    // `b` mudou de lugar entre os dois pedidos e veio de novo.
    t.responde('pendente', 'c1', { atraso: 10, pagina: pagina('pendente', ['b', 'c']) });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['a', 'b', 'c']);
  });

  it('as contagens são as da PRIMEIRA página: o lote seguinte não as muda', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a'], 'c1') });
    t.responde('pendente', 'c1', {
      atraso: 10,
      pagina: pagina('pendente', ['b'], null, { counts: { pendente: 999, feito: 1, delegado: 1 } }),
    });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.maquina.estado().counts).toEqual(CONTAS);
  });

  it('no fim, `carregarMais` não pede nada; em voo, o segundo clique é ignorado', async () => {
    const t = duasPaginas();
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    t.maquina.carregarMais();
    t.maquina.carregarMais();
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.pedidos).toHaveLength(2);

    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.maquina.estado().fase).toBe('fim');
    t.maquina.carregarMais();
    t.maquina.tentarDeNovo();
    expect(t.pedidos).toHaveLength(3);
  });

  it('a falha ao carregar mais MANTÉM as linhas; Tentar de novo repete o MESMO cursor', async () => {
    const t = tela();
    const caiu = new Error('caiu no meio');
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a', 'b'], 'c1') });
    t.responde('pendente', 'c1', { atraso: 10, erro: caiu });
    t.responde('pendente', 'c1', { atraso: 10, pagina: pagina('pendente', ['c']) });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);

    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    const e = t.maquina.estado();
    expect(e.fase).toBe('erro-ao-carregar-mais');
    expect(e.erro).toBe(caiu);
    expect(t.ids()).toEqual(['a', 'b']);
    expect(e.paginas).toBe(1);
    // As contagens não foram tocadas pelo erro.
    expect(e.counts).toEqual(CONTAS);

    t.maquina.tentarDeNovo();
    expect(t.maquina.estado().fase).toBe('carregando-mais');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.pedidos.map((p) => p.cursor)).toEqual([null, 'c1', 'c1']);
    expect(t.ids()).toEqual(['a', 'b', 'c']);
    expect(t.maquina.estado().fase).toBe('fim');
    expect(t.maquina.estado().erro).toBeNull();
  });
});

/* ───────────────────────────── a troca de aba ───────────────────────────── */

describe('a troca de aba durante uma carga', () => {
  it('a resposta da aba anterior chega DEPOIS e é jogada fora', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 500, pagina: pagina('pendente', ['p1', 'p2'], 'c1') });
    t.responde('feito', null, { atraso: 50, pagina: pagina('feito', ['f1']) });

    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(100);
    t.maquina.abrir('feito');
    expect(t.maquina.estado().fase).toBe('carregando');
    expect(t.maquina.estado().aba).toBe('feito');

    await vi.advanceTimersByTimeAsync(50);
    expect(t.ids()).toEqual(['f1']);
    expect(t.maquina.estado().fase).toBe('fim');

    // `pendente` chega, atrasada. Antes desta etapa, ela entraria na tela de `feito`.
    await vi.advanceTimersByTimeAsync(500);
    expect(t.ids()).toEqual(['f1']);
    expect(t.maquina.estado().aba).toBe('feito');
    expect(t.maquina.estado().fase).toBe('fim');
    expect(t.maquina.progresso()).toEqual({ aba: 'feito', paginas: 1 });
  });

  it('a continuação de `pendente` em voo não entra em `feito`', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['p1'], 'c1') });
    t.responde('pendente', 'c1', { atraso: 300, pagina: pagina('pendente', ['p2']) });
    t.responde('feito', null, { atraso: 10, pagina: pagina('feito', ['f1'], 'cf') });

    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(50);
    t.maquina.abrir('feito');
    await vi.advanceTimersByTimeAsync(300);

    expect(t.ids()).toEqual(['f1']);
    // E o "terminou" da continuação velha não mexeu na fase de `feito`.
    expect(t.maquina.estado().fase).toBe('pronto');
    expect(t.maquina.estado().paginas).toBe(1);
  });

  it('uma página cuja `aba` não é a da tela não entra — vira erro, não silêncio', async () => {
    // A segunda defesa: o servidor respondeu ao pedido certo com a aba errada.
    // Nada entra, e a tela fica sabendo: presa em "Carregando…" seria pior.
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('feito', ['f1']) });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual([]);
    expect(t.maquina.estado().fase).toBe('erro-inicial');
    expect(t.maquina.estado().paginas).toBe(0);
    expect(t.maquina.estado().counts).toBeNull();
  });

  it('uma linha que `abaDaLinha` não põe na aba é descartada', async () => {
    const t = tela();
    t.responde('pendente', null, {
      atraso: 10,
      pagina: pagina('pendente', [], null, {
        rows: [linha('p1', 'pendente'), linha('f1', 'feito'), linha('d1', 'delegado')],
      }),
    });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['p1']);
  });

  it('as contagens anteriores FICAM enquanto a nova aba carrega, e as novas as substituem', async () => {
    const t = tela();
    const outras: Record<Aba, number> = { pendente: 311, feito: 41, delegado: 3 };
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['p1']) });
    t.responde('feito', null, { atraso: 10, pagina: pagina('feito', ['f1'], null, { counts: outras }) });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    t.maquina.abrir('feito');
    expect(t.maquina.estado().counts).toEqual(CONTAS);
    expect(t.ids()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(t.maquina.estado().counts).toEqual(outras);
  });

  it('reabrir a MESMA aba zera: a leitura antiga deixa de valer', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 300, pagina: pagina('pendente', ['velha']) });
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['nova']) });
    t.maquina.abrir('pendente');
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(300);
    expect(t.ids()).toEqual(['nova']);
    expect(t.maquina.estado().paginas).toBe(1);
  });
});

/* ───────────────────────────── a volta de uma ficha ───────────────────────────── */

describe('o progresso e a volta de uma ficha', () => {
  const tresPaginas = (t: ReturnType<typeof tela>) => {
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a', 'b'], 'c1') });
    t.responde('pendente', 'c1', { atraso: 10, pagina: pagina('pendente', ['c', 'd'], 'c2') });
    t.responde('pendente', 'c2', { atraso: 10, pagina: pagina('pendente', ['e', 'f'], 'c3') });
    t.responde('pendente', 'c3', { atraso: 10, pagina: pagina('pendente', ['g']) });
  };

  it('abrir com progresso relê as páginas em sequência, encadeando os cursores', async () => {
    const t = tela();
    tresPaginas(t);
    t.maquina.abrir('pendente', { aba: 'pendente', paginas: 3 });
    expect(t.maquina.estado().alvo).toBe(3);

    await vi.advanceTimersByTimeAsync(10);
    // A primeira chegou e a segunda já foi pedida sozinha.
    expect(t.maquina.estado().fase).toBe('carregando-mais');
    expect(t.ids()).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);

    expect(t.pedidos.map((p) => p.cursor)).toEqual([null, 'c1', 'c2']);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(t.maquina.estado().fase).toBe('pronto');
    expect(t.maquina.progresso()).toEqual({ aba: 'pendente', paginas: 3 });
    // E para: a quarta só vem se a pessoa pedir.
    await vi.advanceTimersByTimeAsync(100);
    expect(t.pedidos).toHaveLength(3);
  });

  it('progresso de OUTRA aba é ignorado: uma página só', async () => {
    const t = tela();
    tresPaginas(t);
    t.maquina.abrir('pendente', { aba: 'feito', paginas: 3 });
    expect(t.maquina.estado().alvo).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(t.pedidos).toHaveLength(1);
    expect(t.maquina.estado().fase).toBe('pronto');
  });

  it('a restauração para quando o conjunto acaba antes do alvo', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a'], 'c1') });
    t.responde('pendente', 'c1', { atraso: 10, pagina: pagina('pendente', ['b']) });
    t.maquina.abrir('pendente', { aba: 'pendente', paginas: 5 });
    await vi.advanceTimersByTimeAsync(50);
    expect(t.pedidos).toHaveLength(2);
    expect(t.maquina.estado().fase).toBe('fim');
    expect(t.maquina.progresso().paginas).toBe(2);
  });

  it('tem teto', () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a'], 'c1') });
    t.maquina.abrir('pendente', { aba: 'pendente', paginas: 50 });
    expect(t.maquina.estado().alvo).toBe(TETO_DA_RESTAURACAO);
  });

  it('falha no meio: fica o que chegou; Tentar de novo retoma até o alvo', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a', 'b'], 'c1') });
    t.responde('pendente', 'c1', { atraso: 10, erro: new Error('caiu') });
    t.responde('pendente', 'c1', { atraso: 10, pagina: pagina('pendente', ['c', 'd'], 'c2') });
    t.responde('pendente', 'c2', { atraso: 10, pagina: pagina('pendente', ['e'], 'c3') });
    t.maquina.abrir('pendente', { aba: 'pendente', paginas: 3 });
    await vi.advanceTimersByTimeAsync(20);

    expect(t.maquina.estado().fase).toBe('erro-ao-carregar-mais');
    expect(t.ids()).toEqual(['a', 'b']);
    expect(t.maquina.progresso().paginas).toBe(1);

    t.maquina.tentarDeNovo();
    await vi.advanceTimersByTimeAsync(20);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(t.maquina.progresso().paginas).toBe(3);
    expect(t.maquina.estado().fase).toBe('pronto');
    expect(t.pedidos.map((p) => p.cursor)).toEqual([null, 'c1', 'c1', 'c2']);
  });

  it('trocar de aba no meio da restauração abandona o alvo antigo', async () => {
    const t = tela();
    tresPaginas(t);
    t.responde('feito', null, { atraso: 10, pagina: pagina('feito', ['f1']) });
    t.maquina.abrir('pendente', { aba: 'pendente', paginas: 3 });
    await vi.advanceTimersByTimeAsync(10);
    t.maquina.abrir('feito');
    await vi.advanceTimersByTimeAsync(100);
    expect(t.ids()).toEqual(['f1']);
    expect(t.maquina.estado().alvo).toBe(1);
    // A segunda página de `pendente` chegou a ser pedida, mas nada além dela.
    expect(t.pedidos.filter((p) => p.aba === 'pendente')).toHaveLength(2);
  });

  describe('lerProgresso — o que a entrada de navegação pode conter', () => {
    it('lê a forma exata, e `comProgresso` é o par', () => {
      const p = { aba: 'feito' as const, paginas: 3 };
      expect(lerProgresso(comProgresso(p), ABAS)).toEqual(p);
    });

    it.each([
      ['nada', null],
      ['undefined', undefined],
      ['um texto', 'x'],
      ['sem progresso', { idx: 2 }],
      ['progresso nulo', { progresso: null }],
      ['aba desconhecida', { progresso: { aba: 'banana', paginas: 2 } }],
      ['páginas zero', { progresso: { aba: 'pendente', paginas: 0 } }],
      ['páginas fracionárias', { progresso: { aba: 'pendente', paginas: 1.5 } }],
      ['páginas em texto', { progresso: { aba: 'pendente', paginas: '3' } }],
    ])('recusa %s', (_nome, entrada) => {
      expect(lerProgresso(entrada, ABAS)).toBeNull();
    });
  });
});

/* ───────────────────────────── a desmontagem ───────────────────────────── */

describe('a desmontagem', () => {
  it('depois de encerrar, nem dado nem erro entram; carregar mais não pede nada', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a'], 'c1') });
    t.maquina.abrir('pendente');
    t.maquina.encerrar();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual([]);
    expect(t.maquina.estado().fase).toBe('carregando');
    t.maquina.carregarMais();
    t.maquina.tentarDeNovo();
    expect(t.pedidos).toHaveLength(1);
    expect(t.fases).toEqual(['carregando']);
  });

  it('abrir depois de encerrar volta a valer — o vaivém do StrictMode', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['velha']) });
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['nova']) });
    t.maquina.abrir('pendente');
    t.maquina.encerrar();
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['nova']);
  });
});

/* ───────────────────────────── a releitura silenciosa (F43, Fase 7) ───────────────────────────── */

describe('reler — o card ao lado fechou e a lista não desmontou', () => {
  /** Uma tela com duas páginas já lidas (`a b` + `c d`, e há mais). */
  const comDuasPaginas = async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a', 'b'], 'c1') });
    t.responde('pendente', 'c1', { atraso: 10, pagina: pagina('pendente', ['c', 'd'], 'c2') });
    t.maquina.abrir('pendente');
    await vi.advanceTimersByTimeAsync(10);
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd']);
    return t;
  };

  it('relê as MESMAS páginas sem esvaziar a tela, e troca de uma vez quando a última chega', async () => {
    const t = await comDuasPaginas();
    const novas = { ...CONTAS, pendente: 311 };
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a', 'b2'], 'n1', { counts: novas }) });
    t.responde('pendente', 'n1', { atraso: 10, pagina: pagina('pendente', ['c', 'd'], 'n2') });
    const antes = t.fases.length;

    t.maquina.reler();
    // Nada muda na tela enquanto a releitura anda: nem fase, nem linhas.
    expect(t.fases.length).toBe(antes);
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(t.fases.length).toBe(antes);

    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['a', 'b2', 'c', 'd']);
    const e = t.maquina.estado();
    expect(e.paginas).toBe(2);
    expect(e.fase).toBe('pronto');
    // As contagens são as da PRIMEIRA página relida, como em toda abertura.
    expect(e.counts?.pendente).toBe(311);
    expect(t.pedidos.slice(-2)).toEqual([
      { aba: 'pendente', cursor: null },
      { aba: 'pendente', cursor: 'n1' },
    ]);
    expect(t.fases.slice(antes)).toEqual(['pronto']);
  });

  it('depois de reler, "Carregar mais" continua do cursor NOVO', async () => {
    const t = await comDuasPaginas();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a', 'b'], 'n1') });
    t.responde('pendente', 'n1', { atraso: 10, pagina: pagina('pendente', ['c', 'd'], 'n2') });
    t.responde('pendente', 'n2', { atraso: 10, pagina: pagina('pendente', ['e']) });
    t.maquina.reler();
    await vi.advanceTimersByTimeAsync(20);
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.pedidos.at(-1)).toEqual({ aba: 'pendente', cursor: 'n2' });
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(t.maquina.estado().fase).toBe('fim');
  });

  it('a falha é calada: a lista que estava na tela continua lá, e a tela segue usável', async () => {
    const t = await comDuasPaginas();
    t.responde('pendente', null, { atraso: 10, erro: new Error('caiu') });
    t.responde('pendente', 'c2', { atraso: 10, pagina: pagina('pendente', ['e']) });
    t.maquina.reler();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(t.maquina.estado().fase).toBe('pronto');
    expect(t.maquina.estado().erro).toBeNull();
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('um gesto no meio vence: "Carregar mais" durante a releitura descarta a releitura', async () => {
    const t = await comDuasPaginas();
    t.responde('pendente', null, { atraso: 50, pagina: pagina('pendente', ['x'], null) });
    t.responde('pendente', 'c2', { atraso: 10, pagina: pagina('pendente', ['e']) });
    t.maquina.reler();
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(60);
    expect(t.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('com um pedido no ar ou um erro à vista, não relê', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 10, pagina: pagina('pendente', ['a'], 'c1') });
    t.maquina.abrir('pendente');
    t.maquina.reler(); // ainda carregando: nada
    expect(t.pedidos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    t.responde('pendente', 'c1', { atraso: 10, erro: new Error('caiu') });
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.maquina.estado().fase).toBe('erro-ao-carregar-mais');
    t.maquina.reler(); // erro à vista: o "Tentar de novo" é o caminho
    expect(t.pedidos).toHaveLength(2);
  });

  it('respeita o teto da restauração', async () => {
    const t = tela();
    t.responde('pendente', null, { atraso: 1, pagina: pagina('pendente', ['p0'], 'c1') });
    for (let i = 1; i < TETO_DA_RESTAURACAO + 3; i++) {
      t.responde('pendente', `c${i}`, { atraso: 1, pagina: pagina('pendente', [`p${i}`], `c${i + 1}`) });
    }
    t.maquina.abrir('pendente', { aba: 'pendente', paginas: TETO_DA_RESTAURACAO });
    await vi.advanceTimersByTimeAsync(50);
    t.maquina.carregarMais();
    await vi.advanceTimersByTimeAsync(5);
    expect(t.maquina.estado().paginas).toBe(TETO_DA_RESTAURACAO + 1);
    const pedidosAntes = t.pedidos.length;
    t.responde('pendente', null, { atraso: 1, pagina: pagina('pendente', ['p0'], 'c1') });
    for (let i = 1; i < TETO_DA_RESTAURACAO; i++) {
      t.responde('pendente', `c${i}`, { atraso: 1, pagina: pagina('pendente', [`p${i}`], `c${i + 1}`) });
    }
    t.maquina.reler();
    await vi.advanceTimersByTimeAsync(50);
    expect(t.pedidos.length - pedidosAntes).toBe(TETO_DA_RESTAURACAO);
    expect(t.maquina.estado().paginas).toBe(TETO_DA_RESTAURACAO);
  });
});
