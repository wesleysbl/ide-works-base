/**
 * Data local e saída visível — F17.AUD07, provada no Chrome real.
 *
 * Achado 8: às 22h de 09/09 em São Paulo, `Novo cliente` sugeria 10/09 (o
 * dia UTC). Achado 9: o X da tarefa saía da janela ao rolar o briefing.
 *
 * O cabeçalho é provado em 1440 e 390 px, claro e escuro, com um briefing de
 * 60 blocos e 12 comentários: o X dentro da janela no início, no meio e no
 * fim; o cabeçalho `sticky` com o fundo da página; o menu de prioridade por
 * cima dele; o campo focado fora da sua sombra; a decisão de saída (AUD03)
 * ainda ligada ao X. Depois, os cenários da verificação: sem rolagem
 * horizontal, cabeçalho compacto, foco que sai de trás do cabeçalho,
 * Tab a partir do X, gaveta (390) e painel Personalizar (1440) por cima.
 */

import assert from 'node:assert/strict';

import { BASE, X, campoTitulo, criarSuite, detail, janela, pause, row } from './comum.mjs';

const briefing = Array.from({ length: 60 }, (_, i) => `## Bloco ${i + 1}\n\nParágrafo ${i + 1} do briefing, longo o bastante para a ficha rolar bem além de uma janela de 900px. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`).join('\n\n');
const comments = Array.from({ length: 12 }, (_, i) => ({
  id: 'c' + i, parentId: null, body: `Comentário ${i + 1} — texto de teste.`, author: { id: 'z', name: 'Wesley' },
  createdAt: '2026-08-25T12:00:00.000Z', editedAt: null, replyCount: 0, mine: true, replies: [],
}));
const tarefaLonga = { ...detail, id: row.id, title: row.title, description: briefing, comments, statuses: [{ id: 'st1', name: 'a fazer', type: 'open', color: '#d3d3d3', sortOrder: 0 }] };
const fichaLonga = (url) => (url.pathname.startsWith('/api/board/tasks/') ? { body: { ok: true, task: tarefaLonga, storage: { ready: false, variable: '' } } } : null);

const COMBINACOES = [
  { viewport: { width: 1440, height: 900 }, tema: 'escuro' },
  { viewport: { width: 1440, height: 900 }, tema: 'claro' },
  { viewport: { width: 390, height: 844 }, tema: 'escuro' },
  { viewport: { width: 390, height: 844 }, tema: 'claro' },
];
const rotulo = ({ viewport, tema }) => `${viewport.width}px ${tema}`;

/** Mede o X e o cabeçalho na posição de rolagem atual. */
const medir = (page) =>
  page.evaluate(() => {
    const x = document.querySelector('button[aria-label="Fechar tarefa e voltar"]');
    const cab = document.querySelector('.t-cabeca');
    const r = x.getBoundingClientRect();
    const c = cab.getBoundingClientRect();
    const alvo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const cs = getComputedStyle(cab);
    return {
      scrollY: Math.round(scrollY), docH: document.documentElement.scrollHeight,
      x: { y: Math.round(r.y), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) },
      cab: { y: Math.round(c.y), h: Math.round(c.height), position: cs.position, z: cs.zIndex, bg: cs.backgroundColor },
      bodyBg: getComputedStyle(document.body).backgroundColor,
      clicavel: alvo === x || x.contains(alvo),
      tema: document.documentElement.dataset.tema ?? '(sem)',
      innerH: innerHeight, innerW: innerWidth,
    };
  });

const medirFocado = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    const c = document.querySelector('.t-cabeca').getBoundingClientRect();
    const meio = document.elementFromPoint(r.x + Math.min(12, r.width / 2), r.y + r.height / 2);
    return {
      top: Math.round(r.top), cabBottom: Math.round(c.bottom), livre: r.top >= c.bottom - 0.5, visivel: el === meio || el.contains(meio),
      texto: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40), tag: el.tagName, dentroDaFicha: !!el.closest('.cu-ficha'),
    };
  });

