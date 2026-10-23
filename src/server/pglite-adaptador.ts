/**
 * UM `Sql`/`Tx` SOBRE O PGLITE — para provar que a consulta nova devolve as MESMAS linhas.
 *
 * O repositório já tem vários adaptadores iguais a este, um por arquivo de
 * teste (`*-banco.test.ts`). Este é o compartilhado pelos testes de desempenho
 * de 08/10/2026, que precisam de duas coisas que os outros não têm:
 *
 *   · `tx.unsafe(texto)` — o caminho do id escrito no texto (`inlineUuid`). Sem
 *     ele, `inlineUuid` cai no parâmetro e o teste provaria só o caminho antigo.
 *     Ligado, o texto direto vai de verdade para o Postgres.
 *   · o registro do que rodou (`consultas`, `transacoes`) — para contar.
 *
 * NÃO MODELA O FIO. Quantas idas a rede faz é com `pg-falso.ts`; aqui se conta
 * consulta e transação, e se confere o RESULTADO.
 *
 * As consultas rodam sob o papel que o teste escolher (`papel`), numa transação
 * que termina em `rollback` — nada vaza de um caso para o outro —, a não ser que
 * o teste peça `confirmar` para enxergar o que a escrita deixou.
 */
import type { PGlite } from '@electric-sql/pglite';

import type { Sql, Tx } from '@/server/db';

type Fragmento = {
  readonly dublê: true;
  readonly strings: readonly string[];
  readonly args: readonly unknown[];
};

const ehFragmento = (v: unknown): v is Fragmento =>
  typeof v === 'object' && v !== null && (v as Fragmento).dublê === true;

function montar(f: Fragmento, params: unknown[]): string {
  let texto = f.strings[0] ?? '';
  f.args.forEach((a, i) => {
    if (ehFragmento(a)) texto += montar(a, params);
    else {
      params.push(a);
      texto += `$${params.length}`;
    }
    texto += f.strings[i + 1] ?? '';
  });
  return texto;
}

export type AdaptadorPglite = {
  sql: Sql;
  tx: Tx;
  /** O texto de cada consulta executada, na ordem (sem o `begin`/`rollback` do adaptador). */
  consultas: string[];
  /** Quantas vezes `sql.begin` foi chamado. */
  transacoes: () => number;
  /** Zera os registros. */
  zerar: () => void;
};

export function criarAdaptadorPglite(
  db: PGlite,
  opcoes: {
    /** Papel de banco da transação (`set local role`). Omitido = o dono da conexão. */
    papel?: string;
    /** Liga `tx.unsafe`, como o cliente real tem. Desligado, `inlineUuid` usa parâmetro. */
    textoDireto?: boolean;
    /** `commit` em vez de `rollback` — para o teste que precisa ver o que a escrita deixou. */
    confirmar?: boolean;
  } = {},
): AdaptadorPglite {
  const consultas: string[] = [];
  let transacoes = 0;

  const etiqueta = (strings: TemplateStringsArray | readonly string[], args: unknown[]) => {
    const f: Fragmento & PromiseLike<unknown[]> = {
      dublê: true,
      strings,
      args,
      then(ok, falha) {
        const params: unknown[] = [];
        const texto = montar(f, params);
        consultas.push(texto);
        return db
          .query(texto, params)
          .then((r) => r.rows)
          .then(ok, falha);
      },
    };
    return f;
  };

  const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => etiqueta(strings, args)) as unknown as Tx;
  if (opcoes.textoDireto) {
    // Como o cliente real: sozinho executa o texto; dentro de um template, entra como fragmento.
    (tx as unknown as { unsafe: (texto: string) => unknown }).unsafe = (texto: string) => etiqueta([texto], []);
  }

  const sql = {
    begin: async (trabalho: (t: Tx) => Promise<unknown>) => {
      transacoes += 1;
      await db.exec(opcoes.papel ? `begin; set local role ${opcoes.papel};` : 'begin;');
      try {
        return await trabalho(tx);
      } finally {
        await db.exec(opcoes.confirmar ? 'commit;' : 'rollback;');
      }
    },
  } as unknown as Sql;

  return {
    sql,
    tx,
    consultas,
    transacoes: () => transacoes,
    zerar() {
      consultas.length = 0;
      transacoes = 0;
    },
  };
}
