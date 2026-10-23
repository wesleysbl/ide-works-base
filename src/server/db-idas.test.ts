/**
 * IDAS AO BANCO, CONTADAS NO FIO COM O DRIVER DE VERDADE — perf do servidor, 08/10/2026.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. `withActor` gasta menos idas que a versão anterior, declarando EXATAMENTE
 *      os mesmos valores, na mesma transação e antes de qualquer consulta do
 *      bloco (é isso que mantém o recorte de linha).
 *   2. O que não tem formato conhecido NÃO vira texto: cai no parâmetro, como
 *      antes — inclusive uma tentativa de injeção.
 *   3. `inlineUuid` tira o parâmetro da consulta, e consultas sem parâmetro
 *      viajam juntas.
 *
 * COMO SE CONTA
 *   `test/helpers/pg-falso.ts`: o `postgres.js` real, com `prepare: false` como
 *   no Worker, fala com um servidor mínimo em `127.0.0.1`. Uma "ida" é um pacote
 *   do cliente que o servidor responde antes de o cliente falar de novo. O
 *   números "antes" saem da CÓPIA do `withActor` anterior que mora aqui embaixo,
 *   rodada no mesmo fio — e não de uma estimativa.
 */
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarPgFalso, type PgFalso } from '@/server/pg-falso';
import {
  assertIntegrationActor,
  declaracaoDoUsuarioNoTexto,
  inlineLetras,
  inlineSha256,
  inlineTimestamp,
  inlineUuid,
  inlineWord,
  userActor,
  withActor,
  type Actor,
  type Sql,
  type Tx,
} from '@/server/db';
import { resolveActor } from '@/server/session';

const EU = '11111111-1111-4111-8111-111111111111';
const INTEGRACAO = '22222222-2222-4222-8222-222222222222';
const CONCESSAO = '33333333-3333-4333-8333-333333333333';
const TAREFA = '0b6b6a9e-0f3e-4b0c-9d11-0123456789ab';

let falso: PgFalso;
let sql: Sql;

beforeAll(async () => {
  falso = await criarPgFalso([
    { quando: /set_config/i, colunas: ['a'], linhas: () => [['x']] },
    { quando: /from tarefas/i, colunas: ['id'], linhas: (p) => [[p[0] ?? 'sem-parametro']] },
  ]);
  // Como no Worker: `prepare: false`, porque o agrupador do Hyperdrive não aceita instrução preparada.
  sql = postgres(falso.opcoesDoCliente()) as unknown as Sql;
});

afterAll(async () => {
  await sql.end();
  await falso.fechar();
});

beforeEach(() => falso.zerar());

/** O `withActor` de ANTES, copiado como estava: declaração por parâmetro, esperada. */
async function withActorAntigo<T>(conexao: Sql, actor: Actor, work: (tx: Tx) => Promise<T>): Promise<T> {
  return conexao.begin(async (tx) => {
    if (actor.kind === 'collector') {
      // nada
    } else if (actor.kind === 'preauth') {
      await tx`select set_config('app.preauth', 'true', true)`;
    } else {
      assertIntegrationActor(actor);
      const integration = actor.integration;
      await tx`
        select set_config('app.user_id', ${actor.userId}, true),
               set_config('app.is_superadmin', ${actor.isSuperadmin ? 'true' : 'false'}, true),
               set_config('app.is_super', ${actor.isSuper ? 'true' : 'false'}, true),
               set_config('app.integration_id', ${integration?.integrationId ?? ''}, true),
               set_config('app.grant_id', ${integration?.grantId ?? ''}, true),
               set_config('app.integration_owner_id', ${integration?.ownerId ?? ''}, true),
               set_config('app.execution_origin', ${integration?.origin ?? ''}, true)`;
    }
    return work(tx as unknown as Tx);
  }) as Promise<T>;
}

const humano = userActor({ userId: EU, isSuperadmin: true, isSuper: false });
const agente = userActor({
  userId: EU,
  isSuperadmin: false,
  isSuper: false,
  integration: { integrationId: INTEGRACAO, grantId: CONCESSAO, ownerId: EU, origin: 'mcp' },
});

/** Uma consulta com parâmetro e outra sem — os dois jeitos que as rotas usam. */
const comParametro = (tx: Tx) => tx`select id from tarefas where id = ${TAREFA}`;
const semParametro = (tx: Tx) => tx`select id from tarefas`;

