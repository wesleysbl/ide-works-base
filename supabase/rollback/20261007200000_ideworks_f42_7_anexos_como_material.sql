-- Desfaz a F42_7: o item da rodada volta a ser só link do Dropbox.
--
-- ⚠️ RECUSA enquanto houver item de ANEXO gravado (rodada que mandou arte do
-- card). O livro não se reescreve: a tabela da F42_5 não sabe guardar esse
-- item, e apagá-lo mentiria sobre o que o cliente viu/aprovou. Conte-os com:
--   select count(*) from ideworks.approval_round_items where storage_path is not null;
-- e decida antes (apagar essas rodadas, ou ficar na F42_7).
--
-- AS CÓPIAS NO BALDE (`ideworks-anexos/aprovacoes/<rodada>/…`) NÃO SÃO
-- APAGADAS POR ESTE ARQUIVO (SQL não fala com o Storage). Se as linhas foram
-- apagadas antes, as cópias ficam órfãs, privadas e inertes; para limpar,
-- apague a pasta `aprovacoes/` pelo painel do Supabase (Storage).
--
-- Reverta a publicação do Worker ANTES (a versão nova chama a função com 3
-- argumentos e a de imagem). Depois: node scripts/conferir-schema.mjs --gravar.

begin;
set local lock_timeout = '5s';

do $do$
declare
  v_n integer;
begin
  select count(*) into v_n from ideworks.approval_round_items where storage_path is not null;
  if v_n > 0 then
    raise exception 'há % item(ns) de rodada que são anexos (artes copiadas); o rollback não os apaga. Resolva esses itens antes.', v_n
      using errcode = '55000';
  end if;
end
$do$;

-- --- o limite volta a ter só leitura e escrita ----------------------------------
delete from ideworks.approval_link_rate_events where kind = 'media';
alter table ideworks.approval_link_rate_events
  drop constraint if exists approval_link_rate_events_kind_sane;
alter table ideworks.approval_link_rate_events
  add constraint approval_link_rate_events_kind_sane check (kind in ('read', 'write'));

-- (da F42_6, sem mudança)
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
  if p_kind is null or p_kind not in ('read', 'write') then
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

-- --- a imagem do item sai ---------------------------------------------------------
drop function if exists ideworks.public_approval_item_object(text, uuid, uuid);

-- --- a chamada pública volta à da F42_6 -----------------------------------------
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
                      'id',        i.id,
                      'position',  i.position,
                      'url',       i.dropbox_url,
                      'kind',      i.kind,
                      'file_name', i.file_name) order by i.position)
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

revoke all on function ideworks.approval_round_public_json(uuid) from public, anon, authenticated, ideworks_app;

-- --- enviar volta à da F42_4 (2 argumentos) --------------------------------------
drop function if exists ideworks.create_approval_round(uuid, jsonb, uuid);

create or replace function ideworks.create_approval_round(p_task_id uuid, p_items jsonb)
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
    raise exception 'Escolha ao menos um material do Dropbox para enviar.'
      using errcode = 'IW042', hint = 'no_items';
  end if;

  -- Nova rodada com outra aberta: a antiga vira substituída e sai das abertas.
  update ideworks.approval_rounds r
     set state = 'superseded', closed_at = now()
   where r.task_id = p_task_id and r.state = 'open';
  get diagnostics v_superseded = row_count;

  select coalesce(max(r.version), 0) + 1 into v_version
    from ideworks.approval_rounds r where r.task_id = p_task_id;

  insert into ideworks.approval_rounds (task_id, client_id, version, caption, sent_by)
  values (p_task_id, v_task.client_id, v_version, v_task.description, v_user)
  returning id into v_round;

  insert into ideworks.approval_round_items
    (round_id, position, dropbox_url, dropbox_path, kind, file_name, dropbox_file_id, dropbox_rev)
  select v_round, e.pos::integer,
         e.item->>'dropbox_url', nullif(e.item->>'dropbox_path', ''),
         (e.item->>'kind')::ideworks.approval_item_kind,
         e.item->>'file_name', e.item->>'dropbox_file_id', e.item->>'dropbox_rev'
    from jsonb_array_elements(p_items) with ordinality as e(item, pos);

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

comment on function ideworks.create_approval_round(uuid, jsonb) is
  'F42: envia o card para aprovação do cliente — confere alcance, cliente ligado e '
  'destinos da esteira; marca a aberta anterior como substituída; grava a rodada '
  '(versão max+1, legenda copiada da descrição) com os itens na ordem do array; e '
  'move o card para "aguardando cliente" por move_task. Tudo ou nada.';

revoke all on function ideworks.create_approval_round(uuid, jsonb) from public, anon, authenticated;
grant execute on function ideworks.create_approval_round(uuid, jsonb) to ideworks_app;

-- --- o item volta a ser só link -------------------------------------------------
alter table ideworks.approval_round_items
  drop constraint if exists approval_round_items_storage_path_unique,
  drop constraint if exists approval_round_items_link_shape,
  drop constraint if exists approval_round_items_attachment_shape,
  drop constraint if exists approval_round_items_one_source;
alter table ideworks.approval_round_items
  drop column if exists source_attachment_id,
  drop column if exists byte_size,
  drop column if exists content_type,
  drop column if exists storage_path;
alter table ideworks.approval_round_items
  alter column dropbox_url set not null;

comment on table ideworks.approval_round_items is
  'F42: o material de uma rodada, na ordem do carrossel. dropbox_file_id e dropbox_rev '
  'provam qual versão de cada arquivo foi enviada QUANDO a API do Dropbox está ligada '
  '(no piloto, só link: ficam nulos — F42_5); dropbox_path é o caminho dentro do link '
  'quando o link é de pasta.';

commit;
