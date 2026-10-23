/**
 * Comentário humano e variante InTx — F16.6b.
 *
 * A suíte não fala com o banco (F0.4). O dublê cobre o SQL do miolo;
 * `lerFicha` é o mesmo dublê da limpeza de anexos: a ficha não é o assunto.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { TaskDetail } from '@/board/ficha';
import {
  MemoryAgentWriteStore,
  runAgentWrite,
  type AgentWriteStore,
  type AgentWriteTx,
} from '@/integrations/executions';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';
import { BoardRefused } from '@/server/board';
import { postComment, postCommentInTx } from '@/server/board-anexos';
import { lerFicha } from '@/server/board-task';
import type { Sql, Tx } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';

vi.mock('@/server/board-task', () => ({
  lerFicha: vi.fn(async (_tx: unknown, taskId: string) => ({ id: taskId, title: 'Tarefa' }) as TaskDetail),
}));

const actor: AuthenticatedActor = {
  userId: 'u1',
  email: 'teste@example.invalid',
  papel: 'funcionario',
  isSuperadmin: false,
  isSuper: false,
  areas: ['quadro'],
  hasAllClientsAccess: false,
};

function commentScenario() {
  const writes: unknown[][] = [];
  let beginCount = 0;
  const tx = async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.join('?');
    if (query.includes('set_config')) return [];
    if (query.includes('post_task_comment')) {
      writes.push(values);
      return [{ id: 'c1' }];
    }
    if (query.includes('task_comments') && query.includes('task_id')) {
      return [{ task_id: 't1' }];
    }
    throw new Error(`Consulta não prevista na prova: ${query}`);
  };
  const sql = {
    begin: (work: (connection: Tx) => Promise<unknown>) => {
      beginCount += 1;
      return work(tx as unknown as Tx);
    },
  } as unknown as Sql;
  return { sql, tx: tx as unknown as Tx, writes, beginCount: () => beginCount };
}

describe('postComment humano', () => {
  it('escreve o comentário, relê a tarefa e abre exatamente um begin', async () => {
    const { sql, writes, beginCount } = commentScenario();
    const result = await postComment(sql, actor, 't1', { body: 'ok na arte', parentId: null });
    expect(result).toMatchObject({ id: 'c1', task: { id: 't1' } });
    expect(writes).toEqual([['t1', 'ok na arte', null]]);
    expect(beginCount()).toBe(1);
  });

  it('corpo vazio recusa sem abrir transação', async () => {
    const { sql, writes, beginCount } = commentScenario();
    await expect(postComment(sql, actor, 't1', { body: '   ', parentId: null })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Escreva alguma coisa/),
    });
    expect(writes).toEqual([]);
    expect(beginCount()).toBe(0);
  });
});

describe('postCommentInTx não abre segundo begin', () => {
  it('usa o Tx recebido e não chama sql.begin', async () => {
    const { sql, tx, writes, beginCount } = commentScenario();
    const result = await postCommentInTx(tx, 't1', { body: 'ok na arte', parentId: null });
    expect(result.id).toBe('c1');
    expect(writes).toEqual([['t1', 'ok na arte', null]]);
    expect(beginCount()).toBe(0);
    sql.begin(() => Promise.resolve(undefined));
    expect(beginCount()).toBe(1);
  });

  it('BoardRefused de corpo vazio também sem begin', async () => {
    const { tx, writes, beginCount } = commentScenario();
    await expect(postCommentInTx(tx, 't1', { body: '', parentId: null })).rejects.toBeInstanceOf(BoardRefused);
    expect(writes).toEqual([]);
    expect(beginCount()).toBe(0);
  });
});

/**
 * F23 — a releitura da ficha sai do caminho do agente.
 *
 * `lerFicha` custa doze consultas e o caminho do agente joga todas fora:
 * `SQL_COMMENT_MUTATOR.post` só usa `posted.id`. A tela humana continua
 * recebendo a ficha, porque a interface depende dela.
 */
describe('F23: a ficha só é relida por quem a usa', () => {
  it('o miolo magro não relê a ficha e devolve a tarefa dona', async () => {
    vi.mocked(lerFicha).mockClear();
    const { tx } = commentScenario();
    const resultado = await postCommentInTx(tx, 't1', { body: 'ok na arte', parentId: null });
    expect(resultado).toEqual({ id: 'c1', taskId: 't1' });
    expect(vi.mocked(lerFicha)).not.toHaveBeenCalled();
  });

  it('a tela humana continua recebendo a ficha relida', async () => {
    vi.mocked(lerFicha).mockClear();
    const { sql } = commentScenario();
    const resultado = await postComment(sql, actor, 't1', { body: 'ok na arte', parentId: null });
    expect(resultado.task).toMatchObject({ id: 't1' });
    expect(vi.mocked(lerFicha)).toHaveBeenCalledTimes(1);
  });
});

