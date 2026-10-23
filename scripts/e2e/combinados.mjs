/**
 * Os cenários COMBINADOS — F17.AUD08, tarefa 2 do plano.
 *
 * Cada etapa provou a sua correção isolada. Aqui as correções se cruzam, que
 * é como a pessoa as encontra:
 *
 *   (a) AUD01 + AUD03: a resposta atrasada da mãe chega DEPOIS de a pessoa ter
 *       voltado à filha e começado a editar. O texto não pode sumir, a ficha
 *       tem que continuar sendo a filha, o X tem que perguntar, e
 *       Continuar tem que manter tudo.
 *   (b) AUD03 + AUD04: gravar com a sessão vencida e a renovação fora do ar.
 *       O texto fica, o aviso é o da renovação (passageiro), e quando a
 *       renovação volta o próximo Salvar conclui UMA vez — sem gravação
 *       duplicada.
 *   (c) AUD01 + AUD06: 250 pendentes em três páginas; abrir a tarefa 150 do
 *       segundo lote pelo X da ficha; ao voltar, as 200 linhas e a
 *       rolagem estão de volta.
 *
 * ⚠️ F29 (Fase 4): (a) e (c) clicavam o `‹ Voltar` da moldura, que saiu da
 * ficha (a trilha o substitui). Clicam agora o X — a mesma peça, no modo
 * `close`, com o mesmo destino (`comoVoltar`): com histórico, o passo
 * anterior. O que os cenários provam não muda.
 */

import assert from 'node:assert/strict';

import { BASE, X, campoTitulo, criarSuite, detail, esperarTitulo, janela, lerTitulo, pause, row, semEco, titulos, abrirEmTelaCheia, fecharFicha } from './comum.mjs';
import { servidorPaginado } from './paginacao.mjs';

