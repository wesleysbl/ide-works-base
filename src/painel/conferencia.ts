/**
 * Conferência da junção cliente ↔ listas do quadro — F17.86.
 *
 * POR QUE ISTO EXISTE
 *   Uma junção incompleta é pior que junção nenhuma: o relatório nasce
 *   errando baixo e calado. A conferência aponta quem ainda não está ligado.
 *
 *   Se um cliente não tem lista nenhuma, ela o aponta — e isso é trabalho
 *   pendente, não erro. A frase abaixo é a que a tela escreve, de propósito:
 *   sem ela, o bloco vira uma acusação diária.
 *
 * UMA FUNÇÃO, NÃO DUAS CONTAS
 *   Os dois lados saem daqui. Recalcular "clientes sem lista" na tela, a
 *   partir da carteira, e "listas sem cliente" a partir da árvore, daria
 *   duas opiniões sobre a mesma junção — e a primeira aba aberta há dez
 *   minutos ficaria para trás.
 *
 * ALCANCE
 *   Quem chama já recortou: só clientes que a pessoa alcança, só listas
 *   que a pessoa alcança. Esta função não alarga nada.
 */

export type ClienteParaConferir = {
  id: string;
  name: string;
  isActive: boolean;
};

export type ListaParaConferir = {
  id: string;
  name: string;
  spaceName: string;
  clientId: string | null;
  archived: boolean;
  spaceArchived: boolean;
  /** Tarefas não arquivadas — o mesmo total que a árvore já conta. */
  taskCount: number;
};

export type ClienteDaConferencia = { id: string; name: string };

export type ListaDaConferencia = {
  id: string;
  name: string;
  spaceName: string;
};

export type Conferencia = {
  clientesSemLista: ClienteDaConferencia[];
  listasSemCliente: ListaDaConferencia[];
};

export const CONFERENCIA_VAZIA: Conferencia = {
  clientesSemLista: [],
  listasSemCliente: [],
};

/**
 * A frase da tela. Trabalho pendente, não acusação.
 *
 * Mora aqui para o teste provar o tom, e para a tela não reescrever a
 * decisão do plano numa copy "mais útil" que vire recriminação.
 */
export const FRASE_DA_CONFERENCIA =
  'Se um cliente ainda não tem lista, a conferência aponta — é trabalho pendente, não erro.';

/**
 * Lista de trabalho — a ausência que a conferência cobra no lado do quadro.
 *
 * Não arquivada, em espaço não arquivado, com ao menos uma tarefa.
 *
 * Lista recém-criada e vazia ainda não é ausência: acabou de nascer, e
 * cobrá-la encheria a conferência de ruído permanente. Tarefa arquivada
 * não conta — o total é o mesmo da árvore (`archived_at is null`).
 */
export function ehListaDeTrabalho(lista: {
  archived: boolean;
  spaceArchived: boolean;
  taskCount: number;
}): boolean {
  if (lista.archived) return false;
  if (lista.spaceArchived) return false;
  return lista.taskCount > 0;
}

function porNome<T extends { id: string; name: string }>(a: T, b: T): number {
  const nomes = a.name.localeCompare(b.name, 'pt-BR');
  if (nomes !== 0) return nomes;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Os dois lados da junção incompleta, a partir do mesmo retrato.
 *
 * Cliente inativo não entra: ele não tem trabalho corrente, e cobrá-lo
 * encheria a conferência de ruído permanente.
 *
 * No lado do cliente, qualquer lista ligada conta — inclusive arquivada
 * ou vazia. O vínculo existe. No lado do quadro, só lista de trabalho
 * sem cliente: vazia e arquivada ficam de fora.
 */
export function conferirVinculos(
  clientes: readonly ClienteParaConferir[],
  listas: readonly ListaParaConferir[],
): Conferencia {
  const comLista = new Set<string>();
  for (const lista of listas) {
    if (lista.clientId !== null) comLista.add(lista.clientId);
  }

  const clientesSemLista = clientes
    .filter((c) => c.isActive && !comLista.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }))
    .sort(porNome);

  const listasSemCliente = listas
    .filter((l) => l.clientId === null && ehListaDeTrabalho(l))
    .map((l) => ({ id: l.id, name: l.name, spaceName: l.spaceName }))
    .sort(porNome);

  return { clientesSemLista, listasSemCliente };
}
