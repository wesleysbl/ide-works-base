/**
 * A leitura do quadro — etapa F17.9a.
 *
 * TRÊS PERGUNTAS, E NENHUMA REGRA NOVA
 *   1. Que espaços, pastas e listas eu alcanço?      → view `ideworks.tree`
 *   2. Qual é a esteira desta lista, e o que há nela? → view `ideworks.list_workflow`
 *   3. Mover este cartão de coluna.                  → função `ideworks.move_task`
 *
 *   Nada aqui repete alcance. `tree`, `list_workflow` e `task_labels` são
 *   `security_invoker`, e `tasks` tem política própria: quem não alcança a lista
 *   simplesmente não recebe a linha. Escrever `where can_see_list(...)` aqui
 *   seria a dívida 8.1 outra vez — a regra em dois lugares, e o de cima ficando
 *   para trás na primeira mudança.
 *
 * A DESCRIÇÃO NÃO VEM JUNTO
 *   O quadro desenha um ÍCONE de "tem descrição". Trazer o briefing inteiro de
 *   cem tarefas para decidir se um ícone acende é o defeito que a F17.6 já
 *   nomeia. O booleano é calculado na consulta e a coluna `description` nunca
 *   sai do banco por aqui.
 *
 *   O irmão dele, "tem anexo", ENTROU NA F17.6 — e entrou pelo mesmo caminho:
 *   `task_progress.attachment_count > 0`, calculado no banco. A tabela agora
 *   existe, então o indicador diz a verdade em vez de um `false` fixo. O que
 *   atravessa a rede continua sendo NÚMERO: nome de arquivo e corpo de
 *   comentário não saem do banco por esta consulta.
 *
 * A DATA SAI COMO TEXTO, E NÃO COMO `Date`
 *   `due_on::text`, e não a conversão do driver. Uma das 18 tarefas reais tem
 *   prazo no ano 82025, e `Date.toISOString()` escreve ano expandido
 *   (`+082025-08-07`) — que todo `.slice(0, 10)` do projeto cortaria errado.
 *   Ver o cabeçalho de `@/board/board`.
 *
 * O NOME DO RESPONSÁVEL SAI DE `display_name()`
 *   Nunca de junção com `profiles`: aquela política mostra só o próprio perfil,
 *   e a junção devolveria VAZIO em silêncio — a tarefa de outra pessoa
 *   apareceria sem responsável, sem erro nenhum. Mesma armadilha documentada em
 *   `server/tasks.ts`.
 */

import type { EscolhaDeEtapa, OrigemDoMovimento } from '@/board/mudanca-de-lista';
import type { AutomacaoQueRodou } from '@/board/automacoes';
import {
  type Board,
  type BoardAssignee,
  type BoardAssigneeOption,
  type BoardHeader,
  type BoardStatus,
  type BoardTag,
  type BoardTask,
  CARTOES_POR_COLUNA,
  type Priority,
  type StatusType,
  type TreeRow,
} from '@/board/board';
import {
  ACENTOS_DE,
  ACENTOS_PARA,
  type FiltroDeTarefas,
  SEM_FILTRO,
  paraConsulta,
} from '@/board/filtro';
import { clienteDaTarefaSql } from '@/server/cliente-da-tarefa';
import { type Sql, type Tx, inlineUuid, inlineUuidList, withActor } from '@/server/db';
import { estaOmitida, recorteAtivo, recorteDasOmitidas } from '@/server/omitidas';
import { emPortugues } from '@/server/recusas';
import { FRASE_TIPO_OBRIGATORIO, OPCOES_DO_TIPO, comoTipoLido, listaEhDeProducao } from '@/server/tipo-da-tarefa';
import { lerResponsaveisDoQuadro } from '@/server/responsaveis-do-quadro';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/**
 * A recusa do quadro, com o código que a tela devolve.
 *
 * OS TRÊS CÓDIGOS NOVOS SÃO DA F17.6, e cada um diz uma coisa diferente:
 *   `409` — o balde já tem um objeto naquele caminho. Com um sorteio no
 *           caminho isso é praticamente impossível, e é justamente por isso
 *           que significa outra coisa e tem que falhar alto.
 *   `502` — o Storage respondeu, e respondeu errado. A falha é de LÁ, não de
 *           quem clicou nem do banco, e o log precisa poder separar as duas.
 *   `503` — a chave de serviço não está definida. O serviço não está
 *           CONFIGURADO, que não é a mesma coisa que estar quebrado: um `500`
 *           mandaria alguém procurar defeito no código em vez de definir uma
 *           variável.
 *
 * A lista é fechada de propósito. Um `number` solto aqui deixaria passar `200`
 * numa recusa — e já aconteceu, em outro projeto, de uma recusa sair com `201`.
 */
export class BoardRefused extends Error {
  readonly status: 400 | 403 | 404 | 409 | 502 | 503;

  constructor(message: string, status: 400 | 403 | 404 | 409 | 502 | 503) {
    super(message);
    this.name = 'BoardRefused';
    this.status = status;
  }
}

/** Conflito resolvível pela pessoa; nenhuma escrita ocorreu. */
export class MoveNeedsStatus extends BoardRefused {
  constructor(readonly escolhaDeEtapa: EscolhaDeEtapa, message = 'Escolha a etapa de destino antes de mover.') {
    super(message, 409);
  }
}

