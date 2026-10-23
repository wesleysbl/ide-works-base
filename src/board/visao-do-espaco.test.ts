/**
 * A CONTA DA VISÃO DO ESPAÇO — etapa F17.26.
 *
 * O que se prova aqui é ARITMÉTICA e FORMA, não desenho: que `feitas` sai de
 * `total − emAberto` e não do contrário, que a pasta soma só as listas que
 * chegaram (é assim que o número não vaza o que a parede da F17.23 esconde), e
 * que a lista SOLTA — a que todo desenho ingênuo perde — entra na conta do
 * espaço.
 *
 * O caminho inteiro, com política de linha de verdade, é
 * `scripts/provar-visao-do-espaco.mjs`.
 */

import { describe, expect, it } from 'vitest';

import { type FullTreeRow, buildFullTree } from '@/board/arvore';
import {
  acharEspaco,
  montarVisaoDoEspaco,
  percentagem,
  progressoDaLista,
  rotuloDoProgresso,
  somar,
} from '@/board/visao-do-espaco';

const base: FullTreeRow = {
  spaceId: 's1',
  spaceName: 'Demandas',
  spaceColor: '#7c8cff',
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
  clientId: null,
  clientName: null,
  workflowName: null,
  inheritedFrom: null,
};

/** Uma pasta com duas listas, e uma lista SOLTA ao lado — a forma real. */
const LINHAS: FullTreeRow[] = [
  {
    ...base,
    folderId: 'f1',
    folderName: 'Cronograma',
    listId: 'l1',
    listName: 'Setembro',
    listIsLive: true,
    liveTasks: 1,
    totalTasks: 4,
    workflowName: 'Padrão',
    inheritedFrom: 'list',
  },
  {
    ...base,
    folderId: 'f1',
    folderName: 'Cronograma',
    listId: 'l2',
    listName: 'Outubro',
    listIsLive: true,
    liveTasks: 2,
    totalTasks: 2,
    workflowName: 'Padrão',
    inheritedFrom: 'folder',
  },
  {
    ...base,
    listId: 'l3',
    listName: 'Todas as demandas',
    listIsLive: true,
    liveTasks: 0,
    totalTasks: 14,
    workflowName: 'Demandas',
    inheritedFrom: 'space',
  },
];

const arvore = buildFullTree(LINHAS);
const espaco = arvore[0];

describe('a percentagem não mente nos dois extremos', () => {
  it('cheio só é 100 quando é cheio', () => {
    expect(percentagem(999, 1000)).toBe(99);
    expect(percentagem(1000, 1000)).toBe(100);
  });

  it('vazio só é 0 quando é vazio', () => {
    expect(percentagem(1, 1000)).toBe(1);
    expect(percentagem(0, 1000)).toBe(0);
  });

  it('sem tarefa nenhuma, é zero — e não uma divisão por zero', () => {
    expect(percentagem(0, 0)).toBe(0);
    expect(Number.isFinite(percentagem(0, 0))).toBe(true);
  });
});

describe('o progresso de uma lista', () => {
  it('`feitas` é total menos em aberto, e não o contrário', () => {
    const l = espaco.folders[0].lists[0];
    expect(progressoDaLista(l)).toMatchObject({ feitas: 3, emAberto: 1, total: 4, pct: 75 });
  });

  it('lista com tudo em aberto tem zero feitas', () => {
    const l = espaco.folders[0].lists[1];
    expect(progressoDaLista(l)).toMatchObject({ feitas: 0, emAberto: 2, total: 2, pct: 0 });
  });

  it('lista com tudo concluído chega a 100', () => {
    const l = espaco.lists[0];
    expect(progressoDaLista(l)).toMatchObject({ feitas: 14, emAberto: 0, total: 14, pct: 100 });
  });

  it('em aberto maior que o total não produz feitas negativas', () => {
    const torto = { ...espaco.lists[0], liveTasks: 99, totalTasks: 3 };
    expect(progressoDaLista(torto)).toMatchObject({ feitas: 0, emAberto: 3, total: 3 });
  });
});

describe('a soma da pasta e a do espaço', () => {
  const visao = montarVisaoDoEspaco(espaco, false);

  it('a pasta soma as listas dela, e só elas', () => {
    expect(visao.pastas).toHaveLength(1);
    expect(visao.pastas[0].progresso).toMatchObject({ feitas: 3, total: 6, listas: 2 });
  });

  it('a LISTA SOLTA aparece — é o caso que todo desenho ingênuo perde', () => {
    expect(visao.soltas.map((l) => l.name)).toEqual(['Todas as demandas']);
  });

  it('o espaço soma pasta + solta', () => {
    expect(visao.progresso).toMatchObject({ feitas: 17, emAberto: 3, total: 20, listas: 3 });
  });

  it('a lista que NÃO chegou não entra na conta — é assim que a parede não vaza', () => {
    // A política de linha da F17.23 não devolve a lista escondida. Aqui isso é
    // simulado tirando-a da entrada: a conta cai junto, sem saber que ela some.
    const semSolta = buildFullTree(LINHAS.filter((r) => r.listId !== 'l3'));
    const menor = montarVisaoDoEspaco(semSolta[0], false);
    expect(menor.progresso).toMatchObject({ feitas: 3, total: 6, listas: 2 });
    expect(menor.soltas).toHaveLength(0);
  });
});

