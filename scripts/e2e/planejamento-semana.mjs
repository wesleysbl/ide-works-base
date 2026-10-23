/**
 * A VISÃO SEMANAS DO PLANEJAMENTO — F35, Fase 6 (seção 4.2 do plano); F43,
 * Fase 2: a aba Semana virou a visão Semanas (`?visao=semanas`), e a tela
 * abre na visão Contrato.
 *
 * No Chrome, com a API interceptada e dados fictícios na FORMA real de
 * `GET /api/planning/weeks` (`src/server/planning-weeks.ts`). O servidor
 * simulado GUARDA ESTADO: a peça criada pelo `POST /items` volta na releitura
 * das semanas, e o `POST /items/:id/completion` a conclui — é isso que prova
 * que a célula reage ao que se gravou, e não a um desenho fixo.
 *
 * O RELÓGIO É FIXO: quarta, 07/10/2026, 12h de Brasília. Outubro de 2026 tem
 * cinco semanas (1–4, 5–11, 12–18, 19–25, 26–31); a atual é a 2. Com cota de
 * 2 artes, a divisão por dias úteis dá meta [0, 1, 1, 0, 0] — por isso a
 * célula da semana atual lê `0/1` e o `0/2` da cota mora na coluna Mês.
 *
 *   PS1  `/planejamento` abre em Contrato; a aba Semanas leva à grade: o
 *        endereço ganha `?visao=semanas`, a aba fica marcada e a grade desenha
 *        o cliente de teste. `?visao=semanas` colado abre direto nela.
 *   PS2  `+` na semana atual → seletor só com os dias da semana → dia 9: a
 *        célula ganha ●, o placar continua `0/1` e o mês `0/2`.
 *   PS3  clicar no ● abre a janela do Calendário (`MarcarNoDia`); marcar
 *        Concluído e salvar: ✓, `1/1` na semana e `1/2` no mês.
 *   PS4  celular com toque (390×844): nenhum "?" visível, `+` à vista, a grade
 *        rola de lado e a página não.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite } from './comum.mjs';

/* ─────────────────────────── fixtures ─────────────────────────── */

const AGORA = new Date('2026-10-07T15:00:00Z'); // 07/10/2026 12:00 em Brasília
const MES = '2026-10';
const CLIENTE = 'Cliente Teste Semana';

const linhaDoCliente = (items) => ({
  id: 'cl-semana',
  name: CLIENTE,
  categoryId: 'c1',
  categoryName: 'Ide',
  plan: null,
  owners: [{ id: 'u-ana', name: 'Ana Responsável' }],
  quotaSource: 'contrato',
  quota: { arte: 2 },
  hasContentContract: true,
  items,
});

/**
 * O servidor simulado com estado: `itens` é o banco. Devolve o `custom` do
 * `setup` e o registro do que foi gravado.
 */
function servidorDaSemana() {
  const itens = [];
  const gravacoes = [];
  let seq = 0;
  const custom = (url, req) => {
    const p = url.pathname;
    const m = req.method();
    if (p === '/api/planning' && m === 'GET')
      return { body: { ok: true, month: url.searchParams.get('month'), clients: [] } };
    if (p === '/api/planning/weeks' && m === 'GET') {
      const mes = (url.searchParams.get('month') ?? '').slice(0, 7);
      return { body: { ok: true, month: `${mes}-01`, clients: mes === MES ? [linhaDoCliente(itens.map((i) => ({ ...i })))] : [] } };
    }
    if (p === '/api/items' && m === 'POST') {
      const corpo = req.postDataJSON() ?? {};
      gravacoes.push({ rota: 'POST /items', corpo });
      seq += 1;
      const id = `it-semana-${seq}`;
      itens.push({
        id,
        contentType: corpo.contentType,
        scheduledAt: corpo.scheduledAt ?? null,
        completedAt: null,
        isExtra: false,
        title: corpo.title ?? null,
      });
      return { body: { ok: true, id } };
    }
    const conclusao = /^\/api\/items\/([^/]+)\/completion$/.exec(p);
    if (conclusao) {
      gravacoes.push({ rota: `${m} /items/:id/completion`, id: conclusao[1] });
      const item = itens.find((i) => i.id === conclusao[1]);
      if (!item) return { status: 404, body: { ok: false, message: 'Item não encontrado (simulado).' } };
      item.completedAt = m === 'POST' ? AGORA.toISOString() : null;
      return { body: { ok: true } };
    }
    return null;
  };
  return { custom, itens, gravacoes };
}

const errosReais = (erros) => erros.filter((e) => !/chat\/live|WebSocket|Failed to load resource/i.test(e));

/** A sublinha Arte do cliente de teste. */
const linhaArte = (page) =>
  page.locator(`tr.pls-linha[data-cliente="cl-semana"]`, { has: page.locator('.pls-tipo', { hasText: /^Arte$/ }) });
