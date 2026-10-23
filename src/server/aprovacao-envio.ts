/**
 * "SOLICITAR APROVAÇÃO" NO CARD — F42, Fase 4.
 *
 * O QUE ESTE ARQUIVO FAZ
 *   - lê, para a ficha do card, tudo o que a seção de aprovação precisa numa
 *     ida só: o cliente do card e se a aprovação dele está ligada, se a esteira
 *     tem os três destinos (e quais faltam), as rodadas já enviadas e quem pode
 *     configurar e copiar o link;
 *   - envia a chamada: confere os links (só Dropbox, na ordem) e chama
 *     `ideworks.create_approval_round`, que faz o resto numa transação (alcance,
 *     cliente ligado, destinos, substitui a aberta, versão seguinte, legenda
 *     copiada, card para "aguardando cliente").
 *
 * QUEM PODE: quem pode EXECUTAR no card (a função confere `can_act_on_task_id`
 * e o alcance ao cliente). Não é só admin — é a equipe que produz que envia.
 *
 * SEM API DO DROPBOX: o Worker não consulta o Dropbox (decisão de 07/10). Ver
 * `@/server/material-de-aprovacao`.
 */

import { AprovacaoRecusada } from '@/server/aprovacao-config';
import {
  type ArmazenamentoPrivado,
  apagarObjetosDoBalde,
  copiarObjetoNoBalde,
  exigirChaveDoBalde,
} from '@/server/board-anexos';
import { comoJson, type Sql, type Tx, withActor } from '@/server/db';
import {
  type EntradaDoMaterial,
  type EstadoDaRodada,
  type MaterialPedido,
  type TipoDoItem,
  FRASE_MATERIAL_TORTO,
  anexoServeDeArte,
  caminhoDaCopia,
  conferirMateriais,
  fraseDoAnexoDeOutroCard,
  fraseDoAnexoNaoEncontrado,
  fraseDoAnexoQueNaoEImagem,
  fraseDoAnexoTemporario,
} from '@/server/material-de-aprovacao';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export const FRASE_TAREFA_NAO_ENCONTRADA = 'Tarefa não encontrada, ou fora do seu alcance.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Um item enviado, como a equipe o vê. F42, Fase 9: o item é LINK do Dropbox
 * (`source: 'dropbox'`, `url` preenchido) ou ARTE ANEXADA (`source: 'anexo'`,
 * `url` nulo). O caminho da cópia no balde NUNCA sai daqui.
 */
export type ItemDaRodada = {
  position: number;
  url: string | null;
  kind: TipoDoItem;
  fileName: string;
  source: 'dropbox' | 'anexo';
};

export type RodadaDoCard = {
  id: string;
  version: number;
  state: EstadoDaRodada;
  sentAt: string;
  sentBy: string | null;
  decidedAt: string | null;
  /**
   * F42, Fase 7 — como foi decidida. Hoje só existe `client_link` (o cliente
   * pelo link); nulo enquanto aberta e nos estados sem decisão.
   */
  decidedVia: 'client_link' | null;
  /** O que o cliente escreveu ao decidir — o motivo do pedido de ajustes. */
  decisionComment: string | null;
  closedAt: string | null;
  items: ItemDaRodada[];
};

export type AprovacaoDoCard = {
  taskId: string;
  listId: string | null;
  /** O cliente do PRÓPRIO card (`tasks.client_id`), o mesmo que o envio usa. */
  clientId: string | null;
  clientName: string | null;
  /** A aprovação externa está ligada para o cliente (e ele está ativo)? */
  enabled: boolean;
  /** A esteira do card tem as três etapas? */
  configured: boolean;
  /** O que falta na esteira, em português: "aguardando cliente", "aprovado", "reprovado". */
  missing: string[];
  awaitingStatusName: string | null;
  /** Quem administra configura a esteira e liga o cliente. */
  canConfigure: boolean;
  /** Copiar o link do cliente é rota de admin (Fase 3). */
  canCopyLink: boolean;
  /** Mais recente primeiro. */
  rounds: RodadaDoCard[];
};

const comoData = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const ouNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function exigirTarefa(taskId: string): void {
  if (!UUID.test(taskId)) throw new AprovacaoRecusada(FRASE_TAREFA_NAO_ENCONTRADA, 404);
}

