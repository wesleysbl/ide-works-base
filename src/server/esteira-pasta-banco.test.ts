import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';

const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let db:PGlite;
const states=[{name:'A fazer',type:'open',color:'#888888'},{name:'Concluído',type:'closed',color:'#00aa00'}];
const call=async(input:unknown=null)=> {
  const r=await db.query<{r:Record<string,unknown>}>('select ideworks.folder_workflow($1,$2::jsonb) r',[id(10),input===null?null:JSON.stringify(input)]);
  return r.rows[0].r;
};
const save=async(extra:Record<string,unknown>={})=>call({name:'Padrão da pasta',statuses:states,revision:(await call()).revision,...extra});
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create schema ideworks; create role anon; create role authenticated; create role ideworks_app;
    create type ideworks.status_type as enum('open','unstarted','custom','done','closed');
    create table ideworks.folders(id uuid primary key,space_id uuid);
    create table ideworks.lists(id uuid primary key,folder_id uuid references ideworks.folders,space_id uuid,archived_at timestamptz,name text default 'Lista');
    create table ideworks.status_sets(id uuid primary key default gen_random_uuid(),space_id uuid,folder_id uuid,list_id uuid,
      name text,source_id text,created_by uuid,updated_at timestamptz);
    create unique index folder_set on ideworks.status_sets(folder_id);
    create unique index list_set on ideworks.status_sets(list_id);
    create table ideworks.statuses(id uuid primary key default gen_random_uuid(),status_set_id uuid references ideworks.status_sets on delete cascade,
      name text,type ideworks.status_type,color text,sort_order int,source_id text,updated_at timestamptz);
    create unique index status_name on ideworks.statuses(status_set_id,lower(name));
    create unique index one_closed on ideworks.statuses(status_set_id) where type='closed';
    create table ideworks.tasks(id uuid primary key,list_id uuid references ideworks.lists,client_id uuid,
      status_id uuid constraint tasks_status_fk references ideworks.statuses on delete restrict,updated_at timestamptz,completed_at timestamptz,completed_by uuid);
    create table ideworks.automation_stages(list_id uuid,status_id uuid references ideworks.statuses on delete cascade,stage smallint,
      primary key(list_id,status_id),unique(list_id,status_id,stage));
    create table ideworks.task_automations(id uuid primary key,source_list_id uuid,trigger_status_id uuid,
      source_stage smallint default 0,target_list_id uuid,target_status_id uuid,target_stage smallint default 1,
      foreign key(source_list_id,trigger_status_id,source_stage) references ideworks.automation_stages(list_id,status_id,stage),
      foreign key(target_list_id,target_status_id,target_stage) references ideworks.automation_stages(list_id,status_id,stage),
      unique(source_list_id,trigger_status_id));
    create table ideworks.denied(id uuid);
    create function ideworks.acting_user_id() returns uuid language sql as 'select null::uuid';
    create function ideworks.can_act_on_chain(uuid,uuid,uuid,text) returns boolean language sql as
      'select not exists(select 1 from ideworks.denied where id=coalesce($3,$2,$1))';
    create function ideworks.can_act_on_task(uuid,uuid,text) returns boolean language sql as
      'select not exists(select 1 from ideworks.denied where id=$2)';
    create function ideworks.resolve_status_set(lid uuid) returns uuid language sql as $$
      select ss.id from ideworks.status_sets ss join ideworks.lists l on l.id=lid
      where ss.list_id=l.id or ss.folder_id=l.folder_id or ss.space_id=l.space_id
      order by (ss.list_id is not null) desc,(ss.folder_id is not null) desc limit 1 $$;
    create function ideworks.check_tasks() returns trigger language plpgsql as $$
      begin
        if exists(select 1 from ideworks.tasks t join ideworks.statuses s on s.id=t.status_id
          where s.status_set_id<>ideworks.resolve_status_set(t.list_id)) then
          raise exception 'Tarefa fora da esteira'; end if;
        return null;
      end $$;
    create constraint trigger scope_guard after update on ideworks.tasks deferrable initially deferred
      for each row execute function ideworks.check_tasks();
  `);
  const original=readFileSync('supabase/migrations/20260824170000_ideworks_f17_2_esteiras.sql','utf8');
  const from=original.indexOf('create or replace function ideworks.create_status_set(');
  await db.exec(original.slice(from,original.indexOf('$fn$;',from)+6));
  const guard=readFileSync('supabase/migrations/20260825130000_ideworks_f17_3c_invariante_do_status.sql','utf8');
  const guardFrom=guard.indexOf('create or replace function ideworks.task_status_guard(');
  await db.exec(guard.slice(guardFrom,guard.indexOf('$fn$;',guardFrom)+6));
  await db.exec('create trigger tasks_status_guard before insert or update on ideworks.tasks for each row execute function ideworks.task_status_guard();');
  await db.exec(readFileSync('supabase/migrations/20260930140000_ideworks_f36_esteira_da_pasta.sql','utf8'));
});
afterAll(()=>db.close());
beforeEach(async()=>{
  await db.exec(`truncate ideworks.task_automations,ideworks.automation_stages,ideworks.tasks,ideworks.statuses,ideworks.status_sets,ideworks.lists,ideworks.folders,ideworks.denied;
    insert into ideworks.folders values('${id(10)}','${id(1)}'),('${id(11)}','${id(1)}');
    insert into ideworks.lists(id,folder_id,space_id,archived_at) values('${id(20)}','${id(10)}','${id(1)}',null),
      ('${id(21)}','${id(10)}','${id(1)}',now()),('${id(22)}','${id(11)}','${id(1)}',null);
    insert into ideworks.status_sets(id,space_id,list_id,name) values
      ('${id(30)}','${id(1)}',null,'Espaço'),('${id(31)}',null,'${id(21)}','Própria');
    insert into ideworks.statuses(id,status_set_id,name,type,color,sort_order) values
      ('${id(40)}','${id(30)}','A fazer','open','#888888',0),
      ('${id(41)}','${id(30)}','Concluído','closed','#00aa00',1),
      ('${id(42)}','${id(31)}','A fazer','open','#888888',0),
      ('${id(43)}','${id(31)}','Concluído','closed','#00aa00',1);
    insert into ideworks.tasks(id,list_id,client_id,status_id,updated_at) values('${id(50)}','${id(20)}',null,'${id(40)}',null),
      ('${id(51)}','${id(21)}',null,'${id(42)}',null),('${id(52)}','${id(22)}',null,'${id(40)}',null);
  `);
});
it('prévia não escreve e conta listas arquivadas',async()=>{
  expect(await call()).toMatchObject({lists:2,archived:1,tasks:2});
  expect((await db.query('select count(*)::int n from ideworks.status_sets')).rows[0]).toEqual({n:2});
});
it('consolida próprias e herdadas; não muda outra pasta; futuras listas herdam',async()=>{
  const result=await save();expect(result).toMatchObject({lists:2,moved:2});
  expect((await db.query('select distinct ideworks.resolve_status_set(id) s from ideworks.lists where folder_id=$1',[id(10)])).rows).toEqual([{s:result.statusSetId}]);
  expect((await db.query('select status_id from ideworks.tasks where id=$1',[id(52)])).rows).toEqual([{status_id:id(40)}]);
  await db.query('insert into ideworks.lists(id,folder_id,space_id,archived_at) values($1,$2,$3,null)',[id(23),id(10),id(1)]);
  expect((await db.query('select ideworks.resolve_status_set($1) s',[id(23)])).rows).toEqual([{s:result.statusSetId}]);
  await save();expect((await db.query('select count(*)::int n from ideworks.tasks')).rows).toEqual([{n:3}]);
});
it('sem destino recusa tudo; destino explícito migra sem perder tarefas',async()=>{
  const statuses=[{name:'Novo',type:'open'},{name:'Concluído',type:'closed'}];
  await expect(save({statuses})).rejects.toThrow('sem destino');
  expect((await db.query('select status_id from ideworks.tasks where id=$1',[id(50)])).rows[0]).toEqual({status_id:id(40)});
  await save({statuses,destinos:[{de:id(40),para:'Novo'},{de:id(42),para:'Novo'}]});
});
it('renomear etapa base por identidade renomeia equivalentes das listas',async()=>{
  const preview=await call();
  await save({statuses:(preview.statuses as {name:string}[]).map(s=>({...s,name:s.name==='A fazer'?'Produção':s.name}))});
  expect((await db.query('select distinct s.name from ideworks.tasks t join ideworks.statuses s on s.id=t.status_id where t.list_id=any($1::uuid[])',[[id(20),id(21)]])).rows).toEqual([{name:'Produção'}]);
});
it('migra automação externa que chega à pasta mantendo a regra',async()=>{
  await db.exec(`insert into ideworks.automation_stages values('${id(22)}','${id(40)}',0),('${id(21)}','${id(42)}',1);
    insert into ideworks.task_automations(id,source_list_id,trigger_status_id,target_list_id,target_status_id)
      values('${id(60)}','${id(22)}','${id(40)}','${id(21)}','${id(42)}');`);
  await save();
  const r=(await db.query<{trigger_status_id:string;target_status_id:string}>('select trigger_status_id,target_status_id from ideworks.task_automations')).rows[0];
  expect(r.trigger_status_id).toBe(id(40));expect(r.target_status_id).not.toBe(id(42));
});
it.each([10,21])('permissão negada no nó %i impede até a prévia',async(n)=>{
  await db.query('insert into ideworks.denied values($1)',[id(n)]);
  await expect(call()).rejects.toThrow('permissão');
});
it('tarefas restritas impedem aplicação com privilégio elevado',async()=>{
  await db.query('update ideworks.tasks set client_id=$1 where id=$2',[id(90),id(51)]);
  await db.query('insert into ideworks.denied values($1)',[id(90)]);
  await expect(call()).rejects.toThrow('permissão');
});
it('revisão antiga é recusada depois de uma nova lista',async()=>{
  const preview=await call();
  await db.query('insert into ideworks.lists(id,folder_id,space_id,archived_at) values($1,$2,$3,null)',[id(23),id(10),id(1)]);
  await expect(save({revision:preview.revision})).rejects.toThrow('mudaram');
});
it('valida nomes, grupos e etapa fechada',async()=>{
  await expect(save({statuses:[{name:'X',type:'open'}]})).rejects.toThrow('exatamente uma');
  await expect(save({statuses:[...states,{name:'A fazer',type:'custom'}]})).rejects.toThrow('nomes únicos');
});
it('pasta vazia recebe padrão para novas listas',async()=>{
  await db.exec('truncate ideworks.tasks,ideworks.lists cascade');
  expect(await save()).toMatchObject({lists:0,moved:0});
});
it('função não é pública',async()=>{
  expect((await db.query("select has_function_privilege('anon','ideworks.folder_workflow(uuid,jsonb)','execute') allowed")).rows).toEqual([{allowed:false}]);
});
it('conflito ao juntar gatilhos de automação desfaz toda a alteração',async()=>{
  await db.exec(`insert into ideworks.statuses(id,status_set_id,name,type,sort_order) values('${id(44)}','${id(31)}','Revisão','custom',2);
    insert into ideworks.automation_stages values('${id(21)}','${id(42)}',0),('${id(21)}','${id(44)}',0);
    insert into ideworks.task_automations(id,source_list_id,trigger_status_id) values
      ('${id(60)}','${id(21)}','${id(42)}'),('${id(61)}','${id(21)}','${id(44)}');`);
  await expect(save({destinos:[{de:id(44),para:'A fazer'}]})).rejects.toThrow();
  expect((await db.query('select count(*)::int n from ideworks.task_automations')).rows).toEqual([{n:2}]);
  expect((await db.query('select status_id from ideworks.tasks where id=$1',[id(51)])).rows).toEqual([{status_id:id(42)}]);
  expect((await db.query('select count(*)::int n from ideworks.status_sets where folder_id=$1',[id(10)])).rows).toEqual([{n:0}]);
});
it('automação externa sem permissão impede a migração',async()=>{
  await db.exec(`insert into ideworks.automation_stages values('${id(22)}','${id(40)}',0),('${id(21)}','${id(42)}',1);
    insert into ideworks.task_automations(id,source_list_id,trigger_status_id,target_list_id,target_status_id)
      values('${id(60)}','${id(22)}','${id(40)}','${id(21)}','${id(42)}');
    insert into ideworks.denied values('${id(22)}');`);
  await expect(save()).rejects.toThrow('automação');
});
it('a FK continua imediata fora da operação em bloco',async()=>{
  await expect(db.query('delete from ideworks.statuses where id=$1',[id(42)])).rejects.toThrow();
  expect((await db.query('select status_id from ideworks.tasks where id=$1',[id(51)])).rows).toEqual([{status_id:id(42)}]);
});
it('destino fechado conclui a tarefa pelo trigger real',async()=>{
  await save({statuses:[states[1]],destinos:[{de:id(40),para:'Concluído'},{de:id(42),para:'Concluído'}]});
  expect((await db.query('select count(*)::int n from ideworks.tasks where list_id=any($1::uuid[]) and completed_at is not null',[[id(20),id(21)]])).rows).toEqual([{n:2}]);
});
