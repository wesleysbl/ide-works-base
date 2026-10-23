/**
 * A camada pura de `Meu trabalho` — etapa F17.18.
 *
 * O QUE ESTE ARQUIVO PROVA, E POR QUE ELE É O LUGAR CERTO
 *   A regra do `Delegado` e a dos quatro grupos não estão no banco: são
 *   decisões desta etapa, e por isso elas precisam de teste que rode sem banco,
 *   sem rede e sem navegador. `scripts/provar-meu-trabalho.mjs` prova o caminho
 *   inteiro com dado real; este prova a REGRA, inclusive nos casos que o dado
 *   de hoje não tem.
 *
 * ⚠️ A DATA DO ANO 82000 TEM CASO PRÓPRIO
 *   Existe tarefa real com `due_on = 82025-08-07`. Ela não pode cair em
 *   `Em atraso` (viraria alarme falso permanente) nem sumir da tela.
 */

import { describe, expect, it } from 'vitest';

import type { BoardTask, Day } from '@/board/board';
import {
  type Aba,
  ABAS,
  abaDaLinha,
  agrupar,
  colunasPorEtapa,
  colunasPorTipo,
  contarPorAba,
  enderecoDaBuscaGeral,
  ESPECIFICACAO_DAS_ABAS,
  etiquetaDePrazo,
  FATOS,
  type FatosDaLinha,
  fatosDaLinha,
  filtrarPorAba,
  filtrarPorTexto,
  grupoDaLinha,
  listasDestasTarefas,
  ORDEM_DOS_GRUPOS,
  normalizarBusca,
  satisfaz,
  type WorkRow,
  vazioDaAba,
} from '@/board/meu-trabalho';

const HOJE: Day = { year: 2026, month: 8, day: 26 };

const base: BoardTask = {
  id: 'x',
  title: 'Tarefa',
  statusId: 's1',
  priority: null,
  dueOn: null,
  startOn: null,
  completedAt: null,
  hasDescription: false,
  hasAttachment: false,
  clientId: null,
  clientName: null,
  assignees: [],
  tags: [],
  taskTypeName: null,
  parentId: null,
  parentTitle: null,
  subtaskCount: 0,
  checklistDone: 0,
  checklistTotal: 0,
  commentCount: 0,
  // A arte no cartão — F17.56. Ela nasce ausente: das 1.797 tarefas reais,
  // 16 têm anexo de imagem, e o cartão sem arte é o caso comum.
  previewAttachmentId: null,
  previewCount: 0,
};

const linha = (mudou: Partial<WorkRow> = {}): WorkRow => ({
  ...base,
  categoryName: 'Alma9',
  spaceName: 'ALMA 9',
  folderName: 'FOCUS Ibitinga',
  listId: 'l1',
  listName: 'FOCUS (Vídeos)',
  listLive: true,
  statusName: 'a fazer',
  statusType: 'open',
  statusColor: '#d3d3d3',
  assignedToMe: false,
  createdByMe: false,
  otherAssignees: 0,
  ...mudou,
});

/* ───────────────────────────── as três abas ───────────────────────────── */

