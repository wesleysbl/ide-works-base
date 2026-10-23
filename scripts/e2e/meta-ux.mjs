/**
 * A ÁREA META NO NAVEGADOR — F14 do plano UX (Meta, ranking e relatórios).
 *
 * A API é INTERCEPTADA (ver `comum.mjs`): nada toca o banco nem a Meta. As
 * contas, campanhas e criativos são fictícios — nomes inventados, ids que não
 * existem em lugar nenhum —, e as respostas têm a FORMA REAL das rotas
 * (`/meta/accounts`, `/meta-assets/:id/report/paid`, `/meta/ranking`…). As
 * datas são relativas a HOJE, porque a tela abre nos últimos 28 dias do
 * relógio de verdade.
 *
 *   M1  Meta: o resumo e os estados de cada conta — série viva, sem coleta,
 *       falha da última coleta, inativa — ditos em texto, não só em cor.
 *   M2  Meta: filtro sem resultado é filtro, com Limpar; os filtros vão para o
 *       endereço e voltam com o Voltar do navegador (a saída do relatório).
 *   M3  Meta sem nenhuma conta: estado vazio com a saída, sem números zerados.
 *   M4  relatório de anúncios: contexto (cliente, gerenciador, período e a
 *       régua da comparação); zero medido ≠ travessão; a tabela rola na
 *       própria caixa; os gráficos têm a leitura em texto.
 *   M5  relatório de conta SEM COLETA: o estado diz isso e não desenha uma
 *       parede de travessões nem zeros.
 *   M6  relatório do Instagram com DADOS INCOMPLETOS: "há dado em N dos M dias".
 *   M7  mudança de período: a leitura nova vai à API, o contexto e o endereço
 *       mudam juntos; período fora da coleta vira estado com saída.
 *   M8  falha de leitura do relatório: o erro com Tentar de novo, e a repetição
 *       desenha os números (nada de zero enquanto falha).
 *   M9  ranking: a explicação da ordem acompanha a pergunta; custo põe o menor
 *       primeiro e quem não tem resposta no fim; filtros no endereço.
 *   M10 390 px: as três telas cabem sem rolagem lateral; a tabela rola dentro
 *       da própria caixa.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, hojeEmSaoPaulo, pause } from './comum.mjs';

/* ─────────────────────────── o relógio da fixture ─────────────────────────── */

const DIA = 86_400_000;
const isoDia = (t) => new Date(t).toISOString().slice(0, 10);
/** `hoje` em UTC, que é o que `janelaPadrao` das telas usa. */
// O "hoje" é o de São Paulo, como o seletor de período e a janela padrão da
// tela (conferência de 08/10): em UTC, das 21h à meia-noite o M7 falhava.
export const HOJE = () => isoDia(hojeEmSaoPaulo().getTime());
export const DIAS_ATRAS = (n) => isoDia(hojeEmSaoPaulo().getTime() - n * DIA);
/** Os 28 dias que a coleta guarda, do mais antigo ao de hoje. */
export const JANELA = () => Array.from({ length: 28 }, (_, i) => DIAS_ATRAS(27 - i));

/* ─────────────────────────── as contas ─────────────────────────── */

const EMP_IDE = { id: '00000000-0000-4000-8000-0000000000e1', name: 'Ide' };
const EMP_HUB = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Ide Hub' };
const CLI_HORIZONTE = { id: 'cl-horizonte', name: 'Horizonte Studio' };
const CLI_AURORA = { id: 'cl-aurora', name: 'Aurora Mercado' };

const conta = (id, extra) => ({
  id,
  kind: 'ad_account',
  externalId: `act_9000000000${id.length}${id.charCodeAt(1)}`,
  displayName: null,
  businessId: null,
  businessName: null,
  pageId: null,
  pageName: null,
  isActive: true,
  lastSeenAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
  lastError: null,
  client: null,
  empresa: EMP_IDE,
  diasColetados: 28,
  ...extra,
});

