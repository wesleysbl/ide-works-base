-- Desfaz a F2.4. So funcoes: nao ha tabela nova nesta etapa.
--
-- ATENCAO: sem `set_default_category` a coluna `is_default` volta a ser
-- ingerenciavel pela tela — o indice parcial exige exatamente uma padrao, e
-- trocar exige as duas escritas na mesma transacao.

drop function if exists ideworks.merge_tags(uuid, uuid);
drop function if exists ideworks.set_default_category(uuid);
drop function if exists ideworks.delete_category(uuid);
drop function if exists ideworks.set_client_tags(uuid, uuid[]);
