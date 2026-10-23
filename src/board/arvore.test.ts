/**
 * A árvore editável, na camada pura — F17.14.
 *
 * O QUE SE PROVA AQUI
 *   O que `buildTree` (da F17.9a) NÃO consegue representar, e que é o motivo de
 *   esta segunda montagem existir: espaço sem lista, pasta sem lista, e o
 *   arquivado. Se estes três casos passarem a falhar, a barra lateral volta a
 *   engolir o espaço que alguém acabou de criar.
 *
 *   E prova a ponte: `paraNavegacao` precisa devolver exatamente a mesma forma
 *   que o menu de listas do modal de tarefa espera, com o arquivado FORA.
 */

import { describe, expect, it } from 'vitest';

import {
  type FullTreeRow,
  GRUPOS_DE_STATUS,
  GRUPO_DO_TIPO,
  TIPO_DO_GRUPO,
  acharListas,
  buildFullTree,
  conferirEsteira,
  contarListasDoClienteNoEspaco,
  listaLevaAFicha,
  normalizarEntrada,
  contarArquivados,
  destinosDeLista,
  espacosHomonimos,
  listasDoQuadro,
  nomeDoEspaco,
  paraNavegacao,
  seloDeListasNoEspaco,
  somenteVivos,
  todasAsListas,
  unidadesDoEspacoNovo,
} from '@/board/arvore';

const linha = (mudou: Partial<FullTreeRow>): FullTreeRow => ({
  spaceId: 's1',
  spaceName: 'Demandas',
  spaceColor: null,
  spaceArchivedAt: null,
  categoryId: 'c1',
  categoryName: 'Ide',
  folderId: null,
  folderName: null,
  folderArchivedAt: null,
  listId: null,
  listName: null,
  listContent: null,
  listArchivedAt: null,
  listIsLive: false,
  liveTasks: 0,
  totalTasks: 0,
  workflowName: null,
  inheritedFrom: null,
  clientId: null,
  clientName: null,
  ...mudou,
});

const comLista = (mudou: Partial<FullTreeRow>): FullTreeRow =>
  linha({
    listId: 'l1',
    listName: 'Todas as demandas',
    listIsLive: true,
    liveTasks: 2,
    totalTasks: 5,
    workflowName: 'Demandas',
    inheritedFrom: 'space',
    ...mudou,
  });

describe('buildFullTree monta os três níveis', () => {
  it('espaço com lista SOLTA — o `Skills` da referência', () => {
    const [espaco] = buildFullTree([comLista({})]);
    expect(espaco.folders).toHaveLength(0);
    expect(espaco.lists).toHaveLength(1);
    expect(espaco.lists[0].folderId).toBeNull();
  });

  it('espaço com pasta E lista solta guarda as duas, sem uma comer a outra', () => {
    const arvore = buildFullTree([
      comLista({ folderId: 'f1', folderName: 'MIMI', listId: 'l1', listName: 'MIMI (artes)' }),
      comLista({ listId: 'l2', listName: 'Skills' }),
    ]);
    expect(arvore[0].folders.map((f) => f.name)).toEqual(['MIMI']);
    expect(arvore[0].folders[0].lists.map((l) => l.name)).toEqual(['MIMI (artes)']);
    expect(arvore[0].lists.map((l) => l.name)).toEqual(['Skills']);
  });

  it('ESPAÇO SEM LISTA aparece — é o espaço recém-criado', () => {
    const arvore = buildFullTree([linha({ spaceName: 'Espaço novo' })]);
    expect(arvore).toHaveLength(1);
    expect(arvore[0].name).toBe('Espaço novo');
    expect(arvore[0].folders).toHaveLength(0);
    expect(arvore[0].lists).toHaveLength(0);
  });

  it('PASTA SEM LISTA aparece — é a pasta recém-criada', () => {
    const arvore = buildFullTree([linha({ folderId: 'f1', folderName: 'Pasta nova' })]);
    expect(arvore[0].folders).toHaveLength(1);
    expect(arvore[0].folders[0].lists).toHaveLength(0);
  });

  it('a ordem é a do banco, e não uma segunda opinião em JavaScript', () => {
    const arvore = buildFullTree([
      comLista({ listId: 'z', listName: 'Zebra' }),
      comLista({ listId: 'a', listName: 'Abelha' }),
    ]);
    expect(arvore[0].lists.map((l) => l.name)).toEqual(['Zebra', 'Abelha']);
  });
});

