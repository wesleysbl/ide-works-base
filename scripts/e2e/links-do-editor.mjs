import assert from 'node:assert/strict';

import { BASE, criarSuite, detail, row } from './comum.mjs';

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);
  const original = 'https://example.com/arquivo';
  const openEditor = async (abrir, description = `[Arquivo](${original})`) => {
    const state = await abrir({ custom: (url) => url.pathname.startsWith('/api/board/tasks/')
      ? { body: { ok: true, task: { ...detail, id: row.id, description }, storage: { ready: false, variable: '' } } }
      : null });
    await state.page.goto(`${BASE}/tarefa/${row.id}`);
    const editor = state.page.getByRole('textbox', { name: 'Descrição da tarefa', exact: true });
    await editor.waitFor();
    // Registra a abertura sem fazer pedidos a destinos externos.
    await state.page.evaluate(() => {
      window.openedLinks = [];
      window.open = (...args) => { window.openedLinks.push(args); return null; };
    });
    return { ...state, editor };
  };

  await cenario('L1', 'clique abre o destino sem focar o editor; Alt + clique edita o mesmo link', async (abrir) => {
    const { page, editor, erros } = await openEditor(abrir);
    const link = editor.locator('a');
    await link.click();
    assert.deepEqual(await page.evaluate(() => window.openedLinks), [[original, '_blank', 'noopener,noreferrer']]);
    assert.equal(await editor.evaluate((el) => document.activeElement === el), false);
    await link.click({ modifiers: ['Alt'] });
    const address = page.getByRole('textbox', { name: 'Endereço do link', exact: true });
    assert.equal(await address.inputValue(), original);
    await address.fill('https://example.com/novo');
    await address.press('Enter');
    assert.equal(await link.count(), 1);
    assert.equal(await link.textContent(), 'Arquivo');
    assert.equal(await link.getAttribute('href'), 'https://example.com/novo');
    assert.equal(await page.evaluate(() => window.openedLinks.length), 1);
    assert.deepEqual(erros, []);
  });

  for (const finish of ['Space', 'Enter', 'blur']) {
    await cenario(`L-${finish}`, `URL digitada vira link ao concluir com ${finish}`, async (abrir) => {
      const { page, editor, erros } = await openEditor(abrir, '');
      await editor.fill(original);
      if (finish === 'blur') await page.getByRole('textbox', { name: 'Título da tarefa', exact: true }).click();
      else await editor.press(finish);
      const link = editor.locator('a');
      assert.equal(await link.getAttribute('href'), original);
      if (finish !== 'blur') {
        await page.keyboard.type('depois');
        assert.equal(await link.textContent(), original, 'o texto seguinte fica fora do link');
        assert.match(await editor.textContent(), /depois/);
      }
      assert.deepEqual(erros, []);
    });
  }

  await cenario('L5', 'colar URL produz link; código continua literal e endereço inseguro é recusado', async (abrir) => {
    const { page, editor, erros } = await openEditor(abrir, '`https://example.com/codigo`');
    assert.equal(await editor.locator('a').count(), 0);
    await editor.click();
    await editor.press('ControlOrMeta+End');
    await editor.press('ArrowDown');
    await editor.evaluate((el, url) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      const data = new DataTransfer();
      data.setData('text/plain', url);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, original);
    const link = editor.locator('a');
    assert.equal(await link.getAttribute('href'), original);
    await link.click({ modifiers: ['Alt'] });
    const address = page.getByRole('textbox', { name: 'Endereço do link', exact: true });
    await address.fill('javascript:alert(1)');
    await address.press('Enter');
    assert.equal(await link.getAttribute('href'), original);
    assert.deepEqual(erros, []);
  });

  for (const width of [1280, 375]) {
    await cenario(`estilos-${width}`, 'menu de estilos inteiro e clicável, preservando a seleção', async (abrir) => {
      const { page, editor, erros } = await openEditor(abrir, 'Texto para formatar');
      await page.setViewportSize({ width, height: 900 });
      await editor.scrollIntoViewIfNeeded();
      await editor.evaluate((el) => {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      });
      await page.locator('.cu-bolha button[aria-expanded]').click();
      const menu = page.locator('.cu-menu-estilos');
      await menu.waitFor();
      const box = await menu.boundingBox();
      assert.ok(box.width >= 230 && box.height >= 160, JSON.stringify(box));
      assert.ok(box.x >= 0 && box.x + box.width <= width, JSON.stringify(box));
      for (const item of await menu.locator('.cu-item').all()) {
        assert.equal(await item.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        }), true, await item.textContent());
      }
      await menu.getByRole('button', { name: 'Título 2', exact: true }).click();
      assert.equal(await editor.locator('h2').textContent(), 'Texto para formatar');
      assert.deepEqual(erros, []);
    });
  }

  return resultados;
}
