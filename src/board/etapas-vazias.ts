/**
 * ETAPAS VAZIAS E NAVEGAÇÃO POR ETAPAS — F06C do plano UX (revisão de 28/09, R04).
 *
 * O QUE SE OBSERVOU
 *   Uma lista com dez tarefas, três abertas: as duas primeiras etapas vazias
 *   ocupavam ~572 px, e as tarefas abertas ficavam à direita, atrás da rolagem.
 *
 * O QUE ESTE ARQUIVO DECIDE (puro, testado sem navegador)
 *   · Quais colunas RECOLHEM: as de etapa vazia DE VERDADE (`total` 0 e nenhum
 *     cartão à vista), com a preferência ligada, salvo as que a pessoa abriu
 *     à mão. Vazia pelo FILTRO não recolhe: ela tem tarefas, e a F06B já diz
 *     "nenhuma das N bate com o filtro" — encolher esconderia essa diferença.
 *   · Quadro sem tarefa nenhuma não recolhe nada: sete faixas estreitas numa
 *     lista nova seriam um quadro que parece quebrado, e é justamente ali que
 *     se cria a primeira tarefa.
 *   · Onde a faixa para ao ir a uma etapa pela navegação.
 *
 * NADA MUDA NOS DADOS: a etapa recolhida continua na ordem do fluxo, com nome,
 * contagem e soltura de cartão; as setas do teclado andam pela esteira inteira.
 */

export type ColunaParaRecolher = {
  chave: string;
  /** O total da etapa no banco (`Column.total`). */
  total: number;
  /** Cartões à vista agora — sobe antes do total quando se solta um cartão. */
  aVista: number;
};

/** Etapa vazia de verdade: nem no banco nem na tela. */
export const etapaVazia = (c: ColunaParaRecolher): boolean => c.total === 0 && c.aVista === 0;

/**
 * As chaves das colunas que desenham recolhidas.
 *
 * `abertas` são as que a pessoa abriu à mão (clicar na faixa ou no atalho da
 * etapa) — ficam abertas na aba, também depois de ir à ficha e voltar (ver
 * `lerAbertas`), até recolhê-las individualmente ou desligar e religar a preferência.
 */
export function colunasRecolhidas(
  colunas: readonly ColunaParaRecolher[],
  recolher: boolean,
  abertas: ReadonlySet<string>,
): Set<string> {
  const fora = new Set<string>();
  if (!recolher) return fora;
  if (!colunas.some((c) => !etapaVazia(c))) return fora;
  for (const c of colunas) if (etapaVazia(c) && !abertas.has(c.chave)) fora.add(c.chave);
  return fora;
}

/** Quantas etapas estão vazias de verdade — o número do interruptor. */
export const quantasVazias = (colunas: readonly ColunaParaRecolher[]): number =>
  colunas.filter(etapaVazia).length;

/**
 * O interruptor aparece quando ele muda alguma coisa: há etapa vazia E há
 * tarefa em alguma outra (senão nada recolheria).
 */
export const interruptorUtil = (colunas: readonly ColunaParaRecolher[]): boolean =>
  colunas.some(etapaVazia) && colunas.some((c) => !etapaVazia(c));

/**
 * A NAVEGAÇÃO POR ETAPAS aparece quando a faixa não cabe — a medida vem da
 * tela — e há pelo menos três etapas (com duas, a rolagem já é o atalho).
 */
export const ETAPAS_PARA_NAVEGAR = 3;
export const mostrarNavegacao = (etapas: number, transborda: boolean): boolean =>
  transborda && etapas >= ETAPAS_PARA_NAVEGAR;

/**
 * O `scrollLeft` que encosta a coluna na borda esquerda da faixa.
 *
 * As medidas são de `getBoundingClientRect`: a distância na tela entre a
 * coluna e a faixa, somada ao que a faixa já rolou. Nunca negativo, nunca
 * além do que a faixa pode rolar.
 */
export function deslocamentoAte(
  faixa: { left: number; scrollLeft: number; scrollWidth: number; clientWidth: number },
  colunaLeft: number,
): number {
  const alvo = faixa.scrollLeft + (colunaLeft - faixa.left);
  const maximo = Math.max(0, faixa.scrollWidth - faixa.clientWidth);
  return Math.round(Math.min(maximo, Math.max(0, alvo)));
}

