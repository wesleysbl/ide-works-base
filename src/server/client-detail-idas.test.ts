/**
 * A TELA DO CLIENTE, EM IDAS E EM LINHAS — perf do servidor, 08/10/2026.
 *
 * `readClientDetail` fazia oito consultas em fila, cada uma com o id (e o mês)
 * como parâmetro. Agora o id e o mês vão no texto e as oito saem na mesma ida.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. NO FIO (driver real + servidor de fio): 20 idas -> 3. O "antes" é o de
 *      2264a4f (18 medidas com `withActor` novo e a tela antiga: oito consultas
 *      de 2 idas, mais begin e commit; as 2 idas da declaração por parâmetro
 *      completam as 20).
 *   2. NO POSTGRES DE VERDADE (PGlite): o texto direto devolve EXATAMENTE a mesma
 *      resposta que o parâmetro — o mesmo `readClientDetail`, rodado com o
 *      adaptador sem `unsafe` (que força o caminho por parâmetro) e com ele.
 *      Cobre uuid, `date`, janela de vizinhos, itens com e sem data, mês aberto.
 *   3. Cliente que não existe: a mesma recusa.
 */
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ClientNotVisible, readClientDetail } from '@/server/client-detail';
import type { Sql } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLIENTE = id(1);
const ANTERIOR = id(2);
const PROXIMO = id(3);
const EU = id(99);

const ator: AuthenticatedActor = {
  userId: EU,
  email: 'eu@ide.com',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: true,
};

/* ───────────────────────────── no fio ───────────────────────────── */

describe('readClientDetail — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      {
        quando: /from ideworks\.clients c\s+join ideworks\.client_categories cat/,
        colunas: [
          'id', 'name', 'category_id', 'category_name', 'urgency', { nome: 'is_active', oid: 16 },
          'inactive_at', { nome: 'finance_ok', oid: 16 }, 'tax_id', 'company_email', 'started_on', 'renews_on',
          'phone', 'whatsapp', 'address', 'owner_name', 'owner_phone', 'owner_whatsapp', 'notes',
          'plan_id', 'plan_name', 'color_bg', 'color_text', 'color_border',
        ],
        linhas: () => [
          [CLIENTE, 'Jatobá', id(50), 'Ide', 'paz', 't', null, 't', null, null, '2026-01-01', null,
            null, null, null, null, null, null, null, null, null, null, null, null],
        ],
      },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('abre a tela do cliente em 3 idas (eram 20): begin, rajada, commit — sem parâmetro', async () => {
    falso.zerar();
    const detalhe = await readClientDetail(sql, ator, CLIENTE, '2026-10-15');
    expect(detalhe.id).toBe(CLIENTE);
    expect(detalhe.name).toBe('Jatobá');
    expect(detalhe.month).toBe('2026-10-01');
    // Antes (2264a4f): 20 idas — begin, set_config (2), 8 consultas × 2, commit.
    expect(falso.idas).toHaveLength(3);
    for (const parametros of falso.parametros) expect(parametros).toEqual([]);
    const doBanco = falso.consultas.filter((c) => c.includes('ideworks.'));
    expect(doBanco).toHaveLength(8);
    expect(doBanco.every((c) => c.includes(`'${CLIENTE}'`))).toBe(true);
    expect(doBanco.filter((c) => c.includes("'2026-10-01'"))).toHaveLength(3);
  });

  it('id fora do formato segue por parâmetro', async () => {
    falso.zerar();
    await readClientDetail(sql, ator, "x' or '1'='1", '2026-10-15').catch(() => undefined);
    expect(falso.consultas.join('\n')).not.toContain("or '1'='1");
  });
});

/* ───────────────────────── no Postgres de verdade ───────────────────────── */

