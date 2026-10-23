/**
 * O SELO DE ORIGEM NO NAVEGADOR — F26, fase 9.
 *
 * *"Carla, via ChatGPT"*: a linha foi escrita pela IA que a Carla conectou. A
 * marca vem da própria linha (`via_name`, F26.2), e por isso aparece para
 * qualquer pessoa que enxerga a linha — não só para o dono da conexão, como o
 * selo do comentário.
 *
 * O QUE SE PROVA AQUI
 *   1. A ficha de uma tarefa criada pela IA mostra "via ChatGPT" ao lado de
 *      quem pediu, na linha "criou esta tarefa", e no evento que a IA gerou.
 *   2. A ficha de uma tarefa criada por gente não mostra selo nenhum.
 *   3. O mural e o histórico do cliente mostram "Carla, via Claude" na nota e
 *      no registro da IA, e nada na nota e no registro de gente.
 *
 *   A API é simulada (`comum.mjs`): nada chega ao banco. O desenho de cada
 *   lugar, sem navegador, está em `src/board/tela-do-selo-de-origem.test.ts`.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, detail, row } from './comum.mjs';

/** A ficha simulada, com autor, marca de origem e histórico escolhidos. */
function fichaCom({ createdVia, history = [] }) {
  return (url) => {
    if (!url.pathname.startsWith('/api/board/tasks/')) return null;
    return {
      body: {
        ok: true,
        task: {
          ...detail,
          id: row.id,
          title: row.title,
          createdBy: { id: 'u-carla', name: 'Carla' },
          createdVia,
          history,
        },
        storage: { ready: false, variable: '' },
      },
    };
  };
}

const EVENTO_DA_IA = {
  id: '701',
  automationName: null,
  actorName: 'Carla',
  fromListName: null,
  toListName: null,
  fromStatusName: null,
  toStatusName: null,
  removed: [],
  added: ['Ana'],
  occurredAt: '2026-09-22T11:00:00.000Z',
  viaName: 'ChatGPT',
};

/* ───────────────────── o cliente, para o mural e o histórico ───────────────────── */

const CLIENTE = {
  id: 'cli-selo',
  name: 'Clinimax',
  categoryName: 'Ide',
  planName: null,
  urgency: 'paz',
  isActive: true,
  profile: {
    taxId: null,
    companyEmail: null,
    plan: null,
    startedOn: '2025-01-01',
    renewsOn: null,
    phone: null,
    whatsapp: null,
    address: null,
    ownerName: null,
    ownerPhone: null,
    ownerWhatsapp: null,
    notes: null,
    financeOk: true,
    inactiveAt: null,
    links: [],
    tags: [],
    quotas: [],
  },
  neighbors: { previous: null, next: null },
  month: '2026-09-01',
  monthOpened: false,
  planningDoneAt: null,
  clientApprovedAt: null,
  delivery: { measurable: false, reason: 'no_contract', message: 'Mês ainda não aberto.' },
  scheduled: [],
  unscheduled: [],
  monthItems: [],
};

const nota = (p) => ({
  title: null,
  color: 'yellow',
  positionX: 16,
  positionY: 16,
  width: 220,
  height: 160,
  viaName: null,
  viaAuthorName: null,
  ...p,
});

const registro = (p) => ({
  clientId: CLIENTE.id,
  happenedOn: '2026-09-22',
  subtitle: null,
  ledBy: null,
  ledByNote: null,
  createdAt: '2026-09-22T15:00:00.000Z',
  documents: [],
  viaName: null,
  viaAuthorName: null,
  ...p,
});

export function clienteSimulado(url) {
  const p = url.pathname;
  if (p === `/api/clients/${CLIENTE.id}`) return { body: { ok: true, client: CLIENTE } };
  // A ficha do cliente desenha as contas da Meta; sem a forma da rota, ela cai.
  if (p === '/api/meta/accounts') return { body: { ok: true, hasToken: false, accounts: [] } };
  if (p === `/api/clients/${CLIENTE.id}/mural`)
    return {
      body: {
        ok: true,
        notes: [
          nota({ id: 'n-ia', content: 'Nota que a IA escreveu.', viaName: 'Claude', viaAuthorName: 'Carla' }),
          nota({ id: 'n-gente', content: 'Nota que a Ana escreveu.', positionX: 260 }),
        ],
      },
    };
  if (p === `/api/clients/${CLIENTE.id}/history`)
    return {
      body: {
        ok: true,
        events: [
          registro({ id: 'h-ia', title: 'Registro da IA', body: 'Relato ditado ao Claude.', viaName: 'Claude', viaAuthorName: 'Carla' }),
          registro({ id: 'h-gente', title: 'Registro da Ana', body: 'Relato escrito à mão.' }),
        ],
      },
    };
  return null;
}

