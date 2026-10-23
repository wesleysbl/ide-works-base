-- =============================================================================
-- ROLLBACK DA F17.17 — o teto do anexo volta para 25 MiB
-- =============================================================================
-- ⚠️ NAO EXECUTE ISTO SEM DECISAO DO USUARIO. O teto de 5 MB foi pedido por ele
--    em 2026-08-26 ("5mb no maximooooo"). Voltar para 25 MiB e desfazer uma
--    decisao de produto, e nao consertar um defeito.
--
-- O QUE ELE DESFAZ, E EM QUE ORDEM
--   O inverso exato da migration, nos mesmos dois lugares e com o mesmo
--   cuidado: o `check` da linha e o `file_size_limit` do balde voltam JUNTOS,
--   na mesma transacao. Desfazer so um deixaria os dois discordando — que e
--   precisamente o estado que a migration existe para impedir.
--
-- ⚠️ SUBIR O TETO E SEMPRE SEGURO NO SENTIDO DOS DADOS
--   Nenhuma linha existente pode violar um teto MAIOR, entao a validacao do
--   `check` passa sempre. O risco deste rollback nao esta nos dados: esta na
--   tela, que continuaria escrita para 5 MB.
--
--   Por isso, quem executar isto tem que desfazer TAMBEM o lado do codigo —
--   `TETO_DE_BYTES`, em `src/board/conversa.ts`, de onde a tela, o servidor e a
--   borda leem o numero. Sem isso o sistema aceitaria no banco o que a tela
--   recusa, que e o defeito ao contrario e igualmente confuso.
--
-- O QUE ELE NAO FAZ
--   Nao apaga o balde, nao mexe em politica, nao toca no schema `public` e nao
--   cria nem apaga usuario.
-- =============================================================================

alter table ideworks.task_attachments
  drop constraint if exists task_attachments_size_ceiling;

alter table ideworks.task_attachments
  add constraint task_attachments_size_ceiling check (byte_size <= 26214400);

comment on constraint task_attachments_size_ceiling on ideworks.task_attachments is
  '25 MiB. O teto e da memoria do Worker (128 MB), que segura o corpo inteiro '
  'para repassa-lo ao balde — nao do Postgres nem do balde.';

update storage.buckets
   set file_size_limit = 26214400
 where id = 'ideworks-anexos';

do $$
declare
  do_balde bigint;
begin
  select file_size_limit into do_balde
    from storage.buckets where id = 'ideworks-anexos';
  if do_balde is distinct from 26214400 then
    raise exception 'o teto do balde ficou em % em vez de 26214400', do_balde;
  end if;
  raise notice 'teto do anexo de volta em 25 MiB — lembre de desfazer TETO_DE_BYTES no codigo';
end $$;
