import assert from 'node:assert/strict';
import { BASE, criarSuite, detail, row } from './comum.mjs';

// ClipboardEvent sintético com os mesmos MIME types da cópia do navegador/Word.
// API simulada: salvar/reabrir exercita a tela sem escrever em tarefas reais.
const colar = (editor, html, plain = '', selecionar = true) => editor.evaluate((el, dados) => {
  el.focus();
  if (dados.selecionar) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }
  const data = new DataTransfer();
  if (dados.html) data.setData('text/html', dados.html);
  if (dados.plain) data.setData('text/plain', dados.plain);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}, { html, plain, selecionar });

export default async function(browser) {
  const { cenario, resultados } = criarSuite(browser);
  const abrirEditor = async (abrir, description = '') => {
    const state = await abrir({ custom: (url, req) => {
      if (url.pathname !== `/api/board/tasks/${row.id}`) return null;
      if (req.method() === 'PATCH') description = req.postDataJSON().description ?? description;
      return { body: { ok: true, task: { ...detail, id: row.id, description }, storage: { ready: false, variable: '' } } };
    } });
    await state.page.goto(`${BASE}/tarefa/${row.id}`);
    const editor = state.page.getByRole('textbox', { name: 'Descrição da tarefa', exact: true });
    await editor.waitFor();
    return { ...state, editor };
  };

  await cenario('P1', 'HTML formatado permanece ao salvar e reabrir, incluindo tabela, lista e código', async (abrir) => {
    const { page, editor, writes, erros } = await abrirEditor(abrir);
    const html = '<h2>Briefing</h2><p>Texto <strong>importante</strong> e <em>itálico</em> <a href="https://example.com">referência</a></p><ul><li>Primeiro</li><li>Segundo<ul><li>Detalhe</li></ul></li></ul><blockquote><p>Citação</p></blockquote><pre><code>const x = 1;\n  x++;</code></pre><table><tr><th>Peça</th><th>Prazo</th></tr><tr><td>Arte</td><td>Sexta</td></tr></table>';
    await colar(editor, html, 'Briefing Texto importante');
    for (const seletor of ['h2', 'strong', 'em', 'a', 'ul', 'blockquote', 'pre', 'table']) assert.ok(await editor.locator(seletor).count(), seletor);
    const resposta = page.waitForResponse((r) => r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
    await resposta;
    const salvo = writes.find((w) => w.body.description)?.body.description;
    assert.match(salvo, /## Briefing/);
    assert.match(salvo, /\*\*importante\*\*/);
    assert.match(salvo, /\[referência\]\(https:\/\/example.com\)/);
    await page.reload(); await editor.waitFor();
    for (const seletor of ['h2', 'strong', 'em', 'a', 'ul', 'blockquote', 'pre', 'table']) assert.ok(await editor.locator(seletor).count(), `reaberto: ${seletor}`);
    assert.equal(await editor.locator('pre').textContent(), 'const x = 1;\n  x++;');
    assert.deepEqual(erros, []);
  });

  await cenario('P2', 'estilos inline do Word/Docs e espaços em marcas são normalizados', async (abrir) => {
    const { editor, erros } = await abrirEditor(abrir);
    await colar(editor, '<b style="font-weight:normal"><p><span style="font-weight:700">Negrito </span><span style="font-style:italic">itálico</span> <span style="text-decoration:line-through">antigo</span></p></b>');
    assert.equal(await editor.locator('strong,b').textContent(), 'Negrito');
    assert.equal(await editor.locator('em,i').textContent(), 'itálico');
    assert.equal(await editor.locator('del,strike,s').textContent(), 'antigo');
    assert.equal(await editor.textContent(), 'Negrito itálico antigo');
    assert.deepEqual(erros, []);
  });

  await cenario('P3', 'listas do Word com marcadores auxiliares e níveis viram listas editáveis', async (abrir) => {
    const { editor } = await abrirEditor(abrir);
    await colar(editor, '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1. </span>Um</p><p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">a. </span>Subitem</p><p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2. </span>Dois</p>');
    assert.equal(await editor.locator('ol').count(), 2);
    assert.equal(await editor.locator('li').count(), 3);
    assert.equal(await editor.textContent(), 'UmSubitemDois');
  });

  await cenario('P4', 'HTML hostil não executa, não baixa imagens e não cria menções/anexos falsos', async (abrir) => {
    const { page, editor, erros } = await abrirEditor(abrir);
    const externos = [];
    page.on('request', (r) => { if (r.url().includes('clipboard-test.invalid')) externos.push(r.url()); });
    await colar(editor, '<script>window.executouColagem = true</script><style>body{display:none}</style><iframe src="https://clipboard-test.invalid/frame"></iframe><img src="https://clipboard-test.invalid/image" onerror="window.executouColagem=true"><p onclick="alert(1)"><a href="javascript:alert(1)">Link</a><span data-mention-id="11111111-1111-4111-8111-111111111111"> Pessoa</span><img data-attachment-id="11111111-1111-4111-8111-111111111111" alt="Figura"></p>');
    assert.equal(await editor.locator('script,style,iframe,img,[onclick],[data-mention-id],[data-attachment-id],a[href]').count(), 0);
    assert.match(await editor.textContent(), /Link PessoaFigura/);
    assert.equal(await page.evaluate(() => window.executouColagem), undefined);
    assert.deepEqual(externos, []);
    assert.deepEqual(erros, []);
  });

  await cenario('P5', 'texto/Markdown sem HTML e HTML vazio usam fallback existente', async (abrir) => {
    const { editor } = await abrirEditor(abrir);
    await colar(editor, '', '**Negrito**\n\n- Item');
    assert.equal(await editor.locator('strong,b').textContent(), 'Negrito');
    assert.equal(await editor.locator('li').textContent(), 'Item');
    await colar(editor, '<meta charset="utf-8">', 'Texto alternativo');
    assert.equal(await editor.textContent(), 'Texto alternativo');
  });

  await cenario('P6', 'colar no meio substitui seleção; desfazer/refazer preservam a formatação', async (abrir) => {
    const { page, editor } = await abrirEditor(abrir, 'Antes alvo depois');
    await editor.evaluate((el) => {
      el.focus(); const r = document.createRange();
      r.setStart(el.firstChild.firstChild, 6); r.setEnd(el.firstChild.firstChild, 10);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await colar(editor, '<strong>NOVO</strong>', 'NOVO', false);
    assert.equal((await editor.textContent()).replace(/\u00a0/g, ' '), 'Antes NOVO depois');
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal((await editor.textContent()).replace(/\u00a0/g, ' '), 'Antes alvo depois');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    assert.equal((await editor.textContent()).replace(/\u00a0/g, ' '), 'Antes NOVO depois');
    assert.equal(await editor.locator('strong,b').textContent(), 'NOVO');
  });

  await cenario('P7', 'atalho de colar sem formatação mantém texto literal', async (abrir) => {
    const { editor } = await abrirEditor(abrir);
    await editor.focus();
    await editor.evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true })));
    await colar(editor, '<strong>Formatado</strong>', '**Literal**');
    assert.equal(await editor.locator('strong,b').count(), 0);
    assert.equal(await editor.textContent(), '**Literal**');
  });
  return resultados;
}
