/**
 * A LEITURA DO QUADRO DA PASTA — etapa F17.64.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MUDA EM RELAÇÃO A `readBoard`, E O QUE NÃO MUDA
 *
 *   NÃO MUDA: a política de linha continua sendo quem recorta. `folders`,
 *   `lists`, `tasks` e `statuses` têm política própria, `list_workflow` é
 *   `security_invoker`, e não há um `where can_see_folder(...)` escrito aqui.
 *   Escrevê-lo seria a dívida 8.1 outra vez — a regra em dois lugares, e o de
 *   cima ficando para trás na primeira mudança.
 *
 *   MUDA: o recorte é a PASTA (`l.folder_id = $1`), a janela da F17.50 é
 *   particionada por NOME DE ETAPA em vez de por `status_id`, e cada cartão sai
 *   sabendo de que lista ele é. O porquê das colunas por nome está no cabeçalho
 *   de `@/board/quadro-da-pasta`, com a medição das 25 esteiras.
 *
 * ⚠️ SÓ AS LISTAS VIVAS ENTRAM
 *   Lista arquivada não vira coluna nem cartão aqui. O quadro DELA continua
 *   abrindo por `/quadro/:id` — arquivar não apaga (F17.1) —, mas juntar o
 *   arquivado com o que está em andamento faria a coluna `a fazer arte` da
 *   pasta contar trabalho que ninguém vai pegar.
 *
 * ⚠️ AS ESTEIRAS SÃO LIDAS UMA VEZ, NUM CTE PEQUENO
 *   `etapas` tem uma linha por (lista, status) — 345 em `TIME HELENA`. A
 *   varredura de tarefas junta contra ELE, e não contra `ideworks.statuses`
 *   linha a linha: a política de `statuses` (`can_see_status_set`) seria
 *   avaliada uma vez por TAREFA em vez de uma vez por etapa. Hoje isso é 425
 *   avaliações contra 345; numa pasta com dez mil tarefas seriam dez mil
 *   contra 345 — e é aí que a diferença deixa de ser detalhe.
 *
 * ⚠️ O CUSTO É POR TAREFA, E NÃO POR LISTA — e é isso que faz esta tela caber
 *   Medido em 2026-09-03, como `ideworks_app` pelo pooler, três corridas cada,
 *   com as consultas INTEIRAS (`scripts/provar-quadro-da-pasta.mjs`):
 *
 *     · pasta `TIME HELENA`  — 25 listas, 425 tarefas ... 0,50 / 0,50 / 0,50 s
 *     · lista `ATENDIMENTO`  —  1 lista, 1.071 tarefas ... 0,21 / 0,20 / 0,20 s
 *
 *   A pasta custa 2,5 vezes a maior lista do sistema e traz 132 cartões em vez
 *   de 63 — o dobro de colunas cheias. Ou seja: somar 25 listas NÃO somou 25
 *   preços. O que se paga é a política de `tasks` linha a linha (0,65 ms na
 *   medição da F17.50), e a pasta tem menos tarefas que a `ATENDIMENTO`
 *   sozinha. O orçamento da etapa era 3 s.
 *
 *   E PELO WORKER, que é o que a pessoa espera de verdade — mesma data, mesmo
 *   pooler, três corridas, sessão reaproveitada:
 *
 *     · `GET /board/folders/<TIME HELENA>` .. 1,55 / 1,20 / 1,19 s · 131 kB
 *     · `GET /board/lists/<ATENDIMENTO>` .... 0,75 / 0,67 / 0,62 s ·  43 kB
 *     · a mesma pasta, buscando `arte` ...... 0,93 / 0,92 s       ·  40 kB
 *     · a mesma pasta, `per-column=400` ..... 1,70 s · 425 cartões · 348 kB
 *
 *   ⚠️ A LISTA BATE COM O NÚMERO DA F17.61 (~600 ms), e é isso que torna a
 *   comparação honesta: as duas medidas saíram da mesma régua, no mesmo dia.
 *   A pasta custa cerca do dobro da maior lista do sistema, entrega o dobro
 *   de cartões, e fica bem abaixo dos 3 s que a etapa deu de teto.
 *
 *   ⚠️ E O QUE FARIA ISSO DESANDAR NÃO É LISTA A MAIS — é TAREFA a mais. Uma
 *   pasta com dez mil tarefas vivas pagaria dez mil avaliações de política
 *   antes de cortar a janela, e aí o caminho é filtrar antes (F17.55), não
 *   alargar a janela. Está escrito como dívida no plano.
 */

