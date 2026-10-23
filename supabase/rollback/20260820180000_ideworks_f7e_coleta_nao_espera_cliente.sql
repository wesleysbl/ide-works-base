-- Desfaz a F7e: a coleta volta a exigir cliente atribuído.
--
-- AVISO: isto não é neutro. Com contas sem cliente, o motor volta a ver zero
-- ativos e a coleta passa a terminar com desfecho "ok" e nenhuma linha — e cada
-- dia assim é histórico perdido para sempre, porque a Meta não guarda para trás.
-- Só faz sentido se todas as contas estiverem atribuídas.

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
      join ideworks.clients c on c.id = a.client_id
     where a.is_active
       and c.is_active
       and a.kind in ('instagram_account', 'ad_account')
     order by a.kind, a.external_id;
end;
$fn$;
