/**
 * LIBERAR A DEMANDA, CONTRA UM POSTGRES DE VERDADE — F40, Fase 6.
 *
 * O MESMO `liberarDemanda` de `server/liberar-demanda.ts`, com `Sql`/`Tx`
 * trocados por um adaptador sobre o PGlite. O que roda de verdade: as consultas
 * do módulo, `patchBoardTaskInTx`, `moveTaskOnBoardInTx`, `resolve_status_set`
 * da F17.2 e a migration da Fase 1 do F40.
 *
 * O QUE É DUBLÊ: `ideworks.move_task` e `ideworks.set_task_assignees` (a
 * original roda automações, subárvore e mais dez travas; aqui só trocam
 * lista/etapa, gravam o evento em `task_events` com o autor e os
 * responsáveis). A prova com o `move_task` real é o script
 * `scripts/provar-liberar-demanda.mjs`, em produção, com ROLLBACK.
 *
 * Concorrência: o `for update` é conferido pelo texto da consulta (ver o
 * último teste); a corrida real só existe em produção.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TypeRequired } from '@/server/board';
import type { Sql, Tx } from '@/server/db';
import { liberarDemanda, normalizarEtapa } from '@/server/liberar-demanda';
import type { AuthenticatedActor } from '@/server/session';

const MIGRATION = 'supabase/migrations/20261007130000_ideworks_f40_tipo_da_tarefa.sql';
const ESTEIRAS = 'supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql';

type Fragmento = { readonly dublê: true; readonly strings: readonly string[]; readonly args: readonly unknown[] };
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

let db: PGlite;
const textos: string[] = [];

const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      const texto = montar(f, params);
      textos.push(texto);
      return db.query(texto, params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

const sql = {
  begin: async (trabalho: (t: Tx) => Promise<unknown>) => {
    await db.exec('begin;');
    try {
      const r = await trabalho(tx);
      await db.exec('commit;');
      return r;
    } catch (e) {
      await db.exec('rollback;');
      throw e;
    }
  },
} as unknown as Sql;

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const IDE = id(1);
const ALMA = id(2);
const ESPACO = id(3);
const ESPACO_SEM_ARTE = id(4);
const ESPACO_ALMA = id(5);
const C_ALFA = id(10);
const C_ALMA = id(11);
const L_ALFA = id(20);
const L_SEM_ARTE = id(21);
const L_ALMA = id(22);
const S_ATRIBUIR = id(40);
const S_AFAZER = id(41);
const S_AFAZER_VIDEO = id(42);
const S_AFAZER_ARTE = id(43);
const S_B_ATRIBUIR = id(44);
const S_B_AFAZER = id(45);
const S_B_AFAZER_VIDEO = id(46);
const S_A_ATRIBUIR = id(47);
const ADMIN = id(90);
const OUTRO_ADMIN = id(93);
const HELENA = id(91);
const JOAO = id(92);

const ator = (admin = true, userId = ADMIN, omitidas: string[] = []): AuthenticatedActor => ({
  userId,
  email: 'pessoa@example.invalid',
  papel: admin ? 'admin' : 'funcionario',
  isSuperadmin: admin,
  isSuper: false,
  areas: [],
  hasAllClientsAccess: admin,
  categoriasOmitidas: omitidas,
});

let seq = 1000;
async function semear(
  lista: string,
  etapa: string,
  tipo: string | null,
  extra: { arquivada?: boolean } = {},
): Promise<string> {
  const tid = id(++seq);
  await db.exec(`insert into ideworks.tasks(id, list_id, title, status_id, demand_type, archived_at)
    values ('${tid}', '${lista}', 'Card ${seq}', '${etapa}', ${tipo ? `'${tipo}'` : 'null'},
            ${extra.arquivada ? 'now()' : 'null'});`);
  return tid;
}

const lerCard = async (tid: string) =>
  (await db.query<{ status_id: string; list_id: string; due_on: string | null }>(
    `select status_id, list_id, due_on::text as due_on from ideworks.tasks where id = '${tid}'`,
  )).rows[0];
const lerResponsaveis = async (tid: string) =>
  (await db.query<{ user_id: string }>(
    `select user_id from ideworks.task_assignees where task_id = '${tid}' order by user_id`,
  )).rows.map((r) => r.user_id);
const lerEventos = async (tid: string) =>
  (await db.query<{ actor_id: string; from_status_id: string; to_status_id: string }>(
    `select actor_id, from_status_id, to_status_id from ideworks.task_events where task_id = '${tid}' order by id`,
  )).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create type ideworks.status_type as enum ('open', 'unstarted', 'custom', 'done', 'closed');
    create type ideworks.task_priority as enum ('urgent', 'high', 'normal', 'low');
    create table ideworks.client_categories(id uuid primary key, name text);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid, is_active boolean);
    create table ideworks.spaces(id uuid primary key, category_id uuid);
    create table ideworks.folders(id uuid primary key, space_id uuid);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, client_id uuid);
    create table ideworks.status_sets(id uuid primary key default gen_random_uuid(),
      space_id uuid, folder_id uuid, list_id uuid, name text);
    create table ideworks.statuses(id uuid primary key default gen_random_uuid(),
      status_set_id uuid not null, name text not null, type ideworks.status_type, sort_order integer not null default 0);
    create table ideworks.tasks(id uuid primary key, list_id uuid, client_id uuid, parent_id uuid,
      title text not null, description text, status_id uuid, due_on date, start_on date,
      priority ideworks.task_priority, custom_item_id integer, updated_at timestamptz,
      archived_at timestamptz, created_by uuid);
    create table ideworks.task_assignees(task_id uuid, user_id uuid);
    create table ideworks.task_events(id bigint generated always as identity primary key, task_id uuid not null,
      from_list_id uuid, to_list_id uuid, from_status_id uuid, to_status_id uuid, actor_id uuid,
      occurred_at timestamptz not null default now());
    create function ideworks.display_name(u uuid) returns text language sql as $$
      select case u when '${ADMIN}'::uuid then 'Fulano' when '${OUTRO_ADMIN}'::uuid then 'Ciclana' else 'Outra' end $$;
    create function ideworks.acting_user_id() returns uuid language sql as $$
      select nullif(current_setting('app.user_id', true), '')::uuid $$;
    create function ideworks.set_task_assignees(p_task uuid, p_users uuid[]) returns void language sql as $$
      delete from ideworks.task_assignees where task_id = p_task;
      insert into ideworks.task_assignees select p_task, u from unnest(coalesce(p_users, '{}')) u $$;
    create function ideworks.move_task(p_task uuid, p_list uuid, p_status uuid) returns jsonb language plpgsql as $$
    declare v_status_antes uuid; v_lista_antes uuid;
    begin
      select status_id, list_id into v_status_antes, v_lista_antes from ideworks.tasks where id = p_task;
      update ideworks.tasks set list_id = p_list, status_id = p_status, updated_at = now() where id = p_task;
      if p_status is distinct from v_status_antes or p_list is distinct from v_lista_antes then
        insert into ideworks.task_events(task_id, from_list_id, to_list_id, from_status_id, to_status_id, actor_id)
        values (p_task, v_lista_antes, p_list, v_status_antes, p_status, ideworks.acting_user_id());
      end if;
      return jsonb_build_object('task_id', p_task, 'list_id', p_list, 'status_id', p_status,
        'previous_status_id', v_status_antes, 'status_repositioned', false, 'subtasks_moved', 0, 'automation', null);
    end $$;

    insert into ideworks.client_categories values ('${IDE}', 'Ide'), ('${ALMA}', 'Alma9');
    insert into ideworks.clients values ('${C_ALFA}', 'Alfa', '${IDE}', true), ('${C_ALMA}', 'Da Alma', '${ALMA}', true);
    insert into ideworks.spaces values ('${ESPACO}', '${IDE}'), ('${ESPACO_SEM_ARTE}', '${IDE}'), ('${ESPACO_ALMA}', '${ALMA}');
    insert into ideworks.lists values
      ('${L_ALFA}', '${ESPACO}', null, 'Alfa', '${C_ALFA}'),
      ('${L_SEM_ARTE}', '${ESPACO_SEM_ARTE}', null, 'Sem Arte', '${C_ALFA}'),
      ('${L_ALMA}', '${ESPACO_ALMA}', null, 'Alma', '${C_ALMA}');
    insert into ideworks.status_sets(id, space_id, name) values
      ('${id(50)}', '${ESPACO}', 'Produção'), ('${id(51)}', '${ESPACO_SEM_ARTE}', 'Produção sem arte'),
      ('${id(52)}', '${ESPACO_ALMA}', 'Produção Alma');
    insert into ideworks.statuses(id, status_set_id, name, type, sort_order) values
      ('${S_ATRIBUIR}', '${id(50)}', 'Atribuir Demanda', 'open', 1),
      ('${S_AFAZER}', '${id(50)}', 'A fazer', 'unstarted', 2),
      ('${S_AFAZER_VIDEO}', '${id(50)}', 'A fazer Vídeo', 'unstarted', 3),
      ('${S_AFAZER_ARTE}', '${id(50)}', 'a fazer arte', 'unstarted', 4),
      ('${S_B_ATRIBUIR}', '${id(51)}', 'atribuir demanda', 'open', 1),
      ('${S_B_AFAZER}', '${id(51)}', 'a fazer', 'unstarted', 2),
      ('${S_B_AFAZER_VIDEO}', '${id(51)}', 'a fazer video', 'unstarted', 3),
      ('${S_A_ATRIBUIR}', '${id(52)}', 'atribuir demanda', 'open', 1);
  `);
  const esteiras = readFileSync(ESTEIRAS, 'utf8');
  const de = esteiras.indexOf('create or replace function ideworks.resolve_status_set(');
  await db.exec(esteiras.slice(de, esteiras.indexOf('$fn$;', de) + 5));
  await db.exec(readFileSync(MIGRATION, 'utf8'));
});

afterAll(async () => {
  await db?.close();
});

describe('F40 — liberar: a etapa certa de cada tipo (D3)', () => {
  const casos: Array<[string, string, string]> = [
    ['video', S_AFAZER_VIDEO, 'A fazer Vídeo'], // acento e maiúscula casam
    ['arte', S_AFAZER_ARTE, 'a fazer arte'],
    ['foto', S_AFAZER, 'A fazer'], // "a fazer" não casa com "a fazer video"
    ['outros', S_AFAZER, 'A fazer'],
  ];
  it.each(casos)('%s vai para "%s"', async (tipo, esperada, nome) => {
    const tid = await semear(L_ALFA, S_ATRIBUIR, tipo);
    const r = await liberarDemanda(sql, ator(), { taskId: tid, assigneeIds: [HELENA, JOAO], dueOn: '2026-10-09' });
    expect(r).toMatchObject({ statusId: esperada, statusName: nome, type: tipo, listId: L_ALFA, dueOn: '2026-10-09' });
    const card = await lerCard(tid);
    expect(card.status_id).toBe(esperada);
    expect(card.list_id).toBe(L_ALFA);
  });
});

describe('F40 — liberar: o que é gravado', () => {
  it('responsáveis, prazo e um evento de movimento com o admin como autor', async () => {
    const tid = await semear(L_ALFA, S_ATRIBUIR, 'video');
    await liberarDemanda(sql, ator(), { taskId: tid, assigneeIds: [JOAO, HELENA, JOAO], dueOn: '2026-10-09' });
    expect(await lerResponsaveis(tid)).toEqual([HELENA, JOAO].sort());
    expect((await lerCard(tid)).due_on).toBe('2026-10-09');
    expect(await lerEventos(tid)).toEqual([{ actor_id: ADMIN, from_status_id: S_ATRIBUIR, to_status_id: S_AFAZER_VIDEO }]);
  });
});

describe('F40 — liberar: recusas, sem nada gravado', () => {
  it('a segunda liberação do mesmo card diz quem e quando; nada muda', async () => {
    const tid = await semear(L_ALFA, S_ATRIBUIR, 'arte');
    await liberarDemanda(sql, ator(true, ADMIN), { taskId: tid, assigneeIds: [HELENA], dueOn: '2026-10-09' });
    const erro = await liberarDemanda(sql, ator(true, OUTRO_ADMIN), {
      taskId: tid, assigneeIds: [JOAO], dueOn: '2026-10-20',
    }).catch((e) => e);
    expect(erro).toMatchObject({ name: 'LiberarRecusado', status: 409, code: 'already_released' });
    expect(erro.message).toMatch(/^Já liberado por Fulano às \d{2}:\d{2}\.$/);
    expect(await lerResponsaveis(tid)).toEqual([HELENA]);
    expect((await lerCard(tid)).due_on).toBe('2026-10-09');
    expect(await lerEventos(tid)).toHaveLength(1);
  });

  it('esteira sem "a fazer arte" recusa dizendo qual etapa falta', async () => {
    const tid = await semear(L_SEM_ARTE, S_B_ATRIBUIR, 'arte');
    const erro = await liberarDemanda(sql, ator(), { taskId: tid, assigneeIds: [HELENA], dueOn: '2026-10-09' }).catch((e) => e);
    expect(erro).toMatchObject({ status: 409, code: 'stage_missing' });
    expect(erro.message).toContain('"Sem Arte"');
    expect(erro.message).toContain('"a fazer arte"');
    expect((await lerCard(tid)).status_id).toBe(S_B_ATRIBUIR);
    expect(await lerResponsaveis(tid)).toEqual([]);
    expect((await lerCard(tid)).due_on).toBeNull();
  });

  it('a mesma esteira sem arte libera vídeo normalmente', async () => {
    const tid = await semear(L_SEM_ARTE, S_B_ATRIBUIR, 'video');
    await liberarDemanda(sql, ator(), { taskId: tid, assigneeIds: [HELENA], dueOn: '2026-10-09' });
    expect((await lerCard(tid)).status_id).toBe(S_B_AFAZER_VIDEO);
  });

  it('card sem tipo: type_required, nada gravado', async () => {
    const tid = await semear(L_ALFA, S_ATRIBUIR, null);
    const erro = await liberarDemanda(sql, ator(), { taskId: tid, assigneeIds: [HELENA], dueOn: '2026-10-09' }).catch((e) => e);
    expect(erro).toBeInstanceOf(TypeRequired);
    expect(erro).toMatchObject({ status: 400, code: 'type_required' });
    expect((await lerCard(tid)).status_id).toBe(S_ATRIBUIR);
    expect(await lerResponsaveis(tid)).toEqual([]);
  });

  it('sem pessoa e sem prazo (ou prazo torto) são 400 com código', async () => {
    const tid = await semear(L_ALFA, S_ATRIBUIR, 'video');
    expect(await liberarDemanda(sql, ator(), { taskId: tid, assigneeIds: [], dueOn: '2026-10-09' }).catch((e) => e))
      .toMatchObject({ status: 400, code: 'assignee_required' });
    for (const dueOn of ['', '2026-02-30', 'amanhã']) {
      expect(await liberarDemanda(sql, ator(), { taskId: tid, assigneeIds: [HELENA], dueOn }).catch((e) => e))
        .toMatchObject({ status: 400, code: 'due_required' });
    }
    expect((await lerCard(tid)).status_id).toBe(S_ATRIBUIR);
  });

  it('card inexistente, arquivado ou de empresa omitida é 404', async () => {
    const arquivado = await semear(L_ALFA, S_ATRIBUIR, 'video', { arquivada: true });
    const daAlma = await semear(L_ALMA, S_A_ATRIBUIR, 'video');
    for (const taskId of [id(999999), arquivado]) {
      expect(await liberarDemanda(sql, ator(), { taskId, assigneeIds: [HELENA], dueOn: '2026-10-09' }).catch((e) => e))
        .toMatchObject({ status: 404 });
    }
    expect(await liberarDemanda(sql, ator(true, ADMIN, [ALMA]), { taskId: daAlma, assigneeIds: [HELENA], dueOn: '2026-10-09' }).catch((e) => e))
      .toMatchObject({ status: 404 });
    expect(await liberarDemanda(sql, ator(), { taskId: daAlma, assigneeIds: [HELENA], dueOn: '2026-10-09' }).catch((e) => e))
      .toMatchObject({ status: 409, code: 'stage_missing' }); // sem omitida chega à esteira, que não tem "a fazer video"
  });

  it('funcionário recebe 403 antes de qualquer consulta', async () => {
    const tid = await semear(L_ALFA, S_ATRIBUIR, 'video');
    const antes = textos.length;
    const erro = await liberarDemanda(sql, ator(false), { taskId: tid, assigneeIds: [HELENA], dueOn: '2026-10-09' }).catch((e) => e);
    expect(erro).toMatchObject({ name: 'BoardRefused', status: 403 });
    expect(textos.length).toBe(antes);
    expect((await lerCard(tid)).status_id).toBe(S_ATRIBUIR);
  });
});

describe('F40 — liberar: a trava e o nome da etapa', () => {
  it('a primeira leitura do card trava a linha (select … for update of t)', async () => {
    const tid = await semear(L_ALFA, S_ATRIBUIR, 'foto');
    const antes = textos.length;
    await liberarDemanda(sql, ator(), { taskId: tid, assigneeIds: [HELENA], dueOn: '2026-10-09' });
    const primeira = textos.slice(antes).find((t) => t.includes('from ideworks.tasks t'));
    expect(primeira).toMatch(/for update of t\s*$/);
  });

  it('normalizarEtapa: sem acento, sem maiúscula, espaços colapsados; igualdade exata', () => {
    expect(normalizarEtapa('  A  fazer Vídeo ')).toBe('a fazer video');
    expect(normalizarEtapa('A fazer')).not.toBe(normalizarEtapa('A fazer vídeo'));
  });
});
