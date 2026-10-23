/**
 * O PLANEJAMENTO E A ÁRVORE, CONTADOS NO FIO — perf do servidor, 08/10/2026.
 *
 * `readPlanningWeeks` fazia seis consultas em fila (a lista de clientes e depois
 * cinco que dependem dos ids), todas com parâmetro. A resposta em linhas é
 * provada contra o PGlite em `planning-weeks-banco.test.ts`; aqui se conta, com
 * o driver real, quantas idas o fio vê.
 *
 * ANTES (medido neste mesmo teste contra 2264a4f): 16 idas.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Sql } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import { readTree } from '@/server/board';
import { readCatalogos } from '@/server/catalogos';
import { readPlanning } from '@/server/planning';
import { readFullTree } from '@/server/tree';
import { readPlanningWeeks } from '@/server/planning-weeks';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ator: AuthenticatedActor = {
  userId: id(99),
  email: 'eu@ide.com',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
  areas: [],
  hasAllClientsAccess: true,
  categoriasOmitidas: [id(2)],
};

describe('readPlanningWeeks — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      {
        quando: /from ideworks\.clients c\s+join ideworks\.client_categories cat/,
        colunas: ['id', 'name', 'category_id', 'category_name', 'plan_id', 'plan_name', 'color_bg', 'color_text', 'color_border'],
        linhas: () => [[id(10), 'Jatobá', id(1), 'Ide', null, null, null, null, null]],
      },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('abre o planejamento em 4 idas, sem parâmetro algum (com empresa omitida)', async () => {
    falso.zerar();
    const linhas = await readPlanningWeeks(sql, ator, '2026-10-15');
    expect(linhas.map((l) => l.name)).toEqual(['Jatobá']);
    expect(falso.idas).toHaveLength(4);
    for (const parametros of falso.parametros) expect(parametros).toEqual([]);
    const doBanco = falso.consultas.filter((c) => c.includes('ideworks.'));
    expect(doBanco).toHaveLength(6);
    expect(doBanco.filter((c) => c.includes(`array['${id(10)}']`))).toHaveLength(5);
    expect(doBanco.filter((c) => c.includes("'2026-10-01'"))).toHaveLength(2);
  });

  it('sem cliente nenhum, para depois da primeira consulta', async () => {
    const vazio = await criarPgFalso([]);
    const cliente = postgres(vazio.opcoesDoCliente()) as unknown as Sql;
    try {
      expect(await readPlanningWeeks(cliente, ator, '2026-10-15')).toEqual([]);
      expect(vazio.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(1);
    } finally {
      await cliente.end();
      await vazio.fechar();
    }
  });
});

describe('a árvore da barra lateral e o planejamento do mês — uma consulta só, com a omitida no texto', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('readTree (a barra lateral, em toda tela): 3 idas, eram 6 com empresa omitida', async () => {
    falso.zerar();
    await readTree(sql, ator);
    // Antes (2264a4f): begin, set_config (2), consulta com a lista de omitidas como parâmetro (2), commit.
    expect(falso.idas).toHaveLength(3);
    expect(falso.parametros.flat()).toEqual([]);
    expect(falso.consultas.some((c) => c.includes(`<> all(array['${id(2)}']::uuid[])`))).toBe(true);
  });

  it('readPlanning (aba Mês): 3 idas, eram 6', async () => {
    falso.zerar();
    await readPlanning(sql, ator, '2026-10-15');
    expect(falso.idas).toHaveLength(3);
    expect(falso.parametros.flat()).toEqual([]);
    expect(falso.consultas.some((c) => c.includes("mc.reference_month = '2026-10-01'"))).toBe(true);
  });

  it('readCatalogos (planos, empresas e etiquetas): 3 idas, eram 7', async () => {
    falso.zerar();
    await readCatalogos(sql, ator);
    // Antes (2264a4f): begin, set_config (2), três consultas em fila (1 cada), commit.
    expect(falso.idas).toHaveLength(3);
    expect(falso.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(3);
  });

  it('readFullTree (árvore completa + empresas do "Espaço novo"): 3 idas, eram 6', async () => {
    falso.zerar();
    await readFullTree(sql, ator);
    expect(falso.idas).toHaveLength(3);
    expect(falso.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(2);
  });
});
