/**
 * MINHAS TAREFAS E TODAS AS TAREFAS, EM IDAS E EM LINHAS — perf do servidor, 09/10/2026.
 *
 * `readMyWorkPage` fazia a contagem das abas e a página em fila, cada uma com o
 * id do ator e o valor de cada fato como parâmetro; `readAllWork` fazia três
 * leituras em fila (linhas, contagem, menu de responsáveis). Agora o que não leva
 * parâmetro sai primeiro e o que leva (a página, a peneira) vai por último, tudo
 * na mesma rajada.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. NO FIO (driver real + servidor de fio): as idas de cada leitura, com e sem
 *      busca. O "antes" é o de 2264a4f (mesmo teste).
 *   2. NO POSTGRES DE VERDADE (PGlite): o resultado é IDÊNTICO com o id no texto
 *      e com parâmetro, nas três abas, na página com cursor e em `Todas as
 *      tarefas` com busca, responsável e "sem responsável". E a contagem sem
 *      peneira (`count(*)`, sem parâmetro) devolve o mesmo que a expressão de
 *      antes, com a peneira vazia.
 */
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEM_FILTRO, SEM_RESPONSAVEL, type FiltroDeTarefas } from '@/board/filtro';
import { readAllWork, readMyWorkPage } from '@/server/board-trabalho';
import type { Sql } from '@/server/db';
import { lerPedidoDePagina } from '@/server/paginacao-do-trabalho';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import { EU, OUTRA, id, montarBancoDeQuadros } from '@/server/quadro-fixture';
import type { AuthenticatedActor } from '@/server/session';

const ator: AuthenticatedActor = {
  userId: EU,
  email: 'eu@ide.com',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
  areas: [],
  hasAllClientsAccess: true,
};

/* ───────────────────────────── no fio ───────────────────────────── */

describe('Minhas tarefas e Todas as tarefas — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      { quando: /as sort_title/, colunas: ['id'], linhas: () => [] },
      {
        quando: /as pendente/,
        colunas: [
          { nome: 'pendente', oid: 23 },
          { nome: 'feito', oid: 23 },
          { nome: 'delegado', oid: 23 },
        ],
        linhas: () => [['4', '2', '3']],
      },
      { quando: /assignee_filter_people/, colunas: ['id', 'name', { nome: 'tasks', oid: 23 }, { nome: 'com_dono', oid: 23 }], linhas: () => [[EU, 'Eu', '4', '9']] },
      {
        quando: /select count\(\*\)::int as total/,
        colunas: [{ nome: 'total', oid: 23 }, { nome: 'achadas', oid: 23 }],
        linhas: () => [['12', '12']],
      },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('uma página de Minhas tarefas sai em 4 idas (eram 8), e só a página leva parâmetro', async () => {
    falso.zerar();
    const pedido = lerPedidoDePagina({ aba: 'pendente', cursor: null, limite: null });
    if (!pedido.ok || pedido.pedido === null) throw new Error('pedido inválido');
    const pagina = await readMyWorkPage(sql, ator, pedido.pedido);
    expect(pagina.counts).toEqual({ pendente: 4, feito: 2, delegado: 3 });
    // Antes (medido em 2264a4f, mesmo teste): 8 idas.
    expect(falso.idas).toHaveLength(4);
    expect(falso.parametros.filter((p) => p.length > 0)).toHaveLength(1);
    // A contagem foi sem parâmetro, com o id do ator e o valor de cada fato no texto.
    const contagem = falso.consultas.find((c) => c.includes('as pendente'));
    expect(contagem).toBeDefined();
    expect(contagem).toContain(`'${EU}'`);
    expect(contagem).not.toMatch(/\$\d/);
  });

  it('Todas as tarefas sem busca sai em 4 idas (eram 9), e só as linhas levam parâmetro', async () => {
    falso.zerar();
    const todas = await readAllWork(sql, ator);
    expect(todas.total).toBe(12);
    expect(todas.matched).toBe(12);
    expect(todas.unassignedTasks).toBe(3);
    // Antes (medido em 2264a4f, mesmo teste): 9 idas.
    expect(falso.idas).toHaveLength(4);
    expect(falso.parametros.filter((p) => p.length > 0)).toHaveLength(1);
    const conta = falso.consultas.find((c) => c.includes('as total'));
    expect(conta).toBeDefined();
    expect(conta).not.toMatch(/\$\d/);
  });

  it('Todas as tarefas com busca: 6 idas (eram 9), a contagem volta a levar a busca como parâmetro', async () => {
    falso.zerar();
    const filtro: FiltroDeTarefas = { texto: 'ação', responsavel: null };
    await readAllWork(sql, ator, filtro);
    // Antes (medido em 2264a4f, mesmo teste): 9 idas.
    expect(falso.idas).toHaveLength(6);
    expect(falso.parametros.filter((p) => p.length > 0)).toHaveLength(2);
    // A busca nunca vai para o texto da consulta.
    expect(falso.consultas.join('\n')).not.toContain('ação');
  });
});

/* ───────────────────────── no Postgres de verdade ───────────────────────── */

