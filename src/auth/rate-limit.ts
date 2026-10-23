/**
 * Limitador de tentativas — etapa F1.4.
 *
 * POR QUE ELE MORA NO BANCO
 *   A versão anterior deste mecanismo, no sistema de onde o modelo veio, contava
 *   na memória do servidor. Como o servidor roda em várias instâncias, cada uma
 *   tinha o seu próprio contador, e quem espaçasse as tentativas nunca
 *   reencontrava o mesmo. Era a **aparência** de uma trava.
 *
 *   Aqui a contagem é uma consulta só, no banco, sobre uma janela deslizante.
 *   Não dá para furar mandando tudo ao mesmo tempo.
 *
 * POR QUE DOIS TETOS QUE NÃO SE SUBSTITUEM
 *   O teto por origem contém quem ataca de um lugar só. O teto por conta contém
 *   quem tem muitos endereços — rede de máquinas, proxy. Cinco erros em quinze
 *   minutos na mesma conta não é distração: é alguém tentando.
 *
 * POR QUE ELE FALHA ABERTO
 *   Se o banco estiver indisponível, a tentativa **passa** e a falha é gritada
 *   no registro. Escolha consciente: com o banco fora, o login não funciona de
 *   qualquer jeito, e travar tudo impediria justamente quem precisa entrar para
 *   consertar. O contrário — falhar fechado — transformaria uma indisponibilidade
 *   de banco em porta trancada sem chaveiro.
 */

export type LimitPurpose = 'activation' | 'login';
export type LimitScope = 'email' | 'ip';

export type LimitRule = { max: number; windowMinutes: number };

/** Os tetos do documento de acesso. Mudar aqui muda o comportamento inteiro. */
export const LIMITS: Record<LimitPurpose, Record<LimitScope, LimitRule>> = {
  activation: {
    email: { max: 10, windowMinutes: 15 },
    ip: { max: 20, windowMinutes: 15 },
  },
  login: {
    // Cinco na mesma conta em quinze minutos não é distração.
    email: { max: 5, windowMinutes: 15 },
    ip: { max: 10, windowMinutes: 15 },
  },
};

export type RateLimitPorts = {
  /** Quantas tentativas houve nesta janela. Uma consulta, no banco. */
  countAttempts(
    purpose: LimitPurpose,
    scope: LimitScope,
    key: string,
    since: Date,
  ): Promise<number>;
  /** Registra a tentativa. Falhar aqui nunca impede a ação. */
  recordAttempt(purpose: LimitPurpose, scope: LimitScope, key: string): Promise<void>;
  /** Grita a falha. Silêncio aqui transformaria a trava em teatro. */
  reportFailure(context: string, error: unknown): void;
};

export type RateLimitVerdict = {
  allowed: boolean;
  /** Qual teto barrou. Só para registro — nunca para a tela. */
  blockedBy?: LimitScope;
  /** Verdadeiro quando passou por indisponibilidade, não por estar dentro do teto. */
  failedOpen: boolean;
};

export type AttemptIdentity = { email: string; ip: string };

/**
 * Confere os dois tetos. Um `allowed: false` significa "barrado"; quem chama
 * deve devolver a mesma frase genérica das outras recusas, porque um "muitas
 * tentativas para este e-mail" confirmaria que ele existe.
 */
export async function checkRateLimit(
  purpose: LimitPurpose,
  who: AttemptIdentity,
  ports: RateLimitPorts,
  now: Date = new Date(),
): Promise<RateLimitVerdict> {
  const scopes: Array<[LimitScope, string]> = [
    ['email', who.email],
    ['ip', who.ip],
  ];

  for (const [scope, key] of scopes) {
    const rule = LIMITS[purpose][scope];
    const since = new Date(now.getTime() - rule.windowMinutes * 60_000);

    let count: number;
    try {
      count = await ports.countAttempts(purpose, scope, key, since);
    } catch (error) {
      ports.reportFailure(`limitador indisponível (${purpose}/${scope})`, error);
      return { allowed: true, failedOpen: true };
    }

    if (count >= rule.max) return { allowed: false, blockedBy: scope, failedOpen: false };
  }

  return { allowed: true, failedOpen: false };
}

/**
 * Registra a tentativa. Falha aqui **não** derruba a operação em curso: o
 * registro é o extra, a ação é o que a pessoa pediu. Mas a falha é gritada.
 */
export async function recordAttempt(
  purpose: LimitPurpose,
  who: AttemptIdentity,
  ports: RateLimitPorts,
): Promise<void> {
  for (const [scope, key] of [
    ['email', who.email],
    ['ip', who.ip],
  ] as Array<[LimitScope, string]>) {
    try {
      await ports.recordAttempt(purpose, scope, key);
    } catch (error) {
      ports.reportFailure(`registro de tentativa falhou (${purpose}/${scope})`, error);
    }
  }
}
