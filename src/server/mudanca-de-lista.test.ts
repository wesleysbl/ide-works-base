import { describe, expect, it } from 'vitest';
import { BoardRefused, MoveNeedsStatus, TypeRequired, moveTaskOnBoard, moveTaskOnBoardInTx } from '@/server/board';
import type { Sql, Tx } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';

const actor: AuthenticatedActor = { userId: 'u1', email: 'teste@example.invalid', papel: 'funcionario',
  isSuperadmin: false, isSuper: false, areas: ['quadro'], hasAllClientsAccess: false };
const origin = { listId: 'origem', statusId: 'refacao-origem' };
const current = { list_id: origin.listId, status_id: origin.statusId, title: 'Card de teste' };
const option = { list_name: 'Blue Sky', id: 'aprovacao-destino', name: 'Aprovação', color: null,
  equivalent: false, old_name: 'Refação', old_color: null };

type Tarefa = typeof current & { demand_type?: string | null; parent_id?: string | null };

/** `producao`: as listas que o banco diria serem de produção (F40). */
function scenario({ task = current as Tarefa | null, options = [option], producao = [] as string[] } = {}) {
  const writes: unknown[][] = [];
  let beginCount = 0;
  const tx = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?');
    if (query.includes('set_config')) return [];
    if (query.includes('for update')) return task ? [task] : [];
    if (query.includes('list_is_production')) return [{ producao: producao.includes(String(values[0])) }];
    if (query.includes('join ideworks.statuses')) return options;
    if (query.includes('ideworks.move_task')) {
      writes.push(values);
      return [{ resultado: { task_id: 't1', list_id: 'destino', status_id: values[2],
        previous_status_id: origin.statusId, status_repositioned: true, subtasks_moved: 0, automation: null } }];
    }
    throw new Error('Consulta não prevista na prova');
  };
  const sql = {
    begin: (work: (connection: Tx) => Promise<unknown>) => {
      beginCount += 1;
      return work(tx as unknown as Tx);
    },
  } as unknown as Sql;
  return { sql, tx: tx as unknown as Tx, writes, beginCount: () => beginCount };
}

describe('mover de lista exige destino explícito quando a etapa não existe', () => {
  it('devolve as opções e o estado atual sem chamar a escrita', async () => {
    const { sql, writes } = scenario();
    const error = await moveTaskOnBoard(sql, actor, 't1', 'destino', null).catch(e => e);
    expect(error).toBeInstanceOf(MoveNeedsStatus);
    expect(error.status).toBe(409);
    expect(error.escolhaDeEtapa).toMatchObject({ taskId: 't1', listName: 'Blue Sky', origem: origin,
      etapaAtual: { name: 'Refação' }, etapas: [{ id: option.id, name: 'Aprovação' }] });
    expect(writes).toEqual([]);
  });

  it('etapa equivalente em outra lista é enviada pelo ID do destino', async () => {
    const { sql, writes } = scenario({ options: [{ ...option, id: 'refacao-destino', name: 'REFAÇÃO', equivalent: true }] });
    await moveTaskOnBoard(sql, actor, 't1', 'destino', null);
    expect(writes).toEqual([['t1', 'destino', 'refacao-destino']]);
  });

  it('confirmação válida escreve uma vez e não anuncia escolha da pessoa como reposicionamento automático', async () => {
    const { sql, writes } = scenario();
    const result = await moveTaskOnBoard(sql, actor, 't1', 'destino', option.id, origin);
    expect(writes).toEqual([['t1', 'destino', option.id]]);
    expect(result.statusRepositioned).toBe(false);
  });

  it('tarefa alterada durante a escolha exige nova confirmação', async () => {
    const { sql, writes } = scenario({ task: { ...current, status_id: 'nova-etapa' } });
    const error = await moveTaskOnBoard(sql, actor, 't1', 'destino', option.id, origin).catch(e => e);
    expect(error).toBeInstanceOf(MoveNeedsStatus);
    expect(error.escolhaDeEtapa.origem.statusId).toBe('nova-etapa');
    expect(error.message).toContain('A tarefa mudou');
    expect(writes).toEqual([]);
  });

  it('etapa removida da lista de destino exige nova escolha', async () => {
    const { sql, writes } = scenario();
    await expect(moveTaskOnBoard(sql, actor, 't1', 'destino', 'etapa-removida', origin)).rejects.toBeInstanceOf(MoveNeedsStatus);
    expect(writes).toEqual([]);
  });

  it('tarefa indisponível não revela etapas nem chama a escrita', async () => {
    const { sql, writes } = scenario({ task: null });
    await expect(moveTaskOnBoard(sql, actor, 't1', 'destino', null)).rejects.toMatchObject({ status: 403 });
    expect(writes).toEqual([]);
  });

  it('destino sem etapas acessíveis não oferece escolha falsa nem escreve', async () => {
    const { sql, writes } = scenario({ options: [] });
    await expect(moveTaskOnBoard(sql, actor, 't1', 'destino', null)).rejects.toBeInstanceOf(BoardRefused);
    expect(writes).toEqual([]);
  });

  it('movimento de coluna mantém o ID explicitamente escolhido', async () => {
    const { sql, writes } = scenario();
    await moveTaskOnBoard(sql, actor, 't1', 'origem', 'aprovacao-origem');
    expect(writes).toEqual([['t1', 'origem', 'aprovacao-origem']]);
  });
});

