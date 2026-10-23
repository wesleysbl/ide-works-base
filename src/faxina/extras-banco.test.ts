/**
 * A RECLASSIFICAÇÃO DE EXTRAS CONTRA UM POSTGRES DE VERDADE — F44, Fase 4.
 *
 * As tabelas são as das migrations reais (`content_items` da F3.2; contrato,
 * cota e `open_month` da F3.1), carregadas no PGlite sobre um mínimo de
 * `clients`/`auth.users`. As funções rodam como o script as roda: sob o papel
 * `ideworks_app`, com a política de linha ligada e o ator declarado como
 * administrador.
 *
 * O QUE PROVA
 *   · aplicar grava `is_extra = false` só nos extras de antes da abertura, do
 *     mais antigo para o mais novo, até a cota; cliente inativo, mês passado,
 *     base cheia e extra de depois da abertura ficam como estão;
 *   · aplicar de novo não muda nada (e não devolve registro);
 *   · desfazer volta ao estado anterior — `is_extra` e `updated_at`, no
 *     microssegundo, com a sessão fora de UTC —, e desfazer de novo não muda nada;
 *   · peça mexida depois da aplicação volta a extra sem perder o carimbo novo;
 *     peça apagada é contada à parte;
 *   · o plano que não bate com o banco lança, e a transação de quem chama
 *     desfaz tudo.
 *
 * NÃO PROVA: as políticas REAIS de `can_see_client` — aqui é "administrador
 * vê tudo". Isso só o `--relatorio` contra produção, com o papel do `.env`.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Tx } from '@/server/db';
import { criarAdaptadorPglite } from '@/server/pglite-adaptador';

import {
  type RegistroDeDesfazer,
  aplicarReclassificacao,
  desfazerReclassificacao,
  lerOsExtras,
  reclassificarExtras,
  validarRegistro,
} from './extras-banco';
import { planejarReclassificacao } from './extras';

const CONTRATOS = 'supabase/migrations/20260819191742_ideworks_f3_1_month_contracts.sql';
const PECAS = 'supabase/migrations/20260819192545_ideworks_f3_2_content_items.sql';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ATIVO = id(1);
const INATIVO = id(2);
const OUT = '2026-10-01';
const NOV = '2026-11-01';
const SET = '2026-09-01';

// Novembro, arte — cadastro 3, aberto DEPOIS das peças de antes: base 1, extras E1 < E2 < E3, e E4 já com o mês aberto.
const BASE_ARTE = id(10);
const E1 = id(11);
const E2 = id(12);
const E3 = id(13);
const E4_DEPOIS = id(14);
// Novembro, vídeo — cadastro 2, base 2: base cheia.
const V_BASE1 = id(20);
const V_BASE2 = id(21);
const V_EXTRA = id(22);
// Setembro (passado), arte, não aberto: há vaga, mas o mês fica de fora.
const SET_EXTRA = id(30);
// Outubro (corrente), foto — sem cota nenhuma.
const FOTO_EXTRA = id(40);
// Cliente inativo, novembro, arte — cadastro 3: cancelado fica fora.
const INATIVO_EXTRA = id(50);

let db: PGlite;

const comoAdmin = (tx: Tx) =>
  tx`select set_config('app.is_superadmin', 'true', true), set_config('app.user_id', ${id(90)}, true)`;

/** Uma transação como a do script: papel restrito, ator declarado. `confirmar` = commit. */
async function emTransacao<T>(trabalho: (tx: Tx) => Promise<T>, confirmar = true): Promise<T> {
  const { sql } = criarAdaptadorPglite(db, { papel: 'ideworks_app', confirmar });
  return (await sql.begin(async (tx) => {
    await comoAdmin(tx);
    return trabalho(tx);
  })) as T;
}

