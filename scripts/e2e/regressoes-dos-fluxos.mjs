/**
 * `docs/auditoria-2026-09-09/reproduzir-fluxos.mjs`, INVERTIDO — F17.AUD08.
 *
 * O script da auditoria afirma o DEFEITO: cada asserção dele passa quando o
 * sistema erra. Ele fica onde está, intacto, como prova do que havia em
 * `96415d6`. Este arquivo é o espelho: os mesmos sete percursos (A1, B1, M1,
 * M2, A2, A3, A4), com as asserções viradas para o comportamento correto.
 * Se um dia voltar a falhar aqui, o achado correspondente reabriu.
 *
 * Os ids são os do `resultados.json` da auditoria, para a rastreabilidade
 * ser direta: `A4` lá é `A4` aqui.
 */

import assert from 'node:assert/strict';

import { rotasDoControle } from './controle-da-semana.mjs';
import { BASE, X, abrirTarefaEditada, campoTitulo, criarSuite, detail, esperarTitulo, fecharFicha, janela, lerTitulo, painelDaFicha, pause, quadroVazio, row, sessaoDe } from './comum.mjs';

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('A1', 'achado 3 — fechar com edição PERGUNTA antes, e não perde o texto', async (abrir) => {
    const { page, writes } = await abrir();
    const title = await abrirTarefaEditada(page);
    await page.getByRole('button', X).click();
    // Antes: a tela voltava para a lista e o título original reaparecia.
    await janela(page).waitFor();
    assert.equal(new URL(page.url()).pathname, '/tarefa/' + row.id, 'ainda na tarefa enquanto se decide');
    await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
    await janela(page).waitFor({ state: 'hidden' });
    assert.equal(await lerTitulo(title), 'EDIÇÃO QUE NÃO PODE SUMIR');
    assert.equal(writes.length, 0, 'continuar editando não grava nada');
    return 'o X abre "Sair sem salvar?"; Continuar editando mantém o texto e o endereço';
  });

  await cenario('B1', 'achado 9 — depois de rolar a ficha, o X continua dentro da janela', async (abrir) => {
    const { page } = await abrir();
    await page.goto(BASE + '/tarefa/' + row.id);
    await page.getByRole('button', X).waitFor();
    await page.evaluate(() => scrollTo(0, 600));
    await pause(150);
    const rect = await page.getByRole('button', X).boundingBox();
    // Antes: y = -93 px (acima da janela).
    assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= 900, `X dentro da janela: y=${rect?.y}`);
    return `topo do X em y=${Math.round(rect.y)}px com 600px de rolagem`;
  });

  await cenario('M1', 'achado 6 — a busca antiga, chegando depois, NÃO substitui a nova', async (abrir) => {
    const { page } = await abrir({
      custom: async (url) => {
        if (url.pathname !== '/api/board/all-tasks') return null;
        const q = url.searchParams.get('busca') ?? '';
        if (q === 'antiga') await pause(1800);
        const t = { ...row, title: q || row.title };
        return { body: { ok: true, work: { rows: [t], total: 1, matched: 1, capped: false, assigneeOptions: [], unassignedTasks: 0 } } };
      },
    });
    await page.goto(BASE + '/tarefas');
    await page.getByRole('link', { name: row.title, exact: true }).waitFor();
    const field = page.getByRole('textbox', { name: 'Buscar tarefa pelo nome', exact: true });
    // A espera é registrada ANTES da ação: com o Vite frio o pedido sai antes
    // de um `waitForRequest` registrado depois do Enter, e a espera nunca volta.
    const pedidoAntiga = page.waitForRequest((r) => r.url().includes('busca=antiga'));
    await field.fill('antiga');
    await field.press('Enter');
    await pedidoAntiga;
    await field.fill('nova');
    await field.press('Enter');
    await page.getByRole('link', { name: 'nova', exact: true }).waitFor();
    // A resposta atrasada de "antiga" chega agora. Antes: a lista virava "antiga".
    await pause(2200);
    assert.equal(await page.getByRole('link', { name: 'antiga', exact: true }).count(), 0, '"antiga" não aparece');
    assert.equal(await page.getByRole('link', { name: 'nova', exact: true }).count(), 1);
    assert.equal(await field.inputValue(), 'nova');
    assert.ok(page.url().includes('busca=nova'));
    return 'campo, endereço e lista dizem "nova" depois de a resposta de "antiga" chegar';
  });

  await cenario('M2', 'achado 5 — renovação indisponível (503) mantém a tela e oferece tentar de novo', async (abrir) => {
    let indisponivel = true;
    const { page } = await abrir({
      custom: (url) => {
        if (url.pathname === '/api/board/my-tasks' && indisponivel) return { status: 401, body: { message: 'Sessão expirada' } };
        if (url.pathname === '/api/auth/refresh')
          return indisponivel
            ? { status: 503, body: { message: 'Não foi possível renovar agora. Tente de novo.' } }
            : { status: 200, body: { ok: true } };
        return null;
      },
    });
    await page.goto(BASE + '/meu-trabalho');
    // Antes: `waitForURL('/')` — a tela ia para o login.
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).waitFor({ timeout: 5000 });
    assert.equal(new URL(page.url()).pathname, '/meu-trabalho', 'continua na rota');
    await page.getByText('Não foi possível renovar agora. Tente de novo.', { exact: false }).waitFor();
    // A renovação volta: Tentar de novo relê e a lista aparece.
    indisponivel = false;
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await page.getByRole('link', { name: row.title, exact: true }).waitFor({ timeout: 5000 });
    return 'ficou em /meu-trabalho com a frase do refresh; Tentar de novo trouxe a lista';
  });

  await cenario('A2', 'achado 4 — 500 concluídas não escondem a pendente: a aba é filtrada no servidor', async (abrir) => {
    // O servidor (AUD05) filtra a aba ANTES do teto e devolve as contagens das
    // três abas. A tela (AUD06) pede `?aba=` e mostra `counts`, não o tamanho
    // do lote. Aqui: 500 feitas e UMA pendente com prazo posterior.
    const feitas = Array.from({ length: 100 }, (_, i) => ({ ...row, id: 'done' + i, title: 'Concluída ' + i, completedAt: '2026-08-01T00:00:00Z', statusType: 'closed' }));
    const pendente = { ...row, id: 'p-501', title: 'A pendente depois do teto', dueOn: '2026-12-01' };
    const counts = { pendente: 1, feito: 500, delegado: 0 };
    const { page, pedidos } = await abrir({
      custom: (url) => {
        if (url.pathname !== '/api/board/my-tasks') return null;
        const aba = url.searchParams.get('aba');
        if (aba === 'pendente')
          return { body: { ok: true, work: { rows: [pendente], total: 1, capped: false, aba, counts, returned: 1, hasMore: false, nextCursor: null } } };
        if (aba === 'feito')
          return { body: { ok: true, work: { rows: feitas, total: 500, capped: false, aba, counts, returned: 100, hasMore: true, nextCursor: 'c1' } } };
        return { body: { ok: true, work: { rows: [], total: 0, capped: false, aba, counts, returned: 0, hasMore: false, nextCursor: null } } };
      },
    });
    await page.goto(BASE + '/meu-trabalho');
    // Antes: `Pendente 0` e `Feito 500`, sem aviso.
    await page.getByRole('tab', { name: /^Pendente\s*1$/ }).waitFor({ timeout: 5000 });
    assert.equal(await page.getByRole('tab', { name: /^Feito\s*500$/ }).count(), 1);
    await page.getByRole('link', { name: pendente.title, exact: true }).waitFor();
    assert.ok(pedidos.every((p) => p.aba !== null), 'todo pedido leva a aba: ' + JSON.stringify(pedidos));
    await page.getByRole('link', { name: pendente.title, exact: true }).click();
    await page.waitForURL('**/tarefa/p-501');
    return `abas Pendente 1 / Feito 500; a pendente abre; pedidos ${JSON.stringify(pedidos.map((p) => p.aba))}`;
  });

  await cenario('A3', 'achado 2 — o rascunho do cadastro NÃO atravessa a troca de usuário na mesma aba', async (abrir) => {
    let userId = 'u-ana';
    const { page } = await abrir({
      custom: (url) => (url.pathname === '/api/auth/me' ? { body: sessaoDe(userId) } : null),
    });
    await page.goto(BASE + '/painel');
    await page.getByRole('button', { name: 'Novo cliente' }).waitFor();
    await page.waitForLoadState('networkidle');
    // A guarda o rascunho pelo módulo real (formato v2, com dono), e ao lado
    // dele um rascunho LEGADO sem dono, como os que existiam antes da AUD02.
    const chaves = await page.evaluate(async () => {
      const m = await import('/src/ui/rascunho.ts');
      if (m.donoConfirmado() !== 'u-ana') throw new Error('dono não confirmado: ' + m.donoConfirmado());
      m.guardarRascunho({ usuario: 'u-ana', tipo: 'cliente', id: null }, { name: 'Cliente confidencial do usuário A' });
      sessionStorage.setItem('ideworks:rascunho:cliente:novo', JSON.stringify({ valor: { name: 'Legado sem dono' }, guardadoEm: new Date().toISOString() }));
      return Object.keys(sessionStorage).filter((k) => k.startsWith('ideworks:rascunho:')).sort();
    });
    assert.deepEqual(chaves, ['ideworks:rascunho:cliente:novo', 'ideworks:rascunho:v2:u-ana:cliente:novo']);

    // A sai pelo botão real: `limparAoSair()` roda ANTES de o servidor responder.
    // F29: o `Sair` saiu do cabeçalho do Painel para o menu da conta, no pé.
    await page.locator('.bl-conta').click();
    await page.getByRole('menuitem', { name: 'Sair', exact: true }).click();
    await page.waitForURL(BASE + '/');
    const depoisDeSair = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('ideworks:rascunho:')));
    assert.deepEqual(depoisDeSair, [], 'sair apaga os rascunhos da aba, inclusive o legado');

    // B entra na mesma aba. Antes: `lerRascunho` devolvia o rascunho de A.
    userId = 'u-bia';
    await page.goto(BASE + '/painel');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    await page.getByRole('dialog', { name: 'Novo cliente' }).waitFor();
    await page.getByLabel('Nome do cliente *').waitFor();
    await pause(600);
    assert.equal(await page.getByRole('button', { name: 'Recuperar rascunho', exact: true }).count(), 0, 'nada é oferecido a B');
    assert.equal(await page.getByLabel('Nome do cliente *').inputValue(), '');
    const leituraComoA = await page.evaluate(async () => {
      const m = await import('/src/ui/rascunho.ts');
      return { dono: m.donoConfirmado(), deA: m.lerRascunho({ usuario: 'u-ana', tipo: 'cliente', id: null }) };
    });
    assert.equal(leituraComoA.dono, 'u-bia');
    assert.equal(leituraComoA.deA, null, 'a leitura como A é inerte com outro dono');
    return 'Sair apagou os dois rascunhos; B não recebe oferta; ler como A devolve null';
  });

  await cenario('A3-legado', 'achado 2 — um rascunho legado sem dono é invalidado ao confirmar a identidade, nunca oferecido', async (abrir) => {
    const { page, context } = await abrir();
    // O legado é plantado ANTES de a página carregar: é o estado de quem tinha
    // um rascunho aberto no dia da publicação.
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('e2e:plantado')) {
        sessionStorage.setItem('ideworks:rascunho:cliente:novo', JSON.stringify({ valor: { name: 'Legado sem dono' }, guardadoEm: new Date().toISOString() }));
        sessionStorage.setItem('e2e:plantado', '1');
      }
    });
    await page.goto(BASE + '/painel');
    await page.getByRole('button', { name: 'Novo cliente' }).waitFor();
    await page.waitForLoadState('networkidle');
    const chaves = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('ideworks:rascunho:')));
    assert.deepEqual(chaves, [], 'a confirmação da identidade apagou a chave legada');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    await page.getByLabel('Nome do cliente *').waitFor();
    await pause(600);
    assert.equal(await page.getByRole('button', { name: 'Recuperar rascunho', exact: true }).count(), 0);
    return 'a chave `ideworks:rascunho:cliente:novo` some na primeira /auth/me e não vira oferta';
  });

  await cenario('A4', 'achado 1 — a resposta atrasada da mãe não entra na URL da filha; Salvar grava na filha', async (abrir) => {
    let delayParent = false;
    const { page, writes } = await abrir({
      custom: async (url, req) => {
        if (!url.pathname.startsWith('/api/board/tasks/')) return null;
        const id = url.pathname.split('/').pop();
        if (id === 'parent' && delayParent && req.method() === 'GET') await pause(1400);
        const patch = req.method() === 'PATCH' ? req.postDataJSON() ?? {} : {};
        return {
          body: {
            ok: true,
            task: { ...detail, id, title: patch.title ?? (id === 'parent' ? 'Tarefa mãe' : 'Tarefa filha'), parentId: id === 'child' ? 'parent' : null, parentTitle: 'Tarefa mãe' },
            storage: { ready: false, variable: '' },
          },
        };
      },
    });
    await page.goto(BASE + '/tarefa/child');
    await page.getByRole('link', { name: 'subtarefa de Tarefa mãe', exact: true }).waitFor();
    delayParent = true;
    const request = page.waitForRequest((r) => r.url().endsWith('/board/tasks/parent'));
    await page.getByRole('link', { name: 'subtarefa de Tarefa mãe', exact: true }).click();
    await request;
    await page.goBack();
    await page.waitForURL('**/tarefa/child');
    await esperarTitulo(page, 'Tarefa filha');
    // A resposta atrasada da mãe chega agora. Antes: o título virava "Tarefa mãe".
    await pause(1800);
    assert.equal(await lerTitulo(campoTitulo(page)), 'Tarefa filha', 'a ficha continua sendo a filha');
    await campoTitulo(page).fill('Edição na URL da filha');
    // A espera começa ANTES do clique: a resposta simulada é imediata e chegava
    // antes de `waitForResponse` começar a ouvir — o cenário vencia o prazo com
    // a gravação certa já feita.
    const gravou = page.waitForResponse((r) => r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
    await gravou;
    await pause(200);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].url, '/api/board/tasks/child', 'a gravação vai para a filha');
    assert.equal(writes[0].body.title, 'Edição na URL da filha');
    return 'depois da resposta atrasada da mãe o título segue "Tarefa filha"; PATCH foi para /tasks/child';
  });

  /* ─────────────── F10 do plano UX — notificações ───────────────
     Uma caixa simulada com estado: `avisos` muda com cada POST de leitura, e o
     cenário escolhe se a escrita falha e quanto ela demora. */
  const caixaSimulada = ({ falharMarcar = false, atrasoMarcar = 0, falharLeitura = 0, lista } = {}) => {
    const avisos = (lista ?? [
      { key: 'automation:1', tipo: 'automacao', taskId: 'tarefa-um', taskTitle: 'Post do dia das crianças', listName: 'Criação', clientName: 'Sabor Doce', occurredAt: new Date(Date.now() - 3600e3).toISOString(), dueOn: null, automationName: 'Passa para criação', fromListName: null, toListName: 'Criação', toStatusName: null, seen: false },
      { key: 'automation:2', tipo: 'automacao', taskId: 'tarefa-dois', taskTitle: 'Vídeo institucional', listName: 'Audiovisual', clientName: 'Clinimax', occurredAt: new Date(Date.now() - 7200e3).toISOString(), dueOn: null, automationName: null, fromListName: null, toListName: 'Audiovisual', toStatusName: null, seen: false },
    ]).map((a) => ({ ...a }));
    const posts = [];
    // Enquanto `controle.falharLeitura` for verdadeiro, toda leitura falha (o
    // modo dev do React lê duas vezes na montagem; contar leituras seria frágil).
    const controle = { falharLeitura: Boolean(falharLeitura) };
    const corpo = (vistos) => ({
      ok: true,
      notices: { notices: vistos ? avisos.slice() : avisos.filter((a) => !a.seen), unread: avisos.filter((a) => !a.seen).length, capped: false },
    });
    const custom = async (url, req) => {
      const p = url.pathname;
      if (p === '/api/board/notices/count') return { body: { ok: true, unread: avisos.filter((a) => !a.seen).length } };
      if (p === '/api/board/notices') {
        if (controle.falharLeitura) {
          return { status: 500, body: { ok: false, message: 'O banco não respondeu a tempo.' } };
        }
        return { body: corpo(url.searchParams.get('vistos') === '1') };
      }
      if (p === '/api/board/notices/read' && req.method() === 'POST') {
        const b = req.postDataJSON() ?? {};
        posts.push(b);
        if (atrasoMarcar) await pause(atrasoMarcar);
        if (falharMarcar) return { status: 500, body: { ok: false, message: 'O banco recusou a gravação.' } };
        const a = avisos.find((x) => x.key === b.key);
        if (a) a.seen = b.read !== false;
        return { body: corpo(url.searchParams.get('vistos') === '1') };
      }
      if (p === '/api/board/tasks/tarefa-sumida') return { status: 404, body: { ok: false, message: 'Esta tarefa não existe mais ou você não tem acesso a ela.' } };
      return null;
    };
    return { avisos, posts, custom, controle };
  };
  const linhaDoAviso = (page, titulo) => page.locator('li.av-linha').filter({ has: page.getByRole('link', { name: titulo, exact: true }) });
  const contagemNovos = async (page) =>
    (await page.getByRole('tab', { name: /Novos/ }).locator('.iw-segmento-conta').textContent())?.trim();
  const seloDaBarra = (page) =>
    page.evaluate(() => document.querySelector('.bl-item[href="/avisos"] .bl-selo')?.textContent?.trim() ?? '');

  await cenario('F10-marcar', 'marcar como visto não navega, marca SÓ aquele aviso, e o foco vai para o próximo', async (abrir) => {
    const caixa = caixaSimulada();
    const { page } = await abrir({ custom: caixa.custom });
    await page.goto(BASE + '/avisos');
    await linhaDoAviso(page, 'Post do dia das crianças').waitFor();
    assert.equal(await contagemNovos(page), '2');
    await linhaDoAviso(page, 'Post do dia das crianças').getByRole('button', { name: 'Marcar como visto', exact: true }).click();
    await linhaDoAviso(page, 'Post do dia das crianças').waitFor({ state: 'detached' });
    assert.equal(new URL(page.url()).pathname, '/avisos', 'marcar não abriu o destino');
    assert.deepEqual(caixa.posts, [{ key: 'automation:1', read: true }], 'uma escrita, só do aviso clicado');
    await linhaDoAviso(page, 'Vídeo institucional').waitFor();
    await page.waitForFunction(() => document.querySelector('[role="tab"] .iw-segmento-conta')?.textContent?.trim() === '1');
    assert.equal(await seloDaBarra(page), '1', 'a barra anda junto com a aba');
    const foco = await page.evaluate(() => document.activeElement?.closest('li.av-linha')?.getAttribute('data-aviso'));
    assert.equal(foco, 'automation:2', 'o foco foi para o botão do aviso seguinte, não para o topo');
    // "Já vistos" traz o marcado de volta, com a volta a um clique.
    await page.getByRole('tab', { name: 'Já vistos' }).click();
    await linhaDoAviso(page, 'Post do dia das crianças').getByRole('button', { name: 'Trazer de volta', exact: true }).waitFor();
    // F16: as abas são disjuntas — o aviso ainda novo não aparece em Já vistos.
    await pause(200);
    assert.equal(await linhaDoAviso(page, 'Vídeo institucional').count(), 0, 'o novo não aparece em Já vistos');
    // Trazer de volta tira a linha desta aba e a devolve a Novos.
    await linhaDoAviso(page, 'Post do dia das crianças').getByRole('button', { name: 'Trazer de volta', exact: true }).click();
    await linhaDoAviso(page, 'Post do dia das crianças').waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: /Novos/ }).click();
    await linhaDoAviso(page, 'Post do dia das crianças').waitFor();
    return 'POST só da chave clicada; /avisos mantido; Novos 2→1 na aba e na barra; foco no próximo; abas disjuntas';
  });

  await cenario('F10-corrida', 'a leitura de Novos que chega depois não apaga a lista de Já vistos', async (abrir) => {
    // Conferência de 08/10: a leitura é pedida pela vista de ANTES do clique; se a
    // resposta dela chegava depois da de Já vistos, `setAvisos` trocava a lista
    // inteira pela de Novos — e a aba de Já vistos ficava vazia até a próxima
    // leitura (30 s), embora houvesse avisos vistos.
    const caixa = caixaSimulada({
      lista: [
        { key: 'automation:1', tipo: 'automacao', taskId: 'tarefa-um', taskTitle: 'Post do dia das crianças', listName: 'Criação', clientName: 'Sabor Doce', occurredAt: new Date(Date.now() - 3600e3).toISOString(), dueOn: null, automationName: null, fromListName: null, toListName: 'Criação', toStatusName: null, seen: true },
        { key: 'automation:2', tipo: 'automacao', taskId: 'tarefa-dois', taskTitle: 'Vídeo institucional', listName: 'Audiovisual', clientName: 'Clinimax', occurredAt: new Date(Date.now() - 7200e3).toISOString(), dueOn: null, automationName: null, fromListName: null, toListName: 'Audiovisual', toStatusName: null, seen: false },
      ],
    });
    const { page } = await abrir({
      custom: async (url, req) => {
        // A leitura de Novos demora; a de Já vistos responde na hora.
        if (url.pathname === '/api/board/notices' && url.searchParams.get('vistos') !== '1') await pause(1500);
        return caixa.custom(url, req);
      },
    });
    await page.goto(BASE + '/avisos');
    await page.getByRole('tab', { name: 'Já vistos' }).click();
    await linhaDoAviso(page, 'Post do dia das crianças').waitFor();
    // A leitura lenta de Novos termina agora.
    await pause(2500);
    assert.equal(
      await linhaDoAviso(page, 'Post do dia das crianças').count(),
      1,
      'o aviso visto continua em Já vistos depois da resposta atrasada de Novos',
    );
    return 'resposta de Novos atrasada não sobrescreve a aba Já vistos';
  });

  await cenario('F10-abrir', 'abrir o destino não marca aviso nenhum', async (abrir) => {
    const caixa = caixaSimulada();
    const { page } = await abrir({ custom: caixa.custom });
    await page.goto(BASE + '/avisos');
    await page.getByRole('link', { name: 'Vídeo institucional', exact: true }).click();
    await page.waitForURL('**/tarefa/tarefa-dois');
    await pause(300);
    assert.equal(caixa.posts.length, 0, 'nenhuma escrita de "visto" ao abrir');
    return 'o título leva a /tarefa/tarefa-dois e nenhum POST /notices/read saiu';
  });

  /* F40, Fase 8 — o aviso do Controle da semana (só admin). A caixa simulada
     devolve o aviso na forma que `readNotices` calcula (`tipo: 'controle'`, sem
     tarefa, com `weekStart`); o que se prova aqui é a tela: o grupo, a frase no
     plural certo, a contagem do sino e o clique que cai na aba na semana certa. */
  await cenario('F40-aviso-controle', 'o admin vê UM aviso-resumo no sino e, ao clicar, cai na aba na semana certa', async (abrir) => {
    const caixa = caixaSimulada({
      lista: [
        { key: 'controle:2026-10-05:falta:24:atrasado:3', tipo: 'controle', taskId: '', taskTitle: 'Controle da semana', clientId: null, listName: null, clientName: null, occurredAt: null, dueOn: null, automationName: null, fromListName: null, toListName: null, toStatusName: null, clientesEmFalta: 24, clientesAtrasados: 3, weekStart: '2026-10-05', seen: false },
      ],
    });
    const controle = rotasDoControle();
    const custom = (url, req) => {
      if (url.pathname === '/api/team' || url.pathname.startsWith('/api/admin/')) {
        if (url.pathname === '/api/team') return { body: { ok: true, team: [{ id: 'u-ana', name: 'Ana Responsável' }], me: 'u-ana' } };
        return controle.handler(url, req);
      }
      return caixa.custom(url, req);
    };
    const { page } = await abrir({ custom });
    await page.goto(BASE + '/avisos');
    const grupo = page.getByRole('region', { name: 'Controle da semana' });
    await grupo.waitFor();
    assert.equal(await grupo.locator('li.av-linha').count(), 1, 'um aviso-resumo no grupo');
    const textos = await grupo.locator('.av-frase').allTextContents();
    assert.deepEqual(textos, ['24 clientes com falta nesta semana · 3 com cards atrasados']);
    assert.equal(await seloDaBarra(page), '1', 'o sino conta um');
    await grupo.locator('li.av-linha').first().getByRole('link', { name: 'Controle da semana', exact: true }).click();
    await page.waitForURL('**/controle-da-semana?semana=2026-10-05');
    await page.getByText('05 – 11/out').first().waitFor();
    assert.equal(caixa.posts.length, 0, 'abrir o destino não marca o aviso');
    return 'grupo "Controle da semana" com 1 linha, frase do resumo, sino 1, clique em /controle-da-semana?semana=2026-10-05';
  });

  await cenario('F10-falha', 'a gravação recusada devolve a linha e o contador, e diz qual aviso falhou', async (abrir) => {
    const caixa = caixaSimulada({ falharMarcar: true, atrasoMarcar: 600 });
    const { page } = await abrir({ custom: caixa.custom });
    await page.goto(BASE + '/avisos');
    await linhaDoAviso(page, 'Post do dia das crianças').getByRole('button', { name: 'Marcar como visto', exact: true }).click();
    // Na hora: a linha sai e o número cai (a tela não espera o servidor).
    await linhaDoAviso(page, 'Post do dia das crianças').waitFor({ state: 'detached', timeout: 500 });
    assert.equal(await contagemNovos(page), '1');
    // Recusa: tudo volta, e o alerta nomeia o aviso e o motivo.
    const alerta = page.getByRole('alert').filter({ hasText: 'Post do dia das crianças' });
    await alerta.waitFor();
    const texto = await alerta.textContent();
    assert.match(texto, /O banco recusou a gravação/);
    assert.match(texto, /continua em Novos/);
    await linhaDoAviso(page, 'Post do dia das crianças').getByRole('button', { name: 'Marcar como visto', exact: true }).waitFor();
    assert.equal(await contagemNovos(page), '2');
    assert.equal(await seloDaBarra(page), '2');
    assert.equal(new URL(page.url()).pathname, '/avisos');
    return 'linha e contador voltaram (2), alerta cita "Post do dia das crianças" e a frase do servidor';
  });

  await cenario('F10-leitura', 'a caixa que não carregou mostra erro com Tentar de novo, e não "Nada novo."', async (abrir) => {
    const caixa = caixaSimulada({ falharLeitura: true });
    const { page } = await abrir({ custom: caixa.custom });
    await page.goto(BASE + '/avisos');
    const alerta = page.getByRole('alert').filter({ hasText: 'O banco não respondeu a tempo.' });
    await alerta.waitFor();
    assert.equal(await page.getByText('Nada novo.').count(), 0, 'falha não vira caixa vazia');
    assert.equal(await page.getByRole('tab', { name: /Novos/ }).locator('.iw-segmento-conta').count(), 0, 'sem número antes de saber');
    caixa.controle.falharLeitura = false;
    await alerta.getByRole('button', { name: 'Tentar de novo' }).click();
    await linhaDoAviso(page, 'Post do dia das crianças').waitFor();
    return 'erro com a frase do servidor, sem "Nada novo." nem contagem; Tentar de novo trouxe a lista';
  });

  await cenario('F10-vazio', 'caixa vazia é um estado com saída para Já vistos', async (abrir) => {
    const caixa = caixaSimulada({ lista: [] });
    const { page } = await abrir({ custom: caixa.custom });
    await page.goto(BASE + '/avisos');
    await page.locator('[data-estado="vazio"]').getByText('Nada novo.').waitFor();
    assert.equal(await contagemNovos(page), '0');
    await page.getByRole('button', { name: 'Ver já vistos', exact: true }).click();
    await page.waitForURL(/ver=vistos/);
    await page.locator('[data-estado="vazio"]').getByText('Nenhuma notificação vista ainda.').waitFor();
    return 'Novos vazio → "Ver já vistos" → vazio próprio da aba';
  });

  await cenario('F10-destino-ausente', 'aviso de tarefa que sumiu: a ficha explica, sem tela em branco e sem conteúdo', async (abrir) => {
    const caixa = caixaSimulada({
      lista: [{ key: 'automation:9', tipo: 'automacao', taskId: 'tarefa-sumida', taskTitle: 'Tarefa arquivada', listName: null, clientName: null, occurredAt: new Date().toISOString(), dueOn: null, automationName: null, fromListName: null, toListName: null, toStatusName: null, seen: false }],
    });
    const { page } = await abrir({ custom: caixa.custom });
    await page.goto(BASE + '/avisos');
    await page.getByRole('link', { name: 'Tarefa arquivada', exact: true }).click();
    await page.waitForURL('**/tarefa/tarefa-sumida');
    await page.getByText('Esta tarefa não existe mais ou você não tem acesso a ela.').waitFor();
    const corpo = await page.evaluate(() => document.body.innerText.trim().length);
    assert.ok(corpo > 40, 'a tela tem conteúdo (não está em branco)');
    assert.equal(await page.getByRole('textbox', { name: 'Título da tarefa' }).count(), 0, 'nenhuma ficha desenhada');
    return 'a ficha mostra a frase do servidor (404), sem campos da tarefa';
  });

  /* ─────────────── revisão de 08/10 (quadro) — R2 ───────────────
     Defeitos achados lendo o fluxo do card; cada cenário falhava antes da
     correção que o acompanha. */

  await cenario('R2-responder-resposta', 'Responder numa RESPOSTA endereça o comentário original (o banco recusa resposta a resposta)', async (abrir) => {
    const postados = [];
    const instante = (min) => new Date(Date.UTC(2026, 9, 8, 12, min)).toISOString();
    const comentarios = [
      { id: 'c1', parentId: null, body: 'Segue a arte final', author: { id: 'u-bia', name: 'Bia' }, createdAt: instante(0), editedAt: null, replyCount: 1, mine: false, replies: [] },
      { id: 'r1', parentId: 'c1', body: 'Aprovada', author: { id: 'u-ana', name: 'Ana' }, createdAt: instante(5), editedAt: null, replyCount: 0, mine: true, replies: [] },
    ];
    const { page } = await abrir({
      custom: async (url, req) => {
        if (url.pathname === '/api/board/tasks/' + row.id + '/comments' && req.method() === 'POST') {
          const corpo = req.postDataJSON() ?? {};
          postados.push(corpo);
          // O que o banco faz: resposta a resposta é recusada (23514).
          const alvo = comentarios.find((c) => c.id === corpo.parentId);
          if (!alvo || alvo.parentId !== null) {
            return { status: 400, body: { message: 'no ClickUp a conversa tem UM nivel: responde-se ao comentario, nao a uma resposta. Responda o comentario original.' } };
          }
          return { status: 201, body: { ok: true, id: 'r2', task: { ...detail, id: row.id, comments: comentarios } } };
        }
        if (url.pathname === '/api/board/tasks/' + row.id && req.method() === 'GET') {
          return { body: { ok: true, task: { ...detail, id: row.id, title: row.title, comments: comentarios }, storage: { ready: false, variable: '' } } };
        }
        return null;
      },
    });
    await page.goto(BASE + '/tarefa/' + row.id);
    await page.getByText('Aprovada', { exact: true }).waitFor();
    // O Responder da RESPOSTA é o segundo botão "Responder" da conversa.
    await page.getByRole('button', { name: 'Responder', exact: true }).nth(1).click();
    const campo = page.locator('[role="textbox"][data-placeholder="Responder a Ana"]');
    await campo.fill('Obrigado, Ana');
    const enviou = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/comments'));
    await page.getByRole('button', { name: 'Responder', exact: true }).last().click();
    await enviou;
    assert.equal(postados.length, 1, 'um envio');
    assert.equal(postados[0].parentId, 'c1', 'o pai é o comentário original, não a resposta');
    assert.equal(await page.getByText('responde-se ao comentario').count(), 0, 'sem a recusa do banco na tela');
    return 'POST /comments com parentId do comentário original (c1) ao responder uma resposta';
  });

  await cenario('R2-data-digitada', 'digitar o prazo no campo de data grava UMA vez, com a data inteira — e não uma a cada tecla', async (abrir) => {
    const { page, writes } = await abrir({
      locale: 'en-US',
      custom: async (url, req) => {
        if (!url.pathname.startsWith('/api/board/tasks/') || req.method() !== 'PATCH') return null;
        const patch = req.postDataJSON() ?? {};
        // A rede real demora: a resposta de uma tecla chega com a pessoa já na seguinte.
        await pause(150);
        return { body: { ok: true, task: { ...detail, id: row.id, title: row.title, dueOn: patch.dueOn === undefined ? detail.dueOn : patch.dueOn }, storage: { ready: false, variable: '' } } };
      },
    });
    await page.goto(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    await page.locator('.t-prop').filter({ has: page.locator('dt', { hasText: 'Prazo' }) }).getByRole('button').first().click();
    const campo = page.getByLabel('Data de vencimento');
    await campo.waitFor();
    await campo.focus();
    // mm/dd/aaaa, a partir do primeiro segmento: 10/15/2026. O Chrome entrega um
    // valor a cada dígito (2026-01-30, 2026-10-30, 2026-10-01, 2026-10-15, 0002-10-15…).
    await page.keyboard.type('10152026');
    await pause(1500);
    const anos = writes.map((w) => Number(String(w.body.dueOn).split('-')[0]));
    assert.deepEqual(writes.map((w) => w.body), [{ dueOn: '2026-10-15' }], 'uma gravação só, com a data inteira: ' + JSON.stringify(writes.map((w) => w.body)));
    assert.ok(anos.every((a) => a >= 1000), 'nenhum ano pela metade (0002, 0020, 0202) foi gravado');
    assert.equal(await campo.inputValue(), '2026-10-15', 'o campo mostra o que foi digitado, sem voltar atrás com a resposta de uma tecla antiga');
    return 'PATCH único { dueOn: "2026-10-15" } depois de digitar 10152026';
  });

  await cenario('R2-data-digitada-fechar', 'fechar o menu logo depois de digitar o prazo ainda grava a data inteira', async (abrir) => {
    const { page, writes } = await abrir({
      locale: 'en-US',
      custom: async (url, req) => {
        if (!url.pathname.startsWith('/api/board/tasks/') || req.method() !== 'PATCH') return null;
        const patch = req.postDataJSON() ?? {};
        return { body: { ok: true, task: { ...detail, id: row.id, title: row.title, dueOn: patch.dueOn === undefined ? detail.dueOn : patch.dueOn }, storage: { ready: false, variable: '' } } };
      },
    });
    await page.goto(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    await page.locator('.t-prop').filter({ has: page.locator('dt', { hasText: 'Prazo' }) }).getByRole('button').first().click();
    const campo = page.getByLabel('Data de vencimento');
    await campo.waitFor();
    await campo.focus();
    await page.keyboard.type('10152026');
    // Antes de a espera de digitação acabar: o menu fecha e leva o texto junto.
    await page.keyboard.press('Escape');
    await campo.waitFor({ state: 'detached' });
    await pause(400);
    assert.deepEqual(writes.map((w) => w.body), [{ dueOn: '2026-10-15' }], JSON.stringify(writes.map((w) => w.body)));
    return 'Esc logo depois de digitar: PATCH único { dueOn: "2026-10-15" }';
  });

  await cenario('R2-busca-sem-acento', 'o seletor de responsável acha "João" digitando "joao"', async (abrir) => {
    const { page } = await abrir({
      custom: async (url) => {
        if (url.pathname === '/api/team') {
          return { body: { ok: true, team: [{ id: 'p-joao', name: 'João Pereira' }, { id: 'p-bia', name: 'Bia Nunes' }, { id: 'p-luiza', name: 'Ana Luíza Prado' }], me: 'p-bia' } };
        }
        return null;
      },
    });
    await page.goto(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    await page.locator('.t-prop').filter({ has: page.locator('dt', { hasText: 'Responsáveis' }) }).getByRole('button').first().click();
    const busca = page.getByRole('textbox', { name: 'Buscar pessoa', exact: true });
    const itens = page.getByRole('menuitemcheckbox');
    assert.equal(await itens.count(), 3, 'sem busca, as três pessoas');
    await busca.fill('joao');
    await itens.filter({ hasText: 'João Pereira' }).waitFor();
    assert.equal(await itens.count(), 1, 'só quem casa fica na lista');
    await busca.fill('LUIZA');
    await itens.filter({ hasText: 'Ana Luíza Prado' }).waitFor();
    assert.equal(await itens.count(), 1);
    return '"joao" acha João Pereira; "LUIZA" acha Ana Luíza Prado';
  });

  await cenario('R2-corte-com-subtarefa', 'subtarefa escondida pelo interruptor não vira "Mostrar mais" sem nada a mostrar', async (abrir) => {
    const lista = '00000000-0000-0000-0000-000000000010';
    const cartao = (id, titulo, extra = {}) => ({
      id, title: titulo, statusId: 'st-aberta', priority: null, dueOn: null, startOn: null, completedAt: null,
      hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [],
      tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
      checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0, ...extra,
    });
    // O banco conta TODA tarefa da lista: a mãe e as duas filhas são três na coluna.
    let total = 3;
    const { page } = await abrir({
      custom: (url) => {
        if (url.pathname !== '/api/board/lists/' + lista) return null;
        const quadro = quadroVazio(lista);
        quadro.tasks = [
          cartao('m', 'Tarefa mãe', { subtaskCount: 2 }),
          cartao('s1', 'Filha um', { parentId: 'm', parentTitle: 'Tarefa mãe' }),
          cartao('s2', 'Filha dois', { parentId: 'm', parentTitle: 'Tarefa mãe' }),
        ];
        quadro.columnTotals = { 'st-aberta': total, 'st-feita': 0 };
        quadro.columnMatched = { 'st-aberta': total, 'st-feita': 0 };
        return { body: { ok: true, board: quadro } };
      },
    });
    await page.goto(BASE + '/quadro/' + lista);
    await page.getByRole('link', { name: 'Tarefa mãe', exact: true }).waitFor();
    // Padrão: subtarefas escondidas — um cartão à vista, três na coluna.
    assert.equal(await page.locator('.q-cartao').count(), 1, 'só a mãe à vista');
    assert.equal(await page.locator('.q-coluna-corte').count(), 0, 'nada a buscar: as filhas chegaram, só estão escondidas');
    assert.equal(await page.getByRole('button', { name: 'Mostrar mais', exact: true }).count(), 0);
    // Ligando o interruptor, os três cartões; continua sem corte.
    await page.getByRole('button', { name: /Subtarefas/ }).first().click();
    await page.locator('.q-cartao').nth(2).waitFor();
    assert.equal(await page.locator('.q-coluna-corte').count(), 0);
    return 'coluna com 1 cartão à vista e 2 filhas escondidas: sem "Mostrar mais"';
  });

  await cenario('R2-quadro-releitura-falha', 'a releitura silenciosa que falha depois de mover NÃO apaga o quadro da tela', async (abrir) => {
    const lista = '00000000-0000-0000-0000-000000000010';
    const cartao = {
      id: 't-um', title: 'Roteiro do reels', statusId: 'st-aberta', priority: null, dueOn: null, startOn: null, completedAt: null,
      hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [],
      tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
      checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0,
    };
    let rede = 'ok';
    const { page } = await abrir({
      custom: (url, req) => {
        if (url.pathname === '/api/board/tree/full') return { body: { ok: true, spaces: [], companies: [] } };
        if (url.pathname === '/api/board/tasks/t-um/move' && req.method() === 'POST') {
          return { body: { ok: true, move: { taskId: 't-um', listId: lista, statusId: 'st-feita', previousStatusId: 'st-aberta', statusRepositioned: false, subtasksMoved: 0, automation: null } } };
        }
        if (url.pathname === '/api/board/lists/' + lista && req.method() === 'GET') {
          if (rede === 'cai') return { status: 500, body: { message: 'O banco não respondeu a tempo.' } };
          const quadro = quadroVazio(lista);
          quadro.tasks = [cartao];
          quadro.columnTotals = { 'st-aberta': 1, 'st-feita': 0 };
          quadro.columnMatched = { 'st-aberta': 1, 'st-feita': 0 };
          return { body: { ok: true, board: quadro } };
        }
        return null;
      },
    });
    await page.goto(BASE + '/quadro/' + lista);
    await page.getByRole('link', { name: 'Roteiro do reels', exact: true }).waitFor();
    // O servidor aceita o movimento, e a releitura de depois cai.
    rede = 'cai';
    await page.locator('.q-cartao').first().focus();
    const moveu = page.waitForResponse((r) => r.url().endsWith('/move'));
    await page.keyboard.press('ArrowRight');
    await moveu;
    await page.getByText('O banco não respondeu a tempo.').waitFor();
    // O cartão já estava na coluna nova (o movimento deu certo): o quadro fica como está.
    assert.equal(await page.locator('.q-coluna[data-etapa="st-feita"] .q-cartao').count(), 1, 'o cartão continua na coluna de destino');
    assert.equal(await page.locator('.q-coluna').count(), 2, 'as colunas continuam na tela');
    // A rede volta: a leitura seguinte que chega apaga o aviso velho.
    rede = 'ok';
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await page.locator('.q-coluna[data-etapa="st-aberta"] .q-cartao').waitFor();
    assert.equal(await page.getByText('O banco não respondeu a tempo.').count(), 0, 'o aviso da leitura que falhou saiu');
    // Uma releitura silenciosa que dá certo também o apaga (o aviso não fica velho com o quadro mantido).
    rede = 'cai';
    await page.locator('.q-cartao').first().focus();
    const moveuDeNovo = page.waitForResponse((r) => r.url().endsWith('/move'));
    await page.keyboard.press('ArrowRight');
    await moveuDeNovo;
    await page.getByText('O banco não respondeu a tempo.').waitFor();
    rede = 'ok';
    await page.locator('.q-cartao').first().focus();
    const voltou = page.waitForResponse((r) => r.url().endsWith('/move'));
    await page.keyboard.press('ArrowLeft');
    await voltou;
    await pause(400);
    assert.equal(await page.getByText('O banco não respondeu a tempo.').count(), 0, 'a releitura que deu certo apagou o aviso velho');
    return 'releitura 500 depois do movimento: o quadro fica, com o aviso; qualquer leitura que chega o apaga';
  });

  await cenario('R2-todas-releitura-falha', 'fechar o card ao lado e a releitura cair NÃO esvazia Todas as tarefas', async (abrir) => {
    let rede = 'ok';
    const { page } = await abrir({
      custom: (url) => {
        if (url.pathname === '/api/board/all-tasks' && rede === 'cai') {
          return { status: 500, body: { message: 'O banco não respondeu a tempo.' } };
        }
        return null;
      },
    });
    await page.goto(BASE + '/tarefas');
    await page.getByRole('link', { name: row.title, exact: true }).click();
    await painelDaFicha(page).waitFor();
    rede = 'cai';
    await fecharFicha(page).click();
    await page.getByText('O banco não respondeu a tempo.').waitFor();
    assert.equal(await page.getByRole('link', { name: row.title, exact: true }).count(), 1, 'a lista que estava na tela continua');
    // A rede volta: a próxima releitura (abrir e fechar o card de novo) tira o aviso.
    rede = 'ok';
    await page.getByRole('link', { name: row.title, exact: true }).click();
    await painelDaFicha(page).waitFor();
    await fecharFicha(page).click();
    await page.getByText('O banco não respondeu a tempo.').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('link', { name: row.title, exact: true }).count(), 1);
    return 'releitura 500 ao fechar o painel: a lista fica, com o aviso; a próxima releitura o apaga';
  });

  await cenario('R2-multiplos-cliques', 'marcar três responsáveis em sequência, com a rede lenta, grava os três — a resposta de um clique não desmarca o seguinte', async (abrir) => {
    const equipe = [{ id: 'p-a', name: 'Ana Souza' }, { id: 'p-b', name: 'Bia Nunes' }, { id: 'p-c', name: 'Caio Lima' }];
    let noServidor = [];
    const patches = [];
    const ficha = () => ({ ...detail, id: row.id, title: row.title, assignees: noServidor.map((id) => equipe.find((p) => p.id === id)) });
    const { page } = await abrir({
      custom: async (url, req) => {
        if (url.pathname === '/api/team') return { body: { ok: true, team: equipe, me: 'p-z' } };
        if (url.pathname !== '/api/board/tasks/' + row.id) return null;
        if (req.method() === 'PATCH') {
          const patch = req.postDataJSON() ?? {};
          patches.push(patch);
          // A rede de verdade: o PATCH relê a ficha inteira (doze consultas) antes de responder.
          await pause(500);
          if (patch.assigneeIds) noServidor = patch.assigneeIds;
          return { body: { ok: true, task: ficha() } };
        }
        return { body: { ok: true, task: ficha(), storage: { ready: false, variable: '' } } };
      },
    });
    await page.goto(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    await page.locator('.t-prop').filter({ has: page.locator('dt', { hasText: 'Responsáveis' }) }).getByRole('button').first().click();
    const itens = page.getByRole('menuitemcheckbox');
    await itens.nth(2).waitFor();
    // Três cliques, um a cada 300 ms: a resposta do primeiro chega no meio do terceiro.
    for (const nome of ['Ana Souza', 'Bia Nunes', 'Caio Lima']) {
      await itens.filter({ hasText: nome }).click();
      await pause(300);
    }
    await pause(2500);
    assert.deepEqual([...noServidor].sort(), ['p-a', 'p-b', 'p-c'], 'o servidor ficou com os três: ' + JSON.stringify(patches.map((p) => p.assigneeIds)));
    for (const nome of ['Ana Souza', 'Bia Nunes', 'Caio Lima']) {
      assert.equal(await itens.filter({ hasText: nome }).getAttribute('aria-checked'), 'true', nome + ' continua marcado no menu');
    }
    return 'PATCHes ' + JSON.stringify(patches.map((p) => p.assigneeIds)) + '; servidor com os três';
  });

  await cenario('R2-chip-recusado', 'o chip recusado pelo servidor volta ao que está gravado — não fica dizendo o que não foi salvo', async (abrir) => {
    const { page, writes } = await abrir({
      custom: (url, req) => {
        if (url.pathname.startsWith('/api/board/tasks/') && req.method() === 'PATCH') {
          return { status: 403, body: { message: 'Você não pode mexer nesta tarefa.' } };
        }
        return null;
      },
    });
    await page.goto(BASE + '/tarefa/' + row.id);
    await campoTitulo(page).waitFor();
    const chip = page.locator('.t-prop').filter({ has: page.locator('dt', { hasText: 'Prioridade' }) }).getByRole('button').first();
    const antes = (await chip.textContent())?.trim();
    await chip.click();
    await page.locator('.cu-balao .cu-item', { hasText: 'Baixa' }).click();
    await page.getByText('Você não pode mexer nesta tarefa.').waitFor();
    assert.equal(writes.length, 1, 'uma tentativa');
    assert.equal((await chip.textContent())?.trim(), antes, 'o chip voltou ao que está gravado');
    assert.equal(await page.getByText('há alterações por salvar', { exact: true }).count(), 0, 'nada fica "por salvar": o chip não é texto');
    return 'prioridade recusada (403): o chip volta a "' + antes + '" e a ficha não finge alteração pendente';
  });

  await cenario('R2-capa-dois-cliques', 'na capa do cartão, o segundo responsável marcado com a primeira gravação no ar não se perde', async (abrir) => {
    const lista = '00000000-0000-0000-0000-000000000010';
    const equipe = [{ id: 'p-a', name: 'Ana Souza' }, { id: 'p-b', name: 'Bia Nunes' }, { id: 'p-c', name: 'Caio Lima' }];
    const cartao = {
      id: 't-um', title: 'Roteiro do reels', statusId: 'st-aberta', priority: null, dueOn: null, startOn: null, completedAt: null,
      hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [],
      tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
      checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0,
    };
    let noServidor = [];
    const patches = [];
    const gente = (ids) => ids.map((id) => equipe.find((p) => p.id === id));
    const { page } = await abrir({
      custom: async (url, req) => {
        if (url.pathname === '/api/board/tree/full') return { body: { ok: true, spaces: [], companies: [] } };
        if (url.pathname === '/api/board/lists/' + lista) {
          const quadro = quadroVazio(lista);
          quadro.tasks = [{ ...cartao, assignees: gente(noServidor) }];
          quadro.columnTotals = { 'st-aberta': 1, 'st-feita': 0 };
          quadro.columnMatched = quadro.columnTotals;
          return { body: { ok: true, board: quadro } };
        }
        if (url.pathname === '/api/board/tasks/t-um/assignable') {
          return { body: { ok: true, people: equipe.map((p) => ({ ...p, assigned: noServidor.includes(p.id) })), me: 'p-z' } };
        }
        if (url.pathname === '/api/board/tasks/t-um' && req.method() === 'PATCH') {
          const patch = req.postDataJSON() ?? {};
          patches.push(patch);
          await pause(600);
          if (patch.assigneeIds) noServidor = patch.assigneeIds;
          return { body: { ok: true, task: { ...detail, id: 't-um', assignees: gente(noServidor) } } };
        }
        return null;
      },
    });
    await page.goto(BASE + '/quadro/' + lista);
    await page.getByRole('link', { name: 'Roteiro do reels', exact: true }).waitFor();
    await page.getByRole('button', { name: /Definir responsável por Roteiro do reels/ }).click();
    const itens = page.getByRole('menuitemcheckbox');
    await itens.nth(2).waitFor();
    // O segundo clique chega com a primeira gravação ainda no ar (600 ms).
    for (const nome of ['Ana Souza', 'Bia Nunes', 'Caio Lima']) {
      await itens.filter({ hasText: nome }).click();
      await pause(200);
    }
    await pause(3000);
    assert.deepEqual([...noServidor].sort(), ['p-a', 'p-b', 'p-c'], 'o servidor ficou com os três: ' + JSON.stringify(patches.map((p) => p.assigneeIds)));
    for (const nome of ['Ana Souza', 'Bia Nunes', 'Caio Lima']) {
      assert.equal(await itens.filter({ hasText: nome }).getAttribute('aria-checked'), 'true', nome + ' continua marcado no menu');
    }
    return 'PATCHes ' + JSON.stringify(patches.map((p) => p.assigneeIds)) + '; servidor com os três';
  });

  await cenario('R2-capa-resposta-atrasada', 'a lista de pessoas do cartão A, chegando depois, não entra no menu do cartão B', async (abrir) => {
    const lista = '00000000-0000-0000-0000-000000000010';
    const cartao = (id, titulo) => ({
      id, title: titulo, statusId: 'st-aberta', priority: null, dueOn: null, startOn: null, completedAt: null,
      hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [],
      tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
      checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0,
    });
    const { page } = await abrir({
      custom: async (url) => {
        if (url.pathname === '/api/board/tree/full') return { body: { ok: true, spaces: [], companies: [] } };
        if (url.pathname === '/api/board/lists/' + lista) {
          const quadro = quadroVazio(lista);
          quadro.tasks = [cartao('t-a', 'Cartão A'), cartao('t-b', 'Cartão B')];
          quadro.columnTotals = { 'st-aberta': 2, 'st-feita': 0 };
          quadro.columnMatched = quadro.columnTotals;
          return { body: { ok: true, board: quadro } };
        }
        // A é lenta; B é rápida. Cada uma oferece uma pessoa que a outra não alcança.
        if (url.pathname === '/api/board/tasks/t-a/assignable') {
          await pause(1200);
          return { body: { ok: true, people: [{ id: 'p-ana', name: 'Ana do A', assigned: false }], me: 'p-z' } };
        }
        if (url.pathname === '/api/board/tasks/t-b/assignable') {
          await pause(100);
          return { body: { ok: true, people: [{ id: 'p-bia', name: 'Bia do B', assigned: false }], me: 'p-z' } };
        }
        return null;
      },
    });
    await page.goto(BASE + '/quadro/' + lista);
    await page.getByRole('link', { name: 'Cartão B', exact: true }).waitFor();
    await page.getByRole('button', { name: /Definir responsável por Cartão A/ }).click();
    // O balão do A cobre o cartão de baixo; quem quer o B fecha o do A (Esc) antes de
    // a lista do A chegar — com a rede lenta, é o caso comum.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Definir responsável por Cartão B/ }).click();
    const itens = page.getByRole('menuitemcheckbox');
    await itens.filter({ hasText: 'Bia do B' }).waitFor();
    // A resposta lenta do cartão A chega agora, com o menu do B aberto.
    await pause(1600);
    assert.equal(await itens.filter({ hasText: 'Ana do A' }).count(), 0, 'a oferta do cartão A não aparece no menu do B');
    assert.equal(await itens.filter({ hasText: 'Bia do B' }).count(), 1, 'a oferta do B continua');
    return 'menu do B só com a oferta do B depois da resposta atrasada do A';
  });

  return resultados;
}
