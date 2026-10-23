/**
 * ABRIR UMA TAREFA, CONTADO NO FIO — perf do servidor, 08/10/2026.
 *
 * `GET /api/board/tasks/:id` (e a releitura que toda escrita da ficha devolve) é
 * a leitura mais aberta do sistema, e `lerFicha` fazia TREZE consultas, uma atrás
 * da outra, cada uma com o id como parâmetro. Com `prepare: false` isso custa
 * duas idas por consulta; este arquivo conta no fio, com o driver real, quantas
 * custa agora, e confere que o resultado é o mesmo.
 *
 * ANTES (medido neste mesmo teste contra 2264a4f): 30 idas.
 *
 * O QUE ELE PROVA
 *   · as idas: begin, a rajada 1, a rajada 2, commit;
 *   · as MESMAS treze consultas, com o mesmo texto, só com o id no lugar do `$n`;
 *   · o retorno montado a partir das linhas (mapeamento, ordem, valores);
 *   · tarefa que não existe ou está fora do alcance: a mesma recusa 404;
 *   · id fora do formato UUID: segue por parâmetro, nunca no texto.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BoardRefused } from '@/server/board';
import { lerFicha } from '@/server/board-task';
import { userActor, withActor, type Sql } from '@/server/db';
import { criarPgFalso, type PgFalso, type RespostaCombinada } from '@/server/pg-falso';

const EU = '11111111-1111-4111-8111-111111111111';
const TAREFA = '0b6b6a9e-0f3e-4b0c-9d11-0123456789ab';
const LISTA = '22222222-2222-4222-8222-222222222222';
const ESPACO = '33333333-3333-4333-8333-333333333333';
const STATUS_ABRE = '44444444-4444-4444-8444-444444444444';

const COLUNAS_DA_FICHA: Array<string | { nome: string; oid: number }> = [
  'id', 'title', 'description', 'parent_id', 'parent_title', 'list_id', 'status_id', 'priority',
  'due_on', 'start_on', 'custom_item_id', 'client_id', 'client_name', 'own_client_id',
  'list_client_id', 'list_client_name', { nome: 'list_requires_client', oid: 16 }, 'completed_at', 'completed_by',
  'completed_by_name', 'archived_at', 'created_by', 'created_by_name', 'via_name', 'created_at',
  'updated_at', 'list_name', 'folder_id', 'folder_name', 'space_id', 'space_name', 'category_name',
  'task_type_id', 'task_type_name', { nome: 'task_type_missing', oid: 16 }, 'demand_type',
  { nome: 'tags', oid: 114 }, { nome: 'assignees', oid: 114 }, { nome: 'watchers', oid: 114 },
];

function linhaDaFicha(extra: Record<string, string | null> = {}): Array<string | null> {
  const base: Record<string, string | null> = {
    id: TAREFA, title: 'Peça da campanha', description: 'Briefing curto.', parent_id: null,
    parent_title: null, list_id: LISTA, status_id: STATUS_ABRE, priority: 'high', due_on: '2026-10-20',
    start_on: null, custom_item_id: null, client_id: null, client_name: null, own_client_id: null,
    list_client_id: null, list_client_name: null, list_requires_client: 'f', completed_at: null,
    completed_by: null, completed_by_name: null, archived_at: null, created_by: EU,
    created_by_name: 'Wesley', via_name: null, created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-02T10:00:00.000Z', list_name: 'Atendimento', folder_id: null,
    folder_name: null, space_id: ESPACO, space_name: 'Entrega', category_name: 'Ide',
    task_type_id: null, task_type_name: null, task_type_missing: 'f', demand_type: null,
    tags: '[]', assignees: `[{"id":"${EU}","name":"Wesley"}]`, watchers: '[]',
  };
  const todo = { ...base, ...extra };
  return COLUNAS_DA_FICHA.map((c) => todo[typeof c === 'string' ? c : c.nome] ?? null);
}

let achouATarefa = true;
let idDaLinha = TAREFA;

const respostas: RespostaCombinada[] = [
  {
    quando: /select t\.id, t\.title, t\.description/,
    colunas: COLUNAS_DA_FICHA,
    linhas: () => (achouATarefa ? [linhaDaFicha({ id: idDaLinha })] : []),
  },
  {
    quando: /from ideworks\.list_workflow/,
    colunas: ['status_set_name', 'inherited_from', 'status_id', 'status_name', 'status_type', 'status_color', 'status_sort_order'],
    linhas: () => [
      ['Entrega', 'space', STATUS_ABRE, 'A fazer', 'open', '#999999', '1'],
      ['Entrega', 'space', '55555555-5555-4555-8555-555555555555', 'Feito', 'closed', null, '2'],
    ],
  },
  {
    quando: /from ideworks\.task_tags/,
    colunas: ['id', 'name', 'bg_color', 'fg_color'],
    linhas: () => [['66666666-6666-4666-8666-666666666666', 'Urgente', '#ff0000', '#ffffff']],
  },
  {
    quando: /from ideworks\.task_progress p/,
    colunas: ['subtask_count', 'subtask_done', 'checklist_count', 'checklist_total', 'checklist_done', 'attachment_count', 'link_count', 'comment_count'],
    linhas: () => [['1', '0', '1', '3', '1', '2', '0', '4']],
  },
  {
    quando: /list_is_production/,
    colunas: [{ nome: 'producao', oid: 16 }],
    linhas: () => [['t']],
  },
  { quando: /from ideworks\.task_comments c/, colunas: ['id', 'parent_id', 'body', 'created_at', 'edited_at', 'author_id', 'author_name', { nome: 'mine', oid: 16 }, { nome: 'from_client', oid: 16 }, 'approval_item_name', 'approval_item_position', 'approval_version', 'reply_count'], linhas: () => [['77777777-7777-4777-8777-777777777777', null, 'Oi', '2026-10-02T11:00:00.000Z', null, EU, 'Wesley', 't', 'f', null, null, null, '0']] },
];

let falso: PgFalso;
let sql: Sql;

beforeAll(async () => {
  falso = await criarPgFalso(respostas);
  sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
});

afterAll(async () => {
  await sql.end();
  await falso.fechar();
});

beforeEach(() => {
  achouATarefa = true;
  idDaLinha = TAREFA;
  falso.zerar();
});

const ator = userActor({ userId: EU, isSuperadmin: false, isSuper: false });
const abrir = (id: string) => withActor(sql, ator, (tx) => lerFicha(tx, id));

/** Texto de uma consulta sem espaços repetidos e com o id da tarefa trocado por um marcador. */
const normalizar = (c: string) => c.replace(/\s+/g, ' ').trim().split(TAREFA).join('<tarefa>').split(LISTA).join('<lista>').split(ESPACO).join('<espaco>');

