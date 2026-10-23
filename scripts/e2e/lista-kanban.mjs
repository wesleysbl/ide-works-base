/**
 * LISTA | KANBAN DO ESPAÇO — F18B (revisão de 28/09, R09), no Chrome real com a
 * API simulada. A resposta de `/api/board/scope-tasks` tem a FORMA da F18A
 * (`src/board/tarefas-do-escopo.ts`): `rows`, `returned`, `hasMore`,
 * `nextCursor`, `counts`, `statusCounts` e `catalog` só na 1ª página. Nomes e
 * títulos são inventados.
 *
 *   LK1  alternar Panorama/Lista/Kanban conserva o espaço e os filtros; Lista↔Kanban não relê
 *   LK2  mesmo universo e totais nas duas composições
 *   LK3  paginação: `Carregar mais` junta o lote sem repetir
 *   LK4  busca vai ao servidor e acha o que está fora do 1º lote
 *   LK5  resposta fora de ordem é descartada
 *   LK6  abrir a tarefa e voltar devolve modo, filtros, lotes e posição
 *   LK7  Kanban: uma faixa por fluxo; teclado move dentro do fluxo; arrasto entre fluxos é recusado
 *   LK8  a preferência é desta tela e do tipo de tela, e não mexe nas outras
 *   LK9  estados: erro com Tentar de novo, filtro sem resultado, vazio
 *   LK10 com mais de 100 carregadas, mover de etapa não descarta o que estava carregado
 *   LK11 etapas abertas à mão em DUAS faixas voltam abertas da ficha
 *   LK12 a contagem por cliente com mais no banco diz que é do carregado
 *   LK-telas  390/1280/1440, claro e escuro: sem rolagem lateral; capturas com LK_CAPTURAS=<pasta>
 *
 * F18C — a matriz das telas de trabalho (as da ficha do cliente estão em `cliente-ux.mjs`, CX-LK*):
 *   LK13 pasta: Kanban de sempre (colunas por nome) ↔ Lista (escopo pasta); mesmo universo; filtro da Lista não relê o quadro
 *   LK14 lista de um cliente: Kanban (etapas reais) ↔ Lista (escopo lista); mesmo universo; busca compartilhada
 *   LK15 pasta em Lista: abrir tarefa e voltar devolve modo, filtro, posição; a escolha não vaza para lista, espaço e Minhas
 *   LK16 Minhas e Todas: `Lista | Kanban` com a mesma peça; preferência por tela; `?ver=quadro` antigo abre no Kanban
 *   LK-matriz-{1440,1280,390}-{claro,escuro}  pasta, lista, Minhas e Todas nos dois modos, sem rolagem lateral
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, detail, fecharFicha, painelDaFicha, pause } from './comum.mjs';

const CAPTURAS = process.env.LK_CAPTURAS ?? '';

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const LK = {
  espaco: U(1),
  timeA: U(11),
  timeB: U(12),
  l1: U(21), // TIME A · FOCUS · Vídeo
  l2: U(22), // TIME A · sem cliente · Arte
  l3: U(23), // TIME B · Bella Casa · Vídeo
  l4: U(24), // sem pasta · Avulsa · Arte
  fVideo: U(31),
  fArte: U(32),
};

const E = (n) => U(100 + n);
const FLUXOS = [
  {
    id: LK.fVideo, name: 'Produção de vídeo', lists: 2,
    etapas: [
      { id: E(1), name: 'A fazer', type: 'open', color: '#87909e', sortOrder: 0 },
      { id: E(2), name: 'Edição', type: 'custom', color: '#5f55ee', sortOrder: 1 },
      { id: E(3), name: 'Aprovação', type: 'custom', color: '#f8ae00', sortOrder: 2 },
      { id: E(4), name: 'Publicado', type: 'closed', color: '#008844', sortOrder: 3 },
    ],
  },
  {
    id: LK.fArte, name: 'Arte', lists: 2,
    etapas: [
      { id: E(11), name: 'A fazer', type: 'open', color: '#87909e', sortOrder: 0 },
      { id: E(12), name: 'Criação', type: 'custom', color: '#1090e0', sortOrder: 1 },
      { id: E(13), name: 'Revisão', type: 'custom', color: '#e16b16', sortOrder: 2 },
      { id: E(14), name: 'Entregue', type: 'closed', color: '#008844', sortOrder: 3 },
    ],
  },
];
const ETAPA = Object.fromEntries(FLUXOS.flatMap((f) => f.etapas.map((e) => [e.id, { ...e, fluxo: f }])));

const LISTAS = [
  { id: LK.l1, name: 'Vídeos', folderId: LK.timeA, folderName: 'TIME A', clientId: U(41), clientName: 'FOCUS', archived: false, workflowId: LK.fVideo },
  { id: LK.l2, name: 'Artes internas', folderId: LK.timeA, folderName: 'TIME A', clientId: null, clientName: null, archived: false, workflowId: LK.fArte },
  { id: LK.l3, name: 'Conteúdo mensal', folderId: LK.timeB, folderName: 'TIME B', clientId: U(43), clientName: 'Bella Casa', archived: false, workflowId: LK.fVideo },
  { id: LK.l4, name: 'Avulsa', folderId: null, folderName: null, clientId: null, clientName: null, archived: false, workflowId: LK.fArte },
];
const PASTAS = [{ id: LK.timeA, name: 'TIME A', archived: false }, { id: LK.timeB, name: 'TIME B', archived: false }];
const ANA = { id: U(51), name: 'Ana Souza' };
const BRUNO = { id: U(52), name: 'Bruno Lima' };

export const TITULO_FUNDO = 'Roteiro escondido no fim do espaço';

/** 72 abertas e 10 concluídas (ou `n - 10` abertas), em ordem de prazo (a ordem do servidor). */
export function tarefasLK(n = 82) {
  const tarefas = [];
  for (let i = 0; i < n; i++) {
    const lista = LISTAS[i % 4];
    const fluxo = FLUXOS.find((f) => f.id === lista.workflowId);
    const feita = i >= n - 10;
    const etapa = feita ? fluxo.etapas[3] : fluxo.etapas[i % 3];
    const dia = String(1 + (i % 28)).padStart(2, '0');
    tarefas.push({
      id: `lk-${String(i).padStart(2, '0')}`,
      title: i === 66 ? TITULO_FUNDO : `Peça ${String(i + 1).padStart(2, '0')} — ${lista.clientName ?? lista.name}`,
      statusId: etapa.id,
      dueOn: i % 9 === 0 ? null : `2026-${i < 40 ? '10' : '11'}-${dia}`,
      completedAt: feita ? '2026-09-20T12:00:00Z' : null,
      assignees: i % 5 === 0 ? [] : i % 2 === 0 ? [ANA] : [BRUNO],
      listId: lista.id,
    });
  }
  return tarefas;
}

