/**
 * A paginação de `Minhas tarefas` — a camada pura. Etapa F17.AUD05.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ESTA PEÇA APAGA (achado 4 da auditoria de 2026-09-09)
 *   O servidor trazia até 500 linhas por prazo e a tela separava as abas. Com
 *   500 concluídas antigas e uma pendente posterior, a pendente ficava fora do
 *   lote e a aba dizia `Pendente 0` — sem aviso, porque `capped` era ignorado.
 *
 *   A saída não é um teto maior: é filtrar a aba no banco ANTES do limite,
 *   contar cada aba inteira, e devolver lotes de 100 com continuação por
 *   cursor. Este arquivo é a parte que decide SEM banco: o que vem no endereço
 *   é válido? de onde continuar? há mais? qual é o próximo cursor?
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ESTE ARQUIVO NÃO FAZ, DE PROPÓSITO
 *   Ele não monta SQL nem toca em identidade. O `where` de cada aba e a
 *   condição "depois do cursor" moram em `server/board-trabalho.ts`, com o
 *   mesmo `tx` da consulta; a pessoa em nome de quem se lê vem SEMPRE de
 *   `sessao.actor`, no Worker. Nenhum valor daqui entra em interpolação de
 *   identidade nem muda o alcance: o cursor diz DE ONDE continuar, a política
 *   de linha continua dizendo O QUE se alcança.
 *
 * O CURSOR É A POSIÇÃO NA ORDENAÇÃO, E NÃO UM NÚMERO DE PÁGINA
 *   A ordem de sempre é `due_on nulls last, priority nulls last, lower(title)`.
 *   `offset` mentiria: uma tarefa concluída entre dois pedidos deslocaria a
 *   janela e a página seguinte pularia uma linha ou repetiria outra. O cursor
 *   guarda a chave da última linha devolvida, e a página seguinte é "o que
 *   vem DEPOIS dessa chave" — estável enquanto os dados não mudam, e sem
 *   duplicata quando mudam.
 *
 *   Para isso a chave precisa ser ÚNICA, e a ordem de sempre não é: duas
 *   tarefas com o mesmo prazo, prioridade e título empatam. O `id` entra como
 *   último desempate — só no caminho paginado, para não mexer na ordem que
 *   `Todas as tarefas` já tem.
 *
 * ⚠️ O TÍTULO DA CHAVE VEM DO BANCO, JÁ EM `lower()`
 *   E não de `title.toLowerCase()` aqui. `lower()` do Postgres segue a
 *   collation do banco; `toLowerCase()` segue o Unicode do JavaScript. Para
 *   quase tudo dão o mesmo; para o que não dão, o cursor apontaria para uma
 *   posição que a ordenação do banco não reconhece, e a página seguinte
 *   pularia ou repetiria linhas em silêncio. A consulta devolve `lower(title)`
 *   como coluna própria, e é ela que vai no cursor.
 *
 * OS NULOS SÃO CASOS, E NÃO UM `coalesce`
 *   `nulls last` põe toda tarefa sem prazo DEPOIS de qualquer prazo. Então
 *   "depois do cursor" depende de o cursor ter prazo ou não — e o mesmo vale
 *   para a prioridade. `ramosDoCursor` decide qual dos quatro ramos vale; o
 *   SQL de cada ramo está escrito por extenso no servidor, com o porquê.
 *
 * O CURSOR É OPACO PARA A TELA, E CONFERIDO AQUI
 *   Base64url de um JSON com versão. A tela guarda e devolve; ela não lê nem
 *   monta. Tudo o que chega passa por `decodificarCursor`, que recusa o que não
 *   tiver a forma exata — base64 quebrado, JSON sem campo, versão desconhecida,
 *   tipo errado, aba diferente da pedida. Recusa vira 400 antes de qualquer
 *   consulta.
 */

import { PRIORITY_LABEL, type Priority } from '@/board/board';
import { type Aba, ABAS } from '@/board/meu-trabalho';

/* ───────────────────────────── o tamanho do lote ───────────────────────────── */

/**
 * O lote. Cem linhas rolam sem esforço, e quem precisa de mais aperta
 * `Carregar mais` (AUD06). É também o TETO: pedir 500 devolve 100, e nunca há
 * consulta sem limite.
 */
export const LOTE_PADRAO = 100;
export const LOTE_MAXIMO = 100;

/* ───────────────────────────── o cursor ───────────────────────────── */

/** A versão do formato. Muda quando a chave mudar de forma. */
export const VERSAO_DO_CURSOR = 1;

