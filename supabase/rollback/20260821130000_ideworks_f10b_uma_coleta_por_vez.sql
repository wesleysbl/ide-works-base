-- Desfaz a F10b: volta a permitir duas coletas simultaneas.
--
-- AVISO: elas disputam as mesmas contas e uma morre com lock timeout. Medido em
-- 2026-08-21.
create or replace function ideworks.start_collection_run(p_from date, p_to date)
  returns uuid
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_id uuid;
begin
  perform ideworks.assert_collector();
  insert into ideworks.meta_collection_runs (window_from, window_to)
  values (p_from, p_to)
  returning id into v_id;
  return v_id;
end;
$fn$;
