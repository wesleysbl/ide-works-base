-- Desfaz a F9h: a coleta volta a varrer tudo de uma vez.
--
-- AVISO: a varredura completa leva 15,7 minutos (medido em 2026-08-20) e passa
-- do teto de tempo do gatilho da Cloudflare. Desfazer isto sem tambem desligar
-- o cron faz a coleta parar no meio a cada execucao.
drop function if exists ideworks.meta_assets_para_coleta(integer);

create or replace function ideworks.meta_assets_para_coleta()
  returns table(id uuid, kind ideworks.meta_asset_kind, external_id text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  return query
    select a.id, a.kind, a.external_id
      from ideworks.meta_assets a
      left join ideworks.clients c on c.id = a.client_id
     where a.is_active
       and (a.client_id is null or c.is_active)
       and a.kind in ('instagram_account', 'ad_account')
     order by a.kind, a.external_id;
end;
$fn$;

create or replace function ideworks.touch_asset(p_asset_id uuid, p_error text)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  update ideworks.meta_assets
     set last_seen_at = case when p_error is null then now() else last_seen_at end,
         last_error   = p_error,
         updated_at   = now()
   where id = p_asset_id;
end;
$fn$;

alter table ideworks.meta_assets drop column if exists last_attempt_at;
