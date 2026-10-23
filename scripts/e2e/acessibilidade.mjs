/**
 * ACESSIBILIDADE (WCAG 2.2 AA) — a revisão de teclado, leitor de tela e contraste,
 * provada no Chrome real com a API simulada (`servidorUX`, dados fictícios).
 *
 * O que a revisão achou, e o que cada cenário prova:
 *
 *   AC1  O balão (menu de chip, `···` da árvore, `?` de ajuda) devolve o foco ao
 *        botão que o abriu — por `Esc` e ao escolher um item. Antes o foco caía no
 *        `<body>` e o `Tab` seguinte recomeçava do alto da página.
 *   AC2  `Menu` e `Gaveta` (filtros do Painel): a lista tem nome e só contém
 *        opções; `Esc` e escolher devolvem o foco ao gatilho.
 *   AC3  As janelas `aria-modal` prendem o `Tab` (só as pontas) e devolvem o foco:
 *        Marcar no dia, Novo cliente, Nova tarefa, Personalizar.
 *
 * O que cada cenário confere é pelo teclado e pelo nome acessível — nada aqui
 * depende de pixel.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite } from './comum.mjs';
import { semSessao, servidorUX } from './fixtures-ux.mjs';
import { GERAL, criarEstado } from './chat.mjs';
import { abrirMeta } from './meta-ux.mjs';
import { comCalendario, mesCheio } from './agenda-planejamento.mjs';
import { LK } from './lista-kanban.mjs';

/** Descrição curta de quem tem o foco — ajuda a mensagem de falha a dizer onde ele foi parar. */
const focoAgora = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return `${a.tagName.toLowerCase()}[${a.getAttribute('aria-label') ?? (a.textContent ?? '').trim().slice(0, 40)}]`;
  });

/** O foco está neste elemento? */
const temFoco = (loc) => loc.evaluate((el) => document.activeElement === el);

/**
 * Espera o foco chegar ao elemento. O foco devolvido ao fechar vem DEPOIS do
 * desenho (um `requestAnimationFrame`, e mais um pouco se o botão está travado),
 * então a conferência imediata depois de "a janela sumiu" corre contra ele.
 */
async function esperarFoco(page, loc, quem) {
  const el = await loc.elementHandle();
  try {
    await page.waitForFunction((e) => document.activeElement === e, el, { timeout: 4000 });
  } catch {
    assert.fail(`${quem}: o foco devia estar aqui — está em ${await focoAgora(page)}`);
  }
}

