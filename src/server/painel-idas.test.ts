/**
 * O PAINEL, EM IDAS E EM LINHAS — perf do servidor, 08/10/2026.
 *
 * `readPanel` (a tela principal) fazia sete consultas em fila e depois as três
 * da situação de entrega, todas com parâmetro (meses, dias, ids das omitidas,
 * ids dos clientes ativos): 23 idas com `prepare: false`. Agora os parâmetros
 * vão no texto e saem duas levas — as sete independentes, e as três que
 * dependem dos ids dos clientes ativos.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. NO FIO (driver real + servidor de fio): de 23 (medido em 2264a4f) para 4
 *      idas (begin, leva 1, leva 2, commit), sem parâmetro algum.
 *   2. NO POSTGRES DE VERDADE (PGlite): a resposta com os valores no texto é
 *      IDÊNTICA à com parâmetros — com e sem empresa omitida, em três intervalos,
 *      com cliente cancelado no meio do período e com cliente de outra empresa.
 */
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '@/server/db';
import { readPanel } from '@/server/panel';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDE = id(1);
const ALMA = id(2);
const C_ATIVO = id(10);
const C_ALMA = id(11);
const C_CANCELADO = id(12);
const EU = id(99);
const AGORA = new Date('2026-10-08T15:00:00.000Z');

const base: AuthenticatedActor = {
  userId: EU,
  email: 'eu@ide.com',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
  areas: [],
  hasAllClientsAccess: true,
};
const desligado = base;
const ligado: AuthenticatedActor = { ...base, categoriasOmitidas: [ALMA] };

/* ───────────────────────────── no fio ───────────────────────────── */

describe('readPanel — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      {
        quando: /from ideworks\.clients c\s+join ideworks\.client_categories cat/,
        colunas: [
          'id', 'name', 'category_id', 'category_name', 'category_sort_order', 'urgency',
          { nome: 'is_active', oid: 16 }, 'inactive_at', { nome: 'finance_ok', oid: 16 }, 'started_on',
          'renews_on', 'plan_id', 'plan_name', 'color_bg', 'color_text', 'color_border',
          { nome: 'tags', oid: 114 },
        ],
        linhas: () => [
          [C_ATIVO, 'Jatobá', IDE, 'Ide', '1', 'paz', 't', null, 't', '2026-01-01', null, null, null, null, null, null, '[]'],
        ],
      },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('o painel sai em 4 idas (eram 23), sem parâmetro algum', async () => {
    falso.zerar();
    const painel = await readPanel(sql, ligado, '2026-09-01', '2026-10-31', AGORA);
    expect(painel.clients).toHaveLength(1);
    expect(painel.clients[0].name).toBe('Jatobá');
    // Antes (medido em 2264a4f, mesmo teste): 23 idas — as consultas sem parâmetro
    // já saíam numa ida cada; as outras gastavam duas.
    expect(falso.idas).toHaveLength(4);
    for (const parametros of falso.parametros) expect(parametros).toEqual([]);
    const doBanco = falso.consultas.filter((c) => c.includes('ideworks.'));
    expect(doBanco).toHaveLength(10);
    // A empresa omitida e os meses foram para o texto.
    expect(doBanco.some((c) => c.includes(`array['${ALMA}']`))).toBe(true);
    expect(doBanco.some((c) => c.includes("array['2026-09-01','2026-10-01']"))).toBe(true);
    expect(doBanco.some((c) => c.includes(`array['${C_ATIVO}']`))).toBe(true);
  });

  it('sem empresa omitida a consulta sai igual à de antes (nenhum pedaço a mais)', async () => {
    falso.zerar();
    await readPanel(sql, desligado, '2026-09-01', '2026-09-30', AGORA);
    const clientes = falso.consultas.find((c) => c.includes('client_tag_assignments')) ?? '';
    expect(clientes).not.toContain('<> all');
    expect(falso.idas).toHaveLength(4);
  });
});

/* ───────────────────────── no Postgres de verdade ───────────────────────── */

