/**
 * `get_admin_week` CONTRA UM POSTGRES DE VERDADE — F40, Fase 9.
 *
 * A leitura do MCP e a da rota (`readControleDaSemana`) sobre o MESMO banco
 * (PGlite, mínimo de esquema + `resolve_status_set` + migration da Fase 1):
 * o corpo da ferramenta é, campo a campo, o que a função do servidor devolve
 * para a mesma semana. Prova também que a empresa omitida da PESSOA da
 * concessão sai pelo mesmo recorte da tela.
 *
 * O QUE NÃO PROVA: as políticas de linha reais e o ator `integration` (só em
 * produção, com a conexão publicada).
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SqlAdminWeekCatalog, actorDaPessoa, getAdminWeek } from '@/integrations/admin-semana';
import { getAdminWeekResponseSchema } from '@/integrations/contract';
import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import { readControleDaSemana } from '@/server/controle-da-semana';
import type { Actor, ServerEnv, Sql, Tx } from '@/server/db';

const MIGRATION = 'supabase/migrations/20261007130000_ideworks_f40_tipo_da_tarefa.sql';
const ESTEIRAS = 'supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql';

type Fragmento = { readonly dublê: true; readonly strings: readonly string[]; readonly args: readonly unknown[] };
const ehFragmento = (v: unknown): v is Fragmento =>
  typeof v === 'object' && v !== null && (v as Fragmento).dublê === true;

function montar(f: Fragmento, params: unknown[]): string {
  let texto = f.strings[0] ?? '';
  f.args.forEach((a, i) => {
    if (ehFragmento(a)) texto += montar(a, params);
    else {
      params.push(a);
      texto += `$${params.length}`;
    }
    texto += f.strings[i + 1] ?? '';
  });
  return texto;
}

let db: PGlite;

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      const texto = montar(f, params);
      return db.query(texto, params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

const sql = {
  begin: async (trabalho: (t: Tx) => Promise<unknown>) => {
    await db.exec('begin; set local role leitor;');
    try {
      return await trabalho(tx);
    } finally {
      await db.exec('rollback;');
    }
  },
} as unknown as Sql;

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const IDE = id(1);
const ALMA = id(2);
const ESPACO = id(3);
const C_ALFA = id(10);
const C_ALMA = id(11);
const L_ALFA = id(20);
const L_ALMA = id(21);
const S_ATRIBUIR = id(40);
const S_AFAZER = id(41);
const S_FEITO = id(42);
const ADMIN = id(90);
const CAPTADOR = id(92);

const HOJE = new Date('2026-10-07T15:00:00Z');

const grant: IntegrationGrant = {
  id: id(80),
  ownerId: ADMIN,
  oauthClientId: 'ideworks-claude',
  name: 'Claude',
  capabilities: ['boards:read', 'tasks:read'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
};
const pessoa = (over: Partial<PersonAccess> = {}): PersonAccess => ({
  userId: ADMIN,
  isActive: true,
  isSuperadmin: true,
  isSuper: false,
  companyIds: [IDE, ALMA],
  clientIds: [],
  hasAllClientsAccess: true,
  ...over,
});

const ator: Actor = { kind: 'user', userId: ADMIN, isSuperadmin: true, isSuper: false };
const catalogo = new SqlAdminWeekCatalog({} as ServerEnv, ator, (trabalho) => trabalho(sql));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create type ideworks.status_type as enum ('open', 'unstarted', 'custom', 'done', 'closed');
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid, is_active boolean);
    create table ideworks.spaces(id uuid primary key, category_id uuid);
    create table ideworks.folders(id uuid primary key, space_id uuid);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, client_id uuid);
    create table ideworks.status_sets(id uuid primary key default gen_random_uuid(),
      space_id uuid, folder_id uuid, list_id uuid, name text);
    create table ideworks.statuses(id uuid primary key default gen_random_uuid(),
      status_set_id uuid not null, name text not null, type ideworks.status_type);
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, parent_id uuid,
      title text not null, description text, status_id uuid, due_on date, archived_at timestamptz, created_by uuid);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    create table ideworks.month_contracts(id uuid primary key, client_id uuid, reference_month date);
    create table ideworks.month_contract_items(contract_id uuid, content_type text, quantity int);
    create table ideworks.client_quotas(client_id uuid, content_type text, quantity int);
    create function ideworks.display_name(u uuid) returns text language sql as $$ select 'Captador' $$;

    create role leitor;
    grant usage on schema ideworks to leitor;
    grant select on all tables in schema ideworks to leitor;

    insert into ideworks.client_categories values ('${IDE}', 'Ide'), ('${ALMA}', 'Alma9');
    insert into ideworks.clients values ('${C_ALFA}', 'Alfa', '${IDE}', true), ('${C_ALMA}', 'Da Alma', '${ALMA}', true);
    insert into ideworks.spaces values ('${ESPACO}', '${IDE}');
    insert into ideworks.lists values
      ('${L_ALFA}', '${ESPACO}', null, 'Alfa', '${C_ALFA}'), ('${L_ALMA}', '${ESPACO}', null, 'Alma', '${C_ALMA}');
    insert into ideworks.status_sets(id, space_id, name) values ('${id(50)}', '${ESPACO}', 'Produção');
    insert into ideworks.statuses(id, status_set_id, name, type) values
      ('${S_ATRIBUIR}', '${id(50)}', 'Atribuir Demanda', 'open'),
      ('${S_AFAZER}', '${id(50)}', 'a fazer video', 'unstarted'),
      ('${S_FEITO}', '${id(50)}', 'feito', 'done');
    insert into ideworks.client_quotas values ('${C_ALFA}', 'video', 8), ('${C_ALMA}', 'video', 8);
  `);
  const esteiras = readFileSync(ESTEIRAS, 'utf8');
  const de = esteiras.indexOf('create or replace function ideworks.resolve_status_set(');
  await db.exec(esteiras.slice(de, esteiras.indexOf('$fn$;', de) + 5));
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec('grant execute on all functions in schema ideworks to leitor;');
  await db.exec(`
    insert into ideworks.tasks(id, list_id, title, demand_type, due_on, status_id, created_by) values
      ('${id(101)}', '${L_ALFA}', 'Reels Alfa', 'video', '2026-10-06', '${S_ATRIBUIR}', '${CAPTADOR}'),
      ('${id(102)}', '${L_ALFA}', 'Feito Alfa', 'video', '2026-10-08', '${S_FEITO}', '${CAPTADOR}'),
      ('${id(103)}', '${L_ALFA}', 'Sem data Alfa', 'video', null, '${S_ATRIBUIR}', '${CAPTADOR}'),
      ('${id(104)}', '${L_ALMA}', 'Da Alma', 'video', '2026-10-06', '${S_AFAZER}', '${CAPTADOR}');
  `);
});

afterAll(async () => {
  await db?.close();
});

/**
 * A concessão que lê também cliente e pessoa: com ela (e sem recorte), a
 * ferramenta devolve EXATAMENTE o que a rota devolve. Sem `clients:read` e
 * `people:read` os nomes saem — ver o bloco do recorte, no fim.
 */
