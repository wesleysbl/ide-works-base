/**
 * O PAINEL DE CONTROLE DOS ADMINS, A LEITURA DA SEMANA — F40, Fase 5.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRÊS BLOCOS, UMA LEITURA
 *   · Para atribuir — cards na etapa "atribuir demanda" (nome sem acento e sem
 *     maiúscula) com prazo na semana, mais os SEM prazo quando a semana pedida
 *     é a atual, por cliente e tipo (inclui "Sem tipo").
 *   · Andamento — por cliente e tipo, quantos cards aguardam atribuição, estão
 *     por fazer, em andamento ou feitos (pelo TIPO da etapa da esteira).
 *   · Faltando — meta da semana (pela cota, ver `semana-do-controle.ts`) menos
 *     os cards da semana daquele cliente e tipo; e os atrasados.
 *
 * QUEM ENTRA
 *   Card = tarefa de nível 1 (subtarefa não é demanda), não arquivada, cujo
 *   cliente (a regra única do F38: o da tarefa, senão o da lista) está ATIVO e
 *   fora das empresas omitidas, e que é de PRODUÇÃO: tem tipo, ou está numa
 *   lista cuja esteira tem "atribuir demanda". Sem esse recorte, as listas
 *   internas (sem tipo, sem obrigação de tipo) entrariam como "Sem tipo".
 *   "Card da semana" para a falta exige tipo e prazo dentro da semana; card em
 *   qualquer etapa conta (inclusive "atribuir demanda"); sem tipo não conta.
 *
 * ATRASADO
 *   Prazo anterior a hoje (São Paulo) e etapa que não é done/closed. Só entram
 *   cards COM tipo ou parados em "atribuir demanda": o legado importado tem
 *   milhares de tarefas vencidas sem tipo, e listá-las afogaria o aviso.
 *   A lista é cortada em `LIMITE_DE_ATRASADOS`; `overdueTotal` diz o total.
 *
 * SÓ ADMIN
 *   `admin` e `super_admin` (D7): `actor.isSuperadmin`. Funcionário recebe 403
 *   ANTES de qualquer consulta.
 *
 * ⚠️ NENHUM `where can_see_...` AQUI — as políticas de linha de `tasks`,
 *   `lists` e `clients` rodam dentro de `withActor`, como nas outras leituras.
 *   Elas são as do DONO, também para o ator de uma concessão: o recorte da
 *   CONEXÃO (empresas e clientes escolhidos no consentimento) o banco não
 *   conhece. Quem lê pela IA passa `recorteDaConexao` (auditoria de
 *   08/10/2026); a tela não passa, e a consulta dela não ganha condição nenhuma.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ACENTOS_DE, ACENTOS_PARA } from '@/board/filtro';
import { BoardRefused } from '@/server/board';
import { clienteDaTarefaSql } from '@/server/cliente-da-tarefa';
import {
  type Actor,
  type Sql,
  type Tx,
  arrayOuNulo,
  inlineBool,
  inlineDate,
  inlineDateList,
  inlineLetras,
  inlineUuidList,
  withActor,
} from '@/server/db';
import { recorteDasOmitidas, tarefaForaDasOmitidas } from '@/server/omitidas';
import {
  type CotaPorTipo,
  TIPOS_COM_META,
  type TipoComMeta,
  diaDeSaoPaulo,
  domingoDaSemana,
  ehDiaValido,
  mesesDaSemana,
  metaDaSemana,
  segundaDaSemana,
  semanaVizinha,
} from '@/server/semana-do-controle';
import { quotasDoCadastro, quotasDoContrato, resolvePlanningQuota } from '@/server/planning-weeks';
import { type AuthenticatedActor, asDbActor } from '@/server/session';
import { TIPOS_DA_TAREFA, type TipoDaTarefa, comoTipoLido } from '@/server/tipo-da-tarefa';

export const LIMITE_DE_ATRASADOS = 200;

export const FRASE_SO_ADMIN = 'O painel de controle da semana é só para administradores.';
export const FRASE_SEMANA_INVALIDA = 'Semana inválida. Use a data da segunda-feira, no formato AAAA-MM-DD.';

/** `null` = "Sem tipo". */
export type TipoDoGrupo = TipoDaTarefa | null;