export default async function (browser) {
  const { cenario, pendente, resultados } = criarSuite(browser);

  await cenario(
    'a',
    'filha → mãe lenta → Voltar → editar título → a resposta atrasada não entra → X pergunta → Continuar mantém; Salvar grava na filha',
    async (abrir) => {
      let delayParent = false;
      const { page, writes, erros } = await abrir({
        custom: async (url, req) => {
          if (url.pathname === '/api/board/my-tasks')
            return {
              body: {
                ok: true,
                work: {
                  rows: [{ ...row, id: 'child', title: 'Tarefa filha' }],
                  total: 1,
                  capped: false,
                },
              },
            };
          if (!url.pathname.startsWith('/api/board/tasks/')) return null;
          const id = url.pathname.split('/').pop();
          if (id === 'parent' && delayParent && req.method() === 'GET') await pause(1400);
          const patch = req.method() === 'PATCH' ? (req.postDataJSON() ?? {}) : {};
          return {
            body: {
              ok: true,
              task: {
                ...detail,
                id,
                title: patch.title ?? (id === 'parent' ? 'Tarefa mãe' : 'Tarefa filha'),
                parentId: id === 'child' ? 'parent' : null,
                parentTitle: 'Tarefa mãe',
              },
              storage: { ready: false, variable: '' },
            },
          };
        },
      });
      // Chega à filha pela lista, para o X sair no modo histórico. F43, Fase
      // 7: a linha abre a ficha AO LADO; este cenário prova a PÁGINA (o X, a
      // mãe pela rota), então troca o painel por ela ("Abrir em tela cheia",
      // no mesmo lugar do histórico).
      await page.goto(BASE + '/meu-trabalho');
      await page.getByRole('link', { name: 'Tarefa filha', exact: true }).click();
      await page.waitForURL('**/tarefa/child');
      await abrirEmTelaCheia(page);
      await page.getByRole('link', { name: 'subtarefa de Tarefa mãe', exact: true }).waitFor();
      delayParent = true;
      const pedidoDaMae = page.waitForRequest((r) => r.url().endsWith('/board/tasks/parent'));
      await page.getByRole('link', { name: 'subtarefa de Tarefa mãe', exact: true }).click();
      await pedidoDaMae;
      // Volta antes de a mãe responder; a filha relê rápido.
      await page.goBack();
      await page.waitForURL('**/tarefa/child');
      await esperarTitulo(page, 'Tarefa filha');
      const title = campoTitulo(page);
      await title.fill('Edição na filha, com a mãe a caminho');
      await page.getByText('há alterações por salvar', { exact: true }).waitFor();
      // A resposta atrasada da mãe chega agora (1,4 s depois do pedido).
      await pause(1800);
      assert.equal(
        await lerTitulo(title),
        'Edição na filha, com a mãe a caminho',
        'a resposta atrasada não apagou o texto',
      );
      assert.equal(new URL(page.url()).pathname, '/tarefa/child');
      assert.equal(await page.getByText('há alterações por salvar', { exact: true }).count(), 1);
      // X com texto: a decisão; Continuar mantém texto, ficha e endereço.
      await page.getByRole('button', X).click();
      await janela(page).waitFor();
      await page.getByRole('button', { name: 'Continuar editando', exact: true }).click();
      await janela(page).waitFor({ state: 'hidden' });
      assert.equal(await lerTitulo(title), 'Edição na filha, com a mãe a caminho');
      assert.equal(new URL(page.url()).pathname, '/tarefa/child');
      assert.equal(writes.length, 0, 'continuar não grava');
      // Salvar: a gravação é da filha.
      await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
      await page.getByText('Salvo.', { exact: true }).waitFor();
      assert.equal(writes.length, 1);
      assert.equal(writes[0].url, '/api/board/tasks/child');
      assert.equal(writes[0].body.title, 'Edição na filha, com a mãe a caminho');
      assert.deepEqual(erros, []);
      return 'texto e ficha (filha) sobrevivem à resposta atrasada da mãe; PATCH único em /tasks/child';
    },
  );

  /** O servidor de (b): renovação fora do ar até `renovacaoNoAr`; PATCH 401 até o crachá ser renovado. */
  const servidorComSessaoVencida = () => {
    const estado = {
      renovacaoNoAr: false,
      sessaoValida: false,
      respostasDoPatch: [],
    };
    const custom = (url, req) => {
      if (url.pathname === '/api/auth/refresh') {
        if (!estado.renovacaoNoAr)
          return {
            status: 503,
            body: { message: 'Não foi possível renovar agora. Tente de novo.' },
          };
        estado.sessaoValida = true;
        return { status: 200, body: { ok: true } };
      }
      if (req.method() === 'PATCH') {
        // Com o crachá vencido, toda gravação é 401. Só depois de uma
        // renovação bem-sucedida a chamada REFEITA grava.
        const status = estado.sessaoValida ? 200 : 401;
        estado.respostasDoPatch.push(status);
        if (status === 401)
          return {
            status: 401,
            body: { ok: false, message: 'Sessão expirada' },
          };
      }
      return null;
    };
    return { estado, custom };
  };

  /** Edita o título, tenta salvar com a renovação fora do ar e confere o que a AUD04 promete. */
  async function salvarComRenovacaoForaDoAr(page, estado) {
    const title = campoTitulo(page);
    await title.waitFor();
    await title.fill('Texto que a renovação fora do ar não pode perder');
    await page.getByText('há alterações por salvar', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
    await page
      .getByText('Não foi possível renovar agora. Tente de novo.', {
        exact: false,
      })
      .waitFor({ timeout: 5000 });
    assert.equal(new URL(page.url()).pathname, '/tarefa/' + row.id, 'não foi para o login');
    assert.equal(await lerTitulo(title), 'Texto que a renovação fora do ar não pode perder');
    assert.equal(
      await page.getByText('há alterações por salvar', { exact: true }).count(),
      1,
      'a alteração continua pendente',
    );
    assert.deepEqual(estado.respostasDoPatch, [401], 'uma tentativa só, sem repetição automática');
    return title;
  }

  await cenario(
    'b',
    'edição pendente + 401 + renovação 503 ao salvar: texto fica, aviso da renovação; quando o refresh volta 200, Salvar conclui uma vez',
    async (abrir) => {
      const { estado, custom } = servidorComSessaoVencida();
      const { page, writes } = await abrir({ custom });
      await page.goto(BASE + '/tarefa/' + row.id);
      await salvarComRenovacaoForaDoAr(page, estado);

      // A renovação volta. O novo Salvar: 401 → refresh 200 → refeita 200 → "Salvo."
      estado.renovacaoNoAr = true;
      await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
      await page.getByText('Salvo.', { exact: true }).waitFor({ timeout: 5000 });
      await pause(300);
      assert.deepEqual(estado.respostasDoPatch, [401, 401, 200], 'a segunda tentativa foi renovada e refeita uma vez');
      assert.equal(estado.respostasDoPatch.filter((s) => s === 200).length, 1, 'concluiu UMA vez');
      assert.equal(writes.length, 3);
      assert.ok(
        writes.every((w) => w.url === '/api/board/tasks/' + row.id),
        'todas na mesma tarefa',
      );
      assert.equal(await page.getByText('há alterações por salvar', { exact: true }).count(), 0);
      return `PATCH ${JSON.stringify(estado.respostasDoPatch)}: só a refeita gravou; texto intacto no meio`;
    },
  );

  await cenario(
    'b-aviso',
    'depois de o Salvar concluir, o aviso da renovação (passageiro) sai da tela',
    async (abrir) => {
      const { estado, custom } = servidorComSessaoVencida();
      const { page } = await abrir({ custom });
      await page.goto(BASE + '/tarefa/' + row.id);
      await salvarComRenovacaoForaDoAr(page, estado);
      estado.renovacaoNoAr = true;
      await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
      await page.getByText('Salvo.', { exact: true }).waitFor({ timeout: 5000 });
      await pause(300);
      assert.equal(
        await page.getByText('Não foi possível renovar agora', { exact: false }).count(),
        0,
        'o aviso passageiro foi embora',
      );
    },
  );

  await cenario(
    'c',
    '250 pendentes em 3 páginas → abrir a tarefa 150 → X → 200 linhas relidas e rolagem restaurada',
    async (abrir) => {
      const { page, pedidos } = await abrir({
        custom: servidorPaginado(async (url) => {
          if (url.pathname === '/api/board/my-tasks') await pause(300);
          return null;
        }),
      });
      await page.goto(BASE + '/meu-trabalho');
      await page.getByRole('tab', { name: /^Pendente\s*250$/ }).waitFor();
      await page.getByRole('button', { name: 'Carregar mais', exact: true }).click();
      await page.locator('.mt-corte', { hasText: '200 de 250' }).waitFor();
      const link = page.getByRole('link', {
        name: 'Pendente 150',
        exact: true,
      });
      await link.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, -120);
      await pause(400);
      const rolagemAntes = await page.evaluate(() => Math.round(window.scrollY));
      assert.ok(rolagemAntes > 0, 'a lista está rolada antes de abrir');
      const nAntes = pedidos.length;
      await link.click();
      await page.waitForURL('**/tarefa/p150');
      await esperarTitulo(page, 'Pendente 150');
      // F43, Fase 7: a ficha abriu ao lado e a lista nem saiu da tela; fechar
      // (o ✕ do painel) relê as MESMAS duas páginas, sem esvaziar a lista.
      await fecharFicha(page).click();
      await page.waitForURL('**/meu-trabalho');
      await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length === 200, null, {
        timeout: 8000,
      });
      await pause(1500);
      assert.deepEqual(
        semEco(pedidos.slice(nAntes)),
        [
          { aba: 'pendente', cursor: null },
          { aba: 'pendente', cursor: 'c1' },
        ],
        'as duas páginas foram relidas',
      );
      assert.equal((await titulos(page)).length, 200);
      const rolagemDepois = await page.evaluate(() => Math.round(window.scrollY));
      const visivel = await page.getByRole('link', { name: 'Pendente 150', exact: true }).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      });
      assert.ok(
        Math.abs(rolagemAntes - rolagemDepois) <= 4,
        `rolagem restaurada: antes=${rolagemAntes} depois=${rolagemDepois}`,
      );
      assert.ok(visivel, 'a tarefa 150 está visível ao voltar');
      assert.equal(
        await page.locator('.mt-corte').evaluate((el) =>
          Array.from(el.children)
            .map((c) => c.textContent.trim())
            .join(' '),
        ),
        '200 de 250 Carregar mais',
      );
      return `rolagem ${rolagemAntes} → ${rolagemDepois}; 200 linhas; tarefa 150 visível`;
    },
  );

  return resultados;
}
