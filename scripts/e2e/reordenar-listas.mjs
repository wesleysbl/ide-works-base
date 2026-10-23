import assert from 'node:assert/strict';
import { BASE, criarSuite } from './comum.mjs';
import { F6C, F6C_ARVORE, f6cServidor } from './dados-f06c.mjs';
export default async function(browser) {
  const { cenario, resultados } = criarSuite(browser);
  for (const recusada of [false, true]) {
    await cenario(`ORDEM-${recusada ? 'recusa' : 'salva'}`, 'ordena listas pelo menu e preserva ordem ao recarregar', async (abrir) => {
      const base = F6C_ARVORE.spaces[0];
      let rows = [base, {...base,listId:'ordem-b',listName:'Clínica'}, {...base,listId:'ordem-c',listName:'Orto Key'}];
      const fallback = f6cServidor();
      const {page} = await abrir({custom: (url,req) => {
        if (url.pathname === '/api/board/tree/full') return {body:{...F6C_ARVORE,spaces:rows}};
        if (url.pathname.endsWith('/order')) {
          if (recusada) return {status:403,body:{message:'Você não tem permissão para reorganizar esta pasta.'}};
          const id=url.pathname.split('/').at(-2);
          const from=rows.findIndex(r=>r.listId===id);
          const direction=req.postDataJSON().direction;
          const to=direction==='first'?0:direction==='last'?rows.length-1:from+(direction==='up'?-1:1);
          const [r]=rows.splice(from,1);rows.splice(to,0,r);
          return {body:{ok:true}};
        }
        return fallback(url,req);
      }});
      await page.goto(`${BASE}/quadro/${F6C.lista}`);
      await page.getByRole('button',{name:'Ações de Orto Key',exact:true}).waitFor();
      const names=()=>page.locator('.cu-no[data-nivel="2"] .cu-no-nome').allTextContents();
      const before=await names();
      await page.locator('.cu-no').filter({has: page.getByRole('button',{name:'Ações de Orto Key',exact:true})}).hover();
      await page.getByRole('button',{name:'Ações de Orto Key',exact:true}).click();
      await page.getByRole('menuitemcheckbox',{name:'Mover para o início',exact:true}).click();
      if(recusada) {
        await page.getByText('Você não tem permissão para reorganizar esta pasta.',{exact:true}).waitFor();
        assert.deepEqual(await names(),before);
      } else {
        await page.waitForFunction(()=>document.querySelector('.cu-no[data-nivel="2"] .cu-no-nome')?.textContent==='Orto Key');
        await page.reload();
        await page.getByRole('button',{name:'Ações de Orto Key',exact:true}).waitFor();
        assert.deepEqual(await names(),['Orto Key','Conteúdo mensal','Clínica']);
        await page.locator('.cu-no').filter({has: page.getByRole('button',{name:'Ações de Orto Key',exact:true})}).hover();
      await page.getByRole('button',{name:'Ações de Orto Key',exact:true}).click();
        assert.equal(await page.getByRole('menuitemcheckbox',{name:'Mover para cima',exact:true}).isDisabled(),true);
        await page.getByRole('menuitemcheckbox',{name:'Mover para baixo',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.cu-no[data-nivel="2"] .cu-no-nome')?.textContent==='Conteúdo mensal');
      }
    });
  }
  return resultados;
}
