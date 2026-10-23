-- Desfaz a parte 1 da F42 Fase 1: a função que resolve o link, a tabela de links
-- e a chave "aprovação externa ligada" do cliente.
-- Desfaça antes as partes 4, 3 e 2 (nessa ordem). Os links gerados somem junto
-- (os clientes precisarão de link novo se a parte for reaplicada).
-- Depois: node scripts/conferir-schema.mjs --gravar.
drop function if exists ideworks.resolve_approval_link(text);
drop table if exists ideworks.client_approval_links;
drop function if exists ideworks.client_approval_links_guard();
alter table ideworks.clients drop column if exists approval_enabled;
