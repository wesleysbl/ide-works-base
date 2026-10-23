/**
 * O SELO DE ORIGEM — F26, fase 9.
 *
 * *"Carla, via ChatGPT"*: a linha foi escrita pela IA que a Carla conectou.
 *
 * DE ONDE VEM, E POR QUE É VISÍVEL A TODOS
 *   O selo do comentário (`seloDeAgente`, em `@/board/conversa`) sai do
 *   REGISTRO da integração, que só o dono da conexão lê — então só o dono o
 *   vê. Este sai da PRÓPRIA LINHA: desde a F26.2, tarefa, evento da tarefa,
 *   nota do mural e registro do histórico guardam `via_name`, o nome da
 *   conexão no instante da escrita, gravado por gatilho a partir da sessão.
 *   Quem enxerga a linha enxerga a marca, e ela sobrevive à conexão revogada.
 *
 * A MESMA PEÇA DO COMENTÁRIO
 *   `Selo` de tom neutro — o mesmo que a conversa usa para o comentário do
 *   agente. Ele já passa pelas réguas da F17.37 (`--plat-dim` sobre `--ink-2`,
 *   0,72rem, letra do corpo); uma cápsula nova com cor própria seria a segunda
 *   gramática para a mesma informação.
 *
 * DUAS FORMAS DE TEXTO, E QUEM ESCOLHE É O LUGAR
 *   Onde o nome de quem fez já está escrito ao lado (a linha do histórico da
 *   tarefa começa pelo nome), o selo diz só *"via ChatGPT"* — repetir o nome
 *   seria ruído. Onde o autor não aparece em lugar nenhum (a nota do mural, o
 *   registro do histórico do cliente), ele diz *"Carla, via ChatGPT"*. O
 *   `title` diz a frase inteira nos dois casos.
 *
 * LINHA HUMANA NÃO DESENHA NADA
 *   `via` nulo, ausente ou em branco: nem cápsula vazia, nem "via —".
 */

import { Selo } from '@/ui/primitivos';
import { textoDoSeloDeOrigem, tituloDoSeloDeOrigem } from '@/ui/selo-de-origem';

export function SeloDeOrigem({
  via,
  pessoa,
  nomeAoLado,
}: {
  /** `via_name` da linha. Nulo = escrita de gente, e nada é desenhado. */
  via: string | null | undefined;
  /** Quem pediu à IA — o autor da linha. Vai sempre no `title`. */
  pessoa?: string | null;
  /**
   * Verdadeiro quando o nome de `pessoa` já está escrito ao lado do selo: o
   * texto encolhe para *"via ChatGPT"*, e o nome fica só no `title`.
   */
  nomeAoLado?: boolean;
}) {
  const texto = textoDoSeloDeOrigem(via, nomeAoLado ? null : pessoa);
  if (texto === null) return null;
  return (
    <Selo tom="neutro" titulo={tituloDoSeloDeOrigem(via, pessoa) ?? undefined}>
      {texto}
    </Selo>
  );
}