type Retrato = Record<string, { is_extra: boolean; updated_at: string }>;
async function retrato(): Promise<Retrato> {
  const linhas = (
    await db.query<{ id: string; is_extra: boolean; updated_at: string }>(
      `select id::text as id, is_extra,
              to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
         from ideworks.content_items order by id`,
    )
  ).rows;
  return Object.fromEntries(linhas.map((l) => [l.id, { is_extra: l.is_extra, updated_at: l.updated_at }]));
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    -- A sessão NÃO está em UTC: sem o \`relogioEmUtc\` das funções, o instante
    -- sairia na hora de Brasília com um "Z" mentiroso, e o retrato não bateria.
    set time zone 'America/Sao_Paulo';
    create role ideworks_app;
    create schema auth;
    create table auth.users(id uuid primary key);
    create schema ideworks;
    grant usage on schema ideworks to ideworks_app;
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.clients(id uuid primary key, name text not null, category_id uuid, is_active boolean not null);
    create function ideworks.acting_is_superadmin() returns boolean language sql stable
      as $$ select coalesce(current_setting('app.is_superadmin', true), '') = 'true' $$;
    create function ideworks.can_see_client(uuid) returns boolean language sql stable
      as $$ select ideworks.acting_is_superadmin() $$;
    grant execute on all functions in schema ideworks to ideworks_app;
  `);
  await db.exec(readFileSync(CONTRATOS, 'utf8'));
  await db.exec(readFileSync(PECAS, 'utf8'));
  await db.exec(`
    alter table ideworks.clients enable row level security;
    create policy clients_select on ideworks.clients for select using (ideworks.can_see_client(id));
    create policy categories_select on ideworks.client_categories for select using (true);
    alter table ideworks.client_categories enable row level security;
  `);
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec(`
    delete from ideworks.content_items;
    delete from ideworks.month_contracts;
    delete from ideworks.client_quotas;
    delete from ideworks.clients;
    delete from ideworks.client_categories;

    insert into ideworks.client_categories values ('${id(5)}', 'Ide');
    insert into ideworks.clients values
      ('${ATIVO}', 'Ativo', '${id(5)}', true),
      ('${INATIVO}', 'Cancelado', '${id(5)}', false);
    insert into ideworks.client_quotas (client_id, content_type, quantity) values
      ('${ATIVO}', 'arte', 3), ('${ATIVO}', 'video', 2),
      ('${INATIVO}', 'arte', 3);

    -- O planejamento ANTES da abertura, com a regra antiga: nasceu extra.
    insert into ideworks.content_items (id, client_id, reference_month, content_type, is_extra, created_at, updated_at) values
      ('${BASE_ARTE}', '${ATIVO}', '${NOV}', 'arte', false, now() - interval '9 days', now() - interval '9 days'),
      ('${E2}',        '${ATIVO}', '${NOV}', 'arte', true,  now() - interval '5 days', now() - interval '5 days'),
      ('${E1}',        '${ATIVO}', '${NOV}', 'arte', true,  now() - interval '8 days', now() - interval '2 days'),
      ('${E3}',        '${ATIVO}', '${NOV}', 'arte', true,  now() - interval '3 days', now() - interval '3 days'),
      ('${V_BASE1}',   '${ATIVO}', '${NOV}', 'video', false, now() - interval '9 days', now() - interval '9 days'),
      ('${V_BASE2}',   '${ATIVO}', '${NOV}', 'video', false, now() - interval '9 days', now() - interval '9 days'),
      ('${V_EXTRA}',   '${ATIVO}', '${NOV}', 'video', true,  now() - interval '7 days', now() - interval '7 days'),
      ('${SET_EXTRA}', '${ATIVO}', '${SET}', 'arte', true,  now() - interval '40 days', now() - interval '40 days'),
      ('${FOTO_EXTRA}','${ATIVO}', '${OUT}', 'foto', true,  now() - interval '6 days', now() - interval '6 days'),
      ('${INATIVO_EXTRA}', '${INATIVO}', '${NOV}', 'arte', true, now() - interval '6 days', now() - interval '6 days');
  `);
  // A abertura congela o cadastro (arte 3, vídeo 2) — o \`open_month\` real.
  await db.exec(`
    begin;
    select set_config('app.is_superadmin', 'true', true);
    select ideworks.open_month('${ATIVO}', '${NOV}', null);
    commit;
  `);
  // Extra criado com o mês JÁ aberto (o "Acrescentar extra" da ficha): fica.
  await db.exec(`
    insert into ideworks.content_items (id, client_id, reference_month, content_type, is_extra, created_at)
    values ('${E4_DEPOIS}', '${ATIVO}', '${NOV}', 'arte', true, now() + interval '1 hour');
  `);
});

