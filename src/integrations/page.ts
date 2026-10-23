/**
 * Helpers de página da integração — F16.3a.
 *
 * A IDEIA vem de `src/server/board-trabalho.ts` / `paginacao-do-trabalho.ts`:
 * cursor opaco, lote com `returned` / `hasMore` / `nextCursor`, ordenação
 * estável com desempate por id. Não copia o SQL de Minhas tarefas — a chave
 * aqui é genérica (texto + id) para search, conversa e diretório reusarem.
 *
 * Teto: 50 por padrão, 100 no máximo. Pedir mais que 100 é RECUSA, não corte
 * silencioso. Orçamento de resposta: os mesmos 64 KiB do corpo de entrada.
 */

import { INTEGRATION_MAX_BODY_BYTES } from '@/integrations/limits';

export const PAGE_DEFAULT_LIMIT = 50;
export const PAGE_MAX_LIMIT = 100;
export const RESPONSE_BUDGET_BYTES = INTEGRATION_MAX_BODY_BYTES;
export const PAGE_CURSOR_VERSION = 1 as const;

export type PageKey = { k: string; id: string };

export type PageCursor = {
  v: typeof PAGE_CURSOR_VERSION;
  k: string;
  id: string;
};

export type Page<T> = {
  items: T[];
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type PageRequestError = {
  ok: false;
  code: 'limit_exceeded' | 'invalid_cursor' | 'invalid_limit';
  message: string;
};

export type PageRequest = {
  ok: true;
  limit: number;
  cursor: PageCursor | null;
};

function paraBase64url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64url(texto: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const sobra = base64.length % 4;
  if (sobra === 1) return null;
  try {
    const binario = atob(sobra === 0 ? base64 : base64 + '='.repeat(4 - sobra));
    const decoded = Uint8Array.from(binario, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(decoded);
  } catch {
    return null;
  }
}

export function encodePageCursor(cursor: PageCursor): string {
  return paraBase64url(JSON.stringify(cursor));
}

export function decodePageCursor(texto: string): { ok: true; cursor: PageCursor } | { ok: false; motivo: string } {
  const json = deBase64url(texto);
  if (json === null) return { ok: false, motivo: 'base64url inválido' };
  let cru: unknown;
  try {
    cru = JSON.parse(json);
  } catch {
    return { ok: false, motivo: 'JSON inválido' };
  }
  if (cru === null || typeof cru !== 'object' || Array.isArray(cru)) {
    return { ok: false, motivo: 'não é um objeto' };
  }
  const c = cru as Record<string, unknown>;
  if (c.v !== PAGE_CURSOR_VERSION) return { ok: false, motivo: `versão desconhecida: ${String(c.v)}` };
  if (typeof c.k !== 'string' || c.k.length === 0) return { ok: false, motivo: 'chave ausente' };
  if (typeof c.id !== 'string' || c.id.length === 0) return { ok: false, motivo: 'id ausente' };
  // A chave e o id descem ao SQL como texto, e o Postgres não guarda NUL (U+0000)
  // em texto: um cursor forjado com ele virava erro interno. Cursor honesto nunca tem.
  if (c.k.includes('\u0000') || c.id.includes('\u0000')) return { ok: false, motivo: 'caractere inválido' };
  return { ok: true, cursor: { v: PAGE_CURSOR_VERSION, k: c.k, id: c.id } };
}

export function comparePageKey(a: PageKey, b: PageKey): number {
  if (a.k < b.k) return -1;
  if (a.k > b.k) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function parsePageLimit(value: unknown, fallback: number = PAGE_DEFAULT_LIMIT): number | PageRequestError {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return {
      ok: false,
      code: 'invalid_limit',
      message: `O limite precisa ser um inteiro entre 1 e ${PAGE_MAX_LIMIT}. Omita para usar ${PAGE_DEFAULT_LIMIT}.`,
    };
  }
  if (n > PAGE_MAX_LIMIT) {
    return {
      ok: false,
      code: 'limit_exceeded',
      message: `O limite máximo é ${PAGE_MAX_LIMIT} itens por página. Peça um limit menor e continue pelo nextCursor da resposta (hasMore: true).`,
    };
  }
  return n;
}

export function parsePageRequest(input: { limit?: unknown; cursor?: string | null }): PageRequest | PageRequestError {
  const limit = parsePageLimit(input.limit);
  if (typeof limit !== 'number') return limit;
  if (input.cursor === undefined || input.cursor === null || input.cursor === '') {
    return { ok: true, limit, cursor: null };
  }
  const lido = decodePageCursor(input.cursor);
  if (!lido.ok) {
    return {
      ok: false,
      code: 'invalid_cursor',
      message: 'Não deu para continuar a leitura de onde parou. Peça a primeira página de novo.',
    };
  }
  return { ok: true, limit, cursor: lido.cursor };
}

/**
 * Página em memória sobre uma massa já recortada. Ordena por chave estável,
 * continua DEPOIS do cursor, nunca inclui o item do cursor de novo.
 */
export function paginateStable<T>(
  items: readonly T[],
  options: {
    limit?: unknown;
    cursor?: string | null;
    key: (item: T) => PageKey;
  },
): Page<T> | PageRequestError {
  const pedido = parsePageRequest({ limit: options.limit, cursor: options.cursor });
  if (!pedido.ok) return pedido;

  const ranked = items
    .map((item) => ({ item, key: options.key(item) }))
    .sort((a, b) => comparePageKey(a.key, b.key));

  let start = 0;
  if (pedido.cursor) {
    start = ranked.findIndex((row) => comparePageKey(row.key, pedido.cursor!) > 0);
    if (start < 0) start = ranked.length;
  }

  const slice = ranked.slice(start, start + pedido.limit);
  const hasMore = start + slice.length < ranked.length;
  const last = slice.at(-1);
  return {
    items: slice.map((row) => row.item),
    returned: slice.length,
    hasMore,
    nextCursor:
      hasMore && last !== undefined
        ? encodePageCursor({ v: PAGE_CURSOR_VERSION, k: last.key.k, id: last.key.id })
        : null,
  };
}

export function measureJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function overBudget(value: unknown, max: number = RESPONSE_BUDGET_BYTES): boolean {
  return measureJsonBytes(value) > max;
}

/**
 * Corta a lista para caber no orçamento, com sinal de continuação. A chave
 * do último item que entrou vira o cursor — o próximo lote começa depois.
 */
export function fitItemsToBudget<T>(
  items: readonly T[],
  options: {
    key: (item: T) => PageKey;
    envelopeBytes?: (items: readonly T[]) => number;
    budget?: number;
  },
): Page<T> {
  const budget = options.budget ?? RESPONSE_BUDGET_BYTES;
  const size = options.envelopeBytes ?? ((lote) => measureJsonBytes(lote));
  if (items.length === 0) {
    return { items: [], returned: 0, hasMore: false, nextCursor: null };
  }
  if (size(items) <= budget) {
    return { items: [...items], returned: items.length, hasMore: false, nextCursor: null };
  }

  let lo = 1;
  let hi = items.length;
  let fit = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (size(items.slice(0, mid)) <= budget) {
      fit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (size(items.slice(0, 1)) > budget) {
    fit = 1;
  }
  const kept = items.slice(0, Math.max(1, fit));
  const last = kept.at(-1);
  const lastKey = last !== undefined ? options.key(last) : null;
  return {
    items: [...kept],
    returned: kept.length,
    hasMore: kept.length < items.length || size(items) > budget,
    nextCursor: lastKey ? encodePageCursor({ v: PAGE_CURSOR_VERSION, k: lastKey.k, id: lastKey.id }) : null,
  };
}
