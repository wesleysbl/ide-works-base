-- Desfaz a F4.5. Ordem inversa da aplicacao.
--
-- ATENCAO: `drop table client_links` APAGA os links cadastrados. Nao ha como
-- recuperar sem restauracao de backup. Rodar so com o dado ainda descartavel.

drop function if exists ideworks.set_client_active(uuid, boolean);
drop function if exists ideworks.set_client_flags(uuid, ideworks.urgency_level, boolean);

drop policy if exists client_links_write  on ideworks.client_links;
drop policy if exists client_links_select on ideworks.client_links;

drop index if exists ideworks.client_links_client_idx;
drop table if exists ideworks.client_links;
