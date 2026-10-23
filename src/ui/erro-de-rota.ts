/**
 * AS PERGUNTAS DA TELA DE ERRO DE ROTA — conferência de 09/10/2026.
 *
 * Puras, e separadas do componente (`@/ui/ErroDeRota`) por duas razões: a
 * suíte as prova sem navegador, e um arquivo que define componentes não deve
 * exportar mais nada (o recarregamento rápido do Vite perde o fio).
 */

/**
 * O pedaço da tela NÃO BAIXOU? (a publicação trocou o nome dos arquivos, ou a
 * rede caiu no meio do `import()`).
 *
 * É a falha que `recarga-por-pacote-novo` já trata: uma vez por minuto a aba
 * se recarrega sozinha e pega o pacote novo. Se a falha chegou até aqui, a
 * recarga automática já foi gasta (ou o armazenamento não existe) — e o certo
 * é pedir a recarga à pessoa, sem oferecer "Tentar de novo": o `React.lazy`
 * GUARDA a promessa rejeitada, e reerguer a tela relançaria o mesmo erro.
 *
 * As frases são de cada navegador, e não há contrato escrito para elas — por
 * isso a lista é de padrões, e o desconhecido cai em "estouro comum" (que
 * oferece as duas saídas). Errar para esse lado custa um clique a mais; errar
 * para o outro esconderia o botão que resolve.
 */
export function ehFalhaDePacote(erro: unknown): boolean {
  if (!(erro instanceof Error)) return false;
  if (erro.name === 'ChunkLoadError') return true;
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(erro.message);
}

/**
 * O texto técnico, para o desenvolvedor. Só vai à tela em desenvolvimento
 * (ver `ErroDeRota`); em produção a pilha fica no console.
 */
export function detalhesDoErro(erro: unknown): string {
  if (erro instanceof Error) return erro.stack ?? `${erro.name}: ${erro.message}`;
  if (erro === null || erro === undefined) return 'Erro sem detalhes.';
  if (typeof erro === 'string') return erro;
  try {
    return JSON.stringify(erro);
  } catch {
    return String(erro);
  }
}

/**
 * Estamos no servidor de desenvolvimento? O Vite troca `import.meta.env.DEV`
 * na construção (e a pilha crua nunca chega à tela de quem usa o sistema).
 *
 * O projeto não carrega os tipos de `vite/client`, então o acesso é por um
 * tipo mínimo, escrito aqui — acrescentar o arquivo global de tipos do Vite só
 * por esta leitura mudaria a verificação do resto do código.
 */
export const emDesenvolvimento = (): boolean =>
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