describe('as três abas, e o que `Delegado` significa', () => {
  it('atribuída a mim e em aberto é `Pendente`', () => {
    expect(abaDaLinha(linha({ assignedToMe: true }))).toBe('pendente');
  });

  it('atribuída a mim e concluída é `Feito`', () => {
    expect(abaDaLinha(linha({ assignedToMe: true, completedAt: '2026-08-20T10:00:00Z' }))).toBe(
      'feito',
    );
  });

  it('criei, outra pessoa faz, e eu não sou responsável: `Delegado`', () => {
    expect(abaDaLinha(linha({ createdByMe: true, otherAssignees: 1 }))).toBe('delegado');
  });

  it('DELEGADA E CONCLUÍDA CONTINUA EM `Delegado` — senão ela sumiria das três', () => {
    expect(
      abaDaLinha(
        linha({ createdByMe: true, otherAssignees: 2, completedAt: '2026-08-20T10:00:00Z' }),
      ),
    ).toBe('delegado');
  });

  it('criei e TAMBÉM faço: é `Pendente`, e não `Delegado` — as abas não se sobrepõem', () => {
    const l = linha({ createdByMe: true, assignedToMe: true, otherAssignees: 1 });
    expect(abaDaLinha(l)).toBe('pendente');
  });

  it('criei e NINGUÉM pegou: não é delegado, é esquecido — fica fora das três', () => {
    // Chamá-la de delegada diria que alguém está cuidando. Não está.
    expect(abaDaLinha(linha({ createdByMe: true, otherAssignees: 0 }))).toBeNull();
  });

  it('tarefa que não é minha nem criei fica fora das três', () => {
    expect(abaDaLinha(linha())).toBeNull();
  });

  it('a contagem das abas não conta a mesma tarefa duas vezes', () => {
    const linhas = [
      linha({ assignedToMe: true }),
      linha({ assignedToMe: true, completedAt: '2026-08-01T00:00:00Z' }),
      linha({ createdByMe: true, otherAssignees: 1 }),
      linha({ createdByMe: true, assignedToMe: true, otherAssignees: 1 }),
      linha(),
    ];
    const contas = contarPorAba(linhas);
    expect(contas).toEqual({ pendente: 2, feito: 1, delegado: 1 });
    // A soma é 4 e há 5 linhas: a última não pertence a ninguém, de propósito.
    expect(contas.pendente + contas.feito + contas.delegado).toBe(4);
  });

  it('filtrar por aba devolve exatamente o que `abaDaLinha` disse', () => {
    const linhas = [
      linha({ id: 'a', assignedToMe: true }),
      linha({ id: 'b', createdByMe: true, otherAssignees: 1 }),
    ];
    expect(filtrarPorAba(linhas, 'pendente').map((l) => l.id)).toEqual(['a']);
    expect(filtrarPorAba(linhas, 'delegado').map((l) => l.id)).toEqual(['b']);
    expect(filtrarPorAba(linhas, 'feito')).toEqual([]);
  });
});

/* ───────────────────── a regra como tabela — F17.AUD05 ───────────────────── */

/*
  A REGRA VIROU DADOS, E O SERVIDOR PASSOU A LÊ-LA.

  `ESPECIFICACAO_DAS_ABAS` é a tabela de que `abaDaLinha` deriva e de que
  `predicadoDaAba` (servidor) gera o `where`. Se a tabela disser algo diferente
  do que o cabeçalho do módulo diz por extenso, os dois lados erram JUNTOS e
  nenhum teste unitário de um lado só pegaria. Por isso o oráculo abaixo é a
  regra escrita por extenso, de novo, aqui — e as dezesseis combinações dos
  quatro fatos passam pelas duas.
*/

/** A regra por extenso, como o cabeçalho a conta. Não importa nada do módulo. */
function oraculo(f: FatosDaLinha): Aba | null {
  if (f.assignedToMe) return f.completed ? 'feito' : 'pendente';
  if (f.createdByMe && f.hasOthers) return 'delegado';
  return null;
}

const AS_DEZESSEIS: FatosDaLinha[] = [];
for (const assignedToMe of [false, true])
  for (const completed of [false, true])
    for (const createdByMe of [false, true])
      for (const hasOthers of [false, true])
        AS_DEZESSEIS.push({ assignedToMe, completed, createdByMe, hasOthers });

/** Uma linha com exatamente estes fatos — como o servidor a devolveria. */
const linhaComFatos = (f: FatosDaLinha): WorkRow =>
  linha({
    assignedToMe: f.assignedToMe,
    completedAt: f.completed ? '2026-08-20T10:00:00Z' : null,
    createdByMe: f.createdByMe,
    otherAssignees: f.hasOthers ? 2 : 0,
  });