const comRelacoes: IntegrationGrant = { ...grant, capabilities: ['boards:read', 'tasks:read', 'clients:read', 'people:read'] };

/** O corpo da ferramenta sem o que é da chamada (operação, instante, auto-link). */
async function pelaFerramenta(
  week: string | undefined,
  quem = pessoa({ omittedCompanyIds: [ALMA] }),
  concessao: IntegrationGrant = comRelacoes,
) {
  const r = await getAdminWeek({ grant: concessao, person: quem, adminWeek: catalogo, now: HOJE }, week ? { week } : {});
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  const { week: semana, toAssign, progress, missing } = getAdminWeekResponseSchema.parse(r.body);
  return { week: semana, toAssign, progress, missing };
}

describe('get_admin_week contra o Postgres', () => {
  it('é, campo a campo, o que a função da rota devolve para a mesma semana (atual e outra)', async () => {
    for (const semana of [undefined, '2026-10-07', '2026-09-28', '2026-10-12']) {
      const quem = pessoa({ omittedCompanyIds: [ALMA] });
      const daRota = await readControleDaSemana(sql, actorDaPessoa(quem), semana, HOJE);
      expect(await pelaFerramenta(semana)).toEqual(daRota);
    }
  });

  it('o conteúdo não é vazio: o card parado em atribuir demanda, o "sem data" e a falta de meta aparecem', async () => {
    const r = await pelaFerramenta(undefined);
    expect(r.toAssign.flatMap((g) => g.cards.map((c) => c.title)).sort()).toEqual(['Reels Alfa', 'Sem data Alfa']);
    expect(r.missing.items.find((i) => i.clientName === 'Alfa' && i.type === 'video')).toMatchObject({
      target: 2,
      cards: 2,
    });
  });

  it('a empresa omitida da PESSOA da concessão sai, como na tela; sem omitida ela volta', async () => {
    const com = await pelaFerramenta(undefined, pessoa({ omittedCompanyIds: [ALMA] }));
    expect(com.missing.items.map((i) => i.clientName)).not.toContain('Da Alma');
    const sem = await pelaFerramenta(undefined, pessoa());
    expect(sem.missing.items.map((i) => i.clientName)).toContain('Da Alma');
  });

  it('quem não é admin recebe permission_denied antes de qualquer consulta', async () => {
    const r = await getAdminWeek(
      { grant, person: pessoa({ isSuperadmin: false }), adminWeek: catalogo, now: HOJE },
      {},
    );
    expect(r).toMatchObject({ ok: false, code: 'permission_denied' });
  });

  it('semana que não é data vira invalid_input, vinda da própria função da rota', async () => {
    const r = await getAdminWeek({ grant, person: pessoa(), adminWeek: catalogo, now: HOJE }, { week: '2026-13-45' });
    // O schema da ferramenta já barra no MCP; direto na função, a recusa é a da rota.
    expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
  });
});

