-- F42, Fase 4 — os itens da rodada passam a viver SEM a API do Dropbox.
--
-- POR QUE
--   07/10, decisão do Wesley: no piloto vale só o link (a ligação com a API do
--   Dropbox ficou para depois — §5 do plano). Sem a API não há como ler o
--   identificador (`id:…`) nem a versão (`rev`) do arquivo; o Worker grava só o
--   link, o tipo e o nome tirados do próprio endereço. A prova do que foi
--   enviado passa a ser o link e a data do envio.
--
-- O QUE MUDA
--   1. `approval_round_items.dropbox_file_id` e `dropbox_rev` deixam de ser
--      obrigatórios (drop not null).
--   2. A restrição `approval_round_items_file_not_blank` passa a exigir texto
--      não vazio só QUANDO preenchidos: nulo pode, vazio continua recusado (o
--      nome do arquivo segue obrigatório e não vazio).
--   `create_approval_round` (F42_4) NÃO muda: ela já lê `item->>'dropbox_file_id'`
--   e `item->>'dropbox_rev'`, que viram nulo quando a chave falta no jsonb.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s (mexe na tabela dos itens).
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261007160000_ideworks_f42_5_itens_sem_api.sql`
-- (recusa se já houver item sem identificador — ver o aviso lá).

begin;
set local lock_timeout = '5s';

alter table ideworks.approval_round_items
  alter column dropbox_file_id drop not null,
  alter column dropbox_rev drop not null;

alter table ideworks.approval_round_items
  drop constraint if exists approval_round_items_file_not_blank;
alter table ideworks.approval_round_items
  add constraint approval_round_items_file_not_blank
  check (
    btrim(file_name) <> ''
    and (dropbox_file_id is null or btrim(dropbox_file_id) <> '')
    and (dropbox_rev is null or btrim(dropbox_rev) <> '')
  );

comment on table ideworks.approval_round_items is
  'F42: o material de uma rodada, na ordem do carrossel. dropbox_file_id e dropbox_rev '
  'provam qual versão de cada arquivo foi enviada QUANDO a API do Dropbox está ligada '
  '(no piloto, só link: ficam nulos — F42_5); dropbox_path é o caminho dentro do link '
  'quando o link é de pasta.';

commit;