describe('a regra das abas como tabela — F17.AUD05', () => {
  it('há dezesseis combinações, e a tabela concorda com a regra por extenso em todas', () => {
    expect(AS_DEZESSEIS).toHaveLength(16);
    for (const f of AS_DEZESSEIS) {
      const pelaTabela = ABAS.find((aba) => satisfaz(f, ESPECIFICACAO_DAS_ABAS[aba])) ?? null;
      expect(pelaTabela, JSON.stringify(f)).toBe(oraculo(f));
    }
  });

  it('`abaDaLinha` lê a tabela — a mesma resposta nas dezesseis, partindo da linha', () => {
    for (const f of AS_DEZESSEIS) {
      expect(abaDaLinha(linhaComFatos(f)), JSON.stringify(f)).toBe(oraculo(f));
    }
  });

  it('NENHUMA combinação cai em duas abas — é o que deixa as contagens do servidor somarem', () => {
    for (const f of AS_DEZESSEIS) {
      const quantas = ABAS.filter((aba) => satisfaz(f, ESPECIFICACAO_DAS_ABAS[aba])).length;
      expect(quantas, JSON.stringify(f)).toBeLessThanOrEqual(1);
    }
  });

  it('toda aba cita ao menos um fato, e só fatos que existem', () => {
    for (const aba of ABAS) {
      const chaves = Object.keys(ESPECIFICACAO_DAS_ABAS[aba]);
      expect(chaves.length, aba).toBeGreaterThan(0);
      for (const k of chaves) expect(FATOS, `${aba}.${k}`).toContain(k);
    }
  });

  it('`fatosDaLinha` traduz a linha sem inventar: concluída é `completedAt` não nulo, outros é `> 0`', () => {
    expect(fatosDaLinha(linha({ assignedToMe: true, completedAt: null, otherAssignees: 0 }))).toEqual({
      assignedToMe: true,
      completed: false,
      createdByMe: false,
      hasOthers: false,
    });
    expect(
      fatosDaLinha(linha({ createdByMe: true, completedAt: '2026-08-20T10:00:00Z', otherAssignees: 1 })),
    ).toEqual({ assignedToMe: false, completed: true, createdByMe: true, hasOthers: true });
  });

  it('`satisfaz` ignora o fato que a condição não cita — é isso que mantém a delegada concluída em `Delegado`', () => {
    const delegadaConcluida: FatosDaLinha = {
      assignedToMe: false,
      completed: true,
      createdByMe: true,
      hasOthers: true,
    };
    expect(satisfaz(delegadaConcluida, ESPECIFICACAO_DAS_ABAS.delegado)).toBe(true);
    expect(satisfaz(delegadaConcluida, ESPECIFICACAO_DAS_ABAS.feito)).toBe(false);
    expect(satisfaz(delegadaConcluida, {})).toBe(true);
  });
});

/* ───────────────────────────── os quatro grupos ───────────────────────────── */

describe('os quatro grupos, na ordem da referência', () => {
  it('a ordem é Hoje · Em atraso · Próximo · Não programado', () => {
    expect([...ORDEM_DOS_GRUPOS]).toEqual(['hoje', 'atraso', 'proximo', 'sem-data']);
  });

  it('o prazo de hoje cai em `Hoje`', () => {
    expect(grupoDaLinha({ dueOn: '2026-08-26' }, HOJE)).toBe('hoje');
  });

  it('o prazo de ontem cai em `Em atraso`', () => {
    expect(grupoDaLinha({ dueOn: '2026-08-25' }, HOJE)).toBe('atraso');
  });

  it('o prazo de amanhã cai em `Próximo`', () => {
    expect(grupoDaLinha({ dueOn: '2026-08-27' }, HOJE)).toBe('proximo');
  });

  it('sem prazo cai em `Não programado`', () => {
    expect(grupoDaLinha({ dueOn: null }, HOJE)).toBe('sem-data');
  });

  it('O ANO 82025 É FUTURO, e não atraso — ele é lido como texto, sem `Date`', () => {
    // `new Date('82025-08-07')` devolve `+082025-08-07` no `toISOString()`, e
    // todo `.slice(0, 10)` do projeto sairia errado. Ver `@/board/board`.
    expect(grupoDaLinha({ dueOn: '82025-08-07' }, HOJE)).toBe('proximo');
  });

  it('prazo ILEGÍVEL cai em `Não programado`, e não em `Em atraso`', () => {
    // Em `Em atraso` ele viraria alarme falso permanente. E ele não some: a
    // linha continua na tela, com o valor cru.
    expect(grupoDaLinha({ dueOn: 'ontem' }, HOJE)).toBe('sem-data');
  });

  it('GRUPO VAZIO NÃO SOME — os quatro voltam sempre', () => {
    const grupos = agrupar([linha({ dueOn: '2026-08-26' })], HOJE);
    expect(grupos.map((g) => g.chave)).toEqual(['hoje', 'atraso', 'proximo', 'sem-data']);
    expect(grupos[0].linhas).toHaveLength(1);
    expect(grupos[1].linhas).toHaveLength(0);
    // E cada vazio tem frase própria — nenhuma delas cita lembrete, que não
    // existe no modelo.
    for (const g of grupos) {
      expect(g.vazio.length).toBeGreaterThan(0);
      expect(g.vazio.toLowerCase()).not.toContain('lembrete');
    }
  });

  it('nenhuma linha se perde ao agrupar', () => {
    const linhas = [
      linha({ id: '1', dueOn: '2026-08-26' }),
      linha({ id: '2', dueOn: '2020-01-01' }),
      linha({ id: '3', dueOn: '82025-08-07' }),
      linha({ id: '4', dueOn: null }),
      linha({ id: '5', dueOn: 'lixo' }),
    ];
    const total = agrupar(linhas, HOJE).reduce((n, g) => n + g.linhas.length, 0);
    expect(total).toBe(linhas.length);
  });
});

