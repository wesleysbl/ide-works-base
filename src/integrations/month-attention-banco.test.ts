/**
 * `get_month_attention`, `get_client_month` e `get_calendar` CONTRA UM POSTGRES DE VERDADE
 * — conferência de 08/10/2026, G1 e G2.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   A leitura SQL do retrato do mês (`SqlDeliveryCatalog.loadPlanning`, com o
 *   ritual de `month_contracts` na mesma leitura do contrato) sob a regra da
 *   tela (`planejarMes` + `listaDeAtencao`), rodando sobre o PGlite (Postgres em
 *   WebAssembly, no processo — nenhuma rede):
 *     · o corpo da ferramenta com o banco é IGUAL ao do dublê em memória para os
 *       mesmos dados (o SQL e o dublê não discordam);
 *     · o ritual sai com quando e por quem, e o link de aprovação do cliente
 *       (a tabela existe no banco) não vai a lugar nenhum;
 *     · empresa omitida, empresa fora da concessão, cliente fora da concessão e
 *       cliente cancelado não saem do banco (o recorte é no `where`).
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha e as funções de concessão reais
 *   (`integration_allows_company`/`_client`): aqui dizem "sim" para tudo, porque
 *   o recorte que importa à ferramenta é o do TypeScript, que vira cláusula.
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IntegrationGrant, PersonAccess } from '@/integrations/grants';
import type { Tx } from '@/server/db';

/* ───────────────────────────── o adaptador ───────────────────────────── */

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

const { getMonthAttention } = await import('@/integrations/month-attention');
const { getCalendar, getClientMonth } = await import('@/integrations/client-month');
const { MemoryDeliveryCatalog, SqlDeliveryCatalog, getPlanningWeeks } = await import('@/integrations/reports');

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const IDE = id(1);
const FILMES = id(2);
const ALMA = id(3);
const C_JATOBA = id(10);
const C_SONHO = id(11);
const C_REBROTA = id(12);
const C_FILMES = id(13);
const C_ALMA = id(14);
const C_ZECA = id(15);
const C_HUB = id(16);
const F_HELENA = id(30);
const F_ALMA = id(31);
const F_FILMES = id(32);
const EU = id(99);
const HELENA = id(91);
const ANA = id(92);

const ATOR = { kind: 'user' as const, userId: EU, isSuperadmin: true, isSuper: true };
const TOKEN_DO_CLIENTE = 'token-secreto-do-link-do-cliente-que-nunca-sai';
const NOTA = 'Levar o tripé e falar com o João 11 99999-0000';
const AGORA = new Date('2026-10-05T12:00:00.000Z');

