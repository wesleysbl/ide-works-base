/**
 * A ficha da tarefa — leitura e escrita. Etapa F17.10.
 *
 * O QUE MUDA EM RELAÇÃO À F17.9a
 *   A F17.9a só LIA. Esta é a primeira camada do Pilar B que escreve pela tela,
 *   e por isso ela tem uma regra própria, curta:
 *
 *     NENHUMA DECISÃO DE DOMÍNIO ACONTECE NESTE ARQUIVO.
 *
 *   Trocar responsáveis é `ideworks.set_task_assignees`. Trocar etiquetas é
 *   `set_task_tags`. Trocar observadores é `set_task_watchers`. Trocar de coluna
 *   é `move_task`. Concluir é `complete_task` / `uncomplete_task`. Arquivar é
 *   `set_task_archived`. O que sobra aqui é `update tasks set title, ...` — os
 *   campos que não têm regra atrás deles.
 *
 *   E mesmo esse `update` não escolhe status nem conclusão: quem faz isso é o
 *   gatilho `tasks_status_guard`, que roda em cima da escrita.
 *
 * A DESCRIÇÃO VEM JUNTO AQUI, E SÓ AQUI
 *   O quadro (`server/board.ts`) traz um booleano de "tem descrição" e nunca a
 *   descrição. A ficha é uma tarefa só, e a descrição É o produto — o briefing
 *   completo. São dois caminhos de propósito.
 *
 * O NOME DA PESSOA SAI DE `display_name()`
 *   Nunca de junção com `profiles`: aquela política mostra só o próprio perfil,
 *   e a junção devolveria VAZIO em silêncio. Mesma armadilha documentada em
 *   `server/tasks.ts` e em `server/board.ts`.
 *
 * A DATA SAI COMO TEXTO
 *   `due_on::text`, e não a conversão do driver. Uma das 18 tarefas reais tem
 *   prazo no ano 82025, e `Date.toISOString()` escreve ano expandido
 *   (`+082025-08-07`) que todo `.slice(0, 10)` cortaria errado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SALVAR SEMPRE DEVOLVE A FICHA RELIDA, E ISSO NÃO É ZELO
 *
 *   `set_task_assignees` e `set_task_watchers` IGNORAM em silêncio quem não tem
 *   perfil no IDE Works. `set_task_tags` ignora etiqueta que sumiu. O gatilho do
 *   status carimba ou limpa a conclusão por conta própria.
 *
 *   Ou seja: o que fica gravado pode não ser o que foi pedido — e nenhuma dessas
 *   funções avisa. A única forma honesta de a tela mostrar a verdade é perguntar
 *   de novo depois de escrever, dentro da MESMA transação. É o que
 *   `patchBoardTask` faz.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { BoardStatus, BoardTag, Priority, StatusType } from '@/board/board';
// A entrega — F17.6. Ver o cabeçalho de `board/conversa.ts`.
import type { Anexo, Comentario, Link } from '@/board/conversa';
import type { NewTask, TaskDetail, TaskPatch, TaskPerson, TaskType } from '@/board/ficha';
// O histórico da tarefa — F17.41 (a automação) e F17.65 (a mão).
import type { EventoDaTarefa } from '@/board/historico';
// Os passos da tarefa — F17.15.
import type { Checklist, ChecklistItem, Subtask, TaskProgress } from '@/board/passos';
import { BoardRefused, TypeRequired, tipoObrigatorioDoBanco } from '@/server/board';
import { AGENCY_TIMEZONE } from '@/server/calendar';
import {
  type ClienteDaNovaTarefa,
  type DecisaoDoCliente,
  type ListaDaNovaTarefa,
  clienteDaTarefaSql,
  decidirClienteDaNovaTarefa,
} from '@/server/cliente-da-tarefa';
import { type Sql, type Tx, arrayOuNulo, inlineUuid, withActor } from '@/server/db';
import { recorteDasOmitidas } from '@/server/omitidas';
import { emPortugues } from '@/server/recusas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';
import {
  FRASE_TIPO_INVALIDO,
  comoTipoLido,
  ehTipoDaTarefa,
  listaEhDeProducao,
} from '@/server/tipo-da-tarefa';

/**
 * A frase que a tela mostra quando o banco recusa.
 *
 * OS CÓDIGOS SÃO OS DAS DEZ TRAVAS DA F17, e a mensagem delas nomeia o que está
 * no caminho e o que fazer. Trocar por "algo deu errado" jogaria fora justamente
 * o trabalho que cada gatilho fez ao escrever aquela frase.
 */
function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  const frase = emPortugues(e.message);

  // F40: o gatilho do tipo (`IW040`) vira `type_required`, com as opções.
  const tipo = tipoObrigatorioDoBanco(erro);
  if (tipo) throw tipo;

  if (e.constraint_name === 'tasks_title_not_blank') {
    throw new BoardRefused('A tarefa precisa de um título.', 400);
  }
  if (e.constraint_name === 'task_tags_name_is_a_name') {
    throw new BoardRefused(
      'A etiqueta precisa de um nome com letra ou número — nome em branco ou só pontuação é recusado.',
      400,
    );
  }
  // Índice único do nome da etiqueta dentro do espaço.
  if (e.code === '23505') {
    throw new BoardRefused('Já existe uma etiqueta com esse nome neste espaço.', 400);
  }
  if (e.code === '42501') throw new BoardRefused(frase || 'Fora do seu alcance.', 403);
  if (e.code === '22023') throw new BoardRefused(frase || 'Escrita recusada.', 400);
  if (e.code === '23514') throw new BoardRefused(frase || 'Escrita recusada.', 400);
  if (e.code === '22007' || e.code === '22008') throw new BoardRefused('Data inválida.', 400);

  throw erro;
}

/**
 * O tipo da demanda (F40) como o servidor o aceita: `undefined` e `null` são
 * "sem tipo"; um dos quatro vale; qualquer outra coisa é recusada em português
 * antes de o banco responder com erro de enum.
 */
function conferirTipo(valor: unknown): TipoDaTarefaConferido {
  if (valor === undefined || valor === null) return null;
  if (!ehTipoDaTarefa(valor)) throw new BoardRefused(FRASE_TIPO_INVALIDO, 400);
  return valor;
}
type TipoDaTarefaConferido = ReturnType<typeof comoTipoLido>;

/**
 * Título em branco é recusado ANTES de abrir a transação, pelo invólucro da
 * tela, e de novo no miolo, para o caminho do agente que chama o miolo direto.
 * Ausente (`undefined`) é "não mexer no título" — só o `patch` usa isso.
 */
function exigirTitulo(titulo: string | undefined): void {
  if (titulo !== undefined && titulo.trim() === '') {
    throw new BoardRefused('A tarefa precisa de um título.', 400);
  }
}

const comoInstante = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

const comoNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

type LinhaDeEtiqueta = {
  id: string;
  name: string;
  bg_color: string | null;
  fg_color: string | null;
};

const comoEtiqueta = (g: LinhaDeEtiqueta): BoardTag => ({
  id: g.id,
  name: g.name,
  bgColor: g.bg_color ?? null,
  fgColor: g.fg_color ?? null,
});

/* ───────────────────────────── a leitura ───────────────────────────── */

/**
 * O HISTÓRICO DA TAREFA, F17.41 + F17.65 (+ cliente, F38 fase 7). Exportada
 * para a prova contra um Postgres de verdade (`cliente-da-tarefa-banco.test.ts`).
 */
