-- =============================================================================
-- IDE WORKS — F17.2  As esteiras: conjunto de status, status e herança
-- =============================================================================
-- O QUE ESTA ETAPA ENTREGA
--   Um conjunto de status existe, pode ser declarado no espaço, na pasta ou na
--   lista, e a lista resolve a esteira dela pela mesma regra de herança do
--   ClickUp: lista → pasta → espaço, o primeiro que tiver conjunto próprio
--   ganha.
--
-- OS CINCO TIPOS SÃO DO CLICKUP, E SÃO O QUE FAZ O QUADRO SABER ONDE É O FIM
--   `open`, `unstarted`, `custom`, `done`, `closed` — os nomes vêm da API, sem
--   tradução. A tela diz "a fazer", "em andamento", "concluído"; o banco diz o
--   que o ClickUp diz (decisão D5: schema em inglês, interface em português).
--
--   Sem o tipo, um quadro não teria como saber qual coluna é o fim: os nomes
--   reais da casa não ajudam nada — `demanda concluída`, `complete`,
--   `concluído`, `Closed` e `ativo (acompanhamento)` convivem, e nenhum padrão
--   de texto separa os que fecham dos que não fecham.
--
-- OS TRÊS NÍVEIS DE POSSE, MEDIDOS EM USO (2026-08-24)
--   espaço — o padrão do ALMA 9 (`to do` · `in progress` · `complete`), herdado
--            por `Casa Fiore` e `Enxovais Lar Doce [Demandas]`, que não têm
--            esteira própria
--   pasta  — a pasta ESTÚDIO da AGÊNCIA IDE (`pendente` · `aguardando
--            informações` · `editar fotos` · `editar videos` · `enviar fotos ao
--            cliente` · `enviar vídeos ao cliente` · `complete`)
--   lista  — a maioria esmagadora
--
--   Os três existem de verdade, então os três precisam existir aqui. Qualquer
--   simplificação — "esteira só na lista", "esteira só no espaço" — obrigaria
--   uma das duas agências a mudar de método, que é justamente o que a decisão
--   do usuário proíbe.
--
-- EXATAMENTE UM DONO, E ISSO É UMA RESTRIÇÃO, NÃO UM COMBINADO
--   Um conjunto com dois donos não tem resposta para "de quem é esta esteira?",
--   e um conjunto sem dono nenhum é órfão que a herança nunca alcança. Os dois
--   casos são recusados pelo banco — `num_nonnulls(...) = 1` — e não pela
--   disciplina de quem escreve. Dívida 8.1 do legado é exatamente a versão
--   confiada ao chamador.
--
-- A MESMA ESTEIRA COPIADA EM DEZENAS DE LISTAS É O COMPORTAMENTO CERTO
--   Medido: 11 esteiras distintas espalhadas por ~95 listas, com as mesmas
--   esteiras COPIADAS lista a lista. `Delicato (artes)`, `MIMI (artes)` e
--   `Raiz-[Conteúdos]` têm status idênticos em nome, ordem e cor — e ids
--   diferentes.
--
--   A tentação é deduplicar: guardar uma esteira só e apontar as três listas
--   para ela. Isso MUDARIA O COMPORTAMENTO no primeiro dia em que alguém
--   renomeasse um status em uma lista só — no ClickUp muda uma, aqui mudaria
--   três. Por isso não há nenhuma unicidade por nome entre conjuntos: só dentro
--   de cada conjunto, onde dois status com o mesmo nome seriam indistinguíveis.
--
--   Transformar as 11 em templates é decisão futura da equipe, na tela.
--
-- OS ERROS DE DIGITAÇÃO ENTRAM COMO ESTÃO
--   `desing de capa`, `stbby` e `idéias` estão em produção. Nada aqui os
--   corrige: corrigir na importação faria o sistema novo divergir do que a
--   equipe enxerga na tela todo dia. Renomear é decisão da equipe, depois.
--
-- EXATAMENTE UM STATUS QUE FECHA — E POR QUE ISTO É O PRIMEIRO GATILHO DO
-- PROJETO
--   Regra 3 do roteiro: valor desconhecido não cai em `default` silencioso.
--   Uma esteira sem status de fechamento é um quadro sem fim — a tarefa entra e
--   nunca sai, e o "concluído" da F17.3 não teria onde se pendurar.
--
--   A regra tem duas metades, e elas se declaram de formas diferentes:
--
--   · NUNCA MAIS DE UM — índice único parcial `(status_set_id) where type =
--     'closed'`. Declarativo, sem uma linha de código rodando. É a forma que
--     este projeto prefere, e sempre que ela couber é ela que se usa.
--
--   · NUNCA MENOS DE UM — não há restrição declarativa possível. A regra
--     atravessa DUAS tabelas e só pode ser julgada quando a transação inteira
--     termina: no instante em que o conjunto nasce ele legitimamente ainda não
--     tem status nenhum. Um `check` olharia cedo demais e recusaria o caminho
--     normal.
--
--     Daí o gatilho de restrição `deferrable initially deferred`, o primeiro do
--     projeto. Ele não substitui restrição nenhuma — ocupa exatamente o buraco
--     que restrição não alcança, e nada além disso.
--
--     Quem escreve pela função `create_status_set` nem chega lá: ela confere
--     antes de gravar e recusa com mensagem que diz o que fazer. O gatilho é
--     para quem escrever por fora — porque a garantia tem que ser do banco.
--
-- ESCRITA DE DOMÍNIO É TRANSACIONAL (REGRA 9)
--   `create_status_set` grava o conjunto E os status em bloco. A alternativa —
--   quem chama insere o conjunto, depois cada status — deixa uma esteira pela
--   metade no ar se a segunda chamada falhar, e é o mesmo motivo pelo qual
--   `set_task_assignees` da F4.8 troca a lista inteira de uma vez.
--
--   Ela é `security invoker` de propósito: a autorização é a política de linha,
--   e não uma segunda cópia da regra dentro da função. Uma cópia da regra de
--   acesso é a dívida 8.1 outra vez.
--
-- QUEM ESCREVE O QUÊ — A ESTEIRA SEGUE O DONO
--   Espaço: só administrador. Pasta e lista: quem alcança o espaço.
--
--   É a mesma divisão da F17.1, pelo mesmo motivo, aplicada ao dono do
--   conjunto: a esteira do ESPAÇO é o padrão herdado por toda lista que não tem
--   a própria — mexer nela muda o quadro do espaço inteiro de uma vez, e isso é
--   tão estrutural quanto criar o espaço. Já a esteira de uma pasta ou de uma
--   lista muda só aquela pasta ou aquela lista, que essas pessoas já governam.
--
--   Os status seguem o conjunto deles. Não há política própria para `statuses`:
--   ela seria uma segunda regra de alcance, e a F17.1 já decidiu que a regra de
--   alcance mora num lugar só.
-- =============================================================================

