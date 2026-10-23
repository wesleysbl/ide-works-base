-- F42, Fase 1 (parte 3 de 4) — as RODADAS de aprovação, os ITENS de cada rodada e
-- o comentário DO CLIENTE no card.
--
-- O QUE MUDA
--   1. Enums `approval_round_state` (open, approved, rejected, superseded,
--      cancelled, locked_changed), `approval_item_kind` (video, image, other) e
--      `approval_decision_via` (client_link).
--   2. `ideworks.approval_rounds`: card, cliente, número da versão (sequencial
--      POR CARD, único por card), legenda COPIADA da descrição no envio (editar a
--      descrição depois não altera a rodada, de propósito), quem enviou e quando,
--      estado, quando e como foi decidida, quando saiu das abertas
--      (`closed_at`) e o comentário que acompanhou a decisão.
--      UMA RODADA ABERTA POR CARD: índice único parcial.
--      Coerência no banco: aberta não tem decisão nem fechamento; aprovada e
--      reprovada têm `decided_at` e `decided_via`; os demais estados têm
--      `closed_at`.
--   3. `ideworks.approval_round_items`: ordem (única na rodada), link do Dropbox,
--      tipo, nome do arquivo, identificador (`id:…`) e versão (`rev`) do arquivo
--      no Dropbox, e o caminho dentro do link quando o link é de PASTA.
--   4. `task_comments` ganha `from_client` (a marca "do cliente") e o vínculo
--      opcional com a rodada e com o item. Comentário do cliente NÃO TEM AUTOR
--      (`author_id` já era anulável — conta apagada); a restrição exige
--      `author_id` nulo quando `from_client`. Como `task_comments_update/delete`
--      exigem `author_id = acting_user_id()`, ninguém da equipe edita nem apaga o
--      que o cliente escreveu. As leituras internas existentes listam colunas
--      explicitamente e já lidam com autor nulo (`display_name(null)`): nada muda
--      para elas.
--   5. Gatilho em `tasks`: card ARQUIVADO ou que MUDA DE CLIENTE cancela as
--      rodadas abertas (§3 do plano). Card apagado leva as rodadas junto
--      (`on delete cascade`, igual aos comentários).
--   6. COMENTÁRIO COERENTE COM A RODADA: chave estrangeira não passa pela
--      segurança por linha, então quem escreve comentário poderia apontar a
--      rodada de OUTRO card (de outro cliente). O gatilho
--      `task_comments_approval_coherent` recusa (SQLSTATE `IW042`, hint
--      `comment_outside_round`): a rodada tem de ser do MESMO card do
--      comentário, e o item, DAQUELA rodada. Item sem rodada já era recusado
--      pela restrição `task_comments_item_needs_round`. Quando a rodada some
--      (card ou cliente apagado), o `on delete set null` anula também o item,
--      para a restrição não travar a exclusão.
--   7. O CLIENTE NÃO MENCIONA A EQUIPE: o gatilho de menções da F17.82
--      (`task_comments_mentions`, `sync_text_mentions`) deixa de olhar o
--      comentário `from_client`. Sem isso, um texto do cliente com mais de 20
--      marcas "@[..](mention:..)" faria a decisão falhar (23514). Ele vira dois
--      gatilhos: inserir/editar o texto — só para comentário da equipe — e
--      apagar, para todos (apagar menção que não existe não faz mal).
--
-- TRAVAS: tudo numa transação, com `lock_timeout` de 5 s — `task_comments` e
-- `tasks` são quentes; melhor falhar e repetir do que enfileirar o quadro.
--
-- ESCRITA SÓ POR FUNÇÃO
--   Rodadas e itens não têm política de insert/update/delete, e o papel do app só
--   recebe `select`. Quem escreve são `create_approval_round` e
--   `decide_approval_round` (parte 4), `security definer`, que conferem o
--   alcance de quem envia e o token de quem decide.
--
-- SEGURANÇA POR LINHA (leitura)
--   Rodada: quem alcança o card E enxerga o cliente. Item: quem enxerga a
--   rodada dele.
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261007150200_ideworks_f42_3_rodadas_de_aprovacao.sql`.

begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'ideworks' and t.typname = 'approval_round_state') then
    create type ideworks.approval_round_state as enum
      ('open', 'approved', 'rejected', 'superseded', 'cancelled', 'locked_changed');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'ideworks' and t.typname = 'approval_item_kind') then
    create type ideworks.approval_item_kind as enum ('video', 'image', 'other');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'ideworks' and t.typname = 'approval_decision_via') then
    create type ideworks.approval_decision_via as enum ('client_link');
  end if;
end
$$;

comment on type ideworks.approval_round_state is
  'F42: open (aguardando o cliente), approved, rejected, superseded (nova versão '
  'enviada), cancelled (card arquivado ou mudou de cliente), locked_changed (material '
  'alterado no Dropbox depois do envio).';

create table if not exists ideworks.approval_rounds (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references ideworks.tasks (id) on delete cascade,
  client_id           uuid not null references ideworks.clients (id) on delete cascade,
  version             integer not null,
  caption             text,
  sent_by             uuid references auth.users (id) on delete set null,
  sent_at             timestamptz not null default now(),
  state               ideworks.approval_round_state not null default 'open',
  decided_at          timestamptz,
  decided_via         ideworks.approval_decision_via,
  decision_comment_id uuid references ideworks.task_comments (id) on delete set null,
  closed_at           timestamptz,

  constraint approval_rounds_version_positive check (version > 0),
  constraint approval_rounds_version_per_task unique (task_id, version),
  constraint approval_rounds_state_coherent check (
    case state
      when 'open' then decided_at is null and decided_via is null and closed_at is null
      when 'approved' then decided_at is not null and decided_via is not null
      when 'rejected' then decided_at is not null and decided_via is not null
      else closed_at is not null and decided_at is null and decided_via is null
    end
  )
);

create unique index if not exists approval_rounds_one_open_per_task
  on ideworks.approval_rounds (task_id) where state = 'open';
create index if not exists approval_rounds_client_idx
  on ideworks.approval_rounds (client_id, sent_at desc);

comment on table ideworks.approval_rounds is
  'F42: cada envio para aprovação do cliente é uma rodada (versão sequencial por card). '
  'Legenda copiada da descrição no envio. Uma aberta por card. Escrita só por '
  'create_approval_round e decide_approval_round.';
comment on column ideworks.approval_rounds.caption is
  'Cópia da descrição do card no envio. Editar a descrição depois não altera a rodada.';

create table if not exists ideworks.approval_round_items (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references ideworks.approval_rounds (id) on delete cascade,
  position        integer not null,
  dropbox_url     text not null,
  dropbox_path    text,
  kind            ideworks.approval_item_kind not null,
  file_name       text not null,
  dropbox_file_id text not null,
  dropbox_rev     text not null,
  created_at      timestamptz not null default now(),

  constraint approval_round_items_position_positive check (position > 0),
  constraint approval_round_items_position_per_round unique (round_id, position),
  constraint approval_round_items_url_is_dropbox
    check (dropbox_url ~* '^https://([a-z0-9-]+\.)*dropbox\.com/'),
  constraint approval_round_items_file_not_blank
    check (btrim(file_name) <> '' and btrim(dropbox_file_id) <> '' and btrim(dropbox_rev) <> '')
);

comment on table ideworks.approval_round_items is
  'F42: o material de uma rodada, na ordem do carrossel. dropbox_file_id e dropbox_rev '
  'provam qual versão de cada arquivo foi enviada; dropbox_path é o caminho dentro '
  'do link quando o link é de pasta.';

-- --- o comentário do cliente -------------------------------------------------
alter table ideworks.task_comments
  add column if not exists from_client boolean not null default false,
  add column if not exists approval_round_id uuid references ideworks.approval_rounds (id) on delete set null,
  add column if not exists approval_item_id uuid references ideworks.approval_round_items (id) on delete set null;

alter table ideworks.task_comments drop constraint if exists task_comments_client_has_no_author;
alter table ideworks.task_comments
  add constraint task_comments_client_has_no_author
  check (not from_client or author_id is null);

alter table ideworks.task_comments drop constraint if exists task_comments_item_needs_round;
alter table ideworks.task_comments
  add constraint task_comments_item_needs_round
  check (approval_item_id is null or approval_round_id is not null);

create index if not exists task_comments_round_idx
  on ideworks.task_comments (approval_round_id) where approval_round_id is not null;

comment on column ideworks.task_comments.from_client is
  'F42: escrito pelo cliente pelo link de aprovação. Sem autor (author_id nulo) — '
  'ninguém da equipe edita nem apaga.';

-- --- segurança por linha -----------------------------------------------------
alter table ideworks.approval_rounds enable row level security;
alter table ideworks.approval_round_items enable row level security;

drop policy if exists approval_rounds_select on ideworks.approval_rounds;
create policy approval_rounds_select on ideworks.approval_rounds
  for select using (ideworks.can_reach_task_id(task_id) and ideworks.can_see_client(client_id));

-- A subconsulta em `approval_rounds` já passa pela política de lá.
drop policy if exists approval_round_items_select on ideworks.approval_round_items;
create policy approval_round_items_select on ideworks.approval_round_items
  for select using (exists (select 1 from ideworks.approval_rounds r where r.id = round_id));

revoke all on table ideworks.approval_rounds from public, anon, authenticated, ideworks_app;
revoke all on table ideworks.approval_round_items from public, anon, authenticated, ideworks_app;
grant select on table ideworks.approval_rounds to ideworks_app;
grant select on table ideworks.approval_round_items to ideworks_app;

-- --- comentário coerente com a rodada (e com o item) -----------------------
create or replace function ideworks.task_comments_approval_coherent()
  returns trigger
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  -- A rodada sumiu (card ou cliente apagado) e o `on delete set null` anulou o
  -- vínculo: o item vai junto, senão a restrição "item exige rodada" trava a
  -- exclusão. Fora desse caso, item sem rodada continua recusado pela restrição.
  if tg_op = 'UPDATE' and new.approval_round_id is null and old.approval_round_id is not null
     and not exists (select 1 from ideworks.approval_rounds r where r.id = old.approval_round_id) then
    new.approval_item_id := null;
  end if;

  -- Só confere o que MUDOU: nas exclusões em cascata a rodada pode já ter saído
  -- enquanto o outro vínculo é anulado, e o vínculo intacto não é escrita nova.
  if new.approval_round_id is not null
     and (tg_op = 'INSERT'
          or new.approval_round_id is distinct from old.approval_round_id
          or new.task_id is distinct from old.task_id)
     and not exists (select 1 from ideworks.approval_rounds r
                      where r.id = new.approval_round_id and r.task_id = new.task_id) then
    raise exception 'O comentario aponta uma rodada de aprovacao de outro card.'
      using errcode = 'IW042', hint = 'comment_outside_round';
  end if;

  -- Item sem rodada fica para a restrição `task_comments_item_needs_round` (23514).
  if new.approval_item_id is not null and new.approval_round_id is not null
     and (tg_op = 'INSERT'
          or new.approval_item_id is distinct from old.approval_item_id
          or new.approval_round_id is distinct from old.approval_round_id)
     and not exists (select 1 from ideworks.approval_round_items i
                      where i.id = new.approval_item_id and i.round_id = new.approval_round_id) then
    raise exception 'O comentario aponta um item que nao e desta rodada de aprovacao.'
      using errcode = 'IW042', hint = 'comment_outside_round';
  end if;

  return new;
end;
$fn$;

comment on function ideworks.task_comments_approval_coherent() is
  'F42: comentário com rodada exige rodada do MESMO card; com item, item DAQUELA '
  'rodada. A chave estrangeira sozinha não confere (não passa pela segurança por linha).';

revoke all on function ideworks.task_comments_approval_coherent() from public, anon, authenticated, ideworks_app;

drop trigger if exists task_comments_approval_coherent on ideworks.task_comments;
create trigger task_comments_approval_coherent
  before insert or update of task_id, approval_round_id, approval_item_id on ideworks.task_comments
  for each row execute function ideworks.task_comments_approval_coherent();

-- --- menções: o comentário do cliente fica de fora -------------------------
-- O mesmo `sync_text_mentions` da F17.82, sem tocar no corpo dele; só o gatilho
-- de `task_comments` ganha a condição. `when` não pode ler `new` no delete, por
-- isso o apagar vira um gatilho à parte.
drop trigger if exists task_comments_mentions on ideworks.task_comments;
create trigger task_comments_mentions
  after insert or update of body on ideworks.task_comments
  for each row when (not new.from_client)
  execute function ideworks.sync_text_mentions();

drop trigger if exists task_comments_mentions_delete on ideworks.task_comments;
create trigger task_comments_mentions_delete
  after delete on ideworks.task_comments
  for each row execute function ideworks.sync_text_mentions();

-- --- card arquivado ou com outro cliente: rodadas abertas canceladas ---------
create or replace function ideworks.approval_rounds_cancel_on_task_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if (new.archived_at is not null and old.archived_at is null)
     or new.client_id is distinct from old.client_id then
    update ideworks.approval_rounds r
       set state = 'cancelled', closed_at = now()
     where r.task_id = new.id
       and r.state = 'open';
  end if;
  return null;
end;
$fn$;

comment on function ideworks.approval_rounds_cancel_on_task_change() is
  'F42: card arquivado ou que mudou de cliente cancela as rodadas de aprovação abertas.';

revoke all on function ideworks.approval_rounds_cancel_on_task_change() from public, anon, authenticated;

drop trigger if exists tasks_approval_rounds_cancel on ideworks.tasks;
create trigger tasks_approval_rounds_cancel
  after update of archived_at, client_id on ideworks.tasks
  for each row execute function ideworks.approval_rounds_cancel_on_task_change();

commit;
