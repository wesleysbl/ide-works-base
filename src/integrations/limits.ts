/**
 * Limites e rastros da integração — F16.2b.
 *
 * POR QUE A CONTAGEM MORA NUM STORE INJETÁVEL (E NO BANCO, EM PRODUÇÃO)
 *   O Worker tem várias instâncias. Contar na memória do isolado é a mesma
 *   trava de teatro que a F1.4 descreveu para o login: quem espalha chamadas
 *   nunca reencontra o contador. O store é a mesma abstração do limitador
 *   humano (`src/auth/rate-limit.ts`); a implementação SQL entra na migration
 *   `f16b_limites`.
 *
 * POR QUE ESTE LIMITADOR FALHA FECHADO
 *   O login falha ABERTO se o banco do limitador cair: sem banco ninguém
 *   entra de qualquer jeito, e trancar a porta impediria o conserto. Aqui é
 *   o contrário. Sem conseguir confirmar a concessão OU o teto, a operação
 *   do agente NÃO executa — um token ainda válido no KV de outro isolado
 *   não atravessa um furo de disponibilidade.
 *
 * TETOS ESCOLHIDOS
 *   Por integração (grant): 60 chamadas / 60s. Um turno de agente (initialize
 *   + tools/list + algumas tools/call) cabe; um laço desgovernado não.
 *   Por proprietário: 180 / 60s. Três conexões no teto individual saturam o
 *   teto da pessoa; os dois NÃO se substituem.
 *   Corpo: 64 KiB — o mesmo orçamento que a F16.3 fixa por resposta, para o
 *   pedido não nascer maior do que o contrato de leitura.
 *   Prazo: 8s de relógio. Stub e leitura curta cabem; ferramenta pendurada
 *   devolve recusa clara em vez de queimar o isolado até o teto da plataforma.
 *
 * Retry-After e o corpo (`rate_limited`) usam a mesma espera em segundos:
 * o tempo até o evento mais antigo da janela sair dela.
 */

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** 64 KiB. Casa com o teto de resposta da F16.3. */
export const INTEGRATION_MAX_BODY_BYTES = 64 * 1024;

/** Prazo de relógio de uma operação de integração, em milissegundos. */
export const INTEGRATION_DEADLINE_MS = 8_000;

export type IntegrationRateScope = 'grant' | 'owner';

export type IntegrationRateRule = { max: number; windowMs: number };

export const INTEGRATION_RATE_LIMITS: Record<IntegrationRateScope, IntegrationRateRule> = {
  grant: { max: 60, windowMs: 60_000 },
  owner: { max: 180, windowMs: 60_000 },
};

/** Uma pergunta do freio: quantos eventos deste escopo/chave desde este instante. */
export type IntegrationRateProbe = {
  scope: IntegrationRateScope;
  key: string;
  since: Date;
};

export type IntegrationRateLimitStore = {
  count(scope: IntegrationRateScope, key: string, since: Date): Promise<number>;
  record(scope: IntegrationRateScope, key: string): Promise<void>;
  oldest(scope: IntegrationRateScope, key: string, since: Date): Promise<Date | null>;
  /**
   * OS DOIS TETOS NUMA IDA SÓ — F22, Fase 2.
   *
   * Contar por concessão e por dono eram duas viagens ao banco, e registrar
   * eram outras duas: quatro idas para uma decisão que o Postgres responde num
   * `select`. O par opcional existe para o store que consegue fazer isso; quem
   * não implementar continua no caminho antigo, um por vez.
   *
   * A ORDEM DA RESPOSTA É CONTRATO: a posição N é a resposta da sonda N.
   * Devolver fora de ordem trocaria o teto da concessão pelo do dono.
   */
  countMany?(probes: readonly IntegrationRateProbe[]): Promise<readonly number[]>;
  recordMany?(entries: readonly { scope: IntegrationRateScope; key: string }[]): Promise<void>;
  /**
   * CONTAR E, SE COUBER, REGISTRAR — NUMA TRANSAÇÃO SÓ (perf do servidor, 08/10/2026).
   *
   * A decisão do freio era `countMany` numa transação e, se coubesse, `recordMany`
   * em outra: duas vezes begin + declaração + commit em TODA chamada de agente.
   * O store que sabe fazer as duas na mesma transação implementa este par.
   *
   * O CONTRATO É O MESMO DO CAMINHO ANTIGO, e é ele que se prova na suíte:
   *   · devolve as contagens na ORDEM das sondas;
   *   · registra as `entries` SE E SOMENTE SE toda contagem for menor que o seu
   *     `maxima` (a posição N do teto é a da sonda N). Estourou: não registra
   *     nada — a chamada recusada nunca entra na janela, como sempre;
   *   · `recorded` diz se registrou.
   * Quem decide que a chamada passa continua sendo `admitIntegrationRateLimit`,
   * olhando as contagens.
   */
  countThenRecord?(
    probes: readonly IntegrationRateProbe[],
    entries: readonly { scope: IntegrationRateScope; key: string }[],
    maxima: readonly number[],
  ): Promise<{ counts: readonly number[]; recorded: boolean }>;
};