async function lerNoTx(tx: Tx, actor: AuthenticatedActor, taskId: string): Promise<AprovacaoDoCard> {
  const [tarefa] = await tx`
    select t.id, t.list_id, t.client_id
      from ideworks.tasks t
     where t.id = ${taskId}::uuid`;
  if (!tarefa) throw new AprovacaoRecusada(FRASE_TAREFA_NAO_ENCONTRADA, 404);
  const clientId = ouNulo(tarefa.client_id);
  const listId = ouNulo(tarefa.list_id);

  let clientName: string | null = null;
  let enabled = false;
  if (clientId !== null) {
    const [cliente] = await tx`
      select c.name, c.approval_enabled, c.is_active
        from ideworks.clients c
       where c.id = ${clientId}::uuid`;
    clientName = cliente ? String(cliente.name) : null;
    enabled = cliente?.approval_enabled === true && cliente?.is_active === true;
  }

  let awaiting: string | null = null;
  let approved: string | null = null;
  let rejected: string | null = null;
  let awaitingStatusName: string | null = null;
  if (listId !== null) {
    const [resolvida] = await tx`select ideworks.resolve_status_set(${listId}::uuid) as set_id`;
    const setId = ouNulo(resolvida?.set_id);
    if (setId !== null) {
      const [alvos] = await tx`
        select a.awaiting_status_id, a.approved_status_id, a.rejected_status_id,
               (select s.name from ideworks.statuses s where s.id = a.awaiting_status_id) as awaiting_name
          from ideworks.approval_targets_for(${setId}::uuid) a`;
      awaiting = ouNulo(alvos?.awaiting_status_id);
      approved = ouNulo(alvos?.approved_status_id);
      rejected = ouNulo(alvos?.rejected_status_id);
      awaitingStatusName = ouNulo(alvos?.awaiting_name);
    }
  }
  const missing = [
    awaiting === null ? 'aguardando cliente' : null,
    approved === null ? 'aprovado' : null,
    rejected === null ? 'reprovado' : null,
  ].filter((x): x is string => x !== null);

  const rodadas = await tx`
    select r.id, r.version, r.state::text as state, r.sent_at, r.decided_at, r.closed_at,
           r.decided_via::text as decided_via,
           dc.body as decision_body,
           ideworks.display_name(r.sent_by) as sent_by_name
      from ideworks.approval_rounds r
      left join ideworks.task_comments dc on dc.id = r.decision_comment_id
     where r.task_id = ${taskId}::uuid
     order by r.version desc`;
  const ids = rodadas.map((r) => String(r.id));
  const itens =
    ids.length === 0
      ? []
      : await tx`
          select i.round_id, i.position, i.dropbox_url, i.kind::text as kind, i.file_name,
                 (i.storage_path is not null) as is_attachment
            from ideworks.approval_round_items i
           where i.round_id = any(${ids}::uuid[])
           order by i.round_id, i.position`;

  return {
    taskId,
    listId,
    clientId,
    clientName,
    enabled,
    configured: missing.length === 0,
    missing,
    awaitingStatusName,
    canConfigure: actor.isSuperadmin,
    canCopyLink: actor.isSuperadmin,
    rounds: rodadas.map((r) => ({
      id: String(r.id),
      version: Number(r.version),
      state: String(r.state) as EstadoDaRodada,
      sentAt: comoData(r.sent_at),
      sentBy: ouNulo(r.sent_by_name),
      decidedAt: r.decided_at ? comoData(r.decided_at) : null,
      decidedVia: r.decided_via === 'client_link' ? 'client_link' : null,
      decisionComment: ouNulo(r.decision_body),
      closedAt: r.closed_at ? comoData(r.closed_at) : null,
      items: itens
        .filter((i) => String(i.round_id) === String(r.id))
        .map((i) => ({
          position: Number(i.position),
          url: i.is_attachment === true ? null : ouNulo(i.dropbox_url),
          kind: String(i.kind) as TipoDoItem,
          fileName: String(i.file_name),
          source: i.is_attachment === true ? ('anexo' as const) : ('dropbox' as const),
        })),
    })),
  };
}

export async function lerAprovacaoDoCard(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
): Promise<AprovacaoDoCard> {
  exigirTarefa(taskId);
  return withActor(sql, asDbActor(actor), (tx) => lerNoTx(tx, actor, taskId));
}

