/**
 * QUEM O MENU DE RESPONSÁVEL DA CAPA DO CARTÃO PODE OFERECER — etapa F17.69.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ ESTA NÃO É UMA TERCEIRA LISTA DE GENTE
 *
 *   O projeto já tem duas, e elas respondem perguntas diferentes:
 *
 *     `team_directory()` .......... "a quem EU posso atribuir" (F17.53)
 *     `assignee_filter_people()` .. a mesma, sem as contas de sistema (F17.70)
 *
 *   Duas listas que discordam já seria ruim; três seria pior. Por isso a função
 *   desta etapa — `ideworks.assignable_people_for_task(task)` — não escreve
 *   regra nenhuma: ela toma a lista da F17.70 e a ESTREITA por tarefa, com a
 *   segunda pergunta que faltava.
 *
 * ⚠️ SÃO DUAS PERGUNTAS, E ELAS NÃO SÃO A MESMA
 *
 *   1. `can_assign_person(pessoa)` — "EU, o ator, posso oferecer esta pessoa?"
 *   2. `can_reach_task_for(pessoa, lista, cliente)` — "esta pessoa alcança a
 *      empresa DESTA tarefa?"
 *
 *   A primeira olha o ator; a segunda olha o alvo contra a tarefa. Guardar só
 *   com a (1) deixa passar exatamente o caso que a etapa fecha: duas pessoas da
 *   minha empresa podem não alcançar a mesma lista.
 *
 * O `assigned` VEM DA MESMA LEITURA
 *   O cartão já sabe quem são os responsáveis — são as iniciais na capa —, mas
 *   o que o menu marca sai do BANCO, e não do que o quadro trouxe: entre o
 *   carregamento do quadro e o clique no cartão alguém pode ter mexido pela
 *   ficha, e um menu que marca uma coisa enquanto a capa mostra outra faz a
 *   pessoa desmarcar quem já não estava lá.
 *
 * O CUSTO — E POR QUE ELE NÃO ENTRA NO QUADRO
 *   ⚠️ O quadro da pasta está em 379 ms (F17.74), e uma das razões é que
 *   `task_assignees_select` chama `can_reach_task_id` UMA VEZ POR LINHA (F17.3).
 *   Somar esta lista ao carregamento do quadro multiplicaria isso por cartão.
 *
 *   Então ela NÃO é carregada com o quadro: é lida quando alguém ABRE o menu de
 *   um cartão, uma vez, para aquela tarefa. E como a função do banco é
 *   `security definer`, a leitura de `task_assignees` lá dentro é um acesso por
 *   índice sobre um `task_id` — não passa pela política que cobra por linha.
 *
 *   Custo somado ao quadro: zero.
 */

import type { BoardAssignee } from '@/board/board';
import { type Sql, withActor } from '@/server/db';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/** Uma linha do menu: a pessoa, e se ela JÁ é responsável por esta tarefa. */
export type PessoaAtribuivel = BoardAssignee & { assigned: boolean };

/**
 * A lista para UMA tarefa.
 *
 * ⚠️ VAZIA NÃO É ERRO, É RECUSA. A função do banco devolve zero linhas quando
 * quem pergunta não tem `execute` naquela tarefa — enumerar gente a partir do
 * id de uma tarefa fora do alcance seria um vazamento com outro nome. A tela
 * diz "não há ninguém para oferecer aqui" e não inventa um 403 diferente do que
 * a escrita daria.
 */
export async function lerPessoasAtribuiveis(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
): Promise<PessoaAtribuivel[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      select id, name, assigned
        from ideworks.assignable_people_for_task(${taskId})`;
    return linhas.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      assigned: r.assigned === true,
    }));
  });
}
