/**
 * A ÚLTIMA ENTREGA NO PAINEL — F38, Fase 2.
 *
 * O que se prova aqui, no Chrome, com a API interceptada:
 *
 *   UE1  o cartão diz "Última entrega 05/10 · há 1 dia" (Fonseca Moura),
 *        "Sem entrega registrada" a quem nunca entregou, e as peças vencidas
 *        e as que vencem hoje em "Pede ação"; o nome acessível do cartão
 *        inclui a última entrega.
 *   UE2  ordenar por "Última entrega": Agência Ide (27/01) antes de CONTFIX
 *        (06/10), quem nunca entregou no fim nos dois sentidos; a ordem vai
 *        para o endereço (`ordem=ultimaEntrega`) e volta dele.
 *   UE3  celular 390 × 844: a linha não corta nem empurra a página de lado.
 *
 * F43 FASE 10 — o cartão virou LINHA da carteira, e a última entrega ganhou
 * coluna própria (com "Última entrega" no cabeçalho a 1440 e escrito na linha
 * no celular). `.pn-cartao` continua sendo a peça de cada cliente e
 * `.pn-ultima` a frase: os três cenários valem como estavam, porque protegem
 * a frase, a ordem e o celular — não a forma de cartão. UE1 passou a conferir
 * também que a coluna tem nome a 1440.
 *
 * AS DATAS SÃO AS DO BANCO EM 06/10/2026, MAS A RESPOSTA É FICTÍCIA
 *   Como todo cenário de `scripts/e2e/`, nada chega ao banco: `/api/clients`
 *   responde a carteira abaixo. Os nomes e as datas copiam o que a prova
 *   `scripts/provar-ultima-entrega.mjs` leu em produção em 06/10/2026 —
 *   Fonseca 05/10, Agência Ide 27/01, CONTFIX 06/10, Pró-Forma com as
 *   vencidas de 01/08 e 01/10 — para o cenário falar da carteira de verdade.
 *   Se o banco mudar, este cenário não muda: quem confere o banco é a prova.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite } from './comum.mjs';

/* ─────────────────────────── fixtures ─────────────────────────── */

const HOJE = '2026-10-06';

/** A forma de `DeliveryStatus` (`delivery/ultima-entrega.ts`). */
const situacao = (o = {}) => ({
  today: HOJE,
  lastDeliveryOn: null,
  daysSinceLastDelivery: null,
  overdue: [],
  dueToday: 0,
  unscheduled: 0,
  nextScheduledOn: null,
  ...o,
});
const entregou = (dia, dias, o = {}) => situacao({ lastDeliveryOn: dia, daysSinceLastDelivery: dias, ...o });

const MES_NAO_ABERTO = {
  measurable: false,
  reason: 'no_contract',
  message: 'Este mês ainda não foi aberto para este cliente.',
  formulaVersion: 'v-e2e',
};

const cliente = (i, nome, deliveryStatus, o = {}) => ({
  id: `ue-${i}`,
  name: nome,
  categoryId: 'c1',
  categoryName: 'Ide',
  categorySortOrder: 0,
  plan: null,
  urgency: 'paz',
  isActive: true,
  inactiveAt: null,
  financeOk: true,
  startedOn: '2026-01-01',
  renewsOn: null,
  tags: [],
  inPeriod: { scheduled: 0, completed: 0 },
  delivery: MES_NAO_ABERTO,
  deliveryStatus,
  ...o,
});

const CARTEIRA = [
  cliente(1, 'CONTFIX', entregou('2026-10-06', 0)),
  cliente(2, 'Fonseca Moura Contrutora', entregou('2026-10-05', 1, { overdue: ['2026-08-09', '2026-08-24'] })),
  cliente(3, 'Agência Ide', entregou('2026-01-27', 252)),
  cliente(4, 'Amanda Barros', situacao()),
  cliente(5, 'Pró-Forma Equipamentos', entregou('2026-10-01', 5, { overdue: ['2026-08-01', '2026-10-01'] })),
  cliente(6, 'Hiper Center Telecom', entregou('2026-10-05', 1, { overdue: ['2026-09-21'], dueToday: 1, nextScheduledOn: '2026-10-07' })),
  cliente(7, 'Cartão +Vitta', entregou('2026-08-09', 58)),
  // Cancelado: sem situação; vai para o arquivo, nunca para a carteira.
  cliente(8, 'Zeca', null, { isActive: false, inactiveAt: '2026-09-10T12:00:00Z' }),
];

const comCarteira = (clients) => (url) => {
  if (url.pathname === '/api/clients') {
    return {
      body: {
        ok: true,
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        months: [`${(url.searchParams.get('from') ?? HOJE).slice(0, 7)}-01`],
        clients,
        conferencia: { clientesSemLista: [], listasSemCliente: [] },
      },
    };
  }
  return null;
};

/* ─────────────────────────── leitura da tela ─────────────────────────── */

const esperarCarteira = (page) => page.locator('.pn-carteira .pn-cartao-nome').first().waitFor();
const nomes = (page) => page.$$eval('.pn-carteira .pn-cartao-nome', (els) => els.map((e) => e.textContent.trim()));
const cartao = (page, nome) =>
  page.locator('.pn-carteira .pn-cartao', { has: page.locator('.pn-cartao-nome', { hasText: nome }) });
const linha = async (page, nome) =>
  (await cartao(page, nome).locator('.pn-ultima').textContent()).replace(/\s+/g, ' ').trim();

/** Espera a carteira desenhada na ordem pedida (a troca de ordem é transição). */
const esperarPrimeiro = (page, nome) =>
  page.waitForFunction(
    (n) => document.querySelector('.pn-carteira .pn-cartao-nome')?.textContent.trim() === n,
    nome,
    { timeout: 5000 },
  );

