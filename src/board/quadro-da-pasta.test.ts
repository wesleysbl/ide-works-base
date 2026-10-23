/**
 * O QUADRO DA PASTA, a regra — etapa F17.64.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO GUARDA
 *
 *   A decisão da etapa: a coluna é o NOME DA ETAPA, e a ordem é a MÉDIA de
 *   `sort_order` entre as listas que a têm. Os casos aqui são os de `TIME
 *   HELENA`, medidos em produção em 2026-09-03 como `ideworks_app`:
 *
 *     · 25 listas vivas, 24 esteiras, 345 linhas de etapa, 15 nomes;
 *     · 13 nomes nas 25 listas; `no radar` em 10; `a fazer foto` em 10;
 *     · a média separa as 15 numa sequência estritamente crescente.
 *
 *   O caminho completo — com política de linha de verdade e o banco de verdade
 *   — é `scripts/provar-quadro-da-pasta.mjs`. Aqui é a regra, isolada.
 *
 * ⚠️ NENHUM TESTE FIXA CENSO. Não há `= 25 listas` nem `= 458 tarefas`: a equipe
 * está usando o sistema, e asserção de contagem absoluta é a que fica verde
 * depois de parar de testar o que diz. O que se compara aqui é FORMA e ORDEM.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest';

import type { BoardTask } from '@/board/board';
import {
  type EtapaDaPasta,
  type TarefaDaPasta,
  chaveDaEtapa,
  colunasDaPasta,
  etapaQueFechaNaPasta,
  ordenarEtapas,
  orfasDaPasta,
  recusaDeEtapaAusente,
  resumoDaPasta,
  rotuloDeAbrangencia,
  statusParaMover,
} from '@/board/quadro-da-pasta';

/* ───────────────────────────── as peças de mentira ─────────────────────── */

const etapa = (p: Partial<EtapaDaPasta> & { key: string }): EtapaDaPasta => ({
  name: p.key,
  type: 'unstarted',
  color: null,
  lists: 1,
  ordem: 0,
  statusByList: {},
  ...p,
});

