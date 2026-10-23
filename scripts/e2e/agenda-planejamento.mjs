/**
 * CALENDÁRIO, AGENDA E PLANEJAMENTO — F12 do plano UX (R06 da revisão de 28/09).
 *
 * No Chrome, com a API interceptada e dados fictícios na FORMA real de
 * `GET /api/calendar` (`src/server/calendar.ts`), `GET /api/planning`
 * (`src/server/planning.ts`) e `GET /api/planning/weeks`
 * (`src/server/planning-weeks.ts`, com os mesmos clientes):
 *
 *   AG1  mês cheio (≥ 100 conteúdos) a 1440: casas com teto, "+N" expande e
 *        recolhe o dia, semanas com a mesma altura, nome legível (sem risco)
 *        e nome acessível com cliente, tipo e estado.
 *   AG2  clicar abre o item certo (entrega e compromisso); a contagem separa
 *        conteúdo de compromisso — compromisso fora da cota.
 *   AG3  mês vazio: grade desenhada, agenda com convite; nada de zero falso.
 *   AG4  mudança de mês: ‹ › e o campo pedem a janela certa, inclusive na
 *        virada de ano; Hoje volta ao mês corrente.
 *   AG5  fusos: com o relógio no último dia do mês às 23h30 de Brasília, o
 *        mês e o "Hoje" são os da agência em Tóquio, Los Angeles e São Paulo;
 *        a entrada do dia 30 e a do dia 1 caem nas casas delas.
 *   AG6  falha ao salvar: a janela fica aberta com a frase do servidor.
 *   AG7  celular 390×844: abre na agenda, sem rolagem lateral, nomes inteiros;
 *        a grade vira resumo e tocar num dia leva a ele na agenda.
 *        (F43, Fase 4: AG1–AG7 continuam abrindo `/calendario`, que agora leva
 *        a `/planejamento?visao=calendario` — o endereço antigo é a prova de
 *        que nada se perdeu. AG1 confere o desvio; AG15, o resto.)
 *   AG8  planejamento (F43, Fase 2): abre na visão Contrato — a faixa
 *        "Precisa de atenção" com o motivo escrito e uma ação, a carteira por
 *        responsável (o cliente de dois nos dois grupos), a barra de três
 *        partes; a 390 a página não rola de lado e a tabela rola dentro dela.
 *        (Antes da F43 era a lista do ritual — as chaves vão para o painel do
 *        cliente na Fase 3.) Fase 4: o resumo por etapa e o "Só o que falta"
 *        da antiga aba Mês voltam, na linha do filtro.
 *   AG9  o mesmo mês nas visões Contrato e Semanas; `?aba=semana` antigo abre
 *        Semanas; fora do mês de hoje a faixa fala do mês e a coluna da semana
 *        some; a falha de um mês diz o mês e não deixa números de outro.
 *   AG10 `+ Peça` no topo do Planejamento: a janela e a lista do `+ Marcar` do
 *        Calendário; marcar grava `POST /items` e o mês relê.
 *   AG11 painel do cliente (F43, Fase 3): clicar no nome na visão Contrato
 *        abre o painel ao lado (diálogo com o nome do cliente, `?cliente=`);
 *        o Tab fica dentro; Esc, ✕ e o véu fecham; o foco volta ao nome e a
 *        página não rola.
 *   AG12 `/planejamento?cliente=p-2` abre direto; trocar o mês no painel troca
 *        o da página e o painel acompanha; cliente fora do mês: frase calma.
 *   AG13 "Planejamento OK" (admin) grava `POST …/planning`, o mês relê e a
 *        chave fica ligada; a recusa (403) mostra a frase do servidor e a
 *        chave volta; quem não administra vê as chaves desligadas com o porquê.
 *   AG14 celular 390×844: o painel cobre a tela, a página não rola de lado e
 *        o corpo do painel rola dentro dele.
 *   AG15 o Calendário dentro do Planejamento (F43, Fase 4): `/calendario?mes=`
 *        abre a visão Calendário naquele mês; um controle de mês só e uma ação
 *        só no topo (`+ Marcar` aqui, `+ Peça` nas outras); trocar de visão não
 *        perde o mês; a barra acende Calendário nesta visão e Planejamento nas
 *        outras; a peça abre a janela de sempre; F5 mantém o mês.
 *
 *   AG16 a recusa atrasada de outubro não aparece no painel de novembro.
 *   AG17 abrir o mês e fechar o painel antes da resposta: a lista de trás é
 *        relida (o cliente sai de "mês não aberto" sem recarregar a página).
 *   AG18 apagar uma entrega concluída pela janela pergunta antes; a por
 *        fazer apaga direto.
 *
 * `AGENDA_CAPTURAS=<pasta>` grava as capturas (cheio, vazio, agenda 390, mês
 * 390, planejamento 1440/390) em claro e escuro.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, pause } from './comum.mjs';

/* ─────────────────────────── fixtures ─────────────────────────── */

const TIPOS = ['video', 'arte', 'foto', 'ads'];
const CLIENTES = [
  'Horizonte Studio', 'Aurora Mercado', 'Instituto Vila Nova', 'Casa das Flores', 'Café do Bairro',
  'Norte Arquitetura', 'Estúdio Jardim', 'Projeto Caminhos', 'Padaria Bom Grão', 'Oficina Ribeira',
  'Livraria Sete Mares', 'Clínica Horizonte Azul Odontologia Integrada',
].map((nome, i) => ({ id: `cl-${i + 1}`, nome }));
const TITULOS = ['Campanha de primavera', null, 'Bastidores da produção', 'Depoimento de cliente', null, 'Lançamento da coleção'];

/** Quantos dias tem `AAAA-MM`. */
const diasNoMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
};
const pad = (n) => String(n).padStart(2, '0');

/**
 * O mês cheio: 110 entregas concentradas na primeira quinzena (como no mês
 * real da revisão), metade concluída, dois extras e três compromissos.
 */
export function mesCheio(mes) {
  const total = diasNoMes(mes);
  const entradas = [];
  for (let i = 0; i < 110; i++) {
    // 70% nos dias 1–15, o resto espalhado.
    const dia = i < 77 ? 1 + (i % 15) : 16 + ((i * 7) % (total - 15));
    const c = CLIENTES[i % CLIENTES.length];
    entradas.push({
      kind: 'delivery', id: `it-${mes}-${i}`, clientId: c.id, clientName: c.nome,
      contentType: TIPOS[i % 4], day: `${mes}-${pad(dia)}`, time: null,
      title: TITULOS[i % TITULOS.length], isExtra: i % 37 === 5, isCompleted: i % 2 === 0, notes: null,
    });
  }
  entradas.push(
    { kind: 'appointment', id: 'ap-1', clientId: 'cl-1', clientName: CLIENTES[0].nome, contentType: '', day: `${mes}-03`, time: '10:00', title: 'Reunião de pauta', isExtra: false, isCompleted: false, notes: 'Levar o roteiro' },
    { kind: 'appointment', id: 'ap-2', clientId: 'cl-2', clientName: CLIENTES[1].nome, contentType: '', day: `${mes}-18`, time: null, title: 'Gravação na loja', isExtra: false, isCompleted: false, notes: null },
    { kind: 'appointment', id: 'ap-3', clientId: 'cl-3', clientName: CLIENTES[2].nome, contentType: '', day: `${mes}-${pad(total)}`, time: '15:30', title: 'Entrega do ensaio', isExtra: false, isCompleted: false, notes: null },
  );
  return entradas;
}

/** Só a entrada do primeiro e do último dia — para as provas de fuso. */
const bordas = (mes) => {
  const total = diasNoMes(mes);
  return [
    { kind: 'delivery', id: `borda-1-${mes}`, clientId: 'cl-1', clientName: 'Primeiro do mês', contentType: 'arte', day: `${mes}-01`, time: null, title: 'No dia 1', isExtra: false, isCompleted: false, notes: null },
    { kind: 'delivery', id: `borda-f-${mes}`, clientId: 'cl-2', clientName: 'Último do mês', contentType: 'video', day: `${mes}-${pad(total)}`, time: null, title: 'No último dia', isExtra: false, isCompleted: false, notes: null },
  ];
};

/** `/api/calendar` com a mesma janela `[from, to)` do servidor. */
export const comCalendario = (gerar, { pedidos, recusar } = {}) => (url, req) => {
  const p = url.pathname;
  if (p === '/api/calendar') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    pedidos?.push({ from, to, client: url.searchParams.get('client') });
    const meses = new Set([from.slice(0, 7), to.slice(0, 7)]);
    const entries = [...meses].flatMap((m) => gerar(m)).filter((e) => e.day >= from && e.day < to);
    return { body: { ok: true, entries } };
  }
  if (p === '/api/admin/clients') return { body: { ok: true, clientes: CLIENTES } };
  if (recusar) {
    const r = recusar(url, req);
    if (r) return r;
  }
  return null;
};

const semRolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const errosReais = (erros) => erros.filter((e) => !/chat\/live|WebSocket|Failed to load resource/i.test(e));

const esperarGrade = (page) => page.locator('.cal-grade .cal-casa[data-dia]').first().waitFor();

/**
 * Espera o último pedido de `/api/calendar` cumprir `cond` (até 5 s). A casa
 * do mês aparece no mesmo desenho que dispara o pedido — antes de ele ser
 * interceptado; desde a F43 (Fase 4) a tela do calendário é o Planejamento,
 * que lê mais coisas ao mesmo tempo, e a folga ficou visível.
 */
const ultimoPedido = async (pedidos, cond) => {
  for (let i = 0; i < 50 && !(pedidos.length && cond(pedidos.at(-1))); i++) await pause(100);
  return pedidos.at(-1);
};

/** Hoje no fuso da agência, como a tela calcula. */
const hojeSP = (agora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);

/* ─────────────────────────── planejamento ─────────────────────────── */

