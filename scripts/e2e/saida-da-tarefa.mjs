/**
 * A proteção de saída da tarefa — F17.AUD03, provada no Chrome real.
 *
 * Vinte e dois percursos: os treze da implementação (1 a 13) e os nove da
 * verificação (V1 a V9). Cobrem cada porta de saída — X, botão do
 * navegador, barra lateral, trilha, link para a mãe e para a subtarefa — e as
 * três decisões da janela "Sair sem salvar?": Continuar editando, Descartar e
 * sair, Salvar e sair. Mais o F5 (rascunho oferecido, nunca aplicado), a
 * troca de usuário na mesma aba e a integridade do histórico.
 *
 * ⚠️ F29 (Fase 4): O `‹ Voltar` DA MOLDURA SAIU DA FICHA — o Wesley achou que
 * ele confundia "anterior" com "acima", e a trilha o substitui. Os dois passos
 * que o clicavam (1b e V9) clicam agora o X, que é a mesma peça (`Voltar`, modo
 * `close`) com o mesmo destino (`comoVoltar`): o que eles provavam — a janela
 * de saída na porta do app, Esc = continuar, o histórico íntegro — continua
 * provado pela porta que ficou.
 */

import assert from 'node:assert/strict';

import { BASE, X, abrirEmTelaCheia, abrirTarefaEditada, beforeunloadArmado, campoTitulo, criarSuite, detail, fecharFicha, janela, lerTitulo, pause, row, sessaoDe } from './comum.mjs';