do $$ begin
  create type ideworks.status_type as enum
    ('open', 'unstarted', 'custom', 'done', 'closed');
exception when duplicate_object then null; end $$;

comment on type ideworks.status_type is
  'Os cinco tipos do ClickUp, como vem na API. Sem traducao: a tela traduz, o '
  'banco guarda o que a origem diz. `closed` e o unico que fecha o quadro.';

-- --- o conjunto de status -----------------------------------------------------
create table if not exists ideworks.status_sets (
  id          uuid primary key default gen_random_uuid(),

  -- Exatamente um dos tres. Ver a nota do cabecalho.
  space_id    uuid references ideworks.spaces  (id) on delete cascade,
  folder_id   uuid references ideworks.folders (id) on delete cascade,
  list_id     uuid references ideworks.lists   (id) on delete cascade,

  name        text not null,
  source_id   text,

  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint status_sets_name_not_blank check (btrim(name) <> ''),

  constraint status_sets_one_owner
    check (num_nonnulls(space_id, folder_id, list_id) = 1)
);

-- Um dono, uma esteira. E o que torna a resolucao DETERMINISTICA: com dois
-- conjuntos na mesma lista, "a esteira desta lista" deixaria de ter resposta e
-- viraria "o primeiro que o banco devolver".
create unique index if not exists status_sets_space_key
  on ideworks.status_sets (space_id)  where space_id  is not null;
