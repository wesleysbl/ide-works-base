import assert from 'node:assert/strict';
import { BASE, criarSuite, sessaoDe } from './comum.mjs';
import { rotasDaAdministracao } from './pessoas-convite.mjs';
export default async function(browser) {
  const { cenario, resultados } = criarSuite(browser);
  const abrirCadastro = async (abrir, { admin = false, falha = false, width = 1440 } = {}) => {
    const { estado, handler } = rotasDaAdministracao({ ...(admin ? { eu: 'u-bia' } : {}) });
    const writes = [];
    let recusar = falha;
    const state = await abrir({ viewport: { width, height: 900 }, custom: async (url, req) => {
      if (url.pathname === '/api/auth/me') return { body: { ...sessaoDe(admin ? 'u-bia' : 'u-ana'), papel: admin ? 'admin' : 'super_admin', isSuper: !admin, isSuperadmin: true, areas: ['pessoas','quadro','entrega'] } };
      if (url.pathname.endsWith('/u-caio/profile')) {
        writes.push(req.postDataJSON());
        await new Promise((r) => setTimeout(r, 150));
        if (recusar) { recusar = false; return { status: 400, body: { message: 'Esse e-mail já está em uso.' } }; }
        Object.assign(estado.pessoas.find((x) => x.id === 'u-caio'), { nome: writes.at(-1).nome, email: writes.at(-1).email });
        return { body: { ok: true } };
      }
      return handler(url,req);
    } });
    await state.page.goto(BASE+'/pessoas');
    await state.page.getByRole('heading', { name: 'Pessoas', exact: true }).waitFor();
    return { ...state, writes, estado };
  };
  await cenario('PC1', 'super edita nome/e-mail e vê os dados ao reabrir; duplo envio é bloqueado', async (abrir) => {
    const { page, writes, erros } = await abrirCadastro(abrir);
    await page.getByRole('button',{ name:'Editar cadastro de Caio Martins',exact:true }).click();
    const janela = page.getByRole('dialog',{name:'Editar cadastro',exact:true});
    await janela.getByLabel('Nome',{exact:true}).fill('Caio Atualizado');
    await janela.getByLabel('E-mail',{exact:true}).fill('novo@example.invalid');
    await janela.locator('form').evaluate((el) => { el.requestSubmit(); el.requestSubmit(); });
    await janela.waitFor({state:'hidden'});
    assert.equal(writes.length,1);
    assert.deepEqual(writes[0], {nome:'Caio Atualizado',email:'novo@example.invalid',anterior:{nome:'Caio Martins',email:'caio@example.invalid'}});
    await page.getByRole('button',{name:'Editar cadastro de Caio Atualizado',exact:true}).click();
    assert.equal(await janela.getByLabel('Nome',{exact:true}).inputValue(),'Caio Atualizado');
    assert.equal(await janela.getByLabel('E-mail',{exact:true}).inputValue(),'novo@example.invalid');
    assert.deepEqual(erros,[]);
  });
  await cenario('PC2', 'admin comum não recebe botão de editar cadastro', async (abrir) => {
    const { page } = await abrirCadastro(abrir,{admin:true});
    await page.getByRole('listitem',{name:'Caio Martins',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/Editar cadastro/}).count(),0);
  });
  await cenario('PC3', 'recusa fica na janela e preserva os campos; repetir funciona', async (abrir) => {
    const { page, writes } = await abrirCadastro(abrir,{falha:true});
    await page.getByRole('button',{name:'Editar cadastro de Caio Martins',exact:true}).click();
    const j=page.getByRole('dialog',{name:'Editar cadastro',exact:true});
    await j.getByLabel('Nome',{exact:true}).fill('Nome revisado');
    await j.getByRole('button',{name:'Salvar cadastro',exact:true}).click();
    await j.getByRole('alert').waitFor();
    assert.match(await j.getByRole('alert').textContent(),/já está em uso/);
    assert.equal(await j.getByLabel('Nome',{exact:true}).inputValue(),'Nome revisado');
    await j.getByRole('button',{name:'Salvar cadastro',exact:true}).click();
    await j.waitFor({state:'hidden'}); assert.equal(writes.length,2);
  });
  for (const width of [390,1440]) await cenario(`PC4-${width}`, 'cancelar não grava, foco retorna e janela cabe na tela', async (abrir) => {
    const { page, writes }=await abrirCadastro(abrir,{width});
    const botao=page.getByRole('button',{name:'Editar cadastro de Caio Martins',exact:true});
    await botao.click(); const j=page.getByRole('dialog',{name:'Editar cadastro',exact:true});
    const rect=await j.boundingBox(); assert.ok(rect.x>=0 && rect.x+rect.width<=width);
    await j.getByLabel('Nome',{exact:true}).fill('Não gravar');
    await j.getByRole('button',{name:'Cancelar',exact:true}).click();
    assert.equal(writes.length,0);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Editar cadastro de Caio Martins');
    assert.equal(await botao.evaluate((el)=>el===document.activeElement),true);
  });
  return resultados;
}
