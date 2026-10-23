/**
 * `Meu trabalho` e `Todas as tarefas` — a leitura. Etapa F17.18.
 *
 * DUAS PERGUNTAS, E NENHUMA REGRA NOVA
 *   1. O que é MEU?         → `task_assignees` e `tasks.created_by`
 *   2. O que eu ALCANÇO?    → a política de linha de `tasks`, e mais nada
 *
 *   ⚠️ NÃO HÁ `where can_reach_task(...)` EM LUGAR NENHUM DESTE ARQUIVO. A
 *   política de `tasks` já recorta, e `tree`, `task_labels` e `task_progress`
 *   são `security_invoker`. Escrever o alcance aqui seria a dívida 8.1 outra
 *   vez — a regra em dois lugares, e a de cima ficando para trás na primeira
 *   mudança. O que este arquivo filtra é PERTENCIMENTO, que é outra coisa.
 *
 * A REDE É GROSSA AQUI, E A DECISÃO É NA CAMADA PURA
 *   O `where` de `readMyWork` traz "tarefas que me dizem respeito": atribuídas
 *   a mim, ou criadas por mim com responsável. Quem decide em qual das três
 *   abas cada linha cai é `abaDaLinha`, em `@/board/meu-trabalho` — uma função
 *   pura, com teste. A regra do `Delegado` mora lá, e só lá.
 *
 *   O `where` daqui é o casamento exato dessa rede: toda linha que ele traz cai
 *   em alguma aba, e nenhuma aba precisa de linha que ele não trouxe. Se um dia
 *   os dois divergirem, aparece como "criei e deleguei e não vejo" — e
 *   `scripts/provar-meu-trabalho.mjs` mede isso ponta a ponta.
 *
 * A ABA ENTRA NO `where` QUANDO A TELA PEDE UMA — F17.AUD05
 *   A rede grossa com teto de 500 tinha um buraco medido pela auditoria: 500
 *   concluídas antigas e uma pendente posterior, e a pendente ficava fora do
 *   lote — `Pendente 0`, sem aviso. `readMyWorkPage` filtra a aba ANTES do
 *   limite, conta cada aba inteira e devolve lotes de 100 com cursor.
 *
 *   E a regra continua morando num lugar só: `predicadoDaAba` gera o `where`
 *   a partir de `ESPECIFICACAO_DAS_ABAS`, a MESMA tabela de que `abaDaLinha`
 *   deriva. Cada fato da tabela tem aqui a sua expressão SQL (`SQL_DO_FATO`), e
 *   mais nada — não há um segundo `if` sobre o `Delegado` escrito em SQL.
 *
 *   `readMyWork` (sem aba) continua intacto para o consumidor antigo; a tela
 *   migra na AUD06.
 *
 * A DATA SAI COMO TEXTO
 *   `due_on::text`, e não a conversão do driver. Uma tarefa real tem prazo no
 *   ano 82025, e `Date.toISOString()` escreve ano expandido (`+082025-08-07`),
 *   que todo `.slice(0, 10)` do projeto cortaria errado. Mesma decisão de
 *   `server/board.ts`.
 *
 * O NOME DO RESPONSÁVEL SAI DE `display_name()`
 *   Nunca de junção com `profiles`: aquela política mostra só o próprio perfil,
 *   e a junção devolveria VAZIO em silêncio.
 *
 * O TETO DE `Todas as tarefas`, E POR QUE ELE DIZ QUE EXISTE
 *   Hoje há 24 tarefas. A tela não pode ser escrita para 24: ela é a tela do
 *   histórico, e histórico só cresce. Então a leitura tem teto E conta o total
 *   separado — para a tela poder dizer "mostrando 500 de 3.120" em vez de
 *   mostrar 500 e deixar a pessoa achar que é tudo.
 */

import type {
  BoardAssignee,
  BoardAssigneeOption,
  BoardTag,
  Priority,
  StatusType,
} from '@/board/board';
import {
  ACENTOS_DE,
  ACENTOS_PARA,
  type FiltroDeTarefas,
  SEM_FILTRO,
  paraConsulta,
} from '@/board/filtro';
import {
  type Aba,
  ABAS,
  ESPECIFICACAO_DAS_ABAS,
  FATOS,
  type FatosDaLinha,
  type WorkRow,
} from '@/board/meu-trabalho';
import { clienteDaTarefaSql } from '@/server/cliente-da-tarefa';
import { type Sql, type Tx, inlineBool, inlineUuid, withActor } from '@/server/db';
import { tarefaForaDasOmitidas } from '@/server/omitidas';
import {
  type ChaveDeOrdem,
  type Pagina,
  type PedidoDePagina,
  montarPagina,
  ramosDoCursor,
} from '@/server/paginacao-do-trabalho';
import { lerResponsaveisDoQuadro } from '@/server/responsaveis-do-quadro';
import { type AuthenticatedActor, asDbActor } from '@/server/session';
import { comoTipoLido } from '@/server/tipo-da-tarefa';
import type postgres from 'postgres';