/** Roda um bloco e devolve quantas idas o fio viu. */
async function contar(rodar: () => Promise<unknown>): Promise<number> {
  falso.zerar();
  await rodar();
  return falso.idas.length;
}

/** Pares nome → valor que a declaração gravou, lidos do texto direto ou dos parâmetros. */
function declaracaoVista(): Record<string, string> {
  const i = falso.consultas.findIndex((c) => /app\.user_id/.test(c));
  const texto = falso.consultas[i];
  const params = falso.parametros[i];
  const saida: Record<string, string> = {};
  // Texto direto: set_config('app.x', 'valor', true). Por parâmetro: set_config('app.x', $n, true).
  for (const m of texto.matchAll(/set_config\('(app\.[a-z_]+)',\s*(?:'([^']*)'|\$(\d+)),\s*true\)/g)) {
    saida[m[1]] = m[2] !== undefined ? m[2] : (params[Number(m[3]) - 1] ?? '');
  }
  return saida;
}

describe('withActor — idas de moldura', () => {
  it('ator de pessoa + uma consulta com parâmetro: de 6 idas para 4', async () => {
    const antes = await contar(() => withActorAntigo(sql, humano, comParametro));
    const depois = await contar(() => withActor(sql, humano, comParametro));
    expect(antes).toBe(6); // begin, set_config (2), consulta (2), commit
    expect(depois).toBe(4); // begin, set_config+describe, execute, commit
  });

  it('ator de pessoa + consulta sem parâmetro: de 5 idas para 3', async () => {
    const antes = await contar(() => withActorAntigo(sql, humano, semParametro));
    const depois = await contar(() => withActor(sql, humano, semParametro));
    expect(antes).toBe(5);
    expect(depois).toBe(3); // begin, set_config+consulta, commit
  });

  it('ator de agente (variáveis de integração) paga o mesmo que o de pessoa', async () => {
    expect(await contar(() => withActorAntigo(sql, agente, comParametro))).toBe(6);
    expect(await contar(() => withActor(sql, agente, comParametro))).toBe(4);
  });

  it('preauth (login, conferência de perfil): de 5 para 4 com parâmetro, de 4 para 3 sem', async () => {
    const preauth: Actor = { kind: 'preauth' };
    expect(await contar(() => withActorAntigo(sql, preauth, comParametro))).toBe(5);
    expect(await contar(() => withActor(sql, preauth, comParametro))).toBe(4);
    expect(await contar(() => withActorAntigo(sql, preauth, semParametro))).toBe(4);
    expect(await contar(() => withActor(sql, preauth, semParametro))).toBe(3);
  });

  it('coletor não declara nada, e continua sem declarar', async () => {
    const coletor: Actor = { kind: 'collector' };
    expect(await contar(() => withActor(sql, coletor, semParametro))).toBe(await contar(() => withActorAntigo(sql, coletor, semParametro)));
    expect(falso.consultas.some((c) => /set_config/.test(c))).toBe(false);
  });
});

describe('withActor — o recorte de linha é o mesmo', () => {
  it('declara os mesmos valores que o caminho por parâmetro, para pessoa e para agente', async () => {
    for (const ator of [humano, agente]) {
      falso.zerar();
      await withActorAntigo(sql, ator, semParametro);
      const antes = declaracaoVista();

      falso.zerar();
      await withActor(sql, ator, semParametro);
      const depois = declaracaoVista();

      expect(depois).toEqual(antes);
      expect(depois['app.user_id']).toBe(EU);
    }
    // Conferência explícita do agente, para o teste não depender só da igualdade.
    falso.zerar();
    await withActor(sql, agente, semParametro);
    expect(declaracaoVista()).toEqual({
      'app.user_id': EU,
      'app.is_superadmin': 'false',
      'app.is_super': 'false',
      'app.integration_id': INTEGRACAO,
      'app.grant_id': CONCESSAO,
      'app.integration_owner_id': EU,
      'app.execution_origin': 'mcp',
    });
  });

  it('a declaração chega ANTES da primeira consulta do bloco, na mesma transação', async () => {
    await withActor(sql, humano, async (tx) => {
      await comParametro(tx);
      await semParametro(tx);
    });
    const textos = falso.consultas.map((c) => c.replace(/\s+/g, ' ').trim());
    expect(textos[0]).toBe('begin');
    expect(textos[1]).toMatch(/^select set_config\('app\.user_id'/);
    expect(textos[2]).toMatch(/from tarefas where id = \$1/);
    expect(textos[3]).toMatch(/from tarefas$/);
    expect(textos[textos.length - 1]).toBe('commit');
  });

  it('o ator de uma transação não vaza para a seguinte na mesma conexão', async () => {
    const outro = userActor({ userId: '99999999-9999-4999-8999-999999999999', isSuperadmin: false, isSuper: false });
    await withActor(sql, agente, semParametro);
    falso.zerar();
    await withActor(sql, outro, semParametro);
    const v = declaracaoVista();
    expect(v['app.user_id']).toBe('99999999-9999-4999-8999-999999999999');
    // As quatro variáveis da integração saem SEMPRE, vazias para quem não tem concessão.
    expect(v['app.integration_id']).toBe('');
    expect(v['app.grant_id']).toBe('');
    expect(v['app.execution_origin']).toBe('');
  });

  it('declaração que falha derruba o bloco com o erro de origem', async () => {
    const quebrado = await criarPgFalso([{ quando: /set_config/i, erro: 'sem permissão para declarar' }]);
    const cliente = postgres(quebrado.opcoesDoCliente()) as unknown as Sql;
    try {
      let executouTrabalho = false;
      await expect(
        withActor(cliente, humano, async (tx) => {
          executouTrabalho = true;
          await semParametro(tx);
          return 'passou';
        }),
      ).rejects.toThrow('sem permissão para declarar');
      expect(executouTrabalho).toBe(true);
      // A transação terminou em rollback: nada ficou aberto na conexão.
      expect(quebrado.consultas[quebrado.consultas.length - 1]).toBe('rollback');
    } finally {
      await cliente.end();
      await quebrado.fechar();
    }
  });

  it('erro do próprio bloco continua sendo o erro do bloco, com rollback', async () => {
    await expect(
      withActor(sql, humano, async (tx) => {
        await semParametro(tx);
        throw new Error('regra de negócio recusou');
      }),
    ).rejects.toThrow('regra de negócio recusou');
    expect(falso.consultas[falso.consultas.length - 1]).toBe('rollback');
  });
});

describe('o que não tem formato conhecido não vira texto', () => {
  it('id de pessoa fora do padrão cai no parâmetro — e a injeção nunca chega ao texto', async () => {
    const injecao = "x'); drop schema ideworks cascade; --";
    const torto = userActor({ userId: injecao, isSuperadmin: false, isSuper: false });
    expect(declaracaoDoUsuarioNoTexto(torto)).toBeNull();

    await withActor(sql, torto, semParametro);
    const [decl] = falso.consultas.filter((c) => /set_config\('app\.user_id'/.test(c));
    expect(decl).not.toContain('drop schema');
    expect(decl).toContain('$1');
    const i = falso.consultas.indexOf(decl);
    expect(falso.parametros[i][0]).toBe(injecao);
  });

  it('origem desconhecida, id de concessão torto e UUID com lixo recusam o texto direto', () => {
    const base = { userId: EU, isSuperadmin: false, isSuper: false } as const;
    const comIntegracao = (extra: Partial<{ integrationId: string; grantId: string; ownerId: string; origin: string }>) =>
      ({
        kind: 'user',
        ...base,
        integration: { integrationId: INTEGRACAO, grantId: CONCESSAO, ownerId: EU, origin: 'mcp', ...extra },
      }) as unknown as Extract<Actor, { kind: 'user' }>;

    expect(declaracaoDoUsuarioNoTexto(comIntegracao({}))).not.toBeNull();
    expect(declaracaoDoUsuarioNoTexto(comIntegracao({ origin: "mcp'" }))).toBeNull();
    expect(declaracaoDoUsuarioNoTexto(comIntegracao({ grantId: 'grant-1' }))).toBeNull();
    expect(declaracaoDoUsuarioNoTexto(comIntegracao({ integrationId: `${INTEGRACAO}'` }))).toBeNull();
    expect(declaracaoDoUsuarioNoTexto(comIntegracao({ ownerId: `${EU} ` }))).toBeNull();
    expect(declaracaoDoUsuarioNoTexto(userActor({ ...base, userId: `${EU}\n` }))).toBeNull();
  });

  it('o texto direto só tem aspas em volta de UUID, booleano e origem', () => {
    const texto = declaracaoDoUsuarioNoTexto(agente) as string;
    const literais = [...texto.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const permitidos = [
      /^app\.[a-z_]+$/,
      /^(true|false)$/,
      /^$/,
      /^(mcp|http|automation)$/,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ];
    for (const l of literais) expect(permitidos.some((re) => re.test(l)), `literal inesperado: "${l}"`).toBe(true);
  });
});

describe('os outros literais — cada um só aceita o seu formato', () => {
  /** O que o helper devolve: texto direto (fragmento do driver) ou o próprio valor (parâmetro). */
  const literal = (v: unknown) => (typeof v === 'object' && v !== null && !(v instanceof Date) ? 'texto' : 'parametro');

  it('inlineSha256: só 64 hexadecimais minúsculos', async () => {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Tx;
      expect(literal(inlineSha256(t, 'a'.repeat(64)))).toBe('texto');
      expect(literal(inlineSha256(t, 'A'.repeat(64)))).toBe('parametro');
      expect(literal(inlineSha256(t, `${'a'.repeat(63)}'`))).toBe('parametro');
      expect(literal(inlineSha256(t, 'a'.repeat(65)))).toBe('parametro');
    });
  });

  it('inlineTimestamp: Date válida vira ISO no texto; inválida segue como está', async () => {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Tx;
      expect(literal(inlineTimestamp(t, new Date('2026-10-08T12:00:00.000Z')))).toBe('texto');
      expect(literal(inlineTimestamp(t, new Date('lixo')))).toBe('parametro');
    });
  });

  it('inlineWord: só palavra da lista fechada', async () => {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Tx;
      expect(literal(inlineWord(t, 'grant', ['grant', 'owner']))).toBe('texto');
      expect(literal(inlineWord(t, "grant' or 1=1", ['grant', 'owner']))).toBe('parametro');
      expect(literal(inlineWord(t, 'outra', ['grant', 'owner']))).toBe('parametro');
    });
  });

  it('inlineLetras: só letras latinas, com ou sem acento (as tabelas de `translate` do código)', async () => {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Tx;
      expect(literal(inlineLetras(t, 'áàâãäéèêëíìîïóòôõöúùûüçñ'))).toBe('texto');
      expect(literal(inlineLetras(t, 'aaaaaeeeeiiiiooooouuuucn'))).toBe('texto');
      for (const torto of ["a'b", 'a b', 'a\\b', 'a;b', '--', '', 'a'.repeat(65), 'a\nb', 'a\u0000b']) {
        expect(literal(inlineLetras(t, torto)), JSON.stringify(torto)).toBe('parametro');
      }
    });
  });

  it('com um dublê de teste (sem unsafe) nenhum vira texto', () => {
    const ficticio = (() => []) as unknown as Tx;
    expect(inlineUuid(ficticio, TAREFA)).toBe(TAREFA);
    expect(inlineSha256(ficticio, 'a'.repeat(64))).toBe('a'.repeat(64));
    expect(inlineWord(ficticio, 'grant', ['grant'])).toBe('grant');
    expect(inlineLetras(ficticio, 'áé')).toBe('áé');
    const quando = new Date('2026-10-08T12:00:00.000Z');
    expect(inlineTimestamp(ficticio, quando)).toBe(quando);
  });
});

