/**
 * Escrita de cliente — etapa F4.5.
 *
 * TUDO NUMA TRANSAÇÃO SÓ
 *   Criar um cliente é escrever em `clients`, `client_quotas`,
 *   `client_links`, `client_tag_assignments` e no vínculo das listas do
 *   quadro (`lists.client_id`). Deixar isso a cargo de quem chama produz
 *   cliente sem cota — que abre o mês vazio e aparece no painel como "0%",
 *   uma acusação nascida de uma escrita que faltou — ou meia ficha salva
 *   com o vínculo recusado, que é pior que a recusa.
 *
 *   `withActor` já é `sql.begin`. É a regra 9 do roteiro mestre: escrita de
 *   domínio sai em bloco, com os recálculos obrigatórios juntos.
 *
 * DUAS PERMISSÕES DIFERENTES, E O MOTIVO
 *   Cadastro (nome, plano, categoria, datas, cota, links) exige administrador —
 *   é o que a agência cobra. As duas chaves que a operação vira todo dia
 *   (urgência e financeiro-ok) exigem apenas enxergar o cliente, e por isso
 *   passam por função com dono no banco: RLS decide por linha e não saberia
 *   distinguir essas colunas das contratuais. Ver a migration da F4.5.
 *
 * A RECUSA NÃO DIZ SE O CLIENTE EXISTE
 *   "Não encontrado" e "não é seu" devolvem a mesma coisa. A diferença entre as
 *   duas revelaria a existência de cliente de outra carteira a quem perguntasse
 *   por ID.
 */

import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import type { ClienteValidado, EntradaDeCliente } from '@/clients/formulario';
import { type Sql, type Tx, arrayOuNulo, withActor } from '@/server/db';
import { estaOmitida } from '@/server/omitidas';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/** Recusa vinda do banco — falta de permissão ou restrição violada. */
export class WriteRefused extends Error {
  readonly status: 403 | 404 | 409;

  constructor(message: string, status: 403 | 404 | 409) {
    super(message);
    this.name = 'WriteRefused';
    this.status = status;
  }
}

/**
 * Traduz o erro cru do Postgres para algo que a tela possa mostrar.
 *
 * Sem isto, violar o índice único de link devolve "duplicate key value violates
 * unique constraint client_links_sem_duplicata" — verdadeiro, e inútil para
 * quem só quer saber que colou o mesmo link duas vezes.
 */
function traduzirErro(erro: unknown): never {
  if (erro instanceof WriteRefused) throw erro;

  const e = erro as { code?: string; constraint_name?: string; message?: string };
  const frase = (e.message ?? '').split('\n')[0];

  if (e.code === '42501') {
    // O guarda `list_client_reach_guard` já escreve em português. A política
    // de linha, em inglês, cai na frase genérica de permissão.
    if (/fora do seu alcance/i.test(frase)) {
      throw new WriteRefused(emPortugues(frase), 403);
    }
    throw new WriteRefused(e.message ?? 'Você não tem permissão para isto.', 403);
  }
  if (e.code === '22P02' && /uuid/i.test(frase)) {
    throw new WriteRefused(
      'Uma das listas escolhidas não é válida. Nada foi gravado.',
      409,
    );
  }
  if (e.code === '23505') {
    if (e.constraint_name === 'client_links_sem_duplicata') {
      throw new WriteRefused('Há dois links iguais na lista.', 409);
    }
    throw new WriteRefused('Já existe um registro igual a este.', 409);
  }
  if (e.code === '23514') {
    if (e.constraint_name === 'client_links_url_is_safe') {
      throw new WriteRefused('Um dos endereços não é um link válido.', 409);
    }
    if (e.constraint_name === 'client_links_title_not_blank') {
      throw new WriteRefused('Há um link sem nome.', 409);
    }
    throw new WriteRefused('O banco recusou estes dados.', 409);
  }
  if (e.code === '23503') {
    throw new WriteRefused('O plano ou a categoria escolhida não existe mais.', 409);
  }
  throw erro;
}

/* ─────────────────────────── catálogo para o formulário ─────────────────────────── */

