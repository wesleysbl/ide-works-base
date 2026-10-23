/**
 * CONCLUIR E REABRIR SÃO ARRASTAR O CARTÃO — F44, Fase 8, contra um Postgres
 * de verdade (PGlite, no próprio processo; nenhuma rede).
 *
 * O QUE RODA DE VERDADE
 *   A migration `ideworks_f44_6_concluir_como_mover` pelo TEXTO do arquivo
 *   (duas vezes: tem de repetir sem erro), sobre as peças que ela chama, todas
 *   tiradas das próprias migrations: `move_task` (F42_4, o corpo no ar),
 *   `status_for_move` (F17.80), `resolve_status_set` (F17.2),
 *   `first_open_status`/`closing_status` (F17.3) e o gatilho do status
 *   (F17.3c), que é quem carimba e limpa a conclusão. Antes dela, as funções
 *   da F17.23 — as que estão em produção — e o último caso confere, contra
 *   `schema-esperado.json`, que o rollback as devolve letra por letra.
 *
 * O QUE É DUBLÊ
 *   O alcance por nó (`can_see_list`, `can_act_on_task`…): uma tabela diz o
 *   nível de cada pessoa em cada lista. As políticas de linha de `tasks`,
 *   `task_assignees` e `task_events` têm o MESMO texto das de produção sobre
 *   esses dublês, e tudo roda como `ideworks_app`, o papel do servidor — é o
 *   que mostra a troca de `security definer` por `invoker`: concluir passa
 *   pela mesma política que o arrasto.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const F44_6 = 'supabase/migrations/20261009140000_ideworks_f44_6_concluir_como_mover.sql';
const ROLLBACK = 'supabase/rollback/20261009140000_ideworks_f44_6_concluir_como_mover.sql';
const ESTEIRAS = 'supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql';
const QUADRO = 'supabase/migrations/20260825100000_ideworks_f17_3_tarefa_no_quadro.sql';
const INVARIANTE = 'supabase/migrations/20260825130000_ideworks_f17_3c_invariante_do_status.sql';
const ACESSO = 'supabase/migrations/20260827120000_ideworks_f17_23_acesso_por_no.sql';
const F17_80 = 'supabase/migrations/20260909174220_ideworks_f17_80_preservar_etapa_ao_mover.sql';
const F42_4 = 'supabase/migrations/20261007150300_ideworks_f42_4_enviar_e_decidir.sql';

const retrato = JSON.parse(readFileSync('supabase/schema-esperado.json', 'utf8')) as { funcoes: string[] };
const normalizar = (t: string | null) => (t ?? '').replace(/\s+/g, ' ').trim();

/** Uma função de uma migration, do `create or replace` até o primeiro `$fn$;`. */
const fatia = (arquivo: string, inicio: string) => {
  const texto = readFileSync(arquivo, 'utf8');
  const de = texto.indexOf(inicio);
  if (de < 0) throw new Error(`não achei ${inicio} em ${arquivo}`);
  return texto.slice(de, texto.indexOf('$fn$;', de) + 5);
};

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const EQUIPE = id(1); // executa nas listas do quadro; só VÊ a lista L_SO_VE
const FORA = id(2); // não alcança nada
const OUTRO = id(3); // autor passado em `p_by` por quem chama
const X = id(4);
const Y = id(5);
const Z = id(6);
const C1 = id(10);
const ESPACO = id(20);

const L1 = id(30); // "ao concluir, passa para o X" e "ao voltar para a fila, passa para o Z"
const L_ENCAMINHA = id(31); // ao concluir, vai para a fila de L_DESTINO
const L_DESTINO = id(32); // sem automação
const L_PARA_SO_VE = id(33); // ao concluir, vai para L_SO_VE
const L_SO_VE = id(34); // EQUIPE só vê
const L_SO_FECHA = id(35); // esteira só com a etapa que fecha

