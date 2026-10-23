-- =============================================================================
-- IDE WORKS — F3.2  O item de conteudo
-- =============================================================================
-- TRES TABELAS DO LEGADO VIRAM UMA
--
--   weekly_progress        contadores por semana e tipo
--   weekly_content_items   o item, com post_date opcional
--   calendar_posts         o post, com data, hora, plataforma e status
--
--   Sao a mesma coisa vista tres vezes: um conteudo, de um cliente, de um tipo,
--   num mes, opcionalmente numa data, feito ou nao. 29 dos 30 clientes que usam
--   o calendario tambem usam a grade — os mesmos conteudos, cadastrados duas
--   vezes.
--
--   Aqui existe UMA tabela. A grade de producao, o calendario e o medidor de
--   entrega sao tres LEITURAS dela.
--
-- NAO EXISTE TABELA DE CONTADORES, E ISSO E O PONTO
--   A divida 8.1 do legado: `weekly_progress` guarda contagens que deveriam
--   bater com `weekly_content_items` e nao batem — 88 divergencias em alvo, 13
--   em extra, 153 linhas orfas. A prova de que deveriam bater e que a API tem
--   CINCO acoes so para consertar isso.
--
--   Contagem aqui e consulta. Nao ha o que divergir.
--
-- POR QUE NAO HA ENUM DE ESTADO
--   O legado tem um campo de status no calendario com tres valores no codigo e
--   **um so em uso** — 490 posts, todos "Programado". Inventar um fluxo de
--   estados que nunca rodou seria modelar uma suposicao.
--
--   O que a operacao realmente distingue sao duas coisas independentes:
--     tem data?   -> agendado ou apenas planejado
--     foi feito?  -> concluido ou pendente
--
--   Duas datas anulaveis dizem isso sem inventar nada, e permitem as quatro
--   combinacoes reais. Quando a equipe descrever um fluxo de verdade, ele entra
--   como migration — com o comportamento conhecido, nao presumido.
--
-- A SEMANA SOME
--   Vira consulta sobre datas. O legado guarda `week_number` 1 a 5 e a semana 5
--   NUNCA foi usada em 3.534 registros. Coluna que nao existe nao diverge.
-- =============================================================================

do $$ begin
  create type ideworks.platform as enum
    ('instagram', 'facebook', 'tiktok', 'shopee', 'mercado_livre');
exception when duplicate_object then null; end $$;

comment on type ideworks.platform is
  'As cinco que a interface do legado oferece. Em toda a base, porem, so '
  '`Instagram` aparece — nem no calendario nem no cadastro de clientes ha outra. '
  'Acrescentar plataforma e migration, de proposito: e decisao, nao digitacao.';

-- --- o item -------------------------------------------------------------------
create table if not exists ideworks.content_items (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references ideworks.clients (id) on delete cascade,

  -- Mes de competencia: e por ele que o contrato cobra. SEMPRE presente.
  reference_month date not null,

  content_type    ideworks.content_type not null,
  platform        ideworks.platform,

  -- Quando vai ao ar. OPCIONAL: 7.082 dos 9.677 itens do legado (73%) nao tem
  -- data. Nao e falha de preenchimento — e a diferenca entre PLANEJAR e AGENDAR.
  scheduled_at    timestamptz,

  -- Quando foi feito. OPCIONAL pelo mesmo motivo: pendente e um estado legitimo.
  completed_at    timestamptz,
  completed_by    uuid references auth.users (id) on delete set null,

  -- Alem do contratado. Entra no bonus, nunca na base.
  is_extra        boolean not null default false,

  title           text,
  description     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint content_items_month_first_day
    check (reference_month = date_trunc('month', reference_month)::date),

  -- Quem concluiu so existe se houve conclusao, e vice-versa. Deixar os dois
  -- soltos permite "concluido por ninguem" e "ninguem concluiu, mas tem autor".
  constraint content_items_completion_coherent
    check ((completed_at is null and completed_by is null)
        or (completed_at is not null))
);

create index if not exists content_items_client_month_idx
  on ideworks.content_items (client_id, reference_month);

-- O calendario e uma consulta por intervalo de data. Sem este indice ela varre
-- a tabela inteira a cada troca de periodo.
create index if not exists content_items_scheduled_idx
  on ideworks.content_items (scheduled_at) where scheduled_at is not null;

create index if not exists content_items_pending_idx
  on ideworks.content_items (client_id, reference_month) where completed_at is null;

comment on table ideworks.content_items is
  'UM registro de conteudo. A grade de producao, o calendario e o medidor de '
  'entrega sao tres LEITURAS desta tabela. Nao ha tabela de contadores: contagem '
  'e consulta, e por isso nao ha o que divergir.';
comment on column ideworks.content_items.scheduled_at is
  'Nulo = planejado, ainda sem data. No legado, 73% dos itens estao assim.';
comment on column ideworks.content_items.completed_at is
  'Nulo = pendente. Nao ha enum de estado: o legado tem um com tres valores no '
  'codigo e UM em uso, e inventar fluxo que nunca rodou seria modelar suposicao.';

-- --- a acao de concluir -------------------------------------------------------
-- Idempotente: marcar duas vezes tem o mesmo efeito que uma. Duas pessoas na
-- mesma tela nao produzem estados diferentes.
create or replace function ideworks.complete_item(
  p_item_id uuid,
  p_by      uuid
) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  update ideworks.content_items
     set completed_at = coalesce(completed_at, now()),
         completed_by = coalesce(completed_by, p_by),
         updated_at   = now()
   where id = p_item_id
     and ideworks.can_see_client(client_id);

  if not found then
    raise exception 'item nao encontrado ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

comment on function ideworks.complete_item(uuid, uuid) is
  'Marca concluido. IDEMPOTENTE: `coalesce` preserva o primeiro instante e o '
  'primeiro autor, entao marcar de novo nao reescreve quem fez nem quando.';

create or replace function ideworks.uncomplete_item(p_item_id uuid) returns void
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  update ideworks.content_items
     set completed_at = null, completed_by = null, updated_at = now()
   where id = p_item_id and ideworks.can_see_client(client_id);

  if not found then
    raise exception 'item nao encontrado ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.content_items enable row level security;

-- Quem enxerga o cliente enxerga e mexe nos itens dele. Marcar producao e o
-- trabalho diario de quem cuida da carteira — exigir administrador aqui
-- paralisaria a operacao.
create policy content_items_select on ideworks.content_items for select
  using (ideworks.can_see_client(client_id));
create policy content_items_insert on ideworks.content_items for insert
  with check (ideworks.can_see_client(client_id));
create policy content_items_update on ideworks.content_items for update
  using (ideworks.can_see_client(client_id))
  with check (ideworks.can_see_client(client_id));
create policy content_items_delete on ideworks.content_items for delete
  using (ideworks.can_see_client(client_id));

grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.complete_item(uuid, uuid) to ideworks_app;
grant execute on function ideworks.uncomplete_item(uuid) to ideworks_app;
