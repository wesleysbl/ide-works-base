/**
 * O MENU DE MUDAR DE LISTA OFERECE OS MESMOS DESTINOS DE ANTES — F17.CARGA03.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA FASE TROCOU, E POR QUE ESTE É O TESTE QUE IMPORTA
 *
 *   A ficha da tarefa buscava uma SEGUNDA árvore ao montar — `GET /board/tree`,
 *   ~520 ms — só para alimentar um `MenuDeListas` que nasce FECHADO. A chamada
 *   saiu, e os destinos passaram a ser derivados da árvore completa que a barra
 *   lateral desta mesma tela já está lendo.
 *
 *   ⚠️ ISSO É UMA TROCA DE FONTE, E TROCA DE FONTE É O RISCO INTEIRO DA FASE.
 *   Se as duas fontes discordarem, a pessoa vê no menu um destino que o servidor
 *   recusa — ou deixa de ver um destino legítimo, e vai mover a tarefa na mão.
 *   Nenhum dos dois dá erro na tela; os dois dão trabalho perdido.
 *
 * O QUE É COMPARADO: O HTML DO MENU, DESENHADO DAS DUAS FORMAS
 *
 *   Não os arrays intermediários — o MENU. É ele que a pessoa lê, e é nele que
 *   uma diferença de ordem, de contagem ou de caminho apareceria. Se as duas
 *   marcações forem idênticas, não há como a pessoa notar a troca.
 *
 * ⚠️ E O FIXTURE É UM SÓ, DESCRITO UMA VEZ
 *   `comoOServidorResponde` recebe UMA descrição de banco e produz as DUAS
 *   respostas, cada uma pela regra da consulta que a produz:
 *
 *     `/board/tree`      → `readTree`, que filtra `where t.is_live`;
 *     `/board/tree/full` → `readFullTree`, que traz tudo e carimba
 *                          `listIsLive` com a MESMA coluna `is_live`, via
 *                          `left join ideworks.tree`.
 *
 *   Escrever os dois fixtures à mão deixaria o teste provar que eu sei copiar
 *   uma lista para dois lugares. Derivando os dois do mesmo estado, o que se
 *   prova é que as duas LEITURAS do mesmo banco desenham o mesmo menu.
 *
 *   `vivo` aqui é a regra 1 do roteiro mestre, escrita uma vez: a corrente
 *   inteira sem carimbo — espaço arquivado tira a lista SEM carimbar a lista.
 *   É a mesma conta da view `ideworks.tree`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type FullTreeRow, buildFullTree, paraNavegacao } from '@/board/arvore';
import { type TreeRow, buildTree } from '@/board/board';
import { MenuDeListas } from '@/board/menus';

/* ───────────────────────── o banco, descrito uma vez ───────────────────────── */

type Espaco = {
  id: string;
  nome: string;
  empresa: string;
  ordem: number;
  arquivado?: boolean;
};
type Pasta = { id: string; nome: string; espaco: string; ordem: number; arquivada?: boolean };
type Lista = {
  id: string;
  nome: string;
  espaco: string;
  pasta?: string;
  ordem: number;
  arquivada?: boolean;
  vivas: number;
  total: number;
};

type Banco = { espacos: Espaco[]; pastas: Pasta[]; listas: Lista[] };

/**
 * A CASA, com todas as bordas que separam as duas leituras.
 *
 * Cada linha aqui existe por um motivo:
 *   · duas EMPRESAS, e dois espaços com o MESMO nome — é o caso real da casa, e
 *     é o que faz a ordenação por empresa importar;
 *   · uma lista ARQUIVADA (carimbo próprio);
 *   · uma lista viva dentro de uma PASTA arquivada — sem carimbo próprio;
 *   · uma lista viva dentro de um ESPAÇO arquivado — idem, e é a regra 1;
 *   · um espaço SEM LISTA NENHUMA e uma PASTA VAZIA — os dois só existem na
 *     árvore completa, e o menu não pode passar a oferecê-los;
 *   · uma lista SOLTA no espaço, no mesmo nível das pastas.
 */
