/**
 * A TAREFA NASCE COM CLIENTE, CONTRA UM POSTGRES DE VERDADE — F38, Fase 6.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   · As duas migrations da Fase 6, aplicadas de verdade e cada uma duas vezes
 *     (para provar que repetem sem erro), sobre o mínimo de esquema que tocam —
 *     e o `task_parent_guard` da F17.15, copiado da migration dele, para provar
 *     a ordem dos dois gatilhos na subtarefa:
 *       1. `20261007090000_ideworks_f38_lista_exige_cliente.sql` (coluna +
 *          gatilho, nenhuma lista marcada): aplicar já. Só com ela, nada é
 *          bloqueado — a tarefa de lista de cliente herda o cliente e a
 *          ATENDIMENTO continua aceitando tarefa sem cliente;
 *       2. `20261007100000_ideworks_f38_marcar_listas_compartilhadas.sql` (marca
 *          as quatro listas): só junto com a Fase 7. Com ela, as recusas.
 *   · O miolo da escrita do quadro e do MCP (`createBoardTaskInTx`), o MESMO
 *     código do Worker, com o `tx` trocado por um adaptador fino sobre o PGlite.
 *   · A regra de leitura (`clienteDaTarefaSql`) concorda com a de TypeScript
 *     (`clienteDaTarefa`) linha a linha.
 *   · F38, Fase 6.4: o miolo da subtarefa (`createSubtaskInTx`, o do quadro e
 *     do `create_task` com `parentId`) contra o gatilho e o `task_parent_guard`
 *     reais — o cliente que a subtarefa GRAVA, e o que ela LÊ pela regra.
 *
 * O QUE ELE NÃO PROVA
 *   As políticas de linha (RLS): aqui "fora do alcance" é o cliente que não
 *   volta da leitura. Alcance de verdade, sob `ideworks_app`, só no banco de
 *   produção (`scripts/provar-tarefa-nasce-com-cliente.mjs`).
 *
 * NENHUMA REDE
 *   O PGlite roda no próprio processo. A trava da F0.4 continua valendo.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { NewTask } from '@/board/ficha';
import type { NewSubtask } from '@/board/passos';
import { createSubtaskInTx } from '@/server/board-passos';
import { frasesDoEvento, montarHistorico } from '@/board/historico';
import { createBoardTaskInTx, lerHistoricoDaTarefa, setBoardTaskClientInTx } from '@/server/board-task';
import {
  FRASE_LISTA_COMPARTILHADA,
  clienteDaTarefa,
  clienteDaTarefaIdSql,
  clienteDaTarefaJuncao,
  clienteDaTarefaSql,
} from '@/server/cliente-da-tarefa';
import type { Tx } from '@/server/db';

const MIGRATION_REGRA = 'supabase/migrations/20261007090000_ideworks_f38_lista_exige_cliente.sql';
const MIGRATION_MARCA = 'supabase/migrations/20261007100000_ideworks_f38_marcar_listas_compartilhadas.sql';
const MIGRATION_HISTORICO = 'supabase/migrations/20261007110000_ideworks_f38_historico_do_cliente.sql';
const GUARDA_DA_MAE = 'supabase/migrations/20260826100000_ideworks_f17_15_subtarefas_e_checklists.sql';

/* ───────────────────────────── o adaptador ───────────────────────────── */

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

/** O `tx` do driver: etiqueta de template, fragmento aninhado e `await`. */
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

/* ───────────────────────────── o terreno ───────────────────────────── */

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const IDE = id(1);
const FILMES = id(2);
const ESPACO = id(10);
const ESPACO_FILMES = id(11);

const FONSECA = id(20);
const HELP = id(21);
const ZECA = id(22);
const DA_FILMES = id(23);

/** As quatro listas compartilhadas, pelos ids que a migration marca. */
const ATENDIMENTO = 'aaaa0001-0000-4000-8000-000000000001';
const ESTUDIO = 'aaaa0001-0000-4000-8000-000000000002';
const ESTUDIO_IDE = 'aaaa0001-0000-4000-8000-000000000003';
/** Um dos quatro ids, mas COM cliente: a condição `client_id is null` o poupa. */
const JOBS_ANTONELLI = 'aaaa0001-0000-4000-8000-000000000004';
const LISTA_FONSECA = id(30);
const INTERNA = id(31);

const AUTOR = id(99);