describe('a corrente do arquivamento', () => {
  it('espaço arquivado derruba a pasta dele, sem carimbar a pasta', () => {
    const arvore = buildFullTree([
      linha({ spaceArchivedAt: '2026-08-25T00:00:00.000Z', folderId: 'f1', folderName: 'P' }),
    ]);
    expect(arvore[0].live).toBe(false);
    expect(arvore[0].folders[0].live).toBe(false);
    // O instante da pasta continua nulo: quem está arquivado é o espaço. É a
    // regra 1 da F17.1 — "arquivado desde quando" não pode virar ficção.
    expect(arvore[0].folders[0].archivedAt).toBeNull();
  });

  it('a liveness da LISTA vem do banco, e não é recalculada aqui', () => {
    const arvore = buildFullTree([comLista({ listIsLive: false })]);
    expect(arvore[0].lists[0].live).toBe(false);
    expect(arvore[0].live).toBe(true);
  });

  it('`somenteVivos` esconde os três níveis, cada um pelo seu', () => {
    const arvore = buildFullTree([
      comLista({ listId: 'viva', listIsLive: true }),
      comLista({ listId: 'morta', listIsLive: false, listArchivedAt: '2026-08-25T00:00:00Z' }),
      linha({ spaceId: 's2', spaceName: 'Fora', spaceArchivedAt: '2026-08-25T00:00:00Z' }),
    ]);
    const vivos = somenteVivos(arvore);
    expect(vivos.map((e) => e.id)).toEqual(['s1']);
    expect(vivos[0].lists.map((l) => l.id)).toEqual(['viva']);
    // A árvore original NÃO é mexida: o interruptor "mostrar arquivados" precisa
    // dela inteira para poder desarquivar.
    expect(todasAsListas(arvore)).toHaveLength(2);
  });

  it('conta o arquivado por nível — é o número do interruptor', () => {
    const arvore = buildFullTree([
      comLista({ listId: 'morta', listIsLive: false, listArchivedAt: '2026-08-25T00:00:00Z' }),
      linha({ spaceId: 's2', spaceName: 'Fora', spaceArchivedAt: '2026-08-25T00:00:00Z' }),
    ]);
    expect(contarArquivados(arvore)).toEqual({ spaces: 1, folders: 0, lists: 1, total: 2 });
  });
});

describe('paraNavegacao — a ponte com o menu de listas do modal', () => {
  it('devolve a forma de `TreeSpace`, com as contagens', () => {
    const arvore = buildFullTree([comLista({})]);
    expect(paraNavegacao(arvore)).toEqual([
      {
        id: 's1',
        name: 'Demandas',
        color: null,
        categoryName: 'Ide',
        folders: [],
        lists: [{ id: 'l1', name: 'Todas as demandas', liveTasks: 2, totalTasks: 5 }],
      },
    ]);
  });

  it('espaço sem lista viva NÃO entra — criar tarefa exige onde pôr', () => {
    const arvore = buildFullTree([
      linha({ spaceName: 'Vazio' }),
      comLista({ spaceId: 's2', listId: 'l9', listIsLive: false }),
    ]);
    expect(paraNavegacao(arvore)).toEqual([]);
  });
});