/**
 * A chave de ordenação da última linha devolvida — a posição de onde continuar.
 *
 * `aba` está aqui para o cursor de `Feito` não continuar `Pendente`: a tela da
 * AUD06 troca de aba enquanto uma carga pode estar em voo, e um cursor da aba
 * errada começaria a nova aba no meio. Não é segurança — é a rede contra o
 * consumidor confuso.
 */
export type CursorDoTrabalho = {
  v: typeof VERSAO_DO_CURSOR;
  aba: Aba;
  /** `YYYY-MM-DD` como o banco escreve, ou nulo. O ano pode ter cinco dígitos. */
  dueOn: string | null;
  priority: Priority | null;
  /** `lower(title)`, calculado pelo banco. Ver o cabeçalho. */
  title: string;
  id: string;
};

/** A chave de ordem que a consulta devolve junto de cada linha. */
export type ChaveDeOrdem = Pick<CursorDoTrabalho, 'dueOn' | 'priority' | 'title' | 'id'>;

/** A data como o banco a escreve em texto: ano com quatro dígitos OU MAIS. */
const DATA = /^\d{4,}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ehAba = (v: unknown): v is Aba => typeof v === 'string' && (ABAS as string[]).includes(v);
const ehPrioridade = (v: unknown): v is Priority =>
  typeof v === 'string' && Object.hasOwn(PRIORITY_LABEL, v);

/* base64url pelos primitivos da web, que existem no Worker e no Node. O título
   pode ter acento, então passa por bytes UTF-8 antes de `btoa`. */
