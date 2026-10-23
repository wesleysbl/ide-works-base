/**
 * TELAS QUE FICAVAM PRESAS NA FALHA — conferência de 09/10/2026.
 *
 * Cada cenário abaixo é uma tela cuja LEITURA falha, e a pergunta é a mesma:
 * a pessoa sai dali sem recarregar a página? (A tela de erro de ROTA, para o
 * que estoura ao desenhar, é de `tela-de-erro.mjs`.)
 *
 *   RT1  Cliente: a ficha que não abriu (500) oferece "Tentar de novo", e
 *        com a API de volta a ficha abre.
 *   RT2  Chat: as conversas que não carregaram (500) dizem isso, com
 *        "Tentar de novo" — e NÃO "Nenhuma conversa ainda" nem "Esta conversa
 *        não está disponível para você", que eram mentira de rede caída.
 *   RT3  Chat: a releitura de uma lista que JÁ estava na tela falha (a que roda a
 *        cada mensagem): a lista e a conversa aberta ficam onde estão.
 *   RT4  Calendário do Planejamento: o mês que não leu oferece "Tentar de novo"
 *        e não afirma "0 conteúdo(s)"; com a API de volta, a grade enche.
 *   RT5  Calendário da ficha do cliente: o mesmo.
 *   RT6  Meta (contas): a lista que não carregou oferece "Tentar de novo".
 *   RT7  Contas da Meta na ficha do cliente: a leitura que falhou oferece
 *        "Tentar de novo" e não desenha "nenhuma conta ligada" como se soubesse.
 *   RT8  Todas as tarefas: o 500 do servidor numa leitura oferece "Tentar de
 *        novo" (Minhas tarefas já oferecia; esta ficava sem saída).
 *   RT9  Ficha da tarefa (página `/tarefa/:id`): idem.
 *   RT11 Alarme da coleta (Meta): a leitura de `/meta/health` que FALHOU não vira
 *        "A coleta nunca rodou" — erro não é "nenhuma execução". Diz que não deu
 *        para conferir, com "Tentar de novo", e com a API de volta o alarme é o certo.
 *   RT10 Armazenamento do navegador NEGADO (`localStorage` e `sessionStorage`
 *        lançam, como com todos os cookies bloqueados): o sistema abre. As
 *        preferências do chat eram a única leitura sem `try`, e viviam na moldura.
 *
 * API simulada (`comum.mjs`): nada chega ao banco.
 */

import assert from 'node:assert/strict';

import { BASE, campoTitulo, criarSuite, pause, row } from './comum.mjs';
import { comCalendario, mesCheio } from './agenda-planejamento.mjs';
import { GERAL, abrirChat, criarEstado } from './chat.mjs';
import { comFichas } from './cliente-ux.mjs';

const FALHA = (message) => ({ status: 500, body: { message } });
const tentarDeNovo = (page) => page.getByRole('button', { name: 'Tentar de novo', exact: true });

const esperarFicha = (page, nome) =>
  page.waitForFunction((n) => document.querySelector('h1')?.textContent?.trim() === n, nome, { timeout: 8000 });

