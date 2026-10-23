/**
 * Redefinição de senha — etapa F1.6, desatada na F17.31.
 *
 * ⚠️ O DESENHO DE 2026-08-19 PERDEU O CHÃO, E ESTÁ ESCRITO AQUI PORQUE VOLTAR
 * A ELE SERIA UM DEFEITO
 *   A F1.6 dizia: "redefinir **é ativar a conta de novo** — gera-se um convite
 *   novo, e a pessoa define a senha por onde já definiria no primeiro acesso".
 *   Um mecanismo só, menos coisa para dar errado.
 *
 *   Isso funcionava enquanto ativar significava CRIAR conta com a senha
 *   digitada. A F17.30 mudou o significado: ativar passou a VINCULAR a conta
 *   que já existe, **sem tocar na senha dela** — porque a autenticação é a
 *   mesma do Sistema IDE em produção, e mexer na senha de quem já tem conta
 *   tira o acesso de uma pessoa real.
 *
 *   Com isso, "redefinir é ativar de novo" deixou de redefinir coisa nenhuma.
 *   Medido: `gestao@exemplo.com.br` ativou, escolheu uma senha que foi
 *   descartada por desenho, e não consegue entrar.
 *
 * O QUE PASSOU A VALER — E POR QUE NÃO SÃO DOIS NOMES PARA A MESMA COISA
 *   O código de redefinição é **outra coisa, declarada**: a intenção fica
 *   gravada na linha (`purpose`), e só a intenção `reset` autoriza escrever
 *   senha. Código de convite continua incapaz de trocar senha — não por
 *   cuidado de quem chama, mas por não ter essa permissão:
 *
 *     · `ideworks.find_reset_account` é a única porta que devolve o
 *       identificador da conta para o caminho da senha, e ela só responde
 *       sobre linha `reset`. Sem identificador não há chamada ao provedor;
 *     · `ideworks.aplicar_convite` — que dá acesso, papel, empresa e áreas —
 *       recusa linha `reset`. Senão, um código de senha usado na tela de
 *       ativação reescreveria o acesso da pessoa com o padrão da linha.
 *
 *   As duas guardas moram no banco. `decideResetRedeem`, aqui embaixo, confere
 *   a intenção de novo — e isso não é a mesma verdade escrita duas vezes: a do
 *   banco é a que tem poder, e esta é a que pode ser provada sem tocar em
 *   autenticação compartilhada com produção.
 *
 * QUEM DEFINE A SENHA É O DONO DA CONTA
 *   Quem administra gera o CÓDIGO; quem tem a conta escolhe a senha. O
 *   administrador nunca vê nem define a senha de ninguém — é a frase impressa
 *   no próprio convite, e um administrador digitando a senha da pessoa a
 *   desmentiria.
 *
 * NADA DE LINK POR E-MAIL
 *   O código é entregue pela mesma via do convite, à mão. Decisão da F1.6, e
 *   ela continua de pé: um caminho de recuperação a mais é um caminho de
 *   invasão a mais, e um a mais para manter correto.
 *
 * O RISCO QUE ISTO CRIA, E QUE FICA REGISTRADO
 *   Quem gera o código **pode assumir a conta**: basta usá-lo em vez de
 *   entregá-lo. Isso é inerente a administrar — quem administra, administra. O
 *   que se faz a respeito é deixar rastro: toda redefinição grava quem pediu,
 *   para quem e quando, na mesma transação que cria o código.
 *
 * RECUPERAÇÃO ENTRE PARES
 *   Um administrador de topo pode redefinir a senha de outro, para o caso de
 *   alguém se trancar do lado de fora. Mas não pode desativá-lo nem excluí-lo
 *   (ver `session.ts`). Recuperar sim, eliminar não.
 */

import { MAX_FAILED_ATTEMPTS, verifyCode } from '@/auth/activation-code';
import { GENERIC_REFUSAL, normalizeEmail } from '@/auth/activation';