/* ───────────────────────────── a etiqueta de prazo ───────────────────────────── */

describe('a etiqueta de prazo', () => {
  it('hoje e amanhã saem por extenso', () => {
    expect(etiquetaDePrazo('2026-08-26', HOJE)).toBe('Hoje');
    expect(etiquetaDePrazo('2026-08-27', HOJE)).toBe('Amanhã');
  });

  it('o resto sai como data, e o ano de cinco dígitos sai com cinco', () => {
    expect(etiquetaDePrazo('2026-09-10', HOJE)).toBe('10/09/2026');
    expect(etiquetaDePrazo('82025-08-07', HOJE)).toBe('07/08/82025');
  });

  it('sem prazo devolve nulo; prazo ilegível volta CRU', () => {
    expect(etiquetaDePrazo(null, HOJE)).toBeNull();
    expect(etiquetaDePrazo('   ', HOJE)).toBeNull();
    // Some-lo apagaria da tela o único sinal de que há um valor torto no banco.
    expect(etiquetaDePrazo('30/02', HOJE)).toBe('30/02');
  });
});

/* ───────────────────────────── a trilha ─────────────────────────────
   ⚠️ OS TRÊS TESTES DA TRILHA SAÍRAM DAQUI NA F17.25, E NÃO FORAM PERDIDOS.

   `trilha(row): string[]` deixou de existir: a trilha virou uma peça só para as
   quatro telas do Pilar B, e ela precisa dos ids, não só dos nomes (ver o
   comentário no lugar dela em `@/board/meu-trabalho`).

   As três garantias foram reescritas contra `degrausDaArvore`, em
   `src/board/trilha.test.ts` — a ordem dos níveis, a pasta que SOME quando não
   existe, e a tarefa sem lista que devolve trilha vazia.
   ─────────────────────────────────────────────────────────────────────────── */

/* ───────────────────────────── o quadro por tipo ───────────────────────────── */

describe('o quadro de `Todas as tarefas` agrupa por TIPO de status', () => {
  it('as cinco colunas saem sempre, na ordem do ClickUp', () => {
    const colunas = colunasPorTipo([linha({ statusType: 'open' })]);
    expect(colunas.map((c) => c.tipo)).toEqual(['open', 'unstarted', 'custom', 'done', 'closed']);
  });

  it('a coluna do SEM STATUS só aparece quando há alguém nela', () => {
    expect(colunasPorTipo([linha({ statusType: 'open' })])).toHaveLength(5);
    const comOrfa = colunasPorTipo([linha({ statusType: 'open' }), linha({ statusType: null })]);
    expect(comOrfa).toHaveLength(6);
    expect(comOrfa[5].tipo).toBeNull();
    expect(comOrfa[5].linhas).toHaveLength(1);
  });

  it('duas esteiras diferentes com o mesmo TIPO caem na mesma coluna', () => {
    // É o ponto do agrupamento: `demanda concluída` e `concluído` são linhas de
    // banco diferentes, em conjuntos diferentes, e as duas fecham.
    const colunas = colunasPorTipo([
      linha({ statusId: 'a', statusName: 'demanda concluída', statusType: 'closed' }),
      linha({ statusId: 'b', statusName: 'concluído', statusType: 'closed' }),
    ]);
    expect(colunas.find((c) => c.tipo === 'closed')?.linhas).toHaveLength(2);
  });

  it('nenhuma linha se perde ao colunar', () => {
    const linhas = [
      linha({ statusType: 'open' }),
      linha({ statusType: 'done' }),
      linha({ statusType: null }),
    ];
    const total = colunasPorTipo(linhas).reduce((n, c) => n + c.linhas.length, 0);
    expect(total).toBe(linhas.length);
  });
});

