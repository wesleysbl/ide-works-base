import assert from 'node:assert/strict';
import { BASE, criarSuite, detail, row } from './comum.mjs';

export default async function(browser) {
  const { cenario, resultados } = criarSuite(browser);
  for (const width of [1280, 390]) {
    await cenario(`chat-${width}`, 'autoria define o lado e resposta aponta para a origem', async abrir => {
      const comment = { parentId: null, author: { id: 'a', name: 'Helena' }, body: 'Pode revisar esta arte?', createdAt: '2026-09-14T12:00:00Z', editedAt: null, replyCount: 0, mine: false, replies: [] };
      const { page, erros } = await abrir({ custom: url => url.pathname.startsWith('/api/board/tasks/') ? { body: { ok: true, task: { ...detail, id: row.id, comments: [
        { ...comment, id: 'c1', replyCount: 1 },
        { ...comment, id: 'c2', mine: true, parentId: 'c1', author: { id: 'b', name: 'Wesley' }, body: 'Revisei, pode enviar para aprovação.' },
      ] }, storage: { ready: false, variable: '' } } } : null });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/tarefa/${row.id}`);
      const other = page.locator('#comentario-c1');
      const own = page.locator('#comentario-c2');
      await own.scrollIntoViewIfNeeded();
      const a = await other.boundingBox();
      const b = await own.boundingBox();
      assert.ok(b.x > a.x, JSON.stringify({a,b}));
      assert.ok(b.x + b.width <= width);
      assert.equal(await own.locator('.c-citacao').getAttribute('href'), '#comentario-c1');
      assert.equal(await other.getByRole('button', {name:'Editar', exact:true}).count(), 0);
      await own.getByRole('button', {name:'Editar', exact:true}).click();
      await own.getByRole('button', {name:'Cancelar', exact:true}).click();
      await own.locator('.c-citacao').click();
      assert.equal(new URL(page.url()).hash, '#comentario-c1');
      assert.deepEqual(erros, []);
      await page.locator('.c-bloco').screenshot({ path: `/tmp/ide-chat-${width}.png` });
    });
  }
  return resultados;
}