describe('reclassificarExtras — aplicar', () => {
  it('leva para a base só os extras de antes da abertura, do mais antigo, até a cota', async () => {
    const antes = await retrato();
    const { grupos, registro } = await emTransacao((tx) => reclassificarExtras(tx, OUT));

    expect(registro?.pecas.map((p) => p.id)).toEqual([E1, E2]);
    expect(registro?.aPartirDe).toBe(OUT);
    for (const p of registro?.pecas ?? []) {
      expect(p.antes).toEqual({ isExtra: true, updatedAt: antes[p.id]?.updated_at });
      expect(p.depois.isExtra).toBe(false);
    }

    const arte = grupos.find((g) => g.contentType === 'arte' && g.referenceMonth === NOV);
    expect(arte).toMatchObject({ fonte: 'contrato', cota: 3, base: 1, motivo: 'vaga' });
    expect(arte?.extraDepoisDaAbertura.map((p) => p.id)).toEqual([E4_DEPOIS]);

    const depois = await retrato();
    expect(depois[E1]?.is_extra).toBe(false);
    expect(depois[E2]?.is_extra).toBe(false);
    expect(depois[E1]?.updated_at).not.toBe(antes[E1]?.updated_at);
    // O resto, intacto: o terceiro extra (passou da cota), o de depois da
    // abertura, a base cheia de vídeo, o mês passado, o sem cota e o cancelado.
    for (const fica of [E3, E4_DEPOIS, V_EXTRA, SET_EXTRA, FOTO_EXTRA, INATIVO_EXTRA, BASE_ARTE, V_BASE1, V_BASE2]) {
      expect(depois[fica]).toEqual(antes[fica]);
    }
  });

  it('a leitura só traz cliente ativo', async () => {
    const dados = await emTransacao((tx) => lerOsExtras(tx, null), false);
    expect(dados.clientes.map((c) => c.id)).toEqual([ATIVO]);
    expect(dados.pecas.some((p) => p.clientId === INATIVO)).toBe(false);
    expect(dados.cadastro.every((q) => q.clientId === ATIVO)).toBe(true);
  });

  it('com os passados, o setembro com vaga também entra', async () => {
    const { registro } = await emTransacao((tx) => reclassificarExtras(tx, null));
    expect(registro?.pecas.map((p) => p.id).sort()).toEqual([E1, E2, SET_EXTRA].sort());
    expect(registro?.aPartirDe).toBeNull();
  });

  it('é idempotente: a segunda aplicação não muda nada e não devolve registro', async () => {
    await emTransacao((tx) => reclassificarExtras(tx, OUT));
    const depoisDaPrimeira = await retrato();
    const segunda = await emTransacao((tx) => reclassificarExtras(tx, OUT));
    expect(segunda.registro).toBeNull();
    expect(segunda.grupos.flatMap((g) => g.viramBase)).toEqual([]);
    expect(await retrato()).toEqual(depoisDaPrimeira);
  });

  it('plano que não bate com o banco lança, e a transação desfaz o que já tinha mudado', async () => {
    const antes = await retrato();
    await expect(
      emTransacao(async (tx) => {
        const dados = await lerOsExtras(tx, OUT);
        const grupos = planejarReclassificacao({ ...dados, aPartirDe: OUT });
        // Alguém tira E2 de extra entre a leitura e a gravação.
        await tx`update ideworks.content_items set is_extra = false where id = ${E2}::uuid`;
        return aplicarReclassificacao(tx, grupos, OUT);
      }, false),
    ).rejects.toThrow(/mandava 2 peça\(s\) para a base e o banco mudou 1/);
    expect(await retrato()).toEqual(antes);
  });
});

