-- =============================================================================
-- IDE WORKS — F44.5  As tabelas que só cresciam, e a coleta que trancava a seguinte
-- =============================================================================
-- POR QUE
--   Os dois limitadores que moram no banco só escreviam:
--     · `integration_rate_events` (F16.2b) — duas linhas por chamada de agente
--       (concessão e dono). 50.264 linhas, 13 MB, desde 22/09, contadas em
--       09/10/2026 — e a janela que o freio lê é de UM minuto.
--     · `auth_attempts` (F1.4) — cada tentativa de login e de ativação. 1.274
--       linhas desde 19/08, e a janela é de QUINZE minutos.
--   Linha fora da janela nunca mais é contada por ninguém: é peso morto no
--   índice que o freio consulta a cada chamada. (`approval_link_rate_events`,
--   F42_6, já se varre sozinha — não entra aqui.)
--
-- O QUE MUDA
--   1. `purge_integration_rate_events(p_window_seconds)` e
--      `purge_auth_attempts(p_window_seconds)` — apagam o que passou da janela
--      e devolvem quantas linhas saíram. Só o motor (o gatilho de tempo do
--      Worker, ator `collector`, sem sessão de pessoa): `assert_collector()`,
--      o mesmo molde de `expired_attachments` (F17.81). `security definer`
--      porque nenhuma das duas tabelas é legível pelo papel da aplicação.
--
--      A JANELA VEM DO WORKER, e não daqui. Os tetos moram no código
--      (`INTEGRATION_RATE_LIMITS`, `src/integrations/limits.ts`; `LIMITS`,
--      `src/auth/rate-limit.ts`), e a limpeza usa a MAIOR janela de lá, com
--      uma folga (`src/server/limpeza-dos-limitadores.ts`). Uma janela escrita
--      aqui ficaria para trás no dia em que alguém aumentasse a do código — e
--      a limpeza passaria a apagar linha que o freio ainda conta, afrouxando o
--      limite sem ninguém ver. A função só confere que o número é são (de um
--      minuto a sete dias, o mesmo cuidado de `approval_link_rate_hit`); fora
--      disso recusa com 22023 e não apaga nada.
--
--      Índice: o da chave + horário de `integration_rate_events` já existe
--      (`integration_rate_events_window_idx`, scope, scope_key, occurred_at) e
--      é o que o freio usa. A limpeza é UMA vez por dia sobre o que sobrou de
--      um dia (~3 mil linhas): varrer a tabela custa menos que manter mais um
--      índice a cada chamada de agente. Nenhum índice novo.
--
--   2. `start_collection_run` — a execução "em andamento" deixa de bloquear a
--      batida seguinte depois de 12 minutos, e não mais de 15.
--      O gatilho bate a cada 15 minutos (`wrangler.toml`). Com 15, uma
--      execução que morreu sem fechar (38 linhas `running` no livro em 09/10)
--      ainda trancava a batida seguinte: ela começa 15 minutos depois, e a
--      linha velha tinha 14 min 59 s — a coleta pulava meia hora inteira.
--      Doze é mais que a execução mais longa dos últimos 30 dias (6 min 10 s:
--      o teto de 4 min de `TETO_DE_TEMPO_MS` mais a conta que já tinha
--      começado) e menos que o intervalo do gatilho. O resto da função fica
--      letra por letra como está em produção (retrato de 09/10).
--
-- PAR COM O WORKER
--   O `scheduled` (`worker/index.ts`) chama as duas limpezas na batida das
--   06:00 UTC (03:00 em São Paulo). Publicado antes desta migration, ele só
--   registra no log, uma vez por dia, que a limpeza falhou — nada mais quebra.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s (só funções; nenhuma
-- tabela muda de forma).
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261009130000_ideworks_f44_5_limpezas.sql`.
-- =============================================================================

begin;
set local lock_timeout = '5s';

-- =============================================================================
-- 1. As limpezas dos limitadores
-- =============================================================================

create or replace function ideworks.purge_integration_rate_events(p_window_seconds integer)
  returns integer
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_apagadas integer;
begin
  perform ideworks.assert_collector();

  if p_window_seconds is null or p_window_seconds not between 60 and 604800 then
    raise exception 'janela de limpeza fora da faixa' using errcode = '22023';
  end if;

  delete from ideworks.integration_rate_events
   where occurred_at < now() - make_interval(secs => p_window_seconds);
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$fn$;

comment on function ideworks.purge_integration_rate_events(integer) is
  'F44_5: apaga as chamadas de integração mais velhas que a janela (em segundos, '
  'de 60 a 7 dias) e devolve quantas saíram. Só o motor (sem sessão de pessoa). '
  'A janela vem do Worker: a maior de INTEGRATION_RATE_LIMITS, com folga.';

revoke all on function ideworks.purge_integration_rate_events(integer) from public, anon, authenticated;
grant execute on function ideworks.purge_integration_rate_events(integer) to ideworks_app;

create or replace function ideworks.purge_auth_attempts(p_window_seconds integer)
  returns integer
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_apagadas integer;
begin
  perform ideworks.assert_collector();

  if p_window_seconds is null or p_window_seconds not between 60 and 604800 then
    raise exception 'janela de limpeza fora da faixa' using errcode = '22023';
  end if;

  delete from ideworks.auth_attempts
   where occurred_at < now() - make_interval(secs => p_window_seconds);
  get diagnostics v_apagadas = row_count;
  return v_apagadas;
end;
$fn$;

comment on function ideworks.purge_auth_attempts(integer) is
  'F44_5: apaga as tentativas de login e de ativação mais velhas que a janela (em '
  'segundos, de 60 a 7 dias) e devolve quantas saíram. Só o motor (sem sessão de '
  'pessoa). A janela vem do Worker: a maior de LIMITS, com folga.';

revoke all on function ideworks.purge_auth_attempts(integer) from public, anon, authenticated;
grant execute on function ideworks.purge_auth_attempts(integer) to ideworks_app;

-- =============================================================================
-- 2. A coleta morta tranca 12 minutos, não 15
-- =============================================================================
-- Parte do corpo em produção (retrato de 09/10, F10b); só o intervalo e o
-- comentário que o explica mudam.

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
  -- Doze minutos e o teto (F44_5): a execucao tem orcamento de quatro, mais a
  -- conta que ja tinha comecado (a mais longa dos ultimos 30 dias levou 6 min
  -- 10 s), entao passou disso ela nao esta rodando — esta morta. E doze, e nao
  -- quinze, porque o gatilho bate a cada quinze: com quinze, a execucao morta
  -- trancava tambem a batida seguinte.
  select started_at into v_ativa
    from ideworks.meta_collection_runs
   where outcome = 'running'
     and started_at > now() - interval '12 minutes'
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