export type PessoaDoCard = { id: string; name: string };

export type CardParaAtribuir = {
  id: string;
  title: string;
  /** Quem lançou o card (`created_by`). */
  createdBy: PessoaDoCard | null;
  /** O prazo que o captador sugeriu; `null` = "Sem data". */
  suggestedDueOn: string | null;
  list: { id: string; name: string };
};

export type GrupoParaAtribuir = {
  clientId: string;
  clientName: string;
  type: TipoDoGrupo;
  cards: CardParaAtribuir[];
};

export type LinhaDeAndamento = {
  clientId: string;
  clientName: string;
  type: TipoDoGrupo;
  /** Na etapa "atribuir demanda". */
  awaiting: number;
  /** open/unstarted, fora "atribuir demanda". */
  todo: number;
  /** custom. */
  doing: number;
  /** done/closed. */
  done: number;
};

export type LinhaDeFalta = {
  clientId: string;
  clientName: string;
  type: TipoComMeta;
  target: number;
  cards: number;
  /** `max(0, target - cards)`. A tela só destaca quando > 0. */
  missing: number;
};

export type CardAtrasado = {
  id: string;
  title: string;
  dueOn: string;
  clientId: string;
  clientName: string;
  type: TipoDoGrupo;
  list: { id: string; name: string };
  statusName: string | null;
  assignees: PessoaDoCard[];
};

export type ControleDaSemana = {
  week: {
    /** A segunda, `YYYY-MM-DD`. */
    start: string;
    /** O domingo. */
    end: string;
    today: string;
    isCurrent: boolean;
    previous: string;
    next: string;
  };
  toAssign: GrupoParaAtribuir[];
  progress: LinhaDeAndamento[];
  missing: { items: LinhaDeFalta[]; overdue: CardAtrasado[]; overdueTotal: number };
};

/**
 * O parâmetro `semana` → a segunda. Ausente = a semana de hoje. Uma data que
 * não é segunda NORMALIZA para a segunda da semana dela (o link de um dia
 * qualquer leva à semana certa); o que não é data é 400.
 */
export function lerSemana(parametro: string | null | undefined, hoje: string): string {
  if (parametro === null || parametro === undefined || parametro === '') return segundaDaSemana(hoje);
  if (!ehDiaValido(parametro)) throw new BoardRefused(FRASE_SEMANA_INVALIDA, 400);
  return segundaDaSemana(parametro);
}

type Linha = {
  id: string;
  title: string;
  due_on: string | null;
  demand_type: string | null;
  created_by: string | null;
  created_by_name: string | null;
  list_id: string | null;
  list_name: string | null;
  client_id: string;
  client_name: string;
  status_name: string | null;
  status_type: string | null;
  is_assign: boolean;
  assignees: PessoaDoCard[] | string | null;
};

/** A etapa chamada "atribuir demanda" — a MESMA comparação de `list_is_production`. */
const etapaDeAtribuir = (tx: Tx) =>
  tx`translate(lower(btrim(st.name)), ${inlineLetras(tx, ACENTOS_DE)}::text, ${inlineLetras(tx, ACENTOS_PARA)}::text) = 'atribuir demanda'`;

/**
 * Uma lista de ids do recorte, no texto da consulta quando cabe — perf do
 * servidor, 09/10/2026. `arrayOuNulo` fica como era: lista vazia é `null`
 * (nenhum `= any(null)` casa). Lista com mais de 500 ids, ou com um valor fora do
 * formato, continua parâmetro.
 */
const listaDoRecorte = (tx: Tx, v: readonly string[]) => {
  const lista = arrayOuNulo(v);
  return lista === null ? null : inlineUuidList(tx, lista);
};

/**
 * O recorte de uma CONEXÃO de IA sobre o painel — auditoria de 08/10/2026.
 * `null` = sem limite naquele eixo; `[]` = nada. É o `toWorkScope` da
 * concessão, achatado (`adminWeekScopeOf`, em `integrations/admin-semana.ts`).
 */