/** A caixa (nota do mural ou registro do histórico) que contém o texto. */
const caixaCom = (page, seletor, texto) => page.locator(seletor).filter({ hasText: texto }).first();

export default async function rodar(browser) {
  const suite = criarSuite(browser);

  await suite.cenario('S1', 'tarefa criada pela IA: a ficha mostra "via ChatGPT" na criação e no evento', async (abrir) => {
    const { page, erros } = await abrir({ custom: fichaCom({ createdVia: 'ChatGPT', history: [EVENTO_DA_IA] }) });
    await page.goto(BASE + '/tarefa/' + row.id);
    await page.getByText('criou esta tarefa', { exact: true }).waitFor();

    const criacao = page.locator('.c-mudanca').filter({ hasText: 'criou esta tarefa' });
    await criacao.locator('.o-selo', { hasText: 'via ChatGPT' }).waitFor();
    assert.equal(
      await criacao.locator('.o-selo').getAttribute('title'),
      'Escrito pela IA ChatGPT, em nome de Carla',
    );

    const evento = page.locator('.c-mudanca').filter({ hasText: 'adicionou o responsável: Ana' });
    await evento.locator('.o-selo', { hasText: 'via ChatGPT' }).waitFor();
    assert.deepEqual(erros, [], 'sem erro de console');
    return 'criação e evento com o selo';
  });

  await suite.cenario('S2', 'tarefa criada por gente: a ficha não mostra selo nenhum', async (abrir) => {
    const { page, erros } = await abrir({
      custom: fichaCom({ createdVia: null, history: [{ ...EVENTO_DA_IA, viaName: null }] }),
    });
    await page.goto(BASE + '/tarefa/' + row.id);
    await page.getByText('criou esta tarefa', { exact: true }).waitFor();
    await page.getByText('adicionou o responsável: Ana', { exact: true }).waitFor();
    assert.equal(await page.locator('.c-mudanca .o-selo').count(), 0, 'nenhum selo na linha do tempo');
    assert.equal(await page.getByText(/^via /).count(), 0, 'nenhum "via …" na ficha');
    assert.deepEqual(erros, [], 'sem erro de console');
  });

  await suite.cenario('S3', 'mural do cliente: "Carla, via Claude" na nota da IA, nada na nota de gente', async (abrir) => {
    const { page, erros } = await abrir({ custom: clienteSimulado });
    await page.goto(BASE + '/cliente/' + CLIENTE.id);
    await page.getByRole('tab', { name: 'Mural', exact: true }).click();
    const daIa = caixaCom(page, 'div.absolute.rounded-md', 'Carla, via Claude');
    await daIa.waitFor();
    assert.equal(await daIa.locator('textarea').inputValue(), 'Nota que a IA escreveu.');
    const deGente = page.locator('div.absolute.rounded-md').filter({
      has: page.locator('textarea'),
      hasNot: page.locator('.o-selo'),
    });
    assert.equal(await deGente.count(), 1, 'uma nota sem selo');
    assert.equal(await deGente.locator('textarea').inputValue(), 'Nota que a Ana escreveu.');
    assert.equal(await page.locator('.o-selo', { hasText: 'via' }).count(), 1, 'um selo só no mural');
    assert.deepEqual(erros, [], 'sem erro de console');
  });

  await suite.cenario('S4', 'histórico do cliente: "Carla, via Claude" no registro da IA, nada no de gente', async (abrir) => {
    const { page, erros } = await abrir({ custom: clienteSimulado });
    await page.goto(BASE + '/cliente/' + CLIENTE.id);
    await page.getByRole('tab', { name: 'Histórico', exact: true }).click();
    const daIa = caixaCom(page, 'li', 'Registro da IA');
    await daIa.locator('.o-selo', { hasText: 'Carla, via Claude' }).waitFor();
    const deGente = caixaCom(page, 'li', 'Registro da Ana');
    await deGente.waitFor();
    assert.equal(await deGente.locator('.o-selo').count(), 0, 'registro de gente sem selo');
    assert.deepEqual(erros, [], 'sem erro de console');
  });

  return suite.resultados;
}