const paraLinha = (t) => {
  const lista = LISTAS.find((l) => l.id === t.listId);
  const e = ETAPA[t.statusId];
  return {
    id: t.id, title: t.title, statusId: t.statusId, priority: null, dueOn: t.dueOn, startOn: null, completedAt: t.completedAt,
    hasDescription: false, hasAttachment: false, clientId: lista.clientId, clientName: lista.clientName, assignees: t.assignees,
    tags: [], taskTypeName: null, parentId: null, parentTitle: null, subtaskCount: 0, checklistDone: 0, checklistTotal: 0,
    commentCount: 0, previewAttachmentId: null, previewCount: 0,
    categoryName: 'Ide', spaceName: 'AGÊNCIA TESTE', folderName: lista.folderName, listId: lista.id, listName: lista.name, listLive: true,
    statusName: e?.name ?? null, statusType: e?.type ?? null, statusColor: e?.color ?? null,
    assignedToMe: false, createdByMe: false, otherAssignees: t.assignees.length,
    spaceId: LK.espaco, folderId: lista.folderId, workflowId: lista.workflowId, workflowName: e?.fluxo.name ?? null, statusSortOrder: e?.sortOrder ?? null,
  };
};

const ARVORE = {
  ok: true,
  companies: [{ id: 'c1', name: 'Ide' }],
  spaces: LISTAS.map((l) => ({
    spaceId: LK.espaco, spaceName: 'AGÊNCIA TESTE', spaceColor: '#1f8a5b', spaceArchivedAt: null, categoryId: 'c1', categoryName: 'Ide',
    folderId: l.folderId, folderName: l.folderName, folderArchivedAt: null, listContent: null, listArchivedAt: null, listIsLive: true,
    liveTasks: 18, totalTasks: 20, clientId: l.clientId, clientName: l.clientName,
    workflowName: FLUXOS.find((f) => f.id === l.workflowId).name, inheritedFrom: 'list', listId: l.id, listName: l.name,
  })),
};

/** A peneira dos quadros (busca e responsável, F17.55). */
const peneiraDoQuadro = (url) => {
  const busca = (url.searchParams.get('busca') ?? '').toLowerCase();
  const resp = url.searchParams.get('responsavel');
  return (t) => (!busca || t.title.toLowerCase().includes(busca)) && (!resp || t.assignees.some((a) => a.id === resp));
};

/** `GET /api/board/folders/:id` — colunas por NOME de etapa (F17.64), só as listas da pasta. */
export function quadroDaPastaLK(pastaId, tarefas, url) {
  const listas = LISTAS.filter((l) => l.folderId === pastaId);
  const pasta = PASTAS.find((x) => x.id === pastaId);
  const chave = (e) => e.name.toLowerCase();
  const etapas = new Map();
  for (const l of listas) {
    for (const e of FLUXOS.find((f) => f.id === l.workflowId).etapas) {
      const k = chave(e);
      const atual = etapas.get(k) ?? { key: k, name: e.name, type: e.type, color: e.color, lists: 0, ordem: e.sortOrder, statusByList: {} };
      atual.lists += 1;
      atual.statusByList[l.id] = e.id;
      etapas.set(k, atual);
    }
  }
  const daPasta = tarefas.filter((t) => listas.some((l) => l.id === t.listId));
  const achadas = daPasta.filter(peneiraDoQuadro(url));
  const conta = (lista) => Object.fromEntries([...etapas.keys()].map((k) => [k, lista.filter((t) => chave(ETAPA[t.statusId]) === k).length]));
  return {
    header: { folderId: pastaId, folderName: pasta?.name ?? 'Pasta', folderArchivedAt: null, spaceId: LK.espaco, spaceName: 'AGÊNCIA TESTE', categoryName: 'Ide', lists: listas.length },
    etapas: [...etapas.values()],
    lists: listas.map((l) => ({ id: l.id, name: l.name, tasks: daPasta.filter((t) => t.listId === l.id).length })),
    tasks: achadas.map((t) => ({ ...paraLinha(t), columnKey: chave(ETAPA[t.statusId]) })),
    columnTotals: conta(daPasta), columnMatched: conta(achadas),
    perColumn: 50, assigneeOptions: [{ ...ANA, tasks: 10 }, { ...BRUNO, tasks: 10 }], unassignedTasks: 0, availableTags: [],
    filter: { texto: url.searchParams.get('busca') ?? '', responsavel: url.searchParams.get('responsavel') },
  };
}

/** `GET /api/board/lists/:id` — as etapas reais do fluxo da lista. */
export function quadroDaListaLK(listaId, tarefas, url) {
  const l = LISTAS.find((x) => x.id === listaId);
  const fluxo = FLUXOS.find((f) => f.id === l.workflowId);
  const daLista = tarefas.filter((t) => t.listId === listaId);
  const achadas = daLista.filter(peneiraDoQuadro(url));
  const conta = (lista) => Object.fromEntries(fluxo.etapas.map((e) => [e.id, lista.filter((t) => t.statusId === e.id).length]));
  return {
    header: {
      listId: l.id, listName: l.name, listContent: null, folderId: l.folderId, folderName: l.folderName,
      spaceId: LK.espaco, spaceName: 'AGÊNCIA TESTE', categoryName: 'Ide', statusSetName: fluxo.name, inheritedFrom: 'list',
    },
    statuses: fluxo.etapas, tasks: achadas.map(paraLinha), availableTags: [],
    columnTotals: conta(daLista), columnMatched: conta(achadas), perColumn: 50,
    assigneeOptions: [{ ...ANA, tasks: 10 }, { ...BRUNO, tasks: 10 }], unassignedTasks: 0,
    filter: { texto: url.searchParams.get('busca') ?? '', responsavel: url.searchParams.get('responsavel') },
  };
}

export const novoEstadoLK = (n = 82) => ({ tarefas: tarefasLK(n), pedidos: [], movimentos: [], falhar: 0, vazio: false });

/**
 * O servidor fictício. `estado.pedidos` guarda cada leitura de `scope-tasks`
 * (a busca, o cursor, o lote); `estado.movimentos`, cada mudança de etapa.
 * `atraso(url)` devolve ms de espera para um pedido (fora de ordem).
 */