create unique index if not exists status_sets_folder_key
  on ideworks.status_sets (folder_id) where folder_id is not null;
create unique index if not exists status_sets_list_key
  on ideworks.status_sets (list_id)   where list_id   is not null;

create unique index if not exists status_sets_source_key
  on ideworks.status_sets (source_id) where source_id is not null;

comment on table ideworks.status_sets is
  'A esteira do ClickUp. Pertence a exatamente um nivel — espaco, pasta ou '
  'lista — e a lista resolve a dela por lista -> pasta -> espaco. SEM unicidade '
  'por nome entre conjuntos: a mesma esteira copiada em dezenas de listas e o '
  'comportamento do ClickUp, e deduplicar mudaria o que acontece quando alguem '
  'editar uma lista so.';
comment on constraint status_sets_one_owner on ideworks.status_sets is
  'Exatamente um dono. Dois donos nao respondem "de quem e esta esteira?"; '
  'nenhum dono e orfao que a heranca nunca alcanca.';

-- --- o status -----------------------------------------------------------------
create table if not exists ideworks.statuses (
  id            uuid primary key default gen_random_uuid(),
  status_set_id uuid not null references ideworks.status_sets (id) on delete cascade,

  name          text not null,

  -- `type` e o nome do campo na API do ClickUp. Mantido.
  type          ideworks.status_type not null,

  -- Vem da origem como `#d3d3d3`. E DADO, nao classe de estilo (decisao D10):
  -- a tela recebe como variavel, nunca como cor literal do Tailwind.
  color         text,

  sort_order    integer not null default 0,
  source_id     text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint statuses_name_not_blank check (btrim(name) <> '')
);

-- Dois status com o mesmo nome DENTRO do mesmo conjunto seriam indistinguiveis
-- na tela e na tarefa. Entre conjuntos diferentes, repetir e o esperado.
create unique index if not exists statuses_name_key
  on ideworks.statuses (status_set_id, lower(btrim(name)));

-- A metade declarativa da regra do fechamento: nunca mais de um.
create unique index if not exists statuses_one_closing_key
  on ideworks.statuses (status_set_id)
  where type = 'closed'::ideworks.status_type;

create unique index if not exists statuses_source_key
  on ideworks.statuses (source_id) where source_id is not null;

create index if not exists statuses_set_idx
  on ideworks.statuses (status_set_id, sort_order);

comment on table ideworks.statuses is
  'O status dentro da esteira: nome, ordem, cor e tipo. Erros de digitacao da '
  'origem (`desing de capa`, `stbby`, `ideias` com acento errado) entram como '
  'estao — corrigir aqui faria o sistema novo divergir do que a equipe ve.';
comment on column ideworks.statuses.type is
  'Um dos cinco do ClickUp. E o que faz o quadro saber onde e o fim: os nomes '
  'reais nao separam quem fecha de quem nao fecha.';

-- --- a metade que restricao nao alcanca ---------------------------------------
-- Nunca MENOS de um status que fecha. Ver a nota longa do cabecalho: a regra
-- atravessa duas tabelas e so pode ser julgada no fim da transacao, porque o
-- conjunto legitimamente nasce vazio.
--
-- `security definer` para a contagem ser FACTUAL: sob a politica de quem
-- escreve o numero poderia vir filtrado, e uma contagem filtrada aprovaria uma
-- esteira quebrada.
create or replace function ideworks.status_set_must_close()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_ids    uuid[];
  v_id     uuid;
  v_nome   text;
  v_fecham integer;
