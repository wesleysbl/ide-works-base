/**
 * A trilha, como REGRA — etapa F17.25.
 *
 * ⚠️ TRÊS DESTES TESTES VIERAM DE `meu-trabalho.test.ts`, E NÃO SÃO NOVOS
 *   `trilha(row): string[]` morava lá e devolvia só os nomes. A F17.25 fez a
 *   trilha virar uma peça só para as quatro telas do Pilar B, e para isso ela
 *   precisa dos ids — o degrau de lista clica, e o de espaço e pasta abre o nó
 *   na árvore. As duas versões dariam duas verdades sobre o mesmo caminho.
 *
 *   As garantias de lá continuam aqui, reescritas contra `degrausDaArvore`: a
 *   ordem dos níveis, o pedaço que SOME em vez de virar buraco, e a tarefa sem
 *   lista que devolve trilha vazia para a tela escrever "sem lista".
 */

import { describe, expect, it } from 'vitest';

import {
  type Degrau,
  TETO,
  degrausDaArvore,
  destinoAcima,
  encurtar,
  trilhaDaLinha,
  trilhaDaTarefa,
  trilhaDaTela,
  trilhaDaPasta,
  trilhaDeDetalhe,
  trilhaDoEspaco,
  trilhaDoQuadro,
  trilhaEmEspera,
} from '@/board/trilha';

/* O `categoryName` fica no lugar de propósito: é o que a linha e o cabeçalho
   reais trazem (`WorkRow`, o quadro), e a F31 prova que ele NÃO vira degrau. */
const lugar = {
  categoryName: 'Alma9',
  spaceId: 'e1',
  spaceName: 'ALMA 9',
  spaceColor: '#7c3aed',
  folderId: 'p1',
  folderName: 'FOCUS Ibitinga',
  listId: 'l1',
  listName: 'FOCUS (Vídeos)',
};

const nomes = (degraus: readonly Degrau[]) => degraus.map((d) => d.nome);
const tipos = (degraus: readonly Degrau[]) => degraus.map((d) => d.tipo);

/* ═════════════ o que veio de `meu-trabalho.test.ts` ═════════════ */

describe('os níveis da árvore, na ordem', () => {
  it('junta espaço, pasta e lista, nessa ordem — sem a empresa (F31)', () => {
    expect(nomes(degrausDaArvore(lugar))).toEqual(['ALMA 9', 'FOCUS Ibitinga', 'FOCUS (Vídeos)']);
    expect(tipos(degrausDaArvore(lugar))).toEqual(['espaco', 'pasta', 'lista']);
  });

  it('F31: a empresa que chega no lugar NÃO vira degrau, em nenhuma trilha', () => {
    // "Será apenas Ide" (Wesley, 25/09). O campo continua vindo do servidor;
    // a trilha só não o lê.
    const todas = [
      degrausDaArvore(lugar),
      trilhaDoQuadro(lugar),
      trilhaDaPasta(lugar),
      trilhaDoEspaco(lugar),
      trilhaDaTarefa({ ...lugar, title: 'Gravar depoimento' }),
      trilhaDaLinha(lugar),
    ];
    for (const degraus of todas) expect(nomes(degraus)).not.toContain('Alma9');
  });

  it('sem pasta, a pasta SOME em vez de virar buraco', () => {
    // Lista solta no espaço é caso real — a `Todas as demandas` do espaço
    // `Demandas` não tem pasta.
    const sem = degrausDaArvore({ ...lugar, folderId: null, folderName: null });
    expect(nomes(sem)).toEqual(['ALMA 9', 'FOCUS (Vídeos)']);
  });

  it('tarefa sem lista devolve trilha vazia — a tela escreve "sem lista"', () => {
    // `createTask` do Pilar A′ insere tarefa sem lista, por desenho (F17.3).
    expect(
      trilhaDaLinha({
        spaceName: null,
        folderName: null,
        listName: null,
      }),
    ).toEqual([]);
  });
});

