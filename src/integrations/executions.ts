/**
 * Ledger, idempotência e prévia das escritas de agente — F16.6a / F16.6b.
 *
 * O callback de mutação é injetável: a suíte simula o efeito; F16.6b encaixa
 * a transação Postgres no mesmo objeto (`AgentWriteTx.sqlTx`). HTTP/MCP de
 * comentário e movimento moram em `writes.ts`.
 *
 * F21.1 — TETO DIÁRIO: a cota do dia é contada no próprio ledger, dentro da
 * mesma transação, depois da revalidação da concessão e antes da mutação.
 * Nada que o agente mande no corpo do pedido muda o número: ele sai da linha
 * da concessão e das linhas já gravadas.
 *
 * Conteúdo de tarefa não é instrução. A operação vem do contrato e da
 * concessão; o texto do card não amplia acesso.
 *
 * MESMA TRANSAÇÃO: mutação + insert do registro. Se o insert falha, o
 * store devolve o snapshot — a mutação não confirma.
 *
 * GANCHO F16.7 / F16.8 — `runAgentWrite` + miolo InTx no mesmo `Tx`:
 *
 *   const store = sqlAgentWriteStore; // withWriteTransaction = withActor
 *                                     // (Actor com integration) UMA vez
 *   await runAgentWrite({
 *     store,
 *     operation: 'add_comment', // ou 'move_task' na F16.8
 *     mutate: async (ledger) => {
 *       const posted = await postCommentInTx(ledger.sqlTx!, taskId, entrada);
 *       // F16.8: await moveTaskOnBoardInTx(ledger.sqlTx!, ...)
 *       return {
 *         result: { commentId: posted.id, taskId },
 *         changes: { commentsAdded: 1 },
 *       };
 *     },
 *   });
 *
 *   NÃO chamar `postComment` / `moveTaskOnBoard` daqui: esses wrappers
 *   abrem `withActor`/`begin` de novo, fora do ledger.
 *
 *   F16.7: HTTP/MCP `add_comment` usa este ledger + `postCommentInTx`.
 *   F16.8: HTTP/MCP `move_task` usa este ledger + `moveTaskOnBoardInTx`.
 */

import type { IntegrationErrorCode } from '@/integrations/contract';
import {
  allowsOperation,
  grantIsLive,
  isIntegrationCapability,
  type IntegrationCapability,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import {
  arrayOuNulo,
  comoJson,
  inlineUuid,
  withActor,
  type Actor,
  type ExecutionOrigin,
  type ServerEnv,
  type Tx,
} from '@/server/db';
import { borrowSql } from '@/server/db-request';

export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Teto diário de escritas confirmadas, por concessão (F21.1).
 *
 * POR QUE POR DIA, E NÃO SÓ POR MINUTO
 *   O limite de 60 por minuto da `limits.ts` impede a rajada; ele não impede
 *   o laço educado. Um agente que escreve uma vez a cada dois segundos passa
 *   folgado pelo limite por minuto e publica quarenta mil comentários antes
 *   de alguém acordar. O freio que falta é o do DIA.
 *
 * POR QUE 50
 *   É mais do que um dia de trabalho honesto de um agente ajudando numa
 *   carteira — e ordens de grandeza menos que um laço. Quem precisar de mais
 *   pede: a liberação pela tela é a Fase 5, e ela muda ESTE número por
 *   concessão, sem publicar código.
 *
 * POR QUE POR CONCESSÃO, E NÃO POR PESSOA
 *   Duas conexões do mesmo dono são dois agentes diferentes, com dois
 *   propósitos. O laço de um não pode consumir a cota do outro nem calar o
 *   que estava funcionando.
 */
export const DEFAULT_DAILY_WRITE_LIMIT = 50;

/**
 * O maior teto que a tela aceita (F21.5a). É o MESMO número do CHECK da
 * migration da F21.1 — escrito aqui para a recusa sair em português, antes de
 * o banco recusar em inglês com o nome da restrição.
 */
export const MAX_DAILY_WRITE_LIMIT = 100_000;

/**
 * O teto vigente de uma concessão. O agente não manda este número: ele vem
 * da linha da concessão, lida dentro da transação. Valor ausente, nulo ou
 * sem sentido cai no padrão — nunca em "sem teto".
 */
export function resolveDailyWriteLimit(grant: IntegrationGrant): number {
  const stored = grant.dailyWriteLimit;
  if (typeof stored !== 'number' || !Number.isFinite(stored) || stored < 0) {
    return DEFAULT_DAILY_WRITE_LIMIT;
  }
  return Math.floor(stored);
}

/**
 * Deslocamento do fuso da agência, em milissegundos, no instante dado.
 * `formatToParts` devolve a hora de parede; lida como se fosse UTC e
 * subtraída do instante real, sobra o deslocamento vigente naquele momento.
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const wall = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour') % 24,
    pick('minute'),
    pick('second'),
  );
  return wall - at.getTime();
}

function wallMidnight(year: number, month: number, day: number, timeZone: string, hint: Date): Date {
  const wall = Date.UTC(year, month - 1, day);
  // Duas passadas: a primeira usa o deslocamento de um instante qualquer do
  // dia, a segunda o deslocamento do próprio candidato. O Brasil não tem mais
  // horário de verão, mas a agência pode mudar de cidade e a conta não pode
  // errar uma hora na virada por causa disso.
  const guess = new Date(wall - zoneOffsetMs(hint, timeZone));
  return new Date(wall - zoneOffsetMs(guess, timeZone));
}

/**
 * O dia corrente no fuso da operação, como um par de instantes: início
 * inclusivo e virada exclusiva.
 *
 * O dia é o dia de quem trabalha, não o dia UTC. Contar em UTC zeraria a cota
 * às 21h de Ibitinga, no meio do expediente de quem está no ar — e o aviso de
 * "vira à meia-noite" seria mentira.
 */
export function agencyDayWindow(
  now: Date,
  timeZone: string = AGENCY_TIMEZONE,
): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  return {
    start: wallMidnight(year, month, day, timeZone, now),
    end: wallMidnight(year, month, day + 1, timeZone, now),
  };
}