export type IntegrationRateVerdict =
  | { allowed: true }
  | { allowed: false; blockedBy: IntegrationRateScope; retryAfterSeconds: number };

/** F21.2 acrescentou o desfazer: sem banco, ele recusa em vez de fingir zero. */
export type IntegrationUnavailableCode =
  | 'grant_store_unavailable'
  | 'rate_limit_unavailable'
  | 'undo_store_unavailable';

export class IntegrationUnavailableError extends Error {
  readonly code: IntegrationUnavailableCode;

  constructor(code: IntegrationUnavailableCode, cause?: unknown) {
    super(code);
    this.name = 'IntegrationUnavailableError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class DeadlineExceededError extends Error {
  constructor() {
    super('deadline_exceeded');
    this.name = 'DeadlineExceededError';
  }
}

/**
 * Store em memória só para a suíte. Dois handlers que compartilham a MESMA
 * instância simulam duas instâncias do Worker falando com o mesmo banco.
 */
export class MemoryRateLimitStore implements IntegrationRateLimitStore {
  readonly events: Array<{ scope: IntegrationRateScope; key: string; at: number }> = [];

  async count(scope: IntegrationRateScope, key: string, since: Date): Promise<number> {
    const start = since.getTime();
    return this.events.filter((event) => event.scope === scope && event.key === key && event.at >= start)
      .length;
  }

  async record(scope: IntegrationRateScope, key: string, at: number = Date.now()): Promise<void> {
    this.events.push({ scope, key, at });
  }

  async countMany(probes: readonly IntegrationRateProbe[]): Promise<readonly number[]> {
    const out: number[] = [];
    for (const probe of probes) out.push(await this.count(probe.scope, probe.key, probe.since));
    return out;
  }

  async recordMany(entries: readonly { scope: IntegrationRateScope; key: string }[]): Promise<void> {
    for (const entry of entries) await this.record(entry.scope, entry.key);
  }

  async countThenRecord(
    probes: readonly IntegrationRateProbe[],
    entries: readonly { scope: IntegrationRateScope; key: string }[],
    maxima: readonly number[],
  ): Promise<{ counts: readonly number[]; recorded: boolean }> {
    const counts = await this.countMany(probes);
    const cabe = counts.every((n, i) => n < (maxima[i] ?? 0));
    if (cabe) await this.recordMany(entries);
    return { counts, recorded: cabe };
  }

