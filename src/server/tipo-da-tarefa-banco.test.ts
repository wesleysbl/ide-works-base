/**
 * O TIPO DA TAREFA, CONTRA UM POSTGRES DE VERDADE — F40, Fase 1.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   A migration `20261007130000_ideworks_f40_tipo_da_tarefa.sql`, aplicada de
 *   verdade e duas vezes, sobre o mínimo de esquema que ela toca (e a
 *   `resolve_status_set` da F17.2, copiada da migration dela, para a esteira
 *   efetiva ser a do sistema):
 *     · `list_is_production` acha a etapa "atribuir demanda" na esteira da
 *       lista, da pasta e do espaço, sem acento e sem maiúscula;
 *     · INSERT sem tipo em lista de produção é recusado (IW040, type_required);
 *       em lista interna passa;
 *     · apagar o tipo escolhido é recusado;
 *     · card antigo sem tipo continua editável em outros campos;
 *     · mover de lista interna para lista de produção sem tipo é recusado.
 *
 * NENHUMA REDE: o PGlite roda no próprio processo.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const MIGRATION = 'supabase/migrations/20261007130000_ideworks_f40_tipo_da_tarefa.sql';
const MIGRATION_2 = 'supabase/migrations/20261007140000_ideworks_f40_tipo_obrigatorio.sql';
const ROLLBACK = 'supabase/rollback/20261007130000_ideworks_f40_tipo_da_tarefa.sql';
const ROLLBACK_2 = 'supabase/rollback/20261007140000_ideworks_f40_tipo_obrigatorio.sql';
const ESTEIRAS = 'supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const ESPACO_A = id(1); // esteira do espaço COM "atribuir demanda"
const ESPACO_B = id(2); // esteira do espaço SEM
const PASTA_B = id(3); // pasta do espaço B, com esteira própria COM a etapa
const LISTA_ESPACO = id(10); // herda do espaço A -> produção
const LISTA_PASTA = id(11); // herda da pasta B -> produção
const LISTA_PROPRIA = id(12); // esteira própria sem a etapa, dentro da pasta B -> interna
const LISTA_INTERNA = id(13); // herda do espaço B -> interna
const LISTA_ACENTO = id(14); // esteira própria "Atribuir Demanda" maiúscula -> produção
const LISTA_ACENTUADA = id(15); // esteira própria "ATRIBUIR  DEMANDA " com espaços -> NÃO (dois espaços)
const LISTA_SO_ACENTO = id(16); // esteira própria com nome acentuado diferente -> interna

const db = new PGlite();

const inserir = (listId: string | null, tipo: string | null = null, parentId: string | null = null) =>
  db.query<{ id: string; demand_type: string | null }>(
    `insert into ideworks.tasks(list_id, demand_type, parent_id, title) values ($1, $2, $3, 'Peça')
     returning id, demand_type`,
    [listId, tipo, parentId],
  );

const eProducao = async (listId: string) =>
  (await db.query<{ p: boolean }>('select ideworks.list_is_production($1) as p', [listId])).rows[0].p;

beforeAll(async () => {
  await db.exec(`
    create schema ideworks;
    create table ideworks.spaces(id uuid primary key);
    create table ideworks.folders(id uuid primary key, space_id uuid references ideworks.spaces);
    create table ideworks.lists(id uuid primary key, space_id uuid references ideworks.spaces,
      folder_id uuid references ideworks.folders, name text);
    create table ideworks.status_sets(id uuid primary key default gen_random_uuid(),
      space_id uuid references ideworks.spaces, folder_id uuid references ideworks.folders,
      list_id uuid references ideworks.lists, name text);
    create table ideworks.statuses(id uuid primary key default gen_random_uuid(),
      status_set_id uuid not null references ideworks.status_sets, name text not null);
    create table ideworks.tasks(id uuid primary key default gen_random_uuid(),
      list_id uuid references ideworks.lists, parent_id uuid references ideworks.tasks,
      title text not null, description text);

    insert into ideworks.spaces values ('${ESPACO_A}'), ('${ESPACO_B}');
    insert into ideworks.folders values ('${PASTA_B}', '${ESPACO_B}');
    insert into ideworks.lists(id, space_id, folder_id, name) values
      ('${LISTA_ESPACO}', '${ESPACO_A}', null, 'Cliente A'),
      ('${LISTA_PASTA}', '${ESPACO_B}', '${PASTA_B}', 'Cliente pasta'),
      ('${LISTA_PROPRIA}', '${ESPACO_B}', '${PASTA_B}', 'Própria'),
      ('${LISTA_INTERNA}', '${ESPACO_B}', null, 'Interna'),
      ('${LISTA_ACENTO}', '${ESPACO_B}', null, 'Maiúscula'),
      ('${LISTA_ACENTUADA}', '${ESPACO_B}', null, 'Dois espaços'),
      ('${LISTA_SO_ACENTO}', '${ESPACO_B}', null, 'Parecida');
  `);

  const conjunto = (owner: 'space_id' | 'folder_id' | 'list_id', dono: string, etapas: string[]) =>
    `with s as (insert into ideworks.status_sets(${owner}, name) values ('${dono}', 'Esteira') returning id)
     insert into ideworks.statuses(status_set_id, name) select s.id, e from s, unnest(array[${etapas
       .map((e) => `'${e}'`)
       .join(',')}]) e;`;

  await db.exec(conjunto('space_id', ESPACO_A, ['a fazer', 'atribuir demanda', 'feito']));
  await db.exec(conjunto('space_id', ESPACO_B, ['a fazer', 'feito']));
  await db.exec(conjunto('folder_id', PASTA_B, ['A fazer', 'Atribuir Demanda', 'Feito']));
  await db.exec(conjunto('list_id', LISTA_PROPRIA, ['a fazer', 'feito']));
  await db.exec(conjunto('list_id', LISTA_ACENTO, ['A fazer', 'ATRIBUIR DEMANDA']));
  await db.exec(conjunto('list_id', LISTA_ACENTUADA, ['atribuir  demanda']));
  await db.exec(conjunto('list_id', LISTA_SO_ACENTO, ['Atribuição de demanda']));

  const esteiras = readFileSync(ESTEIRAS, 'utf8');
  const de = esteiras.indexOf('create or replace function ideworks.resolve_status_set(');
  await db.exec(esteiras.slice(de, esteiras.indexOf('$fn$;', de) + 5));

  // Parte 1, duas vezes: precisa repetir sem erro.
  const migration = readFileSync(MIGRATION, 'utf8');
  await db.exec(migration);
  await db.exec(migration);
});

/** Parte 2 (o gatilho), duas vezes. Só entra no bloco que a prova. */
const aplicarParte2 = async () => {
  const m2 = readFileSync(MIGRATION_2, 'utf8');
  await db.exec(m2);
  await db.exec(m2);
};