/** A virada, escrita para quem lê a recusa — dia e hora no fuso da agência. */
export function describeDayReset(resetsAt: Date, timeZone: string = AGENCY_TIMEZONE): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(resetsAt);
}

export const AGENT_WRITE_OPERATIONS = [
  'add_comment',
  'move_task',
  // F26.5 — as escritas de tarefa. Mesmos nomes da checagem
  // `integration_executions_operation_sane` (migration F26.1).
  'create_task',
  'update_task',
  'assign_task',
  'complete_task',
  'reopen_task',
  // F26.6 — mural e histórico do cliente. O alvo do registro é a nota ou o
  // registro do histórico (id), nunca o texto.
  'add_mural_note',
  'update_mural_note',
  'add_history_entry',
  'update_history_entry',
] as const;
export type AgentWriteOperation = (typeof AGENT_WRITE_OPERATIONS)[number];

export function isAgentWriteOperation(value: string): value is AgentWriteOperation {
  return (AGENT_WRITE_OPERATIONS as readonly string[]).includes(value);
}

/**
 * A permissão que cada operação exige. Concluir e reabrir dividem uma
 * permissão só (decisão 5 da F26); criar e editar também.
 */
export const WRITE_OPERATION_CAPABILITY = {
  add_comment: 'comments:write',
  move_task: 'tasks:move',
  create_task: 'tasks:write',
  update_task: 'tasks:write',
  assign_task: 'tasks:assign',
  complete_task: 'tasks:complete',
  reopen_task: 'tasks:complete',
  add_mural_note: 'clients:mural:write',
  update_mural_note: 'clients:mural:write',
  add_history_entry: 'clients:history:write',
  update_history_entry: 'clients:history:write',
} as const satisfies Record<AgentWriteOperation, IntegrationCapability>;

export type WriteImpactDecision = 'auto' | 'preview_required';

/**
 * Política de impacto. O servidor observa os fatos; o modelo não declara a decisão.
 *
 * | Operação     | Condição                                         | Decisão            |
 * |--------------|--------------------------------------------------|--------------------|
 * | add_comment  | comentário simples (um alvo)                     | auto               |
 * | add_comment  | lote                                             | preview_required   |
 * | move_task    | movimento simples (0 subtarefas, sem automação)  | auto               |
 * | move_task    | subtarefas > 0                                   | preview_required   |
 * | move_task    | automação dispararia                             | preview_required   |
 * | move_task    | lote                                             | preview_required   |
 */
export const WRITE_IMPACT_DECISIONS = [
  { operation: 'add_comment', when: 'comentário simples (um alvo)', decision: 'auto' },
  { operation: 'add_comment', when: 'lote', decision: 'preview_required' },
  { operation: 'move_task', when: 'movimento simples (sem subtarefas e sem automação)', decision: 'auto' },
  { operation: 'move_task', when: 'movimento com subtarefas', decision: 'preview_required' },
  { operation: 'move_task', when: 'movimento com automação', decision: 'preview_required' },
  { operation: 'move_task', when: 'lote', decision: 'preview_required' },
] as const;

export type WriteImpactFacts = {
  /** Lote observado no servidor — não um booleano enviado pelo modelo. */
  batch?: boolean;
  /** Quantas subtarefas o movimento levaria, observado antes de escrever. */
  subtasksWouldMove?: number;
  /** Se a etapa de chegada tem automação que rodaria. */
  automationWouldRun?: boolean;
};

const FORBIDDEN_RESULT_KEYS = ['body', 'content', 'text', 'comment_body', 'commentBody'] as const;

const SKIP_FROM_HASH = new Set(['approved', 'approvalId', 'idempotencyKey']);

export type AgentWriteErrorCode =
  | Extract<
      IntegrationErrorCode,
      'permission_denied' | 'state_conflict' | 'invalid_input' | 'daily_write_limit'
    >
  | 'preview_required';

export class AgentWriteError extends Error {
  readonly code: AgentWriteErrorCode;

  constructor(code: AgentWriteErrorCode, message: string) {
    super(message);
    this.name = 'AgentWriteError';
    this.code = code;
  }
}

/**
 * Recusa por teto diário. Carrega os três números que a pessoa (e o agente)
 * precisam para entender a parada: quantas já foram, qual o teto e quando ele
 * vira. Sem isso a recusa vira "não pode", e quem lê tenta de novo em seguida.
 */
export class DailyWriteLimitError extends AgentWriteError {
  readonly used: number;
  readonly limit: number;
  readonly resetsAt: Date;

