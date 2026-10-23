-- Desfaz a F17.4. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F17.3: a tarefa continua com `custom_item_id`, e
--   esse número volta a não ter catálogo nenhum atrás dele — nem chave, nem
--   função de resolução, nem a view que dizia quando ele apontava para o vazio.
--   A dívida da F17.3 volta a ficar aberta, e é bom que isso esteja escrito.
--
--   ATENÇÃO, E ISTO É O MAIS IMPORTANTE DESTE ARQUIVO: reverter APAGA todas as
--   etiquetas de tarefa, todos os vínculos etiqueta-tarefa e todo o catálogo de
--   tipos. Não há como guardá-los — as tabelas deixam de existir. Se a F17.11
--   já tiver importado o ClickUp, isto joga fora a classificação inteira do
--   trabalho, e só um backup a traz de volta.
--
--   O QUE ELE NÃO TOCA, E NUNCA DEVE TOCAR: `ideworks.client_tags` e
--   `ideworks.client_tag_assignments`, da F2.4. São 31 etiquetas e 94
--   atribuições EM USO, de CLIENTE, e não têm nada com esta etapa. A F17.4
--   nasceu justamente por elas não servirem para tarefa; confundi-las na
--   reversão apagaria dado de produção que ninguém pediu para apagar.
--
--   Também não apaga `tasks.custom_item_id` — a coluna é da F17.3, e o rollback
--   dela é que a leva.
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   view → set_task_tags → gatilhos e as funções deles → resolve_task_type
--   → tabelas (vínculo, etiqueta, tipo) → is_meaningful_name
--
-- VIEW → TABELA É DEPENDÊNCIA REGISTRADA, E RECUSA ALTO. `ideworks.task_labels`
-- lê as três tabelas desta etapa; com a view viva, o `drop table` responde
-- `2BP01` dizendo exatamente quem depende. Por isso ela sai primeiro.
--
-- GATILHO → FUNÇÃO TAMBÉM É REGISTRADA. `tasks_tag_space_guard` executa
-- `task_move_tag_guard()`, e `task_tag_assignments_space_guard` executa
-- `task_tag_space_guard()`: enquanto o gatilho existir, a função não cai.
--
-- ATENÇÃO AO GATILHO QUE MORA EM CASA ALHEIA. `tasks_tag_space_guard` está em
-- `ideworks.tasks`, que NÃO é apagada aqui. Ele precisa de `drop trigger`
-- explícito — sem ele, a tabela ficaria com um gatilho apontando para uma
-- função que não existe mais, e a primeira tarefa movida quebraria com um erro
-- que não diz de onde veio. O irmão, em `task_tag_assignments`, cairia junto
-- com a tabela dele; está explícito mesmo assim, para os dois lerem igual.
--
-- ENTRE FUNÇÃO E TABELA A DEPENDÊNCIA NÃO É REGISTRADA — E ISSO É PIOR.
-- `resolve_task_type` e `set_task_tags` têm o corpo escrito como literal
-- (`$fn$ ... $fn$`), e corpo literal não anota nada em `pg_depend` (medido pelo
-- verificador da F17.2b: ZERO elos desse tipo no schema `ideworks`). Apagar
-- `task_types` antes de `resolve_task_type` não daria erro nenhum: deixaria a
-- função viva consultando uma tabela que não existe, e a quebra apareceria na
-- próxima ficha de tarefa aberta, longe daqui e sem dizer por quê. Recusa
-- ruidosa se conserta na hora; função órfã se descobre semanas depois.
--
-- `is_meaningful_name` SAI POR ÚLTIMO, e isso não é capricho: as duas restrições
-- `check` que a chamam — em `task_tags` e em `task_types` — SÃO dependência
-- registrada. Com a função na frente, o `drop function` responde `2BP01`. A
-- recusa é a proteção, não o estorvo; a ordem certa é deixar as tabelas caírem
-- e só então soltar a função.

-- 1. A view, que é quem lê as três tabelas.
drop view if exists ideworks.task_labels;

-- 2. A ação de domínio. Nada depende dela.
drop function if exists ideworks.set_task_tags(uuid, uuid[]);

-- 3. Os dois gatilhos, cada um antes da função que executa. O primeiro mora em
--    `ideworks.tasks`, que sobrevive a este arquivo — ver a nota acima.
drop trigger if exists tasks_tag_space_guard on ideworks.tasks;
drop function if exists ideworks.task_move_tag_guard();

drop trigger if exists task_tag_assignments_space_guard on ideworks.task_tag_assignments;
drop function if exists ideworks.task_tag_space_guard();

-- 4. A resolução, ANTES das tabelas que ela consulta. Ver a nota sobre função
--    órfã: aqui o banco não avisaria.
drop function if exists ideworks.resolve_task_type(uuid, integer);

-- 5. As tabelas, do vínculo para o catálogo. As políticas de cada uma caem
--    junto com ela — não há `drop policy` solto que pudesse deixar uma tabela
--    com RLS ligada e nenhuma política permissiva.
drop table if exists ideworks.task_tag_assignments;
drop table if exists ideworks.task_tags;
drop table if exists ideworks.task_types;

-- 6. E só agora, com as duas restrições `check` já tendo sumido junto com as
--    tabelas delas, a regra do nome pode cair.
drop function if exists ideworks.is_meaningful_name(text);

-- ============================================== O QUE ESTE ARQUIVO NÃO FAZ ===
-- NÃO MEXE EM `client_tags` NEM EM `client_tag_assignments`. Ver o cabeçalho.
--
-- NÃO DEVOLVE A COLUNA `tasks.custom_item_id` NEM O DADO DELA. A coluna é da
-- F17.3 e continua onde estava, com os números que tiver. O que esta reversão
-- tira é o catálogo e a forma de saber se aqueles números querem dizer alguma
-- coisa.
--
-- ESTE ARQUIVO PODE DEIXAR DE RODAR SOZINHO — E ISSO É CORRETO
--   A F17.5 (campos personalizados), a F17.6 (anexos, links e comentários) e a
--   F17.8 (visualizações, que filtram POR ETIQUETA) vão pendurar coisa nestas
--   tabelas. A partir daí a reversão delas tem que vir antes desta, e o
--   `restrict` implícito recusa com `2BP01` dizendo exatamente quem depende.
