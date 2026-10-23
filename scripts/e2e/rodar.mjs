/**
 * OS CENÁRIOS DE NAVEGADOR — `npm run e2e`. Etapa F17.AUD08.
 *
 * O QUE ISTO É
 *   As provas no Chrome real das correções da auditoria de 09/09/2026, num
 *   comando só. O plano pedia (seção 4.3): "registrar um comando de E2E na
 *   implementação, pois a base atual não possui essa execução como script
 *   padrão do pacote". Este é o comando.
 *
 * O QUE ELE NÃO É
 *   Não é a suíte (`npm test`, sem navegador, sem rede) nem a prova de banco
 *   (`scripts/provar-*.mjs`, contra o Postgres sob o papel `ideworks_app`).
 *   Aqui a API é INTERCEPTADA: cada cenário responde `/api/**` com dados
 *   fictícios. Nada chega ao banco. O que se prova é a tela — cliques,
 *   histórico, respostas fora de ordem, falhas e recuperação.
 *
 * SEM DEPENDÊNCIA NOVA
 *   O Playwright é resolvido de fora do projeto (`PLAYWRIGHT_MODULE` ou o
 *   `playwright-core`/`playwright` global) e o Chrome é o instalado na
 *   máquina (`CHROME_EXECUTABLE` ou o caminho padrão do macOS). Sem um
 *   deles, este script explica como instalar e sai com código 2.
 *
 * O VITE
 *   Se `127.0.0.1:8080` não responde, sobe `npm run dev` sozinho e o derruba
 *   no fim. Se já está no ar, usa o que está lá e não mexe. A API em 8787 NÃO
 *   é necessária: o proxy do Vite nunca é alcançado, porque a interceptação
 *   responde antes.
 *
 * USO
 *   npm run e2e                 # todos os arquivos, na ordem abaixo
 *   npm run e2e -- paginacao    # só os arquivos cujo nome contém o texto
 *
 * SAÍDA
 *   Um resumo por arquivo e um total. Código 1 se algum cenário falhou.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BASE, RAIZ, abrirNavegador, pause, resolverChrome, resolverPlaywright } from './comum.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

/** Na ordem das etapas: o defeito original invertido, depois cada correção, depois os combinados. */
const ARQUIVOS = [
  'esteira-pasta.mjs',
  // O ✓ de concluir no cartão da tela de pasta (lista DO cartão, status DELA).
  'concluir-na-pasta.mjs',
  'reordenar-listas.mjs',
  // F38, Fase 7: o cliente da tarefa — marca "exige cliente" na árvore,
  // criação com cliente obrigatório (modal e coluna) e troca no cartão.
  'cliente-da-tarefa.mjs',
  // F40, Fase 4: o tipo do card — obrigatório em lista de produção, selo no card, ficha.
  'tipo-do-card.mjs',
  // F42, Fase 3: a aprovação do cliente — chave e link na ficha, destinos na esteira.
  'aprovacao-configuracao.mjs',
  // F42, Fase 4: "Solicitar aprovação" no card — janela, ordem, envio, rodadas.
  'aprovacao-envio.mjs',
  // F42, Fase 6: a página do cliente — abrir sem sessão, comentar, aprovar, pedir ajustes, 320 px.
  'aprovacao-cliente.mjs',
  // F42, Fase 7: do lado da equipe — comentário "do cliente", rodada decidida com o motivo, histórico e sino.
  'aprovacao-equipe.mjs',
  'entrada-direta.mjs',
  'regressoes-dos-fluxos.mjs',
  'regressoes-do-cadastro.mjs',
  // F11A do plano UX: o painel como priorização (atalhos, endereço, retorno).
  'painel-ux.mjs',
  // F38: a última entrega pela Semanal no cartão e a ordenação por ela.
  'painel-ultima-entrega.mjs',
  // F11B: a ficha do cliente — áreas perto do topo, contexto no endereço.
  'cliente-ux.mjs',
  // F12: calendário (grade com teto, agenda, fusos) e planejamento.
  'agenda-planejamento.mjs',
  // F35: aba Semana do Planejamento — criar pela célula, concluir, celular.
  'planejamento-semana.mjs',
  // F40, Fase 7: o Controle da semana dos admins — atribuir, liberar, andamento e faltas.
  'controle-da-semana.mjs',
  'saida-da-tarefa.mjs',
  'paginacao.mjs',
  'data-e-cabecalho.mjs',
  'combinados.mjs',
  'links-do-editor.mjs',
  'colar-formatado.mjs',
  'conversa-chat.mjs',
  'espacos-e-arrasto.mjs',
  // F32: fechar o cartão devolve a rolagem das colunas e da faixa.
  'rolagem-do-quadro.mjs',
  // F43, Fase 7: o card abre num painel ao lado do Quadro (Pasta, Espaço,
  // Minhas, Todas); o endereço é /tarefa/:id; nenhum controle da ficha some.
  'card-ao-lado.mjs',
  // F18B: Panorama | Lista | Kanban no espaço (R09), peças comuns do escopo.
  'lista-kanban.mjs',
  'conexoes.mjs',
  // F13: Pessoas, Convidar e Catálogos — alcance, recusa junto do campo, sem envio duplo.
  'pessoas-convite.mjs',
  'pessoa-cadastro.mjs',
  // F14: Meta — contexto, zero ≠ sem dado ≠ sem coleta, período no endereço, ranking explicado.
  'meta-ux.mjs',
  'chat.mjs',
  'chat-responsivo.mjs',
  'reacoes-chat.mjs',
  // Conferência de 08/10: a janelinha do chat reconcilia, edita e apaga como a tela cheia.
  'chat-janelinha.mjs',
  'canal-com-login-vencido.mjs',
  'selo-de-origem.mjs',
  // F43, Fase 9: "Ir para…" — Ctrl+K de qualquer tela, o editor rico fica com o dele.
  'ir-para.mjs',
  // Conferência de 09/10: tela que estoura vira a tela de erro amigável (com a barra, "Tentar de novo").
  'tela-de-erro.mjs',
  // Conferência de 09/10: leituras que falham deixam sair da tela sem F5 (Cliente, Chat, calendários, Meta).
  'robustez-das-telas.mjs',
  // F16: a varredura transversal — barra por teclado e toque, estilos depois de
  // navegar, as 25 rotas em sete larguras e dois temas.
  'ux-transversal.mjs',
  // Revisão de acessibilidade (WCAG 2.2 AA): foco devolvido e preso, nomes, estados, avisos.
  'acessibilidade.mjs',
];

