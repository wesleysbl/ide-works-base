/**
 * As contas da Meta — etapa F7d.
 *
 * A CONTA É A ENTIDADE, E NÃO UM ATRIBUTO DO CLIENTE
 *   A conta de anúncio existe na BM; a conta do Instagram existe pendurada numa
 *   página. As duas existem na Meta, com ou sem cliente cadastrado aqui — e a
 *   própria Meta já diz qual pertence a quê.
 *
 *   Por isso a área Meta se organiza por **gerenciador**, e o vínculo com o
 *   cliente do Sistema IDE é uma ponte opcional, feita do outro lado.
 *
 * IMPORTAR NÃO É ADIVINHAR
 *   `importarContas` copia para o banco o que a Meta respondeu: id, nome, de
 *   qual BM, de qual página. Não infere dono, não casa nome com cliente, não
 *   liga nada. Casar é decisão de gente, e acontece na ficha do cliente.
 *
 *   E reimportar **não desfaz** atribuição já feita: a função do banco não
 *   toca em `client_id`. Rotina automática não apaga trabalho humano.
 */

import type { ContaDescoberta } from '@/server/meta-descoberta';
import { type Sql, withActor } from '@/server/db';
import { contaDaMetaForaDasOmitidas, estaOmitida, recorteDasOmitidas, recorteAtivo } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export class ContaRefused extends Error {
  /**
   * Campo declarado e atribuído no corpo, e não como propriedade de parâmetro.
   *
   * `constructor(msg: string, readonly status: ...)` é a forma curta e é o que
   * estava aqui — mas ela EXIGE compilador. O Node roda TypeScript removendo os
   * tipos, sem gerar código, então a forma curta explode com
   * "parameter property is not supported in strip-only mode" e leva junto
   * qualquer script que importe este módulo.
   *
   * Os scripts de prova deste projeto importam o código do servidor de
   * propósito — provar a regra de verdade, e não uma cópia dela. Duas linhas a
   * mais aqui é o preço de o módulo continuar alcançável por eles.
   */
  readonly status: 400 | 403 | 404;

  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.name = 'ContaRefused';
    this.status = status;
  }
}

export type ContaDaMeta = {
  id: string;
  kind: 'ad_account' | 'instagram_account';
  externalId: string;
  displayName: string | null;
  businessId: string | null;
  businessName: string | null;
  pageId: string | null;
  pageName: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
  /** A ponte com o Sistema IDE. Nula quando ninguém atribuiu ainda. */
  client: { id: string; name: string } | null;
  /**
   * De qual empresa do grupo é esta conta — F7g.
   *
   * É DIFERENTE da empresa do cliente: esta diz qual TOKEN alcança a conta,
   * aquela diz quem enxerga o cliente. Podem divergir de propósito, e é por
   * isso que a tela filtra por esta e não por aquela.
   */
  empresa: { id: string; name: string } | null;
  /** Quantos dias de série já existem — é o que diz se há relatório. */
  diasColetados: number;
};

const comoInstante = (v: unknown) =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string };
  if (e.code === '42501') throw new ContaRefused(e.message ?? 'Sem permissão.', 403);
  throw erro;
}

/* ─────────────────────────── leitura ─────────────────────────── */

export async function readContas(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<ContaDaMeta[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31, Fase 3b: conta da empresa omitida, ou ligada a cliente dela, não
    // aparece (nem no pareamento, que parte desta lista). A coleta segue. Sem
    // omitida o recorte é vazio e a consulta é a de antes, letra a letra.
    //
    // A contagem de dias sai por subconsulta, e não por junção com `group by`:
    // junção esconderia a conta que ainda não tem coleta nenhuma — e é
    // justamente ela que precisa aparecer.
    const linhas = await tx`
      select a.id, a.kind::text as kind, a.external_id, a.display_name,
             a.business_id, a.business_name, a.page_id, a.page_name,
             a.is_active, a.last_seen_at, a.last_error,
             a.client_id, c.name as client_name,
             a.category_id, cc.name as category_name,
             (case when a.kind = 'instagram_account'
                   then (select count(distinct o.day) from ideworks.meta_daily_organic o
                          where o.asset_id = a.id)
                   else (select count(distinct m.day) from ideworks.meta_daily_campaign m
                          where m.asset_id = a.id)
              end)::int as dias_coletados
        from ideworks.meta_assets a
        left join ideworks.clients c on c.id = a.client_id
        left join ideworks.client_categories cc on cc.id = a.category_id
       ${contaDaMetaForaDasOmitidas(tx, actor, { categoria: tx`a.category_id`, cliente: tx`a.client_id` }, 'where')}
       order by a.kind, coalesce(a.business_name, a.page_name, ''), a.display_name`;

    return linhas.map((r) => ({
      id: r.id as string,
      kind: r.kind as ContaDaMeta['kind'],
      externalId: r.external_id as string,
      displayName: (r.display_name as string | null) ?? null,
      businessId: (r.business_id as string | null) ?? null,
      businessName: (r.business_name as string | null) ?? null,
      pageId: (r.page_id as string | null) ?? null,
      pageName: (r.page_name as string | null) ?? null,
      isActive: r.is_active as boolean,
      lastSeenAt: comoInstante(r.last_seen_at),
      lastError: (r.last_error as string | null) ?? null,
      client:
        r.client_id === null
          ? null
          : { id: r.client_id as string, name: (r.client_name as string) ?? '(sem nome)' },
      empresa:
        r.category_id === null
          ? null
          : { id: r.category_id as string, name: (r.category_name as string) ?? '(sem nome)' },
      diasColetados: Number(r.dias_coletados ?? 0),
    }));
  });
}

