/** Notificações lidas com o ator e as políticas de acesso da tarefa.
 * Menções vêm de task_mentions; atribuições e automações de task_events; prazos de tasks;
 * a resposta do cliente pelo link (F42) de approval_rounds.
 * notice_reads guarda a leitura por pessoa. Perder acesso oculta o aviso.
 * As chaves são opacas para a tela, e os nomes são resolvidos ao consultar.
 */

import {
  type Aviso,
  type EventoDeAgente,
  DIAS_DE_ANTECEDENCIA,
} from '@/board/avisos';
// O padrão do teto diário mora com o freio que o aplica (F21.1). Um `50`
// digitado de novo aqui daria dois tetos para um sistema, e o aviso passaria a
// disparar num número que a escrita não usa.
import { DEFAULT_DAILY_WRITE_LIMIT } from '@/integrations/executions';
import { BoardRefused } from '@/server/board';
// O fuso da agência, num lugar só — a mesma constante que o calendário usa. Um
// `America/Sao_Paulo` digitado de novo aqui daria dois fusos para um sistema, e
// eles divergiriam no dia em que a agência mudasse de cidade.
import { AGENCY_TIMEZONE } from '@/server/calendar';
import { type Sql, type Tx, withActor } from '@/server/db';
import { inlineBool, inlineInt, inlineText, inlineUuid, inlineUuidList } from '@/server/db-literal';
import { type AvisoDoControle, avisosDoControleGuardados } from '@/server/avisos-do-controle';
import { recorteDasOmitidas, tarefaForaDasOmitidas } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/**
 * O teto de linhas da caixa.
 *
 * O registro só cresce: uma equipe com automação em cinco listas gera evento
 * todo dia, e a caixa de quem nunca marca nada seria a lista inteira da
 * história. Duzentos rolam sem travar e cobrem folgadamente o tamanho de hoje.
 *
 * A conta de não vistos NÃO passa por este teto — ela é consulta própria, sem
 * limite. Sem isso, a pastilha da barra lateral pararia em 200 para sempre e
 * mentiria justamente para quem tem mais coisa esperando.
 */
export const TETO_DE_AVISOS = 200;

/** O tamanho que a chave do visto não passa. Igual ao da restrição da tabela. */
const TETO_DA_CHAVE = 200;

const comoNumero = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const comoInstante = (v: unknown): string | null =>
  v === null || v === undefined ? null : new Date(v as string).toISOString();

/* ───────────────────────── as fontes, num lugar só ───────────────────── */

/**
 * Quem pede a caixa — o suficiente para o recorte da F31.
 *
 * As fontes de TAREFA terminam com `tarefaForaDasOmitidas`: aviso de tarefa de
 * empresa omitida não aparece nem conta na pastilha. Como o recorte mora no fim
 * de cada fonte, a lista e as duas contagens (a da caixa e a da barra lateral)
 * ficam iguais por construção. A menção do chat não passa por aqui: o chat não
 * tem recorte por empresa (D24).
 */
type QuemLe = Pick<AuthenticatedActor, 'categoriasOmitidas'>;

const deMencao = (tx: Tx, eu: string, quem: QuemLe) => tx`
    from ideworks.task_mentions m
    join ideworks.tasks t on t.id = m.task_id
    left join ideworks.tree tr on tr.list_id = t.list_id
    left join ideworks.notice_reads nr on nr.user_id = ${inlineUuid(tx, eu)}
      and nr.notice_key = 'mention:' || m.id::text
    where m.recipient_id = ${inlineUuid(tx, eu)} and t.archived_at is null
      ${tarefaForaDasOmitidas(tx, quem)}`;

/**
 * Menção no chat — F20.8. Mesmo molde da menção de tarefa: tabela escrita só
 * por gatilho; perder o alcance da conversa (RLS / join) oculta o aviso;
 * mensagem apagada, vencida ou fora da janela não aparece.
 */
const deMencaoChat = (tx: Tx, eu: string) => tx`
    from ideworks.chat_mentions m
    join ideworks.messages msg on msg.id = m.message_id
    join ideworks.conversations c on c.id = m.conversation_id
    left join ideworks.notice_reads nr on nr.user_id = ${inlineUuid(tx, eu)}
      and nr.notice_key = 'chat_mention:' || m.id::text
   where m.recipient_id = ${inlineUuid(tx, eu)}
     and msg.deleted_at is null
     and msg.created_at >= now() - ideworks.chat_retention()`;