const PLANO = { id: 'pl-basico', name: 'Básico', colorBg: '#eef2ee', colorText: '#3b5a41', colorBorder: '#cfdcd1' };
const linhaPl = (id, name, o = {}) => ({
  id, name, categoryId: 'c1', categoryName: 'Ide', plan: PLANO,
  monthOpened: true, planningDoneAt: null, clientApprovedAt: null, ...o,
});
const PLANEJAMENTO = [
  linhaPl('p-1', 'Aurora Mercado', { monthOpened: false }),
  linhaPl('p-2', 'Café do Bairro'),
  linhaPl('p-3', 'Estúdio Jardim', { planningDoneAt: '2026-09-02T12:00:00Z' }),
  linhaPl('p-4', 'Horizonte Studio', { planningDoneAt: '2026-09-02T12:00:00Z', clientApprovedAt: '2026-09-04T12:00:00Z' }),
  linhaPl('p-5', 'Norte Arquitetura', { plan: null }),
  linhaPl('p-6', 'Livraria Sete Mares', { planningDoneAt: '2026-09-02T12:00:00Z', clientApprovedAt: '2026-09-05T12:00:00Z' }),
];

/* AS SEMANAS DOS MESMOS CLIENTES — F43, Fase 2. A visão Contrato junta as duas
   leituras pelo id: os seis de `PLANEJAMENTO`, com responsáveis, contrato e
   peças. Os dias são do mês pedido, então o mês seguinte também tem o que
   mostrar. Com hoje em 07/10/2026 (semana 2, 05–11), a carteira é a do teste
   de tela `src/painel/visao-do-contrato.test.ts`:
     Aurora     Helena        mês não aberto (contrato do cadastro) → Abrir o mês
     Café       Carla         nada marcado na semana, muito sem dia → Planejar
     Estúdio    Carla         uma arte vencida no dia 5             → Ver peças
     Horizonte  Helena        em dia                                → fora da faixa
     Norte      ninguém       sem contrato                          → fora da faixa
     Livraria   Carla+Helena  5 das 8 artes sem dia                 → Planejar */
export const CARLA = { id: 'u-carla', name: 'Carla' };
export const HELENA = { id: 'u-helena', name: 'Helena' };
const pecaPl = (mes, id, tipo, dia, feita = false) => ({
  id: `${id}-${mes}`, contentType: tipo,
  scheduledAt: dia ? `${mes}-${pad(dia)}T12:00:00Z` : null,
  completedAt: feita && dia ? `${mes}-${pad(dia)}T15:00:00Z` : null,
  isExtra: false, title: null,
});
const semanaPl = (id, o) => {
  const { name } = PLANEJAMENTO.find((l) => l.id === id);
  return {
    id, name, categoryId: 'c1', categoryName: 'Ide', plan: PLANO,
    owners: [], quotaSource: 'contrato', quota: {}, hasContentContract: true, items: [], ...o,
  };
};
export const semanasDoPlanejamento = (mes) => [
  semanaPl('p-1', { owners: [HELENA], quotaSource: 'cadastro', quota: { arte: 4, video: 2 } }),
  semanaPl('p-2', {
    owners: [CARLA], quota: { arte: 8, video: 4 },
    items: [pecaPl(mes, 'cafe-1', 'arte', 2, true), pecaPl(mes, 'cafe-2', 'arte', 20)],
  }),
  semanaPl('p-3', {
    owners: [CARLA], quota: { arte: 4, foto: 2 },
    items: [
      pecaPl(mes, 'est-1', 'arte', 5), pecaPl(mes, 'est-2', 'arte', 8), pecaPl(mes, 'est-3', 'arte', 15),
      pecaPl(mes, 'est-4', 'arte', 22), pecaPl(mes, 'est-5', 'foto', 9), pecaPl(mes, 'est-6', 'foto', 16),
    ],
  }),
  semanaPl('p-4', {
    owners: [HELENA], quota: { video: 2, arte: 4 },
    items: [
      pecaPl(mes, 'hor-1', 'arte', 6, true), pecaPl(mes, 'hor-2', 'arte', 13), pecaPl(mes, 'hor-3', 'arte', 20),
      pecaPl(mes, 'hor-4', 'arte', 27), pecaPl(mes, 'hor-5', 'video', 6, true), pecaPl(mes, 'hor-6', 'video', 14),
    ],
  }),
  semanaPl('p-5', { hasContentContract: false }),
  semanaPl('p-6', {
    owners: [CARLA, HELENA], quota: { arte: 8 },
    items: [pecaPl(mes, 'liv-1', 'arte', 2, true), pecaPl(mes, 'liv-2', 'arte', 6, true), pecaPl(mes, 'liv-3', 'arte', 8)],
  }),
];

/**
 * `/api/planning` e `/api/planning/weeks` com os mesmos clientes, e as
 * escritas do ritual. `falharSemanas(mes)` devolve uma resposta de erro para
 * a leitura das semanas daquele mês (`YYYY-MM`), ou nada. `leituras` recebe o
 * mês de cada `GET /planning/weeks`; `criadas`, o corpo de cada `POST /items`
 * (só com ela a rota de criar responde aqui).
 */
export const comPlanejamento = ({ escritas, recusar, falharSemanas, leituras, criadas, gravadas, demorarAbertura } = {}) => (url, req) => {
  const p = url.pathname;
  // `gravadas` (F43, Fase 3): um mapa id → marcas do ritual que as escritas
  // aceitas vão preenchendo, para a releitura mostrar o que se gravou.
  const ritual = gravadas ? PLANEJAMENTO.map((l) => ({ ...l, ...(gravadas[l.id] ?? {}) })) : PLANEJAMENTO;
  if (p === '/api/planning') return { body: { ok: true, month: url.searchParams.get('month'), clients: ritual } };
  if (p === '/api/planning/weeks') {
    const mes = (url.searchParams.get('month') ?? '').slice(0, 7);
    leituras?.push(mes);
    const falha = falharSemanas?.(mes);
    if (falha) return falha;
    return { body: { ok: true, month: `${mes}-01`, clients: semanasDoPlanejamento(mes) } };
  }
  // A lista do `+ Peça` — a mesma rota do `+ Marcar` do Calendário.
  if (p === '/api/admin/clients') return { body: { ok: true, clientes: PLANEJAMENTO.map((l) => ({ id: l.id, nome: l.name })) } };
  if (p === '/api/items' && req.method() === 'POST' && criadas) {
    criadas.push(req.postDataJSON());
    return { body: { ok: true, id: `nova-${criadas.length}` } };
  }
  const marco = /^\/api\/clients\/([^/]+)\/months\/([^/]+)\/(open|planning|approval)$/.exec(p);
  if (marco) {
    escritas?.push({ metodo: req.method(), cliente: marco[1], mes: marco[2], passo: marco[3] });
    const r = recusar?.(marco);
    if (r) return r;
    // Abrir o mês: com `gravadas`, a releitura passa a trazer o mês aberto.
    // `demorarAbertura()` devolve a promessa que segura a resposta (o teste a solta).
    if (gravadas && marco[3] === 'open') {
      const abrirOMes = () => {
        gravadas[marco[1]] = { ...gravadas[marco[1]], monthOpened: true };
        return { body: { ok: true } };
      };
      const espera = demorarAbertura?.();
      return espera ? espera.then(abrirOMes) : abrirOMes();
    }
    if (gravadas && marco[3] !== 'open') {
      const campo = marco[3] === 'planning' ? 'planningDoneAt' : 'clientApprovedAt';
      gravadas[marco[1]] = { ...gravadas[marco[1]], [campo]: req.method() === 'POST' ? '2026-10-07T15:00:00Z' : null };
    }
    return { body: { ok: true } };
  }
  return null;
};

