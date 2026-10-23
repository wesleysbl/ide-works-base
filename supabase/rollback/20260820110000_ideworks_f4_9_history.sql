-- Desfaz a F4.9. Ordem inversa da aplicacao.
--
-- ATENCAO: apaga os eventos e o registro dos documentos. Os ARQUIVOS em si nao
-- sao apagados por aqui — eles vivem no balde, e sumir com a linha sem sumir
-- com o arquivo deixa lixo pago no armazenamento. Limpar o balde e passo
-- separado e deliberado.

drop policy if exists history_documents_write  on ideworks.history_documents;
drop policy if exists history_documents_select on ideworks.history_documents;
drop policy if exists client_history_delete on ideworks.client_history;
drop policy if exists client_history_update on ideworks.client_history;
drop policy if exists client_history_insert on ideworks.client_history;
drop policy if exists client_history_select on ideworks.client_history;

drop index if exists ideworks.history_documents_history_idx;
drop table if exists ideworks.history_documents;

drop index if exists ideworks.client_history_client_idx;
drop table if exists ideworks.client_history;
