-- F17.51 (parte 1 de 2) — TIRAR A DESTRUICAO DAS MAOS DE QUALQUER UM.
--
-- ⚠️ ESTE ARQUIVO FOI ESCRITO DEPOIS, NA F17.52.
--   A F17.51 foi aplicada direto no banco (versao 20260901173112) e nao deixou
--   arquivo nem irma em `rollback/`. O texto abaixo e o das instrucoes
--   gravadas em `supabase_migrations.schema_migrations`, sem uma virgula de
--   diferenca — o arquivo existe para o repositorio parar de mentir sobre o que
--   ha no banco, e porque `conferir-schema.mjs` acusava a funcao nova como
--   "no banco, fora do retrato".
--
-- ACHADO DA AUDITORIA DE 2026-09-01 (A4)
--   As tres politicas do balde `client-history-documents` conferiam SO o nome
--   do balde. Sem dono, sem cliente, sem nada:
--
--     using (bucket_id = 'client-history-documents')
--
--   Resultado medido: QUALQUER conta autenticada apagava ou alterava os 15
--   documentos de cliente — contratos e transcricoes de reuniao. A autenticacao
--   e compartilhada com o Sistema IDE, entao "qualquer conta" sao as 21 pessoas
--   da agencia mais quem entrar depois.
--
-- POR QUE ESTA PARTE VEM SOZINHA, E ANTES
--   Fechar a LEITURA exige tornar o balde privado, e isso quebra os enderecos
--   `/object/public/...` que o Sistema IDE gravou. E decisao com custo, e o
--   IDE Works precisa antes saber servir por endereco assinado.
--
--   Tirar o poder de APAGAR nao tem esse custo: ninguem legitimo depende de
--   "qualquer pessoa destroi documento de cliente". Entao esta parte entra
--   agora, e a leitura espera a parte 2.
--
-- A REGRA NOVA: quem alcanca o CLIENTE mexe no documento dele.
--   O caminho do arquivo esta em `ideworks.history_documents.storage_path`, que
--   liga a `client_history` e dali ao cliente. `can_see_client` e a mesma regra
--   corrigida na F17.32 — nao ha segunda versao dela aqui.
--
--   ⚠️ Objeto SEM linha em `history_documents` fica sem dono conhecido, e por
--   isso NAO se apaga por esta porta. Orfao se remove por decisao humana, com
--   o papel de servico — nao por acidente de quem passava.

create or replace function ideworks.can_touch_history_document(p_object_name text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- Existe documento com este caminho, e quem age alcanca o cliente dele.
  select exists (
    select 1
      from ideworks.history_documents d
      join ideworks.client_history h on h.id = d.history_id
     where d.storage_path = p_object_name
       and ideworks.can_see_client(h.client_id)
  )
$fn$;

comment on function ideworks.can_touch_history_document(text) is
  'Quem alcanca o cliente mexe no documento dele. O caminho do objeto e a '
  'chave: sem linha em history_documents nao ha dono conhecido, e a resposta e '
  'nao — orfao se remove por decisao humana, nao por acidente.';

revoke all on function ideworks.can_touch_history_document(text) from public;
grant execute on function ideworks.can_touch_history_document(text) to ideworks_app, authenticated;

-- As duas que destroem passam a perguntar de quem e o documento.
drop policy if exists "Authenticated can delete history documents" on storage.objects;
create policy "Authenticated can delete history documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-history-documents'
    and ideworks.can_touch_history_document(name)
  );

drop policy if exists "Authenticated can update history documents" on storage.objects;
create policy "Authenticated can update history documents"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'client-history-documents'
    and ideworks.can_touch_history_document(name)
  )
  with check (
    bucket_id = 'client-history-documents'
    and ideworks.can_touch_history_document(name)
  );

-- A LEITURA NAO MUDA NESTA PARTE, E ISSO E DELIBERADO.
--   O balde continua publico ate a parte 2; apertar so o `select` daria falsa
--   sensacao de fechado enquanto o endereco publico continua abrindo o arquivo
--   para quem o tiver.
