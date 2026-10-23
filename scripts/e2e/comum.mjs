/**
 * O que todos os cenários de navegador dividem — F17.AUD08.
 *
 * DE ONDE VEIO
 *   A auditoria de 09/09/2026 provou os nove achados no Chrome real com a API
 *   simulada (`docs/auditoria-2026-09-09/reproduzir-fluxos.mjs`). As etapas
 *   AUD01 a AUD07 provaram as correções com scripts do mesmo desenho, que
 *   ficaram no rascunho da sessão. Este arquivo é o `setup` deles, num lugar
 *   só, para os cenários de `scripts/e2e/` não repetirem sessenta linhas cada.
 *
 * O QUE ELE GARANTE
 *   - NENHUM cenário toca o banco: `context.route('**\/api/**')` intercepta
 *     tudo e responde com dados fictícios. Não há sessão real, cookie real
 *     nem escrita real. A prova da consulta no Postgres é outra
 *     (`scripts/provar-paginacao-do-trabalho.mjs`) e exige `.env`.
 *   - O Playwright e o Chrome vêm de FORA do projeto: `package.json` não
 *     ganha dependência. Ver `resolverPlaywright` e `resolverChrome`.
 *   - As fixtures (`row`, `detail`) são lidas dos testes unitários, como a
 *     auditoria fez, para a linha e a ficha serem as mesmas que a suíte usa.
 *
 * USO
 *   Não se roda sozinho. Ver `scripts/e2e/rodar.mjs`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:8080';

/**
 * O "hoje" das fixtures é o de SÃO PAULO, como o do app (`hojeNaAgencia`) —
 * conferência de 08/10. Com `new Date()` em UTC, das 21h à meia-noite as
 * fixtures já estavam no dia (ou no mês) seguinte e a tela não: cliente-ux CX2
 * e CX11 e painel-ux PX1 falhavam só nesse horário. Meio-dia em UTC do dia de
 * São Paulo: `getUTC*` e `toISOString()` dão esse dia em qualquer fuso.
 */
