/**
 * Mensagem de entrega do convite — etapa F1.2.
 *
 * POR QUE O SISTEMA NÃO ENVIA
 *   Definido em `COMO-FUNCIONA-O-ACESSO.md`: o código vai pelo WhatsApp, colado
 *   por quem criou a conta. E-mail cai em spam e some; o canal real de contato
 *   da agência já é o WhatsApp. Automatizar aqui trocaria um caminho que
 *   funciona por um que falha em silêncio.
 *
 *   Este módulo, portanto, **não envia nada**. Ele só monta o texto para o botão
 *   de copiar. Nenhuma fila, nenhum modelo de e-mail, nenhum retorno de entrega.
 */

import { formatCode } from '@/auth/activation-code';
import { activationUrlWithName } from '@/auth/invited-name';

export type InvitationMessageInput = {
  email: string;
  code: string;
  activationUrl: string;
  expiresAt: Date;
  /**
   * O nome que quem convidou escreveu — F17.29. Vai DENTRO do endereço, e é
   * assim que a tela de ativação consegue mostrá-lo já preenchido sem
   * perguntar nada ao servidor antes de a pessoa provar que tem o código.
   */
  name?: string;
};

/** Prazo restante em horas inteiras, arredondado para baixo. */
function hoursUntil(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 3_600_000));
}

/**
 * Monta o texto pronto para colar no WhatsApp.
 *
 * O código aparece formatado (XXX-XXX-XXX) porque é assim que a pessoa vai lê-lo
 * e digitá-lo. O prazo é dito em horas, e não como data, porque "expira em 72
 * horas" é acionável e "expira em 22/08/2026 às 12:00" exige conta mental.
 */
export function buildInvitationMessage(
  input: InvitationMessageInput,
  now: Date = new Date(),
): string {
  const horas = hoursUntil(input.expiresAt, now);
  const prazo =
    horas <= 0
      ? 'ATENÇÃO: este código já expirou — gere outro.'
      : `O código expira em ${horas} horas.`;

  return [
    'Seu acesso ao IDE Works foi criado! 🎉',
    '',
    `1. Acesse: ${activationUrlWithName(input.activationUrl, input.name)}`,
    `2. Use o e-mail: ${input.email}`,
    `3. Código de ativação: ${formatCode(input.code)}`,
    '4. Crie sua senha e pronto — você já entra direto.',
    '',
    `${prazo} Qualquer dúvida, me chama!`,
  ].join('\n');
}

/**
 * Aviso que a tela precisa mostrar junto do código, em destaque.
 *
 * Não é decoração: o banco guarda só a impressão digital do código. Se ele se
 * perder, ninguém o recupera — nem olhando o banco. A pessoa precisa saber disso
 * ANTES de fechar a janela, não depois.
 */
export const CODE_SHOWN_ONCE_WARNING =
  'Copie agora: este código não será mostrado de novo. ' +
  'Ele não fica guardado em lugar nenhum — se perder, será preciso gerar outro.';

/* ───────────────────── o outro código: o de senha (F17.31) ───────────────── */

export type ResetMessageInput = {
  email: string;
  code: string;
  /** A tela onde a pessoa escolhe a senha nova. */
  resetUrl: string;
  expiresAt: Date;
};

/**
 * Monta o texto do código de redefinição, pronto para colar no WhatsApp.
 *
 * ⚠️ POR QUE NÃO É O MESMO TEXTO DO CONVITE, COM OUTRA PALAVRA
 *   O convite diz "seu acesso foi criado" e manda ativar a conta. Quem recebe
 *   um código de senha JÁ TEM conta e já entrava — mandá-lo ativar o faria
 *   procurar uma tela que não resolve o problema dele, e a tela de ativação
 *   recusa este código de propósito. Texto que descreve errado o que vai
 *   acontecer gasta o tempo de duas pessoas, não de uma.
 *
 *   O que se repete de propósito é o prazo em horas e o "uma vez só": as duas
 *   coisas que a pessoa precisa saber antes de guardar a mensagem para depois.
 */
export function buildResetMessage(input: ResetMessageInput, now: Date = new Date()): string {
  const horas = hoursUntil(input.expiresAt, now);
  const prazo =
    horas <= 0
      ? 'ATENÇÃO: este código já expirou — peça outro.'
      : `O código expira em ${horas} horas e serve uma vez só.`;

  return [
    'Código para você escolher uma senha nova no IDE Works.',
    '',
    `1. Acesse: ${input.resetUrl}`,
    `2. Use o e-mail: ${input.email}`,
    `3. Código: ${formatCode(input.code)}`,
    '4. Escolha a senha que você quiser — ninguém aqui vai saber qual é.',
    '',
    `${prazo} Qualquer dúvida, me chama!`,
  ].join('\n');
}
