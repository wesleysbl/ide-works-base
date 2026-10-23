/**
 * A ficha da tarefa — as contas puras. F17.10.
 *
 * O QUE ESTE TESTE PROTEGE
 *   Três coisas que, se quebrarem, quebram calado:
 *
 *   1. **O pedido mínimo.** `mudancas` só manda o que mudou. Se ele passar a
 *      mandar tudo, `set_task_assignees` reescreveria `assigned_at` de todo
 *      mundo a cada salvamento — e a data de atribuição deixaria de querer
 *      dizer alguma coisa, sem nenhum erro aparecer.
 *
 *   2. **O prazo do ano 82025.** Ele é um dado REAL, herdado do legado. Se o
 *      campo de dia passar a recusá-lo ou a normalizá-lo, salvar o título de
 *      uma tarefa apagaria o prazo dela.
 *
 *   3. **Quem foi pedido e não entrou.** `set_task_assignees` ignora em
 *      silêncio quem não tem perfil no IDE Works. `ignorados` é o que faz a
 *      tela contar isso; sem ele a lista encolhe e ninguém sabe por quê.
 */

import { describe, expect, it } from 'vitest';

import {
  type Rascunho,
  type TaskDetail,
  conferirData,
  conferirNova,
  conferirRascunho,
  estadoDoTexto,
  formatarInstante,
  ignorados,
  mudancas,
  nomesDosResponsaveis,
  rascunhoDe,
  recadoDaConclusao,
  ROTULO_DO_ESTADO,
  rodapeDaFicha,
  secoesVazias,
  tarefaVazia,
  temMudanca,
} from '@/board/ficha';
import { SEM_PROGRESSO } from '@/board/passos';

const BASE: Rascunho = {
  title: 'Roteiro do Reels',
  description: '# briefing',
  dueOn: '2026-08-30',
  startOn: '',
  priority: 'high',
  customItemId: null,
  assigneeIds: ['a', 'b'],
  watcherIds: [],
  tagIds: ['g1'],
};

const fichaDe = (p: Partial<TaskDetail> = {}): TaskDetail => ({
  id: 't1',
  title: 'Roteiro do Reels',
  description: '# briefing',
  listId: 'l1',
  listName: 'Todas as demandas',
  folderId: null,
  folderName: null,
  spaceId: 's1',
  spaceName: 'Demandas',
  categoryName: 'Ide',
  statusId: 'st1',
  priority: 'high',
  dueOn: '2026-08-30',
  startOn: null,
  customItemId: null,
  taskTypeId: null,
  taskTypeName: null,
  taskTypeMissing: false,
  clientId: null,
  clientName: null,
  assignees: [
    { id: 'a', name: 'Ana' },
    { id: 'b', name: 'Bia' },
  ],
  watchers: [],
  tags: [{ id: 'g1', name: 'arte', bgColor: '#A18072', fgColor: '#fff' }],
  completedAt: null,
  completedBy: null,
  archivedAt: null,
  createdBy: { id: 'z', name: 'Wesley' },
  createdAt: '2026-08-25T12:00:00.000Z',
  updatedAt: '2026-08-25T13:30:00.000Z',
  statuses: [],
  statusSetName: 'Demandas',
  inheritedFrom: 'space',
  availableTags: [],
  availableTypes: [],
  // Os passos — F17.15. A ficha nasce sem mãe, sem filha e sem checklist.
  parentId: null,
  parentTitle: null,
  subtasks: [],
  checklists: [],
  // A entrega — F17.6. A ficha nasce sem conversa, sem anexo e sem link.
  comments: [],
  attachments: [],
  links: [],
  // Tarefa que nunca passou por etapa automatizada — o caso normal (F17.41).
  history: [],
  progress: SEM_PROGRESSO,
  ...p,
});

