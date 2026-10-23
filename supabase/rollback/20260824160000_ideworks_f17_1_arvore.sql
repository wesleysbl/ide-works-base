-- Desfaz a F17.1. Ordem inversa da aplicacao.
--
-- ATENCAO: apaga a arvore inteira do Pilar B — espacos, pastas e listas — sem
-- recuperacao fora de backup. Como a tarefa da F17.3 vai referenciar `lists`,
-- rodar isto depois da F17.3 exige desfazer a F17.3 antes.
--
-- A ORDEM AQUI NAO E ESTETICA — ELA JA ESTEVE ERRADA
--   Ate 2026-08-24 este arquivo comecava por `drop function
--   ideworks.can_see_space(uuid)`, e a reversao teria parado na LINHA 1:
--
--     ERRO 2BP01: cannot drop function ideworks.can_see_space(uuid)
--                 because other objects depend on it
--
--   Politica de linha guarda dependencia REAL da funcao que ela chama — e
--   CINCO politicas desta migration chamam esta funcao: `spaces_select`,
--   `folders_select`, `folders_write`, `lists_select` e `lists_write`. Com a
--   funcao na frente, o `restrict` implicito do `drop function` recusa, e
--   descobrir isso na hora de reverter algo em producao e a pior hora
--   possivel. Entao: PRIMEIRO O QUE USA, DEPOIS O QUE E USADO.
--
--     politicas -> view -> funcao -> indices -> tabelas
--
--   (`spaces_write` nao entra na conta: ela chama `acting_is_superadmin`, que
--   e da F13 e nao morre aqui.)
--
-- ESTE ARQUIVO NAO RODA MAIS SOZINHO — E ISSO E CORRETO
--   Desde a F17.2 as politicas `status_sets_select` e `status_sets_write`
--   TAMBEM chamam `can_see_space`. Reverter a F17.1 exige reverter a F17.2
--   antes, que e a ordem normal — do mais novo para o mais velho. Se alguem
--   inverter, o `restrict` recusa e diz exatamente quem depende. A recusa e a
--   protecao, nao o estorvo.

-- As politicas antes da funcao que elas chamam.
drop policy if exists lists_write    on ideworks.lists;
drop policy if exists lists_select   on ideworks.lists;
drop policy if exists folders_write  on ideworks.folders;
drop policy if exists folders_select on ideworks.folders;
drop policy if exists spaces_write   on ideworks.spaces;
drop policy if exists spaces_select  on ideworks.spaces;

drop view if exists ideworks.tree;

-- Agora sim: nada mais depende dela.
drop function if exists ideworks.can_see_space(uuid);

drop index if exists ideworks.lists_folder_idx;
drop index if exists ideworks.lists_space_idx;
drop index if exists ideworks.lists_source_key;
drop table if exists ideworks.lists;

drop index if exists ideworks.folders_space_idx;
drop index if exists ideworks.folders_source_key;
drop table if exists ideworks.folders;

drop index if exists ideworks.spaces_category_idx;
drop index if exists ideworks.spaces_source_key;
drop table if exists ideworks.spaces;