/** A contagem escrita — igual à do cabeçalho da coluna: `3` ou `1 de 3`. */
export const contagemDaEtapa = (achadas: number, total: number): string =>
  achadas === total ? String(total) : `${achadas} de ${total}`;

/** `1 tarefa`, `0 tarefas`, `1 de 3 tarefas`. */
export function tarefasDaEtapa(achadas: number, total: number): string {
  if (achadas === total) return `${total} ${total === 1 ? 'tarefa' : 'tarefas'}`;
  return `${achadas} de ${total} tarefas`;
}

/** O nome acessível da faixa recolhida: diz o que é e o que o clique faz. */
export const rotuloDaRecolhida = (nome: string): string => `Abrir a etapa ${nome}, vazia, 0 tarefas`;

/**
 * O `scrollLeft` que deixa a coluna INTEIRA à vista mexendo o mínimo — usado
 * quando a pessoa abre uma faixa recolhida: ela já está olhando para lá, e
 * encostar a coluna na borda esquerda seria um pulo sem motivo.
 */
export function deslocamentoParaVer(
  faixa: { left: number; right: number; scrollLeft: number; scrollWidth: number; clientWidth: number },
  coluna: { left: number; right: number },
): number {
  const maximo = Math.max(0, faixa.scrollWidth - faixa.clientWidth);
  let alvo = faixa.scrollLeft;
  if (coluna.right > faixa.right) alvo += coluna.right - faixa.right;
  // A borda esquerda ganha: coluna mais larga que a faixa começa pelo começo.
  if (coluna.left - (alvo - faixa.scrollLeft) < faixa.left) alvo = faixa.scrollLeft + (coluna.left - faixa.left);
  return Math.round(Math.min(maximo, Math.max(0, alvo)));
}

/* ─────────────── as etapas abertas à mão voltam com a tela ─────────────── */

/**
 * AS ABERTAS À MÃO SOBREVIVEM À IDA À FICHA — verificação da F06C.
 *
 * Abrir uma etapa vazia, rolar e abrir um cartão desmonta o quadro; ao voltar
 * (X, Voltar ou F5) a F32 devolve o `scrollLeft` da faixa — mas, se a coluna
 * aberta à mão tivesse encolhido de novo, o mesmo `scrollLeft` mostraria outro
 * conteúdo (~236 px deslocado). Por isso as abertas ficam guardadas com as
 * MESMAS travas da rolagem: `sessionStorage` (mesma aba) e a mesma chave de
 * tela (`chaveDaTela`: caminho + busca ordenada). São lidas no primeiro
 * desenho, antes de a restauração da faixa começar.
 */
export const PREFIXO_ABERTAS = 'ideworks:etapas-abertas:';

/** Teto de chaves guardadas por tela — uma pasta larga tem ~30 etapas. */
export const TETO_ABERTAS = 60;

type ArmazemDeAbertas = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** O que está guardado para a tela. Tolerante: o pior caso é "nenhuma". */
export function lerAbertas(armazem: ArmazemDeAbertas | null, tela: string): Set<string> {
  const saida = new Set<string>();
  if (armazem === null) return saida;
  let cru: unknown;
  try {
    const texto = armazem.getItem(PREFIXO_ABERTAS + tela);
    if (texto === null) return saida;
    cru = JSON.parse(texto);
  } catch {
    return saida;
  }
  if (!Array.isArray(cru)) return saida;
  for (const c of cru) {
    if (saida.size >= TETO_ABERTAS) break;
    if (typeof c === 'string' && c !== '' && c.length <= 200) saida.add(c);
  }
  return saida;
}

/** Grava as abertas da tela; nenhuma = apaga a chave. Nunca estoura. */
export function gravarAbertas(armazem: ArmazemDeAbertas | null, tela: string, abertas: ReadonlySet<string>): void {
  if (armazem === null) return;
  const lista = [...abertas].filter((c) => c !== '' && c.length <= 200).slice(0, TETO_ABERTAS);
  try {
    if (lista.length === 0) armazem.removeItem(PREFIXO_ABERTAS + tela);
    else armazem.setItem(PREFIXO_ABERTAS + tela, JSON.stringify(lista));
  } catch {
    // Navegação privada ou disco cheio: as abertas valem só nesta visita.
  }
}
