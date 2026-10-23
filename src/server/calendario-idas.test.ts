/**
 * O CALENDÁRIO, EM IDAS E EM LINHAS — perf do servidor, 09/10/2026.
 *
 * `readCalendar` abria DUAS transações em fila — as entregas e depois os
 * compromissos (`readAppointments`) —, cada uma com o período, o fuso e o
 * cliente como parâmetro. Agora as duas consultas saem na mesma transação e na
 * mesma rajada, com o período, o fuso e o cliente no texto.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. NO FIO (driver real + servidor de fio): 12 idas -> 3 e 2 transações -> 1.
 *   2. NO POSTGRES DE VERDADE (PGlite): a resposta é a MESMA com os valores no
 *      texto e com parâmetro — mês aberto, mês de cliente cancelado, ficha do
 *      cliente cancelado (passado inteiro), empresa omitida e período em formato
 *      que não é data (que segue por parâmetro).
 */
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readCalendar } from '@/server/calendar';
import type { Sql } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDE = id(1);
const ALMA = id(2);
const C_ATIVO = id(10);
const C_CANCELADO = id(11); // cancelado em setembro: aparece até setembro, some de outubro em diante
const C_ALMA = id(12);

const ator = (omitidas: string[] = []): AuthenticatedActor => ({
  userId: id(99),
  email: 'eu@ide.com',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: true,
  categoriasOmitidas: omitidas,
});

/* ───────────────────────────── no fio ───────────────────────────── */

describe('readCalendar — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      {
        quando: /from ideworks\.content_items i/,
        colunas: ['id', 'client_id', 'client_name', 'content_type', 'platform', 'day', 'title', { nome: 'is_extra', oid: 16 }, { nome: 'is_completed', oid: 16 }],
        linhas: () => [[id(100), C_ATIVO, 'Alfa', 'arte', 'instagram', '2026-10-05', 'Post', 'f', 'f']],
      },
      {
        quando: /from ideworks\.appointments a/,
        colunas: ['id', 'client_id', 'client_name', 'day', 'time', 'title', 'notes'],
        linhas: () => [[id(200), C_ATIVO, 'Alfa', '2026-10-05', '09:30', 'Reunião', null]],
      },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('o mês abre em 3 idas e UMA transação (eram 12 e duas), sem parâmetro', async () => {
    falso.zerar();
    const entradas = await readCalendar(sql, ator([ALMA]), { from: '2026-10-01', to: '2026-11-01' });
    expect(entradas.map((e) => `${e.kind}:${e.time ?? '-'}`)).toEqual(['appointment:09:30', 'delivery:-']);
    // Antes (medido em 2264a4f, mesmo teste): 12 idas em 2 transações.
    expect(falso.idas).toHaveLength(3);
    expect(falso.consultas.filter((c) => c.trim() === 'begin')).toHaveLength(1);
    expect(falso.parametros.every((p) => p.length === 0)).toBe(true);
    const entregas = falso.consultas.find((c) => c.includes('content_items'))!;
    expect(entregas.match(/'America\/Sao_Paulo'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(entregas).toContain("'2026-10-01'::timestamp");
  });

  it('período que não é data segue por parâmetro (nada de texto da requisição na consulta)', async () => {
    falso.zerar();
    await readCalendar(sql, ator(), { from: "2026-10-01'; drop table x; --", to: '2026-11-01' });
    expect(falso.consultas.join('\n')).not.toContain('drop table');
    expect(falso.parametros.some((p) => p.includes("2026-10-01'; drop table x; --"))).toBe(true);
  });
});

/* ───────────────────────── no Postgres de verdade ───────────────────────── */