/** Espera o `<h1>` da tela (o `Topo`), para não agir sobre a tela que está saindo. */
const esperarTela = (page, titulo) =>
  page.getByRole('heading', { level: 1, name: titulo, exact: true }).waitFor({ timeout: 15_000 });

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  /* ───────────────────────────── AC1 ───────────────────────────── */

  await cenario('AC1', 'o balão devolve o foco ao botão que o abriu — Esc no `?` de ajuda e no `···` da árvore; escolher no chip da ficha', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });

    // 1) O `?` do Painel: abre pelo teclado e o `Esc` volta a ele.
    await page.goto(BASE + '/painel');
    await esperarTela(page, 'Painel');
    const ajuda = page.getByRole('button', { name: 'Explicar: a urgência' });
    await ajuda.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'a urgência' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'a urgência' }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Explicar: a urgência');
    await esperarFoco(page, ajuda, 'Esc no "?"');

    // 2) O `···` da árvore da barra lateral (o menu mais usado do dia a dia).
    const acoes = page.getByRole('button', { name: 'Ações de TIME A' });
    await acoes.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu', { name: 'Pasta' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu', { name: 'Pasta' }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ações de TIME A');
    await esperarFoco(page, acoes, 'Esc no "···"');

    // 3) Escolher um item do chip da ficha: o botão fica travado enquanto grava,
    //    e o foco precisa esperá-lo destravar em vez de cair no `<body>`.
    await page.goto(BASE + '/tarefa/t-ux-1');
    await esperarTela(page, 'Tarefa');
    const prioridade = page.locator('button.cu-chip[aria-haspopup], button.cu-seletor', { hasText: /Alta|Urgente|Normal|Baixa|Prioridade/ }).first();
    await prioridade.waitFor();
    await prioridade.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Prioridade' });
    await menu.waitFor();
    await menu.getByRole('menuitemcheckbox', { name: 'Urgente' }).click();
    await menu.waitFor({ state: 'hidden' });
    await page.waitForFunction(
      () => document.activeElement?.tagName === 'BUTTON' && document.activeElement.classList.contains('cu-chip'),
      null,
      { timeout: 5000 },
    ).catch(() => {});
    assert.match(await focoAgora(page), /^button\[/, `o foco volta a um botão do chip — está em ${await focoAgora(page)}`);
    assert.notEqual(await focoAgora(page), 'BODY');
  });

  /* ───────────────────────────── AC2 ───────────────────────────── */

  await cenario('AC2', 'Menu e Gaveta do Painel: a lista tem nome e só tem opções; Esc e escolher devolvem o foco ao gatilho', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/painel');
    await esperarTela(page, 'Painel');

    // Gaveta (escolha múltipla): a de Etiqueta.
    const etiqueta = page.getByRole('button', { name: /^Etiqueta/ });
    await etiqueta.focus();
    await page.keyboard.press('Enter');
    const lista = page.getByRole('listbox', { name: 'Etiqueta' });
    await lista.waitFor();
    // O `listbox` só contém opções: a busca e o `Fechar` ficam fora dele.
    const intrusos = await lista.evaluate((el) => [...el.children].filter((c) => c.getAttribute('role') !== 'option').length);
    assert.equal(intrusos, 0, 'nenhum filho do listbox que não seja opção');
    await page.keyboard.press('Escape');
    await lista.waitFor({ state: 'hidden' });
    await esperarFoco(page, etiqueta, 'Esc na gaveta');

    // O `Fechar` da gaveta também.
    await etiqueta.click();
    await lista.waitFor();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await lista.waitFor({ state: 'hidden' });
    await esperarFoco(page, etiqueta, 'o X da gaveta');

    // Menu (escolha única): o "Ordenar por" do ranking de criativos da Meta.
    await page.goto(BASE + '/meta/ranking');
    await esperarTela(page, 'Ranking de criativos');
    const ordenar = page.getByRole('button', { name: /^Ordenar por/ });
    await ordenar.focus();
    await page.keyboard.press('Enter');
    const ordens = page.getByRole('listbox', { name: 'Ordenar por' });
    await ordens.waitFor();
    // Escape devolve o foco...
    await page.keyboard.press('Escape');
    await ordens.waitFor({ state: 'hidden' });
    await esperarFoco(page, ordenar, 'Esc no menu');
    // ...e escolher uma opção, com o teclado, também.
    await page.keyboard.press('Enter');
    await ordens.waitFor();
    const opcao = ordens.getByRole('option').nth(1);
    await opcao.focus();
    await page.keyboard.press('Enter');
    await ordens.waitFor({ state: 'hidden' });
    await esperarFoco(page, ordenar, 'escolher no menu');
  });

  /* ───────────────────────────── AC3 ───────────────────────────── */

  await cenario('AC3', 'as janelas aria-modal prendem o Tab e devolvem o foco: Marcar no dia, Novo cliente, Nova tarefa, Personalizar', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });

    /** Dá `Tab` N vezes e confere que o foco nunca sai da janela; depois `Shift+Tab` o mesmo. */
    async function presoNaJanela(dentro, vezes = 40) {
      for (let i = 0; i < vezes; i++) {
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate((s) => !!document.activeElement?.closest(s), dentro), `Tab ${i + 1}: o foco saiu da janela — está em ${await focoAgora(page)}`);
      }
      for (let i = 0; i < vezes; i++) {
        await page.keyboard.press('Shift+Tab');
        assert.ok(await page.evaluate((s) => !!document.activeElement?.closest(s), dentro), `Shift+Tab ${i + 1}: o foco saiu da janela — está em ${await focoAgora(page)}`);
      }
    }

    // 1) Marcar no dia (Planejamento › + Peça) — a `Janela` compartilhada.
    await page.goto(BASE + '/planejamento');
    await esperarTela(page, 'Planejamento');
    const nova = page.getByRole('button', { name: '+ Peça' });
    await nova.focus();
    await page.keyboard.press('Enter');
    const marcar = page.getByRole('dialog', { name: 'Marcar no dia' });
    await marcar.waitFor();
    await presoNaJanela('[role="dialog"][aria-label="Marcar no dia"]');
    await page.keyboard.press('Escape');
    await marcar.waitFor({ state: 'hidden' });
    await esperarFoco(page, nova, 'Esc na janela Marcar no dia');

    // 2) Novo cliente (Painel) — `FichaDeCliente`, com o `role` no véu.
    await page.goto(BASE + '/painel');
    await esperarTela(page, 'Painel');
    const novoCliente = page.getByRole('button', { name: 'Novo cliente' });
    await novoCliente.focus();
    await page.keyboard.press('Enter');
    const ficha = page.getByRole('dialog', { name: 'Novo cliente' });
    await ficha.waitFor();
    await presoNaJanela('[role="dialog"][aria-label="Novo cliente"]', 60);
    await page.keyboard.press('Escape');
    await ficha.waitFor({ state: 'hidden' });
    await esperarFoco(page, novoCliente, 'Esc em Novo cliente');

    // 3) Personalizar a barra lateral — pelo menu da conta.
    const conta = page.getByRole('button', { name: /^Sua conta e configurações/ });
    await conta.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Personalizar a barra lateral' }).click();
    const personalizar = page.getByRole('dialog', { name: 'Personalizar a barra lateral' });
    await personalizar.waitFor();
    await presoNaJanela('[role="dialog"][aria-label="Personalizar a barra lateral"]', 50);
    await page.keyboard.press('Escape');
    await personalizar.waitFor({ state: 'hidden' });
    await esperarFoco(page, conta, 'Esc em Personalizar');

    // 4) Nova tarefa (quadro de uma lista).
    await page.goto(BASE + `/quadro/${LK.l1}`);
    await esperarTela(page, 'Vídeos');
    const novaTarefa = page.getByRole('button', { name: /Nova tarefa/ }).first();
    await novaTarefa.focus();
    await page.keyboard.press('Enter');
    const modal = page.getByRole('dialog', { name: 'Nova tarefa' });
    await modal.waitFor();
    await presoNaJanela('[role="dialog"][aria-label="Nova tarefa"]', 60);
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    await esperarFoco(page, novaTarefa, 'Esc em Nova tarefa');
  });

  /* ───────────────────────────── AC4 ───────────────────────────── */

  await cenario('AC4', 'a chave liga/desliga mostra o foco no trilho — "Manter conectado" na entrada e "Ativo" na ficha do cliente', async (abrir) => {
    /** O anel visível: contorno com largura no trilho, em nenhum lugar no input invisível. */
    const anelDoTrilho = (page) =>
      page.evaluate(() => {
        const input = document.activeElement;
        const trilho = input?.nextElementSibling;
        if (!input || input.type !== 'checkbox' || !trilho?.classList.contains('trilho')) return null;
        const c = getComputedStyle(trilho);
        const caixa = trilho.getBoundingClientRect();
        return { estilo: c.outlineStyle, largura: parseFloat(c.outlineWidth), visivel: caixa.width > 0 && caixa.height > 0, sombra: c.boxShadow };
      });

    // A entrada: sem sessão.
    const e = await abrir({ custom: semSessao, viewport: { width: 1440, height: 900 } });
    await e.page.goto(BASE + '/');
    const manter = e.page.getByRole('checkbox', { name: /Manter conectado/ });
    await manter.waitFor({ state: 'attached' });
    // Tab até ele: o foco entra por teclado (é o que liga o `:focus-visible`).
    for (let i = 0; i < 6 && !(await manter.evaluate((el) => document.activeElement === el)); i++) await e.page.keyboard.press('Tab');
    const anel = await anelDoTrilho(e.page);
    assert.ok(anel, `o foco está na chave — está em ${await focoAgora(e.page)}`);
    assert.equal(anel.visivel, true, 'o trilho tem tamanho');
    assert.equal(anel.estilo, 'solid', 'o trilho tem contorno de foco');
    assert.ok(anel.largura >= 2, `o contorno tem pelo menos 2px — tem ${anel.largura}`);

    // A ficha do cliente: "Ativo" e "Financeiro OK" são a mesma peça.
    const c = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await c.page.goto(BASE + '/cliente/cx-1');
    await esperarTela(c.page, 'Horizonte Studio');
    const ativo = c.page.getByRole('checkbox', { name: 'Ativo', exact: true });
    await ativo.waitFor({ state: 'attached' });
    await c.page.keyboard.press('Shift'); // a última entrada foi o teclado: liga o `:focus-visible`
    await ativo.focus();
    const anelAtivo = await anelDoTrilho(c.page);
    assert.ok(anelAtivo, `o foco está em "Ativo" — está em ${await focoAgora(c.page)}`);
    assert.equal(anelAtivo.estilo, 'solid', '"Ativo" tem contorno de foco no trilho');
  });

  /* ───────────────────────────── AC5 ───────────────────────────── */

  await cenario('AC5', 'seta move o cartão e o foco vai junto, dito em voz alta — Quadro, Pasta e Kanban do Espaço', async (abrir) => {
    /** Foca o cartão, aperta `→` duas vezes e confere que o foco o acompanhou às duas colunas seguintes. */
    async function andarComOCartao(page, { cartao, nomes }) {
      const el = page.locator(cartao).first();
      await el.waitFor();
      const id = await el.getAttribute('data-cartao');
      assert.ok(id, 'o cartão traz `data-cartao`');
      await el.focus();
      for (const nome of nomes) {
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(
          ([i, etapa]) => {
            const a = document.activeElement;
            const titulo = a?.closest('section.q-coluna')?.querySelector('.q-coluna-nome')?.textContent?.trim();
            return a?.getAttribute('data-cartao') === i && titulo === etapa;
          },
          [id, nome],
          { timeout: 5000 },
        ).catch(async () => assert.fail(`o foco devia estar no cartão na coluna "${nome}" — está em ${await focoAgora(page)}`));
        // O cartão fica travado enquanto a gravação não volta (`data-salvando`): a
        // seta seguinte só vale depois — é o comportamento de sempre do quadro.
        await page.waitForFunction(() => document.activeElement?.getAttribute('data-salvando') === 'false', null, { timeout: 5000 });
        const dito = await page.locator('[role="status"].sr-only').first().textContent();
        assert.match(dito ?? '', new RegExp(`movida para ${nome}\\.$`), `o leitor de tela ouve a etapa nova: "${dito}"`);
      }
    }

    // Quadro de uma lista: A fazer → Edição → Aprovação.
    const q = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await q.page.goto(BASE + `/quadro/${LK.l1}`);
    await esperarTela(q.page, 'Vídeos');
    await andarComOCartao(q.page, {
      cartao: 'li.q-cartao[data-cartao]',
      nomes: ['Edição', 'Aprovação'],
    });

    // Quadro da pasta.
    const p = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await p.page.goto(BASE + `/quadro/pasta/${LK.timeA}`);
    await esperarTela(p.page, 'TIME A');
    // `lk-09` é da lista de Artes, cuja esteira tem "Criação" — a da lista de
    // Vídeos não tem, e a pasta recusa (com aviso) mover para etapa que a lista não tem.
    await andarComOCartao(p.page, {
      cartao: 'li.q-cartao:has(a[href="/tarefa/lk-09"])',
      nomes: ['Criação'],
    });

    // Kanban do Espaço (uma faixa por fluxo; a seta anda DENTRO do fluxo).
    const k = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await k.page.goto(BASE + `/quadro/espaco/${LK.espaco}?ver=kanban&agrupar=nenhum`);
    await k.page.locator('.ek-kanban .q-cartao').first().waitFor();
    await andarComOCartao(k.page, {
      cartao: '.ek-kanban li.q-cartao[data-cartao]',
      nomes: ['Edição'],
    });
  });

  /* ───────────────────────────── AC6 ───────────────────────────── */

  await cenario('AC6', 'o título da aba acompanha a tela: "<h1> · IDE Works", único por tela, e muda ao navegar sem recarregar', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    const titulos = new Map();
    const h1 = () =>
      page.evaluate(() => {
        const h = [...document.querySelectorAll('h1')].find((x) => x.getBoundingClientRect().height > 0);
        return (h?.textContent || h?.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim();
      });

    // As telas com sessão que o Topo desenha (as públicas têm o `<h1>` na moldura pública).
    const telas = ['/painel', '/planejamento', '/controle-da-semana', '/meu-trabalho', '/tarefas', '/avisos', '/catalogos', '/pessoas', '/conexoes', '/cliente/cx-1', `/quadro/${LK.l1}`, '/meta'];
    for (const rota of telas) {
      await page.goto(BASE + rota);
      await page.waitForFunction(() => [...document.querySelectorAll('h1')].some((h) => h.getBoundingClientRect().height > 0 && h.textContent.trim() !== '' && h.textContent.trim() !== 'Cliente' && h.textContent.trim() !== 'Quadro'), null, { timeout: 15_000 });
      const nome = await h1();
      await page.waitForFunction((n) => document.title === `${n} · IDE Works`, nome, { timeout: 5000 }).catch(async () => assert.fail(`${rota}: o título da aba devia ser "${nome} · IDE Works" — é "${await page.title()}"`));
      assert.ok(!titulos.has(await page.title()), `${rota}: o título "${await page.title()}" repete o de ${titulos.get(await page.title())}`);
      titulos.set(await page.title(), rota);
    }

    // A ficha: o `<h1>` é "Tarefa" para todas, e a aba diz QUAL.
    await page.goto(BASE + '/tarefa/t-ux-1');
    await page.waitForFunction(() => /· Tarefa · IDE Works$/.test(document.title), null, { timeout: 10_000 });

    // Navegar pela barra (sem recarregar a página) troca o título.
    await page.goto(BASE + '/painel');
    await page.waitForFunction(() => document.title === 'Painel · IDE Works');
    await page.evaluate(() => { window.__semRecarregar = true; });
    await page.getByRole('link', { name: 'Minhas tarefas', exact: true }).click();
    await page.waitForFunction(() => document.title === 'Minhas tarefas · IDE Works', null, { timeout: 10_000 });
    assert.equal(await page.evaluate(() => window.__semRecarregar === true), true, 'navegou pelo roteador, sem recarregar');

    // A entrada fica "IDE Works"; as telas sem sessão dizem o nome delas.
    const e = await abrir({ custom: semSessao, viewport: { width: 1440, height: 900 } });
    await e.page.goto(BASE + '/');
    await e.page.getByRole('heading', { level: 1 }).waitFor();
    assert.equal(await e.page.title(), 'IDE Works');
    await e.page.goto(BASE + '/ativar');
    await e.page.waitForFunction(() => document.title === 'Ativar conta · IDE Works', null, { timeout: 5000 }).catch(async () => assert.fail(`/ativar: título "${await e.page.title()}"`));
  });

  /* ───────────────────────────── AC7 ───────────────────────────── */

  await cenario('AC7', 'o dia do calendário diz a data e o estado; o comentário da ficha tem nome; textbox sem aria-expanded', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/tarefa/t-ux-1');
    await esperarTela(page, 'Tarefa');

    // O campo de comentário (antes sem nome nenhum: o placeholder é um `data-`).
    await page.getByRole('textbox', { name: 'Escreva o que foi entregue ou cole o link do Dropbox' }).waitFor();
    // Nenhum `textbox` da ficha sem nome nem com `aria-expanded` (o papel não o aceita).
    const textboxes = await page.evaluate(() =>
      [...document.querySelectorAll('[role="textbox"]')].map((e) => ({ nome: e.getAttribute('aria-label') ?? '', expandido: e.hasAttribute('aria-expanded') })),
    );
    assert.ok(textboxes.length >= 3, 'a ficha tem título, descrição e comentário');
    for (const t of textboxes) {
      assert.notEqual(t.nome, '', 'todo textbox tem nome');
      assert.equal(t.expandido, false, `textbox "${t.nome}" não leva aria-expanded`);
    }

    // O seletor de datas do chip de prazo.
    await page.getByRole('button', { name: /^Prazo/ }).click();
    const datas = page.getByRole('menu', { name: 'Datas da tarefa' });
    await datas.waitFor();
    const lerDias = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.cu-cal-dia')].map((b) => ({
          nome: b.getAttribute('aria-label'),
          texto: b.textContent.trim(),
          pressionado: b.getAttribute('aria-pressed'),
          atual: b.getAttribute('aria-current'),
        })),
      );
    const dias = await lerDias();
    assert.ok(dias.length >= 28, `a grade do mês tem os dias (${dias.length})`);
    for (const d of dias) {
      assert.match(d.nome ?? '', /^(domingo|segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado), \d{1,2} de \p{L}+ de \d{4}$/u, `nome do dia "${d.texto}"`);
      assert.ok(d.nome.includes(d.texto), `o número visível "${d.texto}" está no nome "${d.nome}"`);
      assert.ok(['true', 'false'].includes(d.pressionado), `o dia "${d.nome}" diz se está escolhido (aria-pressed)`);
    }
    assert.ok(dias.some((d) => d.pressionado === 'true'), 'o dia do prazo está marcado como escolhido');

    // "Hoje" leva a grade ao mês de hoje, e o dia de hoje diz `aria-current="date"` — uma vez só.
    await datas.locator('.cu-ferramenta', { hasText: /^Hoje$/ }).click();
    const doMesDeHoje = await lerDias();
    assert.equal(doMesDeHoje.filter((d) => d.atual === 'date').length, 1, 'um único dia é "hoje" (aria-current=date)');
  });

  /* ───────────────────────────── AC8 ───────────────────────────── */

  await cenario('AC8', 'erros e estados anunciados: campo inválido (alert + describedby), "salvo"/"por salvar" (status) e o erro de criar tarefa (alert)', async (abrir) => {
    // 1) O erro de campo do formulário de cliente: aparece ao enviar, com o foco no botão.
    const a = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await a.page.goto(BASE + '/painel');
    await esperarTela(a.page, 'Painel');
    await a.page.getByRole('button', { name: 'Novo cliente' }).click();
    await a.page.getByRole('button', { name: 'Criar cliente' }).click();
    const alerta = a.page.getByRole('dialog', { name: 'Novo cliente' }).getByRole('alert').filter({ hasText: 'O nome é obrigatório' });
    await alerta.waitFor();
    const nome = a.page.getByRole('dialog', { name: 'Novo cliente' }).getByRole('textbox', { name: /Nome do cliente/ });
    assert.equal(await nome.getAttribute('aria-invalid'), 'true');
    const ligado = await nome.getAttribute('aria-describedby');
    assert.equal(await a.page.evaluate((id) => document.getElementById(id)?.textContent, ligado), 'O nome é obrigatório.', 'o campo aponta para a frase do erro');

    // 2) A ficha: o estado do texto é uma região viva, e o título apagado vira erro anunciado e ligado ao campo.
    const f = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await f.page.goto(BASE + '/tarefa/t-ux-1');
    await esperarTela(f.page, 'Tarefa');
    const estado = f.page.getByRole('status').filter({ hasText: /^Salvo$/ });
    await estado.waitFor();
    const titulo = f.page.getByRole('textbox', { name: 'Título da tarefa', exact: true });
    await titulo.click();
    await f.page.keyboard.type(' novo');
    await f.page.getByRole('status').filter({ hasText: 'há alterações por salvar' }).waitFor();
    await f.page.keyboard.press('Control+a');
    await f.page.keyboard.press('Delete');
    const erroDoTitulo = f.page.getByRole('alert').filter({ hasText: /título/i });
    await erroDoTitulo.first().waitFor();
    assert.equal(await titulo.getAttribute('aria-invalid'), 'true');
    assert.equal(await titulo.getAttribute('aria-describedby'), 't-titulo-erro');

    // 3) Nova tarefa: a API recusa, e a frase da recusa é anunciada (antes: texto colorido, sem papel).
    const base = servidorUX();
    const m = await abrir({
      custom: async (url, req) => (req.method() === 'POST' && /\/api\/board\/lists\/[^/]+\/tasks$/.test(url.pathname)
        ? { status: 400, body: { ok: false } }
        : base(url, req)),
      viewport: { width: 1440, height: 900 },
    });
    await m.page.goto(BASE + `/quadro/${LK.l1}`);
    await esperarTela(m.page, 'Vídeos');
    await m.page.getByRole('button', { name: /Nova tarefa/ }).first().click();
    const modal = m.page.getByRole('dialog', { name: 'Nova tarefa' });
    await modal.waitFor();
    await modal.getByRole('textbox', { name: 'Nome da tarefa' }).fill('Tarefa que a API recusa');
    await modal.getByRole('button', { name: 'Criar Tarefa' }).click();
    await modal.getByRole('alert').filter({ hasText: 'Não foi possível concluir' }).waitFor({ timeout: 5000 });
  });

  /* ───────────────────────────── AC9 ───────────────────────────── */

  await cenario('AC9', 'título, briefing e comentário da ficha mostram o foco com ≥ 3:1, nos dois temas', async (abrir) => {
    /** O contraste do sinal de foco (contorno, ou a borda que mudou) contra o fundo opaco de trás. */
    const contrasteDoFoco = (page, loc) =>
      loc.evaluate(async (el) => {
        await new Promise((r) => setTimeout(r, 350)); // a borda tem transição
        const rgba = (c) => {
          const p = c.match(/[\d.]+/g).map(Number);
          return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
        };
        const sobre = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
        const lum = (c) => {
          const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const razao = (a, b) => {
          const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
          return (x + 0.05) / (y + 0.05);
        };
        // O fundo opaco atrás do campo: empilha os fundos translúcidos dos ancestrais.
        let fundo = { r: 255, g: 255, b: 255, a: 1 };
        const pilha = [];
        for (let a = el.parentElement; a; a = a.parentElement) {
          const c = rgba(getComputedStyle(a).backgroundColor);
          if (c.a > 0) pilha.push(c);
          if (c.a === 1) break;
        }
        for (const c of pilha.reverse()) fundo = sobre(c, fundo);
        const cs = getComputedStyle(el);
        const contorno = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
        const cor = contorno ? cs.outlineColor : cs.borderTopColor;
        return { contorno, largura: cs.outlineWidth, razao: razao(sobre(rgba(cor), fundo), fundo) };
      });

    for (const tema of ['escuro', 'claro']) {
      const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 }, tema });
      await page.goto(BASE + '/tarefa/t-ux-1');
      await esperarTela(page, 'Tarefa');
      const campos = [
        ['título', page.getByRole('textbox', { name: 'Título da tarefa', exact: true }), true],
        ['briefing', page.getByRole('textbox', { name: 'Descrição da tarefa' }), true],
        ['comentário', page.getByRole('textbox', { name: 'Escreva o que foi entregue ou cole o link do Dropbox' }), false],
      ];
      for (const [nome, campo, querContorno] of campos) {
        await campo.waitFor();
        await page.keyboard.press('Shift'); // a última entrada foi o teclado
        await campo.focus();
        const r = await contrasteDoFoco(page, campo);
        if (querContorno) assert.ok(r.contorno, `${nome} (${tema}): sem contorno de foco (largura ${r.largura})`);
        assert.ok(r.razao >= 3, `${nome} (${tema}): o sinal de foco tem ${r.razao.toFixed(2)}:1 — o mínimo é 3:1`);
      }
    }
  });

  /* ───────────────────────────── AC10 ───────────────────────────── */

  await cenario('AC10', 'a letra passa de 4,5:1 nos dois temas: avatar, tipo da conta (IG/ADS), "agora", etiqueta e item escolhido do período', async (abrir) => {
    /** O menor contraste de letra entre os elementos que casam, contra o fundo opaco de trás. */
    const piorContraste = (page, seletor) =>
      page.evaluate((sel) => {
        const rgba = (c) => {
          const p = c.match(/[\d.]+/g).map(Number);
          return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
        };
        const sobre = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
        const lum = (c) => {
          const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const razao = (a, b) => {
          const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
          return (x + 0.05) / (y + 0.05);
        };
        let pior = Infinity;
        let n = 0;
        for (const el of document.querySelectorAll(sel)) {
          // Só o que tem letra à vista: o rosto vazio de "carregando" da conta é `aria-hidden` e não diz nada.
          if (el.getBoundingClientRect().width === 0 || (el.textContent ?? '').trim() === '') continue;
          // O fundo: empilha, de fora para dentro, os fundos dos ancestrais até um opaco; a opacidade do elemento entra na tinta.
          const pilha = [];
          for (let a = el; a; a = a.parentElement) {
            const c = rgba(getComputedStyle(a).backgroundColor);
            if (c.a > 0) pilha.push(c);
            if (c.a === 1) break;
          }
          let fundo = { r: 255, g: 255, b: 255, a: 1 };
          for (const c of pilha.reverse()) fundo = sobre(c, fundo);
          let tinta = rgba(getComputedStyle(el).color);
          let opac = 1;
          for (let a = el; a; a = a.parentElement) opac *= parseFloat(getComputedStyle(a).opacity);
          tinta = { ...tinta, a: tinta.a * opac };
          pior = Math.min(pior, razao(sobre(tinta, fundo), fundo));
          n += 1;
        }
        return { n, pior };
      }, seletor);

    for (const tema of ['escuro', 'claro']) {
      const confere = async (page, rota, seletor, nome, minimo = 4.5) => {
        if (rota) await page.goto(BASE + rota);
        await page.locator(seletor).first().waitFor({ timeout: 15_000 });
        const { n, pior } = await piorContraste(page, seletor);
        assert.ok(n > 0, `${nome} (${tema}): nenhum elemento para medir`);
        assert.ok(pior >= minimo, `${nome} (${tema}): o pior contraste é ${pior.toFixed(2)}:1 — o mínimo é ${minimo}:1 (${n} elementos)`);
      };

      const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 }, tema });
      // O avatar: na barra (a conta) e no chat (um por autor).
      await confere(page, '/chat', '.cu-avatar[title]', 'inicial do avatar');
      // O tipo da conta na Meta.
      await confere(page, '/meta', '.mm-conta-tipo', 'tipo da conta (IG/ADS)');
      // O item escolhido do período: letra verde sobre a névoa dele.
      await page.goto(BASE + '/painel');
      await esperarTela(page, 'Painel');
      await page.getByRole('button', { name: /^▦|\d\d\/\d\d\/\d\d/ }).first().click();
      await confere(page, null, '.bg-luz-soft.text-luz', 'item escolhido do período');
      // O "agora" da semana, na visão Semanas do Planejamento.
      await page.goto(BASE + '/planejamento');
      await esperarTela(page, 'Planejamento');
      await page.getByRole('tab', { name: 'Semanas' }).click();
      await confere(page, null, '.cl-agora', '"agora" da semana');
      // A etiqueta com o par de cores do ClickUp (#a18072 com #fff dá 3,6:1): na ficha.
      await confere(page, '/tarefa/t-ux-1', '.t-etiquetas > .cu-etiqueta', 'etiqueta da ficha');
    }
  });

  /* ───────────────────────────── AC11 ───────────────────────────── */

  await cenario('AC11', 'ir até a mensagem da menção rola instantâneo com prefers-reduced-motion, e suave sem ele', async (abrir) => {
    /** Os `behavior` com que o app chamou `scrollIntoView` depois de abrir a mensagem apontada. */
    async function rolagens(reduzir) {
      const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
      await page.emulateMedia({ reducedMotion: reduzir ? 'reduce' : 'no-preference' });
      await page.addInitScript(() => {
        window.__rolagens = [];
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (arg) {
          window.__rolagens.push({ id: this.id, behavior: typeof arg === 'object' && arg !== null ? (arg.behavior ?? 'auto') : 'auto' });
          return original.call(this, arg);
        };
      });
      await page.goto(BASE + `/chat/${GERAL}`);
      const alvo = page.locator('[id^="chat-msg-"]').first();
      await alvo.waitFor();
      const id = await alvo.getAttribute('id');
      // A mesma conversa, agora com o endereço da menção.
      await page.goto(BASE + `/chat/${GERAL}#${id}`);
      await page.waitForFunction((i) => window.__rolagens.some((r) => r.id === i), id, { timeout: 10_000 });
      return page.evaluate((i) => window.__rolagens.filter((r) => r.id === i).map((r) => r.behavior), id);
    }
    const reduzido = await rolagens(true);
    assert.ok(reduzido.length > 0 && reduzido.every((b) => b === 'auto'), `com menos movimento a rolagem é instantânea — foi ${JSON.stringify(reduzido)}`);
    const normal = await rolagens(false);
    assert.ok(normal.includes('smooth'), `sem a preferência a rolagem continua suave — foi ${JSON.stringify(normal)}`);
  });

  /* ───────────────────────────── AC12 ───────────────────────────── */

  await cenario('AC12', 'a janelinha do chat: abrir foca a busca, Esc e o X fecham e devolvem o foco ao botão; os campos têm nome', async (abrir) => {
    const estado = criarEstado();
    const { page, context } = await abrir({ custom: (url, req) => estado.handler(url, req), viewport: { width: 1440, height: 900 } });
    await context.route('**/api/chat/live', (route) => route.abort());
    await page.goto(BASE + '/meu-trabalho');
    await esperarTela(page, 'Minhas tarefas');
    const botao = () => page.getByRole('button', { name: 'Abrir Chat', exact: true });
    const janela = page.getByRole('complementary', { name: 'Chat Flutuante' });

    // Abrir pelo teclado: o foco entra no campo de busca (que tem nome).
    await botao().focus();
    await page.keyboard.press('Enter');
    await janela.waitFor();
    const busca = janela.getByRole('textbox', { name: 'Buscar conversa ou colega' });
    await esperarFoco(page, busca, 'abrir a janelinha');

    // Esc fecha e o foco volta ao botão flutuante.
    await page.keyboard.press('Escape');
    await janela.waitFor({ state: 'hidden' });
    await esperarFoco(page, botao(), 'Esc na janelinha');

    // O X ("Fechar") faz o mesmo.
    await botao().click();
    await janela.waitFor();
    await janela.getByRole('button', { name: 'Fechar', exact: true }).click();
    await janela.waitFor({ state: 'hidden' });
    await esperarFoco(page, botao(), 'o X da janelinha');

    // Numa conversa: o campo de mensagem tem foco e nome, e Esc fecha de lá.
    await botao().focus();
    await page.keyboard.press('Enter');
    await janela.getByRole('button', { name: /Geral/ }).click();
    const mensagem = janela.getByRole('textbox', { name: 'Escrever mensagem' });
    await esperarFoco(page, mensagem, 'entrar na conversa');
    await page.keyboard.press('Escape');
    await janela.waitFor({ state: 'hidden' });
    await esperarFoco(page, botao(), 'Esc dentro da conversa');
  });

  /* ───────────────────────────── AC13 ───────────────────────────── */

  await cenario('AC13', 'alvos de ponteiro ≥ 24×24, títulos sem salto de nível nos quadros e botões do modal com nome', async (abrir) => {
    /** As caixas (largura × altura) que casam com o seletor, e as que ficam abaixo de 24px. */
    const pequenos = (page, seletor, minimo = 24) =>
      page.evaluate(([sel, min]) =>
        [...document.querySelectorAll(sel)]
          .map((e) => ({ r: e.getBoundingClientRect(), nome: e.getAttribute('aria-label') ?? e.textContent.trim().slice(0, 30) }))
          .filter(({ r }) => r.width > 0)
          .filter(({ r }) => r.width < min - 0.5 || r.height < min - 0.5)
          .map(({ r, nome }) => `${nome} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`),
      [seletor, minimo]);
    const quantos = (page, seletor) => page.locator(seletor).count();

    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    const confere = async (rota, seletor, nome, esperar = seletor) => {
      await page.goto(BASE + rota);
      await page.locator(esperar).first().waitFor({ timeout: 15_000 });
      assert.ok((await quantos(page, seletor)) > 0, `${nome}: nenhum elemento para medir`);
      assert.deepEqual(await pequenos(page, seletor), [], `${nome}: alvo abaixo de 24×24`);
    };
    // O `?` de ajuda, em duas telas.
    await confere('/painel', 'button.cu-ajuda', 'o "?" do Painel');
    await confere('/tarefa/t-ux-1', 'button.cu-ajuda', 'o "?" da ficha');
    // O `···` e o ✓ do cartão do quadro.
    await confere(`/quadro/${LK.l1}`, '.q-cartao-acao > .cu-icone-btn, .q-cartao-concluir > .cu-icone-btn', 'o ··· e o ✓ do cartão');
    // O link da lista e o título, no quadro da pasta.
    await confere(`/quadro/pasta/${LK.timeA}`, 'a.q-lista-do-cartao, a.q-titulo-cartao', 'a lista e o título do cartão da pasta');
    // Os sinais da semana (Planejamento › Semanas).
    await confere('/planejamento?visao=semanas', 'button.pls-sinal', 'os sinais das semanas');
    // As pastilhas do painel do cliente.
    await confere('/planejamento?cliente=p-2', 'button.cl-pastilha-dia, button[aria-label^="Trocar o dia"]', 'a pastilha do dia e o "Trocar o dia"');

    // O breadcrumb da linha de Minhas tarefas: 15px de altura, então precisa de 4,25px de folga do título
    // (o círculo de 24px em volta dele não pode tocar outro alvo — a exceção de espaçamento da 2.5.8).
    await page.goto(BASE + '/meu-trabalho');
    await page.locator('.mt-trilha a.tr-degrau').first().waitFor();
    const folga = await page.evaluate(() => {
      const t = document.querySelector('.mt-trilha a.tr-degrau').getBoundingClientRect();
      const titulo = document.querySelector('a.mt-titulo').getBoundingClientRect();
      return t.top - titulo.bottom;
    });
    assert.ok(folga >= 4.25, `a trilha da linha precisa de 4,25px de folga do título — tem ${folga.toFixed(2)}`);

    // Títulos: nenhum salto de nível (h1 → h3) nos quadros.
    const saltos = () =>
      page.evaluate(() => {
        const niveis = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.getBoundingClientRect().width > 0).map((h) => Number(h.tagName[1]));
        return niveis.flatMap((n, i) => (i > 0 && n > niveis[i - 1] + 1 ? [`h${niveis[i - 1]} → h${n}`] : []));
      });
    for (const rota of [`/quadro/${LK.l1}`, `/quadro/pasta/${LK.timeA}`, `/quadro/espaco/${LK.espaco}?ver=kanban&agrupar=nenhum`]) {
      await page.goto(BASE + rota);
      await page.locator('.q-coluna-nome').first().waitFor({ timeout: 15_000 });
      assert.deepEqual(await saltos(), [], `${rota}: salto de nível de título`);
    }

    // O modal Nova tarefa: todo botão tem nome (o `···` era só ícone).
    await page.goto(BASE + `/quadro/${LK.l1}`);
    await esperarTela(page, 'Vídeos');
    await page.getByRole('button', { name: /Nova tarefa/ }).first().click();
    const modal = page.getByRole('dialog', { name: 'Nova tarefa' });
    await modal.waitFor();
    await modal.getByRole('button', { name: 'Mais opções da tarefa' }).waitFor();
    const semNome = await modal.evaluate((el) => [...el.querySelectorAll('button')].filter((b) => !b.getAttribute('aria-label') && !b.textContent.trim() && !b.getAttribute('title')).length);
    assert.equal(semNome, 0, 'todo botão do modal tem nome');
  });

  /* ───────────────────────────── AC14 ───────────────────────────── */

  await cenario('AC14', 'seletor de período: expanded, nome, Esc/fora fecham e devolvem o foco, dias com data e estado; campanha da Meta é um botão', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/painel');
    await esperarTela(page, 'Painel');
    const gatilho = page.getByRole('button', { name: /▦|\d\d\/\d\d\/\d\d|Mês todo/ }).first();
    assert.equal(await gatilho.getAttribute('aria-expanded'), 'false');
    assert.equal(await gatilho.getAttribute('aria-haspopup'), 'dialog');

    // Abre pelo teclado: o foco entra no diálogo (que tem nome) e o botão diz "aberto".
    await gatilho.focus();
    await page.keyboard.press('Enter');
    const dialogo = page.getByRole('dialog', { name: 'Escolher o período' });
    await dialogo.waitFor();
    assert.equal(await gatilho.getAttribute('aria-expanded'), 'true');
    await esperarFoco(page, dialogo, 'abrir o seletor de período');

    // Os dias dizem a data por extenso e se estão no período (aria-pressed).
    const dias = await dialogo.locator('.grid.grid-cols-7 button').evaluateAll((bs) => bs.map((b) => ({ nome: b.getAttribute('aria-label'), texto: b.textContent.trim(), pressionado: b.getAttribute('aria-pressed') })));
    assert.ok(dias.length >= 28, `a grade tem os dias do mês (${dias.length})`);
    for (const d of dias) {
      assert.match(d.nome ?? '', /^(domingo|segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado), \d{1,2} de \p{L}+ de \d{4}$/u, `nome do dia ${d.texto}`);
      assert.ok(d.nome.includes(d.texto) && ['true', 'false'].includes(d.pressionado));
    }

    // Esc fecha e devolve o foco ao botão.
    await page.keyboard.press('Escape');
    await dialogo.waitFor({ state: 'hidden' });
    await esperarFoco(page, gatilho, 'Esc no seletor de período');
    assert.equal(await gatilho.getAttribute('aria-expanded'), 'false');

    // Clique fora fecha (e não leva o foco de volta: quem clicou fora escolheu outro lugar).
    await gatilho.click();
    await dialogo.waitFor();
    await page.mouse.click(700, 120);
    await dialogo.waitFor({ state: 'hidden' });

    // Escolher uma opção fecha e devolve o foco: "Mês todo".
    await gatilho.click();
    await dialogo.waitFor();
    await dialogo.getByRole('button', { name: 'Mês todo' }).click();
    await dialogo.waitFor({ state: 'hidden' });
    await esperarFoco(page, page.getByRole('button', { name: /▦|\d\d\/\d\d\/\d\d|Mês todo/ }).first(), 'escolher no seletor');

    // A campanha da Meta: um botão com `aria-expanded` (e não a `<tr>`); Enter abre; o clique na linha também.
    const m = await abrirMeta(abrir, '/meta/a-horizonte', {});
    const campanha = m.page.getByRole('button', { name: /Conversas · Outubro/ });
    await campanha.waitFor({ timeout: 15_000 });
    assert.equal(await m.page.locator('tr[aria-expanded], tr[tabindex]').count(), 0, 'a linha não leva aria-expanded nem tabindex');
    assert.equal(await campanha.getAttribute('aria-expanded'), 'false');
    const aberta = (v) => m.page.waitForFunction(([nome, esperado]) => {
      const b = [...document.querySelectorAll('button[aria-expanded]')].find((x) => x.textContent.includes(nome));
      return b?.getAttribute('aria-expanded') === esperado;
    }, ['Conversas · Outubro', v], { timeout: 10_000 });
    await campanha.focus();
    await m.page.keyboard.press('Enter');
    await aberta('true');
    await m.page.keyboard.press('Enter');
    await aberta('false');
    // O clique em outra célula da linha continua abrindo (o ponteiro tem a linha inteira).
    await campanha.locator('xpath=ancestor::tr').locator('td').nth(1).click();
    await aberta('true');
  });

  /* ───────────────────────────── AC15 ───────────────────────────── */

  await cenario('AC15', 'o texto visível está dentro do nome: botão da conta e "+N mais" do calendário', async (abrir) => {
    const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    /** Os trechos de texto que se VEEM no controle (sem o que é `aria-hidden`/`sr-only`) e o nome dele. */
    const lerRotulo = (loc) =>
      loc.evaluate((el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('[aria-hidden="true"],svg,.sr-only').forEach((n) => n.remove());
        const trechos = [];
        const andar = (n) => {
          if (n.nodeType === 3) {
            const t = n.textContent.replace(/\s+/g, ' ').trim();
            if (t) trechos.push(t);
          } else n.childNodes.forEach(andar);
        };
        andar(clone);
        return { trechos, nome: el.getAttribute('aria-label') ?? '' };
      });
    const contem = ({ trechos, nome }) => trechos.length > 0 && trechos.every((t) => norm(nome).includes(norm(t)));

    const a = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await a.page.goto(BASE + '/painel');
    await esperarTela(a.page, 'Painel');
    const conta = a.page.getByRole('button', { name: /^Sua conta e configurações/ });
    await conta.waitFor();
    const c1 = await lerRotulo(conta);
    assert.ok(contem(c1), `o nome "${c1.nome}" devia conter o texto visível ${JSON.stringify(c1.trechos)}`);
    // As iniciais do avatar ("RE") não estão no nome, e por isso o avatar é decorativo ali dentro.
    assert.equal(await conta.locator('.cu-avatar:not([aria-hidden="true"])').count(), 0, 'o avatar do botão da conta é decorativo');

    const b = await abrir({ custom: comCalendario(mesCheio), viewport: { width: 1440, height: 900 } });
    await b.page.goto(BASE + '/calendario');
    const mais = b.page.locator('.cal-mais').first();
    await mais.waitFor({ timeout: 15_000 });
    const c2 = await lerRotulo(mais);
    assert.match(c2.trechos.join(' '), /^\+\d+ mais$/);
    assert.ok(contem(c2), `o nome "${c2.nome}" devia conter o texto visível ${JSON.stringify(c2.trechos)}`);
  });

  /* ───────────────────────────── AC16 ───────────────────────────── */

  await cenario('AC16', 'o botão flutuante do chat recua quando o foco está num controle que ele cobriria, e volta depois', async (abrir) => {
    const { page } = await abrir({ custom: servidorUX(), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/painel');
    await esperarTela(page, 'Painel');
    const fab = page.getByRole('button', { name: 'Abrir Chat', exact: true });
    await fab.waitFor();
    const opacidade = () => fab.evaluate((e) => getComputedStyle(e).opacity);
    /** O que está no centro do controle focado: ele mesmo (ou um filho), e não o botão do chat. */
    const centroLivre = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        const r = el.getBoundingClientRect();
        const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return topo === el || el.contains(topo) || topo?.contains(el);
      });

    // O `Editar` da última linha da carteira fica no canto de baixo à direita, onde o botão está.
    const editar = page.getByRole('button', { name: 'Editar Norte Arquitetura' });
    await editar.waitFor();
    await page.keyboard.press('Shift'); // a última entrada foi o teclado
    // Rola até o `Editar` ficar rente à borda de baixo — onde o Tab o deixa ao rolar o mínimo —,
    // na área do botão do chat, e só então o foca (sem rolar de novo).
    await editar.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - (window.innerHeight - 60)));
    await editar.focus();
    const cobre = await page.evaluate(() => {
      const a = document.activeElement.getBoundingClientRect();
      const f = document.querySelector('.ch-fab').getBoundingClientRect();
      return a.left < f.right && a.right > f.left && a.top < f.bottom && a.bottom > f.top;
    });
    assert.ok(cobre, 'o último `Editar` da carteira fica na área do botão do chat — a prova só vale com a sobreposição');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ch-fab')).opacity === '0', null, { timeout: 4000 }).catch(async () => assert.fail(`o botão devia recuar — opacidade ${await opacidade()}`));
    assert.ok(await centroLivre(), 'o centro do controle focado não está coberto');

    // O foco sai dali (volta ao alto da página): o botão reaparece.
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('a[href="/painel"]')?.focus(); });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.ch-fab')).opacity === '1', null, { timeout: 4000 }).catch(async () => assert.fail(`o botão devia voltar — opacidade ${await opacidade()}`));

    // E ele continua alcançável: o Tab chega a ele, e ali ele fica visível.
    await fab.focus();
    assert.equal(await opacidade(), '1');
  });

  /* ───────────────────────────── AC17 ───────────────────────────── */

  await cenario('AC17', 'Planejamento › Semanas: o foco que rola de lado não para por baixo da coluna do nome', async (abrir) => {
    // No celular a coluna do nome fica presa à esquerda (8,5rem) e a tabela rola de lado; sem o
    // `scroll-padding`, o navegador rola só até a borda da caixa e o controle fica sob essa coluna.
    for (const largura of [390, 1024]) {
      const { page } = await abrir({ custom: servidorUX(), viewport: { width: largura, height: 800 } });
      await page.goto(BASE + '/planejamento?visao=semanas');
      await page.locator('button.pls-sinal').first().waitFor({ timeout: 15_000 });
      const rolagem = page.locator('.pls-rolagem');
      // Um sinal de cada uma das primeiras células com sinal: são as colunas mais à esquerda, as que o
      // foco alcança logo depois da coluna presa.
      const sinais = page.locator('.pls-tabela td:has(button.pls-sinal)').locator('button.pls-sinal:first-child');
      const pedras = await sinais.count();
      assert.ok(pedras > 1, `${largura}px: a prova precisa de pelo menos dois sinais em células diferentes`);
      const coberto = async (i) => {
        // Vai ao fim da tabela e volta pelo foco: é ele quem rola o controle para a vista.
        await rolagem.evaluate((e) => { e.scrollLeft = e.scrollWidth; });
        await page.evaluate(() => document.activeElement?.blur());
        await sinais.nth(i).focus();
        return page.evaluate(() => {
          const el = document.activeElement;
          const r = el.getBoundingClientRect();
          const quem = el.closest('tr').querySelector('.pls-quem').getBoundingClientRect();
          return { esquerda: r.left, borda: quem.right, topo: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el };
        });
      };
      for (const i of [0, Math.min(1, pedras - 1)]) {
        const c = await coberto(i);
        assert.ok(c.esquerda >= c.borda - 0.5, `${largura}px: o sinal ${i} para em ${c.esquerda.toFixed(1)}px, sob a coluna do nome que termina em ${c.borda.toFixed(1)}px`);
        assert.ok(c.topo, `${largura}px: o centro do sinal ${i} está coberto`);
      }
    }
  });

  return resultados;
}
