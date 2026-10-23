/**
 * O ORGÂNICO QUE NÃO SE ANULA — a F44_1, provada contra a função do banco.
 *
 * O DEFEITO (do banco, corrigido na F44_1)
 *   A F10f regravava a linha do dia com `x = excluded.x` em quase toda coluna. O
 *   motor só busca as métricas de total (views, interações, curtidas…) nos
 *   últimos 7 dias, mas o `reach` vem dos 28: o dia que sai da janela de 7 dias
 *   chega com `{ reach }` só, e a função gravava NULL em tudo o mais. A cada
 *   batida, todo dia com mais de 7 dias perdia as métricas, que a Meta só guarda
 *   por 90 dias.
 *
 *   A F44_1 (`20261009090000_ideworks_f44_1_organico_nao_apaga.sql`) troca cada
 *   métrica por `coalesce(excluded.x, tabela.x)` e faz `extra` JUNTAR. Com ela o
 *   paliativo do PR #2 saiu de `gravarDiasOrganicos`: todo dia vai, inclusive o
 *   antigo só com alcance — e a conta nova volta a ganhar os 28 dias de alcance.
 *
 * O QUE ESTE ARQUIVO USA DE VERDADE
 *   A migration F44_1 aplicada INTEIRA, duas vezes (é idempotente), e o rollback
 *   dela — os arquivos, não uma cópia digitada. A tabela, a política de leitura
 *   (`can_see_asset`) e o papel `ideworks_app` (que NÃO é o dono, então a
 *   política vale) imitam a produção.
 *   NENHUMA REDE: o PGlite roda no próprio processo.
 *
 * POR QUE O PAPEL DO WORKER IMPORTA AQUI
 *   O coletor roda sem ator declarado, e a política de leitura de
 *   `meta_daily_organic` pergunta `can_see_asset`, que sem ator responde falso:
 *   um `select` do coletor devolve ZERO linhas, existam elas ou não. Foi o que
 *   tornou o paliativo cego. Agora a gravação não lê nada — a proteção está na
 *   função, que é `security definer` —, e é pelo papel do Worker que se prova.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';
import { type DiaOrganico, type FonteDaMeta, coletar, gravarDiasOrganicos } from '@/server/meta-coleta';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const F44_1 = '20261009090000_ideworks_f44_1_organico_nao_apaga.sql';
const MIGRATION = join(RAIZ, 'supabase', 'migrations', F44_1);
const ROLLBACK = join(RAIZ, 'supabase', 'rollback', F44_1);

const ATIVO = '00000000-0000-0000-0000-000000000001';
const EMPRESA = '00000000-0000-0000-0000-0000000000c1';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create role ideworks_app nologin;

    create function ideworks.acting_user_id() returns uuid language sql stable as
      $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create function ideworks.acting_is_superadmin() returns boolean language sql stable as
      $$ select coalesce(current_setting('app.is_superadmin', true), 'false') = 'true' $$;
    create function ideworks.assert_collector() returns void language plpgsql stable as $$
      begin
        if ideworks.acting_user_id() is not null then
          raise exception 'metrica entra pelo motor' using errcode = '42501';
        end if;
      end $$;

    create table ideworks.meta_assets (id uuid primary key, client_id uuid, category_id uuid);
    create table ideworks.user_categories (user_id uuid, category_id uuid);

    -- A regra da F13b: sem ator declarado, ninguém enxerga conta nenhuma.
    create function ideworks.can_see_asset(target uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as $$
      select exists (
        select 1 from ideworks.meta_assets a
         where a.id = target and (
           ideworks.acting_is_superadmin()
           or (a.category_id is not null and exists (
                 select 1 from ideworks.user_categories uc
                  where uc.category_id = a.category_id
                    and uc.user_id = ideworks.acting_user_id()))))
      $$;

    create table ideworks.meta_daily_organic (
      asset_id uuid not null, day date not null,
      reach int, views int, accounts_engaged int, total_interactions int,
      follows int, unfollows int, profile_links_taps int,
      likes int, comments int, shares int, saves int,
      followers_total int, media_count int,
      extra jsonb not null default '{}'::jsonb,
      collected_at timestamptz not null default now(),
      primary key (asset_id, day));
    alter table ideworks.meta_daily_organic enable row level security;
    create policy organic_select on ideworks.meta_daily_organic for select
      using (ideworks.can_see_asset(asset_id));
  `);
  // Duas vezes: a migration diz IDEMPOTENTE, e é assim que se prova.
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(`
    grant usage on schema ideworks to ideworks_app;
    grant all privileges on all tables in schema ideworks to ideworks_app;
    grant execute on all functions in schema ideworks to ideworks_app;
    insert into ideworks.meta_assets values ('${ATIVO}', null, '${EMPRESA}');
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec('delete from ideworks.meta_daily_organic');
});

/** Um dia com as métricas de total — o que a janela de 7 dias traz. */
const completo = (day: string, extra: Partial<DiaOrganico['metrics']> = {}): DiaOrganico => ({
  day,
  metrics: { reach: 100, views: 900, accounts_engaged: 40, total_interactions: 55, likes: 30, ...extra },
});

