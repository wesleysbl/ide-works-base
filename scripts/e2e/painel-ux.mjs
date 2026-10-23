/**
 * O PAINEL COMO PRIORIZAÇÃO — F11A do plano UX.
 *
 * O que se prova aqui, no Chrome, com a API interceptada (dados fictícios):
 *
 *   PX1  carteira cheia a 1440 × 900: o primeiro cliente começa antes de 50%
 *        da altura; a média diz de quem é média e não é fração de peças.
 *   PX2  o atalho do resumo e a gaveta Urgência dão a MESMA carteira e os
 *        mesmos números (Crítico); o atalho Financeiro e a pílula, idem.
 *   PX3  o endereço é normalizado: urgência inventada, ordem inventada, data
 *        impossível e plano desconhecido não esvaziam nem derrubam a tela.
 *   PX4  filtro sem resultado diz o recorte e oferece Limpar; limpar tira a
 *        busca e os filtros do endereço e mantém a ordenação.
 *   PX5  carteira vazia de verdade: convite para cadastrar, nenhum zero falso
 *        antes da leitura.
 *   PX6  carteira sem medida: média "—"; cada cartão diz o SEU motivo (F11A2).
 *   PX7  intervalo parcial: o aviso de contrato inteiro e o pedido com as datas.
 *   PX8  voltar da ficha do cliente conserva recorte, ordenação, busca e o
 *        ponto de leitura; o degrau "Painel" da ficha leva ao mesmo recorte.
 *   PX9  falha na recarga mantém a carteira anterior identificada.
 *   PX10 renovações seguem a carteira inteira mesmo com filtro.
 *   PX11 celular 390 × 844: primeiro cliente antes de 50%; os filtros repetidos
 *        (gaveta Urgência, pílula Financeiro) cedem lugar aos atalhos; peças,
 *        Plano e Etiqueta atrás de "Peças e filtros" (F11A2).
 *   PX12 os três motivos de não medir, cada um com o seu nome no mesmo cartão
 *        (rótulo, frase, nome acessível) — nunca "sem mês" para mês aberto.
 *   PX13 as dimensões com nome: "Urgência: …" e "Entrega do mês", ajuda da
 *        urgência manual; as peças por tipo mostram só os tipos do cliente,
 *        com o nome inteiro.
 *   PX14 F43 Fase 10 — a carteira em linhas: cabeçalho de colunas a 1440, sem
 *        anel nem barras coloridas (uma barra neutra por linha), e o lápis de
 *        editar alcançável pelo teclado e à vista no toque.
 *
 * F43 FASE 10 — O CARTÃO VIROU LINHA. `.pn-cartao` continua sendo a peça de
 * cada cliente (agora uma linha da lista), e as classes de dentro são as
 * mesmas: o que estes cenários protegem é a INFORMAÇÃO (urgência, situação,
 * entrega, motivo, renovações) e o comportamento (filtro, ordem, voltar), não
 * a forma de cartão. Onde a forma entrava na conta (a grade de tipos, os
 * blocos das renovações), o cenário passou a medir o equivalente da linha.
 *
 * `PAINEL_CAPTURAS=<pasta>` grava as capturas cheio/vazio/filtrado/motivos em
 * 1440/1024/390, claro e escuro.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, hojeEmSaoPaulo } from './comum.mjs';

/* ─────────────────────────── fixtures ───────────────────────────
   A FORMA é a da resposta real de `GET /api/clients` (`server/panel.ts`):
   `months`, `clients[]` com `delivery` (`DeliveryResult`), `inPeriod`,
   `conferencia`. Nomes e números inventados. */

const TIPOS = ['video', 'arte', 'foto', 'ads'];
const COTA = { video: 4, arte: 8, foto: 6, ads: 2 };

const hoje = hojeEmSaoPaulo();
const mesAtual = hoje.toISOString().slice(0, 7);
const emDias = (n) => {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + n));
  return d.toISOString().slice(0, 10);
};

/** Um `DeliveryResult` mensurável com o nível pedido (base ≤ 100, bônus acima). */
const entrega = (nivel, extras = 0, tipos = TIPOS) => ({
  measurable: true,
  level: nivel,
  base: Math.min(100, nivel),
  bonus: Math.max(0, nivel - 100),
  contractedPoints: 20,
  deliveredPoints: Math.round((20 * Math.min(100, nivel)) / 100),
  extraPoints: extras,
  breakdown: tipos.map((t) => ({
    contentType: t,
    contracted: COTA[t],
    delivered: Math.min(COTA[t], Math.round((COTA[t] * nivel) / 100)),
    extras: t === 'arte' ? extras : 0,
  })),
  deliveredOutsideContract: 0,
  formulaVersion: 'v-e2e',
});

/* Os TRÊS motivos de não medir, com as frases de `delivery/level.ts` — F11A2.
   Antes a fixture tinha um motivo inventado ('no_month') e a tela dizia "sem
   mês" a todos; o defeito da revisão (R01) passava por isso. */
const semMedida = (reason, message) => ({ measurable: false, reason, message, formulaVersion: 'v-e2e' });
const MES_NAO_ABERTO = semMedida('no_contract', 'Este mês ainda não foi aberto para este cliente.');
const SEM_COTA = semMedida('empty_contract', 'O mês foi aberto sem cota — não há base para medir.');
const SEM_CONTRATO = semMedida('no_content_contract', 'Este cliente não tem contrato de conteúdo mensal.');
export const MOTIVOS = [
  { delivery: MES_NAO_ABERTO, rotulo: 'Mês não aberto' },
  { delivery: SEM_COTA, rotulo: 'Sem cota para medir' },
  { delivery: SEM_CONTRATO, rotulo: 'Sem contrato mensal' },
];

