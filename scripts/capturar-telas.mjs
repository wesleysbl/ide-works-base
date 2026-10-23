/**
 * GERA AS CAPTURAS DE TELA DA DOCUMENTAÇÃO, com dados 100% fictícios.
 *
 * Abre o sistema no navegador contra o servidor fictício das provas de tela
 * (`scripts/e2e/fixtures-ux.mjs`): nenhuma rota sai para a rede, nenhum banco
 * é tocado. Grava as imagens em `docs/imagens/telas/`.
 *
 * COMO RODAR
 *   1. Num terminal:   npm run dev            (o site na porta 8080)
 *   2. Noutro:         node scripts/capturar-telas.mjs
 *
 *   Precisa do Playwright (só o `playwright-core`) e de um Chrome:
 *     npm i -g playwright-core
 *     CHROME_EXECUTABLE=/caminho/do/chrome node scripts/capturar-telas.mjs
 *   No Mac, o Chrome padrão é achado sozinho.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, RAIZ, abrirNavegador, pause, setup } from './e2e/comum.mjs';
import { semSessao, servidorUX } from './e2e/fixtures-ux.mjs';
import { GERAL } from './e2e/chat.mjs';
import { LK } from './e2e/lista-kanban.mjs';

const PASTA = join(RAIZ, 'docs', 'imagens', 'telas');
mkdirSync(PASTA, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const CELULAR = { width: 390, height: 844 };

/** [arquivo, caminho, opções]: a ordem é a do tutorial de uso. */
const TELAS = [
  ['01-entrar', '/', { publica: true }],
  ['02-painel', '/painel'],
  ['03-cliente', '/cliente/cx-1'],
  ['04-planejamento', '/planejamento'],
  ['05-controle-da-semana', '/controle-da-semana'],
  ['06-quadro-lista', `/quadro/${LK.l1}`],
  ['07-quadro-espaco', `/quadro/espaco/${LK.espaco}`],
  ['08-minhas-tarefas', '/meu-trabalho'],
  ['09-todas-as-tarefas', '/tarefas'],
  ['10-tarefa', '/tarefa/t-ux-1'],
  ['11-chat', `/chat/${GERAL}`],
  ['12-avisos', '/avisos'],
  ['13-catalogos', '/catalogos'],
  ['14-meta-contas', '/meta'],
  ['15-meta-ranking', '/meta/ranking'],
  ['16-meta-relatorio', '/meta/a-horizonte'],
  ['17-pessoas', '/pessoas'],
  ['18-conexoes', '/conexoes'],
  ['19-painel-escuro', '/painel', { tema: 'escuro' }],
  ['20-celular-minhas-tarefas', '/meu-trabalho', { viewport: CELULAR }],
  ['21-celular-chat', `/chat/${GERAL}`, { viewport: CELULAR }],
  ['22-celular-aprovacao-do-cliente', '/aprovar/uxTokenDeExemplo0123456789abcdefghijklmnopq', { publica: true, viewport: CELULAR }],
];

/** A tela pronta: um `<h1>` visível com texto (ou o rótulo da marca, na entrada). */
async function esperarTela(page) {
  await page.waitForFunction(
    () => {
      const h = [...document.querySelectorAll('h1')].find((x) => x.getBoundingClientRect().height > 0);
      return Boolean(h && (h.textContent.trim() || h.getAttribute('aria-label') || h.querySelector('[aria-label]')));
    },
    null,
    { timeout: 15_000 },
  );
}

const navegador = await abrirNavegador();
const abertos = new Map();
let falhas = 0;
try {
  for (const [nome, caminho, opcoes = {}] of TELAS) {
    const viewport = opcoes.viewport ?? DESKTOP;
    const tema = opcoes.tema ?? 'claro';
    const chave = `${opcoes.publica ? 'publica' : 'sessao'}-${viewport.width}-${tema}`;
    if (!abertos.has(chave)) {
      abertos.set(
        chave,
        await setup(navegador, { custom: opcoes.publica ? semSessao : servidorUX(), viewport, tema }),
      );
    }
    const { page } = abertos.get(chave);
    await page.goto(BASE + caminho);
    try {
      await esperarTela(page);
    } catch {
      console.error(`✗ ${nome}: a tela não ficou pronta (${caminho})`);
      falhas += 1;
      continue;
    }
    await pause(600);
    await page.screenshot({ path: join(PASTA, `${nome}.png`) });
    console.log(`✓ ${nome}.png`);
  }
} finally {
  for (const { context } of abertos.values()) await context.close().catch(() => {});
  await navegador.close();
}
process.exit(falhas > 0 ? 1 : 0);