describe('inlineUuid — o id no texto, e consultas sem parâmetro viajam juntas', () => {
  it('UUID vira texto (minúsculo); qualquer outra coisa continua parâmetro', async () => {
    await sql.begin(async (tx) => {
      await tx`select id from tarefas where id = ${inlineUuid(tx as unknown as Tx, TAREFA.toUpperCase())}`;
      await tx`select id from tarefas where id = ${inlineUuid(tx as unknown as Tx, "x' or '1'='1")}`;
    });
    const i1 = falso.consultas.findIndex((c) => c.includes(TAREFA));
    expect(i1).toBeGreaterThan(-1);
    expect(falso.parametros[i1]).toEqual([]);

    const torta = falso.consultas.findIndex((c) => /where id = \$1/.test(c));
    expect(torta).toBeGreaterThan(-1);
    expect(falso.parametros[torta]).toEqual(["x' or '1'='1"]);
    expect(falso.consultas.join('\n')).not.toContain("or '1'='1'");
  });

  it('oito consultas por id: 20 idas com parâmetro, 3 com o id no texto', async () => {
    const oito = (montar: (tx: Tx) => PromiseLike<unknown>) => async (tx: Tx) => {
      for (let i = 0; i < 8; i += 1) await montar(tx);
    };
    const comParam = await contar(() => withActorAntigo(sql, humano, oito((tx) => tx`select id from tarefas where id = ${TAREFA}`)));
    const noTexto = await contar(() =>
      withActor(sql, humano, async (tx) => {
        await Promise.all(
          Array.from({ length: 8 }, () => tx`select id from tarefas where id = ${inlineUuid(tx, TAREFA)}`),
        );
      }),
    );
    expect(comParam).toBe(1 + 2 + 8 * 2 + 1); // begin, set_config (2), 8 consultas × 2, commit
    expect(noTexto).toBe(3); // begin, a rajada inteira (declaração + 8 consultas), commit
  });
});