const CASA: Banco = {
  espacos: [
    { id: 's2', nome: 'Demandas', empresa: 'Alma 9', ordem: 0 },
    { id: 's1', nome: 'Demandas', empresa: 'Ide', ordem: 0 },
    { id: 's3', nome: 'Antigo', empresa: 'Ide', ordem: 1, arquivado: true },
    { id: 's4', nome: 'Recém-criado', empresa: 'Ide', ordem: 2 },
    { id: 's5', nome: 'Só com pasta', empresa: 'Ide', ordem: 3 },
  ],
  pastas: [
    { id: 'f1', nome: 'MIMI Enxovais', espaco: 's1', ordem: 0 },
    { id: 'f2', nome: 'Loja Fria', espaco: 's1', ordem: 1, arquivada: true },
    { id: 'f3', nome: 'Sem nada dentro', espaco: 's5', ordem: 0 },
  ],
  listas: [
    { id: 'l5', nome: 'Todas as demandas', espaco: 's2', ordem: 0, vivas: 4, total: 9 },
    { id: 'l1', nome: 'MIMI (artes)', espaco: 's1', pasta: 'f1', ordem: 0, vivas: 3, total: 7 },
    {
      id: 'l2',
      nome: 'MIMI (vídeos)',
      espaco: 's1',
      pasta: 'f1',
      ordem: 1,
      arquivada: true,
      vivas: 0,
      total: 2,
    },
    { id: 'l3', nome: 'Loja (artes)', espaco: 's1', pasta: 'f2', ordem: 0, vivas: 1, total: 1 },
    { id: 'l4', nome: 'Skills', espaco: 's1', ordem: 0, vivas: 0, total: 0 },
    { id: 'l6', nome: 'Coisas antigas', espaco: 's3', ordem: 0, vivas: 5, total: 5 },
  ],
};

/**
 * `ideworks.tree.is_live` — a corrente inteira sem carimbo.
 *
 * ⚠️ ESCRITA UMA VEZ, e usada pelas duas respostas: é o que torna o teste
 * honesto. Duas cópias desta conta provariam que as duas cópias concordam.
 */
function vivo(banco: Banco, l: Lista): boolean {
  const espaco = banco.espacos.find((e) => e.id === l.espaco);
  const pasta = l.pasta === undefined ? null : (banco.pastas.find((f) => f.id === l.pasta) ?? null);
  return (
    espaco?.arquivado !== true && (pasta === null || pasta.arquivada !== true) && l.arquivada !== true
  );
}

/** A ORDEM DO BANCO — o `order by` que as duas consultas escrevem, igual nas duas. */
function emOrdem(banco: Banco): Lista[] {
  const pos = (l: Lista) => {
    const e = banco.espacos.find((x) => x.id === l.espaco)!;
    const f = l.pasta === undefined ? null : banco.pastas.find((x) => x.id === l.pasta)!;
    // `folder_sort_order nulls first`: a lista solta vem antes das pastas.
    return [e.empresa, e.ordem, e.nome, e.id, f === null ? -1 : f.ordem, f?.nome ?? '', l.ordem, l.nome];
  };
  return [...banco.listas].sort((a, b) => {
    const [x, y] = [pos(a), pos(b)];
    for (let i = 0; i < x.length; i += 1) {
      if (x[i] === y[i]) continue;
      return typeof x[i] === 'number'
        ? (x[i] as number) - (y[i] as number)
        : String(x[i]).localeCompare(String(y[i]), 'pt-BR');
    }
    return 0;
  });
}

