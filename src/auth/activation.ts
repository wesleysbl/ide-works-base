/**
 * Ativação de conta — etapa F1.3.
 *
 * Comportamento definido em `COMO-FUNCIONA-O-ACESSO.md`. A pessoa informa
 * e-mail, código e a senha que quer usar. O sistema confere nesta ordem:
 *
 *   1. a pessoa não estourou o teto de tentativas
 *   2. existe convite pendente para esse e-mail
 *   3. esse convite não passou do teto de erros
 *   4. o convite não expirou
 *   5. o código bate com a impressão digital guardada
 *   6. há conta de login para esse e-mail — criada agora com a senha escolhida,
 *      ou a que a pessoa JÁ TINHA, que é vinculada
 *
 * A SENHA DIGITADA VALE, OU NÃO VALE, E QUEM DIZ É A INTENÇÃO DO CÓDIGO — F17.39
 *   Das 30 pessoas do sistema legado, as 30 têm conta de login. "A conta já
 *   existe" não é caso de borda: é o caminho de quase todo convite que falta.
 *
 *   Então o convite nasce com uma de duas intenções, decidida no banco na hora
 *   de convidar, e nunca aqui:
 *
 *     `invite`               — não havia conta. Ela nasce com a senha escolhida.
 *     `invite_with_password` — já havia conta. O convite aplica o acesso E está
 *                              autorizado a definir a senha escolhida.
 *
 *   `invite` sobre conta que já existe continua sendo o caminho da F17.30: a
 *   senha dela NÃO é tocada, e a digitada aqui é descartada. É o que acontece
 *   com convite criado antes desta etapa, e com quem criou conta entre o
 *   convite e a ativação.
 *
 *   ⚠️ ESTE MÓDULO NÃO ESCREVE SENHA, e nem poderia: ele não conhece banco nem
 *   provedor. Ele diz se a senha digitada vale (`definesPassword`), e quem
 *   chama vai buscar a autorização na única porta que a dá —
 *   `ideworks.find_invite_account`, que só responde sobre a intenção nova.
 *
 * O DETALHE QUE MAIS PROTEGE
 *   Nos casos 1 a 5 a resposta é **exatamente a mesma**. Se dissesse "e-mail não
 *   encontrado" numa hora e "código errado" noutra, qualquer pessoa descobriria
 *   quais e-mails têm conta só testando endereços e lendo a diferença. Chama-se
 *   enumeração de usuários, e a defesa é não deixar a resposta variar.
 *
 *   O caso 6 é diferente de propósito: a senha é assunto entre a pessoa e o
 *   provedor de autenticação, e recusá-la sem explicar deixaria alguém preso
 *   sem saber o porquê. Aí a mensagem é clara e o convite continua valendo.
 *
 *   E é por isso que "esta pessoa já tem conta?" só se pergunta NO CASO 6, e
 *   nunca antes — F17.30. Depois de o código bater, quem está do outro lado já
 *   provou que tinha direito à resposta; antes disso, qualquer um a teria só
 *   digitando endereços.
 *
 * POR QUE ESTE MÓDULO NÃO TOCA NO BANCO NEM NA AUTENTICAÇÃO
 *   Toda a decisão mora aqui, pura e testável. O que grava e o que cria conta
 *   fica atrás das portas declaradas abaixo.
 *
 *   Isso não é preferência de estilo. O IDE Works divide o projeto de banco com
 *   o Sistema IDE em produção, e a autenticação é COMPARTILHADA: criar usuário
 *   ali mexe nos 21 logins reais do legado. Separando assim, esta lógica inteira
 *   é verificada sem criar conta nenhuma.
 */

import { MAX_FAILED_ATTEMPTS, verifyCode } from '@/auth/activation-code';

/** A frase única. Nunca varie isto sem entender a seção acima. */
export const GENERIC_REFUSAL = 'e-mail ou código inválido, ou expirado';

/**
 * Para que serve um código. Espelha `ideworks.invitation_purpose`.
 *
 * O tipo é fechado de propósito: valor novo no banco quebra a compilação aqui,
 * em vez de cair num `else` que aceitaria o desconhecido.
 *
 *   `invite`               dá acesso; não toca senha de conta que já existe
 *   `invite_with_password` dá acesso E define a senha — F17.39
 *   `reset`                só a senha, sem acesso nenhum — F17.31
 */
export type InvitationPurpose = 'invite' | 'invite_with_password' | 'reset';

