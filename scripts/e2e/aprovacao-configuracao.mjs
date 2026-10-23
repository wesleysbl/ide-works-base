/**
 * A CONFIGURAÇÃO DA APROVAÇÃO DO CLIENTE — F42, Fase 3, no Chrome real (API simulada).
 *
 * O servidor aqui é FICTÍCIO e tem estado: ele imita as regras das rotas de
 * verdade que importam para a tela — um link vivo por cliente; gerar de novo
 * revoga o anterior; `GET /api/public/aprovacao/<token>` responde 404 para o
 * token revogado (ou de cliente desligado) e 200 para o vivo; não-admin leva
 * 403 com a frase do servidor. Nada chega ao banco. As regras do servidor e do
 * banco de verdade estão provadas em `test/aprovacao-rotas.test.ts` e
 * `src/server/aprovacao-config-banco.test.ts`.
 *
 *   AC1  ficha do cliente (admin): liga "Aprovação externa", gera o link, gera
 *        de novo (com a confirmação "o link antigo para de funcionar agora") e
 *        o primeiro passa a responder 404 na rota pública; o novo, 200;
 *        "Copiar link" devolve o vivo;
 *   AC2  esteira: o menu da lista abre "Aprovação do cliente…", o desenho diz
 *        "falta escolher"; escolhe as três etapas, salva, RECARREGA a página,
 *        reabre — as três etapas escolhidas estão lá e a situação é completa;
 *   AC3  quem não administra: a ficha não mostra o bloco; a caixa da esteira
 *        mostra a recusa 403 do servidor;
 *   AC4  320 px: a ficha com o bloco aberto e a caixa da esteira sem rolagem
 *        lateral.
 *
 * `APROVACAO_CAPTURAS=<pasta>` grava as telas de AC1, AC2 e AC4.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, sessaoDe } from './comum.mjs';
import { comFichas } from './cliente-ux.mjs';
import { F6C, F6C_ETAPAS, f6cServidor } from './dados-f06c.mjs';

const CLIENTE = 'cx-1';
const NOME_DO_CLIENTE = 'Horizonte Studio';
const SO_ADMIN = 'Só administrador configura a aprovação do cliente.';

/** 43 caracteres base64url, como o token de verdade. */
const novoToken = (n) => `tok${String(n).padStart(4, '0')}`.padEnd(43, 'x');

