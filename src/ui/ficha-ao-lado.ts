/**
 * A FICHA AO LADO — F43, Fase 7: as regras puras do card que abre num painel à
 * direita do Quadro, sem tirar a pessoa de onde ela estava.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COMO O ENDEREÇO FICA COLÁVEL COM O QUADRO ATRÁS
 *
 *   O React Router 7.18 tem `mask` estável (`Link` e `navigate`): o ROTEADOR vai
 *   para um lugar e a BARRA DE ENDEREÇO mostra outro. Abrir o card ao lado é
 *   navegar para O MESMO lugar em que já se está (`/quadro/:lista`, com a busca
 *   e o modo de sempre), com `fichaAoLado: <id>` no estado da entrada, e
 *   mascarar o endereço como `/tarefa/:id`. Assim:
 *     · o Quadro continua montado — o caminho do roteador não mudou —, com a
 *       rolagem, os lotes carregados e as colunas abertas;
 *     · quem copia o endereço copia `/tarefa/:id`, que é a rota própria da
 *       tarefa (`rotas.tsx`: "o endereço de uma tarefa precisa poder ser colado
 *       num comentário"). Colar, abrir em aba nova e o link de um aviso caem na
 *       página cheia, como sempre;
 *     · o `href` do link continua `/tarefa/:id` — Ctrl/⌘/Shift/botão do meio
 *       são do navegador, e abrem a página cheia numa aba nova;
 *     · o F5 lê de volta a máscara que o roteador guarda em `history.state`, e
 *       reabre o mesmo Quadro com a mesma ficha ao lado (medido no e2e
 *       `card-ao-lado`).
 *
 *   Voltar do navegador, `Esc`, o ✕ e o clique fora FECHAM: a entrada do
 *   painel foi empurrada por cima da do Quadro, e fechar é voltar uma.
 *
 * QUEM ABRE AO LADO
 *   Só as cinco telas de trabalho que o plano nomeia — Quadro (Kanban e Lista),
 *   Pasta, Espaço, Minhas tarefas e Todas as tarefas. Em qualquer outro lugar
 *   (a própria ficha, os avisos, o Controle) o link da tarefa é o de sempre e
 *   abre a página cheia: é lá que a âncora `#comentario-` e os degraus da
 *   trilha fazem sentido, e a decisão de cada tela fica com ela.
 *
 * POR QUE ESTE ARQUIVO MORA EM `ui`
 *   A guarda de saída (`@/ui/saida`) precisa saber se a ficha ao lado mudou —
 *   fechar o painel com texto por salvar é SAIR, mesmo com o caminho igual.
 *   As duas regras são da moldura, e não de uma tela.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A chave no estado da entrada de navegação (`history.state.usr`). */
export const CHAVE_DA_FICHA_AO_LADO = 'fichaAoLado';

/** O endereço colável de uma tarefa — a máscara do painel e o da página cheia. */
export const enderecoDaTarefa = (id: string): string => `/tarefa/${id}`;

/**
 * A tarefa aberta ao lado nesta entrada, ou `null`.
 *
 * Tolerante: o estado vem do navegador, sobrevive ao F5 e pode ter sido
 * escrito por outra versão da tela. Qualquer forma que não seja um texto não
 * vazio vira `null` — e `null` é "sem painel", que é o padrão.
 */
export function fichaAoLadoDe(estado: unknown): string | null {
  if (estado === null || typeof estado !== 'object') return null;
  const id = (estado as Record<string, unknown>)[CHAVE_DA_FICHA_AO_LADO];
  return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * O estado da entrada com a ficha ao lado — SEM perder o que a tela guardava.
 *
 * ⚠️ `Minhas tarefas` guarda na entrada quantos lotes estavam na tela
 * (`progresso`, F17.AUD06). A entrada do painel é empurrada por cima da do
 * Quadro com o MESMO estado mais a ficha: assim o efeito que regrava o
 * progresso não vê diferença nenhuma e não reescreve a entrada (o que fecharia
 * o painel com um `replace` sem a máscara).
 */
export function comFichaAoLado(estado: unknown, id: string): Record<string, unknown> {
  const base =
    estado !== null && typeof estado === 'object' && !Array.isArray(estado)
      ? (estado as Record<string, unknown>)
      : {};
  return { ...base, [CHAVE_DA_FICHA_AO_LADO]: id };
}

/** O par de `comFichaAoLado`: o mesmo estado, sem a ficha. `null` se não sobrar nada. */
export function semFichaAoLado(estado: unknown): Record<string, unknown> | null {
  if (estado === null || typeof estado !== 'object' || Array.isArray(estado)) return null;
  const resto = Object.fromEntries(
    Object.entries(estado as Record<string, unknown>).filter(([k]) => k !== CHAVE_DA_FICHA_AO_LADO),
  );
  return Object.keys(resto).length === 0 ? null : resto;
}

/**
 * As telas em que o card abre ao lado. Pelo CAMINHO do roteador, que é o da
 * tela de trás: `/quadro` (a lista que a pessoa abriu por último), `/quadro/:id`,
 * `/quadro/pasta/:id`, `/quadro/espaco/:id`, `/meu-trabalho` e `/tarefas`.
 */
export function telaQueAbreAoLado(pathname: string): boolean {
  return /^\/(?:quadro(?:\/[^/]+(?:\/[^/]+)?)?|meu-trabalho|tarefas)\/?$/.test(pathname);
}

/**
 * O clique que abre ao lado: o botão principal, sem tecla de modificação.
 *
 * É a mesma pergunta que o `Link` do roteador faz antes de interceptar
 * (`shouldProcessLinkClick`): com Ctrl, ⌘, Shift ou Alt, ou com o botão do
 * meio, o clique é do NAVEGADOR — aba nova, janela nova, baixar —, e ele vai
 * para o `href`, que é `/tarefa/:id`, a página cheia. Escrita aqui para a
 * suíte provar a regra sem navegador.
 */
export function cliqueAbreAoLado(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented?: boolean;
}): boolean {
  if (e.defaultPrevented === true) return false;
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * A ficha ao lado acabou de FECHAR (ou de dar lugar a outra)? É a pergunta que
 * a tela de trás faz a cada entrada para saber se relê o que mostra.
 *
 * ⚠️ POR QUE RELER. A tela de trás guarda o próprio estado (o quadro lido, os
 * lotes de Minhas tarefas) e NÃO desmontou — antes, abrir a tarefa trocava de
 * página e voltar remontava o Quadro, que relia tudo do banco. Agora o que se
 * mudou no painel (etapa, prazo, título, responsáveis) ficaria velho no cartão
 * de trás até a próxima visita. Fechar o painel relê em silêncio, sem esvaziar
 * a tela nem mexer na rolagem.
 */
export function fichaAoLadoFechou(antes: string | null, agora: string | null): boolean {
  return antes !== null && antes !== agora;
}
