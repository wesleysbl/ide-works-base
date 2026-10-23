/**
 * FECHAR O CARTÃO DEVOLVE O QUADRO COMO ESTAVA — F32 (Fase 2).
 *
 * O relato de 25/09/2026: *"quando você abre um card lá do final de uma lista
 * e fecha, em vez de voltar na mesma posição, ele volta no início da lista… a
 * tela anterior deveria ficar exatamente como estava antes dele abrir."*
 *
 * Medido antes da correção, com estes mesmos dados: coluna rolada até o fim
 * (2.420px no quadro da lista) e faixa 150px de lado; abrir o último cartão e
 * fechar pelo X, pelo Voltar do navegador ou recarregar → coluna 0 e faixa 0,
 * nas quatro telas de quadro. A visão de LISTA já voltava certa (é o
 * documento, da F17.24) e fica aqui como guarda para não regredir.
 *
 * Os gestos são de verdade — roda sobre a coluna, roda horizontal sobre o vão, clique do mouse nas coordenadas do
 * cartão — porque é o `scroll` deles que a `LembrarRolagemInterna` grava. O
 * clique é pelo mouse, e não por `locator.click()`, para o Playwright não
 * rolar nada sozinho antes de clicar.
 *
 * A coluna longa é a SEGUNDA: com a faixa 150px de lado, a primeira ficaria
 * cortada à esquerda, e o cartão a clicar tem de estar inteiro à vista.
 */

import assert from 'node:assert/strict';

import { BASE, X, abrirEmTelaCheia, criarSuite, detail, fecharFicha, painelDaFicha, pause, row } from './comum.mjs';
import { F6C, f6cServidor } from './dados-f06c.mjs';

/* ───────────────────────────── os dados ───────────────────────────── */

const LISTA = '00000000-0000-0000-0000-00000000f320';
const ETAPAS = Array.from({ length: 10 }, (_, i) => ({
  id: `st${i}`, name: `Etapa ${i}`, type: i === 9 ? 'closed' : 'custom', color: null, sortOrder: i,
}));
const cartao = (id, title, statusId) => ({
  id, title, statusId, priority: null, dueOn: null, startOn: null, completedAt: null,
  hasDescription: false, hasAttachment: false, clientId: null, clientName: null, assignees: [],
  tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0,
  checklistDone: 0, checklistTotal: 0, commentCount: 0, previewAttachmentId: null, previewCount: 0,
});
/** 40 cartões na SEGUNDA coluna; um em cada das outras. */
const CARTOES = [
  cartao('t-st0', 'Fica em Etapa 0', 'st0'),
  /* F06B: a coluna longa usa o cartão inteiro — prazo, responsável (um botão
     no rodapé), conversa e cliente —, para a roda, o arrasto do fundo e a
     volta da ficha serem provados com os controles dentro do cartão. */
  ...Array.from({ length: 40 }, (_, i) => ({
    ...cartao(`t-longa-${i}`, `Longa ${i + 1}`, 'st1'),
    ...(i % 3 === 0 ? { dueOn: '2026-01-05', assignees: [{ id: 'u-bia', name: 'Beatriz Nogueira' }], commentCount: 2, clientId: 'cli-x', clientName: 'Cliente Exemplo' } : {}),
  })),
  ...ETAPAS.slice(2).map((s) => cartao(`t-${s.id}`, `Fica em ${s.name}`, s.id)),
];

function quadroDaLista(cartoes = CARTOES) {
  const conta = Object.fromEntries(ETAPAS.map((s) => [s.id, cartoes.filter((t) => t.statusId === s.id).length]));
  return {
    header: {
      listId: LISTA, listName: 'CONTFIX', listContent: null, folderId: null, folderName: null,
      spaceId: 'e1', spaceName: 'AGÊNCIA IDE', categoryName: 'Ide', statusSetName: 'Esteira', inheritedFrom: 'list',
    },
    statuses: ETAPAS, tasks: cartoes, availableTags: [],
    columnTotals: conta, columnMatched: conta, perColumn: 50,
    assigneeOptions: [], unassignedTasks: 0, filter: { texto: '', responsavel: null },
  };
}

