/**
 * Os dois defeitos de 17/09/2026, provados no Chrome real com a API simulada.
 *
 *   E1 — *"as descrições, eu separo com enter para deixar organizado, ele
 *        salva, mas quando entro novamente na tarefa, esses espaços somem"*.
 *        Digita com Enter a mais, salva, confere o markdown que foi para a API
 *        e reabre a tarefa com ele: a linha vazia tem de estar lá, com altura.
 *
 *   A1 — *"quando pega um card e arrasta para o lado ele não rola para as
 *        listas seguintes"*. Arrasta o cartão da primeira coluna até a borda
 *        direita do quadro, segura, e solta numa coluna que estava FORA da
 *        tela quando o arrasto começou.
 *
 * Nada chega ao banco: `setup` intercepta `/api/**`. Ver `comum.mjs`.
 */

import assert from 'node:assert/strict';

import { BASE, X, criarSuite, detail, fecharFicha, painelDaFicha, pause, row } from './comum.mjs';
import { F6C, f6cServidor, novoEstado } from './dados-f06c.mjs';

const LISTA = '00000000-0000-0000-0000-000000000010';

/** Dez colunas de 17,5rem: a faixa passa de 2.900px numa janela de 1.440. */
const STATUS = Array.from({ length: 10 }, (_, i) => ({
  id: `st${i}`,
  name: `Etapa ${i}`,
  type: i === 9 ? 'closed' : 'custom',
  color: null,
  sortOrder: i,
}));

const cartao = (id, titulo, statusId) => ({
  id, title: titulo, statusId, priority: null, dueOn: null, startOn: null, completedAt: null,
  hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [],
  tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
  checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0,
});

const TAREFAS = [cartao('t-viaja', 'Cartão que viaja', 'st0'), ...STATUS.slice(1).map((s) => cartao(`t-${s.id}`, `Fica em ${s.name}`, s.id))];

