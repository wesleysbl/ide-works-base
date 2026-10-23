/**
 * A leitura dos relatórios da Meta — etapa F9.
 *
 * Este arquivo faz UMA coisa: entregar as linhas diárias do intervalo pedido.
 * Somar, derivar KPI e desenhar curva é trabalho de `@/meta/relatorio`, que é
 * puro e tem teste. Aqui não se calcula nada — porque o que se calcula no SQL
 * não se confere sem banco, e o que não se confere não se acredita.
 *
 * QUEM VÊ O QUE, ELE NÃO DECIDE
 *   Não há um `where client_id = ...` de permissão em lugar nenhum. As
 *   políticas de `meta_daily_organic` e `meta_daily_campaign` já atravessam
 *   `meta_assets` e aplicam a carteira. Repetir a regra aqui criaria uma
 *   segunda verdade para manter em dia — e a que estivesse errada seria a que
 *   ninguém olhou.
 *
 *   Consequência disso: conta sem cliente atribuído só aparece para
 *   administrador, exatamente como na área Meta. Não é regra deste arquivo, é a
 *   mesma regra de lá.
 *
 * O INTERVALO TEM TETO
 *   Um intervalo grande demais na barra de endereço puxaria a série inteira.
 *   O teto é o mesmo `TETO_DE_DIAS` do módulo puro, e é aplicado antes da
 *   consulta.
 */

import { type DiaDeCampanha, type DiaOrganico, TETO_DE_DIAS } from '@/meta/relatorio';
import { type Sql, withActor } from '@/server/db';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

