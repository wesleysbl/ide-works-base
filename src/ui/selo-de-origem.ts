/**
 * O TEXTO DO SELO DE ORIGEM — F26, fase 9.
 *
 * Puro, sem React: a ficha (`rodapeDaFicha`) e o desenho (`SeloDeOrigem`)
 * escrevem a mesma frase, e a frase mora num lugar só. Ver o cabeçalho de
 * `@/ui/SeloDeOrigem`.
 */

/** O nome da conexão, limpo; `null` quando a linha é de gente. */
export function nomeDaConexao(via: string | null | undefined): string | null {
  const nome = typeof via === 'string' ? via.trim() : '';
  return nome === '' ? null : nome;
}

/**
 * O texto do selo, ou `null` quando não há selo.
 *
 * `pessoa` presente = o lugar não mostra o autor, e o selo o nomeia.
 * `pessoa` ausente = o nome já está ao lado, e o selo diz só a conexão.
 */
export function textoDoSeloDeOrigem(
  via: string | null | undefined,
  pessoa?: string | null,
): string | null {
  const conexao = nomeDaConexao(via);
  if (conexao === null) return null;
  const quem = typeof pessoa === 'string' ? pessoa.trim() : '';
  return quem === '' ? `via ${conexao}` : `${quem}, via ${conexao}`;
}

/** A frase inteira, para o ponteiro parado em cima. */
export function tituloDoSeloDeOrigem(
  via: string | null | undefined,
  pessoa?: string | null,
): string | null {
  const conexao = nomeDaConexao(via);
  if (conexao === null) return null;
  const quem = typeof pessoa === 'string' ? pessoa.trim() : '';
  return quem === ''
    ? `Escrito pela IA ${conexao}`
    : `Escrito pela IA ${conexao}, em nome de ${quem}`;
}