export async function lerHistoricoDaTarefa(tx: Tx, taskId: string): Promise<EventoDaTarefa[]> {
  // OS NOMES SAEM AQUI, e não do registro. `task_events` guarda ids; lista,
  // etapa e pessoa são resolvidas na leitura, pela mesma razão de
  // `task_assignees`: cópia não se atualiza quando alguém renomeia.
  //
  // ⚠️ E O `coalesce` COM A COLUNA `*_name` É O PARAQUEDAS DA F17.65. As quatro
  // chaves são `on delete set null`: apagar uma etapa da esteira não apaga o
  // evento, mas apaga o id dentro dele — e o histórico decairia para "alterou o
  // status de — para —". O nome VIVO ganha (renomear corrige o histórico
  // inteiro); o retrato só aparece quando a junção não devolve nada.
  //
  // `automation_name` NULO quer dizer que a mudança foi feita À MÃO, e quem fez
  // está em `actor_id`. Ver a nota 2 da migration da F17.65.
  //
  // ⚠️ `added` CONCATENA AS DUAS COLUNAS, e elas são disjuntas por construção:
  // a automação escreve `added_user_id` (a regra só sabe pôr uma pessoa, e a
  // caixa de entrada da F17.46 lê exatamente essa coluna), a mão escreve
  // `added_user_ids`. Concatenar não pode duplicar ninguém.
  //
  // `display_name` para pessoa, nunca junção com `profiles`: aquela política
  // mostra só o próprio perfil, e a junção devolveria vazio em silêncio.
  //
  // A ORDEM É CRESCENTE — a linha do tempo mora dentro da conversa, cujo campo
  // de escrever fica no pé. `id` desempata as duas linhas que `move_task` grava
  // na mesma transação (a da mão e a da regra), que têm o mesmo `occurred_at`.
  const registro = await tx`
    select e.id::text as id, e.automation_name, e.occurred_at, e.via_name,
           ideworks.display_name(e.actor_id)                as actor,
           coalesce(la.name, e.from_list_name)              as from_list,
           coalesce(lb.name, e.to_list_name)                as to_list,
           coalesce(sa.name, e.from_status_name)            as from_status,
           coalesce(sb.name, e.to_status_name)              as to_status,
           coalesce(ca.name, e.from_client_name)            as from_client,
           coalesce(cb.name, e.to_client_name)              as to_client,
           coalesce(
             (select json_agg(coalesce(ideworks.display_name(u), '(sem nome)'))
                from unnest(e.removed_user_ids) as u),
             '[]'::json) as removed,
           coalesce(
             (select json_agg(coalesce(ideworks.display_name(u), '(sem nome)'))
                from unnest(
                       array_remove(array[e.added_user_id], null) || e.added_user_ids
                     ) as u),
             '[]'::json) as added
      from ideworks.task_events e
      left join ideworks.lists    la on la.id = e.from_list_id
      left join ideworks.lists    lb on lb.id = e.to_list_id
      left join ideworks.statuses sa on sa.id = e.from_status_id
      left join ideworks.statuses sb on sb.id = e.to_status_id
      left join ideworks.clients  ca on ca.id = e.from_client_id
      left join ideworks.clients  cb on cb.id = e.to_client_id
     where e.task_id = ${inlineUuid(tx, taskId)}
     order by e.occurred_at, e.id`;

  return registro.map(
    (r) =>
      ({
        id: r.id as string,
        // Nulo = foi à mão, e quem fez está em `actor`.
        automationName: (r.automation_name as string | null) ?? null,
        actorName: (r.actor as string | null) ?? null,
        fromListName: (r.from_list as string | null) ?? null,
        toListName: (r.to_list as string | null) ?? null,
        fromStatusName: (r.from_status as string | null) ?? null,
        toStatusName: (r.to_status as string | null) ?? null,
        fromClientName: (r.from_client as string | null) ?? null,
        toClientName: (r.to_client as string | null) ?? null,
        removed: (r.removed as string[] | null) ?? [],
        added: (r.added as string[] | null) ?? [],
        occurredAt: comoInstante(r.occurred_at) as string,
        // A conexão de IA da sessão que gerou o evento (F26.2). Nula = gente.
        viaName: (r.via_name as string | null) ?? null,
      }) satisfies EventoDaTarefa,
  );
}

/**
 * A ficha inteira, dentro de uma transação já aberta.
 *
 * Separada de `readTaskDetail` porque `patchBoardTask` precisa relê-la DEPOIS de
 * escrever e ANTES de a transação fechar — se ela abrisse a própria transação, a
 * releitura enxergaria o mundo de antes da escrita.
 */
