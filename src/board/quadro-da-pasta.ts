/**
 * O QUADRO DA PASTA — todos os clientes juntos. Etapa F17.64.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO, TEXTUAL
 *
 *   *"quando aperta em `TIME HELENA` não aparece a tela geral (todos os
 *   clientes juntos, sabe?)"*
 *
 *   No ClickUp dele, clicar na PASTA abre um quadro com as tarefas de TODAS as
 *   listas dela numa grade só: `Valentini`, `Clinimax`, `DXI`, `ZETA`, `Nova` e
 *   `Agência Ide` no mesmo `A FAZER ARTE`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ NÃO É A VISÃO DO ESPAÇO COM OUTRO FILTRO
 *   A F17.26 LISTA o que há dentro do espaço — pasta a pasta, lista a lista,
 *   com o progresso de cada uma. Esta tela JUNTA AS TAREFAS e as põe em
 *   colunas. Uma responde "como está cada cliente"; a outra, "o que há para
 *   fazer em arte hoje, de todo mundo".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ A DECISÃO DESTA ETAPA: A COLUNA É O **NOME DA ETAPA**, E NÃO O STATUS
 *
 *   O plano avisou que as listas de uma pasta podem ter esteiras diferentes, e
 *   a medição de 2026-09-03 (como `ideworks_app`, pelo pooler) confirmou o
 *   pior caso e o desmontou ao mesmo tempo:
 *
 *     · `TIME HELENA` tem **25 listas vivas** e **24 esteiras distintas** —
 *       quase uma por cliente —, que somam **345 linhas de etapa**.
 *     · E, no entanto, **15 NOMES DE ETAPA distintos no total**, com 13 deles
 *       presentes nas 25 listas. As esteiras são CÓPIAS uma da outra.
 *
 *   | nome da etapa               | listas | ordem (min..máx) |
 *   |-----------------------------|--------|------------------|
 *   | no radar                    |     10 | 0..0             |
 *   | a fazer                     |     25 | 0..1             |
 *   | a fazer video               |     25 | 1..2             |
 *   | a fazer arte                |     25 | 2..3             |
 *   | a fazer foto                |     10 | 3..3             |
 *   | atribuir demanda            |     25 | 3..4             |
 *   | …                           |        |                  |
 *   | demanda concluída           |     25 | 12..13           |
 *
 *   Agrupar por `status_id` daria **345 colunas** — uma por linha de etapa — e
 *   a tela seria ilegível. Agrupar por NOME dá **15**, que é exatamente o que
 *   o ClickUp mostra na captura.
 *
 *   ⚠️ Os números acima saem de `scripts/provar-quadro-da-pasta.mjs`, que os
 *   RECALCULA a cada corrida em vez de os repetir. Se um dia as esteiras
 *   deixarem de ser cópias, é ali que isso aparece — e a razão desta decisão
 *   cai junto.
 *
 *   ⚠️ **E é por isso que a chave é o nome NORMALIZADO** (`lower(btrim(…))`):
 *   `A FAZER ARTE` de um cliente e `A Fazer Arte` de outro são a mesma etapa
 *   para quem trabalha, e duas colunas para quem compara texto cru.
 *
 * ⚠️ ETAPA QUE SÓ ALGUMAS LISTAS TÊM
 *   A coluna APARECE, com as tarefas de quem a tem. `no radar` existe em 10 das
 *   25 e some das outras 15 — e some de verdade: `statusByList` não tem entrada
 *   para elas, e o arrasto de uma tarefa dessas 15 para lá é RECUSADO com a
 *   frase que diz por quê. Esconder a coluna esconderia o trabalho de dez
 *   clientes; fingir que ela vale para todos criaria um destino que o banco
 *   recusaria depois, com o cartão já fora do lugar.
 *
 * ⚠️ A ORDEM DAS COLUNAS — 25 esteiras podem ordenar diferente
 *   A ordem é a **média de `sort_order`** do mesmo nome nas listas em que ele
 *   existe, e o desempate é o nome. Não é chute: medido, a média separa as 15
 *   etapas de `TIME HELENA` numa sequência estritamente crescente
 *   (0,00 · 0,40 · 1,40 · 2,40 · 3,00 · 3,80 · 4,80 · … · 12,80) que reproduz a
 *   ordem do ClickUp — inclusive pondo `no radar` ANTES de `a fazer` e
 *   `a fazer foto` DEPOIS de `a fazer arte`, que é o que as duas variantes da
 *   esteira dizem.
 *
 *   As alternativas foram medidas e caem: pelo MENOR `sort_order` as 15 etapas
 *   colapsam em 13 valores — `no radar` e `a fazer` empatam em 0, e o mesmo
 *   acontece com `a fazer arte` e `a fazer foto`; pela ordem da PRIMEIRA
 *   lista, a pasta inteira passa a depender de qual cliente vem primeiro no
 *   alfabeto. A média usa as 25 opiniões e não deixa nenhuma decidir sozinha.
 *
 *   ⚠️ **A média é estável, e não idêntica.** Entrar uma lista nova com a etapa
 *   em outra posição desloca a média daquele nome — e é isso que se quer: a
 *   ordem é o consenso das listas de HOJE. O desempate por nome garante que
 *   duas médias iguais nunca dão ordem sorteada.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ ARRASTAR AQUI MUDA A ETAPA **DENTRO DA LISTA DE ORIGEM**
 *   Não move de lista, e isso não é limitação: o cartão do `Valentini` que sai
 *   de `a fazer arte` para `aprovação` continua sendo do `Valentini`. Quem move
 *   de lista é o `···` do cartão (F17.63), que continua ali.
 *
 *   A escrita é a MESMA: `ideworks.move_task(tarefa, listaDela, statusDela)`.
 *   Não há segundo caminho de escrita nesta etapa (regra 9) — o que esta tela
 *   faz a mais é RESOLVER qual é o status daquela etapa NAQUELA lista, e isso é
 *   leitura, não escrita.
 */

