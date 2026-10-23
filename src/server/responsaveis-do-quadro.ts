/**
 * QUEM O MENU `Filtrar por responsável` OFERECE — etapa F17.70.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ESTA PEÇA APAGA
 *
 *   Até a F17.68, os três quadros montavam a lista a partir de quem APARECIA em
 *   `task_assignees` naquele recorte. Medido em 2026-09-04:
 *
 *     perfis ativos ............ 17     pessoas com alguma tarefa ....  7
 *                                       pessoas com ZERO tarefas ..... 10
 *
 *   O menu escondia exatamente as dez sem tarefa — o dono do sistema incluído.
 *   É o pior recorte possível: some justamente quem se procura para descobrir
 *   que está sem trabalho.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ A LISTA CERTA NÃO É "TODOS OS USUÁRIOS"
 *   Enumerar gente de outra empresa já é vazar, mesmo que só o nome saia. A
 *   lista é **quem QUEM ESTÁ OLHANDO alcança**, e essa regra já existe desde a
 *   F17.53: `ideworks.can_assign_person(uuid)`. Nenhuma regra nova é escrita
 *   aqui nem na migration da F17.70 — ela só empresta aquela, inteira.
 *
 * A LISTA É UMA UNIÃO, E CADA METADE TEM UMA RAZÃO
 *
 *   1. QUEM EU ALCANÇO — `ideworks.assignee_filter_people()`. É a metade que
 *      conserta o defeito: quem eu alcanço e não tem tarefa nenhuma aqui
 *      aparece **com zero**, e esse é o caso útil, não um erro a esconder.
 *
 *   2. QUEM JÁ É RESPONSÁVEL AQUI — a contagem daquele quadro. É a metade que
 *      impede um segundo defeito: uma pessoa fora do meu recorte que já esteja
 *      atribuída a uma tarefa que eu VEJO tem o nome dela no cartão — é
 *      `display_name()`, que de propósito não recorta (F17.53). Tirá-la do menu
 *      deixaria aquela tarefa sem nenhum jeito de ser filtrada, com o nome dela
 *      à vista. Enumerar aqui não revela nada que o cartão já não mostre.
 *
 *      É por esta metade, também, que a conta de sistema `@ideworks.invalid`
 *      volta ao menu do quadro onde ela já tem tarefa — e só dele.
 *
 * ⚠️ O NÚMERO CONTA AS TAREFAS DAQUELE QUADRO, E NÃO AS DO SISTEMA
 *   O `donos` que o chamador passa é o recorte do quadro (a lista, a pasta, ou
 *   tudo o que a pessoa alcança). O número ao lado do nome sai dele, e de mais
 *   nada. Contar no sistema inteiro faria a soma da coluna não fechar com a do
 *   cabeçalho.
 *
 *   Ele também NÃO obedece à busca por texto: a peneira de `Sem responsável` e
 *   a dos nomes descrevem o quadro, não o resultado da busca. Se obedecesse,
 *   digitar `sonh` zeraria o menu inteiro e a pessoa não teria como sair de lá.
 *
 * O NOME NUNCA VEM DE JUNÇÃO COM `profiles`
 *   `profiles_select` mostra só o próprio perfil: a junção devolveria UMA linha,
 *   em silêncio. Os dois lados desta união saem de função `security definer` —
 *   `assignee_filter_people()` de um, `display_name()` do outro.
 *
 * O CUSTO
 *   Uma consulta só, a mesma de antes. O que ela ganhou foi a junção com 17
 *   linhas de gente e uma chamada de `can_assign_person` por linha — dois
 *   `exists` numa tabela de 33 linhas. Medido na F17.70: ver o relatório da
 *   etapa. A lista NÃO depende do texto buscado, então ela não é recontada por
 *   tecla digitada: a barra já espera 350 ms (F17.55) e o menu já vem pronto.
 */

import type { BoardAssigneeOption } from '@/board/board';
import type { Tx } from '@/server/db';

/**
 * Um pedaço de SQL montado pelo chamador com o MESMO `tx`. É o `select distinct
 * a.task_id, a.user_id ...` que define o recorte do quadro.
 */
export type Fragmento = ReturnType<Tx>;

/** O driver devolve `count(*)` como texto quando não se pede `::int`. */
const comoNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export type ResponsaveisDoQuadro = {
  /** O menu, já ordenado por nome. Inclui quem tem zero. */
  opcoes: BoardAssigneeOption[];
  /**
   * Quantas tarefas do recorte têm ALGUÉM. O chamador tira isso do total para
   * chegar em `Sem responsável` — contar as sem dono direto na tabela de
   * tarefas seria uma varredura a mais do quadro inteiro sob política.
   */
  comDono: number;
};

/**
 * A lista de gente do menu, e a contagem de quem tem dono.
 *
 * `donos` tem de trazer duas colunas — `task_id` e `user_id` — já sem repetição,
 * e recortado ao quadro. Ele entra como CTE: o plano é o mesmo de quando a
 * consulta era escrita inteira em cada arquivo.
 */
export async function lerResponsaveisDoQuadro(
  tx: Tx,
  donos: Fragmento,
): Promise<ResponsaveisDoQuadro> {
  const linhas = await tx`
    with donos as (
      ${donos}
    ),
    conta as (
      select d.user_id, count(*)::int as tasks
        from donos d
       group by d.user_id
    ),
    alcance as (
      -- A METADE 1: quem eu alcanço. A regra mora na função — F17.53/F17.70.
      select f.id, f.name from ideworks.assignee_filter_people() f
    )
    select coalesce(a.id, c.user_id) as id,
           -- A METADE 2 precisa do nome de quem está fora do meu recorte, e
           -- display_name() é justamente a função que não recorta.
           coalesce(a.name, ideworks.display_name(c.user_id), '(sem nome)') as name,
           coalesce(c.tasks, 0) as tasks,
           (select count(*)::int from (select distinct d.task_id from donos d) x) as com_dono
      from alcance a
      full join conta c on c.user_id = a.id
     order by 2`;

  return {
    opcoes: linhas.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      tasks: comoNumero(r.tasks),
    })),
    comDono: comoNumero(linhas[0]?.com_dono),
  };
}
