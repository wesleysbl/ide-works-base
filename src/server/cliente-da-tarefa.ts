/**
 * O CLIENTE DA TAREFA — F38, Fase 6 (D2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA DE LEITURA, UMA SÓ
 *
 *   O cliente de uma tarefa é o da PRÓPRIA tarefa (`tasks.client_id`). Se ela
 *   não tiver, vale o da LISTA (`lists.client_id`). Cartão do quadro, ficha,
 *   Minhas tarefas, busca e tarefas do MCP, e o recorte de cliente da conexão
 *   de IA leem por aqui — antes, uns liam só a tarefa e outros só a lista, e a
 *   mesma tarefa aparecia com cliente numa tela e sem cliente na outra.
 *
 *   `clienteDaTarefaSql` é a regra dentro da consulta (o apelido da tarefa é
 *   SEMPRE `t`); `clienteDaTarefa` é a mesma regra em TypeScript, para o que
 *   já chegou lido (os dublês em memória do MCP). `clienteDaTarefaJuncao` é a
 *   mesma regra como junção (F38, Fase 6.1), para as leituras do MCP que a
 *   usam várias vezes por linha. O teste de banco
 *   (`cliente-da-tarefa-banco.test.ts`, PGlite) roda as duas na mesma massa.
 *
 * A REGRA DE CRIAÇÃO
 *
 *   · Lista de cliente: a tarefa herda o cliente da lista. Informar OUTRO
 *     cliente é recusado — a tarefa iria parar no quadro de um cliente
 *     dizendo que é de outro.
 *   · Lista COMPARTILHADA (sem cliente, `requires_client`): o cliente é
 *     obrigatório. Sem ele, recusa.
 *   · Lista INTERNA (sem cliente e sem a marca): o cliente é opcional.
 *   · O cliente informado precisa existir para quem cria (alcance), ser da
 *     mesma empresa da lista e estar ATIVO — cancelado é recusado com a data.
 *
 *   `decidirClienteDaNovaTarefa` é essa regra, pura. Usam: a escrita do
 *   quadro (`createBoardTaskInTx`, que também serve o MCP) e o dublê em
 *   memória do MCP (`MemoryTaskBoard`). O banco tem a mesma herança e a mesma
 *   recusa da lista compartilhada no gatilho `tasks_client_from_list`
 *   (migration `20261007090000`), como garantia para qualquer outro caminho.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type postgres from 'postgres';

import type { Tx } from '@/server/db';

/** Fragmento montado com o mesmo `tx` da consulta que o recebe. */
type Trecho = postgres.PendingQuery<postgres.Row[]>;

/**
 * A regra dentro da consulta: o id do cliente da tarefa `t`. Lê a lista pela
 * chave, então serve tanto para consulta que já junta `lists` quanto para a
 * que não junta. O apelido `lista_da_tarefa` não se confunde com o `l` de quem
 * chama.
 */
export function clienteDaTarefaSql(tx: Tx): Trecho {
  return tx`coalesce(t.client_id, (select lista_da_tarefa.client_id
                                     from ideworks.lists lista_da_tarefa
                                    where lista_da_tarefa.id = t.list_id))`;
}

/**
 * A MESMA regra, como junção — F38, Fase 6.1. Entra no FROM logo depois de
 * `ideworks.tasks t`, e o id fica em `cliente_da_tarefa.id`
 * (`clienteDaTarefaIdSql`). Uma leitura de `lists` por tarefa, em vez de uma
 * subconsulta a cada vez que a regra aparece (seleção, junção com `clients` e
 * recorte: três por linha nas leituras do MCP).
 *
 * `left join`: lista que a política de linha não devolve dá `null`, como a
 * subconsulta escalar dá. Os apelidos `lista_da_tarefa` e `cliente_da_tarefa`
 * não se confundem com o `l` de quem chama.
 */
export function clienteDaTarefaJuncao(tx: Tx): Trecho {
  return tx`left join ideworks.lists lista_da_tarefa on lista_da_tarefa.id = t.list_id
            cross join lateral (
              select coalesce(t.client_id, lista_da_tarefa.client_id) as id
            ) cliente_da_tarefa`;
}

/** O id do cliente da tarefa, depois de `clienteDaTarefaJuncao`. */
export function clienteDaTarefaIdSql(tx: Tx): Trecho {
  return tx`cliente_da_tarefa.id`;
}