import {
  type BoardAssigneeOption,
  type BoardTag,
  CARTOES_POR_COLUNA,
  type StatusType,
} from '@/board/board';
import {
  ACENTOS_DE,
  ACENTOS_PARA,
  type FiltroDeTarefas,
  SEM_FILTRO,
  paraConsulta,
} from '@/board/filtro';
import type {
  EtapaDaPasta,
  FolderBoard,
  FolderBoardHeader,
  ListaDaPasta,
  TarefaDaPasta,
} from '@/board/quadro-da-pasta';
import { ordenarEtapas } from '@/board/quadro-da-pasta';
import {
  BoardRefused,
  CARTOES_POR_COLUNA_MAX,
  type ContagemDaColuna,
  SEM_COLUNA,
  comoNumero,
  paraCartao,
} from '@/server/board';
import { clienteDaTarefaSql } from '@/server/cliente-da-tarefa';
import { type Sql, type Tx, inlineUuid, withActor } from '@/server/db';
import { lerResponsaveisDoQuadro } from '@/server/responsaveis-do-quadro';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export async function readFolderBoard(
  sql: Sql,
  actor: AuthenticatedActor,
  folderId: string,
  /** Quantos cartões trazer POR COLUNA. Ver `CARTOES_POR_COLUNA` (F17.50). */
  porColuna: number = CARTOES_POR_COLUNA,
  /** A busca por título e o responsável — F17.55, a MESMA peneira da lista. */
  filtro: FiltroDeTarefas = SEM_FILTRO,
): Promise<FolderBoard> {
  const teto = Number.isFinite(porColuna)
    ? Math.min(Math.max(Math.trunc(porColuna), 1), CARTOES_POR_COLUNA_MAX)
    : CARTOES_POR_COLUNA;

  return withActor(sql, asDbActor(actor), async (tx) => {
    // PERF DO SERVIDOR, 08/10/2026 — A PASTA ABRE EM 5 IDAS, E NÃO EM 18
    //
    //   Eram oito consultas em fila, quase todas com o id da pasta como
    //   parâmetro (duas idas cada, com `prepare: false`). O id vai agora no
    //   TEXTO (`inlineUuid`) e as consultas independentes saem juntas: a pasta,
    //   as listas e as colunas primeiro; depois as contagens, os responsáveis
    //   e as etiquetas junto com a consulta dos cartões — esta ÚLTIMA, porque
    //   leva parâmetros (busca, responsável) e o driver não deixa nada passar
    //   na frente de uma consulta que precisa descobrir os tipos. Pasta que
    //   não existe, ou sem lista, ou sem esteira, para depois da primeira leva
    //   — a consulta pesada dos cartões não roda à toa.
    const idDaPasta = inlineUuid(tx, folderId);

    /* 1. A PASTA, e a trilha até ela.
       Sai de `ideworks.folders`, e não da view `tree`: a view começa na LISTA, e
       uma pasta sem lista viva não teria linha nenhuma lá — ela abriria como
       "não encontrada" em vez de abrir vazia. A política `folders_select`
       (`can_see_folder`) é quem decide se esta linha volta.

       2. AS LISTAS VIVAS DA PASTA.
       ⚠️ Elas vêm da tabela, sob `lists_select` — que é a parede da F17.23. Uma
       lista fechada para quem olha não volta aqui, e por isso ela não entra em
       coluna nenhuma, não entra na contagem e não entra no rodapé. O quadro da
       pasta mostra o que a pessoa alcança, e nada além. */
    const [[pasta], listas, colunas] = await Promise.all([
      tx`
      select f.id, f.name, f.archived_at,
             s.id as space_id, s.name as space_name,
             c.name as category_name
        from ideworks.folders f
        join ideworks.spaces s on s.id = f.space_id
        left join ideworks.client_categories c on c.id = s.category_id
       where f.id = ${idDaPasta}`,

      tx`
      select l.id, l.name
        from ideworks.lists l
       where l.folder_id = ${idDaPasta}
         and l.archived_at is null
       order by l.sort_order, lower(btrim(l.name))`,

      // 3. AS COLUNAS — uma por NOME DE ETAPA (ver a nota mais abaixo).
      tx`
      select lower(btrim(lw.status_name))                        as chave,
             mode() within group (order by lw.status_name)       as nome,
             mode() within group (order by lw.status_type)::text as tipo,
             mode() within group (order by lw.status_color)      as cor,
             count(distinct lw.list_id)::int                     as listas,
             avg(lw.status_sort_order)::float8                   as ordem,
             jsonb_object_agg(lw.list_id, lw.status_id)          as por_lista
        from ideworks.list_workflow lw
        join ideworks.lists l on l.id = lw.list_id
       where l.folder_id = ${idDaPasta}
         and l.archived_at is null
       group by 1`,
    ]);

    // Fora do alcance e inexistente respondem igual, de propósito: distinguir os
    // dois contaria que a pasta existe para quem não pode vê-la. É a mesma
    // recusa que `readBoard` dá para a lista.
    if (!pasta) {
      throw new BoardRefused('Pasta não encontrada, ou fora do seu alcance.', 404);
    }

    const nomeDaLista = new Map<string, string>(
      listas.map((r) => [r.id as string, r.name as string]),
    );

    const header: FolderBoardHeader = {
      folderId: pasta.id as string,
      folderName: pasta.name as string,
      folderArchivedAt:
        pasta.archived_at === null || pasta.archived_at === undefined
          ? null
          : new Date(pasta.archived_at as string).toISOString(),
      spaceId: pasta.space_id as string,
      spaceName: pasta.space_name as string,
      categoryName: (pasta.category_name as string | null) ?? null,
      lists: listas.length,
    };

    // Pasta sem lista viva abre vazia, e isso é um estado — não um defeito.
    // Devolver aqui evita quatro consultas que só podem voltar vazias.
    if (listas.length === 0) {
      return {
        header,
        etapas: [],
        lists: [],
        tasks: [],
        columnTotals: {},
        columnMatched: {},
        perColumn: teto,
        assigneeOptions: [],
        unassignedTasks: 0,
        availableTags: await etiquetasDoEspaco(tx, header.spaceId),
        filter: filtro,
      } satisfies FolderBoard;
    }

    /* 3. AS COLUNAS — uma por NOME DE ETAPA.

       ⚠️ `mode() within group` E NÃO `min`/`max`: o que se quer é o que a
       MAIORIA das listas diz. Com 25 esteiras copiadas, uma delas escrita
       `A Fazer Arte` não pode decidir sozinha como a coluna se chama.

       `avg(status_sort_order)` é a ordem — ver o cabeçalho de
       `@/board/quadro-da-pasta` para o porquê da média e o que ela desempata.
       Quem ORDENA é `ordenarEtapas`, em TypeScript, para a regra ter teste; a
       consulta só devolve o número.

       `jsonb_object_agg(list_id, status_id)` é o destino do arrasto: a chave é
       a lista, o valor é o status DAQUELA lista com este nome. */

    if (colunas.length === 0) {
      // A mesma frase que `readBoard` dá para a lista sem esteira, no plural: se
      // NENHUMA das listas da pasta declara conjunto de status, o quadro não tem
      // coluna nenhuma — e isso se conserta criando a esteira, não recarregando.
      throw new BoardRefused(
        'Nenhuma lista desta pasta tem esteira: nem elas, nem a pasta, nem o espaço declaram um conjunto de status. Sem esteira o quadro não tem coluna nenhuma.',
        400,
      );
    }

    const etapas: EtapaDaPasta[] = ordenarEtapas(
      colunas.map((r) => ({
        key: r.chave as string,
        name: r.nome as string,
        type: r.tipo as StatusType,
        color: (r.cor as string | null) ?? null,
        lists: comoNumero(r.listas),
        ordem: comoNumero(r.ordem),
        statusByList: (r.por_lista as Record<string, string>) ?? {},
      })),
    );

    /* 4. OS CARTÕES.

       É a consulta da F17.55/F17.61 com dois ajustes, e nenhum terceiro:

         a) `marcada` varre as tarefas das listas DA PASTA, e traz `list_id`.
            A junção com `etapas` resolve o NOME da etapa de cada tarefa — é
            essa `chave` que particiona a janela e agrupa a contagem.

         b) `row_number() over (partition by chave, bate …)`: a janela é por
            COLUNA DA TELA. Particionar por `status_id`, como na lista, traria
            50 cartões de cada um dos 345 status — 17.250 numa pasta de 458
            tarefas, ou seja, a lista inteira várias vezes.

       O resto — a contagem em `jsonb` repetida em toda linha, o `left join
       lateral` da miniatura só sobre a janela, a mãe pelo id — é palavra por
       palavra o que `readBoard` já faz, e pelas mesmas razões medidas lá. */
    const consulta = paraConsulta(filtro);
    const consultaDosCartoes = tx`
      with etapas as (
        select lw.list_id, lw.status_id, lower(btrim(lw.status_name)) as chave
          from ideworks.list_workflow lw
          join ideworks.lists l on l.id = lw.list_id
         where l.folder_id = ${idDaPasta}
           and l.archived_at is null
      ), marcada as (
        select k.id, k.status_id, k.list_id, k.priority, k.due_on, k.title,
               e.chave,
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
          join ideworks.lists l on l.id = k.list_id
          left join etapas e on e.list_id = k.list_id and e.status_id = k.status_id
         where l.folder_id = ${idDaPasta}
           and l.archived_at is null
           and k.archived_at is null
      ), contagem as (
        select coalesce(
                 jsonb_object_agg(
                   coalesce(chave, ${SEM_COLUNA}),
                   jsonb_build_object('total', total, 'matched', achadas)
                 ),
                 '{}'::jsonb
               ) as mapa
          from (select chave,
                       count(*)::int                       as total,
                       count(*) filter (where bate)::int   as achadas
                  from marcada
                 group by chave) por_coluna
      ), janela as (
        select id, bate, list_id, chave,
               row_number() over (
                 partition by chave, bate
                 order by priority nulls last, due_on nulls last, lower(title)
               ) as posicao
          from marcada
      )
      select t.id, t.title, t.status_id, t.priority,
             j.list_id, j.chave,
             (select mapa from contagem) as mapa,
             t.due_on::text   as due_on,
             t.start_on::text as start_on,
             t.completed_at,
             (t.description is not null and btrim(t.description) <> '') as has_description,
             -- F38, Fase 6: o cliente da tarefa, e na falta dele o da lista.
             ${clienteDaTarefaSql(tx)} as client_id, cl.name as client_name,
             tl.task_type_name,
             t.demand_type::text as demand_type,
             t.parent_id,
             pai.title as parent_title,
             coalesce(tp.subtask_count, 0)   as subtask_count,
             coalesce(tp.checklist_done, 0)  as checklist_done,
             coalesce(tp.checklist_total, 0) as checklist_total,
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
             img.attachment_id            as preview_attachment_id,
             coalesce(img.image_count, 0) as preview_count
        from ideworks.tasks t
        join janela j on j.id = t.id and j.bate and j.posicao <= ${teto}
        left join ideworks.task_labels tl on tl.task_id = t.id
        left join ideworks.clients cl on cl.id = ${clienteDaTarefaSql(tx)}
        left join ideworks.task_progress tp on tp.task_id = t.id
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
        left join ideworks.tasks pai on pai.id = t.parent_id
       order by t.priority nulls last, t.due_on nulls last, lower(t.title)`;

    // A SEGUNDA LEVA: o que não depende dos cartões sai junto com eles — a
    // dos cartões vai por último (ver o começo desta função).
    const [porLista, responsaveis, availableTags, tarefas] = await Promise.all([
      /* QUANTAS TAREFAS CADA LISTA TEM NA PASTA.
         É o que o rodapé mostra, e é a resposta para "de quem é a fila". Vem da
         mesma tabela e da mesma condição das colunas — não de somar cartões, que
         contaria só a janela. */
      tx`
      select k.list_id, count(*)::int as tarefas
        from ideworks.tasks k
        join ideworks.lists l on l.id = k.list_id
       where l.folder_id = ${idDaPasta}
         and l.archived_at is null
         and k.archived_at is null
       group by 1`,

      /* QUEM O MENU `Filtrar por responsável` OFERECE NESTA PASTA — F17.55,
         refeito na F17.70. A lista deixou de ser "quem aparece em
         `task_assignees`" e passou a ser "quem eu alcanço", unida a quem já é
         responsável aqui. O recorte da pasta é só o `donos` abaixo; a regra e as
         razões moram em `@/server/responsaveis-do-quadro`. */
      lerResponsaveisDoQuadro(
        tx,
        tx`
        select distinct a.task_id, a.user_id
          from ideworks.task_assignees a
          join ideworks.tasks k on k.id = a.task_id
          join ideworks.lists l on l.id = k.list_id
         where l.folder_id = ${idDaPasta}
           and l.archived_at is null
           and k.archived_at is null`,
      ),

      etiquetasDoEspaco(tx, header.spaceId),

      consultaDosCartoes,
    ]);

    const tasks: TarefaDaPasta[] = tarefas.map((r) => {
      const listId = r.list_id as string;
      return {
        ...paraCartao(r as Record<string, unknown>),
        listId,
        // O nome sai do mapa que a consulta 2 já trouxe: perguntá-lo de novo
        // por cartão seria uma junção a mais para repetir 458 vezes um de 25
        // nomes.
        listName: nomeDaLista.get(listId) ?? '(lista fora do alcance)',
        columnKey: (r.chave as string | null) ?? null,
      } satisfies TarefaDaPasta;
    });

    /* AS DUAS CONTAGENS, com as chaves das COLUNAS DA TELA — F17.50 e F17.55.
       O mapa é igual em toda linha; sem linha nenhuma — busca que não achou —,
       ele é buscado à parte, para a coluna poder dizer `0 de 133` em vez de um
       vazio calado. */
    const mapaCru =
      (tarefas[0]?.mapa as Record<string, ContagemDaColuna> | undefined) ??
      (await contarSemAchado(tx, folderId, consulta));

    const columnTotals: Record<string, number> = {};
    const columnMatched: Record<string, number> = {};
    for (const [chave, par] of Object.entries(mapaCru)) {
      if (chave === SEM_COLUNA) continue;
      columnTotals[chave] = comoNumero(par?.total);
      columnMatched[chave] = comoNumero(par?.matched);
    }

    const contagemPorLista = new Map<string, number>(
      porLista.map((r) => [r.list_id as string, comoNumero(r.tarefas)]),
    );

    const lists: ListaDaPasta[] = listas.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      tasks: contagemPorLista.get(r.id as string) ?? 0,
    }));

    const assigneeOptions: BoardAssigneeOption[] = responsaveis.opcoes;

    const naPasta = Object.values(mapaCru).reduce((s, par) => s + comoNumero(par?.total), 0);
    const comDono = responsaveis.comDono;
    // Nunca negativo: as duas contas vêm de consultas diferentes, e uma escrita
    // entre elas faria a subtração passar do zero por baixo.
    const unassignedTasks = Math.max(naPasta - comDono, 0);

    return {
      header,
      etapas,
      lists,
      tasks,
      columnTotals,
      columnMatched,
      perColumn: teto,
      assigneeOptions,
      unassignedTasks,
      availableTags,
      filter: filtro,
    } satisfies FolderBoard;
  });
}