export const CONTAS = () => [
  conta('a-horizonte', {
    displayName: 'Horizonte Studio · Anúncios',
    businessId: 'bm-1',
    businessName: 'BM Horizonte',
    client: CLI_HORIZONTE,
  }),
  conta('a-aurora', {
    displayName: 'Aurora Mercado · Anúncios',
    businessId: 'bm-2',
    businessName: 'BM Aurora',
    client: CLI_AURORA,
    lastSeenAt: null,
    diasColetados: 0,
  }),
  conta('a-flores', {
    displayName: 'Casa das Flores · Anúncios',
    businessId: 'bm-1',
    businessName: 'BM Horizonte',
    lastSeenAt: new Date(Date.now() - 3 * DIA).toISOString(),
    lastError: 'A Meta recusou o acesso (código 190): reconecte o usuário do sistema.',
    diasColetados: 12,
  }),
  conta('a-zero', {
    displayName: 'Oficina Norte · Anúncios',
    businessId: 'bm-2',
    businessName: 'BM Aurora',
    empresa: EMP_HUB,
    diasColetados: 28,
  }),
  conta('a-velha', {
    displayName: 'Campanha 2025 (encerrada)',
    businessId: 'bm-2',
    businessName: 'BM Aurora',
    isActive: false,
    lastSeenAt: '2026-03-01T12:00:00.000Z',
    diasColetados: 0,
  }),
  conta('i-horizonte', {
    kind: 'instagram_account',
    externalId: '17841400000000001',
    displayName: '@horizonte.studio',
    pageId: 'pg-1',
    pageName: 'Horizonte Studio',
    client: CLI_HORIZONTE,
    diasColetados: 23,
  }),
  conta('i-aurora', {
    kind: 'instagram_account',
    externalId: '17841400000000002',
    displayName: '@aurora.mercado',
    pageId: null,
    pageName: null,
    lastSeenAt: null,
    diasColetados: 0,
  }),
];

/* ─────────────────────────── as séries ─────────────────────────── */

/**
 * Os dias pagos da Horizonte: duas campanhas. Números inteiros e previsíveis
 * para a prova conferir somas. O dia 3 dias atrás tem gasto ZERO de verdade
 * (a campanha rodou e não gastou); a de vendas nunca mede compra (null).
 */
function diasPagos(assetId) {
  if (assetId === 'a-zero') {
    // Tudo medido e tudo zero: CTR, CPC, CPM e CPA não existem (0/0).
    return JANELA().map((day) => ({
      day, campaignId: 'cz', campaignName: 'Sempre ligada',
      spend: 0, reach: 0, impressions: 0, clicks: 0, linkClicks: 0, conversions: 0, conversionValue: 0,
    }));
  }
  if (assetId !== 'a-horizonte') return [];
  const linhas = [];
  JANELA().forEach((day, i) => {
    const zero = day === DIAS_ATRAS(3);
    linhas.push({
      day, campaignId: 'c-msg', campaignName: 'Conversas · Outubro',
      spend: zero ? 0 : 40 + (i % 5) * 5, reach: 1_000 + i * 10, impressions: 2_000 + i * 20,
      clicks: 30 + (i % 4), linkClicks: 20, conversions: zero ? 0 : 3, conversionValue: null,
    });
    linhas.push({
      day, campaignId: 'c-venda', campaignName: 'Loja · Catálogo',
      spend: 25, reach: 600, impressions: 1_500, clicks: 12, linkClicks: 9, conversions: null, conversionValue: null,
    });
  });
  return linhas;
}