/** O driver devolve `count(*)` como texto quando não se pede `::int`. Rede de cima. */
const comoNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const comoInstante = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

type LinhaDeEtiqueta = { id: string; name: string; bg_color: string | null; fg_color: string | null };

/**
 * Um pedaço de SQL montado com o MESMO `tx` da consulta que o recebe — o que o
 * driver chama de fragmento. É o tipo que `tx\`...\`` devolve sem molde, e é
 * ele que se encaixa em `${...}` de outra consulta.
 */
type Trecho = postgres.PendingQuery<postgres.Row[]>;

/** O id de quem lê, como parâmetro (texto) ou já escrito no texto da consulta (`inlineUuid`). */
type Quem = ReturnType<typeof inlineUuid>;

/**
 * O teto de `Todas as tarefas`.
 *
 * Quinhentas linhas rolam sem travar o navegador e cobrem folgadamente o
 * tamanho de hoje. Quando ele for pequeno, a saída é a busca e o filtro
 * (F17.13b), e não um teto maior — a tela que mostra tudo deixa de ajudar muito
 * antes de o navegador reclamar.
 */
export const TETO_DE_LINHAS = 500;

/* ───────────────────────────── a aba, em SQL ───────────────────────────── */

/**
 * A expressão SQL de cada fato de `ESPECIFICACAO_DAS_ABAS` — F17.AUD05.
 *
 * São as MESMAS expressões que o `select` de `lerLinhas` devolve como
 * `assigned_to_me`, `completed_at`, `created_by_me` e `other_assignees`: o
 * navegador lê a coluna e o `where` lê a expressão, e as duas dizem a mesma
 * coisa sobre a mesma linha. `eu` é SEMPRE `actor.userId` — nunca um parâmetro
 * do endereço.
 *
 * ⚠️ FRAGMENTO NÃO SE ESPERA. `tx\`...\`` devolve uma promessa preguiçosa que só
 * roda quando alguém dá `await` nela. Estas funções são síncronas de propósito:
 * devolvê-las de uma função `async` faria o chamador esperar o fragmento, e o
 * banco receberia `exists (...)` solto como consulta.
 */
const SQL_DO_FATO: Record<keyof FatosDaLinha, (tx: Tx, eu: Quem) => Trecho> = {
  assignedToMe: (tx, eu) => tx`(exists (select 1 from ideworks.task_assignees a
                                          where a.task_id = t.id and a.user_id = ${eu}))`,
  completed: (tx) => tx`(t.completed_at is not null)`,
  createdByMe: (tx, eu) => tx`(coalesce(t.created_by = ${eu}, false))`,
  hasOthers: (tx, eu) => tx`(exists (select 1 from ideworks.task_assignees a
                                       where a.task_id = t.id and a.user_id <> ${eu}))`,
};

/**
 * O `where` de uma aba, gerado da tabela — e não escrito à mão.
 *
 * Para cada fato que a aba cita, `<expressão> = <valor exigido>`, ligados por
 * `and`. Fato que a tabela não cita não entra. É a leitura de `satisfaz` em
 * SQL: mudar a tabela muda este `where` sem ninguém tocar aqui.
 */
export function predicadoDaAba(tx: Tx, eu: string, aba: Aba): Trecho {
  const condicao = ESPECIFICACAO_DAS_ABAS[aba];
  // O id do ator e o valor exigido de cada fato vão no TEXTO (perf do servidor,
  // 08/10/2026): `contarAbas` fica sem parâmetro e sai na mesma ida da
  // declaração do ator, e a consulta da página (que leva cursor e limite como
  // parâmetro) segue logo depois. Fora do formato, ou em dublê de teste, os dois
  // continuam parâmetro, como antes.
  const quem = inlineUuid(tx, eu);
  const partes = FATOS.filter((f) => condicao[f] !== undefined).map(
    (f) => tx`${SQL_DO_FATO[f](tx, quem)} = ${inlineBool(tx, condicao[f] === true)}::boolean`,
  );
  // Não acontece com a tabela de hoje — o teste de `meu-trabalho` garante que
  // toda aba cita ao menos um fato. O `true` só existe para o `reduce` nunca
  // receber lista vazia.
  return partes.length === 0
    ? tx`true`
    : partes.reduce((acc, parte) => tx`${acc} and ${parte}`);
}

