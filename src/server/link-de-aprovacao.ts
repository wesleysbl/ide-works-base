/**
 * O TOKEN DO LINK DE APROVAÇÃO DO CLIENTE — F42, Fase 3.
 *
 * TRÊS FORMAS DO MESMO TOKEN
 *   - CRU: 32 bytes aleatórios (`crypto.getRandomValues`) em base64url, 43
 *     caracteres. É o que vai no endereço `<origem>/aprovar/<token>`. Nunca é
 *     gravado.
 *   - HASH: SHA-256 em hexadecimal do token cru — o padrão do convite
 *     (`hashCode`, `src/auth/activation-code.ts`), sem a normalização dele: o
 *     token é base64url, e maiúscula e minúscula são caracteres diferentes. É por
 *     ele que o link se resolve (`ideworks.resolve_approval_link`).
 *   - CIFRADO: AES-GCM 256 com a chave do segredo `IDEWORKS_APPROVAL_LINK_KEY`
 *     (32 bytes em base64). Existe porque o link é FIXO e a equipe precisa
 *     copiá-lo de novo para reenviar pelo WhatsApp. O banco guarda só o texto
 *     cifrado e não sabe decifrar; quem decifra é o Worker, na hora de copiar.
 *
 * O CIFRADO É PRESO AO CLIENTE
 *   O id do cliente entra como dado adicional autenticado (AAD) do GCM. Um texto
 *   cifrado copiado para a linha de outro cliente não decifra — a troca vira
 *   erro, e não o link de um cliente na ficha de outro.
 *
 * FORMATO GRAVADO: `v1.<iv base64url>.<cifra+etiqueta base64url>`. O `v1` deixa
 * trocar o algoritmo um dia sem adivinhar o que está gravado.
 */

export const SEGREDO_DA_CHAVE = 'IDEWORKS_APPROVAL_LINK_KEY';

/** Bytes do token cru. 32 = 256 bits, folga de sobra contra adivinhação. */
export const BYTES_DO_TOKEN = 32;

/** O formato exato do token cru: 43 caracteres base64url, sem `=`. */
export const FORMATO_DO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const VERSAO = 'v1';

/* ─────────────────────────── base64url ─────────────────────────── */

export function paraBase64Url(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Aceita base64 comum e base64url, com ou sem `=`. Lança se não for base64. */
export function deBase64(texto: string): Uint8Array<ArrayBuffer> {
  const limpo = texto.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(limpo)) throw new Error('Texto fora de base64.');
  const completo = limpo.padEnd(Math.ceil(limpo.length / 4) * 4, '=');
  const binario = atob(completo);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/* ─────────────────────────── token e hash ─────────────────────────── */

/** Um token novo, forte e de endereço: 32 bytes aleatórios em base64url. */
export function gerarToken(): string {
  const bytes = new Uint8Array(BYTES_DO_TOKEN);
  crypto.getRandomValues(bytes);
  return paraBase64Url(bytes);
}

export const tokenTemFormato = (token: string): boolean => FORMATO_DO_TOKEN.test(token);

/** SHA-256 hexadecimal do token cru — o que `token_hash` guarda. */
export async function hashDoToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ─────────────────────────── a chave ─────────────────────────── */

/** O segredo faltou ou não é uma chave AES-256 válida. O Worker responde 503. */
export class ChaveDoLinkAusente extends Error {
  constructor(motivo: 'faltando' | 'invalida') {
    super(
      motivo === 'faltando'
        ? `O servidor está sem a chave do link de aprovação (segredo ${SEGREDO_DA_CHAVE}). Peça ao administrador do sistema para gravá-la.`
        : `A chave do link de aprovação (segredo ${SEGREDO_DA_CHAVE}) não é válida: precisa ter 32 bytes em base64.`,
    );
    this.name = 'ChaveDoLinkAusente';
  }
}

/**
 * Importa a chave do ambiente. Vazia conta como ausente (segredo apagado deixa a
 * variável definida e vazia — o mesmo cuidado de `credenciaisDoDropbox`).
 */
export async function chaveDoAmbiente(env: Partial<Record<string, unknown>>): Promise<CryptoKey> {
  const valor = env[SEGREDO_DA_CHAVE];
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (texto === '') throw new ChaveDoLinkAusente('faltando');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = deBase64(texto);
  } catch {
    throw new ChaveDoLinkAusente('invalida');
  }
  if (bytes.length !== 32) throw new ChaveDoLinkAusente('invalida');
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* ─────────────────────────── cifrar e decifrar ─────────────────────────── */

export async function cifrarToken(token: string, chave: CryptoKey, clientId: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cifra = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(clientId) },
    chave,
    new TextEncoder().encode(token),
  );
  return `${VERSAO}.${paraBase64Url(iv)}.${paraBase64Url(new Uint8Array(cifra))}`;
}

/** O texto cifrado não abre: chave trocada, cliente trocado ou texto adulterado. */
export class CifraInvalida extends Error {
  constructor() {
    super(
      'Não foi possível abrir o link guardado (a chave do servidor mudou?). Gere um novo link — o antigo para de funcionar.',
    );
    this.name = 'CifraInvalida';
  }
}

export async function decifrarToken(guardado: string, chave: CryptoKey, clientId: string): Promise<string> {
  const partes = guardado.split('.');
  if (partes.length !== 3 || partes[0] !== VERSAO) throw new CifraInvalida();
  try {
    const claro = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: deBase64(partes[1]), additionalData: new TextEncoder().encode(clientId) },
      chave,
      deBase64(partes[2]),
    );
    return new TextDecoder().decode(claro);
  } catch {
    throw new CifraInvalida();
  }
}

/* ─────────────────────────── o endereço ─────────────────────────── */

/** O endereço que o cliente abre. A página é do front (Fase 6). */
export const enderecoDoLink = (origem: string, token: string): string =>
  `${origem.replace(/\/+$/, '')}/aprovar/${token}`;