describe('lerFicha — idas no fio', () => {
  it('abre a tarefa em 4 idas (eram 30): begin, rajada 1, rajada 2, commit', async () => {
    const ficha = await abrir(TAREFA);
    expect(ficha.id).toBe(TAREFA);
    // Antes (medido em 2264a4f): 30 idas — begin, set_config (2), 13 consultas × 2, commit.
    expect(falso.idas).toHaveLength(4);
  });

  it('são as mesmas treze consultas, sem parâmetro algum', async () => {
    await abrir(TAREFA);
    const doBanco = falso.consultas.filter((c) => !/^(begin|commit|rollback)/i.test(c.trim()) && !c.includes('set_config'));
    expect(doBanco).toHaveLength(13);
    const normalizadas = doBanco.map(normalizar);
    // Rajada 1 (nove consultas do id da tarefa); a rajada 2 (quatro) só sai depois dela.
    expect(normalizadas.slice(0, 9).some((c) => /^select t\.id, t\.title, t\.description/.test(c))).toBe(true);
    expect(normalizadas.slice(0, 9).some((c) => /from ideworks\.task_progress p where p\.task_id = '<tarefa>'/.test(c))).toBe(true);
    expect(normalizadas.slice(0, 9).some((c) => /from ideworks\.task_events e/.test(c) && c.includes("e.task_id = '<tarefa>'"))).toBe(true);
    expect(normalizadas.slice(9).some((c) => /from ideworks\.list_workflow lw where lw\.list_id = '<lista>'/.test(c))).toBe(true);
    expect(normalizadas.slice(9).some((c) => /from ideworks\.task_tags g where g\.space_id = '<espaco>'/.test(c))).toBe(true);
    expect(normalizadas.slice(9).some((c) => /from ideworks\.task_types tt where tt\.space_id = '<espaco>'/.test(c))).toBe(true);
    expect(normalizadas.slice(9).some((c) => /list_is_production\('<lista>'::uuid\)/.test(c))).toBe(true);
    for (const parametros of falso.parametros) expect(parametros).toEqual([]);
  });

  it('a declaração do ator vem antes de qualquer consulta da ficha', async () => {
    await abrir(TAREFA);
    const textos = falso.consultas.map((c) => c.trim());
    expect(textos[0]).toBe('begin');
    expect(textos[1]).toContain("set_config('app.user_id'");
    // Tudo o que vem entre a declaração e o commit é consulta da ficha.
    expect(textos.slice(2, -1).every((c) => /ideworks\./.test(c))).toBe(true);
    expect(textos[textos.length - 1]).toBe('commit');
  });
});