const base: BoardTask = {
  id: 't0',
  title: 'tarefa',
  statusId: null,
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

const tarefa = (p: Partial<TarefaDaPasta> & { id: string }): TarefaDaPasta => ({
  ...base,
  listId: 'l1',
  listName: 'Valentini',
  columnKey: null,
  ...p,
});

/* ───────────────────────────── a chave ───────────────────────────── */

describe('a chave da coluna', () => {
  it('é o nome sem espaço nas pontas e em minúscula', () => {
    expect(chaveDaEtapa('  A FAZER ARTE ')).toBe('a fazer arte');
  });

  it('junta o que a equipe escreveu de dois jeitos', () => {
    // Vinte e cinco esteiras copiadas à mão: `A Fazer Arte` e `A FAZER ARTE`
    // são a MESMA etapa para quem trabalha, e seriam duas colunas para quem
    // compara texto cru.
    expect(chaveDaEtapa('A Fazer Arte')).toBe(chaveDaEtapa('A FAZER ARTE'));
  });
});

/* ───────────────────────────── a ordem ───────────────────────────── */

describe('a ordem das colunas', () => {
  it('é a média de `sort_order`, e ela reproduz a esteira de TIME HELENA', () => {
    /* As médias medidas em produção, embaralhadas na entrada de propósito: se
       a ordenação sumisse, a saída sairia na ordem em que veio. */
    const medidas: Array<[string, number]> = [
      ['em andamento', 5.8],
      ['a fazer', 0.4],
      ['demanda concluída', 12.8],
      ['no radar', 0.0],
      ['a fazer foto', 3.0],
      ['a fazer arte', 2.4],
      ['atribuir demanda', 3.8],
      ['a fazer video', 1.4],
      ['stand-by', 4.8],
    ];

    const saida = ordenarEtapas(medidas.map(([key, ordem]) => etapa({ key, ordem })));

    expect(saida.map((e) => e.key)).toEqual([
      'no radar',
      'a fazer',
      'a fazer video',
      'a fazer arte',
      'a fazer foto',
      'atribuir demanda',
      'stand-by',
      'em andamento',
      'demanda concluída',
    ]);
  });

  it('põe `no radar` ANTES de `a fazer`, que é o que o menor `sort_order` não conseguiria', () => {
    /* ⚠️ ESTE É O CASO QUE DESCARTA AS ALTERNATIVAS. Pelo MENOR `sort_order` os
       dois empatam em 0 — `no radar` é 0 nas dez listas que o têm, e `a fazer`
       é 0 nas quinze que não têm. A média desempata porque usa as 25 opiniões. */
    const saida = ordenarEtapas([
      etapa({ key: 'a fazer', ordem: 0.4 }),
      etapa({ key: 'no radar', ordem: 0 }),
    ]);
    expect(saida.map((e) => e.key)).toEqual(['no radar', 'a fazer']);
  });

  it('desempata pelo nome quando duas médias são iguais', () => {
    // Sem desempate, a ordem seria a que o banco devolveu — ou seja, sorteada.
    const saida = ordenarEtapas([
      etapa({ key: 'revisão', ordem: 3 }),
      etapa({ key: 'aprovação', ordem: 3 }),
    ]);
    expect(saida.map((e) => e.key)).toEqual(['aprovação', 'revisão']);
  });

  it('não mexe no array que recebeu', () => {
    const entrada = [etapa({ key: 'b', ordem: 2 }), etapa({ key: 'a', ordem: 1 })];
    ordenarEtapas(entrada);
    expect(entrada.map((e) => e.key)).toEqual(['b', 'a']);
  });
});

/* ───────────────────────────── as colunas ───────────────────────────── */

describe('as colunas da pasta', () => {
  const etapas = [
    etapa({ key: 'a fazer arte', name: 'A FAZER ARTE', ordem: 2.4, lists: 25 }),
    etapa({ key: 'aprovação', name: 'APROVAÇÃO', ordem: 6.8, lists: 25 }),
  ];

  it('junta as tarefas de listas DIFERENTES na mesma coluna — é o pedido da etapa', () => {
    const colunas = colunasDaPasta(etapas, [
      tarefa({ id: 't1', listId: 'l1', listName: 'Valentini', columnKey: 'a fazer arte' }),
      tarefa({ id: 't2', listId: 'l2', listName: 'Clinimax', columnKey: 'a fazer arte' }),
      tarefa({ id: 't3', listId: 'l3', listName: 'DXI', columnKey: 'aprovação' }),
    ]);

    expect(colunas[0].tasks.map((t) => t.listName)).toEqual(['Valentini', 'Clinimax']);
    expect(colunas[1].tasks.map((t) => t.listName)).toEqual(['DXI']);
  });

  it('a coluna vazia FICA', () => {
    // Esconder a coluna sem cartão mudaria o desenho da esteira conforme o dia.
    const colunas = colunasDaPasta(etapas, []);
    expect(colunas.map((c) => c.etapa.key)).toEqual(['a fazer arte', 'aprovação']);
  });

  it('o total é o do banco, e não o dos cartões que chegaram — a janela da F17.50', () => {
    const colunas = colunasDaPasta(
      etapas,
      [tarefa({ id: 't1', columnKey: 'a fazer arte' })],
      { 'a fazer arte': 133, aprovação: 40 },
      { 'a fazer arte': 133, aprovação: 40 },
    );
    expect(colunas[0].total).toBe(133);
    expect(colunas[0].matched).toBe(133);
  });

  it('o total nunca fica abaixo do que está à vista — a guarda do arrasto', () => {
    /* Arrastar acrescenta cartão aqui sem falar com o servidor: a conta velha
       não pode dizer `0` sobre uma coluna com um cartão dentro. */
    const colunas = colunasDaPasta(
      etapas,
      [
        tarefa({ id: 't1', columnKey: 'aprovação' }),
        tarefa({ id: 't2', columnKey: 'aprovação' }),
      ],
      { aprovação: 0 },
      { aprovação: 0 },
    );
    expect(colunas[1].total).toBe(2);
    expect(colunas[1].matched).toBe(2);
  });

  it('com filtro, a coluna sabe dizer os DOIS números', () => {
    const colunas = colunasDaPasta(etapas, [], { 'a fazer arte': 133 }, { 'a fazer arte': 4 });
    expect(colunas[0].total).toBe(133);
    expect(colunas[0].matched).toBe(4);
  });
});

/* ───────────────────────────── a etapa que só alguns têm ───────────────── */

describe('a etapa que existe numa lista e não em outra', () => {
  const noRadar = etapa({
    key: 'no radar',
    name: 'NO RADAR',
    ordem: 0,
    lists: 10,
    statusByList: { l1: 's-l1-radar' },
  });

  it('a coluna aparece com as tarefas de quem a tem', () => {
    const colunas = colunasDaPasta(
      [noRadar],
      [tarefa({ id: 't1', listId: 'l1', columnKey: 'no radar' })],
    );
    expect(colunas[0].tasks).toHaveLength(1);
  });

  it('o destino do arrasto é o status DAQUELA lista', () => {
    expect(statusParaMover(noRadar, 'l1')).toBe('s-l1-radar');
  });

  it('a lista que não tem a etapa não tem destino — e a recusa nomeia as duas', () => {
    expect(statusParaMover(noRadar, 'l2')).toBeNull();

    const frase = recusaDeEtapaAusente('Clinimax', 'NO RADAR');
    expect(frase).toContain('Clinimax');
    expect(frase).toContain('NO RADAR');
    // E diz o que fazer, em vez de só dizer que não deu.
    expect(frase).toContain('···');
  });

  it('a coluna DIZ em quantas listas ela existe — mas só quando não são todas', () => {
    expect(rotuloDeAbrangencia(noRadar, 25)).toBe('10 de 25 listas');
    // Escrever `25 de 25` nas treze colunas cheias seria ruído.
    expect(rotuloDeAbrangencia(etapa({ key: 'a fazer', lists: 25 }), 25)).toBeNull();
    // Pasta de uma lista só não tem o que comparar.
    expect(rotuloDeAbrangencia(etapa({ key: 'a fazer', lists: 1 }), 1)).toBeNull();
  });
});

/* ───────────────────────────── o ✓ de concluir ───────────────────────────── */

describe('o ✓ de concluir no quadro da pasta', () => {
  const aFazer = etapa({ key: 'a fazer', type: 'open', ordem: 1, statusByList: { l1: 's-l1-fazer', l2: 's-l2-fazer' } });
  const concluida = etapa({
    key: 'demanda concluída',
    name: 'DEMANDA CONCLUÍDA',
    type: 'closed',
    ordem: 9,
    statusByList: { l1: 's-l1-fim', l2: 's-l2-fim' },
  });
  const soNaL1 = etapa({ key: 'arquivada', type: 'closed', ordem: 10, statusByList: { l1: 's-l1-arq' } });

  it('leva a tarefa para a etapa que fecha, a da lista DELA', () => {
    const e = etapaQueFechaNaPasta([aFazer, concluida], { listId: 'l2', columnKey: 'a fazer' });
    expect(e?.key).toBe('demanda concluída');
    // O que o banco recebe é o status daquela lista, não o de outra.
    expect(statusParaMover(e as EtapaDaPasta, 'l2')).toBe('s-l2-fim');
  });

  it('não há ✓ para a tarefa que já está numa etapa que fecha', () => {
    expect(etapaQueFechaNaPasta([aFazer, concluida], { listId: 'l1', columnKey: 'demanda concluída' })).toBeNull();
  });

  it('não há ✓ quando a lista da tarefa não tem etapa que feche', () => {
    const semFim = etapa({ key: 'fim', type: 'closed', statusByList: { l1: 's-l1-fim' } });
    expect(etapaQueFechaNaPasta([aFazer, semFim], { listId: 'l2', columnKey: 'a fazer' })).toBeNull();
  });

  it('não há ✓ quando nenhuma etapa da pasta fecha', () => {
    expect(etapaQueFechaNaPasta([aFazer], { listId: 'l1', columnKey: 'a fazer' })).toBeNull();
  });

  it('com mais de uma etapa que fecha, vale a última da esteira que a lista tem', () => {
    expect(etapaQueFechaNaPasta([aFazer, concluida, soNaL1], { listId: 'l1', columnKey: 'a fazer' })?.key).toBe('arquivada');
    expect(etapaQueFechaNaPasta([aFazer, concluida, soNaL1], { listId: 'l2', columnKey: 'a fazer' })?.key).toBe('demanda concluída');
  });

  it('tarefa órfã (sem coluna) também pode ser concluída', () => {
    expect(etapaQueFechaNaPasta([aFazer, concluida], { listId: 'l1', columnKey: null })?.key).toBe('demanda concluída');
  });
});

/* ───────────────────────────── as órfãs ───────────────────────────── */

describe('a tarefa fora de toda coluna', () => {
  it('não some — a tela diz que ela existe', () => {
    const etapas = [etapa({ key: 'a fazer' })];
    const orfas = orfasDaPasta(etapas, [
      tarefa({ id: 't1', columnKey: 'a fazer' }),
      tarefa({ id: 't2', columnKey: null }),
      tarefa({ id: 't3', columnKey: 'etapa de outra esteira' }),
    ]);
    expect(orfas.map((t) => t.id)).toEqual(['t2', 't3']);
  });
});

/* ───────────────────────────── o resumo ───────────────────────────── */

describe('o resumo da pasta', () => {
  const etapas = [
    etapa({ key: 'a fazer', ordem: 0, type: 'unstarted' }),
    etapa({ key: 'demanda concluída', ordem: 12.8, type: 'closed' }),
  ];

  it('conta a pasta INTEIRA, e não a janela', () => {
    const r = resumoDaPasta({
      etapas,
      tasks: [tarefa({ id: 't1', columnKey: 'a fazer' })],
      columnTotals: { 'a fazer': 133, 'demanda concluída': 325 },
    });
    expect(r).toEqual({ total: 458, open: 133, done: 325 });
  });

  it('`concluídas` é a coluna que FECHA — a mesma definição do gatilho', () => {
    const r = resumoDaPasta({
      etapas,
      tasks: [],
      columnTotals: { 'a fazer': 0, 'demanda concluída': 7 },
    });
    expect(r.done).toBe(7);
  });

  it('a órfã entra no total, porque ela é trabalho', () => {
    const r = resumoDaPasta({
      etapas,
      tasks: [tarefa({ id: 't9', columnKey: null })],
      columnTotals: { 'a fazer': 1, 'demanda concluída': 0 },
    });
    expect(r.total).toBe(2);
  });

  it('o filtrado sai da MESMA construção, sobre o mapa irmão', () => {
    const quadro = {
      etapas,
      tasks: [],
      columnTotals: { 'a fazer': 133, 'demanda concluída': 325 },
      columnMatched: { 'a fazer': 4, 'demanda concluída': 2 },
    };
    expect(resumoDaPasta(quadro, 'todas').total).toBe(458);
    expect(resumoDaPasta(quadro, 'achadas').total).toBe(6);
  });
});
