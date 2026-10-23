/**
 * Prova local da F44, Fase 7 — as limpezas dos limitadores, a coleta morta que
 * deixa de trancar a batida seguinte. (A F44_4, o índice da ordem de `Todas as tarefas`,
 * foi medida em 09/10/2026 e descartada: não acelerou nada.)
 *
 * Banco de verdade (PGlite) com as tabelas tiradas do TEXTO das migrations que
 * as criaram (`auth_attempts` da F1.1, `integration_rate_events` da F16.2b,
 * `meta_collection_runs` e `assert_collector` da F8), o estado de produção de
 * `start_collection_run` posto pelo próprio rollback (e conferido contra
 * `schema-esperado.json`), e a F44_5 por cima — chamada sob `ideworks_app`, o
 * papel do servidor, como o gatilho chama.
 *
 * O último caso desfaz pelo rollback, confere que o retrato de produção volta
 * letra por letra (ou, com o retrato já regravado depois da F44_5, que a
 * migration é que bate com ele), e reaplica.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Sql } from '@/server/db';
import {
  JANELA_DA_LIMPEZA_DE_INTEGRACAO_S,
  JANELA_DA_LIMPEZA_DE_TENTATIVAS_S,
  limparLimitadores,
} from '@/server/limpeza-dos-limitadores';

const PESSOA = '00000000-0000-0000-0000-000000000001';
const migration = (nome: string) => readFileSync(`supabase/migrations/${nome}`, 'utf8');
const rollback = (nome: string) => readFileSync(`supabase/rollback/${nome}`, 'utf8');
const F44_5 = '20261009130000_ideworks_f44_5_limpezas.sql';
const retrato = JSON.parse(readFileSync('supabase/schema-esperado.json', 'utf8')) as { funcoes: string[] };
const normalizar = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();

/** Um trecho de migration, achado pelo começo e terminado no primeiro `;` de fim de linha. */
const trecho = (nome: string, comeco: RegExp) => {
  const texto = migration(nome);
  const m = texto.match(new RegExp(`${comeco.source}[\\s\\S]*?;\\s*$`, 'm'));
  if (!m) throw new Error(`trecho não achado em ${nome}: ${comeco}`);
  return m[0];
};

const db = new PGlite();

/** Sem sessão de pessoa, no papel do servidor — o ator `collector` do gatilho. */
async function comoColetor() {
  await db.exec('reset role');
  await db.query(`select set_config('app.user_id', '', false)`);
  await db.exec('set role ideworks_app');
}
/** Uma pessoa declarada, no papel do servidor. */
async function comoPessoa() {
  await db.exec('reset role');
  await db.query(`select set_config('app.user_id', $1, false)`, [PESSOA]);
  await db.exec('set role ideworks_app');
}
const comoDono = () => db.exec('reset role');
const linhas = async <T = Record<string, unknown>>(q: string, v: unknown[] = []) =>
  (await db.query<T>(q, v)).rows;

/** O código da recusa — ou `null` se passou. */
async function recusa(q: string, v: unknown[] = []): Promise<string | null> {
  try {
    await db.query(q, v);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'sem-codigo';
  }
}

/** Adaptador só de transporte para o código da aplicação (mesmo de trancas-f44-banco). */
const sql = {
  begin: async (run: (tx: unknown) => Promise<unknown>) => {
    const tx = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, '');
      return (await db.query(q, values)).rows;
    };
    await db.exec('begin; set local role ideworks_app');
    try {
      const r = await run(tx);
      await db.exec('commit');
      return r;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  },
} as unknown as Sql;

