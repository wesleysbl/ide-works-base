/**
 * O limite da página desce ao SQL — F22, Fase 3.
 *
 * O defeito que estes testes travam: nenhuma das quatro consultas de `search`
 * tinha `limit`. Buscar a letra `a` trazia 1860 tarefas do banco, gastava 2,1 s
 * e descartava quase tudo para caber nos 64 KiB. O corte tem de acontecer no
 * banco — e DEPOIS do recorte da concessão, nunca antes.
 *
 * Aqui não há banco: um `tx` de mentira grava o SQL montado, e os testes leem
 * o texto. É a única forma de provar a ORDEM das cláusulas sem um Postgres.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchKind } from '@/integrations/contract';
import type { SearchWindow, WorkScope } from '@/integrations/reads';

const consultas: string[] = [];
/** Linhas que as próximas consultas aguardadas devolvem, na ordem; vazio = `[]`. */
const respostas: unknown[][] = [];

/** Fragmento do driver: só vira consulta gravada quando alguém o aguarda. */
type Frag = { readonly strings: readonly string[]; readonly values: readonly unknown[]; then: (ok: (rows: unknown[]) => void) => void };

function renderiza(frag: Frag): string {
  let out = '';
  frag.strings.forEach((parte, i) => {
    out += parte;
    if (i < frag.values.length) {
      const v = frag.values[i];
      out += ehFrag(v) ? renderiza(v) : `«${JSON.stringify(v)}»`;
    }
  });
  return out;
}

function ehFrag(v: unknown): v is Frag {
  return typeof v === 'object' && v !== null && 'strings' in v && 'values' in v;
}

function txDeMentira() {
  const tag = (strings: readonly string[], ...values: unknown[]): Frag => {
    const frag: Frag = {
      strings,
      values,
      then(ok) {
        consultas.push(renderiza(frag).replace(/\s+/g, ' ').trim());
        ok(respostas.shift() ?? []);
      },
    };
    return frag;
  };
  return tag;
}

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (sql: unknown) => Promise<unknown>) => work(txDeMentira()),
}));

vi.mock('@/server/db', async (original) => {
  const real = await original<typeof import('@/server/db')>();
  return {
    ...real,
    withActor: async (sql: unknown, _actor: unknown, work: (tx: unknown) => Promise<unknown>) => work(sql),
  };
});

const { SqlWorkCatalog, searchKindWindow } = await import('@/integrations/sql-work');
const { encodePageCursor, PAGE_CURSOR_VERSION } = await import('@/integrations/page');

const ACTOR = { kind: 'user', userId: '11111111-1111-4111-8111-111111111111', isSuperadmin: true, isSuper: true } as const;

const ESCOPO: WorkScope = {
  companies: { kind: 'all' },
  clients: 'all',
  capabilities: new Set(['boards:read', 'tasks:read', 'clients:read', 'people:read'] as const),
};

const TODAS: readonly SearchKind[] = ['board', 'task', 'client', 'person'];
const SEM_CURSOR: SearchWindow = { limit: 50, cursor: null };

function catalogo() {
  return new SqlWorkCatalog({} as never, ACTOR as never);
}

beforeEach(() => {
  consultas.length = 0;
  respostas.length = 0;
});

describe('searchKindWindow', () => {
  it('pede um a mais do que a página, para o sinal de continuação existir', () => {
    expect(searchKindWindow('task', { limit: 50, cursor: null })).toEqual({ skip: false, after: null, fetch: 51 });
  });

  it('pula a espécie inteira quando o cursor já passou dela', () => {
    const cursor = { v: PAGE_CURSOR_VERSION, k: 'task:zebra', id: 'x' } as const;
    expect(searchKindWindow('board', { limit: 10, cursor }).skip).toBe(true);
    expect(searchKindWindow('client', { limit: 10, cursor }).skip).toBe(true);
  });

  it('continua depois do cursor na espécie dele, e do começo nas seguintes', () => {
    const cursor = { v: PAGE_CURSOR_VERSION, k: 'client:acme', id: 'abc' } as const;
    expect(searchKindWindow('client', { limit: 10, cursor })).toEqual({
      skip: false,
      after: { k: 'acme', id: 'abc' },
      fetch: 11,
    });
    expect(searchKindWindow('task', { limit: 10, cursor })).toEqual({ skip: false, after: null, fetch: 11 });
  });

  it('o título com dois-pontos não quebra a leitura da espécie', () => {
    const cursor = { v: PAGE_CURSOR_VERSION, k: 'task:reunião: pauta', id: 'abc' } as const;
    expect(searchKindWindow('task', { limit: 5, cursor }).after).toEqual({ k: 'reunião: pauta', id: 'abc' });
  });
});