const chaveDaEtapa = (s) => s.name.toLowerCase();
const PASTA = {
  header: { folderId: 'f32', folderName: 'Pasta F32', folderArchivedAt: null, spaceId: 'e1', spaceName: 'AGÊNCIA IDE', categoryName: 'Ide', lists: 1 },
  etapas: ETAPAS.map((s) => ({ key: chaveDaEtapa(s), name: s.name, type: s.type, color: null, lists: 1, ordem: s.sortOrder, statusByList: { [LISTA]: s.id } })),
  lists: [{ id: LISTA, name: 'CONTFIX', tasks: CARTOES.length }],
  tasks: CARTOES.map((t) => ({ ...t, listId: LISTA, listName: 'CONTFIX', columnKey: chaveDaEtapa(ETAPAS.find((s) => s.id === t.statusId)) })),
  columnTotals: Object.fromEntries(ETAPAS.map((s) => [chaveDaEtapa(s), CARTOES.filter((t) => t.statusId === s.id).length])),
  columnMatched: Object.fromEntries(ETAPAS.map((s) => [chaveDaEtapa(s), CARTOES.filter((t) => t.statusId === s.id).length])),
  perColumn: 50, assigneeOptions: [], unassignedTasks: 0, availableTags: [], filter: { texto: '', responsavel: null },
};

/** `Todas as tarefas` e `Minhas tarefas`: 40 na coluna `unstarted` (a segunda do quadro por tipo). */
const uid = (n) => `00000000-0000-0000-0000-000000f32${String(n).padStart(3, '0')}`;
// `statusName` em cada linha: `Minhas tarefas` monta as colunas pelas ETAPAS
// que têm cartão (`colunasPorEtapa`), não pelos cinco tipos. Uma esteira de
// verdade — várias etapas `custom` — é o que faz a faixa transbordar de lado.
const ETAPAS_CUSTOM = ['Roteiro', 'Gravação', 'Edição', 'Aprovação', 'Alteração'];
const LINHAS = [
  { ...row, id: uid(900), title: 'Tipo open', statusType: 'open', statusName: 'Pauta', dueOn: null },
  ...Array.from({ length: 40 }, (_, i) => ({ ...row, id: uid(i), title: `Linha ${i + 1}`, statusType: 'unstarted', statusName: 'A fazer', dueOn: null })),
  ...ETAPAS_CUSTOM.map((nome, i) => ({ ...row, id: uid(950 + i), title: `Etapa ${nome}`, statusType: 'custom', statusName: nome, statusSortOrder: i, dueOn: null })),
  { ...row, id: uid(960), title: 'Tipo done', statusType: 'done', statusName: 'Concluído', dueOn: null },
];

const ficha = (url) => {
  if (!url.pathname.startsWith('/api/board/tasks/')) return null;
  const id = url.pathname.split('/').pop();
  return { body: { ok: true, task: { ...detail, id, title: 'Tarefa ' + id }, storage: { ready: false, variable: '' } } };
};

/** O servidor fictício das quatro telas. `quadro()` pode trocar o quadro da lista no meio do cenário. */
const servidor = ({ quadro = () => quadroDaLista() } = {}) => (url) => {
  const p = url.pathname;
  if (p === `/api/board/lists/${LISTA}`) return { body: { ok: true, board: quadro() } };
  if (p.startsWith('/api/board/folders/f32')) return { body: { ok: true, board: PASTA } };
  if (p === '/api/board/all-tasks')
    return { body: { ok: true, work: { rows: LINHAS, total: LINHAS.length, matched: LINHAS.length, capped: false, assigneeOptions: [], unassignedTasks: 0 } } };
  if (p === '/api/board/my-tasks') {
    const aba = url.searchParams.get('aba') ?? 'pendente';
    const rows = aba === 'pendente' ? LINHAS.filter((l) => l.statusType !== 'done') : [];
    return { body: { ok: true, work: { rows, total: rows.length, capped: false, aba, counts: { pendente: rows.length, feito: 0, delegado: 0 }, returned: rows.length, hasMore: false, nextCursor: null } } };
  }
  return ficha(url);
};

const ROTAS = {
  lista: `/quadro/${LISTA}`,
  pasta: '/quadro/pasta/f32',
  todas: '/tarefas?ver=quadro',
  minhas: '/meu-trabalho?ver=quadro',
};

/* ───────────────────────────── os gestos e a régua ───────────────────────────── */

/** A coluna longa é a segunda (`nth-child(2)`). */
const LONGA = '.q-colunas > .q-coluna:nth-child(2) .q-coluna-corpo';

const medir = (page) =>
  page.evaluate((sel) => {
    const f = document.querySelector('.q-colunas');
    const c = document.querySelector(sel);
    if (f === null || c === null) {
      const aviso = document.querySelector('[role="alert"]')?.textContent ?? '';
      throw new Error(`sem quadro na tela em ${location.pathname}${location.search}; aviso: ${aviso.slice(0, 160)}`);
    }
    return {
      faixa: Math.round(f.scrollLeft),
      coluna: Math.round(c.scrollTop),
      fimDaColuna: c.scrollHeight - c.clientHeight,
      cartoes: c.querySelectorAll('.q-cartao').length,
    };
  }, LONGA);