describe('destinos de mover a lista', () => {
  const arvore = buildFullTree([
    comLista({ folderId: 'f1', folderName: 'MIMI', listId: 'l1' }),
    comLista({ spaceId: 's2', spaceName: 'Demandas', categoryName: 'Ide Hub', listId: 'l2' }),
  ]);

  it('oferece a raiz de cada espaço e cada pasta viva', () => {
    const destinos = destinosDeLista(arvore, { spaceId: 's1', folderId: 'f1' });
    expect(destinos.map((d) => d.chave)).toEqual(['s1:', 's1:f1', 's2:']);
  });

  it('F31: os dois `Demandas` (Ide e Ide Hub) levam a empresa — são homônimos', () => {
    const destinos = destinosDeLista(arvore, { spaceId: 's1', folderId: 'f1' });
    expect(destinos.map((d) => d.espaco)).toEqual([
      'Ide · Demandas',
      'Ide · Demandas',
      'Ide Hub · Demandas',
    ]);
  });

  it('F31: sem o gêmeo, o espaço sai com o nome sozinho', () => {
    const so = buildFullTree([comLista({ folderId: 'f1', folderName: 'MIMI', listId: 'l1' })]);
    expect(destinosDeLista(so, { spaceId: 's1', folderId: 'f1' }).map((d) => d.espaco)).toEqual([
      'Demandas',
      'Demandas',
    ]);
  });

  it('marca onde a lista está hoje, em vez de esconder', () => {
    const destinos = destinosDeLista(arvore, { spaceId: 's1', folderId: 'f1' });
    expect(destinos.filter((d) => d.atual).map((d) => d.chave)).toEqual(['s1:f1']);
  });

  it('a raiz do espaço vem com pasta NULA — é o par que a chave composta aceita', () => {
    const [raiz] = destinosDeLista(arvore, { spaceId: 's1', folderId: null });
    expect(raiz.folderId).toBeNull();
    expect(raiz.spaceId).toBe('s1');
    expect(raiz.atual).toBe(true);
  });
});

describe('as listas para onde a automação pode encaminhar — F17.41', () => {
  const arvore = buildFullTree([
    comLista({ folderId: 'f1', folderName: 'MIMI', listId: 'l1', listName: 'MIMI (artes)' }),
    comLista({ spaceId: 's2', spaceName: 'Atendimento', listId: 'l2', listName: 'Fila' }),
    comLista({ spaceId: 's2', spaceName: 'Atendimento', listId: 'l3', listName: 'Morta', listIsLive: false }),
  ]);

  it('achata a árvore inteira, com o caminho por extenso', () => {
    expect(listasDoQuadro(arvore).map((l) => `${l.caminho} / ${l.name}`)).toEqual([
      'Demandas / MIMI / MIMI (artes)',
      'Atendimento / Fila',
    ]);
  });

  it('⚠️ A LISTA DE ORIGEM SAI FORA — encaminhar para a própria lista não encaminha nada', () => {
    // E o banco recusa: `task_automations_moves_somewhere_else`. Oferecer é
    // oferecer o que vai ser recusado.
    expect(listasDoQuadro(arvore, 'l1').map((l) => l.id)).toEqual(['l2']);
  });

  it('lista morta não entra — a tarefa chegaria num quadro fora de circulação', () => {
    expect(listasDoQuadro(arvore).map((l) => l.id)).not.toContain('l3');
  });
});

describe('conferirEsteira — o que `create_status_set` recusaria', () => {
  const ok = [
    { name: 'a fazer', type: 'open' as const, color: '#d3d3d3' },
    { name: 'concluída', type: 'closed' as const, color: '#6bc950' },
  ];

  it('passa a esteira das duas listas reais da casa', () => {
    expect(conferirEsteira('Demandas', ok)).toBeNull();
  });

  it('recusa sem status que fecha — é ele que faz o quadro saber onde é o fim', () => {
    expect(conferirEsteira('X', [ok[0]])).toMatch(/exatamente um status que FECHA/);
  });

  it('recusa DOIS que fecham — o índice único do banco também recusaria', () => {
    expect(conferirEsteira('X', [ok[1], { ...ok[1], name: 'fim' }])).toMatch(/FECHA/);
  });

  it('recusa nome repetido, que na tela seria indistinguível', () => {
    expect(conferirEsteira('X', [...ok, { ...ok[0], name: 'A FAZER' }])).toMatch(/duas vezes/);
  });

  it('recusa esteira sem nome e status sem nome', () => {
    expect(conferirEsteira('  ', ok)).toMatch(/nome/);
    expect(conferirEsteira('X', [{ ...ok[0], name: ' ' }, ok[1]])).toMatch(/nome/);
  });
});

/* ─────────────────── os grupos de status — F17.19 ─────────────────── */