const marcas = async () =>
  Object.fromEntries(
    (await db.query<{ id: string; requires_client: boolean }>('select id, requires_client from ideworks.lists')).rows.map(
      (l) => [l.id, l.requires_client],
    ),
  );

const nova = (extra: Partial<NewTask> = {}): NewTask => ({
  title: 'Peça de teste',
  description: null,
  dueOn: null,
  startOn: null,
  priority: null,
  statusId: null,
  customItemId: null,
  assigneeIds: [],
  tagIds: [],
  ...extra,
});

const clienteGravado = async (taskId: string) =>
  (await db.query<{ client_id: string | null }>('select client_id from ideworks.tasks where id = $1', [taskId]))
    .rows[0]?.client_id ?? null;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks;
    create type ideworks.task_priority as enum ('urgent', 'high', 'normal', 'low');
    create type ideworks.task_demand_type as enum ('video', 'arte', 'foto', 'outros');
    create table ideworks.spaces(id uuid primary key, category_id uuid);
    create table ideworks.clients(id uuid primary key, name text, category_id uuid,
      is_active boolean not null default true, inactive_at timestamptz);
    create table ideworks.lists(id uuid primary key, space_id uuid references ideworks.spaces,
      client_id uuid references ideworks.clients, name text, archived_at timestamptz);
    create table ideworks.tasks(id uuid primary key default gen_random_uuid(),
      list_id uuid references ideworks.lists, client_id uuid references ideworks.clients,
      parent_id uuid references ideworks.tasks, title text not null, description text,
      due_on date, start_on date, priority ideworks.task_priority, status_id uuid,
      custom_item_id integer, created_by uuid, updated_at timestamptz,
      demand_type ideworks.task_demand_type);
    -- F40: aqui nenhuma lista é de produção (a regra real tem o próprio teste).
    create function ideworks.list_is_production(uuid) returns boolean language sql as 'select false';
    -- O alcance é o da política; aqui, todo mundo alcança tudo.
    create function ideworks.can_reach_task(uuid, uuid) returns boolean language sql as 'select true';

    insert into ideworks.spaces values ('${ESPACO}', '${IDE}'), ('${ESPACO_FILMES}', '${FILMES}');
    insert into ideworks.clients(id, name, category_id, is_active, inactive_at) values
      ('${FONSECA}', 'Fonseca Moura', '${IDE}', true, null),
      ('${HELP}', 'Hiper Center', '${IDE}', true, null),
      ('${ZECA}', 'Zeca', '${IDE}', false, '2025-12-30 15:00:00-03'),
      ('${DA_FILMES}', 'Cliente da Filmes', '${FILMES}', true, null);
    insert into ideworks.lists(id, space_id, client_id, name) values
      ('${ATENDIMENTO}', '${ESPACO}', null, 'ATENDIMENTO'),
      ('${ESTUDIO}', '${ESPACO}', null, 'ESTÚDIO'),
      ('${ESTUDIO_IDE}', '${ESPACO}', null, 'Estúdio Ide'),
      ('${JOBS_ANTONELLI}', '${ESPACO}', '${HELP}', 'Jobs Antonelli'),
      ('${LISTA_FONSECA}', '${ESPACO}', '${FONSECA}', 'Fonseca Moura Construtora'),
      ('${INTERNA}', '${ESPACO}', null, 'Rotina interna');
  `);

  const guarda = readFileSync(GUARDA_DA_MAE, 'utf8');
  const de = guarda.indexOf('create or replace function ideworks.task_parent_guard(');
  await db.exec(guarda.slice(de, guarda.indexOf('$fn$;', de) + 5));
  await db.exec(`create trigger tasks_parent_guard
    before insert or update of parent_id, list_id, client_id on ideworks.tasks
    for each row execute function ideworks.task_parent_guard();`);

  // Só a primeira migration, duas vezes: ela precisa repetir sem erro. A
  // segunda (a marca das listas) entra no `beforeAll` do bloco que a prova.
  const regra = readFileSync(MIGRATION_REGRA, 'utf8');
  await db.exec(regra);
  await db.exec(regra);
});

afterAll(() => db.close());

beforeEach(async () => {
  // Netas, filhas e mães, nessa ordem (a neta é da Fase 6.4).
  await db.exec(`
    delete from ideworks.tasks where parent_id in (select id from ideworks.tasks where parent_id is not null);
    delete from ideworks.tasks where parent_id is not null;
    delete from ideworks.tasks;`);
});

describe('só a primeira migration (antes da Fase 7)', () => {
  it('a coluna existe e nenhuma lista está marcada', async () => {
    expect(await marcas()).toEqual({
      [ATENDIMENTO]: false,
      [ESTUDIO]: false,
      [ESTUDIO_IDE]: false,
      [JOBS_ANTONELLI]: false,
      [LISTA_FONSECA]: false,
      [INTERNA]: false,
    });
  });

  it('tarefa sem cliente na ATENDIMENTO passa e fica sem cliente (gatilho e quadro/MCP)', async () => {
    const direto = await db.query<{ client_id: string | null }>(
      `insert into ideworks.tasks(list_id, title) values ($1, 'Peça') returning client_id`,
      [ATENDIMENTO],
    );
    expect(direto.rows[0].client_id).toBeNull();
    expect(await clienteGravado(await createBoardTaskInTx(tx, ATENDIMENTO, nova(), AUTOR))).toBeNull();
  });

  it('tarefa sem cliente na lista da Fonseca já herda o cliente', async () => {
    expect(await clienteGravado(await createBoardTaskInTx(tx, LISTA_FONSECA, nova(), AUTOR))).toBe(FONSECA);
  });
});

describe('F38, Fase 6.4 — a subtarefa grava o cliente da mãe (gatilho e guarda reais)', () => {
  const sub = (extra: Partial<NewSubtask> = {}): NewSubtask => ({
    title: 'Passo',
    dueOn: null,
    startOn: null,
    priority: null,
    statusId: null,
    assigneeIds: [],
    tagIds: [],
    ...extra,
  });
  const gravada = async (taskId: string) =>
    (
      await db.query<{ list_id: string | null; client_id: string | null; parent_id: string | null; pela_regra: string | null }>(
        `select t.list_id, t.client_id, t.parent_id,
                coalesce(t.client_id, (select l.client_id from ideworks.lists l where l.id = t.list_id)) as pela_regra
           from ideworks.tasks t where t.id = $1`,
        [taskId],
      )
    ).rows[0];

  it('mãe na lista da Fonseca: a subtarefa grava a lista e o cliente dela, e a neta também', async () => {
    const mae = await createBoardTaskInTx(tx, LISTA_FONSECA, nova(), AUTOR);
    const filha = await createSubtaskInTx(tx, mae, sub(), AUTOR);
    expect(await gravada(filha)).toEqual({ list_id: LISTA_FONSECA, client_id: FONSECA, parent_id: mae, pela_regra: FONSECA });
    const neta = await createSubtaskInTx(tx, filha, sub({ title: 'Neta' }), AUTOR);
    expect(await gravada(neta)).toEqual({ list_id: LISTA_FONSECA, client_id: FONSECA, parent_id: filha, pela_regra: FONSECA });
  });

  it('mãe na ATENDIMENTO com cliente: a subtarefa grava o cliente da mãe, sem ninguém informar', async () => {
    const mae = await createBoardTaskInTx(tx, ATENDIMENTO, nova({ clientId: FONSECA }), AUTOR);
    const filha = await createSubtaskInTx(tx, mae, { ...sub(), description: 'só pelo agente' }, AUTOR);
    expect(await gravada(filha)).toEqual({ list_id: ATENDIMENTO, client_id: FONSECA, parent_id: mae, pela_regra: FONSECA });
  });

  it('mãe legada sem cliente gravado na lista da Fonseca: a filha grava nulo e LÊ a Fonseca pela regra; gravar a Fonseca nela é recusado pelo guarda', async () => {
    await db.exec('alter table ideworks.tasks disable trigger tasks_client_from_list');
    const mae = (
      await db.query<{ id: string }>(`insert into ideworks.tasks(list_id, title) values ($1, 'Legada') returning id`, [LISTA_FONSECA])
    ).rows[0].id;
    await db.exec('alter table ideworks.tasks enable trigger tasks_client_from_list');
    const filha = await createSubtaskInTx(tx, mae, sub(), AUTOR);
    expect(await gravada(filha)).toEqual({ list_id: LISTA_FONSECA, client_id: null, parent_id: mae, pela_regra: FONSECA });
    // Por isso o miolo NÃO manda o cliente: o guarda só aceita o gravado da mãe.
    await expect(
      db.query(`insert into ideworks.tasks(parent_id, client_id, title) values ($1, $2, 'Forçada')`, [mae, FONSECA]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('mãe que não existe: 404, e nada é gravado', async () => {
    await expect(createSubtaskInTx(tx, id(88), sub(), AUTOR)).rejects.toMatchObject({ name: 'BoardRefused', status: 404 });
    expect((await db.query('select count(*)::int as n from ideworks.tasks')).rows).toEqual([{ n: 0 }]);
  });
});

describe('com as listas marcadas (segunda migration, junto com a Fase 7)', () => {
  beforeAll(async () => {
    // A segunda migration, duas vezes: marcar de novo não muda nada nem dá erro.
    const marca = readFileSync(MIGRATION_MARCA, 'utf8');
    await db.exec(marca);
    await db.exec(marca);
  });

  describe('a segunda migration', () => {
    it('marca as listas compartilhadas sem cliente e poupa a lista de cliente e as demais', async () => {
      expect(await marcas()).toEqual({
        [ATENDIMENTO]: true,
        [ESTUDIO]: true,
        [ESTUDIO_IDE]: true,
        [JOBS_ANTONELLI]: false,
        [LISTA_FONSECA]: false,
        [INTERNA]: false,
      });
    });

    it('a coluna nova é obrigatória e nasce falsa', async () => {
      await db.query('insert into ideworks.lists(id, space_id, name) values ($1, $2, $3)', [id(32), ESPACO, 'Nova']);
      const r = await db.query<{ requires_client: boolean }>('select requires_client from ideworks.lists where id = $1', [id(32)]);
      expect(r.rows[0].requires_client).toBe(false);
      await expect(db.query('update ideworks.lists set requires_client = null where id = $1', [id(32)])).rejects.toThrow();
      await db.query('delete from ideworks.lists where id = $1', [id(32)]);
    });
  });

  describe('o gatilho tasks_client_from_list', () => {
    const inserir = (listId: string | null, clientId: string | null = null, parentId: string | null = null) =>
      db.query<{ id: string; client_id: string | null; list_id: string | null }>(
        `insert into ideworks.tasks(list_id, client_id, parent_id, title) values ($1, $2, $3, 'Peça')
         returning id, client_id, list_id`,
        [listId, clientId, parentId],
      );

    it('tarefa sem cliente em lista de cliente herda o cliente da lista', async () => {
      expect((await inserir(LISTA_FONSECA)).rows[0].client_id).toBe(FONSECA);
    });

    it('tarefa sem cliente em lista compartilhada é recusada, com a frase do quadro', async () => {
      await expect(inserir(ATENDIMENTO)).rejects.toMatchObject({ code: '23514', message: FRASE_LISTA_COMPARTILHADA });
    });

    it('lista interna aceita tarefa sem cliente; cliente escolhido fica o escolhido', async () => {
      expect((await inserir(INTERNA)).rows[0].client_id).toBeNull();
      expect((await inserir(ATENDIMENTO, HELP)).rows[0].client_id).toBe(HELP);
    });

    it('subtarefa herda da mãe, e a mãe legada sem cliente na compartilhada não trava a filha', async () => {
      // A mãe antiga, de antes da F38: gravada sem o gatilho.
      await db.exec('alter table ideworks.tasks disable trigger tasks_client_from_list');
      const mae = (await inserir(ATENDIMENTO)).rows[0];
      await db.exec('alter table ideworks.tasks enable trigger tasks_client_from_list');
      const filha = (await inserir(null, null, mae.id)).rows[0];
      expect(filha).toMatchObject({ list_id: ATENDIMENTO, client_id: null });

      const maeComCliente = (await inserir(ATENDIMENTO, HELP)).rows[0];
      expect((await inserir(null, null, maeComCliente.id)).rows[0]).toMatchObject({ list_id: ATENDIMENTO, client_id: HELP });
    });

    it('mover tarefa entre listas não mexe no cliente (só o INSERT dispara)', async () => {
      const t = (await inserir(LISTA_FONSECA)).rows[0];
      await db.query('update ideworks.tasks set list_id = $1 where id = $2', [INTERNA, t.id]);
      expect(await clienteGravado(t.id)).toBe(FONSECA);
    });
  });

  describe('createBoardTaskInTx (quadro e MCP) contra o banco', () => {
    it('lista de cliente: herda; lista interna: fica sem; compartilhada com cliente: grava o escolhido', async () => {
      expect(await clienteGravado(await createBoardTaskInTx(tx, LISTA_FONSECA, nova(), AUTOR))).toBe(FONSECA);
      expect(await clienteGravado(await createBoardTaskInTx(tx, INTERNA, nova(), AUTOR))).toBeNull();
      expect(await clienteGravado(await createBoardTaskInTx(tx, ATENDIMENTO, nova({ clientId: HELP }), AUTOR))).toBe(HELP);
      // O mesmo cliente da lista, informado, passa.
      expect(
        await clienteGravado(await createBoardTaskInTx(tx, LISTA_FONSECA, nova({ clientId: FONSECA }), AUTOR)),
      ).toBe(FONSECA);
    });

    it('compartilhada sem cliente: 400 com a frase do quadro, e nada é gravado', async () => {
      await expect(createBoardTaskInTx(tx, ATENDIMENTO, nova(), AUTOR)).rejects.toMatchObject({
        name: 'BoardRefused',
        status: 400,
        message: FRASE_LISTA_COMPARTILHADA,
      });
      expect((await db.query('select count(*)::int as n from ideworks.tasks')).rows).toEqual([{ n: 0 }]);
    });

    it('cliente cancelado: 400 dizendo que está cancelado e desde quando (dia de São Paulo)', async () => {
      await expect(createBoardTaskInTx(tx, ATENDIMENTO, nova({ clientId: ZECA }), AUTOR)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('O cliente Zeca foi cancelado em 30/12/2025'),
      });
    });

    it('cliente que não volta da leitura (ou id torto): 403; outro cliente em lista de cliente e outra empresa: 400', async () => {
      await expect(createBoardTaskInTx(tx, ATENDIMENTO, nova({ clientId: id(77) }), AUTOR)).rejects.toMatchObject({
        status: 403,
      });
      await expect(createBoardTaskInTx(tx, ATENDIMENTO, nova({ clientId: 'zeca' }), AUTOR)).rejects.toMatchObject({
        status: 403,
      });
      await expect(createBoardTaskInTx(tx, LISTA_FONSECA, nova({ clientId: HELP }), AUTOR)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('outro cliente'),
      });
      await expect(createBoardTaskInTx(tx, ATENDIMENTO, nova({ clientId: DA_FILMES }), AUTOR)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('outra empresa'),
      });
      expect((await db.query('select count(*)::int as n from ideworks.tasks')).rows).toEqual([{ n: 0 }]);
    });

    it('lista que não existe: 403, a recusa de antes', async () => {
      await expect(createBoardTaskInTx(tx, id(88), nova(), AUTOR)).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe('a regra de leitura, uma só', () => {
  it('clienteDaTarefaSql concorda com clienteDaTarefa em toda combinação', async () => {
    await db.exec('alter table ideworks.tasks disable trigger tasks_client_from_list');
    await db.query(
      `insert into ideworks.tasks(id, list_id, client_id, title) values
         ($1, $5, null, 'herdada'),   -- só a lista tem
         ($2, $5, $7, 'escolhida'),   -- a da tarefa vence a da lista
         ($3, $6, $7, 'na compartilhada'),
         ($4, $6, null, 'sem nenhum')`,
      [id(60), id(61), id(62), id(63), LISTA_FONSECA, ATENDIMENTO, HELP],
    );
    await db.exec('alter table ideworks.tasks enable trigger tasks_client_from_list');

    const linhas = (await tx`
      select t.id, t.client_id as da_tarefa, l.client_id as da_lista,
             ${clienteDaTarefaSql(tx)} as pela_regra
        from ideworks.tasks t
        left join ideworks.lists l on l.id = t.list_id
       order by t.id`) as unknown as Array<{
      id: string;
      da_tarefa: string | null;
      da_lista: string | null;
      pela_regra: string | null;
    }>;
    expect(linhas).toHaveLength(4);
    for (const l of linhas) expect(l.pela_regra).toBe(clienteDaTarefa(l.da_tarefa, l.da_lista));
    expect(Object.fromEntries(linhas.map((l) => [l.id, l.pela_regra]))).toEqual({
      [id(60)]: FONSECA,
      [id(61)]: HELP,
      [id(62)]: HELP,
      [id(63)]: null,
    });

    // F38, Fase 6.1 — a mesma regra como junção (`clienteDaTarefaJuncao`),
    // usada pelas leituras do MCP: concorda linha a linha com a subconsulta, e
    // a junção não multiplica nem some com linha (inclusive tarefa sem lista).
    await db.exec('alter table ideworks.tasks disable trigger tasks_client_from_list');
    await db.query(`insert into ideworks.tasks(id, list_id, client_id, title) values ($1, null, $2, 'sem lista'), ($3, null, null, 'nada')`, [
      id(64),
      ZECA,
      id(65),
    ]);
    await db.exec('alter table ideworks.tasks enable trigger tasks_client_from_list');
    const pelaJuncao = (await tx`
      select t.id, ${clienteDaTarefaSql(tx)} as pela_subconsulta, ${clienteDaTarefaIdSql(tx)} as pela_juncao
        from ideworks.tasks t
        ${clienteDaTarefaJuncao(tx)}
       order by t.id`) as unknown as Array<{ id: string; pela_subconsulta: string | null; pela_juncao: string | null }>;
    expect(pelaJuncao).toHaveLength(6);
    for (const l of pelaJuncao) expect(l.pela_juncao).toBe(l.pela_subconsulta);
    expect(Object.fromEntries(pelaJuncao.map((l) => [l.id, l.pela_juncao]))).toMatchObject({
      [id(60)]: FONSECA,
      [id(63)]: null,
      [id(64)]: ZECA,
      [id(65)]: null,
    });
  });
});

describe('F38, Fase 7 — trocar o cliente no cartão (setBoardTaskClientInTx, o miolo da rota)', () => {
  beforeAll(async () => {
    // A ATENDIMENTO compartilhada, como fica depois da migration da marca.
    await db.query('update ideworks.lists set requires_client = true where id = $1', [ATENDIMENTO]);

    // O livro da tarefa, no mínimo que a migration do histórico e a leitura
    // tocam, e a migration REAL por cima — duas vezes, para provar que repete.
    await db.exec(`
      create table ideworks.statuses(id uuid primary key, name text);
      create table ideworks.task_events(
        id bigint generated always as identity primary key,
        task_id uuid not null references ideworks.tasks(id) on delete cascade,
        automation_id uuid, automation_name text,
        from_list_id uuid references ideworks.lists(id) on delete set null,
        to_list_id uuid references ideworks.lists(id) on delete set null,
        from_status_id uuid references ideworks.statuses(id) on delete set null,
        to_status_id uuid references ideworks.statuses(id) on delete set null,
        from_list_name text, to_list_name text, from_status_name text, to_status_name text,
        removed_user_ids uuid[] not null default '{}'::uuid[],
        added_user_ids uuid[] not null default '{}'::uuid[],
        added_user_id uuid, actor_id uuid, via_name text,
        occurred_at timestamptz not null default clock_timestamp()
      );
      create function ideworks.acting_user_id() returns uuid language sql as 'select ''${AUTOR}''::uuid';
      create function ideworks.display_name(uuid) returns text language sql as 'select ''Wesley''::text';
    `);
    const historico = readFileSync(MIGRATION_HISTORICO, 'utf8');
    await db.exec(historico);
    await db.exec(historico);
  });

  const eventos = async (taskId: string) =>
    (
      await db.query<{ from_client_id: string | null; to_client_id: string | null; from_client_name: string | null; to_client_name: string | null; actor_id: string | null; automation_name: string | null }>(
        `select from_client_id, to_client_id, from_client_name, to_client_name, actor_id, automation_name
           from ideworks.task_events where task_id = $1 order by id`,
        [taskId],
      )
    ).rows;

  const criar = async (lista: string, cliente: string | null = null, mae: string | null = null) =>
    (
      await db.query<{ id: string }>(
        'insert into ideworks.tasks(list_id, client_id, parent_id, title) values ($1, $2, $3, $4) returning id',
        [mae ? null : lista, cliente, mae, 'Peça'],
      )
    ).rows[0].id;

  it('lista compartilhada: troca por outro cliente ativo; "sem cliente" é recusado e nada muda', async () => {
    const t = await criar(ATENDIMENTO, FONSECA);
    await setBoardTaskClientInTx(tx, t, HELP);
    expect(await clienteGravado(t)).toBe(HELP);
    await expect(setBoardTaskClientInTx(tx, t, null)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Esta lista é compartilhada'),
    });
    expect(await clienteGravado(t)).toBe(HELP);
  });

  it('cancelado, outra empresa e fora do alcance são recusados com a frase da troca', async () => {
    const t = await criar(ATENDIMENTO, FONSECA);
    await expect(setBoardTaskClientInTx(tx, t, ZECA)).rejects.toMatchObject({
      status: 400,
      message: 'O cliente Zeca foi cancelado em 30/12/2025: escolha um cliente ativo. Nada foi gravado.',
    });
    await expect(setBoardTaskClientInTx(tx, t, DA_FILMES)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('outra empresa'),
    });
    await expect(setBoardTaskClientInTx(tx, t, id(77))).rejects.toMatchObject({ status: 403 });
    expect(await clienteGravado(t)).toBe(FONSECA);
  });

  it('lista interna: escolhe cliente e volta a "interna, sem cliente"', async () => {
    const t = await criar(INTERNA);
    await setBoardTaskClientInTx(tx, t, HELP);
    expect(await clienteGravado(t)).toBe(HELP);
    await setBoardTaskClientInTx(tx, t, null);
    expect(await clienteGravado(t)).toBeNull();
  });

  it('lista de cliente: outro cliente é recusado; a tarefa movida com o cliente antigo volta ao da lista', async () => {
    const herdada = await criar(LISTA_FONSECA);
    expect(await clienteGravado(herdada)).toBe(FONSECA);
    await expect(setBoardTaskClientInTx(tx, herdada, HELP)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('mova a tarefa para a lista do cliente escolhido'),
    });
    expect(await clienteGravado(herdada)).toBe(FONSECA);

    // A tarefa que veio de outra lista com o cliente dela (caso de borda).
    const movida = await criar(LISTA_FONSECA, HELP);
    expect(await clienteGravado(movida)).toBe(HELP);
    await setBoardTaskClientInTx(tx, movida, null);
    expect(await clienteGravado(movida)).toBe(FONSECA);
  });

  it('subtarefa e mãe com subtarefa: recusa com motivo, antes do guarda do banco', async () => {
    const mae = await criar(ATENDIMENTO, FONSECA);
    const filha = await criar(ATENDIMENTO, null, mae);
    expect(await clienteGravado(filha)).toBe(FONSECA);
    await expect(setBoardTaskClientInTx(tx, filha, HELP)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Subtarefa usa o cliente da tarefa-mãe'),
    });
    await expect(setBoardTaskClientInTx(tx, mae, HELP)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('tem subtarefas'),
    });
    expect(await clienteGravado(mae)).toBe(FONSECA);
  });

  it('tarefa que não existe: 404', async () => {
    await expect(setBoardTaskClientInTx(tx, id(55), HELP)).rejects.toMatchObject({ status: 404 });
  });

  it('trocar o cliente grava UM evento com antes, depois, nomes e quem fez; a ficha o lê e a frase sai', async () => {
    const t = await criar(ATENDIMENTO, FONSECA);
    await setBoardTaskClientInTx(tx, t, HELP);
    expect(await eventos(t)).toEqual([
      {
        from_client_id: FONSECA,
        to_client_id: HELP,
        from_client_name: 'Fonseca Moura',
        to_client_name: 'Hiper Center',
        actor_id: AUTOR,
        automation_name: null,
      },
    ]);
    const lido = await lerHistoricoDaTarefa(tx, t);
    expect(lido).toHaveLength(1);
    expect(lido[0]).toMatchObject({ fromClientName: 'Fonseca Moura', toClientName: 'Hiper Center', automationName: null, actorName: 'Wesley' });
    expect(frasesDoEvento(lido[0])).toEqual(['trocou o cliente de Fonseca Moura para Hiper Center']);
    const linha = montarHistorico({ criadaPor: null, criadaEm: '2026-10-07T10:00:00Z', eventos: lido, falas: [] });
    expect(linha).toMatchObject([{ tipo: 'evento', quem: 'Wesley', frases: ['trocou o cliente de Fonseca Moura para Hiper Center'] }]);
  });

  it('pedir o cliente que a tarefa já tem não grava evento', async () => {
    const t = await criar(ATENDIMENTO, FONSECA);
    await setBoardTaskClientInTx(tx, t, FONSECA);
    expect(await eventos(t)).toEqual([]);
    // "Usar o da lista" quando o cliente já é o da lista também não muda nada.
    const herdada = await criar(LISTA_FONSECA);
    await setBoardTaskClientInTx(tx, herdada, null);
    expect(await eventos(herdada)).toEqual([]);
  });

  it('recusa não grava evento', async () => {
    const t = await criar(ATENDIMENTO, FONSECA);
    await expect(setBoardTaskClientInTx(tx, t, null)).rejects.toMatchObject({ status: 400 });
    expect(await eventos(t)).toEqual([]);
  });

  it('lista interna: "definiu" ao escolher e "tirou" ao voltar a sem cliente', async () => {
    const t = await criar(INTERNA);
    await setBoardTaskClientInTx(tx, t, HELP);
    await setBoardTaskClientInTx(tx, t, null);
    const lido = await lerHistoricoDaTarefa(tx, t);
    expect(lido.map((e) => frasesDoEvento(e))).toEqual([['definiu o cliente Hiper Center'], ['tirou o cliente Hiper Center']]);
  });

  it('cliente apagado: o id do "depois" vira nulo e o nome gravado (paraquedas) segura a frase', async () => {
    const efemero = id(40);
    await db.query(`insert into ideworks.clients(id, name, category_id) values ($1, 'Cliente Efêmero', $2)`, [efemero, IDE]);
    const t = await criar(ATENDIMENTO, FONSECA);
    await setBoardTaskClientInTx(tx, t, efemero);
    await setBoardTaskClientInTx(tx, t, HELP);
    // Sem o evento "Efêmero -> Help" a tarefa ainda aponta para o cliente; o
    // evento 1 (Fonseca -> Efêmero) perde só o id do "depois".
    await db.query('update ideworks.tasks set client_id = $2 where id = $1', [t, HELP]);
    await db.query('delete from ideworks.clients where id = $1', [efemero]);
    expect((await eventos(t)).map((e) => [e.from_client_id, e.to_client_id])).toEqual([
      [FONSECA, null],
      [null, HELP],
    ]);
    const lido = await lerHistoricoDaTarefa(tx, t);
    expect(lido.map((e) => frasesDoEvento(e))).toEqual([
      ['trocou o cliente de Fonseca Moura para Cliente Efêmero'],
      ['trocou o cliente de Cliente Efêmero para Hiper Center'],
    ]);
  });

  // ⚠️ ACHADO: as duas chaves são `on delete set null`, e o `task_events_says_something`
  // é reavaliado na linha que ficou. Evento de UM lado só ("definiu"/"tirou") ou
  // cliente que já perdeu o outro lado vira (nulo, nulo) e o banco RECUSA apagar o
  // cliente. Hoje ninguém apaga cliente (inativo = cancelado), então o efeito é só
  // este: cliente com evento deixa de ser apagável. A correção, se um dia for
  // preciso, é a check aceitar também `from_client_name is distinct from to_client_name`.
  it('cliente com evento de um lado só não pode ser apagado (achado da migration)', async () => {
    const efemero = id(41);
    await db.query(`insert into ideworks.clients(id, name, category_id) values ($1, 'Outro Efêmero', $2)`, [efemero, IDE]);
    const t = await criar(INTERNA);
    await setBoardTaskClientInTx(tx, t, efemero);
    await db.query('update ideworks.tasks set client_id = null where id = $1', [t]);
    await expect(db.query('delete from ideworks.clients where id = $1', [efemero])).rejects.toMatchObject({ code: '23514' });
  });

  it('a faxina grava o mesmo formato (de nulo para o cliente, nome só no "depois") e a leitura entende', async () => {
    const t = await criar(INTERNA);
    await db.query(
      `insert into ideworks.task_events (task_id, automation_name, from_client_id, to_client_id, from_client_name, to_client_name, actor_id)
       values ($1, null, null, $2, null, 'Hiper Center', ideworks.acting_user_id())`,
      [t, HELP],
    );
    const [e] = await lerHistoricoDaTarefa(tx, t);
    expect(frasesDoEvento(e)).toEqual(['definiu o cliente Hiper Center']);
  });

  it('o banco aceita a linha que só troca o cliente e continua recusando a linha em branco', async () => {
    const t = await criar(INTERNA);
    await expect(db.query('insert into ideworks.task_events(task_id, automation_name) values ($1, null)', [t])).rejects.toMatchObject({
      code: '23514',
    });
  });
});
