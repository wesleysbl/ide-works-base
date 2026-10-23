/**
 * O CONTROLE DA SEMANA — F40, Fase 7.
 *
 * No Chrome, com a API interceptada e dados fictícios na FORMA real de
 * `GET /api/admin/semana` (`src/server/controle-da-semana.ts`) e de
 * `POST /api/admin/semana/liberar` (`src/server/liberar-demanda.ts`). O servidor
 * simulado GUARDA ESTADO: o card liberado sai de "Para atribuir" na releitura e
 * soma no "Por fazer" do Andamento — é isso que prova que a tela reage ao que o
 * servidor devolveu, e não a um desenho fixo.
 *
 * O RELÓGIO É FIXO: quarta, 07/10/2026. A semana atual é 05–11/out; a anterior
 * começa em 28/09 e a próxima em 12/10.
 *
 *   CS1  admin: o item "Controle da semana" está na barra; clicar abre a aba, com
 *        a semana "05 – 11/out" e os três blocos
 *   CS2  ‹ › navegam (endereço ?semana=…), mostram os cards da outra semana, e
 *        "Esta semana" volta
 *   CS3  liberar: pessoa + prazo sugerido + OK → POST certo, a linha sai e o
 *        Andamento soma
 *   CS4  card sem tipo: OK desabilitado até escolher o tipo ali mesmo; depois
 *        grava o tipo (PATCH) e libera (POST)
 *   CS5  a recusa do servidor vira frase na linha, e a linha fica
 *   CS6  abrir o grupo do cliente e clicar em "Abrir no quadro" abre a lista dele no quadro
 *   CS8  F41: a faixa mostra os cinco números das fixtures (e o Para atribuir cai ao liberar)
 *   CS9  F41: todos os grupos nascem recolhidos; clicar abre/fecha
 *   CS10 F41: "Expandir tudo" abre todos, a escolha persiste ao recarregar (por pessoa),
 *        e "Recolher tudo" fecha todos
 *   CS11 F41 Fase 2: o bloco "Para atribuir" vem antes de "Clientes" no DOM, agrupado por
 *        cliente, e liberar nele não mexe nos grupos recolhidos
 *   CS12 F41 Fase 2: com a semana vazia de cards, o bloco diz "Nada para atribuir nesta semana"
 *   CS7  funcionário: o item não aparece na barra, e a rota direta diz "sem
 *        acesso" sem pedir a semana
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, sessaoDe } from './comum.mjs';

const AGORA = new Date('2026-10-07T15:00:00Z'); // 07/10/2026 12:00 em Brasília

const CLIENTE = { id: 'c-saae', name: 'Saae Itaverde' };
const LISTA = { id: 'l-saae', name: 'Demandas' };

/**
 * Outros clientes da semana, FIXOS (nenhum cenário os libera): dão ao desenho
 * vários grupos — dois em dia, dois com falta (um com card para atribuir) e um
 * atrasado. O cliente do cenário (Saae) continua sendo o único que muda.
 */
const EXTRAS = {
  atrasado: { id: 'c-zeni', name: 'Auto Peças Zeni' },
  falta: { id: 'c-vita', name: 'Clínica Vita' },
  emDia: { id: 'c-bom', name: 'Padaria Bom Pão' },
  emDia2: { id: 'c-lume', name: 'Lume Arquitetura' },
  falta2: { id: 'c-ipe', name: 'Ipê Odontologia' },
};

const PESSOAS = [
  { id: 'u-ana', name: 'Ana Responsável' },
  { id: 'u-bia', name: 'Bia Designer' },
];

/** Semanas que o servidor simulado sabe responder (a segunda → o que a rodeia). */
const SEMANAS = {
  '2026-09-28': { end: '2026-10-04', previous: '2026-09-21', next: '2026-10-05' },
  '2026-10-05': { end: '2026-10-11', previous: '2026-09-28', next: '2026-10-12' },
  '2026-10-12': { end: '2026-10-18', previous: '2026-10-05', next: '2026-10-19' },
};
const HOJE = '2026-10-07';
const ATUAL = '2026-10-05';

const card = (id, title, semana, type, due) => ({
  id, title, semana, type, due, liberado: false,
});