describe('o rascunho sai da ficha sem perder nada', () => {
  it('as três listas viram id, na ordem em que vieram', () => {
    const r = rascunhoDe(fichaDe());
    expect(r.assigneeIds).toEqual(['a', 'b']);
    expect(r.tagIds).toEqual(['g1']);
    expect(r.watcherIds).toEqual([]);
  });

  it('nulo do banco vira texto vazio no campo, e não some', () => {
    const r = rascunhoDe(fichaDe({ description: null, dueOn: null, startOn: null }));
    expect(r.description).toBe('');
    expect(r.dueOn).toBe('');
    expect(r.startOn).toBe('');
  });
});

describe('o pedido só carrega o que mudou', () => {
  it('nada mexido, nada mandado', () => {
    expect(mudancas(BASE, { ...BASE })).toEqual({});
    expect(temMudanca(mudancas(BASE, { ...BASE }))).toBe(false);
  });

  it('mexer no título manda SÓ o título', () => {
    const p = mudancas(BASE, { ...BASE, title: 'Outro' });
    expect(p).toEqual({ title: 'Outro' });
    // O prazo NÃO vai junto. É isto que impede o prazo do ano 82025 de ser
    // apagado por quem só quis corrigir uma palavra do título.
    expect('dueOn' in p).toBe(false);
  });

  it('a mesma lista em outra ORDEM não conta como mudança', () => {
    // `set_task_assignees` apaga e reinsere: mandar a lista igual reescreveria
    // `assigned_at` de todo mundo a cada salvamento.
    const p = mudancas(BASE, { ...BASE, assigneeIds: ['b', 'a'] });
    expect(p).toEqual({});
  });

  it('tirar todo mundo é uma mudança, e vai como lista vazia', () => {
    expect(mudancas(BASE, { ...BASE, assigneeIds: [] })).toEqual({ assigneeIds: [] });
  });

  it('limpar um campo manda NULO — e nulo é diferente de ausente', () => {
    expect(mudancas(BASE, { ...BASE, dueOn: '' })).toEqual({ dueOn: null });
    expect(mudancas(BASE, { ...BASE, description: '' })).toEqual({ description: null });
    expect(mudancas(BASE, { ...BASE, priority: null })).toEqual({ priority: null });
  });

  it('espaço em volta do título não conta como mudança', () => {
    expect(mudancas(BASE, { ...BASE, title: '  Roteiro do Reels  ' })).toEqual({});
  });
});

describe('as recusas que a tela dá antes de gastar uma ida ao banco', () => {
  it('título em branco', () => {
    expect(conferirRascunho({ ...BASE, title: '   ' }).title).toBeTruthy();
  });

  it('data vazia passa — é "sem prazo", não é erro', () => {
    expect(conferirData('', 'Prazo')).toBeNull();
  });

  it('data com ano de CINCO dígitos passa — ela existe no banco', () => {
    // A tarefa real com prazo `82025-08-07`. Recusá-la aqui faria a ficha dela
    // não salvar nunca mais.
    expect(conferirData('82025-08-07', 'Prazo')).toBeNull();
    expect(conferirRascunho({ ...BASE, dueOn: '82025-08-07' })).toEqual({});
  });

  it('data que não é data é recusada', () => {
    expect(conferirData('30/08/2026', 'Prazo')).toBeTruthy();
    expect(conferirData('amanhã', 'Prazo')).toBeTruthy();
  });

  it('a tarefa nova nasce vazia e é recusada até ter título', () => {
    const n = tarefaVazia();
    expect(conferirNova(n).title).toBeTruthy();
    expect(conferirNova({ ...n, title: 'Algo' })).toEqual({});
  });
});

describe('quem foi pedido e não entrou', () => {
  const diretorio = [
    { id: 'a', name: 'Ana' },
    { id: 'b', name: 'Bia' },
  ];

  it('todo mundo entrou: ninguém a relatar', () => {
    expect(ignorados(['a', 'b'], [{ id: 'a' }, { id: 'b' }], diretorio)).toEqual([]);
  });

  it('o descartado sai COM NOME — senão a lista encolhe sem explicação', () => {
    const fora = ignorados(['a', 'b'], [{ id: 'a' }], diretorio);
    expect(fora).toEqual([{ id: 'b', name: 'Bia' }]);
  });

  it('id que nem está no diretório ainda é nomeado, do jeito honesto', () => {
    expect(ignorados(['x'], [], diretorio)).toEqual([{ id: 'x', name: 'pessoa sem perfil' }]);
  });
});