export type Catalogos = {
  plans: Array<{ id: string; name: string; colorBg: string; colorText: string; colorBorder: string }>;
  categories: Array<{ id: string; name: string; isDefault: boolean }>;
  tags: Array<{ id: string; name: string; color: string }>;
};

export async function readCatalogs(sql: Sql, actor: AuthenticatedActor): Promise<Catalogos> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const planos = await tx`
      select id, name, color_bg, color_text, color_border
        from ideworks.plans
       where is_active
       order by sort_order, name`;

    const categorias = await tx`
      select id, name, is_default
        from ideworks.client_categories
       order by sort_order, name`;

    const etiquetas = await tx`
      select id, name, color from ideworks.client_tags order by name`;

    return {
      tags: etiquetas.map((t) => ({
        id: t.id as string,
        name: t.name as string,
        color: t.color as string,
      })),
      plans: planos.map((p) => ({
        id: p.id as string,
        name: p.name as string,
        colorBg: p.color_bg as string,
        colorText: p.color_text as string,
        colorBorder: p.color_border as string,
      })),
      // F31 — a ficha do cliente não oferece a empresa omitida. O campo
      // continua (é ele que decide quem vê o cliente); só a opção sai.
      categories: categorias
        .filter((c) => !estaOmitida(actor, c.id as string))
        .map((c) => ({
          id: c.id as string,
          name: c.name as string,
          isDefault: c.is_default as boolean,
        })),
    };
  });
}

/* ─────────────────────────── ler para editar ─────────────────────────── */

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dia = (v: unknown) =>
  v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/**
 * Devolve o cliente **na forma do formulário**, não na do banco.
 *
 * A tela de edição e a de criação são o mesmo componente. Se a leitura
 * devolvesse a forma do banco, o componente teria que traduzir — e essa
 * tradução, escrita duas vezes, é onde nasce o campo que não salva.
 */
export async function readClientForm(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
): Promise<EntradaDeCliente> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const [c] = await tx`
      select name, tax_id, company_email, plan_id, category_id, started_on, renews_on,
             phone, whatsapp, address, owner_name, owner_phone, owner_whatsapp, notes
        from ideworks.clients
       where id = ${id}`;

    if (!c) throw new WriteRefused('Cliente não encontrado.', 404);

    const cotas = await tx`
      select content_type, quantity from ideworks.client_quotas where client_id = ${id}`;
    const links = await tx`
      select title, url from ideworks.client_links
       where client_id = ${id} order by sort_order, title`;

    const etiquetas = await tx`
      select tag_id from ideworks.client_tag_assignments where client_id = ${id}`;

    const listas = await tx`
      select id from ideworks.client_board_lists(${id})`;

    const quotas = Object.fromEntries(CONTENT_TYPES.map((t) => [t, 0])) as Record<
      ContentType,
      number
    >;
    for (const linha of cotas) {
      quotas[linha.content_type as ContentType] = Number(linha.quantity);
    }

    return {
      name: texto(c.name),
      taxId: texto(c.tax_id),
      companyEmail: texto(c.company_email),
      planId: (c.plan_id as string | null) ?? null,
      categoryId: texto(c.category_id),
      startedOn: dia(c.started_on),
      renewsOn: dia(c.renews_on),
      phone: texto(c.phone),
      whatsapp: texto(c.whatsapp),
      address: texto(c.address),
      ownerName: texto(c.owner_name),
      ownerPhone: texto(c.owner_phone),
      ownerWhatsapp: texto(c.owner_whatsapp),
      notes: texto(c.notes),
      quotas,
      links: links.map((l) => ({ title: l.title as string, url: l.url as string })),
      tagIds: etiquetas.map((t) => t.tag_id as string),
      boardListIds: listas.map((l) => l.id as string),
    };
  });
}

/* ─────────────────────────── criar e editar ─────────────────────────── */

/** As colunas de `clients` que os dois caminhos escrevem, na mesma ordem. */
const colunasDoCliente = (v: ClienteValidado) => ({
  name: v.name,
  tax_id: v.taxId,
  company_email: v.companyEmail,
  plan_id: v.planId,
  category_id: v.categoryId,
  started_on: v.startedOn,
  renews_on: v.renewsOn,
  phone: v.phone,
  whatsapp: v.whatsapp,
  address: v.address,
  owner_name: v.ownerName,
  owner_phone: v.ownerPhone,
  owner_whatsapp: v.ownerWhatsapp,
  notes: v.notes,
});