/** O histórico guarda somente os novos responsáveis no array, sem duplicar
 * quem já estava. A chave por evento permite uma nova notificação se a pessoa
 * for removida e adicionada novamente; notice_reads mantém a leitura individual.
 */
const deAtribuicao = (tx: Tx, eu: string, quem: QuemLe) => tx`
    from ideworks.task_events e
    join ideworks.tasks t on t.id = e.task_id
    left join ideworks.tree tr on tr.list_id = t.list_id
    left join ideworks.clients cl on cl.id = t.client_id
    left join ideworks.notice_reads nr on nr.user_id = ${inlineUuid(tx, eu)}
      and nr.notice_key = 'assignment:' || e.id::text
    where ${inlineUuid(tx, eu)}::uuid = any(e.added_user_ids)
      and e.actor_id is distinct from ${inlineUuid(tx, eu)}::uuid
      and t.archived_at is null
      ${tarefaForaDasOmitidas(tx, quem)}`;

/**
 * A TAREFA QUE A AUTOMAÇÃO PASSOU PARA MIM.
 *
 * `added_user_id` diz exatamente quem recebeu — é a semente inteira do aviso, e
 * é por isso que esta etapa coube numa tabela só.
 *
 * ⚠️ `removed_user_ids` NÃO É LIDO. Quem PERDEU a tarefa não recebe aviso:
 * "você deixou de cuidar disto" não foi pedido, e aviso que ninguém pediu é
 * ruído que ensina a ignorar a caixa inteira.
 *
 * ⚠️ E NÃO HÁ FILTRO DE TAREFA CONCLUÍDA AQUI, ao contrário do prazo. A regra
 * pode disparar numa etapa que FECHA a tarefa e mandá-la para uma lista onde
 * ela reabre — ou não. "Isto chegou para você" é um fato do passado e não muda
 * de valor com o estado de agora; escondê-lo por causa do estado esconderia o
 * aviso justamente no arranjo que a F17.41 tomou como exemplo.
 *
 * O `left join` com o visto é o que faz a marca ser POR PESSOA: dois leitores
 * do mesmo evento têm dois `nr` diferentes, e nenhum apaga o do outro.
 */
const deAutomacao = (tx: Tx, eu: string, quem: QuemLe) => tx`
    from ideworks.task_events e
    join ideworks.tasks t on t.id = e.task_id
    left join ideworks.tree tr on tr.list_id = t.list_id
    left join ideworks.clients cl on cl.id = t.client_id
    left join ideworks.lists fl on fl.id = e.from_list_id
    left join ideworks.lists tl on tl.id = e.to_list_id
    left join ideworks.statuses ts on ts.id = e.to_status_id
    left join ideworks.notice_reads nr
           on nr.user_id = ${inlineUuid(tx, eu)}
          and nr.notice_key = 'automation:' || e.id::text
   where e.added_user_id = ${inlineUuid(tx, eu)}
     and t.archived_at is null
     ${tarefaForaDasOmitidas(tx, quem)}`;

/**
 * O PRAZO VIRANDO.
 *
 * Sai de `tasks.due_on`, sem dado novo — é o que a etapa mediu antes de
 * escrever.
 *
 * TAREFA CONCLUÍDA NÃO ATRASA, e aqui isso é filtro e não enfeite: é a mesma
 * decisão que `estadoDoPrazo` tomou em `@/board/board`, *"pintar de vermelho o
 * prazo de trabalho já entregue transformaria as tarefas reais numa parede de
 * alarme falso — e alarme que sempre toca deixa de ser lido"*.
 *
 * A janela é aberta para trás de propósito: tarefa atrasada não deixa de ser
 * urgente por ficar velha, então o que já venceu entra sem teto.
 *
 * ⚠️ O DIA É O DA AGÊNCIA, e não o do servidor. `now()` num Worker é UTC: às
 * 21h de Brasília ele já virou o dia seguinte, e a caixa mostraria "Vence hoje"
 * para o que vence amanhã — três horas por dia mentindo.
 */
const dePrazo = (tx: Tx, eu: string, quem: QuemLe) => tx`
    from ideworks.tasks t
    join ideworks.task_assignees a on a.task_id = t.id and a.user_id = ${inlineUuid(tx, eu)}
    left join ideworks.tree tr on tr.list_id = t.list_id
    left join ideworks.clients cl on cl.id = t.client_id
    left join ideworks.notice_reads nr
           on nr.user_id = ${inlineUuid(tx, eu)}
          and nr.notice_key = 'due:' || t.id::text || ':' || t.due_on::text
   where t.archived_at is null
     and t.completed_at is null
     and t.due_on is not null
     and t.due_on <= timezone(${inlineText(tx, AGENCY_TIMEZONE)}, now())::date
                     + ${inlineInt(tx, DIAS_DE_ANTECEDENCIA)}::int
     ${tarefaForaDasOmitidas(tx, quem)}`;

