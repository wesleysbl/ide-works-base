-- F42, Fase 9 — as ARTES ANEXADAS ao card viram material da aprovação.
--
-- POR QUE
--   Na prova ao vivo (07/10) as artes do card de teste eram anexos PNG
--   (`task_attachments`, balde privado `ideworks-anexos`), não links do
--   Dropbox. Decisão (Wesley delegou): anexo de imagem entra como material com
--   uma CÓPIA IMUTÁVEL POR RODADA no mesmo balde privado, em
--   `aprovacoes/<rodada>/<ordem>-<nome-seguro>`. O cliente vê exatamente a arte
--   enviada, mesmo que o anexo seja apagado ou trocado depois. Vídeo segue pelo
--   Dropbox (passa dos 5 MB do balde).
--
-- QUEM COPIA: o Worker, ANTES de gravar (a função do banco não fala com o
--   Storage). Por isso o Worker sorteia o id da rodada e o passa a
--   `create_approval_round` — o caminho da cópia contém esse id. Se a cópia
--   falha, nada é gravado; se a gravação falha depois da cópia, o Worker apaga
--   as cópias (`src/server/aprovacao-envio.ts`).
--
-- O QUE MUDA
--   1. `approval_round_items`: o item passa a ser ANEXO (caminho da cópia,
--      tipo, tamanho, anexo de origem) OU LINK DO DROPBOX — exatamente um dos
--      dois (`approval_round_items_one_source`). `dropbox_url` deixa de ser
--      obrigatório. O caminho da cópia só pode morar debaixo da PRÓPRIA rodada
--      (`aprovacoes/<round_id>/…`) — uma linha não aponta objeto alheio. Anexo
--      é sempre imagem (png, jpeg, webp, gif) e cabe no teto do balde (5 MB).
--      `source_attachment_id` é só rastro (anexo apagado: vira nulo; a cópia
--      fica).
--   2. `create_approval_round(task, items, round_id default null)` — parte da
--      versão da F42_4 (`20261007150300_ideworks_f42_4_enviar_e_decidir.sql`);
--      a de 2 argumentos sai (com a de 3 e o padrão nulo, a chamada antiga de 2
--      argumentos continua resolvendo — um Worker antigo segue enviando link).
--      Item de anexo chega como {attachment_id, storage_path}; a função confere
--      que o anexo é DO PRÓPRIO CARD, não é temporário (`expires_at` nulo) e é
--      imagem, e copia nome, tipo e tamanho da linha do anexo (não confia no
--      que o Worker diz). Recusa: IW042 `attachment_invalid`. Item de link
--      continua {dropbox_url, kind, file_name}. Item com os dois ou nenhum:
--      IW042 `item_invalid`.
--   3. `approval_round_public_json` (parte da F42_6) — cada item ganha
--      `attachment` (verdadeiro/falso). O CAMINHO DO BALDE NUNCA SAI.
--   4. `public_approval_item_object(token_hash, round_id, item_id)` — para a
--      rota pública da imagem: resolve token → cliente → rodada visível dele
--      (aberta/aprovada/reprovada) → item de anexo daquela rodada e devolve o
--      caminho e o tipo SÓ ao Worker, que serve os bytes. Nulo em qualquer
--      outro caso (o Worker responde o mesmo 404).
--   5. Limite de pedidos: novo tipo `media` (as imagens), contado à parte da
--      leitura — uma página com 20 artes faria 21 leituras por abertura e
--      estouraria o teto de 60/min com três recargas. `approval_link_rate_hit`
--      parte da versão da F42_6, só muda a lista de tipos.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s.
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261007200000_ideworks_f42_7_anexos_como_material.sql`
-- (recusa enquanto houver item de anexo — ver o aviso lá).

begin;
set local lock_timeout = '5s';

-- --- 1. o item: anexo OU link -----------------------------------------------
alter table ideworks.approval_round_items
  add column if not exists storage_path text,
  add column if not exists content_type text,
  add column if not exists byte_size bigint,
  add column if not exists source_attachment_id uuid
    references ideworks.task_attachments (id) on delete set null;

alter table ideworks.approval_round_items
  alter column dropbox_url drop not null;

alter table ideworks.approval_round_items
  drop constraint if exists approval_round_items_one_source;
alter table ideworks.approval_round_items
  add constraint approval_round_items_one_source
  check ((dropbox_url is null) <> (storage_path is null));

alter table ideworks.approval_round_items
  drop constraint if exists approval_round_items_attachment_shape;
alter table ideworks.approval_round_items
  add constraint approval_round_items_attachment_shape
  check (
    storage_path is null
    or (
      kind = 'image'
      and storage_path like 'aprovacoes/' || round_id::text || '/%'
      and storage_path !~ '(^|/)\.\.(/|$)'
      and content_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
      and byte_size between 1 and 5242880
      and dropbox_path is null and dropbox_file_id is null and dropbox_rev is null
    )
  );

alter table ideworks.approval_round_items
  drop constraint if exists approval_round_items_link_shape;
alter table ideworks.approval_round_items
  add constraint approval_round_items_link_shape
  check (storage_path is not null
         or (content_type is null and byte_size is null and source_attachment_id is null));

alter table ideworks.approval_round_items
  drop constraint if exists approval_round_items_storage_path_unique;
alter table ideworks.approval_round_items
  add constraint approval_round_items_storage_path_unique unique (storage_path);

comment on table ideworks.approval_round_items is
  'F42: o material de uma rodada, na ordem do carrossel. É LINK DO DROPBOX (dropbox_url; '
  'dropbox_file_id/dropbox_rev nulos sem a API — F42_5) OU ANEXO (storage_path: a cópia '
  'imutável da arte em ideworks-anexos/aprovacoes/<rodada>/…, feita pelo Worker no envio — '
  'F42_7). Exatamente um dos dois.';
comment on column ideworks.approval_round_items.storage_path is
  'F42_7: a cópia da arte no balde privado, debaixo da própria rodada. Nunca sai para o '
  'cliente nem para a IA: a rota pública serve os bytes pelo Worker.';
comment on column ideworks.approval_round_items.source_attachment_id is
  'F42_7: o anexo do card de onde a arte foi copiada (rastro). Anexo apagado: nulo; a cópia fica.';

-- --- 2. enviar: aceita anexo ---------------------------------------------------
drop function if exists ideworks.create_approval_round(uuid, jsonb);

create or replace function ideworks.create_approval_round(
  p_task_id  uuid,
  p_items    jsonb,
  p_round_id uuid default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_user       uuid := ideworks.acting_user_id();
  v_task       ideworks.tasks%rowtype;
  v_set        uuid;
  v_awaiting   uuid;
  v_approved   uuid;
  v_rejected   uuid;
  v_version    integer;
  v_round      uuid;
  v_superseded integer;
  v_move       jsonb;
  v_item       jsonb;
  v_pos        bigint;
  v_anexo      ideworks.task_attachments%rowtype;
  v_anexo_id   uuid;
begin
  if v_user is null then
    raise exception 'ninguem declarado: enviar para aprovacao exige uma pessoa da equipe'
      using errcode = '42501';
  end if;

  -- A trava da linha do card serializa dois envios simultâneos: a versão é
  -- `max + 1` e a aberta anterior vira substituída sem corrida.
  select * into v_task from ideworks.tasks t where t.id = p_task_id for update;

  if not found or not ideworks.can_act_on_task_id(p_task_id, 'execute'::ideworks.access_level) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  if v_task.client_id is null then
    raise exception 'Este card nao tem cliente: a aprovacao externa e por cliente.'
      using errcode = 'IW042', hint = 'task_without_client';
  end if;

  if not ideworks.can_see_client(v_task.client_id) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  if not exists (select 1 from ideworks.clients c
                  where c.id = v_task.client_id and c.approval_enabled and c.is_active) then
    raise exception 'A aprovacao externa nao esta ligada para este cliente.'
      using errcode = 'IW042', hint = 'approval_disabled';
  end if;

  if v_task.list_id is not null then
    v_set := ideworks.resolve_status_set(v_task.list_id);
    select a.awaiting_status_id, a.approved_status_id, a.rejected_status_id
      into v_awaiting, v_approved, v_rejected
      from ideworks.approval_targets_for(v_set) a;
  end if;

  if v_awaiting is null or v_approved is null or v_rejected is null then
    raise exception 'A esteira deste card ainda nao tem as tres etapas da aprovacao do cliente (aguardando, aprovado, reprovado). Configure a esteira antes de enviar.'
      using errcode = 'IW042', hint = 'approval_not_configured';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha ao menos um material para enviar.'
      using errcode = 'IW042', hint = 'no_items';
  end if;

  -- Nova rodada com outra aberta: a antiga vira substituída e sai das abertas.
  update ideworks.approval_rounds r
     set state = 'superseded', closed_at = now()
   where r.task_id = p_task_id and r.state = 'open';
  get diagnostics v_superseded = row_count;

  select coalesce(max(r.version), 0) + 1 into v_version
    from ideworks.approval_rounds r where r.task_id = p_task_id;

  -- F42_7: o id pode vir do Worker (o caminho da cópia da arte o contém).
  insert into ideworks.approval_rounds (id, task_id, client_id, version, caption, sent_by)
  values (coalesce(p_round_id, gen_random_uuid()), p_task_id, v_task.client_id, v_version,
          v_task.description, v_user)
  returning id into v_round;

  for v_item, v_pos in
    select e.item, e.pos from jsonb_array_elements(p_items) with ordinality as e(item, pos)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or (v_item ? 'dropbox_url') = (v_item ? 'storage_path') then
      raise exception 'Cada material e um link do Dropbox OU um anexo do card (o %o tem os dois ou nenhum).', v_pos
        using errcode = 'IW042', hint = 'item_invalid';
    end if;

    if v_item ? 'storage_path' then
      -- O ANEXO: do próprio card, permanente, imagem. Nome, tipo e tamanho vêm
      -- da linha do anexo, e não do que o Worker disse.
      begin
        v_anexo_id := (v_item->>'attachment_id')::uuid;
      exception when invalid_text_representation then
        v_anexo_id := null;
      end;
      select * into v_anexo from ideworks.task_attachments a where a.id = v_anexo_id;
      if not found
         or v_anexo.task_id <> p_task_id
         or v_anexo.expires_at is not null
         or v_anexo.content_type not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif') then
        raise exception 'O %o material nao e uma imagem anexada a este card (png, jpg, webp ou gif, que nao seja temporaria).', v_pos
          using errcode = 'IW042', hint = 'attachment_invalid';
      end if;

      insert into ideworks.approval_round_items
        (round_id, position, storage_path, kind, file_name, content_type, byte_size, source_attachment_id)
      values (v_round, v_pos::integer, v_item->>'storage_path', 'image',
              v_anexo.file_name, v_anexo.content_type, v_anexo.byte_size, v_anexo.id);
    else
      insert into ideworks.approval_round_items
        (round_id, position, dropbox_url, dropbox_path, kind, file_name, dropbox_file_id, dropbox_rev)
      values (v_round, v_pos::integer,
              v_item->>'dropbox_url', nullif(v_item->>'dropbox_path', ''),
              (v_item->>'kind')::ideworks.approval_item_kind,
              v_item->>'file_name', v_item->>'dropbox_file_id', v_item->>'dropbox_rev');
    end if;
  end loop;

  -- O card vai para "aguardando cliente" pela porta única (`move_task`). Quem
  -- empurrou foi a pessoa que enviou: o evento sai À MÃO, com ela de autora.
  -- `move_task` confere de novo o alcance dela à lista.
  v_move := ideworks.move_task(p_task_id, v_task.list_id, v_awaiting);

  return jsonb_build_object(
    'round_id',   v_round,
    'version',    v_version,
    'superseded', v_superseded,
    'task_move',  v_move);
end;
$fn$;

comment on function ideworks.create_approval_round(uuid, jsonb, uuid) is
  'F42: envia o card para aprovação do cliente — confere alcance, cliente ligado e '
  'destinos da esteira; marca a aberta anterior como substituída; grava a rodada '
  '(versão max+1, legenda copiada da descrição; id opcional vindo do Worker — F42_7) com '
  'os itens na ordem do array: link do Dropbox {dropbox_url, kind, file_name} ou anexo '
  '{attachment_id, storage_path} (anexo do próprio card, permanente, imagem); e move o '
  'card para "aguardando cliente" por move_task. Tudo ou nada.';

revoke all on function ideworks.create_approval_round(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function ideworks.create_approval_round(uuid, jsonb, uuid) to ideworks_app;

-- --- 3. a chamada como o cliente a vê: o item diz se é anexo --------------------
create or replace function ideworks.approval_round_public_json(p_round_id uuid)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  select jsonb_build_object(
           'id',         r.id,
           'task_title', t.title,
           'version',    r.version,
           'sent_at',    r.sent_at,
           'caption',    r.caption,
           'state',      r.state,
           'decided_at', r.decided_at,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id',         i.id,
                      'position',   i.position,
                      'url',        i.dropbox_url,
                      'kind',       i.kind,
                      'file_name',  i.file_name,
                      -- F42_7: o caminho do balde NUNCA sai; só o sinal.
                      'attachment', i.storage_path is not null) order by i.position)
               from ideworks.approval_round_items i
              where i.round_id = r.id), '[]'::jsonb),
           -- SÓ o que o cliente escreveu. A conversa interna do card nunca.
           'comments', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id',         c.id,
                      'body',       c.body,
                      'created_at', c.created_at,
                      'item_id',    c.approval_item_id) order by c.created_at, c.id)
               from ideworks.task_comments c
              where c.approval_round_id = r.id
                and c.from_client), '[]'::jsonb))
    from ideworks.approval_rounds r
    join ideworks.tasks t on t.id = r.task_id
   where r.id = p_round_id
$fn$;

comment on function ideworks.approval_round_public_json(uuid) is
  'F42_6/F42_7: a chamada como o CLIENTE a vê — rodada, título do card, legenda copiada, '
  'itens na ordem (com o sinal "attachment", nunca o caminho do balde) e comentários do '
  'cliente. Nada interno. Não é executável pelo app: só as funções públicas por token a chamam.';

revoke all on function ideworks.approval_round_public_json(uuid) from public, anon, authenticated, ideworks_app;

-- --- 4. a imagem de um item, para o Worker servir -------------------------------
create or replace function ideworks.public_approval_item_object(
  p_token_hash text,
  p_round_id   uuid,
  p_item_id    uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_client uuid;
  v_path   text;
  v_type   text;
begin
  v_client := ideworks.resolve_approval_link(p_token_hash);
  if v_client is null or p_round_id is null or p_item_id is null then
    return null;
  end if;

  select i.storage_path, i.content_type into v_path, v_type
    from ideworks.approval_round_items i
    join ideworks.approval_rounds r on r.id = i.round_id
   where i.id = p_item_id
     and r.id = p_round_id
     and r.client_id = v_client
     and r.state in ('open', 'approved', 'rejected')
     and i.storage_path is not null;

  if v_path is null then
    return null;
  end if;

  return jsonb_build_object('storage_path', v_path, 'content_type', v_type);
end;
$fn$;

comment on function ideworks.public_approval_item_object(text, uuid, uuid) is
  'F42_7: para a rota pública da imagem — pelo hash do token, o caminho e o tipo da cópia '
  'da arte de um item de ANEXO de uma chamada visível do cliente do link. Nulo em qualquer '
  'outro caso. O caminho fica no Worker: o cliente recebe só os bytes.';

revoke all on function ideworks.public_approval_item_object(text, uuid, uuid) from public, anon, authenticated;
grant execute on function ideworks.public_approval_item_object(text, uuid, uuid) to ideworks_app;

-- --- 5. o limite: as imagens contam à parte -------------------------------------
alter table ideworks.approval_link_rate_events
  drop constraint if exists approval_link_rate_events_kind_sane;
alter table ideworks.approval_link_rate_events
  add constraint approval_link_rate_events_kind_sane check (kind in ('read', 'write', 'media'));

create or replace function ideworks.approval_link_rate_hit(
  p_kind           text,
  p_token_key      text,
  p_ip_key         text,
  p_max_token      integer,
  p_max_ip         integer,
  p_window_seconds integer)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_since  timestamptz;
  v_n      integer;
  v_oldest timestamptz;
  v_scope  text;
  v_key    text;
  v_max    integer;
begin
  if p_kind is null or p_kind not in ('read', 'write', 'media') then
    raise exception 'tipo de pedido invalido' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 3600
     or p_max_token is null or p_max_token not between 1 and 10000
     or p_max_ip is null or p_max_ip not between 1 and 10000 then
    raise exception 'teto de pedidos fora da faixa' using errcode = '22023';
  end if;
  if p_token_key is null or char_length(p_token_key) not between 1 and 128
     or p_ip_key is null or char_length(p_ip_key) not between 1 and 128 then
    raise exception 'chave de limite invalida' using errcode = '22023';
  end if;

  v_since := now() - make_interval(secs => p_window_seconds);

  foreach v_scope in array array['token', 'ip'] loop
    v_key := case v_scope when 'token' then p_token_key else p_ip_key end;
    v_max := case v_scope when 'token' then p_max_token else p_max_ip end;

    select count(*)::int, min(e.occurred_at) into v_n, v_oldest
      from ideworks.approval_link_rate_events e
     where e.scope = v_scope and e.kind = p_kind and e.scope_key = v_key
       and e.occurred_at >= v_since;

    if v_n >= v_max then
      -- Barrado não conta: esperar o mais antigo sair da janela basta.
      return jsonb_build_object(
        'allowed', false,
        'blocked_by', v_scope,
        'retry_after', greatest(1, ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - now())))::int));
    end if;
  end loop;

  insert into ideworks.approval_link_rate_events (scope, kind, scope_key)
  values ('token', p_kind, p_token_key), ('ip', p_kind, p_ip_key);

  -- A faxina: de vez em quando, o que passou de um dia sai.
  if random() < 0.02 then
    delete from ideworks.approval_link_rate_events where occurred_at < now() - interval '1 day';
  end if;

  return jsonb_build_object('allowed', true);
end;
$fn$;

comment on function ideworks.approval_link_rate_hit(text, text, text, integer, integer, integer) is
  'F42_6/F42_7: o limite da rota pública da aprovação. Conta os pedidos do tipo '
  '(read/write/media) por token e por IP na janela; se os dois couberem, registra e libera; '
  'senão devolve quem barrou e quantos segundos esperar. Barrado não é registrado.';

revoke all on function ideworks.approval_link_rate_hit(text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function ideworks.approval_link_rate_hit(text, text, text, integer, integer, integer) to ideworks_app;

commit;
