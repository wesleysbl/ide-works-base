/**
 * Login — etapa F1.4, executando a decisão D6.
 *
 * O QUE MUDA EM RELAÇÃO AO MODELO DE ORIGEM
 *   No sistema de onde o modelo de acesso veio, o login da tela vai **direto do
 *   navegador ao provedor de autenticação**, sem passar pelo servidor — logo,
 *   sem passar pelo limitador. O próprio documento assume isso como lacuna.
 *
 *   Aqui não. O navegador fala com a nossa borda, e é ela que fala com o
 *   provedor. Foi decidido fechar isso agora (D6) porque é decisão de
 *   arquitetura: barata neste momento, cara de retrofitar com gente usando.
 *
 * A CONFERÊNCIA QUE SÓ EXISTE POR CAUSA DO BANCO COMPARTILHADO
 *   O IDE Works divide o projeto de banco com o Sistema IDE em produção
 *   (decisão D8), e a autenticação é **a mesma**. Ou seja: os 21 usuários do
 *   sistema legado têm credencial válida aqui.
 *
 *   Senha correta, portanto, NÃO é suficiente. Só entra quem tem perfil no
 *   schema do IDE Works. Sem essa conferência, todo o modelo de convite fechado
 *   seria contornável por qualquer conta do legado.
 *
 * ORDEM DAS MENSAGENS
 *   Senha errada devolve a frase genérica. Conta desativada tem motivo próprio —
 *   e isso não vaza nada, porque essa conferência só acontece **depois** de a
 *   senha ter batido. Quem chega ali já provou ser dono da conta.
 */

import {
  type AttemptIdentity,
  type RateLimitPorts,
  checkRateLimit,
  recordAttempt,
} from '@/auth/rate-limit';

export const GENERIC_LOGIN_REFUSAL = 'e-mail ou senha inválidos';
export const DISABLED_ACCOUNT_MESSAGE =
  'Esta conta está desativada. Procure um administrador.';
export const NO_ACCESS_MESSAGE = GENERIC_LOGIN_REFUSAL;

export type LoginRequest = { email: string; password: string; ip: string };

export type LoginRefusal =
  | 'rate_limited'
  | 'bad_credentials'
  | 'no_ideworks_profile'
  | 'account_disabled';

export type LoginOutcome =
  | { ok: true; userId: string; sessionReplaced: boolean }
  | { ok: false; message: string; reason: LoginRefusal };

export type IdeWorksProfile = { userId: string; isActive: boolean };

export type LoginPorts = RateLimitPorts & {
  /** Quem valida a senha é o provedor. Este código nunca vê senha. */
  verifyPassword(
    email: string,
    password: string,
  ): Promise<{ ok: true; userId: string } | { ok: false }>;
  /** Perfil no schema do IDE Works. Ausente = conta é só do legado. */
  findIdeWorksProfile(userId: string): Promise<IdeWorksProfile | null>;
  /** Derruba a sessão anterior. Devolve true se havia uma. */
  replacePreviousSession(userId: string): Promise<boolean>;
};

function refuse(reason: LoginRefusal, message = GENERIC_LOGIN_REFUSAL): LoginOutcome {
  return { ok: false, message, reason };
}

export async function attemptLogin(
  request: LoginRequest,
  ports: LoginPorts,
  now: Date = new Date(),
): Promise<LoginOutcome> {
  const who: AttemptIdentity = { email: request.email.trim().toLowerCase(), ip: request.ip };

  // 1. os dois tetos. Barrado responde a frase genérica, porque "muitas
  //    tentativas para este e-mail" confirmaria que ele existe.
  const verdict = await checkRateLimit('login', who, ports, now);
  if (!verdict.allowed) return refuse('rate_limited');

  // 2. a senha, conferida pelo provedor. Registramos a tentativa ANTES de saber
  //    o resultado: contar só as que falham deixaria um ataque de força bruta
  //    bem-sucedido sem rastro nenhum.
  await recordAttempt('login', who, ports);

  const credentials = await ports.verifyPassword(who.email, request.password);
  if (!credentials.ok) return refuse('bad_credentials');

  // 3. tem perfil no IDE Works? Ver a nota sobre o banco compartilhado acima.
  //    A frase é a mesma de senha errada, de propósito: dizer "você existe no
  //    outro sistema" entregaria quem é usuário do legado.
  const profile = await ports.findIdeWorksProfile(credentials.userId);
  if (!profile) return refuse('no_ideworks_profile', NO_ACCESS_MESSAGE);

  // 4. conta desativada. Motivo próprio, e só aqui — quem chegou já provou ser
  //    dono da conta, então nada vaza.
  if (!profile.isActive) return refuse('account_disabled', DISABLED_ACCOUNT_MESSAGE);

  // 5. um dispositivo por vez.
  const sessionReplaced = await ports.replacePreviousSession(credentials.userId);

  return { ok: true, userId: credentials.userId, sessionReplaced };
}
