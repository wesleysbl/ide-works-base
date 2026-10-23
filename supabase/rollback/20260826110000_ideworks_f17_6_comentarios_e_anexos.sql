-- Desfaz a F17.6. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE
--   O estado exato do fim da F17.15: a tarefa não tem comentário, não tem anexo
--   e não tem link, e `task_progress` volta a contar cinco coisas em vez de oito.
--
--   ATENÇÃO — REVERTER APAGA A ENTREGA, E É PIOR AQUI QUE EM QUALQUER ETAPA
--   ANTERIOR:
--     · `drop table ideworks.task_comments` leva TODA a conversa de TODAS as
--       tarefas. Na Agência Ide o comentário com o link do Dropbox É a entrega —
--       apagar a conversa é apagar o registro de que o trabalho foi entregue, e
--       para onde ele foi.
--     · `drop table ideworks.task_attachments` leva a FICHA de cada arquivo. Os
--       BYTES continuam no balde `ideworks-anexos`, e é exatamente esse o
--       problema: eles ficam lá sem ninguém que saiba de qual tarefa eram, com
--       que nome, nem de quem. Objeto órfão em balde privado é lixo que ninguém
--       consegue nem ler nem justificar apagar.
--     · `drop table ideworks.task_links` leva os endereços de Dropbox e Google
--       Docs que alguém tirou do meio do texto e organizou.
--
--   Isso é diferente da F17.3c, que só revertia recusa, e mais grave que a
--   F17.15, que achatava uma árvore. Aqui some o registro do que foi feito.
--
--   ANTES DE RODAR ISTO, EXPORTE:
--     select task_id, author_id, created_at, body from ideworks.task_comments;
--     select task_id, file_name, storage_path, byte_size from ideworks.task_attachments;
--     select task_id, label, url from ideworks.task_links;
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   view task_progress        → as três tabelas novas que ela lê
--   post_task_comment         → task_comments  E  acting_user_id
--   edit_task_comment         → task_comments
--   add_task_link             → task_links     E  acting_user_id
--   as três tabelas           → (as oito políticas caem com elas)
--   view task_progress        → recriada na versão da F17.15, que lê só o que sobra
--
-- A VIEW É DEPENDÊNCIA REGISTRADA. `task_progress` lê `task_comments`,
-- `task_attachments` e `task_links`: enquanto ela existir na versão da F17.6,
-- qualquer `drop table` responde `2BP01` dizendo que a view depende. Por isso
-- ela sai primeiro — e não porque ficaria bonito.
--
-- POLÍTICA → FUNÇÃO TAMBÉM É DEPENDÊNCIA REGISTRADA, e aqui isso importa duas
-- vezes: as oito políticas executam `ideworks.can_reach_task_id` e quatro delas
-- executam `ideworks.acting_user_id`. NENHUMA das duas é apagada por este
-- arquivo — `can_reach_task_id` é da F17.3 e segue servindo `task_assignees`,
-- `task_watchers` e `task_checklists`; `acting_user_id` é da F1.9 e é a base de
-- todo o schema. As políticas não têm `drop policy` solto: elas caem junto com
-- as tabelas. Um `drop policy` fora de ordem deixaria a tabela com RLS ligada e
-- nenhuma política permissiva, que é uma tabela viva e ilegível.
--
-- FUNÇÃO → FUNÇÃO NÃO É DEPENDÊNCIA REGISTRADA, e aqui morde: `post_task_comment`
-- e `add_task_link` chamam `acting_user_id`, e o banco não avisaria se a segunda
-- saísse primeiro — ficaria função viva chamando função inexistente, e o erro só
-- apareceria no próximo comentário. Erro silencioso é pior que erro ruidoso. Foi
-- medido na F17.2b: corpo escrito como literal (`$fn$…$fn$`) NÃO registra
-- dependência em `pg_depend`.
--
-- FUNÇÃO → TABELA TAMBÉM NÃO É. Apagar `task_comments` antes de
-- `edit_task_comment` não daria `2BP01`; deixaria a função viva consultando
-- tabela inexistente.
--
-- `is_meaningful_name` NÃO É APAGADA. Ela é da F17.4 e continua sendo a regra de
-- nome de `task_tags`, `task_checklists` e `checklist_items`. As três restrições
-- que a usavam aqui caem junto com as tabelas.
--
-- ================================================ O BALDE NÃO SE APAGA AQUI ==
-- MEDIDO DUAS VEZES, E A SEGUNDA MEDIÇÃO CORRIGIU A PRIMEIRA.
--
--   1ª — como `postgres`:
--          delete from storage.buckets where id = '…'
--          → 42501  Direct deletion from storage tables is not allowed.
--                   Use the Storage API instead.
--        O guarda é o gatilho `storage.protect_delete()`.
--
--   2ª — o guarda TEM uma porta, e ela é desenho do Supabase. O corpo dele lê
--        `current_setting('storage.allow_delete_query')` e só recusa quando o
--        valor não é `'true'`. Com
--          begin; set local storage.allow_delete_query = 'true';
--          delete from storage.buckets where id = '…'; commit;
--        o balde SAI — sondado num balde descartável nesta sessão, e ele sumiu.
--
-- Ou seja: "não dá para apagar" era falso, e ficou escrito porque a primeira
-- medição parou no primeiro erro. A decisão de NÃO apagar continua valendo, e
-- agora pelo motivo verdadeiro:
--
--   `ideworks-anexos` é `public = false` e não tem NENHUMA política permissiva
--   em `storage.objects`. Um balde vazio nessas condições é INERTE — medido:
--   a URL pública responde `Bucket not found`, e o crachá de um usuário real e
--   logado não lê, não lista, não assina e não envia (`403 new row violates
--   row-level security policy`). Apagá-lo pelo rollback exigiria DESLIGAR um
--   guarda de perda de dados do provedor para remover algo que não vaza nada.
--
--   Quem quiser removê-lo de fato usa o painel do Supabase ou a API de Storage.
--
-- ⚠️ SE HOUVER OBJETO DENTRO, ELE NÃO SAI COM AS TABELAS. As três tabelas
--    apagadas abaixo levam a FICHA de cada arquivo; os BYTES ficam no balde,
--    órfãos. Ver o aviso do topo.
--
-- Se este rollback for aplicado e a F17.6 for reaplicada depois, o `on conflict
-- do update` da migration REFECHA o balde — ele nunca volta público por reuso.