/**
 * O corpo do envio, na ordem do carrossel:
 *   `{ materiais: [{ link } | { anexo }] }` — F42, Fase 9;
 *   `{ links: string[] }` — a forma da Fase 4, continua aceita (só link).
 * 400 com a frase da PRIMEIRA recusa; nada vai ao banco nem ao balde.
 */
export function lerEntradaDoEnvio(corpo: unknown): MaterialPedido[] {
  const c = corpo as { links?: unknown; materiais?: unknown } | null;
  let entradas: EntradaDoMaterial[];
  if (c && Array.isArray(c.materiais)) {
    const torto = c.materiais.some(
      (m) =>
        m === null ||
        typeof m !== 'object' ||
        ('link' in m) === ('anexo' in m) ||
        ('link' in m && typeof (m as { link: unknown }).link !== 'string') ||
        ('anexo' in m && typeof (m as { anexo: unknown }).anexo !== 'string'),
    );
    if (torto) throw new AprovacaoRecusada(FRASE_MATERIAL_TORTO, 400);
    entradas = c.materiais as EntradaDoMaterial[];
  } else if (c && Array.isArray(c.links) && c.links.every((l) => typeof l === 'string')) {
    entradas = (c.links as string[]).map((link) => ({ link }));
  } else {
    throw new AprovacaoRecusada('Mande a lista de materiais (links do Dropbox ou anexos do card), na ordem do carrossel.', 400);
  }
  const conferido = conferirMateriais(entradas);
  if (!conferido.ok) throw new AprovacaoRecusada(conferido.frase, 400);
  return conferido.pedidos;
}

type AnexoConferido = { posicao: number; anexoId: string; origem: string; fileName: string };

/**
 * Os anexos pedidos, conferidos SOB O ATOR: a política de `task_attachments`
 * recorta pelo alcance, então "não existe" e "não é seu" respondem igual. Do
 * card? Permanente? Imagem? Cada recusa diz qual material e por quê.
 */
async function conferirAnexos(
  tx: Tx,
  taskId: string,
  pedidos: readonly MaterialPedido[],
): Promise<AnexoConferido[]> {
  const ids = pedidos.flatMap((p) => (p.tipo === 'anexo' ? [p.anexoId] : []));
  if (ids.length === 0) return [];
  const linhas = await tx`
    select a.id, a.task_id, a.file_name, a.content_type, a.storage_path, a.expires_at
      from ideworks.task_attachments a
     where a.id = any(${ids}::uuid[])`;
  const porId = new Map(linhas.map((l) => [String(l.id).toLowerCase(), l]));
  const saida: AnexoConferido[] = [];
  for (const [i, p] of pedidos.entries()) {
    if (p.tipo !== 'anexo') continue;
    const posicao = i + 1;
    const a = porId.get(p.anexoId);
    if (!a) throw new AprovacaoRecusada(fraseDoAnexoNaoEncontrado(posicao), 400);
    const nome = String(a.file_name);
    if (String(a.task_id).toLowerCase() !== taskId) throw new AprovacaoRecusada(fraseDoAnexoDeOutroCard(posicao, nome), 400);
    if (a.expires_at) throw new AprovacaoRecusada(fraseDoAnexoTemporario(posicao, nome), 400);
    if (!anexoServeDeArte({ contentType: ouNulo(a.content_type), fileName: nome })) {
      throw new AprovacaoRecusada(fraseDoAnexoQueNaoEImagem(posicao, nome), 400);
    }
    saida.push({ posicao, anexoId: p.anexoId, origem: String(a.storage_path), fileName: nome });
  }
  return saida;
}

/**
 * Envia a chamada. A função do banco faz tudo numa transação; a recusa dela
 * (IW042) chega com a frase dela em 409; fora do alcance é 404.
 *
 * COM ARTE ANEXADA (F42, Fase 9), A ORDEM É: conferir → copiar → gravar.
 *   1. Os anexos são conferidos sob o ator (do card, permanentes, imagem).
 *   2. O Worker sorteia o id da rodada e COPIA cada anexo para
 *      `aprovacoes/<rodada>/<ordem>-<nome-seguro>` no mesmo balde privado. Se
 *      uma cópia falha, as já feitas são apagadas e NADA é gravado (502).
 *   3. `create_approval_round(task, itens, rodada)` grava. Se recusar, as
 *      cópias são apagadas e a recusa sobe como sempre.
 *   A cópia fica FORA da transação: não se segura uma trava no card durante
 *   idas ao Storage. Só link: nenhuma ida ao balde, nem a chave é exigida.
 */
