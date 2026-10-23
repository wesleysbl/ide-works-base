-- F42, Fase 5 — o que o CLIENTE lê e escreve pelo link, e o limite de pedidos.
--
-- POR QUE FUNÇÕES, E NÃO SELECT
--   O cliente não tem conta: a rota pública roda com o ator `preauth`, que não
--   lê `clients`, `tasks`, `approval_rounds` nem `task_comments` (a segurança
--   por linha é de quem alcança). Abrir política para `preauth` abriria as
--   tabelas inteiras para quem não tem pessoa. Em vez disso, funções `security
--   definer` que recebem o HASH do token (a credencial), resolvem o cliente por
--   `resolve_approval_link` (vivo + ligado + ativo, F42_1) e devolvem SÓ o
--   permitido. É o molde de `decide_approval_round` (F42_4).
--
-- O QUE MUDA
--   1. `approval_round_public_json(round_id)` — a forma ÚNICA de uma chamada
--      para o cliente: id da rodada, título do card, versão, enviada em,
--      legenda copiada, estado, decidida em; itens na ordem (id, posição, link,
--      tipo, nome); comentários DO CLIENTE (`from_client`) daquela rodada (id,
--      texto, quando, item). NUNCA: comentário interno, quem enviou, autor,
--      id de pessoa, id do card, lista, etapa. Interna: nem o app a executa
--      (receberia qualquer id de rodada); só as três abaixo a chamam.
--   2. `public_approval_page(token_hash)` — nome de exibição do cliente e as
--      chamadas dele em estado aberta/aprovada/reprovada (substituída,
--      cancelada e travada ficam de fora), abertas primeiro (mais recente
--      primeiro), depois as fechadas (decidida mais recente primeiro); teto de
--      100. Link inválido: nulo.
--   3. `public_approval_round(token_hash, round_id)` — uma chamada; nulo se o
--      link não vale, se a rodada é de outro cliente ou não está visível. O
--      Worker responde o MESMO 404 nos dois casos.
--   4. `comment_approval_round(token_hash, round_id, item_id, body)` — o
--      cliente comenta SEM decidir. A rodada precisa estar ABERTA (trava
--      `for share`: espera uma decisão em curso, que trava `for update`, e vê
--      o estado final); o item, se vier, precisa ser DESTA rodada (o gatilho
--      `task_comments_approval_coherent` repete a conferência). Texto com
--      sentido (`is_meaningful_name`, a mesma regra do corpo do comentário) e
--      até 2000 caracteres. O comentário entra no card com `from_client`, sem
--      autor — e, por isso, fora das menções (gatilho da F42_3).
--      Recusas `IW042`: link_invalid, round_not_found, item_not_found,
--      round_not_open (detail com estado e datas), comment_required,
--      comment_too_long.
--   5. `approval_link_rate_events` + `approval_link_rate_hit(...)` — o LIMITE DE
--      PEDIDOS da rota pública, por token e por IP, em janela deslizante. Mora
--      no BANCO pelo mesmo motivo de `auth_attempts` (F1.4) e de
--      `integration_rate_events` (F16.2b): contador na memória do isolado não
--      atravessa as várias cópias do Worker — seria a aparência de uma trava.
--      Uma ida só: conta os dois escopos e, se os dois couberem, registra os
--      dois. Pedido barrado NÃO é registrado (a espera não se estende sozinha).
--      Os tetos vêm do Worker (`src/server/aprovacao-publica.ts`), conferidos
--      aqui dentro de faixas sãs. A tabela se limpa sozinha: o que passou de
--      um dia sai (de vez em quando, sorteado, para não pesar cada pedido).
--      Sem política: só a função escreve e lê.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s (não toca tabela quente:
-- só cria funções e uma tabela nova).
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261007170000_ideworks_f42_6_leitura_publica.sql`.

begin;
set local lock_timeout = '5s';

-- --- 1. a chamada como o cliente a vê ------------------------------------------
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

comment on function ideworks.approval_round_public_json(uuid) is
  'F42_6: a chamada como o CLIENTE a vê — rodada, título do card, legenda copiada, '
  'itens na ordem e comentários do cliente. Nada interno. Não é executável pelo app: '
  'só as funções públicas por token a chamam.';

revoke all on function ideworks.approval_round_public_json(uuid) from public, anon, authenticated, ideworks_app;

-- --- 2. a página do link ------------------------------------------------------
create or replace function ideworks.public_approval_page(p_token_hash text)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_client uuid;
begin
  v_client := ideworks.resolve_approval_link(p_token_hash);
  if v_client is null then
    return null;
  end if;

  return jsonb_build_object(
    'client_name', (select c.name from ideworks.clients c where c.id = v_client),
    'rounds', coalesce((
      select jsonb_agg(ideworks.approval_round_public_json(v.id) order by v.ordem)
        from (select r.id,
                     row_number() over (
                       order by (r.state = 'open') desc,
                                coalesce(r.decided_at, r.sent_at) desc,
                                r.version desc, r.id) as ordem
                from ideworks.approval_rounds r
               where r.client_id = v_client
                 and r.state in ('open', 'approved', 'rejected')
               order by ordem
               limit 100) v), '[]'::jsonb));
end;
$fn$;

comment on function ideworks.public_approval_page(text) is
  'F42_6: pelo hash do token, o nome do cliente e as chamadas dele (aberta, aprovada, '
  'reprovada), abertas primeiro; teto de 100. Link inválido (revogado, desligado, '
  'inativo, inexistente): nulo.';

revoke all on function ideworks.public_approval_page(text) from public, anon, authenticated;
grant execute on function ideworks.public_approval_page(text) to ideworks_app;

-- --- 3. uma chamada ------------------------------------------------------------
create or replace function ideworks.public_approval_round(p_token_hash text, p_round_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_client uuid;
begin
  v_client := ideworks.resolve_approval_link(p_token_hash);
  if v_client is null or p_round_id is null then
    return null;
  end if;

  if not exists (select 1 from ideworks.approval_rounds r
                  where r.id = p_round_id
                    and r.client_id = v_client
                    and r.state in ('open', 'approved', 'rejected')) then
    return null;
  end if;

  return ideworks.approval_round_public_json(p_round_id);
end;
$fn$;

comment on function ideworks.public_approval_round(text, uuid) is
  'F42_6: uma chamada do cliente do link. Nulo se o link não vale, se a rodada é de '
  'outro cliente ou não está visível (substituída, cancelada, travada).';

revoke all on function ideworks.public_approval_round(text, uuid) from public, anon, authenticated;
grant execute on function ideworks.public_approval_round(text, uuid) to ideworks_app;

-- --- 4. comentar sem decidir --------------------------------------------------
create or replace function ideworks.comment_approval_round(
  p_token_hash text,
  p_round_id   uuid,
  p_item_id    uuid,
  p_body       text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_client uuid;
  v_round  ideworks.approval_rounds%rowtype;
  v_id     uuid;
  v_at     timestamptz;
begin
  v_client := ideworks.resolve_approval_link(p_token_hash);
  if v_client is null then
    raise exception 'link de aprovacao invalido' using errcode = 'IW042', hint = 'link_invalid';
  end if;

  -- `for share`: a decisão trava `for update`; o comentário espera ela acabar e
  -- vê o estado final (decidiu primeiro → comentário recusado).
  select * into v_round
    from ideworks.approval_rounds r
   where r.id = p_round_id
     and r.client_id = v_client
     and r.state in ('open', 'approved', 'rejected')
   for share;

  if not found then
    raise exception 'chamada de aprovacao nao encontrada' using errcode = 'IW042', hint = 'round_not_found';
  end if;

  if v_round.state <> 'open' then
    raise exception 'Esta chamada ja foi respondida: so da para ver.'
      using errcode = 'IW042', hint = 'round_not_open',
            detail = jsonb_build_object('state', v_round.state,
                                        'decided_at', v_round.decided_at,
                                        'closed_at', v_round.closed_at)::text;
  end if;

  if p_body is null or not ideworks.is_meaningful_name(p_body) then
    raise exception 'Escreva o comentario.' using errcode = 'IW042', hint = 'comment_required';
  end if;

  if char_length(btrim(p_body)) > 2000 then
    raise exception 'Comentario longo demais: ate 2000 caracteres.'
      using errcode = 'IW042', hint = 'comment_too_long';
  end if;

  if p_item_id is not null
     and not exists (select 1 from ideworks.approval_round_items i
                      where i.id = p_item_id and i.round_id = v_round.id) then
    raise exception 'material nao encontrado nesta chamada' using errcode = 'IW042', hint = 'item_not_found';
  end if;

  insert into ideworks.task_comments
    (task_id, body, author_id, from_client, approval_round_id, approval_item_id)
  values (v_round.task_id, btrim(p_body), null, true, v_round.id, p_item_id)
  returning id, created_at into v_id, v_at;

  return jsonb_build_object('id', v_id, 'body', btrim(p_body), 'created_at', v_at, 'item_id', p_item_id);
end;
$fn$;

comment on function ideworks.comment_approval_round(text, uuid, uuid, text) is
  'F42_6: o cliente comenta uma chamada ABERTA (e, opcionalmente, um item dela) sem '
  'decidir. Comentário do cliente, sem autor. Recusas IW042: link_invalid, '
  'round_not_found, item_not_found, round_not_open, comment_required, comment_too_long.';

revoke all on function ideworks.comment_approval_round(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function ideworks.comment_approval_round(text, uuid, uuid, text) to ideworks_app;

-- --- 5. o limite de pedidos da rota pública -----------------------------------
create table if not exists ideworks.approval_link_rate_events (
  id          bigint generated always as identity primary key,
  scope       text not null,
  kind        text not null,
  scope_key   text not null,
  occurred_at timestamptz not null default now(),

  constraint approval_link_rate_events_scope_sane check (scope in ('token', 'ip')),
  constraint approval_link_rate_events_kind_sane check (kind in ('read', 'write')),
  constraint approval_link_rate_events_key_sane check (char_length(scope_key) between 1 and 128)
);

create index if not exists approval_link_rate_events_window_idx
  on ideworks.approval_link_rate_events (scope, kind, scope_key, occurred_at desc);
create index if not exists approval_link_rate_events_age_idx
  on ideworks.approval_link_rate_events (occurred_at);

comment on table ideworks.approval_link_rate_events is
  'F42_6: contagem dos pedidos à rota pública da aprovação, por token (prefixo do '
  'hash, nunca o token) e por IP. No BANCO porque o Worker tem várias cópias. Só '
  'approval_link_rate_hit lê e escreve; linhas de mais de um dia são varridas.';

alter table ideworks.approval_link_rate_events enable row level security;
-- Sem política, de propósito: só a função.
revoke all on table ideworks.approval_link_rate_events from public, anon, authenticated, ideworks_app;

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

comment on function ideworks.approval_link_rate_hit(text, text, text, integer, integer, integer) is
  'F42_6: o limite da rota pública da aprovação. Conta os pedidos do tipo (read/write) '
  'por token e por IP na janela; se os dois couberem, registra e libera; senão devolve '
  'quem barrou e quantos segundos esperar. Barrado não é registrado.';

revoke all on function ideworks.approval_link_rate_hit(text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function ideworks.approval_link_rate_hit(text, text, text, integer, integer, integer) to ideworks_app;

commit;