/** A regra em TypeScript: o da tarefa vence; na falta dele, o da lista. */
export function clienteDaTarefa(
  daTarefa: string | null | undefined,
  daLista: string | null | undefined,
): string | null {
  return daTarefa ?? daLista ?? null;
}

/* ───────────────────────────── a criação ───────────────────────────── */

/** A lista onde a tarefa vai nascer, no que a regra precisa. */
export type ListaDaNovaTarefa = {
  clientId: string | null;
  requiresClient: boolean;
  /** Empresa do espaço da lista. */
  companyId: string | null;
};

/**
 * O cliente informado, como quem cria o enxerga. `null` = não existe ou está
 * fora do alcance de quem cria (a política de `clients` não o devolve).
 */
export type ClienteDaNovaTarefa = {
  id: string;
  name: string;
  companyId: string | null;
  isActive: boolean;
  /** Dia do cancelamento (`AAAA-MM-DD`, São Paulo). Só vale com `isActive: false`. */
  cancelledOn: string | null;
} | null;

export type MotivoDaRecusa =
  | 'lista_compartilhada'
  | 'fora_do_alcance'
  | 'cancelado'
  | 'outro_cliente'
  | 'outra_empresa';

export type DecisaoDoCliente =
  | { ok: true; clientId: string | null }
  | { ok: false; motivo: MotivoDaRecusa; mensagem: string };

/** A frase do quadro. O MCP tem a dele (`CLIENT_REQUIRED_ON_SHARED_LIST`). */
export const FRASE_LISTA_COMPARTILHADA =
  'Esta lista é compartilhada: toda tarefa dela precisa de um cliente. Escolha o cliente ao criar, ou crie a tarefa na lista do cliente.';

export const FRASE_CLIENTE_FORA_DO_ALCANCE = 'Cliente não encontrado, ou fora do seu alcance.';

/** `2025-12-30` → `30/12/2025`. */
function diaBr(dia: string): string {
  const [a, m, d] = dia.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function fraseClienteCancelado(nome: string, cancelledOn: string | null): string {
  const quando = cancelledOn ? ` em ${diaBr(cancelledOn)}` : '';
  return `O cliente ${nome} foi cancelado${quando}: não dá para criar tarefa para cliente cancelado. Nada foi criado.`;
}

/**
 * A decisão, pura. `pedido` é o `clientId` que veio no pedido (ausente ou
 * nulo = "não escolhi"); `cliente` é a leitura dele, e só importa quando
 * `pedido` veio.
 */
export function decidirClienteDaNovaTarefa(
  lista: ListaDaNovaTarefa,
  pedido: string | null | undefined,
  cliente: ClienteDaNovaTarefa | undefined,
): DecisaoDoCliente {
  const escolhido = pedido ? pedido.toLowerCase() : null;

  if (escolhido === null) {
    if (lista.clientId !== null) return { ok: true, clientId: lista.clientId };
    if (lista.requiresClient) {
      return { ok: false, motivo: 'lista_compartilhada', mensagem: FRASE_LISTA_COMPARTILHADA };
    }
    return { ok: true, clientId: null };
  }

  if (!cliente || cliente.id.toLowerCase() !== escolhido) {
    return { ok: false, motivo: 'fora_do_alcance', mensagem: FRASE_CLIENTE_FORA_DO_ALCANCE };
  }
  if (!cliente.isActive) {
    return { ok: false, motivo: 'cancelado', mensagem: fraseClienteCancelado(cliente.name, cliente.cancelledOn) };
  }
  if (lista.clientId !== null && lista.clientId.toLowerCase() !== escolhido) {
    return {
      ok: false,
      motivo: 'outro_cliente',
      mensagem:
        'Esta lista é de outro cliente, e a tarefa dela herda esse cliente. ' +
        'Deixe o cliente em branco, ou crie a tarefa na lista do cliente escolhido. Nada foi criado.',
    };
  }
  if (lista.companyId !== null && cliente.companyId !== null && lista.companyId !== cliente.companyId) {
    return {
      ok: false,
      motivo: 'outra_empresa',
      mensagem: 'O cliente escolhido é de outra empresa que a desta lista. Nada foi criado.',
    };
  }
  return { ok: true, clientId: cliente.id };
}