export async function enviarParaAprovacao(
  sql: Sql,
  actor: AuthenticatedActor,
  armazenamento: ArmazenamentoPrivado,
  taskId: string,
  pedidos: readonly MaterialPedido[],
): Promise<{ roundId: string; version: number; superseded: number; approval: AprovacaoDoCard }> {
  exigirTarefa(taskId);
  const temAnexo = pedidos.some((p) => p.tipo === 'anexo');
  if (temAnexo) exigirChaveDoBalde(armazenamento);

  const anexos = temAnexo
    ? await withActor(sql, asDbActor(actor), async (tx) => {
        const [t] = await tx`select t.id from ideworks.tasks t where t.id = ${taskId}::uuid`;
        if (!t) throw new AprovacaoRecusada(FRASE_TAREFA_NAO_ENCONTRADA, 404);
        return conferirAnexos(tx, taskId, pedidos);
      })
    : [];

  const roundId = temAnexo ? crypto.randomUUID() : null;
  const copias: string[] = [];
  const caminhoPorPosicao = new Map<number, string>();
  if (roundId !== null) {
    try {
      for (const a of anexos) {
        const destino = caminhoDaCopia(roundId, a.posicao, a.fileName);
        await copiarObjetoNoBalde(armazenamento, a.origem, destino);
        copias.push(destino);
        caminhoPorPosicao.set(a.posicao, destino);
      }
    } catch (erro) {
      await apagarObjetosDoBalde(armazenamento, copias).catch(() => undefined);
      throw erro;
    }
  }

  const itens = pedidos.map((p, i) =>
    p.tipo === 'link'
      ? p.item
      : { attachment_id: p.anexoId, storage_path: caminhoPorPosicao.get(i + 1) as string },
  );

  try {
    return await withActor(sql, asDbActor(actor), async (tx) => {
      let r: { round_id: string; version: number; superseded: number };
      try {
        const [linha] = await tx`
          select ideworks.create_approval_round(${taskId}::uuid, ${comoJson(tx, itens)}::jsonb, ${roundId}::uuid) as r`;
        r = linha.r as typeof r;
      } catch (erro) {
        const e = erro as { code?: string; message?: string; hint?: string };
        if (e.code === 'IW042') throw new AprovacaoRecusada(frase(e.hint, e.message), 409);
        if (e.code === '42501') throw new AprovacaoRecusada(FRASE_TAREFA_NAO_ENCONTRADA, 404);
        throw erro;
      }
      return {
        roundId: String(r.round_id),
        version: Number(r.version),
        superseded: Number(r.superseded),
        approval: await lerNoTx(tx, actor, taskId),
      };
    });
  } catch (erro) {
    // A compensação: a gravação não aconteceu, as cópias não podem ficar.
    if (copias.length > 0) await apagarObjetosDoBalde(armazenamento, copias).catch(() => undefined);
    throw erro;
  }
}

/**
 * As frases do banco saem sem acento (o arquivo SQL é ASCII). Pela `hint` da
 * recusa, a tela recebe a frase escrita direito; a desconhecida passa como veio.
 */
export const FRASES_DO_ENVIO: Record<string, string> = {
  task_without_client: 'Este card não tem cliente: a aprovação externa é por cliente.',
  approval_disabled: 'A aprovação externa não está ligada para este cliente.',
  approval_not_configured:
    'A esteira deste card ainda não tem as três etapas da aprovação do cliente (aguardando, aprovado, reprovado). Configure a esteira antes de enviar.',
  no_items: 'Escolha ao menos um material para enviar.',
  item_invalid: 'Cada material é um link do Dropbox ou um anexo do card, na ordem do carrossel.',
  attachment_invalid:
    'Um dos anexos escolhidos não pode ir ao cliente: só imagem (png, jpg, webp ou gif) anexada a este card, que não seja temporária. Feche a janela e escolha de novo.',
};

function frase(hint: string | undefined, mensagem: string | undefined): string {
  return (hint && FRASES_DO_ENVIO[hint]) || (mensagem ?? '').split('\n')[0];
}