/**
 * Auditoria de 08/10/2026 — a leitura do MCP rodava com as políticas de linha
 * do DONO (que não conhecem a concessão) e trazia a carteira inteira dele,
 * fora do recorte de empresas e clientes da conexão.
 *
 * Nesta massa a tarefa "Da Alma" mora num espaço da Ide (empresa da TAREFA)
 * com cliente da Alma9 (empresa do CLIENTE): o recorte confere as duas.
 */
describe('get_admin_week respeita o recorte da conexão', () => {
  const textoDe = async (concessao: IntegrationGrant, quem: PersonAccess = pessoa()) =>
    JSON.stringify(await pelaFerramenta(undefined, quem, concessao));

  it('sem recorte, as duas carteiras aparecem (o ponto de partida)', async () => {
    const texto = await textoDe(comRelacoes);
    expect(texto).toContain(C_ALFA);
    expect(texto).toContain(C_ALMA);
  });

  it('cliente fora da concessão não aparece em bloco nenhum', async () => {
    const texto = await textoDe({ ...comRelacoes, allowedClientIds: [C_ALFA] });
    expect(texto).toContain(C_ALFA);
    expect(texto).not.toContain(C_ALMA);
    expect(texto).not.toContain('Da Alma');
  });

  it('empresa fora da concessão: sai o cliente dela e a tarefa em espaço dela', async () => {
    const soIde = await textoDe({ ...comRelacoes, allowedCompanyIds: [IDE] });
    expect(soIde).toContain(C_ALFA);
    expect(soIde).not.toContain(C_ALMA);
    const soAlma = await pelaFerramenta(undefined, pessoa(), { ...comRelacoes, allowedCompanyIds: [ALMA] });
    // O cliente da Alma9 fica (a meta dele é da conexão); a tarefa dele, num espaço da Ide, não.
    expect(soAlma.missing.items.map((i) => i.clientId)).toEqual([C_ALMA]);
    expect(soAlma.missing.items[0].cards).toBe(0);
    expect(soAlma.progress).toEqual([]);
    expect(JSON.stringify(soAlma)).not.toContain(C_ALFA);
  });

  it('pessoa que não alcança todos os clientes: só os dela, mesmo com a conexão sem recorte', async () => {
    const texto = await textoDe(comRelacoes, pessoa({ hasAllClientsAccess: false, clientIds: [C_ALFA] }));
    expect(texto).toContain(C_ALFA);
    expect(texto).not.toContain(C_ALMA);
  });

  it('sem clients:read e people:read os nomes saem; o resto é o da rota', async () => {
    const quem = pessoa({ omittedCompanyIds: [ALMA] });
    const daRota = await readControleDaSemana(sql, actorDaPessoa(quem), undefined, HOJE);
    const semNomes = await pelaFerramenta(undefined, quem, grant);
    const linhas = [...semNomes.toAssign, ...semNomes.progress, ...semNomes.missing.items, ...semNomes.missing.overdue];
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((linha) => linha.clientName === null)).toBe(true);
    expect(semNomes.toAssign.flatMap((g) => g.cards).every((c) => c.createdBy === null)).toBe(true);
    expect(JSON.stringify(semNomes)).not.toContain('Captador');
    expect(semNomes.toAssign.map((g) => g.cards.map((c) => c.id))).toEqual(daRota.toAssign.map((g) => g.cards.map((c) => c.id)));
    expect(semNomes.missing.items.map((i) => [i.clientId, i.type, i.target, i.cards])).toEqual(
      daRota.missing.items.map((i) => [i.clientId, i.type, i.target, i.cards]),
    );
  });
});
