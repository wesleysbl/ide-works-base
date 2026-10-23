import { BoardRefused } from '@/server/board';
import { type Sql, withActor } from '@/server/db';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export async function readMentionablePeople(sql: Sql, actor: AuthenticatedActor, task: string | null, list: string | null) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((!task && !list) || (task && !uuid.test(task)) || (list && !uuid.test(list))) {
    throw new BoardRefused('Escolha a lista ou a tarefa antes de mencionar alguém.', 400);
  }
  return withActor(sql, asDbActor(actor), async (tx) => {
    const rows = await tx`select id, name from ideworks.mentionable_people(${task}::uuid, ${list}::uuid)`;
    return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
  });
}