const esperarQuadro = (page) =>
  page.waitForFunction((sel) => (document.querySelector(sel)?.querySelectorAll('.q-cartao').length ?? 0) >= 39, LONGA, { timeout: 8000 });

/** Rola a coluna longa até o fim com a roda, e a faixa 150px de lado com a roda horizontal sobre o vão (F34). */
async function rolarComoAPessoa(page) {
  const alvo = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    const cs = document.querySelectorAll('.q-colunas > .q-coluna');
    const a = cs[0].getBoundingClientRect();
    const b = cs[1].getBoundingClientRect();
    return { coluna: { x: r.left + r.width / 2, y: r.top + Math.min(r.height, 400) / 2 }, vao: { x: (a.right + b.left) / 2, y: a.top + 200 } };
  }, LONGA);
  await page.mouse.move(alvo.coluna.x, alvo.coluna.y);
  for (let i = 0; i < 20; i += 1) {
    await page.mouse.wheel(0, 300);
    await pause(50);
  }
  await pause(300);
  await page.mouse.move(alvo.vao.x, alvo.vao.y);
  await page.mouse.wheel(150, 0);
  await pause(400);
  const m = await medir(page);
  assert.ok(m.fimDaColuna > 500 && Math.abs(m.coluna - m.fimDaColuna) <= 1, `a coluna chegou ao fim: ${m.coluna}/${m.fimDaColuna}`);
  assert.ok(m.faixa >= 100, `a faixa rolou de lado: ${m.faixa}`);
  return m;
}

/** Clica o ÚLTIMO cartão da coluna longa com o mouse, onde ele está. */
async function abrirOUltimo(page) {
  const ponto = await page.evaluate((sel) => {
    const links = document.querySelectorAll(`${sel} a.q-titulo-cartao`);
    const a = links[links.length - 1];
    const r = a.getBoundingClientRect();
    const caixa = document.querySelector(sel).getBoundingClientRect();
    const inteiro = r.top >= caixa.top && r.bottom <= caixa.bottom && r.left >= caixa.left && r.right <= caixa.right;
    return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2, href: a.getAttribute('href'), inteiro };
  }, LONGA);
  assert.ok(ponto.inteiro, 'o último cartão está inteiro à vista antes do clique');
  await page.mouse.click(ponto.x, ponto.y);
  await page.waitForURL('**' + ponto.href);
  // F43, Fase 7: o cartão abre a ficha AO LADO, e o quadro nem sai da tela —
  // o que este arquivo prova (fechar devolve o quadro como estava) continua
  // valendo, agora pelo ✕ do painel no lugar do X da página.
  await painelDaFicha(page).waitFor();
  await pause(300);
  return ponto.href;
}

const perto = (a, b, rotulo) => assert.ok(Math.abs(a - b) <= 2, `${rotulo}: antes=${a} depois=${b}`);

/** O ciclo inteiro numa tela: rolar, abrir o último, fechar pelo `modo`, medir. */
async function ciclo(abrir, rota, modo, { recarregar = false } = {}) {
  const { page, erros } = await abrir({ custom: servidor() });
  await page.goto(BASE + rota);
  await esperarQuadro(page);
  await pause(300);
  const antes = await rolarComoAPessoa(page);
  await abrirOUltimo(page);
  if (modo === 'X') await fecharFicha(page).click();
  else await page.goBack();
  await page.waitForURL((u) => u.pathname + u.search === rota);
  await esperarQuadro(page);
  await pause(1200);
  const depois = await medir(page);
  perto(antes.coluna, depois.coluna, 'coluna');
  perto(antes.faixa, depois.faixa, 'faixa');
  let f5 = '';
  if (recarregar) {
    await page.reload();
    await esperarQuadro(page);
    await pause(1200);
    const r = await medir(page);
    perto(antes.coluna, r.coluna, 'coluna depois do F5');
    perto(antes.faixa, r.faixa, 'faixa depois do F5');
    f5 = `; F5 ${r.coluna}/${r.faixa}`;
  }
  const falhas = erros.filter((e) => !e.includes('validateDOMNesting'));
  assert.deepEqual(falhas, [], 'sem erro de console');
  return `coluna ${antes.coluna} → ${depois.coluna}; faixa ${antes.faixa} → ${depois.faixa}${f5}`;
}