export async function lerFicha(tx: Tx, taskId: string): Promise<TaskDetail> {
  // O QUE ESTA FUNÇÃO FAZ, EM IDAS AO BANCO — perf do servidor, 08/10/2026
  //
  //   Eram TREZE consultas uma atrás da outra, cada uma com o id como
  //   parâmetro. Com `prepare: false` o driver faz duas idas por consulta com
  //   parâmetro (descobrir o tipo, depois executar) e não deixa a seguinte
  //   sair antes de a anterior voltar: ~26 idas só de consulta, na tela mais
  //   aberta do sistema. Agora o id vai no texto (`inlineUuid`) e as consultas
  //   independentes saem juntas:
  //
  //     rajada 1 — tudo o que só precisa do id da tarefa (nove consultas)
  //     rajada 2 — o que precisa da lista e do espaço que a rajada 1 trouxe
  //
  //   O TEXTO de cada consulta é o de sempre; o que mudou é o parâmetro virar
  //   literal (só UUID canônico; o resto segue como parâmetro) e a ordem de
  //   ENVIO. A de execução no Postgres é a mesma ordem, uma depois da outra,
  //   sob o mesmo ator e a mesma política de linha. `ficha-idas.test.ts` conta
  //   as idas no fio e confere que o retorno não mudou.
  const tarefa = inlineUuid(tx, taskId);

  const consultaDaFicha = tx`
    select t.id, t.title, t.description,
           t.parent_id, pai.title as parent_title,
           t.list_id, t.status_id, t.priority,
           t.due_on::text   as due_on,
           t.start_on::text as start_on,
           t.custom_item_id,
           -- F38, Fase 6: o cliente da tarefa, e na falta dele o da lista.
           ${clienteDaTarefaSql(tx)} as client_id, cl.name as client_name,
           -- F38, Fase 7: as duas pontas, para o cartão dizer de onde o
           -- cliente veio e se a lista o exige.
           t.client_id as own_client_id,
           lista_da_ficha.client_id as list_client_id,
           cl_lista.name as list_client_name,
           coalesce(lista_da_ficha.requires_client, false) as list_requires_client,
           t.completed_at, t.completed_by,
           ideworks.display_name(t.completed_by) as completed_by_name,
           t.archived_at,
           t.created_by,
           ideworks.display_name(t.created_by) as created_by_name,
           t.via_name,
           t.created_at, t.updated_at,
           tr.list_name, tr.folder_id, tr.folder_name, tr.space_id, tr.space_name,
           cat.name as category_name,
           tl.task_type_id, tl.task_type_name, tl.task_type_missing,
           t.demand_type::text as demand_type,
           coalesce(tl.tags, '[]'::jsonb) as tags,
           coalesce(
             (select json_agg(json_build_object(
                        'id', a.user_id,
                        'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                      order by ideworks.display_name(a.user_id))
                from ideworks.task_assignees a
               where a.task_id = t.id),
             '[]'::json) as assignees,
           coalesce(
             (select json_agg(json_build_object(
                        'id', w.user_id,
                        'name', coalesce(ideworks.display_name(w.user_id), '(sem nome)'))
                      order by ideworks.display_name(w.user_id))
                from ideworks.task_watchers w
               where w.task_id = t.id),
             '[]'::json) as watchers
      from ideworks.tasks t
      left join ideworks.tree tr on tr.list_id = t.list_id
      left join ideworks.client_categories cat on cat.id = tr.category_id
      left join ideworks.clients cl on cl.id = ${clienteDaTarefaSql(tx)}
      left join ideworks.lists lista_da_ficha on lista_da_ficha.id = t.list_id
      left join ideworks.clients cl_lista on cl_lista.id = lista_da_ficha.client_id
      left join ideworks.task_labels tl on tl.task_id = t.id
      -- A mae, quando esta tarefa e subtarefa. Juncao a esquerda porque a
      -- maioria nao tem mae, e nao porque a mae possa faltar: ela mora na mesma
      -- lista (tasks_parent_same_list_fk), entao quem le a filha le a mae.
      left join ideworks.tasks pai on pai.id = t.parent_id
     where t.id = ${tarefa}`;

  const pessoa = (id: unknown, nome: unknown): TaskPerson | null =>
    id === null || id === undefined
      ? null
      : { id: id as string, name: (nome as string | null) ?? '(sem nome)' };

  /* --- os passos, F17.15 ---------------------------------------------------- */

  // A CONTAGEM VEM DA VIEW, E NÃO DE UM `count(*)` ESCRITO AQUI.
  // `ideworks.task_progress` é a única definição dela no projeto: o cartão do
  // quadro lê a mesma, e assim os dois nunca discordam. Uma segunda conta em
  // TypeScript seria a dívida 8.1 do legado outra vez.
  const consultaDoProgresso = tx`
    select p.subtask_count, p.subtask_done,
           p.checklist_count, p.checklist_total, p.checklist_done,
           p.attachment_count, p.link_count, p.comment_count
      from ideworks.task_progress p
     where p.task_id = ${tarefa}`;

  // As filhas DIRETAS, arquivadas incluídas. Ver `TaskDetail.subtasks`: a
  // contagem acima as exclui, e omiti-las aqui também faria trabalho arquivado
  // sumir sem deixar rastro.
  //
  // A ordem é a de CRIAÇÃO, e não a de prioridade ou prazo: a equipe numera os
  // passos (`1.1`, `1.2`, `1.3`) e reordená-los por outra coisa quebraria a
  // única sequência que eles têm.
  const consultaDasFilhas = tx`
    select f.id, f.title, f.status_id,
           s.name as status_name, s.color as status_color, s.type as status_type,
           f.priority, f.due_on::text as due_on,
           f.completed_at, f.archived_at,
           coalesce(fp.subtask_count, 0) as subtask_count,
           coalesce(
             (select json_agg(json_build_object(
                        'id', a.user_id,
                        'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                      order by ideworks.display_name(a.user_id))
                from ideworks.task_assignees a
               where a.task_id = f.id),
             '[]'::json) as assignees
      from ideworks.tasks f
      left join ideworks.statuses s on s.id = f.status_id
      left join ideworks.task_progress fp on fp.task_id = f.id
     where f.parent_id = ${tarefa}
     order by f.created_at, lower(f.title)`;

  // Os checklists e os itens em DUAS consultas, e não numa junção: uma tarefa
  // com três checklists e trinta itens sairia com trinta linhas repetindo o
  // nome do checklist, e o cartão vazio (checklist sem item nenhum) sumiria da
  // junção interna — que é justamente o estado inicial de todo checklist novo.
  const consultaDosChecklists = tx`
    select k.id, k.name, k.sort_order
      from ideworks.task_checklists k
     where k.task_id = ${tarefa}
     order by k.sort_order, k.created_at`;

  const consultaDosItens = tx`
    select i.id, i.checklist_id, i.parent_item_id, i.name, i.sort_order,
           i.resolved_at, i.assignee_id,
           ideworks.display_name(i.assignee_id) as assignee_name
      from ideworks.checklist_items i
      join ideworks.task_checklists k on k.id = i.checklist_id
     where k.task_id = ${tarefa}
     order by i.sort_order, i.created_at`;

  /* --- a entrega, F17.6 ----------------------------------------------------- */

  // A CONVERSA INTEIRA numa consulta, ACHATADA — comentário e resposta na mesma
  // lista. Quem monta os dois níveis é `aninharConversa`, que tem teste. Duas
  // consultas (uma para comentário, outra para resposta) dariam duas respostas
  // que podem discordar, e é o mesmo argumento de `buildTree` e `aninharItens`.
  //
  // `reply_count` é o do ClickUp, e é contado AQUI, no banco. A tela não o
  // deduz do array: um dia a conversa pode vir paginada, e a conta passaria a
  // mentir sem ninguém ter mexido nela.
  //
  // `mine` VEM DO SERVIDOR, e não de a tela comparar ids. A regra de verdade é
  // a política `task_comments_update`, que exige `author_id =
  // acting_user_id()`; este booleano é a MESMA pergunta, respondida pela mesma
  // fonte. Botão de editar que aparece e leva 403 é pior que botão ausente.
  //
  // F42, Fase 7 — O COMENTÁRIO DO CLIENTE. `from_client` não tem autor (a
  // restrição do banco exige `author_id` nulo), e `mine` sai falso para todos:
  // ninguém da equipe edita nem apaga o que o cliente escreveu. O material a
  // que ele se refere (nome e posição no carrossel) e a versão da rodada vêm
  // pelas junções à esquerda — sob a mesma política das rodadas; quem não as
  // alcança vê o selo sem o nome do material, e nada quebra.
  const consultaDaConversa = tx`
    select c.id, c.parent_id, c.body, c.created_at, c.edited_at,
           c.author_id,
           ideworks.display_name(c.author_id) as author_name,
           c.author_id is not distinct from ideworks.acting_user_id() as mine,
           c.from_client,
           ai.file_name as approval_item_name,
           ai.position as approval_item_position,
           ar.version as approval_version,
           (select count(*) from ideworks.task_comments r
             where r.parent_id = c.id)::int as reply_count
      from ideworks.task_comments c
      left join ideworks.approval_round_items ai on ai.id = c.approval_item_id
      left join ideworks.approval_rounds ar on ar.id = c.approval_round_id
     where c.task_id = ${tarefa}
     order by c.created_at, c.id`;

  // Só a FICHA de cada arquivo. Os bytes moram no balde privado e nunca passam
  // por aqui: a tela pede uma URL assinada, com prazo, quando alguém clica.
  const consultaDosAnexos = tx`
    select a.id, a.file_name, a.extension, a.content_type, a.byte_size, a.expires_at,
           (a.storage_path like a.task_id::text || '/inline/%') as in_text,
           a.uploaded_by,
           ideworks.display_name(a.uploaded_by) as uploaded_by_name,
           a.created_at
      from ideworks.task_attachments a
     where a.task_id = ${tarefa}
     order by a.created_at, a.file_name`;

  const consultaDosLinks = tx`
    select l.id, l.label, l.url, l.sort_order,
           l.created_by,
           ideworks.display_name(l.created_by) as created_by_name,
           l.created_at
      from ideworks.task_links l
     where l.task_id = ${tarefa}
     order by l.sort_order, l.created_at`;

  // RAJADA 1 — nove consultas que só precisam do id da tarefa, enviadas juntas.
  // Se a tarefa não existe, ou está fora do alcance, as outras voltam vazias (a
  // política de linha vale para todas) e a recusa abaixo é a de sempre.
  const [[linha], [progresso], filhas, listas, itens, conversa, anexos, links, history] = await Promise.all([
    consultaDaFicha,
    consultaDoProgresso,
    consultaDasFilhas,
    consultaDosChecklists,
    consultaDosItens,
    consultaDaConversa,
    consultaDosAnexos,
    consultaDosLinks,
    lerHistoricoDaTarefa(tx, taskId),
  ]);

  // Fora do alcance e inexistente respondem igual, de propósito: distinguir os
  // dois contaria que a tarefa existe para quem não pode vê-la.
  if (!linha) throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 404);

  const listId = (linha.list_id as string | null) ?? null;
  const spaceId = (linha.space_id as string | null) ?? null;

  // RAJADA 2 — o que depende da lista e do espaço que a rajada 1 trouxe.
  const [esteira, etiquetasDoEspaco, tiposDoEspaco, listIsProduction] = await Promise.all([
    // A esteira RESOLVIDA da lista — lista → pasta → espaço, decidida pelo banco.
    // Vem vazia quando a tarefa é demanda de cliente sem quadro nenhum, e isso é
    // um estado legítimo: a F4.8 criou tarefa antes de existir lista.
    listId
      ? tx`
          select lw.status_set_name, lw.inherited_from,
                 lw.status_id, lw.status_name, lw.status_type,
                 lw.status_color, lw.status_sort_order
            from ideworks.list_workflow lw
           where lw.list_id = ${inlineUuid(tx, listId)}
           order by lw.status_sort_order, lw.status_name`
      : [],
    // O vocabulário do ESPAÇO: é onde o ClickUp guarda etiqueta e tipo, e é o que
    // o seletor da ficha oferece. Fora dali a etiqueta não quer dizer nada — e o
    // gatilho `task_tag_space_guard` recusa a de outro espaço.
    spaceId
      ? tx`
          select g.id, g.name, g.bg_color, g.fg_color
            from ideworks.task_tags g
           where g.space_id = ${inlineUuid(tx, spaceId)}
           order by lower(btrim(g.name))`
      : [],
    spaceId
      ? tx`
          select tt.id, tt.custom_item_id, tt.name
            from ideworks.task_types tt
           where tt.space_id = ${inlineUuid(tx, spaceId)}
           order by tt.custom_item_id`
      : [],
    // F40, Fase 4: a ficha precisa saber se a lista é de produção para não
    // oferecer "sem tipo". Uma consulta por ficha aberta.
    listId === null ? false : listaEhDeProducao(tx, listId),
  ]);

  const itensPorLista = new Map<string, ChecklistItem[]>();
  for (const r of itens) {
    const chave = r.checklist_id as string;
    const lista = itensPorLista.get(chave) ?? [];
    lista.push({
      id: r.id as string,
      checklistId: chave,
      parentItemId: (r.parent_item_id as string | null) ?? null,
      name: r.name as string,
      sortOrder: comoNumero(r.sort_order),
      resolvedAt: comoInstante(r.resolved_at),
      assignee: pessoa(r.assignee_id, r.assignee_name),
      // Achatado aqui; quem aninha é `aninharItens`, que tem teste.
      children: [],
    });
    itensPorLista.set(chave, lista);
  }

  const progress: TaskProgress = {
    subtaskCount: comoNumero(progresso?.subtask_count),
    subtaskDone: comoNumero(progresso?.subtask_done),
    checklistCount: comoNumero(progresso?.checklist_count),
    checklistTotal: comoNumero(progresso?.checklist_total),
    checklistDone: comoNumero(progresso?.checklist_done),
    attachmentCount: comoNumero(progresso?.attachment_count),
    linkCount: comoNumero(progresso?.link_count),
    commentCount: comoNumero(progresso?.comment_count),
  };

  return {
    id: linha.id as string,
    title: linha.title as string,
    description: (linha.description as string | null) ?? null,

    listId,
    listName: (linha.list_name as string | null) ?? null,
    folderId: (linha.folder_id as string | null) ?? null,
    folderName: (linha.folder_name as string | null) ?? null,
    spaceId,
    spaceName: (linha.space_name as string | null) ?? null,
    categoryName: (linha.category_name as string | null) ?? null,

    statusId: (linha.status_id as string | null) ?? null,
    priority: (linha.priority as Priority | null) ?? null,
    dueOn: (linha.due_on as string | null) ?? null,
    startOn: (linha.start_on as string | null) ?? null,

    customItemId: linha.custom_item_id === null ? null : comoNumero(linha.custom_item_id),
    taskTypeId: (linha.task_type_id as string | null) ?? null,
    taskTypeName: (linha.task_type_name as string | null) ?? null,
    taskTypeMissing: linha.task_type_missing === true,
    type: comoTipoLido(linha.demand_type),
    // F40, Fase 4: a ficha precisa saber se a lista é de produção para não
    // oferecer "sem tipo". Uma consulta por ficha aberta.
    listIsProduction,

    clientId: (linha.client_id as string | null) ?? null,
    // Nulo quando a tarefa não tem cliente E quando o cliente está fora da
    // carteira de quem olha. Esconder a tarefa por causa disso esconderia
    // trabalho — mesma decisão do cartão do quadro.
    clientName: (linha.client_name as string | null) ?? null,
    ownClientId: (linha.own_client_id as string | null) ?? null,
    listClientId: (linha.list_client_id as string | null) ?? null,
    listClientName: (linha.list_client_name as string | null) ?? null,
    listRequiresClient: linha.list_requires_client === true,

    assignees: (linha.assignees as TaskPerson[]) ?? [],
    watchers: (linha.watchers as TaskPerson[]) ?? [],
    tags: ((linha.tags as LinhaDeEtiqueta[]) ?? []).map(comoEtiqueta),

    completedAt: comoInstante(linha.completed_at),
    completedBy: pessoa(linha.completed_by, linha.completed_by_name),
    archivedAt: comoInstante(linha.archived_at),
    createdBy: pessoa(linha.created_by, linha.created_by_name),
    // A conexão de IA pela qual a tarefa nasceu (F26.2), para o selo de
    // origem da F26.9. Nula = criada por gente.
    createdVia: (linha.via_name as string | null) ?? null,
    createdAt: comoInstante(linha.created_at) as string,
    updatedAt: comoInstante(linha.updated_at) as string,

    statuses: esteira.map(
      (r) =>
        ({
          id: r.status_id as string,
          name: r.status_name as string,
          type: r.status_type as StatusType,
          color: (r.status_color as string | null) ?? null,
          sortOrder: comoNumero(r.status_sort_order),
        }) satisfies BoardStatus,
    ),
    statusSetName: (esteira[0]?.status_set_name as string | undefined) ?? null,
    inheritedFrom: (esteira[0]?.inherited_from as TaskDetail['inheritedFrom']) ?? null,

    availableTags: etiquetasDoEspaco.map((g) => comoEtiqueta(g as unknown as LinhaDeEtiqueta)),
    availableTypes: tiposDoEspaco.map(
      (r) =>
        ({
          id: r.id as string,
          customItemId: comoNumero(r.custom_item_id),
          name: r.name as string,
        }) satisfies TaskType,
    ),

    parentId: (linha.parent_id as string | null) ?? null,
    parentTitle: (linha.parent_title as string | null) ?? null,

    subtasks: filhas.map(
      (r) =>
        ({
          id: r.id as string,
          title: r.title as string,
          statusId: (r.status_id as string | null) ?? null,
          statusName: (r.status_name as string | null) ?? null,
          statusColor: (r.status_color as string | null) ?? null,
          statusType: (r.status_type as string | null) ?? null,
          priority: (r.priority as Priority | null) ?? null,
          dueOn: (r.due_on as string | null) ?? null,
          completedAt: comoInstante(r.completed_at),
          archivedAt: comoInstante(r.archived_at),
          assignees: (r.assignees as TaskPerson[]) ?? [],
          subtaskCount: comoNumero(r.subtask_count),
        }) satisfies Subtask,
    ),

    checklists: listas.map(
      (k) =>
        ({
          id: k.id as string,
          name: k.name as string,
          sortOrder: comoNumero(k.sort_order),
          items: itensPorLista.get(k.id as string) ?? [],
        }) satisfies Checklist,
    ),

    comments: conversa.map(
      (r) =>
        ({
          id: r.id as string,
          parentId: (r.parent_id as string | null) ?? null,
          body: r.body as string,
          author: pessoa(r.author_id, r.author_name),
          createdAt: comoInstante(r.created_at) as string,
          editedAt: comoInstante(r.edited_at),
          replyCount: comoNumero(r.reply_count),
          // O cliente não é dono de nada aqui: nem o `mine` da equipe vale.
          mine: r.from_client === true ? false : r.mine === true,
          fromClient: r.from_client === true,
          approvalItemName: (r.approval_item_name as string | null) ?? null,
          approvalItemPosition:
            r.approval_item_position === null || r.approval_item_position === undefined
              ? null
              : comoNumero(r.approval_item_position),
          approvalVersion:
            r.approval_version === null || r.approval_version === undefined ? null : comoNumero(r.approval_version),
          // Achatado aqui; quem aninha é `aninharConversa`, que tem teste.
          replies: [],
        }) satisfies Comentario,
    ),

    attachments: anexos.map(
      (r) =>
        ({
          id: r.id as string,
          fileName: r.file_name as string,
          extension: (r.extension as string | null) ?? null,
          contentType: r.content_type as string,
          byteSize: comoNumero(r.byte_size),
          expiresAt: comoInstante(r.expires_at),
          inText: r.in_text === true,
          uploadedBy: pessoa(r.uploaded_by, r.uploaded_by_name),
          createdAt: comoInstante(r.created_at) as string,
        }) satisfies Anexo,
    ),

    links: links.map(
      (r) =>
        ({
          id: r.id as string,
          label: r.label as string,
          url: r.url as string,
          sortOrder: comoNumero(r.sort_order),
          createdBy: pessoa(r.created_by, r.created_by_name),
          createdAt: comoInstante(r.created_at) as string,
        }) satisfies Link,
    ),

    history,

    progress,
  };
}