/**
 * O QUE UM AGENTE DE IA FEZ POR MIM — F21.3.
 *
 * ⚠️ NÃO HÁ TABELA NOVA, E NÃO HÁ LINHA DE "EVENTO DE AVISO". Os três casos
 * são FATOS DERIVADOS do registro de escritas que a F16 já guarda:
 *
 *   `move`  → a linha diz `operation = 'move_task'`. Fato direto.
 *   `first` → é a escrita mais antiga daquela concessão: `ordem_total = 1`.
 *   `limit` → é a `teto`-ésima escrita do DIA daquela concessão, isto é, a que
 *             ocupou a última vaga. Ver abaixo por que é esta, e não a recusa.
 *
 * POR QUE O AVISO DE TETO NASCE DA ÚLTIMA ESCRITA QUE PASSOU, E NÃO DA RECUSA
 *   A recusa por teto NÃO VIRA LINHA no registro — e está certo que não vire:
 *   a escrita não aconteceu, e um livro de escritas que anota o que não
 *   aconteceu deixa de poder ser contado (a própria cota o conta). Gravar um
 *   evento só para o aviso criaria um segundo registro do mesmo assunto, que
 *   divergiria do primeiro no dia em que um deles falhasse.
 *
 *   Mas o instante em que o teto foi batido É observável no registro: é a
 *   escrita de número `teto` do dia. A partir dela toda tentativa é recusada.
 *   Um agente em laço bate na parede mil vezes, e a pessoa recebe UM aviso —
 *   que é exatamente o que "sem afogar em ruído" pede. E se ele bateu e nunca
 *   mais tentou, o aviso continua verdadeiro: a cota do dia acabou.
 *
 * O CRUZAMENTO COM OS TRÊS CASOS É UM `cross join` DE CONSTANTES, filtrado por
 * um `case`: uma escrita que valha por dois casos rende DUAS LINHAS, com duas
 * chaves e dois vistos — que é o que a estreia-que-bate-o-teto pede. Um
 * `cross join lateral` com `values` diria a mesma coisa, mas o planejador do
 * Postgres tropeça em referência lateral dentro de `values`; constante fora e
 * condição no `where` é a mesma semântica sem a armadilha.
 *
 * ⚠️ NADA AQUI VEM DO CORPO DO PEDIDO DO AGENTE. O tipo da operação é do
 * contrato, o instante é do relógio do servidor, o teto é da linha da
 * concessão. O modelo não tem como pedir — nem como evitar — o próprio aviso.
 *
 * O TETO É LIDO COM `to_jsonb(g) ->> 'daily_write_limit'`, pelo mesmo motivo da
 * listagem do ledger na F21.2: a migration da F21.1 ainda não está no remoto, e
 * a coluna direta derrubaria a CAIXA DE ENTRADA INTEIRA com um 42703 cru se o
 * deploy chegasse primeiro. Ausente, cai no padrão — que é o teto que a escrita
 * de fato aplica enquanto a coluna não existe.
 *
 * ESCRITA DESFEITA NÃO AVISA. O que o dono já apagou (F21.2) sai da caixa: o
 * aviso existe para pedir uma ação que já foi tomada. O registro continua lá,
 * na tela de conexões — o que some é a cobrança.
 *
 * O DESTINATÁRIO É O DONO DA CONCESSÃO, e não quem observa a tarefa:
 * `e.owner_id = eu`, e mais ninguém. Quem concedeu responde pela escrita; para
 * a equipe, o card mexido é o card mexido, e já existe o selo na conversa.
 *
 * O ALVO É TAREFA, NOTA DO MURAL OU REGISTRO DO HISTÓRICO — F26.6. O registro
 * guarda só o id do alvo; a operação diz de que tabela ele é. Até a F26.5 o
 * alvo era sempre tarefa (comentário e movimento apontam a tarefa), e um
 * `join` INNER com `tasks` deixaria SEM AVISO a estreia e o teto de uma
 * conexão que escrevesse primeiro, ou por último, no mural ou no histórico.
 * Os três `left join` são mutuamente exclusivos pela operação, e o `where`
 * exige que o alvo daquela operação apareça: perder o acesso à tarefa (ou ao
 * cliente da nota e do registro, pelo RLS) oculta o aviso, igual às outras
 * fontes — e tarefa arquivada continua fora. Nota ou registro apagado também
 * some da caixa, como a tarefa que deixou de existir.
 */
