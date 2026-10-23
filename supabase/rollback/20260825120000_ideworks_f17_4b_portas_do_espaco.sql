-- Desfaz a F17.4b. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE, E ISTO É O MAIS IMPORTANTE DESTE ARQUIVO
--   O estado exato do fim da F17.4 — que é o estado com DUAS DAS QUATRO PORTAS
--   ABERTAS. Reverter aqui não devolve uma comodidade: devolve um buraco que a
--   sonda da F17.4b já atravessou duas vezes, com dois `update` de uma linha:
--
--     `update ideworks.lists     set space_id = <outro>`  volta a passar
--     `update ideworks.task_tags set space_id = <outro>`  volta a passar
--
--   e com eles volta o chip em branco: a ficha da tarefa mostrando `tags = []`
--   enquanto o vínculo existe, para quem alcança um lado e não o outro. Ver o
--   cabeçalho da migration para os números medidos.
--
--   NÃO APAGA NADA. Nenhuma tabela, nenhuma linha, nenhuma coluna — esta etapa
--   não criou dado, criou recusa. Reverter é seguro para o conteúdo do banco e
--   perigoso só para a integridade dele.
--
-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   gatilho → função, duas vezes. Nada mais.
--
-- GATILHO → FUNÇÃO É DEPENDÊNCIA REGISTRADA. `lists_tag_space_guard` executa
-- `list_move_tag_guard()` e `task_tags_space_guard` executa
-- `tag_move_task_guard()`: enquanto o gatilho existir, o `drop function`
-- responde `2BP01` dizendo exatamente quem depende. A recusa é a proteção, não
-- o estorvo — por isso o gatilho sai primeiro, e não porque ficaria bonito.
--
-- OS DOIS GATILHOS MORAM EM CASA ALHEIA, E OS DOIS PRECISAM DE `drop trigger`
-- EXPLÍCITO. É a mesma armadilha que o rollback da F17.4 escreveu para
-- `tasks_tag_space_guard`, e aqui ela vale DUAS vezes:
--
--   · `ideworks.lists` é da F17.1 e nenhuma reversão desta série a apaga.
--   · `ideworks.task_tags` é da F17.4. Ela cairia junto no rollback DAQUELA
--     etapa — mas o rollback daquela etapa não pode rodar antes deste, e é por
--     isso que a nota do fim existe.
--
-- Sem os `drop trigger`, as duas tabelas ficariam com gatilho apontando para
-- função que não existe mais, e a primeira lista movida quebraria com um erro
-- que não diz de onde veio.
--
-- ENTRE FUNÇÃO E FUNÇÃO NÃO HÁ DEPENDÊNCIA REGISTRADA, e aqui isso não morde:
-- as duas funções desta etapa não chamam nenhuma outra do schema — só `btrim`,
-- `lower`, `quote_literal` e `coalesce`, que são do catálogo. Não há como
-- deixar função órfã por ordem errada neste arquivo.

-- 1. A terceira porta: o gatilho da lista, e só então a função dele.
drop trigger if exists lists_tag_space_guard on ideworks.lists;
drop function if exists ideworks.list_move_tag_guard();

-- 2. A quarta porta: o gatilho da etiqueta, e só então a função dele.
drop trigger if exists task_tags_space_guard on ideworks.task_tags;
drop function if exists ideworks.tag_move_task_guard();

-- ============================================== O QUE ESTE ARQUIVO NÃO FAZ ===
-- NÃO TOCA NOS GATILHOS DA F17.4. `task_tag_assignments_space_guard` e
-- `tasks_tag_space_guard` continuam onde estão, guardando as duas primeiras
-- portas. Levá-los daqui seria desfazer uma etapa que não é esta.
--
-- NÃO TOCA NA INVARIANTE DO STATUS (F17.3). `tasks_status_guard` não é desta
-- etapa e não é mencionado em lugar nenhum da migration.
--
-- ESTE ARQUIVO TEM QUE RODAR ANTES DO ROLLBACK DA F17.4, e a ordem é a
-- cronológica: `20260825120000` desfaz antes de `20260825110000`. Se alguém
-- inverter, o `drop table ideworks.task_tags` da F17.4 leva
-- `task_tags_space_guard` junto — e aí este arquivo tenta apagar uma função que
-- o `drop table` já libertou, o que funciona por acaso e não por desenho. A
-- ordem cronológica invertida é a regra do projeto justamente para não depender
-- de acaso.