export async function readTaskDetail(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), (tx) => lerFicha(tx, taskId));
}

/* ───────────────────────────── criar ───────────────────────────── */

/**
 * A tarefa nova, na lista.
 *
 * O STATUS PODE NÃO VIR, E ESSE É O CAMINHO NORMAL. `tasks_status_guard`
 * preenche com o primeiro status que ABRE da esteira resolvida da lista — é
 * exatamente o que o `+ Adicionar tarefa` da coluna precisa.
 *
 * TUDO NO MESMO BLOCO (regra 9). Criar a tarefa e depois atribuir, em duas
 * chamadas, deixaria tarefa sem dono se a segunda falhasse — e ninguém percebe
 * uma atribuição que não aconteceu.
 *
 * NÃO SE GRAVA `completed_at` AQUI, e a omissão é deliberada: é a dívida latente
 * que a F17.3c nomeou. `insert (list_id, ..., completed_at)` nasceria com status
 * que abre e conclusão carimbada — "concluída na ficha, aberta na coluna". A
 * tarefa nova nasce aberta; concluir é `complete_task`, depois.
 *
 * F38, Fase 6.3: `entrada.statusId` escolhe a etapa de nascimento. Quem confere que
 * ela é da esteira da lista é o gatilho `tasks_status_guard`; se a etapa for do
 * tipo `closed`, é ELE que carimba `completed_at`/`completed_by` — esta função
 * continua sem gravar conclusão.
 */
