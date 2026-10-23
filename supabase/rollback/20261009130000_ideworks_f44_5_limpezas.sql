-- =============================================================================
-- ROLLBACK — F44.5  As limpezas dos limitadores e a coleta que trancava a seguinte
-- =============================================================================
-- Devolve o banco ao retrato de `supabase/schema-esperado.json` de 09/10:
--   · `purge_integration_rate_events` e `purge_auth_attempts` saem;
--   · `start_collection_run` volta aos 15 minutos, com o corpo exatamente como
--     estava em produção (os comentários de dentro inclusive — o retrato guarda
--     o corpo com eles, e sem eles `conferir-schema` acusaria diferença).
--
-- ⚠️ O WORKER DESTA ETAPA CHAMA AS DUAS LIMPEZAS uma vez por dia. Sem as
-- funções, ele só registra no log que a limpeza falhou — a coleta e o resto do
-- gatilho seguem. Reverter a publicação também é opcional; o que se perde é só
-- a limpeza, e as duas tabelas voltam a só crescer.
--
-- ⚠️ E a execução de coleta que morre sem fechar volta a trancar a batida
-- seguinte (15 min de bloqueio contra um gatilho de 15 min).
--
-- Depois: node scripts/conferir-schema.mjs (o retrato de 09/10 volta a bater).
-- =============================================================================

begin;
set local lock_timeout = '5s';

drop function if exists ideworks.purge_integration_rate_events(integer);
drop function if exists ideworks.purge_auth_attempts(integer);

create or replace function ideworks.start_collection_run(p_from date, p_to date)
  returns uuid
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_id uuid;
  v_ativa timestamptz;
begin
  perform ideworks.assert_collector();

  -- UMA EXECUCAO ABANDONADA NAO PODE TRANCAR PARA SEMPRE.
  --
  -- Se uma execucao morrer sem fechar, a linha fica em `running` eternamente.
  -- Quinze minutos e o teto: a execucao tem orcamento de quatro, entao passou
  -- disso ela nao esta rodando — esta morta.
  select started_at into v_ativa
    from ideworks.meta_collection_runs
   where outcome = 'running'
     and started_at > now() - interval '15 minutes'
   order by started_at desc
   limit 1;

  if v_ativa is not null then
    raise exception 'ja ha uma coleta em andamento desde %', v_ativa
      using errcode = '55006';  -- object_in_use
  end if;

  insert into ideworks.meta_collection_runs (window_from, window_to)
  values (p_from, p_to)
  returning id into v_id;

  return v_id;
end;
$fn$;

commit;