const deAgente = (tx: Tx, eu: string, quem: QuemLe) => tx`
    from (
      -- ⚠️ A ORDEM É CONTADA ANTES DE TIRAR O QUE FOI DESFEITO, e essa ordem
      -- importa: desfazer a estreia de uma conexão não promove a segunda
      -- escrita a "primeira", e desfazer uma do dia não muda qual delas
      -- ocupou a última vaga. O que foi desfeito some da CAIXA; ele não
      -- reescreve a história do que aconteceu.
      select z.*
        from (
          select e.id, e.target_id as task_id, e.operation, e.occurred_at, e.result,
                 g.name as grant_name,
                 to_jsonb(e) ->> 'undone_at' as undone_at,
                 coalesce(
                   nullif(to_jsonb(g) ->> 'daily_write_limit', '')::int,
                   ${inlineInt(tx, DEFAULT_DAILY_WRITE_LIMIT)}::int
                 ) as teto,
                 row_number() over (
                   partition by e.grant_id
                   order by e.occurred_at, e.id
                 ) as ordem_total,
                 row_number() over (
                   partition by e.grant_id,
                                (timezone(${inlineText(tx, AGENCY_TIMEZONE)}, e.occurred_at))::date
                   order by e.occurred_at, e.id
                 ) as ordem_do_dia
            from ideworks.integration_executions e
            join ideworks.integration_grants g on g.id = e.grant_id
           where e.owner_id = ${inlineUuid(tx, eu)}
        ) z
       where z.undone_at is null
    ) b
    cross join (values ('move'::text), ('limit'::text), ('first'::text)) as c(caso)
    left join ideworks.tasks t
           on t.id = b.task_id
          and b.operation not in ('add_mural_note', 'update_mural_note',
                                  'add_history_entry', 'update_history_entry')
    left join ideworks.mural_notes mn
           on mn.id = b.task_id
          and b.operation in ('add_mural_note', 'update_mural_note')
    left join ideworks.client_history ch
           on ch.id = b.task_id
          and b.operation in ('add_history_entry', 'update_history_entry')
    left join ideworks.tree tr on tr.list_id = t.list_id
    left join ideworks.clients cl on cl.id = coalesce(t.client_id, mn.client_id, ch.client_id)
    left join ideworks.notice_reads nr
           on nr.user_id = ${inlineUuid(tx, eu)}
          and nr.notice_key = 'agent:' || c.caso || ':' || b.id::text
   where ((t.id is not null and t.archived_at is null) or mn.id is not null or ch.id is not null)
     and case c.caso
           when 'move'  then b.operation = 'move_task'
           when 'limit' then b.teto > 0 and b.ordem_do_dia = b.teto
           else              b.ordem_total = 1
         end
     -- F31: a tarefa pela regra de tarefa; nota e registro pelo cliente.
     ${tarefaForaDasOmitidas(tx, quem)}
     ${recorteDasOmitidas(
       tx,
       quem,
       (ids) => tx`and (t.id is not null or cl.category_id is null
                        or cl.category_id <> all(${inlineUuidList(tx, ids)}::uuid[]))`,
     )}`;

/**
 * O CLIENTE RESPONDEU PELO LINK — F42, Fase 7.
 *
 * SEM TABELA NOVA: o aviso é a própria rodada DECIDIDA (`approved` ou
 * `rejected`). A decisão é única e irrevogável (`decide_approval_round`), então
 * `approval:<round_id>` é uma chave estável — um aviso por decisão, para
 * sempre. Rodada substituída, cancelada ou travada não tem decisão do cliente e
 * fica de fora.
 *
 * PARA QUEM: quem ENVIOU a rodada (`sent_by`) e os RESPONSÁVEIS do card hoje
 * (`task_assignees`). Um `or`, e não duas fontes: quem enviou e também é
 * responsável recebe UM aviso, não dois.
 *
 * O ALCANCE É DO BANCO: a política `approval_rounds_select` só devolve a rodada
 * a quem alcança o card E enxerga o cliente (`can_reach_task_id` e
 * `can_see_client`). Quem enviou e depois perdeu o cliente deixa de ver o
 * aviso — igual às outras fontes, perder o acesso oculta o aviso.
 *
 * O AUTOR É O CLIENTE, e não alguém da equipe: não há "a não ser que fui eu",
 * como na atribuição. O motivo do pedido de ajustes vai como `comment_id`, e o
 * link do aviso cai direto nele.
 */