export async function createBoardTask(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
  entrada: NewTask,
): Promise<string> {
  exigirTitulo(entrada.title);

  // O autor é quem está logado — e sai da sessão, nunca do corpo do pedido.
  return withActor(sql, asDbActor(actor), (tx) =>
    createBoardTaskInTx(tx, listId, entrada, actor.userId),
  );
}

/**
 * O MIOLO do criar, no `Tx` de quem chama — F26.3, mesmo padrão de
 * `postCommentInTx` e `moveTaskOnBoardInTx`.
 *
 * Recebe um `Tx` JÁ ABERTO, com o ator já declarado. Não chama `withActor`
 * nem `sql.begin`. A tela chama por `createBoardTask`; o caminho do agente
 * (F26.5) chama direto de dentro do `mutate` de `runAgentWrite`, no `sqlTx`
 * do registro — chamar o invólucro de lá abriria uma segunda transação fora
 * do ledger, e a falha ao gravar o registro deixaria a tarefa criada sem
 * rastro da integração.
 *
 * `autorId` É PARÂMETRO DE QUEM CHAMA, E QUEM CHAMA É CÓDIGO CONFIÁVEL: a tela
 * passa a pessoa logada; o agente passa o dono da concessão. Nunca um valor
 * vindo do corpo do pedido — `created_by` é o nome que a ficha mostra como
 * "criada por", e a política `tasks_insert` confere só o alcance da lista, não
 * o autor. Quem forjasse o autor aqui assinaria a tarefa em nome de outro.
 *
 * A tradução de erro mora AQUI, e não no invólucro: os dois chamadores
 * recebem a mesma `BoardRefused` legível.
 */