const CAMPANHAS = {
  'a-horizonte': [
    {
      campaignId: 'c-msg', nome: 'Conversas · Outubro', objetivo: 'OUTCOME_MESSAGES', situacao: 'ACTIVE',
      spend: 1_234.5, impressions: 63_560, clicks: 894, linkClicks: 560, alcanceAprox: 31_780, criativos: 3, dias: 28,
      acoes: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: 81 }, { action_type: 'link_click', value: 560 }],
    },
    {
      campaignId: 'c-venda', nome: 'Loja · Catálogo', objetivo: 'OUTCOME_SALES', situacao: 'PAUSED',
      spend: 700, impressions: 42_000, clicks: 336, linkClicks: 252, alcanceAprox: 16_800, criativos: 2, dias: 28,
      // Zero compras MEDIDAS: o custo por compra não existe (e não é zero).
      acoes: [{ action_type: 'omni_purchase', value: 0 }, { action_type: 'link_click', value: 252 }],
    },
    {
      campaignId: 'c-alc', nome: 'Marca · Reconhecimento', objetivo: 'OUTCOME_AWARENESS', situacao: 'ACTIVE',
      spend: null, impressions: null, clicks: null, linkClicks: null, alcanceAprox: null, criativos: 1, dias: 0,
      acoes: [],
    },
  ],
  'a-zero': [
    {
      campaignId: 'cz', nome: 'Sempre ligada', objetivo: 'OUTCOME_TRAFFIC', situacao: 'ACTIVE',
      spend: 0, impressions: 0, clicks: 0, linkClicks: 0, alcanceAprox: 0, criativos: 1, dias: 28,
      acoes: [{ action_type: 'landing_page_view', value: 0 }],
    },
  ],
};

/** O Instagram da Horizonte com CINCO dias sem coleta — dados incompletos. */
function diasOrganicos(assetId) {
  if (assetId !== 'i-horizonte') return [];
  const buracos = new Set([5, 6, 7, 15, 16].map((n) => DIAS_ATRAS(n)));
  return JANELA()
    .filter((day) => !buracos.has(day))
    .map((day, i, todos) => ({
      day, reach: 800 + i * 5, views: 2_400 + i * 10, accountsEngaged: 80, totalInteractions: 120,
      follows: 6, unfollows: 2, profileLinksTaps: i % 3 === 0 ? 0 : 4,
      likes: 90, comments: 12, shares: 8, saves: 10,
      followersTotal: i === todos.length - 1 ? 12_480 : null,
      mediaCount: i === todos.length - 1 ? 342 : null,
    }));
}

/* ─────────────────────────── o ranking ─────────────────────────── */

const criativo = (adId, extra) => ({
  adId, nome: null, campanha: null, objetivo: null, conta: 'Horizonte Studio · Anúncios', gerenciador: 'BM Horizonte',
  miniatura: null, situacao: 'ACTIVE', spend: null, impressions: null, clicks: null, linkClicks: null,
  alcanceAprox: null, dias: 28, acoes: [], ...extra,
});

export const CRIATIVOS = () => [
  criativo('ad-1', {
    nome: 'Vídeo depoimento', campanha: 'Conversas · Outubro', objetivo: 'OUTCOME_MESSAGES',
    spend: 600, impressions: 30_000, clicks: 400, linkClicks: 250, alcanceAprox: 15_000,
    acoes: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: 50 }, { action_type: 'link_click', value: 250 }],
  }),
  criativo('ad-2', {
    nome: 'Carrossel antes e depois', campanha: 'Conversas · Outubro', objetivo: 'OUTCOME_MESSAGES',
    spend: 400, impressions: 20_000, clicks: 300, linkClicks: 200, alcanceAprox: 11_000,
    acoes: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: 25 }, { action_type: 'link_click', value: 200 }],
  }),
  criativo('ad-3', {
    nome: 'Foto da vitrine', campanha: 'Loja · Catálogo', objetivo: 'OUTCOME_SALES', situacao: 'PAUSED',
    spend: 300, impressions: 12_000, clicks: 90, linkClicks: 60, alcanceAprox: 7_000,
    // Zero compras medidas: sem custo por compra (fica no fim do custo).
    acoes: [{ action_type: 'omni_purchase', value: 0 }, { action_type: 'link_click', value: 60 }],
  }),
  criativo('ad-4', {
    nome: 'Reels bastidores', campanha: 'Marca · Reconhecimento', objetivo: 'OUTCOME_AWARENESS',
    spend: 90, impressions: 20_000, clicks: 40, linkClicks: 10, alcanceAprox: 18_000,
    acoes: [{ action_type: 'link_click', value: 10 }],
  }),
  criativo('ad-5', {
    nome: 'Cupom de outubro', campanha: 'Oficina · Tráfego', objetivo: 'OUTCOME_TRAFFIC',
    conta: 'Oficina Norte · Anúncios', gerenciador: 'BM Aurora',
    spend: 0, impressions: 0, clicks: 0, linkClicks: 0, alcanceAprox: 0,
    acoes: [{ action_type: 'landing_page_view', value: 0 }],
  }),
];