/**
 * "Depois do cursor", na ordem `due_on nulls last, priority nulls last,
 * lower(title), id` — F17.AUD05.
 *
 * Um cursor por deslocamento (`offset`) mentiria quando uma tarefa fosse
 * concluída entre dois pedidos. Este é por CHAVE: a página seguinte é tudo o
 * que vem depois da última linha devolvida, na ordenação de sempre com o `id`
 * como desempate. Os nulos são casos, e não `coalesce` — o `nulls last` põe
 * toda tarefa sem prazo DEPOIS de qualquer prazo, e a condição muda de forma
 * conforme o cursor tem prazo ou não. Quem decide o ramo é `ramosDoCursor`,
 * na camada pura; aqui está o SQL de cada um, por extenso.
 *
 * Os valores do cursor entram como PARÂMETROS com molde explícito
 * (`::date`, `::ideworks.task_priority`, `::text`, `::uuid`): nada dele vira
 * texto de SQL, e ele não cita pessoa nenhuma — o alcance continua sendo a
 * política de linha.
 */
export function depoisDoCursor(tx: Tx, cursor: ChaveDeOrdem): Trecho {
  const ramo = ramosDoCursor(cursor);

  // O fim da chave: título e id nunca são nulos. Título maior; ou título igual
  // e id maior. `lower(t.title)` é a mesma expressão do `order by`, e o valor
  // do cursor veio de lá (ver o cabeçalho de paginacao-do-trabalho).
  const tituloEId = tx`(lower(t.title) > ${cursor.title}::text
                        or (lower(t.title) = ${cursor.title}::text and t.id > ${cursor.id}::uuid))`;

  // A prioridade. Com valor no cursor: vem depois quem tem prioridade NULA
  // (nulls last), quem tem prioridade MAIOR na ordem do enum, ou quem empata e
  // perde no título/id. Com o cursor nulo: só quem também não tem prioridade
  // pode vir depois, e o desempate é o título/id.
  const prioridade =
    ramo.prioridade === 'com-valor'
      ? tx`(t.priority is null
            or t.priority > ${cursor.priority}::ideworks.task_priority
            or (t.priority = ${cursor.priority}::ideworks.task_priority and ${tituloEId}))`
      : tx`(t.priority is null and ${tituloEId})`;

  // O prazo, com a mesma forma um nível acima.
  return ramo.prazo === 'com-valor'
    ? tx`(t.due_on is null
          or t.due_on > ${cursor.dueOn}::date
          or (t.due_on = ${cursor.dueOn}::date and ${prioridade}))`
    : tx`(t.due_on is null and ${prioridade})`;
}

/* ───────────────────────────── as colunas comuns ───────────────────────────── */

/**
 * A mesma consulta serve às duas telas, e é isso que garante que a linha de
 * `Minhas tarefas` e o cartão de `Todas as tarefas` falem do mesmo objeto.
 *
 * Ela recebe o `where` já montado pelo chamador porque a diferença entre as
 * duas telas é EXATAMENTE essa cláusula — nada mais. Duas consultas parecidas
 * divergiriam na primeira etapa que acrescentasse uma coluna a uma só.
 *
 * A PÁGINA — F17.AUD05 — é a terceira variação da MESMA consulta, e não uma
 * quarta consulta: com `pagina`, entram o `where` da aba, a condição "depois
 * do cursor", o `id` como desempate da ordem e o limite do lote (mais um, para
 * saber se há continuação). Sem `pagina`, a consulta é a de sempre — a menos
 * de uma coluna a mais no `select` (`sort_title`) e de dois `and true` — e a
 * ordem fica SEM o `id`, para `Todas as tarefas` não mudar.
 */
async function lerLinhas(
  tx: Tx,
  eu: string,
  filtro: 'minhas' | 'todas',
  recorte: Trecho,
  peneira: FiltroDeTarefas = SEM_FILTRO,
): Promise<WorkRow[]> {
  return (await lerLinhasComChave(tx, eu, filtro, peneira, null, recorte)).map((l) => l.row);
}

/**
 * A linha crua da consulta, na forma que as telas desenham — `WorkRow`.
 *
 * Exportada para a F18A: `@/server/tarefas-do-escopo` devolve a MESMA linha
 * (com as colunas de mesmo nome no `select`), e é isso que deixa `Lista` e
 * `Kanban` do espaço desenharem com `LinhaDeTrabalho` e o cartão de sempre.
 * Um segundo mapeamento divergiria na primeira coluna acrescentada a um só.
 */