/**
 * Regrava cota, links, etiquetas e o vínculo das listas do quadro.
 *
 * Apagar e reinserir em vez de reconciliar linha a linha: a lista chega inteira
 * da tela, e "qual link o usuário removeu" é uma pergunta que a reconciliação
 * teria que responder por dedução. Dentro da transação, o intervalo em que a
 * tabela fica vazia não existe para mais ninguém. As listas do quadro são o
 * contrário: soltar é `client_id` nulo, nunca apagar a linha.
 */
async function regravarDependentes(tx: Sql | Tx, clientId: string, v: ClienteValidado) {
  await tx`delete from ideworks.client_quotas where client_id = ${clientId}`;
  await tx`
    insert into ideworks.client_quotas ${tx(
      CONTENT_TYPES.map((t) => ({ client_id: clientId, content_type: t, quantity: v.quotas[t] })),
      'client_id',
      'content_type',
      'quantity',
    )}`;

  // As etiquetas passam pela função com dono porque a política de
  // `client_tag_assignments` exige administrador — e etiquetar é trabalho do
  // dia a dia. Aqui quem chama já é administrador (a escrita de cliente exige),
  // mas usar a mesma porta mantém uma regra só. Ver F2.4.
  await tx`select ideworks.set_client_tags(${clientId}, ${arrayOuNulo(v.tagIds)}::uuid[])`;

  await tx`delete from ideworks.client_links where client_id = ${clientId}`;
  if (v.links.length > 0) {
    await tx`
      insert into ideworks.client_links ${tx(
        v.links.map((l) => ({
          client_id: clientId,
          title: l.title,
          url: l.url,
          sort_order: l.sortOrder,
        })),
        'client_id',
        'title',
        'url',
        'sort_order',
      )}`;
  }

  await regravarListasDoQuadro(tx, clientId, v.boardListIds);
}

/**
 * Solta as que saíram (`client_id` nulo — a lista continua) e liga as novas
 * na mesma transação do cadastro. O guarda de alcance dispara no `update`;
 * lista que a pessoa não vê no quadro não muda de linha, e a conferência
 * abaixo recusa o bloco inteiro.
 *
 * Não apaga lista. Transferir (lista que já era de outro cliente) é o
 * `update` de `client_id`: uma lista tem um cliente só.
 */
async function regravarListasDoQuadro(
  tx: Sql | Tx,
  clientId: string,
  ids: readonly string[],
) {
  if (ids.length === 0) {
    await tx`update ideworks.lists set client_id = null where client_id = ${clientId}`;
  } else {
    await tx`
      update ideworks.lists
         set client_id = null
       where client_id = ${clientId}
         and not (id = any(${ids}::uuid[]))`;
    await tx`
      update ideworks.lists
         set client_id = ${clientId}
       where id = any(${ids}::uuid[])
         and client_id is distinct from ${clientId}`;
  }

  const atuais = await tx`
    select id from ideworks.client_board_lists(${clientId})`;
  const ficou = new Set(atuais.map((r) => String(r.id).toLowerCase()));
  if (ficou.size !== ids.length || ids.some((id) => !ficou.has(id.toLowerCase()))) {
    throw new WriteRefused(
      'Uma das listas escolhidas está fora do seu alcance, ou não existe mais. Só dá para ligar listas que você já vê no quadro. Nada foi gravado.',
      403,
    );
  }
}

/**
 * F31 — cliente não nasce nem passa para empresa omitida. A mesma frase de
 * categoria que não existe mais: a ficha não a oferece, e o pedido forjado não
 * descobre nada.
 */
function recusarCategoriaOmitida(actor: AuthenticatedActor, v: ClienteValidado): void {
  if (estaOmitida(actor, v.categoryId)) {
    throw new WriteRefused('O plano ou a categoria escolhida não existe mais.', 409);
  }
}