begin
  if tg_table_name = 'status_sets' then
    v_ids := array[new.id];
  elsif tg_op = 'DELETE' then
    v_ids := array[old.status_set_id];
  elsif tg_op = 'INSERT' then
    v_ids := array[new.status_set_id];
  else
    -- Mover um status de conjunto deixa DOIS conjuntos para conferir.
    v_ids := array[new.status_set_id, old.status_set_id];
  end if;

  foreach v_id in array v_ids loop
    select ss.name into v_nome from ideworks.status_sets ss where ss.id = v_id;

    -- O conjunto pode ter sido apagado na mesma transacao — cascata dos status
    -- junto. Nao ha esteira para julgar.
    continue when not found;

    select count(*) into v_fecham
      from ideworks.statuses s
     where s.status_set_id = v_id
       and s.type = 'closed'::ideworks.status_type;

    if v_fecham <> 1 then
      raise exception
        'a esteira "%" tem % status que fecha, e precisa de exatamente um (tipo "closed"). Acrescente o status de fechamento antes de fechar a transacao — sem ele o quadro nao sabe onde e o fim.',
        v_nome, v_fecham
        using errcode = '23514';
    end if;
  end loop;

  return null;
end;
$fn$;

comment on function ideworks.status_set_must_close() is
  'O primeiro gatilho do projeto, e so porque restricao nao alcanca: "pelo '
  'menos um status que fecha" atravessa duas tabelas e so pode ser julgado no '
  'fim da transacao. "No maximo um" e indice unico parcial, sem codigo.';

drop trigger if exists status_sets_must_close on ideworks.status_sets;
create constraint trigger status_sets_must_close
  after insert or update on ideworks.status_sets
  deferrable initially deferred
  for each row execute function ideworks.status_set_must_close();

drop trigger if exists statuses_must_close on ideworks.statuses;
create constraint trigger statuses_must_close
  after insert or update or delete on ideworks.statuses
  deferrable initially deferred
  for each row execute function ideworks.status_set_must_close();