describe('os três casos de borda abrem sem quebrar', () => {
  it('espaço vazio: sem pasta, sem lista, e ele SABE que está vazio', () => {
    const vazio = buildFullTree([base])[0];
    const visao = montarVisaoDoEspaco(vazio, false);
    expect(visao.vazio).toBe(true);
    expect(visao.progresso.total).toBe(0);
    expect(rotuloDoProgresso(visao.progresso)).toBe('sem tarefas');
  });

  it('espaço SÓ com lista solta: não é vazio, e o número é o dela', () => {
    const so = buildFullTree(LINHAS.filter((r) => r.listId === 'l3'))[0];
    const visao = montarVisaoDoEspaco(so, false);
    expect(visao.vazio).toBe(false);
    expect(visao.pastas).toHaveLength(0);
    expect(visao.progresso).toMatchObject({ feitas: 14, total: 14 });
  });

  it('espaço arquivado abre, e as listas dele continuam contando', () => {
    const arquivado = buildFullTree(
      LINHAS.map((r) => ({ ...r, spaceArchivedAt: '2026-08-01T00:00:00Z', listIsLive: false })),
    )[0];
    // Com o interruptor desligado, nada de morto aparece — e isso é honesto:
    // é a MESMA regra da árvore ao lado.
    expect(montarVisaoDoEspaco(arquivado, false).vazio).toBe(true);
    // Ligado, tudo volta.
    expect(montarVisaoDoEspaco(arquivado, true).progresso.total).toBe(20);
  });

  it('a lista arquivada some do número quando o interruptor está desligado', () => {
    const comArquivada = buildFullTree(
      LINHAS.map((r) =>
        r.listId === 'l3'
          ? { ...r, listArchivedAt: '2026-08-01T00:00:00Z', listIsLive: false }
          : r,
      ),
    )[0];
    expect(montarVisaoDoEspaco(comArquivada, false).progresso.total).toBe(6);
    expect(montarVisaoDoEspaco(comArquivada, true).progresso.total).toBe(20);
  });
});

describe('achar o espaço', () => {
  it('acha pelo id', () => {
    expect(acharEspaco(arvore, 's1')?.name).toBe('Demandas');
  });

  it('id que não está ao alcance devolve nulo, e não estoura', () => {
    expect(acharEspaco(arvore, 'nao-existe')).toBeNull();
    expect(acharEspaco(arvore, undefined)).toBeNull();
  });
});

describe('o rótulo é frase, e não sigla', () => {
  it('conta as concluídas', () => {
    expect(rotuloDoProgresso(somar(espaco.lists))).toBe('14/14 concluídas');
  });
});

describe('o vínculo de cliente viaja com a lista, sem unicidade', () => {
  it('duas listas do mesmo cliente chegam as duas com o nome', () => {
    const visao = montarVisaoDoEspaco(
      buildFullTree([
        {
          ...base,
          listId: 'l1',
          listName: 'Demandas',
          listIsLive: true,
          clientId: 'cli-1',
          clientName: 'Jatobá',
        },
        {
          ...base,
          listId: 'l2',
          listName: 'Conteúdo',
          listIsLive: true,
          clientId: 'cli-1',
          clientName: 'Jatobá',
        },
      ])[0],
      false,
    );
    expect(visao.soltas.map((l) => l.name)).toEqual(['Demandas', 'Conteúdo']);
    expect(visao.soltas.map((l) => l.clientId)).toEqual(['cli-1', 'cli-1']);
    expect(visao.soltas.map((l) => l.clientName)).toEqual(['Jatobá', 'Jatobá']);
  });

  it('identificador sem nome chega sem nome — a visão não inventa o que a árvore apagou', () => {
    const visao = montarVisaoDoEspaco(
      buildFullTree([
        {
          ...base,
          listId: 'l1',
          listName: 'Demandas',
          listIsLive: true,
          clientId: 'cli-1',
          clientName: null,
        },
      ])[0],
      false,
    );
    expect(visao.soltas[0].clientId).toBe('cli-1');
    expect(visao.soltas[0].clientName).toBeNull();
  });
});