/**
 * Os dois códigos que a tela de ativação aceita gastar.
 *
 * `reset` fica de fora, e não por descuido: um código de senha aplicado como
 * convite apagaria a empresa e as áreas de quem só quis trocar a senha. A porta
 * do banco recusa de todo jeito (F17.31); esta lista é a mesma recusa onde ela
 * pode ser provada sem banco nenhum.
 */
export const ACTIVATION_PURPOSES: readonly InvitationPurpose[] = ['invite', 'invite_with_password'];

export type ActivationRequest = {
  email: string;
  code: string;
  password: string;
};

export type PendingInvitation = {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  failedAttempts: number;
  /**
   * Vem do banco. Conferida aqui de novo — F17.39.
   *
   * Fixá-la em `'invite'` de dentro faria a conferência passar sempre, e é o
   * mesmo cuidado que `PendingReset.purpose` já tem desde a F17.31.
   */
  purpose: InvitationPurpose;
};

/** Motivo interno da recusa. Vai para a auditoria, **nunca** para quem chamou. */
export type RefusalReason =
  | 'rate_limited'
  | 'no_invitation'
  /**
   * Alguém entregou um código de senha a esta porta — F17.39.
   *
   * Separado de `no_invitation` porque são defeitos diferentes de quem escreveu
   * o código de cima. A pessoa do outro lado vê a mesma frase nos dois casos.
   */
  | 'wrong_purpose'
  | 'invitation_locked'
  | 'invitation_expired'
  | 'wrong_code'
  | 'weak_password';

export type ActivationOutcome =
  | {
      ok: true;
      invitationId: string;
      email: string;
      /**
       * A conta já existia no cadastro compartilhado — F17.30.
       *
       * Quem chama precisa saber porque os dois caminhos são outros: na conta
       * nova o provedor já devolveu identidade contra a senha escolhida; na que
       * já existia a identidade vem do cadastro, pela porta que só responde a
       * quem provou ter o código.
       */
      alreadyExisted: boolean;
      /**
       * A senha digitada no formulário passa a valer — F17.39.
       *
       * ⚠️ É PROMESSA, E QUEM CHAMA TEM DE CUMPRI-LA. Verdadeira quando a conta
       * nasceu agora (a senha já é dela) e quando o convite tem a intenção que
       * autoriza defini-la. Falsa no caminho da F17.30: conta que já existe com
       * convite comum continua entrando com a senha de sempre, e a digitada
       * aqui é descartada.
       *
       * Sem este sinal a tela prometeria uma troca de senha que não aconteceu —
       * que foi exatamente o que prendeu duas pessoas do lado de fora.
       */
      definesPassword: boolean;
    }
  | {
      ok: false;
      /** O que se mostra na tela. */
      message: string;
      /** Só para registro. Não exponha. */
      reason: RefusalReason;
      /** Verdadeiro quando o erro deve incrementar o contador do convite. */
      countsAgainstInvitation: boolean;
    };

/** Portas para o mundo — implementadas na borda, dubladas nos testes. */
export type ActivationPorts = {
  /** Já estourou o teto por e-mail ou por origem? */
  isRateLimited(email: string): Promise<boolean>;
  /**
   * Registra a tentativa — F17.53, achado A3 da auditoria de 2026-09-01.
   *
   * ⚠️ SEM ESTA PORTA O TETO ACIMA NUNCA CONTA NADA, e foi exatamente o que
   * aconteceu por treze dias: `isRateLimited` consultava `auth_attempts`
   * procurando linhas de intenção `activation`, e NINGUÉM as escrevia — só o
   * login escrevia, e sempre com `'login'`. A consulta lia 0 e devolvia falso
   * sempre. Eram 498 linhas na tabela, 100% `login`, ZERO `activation`.
   *
   * Ela mora aqui, na decisão, e não na borda, pelo mesmo motivo do login: se
   * quem chama for quem tiver de lembrar de contar, um dia esquece — e o
   * esquecimento é calado, porque um limitador que não conta se parece com um
   * limitador que ninguém estourou.
   *
   * Falhar aqui NUNCA impede a ativação: o registro é o extra, a ação é o que
   * a pessoa pediu. A falha é gritada na borda.
   */
  recordAttempt(email: string): Promise<void>;
  /** Convite pendente para este e-mail, se houver. */
  findPendingInvitation(email: string): Promise<PendingInvitation | null>;
  /**
   * Garante que existe conta de login para este e-mail.
   *
   * ⚠️ ESTA PORTA NUNCA TROCA SENHA DE CONTA QUE JÁ EXISTE — nem grava, nem
   * redefine, nem confere. O cadastro é o mesmo do Sistema IDE em produção, e
   * a única chamada que ela faz é a de criar, que contra endereço com dono
   * RECUSA. Ela responde `alreadyExisted: true`, e nada mais acontece aqui.
   *
   * Quando o convite autoriza definir a senha (F17.39), quem escreve é a porta
   * de administração do provedor, chamada por quem decide — e só depois de
   * `ideworks.find_invite_account` ter devolvido a autorização. Duas portas
   * diferentes de propósito: esta não tem permissão de escrever senha, e não é
   * que ela se contenha.
   *
   * Conta nova segue como sempre: a senha escolhida passa a valer, e a porta
   * pode recusá-la por fraca ou vazada.
   */
  ensureAccount(
    email: string,
    password: string,
  ): Promise<{ ok: true; alreadyExisted: boolean } | { ok: false; message: string }>;
};

