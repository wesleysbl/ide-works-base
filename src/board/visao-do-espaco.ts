/**
 * A VISÃO GERAL DO ESPAÇO — etapa F17.26.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE O USUÁRIO PEDIU
 *
 *   *"só de clicar no espaço, deve ficar visível tudo o que há nele (…) quando
 *   clica em movimento aparece as pastas e documentos referentes a esse espaço,
 *   o progresso em cada lista e demais funções."*
 *
 *   Até aqui, clicar num espaço só sanfonava o galho. Quem queria saber como um
 *   cliente estava abria lista por lista e contava de cabeça.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ NÃO HÁ CONSULTA NOVA, E ISSO NÃO É ATALHO
 *   `readFullTree` (`@/server/tree`) já devolve `liveTasks` e `totalTasks` por
 *   lista, e a esteira RESOLVIDA (`workflowName`, `inheritedFrom`) — tudo sob a
 *   política de linha, que é quem esconde o que a pessoa não alcança. Uma
 *   segunda consulta só para somar seria uma segunda opinião sobre o mesmo
 *   número, e a segunda opinião é a que fica para trás.
 *
 *   ⚠️ **Consequência que a etapa PRECISA ter:** o somatório da pasta é a soma
 *   das listas que CHEGARAM. Uma lista escondida pela parede da F17.23 não vem
 *   na leitura, então ela não entra na conta — e o número da pasta não vaza o
 *   que a parede esconde. Somar pelo banco, com uma consulta de agregação,
 *   faria exatamente o vazamento. `scripts/provar-visao-do-espaco.mjs` prova.
 *
 * ⚠️ `feitas` É DERIVADO, E O CAMPO CRU É O CONTRÁRIO DELE
 *   O banco conta o que está EM ABERTO (`liveTasks`) e o TOTAL (`totalTasks`).
 *   A referência do ClickUp mostra `62/63`, que é feitas/total. Então
 *   `feitas = total − emAberto`, num lugar só — três telas calculando isso
 *   dariam três chances de inverter o sinal.
 *
 * O QUE ESTE ARQUIVO NÃO TEM, E É DE PROPÓSITO
 *   `Cor`, `Início`, `Término` e `Favoritos`. A captura de referência os mostra;
 *   medido em `20260824160000_ideworks_f17_1_arvore.sql`, `lists` tem `name`,
 *   `content`, `sort_order`, `archived_at`, `source_id` e os carimbos — nada
 *   disso existe, e favorito não existe em lugar nenhum do sistema. Coluna que
 *   nunca preenche ensina a equipe a ignorar a tabela inteira.
 */

import type { NoDeEspaco, NoDeLista, NoDePasta } from '@/board/arvore';

/* ───────────────────────────── o progresso ───────────────────────────── */

export type Progresso = {
  /** Concluídas — `total − emAberto`. É o numerador do `62/63`. */
  feitas: number;
  /** Em aberto. O que o banco conta como `liveTasks`. */
  emAberto: number;
  /** Tudo o que não está arquivado. */
  total: number;
  /** 0 a 100, inteiro. Sem tarefa nenhuma, é 0 — e a tela diz `0/0`. */
  pct: number;
  /** Quantas listas entraram na soma. Zero é um estado, não um defeito. */
  listas: number;
};

export const VAZIO: Progresso = { feitas: 0, emAberto: 0, total: 0, pct: 0, listas: 0 };

/**
 * A percentagem, arredondada — e os dois extremos são EXATOS.
 *
 * `Math.round` sozinho diria `100%` para 999 de 1000, e `0%` para 1 de 1000.
 * Os dois mentem no único lugar em que a pessoa olha o número para decidir:
 * "acabou?" e "começou?". Então cheio só é 100 quando é cheio, e vazio só é 0
 * quando é vazio.
 */
export function percentagem(feitas: number, total: number): number {
  if (total <= 0) return 0;
  if (feitas <= 0) return 0;
  if (feitas >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((feitas / total) * 100)));
}