describe('o rodapé: os quatro carimbos', () => {
  it('criação, autor, atualização e conclusão', () => {
    const linhas = rodapeDaFicha(fichaDe());
    expect(linhas.map((l) => l.rotulo)).toEqual([
      'Criada',
      'Criada por',
      'Última atualização',
      'Concluída',
    ]);
    expect(linhas[3].valor).toBe('ainda não');
  });

  it('tarefa sem autor diz que não tem — as duas listas nasceram por migration', () => {
    const linhas = rodapeDaFicha(fichaDe({ createdBy: null }));
    expect(linhas[1].valor).toBe('sem autor registrado');
  });

  it('concluída mostra o instante e quem concluiu', () => {
    const linhas = rodapeDaFicha(
      fichaDe({
        completedAt: '2026-08-25T15:00:00.000Z',
        completedBy: { id: 'a', name: 'Ana' },
      }),
    );
    expect(linhas[3].valor).toContain('por Ana');
  });

  it('arquivada ganha a quinta linha', () => {
    const linhas = rodapeDaFicha(fichaDe({ archivedAt: '2026-08-25T16:00:00.000Z' }));
    expect(linhas.map((l) => l.rotulo)).toContain('Arquivada');
  });

  it('instante ilegível é DITO, e não vira "Invalid Date"', () => {
    expect(formatarInstante('nada disso')).toBeNull();
    expect(rodapeDaFicha(fichaDe({ createdAt: 'nada disso' }))[0].valor).toBe('instante ilegível');
  });
});

describe('o nome no chip de responsáveis — F07 do plano UX', () => {
  it('diz quem é, e não só quantos', () => {
    expect(nomesDosResponsaveis([])).toBe('Ninguém');
    expect(nomesDosResponsaveis([{ name: 'Ana' }])).toBe('Ana');
    expect(nomesDosResponsaveis([{ name: 'Ana' }, { name: 'Bia' }])).toBe('Ana e Bia');
    expect(nomesDosResponsaveis([{ name: 'Ana' }, { name: 'Bia' }, { name: 'Caio' }])).toBe('Ana e mais 2');
  });
});

/* ───────────────────────────── F43, Fase 6 ───────────────────────────── */

describe('F43 Fase 6 — quais seções nascem recolhidas na linha "+"', () => {
  const anexo = (p: Record<string, unknown> = {}) => ({
    id: 'x1', fileName: 'arte.png', extension: 'png', contentType: 'image/png', byteSize: 10,
    uploadedBy: null, createdAt: '2026-10-01T12:00:00.000Z', ...p,
  });

  it('tarefa sem nada: as três, na ordem da ficha real', () => {
    expect(secoesVazias(fichaDe())).toEqual(['subtarefas', 'checklists', 'anexos']);
  });

  it('subtarefa ARQUIVADA conta — a seção diz que ela existe, e esconder a faria sumir sem rastro', () => {
    const sub = {
      id: 's1', title: 'velha', statusId: null, statusName: null, statusColor: null, statusType: null,
      priority: null, dueOn: null, completedAt: null, archivedAt: '2026-09-01T00:00:00.000Z',
      assignees: [], subtaskCount: 0,
    };
    expect(secoesVazias(fichaDe({ subtasks: [sub] }))).toEqual(['checklists', 'anexos']);
  });

  it('checklist vazio conta: ele existe, e é na seção que se acrescenta o primeiro item', () => {
    const vazio = { id: 'k1', name: 'Checklist', sortOrder: 0, items: [] };
    expect(secoesVazias(fichaDe({ checklists: [vazio] }))).toEqual(['subtarefas', 'anexos']);
  });

  it('anexo: o link conta, o arquivo conta, o print com validade NÃO (ele mora na conversa)', () => {
    const link = { id: 'k', label: 'Dropbox', url: 'https://www.dropbox.com/x', sortOrder: 0, createdBy: null, createdAt: '2026-10-01T12:00:00.000Z' };
    expect(secoesVazias(fichaDe({ links: [link] }))).not.toContain('anexos');
    expect(secoesVazias(fichaDe({ attachments: [anexo()] }))).not.toContain('anexos');
    expect(secoesVazias(fichaDe({ attachments: [anexo({ expiresAt: '2026-10-11T12:00:00.000Z' })] }))).toContain('anexos');
  });
});