-- 1. A view, na versão da F17.6, antes das três tabelas que ela lê.
drop view if exists ideworks.task_progress;

-- 2. As três ações, antes das tabelas que escrevem e da função que chamam.
drop function if exists ideworks.post_task_comment(uuid, text, uuid);
drop function if exists ideworks.edit_task_comment(uuid, text);
drop function if exists ideworks.add_task_link(uuid, text, text);

-- 3. As três tabelas. As oito políticas, os índices e a chave estrangeira
--    composta do comentário caem com elas, sem comando próprio.
--
--    `task_comments` primeiro por convenção de leitura, não por dependência: as
--    três são irmãs e nenhuma referencia a outra. A auto-referência de
--    `task_comments_parent_fk` cai com a própria tabela.
drop table if exists ideworks.task_comments;
drop table if exists ideworks.task_attachments;
drop table if exists ideworks.task_links;

-- 4. `task_progress` volta a ser a da F17.15 — texto literal daquela migration,
--    comentários do corpo inclusive. Ela lê `tasks`, `task_checklists` e
--    `checklist_items`, que continuam de pé.
--
--    NÃO SE APAGA A VIEW, SE RESTAURA: ela é da F17.15. Um `drop` seco aqui
--    apagaria a contagem de subtarefa e de checklist, que não são desta etapa —
--    o cartão do quadro pararia de mostrar o `5`.
create view ideworks.task_progress
  with (security_invoker = true)
as
select
  t.id as task_id,

  -- Filhas DIRETAS, e não a descendência inteira. A justificativa está na
  -- decisão 2 do cabeçalho; a recursão aparece navegando, não somando.
  (select count(*)
     from ideworks.tasks c
    where c.parent_id = t.id
      and c.archived_at is null)::int as subtask_count,

  (select count(*)
     from ideworks.tasks c
    where c.parent_id = t.id
      and c.archived_at is null
      and c.completed_at is not null)::int as subtask_done,

  (select count(*)
     from ideworks.task_checklists k
    where k.task_id = t.id)::int as checklist_count,

  (select count(*)
     from ideworks.checklist_items i
     join ideworks.task_checklists k on k.id = i.checklist_id
    where k.task_id = t.id)::int as checklist_total,

  (select count(*)
     from ideworks.checklist_items i
     join ideworks.task_checklists k on k.id = i.checklist_id
    where k.task_id = t.id
      and i.resolved_at is not null)::int as checklist_done

from ideworks.tasks t;

comment on view ideworks.task_progress is
  'A contagem de subtarefas e de itens de checklist da tarefa, numa definicao '
  'so — cartao, linha e ficha leem daqui. subtask_count e de filhas DIRETAS e '
  'nao conta arquivada; checklist_total conta o item e o filho dele.';

grant all privileges on all tables in schema ideworks to ideworks_app;

-- ============================================== O QUE ESTE ARQUIVO NÃO FAZ ===
-- NÃO TOCA EM `can_reach_task_id` NEM EM `acting_user_id`. A primeira é da
-- F17.3 e serve `task_assignees`, `task_watchers` e as quatro políticas de
-- checklist; a segunda é da F1.9 e é a base de TODA política do schema. Apagar
-- qualquer uma delas aqui derrubaria metade do sistema para desfazer uma etapa.
--
-- NÃO TOCA EM `is_meaningful_name`, que é da F17.4.
--
-- NÃO TOCA EM NENHUM DOS ONZE GATILHOS. Esta etapa não criou gatilho nenhum —
-- as quatro invariantes dela cabem em forma declarativa (colunas geradas, chave
-- estrangeira composta, `check` e política). Ver o cabeçalho da migration.
--
-- NÃO TOCA EM `tasks`. Nenhuma coluna foi acrescentada a ela nesta etapa: o
-- indicador "tem anexo" é CONTAGEM, calculada na view, e não uma coluna
-- guardada — guardar seria a mesma coisa dita em dois lugares.
--
-- ESTE ARQUIVO TEM QUE RODAR ANTES DO ROLLBACK DA F17.15, e a ordem é a
-- cronológica: `20260826110000` desfaz antes de `20260826100000`. Se alguém
-- inverter, a F17.15 apaga `task_progress` e este arquivo a recria — deixando
-- viva uma view que lê `task_checklists`, que a F17.15 já terá apagado. A ordem
-- cronológica invertida é a regra do projeto justamente para não depender de
-- acaso.
