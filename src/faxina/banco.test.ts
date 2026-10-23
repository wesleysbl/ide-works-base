/**
 * A ESCRITA DA FAXINA CONTRA O `task_parent_guard` REAL — F38, Fase 8.
 *
 * O guarda (copiado da migration da F17.15, como em
 * `cliente-da-tarefa-banco.test.ts`) recusa trocar o cliente de uma mãe que tem
 * filhas e recusa filha com cliente diferente do da mãe. Aqui se prova que
 * `gravarClienteNaArvore` passa por ele: mãe, filhas, neta e filha arquivada
 * ganham o cliente juntas, o histórico recebe uma linha por tarefa, e o
 * UPDATE direto (sem o desvio) de fato seria recusado.
 *
 * NÃO PROVA: políticas de linha (RLS) nem o `acting_user_id` real — aqui é uma
 * função que devolve nulo. Isso só no banco de produção, e a prova de
 * produção desta fase é só de leitura.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Tx } from '@/server/db';

import { gravarClienteNaArvore } from './banco';
import { montarArvores, type TarefaLida } from './planejar';

type Fragmento = { readonly dublê: true; readonly strings: readonly string[]; readonly args: readonly unknown[] };
const ehFragmento = (v: unknown): v is Fragmento => typeof v === 'object' && v !== null && (v as Fragmento).dublê === true;
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
const tx = ((strings: TemplateStringsArray, ...args: unknown[]) => {
  const f: Fragmento & PromiseLike<unknown[]> = {
    dublê: true,
    strings,
    args,
    then(ok, falha) {
      const params: unknown[] = [];
      return db.query(montar(f, params), params).then((r) => r.rows).then(ok, falha);
    },
  };
  return f;
}) as unknown as Tx;

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const LISTA = id(30);
const CLIENTE = id(20);
const OUTRO = id(21);
const MAE = id(1);
const FILHA = id(2);
const NETA = id(3);
const FILHA_ARQUIVADA = id(4);
const SOLTA = id(5);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create table ideworks.clients(id uuid primary key, name text);
    create table ideworks.lists(id uuid primary key, client_id uuid references ideworks.clients, name text);
    create table ideworks.tasks(id uuid primary key, list_id uuid references ideworks.lists,
      client_id uuid references ideworks.clients, parent_id uuid references ideworks.tasks,
      title text not null, archived_at timestamptz);
    create table ideworks.task_events(id bigint generated always as identity primary key,
      task_id uuid not null references ideworks.tasks, automation_name text,
      from_client_id uuid references ideworks.clients, to_client_id uuid references ideworks.clients,
      from_client_name text, to_client_name text, actor_id uuid);
    create function ideworks.can_reach_task(uuid, uuid) returns boolean language sql as 'select true';
    create function ideworks.acting_user_id() returns uuid language sql as 'select null::uuid';
    insert into ideworks.clients values ('${CLIENTE}', 'Fonseca'), ('${OUTRO}', 'Outro');
    insert into ideworks.lists values ('${LISTA}', '${CLIENTE}', 'Lista');
  `);
  const guarda = readFileSync('supabase/migrations/20260826100000_ideworks_f17_15_subtarefas_e_checklists.sql', 'utf8');
  const de = guarda.indexOf('create or replace function ideworks.task_parent_guard(');
  await db.exec(guarda.slice(de, guarda.indexOf('$fn$;', de) + 5));
  await db.exec(`create trigger tasks_parent_guard
    before insert or update of parent_id, list_id, client_id on ideworks.tasks
    for each row execute function ideworks.task_parent_guard();`);
});

afterAll(() => db.close());

beforeEach(async () => {
  await db.exec(`
    delete from ideworks.task_events;
    delete from ideworks.tasks where parent_id is not null and id = '${NETA}';
    delete from ideworks.tasks where parent_id is not null;
    delete from ideworks.tasks;
    insert into ideworks.tasks(id, list_id, title) values ('${MAE}', '${LISTA}', 'Mãe'), ('${SOLTA}', '${LISTA}', 'Solta');
    insert into ideworks.tasks(id, list_id, parent_id, title) values ('${FILHA}', '${LISTA}', '${MAE}', 'Filha');
    insert into ideworks.tasks(id, list_id, parent_id, title) values ('${NETA}', '${LISTA}', '${FILHA}', 'Neta');
    insert into ideworks.tasks(id, list_id, parent_id, title, archived_at)
      values ('${FILHA_ARQUIVADA}', '${LISTA}', '${MAE}', 'Filha velha', now());
  `);
});

const lerTudo = async (): Promise<TarefaLida[]> =>
  (
    await db.query<Record<string, unknown>>(
      `select id, parent_id, client_id, list_id, title, archived_at is not null as archived from ideworks.tasks`,
    )
  ).rows.map((r) => ({
    id: r.id as string,
    parentId: (r.parent_id as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    listId: r.list_id as string,
    title: r.title as string,
    archived: r.archived === true,
    createdAt: null,
    completedAt: null,
    status: null,
    listName: 'Lista',
    folderName: null,
    listClientId: CLIENTE,
    listRequiresClient: false,
  }));

describe('gravarClienteNaArvore', () => {
  it('o UPDATE direto da mãe é recusado pelo guarda — por isso o desvio existe', async () => {
    await expect(db.query(`update ideworks.tasks set client_id = $1 where id = $2`, [CLIENTE, MAE])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`update ideworks.tasks set client_id = $1 where id = $2`, [CLIENTE, FILHA])).rejects.toMatchObject({ code: '23514' });
  });

  it('grava mãe, filha, neta e filha arquivada juntas, mantém o parentesco e registra o histórico', async () => {
    const arv = montarArvores(await lerTudo());
    const gravados = await gravarClienteNaArvore(
      tx,
      { raizId: MAE, clienteId: CLIENTE, aGravar: arv.noDaArvore(MAE).filter((t) => t.clientId === null), todas: arv.noDaArvore(MAE) },
      { id: CLIENTE, name: 'Fonseca' },
    );
    expect(gravados).toBe(4);
    const depois = (await db.query<{ id: string; parent_id: string | null; client_id: string | null }>('select id, parent_id, client_id from ideworks.tasks')).rows;
    const por = Object.fromEntries(depois.map((r) => [r.id, r]));
    expect(por[MAE]).toMatchObject({ parent_id: null, client_id: CLIENTE });
    expect(por[FILHA]).toMatchObject({ parent_id: MAE, client_id: CLIENTE });
    expect(por[NETA]).toMatchObject({ parent_id: FILHA, client_id: CLIENTE });
    expect(por[FILHA_ARQUIVADA]).toMatchObject({ parent_id: MAE, client_id: CLIENTE });
    expect(por[SOLTA]).toMatchObject({ client_id: null });
    const eventos = (await db.query<{ task_id: string; from_client_id: string | null; to_client_id: string }>('select * from ideworks.task_events')).rows;
    expect(eventos).toHaveLength(4);
    expect(eventos.every((e) => e.from_client_id === null && e.to_client_id === CLIENTE)).toBe(true);
  });

  it('tarefa solta (sem filhas) é gravada direto', async () => {
    const arv = montarArvores(await lerTudo());
    await gravarClienteNaArvore(tx, { raizId: SOLTA, clienteId: OUTRO, aGravar: arv.noDaArvore(SOLTA), todas: arv.noDaArvore(SOLTA) }, { id: OUTRO, name: 'Outro' });
    expect((await db.query<{ client_id: string }>('select client_id from ideworks.tasks where id = $1', [SOLTA])).rows[0]?.client_id).toBe(OUTRO);
  });

  /** Estado que o guarda não deixa criar pelo caminho normal: monta com ele desligado. */
  const semGuarda = async (sql: string) => {
    await db.exec('alter table ideworks.tasks disable trigger tasks_parent_guard');
    try {
      await db.exec(sql);
    } finally {
      await db.exec('alter table ideworks.tasks enable trigger tasks_parent_guard');
    }
  };

  it('mãe já com cliente e filha sem: grava só a filha, sem desligar ninguém', async () => {
    await semGuarda(`update ideworks.tasks set client_id = '${CLIENTE}' where id = '${NETA}'`); // a neta já tem cliente
    await semGuarda(`update ideworks.tasks set client_id = '${CLIENTE}' where id in ('${MAE}', '${FILHA_ARQUIVADA}')`);
    const arv = montarArvores(await lerTudo());
    const todas = arv.noDaArvore(MAE);
    const aGravar = todas.filter((t) => t.clientId === null); // só a filha
    expect(aGravar.map((t) => t.id)).toEqual([FILHA]);
    await gravarClienteNaArvore(tx, { raizId: MAE, clienteId: CLIENTE, aGravar, todas }, { id: CLIENTE, name: 'Fonseca' });
    const filha = (await db.query<{ parent_id: string; client_id: string }>('select parent_id, client_id from ideworks.tasks where id = $1', [FILHA])).rows[0];
    expect(filha).toMatchObject({ parent_id: MAE, client_id: CLIENTE });
  });

  it('filha com OUTRO cliente já gravado: o guarda recusa ao religar, e a transação de quem chama desfaz tudo', async () => {
    await semGuarda(`update ideworks.tasks set client_id = '${OUTRO}' where id = '${FILHA_ARQUIVADA}'`);
    const arv = montarArvores(await lerTudo());
    const todas = arv.noDaArvore(MAE);
    const aGravar = todas.filter((t) => t.clientId === null);
    await db.exec('begin');
    await expect(
      gravarClienteNaArvore(tx, { raizId: MAE, clienteId: CLIENTE, aGravar, todas }, { id: CLIENTE, name: 'Fonseca' }),
    ).rejects.toMatchObject({ code: '23514' });
    await db.exec('rollback');
    const mae = (await db.query<{ client_id: string | null }>('select client_id from ideworks.tasks where id = $1', [MAE])).rows[0];
    expect(mae?.client_id).toBeNull();
    const filha = (await db.query<{ parent_id: string | null }>('select parent_id from ideworks.tasks where id = $1', [FILHA])).rows[0];
    expect(filha?.parent_id).toBe(MAE);
  });
});
