/**
 * O mapa de conexões da Meta — etapa F7.
 *
 * NÃO HÁ TOKEN AQUI, E ISSO É O DESENHO
 *   Há **um** System User na BM do Grupo Ideal, com acesso de parceiro às BMs
 *   dos clientes. Um token, para toda a carteira — então ele é segredo do
 *   Worker, não linha de tabela. O que este módulo lê e escreve é só o mapa:
 *   quais contas pertencem a qual cliente.
 *
 *   Identificador de conta de anúncio não é segredo: é o que aparece na URL do
 *   Gerenciador.
 *
 * LER É DE QUEM ENXERGA O CLIENTE; ESCREVER É DE ADMINISTRADOR
 *   Conectar a conta de um cliente é ato de configuração, e o erro aqui coleta
 *   dado da conta errada — que é pior que não coletar, porque parece certo.
 */

import {
  type Ativo,
  type TipoDeAtivo,
  ehTipoDeAtivo,
  normalizarIdentificador,
} from '@/meta/ativos';
import { type Sql, withActor } from '@/server/db';
import { contaDaMetaForaDasOmitidas, recorteDasOmitidas } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export class ConexaoRefused extends Error {
  readonly status: 400 | 403 | 404 | 409;

  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = 'ConexaoRefused';
    this.status = status;
  }
}

export type ClienteComConexao = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  assets: Ativo[];
};

const comoInstante = (v: unknown) =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

function paraTela(r: Record<string, unknown>): Ativo {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    kind: r.kind as TipoDeAtivo,
    externalId: r.external_id as string,
    displayName: (r.display_name as string | null) ?? null,
    isActive: r.is_active as boolean,
    lastSeenAt: comoInstante(r.last_seen_at),
    lastError: (r.last_error as string | null) ?? null,
  };
}

function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  if (e.code === '42501') throw new ConexaoRefused(e.message ?? 'Sem permissão.', 403);
  if (e.constraint_name === 'meta_assets_unico_por_cliente') {
    throw new ConexaoRefused('Este ativo já está ligado a este cliente.', 409);
  }
  throw erro;
}

/* ─────────────────────────── leitura ─────────────────────────── */

/**
 * Todos os clientes ativos com os ativos de cada um.
 *
 * Traz também quem não tem nenhum: "de quem falta conectar" é a pergunta que
 * esta tela existe para responder, e uma junção interna esconderia exatamente
 * quem interessa.
 */
export async function readConexoes(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<ClienteComConexao[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31, Fase 3b: cliente de empresa omitida não aparece aqui.
    const clientes = await tx`
      select c.id, c.name, c.category_id, cat.name as category_name
        from ideworks.clients c
        join ideworks.client_categories cat on cat.id = c.category_id
       where c.is_active
       ${recorteDasOmitidas(tx, actor, (ids) => tx`and not (c.category_id = any(${ids}::uuid[]))`)}
       order by c.name`;

    if (clientes.length === 0) return [];

    // Uma consulta para todos os ativos, e não uma por cliente: 91 clientes
    // dariam 91 idas ao banco numa tela que abre de uma vez.
    //
    // F31, Fase 3b: a conta da empresa omitida (ou ligada a cliente dela) sai
    // pela mesma regra da lista de contas — ver `contaDaMetaForaDasOmitidas`.
    const ativos = await tx`
      select id, client_id, kind, external_id, display_name, is_active,
             last_seen_at, last_error
        from ideworks.meta_assets
       ${contaDaMetaForaDasOmitidas(
         tx,
         actor,
         // Sem apelido: a consulta desligada fica a de antes, letra a letra.
         { categoria: tx`meta_assets.category_id`, cliente: tx`meta_assets.client_id` },
         'where',
       )}
       order by kind, external_id`;

    const porCliente = new Map<string, Ativo[]>();
    for (const linha of ativos) {
      const a = paraTela(linha as unknown as Record<string, unknown>);
      porCliente.set(a.clientId, [...(porCliente.get(a.clientId) ?? []), a]);
    }

    return clientes.map((c) => ({
      id: c.id as string,
      name: c.name as string,
      categoryId: c.category_id as string,
      categoryName: c.category_name as string,
      assets: porCliente.get(c.id as string) ?? [],
    }));
  });
}

/* ─────────────────────────── escrita ─────────────────────────── */

export async function addAtivo(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  entrada: { kind?: unknown; externalId?: unknown; displayName?: unknown },
): Promise<string> {
  if (!ehTipoDeAtivo(entrada.kind)) {
    throw new ConexaoRefused(`Tipo de ativo desconhecido: "${String(entrada.kind)}".`, 400);
  }

  const bruto = typeof entrada.externalId === 'string' ? entrada.externalId : '';
  const id = normalizarIdentificador(entrada.kind, bruto);
  if (id === null) {
    throw new ConexaoRefused(
      'Não achei um identificador aí. Cole o número da conta ou a URL dela.',
      400,
    );
  }

  const nome = typeof entrada.displayName === 'string' ? entrada.displayName.trim() : '';

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // ⚠️ O IDENTIFICADOR NASCE AQUI, E NÃO NO `returning` DO BANCO — F17.32b.
      //
      //   `meta_assets_write` era uma política `for all`, e `for all` cobre o
      //   `select`. A F17.32b partiu essa política em `insert`/`update`/`delete`
      //   para fechar o segundo caminho de LEITURA, e a leitura ficou só com
      //   `meta_assets_select`, que pergunta a `ideworks.can_see_asset`.
      //
      //   `can_see_asset` é `stable`: enxerga o retrato de ANTES desta
      //   instrução, e a linha recém-inserida não está nele. O `returning id`
      //   passou a ser recusado com `42501` para todo administrador — inclusive
      //   para conta da própria empresa. Gerar o `uuid` aqui tira a escrita da
      //   dependência de uma leitura que ainda não pode existir.
      const novoId = crypto.randomUUID();
      await tx`
        insert into ideworks.meta_assets (id, client_id, kind, external_id, display_name, created_by)
        values (${novoId}, ${clientId}, ${entrada.kind as string}::ideworks.meta_asset_kind,
                ${id}, ${nome === '' ? null : nome}, ${actor.userId})`;
      return novoId;
    } catch (erro) {
      if (erro instanceof ConexaoRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function setAtivoLigado(
  sql: Sql,
  actor: AuthenticatedActor,
  assetId: string,
  ligado: boolean,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const alterados = await tx`
        update ideworks.meta_assets
           set is_active = ${ligado},
               -- Religar limpa o erro antigo: ele descreve uma tentativa que
               -- já não vale, e mantê-lo faria a tela acusar um problema que
               -- ninguém pode mais investigar.
               last_error = case when ${ligado} then null else last_error end,
               updated_at = now()
         where id = ${assetId}
         returning id`;

      if (alterados.length === 0) {
        throw new ConexaoRefused('Ativo não encontrado, ou você não pode alterá-lo.', 403);
      }
    } catch (erro) {
      if (erro instanceof ConexaoRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function deleteAtivo(
  sql: Sql,
  actor: AuthenticatedActor,
  assetId: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const apagados = await tx`
      delete from ideworks.meta_assets where id = ${assetId} returning id`;
    if (apagados.length === 0) {
      throw new ConexaoRefused('Ativo não encontrado, ou você não pode apagá-lo.', 403);
    }
  });
}