describe('lerFicha — o que volta é o que a linha do banco diz', () => {
  it('monta a ficha com esteira, etiquetas do espaço, progresso, conversa e produção', async () => {
    const f = await abrir(TAREFA);
    expect(f).toMatchObject({
      id: TAREFA,
      title: 'Peça da campanha',
      description: 'Briefing curto.',
      listId: LISTA,
      listName: 'Atendimento',
      spaceId: ESPACO,
      priority: 'high',
      dueOn: '2026-10-20',
      listIsProduction: true,
      statusSetName: 'Entrega',
      inheritedFrom: 'space',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    expect(f.statuses.map((s) => s.name)).toEqual(['A fazer', 'Feito']);
    expect(f.availableTags).toEqual([{ id: '66666666-6666-4666-8666-666666666666', name: 'Urgente', bgColor: '#ff0000', fgColor: '#ffffff' }]);
    expect(f.progress).toEqual({
      subtaskCount: 1, subtaskDone: 0, checklistCount: 1, checklistTotal: 3, checklistDone: 1,
      attachmentCount: 2, linkCount: 0, commentCount: 4,
    });
    expect(f.assignees).toEqual([{ id: EU, name: 'Wesley' }]);
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0]).toMatchObject({ body: 'Oi', mine: true, fromClient: false, replyCount: 0 });
  });

  it('tarefa sem lista: sem esteira, sem produção, e só a rajada 1 vai ao banco', async () => {
    const original = respostas[0].linhas;
    respostas[0].linhas = () => [linhaDaFicha({ list_id: null, space_id: null, list_name: null })];
    try {
      const f = await abrir(TAREFA);
      expect(f.listId).toBeNull();
      expect(f.statuses).toEqual([]);
      expect(f.availableTags).toEqual([]);
      expect(f.listIsProduction).toBe(false);
      const doBanco = falso.consultas.filter((c) => !/^(begin|commit|rollback)/i.test(c.trim()) && !c.includes('set_config'));
      expect(doBanco).toHaveLength(9);
    } finally {
      respostas[0].linhas = original;
    }
  });

  it('tarefa inexistente ou fora do alcance: a mesma recusa 404', async () => {
    achouATarefa = false;
    await expect(abrir(TAREFA)).rejects.toMatchObject({
      constructor: BoardRefused,
      status: 404,
      message: 'Tarefa não encontrada, ou fora do seu alcance.',
    });
    // Tudo termina em rollback: a transação não fica aberta.
    expect(falso.consultas[falso.consultas.length - 1]).toBe('rollback');
  });
});

describe('lerFicha — id fora do formato', () => {
  it('segue por parâmetro e nunca entra no texto', async () => {
    const injecao = "x' or '1'='1";
    idDaLinha = injecao;
    await abrir(injecao);
    const doBanco = falso.consultas.filter((c) => c.includes('ideworks.'));
    expect(doBanco.join('\n')).not.toContain("or '1'='1");
    expect(doBanco.some((c) => /\$1/.test(c))).toBe(true);
    expect(falso.parametros.flat()).toContain(injecao);
  });
});
