-- =============================================================================
-- IDE WORKS — F11c  O tipo de captacao "Outro"
-- =============================================================================
-- O legado classifica captacao em SEIS tipos; aqui havia cinco. O que faltava
-- era `Outro` — e ele nao e residual: e o SEGUNDO mais usado, com 31 captacoes,
-- 15 delas de cliente ativo.
--
-- Descarta-lo na migracao perderia a classificacao de metade das captacoes
-- ativas, e perderia em silencio: um array a menos num campo que ninguem
-- confere. Preferivel admitir que o modelo daqui tinha uma lacuna, revelada
-- pelo dado real.
--
-- VAI SOZINHO NESTA MIGRACAO DE PROPOSITO
--   `alter type ... add value` nao pode ser USADO na mesma transacao em que e
--   criado. Junta-lo com a funcao que o usa faria a migracao falhar com uma
--   mensagem que nao explica nada sobre a causa.
-- =============================================================================

alter type ideworks.capture_kind add value if not exists 'other';