const filtro = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const escolhidos = filtro.length === 0 ? ARQUIVOS : ARQUIVOS.filter((a) => filtro.some((f) => a.includes(f)));
if (escolhidos.length === 0) {
  console.error(`Nenhum arquivo casa com ${JSON.stringify(filtro)}. Os que existem: ${ARQUIVOS.join(', ')}`);
  process.exit(2);
}

/* ─────────────── pré-condições: Playwright e Chrome ─────────────── */

let origemDoPlaywright;
let chrome;
try {
  origemDoPlaywright = resolverPlaywright().origem;
  chrome = resolverChrome();
} catch (e) {
  console.error('\n' + e.message + '\n');
  process.exit(2);
}

/* ────────────────────────── o Vite ────────────────────────── */

const responde = async () => {
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
};

let vite = null;
async function garantirVite() {
  if (await responde()) {
    console.log(`Vite já no ar em ${BASE}; não será derrubado no fim.`);
    return;
  }
  console.log(`Vite fora do ar em ${BASE}; subindo \`npm run dev\`…`);
  // Grupo de processos próprio: `npm run dev` gera o `vite` como filho, e é o
  // grupo inteiro que precisa morrer no fim, não só o npm.
  vite = spawn('npm', ['run', 'dev'], { cwd: RAIZ, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  vite.stdout.on('data', (d) => { saida += d; });
  vite.stderr.on('data', (d) => { saida += d; });
  const limite = Date.now() + 45_000;
  while (Date.now() < limite) {
    if (await responde()) {
      console.log('Vite no ar.');
      return;
    }
    if (vite.exitCode !== null) break;
    await pause(500);
  }
  console.error('O Vite não subiu em 45 s. Saída:\n' + saida.slice(-2000));
  derrubarVite();
  process.exit(2);
}

function derrubarVite() {
  if (!vite || vite.exitCode !== null) return;
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    vite.kill('SIGTERM');
  }
}

/* ──────────────────────────── rodar ──────────────────────────── */

const inicio = Date.now();
console.log(`Playwright: ${origemDoPlaywright}`);
console.log(`Chrome:     ${chrome}`);
await garantirVite();

const browser = await abrirNavegador();
const resumo = [];
let houveFalha = false;

try {
  for (const arquivo of escolhidos) {
    console.log(`\n▶ ${arquivo}`);
    const t0 = Date.now();
    let resultados;
    try {
      const { default: rodar } = await import(pathToFileURL(join(AQUI, arquivo)).href);
      resultados = await rodar(browser);
    } catch (e) {
      // Um erro fora de qualquer cenário (import quebrado, setup) conta como
      // falha do arquivo inteiro — e não derruba os arquivos seguintes.
      console.log(`  ERRO no arquivo — ${String(e?.message ?? e).split('\n')[0]}`);
      resultados = [{ id: '(arquivo)', ok: false, descricao: 'erro fora dos cenários', erro: e?.stack ?? String(e) }];
    }
    const falhas = resultados.filter((r) => !r.ok);
    const pendentes = resultados.filter((r) => r.ok && r.pendente);
    if (falhas.length > 0) houveFalha = true;
    resumo.push({ arquivo, total: resultados.length, falhas: falhas.map((f) => f.id), pendentes: pendentes.map((p) => p.id), segundos: ((Date.now() - t0) / 1000).toFixed(1) });
  }
} finally {
  await browser.close().catch(() => {});
  derrubarVite();
}

console.log('\n══════════════════════ RESUMO ══════════════════════');
let totalCenarios = 0;
let totalFalhas = 0;
let totalPendentes = 0;
for (const r of resumo) {
  totalCenarios += r.total;
  totalFalhas += r.falhas.length;
  totalPendentes += r.pendentes.length;
  const estado = r.falhas.length === 0 ? 'ok ' : 'FALHOU';
  const notas = [
    r.falhas.length ? 'falhas: ' + r.falhas.join(', ') : '',
    r.pendentes.length ? 'pendentes (defeito conhecido): ' + r.pendentes.join(', ') : '',
  ].filter(Boolean).join('; ');
  console.log(`${estado}  ${r.arquivo.padEnd(28)} ${String(r.total - r.falhas.length).padStart(3)}/${String(r.total).padEnd(3)} em ${r.segundos}s${notas ? '  ' + notas : ''}`);
}
const passaram = totalCenarios - totalFalhas - totalPendentes;
console.log(`\n${passaram} de ${totalCenarios} cenários passaram${totalPendentes ? `, ${totalPendentes} pendente${totalPendentes === 1 ? '' : 's'} (defeito conhecido, falha esperada)` : ''}${totalFalhas ? `, ${totalFalhas} FALHARAM` : ''} em ${((Date.now() - inicio) / 1000).toFixed(0)}s (${escolhidos.length} arquivo${escolhidos.length === 1 ? '' : 's'}).`);
process.exit(houveFalha ? 1 : 0);