describe('gancho F16.7: runAgentWrite + postCommentInTx no mesmo Tx', () => {
  const agora = new Date('2026-09-21T06:00:00.000Z');
  const grantId = '11111111-1111-4111-8111-111111111111';
  const ownerId = '22222222-2222-4222-8222-222222222222';
  const person: PersonAccess = {
    userId: ownerId,
    isActive: true,
    isSuperadmin: true,
    isSuper: false,
    companyIds: ['empresa-a'],
    clientIds: ['cliente-a'],
    hasAllClientsAccess: false,
  };
  const grant: IntegrationGrant = {
    id: grantId,
    ownerId,
    oauthClientId: 'ideworks-claude',
    name: 'Claude da agência',
    capabilities: [...READ_CAPABILITIES, 'comments:write'],
    allowedCompanyIds: null,
    allowedClientIds: null,
    expiresAt: null,
    revokedAt: null,
    policyVersion: 1,
  };

  it('mutate chama o miolo em sqlTx; o ledger não dispara segundo begin', async () => {
    const { sql, tx, writes, beginCount } = commentScenario();
    const memory = new MemoryAgentWriteStore();
    memory.seedPerson(person);
    memory.seedGrant(grant);
    const store: AgentWriteStore = {
      withWriteTransaction: (work) =>
        memory.withWriteTransaction((ledger: AgentWriteTx) => work({ ...ledger, sqlTx: tx })),
    };

    const ok = await runAgentWrite({
      store,
      grantId,
      operation: 'add_comment',
      idempotencyKey: 'idem-f16-6b',
      targetId: 't1',
      params: { taskId: 't1', body: 'ok na arte' },
      impact: {},
      origin: 'mcp',
      now: agora,
      mutate: async (ledger) => {
        const posted = await postCommentInTx(ledger.sqlTx!, 't1', { body: 'ok na arte', parentId: null });
        return { result: { commentId: posted.id, taskId: 't1' }, changes: { commentsAdded: 1 } };
      },
    });

    expect(ok.replay).toBe(false);
    expect(ok.result).toEqual({ commentId: 'c1', taskId: 't1' });
    expect(writes).toEqual([['t1', 'ok na arte', null]]);
    expect(beginCount()).toBe(0);
    expect(sql.begin).toBeTypeOf('function');
  });
});

describe('contrato: wrapper = withActor(miolo); miolo não abre transação', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  function trecho(fonte: string, inicio: string, fim: string): string {
    const a = fonte.indexOf(inicio);
    expect(a).toBeGreaterThanOrEqual(0);
    const b = fonte.indexOf(fim, a + inicio.length);
    expect(b).toBeGreaterThan(a);
    return fonte.slice(a, b);
  }

  function corpo(fonte: string, inicio: string, fim?: string): string {
    const fatia = fim ? trecho(fonte, inicio, fim) : fonte.slice(fonte.indexOf(inicio));
    const abre = fatia.indexOf('{');
    expect(abre).toBeGreaterThan(0);
    return fatia.slice(abre);
  }

  it('postCommentInTx não chama withActor nem begin', () => {
    const fonte = readFileSync(join(raiz, 'src', 'server', 'board-anexos.ts'), 'utf8');
    const miolo = corpo(fonte, 'export async function postCommentInTx', 'export async function postComment(');
    expect(miolo).not.toMatch(/\bwithActor\s*\(/);
    expect(miolo).not.toMatch(/\.begin\s*\(/);
    const wrapper = corpo(fonte, 'export async function postComment(', 'export async function editComment(');
    expect(wrapper).toMatch(/withActor\s*\(/);
    // F23: o wrapper humano passou a chamar a variante COM ficha. Ela é o
    // miolo magro + `lerFicha`, e também não abre transação própria.
    expect(wrapper).toMatch(/postCommentWithDetailInTx\s*\(/);
    const comFicha = corpo(
      fonte,
      'export async function postCommentWithDetailInTx',
      'export async function postCommentInTx',
    );
    expect(comFicha).not.toMatch(/\bwithActor\s*\(/);
    expect(comFicha).not.toMatch(/\.begin\s*\(/);
  });

  it('moveTaskOnBoardInTx não chama withActor nem begin', () => {
    const fonte = readFileSync(join(raiz, 'src', 'server', 'board.ts'), 'utf8');
    const miolo = corpo(fonte, 'export async function moveTaskOnBoardInTx', 'export async function moveTaskOnBoard(');
    expect(miolo).not.toMatch(/\bwithActor\s*\(/);
    expect(miolo).not.toMatch(/\.begin\s*\(/);
    const wrapper = corpo(fonte, 'export async function moveTaskOnBoard(');
    expect(wrapper).toMatch(/withActor\s*\(/);
    expect(wrapper).toMatch(/moveTaskOnBoardInTx\s*\(/);
  });
});