function refuse(
  reason: RefusalReason,
  countsAgainstInvitation = false,
): ActivationOutcome {
  return { ok: false, message: GENERIC_REFUSAL, reason, countsAgainstInvitation };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Decide se a ativação procede. Não grava nada; quem chama é que persiste o
 * resultado — inclusive o incremento do contador quando `countsAgainstInvitation`.
 */
export async function decideActivation(
  request: ActivationRequest,
  ports: ActivationPorts,
  now: Date = new Date(),
): Promise<ActivationOutcome> {
  const email = normalizeEmail(request.email);

  // 1. teto de tentativas — também responde a frase genérica, porque um
  //    "muitas tentativas para este e-mail" confirmaria que ele existe.
  if (await ports.isRateLimited(email)) return refuse('rate_limited');

  // 1b. a tentativa é REGISTRADA ANTES DE SABER O RESULTADO, como no login.
  //
  //     Contar só as que falham deixaria um ataque bem sucedido sem rastro
  //     nenhum; e contar só depois de a decisão terminar significaria não
  //     contar as que saem por qualquer `return` do meio do caminho — que são
  //     justamente as de quem está chutando endereço.
  //
  //     ⚠️ Depois do teto, e não antes: quem já está barrado não estende a
  //     própria janela a cada nova batida na porta.
  await ports.recordAttempt(email);

  // 2. convite pendente
  const invitation = await ports.findPendingInvitation(email);
  if (!invitation) return refuse('no_invitation');

  // 2b. a intenção, e ela vem ANTES da conferência do código — F17.39.
  //
  // Um código de redefinição de senha, mesmo correto, não pode chegar nem perto
  // de dar acesso aqui: ele nasce sem papel, sem empresa e sem área escolhidos,
  // e aplicá-lo apagaria o que a pessoa já tem. `ideworks.aplicar_convite`
  // recusa de todo jeito (F17.31); esta é a mesma recusa onde ela pode ser
  // provada sem banco nenhum.
  if (!ACTIVATION_PURPOSES.includes(invitation.purpose)) return refuse('wrong_purpose');

  // 3. teto de erros do convite
  if (invitation.failedAttempts >= MAX_FAILED_ATTEMPTS) return refuse('invitation_locked');

  // 4. validade
  if (invitation.expiresAt.getTime() <= now.getTime()) return refuse('invitation_expired');

  // 5. o código. Só aqui o contador do convite avança: os casos anteriores não
  //    dizem nada sobre quem digitou, e puni-los deixaria um convite legítimo
  //    travável por terceiro.
  if (!(await verifyCode(request.code, invitation.codeHash))) {
    return refuse('wrong_code', true);
  }

  // 6. a conta. Único ponto com mensagem explicativa, e o convite segue válido
  //    para nova tentativa — a pessoa já provou que tem o código.
  //
  //    É AQUI, E SÓ AQUI, QUE SE DESCOBRE SE A PESSOA JÁ TINHA CONTA — F17.30.
  //    Depois da conferência do código, nunca antes. Perguntar "este e-mail já
  //    tem conta?" mais cedo responderia a quem só digitou um endereço, que é
  //    a enumeração de usuários descrita no topo deste arquivo.
  const account = await ports.ensureAccount(email, request.password);
  if (!account.ok) {
    return {
      ok: false,
      message: account.message,
      reason: 'weak_password',
      countsAgainstInvitation: false,
    };
  }

  return {
    ok: true,
    invitationId: invitation.id,
    email,
    alreadyExisted: account.alreadyExisted,
    // A CONTA NOVA NÃO PRECISA DE AUTORIZAÇÃO: ela acabou de nascer com a senha
    // escolhida, e não havia senha de ninguém para proteger. A que já existia
    // só entra por `invite_with_password` — e essa autorização quem confere de
    // verdade é a porta do banco, não esta linha.
    definesPassword:
      !account.alreadyExisted || invitation.purpose === 'invite_with_password',
  };
}