function servidorDaAprovacao({ admin = true } = {}) {
  const estado = {
    enabled: false,
    links: [], // { token, revogado }
    alvos: { awaitingStatusId: null, approvedStatusId: null, rejectedStatusId: null },
    escritas: [],
    gerados: 0,
  };
  const vivo = () => estado.links.find((l) => !l.revogado) ?? null;
  const aprovacao = () => ({
    clientId: CLIENTE,
    enabled: estado.enabled,
    active: true,
    link: vivo() ? { createdAt: '2026-10-07T18:00:00Z' } : null,
  });
  const destinos = () => ({
    listId: F6C.lista,
    statusSetId: 'set-f6c',
    statusSetName: 'Fluxo de aprovação',
    inheritedFrom: 'list',
    statuses: F6C_ETAPAS.map(({ id, name, type, color }) => ({ id, name, type, color })),
    targets: { ...estado.alvos },
    complete: Object.values(estado.alvos).every((v) => v !== null),
  });
  const negar = { status: 403, body: { message: SO_ADMIN } };

  const custom = (url, req) => {
    const p = url.pathname;
    const metodo = req.method();
    if (p === '/api/auth/me') return { body: { ...sessaoDe(), isSuperadmin: admin, isSuper: admin, papel: admin ? 'super_admin' : 'funcionario', areas: ['entrega', 'quadro'] } };

    const publica = /^\/api\/public\/aprovacao\/([^/]+)$/.exec(p);
    if (publica && metodo === 'GET') {
      const l = estado.links.find((x) => x.token === publica[1]);
      return l && !l.revogado && estado.enabled
        ? { body: { ok: true, cliente: null, chamadas: [] } }
        : { status: 404, body: { message: 'Link inválido ou desativado.' } };
    }

    if (p === `/api/clients/${CLIENTE}/approval`) {
      if (!admin) return negar;
      if (metodo === 'POST') {
        const b = req.postDataJSON();
        estado.escritas.push({ p, b });
        estado.enabled = b.enabled;
      }
      return { body: { ok: true, approval: aprovacao() } };
    }
    if (p === `/api/clients/${CLIENTE}/approval/link`) {
      if (!admin) return negar;
      if (metodo === 'GET') {
        const l = vivo();
        return l
          ? { body: { ok: true, url: `${BASE}/aprovar/${l.token}`, createdAt: '2026-10-07T18:00:00Z' } }
          : { status: 404, body: { message: 'Este cliente ainda não tem link. Gere um link primeiro.' } };
      }
      if (metodo === 'POST') {
        estado.escritas.push({ p, b: null });
        const antes = estado.links.filter((l) => !l.revogado);
        for (const l of antes) l.revogado = true;
        const token = novoToken(++estado.gerados);
        estado.links.push({ token, revogado: false });
        return { status: 201, body: { ok: true, url: `${BASE}/aprovar/${token}`, createdAt: '2026-10-07T18:00:00Z', revoked: antes.length } };
      }
    }
    if (p === `/api/board/lists/${F6C.lista}/approval-targets`) {
      if (!admin) return negar;
      if (metodo === 'PUT') {
        const b = req.postDataJSON();
        estado.escritas.push({ p, b });
        estado.alvos = { awaitingStatusId: b.awaitingStatusId, approvedStatusId: b.approvedStatusId, rejectedStatusId: b.rejectedStatusId };
      }
      return { body: { ok: true, approval: destinos() } };
    }
    return null;
  };

  return { estado, custom };
}

/** O servidor inteiro: aprovação, depois as fichas do cliente e o quadro F06C. */
function servidor(opcoes) {
  const a = servidorDaAprovacao(opcoes);
  const fichas = comFichas();
  const quadro = f6cServidor();
  return {
    estado: a.estado,
    custom: async (url, req) => a.custom(url, req) ?? (await fichas(url, req)) ?? quadro(url, req),
  };
}