/* ═════════════ para onde cada degrau leva ═════════════ */

describe('só quem tem lugar de verdade clica', () => {
  it('a lista leva ao quadro dela', () => {
    const lista = trilhaDaLinha(lugar).find((d) => d.tipo === 'lista');
    expect(lista?.destino).toBe('/quadro/l1');
  });

  it('lista sem id não vira link — é o caso da lista arquivada', () => {
    // A tela passa `listId: null` quando a lista não está viva: `/quadro/:id`
    // de lista arquivada manda quem clicou para OUTRA lista.
    const lista = trilhaDaLinha({ ...lugar, listId: null }).find((d) => d.tipo === 'lista');
    expect(lista?.destino).toBeNull();
  });

  it('espaço e pasta carregam a CHAVE DO NÓ, que é a mesma de `@/ui/lugar`', () => {
    const degraus = degrausDaArvore(lugar);
    expect(degraus.find((d) => d.tipo === 'espaco')?.no).toBe('space:e1');
    expect(degraus.find((d) => d.tipo === 'pasta')?.no).toBe('folder:p1');
  });

  it('a cor do espaço viaja junto — ela vem do ClickUp, e é dado (D10)', () => {
    expect(degrausDaArvore(lugar).find((d) => d.tipo === 'espaco')?.cor).toBe('#7c3aed');
  });
});

describe('a trilha do quadro', () => {
  const degraus = trilhaDoQuadro(lugar);

  it('começa na raiz que a barra lateral usa — e ela NÃO clica aqui (28/09)', () => {
    // `/quadro` sem id reabre a última lista aberta, que no quadro é esta
    // mesma: o link ia e voltava para a própria tela.
    expect(degraus[0].tipo).toBe('raiz');
    expect(degraus[0].nome).toBe('Compartilhado comigo');
    expect(degraus[0].destino).toBeNull();
  });

  it('O ÚLTIMO DEGRAU NÃO LEVA A LUGAR NENHUM — ele é onde se está', () => {
    // Link para a tela que já está aberta é link que não faz nada.
    const ultimo = degraus[degraus.length - 1];
    expect(ultimo.tipo).toBe('lista');
    expect(ultimo.destino).toBeNull();
  });

  it('espaço e pasta LEVAM às telas deles, e continuam carregando o nó (28/09)', () => {
    // O pedido: "clicar em TIME HELENA abre os cards do Time Helena todos
    // juntos; clicar em AGÊNCIA IDE mostra o conjunto do espaço".
    const espaco = degraus.find((d) => d.tipo === 'espaco');
    const pasta = degraus.find((d) => d.tipo === 'pasta');
    expect(espaco?.destino).toBe('/quadro/espaco/e1');
    expect(pasta?.destino).toBe('/quadro/pasta/p1');
    expect(espaco?.no).toBe('space:e1');
    expect(pasta?.no).toBe('folder:p1');
  });
});

describe('a trilha da visão geral do espaço — F17.26', () => {
  const degraus = trilhaDoEspaco({
    spaceId: lugar.spaceId,
    spaceName: lugar.spaceName,
    spaceColor: lugar.spaceColor,
  });

  it('são dois degraus: a raiz e o espaço (a empresa saiu na F31)', () => {
    expect(tipos(degraus)).toEqual(['raiz', 'espaco']);
    expect(nomes(degraus)).toEqual(['Compartilhado comigo', 'ALMA 9']);
  });

  it('O ESPAÇO É ONDE SE ESTÁ: não leva a lugar nenhum, e não revela nó', () => {
    const ultimo = degraus[degraus.length - 1];
    expect(ultimo.destino).toBeNull();
    // Com `no` preenchido, a trilha desenharia `Mostrar … na barra lateral`
    // para o nó cuja TELA já está aberta.
    expect(ultimo.no).toBeNull();
  });

  it('a cor do espaço continua chegando, para o sinal do degrau', () => {
    expect(degraus.find((d) => d.tipo === 'espaco')?.cor).toBe('#7c3aed');
  });
});