/* ───────────────────────────── o quadro por etapa ───────────────────────────── */

describe('o quadro de `Minhas tarefas` agrupa pelas ETAPAS reais', () => {
  it('`Aprovação` não cai em `Em andamento`: cada etapa custom vira a sua coluna', () => {
    const colunas = colunasPorEtapa([
      linha({ id: 'a', statusName: 'em andamento', statusType: 'custom', statusSortOrder: 2 }),
      linha({ id: 'b', statusName: 'aprovação', statusType: 'custom', statusSortOrder: 3 }),
      linha({ id: 'c', statusName: 'aprovação', statusType: 'custom', statusSortOrder: 3 }),
    ]);
    expect(colunas.map((c) => [c.rotulo, c.linhas.length])).toEqual([
      ['em andamento', 1],
      ['aprovação', 2],
    ]);
  });

  it('ordena pelo tipo e depois pela posição na esteira', () => {
    const colunas = colunasPorEtapa([
      linha({ statusName: 'concluído', statusType: 'closed', statusSortOrder: 9 }),
      linha({ statusName: 'alteração', statusType: 'custom', statusSortOrder: 5 }),
      linha({ statusName: 'a fazer', statusType: 'open', statusSortOrder: 0 }),
      linha({ statusName: 'aprovação', statusType: 'custom', statusSortOrder: 4 }),
    ]);
    expect(colunas.map((c) => c.rotulo)).toEqual(['a fazer', 'aprovação', 'alteração', 'concluído']);
  });

  it('o mesmo nome em esteiras diferentes vira UMA coluna, sem distinguir caixa ou acento', () => {
    const colunas = colunasPorEtapa([
      linha({ statusId: 'x', statusName: 'Aprovação', statusType: 'custom', statusSortOrder: 3 }),
      linha({ statusId: 'y', statusName: 'aprovacao ', statusType: 'custom', statusSortOrder: 6 }),
    ]);
    expect(colunas).toHaveLength(1);
    expect(colunas[0].linhas).toHaveLength(2);
  });

  it('com busca, as colunas saem do lote inteiro e ficam vazias em vez de sumir', () => {
    const lote = [
      linha({ id: 'a', statusName: 'a fazer', statusType: 'open' }),
      linha({ id: 'b', statusName: 'aprovação', statusType: 'custom' }),
    ];
    const colunas = colunasPorEtapa([lote[1]], lote);
    expect(colunas.map((c) => [c.rotulo, c.linhas.length])).toEqual([
      ['a fazer', 0],
      ['aprovação', 1],
    ]);
  });

  it('sem status vai para o fim, e nenhuma linha se perde', () => {
    const linhas = [
      linha({ statusType: null, statusName: null }),
      linha({ statusName: 'a fazer', statusType: 'open' }),
    ];
    const colunas = colunasPorEtapa(linhas);
    expect(colunas.at(-1)?.chave).toBeNull();
    expect(colunas.reduce((n, c) => n + c.linhas.length, 0)).toBe(linhas.length);
  });
});

/* ───────────────────────────── a busca pessoal — F05 ───────────────────────────── */