export async function createClient(
  sql: Sql,
  actor: AuthenticatedActor,
  v: ClienteValidado,
): Promise<string> {
  recusarCategoriaOmitida(actor, v);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      // ⚠️ O IDENTIFICADOR NASCE AQUI, E NÃO NO `returning` DO BANCO — F17.32b.
      //
      //   Enquanto `clients_write` era uma política `for all`, ela cobria
      //   também o `select` — e o `returning id` passava porque "administra"
      //   bastava. A F17.32b partiu essa política em `insert`/`update`/`delete`
      //   para fechar o segundo caminho de LEITURA, e a leitura passou a ser só
      //   `clients_select`, que pergunta a `ideworks.can_see_client`.
      //
      //   `can_see_client` é `stable`: ela enxerga o retrato do banco de ANTES
      //   desta instrução. A linha recém-inserida não está nele — nem para
      //   quem é da empresa dela. Então `insert ... returning` era recusado com
      //   `42501` para todo administrador, e cadastrar cliente parava de
      //   funcionar. Medido em 2026-08-28.
      //
      //   Gerar o `uuid` do lado de cá tira a instrução de escrita da
      //   dependência de uma leitura que ainda não pode existir. A próxima
      //   instrução da mesma transação já enxerga a linha normalmente — é por
      //   isso que `regravarDependentes` continua funcionando logo abaixo.
      const id = crypto.randomUUID();
      await tx`insert into ideworks.clients ${tx({ id, ...colunasDoCliente(v) })}`;
      await regravarDependentes(tx, id, v);
      return id;
    } catch (erro) {
      if (erro instanceof WriteRefused) throw erro;
      // Sem política de escrita, o insert não devolve linha nenhuma em vez de
      // recusar — e sem esta conversão o erro chegaria como "não é iterável".
      if ((erro as { code?: string }).code === undefined) {
        throw new WriteRefused('Só administrador cadastra cliente.', 403);
      }
      traduzirErro(erro);
    }
  });
}

export async function updateClient(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
  v: ClienteValidado,
): Promise<void> {
  recusarCategoriaOmitida(actor, v);
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const alterado = await tx`
        update ideworks.clients set ${tx(colunasDoCliente(v))}, updated_at = now()
         where id = ${id} returning id`;

      if (alterado.length === 0) {
        throw new WriteRefused('Cliente não encontrado, ou você não pode editá-lo.', 403);
      }
      await regravarDependentes(tx, id, v);
    } catch (erro) {
      if (erro instanceof WriteRefused) throw erro;
      traduzirErro(erro);
    }
  });
}

/* ─────────────────────────── as chaves do dia a dia ─────────────────────────── */

export async function setClientFlags(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
  chaves: { urgency?: 'paz' | 'alerta' | 'perigo'; financeOk?: boolean },
): Promise<void> {
  if (chaves.urgency === undefined && chaves.financeOk === undefined) {
    throw new WriteRefused('Nada a alterar.', 409);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`
        select ideworks.set_client_flags(
          ${id},
          ${chaves.urgency ?? null}::ideworks.urgency_level,
          ${chaves.financeOk ?? null}::boolean
        )`;
    } catch (erro) {
      traduzirErro(erro);
    }
  });
}

/**
 * EXCLUIR O CLIENTE — só depois de inativo, e só o administrador.
 *
 * Inativar é o passo que se desfaz; excluir é o depois. O que pertence ao
 * cliente (conteúdos, contratos, demandas, histórico, contas da Meta) sai por
 * cascata do banco, e as listas dele ficam, sem cliente (`on delete set null`).
 */
export async function deleteClient(sql: Sql, actor: AuthenticatedActor, id: string): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [cliente] = await tx`select is_active from ideworks.clients where id = ${id}`;
      if (!cliente) throw new WriteRefused('Cliente não encontrado, ou fora do seu alcance.', 404);
      if (cliente.is_active === true) {
        throw new WriteRefused('Inative o cliente antes de excluí-lo.', 409);
      }
      const apagados = await tx`delete from ideworks.clients where id = ${id} returning id`;
      if (apagados.length === 0) throw new WriteRefused('Só administrador exclui cliente.', 403);
    } catch (erro) {
      traduzirErro(erro);
    }
  });
}

export async function setClientActive(
  sql: Sql,
  actor: AuthenticatedActor,
  id: string,
  active: boolean,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.set_client_active(${id}, ${active})`;
    } catch (erro) {
      traduzirErro(erro);
    }
  });
}