const PLANOS = {
  basico: { id: 'pl-basico', name: 'Básico', colorBg: '#eef2ee', colorText: '#3b5a41', colorBorder: '#cfdcd1' },
  full: { id: 'pl-full', name: 'Full', colorBg: '#eceff6', colorText: '#34466b', colorBorder: '#cbd3e6' },
};
const ETIQUETAS = {
  rec: { id: 'tg-recorrente', name: 'Recorrente', color: '#4b7555' },
  lan: { id: 'tg-lancamento', name: 'Lançamento', color: '#8a5a1f' },
};

const cliente = (i, nome, o = {}) => ({
  id: `cx-${i}`,
  name: nome,
  categoryId: 'c1',
  categoryName: 'Ide',
  categorySortOrder: 0,
  plan: i % 3 === 0 ? PLANOS.full : PLANOS.basico,
  urgency: 'paz',
  isActive: true,
  inactiveAt: null,
  financeOk: true,
  startedOn: '2026-01-01',
  renewsOn: null,
  tags: [i % 2 ? ETIQUETAS.lan : ETIQUETAS.rec],
  inPeriod: { scheduled: 0, completed: 0 },
  delivery: entrega(60),
  ...o,
});

/** A carteira "normal" de referência: 12 ativos e 2 no arquivo. */
export const CARTEIRA = [
  cliente(1, 'Horizonte Studio', { urgency: 'perigo', financeOk: false, renewsOn: emDias(7), delivery: entrega(25) }),
  cliente(2, 'Aurora Mercado', { urgency: 'alerta', renewsOn: emDias(22), delivery: entrega(50) }),
  cliente(3, 'Instituto Vila Nova', { delivery: entrega(75) }),
  cliente(4, 'Casa das Flores', { urgency: 'perigo', renewsOn: emDias(-3), delivery: entrega(100) }),
  cliente(5, 'Café do Bairro', { urgency: 'alerta', financeOk: false, delivery: entrega(35) }),
  cliente(6, 'Norte Arquitetura', { delivery: MES_NAO_ABERTO }),
  cliente(7, 'Estúdio Jardim', { delivery: entrega(80, 2), renewsOn: emDias(90) }),
  cliente(8, 'Projeto Caminhos', { urgency: 'alerta', delivery: entrega(45) }),
  cliente(9, 'Padaria Bom Grão', { delivery: entrega(110, 3) }),
  cliente(10, 'Oficina Ribeira', { urgency: 'perigo', financeOk: false, delivery: entrega(10) }),
  cliente(11, 'Livraria Sete Mares', { delivery: entrega(90), renewsOn: emDias(40) }),
  cliente(12, 'Clínica Horizonte Azul', { urgency: 'alerta', delivery: entrega(65) }),
  cliente(13, 'Antiga Papelaria', { isActive: false, inactiveAt: '2026-03-10T12:00:00Z', delivery: MES_NAO_ABERTO }),
  cliente(14, 'Antigo Buffet', { isActive: false, inactiveAt: '2026-05-02T12:00:00Z', delivery: MES_NAO_ABERTO }),
  // F11A2: os outros dois motivos, e clientes que contratam só parte dos tipos.
  cliente(15, 'Agência Monte Claro', { delivery: SEM_COTA }),
  cliente(16, 'Bistrô Lume', { urgency: 'alerta', delivery: SEM_CONTRATO }),
  cliente(17, 'Dental Prisma', { delivery: entrega(70, 0, ['video', 'arte']) }),
  cliente(18, 'Grão Fino Cafés', { urgency: 'perigo', delivery: entrega(100, 0, ['video']) }),
];

const respostaDoPainel = (url, clients) => ({
  ok: true,
  from: url.searchParams.get('from'),
  to: url.searchParams.get('to'),
  months: [`${(url.searchParams.get('from') ?? mesAtual).slice(0, 7)}-01`],
  clients,
  conferencia: { clientesSemLista: [], listasSemCliente: [] },
});

/**
 * O `custom` do `setup`: responde `/api/clients` com a carteira dada e a
 * ficha do cliente com 404 (a ficha em si é da F11B; aqui importa a trilha).
 */
