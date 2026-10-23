import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { reorderList } from '@/server/tree';
import type { Sql, Tx } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor: AuthenticatedActor = { userId: id(99), email: 'teste@example.invalid',
  papel: 'super_admin', isSuperadmin: true, isSuper: true, areas: ['quadro'], hasAllClientsAccess: true };
let db: PGlite;
const tx = (async (parts: TemplateStringsArray, ...params: unknown[]) => {
  const query = parts.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, '');
  return (await db.query(query, params)).rows;
}) as unknown as Tx;
const sql = { begin: async (fn: (t: Tx) => Promise<unknown>) => {
  await db.exec('begin; set local role editor;');
  try { const result = await fn(tx); await db.exec('commit'); return result; }
  catch (e) { await db.exec('rollback'); throw e; }
} } as unknown as Sql;
const order = async () => (await db.query<{ id: string }>('select id from ideworks.lists where folder_id=$1 and archived_at is null order by sort_order,name,id',[id(10)])).rows.map(r => r.id);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema ideworks; create role editor; grant usage on schema ideworks to editor;
    create table ideworks.spaces(id uuid primary key, category_id uuid);
    create table ideworks.folders(id uuid primary key, space_id uuid, archived_at timestamptz);
    create table ideworks.lists(id uuid primary key,space_id uuid,folder_id uuid,name text,sort_order int default 0,archived_at timestamptz,updated_at timestamptz);
    create table ideworks.permissions(allowed boolean);
    insert into ideworks.permissions values(true);
    create function ideworks.can_act_on_chain(uuid,uuid,uuid,text) returns boolean language sql as 'select allowed from ideworks.permissions';
    grant select,update on all tables in schema ideworks to editor;
    alter table ideworks.lists enable row level security;
    create policy leitura on ideworks.lists for select to editor using(true);
    create policy escrita on ideworks.lists for update to editor using(name <> 'Bloqueada') with check(name <> 'Bloqueada');
  `);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec(`truncate ideworks.lists,ideworks.folders,ideworks.spaces;
    update ideworks.permissions set allowed=true;
    insert into ideworks.spaces values('${id(1)}',null);
    insert into ideworks.folders values('${id(10)}','${id(1)}',null),('${id(11)}','${id(1)}',null);
    insert into ideworks.lists(id,space_id,folder_id,name) values
      ('${id(20)}','${id(1)}','${id(10)}','A'),
      ('${id(21)}','${id(1)}','${id(10)}','B'),
      ('${id(22)}','${id(1)}','${id(10)}','C'),
      ('${id(23)}','${id(1)}','${id(11)}','Outra pasta');
  `);
});
describe('reorganização persistente das listas', () => {
  it('desempata posições antigas e permite subir/descer sem mudar pasta', async () => {
    await reorderList(sql,actor,id(22),'up');
    expect(await order()).toEqual([id(20),id(22),id(21)]);
    await reorderList(sql,actor,id(22),'down');
    expect(await order()).toEqual([id(20),id(21),id(22)]);
    expect((await db.query('select sort_order from ideworks.lists where id=$1',[id(23)])).rows).toEqual([{sort_order:0}]);
  });
  it('move ao início/final e trata os limites', async () => {
    await reorderList(sql,actor,id(22),'first');
    await reorderList(sql,actor,id(22),'up');
    expect(await order()).toEqual([id(22),id(20),id(21)]);
    await reorderList(sql,actor,id(22),'last');
    await reorderList(sql,actor,id(22),'down');
    expect(await order()).toEqual([id(20),id(21),id(22)]);
  });
  it('recusa direção inválida', async () => {
    await expect(reorderList(sql,actor,id(20),'anything')).rejects.toMatchObject({status:400});
    expect(await order()).toEqual([id(20),id(21),id(22)]);
  });
  it('recusa pasta sem permissão', async () => {
    await db.exec('update ideworks.permissions set allowed=false');
    await expect(reorderList(sql,actor,id(22),'up')).rejects.toMatchObject({status:403});
  });
  it('desfaz todas as posições quando uma escrita é barrada por RLS', async () => {
    await db.query("update ideworks.lists set name='Bloqueada' where id=$1",[id(21)]);
    await expect(reorderList(sql,actor,id(22),'first')).rejects.toMatchObject({status:403});
    expect((await db.query('select distinct sort_order from ideworks.lists')).rows).toEqual([{sort_order:0}]);
  });
  it('não reorganiza arquivadas ou listas sem pasta', async () => {
    await db.query('update ideworks.lists set archived_at=now() where id=$1',[id(22)]);
    await expect(reorderList(sql,actor,id(22),'up')).rejects.toMatchObject({status:404});
    await db.query('update ideworks.lists set folder_id=null where id=$1',[id(20)]);
    await expect(reorderList(sql,actor,id(20),'down')).rejects.toMatchObject({status:404});
  });
});