/**
 * Para que serve um código. Mora em `activation.ts` desde a F17.39, porque as
 * duas portas passaram a conferi-lo, e é re-exportado aqui para quem já o
 * importava daqui.
 */
export type { InvitationPurpose } from '@/auth/activation';
import type { InvitationPurpose } from '@/auth/activation';

/** A ação gravada no livro. O mesmo texto está na migration da F17.31. */
export const RESET_AUDIT_ACTION = 'account_password_reset';

export type ResetRequest = {
  targetUserId: string;
  targetEmail: string;
  actorUserId: string;
  actorEmail: string;
};

export type ResetDecision =
  | {
      ok: true;
      /** Convites pendentes anteriores que devem ser invalidados. */
      invalidateInvitationIds: string[];
      /** A redefinição é uma decisão administrativa: sempre auditada. */
      audit: {
        action: typeof RESET_AUDIT_ACTION;
        actorId: string;
        actorEmail: string;
        targetId: string;
        targetEmail: string;
      };
    }
  | { ok: false; reason: 'no_such_profile' | 'self_service_not_allowed'; message: string };

export type ResetPorts = {
  findProfile(userId: string): Promise<{ userId: string; email: string } | null>;
  listPendingInvitations(email: string): Promise<Array<{ id: string }>>;
};

/**
 * Decide se a redefinição procede e o que ela invalida.
 *
 * Não gera o código nem grava nada: quem chama usa `generateCode` e persiste. A
 * separação existe para esta decisão ser verificável sem tocar em autenticação —
 * que, neste projeto, é compartilhada com o Sistema IDE em produção.
 */
export async function decidePasswordReset(
  request: ResetRequest,
  ports: ResetPorts,
): Promise<ResetDecision> {
  if (request.actorUserId === request.targetUserId) {
    return {
      ok: false,
      reason: 'self_service_not_allowed',
      message:
        'A recuperação é feita por outra pessoa, não por você mesmo. ' +
        'Peça a um administrador.',
    };
  }

  const profile = await ports.findProfile(request.targetUserId);
  if (!profile) {
    return {
      ok: false,
      reason: 'no_such_profile',
      message: 'Não há conta do IDE Works para esta pessoa.',
    };
  }

  // Códigos anteriores morrem. Deixar dois válidos ao mesmo tempo dobraria a
  // janela de quem tivesse interceptado o primeiro — e ninguém saberia qual dos
  // dois foi usado.
  const pending = await ports.listPendingInvitations(profile.email);

  return {
    ok: true,
    invalidateInvitationIds: pending.map((i) => i.id),
    audit: {
      action: RESET_AUDIT_ACTION,
      actorId: request.actorUserId,
      actorEmail: request.actorEmail,
      targetId: profile.userId,
      // E-mail em texto, e não referência: quando a conta for excluída, a
      // referência apontaria para o nada, e o livro precisa continuar legível
      // depois de o mundo ao redor ter mudado.
      targetEmail: profile.email,
    },
  };
}

/* ─────────────────────── o outro lado: gastar o código ────────────────────── */

export type ResetRedeemRequest = {
  email: string;
  code: string;
  password: string;
};

export type PendingReset = {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  /** Vem do banco. Conferida aqui de novo — ver o cabeçalho. */
  purpose: InvitationPurpose;
};

/**
 * Motivo interno da recusa. Vai para o registro, **nunca** para quem chamou.
 *
 * `wrong_purpose` existe separado de `no_invitation` porque os dois são
 * defeitos diferentes de quem escreveu o código de cima: um é "não há código",
 * o outro é "alguém entregou um código de convite a esta porta". A pessoa do
 * outro lado vê a mesma frase nos dois casos.
 */
export type ResetRefusalReason =
  | 'rate_limited'
  | 'no_invitation'
  | 'wrong_purpose'
  | 'invitation_locked'
  | 'invitation_expired'
  | 'wrong_code';

