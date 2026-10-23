/**
 * A CONFIGURAÇÃO DA APROVAÇÃO DO CLIENTE — F42, Fase 3.
 *
 * O QUE ESTE ARQUIVO FAZ
 *   - liga e desliga a aprovação externa de um cliente (`clients.approval_enabled`);
 *   - gera o link fixo do cliente (revoga o vivo e cria outro NA MESMA
 *     transação), revoga sem gerar, e devolve o texto cifrado para "copiar link";
 *   - lê e grava os três destinos da esteira de uma lista (aguardando cliente,
 *     aprovado, reprovado) em `status_set_approval_targets`;
 *   - resolve um token da rota pública (sem pessoa: ator `preauth`).
 *
 * SÓ ADMIN, DOS DOIS LADOS
 *   Toda rota interna daqui recusa com 403 quem não administra
 *   (`actor.isSuperadmin`), ANTES de abrir transação. O banco recusa do mesmo
 *   jeito (políticas `acting_is_superadmin()` das migrations da Fase 1): a
 *   checagem aqui só dá a frase certa sem ida ao banco.
 *
 *   "E quem enxerga o cliente": a leitura do cliente passa pela política
 *   `clients_select` (`can_see_client`); fora do alcance responde 404, igual a
 *   inexistente — a mesma regra de `client-write.ts`.
 *
 * A ESTEIRA É A DA LISTA, RESOLVIDA
 *   A tela abre a configuração a partir de uma lista; a esteira que vale é a
 *   resolvida (lista → pasta → espaço, `ideworks.resolve_status_set`). Gravar
 *   ali vale para TODAS as listas que usam aquela esteira — a resposta diz de
 *   onde a esteira vem para a tela avisar.
 */

import { type Sql, type Tx, withActor } from '@/server/db';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export const FRASE_SO_ADMIN = 'Só administrador configura a aprovação do cliente.';
export const FRASE_CLIENTE_NAO_ENCONTRADO = 'Cliente não encontrado.';
export const FRASE_LISTA_NAO_ENCONTRADA = 'Lista não encontrada, ou fora do seu alcance.';
export const FRASE_SEM_LINK = 'Este cliente ainda não tem link. Gere um link primeiro.';
export const FRASE_DESTINOS_REPETIDOS =
  '"Aguardando cliente" precisa ser uma etapa diferente de "aprovado" e de "reprovado" — senão o card não anda quando o cliente responde.';

/** Recusa da configuração, com o status HTTP certo e a frase para a tela. */
export class AprovacaoRecusada extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = 'AprovacaoRecusada';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigirAdmin(actor: AuthenticatedActor): void {
  if (!actor.isSuperadmin) throw new AprovacaoRecusada(FRASE_SO_ADMIN, 403);
}

/** Erro do Postgres em frase: IW042 traz a dele; 42501 é permissão. */
function traduzir(erro: unknown): never {
  if (erro instanceof AprovacaoRecusada) throw erro;
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  if (e.code === 'IW042') throw new AprovacaoRecusada((e.message ?? '').split('\n')[0], 409);
  if (e.code === '42501') throw new AprovacaoRecusada(FRASE_SO_ADMIN, 403);
  if (e.code === '23505' && e.constraint_name === 'client_approval_links_one_live') {
    throw new AprovacaoRecusada('Outro link acabou de ser gerado para este cliente. Recarregue a ficha.', 409);
  }
  throw erro;
}

/* ─────────────────────────── o cliente e o link ─────────────────────────── */

export type AprovacaoDoCliente = {
  clientId: string;
  enabled: boolean;
  /** O cliente está ativo? Inativo: o link não resolve, mesmo ligado. */
  active: boolean;
  /** O link vivo, sem o token (copiar é outra rota). */
  link: { createdAt: string } | null;
};

const comoData = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