export function servidorLK(estado = novoEstadoLK(), { atraso = () => 0 } = {}) {
  return async (url, req) => {
    const p = url.pathname;
    if (p === '/api/board/tree/full') return { body: ARVORE };
    if (p === '/api/board/scope-tasks') {
      const q = url.searchParams;
      estado.pedidos.push({ busca: q.get('busca'), cursor: q.get('cursor'), limite: q.get('limite'), prazo: q.get('prazo'), concluidas: q.get('concluidas') });
      const ms = atraso(url);
      if (ms) await pause(ms);
      if (estado.falhar > 0) {
        estado.falhar -= 1;
        return { status: 503, body: { ok: false, error: 'O banco não respondeu a tempo. Tente de novo.' } };
      }
      // F18C: o escopo recorta o universo — pasta = as listas dela; lista = ela.
      const escopo = q.get('escopo') ?? 'espaco';
      const idDoEscopo = q.get('id');
      const doEscopo = (t) => {
        const l = LISTAS.find((x) => x.id === t.listId);
        return escopo === 'pasta' ? l.folderId === idDoEscopo : escopo === 'lista' ? l.id === idDoEscopo : true;
      };
      estado.escopos = [...(estado.escopos ?? []), `${escopo}:${idDoEscopo}`];
      const universo = estado.vazio ? [] : estado.tarefas.filter(doEscopo);
      const busca = (q.get('busca') ?? '').toLowerCase();
      const passa = (t) =>
        (q.get('concluidas') === '1' || t.completedAt === null) &&
        (!busca || t.title.toLowerCase().includes(busca)) &&
        (!q.get('lista') || t.listId === q.get('lista')) &&
        (!q.get('pasta') || LISTAS.find((l) => l.id === t.listId).folderId === (q.get('pasta') === 'sem' ? null : q.get('pasta'))) &&
        (!q.get('etapa') || t.statusId === q.get('etapa')) &&
        (!q.get('responsavel') || t.assignees.some((a) => a.id === q.get('responsavel'))) &&
        (q.get('prazo') !== 'sem' || t.dueOn === null);
      const achadas = universo.filter(passa);
      const inicio = Number(q.get('cursor') ?? 0);
      const limite = Math.min(100, Number(q.get('limite') ?? 50));
      const lote = achadas.slice(inicio, inicio + limite);
      const hasMore = inicio + limite < achadas.length;
      const statusCounts = Object.fromEntries(
        Object.keys(ETAPA).map((id) => [id, { total: universo.filter((t) => t.statusId === id).length, matched: achadas.filter((t) => t.statusId === id).length }]),
      );
      const listaDoEscopo = LISTAS.find((l) => l.id === idDoEscopo);
      const pastaDoEscopo = PASTAS.find((x) => x.id === (escopo === 'pasta' ? idDoEscopo : listaDoEscopo?.folderId));
      const tasks = {
        escopo, id: idDoEscopo,
        header: {
          spaceId: LK.espaco, spaceName: 'AGÊNCIA TESTE', folderId: pastaDoEscopo?.id ?? null, folderName: pastaDoEscopo?.name ?? null,
          listId: escopo === 'lista' ? idDoEscopo : null, listName: escopo === 'lista' ? listaDoEscopo?.name ?? null : null, archived: false,
        },
        filter: {
          texto: q.get('busca') ?? '', responsavel: q.get('responsavel'), pasta: q.get('pasta'), lista: q.get('lista'),
          etapa: q.get('etapa'), prazo: q.get('prazo'), concluidas: q.get('concluidas') === '1',
        },
        rows: lote.map(paraLinha), returned: lote.length, hasMore, nextCursor: hasMore ? String(inicio + limite) : null,
        counts: { total: universo.length, abertas: universo.filter((t) => t.completedAt === null).length, matched: achadas.length, semEtapa: 0 },
        statusCounts,
      };
      if (!q.get('cursor')) {
        const listas = LISTAS.filter((l) => (escopo === 'pasta' ? l.folderId === idDoEscopo : escopo === 'lista' ? l.id === idDoEscopo : true));
        tasks.catalog = {
          pastas: escopo === 'espaco' ? PASTAS : [], listas,
          fluxos: FLUXOS.filter((f) => listas.some((l) => l.workflowId === f.id)).map((f) => ({ ...f, etapas: f.etapas.map((e) => ({ ...e, ...statusCounts[e.id] })) })),
          assigneeOptions: [{ ...ANA, tasks: 30 }, { ...BRUNO, tasks: 35 }], unassignedTasks: 17,
        };
      }
      return { body: { ok: true, tasks } };
    }
    // F18C: o quadro da PASTA (colunas por nome de etapa) e o da LISTA, das mesmas tarefas.
    const pasta = /^\/api\/board\/folders\/([^/]+)$/.exec(p)?.[1];
    if (pasta && req.method() === 'GET') {
      estado.quadros = [...(estado.quadros ?? []), `pasta:${pasta}`];
      return { body: { ok: true, board: quadroDaPastaLK(pasta, estado.tarefas, url) } };
    }
    const lista = /^\/api\/board\/lists\/([^/]+)$/.exec(p)?.[1];
    if (lista && req.method() === 'GET') {
      estado.quadros = [...(estado.quadros ?? []), `lista:${lista}`];
      return { body: { ok: true, board: quadroDaListaLK(lista, estado.tarefas, url) } };
    }
    if (p.endsWith('/move') && req.method() === 'POST') {
      const b = req.postDataJSON();
      const id = p.split('/').slice(-2)[0];
      const t = estado.tarefas.find((x) => x.id === id);
      const antes = t?.statusId ?? null;
      if (t) t.statusId = b.statusId;
      estado.movimentos.push({ id, statusId: b.statusId, listId: b.listId });
      return { body: { ok: true, move: { taskId: id, listId: t?.listId, statusId: b.statusId, previousStatusId: antes, statusRepositioned: false, subtasksMoved: 0, automation: null } } };
    }
    if (p.startsWith('/api/board/tasks/') && req.method() === 'GET') {
      const id = p.split('/').pop();
      const t = estado.tarefas.find((x) => x.id === id);
      return { body: { ok: true, task: { ...detail, id, title: t?.title ?? id }, storage: { ready: false, variable: '' } } };
    }
    return null;
  };
}

