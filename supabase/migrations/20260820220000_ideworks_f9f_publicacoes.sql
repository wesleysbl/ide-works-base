-- =============================================================================
-- IDE WORKS — F9f  Cada publicação, individualmente
-- =============================================================================
-- O QUE A META ENTREGA, MEDIDO EM 2026-08-20
--   `/{ig}/media` traz `media_product_type` (FEED, REELS, STORY) e `media_type`
--   (IMAGE, VIDEO, CAROUSEL_ALBUM) — os dois eixos que separam reel de post de
--   carrossel. Não se adivinha nada: a Meta já classifica.
--
--   `/{media}/insights` de um post real devolveu:
--     reach=2082 views=2882 likes=15 comments=2 shares=1 saved=0
--     total_interactions=19 profile_visits=4 follows=0
--
--   REELS RECUSA `profile_visits` e `follows` — a API responde erro 100 dizendo
--   que não suporta essas duas para esse tipo. Nulo nessas colunas para um reel
--   é "a Meta não dá", não "ninguém visitou".
--
--   STORY responde `reach, views, replies, navigation, total_interactions,
--   shares`.
--
-- UMA LINHA POR PUBLICAÇÃO, NÃO POR DIA
--   A métrica de uma publicação é ACUMULADA desde que ela foi ao ar. Guardar
--   por dia somaria o mesmo alcance vinte vezes. A linha é atualizada a cada
--   coleta.
--
-- POR QUE `greatest` NO CONFLITO
--   Métrica acumulada só sobe. Se uma coleta parcial da Meta devolver um número
--   menor, o `greatest` protege o valor bom que já tínhamos. Isso importa mais
--   para o STORY do que para qualquer outra coisa: ele some em 24 horas, e
--   depois disso o último valor que guardamos é o único que existe no mundo.
--
--   `greatest` ignora nulo, então coleta que não trouxe a métrica não apaga a
--   que já estava.
--
-- É POR ISTO QUE A COLETA PRECISA RODAR TODO DIA
--   Post e reel a Meta mantém. Story, não: 24 horas e acabou. Uma coleta pulada
--   é um dia de stories que ninguém mais vai ver.
-- =============================================================================

create type ideworks.media_product as enum ('FEED', 'REELS', 'STORY', 'AD');

create table ideworks.meta_media (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references ideworks.meta_assets(id) on delete cascade,
  media_id     text not null,
  product_type ideworks.media_product not null,
  -- Texto e nao enum: e o eixo que a Meta mais mexe, e enum novo exige
  -- migration para um valor que ja chegou.
  media_type   text,
  permalink    text,
  caption      text,
  thumbnail_url text,
  posted_at    timestamptz,

  reach              integer,
  views              integer,
  likes              integer,
  comments           integer,
  shares             integer,
  saved              integer,
  total_interactions integer,
  profile_visits     integer,
  follows            integer,
  replies            integer,
  navigation         integer,

  extra        jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  collected_at timestamptz not null default now(),

  unique (asset_id, media_id)
);

create index meta_media_por_data on ideworks.meta_media (asset_id, posted_at desc);
create index meta_media_por_tipo on ideworks.meta_media (asset_id, product_type, posted_at desc);

comment on table ideworks.meta_media is
  'Uma linha por publicacao — reel, post, carrossel, story. STORY e o motivo de '
  'a coleta precisar rodar todo dia: a Meta apaga o story em 24 horas, e o que '
  'nao foi guardado nao volta.';

comment on column ideworks.meta_media.profile_visits is
  'Nulo em REELS por imposicao da Meta: a API recusa explicitamente '
  'profile_visits e follows para esse tipo. Nulo aqui e "a Meta nao da", nao '
  '"ninguem visitou".';

alter table ideworks.meta_media enable row level security;

create policy media_select on ideworks.meta_media for select
  using (exists (select 1 from ideworks.meta_assets a
                  where a.id = asset_id
                    and (ideworks.acting_is_superadmin()
                         or (a.client_id is not null and ideworks.can_see_client(a.client_id)))));

create or replace function ideworks.upsert_media(
  p_asset_id uuid,
  p_media_id text,
  p_product_type ideworks.media_product,
  p_media_type text,
  p_permalink text,
  p_caption text,
  p_thumbnail_url text,
  p_posted_at timestamptz,
  p_metrics jsonb
) returns uuid
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_conhecidas constant text[] := array[
    'reach','views','likes','comments','shares','saved','total_interactions',
    'profile_visits','follows','replies','navigation'
  ];
  v_id uuid;
begin
  perform ideworks.assert_collector();

  insert into ideworks.meta_media (
    asset_id, media_id, product_type, media_type, permalink, caption,
    thumbnail_url, posted_at,
    reach, views, likes, comments, shares, saved, total_interactions,
    profile_visits, follows, replies, navigation, extra, collected_at
  )
  values (
    p_asset_id, p_media_id, p_product_type, p_media_type, p_permalink,
    nullif(btrim(coalesce(p_caption, '')), ''), p_thumbnail_url, p_posted_at,
    (p_metrics->>'reach')::int,
    (p_metrics->>'views')::int,
    (p_metrics->>'likes')::int,
    (p_metrics->>'comments')::int,
    (p_metrics->>'shares')::int,
    (p_metrics->>'saved')::int,
    (p_metrics->>'total_interactions')::int,
    (p_metrics->>'profile_visits')::int,
    (p_metrics->>'follows')::int,
    (p_metrics->>'replies')::int,
    (p_metrics->>'navigation')::int,
    p_metrics - v_conhecidas,
    now()
  )
  on conflict (asset_id, media_id) do update set
    media_type = coalesce(excluded.media_type, ideworks.meta_media.media_type),
    permalink  = coalesce(excluded.permalink,  ideworks.meta_media.permalink),
    caption    = coalesce(excluded.caption,    ideworks.meta_media.caption),
    thumbnail_url = coalesce(excluded.thumbnail_url, ideworks.meta_media.thumbnail_url),
    posted_at  = coalesce(excluded.posted_at,  ideworks.meta_media.posted_at),
    reach = greatest(excluded.reach, ideworks.meta_media.reach),
    views = greatest(excluded.views, ideworks.meta_media.views),
    likes = greatest(excluded.likes, ideworks.meta_media.likes),
    comments = greatest(excluded.comments, ideworks.meta_media.comments),
    shares = greatest(excluded.shares, ideworks.meta_media.shares),
    saved = greatest(excluded.saved, ideworks.meta_media.saved),
    total_interactions = greatest(excluded.total_interactions, ideworks.meta_media.total_interactions),
    profile_visits = greatest(excluded.profile_visits, ideworks.meta_media.profile_visits),
    follows = greatest(excluded.follows, ideworks.meta_media.follows),
    replies = greatest(excluded.replies, ideworks.meta_media.replies),
    navigation = greatest(excluded.navigation, ideworks.meta_media.navigation),
    extra = ideworks.meta_media.extra || excluded.extra,
    collected_at = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

grant select on ideworks.meta_media to ideworks_app;
grant execute on function ideworks.upsert_media(
  uuid, text, ideworks.media_product, text, text, text, text, timestamptz, jsonb) to ideworks_app;
