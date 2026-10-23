-- =============================================================================
-- IDE WORKS — F9j  O livro passa a saber quanto durou cada execução
-- =============================================================================
-- O QUE ESTAVA ERRADO
--   `start_collection_run` e `finish_collection_run` gravavam `now()`. No
--   Postgres, `now()` é a hora de INÍCIO DA TRANSAÇÃO e não avança dentro dela
--   — e a execução inteira roda numa transação só.
--
--   Resultado: as duas pontas recebiam o MESMO instante. As quatro execuções de
--   2026-08-20 têm `started_at` igual a `finished_at`, inclusive a que levou
--   945 segundos.
--
-- POR QUE ISSO IMPORTA MAIS DO QUE PARECE
--   A duração foi exatamente o número que decidiu o desenho do motor: 15,7
--   minutos era o que não cabia no gatilho de tempo, e foi por isso que a
--   coleta passou a rodar em lotes (F9h). O livro registrava esse número como
--   zero.
--
--   Achado ao conferir se o gatilho automático tinha disparado — a coluna que
--   responderia "quanto tempo levou" não respondia nada.
--
-- A MESMA ARMADILHA JÁ TINHA APARECIDO
--   Em `scripts/provar-rodizio.mjs`, onde `now()` não avançar dentro da
--   transação fez uma asserção falhar. Lá a prova foi reordenada; aqui a
--   função passa a ler o relógio de verdade.
-- =============================================================================

create or replace function ideworks.finish_collection_run(
  p_id uuid,
  p_outcome ideworks.collection_outcome,
  p_assets_total integer,
  p_assets_ok integer,
  p_assets_failed integer,
  p_rows_written integer,
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
     set finished_at   = clock_timestamp(),
         outcome       = p_outcome,
         assets_total  = p_assets_total,
         assets_ok     = p_assets_ok,
         assets_failed = p_assets_failed,
         rows_written  = p_rows_written,
         first_error   = p_first_error
   where id = p_id;

  if not found then
    raise exception 'execucao nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;

comment on column ideworks.meta_collection_runs.finished_at is
  'Relogio de verdade (`clock_timestamp`), e nao `now()`: `now()` e a hora de '
  'inicio da TRANSACAO e nao avanca dentro dela, entao inicio e fim saiam '
  'iguais e a duracao aparecia como zero. Ver a migration F9j.';
