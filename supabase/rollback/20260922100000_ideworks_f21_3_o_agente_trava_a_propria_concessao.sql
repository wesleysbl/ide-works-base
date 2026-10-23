-- Desfaz a F21.3. Nome idêntico ao da migration, de propósito.
--
-- ⚠️ REVERTER QUEBRA A ESCRITA DE AGENTE DE NOVO.
--   Sem esta política, `select ... for update` em `integration_grants` volta a
--   devolver ZERO linhas para ator de agente (o `USING` de
--   `integration_grants_update` exige sessão humana), `loadGrant` volta a
--   devolver null e toda escrita de agente volta a recusar com
--   "Concessão inexistente ou fora do alcance".
--
--   Só reverta junto com a remoção do `for update` em `sqlLedger.loadGrant`
--   (`src/integrations/executions.ts`) — e sabendo que, sem ele, a cota diária
--   deixa de ser serializada e duas escritas simultâneas podem passar pela
--   última vaga do dia.
--
-- Nenhum dado é tocado: isto some com uma regra, não com uma linha.

drop policy if exists integration_grants_lock_self on ideworks.integration_grants;