describe('os quatro grupos do ClickUp, e os cinco tipos do banco', () => {
  /*
    A referência que o usuário mandou, e que é o critério deste bloco:

      Não iniciado    IDÉIAS · A FAZER
      Ativo           EM ANDAMENTO · REFAÇÃO
      Feito           REVISÃO INTERNA · EM APROVAÇÃO DO CLIENTE
      Fechado         CONCLUÍDO
  */
  it('são exatamente quatro, e nesta ordem — a do fluxo, não a alfabética', () => {
    expect([...GRUPOS_DE_STATUS]).toEqual(['Não iniciado', 'Ativo', 'Feito', 'Fechado']);
  });

  it('`open` e `unstarted` caem os DOIS em `Não iniciado`', () => {
    // `idéias` (open) e `a fazer` (unstarted) são o par real da esteira
    // `Demandas`, e na tela do ClickUp eles aparecem sob o mesmo cabeçalho.
    expect(GRUPO_DO_TIPO.open).toBe('Não iniciado');
    expect(GRUPO_DO_TIPO.unstarted).toBe('Não iniciado');
  });

  it('`custom` é `Ativo`, `done` é `Feito` e `closed` é `Fechado`', () => {
    expect(GRUPO_DO_TIPO.custom).toBe('Ativo');
    expect(GRUPO_DO_TIPO.done).toBe('Feito');
    expect(GRUPO_DO_TIPO.closed).toBe('Fechado');
  });

  it('todo tipo do enum tem grupo — nenhum cai em `undefined` na tela', () => {
    for (const t of ['open', 'unstarted', 'custom', 'done', 'closed'] as const) {
      expect(GRUPOS_DE_STATUS).toContain(GRUPO_DO_TIPO[t]);
    }
  });

  it('o caminho de volta escolhe um tipo por grupo, e nenhum fica sem', () => {
    for (const g of GRUPOS_DE_STATUS) {
      expect(GRUPO_DO_TIPO[TIPO_DO_GRUPO[g]]).toBe(g);
    }
  });
});

describe('normalizarEntrada — a primeira etapa de `Não iniciado` é a de entrada', () => {
  const esteira = [
    { name: 'idéias', type: 'unstarted' as const, color: '#d3d3d3' },
    { name: 'a fazer', type: 'unstarted' as const, color: '#f9d900' },
    { name: 'em andamento', type: 'custom' as const, color: '#a875ff' },
    { name: 'concluído', type: 'closed' as const, color: '#6bc950' },
  ];

  it('promove SÓ a primeira a `open`, e deixa as outras `unstarted`', () => {
    // Sem isto, uma esteira inteira poderia sair sem nenhum `open`, e a entrada
    // da esteira passaria a depender do desempate de `first_open_status`.
    expect(normalizarEntrada(esteira).map((s) => s.type)).toEqual([
      'open',
      'unstarted',
      'custom',
      'closed',
    ]);
  });

  it('não mexe em quem não é de `Não iniciado`', () => {
    const so = [
      { name: 'fazendo', type: 'custom' as const, color: '#a875ff' },
      { name: 'fim', type: 'closed' as const, color: '#6bc950' },
    ];
    expect(normalizarEntrada(so)).toEqual(so);
  });

  it('não muda a ordem nem o nome — ela só decide qual é a entrada', () => {
    const saida = normalizarEntrada(esteira);
    expect(saida.map((s) => s.name)).toEqual(esteira.map((s) => s.name));
  });

  it('o resultado continua passando por `conferirEsteira`', () => {
    expect(conferirEsteira('Demandas', normalizarEntrada(esteira))).toBeNull();
  });

  it('e preserva o `id` da etapa, que é o que faz renomear ser renomear', () => {
    const comId = [
      { id: 'st-1', name: 'a fazer', type: 'unstarted' as const, color: '#f9d900' },
      { id: 'st-2', name: 'fim', type: 'closed' as const, color: '#6bc950' },
    ];
    expect(normalizarEntrada(comId).map((s) => s.id)).toEqual(['st-1', 'st-2']);
  });
});

/* ─────────────── o vínculo lista↔cliente — F17.43 ─────────────── */

