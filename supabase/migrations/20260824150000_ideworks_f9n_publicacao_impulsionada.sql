-- =============================================================================
-- IDE WORKS — F9n  Saber qual publicacao foi impulsionada
-- =============================================================================
-- O PROBLEMA, E ELE E PIOR DO QUE FALTAR UM ROTULO
--   O Instagram devolve as metricas de uma publicacao INCLUINDO a entrega paga.
--   Nao somos nos que misturamos: vem misturado, e nao ha parametro que separe.
--
--   Entao um post impulsionado aparece como um post organico que explodiu. E e
--   exatamente esse numero que alguem olha para decidir "que tipo de conteudo
--   funciona" — a pergunta que a area existe para responder. Sao 1.290
--   publicacoes de 41 perfis hoje, todas no mesmo balde.
--
-- O VINCULO MORA NO ANUNCIO, E NAO NA PUBLICACAO
--   Podia-se marcar `meta_media.impulsionada = true`. Nao serve: o anuncio muda
--   de estado, e uma marca copiada envelhece — a publicacao ficaria "sempre
--   impulsionada" mesmo depois de a campanha acabar, e nada diria quanto foi
--   investido.
--
--   O criativo do anuncio ja aponta para a publicacao (`effective_instagram_
--   media_id`, conferido contra a API em 2026-08-24). Guardando esse
--   identificador no anuncio, "esta publicacao foi impulsionada?" vira uma
--   juncao — sempre atual, e com o gasto junto.
--
-- O QUE ISTO NAO RESOLVE, E NAO VAI RESOLVER
--   Separar o numero organico do pago DENTRO da publicacao. A Meta nao oferece
--   essa quebra no nivel do post, nem para alcance nem para interacao.
--
--   Subtrair o alcance do anuncio pareceria uma saida e seria pior: a mesma
--   pessoa pode ter sido alcancada pelos dois caminhos, e a subtracao a conta
--   duas vezes. Preferivel marcar, mostrar o investimento, e a tela DIZER que o
--   numero inclui o pago — a inventar uma separacao que o dado nao sustenta.
-- =============================================================================

alter table ideworks.meta_ads
  add column if not exists instagram_media_id text,
  add column if not exists instagram_permalink text;

comment on column ideworks.meta_ads.instagram_media_id is
  'A publicacao do Instagram que este anuncio impulsiona, quando ha uma. Vem do '
  'criativo (`effective_instagram_media_id`). E por ela que se sabe que uma '
  'publicacao teve entrega paga — a metrica do Instagram nao diz.';

create index if not exists meta_ads_por_media_do_instagram
  on ideworks.meta_ads (instagram_media_id)
  where instagram_media_id is not null;

-- --- o anuncio passa a guardar o vinculo --------------------------------------
create or replace function ideworks.upsert_ads_lote(
  p_asset_id uuid, p_itens jsonb
) returns integer
  language plpgsql security definer set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  perform ideworks.assert_collector();

  with entrada as (
    select distinct on (x.ad_id)
           x.ad_id, x.campaign_id, x.adset_name, x.name,
           x.creative_id, x.thumbnail_url, x.effective_status,
           x.instagram_media_id, x.instagram_permalink
      from rows from (
             jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb))
               as (ad_id text, campaign_id text, adset_name text, name text,
                   creative_id text, thumbnail_url text, effective_status text,
                   instagram_media_id text, instagram_permalink text)
           ) with ordinality
           as x(ad_id, campaign_id, adset_name, name, creative_id,
                thumbnail_url, effective_status, instagram_media_id,
                instagram_permalink, ord)
     where x.ad_id is not null
     order by x.ad_id, x.ord desc
  ), gravado as (
    insert into ideworks.meta_ads
      (asset_id, ad_id, campaign_id, adset_name, name, creative_id,
       thumbnail_url, effective_status, instagram_media_id, instagram_permalink)
    select p_asset_id, e.ad_id, e.campaign_id, e.adset_name, e.name,
           e.creative_id, e.thumbnail_url, e.effective_status,
           e.instagram_media_id, e.instagram_permalink
      from entrada e
    on conflict (asset_id, ad_id) do update set
      campaign_id = coalesce(excluded.campaign_id, ideworks.meta_ads.campaign_id),
      adset_name  = coalesce(excluded.adset_name,  ideworks.meta_ads.adset_name),
      name        = coalesce(excluded.name,        ideworks.meta_ads.name),
      creative_id = coalesce(excluded.creative_id, ideworks.meta_ads.creative_id),
      thumbnail_url = coalesce(excluded.thumbnail_url, ideworks.meta_ads.thumbnail_url),
      effective_status = excluded.effective_status,
      -- `coalesce`, e nao sobrescrita: um anuncio pode vir sem o campo numa
      -- coleta (a Meta omite o que nao mudou) e apagar o vinculo faria a
      -- publicacao deixar de ser impulsionada de um dia para o outro.
      instagram_media_id  = coalesce(excluded.instagram_media_id,  ideworks.meta_ads.instagram_media_id),
      instagram_permalink = coalesce(excluded.instagram_permalink, ideworks.meta_ads.instagram_permalink),
      collected_at = now()
    returning 1
  )
  select count(*)::int into v_n from gravado;

  return v_n;
end;
$fn$;

grant execute on function ideworks.upsert_ads_lote(uuid, jsonb) to ideworks_app;

-- --- a pergunta pronta: o que foi impulsionado, e quanto custou ----------------
-- Funcao, e nao coluna: assim a resposta acompanha o anuncio em vez de
-- envelhecer numa marca copiada. Ver o cabecalho.
create or replace function ideworks.impulso_da_publicacao(
  p_media_id text, p_de date, p_ate date
) returns table (anuncios integer, investido numeric, alcance_pago integer)
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select count(distinct a.ad_id)::int,
         coalesce(sum(d.spend), 0)::numeric,
         coalesce(sum(d.reach), 0)::int
    from ideworks.meta_ads a
    left join ideworks.meta_daily_ad d
           on d.asset_id = a.asset_id
          and d.ad_id = a.ad_id
          and d.day between p_de and p_ate
   where a.instagram_media_id = p_media_id
     -- A permissao segue o ATIVO do anuncio, como em todo o resto da area.
     and ideworks.can_see_asset(a.asset_id);
$fn$;

grant execute on function ideworks.impulso_da_publicacao(text, date, date) to ideworks_app;