import type {
  BoardAssigneeOption,
  BoardSummary,
  BoardTag,
  BoardTask,
  StatusType,
} from '@/board/board';
import type { FiltroDeTarefas } from '@/board/filtro';

/* ───────────────────────────── a chave da coluna ───────────────────────── */

/**
 * O nome da etapa, normalizado. É a identidade da coluna.
 *
 * ⚠️ QUEM CALCULA DE VERDADE É O BANCO (`lower(btrim(status_name))`), na mesma
 * varredura que agrupa. Esta função existe para a suíte poder montar um quadro
 * de pasta sem servidor, e para o teste da regra ser lido em português. Se as
 * duas divergirem, a tela mostra duas colunas com o mesmo nome — e é isso que
 * `provar-quadro-da-pasta.mjs` compara.
 */
export const chaveDaEtapa = (nome: string): string => nome.trim().toLowerCase();

/* ───────────────────────────── as peças ───────────────────────────── */

/**
 * Uma COLUNA da pasta: um nome de etapa, e onde ele existe.
 *
 * `statusByList` é o que faz o arrasto funcionar sem inventar regra: a chave é
 * a lista, o valor é o status DAQUELA lista com este nome. Lista ausente do
 * mapa é lista que não tem esta etapa.
 */
export type EtapaDaPasta = {
  /** `lower(btrim(name))`. Ver `chaveDaEtapa`. */
  key: string;
  /** O nome como a maioria das listas o escreve — é o que a coluna mostra. */
  name: string;
  /**
   * O tipo mais comum entre as listas que têm esta etapa.
   *
   * ⚠️ ELE PODE DIVERGIR ENTRE LISTAS, e diverge: medido, `a fazer` é `open` em
   * algumas e `unstarted` em outras. O tipo aqui serve para a CONTA de
   * concluídas (`closed`), e essa não diverge — `demanda concluída` é `closed`
   * nas 25.
   */
  type: StatusType;
  /** A cor que veio do ClickUp. Dado, e entra como variável (D10). */
  color: string | null;
  /** Em quantas listas da pasta esta etapa existe. `10 de 25` é informação. */
  lists: number;
  /** A média de `sort_order`. É ela que ordena — ver o cabeçalho. */
  ordem: number;
  /** `listId → statusId`. O destino do arrasto, resolvido pelo banco. */
  statusByList: Record<string, string>;
};