const celulaAtual = (page) => linhaArte(page).locator('td.pls-celula[data-atual]');
const placarDaSemana = (page) => celulaAtual(page).locator('.pls-placar');
const placarDoMes = (page) => linhaArte(page).locator('td.pls-mes .pls-placar');
const sinais = (page) =>
  celulaAtual(page).locator('.pls-sinal:not([data-sinal="vaga"])').evaluateAll((els) => els.map((e) => e.textContent.trim()));

async function abrirSemana(abrir, opcoes = {}, caminho = '/planejamento') {
  const servidor = servidorDaSemana();
  const s = await abrir({ custom: servidor.custom, ...opcoes });
  await s.page.clock.setFixedTime(AGORA);
  await s.page.goto(BASE + caminho);
  return { ...s, ...servidor };
}

/* ─────────────────────────── a suíte ─────────────────────────── */

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('PS1', 'abre em Contrato; a aba Semanas grava ?visao=semanas, fica marcada e a grade desenha o cliente', async (abrir) => {
    const { page, erros } = await abrirSemana(abrir);
    const aba = page.getByRole('tab', { name: 'Semanas', exact: true });
    await aba.waitFor();
    // F43 Fase 2: o padrão agora é a visão Contrato.
    assert.equal(await page.getByRole('tab', { name: 'Contrato', exact: true }).getAttribute('aria-selected'), 'true', 'abre na visão Contrato');
    await page.locator('.plc-tabela').waitFor();
    await aba.click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('visao') === 'semanas');
    assert.equal(await aba.getAttribute('aria-selected'), 'true');
    await linhaArte(page).waitFor();
    // A semana atual é a 2 (05–11/10), marcada no cabeçalho.
    const atual = page.locator('th.pls-semana[aria-current="date"] .pls-semana-n');
    assert.equal((await atual.textContent()).trim(), 'Semana 2');
    const endereco = `${new URL(page.url()).pathname}${new URL(page.url()).search}`;

    // O endereço colado abre direto na grade.
    const colado = await abrirSemana(abrir, {}, '/planejamento?visao=semanas');
    await linhaArte(colado.page).waitFor();
    assert.equal(await colado.page.getByRole('tab', { name: 'Semanas', exact: true }).getAttribute('aria-selected'), 'true');
    assert.deepEqual(errosReais(erros), []);
    assert.deepEqual(errosReais(colado.erros), []);
    return `${endereco}; atual: Semana 2; ?visao=semanas colado abre a grade`;
  });

  await cenario('PS2', '+ na semana atual → escolher o dia 9: aparece ● e o placar não muda (0/1 na semana, 0/2 no mês)', async (abrir) => {
    const { page, erros, gravacoes } = await abrirSemana(abrir);
    await page.getByRole('tab', { name: 'Semanas', exact: true }).click();
    await linhaArte(page).waitFor();
    assert.equal((await placarDaSemana(page).textContent()).trim(), '0/1', 'semana atual: meta 1 (cota 2 dividida pelos dias úteis)');
    assert.equal((await placarDoMes(page).textContent()).trim(), '0/2', 'mês: 0 de 2');
    assert.deepEqual(await sinais(page), [], 'nenhuma peça antes');
    assert.equal(await celulaAtual(page).getAttribute('data-estado'), 'risco');

    await page.getByRole('button', { name: `Criar arte na semana 2 de ${CLIENTE}`, exact: true }).click();
    const seletor = page.getByRole('dialog', { name: 'Escolher o dia' });
    await seletor.waitFor();
    // Só os dias da semana 2 (05–11) estão habilitados.
    const habilitados = await seletor.locator('.cu-cal-dia:not([disabled])').evaluateAll((els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(habilitados, ['5', '6', '7', '8', '9', '10', '11'], `dias habilitados: ${habilitados.join(',')}`);
    assert.equal(gravacoes.length, 0, 'nada grava antes de escolher o dia');
    // O dia agora se chama pela data por extenso ("sexta-feira, 9 de outubro de 2026"), com o
    // número visível dentro do nome: o nome acessível melhorou (WCAG 4.1.2, 2.4.6), e o
    // botão que antes era só "9" passa a dizer de que mês é.
    await seletor.getByRole('button', { name: /, 9 de \p{L}+ de \d{4}$/u }).click();
    await seletor.waitFor({ state: 'detached' });

    await page.waitForFunction(() => document.querySelector('tr.pls-linha[data-cliente="cl-semana"] td.pls-celula[data-atual] .pls-sinal[data-sinal="agendada"]'));
    assert.deepEqual(gravacoes, [
      { rota: 'POST /items', corpo: { clientId: 'cl-semana', month: '2026-10-01', contentType: 'arte', scheduledAt: '2026-10-09T12:00:00Z' } },
    ]);
    assert.deepEqual(await sinais(page), ['●']);
    assert.equal((await placarDaSemana(page).textContent()).trim(), '0/1', 'agendar não conta como feito');
    assert.equal((await placarDoMes(page).textContent()).trim(), '0/2');
    assert.equal(await celulaAtual(page).getAttribute('data-estado'), 'andamento', 'com a peça agendada a semana sai do risco');
    assert.deepEqual(errosReais(erros), []);
    return 'POST /items dia 09/10 → ● na semana 2; 0/1 e 0/2';
  });

  await cenario('PS3', 'clicar no ● abre a janela do Calendário; marcar Concluído → ✓, 1/1 na semana e 1/2 no mês', async (abrir) => {
    const { page, erros, gravacoes, itens } = await abrirSemana(abrir);
    // A peça já agendada no servidor — o caminho da criação é o PS2.
    itens.push({ id: 'it-ja-agendada', contentType: 'arte', scheduledAt: '2026-10-09T12:00:00Z', completedAt: null, isExtra: false, title: 'Post da campanha' });
    await page.getByRole('tab', { name: 'Semanas', exact: true }).click();
    await linhaArte(page).waitFor();
    assert.deepEqual(await sinais(page), ['●']);

    await celulaAtual(page).getByRole('button', { name: 'Abrir Post da campanha · 09/10 · agendada', exact: true }).click();
    const janela = page.getByRole('dialog');
    await janela.waitFor();
    assert.equal((await janela.getByRole('heading').first().textContent()).trim(), 'Entrega');
    assert.equal(await janela.getByLabel('Nome').inputValue(), 'Post da campanha');
    await janela.locator('label', { hasText: 'Concluído' }).click();
    await janela.getByRole('button', { name: 'Salvar', exact: true }).click();
    await janela.waitFor({ state: 'detached' });

    await page.waitForFunction(() => document.querySelector('tr.pls-linha[data-cliente="cl-semana"] td.pls-celula[data-atual] .pls-sinal[data-sinal="feita"]'));
    assert.deepEqual(gravacoes, [{ rota: 'POST /items/:id/completion', id: 'it-ja-agendada' }], 'só a conclusão foi gravada');
    assert.deepEqual(await sinais(page), ['✓']);
    assert.equal((await placarDaSemana(page).textContent()).trim(), '1/1');
    assert.equal((await placarDoMes(page).textContent()).trim(), '1/2');
    assert.equal(await celulaAtual(page).getAttribute('data-estado'), 'bateu');
    assert.deepEqual(errosReais(erros), []);
    return '● → ✓; semana 1/1 (bateu), mês 1/2';
  });

  await cenario('PS4', 'celular com toque 390×844: nenhum "?", + à vista, a grade rola de lado e a página não', async (abrir) => {
    const { page, erros } = await abrirSemana(abrir, { viewport: { width: 390, height: 844 }, toque: true });
    await page.getByRole('tab', { name: 'Semanas', exact: true }).tap();
    await linhaArte(page).waitFor();
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'o contexto é de toque');

    // Os "?" da aba existem no DOM, mas nenhum aparece.
    const ajudas = page.locator('.pls [aria-label^="Explicar:"]');
    assert.ok((await ajudas.count()) >= 4, `os "?" estão no DOM (${await ajudas.count()})`);
    const visiveis = await ajudas.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
    assert.equal(visiveis, 0, `${visiveis} "?" visíveis no celular`);

    // O + da semana atual: opaco, com alvo de toque, dentro da área visível da grade.
    const mais = page.getByRole('button', { name: `Criar arte na semana 2 de ${CLIENTE}`, exact: true });
    const estado = await mais.evaluate((el) => {
      const caixa = el.closest('[data-pls-rolagem]').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { opacidade: getComputedStyle(el).opacity, w: r.width, h: r.height, dentro: r.left >= caixa.left && r.right <= caixa.right };
    });
    assert.equal(estado.opacidade, '1', 'o + fica à vista no toque');
    assert.ok(estado.w >= 24 && estado.h >= 24, `alvo do + com ${estado.w}×${estado.h}px`);
    assert.ok(estado.dentro, 'a semana atual já está à vista na rolagem da grade');

    // A grade rola de lado; a página, não.
    const rolagem = await page.evaluate(() => {
      const g = document.querySelector('[data-pls-rolagem]');
      return { grade: g.scrollWidth - g.clientWidth, pagina: document.documentElement.scrollWidth - window.innerWidth };
    });
    assert.ok(rolagem.grade > 0, `a grade não rola de lado (sobra ${rolagem.grade}px)`);
    assert.ok(rolagem.pagina <= 0, `a página rola de lado ${rolagem.pagina}px`);
    // E rola de fato.
    const antes = await page.locator('[data-pls-rolagem]').evaluate((g) => g.scrollLeft);
    await page.locator('[data-pls-rolagem]').evaluate((g) => { g.scrollLeft = g.scrollWidth; });
    const depois = await page.locator('[data-pls-rolagem]').evaluate((g) => g.scrollLeft);
    assert.ok(depois > antes, `scrollLeft ${antes} → ${depois}`);
    assert.deepEqual(errosReais(erros), []);
    return `+ ${estado.w}×${estado.h}px; grade sobra ${rolagem.grade}px; scrollLeft ${antes} → ${depois}`;
  });

  return resultados;
}
