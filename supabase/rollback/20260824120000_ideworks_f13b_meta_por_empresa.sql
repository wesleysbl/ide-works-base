-- =============================================================================
-- ROLLBACK da F13b — a area Meta por empresa
-- =============================================================================
-- VOLTA A REGRA ANTIGA, e com ela o defeito: as 102 contas estao TODAS sem
-- cliente, entao quem nao administra volta a ver tela vazia — inclusive na
-- propria empresa.
--
-- A repeticao tambem volta: a mesma condicao em nove politicas, que era o que
-- tornava qualquer mudanca de acesso arriscada.
-- =============================================================================

drop policy if exists meta_assets_select on ideworks.meta_assets;
create policy meta_assets_select on ideworks.meta_assets for select
  using (ideworks.acting_is_superadmin()
         or (client_id is not null and ideworks.can_see_client(client_id)));

do $$
declare t text; c text;
begin
  for t, c in
    select unnest(array['meta_daily_organic','meta_daily_campaign','meta_campaigns',
                        'meta_ads','meta_daily_ad','meta_daily_breakdown',
                        'meta_follower_demographics','meta_media']),
           unnest(array['organic_select','campaign_select','campaigns_select',
                        'ads_select','daily_ad_select','breakdown_select',
                        'demographics_select','media_select'])
  loop
    execute format('drop policy if exists %I on ideworks.%I', c, t);
    execute format($f$
      create policy %I on ideworks.%I for select
        using (exists (select 1 from ideworks.meta_assets a
                        where a.id = asset_id
                          and (ideworks.acting_is_superadmin()
                               or (a.client_id is not null
                                   and ideworks.can_see_client(a.client_id)))))
    $f$, c, t);
  end loop;
end $$;

drop function if exists ideworks.can_see_asset(uuid);