describe('F43 Fase 6 — o estado do texto na linha do Salvar', () => {
  it('a precedência: escrevendo > falhou > por salvar > salvo', () => {
    expect(estadoDoTexto({ porSalvar: false, escrevendo: false, falhouOTexto: false })).toBe('salvo');
    expect(estadoDoTexto({ porSalvar: true, escrevendo: false, falhouOTexto: false })).toBe('por-salvar');
    expect(estadoDoTexto({ porSalvar: true, escrevendo: false, falhouOTexto: true })).toBe('falhou');
    expect(estadoDoTexto({ porSalvar: true, escrevendo: true, falhouOTexto: true })).toBe('salvando');
  });

  it('a falha antiga não fica pendurada depois que não há mais o que salvar', () => {
    expect(estadoDoTexto({ porSalvar: false, escrevendo: false, falhouOTexto: true })).toBe('salvo');
  });

  it('as palavras que os e2e esperam: "há alterações por salvar" literal, e "Salvo" sem o ponto do recado', () => {
    expect(ROTULO_DO_ESTADO['por-salvar']).toBe('há alterações por salvar');
    // A falha não troca a frase: o texto continua pendente (e2e `combinados` b).
    expect(ROTULO_DO_ESTADO.falhou).toBe('há alterações por salvar');
    expect(ROTULO_DO_ESTADO.salvo).toBe('Salvo');
    expect(ROTULO_DO_ESTADO.salvo).not.toBe('Salvo.');
  });
});

describe('F44 Fase 8 — o recado de concluir/reabrir sai da ficha relida', () => {
  const antes = fichaDe();
  it('sem automação, o recado de sempre', () => {
    expect(recadoDaConclusao(antes, fichaDe({ completedAt: '2026-10-09T12:00:00.000Z' }), true)).toBe(
      'Concluída — o banco também moveu a etapa para a coluna que fecha.',
    );
    expect(recadoDaConclusao(antes, fichaDe(), false)).toBe('Reaberta.');
  });

  it('a regra trocou quem cuida: o recado diz para quem', () => {
    const relida = fichaDe({ completedAt: '2026-10-09T12:00:00.000Z', assignees: [{ id: 'x', name: 'Xavier' }] });
    expect(recadoDaConclusao(antes, relida, true)).toBe(
      'Concluída — o banco também moveu a etapa para a coluna que fecha. A automação da etapa passou a tarefa para Xavier.',
    );
    // A mesma gente em outra ordem não é troca.
    const mesma = fichaDe({ assignees: [{ id: 'b', name: 'Bia' }, { id: 'a', name: 'Ana' }] });
    expect(recadoDaConclusao(antes, mesma, false)).toBe('Reaberta.');
  });

  it('a regra levou a tarefa para outra lista: aberta lá, ou concluída lá', () => {
    const aberta = fichaDe({ listId: 'l2', listName: 'Aprovação', completedAt: null });
    expect(recadoDaConclusao(antes, aberta, true)).toBe(
      'A automação da coluna que fecha levou a tarefa para a lista “Aprovação”, onde ela segue aberta.',
    );
    const fechada = fichaDe({ listId: 'l2', listName: 'Arquivo', completedAt: '2026-10-09T12:00:00.000Z' });
    expect(recadoDaConclusao(antes, fechada, true)).toBe(
      'Concluída — o banco também moveu a etapa para a coluna que fecha. A automação da etapa levou a tarefa para a lista “Arquivo”.',
    );
  });
});
