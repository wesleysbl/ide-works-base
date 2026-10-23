/**
 * O FREIO DE CHAMADAS EM UMA TRANSAÇÃO SÓ, CONTRA UM POSTGRES DE VERDADE — perf do servidor, 08/10/2026.
 *
 * O QUE MUDOU
 *   O freio de toda chamada de agente contava numa transação e, se coubesse,
 *   registrava em outra. Agora há `countThenRecord`: as MESMAS duas consultas,
 *   pelas MESMAS funções do banco, num bloco só — e os argumentos (escopo,
 *   chave, instante) vão no texto da consulta em vez de parâmetro.
 *
 * O QUE ESTE ARQUIVO PROVA, SOBRE O PGLITE
 *   As funções e a tabela são a cópia da migration `f16b_limites`. O freio novo
 *   e o antigo (o mesmo store sem `countThenRecord`) recebem a mesma sequência
 *   de chamadas, em chaves diferentes, e têm de concordar em TUDO: veredicto de
 *   cada chamada, contagem final e linhas gravadas. Inclui o caso que mais
 *   importa — a chamada RECUSADA não entra na janela.
 *
 * O QUE ELE NÃO PROVA
 *   O número de idas na rede: isso é `mcp-idas.test.ts`, com o driver real.
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { admitIntegrationRateLimit, type IntegrationRateLimitStore, type IntegrationRateRule } from '@/integrations/limits';
import { criarAdaptadorPglite, type AdaptadorPglite } from '@/server/pglite-adaptador';

let db: PGlite;
let adaptador: AdaptadorPglite;
const holder: { sql: unknown } = { sql: null };

vi.mock('@/server/db-request', () => ({
  borrowSql: async (_env: unknown, _rotulo: string, work: (s: unknown) => Promise<unknown>) => work(holder.sql),
}));

const { createSqlRateLimitStore } = await import('@/integrations/handler');

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REGRAS: Record<'grant' | 'owner', IntegrationRateRule> = {
  grant: { max: 3, windowMs: 60_000 },
  owner: { max: 5, windowMs: 60_000 },
};

beforeAll(async () => {
  db = new PGlite();
  // A tabela e as funções são a cópia de supabase/migrations/…f16b_limites.sql.
  await db.exec(`
    create schema ideworks;
    create table ideworks.integration_rate_events (
      id bigint generated always as identity primary key,
      scope text not null,
      scope_key text not null,
      occurred_at timestamptz not null default now(),
      constraint integration_rate_events_scope_sane check (scope in ('grant', 'owner')),
      constraint integration_rate_events_key_sane check (char_length(scope_key) between 1 and 80)
    );
    create function ideworks.integration_rate_count(p_scope text, p_key text, p_since timestamptz)
      returns integer language sql stable as $fn$
        select count(*)::int from ideworks.integration_rate_events
         where scope = p_scope and scope_key = p_key and occurred_at >= p_since
           and p_scope in ('grant', 'owner')
      $fn$;
    create function ideworks.integration_rate_record(p_scope text, p_key text)
      returns void language plpgsql as $fn$
      begin
        if p_scope not in ('grant', 'owner') then
          raise exception 'escopo de limite de integração inválido';
        end if;
        insert into ideworks.integration_rate_events (scope, scope_key) values (p_scope, p_key);
      end;
      $fn$;
    create function ideworks.integration_rate_oldest(p_scope text, p_key text, p_since timestamptz)
      returns timestamptz language sql stable as $fn$
        select min(occurred_at) from ideworks.integration_rate_events
         where scope = p_scope and scope_key = p_key and occurred_at >= p_since
           and p_scope in ('grant', 'owner')
      $fn$;
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('delete from ideworks.integration_rate_events');
  adaptador = criarAdaptadorPglite(db, { textoDireto: true, confirmar: true });
  holder.sql = adaptador.sql;
});

/** O store SQL como ele era antes: sem o par de uma transação só. */
function semUmaTransacao(store: IntegrationRateLimitStore): IntegrationRateLimitStore {
  const { countThenRecord: _ignorado, ...resto } = store;
  void _ignorado;
  return resto as IntegrationRateLimitStore;
}

async function eventos(grantId: string, ownerId: string) {
  const r = await db.query<{ scope: string; scope_key: string }>(
    'select scope, scope_key from ideworks.integration_rate_events where scope_key = any($1) order by id',
    [[grantId, ownerId]],
  );
  return r.rows;
}