/** O estado do servidor: o banco inteiro do cenário. */
export function estadoDoControle() {
  return {
    cards: [
      card('t-video', 'Reels da obra', ATUAL, 'video', '2026-10-09'),
      card('t-sem-tipo', 'Card antigo sem tipo', ATUAL, null, null),
      card('t-proxima', 'Post da semana que vem', '2026-10-12', 'arte', '2026-10-14'),
    ],
    leituras: [],
    liberacoes: [],
    patches: [],
    /** Se preenchido, a próxima liberação é recusada com esta frase. */
    recusar: null,
  };
}

/** `GET /admin/semana` na forma real, calculado do estado. */
function leitura(estado, segunda) {
  const info = SEMANAS[segunda];
  const daSemana = estado.cards.filter((c) => c.semana === segunda);
  const grupos = new Map();
  for (const c of daSemana.filter((x) => !x.liberado)) {
    const chave = c.type ?? 'sem';
    if (!grupos.has(chave)) grupos.set(chave, { clientId: CLIENTE.id, clientName: CLIENTE.name, type: c.type, cards: [] });
    grupos.get(chave).cards.push({
      id: c.id, title: c.title, createdBy: { id: 'u-cap', name: 'Cátia Captadora' }, suggestedDueOn: c.due, list: LISTA,
    });
  }
  const contar = (tipo, fn) => estado.cards.filter((c) => c.type === tipo && fn(c)).length;
  const progress = [
    {
      clientId: CLIENTE.id, clientName: CLIENTE.name, type: 'video',
      awaiting: contar('video', (c) => !c.liberado), todo: contar('video', (c) => c.liberado), doing: 0, done: 2,
    },
    {
      clientId: CLIENTE.id, clientName: CLIENTE.name, type: 'arte',
      awaiting: contar('arte', (c) => !c.liberado), todo: contar('arte', (c) => c.liberado), doing: 0, done: 0,
    },
  ];
  const linhaExtra = (c, type, awaiting, todo, doing, done) => ({ clientId: c.id, clientName: c.name, type, awaiting, todo, doing, done });
  const metaExtra = (c, type, target, cards) => ({ clientId: c.id, clientName: c.name, type, target, cards, missing: Math.max(0, target - cards) });
  progress.push(
    linhaExtra(EXTRAS.atrasado, 'video', 0, 1, 1, 0), linhaExtra(EXTRAS.atrasado, 'arte', 0, 1, 0, 1),
    linhaExtra(EXTRAS.falta, 'video', 1, 0, 0, 1), linhaExtra(EXTRAS.falta, 'foto', 0, 0, 0, 0),
    linhaExtra(EXTRAS.emDia, 'video', 0, 0, 1, 2), linhaExtra(EXTRAS.emDia, 'arte', 0, 0, 0, 2),
    linhaExtra(EXTRAS.emDia2, 'video', 0, 1, 0, 2), linhaExtra(EXTRAS.falta2, 'arte', 0, 0, 0, 0),
  );
  if (segunda === ATUAL) {
    grupos.set('extra-vita', {
      clientId: EXTRAS.falta.id, clientName: EXTRAS.falta.name, type: 'video',
      cards: [{ id: 't-vita', title: 'Reels da inauguração', createdBy: { id: 'u-cap', name: 'Cátia Captadora' }, suggestedDueOn: '2026-10-10', list: LISTA }],
    });
  }
  const itensExtras = [
    metaExtra(EXTRAS.atrasado, 'video', 2, 2), metaExtra(EXTRAS.atrasado, 'arte', 2, 2),
    metaExtra(EXTRAS.falta, 'video', 2, 1), metaExtra(EXTRAS.falta, 'foto', 2, 0),
    metaExtra(EXTRAS.emDia, 'video', 3, 3), metaExtra(EXTRAS.emDia, 'arte', 2, 2),
    metaExtra(EXTRAS.emDia2, 'video', 3, 3),
    metaExtra(EXTRAS.falta2, 'arte', 4, 1),
  ];
  return {
    ok: true,
    week: { start: segunda, end: info.end, today: HOJE, isCurrent: segunda === ATUAL, previous: info.previous, next: info.next },
    toAssign: [...grupos.values()],
    progress,
    missing: {
      items: [...itensExtras, { clientId: CLIENTE.id, clientName: CLIENTE.name, type: 'video', target: 2, cards: daSemana.filter((c) => c.type === 'video').length, missing: Math.max(0, 2 - daSemana.filter((c) => c.type === 'video').length) }],
      overdue: [
        { id: 't-zeni-1', title: 'Banner da liquidação', dueOn: '2026-09-30', clientId: EXTRAS.atrasado.id, clientName: EXTRAS.atrasado.name, type: 'video', list: LISTA, statusName: 'em andamento', assignees: [PESSOAS[0]] },
        { id: 't-zeni-2', title: 'Vídeo institucional', dueOn: '2026-10-02', clientId: EXTRAS.atrasado.id, clientName: EXTRAS.atrasado.name, type: 'video', list: LISTA, statusName: 'a fazer', assignees: [] },
        { id: 't-atraso', title: 'Arte parada', dueOn: '2026-10-01', clientId: CLIENTE.id, clientName: CLIENTE.name, type: 'arte', list: LISTA, statusName: 'a fazer arte', assignees: [PESSOAS[1]] },
      ],
      overdueTotal: 3,
    },
  };
}