export const paraBase64url = (texto: string): string => {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const deBase64url = (texto: string): string | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const sobra = base64.length % 4;
  if (sobra === 1) return null;
  try {
    const binario = atob(sobra === 0 ? base64 : base64 + '='.repeat(4 - sobra));
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
    // `fatal`: byte que não é UTF-8 é cursor quebrado, e não "�" em silêncio.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
};

export function codificarCursor(cursor: CursorDoTrabalho): string {
  return paraBase64url(JSON.stringify(cursor));
}

export type CursorLido = { ok: true; cursor: CursorDoTrabalho } | { ok: false; motivo: string };

/**
 * Lê e CONFERE o cursor. Tudo o que não tiver a forma exata é recusado com o
 * motivo — e o motivo é para o registro, não para a tela: a tela recebe uma
 * frase só (ver `lerPedidoDePagina`), porque a pessoa não tem o que fazer com
 * "campo `v` ausente".
 */
export function decodificarCursor(texto: string): CursorLido {
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
  if (c.v !== VERSAO_DO_CURSOR) return { ok: false, motivo: `versão desconhecida: ${String(c.v)}` };
  if (!ehAba(c.aba)) return { ok: false, motivo: 'aba ausente ou desconhecida' };
  if (!(c.dueOn === null || (typeof c.dueOn === 'string' && DATA.test(c.dueOn)))) {
    return { ok: false, motivo: 'prazo com forma errada' };
  }
  if (!(c.priority === null || ehPrioridade(c.priority))) {
    return { ok: false, motivo: 'prioridade desconhecida' };
  }
  if (typeof c.title !== 'string') return { ok: false, motivo: 'título ausente' };
  if (typeof c.id !== 'string' || !UUID.test(c.id)) return { ok: false, motivo: 'id inválido' };

  return {
    ok: true,
    cursor: {
      v: VERSAO_DO_CURSOR,
      aba: c.aba,
      dueOn: c.dueOn,
      priority: c.priority,
      title: c.title,
      id: c.id,
    },
  };
}

/* ───────────────────────────── os ramos ───────────────────────────── */

/**
 * Qual condição "depois do cursor" vale, dado o que o cursor tem.
 *
 * A ordem é `due_on nulls last, priority nulls last, lower(title), id`. Cada
 * chave nula muda a forma da condição:
 *
 *   prazo `com-valor`  → depois dele estão: os prazos maiores, os SEM prazo
 *                        (nulls last), e os iguais que perdem no resto.
 *   prazo `nulo`       → só os SEM prazo podem vir depois; todo prazo com
 *                        valor já passou.
 *
 * E o mesmo, um nível abaixo, para a prioridade. Título e id nunca são nulos.
 */
export type RamosDoCursor = {
  prazo: 'com-valor' | 'nulo';
  prioridade: 'com-valor' | 'nulo';
};

export function ramosDoCursor(cursor: ChaveDeOrdem): RamosDoCursor {
  return {
    prazo: cursor.dueOn === null ? 'nulo' : 'com-valor',
    prioridade: cursor.priority === null ? 'nulo' : 'com-valor',
  };
}

/* ───────────────────────────── o pedido ───────────────────────────── */

/** O que a rota pede ao servidor depois de conferir o endereço. */
export type PedidoDePagina = {
  aba: Aba;
  /** Nulo na primeira página. */
  cursor: CursorDoTrabalho | null;
  /** Já preso entre 1 e `LOTE_MAXIMO`. */
  limite: number;
};

export type PedidoLido =
  /** Sem `aba`: o contrato antigo, intacto. */
  | { ok: true; pedido: null }
  | { ok: true; pedido: PedidoDePagina }
  | { ok: false; status: 400; message: string };

/**
 * O tamanho do lote, lido do endereço. TOLERANTE, como `per-column` do quadro:
 * ausente, torto, zero ou negativo caem no padrão; acima do teto vira o teto.
 * Nunca devolve zero nem mais que `LOTE_MAXIMO` — não existe consulta sem limite.
 */
export function lerLimite(texto: string | null): number {
  if (texto === null || texto.trim() === '') return LOTE_PADRAO;
  const n = Number(texto);
  if (!Number.isFinite(n) || n < 1) return LOTE_PADRAO;
  return Math.min(LOTE_MAXIMO, Math.floor(n));
}

/**
 * Lê `aba`, `cursor` e `limite` do endereço e decide: contrato antigo, pedido
 * paginado, ou recusa.
 *
 * AS TRÊS DECISÕES, E POR QUE CADA UMA
 *   · Sem `aba` → contrato antigo (rede grossa, teto 500). `limite` sem `aba`
 *     é ignorado: o contrato antigo não tem lote. `cursor` sem `aba` é RECUSADO:
 *     ignorá-lo devolveria a primeira página de novo, e um consumidor que
 *     continua a partir do que recebeu entraria em laço.
 *   · `aba` fora das três → 400. Aqui não há "qualquer uma" que sirva, ao
 *     contrário de `?responsavel=eu`.
 *   · `cursor` que não confere → 400, ANTES de qualquer consulta. Um cursor de
 *     outra aba também: ele apontaria para o meio da aba nova.
 *
 * Nada aqui toca em quem está lendo. `userId` vem de `sessao.actor`, na rota.
 */
export function lerPedidoDePagina(endereco: {
  aba: string | null;
  cursor: string | null;
  limite: string | null;
}): PedidoLido {
  const { aba, cursor, limite } = endereco;

  if (aba === null) {
    if (cursor !== null) {
      return { ok: false, status: 400, message: 'Para continuar a leitura, informe a aba.' };
    }
    return { ok: true, pedido: null };
  }

  if (!ehAba(aba)) {
    return {
      ok: false,
      status: 400,
      message: `Aba desconhecida: "${aba}". Use pendente, feito ou delegado.`,
    };
  }

  let lido: CursorDoTrabalho | null = null;
  if (cursor !== null) {
    const r = decodificarCursor(cursor);
    if (!r.ok) {
      return {
        ok: false,
        status: 400,
        message: 'Não deu para continuar a leitura de onde parou. Recarregue a lista.',
      };
    }
    if (r.cursor.aba !== aba) {
      return {
        ok: false,
        status: 400,
        message: 'Esse ponto de continuação é de outra aba. Recarregue a lista.',
      };
    }
    lido = r.cursor;
  }

  return { ok: true, pedido: { aba, cursor: lido, limite: lerLimite(limite) } };
}

/* ───────────────────────────── a página ───────────────────────────── */

export type Pagina<T> = {
  rows: T[];
  /** Quantas vieram neste lote. NÃO é o total — o total vem da contagem. */
  returned: number;
  hasMore: boolean;
  /** Presente só quando `hasMore`. */
  nextCursor: string | null;
};

/**
 * Monta a página a partir do que a consulta devolveu.
 *
 * A consulta pede `limite + 1` linhas: a linha a mais NÃO vai para a tela — ela
 * só diz que existe continuação. É a alternativa a uma segunda consulta
 * "existe mais?" que custaria outra passada sob a política de linha.
 *
 * O próximo cursor é a chave da ÚLTIMA linha devolvida (a de posição `limite`),
 * e não a da linha a mais: a página seguinte começa depois do que a pessoa viu.
 */
export function montarPagina<T>(
  lidas: readonly { row: T; chave: ChaveDeOrdem }[],
  pedido: Pick<PedidoDePagina, 'aba' | 'limite'>,
): Pagina<T> {
  const hasMore = lidas.length > pedido.limite;
  const pagina = hasMore ? lidas.slice(0, pedido.limite) : [...lidas];
  const ultima = pagina.at(-1);
  return {
    rows: pagina.map((l) => l.row),
    returned: pagina.length,
    hasMore,
    nextCursor:
      hasMore && ultima !== undefined
        ? codificarCursor({ v: VERSAO_DO_CURSOR, aba: pedido.aba, ...ultima.chave })
        : null,
  };
}
