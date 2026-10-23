-- Desfaz a F7f: volta a exigir interação não-negativa.
--
-- AVISO: isto reintroduz a falha. Medido em 2026-08-20, 9 dias-conta em 147 têm
-- interação negativa — e como erro aborta a transação inteira, cada um deles
-- derruba a coleta de TODAS as contas daquela execução.
alter table ideworks.meta_daily_organic drop constraint organic_nao_negativo;

alter table ideworks.meta_daily_organic add constraint organic_nao_negativo check (
  coalesce(reach, 0) >= 0
  and coalesce(views, 0) >= 0
  and coalesce(accounts_engaged, 0) >= 0
  and coalesce(total_interactions, 0) >= 0
  and coalesce(follows, 0) >= 0
  and coalesce(unfollows, 0) >= 0
  and coalesce(profile_links_taps, 0) >= 0
);