afterAll(() => db.close());

beforeEach(async () => {
  await db.exec('delete from ideworks.tasks where parent_id is not null; delete from ideworks.tasks;');
});

describe('list_is_production', () => {
  it('acha a etapa na esteira do espaço', async () => {
    expect(await eProducao(LISTA_ESPACO)).toBe(true);
  });

  it('acha a etapa na esteira da pasta, sem ligar para maiúscula', async () => {
    expect(await eProducao(LISTA_PASTA)).toBe(true);
  });

  it('acha a etapa na esteira própria da lista, em maiúsculas', async () => {
    expect(await eProducao(LISTA_ACENTO)).toBe(true);
  });

  it('a esteira própria manda: lista dentro de pasta com a etapa, mas esteira própria sem ela, é interna', async () => {
    expect(await eProducao(LISTA_PROPRIA)).toBe(false);
  });

  it('lista que herda esteira sem a etapa é interna; nome parecido não vale', async () => {
    expect(await eProducao(LISTA_INTERNA)).toBe(false);
    expect(await eProducao(LISTA_ACENTUADA)).toBe(false);
    expect(await eProducao(LISTA_SO_ACENTO)).toBe(false);
  });

  it('lista que não existe é interna, sem erro', async () => {
    expect(await eProducao(id(999))).toBe(false);
  });

  it('ignora acento: "Atribuir Demanda" com acento fantasia também é reconhecido', async () => {
    await db.exec(`update ideworks.statuses set name = 'Átribuír Démandá'
      where status_set_id in (select id from ideworks.status_sets where list_id = '${LISTA_ACENTO}')
        and name = 'ATRIBUIR DEMANDA'`);
    expect(await eProducao(LISTA_ACENTO)).toBe(true);
    await db.exec(`update ideworks.statuses set name = 'ATRIBUIR DEMANDA' where name = 'Átribuír Démandá'`);
  });
});

describe('só a parte 1 (antes da publicação do Worker)', () => {
  it('inserir sem tipo em lista de produção passa; list_is_production já responde', async () => {
    expect(await eProducao(LISTA_ESPACO)).toBe(true);
    expect((await inserir(LISTA_ESPACO)).rows[0].demand_type).toBeNull();
    expect((await inserir(LISTA_PASTA)).rows[0].demand_type).toBeNull();
  });
});