/** Um dia que só tem o alcance — o que sai da janela de 7 dias, mas segue nos 28. */
const soAlcance = (day: string, reach = 100): DiaOrganico => ({ day, metrics: { reach } });

type Linha = {
  day: string;
  reach: number | null; views: number | null; accounts_engaged: number | null;
  total_interactions: number | null; follows: number | null; unfollows: number | null;
  profile_links_taps: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; followers_total: number | null;
  media_count: number | null; extra: Record<string, unknown>; collected_at: Date;
};

async function linha(day: string) {
  const r = await db.query<Linha>(
    `select day::text as day, reach, views, accounts_engaged, total_interactions,
            follows, unfollows, profile_links_taps, likes, comments, shares, saves,
            followers_total, media_count, extra, collected_at
       from ideworks.meta_daily_organic where asset_id = $1 and day = $2::date`,
    [ATIVO, day],
  );
  return r.rows[0] ?? null;
}

/** Chama a função direto, como o motor chama: sem ator, um dia por chamada. */
const gravarDia = (day: string, metrics: Record<string, unknown>) =>
  db.query(`select ideworks.upsert_organic_day($1, $2::date, $3::jsonb)`, [
    ATIVO,
    day,
    JSON.stringify(metrics),
  ]);

/** Roda a gravação como o coletor: sem ator, no papel do Worker, e confirma. */
async function gravarComoWorker(dias: DiaOrganico[]) {
  const a = criarAdaptadorPglite(db, { papel: 'ideworks_app', confirmar: true });
  // `comoJson` pede o `tx.json` do driver real. O PGlite serializa o OBJETO para
  // `jsonb`; devolver texto aqui o gravaria como string JSON (a armadilha que
  // `comoJson` existe para evitar), e a função leria todas as métricas como nulas.
  (a.tx as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
  const n = await a.sql.begin((tx) => gravarDiasOrganicos(tx as Tx, ATIVO, dias));
  return { n: n as number, consultas: a.consultas };
}

/** Tudo o que a janela de 7 dias traz num dia — as 13 métricas e o bruto dos seguidores. */
const DIA_INTEIRO = {
  reach: 100, views: 900, accounts_engaged: 40, total_interactions: 55,
  follows: 5, unfollows: 1, profile_links_taps: 2,
  likes: 30, comments: 4, shares: 3, saves: 6,
  followers_total: 1200, media_count: 80,
  extra: { follows_and_unfollows: { FOLLOWER: 5, NON_FOLLOWER: 1 } },
};

describe('a função do banco com a F44_1 — regravar não anula', () => {
  it('regravar o dia só com o alcance mantém o resto: views 900 e curtidas 30 seguem, o alcance novo entra', async () => {
    await gravarDia('2026-10-01', DIA_INTEIRO);
    expect(await linha('2026-10-01')).toMatchObject({ views: 900, likes: 30 });

    // Oito dias depois: o dia 01 saiu da janela de 7 e chega só com o alcance.
    await gravarDia('2026-10-01', { reach: 137 });

    // Coluna a coluna: só o alcance mudou.
    expect(await linha('2026-10-01')).toMatchObject({
      reach: 137, views: 900, accounts_engaged: 40, total_interactions: 55,
      follows: 5, unfollows: 1, profile_links_taps: 2,
      likes: 30, comments: 4, shares: 3, saves: 6,
      followers_total: 1200, media_count: 80,
      extra: { follows_and_unfollows: { FOLLOWER: 5, NON_FOLLOWER: 1 } },
    });
  });

  it('o número que veio vence, mesmo menor ou negativo — `coalesce`, não `greatest`', async () => {
    await gravarDia('2026-10-05', DIA_INTEIRO);

    // A Meta revisa nas primeiras ~48 h, e interação é SALDO (F7f): pode cair.
    await gravarDia('2026-10-05', { reach: 90, views: 850, total_interactions: -2 });

    expect(await linha('2026-10-05')).toMatchObject({
      reach: 90, views: 850, total_interactions: -2, likes: 30,
    });
  });

  it('`extra` junta: chave nova entra, a repetida fica com o valor novo, a que não veio fica', async () => {
    await gravarDia('2026-10-01', {
      reach: 100,
      extra: { follows_and_unfollows: { FOLLOWER: 5 }, versao: 1 },
    });

    // A chave solta (fora das conhecidas) vai para `extra` pela função.
    await gravarDia('2026-10-01', { reach: 100, extra: { versao: 2 }, metrica_nova: 7 });

    expect((await linha('2026-10-01'))?.extra).toEqual({
      follows_and_unfollows: { FOLLOWER: 5 },
      versao: 2,
      metrica_nova: 7,
    });
  });

  it('dia novo só com o alcance é inserido — o resto nasce nulo ("não sei"), não zero', async () => {
    await gravarDia('2026-09-20', { reach: 77 });

    const nova = await linha('2026-09-20');
    expect(nova).toMatchObject({ reach: 77, views: null, likes: null, followers_total: null });
    expect(nova?.extra).toEqual({});
  });

  it('`collected_at` continua andando: diz quando o dia foi visto por último', async () => {
    await gravarDia('2026-10-01', DIA_INTEIRO);
    await db.exec(`update ideworks.meta_daily_organic set collected_at = '2026-01-01T00:00:00Z'`);

    await gravarDia('2026-10-01', { reach: 100 });

    expect((await linha('2026-10-01'))?.collected_at.getTime()).toBeGreaterThan(
      new Date('2026-01-01T00:00:00Z').getTime(),
    );
  });

});

describe('gravarDiasOrganicos — sem o paliativo, todo dia vai', () => {
  it('pelo papel do Worker (leitura cega): o dia antigo só com alcance é mandado e não anula', async () => {
    await gravarComoWorker([completo('2026-10-01')]);
    expect((await linha('2026-10-01'))?.views).toBe(900);

    const r = await gravarComoWorker([completo('2026-10-08'), soAlcance('2026-10-01', 120)]);

    expect(await linha('2026-10-01')).toMatchObject({ reach: 120, views: 900, likes: 30 });
    expect((await linha('2026-10-08'))?.views).toBe(900);
    expect(r.n).toBe(2);
  });

  it('a conta nova ganha os 28 dias de alcance: dia sem linha entra só com o alcance', async () => {
    // Era o LIMITE do paliativo: sem enxergar as linhas, ele não mandava nenhum.
    const r = await gravarComoWorker([completo('2026-10-08'), soAlcance('2026-09-20', 77)]);

    expect(await linha('2026-09-20')).toMatchObject({ reach: 77, views: null });
    expect(r.n).toBe(2);
  });

  it('mesmo sem nenhum dia completo, os dias só de alcance entram', async () => {
    await gravarComoWorker([completo('2026-10-01')]);

    const r = await gravarComoWorker([soAlcance('2026-10-01', 130), soAlcance('2026-09-20', 12)]);

    expect(await linha('2026-10-01')).toMatchObject({ reach: 130, views: 900 });
    expect(await linha('2026-09-20')).toMatchObject({ reach: 12, views: null });
    expect(r.n).toBe(2);
  });

  it('os dias completos seguem regravados (a janela de 7 dias atualiza o número)', async () => {
    await gravarComoWorker([completo('2026-10-08')]);
    await gravarComoWorker([completo('2026-10-08', { views: 1234 })]);

    expect((await linha('2026-10-08'))?.views).toBe(1234);
  });

  it('não lê a tabela: uma chamada da função por dia, e só', async () => {
    const r = await gravarComoWorker([
      completo('2026-10-09'),
      soAlcance('2026-10-01'),
      soAlcance('2026-09-30', 12),
    ]);

    expect(r.consultas.some((c) => /from ideworks\.meta_daily_organic/.test(c))).toBe(false);
    expect(r.consultas.filter((c) => /ideworks\.upsert_organic_day\(/.test(c))).toHaveLength(3);
    expect(r.consultas).toHaveLength(3);
  });
});

describe('o motor (coletar) grava o orgânico por esse caminho', () => {
  it('pelo papel do Worker, a coleta seguinte não anula o dia que saiu da janela de 7 dias', async () => {
    await gravarComoWorker([completo('2026-10-01')]);

    // Um `Sql` que responde ao motor com a fila e o livro (funções de dono que
    // não são o assunto aqui) e deixa o resto — `upsert_organic_day`, a REAL —
    // com o PGlite, sob o papel do Worker.
    const real = criarAdaptadorPglite(db, { papel: 'ideworks_app', confirmar: true });
    const sql = {
      begin: (trabalho: (t: Tx) => Promise<unknown>) =>
        real.sql.begin((tx) => {
          const t = ((strings: TemplateStringsArray, ...valores: unknown[]) => {
            const texto = strings.join('?');
            if (texto.includes('meta_assets_para_coleta')) {
              return Promise.resolve([
                { id: ATIVO, kind: 'instagram_account', external_id: 'ig_1', secret_name: null },
              ]);
            }
            if (texto.includes('start_collection_run')) return Promise.resolve([{ id: 'execucao-1' }]);
            if (/mark_asset_attempt|touch_asset|finish_collection_run/.test(texto)) {
              return Promise.resolve([]);
            }
            return (tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
              strings,
              ...valores,
            );
          }) as unknown as Tx;
          // `comoJson` pede o `tx.json` do driver real; o adaptador não o tem
          // (o PGlite serializa o objeto, então devolver o próprio valor serve).
          (t as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
          return trabalho(t);
        }),
    } as unknown as Sql;

    const fonte: FonteDaMeta = {
      async organico() {
        return {
          dias: [completo('2026-10-08'), soAlcance('2026-10-01', 120), soAlcance('2026-09-20', 77)],
          usoBruto: null,
        };
      },
      async campanhas() {
        return { dias: [], usoBruto: null };
      },
      async demografia() {
        return [];
      },
      async quebrasDiarias() {
        return [];
      },
      async publicacoes() {
        return [];
      },
      async campanhasDetalhe() {
        return [];
      },
      async anuncios() {
        return [];
      },
      async diarioPorAnuncio() {
        return [];
      },
    };

    const r = await coletar(sql, () => fonte);

    expect(r.ativosOk).toBe(1);
    expect(r.ativosComFalha).toBe(0);
    expect(await linha('2026-10-01')).toMatchObject({ reach: 120, views: 900, likes: 30 });
    expect(await linha('2026-09-20')).toMatchObject({ reach: 77, views: null });
    expect((await linha('2026-10-08'))?.views).toBe(900);
  });
});

// Por último: mexe na função do banco compartilhado e a devolve à F44_1 no fim.
describe('o rollback', () => {
  it('volta o defeito (por isso o Worker é revertido antes) e a F44_1 volta a aplicar depois', async () => {
    try {
      await db.exec(readFileSync(ROLLBACK, 'utf8'));
      await db.exec(readFileSync(ROLLBACK, 'utf8'));

      await gravarDia('2026-10-01', DIA_INTEIRO);
      await gravarDia('2026-10-01', { reach: 137 });

      // A F10f de volta: views 900 vira NULL; só os dois `coalesce` dela seguram.
      const depois = await linha('2026-10-01');
      expect(depois).toMatchObject({
        reach: 137, views: null, likes: null, followers_total: 1200, media_count: 80,
      });
      expect(depois?.extra).toEqual({});
    } finally {
      await db.exec(readFileSync(MIGRATION, 'utf8'));
    }

    await gravarDia('2026-10-02', DIA_INTEIRO);
    await gravarDia('2026-10-02', { reach: 1 });
    expect((await linha('2026-10-02'))?.views).toBe(900);
  });
});