const ROTA = `/quadro/espaco/${LK.espaco}`;
const modo = (page, nome) => page.getByRole('group', { name: 'Forma de ver' }).getByRole('button', { name: nome, exact: true });
const alcance = (page) => page.locator('.ek-alcance-principal').innerText();
const linhas = (page) => page.locator('.ek-linha').count();
const esperarAlcance = (page, texto) =>
  page.waitForFunction((t) => document.querySelector('.ek-alcance-principal')?.textContent === t, texto, { timeout: 8000 });
const semRuido = (erros) => erros.filter((e) => !/chat\/live|WebSocket|validateDOMNesting|503/i.test(e));
const leituras = (estado) => estado.pedidos.length;

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('LK1', 'Panorama → Lista → Kanban → Panorama conserva o espaço e os filtros; Lista↔Kanban não relê', async (abrir) => {
    const estado = novoEstadoLK();
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(BASE + ROTA);
    await page.getByRole('heading', { name: 'Listas sem pasta' }).waitFor();
    assert.equal(await modo(page, 'Panorama').getAttribute('aria-pressed'), 'true');
    assert.equal(leituras(estado), 0, 'o panorama não lê tarefas');

    await modo(page, 'Lista').click();
    await page.locator('.ek-linha').first().waitFor();
    assert.match(page.url(), /[?&]ver=lista/);
    await page.getByLabel('Prazo').selectOption('sem');
    await esperarAlcance(page, '8 encontradas');
    const url = new URL(page.url());
    assert.equal(url.searchParams.get('prazo'), 'sem');
    const antes = leituras(estado);

    await modo(page, 'Kanban').click();
    await page.locator('.ek-kanban .q-cartao').first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get('prazo'), 'sem', 'o filtro fica no endereço');
    assert.equal(await alcance(page), '8 encontradas');
    assert.equal(await page.getByLabel('Prazo').inputValue(), 'sem');
    await modo(page, 'Lista').click();
    await page.locator('.ek-linha').first().waitFor();
    assert.equal(leituras(estado), antes, 'Lista↔Kanban usa o mesmo estado, sem nova leitura');

    await modo(page, 'Panorama').click();
    await page.getByRole('heading', { name: 'Listas sem pasta' }).waitFor();
    assert.equal(new URL(page.url()).pathname, ROTA, 'o espaço continua o mesmo');
    assert.equal(new URL(page.url()).searchParams.get('ver'), null, 'panorama é o padrão e não se escreve');
    await modo(page, 'Lista').click();
    await esperarAlcance(page, '8 encontradas');
    assert.deepEqual(semRuido(erros), []);
    return `leituras: ${estado.pedidos.length}`;
  });

  await cenario('LK2', 'Lista e Kanban contam o mesmo universo; soma das colunas = achadas', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorLK() });
    await page.goto(`${BASE}${ROTA}?ver=lista`);
    await esperarAlcance(page, '50 de 72 abertas carregadas');
    assert.equal(await linhas(page), 50);
    assert.equal(await page.locator('.ek-alcance-base').first().innerText(), '82 no total, com as concluídas');
    await modo(page, 'Kanban').click();
    await page.locator('.ek-kanban .q-cartao').first().waitFor();
    assert.equal(await alcance(page), '50 de 72 abertas carregadas');
    const m = await page.evaluate(() => ({
      faixas: [...document.querySelectorAll('.ek-faixa-nome')].map((n) => n.textContent),
      cartoes: document.querySelectorAll('.ek-kanban .q-cartao').length,
      aFazer: [...document.querySelectorAll('.ek-kanban .q-coluna-nome')].filter((n) => n.textContent === 'A fazer').length,
    }));
    assert.deepEqual(m.faixas, ['Produção de vídeo', 'Arte']);
    assert.equal(m.cartoes, 50, 'os mesmos 50 carregados');
    assert.equal(m.aFazer, 2, '"A fazer" de fluxos diferentes são duas colunas');
    assert.deepEqual(semRuido(erros), []);
    return JSON.stringify(m);
  });

  await cenario('LK3', 'Carregar mais junta o próximo lote sem repetir, até o fim', async (abrir) => {
    const estado = novoEstadoLK();
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(`${BASE}${ROTA}?ver=lista&agrupar=nenhum`);
    await esperarAlcance(page, '50 de 72 abertas carregadas');
    await page.getByRole('button', { name: 'Carregar mais tarefas' }).click();
    await esperarAlcance(page, '72 abertas');
    const ids = await page.evaluate(() => [...document.querySelectorAll('a.ek-titulo')].map((a) => a.getAttribute('href')));
    assert.equal(ids.length, 72);
    assert.equal(new Set(ids).size, 72, 'sem repetição');
    assert.equal(await page.getByRole('button', { name: 'Carregar mais tarefas' }).count(), 0);
    assert.ok(estado.pedidos.some((p) => p.cursor === '50'), 'pediu o cursor do servidor');
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('LK4', 'a busca vai ao servidor e acha a tarefa que está fora do 1º lote', async (abrir) => {
    const estado = novoEstadoLK();
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(`${BASE}${ROTA}?ver=lista`);
    await esperarAlcance(page, '50 de 72 abertas carregadas');
    assert.equal(await page.getByRole('link', { name: TITULO_FUNDO }).count(), 0, 'fora do 1º lote');
    await page.getByRole('textbox', { name: 'Buscar tarefa pelo nome' }).fill('escondido');
    await page.getByRole('link', { name: TITULO_FUNDO }).waitFor();
    assert.equal(await alcance(page), '1 encontrada');
    assert.equal(await page.locator('.ek-alcance-base').first().innerText(), 'entre 72 abertas');
    assert.ok(estado.pedidos.some((p) => p.busca === 'escondido'));
    assert.equal(new URL(page.url()).searchParams.get('busca'), 'escondido');
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('LK5', 'resposta antiga que chega depois é descartada', async (abrir) => {
    const estado = novoEstadoLK();
    const { page, erros } = await abrir({
      custom: servidorLK(estado, { atraso: (u) => (u.searchParams.get('busca') === 'Peça 0' ? 2000 : 0) }),
    });
    await page.goto(`${BASE}${ROTA}?ver=lista`);
    await esperarAlcance(page, '50 de 72 abertas carregadas');
    const caixa = page.getByRole('textbox', { name: 'Buscar tarefa pelo nome' });
    await caixa.fill('Peça 0');
    await caixa.press('Enter');
    await pause(150);
    await caixa.fill('escondido');
    await caixa.press('Enter');
    await page.getByRole('link', { name: TITULO_FUNDO }).waitFor();
    await pause(2600);
    assert.equal(await linhas(page), 1, 'a busca lenta não pintou por cima');
    assert.equal(await alcance(page), '1 encontrada');
    assert.equal(await caixa.inputValue(), 'escondido');
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('LK6', 'abrir uma tarefa do 2º lote e voltar: modo, filtros, lotes e posição', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorLK() });
    await page.goto(`${BASE}${ROTA}?ver=lista&agrupar=nenhum&concluidas=1`);
    await esperarAlcance(page, '50 de 82 tarefas carregadas');
    await page.getByRole('button', { name: 'Carregar mais tarefas' }).click();
    await esperarAlcance(page, '82 tarefas');
    const alvo = page.locator('a.ek-titulo').nth(64);
    await alvo.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 120);
    await pause(400);
    const antes = await page.evaluate(() => Math.round(scrollY));
    const rota = new URL(page.url());
    const href = await alvo.getAttribute('href');
    await alvo.click();
    await page.waitForURL('**' + href);
    // F43, Fase 7: a linha abre a ficha AO LADO (a lista nem sai da tela);
    // fechar é o ✕ do painel. Modo, filtros, lotes e posição continuam provados.
    await painelDaFicha(page).waitFor();
    await pause(300);
    await fecharFicha(page).click();
    await page.waitForURL((u) => u.pathname === rota.pathname);
    await esperarAlcance(page, '82 tarefas');
    await pause(1200);
    const depois = await page.evaluate(() => Math.round(scrollY));
    const u = new URL(page.url());
    assert.equal(u.searchParams.get('ver'), 'lista');
    assert.equal(u.searchParams.get('concluidas'), '1');
    assert.equal(u.searchParams.get('agrupar'), 'nenhum');
    assert.equal(await linhas(page), 82, 'os dois lotes voltaram');
    assert.ok(Math.abs(depois - antes) <= 4, `posição: antes ${antes}, depois ${depois}`);
    assert.deepEqual(semRuido(erros), []);
    return `scrollY ${antes} → ${depois}`;
  });

  await cenario('LK7', 'Kanban: seta move dentro do fluxo; arrasto para outro fluxo é recusado sem escrita', async (abrir) => {
    const estado = novoEstadoLK();
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(`${BASE}${ROTA}?ver=kanban&agrupar=nenhum`);
    await page.locator('.ek-kanban .q-cartao').first().waitFor();
    // lk-00: lista Vídeos (fluxo de vídeo), etapa "A fazer" → → "Edição".
    const cartao = page.locator('.ek-kanban .q-cartao', { has: page.locator('a[href="/tarefa/lk-00"]') });
    await cartao.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector(`.q-coluna[data-etapa$="000000000102"] a[href="/tarefa/lk-00"]`) !== null);
    assert.deepEqual(estado.movimentos[0], { id: 'lk-00', statusId: FLUXOS[0].etapas[1].id, listId: LK.l1 });

    // Arrastar lk-04 (Vídeos) para "Criação" do fluxo de Arte.
    // Eventos de arrasto do próprio DOM: o `dragTo` do Playwright rola a
    // página entre o "pegar" e o "soltar" e pega o cartão que passou por
    // baixo do ponteiro (achado ao escrever este cenário: lk-07 no lugar de lk-04).
    await page.evaluate(([de, para]) => {
      const dt = new DataTransfer();
      const o = document.querySelector(de);
      const d = document.querySelector(para);
      o.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      d.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      d.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      o.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, ['.ek-kanban li.q-cartao:has(a[href="/tarefa/lk-04"])', `.q-coluna[data-etapa="${FLUXOS[1].etapas[1].id}"]`]);
    await page.getByText('A lista Vídeos usa outro fluxo').waitFor();
    assert.equal(estado.movimentos.length, 1, 'nenhuma escrita para o fluxo errado');
    assert.equal(await page.locator(`.q-coluna[data-etapa="${FLUXOS[0].etapas[1].id}"] a[href="/tarefa/lk-04"]`).count(), 1, 'o cartão ficou onde estava');
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('LK8', 'a preferência é desta tela e do tipo; pasta e telas da pessoa não mudam', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorLK() });
    await page.goto(BASE + ROTA);
    await modo(page, 'Kanban').click();
    await page.locator('.ek-kanban .q-cartao').first().waitFor();
    const lugar = await page.evaluate(() => JSON.parse(localStorage.getItem('ideworks:lugar') ?? '{}'));
    assert.deepEqual(lugar.modos, { espaco: 'kanban', [`espaco:${LK.espaco}`]: 'kanban' });
    await page.goto(BASE + '/meu-trabalho');
    await page.goto(BASE + ROTA);
    await page.locator('.ek-kanban .q-cartao').first().waitFor();
    assert.equal(await modo(page, 'Kanban').getAttribute('aria-pressed'), 'true', 'sem ?ver= volta no Kanban desta tela');
    // O endereço colado manda sobre a preferência.
    await page.goto(`${BASE}${ROTA}?ver=lista`);
    await page.locator('.ek-linha').first().waitFor();
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('LK9', 'erro com Tentar de novo; filtro sem resultado; espaço sem aberta', async (abrir) => {
    const estado = novoEstadoLK();
    estado.falhar = 99; // falha até o cenário mandar parar (o `getBoard` repete uma vez sozinho)
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(`${BASE}${ROTA}?ver=lista`);
    await page.getByText('Não foi possível carregar as tarefas agora.').waitFor();
    estado.falhar = 0;
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await esperarAlcance(page, '50 de 72 abertas carregadas');

    await page.getByRole('textbox', { name: 'Buscar tarefa pelo nome' }).fill('nada disso existe');
    await page.getByText('Nenhuma tarefa com estes filtros').waitFor();
    await page.locator('[data-estado="sem-resultado"]').getByRole('button', { name: 'Limpar filtros' }).click();
    await esperarAlcance(page, '50 de 72 abertas carregadas');

    estado.vazio = true;
    await page.reload();
    await page.getByText('Nenhuma tarefa aberta neste espaço').waitFor();
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('LK10', 'com 150 carregadas, mover pelo teclado relê sem descartar lotes (as 150 continuam)', async (abrir) => {
    const estado = novoEstadoLK(190); // 180 abertas
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(`${BASE}${ROTA}?ver=lista&agrupar=nenhum`);
    await esperarAlcance(page, '50 de 180 abertas carregadas');
    await page.getByRole('button', { name: 'Carregar mais tarefas' }).click();
    await esperarAlcance(page, '100 de 180 abertas carregadas');
    await page.getByRole('button', { name: 'Carregar mais tarefas' }).click();
    await esperarAlcance(page, '150 de 180 abertas carregadas');
    await modo(page, 'Kanban').click();
    await page.locator('.ek-kanban .q-cartao').first().waitFor();
    assert.equal(await page.locator('.ek-kanban .q-cartao').count(), 150);
    const antes = estado.pedidos.length;
    const cartao = page.locator('.ek-kanban .q-cartao', { has: page.locator('a[href="/tarefa/lk-00"]') });
    await cartao.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector(`.q-coluna[data-etapa$="000000000102"] a[href="/tarefa/lk-00"]`) !== null);
    // Espera a releitura terminar (primeira página + a seguinte).
    await page.waitForFunction(() => !document.querySelector('.ek-corpo[aria-busy="true"]'));
    await pause(300);
    const releitura = estado.pedidos.slice(antes);
    assert.ok(releitura.length >= 2, `releu em páginas: ${JSON.stringify(releitura)}`);
    assert.equal(await page.locator('.ek-kanban .q-cartao').count(), 150, 'as 150 carregadas continuam na tela');
    assert.equal(await alcance(page), '150 de 180 abertas carregadas');
    await modo(page, 'Lista').click();
    await page.locator('.ek-linha').first().waitFor();
    assert.equal(await linhas(page), 150);
    assert.deepEqual(semRuido(erros), []);
    return `releitura: ${releitura.map((p) => `${p.cursor ?? '∅'}/${p.limite}`).join(', ')}`;
  });

  await cenario('LK11', 'etapas abertas à mão em duas faixas voltam abertas da ficha', async (abrir) => {
    const estado = novoEstadoLK();
    // Só "A fazer" tem tarefa: Edição/Aprovação (vídeo) e Criação/Revisão (arte) recolhem.
    for (const t of estado.tarefas) {
      if (t.completedAt !== null) continue;
      const fluxo = FLUXOS.find((f) => f.id === LISTAS.find((l) => l.id === t.listId).workflowId);
      t.statusId = fluxo.etapas[0].id;
    }
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(`${BASE}${ROTA}?ver=kanban`);
    await page.locator('.ek-kanban .q-cartao').first().waitFor();
    const edicao = page.locator(`.q-coluna[data-etapa="${FLUXOS[0].etapas[1].id}"]`);
    const criacao = page.locator(`.q-coluna[data-etapa="${FLUXOS[1].etapas[1].id}"]`);
    assert.equal(await edicao.getAttribute('data-recolhida'), 'true');
    assert.equal(await criacao.getAttribute('data-recolhida'), 'true');
    await edicao.locator('.q-dobra').click();
    await criacao.locator('.q-dobra').click();
    await pause(300);
    assert.equal(await edicao.getAttribute('data-recolhida'), null);
    assert.equal(await criacao.getAttribute('data-recolhida'), null);
    await edicao.getByRole('button', { name: /^Recolher a etapa/ }).click();
    await edicao.locator('.q-dobra').waitFor();
    assert.equal(await criacao.getAttribute('data-recolhida'), null, 'recolher uma faixa preserva a outra');
    await edicao.locator('.q-dobra').click();
    const rota = new URL(page.url());
    await page.locator('.ek-kanban a[href="/tarefa/lk-00"]').click();
    await page.waitForURL('**/tarefa/lk-00');
    // F43, Fase 7: o cartão abre a ficha ao lado; fechar é o ✕ do painel.
    await painelDaFicha(page).waitFor();
    await fecharFicha(page).click();
    await page.waitForURL((u) => u.pathname === rota.pathname);
    await page.locator('.ek-kanban .q-cartao').first().waitFor();
    await pause(400);
    assert.equal(await edicao.getAttribute('data-recolhida'), null, 'Edição (vídeo) continua aberta');
    assert.equal(await criacao.getAttribute('data-recolhida'), null, 'Criação (arte) continua aberta');
    assert.equal(
      await page.locator(`.q-coluna[data-etapa="${FLUXOS[0].etapas[2].id}"]`).getAttribute('data-recolhida'),
      'true',
      'a que ninguém abriu segue recolhida',
    );
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('LK12', 'agrupada por cliente com mais no banco, a contagem diz "carregadas"', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorLK() });
    await page.goto(`${BASE}${ROTA}?ver=lista`);
    await esperarAlcance(page, '50 de 72 abertas carregadas');
    const contas = await page.locator('.ek-grupo-conta').allInnerTexts();
    assert.ok(contas.length >= 2 && contas.every((c) => /^\d+ carregadas?$/.test(c)), `contas: ${contas.join(' | ')}`);
    await page.getByRole('button', { name: 'Carregar mais tarefas' }).click();
    await esperarAlcance(page, '72 abertas');
    const fim = await page.locator('.ek-grupo-conta').allInnerTexts();
    assert.ok(fim.every((c) => /^\d+$/.test(c)), `sem mais no banco, o número é o total do grupo: ${fim.join(' | ')}`);
    assert.deepEqual(semRuido(erros), []);
    return `${contas.join(', ')} → ${fim.join(', ')}`;
  });

  for (const [largura, tema] of [[1440, 'claro'], [1440, 'escuro'], [1280, 'claro'], [1280, 'escuro'], [390, 'claro'], [390, 'escuro']]) {
    await cenario(`LK-telas-${largura}-${tema}`, 'Panorama, Lista e Kanban sem rolagem lateral da página', async (abrir) => {
      const { page, erros } = await abrir({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, tema, custom: servidorLK() });
      const medidas = [];
      for (const m of ['panorama', 'lista', 'kanban']) {
        await page.goto(`${BASE}${ROTA}${m === 'panorama' ? '' : `?ver=${m}`}`);
        if (m === 'panorama') await page.getByRole('heading', { name: 'Listas sem pasta' }).waitFor();
        else await page.locator(m === 'lista' ? '.ek-linha' : '.ek-kanban .q-cartao').first().waitFor();
        await pause(400);
        const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
        assert.ok(r.sw <= r.iw, `${m}: a página não rola de lado (${r.sw} > ${r.iw})`);
        medidas.push(`${m} ${r.sw}`);
        if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/espaco-${m}-${largura}-${tema}.png` });
      }
      if (largura < 500) {
        await page.goto(`${BASE}${ROTA}?ver=lista`);
        await page.locator('.ek-linha').first().waitFor();
        const secundaria = page.locator('.ek-linha').first().locator('.ek-c-etapa');
        assert.equal(await secundaria.isVisible(), false, 'etapa escondida no celular');
        await page.locator('.ek-linha').first().getByRole('button', { name: /Mostrar detalhes/ }).click();
        assert.equal(await secundaria.isVisible(), true, 'e aparece por expansão');
        await page.getByRole('button', { name: 'Filtros' }).click();
        await page.getByLabel('Prazo').waitFor();
        if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/espaco-lista-filtros-${largura}-${tema}.png` });
      }
      assert.deepEqual(semRuido(erros), []);
      return medidas.join('; ');
    });
  }

  /* ───────────────────────── F18C: a matriz das telas ───────────────────────── */

  const ROTA_P = `/quadro/pasta/${LK.timeA}`;
  const ROTA_L = `/quadro/${LK.l1}`;
  const contagem = (page) => page.locator('.q-ferramentas-fim').innerText().then((t) => t.replace(/\s+/g, ' ').trim());
  const nomesDasOrigens = (page) => page.locator('.ek-linha').evaluateAll((els) => els.map((e) => e.textContent));

  await cenario('LK13', 'pasta: Kanban de sempre ↔ Lista do escopo pasta; mesmo universo; filtro da Lista não relê o quadro', async (abrir) => {
    const estado = novoEstadoLK();
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(BASE + ROTA_P);
    await page.locator('.q-colunas .q-coluna').first().waitFor();
    assert.equal(await modo(page, 'Kanban').getAttribute('aria-pressed'), 'true', 'a pasta abre no Kanban de sempre');
    assert.equal(await page.locator('[aria-label="Forma de ver"] button').count(), 2, 'Lista | Kanban, sem Panorama');
    assert.equal(estado.pedidos.length, 0, 'o Kanban da pasta não lê o escopo');
    // Colunas por NOME de etapa (F17.64): "A fazer" dos dois fluxos é UMA coluna.
    assert.equal(await page.locator('.q-colunas .q-coluna[data-etapa="a fazer"]').count(), 1);
    assert.match(await contagem(page), /42 tarefas · 36 em aberto · 6 concluídas/);

    await modo(page, 'Lista').click();
    await esperarAlcance(page, '36 abertas');
    assert.match(page.url(), /[?&]ver=lista/);
    assert.equal(await page.locator('.ek-alcance-base').first().innerText(), '42 no total, com as concluídas', 'o total do Kanban');
    assert.equal(await linhas(page), 36);
    assert.ok((await nomesDasOrigens(page)).every((t) => !/Bella Casa|Avulsa/.test(t)), 'só as listas da pasta');
    assert.deepEqual([...new Set(estado.escopos)], [`pasta:${LK.timeA}`]);
    const quadros = estado.quadros.length;
    await page.getByLabel('Prazo').selectOption('sem');
    await esperarAlcance(page, '4 encontradas');
    assert.equal(estado.quadros.length, quadros, 'filtro na Lista não relê o quadro da pasta');

    await modo(page, 'Kanban').click();
    await page.locator('.q-colunas .q-coluna').first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get('prazo'), 'sem', 'o filtro fica no endereço');
    await page.getByText('O filtro de prazo vale na Lista.').waitFor();
    assert.equal(estado.quadros.length, quadros, 'voltar ao Kanban sem mudar busca/responsável não relê');
    await page.getByRole('button', { name: 'Ver na Lista' }).click();
    await esperarAlcance(page, '4 encontradas');
    assert.deepEqual(semRuido(erros), []);
    return `quadros lidos: ${estado.quadros.length}; escopo lido: ${estado.pedidos.length}`;
  });

  await cenario('LK14', 'lista de cliente: Kanban (etapas reais) ↔ Lista do escopo lista; mesmo universo; busca compartilhada', async (abrir) => {
    const estado = novoEstadoLK();
    const { page, erros } = await abrir({ custom: servidorLK(estado) });
    await page.goto(BASE + ROTA_L);
    await page.locator('.q-colunas .q-coluna').first().waitFor();
    assert.equal(await modo(page, 'Kanban').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.q-colunas .q-coluna').count(), 4, 'as 4 etapas do fluxo da lista');
    assert.match(await contagem(page), /21 tarefas · 18 em aberto · 3 concluídas/);
    // O seletor mora no topo, antes de `+ Nova tarefa`.
    const ordem = await page.evaluate(() => {
      const t = document.querySelector('.o-topo');
      const g = t?.querySelector('[aria-label="Forma de ver"]');
      const b = [...(t?.querySelectorAll('button') ?? [])].find((x) => x.textContent.includes('Nova tarefa'));
      return g && b ? g.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    assert.ok(ordem, 'seletor antes de + Nova tarefa, no topo');

    await modo(page, 'Lista').click();
    await esperarAlcance(page, '18 abertas');
    assert.equal(await page.locator('.ek-alcance-base').first().innerText(), '21 no total, com as concluídas');
    assert.equal(await linhas(page), 18);
    assert.deepEqual([...new Set(estado.escopos)], [`lista:${LK.l1}`]);
    const etapas = await page.getByLabel('Etapa').locator('option').allInnerTexts();
    assert.ok(!etapas.some((e) => /Criação|Revisão/.test(e)), `só as etapas do fluxo da lista: ${etapas.join(', ')}`);
    const quadros = estado.quadros.length;
    await page.getByRole('textbox', { name: 'Buscar tarefa pelo nome' }).fill('Peça 01');
    await esperarAlcance(page, '1 encontrada');
    assert.equal(estado.quadros.length, quadros, 'busca na Lista não relê o quadro');

    await modo(page, 'Kanban').click();
    await page.waitForFunction(() => document.querySelectorAll('.q-colunas .q-cartao').length === 1);
    assert.equal(estado.quadros.length, quadros + 1, 'no Kanban a busca nova relê o quadro uma vez');
    assert.equal(await page.getByRole('textbox', { name: 'Buscar tarefa pelo nome' }).inputValue(), 'Peça 01', 'a mesma busca');
    assert.deepEqual(semRuido(erros), []);
  });

  await cenario('LK15', 'pasta em Lista: ficha e volta devolvem modo, filtro e posição; a escolha não vaza', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorLK(), viewport: { width: 1280, height: 700 } });
    await page.goto(BASE + ROTA_P);
    await page.locator('.q-colunas .q-coluna').first().waitFor();
    await modo(page, 'Lista').click(); // grava a preferência desta pasta e do tipo
    await esperarAlcance(page, '36 abertas');
    await page.goto(`${BASE}${ROTA_P}?ver=lista&agrupar=nenhum`);
    await esperarAlcance(page, '36 abertas');
    const alvo = page.locator('a.ek-titulo').nth(28);
    await alvo.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 80);
    await pause(400);
    const antes = await page.evaluate(() => Math.round(scrollY));
    assert.ok(antes > 100, `a página rolou (${antes})`);
    const href = await alvo.getAttribute('href');
    await alvo.click();
    await page.waitForURL('**' + href);
    // F43, Fase 7: a ficha abre ao lado; fechar é o ✕ do painel.
    await painelDaFicha(page).waitFor();
    await pause(300);
    await fecharFicha(page).click();
    await page.waitForURL((u) => u.pathname === ROTA_P);
    await esperarAlcance(page, '36 abertas');
    await pause(1200);
    const u = new URL(page.url());
    assert.equal(u.searchParams.get('ver'), 'lista');
    assert.equal(u.searchParams.get('agrupar'), 'nenhum');
    const depois = await page.evaluate(() => Math.round(scrollY));
    assert.ok(Math.abs(depois - antes) <= 4, `posição: antes ${antes}, depois ${depois}`);

    // A escolha da pasta não mexe na lista, no espaço nem em Minhas tarefas.
    const lugar = await page.evaluate(() => JSON.parse(localStorage.getItem('ideworks:lugar') ?? '{}'));
    assert.deepEqual(lugar.modos, { pasta: 'lista', [`pasta:${LK.timeA}`]: 'lista' });
    await page.goto(BASE + ROTA_L);
    await page.locator('.q-colunas .q-coluna').first().waitFor();
    assert.equal(await modo(page, 'Kanban').getAttribute('aria-pressed'), 'true', 'a lista segue no Kanban');
    await page.goto(BASE + `/quadro/espaco/${LK.espaco}`);
    await page.getByRole('heading', { name: 'Listas sem pasta' }).waitFor();
    assert.equal(await modo(page, 'Panorama').getAttribute('aria-pressed'), 'true', 'o espaço segue no Panorama');
    await page.goto(BASE + '/meu-trabalho');
    await modo(page, 'Lista').waitFor();
    assert.equal(await modo(page, 'Lista').getAttribute('aria-pressed'), 'true', 'Minhas segue na Lista');
    await page.goto(BASE + ROTA_P);
    await esperarAlcance(page, '36 abertas');
    assert.equal(await modo(page, 'Lista').getAttribute('aria-pressed'), 'true', 'sem ?ver=, a pasta volta na Lista escolhida');
    assert.deepEqual(semRuido(erros), []);
    return `scrollY ${antes} → ${depois}`;
  });

  await cenario('LK16', 'Minhas e Todas: Lista | Kanban com a mesma peça; preferência por tela; ?ver=quadro antigo', async (abrir) => {
    const { page, erros } = await abrir({ custom: servidorLK() });
    await page.goto(BASE + '/meu-trabalho');
    await modo(page, 'Kanban').waitFor();
    assert.deepEqual(await page.locator('[aria-label="Forma de ver"] button').allInnerTexts(), ['Lista', 'Kanban']);
    await modo(page, 'Kanban').click();
    await page.waitForURL('**/meu-trabalho?ver=kanban');
    await page.goto(BASE + '/meu-trabalho');
    await modo(page, 'Kanban').waitFor();
    assert.equal(await modo(page, 'Kanban').getAttribute('aria-pressed'), 'true', 'sem ?ver=, Minhas volta no Kanban escolhido');
    await page.goto(BASE + '/tarefas');
    await modo(page, 'Lista').waitFor();
    assert.equal(await modo(page, 'Lista').getAttribute('aria-pressed'), 'true', 'Todas não herdou a escolha de Minhas');
    assert.deepEqual(await page.locator('[aria-label="Forma de ver"] button').allInnerTexts(), ['Lista', 'Kanban']);
    await page.goto(BASE + '/tarefas?ver=quadro');
    await page.locator('.q-cartao').first().waitFor();
    assert.equal(await modo(page, 'Kanban').getAttribute('aria-pressed'), 'true', 'o endereço antigo abre no Kanban');
    assert.deepEqual(semRuido(erros), []);
  });

  const MATRIZ = [
    ['pasta', `${ROTA_P}?ver=lista`, '.ek-linha'],
    ['pasta', `${ROTA_P}?ver=kanban`, '.q-colunas .q-cartao'],
    ['lista', `${ROTA_L}?ver=lista`, '.ek-linha'],
    ['lista', `${ROTA_L}?ver=kanban`, '.q-colunas .q-cartao'],
    ['minhas', '/meu-trabalho?ver=lista', 'a[href^="/tarefa/"]'],
    ['minhas', '/meu-trabalho?ver=kanban', '.q-cartao'],
    ['todas', '/tarefas?ver=lista', 'a[href^="/tarefa/"]'],
    ['todas', '/tarefas?ver=kanban', '.q-cartao'],
  ];
  for (const [largura, tema] of [[1440, 'claro'], [1440, 'escuro'], [1280, 'claro'], [1280, 'escuro'], [390, 'claro'], [390, 'escuro']]) {
    await cenario(`LK-matriz-${largura}-${tema}`, 'pasta, lista, Minhas e Todas nos dois modos: seletor à vista, sem rolagem lateral', async (abrir) => {
      const { page, erros } = await abrir({ viewport: { width: largura, height: largura > 500 ? 900 : 844 }, tema, custom: servidorLK() });
      const medidas = [];
      for (const [tela, rota, pronto] of MATRIZ) {
        await page.goto(BASE + rota);
        await page.locator(pronto).first().waitFor();
        await pause(350);
        const m = await page.evaluate(() => {
          const g = document.querySelector('[aria-label="Forma de ver"]');
          const r = g?.getBoundingClientRect();
          return { sw: document.documentElement.scrollWidth, iw: innerWidth, seletor: r ? Math.round(r.right) : -1 };
        });
        const ver = new URL(page.url()).searchParams.get('ver');
        assert.ok(m.sw <= m.iw, `${tela} ${ver}: a página não rola de lado (${m.sw} > ${m.iw})`);
        assert.ok(m.seletor > 0 && m.seletor <= m.iw, `${tela} ${ver}: seletor dentro da tela (${m.seletor})`);
        assert.equal(await modo(page, ver === 'kanban' ? 'Kanban' : 'Lista').getAttribute('aria-pressed'), 'true');
        medidas.push(`${tela}/${ver} ${m.sw}`);
        if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${tela}-${ver}-${largura}-${tema}.png` });
      }
      assert.deepEqual(semRuido(erros), []);
      return medidas.join('; ');
    });
  }

  return resultados;
}
