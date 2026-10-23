-- =============================================================================
-- IDE WORKS — F10b  Uma coleta por vez
-- =============================================================================
-- DUAS COLETAS AO MESMO TEMPO BRIGAM PELAS MESMAS CONTAS
--   A fila ordena pela conta vista há mais tempo. Duas execuções simultâneas
--   pegam EXATAMENTE as mesmas contas, porque nenhuma commitou ainda — e aí
--   disputam linha por linha até uma morrer com "canceling statement due to
--   lock timeout".
--
--   Medido em 2026-08-21: a automática começou 09:01:00, a manual 09:01:49, e
--   duas das três contas da manual falharam.
--
--   Com o gatilho sozinho isso não aconteceria: a execução leva 4 minutos e a
--   batida é a cada 30. Mas basta uma execução demorar mais que a batida, ou
--   alguém rodar o script à mão, para o problema voltar.
--
-- POR QUE NÃO `pg_advisory_lock`
--   Ele é por SESSÃO, e o agrupador de conexões trabalha em modo transação: a
--   sessão não sobrevive entre as várias transações de uma execução. A versão
--   de transação (`pg_advisory_xact_lock`) soltaria a trava na primeira delas.
--
--   O livro de execuções já é o registro de quem está rodando. Usa-se ele.
--
-- UMA EXECUÇÃO ABANDONADA NÃO PODE TRANCAR PARA SEMPRE
--   Se uma execução morrer sem fechar, a linha fica em `running` eternamente e
--   a coleta nunca mais roda — trocaríamos um defeito por outro pior. Quinze
--   minutos é o teto: a execução tem orçamento de quatro, então passou disso
--   ela não está rodando, está morta.
-- =============================================================================

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