/** O progresso de UMA lista. */
export function progressoDaLista(lista: NoDeLista): Progresso {
  const total = Math.max(0, lista.totalTasks);
  const emAberto = Math.min(Math.max(0, lista.liveTasks), total);
  const feitas = total - emAberto;
  return { feitas, emAberto, total, pct: percentagem(feitas, total), listas: 1 };
}

/** O progresso de um conjunto de listas — o número da pasta, e o do espaço. */
export function somar(listas: readonly NoDeLista[]): Progresso {
  let feitas = 0;
  let emAberto = 0;
  let total = 0;
  for (const l of listas) {
    const p = progressoDaLista(l);
    feitas += p.feitas;
    emAberto += p.emAberto;
    total += p.total;
  }
  return { feitas, emAberto, total, pct: percentagem(feitas, total), listas: listas.length };
}

/* ───────────────────────────── a visão ───────────────────────────── */

export type PastaDaVisao = {
  pasta: NoDePasta;
  /**
   * As listas da pasta, com o vínculo de cliente que a árvore já trouxe.
   *
   * A visão não inventa um segundo recorte: cada lista responde por si, duas
   * do mesmo cliente chegam as duas, e `clientName` nulo some na tela — a
   * mesma regra da linha da árvore (`listaLevaAFicha`).
   */
  listas: NoDeLista[];
  progresso: Progresso;
};

export type VisaoDoEspaco = {
  espaco: NoDeEspaco;
  pastas: PastaDaVisao[];
  /**
   * As listas penduradas direto no espaço, sem pasta.
   *
   * ⚠️ ELAS EXISTEM, e todo desenho que assume "toda lista tem pasta" as perde.
   * Medido em 2026-08-28: das cinco listas do banco, DUAS estão soltas — uma em
   * `Ide · Demandas` e outra em `Ide Hub · Demandas`. Um espaço só com lista
   * solta é o caso comum aqui, e não a exceção.
   *
   * O vínculo de cliente viaja junto, como nas listas de pasta: quem desenha
   * some o atalho quando o nome vem nulo.
   */
  soltas: NoDeLista[];
  /** Pastas + soltas, num número só. */
  progresso: Progresso;
  /** Sem pasta e sem lista à vista. */
  vazio: boolean;
};

/**
 * Monta a visão de um espaço.
 *
 * `mostrarArquivados` é o MESMO interruptor da árvore da barra lateral (mora em
 * `@/ui/lugar`): as duas telas escondem e mostram juntas, porque um arquivado
 * que some de um lado e fica do outro parece defeito das duas vezes.
 */
export function montarVisaoDoEspaco(
  espaco: NoDeEspaco,
  mostrarArquivados: boolean,
): VisaoDoEspaco {
  const visivel = (no: { live: boolean }) => mostrarArquivados || no.live;

  const pastas: PastaDaVisao[] = espaco.folders.filter(visivel).map((pasta) => {
    const listas = pasta.lists.filter(visivel);
    return { pasta, listas, progresso: somar(listas) };
  });

  const soltas = espaco.lists.filter(visivel);

  const todas = [...pastas.flatMap((p) => p.listas), ...soltas];

  return {
    espaco,
    pastas,
    soltas,
    progresso: somar(todas),
    vazio: pastas.length === 0 && soltas.length === 0,
  };
}

/** O espaço, achado por id na árvore inteira. Nulo quando não está ao alcance. */
export function acharEspaco(
  arvore: readonly NoDeEspaco[],
  espacoId: string | undefined,
): NoDeEspaco | null {
  if (!espacoId) return null;
  return arvore.find((e) => e.id === espacoId) ?? null;
}

/**
 * O rótulo do progresso, em português e sem jargão.
 *
 * `0/0` sozinho não diz o que é. `12/20 concluídas` diz — e é o texto que a
 * pessoa copia para mandar a alguém, então ele é uma frase, não uma sigla.
 */
export function rotuloDoProgresso(p: Progresso): string {
  if (p.total === 0) return 'sem tarefas';
  return `${p.feitas}/${p.total} concluídas`;
}
