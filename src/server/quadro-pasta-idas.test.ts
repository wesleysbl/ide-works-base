/**
 * O QUADRO DE UMA PASTA, EM IDAS E EM LINHAS — perf do servidor, 08/10/2026.
 *
 * `readFolderBoard` fazia oito consultas em fila, quase todas com o id da pasta
 * como parâmetro. Mesma troca de `readBoard`: o id vai no texto, a pasta, as
 * listas e as colunas saem juntas, e as contagens, os responsáveis e as
 * etiquetas saem com a consulta dos cartões — esta por último.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. NO FIO (driver real + servidor de fio): 18 -> 5 idas (o "antes" é o de 2264a4f).
 *   2. NO POSTGRES DE VERDADE (PGlite): a resposta é a MESMA com o id no texto e
 *      com parâmetro — sem filtro, com teto, com busca, por responsável, sem
 *      responsável, busca vazia; e as três saídas antecipadas (pasta que não
 *      existe, pasta sem lista, pasta sem esteira) são as de antes.
 */
import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEM_RESPONSAVEL, type FiltroDeTarefas } from '@/board/filtro';
import { readFolderBoard } from '@/server/board-pasta';
import type { Sql } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import {
  EU,
  ESPACO,
  LISTA_A,
  LISTA_B,
  PASTA,
  PASTA_VAZIA,
  S_ABRE,
  id,
  montarBancoDeQuadros,
} from '@/server/quadro-fixture';
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

describe('readFolderBoard — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      {
        quando: /from ideworks\.folders f\s+join ideworks\.spaces s/,
        colunas: ['id', 'name', 'archived_at', 'space_id', 'space_name', 'category_name'],
        linhas: () => [[PASTA, 'TIME CARLA', null, ESPACO, 'Entrega', 'Ide']],
      },
      { quando: /select l\.id, l\.name\s+from ideworks\.lists l/, colunas: ['id', 'name'], linhas: () => [[LISTA_A, 'Lista A']] },
      {
        quando: /mode\(\) within group/,
        colunas: ['chave', 'nome', 'tipo', 'cor', 'listas', 'ordem', { nome: 'por_lista', oid: 114 }],
        linhas: () => [['a fazer', 'A fazer', 'open', null, '1', '1', `{"${LISTA_A}":"${S_ABRE}"}`]],
      },
      {
        quando: /with etapas as[\s\S]*marcada as/,
        colunas: ['id', 'title', 'status_id', 'priority', 'list_id', 'chave', { nome: 'mapa', oid: 114 }],
        linhas: () => [[id(201), 'Arte', S_ABRE, 'high', LISTA_A, 'a fazer', '{"a fazer":{"total":1,"matched":1}}']],
      },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('o quadro da pasta sai em 5 idas, e só a consulta dos cartões leva parâmetro', async () => {
    falso.zerar();
    const quadro = await readFolderBoard(sql, ator, PASTA);
    expect(quadro.header.folderName).toBe('TIME CARLA');
    expect(quadro.tasks).toHaveLength(1);
    expect(quadro.tasks[0]).toMatchObject({ listName: 'Lista A', columnKey: 'a fazer' });
    // Antes (medido em 2264a4f, mesmo teste): 18 idas.
    expect(falso.idas).toHaveLength(5);
    expect(falso.parametros.filter((p) => p.length > 0)).toHaveLength(1);
    expect(falso.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(7);
  });

  it('pasta que não existe: 404, e só a primeira leva (nada de consulta pesada)', async () => {
    const vazio = await criarPgFalso([]);
    const cliente = postgres(vazio.opcoesDoCliente()) as unknown as Sql;
    try {
      await expect(readFolderBoard(cliente, ator, PASTA)).rejects.toMatchObject({
        status: 404,
        message: 'Pasta não encontrada, ou fora do seu alcance.',
      });
      expect(vazio.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(3);
    } finally {
      await cliente.end();
      await vazio.fechar();
    }
  });
});

describe('readFolderBoard — o id no texto devolve o que o parâmetro devolve', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await montarBancoDeQuadros(db);
  });

  afterAll(async () => {
    await db.close();
  });

  const rodar = (textoDireto: boolean, folderId: string, porColuna?: number, filtro?: FiltroDeTarefas) => {
    const adaptador = criarAdaptadorPglite(db, { textoDireto });
    return { adaptador, resultado: readFolderBoard(adaptador.sql, ator, folderId, porColuna, filtro) };
  };

  const casos: Array<[string, string, number | undefined, FiltroDeTarefas | undefined]> = [
    ['sem filtro', PASTA, undefined, undefined],
    ['teto de 1 cartão por coluna', PASTA, 1, undefined],
    ['busca por texto (acento dobrado)', PASTA, undefined, { texto: 'acao', responsavel: null }],
    ['por responsável', PASTA, undefined, { texto: '', responsavel: EU }],
    ['sem responsável', PASTA, undefined, { texto: '', responsavel: SEM_RESPONSAVEL }],
    ['busca que não acha nada', PASTA, undefined, { texto: 'nada disso existe', responsavel: null }],
  ];

  for (const [descricao, ...argumentos] of casos) {
    it(`${descricao}: a mesma resposta`, async () => {
      const esperado = await rodar(false, ...argumentos).resultado;
      const porTexto = rodar(true, ...argumentos);
      const obtido = await porTexto.resultado;
      expect(obtido).toEqual(esperado);
      expect(obtido.lists.map((l) => l.name)).toEqual(['Lista A', 'Lista B']);
      // O id da pasta foi para o texto das leituras curtas.
      const curtas = porTexto.adaptador.consultas.filter((c) => /mode\(\) within group|from ideworks\.lists l\s+where l\.folder_id/.test(c));
      expect(curtas.length).toBeGreaterThanOrEqual(2);
      expect(curtas.every((c) => !/\$\d/.test(c))).toBe(true);
    });
  }

  it('o conteúdo: três etapas, contagem por lista, responsáveis, 6 tarefas', async () => {
    const q = await rodar(true, PASTA).resultado;
    expect(q.header).toMatchObject({ folderName: 'TIME CARLA', lists: 2 });
    expect(q.etapas.map((e) => e.name)).toEqual(['A fazer', 'Fazendo', 'Feito']);
    expect(q.lists).toEqual([
      { id: LISTA_A, name: 'Lista A', tasks: 3 },
      { id: LISTA_B, name: 'Lista B', tasks: 3 },
    ]);
    expect(q.tasks).toHaveLength(6);
    expect(Object.values(q.columnTotals).reduce((a, b) => a + b, 0)).toBe(6);
    expect(q.unassignedTasks).toBe(3);
  });

  it('pasta que não existe e pasta sem lista: as mesmas saídas, nos dois caminhos', async () => {
    for (const textoDireto of [false, true]) {
      await expect(rodar(textoDireto, id(404)).resultado).rejects.toMatchObject({ status: 404 });
      const vazia = await rodar(textoDireto, PASTA_VAZIA).resultado;
      expect(vazia).toMatchObject({ lists: [], tasks: [], etapas: [], columnTotals: {}, unassignedTasks: 0 });
    }
    const a = await rodar(false, PASTA_VAZIA).resultado;
    const b = await rodar(true, PASTA_VAZIA).resultado;
    expect(b).toEqual(a);
  });
});
