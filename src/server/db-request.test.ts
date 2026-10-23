/**
 * F22, Fase 2 — uma conexão por requisição, e nenhum ator misturado.
 *
 * O QUE ESTES CASOS PROTEGEM
 *   1. A requisição abre UM cliente Postgres, por mais portos que a atravessem.
 *      É o número que a medição da Fase 1 publica no cabeçalho `x-ideworks-db`
 *      e a razão de ser desta fase.
 *   2. Esse cliente fecha UMA vez, e fecha em todos os desfechos: resposta,
 *      erro, recusa e prazo estourado — inclusive quando `withDeadline`
 *      responde antes de o trabalho terminar.
 *   3. Credenciais diferentes NÃO dividem conexão. É critério da F16.5, e
 *      compartilhar socket seria exatamente o jeito de regredir nele.
 *   4. Compartilhar o socket não compartilha o ator: cada `withActor` declara o
 *      seu DENTRO da própria transação, com `set_config(..., true)` — a forma
 *      local, que o Postgres desfaz no fim da transação.
 *
 * POR QUE UM CLIENTE DE MENTIRA
 *   A suíte não fala com banco (bloqueio de rede da F0.4). O que se quer provar
 *   aqui é de fiação — quantos clientes nascem, quantos morrem, e o que cada
 *   transação declara —, e isso o cliente de mentira mostra melhor do que o
 *   banco mostraria: ele CONTA. A prova contra o Postgres de verdade é a de
 *   concessões, em transação com rollback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const abertos: FakeSql[] = [];

/**
 * Quando ligado, o `end()` do cliente de mentira só termina quando a suíte
 * mandar — é assim que se observa o dreno lento de uma consulta órfã sem
 * depender de relógio.
 */
let soltarFechamento: (() => void) | null = null;

type FakeSql = {
  rotulo: string;
  alvo: string;
  fechamentos: number;
  /** Cada transação, com as declarações que rodaram dentro dela. */
  transacoes: string[][];
  end: (opcoes?: unknown) => Promise<void>;
  begin: (work: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
};

vi.mock('@/server/db', async () => {
  const real = await vi.importActual<typeof import('@/server/db')>('@/server/db');
  return {
    ...real,
    connect: (env: { HYPERDRIVE?: { connectionString: string } }, rotulo = 'db') => {
      const cliente: FakeSql = {
        rotulo,
        alvo: env.HYPERDRIVE?.connectionString ?? 'direto',
        fechamentos: 0,
        transacoes: [],
        async end() {
          if (soltarFechamento !== null) {
            await new Promise<void>((resolve) => {
              soltarFechamento = resolve;
            });
          }
          cliente.fechamentos += 1;
        },
        async begin(work: (tx: unknown) => Promise<unknown>) {
          const declaracoes: string[] = [];
          cliente.transacoes.push(declaracoes);
          // Etiqueta de template de mentira: guarda o texto e devolve vazio.
          const tx = (pedacos: TemplateStringsArray, ...valores: unknown[]) => {
            declaracoes.push(pedacos.join('?') + '|' + valores.map(String).join(','));
            return Promise.resolve([] as unknown[]);
          };
          return work(tx);
        },
      };
      abertos.push(cliente);
      return cliente as never;
    },
  };
});

const { borrowSql, withRequestDb } = await import('@/server/db-request');
const { withActor, userActor } = await import('@/server/db');

const ENV_A = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://exemplo.supabase.co',
  HYPERDRIVE: { connectionString: 'postgres://u:s@a/db' },
};
/** Mesmo banco, objeto de ambiente diferente — é o que o provedor OAuth entrega. */
const ENV_A_COPIA = { ...ENV_A };
/** Outra credencial. Nada aqui pode encostar no cliente de `ENV_A`. */
const ENV_B = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://exemplo.supabase.co',
  HYPERDRIVE: { connectionString: 'postgres://outro:outro@b/db' },
};

beforeEach(() => {
  abertos.length = 0;
  soltarFechamento = null;
});
afterEach(() => {
  abertos.length = 0;
  soltarFechamento = null;
});