describe('readCalendar — o texto direto devolve o que o parâmetro devolve', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema ideworks;
      create table ideworks.clients (id uuid primary key, name text, category_id uuid,
        is_active boolean default true, inactive_at timestamptz);
      create table ideworks.content_items (id uuid primary key default gen_random_uuid(), client_id uuid,
        content_type text, platform text, scheduled_at timestamptz, title text,
        is_extra boolean default false, completed_at timestamptz);
      create table ideworks.appointments (id uuid primary key default gen_random_uuid(), client_id uuid,
        day date, start_time time, title text, notes text);

      insert into ideworks.clients values
        ('${C_ATIVO}', 'Alfa', '${IDE}', true, null),
        ('${C_CANCELADO}', 'Beta', '${IDE}', false, '2026-09-15T12:00:00Z'),
        ('${C_ALMA}', 'Da Alma', '${ALMA}', true, null);
      insert into ideworks.content_items (client_id, content_type, platform, scheduled_at, title, is_extra, completed_at) values
        ('${C_ATIVO}', 'arte', 'instagram', '2026-10-05T15:00:00Z', 'Post A', false, null),
        ('${C_ATIVO}', 'video', 'tiktok', '2026-10-31T23:30:00Z', 'Reels B', true, '2026-10-31T23:40:00Z'),
        ('${C_ATIVO}', 'arte', null, '2026-11-01T01:00:00Z', 'Virada de mês (31/10 à noite em SP)', false, null),
        ('${C_CANCELADO}', 'arte', 'instagram', '2026-09-10T15:00:00Z', 'Beta setembro', false, null),
        ('${C_CANCELADO}', 'arte', 'instagram', '2026-10-10T15:00:00Z', 'Beta outubro', false, null),
        ('${C_ALMA}', 'arte', 'instagram', '2026-10-06T15:00:00Z', 'Alma', false, null);
      insert into ideworks.appointments (client_id, day, start_time, title, notes) values
        ('${C_ATIVO}', '2026-10-05', '09:30', 'Reunião Alfa', 'pauta'),
        ('${C_ATIVO}', '2026-10-05', null, 'Dia inteiro Alfa', null),
        ('${C_CANCELADO}', '2026-09-20', '14:00', 'Beta setembro', null),
        ('${C_CANCELADO}', '2026-10-20', '14:00', 'Beta outubro', null),
        ('${C_ALMA}', '2026-10-06', '10:00', 'Alma', null);
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  const rodar = (textoDireto: boolean, omitidas: string[], periodo: { from: string; to: string }, cliente?: string) => {
    const adaptador = criarAdaptadorPglite(db, { textoDireto });
    return { adaptador, resultado: readCalendar(adaptador.sql, ator(omitidas), periodo, cliente) };
  };

  const casos: Array<[string, string[], { from: string; to: string }, string | undefined]> = [
    ['outubro, Alma9 omitida', [ALMA], { from: '2026-10-01', to: '2026-11-01' }, undefined],
    ['outubro, nada omitido', [], { from: '2026-10-01', to: '2026-11-01' }, undefined],
    ['setembro: o cliente cancelado ainda aparece', [ALMA], { from: '2026-09-01', to: '2026-10-01' }, undefined],
    ['ficha do cliente cancelado: o passado dele inteiro', [], { from: '2026-09-01', to: '2026-11-01' }, C_CANCELADO],
    ['ficha do cliente ativo', [], { from: '2026-10-01', to: '2026-11-01' }, C_ATIVO],
    ['período que não é data (segue por parâmetro)', [], { from: '2026-10-01T00:00:00', to: '2026-11-01T00:00:00' }, undefined],
  ];

  for (const [descricao, omitidas, periodo, cliente] of casos) {
    it(`${descricao}: a mesma resposta`, async () => {
      const esperado = await rodar(false, omitidas, periodo, cliente).resultado;
      const porTexto = rodar(true, omitidas, periodo, cliente);
      const obtido = await porTexto.resultado;
      expect(obtido).toEqual(esperado);
      expect(obtido.length).toBeGreaterThan(0);
      expect(porTexto.adaptador.transacoes()).toBe(1);
    });
  }

  it('o conteúdo: outubro sem o cancelado nem a Alma9; a entrega da virada de mês fica em 31/10', async () => {
    const r = await rodar(true, [ALMA], { from: '2026-10-01', to: '2026-11-01' }).resultado;
    expect(r.map((e) => e.title)).toEqual([
      'Reunião Alfa',
      'Post A',
      'Dia inteiro Alfa',
      'Reels B',
      'Virada de mês (31/10 à noite em SP)',
    ]);
    expect(r.some((e) => e.title === 'Beta outubro')).toBe(false);
    expect(r.some((e) => e.clientName === 'Da Alma')).toBe(false);
    // 31/10 23:30 UTC é 20:30 em São Paulo (dia 31); 01/11 01:00 UTC é 22:00 do dia 31 em SP.
    expect(r.filter((e) => e.kind === 'delivery').map((e) => e.day)).toEqual(['2026-10-05', '2026-10-31', '2026-10-31']);
  });
});
