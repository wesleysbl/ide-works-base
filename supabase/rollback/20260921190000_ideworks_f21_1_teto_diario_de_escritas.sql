-- Desfaz a F21.1. Nome idêntico ao da migration, de propósito.
--
-- O QUE ELE DEVOLVE
--   As concessões sem teto diário por linha. O código volta a cair no padrão
--   do servidor (`DEFAULT_DAILY_WRITE_LIMIT`, 50) — reverter NÃO desliga o
--   freio, só devolve o número escolhido caso a caso.
--
--   ⚠️ REVERTER APAGA OS TETOS AJUSTADOS À MÃO. Não há cópia. O ledger de
--   execuções não é tocado: o histórico de escritas permanece inteiro.

alter table ideworks.integration_grants
  drop constraint if exists integration_grants_daily_write_limit_sane;

alter table ideworks.integration_grants
  drop column if exists daily_write_limit;
