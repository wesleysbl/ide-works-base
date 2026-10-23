import assert from 'node:assert/strict';
import { BASE, criarSuite } from './comum.mjs';
import { F6C, f6cServidor } from './dados-f06c.mjs';
const stages=[{id:'s1',name:'A fazer',type:'open',color:'#888888'},{id:'s2',name:'Concluído',type:'closed',color:'#00aa00'}];
export default async function(browser) {
  const {cenario,resultados}=criarSuite(browser);
  for(const kind of ['aplicar','destinos','erro-leitura','conflito']) {
    await cenario(`PASTA-ESTEIRA-${kind}`, 'prévia, edição, destino e aplicação atômica pelo menu da pasta',async(abrir)=>{
      const writes=[];let reads=0;
      const fallback=f6cServidor();
      const {page}=await abrir({custom:(url,req)=>{
        if(url.pathname===`/api/board/folders/${F6C.pasta}/workflow`) {
          if(req.method()==='GET') {
            reads++;
            if(kind==='erro-leitura'&&reads===1)return {status:503,body:{message:'Leitura indisponível'}};
            return {body:{ok:true,name:'Esteira atual',statuses:stages,
              originals:[...stages,{...stages[0],id:'s3'}],revision:'rev1',lists:2,archived:1,tasks:10}};
          }
          const b=req.postDataJSON();writes.push(b);
          if(kind==='conflito')return {status:409,body:{message:'As listas ou etapas mudaram. Feche e abra o editor novamente.'}};
          if(kind==='destinos'&&writes.length===1)return {status:409,body:{message:'Escolha o destino',semDestino:['A fazer']}};
          return {body:{ok:true,lists:2,moved:10}};
        }
        return fallback(url,req);
      }});
      await page.goto(`${BASE}/quadro/${F6C.lista}`);
      const action=page.getByRole('button',{name:'Ações de Clientes F06C',exact:true});
      await action.waitFor();
      await page.locator('.cu-no').filter({has:action}).hover();
      await action.click();
      await page.getByRole('menuitemcheckbox',{name:'Esteira da pasta…',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'Mudar a esteira de todas as listas',exact:true}).click();
      const apply=page.getByRole('button',{name:'Aplicar a todas as listas',exact:true});
      if(kind==='erro-leitura') {
        await page.getByText('Leitura indisponível',{exact:false}).waitFor();
        assert.equal(await apply.isDisabled(),true);
        await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
      }
      await page.getByText(/As esteiras próprias serão substituídas/).waitFor();
      assert.equal(writes.length,0,'abrir e ler não altera a pasta');
      await page.getByRole('textbox',{name:'Nome da esteira',exact:true}).fill('Esteira do time');
      if(kind==='destinos') {
        await page.getByRole('button',{name:'Tirar a etapa 1',exact:true}).click();
      } else {
        await page.getByRole('textbox',{name:'Nome da etapa 1',exact:true}).fill('Em produção');
      }
      await apply.click();
      if(kind==='destinos') {
        const select=page.getByRole('combobox',{name:'Destino das tarefas de A fazer',exact:true});
        await select.waitFor();await select.selectOption('Concluído');
        await apply.click();
      }
      if(kind==='conflito') {
        await page.getByText('As listas ou etapas mudaram. Feche e abra o editor novamente.',{exact:true}).waitFor();
        assert.equal(await apply.isVisible(),true);
      } else {
        await apply.waitFor({state:'hidden'});
      }
      assert.equal(writes.at(-1).revision,'rev1');
      assert.equal(writes.at(-1).name,'Esteira do time');
      if(kind==='destinos')assert.deepEqual(writes.at(-1).destinos,[{de:'s1',para:'Concluído'},{de:'s3',para:'Concluído'}]);
    });
  }
  return resultados;
}