export default async function rodar(browser) {
  const suite = criarSuite(browser);

  await suite.cenario('RT1', 'Cliente: a ficha que não abriu oferece "Tentar de novo" e abre quando a API volta', async (abrir) => {
    let falhar = true;
    const { page } = await abrir({
      custom: (url, req) =>
        falhar && req.method() === 'GET' && url.pathname === '/api/clients/cx-1'
          ? FALHA('Falha simulada na ficha.')
          : comFichas()(url, req),
    });
    await page.goto(BASE + '/cliente/cx-1');
    await page.getByRole('alert').getByText('Falha simulada na ficha.').waitFor();
    await tentarDeNovo(page).waitFor();

    falhar = false;
    await tentarDeNovo(page).click();
    await esperarFicha(page, 'Horizonte Studio');
    assert.equal(await page.getByText('Falha simulada na ficha.').count(), 0);
  });

  await suite.cenario('RT2', 'Chat: conversas que não carregaram dizem isso e oferecem "Tentar de novo" (sem mentir "nenhuma conversa")', async (abrir) => {
    const estado = criarEstado();
    let falhar = true;
    const handler = (url, req) =>
      falhar && req.method() === 'GET' && url.pathname === '/api/chat/conversations'
        ? FALHA('Falha simulada nas conversas.')
        : estado.handler(url, req);
    const { page, context } = await abrir({ custom: handler });
    await context.route('**/api/chat/live', (rota) => rota.abort());

    // Pelo link direto de uma conversa: o pior caso, que dizia "não está disponível para você".
    await page.goto(BASE + '/chat/' + GERAL);
    // (A frase do servidor ou a de último caso: o efeito que zera `erro` ao abrir a conversa pode correr depois.)
    await page.getByRole('alert').getByText(/Falha simulada nas conversas\.|Não foi possível carregar as conversas\./).waitFor();
    await tentarDeNovo(page).first().waitFor();
    assert.equal(await page.getByText('Nenhuma conversa ainda').count(), 0, 'a lista não afirma que está vazia');
    assert.equal(await page.getByText('Esta conversa não está disponível para você').count(), 0, 'não é falta de acesso');

    falhar = false;
    await tentarDeNovo(page).first().click();
    await page.getByLabel('Escrever mensagem', { exact: true }).waitFor();
    await page.getByRole('link', { name: /Geral/ }).first().waitFor();
    assert.equal(await page.getByRole('alert').count(), 0, 'o aviso some quando a leitura volta');
  });

  await suite.cenario('RT3', 'Chat: a releitura que falha NÃO apaga a lista nem tira a conversa aberta da tela', async (abrir) => {
    const estado = criarEstado();
    let falhar = false;
    const handler = (url, req) =>
      falhar && req.method() === 'GET' && url.pathname === '/api/chat/conversations'
        ? FALHA('Falha simulada nas conversas.')
        : estado.handler(url, req);
    const { page } = await abrirChat(abrir, { handler });
    await page.getByRole('link', { name: /Geral/ }).first().click();
    const campo = page.getByLabel('Escrever mensagem', { exact: true });
    await campo.waitFor();

    // Enviar relê a lista (`lerConversas`) — e esta leitura vai falhar.
    falhar = true;
    await campo.fill('bom dia');
    await campo.press('Enter');
    await page.locator('.c-fala[data-estado="confirmada"]').filter({ hasText: 'bom dia' }).waitFor();
    await page.getByRole('alert').getByText('Falha simulada nas conversas.').waitFor();
    await pause(300);

    assert.equal(await campo.count(), 1, 'a conversa aberta continua na tela');
    assert.equal(await page.getByText('Esta conversa não está disponível para você').count(), 0);
    assert.equal(await page.getByText('Nenhuma conversa ainda').count(), 0, 'a lista não foi esvaziada');
    assert.ok((await page.getByRole('link', { name: /Geral/ }).count()) >= 1, 'a conversa Geral segue na lista');
  });

  await suite.cenario('RT4', 'Calendário (Planejamento): o mês que não leu oferece "Tentar de novo" e não diz "0 conteúdo(s)"', async (abrir) => {
    let falhar = true;
    const calendario = comCalendario(mesCheio);
    const { page } = await abrir({
      custom: (url, req) =>
        falhar && url.pathname === '/api/calendar' ? FALHA('Falha simulada no calendário.') : calendario(url, req),
    });
    await page.goto(BASE + '/planejamento?visao=calendario');
    await page.getByRole('alert').getByText('Falha simulada no calendário.').waitFor();
    await tentarDeNovo(page).waitFor();
    assert.equal(await page.locator('.cal-contagem').getByText(/conteúdo\(s\) agendado\(s\)/).count(), 0, 'não afirma zero sem ter lido');

    falhar = false;
    await tentarDeNovo(page).click();
    await page.locator('.cal-grade .cal-casa[data-dia]').first().waitFor();
    await page.locator('.cal-contagem').getByText(/conteúdo\(s\) agendado\(s\)/).waitFor();
    assert.equal(await page.getByText('Falha simulada no calendário.').count(), 0);
  });

  await suite.cenario('RT5', 'Calendário da ficha do cliente: a leitura que falhou oferece "Tentar de novo"', async (abrir) => {
    let falhar = true;
    const ficha = comFichas();
    const { page } = await abrir({
      custom: (url, req) =>
        falhar && url.pathname === '/api/calendar' ? FALHA('Falha simulada no calendário do cliente.') : ficha(url, req),
    });
    await page.goto(BASE + '/cliente/cx-1?area=calendario');
    await page.getByRole('alert').getByText('Falha simulada no calendário do cliente.').waitFor();
    await tentarDeNovo(page).waitFor();

    falhar = false;
    await tentarDeNovo(page).click();
    await page.locator('.cal-grade .cal-casa[data-dia]').first().waitFor();
    assert.equal(await page.getByText('Falha simulada no calendário do cliente.').count(), 0);
  });

  await suite.cenario('RT6', 'Meta (contas): a lista que não carregou oferece "Tentar de novo"', async (abrir) => {
    let falhar = true;
    const { page } = await abrir({
      custom: (url, req) => {
        // O alarme da coleta (no topo da tela) lê `/meta/health`; sem token ele se cala.
        if (url.pathname === '/api/meta/health') return { body: { ok: true, hasToken: false, runs: [] } };
        if (url.pathname === '/api/meta/companies') return { body: { ok: true, podeEscolher: false, empresas: [] } };
        if (url.pathname !== '/api/meta/accounts' || req.method() !== 'GET') return null;
        return falhar ? FALHA('Falha simulada nas contas da Meta.') : { body: { ok: true, hasToken: true, accounts: [] } };
      },
    });
    await page.goto(BASE + '/meta');
    await page.getByRole('alert').getByText('Falha simulada nas contas da Meta.').waitFor();
    await tentarDeNovo(page).waitFor();

    falhar = false;
    await tentarDeNovo(page).click();
    await page.getByText('Nenhuma conta importada').waitFor();
    assert.equal(await page.getByText('Falha simulada nas contas da Meta.').count(), 0);
  });

  await suite.cenario('RT7', 'Contas da Meta na ficha do cliente: a leitura que falhou oferece "Tentar de novo"', async (abrir) => {
    let falhar = true;
    const ficha = comFichas();
    const { page } = await abrir({
      custom: (url, req) =>
        falhar && req.method() === 'GET' && url.pathname === '/api/meta/accounts'
          ? FALHA('Falha simulada nas contas.')
          : ficha(url, req),
    });
    await page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(page, 'Horizonte Studio');
    const dados = page.locator('.cl-dados-alternar:visible, .cl-dados-botao:visible').first();
    if ((await dados.getAttribute('aria-expanded')) !== 'true') await dados.click();
    const painel = page.locator('#cl-dados-painel');
    await painel.getByRole('alert').getByText('Falha simulada nas contas.').waitFor();
    await painel.getByRole('button', { name: 'Tentar de novo', exact: true }).waitFor();
    assert.equal(await painel.getByText('Gerenciadores de anúncios', { exact: false }).count(), 0, 'não desenha "nenhum ligado" sem ter lido');

    falhar = false;
    await painel.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await painel.getByText('Gerenciadores de anúncios', { exact: false }).waitFor();
    assert.equal(await painel.getByText('Falha simulada nas contas.').count(), 0);
  });

  await suite.cenario('RT8', 'Todas as tarefas: o 500 do servidor oferece "Tentar de novo"', async (abrir) => {
    let falhar = true;
    const { page } = await abrir({
      custom: (url, req) =>
        falhar && req.method() === 'GET' && url.pathname === '/api/board/all-tasks'
          ? FALHA('Falha simulada nas tarefas.')
          : null,
    });
    await page.goto(BASE + '/tarefas');
    await page.getByRole('alert').getByText('Falha simulada nas tarefas.').waitFor();
    await tentarDeNovo(page).waitFor();

    falhar = false;
    await tentarDeNovo(page).click();
    await page.getByRole('link', { name: row.title, exact: true }).waitFor();
    assert.equal(await page.getByText('Falha simulada nas tarefas.').count(), 0);
  });

  await suite.cenario('RT9', 'Ficha da tarefa: o 500 do servidor ao abrir oferece "Tentar de novo"', async (abrir) => {
    let falhar = true;
    const { page } = await abrir({
      custom: (url, req) =>
        falhar && req.method() === 'GET' && url.pathname === `/api/board/tasks/${row.id}`
          ? FALHA('Falha simulada na tarefa.')
          : null,
    });
    await page.goto(BASE + '/tarefa/' + row.id);
    await page.getByRole('alert').getByText('Falha simulada na tarefa.').waitFor();
    await tentarDeNovo(page).waitFor();

    falhar = false;
    await tentarDeNovo(page).click();
    await campoTitulo(page).waitFor();
    assert.equal(await page.getByText('Falha simulada na tarefa.').count(), 0);
  });

  await suite.cenario('RT10', 'armazenamento do navegador negado: a moldura e as telas abrem do mesmo jeito', async (abrir) => {
    const { page, context, erros } = await abrir();
    await context.addInitScript(() => {
      const negar = () => {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { get: negar, configurable: true });
      Object.defineProperty(window, 'sessionStorage', { get: negar, configurable: true });
    });
    for (const [caminho, titulo] of [['/painel', 'Painel'], ['/meu-trabalho', 'Minhas tarefas'], ['/chat', 'Chat']]) {
      await page.goto(BASE + caminho);
      await page.getByRole('heading', { name: titulo, level: 1 }).waitFor();
      assert.equal(await page.locator('.iw-erro-de-rota').count(), 0, `${caminho}: a tela de erro não pode aparecer`);
    }
    const graves = erros.filter((e) => /pageerror|SecurityError|Access is denied/i.test(e));
    assert.deepEqual(graves, [], graves.join('\n'));
  });

  await suite.cenario('RT11', 'alarme da coleta: a leitura que falhou não vira "A coleta nunca rodou"', async (abrir) => {
    let falhar = true;
    const { page } = await abrir({
      custom(url, req) {
        if (url.pathname === '/api/meta/companies') return { body: { ok: true, podeEscolher: false, empresas: [] } };
        if (url.pathname === '/api/meta/accounts' && req.method() === 'GET') return { body: { ok: true, hasToken: true, accounts: [] } };
        if (url.pathname !== '/api/meta/health') return null;
        if (falhar) return FALHA('Falha simulada na coleta.');
        const t = new Date(Date.now() - 5 * 60e3).toISOString();
        return {
          body: {
            ok: true, hasToken: true,
            runs: [{ started_at: t, finished_at: t, outcome: 'ok', assets_total: 7, assets_ok: 7, assets_failed: 0, rows_written: 90, first_error: null }],
          },
        };
      },
    });
    await page.goto(BASE + '/meta');
    await page.getByText('Nenhuma conta importada').waitFor();
    await page.getByText('Não foi possível conferir a coleta agora.', { exact: false }).waitFor();
    assert.equal(await page.getByText('A coleta nunca rodou').count(), 0, 'falha de leitura não é "nunca rodou"');

    falhar = false;
    await tentarDeNovo(page).click();
    await page.getByText('coleta em dia').waitFor();
    assert.equal(await page.getByText('Não foi possível conferir a coleta agora.', { exact: false }).count(), 0);
  });

  return suite.resultados;
}