/**
 * F40, Fase 2 — tarefa de lista de PRODUÇÃO sem tipo.
 *
 * O corpo da resposta HTTP leva `code: 'type_required'` e as quatro `options`
 * (ver `worker/index.ts`), para a tela e o agente montarem o seletor sem
 * adivinhar. Status 400, como `client_required`: nenhuma escrita ocorreu e a
 * pessoa resolve escolhendo o tipo (não é conflito de estado, como o 409 da
 * etapa).
 */
export class TypeRequired extends BoardRefused {
  readonly code = 'type_required' as const;
  readonly options = OPCOES_DO_TIPO;

  constructor(message: string = FRASE_TIPO_OBRIGATORIO) {
    super(message, 400);
    this.name = 'TypeRequired';
  }
}

/**
 * Rede de segurança: o gatilho `tasks_demand_type_guard` (SQLSTATE `IW040`,
 * hint `type_required`) vira a MESMA recusa que o servidor dá antes do banco.
 * Cobre qualquer porta que escape da validação prévia, inclusive a automação
 * de status dentro de `move_task`.
 */
export function tipoObrigatorioDoBanco(erro: unknown): TypeRequired | null {
  const e = erro as { code?: string; hint?: string } | null;
  return e && (e.code === 'IW040' || e.hint === 'type_required') ? new TypeRequired() : null;
}

/**
 * A frase que a tela mostra quando o banco recusa.
 *
 * OS CÓDIGOS SÃO OS QUE AS DEZ TRAVAS DA F17 USAM, e a mensagem delas é longa
 * de propósito: ela nomeia o que está no caminho e o que fazer. Reescrever aqui
 * para "algo deu errado" jogaria fora exatamente o trabalho que o banco fez.
 */
function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string };
  const frase = emPortugues(e.message);

  // F40: o gatilho do tipo (`IW040`) vira `type_required`, com as opções.
  const tipo = tipoObrigatorioDoBanco(erro);
  if (tipo) throw tipo;

  // Política de linha, ou a recusa explícita de `move_task`.
  if (e.code === '42501') throw new BoardRefused(frase || 'Fora do seu alcance.', 403);
  // `22023` — argumento inválido: lista sem esteira, esteira sem status que abre.
  if (e.code === '22023') throw new BoardRefused(frase || 'Movimento recusado.', 400);
  // `23514` — o guarda do status: o status não pertence à esteira da lista.
  if (e.code === '23514') throw new BoardRefused(frase || 'Movimento recusado.', 400);

  throw erro;
}

const comoInstante = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

/** O driver devolve `count(*)` como string quando não se pede `::int`. Rede de cima. */
export const comoNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/* ───────────────────────────── a árvore ───────────────────────────── */

/**
 * Espaços, pastas e listas que a pessoa alcança, com a contagem de tarefas.
 *
 * `is_live` já é a corrente inteira sem arquivamento — espaço arquivado tira a
 * lista da árvore sem carimbar a lista, que é a regra 1 do roteiro. Refazer essa
 * conta aqui é o jeito de fazê-la diferente.
 *
 * "TAREFA VIVA" É A NÃO ARQUIVADA E NÃO CONCLUÍDA, e as duas condições são do
 * banco: `task_status_guard` mantém `completed_at` e "estar no status que fecha"
 * como a mesma coisa, nos dois sentidos. Então contar por `completed_at` conta
 * por coluna, sem a tela precisar saber o que é um status de tipo `closed`.
 */
