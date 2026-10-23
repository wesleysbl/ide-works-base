import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fraseDoAviso } from '@/board/avisos';
import {
  VALIDADE_DO_AVISO_DO_CONTROLE_MS,
  avisosDoControle,
  avisosDoControleGuardados,
  esquecerAvisosDoControle,
} from '@/server/avisos-do-controle';
import type { ControleDaSemana } from '@/server/controle-da-semana';
import type { Sql, Tx } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';

const lido = vi.hoisted(() => ({ semana: null as unknown, vistas: [] as string[] }));

vi.mock('@/server/db', () => ({
  withActor: (_sql: unknown, _actor: unknown, run: (tx: unknown) => unknown) => run(_sql),
}));
vi.mock('@/server/controle-da-semana', () => ({
  readControleDaSemana: vi.fn(async () => lido.semana),
}));

import { countUnreadNotices, readNotices } from '@/server/board-avisos';
import { readControleDaSemana } from '@/server/controle-da-semana';

const HOJE = '2026-10-07';

function semana(over: Partial<ControleDaSemana['missing']> = {}): ControleDaSemana {
  return {
    week: { start: '2026-10-05', end: '2026-10-11', today: HOJE, isCurrent: true, previous: '2026-09-28', next: '2026-10-12' },
    toAssign: [],
    progress: [],
    missing: {
      items: [
        { clientId: 'c1', clientName: 'Saae Itaverde', type: 'video', target: 2, cards: 0, missing: 2 },
        { clientId: 'c1', clientName: 'Saae Itaverde', type: 'arte', target: 1, cards: 1, missing: 0 },
        { clientId: 'c2', clientName: 'Clinimax', type: 'foto', target: 3, cards: 2, missing: 1 },
      ],
      overdue: [],
      overdueTotal: 0,
      ...over,
    },
  };
}

const atrasado = (id: string, clientId: string, clientName: string) => ({
  id, title: id, dueOn: '2026-10-01', clientId, clientName, type: 'video' as const,
  list: { id: 'l', name: 'L' }, statusName: null, assignees: [],
});

/** Um banco de brinquedo: só `notice_reads` responde; o resto, vazio. */
function banco() {
  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    const texto = strings.join('?');
    const rows = (): unknown[] => {
      if (texto.includes('from ideworks.notice_reads') && texto.includes('any(')) {
        const pedidas = args.find((a) => Array.isArray(a)) as string[];
        return pedidas.filter((k) => lido.vistas.includes(k)).map((k) => ({ notice_key: k }));
      }
      if (texto.includes('as unread')) return [{ unread: 0 }];
      return [];
    };
    return Object.assign({ text: texto, values: args }, { then: (r: (x: unknown[]) => void) => r(rows()) });
  }) as unknown as Tx;
  return tx as unknown as Sql;
}

const admin = { userId: 'u1', isSuper: true, isSuperadmin: true } as AuthenticatedActor;
const funcionario = { userId: 'u2', isSuper: false, isSuperadmin: false } as AuthenticatedActor;

beforeEach(() => {
  lido.semana = semana();
  lido.vistas = [];
  esquecerAvisosDoControle();
  vi.mocked(readControleDaSemana).mockClear();
});

describe('avisosDoControle (pura)', () => {
  it('um aviso-resumo, com clientes distintos em falta; falta zerada não conta', () => {
    const av = avisosDoControle(semana());
    expect(av).toHaveLength(1);
    expect(av[0]).toMatchObject({
      key: 'controle:2026-10-05:falta:2:atrasado:0',
      tipo: 'controle',
      taskTitle: 'Controle da semana',
      weekStart: '2026-10-05',
      clientesEmFalta: 2,
      clientesAtrasados: 0,
    });
  });

  it('o número que muda troca a chave', () => {
    const a = avisosDoControle(semana())[0].key;
    const outra = semana();
    outra.missing.items[2].missing = 0;
    expect(avisosDoControle(outra)[0].key).not.toBe(a);
  });

  it('atrasados contam clientes distintos; a chave cabe em 200 caracteres', () => {
    const av = avisosDoControle(
      semana({
        items: [],
        overdue: [atrasado('a', 'c1', 'Saae'), atrasado('b', 'c1', 'Saae'), atrasado('c', 'c1', 'Saae'), atrasado('d', 'c2', 'Clinimax')],
        overdueTotal: 4,
      }),
    );
    expect(av).toHaveLength(1);
    expect(av[0]).toMatchObject({ clientesEmFalta: 0, clientesAtrasados: 2, key: 'controle:2026-10-05:falta:0:atrasado:2' });
    expect(av[0].key.length).toBeLessThanOrEqual(200);
  });

  it('nada em falta e nada atrasado: sem aviso', () => {
    const s = semana();
    s.missing.items.forEach((i) => (i.missing = 0));
    expect(avisosDoControle(s)).toEqual([]);
  });

  it('frases: singular, plural e as três combinações', () => {
    const f = (falta: number, atraso: number) =>
      fraseDoAviso({ tipo: 'controle', clientesEmFalta: falta, clientesAtrasados: atraso } as never, HOJE as never);
    expect(f(24, 3)).toBe('24 clientes com falta nesta semana · 3 com cards atrasados');
    expect(f(1, 1)).toBe('1 cliente com falta nesta semana · 1 com cards atrasados');
    expect(f(24, 0)).toBe('24 clientes com falta nesta semana');
    expect(f(1, 0)).toBe('1 cliente com falta nesta semana');
    expect(f(0, 3)).toBe('3 clientes com cards atrasados');
    expect(f(0, 1)).toBe('1 cliente com cards atrasados');
  });
});

