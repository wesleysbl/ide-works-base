/**
 * Planejamento por semana, para todos os clientes — F35, Fase 2.
 *
 * POR QUE UMA LEITURA PRÓPRIA, E NÃO CAMPOS A MAIS EM `readPlanning`
 *   A aba Mês responde "de quem falta fechar o ritual"; a aba Semana responde
 *   "cliente a cliente, onde a produção está atrás". Esta precisa da cota por
 *   tipo, das peças com dia e dos responsáveis — três consultas que a aba Mês
 *   pagaria à toa a cada abertura. O recorte de quem aparece é o MESMO das duas:
 *   cliente ativo, visível ao ator pela política, fora das empresas omitidas.
 *
 * O SERVIDOR NÃO DIVIDE O MÊS EM SEMANAS
 *   Devolve o mês cru (cota, peças com dia). A divisão em semanas, a meta de
 *   cada uma e o estado (bateu / em risco / abaixo) são regra pura da tela
 *   (`src/painel/planejamento-semanal.ts`), testável sem banco e dependente do
 *   "hoje" de quem olha — que o servidor não deve decidir.
 */

import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { type Sql, inlineDate, inlineUuidList, withActor } from '@/server/db';
import { recorteDasOmitidas } from '@/server/omitidas';
import { firstDayOfMonth } from '@/server/panel';
import type { PlanningRow } from '@/server/planning';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/**
 * De onde veio a cota — para o "?" da coluna Mês poder dizer.
 *
 *   contrato  o mês foi ABERTO: vale o congelado, mesmo vazio (F17.57 — mês
 *             congelado não se reescreve, e zero ali é zero de verdade).
 *   cadastro  o mês não foi aberto, e o cadastro de hoje tem cota > 0.
 *   nenhuma   nem mês aberto, nem cota no cadastro.
 */
export type QuotaSource = 'contrato' | 'cadastro' | 'nenhuma';

/** A mesma forma de `ItemDaGrade` da grade semanal da ficha. */
export type PlanningWeekItem = {
  id: string;
  contentType: string;
  scheduledAt: string | null;
  completedAt: string | null;
  isExtra: boolean;
  title: string | null;
};

export type PlanningWeeksRow = Pick<PlanningRow, 'id' | 'name' | 'categoryId' | 'categoryName' | 'plan'> & {
  owners: { id: string; name: string }[];
  quotaSource: QuotaSource;
  /** Só os tipos com quantidade > 0. Tipo ausente = cota zero. */
  quota: Partial<Record<ContentType, number>>;
  /**
   * O cadastro de hoje tem cota de conteúdo — F17.57.
   *
   * Separa as duas cotas vazias que existem com `quotaSource = 'contrato'`: a de
   * quem não compra conteúdo por mês ("sem cota", neutra) e a de quem compra e
   * viu o mês congelar sem item (um acidente do mês, que a tela pode apontar).
   */
  hasContentContract: boolean;
  items: PlanningWeekItem[];
};

const TIPOS = new Set<string>(CONTENT_TYPES);

/** Cota do mês por tipo — a mesma forma de `CotaDoMes` da tela. */
export type PlanningQuota = Partial<Record<ContentType, number>>;

/**
 * As linhas do contrato do mês → quem tem o mês ABERTO e a cota por cliente.
 * Linha sem item (junção à esquerda) abre o mês com cota vazia; tipo
 * desconhecido ou quantidade 0 não entram na cota.
 *
 * Pura e exportada: a leitura `get_planning_weeks` das integrações monta a cota
 * por aqui, e não por uma segunda conta.
 */
export function quotasDoContrato(
  rows: readonly { clientId: string; contentType: string | null; quantity: number }[],
): { opened: Set<string>; byClient: Map<string, PlanningQuota> } {
  const opened = new Set<string>();
  const byClient = new Map<string, PlanningQuota>();
  for (const r of rows) {
    opened.add(r.clientId);
    const tipo = r.contentType;
    const qtd = Number(r.quantity ?? 0);
    if (tipo === null || !TIPOS.has(tipo) || qtd <= 0) continue;
    const cota = byClient.get(r.clientId) ?? {};
    cota[tipo as ContentType] = (cota[tipo as ContentType] ?? 0) + qtd;
    byClient.set(r.clientId, cota);
  }
  return { opened, byClient };
}