  constructor(used: number, limit: number, resetsAt: Date) {
    super(
      'daily_write_limit',
      `Esta integração já fez ${used} de ${limit} escritas confirmadas hoje, o teto do dia. ` +
        `A cota zera em ${describeDayReset(resetsAt)} (fuso da agência). ` +
        'Para escrever antes disso, o responsável precisa aumentar o teto na tela de conexões.',
    );
    this.name = 'DailyWriteLimitError';
    this.used = used;
    this.limit = limit;
    this.resetsAt = resetsAt;
  }
}

/** Espelha unique_violation do Postgres (23505). */
export class LedgerUniqueViolation extends Error {
  readonly code = '23505';

  constructor() {
    super('duplicate key value violates unique constraint "integration_executions_idempotency_live_idx"');
    this.name = 'LedgerUniqueViolation';
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '23505' || code === 'unique_violation';
}

export type PreviewApproval = {
  id: string;
  grantId: string;
  ownerId: string;
  operation: AgentWriteOperation;
  paramsHash: string;
  policyVersion: number;
  expiresAt: Date;
};

export type PersistedExecution<TResult = Record<string, unknown>> = {
  id: string;
  grantId: string;
  ownerId: string;
  operation: AgentWriteOperation;
  targetId: string;
  occurredAt: Date;
  result: TResult;
  changes: Record<string, unknown>;
  idempotencyKey: string;
  paramsHash: string;
  policyVersion: number;
  origin: ExecutionOrigin;
  active: boolean;
  /**
   * F21.2 — quando o dono desfez esta escrita, e quem desfez. A linha NÃO é
   * apagada: o comentário some da conversa, o fato de ter existido não some.
   * Nulo/ausente = escrita viva. Só o desfazer preenche isto.
   */
  undoneAt?: Date | null;
  undoneBy?: string | null;
};

export type AgentWriteSuccess<TResult> = {
  replay: boolean;
  /**
   * Vazio (`''`) no ensaio que não achou escrita anterior: não há execução.
   * Quem responde ao agente traduz para `null`.
   */
  executionId: string;
  occurredAt: Date;
  result: TResult;
  changes: Record<string, unknown>;
  policyVersion: number;
  /** F26.5 — `true` quando foi ensaio (`dryRun`): nada foi confirmado. */
  dryRun: boolean;
  /** Só no ensaio que chegou à mutação: a cota do dia, sem contar este ensaio. */
  dailyWrites?: { used: number; limit: number; resetsAt: Date };
};

export type AgentWriteMutation<TResult> = {
  result: TResult;
  changes: Record<string, unknown>;
  /**
   * F26.5 — o alvo que só existe DEPOIS da mutação (a tarefa criada). Quando
   * vem, substitui `AgentWriteInput.targetId` na linha do registro.
   */
  targetId?: string;
};

/**
 * A concessão e a pessoa RELIDAS e travadas dentro da transação da escrita.
 * O recorte de quem muta deve sair daqui, e não da concessão que chegou com a
 * requisição: entre o portão e a transação, a concessão pode ter mudado.
 */
export type AgentWriteAccess = { grant: IntegrationGrant; person: PersonAccess };

export type AgentWriteTx = {
  loadGrant(grantId: string): Promise<{ grant: IntegrationGrant; person: PersonAccess } | null>;
  findLiveExecution(
    grantId: string,
    operation: AgentWriteOperation,
    key: string,
    now: Date,
  ): Promise<PersistedExecution | null>;
  insertExecution(row: PersistedExecution): Promise<void>;
  deactivateExpired(
    grantId: string,
    operation: AgentWriteOperation,
    key: string,
    now: Date,
  ): Promise<void>;
  getApproval(id: string): Promise<PreviewApproval | null>;
  /**
   * Quantas escritas CONFIRMADAS esta concessão gravou na janela — o próprio
   * ledger é o contador (F21.1). Não existe tabela de cota: um segundo lugar
   * guardando o mesmo número só criaria a chance de os dois discordarem.
   *
   * Conta a linha exista ela ativa ou não: `active` fala da janela de 24h da
   * chave de idempotência, não de a escrita ter acontecido.
   */
  countWritesInWindow(grantId: string, from: Date, to: Date): Promise<number>;
  /**
   * F26.5 — `true` durante o ensaio (`dryRun`). O store SQL não precisa ler
   * isto: a transação inteira do ensaio termina em ROLLBACK. Os ports em
   * memória, que não têm transação, leem para não confirmar o efeito.
   */
  rehearsal?: boolean;
  /**
   * F16.7 / F16.8: o store SQL preenche com o `Tx` da `withActor` que
   * envolve esta escrita. `mutate` chama `postCommentInTx` /
   * `moveTaskOnBoardInTx` neste mesmo objeto. Ausente no store em memória
   * (F16.6a) — a suíte não fala com o banco.
   */
  sqlTx?: Tx;
};

export type AgentWriteStore = {
  withWriteTransaction<T>(work: (tx: AgentWriteTx) => Promise<T>): Promise<T>;
};

export type AgentWriteInput<TResult> = {
  store: AgentWriteStore;
  grantId: string;
  operation: AgentWriteOperation;
  idempotencyKey: string;
  targetId: string;
  params: Record<string, unknown>;
  impact: WriteImpactFacts;
  origin: ExecutionOrigin;
  /** Id da aprovação persistida no servidor. Ignorado se a política for `auto`. */
  approvalId?: string;
  now?: Date;
  /**
   * F26.5 — permissões além da principal da operação, conferidas na concessão
   * RELIDA. Ex.: `create_task` com responsáveis exige também `tasks:assign`.
   */
  requires?: readonly IntegrationCapability[];
  /**
   * F26.5 — ensaio. Faz tudo (revalida, replay, teto, mutação) e desfaz a
   * transação inteira no fim: nada é confirmado, nada entra no registro, nada
   * conta no teto. Decisão 6 da F26.
   */
  dryRun?: boolean;
  mutate: (tx: AgentWriteTx, access: AgentWriteAccess) => Promise<AgentWriteMutation<TResult>>;
};

export type ExecutionEffects = {
  mutations: number;
  notifications: string[];
};

export function decideWriteImpact(
  operation: AgentWriteOperation,
  facts: WriteImpactFacts = {},
): WriteImpactDecision {
  if (facts.batch === true) return 'preview_required';
  if (operation === 'add_comment') return 'auto';
  if ((facts.subtasksWouldMove ?? 0) > 0) return 'preview_required';
  if (facts.automationWouldRun === true) return 'preview_required';
  return 'auto';
}

export function canonicalizeWriteParams(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalizeWriteParams);
  const object = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    if (SKIP_FROM_HASH.has(key)) continue;
    out[key] = canonicalizeWriteParams(object[key]);
  }
  return out;
}

