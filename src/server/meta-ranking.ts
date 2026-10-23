/**
 * O ranking de criativos — etapa F10c.
 *
 * POR QUE ELE NÃO MORA DENTRO DE UMA CONTA
 *   A pergunta é "qual criativo rendeu mais", e ela atravessa contas: o
 *   gerenciador é a unidade que a agência usa para falar de um cliente, e um
 *   gerenciador pode ter mais de uma conta de anúncio. Prender o ranking a uma
 *   conta obrigaria a comparar de cabeça, abrindo uma tela por vez.
 *
 *   Por isso o recorte é o GERENCIADOR, e o `businessName` é o filtro. Ele vem
 *   da própria Meta — não se digita e não se adivinha.
 *
 * A SOMA DAS AÇÕES ACONTECE NO BANCO, E ISSO É DECISÃO
 *   Cada linha diária traz dezenas de tipos de ação. Um gerenciador com 900
 *   linhas viraria dezenas de milhares de objetos trafegando até o navegador
 *   para virar um número. O banco reduz antes de mandar.
 *
 *   Mas a REGRA de qual ação vale continua fora daqui, em `meta/objetivos.ts`,
 *   que é puro e testado. O SQL soma tudo; quem escolhe é o módulo.
 *
 * ALCANCE SOMADO É APROXIMAÇÃO, E A TELA DIZ ISSO
 *   Alcance conta pessoas distintas: somar os dias infla. Para ORDENAR
 *   criativos entre si a distorção é parecida em todos, então a ordem se
 *   sustenta — o número absoluto é que não. A tela mostra "aprox." em cima.
 *   Impressões, cliques e ações somam de verdade.
 */

import { type Sql, withActor } from '@/server/db';
import { contaDaMetaForaDasOmitidas } from '@/server/omitidas';
import { type AuthenticatedActor, asDbActor } from '@/server/session';
import { RelatorioRefused, janelaPedida } from '@/server/meta-relatorio';

export type CriativoNoRanking = {
  adId: string;
  nome: string | null;
  campanha: string | null;
  campanhaId: string | null;
  /** Cru — a família se resolve em `meta/objetivos.ts`. */
  objetivo: string | null;
  conjunto: string | null;
  conta: string | null;
  gerenciador: string | null;
  miniatura: string | null;
  situacao: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  /** Somado entre dias: aproximação. Ver o cabeçalho. */
  alcanceAprox: number | null;
  dias: number;
  acoes: { action_type: string; value: number }[];
};