const ATIVOS = CARTEIRA.filter((c) => c.isActive);

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('UE1', 'o cartão diz a última entrega, "sem entrega" e as peças vencidas em "Pede ação"', async (abrir) => {
    const { page, erros } = await abrir({ custom: comCarteira(CARTEIRA) });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);

    assert.equal((await nomes(page)).length, ATIVOS.length, 'cancelado fora da carteira');
    assert.ok(!(await nomes(page)).includes('Zeca'));

    const fonseca = await linha(page, 'Fonseca Moura');
    assert.equal(fonseca, 'Última entrega 05/10 · há 1 dia');
    assert.equal(await linha(page, 'CONTFIX'), 'Última entrega 06/10 · hoje');
    assert.equal(await linha(page, 'Agência Ide'), 'Última entrega 27/01 · há 252 dias');
    assert.equal(await linha(page, 'Amanda Barros'), 'Sem entrega registrada');

    const pro = (await cartao(page, 'Pró-Forma').locator('.pn-situacoes').textContent()).trim();
    assert.match(pro, /2 peças vencidas sem ✓/);
    const help = cartao(page, 'Hiper Center');
    assert.equal(await help.locator('.pn-situacoes li[data-tom="err"]').textContent(), '1 peça vencida sem ✓');
    assert.equal(await help.locator('.pn-situacoes li[data-tom="warn"]').textContent(), '1 peça vence hoje');
    // Quem não tem peça em aberto não ganha faixa.
    assert.equal(await cartao(page, 'CONTFIX').locator('.pn-situacoes').count(), 0);

    // F43 Fase 10: a 1440 a coluna se chama "Última entrega" no cabeçalho, e o
    // nome continua na linha para o leitor de tela (fora da vista).
    assert.match(await page.locator('.pn-lista-cabeca').textContent(), /Última entrega/);
    assert.equal(
      await cartao(page, 'Fonseca Moura').locator('.pn-ultima-dim').evaluate((el) => el.getBoundingClientRect().width <= 1),
      true,
      'o nome da medida sai da vista na linha quando o cabeçalho o diz',
    );

    const rotulo = await cartao(page, 'Fonseca Moura').locator('a[href^="/cliente/"]').getAttribute('aria-label');
    assert.match(rotulo, /última entrega 05\/10, há 1 dia$/);
    const rotuloSem = await cartao(page, 'Amanda Barros').locator('a[href^="/cliente/"]').getAttribute('aria-label');
    assert.match(rotuloSem, /sem entrega registrada$/);

    assert.deepEqual(erros.filter((e) => !/chat\/live|WebSocket/i.test(e)), []);
    return `Fonseca: "${fonseca}"; Pró-Forma: "${pro}"`;
  });

  await cenario('UE2', 'ordenar por "Última entrega": Agência Ide antes de CONTFIX; sem entrega no fim; vai para o endereço', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA) });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);

    const opcoes = await page.locator('#pn-ordem option').allTextContents();
    assert.ok(opcoes.includes('Última entrega'), `opções: ${opcoes.join(', ')}`);
    await page.locator('#pn-ordem').selectOption({ label: 'Última entrega' });
    await page.waitForURL(/ordem=ultimaEntrega/);
    await esperarPrimeiro(page, 'Agência Ide');

    const cresc = await nomes(page);
    assert.ok(cresc.indexOf('Agência Ide') < cresc.indexOf('CONTFIX'), cresc.join(' > '));
    assert.equal(cresc[0], 'Agência Ide', 'há mais tempo sem entregar no topo');
    assert.equal(cresc.at(-1), 'Amanda Barros', 'quem nunca entregou no fim');

    await page.locator('.pn-sentido').click();
    await page.waitForURL(/sentido=desc/);
    await esperarPrimeiro(page, 'CONTFIX');
    const desc = await nomes(page);
    assert.equal(desc.at(-1), 'Amanda Barros', 'no fim também na decrescente');

    // O endereço colado abre na mesma ordem.
    await page.goto(BASE + '/painel?ordem=ultimaEntrega');
    await esperarCarteira(page);
    await esperarPrimeiro(page, 'Agência Ide');
    assert.equal(await page.locator('#pn-ordem').inputValue(), 'ultimaEntrega');
    return `crescente: ${cresc.join(' > ')} · decrescente: ${desc.join(' > ')}`;
  });

  await cenario('UE3', 'celular 390×844: a linha "Última entrega" não corta nem empurra a página', async (abrir) => {
    const { page } = await abrir({ custom: comCarteira(CARTEIRA), viewport: { width: 390, height: 844 }, toque: true });
    await page.goto(BASE + '/painel');
    await esperarCarteira(page);
    const medidas = await page.$$eval('.pn-carteira .pn-cartao', (cartoes) =>
      cartoes.map((c) => {
        const l = c.querySelector('.pn-ultima');
        const rc = c.getBoundingClientRect();
        const rl = l.getBoundingClientRect();
        return {
          nome: c.querySelector('.pn-cartao-nome').textContent.trim(),
          dentro: rl.right <= rc.right + 0.5 && rl.left >= rc.left - 0.5,
          semCorte: l.scrollWidth <= l.clientWidth + 1,
          valor: [...l.querySelectorAll('.pn-ultima-valor')].every((v) => v.getBoundingClientRect().right <= rc.right + 0.5),
        };
      }),
    );
    const ruins = medidas.filter((m) => !m.dentro || !m.semCorte || !m.valor);
    assert.deepEqual(ruins, [], 'linha cortada ou fora do cartão');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sem rolagem lateral');
    return `${medidas.length} cartões, nenhuma linha cortada`;
  });

  return resultados;
}