export const deAprovacao = (tx: Tx, eu: string, quem: QuemLe) => tx`
    from ideworks.approval_rounds r
    join ideworks.tasks t on t.id = r.task_id
    left join ideworks.tree tr on tr.list_id = t.list_id
    left join ideworks.clients cl on cl.id = r.client_id
    left join ideworks.notice_reads nr
           on nr.user_id = ${inlineUuid(tx, eu)}
          and nr.notice_key = 'approval:' || r.id::text
   where r.state in ('approved', 'rejected')
     and r.decided_at is not null
     and (r.sent_by = ${inlineUuid(tx, eu)}::uuid
          or exists (select 1 from ideworks.task_assignees a
                      where a.task_id = r.task_id and a.user_id = ${inlineUuid(tx, eu)}::uuid))
     and t.archived_at is null
     ${tarefaForaDasOmitidas(tx, quem)}`;

/* ───────────────────────────── o controle (F40.8) ───────────────────────── */

/**
 * Os avisos do Controle da semana — SÓ PARA ADMIN, e calculados na leitura da
 * semana atual (fuso de São Paulo), sem robô e sem tabela. UM aviso-resumo; o
 * cálculo (uma leitura da semana, ~1,4 s) fica guardado 5 minutos no isolado.
 *
 * Falha da leitura NÃO derruba a caixa: o admin perde o aviso novo, não os
 * outros cinco tipos.
 */
async function avisosDoControleDe(sql: Sql, actor: AuthenticatedActor): Promise<AvisoDoControle[]> {
  if (!actor.isSuperadmin) return [];
  try {
    return await avisosDoControleGuardados(sql, actor);
  } catch (erro) {
    // A caixa segue sem este aviso, mas NÃO em silêncio: sem uma linha no log,
    // uma leitura da semana que passasse a falhar de vez (prazo, política,
    // coluna) faria o aviso do Controle sumir para todo administrador sem que
    // ninguém soubesse que ele existia.
    console.error('[ide-works] avisos do Controle da semana indisponíveis; a caixa segue sem eles', erro);
    return [];
  }
}

/** Quais das chaves calculadas esta pessoa já marcou: o MESMO `notice_reads`. */
async function chavesVistas(tx: Tx, eu: string, avisos: readonly AvisoDoControle[]): Promise<Set<string>> {
  if (avisos.length === 0) return new Set();
  const chaves = avisos.map((a) => a.key);
  const linhas = await tx`
    select notice_key from ideworks.notice_reads
     where user_id = ${inlineUuid(tx, eu)} and notice_key = any(${chaves}::text[])`;
  return new Set(linhas.map((r) => r.notice_key as string));
}

/* ───────────────────────────── a leitura ───────────────────────────── */

