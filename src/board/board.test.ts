/**
 * O quadro — F17.9a.
 *
 * O teste que mais importa é o do ano oitenta e dois mil: uma das 18 tarefas
 * reais tem prazo `82025-08-07`, e o caminho normal do projeto
 * (`new Date(iso).toISOString().slice(0, 10)`) devolve `+082025-0` para ela.
 * O dado é da origem e não se conserta; o que não pode é a tela quebrar.
 */

import { describe, expect, it } from 'vitest';

import {
  type BoardStatus,
  type BoardTask,
  type TreeRow,
  buildTree,
  colunaCortada,
  compareDay,
  visiveisNoQuadro,
  dueState,
  formatDay,
  initials,
  orphanTasks,
  parseDay,
  summarize,
  summarizeBoard,
  toColumns,
} from '@/board/board';

const linha = (p: Partial<TreeRow>): TreeRow => ({
  spaceId: 's1',
  spaceName: 'Demandas',
  spaceColor: null,
  spaceSortOrder: 0,
  categoryId: 'c1',
  categoryName: 'Ide',
  folderId: null,
  folderName: null,
  folderSortOrder: null,
  listId: 'l1',
  listName: 'Todas as demandas',
  listSortOrder: 0,
  liveTasks: 0,
  totalTasks: 15,
  ...p,
});

const tarefa = (p: Partial<BoardTask>): BoardTask => ({
  id: 't1',
  title: 'Postagens',
  statusId: 'aberto',
  priority: null,
  dueOn: null,
  startOn: null,
  completedAt: null,
  hasDescription: false,
  clientId: null,
  clientName: null,
  assignees: [],
  tags: [],
  taskTypeName: null,
  // Os passos — F17.15. O cartão nasce sem mãe e sem contagem, que é o estado
  // das 18 tarefas reais.
  parentId: null,
  parentTitle: null,
  subtaskCount: 0,
  checklistDone: 0,
  checklistTotal: 0,
  // A entrega — F17.6. O cartão nasce sem anexo e sem conversa: é o estado
  // exato das 18 tarefas reais, porque as três tabelas nasceram vazias.
  hasAttachment: false,
  commentCount: 0,
  // A arte no cartão — F17.56. Ela nasce ausente: das 1.797 tarefas reais,
  // 16 têm anexo de imagem, e o cartão sem arte é o caso comum.
  previewAttachmentId: null,
  previewCount: 0,
  ...p,
});

const status = (p: Partial<BoardStatus>): BoardStatus => ({
  id: 'aberto',
  name: 'a fazer',
  type: 'open',
  color: '#d3d3d3',
  sortOrder: 0,
  ...p,
});

describe('parseDay — o ano de cinco dígitos passa', () => {
  it('lê a data normal', () => {
    expect(parseDay('2025-08-07')).toEqual({ year: 2025, month: 8, day: 7 });
  });

  it('lê o ano oitenta e dois mil sem quebrar', () => {
    // `new Date('82025-08-07').toISOString().slice(0, 10)` daria `+082025-0`.
    expect(parseDay('82025-08-07')).toEqual({ year: 82025, month: 8, day: 7 });
    expect(formatDay('82025-08-07')).toBe('07/08/82025');
  });

  it('recusa o que não é dia', () => {
    expect(parseDay(null)).toBeNull();
    expect(parseDay('')).toBeNull();
    expect(parseDay('2025-13-01')).toBeNull();
    expect(parseDay('2025-08-07T10:00:00Z')).toBeNull();
    expect(formatDay('lixo')).toBeNull();
  });

  it('formata com dois dígitos no dia e no mês', () => {
    expect(formatDay('2026-01-05')).toBe('05/01/2026');
  });
});

describe('compareDay', () => {
  it('ordena por ano, mês e dia — inclusive com ano gigante', () => {
    const hoje = { year: 2026, month: 8, day: 25 };
    expect(compareDay({ year: 2025, month: 8, day: 7 }, hoje)).toBeLessThan(0);
    expect(compareDay({ year: 82025, month: 8, day: 7 }, hoje)).toBeGreaterThan(0);
    expect(compareDay(hoje, hoje)).toBe(0);
  });
});

