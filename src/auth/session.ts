/**
 * Sessão única e desativação de conta — etapa F1.5.
 *
 * UM DISPOSITIVO POR VEZ
 *   Entrar derruba a sessão anterior. Existe para coibir conta compartilhada —
 *   duas pessoas usando um login só. Quem foi derrubado recebe aviso de que a
 *   sessão foi **substituída**, e não um erro de sessão inválida: a diferença é
 *   entre entender o que houve e achar que o sistema quebrou.
 *
 * A ISENÇÃO, E POR QUE ELA É CONFERIDA CONTRA O BANCO
 *   No sistema de onde o modelo veio, essa regra derrubou o acesso programático:
 *   abrir o sistema no navegador **matava o conector**, porque a sessão dele era
 *   tratada como mais um dispositivo.
 *
 *   A correção não é confiar em quem se declara isento. Um programa dizer "sou o
 *   conector" não vale nada — qualquer chamada pode dizer isso. A isenção é
 *   conferida contra o banco: o acesso precisa estar registrado como uma
 *   autorização viva.
 *
 * DESATIVAR ENCERRA AS SESSÕES
 *   Cortar o acesso sem encerrar sessão deixa a pessoa trabalhando até o crachá
 *   dela vencer sozinho. "Desativado" precisa valer agora, não daqui a uma hora.
 */

export type SessionKind = 'browser' | 'programmatic';

export type ActiveSession = {
  id: string;
  userId: string;
  kind: SessionKind;
  /** Identifica o acesso programático. Ausente em sessão de navegador. */
  clientId?: string;
};

export type SessionRequest = {
  userId: string;
  kind: SessionKind;
  clientId?: string;
};

export type SessionPorts = {
  listActiveSessions(userId: string): Promise<ActiveSession[]>;
  /** A autorização existe **e está viva** no banco? Declaração não basta. */
  isProgrammaticAccessLive(clientId: string): Promise<boolean>;
};

export type SessionDecision =
  | { ok: true; revoke: string[] }
  | { ok: false; reason: 'unauthorized_programmatic_access'; message: string };

export const SESSION_REPLACED_MESSAGE =
  'Sua sessão foi substituída por um acesso em outro dispositivo. Entre novamente.';

/**
 * Decide quais sessões devem cair quando esta entra.
 *
 * Regras:
 *   - sessão de navegador derruba as outras **de navegador**;
 *   - sessão de navegador **não** encosta em acesso programático;
 *   - acesso programático substitui apenas o anterior do mesmo cliente, e não
 *     derruba ninguém no navegador;
 *   - quem alega ser programático sem autorização viva é recusado — não vira
 *     sessão de navegador por engano.
 */
export async function decideSessionReplacement(
  request: SessionRequest,
  ports: SessionPorts,
): Promise<SessionDecision> {
  if (request.kind === 'programmatic') {
    const authorized =
      request.clientId !== undefined &&
      request.clientId !== '' &&
      (await ports.isProgrammaticAccessLive(request.clientId));

    if (!authorized) {
      return {
        ok: false,
        reason: 'unauthorized_programmatic_access',
        message: 'Acesso programático não autorizado.',
      };
    }
  }

  const active = await ports.listActiveSessions(request.userId);

  const revoke =
    request.kind === 'browser'
      ? active.filter((s) => s.kind === 'browser')
      : active.filter((s) => s.kind === 'programmatic' && s.clientId === request.clientId);

  return { ok: true, revoke: revoke.map((s) => s.id) };
}

// -----------------------------------------------------------------------------

export type AccountStatusChange = {
  targetUserId: string;
  actorUserId: string;
  /** true = desativar, false = reativar. */
  disable: boolean;
};

export type AccountStatusDecision =
  | { ok: true; revokeAllSessions: boolean }
  | { ok: false; reason: 'cannot_disable_self' | 'cannot_disable_superadmin'; message: string };

export type AccountStatusPorts = {
  isSuperadmin(userId: string): Promise<boolean>;
};

/**
 * Decide se a mudança de estado da conta procede.
 *
 * Duas recusas, ambas do documento de acesso:
 *   - ninguém se desativa: trancar-se do lado de fora é acidente comum, e o
 *     sistema não deveria ajudar;
 *   - administrador de topo não desativa outro de topo. Recuperar a senha de um
 *     par, sim; eliminá-lo, não. Poder de administrar não é poder de eliminar
 *     quem administra junto.
 */
export async function decideAccountStatusChange(
  change: AccountStatusChange,
  ports: AccountStatusPorts,
): Promise<AccountStatusDecision> {
  if (change.disable && change.targetUserId === change.actorUserId) {
    return {
      ok: false,
      reason: 'cannot_disable_self',
      message: 'Você não pode desativar a própria conta.',
    };
  }

  if (change.disable && (await ports.isSuperadmin(change.targetUserId))) {
    return {
      ok: false,
      reason: 'cannot_disable_superadmin',
      message:
        'Não é possível desativar outro administrador de topo. ' +
        'Redefinir a senha dele é permitido; eliminá-lo, não.',
    };
  }

  // Desativar encerra tudo na hora. Reativar não devolve sessão nenhuma: a
  // pessoa entra de novo, normalmente.
  return { ok: true, revokeAllSessions: change.disable };
}