export async function hashWriteParams(params: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonicalizeWriteParams(params))),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function assertCompactEffect(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentWriteError('invalid_input', 'O resultado da execução precisa ser um objeto compacto.');
  }
  const record = value as Record<string, unknown>;
  for (const key of FORBIDDEN_RESULT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw new AgentWriteError(
        'invalid_input',
        'O registro de execução não guarda o corpo do comentário.',
      );
    }
  }
}

function liveKey(grantId: string, operation: string, key: string): string {
  return `${grantId}\0${operation}\0${key}`;
}

function toSuccess<TResult>(
  row: PersistedExecution,
  replay: boolean,
  dryRun = false,
): AgentWriteSuccess<TResult> {
  return {
    replay,
    executionId: row.id,
    occurredAt: row.occurredAt,
    result: row.result as TResult,
    changes: row.changes,
    policyVersion: row.policyVersion,
    dryRun,
  };
}

/**
 * O fim do ensaio. É lançado DE DENTRO da transação para ela terminar em
 * ROLLBACK (Postgres) ou devolver o retrato (memória), e apanhado fora, em
 * `runAgentWrite`, onde vira o resultado. Não é erro: é o único jeito de
 * responder com o que a mutação produziu e ainda assim desfazê-la inteira.
 */
class RehearsalDone<TResult> extends Error {
  readonly outcome: AgentWriteSuccess<TResult>;

  constructor(outcome: AgentWriteSuccess<TResult>) {
    super('ensaio concluído, transação desfeita');
    this.name = 'RehearsalDone';
    this.outcome = outcome;
  }
}

function conflict(): AgentWriteError {
  return new AgentWriteError(
    'state_conflict',
    'Esta chave de idempotência já foi usada com parâmetros diferentes.',
  );
}

function denied(message: string): AgentWriteError {
  return new AgentWriteError('permission_denied', message);
}

function requireIdempotencyKey(key: string): void {
  if (key.trim().length < 1 || key.length > 128 || /[\r\n]/.test(key)) {
    throw new AgentWriteError('invalid_input', 'A chave de idempotência é inválida.');
  }
}

function requireTargetId(targetId: string): void {
  if (targetId.trim().length < 1) {
    throw new AgentWriteError('invalid_input', 'A escrita de agente precisa de um alvo.');
  }
}

function approvalHolds(
  approval: PreviewApproval,
  input: { grant: IntegrationGrant; operation: AgentWriteOperation; paramsHash: string; now: Date },
): boolean {
  if (approval.grantId !== input.grant.id) return false;
  if (approval.ownerId !== input.grant.ownerId) return false;
  if (approval.operation !== input.operation) return false;
  if (approval.paramsHash !== input.paramsHash) return false;
  if (approval.policyVersion !== input.grant.policyVersion) return false;
  if (approval.expiresAt.getTime() <= input.now.getTime()) return false;
  return true;
}