describe('SqlWorkCatalog.search: o limite desce ao SQL', () => {
  it('as quatro consultas levam limit, e é o pedido + 1', async () => {
    await catalogo().search(ESCOPO, 'a', TODAS, { limit: 25, cursor: null });
    expect(consultas).toHaveLength(4);
    for (const sql of consultas) {
      expect(sql).toMatch(/limit «26»\s*$/);
    }
  });

  it('a chave de ordem não apara as pontas — btrim apararia menos que o String.trim() do JS', async () => {
    await catalogo().search(ESCOPO, 'a', TODAS, SEM_CURSOR);
    for (const sql of consultas) expect(sql).not.toContain('btrim');
  });

  it('cada consulta ordena pela mesma chave que pagina depois', async () => {
    await catalogo().search(ESCOPO, 'a', TODAS, SEM_CURSOR);
    for (const sql of consultas) {
      expect(sql).toMatch(/order by lower\([a-z]+\.(name|title)\) collate "C", [a-z]+\.id::text collate "C" limit/);
    }
  });

  it('o recorte da concessão vem ANTES do limite, em todas elas', async () => {
    await catalogo().search(ESCOPO, 'a', TODAS, SEM_CURSOR);
    for (const sql of consultas) {
      const recorte = Math.max(
        sql.indexOf('integration_allows_company'),
        sql.indexOf('integration_allows_client'),
        sql.indexOf('user_categories'),
      );
      expect(recorte).toBeGreaterThan(-1);
      expect(sql.lastIndexOf(' limit ')).toBeGreaterThan(recorte);
      // e o recorte continua no where, não numa camada depois do corte
      expect(sql.indexOf('where')).toBeLessThan(sql.lastIndexOf(' limit '));
    }
  });

  it('o cursor desce ao SQL e a espécie já lida não é consultada de novo', async () => {
    const cursor = encodePageCursor({ v: PAGE_CURSOR_VERSION, k: 'task:demanda x', id: 'abc' });
    const lido = (await import('@/integrations/page')).decodePageCursor(cursor);
    if (!lido.ok) throw new Error('cursor inválido');
    await catalogo().search(ESCOPO, 'a', TODAS, { limit: 10, cursor: lido.cursor });
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toContain('ideworks.tasks');
    expect(consultas[0]).toContain('«"demanda x"»');
    expect(consultas[0]).toMatch(/> \(«"demanda x"», «"abc"»\)/);
  });

  it('o diretório filtra o nome no banco, não em memória', async () => {
    await catalogo().search(ESCOPO, 'wes', ['person'], { limit: 5, cursor: null });
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toContain('position(«"wes"» in lower(d.name))');
    expect(consultas[0]).toMatch(/limit «6»\s*$/);
  });

  it('escopo de empresa nenhuma não chega a consultar', async () => {
    await catalogo().search({ ...ESCOPO, companies: { kind: 'none' } }, 'a', TODAS, SEM_CURSOR);
    expect(consultas).toHaveLength(0);
  });
});