  async oldest(scope: IntegrationRateScope, key: string, since: Date): Promise<Date | null> {
    const start = since.getTime();
    let min = Number.POSITIVE_INFINITY;
    for (const event of this.events) {
      if (event.scope !== scope || event.key !== key || event.at < start) continue;
      if (event.at < min) min = event.at;
    }
    return Number.isFinite(min) ? new Date(min) : null;
  }
}

export function resolveRequestId(request: Request): string {
  const existing = request.headers.get(REQUEST_ID_HEADER)?.trim() ?? '';
  if (existing.length > 0 && existing.length <= 128 && !/[\r\n]/.test(existing)) return existing;
  return crypto.randomUUID();
}

export function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function oversizedBody(request: Request, maxBytes: number = INTEGRATION_MAX_BODY_BYTES): boolean {
  const header = request.headers.get('Content-Length');
  if (header === null || header === '') return false;
  const size = Number(header);
  if (!Number.isFinite(size)) return false;
  return size > maxBytes;
}

export async function withDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    return await Promise.race([
      work(abort.signal),
      new Promise<never>((_, reject) => {
        const fail = () => reject(new DeadlineExceededError());
        if (abort.signal.aborted) {
          fail();
          return;
        }
        abort.signal.addEventListener('abort', fail, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function sequentialCounts(
  store: IntegrationRateLimitStore,
  probes: readonly IntegrationRateProbe[],
): Promise<readonly number[]> {
  const out: number[] = [];
  for (const probe of probes) out.push(await store.count(probe.scope, probe.key, probe.since));
  return out;
}

function retryAfterSeconds(
  rule: IntegrationRateRule,
  oldest: Date | null,
  now: Date,
): number {
  if (!oldest) return Math.max(1, Math.ceil(rule.windowMs / 1000));
  const waitMs = oldest.getTime() + rule.windowMs - now.getTime();
  return Math.max(1, Math.ceil(waitMs / 1000));
}

export async function checkIntegrationRateLimit(
  who: { grantId: string; ownerId: string },
  store: IntegrationRateLimitStore,
  now: Date = new Date(),
  rules: Record<IntegrationRateScope, IntegrationRateRule> = INTEGRATION_RATE_LIMITS,
): Promise<IntegrationRateVerdict> {
  const probes: IntegrationRateProbe[] = (
    [
      ['grant', who.grantId],
      ['owner', who.ownerId],
    ] as Array<[IntegrationRateScope, string]>
  ).map(([scope, key]) => ({
    scope,
    key,
    since: new Date(now.getTime() - rules[scope].windowMs),
  }));
  try {
    /**
     * Uma ida quando o store sabe responder as duas de uma vez; duas quando
     * não sabe. A DECISÃO é idêntica nos dois caminhos: o primeiro escopo
     * estourado recusa, e a ordem (concessão antes de dono) não muda — é ela
     * que o `blockedBy` reporta.
     */
    const counts = store.countMany
      ? await store.countMany(probes)
      : await sequentialCounts(store, probes);
    for (let i = 0; i < probes.length; i += 1) {
      const probe = probes[i];
      const rule = rules[probe.scope];
      if ((counts[i] ?? 0) < rule.max) continue;
      // `oldest` só é perguntado quando já se vai recusar — o caminho feliz
      // continua sem essa ida.
      const oldest = await store.oldest(probe.scope, probe.key, probe.since);
      return {
        allowed: false,
        blockedBy: probe.scope,
        retryAfterSeconds: retryAfterSeconds(rule, oldest, now),
      };
    }
    return { allowed: true };
  } catch (error) {
    if (error instanceof IntegrationUnavailableError) throw error;
    throw new IntegrationUnavailableError('rate_limit_unavailable', error);
  }
}

export async function recordIntegrationRateLimit(
  who: { grantId: string; ownerId: string },
  store: IntegrationRateLimitStore,
): Promise<void> {
  const entries = [
    { scope: 'grant' as const, key: who.grantId },
    { scope: 'owner' as const, key: who.ownerId },
  ];
  try {
    if (store.recordMany) await store.recordMany(entries);
    else for (const entry of entries) await store.record(entry.scope, entry.key);
  } catch (error) {
    if (error instanceof IntegrationUnavailableError) throw error;
    throw new IntegrationUnavailableError('rate_limit_unavailable', error);
  }
}

/**
 * A decisão do freio INTEIRA — contar e, se couber, registrar — pela via mais
 * barata que o store conhece (perf do servidor, 08/10/2026).
 *
 * O resultado é o de `checkIntegrationRateLimit` seguido de
 * `recordIntegrationRateLimit` quando passou: o primeiro escopo estourado
 * recusa (concessão antes de dono), `oldest` só é perguntado ao recusar, e a
 * chamada recusada não é registrada. O que muda é só o número de transações:
 * com `countThenRecord` são uma; sem ele, as duas (ou três) de antes.
 */
export async function admitIntegrationRateLimit(
  who: { grantId: string; ownerId: string },
  store: IntegrationRateLimitStore,
  now: Date = new Date(),
  rules: Record<IntegrationRateScope, IntegrationRateRule> = INTEGRATION_RATE_LIMITS,
): Promise<IntegrationRateVerdict> {
  if (!store.countThenRecord) {
    const verdict = await checkIntegrationRateLimit(who, store, now, rules);
    if (verdict.allowed) await recordIntegrationRateLimit(who, store);
    return verdict;
  }
  const scopes: Array<[IntegrationRateScope, string]> = [
    ['grant', who.grantId],
    ['owner', who.ownerId],
  ];
  const probes: IntegrationRateProbe[] = scopes.map(([scope, key]) => ({
    scope,
    key,
    since: new Date(now.getTime() - rules[scope].windowMs),
  }));
  const entries = scopes.map(([scope, key]) => ({ scope, key }));
  try {
    const { counts } = await store.countThenRecord(
      probes,
      entries,
      probes.map((probe) => rules[probe.scope].max),
    );
    for (let i = 0; i < probes.length; i += 1) {
      const probe = probes[i];
      const rule = rules[probe.scope];
      if ((counts[i] ?? 0) < rule.max) continue;
      const oldest = await store.oldest(probe.scope, probe.key, probe.since);
      return {
        allowed: false,
        blockedBy: probe.scope,
        retryAfterSeconds: retryAfterSeconds(rule, oldest, now),
      };
    }
    return { allowed: true };
  } catch (error) {
    if (error instanceof IntegrationUnavailableError) throw error;
    throw new IntegrationUnavailableError('rate_limit_unavailable', error);
  }
}

export function rateLimitRetryMessage(retryAfterSeconds: number): string {
  return `Muitas chamadas desta integração. Espere ${retryAfterSeconds} segundo(s) e tente de novo.`;
}

/**
 * Remove token, cookie, senha, verificador e Authorization de um texto de log.
 * Apaga em vez de mascarar o tamanho: saber o comprimento já ajuda quem procura.
 */
export function sanitizeIntegrationLog(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(Cookie:\s*)[^\r\n]*/gi, '$1[redacted]')
    .replace(
      /(?:password|secret_verifier|secret|token)\s*[:=]\s*["']?[^"'&\s,;]+/gi,
      (match) => `${match.split(/[:=]/)[0]}:[redacted]`,
    );
}

export function logIntegration(message: string, details?: string): void {
  const raw = details ? `${message} ${details}` : message;
  console.info(`[ide-works:integration] ${sanitizeIntegrationLog(raw)}`);
}