function comoAviso(r: Record<string, unknown>): Aviso {
  return {
    key: r.key as string,
    tipo:
      r.tipo === 'atribuicao'
        ? 'atribuicao'
        : r.tipo === 'mencao'
          ? 'mencao'
          : r.tipo === 'mencao_chat'
            ? 'mencao_chat'
            : r.tipo === 'prazo'
              ? 'prazo'
              : r.tipo === 'agente'
                ? 'agente'
                : r.tipo === 'aprovacao'
                  ? 'aprovacao'
                  : 'automacao',
    taskId: (r.task_id as string | null) ?? '',
    taskTitle: (r.task_title as string | null) ?? '',
    listId: (r.list_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    commentId: (r.comment_id as string | null) ?? null,
    conversationId: (r.conversation_id as string | null) ?? null,
    messageId: (r.message_id as string | null) ?? null,
    listName: (r.list_name as string | null) ?? null,
    clientName: (r.client_name as string | null) ?? null,
    occurredAt: comoInstante(r.occurred_at),
    dueOn: (r.due_on as string | null) ?? null,
    automationName: (r.automation_name as string | null) ?? null,
    fromListName: (r.from_list_name as string | null) ?? null,
    toListName: (r.to_list_name as string | null) ?? null,
    toStatusName: (r.to_status_name as string | null) ?? null,
    agentEvent: (r.agent_event as EventoDeAgente | null) ?? null,
    agentName: (r.agent_name as string | null) ?? null,
    dailyLimit: r.daily_limit === null || r.daily_limit === undefined ? null : comoNumero(r.daily_limit),
    clientId: (r.client_id as string | null) ?? null,
    targetKind:
      r.target_kind === 'mural_note' || r.target_kind === 'history_entry' || r.target_kind === 'task'
        ? r.target_kind
        : null,
    approvalDecision:
      r.approval_decision === 'approved' || r.approval_decision === 'rejected' ? r.approval_decision : null,
    approvalVersion:
      r.approval_version === null || r.approval_version === undefined ? null : comoNumero(r.approval_version),
    seen: r.seen === true,
  };
}

export type Avisos = {
  notices: Aviso[];
  /** Quantos ainda não foram vistos ao alcance, mesmo além do teto. */
  unread: number;
  /** Verdadeiro quando o teto cortou. A tela precisa DIZER que cortou. */
  capped: boolean;
};

/** Cada fonte tem sua consulta e ordem, dentro da mesma transação do ator. */
export async function readNotices(
  sql: Sql,
  actor: AuthenticatedActor,
  incluirVistos: boolean,
): Promise<Avisos> {
  const eu = actor.userId;
  const doControle = await avisosDoControleDe(sql, actor);

  return withActor(sql, asDbActor(actor), async (tx) => {
    const vistasDoControle = await chavesVistas(tx, eu, doControle);
    const controle: Aviso[] = doControle
      .map((a) => ({ ...a, seen: vistasDoControle.has(a.key) }))
      .filter((a) => incluirVistos || !a.seen);
    const controleNaoVisto = doControle.filter((a) => !vistasDoControle.has(a.key)).length;

    const consultaDasMencoes = tx`
      select 'mention:' || m.id::text as key, 'mencao'::text as tipo,
        m.task_id, t.title as task_title, t.list_id, tr.list_name,
        ideworks.display_name(m.actor_id) as actor_name, m.occurred_at,
        case when m.source_type = 'comment' then m.source_id else null end as comment_id,
        (nr.user_id is not null) as seen
      ${deMencao(tx, eu, actor)} and (${inlineBool(tx, incluirVistos)}::boolean or nr.user_id is null)
      order by m.occurred_at desc, m.id desc limit ${inlineInt(tx, TETO_DE_AVISOS)}`;
    const consultaDasMencoesDoChat = tx`
      select 'chat_mention:' || m.id::text as key, 'mencao_chat'::text as tipo,
        m.conversation_id, m.message_id,
        case c.kind
          when 'general' then 'Geral'
          when 'group' then coalesce(nullif(btrim(c.name), ''), 'Grupo')
          else coalesce(
            (
              select ideworks.display_name(cm.user_id)
                from ideworks.conversation_members cm
               where cm.conversation_id = c.id
                 and cm.user_id is distinct from ${inlineUuid(tx, eu)}::uuid
               limit 1
            ),
            'Conversa direta'
          )
        end as task_title,
        case c.kind
          when 'general' then 'Geral'
          when 'group' then coalesce(nullif(btrim(c.name), ''), 'Grupo')
          else 'Direta'
        end as list_name,
        ideworks.display_name(m.actor_id) as actor_name, m.occurred_at,
        (nr.user_id is not null) as seen
      ${deMencaoChat(tx, eu)} and (${inlineBool(tx, incluirVistos)}::boolean or nr.user_id is null)
      order by m.occurred_at desc, m.id desc limit ${inlineInt(tx, TETO_DE_AVISOS)}`;
    const consultaDasAtribuicoes = tx`
      select 'assignment:' || e.id::text as key, 'atribuicao'::text as tipo,
        e.task_id, t.title as task_title, t.list_id, tr.list_name,
        cl.name as client_name, ideworks.display_name(e.actor_id) as actor_name,
        e.occurred_at, (nr.user_id is not null) as seen
      ${deAtribuicao(tx, eu, actor)} and (${inlineBool(tx, incluirVistos)}::boolean or nr.user_id is null)
      order by e.occurred_at desc, e.id desc limit ${inlineInt(tx, TETO_DE_AVISOS)}`;
    const consultaDasAutomacoes = tx`
      select 'automation:' || e.id::text as key,
             'automacao'::text           as tipo,
             e.task_id, t.title as task_title,
             tr.list_name, cl.name as client_name,
             e.occurred_at,
             null::text as due_on,
             e.automation_name,
             fl.name as from_list_name,
             tl.name as to_list_name,
             ts.name as to_status_name,
             (nr.user_id is not null) as seen
        ${deAutomacao(tx, eu, actor)}
        and (${inlineBool(tx, incluirVistos)}::boolean or nr.user_id is null)
       order by e.occurred_at desc, e.id desc
       limit ${inlineInt(tx, TETO_DE_AVISOS)}`;

    const consultaDosPrazos = tx`
      select 'due:' || t.id::text || ':' || t.due_on::text as key,
             'prazo'::text as tipo,
             t.id as task_id, t.title as task_title,
             tr.list_name, cl.name as client_name,
             null::timestamptz as occurred_at,
             t.due_on::text as due_on,
             null::text as automation_name,
             null::text as from_list_name,
             null::text as to_list_name,
             null::text as to_status_name,
             (nr.user_id is not null) as seen
        ${dePrazo(tx, eu, actor)}
        and (${inlineBool(tx, incluirVistos)}::boolean or nr.user_id is null)
       order by t.due_on, lower(t.title)
       limit ${inlineInt(tx, TETO_DE_AVISOS)}`;

    const consultaDosAgentes = tx`
      select 'agent:' || c.caso || ':' || b.id::text as key,
             'agente'::text as tipo,
             -- Tarefa: o título dela, e o link leva à ficha. Nota e registro
             -- (F26.6): o título deles — nunca o texto — e o link leva ao
             -- cliente; a linha de origem diz "Cliente · Mural/Histórico".
             t.id as task_id,
             case when mn.id is not null then coalesce(nullif(btrim(mn.title), ''), 'Nota do mural')
                  when ch.id is not null then ch.title
                  else t.title end as task_title,
             t.list_id,
             case when mn.id is not null then 'Mural'
                  when ch.id is not null then 'Histórico'
                  else tr.list_name end as list_name,
             cl.name as client_name,
             cl.id as client_id,
             case when mn.id is not null then 'mural_note'
                  when ch.id is not null then 'history_entry'
                  else 'task' end as target_kind,
             b.occurred_at,
             case when b.operation = 'add_comment'
                  then b.result ->> 'commentId' else null end as comment_id,
             c.caso as agent_event,
             b.grant_name as agent_name,
             b.teto as daily_limit,
             (nr.user_id is not null) as seen
        ${deAgente(tx, eu, actor)}
        and (${inlineBool(tx, incluirVistos)}::boolean or nr.user_id is null)
       order by b.occurred_at desc, b.id desc, c.caso
       limit ${inlineInt(tx, TETO_DE_AVISOS)}`;

    const consultaDasAprovacoes = tx`
      select 'approval:' || r.id::text as key,
             'aprovacao'::text as tipo,
             r.task_id, t.title as task_title, t.list_id,
             tr.list_name, cl.name as client_name,
             r.decided_at as occurred_at,
             r.decision_comment_id as comment_id,
             r.state::text as approval_decision,
             r.version as approval_version,
             (nr.user_id is not null) as seen
        ${deAprovacao(tx, eu, actor)}
        and (${inlineBool(tx, incluirVistos)}::boolean or nr.user_id is null)
       order by r.decided_at desc, r.id desc
       limit ${inlineInt(tx, TETO_DE_AVISOS)}`;

    // A conta dos não vistos é SEPARADA, e sem teto. Ver `TETO_DE_AVISOS`.
    const consultaDaConta = tx`
      select cast((select count(*) filter (where nr.user_id is null)
                     ${deAutomacao(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${dePrazo(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deMencao(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deMencaoChat(tx, eu)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deAgente(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deAtribuicao(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deAprovacao(tx, eu, actor)}) as int) as unread`;

    // AS OITO LEITURAS SAEM NA MESMA IDA — perf do servidor, 08/10/2026.
    //   Eram oito consultas em fila, cada uma com o id da pessoa (várias vezes)
    //   como parâmetro: ~16 idas para abrir a caixa. Com o id, o fuso, o teto e
    //   o "incluir vistos" no TEXTO (`inlineUuid` e companhia), nenhuma leva
    //   parâmetro, e o driver as envia juntas. O texto de cada uma é o de sempre;
    //   o Postgres as executa na ordem do array, sob o mesmo ator.
    const [mencoes, mencoesChat, atribuicoes, automacoes, prazos, agentes, aprovacoes, [conta]] = await Promise.all([
      consultaDasMencoes,
      consultaDasMencoesDoChat,
      consultaDasAtribuicoes,
      consultaDasAutomacoes,
      consultaDosPrazos,
      consultaDosAgentes,
      consultaDasAprovacoes,
      consultaDaConta,
    ]);

    const notices = [
      ...aprovacoes.map((r) => comoAviso(r as Record<string, unknown>)),
      ...atribuicoes.map((r) => comoAviso(r as Record<string, unknown>)),
      ...mencoes.map((r) => comoAviso(r as Record<string, unknown>)),
      ...mencoesChat.map((r) => comoAviso(r as Record<string, unknown>)),
      ...automacoes.map((r) => comoAviso(r as Record<string, unknown>)),
      ...prazos.map((r) => comoAviso(r as Record<string, unknown>)),
      ...agentes.map((r) => comoAviso(r as Record<string, unknown>)),
      ...controle,
    ];

    return {
      notices,
      unread: comoNumero(conta?.unread) + controleNaoVisto,
      capped:
        atribuicoes.length >= TETO_DE_AVISOS ||
        mencoes.length >= TETO_DE_AVISOS ||
        mencoesChat.length >= TETO_DE_AVISOS ||
        automacoes.length >= TETO_DE_AVISOS ||
        prazos.length >= TETO_DE_AVISOS ||
        agentes.length >= TETO_DE_AVISOS ||
        aprovacoes.length >= TETO_DE_AVISOS,
    };
  });
}

/**
 * Só o número — o que a barra lateral desenha ao lado do nome.
 *
 * Rota própria, e não `readNotices(...).unread`, porque ela roda em toda tela
 * que desenha a barra: trazer duzentas linhas para contar duas seria pagar a
 * caixa inteira para escrever um algarismo.
 */
export async function countUnreadNotices(
  sql: Sql,
  actor: AuthenticatedActor,
): Promise<number> {
  const eu = actor.userId;
  const doControle = await avisosDoControleDe(sql, actor);

  return withActor(sql, asDbActor(actor), async (tx) => {
    const vistas = await chavesVistas(tx, eu, doControle);
    const controleNaoVisto = doControle.filter((a) => !vistas.has(a.key)).length;
    const [conta] = await tx`
      select cast((select count(*) filter (where nr.user_id is null)
                     ${deAutomacao(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${dePrazo(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deMencao(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deMencaoChat(tx, eu)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deAgente(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deAtribuicao(tx, eu, actor)})
                + (select count(*) filter (where nr.user_id is null)
                     ${deAprovacao(tx, eu, actor)}) as int) as unread`;
    return comoNumero(conta?.unread) + controleNaoVisto;
  });
}

/* ───────────────────────────── o visto ───────────────────────────── */

/**
 * Marcar como visto, ou desmarcar. POR PESSOA — o `user_id` é sempre o de quem
 * está lendo, e a política confere que é ele mesmo.
 *
 * ⚠️ SEM `returning`, E ISSO É LIÇÃO PAGA — F17.32b, escrita em
 * `server/client-write.ts`. Quando a política de leitura depende de função
 * `stable`, o `returning` de um `insert` enxerga o retrato do banco de ANTES da
 * instrução, a linha nova não está nele, e o banco recusa com `42501` até para
 * linha própria. Aqui a política de `select` é simples e passaria — mas a
 * resposta não precisa da linha, e não pedir é o hábito certo.
 *
 * `on conflict do nothing` porque marcar duas vezes é o mesmo que marcar uma:
 * dois cliques no mesmo aviso, ou duas abas abertas, não são um erro.
 */
export async function markNotice(
  sql: Sql,
  actor: AuthenticatedActor,
  key: string,
  read: boolean,
): Promise<void> {
  const chave = key.trim();

  // A conferência é de TAMANHO e de VAZIO, e não de gramática: este arquivo é o
  // único lugar que monta a chave, e um analisador aqui seria a segunda versão
  // dela. Chave que não corresponde a aviso nenhum não faz mal — ela só esconde
  // de mim mesmo uma coisa que não existe.
  if (chave === '' || chave.length > TETO_DA_CHAVE) {
    throw new BoardRefused('Não deu para marcar este aviso. Recarregue a caixa e tente de novo.', 400);
  }

  return withActor(sql, asDbActor(actor), async (tx) => {
    if (read) {
      await tx`
        insert into ideworks.notice_reads (user_id, notice_key)
        values (${actor.userId}, ${chave})
        on conflict do nothing`;
      return;
    }

    await tx`
      delete from ideworks.notice_reads
       where user_id = ${actor.userId} and notice_key = ${chave}`;
  });
}