describe('o gatilho tasks_demand_type_guard (parte 2)', () => {
  beforeAll(aplicarParte2);

  it('INSERT sem tipo em lista de produção é recusado, com o código e a frase', async () => {
    for (const lista of [LISTA_ESPACO, LISTA_PASTA, LISTA_ACENTO]) {
      await expect(inserir(lista)).rejects.toMatchObject({
        code: 'IW040',
        hint: 'type_required',
        message: expect.stringContaining('Esta lista é de produção'),
      });
    }
    expect((await db.query('select count(*)::int as n from ideworks.tasks')).rows).toEqual([{ n: 0 }]);
  });

  it('INSERT com tipo em lista de produção passa e grava o tipo', async () => {
    expect((await inserir(LISTA_ESPACO, 'arte')).rows[0].demand_type).toBe('arte');
  });

  it('INSERT sem tipo em lista interna passa, com ou sem tipo', async () => {
    expect((await inserir(LISTA_INTERNA)).rows[0].demand_type).toBeNull();
    expect((await inserir(LISTA_PROPRIA, 'foto')).rows[0].demand_type).toBe('foto');
  });

  it('tipo fora dos quatro valores é recusado pelo enum', async () => {
    await expect(inserir(LISTA_INTERNA, 'musica')).rejects.toThrow();
  });

  it('subtarefa e tarefa sem lista passam sem tipo', async () => {
    const mae = (await inserir(LISTA_ESPACO, 'video')).rows[0].id;
    expect((await inserir(null, null, mae)).rows[0].demand_type).toBeNull();
    expect((await inserir(null)).rows[0].demand_type).toBeNull();
  });

  it('apagar o tipo escolhido em lista de produção é recusado; trocar por outro passa', async () => {
    const t = (await inserir(LISTA_ESPACO, 'video')).rows[0].id;
    await expect(db.query('update ideworks.tasks set demand_type = null where id = $1', [t])).rejects.toMatchObject({
      code: 'IW040',
      hint: 'type_required',
    });
    await db.query(`update ideworks.tasks set demand_type = 'foto' where id = $1`, [t]);
    expect((await db.query('select demand_type from ideworks.tasks where id = $1', [t])).rows[0]).toEqual({
      demand_type: 'foto',
    });
  });

  it('apagar o tipo em lista interna passa', async () => {
    const t = (await inserir(LISTA_INTERNA, 'video')).rows[0].id;
    await db.query('update ideworks.tasks set demand_type = null where id = $1', [t]);
  });

  it('card antigo sem tipo em lista de produção continua editável em outros campos e mudável de lista de produção', async () => {
    // Gravado antes do gatilho existir (o card de antes da F40).
    await db.exec('alter table ideworks.tasks disable trigger tasks_demand_type_guard');
    const t = (await inserir(LISTA_ESPACO)).rows[0].id;
    await db.exec('alter table ideworks.tasks enable trigger tasks_demand_type_guard');

    await db.query(`update ideworks.tasks set title = 'Novo título', description = 'x' where id = $1`, [t]);
    // Reafirmar a mesma lista e mover entre duas listas de produção não exige tipo.
    await db.query('update ideworks.tasks set list_id = $2 where id = $1', [t, LISTA_ESPACO]);
    await db.query('update ideworks.tasks set list_id = $2 where id = $1', [t, LISTA_PASTA]);
    const r = await db.query<{ title: string; demand_type: string | null }>(
      'select title, demand_type from ideworks.tasks where id = $1',
      [t],
    );
    expect(r.rows[0]).toEqual({ title: 'Novo título', demand_type: null });
  });

  it('mover de lista interna para lista de produção sem tipo é recusado; com tipo passa', async () => {
    const t = (await inserir(LISTA_INTERNA)).rows[0].id;
    await expect(db.query('update ideworks.tasks set list_id = $2 where id = $1', [t, LISTA_ESPACO])).rejects.toMatchObject({
      code: 'IW040',
      hint: 'type_required',
    });
    await db.query(`update ideworks.tasks set list_id = $2, demand_type = 'outros' where id = $1`, [t, LISTA_ESPACO]);
    expect((await db.query('select demand_type from ideworks.tasks where id = $1', [t])).rows[0]).toEqual({
      demand_type: 'outros',
    });
  });

  it('mover de lista interna com tipo para lista de produção mantém o tipo e passa', async () => {
    const t = (await inserir(LISTA_INTERNA, 'arte')).rows[0].id;
    await db.query('update ideworks.tasks set list_id = $2 where id = $1', [t, LISTA_PASTA]);
  });
});

describe('o rollback', () => {
  it('desfaz tudo e pode ser repetido; a migration volta a aplicar depois', async () => {
    const rollback = readFileSync(ROLLBACK, 'utf8');
    const rollback2 = readFileSync(ROLLBACK_2, 'utf8');
    await db.exec(rollback2);
    await db.exec(rollback2);
    await db.exec(rollback);
    await db.exec(rollback);
    const resto = await db.query<{ n: number }>(
      `select (select count(*) from pg_proc where proname in ('list_is_production','task_demand_type_guard'))
            + (select count(*) from information_schema.columns where table_name = 'tasks' and column_name = 'demand_type')
            + (select count(*) from pg_type where typname = 'task_demand_type') as n`,
    );
    expect(Number(resto.rows[0].n)).toBe(0);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    await aplicarParte2();
  });
});
