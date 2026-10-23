-- Desfaz a F9j: o fim volta a ser a hora de início da transação, e a duração
-- registrada volta a ser sempre zero.
create or replace function ideworks.finish_collection_run(
  p_id uuid, p_outcome ideworks.collection_outcome, p_assets_total integer,
  p_assets_ok integer, p_assets_failed integer, p_rows_written integer,
  p_first_error text
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  if p_outcome = 'running' then
    raise exception 'uma execucao nao termina em "running"' using errcode = '22023';
  end if;
  update ideworks.meta_collection_runs
     set finished_at = now(), outcome = p_outcome,
         assets_total = p_assets_total, assets_ok = p_assets_ok,
         assets_failed = p_assets_failed, rows_written = p_rows_written,
         first_error = p_first_error
   where id = p_id;
  if not found then
    raise exception 'execucao nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;