/** F34: movimento vertical não altera a faixa, qualquer que seja o alvo. */
async function eixosIndependentes(abrir, rota, viewport = { width: 1440, height: 900 }) {
  const { page, erros } = await abrir({ custom: servidor(), viewport });
  await page.goto(BASE + rota);
  await esperarQuadro(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Parte do meio horizontal: detectar tanto conversão positiva quanto negativa.
  await page.locator('.q-colunas').evaluate((el) => { el.scrollLeft = 150; });
  await pause(150);
  const pontos = await page.evaluate((sel) => {
    const faixa = document.querySelector('.q-colunas');
    const cs = faixa.querySelectorAll(':scope > .q-coluna');
    const primeira = cs[0].getBoundingClientRect();
    const segunda = cs[1].getBoundingClientRect();
    const corpo = document.querySelector(sel).getBoundingClientRect();
    const curta = cs[0].querySelector('.q-coluna-corpo');
    const r = curta.getBoundingClientRect();
    const f = faixa.getBoundingClientRect();
    return {
      longa: { x: corpo.left + corpo.width / 2, y: corpo.top + Math.min(corpo.height / 2, 120) },
      fundo: { x: (primeira.right + segunda.left) / 2, y: corpo.top + 100 },
      cabecalho: { x: segunda.left + segunda.width / 2, y: segunda.top + 15 },
      curta: { x: Math.max(r.left, f.left) + 20, y: r.top + Math.min(r.height / 2, 130) },
      curtaRola: curta.scrollHeight > curta.clientHeight + 1,
    };
  }, LONGA);
  assert.equal(pontos.curtaRola, false, 'a coluna curta cabe inteira');
  const girar = async (nome, dy) => {
    const antes = await medir(page);
    const alvo = pontos[nome];
    await page.mouse.move(alvo.x, alvo.y);
    await page.mouse.wheel(0, dy);
    await pause(180);
    const depois = await medir(page);
    perto(antes.faixa, depois.faixa, `vertical em ${nome}, deltaY ${dy}`);
    return { antes, depois };
  };
  for (const nome of ['fundo', 'cabecalho', 'curta']) {
    for (const dy of [240, -240]) await girar(nome, dy);
  }
  const vertical = await girar('longa', 240);
  assert.ok(vertical.depois.coluna > vertical.antes.coluna + 100, 'a coluna longa rola verticalmente');
  // Limites vertical superior e inferior, insistindo no sentido sem espaço.
  for (const [fim, dy] of [[false, -240], [true, 240]]) {
    await page.locator(LONGA).evaluate((el, noFim) => { el.scrollTop = noFim ? el.scrollHeight : 0; }, fim);
    await pause(80);
    for (let i = 0; i < 3; i += 1) await girar('longa', dy);
  }
  // O gesto explicitamente horizontal continua nativo, sem dobrar o passo.
  await page.mouse.move(pontos.fundo.x, pontos.fundo.y);
  const antesHorizontal = await medir(page);
  await page.mouse.wheel(80, 0);
  await pause(250);
  const depoisHorizontal = await medir(page);
  perto(80, depoisHorizontal.faixa - antesHorizontal.faixa, 'gesto horizontal nativo');
  // Shift+roda segue o comportamento nativo da plataforma (no Chrome/macOS,
  // a roda enviada pelo protocolo pode não converter). Compare com caixa sem hook.
  await page.evaluate(() => {
    const caixa = document.createElement('div');
    caixa.id = 'controle-roda-nativa';
    caixa.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:80px;overflow:auto;z-index:99999';
    const conteudo = document.createElement('div');
    conteudo.style.cssText = 'width:1000px;height:40px';
    caixa.append(conteudo);
    document.body.append(caixa);
  });
  await page.mouse.move(100, 40);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 40);
  await page.keyboard.up('Shift');
  await pause(250);
  const shiftNativo = await page.evaluate(() => {
    const caixa = document.getElementById('controle-roda-nativa');
    const x = caixa.scrollLeft;
    caixa.remove();
    return x;
  });
  await page.mouse.move(pontos.fundo.x, pontos.fundo.y);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 40);
  await page.keyboard.up('Shift');
  await pause(250);
  const depoisShift = await medir(page);
  perto(shiftNativo, depoisShift.faixa - depoisHorizontal.faixa, 'Shift+roda igual ao nativo');
  // Fundo arrastado conserva o comportamento, sem confundir com cartão.
  const fundo = await page.evaluate(() => {
    const cs = document.querySelectorAll('.q-colunas > .q-coluna');
    const a = cs[1].getBoundingClientRect();
    const b = cs[2].getBoundingClientRect();
    return { x: (a.right + b.left) / 2, y: a.top + 100 };
  });
  await page.mouse.move(fundo.x, fundo.y);
  await page.mouse.down();
  await page.mouse.move(fundo.x - 40, fundo.y, { steps: 10 });
  await page.mouse.up();
  await pause(150);
  const depoisArrasto = await medir(page);
  perto(40, depoisArrasto.faixa - depoisShift.faixa, 'arrasto do fundo');
  assert.deepEqual(erros.filter((e) => !e.includes('validateDOMNesting')), [], 'sem erro de console');
  return `${viewport.width}×${viewport.height}: vertical isolado em 4 alvos e 2 limites; horizontal +80px; Shift nativo; arrasto +40px`;
}