export const hojeEmSaoPaulo = () =>
  new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())}T12:00:00Z`);
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────── Playwright e Chrome ───────────────────────── */

const require = createRequire(import.meta.url);

const AJUDA_PLAYWRIGHT = [
  'O Playwright não foi encontrado, e o projeto não o instala de propósito',
  '(nenhuma dependência nova em package.json). Duas saídas:',
  '',
  '  1. npm i -g playwright-core',
  '     e rode de novo: npm run e2e',
  '',
  '  2. PLAYWRIGHT_MODULE=/caminho/para/node_modules/playwright-core npm run e2e',
  '     (um diretório ou arquivo de módulo já instalado em qualquer lugar)',
  '',
  'Só o `playwright-core` basta: o Chrome usado é o instalado na máquina,',
  'não o navegador que o pacote `playwright` baixa.',
].join('\n');

const AJUDA_CHROME = (tentado) =>
  [
    `O Chrome não foi encontrado em: ${tentado}`,
    'Indique o executável com CHROME_EXECUTABLE=/caminho/do/chrome npm run e2e',
  ].join('\n');

/** Onde os pacotes globais costumam morar, sem depender de um único gerenciador. */
function raizesGlobais() {
  const raizes = [
    RAIZ,
    join(dirname(process.execPath), '..', 'lib', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    join(homedir(), '.npm-global', 'lib', 'node_modules'),
    ...(process.env.NODE_PATH ?? '').split(':').filter(Boolean),
  ];
  try {
    raizes.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    // Sem npm no PATH a lista acima ainda cobre os lugares comuns.
  }
  return [...new Set(raizes)];
}

/**
 * Devolve `{ chromium, origem }`. `PLAYWRIGHT_MODULE` ganha; depois
 * `playwright-core` e `playwright` nas raízes globais. Sem nenhum, lança com
 * a explicação em português — o runner a imprime e sai com código 2.
 */
export function resolverPlaywright() {
  const candidatos = [];
  if (process.env.PLAYWRIGHT_MODULE) candidatos.push({ id: process.env.PLAYWRIGHT_MODULE, paths: undefined });
  const paths = raizesGlobais();
  candidatos.push({ id: 'playwright-core', paths }, { id: 'playwright', paths });
  for (const { id, paths: p } of candidatos) {
    try {
      const caminho = require.resolve(id, p ? { paths: p } : undefined);
      const modulo = require(caminho);
      if (modulo?.chromium) return { chromium: modulo.chromium, origem: caminho };
    } catch {
      // Tenta o próximo.
    }
  }
  throw new Error(AJUDA_PLAYWRIGHT);
}

export function resolverChrome() {
  const caminho =
    process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!existsSync(caminho)) throw new Error(AJUDA_CHROME(caminho));
  return caminho;
}

export async function abrirNavegador() {
  const { chromium } = resolverPlaywright();
  return chromium.launch({ headless: true, executablePath: resolverChrome() });
}

/* ───────────────────────────── fixtures ───────────────────────────── */

const fonte = (arquivo) => readFileSync(join(RAIZ, arquivo), 'utf8');

/** A linha de `Minhas tarefas` que a suíte usa (`UMA_LINHA`). */
export const row = Function(
  'return (' + fonte('src/board/tela-do-trabalho.test.ts').match(/const UMA_LINHA: WorkRow = (\{[\s\S]*?\n\});/)[1] + ')',
)();

const SEM_PROGRESSO = {
  subtaskCount: 0, subtaskDone: 0, checklistCount: 0, checklistTotal: 0, checklistDone: 0,
  attachmentCount: 0, linkCount: 0, commentCount: 0,
};

/** A ficha completa de uma tarefa (`fichaDe` de `ficha.test.ts`). */
export const detail = Function(
  'SEM_PROGRESSO', 'p',
  'return (' + fonte('src/board/ficha.test.ts').match(/const fichaDe = [^\n]*=> \((\{[\s\S]*?\n\})\);/)[1] + ')',
)(SEM_PROGRESSO, {});

/** A sessão fictícia. `userId` é o que a AUD02 acrescentou a `/auth/me`. */
export const sessaoDe = (userId = 'u-ana') => ({
  ok: true, userId, email: 'review@example.invalid', isSuperadmin: true, isSuper: true, papel: 'super_admin', areas: [],
});

/** A resposta padrão de cada rota da API — o que a auditoria usava, mais `/clients`. */
export function respostaPadrao(url, req) {
  const p = url.pathname;
  if (p === '/api/board/my-tasks') return { ok: true, work: { rows: [row], total: 1, capped: false } };
  if (p === '/api/board/all-tasks')
    return { ok: true, work: { rows: [row], total: 1, matched: 1, capped: false, assigneeOptions: [], unassignedTasks: 0 } };
  if (p.startsWith('/api/board/tasks/')) {
    const patch = req.method() === 'PATCH' ? req.postDataJSON() ?? {} : {};
    return {
      ok: true,
      task: { ...detail, id: row.id, title: patch.title ?? row.title, description: patch.description ?? detail.description },
      storage: { ready: false, variable: '' },
    };
  }
  if (p.startsWith('/api/board/tree')) return { ok: true, spaces: [], companies: [] };
  if (p === '/api/team') return { ok: true, team: [], me: 'a' };
  if (p === '/api/auth/me') return sessaoDe();
  if (p === '/api/catalogs') return { ok: true, categories: [{ id: 'c1', name: 'Ide', isDefault: true }], plans: [], tags: [] };
  // CONEXÕES DE AGENTE (F21.5a). Sem estas três linhas, a tela de `/conexoes`
  // cairia no `{ ok: true, rows: [] }` genérico do fim e desenharia com
  // `connections` indefinido — que foi exatamente como uma regressão passou
  // despercebida antes. Rota nova, resposta com a FORMA da rota nova.
  if (p === '/api/integrations/v1/connections' && req.method() === 'GET')
    return { ok: true, connections: [], dayResetsAt: new Date(Date.now() + 3600e3).toISOString() };
  if (p === '/api/integrations/v1/connections/executions') return { ok: true, executions: [] };
  if (p.startsWith('/api/integrations/v1/connections/')) return { ok: true };
  if (p === '/api/config') return { ok: true, trustedImageHosts: '', chat: 'desligado' };
  // `conferencia` — F28. O `/painel` lê `r.conferencia` desde a F27 (ver
  // `@/painel/conferencia`); sem ela a tela quebrava na API simulada e todo
  // cenário que passasse pelo painel media uma tela caída.
  if (p === '/api/clients' && req.method() === 'GET')
    return {
      ok: true, from: url.searchParams.get('from'), to: url.searchParams.get('to'), months: [], clients: [],
      conferencia: { clientesSemLista: [], listasSemCliente: [] },
    };
  // O QUADRO DE UMA LISTA — F28. Sem esta resposta `/quadro/:id` caía no
  // genérico do fim, sem `board`, e desenhava a recusa em vez do quadro. Uma
  // lista vazia de duas etapas: quem precisa de cartões responde a sua no
  // `custom` (ver `espacos-e-arrasto.mjs`).
  const lista = /^\/api\/board\/lists\/([^/]+)$/.exec(p);
  if (lista && req.method() === 'GET')
    return { ok: true, board: quadroVazio(lista[1]) };
  // AS LISTAS LIGADAS A UM CLIENTE — F29.5b. A ficha do cliente lê
  // `/clients/:id/board-lists` junto com o `/form` desde a F17.84, num
  // `Promise.all`; o genérico do fim não tem `lists`, a leitura inteira caía
  // em "Não foi possível abrir." e o formulário ficava vazio — era isso que
  // derrubava `data-e-cabecalho` B2-editar, e não a data. Nenhuma lista
  // ligada: quem precisa de listas responde a sua no `custom`.
  if (/^\/api\/clients\/[^/]+\/board-lists$/.test(p) && req.method() === 'GET')
    return { ok: true, lists: [] };
  return { ok: true, notices: [], unread: 0, total: 0, rows: [] };
}

const ETAPAS_PADRAO = [
  { id: 'st-aberta', name: 'a fazer', type: 'open', color: null, sortOrder: 0 },
  { id: 'st-feita', name: 'feito', type: 'closed', color: null, sortOrder: 1 },
];

/** O quadro de `/api/board/lists/:id` quando o cenário não responde o seu. */
export const quadroVazio = (listId) => ({
  header: {
    listId, listName: 'Lista', listContent: null, folderId: null, folderName: null,
    spaceId: 'e1', spaceName: 'AGÊNCIA IDE', categoryName: 'Ide', statusSetName: 'Esteira', inheritedFrom: 'list',
  },
  statuses: ETAPAS_PADRAO,
  tasks: [],
  availableTags: [],
  columnTotals: Object.fromEntries(ETAPAS_PADRAO.map((s) => [s.id, 0])),
  columnMatched: Object.fromEntries(ETAPAS_PADRAO.map((s) => [s.id, 0])),
  perColumn: 50,
  assigneeOptions: [],
  unassignedTasks: 0,
  filter: { texto: '', responsavel: null },
});

/**
 * Um contexto novo com a API interceptada.
 *
 * `custom(url, req)` pode devolver `{ status?, body? }` para uma rota; o que
 * ele não responder cai na resposta padrão. Devolve também `writes` (todo
 * PATCH, com corpo), `pedidos` (todo pedido a `my-tasks`, com aba e cursor) e
 * `erros` (erros de console e de página).
 */
export async function setup(browser, { custom = () => null, viewport, timezoneId, tema, toque = false, locale } = {}) {
  // `toque` — F35: celular de verdade (`hasTouch` + `isMobile`), para as regras
  // `(pointer: coarse)` e `(hover: hover)` da folha valerem como no aparelho.
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1440, height: 900 },
    timezoneId,
    // `locale` fixa a ordem dos segmentos do campo de data (mm/dd/aaaa em en-US).
    ...(locale ? { locale } : {}),
    ...(toque ? { hasTouch: true, isMobile: true } : {}),
  });
  if (tema) await context.addInitScript((t) => { try { localStorage.setItem('ideworks:tema', t); } catch { /* sem cofre */ } }, tema);
  const writes = [];
  const pedidos = [];
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'PATCH') writes.push({ url: url.pathname, body: req.postDataJSON() });
    if (url.pathname === '/api/board/my-tasks') pedidos.push({ aba: url.searchParams.get('aba'), cursor: url.searchParams.get('cursor') });
    const resposta = await custom(url, req);
    const body = resposta?.body ?? respostaPadrao(url, req);
    await route
      .fulfill({ status: resposta?.status ?? 200, contentType: 'application/json', body: JSON.stringify(body) })
      .catch(() => {});
  });
  const page = await context.newPage();
  const erros = [];
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  return { context, page, writes, pedidos, erros };
}

/* ─────────────────────────── atalhos de tela ─────────────────────────── */

export const X = { name: 'Fechar tarefa e voltar', exact: true };
export const janela = (page) => page.getByRole('dialog', { name: 'Sair sem salvar?' });
export const campoTitulo = (page) => page.getByRole('textbox', { name: 'Título da tarefa', exact: true });

/*
 * O TÍTULO DA TAREFA SE LÊ PELO TEXTO, E NÃO POR `inputValue()` — F29.5b.
 *
 * Desde as menções (`20084e8`) o título da ficha é `CampoComMencoes`: um
 * `contenteditable` com `role="textbox"`, e não mais um `<textarea>`. Os
 * cenários continuavam lendo do jeito antigo — `inputValue()`, que lança "Not
 * an input element" num `div`, e `textarea[aria-label=…]`, que não acha nada e
 * espera até estourar. Caíam ANTES de chegar à asserção, e por isso a lista de
 * falhas antigas não dizia nada sobre o que cada cenário provava.
 *
 * A leitura é o `textContent` do campo, o texto que a ficha mostra e grava (o
 * título é de uma linha só: `umaLinha` troca quebra por espaço). Só a FORMA de
 * ler muda — cada asserção compara o mesmo valor com o mesmo esperado.
 */
export const SELETOR_DO_TITULO = '[role="textbox"][aria-label="Título da tarefa"]';

/** O texto do título, a partir do localizador de `campoTitulo`. */
export const lerTitulo = (campo) => campo.evaluate((el) => el.textContent);

/** Espera o título da ficha dizer `texto` — o `waitForFunction` do `<textarea>` de antes. */
export const esperarTitulo = (page, texto, opcoes) =>
  page.waitForFunction(
    ([seletor, esperado]) => document.querySelector(seletor)?.textContent === esperado,
    [SELETOR_DO_TITULO, texto],
    opcoes,
  );

/**
 * Abre a única tarefa de `Minhas tarefas` NA PÁGINA CHEIA e edita o título.
 *
 * ⚠️ F43, Fase 7: o clique na linha abre a ficha AO LADO (painel por cima da
 * lista, endereço mascarado). Os cenários que usam isto provam a saída da
 * PÁGINA — o X, a trilha, a barra, o Voltar —, então passam de propósito por
 * "Abrir em tela cheia", que troca o painel pela página NO MESMO lugar do
 * histórico (`replace`): o histórico fica o de antes, `/meu-trabalho` →
 * `/tarefa/:id`. A saída do PAINEL tem a sua suíte (`card-ao-lado`).
 */
export async function abrirTarefaEditada(page, texto = 'EDIÇÃO QUE NÃO PODE SUMIR') {
  await page.goto(BASE + '/meu-trabalho');
  await page.getByRole('link', { name: row.title, exact: true }).waitFor();
  await page.getByRole('link', { name: row.title, exact: true }).click();
  await abrirEmTelaCheia(page);
  const title = campoTitulo(page);
  await title.waitFor();
  await title.fill(texto);
  await page.getByText('há alterações por salvar', { exact: true }).waitFor();
  return title;
}

/**
 * O CARD AO LADO — F43, Fase 7. Clicar no cartão (ou na linha) de Quadro, Pasta,
 * Espaço, Minhas e Todas abre a ficha neste painel, por cima da tela, com o
 * endereço mascarado como `/tarefa/:id`; o ✕ dele ("Fechar") fecha — é o que
 * os cenários de "abrir o cartão e fechar" usam no lugar do X da página.
 */
export const painelDaFicha = (page) => page.locator('[data-painel-lateral] [role="dialog"]');
export const fecharFicha = (page) => painelDaFicha(page).getByRole('button', { name: 'Fechar', exact: true });

/**
 * Do painel ao lado para a página cheia da mesma tarefa — F43, Fase 7. Para os
 * cenários anteriores à fase que abriam a ficha clicando no cartão ou na linha
 * e depois usavam a PÁGINA (o X, o topo grudado, a trilha): o clique agora abre
 * o painel, e o "Abrir em tela cheia" dele leva à página que eles testam.
 */
export async function abrirEmTelaCheia(page) {
  await painelDaFicha(page).getByRole('link', { name: 'Abrir em tela cheia', exact: true }).click();
  await page.locator('.t-cabeca').waitFor();
}

/** O aviso nativo de saída está armado? (um `beforeunload` sintético é prevenido) */
export const beforeunloadArmado = (page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

/** Os títulos das tarefas desenhadas (lista ou quadro). */
export const titulos = (page) =>
  page.evaluate(() => Array.from(document.querySelectorAll('a[href^="/tarefa/"]')).map((a) => a.textContent.trim()));

/**
 * `npm run dev` roda em StrictMode: cada montagem abre, encerra e abre de
 * novo, então a PRIMEIRA página de uma aba é pedida duas vezes seguidas (a 1ª
 * resposta é descartada pelo bilhete da AUD01). Isto tira só esse eco — nunca
 * um `c1, c1` de nova tentativa.
 */
export const semEco = (lista) =>
  lista.filter((p, i) => !(i > 0 && p.cursor === null && lista[i - 1].cursor === null && lista[i - 1].aba === p.aba));

/* ──────────────────────────── a suíte ──────────────────────────── */

/**
 * Um cenário por vez, com os contextos abertos fechados no fim, passe ou
 * falhe. `fn(abrir)` recebe `abrir(opcoes)` — o `setup` que registra o
 * contexto para fechar — e devolve, se quiser, um detalhe para o resumo.
 *
 * `pendente(id, descricao, motivo, fn)` é o cenário que DESCREVE UM DEFEITO
 * CONHECIDO e ainda não corrigido: a asserção é a do comportamento certo, e
 * hoje ela falha. Falhar é o esperado e não derruba o comando; PASSAR é
 * erro — significa que o defeito foi corrigido e a marca ficou para trás.
 * Assim a lista de pendências não envelhece em silêncio.
 */
export function criarSuite(browser) {
  const resultados = [];
  const linhasDe = (e) => String(e?.message ?? e).split('\n').slice(0, 12).map((l) => '         ' + l).join('\n');

  async function rodar(fn) {
    const abertos = [];
    const abrir = async (opcoes) => {
      const s = await setup(browser, opcoes);
      abertos.push(s.context);
      return s;
    };
    try {
      return { detalhe: (await fn(abrir)) ?? null };
    } catch (e) {
      return { erro: e };
    } finally {
      for (const c of abertos) await c.close().catch(() => {});
    }
  }

  async function cenario(id, descricao, fn) {
    const r = await rodar(fn);
    if (!r.erro) {
      resultados.push({ id, ok: true, descricao, detalhe: r.detalhe });
      console.log(`  PASSOU ${id} — ${descricao}${r.detalhe ? `\n         ${r.detalhe}` : ''}`);
    } else {
      resultados.push({ id, ok: false, descricao, erro: r.erro?.stack ?? String(r.erro) });
      console.log(`  FALHOU ${id} — ${descricao}\n${linhasDe(r.erro)}`);
    }
  }

  async function pendente(id, descricao, motivo, fn) {
    const r = await rodar(fn);
    if (r.erro) {
      resultados.push({ id, ok: true, pendente: true, descricao, motivo, erro: r.erro?.stack ?? String(r.erro) });
      console.log(`  PENDENTE ${id} — ${descricao}\n         defeito conhecido: ${motivo}\n         (falha esperada: ${String(r.erro?.message ?? r.erro).split('\n')[0]})`);
    } else {
      resultados.push({ id, ok: false, descricao, erro: 'passou, mas está marcado como pendente — o defeito foi corrigido: retire a marca `pendente` deste cenário' });
      console.log(`  FALHOU ${id} — ${descricao}\n         passou, mas está marcado como pendente: o defeito foi corrigido, retire a marca.`);
    }
  }

  return { cenario, pendente, resultados };
}