describe('dueState', () => {
  const hoje = { year: 2026, month: 8, day: 25 };

  it('tarefa concluída NÃO atrasa', () => {
    // As 18 reais estão todas concluídas e quase todas com prazo em 2025.
    // Pintá-las de vermelho seria uma parede de alarme falso.
    const t = tarefa({ dueOn: '2025-07-02', completedAt: '2025-07-03T12:00:00Z' });
    expect(dueState(t, hoje)).toBe('concluida');
  });

  it('prazo vencido em tarefa aberta é atraso', () => {
    expect(dueState(tarefa({ dueOn: '2026-08-24' }), hoje)).toBe('atrasada');
  });

  it('o prazo de hoje tem destaque próprio', () => {
    expect(dueState(tarefa({ dueOn: '2026-08-25' }), hoje)).toBe('hoje');
  });

  it('o ano oitenta e dois mil é futuro, não atraso', () => {
    expect(dueState(tarefa({ dueOn: '82025-08-07' }), hoje)).toBe('futura');
  });

  it('sem prazo não diz nada, e prazo ilegível se declara ilegível', () => {
    expect(dueState(tarefa({ dueOn: null }), hoje)).toBe('nenhum');
    expect(dueState(tarefa({ dueOn: 'quinta que vem' }), hoje)).toBe('ilegivel');
  });
});