-- --- o espaço de um dono qualquer ---------------------------------------------
-- Espaco, pasta e lista sao os mesmos tres niveis de posse que a F17.5 (campos
-- personalizados) e a F17.8 (visualizacoes) vao usar. A traducao dono -> espaco
-- mora aqui, uma vez, em vez de repetida dentro de cada politica.
--
-- `security definer` porque a resposta e um FATO da arvore, e nao uma opiniao
-- sobre quem pergunta: quem decide o alcance e `can_see_space`, logo depois.
create or replace function ideworks.owner_space(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns uuid
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select coalesce(
    p_space_id,
    (select f.space_id from ideworks.folders f where f.id = p_folder_id),
    (select l.space_id from ideworks.lists   l where l.id = p_list_id))
$fn$;

comment on function ideworks.owner_space(uuid, uuid, uuid) is
  'De qual espaco e um dono de tres niveis. A traducao mora num lugar so — a '
  'F17.5 e a F17.8 tem exatamente a mesma forma de posse.';

create or replace function ideworks.can_see_status_set(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_see_space(
           (select ideworks.owner_space(ss.space_id, ss.folder_id, ss.list_id)
              from ideworks.status_sets ss where ss.id = target))
$fn$;

comment on function ideworks.can_see_status_set(uuid) is
  'O alcance da esteira e o alcance do espaco dela — `can_see_space` da F17.1, '
  'nao uma segunda regra. Os status usam esta funcao para nao ter politica '
  'propria.';

-- --- a herança ----------------------------------------------------------------
-- lista -> pasta -> espaco, o primeiro que tiver conjunto proprio ganha. E a
-- regra que o ESTÚDIO (na pasta) e o `Casa Fiore` (no espaco) exercitam todo
-- dia.
--
-- `security invoker`: ela responde com o que QUEM PERGUNTA pode ver. Assim
-- ninguem descobre a esteira de um espaco fora do alcance, e quando ela e
-- chamada de dentro de uma funcao `security definer` — como o guarda de status
-- da F17.3 vai fazer — a resposta volta a ser factual, porque quem invoca ali e
-- o dono.
--
-- Com `folder_id` nulo o segundo `select` nao acha nada, e a heranca pula a
-- pasta sozinha. Lista solta no espaco nao precisa de caso especial.
create or replace function ideworks.resolve_status_set(p_list_id uuid)
  returns uuid
  language sql stable
  set search_path = ideworks, pg_temp
as $fn$
  select coalesce(
    (select ss.id from ideworks.status_sets ss where ss.list_id = p_list_id),
    (select ss.id
       from ideworks.status_sets ss
       join ideworks.lists l on l.folder_id = ss.folder_id
      where l.id = p_list_id),
    (select ss.id
       from ideworks.status_sets ss
       join ideworks.lists l on l.space_id = ss.space_id
      where l.id = p_list_id))
$fn$;

comment on function ideworks.resolve_status_set(uuid) is
  'A esteira desta lista: lista -> pasta -> espaco, o primeiro que tiver '
  'conjunto proprio ganha. Regra do ClickUp, num lugar so.';

-- A esteira resolvida, achatada. Mesmo motivo da view `tree` da F17.1 (regra 1
-- do roteiro): a conta e derivada, entao ela e feita uma vez, num lugar, e nao
-- refeita — talvez errado — por cada consulta.
--
-- `inherited_from` existe porque a tela precisa dizer "herdado da pasta" sem
-- refazer a resolucao para descobrir de onde veio.
drop view if exists ideworks.list_workflow;
create view ideworks.list_workflow
  with (security_invoker = true)
as
select
  l.id            as list_id,
  l.space_id      as space_id,
  l.folder_id     as folder_id,
  ss.id           as status_set_id,
  ss.name         as status_set_name,
  case
    when ss.list_id   is not null then 'list'
    when ss.folder_id is not null then 'folder'
    else 'space'
  end             as inherited_from,
  s.id            as status_id,
  s.name          as status_name,
  s.type          as status_type,
  s.color         as status_color,
  s.sort_order    as status_sort_order
from ideworks.lists l
join ideworks.status_sets ss on ss.id = ideworks.resolve_status_set(l.id)
join ideworks.statuses    s  on s.status_set_id = ss.id;

comment on view ideworks.list_workflow is
  'A esteira ja resolvida por lista, com de onde ela veio. `security_invoker` '
  'para respeitar a politica de quem consulta — sem isso seria um buraco de RLS '
  'com cara de comodidade.';

-- --- gravar a esteira em bloco (regra 9) --------------------------------------
-- O conjunto e os status saem juntos ou nao saem. Ver a nota do cabecalho.
--
-- `security invoker`: a autorizacao e a politica de linha, e nao uma copia da
-- regra aqui dentro.
create or replace function ideworks.create_status_set(
  p_name       text,
  p_statuses   jsonb,
  p_space_id   uuid default null,
  p_folder_id  uuid default null,
  p_list_id    uuid default null,
  p_source_id  text default null,
  p_created_by uuid default null)
  returns uuid
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_set_id  uuid;
  v_item    jsonb;
  v_tipo    text;
  v_ordem   integer := 0;
  v_fecham  integer := 0;
  v_donos   integer := num_nonnulls(p_space_id, p_folder_id, p_list_id);
  c_tipos   constant text[] := array['open', 'unstarted', 'custom', 'done', 'closed'];
begin
  if v_donos <> 1 then
    raise exception
      'a esteira "%" precisa de exatamente um dono — espaco, pasta OU lista — e recebeu %. Escolha um nivel: a lista ganha da pasta, que ganha do espaco.',
      p_name, v_donos
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_statuses) is distinct from 'array'
     or jsonb_array_length(p_statuses) = 0 then
    raise exception
      'a esteira "%" precisa da lista de status, no formato [{"name": ..., "type": ..., "color": ...}]. Recebi %.',
      p_name, coalesce(jsonb_typeof(p_statuses), 'nada')
      using errcode = '22023';
  end if;

  -- Confere TUDO antes de gravar QUALQUER coisa. Recusar no meio deixaria uma
  -- esteira pela metade para quem nao usa transacao.
  for v_item in select * from jsonb_array_elements(p_statuses) loop
    v_tipo := v_item ->> 'type';

    -- Regra 3 do roteiro: valor desconhecido nao cai em `default` silencioso.
    -- Este e o ponto por onde a importacao da F17.11 vai despejar texto cru da
    -- API do ClickUp, e um tipo escrito errado que virasse `custom` calado
    -- produziria uma esteira sem fim que ninguem veria ate o quadro nao fechar.
    if v_tipo is null or not (v_tipo = any (c_tipos)) then
      raise exception
        'o status "%" da esteira "%" veio com tipo %, e o ClickUp so tem cinco: open, unstarted, custom, done, closed. Corrija o tipo na origem — nada foi gravado.',
        coalesce(nullif(btrim(v_item ->> 'name'), ''), '(sem nome)'),
        p_name,
        coalesce(quote_literal(v_tipo), 'nenhum')
        using errcode = '22023';
    end if;

    if v_tipo = 'closed' then v_fecham := v_fecham + 1; end if;
  end loop;

  if v_fecham <> 1 then
    raise exception
      'a esteira "%" tem % status que fecha, e precisa de exatamente um (tipo "closed"). E ele que faz o quadro saber onde e o fim — sem ele a tarefa entra e nunca sai.',
      p_name, v_fecham
      using errcode = '23514';
  end if;

  insert into ideworks.status_sets (space_id, folder_id, list_id, name, source_id, created_by)
  values (p_space_id, p_folder_id, p_list_id, p_name, p_source_id, p_created_by)
  returning id into v_set_id;

  -- `sort_order` cai na posicao do vetor quando a origem nao manda: a ordem em
  -- que os status chegam JA E a ordem da esteira, e inventar zero para todos
  -- perderia essa informacao.
  for v_item in select * from jsonb_array_elements(p_statuses) loop
    insert into ideworks.statuses (status_set_id, name, type, color, sort_order, source_id)
    values (
      v_set_id,
      v_item ->> 'name',
      (v_item ->> 'type')::ideworks.status_type,
      v_item ->> 'color',
      coalesce((v_item ->> 'sort_order')::integer, v_ordem),
      v_item ->> 'source_id');
    v_ordem := v_ordem + 1;
  end loop;

  return v_set_id;
end;
$fn$;

comment on function ideworks.create_status_set(text, jsonb, uuid, uuid, uuid, text, uuid) is
  'Grava a esteira inteira em bloco — regra 9 do roteiro. Recusa dono ambiguo, '
  'tipo fora dos cinco do ClickUp e esteira sem status de fechamento, sempre '
  'antes de gravar e sempre com mensagem que diz o que fazer.';

-- --- segurança por linha ------------------------------------------------------
alter table ideworks.status_sets enable row level security;
alter table ideworks.statuses    enable row level security;

-- Ler: quem alcanca o espaco do dono.
create policy status_sets_select on ideworks.status_sets for select
  using (ideworks.can_see_space(ideworks.owner_space(space_id, folder_id, list_id)));

-- Escrever: a esteira segue o dono. A do espaco e o padrao herdado por toda
-- lista sem esteira propria — mexer nela muda o quadro do espaco inteiro de uma
-- vez, e isso e tao estrutural quanto criar o espaco (mesmo criterio da F17.1).
create policy status_sets_write on ideworks.status_sets for all
  using (
    case when space_id is not null
         then ideworks.acting_is_superadmin()
         else ideworks.can_see_space(ideworks.owner_space(space_id, folder_id, list_id))
    end)
  with check (
    case when space_id is not null
         then ideworks.acting_is_superadmin()
         else ideworks.can_see_space(ideworks.owner_space(space_id, folder_id, list_id))
    end);

-- O status nao tem politica propria: ele herda a do conjunto. Uma politica
-- propria seria uma segunda regra de alcance, e a F17.1 ja decidiu que a regra
-- de alcance mora num lugar so.
create policy statuses_select on ideworks.statuses for select
  using (ideworks.can_see_status_set(status_set_id));
create policy statuses_write on ideworks.statuses for all
  using (ideworks.can_see_status_set(status_set_id))
  with check (ideworks.can_see_status_set(status_set_id));

-- --- permissões ---------------------------------------------------------------
grant all privileges on all tables in schema ideworks to ideworks_app;
grant select on ideworks.list_workflow to ideworks_app;
grant execute on function ideworks.owner_space(uuid, uuid, uuid)      to ideworks_app;
grant execute on function ideworks.can_see_status_set(uuid)           to ideworks_app;
grant execute on function ideworks.resolve_status_set(uuid)           to ideworks_app;
grant execute on function
  ideworks.create_status_set(text, jsonb, uuid, uuid, uuid, text, uuid) to ideworks_app;
