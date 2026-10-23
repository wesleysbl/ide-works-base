/**
 * As contas puras dos passos da tarefa — F17.15.
 *
 * O QUE ESTE TESTE NÃO PROVA, E ISSO IMPORTA
 *   Nenhuma regra de domínio desta etapa mora aqui. "A subtarefa fica na lista
 *   da mãe", "apagar a mãe leva as filhas", "ciclo é proibido", "o item tem UM
 *   nível" e "o nome `{}` é recusado" são do BANCO, e quem as prova é
 *   `scripts/provar-subtarefas-e-checklists.mjs`, conectado como `ideworks_app`
 *   — o papel que a política alcança. Provar regra de banco em TypeScript é
 *   provar a cópia, não a regra.
 *
 *   O que se prova aqui é o que a tela calcula sozinha: a contagem, a frase da
 *   contagem, o aninhamento do item, e a validação de conforto do nome.
 */

import { describe, expect, it } from 'vitest';

import {
  type ChecklistItem,
  aninharItens,
  conferirNomeComSentido,
  contarItens,
  ondeNasce,
  porBarra,
  porExtenso,
  proximaPosicao,
  rotuloDeSubtarefas,
  rotuloDoInterruptor,
  subtarefaVazia,
} from '@/board/passos';

const item = (p: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'i1',
  checklistId: 'k1',
  parentItemId: null,
  name: 'passo',
  sortOrder: 0,
  resolvedAt: null,
  assignee: null,
  children: [],
  ...p,
});

/* ───────────────────────────── a contagem ───────────────────────────── */

describe('a contagem do checklist conta o filho também', () => {
  it('`0 de 1` — o número da tela real, com um item por fazer', () => {
    const c = contarItens([item({ id: 'a' })]);
    expect(c).toEqual({ resolvidos: 0, total: 1 });
    expect(porExtenso(c.resolvidos, c.total)).toBe('0 de 1');
  });

  it('o SUBITEM entra na conta: um item com um filho por fazer é 1 de 2', () => {
    // A pergunta que o contador responde é "quanto deste checklist está feito",
    // e um subitem por fazer é trabalho por fazer. É a mesma definição de
    // `task_progress.checklist_total` no banco — as duas TÊM que concordar,
    // senão o cartão do quadro e a ficha diriam números diferentes.
    const c = contarItens([
      item({ id: 'a', resolvedAt: '2026-08-26T10:00:00.000Z' }),
      item({ id: 'b', parentItemId: 'a' }),
    ]);
    expect(c).toEqual({ resolvidos: 1, total: 2 });
  });

  it('a forma curta é a do cartão, e a longa é a da ficha', () => {
    // A referência mostra `0 de 0` POR EXTENSO ao lado do nome do checklist. No
    // cartão do quadro não cabem três palavras, e ali vale a barra.
    expect(porExtenso(2, 5)).toBe('2 de 5');
    expect(porBarra(2, 5)).toBe('2/5');
  });
});

/* ───────────────────────────── o aninhamento ───────────────────────────── */

describe('os itens achatados viram árvore de um nível', () => {
  it('o filho entra debaixo do pai, e não na raiz', () => {
    const arvore = aninharItens([
      item({ id: 'a', sortOrder: 0 }),
      item({ id: 'b', parentItemId: 'a', sortOrder: 0 }),
      item({ id: 'c', sortOrder: 1 }),
    ]);
    expect(arvore.map((x) => x.id)).toEqual(['a', 'c']);
    expect(arvore[0].children.map((x) => x.id)).toEqual(['b']);
  });

  it('a ordem é a de `sort_order`, e o nome só desempata', () => {
    const arvore = aninharItens([
      item({ id: 'z', name: 'zebra', sortOrder: 0 }),
      item({ id: 'a', name: 'abacate', sortOrder: 1 }),
    ]);
    expect(arvore.map((x) => x.id)).toEqual(['z', 'a']);
  });

  it('ÓRFÃO NÃO SOME — ele sobe para a raiz', () => {
    // O banco não deixa nascer um item cujo pai esteja em outro checklist
    // (`checklist_items_parent_fk`). Se um aparecer mesmo assim, esconder
    // trabalho é o pior defeito possível numa lista de passos.
    const arvore = aninharItens([item({ id: 'b', parentItemId: 'sumiu' })]);
    expect(arvore.map((x) => x.id)).toEqual(['b']);
  });

  it('não modifica o array que recebeu', () => {
    const original = [item({ id: 'a' }), item({ id: 'b', parentItemId: 'a' })];
    aninharItens(original);
    expect(original[0].children).toEqual([]);
  });
});

/* ───────────────────────────── a ordem ───────────────────────────── */

