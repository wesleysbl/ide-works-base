/**
 * O miolo das escritas da tela, reaproveitável dentro de uma transação — F26.3.
 *
 * A suíte não fala com o banco (F0.4). O dublê é o mesmo de
 * `board-anexos.test.ts` e `mudanca-de-lista.test.ts`: um `tx` que anota cada
 * consulta e um `sql.begin` que conta quantas transações se abriram.
 *
 * O que se prova aqui, para cada escrita (criar, salvar e concluir tarefa;
 * criar e editar nota; criar e editar registro do histórico):
 *
 *   1. o miolo `…InTx` escreve no `Tx` que recebeu e NÃO abre transação —
 *      é o que deixa o agente (F26.5/F26.6) chamá-lo de dentro do `mutate` do
 *      registro sem uma segunda transação fora do ledger;
 *   2. o invólucro da tela abre exatamente UMA transação e passa como autor a
 *      pessoa logada;
 *   3. o autor de `complete_task` e de `created_by` é o parâmetro de quem
 *      chama, e não outra coisa;
 *   4. a recusa do banco sai traduzida DO MIOLO, para o agente também receber
 *      frase legível.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { NewTask } from '@/board/ficha';
import { BoardRefused, TypeRequired } from '@/server/board';
import {
  FRASE_SUBTAREFA_NAO_SAI_SOZINHA,
  createBoardTask,
  createBoardTaskInTx,
  patchBoardTaskInTx,
  setBoardTaskCompleted,
  setBoardTaskCompletedInTx,
} from '@/server/board-task';
import type { Sql, Tx } from '@/server/db';
import { HistoryRefused, createEvent, createEventInTx, updateEventInTx } from '@/server/history';
import {
  MuralRefused,
  createCaptacao,
  createNota,
  createNotaInTx,
  updateNotaInTx,
} from '@/server/mural-e-captacao';
import type { AuthenticatedActor } from '@/server/session';

const actor: AuthenticatedActor = {
  userId: 'pessoa-logada',
  email: 'teste@example.invalid',
  papel: 'funcionario',
  isSuperadmin: false,
  isSuper: false,
  areas: ['quadro'],
  hasAllClientsAccess: false,
};

type Consulta = { query: string; values: unknown[] };

/**
 * `responder` decide o que cada consulta devolve. Consulta que ele não conhece
 * é erro da prova, e não vazio — vazio esconderia uma consulta a mais.
 */
function cenario(responder: (query: string, values: unknown[]) => unknown[] | Error) {
  const consultas: Consulta[] = [];
  let beginCount = 0;
  const tx = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?');
    // Fragmento da regra do cliente da tarefa (F38, Fase 6): no driver ele
    // não roda sozinho — só dentro da consulta que o recebe. Aqui o dublê
    // executa toda chamada, então o fragmento é reconhecido e devolvido vazio.
    if (query.trimStart().startsWith('coalesce(t.client_id')) return [];
    if (query.includes('set_config')) {
      consultas.push({ query: 'set_config', values });
      return [];
    }
    consultas.push({ query, values });
    const r = responder(query, values);
    if (r instanceof Error) throw r;
    return r;
  };
  const sql = {
    begin: (work: (connection: Tx) => Promise<unknown>) => {
      beginCount += 1;
      return work(tx as unknown as Tx);
    },
  } as unknown as Sql;
  return {
    sql,
    tx: tx as unknown as Tx,
    consultas,
    beginCount: () => beginCount,
    /** Só o que foi escrito, sem o `set_config` da abertura. */
    escritas: () => consultas.filter((c) => c.query !== 'set_config'),
  };
}