/** O handler da API simulada. Devolve `null` para o que não é desta tela. */
export function rotasDoControle(estado = estadoDoControle()) {
  const handler = (url, req) => {
    const p = url.pathname;
    const m = req.method();
    if (p === '/api/admin/semana' && m === 'GET') {
      const pedida = url.searchParams.get('semana') ?? ATUAL;
      estado.leituras.push(pedida);
      return { body: leitura(estado, pedida) };
    }
    if (p === '/api/admin/semana/liberar' && m === 'POST') {
      const corpo = req.postDataJSON();
      estado.liberacoes.push(corpo);
      if (estado.recusar) return { status: 409, body: { message: estado.recusar, code: 'already_released' } };
      const c = estado.cards.find((x) => x.id === corpo.taskId);
      if (c) c.liberado = true;
      return { body: { ok: true, release: { taskId: corpo.taskId } } };
    }
    const tarefa = /^\/api\/board\/tasks\/([^/]+)$/.exec(p);
    if (tarefa && m === 'PATCH') {
      const corpo = req.postDataJSON() ?? {};
      estado.patches.push({ id: tarefa[1], corpo });
      const c = estado.cards.find((x) => x.id === tarefa[1]);
      if (c && corpo.type) c.type = corpo.type;
      return null; // a resposta padrão da ficha serve
    }
    if (p === `/api/clients/${CLIENTE.id}/board-lists`)
      return { body: { ok: true, lists: [{ id: LISTA.id, name: LISTA.name, archived: false, space: { id: 'e1', name: 'AGÊNCIA IDE' }, folder: null, liveTasks: 3, totalTasks: 5 }] } };
    return null;
  };
  return { handler, estado };
}

const errosReais = (erros) => erros.filter((e) => !/chat\/live|WebSocket|Failed to load resource/i.test(e));

const SESSAO_FUNCIONARIO = {
  ...sessaoDe('u-func'),
  isSuperadmin: false,
  isSuper: false,
  papel: 'funcionario',
  areas: ['quadro', 'entrega', 'pessoas'],
};

async function abrir(abrirContexto, { rota = '/controle-da-semana', funcionario = false, atribuirFechado = false, ...opcoes } = {}) {
  const { handler, estado } = rotasDoControle();
  const custom = (url, req) => {
    // O diretório mora aqui, e não no handler: ele é compartilhado com as outras suítes (UX).
    if (url.pathname === '/api/team') return { body: { ok: true, team: PESSOAS, me: 'u-ana' } };
    if (funcionario && url.pathname === '/api/auth/me') return { body: SESSAO_FUNCIONARIO };
    if (funcionario && url.pathname.startsWith('/api/admin/semana'))
      return { status: 403, body: { message: 'O painel de controle da semana é só para administradores.' } };
    return handler(url, req);
  };
  const s = await abrirContexto({ custom, ...opcoes });
  await s.page.clock.setFixedTime(AGORA);
  await s.page.goto(BASE + rota);
  // O bloco "Para atribuir" nasce recolhido; os cenários que mexem nos cards abrem antes.
  if (rota === '/controle-da-semana' && !funcionario && !atribuirFechado) {
    const alternar = s.page.locator('[data-bloco="para-atribuir"] .cs-bloco-titulo .cs-bloco-botao');
    await alternar.waitFor();
    await alternar.click();
    // Cada cliente também nasce recolhido: abre todos para chegar nos cards.
    const botoes = s.page.locator('[data-bloco="para-atribuir"] .cs-cliente-botao');
    for (let i = (await botoes.count()) - 1; i >= 0; i--) await botoes.nth(i).click();
  }
  return { ...s, estado };
}