/* ─────────────────────────── escrita ─────────────────────────── */

export type ResultadoDaImportacao = { total: number; contas: number };

/** Uma empresa do grupo e a credencial da Meta que ela usa — F7g. */
export type EmpresaDaMeta = {
  id: string;
  name: string;
  /** O NOME da variável de ambiente, nunca o token. Nulo = usa a padrão. */
  secretName: string | null;
  contas: number;
};

/**
 * As empresas, para quem vai escolher de qual portfólio descobrir.
 *
 * Lê `client_categories` direto porque a empresa não é segredo — o que é
 * segredo é o token, e aqui só trafega o NOME da variável que o guarda.
 */
export async function readEmpresasParaMeta(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<EmpresaDaMeta[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31, Fase 3b — a empresa omitida não é oferecida para descobrir nem
    // importar (`credencialDaEmpresa` responde "Empresa não encontrada." a
    // quem pedir por ela), e a contagem de cada uma segue a mesma regra da
    // lista de contas.
    const linhas = await tx`
      select c.id, c.name, c.meta_secret_name,
             (select count(*)::int from ideworks.meta_assets a
               where a.category_id = c.id
               ${contaDaMetaForaDasOmitidas(tx, actor, { categoria: tx`a.category_id`, cliente: tx`a.client_id` })}) as contas
        from ideworks.client_categories c
       ${recorteDasOmitidas(tx, actor, (ids) => tx`where not (c.id = any(${ids}::uuid[]))`)}
       order by lower(c.name)`;
    return (linhas as unknown as Array<Record<string, unknown>>).map((l) => ({
      id: l.id as string,
      name: l.name as string,
      secretName: (l.meta_secret_name as string | null) ?? null,
      contas: Number(l.contas),
    }));
  });
}

export async function importarContas(
  sql: Sql,
  actor: AuthenticatedActor,
  descobertas: readonly ContaDescoberta[],
  /**
   * De qual empresa são estas contas — e portanto qual token as coleta (F7g).
   *
   * Vem de quem chamou, e não da própria conta, porque a Meta não sabe
   * responder isso: `business_id` chega nulo (a permissão que o traria foi
   * descartada de propósito) e a conta pode nem ter cliente cadastrado. Quem
   * sabe é o token que a encontrou.
   *
   * Nulo mantém o comportamento antigo: a conta entra sem carimbo e cai na
   * credencial padrão.
   */
  categoryId: string | null = null,
): Promise<ResultadoDaImportacao> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      for (const c of descobertas) {
        await tx`
          select ideworks.upsert_meta_asset(
            ${c.kind}::ideworks.meta_asset_kind,
            ${c.externalId},
            ${c.displayName},
            ${c.businessId},
            ${c.businessName},
            ${c.pageId},
            ${c.pageName},
            ${categoryId})`;
      }

      // F31, Fase 3b: "o sistema agora conhece N" conta o que a tela mostra.
      const [n] = await tx`select count(*)::int as n from ideworks.meta_assets${contaDaMetaForaDasOmitidas(
        tx,
        actor,
        { categoria: tx`meta_assets.category_id`, cliente: tx`meta_assets.client_id` },
        'where',
      )}`;
      return { total: descobertas.length, contas: Number(n.n) };
    } catch (erro) {
      traduzir(erro);
    }
  });
}

/** Liga (ou desliga) a conta de um cliente do Sistema IDE. */
export async function atribuirCliente(
  sql: Sql,
  actor: AuthenticatedActor,
  assetId: string,
  clientId: string | null,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31, Fase 3b — ligar a conta a cliente de empresa omitida é mexer no que
    // não aparece: "não encontrado", a mesma frase da ficha dele. (A CONTA
    // omitida já parou em `resolveActor`, pelo endereço.) Sem omitida, nenhuma
    // consulta a mais.
    if (clientId !== null && recorteAtivo(actor)) {
      const [cliente] = await tx`
        select category_id from ideworks.clients where id = ${clientId}`;
      if (cliente && estaOmitida(actor, cliente.category_id as string | null)) {
        throw new ContaRefused('Cliente não encontrado.', 404);
      }
    }
    try {
      await tx`select ideworks.set_asset_client(${assetId}, ${clientId})`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}