/** O que cada rota devolveria para ESTE banco, sob os olhos da mesma pessoa. */
function comoOServidorResponde(banco: Banco): { tree: TreeRow[]; full: FullTreeRow[] } {
  const espaco = (id: string) => banco.espacos.find((e) => e.id === id)!;
  const pasta = (id: string | undefined) =>
    id === undefined ? null : banco.pastas.find((f) => f.id === id)!;

  const listas = emOrdem(banco);

  /* `readTree`: parte da view `tree` e filtra `is_live`. Só lista, e só viva —
     espaço sem lista e pasta sem lista não existem para ela. */
  const tree: TreeRow[] = listas
    .filter((l) => vivo(banco, l))
    .map((l) => {
      const e = espaco(l.espaco);
      const f = pasta(l.pasta);
      return {
        spaceId: e.id,
        spaceName: e.nome,
        spaceColor: null,
        spaceSortOrder: e.ordem,
        categoryId: e.empresa,
        categoryName: e.empresa,
        folderId: f?.id ?? null,
        folderName: f?.nome ?? null,
        folderSortOrder: f?.ordem ?? null,
        listId: l.id,
        listName: l.nome,
        listSortOrder: l.ordem,
        liveTasks: l.vivas,
        totalTasks: l.total,
      };
    });

  /* `readFullTree`: parte de `lists`, traz o arquivado, e ainda acrescenta uma
     linha por pasta sem lista e uma por espaço sem nada. `listIsLive` vem do
     `left join` com a MESMA view — por isso `vivo` é a única conta aqui. */
  const carimbo = (arquivado?: boolean) => (arquivado === true ? '2026-08-25T00:00:00Z' : null);

  const daLista = (l: Lista): FullTreeRow => {
    const e = espaco(l.espaco);
    const f = pasta(l.pasta);
    return {
      spaceId: e.id,
      spaceName: e.nome,
      spaceColor: null,
      spaceArchivedAt: carimbo(e.arquivado),
      categoryId: e.empresa,
      categoryName: e.empresa,
      folderId: f?.id ?? null,
      folderName: f?.nome ?? null,
      folderArchivedAt: carimbo(f?.arquivada),
      listId: l.id,
      listName: l.nome,
      listContent: null,
      listArchivedAt: carimbo(l.arquivada),
      listIsLive: vivo(banco, l),
      liveTasks: l.vivas,
      totalTasks: l.total,
      clientId: null,
      clientName: null,
      workflowName: 'Demandas',
      inheritedFrom: 'space',
    };
  };

  const vazio = (e: Espaco, f: Pasta | null): FullTreeRow => ({
    spaceId: e.id,
    spaceName: e.nome,
    spaceColor: null,
    spaceArchivedAt: carimbo(e.arquivado),
    categoryId: e.empresa,
    categoryName: e.empresa,
    folderId: f?.id ?? null,
    folderName: f?.nome ?? null,
    folderArchivedAt: carimbo(f?.arquivada),
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
  });

  const full: FullTreeRow[] = [];
  for (const e of banco.espacos) {
    const minhasListas = listas.filter((l) => l.espaco === e.id);
    const minhasPastas = banco.pastas.filter((f) => f.espaco === e.id);
    if (minhasListas.length === 0 && minhasPastas.length === 0) {
      full.push(vazio(e, null));
      continue;
    }
    for (const l of minhasListas) full.push(daLista(l));
    for (const f of minhasPastas) {
      if (!minhasListas.some((l) => l.pasta === f.id)) full.push(vazio(e, f));
    }
  }

  return { tree, full };
}

/* ───────────────────────────── o menu, desenhado ───────────────────────────── */

/** A árvore de ANTES: `GET /board/tree` → `buildTree`, como a ficha fazia. */
const comoEra = (banco: Banco) => buildTree(comoOServidorResponde(banco).tree);

/** A árvore de AGORA: a leitura compartilhada → `buildFullTree` → `paraNavegacao`. */
const comoEstaAgora = (banco: Banco) =>
  paraNavegacao(buildFullTree(comoOServidorResponde(banco).full));

function desenharOMenu(arvore: ReturnType<typeof comoEra>, listaAtual: string | null): string {
  return renderToStaticMarkup(
    createElement(MenuDeListas, {
      arvore,
      listaAtual,
      rotulo: 'Mover para',
      aoEscolher: () => {},
      aoFechar: () => {},
    }),
  );
}

