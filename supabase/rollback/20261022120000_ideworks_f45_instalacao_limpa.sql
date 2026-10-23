-- Desfaz a F45: remove o balde `client-history-documents` SÓ se ele estiver
-- vazio. Com arquivo dentro, não apaga nada e avisa: documento de cliente não
-- se perde por rollback.

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'client-history-documents') then
    raise notice 'F45: o balde client-history-documents tem arquivos; ficou como está.';
  else
    delete from storage.buckets where id = 'client-history-documents';
  end if;
end $$;