/** A ficha com trilha, lista e uma subtarefa — o que os cenários da trilha e da subtarefa precisam. */
const fichaCompleta = (url, req) => {
  if (!url.pathname.startsWith('/api/board/tasks/')) return null;
  const patch = req.method() === 'PATCH' ? req.postDataJSON() ?? {} : {};
  const id = url.pathname.split('/')[4];
  return {
    body: {
      ok: true,
      task: {
        ...detail, id,
        title: patch.title ?? (id === row.id ? row.title : 'Tarefa ' + id),
        description: patch.description ?? detail.description,
        spaceName: 'ALMA 9', folderName: 'FOCUS Ibitinga', folderId: 'f1', listId: 'l1', listName: 'FOCUS (Vídeos)',
        subtasks: id === row.id
          ? [{ id: 'sub-1', title: 'A subtarefa', statusId: 'st1', statusColor: '#ccc', statusName: 'a fazer', statusType: 'open', assignees: [], dueOn: null, completedAt: null, archivedAt: null, subtaskCount: 0, priority: null }]
          : [],
      },
      storage: { ready: false, variable: '' },
    },
  };
};

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('1', 'X com edição abre a decisão; Continuar editando mantém texto, ficha e endereço; Esc = continuar; Voltar do navegador + Descartar chega ao destino', async (abrir) => {
    const { page, writes, erros } = await abrir();
    const title = await abrirTarefaEditada(page);
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    assert.equal(page.url(), BASE + '/tarefa/' + row.id);
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), true, 'o foco está dentro da janela');
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(await lerTitulo(title), 'EDIÇÃO QUE NÃO PODE SUMIR');
    assert.equal(page.url(), BASE + '/tarefa/' + row.id);
    assert.equal(writes.length, 0);
    // 1b. Escape = continuar. (Pelo X: o `‹ Voltar` saiu na F29.)
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.keyboard.press('Escape');
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(await lerTitulo(title), 'EDIÇÃO QUE NÃO PODE SUMIR');
    // 1c. Voltar do navegador (POP) = mesma decisão; Descartar e sair conclui a navegação pedida.
    await pause(500); // o índice de histórico do CDP demora a assentar depois do go(+1) de restauração
    await page.goBack();
    await janela(page).waitFor();
    assert.equal(page.url(), BASE + '/tarefa/' + row.id, 'a URL volta para a tarefa enquanto se decide');
    await page.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await page.waitForURL(BASE + '/meu-trabalho');
    assert.equal(writes.length, 0);
    await page.getByRole('link', { name: row.title, exact: true }).click();
    await title.waitFor();
    assert.equal(await lerTitulo(title), row.title);
    await pause(400);
    assert.equal(await page.getByText('Há um rascunho do título', { exact: false }).count(), 0, 'descartar não deixa rascunho');
    assert.deepEqual(erros, []);
  });

  await cenario('2', 'Salvar e sair aguarda o servidor, grava uma vez na tarefa certa e sai uma vez', async (abrir) => {
    const { page, writes, erros } = await abrir({ custom: async (url, req) => { if (req.method() === 'PATCH') await pause(600); return null; } });
    await abrirTarefaEditada(page, 'Título salvo ao sair');
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await janela(page).getByRole('button', { name: 'salvando…', exact: true }).waitFor();
    assert.equal(page.url(), BASE + '/tarefa/' + row.id);
    assert.equal(await janela(page).getByRole('button', { name: 'Descartar e sair', exact: true }).isDisabled(), true);
    await page.waitForURL(BASE + '/meu-trabalho');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, '/api/board/tasks/' + row.id);
    assert.equal(writes[0].body.title, 'Título salvo ao sair');
    assert.deepEqual(erros, []);
  });

  await cenario('3', 'falha de gravação (500) mantém texto e ficha; a segunda tentativa sai', async (abrir) => {
    let falhar = true;
    const { page, writes } = await abrir({
      custom: (url, req) => (req.method() === 'PATCH' && falhar ? { status: 500, body: { ok: false, message: 'O banco recusou a gravação de mentira.' } } : null),
    });
    const title = await abrirTarefaEditada(page, 'Texto que fica na falha');
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(page.url(), BASE + '/tarefa/' + row.id);
    assert.equal(await lerTitulo(title), 'Texto que fica na falha');
    await page.getByText('O banco recusou a gravação de mentira.', { exact: false }).waitFor();
    assert.equal(writes.length, 1);
    falhar = false;
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await page.waitForURL(BASE + '/meu-trabalho');
    assert.equal(writes.length, 2);
  });

  await cenario('4', 'erro de validação (título vazio): nenhum envio, ficha aberta com o erro à vista', async (abrir) => {
    const { page, writes } = await abrir();
    const title = await abrirTarefaEditada(page, '   ');
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(page.url(), BASE + '/tarefa/' + row.id);
    assert.equal(writes.length, 0);
    assert.equal(await title.getAttribute('data-erro'), 'true');
  });

  await cenario('5', 'sem alteração, o X sai na hora; por link direto vai ao lugar acima (/quadro)', async (abrir) => {
    const { page } = await abrir();
    await page.goto(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    await page.getByRole('button', X).click();
    await page.waitForURL(/\/quadro/);
  });

  await cenario('6', 'após F5 o rascunho é OFERECIDO ao mesmo usuário e só entra ao clicar; aviso nativo só com alteração', async (abrir) => {
    const { page, erros } = await abrir();
    await abrirTarefaEditada(page, 'Texto que sobrevive ao F5');
    await pause(700); // > 500 ms do rascunho
    assert.equal(await beforeunloadArmado(page), true, 'aviso nativo armado com alteração');
    page.once('dialog', (d) => d.accept());
    await page.reload();
    const title2 = campoTitulo(page);
    await title2.waitFor();
    assert.equal(await lerTitulo(title2), row.title, 'o rascunho NÃO é aplicado sozinho');
    await page.getByText('Há um rascunho do título e do briefing desta tarefa', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Recuperar rascunho', exact: true }).click();
    assert.equal(await lerTitulo(title2), 'Texto que sobrevive ao F5');
    await page.getByText('há alterações por salvar', { exact: true }).waitFor();
    await title2.fill(row.title);
    await pause(100);
    assert.equal(await beforeunloadArmado(page), false, 'sem alteração o aviso nativo desarma');
    assert.deepEqual(erros, []);
  });

  await cenario('7', 'outro usuário na mesma aba não recebe o rascunho da tarefa', async (abrir) => {
    let userId = 'u-ana';
    const { page } = await abrir({ custom: (url) => (url.pathname === '/api/auth/me' ? { body: sessaoDe(userId) } : null) });
    await abrirTarefaEditada(page, 'Rascunho da Ana');
    await pause(700);
    userId = 'u-bia';
    page.once('dialog', (d) => d.accept());
    await page.reload();
    await campoTitulo(page).waitFor();
    await pause(500);
    assert.equal(await page.getByText('Há um rascunho do título', { exact: false }).count(), 0);
  });

  await cenario('8', 'F5 em /tarefas com rolagem volta ao lugar (LembrarRolagem continua na moldura)', async (abrir) => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ ...row, id: 'r' + i, title: 'Tarefa ' + i }));
    const { page } = await abrir({
      custom: (url) => (url.pathname === '/api/board/all-tasks'
        ? { body: { ok: true, work: { rows, total: rows.length, matched: rows.length, capped: false, assigneeOptions: [], unassignedTasks: 0 } } }
        : null),
    });
    await page.goto(BASE + '/tarefas');
    await page.getByRole('link', { name: 'Tarefa 79', exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 900));
    await pause(400);
    await page.reload();
    await page.getByRole('link', { name: 'Tarefa 79', exact: true }).waitFor();
    await pause(1200);
    const y = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(y - 900) < 40, 'rolagem restaurada: ' + y);
    return `F5 voltou a ${y}px`;
  });

  await cenario('9', 'o tema se alcança pelo menu da conta e alterna a aparência', async (abrir) => {
    const { page } = await abrir();
    // F29.5b: o botão flutuante "Tema atual" saiu da moldura em `912e037`, e a
    // F29 pôs a troca de tema no menu da conta, no pé da barra de toda tela
    // com sessão. O cenário continua provando o mesmo: o tema se alcança, e o
    // clique troca a aparência da página inteira.
    await page.goto(BASE + '/meu-trabalho');
    await page.locator('.bl-conta').click();
    const botao = page.getByRole('menuitem', { name: /^Mudar para o tema (claro|escuro)$/ });
    await botao.waitFor();
    const tema = () => page.evaluate(() => document.documentElement.getAttribute('data-tema') ?? document.documentElement.className);
    const antes = await tema();
    await botao.click();
    await pause(100);
    assert.notEqual(antes, await tema());
  });

  await cenario('10', 'a barra lateral passa pela mesma decisão e chega ao destino pedido', async (abrir) => {
    const { page } = await abrir();
    const title = await abrirTarefaEditada(page, 'Pela barra');
    await page.getByRole('link', { name: 'Todas as tarefas', exact: true }).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(page.url(), BASE + '/tarefa/' + row.id);
    assert.equal(await lerTitulo(title), 'Pela barra');
    await page.getByRole('link', { name: 'Todas as tarefas', exact: true }).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await page.waitForURL(BASE + '/tarefas');
  });

  await cenario('11', 'link para a mãe passa pela decisão; Salvar e sair grava na filha e abre a mãe limpa', async (abrir) => {
    const { page, writes } = await abrir({
      custom: (url, req) => {
        if (url.pathname === '/api/board/tasks/' + row.id && req.method() === 'GET')
          return { body: { ok: true, task: { ...detail, id: row.id, title: row.title, parentId: 'mae-1', parentTitle: 'A mãe' }, storage: { ready: false, variable: '' } } };
        if (url.pathname === '/api/board/tasks/mae-1')
          return { body: { ok: true, task: { ...detail, id: 'mae-1', title: 'A mãe', parentId: null, parentTitle: null }, storage: { ready: false, variable: '' } } };
        return null;
      },
    });
    const title = await abrirTarefaEditada(page, 'Filha editada');
    await page.getByRole('link', { name: /subtarefa de A mãe/ }).click();
    await janela(page).waitFor();
    assert.equal(page.url(), BASE + '/tarefa/' + row.id);
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await page.waitForURL(BASE + '/tarefa/mae-1');
    await campoTitulo(page).waitFor();
    await pause(300);
    assert.equal(await lerTitulo(title), 'A mãe');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, '/api/board/tasks/' + row.id, 'a gravação é da filha');
    assert.equal(await page.getByText('há alterações por salvar', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Há um rascunho do título', { exact: false }).count(), 0);
    await page.getByRole('button', X).click();
    await page.waitForURL(BASE + '/tarefa/' + row.id);
  });

  await cenario('12', 'o chip salva na hora e não segura a saída (no painel ao lado e na página)', async (abrir) => {
    const { page, writes } = await abrir();
    await page.goto(BASE + '/meu-trabalho');
    // F43, Fase 7: a linha abre a ficha AO LADO — a saída do painel (o ✕) é a
    // primeira a provar; depois a da página cheia, pelo X, como antes.
    await page.getByRole('link', { name: row.title, exact: true }).click();
    await campoTitulo(page).waitFor();
    await page.locator('.cu-chip', { hasText: 'Alta' }).first().click();
    await page.getByRole('menuitemcheckbox', { name: 'Urgente', exact: true }).click();
    await pause(300);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.priority, 'urgent');
    await fecharFicha(page).click();
    await page.waitForURL(BASE + '/meu-trabalho');
    assert.equal(await janela(page).count(), 0);
    await page.getByRole('link', { name: row.title, exact: true }).click();
    await abrirEmTelaCheia(page);
    await page.locator('.cu-chip', { hasText: 'Alta' }).first().click();
    await page.getByRole('menuitemcheckbox', { name: 'Urgente', exact: true }).click();
    await pause(300);
    assert.equal(writes.length, 2);
    await page.getByRole('button', X).click();
    await page.waitForURL(BASE + '/meu-trabalho');
    assert.equal(await janela(page).count(), 0);
  });

  await cenario('13', 'outro Voltar durante a gravação não duplica nada: uma gravação, um destino', async (abrir) => {
    const { page, writes } = await abrir({ custom: async (url, req) => { if (req.method() === 'PATCH') await pause(500); return null; } });
    await abrirTarefaEditada(page, 'Duas saídas');
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await pause(100);
    await page.goBack({ timeout: 2000 }).catch(() => {});
    await page.waitForURL(BASE + '/meu-trabalho');
    await pause(500);
    assert.equal(writes.length, 1);
    assert.equal(new URL(page.url()).pathname, '/meu-trabalho');
    assert.equal(await janela(page).count(), 0);
  });

  /* ───────────────── os da verificação ───────────────── */

  await cenario('V1', 'a trilha passa pela decisão; Continuar mantém; Descartar leva a /quadro/l1', async (abrir) => {
    const { page, writes, erros } = await abrir({ custom: fichaCompleta });
    const title = await abrirTarefaEditada(page, 'Pela trilha');
    const trilha = page.getByRole('navigation', { name: 'Trilha' });
    await trilha.waitFor();
    const degrau = trilha.getByRole('link', { name: 'FOCUS (Vídeos)' });
    await degrau.waitFor();
    await degrau.click();
    await janela(page).waitFor();
    assert.equal(new URL(page.url()).pathname, '/tarefa/' + row.id);
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(await lerTitulo(title), 'Pela trilha');
    const focoVisivel = await page.evaluate(() => { const a = document.activeElement; return a === document.body || (a && a.getClientRects().length > 0); });
    assert.equal(focoVisivel, true, 'o foco não fica preso em nada invisível');
    await degrau.click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await page.waitForURL(/\/quadro\/l1/);
    assert.equal(writes.length, 0);
    assert.deepEqual(erros.filter((m) => /blocker/i.test(m)), []);
  });

  await cenario('V2', 'link de subtarefa passa pela decisão; Salvar e sair grava na mãe e abre a filha limpa', async (abrir) => {
    const { page, writes, erros } = await abrir({ custom: fichaCompleta });
    const title = await abrirTarefaEditada(page, 'Mãe editada');
    await page.getByRole('link', { name: 'A subtarefa', exact: true }).click();
    await janela(page).waitFor();
    assert.equal(new URL(page.url()).pathname, '/tarefa/' + row.id);
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await page.waitForURL(BASE + '/tarefa/sub-1');
    await pause(300);
    assert.equal(await lerTitulo(title), 'Tarefa sub-1');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, '/api/board/tasks/' + row.id);
    assert.equal(writes[0].body.title, 'Mãe editada');
    assert.equal(await page.getByText('há alterações por salvar', { exact: true }).count(), 0);
    assert.equal(await beforeunloadArmado(page), false, 'na filha limpa o aviso nativo está desarmado');
    assert.deepEqual(erros, []);
  });

  await cenario('V3', 'Descartar e sair apaga só o rascunho da tarefa atual; o de outra ficha fica', async (abrir) => {
    const { page } = await abrir();
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('link', { name: row.title, exact: true }).waitFor();
    const chaveA = 'ideworks:rascunho:v2:u-ana:tarefa:outra-a';
    await page.evaluate((k) => sessionStorage.setItem(k, JSON.stringify({ versao: 2, usuario: 'u-ana', ficha: 'tarefa:outra-a', valor: { title: 'Rascunho de A', description: '' }, guardadoEm: new Date().toISOString() })), chaveA);
    await page.getByRole('link', { name: row.title, exact: true }).click();
    const title = campoTitulo(page);
    await title.waitFor();
    await title.fill('Rascunho de B');
    await pause(700);
    const chaveB = 'ideworks:rascunho:v2:u-ana:tarefa:' + row.id;
    assert.notEqual(await page.evaluate((k) => sessionStorage.getItem(k), chaveB), null, 'B tem rascunho gravado antes de sair');
    // F43, Fase 7: a linha abre a ficha AO LADO; a saída é o ✕ do painel, e o
    // que se prova aqui (Descartar apaga só o rascunho DESTA ficha) é o mesmo.
    await fecharFicha(page).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await page.waitForURL(BASE + '/meu-trabalho');
    await pause(200);
    assert.equal(await page.evaluate((k) => sessionStorage.getItem(k), chaveB), null, 'o rascunho de B foi embora');
    const a = await page.evaluate((k) => sessionStorage.getItem(k), chaveA);
    assert.notEqual(a, null, 'o rascunho de A continua');
    assert.equal(JSON.parse(a).valor.title, 'Rascunho de A');
  });

  await cenario('V4', 'depois do Salvar normal: aviso nativo desarmado, rascunho local apagado, X sai na hora', async (abrir) => {
    const { page, writes } = await abrir();
    await abrirTarefaEditada(page, 'Salvo pelo botão');
    await pause(700);
    assert.equal(await beforeunloadArmado(page), true, 'armado com alteração');
    await page.getByRole('button', { name: 'Salvar', exact: true, disabled: false }).first().click();
    await page.getByText('Salvo.', { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(await beforeunloadArmado(page), false, 'desarmado depois do Salvar');
    await pause(700);
    assert.equal(await page.evaluate((k) => sessionStorage.getItem(k), 'ideworks:rascunho:v2:u-ana:tarefa:' + row.id), null, 'rascunho local apagado');
    await page.getByRole('button', X).click();
    await page.waitForURL(BASE + '/meu-trabalho');
    assert.equal(await janela(page).count(), 0);
  });

  await cenario('V5', 'Esc e clique fora DURANTE a gravação não entram; a gravação conclui e sai uma vez', async (abrir) => {
    const { page, writes } = await abrir({ custom: async (url, req) => { if (req.method() === 'PATCH') await pause(700); return null; } });
    await abrirTarefaEditada(page, 'Esc no meio');
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Salvar e sair', exact: true }).click();
    await janela(page).getByRole('button', { name: 'salvando…', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await pause(100);
    assert.equal(await janela(page).count(), 1, 'a janela continua enquanto grava');
    assert.equal(new URL(page.url()).pathname, '/tarefa/' + row.id);
    await page.waitForURL(BASE + '/meu-trabalho');
    assert.equal(writes.length, 1);
  });

  await cenario('V6', 'voltar/avançar do navegador sem alteração é imediato; idx do histórico coerente; nenhum aviso do roteador', async (abrir) => {
    const { page, erros } = await abrir();
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('link', { name: row.title, exact: true }).click();
    await campoTitulo(page).waitFor();
    assert.equal(await page.evaluate(() => history.state?.idx), 1, 'idx=1 depois da primeira navegação interna');
    await page.goBack();
    await page.waitForURL(BASE + '/meu-trabalho');
    await page.goForward();
    await page.waitForURL(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    assert.equal(await page.evaluate(() => history.state?.idx), 1);
    await page.goBack();
    await page.waitForURL(BASE + '/meu-trabalho');
    assert.equal(await janela(page).count(), 0);
    assert.deepEqual(erros.filter((m) => /router|blocker/i.test(m)), []);
  });

  await cenario('V7', 'por link direto, a decisão preserva o destino interno seguro (/quadro/l1)', async (abrir) => {
    const { page } = await abrir({ custom: fichaCompleta });
    await page.goto(BASE + '/tarefa/' + row.id);
    const title = campoTitulo(page);
    await title.waitFor();
    await pause(300);
    await title.fill('Direto e editado');
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await page.waitForURL(/\/quadro\/l1$/);
  });

  await cenario('V8', 'rotas públicas e o coringa continuam nos mesmos endereços', async (abrir) => {
    const { page } = await abrir({ custom: (url) => (url.pathname === '/api/auth/me' ? { status: 401, body: { ok: false, message: 'sem sessão' } } : null) });
    await page.goto(BASE + '/');
    await page.locator('input[type="email"]').waitFor();
    await page.goto(BASE + '/redefinir');
    await pause(300);
    assert.equal(new URL(page.url()).pathname, '/redefinir');
    await page.goto(BASE + '/nao-existe-mesmo');
    await pause(500);
    assert.equal(new URL(page.url()).pathname, '/nao-existe-mesmo');
    assert.ok(/não encontrad|nao encontrad|404/i.test(await page.content()), 'a tela de não encontrado desenha');
  });

  await cenario('V9', 'Voltar do navegador → Continuar → Voltar de novo: histórico íntegro, sem aviso do roteador', async (abrir) => {
    const { page, erros } = await abrir();
    await page.goto(BASE + '/avisos');
    await pause(300);
    await page.goto(BASE + '/meu-trabalho');
    await page.getByRole('link', { name: row.title, exact: true }).click();
    const title = campoTitulo(page);
    await title.waitFor();
    await title.fill('POP e continuar');
    await page.getByText('há alterações por salvar', { exact: true }).waitFor();
    const idxAntes = await page.evaluate(() => history.state?.idx);
    await pause(300);
    await page.goBack();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    await pause(300);
    assert.equal(new URL(page.url()).pathname, '/tarefa/' + row.id);
    assert.equal(await lerTitulo(title), 'POP e continuar');
    assert.equal(await page.evaluate(() => history.state?.idx), idxAntes, 'idx igual depois de Continuar');
    // A porta do app — o X desde a F29 (era o `‹ Voltar`; o mesmo `comoVoltar`).
    // F43, Fase 7: a linha abre a ficha AO LADO, e a porta dela é o ✕ do
    // painel — que também é voltar um passo, e passa pela mesma decisão.
    await fecharFicha(page).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    await pause(300);
    await page.goBack();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Descartar e sair', exact: true }).click();
    await page.waitForURL(BASE + '/meu-trabalho');
    await pause(300);
    assert.equal(await page.evaluate(() => history.state?.idx), idxAntes - 1, 'voltou exatamente um passo');
    assert.deepEqual(erros.filter((a) => /router|blocker/i.test(a)), []);
    return `idx ${idxAntes} → ${idxAntes - 1}`;
  });

  /* ─────────── F07 do plano UX: a ficha como documento ─────────── */

  const LONGO = Array.from({ length: 14 }, (_, i) => `Parágrafo ${i + 1} do briefing, com texto suficiente para quebrar em mais de uma linha no celular e obrigar a rolar.`).join('\n\n');
  const fichaF07 = (extra = {}) => (url, req) => {
    const r = fichaCompleta(url, req);
    if (r === null) return null;
    const patch = req.method() === 'PATCH' ? req.postDataJSON() ?? {} : {};
    r.body.task = {
      ...r.body.task,
      description: patch.description ?? LONGO,
      tags: [{ id: 'g1', name: 'arte', bgColor: '#A18072', fgColor: '#fff' }, { id: 'g2', name: 'urgente', bgColor: '#e5484d', fgColor: '#fff' }],
      ...extra,
    };
    r.body.storage = { ready: false, variable: 'VARIAVEL_DE_TESTE_F07' };
    return r;
  };
  const medirSalvar = (page) =>
    page.evaluate(() => {
      const cab = document.querySelector('.t-cabeca').getBoundingClientRect();
      const b = [...document.querySelectorAll('.cu-trilha button')].find((x) => x.textContent.trim() === 'Salvar');
      const r = b.getBoundingClientRect();
      const x = document.querySelector('[aria-label="Fechar tarefa e voltar"]').getBoundingClientRect();
      return {
        cabBase: Math.round(cab.bottom), topo: Math.round(r.top), base: Math.round(r.bottom),
        xDentro: x.top >= 0 && x.bottom <= innerHeight && x.right <= innerWidth,
        janela: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, rolagem: Math.round(scrollY),
      };
    });

  await cenario('F07-1', 'celular com teclado aberto (390×360): com texto por salvar, Salvar e X continuam à vista ao rolar o briefing; salvar grava uma vez', async (abrir) => {
    const { page, writes } = await abrir({ viewport: { width: 390, height: 360 }, custom: fichaF07() });
    await page.goto(BASE + '/tarefa/' + row.id);
    const title = campoTitulo(page);
    await title.waitFor();
    const parado = await page.locator('.cu-trilha').getAttribute('data-por-salvar');
    assert.equal(parado, 'false', 'sem alteração a linha de controle não gruda');
    await title.fill('Título novo no celular');
    await page.getByText('há alterações por salvar', { exact: true }).waitFor();
    // O briefing rola para longe; a linha do Salvar gruda logo abaixo do cabeçalho.
    await page.locator('.cu-editor').click({ position: { x: 20, y: 20 } });
    await page.evaluate(() => window.scrollTo(0, 900));
    await pause(200);
    const m = await medirSalvar(page);
    assert.ok(m.rolagem > 400, 'a página rolou: ' + JSON.stringify(m));
    assert.ok(m.topo >= m.cabBase - 1, 'Salvar não fica atrás do cabeçalho: ' + JSON.stringify(m));
    assert.ok(m.base <= m.janela, 'Salvar dentro da janela: ' + JSON.stringify(m));
    assert.ok(m.xDentro, 'X dentro da janela');
    assert.equal(m.sw, m.iw, 'sem rolagem lateral');
    await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
    await page.getByText('há alterações por salvar', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.title, 'Título novo no celular');
    assert.equal(await page.locator('.cu-trilha').getAttribute('data-por-salvar'), 'false');
    return `Salvar em y=${m.topo} (cabeçalho até ${m.cabBase}) com rolagem ${m.rolagem}`;
  });

  await cenario('F07-2', 'zoom de 200% (1440 → 720×450 CSS): X, título e Salvar alcançáveis e sem rolagem lateral', async (abrir) => {
    const { page } = await abrir({ viewport: { width: 720, height: 450 }, custom: fichaF07() });
    await page.goto(BASE + '/tarefa/' + row.id);
    const title = campoTitulo(page);
    await title.waitFor();
    await title.fill('Com zoom');
    await page.getByText('há alterações por salvar', { exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 700));
    await pause(200);
    const m = await medirSalvar(page);
    assert.ok(m.topo >= m.cabBase - 1 && m.base <= m.janela, JSON.stringify(m));
    assert.ok(m.xDentro, 'X dentro da janela');
    assert.equal(m.sw, m.iw, 'sem rolagem lateral');
    // O X continua sendo a porta: pergunta antes de descartar.
    await page.getByRole('button', X).click();
    await janela(page).waitFor();
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    assert.equal(await lerTitulo(title), 'Com zoom');
  });

  await cenario('F07-3', '320 px: a trilha para na lista (o título diz o nome) e nada transborda; título longo quebra em linhas', async (abrir) => {
    const longo = 'Gravar depoimento da Dra. Márcia para a campanha institucional de aniversário de 25 anos da clínica, com versão curta';
    const { page } = await abrir({ viewport: { width: 320, height: 700 }, custom: fichaF07({ title: longo }) });
    await page.goto(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    await pause(300);
    const m = await page.evaluate(() => {
      const ult = document.querySelector('.t-cabeca .tr-trilha li:last-child');
      const lista = [...document.querySelectorAll('.t-cabeca .tr-trilha .tr-degrau')].find((d) => d.textContent.includes('FOCUS (Vídeos)'));
      const t = document.querySelector('[aria-label="Título da tarefa"]').getBoundingClientRect();
      return {
        ultimoOculto: getComputedStyle(ult).display === 'none',
        lista: lista ? Math.round(lista.getBoundingClientRect().width) : 0,
        tituloAltura: Math.round(t.height), tituloDireita: Math.round(t.right),
        sw: document.documentElement.scrollWidth, iw: innerWidth,
      };
    });
    assert.ok(m.ultimoOculto, 'o degrau da própria tarefa sai no celular');
    assert.ok(m.lista >= 60, 'a lista fica legível: ' + m.lista + ' px');
    assert.ok(m.tituloAltura > 60, 'o título longo quebra em linhas');
    assert.ok(m.tituloDireita <= m.iw, 'o título não passa da borda');
    assert.equal(m.sw, m.iw, 'sem rolagem lateral');
    return `lista ${m.lista} px · título ${m.tituloAltura} px`;
  });

  await cenario('F07-4', 'uma propriedade por linha, sem repetição; prazo com palavra; anexo indisponível sem detalhe de configuração à vista', async (abrir) => {
    const { page, writes } = await abrir({ custom: fichaF07({ dueOn: '2020-01-10', completedAt: null }) });
    await page.goto(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    const nomes = await page.locator('.t-props dt').allTextContents();
    // F43, Fase 6: "Status" virou "Etapa" (o vocabulário do plano); a ordem é a mesma.
    assert.deepEqual(nomes.slice(0, 5), ['Etapa', 'Responsáveis', 'Prazo', 'Prioridade', 'Etiquetas']);
    // Etiquetas: só dentro do botão que as troca; nenhuma cópia solta.
    assert.equal(await page.locator('.cu-ficha .cu-etiqueta').count(), 2);
    assert.equal(await page.getByRole('button', { name: 'Etiquetas: arte, urgente', exact: true }).count(), 1);
    // Prazo: uma peça só, com a palavra; nada de "10/01/2020 · atrasada" ao lado.
    const prazo = page.locator('.cu-chip[data-prazo]');
    assert.equal(await prazo.getAttribute('data-prazo'), 'atrasada');
    assert.match(await prazo.textContent(), /^Atrasada · 10\/01\/2020$/);
    assert.equal(await page.getByText('· atrasada', { exact: false }).count(), 0);
    // O contrato dito uma vez. F43, Fase 6: ele saiu da tela e mora no `?` ao
    // lado do estado do texto ("Salvo" / "há alterações por salvar"); fechado
    // ele não aparece, e um clique o abre com a mesma frase.
    assert.equal(await page.getByText('gravam ao escolher', { exact: false }).count(), 0, 'a frase não fica à vista');
    await page.locator('.cu-trilha .t-estado', { hasText: 'Salvo' }).waitFor();
    await page.getByRole('button', { name: 'Explicar: quando a tarefa grava', exact: true }).click();
    await page.getByRole('dialog', { name: 'quando a tarefa grava' }).getByText('gravam ao escolher', { exact: false }).waitFor();
    await page.keyboard.press('Escape');
    // Anexo indisponível: a frase fala com quem usa; a variável só no `?`, rotulada.
    // F43, Fase 6: sem anexo nem link, a seção nasce recolhida na linha "+" —
    // o "+ Anexo" a abre, e o resto do percurso é o de sempre.
    await page.getByRole('button', { name: 'Adicionar anexo', exact: true }).click();
    const corpo = await page.locator('body').innerText();
    assert.ok(!corpo.includes('VARIAVEL_DE_TESTE_F07'), 'a variável não aparece sem pedir');
    const titulo = await page.getByRole('button', { name: 'Anexar arquivo' }).getAttribute('title');
    assert.ok(!titulo.includes('VARIAVEL'), 'a dica do botão não cita configuração');
    await page.getByRole('button', { name: 'Explicar: por que o envio está desligado' }).click();
    await page.getByText('Para quem administra o sistema', { exact: false }).waitFor();
    assert.equal(writes.length, 0);
  });

  return resultados;
}