describe('uma conexão por requisição', () => {
  it('onze portos na mesma requisição abrem um cliente só', async () => {
    await withRequestDb(async () => {
      for (const rotulo of [
        'concessoes',
        'concessoes',
        'freio',
        'freio',
        'freio',
        'freio',
        'concessoes',
        'concessoes',
        'catalogo',
        'catalogo',
        'trabalho',
      ]) {
        await borrowSql(ENV_A, rotulo, async () => undefined);
      }
    });

    expect(abertos).toHaveLength(1);
    expect(abertos[0].fechamentos).toBe(1);
  });

  it('o ambiente que o provedor OAuth recopia continua sendo o mesmo banco', async () => {
    await withRequestDb(async () => {
      await borrowSql(ENV_A, 'concessoes', async () => undefined);
      await borrowSql(ENV_A_COPIA, 'trabalho', async () => undefined);
    });

    expect(abertos).toHaveLength(1);
  });

  it('sem requisição em volta, cada porto continua abrindo e fechando o seu', async () => {
    await borrowSql(ENV_A, 'prova', async () => undefined);
    await borrowSql(ENV_A, 'prova', async () => undefined);

    expect(abertos).toHaveLength(2);
    expect(abertos.every((c) => c.fechamentos === 1)).toBe(true);
  });

  it('requisição que não toca no banco não abre conexão nenhuma', async () => {
    await withRequestDb(async () => 'sem banco');
    expect(abertos).toHaveLength(0);
  });
});

describe('fechamento único', () => {
  it('fecha uma vez quando o trabalho lança', async () => {
    await expect(
      withRequestDb(async () => {
        await borrowSql(ENV_A, 'concessoes', async () => undefined);
        throw new Error('falhou no meio');
      }),
    ).rejects.toThrow('falhou no meio');

    expect(abertos).toHaveLength(1);
    expect(abertos[0].fechamentos).toBe(1);
  });

  it('fecha uma vez quando a requisição recusa em vez de lançar', async () => {
    const resposta = await withRequestDb(async () => {
      await borrowSql(ENV_A, 'freio', async () => undefined);
      return new Response('recusado', { status: 429 });
    });

    expect(resposta.status).toBe(429);
    expect(abertos[0].fechamentos).toBe(1);
  });

  it('o prazo estourado fecha a conexão, e o trabalho órfão não deixa outra aberta', async () => {
    let soltar: () => void = () => {};
    const orfao = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    let depoisDoPrazo: Promise<unknown> | null = null;

    // O perdedor da corrida do `withDeadline`: continua correndo depois de a
    // resposta já ter saído.
    await expect(
      withRequestDb(async () => {
        await borrowSql(ENV_A, 'trabalho', async () => undefined);
        depoisDoPrazo = (async () => {
          await orfao;
          await borrowSql(ENV_A, 'trabalho', async () => undefined);
        })();
        throw new Error('deadline_exceeded');
      }),
    ).rejects.toThrow('deadline_exceeded');

    expect(abertos).toHaveLength(1);
    expect(abertos[0].fechamentos).toBe(1);

    soltar();
    await depoisDoPrazo;

    // O órfão abriu e FECHOU a sua própria — nunca ressuscitou a da requisição,
    // e não deixou socket pendurado.
    expect(abertos).toHaveLength(2);
    expect(abertos[0].fechamentos).toBe(1);
    expect(abertos[1].fechamentos).toBe(1);
  });
});

/**
 * O DRENO LENTO NÃO SEGURA A RESPOSTA — e também não é esquecido.
 *
 *   No desfecho de `deadline_exceeded` a consulta órfã ainda está em voo, e o
 *   `end({ timeout: 5 })` pode levar os cinco segundos inteiros. Somados aos 8 s
 *   do prazo, seriam treze — pior justamente para quem esta fase quer ajudar.
 */
describe('o fechamento lento sai do caminho da resposta', () => {
  it('com waitUntil, a resposta sai antes do fim do dreno — e o dreno termina', async () => {
    // `() => {}` só liga o modo "fechamento preso"; o `end()` troca este valor
    // pela função que realmente solta.
    soltarFechamento = () => {};
    let entregue: Promise<unknown> | null = null;

    await withRequestDb(
      async () => {
        await borrowSql(ENV_A, 'trabalho', async () => undefined);
      },
      { waitUntil: (promise) => { entregue = promise; } },
    );

    // A requisição já respondeu, e o cliente AINDA não fechou.
    expect(abertos).toHaveLength(1);
    expect(abertos[0].fechamentos).toBe(0);
    expect(entregue).not.toBeNull();

    // Soltar não é esquecer: quem recebeu a promessa termina o fechamento.
    soltarFechamento?.();
    await entregue;
    expect(abertos[0].fechamentos).toBe(1);
  });

  it('sem waitUntil, espera o fechamento inteiro — nada fica por terminar', async () => {
    soltarFechamento = () => {};
    let respondeu = false;

    const requisicao = withRequestDb(async () => {
      await borrowSql(ENV_A, 'trabalho', async () => undefined);
    }).then(() => {
      respondeu = true;
    });

    // Sem ninguém para segurar o isolado, a requisição NÃO pode devolver antes
    // de o fechamento terminar.
    await new Promise((r) => setTimeout(r, 0));
    expect(respondeu).toBe(false);
    expect(abertos[0].fechamentos).toBe(0);

    soltarFechamento?.();
    await requisicao;
    expect(respondeu).toBe(true);
    expect(abertos[0].fechamentos).toBe(1);
  });
});

