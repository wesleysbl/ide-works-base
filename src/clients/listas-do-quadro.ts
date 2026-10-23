/**
 * Listas do quadro ligadas a um cliente — F17.84.
 *
 * UM CAMINHO SÓ PARA A MESMA PERGUNTA
 *   Ficha, relatório e IA perguntam "quais listas são deste cliente". A
 *   montagem mora aqui para os três receberem a mesma forma, na mesma ordem.
 *   Uma segunda função que ordenasse "do jeito da tela" faria a IA e o
 *   relatório divergirem na primeira chamada.
 *
 * NOME NULO NÃO É BURACO, É A REGRA
 *   Quem alcança o cliente e não alcança o espaço da lista lê o vínculo sem o
 *   nome. Inventar o nome — ou o do espaço, ou o da pasta — revelaria trabalho
 *   de um time que a pessoa não alcança. O identificador continua: é ele que
 *   prova que o vínculo existe.
 *
 * A ORDEM É POR ESPAÇO E DEPOIS POR NOME
 *   Duas chamadas seguidas devolvem a mesma sequência. Sem isto, relatório e
 *   IA receberiam a mesma pergunta em ordens diferentes a cada ida. Lista
 *   arquivada não salta para o fim: arquivar não é reordenar.
 */

export type ClientBoardListRow = {
  id: string;
  name: string | null;
  archived: boolean;
  spaceId: string;
  spaceName: string | null;
  folderId: string | null;
  folderName: string | null;
  liveTasks: number;
  totalTasks: number;
};

export type ClientBoardList = {
  id: string;
  name: string | null;
  archived: boolean;
  space: { id: string; name: string | null };
  folder: { id: string; name: string | null } | null;
  liveTasks: number;
  totalTasks: number;
};

/** Nomes nulos vão para o fim do grupo — não há o que alfabetizar. */
function compararTexto(a: string | null, b: string | null): number {
  const esq = (a ?? '').toLowerCase();
  const dir = (b ?? '').toLowerCase();
  if (esq === dir) return 0;
  if (esq === '') return 1;
  if (dir === '') return -1;
  return esq < dir ? -1 : 1;
}

function compararLinhas(a: ClientBoardListRow, b: ClientBoardListRow): number {
  const espaco = compararTexto(a.spaceName, b.spaceName);
  if (espaco !== 0) return espaco;
  if (a.spaceId !== b.spaceId) return a.spaceId < b.spaceId ? -1 : 1;
  const nome = compararTexto(a.name, b.name);
  if (nome !== 0) return nome;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function paraLista(linha: ClientBoardListRow): ClientBoardList {
  return {
    id: linha.id,
    name: linha.name,
    archived: linha.archived,
    space: { id: linha.spaceId, name: linha.spaceName },
    folder:
      linha.folderId === null ? null : { id: linha.folderId, name: linha.folderName },
    liveTasks: linha.liveTasks,
    totalTasks: linha.totalTasks,
  };
}

/**
 * Monta a resposta da leitura: forma aninhada, ordem estável.
 *
 * Não inventa nome. Linha com `name` nulo sai com `name` nulo — a existência
 * do vínculo é o identificador, não um rótulo adivinhado.
 */
export function assembleClientBoardLists(
  linhas: readonly ClientBoardListRow[],
): ClientBoardList[] {
  return [...linhas].sort(compararLinhas).map(paraLista);
}

/* ─────────────────────────── seletor da ficha (F17.85) ─────────────────────────── */

/**
 * A tela diz isto com todas as letras: o gesto de soltar mora ao lado de
 * campos onde remover uma linha apaga a coisa. Aqui o gesto é o contrário.
 */
export const FRASE_AO_DESLIGAR_LISTA =
  'Desligar solta o vínculo, não apaga a lista. A lista continua no quadro, com as tarefas dela.';

/** Uma lista que a pessoa alcança — o seletor não oferece as outras. */
export type ListaAlcancavelDoQuadro = {
  id: string;
  name: string;
  spaceName: string;
  folderName: string | null;
  archived: boolean;
  clientId: string | null;
  clientName: string | null;
};

/** O recorte mínimo da árvore completa que o seletor precisa. */
export type LinhaDeArvoreParaSeletor = {
  listId: string | null;
  listName: string | null;
  spaceName: string | null;
  folderName: string | null;
  listArchivedAt: string | null;
  clientId: string | null;
  clientName: string | null;
};

/**
 * Listas que a árvore já recortou por alcance. Linha sem lista (espaço ou
 * pasta vazios) some. O seletor não inventa lista de espaço que a pessoa
 * não vê — a árvore completa simplesmente não as traz.
 */
export function listasAlcancaveisDaArvore(
  linhas: readonly LinhaDeArvoreParaSeletor[],
): ListaAlcancavelDoQuadro[] {
  const visto = new Set<string>();
  const saida: ListaAlcancavelDoQuadro[] = [];
  for (const r of linhas) {
    if (r.listId === null || visto.has(r.listId)) continue;
    visto.add(r.listId);
    saida.push({
      id: r.listId,
      name: r.listName ?? '(sem nome)',
      spaceName: r.spaceName ?? '(sem nome)',
      folderName: r.folderName,
      archived: r.listArchivedAt !== null,
      clientId: r.clientId,
      clientName: r.clientName,
    });
  }
  return saida;
}

/** Nome · espaço · pasta — nomes iguais em espaços diferentes são o caso comum. */
export function rotuloDaListaDoQuadro(l: {
  name: string;
  spaceName: string;
  folderName: string | null;
  archived?: boolean;
}): string {
  const caminho = l.folderName
    ? `${l.name} · ${l.spaceName} · ${l.folderName}`
    : `${l.name} · ${l.spaceName}`;
  return l.archived ? `${caminho} (arquivada)` : caminho;
}

/**
 * Rótulo de uma lista já ligada, inclusive a que a pessoa não alcança no
 * quadro: existência sem o nome, a mesma regra da leitura.
 */
export function rotuloDeListaLigada(l: ClientBoardList): string {
  if (l.name === null) return 'Lista fora do seu alcance no quadro';
  return rotuloDaListaDoQuadro({
    name: l.name,
    spaceName: l.space.name ?? '(sem nome)',
    folderName: l.folder?.name ?? null,
    archived: l.archived,
  });
}

/**
 * Aviso ANTES de salvar: uma lista tem um cliente só; ligar aqui tira de lá.
 * Sem aviso quando a lista já é deste cliente, ou quando não tem cliente.
 */
export function avisoDeTransferenciaDaLista(
  lista: { clientId: string | null; clientName: string | null },
  clienteAtualId: string | null,
): string | null {
  if (lista.clientId === null) return null;
  if (clienteAtualId !== null && lista.clientId === clienteAtualId) return null;
  const nome = (lista.clientName ?? '').trim();
  if (nome !== '') {
    return `Esta lista já é de ${nome}. Ligar aqui tira ela de lá.`;
  }
  return 'Esta lista já é de outro cliente. Ligar aqui tira ela de lá.';
}
