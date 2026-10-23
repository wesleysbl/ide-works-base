-- =============================================================================
-- IDE WORKS — F44_1  Gravar o dia orgânico não apaga o que a coleta não trouxe
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   Em `ideworks.upsert_organic_day`, regravar um dia que já tem linha passa a
--   MANTER cada métrica que não veio desta vez (`coalesce(novo, antigo)`), e
--   `extra` passa a JUNTAR o antigo com o novo em vez de ser substituído.
--
-- POR QUE (defeito achado na conferência de 08–09/10/2026)
--   A F10f regravava a linha com `x = excluded.x` em quase toda coluna. A coleta
--   só busca as métricas de total (visualizações, contas engajadas,
--   interações, curtidas, comentários, compartilhamentos, salvamentos, toques
--   no link, seguidores ganhos e perdidos) nos últimos 7 dias, mas o alcance
--   vem dos últimos 28. O dia que sai da janela de 7 chega só com `{ reach }`,
--   e a função gravava NULL em todo o resto. A cada batida do gatilho (15 min)
--   todo dia com mais de 7 dias perdia as métricas — que a Meta só guarda por
--   90 dias. Os dias já perdidos voltam pela Fase 3 da F44 (pedir de novo à
--   Meta, dentro dos 90 dias), não por esta migration.
--
--   O PR #2 pôs um paliativo no código (`gravarDiasOrganicos` deixava de mandar
--   o dia só de alcance). Como o coletor não enxerga as linhas — sem ator, a
--   política de leitura esconde —, na prática não mandava nenhum, e a conta
--   nova ficava sem os 28 dias de alcance. Com esta migration o paliativo sai
--   (mesma fase da F44, em `src/server/meta-coleta.ts`).
--
-- COLUNA A COLUNA, NO `on conflict ... do update`
--   reach, views, accounts_engaged, total_interactions, follows, unfollows,
--   profile_links_taps, likes, comments, shares, saves
--       antes: `x = excluded.x`          agora: `coalesce(excluded.x, antigo.x)`
--   followers_total, media_count
--       já eram `coalesce` desde a F10f — sem mudança
--   extra
--       antes: `excluded.extra`          agora: `antigo.extra || excluded.extra`
--       (chave nova entra; chave repetida fica com o valor NOVO; a que não veio
--       — o bruto de `follows_and_unfollows`, também só dos 7 dias — fica)
--   collected_at
--       `now()` — sem mudança: continua dizendo quando o dia foi visto por último
--
-- POR QUE `coalesce` E NÃO `greatest`, COMO EM `upsert_media`
--   Métrica de publicação é acumulada e só sobe. Métrica de DIA não: a Meta
--   revisa o número nas primeiras ~48 h, e as de interação são SALDO (podem
--   cair, e até ficar negativas — ver F7f e F9d). `greatest` congelaria um
--   número alto errado. Com `coalesce` o número que veio vence; o que não veio
--   não apaga.
--
-- O QUE FOI TROCADO
--   Até aqui, "a métrica que não veio na segunda vez fica NULA, não congelada"
--   (`scripts/provar-coleta.mjs`, F8). Agora ela fica com o último valor que a
--   Meta deu para aquele dia. Uma métrica que a Meta aposentar continua nula nos
--   dias NOVOS e mantém o histórico nos antigos. Esta função não apaga mais
--   métrica nenhuma; corrigir um número à mão passa a ser SQL de dono.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--   Não muda assinatura, `security definer`, `search_path`, dono nem
--   permissões (a de `ideworks_app` é reafirmada abaixo; o `PUBLIC` que a F8
--   herdou do padrão fica como está). Não mexe em dado: só a regra de regravar.
--
-- ORDEM DE PUBLICAÇÃO
--   Aplicar ANTES de publicar o Worker sem o paliativo. O Worker antigo (com o
--   paliativo) funciona com esta função; o Worker novo num banco sem ela volta
--   a apagar as métricas a cada coleta.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s.
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261009090000_ideworks_f44_1_organico_nao_apaga.sql`
-- (reverta o Worker antes — ver o aviso lá). Depois de aplicar ou reverter:
-- `node scripts/conferir-schema.mjs --gravar`.
-- =============================================================================

begin;
set local lock_timeout = '5s';

create or replace function ideworks.upsert_organic_day(
  p_asset_id uuid, p_day date, p_metrics jsonb
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_conhecidas constant text[] := array[
    'reach','views','accounts_engaged','total_interactions','follows','unfollows',
    'profile_links_taps','likes','comments','shares','saves',
    'followers_total','media_count','extra'
  ];
  v_extra jsonb;
begin
  perform ideworks.assert_collector();

  v_extra := coalesce(p_metrics->'extra', '{}'::jsonb)
             || (p_metrics - v_conhecidas);

  insert into ideworks.meta_daily_organic (
    asset_id, day, reach, views, accounts_engaged, total_interactions,
    follows, unfollows, profile_links_taps, likes, comments, shares, saves,
    followers_total, media_count, extra, collected_at
  )
  values (
    p_asset_id, p_day,
    (p_metrics->>'reach')::int,
    (p_metrics->>'views')::int,
    (p_metrics->>'accounts_engaged')::int,
    (p_metrics->>'total_interactions')::int,
    (p_metrics->>'follows')::int,
    (p_metrics->>'unfollows')::int,
    (p_metrics->>'profile_links_taps')::int,
    (p_metrics->>'likes')::int,
    (p_metrics->>'comments')::int,
    (p_metrics->>'shares')::int,
    (p_metrics->>'saves')::int,
    (p_metrics->>'followers_total')::int,
    (p_metrics->>'media_count')::int,
    v_extra,
    now()
  )
  on conflict (asset_id, day) do update set
    -- F44_1: TODA metrica e `coalesce(novo, antigo)`. As de total so vem nos
    -- ultimos 7 dias e o alcance nos 28: o dia que sai da janela de 7 chega so
    -- com `reach`, e a substituicao seca gravava NULL no resto a cada coleta.
    -- O que veio vence; o que nao veio fica como estava.
    reach              = coalesce(excluded.reach,              ideworks.meta_daily_organic.reach),
    views              = coalesce(excluded.views,              ideworks.meta_daily_organic.views),
    accounts_engaged   = coalesce(excluded.accounts_engaged,   ideworks.meta_daily_organic.accounts_engaged),
    total_interactions = coalesce(excluded.total_interactions, ideworks.meta_daily_organic.total_interactions),
    follows            = coalesce(excluded.follows,            ideworks.meta_daily_organic.follows),
    unfollows          = coalesce(excluded.unfollows,          ideworks.meta_daily_organic.unfollows),
    profile_links_taps = coalesce(excluded.profile_links_taps, ideworks.meta_daily_organic.profile_links_taps),
    likes              = coalesce(excluded.likes,              ideworks.meta_daily_organic.likes),
    comments           = coalesce(excluded.comments,           ideworks.meta_daily_organic.comments),
    shares             = coalesce(excluded.shares,             ideworks.meta_daily_organic.shares),
    saves              = coalesce(excluded.saves,              ideworks.meta_daily_organic.saves),
    -- Ja eram `coalesce` desde a F10f: so vem carimbados no ULTIMO dia da janela.
    followers_total    = coalesce(excluded.followers_total,    ideworks.meta_daily_organic.followers_total),
    media_count        = coalesce(excluded.media_count,        ideworks.meta_daily_organic.media_count),
    -- `extra` JUNTA: chave nova entra, chave repetida fica com o valor novo, e a
    -- que nao veio (o bruto de seguidores, tambem so dos 7 dias) fica.
    extra              = coalesce(ideworks.meta_daily_organic.extra, '{}'::jsonb)
                         || coalesce(excluded.extra, '{}'::jsonb),
    collected_at       = now();
end;
$fn$;

-- Permissão reafirmada: `create or replace` a mantém, mas o arquivo diz.
grant execute on function ideworks.upsert_organic_day(uuid, date, jsonb) to ideworks_app;

commit;