describe('F37 — get_board e get_task trazem prioridade, datas e tipo da etapa', () => {
  const LISTA = '22222222-2222-4222-8222-222222222222';
  const TAREFA = '33333333-3333-4333-8333-333333333333';
  const ETAPA = '44444444-4444-4444-8444-444444444444';

  const linhaQuadro = {
    id: LISTA,
    name: 'Atendimento',
    space_id: 'space-a',
    space_name: 'Entrega',
    folder_id: null,
    folder_name: null,
    company_id: 'empresa-a',
    company_name: 'Agência Ide',
    client_id: null,
    client_name: null,
  };

  it('get_board: a coluna leva o tipo e o cartão leva prioridade, início, conclusão e arquivamento', async () => {
    respostas.push(
      [linhaQuadro],
      [{ id: ETAPA, name: 'Feito', sort_order: 2, type: 'done' }],
      [{ status_id: ETAPA, total: 1 }],
      [
        {
          id: TAREFA,
          title: 'Peça urgente',
          status_id: ETAPA,
          priority: 'urgent',
          start_on: '2026-09-24',
          completed_at: new Date('2026-09-25T10:00:00.000Z'),
          archived_at: null,
          client_id: null,
          client_name: null,
          people: [],
        },
        {
          id: 'outra',
          title: 'Sem nada',
          status_id: null,
          priority: null,
          start_on: null,
          completed_at: null,
          archived_at: null,
          client_id: null,
          client_name: null,
          people: [],
        },
      ],
    );
    const board = await catalogo().getBoard(ESCOPO, LISTA);
    expect(board?.columns[0]).toMatchObject({ id: ETAPA, type: 'done', total: 1 });
    expect(board?.tasks[0]).toMatchObject({
      priority: 'urgent',
      startOn: '2026-09-24',
      completedAt: '2026-09-25T10:00:00.000Z',
      archivedAt: null,
    });
    expect(board?.tasks[1]).toMatchObject({ priority: null, startOn: null, completedAt: null, archivedAt: null });
  });

  it('get_board: tipo desconhecido vira null, e o recorte da concessão segue no where', async () => {
    respostas.push([linhaQuadro], [{ id: ETAPA, name: 'X', sort_order: 1, type: 'inventado' }], [], []);
    const board = await catalogo().getBoard(ESCOPO, LISTA);
    expect(board?.columns[0].type).toBeNull();
    expect(board?.columns[0].total).toBe(0);
    const sqlTarefas = consultas[3];
    expect(sqlTarefas).toContain('t.priority::text');
    expect(sqlTarefas).toContain('t.archived_at is null');
    expect(sqlTarefas).toMatch(/integration_allows_client|user_clients|has_all_clients/);
    expect(consultas[0]).toContain('integration_allows_company');
  });

  it('get_task: ficha leva tipo da etapa, prioridade e datas; ausentes viram null', async () => {
    const base = {
      id: TAREFA,
      title: 'Peça',
      description: null,
      due_on: null,
      status_id: ETAPA,
      status_type: 'open',
      priority: 'urgent',
      start_on: '2026-09-24',
      completed_at: null,
      archived_at: null,
      board_id: LISTA,
      board_name: 'Atendimento',
      is_live: true,
      client_id: null,
      client_name: null,
      people: [],
    };
    respostas.push([base], []);
    const task = await catalogo().getTask(ESCOPO, TAREFA);
    expect(task).toMatchObject({ statusType: 'open', priority: 'urgent', startOn: '2026-09-24', completedAt: null, archivedAt: null });
    expect(consultas[0]).toContain('lw.status_type::text');
    expect(consultas[0]).toContain('t.archived_at is null');

    respostas.length = 0;
    respostas.push([{ ...base, status_type: null, priority: null, start_on: null }], []);
    const vazia = await catalogo().getTask(ESCOPO, TAREFA);
    expect(vazia).toMatchObject({ statusType: null, priority: null, startOn: null });
  });
});

describe('F38, Fase 4 — cliente cancelado no SQL da busca e da ficha', () => {
  it('cliente: ativo por trecho do nome; cancelado só pelo começo, até a fronteira de palavra', async () => {
    await catalogo().search(ESCOPO, ' Zeca ', ['client'], SEM_CURSOR);
    const sql = consultas[0];
    expect(sql).toContain('(c.is_active and position(«"zeca"» in lower(c.name)) > 0)');
    expect(sql).toContain('not c.is_active');
    expect(sql).toContain('left(n.nome, length(«"zeca"»::text)) = «"zeca"»::text');
    expect(sql).toContain("!~ '[a-z0-9]'");
    // O dia do cancelamento sai em São Paulo.
    expect(sql).toContain('to_char(c.inactive_at at time zone «"America/Sao_Paulo"», \'YYYY-MM-DD\') as cancelled_on');
  });

  it('linha cancelada vira achado mínimo; linha ativa segue igual', async () => {
    respostas.push([
      { id: 'c-zeca', title: 'Zeca Hamburgueria', company_id: 'e', company_name: 'Ide', is_active: false, cancelled_on: '2025-12-30' },
      { id: 'c-ativo', title: 'Zeca Nova', company_id: 'e', company_name: 'Ide', is_active: true, cancelled_on: null },
    ]);
    const hits = await catalogo().search(ESCOPO, 'zeca', ['client'], SEM_CURSOR);
    expect(hits[0]).toEqual({
      kind: 'client',
      id: 'c-zeca',
      title: 'Zeca Hamburgueria',
      detail: 'cancelado em 30/12/2025',
      board: null,
      client: null,
      company: null,
      cancelled: true,
      cancelledOn: '2025-12-30',
    });
    expect(hits[1]).toMatchObject({ id: 'c-ativo', detail: null, company: { id: 'e', name: 'Ide' } });
    expect(hits[1]).not.toHaveProperty('cancelled');
  });

  it('quadro e tarefa de cliente cancelado não voltam na busca', async () => {
    await catalogo().search(ESCOPO, 'peça', ['board', 'task'], SEM_CURSOR);
    const [quadro, tarefa] = consultas;
    expect(quadro).toContain('coalesce(cl.is_active, true)');
    expect(tarefa).toContain('coalesce(cl.is_active, true)');
    // F38, Fase 6: o `cl` da tarefa é o cliente pela regra única (o dela, e
    // na falta dele o da lista) — a condição pela lista virou a mesma. Desde
    // a Fase 6.1 a regra entra como junção (`clienteDaTarefaJuncao`).
    expect(tarefa).toContain('left join ideworks.lists lista_da_tarefa on lista_da_tarefa.id = t.list_id');
    expect(tarefa).toContain('select coalesce(t.client_id, lista_da_tarefa.client_id) as id ) cliente_da_tarefa');
    expect(tarefa).toContain('left join ideworks.clients cl on cl.id = cliente_da_tarefa.id');
    expect(tarefa).not.toContain('lc.is_active');
  });

  it('get_client de cancelado: só identificação e dia, sem ler as listas', async () => {
    const ID = '22222222-2222-4222-8222-222222222222';
    respostas.push([
      { id: ID, name: 'Zeca Hamburgueria', company_id: 'e', company_name: 'Ide', is_active: false, cancelled_on: '2025-12-30' },
    ]);
    const ficha = await catalogo().getClient(ESCOPO, ID);
    expect(ficha).toEqual({ id: ID, name: 'Zeca Hamburgueria', cancelled: true, cancelledOn: '2025-12-30' });
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toContain('c.is_active');
  });
});