describe('readPanel — o texto direto devolve o que o parâmetro devolve', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema ideworks;
      create table ideworks.client_categories (id uuid primary key, name text, sort_order int default 0);
      create table ideworks.plans (id uuid primary key, name text, color_bg text, color_text text, color_border text);
      create table ideworks.clients (
        id uuid primary key, name text, category_id uuid, plan_id uuid, urgency text default 'paz',
        is_active boolean default true, inactive_at timestamptz, finance_ok boolean default true,
        started_on date default '2026-01-01', renews_on date);
      create table ideworks.client_tags (id uuid primary key, name text, color text);
      create table ideworks.client_tag_assignments (client_id uuid, tag_id uuid);
      create table ideworks.month_contracts (
        id uuid primary key default gen_random_uuid(), client_id uuid, reference_month date,
        planning_done_at timestamptz, client_approved_at timestamptz);
      create table ideworks.month_contract_items (contract_id uuid, content_type text, quantity int);
      create table ideworks.client_quotas (client_id uuid, quantity int);
      create table ideworks.content_items (
        id uuid primary key default gen_random_uuid(), client_id uuid, reference_month date,
        content_type text, is_extra boolean default false, scheduled_at timestamptz, completed_at timestamptz);
      create table ideworks.spaces (id uuid primary key, category_id uuid, name text, archived_at timestamptz);
      create table ideworks.lists (id uuid primary key, space_id uuid, name text, client_id uuid, archived_at timestamptz);
      create table ideworks.tasks (id uuid primary key, list_id uuid, archived_at timestamptz);

      insert into ideworks.client_categories values ('${IDE}', 'Ide', 1), ('${ALMA}', 'Alma9', 2);
      insert into ideworks.plans values ('${id(20)}', 'Pleno', '#eee', '#111', '#ccc');
      insert into ideworks.clients (id, name, category_id, plan_id, is_active, inactive_at, renews_on) values
        ('${C_ATIVO}', 'Jatobá', '${IDE}', '${id(20)}', true, null, '2026-11-01'),
        ('${C_ALMA}', 'Cliente Alma', '${ALMA}', null, true, null, null),
        ('${C_CANCELADO}', 'Cancelado em setembro', '${IDE}', null, false, '2026-09-15T12:00:00Z', null);
      insert into ideworks.client_tags values ('${id(30)}', 'VIP', '#f00');
      insert into ideworks.client_tag_assignments values ('${C_ATIVO}', '${id(30)}');
      insert into ideworks.month_contracts (id, client_id, reference_month) values
        ('${id(40)}', '${C_ATIVO}', '2026-09-01'), ('${id(41)}', '${C_ATIVO}', '2026-10-01'),
        ('${id(42)}', '${C_ALMA}', '2026-10-01'), ('${id(43)}', '${C_CANCELADO}', '2026-09-01'),
        ('${id(44)}', '${C_CANCELADO}', '2026-10-01');
      insert into ideworks.month_contract_items values
        ('${id(40)}', 'video', 4), ('${id(41)}', 'video', 4), ('${id(41)}', 'arte', 6),
        ('${id(42)}', 'video', 2), ('${id(43)}', 'video', 3), ('${id(44)}', 'video', 3);
      insert into ideworks.client_quotas values ('${C_ATIVO}', 4), ('${C_ALMA}', 2);
      insert into ideworks.content_items (client_id, reference_month, content_type, is_extra, scheduled_at, completed_at) values
        ('${C_ATIVO}', '2026-09-01', 'video', false, '2026-09-10T15:00:00Z', '2026-09-10T18:00:00Z'),
        ('${C_ATIVO}', '2026-10-01', 'video', false, '2026-10-02T15:00:00Z', '2026-10-02T18:00:00Z'),
        ('${C_ATIVO}', '2026-10-01', 'arte', false, '2026-10-01T15:00:00Z', null),
        ('${C_ATIVO}', '2026-10-01', 'arte', false, '2026-10-25T15:00:00Z', null),
        ('${C_ATIVO}', '2026-10-01', 'arte', true, null, null),
        ('${C_ALMA}', '2026-10-01', 'video', false, '2026-10-03T15:00:00Z', '2026-10-03T18:00:00Z'),
        ('${C_CANCELADO}', '2026-09-01', 'video', false, '2026-09-05T15:00:00Z', '2026-09-05T18:00:00Z'),
        ('${C_CANCELADO}', '2026-10-01', 'video', false, '2026-10-05T15:00:00Z', null);
      insert into ideworks.spaces values ('${id(50)}', '${IDE}', 'CLIENTES', null), ('${id(51)}', '${ALMA}', 'CLIENTES', null);
      insert into ideworks.lists values
        ('${id(60)}', '${id(50)}', 'Lista Jatobá', '${C_ATIVO}', null),
        ('${id(61)}', '${id(50)}', 'Lista sem cliente', null, null),
        ('${id(62)}', '${id(51)}', 'Lista Alma', '${C_ALMA}', null);
      insert into ideworks.tasks values ('${id(70)}', '${id(60)}', null), ('${id(71)}', '${id(61)}', null);
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  const rodar = (textoDireto: boolean, ator: AuthenticatedActor, de: string, ate: string) => {
    const adaptador = criarAdaptadorPglite(db, { textoDireto });
    return { adaptador, resultado: readPanel(adaptador.sql, ator, de, ate, AGORA) };
  };

  for (const [ator, nomeDoAtor] of [
    [desligado, 'sem empresa omitida'],
    [ligado, 'com a Alma9 omitida'],
  ] as const) {
    for (const [de, ate] of [
      ['2026-09-01', '2026-09-30'],
      ['2026-08-15', '2026-10-31'],
      ['2026-10-01', '2026-10-10'],
    ] as const) {
      it(`${nomeDoAtor}, de ${de} a ${ate}: a mesma resposta por parâmetro e por texto direto`, async () => {
        const porParametro = rodar(false, ator, de, ate);
        const esperado = await porParametro.resultado;
        const porTexto = rodar(true, ator, de, ate);
        const obtido = await porTexto.resultado;
        expect(obtido).toEqual(esperado);

        const doBanco = porTexto.adaptador.consultas.filter((c) => c.includes('ideworks.') && !c.includes('set_config'));
        expect(doBanco.length).toBeGreaterThanOrEqual(9);
        expect(doBanco.some((c) => /\$\d/.test(c))).toBe(false);
        expect(porParametro.adaptador.consultas.some((c) => /\$\d/.test(c))).toBe(true);
      });
    }
  }

  it('o conteúdo: omitida sai, cancelado só conta até o mês do cancelamento', async () => {
    const todos = await rodar(true, desligado, '2026-09-01', '2026-10-31').resultado;
    expect(todos.clients.map((c) => c.name)).toEqual(['Cancelado em setembro', 'Cliente Alma', 'Jatobá']);

    const semAlma = await rodar(true, ligado, '2026-09-01', '2026-10-31').resultado;
    expect(semAlma.clients.map((c) => c.name)).toEqual(['Cancelado em setembro', 'Jatobá']);
    // A conferência também não acusa a lista da empresa omitida.
    expect(semAlma.conferencia).toEqual(
      (await rodar(false, ligado, '2026-09-01', '2026-10-31').resultado).conferencia,
    );

    const cancelado = semAlma.clients.find((c) => c.id === C_CANCELADO)!;
    expect(cancelado.isActive).toBe(false);
    expect(cancelado.deliveryStatus).toBeNull();
    // Em outubro (depois do cancelamento) a peça dele não conta no período.
    expect(cancelado.inPeriod).toEqual({ scheduled: 1, completed: 1 });

    const ativo = semAlma.clients.find((c) => c.id === C_ATIVO)!;
    expect(ativo.tags).toEqual([{ id: id(30), name: 'VIP', color: '#f00' }]);
    expect(ativo.deliveryStatus).not.toBeNull();
  });
});