export type RecorteDaConexao = {
  /** Empresas: a do cliente E a da tarefa (espaço da lista; sem lista, a do cliente). */
  companyIds: readonly string[] | null;
  clientIds: readonly string[] | null;
};

/** O recorte de CLIENTE (`c`) da conexão — ou nada, sem recorte. */
function clienteNoRecorte(tx: Tx, recorte: RecorteDaConexao | undefined) {
  if (!recorte) return tx``;
  return tx`${
    recorte.companyIds === null ? tx`` : tx`and c.category_id = any(${listaDoRecorte(tx, recorte.companyIds)}::uuid[])`
  } ${recorte.clientIds === null ? tx`` : tx`and c.id = any(${listaDoRecorte(tx, recorte.clientIds)}::uuid[])`}`;
}

/** A empresa da TAREFA (`t`, lista `l`) no recorte da conexão — a regra de `empresaDoAlvo`. */
function tarefaNoRecorte(tx: Tx, recorte: RecorteDaConexao | undefined) {
  if (!recorte || recorte.companyIds === null) return tx``;
  return tx`and coalesce((select rec_s.category_id from ideworks.spaces rec_s where rec_s.id = l.space_id),
                         c.category_id) = any(${listaDoRecorte(tx, recorte.companyIds)}::uuid[])`;
}

const ordemDoTipo = (t: TipoDoGrupo): number => (t === null ? TIPOS_DA_TAREFA.length : TIPOS_DA_TAREFA.indexOf(t));
const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