describe('a lista carrega de que cliente ela é', () => {
  it('o vínculo chega inteiro à árvore montada', () => {
    const [espaco] = buildFullTree([
      comLista({ listId: 'l1', listName: 'Jatobá', clientId: 'cli-1', clientName: 'Jatobá' }),
    ]);
    expect(espaco.lists[0].clientId).toBe('cli-1');
    expect(espaco.lists[0].clientName).toBe('Jatobá');
  });

  it('lista sem cliente continua existindo, e é o caso comum', () => {
    // `Todas as demandas`, `Skills`, a lista de time: nenhuma tem cliente. Um
    // vínculo obrigatório teria transformado o quadro num cadastro de clientes.
    const [espaco] = buildFullTree([comLista({})]);
    expect(espaco.lists[0].clientId).toBeNull();
    expect(espaco.lists[0].clientName).toBeNull();
  });

  it('o identificador pode vir SEM o nome — e isso é leitura correta', () => {
    // Quem alcança a lista e não alcança o cliente lê o nome nulo: a política
    // de leitura de cliente é quem o apaga, e a tela não tenta adivinhá-lo.
    const [espaco] = buildFullTree([comLista({ clientId: 'cli-2', clientName: null })]);
    expect(espaco.lists[0].clientId).toBe('cli-2');
    expect(espaco.lists[0].clientName).toBeNull();
    expect(listaLevaAFicha(espaco.lists[0])).toBe(false);
  });

  it('duas listas do mesmo cliente carregam o vínculo nas DUAS — unicidade nunca esteve aqui', () => {
    const [espaco] = buildFullTree([
      comLista({ listId: 'l1', listName: 'Demandas', clientId: 'cli-1', clientName: 'Jatobá' }),
      comLista({ listId: 'l2', listName: 'Conteúdo', clientId: 'cli-1', clientName: 'Jatobá' }),
    ]);
    expect(espaco.lists.map((l) => l.clientId)).toEqual(['cli-1', 'cli-1']);
    expect(espaco.lists.every((l) => listaLevaAFicha(l))).toBe(true);
  });

  it('listaLevaAFicha some quando falta o nome, mesmo com o identificador', () => {
    expect(listaLevaAFicha({ clientId: 'cli-1', clientName: 'Jatobá' })).toBe(true);
    expect(listaLevaAFicha({ clientId: 'cli-1', clientName: null })).toBe(false);
    expect(listaLevaAFicha({ clientId: null, clientName: null })).toBe(false);
  });

  it('o vínculo NÃO muda quem enxerga a lista', () => {
    // A trava desta etapa, dita onde ela dá para ser dita sem banco: `live` sai
    // da corrente de arquivamento, e nada nesta árvore consulta o cliente para
    // decidir se a lista aparece. Alcance é assunto de `can_act_on_chain`.
    const arvore = buildFullTree([
      comLista({ listId: 'l1', clientId: 'cli-1', clientName: 'Jatobá' }),
      comLista({ listId: 'l2', listName: 'Skills' }),
    ]);
    expect(todasAsListas(somenteVivos(arvore)).map((l) => l.id).sort()).toEqual(['l1', 'l2']);
  });
});

/* ────────────── os destinos recentes do cartão — F17.63 ────────────── */

