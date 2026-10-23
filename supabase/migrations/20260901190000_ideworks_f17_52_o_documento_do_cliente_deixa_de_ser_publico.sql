-- F17.52 (parte 2 de 2) — O DOCUMENTO DO CLIENTE DEIXA DE SER PUBLICO.
--
-- ⚠️ ESTA MIGRATION ESCREVE EM `public`, E E A UNICA DO PROJETO QUE PODE.
--   A regra do projeto (D8, `supabase/README.md`) e que `public` pertence ao
--   Sistema IDE e nao se toca. O usuario autorizou a excecao EXPLICITAMENTE,
--   para esta etapa e SO para o campo `documentos` de `public.client_history`.
--   Nenhuma outra tabela, coluna ou linha de `public` e tocada aqui.
--
-- O ACHADO (A4 da auditoria de 2026-09-01)
--   `client-history-documents` e `public = true`: os 15 documentos de cliente
--   — 13 PDFs, 1 imagem, 1 Word, entre eles contratos e a transcricao de uma
--   reuniao — abrem SEM LOGIN, bastando ter o endereco. A F17.51 tirou o poder
--   de apagar e de alterar. Falta a leitura, que e esta parte.
--
-- ⚠️ A URL PUBLICA ESTA GRAVADA DENTRO DO DADO DO LEGADO
--   `public.client_history.documentos` e um `jsonb` array, em 9 registros:
--
--     [{ "id": "1700000000001",
--        "url": "https://<projeto>.supabase.co/storage/v1/object/public/
--                client-history-documents/1700000000000-exemplo00.pdf",
--        "nome": "Transcricao_Reuniao_Exemplo.pdf",
--        "tipo": "file", "tamanho": 79872,
--        "data_upload": "2025-08-01T13:51:50.519Z" }]
--
--   Fechar o balde sem mais nada deixaria 9 documentos sem NENHUM caminho de
--   leitura: o legado nao os abriria mais, e o IDE Works nunca soube deles.
--
-- O DESENHO: NAO DESTRUTIVO. NAO SE REMOVE A `url`; ACRESCENTA-SE O `path`.
--   Remover a `url` e irreversivel e cega o legado no mesmo instante.
--   Acrescentar o `path` ao lado dela e reversivel — o rollback e apagar a
--   chave nova — e deixa o dado do legado exatamente como estava ate o balde
--   fechar. O retrato de antes esta em
--   `scripts/importacao/documentos-do-legado-2026-09-01.json`.
--
-- ⚠️ A ORDEM DOS QUATRO BLOCOS NAO PODE SER INVERTIDA
--   1. o `path` entra ao lado da `url`     — o dado passa a saber o caminho
--   2. os 9 entram em `history_documents`  — o IDE Works passa a saber deles
--   3. a politica de LEITURA pergunta dono — quem alcanca o cliente le
--   4. o balde vira privado                — o endereco publico morre
--
--   Invertendo, o balde fecha antes de existir quem saiba abrir, e os
--   documentos ficam inalcancaveis por todos. Balde aberto e ruim; documento
--   que ninguem abre e pior.
--
-- ⚠️ O QUE ISTO QUEBRA, E O USUARIO ACEITOU
--   Fechado o balde, os links `/object/public/...` do Sistema IDE param de
--   abrir. O legado esta fora do ar, e esta e a janela de menor custo. O dado
--   nao se perde: a `url` continua gravada e o `path` fica ao lado dela.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O `path`, AO LADO DA `url`. A UNICA ESCRITA EM `public` DESTE PROJETO.
--
--    O bloco conta as `url` antes e depois e ABORTA se o numero mudar. Nao e
--    zelo decorativo: `jsonb_agg` reconstroi o array inteiro, e um erro de
--    escrita aqui apagaria documento de cliente em silencio. A trava roda
--    DENTRO da mesma transacao da migration, entao a recusa desfaz tudo.
--
--    E idempotente: documento que ja tem `path` passa intacto.
-- ─────────────────────────────────────────────────────────────────────────────
do $bloco$
declare
  v_prefixo   constant text := '/object/public/client-history-documents/';
  v_urls_antes  integer;
  v_urls_depois integer;
  v_com_path    integer;
