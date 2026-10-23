/**
 * Catálogo SQL da integração — o par que faltava.
 *
 * POR QUÊ ESTE ARQUIVO EXISTE
 *
 *   `workCatalogFor`, `deliveryCatalogFor` e `marketingCatalogFor` já tinham
 *   par SQL: sem injeção e com banco, o Worker lê o banco. O
 *   `IntegrationCatalog` — empresas + nome de quem é dono da concessão —
 *   ficou sem o seu. O handler despachava sempre `options.catalog ??
 *   EMPTY_CATALOG`, então em produção `catalog.companies()` devolvia `[]`.
 *
 *   Com a lista vazia, `listEffectiveCompanies` em `context.ts` não tinha de
 *   onde tirar empresa: escopo `'all'` é `catalog.map(...)`, e mapear o vazio
 *   dá vazio. Resultado observado com usuário real: `get_context` autenticava,
 *   trazia as capacidades certas e `effectiveScope.companies: []` — o agente
 *   não alcançava quadro, cliente nem pessoa nenhuma.
 *
 * QUEM JULGA É O SERVIDOR OBSERVANDO FATOS
 *
 *   O alcance é verdade do banco, não desta classe. `companies()` pergunta a
 *   `ideworks.owner_currently_reaches_company(category_id)` — a MESMA função
 *   que `integration_allows_company` usa por dentro — em vez de reescrever a
 *   regra com outro `exists` sobre `user_categories`. Duas escritas da mesma
 *   regra divergem; uma só, não.
 *
 *   Não usamos `integration_allows_company` aqui de propósito: ela já mistura
 *   a allowlist da concessão, e a interseção pessoa ∩ concessão é trabalho de
 *   `effectiveCompanies` (`grants.ts`). O catálogo só dá NOME ao que o banco
 *   já autoriza; ele nunca amplia o recorte — no máximo o `'all'` deixa de
 *   ser vazio e passa a ser exatamente o que o dono alcança agora.
 *
 *   O ator passado a `withActor` é o da INTEGRAÇÃO, como nos outros catálogos:
 *   `acting_user_id()` dentro da sessão é o dono da concessão, que é
 *   justamente o sujeito de `owner_currently_reaches_company`.
 *
 * DE ONDE VEM O NOME DA EMPRESA
 *
 *   De `ideworks.client_categories`, a mesma tabela que alimenta
 *   `categories` em `GET /api/catalogs` (`src/server/catalogos.ts`) e os
 *   nomes de empresa em `sql-work.ts`. Nada de nome vindo do legado `public`
 *   e nada de fonte nova: uma empresa tem um nome só no produto. A ordem
 *   (`sort_order, name`) copia a do catálogo da interface; `context.ts`
 *   reordena por nome de todo jeito.
 *
 *   O nome da pessoa vem de `ideworks.display_name()`, a mesma função que
 *   board, tarefas e avisos usam.
 *
 * VÁRIAS EMPRESAS HOJE, UMA AMANHÃ
 *
 *   A consulta lê o banco como ele está — n empresas. Quando sobrar uma só,
 *   ela devolve uma linha e nada mais muda. Nenhum atalho presume empresa
 *   única.
 */

import type { IntegrationCatalog, IntegrationCompany, IntegrationScope } from '@/integrations/context';
import { inlineUuid, withActor, type Actor, type ServerEnv, type Tx } from '@/server/db';
import { borrowSql } from '@/server/db-request';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SqlIntegrationCatalog implements IntegrationCatalog {
  constructor(
    private readonly env: ServerEnv,
    private readonly actor: Actor,
  ) {}

  /**
   * A conexão vem da requisição (F22, Fase 2) — este porto não abre nem fecha
   * cliente. O recorte não muda de dono: `withActor` continua declarando ESTE
   * ator dentro da própria transação, que é onde a declaração vale.
   */
  private async withTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return borrowSql(this.env, 'catalogo', (sql) => withActor(sql, this.actor, work));
  }

  async companies(): Promise<readonly IntegrationCompany[]> {
    return this.withTx((tx) => lerEmpresas(tx));
  }

  async displayName(ownerId: string): Promise<string | null> {
    // Id inválido não vira consulta: `context.ts` já cai no fallback do id.
    if (!UUID.test(ownerId)) return null;
    return this.withTx((tx) => lerNome(tx, ownerId));
  }

  /**
   * AS EMPRESAS E O NOME NA MESMA TRANSAÇÃO — perf do servidor, 08/10/2026.
   *
   * Eram duas transações seguidas em TODA chamada de ferramenta de leitura
   * (begin + declaração + consulta + commit, duas vezes). Aqui são as mesmas
   * duas consultas, com o mesmo texto e o mesmo ator, dentro de uma transação
   * só — e como nenhuma delas leva parâmetro (o id do dono vai no texto) elas
   * saem juntas na mesma ida. O alcance continua sendo o do banco:
   * `owner_currently_reaches_company` roda sob o ator da integração, como antes.
   */
  async scope(ownerId: string): Promise<IntegrationScope> {
    const comNome = UUID.test(ownerId);
    return this.withTx(async (tx) => {
      const [companies, name] = await Promise.all([
        lerEmpresas(tx),
        comNome ? lerNome(tx, ownerId) : Promise.resolve(null),
      ]);
      return { companies, displayName: name };
    });
  }
}

async function lerEmpresas(tx: Tx): Promise<readonly IntegrationCompany[]> {
  const rows = await tx`
    select c.id::text as id, c.name as name
      from ideworks.client_categories c
     where ideworks.owner_currently_reaches_company(c.id)
     order by c.sort_order, c.name, c.id`;
  const out: IntegrationCompany[] = [];
  for (const row of rows) {
    const id = row.id as string;
    const name = row.name as string | null;
    // Empresa sem nome mostra o id: melhor um identificador cru do que
    // uma linha silenciosamente descartada do recorte.
    out.push({ id, name: name && name.trim().length > 0 ? name : id });
  }
  return out;
}

async function lerNome(tx: Tx, ownerId: string): Promise<string | null> {
  const rows = await tx`select ideworks.display_name(${inlineUuid(tx, ownerId)}::uuid) as name`;
  const name = rows[0]?.name as string | null | undefined;
  return name && name.trim().length > 0 ? name : null;
}

export function createSqlIntegrationCatalog(env: ServerEnv, actor: Actor): IntegrationCatalog {
  return new SqlIntegrationCatalog(env, actor);
}
