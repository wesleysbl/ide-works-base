/**
 * Código de ativação — etapa F1.2.
 *
 * Comportamento definido em `COMO-FUNCIONA-O-ACESSO.md`:
 *
 *   - nove caracteres, mostrados como XXX-XXX-XXX;
 *   - alfabeto sem as letras que se confundem com dígitos;
 *   - quem digita a letra no lugar do dígito parecido é corrigido antes da
 *     conferência;
 *   - o código NUNCA é guardado — só a impressão digital dele. Perdido, gera-se
 *     outro;
 *   - conferência em tempo constante, para o tempo de resposta não denunciar
 *     quão perto o palpite chegou.
 *
 * SOBRE O ALFABETO
 *   São 32 símbolos: dez dígitos mais as vinte e duas letras que sobram depois
 *   de tirar I, L, O e U. Com nove posições isso dá 32^9 = 2^45 — exatamente os
 *   45 bits que o documento cita, algo perto de 35 trilhões de combinações.
 *   É o alfabeto Crockford Base32, que exclui essas quatro letras pelo mesmo
 *   motivo: I e L viram 1, O vira 0 na leitura de quem digita.
 */

/** 32 símbolos: 0-9 e A-Z sem I, L, O, U. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const CODE_LENGTH = 9;

/** Validade do convite, conforme o documento de acesso. */
export const INVITATION_TTL_HOURS = 72;

/** Teto de erros ao longo da vida de um convite. */
export const MAX_FAILED_ATTEMPTS = 10;

/**
 * Trocas de leitura. Não são "correções de erro": são as confusões visuais que
 * de fato acontecem quando alguém lê um código escrito e digita.
 */
const READING_FIXES: Record<string, string> = {
  O: '0',
  I: '1',
  L: '1',
  U: 'V',
};

export class InvalidCode extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCode';
  }
}

/** Gera um código novo, com aleatoriedade criptográfica. */
export function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);

  // O alfabeto tem 32 símbolos e 256 é múltiplo exato de 32, então o resto da
  // divisão não enviesa nenhum símbolo. Com tamanho não-potência-de-dois isto
  // seria errado, e o viés passaria despercebido.
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

/** Mostra como XXX-XXX-XXX. Só apresentação — o hífen nunca entra no cálculo. */
export function formatCode(code: string): string {
  const clean = normalizeCode(code);
  return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6, 9)}`;
}

/**
 * Prepara o que a pessoa digitou para conferência: tira hífen e espaço, sobe
 * para maiúscula e aplica as trocas de leitura.
 *
 * Lança `InvalidCode` quando o resultado não é um código possível. Recusar aqui
 * é de propósito: valor que não é código não deve seguir adiante virando
 * comparação de hash contra lixo.
 */
export function normalizeCode(input: string): string {
  const upper = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const fixed = [...upper].map((c) => READING_FIXES[c] ?? c).join('');

  if (fixed.length !== CODE_LENGTH) {
    throw new InvalidCode(
      `Código deve ter ${CODE_LENGTH} caracteres; recebeu ${fixed.length}.`,
    );
  }
  for (const c of fixed) {
    if (!ALPHABET.includes(c)) {
      throw new InvalidCode(`Caractere fora do alfabeto do código: "${c}".`);
    }
  }
  return fixed;
}

/**
 * Impressão digital do código. É isto — e só isto — que o banco guarda.
 *
 * Consequência prática, que a tela precisa avisar antes: se o código se perder,
 * ninguém o recupera. Nem olhando o banco. A saída é gerar outro.
 */
export async function hashCode(code: string): Promise<string> {
  const normalized = normalizeCode(code);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Confere o código contra a impressão digital guardada, em tempo constante.
 *
 * Comparar com `===` faria um palpite quase certo demorar mais que um errado no
 * primeiro caractere, e essa diferença é suficiente para descobrir o código
 * caractere a caractere. Aqui todos os bytes são sempre percorridos.
 */
export async function verifyCode(input: string, storedHash: string): Promise<boolean> {
  let candidate: string;
  try {
    candidate = await hashCode(input);
  } catch {
    // Entrada malformada não é exceção para quem chama: é palpite errado, e
    // deve custar o mesmo que qualquer outro. Vazar a diferença entre "código
    // inválido" e "código errado" é justamente o que se evita.
    candidate = '0'.repeat(storedHash.length);
  }

  if (candidate.length !== storedHash.length) return false;

  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

/** Instante em que um convite criado agora expira. */
export function expiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_HOURS * 60 * 60 * 1000);
}