export function paraWorkRow(r: postgres.Row): WorkRow {
  return {
    id: r.id as string,
    title: r.title as string,
    statusId: (r.status_id as string | null) ?? null,
    priority: (r.priority as Priority | null) ?? null,
    dueOn: (r.due_on as string | null) ?? null,
    startOn: (r.start_on as string | null) ?? null,
    completedAt: comoInstante(r.completed_at),
    hasDescription: r.has_description === true,
    hasAttachment: comoNumero(r.attachment_count) > 0,
    clientId: (r.client_id as string | null) ?? null,
    clientName: (r.client_name as string | null) ?? null,
    assignees: (r.assignees as BoardAssignee[]) ?? [],
    tags: ((r.tags as LinhaDeEtiqueta[]) ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      bgColor: g.bg_color ?? null,
      fgColor: g.fg_color ?? null,
    } satisfies BoardTag)),
    taskTypeName: (r.task_type_name as string | null) ?? null,
    type: comoTipoLido(r.demand_type),
    parentId: (r.parent_id as string | null) ?? null,
    parentTitle: (r.parent_title as string | null) ?? null,
    subtaskCount: comoNumero(r.subtask_count),
    checklistDone: comoNumero(r.checklist_done),
    checklistTotal: comoNumero(r.checklist_total),
    commentCount: comoNumero(r.comment_count),
    previewAttachmentId: (r.preview_attachment_id as string | null) ?? null,
    previewCount: comoNumero(r.preview_count),

    categoryName: (r.category_name as string | null) ?? null,
    spaceName: (r.space_name as string | null) ?? null,
    folderName: (r.folder_name as string | null) ?? null,
    listId: (r.list_id as string | null) ?? null,
    listName: (r.list_name as string | null) ?? null,
    listLive: r.list_live === true,
    statusName: (r.status_name as string | null) ?? null,
    statusType: (r.status_type as StatusType | null) ?? null,
    statusColor: (r.status_color as string | null) ?? null,
    statusSortOrder:
      r.status_sort_order === null || r.status_sort_order === undefined ? null : comoNumero(r.status_sort_order),
    assignedToMe: r.assigned_to_me === true,
    createdByMe: r.created_by_me === true,
    otherAssignees: comoNumero(r.other_assignees),
  } satisfies WorkRow;
}

/** Uma linha e a sua chave de ordem — o que o cursor precisa guardar. */
type LinhaLida = { row: WorkRow; chave: ChaveDeOrdem };