describe('F38, Fase 6.1 — get_board e get_person_work cortam no banco', () => {
  const LISTA = '22222222-2222-4222-8222-222222222222';
  const PESSOA = '55555555-5555-4555-8555-555555555555';
  const ETAPA = '44444444-4444-4444-8444-444444444444';
  const linhaQuadro = {
    id: LISTA,
    name: 'Atendimento',
    space_id: 'space-a',
    space_name: 'Entrega',
    folder_id: null,
    folder_name: null,
    company_id: 'empresa-a',
    company_name: 'Agência Ide',
    client_id: null,
    client_name: null,
  };
  const cursorDe = async (k: string, id: string) => {
    const lido = (await import('@/integrations/page')).decodePageCursor(
      encodePageCursor({ v: PAGE_CURSOR_VERSION, k, id }),
    );
    if (!lido.ok) throw new Error('cursor inválido');
    return lido.cursor;
  };

  it('get_board: a consulta de tarefas leva o pedido + 1, depois do cursor, na ordem que pagina', async () => {
    respostas.push([linhaQuadro], [], [], []);
    await catalogo().getBoard(ESCOPO, LISTA, { limit: 5, cursor: await cursorDe('peça b', 'abc') });
    const tarefas = consultas[3];
    expect(tarefas).toMatch(/order by lower\(t\.title\) collate "C", t\.id::text collate "C" limit «6»$/);
    expect(tarefas).toMatch(/and \(lower\(t\.title\) collate "C", t\.id::text collate "C"\) > \(«"peça b"», «"abc"»\)/);
    // o recorte da concessão vem antes do corte, no where
    const recorte = tarefas.indexOf('cliente_permitido.sim');
    expect(recorte).toBeGreaterThan(tarefas.indexOf(' where '));
    expect(tarefas.lastIndexOf(' limit ')).toBeGreaterThan(recorte);
  });

  it('get_board: os totais das colunas vêm de uma contagem sem janela, com o mesmo recorte', async () => {
    respostas.push(
      [linhaQuadro],
      [{ id: ETAPA, name: 'A fazer', sort_order: 1, type: 'open' }],
      [{ status_id: ETAPA, total: 40 }],
      [{ id: 't1', title: 'Peça', status_id: ETAPA, priority: null, start_on: null, completed_at: null, archived_at: null, client_id: null, client_name: null, people: [] }],
    );
    const board = await catalogo().getBoard(ESCOPO, LISTA, { limit: 1, cursor: null });
    expect(board?.tasks).toHaveLength(1);
    expect(board?.columns[0].total).toBe(40);
    const contagem = consultas[2];
    expect(contagem).toContain('count(*)::int as total');
    expect(contagem).toContain('group by t.status_id');
    expect(contagem).not.toContain(' limit ');
    expect(contagem).not.toContain('collate "C") >');
    expect(contagem).toContain('t.archived_at is null');
    expect(contagem).toContain('(cliente_da_tarefa.id is null or cliente_permitido.sim)');
  });

  it('get_board sem janela lê o quadro inteiro (as provas comparam com isso)', async () => {
    respostas.push([linhaQuadro], [], [], []);
    await catalogo().getBoard(ESCOPO, LISTA);
    expect(consultas[3]).not.toContain(' limit ');
    expect(consultas[3]).not.toContain('collate "C") >');
  });

  it('a permissão do cliente roda uma vez por cliente: junção lateral com offset 0, fora do where', async () => {
    respostas.push([linhaQuadro], [], [], []);
    await catalogo().getBoard(ESCOPO, LISTA, { limit: 5, cursor: null });
    for (const sql of consultas.slice(2)) {
      expect(sql).toContain(
        'left join lateral ( select ideworks.integration_allows_client(cliente_da_tarefa.id) as sim offset 0 ) cliente_permitido on true',
      );
      expect(sql.slice(sql.indexOf(' where t.list_id'))).not.toContain('integration_allows_client');
    }
  });

  it('recorte de cliente nenhum: só tarefa sem cliente, e a junção da permissão nem entra', async () => {
    respostas.push([linhaQuadro], [], [], []);
    await catalogo().getBoard({ ...ESCOPO, clients: 'none' }, LISTA, { limit: 5, cursor: null });
    for (const sql of consultas.slice(2)) {
      expect(sql).toContain('cliente_da_tarefa.id is null');
      expect(sql).not.toContain('cliente_permitido');
    }
  });

  it('recorte por lista de clientes: permissão E pertencer à lista', async () => {
    respostas.push([linhaQuadro], [], [], []);
    await catalogo().getBoard({ ...ESCOPO, clients: new Set(['66666666-6666-4666-8666-666666666666']) }, LISTA, {
      limit: 5,
      cursor: null,
    });
    expect(consultas[3]).toContain(
      '(cliente_da_tarefa.id is null or (cliente_permitido.sim and cliente_da_tarefa.id = any(«["66666666-6666-4666-8666-666666666666"]»::uuid[])))',
    );
  });

  it('o nome do cliente vem de UMA leitura dos clientes da página, não de junção na consulta das tarefas', async () => {
    const CLIENTE = '66666666-6666-4666-8666-666666666666';
    const tarefa = (id: string, client_id: string | null) => ({
      id, title: id, status_id: null, priority: null, start_on: null, completed_at: null, archived_at: null, client_id, people: [],
    });
    respostas.push([linhaQuadro], [], [], [tarefa('t1', CLIENTE), tarefa('t2', CLIENTE), tarefa('t3', null)], [{ id: CLIENTE, name: 'Fonseca' }]);
    const board = await catalogo().getBoard(ESCOPO, LISTA, { limit: 5, cursor: null });
    expect(consultas[3]).not.toContain('ideworks.clients');
    expect(consultas[4]).toContain('from ideworks.clients c where c.id = any(«["66666666-6666-4666-8666-666666666666"]»::uuid[])');
    expect(board?.tasks.map((t) => t.client)).toEqual([{ id: CLIENTE, name: 'Fonseca' }, { id: CLIENTE, name: 'Fonseca' }, null]);
  });

  it('get_person_work: contagens de uma consulta à parte, sem janela; as tarefas com o pedido + 1', async () => {
    respostas.push(
      [{ id: PESSOA, display_name: 'Helena', team: null }],
      [{ tasks: 120, open: 30, done: 90 }],
      [{ id: 't1', title: 'Peça', status_id: null, due_on: null, completed_at: null, priority: null, status_name: null, status_type: null, board_id: null, board_name: null, is_live: null, client_id: null, client_name: null }],
    );
    const visao = await catalogo().getPersonWork(ESCOPO, PESSOA, { limit: 1, cursor: await cursorDe('peça', 't0') });
    expect(visao?.counts).toEqual({ tasks: 120, open: 30, done: 90 });
    expect(visao?.tasks).toHaveLength(1);
    const [, contagem, tarefas] = consultas;
    expect(contagem).toContain('count(*) filter (where t.completed_at is null)::int as open');
    expect(contagem).not.toContain(' limit ');
    expect(contagem).not.toContain('collate "C") >');
    expect(contagem).toContain('integration_allows_company');
    expect(contagem).toContain('(cliente_da_tarefa.id is null or cliente_permitido.sim)');
    expect(tarefas).toMatch(/order by lower\(t\.title\) collate "C", t\.id::text collate "C" limit «2»$/);
    expect(tarefas).toMatch(/> \(«"peça"», «"t0"»\)/);
    // F38, Fase 6.2: o cliente cancelado sai das duas, pelo cliente da tarefa (regra única).
    for (const consulta of [contagem, tarefas]) {
      expect(consulta).toContain(
        'and (cliente_da_tarefa.id is null or not (cliente_da_tarefa.id = any (array(select cancelado.id from ideworks.clients cancelado where not cancelado.is_active))))',
      );
    }
  });
});