const CAPTURAS = process.env.APROVACAO_CAPTURAS;
const capturar = async (page, nome) => {
  if (CAPTURAS) await page.waitForTimeout(600);
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${nome}.png`, fullPage: false });
};

const semRolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function abrirDadosDoCliente(page) {
  await page.goto(`${BASE}/cliente/${CLIENTE}`);
  await page.waitForFunction((n) => document.querySelector('h1')?.textContent?.trim() === n, NOME_DO_CLIENTE, { timeout: 10000 });
  await page.locator('.cl-dados-alternar:visible, .cl-dados-botao:visible').first().click();
}

const statusDaPublica = (page, token) =>
  page.evaluate(async (t) => (await fetch(`/api/public/aprovacao/${t}`)).status, token);

async function abrirCaixaDaEsteira(page, { gaveta = false } = {}) {
  // No celular a árvore mora na gaveta "Listas e atalhos".
  if (gaveta) {
    await page.getByRole('button', { name: 'Listas e atalhos' }).click();
    await page.locator('.bl-barra[data-gaveta="aberta"]').waitFor();
  }
  const acao = page.getByRole('button', { name: 'Ações de Conteúdo mensal', exact: true });
  await acao.waitFor();
  await page.locator('.cu-no').filter({ has: acao }).hover();
  await acao.click();
  await page.getByRole('menuitemcheckbox', { name: 'Aprovação do cliente…', exact: true }).click();
  return page.locator('[data-aprovacao-esteira]');
}

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('AC1', 'admin liga o cliente, gera o link, gera de novo e o primeiro passa a responder 404', async (abrir) => {
    const s = servidor();
    const { page, context } = await abrir({ custom: s.custom });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
    await abrirDadosDoCliente(page);
    const bloco = page.locator('[data-aprovacao-cliente]');
    await bloco.waitFor();
    await bloco.getByText('desligada', { exact: true }).waitFor();

    // O `<input>` da chave é escondido (desenho do trilho); quem recebe o toque é o rótulo.
    await bloco.locator('label.o-chave').click();
    await bloco.getByText('ligada', { exact: true }).waitFor();
    assert.deepEqual(s.estado.escritas[0], { p: `/api/clients/${CLIENTE}/approval`, b: { enabled: true } });

    await bloco.getByRole('button', { name: 'Gerar link', exact: true }).click();
    const campo = bloco.getByRole('textbox', { name: 'Link de aprovação do cliente' });
    await campo.waitFor();
    const primeiro = (await campo.inputValue()).split('/aprovar/')[1];
    assert.equal(primeiro, s.estado.links[0].token);
    assert.equal(await statusDaPublica(page, primeiro), 200, 'o primeiro link abre');

    await bloco.getByRole('button', { name: 'Gerar novo link', exact: true }).click();
    await bloco.getByText('O link antigo para de funcionar agora.', { exact: false }).waitFor();
    assert.equal(s.estado.gerados, 1, 'pedir novo não gera antes de confirmar');
    await bloco.getByRole('button', { name: 'Sim, gerar novo link', exact: true }).click();
    await page.waitForFunction(
      (antes) => !document.querySelector('[aria-label="Link de aprovação do cliente"]')?.value.endsWith(antes),
      primeiro,
    );
    const segundo = (await campo.inputValue()).split('/aprovar/')[1];
    assert.notEqual(segundo, primeiro);
    assert.equal(await statusDaPublica(page, primeiro), 404, 'o link antigo morreu');
    assert.equal(await statusDaPublica(page, segundo), 200, 'o novo abre');

    // Copiar devolve o vivo.
    await bloco.getByRole('button', { name: 'Copiar link', exact: true }).click();
    await bloco.locator('[role="status"]').waitFor();
    assert.equal((await campo.inputValue()).split('/aprovar/')[1], segundo);
    await bloco.scrollIntoViewIfNeeded();
    await capturar(page, 'ac1-ficha');
    return `1º ${primeiro.slice(0, 7)}… → 404; 2º ${segundo.slice(0, 7)}… → 200`;
  });

  await cenario('AC2', 'esteira: escolhe as três etapas, salva, recarrega e as três continuam lá', async (abrir) => {
    const s = servidor();
    const { page } = await abrir({ custom: s.custom });
    await page.goto(`${BASE}/quadro/${F6C.lista}`);
    let caixa = await abrirCaixaDaEsteira(page);
    await caixa.waitFor();
    assert.equal(await caixa.getAttribute('data-situacao'), 'vazia');
    assert.equal(await caixa.getByText('falta escolher', { exact: true }).count(), 3);
    // F42, Fase 4: em 1440×900 o "Salvar destinos" fica à vista sem rolar o balão.
    const salvarAVista = await caixa.getByRole('button', { name: 'Salvar destinos', exact: true }).evaluate((b) => {
      const rb = b.getBoundingClientRect();
      const rl = b.closest('.cu-balao').getBoundingClientRect();
      return rb.top >= rl.top && rb.bottom <= rl.bottom + 1 && rb.bottom <= window.innerHeight;
    });
    assert.equal(salvarAVista, true, '"Salvar destinos" à vista no balão, sem rolar');
    await capturar(page, 'ac2-esteira-1440');

    const [aguardando, aprovado, refacao] = [F6C_ETAPAS[2], F6C_ETAPAS[5], F6C_ETAPAS[3]];
    await caixa.getByRole('combobox', { name: 'Etapa de Aguardando cliente' }).selectOption(aguardando.id);
    await caixa.getByRole('combobox', { name: 'Etapa de Aprovado' }).selectOption(aprovado.id);
    await caixa.getByRole('combobox', { name: 'Etapa de Reprovado (refação)' }).selectOption(refacao.id);
    assert.equal(await caixa.getAttribute('data-situacao'), 'completa');
    await caixa.getByRole('button', { name: 'Salvar destinos', exact: true }).click();
    await caixa.getByText('Salvo.', { exact: true }).waitFor();
    assert.deepEqual(s.estado.escritas.at(-1).b, {
      awaitingStatusId: aguardando.id,
      approvedStatusId: aprovado.id,
      rejectedStatusId: refacao.id,
    });

    await page.reload();
    caixa = await abrirCaixaDaEsteira(page);
    await caixa.waitFor();
    assert.equal(await caixa.getAttribute('data-situacao'), 'completa');
    assert.equal(await caixa.getByRole('combobox', { name: 'Etapa de Aguardando cliente' }).inputValue(), aguardando.id);
    assert.equal(await caixa.getByRole('combobox', { name: 'Etapa de Aprovado' }).inputValue(), aprovado.id);
    assert.equal(await caixa.getByRole('combobox', { name: 'Etapa de Reprovado (refação)' }).inputValue(), refacao.id);
    const caminho = await caixa.locator('.ap-caminho').innerText();
    for (const e of [aguardando, aprovado, refacao]) assert.ok(caminho.includes(e.name), `o desenho mostra ${e.name}`);
    assert.equal(await caixa.getByText('falta escolher', { exact: true }).count(), 0);
    await capturar(page, 'ac2-esteira');
    return `${aguardando.name} → ${aprovado.name} / ${refacao.name}, depois de recarregar`;
  });

  await cenario('AC3', 'quem não administra: sem bloco na ficha; a caixa da esteira mostra o 403', async (abrir) => {
    const s = servidor({ admin: false });
    const { page } = await abrir({ custom: s.custom });
    await abrirDadosDoCliente(page);
    await page.locator('#cl-dados-painel').waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-aprovacao-cliente]').count(), 0, 'o bloco não aparece');

    await page.goto(`${BASE}/quadro/${F6C.lista}`);
    await abrirCaixaDaEsteira(page);
    await page.locator('.cu-balao[role="dialog"]').getByText(SO_ADMIN, { exact: false }).waitFor();
    assert.equal(s.estado.escritas.length, 0);
    return 'sem bloco; caixa com a frase do 403';
  });

  await cenario('AC4', '320 px: ficha com o bloco e caixa da esteira sem rolagem lateral', async (abrir) => {
    const s = servidor();
    s.estado.enabled = true;
    s.estado.links.push({ token: novoToken(99), revogado: false });
    const { page } = await abrir({ custom: s.custom, viewport: { width: 320, height: 720 } });
    await abrirDadosDoCliente(page);
    const bloco = page.locator('[data-aprovacao-cliente]');
    await bloco.getByRole('button', { name: 'Gerar novo link', exact: true }).click();
    await bloco.getByText('O link antigo para de funcionar agora.', { exact: false }).waitFor();
    await bloco.scrollIntoViewIfNeeded();
    assert.equal(await semRolagemLateral(page), true, 'ficha a 320 sem rolagem lateral');
    const largura = await bloco.evaluate((el) => el.getBoundingClientRect().right);
    assert.ok(largura <= 320, `o bloco cabe (right=${largura})`);
    await capturar(page, 'ac4-ficha-320');

    await page.goto(`${BASE}/quadro/${F6C.lista}`);
    const caixa = await abrirCaixaDaEsteira(page, { gaveta: true });
    await caixa.waitFor();
    assert.equal(await semRolagemLateral(page), true, 'quadro com a caixa a 320 sem rolagem lateral');
    const r = await caixa.evaluate((el) => el.getBoundingClientRect());
    await capturar(page, 'ac4-esteira-320');
    assert.ok(r.left >= 0 && r.right <= 320, `a caixa cabe na tela (left=${r.left}, right=${r.right})`);
    return 'ficha e caixa cabem em 320 px';
  });

  return resultados;
}
