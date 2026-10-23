-- =============================================================================
-- IDE WORKS — F7f  Interação do dia é SALDO, e saldo pode ser negativo
-- =============================================================================
-- O QUE ACONTECEU
--   A primeira coleta de verdade morreu batendo em `organic_nao_negativo`. Eu
--   presumi que contagem diária de interação fosse BRUTA — só soma. Não é: a
--   Meta devolve o SALDO do dia, e desconta o que foi desfeito.
--
--   Se num dia três pessoas removem um salvamento e ninguém salva, o dia fecha
--   em -3. Isso não é dado corrompido: é a informação certa.
--
-- MEDIDO, NÃO DEDUZIDO
--   147 dias-conta varridos nos 21 perfis, em 2026-08-20: 9 valores negativos,
--   todos em `saves` e no `total_interactions` que os contém. Nenhum negativo
--   em alcance, visualizações, contas engajadas ou toques no link — e por isso
--   essas quatro continuam barradas contra negativo.
--
--   `saves` não é coluna aqui: vai para `extra`. Só `total_interactions` batia
--   na restrição.
--
-- POR QUE ISTO ERA GRAVE
--   A restrição não recusava uma linha: derrubava a EXECUÇÃO INTEIRA. No
--   Postgres, erro aborta a transação toda, então uma conta com um salvamento
--   removido apagava a coleta das outras quarenta. Um dia com -1 custava o dia
--   inteiro de todo mundo — e dia não coletado é dia perdido para sempre.
--
--   A migration conserta a regra errada; o motor ganha savepoint por ativo, que
--   é o conserto da fragilidade.
-- =============================================================================

alter table ideworks.meta_daily_organic drop constraint organic_nao_negativo;

alter table ideworks.meta_daily_organic add constraint organic_nao_negativo check (
  coalesce(reach, 0) >= 0
  and coalesce(views, 0) >= 0
  and coalesce(accounts_engaged, 0) >= 0
  and coalesce(follows, 0) >= 0
  and coalesce(unfollows, 0) >= 0
  and coalesce(profile_links_taps, 0) >= 0
);

comment on column ideworks.meta_daily_organic.total_interactions is
  'SALDO do dia, e por isso pode ser NEGATIVO: a Meta desconta o que foi '
  'desfeito. Medido em 2026-08-20 — 9 dias-conta negativos em 147, sempre por '
  'salvamento removido. A restricao de nao-negativo cobria esta coluna e '
  'derrubava a coleta inteira. Ver a migration F7f.';
