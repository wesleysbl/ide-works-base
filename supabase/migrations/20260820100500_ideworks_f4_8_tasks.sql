-- =============================================================================
-- IDE WORKS — F4.8  A tarefa
-- =============================================================================
-- POR QUE ELA SE CHAMA `tasks`, E NAO `demands`
--   Regra 10 do roteiro mestre: *a tarefa do A' nasce com a forma da tarefa do
--   B, mesmo que o B so venha muito depois — o modelo de tarefa e construido
--   UMA VEZ SO*.
--
--   O Pilar B e a substituicao do ClickUp: quadro, prazos, pessoas,
--   atribuicoes, dependencias. A "demanda" do Sistema IDE ja E uma tarefa —
--   tem titulo, prazo, responsavel e conclusao. Batizar de `demands` agora
--   garantiria duas tabelas de tarefa depois, e a regra 10 existe justamente
--   para impedir isso.
--
--   A interface continua dizendo "Demandas". Decisao D5: schema em ingles,
--   tela em portugues.
--
-- AS QUATRO DIVIDAS DO LEGADO QUE ESTA TABELA ELIMINA
--   Medidas em `public.demands` (21 linhas) e `public.demand_responsibles`
--   (6 linhas) em 2026-08-20:
--
--   1 · CHAVE DUPLA. La existem `client_id text NOT NULL` **e** `client_uuid
--       uuid`. As 21 linhas tem no `client_id` um uuid escrito como texto, e
--       **3 estao com `client_uuid` nulo** — e por isso existe a acao de API
--       `demands__backfill_client_uuid`, que so remenda. Aqui ha uma chave, e
--       ela e `uuid` com referencia de verdade. Regra 4.
--
--   2 · RESPONSAVEL EM DOIS LUGARES. `demands.responsible_user_id` (um) e
--       `demand_responsibles` (varios) coexistem, e **1 demanda usa os dois ao
--       mesmo tempo**. Nao ha como saber qual manda. Aqui ha um caminho so, e
--       ele e o plural — porque o legado ja precisou do plural.
--
--   3 · NOME COPIADO AO LADO DO ID. `user_name`, `completed_by_name`,
--       `created_by_name`. O nome vem do perfil na hora de ler; copia nao se
--       atualiza. (Curiosidade que a medicao trouxe: os 6 responsaveis do
--       legado apontam para alguem que existe em `auth.users` mas NAO em
--       `public.profiles` — o dono do sistema. Aqui a referencia e `auth.users`
--       pelo mesmo motivo, e o nome sai de `ideworks.profiles` quando houver.)
--
--   4 · BOOLEANO SEM QUANDO. `concluido` e `arquivado` sao booleanos soltos, e
--       **2 das 21 estao concluidas sem `completed_at`**. "Concluido desde
--       quando?" nao tem resposta. Aqui os dois estados sao INSTANTES: nulo e
--       "nao", preenchido e "sim, e desde este momento".
--
-- O QUE NAO ENTRA AGORA, E POR QUE
--   Nao ha enum de status. O legado tem so `concluido`, e inventar um fluxo de
--   estados que nunca rodou seria modelar suposicao — o mesmo argumento que
--   deixou o calendario sem enum na F3.2. Quando a equipe descrever um fluxo de
--   verdade, ele entra como migration, com o comportamento conhecido.
--
--   `prazo` deixa de ser obrigatorio. No legado e `NOT NULL`, o que obriga a
--   inventar uma data para tarefa que nao tem prazo — e data inventada vira
--   "atrasado" no painel.
-- =============================================================================

create table if not exists ideworks.tasks (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references ideworks.clients (id) on delete cascade,

  title        text not null,
  description  text,

  -- Opcional de proposito. Ver a nota acima.
  due_on       date,

  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,

  -- Instante, nao booleano: responde "arquivado desde quando?".
  archived_at  timestamptz,

  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint tasks_title_not_blank check (btrim(title) <> ''),

  -- Quem concluiu so existe se houve conclusao. Deixar os dois soltos permite
  -- "concluido por ninguem" e "ninguem concluiu, mas tem autor" — e o legado
  -- tem 2 linhas exatamente assim.
  constraint tasks_completion_coherent
    check ((completed_at is null and completed_by is null) or (completed_at is not null))
);

-- A aba Checklist pede as pendentes do cliente, por prazo. Sem indice parcial
-- ela varre tambem o arquivo, que so cresce.
create index if not exists tasks_client_pending_idx
  on ideworks.tasks (client_id, due_on)
  where completed_at is null and archived_at is null;

create index if not exists tasks_client_idx on ideworks.tasks (client_id, created_at desc);