/** As linhas de `client_quotas` (quantidade > 0) → a cota do cadastro por cliente. */
export function quotasDoCadastro(
  rows: readonly { clientId: string; contentType: string; quantity: number }[],
): Map<string, PlanningQuota> {
  const byClient = new Map<string, PlanningQuota>();
  for (const r of rows) {
    if (!TIPOS.has(r.contentType)) continue;
    const cota = byClient.get(r.clientId) ?? {};
    cota[r.contentType as ContentType] = Number(r.quantity);
    byClient.set(r.clientId, cota);
  }
  return byClient;
}

/** De onde vem a cota de UM cliente, e qual é. */
export function resolvePlanningQuota(input: {
  opened: boolean;
  contract: PlanningQuota | undefined;
  registry: PlanningQuota | undefined;
}): { quotaSource: QuotaSource; quota: PlanningQuota; hasContentContract: boolean } {
  const { opened, contract, registry } = input;
  const quotaSource: QuotaSource = opened ? 'contrato' : registry ? 'cadastro' : 'nenhuma';
  return {
    quotaSource,
    quota: quotaSource === 'contrato' ? (contract ?? {}) : quotaSource === 'cadastro' ? (registry ?? {}) : {},
    hasContentContract: registry !== undefined,
  };
}

/**
 * Os responsáveis de cada cliente: a PASTA da lista (time) quando há; sem pasta,
 * a carteira individual (`user_clients`). Pura, como as de cima.
 */
export function donosDoPlanejamento(
  pastas: readonly { clientId: string; folderId: string; folderName: string }[],
  carteira: readonly { clientId: string; userId: string; name: string }[],
): Map<string, { id: string; name: string }[]> {
  const donosDe = new Map<string, { id: string; name: string }[]>();
  const clientesComPasta = new Set<string>();
  for (const r of pastas) {
    const nome = r.folderName.trim();
    if (!nome) continue;
    clientesComPasta.add(r.clientId);
    const lista = donosDe.get(r.clientId) ?? [];
    lista.push({ id: r.folderId, name: nome });
    donosDe.set(r.clientId, lista);
  }
  for (const r of carteira) {
    if (clientesComPasta.has(r.clientId)) continue;
    const lista = donosDe.get(r.clientId) ?? [];
    lista.push({ id: r.userId, name: r.name });
    donosDe.set(r.clientId, lista);
  }
  return donosDe;
}