begin
  -- INSTALAÇÃO LIMPA: sem o banco do sistema anterior (public.client_history),
  -- não há o que converter, e o bloco não faz nada.
  if to_regclass('public.client_history') is null then
    raise notice 'F17.52: sem public.client_history, nada a converter.';
    return;
  end if;

  select count(*) into v_urls_antes
    from public.client_history h, jsonb_array_elements(h.documentos) d
   where d ? 'url';

  update public.client_history h
     set documentos = (
       select jsonb_agg(
                case
                  -- Ja tem caminho: passa intacto. Chamar de novo nao muda nada.
                  when d ? 'path' then d
                  -- Endereco publico deste balde: o caminho e o que vem depois
                  -- do prefixo. `||` ACRESCENTA — nao substitui a `url`.
                  when position(v_prefixo in coalesce(d->>'url','')) > 0
                    then d || jsonb_build_object(
                           'path', split_part(d->>'url', v_prefixo, 2))
                  -- Qualquer outra coisa fica como esta. Um documento com
                  -- endereco de outro balde nao e problema desta etapa, e
                  -- adivinhar o caminho dele seria inventar dado.
                  else d
                end
                order by ord)
         from jsonb_array_elements(h.documentos) with ordinality as t(d, ord)
     )
   where h.documentos is not null
     and jsonb_typeof(h.documentos) = 'array'
     and exists (
       select 1 from jsonb_array_elements(h.documentos) e
        where not (e ? 'path')
          and position(v_prefixo in coalesce(e->>'url','')) > 0
     );

  select count(*) into v_urls_depois
    from public.client_history h, jsonb_array_elements(h.documentos) d
   where d ? 'url';

  select count(*) into v_com_path
    from public.client_history h, jsonb_array_elements(h.documentos) d
   where d ? 'path';

  if v_urls_depois <> v_urls_antes then
    raise exception
      'F17.52 ABORTADA: as `url` de public.client_history mudaram de % para %. '
      'Nenhuma url pode sumir — o desenho e ACRESCENTAR o caminho, nunca trocar.',
      v_urls_antes, v_urls_depois;
  end if;

  raise notice 'F17.52: % url(s) intacta(s), % documento(s) com caminho.',
    v_urls_depois, v_com_path;
end;
$bloco$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. OS DOCUMENTOS DO LEGADO ENTRAM EM `ideworks.history_documents`.
--
--    ⚠️ ESTA TABELA ESTAVA VAZIA — zero linhas. A F11d migrou os 75 eventos de
--    historico e deixou os anexos de fora, com o motivo escrito: "o anexo NAO
--    vem: depende de balde privado, que ainda nao existe". Ele passa a existir
--    tres linhas abaixo, entao os anexos vem agora.
--
--    Sem este bloco, a etapa inteira seria teatro: o IDE Works nao teria o que
--    servir, e `can_touch_history_document` continuaria devolvendo `false` para
--    todo mundo — protegendo por vazio, e nao por dono.
--
--    A tabela guarda CAMINHO, nunca URL. Ver o comentario da coluna na F4.9.
--
--    `mime_type` vem do proprio balde (`storage.objects.metadata`), e nao do
--    jsonb do legado: o jsonb nao registra tipo, so `"tipo": "file"`.
--    `uploaded_by` fica NULO de proposito — o legado nao gravou quem subiu, e
--    inventar um responsavel e pior do que admitir que nao se sabe.
-- ─────────────────────────────────────────────────────────────────────────────
do $copia$
begin
  -- INSTALAÇÃO LIMPA: sem public.client_history, não há documento a copiar.
  if to_regclass('public.client_history') is null then
    return;
  end if;
  execute $sql$
    insert into ideworks.history_documents
      (history_id, storage_path, file_name, mime_type, size_bytes, uploaded_at)
    select h.id,
           d->>'path',
           d->>'nome',
           o.metadata->>'mimetype',
           nullif(d->>'tamanho', '')::bigint,
           coalesce((d->>'data_upload')::timestamptz, h.created_at)
      from public.client_history h
      cross join lateral jsonb_array_elements(h.documentos) d
      join ideworks.client_history i on i.id = h.id
      left join storage.objects o
        on o.bucket_id = 'client-history-documents'
       and o.name = d->>'path'
     where d ? 'path'
       and btrim(coalesce(d->>'nome', '')) <> ''
    on conflict (history_id, storage_path) do nothing;
  $sql$;