async function commitWrite<TResult>(
  tx: AgentWriteTx,
  input: AgentWriteInput<TResult>,
  paramsHash: string,
  now: Date,
): Promise<AgentWriteSuccess<TResult>> {
  requireIdempotencyKey(input.idempotencyKey);
  requireTargetId(input.targetId);

  const loaded = await tx.loadGrant(input.grantId);
  if (!loaded) throw denied('Concessão inexistente ou fora do alcance.');
  const { grant, person } = loaded;
  if (!person.isActive) throw denied('O responsável desta integração está desativado.');
  if (person.userId !== grant.ownerId) throw denied('O proprietário da integração não confere.');
  if (!grantIsLive(grant, now)) throw denied('A concessão foi revogada ou venceu.');
  const capability = WRITE_OPERATION_CAPABILITY[input.operation];
  if (!allowsOperation(person, grant, capability, now)) {
    throw denied('Esta concessão não autoriza a escrita pedida.');
  }
  for (const extra of input.requires ?? []) {
    if (!allowsOperation(person, grant, extra, now)) {
      throw denied(`Esta concessão não autoriza a escrita pedida: falta a permissão ${extra}.`);
    }
  }

  const dryRun = input.dryRun === true;
  const existing = await tx.findLiveExecution(grant.id, input.operation, input.idempotencyKey, now);
  if (existing) {
    if (existing.paramsHash !== paramsHash) throw conflict();
    return toSuccess<TResult>(existing, true, dryRun);
  }

  // O ensaio não faz a faxina da chave vencida: ele não grava NADA.
  if (!dryRun) await tx.deactivateExpired(grant.id, input.operation, input.idempotencyKey, now);

  if (decideWriteImpact(input.operation, input.impact) === 'preview_required') {
    const approval = input.approvalId ? await tx.getApproval(input.approvalId) : null;
    if (!approval || !approvalHolds(approval, { grant, operation: input.operation, paramsHash, now })) {
      throw new AgentWriteError(
        'preview_required',
        'Esta escrita exige prévia confirmada no servidor (id, parâmetros, revisão e prazo).',
      );
    }
  }

  // O TETO DIÁRIO ENTRA AQUI, E SÓ AQUI.
  //   Depois da revalidação da concessão (teto de concessão morta não
  //   interessa), depois do replay (repetir uma escrita que já aconteceu
  //   devolve o resultado antigo e não gasta cota de novo) e ANTES da
  //   mutação — cota cobrada por escrita que falha é cota perdida.
  //   Dentro da MESMA transação: a leitura da concessão trava a linha, então
  //   duas escritas disputando a última vaga serializam, uma passa e a outra
  //   é recusada.
  const dailyLimit = resolveDailyWriteLimit(grant);
  const day = agencyDayWindow(now);
  const usedToday = await tx.countWritesInWindow(grant.id, day.start, day.end);
  if (usedToday >= dailyLimit) throw new DailyWriteLimitError(usedToday, dailyLimit, day.end);

  // No ensaio a mutação roda de verdade — é o que faz o banco aplicar as regras
  // dele (alcance, responsáveis possíveis, etiqueta do espaço) — e a transação
  // inteira é desfeita em `runAgentWrite`. `rehearsal` avisa os ports em
  // memória, que não têm transação para desfazer.
  const ledger: AgentWriteTx = dryRun ? { ...tx, rehearsal: true } : tx;
  const produced = await input.mutate(ledger, { grant, person });
  assertCompactEffect(produced.result);
  assertCompactEffect(produced.changes);
  const targetId = produced.targetId ?? input.targetId;
  requireTargetId(targetId);

  if (dryRun) {
    return {
      replay: false,
      executionId: '',
      occurredAt: now,
      result: produced.result,
      changes: produced.changes,
      policyVersion: grant.policyVersion,
      dryRun: true,
      dailyWrites: { used: usedToday, limit: dailyLimit, resetsAt: day.end },
    };
  }

  const row: PersistedExecution = {
    id: crypto.randomUUID(),
    grantId: grant.id,
    ownerId: grant.ownerId,
    operation: input.operation,
    targetId,
    occurredAt: now,
    result: produced.result as Record<string, unknown>,
    changes: produced.changes,
    idempotencyKey: input.idempotencyKey,
    paramsHash,
    policyVersion: grant.policyVersion,
    origin: input.origin,
    active: true,
  };
  await tx.insertExecution(row);
  return toSuccess<TResult>(row, false);
}

/**
 * Executa uma escrita de agente com revalidação, prévia, idempotência e
 * registro na mesma transação. Callback de mutação injetável.
 *
 * F16.7: `mutate` recebe o ledger já dentro de `withWriteTransaction`.
 * Com o store SQL, `ledger.sqlTx` é o Postgres `Tx` aberto por
 * `withActor`; `postCommentInTx(ledger.sqlTx, …)` participa dele. O
 * store em memória não preenche `sqlTx`.
 */
export async function runAgentWrite<TResult>(
  input: AgentWriteInput<TResult>,
): Promise<AgentWriteSuccess<TResult>> {
  const now = input.now ?? new Date();
  const paramsHash = await hashWriteParams(input.params);
  if (input.dryRun === true) {
    // Tudo dentro de UMA transação, e ela termina desfeita: o `throw` de dentro
    // é o que faz o store dar ROLLBACK (ou devolver o retrato, em memória).
    try {
      await input.store.withWriteTransaction(async (tx) => {
        throw new RehearsalDone(await commitWrite(tx, input, paramsHash, now));
      });
    } catch (error) {
      if (error instanceof RehearsalDone) return error.outcome as AgentWriteSuccess<TResult>;
      throw error;
    }
    throw new Error('O ensaio terminou sem resultado.');
  }
  try {
    return await input.store.withWriteTransaction((tx) => commitWrite(tx, input, paramsHash, now));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return await input.store.withWriteTransaction(async (tx) => {
      const existing = await tx.findLiveExecution(
        input.grantId,
        input.operation,
        input.idempotencyKey,
        now,
      );
      if (existing && existing.paramsHash === paramsHash) return toSuccess<TResult>(existing, true);
      if (existing) throw conflict();
      throw error;
    });
  }
}

