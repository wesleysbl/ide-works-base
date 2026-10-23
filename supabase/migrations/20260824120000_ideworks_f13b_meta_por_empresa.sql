-- =============================================================================
-- IDE WORKS — F13b  A área Meta enxerga por EMPRESA
-- =============================================================================
-- O QUE ESTAVA ERRADO
--   O acesso a uma conta da Meta perguntava duas coisas: "é administrador?" ou
--   "enxerga o CLIENTE dela?". As duas falham para o caso real:
--
--     * as 102 contas em produção estão TODAS sem cliente — a ponte com o
--       Sistema IDE é opcional e ninguém a fez ainda;
--     * então quem não administra não via conta nenhuma, nem da própria
--       empresa.
--
--   Resultado prático: uma pessoa da Alma Nove entrava na área Meta e via uma
--   tela vazia, embora existam 61 contas dela.
--
-- A EMPRESA JÁ ERA O EIXO, SÓ NÃO CHEGAVA AQUI
--   `can_see_client` já pergunta pela empresa desde a F14, via
--   `user_categories`. A conta da Meta ganhou empresa própria na F7g. Faltava
--   ligar as duas pontas — e a conta responde pela empresa DELA, que é quem
--   tem o token que a alcança, e não pela empresa de um cliente que talvez nem
--   exista.
--
-- O DEFEITO MAIOR ERA A REPETIÇÃO
--   A mesma condição estava copiada em NOVE políticas: `meta_assets` e as oito
--   tabelas de métrica que penduram nela. Mudar acesso exigia mudar nove
--   lugares, e esquecer um não daria erro — daria vazamento, calado.
--
--   Agora a regra mora em `can_see_asset`, e as nove políticas perguntam a ela.
--   A próxima mudança de acesso é uma linha, num lugar.
--
-- POR QUE ISTO NÃO ENTRA EM RECURSÃO
--   `can_see_asset` consulta `meta_assets`, e é usada na política DE
--   `meta_assets`. Funciona porque ela é SECURITY DEFINER e roda como dona da
--   tabela — e dona de tabela não passa por política. É o mesmo desenho de
--   `can_see_client`, que já fazia isso.
-- =============================================================================

create or replace function ideworks.can_see_asset(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select exists (
    select 1
      from ideworks.meta_assets a
     where a.id = target
       and (
         -- quem administra vê tudo
         ideworks.acting_is_superadmin()

         -- ou enxerga o cliente ao qual a conta foi ligada
         or (a.client_id is not null and ideworks.can_see_client(a.client_id))

         -- ou pertence à EMPRESA da conta. É este ramo que faz a área Meta
         -- funcionar para quem não administra: a conta responde pela empresa
         -- dela — a que tem o token que a alcança —, e não pela empresa de um
         -- cliente que talvez nem exista.
         or (a.category_id is not null and exists (
               select 1 from ideworks.user_categories uc
                where uc.category_id = a.category_id
                  and uc.user_id = ideworks.acting_user_id()))
       )
  )
$fn$;

comment on function ideworks.can_see_asset(uuid) is
  'A UNICA regra de quem enxerga conta da Meta. As nove politicas da area '
  'perguntam a ela — antes a condicao estava copiada nas nove, e esquecer uma '
  'nao daria erro, daria vazamento calado.';

grant execute on function ideworks.can_see_asset(uuid) to ideworks_app;

-- --- as nove políticas passam a perguntar à mesma regra ------------------------
drop policy if exists meta_assets_select on ideworks.meta_assets;
create policy meta_assets_select on ideworks.meta_assets for select
  using (ideworks.can_see_asset(id));

drop policy if exists organic_select on ideworks.meta_daily_organic;
create policy organic_select on ideworks.meta_daily_organic for select
  using (ideworks.can_see_asset(asset_id));

drop policy if exists campaign_select on ideworks.meta_daily_campaign;
create policy campaign_select on ideworks.meta_daily_campaign for select
  using (ideworks.can_see_asset(asset_id));

drop policy if exists campaigns_select on ideworks.meta_campaigns;
create policy campaigns_select on ideworks.meta_campaigns for select
  using (ideworks.can_see_asset(asset_id));

drop policy if exists ads_select on ideworks.meta_ads;
create policy ads_select on ideworks.meta_ads for select
  using (ideworks.can_see_asset(asset_id));

drop policy if exists daily_ad_select on ideworks.meta_daily_ad;
create policy daily_ad_select on ideworks.meta_daily_ad for select
  using (ideworks.can_see_asset(asset_id));

drop policy if exists breakdown_select on ideworks.meta_daily_breakdown;
create policy breakdown_select on ideworks.meta_daily_breakdown for select
  using (ideworks.can_see_asset(asset_id));

drop policy if exists demographics_select on ideworks.meta_follower_demographics;
create policy demographics_select on ideworks.meta_follower_demographics for select
  using (ideworks.can_see_asset(asset_id));

drop policy if exists media_select on ideworks.meta_media;
create policy media_select on ideworks.meta_media for select
  using (ideworks.can_see_asset(asset_id));