const QUADRO = {
  header: {
    listId: LISTA, listName: 'CONTFIX', listContent: null, folderId: null, folderName: null,
    spaceId: 'e1', spaceName: 'AGÊNCIA IDE', categoryName: 'Ide', statusSetName: 'Esteira', inheritedFrom: 'list',
  },
  statuses: STATUS,
  tasks: TAREFAS,
  availableTags: [],
  columnTotals: Object.fromEntries(STATUS.map((s) => [s.id, 1])),
  columnMatched: Object.fromEntries(STATUS.map((s) => [s.id, 1])),
  perColumn: 50,
  assigneeOptions: [],
  unassignedTasks: 0,
  filter: { texto: '', responsavel: null },
};

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  /* ───────────────────────────── E1 ───────────────────────────── */

  const abrirTarefa = async (abrir, description) => {
    const s = await abrir({
      custom: (url, req) =>
        url.pathname.startsWith('/api/board/tasks/') && req.method() === 'GET'
          ? { body: { ok: true, task: { ...detail, id: row.id, description }, storage: { ready: false, variable: '' } } }
          : null,
    });
    await s.page.goto(`${BASE}/tarefa/${row.id}`);
    const editor = s.page.getByRole('textbox', { name: 'Descrição da tarefa', exact: true });
    await editor.waitFor();
    return { ...s, editor };
  };

  await cenario('E1', 'Enter a mais na descrição vai para a API e volta como linha vazia ao reabrir', async (abrir) => {
    const { page, editor, writes, erros } = await abrirTarefa(abrir, '');
    await editor.click();
    await page.keyboard.type('CARROSSEL - 1080X1350');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('CAPA');
    await page.keyboard.press('Enter');
    await page.keyboard.type('SEU E-COMMERCE AINDA FAZ TUDO MANUALMENTE?');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('SLIDE 1');

    await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
    await page.getByText('Salvo.', { exact: true }).waitFor();
    const gravado = writes.map((w) => w.body?.description).filter((d) => typeof d === 'string').pop();
    assert.equal(
      gravado,
      'CARROSSEL - 1080X1350\n\n\nCAPA\n\nSEU E-COMMERCE AINDA FAZ TUDO MANUALMENTE?\n\n\n\nSLIDE 1',
      'o markdown enviado guarda uma linha a mais por Enter a mais',
    );
    assert.deepEqual(erros, []);

    // Reabrir: um contexto novo, com o que foi gravado vindo do "banco".
    const volta = await abrirTarefa(abrir, gravado);
    const linhas = await volta.editor.evaluate((el) =>
      Array.from(el.children).map((c) => ({ tag: c.tagName, texto: c.textContent, altura: c.getBoundingClientRect().height })),
    );
    assert.deepEqual(
      linhas.map((l) => l.texto),
      ['CARROSSEL - 1080X1350', '', 'CAPA', 'SEU E-COMMERCE AINDA FAZ TUDO MANUALMENTE?', '', '', 'SLIDE 1'],
      'as linhas vazias estão no editor reaberto',
    );
    for (const l of linhas.filter((x) => x.texto === '')) assert.ok(l.altura > 0, `linha vazia com altura: ${JSON.stringify(l)}`);
    assert.deepEqual(volta.erros, []);
    return `gravado ${JSON.stringify(gravado)}; reaberto com ${linhas.length} linhas, alturas vazias ${linhas.filter((x) => x.texto === '').map((x) => x.altura)}`;
  });

  /* ───────────────────────────── A1 ───────────────────────────── */

  await cenario('A1', 'arrastar o cartão até a borda direita rola o quadro e solta numa coluna que estava fora da tela', async (abrir) => {
    const movimentos = [];
    const { page, erros } = await abrir({
      custom: (url, req) => {
        if (url.pathname === `/api/board/lists/${LISTA}`) return { body: { ok: true, board: QUADRO } };
        if (url.pathname.endsWith('/move') && req.method() === 'POST') {
          const b = req.postDataJSON();
          movimentos.push(b);
          return {
            body: {
              ok: true,
              move: { taskId: 't-viaja', listId: LISTA, statusId: b.statusId, previousStatusId: 'st0', statusRepositioned: false, subtasksMoved: 0, automation: null },
            },
          };
        }
        return null;
      },
    });
    await page.goto(`${BASE}/quadro/${LISTA}`);
    const card = page.locator('.q-cartao', { hasText: 'Cartão que viaja' });
    await card.waitFor();

    const faixa = page.locator('.q-colunas');
    const caixa = await faixa.boundingBox();
    const inicio = await faixa.evaluate((el) => ({ scrollLeft: el.scrollLeft, sobra: el.scrollWidth - el.clientWidth }));
    assert.equal(inicio.scrollLeft, 0);
    assert.ok(inicio.sobra > 1000, `o quadro tem o que rolar: ${inicio.sobra}px`);
    const visivelNoInicio = await page.evaluate(() => {
      const f = document.querySelector('.q-colunas').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.q-coluna')).map((c) => c.getBoundingClientRect().left < f.right);
    });
    assert.equal(visivelNoInicio[8], false, 'a Etapa 8 começa fora da tela');

    const c = await card.boundingBox();
    // PELO TÍTULO, como a mão pega: a 50px da borda esquerda do cartão. A
    // imagem arrastada sobra uns 200px à direita do ponteiro.
    const pega = c.x + 50;
    const y = c.y + c.height / 2;
    await page.mouse.move(pega, y);
    await page.mouse.down();
    await page.mouse.move(pega + 20, y, { steps: 4 });

    // No MIOLO do quadro, parado: nada anda — soltar numa coluna do meio não
    // pode virar rolagem.
    const miolo = caixa.x + Math.min(caixa.width, 1440 - caixa.x) / 2;
    await page.mouse.move(miolo, y, { steps: 8 });
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.move(miolo + (i % 2), y);
      await pause(50);
    }
    assert.equal(await faixa.evaluate((el) => el.scrollLeft), 0, 'no miolo a faixa fica parada');

    // Até a imagem do cartão encostar na borda direita visível: o PONTEIRO fica
    // a 120px dela — longe dos ~20px em que o Chrome rolaria sozinho. Segura
    // ali com movimentos mínimos, que é o que a mão faz.
    const bordaVisivel = Math.min(caixa.x + caixa.width, 1440);
    const ponto = bordaVisivel - 120;
    await page.mouse.move(ponto, y, { steps: 10 });
    // Segura até a Etapa 8 aparecer inteira — é o que quem arrasta faz —, com
    // teto de 6 s para o defeito não virar espera infinita.
    const etapa8Visivel = () =>
      page.evaluate(() => {
        const f = document.querySelector('.q-colunas').getBoundingClientRect();
        const col = document.querySelectorAll('.q-coluna')[8].getBoundingClientRect();
        return col.left >= f.left && col.right <= Math.min(f.right, window.innerWidth) + 1;
      });
    const amostras = [];
    const t0 = Date.now();
    for (let i = 0; Date.now() - t0 < 6000; i += 1) {
      await page.mouse.move(ponto + (i % 2), y);
      await pause(50);
      amostras.push(await faixa.evaluate((el) => el.scrollLeft));
      if (await etapa8Visivel()) break;
    }
    const segundos = ((Date.now() - t0) / 1000).toFixed(1);
    const rolou = amostras[amostras.length - 1];
    assert.ok(rolou > 600, `a faixa andou com o cartão na borda: ${amostras.join(',')}`);

    // Solta na Etapa 8, que agora está à vista.
    const alvo = await page.evaluate(() => {
      const f = document.querySelector('.q-colunas').getBoundingClientRect();
      const col = Array.from(document.querySelectorAll('.q-coluna'))[8].getBoundingClientRect();
      return { x: col.left + col.width / 2, y: col.top + 60, visivel: col.left >= f.left && col.right <= f.right + 1 };
    });
    assert.ok(alvo.visivel, `a Etapa 8 entrou na tela: ${JSON.stringify(alvo)}`);
    await page.mouse.move(alvo.x, alvo.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('.q-coluna')[8]?.textContent.includes('Cartão que viaja'), null, { timeout: 5000 });
    assert.deepEqual(movimentos.map((m) => m.statusId), ['st8'], 'o cartão foi movido para a Etapa 8');

    // Depois de soltar, parado: a faixa não segue rolando sozinha.
    const parado = await faixa.evaluate((el) => el.scrollLeft);
    await pause(400);
    assert.equal(await faixa.evaluate((el) => el.scrollLeft), parado, 'soltou, parou');
    assert.deepEqual(erros, []);
    return `faixa ${Math.round(caixa.x)}–${Math.round(bordaVisivel)}px; ponteiro a 120px da borda: scrollLeft 0 → ${rolou} em ${segundos} s; movido para ${movimentos[0].statusId}`;
  });

  /* ───────────────────────────── F06A ─────────────────────────────
     O cabeçalho do quadro, da pasta e do espaço (plano UX). O nome do lugar é
     o título; busca, responsável, subtarefas, contagens e esteira numa faixa
     só, na altura da busca das outras telas; a descrição longa recolhe; as
     colunas começam no primeiro quarto da tela. E os casos de borda: vazio
     real, sem alcance, filtro sem resultado, nomes iguais, lista sem cliente
     e cliente fora do alcance. `F06A_CAPTURAS=<pasta>` grava as telas. */
  const F6 = {
    lista: '00000000-0000-0000-0000-0000000f06a1',
    irma: '00000000-0000-0000-0000-0000000f06a2',
    homonima: '00000000-0000-0000-0000-0000000f06a3',
    semAlcance: '00000000-0000-0000-0000-0000000f06a4',
    vazia: '00000000-0000-0000-0000-0000000f06a5',
  };
  const F6_ETAPAS = ['A fazer', 'Em produção', 'Em revisão', 'Aprovado'].map((name, i) => ({ id: `f6s${i}`, name, type: i === 3 ? 'closed' : 'custom', color: null, sortOrder: i }));
  const F6_TITULOS = ['Revisar carrossel da campanha', 'Editar vídeo de apresentação', 'Organizar material para aprovação', 'Conferir briefing e referências'];
  const F6_CARTOES = F6_ETAPAS.flatMap((s, si) => F6_TITULOS.map((t, i) => ({
    ...cartao(`f6-${si}-${i}`, `${t} ${si}${i}`, s.id), clientId: 'cli-h', clientName: 'Horizonte Studio',
  })));
  // Uma subtarefa: o interruptor tem de dizer que ela está escondida.
  F6_CARTOES.push({ ...cartao('f6-sub', 'Passo do carrossel', 'f6s0'), parentId: 'f6-0-0', parentTitle: F6_CARTOES[0].title });
  const F6_LONGA = 'Campanhas e entregas recorrentes do cliente. Priorizar peças com prazo nesta semana. O cliente aprova por WhatsApp até quarta; tudo o que chegar depois entra na semana seguinte.\nContato de aprovação: equipe de marketing — FIM-DA-DESCRICAO.';
  const f6Quadro = (listId, url, { nome = 'Criação e conteúdo', desc = null, cartoes = F6_CARTOES, heranca = 'folder', pasta = true, espaco = ['f6e', 'Produção'] } = {}) => {
    const busca = (url.searchParams.get('busca') ?? '').toLowerCase();
    const achadas = busca ? cartoes.filter((t) => t.title.toLowerCase().includes(busca)) : cartoes;
    const conta = (lista) => Object.fromEntries(F6_ETAPAS.map((s) => [s.id, lista.filter((t) => t.statusId === s.id).length]));
    return {
      header: {
        listId, listName: nome, listContent: desc, folderId: pasta ? 'f6p' : null, folderName: pasta ? 'Clientes' : null,
        spaceId: espaco[0], spaceName: espaco[1], categoryName: 'Ide', statusSetName: 'Fluxo de criação', inheritedFrom: heranca,
      },
      statuses: F6_ETAPAS, tasks: achadas, availableTags: [], columnTotals: conta(cartoes), columnMatched: conta(achadas), perColumn: 50,
      assigneeOptions: [], unassignedTasks: cartoes.length, filter: { texto: busca, responsavel: null },
    };
  };
  const f6Linha = (o) => ({
    spaceId: 'f6e', spaceName: 'Produção', spaceColor: null, spaceArchivedAt: null, categoryId: 'c1', categoryName: 'Ide',
    folderId: 'f6p', folderName: 'Clientes', folderArchivedAt: null, listContent: null, listArchivedAt: null, listIsLive: true,
    liveTasks: 12, totalTasks: 17, clientId: null, clientName: null, workflowName: 'Fluxo de criação', inheritedFrom: 'folder', ...o,
  });
  const F6_ARVORE = {
    ok: true, companies: [{ id: 'c1', name: 'Ide' }],
    spaces: [
      f6Linha({ listId: F6.lista, listName: 'Criação e conteúdo', clientId: 'cli-h', clientName: 'Horizonte Studio' }),
      // Vínculo com cliente, mas quem olha não alcança o cliente: sem nome, sem chip.
      f6Linha({ listId: F6.irma, listName: 'Audiovisual', clientId: 'cli-fora', clientName: null }),
      f6Linha({ listId: F6.vazia, listName: 'Lista nova', liveTasks: 0, totalTasks: 0 }),
      // Lista sem pasta e homônima de outra, em outro espaço.
      f6Linha({ folderId: null, folderName: null, listId: F6.homonima, listName: 'Demandas', workflowName: 'Esteira', inheritedFrom: 'space' }),
      f6Linha({ spaceId: 'f6e2', spaceName: 'Atendimento', folderId: null, folderName: null, listId: '00000000-0000-0000-0000-0000000f06a6', listName: 'Demandas' }),
      // Arquivada: só aparece com o interruptor de arquivados.
      f6Linha({ listId: '00000000-0000-0000-0000-0000000f06a7', listName: 'Campanha antiga', listArchivedAt: '2026-08-01T00:00:00Z', listIsLive: false }),
    ],
  };
  const f6Servidor = (url) => {
    const p = url.pathname;
    if (p === '/api/board/tree/full') return { body: F6_ARVORE };
    if (p === `/api/board/lists/${F6.lista}`) return { body: { ok: true, board: f6Quadro(F6.lista, url) } };
    if (p === `/api/board/lists/${F6.irma}`) return { body: { ok: true, board: f6Quadro(F6.irma, url, { nome: 'Audiovisual' }) } };
    if (p === `/api/board/lists/${F6.vazia}`) return { body: { ok: true, board: f6Quadro(F6.vazia, url, { nome: 'Lista nova', cartoes: [] }) } };
    if (p === `/api/board/lists/${F6.homonima}`) return { body: { ok: true, board: f6Quadro(F6.homonima, url, { nome: 'Demandas', pasta: false, heranca: 'space' }) } };
    if (p === `/api/board/lists/${F6.semAlcance}`) return { status: 403, body: { ok: false, message: 'Esta lista não está ao seu alcance.' } };
    return null;
  };
  const F6_CAPTURAS = process.env.F06A_CAPTURAS ?? '';
  const f6Capturar = async (page, nome) => { if (F6_CAPTURAS) await page.screenshot({ path: `${F6_CAPTURAS}/${nome}.png` }); };
  /** A forma do cabeçalho, lida do DOM. */
  const f6Medir = (page) => page.evaluate(() => {
    const caixa = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; };
    return {
      h1: document.querySelector('.q-conteudo h1')?.textContent,
      coluna: caixa('.q-coluna-topo'), busca: caixa('.q-ferramentas .iw-busca'), quem: caixa('.q-filtro-quem'),
      sub: caixa('.q-ferramentas .q-interruptor'), esteira: caixa('.q-esteira'), contagem: document.querySelector('.q-contagem')?.textContent,
      interruptor: document.querySelector('.q-interruptor')?.textContent,
      chip: document.querySelector('.o-topo-nome [data-cliente-da-lista]')?.getAttribute('href') ?? null,
      cartaoNoTopo: document.querySelectorAll('.q-conteudo > section.o-card').length,
      innerH: innerHeight, innerW: innerWidth, sw: document.documentElement.scrollWidth,
      faixa: (() => { const f = document.querySelector('.q-colunas'); return f ? { sw: f.scrollWidth, cw: f.clientWidth } : null; })(),
      controlesDentro: [...document.querySelectorAll('.q-ferramentas button, .q-ferramentas input, .o-topo button')].every((el) => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= 0 && r.right <= innerWidth + 0.5); }),
    };
  });

  for (const tema of ['claro', 'escuro']) {
    await cenario(`F06A-1440-${tema}`, 'nome da lista é o título; faixa de 40 px; colunas antes de 25%; esteira a um clique', async (abrir) => {
      const { page, erros } = await abrir({ viewport: { width: 1440, height: 900 }, tema, custom: f6Servidor });
      await page.goto(`${BASE}/quadro/${F6.lista}`);
      await page.locator('.q-coluna-topo').first().waitFor();
      await pause(300);
      const m = await f6Medir(page);
      const ctx = JSON.stringify(m);
      assert.equal(m.h1, 'Criação e conteúdo', ctx);
      assert.equal(m.chip, '/cliente/cli-h', `o cliente mora na linha do nome — ${ctx}`);
      assert.equal(m.cartaoNoTopo, 0, `sem o cartão de resumo — ${ctx}`);
      assert.ok(m.coluna.top < 0.25 * m.innerH, `colunas antes de 25% (${m.coluna.top}/${m.innerH}) — ${ctx}`);
      for (const [nome, c] of [['busca', m.busca], ['responsável', m.quem], ['subtarefas', m.sub], ['esteira', m.esteira]]) {
        assert.ok(c && Math.abs(c.h - 40) <= 1, `${nome} com 40 px — ${ctx}`);
      }
      assert.ok(Math.abs(m.busca.top - m.quem.top) <= 1 && Math.abs(m.busca.top - m.sub.top) <= 1, `uma linha só — ${ctx}`);
      // 17 cartões (16 + 1 subtarefa), 4 na etapa fechada; a subtarefa escondida é dita.
      assert.equal(m.contagem, '17 tarefas · 13 em aberto · 4 concluídas', ctx);
      assert.equal(m.interruptor, 'Subtarefas · 1 escondida', ctx);
      assert.equal(await page.locator('.q-cartao').count(), 16, 'a subtarefa não vira cartão com o interruptor desligado');
      await f6Capturar(page, `f06a-quadro-1440-${tema}`);
      // A esteira: o nome à vista, a herança explicada no balão, e Esc fecha.
      await page.locator('.q-esteira').click();
      const dialogo = page.locator('.cu-balao[role="dialog"]', { hasText: 'Fluxo de criação' });
      await dialogo.waitFor();
      // O balão tem nome para o leitor de tela: o título escrito dele.
      assert.ok(await page.getByRole('dialog', { name: 'Esteira' }).isVisible(), 'o dialog da esteira se chama "Esteira"');
      assert.match(await dialogo.textContent(), /herdada da pasta/);
      assert.match(await dialogo.textContent(), /vem da pasta/);
      await page.keyboard.press('Escape');
      await dialogo.waitFor({ state: 'detached' });
      // Pelo teclado: Enter abre com o foco dentro do balão; Esc fecha e o foco volta ao botão.
      await page.locator('.q-esteira').focus();
      await page.keyboard.press('Enter');
      await dialogo.waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('.cu-balao') !== null);
      await page.keyboard.press('Escape');
      await dialogo.waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.classList.contains('q-esteira'));
      assert.deepEqual(erros.filter((e) => !/chat\/live|WebSocket/i.test(e)), []);
      return `colunas em ${m.coluna.top}px (${((100 * m.coluna.top) / m.innerH).toFixed(1)}%); ${m.contagem}`;
    });
  }

  await cenario('F06A-descricao', 'descrição longa: uma linha, texto inteiro no DOM, abre e fecha; colunas ainda antes de 25%', async (abrir) => {
    const { page } = await abrir({
      viewport: { width: 1440, height: 900 },
      custom: (url) => (url.pathname === `/api/board/lists/${F6.lista}` ? { body: { ok: true, board: f6Quadro(F6.lista, url, { desc: F6_LONGA }) } } : f6Servidor(url)),
    });
    await page.goto(`${BASE}/quadro/${F6.lista}`);
    await page.locator('.q-coluna-topo').first().waitFor();
    await pause(300);
    const texto = page.locator('.q-descricao-texto');
    assert.ok((await texto.textContent()).includes('FIM-DA-DESCRICAO'), 'o texto inteiro está no DOM, mesmo recolhido');
    const fechada = await texto.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    const m = await f6Medir(page);
    assert.ok(fechada <= 22, `recolhida numa linha (${fechada}px)`);
    assert.ok(m.coluna.top < 0.25 * m.innerH, `colunas antes de 25% com a descrição recolhida (${m.coluna.top})`);
    const botao = page.getByRole('button', { name: 'Ler descrição inteira' });
    assert.equal(await botao.getAttribute('aria-expanded'), 'false');
    await botao.click();
    await page.getByRole('button', { name: 'Recolher descrição' }).waitFor();
    const aberta = await texto.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    assert.ok(aberta > fechada * 1.5, `aberta mostra mais linhas (${fechada} → ${aberta})`);
    await f6Capturar(page, 'f06a-quadro-descricao-aberta-1440-claro');
    await page.getByRole('button', { name: 'Recolher descrição' }).click();
    assert.equal(await texto.evaluate((el) => Math.round(el.getBoundingClientRect().height)), fechada);
    return `recolhida ${fechada}px, aberta ${aberta}px; colunas em ${m.coluna.top}px`;
  });

  await cenario('F06A-filtro', 'filtro sem resultado ≠ lista vazia; totais seguem os da lista; Limpar volta', async (abrir) => {
    const { page } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f6Servidor });
    await page.goto(`${BASE}/quadro/${F6.lista}`);
    await page.locator('.q-cartao').first().waitFor();
    const campo = page.getByRole('textbox', { name: 'Buscar tarefa pelo nome', exact: true });
    await campo.fill('nada-disso');
    await campo.press('Enter');
    await page.locator('.q-filtro-dito').filter({ hasText: '0 de 17' }).waitFor();
    const m = await f6Medir(page);
    assert.equal(m.contagem, '17 tarefas · 13 em aberto · 4 concluídas', 'o total da lista não vira o total achado');
    assert.equal(await page.locator('.q-cartao').count(), 0);
    assert.ok(await page.locator('.q-coluna').count() === 4, 'as colunas continuam lá — filtro vazio não é quadro quebrado');
    await f6Capturar(page, 'f06a-quadro-filtro-sem-resultado-1440-claro');
    await page.getByRole('button', { name: 'Limpar', exact: true }).click();
    await page.locator('.q-cartao').first().waitFor();
    assert.equal(await page.locator('.q-filtro-dito').count(), 0);
    assert.equal(await campo.inputValue(), '');
    return '0 de 17 com o total intacto; Limpar devolve os 16 cartões';
  });

  await cenario('F06A-bordas', 'vazio real, sem alcance, nomes iguais, lista sem cliente e cliente fora do alcance', async (abrir) => {
    const { page } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f6Servidor });
    const saida = [];
    // Vazio real: colunas com o nome e o zero, contagem zerada, sem aviso de filtro.
    await page.goto(`${BASE}/quadro/${F6.vazia}`);
    await page.locator('.q-coluna-topo').first().waitFor();
    let m = await f6Medir(page);
    assert.equal(m.h1, 'Lista nova');
    assert.equal(m.contagem, '0 tarefas · 0 em aberto · 0 concluídas');
    assert.equal(await page.locator('.q-coluna-vazia').count(), 4);
    assert.equal(m.interruptor, 'Subtarefas');
    saida.push('vazio');
    // Cliente fora do alcance: vínculo sem nome não ganha chip nem nome deduzido.
    await page.goto(`${BASE}/quadro/${F6.irma}`);
    await page.locator('.q-coluna-topo').first().waitFor();
    m = await f6Medir(page);
    assert.equal(m.h1, 'Audiovisual');
    assert.equal(m.chip, null, 'sem nome do cliente, sem chip');
    assert.ok(!(await page.locator('.o-topo').textContent()).includes('Horizonte'), 'nenhum cliente deduzido dos cartões');
    saida.push('cliente fora');
    // Nomes iguais: o título é o mesmo, a trilha diz o espaço de cada uma; sem pasta, sem degrau de pasta.
    await page.goto(`${BASE}/quadro/${F6.homonima}`);
    await page.locator('.q-coluna-topo').first().waitFor();
    m = await f6Medir(page);
    const trilha = await page.getByRole('navigation', { name: 'Trilha' }).textContent();
    assert.equal(m.h1, 'Demandas');
    assert.ok(trilha.includes('Produção') && !trilha.includes('Clientes'), `trilha com o espaço e sem pasta: ${trilha}`);
    assert.equal(m.chip, null, 'lista sem cliente não tem chip');
    saida.push(`homônima (${trilha.replace(/\s+/g, ' ').trim()})`);
    // Sem alcance: a recusa na coluna, o título volta a ser a forma, nada de
    // identidade. (Com a lista fora da árvore viva, o quadro já abre outra —
    // F17.14; aqui a árvore vem vazia e a lista pedida responde 403.)
    const recusa = await abrir({
      viewport: { width: 1440, height: 900 },
      custom: (url) => (url.pathname === '/api/board/tree/full' ? null : f6Servidor(url)),
    });
    await recusa.page.goto(`${BASE}/quadro/${F6.semAlcance}`);
    await recusa.page.locator('[role="alert"]').filter({ hasText: 'alcance' }).first().waitFor();
    m = await f6Medir(recusa.page);
    assert.equal(m.h1, 'Quadro');
    assert.equal(m.chip, null);
    assert.equal(await recusa.page.locator('.q-ferramentas').count(), 0);
    await f6Capturar(recusa.page, 'f06a-quadro-sem-alcance-1440-claro');
    saida.push('sem alcance');
    return saida.join(' · ');
  });

  for (const [largura, tema] of [[390, 'claro'], [390, 'escuro'], [320, 'claro']]) {
    await cenario(`F06A-${largura}-${tema}`, 'celular: título, ações e filtros cabem; o quadro rola de lado só dentro da faixa', async (abrir) => {
      const { page } = await abrir({ viewport: { width: largura, height: 844 }, tema, custom: f6Servidor });
      await page.goto(`${BASE}/quadro/${F6.lista}`);
      await page.locator('.q-coluna-topo').first().waitFor();
      await pause(300);
      const m = await f6Medir(page);
      const ctx = JSON.stringify(m);
      assert.ok(m.sw <= m.innerW, `a página não rola de lado — ${ctx}`);
      assert.ok(m.controlesDentro, `nenhum controle fora da tela — ${ctx}`);
      assert.ok(m.faixa.sw > m.faixa.cw, `as colunas rolam dentro da faixa — ${ctx}`);
      assert.ok(Math.abs(m.quem.top - m.sub.top) <= 1, `responsável e subtarefas dividem a linha — ${ctx}`);
      // A trilha para no ancestral: o h1 logo abaixo já diz o nome da lista.
      const trilha = page.getByRole('navigation', { name: 'Trilha' });
      assert.equal(await trilha.locator('[aria-current="page"]').isVisible(), false, 'o último degrau não repete o título no celular');
      assert.ok((await trilha.innerText()).includes('Clientes'), `a pasta continua na trilha: ${await trilha.innerText()}`);
      await f6Capturar(page, `f06a-quadro-${largura}-${tema}`);
      return `colunas em ${m.coluna.top}px (${((100 * m.coluna.top) / m.innerH).toFixed(1)}%)`;
    });
  }

  await cenario('F06A-arvore', 'barra de 288 px: título da árvore em uma linha; ··· sem reservar largura; cliente e menu com alvos próprios', async (abrir) => {
    const { page } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f6Servidor });
    await page.goto(`${BASE}/quadro/${F6.lista}`);
    await page.locator('.q-coluna-topo').first().waitFor();
    const topo = await page.evaluate(() => {
      const h2 = document.querySelector('#barra-lateral .cu-arvore-topo h2');
      return { h: Math.round(h2.getBoundingClientRect().height), sw: h2.querySelector('button').scrollWidth, cw: h2.querySelector('button').clientWidth };
    });
    assert.ok(topo.h <= 22 && topo.sw <= topo.cw + 1, `"Compartilhado comigo" inteiro numa linha: ${JSON.stringify(topo)}`);
    const linha = page.locator('#barra-lateral .cu-no', { hasText: 'Criação e conteúdo' });
    const acao = linha.locator('.cu-no-acao');
    const parada = await acao.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    assert.equal(parada, 0, 'parado, o ··· não ocupa largura');
    const nomeAntes = await linha.locator('.cu-no-nome').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await linha.hover();
    await pause(200);
    const sob = await linha.evaluate((el) => ({
      acao: Math.round(el.querySelector('.cu-no-acao').getBoundingClientRect().width),
      nome: Math.round(el.querySelector('.cu-no-nome').getBoundingClientRect().width),
      cliente: el.querySelector('button[aria-label^="Abrir a ficha do cliente"]')?.getBoundingClientRect().width ?? 0,
    }));
    assert.ok(sob.acao > 0 && sob.cliente > 0, `sob o ponteiro, cliente e ··· à vista: ${JSON.stringify(sob)}`);
    assert.ok(Math.abs(sob.nome - nomeAntes) <= 8, `o nome quase não anda (${nomeAntes} → ${sob.nome})`);
    // O Tab ainda chega no ··· (a largura zero não o tira do teclado).
    await linha.locator('button[aria-label^="Abrir a ficha do cliente"]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ações de Criação e conteúdo');
    await page.keyboard.press('Enter');
    await page.getByRole('menu').first().waitFor();
    await page.keyboard.press('Escape');
    // O cliente abre a ficha; o nome abre o quadro — alvos distintos.
    await linha.locator('button[aria-label^="Abrir a ficha do cliente"]').click();
    await page.waitForURL((u) => u.pathname === '/cliente/cli-h');
    return `topo ${topo.h}px; nome ${nomeAntes}px → ${sob.nome}px sob o ponteiro`;
  });

  await cenario('F06A-pasta-espaco', 'pasta e espaço: nome no título, origem nos cartões, listas sem pasta e arquivadas', async (abrir) => {
    const pastaBoard = {
      header: { folderId: 'f6p', folderName: 'Clientes', folderArchivedAt: null, spaceId: 'f6e', spaceName: 'Produção', categoryName: 'Ide', lists: 2 },
      etapas: F6_ETAPAS.map((s) => ({ key: s.name.toLowerCase(), name: s.name, type: s.type, color: null, lists: 2, ordem: s.sortOrder, statusByList: { [F6.lista]: s.id, [F6.irma]: s.id } })),
      lists: [{ id: F6.lista, name: 'Criação e conteúdo', tasks: 8 }, { id: F6.irma, name: 'Audiovisual', tasks: 8 }],
      tasks: F6_CARTOES.filter((t) => t.parentId === null).map((t, i) => ({ ...t, listId: i % 2 ? F6.irma : F6.lista, listName: i % 2 ? 'Audiovisual' : 'Criação e conteúdo', columnKey: F6_ETAPAS.find((s) => s.id === t.statusId).name.toLowerCase() })),
      columnTotals: Object.fromEntries(F6_ETAPAS.map((s) => [s.name.toLowerCase(), 4])), columnMatched: Object.fromEntries(F6_ETAPAS.map((s) => [s.name.toLowerCase(), 4])),
      perColumn: 50, assigneeOptions: [], unassignedTasks: 0, availableTags: [], filter: { texto: '', responsavel: null },
    };
    const { page, context } = await abrir({ viewport: { width: 1440, height: 900 }, custom: (url) => (url.pathname.startsWith('/api/board/folders/f6p') ? { body: { ok: true, board: pastaBoard } } : f6Servidor(url)) });
    await page.goto(`${BASE}/quadro/pasta/f6p`);
    await page.locator('.q-coluna-topo').first().waitFor();
    await pause(300);
    let m = await f6Medir(page);
    assert.equal(m.h1, 'Clientes');
    assert.equal(m.contagem, '2 listas · 4 etapas · 16 tarefas · 12 em aberto · 4 concluídas');
    assert.ok(m.coluna.top < 0.25 * m.innerH, `pasta: colunas antes de 25% (${m.coluna.top})`);
    assert.equal(await page.locator('.q-lista-do-cartao').count(), 16, 'todo cartão da pasta diz de que lista veio');
    await f6Capturar(page, 'f06a-pasta-1440-claro');
    await page.goto(`${BASE}/quadro/espaco/f6e`);
    await page.locator('.ve-bloco').first().waitFor();
    m = await f6Medir(page);
    assert.equal(m.h1, 'Produção');
    assert.ok(await page.getByRole('heading', { name: 'Listas sem pasta' }).isVisible(), 'listas sem pasta continuam à vista');
    assert.equal(await page.locator('.ve-lista', { hasText: 'Campanha antiga' }).count(), 0, 'arquivada fica fora sem o interruptor');
    // Liga os arquivados pela árvore: a mesma preferência vale para o espaço.
    await page.locator('#barra-lateral .cu-arvore-pe').click();
    await page.locator('.ve-lista', { hasText: 'Campanha antiga' }).waitFor();
    assert.ok(await page.locator('.ve-lista', { hasText: 'Campanha antiga' }).locator('.cu-selo-morto').isVisible(), 'arquivada com o selo');
    await f6Capturar(page, 'f06a-espaco-1440-claro');
    await context.close();
    return 'pasta com origem nos 16 cartões; espaço com soltas e arquivada sob o interruptor';
  });

  /* ───────────────────────────── F06B ─────────────────────────────
     Cartão, linha e continuidade: título forte, prazo com palavra (e não só
     cor), responsável como alvo próprio, cliente só quando não é o da lista,
     coluna vazia por filtro ≠ coluna vazia, controle dentro do cartão não
     abre a ficha, e voltar da ficha mantém a busca. `F06B_CAPTURAS=<pasta>`
     grava quadro, pasta, Minhas e Todas em 1440/390, claro e escuro. */
  const doisDig = (n) => String(n).padStart(2, '0');
  const dia = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}`; };
  const curta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const PESSOAS = [{ id: 'u-bia', name: 'Beatriz Nogueira' }, { id: 'u-rafa', name: 'Rafael Martins' }];
  const H = { clientId: 'cli-h', clientName: 'Horizonte Studio' };
  const LONGO = 'Organizar o material completo de aprovação da campanha institucional de fim de ano com todas as variações de formato para redes sociais';
  const F6B_CARTOES = [
    { ...cartao('b-atraso', 'Revisar carrossel da campanha de primavera', 'f6s0'), ...H, dueOn: dia(-3), priority: 'high', assignees: [PESSOAS[0]], taskTypeName: 'Arte',
      tags: [{ id: 'tg1', name: 'Instagram', bgColor: null, fgColor: null }], commentCount: 3, hasAttachment: true, hasDescription: true, checklistDone: 1, checklistTotal: 3 },
    { ...cartao('b-hoje', 'Editar vídeo de apresentação', 'f6s0'), ...H, dueOn: dia(0), assignees: [PESSOAS[1]], taskTypeName: 'Vídeo', commentCount: 1 },
    { ...cartao('b-longo', LONGO, 'f6s0'), ...H, dueOn: dia(1) },
    { ...cartao('b-semdata', 'Conferir briefing e referências', 'f6s1'), ...H },
    { ...cartao('b-outro', 'Adaptar peça para parceiro', 'f6s1'), clientId: 'cli-o', clientName: 'Outro Cliente', dueOn: dia(4), assignees: PESSOAS, subtaskCount: 2 },
    { ...cartao('b-futura', 'Planejar pauta de outubro', 'f6s2'), dueOn: dia(20), priority: 'urgent' },
  ];
  const f6bServidor = (movimentos = []) => (url, req) => {
    const p = url.pathname;
    if (p === `/api/board/lists/${F6.lista}`) return { body: { ok: true, board: f6Quadro(F6.lista, url, { cartoes: F6B_CARTOES }) } };
    if (p === '/api/team') return { body: { ok: true, team: PESSOAS, me: 'u-bia' } };
    if (p.endsWith('/assignable')) return { body: { ok: true, people: PESSOAS.map((x) => ({ ...x, assigned: false })), me: 'u-bia' } };
    if (p.endsWith('/move') && req.method() === 'POST') {
      const b = req.postDataJSON();
      movimentos.push(b);
      return { body: { ok: true, move: { taskId: p.split('/').at(-2), listId: F6.lista, statusId: b.statusId, previousStatusId: 'f6s0', statusRepositioned: false, subtasksMoved: 0, automation: null } } };
    }
    if (p.startsWith('/api/board/folders/f6p')) {
      const listas = [[F6.lista, 'Criação e conteúdo'], [F6.irma, 'Audiovisual']];
      return { body: { ok: true, board: {
        header: { folderId: 'f6p', folderName: 'Clientes', folderArchivedAt: null, spaceId: 'f6e', spaceName: 'Produção', categoryName: 'Ide', lists: 2 },
        etapas: F6_ETAPAS.map((s) => ({ key: s.name.toLowerCase(), name: s.name, type: s.type, color: null, lists: 2, ordem: s.sortOrder, statusByList: { [F6.lista]: s.id, [F6.irma]: s.id } })),
        lists: listas.map(([id, name]) => ({ id, name, tasks: 3 })),
        tasks: F6B_CARTOES.map((t, i) => ({ ...t, listId: listas[i % 2][0], listName: listas[i % 2][1], columnKey: F6_ETAPAS.find((s) => s.id === t.statusId).name.toLowerCase() })),
        columnTotals: Object.fromEntries(F6_ETAPAS.map((s) => [s.name.toLowerCase(), F6B_CARTOES.filter((t) => t.statusId === s.id).length])),
        columnMatched: Object.fromEntries(F6_ETAPAS.map((s) => [s.name.toLowerCase(), F6B_CARTOES.filter((t) => t.statusId === s.id).length])),
        perColumn: 50, assigneeOptions: [], unassignedTasks: 0, availableTags: [], filter: { texto: '', responsavel: null },
      } } };
    }
    const linhas = F6B_CARTOES.map((t, i) => ({ ...row, ...t, id: `00000000-0000-0000-0000-0000000f6b${doisDig(i)}`, statusType: i === 5 ? 'custom' : 'open', statusName: 'a fazer',
      listId: i % 2 ? F6.irma : F6.lista, listName: i % 2 ? 'Audiovisual' : 'Criação e conteúdo', folderName: 'Clientes', spaceName: 'Produção', listLive: true }));
    if (p === '/api/board/all-tasks') return { body: { ok: true, work: { rows: linhas, total: linhas.length, matched: linhas.length, capped: false, assigneeOptions: [], unassignedTasks: 0 } } };
    if (p === '/api/board/my-tasks') {
      const aba = url.searchParams.get('aba') ?? 'pendente';
      const rows = aba === 'pendente' ? linhas : [];
      return { body: { ok: true, work: { rows, total: rows.length, capped: false, aba, counts: { pendente: rows.length, feito: 0, delegado: 0 }, returned: rows.length, hasMore: false, nextCursor: null } } };
    }
    return f6Servidor(url);
  };
  const F6B_CAPTURAS = process.env.F06B_CAPTURAS ?? '';
  const f6bCapturar = async (page, nome) => { if (F6B_CAPTURAS) await page.screenshot({ path: `${F6B_CAPTURAS}/${nome}.png` }); };
  const cartaoDe = (page, titulo) => page.locator('.q-cartao', { has: page.locator('a.q-titulo-cartao', { hasText: titulo }) });
  const semRuido = (erros) => erros.filter((e) => !/chat\/live|WebSocket|validateDOMNesting/i.test(e));

  for (const [largura, tema] of [[1440, 'claro'], [1440, 'escuro'], [390, 'claro'], [390, 'escuro']]) {
    await cenario(`F06B-telas-${largura}-${tema}`, 'quadro, pasta, Minhas e Todas: sem rolagem de página de lado; títulos longos não vazam do cartão', async (abrir) => {
      const { page, erros } = await abrir({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, tema, custom: f6bServidor() });
      const saida = [];
      for (const [nome, rota, espera] of [
        ['quadro', `/quadro/${F6.lista}`, '.q-cartao'],
        ['pasta', '/quadro/pasta/f6p', '.q-cartao'],
        ['minhas', '/meu-trabalho', '.mt-linha'],
        ['todas', '/tarefas', '.mt-linha'],
        ['todas-quadro', '/tarefas?ver=quadro', '.q-cartao'],
      ]) {
        await page.goto(BASE + rota);
        await page.locator(espera).first().waitFor();
        await pause(350);
        const m = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          iw: innerWidth,
          vazam: [...document.querySelectorAll('.q-cartao, .mt-linha')].filter((c) => c.scrollWidth > c.clientWidth + 1).length,
        }));
        assert.ok(m.sw <= m.iw, `${nome}: a página não rola de lado (${m.sw} > ${m.iw})`);
        assert.equal(m.vazam, 0, `${nome}: nenhum cartão/linha com conteúdo vazando`);
        await f6bCapturar(page, `f06b-${nome}-${largura}-${tema}`);
        saida.push(nome);
      }
      assert.deepEqual(semRuido(erros), []);
      return saida.join(' · ');
    });
  }

  await cenario('F06B-cartao', 'hierarquia do cartão; prazo com palavra; cliente só quando não é o da lista; alvos com nomes distintos', async (abrir) => {
    const { page, erros } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f6bServidor() });
    await page.goto(`${BASE}/quadro/${F6.lista}`);
    await page.locator('.q-cartao').first().waitFor();
    const atraso = cartaoDe(page, 'Revisar carrossel');
    // Título é a coisa mais forte; os metadados vêm a um degrau abaixo.
    const pesos = await atraso.evaluate((el) => {
      const t = getComputedStyle(el.querySelector('.q-titulo-cartao'));
      const m = getComputedStyle(el.querySelector('.q-linha-cartao'));
      return { tituloPx: parseFloat(t.fontSize), tituloPeso: Number(t.fontWeight), metaPx: parseFloat(m.fontSize) };
    });
    assert.ok(pesos.tituloPx >= pesos.metaPx + 2 && pesos.tituloPeso >= 500, `título acima dos metadados: ${JSON.stringify(pesos)}`);
    // Prazo: a palavra diz o atraso, a data inteira fica no nome acessível.
    const prazo = atraso.locator('.q-prazo');
    assert.equal(await prazo.getAttribute('data-estado'), 'atrasada');
    assert.equal(await prazo.locator('.q-prazo-curto').innerText(), `Atrasada · ${curta(dia(-3))}`);
    assert.match(await prazo.textContent(), /Prazo vencido em \d{2}\/\d{2}\/\d{4}/, 'a data inteira está no texto para leitor de tela');
    assert.equal(await cartaoDe(page, 'Editar vídeo').locator('.q-prazo-curto').innerText(), 'Hoje');
    assert.equal(await cartaoDe(page, 'Organizar o material').locator('.q-prazo-curto').innerText(), 'Amanhã');
    assert.equal(await cartaoDe(page, 'Conferir briefing').locator('.q-prazo').count(), 0, 'sem data, sem prazo inventado');
    assert.equal(await cartaoDe(page, 'Adaptar peça').locator('.q-prazo').getAttribute('data-estado'), 'embreve');
    // Os indicadores continuam lá, com nome — só mais leves.
    for (const nome of ['Tem descrição', 'Tem anexo', '3 comentários', '1 de 3 itens do checklist']) {
      assert.equal(await atraso.getByRole('img', { name: nome }).count() + await atraso.getByTitle(nome).count() > 0, true, `indicador "${nome}"`);
    }
    // Cliente: o da lista não se repete; o de outro cliente continua.
    assert.equal(await page.locator('.q-cartao-cliente', { hasText: 'Horizonte Studio' }).count(), 0, 'o cliente da lista não se repete no cartão');
    assert.equal(await cartaoDe(page, 'Adaptar peça').locator('.q-cartao-cliente').innerText(), 'Outro Cliente');
    // Alvos: abrir tarefa, alterar responsável e mover têm nomes diferentes.
    assert.equal(await atraso.getByRole('link', { name: 'Revisar carrossel da campanha de primavera', exact: true }).count(), 1);
    assert.equal(await atraso.getByRole('button', { name: /^Alterar responsável por Revisar carrossel.*Beatriz Nogueira$/ }).count(), 1);
    assert.equal(await cartaoDe(page, 'Conferir briefing').getByRole('button', { name: 'Definir responsável por Conferir briefing e referências' }).count(), 1);
    assert.equal(await atraso.getByRole('button', { name: /^Mover Revisar carrossel/ }).count(), 1);
    // Coluna vazia de verdade diz que não há; sem filtro, nenhuma fala em busca.
    // F06C: ela nasce recolhida; aberta pela faixa, diz a mesma frase.
    assert.equal(await page.locator('.q-coluna').nth(3).getAttribute('data-recolhida'), 'true');
    await page.locator('.q-coluna').nth(3).locator('.q-dobra').click();
    const vazia = page.locator('.q-coluna').nth(3).locator('.q-coluna-vazia');
    assert.equal(await vazia.getAttribute('data-motivo'), 'vazia');
    assert.equal(await vazia.innerText(), 'Nenhuma tarefa nesta etapa.');
    assert.deepEqual(semRuido(erros), []);
    return `título ${pesos.tituloPx}px/${pesos.tituloPeso} × meta ${pesos.metaPx}px; prazos Atrasada/Hoje/Amanhã/em breve`;
  });

  await cenario('F06B-controles', 'controle dentro do cartão não abre a ficha; setas movem; coluna filtrada ≠ vazia; a ficha volta com a busca', async (abrir) => {
    const movimentos = [];
    // A lista de pessoas demora de propósito: o Esc tem de fechar o balão
    // enquanto ela carrega E depois que ela chega.
    const base = f6bServidor(movimentos);
    const custom = async (url, req) => {
      if (url.pathname.endsWith('/assignable')) await pause(700);
      return base(url, req);
    };
    const { page, erros } = await abrir({ viewport: { width: 1440, height: 900 }, custom });
    await page.goto(`${BASE}/quadro/${F6.lista}`);
    await page.locator('.q-cartao').first().waitFor();
    const url0 = page.url();
    const atraso = cartaoDe(page, 'Revisar carrossel');
    const botaoResp = atraso.getByRole('button', { name: /^Alterar responsável/ });
    // Esc logo ao abrir, com a lista de pessoas ainda carregando.
    await botaoResp.click();
    await page.locator('.cu-balao').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.cu-balao').waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(page.url(), url0, 'o Esc fecha o balão e não sai do quadro');
    // Pelo teclado, Enter e Esc colados: o Esc chega antes de o foco entrar
    // no balão (ele espera a medida) e ainda assim fecha.
    await botaoResp.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('.cu-balao').waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(page.url(), url0, 'Enter + Esc no responsável não sai do quadro');
    // Responsável: abre o menu de pessoas, não navega, não arrasta; o Esc
    // fecha depois que as pessoas chegam.
    await botaoResp.click();
    await page.getByRole('menuitemcheckbox', { name: /Rafael Martins/ }).waitFor();
    assert.equal(page.url(), url0, 'o clique no responsável não abre a ficha');
    await page.keyboard.press('Escape');
    await page.locator('.cu-balao').waitFor({ state: 'detached', timeout: 2000 });
    assert.equal(page.url(), url0, 'o Esc fecha o balão e não sai do quadro');
    // ···: abre Mover para, sem navegar.
    await atraso.hover();
    await atraso.getByRole('button', { name: /^Mover Revisar carrossel/ }).click();
    await page.locator('.cu-balao').first().waitFor();
    assert.equal(page.url(), url0, 'o ··· não abre a ficha');
    await atraso.getByRole('button', { name: /^Mover Revisar carrossel/ }).click();
    await page.locator('.cu-balao').waitFor({ state: 'detached' });
    // Teclado: o cartão em foco anda de coluna pela seta.
    await cartaoDe(page, 'Editar vídeo').focus();
    await page.keyboard.press('ArrowRight');
    await pause(400);
    assert.equal(movimentos.at(-1)?.statusId, 'f6s1', `a seta pede a etapa seguinte: ${JSON.stringify(movimentos)}`);
    // Coluna vazia por filtro: diz quantas existem e que a busca as tirou.
    await page.goto(`${BASE}/quadro/${F6.lista}?busca=revisar`);
    await page.locator('.q-cartao').first().waitFor();
    const filtrada = page.locator('.q-coluna').nth(1).locator('.q-coluna-vazia');
    assert.equal(await filtrada.getAttribute('data-motivo'), 'filtro');
    assert.equal(await filtrada.innerText(), 'Nenhuma das 2 bate com o filtro.');
    // F06C: a vazia de verdade continua recolhida com filtro; a filtrada, não.
    assert.equal(await page.locator('.q-coluna').nth(3).getAttribute('data-recolhida'), 'true');
    await page.locator('.q-coluna').nth(3).locator('.q-dobra').click();
    assert.equal(await page.locator('.q-coluna').nth(3).locator('.q-coluna-vazia').innerText(), 'Nenhuma tarefa nesta etapa.');
    await pause(500);
    await f6bCapturar(page, 'f06b-quadro-filtrado-1440-claro');
    // Abrir a tarefa pelo título e fechar: a busca continua. F43, Fase 7: o
    // título abre a ficha AO LADO, e fechar é o ✕ do painel.
    await cartaoDe(page, 'Revisar carrossel').locator('a.q-titulo-cartao').click();
    await painelDaFicha(page).waitFor();
    await fecharFicha(page).click();
    await page.waitForURL((u) => u.pathname === `/quadro/${F6.lista}`);
    await page.locator('.q-cartao').first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get('busca'), 'revisar', 'o endereço volta com a busca');
    assert.equal(await page.getByRole('textbox', { name: 'Buscar tarefa pelo nome', exact: true }).inputValue(), 'revisar');
    assert.deepEqual(semRuido(erros), []);
    return `movimento ${JSON.stringify(movimentos.at(-1))}; busca preservada no retorno`;
  });

  await cenario('F06B-origem', 'pasta e Todas: origem e cliente em todo cartão; linha com prazo em palavra e alvos distintos', async (abrir) => {
    const { page, erros } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f6bServidor() });
    await page.goto(`${BASE}/quadro/pasta/f6p`);
    await page.locator('.q-cartao').first().waitFor();
    assert.equal(await page.locator('.q-lista-do-cartao').count(), F6B_CARTOES.length, 'todo cartão da pasta diz a lista');
    assert.equal(await page.getByRole('link', { name: 'Abrir a lista Audiovisual' }).count() > 0, true, 'o link da origem diz o que abre');
    // Na pasta o cliente não é redundante: continua em quem tem.
    assert.equal(await page.locator('.q-cartao-cliente', { hasText: 'Horizonte Studio' }).count(), 4);
    await page.goto(`${BASE}/meu-trabalho`);
    await page.locator('.mt-linha').first().waitFor();
    const linha = page.locator('.mt-linha', { hasText: 'Revisar carrossel' });
    assert.match(await linha.locator('.mt-prazo .q-prazo-curto').innerText(), /^Atrasada · \d{2}\/\d{2}$/);
    assert.match(await linha.locator('.mt-prazo').textContent(), /Prazo vencido em/);
    assert.equal(await linha.getByRole('link', { name: 'Revisar carrossel da campanha de primavera', exact: true }).count(), 1);
    assert.equal(await linha.getByRole('link', { name: 'Criação e conteúdo', exact: true }).count(), 1, 'a lista é outro alvo, com o nome dela');
    assert.equal(await page.locator('.mt-linha', { hasText: 'Conferir briefing' }).locator('.mt-prazo').count(), 0);
    assert.deepEqual(semRuido(erros), []);
    return 'pasta com 6 origens; linha com Atrasada e dois alvos';
  });

  /* ───────────────────────────── F06C ─────────────────────────────
     Colunas vazias (revisão de 28/09, R04). A lista tem a forma do caso
     observado: dez tarefas, três abertas, as duas primeiras etapas vazias.
     A etapa vazia nasce recolhida numa faixa estreita, na ordem do fluxo, e
     continua sendo destino: soltar cartão, seta do teclado e criar tarefa.
     `F06C_CAPTURAS=<pasta>` grava as telas. */
  const F6C_CAPTURAS = process.env.F06C_CAPTURAS ?? '';
  const f6cCapturar = async (page, nome) => { if (F6C_CAPTURAS) await page.screenshot({ path: `${F6C_CAPTURAS}/${nome}.png` }); };
  const coluna = (page, id) => page.locator(`.q-coluna[data-etapa="${id}"]`);
  const recolhidas = (page) => page.evaluate(() => [...document.querySelectorAll('.q-coluna[data-recolhida="true"]')].map((c) => c.dataset.etapa));
  const lerLugar = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ideworks:lugar') ?? '{}'));

  await cenario('F06C-recolhe', 'vazias recolhidas por padrão, na ordem; a primeira aberta perto da borda; interruptor reversível e lembrado', async (abrir) => {
    const { page, erros } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f6cServidor() });
    await page.goto(`${BASE}/quadro/${F6C.lista}`);
    await page.locator('.q-cartao').first().waitFor();
    assert.deepEqual(await recolhidas(page), ['f6c0', 'f6c1', 'f6c3', 'f6c5'], 'as quatro etapas vazias recolhem');
    const m = await page.evaluate(() => {
      const f = document.querySelector('.q-colunas').getBoundingClientRect();
      const cs = [...document.querySelectorAll('.q-colunas > .q-coluna')];
      const primeiro = document.querySelector('.q-cartao').getBoundingClientRect();
      return {
        ordem: cs.map((c) => c.dataset.etapa),
        larguras: cs.map((c) => Math.round(c.getBoundingClientRect().width)),
        desloc: Math.round(primeiro.left - f.left),
        cabe: document.querySelector('.q-colunas').scrollWidth <= document.querySelector('.q-colunas').clientWidth + 1,
      };
    });
    assert.deepEqual(m.ordem, ['f6c0', 'f6c1', 'f6c2', 'f6c3', 'f6c4', 'f6c5', 'f6c6'], 'a ordem do fluxo não muda');
    for (const i of [0, 1, 3, 5]) assert.ok(m.larguras[i] <= 48, `faixa estreita: ${m.larguras}`);
    assert.ok(m.desloc < 140, `a primeira tarefa aberta começa a ${m.desloc}px da borda da faixa (antes: ~584)`);
    assert.ok(m.cabe, 'a 1440 o quadro inteiro cabe sem rolar');
    assert.equal(await page.locator('.q-etapas').count(), 0, 'cabendo, não há fila de atalhos');
    // A faixa diz o nome e a contagem, e o nome acessível diz o que o clique faz.
    const dobra = coluna(page, 'f6c1').getByRole('button', { name: 'Abrir a etapa Em produção, vazia' });
    assert.equal(await dobra.count(), 1);
    assert.match(await coluna(page, 'f6c1').innerText(), /0\s*Em produção/);
    await f6cCapturar(page, 'f06c-quadro-1440-claro-recolhidas');
    await dobra.click();
    const fechar = coluna(page, 'f6c1').getByRole('button', { name: 'Recolher a etapa Em produção', exact: true });
    await fechar.focus();
    await page.keyboard.press('Enter');
    await dobra.waitFor();
    assert.deepEqual(await recolhidas(page), ['f6c0', 'f6c1', 'f6c3', 'f6c5']);
    assert.equal(await dobra.evaluate((el) => el === document.activeElement), true, 'foco volta à faixa');
    await page.reload();
    await page.locator('.q-cartao').first().waitFor();
    assert.equal(await coluna(page, 'f6c1').getAttribute('data-recolhida'), 'true', 'recolhimento individual persiste');
    await dobra.click();
    await fechar.click();
    await dobra.waitFor();
    // Desligar: todas com a largura inteira, a fila de atalhos aparece (não cabe mais).
    const interruptor = page.getByRole('button', { name: /^Recolher vazias/ });
    assert.equal(await interruptor.getAttribute('aria-pressed'), 'true');
    await interruptor.click();
    assert.deepEqual(await recolhidas(page), []);
    assert.equal(await interruptor.getAttribute('aria-pressed'), 'false');
    assert.equal((await lerLugar(page)).vazias, false, 'a escolha é guardada');
    await page.locator('.q-etapas').waitFor({ timeout: 3000 });
    // Recarregar lembra.
    await page.reload();
    await page.locator('.q-cartao').first().waitFor();
    assert.deepEqual(await recolhidas(page), [], 'recarregar mantém desligado');
    await page.getByRole('button', { name: /^Recolher vazias/ }).click();
    assert.deepEqual(await recolhidas(page), ['f6c0', 'f6c1', 'f6c3', 'f6c5'], 'religar recolhe de novo');
    assert.deepEqual(semRuido(erros), []);
    return `primeira tarefa a ${m.desloc}px; larguras ${m.larguras.join('/')}`;
  });

  await cenario('F06C-destinos', 'etapa recolhida recebe cartão arrastado e pela seta; abrir a faixa leva ao Adicionar tarefa e cria ali', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f6cServidor(estado) });
    await page.goto(`${BASE}/quadro/${F6C.lista}`);
    await page.locator('.q-cartao').first().waitFor();
    // Arrastar até a faixa recolhida de `A fazer`.
    const carrossel = page.locator('.q-cartao', { hasText: 'Carrossel de lançamento' });
    await carrossel.dragTo(coluna(page, 'f6c0'));
    await page.waitForFunction(() => document.querySelector('.q-coluna[data-etapa="f6c0"]')?.textContent.includes('Carrossel de lançamento'), null, { timeout: 5000 });
    assert.deepEqual(estado.movimentos.map((x) => x.statusId), ['f6c0'], 'soltou na etapa recolhida');
    assert.equal(await coluna(page, 'f6c0').getAttribute('data-recolhida'), null, 'com cartão, a etapa abre');
    // `Em aprovação` ficou vazia e recolheu (depois da releitura).
    await page.waitForFunction(() => document.querySelector('.q-coluna[data-etapa="f6c2"]')?.dataset.recolhida === 'true', null, { timeout: 5000 });
    // Seta do teclado: de `Enviado` para a esquerda cai em `Ajustes`, recolhida.
    const video = page.locator('.q-cartao', { hasText: 'Vídeo institucional' });
    await video.focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('.q-coluna[data-etapa="f6c3"]')?.textContent.includes('Vídeo institucional'), null, { timeout: 5000 });
    assert.equal(estado.movimentos.at(-1).statusId, 'f6c3', 'a seta anda pela esteira inteira, recolhida ou não');
    // Criar numa etapa recolhida: abrir a faixa leva o foco ao Adicionar tarefa.
    await coluna(page, 'f6c5').getByRole('button', { name: 'Abrir a etapa Agendado, vazia' }).click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('t-adicionar'), null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.activeElement.closest('.q-coluna')?.dataset.etapa), 'f6c5');
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Título da tarefa nova' }).fill('Tarefa criada na etapa recolhida');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.q-coluna[data-etapa="f6c5"]')?.textContent.includes('Tarefa criada na etapa recolhida'), null, { timeout: 5000 });
    assert.deepEqual(estado.criadas, [{ title: 'Tarefa criada na etapa recolhida', statusId: 'f6c5' }]);
    assert.deepEqual(semRuido(erros), []);
    return `movimentos ${estado.movimentos.map((x) => x.statusId).join(', ')}; criada em f6c5`;
  });

  await cenario('F06C-pasta', 'pasta: vazias recolhidas, soltura na faixa, o mesmo interruptor', async (abrir) => {
    const estado = novoEstado();
    const { page, erros } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f6cServidor(estado) });
    await page.goto(`${BASE}/quadro/pasta/${F6C.pasta}`);
    await page.locator('.q-cartao').first().waitFor();
    assert.deepEqual(await recolhidas(page), ['a fazer', 'em produção', 'ajustes', 'agendado']);
    await page.locator('.q-cartao', { hasText: 'Roteiro da série' }).dragTo(coluna(page, 'ajustes'));
    await page.waitForFunction(() => document.querySelector('.q-coluna[data-etapa="ajustes"]')?.textContent.includes('Roteiro da série'), null, { timeout: 5000 });
    assert.equal(estado.movimentos.at(-1).statusId, 'f6c3');
    const vazia = coluna(page, 'em produção');
    await vazia.locator('.q-dobra').click();
    await vazia.getByRole('button', { name: /^Recolher a etapa/ }).click();
    await vazia.locator('.q-dobra').waitFor();
    await page.getByRole('button', { name: /^Recolher vazias/ }).click();
    assert.deepEqual(await recolhidas(page), []);
    assert.deepEqual(semRuido(erros), []);
    return 'pasta ok';
  });

  await cenario('F06C-navegar', '390: fila de atalhos na ordem do fluxo; o atalho leva a coluna à borda e abre a recolhida; roda vertical não mexe a faixa', async (abrir) => {
    const { page, erros } = await abrir({ viewport: { width: 390, height: 844 }, custom: f6cServidor() });
    await page.goto(`${BASE}/quadro/${F6C.lista}`);
    await page.locator('.q-cartao').first().waitFor();
    const fila = page.getByRole('navigation', { name: 'Ir para a etapa' });
    await fila.waitFor();
    const nomes = await fila.getByRole('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
    assert.deepEqual(nomes.map((n) => n.split(',')[0]), ['A fazer', 'Em produção', 'Em aprovação', 'Ajustes', 'Enviado ao cliente', 'Agendado', 'Publicado']);
    assert.equal(nomes[0], 'A fazer, 0 tarefas, recolhida');
    const faixa = page.locator('.q-colunas');
    await fila.getByRole('button', { name: /^Publicado,/ }).click();
    await page.waitForFunction(() => {
      const f = document.querySelector('.q-colunas').getBoundingClientRect();
      const c = document.querySelector('.q-coluna[data-etapa="f6c6"]').getBoundingClientRect();
      // A última não encosta na borda esquerda (a faixa acaba antes): fica inteira à vista.
      return c.left >= f.left - 2 && c.right <= f.right + 2;
    }, null, { timeout: 4000 });
    // A rolagem é suave: espera ela assentar antes de medir.
    const assentar = async () => { let a = -1; for (let i = 0; i < 30; i += 1) { const b = await faixa.evaluate((el) => el.scrollLeft); if (b === a) return b; a = b; await pause(80); } return a; };
    const depois = await assentar();
    assert.ok(depois > 300, `a faixa andou até Publicado: ${depois}`);
    assert.equal(await fila.getByRole('button', { name: /^Publicado,/ }).getAttribute('data-a-vista'), 'true', 'o atalho marca a etapa à vista');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.etapa), 'f6c6', 'o foco vai para a coluna');
    await f6cCapturar(page, 'f06c-quadro-390-claro-navegado');
    // Roda vertical sobre a faixa e sobre uma faixa recolhida: a posição lateral fica.
    const caixa = await faixa.boundingBox();
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + 40);
    await page.mouse.wheel(0, 500);
    await pause(300);
    const aposRoda = await faixa.evaluate((el) => el.scrollLeft);
    assert.equal(aposRoda, depois, `roda vertical não mexe scrollLeft (${depois} → ${aposRoda})`);
    // O atalho de uma etapa recolhida abre a etapa e a leva à borda.
    await fila.getByRole('button', { name: /^Em produção,/ }).click();
    await page.waitForFunction(() => {
      const c = document.querySelector('.q-coluna[data-etapa="f6c1"]');
      const f = document.querySelector('.q-colunas').getBoundingClientRect();
      return c.dataset.recolhida === undefined && Math.abs(c.getBoundingClientRect().left - f.left) <= 2;
    }, null, { timeout: 4000 });
    await page.mouse.wheel(0, 500);
    await pause(300);
    const final = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    assert.ok(final.sw <= final.iw, 'a página não rola de lado');
    assert.deepEqual(semRuido(erros), []);
    return `faixa → ${depois}px em Publicado; Em produção aberta pelo atalho`;
  });

  for (const [largura, tema] of [[1440, 'claro'], [1440, 'escuro'], [390, 'claro'], [390, 'escuro']]) {
    await cenario(`F06C-telas-${largura}-${tema}`, 'quadro e pasta com etapas vazias: sem rolagem de página; faixas legíveis', async (abrir) => {
      const { page, erros } = await abrir({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, tema, custom: f6cServidor() });
      for (const [nome, rota] of [['quadro', `/quadro/${F6C.lista}`], ['pasta', `/quadro/pasta/${F6C.pasta}`]]) {
        await page.goto(BASE + rota);
        await page.locator('.q-cartao').first().waitFor();
        await pause(350);
        const m = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, iw: innerWidth,
          nomes: [...document.querySelectorAll('.q-dobra-nome')].map((n) => n.scrollHeight <= n.clientHeight + 1),
        }));
        assert.ok(m.sw <= m.iw, `${nome}: a página não rola de lado (${m.sw} > ${m.iw})`);
        assert.ok(m.nomes.length === 4 && m.nomes.every(Boolean), `${nome}: nomes em pé inteiros: ${m.nomes}`);
        await f6cCapturar(page, `f06c-${nome}-${largura}-${tema}`);
      }
      assert.deepEqual(semRuido(erros), []);
      return 'quadro e pasta';
    });
  }

  return resultados;
}