/** A tarefa no quadro da pasta: a de sempre, mais de que lista ela é. */
export type TarefaDaPasta = BoardTask & {
  listId: string;
  listName: string;
  /**
   * Em que coluna ela cai. Nula quando o status dela não está na esteira
   * resolvida da lista — não deveria acontecer (o gatilho recusa), e quando
   * acontece a tela DIZ, em vez de sumir com a tarefa.
   */
  columnKey: string | null;
};

export type FolderBoardHeader = {
  folderId: string;
  folderName: string;
  folderArchivedAt: string | null;
  spaceId: string;
  spaceName: string;
  categoryName: string | null;
  /** Quantas listas vivas entraram no quadro. */
  lists: number;
};

/** Uma lista da pasta, para o rodapé de contagem e para a legenda do cartão. */
export type ListaDaPasta = { id: string; name: string; tasks: number };

export type FolderBoard = {
  header: FolderBoardHeader;
  etapas: EtapaDaPasta[];
  lists: ListaDaPasta[];
  tasks: TarefaDaPasta[];
  /** Quantas há em cada coluna de verdade, por `key` — a janela da F17.50. */
  columnTotals: Record<string, number>;
  /** Quantas passaram pelo filtro, por `key` — F17.55. */
  columnMatched: Record<string, number>;
  perColumn: number;
  assigneeOptions: BoardAssigneeOption[];
  unassignedTasks: number;
  availableTags: BoardTag[];
  filter: FiltroDeTarefas;
};

export type ColunaDaPasta = {
  etapa: EtapaDaPasta;
  tasks: TarefaDaPasta[];
  total: number;
  matched: number;
};

/* ───────────────────────────── a ordem ───────────────────────────── */

/**
 * A ordem das colunas: média de `sort_order`, desempate pelo nome.
 *
 * ⚠️ `[...]` ANTES DE `sort`: `Array.prototype.sort` ordena NO LUGAR, e o
 * servidor passa aqui o array que acabou de montar da consulta. Ordenar o
 * original faria a função ter efeito colateral sobre quem a chamou.
 */
export function ordenarEtapas<T extends { key: string; ordem: number }>(
  etapas: readonly T[],
): T[] {
  return [...etapas].sort((a, b) => a.ordem - b.ordem || a.key.localeCompare(b.key, 'pt-BR'));
}

/* ───────────────────────────── as colunas ───────────────────────────── */

/**
 * Uma coluna por nome de etapa, na ordem do consenso.
 *
 * A COLUNA VAZIA FICA, pela mesma razão da F17.9a: esconder a coluna sem cartão
 * mudaria o desenho da esteira conforme o dia, e é justamente a coluna vazia
 * que conta a verdade sobre o que a equipe já terminou.
 *
 * `Math.max` contra o que chegou — a mesma guarda de `toColumns`: o arrasto
 * acrescenta cartão aqui sem falar com o servidor, e a conta velha não pode
 * dizer menos do que se vê.
 */
export function colunasDaPasta(
  etapas: readonly EtapaDaPasta[],
  tasks: readonly TarefaDaPasta[],
  totais?: Record<string, number>,
  achadas?: Record<string, number>,
): ColunaDaPasta[] {
  const porChave = new Map<string, TarefaDaPasta[]>();
  for (const e of etapas) porChave.set(e.key, []);
  for (const t of tasks) {
    if (t.columnKey !== null) porChave.get(t.columnKey)?.push(t);
  }

  return ordenarEtapas(etapas).map((etapa) => {
    const cartoes = porChave.get(etapa.key) ?? [];
    const total = totais?.[etapa.key];
    const achado = achadas?.[etapa.key];
    return {
      etapa,
      tasks: cartoes,
      total: total === undefined ? cartoes.length : Math.max(total, cartoes.length),
      matched:
        achado === undefined
          ? total === undefined
            ? cartoes.length
            : Math.max(total, cartoes.length)
          : Math.max(achado, cartoes.length),
    };
  });
}

/**
 * As tarefas que não couberam em coluna nenhuma.
 *
 * Não deveria haver: `task_status_guard` recusa status fora da esteira. Se
 * houver, a tela DIZ — sumir com elas é o pior defeito possível num quadro.
 */
export function orfasDaPasta(
  etapas: readonly EtapaDaPasta[],
  tasks: readonly TarefaDaPasta[],
): TarefaDaPasta[] {
  const conhecidas = new Set(etapas.map((e) => e.key));
  return tasks.filter((t) => t.columnKey === null || !conhecidas.has(t.columnKey));
}