describe('acharListas', () => {
  /** Uma árvore de navegação de mentira, na forma que o `MenuDeListas` fala. */
  const arvore = [
    {
      id: 'e1',
      name: 'Conteúdo',
      color: null,
      categoryName: 'Ide',
      lists: [{ id: 'l-solta', name: 'Demandas', liveTasks: 3, totalTasks: 9 }],
      folders: [
        {
          id: 'f1',
          name: 'MIMI',
          lists: [{ id: 'l-pasta', name: 'Semana', liveTasks: 0, totalTasks: 4 }],
        },
      ],
    },
  ];

  it('devolve na ORDEM DOS IDS, e não na da árvore', () => {
    // `Recentes` só quer dizer alguma coisa se o último destino usado estiver
    // em cima. A árvore desenha `l-solta` antes de `l-pasta`; os ids pedem o
    // contrário, e é o pedido que vale.
    expect(acharListas(arvore, ['l-pasta', 'l-solta']).map((l) => l.id)).toEqual([
      'l-pasta',
      'l-solta',
    ]);
  });

  it('escreve o caminho: espaço e pasta — sem a empresa, que não desfaz nada aqui (F31)', () => {
    const [achada] = acharListas(arvore, ['l-pasta']);
    expect(achada.espaco).toBe('Conteúdo');
    expect(achada.pasta).toBe('MIMI');
    expect(achada.nome).toBe('Semana');
  });

  it('lista solta no espaço não inventa pasta', () => {
    expect(acharListas(arvore, ['l-solta'])[0].pasta).toBeNull();
  });

  /**
   * ⚠️ A ASSERÇÃO DE ACESSO DESTA ETAPA, DITA SEM BANCO.
   *
   * A árvore que chega já veio recortada pela política de linha de `lists`.
   * Um id lembrado no navegador de uma lista que a pessoa não alcança mais
   * — ou nunca alcançou — simplesmente NÃO É ACHADO, e por isso não vira
   * linha de menu. A seção `Recentes` não tem caminho próprio até o banco, e
   * é essa ausência que a faz herdar o alcance em vez de o repetir.
   *
   * A outra metade — que um pedido montado à mão é recusado — é do banco, e
   * mora em `scripts/provar-mover-do-cartao.mjs`.
   */
  it('ID FORA DA ÁRVORE NÃO APARECE — é assim que `Recentes` herda o alcance', () => {
    expect(acharListas(arvore, ['l-de-outra-empresa'])).toEqual([]);
    expect(acharListas(arvore, ['l-de-outra-empresa', 'l-solta']).map((l) => l.id)).toEqual([
      'l-solta',
    ]);
  });

  it('id repetido entra uma vez só', () => {
    expect(acharListas(arvore, ['l-solta', 'l-solta']).map((l) => l.id)).toEqual(['l-solta']);
  });

  it('sem ids, nada — e a seção não é desenhada', () => {
    expect(acharListas(arvore, [])).toEqual([]);
  });
});

describe('a contagem do selo de já tem lista aqui', () => {
  const lista = (mudou: {
    clientId: string | null;
    spaceId: string;
    archivedAt: string | null;
  }) => mudou;

  it('zero — cliente sem lista neste espaço', () => {
    expect(
      contarListasDoClienteNoEspaco(
        [lista({ clientId: 'dxi', spaceId: 'helena', archivedAt: null })],
        'jatoba',
        'helena',
      ),
    ).toBe(0);
    expect(seloDeListasNoEspaco(0)).toBeNull();
  });

  it('uma', () => {
    expect(
      contarListasDoClienteNoEspaco(
        [lista({ clientId: 'dxi', spaceId: 'helena', archivedAt: null })],
        'dxi',
        'helena',
      ),
    ).toBe(1);
    expect(seloDeListasNoEspaco(1)).toBe('já tem 1 lista aqui');
  });

  it('várias', () => {
    expect(
      contarListasDoClienteNoEspaco(
        [
          lista({ clientId: 'jac', spaceId: 'helena', archivedAt: null }),
          lista({ clientId: 'jac', spaceId: 'helena', archivedAt: null }),
          lista({ clientId: 'jac', spaceId: 'helena', archivedAt: null }),
        ],
        'jac',
        'helena',
      ),
    ).toBe(3);
    expect(seloDeListasNoEspaco(3)).toBe('já tem 3 listas aqui');
  });

  it('lista arquivada conta — o vínculo continua depois de arquivar', () => {
    // DECISÃO: arquivada CONTA.
    // Motivo: arquivar não desfaz o vínculo. O selo responde "já tem lista
    // neste espaço", não "já tem lista viva". Se a arquivada não contasse, a
    // caixa diria que o cliente nunca veio enquanto a lista dele dorme no
    // arquivo — e trazer de novo criaria a segunda sem avisar da primeira.
    // A consulta de `readClientsForSpace` implementa isto com `count(l.id)`,
    // sem `archived_at is null`.
    expect(
      contarListasDoClienteNoEspaco(
        [
          lista({
            clientId: 'jac',
            spaceId: 'helena',
            archivedAt: '2026-09-01T00:00:00.000Z',
          }),
        ],
        'jac',
        'helena',
      ),
    ).toBe(1);
    expect(
      contarListasDoClienteNoEspaco(
        [
          lista({ clientId: 'jac', spaceId: 'helena', archivedAt: null }),
          lista({
            clientId: 'jac',
            spaceId: 'helena',
            archivedAt: '2026-09-01T00:00:00.000Z',
          }),
        ],
        'jac',
        'helena',
      ),
    ).toBe(2);
  });

  it('lista de outro espaço não entra — o selo é deste espaço', () => {
    expect(
      contarListasDoClienteNoEspaco(
        [
          lista({ clientId: 'jac', spaceId: 'helena', archivedAt: null }),
          lista({ clientId: 'jac', spaceId: 'juca', archivedAt: null }),
        ],
        'jac',
        'helena',
      ),
    ).toBe(1);
  });
});