describe('o cálculo guardado por 5 minutos', () => {
  const T0 = Date.parse('2026-10-07T15:00:00Z');

  it('a segunda chamada dentro de 5 minutos vem do cache; depois disso, lê de novo', async () => {
    await avisosDoControleGuardados(banco(), admin, T0);
    await avisosDoControleGuardados(banco(), admin, T0 + VALIDADE_DO_AVISO_DO_CONTROLE_MS - 1);
    expect(readControleDaSemana).toHaveBeenCalledTimes(1);
    await avisosDoControleGuardados(banco(), admin, T0 + VALIDADE_DO_AVISO_DO_CONTROLE_MS + 1);
    expect(readControleDaSemana).toHaveBeenCalledTimes(2);
  });

  it('recortes de empresas omitidas diferentes não compartilham o guardado', async () => {
    await avisosDoControleGuardados(banco(), admin, T0);
    await avisosDoControleGuardados(banco(), { ...admin, categoriasOmitidas: ['cat-1'] } as AuthenticatedActor, T0);
    expect(readControleDaSemana).toHaveBeenCalledTimes(2);
  });

  it('dois administradores não compartilham o guardado: cada um lê o que as políticas lhe deixam ver', async () => {
    // Administrar não é ver tudo (F17.32): só o topo enxerga a carteira inteira,
    // e cada administrador vê as empresas de que participa. Com uma chave só do
    // dia, o primeiro a abrir a caixa fixava os números do sino de todos os
    // outros por 5 minutos — o "3 clientes em falta" de uma empresa aparecia
    // para quem nem a enxerga.
    const outro = { ...admin, userId: 'u9', isSuper: false } as AuthenticatedActor;
    lido.semana = semana();
    const primeiro = await avisosDoControleGuardados(banco(), admin, T0);
    expect(primeiro[0]?.clientesEmFalta).toBe(2);

    lido.semana = semana({ items: [{ clientId: 'c9', clientName: 'Outra empresa', type: 'video', target: 1, cards: 0, missing: 1 }] });
    const segundo = await avisosDoControleGuardados(banco(), outro, T0 + 1_000);

    expect(readControleDaSemana).toHaveBeenCalledTimes(2);
    expect(segundo[0]?.clientesEmFalta).toBe(1);
  });

  it('o mesmo administrador continua compartilhando o guardado com ele mesmo', async () => {
    await avisosDoControleGuardados(banco(), admin, T0);
    await avisosDoControleGuardados(banco(), { ...admin } as AuthenticatedActor, T0 + 1_000);
    expect(readControleDaSemana).toHaveBeenCalledTimes(1);
  });
});

describe('a caixa e o sino', () => {
  it('admin recebe UM aviso-resumo, não visto, e ele entra na contagem do sino', async () => {
    const r = await readNotices(banco(), admin, false);
    const c = r.notices.filter((a) => a.tipo === 'controle');
    expect(c).toHaveLength(1);
    expect(c[0].seen).toBe(false);
    expect(r.unread).toBe(1);
    expect(await countUnreadNotices(banco(), admin)).toBe(1);
  });

  it('funcionário não recebe, e a contagem não muda', async () => {
    const r = await readNotices(banco(), funcionario, true);
    expect(r.notices.filter((a) => a.tipo === 'controle')).toHaveLength(0);
    expect(r.unread).toBe(0);
    expect(await countUnreadNotices(banco(), funcionario)).toBe(0);
    expect(readControleDaSemana).not.toHaveBeenCalled();
  });

  it('lido some das novas, aparece em Já vistos, e sai da contagem', async () => {
    lido.vistas = ['controle:2026-10-05:falta:2:atrasado:0'];
    const novos = await readNotices(banco(), admin, false);
    expect(novos.notices).toHaveLength(0);
    expect(novos.unread).toBe(0);
    expect(await countUnreadNotices(banco(), admin)).toBe(0);
    const todos = await readNotices(banco(), admin, true);
    expect(todos.notices.find((a) => a.tipo === 'controle')?.seen).toBe(true);
  });

  it('o número que muda volta como não lido', async () => {
    lido.vistas = ['controle:2026-10-05:falta:2:atrasado:0'];
    expect(await countUnreadNotices(banco(), admin)).toBe(0);
    const s = semana();
    s.missing.items[2].missing = 0;
    lido.semana = s;
    esquecerAvisosDoControle();
    expect(await countUnreadNotices(banco(), admin)).toBe(1);
  });

  it('tudo zerado some', async () => {
    const s = semana();
    s.missing.items.forEach((i) => (i.missing = 0));
    lido.semana = s;
    const r = await readNotices(banco(), admin, true);
    expect(r.notices.filter((a) => a.tipo === 'controle')).toHaveLength(0);
    expect(r.unread).toBe(0);
  });

  it('se a leitura da semana falha, a caixa dos outros avisos segue', async () => {
    vi.mocked(readControleDaSemana).mockRejectedValueOnce(new Error('banco'));
    const r = await readNotices(banco(), admin, false);
    expect(r.notices).toHaveLength(0);
  });

  it('…mas a falha deixa rastro no log: calar o erro esconderia o aviso para sempre', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const erro = new Error('banco');
    vi.mocked(readControleDaSemana).mockRejectedValueOnce(erro);

    await readNotices(banco(), admin, false);

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/controle da semana/i);
    expect(log.mock.calls[0][1]).toBe(erro);
    log.mockRestore();
  });

  it('quem não administra não lê a semana nem registra nada', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await readNotices(banco(), funcionario, false);
    expect(readControleDaSemana).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