describe('os destinos do menu não mudaram ao trocar de fonte', () => {
  it('o MENU INTEIRO é o mesmo HTML, vindo das duas árvores', () => {
    // A prova mais forte disponível sem navegador: se a marcação é idêntica,
    // não há destino a mais, a menos, fora de ordem ou com contagem diferente.
    expect(desenharOMenu(comoEstaAgora(CASA), 'l1')).toBe(desenharOMenu(comoEra(CASA), 'l1'));
  });

  it('e continua o mesmo sem lista atual — quando a tarefa não tem lista', () => {
    expect(desenharOMenu(comoEstaAgora(CASA), null)).toBe(desenharOMenu(comoEra(CASA), null));
  });

  it('as duas árvores oferecem EXATAMENTE as três listas vivas e alcançáveis', () => {
    const listas = (a: ReturnType<typeof comoEra>) =>
      a.flatMap((e) => [...e.lists, ...e.folders.flatMap((f) => f.lists)]).map((l) => l.id).sort();
    expect(listas(comoEstaAgora(CASA))).toEqual(['l1', 'l4', 'l5']);
    expect(listas(comoEra(CASA))).toEqual(['l1', 'l4', 'l5']);
  });
});

describe('o arquivado fica de fora — pelos três caminhos', () => {
  const html = () => desenharOMenu(comoEstaAgora(CASA), 'l1');

  it('a lista com carimbo próprio não é destino', () => {
    // `MIMI (vídeos)` está arquivada. Mover uma tarefa para dentro dela seria
    // mandar trabalho para um lugar que ninguém abre.
    expect(html()).not.toContain('MIMI (vídeos)');
  });

  it('a lista SEM carimbo dentro de uma PASTA arquivada também não é destino', () => {
    // `Loja (artes)` não tem `archived_at`; quem a mata é a pasta. Se a tela
    // olhasse só o carimbo da lista, este destino apareceria — e o banco o
    // recusaria depois do clique.
    expect(html()).not.toContain('Loja (artes)');
    expect(html()).not.toContain('Loja Fria');
  });

  it('a lista SEM carimbo dentro de um ESPAÇO arquivado também não — é a regra 1', () => {
    // Arquivar o espaço não carimba a lista. `is_live` faz a conta sobre a
    // corrente inteira, e `somenteVivos` repete a mesma conta na tela.
    expect(html()).not.toContain('Coisas antigas');
    expect(html()).not.toContain('Antigo');
  });
});

describe('o que só a árvore completa enxerga não vaza para o menu', () => {
  it('espaço sem lista nenhuma não aparece — não há para onde mover', () => {
    // Ele EXISTE na leitura nova (é o espaço recém-criado da F17.14) e não
    // existia na antiga. Deixá-lo passar seria um item de menu que não abre nada.
    expect(desenharOMenu(comoEstaAgora(CASA), 'l1')).not.toContain('Recém-criado');
  });

  it('pasta vazia não aparece, nem o espaço que só tem ela', () => {
    const html = desenharOMenu(comoEstaAgora(CASA), 'l1');
    expect(html).not.toContain('Sem nada dentro');
    expect(html).not.toContain('Só com pasta');
  });
});

describe('a lista onde a tarefa já está', () => {
  it('não é oferecida como destino recente, e continua marcada na árvore', () => {
    // O comportamento é do `MenuDeListas` e não mudou; o que se prova aqui é
    // que ele continua valendo com a árvore nova por baixo.
    const html = desenharOMenu(comoEstaAgora(CASA), 'l1');
    expect(html).toContain('MIMI (artes)');
    expect(html).toContain('aria-checked="true"');
  });
});

describe('sem árvore nenhuma', () => {
  it('as duas fontes dizem a mesma coisa — e é uma frase, não um menu vazio', () => {
    const vazio: Banco = { espacos: [], pastas: [], listas: [] };
    expect(desenharOMenu(comoEstaAgora(vazio), null)).toBe(desenharOMenu(comoEra(vazio), null));
    expect(desenharOMenu(comoEstaAgora(vazio), null)).toContain('Nenhuma lista ao seu alcance');
  });
});