async function abrirFichaLonga(abrir, combinacao) {
  const { page } = await abrir({ ...combinacao, custom: fichaLonga });
  await page.goto(BASE + '/tarefa/' + row.id);
  await page.getByRole('button', X).waitFor();
  await page.getByText('Bloco 60', { exact: true }).waitFor();
  await pause(300);
  return page;
}

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  for (const combinacao of COMBINACOES) {
    const rot = rotulo(combinacao);

    await cenario(`B1-${rot}`, `achado 9 — X dentro da janela no início, meio e fim; cabeçalho sticky com o fundo da página; menu, foco e decisão de saída`, async (abrir) => {
      const page = await abrirFichaLonga(abrir, combinacao);
      const topo = await medir(page);
      assert.equal(topo.tema, combinacao.tema, 'tema aplicado');
      assert.ok(topo.docH > topo.innerH * 2, 'a página rola de verdade: ' + topo.docH);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 2));
      await pause(200);
      const meio = await medir(page);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await pause(200);
      const fim = await medir(page);
      for (const [nome, m] of [['início', topo], ['meio', meio], ['fim', fim]]) {
        assert.ok(m.x.y >= 0 && m.x.bottom <= m.innerH, `${nome}: X dentro da janela (y=${m.x.y}, bottom=${m.x.bottom})`);
        assert.ok(m.x.right <= m.innerW, `${nome}: X não sai pela direita (right=${m.x.right})`);
        assert.ok(m.clicavel, `${nome}: elementFromPoint no centro do X devolve o X`);
        assert.ok(m.x.w >= 36 && m.x.h >= 36, `${nome}: área do X ≥ 36×36 (${m.x.w}×${m.x.h})`);
      }
      assert.equal(meio.cab.position, 'sticky');
      assert.equal(meio.cab.z, '1');
      assert.equal(meio.cab.bg, meio.bodyBg, 'fundo do cabeçalho = fundo da página');
      assert.equal(meio.cab.y, 0, 'cabeçalho grudado no topo no meio da página');

      await page.getByRole('button', X).focus();
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Fechar tarefa e voltar');

      // Menu aberto fica ACIMA do cabeçalho.
      await page.evaluate(() => scrollTo(0, 0));
      await pause(150);
      await page.locator('.cu-chip', { hasText: /^(Prioridade|Urgente|Alta|Normal|Baixa)$/ }).first().click();
      await page.locator('.cu-balao').first().waitFor();
      const pilha = await page.evaluate(async () => {
        const balao = document.querySelector('.cu-balao');
        const cab = document.querySelector('.t-cabeca');
        const b = balao.getBoundingClientRect();
        const c = cab.getBoundingClientRect();
        scrollBy(0, b.top - (c.height - 10));
        await new Promise((r) => setTimeout(r, 150));
        const b2 = balao.getBoundingClientRect();
        const c2 = cab.getBoundingClientRect();
        const px = b2.left + Math.min(40, b2.width / 2);
        const py = c2.bottom - 4;
        const dentroDasDuas = py > b2.top && py < b2.bottom && py > c2.top && py < c2.bottom;
        const topo = document.elementFromPoint(px, py);
        return { dentroDasDuas, topoEhBalao: !!topo && balao.contains(topo) };
      });
      assert.ok(pilha.dentroDasDuas, 'o ponto medido está dentro do balão e do cabeçalho');
      assert.ok(pilha.topoEhBalao, 'o balão está por cima do cabeçalho');
      await page.keyboard.press('Escape');

      // Campo focado não fica atrás do cabeçalho.
      await page.evaluate(() => scrollTo(0, 0));
      await page.evaluate(() => scrollBy(0, 400));
      await pause(150);
      await campoTitulo(page).focus();
      await pause(200);
      const foco = await medirFocado(page);
      assert.ok(foco.livre && foco.visivel, 'campo focado fora da sombra do cabeçalho: ' + JSON.stringify(foco));

      // A proteção de saída (AUD03) continua ligada ao X, e a janela fica acima do cabeçalho.
      await campoTitulo(page).fill('EDIÇÃO QUE NÃO PODE SUMIR');
      await page.getByText('há alterações por salvar', { exact: true }).waitFor();
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await pause(150);
      await page.getByRole('button', X).click();
      await janela(page).waitFor();
      const sobre = await page.evaluate(() => {
        const c = document.querySelector('.t-cabeca').getBoundingClientRect();
        const el = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
        return !!el && !!el.closest('.o-scrim');
      });
      assert.ok(sobre, 'a janela de saída cobre o cabeçalho');
      assert.equal(new URL(page.url()).pathname, '/tarefa/' + row.id);
      await page.getByRole('button', { name: 'Continuar editando' }).click();
      assert.equal(await campoTitulo(page).textContent(), 'EDIÇÃO QUE NÃO PODE SUMIR');
      return `X em y=${topo.x.y}/${meio.x.y}/${fim.x.y} (início/meio/fim) de ${fim.docH}px; cabeçalho ${meio.cab.position} z=${meio.cab.z}`;
    });
  }

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const rot = `${viewport.width}px`;

    // F29 (Fase 4): o cabeçalho virou o `Topo` — trilha numa linha, o título
    // embaixo, o X à direita (58px medidos). O teto de 60px continua: é ele
    // que impede o cabeçalho grudado de comer a janela do celular.
    await cenario(`V1-${rot}`, 'sem rolagem horizontal; cabeçalho compacto (≤ 60px)', async (abrir) => {
      const page = await abrirFichaLonga(abrir, { viewport, tema: 'escuro' });
      const geo = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        cabH: Math.round(document.querySelector('.t-cabeca').getBoundingClientRect().height),
      }));
      assert.ok(geo.scrollW <= geo.innerW, `sem rolagem horizontal (${geo.scrollW} ≤ ${geo.innerW})`);
      assert.ok(geo.cabH <= 60, `cabeçalho compacto (${geo.cabH}px)`);
      return `cabeçalho ${geo.cabH}px; scrollWidth ${geo.scrollW} ≤ ${geo.innerW}`;
    });

    await cenario(`V2-${rot}`, 'um campo atrás do cabeçalho grudado recebe foco e sai de trás dele (seletor de lista e Responder)', async (abrir) => {
      const page = await abrirFichaLonga(abrir, { viewport, tema: 'escuro' });
      for (const [nome, seletor, indice] of [['seletor de lista', '.cu-seletor', 0], ['Responder do 1º comentário', 'button', -1]]) {
        let idx = indice;
        if (idx === -1) idx = await page.evaluate(() => [...document.querySelectorAll('button')].findIndex((b) => b.textContent.trim() === 'Responder'));
        const antes = await page.evaluate(async ({ seletor, idx }) => {
          const el = document.querySelectorAll(seletor)[idx];
          const r = el.getBoundingClientRect();
          scrollBy(0, r.top - 20);
          await new Promise((res) => setTimeout(res, 150));
          const r2 = el.getBoundingClientRect();
          const c = document.querySelector('.t-cabeca').getBoundingClientRect();
          const alvo = document.elementFromPoint(r2.x + Math.min(12, r2.width / 2), r2.y + Math.min(6, r2.height / 2));
          return { top: Math.round(r2.top), cabBottom: Math.round(c.bottom), coberto: !!alvo && !!alvo.closest('.t-cabeca'), dentroDaJanela: r2.top >= 0 && r2.bottom <= innerHeight };
        }, { seletor, idx });
        assert.ok(antes.dentroDaJanela, `${nome}: o alvo está dentro da janela antes do foco: ${JSON.stringify(antes)}`);
        assert.ok(antes.coberto, `${nome}: o alvo está coberto pelo cabeçalho antes do foco (reprodução do risco): ${JSON.stringify(antes)}`);
        await page.evaluate(({ seletor, idx }) => document.querySelectorAll(seletor)[idx].focus(), { seletor, idx });
        await pause(250);
        const depois = await medirFocado(page);
        assert.ok(depois.livre && depois.visivel, `${nome}: depois do foco o campo está abaixo do cabeçalho e visível: ${JSON.stringify(depois)}`);
      }
    });

    await cenario(`V3-${rot}`, 'Tab a partir do X cai dentro da ficha, e o focado não fica atrás do cabeçalho', async (abrir) => {
      const page = await abrirFichaLonga(abrir, { viewport, tema: 'escuro' });
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await pause(150);
      await page.getByRole('button', X).focus();
      await page.keyboard.press('Tab');
      await pause(250);
      const tab = await medirFocado(page);
      assert.ok(tab.dentroDaFicha, 'Tab do X cai dentro da ficha: ' + JSON.stringify(tab));
      assert.ok(tab.livre && tab.visivel, 'o focado após Tab não fica atrás do cabeçalho: ' + JSON.stringify(tab));
      return `${tab.tag} "${tab.texto}" em y=${tab.top} ≥ ${tab.cabBottom}`;
    });

    if (viewport.width < 1024) {
      await cenario(`V5-${rot}`, 'a gaveta e o véu cobrem o cabeçalho e o X', async (abrir) => {
        const page = await abrirFichaLonga(abrir, { viewport, tema: 'escuro' });
        await page.getByRole('button', { name: 'Listas e atalhos' }).click();
        await page.getByRole('button', { name: 'Fechar as listas e atalhos' }).waitFor();
        await page.evaluate(() => scrollBy(0, 600));
        await pause(200);
        const gaveta = await page.evaluate(() => {
          const x = document.querySelector('button[aria-label="Fechar tarefa e voltar"]').getBoundingClientRect();
          const el = document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2);
          return { sobreOX: !!el && !el.closest('.t-cabeca') && !!(el.closest('.bl-veu') || el.closest('#barra-lateral') || el.closest('.bl-barra')), quem: el?.className?.toString().slice(0, 30) };
        });
        assert.ok(gaveta.sobreOX, 'a gaveta/véu cobre o X: ' + JSON.stringify(gaveta));
        await page.keyboard.press('Escape');
      });
    } else {
      await cenario(`V6-${rot}`, 'o painel Personalizar cobre o cabeçalho', async (abrir) => {
        const page = await abrirFichaLonga(abrir, { viewport, tema: 'escuro' });
        await page.evaluate(() => scrollBy(0, 600));
        await pause(150);
        // F29: `Personalizar` mora no menu da conta, no pé da barra.
        await page.locator('.bl-conta').click();
        await page.getByRole('menuitem', { name: 'Personalizar a barra lateral' }).click();
        await page.locator('.cu-fundo').waitFor();
        const cobre = await page.evaluate(() => {
          const c = document.querySelector('.t-cabeca').getBoundingClientRect();
          const el = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
          return !!el && !!el.closest('.cu-fundo');
        });
        assert.ok(cobre, 'Personalizar cobre o cabeçalho');
        await page.keyboard.press('Escape');
      });
    }
  }

  await cenario('B2-22h', 'achado 8 — às 22h de 09/09 em São Paulo, Novo cliente recebe 09/09', async (abrir) => {
    const { page } = await abrir({ timezoneId: 'America/Sao_Paulo' });
    await page.clock.setFixedTime(new Date('2026-09-10T01:00:00Z'));
    await page.goto(BASE + '/painel');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    const campo = page.getByLabel('Data de início *');
    await campo.waitFor();
    await pause(400);
    const relogio = await page.evaluate(() => ({ utc: new Date().toISOString(), local: new Date().toLocaleDateString('sv-SE'), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    assert.equal(relogio.local, '2026-09-09');
    assert.equal(relogio.utc.slice(0, 10), '2026-09-10');
    assert.equal(await campo.inputValue(), '2026-09-09');
    return `${relogio.tz}, UTC ${relogio.utc}: Data de início = 2026-09-09`;
  });

  await cenario('B2-meia-noite', 'à 0h de 10/09 em São Paulo, Novo cliente recebe o dia novo', async (abrir) => {
    const { page } = await abrir({ timezoneId: 'America/Sao_Paulo' });
    await page.clock.setFixedTime(new Date('2026-09-10T03:00:00Z'));
    await page.goto(BASE + '/painel');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    const campo = page.getByLabel('Data de início *');
    await campo.waitFor();
    await pause(400);
    assert.equal(await campo.inputValue(), '2026-09-10');
  });

  await cenario('B2-editar', 'editar cliente existente às 22h mantém a data salva (2025-03-01)', async (abrir) => {
    const { page } = await abrir({
      timezoneId: 'America/Sao_Paulo',
      custom: (url) => (url.pathname === '/api/clients/c9/form'
        ? { body: { ok: true, client: { name: 'Cliente antigo', taxId: '', companyEmail: '', planId: null, categoryId: 'c1', startedOn: '2025-03-01', renewsOn: '', phone: '', whatsapp: '', address: '', ownerName: '', ownerPhone: '', ownerWhatsapp: '', notes: '', quotas: { video: 0, arte: 0, foto: 0, ads: 0 }, links: [], tagIds: [] } } }
        : null),
    });
    await page.clock.setFixedTime(new Date('2026-09-10T01:00:00Z'));
    await page.goto(BASE + '/painel');
    await page.waitForLoadState('networkidle');
    // O painel fictício não tem cartão de cliente: monta a ficha em modo edição, como a auditoria fez.
    await page.evaluate(async () => {
      // O MESMO React da página — F29.5b. O Vite serve as dependências com
      // `?v=<hash>` (e, com outro `cacheDir`, noutro caminho); importar
      // `/node_modules/.vite/deps/react.js` sem o hash carregava uma SEGUNDA
      // cópia do React, e a ficha caía em "Invalid hook call" antes de
      // desenhar o campo. O endereço certo é o que o próprio `main.tsx`,
      // transformado pelo Vite, importa.
      const principal = await (await fetch('/src/main.tsx')).text();
      const dep = (nome) => principal.match(new RegExp(`from "([^"]*/deps/${nome}\\.js\\?v=[^"]+)"`))[1];
      const React = (await import(dep('react'))).default;
      const { createRoot } = (await import(dep('react-dom_client'))).default;
      const { FichaDeCliente } = await import('/src/clients/FichaDeCliente.tsx');
      const node = document.createElement('div');
      document.body.append(node);
      createRoot(node).render(React.createElement(FichaDeCliente, { clienteId: 'c9', aoFechar: () => {}, aoSalvar: () => {} }));
    });
    const campo = page.getByLabel('Data de início *');
    await campo.waitFor();
    await pause(400);
    assert.equal(await campo.inputValue(), '2025-03-01');
  });

  /* ───────────── F04 do plano UX: as seis telas na moldura comum ─────────────
     Minhas tarefas, Todas, Notificações, Espaço, Pasta e Quadro montavam a
     grade à mão. Agora passam pela `TelaComBarra`: aqui se prova, no Chrome,
     que as seis têm a MESMA orientação (grade → barra → coluna com o topo
     primeiro), que a preferência "árvore numa coluna" nunca deixa coluna sem
     saída, que o erro mora na coluna de conteúdo (e não empurra a barra), que
     a barra navega durante o carregamento e que mudar a largura não descarta
     o trabalho — busca digitada, rolagem do quadro, tarefa aberta. */
  const F04_LISTA = '00000000-0000-0000-0000-00000000f040';
  const F04_ETAPAS = Array.from({ length: 6 }, (_, i) => ({ id: `f4s${i}`, name: `Etapa ${i}`, type: i === 5 ? 'closed' : 'custom', color: null, sortOrder: i }));
  const f04Cartao = (id, title, statusId) => ({
    id, title, statusId, priority: null, dueOn: null, startOn: null, completedAt: null, hasDescription: false, hasAttachment: false,
    clientId: null, clientName: null, assignees: [], tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
    checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0,
  });
  const F04_CARTOES = [...Array.from({ length: 30 }, (_, i) => f04Cartao(`f4-longa-${i}`, `Longa ${i + 1}`, 'f4s0')), ...F04_ETAPAS.slice(1).map((s) => f04Cartao(`f4-${s.id}`, `Fica em ${s.name}`, s.id))];
  const f04Conta = Object.fromEntries(F04_ETAPAS.map((s) => [s.id, F04_CARTOES.filter((t) => t.statusId === s.id).length]));
  const F04_QUADRO = {
    header: { listId: F04_LISTA, listName: 'Criação', listContent: null, folderId: 'f4p', folderName: 'Clientes', spaceId: 'f4e', spaceName: 'Produção', categoryName: 'Ide', statusSetName: 'Esteira', inheritedFrom: 'list' },
    statuses: F04_ETAPAS, tasks: F04_CARTOES, availableTags: [], columnTotals: f04Conta, columnMatched: f04Conta, perColumn: 50,
    assigneeOptions: [], unassignedTasks: 0, filter: { texto: '', responsavel: null },
  };
  const f04Chave = (s) => s.name.toLowerCase();
  const F04_PASTA = {
    header: { folderId: 'f4p', folderName: 'Clientes', folderArchivedAt: null, spaceId: 'f4e', spaceName: 'Produção', categoryName: 'Ide', lists: 1 },
    etapas: F04_ETAPAS.map((s) => ({ key: f04Chave(s), name: s.name, type: s.type, color: null, lists: 1, ordem: s.sortOrder, statusByList: { [F04_LISTA]: s.id } })),
    lists: [{ id: F04_LISTA, name: 'Criação', tasks: F04_CARTOES.length }],
    tasks: F04_CARTOES.map((t) => ({ ...t, listId: F04_LISTA, listName: 'Criação', columnKey: f04Chave(F04_ETAPAS.find((s) => s.id === t.statusId)) })),
    columnTotals: Object.fromEntries(F04_ETAPAS.map((s) => [f04Chave(s), f04Conta[s.id]])),
    columnMatched: Object.fromEntries(F04_ETAPAS.map((s) => [f04Chave(s), f04Conta[s.id]])),
    perColumn: 50, assigneeOptions: [], unassignedTasks: 0, availableTags: [], filter: { texto: '', responsavel: null },
  };
  const F04_ARVORE = {
    ok: true, companies: [{ id: 'c1', name: 'Ide' }],
    spaces: [{
      spaceId: 'f4e', spaceName: 'Produção', spaceColor: null, spaceArchivedAt: null, categoryId: 'c1', categoryName: 'Ide',
      folderId: 'f4p', folderName: 'Clientes', folderArchivedAt: null, listId: F04_LISTA, listName: 'Criação', listContent: null,
      listArchivedAt: null, listIsLive: true, liveTasks: F04_CARTOES.length, totalTasks: F04_CARTOES.length, clientId: null, clientName: null,
      workflowName: 'Esteira', inheritedFrom: 'list',
    }],
  };
  const F04_LINHAS = ['Revisar carrossel', 'Finalizar vídeo', 'Conferir peças', 'Organizar pauta'].map((title, i) => ({ ...row, id: `00000000-0000-0000-0000-0000000f04${i}0`, title }));
  /** O servidor fictício das seis telas; `falhar` devolve 500 na leitura principal de uma delas. */
  const f04Servidor = ({ falhar = null, segurar = null } = {}) => (url) => {
    const p = url.pathname;
    if (segurar && p === segurar) return new Promise(() => {});
    if (falhar && p.startsWith(falhar)) return { status: 500, body: { ok: false, message: 'Falha simulada da F04.' } };
    if (p === '/api/board/tree/full') return { body: F04_ARVORE };
    if (p === `/api/board/lists/${F04_LISTA}`) return { body: { ok: true, board: F04_QUADRO } };
    if (p.startsWith('/api/board/folders/f4p')) return { body: { ok: true, board: F04_PASTA } };
    if (p === '/api/board/all-tasks') return { body: { ok: true, work: { rows: F04_LINHAS, total: 4, matched: 4, capped: false, assigneeOptions: [], unassignedTasks: 0 } } };
    if (p === '/api/board/my-tasks') {
      const aba = url.searchParams.get('aba') ?? 'pendente';
      const rows = aba === 'pendente' ? F04_LINHAS : [];
      return { body: { ok: true, work: { aba, rows, total: rows.length, capped: false, counts: { pendente: 4, feito: 0, delegado: 0 }, returned: rows.length, hasMore: false, nextCursor: null } } };
    }
    if (p === '/api/board/notices') return { body: { ok: true, notices: { notices: [], unread: 2 } } };
    if (p === '/api/board/notices/count') return { body: { ok: true, unread: 2 } };
    return null;
  };
  const F04_TELAS = [
    { id: 'minhas', rota: '/meu-trabalho', titulo: 'Minhas tarefas', leitura: '/api/board/my-tasks', aceso: '/meu-trabalho' },
    { id: 'todas', rota: '/tarefas', titulo: 'Todas as tarefas', leitura: '/api/board/all-tasks', aceso: '/tarefas' },
    { id: 'avisos', rota: '/avisos', titulo: 'Notificações', leitura: '/api/board/notices', aceso: '/avisos' },
    // F06A: carregados, o espaço, a pasta e o quadro têm o NOME do lugar como
    // título; o nome da forma (`Espaço`, `Pasta`, `Quadro`) fica para a espera.
    { id: 'espaco', rota: '/quadro/espaco/f4e', titulo: 'Espaço', carregado: 'Produção', leitura: '/api/board/tree/full', aceso: null },
    { id: 'pasta', rota: '/quadro/pasta/f4p', titulo: 'Pasta', carregado: 'Clientes', leitura: '/api/board/folders/f4p', aceso: null },
    { id: 'quadro', rota: `/quadro/${F04_LISTA}`, titulo: 'Quadro', carregado: 'Criação', leitura: `/api/board/lists/${F04_LISTA}`, aceso: null },
  ];
  const F04_PREF = JSON.stringify({ arvoreEmColuna: true, aparencia: 'icones-e-rotulos', versao: 2 });
  const f04Preferir = (context) => context.addInitScript((p) => {
    if (!sessionStorage.getItem('f04-semeado')) { localStorage.setItem('ideworks:barra', p); sessionStorage.setItem('f04-semeado', '1'); }
  }, F04_PREF);
  const F04_CAPTURAS = process.env.F04_CAPTURAS ?? '';
  /** A forma da tela, lida do DOM. */
  const f04Forma = (page) => page.evaluate(() => {
    const q = document.querySelector('.q-tela');
    const c = document.querySelector('.q-tela > .q-conteudo');
    const caixa = (el) => (el ? el.getBoundingClientRect() : null);
    const vis = (el) => { const r = caixa(el); return Boolean(r && r.width > 0 && r.height > 0); };
    const h1 = document.querySelector('h1');
    const coluna = document.querySelector('.q-tela > .bl-coluna');
    return {
      w: innerWidth, sw: document.documentElement.scrollWidth,
      grades: document.querySelectorAll('.q-tela').length, barras: document.querySelectorAll('#barra-lateral').length,
      contexto: q?.dataset.contexto, barra: q?.dataset.barra, colunaNaGrade: q?.dataset.coluna ?? null,
      conteudo: Math.round(caixa(c)?.width ?? 0), h1: h1?.textContent?.trim(), h1NaColuna: Boolean(c && h1 && c.contains(h1)),
      topoPrimeiro: c?.firstElementChild?.matches('header.o-topo') ?? false,
      coluna: vis(coluna), saidaDaColuna: Boolean(coluna?.querySelector('button[aria-label="Devolver a árvore para a barra"]')),
      gaveta: vis(document.querySelector('.bl-abrir')),
      barraVisivel: vis(document.querySelector('#barra-lateral')),
      acesos: [...document.querySelectorAll('#barra-lateral a[aria-current="page"]')].map((a) => a.getAttribute('href')),
      guardado: localStorage.getItem('ideworks:barra'),
    };
  });

  for (const largura of [1440, 1024, 390]) {
    for (const tema of ['claro', 'escuro']) {
      const viewport = { width: largura, height: largura === 390 ? 844 : largura === 1024 ? 768 : 900 };
      await cenario(`F04-forma-${largura}-${tema}`, 'as seis telas: mesma orientação, topo na coluna, árvore em coluna com saída e sem espremer', async (abrir) => {
        const { page, context, erros } = await abrir({ viewport, tema, custom: f04Servidor() });
        await f04Preferir(context);
        const medidas = [];
        for (const t of F04_TELAS) {
          await page.goto(BASE + t.rota);
          await page.locator('h1', { hasText: t.carregado ?? t.titulo }).waitFor();
          await page.waitForFunction(() => !document.querySelector('.iw-estado[data-tipo="carregando"], [aria-busy="true"]'), null, { timeout: 8000 }).catch(() => {});
          await pause(250);
          const m = await f04Forma(page);
          const ctx = `${t.id} ${largura} ${tema}: ${JSON.stringify(m)}`;
          assert.equal(m.grades, 1, ctx);
          assert.equal(m.barras, 1, ctx);
          assert.equal(m.contexto, 'trabalho', ctx);
          assert.ok(m.h1NaColuna && m.topoPrimeiro, `o topo é a primeira coisa da coluna — ${ctx}`);
          assert.ok(m.sw <= m.w + 1, `sem rolagem lateral — ${ctx}`);
          assert.equal(m.guardado, F04_PREF, `a preferência guardada não muda ao adaptar — ${ctx}`);
          if (t.aceso) assert.ok(m.acesos.includes(t.aceso), `o item certo aceso — ${ctx}`);
          else assert.ok(!m.acesos.some((h) => ['/meu-trabalho', '/tarefas', '/avisos'].includes(h)), `nenhum atalho aceso fora dele — ${ctx}`);
          if (largura === 390) {
            assert.ok(m.gaveta && !m.coluna, `celular: gaveta, sem coluna — ${ctx}`);
            assert.ok(m.conteudo >= 340, ctx);
          } else if (largura === 1024) {
            // A coluna CEDE (volta para dentro da barra) antes de espremer o conteúdo.
            assert.ok(!m.coluna && m.colunaNaGrade === null && m.conteudo >= 560, `1024: a coluna cede — ${ctx}`);
            assert.ok(await page.locator('#barra-lateral .cu-arvore').isVisible(), `a árvore voltou para a barra — ${ctx}`);
          } else {
            assert.ok(m.coluna && m.saidaDaColuna && m.colunaNaGrade === 'arvore', `1440: coluna com saída — ${ctx}`);
            assert.ok(m.conteudo >= 560, ctx);
          }
          medidas.push(`${t.id}=${m.conteudo}${m.coluna ? '+col' : ''}`);
          if (F04_CAPTURAS) await page.screenshot({ path: `${F04_CAPTURAS}/f04-${t.id}-${largura}-${tema}.png` });
        }
        assert.deepEqual(erros.filter((e) => !/chat\/live|WebSocket/i.test(e)), []);
        return medidas.join(' · ');
      });
    }
  }

  await cenario('F04-erro-na-coluna', 'o erro de leitura mora na coluna, abaixo do título, e a barra não desce', async (abrir) => {
    const saida = [];
    for (const t of F04_TELAS) {
      // `curado` deixa a leitura voltar depois do primeiro 500 (só Minhas tarefas usa).
      const estado = { curado: false };
      const falhando = f04Servidor({ falhar: t.leitura });
      const sadio = f04Servidor();
      const { page } = await abrir({ viewport: { width: 1440, height: 900 }, custom: (url) => (estado.curado ? sadio : falhando)(url) });
      await page.goto(BASE + t.rota);
      const alerta = page.locator('[role="alert"]').filter({ hasText: /Falha simulada|não foi possível|Não foi possível/i }).first();
      await alerta.waitFor({ timeout: 10000 });
      const m = await page.evaluate(() => {
        const a = [...document.querySelectorAll('[role="alert"]')].find((x) => x.textContent.trim() !== '');
        const c = document.querySelector('.q-tela > .q-conteudo');
        const h1 = c?.querySelector('h1');
        return {
          naColuna: Boolean(c && a && c.contains(a)),
          abaixoDoTitulo: Boolean(h1 && a && (h1.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)),
          foraDaGrade: [...document.querySelectorAll('main > .mb-3 [role="alert"]')].length,
          topoDaBarra: Math.round(document.querySelector('#barra-lateral').getBoundingClientRect().top),
          topoDaGrade: Math.round(document.querySelector('.q-tela').getBoundingClientRect().top),
        };
      });
      const ctx = `${t.id}: ${JSON.stringify(m)}`;
      assert.ok(m.naColuna && m.abaixoDoTitulo, ctx);
      assert.equal(m.foraDaGrade, 0, ctx);
      assert.ok(m.topoDaGrade <= 16, `a grade começa no alto — ${ctx}`);
      if (F04_CAPTURAS) await page.screenshot({ path: `${F04_CAPTURAS}/f04-erro-${t.id}-1440-claro.png` });
      if (t.id === 'minhas') {
        // Verificação F04: o 500 da primeira leitura oferece saída, e ela relê.
        const botao = page.locator('.q-conteudo').getByRole('button', { name: 'Tentar de novo', exact: true });
        await botao.waitFor({ timeout: 5000 });
        estado.curado = true;
        await botao.click();
        await page.getByRole('link', { name: 'Revisar carrossel', exact: true }).first().waitFor({ timeout: 5000 });
        assert.equal(await botao.count(), 0, 'depois de reler, o aviso sai');
      }
      saida.push(`${t.id} barra y=${m.topoDaBarra}`);
      await page.context().close();
    }
    return saida.join(' · ');
  });

  await cenario('F04-barra-durante-carga', 'com a leitura principal pendurada, a barra navega para outra tela', async (abrir) => {
    const saida = [];
    for (const t of F04_TELAS.filter((x) => x.id !== 'espaco')) {
      const { page } = await abrir({ viewport: { width: 1440, height: 900 }, custom: f04Servidor({ segurar: t.leitura }) });
      await page.goto(BASE + t.rota);
      // ⚠️ O TÍTULO DE ESPERA E O NOME DO LUGAR SÃO O MESMO `<h1>` EM DOIS MOMENTOS.
      // Com a leitura principal pendurada, a ÁRVORE — que o servidor fictício
      // responde na hora — já traz o nome da pasta, e `Pasta` vira `Clientes`
      // (`cabecalho` em `Pasta.tsx`). Esperar só o título de espera era uma corrida
      // contra essa resposta: passava quando o `<h1>` era conferido antes dela, e
      // falhava com a página servida mais rápido (rodada completa, 2 em 2). O que
      // o cenário prova é que a tela desenhou o topo e a barra navega, em qualquer dos dois.
      await page.locator('h1', { hasText: t.carregado ? new RegExp(`${t.titulo}|${t.carregado}`) : t.titulo }).waitFor();
      const destino = t.id === 'todas' ? '/meu-trabalho' : '/tarefas';
      await page.locator(`#barra-lateral a[href="${destino}"]`).first().click();
      await page.waitForURL((u) => u.pathname === destino, { timeout: 5000 });
      saida.push(`${t.id}→${destino}`);
      await page.context().close();
    }
    return saida.join(' · ');
  });

  /* ───────────── TRILHA: espaço e pasta levam às telas deles (28/09) ─────────────
     Relato do Wesley em produção: no quadro de `Jobs Antonelli`, clicar em
     `TIME HELENA` ou `AGÊNCIA IDE` na trilha "não atualiza e nem vai". O degrau
     só revelava o nó na árvore — recolhida no trilho (1440 em `Somente
     ícones`, em 1440 e 1024), revelar não mostrava nada. Agora a
     pasta leva a `/quadro/pasta/:id` (as tarefas dela juntas) e o espaço a
     `/quadro/espaco/:id`, do quadro da lista e da ficha da tarefa. */
  const TRILHA_TAREFA = { ...detail, id: row.id, listId: F04_LISTA, listName: 'Criação', folderId: 'f4p', folderName: 'Clientes', spaceId: 'f4e', spaceName: 'Produção' };
  const trilhaServidor = (url) =>
    url.pathname.startsWith('/api/board/tasks/')
      ? { body: { ok: true, task: TRILHA_TAREFA, storage: { ready: false, variable: '' } } }
      : f04Servidor()(url);
  const degrauDaTrilha = async (page, nome) => {
    const trilha = page.locator('header.o-topo .tr-trilha').first();
    await trilha.waitFor();
    const degrau = trilha.locator('.tr-degrau', { hasText: nome }).first();
    // Trilha apertada: o meio vira `…`, que devolve a trilha inteira.
    if (!(await degrau.isVisible().catch(() => false))) {
      const mais = trilha.locator('.tr-mais');
      if (await mais.count()) await mais.click();
    }
    await degrau.waitFor();
    return degrau;
  };
  for (const { largura, altura, aparencia } of [
    { largura: 1440, altura: 900, aparencia: 'icones' },
    { largura: 1024, altura: 768, aparencia: 'icones' },
  ]) {
    await cenario(`TRILHA-degraus-${largura}`, `${largura} com a árvore recolhida: pasta e espaço da trilha levam às telas deles, do quadro e da ficha`, async (abrir) => {
      const { page, context, erros } = await abrir({ viewport: { width: largura, height: altura }, custom: trilhaServidor });
      await context.addInitScript((p) => {
        if (!sessionStorage.getItem('trilha-semeado')) { localStorage.setItem('ideworks:barra', p); sessionStorage.setItem('trilha-semeado', '1'); }
      }, JSON.stringify({ arvoreEmColuna: false, aparencia, versao: 2 }));
      const saida = [];
      const irEConferir = async (origem, nome, caminho, prova) => {
        await page.goto(BASE + origem);
        const degrau = await degrauDaTrilha(page, nome);
        assert.equal(await degrau.evaluate((el) => el.tagName), 'A', `${origem} › ${nome} é link`);
        await degrau.click();
        await page.waitForURL((u) => u.pathname === caminho, { timeout: 5000 });
        await prova();
        saida.push(`${origem.split('/').slice(0, 3).join('/')} › ${nome} → ${caminho}`);
      };
      const cartoesDaPasta = async () => {
        await page.locator('h1', { hasText: 'Clientes' }).waitFor();
        await page.waitForFunction(() => document.querySelectorAll('.q-cartao').length > 0, null, { timeout: 8000 });
      };
      const visaoDoEspaco = () => page.locator('h1', { hasText: 'Produção' }).waitFor();

      await irEConferir(`/quadro/${F04_LISTA}`, 'Clientes', '/quadro/pasta/f4p', cartoesDaPasta);
      await page.goBack();
      await page.waitForURL((u) => u.pathname === `/quadro/${F04_LISTA}`, { timeout: 5000 });
      await irEConferir(`/quadro/${F04_LISTA}`, 'Produção', '/quadro/espaco/f4e', visaoDoEspaco);
      await irEConferir(`/tarefa/${row.id}`, 'Clientes', '/quadro/pasta/f4p', cartoesDaPasta);
      await irEConferir(`/tarefa/${row.id}`, 'Produção', '/quadro/espaco/f4e', visaoDoEspaco);
      // Da pasta, o espaço também leva.
      await irEConferir('/quadro/pasta/f4p', 'Produção', '/quadro/espaco/f4e', visaoDoEspaco);
      assert.deepEqual(erros.filter((e) => !/chat\/live|WebSocket/i.test(e)), []);
      return saida.join(' · ');
    });
  }

  /* ───────────── F02B do plano UX (revisão de 28/09, R08) ─────────────
     O menu e a coluna das listas recolhem cada um por si. Aqui se prova, no
     Chrome, pelas mesmas peças que a pessoa usa (botões e `Ctrl + .`): as
     quatro combinações, a grade sem faixa vazia, o foco que acompanha o botão
     que some, a recarga e a troca de rota, e que a adaptação por espaço não
     grava. A tela é o quadro (a árvore tem a lista acesa e a coluna rola). */
  const F02B_PREF = JSON.stringify({ arvoreEmColuna: true, aparencia: 'icones-e-rotulos', versao: 2 });
  const f02bPreferir = (context, pref = F02B_PREF) => context.addInitScript((p) => {
    if (!sessionStorage.getItem('f02b-semeado')) { localStorage.setItem('ideworks:barra', p); sessionStorage.setItem('f02b-semeado', '1'); }
  }, pref);
  const F02B_CAPTURAS = process.env.F02B_CAPTURAS ?? '';
  /** A forma da moldura: faixas da grade × o que ocupa cada uma. */
  const f02bForma = (page) => page.evaluate(() => {
    const q = document.querySelector('.q-tela');
    const caixa = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? Math.round(r.width) : null; };
    const faixas = getComputedStyle(q).gridTemplateColumns.split(' ').map((v) => Math.round(parseFloat(v)));
    const guardado = JSON.parse(localStorage.getItem('ideworks:barra') ?? '{}');
    return {
      barra: q.dataset.barra, coluna: q.dataset.coluna ?? null, adaptada: q.dataset.adaptada ?? null, faixas,
      menu: caixa('#barra-lateral'), listas: caixa('.q-tela > .bl-coluna'), conteudo: caixa('.q-tela > .q-conteudo'),
      sw: document.documentElement.scrollWidth, w: innerWidth,
      guardado: { aparencia: guardado.aparencia, listasRecolhidas: guardado.listasRecolhidas ?? false, arvoreEmColuna: guardado.arvoreEmColuna },
      foco: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 30) ?? null,
    };
  });
  /** Cada faixa da grade tem alguém dentro, e com a largura dela: sem faixa vazia. */
  const f02bSemFaixaVazia = (m, ctx) => {
    const ocupantes = [m.menu, m.listas, m.conteudo].filter((v) => v !== null);
    assert.equal(m.faixas.length, ocupantes.length, `faixas = peças à vista — ${ctx}`);
    m.faixas.forEach((f, i) => assert.ok(Math.abs(f - ocupantes[i]) <= 2, `faixa ${i} (${f}) = peça (${ocupantes[i]}) — ${ctx}`));
    assert.ok(m.sw <= m.w + 1, `sem rolagem lateral — ${ctx}`);
  };
  const f02bEsperada = {
    'aberto+abertas': { barra: 'icones-e-rotulos', coluna: 'arvore' },
    'compacto+abertas': { barra: 'icones', coluna: 'arvore' },
    'aberto+recolhidas': { barra: 'icones-e-rotulos', coluna: null },
    'compacto+recolhidas': { barra: 'icones', coluna: null },
  };
  const f02bConferir = async (page, nome, ctx, capturar) => {
    await pause(200);
    const m = await f02bForma(page);
    const c = `${nome} ${ctx}: ${JSON.stringify(m)}`;
    assert.equal(m.barra, f02bEsperada[nome].barra, c);
    assert.equal(m.coluna, f02bEsperada[nome].coluna, c);
    assert.equal(m.adaptada, null, `nada adaptado — ${c}`);
    assert.equal(m.guardado.aparencia, f02bEsperada[nome].barra, `menu guardado — ${c}`);
    assert.equal(m.guardado.listasRecolhidas, f02bEsperada[nome].coluna === null, `listas guardadas — ${c}`);
    assert.equal(m.guardado.arvoreEmColuna, true, `o encaixe não muda — ${c}`);
    f02bSemFaixaVazia(m, c);
    if (capturar && F02B_CAPTURAS) await page.screenshot({ path: `${F02B_CAPTURAS}/f02b-${capturar}-${nome.replace('+', '-')}.png` });
    return m;
  };

  for (const { largura, altura, tema } of [
    { largura: 1440, altura: 900, tema: 'claro' },
    { largura: 1440, altura: 900, tema: 'escuro' },
    { largura: 1280, altura: 800, tema: 'escuro' },
  ]) {
    await cenario(`F02B-quatro-${largura}-${tema}`, 'menu e listas recolhem cada um por si: botões, Ctrl+., foco, recarga e troca de rota', async (abrir) => {
      const { page, context, erros } = await abrir({ viewport: { width: largura, height: altura }, tema, custom: f04Servidor() });
      await f02bPreferir(context);
      const ctx = `${largura} ${tema}`;
      const cap = `${largura}-${tema}`;
      await page.goto(BASE + `/quadro/${F04_LISTA}`);
      await page.locator('h1', { hasText: 'Criação' }).waitFor();
      await page.locator('.bl-coluna .cu-arvore [data-no]').first().waitFor();
      await f02bConferir(page, 'aberto+abertas', ctx, cap);

      // 1. O « do menu recolhe SÓ o menu; a coluna fica.
      await page.getByRole('button', { name: 'Recolher a barra' }).click();
      await f02bConferir(page, 'compacto+abertas', ctx, cap);

      // 2. O « das listas recolhe SÓ as listas; o foco vai para o caminho de volta.
      await page.getByRole('button', { name: 'Recolher listas', exact: true }).click();
      let m = await f02bConferir(page, 'compacto+recolhidas', ctx, cap);
      assert.equal(m.foco, 'Compartilhado comigo — mostrar listas', `foco no ícone que reabre — ${JSON.stringify(m)}`);

      // 3. Ctrl + . expande só o menu; as listas seguem recolhidas, com a linha de reabrir.
      await page.keyboard.press('Control+.');
      await f02bConferir(page, 'aberto+recolhidas', ctx, cap);
      const linha = page.locator('#barra-lateral .bl-mostrar-listas');
      assert.ok(await linha.isVisible(), 'a linha "Compartilhado comigo" reabre as listas');

      // 4. Recarga e troca de rota mantêm as duas escolhas.
      await page.reload();
      await page.locator('h1', { hasText: 'Criação' }).waitFor();
      await f02bConferir(page, 'aberto+recolhidas', `${ctx} recarregado`);
      await page.goto(BASE + '/meu-trabalho');
      await page.locator('h1', { hasText: 'Minhas tarefas' }).waitFor();
      await f02bConferir(page, 'aberto+recolhidas', `${ctx} /meu-trabalho`);

      // 5. Pelo teclado: Tab até a linha e Enter reabre; o foco vai ao « da coluna.
      await linha.focus();
      await page.keyboard.press('Enter');
      m = await f02bConferir(page, 'aberto+abertas', `${ctx} teclado`);
      assert.equal(m.foco, 'Recolher listas', `foco no « da coluna — ${JSON.stringify(m)}`);
      // …e Enter nele recolhe de novo.
      await page.keyboard.press('Enter');
      await f02bConferir(page, 'aberto+recolhidas', `${ctx} teclado 2`);
      await page.keyboard.press('Control+.');
      await f02bConferir(page, 'compacto+recolhidas', `${ctx} teclado 3`);
      // No rail, o ícone da árvore reabre as listas, e o foco fica nele.
      await page.getByRole('button', { name: 'Compartilhado comigo — mostrar listas' }).focus();
      await page.keyboard.press('Enter');
      m = await f02bConferir(page, 'compacto+abertas', `${ctx} rail`);
      assert.equal(m.foco, 'Compartilhado comigo — recolher listas', `o foco fica no ícone do rail — ${JSON.stringify(m)}`);

      assert.deepEqual(erros.filter((e) => !/chat\/live|WebSocket/i.test(e)), []);
      return `4 combinações, ${ctx}`;
    });
  }

  await cenario('F02B-1024-adapta-sem-gravar', '1024: menu compacto + listas abertas cabe; menu aberto cede a coluna sem gravar', async (abrir) => {
    const { page, context, erros } = await abrir({ viewport: { width: 1024, height: 768 }, tema: 'escuro', custom: f04Servidor() });
    await f02bPreferir(context);
    await page.goto(BASE + `/quadro/${F04_LISTA}`);
    await page.locator('h1', { hasText: 'Criação' }).waitFor();
    await pause(300);
    let m = await f02bForma(page);
    // Menu aberto + listas abertas não cabe: a coluna volta para a barra, e o guardado não muda.
    assert.equal(m.coluna, null, JSON.stringify(m));
    assert.equal(m.adaptada, 'true', JSON.stringify(m));
    assert.deepEqual(m.guardado, { aparencia: 'icones-e-rotulos', listasRecolhidas: false, arvoreEmColuna: true }, JSON.stringify(m));
    assert.equal(await page.evaluate(() => localStorage.getItem('ideworks:barra')), F02B_PREF, 'adaptar não grava');
    assert.ok(await page.locator('#barra-lateral .cu-arvore').isVisible(), 'a árvore voltou para dentro da barra');
    f02bSemFaixaVazia(m, '1024 adaptada');
    // Recolher o menu: agora rail + coluna cabem (a quarta combinação a 1024).
    await page.getByRole('button', { name: 'Recolher a barra' }).click();
    m = await f02bConferir(page, 'compacto+abertas', '1024', '1024-escuro');
    assert.ok(m.conteudo >= 560, `conteúdo ≥ 560 — ${JSON.stringify(m)}`);
    await page.getByRole('button', { name: 'Recolher listas', exact: true }).click();
    await f02bConferir(page, 'compacto+recolhidas', '1024', '1024-escuro');
    assert.deepEqual(erros.filter((e) => !/chat\/live|WebSocket/i.test(e)), []);
    return `adaptada ${m.conteudo}px`;
  });

  await cenario('F02B-390-gaveta', '390: a gaveta traz a árvore dentro, sem os botões de coluna, e não grava', async (abrir) => {
    const pref = JSON.stringify({ arvoreEmColuna: true, aparencia: 'icones', listasRecolhidas: true, versao: 2 });
    const { page, context } = await abrir({ viewport: { width: 390, height: 844 }, tema: 'claro', custom: f04Servidor() });
    await f02bPreferir(context, pref);
    await page.goto(BASE + `/quadro/${F04_LISTA}`);
    await page.locator('h1', { hasText: 'Criação' }).waitFor();
    await page.getByRole('button', { name: 'Listas e atalhos' }).click();
    const gaveta = page.locator('#barra-lateral[data-gaveta="aberta"]');
    await gaveta.waitFor();
    await gaveta.locator('.cu-arvore [data-no]').first().waitFor();
    assert.equal(await gaveta.locator('.bl-recolher-listas, .bl-mostrar-listas').count(), 0, 'sem botões de coluna na gaveta');
    if (F02B_CAPTURAS) await page.screenshot({ path: `${F02B_CAPTURAS}/f02b-390-claro-gaveta.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => localStorage.getItem('ideworks:barra')), pref, 'a gaveta não grava');
    return 'árvore na gaveta';
  });

  await cenario('F02B-preserva-arvore-e-quadro', 'recolher o menu não remonta a árvore; recolher e reabrir as listas devolve seleção, grupos abertos e rolagem; o quadro fica', async (abrir) => {
    const { page, context } = await abrir({ viewport: { width: 1440, height: 500 }, tema: 'claro', custom: f04Servidor() });
    await f02bPreferir(context);
    await page.goto(BASE + `/quadro/${F04_LISTA}`);
    await page.locator('h1', { hasText: 'Criação' }).waitFor();
    const longa = '.q-colunas > .q-coluna:first-child .q-coluna-corpo';
    await page.waitForFunction((s) => (document.querySelector(s)?.querySelectorAll('.q-cartao').length ?? 0) >= 30, longa, { timeout: 8000 });
    await page.locator('.bl-coluna .cu-arvore [data-no]').first().waitFor();
    // A árvore da fixture cabe inteira; um corpo alto (regra de página, que
    // sobrevive à remontagem) a faz rolar como a de um espaço grande.
    await page.addStyleTag({ content: '.bl-coluna .cu-arvore-corpo { min-height: 1200px; }' });
    const antes = await page.evaluate((s) => {
      const arvore = document.querySelector('.bl-coluna .cu-arvore');
      // Quem rola é a própria `.cu-arvore` (`.q-barra.cu-arvore`, clickup.css).
      // Verificação F02B: a busca antiga pelo "primeiro que transborda" achava
      // um `.sr-only` (1px, clip) e media a rolagem dele, não a da árvore.
      const rola = arvore;
      rola.scrollTop = 300;
      window.__f02bArvore = arvore; window.__f02bRola = rola;
      const c = document.querySelector(s); c.scrollTop = 400; c.dispatchEvent(new Event('scroll')); window.__f02bCorpo = c;
      return {
        rolaTopo: Math.round(rola.scrollTop), abertos: arvore.querySelectorAll('[aria-expanded="true"]').length,
        acesa: arvore.querySelector('[data-atual="true"]')?.textContent?.trim() ?? null,
        transborda: rola.scrollHeight - rola.clientHeight,
      };
    }, longa);
    assert.ok(antes.acesa, `a lista do quadro está acesa na árvore — ${JSON.stringify(antes)}`);
    assert.ok(antes.transborda > 20 && antes.rolaTopo > 0, `a árvore transborda e rolou — ${JSON.stringify(antes)}`);
    const agora = () => page.evaluate((s) => {
      const arvore = document.querySelector('.bl-coluna .cu-arvore');
      return {
        mesma: window.__f02bArvore === arvore, rolaTopo: Math.round(window.__f02bRola.scrollTop),
        abertos: arvore?.querySelectorAll('[aria-expanded="true"]').length ?? -1,
        acesa: arvore?.querySelector('[data-atual="true"]')?.textContent?.trim() ?? null,
        quadro: Math.round(document.querySelector(s).scrollTop), mesmoQuadro: window.__f02bCorpo === document.querySelector(s),
      };
    }, longa);
    for (const passo of ['recolher', 'expandir']) {
      await page.keyboard.press('Control+.');
      await pause(250);
      const d = await agora();
      const c = `${passo}: antes ${JSON.stringify(antes)} depois ${JSON.stringify(d)}`;
      assert.ok(d.mesma, `a mesma árvore — ${c}`);
      assert.equal(d.rolaTopo, antes.rolaTopo, `rolagem da árvore — ${c}`);
      assert.equal(d.abertos, antes.abertos, `grupos abertos — ${c}`);
      assert.equal(d.acesa, antes.acesa, `lista acesa — ${c}`);
      assert.ok(d.mesmoQuadro && d.quadro >= 350, `rolagem do quadro — ${c}`);
    }
    // Verificação F02B (R08): RECOLHER E REABRIR AS LISTAS também devolve a
    // árvore como estava — rolagem, grupos abertos e lista acesa — e o quadro.
    const naColunaDeNovo = () => page.evaluate((s) => {
      const arvore = document.querySelector('.bl-coluna .cu-arvore');
      if (!arvore) return null;
      const rola = arvore;
      return {
        rolaTopo: Math.round(rola.scrollTop), abertos: arvore.querySelectorAll('[aria-expanded="true"]').length,
        acesa: arvore.querySelector('[data-atual="true"]')?.textContent?.trim() ?? null,
        quadro: Math.round(document.querySelector(s).scrollTop), mesmoQuadro: window.__f02bCorpo === document.querySelector(s),
      };
    }, longa);
    await page.locator('.bl-coluna .bl-recolher-listas').click();
    await page.locator('.bl-mostrar-listas').waitFor();
    await page.locator('.bl-mostrar-listas').click();
    await page.locator('.bl-coluna .cu-arvore [data-no]').first().waitFor();
    await pause(400);
    const l = await naColunaDeNovo();
    const cl = `listas: antes ${JSON.stringify(antes)} depois ${JSON.stringify(l)}`;
    assert.equal(l?.rolaTopo, antes.rolaTopo, `rolagem da árvore ao reabrir as listas — ${cl}`);
    assert.equal(l.abertos, antes.abertos, `grupos abertos ao reabrir as listas — ${cl}`);
    assert.equal(l.acesa, antes.acesa, `lista acesa ao reabrir as listas — ${cl}`);
    assert.ok(l.mesmoQuadro && l.quadro >= 350, `rolagem do quadro ao reabrir as listas — ${cl}`);
    return `árvore rolada ${antes.rolaTopo}px, ${antes.abertos} grupos abertos, acesa "${antes.acesa}"; menu e listas ida e volta`;
  });

  await cenario('F04-largura-sem-perder', 'mudar a largura não descarta busca digitada, rolagem do quadro nem a tarefa aberta', async (abrir) => {
    const { page, context } = await abrir({ viewport: { width: 1440, height: 900 }, custom: (url, req) => f04Servidor()(url) ?? fichaLonga(url, req) });
    await f04Preferir(context);
    const larguras = [{ width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }];

    // 1. Busca digitada em Minhas tarefas, e a MESMA coluna (sem remontar).
    await page.goto(BASE + '/meu-trabalho');
    const busca = page.getByRole('searchbox');
    await busca.fill('carrossel');
    await page.evaluate(() => { window.__f04Coluna = document.querySelector('.q-conteudo'); window.__f04Busca = document.querySelector('input[type="search"]'); });
    for (const v of larguras) {
      await page.setViewportSize(v);
      await pause(200);
      const m = await page.evaluate(() => ({
        valor: document.querySelector('input[type="search"]')?.value,
        mesmaColuna: window.__f04Coluna === document.querySelector('.q-conteudo'),
        mesmaBusca: window.__f04Busca === document.querySelector('input[type="search"]'),
        linhas: document.querySelectorAll('.mt-linha').length,
      }));
      assert.deepEqual({ ...m, linhas: m.linhas > 0 }, { valor: 'carrossel', mesmaColuna: true, mesmaBusca: true, linhas: true }, `${v.width}: ${JSON.stringify(m)}`);
    }

    // 2. Rolagem da coluna longa do quadro, e o MESMO elemento de rolagem.
    await page.goto(BASE + `/quadro/${F04_LISTA}`);
    const longa = '.q-colunas > .q-coluna:first-child .q-coluna-corpo';
    await page.waitForFunction((s) => (document.querySelector(s)?.querySelectorAll('.q-cartao').length ?? 0) >= 30, longa, { timeout: 8000 });
    await page.evaluate((s) => { const c = document.querySelector(s); c.scrollTop = 400; c.dispatchEvent(new Event('scroll')); window.__f04Corpo = c; }, longa);
    for (const v of larguras) {
      await page.setViewportSize(v);
      await pause(200);
      const m = await page.evaluate((s) => ({ topo: Math.round(document.querySelector(s).scrollTop), mesmo: window.__f04Corpo === document.querySelector(s), rolagem: document.querySelector(s).closest('[data-rolagem]')?.dataset.rolagem ?? document.querySelector(s).dataset.rolagem ?? null }), longa);
      assert.ok(m.mesmo && m.topo >= 350, `${v.width}: ${JSON.stringify(m)}`);
    }

    // 3. A tarefa aberta, com o título editado: nem o texto nem o editor somem.
    await page.goto(BASE + '/tarefa/' + row.id);
    const titulo = campoTitulo(page);
    await titulo.waitFor();
    await titulo.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' F04');
    const texto = await titulo.evaluate((el) => el.textContent);
    await page.evaluate(() => { window.__f04Editor = document.querySelector('[role="textbox"][aria-label="Descrição da tarefa"]'); });
    for (const v of larguras) {
      await page.setViewportSize(v);
      await pause(200);
      const m = await page.evaluate(() => ({
        titulo: document.querySelector('[role="textbox"][aria-label="Título da tarefa"]')?.textContent,
        mesmoEditor: window.__f04Editor === document.querySelector('[role="textbox"][aria-label="Descrição da tarefa"]'),
      }));
      assert.deepEqual(m, { titulo: texto, mesmoEditor: true }, `${v.width}: ${JSON.stringify(m)}`);
    }
    return `busca, rolagem (${longa}) e ficha intactas em ${larguras.map((v) => v.width).join('→')}`;
  });

  return resultados;
}
