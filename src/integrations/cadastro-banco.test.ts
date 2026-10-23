/**
 * `get_client` (cadastro) e `list_clients` CONTRA UM POSTGRES DE VERDADE — conferência de 08/10/2026, G5.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   `SqlWorkCatalog.getClient` e `SqlWorkCatalog.listClients` sobre o PGlite:
 *     · o cadastro (plano, urgência, financeiro, início, renovação, cota vigente,
 *       etiquetas) sai do banco;
 *     · as colunas de CONTATO existem na tabela (isca) e não são nem lidas — o
 *       texto da consulta não as cita e o corpo não as leva;
 *     · empresa omitida, empresa e cliente fora da concessão e cliente cancelado
 *       não saem (o recorte é cláusula do `where`).
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha e as funções de concessão reais: aqui dizem "sim".
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import type { Tx } from '@/server/db';

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
let textos: string[] = [];

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      const texto = montar(f, params);
      textos.push(texto);
      return db.query(texto, params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) };

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (s: unknown) => Promise<unknown>) => work(sql),
}));

const { getClientWork, listClientsWork } = await import('@/integrations/reads');
const { SqlWorkCatalog } = await import('@/integrations/sql-work');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDE = id(1);
const FILMES = id(2);
const ALMA = id(3);
const C_JATOBA = id(10);
const C_SONHO = id(11);
const C_FILMES = id(12);
const C_ALMA = id(13);
const C_ZECA = id(14);
const C_AGUA = id(15);
const EU = id(99);
const ATOR = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };
const AGORA = new Date('2026-10-08T12:00:00Z');
const ISCA = ['11 99999-0000', 'financeiro@jatoba.com.br', '12.345.678/0001-90', 'Dona Maria', 'Cliente difícil', 'Rua das Flores, 10'];

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: id(200),
  ownerId: EU,
  oauthClientId: 'cliente-oauth',
  name: 'Claude',
  capabilities: ['clients:read', 'boards:read'],
  allowedCompanyIds: null,
  allowedClientIds: null,
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
  ...over,
});
const topo: PersonAccess = {
  userId: EU,
  isActive: true,
  isSuperadmin: true,
  isSuper: true,
  companyIds: [IDE, FILMES, ALMA],
  clientIds: [],
  hasAllClientsAccess: true,
};
const semAlma: PersonAccess = { ...topo, omittedCompanyIds: [ALMA] };

const ctxDe = (g: IntegrationGrant, pessoa: PersonAccess = topo) => ({
  grant: g,
  person: pessoa,
  origin: 'http' as const,
  companies: [],
  displayName: 'Wesley',
  work: new SqlWorkCatalog({} as never, ATOR as never),
  now: AGORA,
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create type ideworks.urgency_level as enum ('paz', 'alerta', 'perigo');
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.plans(id uuid primary key, name text);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid, plan_id uuid,
      is_active boolean default true, inactive_at timestamptz,
      urgency ideworks.urgency_level not null default 'paz', finance_ok boolean not null default false,
      started_on date, renews_on date,
      -- A ISCA: contato e observações existem na tabela e NÃO podem sair.
      tax_id text, company_email text, phone text, whatsapp text, address text,
      owner_name text, owner_phone text, owner_whatsapp text, notes text);
    create table ideworks.client_quotas(client_id uuid, content_type text, quantity int);
    create table ideworks.client_tags(id uuid primary key, name text, color text);
    create table ideworks.client_tag_assignments(client_id uuid, tag_id uuid);
    create table ideworks.spaces(id uuid primary key, category_id uuid, name text, archived_at timestamptz);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, client_id uuid,
      archived_at timestamptz);
    create function ideworks.integration_allows_company(c uuid) returns boolean language sql as $$ select true $$;
    create function ideworks.integration_allows_client(c uuid) returns boolean language sql as $$ select true $$;
    create function ideworks.client_board_lists(c uuid)
      returns table(id uuid, name text, archived boolean, space_id uuid, space_name text, folder_id uuid, folder_name text)
      language sql as $$
        select l.id, l.name, l.archived_at is not null, s.id, s.name, null::uuid, null::text
          from ideworks.lists l join ideworks.spaces s on s.id = l.space_id
         where l.client_id = c
      $$;

    insert into ideworks.client_categories values ('${IDE}', 'Ide'), ('${FILMES}', 'Filmes'), ('${ALMA}', 'Alma9');
    insert into ideworks.plans values ('${id(20)}', 'Premium');
    insert into ideworks.clients(id, name, category_id, plan_id, is_active, inactive_at, urgency, finance_ok,
        started_on, renews_on, tax_id, company_email, phone, whatsapp, address, owner_name, owner_phone, owner_whatsapp, notes) values
      ('${C_JATOBA}', 'Jatobá', '${IDE}', '${id(20)}', true, null, 'alerta', true, '2024-03-01', '2027-03-01',
        '${ISCA[2]}', '${ISCA[1]}', '${ISCA[0]}', '${ISCA[0]}', '${ISCA[5]}', '${ISCA[3]}', '${ISCA[0]}', '${ISCA[0]}', '${ISCA[4]}'),
      ('${C_SONHO}', 'Sabor Doce', '${IDE}', null, true, null, 'perigo', false, '2025-01-10', null, null, null, null, null, null, null, null, null, null),
      ('${C_AGUA}', 'Água Viva', '${IDE}', null, true, null, 'paz', false, null, '2026-11-15', null, null, null, null, null, null, null, null, null),
      ('${C_FILMES}', 'Cliente Filmes', '${FILMES}', null, true, null, 'alerta', false, null, null, null, null, null, null, null, null, null, null, null),
      ('${C_ALMA}', 'Cliente Alma', '${ALMA}', null, true, null, 'perigo', false, null, null, null, null, null, null, null, null, null, null, null),
      ('${C_ZECA}', 'Zeca', '${IDE}', null, false, '2026-10-04T12:00:00Z', 'perigo', false, null, null, null, null, null, null, null, null, null, null, null);
    insert into ideworks.client_quotas values
      ('${C_JATOBA}', 'video', 8), ('${C_JATOBA}', 'arte', 4), ('${C_JATOBA}', 'desconhecido', 3);
    insert into ideworks.client_tags values ('${id(30)}', 'Restaurante', '#f59e0b'), ('${id(31)}', 'Franquia', '#123456');
    insert into ideworks.client_tag_assignments values
      ('${C_JATOBA}', '${id(30)}'), ('${C_JATOBA}', '${id(31)}'), ('${C_SONHO}', '${id(31)}');
    insert into ideworks.spaces values ('${id(40)}', '${IDE}', 'CLIENTES', null);
    insert into ideworks.lists values ('${id(50)}', '${id(40)}', null, 'Atendimento', '${C_JATOBA}', null);
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe('get_client no banco', () => {
  it('o cadastro sai do banco: plano, urgência, início, renovação, cota vigente, etiquetas, listas (o financeiro não)', async () => {
    const r = await getClientWork(ctxDe(grant()), { id: C_JATOBA });
    if (!r.ok) throw new Error(r.message);
    expect(r.body.client).toEqual({
      id: C_JATOBA,
      name: 'Jatobá',
      company: { id: IDE, name: 'Ide' },
      plan: { id: id(20), name: 'Premium' },
      urgency: 'alerta',
      startedOn: '2024-03-01',
      renewsOn: '2027-03-01',
      // O tipo que o contrato não conhece fica de fora (não quebra a resposta).
      quotas: [
        { type: 'arte', quantity: 4 },
        { type: 'video', quantity: 8 },
      ],
      tags: [
        { id: id(31), name: 'Franquia', color: '#123456' },
        { id: id(30), name: 'Restaurante', color: '#f59e0b' },
      ],
      lists: [
        {
          id: id(50),
          name: 'Atendimento',
          archived: false,
          space: { id: id(40), name: 'CLIENTES' },
          folder: null,
        },
      ],
    });
  });

  it('o contato existe na tabela e nem é lido: o corpo não o leva e a consulta não cita as colunas', async () => {
    textos = [];
    const r = await getClientWork(ctxDe(grant()), { id: C_JATOBA });
    if (!r.ok) throw new Error(r.message);
    const corpo = JSON.stringify(r.body);
    for (const isca of ISCA) expect(corpo).not.toContain(isca);
    const consultas = textos.join('\n');
    expect(consultas).not.toMatch(/tax_id|company_email|phone|whatsapp|address|owner_name|owner_phone|owner_whatsapp|c\.notes/);
    // O financeiro (o cliente pagou?) existe na tabela, fica só na tela e nem é lido.
    expect(consultas).not.toMatch(/finance_ok/);
    expect(corpo).not.toMatch(/financeOk/);
  });

  it('cadastro mínimo e cliente cancelado', async () => {
    const sonho = await getClientWork(ctxDe(grant()), { id: C_SONHO });
    if (!sonho.ok) throw new Error(sonho.message);
    expect(sonho.body.client).toMatchObject({ plan: null, urgency: 'perigo', renewsOn: null, quotas: [] });
    const zeca = await getClientWork(ctxDe(grant()), { id: C_ZECA });
    if (!zeca.ok) throw new Error(zeca.message);
    expect(zeca.body.client).toEqual({ id: C_ZECA, name: 'Zeca', cancelled: true, cancelledOn: '2026-10-04' });
  });

  it('outra empresa, outro cliente, omitida e sem clients:read: a mesma recusa', async () => {
    const negado = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };
    expect(await getClientWork(ctxDe(grant({ allowedCompanyIds: [FILMES] })), { id: C_JATOBA })).toEqual(negado);
    expect(await getClientWork(ctxDe(grant({ allowedClientIds: [C_SONHO] })), { id: C_JATOBA })).toEqual(negado);
    expect(await getClientWork(ctxDe(grant(), semAlma), { id: C_ALMA })).toEqual(negado);
    expect(await getClientWork(ctxDe(grant({ capabilities: ['boards:read'] })), { id: C_JATOBA })).toEqual(negado);
  });
});

describe('list_clients no banco', () => {
  const lista = async (g: IntegrationGrant, input: Parameters<typeof listClientsWork>[1] = {}, pessoa: PersonAccess = topo) => {
    const r = await listClientsWork(ctxDe(g, pessoa), input);
    if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
    return r.body;
  };

  it('a carteira ativa, por nome sem acento, com o cadastro; cancelado fora; sem contato', async () => {
    textos = [];
    const body = await lista(grant());
    expect(body.clients.map((c) => c.name)).toEqual(['Água Viva', 'Cliente Alma', 'Cliente Filmes', 'Jatobá', 'Sabor Doce']);
    expect(body.clients.find((c) => c.id === C_JATOBA)).toEqual({
      id: C_JATOBA,
      name: 'Jatobá',
      company: { id: IDE, name: 'Ide' },
      plan: { id: id(20), name: 'Premium' },
      urgency: 'alerta',
      startedOn: '2024-03-01',
      renewsOn: '2027-03-01',
      tags: [
        { id: id(31), name: 'Franquia', color: '#123456' },
        { id: id(30), name: 'Restaurante', color: '#f59e0b' },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('Zeca');
    for (const isca of ISCA) expect(JSON.stringify(body)).not.toContain(isca);
    expect(textos.join('\n')).not.toMatch(/tax_id|company_email|phone|whatsapp|address|owner_name|c\.notes/);
    expect(textos.join('\n')).not.toMatch(/finance_ok/);
    expect(JSON.stringify(body)).not.toMatch(/financeOk/);
  });

  it('filtros e recorte: empresa, urgência, nome; omitida e concessão por empresa e por cliente', async () => {
    expect((await lista(grant(), { urgency: 'perigo' })).clients.map((c) => c.id)).toEqual([C_ALMA, C_SONHO]);
    expect((await lista(grant(), { q: 'agua' })).clients.map((c) => c.id)).toEqual([C_AGUA]);
    expect((await lista(grant(), { companyId: FILMES })).clients.map((c) => c.id)).toEqual([C_FILMES]);

    const sem = await lista(grant(), {}, semAlma);
    expect(sem.clients.map((c) => c.id)).not.toContain(C_ALMA);
    expect(JSON.stringify(sem)).not.toContain('Alma');
    textos = [];
    await lista(grant(), {}, semAlma);
    expect(textos.some((t) => t.includes('not (c.category_id = any('))).toBe(true);

    expect((await lista(grant({ allowedCompanyIds: [IDE] }))).clients.map((c) => c.id)).toEqual([C_AGUA, C_JATOBA, C_SONHO]);
    expect((await lista(grant({ allowedClientIds: [C_JATOBA] }))).clients.map((c) => c.id)).toEqual([C_JATOBA]);
    expect((await lista(grant({ allowedClientIds: ['nao-e-uuid'] }))).clients).toEqual([]);
    const semCap = await listClientsWork(ctxDe(grant({ capabilities: ['boards:read'] })), {});
    expect(semCap.ok).toBe(false);
  });

  it('o cursor anda até o fim contra o banco', async () => {
    const vistos: string[] = [];
    let cursor: string | undefined;
    let voltas = 0;
    do {
      const pagina = await lista(grant(), { limit: 2, cursor });
      vistos.push(...pagina.clients.map((c) => c.id));
      cursor = pagina.nextCursor ?? undefined;
      voltas += 1;
    } while (cursor && voltas < 10);
    expect(vistos).toEqual([C_AGUA, C_ALMA, C_FILMES, C_JATOBA, C_SONHO]);
  });
});
