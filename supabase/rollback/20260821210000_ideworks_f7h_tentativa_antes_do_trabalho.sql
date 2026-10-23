-- =============================================================================
-- ROLLBACK da F7h — a tentativa se registra antes do trabalho
-- =============================================================================
-- VOLTA O DEFEITO, e ele nao e pequeno: sem `mark_asset_attempt`, uma conta
-- pesada demais para caber no tempo da plataforma volta a SEQUESTRAR a fila.
--
-- O motor grava a tentativa so depois do trabalho — no sucesso junto com o
-- dado, no erro dentro do `catch`. Worker morto nao passa por nenhum dos dois,
-- entao a conta continua sendo a mais antiga e a execucao seguinte morre nela
-- de novo. Em 2026-08-21 isso deixou 40 contas sem coleta por duas horas.
--
-- VOLTE O CODIGO JUNTO: `meta-coleta.ts` chama esta funcao antes de cada conta.
-- Sem ela, a chamada falha e cada conta cai no `catch` — a coleta continua,
-- mas cada conta gasta uma ida ao banco para nada.
-- =============================================================================

drop function if exists ideworks.mark_asset_attempt(uuid);
