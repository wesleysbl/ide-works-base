/**
 * Trava de conta de teste — etapa F1.9.
 *
 * POR QUE ELA EXISTE
 *   O IDE Works divide o projeto de banco com o Sistema IDE em produção
 *   (decisão D8), e a autenticação é **a mesma**: os 32 registros de conta ali
 *   incluem as 21 pessoas reais da agência.
 *
 *   Para verificar o percurso de acesso de ponta a ponta é preciso criar conta
 *   de verdade. Esta trava garante que só se crie conta que **não pode ser de
 *   ninguém**.
 *
 * O DOMÍNIO RESERVADO
 *   `.invalid` é um domínio de topo reservado por norma: nunca pode ser
 *   registrado, nunca resolve, e nenhuma mensagem chega lá. Uma conta em
 *   `@ideworks.invalid` é, por construção, impossível de pertencer a uma pessoa
 *   real — e o próprio endereço diz o que ela é.
 *
 *   Os domínios reais deste projeto são exemplo.com.br, gmail.com,
 *   hotmail.com e outlook.com.br. Nenhum deles pode virar `.invalid`.
 *
 * A REGRA QUE NÃO SE NEGOCIA
 *   O IDE Works **nunca apaga conta** neste projeto. Nem as de teste. Apagar é
 *   a operação que, se errar o alvo, tira o acesso de uma pessoa de verdade — e
 *   uma conta de teste parada não incomoda ninguém.
 */

export const TEST_ACCOUNT_DOMAIN = 'ideworks.invalid';

/** Prefixo obrigatório, para a conta se identificar mesmo fora de contexto. */
export const TEST_ACCOUNT_PREFIX = 'teste-';

const TEST_ACCOUNT_PATTERN = new RegExp(
  `^${TEST_ACCOUNT_PREFIX}[a-z0-9-]+@${TEST_ACCOUNT_DOMAIN.replace('.', '\\.')}$`,
);

export class RealAccountRefused extends Error {
  constructor(email: string) {
    super(
      `Recusado: "${email}" não é conta de teste. ` +
        `Só é permitido criar conta em @${TEST_ACCOUNT_DOMAIN} com prefixo "${TEST_ACCOUNT_PREFIX}". ` +
        'A autenticação deste projeto é compartilhada com o Sistema IDE em produção, ' +
        'e criar conta fora do domínio reservado mexeria com as contas reais da agência.',
    );
    this.name = 'RealAccountRefused';
  }
}

export function isTestAccount(email: string): boolean {
  return TEST_ACCOUNT_PATTERN.test(email.trim().toLowerCase());
}

/**
 * A LISTA DE CONVIDADOS: nomes próprios, e não uma porta aberta.
 *
 * POR QUE ELA EXISTE
 *   Chegou a hora de gente de verdade entrar, e havia duas formas de permitir:
 *   desligar a trava, ou nomear quem entra. Desligar valeria para qualquer
 *   endereço, inclusive digitado errado — e o cadastro é o mesmo do Sistema IDE
 *   em produção, com as 21 contas da agência dentro.
 *
 *   Nomear custa uma linha por pessoa e mantém tudo o mais fechado. E, como a
 *   lista vive em arquivo versionado, quem ganhou acesso e quando fica no
 *   histórico — que é exatamente o que se quer poder auditar depois.
 *
 * COMPARAÇÃO EXATA, SEM CURINGA
 *   Nada de "qualquer um @parceira.com.br". Um domínio inteiro é uma porta que
 *   ninguém revisa; um endereço é uma decisão que alguém tomou.
 */
export function estaNaLista(email: string, lista: string): boolean {
  const alvo = email.trim().toLowerCase();
  if (alvo === '') return false;
  return lista
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '')
    .includes(alvo);
}

/**
 * Recusa qualquer criação de conta que não seja de teste nem esteja na lista.
 *
 * Chamado na borda de tudo que escreve em autenticação. Quando existir ambiente
 * próprio, esta trava sai — mas sair precisa ser decisão explícita, não
 * esquecimento.
 */
export function assertTestAccount(email: string, listaLiberada = ''): void {
  if (isTestAccount(email)) return;
  if (estaNaLista(email, listaLiberada)) return;
  throw new RealAccountRefused(email);
}

/** Endereço de teste previsível, para o percurso de verificação. */
export function testAccountEmail(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug === '') throw new Error('Rótulo de conta de teste não pode ser vazio.');
  return `${TEST_ACCOUNT_PREFIX}${slug}@${TEST_ACCOUNT_DOMAIN}`;
}

/**
 * Nunca apagamos conta neste projeto. Esta função existe para dar mensagem
 * clara a quem tentar — e para o teste poder provar que a recusa é total.
 */
export function assertNeverDeleteAccounts(): never {
  throw new Error(
    'O IDE Works não apaga conta neste projeto, nem de teste. ' +
      'A autenticação é compartilhada com o Sistema IDE em produção: errar o alvo ' +
      'de uma exclusão tira o acesso de uma pessoa real. Conta de teste parada não ' +
      'incomoda ninguém — deixe-a lá.',
  );
}