describe('a trilha do quadro da pasta — F17.64', () => {
  const degraus = trilhaDaPasta({
    spaceId: lugar.spaceId,
    spaceName: lugar.spaceName,
    folderId: lugar.folderId,
    folderName: lugar.folderName,
  });

  it('são três degraus: a raiz, o espaço e a pasta (a empresa saiu na F31)', () => {
    expect(tipos(degraus)).toEqual(['raiz', 'espaco', 'pasta']);
    expect(nomes(degraus)).toEqual(['Compartilhado comigo', 'ALMA 9', 'FOCUS Ibitinga']);
  });

  it('A PASTA É ONDE SE ESTÁ: não leva a lugar nenhum, e não revela nó', () => {
    const ultimo = degraus[degraus.length - 1];
    expect(ultimo.destino).toBeNull();
    // Com `no` preenchido, a trilha desenharia `Mostrar … na barra lateral`
    // para o nó cuja TELA já está aberta.
    expect(ultimo.no).toBeNull();
  });

  it('o espaço leva à visão geral dele — e abre o nó junto (28/09)', () => {
    const espaco = degraus.find((d) => d.tipo === 'espaco');
    expect(espaco?.no).toBe('space:e1');
    expect(espaco?.destino).toBe('/quadro/espaco/e1');
  });

  it('sem lista no lugar: a trilha da pasta NÃO desce até lista nenhuma', () => {
    // A pasta é o fim do caminho aqui. Um degrau de lista apareceria se
    // alguém passasse o lugar do quadro inteiro por engano.
    expect(tipos(degraus)).not.toContain('lista');
  });
});

describe('a trilha da ficha da tarefa', () => {
  const degraus = trilhaDaTarefa({ ...lugar, title: 'Gravar depoimento' });

  it('termina no título da tarefa, e ele não clica', () => {
    const ultimo = degraus[degraus.length - 1];
    expect(ultimo.tipo).toBe('tarefa');
    expect(ultimo.nome).toBe('Gravar depoimento');
    expect(ultimo.destino).toBeNull();
  });

  it('espaço e pasta levam às telas DELES, e não ao quadro da lista (28/09)', () => {
    // Antes os três degraus levavam a `/quadro/l1`: `TIME HELENA` abria a
    // mesma coisa que a lista.
    expect(degraus.find((d) => d.tipo === 'espaco')?.destino).toBe('/quadro/espaco/e1');
    expect(degraus.find((d) => d.tipo === 'pasta')?.destino).toBe('/quadro/pasta/p1');
    expect(degraus.find((d) => d.tipo === 'lista')?.destino).toBe('/quadro/l1');
  });

  it('tarefa sem lista: sobram a raiz e o título, e nada aponta para o quadro', () => {
    const soltos = trilhaDaTarefa({ title: 'Demanda antiga do Pilar A′' });
    expect(tipos(soltos)).toEqual(['raiz', 'tarefa']);
  });
});

describe('a trilha do quadro, da pasta e do espaço em carga ou com erro — F29.5b', () => {
  it.each(['Quadro', 'Pasta', 'Espaço'] as const)('%s: `Compartilhado comigo › %s`', (tela) => {
    expect(nomes(trilhaEmEspera(tela))).toEqual(['Compartilhado comigo', tela]);
  });

  it('a raiz clica e leva a `/quadro` — a MESMA raiz das trilhas carregadas', () => {
    const [raiz] = trilhaEmEspera('Quadro');
    expect(raiz.destino).toBe('/quadro');
    expect(raiz).toEqual(trilhaDaPasta(lugar)[0]);
    // No quadro carregado a raiz não clica (28/09): o nome e o tipo são os mesmos.
    expect({ ...trilhaDoQuadro(lugar)[0], destino: '/quadro' }).toEqual(raiz);
  });

  it('a tela onde se está não clica', () => {
    const [, aqui] = trilhaEmEspera('Pasta');
    expect(aqui.destino).toBeNull();
    expect(aqui.no).toBeNull();
  });
});