async function lerNoTx(tx: Tx, clientId: string): Promise<AprovacaoDoCliente> {
  const [cliente] = await tx`
    select c.id, c.approval_enabled, c.is_active
      from ideworks.clients c
     where c.id = ${clientId}::uuid`;
  if (!cliente) throw new AprovacaoRecusada(FRASE_CLIENTE_NAO_ENCONTRADO, 404);
  const [vivo] = await tx`
    select l.created_at
      from ideworks.client_approval_links l
     where l.client_id = ${clientId}::uuid and l.revoked_at is null`;
  return {
    clientId,
    enabled: cliente.approval_enabled === true,
    active: cliente.is_active === true,
    link: vivo ? { createdAt: comoData(vivo.created_at) } : null,
  };
}

function exigirCliente(clientId: string): void {
  if (!UUID.test(clientId)) throw new AprovacaoRecusada(FRASE_CLIENTE_NAO_ENCONTRADO, 404);
}

export async function lerAprovacaoDoCliente(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
): Promise<AprovacaoDoCliente> {
  exigirAdmin(actor);
  exigirCliente(clientId);
  return withActor(sql, asDbActor(actor), (tx) => lerNoTx(tx, clientId));
}

/** Liga ou desliga. Desligar NÃO revoga o link: ele volta a valer ao religar. */
export async function ligarAprovacao(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  enabled: boolean,
): Promise<AprovacaoDoCliente> {
  exigirAdmin(actor);
  exigirCliente(clientId);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const mudou = await tx`
        update ideworks.clients set approval_enabled = ${enabled}
         where id = ${clientId}::uuid
        returning id`;
      if (mudou.length === 0) throw new AprovacaoRecusada(FRASE_CLIENTE_NAO_ENCONTRADO, 404);
      return await lerNoTx(tx, clientId);
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/**
 * Gera o link novo. `preparar(clientId)` recebe o id e devolve o token cru, o
 * hash e o texto cifrado — quem cifra é o Worker (a chave mora no ambiente dele).
 *
 * NUMA TRANSAÇÃO: trava a linha do cliente, revoga o link vivo e cria o novo.
 * Dois "gerar" ao mesmo tempo: o segundo espera o primeiro e revoga o dele —
 * fica UM vivo, sempre o último.
 */
export async function gerarLinkDoCliente(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  preparar: () => Promise<{ token: string; hash: string; cifrado: string }>,
): Promise<{ token: string; createdAt: string; revoked: number }> {
  exigirAdmin(actor);
  exigirCliente(clientId);
  const novo = await preparar();
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [cliente] = await tx`
        select c.id from ideworks.clients c where c.id = ${clientId}::uuid for update`;
      if (!cliente) throw new AprovacaoRecusada(FRASE_CLIENTE_NAO_ENCONTRADO, 404);
      const revogados = await tx`
        update ideworks.client_approval_links
           set revoked_at = now(), revoked_by = ${actor.userId}::uuid
         where client_id = ${clientId}::uuid and revoked_at is null
        returning id`;
      const [criado] = await tx`
        insert into ideworks.client_approval_links (client_id, token_hash, token_ciphertext, created_by)
        values (${clientId}::uuid, ${novo.hash}, ${novo.cifrado}, ${actor.userId}::uuid)
        returning created_at`;
      return { token: novo.token, createdAt: comoData(criado.created_at), revoked: revogados.length };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/** Revoga o link vivo, sem criar outro. O cliente fica sem link até gerar de novo. */
export async function revogarLinkDoCliente(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
): Promise<{ revoked: number }> {
  exigirAdmin(actor);
  exigirCliente(clientId);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [cliente] = await tx`select c.id from ideworks.clients c where c.id = ${clientId}::uuid`;
      if (!cliente) throw new AprovacaoRecusada(FRASE_CLIENTE_NAO_ENCONTRADO, 404);
      const revogados = await tx`
        update ideworks.client_approval_links
           set revoked_at = now(), revoked_by = ${actor.userId}::uuid
         where client_id = ${clientId}::uuid and revoked_at is null
        returning id`;
      return { revoked: revogados.length };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/** O texto cifrado do link vivo, para o Worker decifrar e devolver a URL. */
export async function lerCifraDoLink(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
): Promise<{ cifrado: string; createdAt: string }> {
  exigirAdmin(actor);
  exigirCliente(clientId);
  return withActor(sql, asDbActor(actor), async (tx) => {
    const [cliente] = await tx`select c.id from ideworks.clients c where c.id = ${clientId}::uuid`;
    if (!cliente) throw new AprovacaoRecusada(FRASE_CLIENTE_NAO_ENCONTRADO, 404);
    const [vivo] = await tx`
      select l.token_ciphertext, l.created_at
        from ideworks.client_approval_links l
       where l.client_id = ${clientId}::uuid and l.revoked_at is null`;
    if (!vivo) throw new AprovacaoRecusada(FRASE_SEM_LINK, 404);
    return { cifrado: String(vivo.token_ciphertext), createdAt: comoData(vivo.created_at) };
  });
}

/* ─────────────────────────── a rota pública ─────────────────────────── */

/**
 * O cliente do link VIVO (de cliente ligado e ativo), pelo hash — ou `null`.
 * Sem pessoa: ator `preauth`. `resolve_approval_link` é `security definer` e
 * devolve só o id.
 */
export async function resolverLinkPublico(sql: Sql, hash: string): Promise<string | null> {
  return withActor(sql, { kind: 'preauth' }, async (tx) => {
    const [r] = await tx`select ideworks.resolve_approval_link(${hash}) as client_id`;
    return r?.client_id ? String(r.client_id) : null;
  });
}

/* ─────────────────────────── os destinos da esteira ─────────────────────────── */

export type EtapaDaEsteira = { id: string; name: string; type: string; color: string | null };

export type Destinos = {
  awaitingStatusId: string | null;
  approvedStatusId: string | null;
  rejectedStatusId: string | null;
};

export type DestinosDaEsteira = {
  listId: string;
  statusSetId: string;
  statusSetName: string;
  /** De onde a esteira vem: própria da lista, herdada da pasta ou do espaço. */
  inheritedFrom: 'list' | 'folder' | 'space';
  statuses: EtapaDaEsteira[];
  targets: Destinos;
  /** Os três destinos preenchidos (e ainda etapas desta esteira). */
  complete: boolean;
};

const DESTINOS_VAZIOS: Destinos = { awaitingStatusId: null, approvedStatusId: null, rejectedStatusId: null };

const destinosCompletos = (d: Destinos) =>
  d.awaitingStatusId !== null && d.approvedStatusId !== null && d.rejectedStatusId !== null;

async function lerDestinosNoTx(tx: Tx, listId: string): Promise<DestinosDaEsteira> {
  const [resolvida] = await tx`select ideworks.resolve_status_set(${listId}::uuid) as set_id`;
  const setId = resolvida?.set_id ? String(resolvida.set_id) : null;
  if (!setId) throw new AprovacaoRecusada(FRASE_LISTA_NAO_ENCONTRADA, 404);
  const [esteira] = await tx`
    select ss.id, ss.name,
           case when ss.list_id is not null then 'list'
                when ss.folder_id is not null then 'folder'
                else 'space' end as origem
      from ideworks.status_sets ss
     where ss.id = ${setId}::uuid`;
  if (!esteira) throw new AprovacaoRecusada(FRASE_LISTA_NAO_ENCONTRADA, 404);
  const etapas = await tx`
    select s.id, s.name, s.type::text as type, s.color
      from ideworks.statuses s
     where s.status_set_id = ${setId}::uuid
     order by s.sort_order, s.name, s.id`;
  const [alvos] = await tx`
    select awaiting_status_id, approved_status_id, rejected_status_id
      from ideworks.approval_targets_for(${setId}::uuid)`;
  const targets: Destinos = alvos
    ? {
        awaitingStatusId: alvos.awaiting_status_id ? String(alvos.awaiting_status_id) : null,
        approvedStatusId: alvos.approved_status_id ? String(alvos.approved_status_id) : null,
        rejectedStatusId: alvos.rejected_status_id ? String(alvos.rejected_status_id) : null,
      }
    : DESTINOS_VAZIOS;
  return {
    listId,
    statusSetId: setId,
    statusSetName: String(esteira.name),
    inheritedFrom: esteira.origem as DestinosDaEsteira['inheritedFrom'],
    statuses: etapas.map((s) => ({
      id: String(s.id),
      name: String(s.name),
      type: String(s.type),
      color: s.color == null ? null : String(s.color),
    })),
    targets,
    complete: destinosCompletos(targets),
  };
}

function exigirLista(listId: string): void {
  if (!UUID.test(listId)) throw new AprovacaoRecusada(FRASE_LISTA_NAO_ENCONTRADA, 404);
}

export async function lerDestinosDaLista(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
): Promise<DestinosDaEsteira> {
  exigirAdmin(actor);
  exigirLista(listId);
  return withActor(sql, asDbActor(actor), (tx) => lerDestinosNoTx(tx, listId));
}

/** Confere o corpo: cada destino é um uuid ou nulo; "aguardando" não repete os outros. */
export function lerEntradaDosDestinos(corpo: unknown): Destinos {
  const b = (corpo ?? {}) as Record<string, unknown>;
  const um = (v: unknown, rotulo: string): string | null => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v !== 'string' || !UUID.test(v)) {
      throw new AprovacaoRecusada(`A etapa de "${rotulo}" não é válida. Escolha na lista desta esteira.`, 400);
    }
    return v.toLowerCase();
  };
  const d: Destinos = {
    awaitingStatusId: um(b.awaitingStatusId, 'aguardando cliente'),
    approvedStatusId: um(b.approvedStatusId, 'aprovado'),
    rejectedStatusId: um(b.rejectedStatusId, 'reprovado'),
  };
  if (
    d.awaitingStatusId !== null &&
    (d.awaitingStatusId === d.approvedStatusId || d.awaitingStatusId === d.rejectedStatusId)
  ) {
    throw new AprovacaoRecusada(FRASE_DESTINOS_REPETIDOS, 400);
  }
  return d;
}

/**
 * Grava os três destinos da esteira resolvida da lista. Etapa de outra esteira
 * é recusada pelo gatilho do banco (IW042 `target_outside_status_set`) e a
 * frase dele chega inteira à tela.
 */
export async function gravarDestinosDaLista(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
  destinos: Destinos,
): Promise<DestinosDaEsteira> {
  exigirAdmin(actor);
  exigirLista(listId);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [resolvida] = await tx`select ideworks.resolve_status_set(${listId}::uuid) as set_id`;
      const setId = resolvida?.set_id ? String(resolvida.set_id) : null;
      if (!setId) throw new AprovacaoRecusada(FRASE_LISTA_NAO_ENCONTRADA, 404);
      await tx`
        insert into ideworks.status_set_approval_targets
          (status_set_id, awaiting_status_id, approved_status_id, rejected_status_id, updated_by)
        values (${setId}::uuid, ${destinos.awaitingStatusId}::uuid, ${destinos.approvedStatusId}::uuid,
                ${destinos.rejectedStatusId}::uuid, ${actor.userId}::uuid)
        on conflict (status_set_id) do update
          set awaiting_status_id = excluded.awaiting_status_id,
              approved_status_id = excluded.approved_status_id,
              rejected_status_id = excluded.rejected_status_id,
              updated_by = excluded.updated_by`;
      return await lerDestinosNoTx(tx, listId);
    } catch (erro) {
      traduzir(erro);
    }
  });
}
