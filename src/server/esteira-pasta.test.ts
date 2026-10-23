import { it, expect } from 'vitest';
import { folderWorkflow } from '@/server/tree';
import type { Sql, Tx } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';
const actor:AuthenticatedActor={userId:'user',email:'teste@example.invalid',papel:'super_admin',isSuper:true,isSuperadmin:true,areas:['quadro'],hasAllClientsAccess:true};
function fixture(error?:unknown) {
  const calls:unknown[][]=[];
  const tag=async(parts:TemplateStringsArray,...params:unknown[])=>{
    const q=parts.join('?');
    if(q.includes('set_config'))return [];
    if(q.includes('category_id'))return [{category_id:null}];
    if(q.includes('folder_workflow')){
      calls.push(params);
      if(error)throw error;
      return [{result:{lists:2}}];
    }
    throw new Error(q);
  };
  const tx=Object.assign(tag,{json:(v:unknown)=>({json:v})}) as unknown as Tx;
  const sql={begin:(fn:(t:Tx)=>Promise<unknown>)=>fn(tx)} as unknown as Sql;
  return {sql,calls};
}
it('GET transmite SQL NULL, sem confundir com o valor JSON null',async()=>{
  const {sql,calls}=fixture();expect(await folderWorkflow(sql,actor,'pasta')).toEqual({lists:2});
  expect(calls).toEqual([['pasta',null]]);
});
it('aplicar transmite a entrada como json parametrizado',async()=>{
  const {sql,calls}=fixture();const input={revision:'x',statuses:[]};
  await folderWorkflow(sql,actor,'pasta',input);
  expect(calls).toEqual([['pasta',{json:input}]]);
});
it('faltam destinos: devolve o contrato do editor',async()=>{
  const {sql}=fixture({code:'22023',message:'Escolha destinos. sem destino: A fazer | Revisão'});
  await expect(folderWorkflow(sql,actor,'pasta',{})).rejects.toMatchObject({status:409,semDestino:['A fazer','Revisão']});
});
it('conflito de automação vira recusa compreensível',async()=>{
  const {sql}=fixture({code:'23505'});
  await expect(folderWorkflow(sql,actor,'pasta',{})).rejects.toMatchObject({status:409,message:expect.stringContaining('automações incompatíveis')});
});