/* ─────────── a empresa só desfaz homônimo — F31 (era o prefixo da F28) ─────────── */

describe('espacosHomonimos — a empresa aparece SÓ quando desfaz um homônimo', () => {
  const e = (id: string, name: string, categoryName: string | null) => ({ id, name, categoryName });
  const escritos = (espacos: ReturnType<typeof e>[]) => {
    const h = espacosHomonimos(espacos);
    return espacos.map((x) => nomeDoEspaco(x, h));
  };

  it('"será apenas Ide": espaço sem gêmeo sai com o nome sozinho', () => {
    // O que a F28 ainda escrevia (`Alma9 · CLIENTES`, `Ide · IDEAL HUB`) saiu.
    const casa = [
      e('a', 'AGÊNCIA IDE', 'Ide'),
      e('b', 'IDEAL HUB', 'Ide'),
      e('c', 'CLIENTES', 'Alma9'),
    ];
    expect(escritos(casa)).toEqual(['AGÊNCIA IDE', 'IDEAL HUB', 'CLIENTES']);
  });

  it('os dois `Demandas` da casa continuam distintos', () => {
    // Ide e Ide Hub têm cada uma o seu `Demandas`, e a Ide Hub não é omitida.
    expect(escritos([e('a', 'Demandas', 'Ide'), e('b', 'Demandas', 'Ide Hub')])).toEqual([
      'Ide · Demandas',
      'Ide Hub · Demandas',
    ]);
  });

  it('o nome se compara sem caixa e sem acento', () => {
    expect(escritos([e('a', 'Agência', 'Ide'), e('b', 'AGENCIA', 'Ide Hub')])).toEqual([
      'Ide · Agência',
      'Ide Hub · AGENCIA',
    ]);
  });

  it('homônimo na MESMA empresa não ganha prefixo — ele não desfaria nada', () => {
    expect(escritos([e('a', 'Demandas', 'Ide'), e('b', 'Demandas', 'Ide')])).toEqual([
      'Demandas',
      'Demandas',
    ]);
  });

  it('espaço sem empresa não tem o que escrever, mas o gêmeo dele ganha a sua', () => {
    expect(escritos([e('a', 'Demandas', null), e('b', 'Demandas', 'Ide')])).toEqual([
      'Demandas',
      'Ide · Demandas',
    ]);
  });
});

describe('unidadesDoEspacoNovo — o que o balão "Espaço novo" oferece (F31)', () => {
  const catalogo = [
    { id: 'sem', name: 'Sem categoria' },
    { id: 'ide', name: 'Ide' },
    { id: 'hub', name: 'Ide Hub' },
    { id: 'a9', name: 'Alma9' },
  ];
  const ids = (arvore: { categoryId: string | null }[]) =>
    unidadesDoEspacoNovo(catalogo, arvore).map((u) => u.id);

  it('só as unidades donas de algum espaço que a pessoa alcança', () => {
    expect(ids([{ categoryId: 'ide' }, { categoryId: 'ide' }])).toEqual(['ide']);
    expect(ids([{ categoryId: 'ide' }, { categoryId: 'hub' }])).toEqual(['ide', 'hub']);
  });

  it('NUNCA "Sem categoria", nem quando um espaço é dela', () => {
    expect(ids([{ categoryId: 'sem' }, { categoryId: 'ide' }])).toEqual(['ide']);
  });

  it('árvore vazia cai no catálogo, sem a linha técnica — o primeiro espaço precisa de onde nascer', () => {
    expect(ids([])).toEqual(['ide', 'hub', 'a9']);
    expect(ids([{ categoryId: null }])).toEqual(['ide', 'hub', 'a9']);
  });
});