/**
 * Store em memória. A suíte não fala com o banco (F0.4). Unique parcial e
 * rollback de transação espelham o Postgres: duas chamadas com a mesma chave
 * serializam; falha no insert devolve o snapshot dos efeitos.
 */
export class MemoryAgentWriteStore implements AgentWriteStore {
  readonly grants = new Map<string, IntegrationGrant>();
  readonly people = new Map<string, PersonAccess>();
  /** Todas as linhas, inclusive inativas após a janela. */
  readonly executions = new Map<string, PersistedExecution>();
  /** Unique parcial: só a execução `active` de cada (grant, operação, chave). */
  readonly liveIndex = new Map<string, string>();
  readonly approvals = new Map<string, PreviewApproval>();
  readonly effects: ExecutionEffects = { mutations: 0, notifications: [] };
  failInsertsRemaining = 0;
  private tail: Promise<unknown> = Promise.resolve();

  seedPerson(person: PersonAccess): void {
    this.people.set(person.userId, person);
  }

  seedGrant(grant: IntegrationGrant): void {
    this.grants.set(grant.id, grant);
  }

  seedApproval(approval: PreviewApproval): void {
    this.approvals.set(approval.id, approval);
  }

  revokeGrant(grantId: string, at: Date = new Date()): IntegrationGrant | null {
    const grant = this.grants.get(grantId);
    if (!grant) return null;
    const revoked: IntegrationGrant = {
      ...grant,
      revokedAt: at,
      policyVersion: grant.policyVersion + 1,
    };
    this.grants.set(grantId, revoked);
    return revoked;
  }

  failNextInsert(times = 1): void {
    this.failInsertsRemaining += times;
  }

  async withWriteTransaction<T>(work: (tx: AgentWriteTx) => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail = prev.then(
      () => held,
      () => held,
    );
    await prev.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await this.runIsolated(work);
    } finally {
      release();
    }
  }

  private async runIsolated<T>(work: (tx: AgentWriteTx) => Promise<T>): Promise<T> {
    const snapEffects: ExecutionEffects = {
      mutations: this.effects.mutations,
      notifications: [...this.effects.notifications],
    };
    const snapExecutions = new Map(this.executions);
    const snapLive = new Map(this.liveIndex);
    try {
      return await work(this.asTx());
    } catch (error) {
      this.effects.mutations = snapEffects.mutations;
      this.effects.notifications.splice(
        0,
        this.effects.notifications.length,
        ...snapEffects.notifications,
      );
      this.executions.clear();
      for (const [key, row] of snapExecutions) this.executions.set(key, row);
      this.liveIndex.clear();
      for (const [key, id] of snapLive) this.liveIndex.set(key, id);
      throw error;
    }
  }

  private asTx(): AgentWriteTx {
    return {
      loadGrant: async (grantId) => {
        const grant = this.grants.get(grantId) ?? null;
        if (!grant) return null;
        const person = this.people.get(grant.ownerId) ?? null;
        if (!person) return null;
        return { grant, person };
      },
      findLiveExecution: async (grantId, operation, key, now) => {
        const id = this.liveIndex.get(liveKey(grantId, operation, key));
        if (!id) return null;
        const row = this.executions.get(id);
        if (!row || !row.active) return null;
        if (now.getTime() - row.occurredAt.getTime() >= IDEMPOTENCY_WINDOW_MS) return null;
        return row;
      },
      insertExecution: async (row) => {
        if (this.failInsertsRemaining > 0) {
          this.failInsertsRemaining -= 1;
          throw new Error('falha ao gravar o registro de execução');
        }
        const key = liveKey(row.grantId, row.operation, row.idempotencyKey);
        if (this.liveIndex.has(key)) throw new LedgerUniqueViolation();
        this.executions.set(row.id, row);
        this.liveIndex.set(key, row.id);
      },
      deactivateExpired: async (grantId, operation, key, now) => {
        const mapKey = liveKey(grantId, operation, key);
        const id = this.liveIndex.get(mapKey);
        if (!id) return;
        const row = this.executions.get(id);
        if (!row || !row.active) return;
        if (now.getTime() - row.occurredAt.getTime() < IDEMPOTENCY_WINDOW_MS) return;
        this.executions.set(id, { ...row, active: false });
        this.liveIndex.delete(mapKey);
      },
      getApproval: async (id) => this.approvals.get(id) ?? null,
      countWritesInWindow: async (grantId, from, to) => {
        let total = 0;
        for (const row of this.executions.values()) {
          if (row.grantId !== grantId) continue;
          const at = row.occurredAt.getTime();
          if (at < from.getTime() || at >= to.getTime()) continue;
          total += 1;
        }
        return total;
      },
    };
  }
}