describe('a próxima posição é `max + 1`, e não `length`', () => {
  it('vazio começa em zero', () => {
    expect(proximaPosicao([])).toBe(0);
  });

  it('com um buraco no meio, o item novo vai para o FIM', () => {
    // Com `length` o item novo nasceria com a posição de um que já existe, e a
    // ordem passaria a depender do desempate por nome: ele apareceria no meio
    // da lista sem ninguém ter pedido.
    expect(proximaPosicao([{ sortOrder: 0 }, { sortOrder: 7 }])).toBe(8);
  });
});

/* ───────────────────────────── o nome ───────────────────────────── */

describe('a validação de conforto usa a MESMA regra medida na F17.4', () => {
  it('recusa o `{}` do Trello, e a mensagem diz de onde ele veio', () => {
    const erro = conferirNomeComSentido('{}');
    expect(erro).not.toBeNull();
    expect(erro).toContain('Trello');
  });

  it('recusa vazio, só espaço e só pontuação', () => {
    for (const n of ['', '   ', '[]', '---', '...', '«»', '—']) {
      expect(conferirNomeComSentido(n), `deveria recusar ${JSON.stringify(n)}`).not.toBeNull();
    }
  });

  it('ACEITA emoji, seta e sinal — porque o BANCO aceita, e foi medido', () => {
    // Passados 21 nomes por `ideworks.is_meaningful_name` em 2026-08-26, o
    // Postgres ACEITOU `+++`, `===`, `→`, `🎬` e `✅`: `[[:punct:]]` lá é a
    // PONTUAÇÃO Unicode, e símbolo não entra nela.
    //
    // A primeira versão desta função usava `[\p{P}\p{S}\s]` e era mais severa
    // que a regra — ela recusaria nomes que o banco aceita. Validação de
    // conforto mais severa que a regra é pior que validação nenhuma: mente
    // sobre o que o sistema aceita.
    for (const n of ['🎬', '✅', '→', '+++', '===']) {
      expect(conferirNomeComSentido(n), `deveria aceitar ${JSON.stringify(n)}`).toBeNull();
    }
  });

  it('aceita acento, pontuação NO MEIO e nome de um caractere', () => {
    for (const n of ['vídeo', 'ação', 'publicar/agendar', 'C++', '3']) {
      expect(conferirNomeComSentido(n), `deveria aceitar ${JSON.stringify(n)}`).toBeNull();
    }
  });
});

/* ───────────────────────────── o que a tela escreve ───────────────────────────── */

describe('as frases da tela', () => {
  it('o plural da subtarefa', () => {
    expect(rotuloDeSubtarefas(0)).toBe('nenhuma subtarefa');
    expect(rotuloDeSubtarefas(1)).toBe('1 subtarefa');
    expect(rotuloDeSubtarefas(5)).toBe('5 subtarefas');
  });

  it('o interruptor NOMEIA quantos cartões estão escondidos', () => {
    // Um botão que só diz "Subtarefas" deixa a pessoa sem saber se há algo do
    // outro lado — e quem criou uma subtarefa e não a vê no quadro conclui que o
    // sistema a perdeu.
    expect(rotuloDoInterruptor(5, false)).toBe('Subtarefas · 5 escondidas');
    expect(rotuloDoInterruptor(1, false)).toBe('Subtarefas · 1 escondida');
    expect(rotuloDoInterruptor(0, false)).toBe('Subtarefas');
    expect(rotuloDoInterruptor(5, true)).toBe('Subtarefas · visíveis no quadro');
  });

  it('a subtarefa vazia nasce sem nada escolhido', () => {
    expect(subtarefaVazia()).toEqual({
      title: '',
      dueOn: null,
      startOn: null,
      priority: null,
      statusId: null,
      assigneeIds: [],
      tagIds: [],
    });
  });
});

describe('a tela DIZ onde a subtarefa vai nascer, em vez de deixar adivinhar', () => {
  const ARVORE = [
    {
      id: 's1',
      name: 'Demandas',
      color: null,
      categoryName: 'Ide',
      folders: [{ id: 'f1', name: 'Clientes', lists: [{ id: 'l2', name: 'Fiorart', liveTasks: 0, totalTasks: 0 }] }],
      lists: [{ id: 'l1', name: 'Todas as demandas', liveTasks: 0, totalTasks: 0 }],
    },
  ];

  it('lista solta no espaço', () => {
    expect(ondeNasce(ARVORE, 'l1')).toBe('Demandas / Todas as demandas');
  });

  it('lista dentro de pasta', () => {
    expect(ondeNasce(ARVORE, 'l2')).toBe('Demandas / Clientes / Fiorart');
  });

  it('sem lista, e lista desconhecida, não inventam nome', () => {
    expect(ondeNasce(ARVORE, null)).toBeNull();
    expect(ondeNasce(ARVORE, 'sumiu')).toBeNull();
  });
});