async function lerLinhasComChave(
  tx: Tx,
  eu: string,
  filtro: 'minhas' | 'todas',
  peneira: FiltroDeTarefas,
  pagina: PedidoDePagina | null,
  /**
   * O recorte das empresas omitidas — F31. Vazio quando não há omitida, e aí
   * a consulta é a de sempre. Ver `tarefaForaDasOmitidas`.
   */
  recorte: Trecho,
): Promise<LinhaLida[]> {
  const p = paraConsulta(peneira);
  /* O `id` como desempate — SÓ na página. Duas tarefas com o mesmo prazo,
     prioridade e título empatam na ordem de sempre, e um cursor sobre empate
     pularia ou repetiria uma delas. Fora da página a ordem fica como era, para
     `Todas as tarefas` não mudar. Fragmento vazio é o idioma do driver para
     "nada aqui". */
  const desempate = pagina === null ? tx`` : tx`, t.id`;
  const linhas = await tx`
    select t.id, t.title, t.status_id, t.priority,
           t.due_on::text   as due_on,
           t.start_on::text as start_on,
           t.completed_at,
           -- F17.AUD05: a chave de ordem que o cursor guarda. Vem do banco, e
           -- nao de toLowerCase() no servidor: lower() segue a collation do
           -- banco, e e ela que manda no order by.
           lower(t.title)   as sort_title,
           (t.description is not null and btrim(t.description) <> '') as has_description,
           -- F38, Fase 6: o cliente da tarefa, e na falta dele o da lista.
           ${clienteDaTarefaSql(tx)} as client_id, cl.name as client_name,
           t.parent_id, pai.title as parent_title,
           tl.task_type_name,
           t.demand_type::text as demand_type,
           coalesce(tl.tags, '[]'::jsonb) as tags,
           coalesce(tp.subtask_count, 0)    as subtask_count,
           coalesce(tp.checklist_done, 0)   as checklist_done,
           coalesce(tp.checklist_total, 0)  as checklist_total,
           coalesce(tp.attachment_count, 0) as attachment_count,
           coalesce(tp.comment_count, 0)    as comment_count,
           -- O status vem direto da tabela statuses, e nao da view list_workflow:
           -- aquela view devolve UMA LINHA POR STATUS da esteira, e a juncao
           -- multiplicaria cada tarefa pelo tamanho da esteira dela.
           s.name  as status_name,
           s.type  as status_type,
           s.color as status_color,
           -- A posicao da etapa na esteira: o quadro de Minhas tarefas ordena
           -- as colunas por ela.
           s.sort_order as status_sort_order,
           -- A trilha. A view tree SEM o filtro is_live, de proposito: tarefa em
           -- lista arquivada continua sendo minha, e some-la esconderia
           -- trabalho. A tela DIZ que a lista saiu de circulacao.
           tr.list_id, tr.list_name, tr.folder_name, tr.space_name,
           coalesce(tr.is_live, false) as list_live,
           c.name as category_name,
           coalesce(
             (select json_agg(json_build_object(
                        'id', a.user_id,
                        'name', coalesce(ideworks.display_name(a.user_id), '(sem nome)'))
                      order by ideworks.display_name(a.user_id))
                from ideworks.task_assignees a
               where a.task_id = t.id),
             '[]'::json
           ) as assignees,
           -- F17.56 — a miniatura. MESMA regra do quadro da lista, e de
           -- proposito: a tela Todas as tarefas desenha o MESMO cartao
           -- (CorpoDoCartao), e uma das duas telas sem a arte seria a
           -- divergencia que a F17.18 extraiu o componente para evitar.
           img.attachment_id            as preview_attachment_id,
           coalesce(img.image_count, 0) as preview_count,
           exists (select 1 from ideworks.task_assignees a
                    where a.task_id = t.id and a.user_id = ${eu}) as assigned_to_me,
           coalesce(t.created_by = ${eu}, false) as created_by_me,
           (select count(*)::int from ideworks.task_assignees a
             where a.task_id = t.id and a.user_id <> ${eu}) as other_assignees
      from ideworks.tasks t
      left join ideworks.tree tr on tr.list_id = t.list_id
      left join ideworks.client_categories c on c.id = tr.category_id
      left join ideworks.statuses s on s.id = t.status_id
      left join ideworks.task_labels tl on tl.task_id = t.id
      left join ideworks.task_progress tp on tp.task_id = t.id
      left join ideworks.clients cl on cl.id = ${clienteDaTarefaSql(tx)}
      left join ideworks.tasks pai on pai.id = t.parent_id
      -- A primeira imagem anexada, e quantas ha. Ver o cabecalho do mesmo
      -- bloco em server/board.ts: o indice task_attachments_task_idx
      -- devolve zero linhas para a tarefa sem anexo, e ai a politica nem chega
      -- a ser avaliada.
      --
      -- ⚠️ AQUI ELE ROLA ANTES DO LIMIT, E NAO DEPOIS DE UMA JANELA. Esta
      -- consulta nao tem janela por coluna: o teto de 500 corta no fim, entao a
      -- juncao lateral toca toda linha candidata. Medido em 2026-09-02, como
      -- ideworks_app pelo pooler, tres corridas, 500 linhas:
      --   sem a miniatura ... 12,90 / 11,98 / 11,97 s
      --   com a miniatura ... 12,09 / 12,02 / 12,15 s
      -- Ou seja: dentro do ruido. O preco desta tela ja e outro, e ele e
      -- anterior a esta etapa — 1.768 tarefas sob politica, sem janela.
      --
      -- ⚠️ E HOJE ELA MOSTRA ZERO MINIATURAS: as 16 tarefas com arte nao caem
      -- nas 500 primeiras por prazo. Nao e defeito desta etapa nem desta
      -- consulta; e o teto de 500 fazendo o que ele existe para fazer.
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
     where t.archived_at is null
       and (
         -- O cast para boolean nao e enfeite: sem ele o driver manda o
         -- parametro sem tipo e o Postgres recusa com
         -- "argument of OR must be type boolean".
         ${filtro === 'todas'}::boolean
         or exists (select 1 from ideworks.task_assignees a
                     where a.task_id = t.id and a.user_id = ${eu})
         or (
           t.created_by = ${eu}
           and exists (select 1 from ideworks.task_assignees a
                        where a.task_id = t.id and a.user_id <> ${eu})
         )
       )
       -- A PENEIRA DA F17.55, na MESMA clausula de sempre.
       --
       -- Ela entra aqui, e nao depois: filtrar em JavaScript obrigaria o banco a
       -- mandar para ca o que a pessoa nao alcanca so para o servidor descartar.
       -- O acento sai dos dois lados pela mesma tabela, passada como parametro.
       -- Ver o modulo do filtro em src/board/filtro.ts.
       -- (Sem crase neste comentario: ele vive dentro de um template literal.)
       and (${p.texto}::text is null
            or position(
                 ${p.texto}::text
                 in translate(lower(t.title), ${ACENTOS_DE}, ${ACENTOS_PARA})
               ) > 0)
       and (not ${p.semResponsavel}::boolean
            or not exists (select 1 from ideworks.task_assignees a where a.task_id = t.id))
       and (${p.responsavel}::uuid is null
            or exists (select 1 from ideworks.task_assignees a
                        where a.task_id = t.id and a.user_id = ${p.responsavel}::uuid))
       -- A ABA E O CURSOR — F17.AUD05. So quando a tela pede uma aba; sem
       -- pagina, os dois viram "true" e a consulta e a de sempre. O where da
       -- aba sai da tabela ESPECIFICACAO_DAS_ABAS (ver predicadoDaAba), e a
       -- condicao do cursor e por chave, nao por deslocamento (ver
       -- depoisDoCursor). Nenhum dos dois cita pessoa: eu vem do ator.
       -- (Sem crase neste comentario: ele vive dentro de um template literal.)
       and ${pagina === null ? tx`true` : predicadoDaAba(tx, eu, pagina.aba)}
       and ${pagina?.cursor ? depoisDoCursor(tx, pagina.cursor) : tx`true`}
       ${recorte}
     order by t.due_on nulls last, t.priority nulls last, lower(t.title)${desempate}
     limit ${pagina === null ? TETO_DE_LINHAS : pagina.limite + 1}`;

  return linhas.map((r) => ({
    row: paraWorkRow(r),
    chave: {
      dueOn: (r.due_on as string | null) ?? null,
      priority: (r.priority as Priority | null) ?? null,
      title: (r.sort_title as string | null) ?? '',
      id: r.id as string,
    },
  }));
}