describe('freio — uma transação só decide e registra como as três de antes', () => {
  it('o store SQL tem o par de uma transação só', () => {
    expect(createSqlRateLimitStore({} as never).countThenRecord).toBeTypeOf('function');
  });

  it('mesma sequência de chamadas: mesmos veredictos, mesmas contagens, mesmas linhas', async () => {
    const novo = createSqlRateLimitStore({} as never);
    const antigo = semUmaTransacao(novo);
    const a = { grantId: id(1), ownerId: id(2) };
    const b = { grantId: id(3), ownerId: id(4) };
    const agora = new Date();

    const veredictosNovo: unknown[] = [];
    const veredictosAntigo: unknown[] = [];
    for (let i = 0; i < 7; i += 1) {
      veredictosNovo.push(await admitIntegrationRateLimit(a, novo, agora, REGRAS));
      veredictosAntigo.push(await admitIntegrationRateLimit(b, antigo, agora, REGRAS));
    }

    // Três passam (teto da concessão = 3), as quatro seguintes são recusadas pela concessão.
    expect(veredictosNovo.filter((v) => (v as { allowed: boolean }).allowed)).toHaveLength(3);
    expect(veredictosNovo.map((v) => (v as { allowed: boolean }).allowed)).toEqual(
      veredictosAntigo.map((v) => (v as { allowed: boolean }).allowed),
    );
    for (const v of veredictosNovo.slice(3) as Array<{ allowed: boolean; blockedBy: string }>) {
      expect(v.allowed).toBe(false);
      expect(v.blockedBy).toBe('grant');
    }

    const linhasA = await eventos(a.grantId, a.ownerId);
    const linhasB = await eventos(b.grantId, b.ownerId);
    // 3 chamadas registradas × (concessão + dono). As recusadas não entram.
    expect(linhasA.map((l) => l.scope)).toEqual(['grant', 'owner', 'grant', 'owner', 'grant', 'owner']);
    expect(linhasA.map((l) => l.scope)).toEqual(linhasB.map((l) => l.scope));
    expect(linhasA.map((l) => l.scope_key)).toEqual([a.grantId, a.ownerId, a.grantId, a.ownerId, a.grantId, a.ownerId]);
  });

  it('o teto do DONO recusa mesmo com a concessão sobrando, e nada é registrado', async () => {
    const novo = createSqlRateLimitStore({} as never);
    const dono = id(10);
    // O dono já gastou os 5 da janela em outras concessões.
    for (let i = 0; i < 5; i += 1) await novo.record('owner', dono);
    const antes = (await eventos(id(11), dono)).length;

    const veredito = await admitIntegrationRateLimit({ grantId: id(11), ownerId: dono }, novo, new Date(), REGRAS);
    expect(veredito).toMatchObject({ allowed: false, blockedBy: 'owner' });
    expect((veredito as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    expect((await eventos(id(11), dono)).length).toBe(antes);
  });

  it('countThenRecord devolve as contagens na ordem das sondas e diz se registrou', async () => {
    const store = createSqlRateLimitStore({} as never);
    const since = new Date(Date.now() - 60_000);
    const sondas = [
      { scope: 'grant' as const, key: id(20), since },
      { scope: 'owner' as const, key: id(21), since },
    ];
    const entradas = sondas.map(({ scope, key }) => ({ scope, key }));

    const primeira = await store.countThenRecord!(sondas, entradas, [3, 5]);
    expect(primeira).toEqual({ counts: [0, 0], recorded: true });
    const segunda = await store.countThenRecord!(sondas, entradas, [3, 5]);
    expect(segunda).toEqual({ counts: [1, 1], recorded: true });
    // Teto da posição 0 = 2: a concessão já tem 2 → recusa, e o dono (1 de 5) NÃO é registrado.
    const recusada = await store.countThenRecord!(sondas, entradas, [2, 5]);
    expect(recusada).toEqual({ counts: [2, 2], recorded: false });
    expect((await eventos(id(20), id(21))).length).toBe(4);
  });

  it('o argumento vai no texto da consulta: sem parâmetro, e com a declaração do freio antes', async () => {
    const store = createSqlRateLimitStore({} as never);
    adaptador.zerar();
    await admitIntegrationRateLimit({ grantId: id(30), ownerId: id(31) }, store, new Date(), REGRAS);
    const doFreio = adaptador.consultas.filter((c) => c.includes('integration_rate_'));
    expect(doFreio).toHaveLength(2); // contar, registrar
    for (const consulta of doFreio) expect(consulta).not.toMatch(/\$\d/);
    expect(doFreio[0]).toContain(`'${id(30)}'`);
    expect(adaptador.transacoes()).toBe(1);
  });

  it('chave que não é UUID (não vem do portão, mas o store aceita texto) segue por parâmetro', async () => {
    const store = createSqlRateLimitStore({} as never);
    adaptador.zerar();
    await store.record('grant', "chave'; drop table ideworks.integration_rate_events; --");
    const consulta = adaptador.consultas.find((c) => c.includes('integration_rate_record')) ?? '';
    expect(consulta).toMatch(/\$\d/);
    expect(consulta).not.toContain('drop table');
    // A tabela continua lá e a chave foi gravada literal.
    const r = await db.query<{ n: number }>('select count(*)::int as n from ideworks.integration_rate_events');
    expect(r.rows[0].n).toBe(1);
  });

  it('count() e oldest() leem o mesmo que antes, com o instante no texto', async () => {
    const store = createSqlRateLimitStore({} as never);
    await store.record('grant', id(40));
    await store.record('grant', id(40));
    const since = new Date(Date.now() - 60_000);
    expect(await store.count('grant', id(40), since)).toBe(2);
    expect(await store.count('owner', id(40), since)).toBe(0);
    const maisAntigo = await store.oldest('grant', id(40), since);
    expect(maisAntigo).toBeInstanceOf(Date);
    expect(await store.oldest('grant', id(41), since)).toBeNull();
    const [um, dois] = await store.countMany!([
      { scope: 'grant', key: id(40), since },
      { scope: 'owner', key: id(40), since },
    ]);
    expect([um, dois]).toEqual([2, 0]);
  });
});
