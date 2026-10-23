-- Desfaz a F17.2. Ordem inversa da aplicação.
--
-- ATENÇÃO: apaga as esteiras inteiras do Pilar B — conjuntos de status e
-- status — sem recuperação fora de backup. Como a tarefa da F17.3 vai
-- referenciar `statuses`, rodar isto depois da F17.3 exige desfazer a F17.3
-- antes.
--
-- A ORDEM AQUI NÃO É ESTÉTICA
--   Política de linha e view guardam dependência real da função que chamam. Com
--   a ordem trocada, `drop function ideworks.can_see_status_set` seria recusado
--   enquanto a política `statuses_select` existisse, e a reversão pararia no
--   meio — que é a pior hora possível para descobrir isso. Então: primeiro o
--   que USA, depois o que é usado.
--
--     função de escrita → políticas → gatilhos → view → funções → tabelas → tipo
--
--   O tipo `ideworks.status_type` cai por último dessa corrente: enquanto a
--   coluna `statuses.type` existir, `drop type` é recusado — e essa recusa é
--   uma proteção, não um estorvo.

-- Nada depende dela: cai primeiro.
drop function if exists
  ideworks.create_status_set(text, jsonb, uuid, uuid, uuid, text, uuid);

-- As políticas antes das funções que elas chamam.
drop policy if exists statuses_write      on ideworks.statuses;
drop policy if exists statuses_select     on ideworks.statuses;
drop policy if exists status_sets_write   on ideworks.status_sets;
drop policy if exists status_sets_select  on ideworks.status_sets;

-- Os gatilhos antes da função que eles executam.
drop trigger if exists statuses_must_close    on ideworks.statuses;
drop trigger if exists status_sets_must_close on ideworks.status_sets;
drop function if exists ideworks.status_set_must_close();

-- A view antes da função que ela chama.
drop view if exists ideworks.list_workflow;
drop function if exists ideworks.resolve_status_set(uuid);
drop function if exists ideworks.can_see_status_set(uuid);

drop index if exists ideworks.statuses_set_idx;
drop index if exists ideworks.statuses_source_key;
drop index if exists ideworks.statuses_one_closing_key;
drop index if exists ideworks.statuses_name_key;
drop table if exists ideworks.statuses;

drop index if exists ideworks.status_sets_source_key;
drop index if exists ideworks.status_sets_list_key;
drop index if exists ideworks.status_sets_folder_key;
drop index if exists ideworks.status_sets_space_key;
drop table if exists ideworks.status_sets;

drop type if exists ideworks.status_type;

-- `owner_space` nasceu nesta migration, então cai com ela — reversão devolve o
-- schema ao estado anterior, e função órfã é exatamente o tipo de resto que
-- torna "o que rodou?" impossível de responder no legado.
--
-- Quando a F17.5 (campos personalizados) e a F17.8 (visualizações) passarem a
-- usá-la — elas têm a MESMA forma de posse de três níveis —, esta linha deixa
-- de poder rodar sozinha, e a reversão delas tem que vir antes. O `restrict`
-- implícito do `drop function` recusa e diz quem depende.
drop function if exists ideworks.owner_space(uuid, uuid, uuid);
