/**
 * A PRÉ-CARGA DA TELA PELO ENDEREÇO — perf-front, 08/10/2026.
 *
 * O PROBLEMA, MEDIDO
 *   Cada tela é um pedaço de código buscado sob demanda (`lazy`, ver
 *   `src/rotas.tsx`). Só que o navegador só descobre QUAL pedaço buscar depois
 *   de baixar a entrada, executá-la, esperar `/api/config` e desenhar a moldura.
 *   Numa abertura a frio de `/meu-trabalho` (4G simulado, 40 ms de ida e volta):
 *
 *        76 ms  entrada começa a baixar
 *       237 ms  entrada executada → `/api/config`
 *       330 ms  config voltou, tela desenhada → SÓ ENTÃO pede os 16 pedaços da tela
 *       441 ms  pedaços chegaram
 *       468 ms  primeiras chamadas de dados
 *
 *   O endereço, porém, já estava na barra desde o primeiro byte. O `vite.config`
 *   escreve no `<head>` um script de uma linha que olha `location.pathname`,
 *   descobre a tela e põe `modulepreload` nos pedaços dela (e `preload` nas
 *   folhas de estilo) — em paralelo com a entrada, e não depois dela.
 *
 * ONDE ESTÁ A TABELA, E POR QUE ELA NÃO É DERIVADA DE `ROTAS`
 *   O `vite.config.ts` roda em Node, antes de existir React; não dá para
 *   importar `src/rotas.tsx` lá (JSX, `lazy`, alias). Então a tabela mora aqui,
 *   pura, e `rotas-precarga.test.ts` LÊ `src/rotas.tsx` e falha se alguma rota
 *   adiada ficar sem entrada (ou apontar para a tela errada). Esquecer uma
 *   entrada não quebra nada — a tela só carrega como antes, sem adiantamento —,
 *   mas o teste existe para o esquecimento não ser silencioso.
 *
 * ⚠️ `moduloDoCaminho` É SERIALIZADA COM `toString()` PARA DENTRO DO HTML
 *   Por isso ela não pode usar NADA de fora de si (nem constantes de módulo,
 *   nem outras funções): o que o navegador recebe é o texto dela. Quem a editar
 *   mantém a assinatura `(caminho, regras)` e o corpo autossuficiente.
 */

/** `[padrão do endereço, módulo da tela]` — o módulo é o caminho sob `src/`, sem extensão. */
export type RegraDePrecarga = readonly [padrao: string, modulo: string];

/**
 * Na ordem em que o roteador casa: o trecho FIXO antes do parâmetro quando os
 * dois têm o mesmo número de segmentos (`/meta/ranking` antes de `/meta/:id`).
 * Rotas com número de segmentos diferentes não competem.
 *
 * Fora desta tabela, de propósito: `/` (a entrada, que não é adiada), `*` (o
 * "não encontrado", barato e raro) e `/aprovar/:token` — a página do cliente
 * tem o próprio caminho curto e não passa pela moldura.
 */
export const REGRAS_DE_PRECARGA: readonly RegraDePrecarga[] = [
  ['/ativar', 'pages/Ativar'],
  ['/redefinir', 'pages/Redefinir'],
  ['/painel', 'pages/Painel'],
  ['/cliente/:id', 'pages/Cliente'],
  // `/calendario` é só o desvio para `/planejamento?visao=calendario`.
  ['/calendario', 'pages/Planejamento'],
  ['/planejamento', 'pages/Planejamento'],
  ['/controle-da-semana', 'pages/ControleDaSemana'],
  ['/quadro', 'pages/Quadro'],
  ['/quadro/espaco/:espacoId', 'pages/Espaco'],
  ['/quadro/pasta/:pastaId', 'pages/Pasta'],
  ['/quadro/:listaId', 'pages/Quadro'],
  ['/meu-trabalho', 'pages/MeuTrabalho'],
  ['/tarefas', 'pages/TodasAsTarefas'],
  ['/avisos', 'pages/CaixaDeEntrada'],
  ['/chat', 'pages/Chat'],
  ['/chat/:conversationId', 'pages/Chat'],
  ['/tarefa/:tarefaId', 'pages/Tarefa'],
  ['/catalogos', 'pages/Catalogos'],
  ['/meta', 'pages/MetaContas'],
  ['/meta/ranking', 'pages/MetaRanking'],
  ['/meta/:id', 'pages/MetaRelatorio'],
  ['/contas', 'pages/Contas'],
  ['/pessoas', 'pages/Pessoas'],
  ['/conexoes', 'pages/Conexoes'],
];

/**
 * O módulo da tela que atende este endereço, ou `null`.
 *
 * Casa por SEGMENTOS, sem diferenciar maiúsculas (o roteador também não
 * diferencia) e sem se importar com a barra final. `:parametro` vale por
 * qualquer segmento.
 */
export function moduloDoCaminho(
  caminho: string,
  regras: readonly (readonly [string, string])[],
): string | null {
  const partes = caminho.toLowerCase().split('/').filter(Boolean);
  for (const [padrao, modulo] of regras) {
    const alvo = padrao.toLowerCase().split('/').filter(Boolean);
    if (alvo.length !== partes.length) continue;
    if (alvo.every((a, i) => a.charAt(0) === ':' || a === partes[i])) return modulo;
  }
  return null;
}