/**
 * O vocabulário do espaço — F17.10.
 *
 * O quadro não o desenha; o formulário de tarefa nova, que abre de dentro dele,
 * precisa dele. Uma consulta a mais aqui evita uma ida inteira ao servidor a
 * cada clique em "Nova tarefa".
 */
async function etiquetasDoEspaco(tx: Tx, spaceId: string): Promise<BoardTag[]> {
  const linhas = await tx`
    select g.id, g.name, g.bg_color, g.fg_color
      from ideworks.task_tags g
     where g.space_id = ${inlineUuid(tx, spaceId)}
     order by lower(btrim(g.name))`;

  return linhas.map((g) => ({
    id: g.id as string,
    name: g.name as string,
    bgColor: (g.bg_color as string | null) ?? null,
    fgColor: (g.fg_color as string | null) ?? null,
  }));
}

/**
 * A contagem quando a busca não achou nada.
 *
 * Repete a MESMA condição da varredura, porque a pergunta é a mesma — "quantas
 * há, e quantas bateram". A resposta certa para uma busca sem resultado é
 * `0 de 133`, não um vazio calado.
 */
async function contarSemAchado(
  tx: Tx,
  folderId: string,
  consulta: ReturnType<typeof paraConsulta>,
): Promise<Record<string, ContagemDaColuna>> {
  const linhas = await tx`
    with etapas as (
      select lw.list_id, lw.status_id, lower(btrim(lw.status_name)) as chave
        from ideworks.list_workflow lw
        join ideworks.lists l on l.id = lw.list_id
       where l.folder_id = ${folderId}
         and l.archived_at is null
    )
    select coalesce(e.chave, ${SEM_COLUNA}) as chave,
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
      join ideworks.lists l on l.id = k.list_id
      left join etapas e on e.list_id = k.list_id and e.status_id = k.status_id
     where l.folder_id = ${folderId}
       and l.archived_at is null
       and k.archived_at is null
     group by 1`;

  const mapa: Record<string, ContagemDaColuna> = {};
  for (const r of linhas) {
    mapa[r.chave as string] = { total: comoNumero(r.total), matched: comoNumero(r.achadas) };
  }
  return mapa;
}