describe('desfazerReclassificacao', () => {
  it('volta ao estado anterior no microssegundo, e desfazer de novo não muda nada', async () => {
    const antes = await retrato();
    const { registro } = await emTransacao((tx) => reclassificarExtras(tx, OUT));
    // O registro passa pelo disco como JSON — e é validado na volta, como no script.
    const lido = validarRegistro(JSON.parse(JSON.stringify(registro)));

    const r = await emTransacao((tx) => desfazerReclassificacao(tx, lido));
    expect(r).toEqual({ desfeitas: 2, jaEramExtra: [], sumiram: [] });
    expect(await retrato()).toEqual(antes);

    const deNovo = await emTransacao((tx) => desfazerReclassificacao(tx, lido));
    expect(deNovo).toEqual({ desfeitas: 0, jaEramExtra: [E1, E2], sumiram: [] });
    expect(await retrato()).toEqual(antes);
  });

  it('peça mexida depois da aplicação volta a extra com o carimbo novo; peça apagada é contada à parte', async () => {
    const antes = await retrato();
    const { registro } = await emTransacao((tx) => reclassificarExtras(tx, OUT));
    await db.exec(`update ideworks.content_items set completed_at = now(), updated_at = now() where id = '${E1}'`);
    await db.exec(`delete from ideworks.content_items where id = '${E2}'`);

    const r = await emTransacao((tx) => desfazerReclassificacao(tx, registro as RegistroDeDesfazer));
    expect(r).toEqual({ desfeitas: 1, jaEramExtra: [], sumiram: [E2] });
    const depois = await retrato();
    expect(depois[E1]?.is_extra).toBe(true);
    expect(depois[E1]?.updated_at).not.toBe(antes[E1]?.updated_at);
  });
});

describe('validarRegistro', () => {
  const valido = (): RegistroDeDesfazer => ({
    tipo: 'reclassificar-extras',
    versao: 1,
    aplicadoEm: '2026-10-09T12:00:00.000Z',
    aPartirDe: OUT,
    pecas: [
      {
        id: E1,
        clientId: ATIVO,
        referenceMonth: NOV,
        contentType: 'arte',
        antes: { isExtra: true, updatedAt: '2026-10-01T12:00:00.123456Z' },
        depois: { isExtra: false, updatedAt: '2026-10-09T12:00:00.654321Z' },
      },
    ],
  });

  it('aceita o registro que a aplicação grava', () => {
    expect(validarRegistro(valido())).toEqual(valido());
  });

  it('recusa o que não é registro desta aplicação, vazio, peça torta ou repetida', () => {
    expect(() => validarRegistro({ ...valido(), tipo: 'outra-coisa' })).toThrow(/não é um registro/);
    expect(() => validarRegistro(null)).toThrow(/não é um registro/);
    expect(() => validarRegistro({ ...valido(), pecas: [] })).toThrow(/não tem peças/);
    const torta = valido();
    torta.pecas[0]!.id = 'nao-e-uuid';
    expect(() => validarRegistro(torta)).toThrow(/peça 1/);
    const semInstante = valido();
    semInstante.pecas[0]!.antes.updatedAt = 'ontem';
    expect(() => validarRegistro(semInstante)).toThrow(/peça 1/);
    const repetida = valido();
    repetida.pecas.push(repetida.pecas[0]!);
    expect(() => validarRegistro(repetida)).toThrow(/duas vezes/);
  });
});