describe('a trilha das telas que não moram na árvore', () => {
  it('`Minhas tarefas` diz a seção e a tela', () => {
    expect(nomes(trilhaDaTela('minhas'))).toEqual(['Meu trabalho', 'Minhas tarefas']);
  });

  it('`Todas as tarefas` idem', () => {
    expect(nomes(trilhaDaTela('todas'))).toEqual(['Meu trabalho', 'Todas as tarefas']);
  });

  it('nenhum dos dois degraus clica — seção não é lugar, e a tela já está aberta', () => {
    for (const d of trilhaDaTela('minhas')) expect(d.destino).toBeNull();
  });
});

/* ═════════════ o encurtamento ═════════════ */

describe('a trilha longa não empurra o resto', () => {
  const cinco = trilhaDaTarefa({ ...lugar, title: 'Etapa 1: Organização Estratégica Inicial' });

  it('a profundidade máxima do modelo é CINCO, e a ficha é quem chega lá', () => {
    // Compartilhado comigo › espaço › pasta › lista › tarefa. Não há sexto:
    // pasta não aninha, e a empresa saiu da trilha na F31 (eram seis).
    expect(cinco).toHaveLength(5);
    expect(cinco.length).toBeGreaterThan(TETO);
  });

  it('o quadro (quatro degraus) NÃO encurta', () => {
    const quatro = trilhaDoQuadro(lugar);
    expect(quatro).toHaveLength(4);
    expect(encurtar(quatro).every((p) => p.tipo === 'degrau')).toBe(true);
  });

  it('acima do teto, o MEIO vira reticências — e o começo e o fim ficam', () => {
    const pedacos = encurtar(cinco);
    expect(pedacos.map((p) => p.tipo)).toEqual([
      'degrau',
      'reticencias',
      'degrau',
      'degrau',
    ]);
    // O primeiro é o caminho de volta; os dois últimos são "onde estou".
    const visiveis = pedacos.flatMap((p) => (p.tipo === 'degrau' ? [p.degrau.tipo] : []));
    expect(visiveis).toEqual(['raiz', 'lista', 'tarefa']);
  });

  it('as reticências dizem QUANTOS níveis esconderam', () => {
    // Sem o número, o `…` é um botão que não promete nada.
    const meio = encurtar(cinco).find((p) => p.tipo === 'reticencias');
    expect(meio).toEqual({ tipo: 'reticencias', escondidos: 2 });
  });

  it('a posição de cada degrau sobrevive ao corte', () => {
    // É ela que diz qual é o ÚLTIMO — e o último é o único com
    // `aria-current="page"`. Se ela se perdesse, o realce cairia no degrau
    // errado depois de encurtar.
    const pedacos = encurtar(cinco);
    const ultimo = pedacos[pedacos.length - 1];
    expect(ultimo.tipo === 'degrau' && ultimo.posicao).toBe(4);
  });

  it('trilha vazia continua vazia', () => {
    expect(encurtar([])).toEqual([]);
  });

  it('TRÊS DEGRAUS OU MENOS NUNCA ENCURTAM, nem com o teto no chão', () => {
    /*
      `teto = 0` é o que a tela passa quando MEDIU e a trilha não coube. Mesmo
      aí, `Meu trabalho › Minhas tarefas` não pode virar um `…`: o primeiro e os
      dois últimos já são todos, e o botão prometeria esconder zero.
    */
    const duas = trilhaDaTela('minhas');
    expect(encurtar(duas, 0).every((p) => p.tipo === 'degrau')).toBe(true);

    const tres = trilhaDaLinha(lugar).slice(0, 3);
    expect(encurtar(tres, 0).every((p) => p.tipo === 'degrau')).toBe(true);
  });

  it('com o teto no chão e quatro degraus, aí sim o meio some', () => {
    const quatro = trilhaDoQuadro(lugar);
    expect(quatro).toHaveLength(4);
    const pedacos = encurtar(quatro, 0);
    expect(pedacos.map((p) => p.tipo)).toEqual(['degrau', 'reticencias', 'degrau', 'degrau']);
    expect(pedacos[1]).toEqual({ tipo: 'reticencias', escondidos: 1 });
  });
});

