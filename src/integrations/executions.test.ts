/**
 * Ledger, idempotência e prévia — F16.6a.
 *
 * Port injetável. A suíte não fala com o banco (F0.4). Unique, rollback e
 * concorrência moram no MemoryAgentWriteStore; o par SQL é lido do disco.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ERROR_STATUS } from '@/integrations/contract';
import {
  DEFAULT_DAILY_WRITE_LIMIT,
  IDEMPOTENCY_WINDOW_MS,
  MemoryAgentWriteStore,
  agencyDayWindow,
  WRITE_IMPACT_DECISIONS,
  decideWriteImpact,
  hashWriteParams,
  resolveDailyWriteLimit,
  runAgentWrite,
  type AgentWriteInput,
  type AgentWriteOperation,
} from '@/integrations/executions';
import { READ_CAPABILITIES, type IntegrationGrant, type PersonAccess } from '@/integrations/grants';

const agora = new Date('2026-09-21T06:00:00.000Z');
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = '33333333-3333-4333-8333-333333333333';
const KEY = 'idem-comentario-1';

const person: PersonAccess = {
  userId: OWNER_ID,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: ['empresa-a'],
  clientIds: ['cliente-a'],
  hasAllClientsAccess: false,
};

const grant: IntegrationGrant = {
  id: GRANT_ID,
  ownerId: OWNER_ID,
  oauthClientId: 'ideworks-claude',
  name: 'Claude da agência',
  capabilities: [...READ_CAPABILITIES, 'comments:write', 'tasks:move'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};

function seededStore(): MemoryAgentWriteStore {
  const store = new MemoryAgentWriteStore();
  store.seedPerson(person);
  store.seedGrant(grant);
  return store;
}

function commentWrite(
  store: MemoryAgentWriteStore,
  extra: Partial<AgentWriteInput<{ commentId: string; taskId: string }>> = {},
): AgentWriteInput<{ commentId: string; taskId: string }> {
  return {
    store,
    grantId: GRANT_ID,
    operation: 'add_comment',
    idempotencyKey: KEY,
    targetId: TARGET_ID,
    params: { taskId: TARGET_ID, body: 'ok na arte' },
    impact: {},
    origin: 'mcp',
    now: agora,
    mutate: async () => {
      store.effects.mutations += 1;
      store.effects.notifications.push('aviso');
      return {
        result: { commentId: 'c1', taskId: TARGET_ID },
        changes: { commentsAdded: 1 },
      };
    },
    ...extra,
  };
}

describe('política de impacto: o servidor decide', () => {
  it('a tabela de decisão fecha os casos do plano', () => {
    expect(WRITE_IMPACT_DECISIONS).toEqual([
      { operation: 'add_comment', when: 'comentário simples (um alvo)', decision: 'auto' },
      { operation: 'add_comment', when: 'lote', decision: 'preview_required' },
      { operation: 'move_task', when: 'movimento simples (sem subtarefas e sem automação)', decision: 'auto' },
      { operation: 'move_task', when: 'movimento com subtarefas', decision: 'preview_required' },
      { operation: 'move_task', when: 'movimento com automação', decision: 'preview_required' },
      { operation: 'move_task', when: 'lote', decision: 'preview_required' },
    ]);
    expect(decideWriteImpact('add_comment', {})).toBe('auto');
    expect(decideWriteImpact('add_comment', { batch: true })).toBe('preview_required');
    expect(decideWriteImpact('move_task', { subtasksWouldMove: 0, automationWouldRun: false })).toBe('auto');
    expect(decideWriteImpact('move_task', { subtasksWouldMove: 2 })).toBe('preview_required');
    expect(decideWriteImpact('move_task', { automationWouldRun: true })).toBe('preview_required');
    expect(decideWriteImpact('move_task', { batch: true })).toBe('preview_required');
  });
});

describe('duas chamadas simultâneas com a mesma chave', () => {
  it('produzem uma única mutação e o mesmo resultado persistido', async () => {
    const store = seededStore();
    const input = commentWrite(store);
    const [a, b] = await Promise.all([runAgentWrite(input), runAgentWrite(input)]);

    expect(store.effects.mutations).toBe(1);
    expect(store.effects.notifications).toEqual(['aviso']);
    expect(a.result).toEqual(b.result);
    expect(a.executionId).toBe(b.executionId);
    expect(a.changes).toEqual({ commentsAdded: 1 });
    expect([a.replay, b.replay].filter(Boolean)).toHaveLength(1);
    expect(JSON.stringify(a.result)).not.toMatch(/ok na arte/);
  });
});

describe('reutilizar chave com conteúdo diferente', () => {
  it('produz conflito state_conflict', async () => {
    const store = seededStore();
    await runAgentWrite(commentWrite(store));
    await expect(
      runAgentWrite(
        commentWrite(store, {
          params: { taskId: TARGET_ID, body: 'texto outro' },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'state_conflict',
      message: expect.stringMatching(/parâmetros diferentes/),
    });
    expect(ERROR_STATUS.state_conflict).toBe(409);
    expect(store.effects.mutations).toBe(1);
  });
});

describe('commit ok e retry após resposta perdida', () => {
  it('recupera o resultado e não dispara a notificação de novo', async () => {
    const store = seededStore();
    const first = await runAgentWrite(commentWrite(store));
    expect(first.replay).toBe(false);

    const second = await runAgentWrite(commentWrite(store));
    expect(second.replay).toBe(true);
    expect(second.executionId).toBe(first.executionId);
    expect(second.result).toEqual(first.result);
    expect(store.effects.mutations).toBe(1);
    expect(store.effects.notifications).toEqual(['aviso']);
  });
});

describe('falha ao gravar o registro transacional', () => {
  it('deixa zero mutações confirmadas — throw depois da mutação, mesmo tx', async () => {
    const store = seededStore();
    store.failNextInsert();
    await expect(runAgentWrite(commentWrite(store))).rejects.toThrow(/falha ao gravar o registro/);
    expect(store.effects.mutations).toBe(0);
    expect(store.effects.notifications).toEqual([]);
    expect(store.executions.size).toBe(0);
    expect(store.liveIndex.size).toBe(0);
  });
});

describe('revogação recusa a próxima execução', () => {
  it('grant viva escreve; depois da revogação a mesma chave é recusada', async () => {
    const store = seededStore();
    const ok = await runAgentWrite(commentWrite(store));
    expect(ok.replay).toBe(false);

    store.revokeGrant(GRANT_ID, agora);
    await expect(runAgentWrite(commentWrite(store, { idempotencyKey: 'outra-chave' }))).rejects.toMatchObject({
      code: 'permission_denied',
    });
    await expect(runAgentWrite(commentWrite(store))).rejects.toMatchObject({
      code: 'permission_denied',
    });
    expect(store.effects.mutations).toBe(1);
  });

  it('perfil desativado também recusa na próxima', async () => {
    const store = seededStore();
    store.seedPerson({ ...person, isActive: false });
    await expect(runAgentWrite(commentWrite(store))).rejects.toMatchObject({
      code: 'permission_denied',
    });
    expect(store.effects.mutations).toBe(0);
  });
});

describe('aprovado no payload do modelo não passa na prévia', () => {
  const moveParams = { taskId: TARGET_ID, listId: 'lista-destino', approved: true };

  function moveWrite(
    store: MemoryAgentWriteStore,
    extra: Partial<AgentWriteInput<{ taskId: string; listId: string }>> = {},
  ): AgentWriteInput<{ taskId: string; listId: string }> {
    return {
      store,
      grantId: GRANT_ID,
      operation: 'move_task' satisfies AgentWriteOperation,
      idempotencyKey: 'idem-move-1',
      targetId: TARGET_ID,
      params: moveParams,
      impact: { subtasksWouldMove: 3, automationWouldRun: false },
      origin: 'http',
      now: agora,
      mutate: async () => {
        store.effects.mutations += 1;
        store.effects.notifications.push('automacao');
        return {
          result: { taskId: TARGET_ID, listId: 'lista-destino' },
          changes: { subtasksMoved: 3 },
        };
      },
      ...extra,
    };
  }

  it('approved: true sem aprovação no servidor é recusado', async () => {
    const store = seededStore();
    await expect(runAgentWrite(moveWrite(store))).rejects.toMatchObject({
      code: 'preview_required',
    });
    expect(store.effects.mutations).toBe(0);
    expect(store.effects.notifications).toEqual([]);
  });

  it('approvalId + hash + revisão + prazo no servidor autorizam', async () => {
    const store = seededStore();
    const paramsHash = await hashWriteParams(moveParams);
    store.seedApproval({
      id: 'apr-servidor',
      grantId: GRANT_ID,
      ownerId: OWNER_ID,
      operation: 'move_task',
      paramsHash,
      policyVersion: 1,
      expiresAt: new Date(agora.getTime() + 10 * 60 * 1000),
    });
    const ok = await runAgentWrite(moveWrite(store, { approvalId: 'apr-servidor' }));
    expect(ok.replay).toBe(false);
    expect(ok.result).toEqual({ taskId: TARGET_ID, listId: 'lista-destino' });
    expect(store.effects.mutations).toBe(1);
  });

  it('hash de parâmetros ignora o campo approved do modelo', async () => {
    const withFlag = await hashWriteParams({ taskId: TARGET_ID, body: 'x', approved: true });
    const without = await hashWriteParams({ taskId: TARGET_ID, body: 'x' });
    expect(withFlag).toBe(without);
    expect(withFlag).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('janela de 24h', () => {
  it('depois da janela a mesma chave pode escrever de novo', async () => {
    const store = seededStore();
    const first = await runAgentWrite(commentWrite(store));
    const later = new Date(agora.getTime() + IDEMPOTENCY_WINDOW_MS + 1);
    const second = await runAgentWrite(commentWrite(store, { now: later }));
    expect(second.replay).toBe(false);
    expect(second.executionId).not.toBe(first.executionId);
    expect(store.effects.mutations).toBe(2);
    expect([...store.executions.values()].filter((row) => row.active)).toHaveLength(1);
    expect([...store.executions.values()].filter((row) => !row.active)).toHaveLength(1);
  });
});

describe('migration F16.6a fica no schema do IDE Works', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const nome = '20260921060000_ideworks_f16c_execucoes.sql';
  const sql = readFileSync(join(raiz, 'supabase', 'migrations', nome), 'utf8');
  const rollback = readFileSync(join(raiz, 'supabase', 'rollback', nome), 'utf8');

  it('o nome casa com o teste de par e com o regex da fase', () => {
    expect(nome).toMatch(/^\d{14}_ideworks_f\d+[a-z]*_/);
    expect(rollback.length).toBeGreaterThan(100);
    expect(rollback).toContain('drop table if exists ideworks.integration_executions');
    expect(rollback).toContain('drop table if exists ideworks.integration_write_approvals');
    expect(rollback).toContain('drop function if exists ideworks.integration_executions_guard()');
  });

  it('não toca no legado nem cria conta no Auth; grants só ideworks_app', () => {
    expect(sql).not.toMatch(/insert\s+into\s+auth\./i);
    expect(sql).not.toMatch(/create\s+user/i);
    expect(sql).not.toMatch(/\bpublic\.\w+/);
    expect(sql).toContain('create table ideworks.integration_executions');
    expect(sql).toContain('create table ideworks.integration_write_approvals');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('grant select, insert, update on ideworks.integration_executions to ideworks_app');
    expect(sql).toContain('grant select, insert on ideworks.integration_write_approvals to ideworks_app');
    expect(sql).toContain('revoke all on table ideworks.integration_executions from public, anon, authenticated');
    expect(sql).not.toMatch(/grant\s+all\s+on\s+table\s+ideworks\.integration_executions\s+to\s+(anon|authenticated)/i);
  });

  it('tem unique de concorrência, janela, resultado compacto e nenhuma coluna approved', () => {
    expect(sql).toContain('integration_executions_idempotency_live_idx');
    expect(sql).toContain('where active');
    expect(sql).toContain("interval '24 hours'");
    expect(sql).toContain('params_hash');
    expect(sql).toContain('policy_version');
    expect(sql).toContain('comment_body');
    expect(sql).not.toMatch(/\bapproved\s+(boolean|text|jsonb)/i);
    expect(sql).toContain('Não há coluna approved');
    expect(sql).toContain('acting_grant_id() is null');
  });
});

describe('teto diário de escritas — F21.1', () => {
  const OUTRA_GRANT = '44444444-4444-4444-8444-444444444444';

  /** Enche a cota do dia com escritas de chave distinta, como um laço faria. */
  async function escreverVezes(store: MemoryAgentWriteStore, vezes: number, quando = agora) {
    for (let i = 0; i < vezes; i += 1) {
      await runAgentWrite(commentWrite(store, { idempotencyKey: `laco-${i}`, now: quando }));
    }
  }

  it('o padrão é 50, e concessão sem teto guardado cai nele', () => {
    expect(DEFAULT_DAILY_WRITE_LIMIT).toBe(50);
    expect(resolveDailyWriteLimit(grant)).toBe(50);
    expect(resolveDailyWriteLimit({ ...grant, dailyWriteLimit: null })).toBe(50);
    // Número sem sentido não vira "sem teto": cai no padrão.
    expect(resolveDailyWriteLimit({ ...grant, dailyWriteLimit: -1 })).toBe(50);
    expect(resolveDailyWriteLimit({ ...grant, dailyWriteLimit: 7 })).toBe(7);
    // Zero é escolha legítima: suspende a escrita sem revogar a concessão.
    expect(resolveDailyWriteLimit({ ...grant, dailyWriteLimit: 0 })).toBe(0);
  });

  it('a 50ª passa e a 51ª é recusada com código próprio, distinto do limite por minuto', async () => {
    const store = seededStore();
    await escreverVezes(store, 50);
    expect(store.effects.mutations).toBe(50);

    const recusa = await runAgentWrite(
      commentWrite(store, { idempotencyKey: 'a-quinquagesima-primeira' }),
    ).then(
      () => null,
      (error: unknown) => error as { code: string; used: number; limit: number; resetsAt: Date },
    );

    expect(recusa?.code).toBe('daily_write_limit');
    expect(recusa?.code).not.toBe('rate_limited');
    expect(ERROR_STATUS.daily_write_limit).toBe(429);
    expect(recusa?.used).toBe(50);
    expect(recusa?.limit).toBe(50);
    // A mutação da recusada não aconteceu: cota não se cobra de escrita que falha.
    expect(store.effects.mutations).toBe(50);
  });

  it('a recusa diz quantas foram, qual o teto e quando ele vira', async () => {
    const store = seededStore();
    store.seedGrant({ ...grant, dailyWriteLimit: 2 });
    await escreverVezes(store, 2);

    const recusa = await runAgentWrite(commentWrite(store, { idempotencyKey: 'terceira' })).then(
      () => null,
      (error: unknown) => error as { message: string; resetsAt: Date },
    );

    expect(recusa?.message).toMatch(/2 de 2/);
    // A virada é a meia-noite seguinte NO FUSO DA AGÊNCIA — 03:00 UTC, e não
    // a meia-noite UTC, que cairia no meio do expediente de quem escreve.
    expect(recusa?.resetsAt.toISOString()).toBe('2026-09-22T03:00:00.000Z');
    expect(recusa?.message).toMatch(/22\/09\/2026/);
  });

  it('repetição idempotente devolve o resultado anterior e não consome cota', async () => {
    const store = seededStore();
    store.seedGrant({ ...grant, dailyWriteLimit: 1 });

    const primeira = await runAgentWrite(commentWrite(store));
    expect(primeira.replay).toBe(false);

    // A cota já está cheia. Mesmo assim a MESMA chave devolve o resultado
    // antigo: repetir não é escrever de novo.
    const repetida = await runAgentWrite(commentWrite(store));
    expect(repetida.replay).toBe(true);
    expect(repetida.executionId).toBe(primeira.executionId);
    expect(store.effects.mutations).toBe(1);

    // E uma chave nova, essa sim, bate no teto.
    await expect(
      runAgentWrite(commentWrite(store, { idempotencyKey: 'chave-nova' })),
    ).rejects.toMatchObject({ code: 'daily_write_limit' });
  });

  it('duas concessões do mesmo dono não dividem cota', async () => {
    const store = seededStore();
    store.seedGrant({ ...grant, dailyWriteLimit: 1 });
    store.seedGrant({ ...grant, id: OUTRA_GRANT, dailyWriteLimit: 1 });

    await runAgentWrite(commentWrite(store));
    await expect(
      runAgentWrite(commentWrite(store, { idempotencyKey: 'segunda-da-primeira' })),
    ).rejects.toMatchObject({ code: 'daily_write_limit' });

    // O laço de uma conexão não pode calar a outra.
    const outra = await runAgentWrite(
      commentWrite(store, { grantId: OUTRA_GRANT, idempotencyKey: 'da-outra' }),
    );
    expect(outra.replay).toBe(false);
    expect(store.effects.mutations).toBe(2);
  });

  it('a cota zera na virada do dia da agência, não na virada UTC', async () => {
    const store = seededStore();
    store.seedGrant({ ...grant, dailyWriteLimit: 1 });
    await runAgentWrite(commentWrite(store));

    // 02:00 UTC do dia 22 ainda é dia 21 em Ibitinga: a cota continua cheia.
    const aindaHoje = new Date('2026-09-22T02:00:00.000Z');
    await expect(
      runAgentWrite(commentWrite(store, { idempotencyKey: 'ainda-hoje', now: aindaHoje })),
    ).rejects.toMatchObject({ code: 'daily_write_limit' });

    // 03:00 UTC é a meia-noite de lá: dia novo, cota nova.
    const jaAmanha = new Date('2026-09-22T03:00:01.000Z');
    const depois = await runAgentWrite(
      commentWrite(store, { idempotencyKey: 'ja-amanha', now: jaAmanha }),
    );
    expect(depois.replay).toBe(false);
    expect(store.effects.mutations).toBe(2);
  });

  it('a janela do dia é meia-noite a meia-noite no fuso da agência', () => {
    const janela = agencyDayWindow(new Date('2026-09-21T06:00:00.000Z'));
    expect(janela.start.toISOString()).toBe('2026-09-21T03:00:00.000Z');
    expect(janela.end.toISOString()).toBe('2026-09-22T03:00:00.000Z');
  });

  it('escrita que falha não consome cota', async () => {
    const store = seededStore();
    store.seedGrant({ ...grant, dailyWriteLimit: 1 });
    store.failNextInsert();

    await expect(runAgentWrite(commentWrite(store))).rejects.toThrow(/falha ao gravar o registro/);
    expect(store.executions.size).toBe(0);

    // A vaga continua livre: a tentativa perdida não foi cobrada.
    const ok = await runAgentWrite(commentWrite(store, { idempotencyKey: 'depois-da-falha' }));
    expect(ok.replay).toBe(false);
  });
});

