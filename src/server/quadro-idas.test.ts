/**
 * O QUADRO DE UMA LISTA, EM IDAS E EM LINHAS — perf do servidor, 08/10/2026.
 *
 * `readBoard` fazia sete consultas em fila, quase todas com o id da lista como
 * parâmetro. Agora o id vai no texto, a lista e a esteira saem juntas, e a
 * produção, os responsáveis e as etiquetas saem juntos com a consulta dos
 * cartões — que vai por último, porque leva parâmetros (a busca e o responsável)
 * e o driver não deixa nada passar na frente dela.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. NO FIO (driver real + servidor de fio): 15 -> 5 idas (o "antes" é o de 2264a4f).
 *   2. NO POSTGRES DE VERDADE (PGlite): a resposta é a MESMA com o id no texto e
 *      com parâmetro — sem filtro, com busca, com responsável, "sem responsável",
 *      com teto por coluna e com busca que não acha nada (a consulta de
 *      contagem à parte). Mesmo `readBoard`; muda só o adaptador.
 */
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEM_FILTRO, SEM_RESPONSAVEL, type FiltroDeTarefas } from '@/board/filtro';
import { BoardRefused, readBoard } from '@/server/board';
import type { Sql } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import { EU, ESPACO, LISTA, LISTA_VAZIA, S_ABRE, id, montarBancoDeQuadros } from '@/server/quadro-fixture';
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

describe('readBoard — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      {
        quando: /from ideworks\.tree t\s+left join ideworks\.client_categories c/,
        colunas: [
          'list_id', 'list_name', 'list_content', 'folder_id', 'folder_name', 'space_id', 'space_name',
          { nome: 'is_live', oid: 16 }, 'category_name', 'list_client_id', 'list_client_name',
          { nome: 'requires_client', oid: 16 },
        ],
        linhas: () => [[LISTA, 'Atendimento', null, null, null, ESPACO, 'Entrega', 't', 'Ide', null, null, 'f']],
      },
      {
        quando: /from ideworks\.list_workflow lw/,
        colunas: ['status_set_name', 'inherited_from', 'status_id', 'status_name', 'status_type', 'status_color', 'status_sort_order'],
        linhas: () => [['Entrega', 'space', S_ABRE, 'A fazer', 'open', null, '1']],
      },
      {
        quando: /with marcada as/,
        colunas: ['id', 'title', 'status_id', 'priority', { nome: 'mapa', oid: 114 }, 'due_on'],
        linhas: () => [[id(70), 'Peça', S_ABRE, 'high', `{"${S_ABRE}":{"total":1,"matched":1}}`, null]],
      },
      { quando: /list_is_production/, colunas: [{ nome: 'producao', oid: 16 }], linhas: () => [['f']] },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('o quadro sai em 5 idas (eram 15): begin, lista+esteira, leva dos cartões (2), commit', async () => {
    falso.zerar();
    const quadro = await readBoard(sql, ator, LISTA);
    expect(quadro.header.listName).toBe('Atendimento');
    expect(quadro.tasks).toHaveLength(1);
    // Antes (medido em 2264a4f, mesmo teste): 15 idas.
    expect(falso.idas).toHaveLength(5);
    // Só a consulta dos cartões leva parâmetro (busca e responsável).
    const comParametro = falso.parametros.filter((p) => p.length > 0);
    expect(comParametro).toHaveLength(1);
    // Lista, esteira, produção, responsáveis, etiquetas e cartões.
    expect(falso.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(6);
  });

  it('lista que não existe: a mesma recusa 404, sem a leva dos cartões', async () => {
    const vazio = await criarPgFalso([]);
    const cliente = postgres(vazio.opcoesDoCliente()) as unknown as Sql;
    try {
      await expect(readBoard(cliente, ator, LISTA)).rejects.toMatchObject({
        constructor: BoardRefused,
        status: 404,
        message: 'Lista não encontrada, ou fora do seu alcance.',
      });
      expect(vazio.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(2);
    } finally {
      await cliente.end();
      await vazio.fechar();
    }
  });
});

/* ───────────────────────── no Postgres de verdade ───────────────────────── */

describe('readBoard — o id no texto devolve o que o parâmetro devolve', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await montarBancoDeQuadros(db);
  });

  afterAll(async () => {
    await db.close();
  });

  const rodar = (textoDireto: boolean, listId: string, porColuna?: number, filtro?: FiltroDeTarefas) => {
    const adaptador = criarAdaptadorPglite(db, { textoDireto });
    return { adaptador, resultado: readBoard(adaptador.sql, ator, listId, porColuna, filtro) };
  };

  const casos: Array<[string, string, number | undefined, FiltroDeTarefas | undefined]> = [
    ['sem filtro', LISTA, undefined, undefined],
    ['teto de 2 cartões por coluna', LISTA, 2, undefined],
    ['busca por texto (com acento dobrado)', LISTA, undefined, { texto: 'acao', responsavel: null }],
    ['por responsável', LISTA, undefined, { texto: '', responsavel: EU }],
    ['sem responsável', LISTA, undefined, { texto: '', responsavel: SEM_RESPONSAVEL }],
    ['busca que não acha nada (contagem à parte)', LISTA, undefined, { texto: 'nada disso existe', responsavel: null }],
  ];

  for (const [descricao, ...argumentos] of casos) {
    it(`${descricao}: a mesma resposta`, async () => {
      const porParametro = rodar(false, ...argumentos);
      const esperado = await porParametro.resultado;
      const porTexto = rodar(true, ...argumentos);
      const obtido = await porTexto.resultado;
      expect(obtido).toEqual(esperado);
      expect(obtido.tasks.length + Object.keys(obtido.columnTotals).length).toBeGreaterThan(0);
      // O id da lista foi mesmo para o texto nas leituras curtas.
      const curtas = porTexto.adaptador.consultas.filter((c) => c.includes('list_workflow') || c.includes('task_tags'));
      expect(curtas.every((c) => !/\$\d/.test(c))).toBe(true);
    });
  }

  it('o conteúdo: três colunas, contagens, responsáveis e etiquetas do espaço', async () => {
    const q = await rodar(true, LISTA).resultado;
    expect(q.header).toMatchObject({ listName: 'Atendimento', clientName: 'Jatobá', isProduction: true, statusSetName: 'Entrega' });
    expect(q.statuses.map((s) => s.name)).toEqual(['A fazer', 'Fazendo', 'Feito']);
    expect(Object.values(q.columnTotals).reduce((a, b) => a + b, 0)).toBe(12);
    expect(q.availableTags.map((t) => t.name)).toEqual(['agência', 'Urgente']);
    expect(q.assigneeOptions.map((o) => o.name).sort()).toEqual(['Eu', 'Outra']);
    expect(q.unassignedTasks).toBe(4);
    expect(q.filter).toEqual(SEM_FILTRO);
  });

  it('lista sem esteira: a mesma recusa 400, nos dois caminhos', async () => {
    for (const textoDireto of [false, true]) {
      await expect(rodar(textoDireto, LISTA_VAZIA).resultado).rejects.toMatchObject({ status: 400 });
    }
  });

  it('lista que não existe: a mesma recusa 404, nos dois caminhos', async () => {
    for (const textoDireto of [false, true]) {
      await expect(rodar(textoDireto, id(404)).resultado).rejects.toMatchObject({ status: 404 });
    }
  });
});