const SET_P = id(40);
const SET_D = id(41);
const SET_V = id(42);
const SET_F = id(43);
const A_FAZER = id(50);
const EM_PRODUCAO = id(51);
const CONCLUIDO = id(52);
const D_FILA = id(53);
const D_FIM = id(54);
const V_FILA = id(55);
const V_FIM = id(56);
const S_FIM = id(57);

const R_FECHA = id(60);
const R_REABRE = id(61);
const R_ENCAMINHA = id(62);
const R_SO_VE = id(63);

const db = new PGlite();

/**
 * Declara quem age, como `withActor` faz (`set_config(..., true)` dentro da
 * transação), e desce para o papel do servidor. Erro desfaz tudo.
 */
const comoPessoa = async <T>(userId: string, trabalho: () => Promise<T>): Promise<T> => {
  await db.exec('begin; set local role ideworks_app');
  try {
    await db.query(`select set_config('app.user_id', $1, true)`, [userId]);
    const r = await trabalho();
    await db.exec('commit');
    return r;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
};

const concluir = (taskId: string, quem = EQUIPE, autor = quem) =>
  comoPessoa(quem, () => db.query('select ideworks.complete_task($1, $2)', [taskId, autor]));
const reabrir = (taskId: string, quem = EQUIPE) =>
  comoPessoa(quem, () => db.query('select ideworks.uncomplete_task($1)', [taskId]));
const arrastar = (taskId: string, listId: string, statusId: string, quem = EQUIPE) =>
  comoPessoa(quem, () => db.query('select ideworks.move_task($1, $2, $3)', [taskId, listId, statusId]));

let seq = 1000;
async function semear(lista: string | null, etapa: string | null, extra: { responsaveis?: string[]; mae?: string; concluida?: boolean } = {}) {
  const tid = id(++seq);
  await db.query(
    `insert into ideworks.tasks(id, list_id, client_id, status_id, parent_id, title, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [tid, lista, lista ? null : C1, etapa, extra.mae ?? null, `Card ${seq}`, extra.concluida ? new Date() : null],
  );
  for (const u of extra.responsaveis ?? []) {
    await db.query('insert into ideworks.task_assignees(task_id, user_id) values ($1, $2)', [tid, u]);
  }
  return tid;
}

type Card = { list_id: string | null; status_id: string | null; completed_at: Date | null; completed_by: string | null };
const card = async (tid: string) =>
  (await db.query<Card>('select list_id, status_id, completed_at, completed_by from ideworks.tasks where id = $1', [tid])).rows[0];
const responsaveis = async (tid: string) =>
  (await db.query<{ user_id: string }>('select user_id from ideworks.task_assignees where task_id = $1 order by user_id', [tid]))
    .rows.map((r) => r.user_id);

type Evento = {
  automation_id: string | null;
  automation_name: string | null;
  from_list_id: string | null;
  to_list_id: string | null;
  from_status_id: string | null;
  to_status_id: string | null;
  removed_user_ids: string[];
  added_user_id: string | null;
  actor_id: string | null;
};
const eventos = async (tid: string) =>
  (await db.query<Evento>(
    `select automation_id, automation_name, from_list_id, to_list_id, from_status_id, to_status_id,
            removed_user_ids, added_user_id, actor_id
       from ideworks.task_events where task_id = $1 order by id`,
    [tid],
  )).rows;

/** As duas funções como `conferir-schema` as lê: assinatura, segurança, config e corpo. */
async function retratoAtual() {
  const r = await db.query<{ linha: string }>(`
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|'
           || case when p.prosecdef then 'definer' else 'invoker' end || '|'
           || coalesce(array_to_string(p.proconfig, ','), '') || '|' || p.prosrc as linha
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'ideworks' and p.proname in ('complete_task', 'uncomplete_task')
     order by p.proname`);
  return r.rows.map((f) => {
    const [assinatura, seguranca, config, ...corpo] = f.linha.split('|');
    return `${assinatura}|${seguranca}|${config}|${normalizar(corpo.join('|'))}`;
  });
}

/** As mesmas linhas, tiradas do retrato de produção. */
const esperado = () =>
  retrato.funcoes
    .filter((f) => ['complete_task', 'uncomplete_task'].includes(f.split('(')[0]))
    .map((f) => {
      const [assinatura, , seguranca, , , , config, ...corpo] = f.split('|');
      return `${assinatura}|${seguranca}|${config}|${normalizar(corpo.join('|'))}`;
    })
    .sort();

/**
 * O retrato JÁ foi regravado depois de a F44_6 entrar no ar? Até lá ele guarda
 * as funções da F17.23 (`definer`); depois, as desta migration (`invoker`). O
 * teste compara com o lado certo nos dois tempos — sem isto, regravar o retrato
 * quebraria a prova "antes", como aconteceu com a F44.3.
 */
const retratoJaTemF44_6 = () => esperado().every((linha) => linha.includes('|invoker|'));
let partida: string[] = [];

beforeAll(async () => {
  await db.exec(`
    create role ideworks_app;
    create schema ideworks;
    grant usage on schema ideworks to ideworks_app;
    alter default privileges in schema ideworks grant all on tables to ideworks_app;
    alter default privileges in schema ideworks grant all on sequences to ideworks_app;

    create type ideworks.access_level as enum ('view', 'execute', 'create', 'manage');
    create type ideworks.status_type as enum ('open', 'unstarted', 'custom', 'done', 'closed');

    create function ideworks.acting_user_id() returns uuid language sql stable as
      $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

    create table ideworks.clients(id uuid primary key, name text);
    create table ideworks.spaces(id uuid primary key);
    create table ideworks.folders(id uuid primary key, space_id uuid);
    create table ideworks.lists(id uuid primary key, space_id uuid, folder_id uuid, name text, client_id uuid);
    create table ideworks.status_sets(id uuid primary key, space_id uuid, folder_id uuid, list_id uuid, name text);
    create table ideworks.statuses(id uuid primary key, status_set_id uuid not null references ideworks.status_sets,
      name text not null, type ideworks.status_type not null, sort_order int not null default 0);
    create table ideworks.tasks(id uuid primary key, list_id uuid references ideworks.lists,
      client_id uuid references ideworks.clients, status_id uuid references ideworks.statuses,
      parent_id uuid references ideworks.tasks, title text not null, archived_at timestamptz,
      completed_at timestamptz, completed_by uuid, updated_at timestamptz default now());
    -- A subtarefa mora na lista da mãe (F17.15): a chave composta de produção.
    alter table ideworks.tasks add constraint tasks_list_id_id_key unique (list_id, id);
    alter table ideworks.tasks add constraint tasks_parent_same_list_fk
      foreign key (list_id, parent_id) references ideworks.tasks (list_id, id)
      on update cascade on delete cascade;
    create table ideworks.task_assignees(task_id uuid not null references ideworks.tasks, user_id uuid not null,
      primary key (task_id, user_id));
    create table ideworks.task_automations(id uuid primary key, name text not null, source_list_id uuid not null,
      trigger_status_id uuid not null, is_active boolean not null default true,
      target_list_id uuid, target_status_id uuid, assignee_id uuid);
    -- As duas restrições da F17.65: evento à mão não tem regra, e evento em
    -- branco não entra.
    create table ideworks.task_events(id bigint generated always as identity primary key,
      task_id uuid not null references ideworks.tasks on delete cascade,
      automation_id uuid, automation_name text,
      from_list_id uuid, to_list_id uuid, from_status_id uuid, to_status_id uuid,
      from_list_name text, to_list_name text, from_status_name text, to_status_name text,
      removed_user_ids uuid[] not null default '{}', added_user_id uuid,
      added_user_ids uuid[] not null default '{}', actor_id uuid,
      occurred_at timestamptz not null default now(),
      constraint task_events_manual_has_no_rule
        check (automation_name is not null or automation_id is null),
      constraint task_events_says_something
        check (from_list_id is distinct from to_list_id or from_status_id is distinct from to_status_id
               or removed_user_ids <> '{}'::uuid[] or added_user_ids <> '{}'::uuid[]
               or added_user_id is not null));

    -- Dublês do alcance por nó: o nível de cada pessoa em cada lista, e o
    -- cliente para a demanda sem quadro. Como os de produção, rodam como o dono.
    create table ideworks.acesso(user_id uuid, list_id uuid, level ideworks.access_level);
    create table ideworks.user_clients(user_id uuid, client_id uuid);
    create function ideworks.can_see_list(target uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select exists (select 1 from ideworks.acesso a
           where a.list_id = target and a.user_id = ideworks.acting_user_id()) $$;
    create function ideworks.can_see_client(target uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select exists (select 1 from ideworks.user_clients uc
           where uc.client_id = target and uc.user_id = ideworks.acting_user_id()) $$;
    create function ideworks.can_reach_task(p_list_id uuid, p_client_id uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select (p_list_id is not null and ideworks.can_see_list(p_list_id))
             or (p_client_id is not null and ideworks.can_see_client(p_client_id)) $$;
    create function ideworks.can_act_on_task(p_list_id uuid, p_client_id uuid, p_min ideworks.access_level)
      returns boolean language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select ideworks.can_reach_task(p_list_id, p_client_id)
            and (p_list_id is null or exists (select 1 from ideworks.acesso a
                   where a.list_id = p_list_id and a.user_id = ideworks.acting_user_id()
                     and a.level >= p_min)) $$;
    create function ideworks.can_reach_task_id(target uuid) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select ideworks.can_reach_task(t.list_id, t.client_id) from ideworks.tasks t where t.id = target $$;
    create function ideworks.can_act_on_task_id(target uuid, p_min ideworks.access_level) returns boolean
      language sql stable security definer set search_path = ideworks, pg_temp as
      $$ select ideworks.can_act_on_task(t.list_id, t.client_id, p_min) from ideworks.tasks t where t.id = target $$;
    create function ideworks.can_reach_task_for(p_user uuid, p_list uuid, p_client uuid) returns boolean
      language sql stable as $$ select true $$;

    -- As políticas de linha com o texto de produção (F17.23 e F17.65).
    alter table ideworks.tasks enable row level security;
    create policy tasks_select on ideworks.tasks for select using (ideworks.can_reach_task(list_id, client_id));
    create policy tasks_update on ideworks.tasks for update
      using (ideworks.can_act_on_task(list_id, client_id, 'execute'))
      with check (ideworks.can_act_on_task(list_id, client_id, 'execute'));
    alter table ideworks.task_assignees enable row level security;
    create policy task_assignees_select on ideworks.task_assignees for select using (ideworks.can_reach_task_id(task_id));
    create policy task_assignees_write on ideworks.task_assignees for all
      using (ideworks.can_act_on_task_id(task_id, 'execute'))
      with check (ideworks.can_act_on_task_id(task_id, 'execute'));
    alter table ideworks.task_events enable row level security;
    create policy task_events_select on ideworks.task_events for select using (ideworks.can_reach_task_id(task_id));
    create policy task_events_insert on ideworks.task_events for insert with check (ideworks.can_reach_task_id(task_id));
  `);

  await db.exec(fatia(ESTEIRAS, 'create or replace function ideworks.resolve_status_set('));
  await db.exec(fatia(QUADRO, 'create or replace function ideworks.first_open_status('));
  await db.exec(fatia(QUADRO, 'create or replace function ideworks.closing_status('));
  await db.exec(fatia(F17_80, 'create or replace function ideworks.status_for_move('));
  await db.exec(fatia(INVARIANTE, 'create or replace function ideworks.task_status_guard('));
  await db.exec(`create trigger tasks_status_guard before insert or update on ideworks.tasks
    for each row execute function ideworks.task_status_guard();`);
  await db.exec(fatia(F42_4, 'create or replace function ideworks.move_task('));
  // As de produção hoje (F17.23), com a permissão que a F4.8 deu.
  await db.exec(fatia(ACESSO, 'create or replace function ideworks.complete_task('));
  await db.exec(fatia(ACESSO, 'create or replace function ideworks.uncomplete_task('));

  await db.exec(`
    insert into ideworks.clients values ('${C1}', 'Cliente Um');
    insert into ideworks.spaces values ('${ESPACO}');
    insert into ideworks.lists(id, space_id, name) values
      ('${L1}', '${ESPACO}', 'Produção'), ('${L_ENCAMINHA}', '${ESPACO}', 'Encaminha'),
      ('${L_DESTINO}', '${ESPACO}', 'Destino'), ('${L_PARA_SO_VE}', '${ESPACO}', 'Para quem só vê'),
      ('${L_SO_VE}', '${ESPACO}', 'Só vê'), ('${L_SO_FECHA}', '${ESPACO}', 'Só fecha');
    insert into ideworks.status_sets(id, space_id, list_id, name) values
      ('${SET_P}', '${ESPACO}', null, 'Produção'), ('${SET_D}', null, '${L_DESTINO}', 'Destino'),
      ('${SET_V}', null, '${L_SO_VE}', 'Só vê'), ('${SET_F}', null, '${L_SO_FECHA}', 'Só fecha');
    insert into ideworks.statuses(id, status_set_id, name, type, sort_order) values
      ('${A_FAZER}', '${SET_P}', 'a fazer', 'open', 0),
      ('${EM_PRODUCAO}', '${SET_P}', 'em produção', 'custom', 1),
      ('${CONCLUIDO}', '${SET_P}', 'concluído', 'closed', 2),
      ('${D_FILA}', '${SET_D}', 'fila', 'open', 0), ('${D_FIM}', '${SET_D}', 'fim', 'closed', 1),
      ('${V_FILA}', '${SET_V}', 'fila', 'open', 0), ('${V_FIM}', '${SET_V}', 'fim', 'closed', 1),
      ('${S_FIM}', '${SET_F}', 'fim', 'closed', 0);
    insert into ideworks.acesso values
      ('${EQUIPE}', '${L1}', 'execute'), ('${EQUIPE}', '${L_ENCAMINHA}', 'execute'),
      ('${EQUIPE}', '${L_DESTINO}', 'execute'), ('${EQUIPE}', '${L_PARA_SO_VE}', 'execute'),
      ('${EQUIPE}', '${L_SO_VE}', 'view'), ('${EQUIPE}', '${L_SO_FECHA}', 'execute');
    insert into ideworks.user_clients values ('${EQUIPE}', '${C1}');
    insert into ideworks.task_automations(id, name, source_list_id, trigger_status_id, target_list_id, target_status_id, assignee_id) values
      ('${R_FECHA}', 'Ao concluir, passa para o X', '${L1}', '${CONCLUIDO}', null, null, '${X}'),
      ('${R_REABRE}', 'Ao voltar para a fila, passa para o Z', '${L1}', '${A_FAZER}', null, null, '${Z}'),
      ('${R_ENCAMINHA}', 'Concluída vai para a fila do destino', '${L_ENCAMINHA}', '${CONCLUIDO}', '${L_DESTINO}', '${D_FILA}', null),
      ('${R_SO_VE}', 'Concluída vai para quem só vê', '${L_PARA_SO_VE}', '${CONCLUIDO}', '${L_SO_VE}', '${V_FILA}', null);
  `);
});

afterAll(() => db.close());

describe('antes da F44_6: o que está no ar', () => {
  it('as funções de partida são as do retrato de produção, e concluir não deixa rastro', async () => {
    partida = await retratoAtual();
    expect(partida.every((linha) => linha.includes('|definer|'))).toBe(true);
    // Retrato ainda de antes da F44_6: a partida é ele, letra por letra.
    if (!retratoJaTemF44_6()) expect(partida).toEqual(esperado());
    const tid = await semear(L1, EM_PRODUCAO, { responsaveis: [Y] });
    await concluir(tid);
    expect(await card(tid)).toMatchObject({ status_id: CONCLUIDO, completed_by: EQUIPE });
    // A dívida medida da F17.65: nem evento, nem a regra "ao concluir, passa para o X".
    expect(await eventos(tid)).toEqual([]);
    expect(await responsaveis(tid)).toEqual([Y]);
  });

  it('a migration entra, e repete sem erro', async () => {
    for (let i = 0; i < 2; i++) await db.exec(readFileSync(F44_6, 'utf8'));
    const seguranca = await db.query<{ proname: string; prosecdef: boolean }>(
      `select proname, prosecdef from pg_proc where proname in ('complete_task', 'uncomplete_task') order by proname`,
    );
    expect(seguranca.rows).toEqual([
      { proname: 'complete_task', prosecdef: false },
      { proname: 'uncomplete_task', prosecdef: false },
    ]);
  });
});

describe('concluir passa pela automação e pelo histórico', () => {
  let tarefa = '';

  it('numa lista com "ao fechar, atribuir X": atribui X e grava o evento da mão e o da regra', async () => {
    tarefa = await semear(L1, EM_PRODUCAO, { responsaveis: [Y] });
    await concluir(tarefa);

    const depois = await card(tarefa);
    expect(depois).toMatchObject({ list_id: L1, status_id: CONCLUIDO, completed_by: EQUIPE });
    expect(depois.completed_at).not.toBeNull();
    // "Substituindo": quem cuidava sai, X entra — o gesto de `set_task_assignees`.
    expect(await responsaveis(tarefa)).toEqual([X]);
    expect(await eventos(tarefa)).toEqual([
      {
        automation_id: null, automation_name: null,
        from_list_id: L1, to_list_id: L1, from_status_id: EM_PRODUCAO, to_status_id: CONCLUIDO,
        removed_user_ids: [], added_user_id: null, actor_id: EQUIPE,
      },
      {
        automation_id: R_FECHA, automation_name: 'Ao concluir, passa para o X',
        from_list_id: L1, to_list_id: L1, from_status_id: CONCLUIDO, to_status_id: CONCLUIDO,
        removed_user_ids: [Y], added_user_id: X, actor_id: EQUIPE,
      },
    ]);
  });

  it('concluir o que já está concluído não grava evento nem roda a regra de novo', async () => {
    // Alguém devolveu a tarefa para o Y depois; o segundo clique não pode desfazer isso.
    await db.query('update ideworks.task_assignees set user_id = $2 where task_id = $1', [tarefa, Y]);
    const antes = await card(tarefa);
    await concluir(tarefa, EQUIPE, OUTRO);
    expect(await eventos(tarefa)).toHaveLength(2);
    expect(await responsaveis(tarefa)).toEqual([Y]);
    // Nem o autor muda: a conclusão já tinha dono.
    expect(await card(tarefa)).toMatchObject({ status_id: CONCLUIDO, completed_by: EQUIPE, completed_at: antes.completed_at });
  });

  it('reabrir volta para a primeira etapa que abre, grava o evento e roda a regra daquela etapa', async () => {
    await reabrir(tarefa);
    expect(await card(tarefa)).toMatchObject({ list_id: L1, status_id: A_FAZER, completed_at: null, completed_by: null });
    expect(await responsaveis(tarefa)).toEqual([Z]);
    expect((await eventos(tarefa)).slice(2)).toEqual([
      {
        automation_id: null, automation_name: null,
        from_list_id: L1, to_list_id: L1, from_status_id: CONCLUIDO, to_status_id: A_FAZER,
        removed_user_ids: [], added_user_id: null, actor_id: EQUIPE,
      },
      {
        automation_id: R_REABRE, automation_name: 'Ao voltar para a fila, passa para o Z',
        from_list_id: L1, to_list_id: L1, from_status_id: A_FAZER, to_status_id: A_FAZER,
        removed_user_ids: [Y], added_user_id: Z, actor_id: EQUIPE,
      },
    ]);
  });

  it('reabrir o que já está na primeira que abre não grava evento nem roda a regra', async () => {
    await reabrir(tarefa);
    expect(await eventos(tarefa)).toHaveLength(4);
    expect(await card(tarefa)).toMatchObject({ status_id: A_FAZER, completed_at: null });
  });

  it('o autor da conclusão é o p_by de quem chama; o evento é de quem age', async () => {
    const tid = await semear(L_DESTINO, D_FILA);
    await concluir(tid, EQUIPE, OUTRO);
    expect(await card(tid)).toMatchObject({ status_id: D_FIM, completed_by: OUTRO });
    expect(await eventos(tid)).toEqual([
      expect.objectContaining({ automation_id: null, from_status_id: D_FILA, to_status_id: D_FIM, actor_id: EQUIPE }),
    ]);
  });

  it('a subtarefa não é concluída junto, e não ganha evento', async () => {
    const mae = await semear(L_DESTINO, D_FILA);
    const filha = await semear(L_DESTINO, D_FILA, { mae });
    await concluir(mae);
    expect(await card(mae)).toMatchObject({ status_id: D_FIM });
    expect(await card(filha)).toMatchObject({ list_id: L_DESTINO, status_id: D_FILA, completed_at: null });
    expect(await eventos(filha)).toEqual([]);
  });
});

describe('a regra que encaminha: o resultado é o de arrastar o cartão', () => {
  it('concluir e arrastar para a coluna que fecha deixam a tarefa no mesmo lugar, com o mesmo histórico', async () => {
    const pelaFicha = await semear(L_ENCAMINHA, A_FAZER);
    const peloArrasto = await semear(L_ENCAMINHA, A_FAZER);
    await concluir(pelaFicha);
    await arrastar(peloArrasto, L_ENCAMINHA, CONCLUIDO);

    const [a, b] = [await card(pelaFicha), await card(peloArrasto)];
    // A fila do destino abre: a tarefa termina ABERTA lá, nos dois caminhos.
    expect(a).toMatchObject({ list_id: L_DESTINO, status_id: D_FILA, completed_at: null, completed_by: null });
    expect(b).toEqual(a);
    expect(await eventos(pelaFicha)).toEqual(await eventos(peloArrasto));
    expect(await eventos(pelaFicha)).toEqual([
      expect.objectContaining({ automation_id: null, from_status_id: A_FAZER, to_status_id: CONCLUIDO }),
      expect.objectContaining({
        automation_id: R_ENCAMINHA, from_list_id: L_ENCAMINHA, to_list_id: L_DESTINO,
        from_status_id: CONCLUIDO, to_status_id: D_FILA,
      }),
    ]);
  });

  it('a regra encaminharia uma SUBTAREFA para fora da lista da mãe: recusado como o arrasto, e nada muda', async () => {
    const mae = await semear(L_ENCAMINHA, A_FAZER);
    const pelaFicha = await semear(L_ENCAMINHA, A_FAZER, { mae });
    const peloArrasto = await semear(L_ENCAMINHA, A_FAZER, { mae });
    const erroFicha = await concluir(pelaFicha).catch((e) => e);
    const erroArrasto = await arrastar(peloArrasto, L_ENCAMINHA, CONCLUIDO).catch((e) => e);
    // A chave composta recusa os dois; o servidor troca o nome dela por frase
    // (`FRASE_SUBTAREFA_NAO_SAI_SOZINHA`, `board-task.ts`).
    expect(erroFicha).toMatchObject({ code: '23503' });
    expect(erroArrasto).toMatchObject({ code: '23503' });
    expect(erroFicha.message).toMatch(/tasks_parent_same_list_fk/);
    expect(erroFicha.message).toBe(erroArrasto.message);
    expect(await card(pelaFicha)).toMatchObject({ list_id: L_ENCAMINHA, status_id: A_FAZER, completed_at: null });
    expect(await eventos(pelaFicha)).toEqual([]);
  });

  it('a regra leva para uma lista onde a pessoa só VÊ: recusado como o arrasto, e nada muda', async () => {
    const pelaFicha = await semear(L_PARA_SO_VE, A_FAZER);
    const peloArrasto = await semear(L_PARA_SO_VE, A_FAZER);
    const erroFicha = await concluir(pelaFicha).catch((e) => e);
    const erroArrasto = await arrastar(peloArrasto, L_PARA_SO_VE, CONCLUIDO).catch((e) => e);
    // A política de `tasks` (with check, `execute` no destino) recusa os dois.
    expect(erroFicha).toMatchObject({ code: '42501' });
    expect(erroArrasto).toMatchObject({ code: '42501' });
    expect(erroFicha.message).toBe(erroArrasto.message);
    expect(await card(pelaFicha)).toMatchObject({ list_id: L_PARA_SO_VE, status_id: A_FAZER, completed_at: null });
    expect(await eventos(pelaFicha)).toEqual([]);
  });
});

describe('os caminhos que não passam por move_task, e as recusas', () => {
  it('demanda sem quadro: concluir e reabrir só carimbam, sem evento', async () => {
    const tid = await semear(null, null);
    await concluir(tid);
    const concluida = await card(tid);
    expect(concluida).toMatchObject({ list_id: null, status_id: null, completed_by: EQUIPE });
    expect(concluida.completed_at).not.toBeNull();
    await reabrir(tid);
    expect(await card(tid)).toMatchObject({ completed_at: null, completed_by: null });
    expect(await eventos(tid)).toEqual([]);
  });

  it('fora do alcance: 42501 com a frase de sempre, e nada muda', async () => {
    const tid = await semear(L1, EM_PRODUCAO, { responsaveis: [Y] });
    for (const tentar of [() => concluir(tid, FORA), () => reabrir(tid, FORA)]) {
      const erro = await tentar().catch((e) => e);
      expect(erro).toMatchObject({ code: '42501', message: 'tarefa nao encontrada ou fora do seu alcance' });
    }
    expect(await card(tid)).toMatchObject({ status_id: EM_PRODUCAO, completed_at: null });
    expect(await responsaveis(tid)).toEqual([Y]);
    expect(await eventos(tid)).toEqual([]);
  });

  it('esteira só com a etapa que fecha: reabrir recusa alto (antes não fazia nada, em silêncio)', async () => {
    const tid = await semear(L_SO_FECHA, null, { concluida: true });
    expect(await card(tid)).toMatchObject({ status_id: S_FIM });
    const erro = await reabrir(tid).catch((e) => e);
    expect(erro).toMatchObject({ code: '22023' });
    expect(await card(tid)).toMatchObject({ status_id: S_FIM });
    expect((await card(tid)).completed_at).not.toBeNull();
  });
});

describe('o rollback', () => {
  it('devolve exatamente as funções do retrato de produção, e a migration reaplica', async () => {
    const depois = await retratoAtual();
    expect(depois.every((linha) => linha.includes('|invoker|'))).toBe(true);
    // Retrato já regravado com a F44_6: a migration é ele, letra por letra.
    if (retratoJaTemF44_6()) expect(depois).toEqual(esperado());

    await db.exec(readFileSync(ROLLBACK, 'utf8'));
    // O rollback devolve a partida — que é o retrato de produção de antes da F44_6.
    expect(await retratoAtual()).toEqual(partida);
    if (!retratoJaTemF44_6()) expect(partida).toEqual(esperado());

    await db.exec(readFileSync(F44_6, 'utf8'));
    expect(await retratoAtual()).toEqual(depois);
  });
});
