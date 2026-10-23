-- =============================================================================
-- IDE WORKS — F7h  A tentativa se registra ANTES do trabalho
-- =============================================================================
-- O QUE ACONTECEU EM PRODUCAO, EM 2026-08-21
--   A coleta parou de gravar as 10:31 e nao voltou. Quatro execucoes seguidas
--   (10:30, 11:00, 11:30, 12:00) foram abertas e NENHUMA fechou — todas ficaram
--   em `running`, sem uma linha de erro em lugar nenhum.
--
--   A conta na cabeca da fila era a "Pro Forma": 300 anuncios e 901 linhas
--   diarias. Coletar essa conta e mais de mil idas e voltas ao banco dentro de
--   UMA transacao, e a plataforma mata o Worker antes do fim.
--
-- POR QUE ISSO VIROU UM TRAVAMENTO PERMANENTE, E NAO UMA FALHA
--   A fila ordena pela conta tentada HA MAIS TEMPO (F9h). O carimbo dessa
--   tentativa, `last_attempt_at`, so era gravado DEPOIS do trabalho — no
--   sucesso, junto com o dado; no erro, no `catch`.
--
--   Quando o Worker e MORTO, nao ha sucesso nem `catch`. Nada e gravado. A
--   conta continua sendo a mais antiga da fila, entao a execucao seguinte
--   escolhe exatamente ela, morre no mesmo lugar, e a seguinte tambem.
--
--   A conta pesada nao atrasa a fila: ela SEQUESTRA a fila. As outras 40 param
--   de ser visitadas por causa de uma. Foi o que aconteceu por duas horas.
--
-- A CORRECAO
--   Registrar a tentativa ANTES de comecar, em transacao propria, ja commitada.
--   A partir dai, ser morto custa UM lugar na fila, e nao a fila inteira: a
--   conta vai para o fim, as outras andam, e ela e tentada de novo na proxima
--   volta.
--
--   Isto NAO conserta a conta pesada — ela vai continuar morrendo ate o custo
--   por conta baixar. Conserta o estrago que ela causa nas outras, que e a
--   diferenca entre "uma conta com problema" e "a coleta parada".
--
-- POR QUE UMA FUNCAO NOVA, E NAO `touch_asset(id, null)`
--   `touch_asset` com erro nulo significa SUCESSO: ela avanca `last_seen_at`,
--   que e o campo que a tela usa para dizer "o dado chegou ate aqui". Usa-la
--   para marcar tentativa faria toda conta parecer coletada no instante em que
--   foi escolhida — inclusive as que morrem em seguida. A tela passaria a
--   mentir exatamente sobre o caso que ela existe para mostrar.
--
--   E tambem nao limpa `last_error`: o erro da tentativa anterior tem de
--   continuar visivel ate haver um desfecho novo.
-- =============================================================================

create or replace function ideworks.mark_asset_attempt(p_asset_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  -- SO o relogio da fila. Nem `last_seen_at` (que significa "dado chegou"),
  -- nem `last_error` (que ainda descreve o desfecho anterior).
  update ideworks.meta_assets
     set last_attempt_at = now(),
         updated_at      = now()
   where id = p_asset_id;
end;
$fn$;

grant execute on function ideworks.mark_asset_attempt(uuid) to ideworks_app;

comment on function ideworks.mark_asset_attempt(uuid) is
  'Marca que esta conta FOI ESCOLHIDA, antes do trabalho comecar. E o que '
  'impede uma conta pesada demais de sequestrar a fila: sem isto, um Worker '
  'morto no meio nao grava nada, a conta continua sendo a mais antiga, e a '
  'execucao seguinte morre exatamente nela. Aconteceu em 2026-08-21.';