/* ─────────────────────────── a suíte ─────────────────────────── */

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);
  const CAPTURAS = process.env.AGENDA_CAPTURAS ?? '';
  const MES = hojeSP().slice(0, 7);

  await cenario('AG1', 'mês cheio a 1440: teto por casa, "+N" expande, semanas iguais, nome legível e nome acessível completo', async (abrir) => {
    const { page, erros } = await abrir({ custom: comCalendario(mesCheio) });
    await page.goto(BASE + '/calendario');
    await esperarGrade(page);
    await page.locator('.cal-pastilha').first().waitFor();
    // F43 Fase 4: `/calendario` leva à visão Calendário do Planejamento, sem
    // deixar o desvio no histórico.
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/planejamento?visao=calendario');
    assert.equal(await page.getByRole('tab', { name: 'Calendário', exact: true }).getAttribute('aria-selected'), 'true');
    const esperado = mesCheio(MES);

    // Teto: nenhuma casa com mais de 4 linhas (3 + "+N" ou até 4 pastilhas).
    const casas = await page.$$eval('.cal-grade .cal-casa[data-dia]', (els) =>
      els.map((c) => ({ dia: c.dataset.dia, n: c.querySelectorAll('.cal-pastilha').length, mais: c.querySelector('.cal-mais')?.textContent ?? null, topo: Math.round(c.getBoundingClientRect().top), altura: Math.round(c.getBoundingClientRect().height) })),
    );
    assert.ok(casas.every((c) => c.n <= 4), `casa acima do teto: ${JSON.stringify(casas.find((c) => c.n > 4))}`);
    // Soma: pastilhas visíveis + escondidos = total do mês.
    const escondidos = casas.reduce((s, c) => s + (c.mais ? Number(/\+(\d+)/.exec(c.mais)[1]) : 0), 0);
    const visiveis = casas.reduce((s, c) => s + c.n, 0);
    assert.equal(visiveis + escondidos, esperado.length, 'nada some: visíveis + "+N" = entradas do mês');
    // Semanas com a mesma altura (antes de expandir).
    const alturas = [...new Set(casas.map((c) => c.altura))];
    assert.equal(alturas.length, 1, `alturas das casas: ${alturas.join(', ')}`);

    // Nome legível: nenhum risco; concluído tem visto e estado no nome.
    const decoracoes = await page.$$eval('.cal-pastilha', (els) => [...new Set(els.map((e) => getComputedStyle(e).textDecorationLine))]);
    assert.deepEqual(decoracoes, ['none']);
    const feita = page.locator('.cal-pastilha[data-estado="concluido"]').first();
    assert.equal(await feita.locator('.cal-visto').count(), 1);
    const nome = await feita.getAttribute('aria-label');
    assert.match(nome, /^.+ — (Vídeo|Arte|Foto|Ads) (“.+”|sem título), dia \d\d\/\d\d(, extra)?, concluído$/, nome);

    // "+N" expande o dia ali mesmo e recolhe.
    const cheia = casas.find((c) => c.mais);
    const casa = page.locator(`.cal-casa[data-dia="${cheia.dia}"]`);
    const totalDoDia = esperado.filter((e) => e.day === cheia.dia).length;
    const botao = casa.locator('.cal-mais');
    assert.equal(await botao.getAttribute('aria-expanded'), 'false');
    await botao.click();
    assert.equal(await casa.locator('.cal-pastilha').count(), totalDoDia);
    assert.equal(await botao.getAttribute('aria-expanded'), 'true');
    await botao.click();
    assert.equal(await casa.locator('.cal-pastilha').count(), 3);

    // Hoje marcado.
    const hoje = page.locator('.cal-casa[aria-current="date"]');
    assert.equal(await hoje.count(), 1);
    assert.equal(await hoje.getAttribute('data-dia'), hojeSP());
    assert.ok(await semRolagemLateral(page));
    assert.deepEqual(errosReais(erros), []);
    return `${esperado.length} entradas: ${visiveis} visíveis + ${escondidos} em "+N"; casa ${cheia.dia} expande para ${totalDoDia}`;
  });

  await cenario('AG2', 'clicar abre o item certo; compromisso tem janela própria e fica fora da contagem de conteúdo', async (abrir) => {
    const { page } = await abrir({ custom: comCalendario(mesCheio) });
    await page.goto(BASE + '/calendario');
    await page.locator('.cal-pastilha').first().waitFor();
    const esperado = mesCheio(MES);
    const entregas = esperado.filter((e) => e.kind === 'delivery');
    const contagem = (await page.locator('.cal-contagem').textContent()).trim();
    assert.equal(
      contagem,
      `${entregas.length} conteúdo(s) agendado(s) · ${entregas.filter((e) => e.isCompleted).length} concluído(s) · 3 compromisso(s) — fora da cota`,
    );

    // Entrega: uma pastilha pendente com título abre a janela com o nome dela.
    const alvo = entregas.find((e) => !e.isCompleted && e.title);
    await page.locator(`.cal-pastilha[data-entrada="delivery:${alvo.id}"]`).click();
    const janela = page.getByRole('dialog');
    await janela.waitFor();
    assert.equal(await janela.getByRole('heading').first().textContent(), 'Entrega');
    assert.equal(await janela.getByLabel('Nome').inputValue(), alvo.title);
    assert.match(await janela.textContent(), new RegExp(`${alvo.day.slice(8, 10)}/${alvo.day.slice(5, 7)}/${alvo.day.slice(0, 4)}`));
    assert.match(await janela.textContent(), new RegExp(`Abrir a ficha de ${alvo.clientName}`));
    await janela.getByRole('button', { name: 'Cancelar' }).click();
    await janela.waitFor({ state: 'detached' });

    // Compromisso: abre como compromisso, com hora e observação.
    await page.locator('.cal-pastilha[data-entrada="appointment:ap-1"]').click();
    await janela.waitFor();
    assert.equal(await janela.getByRole('heading').first().textContent(), 'Compromisso');
    assert.equal(await janela.getByLabel('Hora').inputValue(), '10:00');
    assert.equal(await janela.getByLabel('Observação').inputValue(), 'Levar o roteiro');
    await page.keyboard.press('Escape');
    await janela.waitFor({ state: 'detached' });

    // Na agenda, o MESMO clique abre o mesmo item.
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await page.locator('.cal-linha').first().waitFor();
    await page.locator(`.cal-linha[data-entrada="delivery:${alvo.id}"]`).click();
    await janela.waitFor();
    assert.equal(await janela.getByLabel('Nome').inputValue(), alvo.title);
    return contagem;
  });

  await cenario('AG3', 'mês vazio: grade desenhada e agenda com convite para marcar', async (abrir) => {
    const { page, erros } = await abrir({ custom: comCalendario(() => []) });
    await page.goto(BASE + '/calendario');
    await esperarGrade(page);
    await page.waitForFunction(() => document.querySelector('.cal-contagem')?.textContent.trim() === '0 conteúdo(s) agendado(s)');
    assert.equal(await page.locator('.cal-casa[data-dia]').count(), diasNoMes(MES));
    assert.equal(await page.locator('.cal-pastilha').count(), 0);
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    const vazio = page.locator('[data-estado="vazio"]');
    await vazio.waitFor();
    assert.match(await vazio.textContent(), /Nada marcado em .+ de \d{4}\..*\+ Marcar/);
    assert.deepEqual(errosReais(erros), []);
    return (await vazio.textContent()).trim();
  });

  await cenario('AG4', 'mudança de mês: ‹ › e o campo pedem a janela certa, com virada de ano; Hoje volta', async (abrir) => {
    const pedidos = [];
    const { page } = await abrir({ custom: comCalendario(bordas, { pedidos }) });
    await page.goto(BASE + '/calendario');
    await esperarGrade(page);
    /* O PEDIDO CERTO DEPOIS DE CADA GESTO — F43, Fase 4. Dentro do
       Planejamento a tela lê mais coisas ao mesmo tempo (as duas leituras do
       mês e a lista de clientes), e a interceptação de um pedido pode chegar
       depois da do seguinte: "o último pedido" deixou de ser uma pergunta
       estável. A pergunta é a de sempre — o gesto pediu a janela certa? —, e
       quem garante que resposta atrasada não pinta outro mês é `vez`
       (`useConteudosDoMes`), conferido pelas casas e pastilhas abaixo. */
    const pediu = async (antes, esperado) => {
      const igual = (p) => JSON.stringify(p) === JSON.stringify(esperado);
      for (let i = 0; i < 50 && !pedidos.slice(antes).some(igual); i++) await pause(100);
      assert.ok(pedidos.slice(antes).some(igual), `pediu ${JSON.stringify(esperado)}? ${JSON.stringify(pedidos.slice(antes))}`);
    };
    const campo = page.getByLabel('Mês do calendário');
    let antes = pedidos.length;
    await campo.fill('2026-12');
    await page.waitForFunction(() => document.querySelector('.cal-casa[data-dia="2026-12-31"]'));
    await pediu(antes, { from: '2026-12-01', to: '2027-01-01', client: null });
    antes = pedidos.length;
    await page.getByRole('button', { name: 'Próximo mês' }).click();
    await page.locator('.cal-casa[data-dia="2027-01-31"]').waitFor();
    await pediu(antes, { from: '2027-01-01', to: '2027-02-01', client: null });
    assert.equal(await campo.inputValue(), '2027-01');
    // A entrada do dia 1 e a do dia 31 estão nas casas delas.
    assert.equal(await page.locator('.cal-casa[data-dia="2027-01-01"] .cal-pastilha').getAttribute('data-entrada'), 'delivery:borda-1-2027-01');
    assert.equal(await page.locator('.cal-casa[data-dia="2027-01-31"] .cal-pastilha').getAttribute('data-entrada'), 'delivery:borda-f-2027-01');
    antes = pedidos.length;
    await page.getByRole('button', { name: 'Mês anterior' }).click();
    await page.getByRole('button', { name: 'Mês anterior' }).click();
    await page.locator('.cal-casa[data-dia="2026-11-30"]').waitFor();
    await pediu(antes, { from: '2026-11-01', to: '2026-12-01', client: null });
    // Fevereiro de ano não bissexto: 28 casas.
    await campo.fill('2027-02');
    await page.locator('.cal-casa[data-dia="2027-02-28"]').waitFor();
    assert.equal(await page.locator('.cal-casa[data-dia]').count(), 28);
    await page.getByRole('button', { name: /^Hoje/ }).click();
    await page.locator(`.cal-casa[data-dia="${hojeSP()}"]`).waitFor();
    assert.equal(await campo.inputValue(), MES);
    return pedidos.map((p) => p.from).join(' → ');
  });

  for (const fuso of ['America/Sao_Paulo', 'Asia/Tokyo', 'America/Los_Angeles']) {
    await cenario(`AG5-${fuso.split('/')[1]}`, `fuso ${fuso}: último dia do mês às 23h30 de Brasília abre no mês da agência`, async (abrir) => {
      const pedidos = [];
      const { page } = await abrir({ custom: comCalendario(bordas, { pedidos }), timezoneId: fuso });
      // 30/09/2026 23:30 em Brasília = 01/10 02:30 UTC = 01/10 11:30 em Tóquio.
      await page.clock.setFixedTime(new Date('2026-10-01T02:30:00Z'));
      await page.goto(BASE + '/calendario');
      await page.locator('.cal-casa[data-dia="2026-09-30"]').waitFor();
      const setembro = await ultimoPedido(pedidos, (p) => p.from === '2026-09-01');
      assert.equal(setembro?.from, '2026-09-01', `pediu ${JSON.stringify(setembro)}`);
      assert.equal(await page.getByLabel('Mês do calendário').inputValue(), '2026-09');
      assert.equal(await page.locator('.cal-casa[aria-current="date"]').getAttribute('data-dia'), '2026-09-30');
      assert.equal(await page.locator('.cal-casa[data-dia="2026-09-30"] .cal-pastilha').getAttribute('data-entrada'), 'delivery:borda-f-2026-09');
      assert.equal(await page.locator('.cal-casa[data-dia="2026-09-01"] .cal-pastilha').getAttribute('data-entrada'), 'delivery:borda-1-2026-09');
      // Meia hora depois da meia-noite de Brasília já é outubro.
      await page.clock.setFixedTime(new Date('2026-10-01T03:30:00Z'));
      await page.reload();
      await page.locator('.cal-casa[data-dia="2026-10-31"]').waitFor();
      assert.equal((await ultimoPedido(pedidos, (p) => p.from === '2026-10-01'))?.from, '2026-10-01');
      assert.equal(await page.locator('.cal-casa[aria-current="date"]').getAttribute('data-dia'), '2026-10-01');
      return 'set → 30/09 marcado; out → 01/10 marcado';
    });
  }

  await cenario('AG6', 'falha ao salvar: a janela fica aberta, com a frase do servidor, e nada é redesenhado', async (abrir) => {
    const pedidos = [];
    const recusar = (url, req) =>
      url.pathname === '/api/appointments' && req.method() === 'POST'
        ? { status: 500, body: { ok: false, message: 'O servidor recusou o compromisso (simulado).' } }
        : null;
    const { page } = await abrir({ custom: comCalendario(bordas, { pedidos, recusar }) });
    await page.goto(BASE + '/calendario');
    await esperarGrade(page);
    await page.locator('.cal-pastilha').first().waitFor();
    const antes = pedidos.length;
    await page.getByRole('button', { name: 'Marcar no dia 10', exact: true }).click();
    const janela = page.getByRole('dialog');
    await janela.waitFor();
    await janela.getByRole('button', { name: /Compromisso/ }).click();
    await janela.getByLabel('Cliente').selectOption('cl-2');
    await janela.getByLabel('Nome').fill('Reunião que falha');
    await janela.getByRole('button', { name: 'Marcar', exact: true }).click();
    await janela.getByText('O servidor recusou o compromisso (simulado).').waitFor();
    assert.ok(await janela.isVisible(), 'a janela continua aberta');
    assert.equal(await janela.getByLabel('Nome').inputValue(), 'Reunião que falha', 'o que foi digitado fica');
    await pause(200);
    assert.equal(pedidos.length, antes, 'a grade não relê o mês depois da recusa');
    return 'recusa exibida na janela; rascunho mantido';
  });

  await cenario('AG7', 'celular 390×844: abre na agenda, nomes inteiros, grade em resumo leva ao dia', async (abrir) => {
    const { page, erros } = await abrir({ custom: comCalendario(mesCheio), viewport: { width: 390, height: 844 } });
    await page.goto(BASE + '/calendario');
    await page.locator('.cal-agenda-dia').first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Agenda', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.ok(await semRolagemLateral(page), 'agenda sem rolagem lateral');
    // Nome inteiro: nenhuma linha cortada.
    const cortados = await page.$$eval('.cal-linha-nome, .cal-linha-titulo', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    assert.equal(cortados, 0);
    // Todas as entradas estão na agenda.
    assert.equal(await page.locator('.cal-linha').count(), mesCheio(MES).length);
    // Hoje está na agenda.
    assert.equal(await page.locator('.cal-agenda-dia[aria-current="date"]').count(), 1);
    // Alvos de toque dos controles da barra ≥ 24px (W02).
    const alvos = await page.$$eval('.cal-barra button, .cal-barra input', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    assert.ok(alvos.every((a) => a >= 24), `alvo menor que 24px: ${alvos.join(',')}`);

    // A grade no celular: resumo por dia; tocar leva ao dia na agenda.
    await page.getByRole('button', { name: 'Mês', exact: true }).click();
    await esperarGrade(page);
    assert.equal(await page.getByRole('button', { name: 'Mês', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.ok(await semRolagemLateral(page), 'grade sem rolagem lateral');
    assert.equal(await page.locator('.cal-pastilha').first().isVisible(), false, 'no celular a grade não escreve nomes');
    const dia = `${MES}-05`;
    await page.locator(`.cal-casa[data-dia="${dia}"] .cal-resumo`).click();
    await page.locator(`.cal-agenda-dia[data-dia="${dia}"]`).waitFor();
    await page.waitForFunction((d) => document.activeElement?.closest('.cal-agenda-dia')?.getAttribute('data-dia') === d, dia);
    assert.deepEqual(errosReais(erros), []);
    return `${mesCheio(MES).length} linhas na agenda; tocar no dia 5 leva ao dia 5`;
  });

  /* O PLANEJAMENTO — F43, Fase 2. Abre na visão Contrato. O relógio é fixo
     (quarta, 07/10/2026, 12h de Brasília): a faixa fala da semana 2. */
  const AGORA_PL = new Date('2026-10-07T15:00:00Z');
  const abrirPlanejamento = async (abrir, opcoes = {}, caminho = '/planejamento') => {
    const s = await abrir({ custom: comPlanejamento(opcoes.servidor), ...opcoes });
    await s.page.clock.setFixedTime(AGORA_PL);
    await s.page.goto(BASE + caminho);
    return s;
  };
  const textoDe = (loc) => loc.evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));

  await cenario('AG8', 'planejamento abre em Contrato: faixa com motivo e uma ação, grupos por responsável, barras; 390 sem rolagem lateral', async (abrir) => {
    const { page, erros } = await abrirPlanejamento(abrir);
    await page.locator('.plc-tabela').waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Contrato', exact: true }).getAttribute('aria-selected'), 'true', 'abre na visão Contrato');
    // A lista do ritual (aba Mês) saiu: nenhuma chave na tela.
    assert.equal(await page.getByRole('checkbox').count(), 0, 'as chaves do ritual não moram mais aqui');

    // A FAIXA: quem está atrás, com o motivo escrito e UMA ação.
    const faixa = page.locator('[data-bloco="atencao"]');
    assert.equal((await faixa.getByRole('heading').textContent()).trim(), 'Precisa de atenção esta semana');
    assert.equal((await faixa.locator('.plc-faixa-detalhe').textContent()).trim(), '4 clientes · semana 2, de 5 a 11 de outubro');
    const alertas = await faixa.locator('.plc-alerta').evaluateAll((els) =>
      els.map((e) => ({
        nome: e.querySelector('.plc-alerta-nome').textContent,
        motivo: e.querySelector('.plc-alerta-motivo').textContent,
        tom: e.dataset.tom,
        acoes: [...e.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
      })),
    );
    // Fase 3: cada ação abre o painel do cliente ao lado (`?cliente=`).
    assert.deepEqual(alertas.map((a) => [a.nome, a.tom, a.acoes]), [
      ['Aurora Mercado', 'warn', [['Abrir o mês', '/planejamento?cliente=p-1']]],
      ['Café do Bairro', 'warn', [['Planejar', '/planejamento?cliente=p-2']]],
      ['Estúdio Jardim', 'err', [['Ver peças', '/planejamento?cliente=p-3']]],
      ['Livraria Sete Mares', 'warn', [['Planejar', '/planejamento?cliente=p-6']]],
    ]);
    assert.equal(alertas[0].motivo, 'O mês de outubro ainda não foi aberto.');
    assert.match(alertas[1].motivo, /^Nada marcado esta semana\. O contrato pede 1 vídeo e 2 artes\./);
    assert.equal(alertas[2].motivo, '1 peça passou do dia sem entrega.');
    assert.equal(alertas[3].motivo, '5 das 8 artes do mês ainda estão sem dia.');
    // O nome acessível da ação diz de quem é.
    await faixa.getByRole('link', { name: 'Planejar Café do Bairro', exact: true }).waitFor();

    // A TABELA: por responsável, o cliente de dois responsáveis nos dois grupos.
    assert.deepEqual(await textoDe(page.locator('.plc-grupo-cabeca')), ['Carla · 3 clientes', 'Helena · 3 clientes', 'Sem responsável · 1 cliente']);
    assert.equal(await page.locator('.plc-linha[data-cliente="p-6"]').count(), 2, 'Livraria em Carla e em Helena');
    // Só as colunas de tipo que existem no mês (sem ads) e "Esta semana", porque é o mês de hoje.
    assert.deepEqual(await textoDe(page.locator('.plc-tabela thead th')), ['Cliente', 'Mês do cliente', 'Vídeo', 'Arte', 'Foto', 'Esta semana']);
    // A barra de três partes: Livraria, 2 entregues, 1 marcada, 5 sem dia.
    const arte = page.locator('.plc-grupo[data-grupo="u-carla"] .plc-linha[data-cliente="p-6"] td[data-tipo="arte"]');
    assert.equal((await arte.locator('.plc-leg').textContent()).replace(/\s+/g, ' ').trim(), '2 de 8 · 5 sem dia');
    const partes = await arte.locator('.plc-barra > span').evaluateAll((els) => els.map((e) => [e.dataset.parte, e.getBoundingClientRect().width]));
    assert.deepEqual(partes.map(([p]) => p), ['entregue', 'marcada', 'sem-dia']);
    const [entregue, marcada, semDia] = partes.map(([, w]) => w);
    assert.ok(Math.abs(entregue - 2 * marcada) <= 2 && Math.abs(semDia - 5 * marcada) <= 3, `larguras 2:1:5 — ${partes.map(([, w]) => Math.round(w)).join(':')}`);
    // A semana do cliente, com cor só no que é motivo.
    const semana = (id) => page.locator(`.plc-grupo[data-grupo="u-carla"] .plc-linha[data-cliente="${id}"] .plc-semana span`);
    assert.equal(await semana('p-2').textContent(), 'nada marcado');
    assert.equal(await semana('p-3').textContent(), '1 atrasada');
    assert.equal(await semana('p-3').getAttribute('data-tom'), 'err');
    // Quem não tem contrato diz isso, e não entra na faixa.
    assert.equal((await page.locator('.plc-linha[data-cliente="p-5"] .plc-sem-contrato').textContent()).trim(), 'sem contrato');
    // Sem moldura por linha.
    assert.equal(await page.locator('.plc-tabela .o-card, .plc-faixa .o-card').count(), 0);

    // F43 Fase 4: O RESUMO POR ETAPA E O "SÓ O QUE FALTA" DA ANTIGA ABA MÊS, de
    // volta na linha do filtro. Aurora não abriu; Café e Norte falta planejar;
    // Estúdio falta aprovar; Horizonte e Livraria aprovados.
    const resumo = page.locator('.plc-ferramentas .plc-resumo li');
    assert.deepEqual(await textoDe(resumo), ['Mês não aberto 1', 'Falta planejar 2', 'Falta aprovar 1', 'Aprovados 2']);
    const soFalta = page.getByRole('button', { name: 'Só o que falta', exact: true });
    assert.equal(await soFalta.getAttribute('aria-pressed'), 'false');
    await soFalta.click();
    assert.equal(await soFalta.getAttribute('aria-pressed'), 'true');
    await page.locator('.plc-linha[data-cliente="p-4"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.plc-linha[data-cliente="p-6"]').count(), 0, 'os aprovados saem da tabela');
    assert.deepEqual(await textoDe(page.locator('.plc-grupo-cabeca')), ['Carla · 2 clientes', 'Helena · 1 cliente', 'Sem responsável · 1 cliente']);
    assert.deepEqual(await textoDe(resumo), ['Mês não aberto 1', 'Falta planejar 2', 'Falta aprovar 1', 'Aprovados 0']);
    await soFalta.click();
    await page.locator('.plc-linha[data-cliente="p-4"]').waitFor();
    assert.equal(await soFalta.getAttribute('aria-pressed'), 'false');

    assert.ok(await semRolagemLateral(page));
    assert.deepEqual(errosReais(erros), []);

    // 390: a página não rola de lado; a tabela rola dentro dela e o nome do cliente fica à vista.
    const cel = await abrirPlanejamento(abrir, { viewport: { width: 390, height: 844 } });
    await cel.page.locator('.plc-tabela').waitFor();
    assert.ok(await semRolagemLateral(cel.page), 'planejamento a 390 sem rolagem lateral');
    const primeira = await cel.page.locator('.plc-alerta').first().evaluate((el) => Math.round(el.getBoundingClientRect().top));
    assert.ok(primeira < 844 * 0.6, `primeira linha da faixa em y=${primeira}`);
    const rolou = await cel.page.locator('[data-plc-rolagem]').evaluate((c) => {
      const antes = c.scrollLeft;
      c.scrollLeft = c.scrollWidth;
      return { sobra: c.scrollWidth - c.clientWidth, antes, depois: c.scrollLeft };
    });
    assert.ok(rolou.sobra > 0 && rolou.depois > rolou.antes, `a tabela rola dentro dela (${JSON.stringify(rolou)})`);
    const nome = await cel.page.locator('.plc-linha[data-cliente="p-2"] .plc-nome').first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { esquerda: Math.round(r.left), direita: Math.round(r.right) };
    });
    assert.ok(nome.esquerda >= 0 && nome.direita <= 390, `o nome do cliente fica à vista com a tabela rolada: ${JSON.stringify(nome)}`);
    return `${alertas.length} na faixa; grupos Carla/Helena/Sem responsável; Livraria ${partes.map(([, w]) => Math.round(w)).join(':')}px; 390: faixa em y=${primeira}, tabela sobra ${rolou.sobra}px`;
  });

  await cenario('AG9', 'o mesmo mês nas duas visões; ?aba=semana antigo abre Semanas; o erro diz o mês e não deixa número de outro mês', async (abrir) => {
    const falharSemanas = (mes) => (mes === '2026-11' ? { status: 500, body: { ok: false, message: 'O banco não respondeu (simulado).' } } : null);
    const { page, erros } = await abrirPlanejamento(abrir, { servidor: { falharSemanas } }, '/planejamento?aba=semana');
    // O endereço antigo leva à visão Semanas.
    const semanas = page.getByRole('tab', { name: 'Semanas', exact: true });
    await page.locator('.pls-tabela').waitFor();
    assert.equal(await semanas.getAttribute('aria-selected'), 'true', '?aba=semana abre Semanas');

    // Muda o mês nas Semanas e troca para Contrato: o mês continua o mesmo.
    await page.getByRole('button', { name: 'Mês anterior', exact: true }).click();
    await page.locator('.plc-mes-nome', { hasText: 'Setembro de 2026' }).waitFor();
    await page.locator('th.pls-semana .pls-semana-dias', { hasText: 'set' }).first().waitFor();
    await page.getByRole('tab', { name: 'Contrato', exact: true }).click();
    await page.waitForFunction(() => {
      const p = new URL(location.href).searchParams;
      return p.get('visao') === 'contrato' && !p.has('aba');
    });
    await page.locator('.plc-tabela').waitFor();
    assert.equal((await page.locator('.plc-mes-nome').textContent()).trim(), 'Setembro de 2026');
    // Fora do mês de hoje a faixa fala do mês e a coluna da semana some.
    assert.equal((await page.locator('[data-bloco="atencao"] h2').textContent()).trim(), 'Precisa de atenção em setembro');
    assert.equal(await page.locator('.plc-tabela thead th', { hasText: 'Esta semana' }).count(), 0);
    // A ação abre o painel do cliente no MÊS exibido (Fase 3), e fechar devolve a tela.
    await page.locator('[data-bloco="atencao"] a').first().click();
    const painelSet = page.getByRole('dialog');
    await painelSet.getByRole('heading', { name: 'Contrato de setembro' }).waitFor();
    await page.keyboard.press('Escape');
    await painelSet.waitFor({ state: 'detached' });

    // Novembro falha: o aviso diz o mês, e nenhum número de outubro fica embaixo dele.
    await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
    await page.locator('.plc-faixa-detalhe', { hasText: 'semana 2, de 5 a 11 de outubro' }).waitFor();
    await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
    const aviso = page.getByRole('alert').filter({ hasText: 'não carregou' });
    await aviso.waitFor();
    assert.match(await aviso.textContent(), /O planejamento de novembro de 2026 não carregou\. O banco não respondeu \(simulado\)\./);
    assert.equal(await page.locator('.plc-tabela').count(), 0, 'nenhuma tabela de outro mês sob o erro de novembro');
    assert.equal(await page.locator('[data-bloco="atencao"]').count(), 0);

    // De volta a outubro: os números de outubro, sem o aviso de novembro.
    await page.getByRole('button', { name: 'Mês anterior', exact: true }).click();
    await page.locator('.plc-tabela').waitFor();
    assert.equal(await aviso.count(), 0, 'o erro de novembro não fica sobre outubro');
    assert.equal((await page.locator('[data-bloco="atencao"] h2').textContent()).trim(), 'Precisa de atenção esta semana');
    assert.deepEqual(errosReais(erros), []);
    return 'aba=semana → Semanas; setembro mantido ao trocar de visão; novembro com erro do mês; outubro limpo';
  });

  await cenario('AG10', '+ Peça abre a janela do + Marcar do Calendário, com os clientes; marcar grava POST /items e o mês relê', async (abrir) => {
    const leituras = [];
    const criadas = [];
    const { page, erros } = await abrirPlanejamento(abrir, { servidor: { leituras, criadas } });
    await page.locator('.plc-tabela').waitFor();
    const lidasAntes = leituras.length;
    await page.getByRole('button', { name: '+ Peça', exact: true }).click();
    const janela = page.getByRole('dialog', { name: 'Marcar no dia' });
    await janela.waitFor();
    const opcoes = await janela.getByLabel('Cliente').locator('option').evaluateAll((els) => els.map((o) => o.textContent));
    assert.deepEqual(opcoes, ['Escolher…', ...['Aurora Mercado', 'Café do Bairro', 'Estúdio Jardim', 'Horizonte Studio', 'Norte Arquitetura', 'Livraria Sete Mares']]);
    await janela.getByLabel('Cliente').selectOption('p-2');
    await janela.getByRole('button', { name: 'Escolher o dia', exact: true }).click();
    const seletor = page.getByRole('dialog', { name: 'Escolher o dia' });
    // O dia agora se chama pela data por extenso ("sexta-feira, 9 de outubro de 2026"), com o
    // número visível dentro do nome: o nome acessível melhorou (WCAG 4.1.2, 2.4.6), e o
    // botão que antes era só "9" passa a dizer de que mês é.
    await seletor.getByRole('button', { name: /, 9 de \p{L}+ de \d{4}$/u }).click();
    await janela.getByRole('button', { name: 'Marcar', exact: true }).click();
    await janela.waitFor({ state: 'detached' });
    assert.deepEqual(criadas.map((c) => [c.clientId, c.month, c.contentType, c.scheduledAt]), [['p-2', '2026-10-01', 'arte', '2026-10-09T12:00:00Z']]);
    for (let i = 0; i < 30 && leituras.length === lidasAntes; i++) await pause(100);
    assert.ok(leituras.length > lidasAntes, `o mês relê depois de marcar (${lidasAntes} → ${leituras.length})`);
    assert.deepEqual(errosReais(erros), []);
    return `POST /items Café 09/10 arte; leituras ${lidasAntes} → ${leituras.length}`;
  });

  /* O PAINEL DO CLIENTE — F43, Fase 3. Clicar no cliente abre o mês dele à
     direita, sem sair da tela; o cliente mora no endereço (`?cliente=`). */
  const dialogo = (page) => page.getByRole('dialog');
  const semCliente = (page) => page.waitForFunction(() => !new URL(location.href).searchParams.has('cliente'));
  const focoNoDialogo = (page) => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
  /** Os passos do mês como "estado:nome" — o ✓ é desenho; o estado diz o mesmo. */
  const passosDe = (painel) =>
    painel.locator('.plp-passos > li').evaluateAll((els) => els.map((e) => `${e.dataset.estado}:${e.textContent.replace('✓', '').trim()}`));
  const RECUSA = 'Só um administrador marca o planejamento e a aprovação do mês. Nada foi gravado.';
  const sessaoSemAdmin = { ok: true, userId: 'u-bia', email: 'equipe@example.invalid', isSuperadmin: false, isSuper: false, papel: 'funcionario', areas: ['entrega'] };

  await cenario('AG11', 'clicar no cliente abre o painel ao lado; o Tab fica dentro; Esc, ✕ e o véu fecham; o foco volta e a página não rola', async (abrir) => {
    const { page, erros } = await abrirPlanejamento(abrir, { viewport: { width: 1440, height: 700 } });
    await page.locator('.plc-tabela').waitFor();
    // A página rolada um pouco: abrir e fechar o painel não a mexem.
    await page.evaluate(() => window.scrollTo(0, 240));
    await pause(200);
    const nome = page.locator('.plc-grupo[data-grupo="u-carla"] .plc-linha[data-cliente="p-2"] .plc-nome');
    // O clique do Playwright rola até o alvo se ele estiver fora da vista; a
    // medida vale depois disso, para "não rola" ser do painel, e não do teste.
    await nome.scrollIntoViewIfNeeded();
    const rolagem = await page.evaluate(() => Math.round(window.scrollY));
    assert.ok(rolagem > 100, `a página rolou (${rolagem})`);

    assert.equal(await nome.getAttribute('href'), '/planejamento?cliente=p-2', 'link de verdade: o clique do meio abre o mesmo painel');
    await nome.click();
    const painel = page.getByRole('dialog', { name: 'Café do Bairro' });
    await painel.waitFor();
    assert.equal(await painel.getAttribute('aria-modal'), 'true');
    assert.equal(new URL(page.url()).searchParams.get('cliente'), 'p-2');
    // O mês dele: passos, contrato por tipo, peças por semana — e a ficha a um clique.
    assert.deepEqual(await passosDe(painel), ['feito:Mês aberto', 'agora:Planejamento', 'depois:Aprovação do cliente']);
    await painel.getByRole('heading', { name: 'Contrato de outubro' }).waitFor();
    assert.deepEqual(await textoDe(painel.locator('.plp-tipo .plp-tipo-nome')), ['Vídeo', 'Arte']);
    assert.equal((await painel.locator('.plp-tipo[data-tipo="arte"] .plc-leg').textContent()).replace(/\s+/g, ' ').trim(), '1 de 8 · 6 sem dia');
    await painel.getByRole('heading', { name: 'Peças do mês' }).waitFor();
    assert.equal(await painel.locator('#cl-semana-2 [aria-pressed]').count(), 0, 'semana 2 sem peça');
    assert.equal(await painel.getByRole('link', { name: 'Abrir ficha do cliente' }).getAttribute('href'), '/cliente/p-2');
    assert.ok(await focoNoDialogo(page), 'o foco entra no painel');
    assert.equal(await page.evaluate(() => Math.round(window.scrollY)), rolagem, 'abrir não rola a página');

    // O Tab fica dentro: do primeiro, Shift+Tab vai ao último; dali, Tab volta ao primeiro.
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Abrir ficha do cliente');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ver o mês anterior');
    for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
    assert.ok(await focoNoDialogo(page), 'vinte e cinco Tabs depois, o foco continua no painel');

    // Esc fecha: o endereço perde o cliente, o foco volta ao nome e a página não rolou.
    await page.keyboard.press('Escape');
    await painel.waitFor({ state: 'detached' });
    await semCliente(page);
    await page.waitForFunction(() => document.activeElement?.closest('.plc-linha')?.getAttribute('data-cliente') === 'p-2');
    assert.equal(await page.evaluate(() => Math.round(window.scrollY)), rolagem, 'fechar não rola a página');

    // A ação da faixa abre o mesmo painel; o ✕ fecha.
    await page.getByRole('link', { name: 'Ver peças de Estúdio Jardim', exact: true }).click();
    await page.getByRole('dialog', { name: 'Estúdio Jardim' }).waitFor();
    await dialogo(page).getByRole('button', { name: 'Fechar', exact: true }).click();
    await dialogo(page).waitFor({ state: 'detached' });
    await semCliente(page);
    // O véu fecha (o clique fora).
    await nome.click();
    await painel.waitFor();
    await page.mouse.click(200, 400);
    await painel.waitFor({ state: 'detached' });
    await semCliente(page);
    assert.deepEqual(errosReais(erros), []);
    return `Café abre com rolagem em ${rolagem}px e fecha no mesmo lugar; Esc, ✕ e véu; foco volta ao nome`;
  });

  await cenario('AG12', '/planejamento?cliente=p-2 abre direto; trocar o mês no painel troca o da página e o painel acompanha', async (abrir) => {
    const leituras = [];
    const { page, erros } = await abrirPlanejamento(abrir, { servidor: { leituras } }, '/planejamento?cliente=p-2');
    const painel = page.getByRole('dialog', { name: 'Café do Bairro' });
    await painel.getByRole('heading', { name: 'Contrato de outubro' }).waitFor();
    assert.equal((await painel.locator('.pll-subtitulo').textContent()).trim(), 'Carla · plano Básico');

    await painel.getByRole('button', { name: 'Ver o próximo mês', exact: true }).click();
    await painel.getByRole('heading', { name: 'Contrato de novembro' }).waitFor();
    assert.equal((await painel.locator('.plp-mes-nome').textContent()).trim(), 'Novembro de 2026');
    assert.equal((await page.locator('.plc-mes-nome').textContent()).trim(), 'Novembro de 2026', 'o mês da página acompanha');
    assert.equal(new URL(page.url()).searchParams.get('cliente'), 'p-2', 'o painel continua aberto no mesmo cliente');
    assert.ok(leituras.includes('2026-11'), `leu novembro (${leituras.join(', ')})`);
    // Fechar: a tabela de novembro está atrás.
    await page.keyboard.press('Escape');
    await semCliente(page);
    await page.locator('.plc-tabela').waitFor();

    // Um id que não está na carteira do mês: o painel diz isso, sem quebrar.
    await page.goto(BASE + '/planejamento?cliente=p-99');
    await dialogo(page).locator('[data-estado="fora-do-mes"]').waitFor();
    assert.equal((await dialogo(page).locator('[data-estado="fora-do-mes"]').textContent()).trim(), 'Este cliente não está na carteira de outubro de 2026.');
    // Um id com forma inválida não abre nada.
    await page.goto(BASE + '/planejamento?cliente=%3Cscript%3E');
    await page.locator('.plc-tabela').waitFor();
    assert.equal(await dialogo(page).count(), 0);
    assert.deepEqual(errosReais(erros), []);
    return `outubro → novembro com o painel aberto (leituras ${leituras.join(', ')}); p-99: frase calma`;
  });

  await cenario('AG13', '"Planejamento OK" grava e relê; a recusa mostra a frase e a chave volta; quem não administra vê o porquê', async (abrir) => {
    const escritas = [];
    const leituras = [];
    const gravadas = {};
    const { page, erros } = await abrirPlanejamento(abrir, { servidor: { escritas, leituras, gravadas } }, '/planejamento?cliente=p-2');
    const painel = page.getByRole('dialog', { name: 'Café do Bairro' });
    const planejamento = painel.getByRole('checkbox', { name: 'Planejamento OK' });
    await planejamento.waitFor({ state: 'attached' });
    assert.equal(await planejamento.isChecked(), false);
    assert.equal(await painel.getByRole('checkbox', { name: 'Cliente aprovou' }).count(), 0, 'a aprovação vem depois do planejamento');
    const antes = leituras.length;
    await painel.locator('label.o-chave', { hasText: 'Planejamento OK' }).click();
    // A releitura traz o mês planejado: a chave fica ligada e a aprovação aparece.
    await painel.getByRole('checkbox', { name: 'Cliente aprovou' }).waitFor({ state: 'attached' });
    assert.deepEqual(escritas, [{ metodo: 'POST', cliente: 'p-2', mes: '2026-10-01', passo: 'planning' }]);
    assert.ok(leituras.length > antes, `o mês relê depois de marcar (${antes} → ${leituras.length})`);
    assert.equal(await planejamento.isChecked(), true);
    assert.deepEqual(await passosDe(painel), ['feito:Mês aberto', 'feito:Planejamento', 'agora:Aprovação do cliente']);
    assert.equal(await painel.getByRole('alert').count(), 0);

    // A recusa do servidor: a frase aparece como veio, e a chave volta.
    const recusou = [];
    const s2 = await abrirPlanejamento(abrir, {
      servidor: { escritas: recusou, recusar: () => ({ status: 403, body: { ok: false, message: RECUSA } }) },
    }, '/planejamento?cliente=p-2');
    const painel2 = s2.page.getByRole('dialog', { name: 'Café do Bairro' });
    const chave2 = painel2.getByRole('checkbox', { name: 'Planejamento OK' });
    await chave2.waitFor({ state: 'attached' });
    await painel2.locator('label.o-chave', { hasText: 'Planejamento OK' }).click();
    const aviso = painel2.getByRole('alert');
    await aviso.waitFor();
    assert.equal((await aviso.textContent()).trim(), RECUSA);
    assert.equal(recusou.length, 1);
    await s2.page.waitForFunction(() => document.querySelector('[role="dialog"] .o-chave input:not([disabled])') !== null);
    assert.equal(await chave2.isChecked(), false, 'a chave volta');
    assert.deepEqual(errosReais(s2.erros), []);

    // Quem não administra: chaves desligadas, o porquê à vista, e nada sai para o servidor.
    const nenhuma = [];
    const s3 = await abrir({
      custom: (url, req) => (url.pathname === '/api/auth/me' ? { body: sessaoSemAdmin } : comPlanejamento({ escritas: nenhuma })(url, req)),
    });
    await s3.page.clock.setFixedTime(AGORA_PL);
    await s3.page.goto(BASE + '/planejamento?cliente=p-3');
    const painel3 = s3.page.getByRole('dialog', { name: 'Estúdio Jardim' });
    await painel3.getByText('Só um administrador marca.', { exact: true }).waitFor();
    assert.equal(await painel3.getByRole('checkbox', { name: 'Planejamento OK' }).isDisabled(), true);
    assert.equal(await painel3.getByRole('checkbox', { name: 'Cliente aprovou' }).isDisabled(), true);
    await painel3.locator('label.o-chave', { hasText: 'Cliente aprovou' }).click({ force: true });
    await pause(300);
    assert.deepEqual(nenhuma, [], 'nada foi pedido ao servidor');
    // O mês não aberto: "Abrir o mês" desligado, com a frase do servidor.
    await s3.page.goto(BASE + '/planejamento?cliente=p-1');
    const painel4 = s3.page.getByRole('dialog', { name: 'Aurora Mercado' });
    await painel4.getByText('Só um administrador abre o mês.', { exact: true }).waitFor();
    assert.equal(await painel4.getByRole('button', { name: 'Abrir o mês', exact: true }).isDisabled(), true);
    assert.deepEqual(errosReais(erros), []);
    return 'POST planning → relê → ligada; 403 → frase e a chave volta; sem admin: desligadas com o porquê';
  });

  await cenario('AG14', 'celular 390×844: o painel cobre a tela, a página não rola de lado e o corpo rola dentro dele', async (abrir) => {
    const { page, erros } = await abrirPlanejamento(abrir, { viewport: { width: 390, height: 844 } });
    await page.locator('.plc-tabela').waitFor();
    await page.getByRole('link', { name: 'Planejar Café do Bairro', exact: true }).click();
    const painel = page.getByRole('dialog', { name: 'Café do Bairro' });
    await painel.locator('.plp').waitFor();
    await pause(400);
    const caixa = await painel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    });
    assert.deepEqual(caixa, [0, 0, 390, 844], `o painel cobre a tela: ${caixa.join(',')}`);
    assert.ok(await semRolagemLateral(page), 'a página não rola de lado com o painel aberto');
    const corpo = await painel.locator('.pll-corpo').evaluate((c) => ({ largo: c.scrollWidth - c.clientWidth, alto: c.scrollHeight - c.clientHeight }));
    assert.equal(corpo.largo, 0, 'o corpo do painel não rola de lado');
    assert.ok(corpo.alto > 0, 'o corpo do painel rola para baixo, dentro dele');
    // Os três passos cabem numa linha.
    const topos = await painel.locator('.plp-passos > li').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
    assert.equal(topos.length, 1, `passos em ${topos.length} linhas`);
    // O rodapé com a ficha fica à vista, preso embaixo.
    const rodape = await painel.locator('.pll-rodape').evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
    assert.equal(rodape, 844);
    await page.keyboard.press('Escape');
    await semCliente(page);
    assert.ok(await semRolagemLateral(page));
    assert.deepEqual(errosReais(erros), []);
    return `painel ${caixa.join('×')}; corpo rola ${corpo.alto}px; rodapé em y=${rodape}`;
  });

  /* O CALENDÁRIO DENTRO DO PLANEJAMENTO — F43, Fase 4. As duas leituras (o
     mês e o calendário) respondem no mesmo servidor de mentira. */
  const comTudo = (opcoes) => {
    const calendario = comCalendario(mesCheio, opcoes);
    const planejamento = comPlanejamento();
    return (url, req) => calendario(url, req) ?? planejamento(url, req);
  };
  const enderecoDe = (page) => {
    const u = new URL(page.url());
    return u.pathname + u.search;
  };
  const acesoNaBarra = (page) =>
    page.locator('a.bl-item[aria-current="page"]').evaluateAll((els) => els.map((a) => a.getAttribute('href')));

  await cenario('AG15', 'o Calendário mora no Planejamento: /calendario?mes= abre a visão no mês; um controle de mês e uma ação; trocar de visão não perde o mês; a barra acende o lugar certo', async (abrir) => {
    const pedidos = [];
    const { page, erros } = await abrir({ custom: comTudo({ pedidos }) });
    await page.clock.setFixedTime(AGORA_PL);
    await page.goto(BASE + '/calendario?mes=2026-12');
    await page.locator('.cal-casa[data-dia="2026-12-31"]').waitFor();
    // O desvio leva o mês junto, e o calendário pede dezembro.
    assert.equal(enderecoDe(page), '/planejamento?visao=calendario&mes=2026-12');
    assert.deepEqual(await ultimoPedido(pedidos, (p) => p.from === '2026-12-01'), { from: '2026-12-01', to: '2027-01-01', client: null });
    assert.equal(await page.getByRole('tab', { name: 'Calendário', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByLabel('Mês do calendário').inputValue(), '2026-12');
    // A barra acende Calendário (foi por ele que se chegou), e não Planejamento.
    assert.deepEqual(await acesoNaBarra(page), ['/planejamento?visao=calendario']);

    // UM controle de mês e UMA ação: nada de "Próximo mês" duas vezes, nem
    // "+ Peça" ao lado do "+ Marcar".
    assert.equal(await page.getByRole('button', { name: 'Próximo mês', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Mês anterior', exact: true }).count(), 1);
    assert.equal(await page.locator('.plc-mes').count(), 0, 'o mês do topo sai nesta visão');
    assert.equal(await page.getByRole('button', { name: '+ Marcar', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '+ Peça', exact: true }).count(), 0);
    // Todos os controles do calendário de antes continuam à vista, com o mesmo nome.
    for (const nome of [/^Hoje, /, 'Mês todo', 'Mês', 'Agenda']) {
      assert.ok(await page.getByRole('button', { name: nome, exact: typeof nome === 'string' }).isVisible(), `${nome} à vista`);
    }

    // Clicar numa peça abre a janela de sempre; o "+" do dia também.
    // A primeira pastilha à vista (as outras do dia podem estar no "+N").
    const pastilha = page.locator('.cal-pastilha[data-entrada^="delivery:"]').first();
    const id = (await pastilha.getAttribute('data-entrada')).slice('delivery:'.length);
    const alvo = mesCheio('2026-12').find((e) => e.id === id);
    await pastilha.click();
    const janela = page.getByRole('dialog');
    await janela.waitFor();
    assert.equal(await janela.getByRole('heading').first().textContent(), 'Entrega');
    assert.equal(await janela.getByLabel('Nome').inputValue(), alvo.title ?? '');
    await page.keyboard.press('Escape');
    await janela.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Marcar no dia 10', exact: true }).click();
    await page.getByRole('dialog', { name: 'Marcar no dia' }).waitFor();
    await page.keyboard.press('Escape');
    await janela.waitFor({ state: 'detached' });
    // O "+ Marcar" do topo: a mesma janela, sem dia escolhido.
    await page.getByRole('button', { name: '+ Marcar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Marcar no dia' }).getByRole('button', { name: 'Escolher o dia', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await janela.waitFor({ state: 'detached' });

    // Trocar o mês aqui e ir para Contrato: o mesmo mês lá.
    await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
    await page.locator('.cal-casa[data-dia="2027-01-31"]').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('mes'), '2027-01');
    await page.getByRole('tab', { name: 'Contrato', exact: true }).click();
    await page.locator('.plc-tabela').waitFor();
    assert.equal((await page.locator('.plc-mes-nome').textContent()).trim(), 'Janeiro de 2027');
    assert.deepEqual(await acesoNaBarra(page), ['/planejamento'], 'nas outras visões, Planejamento');
    assert.equal(await page.getByRole('button', { name: '+ Peça', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: '+ Marcar', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Próximo mês', exact: true }).count(), 1);

    // E de volta: o mês do topo vale para o calendário.
    await page.getByRole('button', { name: 'Mês anterior', exact: true }).click();
    await page.locator('.plc-mes-nome', { hasText: 'Dezembro de 2026' }).waitFor();
    await page.getByRole('tab', { name: 'Calendário', exact: true }).click();
    await page.locator('.cal-casa[data-dia="2026-12-31"]').waitFor();
    assert.equal(await page.getByLabel('Mês do calendário').inputValue(), '2026-12');

    // F5 mantém a visão e o mês (estão no endereço).
    await page.reload();
    await page.locator('.cal-casa[data-dia="2026-12-31"]').waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Calendário', exact: true }).getAttribute('aria-selected'), 'true');

    // Mês inválido no endereço: o mês de hoje, e não tela vazia.
    await page.goto(BASE + '/planejamento?visao=calendario&mes=2026-13');
    await page.locator('.cal-casa[data-dia="2026-10-31"]').waitFor();
    assert.equal(await page.getByLabel('Mês do calendário').inputValue(), '2026-10');

    // Pela barra: o item Calendário leva direto à visão.
    await page.goto(BASE + '/planejamento');
    await page.locator('.plc-tabela').waitFor();
    await page.locator('a.bl-item[href="/planejamento?visao=calendario"]').click();
    await page.locator('.cal-barra').waitFor();
    assert.equal(enderecoDe(page), '/planejamento?visao=calendario');
    assert.deepEqual(await acesoNaBarra(page), ['/planejamento?visao=calendario']);
    assert.ok(await semRolagemLateral(page));
    assert.deepEqual(errosReais(erros), []);
    return 'dezembro pelo /calendario; janeiro no Contrato; dezembro de volta; F5 mantém; 2026-13 → outubro';
  });

  /* A RECUSA É DO MÊS DO PEDIDO — revisão pós-F43. Clicar "Planejamento OK" em
     outubro e trocar de mês pelas setas antes da resposta: a recusa de outubro
     chegava depois da troca e aparecia no painel de NOVEMBRO, sobre um mês em
     que ninguém clicou nada. */
  await cenario('AG16', 'a recusa atrasada de outubro não aparece no painel de novembro', async (abrir) => {
    const escritas = [];
    let soltar = null;
    const recusar = () =>
      new Promise((ok) => {
        soltar = () => ok({ status: 403, body: { ok: false, message: RECUSA } });
      });
    const { page, erros } = await abrirPlanejamento(abrir, { servidor: { escritas, recusar } }, '/planejamento?cliente=p-2');
    const painel = page.getByRole('dialog', { name: 'Café do Bairro' });
    await painel.getByRole('checkbox', { name: 'Planejamento OK' }).waitFor({ state: 'attached' });
    await painel.locator('label.o-chave', { hasText: 'Planejamento OK' }).click();
    for (let i = 0; i < 50 && soltar === null; i += 1) await pause(20);
    assert.ok(soltar !== null, 'o pedido de outubro está no ar');

    await painel.getByRole('button', { name: 'Ver o próximo mês', exact: true }).click();
    await painel.getByRole('heading', { name: 'Contrato de novembro' }).waitFor();
    soltar(); // a recusa de OUTUBRO chega agora
    await pause(600);
    assert.equal(await painel.getByRole('alert').count(), 0, 'nenhuma recusa no painel de novembro');
    assert.equal(await painel.getByText(RECUSA, { exact: true }).count(), 0);
    assert.deepEqual(escritas, [{ metodo: 'POST', cliente: 'p-2', mes: '2026-10-01', passo: 'planning' }]);
    // E o painel de novembro segue usável: a chave não ficou presa no "ocupado".
    await page.waitForFunction(() => document.querySelector('[role="dialog"] .o-chave input:not([disabled])') !== null);
    assert.deepEqual(errosReais(erros), []);
  });

  /* A ESCRITA QUE DEU CERTO NÃO É ESQUECIDA SE O PAINEL FECHOU — revisão do
     planejamento (09/10/2026). "Abrir o mês" com a rede lenta e o painel
     fechado antes da resposta: a lista de trás (tabela e faixa) seguia com o
     cliente em "mês não aberto" até recarregar a página, porque a releitura
     era descartada junto com a resposta do painel que já não estava lá. */
  await cenario('AG17', 'abrir o mês e fechar o painel antes da resposta: a lista de trás é relida e o cliente sai de "mês não aberto"', async (abrir) => {
    const escritas = [];
    const gravadas = {};
    let soltar = null;
    const demorarAbertura = () => new Promise((ok) => { soltar = ok; });
    const { page, erros } = await abrirPlanejamento(abrir, { servidor: { escritas, gravadas, demorarAbertura } }, '/planejamento?cliente=p-1');
    const painel = page.getByRole('dialog', { name: 'Aurora Mercado' });
    await painel.getByRole('button', { name: 'Abrir o mês', exact: true }).click();
    for (let i = 0; i < 50 && soltar === null; i += 1) await pause(20);
    assert.ok(soltar !== null, 'o pedido de abrir o mês está no ar');

    // Fecha o painel ANTES da resposta: a tabela ainda diz o que dizia.
    await page.keyboard.press('Escape');
    await painel.waitFor({ state: 'detached' });
    await semCliente(page);
    const etapa = page.locator('.plc-linha[data-cliente="p-1"] .plc-etapas-nome');
    assert.equal((await etapa.textContent()).trim(), 'Mês não aberto');
    assert.equal(await page.locator('[data-bloco="atencao"] .plc-alerta[data-cliente="p-1"]').getAttribute('data-motivo'), 'mes-nao-aberto');

    soltar(); // a resposta chega agora, com o painel já fechado
    await page.waitForFunction(() => document.querySelector('.plc-linha[data-cliente="p-1"] .plc-etapas-nome')?.textContent.trim() === 'Falta planejar');
    const motivo = await page.locator('[data-bloco="atencao"] .plc-alerta[data-cliente="p-1"]').getAttribute('data-motivo');
    assert.notEqual(motivo, 'mes-nao-aberto', 'a faixa não cobra mais a abertura do mês');
    assert.deepEqual(escritas, [{ metodo: 'POST', cliente: 'p-1', mes: '2026-10-01', passo: 'open' }]);
    assert.deepEqual(errosReais(erros), []);
    return `Aurora: Mês não aberto → Falta planejar sem recarregar; a faixa passou a dizer "${motivo}"`;
  });

  /* ENTREGA JÁ FEITA NÃO SE APAGA COM UM CLIQUE — mesma revisão. A janela do
     Calendário e do Planejamento apagava a entrega concluída sem perguntar; a
     por fazer segue apagando direto. */
  await cenario('AG18', 'Apagar uma entrega concluída pergunta antes (Cancelar não apaga); a por fazer apaga direto', async (abrir) => {
    const apagadas = [];
    const servidor = comCalendario(mesCheio);
    const custom = (url, req) =>
      /^\/api\/items\/[^/]+$/.test(url.pathname) && req.method() === 'DELETE'
        ? (apagadas.push(url.pathname), { body: { ok: true } })
        : servidor(url, req);
    const { page, erros } = await abrir({ custom });
    await page.goto(BASE + '/calendario');
    await esperarGrade(page);
    await page.locator('.cal-pastilha').first().waitFor();

    // Concluída: a pergunta aparece; "Cancelar" não apaga.
    const feita = page.locator('.cal-pastilha[data-estado="concluido"]').first();
    await feita.click();
    const janela = page.getByRole('dialog', { name: 'Entrega' });
    await janela.waitFor();
    const perguntas = [];
    page.once('dialog', (d) => { perguntas.push(d.message()); void d.dismiss(); });
    await janela.getByRole('button', { name: 'Apagar', exact: true }).click();
    for (let i = 0; i < 50 && perguntas.length === 0; i += 1) await pause(20);
    assert.equal(perguntas.length, 1, 'perguntou antes de apagar');
    assert.match(perguntas[0], /já foi marcada como feita/);
    await pause(300);
    assert.deepEqual(apagadas, [], 'recusar a pergunta não apaga');
    assert.ok(await janela.isVisible(), 'a janela continua aberta');

    // Confirmando, apaga.
    page.once('dialog', (d) => { void d.accept(); });
    await janela.getByRole('button', { name: 'Apagar', exact: true }).click();
    await janela.waitFor({ state: 'detached' });
    assert.equal(apagadas.length, 1, 'confirmou e apagou');

    // Por fazer: apaga direto, sem pergunta.
    const aberta = page.locator('.cal-pastilha:not([data-estado="concluido"])').first();
    await aberta.click();
    const janela2 = page.getByRole('dialog', { name: 'Entrega' });
    await janela2.waitFor();
    let perguntou = false;
    const aoPerguntar = (d) => { perguntou = true; void d.dismiss(); };
    page.on('dialog', aoPerguntar);
    await janela2.getByRole('button', { name: 'Apagar', exact: true }).click();
    await janela2.waitFor({ state: 'detached' });
    page.off('dialog', aoPerguntar);
    assert.equal(perguntou, false, 'a entrega por fazer não pergunta');
    assert.equal(apagadas.length, 2);
    assert.deepEqual(errosReais(erros), []);
    return 'concluída: pergunta → cancelar não apaga → confirmar apaga; por fazer: apaga direto';
  });

  if (CAPTURAS) {
    await cenario('AG-capturas', 'capturas: cheio, vazio, agenda 390, mês 390, planejamento', async (abrir) => {
      const feitas = [];
      for (const tema of ['claro', 'escuro']) {
        const cheio = await abrir({ custom: comCalendario(mesCheio), tema });
        await cheio.page.goto(BASE + '/calendario');
        await cheio.page.locator('.cal-pastilha').first().waitFor();
        await pause(300);
        await cheio.page.screenshot({ path: `${CAPTURAS}/calendario-cheio-1440-${tema}.png` });
        await cheio.page.screenshot({ path: `${CAPTURAS}/calendario-cheio-1440-${tema}-inteiro.png`, fullPage: true });
        const cheia = cheio.page.locator('.cal-mais').first();
        await cheia.click();
        await cheio.page.screenshot({ path: `${CAPTURAS}/calendario-dia-expandido-1440-${tema}.png`, fullPage: true });
        await cheio.page.getByRole('button', { name: 'Agenda', exact: true }).click();
        await cheio.page.locator('.cal-linha').first().waitFor();
        await cheio.page.screenshot({ path: `${CAPTURAS}/calendario-agenda-1440-${tema}.png` });

        const vazio = await abrir({ custom: comCalendario(() => []), tema });
        await vazio.page.goto(BASE + '/calendario');
        await esperarGrade(vazio.page);
        await pause(300);
        await vazio.page.screenshot({ path: `${CAPTURAS}/calendario-vazio-1440-${tema}.png` });

        const cel = await abrir({ custom: comCalendario(mesCheio), tema, viewport: { width: 390, height: 844 } });
        await cel.page.goto(BASE + '/calendario');
        await cel.page.locator('.cal-linha').first().waitFor();
        await pause(300);
        await cel.page.screenshot({ path: `${CAPTURAS}/calendario-agenda-390-${tema}.png` });
        await cel.page.getByRole('button', { name: 'Mês', exact: true }).click();
        await esperarGrade(cel.page);
        await pause(300);
        await cel.page.screenshot({ path: `${CAPTURAS}/calendario-mes-390-${tema}.png` });

        const t1024 = await abrir({ custom: comCalendario(mesCheio), tema, viewport: { width: 1024, height: 768 } });
        await t1024.page.goto(BASE + '/calendario');
        await t1024.page.locator('.cal-pastilha').first().waitFor();
        await pause(300);
        await t1024.page.screenshot({ path: `${CAPTURAS}/calendario-cheio-1024-${tema}.png` });

        for (const [w, h] of [[1440, 900], [390, 844]]) {
          const pl = await abrir({ custom: comPlanejamento(), tema, viewport: { width: w, height: h } });
          await pl.page.goto(BASE + '/planejamento');
          await pl.page.locator('.plc-tabela').waitFor();
          await pause(300);
          await pl.page.screenshot({ path: `${CAPTURAS}/planejamento-${w}-${tema}.png`, fullPage: w === 390 });
          // O painel do cliente (Fase 3).
          await pl.page.goto(BASE + '/planejamento?cliente=p-2');
          await pl.page.locator('[role="dialog"] .plp').waitFor();
          await pause(400);
          await pl.page.screenshot({ path: `${CAPTURAS}/planejamento-painel-${w}-${tema}.png` });
        }
        feitas.push(tema);
      }
      return `capturas em ${CAPTURAS} (${feitas.join(', ')})`;
    });
  }

  return resultados;
}