describe('toColumns', () => {
  const esteira = [
    status({ id: 'fecha', name: 'concluída', type: 'closed', color: '#6bc950', sortOrder: 1 }),
    status({ id: 'aberto', name: 'a fazer', type: 'open', sortOrder: 0 }),
  ];

  it('devolve as colunas na ordem da esteira, e não na de chegada', () => {
    const colunas = toColumns(esteira, []);
    expect(colunas.map((c) => c.status.name)).toEqual(['a fazer', 'concluída']);
  });

  it('A COLUNA VAZIA FICA — é ela que conta a verdade de hoje', () => {
    const tarefas = [
      tarefa({ id: 'a', statusId: 'fecha', completedAt: '2025-08-01T00:00:00Z' }),
      tarefa({ id: 'b', statusId: 'fecha', completedAt: '2025-08-01T00:00:00Z' }),
    ];
    const colunas = toColumns(esteira, tarefas);
    expect(colunas).toHaveLength(2);
    expect(colunas[0].tasks).toHaveLength(0);
    expect(colunas[1].tasks).toHaveLength(2);
  });

  /* ─────────── a janela da coluna — F17.50 ─────────── */

  it('sem totais do servidor, o total da coluna é o que chegou', () => {
    const colunas = toColumns(esteira, [tarefa({ id: 'a', statusId: 'aberto' })]);
    expect(colunas[0].total).toBe(1);
    expect(colunas[1].total).toBe(0);
  });

  it('COM os totais do servidor, o total é o de VERDADE — não o da janela', () => {
    // O caso da lista `ATENDIMENTO`: cinquenta cartões chegaram, mil e quarenta
    // e nove existem. A coluna precisa dizer 1049, ou estará escondendo trabalho
    // sem avisar.
    const janela = [
      tarefa({ id: 'a', statusId: 'fecha' }),
      tarefa({ id: 'b', statusId: 'fecha' }),
    ];
    const colunas = toColumns(esteira, janela, { fecha: 1049, aberto: 0 });
    expect(colunas[1].tasks).toHaveLength(2);
    expect(colunas[1].total).toBe(1049);
  });

  it('o total nunca é menor do que os cartões à mostra', () => {
    // Arrastar um cartão para cá acrescenta um à coluna sem falar com o
    // servidor. O total velho não pode fazer a coluna dizer menos do que ela
    // desenha.
    const janela = [
      tarefa({ id: 'a', statusId: 'aberto' }),
      tarefa({ id: 'b', statusId: 'aberto' }),
      tarefa({ id: 'c', statusId: 'aberto' }),
    ];
    expect(toColumns(esteira, janela, { aberto: 2 })[0].total).toBe(3);
  });

  /* ─────────── o filtro, F17.55 ─────────── */

  it('com filtro, a coluna sabe os DOIS números', () => {
    const janela = [tarefa({ id: 'a', statusId: 'fecha' })];
    const colunas = toColumns(esteira, janela, { fecha: 1050, aberto: 13 }, { fecha: 27, aberto: 4 });
    expect(colunas[1].total).toBe(1050);
    expect(colunas[1].matched).toBe(27);
    // A coluna sem nenhum cartão na janela continua sabendo o que tem: é o que
    // permite dizer `4 de 13` numa coluna que o filtro esvaziou da tela.
    expect(colunas[0].total).toBe(13);
    expect(colunas[0].matched).toBe(4);
  });

  it('sem o mapa do filtro, o filtrado é o total — quem não filtra não muda', () => {
    const janela = [tarefa({ id: 'a', statusId: 'fecha' })];
    const colunas = toColumns(esteira, janela, { fecha: 1049, aberto: 0 });
    expect(colunas[1].matched).toBe(colunas[1].total);
    expect(colunas[0].matched).toBe(colunas[0].total);
  });

  it('o filtrado também não fica abaixo do que está à mostra', () => {
    // Arrastar um cartão para cá com o filtro ligado: ele está à vista e bate
    // com o filtro, então a conta velha do servidor não pode dizer menos.
    const janela = [
      tarefa({ id: 'a', statusId: 'aberto' }),
      tarefa({ id: 'b', statusId: 'aberto' }),
    ];
    expect(toColumns(esteira, janela, { aberto: 30 }, { aberto: 1 })[0].matched).toBe(2);
  });

  it('não perde tarefa: o que não tem coluna aparece como órfã', () => {
    const solta = tarefa({ id: 'x', statusId: 'status-de-outra-esteira' });
    expect(toColumns(esteira, [solta]).every((c) => c.tasks.length === 0)).toBe(true);
    expect(orphanTasks(esteira, [solta]).map((t) => t.id)).toEqual(['x']);
  });

  it('tarefa sem status nenhum também é órfã', () => {
    expect(orphanTasks(esteira, [tarefa({ statusId: null })])).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('separa aberto de concluído — é o que o estado vazio honesto diz', () => {
    const tarefas = [
      tarefa({ id: 'a', completedAt: '2025-08-01T00:00:00Z' }),
      tarefa({ id: 'b', completedAt: '2025-08-01T00:00:00Z' }),
      tarefa({ id: 'c' }),
    ];
    expect(summarize(tarefas)).toEqual({ total: 3, open: 1, done: 2 });
  });

  it('lista vazia não inventa número', () => {
    expect(summarize([])).toEqual({ total: 0, open: 0, done: 0 });
  });
});

describe('summarizeBoard — o cabeçalho não pode mentir sobre a lista', () => {
  const esteira = [
    status({ id: 'aberto', name: 'a fazer', type: 'open', sortOrder: 0 }),
    status({ id: 'fecha', name: 'concluída', type: 'closed', sortOrder: 1 }),
  ];

  it('conta a LISTA inteira, e não os cartões que a janela trouxe', () => {
    // O caso de `ATENDIMENTO`: 21 em aberto e 1.049 concluídas, mas só 50 da
    // coluna que fecha chegaram. O cabeçalho tem de dizer 1.070.
    const janela = [
      tarefa({ id: 'a', statusId: 'aberto' }),
      tarefa({ id: 'b', statusId: 'fecha', completedAt: '2026-08-01T00:00:00Z' }),
    ];
    expect(
      summarizeBoard({
        statuses: esteira,
        tasks: janela,
        columnTotals: { aberto: 21, fecha: 1049 },
      }),
    ).toEqual({ total: 1070, open: 21, done: 1049 });
  });

  it('sem corte, diz o mesmo que `summarize`', () => {
    const tudo = [
      tarefa({ id: 'a', statusId: 'aberto' }),
      tarefa({ id: 'b', statusId: 'fecha', completedAt: '2026-08-01T00:00:00Z' }),
      tarefa({ id: 'c', statusId: 'fecha', completedAt: '2026-08-01T00:00:00Z' }),
    ];
    expect(
      summarizeBoard({ statuses: esteira, tasks: tudo, columnTotals: { aberto: 1, fecha: 2 } }),
    ).toEqual(summarize(tudo));
  });

  it('a tarefa órfã continua contada — ela não está em coluna nenhuma', () => {
    const comOrfa = [
      tarefa({ id: 'a', statusId: 'aberto' }),
      tarefa({ id: 'x', statusId: 'status-de-outra-esteira' }),
    ];
    expect(
      summarizeBoard({ statuses: esteira, tasks: comOrfa, columnTotals: { aberto: 1, fecha: 0 } }),
    ).toEqual({ total: 2, open: 2, done: 0 });
  });

  /* ─────────── o filtro, F17.55 ─────────── */

  it('`achadas` conta o outro mapa, e o total continua sendo o total', () => {
    // O caso medido: buscando `sabor` na `ATENDIMENTO`, a coluna que fecha tem
    // 1.050 e 27 batem. A tela mostra os DOIS, e nenhum no lugar do outro.
    const quadro = {
      statuses: esteira,
      tasks: [tarefa({ id: 'a', statusId: 'fecha', completedAt: '2026-08-01T00:00:00Z' })],
      columnTotals: { aberto: 13, fecha: 1050 },
      columnMatched: { aberto: 4, fecha: 27 },
    };
    expect(summarizeBoard(quadro)).toEqual({ total: 1063, open: 13, done: 1050 });
    expect(summarizeBoard(quadro, 'achadas')).toEqual({ total: 31, open: 4, done: 27 });
  });

  it('sem o mapa do filtro, `achadas` é o total — quem não filtra não muda', () => {
    const quadro = {
      statuses: esteira,
      tasks: [tarefa({ id: 'a', statusId: 'aberto' })],
      columnTotals: { aberto: 3, fecha: 9 },
    };
    expect(summarizeBoard(quadro, 'achadas')).toEqual(summarizeBoard(quadro));
  });
});

describe('buildTree', () => {
  it('põe lista sem pasta pendurada direto no espaço', () => {
    const arvore = buildTree([linha({})]);
    expect(arvore).toHaveLength(1);
    expect(arvore[0].folders).toHaveLength(0);
    expect(arvore[0].lists.map((l) => l.name)).toEqual(['Todas as demandas']);
  });

  it('agrupa por pasta quando há pasta', () => {
    const arvore = buildTree([
      linha({ listId: 'l1', folderId: 'f1', folderName: 'Clientes', listName: 'B' }),
      linha({ listId: 'l2', folderId: 'f1', folderName: 'Clientes', listName: 'A', listSortOrder: 1 }),
      linha({ listId: 'l3', listName: 'Solta' }),
    ]);
    expect(arvore[0].folders.map((f) => f.name)).toEqual(['Clientes']);
    // A ordem é a do banco (`sort_order`), não a alfabética.
    expect(arvore[0].folders[0].lists.map((l) => l.name)).toEqual(['B', 'A']);
    expect(arvore[0].lists.map((l) => l.name)).toEqual(['Solta']);
  });

  it('A EMPRESA VEM NA FRENTE: os dois espaços reais se chamam `Demandas`', () => {
    const arvore = buildTree([
      linha({ spaceId: 's2', categoryName: 'Ide Hub', listId: 'l2' }),
      linha({ spaceId: 's1', categoryName: 'Ide', listId: 'l1' }),
    ]);
    expect(arvore.map((s) => `${s.categoryName} · ${s.name}`)).toEqual([
      'Ide · Demandas',
      'Ide Hub · Demandas',
    ]);
  });

  it('carrega a contagem de tarefas vivas até a lista', () => {
    const arvore = buildTree([linha({ liveTasks: 0, totalTasks: 15 })]);
    expect(arvore[0].lists[0]).toMatchObject({ liveTasks: 0, totalTasks: 15 });
  });

  it('árvore sem linha nenhuma é lista vazia, não erro', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('initials', () => {
  it('duas letras, do primeiro e do último nome', () => {
    expect(initials('Wesley Sabino')).toBe('WS');
    expect(initials('Ana Paula de Souza')).toBe('AS');
    expect(initials('Jana')).toBe('JA');
    expect(initials('   ')).toBe('??');
  });
});

describe('o corte da coluna não confunde subtarefa escondida com cartão que falta', () => {
  // `columnTotals`/`columnMatched` vêm do banco e contam TODA tarefa da lista,
  // subtarefa incluída; o interruptor `Subtarefas` (desligado por padrão) tira
  // as filhas dos cartões. Comparar os cartões À VISTA com o total fazia toda
  // coluna com subtarefa dizer "1 de 3 · Mostrar mais" — e o botão não trazia
  // nada, porque o que faltava estava só escondido.
  const aberto = status({ id: 'aberto', sortOrder: 0 });
  const mae = tarefa({ id: 'm', statusId: 'aberto', subtaskCount: 2 });
  const filhas = [
    tarefa({ id: 's1', statusId: 'aberto', parentId: 'm', parentTitle: 'Postagens' }),
    tarefa({ id: 's2', statusId: 'aberto', parentId: 'm', parentTitle: 'Postagens' }),
  ];
  const todas = [mae, ...filhas];

  it('com as subtarefas escondidas, a coluna mostra um cartão e já recebeu os três', () => {
    const colunas = toColumns([aberto], visiveisNoQuadro(todas, false), { aberto: 3 }, { aberto: 3 }, todas);
    expect(colunas[0].tasks.map((t) => t.id)).toEqual(['m']);
    expect(colunas[0].carregadas).toBe(3);
    expect(colunaCortada(colunas[0])).toBe(false);
  });

  it('com a janela cortada de verdade (10 na coluna, 3 chegaram), o corte aparece — escondidas ou não', () => {
    for (const mostrar of [false, true]) {
      const colunas = toColumns([aberto], visiveisNoQuadro(todas, mostrar), { aberto: 10 }, { aberto: 10 }, todas);
      expect(colunas[0].carregadas).toBe(3);
      expect(colunaCortada(colunas[0])).toBe(true);
    }
  });

  it('sem a lista completa, carregadas é o que a coluna tem (a suíte e as telas sem interruptor)', () => {
    const colunas = toColumns([aberto], todas, { aberto: 3 });
    expect(colunas[0].carregadas).toBe(3);
    expect(colunaCortada(colunas[0])).toBe(false);
  });

  it('com filtro, o corte se mede contra o que o filtro achou', () => {
    // 3 chegaram, o filtro achou 3 de 10: nada a buscar.
    const colunas = toColumns([aberto], visiveisNoQuadro(todas, false), { aberto: 10 }, { aberto: 3 }, todas);
    expect(colunaCortada(colunas[0])).toBe(false);
  });
});
