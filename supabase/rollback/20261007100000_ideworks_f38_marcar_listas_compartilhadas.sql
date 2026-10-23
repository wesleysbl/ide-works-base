-- Desfaz a parte 2 da F38 Fase 6: volta as 4 listas compartilhadas a aceitar tarefa sem cliente.
update ideworks.lists
   set requires_client = false
 where id in (
         'aaaa0001-0000-4000-8000-000000000001',  -- ATENDIMENTO
         'aaaa0001-0000-4000-8000-000000000002',  -- ESTÚDIO
         'aaaa0001-0000-4000-8000-000000000003',  -- Estúdio Ide
         'aaaa0001-0000-4000-8000-000000000004'   -- Jobs Antonelli
       );