const comCarteira = (clients, { pedidos, falhar } = {}) => (url) => {
  if (url.pathname === '/api/clients') {
    pedidos?.push({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    if (falhar?.(url)) return { status: 500, body: { ok: false, message: 'Servidor indisponível (simulado).' } };
    return { body: respostaDoPainel(url, clients) };
  }
  if (/^\/api\/clients\/[^/]+$/.test(url.pathname)) {
    return { status: 404, body: { ok: false, message: 'Cliente não encontrado (fixture).' } };
  }
  return null;
};

/* ─────────────────────────── leitura da tela ─────────────────────────── */

const esperarCarteira = (page) => page.locator('.pn-carteira .pn-cartao-nome').first().waitFor();

/**
 * Espera a carteira ter `n` cartões. O React Router troca o endereço antes de
 * a tela redesenhar (transição): ler logo depois do `waitForURL` pega a lista
 * de antes.
 */
const esperarQuantos = (page, n) =>
  page.waitForFunction((k) => document.querySelectorAll('.pn-carteira .pn-cartao-nome').length === k, n, { timeout: 5000 });

/** Nomes dos cartões, na ordem da tela. */
const nomes = (page) => page.$$eval('.pn-carteira .pn-cartao-nome', (els) => els.map((e) => e.textContent.trim()));

/** Os números do resumo e da faixa de peças, como a tela os mostra. */
const numeros = (page) =>
  page.evaluate(() => ({
    atalhos: Object.fromEntries(
      [...document.querySelectorAll('.pn-atalho')].map((b) => [
        b.querySelector('.pn-atalho-rotulo').textContent.trim(),
        b.querySelector('.pn-atalho-n').textContent.trim(),
      ]),
    ),
    media: document.querySelector('.pn-media-valor')?.textContent.trim(),
    universo: document.querySelector('.pn-media-universo')?.textContent.trim(),
    tipos: [...document.querySelectorAll('.pn-tipos-item')].map((i) => i.textContent.trim()),
    recorte: document.querySelector('.pn-recorte-texto')?.textContent.replace(/\s+/g, ' ').trim(),
  }));

const atalho = (page, rotulo) => page.locator('.pn-atalho', { has: page.locator('.pn-atalho-rotulo', { hasText: rotulo }) });

const semRolagemLateral = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** A média dos níveis mensuráveis, pela mesma regra de `resumirCarteira`. */
const mediaEsperada = (clients) => {
  const m = clients.filter((c) => c.delivery.measurable);
  return m.length === 0 ? null : Math.round(m.reduce((s, c) => s + c.delivery.level, 0) / m.length);
};

const ATIVOS = CARTEIRA.filter((c) => c.isActive);

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);
  const CAPTURAS = process.env.PAINEL_CAPTURAS ?? '';

  await cenario('PX1', 'carteira cheia a 1440×900: primeiro cliente antes de 50% e a média diz o seu universo', async (abrir) => {
    const { page, erros } = await abrir({ custom: comCarteira(CARTEIRA) });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    const topo = await page.locator('.pn-carteira > *').first().evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(topo < 450, `primeiro cartão em y=${Math.round(topo)} (meta < 450)`);

    const n = await numeros(page);
    const esperada = mediaEsperada(ATIVOS);
    assert.equal(n.media, `${esperada}%`, 'a média é a de `resumirCarteira` — mesmo cálculo de antes');
    assert.match(await page.locator('.pn-media-rotulo').textContent(), /^Média do nível de entrega · /);
    const mensuraveis = ATIVOS.filter((c) => c.delivery.measurable).length;
    assert.equal(n.universo, `média por cliente, entre ${mensuraveis} de ${ATIVOS.length} com medida`);
    // Não é fração de peças: nenhuma barra "x/y" no bloco da média.
    assert.doesNotMatch(await page.locator('.pn-media').textContent(), /\d+\s*\/\s*\d+/);
    assert.equal(n.atalhos['Crítico'], String(ATIVOS.filter((c) => c.urgency === 'perigo').length));
    assert.equal(n.atalhos['Financeiro pendente'], String(ATIVOS.filter((c) => !c.financeOk).length));
    assert.equal(n.recorte, `${ATIVOS.length} clientes ativos`);
    assert.equal((await nomes(page)).length, ATIVOS.length);
    // Situação verificável, sem inventar: o vencido diz vencido; financeiro diz financeiro.
    const casa = page.locator('.pn-cartao', { hasText: 'Casa das Flores' });
    assert.match(await casa.locator('.pn-situacoes').textContent(), /Contrato vencido há 3d/);
    const horizonte = page.locator('.pn-cartao', { hasText: 'Horizonte Studio' });
    assert.match(await horizonte.locator('.pn-situacoes').textContent(), /Financeiro pendente.*Renovação em 7d/);
    assert.ok(await semRolagemLateral(page));
    assert.deepEqual(erros.filter((e) => !/chat\/live|WebSocket/i.test(e)), []);
    return `primeiro cartão y=${Math.round(topo)} (${Math.round((topo / 900) * 100)}%), média ${n.media} (${n.universo})`;
  });

  await cenario('PX2', 'atalho do resumo = filtro da gaveta: mesma carteira e mesmos números', async (abrir) => {
    const a = await abrir({ custom: comCarteira(CARTEIRA) });
    await a.page.goto(BASE + '/painel');
    await esperarCarteira(a.page);
    const critico = atalho(a.page, 'Crítico');
    const prometido = Number(await critico.locator('.pn-atalho-n').textContent());
    await critico.click();
    await a.page.waitForURL(/urgencia=perigo/);
    await esperarQuantos(a.page, prometido);
    assert.equal(await critico.getAttribute('aria-pressed'), 'true');
    const pelaFaixa = { nomes: await nomes(a.page), numeros: await numeros(a.page) };
    assert.equal(pelaFaixa.nomes.length, prometido, 'o número do atalho é o tamanho da carteira depois do clique');

    const b = await abrir({ custom: comCarteira(CARTEIRA) });
    await b.page.goto(BASE + '/painel');
    await esperarCarteira(b.page);
    await b.page.getByRole('button', { name: /^Urgência/ }).click();
    await b.page.getByRole('option', { name: /Crítico/ }).click();
    await b.page.waitForURL(/urgencia=perigo/);
    await b.page.keyboard.press('Escape');
    await esperarQuantos(b.page, prometido);
    const pelaGaveta = { nomes: await nomes(b.page), numeros: await numeros(b.page) };
    assert.deepEqual(pelaGaveta, pelaFaixa, 'mesma carteira, mesma média, mesmas peças, mesmo recorte');
    assert.equal(await atalho(b.page, 'Crítico').getAttribute('aria-pressed'), 'true', 'a gaveta acende o atalho');

    // Financeiro: atalho e pílula são o mesmo filtro.
    const fin = atalho(a.page, 'Financeiro pendente');
    // Com Crítico ligado, o atalho Financeiro diz quantos críticos têm
    // financeiro pendente — o que ligá-lo junto mostraria.
    assert.equal(
      Number(await fin.locator('.pn-atalho-n').textContent()),
      ATIVOS.filter((c) => c.urgency === 'perigo' && !c.financeOk).length,
    );
    await critico.click(); // desliga Crítico
    await a.page.waitForURL((u) => !u.search.includes('urgencia'));
    await esperarQuantos(a.page, ATIVOS.length);
    const nFin = Number(await fin.locator('.pn-atalho-n').textContent());
    await fin.click();
    await a.page.waitForURL(/financeiro=pendente/);
    await esperarQuantos(a.page, nFin);
    const pilula = a.page.locator('.pn-filtros').getByRole('button', { name: /Financeiro pendente/ });
    assert.equal(await pilula.getAttribute('aria-pressed'), 'true');
    await pilula.click();
    await a.page.waitForURL((u) => !u.search.includes('financeiro'));
    await esperarQuantos(a.page, ATIVOS.length);
    assert.equal(await fin.getAttribute('aria-pressed'), 'false', 'a pílula desliga o atalho');
    return `Crítico ${prometido} → ${pelaFaixa.nomes.join(', ')}; Financeiro ${nFin}`;
  });

  await cenario('PX3', 'endereço normalizado: valores inválidos viram o padrão, sem esvaziar a carteira', async (abrir) => {
    const pedidos = [];
    const { page } = await abrir({ custom: comCarteira(CARTEIRA, { pedidos }) });
    await page.goto(BASE + '/painel?urgencia=banana,PERIGO,perigo&ordem=xyz&sentido=up&de=2026-02-31&ate=2026-03-05&plano=nao-existe');
    await esperarCarteira(page);
    const ultimo = pedidos.at(-1);
    assert.equal(ultimo.from, `${mesAtual}-01`, 'data impossível → o mês corrente');
    assert.equal(await atalho(page, 'Crítico').getAttribute('aria-pressed'), 'true');
    assert.equal(await atalho(page, 'Atenção').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#pn-ordem').inputValue(), 'entrega');
    assert.match(await page.locator('.pn-sentido').textContent(), /Crescente/);
    // plano desconhecido não filtra: só Crítico sobra.
    assert.equal((await nomes(page)).length, ATIVOS.filter((c) => c.urgency === 'perigo').length);
    // Interagir reescreve o endereço limpo.
    await atalho(page, 'Atenção').click();
    await page.waitForURL(/urgencia=perigo%2Calerta|urgencia=perigo,alerta/);
    const busca = new URL(page.url()).searchParams;
    assert.equal(busca.get('plano'), null, 'o id morto sai do endereço');
    assert.equal(busca.get('ordem'), null);
    assert.equal(busca.get('de'), null);
    return `endereço reescrito: ${new URL(page.url()).search}`;
  });

  await cenario('PX4', 'filtro sem resultado: diz o recorte e oferece limpar; ordenação fica', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA) });
    await page.goto(BASE + '/painel?ordem=nome&sentido=desc');
    await esperarCarteira(page);
    await page.getByRole('searchbox', { name: /Buscar cliente/ }).fill('zzzz');
    const aviso = page.getByText(/Nenhum cliente ativo casa com/);
    await aviso.waitFor();
    assert.match(await aviso.textContent(), /“zzzz”/);
    await page.waitForURL(/busca=zzzz/);
    await page.locator('.pn-carteira ~ *').getByRole('button', { name: 'Limpar filtros' }).click();
    await esperarCarteira(page);
    await page.waitForURL((u) => !u.search.includes('busca'));
    const q = new URL(page.url()).searchParams;
    assert.equal(q.get('ordem'), 'nome');
    assert.equal(q.get('sentido'), 'desc');
    assert.equal(await page.getByRole('searchbox', { name: /Buscar cliente/ }).inputValue(), '');
    const lista = await nomes(page);
    assert.equal(lista[0], 'Projeto Caminhos', 'nome decrescente continua');
    return `limpo, ordem mantida (${q})`;
  });

  await cenario('PX5', 'carteira vazia: convite para cadastrar, e nenhum zero antes da leitura', async (abrir) => {
    let soltar;
    const segura = new Promise((r) => { soltar = r; });
    const { page } = await abrir({
      custom: async (url) => {
        if (url.pathname === '/api/clients') {
          await segura;
          return { body: respostaDoPainel(url, []) };
        }
        return null;
      },
    });
    await page.goto(BASE + '/painel');
    await page.locator('.pn-atalho').first().waitFor();
    const antes = await numeros(page);
    assert.deepEqual(Object.values(antes.atalhos), ['', '', '', ''], 'esboço, e não "0", durante a primeira leitura');
    assert.equal(antes.recorte, 'Carregando a carteira…');
    soltar();
    await page.getByText(/Nenhum cliente aqui/).waitFor();
    await page.getByRole('button', { name: 'Cadastrar cliente' }).waitFor();
    const depois = await numeros(page);
    assert.equal(depois.media, '—');
    assert.equal(depois.universo, 'nenhum cliente deste recorte tem medida');
    assert.equal(depois.atalhos['Crítico'], '0');
    return 'esboço → vazio com Cadastrar cliente';
  });

  await cenario('PX6', 'carteira sem medida: média "—", e cada cartão com o seu motivo', async (abrir) => {
    // Um cliente por motivo, mais um segundo "mês não aberto".
    const lista = ATIVOS.slice(0, 4).map((c, i) => ({ ...c, delivery: MOTIVOS[i % 3].delivery }));
    const { page } = await abrir({ custom: comCarteira(lista) });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    const n = await numeros(page);
    assert.equal(n.media, '—');
    assert.equal(n.universo, 'nenhum cliente deste recorte tem medida');
    for (const [i, c] of lista.entries()) {
      const motivo = page.locator('.pn-cartao', { hasText: c.name }).locator('.pn-cartao-motivo');
      assert.equal((await motivo.textContent()).trim(), `${MOTIVOS[i % 3].rotulo}. ${c.delivery.message}`);
    }
    // Não mede não é situação que pede ação, e "sem mês" não sobra em lugar nenhum.
    const situacoes = await page.$$eval('.pn-situacoes li', (els) => els.map((e) => e.textContent));
    assert.ok(situacoes.every((t) => !/mês|cota|contrato mensal/i.test(t)), situacoes.join(' | '));
    assert.doesNotMatch(await page.locator('.pn-carteira').textContent(), /sem mês/i);
    return n.tipos.join(' | ');
  });

  await cenario('PX7', 'intervalo parcial: aviso de contrato inteiro e o pedido com as datas', async (abrir) => {
    const pedidos = [];
    const comIntervalo = CARTEIRA.map((c, i) => ({ ...c, inPeriod: { scheduled: i % 2 ? 6 : 0, completed: i % 3 } }));
    const { page } = await abrir({ custom: comCarteira(comIntervalo, { pedidos }) });
    await page.goto(BASE + `/painel?de=${mesAtual}-01&ate=${mesAtual}-07`);
    await esperarCarteira(page);
    assert.deepEqual(pedidos.at(-1), { from: `${mesAtual}-01`, to: `${mesAtual}-07` });
    await page.getByText(/Contrato de .* inteiro/).waitFor();
    assert.ok((await page.locator('.pn-cartao-datas', { hasText: 'no intervalo' }).count()) > 0);
    // A média continua a mesma do mês inteiro: o medidor não finge recálculo.
    assert.equal((await numeros(page)).media, `${mediaEsperada(ATIVOS)}%`);
    return `pedido ${JSON.stringify(pedidos.at(-1))}`;
  });

  await cenario('PX8', 'voltar da ficha conserva recorte, ordem, busca e rolagem; o degrau Painel também', async (abrir) => {
    // Mais cartões para haver rolagem de verdade.
    const muitos = [
      ...CARTEIRA,
      ...Array.from({ length: 14 }, (_, i) => cliente(20 + i, `Cliente Extra ${String(i + 1).padStart(2, '0')}`, { urgency: 'alerta', delivery: entrega(40 + i) })),
    ];
    const { page } = await abrir({ custom: comCarteira(muitos), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    await atalho(page, 'Atenção').click();
    await page.waitForURL(/urgencia=alerta/);
    await page.locator('#pn-ordem').selectOption('nome');
    await page.waitForURL(/ordem=nome/);
    await page.getByRole('button', { name: /^Sentido/ }).click();
    await page.waitForURL(/sentido=desc/);
    await page.getByRole('searchbox', { name: /Buscar cliente/ }).fill('e');
    await page.waitForURL(/busca=e/);
    await page.waitForTimeout(300);
    const recorteAntes = new URL(page.url()).search;
    const listaAntes = await nomes(page);

    await page.evaluate(() => window.scrollTo(0, 520));
    await page.waitForTimeout(250);
    const rolagemAntes = await page.evaluate(() => window.scrollY);
    const alvo = listaAntes[6];
    await page.getByRole('link', { name: new RegExp(`^Abrir ${alvo}`) }).click();
    await page.waitForURL(/\/cliente\//);
    const degrau = page.locator('.o-topo').getByRole('link', { name: 'Painel', exact: true });
    await degrau.waitFor();
    assert.equal(await degrau.getAttribute('href'), `/painel${recorteAntes}`);

    await page.goBack();
    await page.waitForURL(/\/painel\?/);
    await esperarCarteira(page);
    assert.equal(new URL(page.url()).search, recorteAntes);
    assert.deepEqual(await nomes(page), listaAntes);
    assert.equal(await page.getByRole('searchbox', { name: /Buscar cliente/ }).inputValue(), 'e');
    assert.equal(await page.locator('#pn-ordem').inputValue(), 'nome');
    assert.equal(await atalho(page, 'Atenção').getAttribute('aria-pressed'), 'true', `Atenção ligado depois de voltar (${page.url()})`);
    await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 30, rolagemAntes, { timeout: 4000 });
    const rolagemDepois = await page.evaluate(() => window.scrollY);

    // Pelo degrau da trilha: mesmo recorte.
    await page.getByRole('link', { name: new RegExp(`^Abrir ${alvo}`) }).click();
    await page.waitForURL(/\/cliente\//);
    await page.locator('.o-topo').getByRole('link', { name: 'Painel', exact: true }).click();
    await page.waitForURL(/\/painel/);
    assert.equal(new URL(page.url()).search, recorteAntes);
    await esperarCarteira(page);
    assert.deepEqual(await nomes(page), listaAntes);
    return `recorte ${recorteAntes}; rolagem ${rolagemAntes} → ${rolagemDepois}`;
  });

  await cenario('PX9', 'trocar o período grava de/ate; falha na recarga mantém a carteira anterior identificada', async (abrir) => {
    const [a, m] = mesAtual.split('-').map(Number);
    const ultimo = `${mesAtual}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const pedidos = [];
    const { page } = await abrir({
      custom: comCarteira(CARTEIRA, {
        pedidos,
        falhar: (url) => !(url.searchParams.get('from') === `${mesAtual}-01` && url.searchParams.get('to') === ultimo),
      }),
    });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    const antes = await nomes(page);
    // O seletor do topo: atalho "7d" (termina hoje, não é o mês inteiro).
    await page.locator('.o-topo').getByRole('button', { name: /\d{2}\/\d{2}\/\d{2} – / }).click();
    await page.getByRole('button', { name: '7d', exact: true }).click();
    await page.waitForURL(/de=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}/);
    await page.getByText('Não foi possível atualizar.').waitFor();
    await page.getByText(/Os números abaixo ainda são de setembro|Os números abaixo ainda são de/).waitFor();
    assert.deepEqual(await nomes(page), antes, 'a carteira anterior continua na tela');
    const q = new URL(page.url()).searchParams;
    assert.deepEqual(pedidos.at(-1), { from: q.get('de'), to: q.get('ate') }, 'o pedido é o período do endereço');
    return `endereço ${new URL(page.url()).search}; aviso com o período dos números que ficaram`;
  });

  await cenario('PX10', 'renovações seguem a carteira inteira mesmo com filtro', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA) });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    // F43 Fase 10: as renovações são linhas (eram blocos `.o-card`); conta-se
    // o que leva ao cliente, que é o que cada uma é.
    const contar = () => page.locator('#pn-renovacoes a[href^="/cliente/"]').count();
    const antes = await contar();
    await atalho(page, 'Em dia').click();
    await page.waitForURL(/urgencia=paz/);
    assert.equal(await contar(), antes, 'filtrar a carteira não esconde contrato que vence');
    assert.ok(antes >= 3);
    return `${antes} renovações antes e depois do filtro`;
  });

  await cenario('PX11', 'celular 390×844: primeiro cliente antes de 50%, peças e filtros recolhíveis, atalhos no lugar dos filtros repetidos', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA), viewport: { width: 390, height: 844 } });
    // Crítico + Financeiro: o recorte por escrito ocupa a linha, e "Limpar
    // filtros" desce para a de baixo — o caso do recuo.
    await page.goto(BASE + '/painel?urgencia=perigo&financeiro=pendente');
    await esperarCarteira(page);
    const topo = await page.locator('.pn-carteira > *').first().evaluate((el) => el.getBoundingClientRect().top);
    // Com um filtro ligado a linha do recorte ganha "Limpar filtros"; o limite
    // vale para o painel sem filtro (medido abaixo) e tolera 4% a mais com ele.
    assert.ok(topo < 844 * 0.64, `com filtro: primeiro cartão em y=${Math.round(topo)}`);
    assert.ok(await semRolagemLateral(page));
    // A gaveta Urgência e a pílula Financeiro saem no celular: os atalhos
    // acima são o mesmo filtro, e o atalho continua dizendo que está ligado.
    assert.equal(await page.locator('.pn-filtros').getByRole('button', { name: /^Urgência/ }).count(), 0);
    assert.equal(await atalho(page, 'Crítico').getAttribute('aria-pressed'), 'true');
    // "Limpar filtros" alinha o texto com a linha do recorte (sem o recuo do botão).
    const [xTexto, xLimpar, desceu] = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.pn-recorte button')].find((e) => e.textContent.includes('Limpar'));
      const t = document.querySelector('.pn-recorte-texto').getBoundingClientRect();
      const r = document.createRange();
      r.selectNodeContents(b);
      return [t.left, r.getBoundingClientRect().left, b.getBoundingClientRect().top >= t.bottom - 2];
    });
    assert.ok(desceu, '"Limpar filtros" na linha de baixo do recorte');
    assert.ok(Math.abs(xLimpar - xTexto) <= 4, `Limpar em x=${Math.round(xLimpar)}, recorte em x=${Math.round(xTexto)}`);
    // Sem filtro.
    await page.locator('.pn-recorte').getByRole('button', { name: 'Limpar filtros' }).click();
    await page.waitForURL((u) => !u.search.includes('urgencia') && !u.search.includes('financeiro'));
    await esperarQuantos(page, ATIVOS.length);
    const topoLimpo = await page.locator('.pn-carteira > *').first().evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(topoLimpo < 844 * 0.5, `primeiro cartão em y=${Math.round(topoLimpo)} (meta < 50% de 844)`);
    assert.match(await page.locator('.pn-sentido').getAttribute('aria-label'), /crescente/);

    // PEÇAS E FILTROS — F11A2. Fechado: peças, Plano e Etiqueta fora da vista;
    // a busca e os atalhos à vista. Aberto: as quatro peças e as duas gavetas.
    const botao = page.getByRole('button', { name: /^Peças e filtros/ });
    assert.equal(await botao.getAttribute('aria-expanded'), 'false');
    assert.ok(await page.getByRole('searchbox', { name: /Buscar cliente/ }).isVisible());
    assert.ok(await atalho(page, 'Crítico').isVisible());
    assert.equal(await page.locator('.pn-tipos').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: /^Plano/ }).isVisible(), false);
    const [yBusca, yBotao] = await page.evaluate(() => [
      document.querySelector('.pn-ferramentas .iw-busca').getBoundingClientRect().top,
      document.querySelector('.pn-mais-botao').getBoundingClientRect().top,
    ]);
    assert.ok(Math.abs(yBusca - yBotao) < 8, `busca e botão na mesma linha (${yBusca} × ${yBotao})`);
    await botao.click();
    assert.equal(await botao.getAttribute('aria-expanded'), 'true');
    assert.ok(await page.locator('.pn-tipos').isVisible());
    assert.equal(await page.locator('.pn-tipos-item:visible').count(), 4);
    assert.ok(await page.getByRole('button', { name: /^Plano/ }).isVisible());
    assert.ok(await page.getByRole('button', { name: /^Etiqueta/ }).isVisible());
    assert.ok(await semRolagemLateral(page));
    // Um filtro de lá ligado aparece no botão (número) e na linha do recorte.
    await page.getByRole('button', { name: /^Plano/ }).click();
    await page.getByRole('option', { name: /Full/ }).click();
    await page.waitForURL(/plano=/);
    await page.keyboard.press('Escape');
    await botao.click();
    assert.equal(await botao.getAttribute('aria-expanded'), 'false');
    assert.equal((await page.locator('.pn-mais-n').textContent()).trim(), '1');
    assert.match(await page.locator('.pn-recorte-texto').textContent(), /Full/);
    return `primeiro cartão y=${Math.round(topoLimpo)} (${Math.round((topoLimpo / 844) * 100)}%); com filtro y=${Math.round(topo)}`;
  });

  await cenario('PX12', 'os três motivos de não medir: cada cartão diz o seu, e nenhum diz "sem mês" com o mês aberto', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA) });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    const vistos = [];
    for (const { delivery, rotulo } of MOTIVOS) {
      const c = ATIVOS.find((x) => x.delivery === delivery);
      assert.ok(c, `a carteira tem um cliente com ${delivery.reason}`);
      const cartao = page.locator('.pn-cartao', { hasText: c.name });
      // O motivo no lugar dos tipos: nome curto + a frase do servidor.
      const motivo = cartao.locator('.pn-cartao-motivo');
      assert.equal(await motivo.getAttribute('data-motivo'), delivery.reason);
      assert.equal((await motivo.locator('b').textContent()).trim(), `${rotulo}.`);
      assert.match(await motivo.textContent(), new RegExp(delivery.message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      // A entrega não finge número (era o anel; desde a F43 Fase 10 é o
      // número na linha); o nome acessível da linha diz o mesmo motivo.
      assert.match(await cartao.locator('.pn-entrega').textContent(), /^—\s*Entrega do mês$/);
      assert.equal(await cartao.locator('.pn-cartao-tipos').count(), 0);
      assert.equal(await cartao.locator('.pn-entrega-barra').count(), 0, 'sem medida, sem barra');
      const nome = await page.getByRole('link', { name: new RegExp(`^Abrir ${c.name}`) }).getAttribute('aria-label');
      assert.match(nome, new RegExp(`entrega do mês ${rotulo}$`));
      assert.doesNotMatch(await cartao.textContent(), /sem mês/i);
      vistos.push(`${c.name}: ${rotulo}`);
    }
    // Quem está de fora da média não muda a média: a mesma de `resumirCarteira`.
    assert.equal((await numeros(page)).media, `${mediaEsperada(ATIVOS)}%`);
    return vistos.join(' · ');
  });

  await cenario('PX13', 'dimensões com nome: Urgência (manual) e Entrega do mês; tipos com as colunas dos tipos mostrados', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    // O topo: o grupo se chama Urgência, tem os três estados e a ajuda.
    const grupo = page.getByRole('group', { name: 'Urgência' });
    assert.equal(await grupo.locator('.pn-atalho').count(), 3);
    assert.match(await grupo.textContent(), /marcada à mão/);
    await grupo.getByRole('button', { name: 'Explicar: a urgência' }).click();
    await page.getByRole('dialog', { name: 'a urgência' }).getByText(/não vem da entrega do mês/).waitFor();
    await page.keyboard.press('Escape');
    // Financeiro fora do grupo.
    assert.equal(await grupo.getByRole('button', { name: /Financeiro/ }).count(), 0);

    // O cartão: "Urgência" + estado, e "Entrega do mês" sob o anel — Em dia com
    // entrega baixa e Crítico com 100% continuam lado a lado, sem inferência.
    const grao = page.locator('.pn-cartao', { hasText: 'Grão Fino Cafés' });
    assert.match(await grao.locator('.pn-urgencia').textContent(), /^Urgência\s*Crítico\s*\(marcada à mão\)$/);
    assert.match(await grao.locator('.pn-urgencia').getAttribute('title'), /marcada à mão/);
    assert.match(await grao.locator('.pn-entrega').textContent(), /^100%\s*Entrega do mês$/);

    // OS TIPOS DO CLIENTE, E SÓ ELES — F11A2/R07. Até a F43 Fase 10 era uma
    // grade com uma coluna por tipo; agora é texto ("Vídeos 4/4"), e o que se
    // cobra é o mesmo: cliente só de vídeo mostra um tipo, de vídeo e arte
    // mostra dois, e nenhum nome sai cortado ("Víde…") a 1440.
    const grades = await page.$$eval('.pn-cartao-tipos', (els) =>
      els.map((el) => ({
        n: el.querySelectorAll('.pn-tipo').length,
        dataN: Number(el.dataset.n),
        // Largura do TEXTO (Range) contra a caixa: a reticência do CSS não
        // aparece em scrollWidth quando a caixa arredonda para cima.
        cortados: [...el.querySelectorAll('.pn-tipo-nome')]
          .filter((x) => {
            const r = document.createRange();
            r.selectNodeContents(x);
            return r.getBoundingClientRect().width > x.getBoundingClientRect().width + 0.5;
          })
          .map((x) => x.textContent),
      })),
    );
    assert.ok(grades.some((g) => g.n === 1) && grades.some((g) => g.n === 2) && grades.some((g) => g.n === 4));
    for (const g of grades) assert.equal(g.dataN, g.n, `linha com ${g.n} tipos diz ${g.dataN}`);
    assert.deepEqual(grades.flatMap((g) => g.cortados), [], 'nenhum rótulo de tipo cortado a 1440');
    assert.match(await grao.locator('.pn-cartao-tipos').textContent(), /^Vídeos\s*4\/4$/);
    // Secundários sem selo: plano e etiqueta na linha de apoio, sob o nome.
    assert.equal(await page.locator('.pn-cartao .o-etiqueta, .pn-cartao .o-selo').count(), 0);
    assert.ok((await page.locator('.pn-cartao-rodape .pn-cartao-plano').count()) >= ATIVOS.length);
    return `grades: ${[...new Set(grades.map((g) => g.n))].sort().join(', ')} tipos`;
  });

  await cenario('PX14', 'F43 Fase 10: carteira em linhas com cabeçalho, sem anel nem barras coloridas; o lápis pelo teclado e no toque', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA), viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    // O cabeçalho das colunas existe na tela larga (e é só visual: aria-hidden).
    const cabeca = page.locator('.pn-lista-cabeca');
    assert.ok(await cabeca.isVisible(), 'cabeçalho das colunas à vista a 1440');
    assert.equal(await cabeca.getAttribute('aria-hidden'), 'true');
    assert.match((await cabeca.textContent()).replace(/\s+/g, ' '), /Cliente.*Urgência · pede ação.*Entrega do mês/);
    // Nenhum anel; uma barra por cliente com medida, todas da MESMA cor.
    // O anel era um `<circle>` com traço medido (`stroke-dasharray`); os ícones
    // de urgência também têm círculo, e esses ficam.
    assert.equal(await page.locator('.pn-carteira circle[stroke-dasharray]').count(), 0, 'o anel saiu');
    assert.equal(await page.locator('.pn-carteira .o-barra').count(), 0, 'as barras coloridas por tipo saíram');
    const medidos = ATIVOS.filter((c) => c.delivery.measurable).length;
    const cores = await page.$$eval('.pn-carteira .pn-entrega-barra > i', (is) => is.map((i) => getComputedStyle(i).backgroundColor));
    assert.equal(cores.length, medidos, 'uma barra por cliente com medida');
    assert.equal(new Set(cores).size, 1, `uma cor só: ${[...new Set(cores)].join(' | ')}`);
    // A linha não tem moldura (só o fio de cima, que separa as linhas).
    const moldura = await page.locator('.pn-carteira .pn-cartao').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.borderLeftWidth, s.borderRightWidth, s.backgroundColor];
    });
    assert.deepEqual(moldura.slice(0, 2), ['0px', '0px'], 'sem moldura lateral');
    assert.ok(await semRolagemLateral(page));

    // O LÁPIS PELO TECLADO: do link da linha, o Tab cai no "Editar" dela, que
    // aparece (não é botão invisível com foco), e Enter abre a ficha.
    const alvo = ATIVOS[0].name;
    await page.getByRole('link', { name: new RegExp(`^Abrir ${alvo}`) }).focus();
    await page.keyboard.press('Tab');
    const editar = page.getByRole('button', { name: `Editar ${alvo}` });
    assert.ok(await editar.evaluate((el) => el === document.activeElement), 'o Tab sai do link e cai no lápis da mesma linha');
    await page.waitForFunction((n) => getComputedStyle(document.querySelector(`[aria-label="Editar ${n}"]`)).opacity === '1', alvo, { timeout: 3000 });
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Editar cliente' }).waitFor();
    return `${cores.length} barras de uma cor (${cores[0]}); lápis pelo teclado abre "Editar cliente"`;
  });

  await cenario('PX14-toque', 'F43 Fase 10: no celular de toque o lápis está à vista em toda linha, com alvo de 44px', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA), viewport: { width: 390, height: 844 }, toque: true });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    assert.equal(await page.locator('.pn-lista-cabeca').isVisible(), false, 'sem cabeçalho no celular: cada linha diz o nome da medida');
    assert.ok(await page.locator('.pn-carteira .pn-cartao').first().locator('.pn-entrega-rotulo').isVisible(), '"Entrega do mês" escrito na linha');
    const lapis = await page.$$eval('.pn-carteira .o-editar-cartao', (bs) =>
      bs.map((b) => {
        const depois = getComputedStyle(b, '::after');
        const r = b.getBoundingClientRect();
        return {
          opacidade: getComputedStyle(b).opacity,
          alvo: Math.round(r.width - 2 * parseFloat(depois.left)),
          dentro: r.right <= window.innerWidth,
        };
      }),
    );
    assert.equal(lapis.length, ATIVOS.length);
    assert.ok(lapis.every((l) => l.opacidade === '1'), 'o lápis à vista sem hover');
    assert.ok(lapis.every((l) => l.alvo >= 44), `alvo do toque: ${lapis.map((l) => l.alvo).join(',')}`);
    assert.ok(lapis.every((l) => l.dentro));
    assert.ok(await semRolagemLateral(page));
    return `${lapis.length} lápis à vista, alvo ${lapis[0].alvo}px`;
  });

  await cenario('PX15', 'Arquivo: o "desde" é o dia de São Paulo do cancelamento — 22h de 31/03 não vira 1º/04', async (abrir) => {
    // 01h UTC de 01/04 é 22h de 31/03 em Brasília: a regra do mês do
    // cancelamento (março) e a etiqueta têm de dizer o mesmo dia.
    const carteira = CARTEIRA.map((c) => (c.id === 'cx-13' ? { ...c, inactiveAt: '2026-04-01T01:00:00Z' } : c));
    const { page } = await abrir({ custom: comCarteira(carteira) });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    await page.getByRole('button', { name: /^Arquivo/ }).click();
    const linha = page.locator('[data-arquivo] .pn-mini', { hasText: 'Antiga Papelaria' });
    assert.match(await linha.locator('.pn-mini-dado').textContent(), /desde 31\/03\/2026/);
    const outra = page.locator('[data-arquivo] .pn-mini', { hasText: 'Antigo Buffet' });
    assert.match(await outra.locator('.pn-mini-dado').textContent(), /desde 02\/05\/2026/);
    return 'cancelado às 22h de 31/03 aparece "desde 31/03/2026"';
  });

  if (CAPTURAS) {
    await cenario('PX-capturas', 'capturas cheio/vazio/filtrado em 1440/1024/390, claro e escuro', async (abrir) => {
      const feitas = [];
      for (const tema of ['claro', 'escuro']) {
        for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
          for (const [nome, clients, busca] of [
            ['cheio', CARTEIRA, ''],
            ['vazio', [], ''],
            ['filtrado', CARTEIRA, '?urgencia=perigo&financeiro=pendente'],
            ['sem-resultado', CARTEIRA, '?busca=zzzz'],
            // F11A2: os três motivos lado a lado, com cartões de 1, 2 e 4 tipos.
            ['motivos', CARTEIRA.filter((c) => c.isActive && [6, 7, 15, 16, 17, 18].includes(Number(c.id.slice(3)))), '?ordem=nome'],
          ]) {
            if (nome === 'sem-resultado' && w !== 390) continue;
            const { page } = await abrir({ custom: comCarteira(clients), viewport: { width: w, height: h }, tema });
            await page.goto(BASE + '/painel' + busca);
            await page.locator('.pn-recorte-texto').filter({ hasNotText: 'Carregando' }).waitFor();
            await page.waitForTimeout(300);
            const largura = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
            assert.ok(largura[0] <= largura[1], `${nome} ${w} ${tema}: sem rolagem lateral (${largura})`);
            const arquivo = `${CAPTURAS}/painel-${nome}-${w}x${h}-${tema}.png`;
            await page.screenshot({ path: arquivo });
            feitas.push(arquivo);
            // F11A2: a área "Peças e filtros" aberta, no celular.
            if (w === 390 && nome === 'filtrado') {
              await page.getByRole('button', { name: /^Peças e filtros/ }).click();
              const aberta = `${CAPTURAS}/painel-pecas-e-filtros-${w}x${h}-${tema}.png`;
              await page.screenshot({ path: aberta });
              feitas.push(aberta);
            }
          }
        }
      }
      return `${feitas.length} capturas`;
    });
  }

  return resultados;
}