export async function createBoardTaskInTx(
  tx: Tx,
  listId: string,
  entrada: NewTask,
  autorId: string,
): Promise<string> {
  exigirTitulo(entrada.title);

  try {
    // F38, Fase 6 — o cliente da tarefa nova, decidido ANTES do insert e com
    // a frase de cada recusa. O gatilho `tasks_client_from_list` repete a
    // herança e a recusa da lista compartilhada como garantia do banco.
    const decisao = await decidirClienteNoTx(tx, listId, entrada.clientId);
    if (!decisao.ok) {
      throw new BoardRefused(decisao.mensagem, decisao.motivo === 'fora_do_alcance' ? 403 : 400);
    }

    // F40, Fase 2 — o tipo da demanda, conferido ANTES do insert. Valor torto
    // é recusado; sem tipo, só em lista de PRODUÇÃO (uma consulta, e só quando
    // o tipo não veio). O gatilho do banco repete a recusa (`IW040`).
    const tipo = conferirTipo(entrada.type);
    if (tipo === null && (await listaEhDeProducao(tx, listId))) throw new TypeRequired();

    const [criada] = await tx`
      insert into ideworks.tasks
             (list_id, client_id, title, description, due_on, start_on, priority, status_id,
              custom_item_id, created_by, demand_type)
      values (${listId}, ${decisao.clientId}::uuid, ${entrada.title.trim()}, ${entrada.description},
              ${entrada.dueOn}::date, ${entrada.startOn}::date,
              ${entrada.priority}::ideworks.task_priority,
              ${entrada.statusId}, ${entrada.customItemId}::integer, ${autorId},
              ${tipo}::ideworks.task_demand_type)
      returning id`;

    // A política `tasks_insert` filtra em silêncio: sem `returning` a recusa
    // por alcance pareceria sucesso.
    if (!criada) {
      throw new BoardRefused('Lista não encontrada, ou fora do seu alcance.', 403);
    }

    const id = criada.id as string;

    if (entrada.assigneeIds.length > 0) {
      await tx`select ideworks.set_task_assignees(${id}, ${arrayOuNulo(entrada.assigneeIds)}::uuid[])`;
    }
    if (entrada.tagIds.length > 0) {
      await tx`select ideworks.set_task_tags(${id}, ${arrayOuNulo(entrada.tagIds)}::uuid[])`;
    }

    return id;
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A lista e o cliente escolhido, lidos COMO QUEM CRIA (a política de `lists`
 * e a de `clients` recortam), e a decisão de `decidirClienteDaNovaTarefa`.
 *
 * Lista que não volta = não existe ou está fora do alcance: a mesma recusa 403
 * que o insert sem linha já dava. Cliente com id torto não vai ao banco (o
 * `::uuid` estouraria como erro 500): é tratado como cliente que não existe.
 */
async function decidirClienteNoTx(
  tx: Tx,
  listId: string,
  pedido: string | null | undefined,
): Promise<DecisaoDoCliente> {
  const [lida] = await tx`
    select l.client_id::text as client_id, l.requires_client,
           s.category_id::text as company_id
      from ideworks.lists l
      join ideworks.spaces s on s.id = l.space_id
     where l.id = ${listId}`;
  if (!lida) throw new BoardRefused('Lista não encontrada, ou fora do seu alcance.', 403);
  const lista: ListaDaNovaTarefa = {
    clientId: (lida.client_id as string | null) ?? null,
    requiresClient: lida.requires_client === true,
    companyId: (lida.company_id as string | null) ?? null,
  };

  const cliente = pedido ? await lerClienteDoPedido(tx, pedido) : undefined;
  return decidirClienteDaNovaTarefa(lista, pedido, cliente);
}

/** O cliente pedido, como quem age o enxerga. `null` = não existe ou fora do alcance. */
async function lerClienteDoPedido(tx: Tx, pedido: string): Promise<ClienteDaNovaTarefa> {
  if (!UUID.test(pedido)) return null;
  const [c] = await tx`
    select c.id::text as id, c.name, c.category_id::text as company_id, c.is_active,
           to_char(c.inactive_at at time zone ${AGENCY_TIMEZONE}, 'YYYY-MM-DD') as cancelled_on
      from ideworks.clients c
     where c.id = ${pedido.toLowerCase()}::uuid`;
  if (!c) return null;
  return {
    id: c.id as string,
    name: (c.name as string | null) ?? 'sem nome',
    companyId: (c.company_id as string | null) ?? null,
    isActive: c.is_active !== false,
    cancelledOn: (c.cancelled_on as string | null) ?? null,
  };
}

/* ───────────────────────────── o cliente no cartão (F38, Fase 7) ───────────── */

/** Um cliente que o seletor oferece. */
export type OpcaoDeCliente = { id: string; name: string };

/**
 * OS CLIENTES QUE O SELETOR OFERECE PARA UMA LISTA — F38, Fase 7.
 *
 * São os que `decidirClienteDaNovaTarefa` aceitaria: ATIVOS, ao alcance de
 * quem pede (a política de `clients` recorta, e nenhum recorte de alcance é
 * escrito aqui) e da MESMA empresa da lista (cliente sem empresa passa, como
 * lá). Cliente de empresa omitida (F31) não é oferecido.
 *
 * Serve à criação (modal e `+ Adicionar tarefa`) e à troca no cartão. A lista
 * primeiro: fora do alcance, 404 — a mesma resposta do quadro dela.
 */
export async function readClientOptions(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
): Promise<OpcaoDeCliente[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const [lista] = await tx`
      select s.category_id::text as company_id
        from ideworks.lists l
        join ideworks.spaces s on s.id = l.space_id
       where l.id = ${listId}`;
    if (!lista) throw new BoardRefused('Lista não encontrada, ou fora do seu alcance.', 404);
    const empresa = (lista.company_id as string | null) ?? null;

    const linhas = await tx`
      select c.id::text as id, c.name
        from ideworks.clients c
       where c.is_active
         and (${empresa}::uuid is null or c.category_id is null or c.category_id = ${empresa}::uuid)
         ${recorteDasOmitidas(tx, actor, (ids) => tx`and (c.category_id is null or c.category_id <> all(${ids}::uuid[]))`)}
       order by lower(c.name), c.id`;
    return linhas.map((r) => ({ id: r.id as string, name: (r.name as string | null) ?? 'sem nome' }));
  });
}

/**
 * A FRASE DA TROCA. A decisão é a mesma da criação (`decidirClienteDaNovaTarefa`),
 * mas as frases de lá falam em "criar" e "nada foi criado" — aqui nada se cria.
 */
function fraseDaTroca(decisao: Extract<DecisaoDoCliente, { ok: false }>, cliente: ClienteDaNovaTarefa | undefined): string {
  switch (decisao.motivo) {
    case 'lista_compartilhada':
      return 'Esta lista é compartilhada: toda tarefa dela precisa de um cliente. Escolha um cliente — "sem cliente" não vale aqui. Nada foi gravado.';
    case 'outro_cliente':
      return 'Esta tarefa está na lista de outro cliente, e a tarefa dela fica com o cliente da lista. Para trocar de cliente, mova a tarefa para a lista do cliente escolhido. Nada foi gravado.';
    case 'cancelado': {
      const nome = cliente?.name ?? 'escolhido';
      const quando = cliente?.cancelledOn ? ` em ${cliente.cancelledOn.slice(8, 10)}/${cliente.cancelledOn.slice(5, 7)}/${cliente.cancelledOn.slice(0, 4)}` : '';
      return `O cliente ${nome} foi cancelado${quando}: escolha um cliente ativo. Nada foi gravado.`;
    }
    case 'outra_empresa':
      return 'O cliente escolhido é de outra empresa que a desta lista. Nada foi gravado.';
    default:
      return decisao.mensagem;
  }
}

/**
 * TROCAR O CLIENTE DA TAREFA — F38, Fase 7.
 *
 * As regras são as da CRIAÇÃO (`decidirClienteDaNovaTarefa`), lidas na lista
 * em que a tarefa está agora — uma regra só para nascer e para trocar:
 *
 *   · lista de CLIENTE: só vale o cliente da lista. `null` quer dizer "o da
 *     lista" e grava o id dela (é o que o gatilho grava ao criar). Outro
 *     cliente é recusado — a criação recusa igual. A tarefa movida de lista
 *     com o cliente antigo aparece com a diferença no cartão, e "usar o da
 *     lista" é a única troca oferecida;
 *   · lista COMPARTILHADA: obrigatório; `null` é recusado;
 *   · lista INTERNA: `null` é "interna, sem cliente".
 *   · o cliente precisa estar ao alcance, ATIVO e ser da empresa da lista.
 *
 * O BANCO TRAVA DOIS CASOS, E A RECUSA É DITA ANTES DELE: `task_parent_guard`
 * recusa trocar o cliente de tarefa com subtarefa (mãe e filhas seriam lidas
 * por gente diferente) e a subtarefa só aceita o cliente da mãe.
 *
 * O HISTÓRICO: a troca grava UMA linha em `task_events` (migration
 * `20261007110000`) com `from_client_id`/`to_client_id` e os nomes como
 * paraquedas (F17.65). Só quando o cliente muda de fato — pedir o mesmo
 * cliente não grava nada. `actor_id` é a pessoa da sessão e `automation_name`
 * fica nulo (foi à mão); `via_name` o gatilho da F26.2 carimba sozinho.
 */
export async function setBoardTaskClient(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  pedido: string | null,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    await setBoardTaskClientInTx(tx, taskId, pedido);
    return relerFicha(tx, taskId);
  });
}

