/**
 * Leitura: que listas do quadro são deste cliente — F17.84.
 *
 * POR QUE NÃO É `select * from lists where client_id = ?`
 *   A política de `lists` pergunta `can_see_space`. Quem alcança o cliente e
 *   não alcança o espaço da lista simplesmente não veria a linha — o vínculo
 *   sumiria. O pedido é o contrário: existência sem o nome. Daí a função
 *   `ideworks.client_board_lists`, `security definer`: ela vê o vínculo, anula
 *   nome/espaço/pasta quando `not can_see_space`, e NÃO alarga alcance. Quem
 *   não via o quadro continua sem vê-lo.
 *
 * A CONTAGEM É A MESMA DA ÁRVORE
 *   Aberto = não arquivada e não concluída. Total = não arquivada. É o que
 *   `readFullTree` já conta. Uma segunda definição de "aberto" faria ficha e
 *   quadro discordarem do mesmo cartão.
 *
 * A RECUSA NÃO DIZ SE O CLIENTE EXISTE
 *   Igual à ficha e ao detalhe: fora do alcance e inexistente são a mesma
 *   frase, o mesmo 404.
 */

import {
  type ClientBoardList,
  assembleClientBoardLists,
} from '@/clients/listas-do-quadro';
import { comoNumero } from '@/server/board';
import { ClientNotVisible } from '@/server/client-detail';
import { type Sql, withActor } from '@/server/db';
import { recorteDasOmitidas } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export async function readClientBoardLists(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
): Promise<ClientBoardList[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const [cliente] = await tx`
      select id from ideworks.clients where id = ${clientId}`;

    if (!cliente) throw new ClientNotVisible();

    const linhas = await tx`
      select id, name, archived, space_id, space_name, folder_id, folder_name,
             live_tasks, total_tasks
        from ideworks.client_board_lists(${clientId})
       -- F31: lista em espaço de empresa omitida não aparece no cliente.
       ${recorteDasOmitidas(
         tx,
         actor,
         (ids) => tx`where space_id not in (select s.id from ideworks.spaces s
                                             where s.category_id = any(${ids}::uuid[]))`,
       )}`;

    return assembleClientBoardLists(
      linhas.map((r) => ({
        id: r.id as string,
        name: (r.name as string | null) ?? null,
        archived: r.archived === true,
        spaceId: r.space_id as string,
        spaceName: (r.space_name as string | null) ?? null,
        folderId: (r.folder_id as string | null) ?? null,
        folderName: (r.folder_name as string | null) ?? null,
        liveTasks: comoNumero(r.live_tasks),
        totalTasks: comoNumero(r.total_tasks),
      })),
    );
  });
}