/* ───────────────────────────── as duas leituras ───────────────────────────── */

export type Trabalho = {
  rows: WorkRow[];
  /** Quantas existem ao alcance, mesmo além do teto. Ver o cabeçalho. */
  total: number;
  /**
   * Quantas passaram pelo filtro — F17.55. Igual a `total` quando não há
   * filtro. É o número que a faixa do teto usa: dizer "as 500 primeiras de
   * 1.768" numa busca que achou 12 seria descrever outra tela.
   */
  matched: number;
  /** Verdadeiro quando o teto cortou. A tela precisa DIZER que cortou. */
  capped: boolean;
  /**
   * Quem aparece como responsável no que a pessoa alcança — F17.55.
   *
   * Mesma razão do quadro: um menu montado a partir das 500 linhas que
   * couberam ofereceria só quem calhou de estar nelas. Este é o censo, feito no
   * banco e recortado pela mesma política.
   */
  assigneeOptions: BoardAssigneeOption[];
  /** Quantas não têm ninguém. Hoje, 93% das abertas. */
  unassignedTasks: number;
};

/**
 * QUEM O MENU OFERECE, E QUANTAS TAREFAS TÊM DONO — F17.55, refeito na F17.70.
 *
 * ⚠️ Esta tela tinha o MESMO defeito do quadro: a lista saía só de
 * `task_assignees`, então as dez pessoas sem tarefa nenhuma não apareciam. O
 * conserto é o mesmo, e mora num lugar só — ver
 * `@/server/responsaveis-do-quadro`.
 *
 * O recorte aqui é "tudo o que a pessoa alcança": nenhuma condição além de
 * `archived_at is null`, porque a política de linha de `tasks` já recorta e
 * escrever o alcance de novo seria a dívida 8.1 outra vez.
 */
async function lerResponsaveis(
  tx: Tx,
  recorte: Trecho,
): Promise<{ opcoes: BoardAssigneeOption[]; comDono: number }> {
  // O apelido é `t` (era `k`) para o recorte da F31 caber: ele fala de `t`.
  return lerResponsaveisDoQuadro(
    tx,
    tx`
      select distinct a.task_id, a.user_id
        from ideworks.task_assignees a
        join ideworks.tasks t on t.id = a.task_id
       where t.archived_at is null
         ${recorte}`,
  );
}

/** O que me diz respeito: atribuído a mim, ou criado por mim com responsável. */
export async function readMyWork(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<Trabalho> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const rows = await lerLinhas(tx, actor.userId, 'minhas', tarefaForaDasOmitidas(tx, actor));
    return {
      rows,
      total: rows.length,
      matched: rows.length,
      capped: rows.length >= TETO_DE_LINHAS,
      // `Minhas tarefas` não filtra por responsável — a pergunta dela já é "o
      // que é meu". Oferecer o menu ali seria oferecer uma peneira que só tem
      // uma escolha possível.
      assigneeOptions: [],
      unassignedTasks: 0,
    };
  });
}