/** O MIOLO da troca, no `Tx` de quem chama — mesmo padrão de `patchBoardTaskInTx`. */
export async function setBoardTaskClientInTx(
  tx: Tx,
  taskId: string,
  pedido: string | null,
): Promise<void> {
  try {
    const [tarefa] = await tx`
      select t.list_id::text as list_id, t.parent_id, t.client_id::text as client_id,
             (select count(*)::int from ideworks.tasks f where f.parent_id = t.id) as filhas
        from ideworks.tasks t
       where t.id = ${taskId}`;
    if (!tarefa) throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 404);

    if (tarefa.parent_id !== null) {
      throw new BoardRefused(
        'Subtarefa usa o cliente da tarefa-mãe. Para mudar, troque o cliente da tarefa-mãe. Nada foi gravado.',
        400,
      );
    }
    if (comoNumero(tarefa.filhas) > 0) {
      throw new BoardRefused(
        'Esta tarefa tem subtarefas, e elas herdam o cliente dela: o banco não troca o cliente de mãe e filhas de uma vez. Nada foi gravado.',
        400,
      );
    }
    const listId = (tarefa.list_id as string | null) ?? null;
    if (listId === null) {
      throw new BoardRefused(
        'Esta tarefa não está em lista nenhuma: ela é demanda do cliente e não troca de cliente pelo cartão.',
        400,
      );
    }

    const decisao = await decidirClienteNoTx(tx, listId, pedido);
    if (!decisao.ok) {
      const cliente = pedido ? await lerClienteDoPedido(tx, pedido) : undefined;
      throw new BoardRefused(fraseDaTroca(decisao, cliente), decisao.motivo === 'fora_do_alcance' ? 403 : 400);
    }

    const atual = (tarefa.client_id as string | null) ?? null;
    if ((atual ?? '').toLowerCase() === (decisao.clientId ?? '').toLowerCase()) return;

    const feitas = await tx`
      update ideworks.tasks t
         set client_id = ${decisao.clientId}::uuid, updated_at = now()
       where t.id = ${taskId}
      returning t.id`;
    if (feitas.length === 0) {
      throw new BoardRefused('Você não pode mexer nesta tarefa.', 403);
    }

    // O NOME VAI JUNTO como paraquedas: o cliente pode ser apagado depois e o
    // id virar nulo. A leitura prefere o nome vivo.
    const ids = [atual, decisao.clientId].filter((v): v is string => v !== null);
    const nomes = new Map<string, string>();
    if (ids.length > 0) {
      const linhas = await tx`
        select id::text as id, name from ideworks.clients where id = any(${ids}::uuid[])`;
      for (const l of linhas) nomes.set((l.id as string).toLowerCase(), l.name as string);
    }
    const nomeDe = (id: string | null) => (id === null ? null : (nomes.get(id.toLowerCase()) ?? null));
    await tx`
      insert into ideworks.task_events (task_id, automation_name, from_client_id, to_client_id,
                                        from_client_name, to_client_name, actor_id)
      values (${taskId}::uuid, null, ${atual}::uuid, ${decisao.clientId}::uuid,
              ${nomeDe(atual)}, ${nomeDe(decisao.clientId)}, ideworks.acting_user_id())`;
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

/* ───────────────────────────── salvar ───────────────────────────── */

/**
 * O que mudou na ficha, e a ficha de volta.
 *
 * CAMPO AUSENTE É CAMPO NÃO MEXIDO — e não "campo a limpar". A diferença é a
 * razão de o pedido ser parcial: a ficha abre com o prazo `82025-08-07`, que o
 * campo nativo de data não sabe mostrar; se o pedido carregasse todos os campos
 * sempre, salvar o título APAGARIA aquele prazo sem ninguém pedir.
 *
 * O `case when` com a coluna no `else` é o que implementa isso numa escrita só.
 * `coalesce` não serviria: nulo é um valor legítimo aqui — é "tirar o prazo".
 *
 * O STATUS VAI POR ÚLTIMO, e por `move_task`: ela é a única que pode
 * reposicionar o cartão, e vir por último evita que o `update` dos campos
 * simples passe por cima do que o gatilho carimbou.
 */
export async function patchBoardTask(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  patch: TaskPatch,
): Promise<TaskDetail> {
  exigirTitulo(patch.title);

  return withActor(sql, asDbActor(actor), async (tx) => {
    await patchBoardTaskInTx(tx, taskId, patch);
    // A RELEITURA, dentro da mesma transação. Ver o cabeçalho: as funções de
    // lista ignoram em silêncio e o gatilho carimba por conta própria, então
    // devolver o pedido em vez do que ficou seria mentir com boa intenção.
    return relerFicha(tx, taskId);
  });
}

/**
 * O MIOLO do salvar, no `Tx` de quem chama — F26.3, mesmo padrão de
 * `postCommentInTx`.
 *
 * Recebe um `Tx` JÁ ABERTO, com o ator declarado; não chama `withActor` nem
 * `sql.begin`. Escreve os campos simples, as três listas e o status, nesta
 * ordem, e NÃO relê a ficha: a releitura custa doze consultas (F23), e só a
 * tela as usa. `patchBoardTask` relê; o agente (F26.5) lê o que precisar.
 *
 * Responsáveis, observadores e etiquetas entram por aqui também — "atribuir"
 * é um `patch` com `assigneeIds`, e não uma segunda escrita: uma segunda
 * versão de `set_task_assignees` seria a que fica para trás.
 */
export async function patchBoardTaskInTx(
  tx: Tx,
  taskId: string,
  patch: TaskPatch,
): Promise<void> {
  exigirTitulo(patch.title);

  try {
    // F40, Fase 2 — o tipo. Valor torto é recusado; apagar um tipo já escolhido
    // em lista de PRODUÇÃO também. Card antigo sem tipo, mandando "nulo", não
    // muda nada e passa (espelha o gatilho). Sem `type` no pedido, zero consulta.
    const tipo = patch.type === undefined ? undefined : conferirTipo(patch.type);
    if (tipo === null) {
      const [atual] = await tx`
        select t.demand_type is not null as tinha_tipo,
               t.list_id is not null and ideworks.list_is_production(t.list_id) as producao
          from ideworks.tasks t where t.id = ${taskId}`;
      if (atual?.tinha_tipo === true && atual.producao === true) throw new TypeRequired();
    }

    const alteradas = await tx`
      update ideworks.tasks t
         set title          = case when ${patch.title !== undefined}
                                   then ${patch.title ?? ''}::text else t.title end,
             description    = case when ${patch.description !== undefined}
                                   then ${patch.description ?? null}::text
                                   else t.description end,
             due_on         = case when ${patch.dueOn !== undefined}
                                   then ${patch.dueOn ?? null}::date else t.due_on end,
             start_on       = case when ${patch.startOn !== undefined}
                                   then ${patch.startOn ?? null}::date else t.start_on end,
             priority       = case when ${patch.priority !== undefined}
                                   then ${patch.priority ?? null}::ideworks.task_priority
                                   else t.priority end,
             custom_item_id = case when ${patch.customItemId !== undefined}
                                   then ${patch.customItemId ?? null}::integer
                                   else t.custom_item_id end,
             demand_type    = case when ${tipo !== undefined}
                                   then ${tipo ?? null}::ideworks.task_demand_type
                                   else t.demand_type end,
             updated_at     = now()
       where t.id = ${taskId}
       returning t.id`;

    if (alteradas.length === 0) {
      throw new BoardRefused('Tarefa não encontrada, ou fora do seu alcance.', 404);
    }

    // As três listas vão pelas ações do banco, que trocam o conjunto inteiro
    // em bloco. Nenhuma delas é `insert`/`delete` escrito aqui — seria uma
    // segunda versão da regra, e a segunda é sempre a errada.
    if (patch.assigneeIds !== undefined) {
      await tx`select ideworks.set_task_assignees(${taskId}, ${arrayOuNulo(patch.assigneeIds)}::uuid[])`;
    }
    if (patch.watcherIds !== undefined) {
      await tx`select ideworks.set_task_watchers(${taskId}, ${arrayOuNulo(patch.watcherIds)}::uuid[])`;
    }
    if (patch.tagIds !== undefined) {
      await tx`select ideworks.set_task_tags(${taskId}, ${arrayOuNulo(patch.tagIds)}::uuid[])`;
    }

    if (patch.statusId !== undefined) {
      const [atual] = await tx`select list_id from ideworks.tasks where id = ${taskId}`;
      const listId = (atual?.list_id as string | null) ?? null;
      if (listId === null) {
        throw new BoardRefused(
          'Esta tarefa não está em lista nenhuma, então não tem esteira de status. Ela é demanda de cliente — a F4.8 as criou antes de existir quadro.',
          400,
        );
      }
      await tx`select ideworks.move_task(${taskId}, ${listId}, ${patch.statusId})`;
    }
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

/**
 * A ficha relida depois de uma escrita, com a mesma tradução de erro.
 *
 * Antes da F26.3 a releitura estava DENTRO do `try` de cada escrita da tela;
 * separar o miolo não pode mudar a recusa que a tela vê se `lerFicha` falhar.
 */
async function relerFicha(tx: Tx, taskId: string): Promise<TaskDetail> {
  try {
    return await lerFicha(tx, taskId);
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

/* ───────────────────────────── concluir e arquivar ───────────────────────────── */

/**
 * A caixinha "Concluída" da ficha.
 *
 * `complete_task` faz mais do que carimbar a data: quando a tarefa está num
 * quadro, ela também move o status para o que FECHA. Sem isso a ficha e a coluna
 * discordariam — duas verdades sobre o mesmo fato, que é a dívida que este
 * projeto existe para não repetir.
 *
 * E desde a F44_6 ela move PELO `move_task`, como o arrasto do cartão para a
 * coluna que fecha: grava o evento no histórico e roda a automação da etapa
 * (reabrir: a da primeira que abre). A regra pode trocar quem cuida ou levar a
 * tarefa para outra lista — por isso a ficha que volta é a RELIDA.
 */
export async function setBoardTaskCompleted(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  concluida: boolean,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // Quem concluiu é quem está logado — sai da sessão, nunca do pedido.
    await setBoardTaskCompletedInTx(tx, taskId, concluida, actor.userId);
    return relerFicha(tx, taskId);
  });
}

/**
 * O MIOLO do concluir e do reabrir, no `Tx` de quem chama — F26.3.
 *
 * `autorId` VAI PARA `complete_task(p_by)`. A função confere o alcance de quem
 * AGE (`can_act_on_task`; desde a F44_6 ela é `security invoker` e passa também
 * pela política de `tasks`, como o arrasto), mas grava `completed_by` com o que
 * recebe, sem comparar com `acting_user_id()`. Por
 * isso o autor é parâmetro explícito de quem chama, e quem chama é código
 * confiável: a tela passa a pessoa logada; o agente (F26.5) passa o dono da
 * concessão. NUNCA um valor vindo do corpo do pedido — seria concluir em nome
 * de outra pessoa, e a ficha mostraria "concluída por" alguém que não clicou.
 *
 * Reabrir não tem autor: `uncomplete_task` limpa a conclusão, e `autorId` é
 * ignorado nesse caminho.
 *
 * Sem releitura aqui, pelo mesmo motivo de `patchBoardTaskInTx`.
 */
export async function setBoardTaskCompletedInTx(
  tx: Tx,
  taskId: string,
  concluida: boolean,
  autorId: string,
): Promise<void> {
  try {
    await (concluida
      ? tx`select ideworks.complete_task(${taskId}, ${autorId})`
      : tx`select ideworks.uncomplete_task(${taskId})`);
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    if ((erro as { constraint_name?: string }).constraint_name === 'tasks_parent_same_list_fk') {
      throw new BoardRefused(FRASE_SUBTAREFA_NAO_SAI_SOZINHA, 400);
    }
    traduzir(erro);
  }
}

/**
 * F44, Fase 8 — a regra da etapa ENCAMINHA para outra lista, e quem chegou é
 * uma SUBTAREFA: ela mora na lista da mãe (`tasks_parent_same_list_fk`) e não
 * vai sozinha. É a mesma recusa do arrasto do cartão dela para aquela coluna;
 * sem esta frase sairia o nome da restrição.
 */
export const FRASE_SUBTAREFA_NAO_SAI_SOZINHA =
  'A automação desta etapa leva a tarefa para outra lista, e a subtarefa mora na lista da mãe — ela não vai sozinha. Conclua a tarefa-mãe, ou peça a quem cuida do quadro para ajustar a automação. Nada foi mudado.';

export async function setBoardTaskArchived(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  arquivada: boolean,
): Promise<TaskDetail> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    await setBoardTaskArchivedInTx(tx, taskId, arquivada);
    return relerFicha(tx, taskId);
  });
}