/** O corpo de `start_collection_run` como `conferir-schema` o lê, e o do retrato de produção. */
async function corpoDaColeta() {
  await comoDono();
  const [f] = await linhas<{ corpo: string; definer: boolean; config: string }>(`
    select p.prosrc as corpo, p.prosecdef as definer, array_to_string(p.proconfig, ',') as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'ideworks' and p.proname = 'start_collection_run'`);
  return `${f.definer ? 'definer' : 'invoker'}|${f.config}|${normalizar(f.corpo)}`;
}
function corpoDaColetaNoRetrato() {
  const f = retrato.funcoes.find((x) => x.startsWith('start_collection_run('));
  if (!f) throw new Error('start_collection_run fora do retrato');
  const [, , definer, , , , config, ...corpo] = f.split('|');
  return `${definer}|${config}|${normalizar(corpo.join('|'))}`;
}
/**
 * O retrato de produção é ANTES ou DEPOIS da F44_5? Antes de aplicar, ele tem
 * os 15 minutos e o rollback tem de bater com ele; depois de aplicar e
 * regravar o retrato, ele tem os 12 e quem bate é a migration. Conferir só o
 * "antes" quebraria esta suíte no dia em que o retrato fosse regravado — foi o
 * que aconteceu com `trancas-f44-banco.test.ts`.
 */
async function conferirContraORetrato(corpoDoRollback: string, corpoDaMigration: string) {
  const noRetrato = corpoDaColetaNoRetrato();
  expect(corpoDoRollback).toContain("interval '15 minutes'");
  expect(corpoDaMigration).toContain("interval '12 minutes'");
  if (noRetrato.includes("interval '12 minutes'")) expect(corpoDaMigration).toEqual(noRetrato);
  else expect(corpoDoRollback).toEqual(noRetrato);
}

const funcoesDeLimpeza = async () => {
  await comoDono();
  return (
    await linhas<{ nome: string }>(`
      select p.proname as nome from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'ideworks' and p.proname like 'purge\\_%' order by 1`)
  ).map((l) => l.nome);
};

beforeAll(async () => {
  await db.exec(`
    create role ideworks_app; create role anon; create role authenticated;
    create schema ideworks;
    grant usage on schema ideworks to ideworks_app;
    create function ideworks.acting_user_id() returns uuid language sql stable as
      $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create type ideworks.attempt_scope as enum ('email', 'ip');
    create type ideworks.attempt_purpose as enum ('activation', 'login');
    create type ideworks.collection_outcome as enum ('running', 'ok', 'partial', 'failed');
  `);
  // As tabelas e a trava do motor, pelo texto das migrations que os criaram.
  await db.exec(
    migration('20260820150000_ideworks_f8_coleta.sql').match(
      /create or replace function ideworks\.assert_collector\(\)[\s\S]*?\$fn\$;/,
    )![0],
  );
  await db.exec(trecho('20260819120328_ideworks_f1_1_identity_schema.sql', /create table if not exists ideworks\.auth_attempts/));
  await db.exec(trecho('20260819120328_ideworks_f1_1_identity_schema.sql', /create index if not exists auth_attempts_window_idx/));
  await db.exec('alter table ideworks.auth_attempts enable row level security;');
  await db.exec(trecho('20260921034400_ideworks_f16b_limites.sql', /create table ideworks\.integration_rate_events/));
  await db.exec(trecho('20260921034400_ideworks_f16b_limites.sql', /create index integration_rate_events_window_idx/));
  await db.exec('alter table ideworks.integration_rate_events enable row level security;');
  await db.exec(trecho('20260820150000_ideworks_f8_coleta.sql', /create table if not exists ideworks\.meta_collection_runs/));

  // O estado de antes da F44_5 em produção: o rollback o reconstrói. Ele e a
  // migration se conferem contra o retrato antes de qualquer coisa.
  await db.exec(rollback(F44_5));
  const corpoDoRollback = await corpoDaColeta();
  expect(await funcoesDeLimpeza()).toEqual([]);

  await db.exec(migration(F44_5));
  await conferirContraORetrato(corpoDoRollback, await corpoDaColeta());
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await comoDono();
  await db.exec(`
    delete from ideworks.integration_rate_events;
    delete from ideworks.auth_attempts;
    delete from ideworks.meta_collection_runs;`);
});