/** O erro como o driver do Postgres entrega: código e mensagem do gatilho. */
function erroDoBanco(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const qual = (query: string): string => {
  for (const nome of [
    'from ideworks.lists l',
    'insert into ideworks.tasks',
    'update ideworks.tasks',
    'set_task_assignees',
    'set_task_watchers',
    'set_task_tags',
    'select list_id from ideworks.tasks',
    'ideworks.move_task',
    'list_is_production',
    'ideworks.complete_task',
    'ideworks.uncomplete_task',
    'insert into ideworks.mural_notes',
    'update ideworks.mural_notes',
    'insert into ideworks.client_history',
    'update ideworks.client_history',
  ]) {
    if (query.includes(nome)) return nome;
  }
  return query;
};

const tarefaNova = (extra: Partial<NewTask> = {}): NewTask => ({
  title: '  Arte do post  ',
  description: null,
  dueOn: null,
  startOn: null,
  priority: null,
  statusId: null,
  customItemId: null,
  assigneeIds: ['p1'],
  tagIds: ['g1'],
  // F40: com tipo, a criação nem consulta se a lista é de produção.
  type: 'arte',
  ...extra,
});

/* ─────────────────────────── tarefa ─────────────────────────── */

/** A lista de destino, como `decidirClienteNoTx` a lê (F38, Fase 6). */
const LISTA_INTERNA = { client_id: null, requires_client: false, company_id: 'e1' };
const criacao = (lista: Record<string, unknown> = LISTA_INTERNA) => (q: string) => {
  if (q.includes('from ideworks.lists l')) return [lista];
  if (q.includes('insert into ideworks.tasks')) return [{ id: 't-nova' }];
  return [];
};

describe('createBoardTaskInTx participa da transação já aberta', () => {
  it('insere, atribui e etiqueta no Tx recebido, sem begin, com o autor passado', async () => {
    const { tx, escritas, beginCount } = cenario(criacao());
    const id = await createBoardTaskInTx(tx, 'lista-1', tarefaNova(), 'dono-da-concessao');

    expect(id).toBe('t-nova');
    expect(beginCount()).toBe(0);
    expect(escritas().map((c) => qual(c.query))).toEqual([
      'from ideworks.lists l',
      'insert into ideworks.tasks',
      'set_task_assignees',
      'set_task_tags',
    ]);
    const insert = escritas()[1].values;
    expect(insert[0]).toBe('lista-1');
    // F38, Fase 6: lista interna e nenhum cliente escolhido → nulo.
    expect(insert[1]).toBeNull();
    expect(insert[2]).toBe('Arte do post');
    // `created_by` é o penúltimo valor do insert (o último é o tipo, F40): o autor que quem chamou passou.
    expect(insert.at(-2)).toBe('dono-da-concessao');
  });

  it('lista fora do alcance (insert sem linha) recusa com BoardRefused 403', async () => {
    const { tx } = cenario((q) => (q.includes('from ideworks.lists l') ? [LISTA_INTERNA] : []));
    await expect(createBoardTaskInTx(tx, 'lista-1', tarefaNova(), 'u')).rejects.toMatchObject({
      name: 'BoardRefused',
      status: 403,
    });
  });

  it('lista que a pessoa não enxerga recusa com 403 antes do insert', async () => {
    const { tx, escritas } = cenario(() => []);
    await expect(createBoardTaskInTx(tx, 'lista-1', tarefaNova(), 'u')).rejects.toMatchObject({
      name: 'BoardRefused',
      status: 403,
    });
    expect(escritas().map((c) => qual(c.query))).toEqual(['from ideworks.lists l']);
  });

  it('título em branco recusa no miolo, antes de qualquer consulta', async () => {
    const { tx, consultas } = cenario(() => []);
    await expect(
      createBoardTaskInTx(tx, 'lista-1', tarefaNova({ title: '   ' }), 'u'),
    ).rejects.toBeInstanceOf(BoardRefused);
    expect(consultas).toEqual([]);
  });
});

describe('createBoardTask (tela) = withActor + miolo', () => {
  it('abre uma transação e grava como autor a pessoa logada', async () => {
    const { sql, consultas, escritas, beginCount } = cenario(criacao());
    const id = await createBoardTask(sql, actor, 'lista-1', tarefaNova());

    expect(id).toBe('t-nova');
    expect(beginCount()).toBe(1);
    expect(consultas[0].query).toBe('set_config');
    expect(escritas()[1].values.at(-2)).toBe('pessoa-logada');
  });

  it('título em branco recusa sem abrir transação', async () => {
    const { sql, beginCount } = cenario(() => []);
    await expect(createBoardTask(sql, actor, 'lista-1', tarefaNova({ title: '' }))).rejects.toMatchObject({
      status: 400,
      message: 'A tarefa precisa de um título.',
    });
    expect(beginCount()).toBe(0);
  });
});

describe('F40 — o tipo da tarefa na criação e na edição', () => {
  const emProducao = (lista: Record<string, unknown> = LISTA_INTERNA) => (q: string) => {
    if (q.includes('list_is_production')) return [{ producao: true }];
    return criacao(lista)(q);
  };

  it('cria com tipo: grava demand_type e não consulta a lista', async () => {
    const { tx, escritas } = cenario(criacao());
    await createBoardTaskInTx(tx, 'lista-1', tarefaNova({ type: 'video' }), 'u');
    const insert = escritas().find((c) => c.query.includes('insert into ideworks.tasks'));
    expect(insert?.values).toContain('video');
    expect(escritas().some((c) => c.query.includes('list_is_production'))).toBe(false);
  });

  it('sem tipo em lista de produção: type_required com as quatro opções, e nada é inserido', async () => {
    const { tx, escritas } = cenario(emProducao());
    const erro = await createBoardTaskInTx(tx, 'lista-1', tarefaNova({ type: null }), 'u').catch((e) => e);
    expect(erro).toBeInstanceOf(TypeRequired);
    expect(erro).toBeInstanceOf(BoardRefused);
    expect(erro.status).toBe(400);
    expect(erro.code).toBe('type_required');
    expect(erro.message).toBe('Escolha o tipo: Vídeo, Arte, Foto ou Outros');
    expect(erro.options).toEqual([
      { value: 'video', label: 'Vídeo' },
      { value: 'arte', label: 'Arte' },
      { value: 'foto', label: 'Foto' },
      { value: 'outros', label: 'Outros' },
    ]);
    expect(escritas().some((c) => c.query.includes('insert into ideworks.tasks'))).toBe(false);
  });

  it('o campo ausente (undefined) conta como sem tipo', async () => {
    const { tx } = cenario(emProducao());
    const { type: _t, ...semCampo } = tarefaNova();
    void _t;
    await expect(createBoardTaskInTx(tx, 'lista-1', semCampo, 'u')).rejects.toBeInstanceOf(TypeRequired);
  });

  it('sem tipo em lista interna: cria, com tipo nulo; a lista é consultada uma vez', async () => {
    const { tx, escritas } = cenario(criacao());
    await createBoardTaskInTx(tx, 'lista-1', tarefaNova({ type: null }), 'u');
    expect(escritas().filter((c) => c.query.includes('list_is_production'))).toHaveLength(1);
    const insert = escritas().find((c) => c.query.includes('insert into ideworks.tasks'));
    expect(insert?.values).toContain(null);
  });

  it('valor de tipo inválido é recusado em português, sem ir ao banco', async () => {
    const { tx, escritas } = cenario(criacao());
    await expect(
      createBoardTaskInTx(tx, 'lista-1', tarefaNova({ type: 'banner' as never }), 'u'),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Tipo inválido') });
    expect(escritas().some((c) => c.query.includes('insert into ideworks.tasks'))).toBe(false);
  });

  it('IW040 do gatilho vira type_required (rede de segurança)', async () => {
    const { tx } = cenario((q) =>
      q.includes('insert into ideworks.tasks')
        ? erroDoBanco('IW040', 'Esta lista é de produção')
        : criacao()(q),
    );
    const erro = await createBoardTaskInTx(tx, 'lista-1', tarefaNova(), 'u').catch((e) => e);
    expect(erro).toBeInstanceOf(TypeRequired);
    expect(erro.code).toBe('type_required');
  });

  it('editar: trocar o tipo grava e não consulta a lista', async () => {
    const { tx, escritas } = cenario((q) => (q.includes('update ideworks.tasks') ? [{ id: 't1' }] : []));
    await patchBoardTaskInTx(tx, 't1', { type: 'foto' });
    const up = escritas().find((c) => c.query.includes('update ideworks.tasks'));
    expect(up?.values).toContain('foto');
    expect(escritas().some((c) => c.query.includes('list_is_production'))).toBe(false);
  });

  it('editar: apagar o tipo em lista de produção é recusado, e nada é gravado', async () => {
    const { tx, escritas } = cenario((q) =>
      q.includes('list_is_production') ? [{ tinha_tipo: true, producao: true }] : [{ id: 't1' }],
    );
    await expect(patchBoardTaskInTx(tx, 't1', { type: null })).rejects.toBeInstanceOf(TypeRequired);
    expect(escritas().some((c) => c.query.includes('update ideworks.tasks'))).toBe(false);
  });

  it('editar: apagar o tipo em lista interna, ou card que já não tinha tipo, passa', async () => {
    for (const lida of [
      { tinha_tipo: true, producao: false },
      { tinha_tipo: false, producao: true },
    ]) {
      const { tx, escritas } = cenario((q) =>
        q.includes('list_is_production') ? [lida] : q.includes('update ideworks.tasks') ? [{ id: 't1' }] : [],
      );
      await patchBoardTaskInTx(tx, 't1', { type: null });
      expect(escritas().some((c) => c.query.includes('update ideworks.tasks'))).toBe(true);
    }
  });

  it('editar sem mexer no tipo: zero consulta a mais', async () => {
    const { tx, escritas } = cenario((q) => (q.includes('update ideworks.tasks') ? [{ id: 't1' }] : []));
    await patchBoardTaskInTx(tx, 't1', { priority: 'high' });
    expect(escritas().map((c) => qual(c.query))).toEqual(['update ideworks.tasks']);
  });

  it('editar: tipo inválido é recusado', async () => {
    const { tx } = cenario(() => []);
    await expect(patchBoardTaskInTx(tx, 't1', { type: 'x' as never })).rejects.toMatchObject({ status: 400 });
  });
});

describe('patchBoardTaskInTx participa da transação já aberta', () => {
  it('campos, três listas e status, nesta ordem, sem begin e sem reler a ficha', async () => {
    const { tx, escritas, beginCount } = cenario((q) => {
      if (q.includes('update ideworks.tasks')) return [{ id: 't1' }];
      if (q.includes('select list_id from ideworks.tasks')) return [{ list_id: 'lista-1' }];
      return [];
    });
    await patchBoardTaskInTx(tx, 't1', {
      dueOn: '2026-10-01',
      assigneeIds: ['p1', 'p2'],
      watcherIds: [],
      tagIds: ['g1'],
      statusId: 'st-fecha',
    });

    expect(beginCount()).toBe(0);
    // Nenhuma consulta de `lerFicha` aqui: a releitura é do invólucro da tela.
    expect(escritas().map((c) => qual(c.query))).toEqual([
      'update ideworks.tasks',
      'set_task_assignees',
      'set_task_watchers',
      'set_task_tags',
      'select list_id from ideworks.tasks',
      'ideworks.move_task',
    ]);
    // Lista vazia vira nulo — é assim que `set_task_watchers` entende "tirar todos".
    expect(escritas()[2].values).toEqual(['t1', null]);
    expect(escritas()[5].values).toEqual(['t1', 'lista-1', 'st-fecha']);
  });

  it('tarefa fora do alcance recusa com BoardRefused 404', async () => {
    const { tx } = cenario(() => []);
    await expect(patchBoardTaskInTx(tx, 't1', { priority: 'high' })).rejects.toMatchObject({
      name: 'BoardRefused',
      status: 404,
    });
  });

  it('a recusa do banco sai traduzida do miolo', async () => {
    const { tx } = cenario(() => erroDoBanco('22007', 'invalid input syntax for type date'));
    await expect(patchBoardTaskInTx(tx, 't1', { dueOn: 'ontem' })).rejects.toMatchObject({
      name: 'BoardRefused',
      status: 400,
      message: 'Data inválida.',
    });
  });
});

describe('setBoardTaskCompletedInTx: o autor é o parâmetro de quem chama', () => {
  it('concluir passa o autor recebido a complete_task, sem begin', async () => {
    const { tx, escritas, beginCount } = cenario(() => []);
    await setBoardTaskCompletedInTx(tx, 't1', true, 'dono-da-concessao');

    expect(beginCount()).toBe(0);
    expect(escritas()).toHaveLength(1);
    expect(qual(escritas()[0].query)).toBe('ideworks.complete_task');
    expect(escritas()[0].values).toEqual(['t1', 'dono-da-concessao']);
  });

  it('reabrir não leva autor', async () => {
    const { tx, escritas } = cenario(() => []);
    await setBoardTaskCompletedInTx(tx, 't1', false, 'dono-da-concessao');

    expect(qual(escritas()[0].query)).toBe('ideworks.uncomplete_task');
    expect(escritas()[0].values).toEqual(['t1']);
  });

  it('fora do alcance sai como BoardRefused 403 do próprio miolo', async () => {
    const { tx } = cenario(() =>
      erroDoBanco('42501', 'tarefa nao encontrada ou fora do seu alcance'),
    );
    await expect(setBoardTaskCompletedInTx(tx, 't1', true, 'u')).rejects.toMatchObject({
      name: 'BoardRefused',
      status: 403,
    });
  });

  it('F44 Fase 8: a regra que tiraria a SUBTAREFA da lista da mãe sai como frase, e não como o nome da restrição', async () => {
    const { tx } = cenario(() =>
      Object.assign(
        erroDoBanco('23503', 'insert or update on table "tasks" violates foreign key constraint "tasks_parent_same_list_fk"'),
        { constraint_name: 'tasks_parent_same_list_fk' },
      ),
    );
    const erro = await setBoardTaskCompletedInTx(tx, 't1', true, 'u').catch((e) => e);
    expect(erro).toBeInstanceOf(BoardRefused);
    expect(erro).toMatchObject({ status: 400, message: FRASE_SUBTAREFA_NAO_SAI_SOZINHA });
    expect(erro.message).not.toMatch(/tasks_parent_same_list_fk|constraint/);
  });

  it('a tela passa a pessoa logada, numa transação só, e a releitura continua traduzida', async () => {
    // A releitura (`lerFicha`) não é o assunto: o dublê a recusa com 42501, e
    // a prova é que a recusa chega à tela como antes — `BoardRefused` 403.
    const { sql, escritas, beginCount } = cenario((q) =>
      q.includes('complete_task') ? [] : erroDoBanco('42501', 'fora do seu alcance'),
    );
    await expect(setBoardTaskCompleted(sql, actor, 't1', true)).rejects.toMatchObject({
      name: 'BoardRefused',
      status: 403,
    });
    expect(beginCount()).toBe(1);
    expect(escritas()[0].values).toEqual(['t1', 'pessoa-logada']);
  });
});

/* ─────────────────────────── mural ─────────────────────────── */

describe('createNotaInTx / updateNotaInTx participam da transação já aberta', () => {
  it('criar grava no Tx recebido, sem begin, com o autor passado', async () => {
    const { tx, escritas, beginCount } = cenario(() => [{ id: 'n1' }]);
    const id = await createNotaInTx(tx, 'cliente-1', { content: ' reunião ', color: 'blue' }, 'dono');

    expect(id).toBe('n1');
    expect(beginCount()).toBe(0);
    expect(escritas()).toHaveLength(1);
    expect(qual(escritas()[0].query)).toBe('insert into ideworks.mural_notes');
    expect(escritas()[0].values).toEqual(['cliente-1', null, 'reunião', 'blue', 0, 0, 'dono']);
  });

  it('conteúdo em branco recusa no miolo, antes de qualquer consulta', async () => {
    const { tx, consultas } = cenario(() => [{ id: 'n1' }]);
    await expect(createNotaInTx(tx, 'cliente-1', { content: '  ' }, 'u')).rejects.toBeInstanceOf(
      MuralRefused,
    );
    expect(consultas).toEqual([]);
  });

  it('editar a nota de outra pessoa pela IA: a frase do gatilho sai como MuralRefused 403', async () => {
    const frase =
      'A IA só edita ou apaga notas do mural que ela mesma escreveu em seu nome. Esta nota foi escrita por uma pessoa ou pela IA de outra pessoa; quem quiser mudá-la muda pela tela.';
    const { tx, beginCount } = cenario(() => erroDoBanco('42501', frase));
    await expect(updateNotaInTx(tx, 'n1', { content: 'novo' })).rejects.toMatchObject({
      name: 'MuralRefused',
      status: 403,
      message: frase,
    });
    expect(beginCount()).toBe(0);
  });

  it('editar nota que não aparece recusa com 404', async () => {
    const { tx } = cenario(() => []);
    await expect(updateNotaInTx(tx, 'n1', { positionX: 3 })).rejects.toMatchObject({
      name: 'MuralRefused',
      status: 404,
    });
  });

  it('mover a nota grava INTEIROS: a medida do navegador tem fração e a coluna é `integer`', async () => {
    // Arrastar a nota até a borda direita do quadro manda `larguraDoQuadro -
    // larguraDaNota` com a fração do `getBoundingClientRect`; o Postgres recusa
    // "803.5" para `integer` e a pessoa ouvia "Não foi possível mover a nota".
    const { tx, escritas } = cenario(() => [{ id: 'n1' }]);
    await updateNotaInTx(tx, 'n1', { positionX: 803.5, positionY: 10.2, width: 220.4, height: 180.6 });
    const valores = escritas()[0].values;
    expect(valores).toContain(804);
    expect(valores).toContain(10);
    expect(valores).toContain(220);
    expect(valores).toContain(181);
    expect(valores.filter((v) => typeof v === 'number' && !Number.isInteger(v))).toEqual([]);
  });

  it('posição que não é número recusa com 400, e não vai ao banco', async () => {
    const { tx, consultas } = cenario(() => [{ id: 'n1' }]);
    await expect(
      updateNotaInTx(tx, 'n1', { positionX: 'esquerda' as unknown as number }),
    ).rejects.toMatchObject({ name: 'MuralRefused', status: 400 });
    expect(consultas).toEqual([]);
  });

  it('gravação com data que não existe é 400 com a frase, e não o 500 do banco', async () => {
    const { sql } = cenario(() => erroDoBanco('22008', 'date/time field value out of range: "2026-02-30"'));
    await expect(
      createCaptacao(sql, actor, 'cliente-1', { recordedOn: '2026-02-30', videoCount: 1, status: 'recorded', kinds: [] }),
    ).rejects.toMatchObject({
      name: 'MuralRefused',
      status: 400,
      message: 'Esse dia não existe no calendário.',
    });
  });

  it('a tela abre uma transação e grava como autor a pessoa logada', async () => {
    const { sql, escritas, beginCount } = cenario(() => [{ id: 'n1' }]);
    await createNota(sql, actor, 'cliente-1', { content: 'ok' });
    expect(beginCount()).toBe(1);
    expect(escritas()[0].values.at(-1)).toBe('pessoa-logada');
  });
});

/* ─────────────────────────── histórico ─────────────────────────── */

const evento = {
  happenedOn: '2026-09-22',
  title: ' Reunião de pauta ',
  subtitle: '',
  body: 'Definimos a campanha.',
  ledBy: null,
  ledByNote: null,
};

describe('createEventInTx / updateEventInTx participam da transação já aberta', () => {
  it('criar grava no Tx recebido, sem begin, com o autor passado', async () => {
    const { tx, escritas, beginCount } = cenario(() => [{ id: 'h1' }]);
    const id = await createEventInTx(tx, 'cliente-1', evento, 'dono');

    expect(id).toBe('h1');
    expect(beginCount()).toBe(0);
    expect(qual(escritas()[0].query)).toBe('insert into ideworks.client_history');
    expect(escritas()[0].values).toEqual([
      'cliente-1',
      '2026-09-22',
      'Reunião de pauta',
      null,
      'Definimos a campanha.',
      null,
      null,
      'dono',
    ]);
  });

  it('evento sem relato recusa no miolo, antes de qualquer consulta', async () => {
    const { tx, consultas } = cenario(() => [{ id: 'h1' }]);
    await expect(createEventInTx(tx, 'cliente-1', { ...evento, body: ' ' }, 'u')).rejects.toBeInstanceOf(
      HistoryRefused,
    );
    expect(consultas).toEqual([]);
  });

  it('editar o registro de outra pessoa pela IA: a frase do gatilho sai como HistoryRefused 403', async () => {
    const frase =
      'A IA só edita ou apaga registros do histórico do cliente que ela mesma escreveu em seu nome.';
    const { tx, beginCount } = cenario(() => erroDoBanco('42501', frase));
    await expect(updateEventInTx(tx, 'h1', evento)).rejects.toMatchObject({
      name: 'HistoryRefused',
      status: 403,
      message: frase,
    });
    expect(beginCount()).toBe(0);
  });

  it('data que não existe (31 de fevereiro) é 400 com a frase, e não o 500 do banco', async () => {
    const { tx } = cenario(() => erroDoBanco('22008', 'date/time field value out of range: "2026-02-30"'));
    await expect(createEventInTx(tx, 'cliente-1', { ...evento, happenedOn: '2026-02-30' }, 'u')).rejects.toMatchObject({
      name: 'HistoryRefused',
      status: 400,
      message: 'Esse dia não existe no calendário.',
    });
    await expect(updateEventInTx(tx, 'h1', { ...evento, happenedOn: '2026-02-30' })).rejects.toMatchObject({
      name: 'HistoryRefused',
      status: 400,
    });
  });

  it('a tela abre uma transação e grava como autor a pessoa logada', async () => {
    const { sql, escritas, beginCount } = cenario(() => [{ id: 'h1' }]);
    await createEvent(sql, actor, 'cliente-1', evento);
    expect(beginCount()).toBe(1);
    expect(escritas()[0].values.at(-1)).toBe('pessoa-logada');
  });
});

/* ─────────────────── contrato: invólucro = withActor(miolo) ─────────────────── */

describe('contrato F26.3: o miolo não abre transação; o invólucro da tela chama o miolo', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  /** O corpo de uma função exportada, até a próxima função exportada. */
  function corpo(fonte: string, nome: string): string {
    const inicio = fonte.indexOf(`export async function ${nome}(`);
    expect(inicio, nome).toBeGreaterThanOrEqual(0);
    const fim = fonte.indexOf('export ', inicio + 1);
    return fonte.slice(inicio, fim === -1 ? undefined : fim);
  }

  const casos: Array<[arquivo: string, invólucro: string, miolo: string]> = [
    ['board-task.ts', 'createBoardTask', 'createBoardTaskInTx'],
    ['board-task.ts', 'patchBoardTask', 'patchBoardTaskInTx'],
    ['board-task.ts', 'setBoardTaskCompleted', 'setBoardTaskCompletedInTx'],
    ['mural-e-captacao.ts', 'createNota', 'createNotaInTx'],
    ['mural-e-captacao.ts', 'updateNota', 'updateNotaInTx'],
    ['history.ts', 'createEvent', 'createEventInTx'],
    ['history.ts', 'updateEvent', 'updateEventInTx'],
  ];

  it.each(casos)('%s: %s = withActor + %s', (arquivo, invólucro, miolo) => {
    const fonte = readFileSync(join(raiz, 'src', 'server', arquivo), 'utf8');
    const doMiolo = corpo(fonte, miolo);
    expect(doMiolo).not.toMatch(/\bwithActor\s*\(/);
    expect(doMiolo).not.toMatch(/\.begin\s*\(/);
    const doInvolucro = corpo(fonte, invólucro);
    expect(doInvolucro.match(/\bwithActor\s*\(/g)?.length).toBe(1);
    expect(doInvolucro).toContain(`${miolo}(tx,`);
  });
});
