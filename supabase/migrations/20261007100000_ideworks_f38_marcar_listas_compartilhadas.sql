-- F38, Fase 6 — a tarefa nasce com cliente (parte 2 de 2: marcar as listas compartilhadas).
--
-- ⚠️ APLIQUE SÓ JUNTO COM A PUBLICAÇÃO DA FASE 7 (o seletor de cliente no quadro).
--   Depende de `20261007090000_ideworks_f38_lista_exige_cliente.sql` (a coluna
--   `lists.requires_client` e o gatilho `tasks_client_from_list`). Assim que esta
--   roda, criar tarefa sem cliente nas quatro listas abaixo passa a ser recusado
--   (23514 no banco; 400 no quadro; `invalid_input` no MCP). Sem o seletor da
--   Fase 7 publicado, a equipe não teria como escolher o cliente e ficaria
--   travada nessas listas.
--
-- O QUE MUDA
--   As quatro listas compartilhadas de hoje recebem a marca: ATENDIMENTO,
--   ESTÚDIO, Estúdio Ide e Jobs Antonelli (todas do espaço AGÊNCIA IDE).
--
-- POR QUE AS LISTAS VÃO POR ID (e não por nome)
--   Nome de lista não é único e pode ser renomeado; id é. Lidos em 07/10/2026
--   no banco de produção, numa transação só de leitura: as quatro listas
--   abaixo são do espaço AGÊNCIA IDE (empresa Ide), estão vivas e não têm
--   cliente. A condição `client_id is null` impede marcar, por engano, uma
--   lista de cliente; em outro banco (sem esses ids) o update não toca nada.
--   Repetir é inofensivo: marcar de novo o que já está marcado não muda nada.
--
-- REVERSÃO (volta ao estado da parte 1: nada bloqueado)
--   update ideworks.lists
--      set requires_client = false
--    where id in (
--            'aaaa0001-0000-4000-8000-000000000001',
--            'aaaa0001-0000-4000-8000-000000000002',
--            'aaaa0001-0000-4000-8000-000000000003',
--            'aaaa0001-0000-4000-8000-000000000004'
--          );
--   -- Tarefas criadas enquanto valeu continuam com o cliente escolhido.

update ideworks.lists
   set requires_client = true
 where id in (
         'aaaa0001-0000-4000-8000-000000000001',  -- ATENDIMENTO   (pasta ATENDIMENTO)
         'aaaa0001-0000-4000-8000-000000000002',  -- ESTÚDIO       (pasta ESTÚDIO)
         'aaaa0001-0000-4000-8000-000000000003',  -- Estúdio Ide   (pasta TIME HELENA)
         'aaaa0001-0000-4000-8000-000000000004'   -- Jobs Antonelli (pasta TIME HELENA)
       )
   and client_id is null;