export type ResetRedeemOutcome =
  | { ok: true; invitationId: string; email: string }
  | {
      ok: false;
      /** O que se mostra na tela. Sempre a mesma frase. */
      message: string;
      reason: ResetRefusalReason;
      /** Verdadeiro quando o erro deve incrementar o contador do código. */
      countsAgainstInvitation: boolean;
    };

export type ResetRedeemPorts = {
  /** Já estourou o teto por e-mail ou por origem? */
  isRateLimited(email: string): Promise<boolean>;
  /**
   * Registra a tentativa — F17.53, achado A3 da auditoria de 2026-09-01.
   *
   * ⚠️ O TETO É O MESMO DA ATIVAÇÃO, E POR ISSO O REGISTRO TAMBÉM É.
   * `resetRedeemPorts` já contava sob a intenção `activation`; o que faltava
   * era alguém ESCREVER a linha. Gastar tentativa aqui tem de encurtar o teto
   * de lá, senão são duas portas que recebem código digitado e o dobro de
   * chutes por endereço para quem estiver tentando — que é a nota escrita no
   * cabeçalho de `resetRedeemPorts`.
   *
   * Falhar aqui NUNCA impede a redefinição: o registro é o extra.
   */
  recordAttempt(email: string): Promise<void>;
  /** O código de redefinição pendente deste endereço, se houver. */
  findPendingReset(email: string): Promise<PendingReset | null>;
};

function recusar(
  reason: ResetRefusalReason,
  countsAgainstInvitation = false,
): ResetRedeemOutcome {
  // A MESMA FRASE DA ATIVAÇÃO, e importada de lá em vez de copiada. Se ela
  // variasse entre as duas portas, a diferença já diria de qual delas o
  // endereço tem código pendente — que é a enumeração de usuários descrita em
  // `activation.ts`.
  return { ok: false, message: GENERIC_REFUSAL, reason, countsAgainstInvitation };
}

/**
 * Decide se este código autoriza escrever a senha deste endereço.
 *
 * A ordem é a mesma da ativação, e pelo mesmo motivo: teto, existência,
 * intenção, travamento, prazo e só então o código. Nada disso muda a resposta
 * que a pessoa vê — muda apenas o que fica registrado e se o contador do código
 * avança.
 *
 * ⚠️ NÃO É AQUI QUE A SENHA É ESCRITA, e nem poderia ser: este módulo não
 * conhece banco nem provedor. Ele diz "pode", e quem chama vai buscar o
 * identificador da conta na única porta que o devolve.
 */
export async function decideResetRedeem(
  request: ResetRedeemRequest,
  ports: ResetRedeemPorts,
  now: Date = new Date(),
): Promise<ResetRedeemOutcome> {
  const email = normalizeEmail(request.email);

  if (await ports.isRateLimited(email)) return recusar('rate_limited');

  // Registrada antes de saber o resultado, e depois do teto — a mesma ordem da
  // ativação, e pelo mesmo motivo. Ver o comentário da porta.
  await ports.recordAttempt(email);

  const pendente = await ports.findPendingReset(email);
  if (!pendente) return recusar('no_invitation');

  // ⚠️ A INVARIANTE DA F17.31: código de convite não troca senha.
  //
  // Esta linha vem ANTES da conferência do código, e é de propósito: um código
  // de convite correto não pode chegar nem perto de valer aqui. A porta do
  // banco recusaria de todo jeito; esta é a mesma recusa onde ela pode ser
  // provada sem banco nenhum.
  if (pendente.purpose !== 'reset') return recusar('wrong_purpose');

  if (pendente.failedAttempts >= MAX_FAILED_ATTEMPTS) return recusar('invitation_locked');
  if (pendente.expiresAt.getTime() <= now.getTime()) return recusar('invitation_expired');

  // Só aqui o contador avança: os casos acima não dizem nada sobre quem
  // digitou, e puni-los deixaria um código legítimo travável por terceiro.
  if (!(await verifyCode(request.code, pendente.codeHash))) {
    return recusar('wrong_code', true);
  }

  return { ok: true, invitationId: pendente.id, email };
}