/** Linhas de `integration_rate_events` com estas idades (intervalos do Postgres). */
async function chamadasComIdade(...idades: string[]) {
  await comoDono();
  for (const [i, idade] of idades.entries()) {
    await db.query(
      `insert into ideworks.integration_rate_events (scope, scope_key, occurred_at)
       values ($1, $2, now() - $3::interval)`,
      [i % 2 === 0 ? 'grant' : 'owner', `chave-${idade}`, idade],
    );
  }
}
async function tentativasComIdade(...idades: string[]) {
  await comoDono();
  for (const [i, idade] of idades.entries()) {
    await db.query(
      `insert into ideworks.auth_attempts (purpose, scope, scope_key, occurred_at)
       values ($1, $2, $3, now() - $4::interval)`,
      [i % 2 === 0 ? 'login' : 'activation', i % 2 === 0 ? 'email' : 'ip', `chave-${idade}`, idade],
    );
  }
}
const chavesQueFicaram = async (tabela: string) => {
  await comoDono();
  return (await linhas<{ k: string }>(`select scope_key as k from ideworks.${tabela} order by occurred_at desc`)).map(
    (l) => l.k,
  );
};

describe('purge_integration_rate_events', () => {
  it('apaga só o que passou da janela, e diz quantas saíram', async () => {
    await chamadasComIdade('10 seconds', '40 seconds', '2 minutes', '3 days');
    await comoColetor();
    const [r] = await linhas<{ n: number }>('select ideworks.purge_integration_rate_events(60) as n');
    expect(r.n).toBe(2);
    expect(await chavesQueFicaram('integration_rate_events')).toEqual(['chave-10 seconds', 'chave-40 seconds']);
  });

  it('com pessoa declarada, recusa com 42501 e não apaga nada', async () => {
    await chamadasComIdade('3 days');
    await comoPessoa();
    expect(await recusa('select ideworks.purge_integration_rate_events(60)')).toBe('42501');
    expect(await chavesQueFicaram('integration_rate_events')).toEqual(['chave-3 days']);
  });

  it('janela fora da faixa (nula, menos de 1 min, mais de 7 dias) recusa com 22023 e não apaga nada', async () => {
    await chamadasComIdade('3 days', '30 seconds');
    await comoColetor();
    for (const janela of [null, 0, 59, 604801]) {
      expect(await recusa('select ideworks.purge_integration_rate_events($1)', [janela])).toBe('22023');
    }
    expect(await chavesQueFicaram('integration_rate_events')).toEqual(['chave-30 seconds', 'chave-3 days']);
  });
});

describe('purge_auth_attempts', () => {
  it('apaga só o que passou da janela, e diz quantas saíram', async () => {
    await tentativasComIdade('5 minutes', '14 minutes', '20 minutes', '30 days');
    await comoColetor();
    const [r] = await linhas<{ n: number }>('select ideworks.purge_auth_attempts(900) as n');
    expect(r.n).toBe(2);
    expect(await chavesQueFicaram('auth_attempts')).toEqual(['chave-5 minutes', 'chave-14 minutes']);
  });

  it('com pessoa declarada, recusa com 42501; janela torta, com 22023', async () => {
    await tentativasComIdade('30 days');
    await comoPessoa();
    expect(await recusa('select ideworks.purge_auth_attempts(900)')).toBe('42501');
    await comoColetor();
    expect(await recusa('select ideworks.purge_auth_attempts(30)')).toBe('22023');
    expect(await chavesQueFicaram('auth_attempts')).toEqual(['chave-30 days']);
  });
});

describe('quem executa as limpezas', () => {
  it('só o papel do servidor — anon e authenticated não', async () => {
    await comoDono();
    for (const f of ['ideworks.purge_integration_rate_events(integer)', 'ideworks.purge_auth_attempts(integer)']) {
      const [p] = await linhas<{ app: boolean; anon: boolean; auth: boolean }>(
        `select has_function_privilege('ideworks_app', $1, 'execute') as app,
                has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth`,
        [f],
      );
      expect(p).toEqual({ app: true, anon: false, auth: false });
    }
  });
});

