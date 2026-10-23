/**
 * PARA ONDE O VOLTAR LEVA — etapa F17.33.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE O USUÁRIO PEDIU
 *
 *   *"Cada tela aberta precisa ter um voltar para anterior, ou as telas
 *   menores devem ter um X para sair delas e voltarem."*
 *
 * ⚠️ F29: O BOTÃO `‹ Voltar` SAIU, E ESTA DECISÃO FICA — SÓ PARA O X
 *   O Wesley achou que `‹ Voltar` confundia: com histórico fazia "anterior",
 *   sem histórico fazia "acima", e o botão não dizia qual. Desde a F29 todas
 *   as telas saem pela trilha do topo, que diz o nome de cada lugar (Fase 4:
 *   as oito do quadro e do trabalho; Fase 5a: o resto). O único que ainda
 *   usa este arquivo é o X da ficha da tarefa — e para ele a regra abaixo
 *   continua certa: FECHAR a ficha volta ao passo anterior ou, sem histórico,
 *   ao quadro da lista dela, nunca para fora do sistema.
 *
 *   A TABELA `lugarAcima` SAIU com o Voltar das molduras. Ela respondia o
 *   lugar acima de cada rota (ficha do cliente → painel, Meta → contas,
 *   ativar → entrada) para um botão que não existe mais: hoje esse lugar é o
 *   primeiro degrau da trilha de cada tela (`trilhaDeDetalhe`, em
 *   `@/board/trilha`) ou o link `‹ Entrada` das telas de acesso. O X sempre
 *   sabe o seu — o quadro da lista da tarefa —, então `acimaDaTela` passou a
 *   ser o único "acima" que existe.
 *
 * O QUE HAVIA, CONTADO ANTES DE ESCREVER
 *
 *   Dezenove telas em `src/pages`. DUAS tinham saída própria — `Cliente`
 *   (`← Voltar ao painel`) e `NaoEncontrado` (`Voltar para a entrada`). Nas
 *   outras dezessete a única saída era o botão do navegador ou a barra
 *   lateral, e a barra lateral não existe em nove delas.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ VOLTAR NÃO É `history.back()` CEGO — E ESTE ARQUIVO EXISTE POR ISSO
 *
 *   Quem abre `/tarefa/<id>` de um link colado no WhatsApp entra no sistema
 *   com o histórico VAZIO. Um `back()` ali não volta para a lista: volta para
 *   a página que a pessoa estava vendo antes de abrir o link — a conversa, o
 *   e-mail, o buscador. O botão prometeria "voltar" e entregaria "sair".
 *
 *   Então há dois modos, e a ordem entre eles é deliberada:
 *
 *     1. `historico` — há passo anterior DENTRO do sistema. É o que o usuário
 *        pediu ao pé da letra ("voltar para anterior"), e é o único que
 *        acerta quando a pessoa chegou por um caminho que ninguém previu.
 *
 *     2. `lugar` — não há. Aí vale o lugar ACIMA desta tela: a ficha da
 *        tarefa volta ao quadro da lista dela. (Até a F29 a ficha do cliente
 *        voltava ao painel e a visão do espaço à árvore; ver o topo.)
 *
 *   E quando não há nem um nem outro, **não há botão**. Botão morto é pior
 *   que botão ausente — é regra do projeto, e aqui ela é literal: um voltar
 *   que recarrega a mesma tela é um botão que mente.
 *
 * ⚠️ COMO SE SABE QUE O PASSO ANTERIOR É NOSSO
 *   O roteador carimba um índice em `history.state` a cada `push` — `0` na
 *   entrada em que o sistema foi aberto, `1` na primeira navegação interna, e
 *   assim por diante. **`idx > 0` é exatamente a pergunta "há uma tela nossa
 *   atrás desta"**, e ela sobrevive ao F5, porque o estado da entrada é do
 *   navegador e não da memória do aplicativo.
 *
 *   Trocar de aba NÃO conta, e isso é de graça: a F17.24 já escreve aba e
 *   visão no endereço com `replace`, que não cria entrada.
 */

/** Como esta tela sai. `null` = ela não tem para onde ir, e não desenha botão. */
export type Volta = { modo: 'historico' } | { modo: 'lugar'; para: string };

/**
 * Há um passo anterior DENTRO do sistema?
 *
 * Recebe `history.state` cru — de propósito. A função fica pura e testável sem
 * navegador, e quem chama é quem sabe onde mora o estado.
 */
export function temHistoricoNoApp(estado: unknown): boolean {
  if (estado === null || typeof estado !== 'object') return false;
  const indice = (estado as { idx?: unknown }).idx;
  return typeof indice === 'number' && Number.isFinite(indice) && indice > 0;
}

/**
 * A decisão inteira, num lugar só.
 *
 * `acimaDaTela` é o que a própria tela sabe — o quadro da lista de uma tarefa.
 * Ele só entra em cena quando não há histórico: com histórico, "anterior" ganha
 * de "acima", porque é o que FECHAR a ficha promete. `null` = a tela não sabe,
 * e aí não há saída a desenhar.
 */
export function comoVoltar(
  caminho: string,
  estadoDoHistorico: unknown,
  acimaDaTela: string | null,
): Volta | null {
  if (temHistoricoNoApp(estadoDoHistorico)) return { modo: 'historico' };

  if (acimaDaTela === null) return null;

  // Um voltar que abre a tela que já está aberta não volta nada.
  const limpo = caminho.replace(/\/+$/, '') || '/';
  if ((acimaDaTela.replace(/\/+$/, '') || '/') === limpo) return null;

  return { modo: 'lugar', para: acimaDaTela };
}