const grant = (over: Partial<IntegrationGrant> = {}): IntegrationGrant => ({
  id: id(200),
  ownerId: EU,
  oauthClientId: 'cliente-oauth',
  name: 'Claude',
  capabilities: ['reports:delivery:read', 'people:read'],
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

const COMPANIES = [
  { id: IDE, name: 'Ide' },
  { id: FILMES, name: 'Filmes' },
  { id: ALMA, name: 'Alma9' },
];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid,
      is_active boolean default true, inactive_at timestamptz);
    create table ideworks.people(id uuid primary key, name text);
    create function ideworks.display_name(u uuid) returns text language sql as
      $$ select name from ideworks.people where id = u $$;
    create function ideworks.integration_allows_company(c uuid) returns boolean language sql as $$ select true $$;
    create function ideworks.integration_allows_client(c uuid) returns boolean language sql as $$ select true $$;
    create table ideworks.month_contracts(id uuid primary key, client_id uuid, reference_month date,
      planning_done_at timestamptz, planning_done_by uuid,
      client_approved_at timestamptz, client_approved_by uuid);
    create table ideworks.month_contract_items(contract_id uuid, content_type text, quantity int);
    create table ideworks.client_quotas(client_id uuid, content_type text, quantity int);
    create table ideworks.spaces(id uuid primary key, category_id uuid);
    create table ideworks.folders(id uuid primary key, space_id uuid, name text, archived_at timestamptz);
    create table ideworks.lists(id uuid primary key, client_id uuid, folder_id uuid, archived_at timestamptz);
    create table ideworks.user_clients(user_id uuid, client_id uuid);
    create table ideworks.content_items(id uuid primary key, client_id uuid, reference_month date,
      content_type text, scheduled_at timestamptz, completed_at timestamptz, is_extra boolean default false,
      title text, created_at timestamptz default now());
    create table ideworks.appointments(id uuid primary key, client_id uuid, day date, start_time time,
      title text, notes text);
    -- O link do cliente existe no banco e NÃO pode sair pela ferramenta.
    create table ideworks.client_approval_links(client_id uuid, token_hash text, token_ciphertext text);

    insert into ideworks.client_categories values ('${IDE}', 'Ide'), ('${FILMES}', 'Filmes'), ('${ALMA}', 'Alma9');
    insert into ideworks.people values ('${HELENA}', 'Helena'), ('${ANA}', 'Ana'), ('${EU}', 'Wesley');
    insert into ideworks.clients(id, name, category_id, is_active, inactive_at) values
      ('${C_JATOBA}', 'Jatobá', '${IDE}', true, null),
      ('${C_SONHO}', 'Sabor Doce', '${IDE}', true, null),
      ('${C_REBROTA}', 'Rebrota', '${IDE}', true, null),
      ('${C_HUB}', 'Cliente HUB', '${IDE}', true, null),
      ('${C_FILMES}', 'Cliente Filmes', '${FILMES}', true, null),
      ('${C_ALMA}', 'Cliente Alma', '${ALMA}', true, null),
      ('${C_ZECA}', 'Zeca', '${IDE}', false, '2026-10-04T12:00:00Z');

    insert into ideworks.month_contracts values
      ('${id(300)}', '${C_JATOBA}', '2026-10-01', '2026-10-02T13:00:00Z', '${HELENA}', null, null),
      ('${id(301)}', '${C_SONHO}', '2026-10-01', '2026-10-01T13:00:00Z', '${HELENA}', '2026-10-02T15:00:00Z', '${ANA}'),
      ('${id(302)}', '${C_HUB}', '2026-10-01', null, null, null, null),
      ('${id(303)}', '${C_FILMES}', '2026-10-01', '2026-10-01T13:00:00Z', null, '2026-10-02T15:00:00Z', null),
      ('${id(304)}', '${C_ALMA}', '2026-10-01', null, null, null, null),
      ('${id(305)}', '${C_ZECA}', '2026-10-01', null, null, null, null);
    insert into ideworks.month_contract_items values
      ('${id(300)}', 'video', 8), ('${id(300)}', 'arte', 4),
      ('${id(301)}', 'arte', 2),
      ('${id(303)}', 'foto', 2),
      ('${id(304)}', 'video', 4),
      ('${id(305)}', 'video', 4);
    insert into ideworks.client_quotas values
      ('${C_REBROTA}', 'arte', 3), ('${C_JATOBA}', 'video', 8), ('${C_SONHO}', 'arte', 2), ('${C_ZECA}', 'video', 4);

    insert into ideworks.spaces values ('${id(40)}', '${IDE}'), ('${id(41)}', '${ALMA}'), ('${id(42)}', '${FILMES}');
    insert into ideworks.folders values
      ('${F_HELENA}', '${id(40)}', 'TIME HELENA', null),
      ('${F_ALMA}', '${id(41)}', 'TIME ALMA9 INTERNO', null),
      ('${F_FILMES}', '${id(42)}', 'TIME FILMES', null);
    -- Listas de espaços de OUTRAS empresas ligadas a um cliente da Ide: a pasta delas
    -- (o time da Alma9, omitida, e o da Filmes) não pode virar "responsável" do cliente.
    insert into ideworks.lists values
      ('${id(50)}', '${C_JATOBA}', '${F_HELENA}', null),
      ('${id(51)}', '${C_SONHO}', '${F_HELENA}', null),
      ('${id(52)}', '${C_JATOBA}', '${F_ALMA}', null),
      ('${id(53)}', '${C_JATOBA}', '${F_FILMES}', null);
    insert into ideworks.user_clients values ('${ANA}', '${C_REBROTA}');

    insert into ideworks.content_items(id, client_id, reference_month, content_type, scheduled_at, completed_at, title) values
      ('${id(400)}', '${C_JATOBA}', '2026-10-01', 'video', '2026-10-02T12:00:00Z', '2026-10-02T12:00:00Z', 'Reels de abertura'),
      ('${id(401)}', '${C_JATOBA}', '2026-10-01', 'video', '2026-10-03T12:00:00Z', null, null),
      ('${id(402)}', '${C_JATOBA}', '2026-10-01', 'video', '2026-10-08T12:00:00Z', null, null),
      ('${id(403)}', '${C_JATOBA}', '2026-10-01', 'video', null, null, null),
      ('${id(404)}', '${C_JATOBA}', '2026-10-01', 'arte', '2026-10-12T12:00:00Z', null, null),
      ('${id(405)}', '${C_SONHO}', '2026-10-01', 'arte', '2026-10-02T12:00:00Z', '2026-10-02T12:00:00Z', null),
      ('${id(406)}', '${C_SONHO}', '2026-10-01', 'arte', '2026-10-06T12:00:00Z', null, null),
      ('${id(407)}', '${C_FILMES}', '2026-10-01', 'foto', '2026-10-14T12:00:00Z', '2026-10-14T12:00:00Z', null),
      ('${id(408)}', '${C_ALMA}', '2026-10-01', 'video', '2026-10-06T12:00:00Z', '2026-10-06T12:00:00Z', null),
      ('${id(409)}', '${C_ZECA}', '2026-10-01', 'video', '2026-10-03T12:00:00Z', null, null),
      -- 01h30 UTC de 07/10 é 22h30 de 06/10 em São Paulo: o calendário mostra o dia de São Paulo.
      ('${id(410)}', '${C_SONHO}', '2026-10-01', 'arte', '2026-10-07T01:30:00Z', null, 'Perto da meia-noite');
    insert into ideworks.appointments values
      ('${id(500)}', '${C_JATOBA}', '2026-10-06', '14:30', 'Gravação na loja', '${NOTA}'),
      ('${id(501)}', '${C_JATOBA}', '2026-10-08', null, 'Reunião de alinhamento', null),
      ('${id(502)}', '${C_FILMES}', '2026-10-08', '09:00', 'Reunião Filmes', null),
      ('${id(503)}', '${C_ALMA}', '2026-10-07', '10:00', 'Reunião Alma', null),
      ('${id(504)}', '${C_ZECA}', '2026-10-02', '10:00', 'Reunião Zeca', null),
      ('${id(505)}', '${C_JATOBA}', '2026-11-10', null, 'Fora do período', null);

    insert into ideworks.client_approval_links values ('${C_JATOBA}', 'hash-1', '${TOKEN_DO_CLIENTE}');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** O mesmo terreno, no dublê em memória — para provar que o SQL e o dublê não discordam. */
const MEMORIA = new MemoryDeliveryCatalog({
  clients: [
    { id: C_JATOBA, name: 'Jatobá', companyId: IDE, companyName: 'Ide' },
    { id: C_SONHO, name: 'Sabor Doce', companyId: IDE, companyName: 'Ide' },
    { id: C_REBROTA, name: 'Rebrota', companyId: IDE, companyName: 'Ide' },
    { id: C_HUB, name: 'Cliente HUB', companyId: IDE, companyName: 'Ide' },
    { id: C_FILMES, name: 'Cliente Filmes', companyId: FILMES, companyName: 'Filmes' },
    { id: C_ALMA, name: 'Cliente Alma', companyId: ALMA, companyName: 'Alma9' },
    { id: C_ZECA, name: 'Zeca', companyId: IDE, companyName: 'Ide', isActive: false, cancelledOn: '2026-10-04' },
  ],
  contracts: [
    { clientId: C_JATOBA, referenceMonth: '2026-10-01', contentType: 'video', quantity: 8 },
    { clientId: C_JATOBA, referenceMonth: '2026-10-01', contentType: 'arte', quantity: 4 },
    { clientId: C_SONHO, referenceMonth: '2026-10-01', contentType: 'arte', quantity: 2 },
    { clientId: C_FILMES, referenceMonth: '2026-10-01', contentType: 'foto', quantity: 2 },
    { clientId: C_ALMA, referenceMonth: '2026-10-01', contentType: 'video', quantity: 4 },
    { clientId: C_ZECA, referenceMonth: '2026-10-01', contentType: 'video', quantity: 4 },
  ],
  opened: [{ clientId: C_HUB, referenceMonth: '2026-10-01' }],
  ritual: [
    {
      clientId: C_JATOBA,
      referenceMonth: '2026-10-01',
      planningDoneAt: '2026-10-02T13:00:00.000Z',
      planningDoneBy: { id: HELENA, name: 'Helena' },
      clientApprovedAt: null,
      clientApprovedBy: null,
    },
    {
      clientId: C_SONHO,
      referenceMonth: '2026-10-01',
      planningDoneAt: '2026-10-01T13:00:00.000Z',
      planningDoneBy: { id: HELENA, name: 'Helena' },
      clientApprovedAt: '2026-10-02T15:00:00.000Z',
      clientApprovedBy: { id: ANA, name: 'Ana' },
    },
    {
      clientId: C_FILMES,
      referenceMonth: '2026-10-01',
      planningDoneAt: '2026-10-01T13:00:00.000Z',
      planningDoneBy: null,
      clientApprovedAt: '2026-10-02T15:00:00.000Z',
      clientApprovedBy: null,
    },
  ],
  items: [
    { id: id(400), clientId: C_JATOBA, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: true, scheduledOn: '2026-10-02', title: 'Reels de abertura' },
    { id: id(401), clientId: C_JATOBA, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: false, scheduledOn: '2026-10-03' },
    { id: id(402), clientId: C_JATOBA, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: false, scheduledOn: '2026-10-08' },
    { id: id(403), clientId: C_JATOBA, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: false, scheduledOn: null },
    { id: id(404), clientId: C_JATOBA, referenceMonth: '2026-10-01', contentType: 'arte', isExtra: false, isCompleted: false, scheduledOn: '2026-10-12' },
    { id: id(405), clientId: C_SONHO, referenceMonth: '2026-10-01', contentType: 'arte', isExtra: false, isCompleted: true, scheduledOn: '2026-10-02' },
    { id: id(406), clientId: C_SONHO, referenceMonth: '2026-10-01', contentType: 'arte', isExtra: false, isCompleted: false, scheduledOn: '2026-10-06' },
    { id: id(407), clientId: C_FILMES, referenceMonth: '2026-10-01', contentType: 'foto', isExtra: false, isCompleted: true, scheduledOn: '2026-10-14' },
    { id: id(408), clientId: C_ALMA, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: true, scheduledOn: '2026-10-06' },
    { id: id(409), clientId: C_ZECA, referenceMonth: '2026-10-01', contentType: 'video', isExtra: false, isCompleted: false, scheduledOn: '2026-10-03' },
    { id: id(410), clientId: C_SONHO, referenceMonth: '2026-10-01', contentType: 'arte', isExtra: false, isCompleted: false, scheduledOn: null, scheduledAt: '2026-10-07T01:30:00.000Z', title: 'Perto da meia-noite' },
  ],
  appointments: [
    { id: id(500), clientId: C_JATOBA, day: '2026-10-06', time: '14:30', title: 'Gravação na loja', notes: NOTA },
    { id: id(501), clientId: C_JATOBA, day: '2026-10-08', time: null, title: 'Reunião de alinhamento', notes: null },
    { id: id(502), clientId: C_FILMES, day: '2026-10-08', time: '09:00', title: 'Reunião Filmes' },
    { id: id(503), clientId: C_ALMA, day: '2026-10-07', time: '10:00', title: 'Reunião Alma' },
    { id: id(504), clientId: C_ZECA, day: '2026-10-02', time: '10:00', title: 'Reunião Zeca' },
    { id: id(505), clientId: C_JATOBA, day: '2026-11-10', time: null, title: 'Fora do período' },
  ],
  registry: [
    { clientId: C_REBROTA, contentType: 'arte', quantity: 3 },
    { clientId: C_JATOBA, contentType: 'video', quantity: 8 },
    { clientId: C_SONHO, contentType: 'arte', quantity: 2 },
    { clientId: C_ZECA, contentType: 'video', quantity: 4 },
  ],
  // Na ordem do banco (`order by f.name`).
  folders: [
    { clientId: C_JATOBA, folderId: F_ALMA, folderName: 'TIME ALMA9 INTERNO', companyId: ALMA },
    { clientId: C_JATOBA, folderId: F_FILMES, folderName: 'TIME FILMES', companyId: FILMES },
    { clientId: C_JATOBA, folderId: F_HELENA, folderName: 'TIME HELENA', companyId: IDE },
    { clientId: C_SONHO, folderId: F_HELENA, folderName: 'TIME HELENA', companyId: IDE },
  ],
  portfolio: [{ clientId: C_REBROTA, userId: ANA, name: 'Ana' }],
});

const banco = () => new SqlDeliveryCatalog({} as never, ATOR as never);

function ctx(delivery: InstanceType<typeof SqlDeliveryCatalog> | InstanceType<typeof MemoryDeliveryCatalog>, g = grant(), person = topo) {
  return { grant: g, person, origin: 'http' as const, companies: COMPANIES, displayName: 'Wesley', delivery, now: AGORA };
}

async function ok(delivery: Parameters<typeof ctx>[0], input: Parameters<typeof getMonthAttention>[1], g = grant(), person = topo) {
  const r = await getMonthAttention(ctx(delivery, g, person), input);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.body;
}

describe('get_month_attention no banco', () => {
  it('o corpo com o SQL é IGUAL ao do dublê em memória para os mesmos dados', async () => {
    const doBanco = await ok(banco(), { month: '2026-10' });
    const daMemoria = await ok(MEMORIA, { month: '2026-10' });
    expect(doBanco).toEqual(daMemoria);
    expect(doBanco.clients.length).toBe(6);
    expect(doBanco.clients.find((c) => c.id === C_JATOBA)?.reasons.map((r) => r.key)).toEqual([
      'atrasadas',
      'semana-em-risco',
      'sem-dia',
    ]);
  });

  it('o ritual vem do banco com quando e por quem (nome de pessoa só com people:read)', async () => {
    const com = await ok(banco(), { month: '2026-10' });
    const sonho = com.clients.find((c) => c.id === C_SONHO);
    expect(sonho?.stage).toBe('aprovado');
    expect(sonho?.ritual).toEqual({
      monthOpened: true,
      planningDoneAt: '2026-10-01T13:00:00.000Z',
      planningDoneBy: { id: HELENA, name: 'Helena' },
      clientApprovedAt: '2026-10-02T15:00:00.000Z',
      clientApprovedBy: { id: ANA, name: 'Ana' },
    });
    expect(com.clients.find((c) => c.id === C_FILMES)?.ritual.planningDoneBy).toBeNull();
    expect(com.clients.find((c) => c.id === C_REBROTA)?.stage).toBe('fechado');

    const sem = await ok(banco(), { month: '2026-10' }, grant({ capabilities: ['reports:delivery:read'] }));
    expect(sem.clients.find((c) => c.id === C_SONHO)?.ritual).toMatchObject({ planningDoneBy: null, clientApprovedBy: null });
    expect(sem.clients.find((c) => c.id === C_REBROTA)?.owners).toEqual([{ id: ANA, name: null, kind: 'person' }]);
    expect(JSON.stringify(sem)).not.toContain('Helena');
    expect(JSON.stringify(sem)).not.toContain('Ana');
  });

  it('o link do cliente existe no banco e não sai: o token não aparece no corpo nem é lido', async () => {
    textos = [];
    const corpo = JSON.stringify(await ok(banco(), { month: '2026-10' }));
    expect(corpo).not.toContain(TOKEN_DO_CLIENTE);
    expect(textos.join('\n')).not.toContain('client_approval_links');
    expect(textos.join('\n')).not.toMatch(/token_/);
  });

  it('empresa omitida: a Alma9 e o cliente dela nem são lidos (o recorte está no where)', async () => {
    textos = [];
    const body = await ok(banco(), { month: '2026-10' }, grant(), semAlma);
    expect(body.clients.map((c) => c.id)).not.toContain(C_ALMA);
    expect(JSON.stringify(body)).not.toContain('Alma');
    expect(textos.some((t) => t.includes('not (c.category_id = any('))).toBe(true);
    const pelaId = await getMonthAttention(ctx(banco(), grant(), semAlma), { month: '2026-10', clientId: C_ALMA });
    expect(pelaId.ok).toBe(false);
  });

  it('concessão por empresa e por cliente: outro cliente, mesmo da empresa concedida, não sai', async () => {
    const soIde = await ok(banco(), { month: '2026-10' }, grant({ allowedCompanyIds: [IDE] }));
    expect(soIde.clients.map((c) => c.id).sort()).toEqual([C_HUB, C_JATOBA, C_REBROTA, C_SONHO].sort());

    const soJatoba = await ok(banco(), { month: '2026-10' }, grant({ allowedClientIds: [C_JATOBA] }));
    expect(soJatoba.clients.map((c) => c.id)).toEqual([C_JATOBA]);
    expect(soJatoba.summary.clients).toBe(1);
    const outro = await getMonthAttention(ctx(banco(), grant({ allowedClientIds: [C_JATOBA] })), {
      month: '2026-10',
      clientId: C_SONHO,
    });
    expect(outro.ok).toBe(false);
    if (!outro.ok) expect(outro.code).toBe('permission_denied');
  });

  it('cliente cancelado não sai nem pelo id', async () => {
    const body = await ok(banco(), { month: '2026-10' });
    expect(body.clients.map((c) => c.id)).not.toContain(C_ZECA);
    const pelaId = await getMonthAttention(ctx(banco()), { month: '2026-10', clientId: C_ZECA });
    expect(pelaId.ok).toBe(false);
  });

  it('cursor anda até o fim contra o banco', async () => {
    const todos = (await ok(banco(), { month: '2026-10' })).clients.map((c) => c.id);
    const vistos: string[] = [];
    let cursor: string | undefined;
    let voltas = 0;
    do {
      const pagina = await ok(banco(), { month: '2026-10', limit: 2, cursor });
      vistos.push(...pagina.clients.map((c) => c.id));
      cursor = pagina.nextCursor ?? undefined;
      voltas += 1;
    } while (cursor && voltas < 10);
    expect(vistos).toEqual(todos);
  });
});

describe('pasta (time) de outra empresa não vira "responsável" do cliente', () => {
  /** Os nomes dos responsáveis do Jatobá, que tem listas em pastas de três empresas. */
  const donosDoJatoba = (clients: readonly { id: string; owners: readonly { name: string | null }[] }[]) =>
    clients.find((c) => c.id === C_JATOBA)?.owners.map((o) => o.name);

  it('CONTROLE: sem omitida nem concessão estreita, as três pastas aparecem (por nome)', async () => {
    const body = await ok(banco(), { month: '2026-10' });
    expect(donosDoJatoba(body.clients)).toEqual(['TIME ALMA9 INTERNO', 'TIME FILMES', 'TIME HELENA']);
  });

  it('get_month_attention: com a Alma9 omitida, o time da Alma9 não sai em clients[].owners nem em groups[].owner', async () => {
    const body = await ok(banco(), { month: '2026-10' }, grant(), semAlma);
    expect(donosDoJatoba(body.clients)).toEqual(['TIME FILMES', 'TIME HELENA']);
    expect(JSON.stringify(body)).not.toContain('ALMA9');
    expect(body.groups.map((g) => g.owner?.id)).not.toContain(F_ALMA);
  });

  it('get_month_attention: o filtro ownerId com a pasta da empresa omitida não acha ninguém', async () => {
    const body = await ok(banco(), { month: '2026-10', ownerId: F_ALMA }, grant(), semAlma);
    expect(body.clients).toEqual([]);
    expect(body.summary.clients).toBe(0);
  });

  it('get_month_attention: concessão só da Ide não mostra a pasta da Filmes nem a da Alma9', async () => {
    const body = await ok(banco(), { month: '2026-10' }, grant({ allowedCompanyIds: [IDE] }));
    expect(donosDoJatoba(body.clients)).toEqual(['TIME HELENA']);
    expect(JSON.stringify(body)).not.toContain('FILMES');
    expect(JSON.stringify(body)).not.toContain('ALMA9');
  });

  it('get_client_month: o time da empresa omitida e o da fora da concessão não saem em client.owners', async () => {
    const semOmitida = await getClientMonth(ctx(banco(), grant(), semAlma), { clientId: C_JATOBA, month: '2026-10' });
    if (!semOmitida.ok) throw new Error(semOmitida.message);
    expect(semOmitida.body.client.owners.map((o) => o.name)).toEqual(['TIME FILMES', 'TIME HELENA']);
    expect(JSON.stringify(semOmitida.body)).not.toContain('ALMA9');

    const soIde = await getClientMonth(ctx(banco(), grant({ allowedCompanyIds: [IDE] })), {
      clientId: C_JATOBA,
      month: '2026-10',
    });
    if (!soIde.ok) throw new Error(soIde.message);
    expect(soIde.body.client.owners.map((o) => o.name)).toEqual(['TIME HELENA']);
  });

  it('get_planning_weeks (o mais antigo): a mesma regra', async () => {
    const r = await getPlanningWeeks(ctx(banco(), grant(), semAlma), { month: '2026-10' });
    if (!r.ok) throw new Error(r.message);
    expect(JSON.stringify(r.body)).not.toContain('ALMA9');
    const soIde = await getPlanningWeeks(ctx(banco(), grant({ allowedCompanyIds: [IDE] })), { month: '2026-10' });
    if (!soIde.ok) throw new Error(soIde.message);
    expect(JSON.stringify(soIde.body)).not.toContain('FILMES');
    expect(JSON.stringify(soIde.body)).not.toContain('ALMA9');
    expect(soIde.body.clients.find((c) => c.id === C_JATOBA)?.owners.map((o) => o.name)).toEqual(['TIME HELENA']);
  });

  it('o recorte da pasta é no where: o espaço entra na consulta e a omitida sai por ele', async () => {
    textos = [];
    await ok(banco(), { month: '2026-10' }, grant(), semAlma);
    const pastas = textos.find((t) => t.includes('ideworks.folders f'));
    expect(pastas).toBeDefined();
    expect(pastas).toContain('ideworks.spaces sp');
    expect(pastas).toContain('integration_allows_company(sp.category_id)');
    expect(pastas).toContain('not (sp.category_id = any(');
  });

  it('o dublê em memória concorda com o banco quando a pasta tem a empresa', async () => {
    const daMemoria = await ok(MEMORIA, { month: '2026-10' }, grant(), semAlma);
    const doBanco = await ok(banco(), { month: '2026-10' }, grant(), semAlma);
    expect(daMemoria).toEqual(doBanco);
    const soIde = grant({ allowedCompanyIds: [IDE] });
    expect(await ok(MEMORIA, { month: '2026-10' }, soIde)).toEqual(await ok(banco(), { month: '2026-10' }, soIde));
  });
});

describe('get_planning_weeks no banco: o nome da pessoa da carteira é de people:read', () => {
  it('sem people:read o nome é nulo e o id fica; com people:read o nome volta', async () => {
    const sem = await getPlanningWeeks(ctx(banco(), grant({ capabilities: ['reports:delivery:read'] })), { month: '2026-10' });
    if (!sem.ok) throw new Error(sem.message);
    expect(JSON.stringify(sem.body)).not.toContain('"Ana"');
    expect(sem.body.clients.find((c) => c.id === C_REBROTA)?.owners).toEqual([{ id: ANA, name: null, kind: 'person' }]);
    expect(sem.body.groups.find((g) => g.owner?.id === ANA)?.owner).toEqual({ id: ANA, name: null, kind: 'person' });

    const com = await getPlanningWeeks(ctx(banco()), { month: '2026-10' });
    if (!com.ok) throw new Error(com.message);
    expect(com.body.clients.find((c) => c.id === C_REBROTA)?.owners).toEqual([{ id: ANA, name: 'Ana', kind: 'person' }]);
  });
});

describe('get_client_month no banco', () => {
  it('o corpo com o SQL é IGUAL ao do dublê em memória, com o medidor e cada peça', async () => {
    for (const clientId of [C_JATOBA, C_SONHO, C_REBROTA, C_FILMES]) {
      const doBanco = await getClientMonth(ctx(banco()), { clientId, month: '2026-10' });
      const daMemoria = await getClientMonth(ctx(MEMORIA), { clientId, month: '2026-10' });
      expect(doBanco.ok).toBe(true);
      expect(doBanco).toEqual(daMemoria);
    }
    const jatoba = await getClientMonth(ctx(banco()), { clientId: C_JATOBA, month: '2026-10' });
    if (!jatoba.ok) throw new Error(jatoba.message);
    expect(jatoba.body.meter.measurable).toBe(true);
    expect(jatoba.body.pieces.map((p) => [p.day, p.signal])).toEqual([
      ['2026-10-02', 'feita'],
      ['2026-10-03', 'atrasada'],
      ['2026-10-08', 'agendada'],
      ['2026-10-12', 'agendada'],
      [null, null],
    ]);
    expect(jatoba.body.contract.items).toEqual([
      { type: 'video', quantity: 8 },
      { type: 'arte', quantity: 4 },
    ]);
  });

  it('outro cliente, outra empresa, omitida, cancelado e inexistente: a mesma recusa', async () => {
    const recusa = { ok: false, code: 'permission_denied', message: 'Fora do alcance desta integração.' };
    expect(await getClientMonth(ctx(banco(), grant({ allowedClientIds: [C_JATOBA] })), { clientId: C_SONHO, month: '2026-10' })).toEqual(recusa);
    expect(await getClientMonth(ctx(banco(), grant({ allowedCompanyIds: [FILMES] })), { clientId: C_JATOBA, month: '2026-10' })).toEqual(recusa);
    expect(await getClientMonth(ctx(banco(), grant(), semAlma), { clientId: C_ALMA, month: '2026-10' })).toEqual(recusa);
    expect(await getClientMonth(ctx(banco()), { clientId: C_ZECA, month: '2026-10' })).toEqual(recusa);
    expect(await getClientMonth(ctx(banco()), { clientId: id(777), month: '2026-10' })).toEqual(recusa);
    expect(await getClientMonth(ctx(banco()), { clientId: 'nao-e-uuid', month: '2026-10' })).toEqual(recusa);
  });
});

describe('get_calendar no banco', () => {
  const periodo = { from: '2026-10-01', to: '2026-10-31' };

  it('o corpo com o SQL é IGUAL ao do dublê em memória, na ordem do calendário', async () => {
    const doBanco = await getCalendar(ctx(banco()), periodo);
    const daMemoria = await getCalendar(ctx(MEMORIA), periodo);
    expect(doBanco.ok).toBe(true);
    expect(doBanco).toEqual(daMemoria);
    if (!doBanco.ok) return;
    // O dia é o de São Paulo: a peça das 01h30 UTC de 07/10 cai em 06/10.
    expect(doBanco.body.entries.find((e) => e.title === 'Perto da meia-noite')?.day).toBe('2026-10-06');
    // Hora só no compromisso; com hora vem antes de sem hora; no empate de cliente, o id.
    const dia8 = doBanco.body.entries.filter((e) => e.day === '2026-10-08');
    expect(dia8.map((e) => [e.time, e.kind])).toEqual([
      ['09:00', 'appointment'],
      [null, 'delivery'],
      [null, 'appointment'],
    ]);
  });

  it('empresa omitida, cliente fora da concessão e cancelado não saem do banco (o recorte é o where)', async () => {
    textos = [];
    const semOmitida = await getCalendar(ctx(banco(), grant(), semAlma), periodo);
    if (!semOmitida.ok) throw new Error(semOmitida.message);
    expect(semOmitida.body.entries.map((e) => e.client.id)).not.toContain(C_ALMA);
    expect(semOmitida.body.entries.map((e) => e.client.id)).not.toContain(C_ZECA);
    expect(JSON.stringify(semOmitida.body)).not.toContain('Alma');
    expect(textos.some((t) => t.includes('not (c.category_id = any('))).toBe(true);

    const soSonho = await getCalendar(ctx(banco(), grant({ allowedClientIds: [C_SONHO] })), periodo);
    if (!soSonho.ok) throw new Error(soSonho.message);
    expect(new Set(soSonho.body.entries.map((e) => e.client.id))).toEqual(new Set([C_SONHO]));

    const soFilmes = await getCalendar(ctx(banco(), grant({ allowedCompanyIds: [FILMES] })), periodo);
    if (!soFilmes.ok) throw new Error(soFilmes.message);
    expect(new Set(soFilmes.body.entries.map((e) => e.client.id))).toEqual(new Set([C_FILMES]));
  });

  it('com clientId: só o cliente; de fora, cancelado ou omitido é recusa; sem nada no período é vazio', async () => {
    const um = await getCalendar(ctx(banco()), { ...periodo, clientId: C_JATOBA });
    if (!um.ok) throw new Error(um.message);
    expect(new Set(um.body.entries.map((e) => e.client.id))).toEqual(new Set([C_JATOBA]));
    const vazio = await getCalendar(ctx(banco()), { from: '2026-12-01', to: '2026-12-31', clientId: C_JATOBA });
    expect(vazio.ok && vazio.body.entries).toEqual([]);
    for (const [g, p, clientId] of [
      [grant({ allowedClientIds: [C_SONHO] }), topo, C_JATOBA],
      [grant(), semAlma, C_ALMA],
      [grant(), topo, C_ZECA],
      [grant(), topo, id(777)],
      [grant(), topo, 'nao-e-uuid'],
    ] as const) {
      const r = await getCalendar(ctx(banco(), g, p), { ...periodo, clientId });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('permission_denied');
    }
  });

  it('as observações do compromisso e o link do cliente nem são lidos; o corpo não os leva', async () => {
    textos = [];
    const corpo = JSON.stringify(await getCalendar(ctx(banco()), periodo));
    expect(corpo).not.toContain('tripé');
    expect(corpo).not.toContain('99999');
    expect(corpo).not.toContain(TOKEN_DO_CLIENTE);
    expect(textos.join('\n')).not.toMatch(/a\.notes|client_approval_links/);
  });

  it('cursor anda até o fim contra o banco', async () => {
    const todas = await getCalendar(ctx(banco()), periodo);
    if (!todas.ok) throw new Error(todas.message);
    const vistas: string[] = [];
    let cursor: string | undefined;
    let voltas = 0;
    do {
      const pagina = await getCalendar(ctx(banco()), { ...periodo, limit: 3, cursor });
      if (!pagina.ok) throw new Error(pagina.message);
      vistas.push(...pagina.body.entries.map((e) => e.id));
      cursor = pagina.body.nextCursor ?? undefined;
      voltas += 1;
    } while (cursor && voltas < 10);
    expect(vistas).toEqual(todas.body.entries.map((e) => e.id));
  });
});
