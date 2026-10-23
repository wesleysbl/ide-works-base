/**
 * O CLIENTE NA TELA — F38, Fase 7.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRÊS TIPOS DE LISTA, UMA REGRA (D2 do plano F38)
 *
 *   · Lista de CLIENTE (`clientId` preenchido): a tarefa herda o cliente da
 *     lista. O formulário MOSTRA o cliente, sem seletor.
 *   · Lista COMPARTILHADA (sem cliente, com a marca "exige cliente"): o
 *     cliente é obrigatório ao criar — sem ele, o formulário diz o que falta
 *     antes de ir ao servidor.
 *   · Lista INTERNA (sem cliente e sem a marca): o cliente é opcional, e
 *     "interna, sem cliente" é uma escolha de verdade.
 *
 *   Quem decide de verdade é o servidor (`server/cliente-da-tarefa.ts`) e o
 *   gatilho `tasks_client_from_list`. Esta tela ANTECIPA a frase para a
 *   pessoa não perder o título digitado; ela não é uma segunda regra.
 *
 * DE ONDE VEIO O CLIENTE DA TAREFA
 *
 *   O cliente da tarefa é o dela; na falta, o da lista (regra única da Fase 6).
 *   O cartão diz de onde ele veio:
 *     · "da lista" — a tarefa não tem cliente próprio, ou tem o MESMO da lista
 *       (o gatilho grava o da lista ao criar; é herança);
 *     · "escolhido na tarefa" — lista sem cliente, cliente escolhido;
 *     · "diferente do da lista" — tarefa movida de lista com o cliente
 *       anterior (caso de borda do plano): o cartão mostra os dois.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A lista, no que a regra do cliente precisa. */
export type ListaDoCliente = {
  clientId?: string | null;
  clientName?: string | null;
  requiresClient?: boolean;
};

export type TipoDaLista = 'cliente' | 'compartilhada' | 'interna';

export function tipoDaLista(lista: ListaDoCliente): TipoDaLista {
  if (lista.clientId) return 'cliente';
  return lista.requiresClient === true ? 'compartilhada' : 'interna';
}

/** A frase que o formulário mostra quando falta o cliente numa lista compartilhada. */
export const FRASE_FALTA_CLIENTE =
  'Esta lista é compartilhada: escolha o cliente da tarefa antes de criar.';

/**
 * O que falta para criar, quanto ao cliente. `null` = nada falta.
 * Só a lista compartilhada exige; nas outras, vazio é válido.
 */
export function faltaCliente(lista: ListaDoCliente, clientId: string | null | undefined): string | null {
  if (tipoDaLista(lista) !== 'compartilhada') return null;
  return clientId ? null : FRASE_FALTA_CLIENTE;
}

export type OrigemDoCliente = 'lista' | 'tarefa' | 'diferente';

export const ROTULO_DA_ORIGEM: Record<OrigemDoCliente, string> = {
  lista: 'da lista',
  tarefa: 'escolhido na tarefa',
  diferente: 'diferente do da lista',
};

/** De onde veio o cliente que o cartão mostra. `null` = a tarefa não tem cliente. */
export function origemDoCliente(t: {
  clientId: string | null;
  ownClientId?: string | null;
  listClientId?: string | null;
}): OrigemDoCliente | null {
  if (!t.clientId) return null;
  const proprio = t.ownClientId ?? null;
  const daLista = t.listClientId ?? null;
  if (proprio === null) return daLista ? 'lista' : 'tarefa';
  if (daLista === null) return 'tarefa';
  return proprio.toLowerCase() === daLista.toLowerCase() ? 'lista' : 'diferente';
}

/**
 * O QUE O CARTÃO DEIXA TROCAR. Espelha as recusas do servidor
 * (`setBoardTaskClientInTx`) para não oferecer gesto que volta recusado.
 *
 * `opcoes`:
 *   · `'lista'`  — só "usar o da lista" (lista de cliente, tarefa com outro);
 *   · `'clientes'` — o catálogo de clientes ativos; `semCliente` diz se
 *     "interna, sem cliente" entra (só em lista interna).
 */
export type TrocaDeCliente =
  | { pode: false; motivo: string }
  | { pode: true; opcoes: 'lista' }
  | { pode: true; opcoes: 'clientes'; semCliente: boolean };

export function trocaDeCliente(t: {
  listId: string | null;
  parentId: string | null;
  subtasks?: readonly unknown[];
  clientId: string | null;
  ownClientId?: string | null;
  listClientId?: string | null;
  listRequiresClient?: boolean;
}): TrocaDeCliente {
  if (t.listId === null) {
    return { pode: false, motivo: 'Tarefa sem lista: é demanda do cliente.' };
  }
  if (t.parentId !== null) {
    return { pode: false, motivo: 'Subtarefa usa o cliente da tarefa-mãe.' };
  }
  if ((t.subtasks?.length ?? 0) > 0) {
    return {
      pode: false,
      motivo: 'Tem subtarefas, que herdam o cliente dela: o cliente não se troca por aqui.',
    };
  }
  const tipo = tipoDaLista({ clientId: t.listClientId, requiresClient: t.listRequiresClient });
  if (tipo === 'cliente') {
    return origemDoCliente(t) === 'diferente'
      ? { pode: true, opcoes: 'lista' }
      : { pode: false, motivo: 'Lista de cliente: a tarefa fica com o cliente da lista.' };
  }
  return { pode: true, opcoes: 'clientes', semCliente: tipo === 'interna' };
}
