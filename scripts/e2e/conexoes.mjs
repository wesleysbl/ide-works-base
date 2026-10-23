/**
 * A TELA DE CONEXÕES NO NAVEGADOR — F21.5a (cenário herdado da Fase 4).
 *
 * O que estes cenários cobrem, e que nenhum teste de `npm test` consegue
 * cobrir: a suíte desenha no SERVIDOR (`renderToStaticMarkup`), então nenhum
 * `useEffect` roda e nada do que depende de carregar, clicar, confirmar e
 * recarregar existe lá. Aqui existe.
 *
 *   X1  abrir `/conexoes`, escolher um programa e COPIAR a receita — e o texto
 *       copiado é o mesmo que a tela mostra.
 *   X2  ver a cota do dia e o teto vigente, com os números que o servidor
 *       mandou (a tela não recalcula cota).
 *   X3  a cota esgotada é dita como esgotada.
 *   X4  mudar o teto: a janela DIZ O QUE VAI ACONTECER antes de acontecer, e
 *       só depois de salvar é que sai o pedido.
 *   X5  teto zero é dito como suspensão.
 *   X6  renomear: o nome do dono substitui o que o programa do agente declarou.
 *   X7  desfazer um lote: a confirmação diz o que some e o que fica, e é
 *       preciso confirmar na janela; depois, o resultado diz o que voltou por
 *       tipo, o que ficou (com o motivo) e o que não se desfaz (F26.8).
 *   X8  ⚠️ esvaziar o campo do teto NÃO suspende ninguém — vazio é "não mexi".
 *   X9  apagar o nome e salvar dá retorno: a janela diz por que não salvou.
 *   X10 F26.4: as cinco permissões novas aparecem no cartão, e as escritas
 *       novas aparecem no resumo e no histórico com rótulo e com o aviso de
 *       quando o desfazer não devolve a mudança.
 *   X11 F13: a credencial aparece UMA vez (segredo fictício), não vai para o
 *       cofre do navegador nem para o endereço, e fechar devolve o foco ao botão.
 *   X12 F13: revogar mantém a confirmação (recusar não revoga) e o resultado é
 *       dito; a revogada mostra estado e validade separados.
 *   X13 F13: a falha da leitura oferece "Tentar de novo", e tentar funciona.
 *   X14 as datas da conexão (revogada em, até/venceu em, última escrita) são o
 *       dia de SÃO PAULO: o que aconteceu às 22h do dia 20 não vira dia 21.
 *   X15 F44, Fase 9: UM aviso para as conexões autorizadas antes de 09/10 (lista
 *       quais são; a nova e a sem data não entram), dispensável, e dispensado
 *       continua dispensado depois de recarregar.
 *
 * A API é INTERCEPTADA (ver `comum.mjs`): nada toca o banco.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite } from './comum.mjs';

const GRANT = 'aaaaaaa1-aaa1-4aa1-8aa1-aaaaaaaaaaa1';
const TASK = '33333333-3333-4333-8333-333333333333';
const NOME_DECLARADO = 'Suporte oficial';

const conexao = (extra = {}) => ({
  id: GRANT,
  name: NOME_DECLARADO,
  oauthClientId: 'cliente-mcp',
  capabilities: ['tasks:read', 'comments:write'],
  reach: { companies: null, clients: null },
  expiresAt: null,
  revokedAt: null,
  policyVersion: 1,
  live: true,
  dailyWriteLimit: 50,
  usedToday: 3,
  ...extra,
});

const execucao = (id, extra = {}) => ({
  id,
  grantId: GRANT,
  grantName: NOME_DECLARADO,
  operation: 'add_comment',
  targetId: TASK,
  occurredAt: '2026-09-21T12:00:00.000Z',
  origin: 'http',
  active: true,
  undoneAt: null,
  result: { commentId: `c-${id}` },
  actedAs: { integrationName: NOME_DECLARADO },
  commentId: `c-${id}`,
  ...extra,
});

/** Abre `/conexoes` com uma conexão viva e três escritas no ledger. */
async function abrirTela(
  abrir,
  {
    conexoes = [conexao()],
    pedidos = [],
    execucoes = [execucao('e1'), execucao('e2'), execucao('e3')],
  } = {},
) {
  const state = await abrir({
    custom: (url, req) => {
      const p = url.pathname;
      if (p === '/api/integrations/v1/connections' && req.method() === 'GET') {
        return {
          body: {
            ok: true,
            connections: conexoes,
            dayResetsAt: '2026-09-22T03:00:00.000Z',
          },
        };
      }
      if (p === '/api/integrations/v1/connections/executions') {
        return { body: { ok: true, executions: execucoes } };
      }
      if (p === `/api/integrations/v1/connections/${GRANT}/undo` && req.method() === 'POST') {
        pedidos.push({ rota: 'undo', corpo: req.postDataJSON() ?? {} });
        return {
          body: {
            ok: true,
            grantId: GRANT,
            undoneAt: '2026-09-21T20:00:00.000Z',
            window: { from: null, to: null },
            examined: 3,
            removed: 2,
            kept: 1,
            alreadyGone: 0,
            keptComments: [
              {
                commentId: 'c-alheio',
                executionId: 'e3',
                reason: 'permission_denied',
                message: 'só o autor apaga',
              },
            ],
            // F26.8: cada escrita, da mais nova para a mais antiga.
            items: [
              { executionId: 'e6', operation: 'move_task', targetId: 't1', occurredAt: '2026-09-21T19:00:00.000Z', status: 'not_undoable', reason: 'move', message: 'Movimento de card não se desfaz.' },
              { executionId: 'e5', operation: 'update_task', targetId: 't1', occurredAt: '2026-09-21T18:00:00.000Z', status: 'skipped', reason: 'changed_later', message: 'O prazo: uma pessoa mudou isso depois, e fica como ela deixou.' },
              { executionId: 'e4', operation: 'create_task', targetId: 't1', occurredAt: '2026-09-21T17:00:00.000Z', status: 'undone', reason: null, message: 'Tarefa arquivada.' },
              { executionId: 'e3', operation: 'add_comment', targetId: 't1', occurredAt: '2026-09-21T16:00:00.000Z', status: 'skipped', reason: 'permission_denied', message: 'só o autor apaga' },
              { executionId: 'e2', operation: 'add_comment', targetId: 't1', occurredAt: '2026-09-21T15:00:00.000Z', status: 'undone', reason: null, message: 'Comentário apagado da conversa.' },
              { executionId: 'e1', operation: 'add_comment', targetId: 't1', occurredAt: '2026-09-21T14:00:00.000Z', status: 'undone', reason: null, message: 'Comentário apagado da conversa.' },
            ],
            undone: 3,
            skipped: 2,
            notUndoable: 1,
          },
        };
      }
      if (p === `/api/integrations/v1/connections/${GRANT}/credentials` && req.method() === 'POST') {
        pedidos.push({ rota: 'credentials', corpo: {} });
        // FICTÍCIO e com cara de tarja: não vale em lugar nenhum.
        return { body: { secret: 'iwk_teste_ficticio_0000000000', credentialId: 'cr-1', grantId: GRANT } };
      }
      if (p === `/api/integrations/v1/connections/${GRANT}/revoke` && req.method() === 'POST') {
        pedidos.push({ rota: 'revoke', corpo: {} });
        return { body: { ok: true, id: GRANT, revokedAt: '2026-09-21T20:00:00.000Z' } };
      }
      if (p === `/api/integrations/v1/connections/${GRANT}` && req.method() === 'PATCH') {
        const corpo = req.postDataJSON() ?? {};
        pedidos.push({ rota: 'patch', corpo });
        return {
          body: {
            ok: true,
            connection: conexao({
              name: corpo.name ?? NOME_DECLARADO,
              dailyWriteLimit: corpo.dailyWriteLimit ?? 50,
            }),
            dayResetsAt: '2026-09-22T03:00:00.000Z',
          },
        };
      }
      return null;
    },
  });
  // A área de transferência do Chrome sem permissão lança; a tela já trata
  // isso em silêncio. Aqui a troca é para PROVAR o texto copiado.
  await state.page.addInitScript(() => {
    window.copiado = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t) => { window.copiado.push(t); } },
    });
  });
  await state.page.goto(BASE + '/conexoes');
  // F29.5b: a tela se chama "Agentes de IA", como o item do menu da conta que
  // leva a ela. O mesmo `heading` exato — só o nome mudou.
  await state.page.getByRole('heading', { name: 'Agentes de IA', exact: true }).waitFor();
  return state;
}

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('X1', 'escolher um programa e copiar a receita dele', async (abrir) => {
    const { page, erros } = await abrirTela(abrir);
    await page.getByText('Conectar um agente', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'Claude Code (terminal)', exact: true }).click();
    const bloco = page.locator('pre').first();
    const mostrado = (await bloco.textContent()).trim();
    assert.ok(mostrado.length > 0, 'a receita mostra um texto para copiar');

    await page.getByRole('button', { name: 'Copiar', exact: true }).first().click();
    const copiado = await page.evaluate(() => window.copiado);
    assert.equal(copiado.length, 1);
    assert.equal(copiado[0].trim(), mostrado, 'o texto copiado é o que a tela mostra');
    assert.deepEqual(erros, []);
  });

  await cenario('X2', 'a tela mostra a cota do dia, o teto e o que o agente já fez', async (abrir) => {
    const { page, erros } = await abrirTela(abrir);
    await page.getByText('3 de 50 hoje', { exact: true }).waitFor();
    const resumo = await page.getByText(/Já fez:/).first().textContent();
    assert.match(resumo, /3 comentário\(s\)/);
    assert.deepEqual(erros, []);
  });

  await cenario('X3', 'a cota esgotada aparece como esgotada, e não como número qualquer', async (abrir) => {
    const { page } = await abrirTela(abrir, { conexoes: [conexao({ usedToday: 50 })] });
    await page.getByText('50 de 50 hoje', { exact: true }).waitFor();
    await page.getByText(/Cota do dia esgotada/).waitFor();
  });

  await cenario('X4', 'mudar o teto: a janela diz o que vai acontecer ANTES de salvar', async (abrir) => {
    const pedidos = [];
    const { page, erros } = await abrirTela(abrir, { pedidos });

    await page.getByRole('button', { name: 'Nome e teto', exact: true }).click();
    const janela = page.getByRole('dialog', { name: 'Nome e teto da conexão' });
    await janela.waitFor();

    await janela.getByLabel('Teto diário de escritas', { exact: true }).fill('2');
    await janela.getByText(/O teto passa de 50 para 2/).waitFor();
    // Nada foi pedido ainda: a frase vem ANTES da ação.
    assert.deepEqual(pedidos, []);

    await janela.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText(/o teto agora é de 2 escrita\(s\) por dia/i).waitFor();
    assert.deepEqual(pedidos, [{ rota: 'patch', corpo: { dailyWriteLimit: 2 } }]);
    assert.deepEqual(erros, []);
  });

  await cenario('X5', 'teto zero é dito como suspensão, não como "zero de zero"', async (abrir) => {
    const { page } = await abrirTela(abrir, { conexoes: [conexao({ dailyWriteLimit: 0, usedToday: 0 })] });
    await page.getByText('escritas suspensas', { exact: true }).waitFor();
    await page.getByText(/o agente lê, mas não escreve/).waitFor();
  });

  await cenario('X6', 'renomear: o nome do dono substitui o que o programa declarou', async (abrir) => {
    const pedidos = [];
    const { page, erros } = await abrirTela(abrir, { pedidos });
    await page.getByRole('heading', { name: NOME_DECLARADO, exact: true }).waitFor();

    await page.getByRole('button', { name: 'Nome e teto', exact: true }).click();
    const janela = page.getByRole('dialog', { name: 'Nome e teto da conexão' });
    await janela.getByLabel('Nome da conexão', { exact: true }).fill('Agente do Wesley');
    await janela.getByText(/passa a aparecer como «Agente do Wesley»/).waitFor();
    await janela.getByRole('button', { name: 'Salvar', exact: true }).click();

    await page.getByText(/passou a se chamar «Agente do Wesley»/).waitFor();
    assert.deepEqual(pedidos, [{ rota: 'patch', corpo: { name: 'Agente do Wesley' } }]);
    assert.deepEqual(erros, []);
  });

  await cenario('X7', 'desfazer um lote exige confirmar na janela, que diz o que some', async (abrir) => {
    const pedidos = [];
    const { page, erros } = await abrirTela(abrir, { pedidos });

    // Primeiro: recusar na janela não desfaz nada.
    let texto = null;
    const recusar = async (d) => { texto = d.message(); await d.dismiss(); };
    page.on('dialog', recusar);
    await page.getByRole('button', { name: 'Desfazer escritas', exact: true }).click();
    await page.waitForTimeout(200);
    assert.match(texto, /ser(ão|ao) APAGADOS/);
    assert.match(texto, /3 aparece\(m\)/);
    assert.match(texto, /não tem volta/);
    assert.deepEqual(pedidos, [], 'recusar na janela não desfaz nada');

    page.off('dialog', recusar);
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Desfazer escritas', exact: true }).click();
    // F26.8: o resultado diz o que voltou por tipo, o que ficou com o motivo
    // do servidor, e o que não se desfaz.
    await page.getByText('Desfeito: 2 comentário(s) apagado(s), 1 tarefa(s) arquivada(s).', { exact: true }).waitFor();
    await page.getByText('Ficaram como estão (2):').waitFor();
    await page.getByText('Tarefa editada — O prazo: uma pessoa mudou isso depois, e fica como ela deixou.').waitFor();
    await page.getByText('Comentário — só o autor apaga').waitFor();
    await page.getByText(/Não se desfaz: 1 movimento\(s\)/).waitFor();
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0].rota, 'undo');
    assert.deepEqual(erros, []);
  });

  await cenario('X8', '⚠️ esvaziar o campo do teto não suspende o agente', async (abrir) => {
    const pedidos = [];
    const { page, erros } = await abrirTela(abrir, { pedidos });

    await page.getByRole('button', { name: 'Nome e teto', exact: true }).click();
    const janela = page.getByRole('dialog', { name: 'Nome e teto da conexão' });
    await janela.getByLabel('Teto diário de escritas', { exact: true }).fill('');
    // `Number('')` é 0, e zero suspende: a frase NÃO pode anunciar suspensão.
    await janela.getByText('Nada muda: os dois campos estão como já estavam.', { exact: true }).waitFor();

    await janela.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Nada mudou: os dois campos estavam como já estavam.', { exact: true }).waitFor();
    assert.deepEqual(pedidos, [], 'campo vazio não pede mudança nenhuma');

    // E zero DIGITADO continua suspendendo: a suspensão é decisão, não descuido.
    await page.getByRole('button', { name: 'Nome e teto', exact: true }).click();
    await janela.getByLabel('Teto diário de escritas', { exact: true }).fill('0');
    await janela.getByText(/O teto passa de 50 para 0/).waitFor();
    await janela.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText(/o teto agora é de 0 escrita\(s\) por dia/i).waitFor();
    assert.deepEqual(pedidos, [{ rota: 'patch', corpo: { dailyWriteLimit: 0 } }]);
    assert.deepEqual(erros, []);
  });

  await cenario('X9', 'apagar o nome e salvar dá retorno, em vez de fechar calado', async (abrir) => {
    const pedidos = [];
    const { page, erros } = await abrirTela(abrir, { pedidos });

    await page.getByRole('button', { name: 'Nome e teto', exact: true }).click();
    const janela = page.getByRole('dialog', { name: 'Nome e teto da conexão' });
    await janela.getByLabel('Nome da conexão', { exact: true }).fill('   ');
    await janela.getByText(/O nome não pode ficar vazio/).waitFor();

    await janela.getByRole('button', { name: 'Salvar', exact: true }).click();
    // A janela CONTINUA ABERTA, dizendo por quê — e nada foi pedido.
    await janela.waitFor();
    assert.equal(await janela.getByText(/O nome não pode ficar vazio/).count() > 0, true);
    assert.deepEqual(pedidos, []);
    assert.deepEqual(erros, []);
  });

  await cenario('X10', 'F26.4: permissões e escritas novas com rótulo e aviso do desfazer', async (abrir) => {
    const novas = [
      'tasks:read',
      'boards:read',
      'clients:read',
      'tasks:write',
      'tasks:assign',
      'tasks:complete',
      'clients:mural:write',
      'clients:history:write',
    ];
    const { page, erros } = await abrirTela(abrir, {
      conexoes: [conexao({ capabilities: novas })],
      execucoes: [
        execucao('n1', { operation: 'create_task', commentId: null }),
        execucao('n2', { operation: 'assign_task', commentId: null }),
        execucao('n3', { operation: 'update_mural_note', commentId: null }),
        execucao('n4', { operation: 'update_task', commentId: null }),
        execucao('n5', { operation: 'add_history_entry', commentId: null }),
      ],
    });
    for (const selo of [
      'criar e editar tarefas',
      'definir responsáveis',
      'concluir e reabrir',
      'escrever no mural',
      'registrar no histórico',
    ]) {
      await page.getByText(selo, { exact: true }).waitFor();
    }
    // Nome técnico não aparece cru no cartão.
    assert.equal(await page.getByText('tasks:write', { exact: true }).count(), 0);

    const resumo = await page.getByText(/Já fez:/).first().textContent();
    assert.match(resumo, /1 tarefa\(s\) criada\(s\)/);
    assert.match(resumo, /1 troca\(s\) de responsáveis/);
    assert.match(resumo, /1 nota\(s\) do mural editada\(s\)/);

    for (const rotulo of [
      'tarefa criada',
      'responsáveis definidos',
      'nota do mural editada',
      'tarefa editada',
      'registro no histórico',
    ]) {
      await page.getByText(rotulo, { exact: true }).waitFor();
    }
    assert.equal(await page.getByText('não se desfaz', { exact: true }).count(), 1);
    assert.equal(await page.getByText('texto não se desfaz', { exact: true }).count(), 1);
    assert.deepEqual(erros, []);
  });

  await cenario('X11', 'F13: a credencial aparece uma vez, fora do cofre do navegador, e fechar devolve o foco', async (abrir) => {
    const pedidos = [];
    const { page, erros } = await abrirTela(abrir, { pedidos });
    const botao = page.getByRole('button', { name: 'Emitir / rotacionar credencial', exact: true });
    await botao.click();
    const janela = page.getByRole('dialog', { name: 'Credencial de automação' });
    await janela.getByText('iwk_teste_ficticio_0000000000', { exact: true }).waitFor();
    await janela.getByText(/não será mostrado de novo/).waitFor();
    const cofre = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, u: location.href }));
    assert.ok(!cofre.includes('iwk_teste'), 'o segredo não vai para o cofre nem para o endereço');
    await janela.getByRole('button', { name: 'Copiar segredo', exact: true }).click();
    await janela.getByRole('button', { name: 'Copiado', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.copiado), ['iwk_teste_ficticio_0000000000']);
    await janela.getByRole('button', { name: 'Fechar', exact: true }).last().click();
    await janela.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Emitir / rotacionar credencial');
    assert.equal(await page.getByText('iwk_teste', { exact: false }).count(), 0, 'fechada, o segredo sai da tela');
    assert.deepEqual(pedidos, [{ rota: 'credentials', corpo: {} }]);
    assert.deepEqual(erros, []);
  });

  await cenario('X12', 'F13: revogar mantém a confirmação e diz o resultado; revogada tem estado e validade próprios', async (abrir) => {
    const pedidos = [];
    const { page } = await abrirTela(abrir, { pedidos });
    await page.locator('.ad-conexao').getByText('ativa', { exact: true }).waitFor();
    await page.locator('.ad-conexao').getByText('sem prazo', { exact: true }).waitFor();
    let texto = '';
    const recusar = async (d) => { texto = d.message(); await d.dismiss(); };
    page.on('dialog', recusar);
    await page.getByRole('button', { name: 'Revogar', exact: true }).click();
    await page.waitForTimeout(200);
    assert.match(texto, /Chamadas novas do agente passam a ser recusadas/);
    assert.deepEqual(pedidos, [], 'recusar a confirmação não revoga');
    page.off('dialog', recusar);
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Revogar', exact: true }).click();
    await page.getByRole('status').getByText(/revogada: chamadas novas do agente são recusadas/).waitFor();
    assert.deepEqual(pedidos, [{ rota: 'revoke', corpo: {} }]);

    // A revogada: estado no selo, e a data em que parou na validade.
    const { page: p2 } = await abrirTela(abrir, {
      conexoes: [conexao({ live: false, revokedAt: '2026-09-20T10:00:00.000Z' })],
    });
    const cartao = p2.locator('.ad-conexao');
    await cartao.getByText('revogada', { exact: true }).waitFor();
    await cartao.getByText('revogada em 20/09/2026', { exact: true }).waitFor();
    assert.equal(await cartao.getByRole('button', { name: 'Revogar', exact: true }).isDisabled(), true);
    assert.equal(await cartao.getByRole('button', { name: 'Credencial indisponível', exact: true }).isDisabled(), true);
  });

  await cenario('X13', 'F13: a falha da leitura oferece Tentar de novo, e tentar funciona', async (abrir) => {
    let falhar = true;
    const state = await abrir({
      custom: (url, req) => {
        if (url.pathname === '/api/integrations/v1/connections' && req.method() === 'GET') {
          if (falhar) return { status: 500, body: { ok: false, message: 'Falha passageira ao ler as conexões.' } };
          return { body: { ok: true, connections: [conexao()], dayResetsAt: '2026-09-22T03:00:00.000Z' } };
        }
        return null;
      },
    });
    await state.page.goto(BASE + '/conexoes');
    await state.page.getByRole('alert').getByText('Falha passageira ao ler as conexões.').waitFor();
    falhar = false;
    await state.page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await state.page.getByRole('heading', { name: NOME_DECLARADO, exact: true }).waitFor();
    assert.equal(await state.page.getByText('Falha passageira ao ler as conexões.').count(), 0, 'a falha saiu');
  });

  await cenario('X14', 'as datas da conexão são as de São Paulo: 22h30 do dia 20 não vira dia 21', async (abrir) => {
    // 20/09 às 22h30 em Brasília = 21/09 às 01h30 em UTC. O corte do texto por
    // posição (`slice(0, 10)`) dizia 21/09.
    const { page: p1 } = await abrirTela(abrir, {
      conexoes: [conexao({ live: false, revokedAt: '2026-09-21T01:30:00.000Z' })],
    });
    await p1.locator('.ad-conexao').getByText('revogada em 20/09/2026', { exact: true }).waitFor();

    // A validade: vence às 22h do dia 30/09 (01h do dia 1º em UTC).
    const { page: p2 } = await abrirTela(abrir, {
      conexoes: [conexao({ expiresAt: '2026-10-01T01:00:00.000Z' })],
    });
    await p2.locator('.ad-conexao').getByText('até 30/09/2026', { exact: true }).waitFor();

    // A última escrita, no resumo do cartão e na linha do histórico: 31/10 às
    // 22h30 (01/11 em UTC) — no último dia do mês, o dia UTC é do mês seguinte.
    const { page: p3 } = await abrirTela(abrir, {
      execucoes: [execucao('n1', { occurredAt: '2026-11-01T01:30:00.000Z' })],
    });
    const resumo = await p3.getByText(/Já fez:/).first().textContent();
    assert.match(resumo, /a última em 31\/10\/2026/);
    await p3.getByText('31/10/2026', { exact: true }).waitFor();
    assert.equal(await p3.getByText('01/11/2026').count(), 0, 'nenhuma data do mês seguinte');
  });

  await cenario('X15', 'F44.9: um aviso só para as conexões antigas; dispensar vale depois de recarregar', async (abrir) => {
    const { page } = await abrirTela(abrir, {
      conexoes: [
        conexao({ authorizedAt: '2026-09-22T12:00:00.000Z' }),
        conexao({ id: 'bbbbbbb2-bbb2-4bb2-8bb2-bbbbbbbbbbb2', name: 'Agente novo', authorizedAt: '2026-10-09T15:00:00.000Z' }),
      ],
    });
    const aviso = page.locator('[data-aviso="conexoes-antigas"]');
    await aviso.waitFor();
    assert.equal(await aviso.count(), 1, 'um aviso só, e não um por conexão');
    const texto = await aviso.textContent();
    assert.match(texto, /Uma conexão foi autorizada antes de 09\/10/);
    assert.match(texto, /plano, renovação, cota e etiquetas/);
    assert.match(texto, /revise ou reconecte/);
    assert.ok(texto.includes(NOME_DECLARADO), 'lista a conexão antiga');
    assert.ok(!texto.includes('Agente novo'), 'a conexão nova não entra na lista');

    await aviso.getByRole('button', { name: 'Entendi, dispensar', exact: true }).click();
    assert.equal(await aviso.count(), 0, 'dispensado some');
    await page.reload();
    await page.getByRole('heading', { name: 'Agentes de IA', exact: true }).waitFor();
    await page.locator('.ad-conexao').first().waitFor();
    assert.equal(await page.locator('[data-aviso="conexoes-antigas"]').count(), 0, 'continua dispensado ao recarregar');

    // Sem data (servidor antigo) ou só conexões novas: nada de aviso.
    const { page: p2 } = await abrirTela(abrir, { conexoes: [conexao({ authorizedAt: '2026-10-10T00:00:00.000Z' }), conexao({ id: 'ccccccc3-ccc3-4cc3-8cc3-ccccccccccc3' })] });
    await p2.locator('.ad-conexao').first().waitFor();
    assert.equal(await p2.locator('[data-aviso="conexoes-antigas"]').count(), 0, 'sem antigas, sem aviso');
  });

  return resultados;
}
