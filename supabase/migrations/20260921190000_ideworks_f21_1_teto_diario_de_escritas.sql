-- =============================================================================
-- IDE WORKS — F21.1  Teto diário de escritas de agente
-- =============================================================================
-- O PEDIDO
--   Um agente em laço tem de parar sozinho no mesmo dia, em vez de escrever
--   milhares de vezes. O limite de 60 chamadas por minuto da F16.2b segura a
--   rajada e não segura o laço educado: uma escrita a cada dois segundos passa
--   por ele e publica dezenas de milhares por noite.
--
-- POR QUE UMA COLUNA, E NENHUMA TABELA NOVA
--   A contagem já existe: `ideworks.integration_executions` guarda uma linha
--   por escrita CONFIRMADA. Um contador em tabela própria seria um segundo
--   lugar dizendo o mesmo número — e os dois discordariam no primeiro rollback
--   de transação. O que falta guardar é só o TETO, e ele é da concessão.
--
-- POR QUE O TETO É POR CONCESSÃO
--   Duas conexões do mesmo dono são dois agentes com dois propósitos. O laço
--   de um não pode consumir a cota do outro. Quem precisa de mais pede, e a
--   liberação pela tela (F21.5) muda ESTE número — sem publicar código.
--
-- ADITIVA, E SÓ
--   f16a, f16b e f16c já estão no banco. Nada aqui altera o que elas criaram:
--   uma coluna com padrão e um índice para a contagem do dia.
-- =============================================================================

alter table ideworks.integration_grants
  add column daily_write_limit integer not null default 50;

comment on column ideworks.integration_grants.daily_write_limit is
  'Teto de escritas confirmadas por dia desta concessão, no fuso da agência. '
  'Lido do banco dentro da transação da escrita — o agente não manda este '
  'número, e nada no corpo do pedido o contorna. Zero = concessão sem escrita '
  'hoje, sem precisar revogar.';

-- Zero é válido (suspender a escrita sem revogar a concessão). Negativo não é:
-- seria "teto que nunca fecha" escrito de um jeito que ninguém lê como isso.
alter table ideworks.integration_grants
  add constraint integration_grants_daily_write_limit_sane
    check (daily_write_limit >= 0 and daily_write_limit <= 100000);

-- A contagem do dia é `where grant_id = … and occurred_at >= … and < …`.
-- O índice de f16c é (grant_id, occurred_at desc) e serve exatamente a ela;
-- nenhum índice novo é necessário, e um redundante só encareceria o insert.