/* ─────────────────────────── as rotas ─────────────────────────── */

/**
 * As rotas da Meta com a forma real. `estado.pedidos` guarda cada leitura
 * (rota e parâmetros); `estado.falhas` responde a PRÓXIMA leitura de uma rota
 * com recusa — `{ 'relatorio:a-horizonte': [{ status, message }] }`.
 */
export function rotasDaMeta(estado = {}) {
  const e = {
    contas: CONTAS(),
    criativos: CRIATIVOS(),
    hasToken: true,
    pedidos: [],
    falhas: {},
    ...estado,
  };
  const recusar = (chave) => {
    const fila = e.falhas[chave];
    if (!fila || fila.length === 0) return null;
    const f = fila.shift();
    return { status: f.status ?? 500, body: { ok: false, message: f.message } };
  };
  const noPeriodo = (url) => {
    const de = url.searchParams.get('from') ?? '0000';
    const ate = url.searchParams.get('to') ?? '9999';
    return (d) => d.day >= de && d.day <= ate;
  };

  const handler = (url, req) => {
    const p = url.pathname;
    if (!p.startsWith('/api/meta')) return null;
    e.pedidos.push({ rota: p, de: url.searchParams.get('from'), ate: url.searchParams.get('to'), bm: url.searchParams.get('bm') });

    if (p === '/api/meta/accounts') return { body: { ok: true, hasToken: e.hasToken, accounts: e.contas } };
    if (p === '/api/meta/companies') {
      return {
        body: {
          ok: true, podeEscolher: false,
          empresas: [EMP_IDE, EMP_HUB].map((x) => ({ ...x, secretName: null, contas: 0, configurada: true })),
        },
      };
    }
    if (p === '/api/meta/health') {
      // Uma execução de 5 min atrás: o alarme da coleta fica quieto.
      const t = new Date(Date.now() - 5 * 60e3).toISOString();
      return {
        body: {
          ok: true, hasToken: e.hasToken,
          runs: [{ started_at: t, finished_at: t, outcome: 'ok', assets_total: 7, assets_ok: 7, assets_failed: 0, rows_written: 90, first_error: null }],
        },
      };
    }
    if (p === '/api/meta/ranking') {
      const ate = url.searchParams.get('to') ?? HOJE();
      const bm = url.searchParams.get('bm');
      // Fora da janela da coleta, a Meta não devolve nada.
      const dentro = ate >= DIAS_ATRAS(27);
      const criativos = dentro ? e.criativos.filter((c) => bm === null || c.gerenciador === bm) : [];
      return { body: { ok: true, gerenciadores: ['BM Aurora', 'BM Horizonte'], empresas: [], criativos } };
    }

    const doAtivo = /^\/api\/meta-assets\/([^/]+)\/(report\/paid|report\/organic|media|campaigns)(?:\/([^/]+)\/ads)?$/.exec(p);
    if (doAtivo) {
      const [, id, oque, campanha] = doAtivo;
      const recusa = recusar(`relatorio:${id}`);
      if (recusa && oque !== 'media') return recusa;
      if (oque === 'report/paid') return { body: { ok: true, conta: null, dias: diasPagos(id).filter(noPeriodo(url)) } };
      if (oque === 'report/organic') {
        return { body: { ok: true, conta: null, dias: diasOrganicos(id).filter(noPeriodo(url)), demografia: [], quebras: [] } };
      }
      if (oque === 'media') return { body: { ok: true, publicacoes: [] } };
      if (campanha) return { body: { ok: true, anuncios: [] } };
      const dentro = (url.searchParams.get('to') ?? HOJE()) >= DIAS_ATRAS(27);
      return { body: { ok: true, campanhas: dentro ? (CAMPANHAS[id] ?? []) : [] } };
    }
    return null;
  };
  return { estado: e, handler };
}

