-- Desfaz a F17.51. Nome idêntico ao da migration, de propósito.
--
-- ⚠️ ESTE ARQUIVO NASCEU NA F17.52, junto com a migration que ele desfaz — a
--   F17.51 foi aplicada sem irmã em `rollback/`, e essa era metade da dívida.
--
-- O QUE ELE DEVOLVE
--   As duas políticas de `storage.objects` como estavam antes: conferindo SÓ o
--   nome do balde, sem dono e sem cliente. Ou seja, **devolve o achado A4 da
--   auditoria** — qualquer conta autenticada volta a apagar e a alterar os 15
--   documentos de cliente.
--
--   Reverter isto só faz sentido se a própria função estiver quebrando algo
--   legítimo. Não é limpeza: é reabrir uma porta.
--
-- ⚠️ A ORDEM IMPORTA, E ELA É AO CONTRÁRIO DA MIGRATION
--   As políticas saem ANTES da função. Apagar a função primeiro deixaria duas
--   políticas apontando para um objeto que não existe, e toda escrita no balde
--   passaria a falhar com "function does not exist" em vez de recusar por
--   permissão — que é o defeito confuso, não o seguro.
--
-- ⚠️ SE A F17.52 JÁ ESTIVER APLICADA, DESFAÇA-A PRIMEIRO.
--   A política de `select` da F17.52 também chama esta função. Rodar só este
--   arquivo derrubaria a leitura do balde inteiro.

drop policy if exists "Authenticated can delete history documents" on storage.objects;
create policy "Authenticated can delete history documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'client-history-documents');

drop policy if exists "Authenticated can update history documents" on storage.objects;
create policy "Authenticated can update history documents"
  on storage.objects for update to authenticated
  using (bucket_id = 'client-history-documents')
  with check (bucket_id = 'client-history-documents');

drop function if exists ideworks.can_touch_history_document(text);