/**
 * O MIOLO do arquivar e do desarquivar, no `Tx` de quem chama — F26.8.
 *
 * O desfazer em lote (`integrations/undo.ts`) arquiva a tarefa que a IA criou
 * DENTRO da transação do dono, junto com o carimbo no registro da integração:
 * chamar `setBoardTaskArchived` de lá abriria uma segunda transação, e a falha
 * ao carimbar deixaria a tarefa arquivada sem rastro do desfazer.
 *
 * Quem decide o alcance é `set_task_archived` (`can_act_on_task`, 'create'):
 * fora do alcance ela levanta 42501, e `traduzir` devolve `BoardRefused` 403.
 */
export async function setBoardTaskArchivedInTx(
  tx: Tx,
  taskId: string,
  arquivada: boolean,
): Promise<void> {
  try {
    await tx`select ideworks.set_task_archived(${taskId}, ${arquivada})`;
  } catch (erro) {
    if (erro instanceof BoardRefused) throw erro;
    traduzir(erro);
  }
}

/* ───────────────────────────── a etiqueta nasce aqui ───────────────────────────── */

/**
 * Criar etiqueta no espaço.
 *
 * POR QUE ISTO ENTRA NUMA ETAPA DE FICHA DE TAREFA
 *   Porque `task_tags` tem ZERO linhas. "Pôr etiqueta pela tela" com um catálogo
 *   vazio é um seletor sem opção nenhuma — a função existiria e não faria nada.
 *   O plano prevê isto em letras: "criar tarefa e etiqueta é justamente o que vai
 *   encher isso".
 *
 * A COR NÃO TEM FORMATO OBRIGATÓRIO, e é medição, não descuido: a etiqueta real
 * `stories` tem cor `#000`, de quatro caracteres. Um `check` de seis dígitos
 * recusaria uma etiqueta que existe. Ver a migration da F17.4.
 */
export async function createSpaceTag(
  sql: Sql,
  actor: AuthenticatedActor,
  spaceId: string,
  entrada: { name: string; bgColor: string | null; fgColor: string | null },
): Promise<BoardTag> {
  if (entrada.name.trim() === '') {
    throw new BoardRefused('A etiqueta precisa de um nome.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [criada] = await tx`
        insert into ideworks.task_tags (space_id, name, bg_color, fg_color, created_by)
        values (${spaceId}, ${entrada.name.trim()}, ${entrada.bgColor}, ${entrada.fgColor},
                ${actor.userId})
        returning id, name, bg_color, fg_color`;

      if (!criada) {
        throw new BoardRefused('Espaço não encontrado, ou fora do seu alcance.', 403);
      }
      return comoEtiqueta(criada as unknown as LinhaDeEtiqueta);
    } catch (erro) {
      if (erro instanceof BoardRefused) throw erro;
      traduzir(erro);
    }
  });
}
