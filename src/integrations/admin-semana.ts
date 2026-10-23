/**
 * `get_admin_week` — F40, Fase 9: o painel "Controle da semana" dos admins, lido pela IA.
 *
 * A MESMA LEITURA DA TELA
 *   O catálogo SQL chama `readControleDaSemana` (`server/controle-da-semana.ts`),
 *   a função da rota `GET /admin/semana`. Nenhuma regra é refeita aqui: semana,
 *   meta, cliente cancelado, empresa omitida e corte dos atrasados são os dela.
 *
 * "CONCESSÃO DE ADMIN"
 *   Não existe um escopo de admin no banco (o enum de capacidades é fechado, e
 *   criar um pede migration). A regra, então, são DUAS coisas juntas:
 *     1. a PESSOA da concessão é admin AGORA (`person.isSuperadmin`, relido do
 *        perfil a cada chamada pelo portão): perder o papel fecha a ferramenta
 *        no mesmo instante, com a concessão intacta;
 *     2. a CONCESSÃO carrega as leituras que o painel mostra: `boards:read` e
 *        `tasks:read`. Administrar o sistema NÃO amplia o agente (grants.ts).
 *   Faltando qualquer uma: `permission_denied`.
 *
 * O RECORTE DA CONEXÃO
 *   A consulta roda com o ator da concessão (`integration` no ator do banco),
 *   mas as políticas de linha de `tasks`, `lists` e `clients` são as do DONO:
 *   não conhecem as empresas e os clientes escolhidos no consentimento.
 *   (Auditoria de 08/10/2026: este comentário dizia o contrário, e a leitura
 *   trazia a carteira inteira do dono.) O recorte da conexão vai, então, como
 *   parâmetro (`adminWeekScopeOf` → `recorteDaConexao` de
 *   `readControleDaSemana`), com a mesma regra das outras leituras
 *   (`toWorkScope`). As empresas omitidas (F31) saem pelo mesmo
 *   `categoriasOmitidas` que a tela usa, montado de `person.omittedCompanyIds`.
 *
 * AS RELAÇÕES CONCEDIDAS
 *   Como em `get_task`/`get_board`: sem `clients:read`, o nome do cliente vem
 *   nulo (o id fica: é ele que agrupa); sem `people:read`, quem lançou vem
 *   nulo e os responsáveis, vazios.
 */

import {
  allowsOperation,
  effectiveCapabilities,
  type IntegrationGrant,
  type PersonAccess,
} from '@/integrations/grants';
import { toWorkScope } from '@/integrations/reads';
import {
  ADMIN_WEEK_INPUT_MESSAGE,
  GET_ADMIN_WEEK_PATH,
  getAdminWeekResponseSchema,
  type GetAdminWeekInput,
  type GetAdminWeekResponse,
  type IntegrationErrorCode,
} from '@/integrations/contract';
import { BoardRefused } from '@/server/board';
import {
  readControleDaSemana,
  type ControleDaSemana,
  type RecorteDaConexao,
} from '@/server/controle-da-semana';
import { type Actor, type ServerEnv } from '@/server/db';
import { borrowSql } from '@/server/db-request';
import type { AuthenticatedActor } from '@/server/session';

export const ADMIN_WEEK_ADMIN_ONLY =
  'A semana do controle é só para administradores: a pessoa desta conexão não tem esse papel agora. Nada foi lido.';
export const ADMIN_WEEK_DENIED =
  'Esta concessão não autoriza ler a semana do controle: exige boards:read e tasks:read, e que quem conectou seja administrador.';
export const ADMIN_WEEK_UNAVAILABLE = 'A leitura da semana do controle não está ligada neste ambiente.';

/** O ator "de tela" de uma pessoa da concessão — o que `readControleDaSemana` e `liberarDemandaInTx` leem. */
export function actorDaPessoa(
  person: Pick<PersonAccess, 'userId' | 'isSuperadmin' | 'isSuper' | 'hasAllClientsAccess' | 'omittedCompanyIds'>,
): AuthenticatedActor {
  return {
    userId: person.userId,
    email: '',
    papel: person.isSuper ? 'super_admin' : person.isSuperadmin ? 'admin' : 'funcionario',
    isSuperadmin: person.isSuperadmin,
    isSuper: person.isSuper,
    areas: [],
    hasAllClientsAccess: person.hasAllClientsAccess,
    categoriasOmitidas: person.omittedCompanyIds ?? [],
  };
}

/** O recorte da conexão que a leitura aplica — `null` = sem limite no eixo, `[]` = nada. */
export type AdminWeekScope = RecorteDaConexao;

/**
 * O recorte da CONCESSÃO, achatado para a consulta: as empresas de
 * `effectiveCompanies` e os clientes de `effectiveClients` (com a regra de
 * `can_see_client` em `person.clientIds`) — o mesmo `toWorkScope` de
 * `get_board`, `search` e companhia. "Todas" (`all`) vira `null`: as omitidas
 * já saem pela regra da tela.
 */
export function adminWeekScopeOf(person: PersonAccess, grant: IntegrationGrant, now: Date): AdminWeekScope {
  const scope = toWorkScope(person, grant, now);
  return {
    companyIds:
      scope.companies.kind === 'all' ? null : scope.companies.kind === 'none' ? [] : [...scope.companies.ids],
    clientIds: scope.clients === 'all' ? null : scope.clients === 'none' ? [] : [...scope.clients],
  };
}

/**
 * O porto da leitura. A suíte injeta memória; o Worker liga o SQL.
 * `read` recebe a PESSOA (já conferida como admin), o parâmetro bruto da
 * semana e o recorte da conexão, que o SQL aplica na consulta.
 */
