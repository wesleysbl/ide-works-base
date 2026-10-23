/**
 * As automações de uma lista — etapa F17.41.
 *
 * NÃO EXISTE `update tasks` AQUI, E ISSO É O PONTO.
 *   Este arquivo só GRAVA E LÊ A REGRA. Quem a executa é `ideworks.move_task`,
 *   na mesma escrita em que troca lista e status — o único caminho por onde
 *   essas duas colunas mudam desde a F17.3. Rodar a regra em TypeScript daria
 *   uma segunda versão dela, e a segunda versão é sempre a errada.
 *
 * NEM ALCANCE, NEM AUTORIDADE, NEM CÍRCULO SÃO DECIDIDOS AQUI
 *   `ideworks.set_task_automation` confere as três, e a chave primária de
 *   `ideworks.automation_stages` é o que torna o círculo impossível. Um
 *   `if (podeEscrever)` neste arquivo seria a dívida 8.1 do legado outra vez.
 *
 * O NOME SAI NA HORA DE LER
 *   `display_name()` para pessoa, junção para lista e etapa. Nada de nome
 *   copiado ao lado do id — a decisão de `task_assignees` desde a F4.8. A única
 *   cópia do projeto é `automation_name` no registro, e ela é deliberada: a
 *   regra pode ser apagada, e o livro não se reescreve.
 */

import type { Automacao, AutomacaoEmEdicao } from '@/board/automacoes';
import { type Sql, withActor } from '@/server/db';
import { emPortugues } from '@/server/recusas';
import { BoardRefused } from '@/server/board';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/** A mesma tradução do quadro: o banco recusa com frase, e a frase sobe. */
function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string };
  const frase = emPortugues(e.message);

  if (e.code === '42501') throw new BoardRefused(frase || 'Fora do seu alcance.', 403);
  if (e.code === '22023') throw new BoardRefused(frase || 'Automação recusada.', 400);
  if (e.code === '23514') throw new BoardRefused(frase || 'Automação recusada.', 400);
  // A chave única da chegada: já há regra nesta etapa desta lista.
  if (e.code === '23505') {
    throw new BoardRefused(
      frase ||
        'Esta etapa já tem uma automação. Mude a que existe, em vez de criar uma segunda: duas regras na mesma chegada dariam duas respostas para a mesma pergunta.',
      400,
    );
  }
  // A chave estrangeira composta que fecha o círculo por construção.
  if (e.code === '23503') {
    throw new BoardRefused(
      'Esta automação faria a tarefa voltar para onde já esteve, sem parar. Escolha outra etapa de chegada.',
      400,
    );
  }

  throw erro;
}

function comoAutomacao(r: Record<string, unknown>): Automacao {
  return {
    id: r.id as string,
    name: r.name as string,
    triggerStatusId: r.trigger_status_id as string,
    triggerStatusName: (r.trigger_status_name as string | null) ?? null,
    targetListId: (r.target_list_id as string | null) ?? null,
    targetListName: (r.target_list_name as string | null) ?? null,
    targetStatusId: (r.target_status_id as string | null) ?? null,
    targetStatusName: (r.target_status_name as string | null) ?? null,
    assigneeId: (r.assignee_id as string | null) ?? null,
    assigneeName: (r.assignee_name as string | null) ?? null,
    active: r.is_active === true,
  };
}

/**
 * As regras desta lista.
 *
 * Sem `where can_see_list(...)`: a política de `task_automations` já filtra, e
 * repetir a regra aqui seria a segunda cópia dela.
 */
export async function readListAutomations(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
): Promise<Automacao[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      select a.id, a.name, a.is_active,
             a.trigger_status_id, ts.name as trigger_status_name,
             a.target_list_id,    tl.name as target_list_name,
             a.target_status_id,  us.name as target_status_name,
             a.assignee_id,       ideworks.display_name(a.assignee_id) as assignee_name
        from ideworks.task_automations a
        left join ideworks.statuses ts on ts.id = a.trigger_status_id
        left join ideworks.lists    tl on tl.id = a.target_list_id
        left join ideworks.statuses us on us.id = a.target_status_id
       where a.source_list_id = ${listId}
       order by ts.sort_order, a.name`;
    return linhas.map((r) => comoAutomacao(r as Record<string, unknown>));
  });
}

/** Grava — cria quando `id` é nulo, muda quando vem preenchido. */
export async function writeListAutomation(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
  entrada: AutomacaoEmEdicao,
): Promise<Automacao> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [gravada] = await tx`
        select ideworks.set_task_automation(
          ${entrada.id},
          ${listId},
          ${entrada.triggerStatusId},
          ${entrada.name},
          ${entrada.targetListId},
          ${entrada.targetStatusId},
          ${entrada.assigneeId},
          ${entrada.active},
          ${actor.userId}) as id`;

      const [linha] = await tx`
        select a.id, a.name, a.is_active,
               a.trigger_status_id, ts.name as trigger_status_name,
               a.target_list_id,    tl.name as target_list_name,
               a.target_status_id,  us.name as target_status_name,
               a.assignee_id,       ideworks.display_name(a.assignee_id) as assignee_name
          from ideworks.task_automations a
          left join ideworks.statuses ts on ts.id = a.trigger_status_id
          left join ideworks.lists    tl on tl.id = a.target_list_id
          left join ideworks.statuses us on us.id = a.target_status_id
         where a.id = ${gravada.id as string}`;

      if (!linha) throw new BoardRefused('Automação não encontrada.', 404);
      return comoAutomacao(linha as Record<string, unknown>);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}

/** Apaga a regra. O registro do que ela já fez NÃO some junto. */
export async function deleteListAutomation(
  sql: Sql,
  actor: AuthenticatedActor,
  automationId: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      await tx`select ideworks.delete_task_automation(${automationId})`;
    } catch (erro) {
      traduzir(erro);
    }
  });
}
