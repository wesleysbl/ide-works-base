/**
 * A CAIXA DE ENTRADA E A PASTILHA, EM IDAS E EM TEXTO — perf do servidor, 08/10/2026.
 *
 * `GET /api/board/notices/count` roda a cada 30 s em toda aba aberta, e
 * `GET /api/board/notices` abre a caixa (8 consultas em fila, o id da pessoa
 * como parâmetro em quase todas). Agora o id, o fuso, os tetos e o "incluir
 * vistos" vão no TEXTO, e as oito saem juntas.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. NO FIO (driver real): caixa 20 -> 3 idas; pastilha 6 -> 3, com e sem
 *      empresa omitida.
 *   2. O TEXTO é o mesmo: as consultas do caminho novo, com os valores de volta
 *      no lugar do que antes era parâmetro, são IGUAIS às do caminho antigo,
 *      letra por letra — nenhuma condição foi tocada, só o parâmetro virou texto.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countUnreadNotices, readNotices } from '@/server/board-avisos';
import type { Sql, Tx } from '@/server/db';
import { withActor } from '@/server/db';
import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EU = id(99);
const ALMA = id(2);

const base: AuthenticatedActor = {
  userId: EU,
  email: 'eu@ide.com',
  papel: 'funcionario',
  isSuperadmin: false,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: false,
};
const comOmitida: AuthenticatedActor = { ...base, categoriasOmitidas: [ALMA] };

describe('avisos — idas no fio', () => {
  let falso: PgFalso;
  let sql: Sql;

  beforeAll(async () => {
    falso = await criarPgFalso([
      { quando: /as unread/, colunas: [{ nome: 'unread', oid: 23 }], linhas: () => [['3']] },
    ]);
    sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
  });

  afterAll(async () => {
    await sql.end();
    await falso.fechar();
  });

  for (const [nome, ator] of [
    ['sem empresa omitida', base],
    ['com empresa omitida', comOmitida],
  ] as const) {
    it(`a pastilha (${nome}) sai em 3 idas, sem parâmetro — a cada 30 s em toda aba`, async () => {
      falso.zerar();
      expect(await countUnreadNotices(sql, ator)).toBe(3);
      // Antes (2264a4f): 6 idas — begin, set_config (2), a consulta com ~16 parâmetros (2), commit.
      expect(falso.idas).toHaveLength(3);
      expect(falso.parametros.flat()).toEqual([]);
    });

    it(`a caixa (${nome}) abre em 3 idas, eram 20`, async () => {
      falso.zerar();
      const caixa = await readNotices(sql, ator, false);
      expect(caixa.unread).toBe(3);
      // Antes (2264a4f): 20 idas — begin, set_config (2), oito consultas × 2, commit.
      expect(falso.idas).toHaveLength(3);
      expect(falso.parametros.flat()).toEqual([]);
      expect(falso.consultas.filter((c) => c.includes('ideworks.'))).toHaveLength(8);
    });
  }
});

/* ───────────────────── o texto é o mesmo, com os valores de volta ───────────────────── */

type Registro = { texto: string; valores: unknown[] };

/** Um `Tx` de mentira que monta o texto e guarda os valores; com `unsafe`, o texto direto entra no texto. */
function gravador(comTextoDireto: boolean) {
  const consultas: string[] = [];
  type Q = PromiseLike<unknown[]> & { __q: Registro };
  const fazer = (texto: string, valores: unknown[]): Q => {
    const q = {
      __q: { texto, valores },
      then(ok: (r: unknown[]) => unknown, falha?: (e: unknown) => unknown) {
        // O texto final: cada `?` volta a ser o valor que viajava como parâmetro.
        consultas.push(renderizar(this.__q));
        const linhas = /as unread/.test(texto) ? [{ unread: 0 }] : [];
        return Promise.resolve(linhas).then(ok, falha);
      },
    };
    return q as unknown as Q;
  };
  const isQ = (v: unknown): v is Q => typeof v === 'object' && v !== null && '__q' in v;
  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    let texto = strings[0];
    const valores: unknown[] = [];
    args.forEach((a, i) => {
      if (isQ(a)) {
        texto += a.__q.texto;
        valores.push(...a.__q.valores);
      } else {
        texto += '?';
        valores.push(a);
      }
      texto += strings[i + 1];
    });
    return fazer(texto, valores);
  }) as unknown as Tx & { unsafe?: (t: string) => unknown };
  if (comTextoDireto) (tx as { unsafe?: (t: string) => unknown }).unsafe = (t: string) => fazer(t, []);
  const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) } as unknown as Sql;
  return { sql, consultas };
}

function renderizar(q: Registro): string {
  let i = 0;
  const valor = (v: unknown): string => {
    if (Array.isArray(v)) return `array[${v.map((x) => `'${String(x)}'`).join(',')}]`;
    if (typeof v === 'string') return `'${v}'`;
    return String(v);
  };
  return q.texto.replace(/\?/g, () => valor(q.valores[i++]));
}

/** Tira o que não muda a consulta: espaços repetidos. */
const normal = (c: string) => c.replace(/\s+/g, ' ').trim();

describe('avisos — o texto direto é o texto de antes com os valores no lugar', () => {
  for (const [nome, ator] of [
    ['sem empresa omitida', base],
    ['com empresa omitida', comOmitida],
  ] as const) {
    for (const vistos of [false, true]) {
      it(`a caixa (${nome}, incluir vistos = ${vistos}): as oito consultas são idênticas`, async () => {
        const antigo = gravador(false);
        const novo = gravador(true);
        await readNotices(antigo.sql, ator, vistos);
        await readNotices(novo.sql, ator, vistos);
        // O `set_config` do `withActor` só existe no caminho real; aqui `withActor` chama o bloco direto.
        const a = antigo.consultas.filter((c) => c.includes('ideworks.')).map(normal);
        const b = novo.consultas.filter((c) => c.includes('ideworks.')).map(normal);
        expect(a).toHaveLength(8);
        expect(b).toEqual(a);
        // E nenhuma sobrou com `?` (parâmetro) no caminho novo.
        expect(novo.consultas.every((c) => !c.includes('?'))).toBe(true);
      });
    }

    it(`a pastilha (${nome}): a consulta é idêntica`, async () => {
      const antigo = gravador(false);
      const novo = gravador(true);
      await countUnreadNotices(antigo.sql, ator);
      await countUnreadNotices(novo.sql, ator);
      expect(novo.consultas.map(normal)).toEqual(antigo.consultas.map(normal));
    });
  }

  it('o ator declarado também vai no texto, igual ao do caminho por parâmetro (dublê de withActor real)', async () => {
    // `withActor` real contra o gravador: o texto direto da declaração carrega os mesmos valores.
    const antigo = gravador(false);
    const novo = gravador(true);
    await withActor(antigo.sql, { kind: 'user', userId: EU, isSuperadmin: false, isSuper: false }, async (tx) => {
      await tx`select 1`;
    });
    await withActor(novo.sql, { kind: 'user', userId: EU, isSuperadmin: false, isSuper: false }, async (tx) => {
      await tx`select 1`;
    });
    const valores = (c: string) => [...c.matchAll(/set_config\('(app\.[a-z_]+)',\s*'([^']*)'/g)].map((m) => `${m[1]}=${m[2]}`);
    const a = antigo.consultas.find((c) => c.includes('set_config')) ?? '';
    const b = novo.consultas.find((c) => c.includes('set_config')) ?? '';
    expect(valores(b)).toEqual(valores(a));
    expect(valores(b)).toContain(`app.user_id=${EU}`);
  });
});