export type Ranking = {
  gerenciadores: string[];
  /** As empresas que aparecem nas contas visiveis — F13b. */
  empresas: Array<{ id: string; nome: string }>;
  criativos: CriativoNoRanking[];
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export type CampanhaComObjetivo = {
  campaignId: string;
  nome: string | null;
  objetivo: string | null;
  situacao: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  alcanceAprox: number | null;
  criativos: number;
  dias: number;
  acoes: { action_type: string; value: number }[];
};

/**
 * As campanhas de UMA conta, com o objetivo e as ações somadas — F10g.
 *
 * POR QUE NÃO BASTAVA `meta_daily_campaign`
 *   Ela tem `conversions`, um número só, escolhido na coleta por uma regex
 *   sobre o tipo da ação. Serve para um total, e não serve para dizer O QUE
 *   aquele número é: 11 compras e 11 conversas viram a mesma coluna.
 *
 *   As ações cruas só existem no nível do anúncio, e o objetivo só existe na
 *   campanha. Esta consulta junta os dois — e é o que faz cada campanha mostrar
 *   a métrica que ELA persegue.
 *
 * O ALCANCE VEM DA TABELA DE CAMPANHA, NÃO DA SOMA DOS ANÚNCIOS
 *   Somar o alcance dos anúncios de uma campanha conta a mesma pessoa uma vez
 *   por anúncio que ela viu. A linha de campanha já traz o alcance daquele dia
 *   deduplicado entre os anúncios — ainda somado entre DIAS, que é a
 *   aproximação de sempre, mas uma camada menos errada.
 */
export async function readCampanhasComObjetivo(
  sql: Sql,
  actor: AuthenticatedActor,
  assetId: string,
  de: string,
  ate: string,
): Promise<CampanhaComObjetivo[]> {
  const janela = janelaPedida(de, ate);

  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      with por_campanha as (
        select d.campaign_id,
               sum(d.spend)       as spend,
               sum(d.impressions) as impressions,
               sum(d.clicks)      as clicks,
               sum(d.link_clicks) as link_clicks,
               count(distinct d.ad_id) as criativos,
               count(distinct d.day)   as dias
          from ideworks.meta_daily_ad d
         where d.asset_id = ${assetId}
           and d.day between ${janela.de}::date and ${janela.ate}::date
         group by d.campaign_id
      ),
      alcance as (
        -- Da tabela de CAMPANHA: o alcance ali já vem deduplicado entre os
        -- anúncios daquele dia. Ver o cabeçalho.
        select c.campaign_id, sum(c.reach) as alcance
          from ideworks.meta_daily_campaign c
         where c.asset_id = ${assetId}
           and c.day between ${janela.de}::date and ${janela.ate}::date
         group by c.campaign_id
      ),
      acoes as (
        select t.campaign_id,
               jsonb_agg(jsonb_build_object('action_type', t.tipo, 'value', t.valor)) as acoes
          from (
            select d.campaign_id,
                   e->>'action_type'           as tipo,
                   sum((e->>'value')::numeric) as valor
              from ideworks.meta_daily_ad d,
                   lateral jsonb_array_elements(d.actions) e
             where d.asset_id = ${assetId}
               and d.day between ${janela.de}::date and ${janela.ate}::date
               and e->>'action_type' is not null
             group by d.campaign_id, e->>'action_type'
          ) t
         group by t.campaign_id
      )
      select p.campaign_id, c.name, c.objective, c.effective_status,
             p.spend, p.impressions, p.clicks, p.link_clicks,
             p.criativos, p.dias,
             al.alcance,
             coalesce(ac.acoes, '[]'::jsonb) as acoes
        from por_campanha p
        left join ideworks.meta_campaigns c
               on c.asset_id = ${assetId} and c.campaign_id = p.campaign_id
        left join alcance al on al.campaign_id = p.campaign_id
        left join acoes   ac on ac.campaign_id = p.campaign_id
       order by p.spend desc nulls last`;

    return linhas.map(
      (r): CampanhaComObjetivo => ({
        campaignId: r.campaign_id as string,
        nome: (r.name as string | null) ?? null,
        objetivo: (r.objective as string | null) ?? null,
        situacao: (r.effective_status as string | null) ?? null,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        linkClicks: num(r.link_clicks),
        alcanceAprox: num(r.alcance),
        criativos: Number(r.criativos),
        dias: Number(r.dias),
        acoes: (r.acoes as { action_type: string; value: unknown }[]).map((a) => ({
          action_type: a.action_type,
          value: Number(a.value),
        })),
      }),
    );
  });
}

export async function readRanking(
  sql: Sql,
  actor: AuthenticatedActor,
  de: string,
  ate: string,
  gerenciador: string | null,
  /**
   * De qual empresa — F13b. Nulo e "todas as que a pessoa enxerga".
   *
   * Filtra ANTES do gerenciador, e por isso a lista de gerenciadores tambem
   * encolhe: misturar BM da Ide e da Alma Nove num ranking so compara
   * operacoes diferentes, com orcamento e objetivo diferentes.
   */
  empresaId: string | null,
  teto = 200,
): Promise<Ranking> {
  const janela = janelaPedida(de, ate);
  if (teto < 1 || teto > 500) throw new RelatorioRefused('Limite inválido.', 400);

  return withActor(sql, asDbActor(actor), async (tx) => {
    // F31, Fase 3b — as contas omitidas (da empresa omitida, ou ligadas a
    // cliente dela) saem de TUDO o que segue: gerenciadores, empresas e
    // criativos. Pedir `empresa=<omitida>` devolve vazio, como uma empresa sem
    // conta. Sem omitida os recortes são vazios e as consultas, as de antes.
    const foraDasOmitidas = (apelido: 'a' | 'a2' | 'meta_assets') =>
      contaDaMetaForaDasOmitidas(
        tx,
        actor,
        apelido === 'a'
          ? { categoria: tx`a.category_id`, cliente: tx`a.client_id` }
          : apelido === 'a2'
            ? { categoria: tx`a2.category_id`, cliente: tx`a2.client_id` }
            : { categoria: tx`meta_assets.category_id`, cliente: tx`meta_assets.client_id` },
      );

    // A lista de gerenciadores sai das contas que a pessoa ENXERGA. Não há
    // filtro de permissão escrito aqui: a política de `meta_assets` já o faz, e
    // repetir a regra criaria uma segunda verdade para manter em dia.
    const gs = await tx`
      select distinct business_name
        from ideworks.meta_assets
       where kind = 'ad_account' and business_name is not null
         and (${empresaId}::uuid is null or category_id = ${empresaId}::uuid)
         ${foraDasOmitidas('meta_assets')}
       order by business_name`;

    // As EMPRESAS que aparecem nas contas visíveis.
    //
    // Sai das contas, e não do catálogo de empresas: quem só enxerga a Alma
    // Nove não pode receber "Ide" numa lista de escolha — seria oferecer uma
    // porta que a política fecha logo em seguida, e a tela ficaria explicando
    // um vazio que ela mesma causou.
    const es = await tx`
      select distinct c.id, c.name
        from ideworks.meta_assets a
        join ideworks.client_categories c on c.id = a.category_id
       where a.kind = 'ad_account'
         ${foraDasOmitidas('a')}
       order by c.name`;

    const criativos = await tx`
      with base as (
        select d.asset_id, d.ad_id,
               sum(d.spend)                as spend,
               sum(d.impressions)          as impressions,
               sum(d.clicks)               as clicks,
               sum(d.link_clicks)          as link_clicks,
               sum(d.reach)                as alcance_aprox,
               count(distinct d.day)       as dias
          from ideworks.meta_daily_ad d
          join ideworks.meta_assets  a on a.id = d.asset_id
         where d.day between ${janela.de}::date and ${janela.ate}::date
           and (${gerenciador}::text is null or a.business_name = ${gerenciador}::text)
           and (${empresaId}::uuid is null or a.category_id = ${empresaId}::uuid)
           ${foraDasOmitidas('a')}
         group by d.asset_id, d.ad_id
      ),
      -- As acoes somadas por tipo, e devolvidas no MESMO formato que a Meta
      -- manda: uma lista de {action_type, value}. Assim o modulo puro que
      -- decide qual delas vale nao precisa saber que passaram pelo banco.
      acoes as (
        -- AGREGA E PARA. A versao anterior juntava "t" de volta com
        -- meta_daily_ad antes de agrupar — e como aquela tabela tem uma linha
        -- por DIA, cada par (anuncio, tipo de acao) era multiplicado pelo
        -- numero de dias antes de ser reduzido de novo. Com 7.000 linhas
        -- diarias e ~30 tipos de acao cada, a consulta passava de cinco
        -- minutos. A juncao nao servia para nada: "t" ja traz as duas chaves.
        --
        -- (Sem crase nestes comentarios: eles vivem dentro de um template
        -- literal do JavaScript, e uma crase aqui fecha a string.)
        select t.asset_id, t.ad_id,
               jsonb_agg(jsonb_build_object('action_type', t.tipo, 'value', t.valor)) as acoes
          from (
            -- A ORDEM AQUI NÃO É ESTILO.
            --
            -- Misturar juncao por virgula com "join ... on" faz o "on" se
            -- ligar ao item anterior — o lateral — em vez da tabela, e o
            -- Postgres recusa com "invalid reference to FROM-clause entry for
            -- table d2". O join precisa vir ANTES do lateral.
            select d2.asset_id, d2.ad_id,
                   e->>'action_type'                  as tipo,
                   sum((e->>'value')::numeric)        as valor
              from ideworks.meta_daily_ad d2
              join ideworks.meta_assets a2 on a2.id = d2.asset_id
              cross join lateral jsonb_array_elements(d2.actions) e
             where d2.day between ${janela.de}::date and ${janela.ate}::date
               and (${gerenciador}::text is null or a2.business_name = ${gerenciador}::text)
               and (${empresaId}::uuid is null or a2.category_id = ${empresaId}::uuid)
               ${foraDasOmitidas('a2')}
               and e->>'action_type' is not null
             group by d2.asset_id, d2.ad_id, e->>'action_type'
          ) t
         group by t.asset_id, t.ad_id
      )
      select b.ad_id,
             ad.name         as nome,
             ad.adset_name   as conjunto,
             ad.thumbnail_url as miniatura,
             ad.effective_status as situacao,
             c.name          as campanha,
             c.campaign_id   as campanha_id,
             c.objective     as objetivo,
             a.display_name  as conta,
             a.business_name as gerenciador,
             b.spend, b.impressions, b.clicks, b.link_clicks,
             b.alcance_aprox, b.dias,
             coalesce(ac.acoes, '[]'::jsonb) as acoes
        from base b
        join ideworks.meta_assets a  on a.id = b.asset_id
        left join ideworks.meta_ads ad on ad.asset_id = b.asset_id and ad.ad_id = b.ad_id
        left join ideworks.meta_campaigns c
               on c.asset_id = b.asset_id and c.campaign_id = ad.campaign_id
        left join acoes ac on ac.asset_id = b.asset_id and ac.ad_id = b.ad_id
       -- Ordenado por gasto só para o teto cortar o que menos importa. A ordem
       -- que a tela mostra é escolhida lá, pelo critério do ranking.
       order by b.spend desc nulls last
       limit ${teto}`;

    return {
      gerenciadores: gs.map((g) => g.business_name as string),
      empresas: es.map((e) => ({ id: e.id as string, nome: e.name as string })),
      criativos: criativos.map(
        (r): CriativoNoRanking => ({
          adId: r.ad_id as string,
          nome: (r.nome as string | null) ?? null,
          campanha: (r.campanha as string | null) ?? null,
          campanhaId: (r.campanha_id as string | null) ?? null,
          objetivo: (r.objetivo as string | null) ?? null,
          conjunto: (r.conjunto as string | null) ?? null,
          conta: (r.conta as string | null) ?? null,
          gerenciador: (r.gerenciador as string | null) ?? null,
          miniatura: (r.miniatura as string | null) ?? null,
          situacao: (r.situacao as string | null) ?? null,
          spend: num(r.spend),
          impressions: num(r.impressions),
          clicks: num(r.clicks),
          linkClicks: num(r.link_clicks),
          alcanceAprox: num(r.alcance_aprox),
          dias: Number(r.dias),
          acoes: (r.acoes as { action_type: string; value: unknown }[]).map((a) => ({
            action_type: a.action_type,
            value: Number(a.value),
          })),
        }),
      ),
    };
  });
}

/* ─── os anúncios de UMA campanha — F10i ──────────────────────────────────── */

export type AnuncioDaCampanha = {
  adId: string;
  nome: string | null;
  conjunto: string | null;
  miniatura: string | null;
  situacao: string | null;
  /** A publicação do Instagram que ele impulsiona, quando é o caso — F9n. */
  instagramPermalink: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  alcanceAprox: number | null;
  /**
   * QUANDO ELE RODOU DE VERDADE, e não o período pedido.
   *
   * Um anúncio desligado há duas semanas mostraria "0" em quase toda a janela,
   * e o zero seria lido como fracasso. Dizendo "rodou de 12/07 a 28/07", o
   * mesmo número passa a ser o resultado do tempo em que ele existiu.
   */
  primeiroDia: string | null;
  ultimoDia: string | null;
  dias: number;
  acoes: { action_type: string; value: number }[];
};

/**
 * Os anúncios de uma campanha, com o que cada um rendeu.
 *
 * INCLUI OS DESLIGADOS, E É O PONTO
 *   A pergunta que abre esta lista é "qual criativo funcionou", e a resposta
 *   costuma estar num anúncio que já foi pausado. Filtrar por ativo devolveria
 *   só o que está rodando agora — que é justamente o que a pessoa já sabe.
 *
 * O ANÚNCIO SEM ENTREGA NO PERÍODO NÃO SOME
 *   Ele aparece com zero e com o período em branco. Sumir faria a contagem de
 *   criativos da campanha discordar da lista, e alguém iria procurar o que
 *   faltou.
 */
export async function readAnunciosDaCampanha(
  sql: Sql,
  actor: AuthenticatedActor,
  assetId: string,
  campaignId: string,
  de: string,
  ate: string,
): Promise<AnuncioDaCampanha[]> {
  const janela = janelaPedida(de, ate);

  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      with fato as (
        select d.ad_id,
               sum(d.spend)       as spend,
               sum(d.impressions) as impressions,
               sum(d.clicks)      as clicks,
               sum(d.link_clicks) as link_clicks,
               sum(d.reach)       as alcance,
               to_char(min(d.day), 'YYYY-MM-DD') as primeiro,
               to_char(max(d.day), 'YYYY-MM-DD') as ultimo,
               count(distinct d.day) as dias
          from ideworks.meta_daily_ad d
         where d.asset_id = ${assetId}
           and d.campaign_id = ${campaignId}
           and d.day between ${janela.de}::date and ${janela.ate}::date
         group by d.ad_id
      ),
      acoes as (
        select t.ad_id,
               jsonb_agg(jsonb_build_object('action_type', t.tipo, 'value', t.valor)) as acoes
          from (
            select d.ad_id,
                   e->>'action_type'           as tipo,
                   sum((e->>'value')::numeric) as valor
              from ideworks.meta_daily_ad d,
                   lateral jsonb_array_elements(d.actions) e
             where d.asset_id = ${assetId}
               and d.campaign_id = ${campaignId}
               and d.day between ${janela.de}::date and ${janela.ate}::date
               and e->>'action_type' is not null
             group by d.ad_id, e->>'action_type'
          ) t
         group by t.ad_id
      )
      select a.ad_id, a.name, a.adset_name, a.thumbnail_url, a.effective_status,
             a.instagram_permalink,
             f.spend, f.impressions, f.clicks, f.link_clicks, f.alcance,
             f.primeiro, f.ultimo, coalesce(f.dias, 0) as dias,
             coalesce(ac.acoes, '[]'::jsonb) as acoes
        from ideworks.meta_ads a
        left join fato  f  on f.ad_id  = a.ad_id
        left join acoes ac on ac.ad_id = a.ad_id
       where a.asset_id = ${assetId}
         and a.campaign_id = ${campaignId}
       order by f.spend desc nulls last, a.name`;

    return linhas.map(
      (r): AnuncioDaCampanha => ({
        adId: r.ad_id as string,
        nome: (r.name as string | null) ?? null,
        conjunto: (r.adset_name as string | null) ?? null,
        miniatura: (r.thumbnail_url as string | null) ?? null,
        situacao: (r.effective_status as string | null) ?? null,
        instagramPermalink: (r.instagram_permalink as string | null) ?? null,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        linkClicks: num(r.link_clicks),
        alcanceAprox: num(r.alcance),
        // Ja vem como texto do banco — ver a nota na consulta.
        primeiroDia: (r.primeiro as string | null) ?? null,
        ultimoDia: (r.ultimo as string | null) ?? null,
        dias: Number(r.dias ?? 0),
        acoes: (r.acoes as { action_type: string; value: unknown }[]).map((a) => ({
          action_type: a.action_type,
          value: Number(a.value),
        })),
      }),
    );
  });
}