describe('readClientDetail — o texto direto devolve o que o parâmetro devolve', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema ideworks;
      create table ideworks.client_categories (id uuid primary key, name text not null);
      create table ideworks.plans (id uuid primary key, name text, color_bg text, color_text text, color_border text);
      create table ideworks.clients (
        id uuid primary key, name text not null, category_id uuid not null, plan_id uuid,
        urgency text default 'paz', is_active boolean default true, inactive_at timestamptz,
        finance_ok boolean default true, tax_id text, company_email text,
        started_on date default '2026-01-01', renews_on date, phone text, whatsapp text, address text,
        owner_name text, owner_phone text, owner_whatsapp text, notes text);
      create table ideworks.client_links (
        id uuid primary key default gen_random_uuid(), client_id uuid, title text, url text, sort_order int default 0);
      create table ideworks.client_tags (id uuid primary key, name text, color text);
      create table ideworks.client_tag_assignments (client_id uuid, tag_id uuid);
      create table ideworks.client_quotas (client_id uuid, content_type text, quantity int);
      create table ideworks.month_contracts (
        id uuid primary key, client_id uuid, reference_month date,
        planning_done_at timestamptz, client_approved_at timestamptz);
      create table ideworks.month_contract_items (contract_id uuid, content_type text, quantity int);
      create table ideworks.content_items (
        id uuid primary key default gen_random_uuid(), client_id uuid, reference_month date,
        content_type text, platform text, scheduled_at timestamptz, completed_at timestamptz,
        is_extra boolean default false, title text, created_at timestamptz default now());

      insert into ideworks.client_categories values ('${id(50)}', 'Ide');
      insert into ideworks.plans values ('${id(60)}', 'Pleno', '#eee', '#111', '#ccc');
      insert into ideworks.clients (id, name, category_id, plan_id, is_active, renews_on, notes) values
        ('${ANTERIOR}', 'Aurora', '${id(50)}', null, true, null, null),
        ('${CLIENTE}', 'Jatobá', '${id(50)}', '${id(60)}', true, '2026-12-01', 'Cliente antigo'),
        ('${PROXIMO}', 'Zênite', '${id(50)}', null, true, null, null),
        ('${id(4)}', 'Arquivado', '${id(50)}', null, false, null, null);
      insert into ideworks.client_links (client_id, title, url, sort_order) values
        ('${CLIENTE}', 'Drive', 'https://drive.example/x', 2), ('${CLIENTE}', 'Briefing', 'https://b.example', 1);
      insert into ideworks.client_tags values ('${id(70)}', 'VIP', '#f00'), ('${id(71)}', 'Antigo', '#00f');
      insert into ideworks.client_tag_assignments values ('${CLIENTE}', '${id(70)}'), ('${CLIENTE}', '${id(71)}');
      insert into ideworks.client_quotas values ('${CLIENTE}', 'video', 4), ('${CLIENTE}', 'arte', 8);
      insert into ideworks.month_contracts values
        ('${id(80)}', '${CLIENTE}', '2026-10-01', '2026-10-02T12:00:00Z', null),
        ('${id(81)}', '${CLIENTE}', '2026-09-01', null, null);
      insert into ideworks.month_contract_items values
        ('${id(80)}', 'video', 4), ('${id(80)}', 'arte', 8), ('${id(81)}', 'arte', 1);
      insert into ideworks.content_items (client_id, reference_month, content_type, platform, scheduled_at, completed_at, is_extra, title) values
        ('${CLIENTE}', '2026-10-01', 'arte', 'instagram', '2026-10-05T15:00:00Z', '2026-10-05T18:00:00Z', false, 'Post A'),
        ('${CLIENTE}', '2026-10-01', 'video', 'instagram', '2026-10-20T15:00:00Z', null, false, 'Reels B'),
        ('${CLIENTE}', '2026-10-01', 'arte', null, null, null, true, 'Sem data'),
        ('${CLIENTE}', '2026-09-01', 'arte', 'instagram', '2026-09-10T15:00:00Z', null, false, 'Mês errado');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  const rodar = (textoDireto: boolean, cliente: string, mes: string, periodo?: { from: string; to: string }) => {
    const adaptador = criarAdaptadorPglite(db, { textoDireto });
    return { adaptador, resultado: readClientDetail(adaptador.sql, ator, cliente, mes, periodo) };
  };

  for (const [descricao, mes, periodo] of [
    ['mês aberto, período padrão', '2026-10-15', undefined],
    ['mês aberto, período cortado', '2026-10-01', { from: '2026-10-01', to: '2026-10-10' }],
    ['mês sem contrato', '2026-08-20', undefined],
    ['outro mês com contrato e item', '2026-09-30', undefined],
  ] as const) {
    it(`${descricao}: a mesma resposta, por parâmetro e por texto direto`, async () => {
      const porParametro = rodar(false, CLIENTE, mes, periodo);
      const esperado = await porParametro.resultado;
      const porTexto = rodar(true, CLIENTE, mes, periodo);
      const obtido = await porTexto.resultado;
      expect(obtido).toEqual(esperado);
      // O caminho direto de fato foi o do texto: sem `$n` nas oito consultas.
      const doBanco = porTexto.adaptador.consultas.filter((c) => c.includes('ideworks.') && !c.includes('set_config'));
      expect(doBanco).toHaveLength(8);
      expect(doBanco.some((c) => /\$\d/.test(c))).toBe(false);
      expect(porParametro.adaptador.consultas.some((c) => /\$\d/.test(c))).toBe(true);
    });
  }

  it('o conteúdo da resposta é o que as linhas dizem', async () => {
    const d = await rodar(true, CLIENTE, '2026-10-15').resultado;
    expect(d.name).toBe('Jatobá');
    expect(d.planName).toBe('Pleno');
    expect(d.profile.links.map((l) => l.title)).toEqual(['Briefing', 'Drive']);
    expect(d.profile.tags.map((t) => t.name)).toEqual(['Antigo', 'VIP']);
    expect(d.profile.quotas).toEqual([
      { contentType: 'arte', quantity: 8 },
      { contentType: 'video', quantity: 4 },
    ]);
    expect(d.neighbors).toEqual({ previous: ANTERIOR, next: PROXIMO });
    expect(d.monthOpened).toBe(true);
    expect(d.planningDoneAt).toBe('2026-10-02T12:00:00.000Z');
    expect(d.contract).toEqual([
      { contentType: 'arte', quantity: 8 },
      { contentType: 'video', quantity: 4 },
    ]);
    expect(d.monthItems.map((i) => i.title)).toEqual(['Post A', 'Reels B', 'Sem data']);
    expect(d.unscheduled.map((i) => i.title)).toEqual(['Sem data']);
    expect(d.scheduled.map((i) => i.title)).toEqual(['Post A', 'Reels B']);
  });

  it('cliente que não existe: a mesma recusa, nos dois caminhos', async () => {
    for (const textoDireto of [false, true]) {
      await expect(rodar(textoDireto, id(404), '2026-10-01').resultado).rejects.toBeInstanceOf(ClientNotVisible);
    }
  });
});