export async function readControleDaSemana(
  sql: Sql,
  actor: AuthenticatedActor,
  semana?: string | null,
  agora: Date = new Date(),
  /**
   * F40, Fase 9 — o ator do BANCO, quando não é o derivado de `actor`: o MCP
   * entra com o ator da concessão (`integration`). As políticas de linha
   * continuam as do dono — o recorte da conexão vem em `recorteDaConexao`.
   * Ausente = o da pessoa, como na tela.
   */
  atorDoBanco?: Actor,
  /** O recorte da conexão de IA. Ausente (a tela) = nenhum trecho a mais na consulta. */
  recorteDaConexao?: RecorteDaConexao,
): Promise<ControleDaSemana> {
  if (!actor.isSuperadmin) throw new BoardRefused(FRASE_SO_ADMIN, 403);

  const hoje = diaDeSaoPaulo(agora);
  const segunda = lerSemana(semana, hoje);
  const domingo = domingoDaSemana(segunda);
  const atual = segunda === segundaDaSemana(hoje);
  const meses = mesesDaSemana(segunda);

  const { linhas, clientes, contratos, cadastro } = await withActor(sql, atorDoBanco ?? asDbActor(actor), async (tx) => {
    // PERF DO SERVIDOR, 09/10/2026 — eram quatro consultas em fila (clientes,
    // contratos, cotas, tarefas), cada uma com os dias, os ids e a tabela de
    // acentos como PARÂMETRO: 12 idas ao banco. Com tudo isso escrito no texto
    // (só o que o código calcula ou o banco mesmo devolveu, em formato
    // estrito — ver `db-literal.ts`), nenhuma leva parâmetro: os clientes e as
    // tarefas, que não dependem um do outro, saem na mesma ida, e os contratos e
    // as cotas, que precisam dos ids dos clientes, saem juntos na seguinte. São 4
    // idas com o begin e o commit.
    const [clientes, linhas] = await Promise.all([
      // Clientes que podem ter meta: ativos, fora das empresas omitidas (F31).
      tx`
      select c.id, c.name
        from ideworks.clients c
       where c.is_active
         ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.category_id <> all(${inlineUuidList(tx, ids)}::uuid[])`)}
         ${clienteNoRecorte(tx, recorteDaConexao)}
       order by c.name`,
      // Uma varredura só: tudo o que os três blocos precisam sai daqui.
      tx`
      select t.id, t.title, t.due_on::text as due_on, t.demand_type::text as demand_type,
             t.created_by, ideworks.display_name(t.created_by) as created_by_name,
             t.list_id, l.name as list_name,
             c.id as client_id, c.name as client_name,
             st.name as status_name, st.type::text as status_type,
             coalesce(${etapaDeAtribuir(tx)}, false) as is_assign,
             coalesce((select jsonb_agg(jsonb_build_object('id', a.user_id,
                                                           'name', ideworks.display_name(a.user_id))
                                        order by ideworks.display_name(a.user_id))
                         from ideworks.task_assignees a
                        where a.task_id = t.id), '[]'::jsonb) as assignees
        from ideworks.tasks t
        left join ideworks.lists l on l.id = t.list_id
        left join ideworks.statuses st on st.id = t.status_id
        join ideworks.clients c on c.id = ${clienteDaTarefaSql(tx)}
       where t.archived_at is null
         and t.parent_id is null
         and c.is_active
         ${tarefaForaDasOmitidas(tx, actor)}
         ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.category_id <> all(${inlineUuidList(tx, ids)}::uuid[])`)}
         ${clienteNoRecorte(tx, recorteDaConexao)}
         ${tarefaNoRecorte(tx, recorteDaConexao)}
         and (t.demand_type is not null or ideworks.list_is_production(t.list_id))
         and (
              t.due_on between ${inlineDate(tx, segunda)}::date and ${inlineDate(tx, domingo)}::date
           or (t.due_on < ${inlineDate(tx, hoje)}::date
               and coalesce(st.type::text, 'open') not in ('done', 'closed')
               and (t.demand_type is not null or coalesce(${etapaDeAtribuir(tx)}, false)))
           or (${inlineBool(tx, atual)}::boolean and t.due_on is null and coalesce(${etapaDeAtribuir(tx)}, false))
         )
       order by t.due_on nulls first, t.id`,
    ]);
    const ids = clientes.map((c) => c.id as string);

    const [contratos, cadastro] = await Promise.all([
      tx`
      select mc.client_id, mc.reference_month::text as month, i.content_type, i.quantity
        from ideworks.month_contracts mc
        left join ideworks.month_contract_items i on i.contract_id = mc.id
       where mc.reference_month = any(${inlineDateList(tx, meses)}::date[])
         and mc.client_id = any(${inlineUuidList(tx, ids)}::uuid[])`,
      tx`
      select client_id, content_type, quantity
        from ideworks.client_quotas
       where quantity > 0
         and client_id = any(${inlineUuidList(tx, ids)}::uuid[])`,
    ]);

    return { linhas: linhas as unknown as Linha[], clientes, contratos, cadastro };
  });

  const tipoDe = (l: Linha): TipoDoGrupo => comoTipoLido(l.demand_type);
  const naSemana = (l: Linha) => l.due_on !== null && l.due_on >= segunda && l.due_on <= domingo;
  const pessoas = (v: Linha['assignees']): PessoaDoCard[] =>
    typeof v === 'string' ? (JSON.parse(v) as PessoaDoCard[]) : (v ?? []);

  /* ── Para atribuir ── */
  const grupos = new Map<string, GrupoParaAtribuir>();
  for (const l of linhas) {
    if (!l.is_assign) continue;
    if (!(naSemana(l) || (l.due_on === null && atual))) continue;
    const tipo = tipoDe(l);
    const chave = `${l.client_id}|${tipo ?? ''}`;
    const grupo = grupos.get(chave) ?? { clientId: l.client_id, clientName: l.client_name, type: tipo, cards: [] };
    grupo.cards.push({
      id: l.id,
      title: l.title,
      createdBy: l.created_by ? { id: l.created_by, name: l.created_by_name ?? '' } : null,
      suggestedDueOn: l.due_on,
      list: { id: l.list_id ?? '', name: l.list_name ?? '' },
    });
    grupos.set(chave, grupo);
  }
  const toAssign = [...grupos.values()].sort(
    (a, b) => porNome(a.clientName, b.clientName) || ordemDoTipo(a.type) - ordemDoTipo(b.type),
  );

  /* ── Andamento ── */
  const andamento = new Map<string, LinhaDeAndamento>();
  for (const l of linhas) {
    if (!naSemana(l)) continue;
    const tipo = tipoDe(l);
    const chave = `${l.client_id}|${tipo ?? ''}`;
    const linha = andamento.get(chave) ?? {
      clientId: l.client_id,
      clientName: l.client_name,
      type: tipo,
      awaiting: 0,
      todo: 0,
      doing: 0,
      done: 0,
    };
    if (l.is_assign) linha.awaiting += 1;
    else if (l.status_type === 'done' || l.status_type === 'closed') linha.done += 1;
    else if (l.status_type === 'custom') linha.doing += 1;
    else linha.todo += 1; // open, unstarted — e a tarefa sem etapa
    andamento.set(chave, linha);
  }
  const progress = [...andamento.values()].sort(
    (a, b) => porNome(a.clientName, b.clientName) || ordemDoTipo(a.type) - ordemDoTipo(b.type),
  );

  /* ── Faltando: a cota é a do Planejamento (contrato do mês → cadastro → nenhuma) ── */
  const contratoDoMes = new Map<string, ReturnType<typeof quotasDoContrato>>();
  for (const mes of meses) {
    contratoDoMes.set(
      mes,
      quotasDoContrato(
        contratos
          .filter((r) => r.month === mes)
          .map((r) => ({
            clientId: r.client_id as string,
            contentType: r.content_type as string | null,
            quantity: Number(r.quantity ?? 0),
          })),
      ),
    );
  }
  const doCadastro = quotasDoCadastro(
    cadastro.map((r) => ({
      clientId: r.client_id as string,
      contentType: r.content_type as string,
      quantity: Number(r.quantity),
    })),
  );

  const cardsPorTipo = new Map<string, number>();
  for (const l of linhas) {
    const tipo = tipoDe(l);
    if (tipo === null || !naSemana(l)) continue;
    const chave = `${l.client_id}|${tipo}`;
    cardsPorTipo.set(chave, (cardsPorTipo.get(chave) ?? 0) + 1);
  }

  const items: LinhaDeFalta[] = [];
  for (const c of clientes) {
    const clientId = c.id as string;
    const meta = metaDaSemana(segunda, (mes): CotaPorTipo => {
      const doMes = contratoDoMes.get(mes);
      return resolvePlanningQuota({
        opened: doMes?.opened.has(clientId) ?? false,
        contract: doMes?.byClient.get(clientId),
        registry: doCadastro.get(clientId),
      }).quota as CotaPorTipo;
    });
    for (const tipo of TIPOS_COM_META) {
      const target = meta[tipo] ?? 0;
      if (target <= 0) continue;
      const cards = cardsPorTipo.get(`${clientId}|${tipo}`) ?? 0;
      items.push({
        clientId,
        clientName: c.name as string,
        type: tipo,
        target,
        cards,
        missing: Math.max(0, target - cards),
      });
    }
  }

  const atrasados: CardAtrasado[] = linhas
    .filter(
      (l) =>
        l.due_on !== null &&
        l.due_on < hoje &&
        l.status_type !== 'done' &&
        l.status_type !== 'closed' &&
        (tipoDe(l) !== null || l.is_assign),
    )
    .sort((a, b) => (a.due_on as string).localeCompare(b.due_on as string) || a.id.localeCompare(b.id))
    .map((l) => ({
      id: l.id,
      title: l.title,
      dueOn: l.due_on as string,
      clientId: l.client_id,
      clientName: l.client_name,
      type: tipoDe(l),
      list: { id: l.list_id ?? '', name: l.list_name ?? '' },
      statusName: l.status_name,
      assignees: pessoas(l.assignees),
    }));

  return {
    week: {
      start: segunda,
      end: domingo,
      today: hoje,
      isCurrent: atual,
      previous: semanaVizinha(segunda, -1),
      next: semanaVizinha(segunda, 1),
    },
    toAssign,
    progress,
    missing: {
      items,
      overdue: atrasados.slice(0, LIMITE_DE_ATRASADOS),
      overdueTotal: atrasados.length,
    },
  };
}