export class RelatorioRefused extends Error {
  readonly status: 400 | 403 | 404;

  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.name = 'RelatorioRefused';
    this.status = status;
  }
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Recorta o intervalo pedido para algo que se possa servir. */
export function janelaPedida(de: string, ate: string): { de: string; ate: string } {
  if (!DIA.test(de) || !DIA.test(ate)) {
    throw new RelatorioRefused('Intervalo inválido.', 400);
  }
  if (ate < de) throw new RelatorioRefused('O fim vem antes do começo.', 400);

  const limite = new Date(`${de}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + TETO_DE_DIAS - 1);
  const teto = limite.toISOString().slice(0, 10);
  return { de, ate: ate > teto ? teto : ate };
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/* ─── conta de anúncio ─────────────────────────────────────────────────────── */

export type RelatorioPago = {
  conta: { id: string; displayName: string | null; externalId: string } | null;
  dias: DiaDeCampanha[];
};

/**
 * As linhas diárias por campanha de UMA conta de anúncio.
 *
 * A conta é conferida antes: sem esse passo, pedir o relatório de uma conta
 * fora da carteira devolveria uma lista vazia — que se lê como "não gastou
 * nada", quando a verdade é "não é sua". Silêncio ambíguo é pior que recusa.
 */
export async function readRelatorioPago(
  sql: Sql,
  actor: AuthenticatedActor,
  assetId: string,
  de: string,
  ate: string,
): Promise<RelatorioPago> {
  const janela = janelaPedida(de, ate);

  return withActor(sql, asDbActor(actor), async (tx) => {
    const [conta] = await tx`
      select id, display_name, external_id, kind::text as kind
        from ideworks.meta_assets
       where id = ${assetId}`;

    if (!conta) throw new RelatorioRefused('Conta não encontrada ou fora do seu alcance.', 404);
    if (conta.kind !== 'ad_account') {
      throw new RelatorioRefused('Essa conta não é de anúncio.', 400);
    }

    const linhas = await tx`
      select day::text as day, campaign_id, campaign_name,
             spend, reach, impressions, clicks, link_clicks,
             conversions, conversion_value
        from ideworks.meta_daily_campaign
       where asset_id = ${assetId}
         and day between ${janela.de}::date and ${janela.ate}::date
       order by day, campaign_id`;

    return {
      conta: {
        id: conta.id as string,
        displayName: (conta.display_name as string | null) ?? null,
        externalId: conta.external_id as string,
      },
      dias: linhas.map(
        (r): DiaDeCampanha => ({
          day: r.day as string,
          campaignId: r.campaign_id as string,
          campaignName: (r.campaign_name as string | null) ?? null,
          spend: num(r.spend),
          reach: num(r.reach),
          impressions: num(r.impressions),
          clicks: num(r.clicks),
          linkClicks: num(r.link_clicks),
          conversions: num(r.conversions),
          conversionValue: num(r.conversion_value),
        }),
      ),
    };
  });
}

/* ─── as publicações ───────────────────────────────────────────────────────── */

/**
 * Cada publicação da conta, da mais recente para a mais antiga.
 *
 * SEM INTERVALO, E ISSO É DELIBERADO
 *   A métrica de uma publicação é acumulada desde que ela foi ao ar: um reel de
 *   maio continua rendendo alcance em agosto. Recortar pela janela do relatório
 *   esconderia justamente a publicação que ainda está trabalhando — e há conta
 *   na carteira que não publica no feed há dois meses e ficaria vazia para
 *   sempre.
 *
 *   O teto é por quantidade, que é o que limita o custo sem mentir sobre o que
 *   existe.
 */
export async function readPublicacoes(
  sql: Sql,
  actor: AuthenticatedActor,
  assetId: string,
  limite = 120,
): Promise<{ publicacoes: Record<string, unknown>[] }> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const [conta] = await tx`
      select id from ideworks.meta_assets where id = ${assetId}`;
    if (!conta) throw new RelatorioRefused('Conta não encontrada ou fora do seu alcance.', 404);

    // O IMPULSIONAMENTO VEM POR JUNCAO, e nao de uma coluna na publicacao — F9n.
    //
    // A metrica que o Instagram devolve JA INCLUI a entrega paga, e nao ha
    // parametro que separe. Entao o que da para saber e QUE houve pago, e
    // quanto custou — o vinculo mora no anuncio (`instagram_media_id`), que e
    // o unico lado que sabe.
    //
    // Vem por juncao para acompanhar o anuncio em vez de envelhecer numa marca
    // copiada, e o gasto e do periodo INTEIRO da publicacao, nao de uma janela:
    // impulsionamento de mes passado continua explicando o numero de hoje.
    const linhas = await tx`
      select m.id, m.media_id, m.product_type::text as product_type, m.media_type,
             m.permalink, m.caption, m.thumbnail_url,
             m.posted_at, m.reach, m.views, m.likes, m.comments, m.shares, m.saved,
             m.total_interactions, m.profile_visits, m.follows, m.replies, m.navigation,
             i.anuncios, i.investido, i.alcance_pago
        from ideworks.meta_media m
        left join lateral (
          select count(distinct a.ad_id)::int      as anuncios,
                 coalesce(sum(d.spend), 0)::float8 as investido,
                 coalesce(sum(d.reach), 0)::int    as alcance_pago
            from ideworks.meta_ads a
            left join ideworks.meta_daily_ad d
                   on d.asset_id = a.asset_id and d.ad_id = a.ad_id
           where a.instagram_media_id = m.media_id
        ) i on true
       where m.asset_id = ${assetId}
       order by m.posted_at desc nulls last
       limit ${Math.min(Math.max(limite, 1), 500)}`;

    return {
      publicacoes: linhas.map((r) => ({
        id: r.id as string,
        mediaId: r.media_id as string,
        productType: r.product_type as string,
        mediaType: (r.media_type as string | null) ?? null,
        permalink: (r.permalink as string | null) ?? null,
        caption: (r.caption as string | null) ?? null,
        thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
        postedAt: r.posted_at === null ? null : new Date(r.posted_at as string).toISOString(),
        reach: num(r.reach),
        views: num(r.views),
        likes: num(r.likes),
        comments: num(r.comments),
        shares: num(r.shares),
        saved: num(r.saved),
        totalInteractions: num(r.total_interactions),
        profileVisits: num(r.profile_visits),
        follows: num(r.follows),
        replies: num(r.replies),
        navigation: num(r.navigation),

        /**
         * O IMPULSIONAMENTO — F9n.
         *
         * `impulsionada` é `true` quando algum anúncio aponta para esta
         * publicação. Quando é, TODOS os números acima incluem a entrega paga:
         * o Instagram não separa, e não há como separar depois.
         *
         * `alcancePago` NÃO se subtrai de `reach` para achar o orgânico. A mesma
         * pessoa pode ter sido alcançada pelos dois caminhos, e a subtração a
         * conta duas vezes. Ele serve para dar ORDEM DE GRANDEZA — "o alcance
         * pago foi metade do total" —, não para fazer conta.
         */
        impulsionada: Number(r.anuncios ?? 0) > 0,
        anunciosQueImpulsionam: Number(r.anuncios ?? 0),
        investido: r.investido === null ? null : Number(r.investido),
        alcancePago: r.alcance_pago === null ? null : Number(r.alcance_pago),
      })),
    };
  });
}

/* ─── perfil do Instagram ──────────────────────────────────────────────────── */

export type RelatorioOrganico = {
  conta: { id: string; displayName: string | null; externalId: string } | null;
  dias: DiaOrganico[];
  /**
   * O retrato do público, do dia mais recente que existe.
   *
   * Não do dia de HOJE: a coleta gira em lotes, então uma conta pode ter sido
   * visitada ontem e ainda não hoje. Pedir "hoje" devolveria vazio para
   * metade da carteira, e a tela diria "sem demografia" para quem tem.
   */
  demografia: { day: string; dimension: string; bucket: string; value: number }[];
  /** As quebras do dia: seguidor vs não seguidor, e por tipo de conteúdo. */
  quebras: { day: string; metric: string; dimension: string; bucket: string; value: number }[];
};

export async function readRelatorioOrganico(
  sql: Sql,
  actor: AuthenticatedActor,
  assetId: string,
  de: string,
  ate: string,
): Promise<RelatorioOrganico> {
  const janela = janelaPedida(de, ate);

  return withActor(sql, asDbActor(actor), async (tx) => {
    const [conta] = await tx`
      select id, display_name, external_id, kind::text as kind
        from ideworks.meta_assets
       where id = ${assetId}`;

    if (!conta) throw new RelatorioRefused('Conta não encontrada ou fora do seu alcance.', 404);
    if (conta.kind !== 'instagram_account') {
      throw new RelatorioRefused('Essa conta não é do Instagram.', 400);
    }

    const linhas = await tx`
      select day::text as day, reach, views, accounts_engaged,
             total_interactions, follows, unfollows, profile_links_taps,
             likes, comments, shares, saves, followers_total, media_count
        from ideworks.meta_daily_organic
       where asset_id = ${assetId}
         and day between ${janela.de}::date and ${janela.ate}::date
       order by day`;

    // O retrato mais recente que EXISTE, e não o de hoje. Ver o tipo.
    const demografia = await tx`
      select day::text as day, dimension::text as dimension, bucket, value
        from ideworks.meta_follower_demographics
       where asset_id = ${assetId}
         and day = (select max(day) from ideworks.meta_follower_demographics
                     where asset_id = ${assetId})
       order by dimension, value desc`;

    const quebras = await tx`
      select day::text as day, metric, dimension, bucket, value
        from ideworks.meta_daily_breakdown
       where asset_id = ${assetId}
         and day between ${janela.de}::date and ${janela.ate}::date
       order by day, metric, dimension`;

    return {
      demografia: demografia.map((r) => ({
        day: r.day as string,
        dimension: r.dimension as string,
        bucket: r.bucket as string,
        value: Number(r.value),
      })),
      quebras: quebras.map((r) => ({
        day: r.day as string,
        metric: r.metric as string,
        dimension: r.dimension as string,
        bucket: r.bucket as string,
        value: Number(r.value),
      })),
      conta: {
        id: conta.id as string,
        displayName: (conta.display_name as string | null) ?? null,
        externalId: conta.external_id as string,
      },
      dias: linhas.map(
        (r): DiaOrganico => ({
          day: r.day as string,
          reach: num(r.reach),
          views: num(r.views),
          accountsEngaged: num(r.accounts_engaged),
          totalInteractions: num(r.total_interactions),
          follows: num(r.follows),
          unfollows: num(r.unfollows),
          profileLinksTaps: num(r.profile_links_taps),
          likes: num(r.likes),
          comments: num(r.comments),
          shares: num(r.shares),
          saves: num(r.saves),
          followersTotal: num(r.followers_total),
          mediaCount: num(r.media_count),
        }),
      ),
    };
  });
}
