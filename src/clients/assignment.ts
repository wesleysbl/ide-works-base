/**
 * Quem enxerga quais clientes — etapa F2.2.
 *
 * O ERRO MAIS CARO DESTE MÓDULO É O VAZAMENTO
 *   Um vínculo errado mostra a carteira de um colega. Não quebra nada, não gera
 *   erro, não aparece em log — a pessoa simplesmente vê o que não devia, e
 *   ninguém descobre. É a assinatura de todas as dívidas do legado: erra sem
 *   avisar.
 *
 *   Por isso a regra de leitura mora no banco (`can_see_client`, F2.1), e este
 *   módulo cuida só de **quem pode mexer nos vínculos**.
 *
 * DUAS FORMAS DE ENXERGAR, E ELAS NÃO SE SUBSTITUEM
 *   - acesso amplo: vê todos os clientes, sem vínculo nenhum;
 *   - vínculo: vê exatamente os clientes atribuídos.
 *
 *   Dar acesso amplo **não apaga** os vínculos. Se um dia ele for retirado, a
 *   pessoa volta a enxergar a carteira que já tinha — em vez de ficar sem nada e
 *   precisar de alguém para reconstruir a lista de memória.
 */

export type Actor = { userId: string; isSuperadmin: boolean };

export type AssignmentTarget = {
  userId: string;
  hasProfile: boolean;
  hasAllClientsAccess: boolean;
};

export type AssignmentRefusal =
  | 'not_superadmin'
  | 'target_has_no_profile'
  | 'client_not_found';

export type AssignmentDecision =
  | {
      ok: true;
      /** Verdadeiro quando o vínculo não muda nada na prática, mas é gravado. */
      redundant: boolean;
      note?: string;
    }
  | { ok: false; reason: AssignmentRefusal; message: string };

export type AssignmentPorts = {
  findTarget(userId: string): Promise<AssignmentTarget | null>;
  clientExists(clientId: string): Promise<boolean>;
};

function refuse(reason: AssignmentRefusal, message: string): AssignmentDecision {
  return { ok: false, reason, message };
}

/**
 * Decide se um vínculo pessoa ↔ cliente pode ser criado.
 *
 * Não grava: quem chama é que persiste. A separação é a mesma da F1.3 — decisão
 * pura, execução na borda.
 */
export async function decideAssignClient(
  actor: Actor,
  targetUserId: string,
  clientId: string,
  ports: AssignmentPorts,
): Promise<AssignmentDecision> {
  if (!actor.isSuperadmin) {
    return refuse(
      'not_superadmin',
      'Só um administrador pode definir quem enxerga quais clientes.',
    );
  }

  const target = await ports.findTarget(targetUserId);
  if (!target?.hasProfile) {
    // Vincular alguém que não tem conta no IDE Works cria um vínculo órfão: ele
    // não dá acesso a nada e some do radar. Recusar é mais honesto.
    return refuse(
      'target_has_no_profile',
      'Essa pessoa não tem conta no IDE Works. Crie o acesso antes de atribuir clientes.',
    );
  }

  if (!(await ports.clientExists(clientId))) {
    return refuse('client_not_found', 'Cliente não encontrado.');
  }

  if (target.hasAllClientsAccess) {
    // Não é erro: o vínculo é gravado assim mesmo, para sobreviver ao dia em que
    // o acesso amplo for retirado. Mas quem está na tela precisa saber que hoje
    // ele não muda nada — senão vai achar que o sistema ignorou a ação.
    return {
      ok: true,
      redundant: true,
      note:
        'Esta pessoa já enxerga todos os clientes, então o vínculo não muda nada agora. ' +
        'Ele fica guardado para o caso de o acesso amplo ser retirado.',
    };
  }

  return { ok: true, redundant: false };
}

export type AccessScopeChange = {
  targetUserId: string;
  grantAll: boolean;
};

export type AccessScopeDecision =
  | { ok: true; keepAssignments: true; note?: string }
  | { ok: false; reason: AssignmentRefusal | 'cannot_narrow_self'; message: string };

/**
 * Decide a mudança de acesso amplo.
 *
 * `keepAssignments` é sempre verdadeiro, e é tipo literal de propósito: apagar
 * os vínculos ao dar acesso amplo deixaria a pessoa sem nada no dia em que ele
 * fosse retirado, e a lista teria de ser reconstruída de memória.
 */
export async function decideAccessScope(
  actor: Actor,
  change: AccessScopeChange,
  ports: AssignmentPorts,
): Promise<AccessScopeDecision> {
  if (!actor.isSuperadmin) {
    return {
      ok: false,
      reason: 'not_superadmin',
      message: 'Só um administrador pode mudar o alcance de acesso.',
    };
  }

  if (!change.grantAll && change.targetUserId === actor.userId) {
    // Tirar o próprio acesso amplo é trancar-se do lado de fora. Acontece, e o
    // sistema não deveria ajudar.
    return {
      ok: false,
      reason: 'cannot_narrow_self',
      message: 'Você não pode retirar o próprio acesso amplo. Peça a outro administrador.',
    };
  }

  const target = await ports.findTarget(change.targetUserId);
  if (!target?.hasProfile) {
    return {
      ok: false,
      reason: 'target_has_no_profile',
      message: 'Essa pessoa não tem conta no IDE Works.',
    };
  }

  return {
    ok: true,
    keepAssignments: true,
    note: change.grantAll
      ? 'Os vínculos individuais continuam guardados, para o caso de o acesso amplo ser retirado.'
      : 'A pessoa volta a enxergar apenas os clientes que lhe foram atribuídos.',
  };
}