describe('limparLimitadores — o que o gatilho chama', () => {
  it('passa a maior janela do código, com folga: 2 min para os agentes, 16 min para o login', async () => {
    expect(JANELA_DA_LIMPEZA_DE_INTEGRACAO_S).toBe(120);
    expect(JANELA_DA_LIMPEZA_DE_TENTATIVAS_S).toBe(960);
    await chamadasComIdade('30 seconds', '90 seconds', '3 minutes', '20 days');
    await tentativasComIdade('10 minutes', '15 minutes 30 seconds', '17 minutes', '50 days');
    await comoColetor();

    expect(await limparLimitadores(sql)).toEqual({ integracao: 2, tentativas: 2 });

    // A linha de 90 s — fora da janela do freio (60 s), dentro da folga — fica;
    // a de 15 min 30 s também. Apagar um pouco depois não custa nada.
    expect(await chavesQueFicaram('integration_rate_events')).toEqual(['chave-30 seconds', 'chave-90 seconds']);
    expect(await chavesQueFicaram('auth_attempts')).toEqual(['chave-10 minutes', 'chave-15 minutes 30 seconds']);
  });

  it('rodar de novo não apaga mais nada', async () => {
    await chamadasComIdade('30 seconds', '3 minutes');
    await comoColetor();
    expect(await limparLimitadores(sql)).toEqual({ integracao: 1, tentativas: 0 });
    await comoColetor();
    expect(await limparLimitadores(sql)).toEqual({ integracao: 0, tentativas: 0 });
  });
});

describe('start_collection_run — a coleta morta tranca 12 minutos', () => {
  const execucaoParada = async (idade: string) => {
    await comoDono();
    await db.query(
      `insert into ideworks.meta_collection_runs (started_at, window_from, window_to)
       values (now() - $1::interval, current_date - 27, current_date)`,
      [idade],
    );
  };
  const abrir = () => recusa('select ideworks.start_collection_run(current_date - 27, current_date)');

  it('uma execução em andamento há 11 min ainda segura a vez (55006)', async () => {
    await execucaoParada('11 minutes');
    await comoColetor();
    expect(await abrir()).toBe('55006');
  });

  it('passados 12 min ela está morta: a batida seguinte abre a sua — e a nova passa a segurar a vez', async () => {
    await execucaoParada('13 minutes');
    await comoColetor();
    expect(await abrir()).toBeNull();
    // A que acabou de abrir está viva: uma terceira, agora, espera.
    expect(await abrir()).toBe('55006');
    await comoDono();
    const [n] = await linhas<{ n: number }>(
      `select count(*)::int as n from ideworks.meta_collection_runs where outcome = 'running'`,
    );
    expect(n.n).toBe(2);
  });

  it('com pessoa declarada, recusa como sempre (42501)', async () => {
    await comoPessoa();
    expect(await abrir()).toBe('42501');
  });
});

describe('rollback da F44_5', () => {
  it('o rollback volta ao corpo de produção, e com ele a execução morta há 14 min trancava a batida seguinte; a F44_5 reaplica', async () => {
    const corpoDaMigration = await corpoDaColeta();
    await db.exec(rollback(F44_5));
    await conferirContraORetrato(await corpoDaColeta(), corpoDaMigration);
    expect(await funcoesDeLimpeza()).toEqual([]);

    // O defeito que a F44_5 tira: a batida das 15 min encontra a execução que
    // morreu na batida anterior com 14 min e pouco — e para.
    await comoDono();
    await db.query(
      `insert into ideworks.meta_collection_runs (started_at, window_from, window_to)
       values (now() - interval '14 minutes 59 seconds', current_date - 27, current_date)`,
    );
    await comoColetor();
    expect(await recusa('select ideworks.start_collection_run(current_date - 27, current_date)')).toBe('55006');

    await comoDono();
    await db.exec(migration(F44_5));
    expect(await funcoesDeLimpeza()).toEqual(['purge_auth_attempts', 'purge_integration_rate_events']);
    await comoColetor();
    expect(await recusa('select ideworks.start_collection_run(current_date - 27, current_date)')).toBeNull();

    // Idempotente: aplicar de novo não muda nada.
    await comoDono();
    const depois = await corpoDaColeta();
    await db.exec(migration(F44_5));
    expect(await corpoDaColeta()).toEqual(depois);
  });
});