/* ───────────────────────────── a página de uma aba ───────────────────────────── */

/**
 * O contrato paginado de `Minhas tarefas` — F17.AUD05.
 *
 * Ele ESTENDE `Trabalho` em vez de substituí-lo: `rows`, `total`, `matched`,
 * `capped`, `assigneeOptions` e `unassignedTasks` continuam vindo com o mesmo
 * sentido, e a tela que só lê `rows` continua funcionando. O que se acrescenta
 * é o que a rede grossa não sabia dizer.
 */
export type PaginaDeTrabalho = Trabalho & {
  /** A aba desta página. */
  aba: Aba;
  /**
   * QUANTAS EXISTEM em cada aba — contadas no banco, sob a mesma política de
   * linha, sobre o conjunto INTEIRO. É este número que o seletor de aba mostra.
   * `total` é `counts[aba]`.
   */
  counts: Record<Aba, number>;
  /** Quantas vieram NESTE lote. Nunca é o total. */
  returned: number;
  hasMore: boolean;
  /** O ponto de continuação, opaco. Presente só quando `hasMore`. */
  nextCursor: string | null;
};

/**
 * As contagens das três abas — F17.AUD05.
 *
 * UMA varredura de `tasks` sob a política, com um `filter` por aba, e não
 * três: é a política que custa, e ela seria paga três vezes. Cada `filter` é o
 * MESMO `predicadoDaAba` do `where` da página — a tabela de abas, lida em SQL —
 * então a contagem e as linhas nunca discordam sobre onde uma tarefa cai.
 *
 * Só `archived_at is null`: os predicados já implicam "me diz respeito"
 * (pendente e feito exigem atribuída a mim; delegado exige criada por mim com
 * outro responsável), então a rede grossa é redundante aqui.
 */
async function contarAbas(tx: Tx, eu: string, recorte: Trecho): Promise<Record<Aba, number>> {
  const [conta] = await tx`
    select count(*) filter (where ${predicadoDaAba(tx, eu, 'pendente')})::int as pendente,
           count(*) filter (where ${predicadoDaAba(tx, eu, 'feito')})::int    as feito,
           count(*) filter (where ${predicadoDaAba(tx, eu, 'delegado')})::int as delegado
      from ideworks.tasks t
     where t.archived_at is null
       ${recorte}`;
  const contas = { pendente: 0, feito: 0, delegado: 0 } satisfies Record<Aba, number>;
  for (const aba of ABAS) contas[aba] = comoNumero(conta?.[aba]);
  return contas;
}

/**
 * Uma página de uma aba de `Minhas tarefas` — F17.AUD05.
 *
 * A aba é filtrada ANTES do limite, então a 501ª pendente aparece; as
 * contagens são do conjunto inteiro, então o seletor diz a verdade; e o lote
 * tem cursor, então tudo fica alcançável. `total` NÃO é `rows.length` — é a
 * contagem da aba.
 *
 * QUEM LÊ VEM DO ATOR, E SÓ DELE. `pedido` traz aba, cursor e limite — nada
 * dele entra em `eu`, e a política de linha continua valendo por `withActor`.
 * Um cursor forjado, no pior caso, começa a página de outro lugar da MESMA
 * aba do MESMO alcance.
 *
 * LINHAS E CONTAGENS SAEM DA MESMA TRANSAÇÃO, sob o mesmo ator, o mesmo
 * `archived_at is null` e a mesma tabela de abas. A transação é a de
 * `withActor` (isolamento padrão), então uma conclusão gravada por outra
 * pessoa ENTRE as duas instruções pode fazer contagem e lote divergirem por
 * um — é a mesma janela, bem menor, que já existe entre dois pedidos de
 * `Carregar mais`, e a AUD06 revalida as contagens a cada lote.
 */
