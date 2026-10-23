/**
 * O que as rotas de escrita que "levam um valor para tirar" aceitam no corpo —
 * revisão de segurança de 09/10/2026.
 *
 * O DEFEITO QUE ISTO FECHA
 *   As rotas de administração escreviam `body.areas ?? []`, `body.clientIds ?? []`,
 *   `body.ids ?? []`, `Boolean(body.ativo)` e `body.papel ?? 'funcionario'`. Na
 *   escrita o CAMPO QUE FALTA virava o valor mais destrutivo de todos:
 *
 *     PUT /admin/people/:id/active   {}        → DESATIVA a pessoa
 *     PUT /admin/people/:id/areas    {}        → tira TODAS as áreas
 *     PUT /admin/people/:id/clients  {}        → esvazia a carteira
 *     PUT /admin/people/:id/companies {}       → tira de TODAS as empresas
 *     PUT /admin/people/:id/role     {}        → rebaixa a funcionário
 *     PUT /board/access/:nivel/:id   {}        → ABRE o nó (tira a restrição)
 *
 *   O mesmo valia para JSON quebrado ou `null`, porque a leitura do corpo cai em
 *   `{}` quando não consegue ler. A tela sempre manda todos os campos; quem
 *   monta o pedido à mão, ou uma tela com defeito, não. Esvaziar É um pedido
 *   legítimo — `{ areas: [] }` —, mas tem de ser PEDIDO: ausência não é
 *   consentimento.
 *
 *   Vale também fora da administração, para quem trabalha: etiquetas do cliente
 *   (`{}` apagava todas), dono da conta da Meta (`{ clientId: "abc" }` desvinculava
 *   a conta), mãe da tarefa (`{}` soltava a subtarefa) e cliente da tarefa.
 *
 *   A conferência de quem pode fazer cada coisa continua sendo do banco; isto só
 *   barra o pedido que não diz o que quer, com a frase que diz o que mandar.
 */

import { AREAS } from '@/auth/areas';
import { PAPEIS, type Papel } from '@/auth/papeis';

export type Entrada<T> = { ok: true; valor: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const recusa = (message: string): { ok: false; message: string } => ({ ok: false, message });

/** Corpo que é um objeto — `null`, lista e texto não são. */
function objeto(corpo: unknown): Record<string, unknown> | null {
  return corpo !== null && typeof corpo === 'object' && !Array.isArray(corpo)
    ? (corpo as Record<string, unknown>)
    : null;
}

function listaDeIds(valor: unknown, campo: string, quem: string): Entrada<string[]> {
  if (!Array.isArray(valor) || !valor.every((v) => typeof v === 'string' && UUID.test(v))) {
    return recusa(
      `Diga ${quem} em \`${campo}\`: uma lista de identificadores (vazia, se é para esvaziar).`,
    );
  }
  return { ok: true, valor: valor as string[] };
}

export function lerCarteiraPedida(corpo: unknown): Entrada<string[]> {
  return listaDeIds(objeto(corpo)?.clientIds, 'clientIds', 'os clientes da carteira');
}

export function lerEmpresasPedidas(corpo: unknown): Entrada<string[]> {
  return listaDeIds(objeto(corpo)?.ids, 'ids', 'as empresas da pessoa');
}

export function lerAreasPedidas(corpo: unknown): Entrada<string[]> {
  const areas = objeto(corpo)?.areas;
  if (!Array.isArray(areas) || !areas.every((a) => (AREAS as readonly unknown[]).includes(a))) {
    return recusa(
      `Diga as áreas em \`areas\`: uma lista com ${AREAS.join(', ')} (vazia, se é para tirar todas).`,
    );
  }
  return { ok: true, valor: areas as string[] };
}

export function lerPapelPedido(
  corpo: unknown,
): Entrada<{ papel: Papel; todosOsClientes: boolean }> {
  const c = objeto(corpo);
  if (!c || !(PAPEIS as readonly unknown[]).includes(c.papel)) {
    return recusa(`Diga o papel em \`papel\`: ${PAPEIS.join(', ')}.`);
  }
  if (typeof c.todosOsClientes !== 'boolean') {
    return recusa('Diga se a pessoa alcança todos os clientes (`todosOsClientes`: verdadeiro ou falso).');
  }
  return { ok: true, valor: { papel: c.papel as Papel, todosOsClientes: c.todosOsClientes } };
}

export function lerAtivoPedido(corpo: unknown): Entrada<boolean> {
  const ativo = objeto(corpo)?.ativo;
  return typeof ativo === 'boolean'
    ? { ok: true, valor: ativo }
    : recusa('Diga se a pessoa fica ativa (`ativo`: verdadeiro ou falso).');
}

export function lerAcessoPedido(
  corpo: unknown,
): Entrada<{ restricted: boolean; grants: { userId: string; level?: unknown }[] }> {
  const c = objeto(corpo);
  if (!c || typeof c.restricted !== 'boolean' || !Array.isArray(c.grants)) {
    return recusa(
      'Diga se o nó fica restrito (`restricted`) e a lista de quem alcança (`grants`, vazia se ninguém).',
    );
  }
  const concessoes: { userId: string; level?: unknown }[] = [];
  for (const g of c.grants) {
    const item = objeto(g);
    if (!item || typeof item.userId !== 'string' || !UUID.test(item.userId)) {
      return recusa('Cada pessoa da lista de acesso precisa de um `userId` válido.');
    }
    concessoes.push({ userId: item.userId, level: item.level });
  }
  return { ok: true, valor: { restricted: c.restricted, grants: concessoes } };
}

export function lerEtiquetasPedidas(corpo: unknown): Entrada<string[]> {
  return listaDeIds(objeto(corpo)?.tagIds, 'tagIds', 'as etiquetas do cliente');
}

/** `null` desvincula — mas dito, e não por falta de campo ou por texto que não é id. */
export function lerDonoDaConta(corpo: unknown): Entrada<string | null> {
  const c = objeto(corpo);
  if (c && c.clientId === null) return { ok: true, valor: null };
  if (c && typeof c.clientId === 'string' && UUID.test(c.clientId)) {
    return { ok: true, valor: c.clientId };
  }
  return recusa('Diga o cliente em `clientId` (um identificador, ou null para desvincular a conta).');
}

export function lerMaePedida(corpo: unknown): Entrada<string> {
  const mae = objeto(corpo)?.parentId;
  return typeof mae === 'string' && UUID.test(mae)
    ? { ok: true, valor: mae }
    : recusa('Diga a tarefa-mãe em `parentId`. Para soltar a subtarefa, use DELETE.');
}

/** `null` (ou texto vazio) é "o da lista"/"sem cliente" — dito, e não por falta do campo. */
export function lerClienteDaTarefa(corpo: unknown): Entrada<string | null> {
  const c = objeto(corpo);
  if (c && (c.clientId === null || c.clientId === '')) return { ok: true, valor: null };
  if (c && typeof c.clientId === 'string' && UUID.test(c.clientId)) {
    return { ok: true, valor: c.clientId };
  }
  return recusa('Diga o cliente em `clientId` (um identificador, ou null para tirar o cliente).');
}