function asIso(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

/**
 * Os clientes que a pessoa alcança, para `PersonAccess.clientIds` — a regra
 * de `can_see_client` desde a F17.32 (`can_see_client_for`, F17.41): os
 * vinculados a ela (`user_clients`) E todos os das empresas dela
 * (`user_categories`). Auditoria de 08/10/2026: o agente lia só o primeiro
 * ramo, e quem enxerga os clientes pela empresa ficava sem nenhum.
 *
 * Os dois outros ramos da função (topo e "acesso a todos os clientes") não
 * passam por aqui: quem os tem alcança tudo (`personReachesClient`), e a
 * lista fica só com os vínculos diretos, como antes. Cliente de empresa
 * OMITIDA não entra pela empresa (F31, Fase 3b: ela não existe para o
 * agente). Nada aqui alarga o banco: é o mesmo conjunto da função, e a
 * leitura ainda passa pela política de `clients` de quem consulta.
 *
 * Usada pelo portão (`createSqlGrantStore().person`) e pela releitura da
 * escrita (`sqlLedger().loadGrant`) — as duas precisam dizer o mesmo.
 */
export async function reachableClientIdsInTx(
  tx: Tx,
  person: { userId: string; isSuper: boolean; hasAllClientsAccess: boolean },
  omittedCompanyIds: readonly string[] = [],
  /**
   * Os vínculos diretos, se quem chama já os leu (ver `directClientIdsQuery`).
   * Quem não passa recebe a leitura de sempre, aqui dentro.
   */
  directRows?: ReadonlyArray<Record<string, unknown>>,
): Promise<string[]> {
  const direct = directRows ?? (await directClientIdsQuery(tx, person.userId));
  const ids = direct.map((row) => row.id as string);
  if (person.isSuper || person.hasAllClientsAccess) return ids;
  const viaCompany = await tx`
    select c.id::text as id
      from ideworks.clients c
      join ideworks.user_categories uc on uc.category_id = c.category_id and uc.user_id = ${inlineUuid(tx, person.userId)}::uuid
     ${
       omittedCompanyIds.length === 0
         ? tx``
         : tx`where not (c.category_id = any(${arrayOuNulo(omittedCompanyIds)}::uuid[]))`
     }`;
  return [...new Set([...ids, ...viaCompany.map((row) => row.id as string)])];
}

/**
 * A consulta dos vínculos diretos (`user_clients`) — solta para o portão poder
 * mandá-la na mesma ida da leitura do perfil e das empresas. O id do dono vai no
 * texto (`inlineUuid`): sem parâmetro, as três consultas independentes saem juntas.
 */
export function directClientIdsQuery(tx: Tx, userId: string) {
  return tx`
    select client_id::text as id from ideworks.user_clients where user_id = ${inlineUuid(tx, userId)}::uuid`;
}

function grantFromSql(row: Record<string, unknown>): IntegrationGrant {
  const capabilities = ((row.capabilities as string[]) ?? []).filter(isIntegrationCapability);
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    oauthClientId: String(row.oauth_client_id),
    name: String(row.name),
    capabilities,
    allowedCompanyIds: (row.allowed_company_ids as string[] | null) ?? null,
    allowedClientIds: (row.allowed_client_ids as string[] | null) ?? null,
    expiresAt: row.expires_at ? asIso(row.expires_at) : null,
    revokedAt: row.revoked_at ? asIso(row.revoked_at) : null,
    policyVersion: Number(row.policy_version),
    dailyWriteLimit: row.daily_write_limit === null || row.daily_write_limit === undefined
      ? null
      : Number(row.daily_write_limit),
  };
}

function executionFromSql(row: Record<string, unknown>): PersistedExecution {
  const operation = String(row.operation);
  if (!isAgentWriteOperation(operation)) {
    throw new Error(`Operação de execução inválida: ${operation}`);
  }
  const origin = String(row.origin);
  if (origin !== 'mcp' && origin !== 'http' && origin !== 'automation') {
    throw new Error(`Origem de execução inválida: ${origin}`);
  }
  return {
    id: String(row.id),
    grantId: String(row.grant_id),
    ownerId: String(row.owner_id),
    operation,
    targetId: String(row.target_id),
    occurredAt: asIso(row.occurred_at),
    result: (row.result ?? {}) as Record<string, unknown>,
    changes: (row.changes ?? {}) as Record<string, unknown>,
    idempotencyKey: String(row.idempotency_key),
    paramsHash: String(row.params_hash),
    policyVersion: Number(row.policy_version),
    origin,
    active: row.active === true,
    undoneAt: row.undone_at ? asIso(row.undone_at) : null,
    undoneBy: row.undone_by ? String(row.undone_by) : null,
  };
}

/**
 * O registro sobre um `Tx` já aberto. Exportado para as provas contra o banco
 * (`scripts/provar-tarefas-pela-ia.mjs`) montarem o MESMO ledger dentro de uma
 * transação que termina em rollback — produção só o usa por
 * `createSqlAgentWriteStore`.
 */