describe('F05: a busca de Minhas tarefas, no lote carregado', () => {
  const lote = [
    linha({ id: 'a', title: 'Revisão do carrossel', spaceName: 'Padaria Estrela' }),
    linha({ id: 'b', title: 'Legendar entrevista', spaceName: 'Clínica Viva', listName: 'Audiovisual' }),
    linha({ id: 'c', title: 'REVISAR roteiro', spaceName: 'Rebrota' }),
  ];

  it('acento e caixa não separam: "revisao", "REVISÃO" e "Revisão" acham a mesma', () => {
    expect(normalizarBusca('REVISÃO')).toBe('revisao');
    for (const termo of ['revisao', 'REVISÃO', 'Revisão', '  revisão  ']) {
      expect(filtrarPorTexto(lote, termo).map((t) => t.id)).toEqual(['a']);
    }
    expect(filtrarPorTexto(lote, 'revisa').map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('acha pelo lugar também (cliente, lista), com acento no dado e não no texto', () => {
    expect(filtrarPorTexto(lote, 'clinica').map((t) => t.id)).toEqual(['b']);
    expect(filtrarPorTexto(lote, 'audiovisual').map((t) => t.id)).toEqual(['b']);
  });

  it('texto vazio (ou só espaço) devolve o lote inteiro, sem cópia', () => {
    expect(filtrarPorTexto(lote, '')).toBe(lote);
    expect(filtrarPorTexto(lote, '   ')).toBe(lote);
  });

  it('LOTE INSUFICIENTE: o que não chegou não é achado — a busca é do lote, e só dele', () => {
    // A tarefa 150 existe no banco, mas o lote tem 100: a busca local não a
    // inventa. É por isso que a tela diz "nas N carregadas" e oferece Carregar
    // mais e a busca geral.
    const primeiroLote = Array.from({ length: 100 }, (_, i) => linha({ id: 'p' + i, title: 'Pendente ' + i }));
    expect(filtrarPorTexto(primeiroLote, 'Pendente 150')).toEqual([]);
    expect(filtrarPorTexto(primeiroLote, 'Pendente 15').map((t) => t.id)).toEqual(['p15']);
  });
});

describe('F05: `Listas destas tarefas` sai das linhas à vista, pelo id', () => {
  it('duas listas com o MESMO nome são duas entradas, cada uma com o seu id e o lugar ao lado', () => {
    const listas = listasDestasTarefas([
      linha({ id: '1', listId: 'l-a', listName: 'Criação', folderName: 'Clientes' }),
      linha({ id: '2', listId: 'l-b', listName: 'Criação', folderName: 'Prospects' }),
      linha({ id: '3', listId: 'l-c', listName: 'Site', folderName: 'Clientes' }),
    ]);
    expect(listas).toEqual([
      { id: 'l-a', nome: 'Criação', lugar: 'Clientes', tarefas: 1 },
      { id: 'l-b', nome: 'Criação', lugar: 'Prospects', tarefas: 1 },
      { id: 'l-c', nome: 'Site', lugar: null, tarefas: 1 },
    ]);
  });

  it('as mais cheias primeiro, empate pela ordem de chegada; teto de quatro', () => {
    const l = (id: string, n: number) => Array.from({ length: n }, (_, i) => linha({ id: id + i, listId: id, listName: id.toUpperCase() }));
    const listas = listasDestasTarefas([...l('a', 1), ...l('b', 3), ...l('c', 1), ...l('d', 2), ...l('e', 1)]);
    expect(listas.map((x) => [x.id, x.tarefas])).toEqual([['b', 3], ['d', 2], ['a', 1], ['c', 1]]);
  });

  it('lista arquivada ou sem lista não entra — o quadro dela não abre', () => {
    expect(listasDestasTarefas([linha({ listLive: false }), linha({ listId: null, listName: null })])).toEqual([]);
  });
});

describe('F05: a passagem para a busca geral leva o texto', () => {
  it('no `?busca=` que `Todas as tarefas` já lê, aparado e dentro do teto', () => {
    expect(enderecoDaBuscaGeral('  revisão de peças ', 120)).toBe('/tarefas?busca=revis%C3%A3o+de+pe%C3%A7as');
    expect(enderecoDaBuscaGeral('abcdef', 3)).toBe('/tarefas?busca=abc');
    expect(enderecoDaBuscaGeral('   ', 120)).toBe('/tarefas');
  });
});

describe('F06C: Minhas tarefas sem nada é UM estado, com as saídas', () => {
  it('Pendente vazia leva a Delegado (com o número do banco) e a Todas as tarefas', () => {
    const v = vazioDaAba('pendente', { pendente: 0, feito: 4, delegado: 2 }, true);
    expect(v.titulo).toBe('Nada pendente com você');
    expect(v.saidas).toEqual([
      { tipo: 'aba', aba: 'delegado', rotulo: 'Ver delegadas (2)' },
      { tipo: 'todas', rotulo: 'Todas as tarefas' },
    ]);
  });

  it('Delegado vazia leva de volta a Pendente; sem acesso a Todas, só a aba', () => {
    const v = vazioDaAba('delegado', { pendente: 5, feito: 0, delegado: 0 }, false);
    expect(v.titulo).toBe('Nada delegado');
    expect(v.saidas).toEqual([{ tipo: 'aba', aba: 'pendente', rotulo: 'Ver pendentes (5)' }]);
  });

  it('sem contagens ainda, o rótulo não inventa número', () => {
    expect(vazioDaAba('feito', null, true).saidas[0]).toEqual({ tipo: 'aba', aba: 'delegado', rotulo: 'Ver delegadas' });
  });
});