describe('migration F21.1 fica no schema do IDE Works', () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const nome = '20260921190000_ideworks_f21_1_teto_diario_de_escritas.sql';
  const sql = readFileSync(join(raiz, 'supabase', 'migrations', nome), 'utf8');
  const rollback = readFileSync(join(raiz, 'supabase', 'rollback', nome), 'utf8');

  it('é aditiva: acrescenta a coluna do teto e não mexe no que já está no ar', () => {
    expect(nome).toMatch(/^\d{14}_ideworks_f\d+[a-z]*_/);
    expect(sql).toContain('add column daily_write_limit integer not null default 50');
    expect(sql).toContain('integration_grants_daily_write_limit_sane');
    expect(sql).not.toMatch(/drop\s+(table|column|constraint)/i);
    expect(sql).not.toMatch(/create\s+table/i);
    expect(sql).not.toMatch(/\bpublic\.\w+/);
  });

  it('o rollback devolve a coluna e não toca no ledger', () => {
    expect(rollback.length).toBeGreaterThan(100);
    expect(rollback).toContain('drop column if exists daily_write_limit');
    // O histórico de escritas não é refém do teto: reverter não derruba tabela.
    expect(rollback).not.toMatch(/drop\s+table/i);
    expect(rollback).not.toMatch(/integration_executions/i);
  });
});
