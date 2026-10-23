-- Desfaz a F8b. Sem esta funcao o motor nao enxerga ativo nenhum e a coleta
-- passa a nao fazer nada — em silencio, porque zero ativos e desfecho `ok`.
drop function if exists ideworks.meta_assets_para_coleta();