describe('isolamento entre credenciais', () => {
  it('credencial diferente na mesma requisição não pega a conexão emprestada', async () => {
    await withRequestDb(async () => {
      await borrowSql(ENV_A, 'concessoes', async () => undefined);
      await borrowSql(ENV_B, 'concessoes', async () => undefined);
    });

    expect(abertos).toHaveLength(2);
    expect(abertos[0].alvo).not.toBe(abertos[1].alvo);
    expect(abertos.every((c) => c.fechamentos === 1)).toBe(true);
  });

  /**
   * ESTE é o caso que prova o `AsyncLocalStorage`, e por isso ele usa a MESMA
   * credencial nas duas requisições.
   *
   *   Com credenciais diferentes o teste passaria até com um `holder` guardado
   *   no módulo: a chave divergente já obrigaria dois clientes, e o
   *   armazenamento por contexto não seria testado. Com a mesma credencial, só
   *   o contexto por requisição separa uma da outra — um `holder` global
   *   entregaria o mesmo cliente às duas e fecharia uma vez só, e as duas
   *   últimas expectativas quebrariam.
   */
  it('duas requisições ao mesmo tempo, com a MESMA credencial, não dividem cliente', async () => {
    const vistos: FakeSql[] = [];
    await Promise.all([
      withRequestDb(async () => {
        await borrowSql(ENV_A, 'trabalho', async (sql) => {
          vistos.push(sql as unknown as FakeSql);
          await new Promise((r) => setTimeout(r, 5));
        });
        await borrowSql(ENV_A, 'trabalho', async (sql) => {
          vistos.push(sql as unknown as FakeSql);
        });
      }),
      withRequestDb(async () => {
        await borrowSql(ENV_A, 'trabalho', async (sql) => {
          vistos.push(sql as unknown as FakeSql);
        });
      }),
    ]);

    expect(abertos).toHaveLength(2);
    // Dentro de cada requisição, o MESMO cliente; entre elas, nunca.
    expect(vistos[0]).toBe(vistos[2]);
    expect(vistos[0]).not.toBe(vistos[1]);
    expect(abertos.every((c) => c.fechamentos === 1)).toBe(true);
  });
});

describe('o ator não se mistura na conexão compartilhada', () => {
  const ATOR_UM = userActor({
    userId: '11111111-1111-4111-8111-111111111111',
    isSuperadmin: false,
    isSuper: false,
    integration: {
      integrationId: 'ide-works',
      grantId: 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1',
      ownerId: '11111111-1111-4111-8111-111111111111',
      origin: 'mcp',
    },
  });
  const ATOR_DOIS = userActor({
    userId: '22222222-2222-4222-8222-222222222222',
    isSuperadmin: false,
    isSuper: false,
    integration: {
      integrationId: 'ide-works',
      grantId: 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2',
      ownerId: '22222222-2222-4222-8222-222222222222',
      origin: 'mcp',
    },
  });

  it('cada transação declara o seu ator, e declara LOCAL', async () => {
    await withRequestDb(async () => {
      await borrowSql(ENV_A, 'concessoes', (sql) => withActor(sql, ATOR_UM, async () => undefined));
      await borrowSql(ENV_A, 'trabalho', (sql) => withActor(sql, ATOR_DOIS, async () => undefined));
      await borrowSql(ENV_A, 'freio', (sql) => withActor(sql, { kind: 'preauth' }, async () => undefined));
    });

    expect(abertos).toHaveLength(1);
    const [primeira, segunda, terceira] = abertos[0].transacoes;

    // Uma transação por porto — a declaração de um não alcança o outro.
    expect(abertos[0].transacoes).toHaveLength(3);
    expect(primeira.join(' ')).toContain(ATOR_UM.userId);
    expect(primeira.join(' ')).not.toContain(ATOR_DOIS.userId);
    expect(segunda.join(' ')).toContain(ATOR_DOIS.userId);
    expect(segunda.join(' ')).not.toContain(ATOR_UM.userId);
    expect(terceira.join(' ')).toContain('app.preauth');
    expect(terceira.join(' ')).not.toContain(ATOR_UM.userId);

    /**
     * `set_config(..., true)` é o terceiro argumento LOCAL: o Postgres desfaz a
     * declaração no fim da transação. É esse `true` que deixa o socket ser
     * compartilhado sem o recorte vazar de uma transação para a seguinte — se
     * ele virasse `false`, o ator da primeira sobreviveria à terceira.
     */
    for (const declaracoes of abertos[0].transacoes) {
      expect(declaracoes.join(' ')).toContain('true');
    }
  });
});