describe('rajada de consultas — quando uma falha', () => {
  it('sobe o erro de ORIGEM (e não o "transação abortada" das que vieram depois), com rollback', async () => {
    const quebrado = await criarPgFalso([{ quando: /da_terceira/, erro: 'violação de política na terceira' }]);
    const cliente = postgres(quebrado.opcoesDoCliente()) as unknown as Sql;
    try {
      await expect(
        withActor(cliente, humano, async (tx) => {
          const id = inlineUuid(tx, TAREFA);
          return Promise.all([
            tx`select 1 as a from t1 where id = ${id}`,
            tx`select 2 as b from t2 where id = ${id}`,
            tx`select 3 as da_terceira from t3 where id = ${id}`,
            tx`select 4 as d from t4 where id = ${id}`,
            tx`select 5 as e from t5 where id = ${id}`,
          ]);
        }),
      ).rejects.toThrow('violação de política na terceira');
      // A transação terminou em rollback e a conexão continua usável.
      expect(quebrado.consultas[quebrado.consultas.length - 1]).toBe('rollback');
      await expect(withActor(cliente, humano, (tx) => tx`select 6 as f from t6`)).resolves.toBeDefined();
    } finally {
      await cliente.end();
      await quebrado.fechar();
    }
  });
});

describe('resolveActor — a conferência de perfil que toda rota protegida paga', () => {
  const PERFIL = [EU, 'eu@ide.com', 'Eu Mesmo', 'admin', 'true', 'true', 'true', '{}'];

  afterEach(() => vi.unstubAllGlobals());

  async function conferir(id: string) {
    const bancoComPerfil = await criarPgFalso([
      {
        quando: /from ideworks\.profiles/i,
        colunas: ['id', 'email', 'full_name', 'role', 'is_superadmin', 'is_active', 'has_all_clients_access', 'areas'],
        linhas: () => [PERFIL],
      },
    ]);
    const cliente = postgres(bancoComPerfil.opcoesDoCliente()) as unknown as Sql;
    // O provedor de autenticação é o único `fetch` do caminho; a trava de rede da suíte o
    // bloquearia, e aqui ele responde de dentro.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id, email: 'eu@ide.com' }), { status: 200 })),
    );
    try {
      const pedido = new Request('https://x/api/clients', { headers: { Authorization: 'Bearer token' } });
      const sessao = await resolveActor(pedido, cliente, {
        url: 'https://projeto.supabase.co',
        anonKey: 'anon',
      } as never);
      return { sessao, idas: bancoComPerfil.idas.length, consultas: bancoComPerfil.consultas, parametros: bancoComPerfil.parametros };
    } finally {
      await cliente.end();
      await bancoComPerfil.fechar();
    }
  }

  it('o perfil sai em 3 idas (eram 5): begin, declaração + perfil, commit', async () => {
    const { sessao, idas, consultas, parametros } = await conferir(EU);
    expect(sessao.ok).toBe(true);
    expect(idas).toBe(3);
    const i = consultas.findIndex((c) => /from ideworks\.profiles/.test(c));
    expect(consultas[i]).toContain(`where id = '${EU}'`);
    expect(parametros[i]).toEqual([]);
    // A declaração de pré-autenticação vem antes da leitura do perfil.
    expect(consultas.findIndex((c) => /app\.preauth/.test(c))).toBeLessThan(i);
  });

  it('id que o provedor devolva fora do formato UUID segue por parâmetro (nunca no texto)', async () => {
    const { idas, consultas, parametros } = await conferir("x' or true --");
    const i = consultas.findIndex((c) => /from ideworks\.profiles/.test(c));
    expect(consultas[i]).toContain('where id = $1');
    expect(parametros[i]).toEqual(["x' or true --"]);
    expect(consultas.join('\n')).not.toContain('or true');
    expect(idas).toBe(4);
  });
});