export async function readMyWorkPage(
  sql: Sql,
  actor: AuthenticatedActor,
  pedido: PedidoDePagina,
): Promise<PaginaDeTrabalho> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31 — o MESMO recorte nas contagens e nas linhas: senão o seletor de aba
    // contaria tarefa que a página nunca mostra.
    //
    // PERF DO SERVIDOR, 08/10/2026 — as duas instruções saem na mesma rajada. A
    // contagem não leva parâmetro (o id do ator e o valor de cada fato vão no
    // texto, ver `predicadoDaAba`) e viaja junto com a declaração do ator; a
    // página, que leva cursor e limite como parâmetro, vai por último. Eram 8
    // idas (begin, contagem ×2, página ×2 e commit, mais a declaração); são 4:
    // begin, rajada até a descrição da página, a página, commit.
    const [counts, lidas] = await Promise.all([
      contarAbas(tx, actor.userId, tarefaForaDasOmitidas(tx, actor)),
      lerLinhasComChave(tx, actor.userId, 'minhas', SEM_FILTRO, pedido, tarefaForaDasOmitidas(tx, actor)),
    ]);
    const pagina: Pagina<WorkRow> = montarPagina(lidas, pedido);
    return {
      aba: pedido.aba,
      rows: pagina.rows,
      counts,
      total: counts[pedido.aba],
      matched: counts[pedido.aba],
      returned: pagina.returned,
      hasMore: pagina.hasMore,
      nextCursor: pagina.nextCursor,
      // Não há teto aqui: o que não coube neste lote está no próximo.
      capped: false,
      assigneeOptions: [],
      unassignedTasks: 0,
    };
  });
}

/**
 * O total e o achado de `Todas as tarefas`, da MESMA varredura — F17.55.
 *
 * Sem busca nem responsável as três condições da peneira são verdadeiras para
 * toda linha (`null is null`, `not false`), então `achadas` é o próprio total e
 * a consulta não leva parâmetro nenhum — o caso da abertura da tela. Com
 * peneira, é a expressão de sempre, com a peneira como parâmetro.
 */
async function contarTodas(
  tx: Tx,
  p: ReturnType<typeof paraConsulta>,
  recorte: Trecho,
): Promise<{ total: number; matched: number }> {
  const semPeneira = p.texto === null && !p.semResponsavel && p.responsavel === null;
  const achadas = semPeneira
    ? tx`count(*)::int`
    : tx`count(*) filter (
               where (${p.texto}::text is null
                      or position(
                           ${p.texto}::text
                           in translate(lower(t.title), ${ACENTOS_DE}, ${ACENTOS_PARA})
                         ) > 0)
                 and (not ${p.semResponsavel}::boolean
                      or not exists (select 1 from ideworks.task_assignees a
                                      where a.task_id = t.id))
                 and (${p.responsavel}::uuid is null
                      or exists (select 1 from ideworks.task_assignees a
                                  where a.task_id = t.id
                                    and a.user_id = ${p.responsavel}::uuid))
             )::int`;
  const [conta] = await tx`
    select count(*)::int as total,
           ${achadas} as achadas
      from ideworks.tasks t
     where t.archived_at is null
       ${recorte}`;
  return { total: comoNumero(conta?.total), matched: comoNumero(conta?.achadas) };
}

/**
 * Tudo o que a pessoa alcança — o histórico.
 *
 * O total sai de uma consulta PRÓPRIA, e não de `rows.length`: com teto, o
 * comprimento da lista é o teto, e a tela mostraria "500 tarefas" para sempre.
 * A conta atravessa a mesma política de linha, então ela conta o que a pessoa
 * alcança e nada além.
 */
export async function readAllWork(
  sql: Sql,
  actor: AuthenticatedActor,
  /** A busca por título e o responsável — F17.55. */
  peneira: FiltroDeTarefas = SEM_FILTRO,
): Promise<Trabalho> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31 — tarefa de empresa omitida fora das linhas, do total e do menu de
    // responsáveis. Os três com o mesmo recorte, para os números baterem.
    //
    // PERF DO SERVIDOR, 08/10/2026 — as três leituras saem na mesma rajada, as
    // que não levam parâmetro na frente: o menu de responsáveis, a contagem (sem
    // busca, ela é só `count(*)`, e sem parâmetro) e, por último, as linhas, que
    // levam a peneira como parâmetro. Eram 9 idas (medido no fio); sem busca
    // são 4, com busca 6 (a contagem volta a levar parâmetro).
    const p = paraConsulta(peneira);
    const responsaveis = lerResponsaveis(tx, tarefaForaDasOmitidas(tx, actor));
    const conta = contarTodas(tx, p, tarefaForaDasOmitidas(tx, actor));
    const linhas = lerLinhas(tx, actor.userId, 'todas', tarefaForaDasOmitidas(tx, actor), peneira);
    const [{ opcoes, comDono }, { total, matched }, rows] = await Promise.all([responsaveis, conta, linhas]);

    return {
      rows,
      total,
      matched,
      // O teto cortou o resultado DA BUSCA, e é sobre ele que a faixa fala.
      capped: matched > rows.length,
      assigneeOptions: opcoes,
      unassignedTasks: Math.max(total - comDono, 0),
    };
  });
}
