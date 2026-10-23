/**
 * O CONTROLE DA SEMANA, EM IDAS — perf do servidor, 09/10/2026.
 *
 * `readControleDaSemana` fazia quatro consultas em fila (clientes, contratos,
 * cotas, tarefas), todas com os dias, os ids dos clientes e a tabela de acentos
 * como parâmetro: 12 idas ao banco. Agora tudo vai no texto e as consultas saem em
 * duas rajadas — clientes e tarefas (que não dependem um do outro), depois
 * contratos e cotas (que precisam dos ids dos clientes).
 *
 * A equivalência do resultado, semana a semana e recorte a recorte, está em
 * `controle-da-semana-banco.test.ts` (PGlite). Aqui se conta no fio.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readControleDaSemana } from '@/server/controle-da-semana';
import type { Sql } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLIENTE = id(10);
const ALMA = id(2);

const ator: AuthenticatedActor = {
  userId: id(90),
  email: 'adm@ide.com',
  papel: 'admin',
  isSuperadmin: true,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: true,
  categoriasOmitidas: [ALMA],
};

// Quarta-feira, 07/10/2026, meio-dia em São Paulo.
const HOJE = new Date('2026-10-07T15:00:00Z');

describe('readControleDaSemana — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      { quando: /as is_assign/, colunas: ['id'], linhas: () => [] },
      { quando: /from ideworks\.month_contracts mc/, colunas: ['client_id', 'month', 'content_type', { nome: 'quantity', oid: 23 }], linhas: () => [[CLIENTE, '2026-10-01', 'video', '8']] },
      { quando: /from ideworks\.client_quotas/, colunas: ['client_id', 'content_type', { nome: 'quantity', oid: 23 }], linhas: () => [[CLIENTE, 'arte', '4']] },
      { quando: /from ideworks\.clients c\s+where c\.is_active/, colunas: ['id', 'name'], linhas: () => [[CLIENTE, 'Alfa']] },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('a semana abre em 4 idas (eram 12), sem nenhum parâmetro', async () => {
    falso.zerar();
    const semana = await readControleDaSemana(sql, ator, undefined, HOJE);
    expect(semana.week.start).toBe('2026-10-05');
    // O cliente tem cota de vídeo no contrato e de arte no cadastro: duas linhas de falta.
    expect(semana.missing.items.length).toBeGreaterThan(0);
    // Antes (medido em 2264a4f, mesmo teste): 12 idas.
    expect(falso.idas).toHaveLength(4);
    expect(falso.parametros.every((p) => p.length === 0)).toBe(true);
    expect(falso.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(4);
    // Os dois ids do cliente e os dois meses foram para o texto das consultas de contrato e cota.
    expect(falso.consultas.filter((c) => c.includes(`'${CLIENTE}'`))).toHaveLength(2);
  });

  it('a busca de acento e a omissão da Alma9 vão no texto, derivadas das mesmas constantes', async () => {
    falso.zerar();
    await readControleDaSemana(sql, ator, '2026-09-28', HOJE);
    const tarefas = falso.consultas.find((c) => c.includes('as is_assign'))!;
    expect(tarefas).toContain("'áàâãäéèêëíìîïóòôõöúùûüçñ'");
    expect(tarefas).toContain("'aaaaaeeeeiiiiooooouuuucn'");
    expect(tarefas).toContain(`array['${ALMA}']`);
    expect(tarefas).toContain("'2026-09-28'");
  });
});
