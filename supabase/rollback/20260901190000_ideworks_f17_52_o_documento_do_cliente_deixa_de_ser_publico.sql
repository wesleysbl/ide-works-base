-- Desfaz a F17.52. Nome idêntico ao da migration, de propósito.
--
-- ⚠️ REVERTER ISTO REABRE O ACHADO A4: os 15 documentos de cliente voltam a
--   ler-se SEM LOGIN, bastando ter o endereço. Não é limpeza — é uma decisão de
--   segurança ao contrário. Só faz sentido se fechar o balde tiver quebrado
--   algo que ninguém previu e não houver tempo de consertar pela frente.
--
-- ⚠️ A ORDEM É AO CONTRÁRIO DA MIGRATION, E POR QUÊ
--   O balde volta a ser público PRIMEIRO. Assim, no instante em que as linhas
--   de `history_documents` saírem — e com elas o alcance por caminho assinado —
--   já existe o outro caminho de leitura. Na ordem inversa haveria uma janela,
--   dentro da mesma transação, sem nenhum caminho aberto.
--
-- ⚠️ O QUE ELE **NÃO** DESFAZ, DE PROPÓSITO: NADA É APAGADO DO BALDE.
--   Os 15 objetos continuam 15. Reversão de política não move byte.
--
-- ⚠️ A CHAVE `path` EM `public` SAI, E É A ÚNICA ESCRITA EM `public` AQUI.
--   Ela sai porque foi esta migration que a pôs. A `url` NUNCA foi tocada — nem
--   na ida, nem na volta —, então o dado do legado volta byte a byte ao retrato
--   de `scripts/importacao/documentos-do-legado-2026-09-01.json`.

-- 1. O balde volta a ser público. (Reabre o A4 — leia o cabeçalho.)
update storage.buckets
   set public = true
 where id = 'client-history-documents';

-- 2. A leitura volta a conferir só o nome do balde.
drop policy if exists "Authenticated can view history documents" on storage.objects;
create policy "Authenticated can view history documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'client-history-documents');

-- 3. As linhas importadas saem — só as que vieram do legado.
--    O recorte é `storage_path` presente no `documentos` do legado: um documento
--    que o próprio IDE Works tenha criado depois NÃO é desta migration e fica.
delete from ideworks.history_documents d
 where exists (
   select 1
     from public.client_history h,
          jsonb_array_elements(h.documentos) j
    where h.id = d.history_id
      and j->>'path' = d.storage_path
 );

-- 4. A chave `path` sai do jsonb do legado. A `url` continua onde sempre esteve.
--    O bloco aborta se alguma `url` tiver mudado de número — na volta a trava
--    vale tanto quanto na ida.
do $bloco$
declare
  v_urls_antes  integer;
  v_urls_depois integer;
begin
  select count(*) into v_urls_antes
    from public.client_history h, jsonb_array_elements(h.documentos) d
   where d ? 'url';

  update public.client_history h
     set documentos = (
       select jsonb_agg((d - 'path') order by ord)
         from jsonb_array_elements(h.documentos) with ordinality as t(d, ord)
     )
   where h.documentos is not null
     and jsonb_typeof(h.documentos) = 'array'
     and exists (
       select 1 from jsonb_array_elements(h.documentos) e where e ? 'path'
     );

  select count(*) into v_urls_depois
    from public.client_history h, jsonb_array_elements(h.documentos) d
   where d ? 'url';

  if v_urls_depois <> v_urls_antes then
    raise exception
      'Reversão da F17.52 ABORTADA: as `url` mudaram de % para %.',
      v_urls_antes, v_urls_depois;
  end if;
end;
$bloco$;

comment on column ideworks.history_documents.storage_path is
  'Caminho dentro do balde PRIVADO. Nunca URL: a URL do legado e publica e o '
  'arquivo le-se sem login. Aqui o servidor assina um endereco de vida curta '
  'depois de conferir que a pessoa enxerga o cliente.';
