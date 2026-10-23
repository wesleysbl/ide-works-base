/** Estado que a pessoa viu antes de confirmar uma mudança de lista. */
export type OrigemDoMovimento = { listId: string | null; statusId: string | null };

/** O servidor devolve esta escolha antes de escrever qualquer movimento. */
export type EscolhaDeEtapa = {
  taskId: string;
  taskTitle: string;
  listId: string;
  listName: string;
  origem: OrigemDoMovimento;
  etapaAtual: { name: string; color: string | null };
  etapas: { id: string; name: string; color: string | null }[];
};