export function sqlLedger(tx: Tx): AgentWriteTx {
  return {
    sqlTx: tx,
    async loadGrant(grantId) {
      // `for update`: a linha da concessão é o ponto de serialização das
      // escritas dela. Sem essa trava, duas transações simultâneas leriam a
      // mesma contagem de cota e as duas passariam pela última vaga.
      //
      // ⚠️ ARMADILHA — `for update` sob RLS NÃO é só a política de SELECT.
      //   O Postgres aplica também o `USING` das políticas de UPDATE da
      //   tabela, como filtro silencioso: a linha que o ator não poderia
      //   travar não volta, sem erro e sem aviso. Como
      //   `integration_grants_update` exige `acting_grant_id() is null`
      //   (sessão humana), esta consulta devolvia ZERO linhas para ator de
      //   agente — e toda escrita de agente morria aqui, devolvendo
      //   "Concessão inexistente ou fora do alcance" com a concessão viva e
      //   com a capacidade certa. Foi o incidente de 21→22/09/2026.
      //
      //   Quem segura esta linha de pé é a política `integration_grants_lock_self`
      //   (migration F21.3): ela libera o TRAVAR e nada mais — `with check
      //   (false)`, então o agente continua sem conseguir alterar a concessão.
      //   Se alguém remover aquela política, este `for update` volta a cegar.
      //   Se alguém remover este `for update`, a cota diária deixa de ser
      //   serializada. As duas coisas andam juntas.
      const grants = await tx`
        select id, owner_id, oauth_client_id, name, capabilities,
               allowed_company_ids, allowed_client_ids, expires_at, revoked_at,
               policy_version, daily_write_limit
          from ideworks.integration_grants
         where id = ${grantId}::uuid
           for update`;
      const grantRow = grants[0];
      if (!grantRow) return null;
      const grant = grantFromSql(grantRow as Record<string, unknown>);
      const perfil = await tx`
        select id, is_active, is_superadmin, role::text as role, has_all_clients_access
          from ideworks.profiles where id = ${grant.ownerId}::uuid`;
      const personRow = perfil[0];
      if (!personRow) return null;
      const companies = await tx`
        select category_id::text as id from ideworks.user_categories where user_id = ${grant.ownerId}::uuid`;
      const isSuper = personRow.role === 'super_admin';
      const hasAllClientsAccess = personRow.has_all_clients_access as boolean;
      // A mesma regra do portão. As omitidas não são do banco: `accessOf`
      // (writes.ts) as traz da pessoa do pedido, e o recorte as tira.
      const clientIds = await reachableClientIdsInTx(tx, {
        userId: grant.ownerId,
        isSuper,
        hasAllClientsAccess,
      });
      const person: PersonAccess = {
        userId: personRow.id as string,
        isActive: personRow.is_active as boolean,
        isSuperadmin: personRow.is_superadmin as boolean,
        isSuper,
        companyIds: companies.map((row) => row.id as string),
        clientIds,
        hasAllClientsAccess,
      };
      return { grant, person };
    },
    async findLiveExecution(grantId, operation, key, now) {
      const cutoff = new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS);
      const rows = await tx`
        select id, grant_id, owner_id, operation, target_id, occurred_at, result, changes,
               idempotency_key, params_hash, policy_version, origin, active
          from ideworks.integration_executions
         where grant_id = ${grantId}::uuid
           and operation = ${operation}
           and idempotency_key = ${key}
           and active
           and occurred_at > ${cutoff}`;
      const row = rows[0];
      return row ? executionFromSql(row as Record<string, unknown>) : null;
    },
    async insertExecution(row) {
      await tx`
        insert into ideworks.integration_executions (
          id, grant_id, owner_id, operation, target_id, occurred_at,
          result, changes, idempotency_key, params_hash, policy_version, origin, active
        ) values (
          ${row.id}::uuid,
          ${row.grantId}::uuid,
          ${row.ownerId}::uuid,
          ${row.operation},
          ${row.targetId}::uuid,
          ${row.occurredAt},
          ${comoJson(tx, row.result)},
          ${comoJson(tx, row.changes)},
          ${row.idempotencyKey},
          ${row.paramsHash},
          ${row.policyVersion},
          ${row.origin},
          ${row.active}
        )`;
    },
    async deactivateExpired(grantId, operation, key, now) {
      const cutoff = new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS);
      await tx`
        update ideworks.integration_executions
           set active = false
         where grant_id = ${grantId}::uuid
           and operation = ${operation}
           and idempotency_key = ${key}
           and active
           and occurred_at <= ${cutoff}`;
    },
    async countWritesInWindow(grantId, from, to) {
      const rows = await tx`
        select count(*)::int as total
          from ideworks.integration_executions
         where grant_id = ${grantId}::uuid
           and occurred_at >= ${from}
           and occurred_at < ${to}`;
      return Number(rows[0]?.total ?? 0);
    },
    async getApproval(id) {
      const rows = await tx`
        select id, grant_id, owner_id, operation, params_hash, policy_version, expires_at
          from ideworks.integration_write_approvals
         where id = ${id}::uuid`;
      const row = rows[0];
      if (!row) return null;
      const operation = String(row.operation);
      if (!isAgentWriteOperation(operation)) return null;
      return {
        id: String(row.id),
        grantId: String(row.grant_id),
        ownerId: String(row.owner_id),
        operation,
        paramsHash: String(row.params_hash),
        policyVersion: Number(row.policy_version),
        expiresAt: asIso(row.expires_at),
      };
    },
  };
}

/**
 * Store SQL: UMA `withActor` (Actor com `integration`) por escrita.
 * `sqlTx` é esse Tx — `postCommentInTx` participa dele.
 */
export function createSqlAgentWriteStore(env: ServerEnv, actor: Actor): AgentWriteStore {
  return {
    async withWriteTransaction<T>(work: (tx: AgentWriteTx) => Promise<T>): Promise<T> {
      // Conexão emprestada da requisição (F22, Fase 2). A transação é a mesma
      // de sempre: uma escrita, um `withActor`, um commit.
      return borrowSql(env, 'escrita', (sql) => withActor(sql, actor, (tx) => work(sqlLedger(tx))));
    },
  };
}
