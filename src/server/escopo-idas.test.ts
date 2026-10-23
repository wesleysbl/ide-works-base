/**
 * AS TAREFAS DE UM ESCOPO, EM IDAS — perf do servidor, 09/10/2026.
 *
 * `readScopeTasks` (as telas de Lista e Kanban de espaço, pasta e lista) fazia de
 * seis a oito consultas em fila, cada uma com o id do escopo como parâmetro.
 * Agora o id vai no texto: o cabeçalho, as listas e os responsáveis do menu saem
 * juntos na mesma ida; a página dos cartões (que leva os filtros como parâmetro)
 * vem sozinha; e as pastas e as etapas, que precisam do cabeçalho e das
 * contagens, fecham numa terceira ida.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   NO FIO (driver real + servidor de fio): o número de idas de uma primeira
 *   página (com catálogo) e de uma página seguinte (só cabeçalho + página), e que
 *   escopo inexistente recusa com a mesma frase. A equivalência de resposta, linha
 *   a linha e sob as políticas de linha, está em `tarefas-do-escopo-banco.test.ts`
 *   (PGlite, texto direto contra parâmetro).
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lerPedidoDoEscopo, readScopeTasks, type PedidoInternoDoEscopo } from '@/server/tarefas-do-escopo';
import type { Sql } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ESPACO = id(1);
const LISTA = id(2);
const FLUXO = id(3);
const ETAPA = id(4);
const EU = id(99);

const ator: AuthenticatedActor = {
  userId: EU,
  email: 'eu@ide.com',
  papel: 'super_admin',
  isSuperadmin: true,
  isSuper: true,
  areas: [],
  hasAllClientsAccess: true,
};

function pedido(consulta: Record<string, string>): PedidoInternoDoEscopo {
  const lido = lerPedidoDoEscopo(new URLSearchParams(consulta));
  if (!lido.ok) throw new Error(lido.message);
  return lido.pedido;
}

describe('readScopeTasks — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      {
        quando: /with marcada as materialized/,
        colunas: [{ nome: 'mapa', oid: 114 }, 'id'],
        linhas: () => [[`{"${ETAPA}":{"total":3,"abertas":3,"matched":3}}`, null]],
      },
      {
        quando: /resolve_status_set\(l\.id\)/,
        colunas: ['id', 'name', 'folder_id', 'folder_name', { nome: 'archived', oid: 16 }, 'client_id', 'client_name', 'workflow_id'],
        linhas: () => [[LISTA, 'Lista A', null, null, 'f', null, null, FLUXO]],
      },
      { quando: /assignee_filter_people/, colunas: ['id', 'name', 'tasks', 'com_dono'], linhas: () => [[EU, 'Eu', '3', '3']] },
      {
        quando: /select st\.id, st\.name, st\.type::text as type/,
        colunas: ['id', 'name', 'type', 'color', 'sort_order', 'workflow_id', 'workflow_name'],
        linhas: () => [[ETAPA, 'A fazer', 'open', null, '1', FLUXO, 'Entrega']],
      },
      { quando: /select f\.id, f\.name, \(f\.archived_at is not null\) as archived/, colunas: ['id', 'name', 'archived'], linhas: () => [] },
      {
        quando: /from ideworks\.spaces s\s+where s\.id/,
        colunas: ['space_id', 'space_name', 'folder_id', 'folder_name', 'list_id', 'list_name', { nome: 'archived', oid: 16 }],
        linhas: () => [[ESPACO, 'Entrega', null, null, null, null, 'f']],
      },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  it('a primeira página de um espaço sai em 6 idas (eram 16), e só a página leva parâmetro', async () => {
    falso.zerar();
    const lida = await readScopeTasks(sql, ator, pedido({ escopo: 'espaco', id: ESPACO }));
    expect(lida.header.spaceName).toBe('Entrega');
    expect(lida.counts.total).toBe(3);
    expect(lida.catalog?.listas.map((l) => l.name)).toEqual(['Lista A']);
    expect(lida.catalog?.fluxos[0]?.etapas.map((e) => e.name)).toEqual(['A fazer']);
    expect(lida.catalog?.assigneeOptions).toEqual([{ id: EU, name: 'Eu', tasks: 3 }]);
    // Antes (medido em 2264a4f, mesmo teste): 16 idas.
    // Hoje: begin · cabeçalho+listas+responsáveis · página (2) · pastas+etapas · commit.
    expect(falso.idas).toHaveLength(6);
    expect(falso.parametros.filter((p) => p.length > 0)).toHaveLength(1);
    expect(falso.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(6);
  });

  it('a página seguinte (com cursor) lê só o cabeçalho e a página: 5 idas (eram 8)', async () => {
    falso.zerar();
    const primeira = pedido({ escopo: 'espaco', id: ESPACO });
    const seguinte = pedido({
      escopo: 'espaco',
      id: ESPACO,
      cursor: Buffer.from(
        JSON.stringify({ v: 1, escopo: 'espaco', alvo: ESPACO, dueOn: null, priority: null, title: 'a', id: LISTA }),
      )
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, ''),
    });
    expect(primeira.cursor).toBeNull();
    const lida = await readScopeTasks(sql, ator, seguinte);
    expect(lida.catalog).toBeUndefined();
    // Antes (medido em 2264a4f, mesmo teste): 8 idas.
    expect(falso.idas).toHaveLength(5);
    expect(falso.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(2);
  });

  it('escopo que não existe: a mesma recusa 404, sem a página', async () => {
    const vazio = await criarPgFalso([]);
    const cliente = postgres(vazio.opcoesDoCliente()) as unknown as Sql;
    try {
      await expect(readScopeTasks(cliente, ator, pedido({ escopo: 'lista', id: LISTA }))).rejects.toMatchObject({
        status: 404,
        message: 'Lista não encontrada, ou fora do seu alcance.',
      });
      // O cabeçalho, as listas e os responsáveis já tinham saído juntos; a página e o resto não.
      expect(vazio.consultas.filter((c) => c.includes('ideworks.') && c.includes('marcada'))).toHaveLength(0);
    } finally {
      await cliente.end();
      await vazio.fechar();
    }
  });
});