end;
$copia$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A LEITURA PASSA A PERGUNTAR DE QUEM E O DOCUMENTO.
--
--    A politica antiga conferia so o nome do balde, entao QUALQUER conta
--    autenticada lia os 15 — as 21 pessoas da agencia, o login do legado e
--    qualquer conta nova, sem nenhuma conferencia de cliente. Agora ela usa a
--    mesma `can_touch_history_document` da F17.51: quem alcanca o cliente le o
--    documento dele.
--
--    ⚠️ ISTO NAO E O QUE FECHA O BALDE. Politica de `storage.objects` nao vale
--    para `anon` num balde publico — o endereco `/object/public/...` nem passa
--    por RLS. Quem fecha e o bloco 4. Este bloco fecha o outro buraco do mesmo
--    achado: o `select` largo demais para quem TEM crachá.
--
--    ⚠️ O WORKER NAO PERDE NADA COM ISTO. Ele fala com o Storage pelo papel
--    `service_role`, que ignora segurança por linha, e confere o alcance ANTES,
--    no banco, sob o ator declarado — `ideworks.history_documents` tem politica
--    propria desde a F4.9. A chave e TRANSPORTE, e nao autorizacao.
--
--    Objeto SEM linha em `history_documents` — os 6 orfaos medidos no balde —
--    deixa de ser legivel por crachá, pelo mesmo motivo da F17.51: sem dono
--    conhecido, a resposta e nao. Eles continuam la, intactos, e alcancaveis
--    pelo papel de servico.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Authenticated can view history documents" on storage.objects;
create policy "Authenticated can view history documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'client-history-documents'
    and ideworks.can_touch_history_document(name)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. O BALDE VIRA PRIVADO. E ESTA E A LINHA DA ETAPA.
--
--    `public = false` faz o Storage recusar `/object/public/...` com 400 para
--    qualquer um, com crachá ou sem. A partir daqui, o unico caminho ate os
--    bytes e um endereco assinado de vida curta, emitido pelo Worker depois de
--    o banco dizer que quem pediu alcanca o cliente.
--
--    O NUMERO DE OBJETOS NAO MUDA: 15 antes, 15 depois. Nada e apagado aqui.
--
--    ⚠️ SQL NAO FECHA A BORDA. FALTA UM PASSO, E ELE NAO CABE AQUI. MEDIDO.
--      Um objeto BUSCADO enquanto o balde era publico fica na cache da
--      Cloudflare com `Cache-Control: public, max-age=3600`, e a borda continua
--      entregando os bytes com `cf-cache-status: HIT` sem perguntar nada a
--      origem. Logo depois desta migration, 14 dos 15 ja respondiam 400 e 1
--      respondia 200 — o unico que a propria prova tinha buscado minutos antes.
--
--      O CONSERTO E A API DE PURGA, e nao reescrever o objeto. Reenviar os
--      bytes tambem invalidaria a cache, mas poe em risco um arquivo que e
--      contrato de cliente. A purga nao toca em byte nenhum:
--
--        curl -X DELETE \
--          "https://<projeto>.supabase.co/storage/v1/cdn/client-history-documents" \
--          -H "apikey: $IDEWORKS_SERVER_SUPABASE_SERVICE_KEY"
--
--      Rodado em 2026-09-01, resposta `{"message":"success"}`. A propagacao
--      leva ate 60 s. QUEM REAPLICAR ESTA MIGRATION NUM AMBIENTE NOVO TEM DE
--      RODAR ESSA LINHA DEPOIS — uma migration nao fala HTTP, e a borda nao le
--      `storage.buckets`.
--
--      A prova `scripts/provar-documento-do-cliente.mjs` mede as duas coisas em
--      separado: a origem (com parametro novo, que a borda nunca guardou) e os
--      15 pelo endereco de verdade, que e o que mede a borda.
-- ─────────────────────────────────────────────────────────────────────────────
update storage.buckets
   set public = false
 where id = 'client-history-documents';

comment on column ideworks.history_documents.storage_path is
  'Caminho dentro do balde PRIVADO. Nunca URL: ate a F17.52 o balde do legado '
  'era publico e o arquivo lia-se sem login. Desde a F17.52 ele e privado, e o '
  'servidor assina um endereco de vida curta depois de conferir que a pessoa '
  'enxerga o cliente.';