export type AdminWeekCatalog = {
  read(person: PersonAccess, week: string | null, now: Date, scope: AdminWeekScope): Promise<ControleDaSemana>;
};

export const EMPTY_ADMIN_WEEK_CATALOG: AdminWeekCatalog = {
  async read() {
    throw new AdminWeekUnavailable();
  },
};

export class AdminWeekUnavailable extends Error {
  constructor() {
    super(ADMIN_WEEK_UNAVAILABLE);
    this.name = 'AdminWeekUnavailable';
  }
}

export class SqlAdminWeekCatalog implements AdminWeekCatalog {
  constructor(
    private readonly env: ServerEnv,
    private readonly actor: Actor,
    /** A suíte troca a conexão; o Worker empresta a da requisição. */
    private readonly open: <T>(work: (sql: Parameters<typeof readControleDaSemana>[0]) => Promise<T>) => Promise<T> = (
      work,
    ) => borrowSql(this.env, 'semana-do-controle', work),
  ) {}

  read(person: PersonAccess, week: string | null, now: Date, scope: AdminWeekScope): Promise<ControleDaSemana> {
    return this.open((sql) => readControleDaSemana(sql, actorDaPessoa(person), week, now, this.actor, scope));
  }
}

export function createSqlAdminWeekCatalog(env: ServerEnv, actor: Actor): AdminWeekCatalog {
  return new SqlAdminWeekCatalog(env, actor);
}

/**
 * Dublê da suíte: devolve o que a função recebida devolve, e guarda as
 * chamadas — com o recorte recebido, que no SQL vira condição da consulta.
 */
export class MemoryAdminWeekCatalog implements AdminWeekCatalog {
  readonly calls: Array<{ userId: string; week: string | null; scope: AdminWeekScope }> = [];

  constructor(
    private readonly reader: (
      person: PersonAccess,
      week: string | null,
      now: Date,
      scope: AdminWeekScope,
    ) => Promise<ControleDaSemana>,
  ) {}

  async read(person: PersonAccess, week: string | null, now: Date, scope: AdminWeekScope): Promise<ControleDaSemana> {
    this.calls.push({ userId: person.userId, week, scope });
    return this.reader(person, week, now, scope);
  }
}

/** As relações sem leitura concedida saem — a regra de `projectTask`, campo a campo. */
function projectWeek(
  week: ControleDaSemana,
  caps: { clients: boolean; people: boolean },
): Omit<GetAdminWeekResponse, 'operation' | 'queriedAt' | 'self'> {
  const cliente = (name: string): string | null => (caps.clients ? name : null);
  return {
    week: week.week,
    toAssign: week.toAssign.map((g) => ({
      ...g,
      clientName: cliente(g.clientName),
      cards: g.cards.map((c) => ({ ...c, createdBy: caps.people ? c.createdBy : null })),
    })),
    progress: week.progress.map((l) => ({ ...l, clientName: cliente(l.clientName) })),
    missing: {
      items: week.missing.items.map((l) => ({ ...l, clientName: cliente(l.clientName) })),
      overdue: week.missing.overdue.map((c) => ({
        ...c,
        clientName: cliente(c.clientName),
        assignees: caps.people ? c.assignees : [],
      })),
      overdueTotal: week.missing.overdueTotal,
    },
  };
}

export type AdminWeekCtx = {
  grant: IntegrationGrant;
  person: PersonAccess;
  adminWeek?: AdminWeekCatalog;
  now?: Date;
};

export type AdminWeekFailure = {
  ok: false;
  code: Extract<IntegrationErrorCode, 'permission_denied' | 'invalid_input' | 'unavailable'>;
  message: string;
};
export type AdminWeekResult = { ok: true; body: GetAdminWeekResponse } | AdminWeekFailure;

export async function getAdminWeek(ctx: AdminWeekCtx, input: GetAdminWeekInput): Promise<AdminWeekResult> {
  const now = ctx.now ?? new Date();
  // A concessão primeiro (não ensina o formato a quem não pode ler), depois o papel.
  if (
    !allowsOperation(ctx.person, ctx.grant, 'boards:read', now) ||
    !allowsOperation(ctx.person, ctx.grant, 'tasks:read', now)
  ) {
    return { ok: false, code: 'permission_denied', message: ADMIN_WEEK_DENIED };
  }
  if (!ctx.person.isSuperadmin) {
    return { ok: false, code: 'permission_denied', message: ADMIN_WEEK_ADMIN_ONLY };
  }
  try {
    const week = await (ctx.adminWeek ?? EMPTY_ADMIN_WEEK_CATALOG).read(
      ctx.person,
      input.week ?? null,
      now,
      adminWeekScopeOf(ctx.person, ctx.grant, now),
    );
    const caps = effectiveCapabilities(ctx.person, ctx.grant, now);
    return {
      ok: true,
      body: getAdminWeekResponseSchema.parse({
        operation: 'get_admin_week',
        queriedAt: now.toISOString(),
        self: GET_ADMIN_WEEK_PATH,
        ...projectWeek(week, { clients: caps.has('clients:read'), people: caps.has('people:read') }),
      }),
    };
  } catch (error) {
    if (error instanceof AdminWeekUnavailable) {
      return { ok: false, code: 'unavailable', message: ADMIN_WEEK_UNAVAILABLE };
    }
    if (error instanceof BoardRefused) {
      if (error.status === 403) return { ok: false, code: 'permission_denied', message: error.message };
      return { ok: false, code: 'invalid_input', message: error.status === 400 ? ADMIN_WEEK_INPUT_MESSAGE : error.message };
    }
    throw error;
  }
}