/* ═══════════════ o degrau anterior — F17.33 ═══════════════ */

describe('para onde a trilha manda o voltar', () => {
  it('na ficha da tarefa, é o quadro da LISTA dela', () => {
    // É o caso do pedido: quem abre a ficha por um link colado não tem
    // histórico, e um `back()` ali sairia do sistema.
    expect(destinoAcima(trilhaDaTarefa({ ...lugar, title: 'Reels de agosto' }))).toBe('/quadro/l1');
  });

  it('a tarefa sem lista cai no degrau anterior que existe', () => {
    // Tarefa criada fora da árvore: sobra a raiz, que abre a última lista.
    const solta = trilhaDaTarefa({ title: 'Solta' });
    expect(destinoAcima(solta)).toBe('/quadro');
  });

  it('⚠️ o ÚLTIMO degrau nunca é o destino — ele é onde se está', () => {
    // No quadro, o último degrau é a lista aberta, e o construtor já zera o
    // destino dela. Ainda assim: se um dia alguém devolver esse destino, o
    // voltar não pode passar a recarregar a própria tela.
    const comLista = trilhaDoQuadro(lugar);
    comLista[comLista.length - 1].destino = '/quadro/l1';
    expect(destinoAcima(comLista)).not.toBe('/quadro/l1');
  });

  it('degrau que só ABRE UM NÓ não serve de destino', () => {
    // Um voltar que expande um galho da árvore não tirou ninguém de lugar
    // nenhum. Desde 28/09 espaço e pasta têm endereço; o caso sobra para o
    // degrau que é nó sem destino.
    const soNo: Degrau[] = [
      { tipo: 'raiz', nome: 'Compartilhado comigo', destino: '/quadro', no: null },
      { tipo: 'pasta', nome: 'TIME HELENA', destino: null, no: 'folder:p1' },
      { tipo: 'lista', nome: 'Jobs Antonelli', destino: null, no: null },
    ];
    expect(destinoAcima(soNo)).toBe('/quadro');
  });

  it('no quadro da lista, o voltar vai para a PASTA dela (28/09)', () => {
    expect(destinoAcima(trilhaDoQuadro(lugar))).toBe('/quadro/pasta/p1');
  });

  it('sem nenhum degrau com endereço, devolve nulo — e a tela não desenha botão', () => {
    expect(destinoAcima(trilhaDaTela('minhas'))).toBeNull();
    expect(destinoAcima([])).toBeNull();
    expect(destinoAcima(trilhaDaLinha(lugar).slice(0, 1))).toBeNull();
  });
});

describe('a trilha das telas de detalhe fora da árvore — F29 (Fase 5a)', () => {
  it('o pai leva ao endereço dele, pelo nome; o lugar onde se está não clica', () => {
    const t = trilhaDeDetalhe({ nome: 'Painel', destino: '/painel' }, 'Jatobá');
    expect(t.map((d) => [d.nome, d.destino])).toEqual([
      ['Painel', '/painel'],
      ['Jatobá', null],
    ]);
    // Nenhum dos dois é nó da árvore: não há galho para abrir.
    expect(t.every((d) => d.no === null)).toBe(true);
  });

  it('é a saída que o Voltar fazia sem dizer — e agora ela tem nome', () => {
    expect(destinoAcima(trilhaDeDetalhe({ nome: 'Meta', destino: '/meta' }, 'Ranking de criativos'))).toBe(
      '/meta',
    );
  });

  it('dois degraus nunca encurtam: não há meio para esconder', () => {
    expect(encurtar(trilhaDeDetalhe({ nome: 'Pessoas', destino: '/pessoas' }, 'Convidar'), 0)).toHaveLength(2);
  });
});