describe('F40 — mover para lista de produção sem tipo', () => {
  it('de lista interna para produção, sem tipo: type_required, e nada é escrito', async () => {
    const { sql, writes } = scenario({ producao: ['destino'] });
    const error = await moveTaskOnBoard(sql, actor, 't1', 'destino', option.id).catch(e => e);
    expect(error).toBeInstanceOf(TypeRequired);
    expect(error.code).toBe('type_required');
    expect(error.status).toBe(400);
    expect(error.message).toBe('Escolha o tipo: Vídeo, Arte, Foto ou Outros');
    expect(error.options.map((o: { value: string }) => o.value)).toEqual(['video', 'arte', 'foto', 'outros']);
    expect(writes).toEqual([]);
  });

  it('com tipo, move normalmente (e nem consulta a lista)', async () => {
    const { sql, writes } = scenario({ task: { ...current, demand_type: 'arte' }, producao: ['destino'] });
    await moveTaskOnBoard(sql, actor, 't1', 'destino', option.id);
    expect(writes).toEqual([['t1', 'destino', option.id]]);
  });

  it('entre duas listas de produção, card antigo sem tipo continua movendo', async () => {
    const { sql, writes } = scenario({ producao: ['origem', 'destino'] });
    await moveTaskOnBoard(sql, actor, 't1', 'destino', option.id);
    expect(writes).toHaveLength(1);
  });

  it('para lista interna, sem tipo, move', async () => {
    const { sql, writes } = scenario({ producao: [] });
    await moveTaskOnBoard(sql, actor, 't1', 'destino', option.id);
    expect(writes).toHaveLength(1);
  });

  it('subtarefa não exige tipo', async () => {
    const { sql, writes } = scenario({ task: { ...current, parent_id: 'mae' }, producao: ['destino'] });
    await moveTaskOnBoard(sql, actor, 't1', 'destino', option.id);
    expect(writes).toHaveLength(1);
  });

  it('IW040 do banco (automação dentro de move_task) vira type_required', async () => {
    const tx = async (parts: TemplateStringsArray) => {
      const q = parts.join('?');
      if (q.includes('set_config')) return [];
      if (q.includes('for update')) return [{ ...current, demand_type: 'arte' }];
      throw Object.assign(new Error('Esta lista é de produção'), { code: 'IW040', hint: 'type_required' });
    };
    const error = await moveTaskOnBoardInTx(tx as unknown as Tx, 't1', 'origem', option.id).catch(e => e);
    expect(error).toBeInstanceOf(TypeRequired);
    expect(error.code).toBe('type_required');
  });
});

describe('moveTaskOnBoardInTx participa da transação já aberta', () => {
  const equivalente = [{ ...option, id: 'refacao-destino', name: 'REFAÇÃO', equivalent: true }];

  it('não chama sql.begin nem withActor de novo', async () => {
    const { sql, tx, writes, beginCount } = scenario({ options: equivalente });
    await moveTaskOnBoardInTx(tx, 't1', 'destino', null);
    expect(beginCount()).toBe(0);
    expect(writes).toEqual([['t1', 'destino', 'refacao-destino']]);
    // O wrapper humano é que abre a transação — e abre uma só.
    await moveTaskOnBoard(sql, actor, 't1', 'destino', null);
    expect(beginCount()).toBe(1);
    expect(writes).toHaveLength(2);
  });

  it('MoveNeedsStatus continua sem escrever', async () => {
    const { tx, writes, beginCount } = scenario();
    const error = await moveTaskOnBoardInTx(tx, 't1', 'destino', null).catch(e => e);
    expect(error).toBeInstanceOf(MoveNeedsStatus);
    expect(error.status).toBe(409);
    expect(writes).toEqual([]);
    expect(beginCount()).toBe(0);
  });
});