export async function readTree(sql: Sql, actor: AuthenticatedActor): Promise<TreeRow[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      select t.space_id, t.space_name, t.space_color, t.space_sort_order,
             t.category_id, c.name as category_name,
             t.folder_id, t.folder_name, t.folder_sort_order,
             t.list_id, t.list_name, t.list_sort_order,
             (select count(*)::int
                from ideworks.tasks k
               where k.list_id = t.list_id
                 and k.archived_at is null
                 and k.completed_at is null) as live_tasks,
             (select count(*)::int
                from ideworks.tasks k
               where k.list_id = t.list_id
                 and k.archived_at is null) as total_tasks
        from ideworks.tree t
        left join ideworks.client_categories c on c.id = t.category_id
       where t.is_live
         -- F31: espaço de empresa omitida não entra na barra lateral.
         ${recorteDasOmitidas(tx, actor, (ids) => tx`and t.category_id <> all(${inlineUuidList(tx, ids)}::uuid[])`)}
       order by c.name nulls last, t.space_sort_order, t.space_name,
                t.folder_sort_order nulls first, t.folder_name,
                t.list_sort_order, t.list_name`;

    return linhas.map((r) => ({
      spaceId: r.space_id as string,
      spaceName: r.space_name as string,
      spaceColor: (r.space_color as string | null) ?? null,
      spaceSortOrder: comoNumero(r.space_sort_order),
      categoryId: (r.category_id as string | null) ?? null,
      categoryName: (r.category_name as string | null) ?? null,
      folderId: (r.folder_id as string | null) ?? null,
      folderName: (r.folder_name as string | null) ?? null,
      folderSortOrder: r.folder_sort_order === null ? null : comoNumero(r.folder_sort_order),
      listId: r.list_id as string,
      listName: r.list_name as string,
      listSortOrder: comoNumero(r.list_sort_order),
      liveTasks: comoNumero(r.live_tasks),
      totalTasks: comoNumero(r.total_tasks),
    }));
  });
}

/* ───────────────────────────── o quadro de uma lista ───────────────────────────── */

type LinhaDeEtiqueta = { id: string; name: string; bg_color: string | null; fg_color: string | null };

/**
 * A LINHA DO BANCO VIRANDO CARTÃO — extraído na F17.64.
 *
 * ⚠️ EXPORTADO PORQUE HÁ DOIS QUADROS AGORA. `readFolderBoard`
 * (`@/server/board-pasta`) traz as MESMAS colunas — ele só troca o `where` da
 * lista pelo da pasta e a partição da janela. Copiar estas trinta atribuições
 * daria dois cartões que divergiriam na primeira etapa que mexesse num só: o
 * quadro da lista ganharia o campo personalizado da F17.5 e o da pasta não,
 * sem ninguém perceber. É a mesma razão pela qual `CorpoDoCartao` saiu de
 * `pages/Quadro.tsx` na F17.18.
 *
 * `Record<string, unknown>` e não um tipo de linha: quem garante que as colunas
 * existem é a consulta, e escrever a forma delas aqui seria uma terceira
 * declaração do mesmo fato — a consulta, o tipo e o `BoardTask`.
 */
export function paraCartao(r: Record<string, unknown>): BoardTask {
  return {
    id: r.id as string,
    title: r.title as string,
    statusId: (r.status_id as string | null) ?? null,
    priority: (r.priority as Priority | null) ?? null,
    dueOn: (r.due_on as string | null) ?? null,
    startOn: (r.start_on as string | null) ?? null,
    completedAt: comoInstante(r.completed_at),
    hasDescription: r.has_description === true,
    clientId: (r.client_id as string | null) ?? null,
    // Nulo quando a tarefa não tem cliente E quando o cliente está fora da
    // carteira de quem olha — a política de `clients` decide, e a junção à
    // esquerda deixa a tarefa aparecer de qualquer jeito. Esconder a tarefa
    // por causa do cliente esconderia trabalho.
    clientName: (r.client_name as string | null) ?? null,
    assignees: (r.assignees as BoardAssignee[]) ?? [],
    tags: ((r.tags as LinhaDeEtiqueta[]) ?? []).map(
      (g) =>
        ({
          id: g.id,
          name: g.name,
          bgColor: g.bg_color ?? null,
          fgColor: g.fg_color ?? null,
        }) satisfies BoardTag,
    ),
    taskTypeName: (r.task_type_name as string | null) ?? null,
    type: comoTipoLido(r.demand_type),
    parentId: (r.parent_id as string | null) ?? null,
    parentTitle: (r.parent_title as string | null) ?? null,
    subtaskCount: comoNumero(r.subtask_count),
    checklistDone: comoNumero(r.checklist_done),
    checklistTotal: comoNumero(r.checklist_total),
    hasAttachment: comoNumero(r.attachment_count) > 0,
    commentCount: comoNumero(r.comment_count),
    previewAttachmentId: (r.preview_attachment_id as string | null) ?? null,
    previewCount: comoNumero(r.preview_count),
  };
}

/** O teto do teto. Pedir dez mil por coluna é pedir a lentidão de volta. */
export const CARTOES_POR_COLUNA_MAX = 2000;

/**
 * A CONTAGEM DE UMA COLUNA — F17.55.
 *
 * O par de números que a coluna mostra. Vem do banco como `jsonb`, e não como
 * duas colunas de linha, porque ele é sobre a LISTA e não sobre a tarefa: ver o
 * porquê na consulta.
 */
export type ContagemDaColuna = { total: number; matched: number };

/** A chave que a contagem usa para as tarefas sem status. Ver `orphanTasks`. */
export const SEM_COLUNA = 'sem-coluna';

export async function readBoard(
  sql: Sql,
  actor: AuthenticatedActor,
  listId: string,
  /** Quantos cartões trazer POR COLUNA. Ver `CARTOES_POR_COLUNA`. */
  porColuna: number = CARTOES_POR_COLUNA,
  /** A busca por título e o responsável — F17.55. */
  filtro: FiltroDeTarefas = SEM_FILTRO,
): Promise<Board> {
  // Um teto quebrado não pode virar uma consulta sem teto: o pior valor
  // possível aqui é o que devolve a lentidão que esta etapa veio tirar.
  const teto = Number.isFinite(porColuna)
    ? Math.min(Math.max(Math.trunc(porColuna), 1), CARTOES_POR_COLUNA_MAX)
    : CARTOES_POR_COLUNA;
  return withActor(sql, asDbActor(actor), async (tx) => {
    // PERF DO SERVIDOR, 08/10/2026 — O QUADRO SAI EM CINCO IDAS, E NÃO EM 15
    //
    //   Eram sete consultas em fila, quase todas com o id da lista como
    //   parâmetro (duas idas cada, com `prepare: false`). O id vai agora no
    //   TEXTO (`inlineUuid`) e as consultas independentes saem juntas: a lista e
    //   a esteira primeiro; depois a produção, os responsáveis e as etiquetas
    //   junto com a consulta dos cartões — esta ÚLTIMA de propósito, porque ela
    //   leva parâmetros (busca, responsável) e o driver não deixa nada passar na
    //   frente de uma consulta que precisa descobrir os tipos. Todas são
    //   leituras; a ordem em que o Postgres as executa só importa para a
    //   política de linha, que é a mesma em todas.
    const idDaLista = inlineUuid(tx, listId);

    // 1. A lista e a trilha até ela. Sai da MESMA view da barra lateral, para as
    //    duas não discordarem sobre o nome ou sobre estar viva.
    //
    // 2. A esteira resolvida — lista → pasta → espaço, decidida pelo banco. Vai
    //    na mesma ida que a lista; se a lista não existe a esteira volta vazia e
    //    a recusa abaixo é a de sempre.
    const [[lista], esteira] = await Promise.all([
      tx`
      select t.list_id, t.list_name, t.list_content,
             t.folder_id, t.folder_name,
             t.space_id, t.space_name, t.is_live,
             c.name as category_name,
             -- F38, Fase 7: o cliente da lista e a marca "exige cliente", para
             -- o formulário de tarefa nova. O nome passa pela política de
             -- clients: quem não alcança o cliente lê nulo.
             l.client_id as list_client_id, cl.name as list_client_name,
             coalesce(l.requires_client, false) as requires_client
        from ideworks.tree t
        left join ideworks.client_categories c on c.id = t.category_id
        left join ideworks.lists l on l.id = t.list_id
        left join ideworks.clients cl on cl.id = l.client_id
       where t.list_id = ${idDaLista}`,
      tx`
      select lw.status_set_name, lw.inherited_from,
             lw.status_id, lw.status_name, lw.status_type,
             lw.status_color, lw.status_sort_order
        from ideworks.list_workflow lw
       where lw.list_id = ${idDaLista}
       order by lw.status_sort_order, lw.status_name`,
    ]);

    // Fora do alcance e inexistente respondem igual, de propósito: distinguir os
    // dois contaria que a lista existe para quem não pode vê-la.
    if (!lista) {
      throw new BoardRefused('Lista não encontrada, ou fora do seu alcance.', 404);
    }

    if (esteira.length === 0) {
      // A mesma frase que `move_task` e `task_status_guard` usam. Uma lista sem
      // esteira não tem coluna nenhuma, e isso é um estado que se conserta
      // criando o conjunto de status — não recarregando a página.
      throw new BoardRefused(
        'Esta lista não tem esteira: nem ela, nem a pasta dela, nem o espaço declaram um conjunto de status. Sem esteira o quadro não tem coluna nenhuma.',
        400,
      );
    }

    // 3. Os cartões. Uma consulta só, com responsáveis e etiquetas agregados —
    //    buscar tarefa a tarefa daria N+1 idas ao banco numa tela que lista
    //    dezenas.
    //
    //    ⚠️ A JANELA `janela` VEM PRIMEIRO, E DE PROPÓSITO. Ela lê só o que a
    //    ordenação precisa (`id`, `status_id`, `priority`, `due_on`, `title`),
    //    então paga a política de acesso UMA vez por tarefa da lista — o que é
    //    inevitável, porque contar quantas há na coluna exige olhar todas. Já
    //    as junções caras (responsáveis, etiquetas, passos, anexos) só tocam as
    //    que entraram na janela. Ver `CARTOES_POR_COLUNA`.
    //
    // ─────────────────────────────────────────────────────────────────────────
    // O FILTRO ENTRA AQUI DENTRO, E ESSE É O PONTO DA F17.55
    //
    //   `marcada` é a UNICA varredura da lista, e ela faz tres coisas de uma
    //   vez: paga a politica de acesso linha a linha, decide se a linha bate
    //   com o filtro (`bate`), e alimenta as duas contagens. Filtrar depois, em
    //   JavaScript, obrigaria o banco a mandar para ca o que a pessoa nao
    //   alcanca so para o servidor descartar — e a peneira de acesso passaria a
    //   depender de codigo nosso em vez da politica. Ver `@/board/filtro`.
    //
    //   Medido em 2026-09-02 na `ATENDIMENTO` (1.070 tarefas), como
    //   `ideworks_app` pelo pooler, tres corridas cada:
    //
    //     · consulta de hoje (F17.50), sem filtro ......... 2,50 / 2,35 / 2,33 s
    //     · esta consulta, sem filtro ..................... 2,44 / 2,35 / 2,33 s
    //     · esta consulta, buscando `sabor` ............... 2,03 / 2,00 / 2,01 s
    //     · esta consulta, `sem responsavel` .............. 2,83 / 2,82 / 2,77 s
    //
    //   O piso e 1,77 s: e o que custa CONTAR as 1.070 sob a politica, sem
    //   trazer cartao nenhum. Buscar por texto sai mais barato do que nao
    //   buscar, porque o preco e por cartao carregado (F17.50) e a busca
    //   carrega menos. `sem responsavel` custa ~0,45 s a mais, e esse e o preco
    //   de olhar `task_assignees` uma vez por tarefa da lista — que so se paga
    //   quando alguem escolhe essa peneira.
    //
    //   ⚠️ AFROUXAR A POLITICA COMPRARIA O PISO DE VOLTA, e a F17.50 ja
    //   recusou esse negocio por escrito: velocidade por vazamento nao e troca.
    // ─────────────────────────────────────────────────────────────────────────
    //
    // A CONTAGEM VEM COMO `jsonb`, IGUAL EM TODA LINHA, E ISSO E DE PROPOSITO
    //   Ela e um fato sobre a LISTA, e nao sobre a tarefa. Repeti-la em cada
    //   linha custa quatro pares de inteiros por cartao; a alternativa —
    //   contar numa segunda consulta — custaria uma segunda varredura da lista
    //   inteira sob politica, medida em 1,83 s. Ou seja: o desperdicio obvio e
    //   mil vezes mais barato que a arrumacao elegante.
    //
    //   ⚠️ E ela precisa cobrir a coluna que o filtro ZEROU. Uma coluna com
    //   nenhum achado nao devolve linha, e sem `contagem` ela nao teria como
    //   dizer `0 de 1.050` — diria `0`, que e a mesma mentira de sinal
    //   trocado que a F17.50 tirou do cabecalho.
    const consulta = paraConsulta(filtro);
    const consultaDosCartoes = tx`
      with marcada as (
        select k.id, k.status_id, k.priority, k.due_on, k.title,
               (
                 (${consulta.texto}::text is null
                  or position(
                       ${consulta.texto}::text
                       in translate(lower(k.title), ${ACENTOS_DE}, ${ACENTOS_PARA})
                     ) > 0)
                 and (not ${consulta.semResponsavel}::boolean
                      or not exists (select 1 from ideworks.task_assignees a
                                      where a.task_id = k.id))
                 and (${consulta.responsavel}::uuid is null
                      or exists (select 1 from ideworks.task_assignees a
                                  where a.task_id = k.id
                                    and a.user_id = ${consulta.responsavel}::uuid))
               ) as bate
          from ideworks.tasks k
         where k.list_id = ${listId}
           and k.archived_at is null
      ), contagem as (
        select coalesce(
                 jsonb_object_agg(
                   coalesce(status_id::text, ${SEM_COLUNA}),
                   jsonb_build_object('total', total, 'matched', achadas)
                 ),
                 '{}'::jsonb
               ) as mapa
          from (select status_id,
                       count(*)::int                       as total,
                       count(*) filter (where bate)::int   as achadas
                  from marcada
                 group by status_id) por_coluna
      ), janela as (
        select id, bate,
               row_number() over (
                 partition by status_id, bate
                 order by priority nulls last, due_on nulls last, lower(title)
               ) as posicao
          from marcada
      )
      select t.id, t.title, t.status_id, t.priority,
             (select mapa from contagem) as mapa,
             t.due_on::text   as due_on,
             t.start_on::text as start_on,
             t.completed_at,
             (t.description is not null and btrim(t.description) <> '') as has_description,
             -- F38, Fase 6: o cliente da tarefa, e na falta dele o da lista.
             ${clienteDaTarefaSql(tx)} as client_id, cl.name as client_name,
             tl.task_type_name,
             t.demand_type::text as demand_type,
             -- Os passos (F17.15). A contagem sai de task_progress, que e a
             -- UNICA definicao dela no projeto: cartao, linha e ficha leem da
             -- mesma view, senao diriam numeros diferentes sobre o mesmo fato.
             t.parent_id,
             pai.title as parent_title,
             coalesce(tp.subtask_count, 0)   as subtask_count,
             coalesce(tp.checklist_done, 0)  as checklist_done,
             coalesce(tp.checklist_total, 0) as checklist_total,
             -- F17.6 — "tem anexo", enfim. Ele vem da MESMA view, entao nao
             -- custa juncao nenhuma a mais, e o que atravessa e NUMERO: nenhum
             -- nome de arquivo e nenhum corpo de comentario sai do banco por
             -- aqui.
             coalesce(tp.attachment_count, 0) as attachment_count,
             coalesce(tp.comment_count, 0)    as comment_count,
             coalesce(tl.tags, '[]'::jsonb) as tags,
             coalesce(
               (select json_agg(json_build_object(
                          'id', a.user_id,
                          'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                        order by ideworks.display_name(a.user_id))
                  from ideworks.task_assignees a
                 where a.task_id = t.id),
               '[]'::json
             ) as assignees,
             -- F17.56 — a miniatura do cartao. Sai ID e CONTAGEM, nada mais:
             -- nem caminho no balde, nem nome de arquivo, nem endereco. O que
             -- vira imagem passa por sign_attachments, que pergunta a
             -- politica de novo.
             img.attachment_id            as preview_attachment_id,
             coalesce(img.image_count, 0) as preview_count
        from ideworks.tasks t
        join janela j on j.id = t.id and j.bate and j.posicao <= ${teto}
        left join ideworks.task_labels tl on tl.task_id = t.id
        left join ideworks.clients cl on cl.id = ${clienteDaTarefaSql(tx)}
        left join ideworks.task_progress tp on tp.task_id = t.id
        -- A PRIMEIRA imagem, pela ordem em que foi anexada, e quantas ha.
        --
        -- LATERAL, E SO SOBRE A JANELA: ele entra depois da juncao que ja
        -- cortou a lista nos 50 por coluna, entao o indice task_attachments_task_idx
        -- e sondado uma vez por cartao MOSTRADO — e nao uma vez por tarefa da
        -- lista. Para a tarefa sem anexo o indice devolve zero linhas, e a
        -- politica (can_reach_task_id, 0,65 ms por linha na F17.50) nao chega
        -- a ser avaliada.
        --
        -- Medido em 2026-09-02, como ideworks_app pelo pooler, tres corridas:
        --   ATENDIMENTO sem filtro (70 cartoes) ... 2,37/2,37/2,40 s -> 2,40/2,42/2,41 s
        --   ATENDIMENTO buscando "sabor doce" ..... 2,07/2,09/2,11 s -> 2,11/2,13/2,13 s
        --   Sabor Doce (13 cartoes) ............... 0,25/0,25/0,25 s -> 0,27/0,27/0,27 s
        -- Ou seja: cerca de 20 a 45 ms, ~1% do que a tela ja custava.
        --
        -- "order by created_at, id" e nao created_at sozinho: duas artes
        -- anexadas no mesmo instante empatariam, e o cartao mostraria uma hoje
        -- e outra amanha sobre a mesma tarefa.
        -- (Sem crase neste comentario: ele vive dentro de um template literal.)
        left join lateral (
          select (array_agg(a.id order by
                   (position('attachment:' || a.id::text in coalesce(t.description, '')) > 0) desc,
                   nullif(position('attachment:' || a.id::text in coalesce(t.description, '')), 0),
                   a.created_at, a.id))[1] as attachment_id,
                 count(*)::int                                    as image_count
            from ideworks.task_attachments a
           where a.task_id = t.id
             and a.content_type like 'image/%'
             and (a.expires_at is null or a.expires_at > now())
             and (a.expires_at is null or position('attachment:' || a.id::text in coalesce(t.description, '')) > 0)
        ) img on true
        -- A mae pelo id, e nao pela politica: ela mora na MESMA lista
        -- (tasks_parent_same_list_fk), entao quem le o cartao da filha le o da
        -- mae. A juncao a esquerda existe so porque a maioria nao tem mae.
        left join ideworks.tasks pai on pai.id = t.parent_id
       -- ATENCAO: sem repetir list_id e archived_at aqui. A janela ja filtrou
       -- os dois, e repeti-los fazia o planejador varrer a lista inteira de
       -- novo: 1.070 avaliacoes de politica a mais. Com a juncao sozinha, ele
       -- entra pelas escolhidas e busca cada uma por id.
       -- (Sem crase neste comentario: ele vive dentro de um template literal.)
       order by t.priority nulls last, t.due_on nulls last, lower(t.title)`;

    // A SEGUNDA LEVA: o que não depende dos cartões sai junto com eles. A dos
    // cartões vai por último (ver o começo desta função).
    const [isProduction, responsaveis, etiquetasDoEspaco, tarefas] = await Promise.all([
      // F40, Fase 4: uma consulta por carregamento do quadro (não por card),
      // para a tela saber se o tipo é obrigatório ao criar.
      listaEhDeProducao(tx, listId),

      /* QUEM O MENU `Filtrar por responsável` OFERECE — F17.55, refeito na F17.70.

         ⚠️ ATÉ A F17.68 A LISTA SAÍA SÓ DE `task_assignees`, e por isso ela
         escondia as dez pessoas que não têm tarefa nenhuma — o dono do sistema
         incluído. Agora ela é a união de "quem eu alcanço" com "quem já é
         responsável aqui". A razão de cada metade, por que a regra de empresa é
         emprestada e não reescrita, e por que o número não obedece à busca estão
         todos em `@/server/responsaveis-do-quadro`.

         `comDono` é o total de tarefas COM alguém; `unassignedTasks` é o resto.
         Contar as sem dono direto na tabela de tarefas seria uma terceira
         varredura da lista inteira sob política. */
      lerResponsaveisDoQuadro(
        tx,
        tx`
        select distinct a.task_id, a.user_id
          from ideworks.task_assignees a
          join ideworks.tasks k on k.id = a.task_id
         where k.list_id = ${idDaLista}
           and k.archived_at is null`,
      ),

      // O vocabulário do espaço — F17.10. O quadro não o desenha; o formulário de
      // tarefa nova, que abre de dentro dele, precisa dele. Uma consulta a mais
      // aqui evita uma ida inteira ao servidor a cada clique em "Nova tarefa".
      tx`
      select g.id, g.name, g.bg_color, g.fg_color
        from ideworks.task_tags g
       where g.space_id = ${inlineUuid(tx, lista.space_id as string)}
       order by lower(btrim(g.name))`,

      consultaDosCartoes,
    ]);

    const header: BoardHeader = {
      listId: lista.list_id as string,
      listName: lista.list_name as string,
      listContent: (lista.list_content as string | null) ?? null,
      folderId: (lista.folder_id as string | null) ?? null,
      folderName: (lista.folder_name as string | null) ?? null,
      spaceId: lista.space_id as string,
      spaceName: lista.space_name as string,
      categoryName: (lista.category_name as string | null) ?? null,
      statusSetName: esteira[0].status_set_name as string,
      inheritedFrom: esteira[0].inherited_from as BoardHeader['inheritedFrom'],
      clientId: (lista.list_client_id as string | null) ?? null,
      clientName: (lista.list_client_name as string | null) ?? null,
      requiresClient: lista.requires_client === true,
      isProduction,
    };

    const statuses: BoardStatus[] = esteira.map((r) => ({
      id: r.status_id as string,
      name: r.status_name as string,
      type: r.status_type as StatusType,
      color: (r.status_color as string | null) ?? null,
      sortOrder: comoNumero(r.status_sort_order),
    }));

    // A MESMA construção que o quadro da pasta usa — ver `paraCartao`.
    const tasks: BoardTask[] = tarefas.map((r) => paraCartao(r as Record<string, unknown>));

    /* QUANTAS HÁ DE VERDADE EM CADA COLUNA — F17.50 —, E QUANTAS PASSARAM PELO
       FILTRO — F17.55.

       Os dois números vêm da mesma varredura, que contou TODAS as tarefas da
       lista antes de cortar. São eles que o cabeçalho da coluna mostra: contar
       os cartões que chegaram faria a tela dizer `50` sobre uma coluna de
       1.049, e dizer só o filtrado esconderia de onde ele saiu.

       ⚠️ O `mapa` é igual em toda linha; quando nenhuma linha volta — busca que
       não achou nada —, ele não volta, e a contagem é buscada à parte. É a
       única consulta a mais desta etapa, ela só acontece nesse caso, e é
       exatamente o caso em que a tela precisa poder dizer `0 de 1.070` em vez
       de um vazio sem explicação. */
    const mapaCru = (tarefas[0]?.mapa as Record<string, ContagemDaColuna> | undefined) ??
      (await contarSemAchado(tx, listId, consulta));

    const columnTotals: Record<string, number> = {};
    const columnMatched: Record<string, number> = {};
    for (const [chave, par] of Object.entries(mapaCru)) {
      if (chave === SEM_COLUNA) continue;
      columnTotals[chave] = comoNumero(par?.total);
      columnMatched[chave] = comoNumero(par?.matched);
    }

    const assigneeOptions: BoardAssigneeOption[] = responsaveis.opcoes;

    const naLista = Object.values(mapaCru).reduce((s, par) => s + comoNumero(par?.total), 0);
    const comDono = responsaveis.comDono;
    // Nunca negativo: as duas contas vêm de consultas diferentes, e uma escrita
    // entre elas faria a subtração passar do zero por baixo.
    const unassignedTasks = Math.max(naLista - comDono, 0);

    const availableTags: BoardTag[] = etiquetasDoEspaco.map((g) => ({
      id: g.id as string,
      name: g.name as string,
      bgColor: (g.bg_color as string | null) ?? null,
      fgColor: (g.fg_color as string | null) ?? null,
    }));

    return {
      header,
      statuses,
      tasks,
      availableTags,
      columnTotals,
      columnMatched,
      perColumn: teto,
      assigneeOptions,
      unassignedTasks,
      // O filtro que de fato foi aplicado, e não o que foi pedido: `paraConsulta`
      // apara o texto e recusa identificador torto, e a tela precisa falar do
      // que aconteceu. Ver o campo `filter` em `@/board/board`.
      filter: filtro,
    };
  });
}

/**
 * A contagem quando a busca não achou nada.
 *
 * Ver o comentário em `readBoard`: o mapa viaja em cada linha, e sem linha
 * nenhuma ele não viaja. Esta consulta repete a MESMA condição, porque a
 * pergunta é a mesma — "quantas há, e quantas bateram" —, e a resposta certa
 * para uma busca sem resultado é `0 de 1.070`, não um vazio calado.
 */
async function contarSemAchado(
  tx: Tx,
  listId: string,
  consulta: ReturnType<typeof paraConsulta>,
): Promise<Record<string, ContagemDaColuna>> {
  const linhas = await tx`
    select coalesce(k.status_id::text, ${SEM_COLUNA}) as chave,
           count(*)::int as total,
           count(*) filter (
             where (${consulta.texto}::text is null
                    or position(
                         ${consulta.texto}::text
                         in translate(lower(k.title), ${ACENTOS_DE}, ${ACENTOS_PARA})
                       ) > 0)
               and (not ${consulta.semResponsavel}::boolean
                    or not exists (select 1 from ideworks.task_assignees a
                                    where a.task_id = k.id))
               and (${consulta.responsavel}::uuid is null
                    or exists (select 1 from ideworks.task_assignees a
                                where a.task_id = k.id
                                  and a.user_id = ${consulta.responsavel}::uuid))
           )::int as achadas
      from ideworks.tasks k
     where k.list_id = ${listId}
       and k.archived_at is null
     group by 1`;

  const mapa: Record<string, ContagemDaColuna> = {};
  for (const r of linhas) {
    mapa[r.chave as string] = { total: comoNumero(r.total), matched: comoNumero(r.achadas) };
  }
  return mapa;
}

/* ───────────────────────────── mover o cartão ───────────────────────────── */

export type MoveResult = {
  taskId: string;
  listId: string;
  statusId: string;
  previousStatusId: string | null;
  /** Verdadeiro quando o banco pôs a tarefa em coluna diferente da pedida. */
  statusRepositioned: boolean;
  /**
   * Quantas subtarefas foram JUNTO — F17.15.
   *
   * `move_task` move a subárvore inteira na mesma escrita, porque mover só a
   * mãe seria recusado pela cascata da chave estrangeira batendo no guarda do
   * status. Mover cinco subtarefas sem dizer nada seria um efeito colateral
   * invisível, e por isso o número volta e a tela o mostra.
   */
  subtasksMoved: number;
  /**
   * A automação da etapa de chegada, quando havia uma — F17.41.
   *
   * Nula em toda mudança de etapa que não tem regra configurada, que é a
   * esmagadora maioria. Vem preenchida para a tela poder DIZER que a tarefa se
   * mexeu sozinha: sem isso o cartão sai da coluna debaixo do dedo de quem
   * arrastou, e nada explica por quê.
   */
  automation: AutomacaoQueRodou | null;
};

/**
 * Miolo transacional de `moveTaskOnBoard` — F16.6b.
 *
 * Recebe um `Tx` JÁ ABERTO. Não chama `withActor` nem `sql.begin`. Esteira,
 * equivalência, `MoveNeedsStatus`, subtarefas e automação continuam iguais:
 * a decisão ainda é do banco (`ideworks.move_task`), não deste arquivo.
 *
 * GANCHO F16.8 — mesmo `Tx` do ledger:
 *   o store SQL de `runAgentWrite` abre UMA `withActor` (Actor com
 *   `integration`) e põe esse `Tx` em `AgentWriteTx.sqlTx`. Dentro de
 *   `mutate`, chamar esta função — nunca o wrapper `moveTaskOnBoard`, que
 *   abriria um segundo `begin` fora do registro de execução.
 *
 *   HTTP/MCP `move_task` ainda NÃO está ligado nesta etapa.
 *
 * A interface humana não muda: `moveTaskOnBoard` continua sendo `withActor`
 * + este miolo, mesmos erros (`BoardRefused`, `MoveNeedsStatus`).
 */
export async function moveTaskOnBoardInTx(
  tx: Tx,
  taskId: string,
  listId: string,
  statusId: string | null,
  origem?: OrigemDoMovimento,
): Promise<MoveResult> {
  try {
    // A ficha fica bloqueada apenas durante ESTA transação, nunca enquanto
    // a janela está aberta. Confirmar relê o estado e confere o que foi visto.
    const [task] = await tx`
      select t.list_id, t.status_id, t.title, t.demand_type::text as demand_type, t.parent_id
        from ideworks.tasks t where t.id = ${taskId} for update`;
    if (!task) throw new BoardRefused('Tarefa não encontrada ou fora do seu alcance.', 403);
    // F40: entrar em lista de PRODUÇÃO vindo de fora dela, sem tipo, é recusado
    // ANTES de `move_task` (mesma regra do gatilho `tasks_demand_type_guard`).
    // Subtarefa e quem já tem tipo passam reto; a consulta só roda se mudar de lista.
    if (task.demand_type == null && task.parent_id == null && task.list_id !== listId) {
      if (
        (await listaEhDeProducao(tx, listId)) &&
        (task.list_id == null || !(await listaEhDeProducao(tx, task.list_id as string)))
      ) {
        throw new TypeRequired();
      }
    }
    const changed = origem !== undefined &&
      (origem.listId !== task.list_id || origem.statusId !== task.status_id);
    let chosen = statusId;
    if ((statusId === null && task.list_id !== listId) || changed || origem !== undefined) {
      // Lista e etapas são filtradas pelas políticas do ator. A correspondência
      // usa o nome normalizado da esteira, como a regra de movimento do banco.
      const options = await tx`
        select l.name as list_name, s.id, s.name, s.color,
               coalesce(lower(btrim(s.name)) = lower(btrim(old.name)), false) as equivalent,
               old.name as old_name, old.color as old_color
          from ideworks.lists l
          join ideworks.statuses s on s.status_set_id = ideworks.resolve_status_set(l.id)
          left join ideworks.statuses old on old.id = ${task.status_id}
         where l.id = ${listId}
         order by s.sort_order, s.name, s.id`;
      if (options.length === 0) {
        throw new BoardRefused('A lista de destino está indisponível ou não tem etapas.', 400);
      }
      const equivalent = options.find(s => s.equivalent === true);
      if (changed || (statusId === null && !equivalent) ||
          (statusId !== null && !options.some(s => s.id === statusId))) {
        throw new MoveNeedsStatus({
          taskId, taskTitle: String(task.title), listId, listName: String(options[0].list_name),
          origem: { listId: task.list_id as string | null, statusId: task.status_id as string | null },
          etapaAtual: { name: String(options[0].old_name ?? 'Sem etapa'), color: options[0].old_color as string | null },
          etapas: options.map(s => ({ id: String(s.id), name: String(s.name), color: s.color as string | null })),
        }, changed ? 'A tarefa mudou enquanto a janela estava aberta. Confira a etapa atual e confirme novamente.' : undefined);
      }
      // Envia o ID equivalente explicitamente. Se a esteira mudar neste
      // intervalo, o banco recusa; nunca cai silenciosamente na primeira etapa.
      chosen = statusId ?? String(equivalent!.id);
    }
    const [linha] = await tx`
      select ideworks.move_task(${taskId}, ${listId}, ${chosen}) as resultado`;

    const r = (linha?.resultado ?? {}) as {
      task_id?: string;
      list_id?: string;
      status_id?: string;
      previous_status_id?: string | null;
      status_repositioned?: boolean;
      subtasks_moved?: number;
      automation?: AutomacaoQueRodou | null;
    };

    return {
      taskId: r.task_id ?? taskId,
      listId: r.list_id ?? listId,
      statusId: r.status_id ?? '',
      previousStatusId: r.previous_status_id ?? null,
      statusRepositioned: origem === undefined && r.status_repositioned === true,
      subtasksMoved: comoNumero(r.subtasks_moved),
      // Vem nula do banco quando não houve regra. Nada é deduzido aqui:
      // quem sabe se a automação rodou é quem a rodou.
      automation: r.automation ?? null,
    };
  } catch (erro) {
    traduzir(erro);
  }
}

/**
 * Arrastar o cartão para outra coluna.
 *
 * NÃO EXISTE `update tasks set status_id` AQUI, E ISSO É O PONTO.
 *   `ideworks.move_task` troca lista e status **na mesma escrita** (regra 9),
 *   confere o alcance do destino, resolve a esteira, e devolve o que fez —
 *   inclusive se reposicionou o cartão. Reescrever isso em TypeScript daria uma
 *   segunda versão da regra, e a segunda versão é sempre a errada.
 *
 *   Ela também é o caminho por onde os dez gatilhos passam: o de status carimba
 *   a conclusão quando a coluna de destino é a que fecha, e limpa quando não é.
 *   É o que mantém a caixinha "Concluída" da aba do cliente e a coluna do
 *   quadro dizendo a mesma coisa.
 */
export async function moveTaskOnBoard(
  sql: Sql,
  actor: AuthenticatedActor,
  taskId: string,
  listId: string,
  statusId: string | null,
  origem?: OrigemDoMovimento,
): Promise<MoveResult> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31 — o destino de empresa omitida é, para quem move, uma lista que não
    // está disponível: a MESMA recusa de destino fora do alcance, e nada é
    // escrito. Sem omitida, nenhuma consulta a mais.
    if (recorteAtivo(actor)) {
      const [destino] = await tx`
        select s.category_id
          from ideworks.lists l
          join ideworks.spaces s on s.id = l.space_id
         where l.id = ${listId}`;
      if (destino && estaOmitida(actor, destino.category_id as string)) {
        throw new BoardRefused('A lista de destino está indisponível ou não tem etapas.', 400);
      }
    }
    return moveTaskOnBoardInTx(tx, taskId, listId, statusId, origem);
  });
}