describe('Minhas tarefas e Todas as tarefas — o texto direto devolve o que o parâmetro devolve', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await montarBancoDeQuadros(db);
    // `created_by` não está no terreno dos quadros, e a aba Delegado depende dele.
    // Duas concluídas dão linhas à aba Feito; três criadas por mim e feitas por
    // outra pessoa dão linhas ao Delegado.
    // O cursor da página compara a prioridade como o enum do banco.
    await db.exec(`
      create type ideworks.task_priority as enum ('urgent', 'high', 'normal', 'low');
      alter table ideworks.tasks alter column priority type ideworks.task_priority using priority::ideworks.task_priority;
      alter table ideworks.tasks add column created_by uuid;
      update ideworks.tasks set created_by = '${EU}' where id in ('${id(101)}', '${id(105)}', '${id(107)}');
      update ideworks.tasks set completed_at = '2026-10-01T12:00:00Z' where id in ('${id(102)}', '${id(108)}');
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  const pagina = (textoDireto: boolean, aba: string, cursor: string | null, limite: string) => {
    const pedido = lerPedidoDePagina({ aba, cursor, limite });
    if (!pedido.ok || pedido.pedido === null) throw new Error('pedido inválido');
    const adaptador = criarAdaptadorPglite(db, { textoDireto });
    return { adaptador, resultado: readMyWorkPage(adaptador.sql, ator, pedido.pedido) };
  };

  for (const aba of ['pendente', 'feito', 'delegado']) {
    it(`aba ${aba}: a mesma página, o mesmo cursor e a mesma segunda página`, async () => {
      const esperado = await pagina(false, aba, null, '2').resultado;
      const porTexto = pagina(true, aba, null, '2');
      const obtido = await porTexto.resultado;
      expect(obtido).toEqual(esperado);
      expect(obtido.counts[aba as 'pendente']).toBeGreaterThan(0);
      // O id do ator e o valor dos fatos foram mesmo para o texto da contagem.
      const contagem = porTexto.adaptador.consultas.find((c) => c.includes('as pendente'));
      expect(contagem).toBeDefined();
      expect(contagem).not.toMatch(/\$\d/);
      // A segunda página, pelo cursor.
      if (obtido.nextCursor !== null) {
        const a = await pagina(false, aba, obtido.nextCursor, '2').resultado;
        const b = await pagina(true, aba, obtido.nextCursor, '2').resultado;
        expect(b).toEqual(a);
        expect(b.rows.map((r) => r.id)).not.toEqual(obtido.rows.map((r) => r.id));
      }
    });
  }

  it('as três abas contam o que as linhas dizem', async () => {
    const p = await pagina(true, 'pendente', null, '100').resultado;
    expect(p.counts).toEqual({ pendente: 4, feito: 2, delegado: 3 });
    expect(p.rows).toHaveLength(4);
    expect(p.total).toBe(4);
    expect((await pagina(true, 'feito', null, '100').resultado).rows).toHaveLength(2);
    expect((await pagina(true, 'delegado', null, '100').resultado).rows).toHaveLength(3);
  });

  const todas = (textoDireto: boolean, filtro: FiltroDeTarefas) => {
    const adaptador = criarAdaptadorPglite(db, { textoDireto });
    return { adaptador, resultado: readAllWork(adaptador.sql, ator, filtro) };
  };

  const filtros: Array<[string, FiltroDeTarefas]> = [
    ['sem peneira', SEM_FILTRO],
    ['busca com acento dobrado', { texto: 'acao', responsavel: null }],
    ['por responsável', { texto: '', responsavel: EU }],
    ['sem responsável', { texto: '', responsavel: SEM_RESPONSAVEL }],
    ['busca e responsável juntos', { texto: 'pe', responsavel: OUTRA }],
    ['busca que não acha nada', { texto: 'nada disso existe', responsavel: null }],
  ];

  for (const [descricao, filtro] of filtros) {
    it(`Todas as tarefas, ${descricao}: o mesmo total, o mesmo achado, as mesmas linhas e o mesmo menu`, async () => {
      const esperado = await todas(false, filtro).resultado;
      const porTexto = todas(true, filtro);
      const obtido = await porTexto.resultado;
      expect(obtido).toEqual(esperado);
      expect(obtido.total).toBe(18);
      if (descricao === 'sem peneira') {
        expect(obtido.matched).toBe(18);
        expect(porTexto.adaptador.consultas.find((c) => c.includes('as total'))).not.toMatch(/\$\d/);
      }
    });
  }

  it('a contagem sem peneira é a de antes com a peneira vazia (a expressão antiga, rodada à mão)', async () => {
    const antes = await db.query<{ total: number; achadas: number }>(`
      select count(*)::int as total,
             count(*) filter (
               where ($1::text is null or position($1::text in translate(lower(t.title), 'x', 'x')) > 0)
                 and (not $2::boolean or not exists (select 1 from ideworks.task_assignees a where a.task_id = t.id))
                 and ($3::uuid is null or exists (select 1 from ideworks.task_assignees a
                                                   where a.task_id = t.id and a.user_id = $3::uuid))
             )::int as achadas
        from ideworks.tasks t where t.archived_at is null`, [null, false, null]);
    const agora = await todas(true, SEM_FILTRO).resultado;
    expect(agora.total).toBe(antes.rows[0]!.total);
    expect(agora.matched).toBe(antes.rows[0]!.achadas);
  });
});