/* ───────────────────────────── o destino do arrasto ─────────────────────── */

/**
 * O status desta etapa NA lista da tarefa. Nulo quando a lista não tem a etapa.
 *
 * ⚠️ ESTA FUNÇÃO NÃO ESCREVE NADA, e é só por isso que ela pode existir. O que
 * ela devolve vai inteiro para `ideworks.move_task`, que é quem confere o
 * alcance, resolve a esteira e escreve (regra 9).
 */
export const statusParaMover = (etapa: EtapaDaPasta, listId: string): string | null =>
  etapa.statusByList[listId] ?? null;

/**
 * O destino do ✓ de concluir no quadro da PASTA.
 *
 * É a coluna `closed` (`demanda concluída`) que a lista DESTA tarefa tem — a
 * coluna é um nome, e o que o banco entende é o `status_id` da lista dela, então
 * só serve uma etapa fechada cujo mapa já traz esta lista (`statusParaMover`).
 * `null` quando a lista não tem etapa que feche, ou quando a tarefa já está
 * numa. Havendo mais de uma etapa `closed`, vale a última na ordem da esteira.
 */
export function etapaQueFechaNaPasta(
  etapas: readonly EtapaDaPasta[],
  tarefa: Pick<TarefaDaPasta, 'listId' | 'columnKey'>,
): EtapaDaPasta | null {
  const fechadas = etapas.filter((e) => e.type === 'closed' && statusParaMover(e, tarefa.listId) !== null);
  if (fechadas.length === 0) return null;
  if (fechadas.some((e) => e.key === tarefa.columnKey)) return null;
  return fechadas[fechadas.length - 1] ?? null;
}

/**
 * A frase da recusa quando a lista não tem a etapa.
 *
 * Ela nomeia a lista E a etapa, porque quem arrastou está olhando uma coluna
 * com cartões de outros clientes dentro — "não deu" não diria por que o de um
 * cliente entra e o do outro não.
 */
export const recusaDeEtapaAusente = (lista: string, etapa: string): string =>
  `A lista ${lista} não tem a etapa "${etapa}" — a esteira dela é outra. ` +
  `Use o ··· do cartão para mover a tarefa de lista.`;

/* ───────────────────────────── o resumo ───────────────────────────── */

/**
 * O resumo da PASTA INTEIRA, e não da janela — mesma regra da F17.50.
 *
 * O total sai de `columnTotals`, que o banco contou olhando todas as linhas;
 * `concluídas` é a soma das colunas de tipo `closed`, que é a mesma definição
 * que o gatilho usa para carimbar `completed_at`. As órfãs continuam contadas
 * pelos cartões, porque elas não estão em mapa nenhum.
 */
export function resumoDaPasta(
  quadro: {
    etapas: readonly EtapaDaPasta[];
    tasks: readonly TarefaDaPasta[];
    columnTotals: Record<string, number>;
    columnMatched?: Record<string, number>;
  },
  quais: 'todas' | 'achadas' = 'todas',
): BoardSummary {
  const mapa =
    quais === 'achadas' ? (quadro.columnMatched ?? quadro.columnTotals) : quadro.columnTotals;

  let total = 0;
  let done = 0;
  for (const e of quadro.etapas) {
    const n = Math.max(
      mapa[e.key] ?? 0,
      quadro.tasks.filter((t) => t.columnKey === e.key).length,
    );
    total += n;
    if (e.type === 'closed') done += n;
  }

  const orfas = orfasDaPasta(quadro.etapas, quadro.tasks);
  total += orfas.length;
  done += orfas.filter((t) => t.completedAt !== null).length;

  return { total, open: total - done, done };
}

/**
 * Quantas listas da pasta têm esta etapa, dito em português.
 *
 * Só aparece quando a etapa NÃO está em todas: `10 de 25 listas` explica por que
 * a coluna tem menos cliente do que a vizinha, e escrever `25 de 25` em toda
 * coluna seria ruído em treze delas.
 */
export function rotuloDeAbrangencia(etapa: EtapaDaPasta, listasDaPasta: number): string | null {
  if (listasDaPasta <= 1) return null;
  if (etapa.lists >= listasDaPasta) return null;
  return `${etapa.lists} de ${listasDaPasta} listas`;
}