comment on table ideworks.tasks is
  'A tarefa. Chama-se `tasks` e nao `demands` por causa da regra 10 do roteiro: '
  'o modelo de tarefa e construido uma vez so, e o Pilar B vai reusar este. A '
  'interface diz "Demandas".';
comment on column ideworks.tasks.due_on is
  'Opcional. No legado e NOT NULL, o que obriga a inventar data para tarefa sem '
  'prazo — e data inventada vira "atrasado" no painel.';
comment on column ideworks.tasks.archived_at is
  'Instante, nao booleano. `arquivado boolean` do legado nao responde "desde '
  'quando", e o mesmo vale para `concluido`.';

-- --- quem cuida da tarefa -----------------------------------------------------
-- Um caminho so, e ele e o plural: o legado tem coluna singular E tabela
-- plural, com 1 demanda usando as duas.
create table if not exists ideworks.task_assignees (
  task_id     uuid not null references ideworks.tasks (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index if not exists task_assignees_user_idx on ideworks.task_assignees (user_id);

comment on table ideworks.task_assignees is
  'Responsaveis. SEM copia do nome ao lado do id: o nome sai do perfil na hora '
  'de ler, porque copia nao se atualiza quando a pessoa muda de nome.';

-- --- acoes --------------------------------------------------------------------
-- Concluir e idempotente: `coalesce` preserva o primeiro instante e o primeiro
-- autor, entao marcar de novo nao reescreve quem fez nem quando. Mesmo desenho
-- de `complete_item` na F3.2.
create or replace function ideworks.complete_task(p_task_id uuid, p_by uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks
     set completed_at = coalesce(completed_at, now()),
         completed_by = coalesce(completed_by, p_by),
         updated_at   = now()
   where id = p_task_id and ideworks.can_see_client(client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.uncomplete_task(p_task_id uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks
     set completed_at = null, completed_by = null, updated_at = now()
   where id = p_task_id and ideworks.can_see_client(client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

-- Arquivar e desarquivar. Desarquivar limpa a data — guardar a antiga faria
-- "arquivado desde" mentir na proxima vez.
create or replace function ideworks.set_task_archived(p_task_id uuid, p_archived boolean)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         updated_at  = now()
   where id = p_task_id and ideworks.can_see_client(client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

-- Troca a lista inteira de responsaveis numa transacao. Apagar e reinserir a
-- cargo de quem chama deixaria a tarefa sem responsavel nenhum se a segunda
-- chamada falhasse.
create or replace function ideworks.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id and ideworks.can_see_client(t.client_id)
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.task_assignees where task_id = p_task_id;

  -- `distinct` porque a tela pode mandar repetido, e a chave primaria recusaria
  -- com uma mensagem que ninguem entende.
  insert into ideworks.task_assignees (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;
end;
$fn$;

comment on function ideworks.set_task_assignees(uuid, uuid[]) is
  'Troca a lista inteira. Ignora quem nao tem perfil no IDE Works: atribuir '
  'tarefa a quem nao entra no sistema e atribuir a ninguem.';

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.tasks           enable row level security;
alter table ideworks.task_assignees  enable row level security;

-- Quem enxerga o cliente cuida das tarefas dele. Exigir administrador aqui
-- paralisaria a operacao — e o mesmo criterio de `content_items`.
create policy tasks_select on ideworks.tasks for select
  using (ideworks.can_see_client(client_id));
create policy tasks_insert on ideworks.tasks for insert
  with check (ideworks.can_see_client(client_id));
create policy tasks_update on ideworks.tasks for update
  using (ideworks.can_see_client(client_id))
  with check (ideworks.can_see_client(client_id));
create policy tasks_delete on ideworks.tasks for delete
  using (ideworks.can_see_client(client_id));

create policy task_assignees_select on ideworks.task_assignees for select
  using (exists (select 1 from ideworks.tasks t
                  where t.id = task_id and ideworks.can_see_client(t.client_id)));
create policy task_assignees_write on ideworks.task_assignees for all
  using (exists (select 1 from ideworks.tasks t
                  where t.id = task_id and ideworks.can_see_client(t.client_id)))
  with check (exists (select 1 from ideworks.tasks t
                       where t.id = task_id and ideworks.can_see_client(t.client_id)));

grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.complete_task(uuid, uuid)          to ideworks_app;
grant execute on function ideworks.uncomplete_task(uuid)              to ideworks_app;
grant execute on function ideworks.set_task_archived(uuid, boolean)   to ideworks_app;
grant execute on function ideworks.set_task_assignees(uuid, uuid[])   to ideworks_app;