/** Uma tela da Meta com as rotas acima. */
export async function abrirMeta(abrir, caminho, { estado, viewport, tema } = {}) {
  const { estado: e, handler } = rotasDaMeta(estado);
  const s = await abrir({ viewport, tema, custom: (url, req) => handler(url, req) });
  await s.page.goto(BASE + caminho);
  return { ...s, estado: e };
}

/**
 * O endereço muda por `replaceState` (sem navegação): espera o texto no
 * `location.search`, e não um evento de carga que não vem.
 */
const noEndereco = (page, trecho) =>
  page.waitForFunction((t) => location.search.includes(t), trecho, { timeout: 15_000 });

const semRolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const leituras = (e, rota) => e.pedidos.filter((p) => p.rota.endsWith(rota));

/* ─────────────────────────── os cenários ─────────────────────────── */

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('M1', 'Meta: resumo e estado de cada conta em texto — série, sem coleta, falha, inativa', async (abrir) => {
    const { page, erros } = await abrirMeta(abrir, '/meta');
    await page.getByRole('heading', { name: 'Meta', exact: true }).waitFor();
    const linha = (nome) => page.getByRole('listitem').filter({ has: page.getByRole('link', { name: nome, exact: true }) });
    await linha('Horizonte Studio · Anúncios').getByText('28 dias de série').waitFor();
    await linha('Aurora Mercado · Anúncios').getByText('Sem coleta', { exact: true }).waitFor();
    // A falha é dita com a frase da Meta, e não só pintada.
    await linha('Casa das Flores · Anúncios').getByText('Última coleta falhou', { exact: false }).waitFor();
    await linha('Casa das Flores · Anúncios').getByText('código 190', { exact: false }).waitFor();
    await linha('Campanha 2025 (encerrada)').getByText('Inativa', { exact: true }).waitFor();
    // O resumo conta as contas que existem; zero não aparece antes de chegar.
    const resumo = await page.locator('.mm-numeros').innerText();
    assert.match(resumo, /Contas de anúncio\s*5/);
    assert.match(resumo, /Perfis do Instagram\s*2/);
    assert.match(resumo, /Com série coletada\s*4/);
    // O cliente é ponte para a ficha.
    assert.equal(await linha('Horizonte Studio · Anúncios').getByRole('link', { name: 'Horizonte Studio', exact: true }).getAttribute('href'), '/cliente/cl-horizonte');
    assert.deepEqual(erros, []);
  });

  await cenario('M2', 'Meta: filtro sem resultado tem Limpar; filtros no endereço voltam com o Voltar', async (abrir) => {
    const { page } = await abrirMeta(abrir, '/meta');
    await page.getByRole('link', { name: 'Horizonte Studio · Anúncios', exact: true }).waitFor();
    await page.getByRole('group', { name: 'Tipo de conta' }).getByRole('button', { name: /Instagram/ }).click();
    await noEndereco(page, 'tipo=instagram');
    await page.getByRole('searchbox', { name: 'Buscar conta, gerenciador, página ou cliente' }).fill('ninguém-tem-este-nome');
    const estado = page.locator('[data-estado="sem-resultado"]');
    await estado.getByText('Nenhuma conta com esses filtros').waitFor();
    await estado.getByRole('button', { name: 'Limpar filtros' }).click();
    await page.getByRole('link', { name: 'Horizonte Studio · Anúncios', exact: true }).waitFor();
    assert.equal(new URL(page.url()).search, '', 'limpar tira os filtros do endereço');

    // Filtrar, abrir um relatório e voltar: o filtro continua.
    await page.getByRole('group', { name: 'Tipo de conta' }).getByRole('button', { name: /Instagram/ }).click();
    await noEndereco(page, 'tipo=instagram');
    await page.getByRole('link', { name: '@horizonte.studio', exact: true }).click();
    await page.getByRole('heading', { name: '@horizonte.studio' }).waitFor();
    await page.goBack();
    await page.getByRole('link', { name: '@horizonte.studio', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Horizonte Studio · Anúncios', exact: true }).count(), 0, 'o filtro Instagram voltou');
    assert.equal(
      await page.getByRole('group', { name: 'Tipo de conta' }).getByRole('button', { name: /Instagram/ }).getAttribute('aria-pressed'),
      'true',
    );
  });

  await cenario('M3', 'Meta sem nenhuma conta: estado vazio com a saída, sem números zerados', async (abrir) => {
    const { page } = await abrirMeta(abrir, '/meta', { estado: { contas: [] } });
    await page.locator('[data-estado="vazio"]').getByText('Nenhuma conta importada').waitFor();
    assert.equal(await page.locator('.mm-numeros').count(), 0, 'sem faixa de números quando não há conta');
    assert.equal(await page.getByRole('searchbox').count(), 0, 'sem filtro para lista que não existe');
  });

  await cenario('M4', 'relatório de anúncios: contexto, zero ≠ travessão, tabela na própria caixa, gráfico com texto', async (abrir) => {
    const { page, erros } = await abrirMeta(abrir, '/meta/a-horizonte');
    await page.getByRole('heading', { name: 'Horizonte Studio · Anúncios' }).waitFor();
    const contexto = page.locator('.mm-contexto');
    await contexto.getByRole('link', { name: 'Horizonte Studio', exact: true }).waitFor();
    const txt = await contexto.innerText();
    assert.match(txt, /BM Horizonte/);
    assert.match(txt, /28 dias/);
    assert.match(txt, /Comparado com/);
    // Os grupos de significado.
    await page.getByRole('heading', { name: 'Investimento e entrega' }).waitFor();
    await page.getByRole('heading', { name: 'Resposta' }).waitFor();
    // Investido = soma dos dias: 27 dias de c-msg (40 + (i%5)*5, um dia zero) + 28 × 25.
    const janela = Array.from({ length: 28 }, (_, i) => i);
    const zeroEm = 24; // DIAS_ATRAS(3) é o índice 24 da janela.
    const gasto = janela.reduce((s, i) => s + (i === zeroEm ? 0 : 40 + (i % 5) * 5), 0) + 28 * 25;
    const esperado = gasto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
    const investido = (await page.getByRole('group', { name: 'Investido' }).innerText()).replace(/\s/g, ' ');
    assert.ok(investido.includes(esperado), `Investido ${investido} ≠ ${esperado}`);
    // Zero medido aparece como zero; custo sem resultado é travessão com o motivo.
    const vendas = page.getByRole('region', { name: /Vendas/ });
    const celulas = await vendas.locator('tbody tr').first().locator('td').allInnerTexts();
    assert.equal(celulas[1].trim(), '0', 'zero compras medidas é 0');
    assert.equal(celulas[2].trim(), '—', 'custo por compra sem compra é travessão');
    // A tabela rola na própria caixa, que é região nomeada e focável.
    const caixa = page.getByRole('region', { name: /Vendas/ });
    assert.equal(await caixa.getAttribute('tabindex'), '0');
    // O gráfico tem leitura em texto (resumo + tabela dos dias).
    const grafico = page.getByRole('img', { name: /Investimento por dia/ });
    await grafico.waitFor();
    await page.getByText('Ver os números de Investimento por dia').first().click();
    const linhas = await page.getByRole('table', { name: 'Investimento por dia' }).locator('tbody tr').count();
    assert.equal(linhas, 28);
    assert.deepEqual(erros, []);
  });

  await cenario('M5', 'relatório de conta sem coleta: o estado diz, sem parede de travessões', async (abrir) => {
    const { page } = await abrirMeta(abrir, '/meta/a-aurora');
    await page.getByRole('heading', { name: 'Aurora Mercado · Anúncios' }).waitFor();
    await page.locator('[data-estado="vazio"]').getByText('Esta conta ainda não tem coleta').waitFor();
    assert.equal(await page.getByRole('group', { name: 'Investido' }).count(), 0, 'sem cartões de número');
    // O contexto continua: cliente e "nunca coletada".
    await page.locator('.mm-contexto').getByText('nunca coletada', { exact: false }).waitFor();
  });

  await cenario('M6', 'Instagram com dados incompletos: "há dado em N dos M dias", médias sobre os dias com dado', async (abrir) => {
    const { page } = await abrirMeta(abrir, '/meta/i-horizonte');
    await page.getByRole('heading', { name: '@horizonte.studio' }).waitFor();
    await page.getByText('Há dado em 23 dos 28 dias do período', { exact: false }).waitFor();
    await page.getByRole('tab', { name: 'Visão geral' }).waitFor();
    // Seguidores é o último total conhecido — não zero, não soma.
    const seg = await page.getByRole('group', { name: 'Seguidores', exact: true }).innerText();
    assert.match(seg, /12\.480/);
    // Toques no link: há dias com 0 medido; a soma continua número, não travessão.
    const toques = await page.getByRole('group', { name: 'Toques no link do perfil' }).innerText();
    assert.match(toques, /\d/);
    // As abas são abas de verdade.
    await page.getByRole('tab', { name: /Conteúdo/ }).click();
    assert.equal(await page.getByRole('tab', { name: /Conteúdo/ }).getAttribute('aria-selected'), 'true');
  });

  await cenario('M7', 'mudança de período: pede o período novo, muda contexto e endereço; fora da coleta vira estado com saída', async (abrir) => {
    const { page, estado } = await abrirMeta(abrir, '/meta/a-horizonte');
    await page.getByRole('heading', { name: 'Resposta' }).waitFor();
    const antes = leituras(estado, '/report/paid').length;
    await page.getByRole('button', { name: /–/ }).first().click();
    await page.getByRole('button', { name: '7d', exact: true }).click();
    await noEndereco(page, `de=${DIAS_ATRAS(6)}`);
    await page.waitForFunction(() => /7 dias/.test(document.querySelector('.mm-contexto')?.textContent ?? ''));
    // As leituras são em sequência (período, régua): espera a régua chegar.
    for (let t = 0; t < 100 && !leituras(estado, '/report/paid').slice(antes).some((p) => p.de === DIAS_ATRAS(13)); t++) await pause(100);
    const novos = leituras(estado, '/report/paid').slice(antes);
    assert.ok(novos.some((p) => p.de === DIAS_ATRAS(6) && p.ate === HOJE()), `pediu o período novo: ${JSON.stringify(novos)}`);
    // A régua da comparação são os 7 dias anteriores.
    assert.ok(novos.some((p) => p.de === DIAS_ATRAS(13) && p.ate === DIAS_ATRAS(7)), 'pediu a régua de comparação');
    // Recarregar mantém o período (está no endereço).
    await page.reload();
    await page.waitForFunction(() => /7 dias/.test(document.querySelector('.mm-contexto')?.textContent ?? ''));

    // Um período antigo, fora da coleta.
    await page.goto(BASE + `/meta/a-horizonte?de=2026-01-01&ate=2026-01-31`);
    const vazio = page.locator('[data-estado="vazio"]');
    await vazio.getByText('Nada coletado neste período').waitFor();
    await vazio.getByRole('button', { name: 'Ver os últimos 28 dias' }).click();
    await page.getByRole('heading', { name: 'Resposta' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('de'), null, 'voltou para a janela padrão');
  });

  await cenario('M8', 'falha de leitura: erro com Tentar de novo; a repetição desenha os números', async (abrir) => {
    const { page } = await abrirMeta(abrir, '/meta/a-horizonte', {
      estado: { falhas: { 'relatorio:a-horizonte': [{ status: 502, message: 'A leitura do relatório falhou. Tente de novo.' }] } },
    });
    await page.getByRole('alert').getByText('A leitura do relatório falhou.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Investido' }).count(), 0, 'nada de número enquanto falha');
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await page.getByRole('group', { name: 'Investido' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
  });

  await cenario('M9', 'ranking: a explicação acompanha a pergunta; custo põe o menor primeiro e sem resposta no fim; filtros no endereço', async (abrir) => {
    const { page, estado } = await abrirMeta(abrir, '/meta/ranking');
    await page.getByRole('heading', { name: 'Ranking de criativos' }).waitFor();
    const explica = page.locator('.mm-criterio');
    await explica.getByText('Resultado', { exact: false }).first().waitFor();
    assert.match(await explica.innerText(), /maior primeiro/i);
    const nomes = () => page.locator('.mm-criativo-nome').allInnerTexts();
    await page.locator('.mm-criativo').first().waitFor();
    // Resultado: cada um pelo objetivo da SUA campanha (Reels = alcance 18.000).
    assert.equal((await nomes())[0], 'Reels bastidores');

    await page.getByRole('button', { name: /Ordenar por/ }).click();
    await page.getByRole('option', { name: /Custo por resultado/ }).click();
    await noEndereco(page, 'ordem=custo_por_resultado');
    await page.waitForFunction(() => /menor primeiro/i.test(document.querySelector('.mm-criterio')?.textContent ?? ''));
    const ordem = await nomes();
    // 90/18000 = 0,005 < 400/25 = 16 < 600/50 = 12? — 600/50=12 < 16. Ordem: Reels, depoimento, carrossel.
    assert.deepEqual(ordem.slice(0, 3), ['Reels bastidores', 'Vídeo depoimento', 'Carrossel antes e depois']);
    // Zero compras (vitrine) e zero visitas (cupom) não têm custo: ficam no fim, com travessão.
    assert.deepEqual(ordem.slice(3).sort(), ['Cupom de outubro', 'Foto da vitrine']);
    const ultima = page.locator('.mm-criativo').last();
    assert.equal((await ultima.locator('.mm-criativo-valor dd [aria-hidden]').innerText()).trim(), '—');
    await ultima.locator('.mm-criativo-valor').getByText('sem dado para esta pergunta').waitFor({ state: 'attached' });

    // Filtro de gerenciador no endereço; o recarregar mantém.
    await page.getByRole('button', { name: /Gerenciador/ }).click();
    await page.getByRole('option', { name: 'BM Aurora', exact: true }).click();
    await noEndereco(page, 'bm=BM+Aurora');
    await page.reload();
    await page.locator('.mm-criativo').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.mm-criativo').length === 1);
    assert.deepEqual(await nomes(), ['Cupom de outubro']);
    assert.ok(estado.pedidos.some((p) => p.rota === '/api/meta/ranking' && p.bm === 'BM Aurora'));
    await page.locator('.mm-contexto').getByText('BM Aurora').waitFor();
  });

  await cenario('M10', '390 px: as três telas cabem; a tabela rola dentro da caixa', async (abrir) => {
    const medidas = [];
    for (const caminho of ['/meta', '/meta/a-horizonte', '/meta/i-horizonte', '/meta/ranking']) {
      const { page, context } = await abrirMeta(abrir, caminho, { viewport: { width: 390, height: 844 } });
      await page.locator('h1').first().waitFor();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(200);
      const d = await semRolagemLateral(page);
      assert.ok(d <= 0, `${caminho} a 390: +${d}px`);
      if (caminho === '/meta/a-horizonte') {
        const caixa = page.getByRole('region', { name: /Mensagem/ });
        const m = await caixa.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        assert.ok(m.sw > m.cw, 'a tabela é mais larga que a caixa e rola nela');
      }
      medidas.push(caminho);
      await context.close();
    }
    return medidas.join(' ');
  });

  return resultados;
}
