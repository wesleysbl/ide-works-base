/**
 * O BANCO DA FAXINA — F38, Fase 8. Leitura (`lerTarefas`, `lerClientes`) e a
 * escrita de UMA árvore (`gravarClienteNaArvore`). Quem decide é `planejar.ts`.
 */

import type { Tx } from '@/server/db';

import type { ArvoreAGravar, TarefaLida } from './planejar';
import type { ClienteRef } from './sugestao';

type Linha = Record<string, unknown>;

/** Todas as tarefas (arquivadas inclusive: o `task_parent_guard` conta todas as filhas). */
export async function lerTarefas(tx: Tx): Promise<TarefaLida[]> {
  const linhas = (await tx`
    select t.id::text            as id,
           t.parent_id::text     as parent_id,
           t.client_id::text     as client_id,
           t.list_id::text       as list_id,
           t.title               as title,
           (t.archived_at is not null) as archived,
           t.created_at          as created_at,
           t.completed_at        as completed_at,
           s.name                as status,
           l.name                as list_name,
           f.name                as folder_name,
           l.client_id::text     as list_client_id,
           coalesce(l.requires_client, false) as list_requires_client
      from ideworks.tasks t
      left join ideworks.lists l    on l.id = t.list_id
      left join ideworks.folders f  on f.id = l.folder_id
      left join ideworks.statuses s on s.id = t.status_id
  `) as unknown as Linha[];
  const data = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null);
  return linhas.map((r) => ({
    id: r.id as string,
    parentId: (r.parent_id as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    listId: (r.list_id as string | null) ?? null,
    title: r.title as string,
    archived: r.archived === true,
    createdAt: data(r.created_at),
    completedAt: data(r.completed_at),
    status: (r.status as string | null) ?? null,
    listName: (r.list_name as string | null) ?? null,
    folderName: (r.folder_name as string | null) ?? null,
    listClientId: (r.list_client_id as string | null) ?? null,
    listRequiresClient: r.list_requires_client === true,
  }));
}

/** Clientes ativos E cancelados: a história dos cancelados também precisa de dono. */
export async function lerClientes(tx: Tx): Promise<ClienteRef[]> {
  const linhas = (await tx`
    select id::text as id, name, is_active, inactive_at from ideworks.clients order by name
  `) as unknown as Linha[];
  return linhas.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    isActive: r.is_active === true,
    inactiveAt: r.inactive_at instanceof Date ? r.inactive_at.toISOString() : null,
  }));
}

/** O histórico do cliente só existe depois da migration `20261007110000`. */
export async function temHistoricoDoCliente(tx: Tx): Promise<boolean> {
  const [r] = (await tx`
    select count(*)::int as n from information_schema.columns
     where table_schema = 'ideworks' and table_name = 'task_events' and column_name = 'from_client_id'
  `) as unknown as { n: number }[];
  return (r?.n ?? 0) > 0;
}

export const MENSAGEM_SEM_HISTORICO =
  'A coluna task_events.from_client_id não existe: a migration 20261007110000_ideworks_f38_historico_do_cliente.sql ainda não foi aplicada. ' +
  'Gravar o cliente sem registrar no histórico deixaria a mudança sem rastro, então o modo --gravar se recusa a rodar. ' +
  'Aplique a migration (supabase db query --linked -f ...) e rode de novo. O modo --ver continua funcionando.';

/**
 * Grava o cliente numa árvore inteira, dentro da transação de quem chama.
 *
 * O `task_parent_guard` recusa trocar o cliente de uma mãe que tem filhas (conta
 * as arquivadas também) e recusa filha cujo cliente difere do da mãe — então
 * nenhuma ordem de UPDATE serve. A saída: desligar do pai as tarefas que têm
 * mãe a gravar, gravar o cliente, e religar. O cliente não muda na religação,
 * então a filha entra já igual à mãe. Tudo na mesma transação.
 *
 * Registra no histórico UMA linha por tarefa que ganhou cliente.
 */
export async function gravarClienteNaArvore(
  tx: Tx,
  arvore: ArvoreAGravar,
  cliente: { id: string; name: string },
): Promise<number> {
  const aGravarIds = new Set(arvore.aGravar.map((t) => t.id));
  const aDesligar = arvore.todas.filter((t) => t.parentId !== null && aGravarIds.has(t.parentId));
  const ids = [...aGravarIds];

  for (const t of aDesligar) {
    await tx`update ideworks.tasks set parent_id = null where id = ${t.id}::uuid`;
  }
  await tx`update ideworks.tasks set client_id = ${cliente.id}::uuid where id = any(${ids}::uuid[]) and client_id is null`;
  for (const t of aDesligar) {
    await tx`update ideworks.tasks set parent_id = ${t.parentId}::uuid where id = ${t.id}::uuid`;
  }
  for (const t of arvore.aGravar) {
    await tx`
      insert into ideworks.task_events (task_id, automation_name, from_client_id, to_client_id,
                                        from_client_name, to_client_name, actor_id)
      values (${t.id}::uuid, null, null, ${cliente.id}::uuid, null, ${cliente.name}, ideworks.acting_user_id())`;
  }
  return ids.length;
}