const linhaDoCard = (page, id) => page.locator(`.cs-card[data-card="${id}"]`);

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('CS1', 'admin: o item está na barra, a aba abre na semana atual com a faixa e um grupo por cliente', async (abrirContexto) => {
    const { page, erros, estado } = await abrir(abrirContexto, { rota: '/meu-trabalho' });
    const item = page.getByRole('link', { name: 'Controle da semana', exact: true });
    await item.waitFor();
    await item.click();
    await page.waitForFunction(() => location.pathname === '/controle-da-semana');
    await page.getByRole('heading', { name: 'Controle da semana', level: 1 }).waitFor();
    await page.waitForFunction(() => document.querySelector('.cs-semana-nome')?.textContent.trim() === '05 – 11/out');
    await page.getByRole('heading', { name: /^Clientes/, level: 2 }).waitFor();
    await page.getByRole('heading', { name: /^Para atribuir/, level: 2 }).waitFor();
    await page.locator('[data-bloco="faixa"]').waitFor();
    // Um grupo por cliente: dois atrasados (Zeni, Saae), dois em falta, dois em dia — nessa ordem.
    const ordem = await page.locator('.cs-grupo').evaluateAll((els) => els.map((e) => `${e.dataset.cliente}:${e.dataset.estado}`));
    assert.deepEqual(ordem, ['c-zeni:atrasado', 'c-saae:atrasado', 'c-vita:falta', 'c-ipe:falta', 'c-lume:em-dia', 'c-bom:em-dia']);
    // Para atribuir: os dois cards do Saae, no bloco próprio (e não dentro do grupo).
    assert.equal(await page.locator('[data-bloco="para-atribuir"] [data-cliente="c-saae"] .cs-card').count(), 2);
    assert.equal(await page.locator('.cs-grupo .cs-card').count(), 0, 'os grupos não carregam cards para atribuir');
    // Recolhido por padrão: os cards não aparecem até clicar no título.
    const alternarAtribuir = page.locator('[data-bloco="para-atribuir"] .cs-bloco-titulo .cs-bloco-botao');
    assert.equal(await alternarAtribuir.getAttribute('aria-expanded'), 'false');
    assert.equal(await linhaDoCard(page, 't-video').isVisible(), false, 'recolhido: o card não aparece');
    await alternarAtribuir.click();
    assert.equal(await alternarAtribuir.getAttribute('aria-expanded'), 'true');
    // Aberto o bloco, o cliente ainda está recolhido: só o nome e a contagem.
    const botaoSaae = page.locator('[data-bloco="para-atribuir"] [data-cliente="c-saae"] .cs-cliente-botao');
    assert.equal(await botaoSaae.getAttribute('aria-expanded'), 'false');
    assert.equal(await linhaDoCard(page, 't-video').isVisible(), false, 'cliente recolhido: o card não aparece');
    await botaoSaae.click();
    assert.equal(await botaoSaae.getAttribute('aria-expanded'), 'true');
    assert.ok(await linhaDoCard(page, 't-video').getByText('Sugerido: 09/10').isVisible());
    // Todos os grupos nascem recolhidos; abre o do Saae para ver o andamento.
    assert.deepEqual([...new Set(await page.locator('.cs-grupo-botao').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-expanded'))))], ['false']);
    await page.locator('.cs-grupo[data-cliente="c-saae"] .cs-grupo-botao').click();
    await page.getByRole('button', { name: 'Expandir tudo', exact: true }).click();
    // Andamento: as quatro etapas por tipo.
    const andamento = page.locator('.cs-grupo[data-cliente="c-saae"] .cs-andamento li[data-tipo="video"]');
    for (const e of ['Aguardando', 'Por fazer', 'Em andamento', 'Feito']) assert.ok(await andamento.getByText(e).isVisible(), e);
    // As barras do cabeçalho: Vídeo 1/2.
    assert.equal(
      (await page.locator('.cs-grupo[data-cliente="c-saae"] .cs-barra[data-tipo="video"] .cs-barra-num').textContent()).trim(),
      '1/2',
    );
    // Atrasado com o responsável.
    assert.ok(await page.locator('[data-atrasado="t-atraso"]').getByText('Bia Designer').isVisible());
    assert.ok(estado.leituras.length >= 1 && estado.leituras.every((l) => l === '2026-10-05'), `leituras: ${estado.leituras}`);
    assert.deepEqual(errosReais(erros), []);
    return 'barra → /controle-da-semana; 05 – 11/out; faixa + Para atribuir + 6 grupos ordenados (recolhidos)';
  });

  await cenario('CS2', '‹ › trocam de semana (com ?semana= no endereço) e "Esta semana" volta', async (abrirContexto) => {
    const { page, erros } = await abrir(abrirContexto);
    await page.waitForFunction(() => document.querySelector('.cs-semana-nome')?.textContent.trim() === '05 – 11/out');
    const esta = page.getByRole('button', { name: 'Esta semana', exact: true });
    assert.equal(await esta.isDisabled(), true, 'na semana atual o botão não tem o que fazer');

    await page.getByRole('button', { name: 'Próxima semana', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-semana-nome')?.textContent.trim() === '12 – 18/out');
    assert.equal(new URL(page.url()).searchParams.get('semana'), '2026-10-12');
    await linhaDoCard(page, 't-proxima').waitFor();
    assert.equal(await linhaDoCard(page, 't-video').count(), 0, 'os cards da semana atual não ficam na seguinte');
    assert.equal(await esta.isDisabled(), false);

    await page.getByRole('button', { name: 'Semana anterior', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-semana-nome')?.textContent.trim() === '05 – 11/out');
    await linhaDoCard(page, 't-video').waitFor();
    assert.equal(await linhaDoCard(page, 't-proxima').count(), 0, 'e o da seguinte sai ao voltar');

    await page.getByRole('button', { name: 'Próxima semana', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-semana-nome')?.textContent.trim() === '12 – 18/out');
    await esta.click();
    await page.waitForFunction(() => document.querySelector('.cs-semana-nome')?.textContent.trim() === '05 – 11/out');
    assert.equal(new URL(page.url()).searchParams.get('semana'), null, 'Esta semana tira o parâmetro');
    assert.deepEqual(errosReais(erros), []);
    return '05 → 12 → 05 → 12 → esta semana (05)';
  });

  await cenario('CS3', 'liberar: pessoa + prazo sugerido + OK → POST certo, a linha sai e o Andamento soma', async (abrirContexto) => {
    const { page, erros, estado } = await abrir(abrirContexto);
    const linha = linhaDoCard(page, 't-video');
    await linha.waitFor();
    const ok = linha.getByRole('button', { name: /^OK, liberar/ });
    assert.equal(await ok.isDisabled(), true, 'sem pessoa, o OK espera');
    assert.equal(await linha.getByLabel('Prazo de Reels da obra').inputValue(), '2026-10-09', 'o prazo sugerido já vem preenchido');
    await page.getByRole('button', { name: 'Expandir tudo', exact: true }).click();
    const linhaVideo = page.locator('.cs-grupo[data-cliente="c-saae"] .cs-andamento li[data-tipo="video"] [data-coluna="por-fazer"]');
    assert.equal((await linhaVideo.textContent()).trim(), '0');

    await linha.getByLabel('Pessoa para Reels da obra').selectOption('u-bia');
    assert.equal(await ok.isDisabled(), false);
    await ok.click();
    await linha.waitFor({ state: 'detached' });
    assert.deepEqual(estado.liberacoes, [{ taskId: 't-video', assigneeIds: ['u-bia'], dueOn: '2026-10-09' }]);
    await page.waitForFunction(
      () => document.querySelector('.cs-grupo[data-cliente="c-saae"] .cs-andamento li[data-tipo="video"] [data-coluna="por-fazer"]')?.textContent.trim() === '1',
    );
    assert.equal(await page.locator('[data-bloco="para-atribuir"] [data-cliente="c-saae"] .cs-card').count(), 1, 'sobrou só o card sem tipo');
    assert.deepEqual(errosReais(erros), []);
    await page.waitForFunction(() => document.querySelector('[data-numero="paraAtribuir"] .cs-cartao-valor')?.textContent.trim() === '2');
    return 'POST {t-video, [u-bia], 2026-10-09}; Por fazer 0 → 1; faixa Para atribuir 3 → 2';
  });

  await cenario('CS4', 'card sem tipo: o OK espera o tipo; escolhido, grava o tipo (PATCH) e libera (POST)', async (abrirContexto) => {
    const { page, erros, estado } = await abrir(abrirContexto);
    const linha = linhaDoCard(page, 't-sem-tipo');
    await linha.waitFor();
    const ok = linha.getByRole('button', { name: /^OK, liberar/ });
    await linha.getByLabel('Pessoa para Card antigo sem tipo').selectOption('u-ana');
    await linha.getByLabel('Prazo de Card antigo sem tipo').fill('2026-10-10');
    assert.equal(await ok.isDisabled(), true, 'pessoa e prazo não bastam: falta o tipo');
    assert.equal(await ok.getAttribute('title'), 'Escolha o tipo: Vídeo, Arte, Foto ou Outros');
    await linha.getByLabel('Tipo de Card antigo sem tipo').selectOption('arte');
    assert.equal(await ok.isDisabled(), false);
    await ok.click();
    await linha.waitFor({ state: 'detached' });
    assert.deepEqual(estado.patches, [{ id: 't-sem-tipo', corpo: { type: 'arte' } }]);
    assert.deepEqual(estado.liberacoes, [{ taskId: 't-sem-tipo', assigneeIds: ['u-ana'], dueOn: '2026-10-10' }]);
    assert.deepEqual(errosReais(erros), []);
    return 'PATCH {type: arte} → POST {u-ana, 2026-10-10}';
  });

  await cenario('CS5', 'a recusa do servidor vira frase na linha, e a linha fica', async (abrirContexto) => {
    const { page, erros, estado } = await abrir(abrirContexto);
    estado.recusar = 'Esse card já foi liberado por Ana Responsável.';
    const linha = linhaDoCard(page, 't-video');
    await linha.waitFor();
    await linha.getByLabel('Pessoa para Reels da obra').selectOption('u-ana');
    await linha.getByRole('button', { name: /^OK, liberar/ }).click();
    const alerta = linha.getByRole('alert');
    await alerta.waitFor();
    assert.equal((await alerta.textContent()).trim(), 'Esse card já foi liberado por Ana Responsável.');
    assert.equal(await linha.count(), 1, 'a linha não sai quando o servidor recusa');
    assert.equal(await linha.getByRole('button', { name: /^OK, liberar/ }).isDisabled(), false, 'dá para tentar de novo');
    assert.deepEqual(errosReais(erros), []);
    return 'frase do servidor na linha';
  });

  await cenario('CS6', 'clicar no cliente do Andamento abre a lista dele no quadro', async (abrirContexto) => {
    const { page, erros } = await abrir(abrirContexto);
    await page.locator('.cs-grupo[data-cliente="c-saae"] .cs-grupo-botao').click(); // nasce recolhido
    const botao = page.getByRole('button', { name: 'Abrir a lista de Saae Itaverde no quadro' }).first();
    await botao.waitFor();
    await botao.click();
    await page.waitForFunction((id) => location.pathname === `/quadro/${id}`, LISTA.id);
    assert.deepEqual(errosReais(erros), []);
    return `→ /quadro/${LISTA.id}`;
  });

  const numerosDaFaixa = (page) =>
    page.locator('[data-bloco="faixa"] .cs-cartao').evaluateAll((els) =>
      Object.fromEntries(els.map((e) => [e.dataset.numero, Number(e.querySelector('.cs-cartao-valor').textContent)])),
    );
  const grupo = (page, id) => page.locator(`.cs-grupo[data-cliente="${id}"]`);
  const botaoDoGrupo = (page, id) => grupo(page, id).locator('.cs-grupo-botao');
  const abertos = (page) => page.locator('.cs-grupo-botao').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-expanded')));

  await cenario('CS8', 'F41: a faixa mostra os cinco números das fixtures, com rótulo e estado em texto', async (abrirContexto) => {
    const { page, erros } = await abrir(abrirContexto);
    await page.locator('[data-bloco="faixa"]').waitFor();
    assert.deepEqual(await numerosDaFaixa(page), { paraAtribuir: 3, emAndamento: 2, feitos: 10, clientesEmFalta: 3, atrasados: 3 });
    const atrasados = page.locator('[data-numero="atrasados"]');
    assert.ok(await atrasados.getByText('Atrasados', { exact: true }).isVisible(), 'rótulo');
    assert.ok(await atrasados.getByText('vencidos', { exact: true }).isVisible(), 'estado em palavras');
    assert.equal(await atrasados.getAttribute('data-tom'), 'err');
    assert.equal(await page.locator('[data-numero="paraAtribuir"]').getAttribute('data-tom'), 'warn');
    assert.deepEqual(errosReais(erros), []);
    return '3 · 2 · 10 · 3 · 3';
  });

  await cenario('CS9', 'F41: todos os grupos nascem recolhidos (até falta e atraso); clicar abre e fecha', async (abrirContexto) => {
    const { page, erros } = await abrir(abrirContexto);
    await grupo(page, 'c-saae').waitFor();
    assert.deepEqual([...new Set(await abertos(page))], ['false'], 'tudo recolhido por padrão');
    const corpoBom = page.locator('#cs-corpo-c-bom');
    assert.equal(await botaoDoGrupo(page, 'c-bom').getAttribute('aria-controls'), 'cs-corpo-c-bom');
    assert.equal(await corpoBom.isVisible(), false);
    // O cabeçalho continua dizendo o que pede atenção, sem abrir.
    assert.ok(await grupo(page, 'c-saae').getByText('2 p/ atribuir').isVisible());
    assert.ok(await grupo(page, 'c-zeni').getByText('2 atrasados').isVisible());

    await botaoDoGrupo(page, 'c-bom').click();
    assert.equal(await botaoDoGrupo(page, 'c-bom').getAttribute('aria-expanded'), 'true');
    assert.equal(await corpoBom.isVisible(), true);
    await botaoDoGrupo(page, 'c-bom').click();
    assert.equal(await corpoBom.isVisible(), false);

    const atraso = page.locator('[data-atrasado="t-zeni-1"]');
    assert.equal(await atraso.isVisible(), false, 'recolhido, o atrasado some da vista');
    await botaoDoGrupo(page, 'c-zeni').click();
    assert.equal(await atraso.isVisible(), true);
    await botaoDoGrupo(page, 'c-zeni').click();
    assert.equal(await atraso.isVisible(), false);
    assert.deepEqual(errosReais(erros), []);
    return 'tudo recolhido → Bom Pão abre/fecha; Zeni abre/fecha';
  });

  await cenario('CS10', 'F41: "Expandir tudo" abre todos e persiste ao recarregar (por pessoa); "Recolher tudo" fecha todos', async (abrirContexto) => {
    const { page, erros } = await abrir(abrirContexto);
    await grupo(page, 'c-saae').waitFor();
    await page.getByRole('button', { name: 'Expandir tudo', exact: true }).click();
    assert.deepEqual([...new Set(await abertos(page))], ['true']);
    const chave = await page.evaluate(() => Object.keys(localStorage).find((k) => k.includes('controle-da-semana')));
    assert.ok(chave?.includes('u-ana'), `a chave é por pessoa: ${chave}`);
    assert.ok(chave?.includes(':v2:'), `a chave é a versão 2: ${chave}`);

    await page.reload();
    await grupo(page, 'c-saae').waitFor();
    assert.deepEqual([...new Set(await abertos(page))], ['true'], 'a escolha sobrevive ao recarregar');

    await page.getByRole('button', { name: 'Recolher tudo', exact: true }).click();
    assert.deepEqual([...new Set(await abertos(page))], ['false']);
    await page.reload();
    await grupo(page, 'c-saae').waitFor();
    assert.deepEqual([...new Set(await abertos(page))], ['false'], 'e a de recolher também');
    assert.deepEqual(errosReais(erros), []);
    return 'expandir → recarregar (tudo aberto) → recolher → recarregar (tudo fechado)';
  });

  await cenario('CS11', 'F41 Fase 2: o bloco Para atribuir vem antes de Clientes; liberar nele não mexe nos grupos', async (abrirContexto) => {
    const { page, erros, estado } = await abrir(abrirContexto);
    await grupo(page, 'c-saae').waitFor();
    // Ordem no DOM: faixa → Para atribuir → Clientes.
    const ordem = await page.locator('[data-bloco]').evaluateAll((els) => els.map((e) => e.dataset.bloco));
    assert.deepEqual(ordem, ['faixa', 'para-atribuir', 'clientes']);
    // Subtítulos por cliente, na ordem de urgência da lista (Saae atrasado, Vita falta).
    const clientes = await page.locator('[data-bloco="para-atribuir"] .cs-atribuir-cliente').evaluateAll((els) => els.map((e) => e.dataset.cliente));
    assert.deepEqual(clientes, ['c-saae', 'c-vita']);
    assert.equal(await page.getByRole('heading', { name: /^Para atribuir/, level: 2 }).locator('.cs-bloco-contagem').textContent(), '3');
    // O bloco está sempre à vista, com os grupos recolhidos.
    const linha = linhaDoCard(page, 't-video');
    assert.equal(await linha.isVisible(), true);
    assert.deepEqual([...new Set(await abertos(page))], ['false']);

    await linha.getByLabel('Pessoa para Reels da obra').selectOption('u-bia');
    await linha.getByRole('button', { name: /^OK, liberar/ }).click();
    await linha.waitFor({ state: 'detached' });
    assert.deepEqual(estado.liberacoes, [{ taskId: 't-video', assigneeIds: ['u-bia'], dueOn: '2026-10-09' }]);
    assert.deepEqual([...new Set(await abertos(page))], ['false'], 'a releitura não abre os grupos');
    assert.equal(await page.getByRole('heading', { name: /^Para atribuir/, level: 2 }).locator('.cs-bloco-contagem').textContent(), '2');
    assert.deepEqual(errosReais(erros), []);
    return 'faixa → Para atribuir → Clientes; OK no bloco; grupos seguem recolhidos';
  });

  await cenario('CS12', 'F41 Fase 2: sem nada a atribuir, o bloco diz "Nada para atribuir nesta semana"', async (abrirContexto) => {
    const { page, erros } = await abrir(abrirContexto);
    await page.getByRole('button', { name: 'Semana anterior', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-semana-nome')?.textContent.trim() === '28/set – 04/out');
    await page.locator('[data-vazio="para-atribuir"]').waitFor();
    assert.equal((await page.locator('[data-vazio="para-atribuir"]').textContent()).trim(), 'Nada para atribuir nesta semana');
    assert.equal(await page.locator('[data-bloco="para-atribuir"] .cs-card').count(), 0);
    assert.deepEqual(errosReais(erros), []);
    return 'semana 28/set: estado vazio no bloco';
  });

  await cenario('CS7', 'funcionário: o item não aparece na barra e a rota direta diz "sem acesso", sem pedir a semana', async (abrirContexto) => {
    // A barra, numa tela que ele alcança.
    const dele = await abrir(abrirContexto, { rota: '/meu-trabalho', funcionario: true });
    await dele.page.getByRole('link', { name: 'Minhas tarefas', exact: true }).first().waitFor();
    assert.equal(await dele.page.getByRole('link', { name: 'Controle da semana' }).count(), 0, 'o item não está na barra');

    // A rota direta.
    const direta = await abrir(abrirContexto, { funcionario: true });
    await direta.page.getByText('O controle da semana é só para administradores').waitFor();
    assert.equal(await direta.page.locator('[data-bloco]').count(), 0, 'nenhum bloco desenhado');
    assert.deepEqual(direta.estado.leituras, [], 'a semana nem foi pedida');
    assert.deepEqual(errosReais(direta.erros), []);
    return 'sem item na barra; /controle-da-semana → sem acesso, 0 leituras';
  });

  return resultados;
}