/* ───────────────────────────── os cenários ───────────────────────────── */

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('R1', 'quadro da lista: coluna no fim + faixa de lado → último cartão → X → mesma coluna e faixa; F5 idem', (abrir) =>
    ciclo(abrir, ROTAS.lista, 'X', { recarregar: true }));

  await cenario('R2', 'quadro da lista: o mesmo pelo Voltar do navegador', (abrir) => ciclo(abrir, ROTAS.lista, 'voltar'));

  await cenario('R3', 'pasta: coluna e faixa voltam pelo X e pelo Voltar', async (abrir) => {
    const x = await ciclo(abrir, ROTAS.pasta, 'X');
    const v = await ciclo(abrir, ROTAS.pasta, 'voltar');
    return `X: ${x} · Voltar: ${v}`;
  });

  await cenario('R4', 'Todas as tarefas em quadro: coluna e faixa voltam pelo X e pelo Voltar', async (abrir) => {
    const x = await ciclo(abrir, ROTAS.todas, 'X');
    const v = await ciclo(abrir, ROTAS.todas, 'voltar');
    return `X: ${x} · Voltar: ${v}`;
  });

  await cenario('R5', 'Minhas tarefas em quadro: coluna e faixa voltam pelo X e pelo Voltar', async (abrir) => {
    const x = await ciclo(abrir, ROTAS.minhas, 'X');
    const v = await ciclo(abrir, ROTAS.minhas, 'voltar');
    return `X: ${x} · Voltar: ${v}`;
  });

  await cenario('R6', 'visão de lista (Todas as tarefas): rolada até o fim, abrir a última, X e Voltar → mesma rolagem', async (abrir) => {
    const { page } = await abrir({ custom: servidor() });
    const volta = async (modo) => {
      await page.goto(BASE + '/tarefas');
      await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length >= 40);
      await pause(300);
      await page.mouse.move(700, 500);
      for (let i = 0; i < 30; i += 1) {
        await page.mouse.wheel(0, 300);
        await pause(40);
      }
      await pause(400);
      const antes = await page.evaluate(() => Math.round(window.scrollY));
      assert.ok(antes > 500, `a lista rolou: ${antes}`);
      const alvo = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href^="/tarefa/"]')).filter((a) => { const r = a.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
        const a = links[links.length - 1];
        const r = a.getBoundingClientRect();
        return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2, href: a.getAttribute('href') };
      });
      await page.mouse.click(alvo.x, alvo.y);
      await page.waitForURL('**' + alvo.href);
      // F43, Fase 7: a linha abre a ficha ao lado; "X" é o ✕ do painel.
      await painelDaFicha(page).waitFor();
      if (modo === 'X') await fecharFicha(page).click();
      else await page.goBack();
      await page.waitForURL((u) => u.pathname === '/tarefas');
      await page.waitForFunction(() => document.querySelectorAll('a[href^="/tarefa/"]').length >= 40);
      await pause(1200);
      const depois = await page.evaluate(() => Math.round(window.scrollY));
      perto(antes, depois, `lista pelo ${modo}`);
      return `${modo} ${antes} → ${depois}`;
    };
    return `${await volta('X')}; ${await volta('voltar')}`;
  });

  await cenario('R7', 'aba nova no mesmo endereço começa do topo; o cartão que saiu da coluna deixa a coluna no fim possível', async (abrir) => {
    let curta = false;
    const { page, context } = await abrir({
      custom: servidor({ quadro: () => quadroDaLista(curta ? CARTOES.filter((t) => t.id !== 't-longa-39') : CARTOES) }),
    });
    await page.goto(BASE + ROTAS.lista);
    await esperarQuadro(page);
    await pause(300);
    const antes = await rolarComoAPessoa(page);

    // Aba nova: outro `sessionStorage`, nada a restaurar.
    const outra = await context.newPage();
    await outra.goto(BASE + ROTAS.lista);
    await esperarQuadro(outra);
    await pause(1200);
    const naOutra = await medir(outra);
    assert.equal(naOutra.coluna, 0, 'aba nova: coluna no topo');
    assert.equal(naOutra.faixa, 0, 'aba nova: faixa no começo');
    await outra.close();

    // A tarefa aberta sai da coluna enquanto a ficha está aberta.
    await abrirOUltimo(page);
    curta = true;
    // F43, Fase 7: o ✕ do painel; fechar relê o quadro, que já vem sem a tarefa.
    await fecharFicha(page).click();
    await page.waitForURL('**' + ROTAS.lista);
    await page.waitForFunction((sel) => document.querySelector(sel)?.querySelectorAll('.q-cartao').length === 39, LONGA, { timeout: 8000 });
    await pause(1500);
    const depois = await medir(page);
    assert.ok(depois.fimDaColuna < antes.fimDaColuna, 'a coluna ficou mais curta');
    perto(depois.fimDaColuna, depois.coluna, 'coluna mais curta vai ao fim possível');
    perto(antes.faixa, depois.faixa, 'faixa');
    return `aba nova 0/0; coluna ${antes.coluna} → ${depois.coluna} (fim novo ${depois.fimDaColuna})`;
  });

  await cenario('R8', 'o gesto da pessoa ganha: rolar a coluna enquanto o 2º lote chega cancela a restauração dela', async (abrir) => {
    // `Minhas tarefas` em dois lotes; na volta, o 2º demora.
    const pendentes = LINHAS.filter((l) => l.statusType !== 'done');
    let atrasar = false;
    const { page } = await abrir({
      custom: async (url) => {
        if (url.pathname !== '/api/board/my-tasks') return servidor()(url);
        const aba = url.searchParams.get('aba') ?? 'pendente';
        const cursor = url.searchParams.get('cursor');
        if (cursor === 'c1' && atrasar) await pause(2500);
        const rows = aba !== 'pendente' ? [] : cursor === 'c1' ? pendentes.slice(22) : pendentes.slice(0, 22);
        const hasMore = aba === 'pendente' && cursor !== 'c1';
        return { body: { ok: true, work: { rows, total: pendentes.length, capped: false, aba, counts: { pendente: pendentes.length, feito: 0, delegado: 0 }, returned: rows.length, hasMore, nextCursor: hasMore ? 'c1' : null } } };
      },
    });
    await page.goto(BASE + ROTAS.minhas);
    await page.getByRole('button', { name: 'Carregar mais', exact: true }).click();
    await esperarQuadro(page);
    await pause(300);
    const antes = await rolarComoAPessoa(page);
    await abrirOUltimo(page);
    // F43, Fase 7: pelo painel a tela nem desmonta, e não há restauração para
    // a pessoa interromper. Este cenário prova a restauração da REMONTAGEM —
    // que continua existindo na volta da página cheia —, então vai a ela de
    // propósito ("Abrir em tela cheia") e volta pelo X da página.
    await abrirEmTelaCheia(page);
    atrasar = true;
    await page.getByRole('button', X).click();
    await page.waitForURL((u) => u.pathname + u.search === ROTAS.minhas);
    await page.waitForFunction((sel) => (document.querySelector(sel)?.querySelectorAll('.q-cartao').length ?? 0) >= 10, LONGA);
    await pause(800);
    // A restauração já começou: com só o 1º lote, a coluna foi ao fim possível.
    // Sem isto o cenário passaria também sem restauração nenhuma (coluna em 0).
    const noMeio = await medir(page);
    assert.ok(noMeio.coluna > 300 && Math.abs(noMeio.coluna - noMeio.fimDaColuna) <= 2, `a coluna começou a voltar: ${noMeio.coluna}/${noMeio.fimDaColuna}`);
    // A pessoa rola a coluna para cima enquanto o resto chega.
    const p = await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 150 }; }, LONGA);
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -200);
    await pause(300);
    const aposGesto = await medir(page);
    await esperarQuadro(page);
    await pause(1500);
    const final = await medir(page);
    assert.ok(final.fimDaColuna > aposGesto.fimDaColuna, 'o 2º lote chegou e a coluna cresceu');
    perto(aposGesto.coluna, final.coluna, 'a coluna ficou onde a pessoa a deixou');
    assert.ok(final.coluna < antes.coluna - 300, `e não foi puxada de volta ao fim: ${final.coluna} (antes ${antes.coluna})`);
    return `antes ${antes.coluna}; após o gesto ${aposGesto.coluna}; com o 2º lote ${final.coluna} (fim ${final.fimDaColuna})`;
  });

  for (const [nome, rota] of Object.entries(ROTAS)) {
    await cenario(`F34-${nome}`, `${nome}: eixos independentes em fundo, cabeçalho, coluna curta e longa; limites e arrasto`, (abrir) =>
      eixosIndependentes(abrir, rota));
  }
  await cenario('F34-responsivo', 'eixos independentes em janela baixa e estreita', async (abrir) => {
    const baixa = await eixosIndependentes(abrir, ROTAS.lista, { width: 1440, height: 560 });
    const estreita = await eixosIndependentes(abrir, ROTAS.lista, { width: 820, height: 900 });
    return `${baixa}; ${estreita}`;
  });

  /* F06C: com etapas vazias recolhidas, a faixa levada pela fila de atalhos
     volta ao mesmo lugar depois da ficha (X, Voltar e F5), e a roda vertical
     sobre as faixas recolhidas não mexe na posição lateral. */
  for (const largura of [390, 1024]) {
    await cenario(`F06C-volta-${largura}`, `${largura}: atalho da etapa → abrir cartão → X, Voltar e F5 devolvem a faixa; roda vertical sobre a faixa recolhida não a move`, async (abrir) => {
      const { page, erros } = await abrir({ custom: f6cServidor(), viewport: { width: largura, height: 800 } });
      const rota = `/quadro/${F6C.lista}`;
      await page.goto(BASE + rota);
      await page.locator('.q-cartao').first().waitFor();
      const faixa = page.locator('.q-colunas');
      const assentar = async () => { let a = -1; for (let i = 0; i < 30; i += 1) { const b = await faixa.evaluate((el) => el.scrollLeft); if (b === a) return b; a = b; await pause(80); } return a; };
      await page.getByRole('navigation', { name: 'Ir para a etapa' }).getByRole('button', { name: /^Enviado ao cliente,/ }).click();
      const antes = await assentar();
      assert.ok(antes > 0, `o atalho rolou a faixa: ${antes}`);
      // Roda vertical em cima de uma faixa recolhida à vista (ou do fundo).
      const alvo = await page.evaluate(() => {
        const f = document.querySelector('.q-colunas').getBoundingClientRect();
        const d = [...document.querySelectorAll('.q-coluna[data-recolhida="true"]')].map((c) => c.getBoundingClientRect()).find((r) => r.left >= f.left && r.right <= f.right);
        const r = d ?? f;
        return { x: r.left + r.width / 2, y: r.top + 80 };
      });
      await page.mouse.move(alvo.x, alvo.y);
      await page.mouse.wheel(0, 400);
      await pause(300);
      assert.equal(await faixa.evaluate((el) => el.scrollLeft), antes, 'roda vertical não mexe scrollLeft');
      const voltas = [];
      for (const modo of ['X', 'voltar', 'F5']) {
        if (modo === 'F5') {
          await page.reload();
        } else {
          const link = page.locator('.q-coluna[data-etapa="f6c4"] a.q-titulo-cartao').first();
          const r = await link.boundingBox();
          await page.mouse.click(r.x + Math.min(r.width / 2, 40), r.y + r.height / 2);
          // F43, Fase 7: o cartão abre a ficha ao lado; "X" é o ✕ do painel.
          await painelDaFicha(page).waitFor();
          await pause(300);
          if (modo === 'X') await fecharFicha(page).click();
          else await page.goBack();
          await page.waitForURL((u) => u.pathname === rota);
        }
        await page.locator('.q-cartao').first().waitFor();
        await pause(1200);
        const depois = await faixa.evaluate((el) => el.scrollLeft);
        perto(antes, depois, `faixa depois de ${modo}`);
        assert.equal(await page.locator('.q-coluna[data-recolhida="true"]').count(), 4, `as vazias continuam recolhidas depois de ${modo}`);
        voltas.push(`${modo} ${depois}`);
      }
      assert.deepEqual(erros.filter((e) => !e.includes('validateDOMNesting')), []);
      return `faixa ${antes}; ${voltas.join(' · ')}`;
    });
  }

  /* F06C (verificação): a etapa vazia ABERTA À MÃO continua aberta depois da
     ficha. Sem isso, a faixa voltava ao mesmo scrollLeft com a coluna
     encolhida de novo — o número certo, o conteúdo ~236 px deslocado. */
  for (const largura of [390, 1024]) {
    await cenario(`F06C-aberta-volta-${largura}`, `${largura}: abrir etapa vazia à mão, rolar, abrir cartão → X, Voltar e F5 mantêm a etapa aberta e o mesmo conteúdo à vista`, async (abrir) => {
      const { page, erros } = await abrir({ custom: f6cServidor(), viewport: { width: largura, height: 800 } });
      const rota = `/quadro/${F6C.lista}`;
      await page.goto(BASE + rota);
      await page.locator('.q-cartao').first().waitFor();
      const faixa = page.locator('.q-colunas');
      const assentar = async () => { let a = -1; for (let i = 0; i < 30; i += 1) { const b = await faixa.evaluate((el) => el.scrollLeft); if (b === a) return b; a = b; await pause(80); } return a; };
      const retrato = () => page.evaluate(() => {
        const f = document.querySelector('.q-colunas');
        const aj = document.querySelector('.q-coluna[data-etapa="f6c3"]');
        const env = document.querySelector('.q-coluna[data-etapa="f6c4"]');
        return {
          scrollLeft: Math.round(f.scrollLeft),
          ajustes: Math.round(aj.getBoundingClientRect().left - f.getBoundingClientRect().left),
          enviado: Math.round(env.getBoundingClientRect().left - f.getBoundingClientRect().left),
          ajustesRecolhida: aj.getAttribute('data-recolhida') === 'true',
          recolhidas: document.querySelectorAll('.q-coluna[data-recolhida="true"]').length,
        };
      });
      // A faixa de "Ajustes" pode estar fora da tela no celular: leva-a à vista rolando só a faixa.
      await page.locator('.q-coluna[data-etapa="f6c3"] .q-dobra').evaluate((b) => { const f = b.closest('.q-colunas'); f.scrollLeft += b.getBoundingClientRect().left - f.getBoundingClientRect().left - 8; });
      await page.locator('.q-coluna[data-etapa="f6c3"]').getByRole('button', { name: /^Abrir a etapa Ajustes, vazia/ }).click();
      await assentar();
      // A pessoa rola a faixa de lado (roda horizontal sobre o fundo da faixa).
      const fundo = await faixa.boundingBox();
      await page.mouse.move(fundo.x + fundo.width / 2, fundo.y + fundo.height - 20);
      // Até o 1º cartão de "Enviado ao cliente" ficar à vista (no celular, a coluna aberta ocupa a tela).
      const passo = await page.evaluate(() => {
        const f = document.querySelector('.q-colunas').getBoundingClientRect();
        const a = document.querySelector('.q-coluna[data-etapa="f6c4"] a.q-titulo-cartao').getBoundingClientRect();
        return a.right + 8 > f.right ? Math.ceil(a.left - f.left - 24) : 60;
      });
      await page.mouse.wheel(passo, 0);
      await assentar();
      await pause(250);
      const antes = await retrato();
      assert.equal(antes.ajustesRecolhida, false, 'Ajustes aberta à mão');
      assert.equal(antes.recolhidas, 3);
      const voltas = [];
      for (const modo of ['X', 'voltar', 'F5']) {
        if (modo === 'F5') {
          await page.reload();
        } else {
          const link = page.locator('.q-coluna[data-etapa="f6c4"] a.q-titulo-cartao').first();
          await link.evaluate((a) => { const f = a.closest('.q-colunas'); const r = a.getBoundingClientRect(); const fr = f.getBoundingClientRect(); if (r.left < fr.left || r.right > fr.right) throw new Error('cartão fora da faixa à vista'); });
          const r = await link.boundingBox();
          await page.mouse.click(r.x + Math.min(r.width / 2, 40), r.y + r.height / 2);
          // F43, Fase 7: o cartão abre a ficha ao lado; "X" é o ✕ do painel.
          await painelDaFicha(page).waitFor();
          await pause(300);
          if (modo === 'X') await fecharFicha(page).click();
          else await page.goBack();
          await page.waitForURL((u) => u.pathname === rota);
        }
        await page.locator('.q-cartao').first().waitFor();
        await pause(1200);
        const depois = await retrato();
        assert.equal(depois.ajustesRecolhida, false, `Ajustes continua aberta depois de ${modo}`);
        assert.equal(depois.recolhidas, 3, `as outras vazias seguem recolhidas depois de ${modo}`);
        perto(antes.scrollLeft, depois.scrollLeft, `faixa depois de ${modo}`);
        perto(antes.ajustes, depois.ajustes, `posição de Ajustes na tela depois de ${modo}`);
        perto(antes.enviado, depois.enviado, `posição de Enviado na tela depois de ${modo}`);
        voltas.push(`${modo} ${depois.scrollLeft}/${depois.ajustes}`);
      }
      assert.deepEqual(erros.filter((e) => !e.includes('validateDOMNesting')), []);
      return `faixa ${antes.scrollLeft}, Ajustes em ${antes.ajustes}; ${voltas.join(' · ')}`;
    });
  }

  return resultados;
}
