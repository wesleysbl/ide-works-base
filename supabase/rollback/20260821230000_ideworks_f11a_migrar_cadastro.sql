-- =============================================================================
-- ROLLBACK da F11a — Trazer o cadastro do Sistema IDE
-- =============================================================================
-- ISTO APAGA A PONTE, E NAO O DADO.
--   Depois de rodar, ninguem mais consegue importar do legado — e os clientes
--   ja importados FICAM. E de proposito: um rollback que apagasse cliente
--   apagaria junto tudo o que pendura nele por cascata, e "desfazer a
--   migracao" viraria "perder o que foi feito desde ela".
--
-- SE A INTENCAO FOR MESMO ESVAZIAR
--   E decisao de gente, e por isso nao esta neste arquivo. O comando esta
--   escrito abaixo, comentado, com o que ele leva junto — para quem for rodar
--   ler antes:
--
--     -- Leva por cascata: cotas, links, etiquetas, itens de conteudo,
--     -- historico, captacoes, notas do mural, tarefas e as CONTAS DA META
--     -- atribuidas a esses clientes.
--     -- delete from ideworks.clients
--     --  where id in (select id from public.clients);
--
--   O legado nunca e tocado por nada disto.
-- =============================================================================

drop function if exists ideworks.migrar_clientes(boolean);
drop function if exists ideworks.migracao_clientes_previa(boolean);
drop function if exists ideworks.migracao_clientes_estranhos();