export async function readPlanningWeeks(
  sql: Sql,
  actor: AuthenticatedActor,
  month: string,
): Promise<PlanningWeeksRow[]> {
  const referenceMonth = firstDayOfMonth(month);

  return withActor(sql, asDbActor(actor), async (tx) => {
    // O mesmo recorte da aba Mês (`readPlanning`): ativo, visível pela política
    // de `clients`, fora das empresas omitidas (F31).
    const clientes = await tx`
      select c.id, c.name, c.category_id, cat.name as category_name,
             p.id as plan_id, p.name as plan_name,
             p.color_bg, p.color_text, p.color_border
        from ideworks.clients c
        join ideworks.client_categories cat on cat.id = c.category_id
        left join ideworks.plans p on p.id = c.plan_id
       where c.is_active
         ${recorteDasOmitidas(tx, actor, (ids) => tx`and c.category_id <> all(${inlineUuidList(tx, ids)}::uuid[])`)}
       order by c.name`;

    if (clientes.length === 0) return [];

    // AS CINCO LEITURAS SEGUINTES SAEM JUNTAS — perf do servidor, 08/10/2026.
    //   Eram cinco consultas em fila, cada uma com a lista de ids (ou o mês)
    //   como parâmetro: duas idas por consulta com `prepare: false`. Os ids e o
    //   mês vão agora no TEXTO (`inlineUuidList`, `inlineDate`; fora do formato
    //   seguem como parâmetro) e as cinco saem na mesma ida. O texto de cada
    //   uma é o de sempre, sob o mesmo ator e a mesma política de linha.
    const ids = inlineUuidList(tx, clientes.map((c) => c.id as string));
    const mes = inlineDate(tx, referenceMonth);

    const [contratos, cotas, pastas, donos, itens] = await Promise.all([
      // Mês ABERTO é ter a linha do contrato, com ou sem item — a mesma regra do
      // painel e da ficha desde a F17.57. Junção à esquerda para o contrato vazio
      // aparecer como "aberto, cota zero", e não sumir.
      tx`
      select mc.client_id, i.content_type, i.quantity
        from ideworks.month_contracts mc
        left join ideworks.month_contract_items i on i.contract_id = mc.id
       where mc.reference_month = ${mes}
         and mc.client_id = any(${ids}::uuid[])`,

      // O cadastro de HOJE: é a cota de quem ainda não abriu o mês, e é o que
      // separa "não contrata conteúdo" de "contratou e o mês congelou vazio".
      tx`
      select client_id, content_type, quantity
        from ideworks.client_quotas
       where quantity > 0
         and client_id = any(${ids}::uuid[])`,

      // Pastas / Times dos clientes: no IDE Works, a agência organiza os clientes
      // em pastas através das listas do quadro (`lists.client_id` -> `lists.folder_id` -> `folders.name`),
      // tais como "TIME CARLA", "TIME HELENA". Se o cliente tiver lista numa pasta ativa,
      // essa pasta é o time/responsável do cliente na agência.
      tx`
      select distinct l.client_id, f.id as folder_id, f.name as folder_name
        from ideworks.lists l
        join ideworks.folders f on f.id = l.folder_id
       where l.client_id = any(${ids}::uuid[])
         and l.archived_at is null
         and f.archived_at is null
       order by f.name`,

      // Responsáveis da carteira individual (`user_clients`), sob a política de quem lê:
      // `user_clients_select` usa `can_see_person` (F17.34), então quem não
      // administra só enxerga a PRÓPRIA linha. O nome vem de `display_name`, que
      // é `security definer` justamente porque `profiles_select` esconde os
      // perfis alheios — sem ela o nome viria vazio em silêncio.
      tx`
      select uc.client_id, uc.user_id, ideworks.display_name(uc.user_id) as name
        from ideworks.user_clients uc
       where uc.client_id = any(${ids}::uuid[])
       order by 3`,

      // Só o mês de REFERÊNCIA, como a grade semanal da ficha
      // (`client-detail.ts`): a peça pertence ao contrato do mês dela. Uma peça de
      // setembro agendada em 1º de outubro não conta na cota de outubro.
      tx`
      select id, client_id, content_type, scheduled_at, completed_at, is_extra, title
        from ideworks.content_items
       where reference_month = ${mes}
         and client_id = any(${ids}::uuid[])
       order by scheduled_at nulls last, created_at`,
    ]);

    const { opened: abertos, byClient: doContrato } = quotasDoContrato(
      contratos.map((r) => ({
        clientId: r.client_id as string,
        contentType: r.content_type as string | null,
        quantity: Number(r.quantity ?? 0),
      })),
    );
    const doCadastro = quotasDoCadastro(
      cotas.map((r) => ({
        clientId: r.client_id as string,
        contentType: r.content_type as string,
        quantity: Number(r.quantity),
      })),
    );
    const donosDe = donosDoPlanejamento(
      pastas.map((r) => ({
        clientId: r.client_id as string,
        folderId: r.folder_id as string,
        folderName: (r.folder_name as string | null) ?? '',
      })),
      donos.map((r) => ({
        clientId: r.client_id as string,
        userId: r.user_id as string,
        name: (r.name as string | null) ?? '',
      })),
    );

    const itensDe = new Map<string, PlanningWeekItem[]>();
    for (const r of itens) {
      const lista = itensDe.get(r.client_id as string) ?? [];
      lista.push({
        id: r.id as string,
        contentType: r.content_type as string,
        scheduledAt: r.scheduled_at ? new Date(r.scheduled_at as string).toISOString() : null,
        completedAt: r.completed_at ? new Date(r.completed_at as string).toISOString() : null,
        isExtra: r.is_extra as boolean,
        title: (r.title as string | null) ?? null,
      });
      itensDe.set(r.client_id as string, lista);
    }

    return clientes.map((c) => {
      const id = c.id as string;
      const { quotaSource, quota, hasContentContract } = resolvePlanningQuota({
        opened: abertos.has(id),
        contract: doContrato.get(id),
        registry: doCadastro.get(id),
      });
      return {
        id,
        name: c.name as string,
        categoryId: c.category_id as string,
        categoryName: c.category_name as string,
        plan:
          c.plan_id === null
            ? null
            : {
                id: c.plan_id as string,
                name: c.plan_name as string,
                colorBg: c.color_bg as string,
                colorText: c.color_text as string,
                colorBorder: c.color_border as string,
              },
        owners: donosDe.get(id) ?? [],
        quotaSource,
        quota,
        hasContentContract,
        items: itensDe.get(id) ?? [],
      };
    });
  });
}
