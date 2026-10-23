-- =============================================================================
-- IDE WORKS — F17.1  A arvore: Espaco, Pasta e Lista
-- =============================================================================
-- O PEDIDO, NAS PALAVRAS DO USUARIO (2026-08-24)
--   "Replicar o que usamos — opcoes, menus, selecoes, tags, organizacao,
--   anexar links, arquivos, docs. O sistema ClickUp ja existente de forma
--   identica dentro do IDE Works."
--
--   Eu havia recomendado o oposto: hierarquia fixa Empresa -> Cliente ->
--   Tarefa, com esteira por tipo de entregavel. Ele reafirmou a replica fiel.
--   Decisao dele, e esta migration a executa.
--
-- POR QUE TRES NIVEIS, E NAO DOIS
--   As duas agencias organizam de formas OPOSTAS, e as duas precisam caber:
--
--     AGENCIA IDE   pasta = time      lista = cliente
--                   TIME HELENA > Jatoba, Valentini, CONTFIX... (29 listas)
--
--     ALMA 9        pasta = cliente   lista = tipo de entregavel
--                   FOCUS Ibitinga > (ADS), (Artes), (Videos)
--
--   Qualquer modelo com menos de tres niveis obrigaria uma das duas a mudar de
--   metodo. Medido lendo os dois spaces em 2026-08-24.
--
-- A PASTA E OPCIONAL, E ISSO NAO E DESCUIDO
--   No ClickUp existe lista solta em espaco, e existe aqui: `Casa Fiore` e
--   `Grupo VITTA` tem lista chamada "List" pendurada direto. Tornar a pasta
--   obrigatoria obrigaria a inventar uma pasta para elas — e pasta inventada
--   e ruido que ninguem pediu.
--
--   Mas lista solta NAO pode significar lista sem espaco. Dai o desenho:
--   `space_id` sempre obrigatorio, `folder_id` opcional, e uma chave composta
--   que impede a lista de apontar para pasta de OUTRO espaco. Isso e declarado
--   no banco, nao confiado ao chamador — porque a versao confiada ao chamador
--   e exatamente a divida 8.1 do legado.
--
-- A EMPRESA JA EXISTE, E NAO SE CHAMA `companies`
--   Descoberto ao ler a F14: as "unidades de negocio" do cockpit — Alma9, Ide,
--   Ide Hub — SAO as empresas, e vivem em `client_categories`. `user_categories`
--   diz quais empresas cada pessoa alcanca.
--
--   Entao o espaco pendura em `client_categories`, e o alcance sai de
--   `user_categories`. Criar uma tabela `companies` aqui daria duas verdades
--   sobre a mesma coisa — que e a divida 8.1 outra vez, com nome diferente.
--
-- ARQUIVAR NAO ESCREVE NOS FILHOS
--   Regra 1 do roteiro: uma verdade, um lugar; agregado e calculo derivado,
--   nunca coluna gravada.
--
--   Arquivar um espaco carimbando `archived_at` nas pastas e listas dele
--   pareceria mais simples, e mentiria na primeira vez que alguem
--   desarquivasse: as listas que ja estavam arquivadas ANTES voltariam junto.
--   "Arquivado desde quando" viraria ficcao — o mesmo erro que a F4.8 corrigiu
--   trocando o booleano `arquivado` do legado por um instante.
--
--   Aqui cada nivel guarda o proprio instante, e "esta viva?" e uma leitura
--   sobre a corrente inteira. A view `ideworks.tree` faz essa conta num lugar
--   so.
--
-- QUEM CRIA O QUE
--   Espaco: so administrador. Sao raros e estruturais — dois, hoje.
--   Pasta e lista: qualquer pessoa que alcance o espaco.
--
--   Isso e fidelidade ao ClickUp (membro cria lista, admin cria espaco) e e o
--   mesmo criterio que a F4.8 usou para as tarefas: exigir administrador para
--   o trabalho do dia paralisaria a operacao. Quem disse o pedido foi claro —
--   "os principais responsaveis criam a pasta da empresa" — e responsavel de
--   conta nao e administrador do sistema.
--
-- `source_id`
--   O identificador da coisa no ClickUp. E o que torna a importacao (F17.11)
--   repetivel: rodar de novo atualiza, nunca duplica. Guardado como texto
--   porque os ids do ClickUp sao numeros grandes em forma de texto
--   ("900000000001"), e converter para numero so criaria chance de erro.
-- =============================================================================

-- --- o espaco -----------------------------------------------------------------
create table if not exists ideworks.spaces (
  id          uuid primary key default gen_random_uuid(),

  -- A empresa. `on delete restrict` porque apagar uma unidade de negocio nao
  -- pode levar junto o quadro de trabalho dela sem alguem dizer o que fazer.
  category_id uuid not null references ideworks.client_categories (id) on delete restrict,

  name        text not null,
  color       text,
  sort_order  integer not null default 0,

  -- Instante, nao booleano. Ver a nota acima.
  archived_at timestamptz,

  source_id   text,

  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint spaces_name_not_blank check (btrim(name) <> '')
);

-- Chave composta que a lista vai usar para nao atravessar espacos. Sem ela, a
-- unica alternativa seria um gatilho — codigo que roda, contra uma restricao
-- que simplesmente nao deixa.
alter table ideworks.spaces
  drop constraint if exists spaces_id_category_key;
alter table ideworks.spaces
  add constraint spaces_id_category_key unique (id, category_id);

create unique index if not exists spaces_source_key
  on ideworks.spaces (source_id) where source_id is not null;

create index if not exists spaces_category_idx
  on ideworks.spaces (category_id, sort_order) where archived_at is null;

comment on table ideworks.spaces is
  'O Espaco do ClickUp. Pendura em client_categories porque a empresa ja mora '
  'la desde a F14 — criar uma tabela de empresa aqui daria duas verdades.';
comment on column ideworks.spaces.archived_at is
  'Instante, nao booleano. Arquivar NAO carimba pastas e listas: "esta viva?" e '
  'leitura sobre a corrente inteira, feita pela view ideworks.tree.';
comment on column ideworks.spaces.source_id is
  'O id desta coisa no ClickUp. E o que faz a importacao da F17.11 ser '
  'repetivel: rodar de novo atualiza, nunca duplica.';

-- --- a pasta ------------------------------------------------------------------
create table if not exists ideworks.folders (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references ideworks.spaces (id) on delete cascade,

  name        text not null,
  sort_order  integer not null default 0,
  archived_at timestamptz,
  source_id   text,

  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint folders_name_not_blank check (btrim(name) <> '')
);

-- O par (id, space_id) e o que a lista referencia para provar que a pasta
-- escolhida pertence ao mesmo espaco dela.
alter table ideworks.folders
  drop constraint if exists folders_id_space_key;
alter table ideworks.folders
  add constraint folders_id_space_key unique (id, space_id);

create unique index if not exists folders_source_key
  on ideworks.folders (source_id) where source_id is not null;

create index if not exists folders_space_idx
  on ideworks.folders (space_id, sort_order) where archived_at is null;

comment on table ideworks.folders is
  'A Pasta do ClickUp. Na AGENCIA IDE ela e o time (TIME HELENA); no ALMA 9 ela '
  'e o cliente (FOCUS Ibitinga). As duas leituras cabem porque a arvore nao '
  'atribui significado a nenhum nivel.';

-- --- a lista ------------------------------------------------------------------
create table if not exists ideworks.lists (
  id          uuid primary key default gen_random_uuid(),

  -- SEMPRE obrigatorio, mesmo quando ha pasta. E o que permite lista solta e o
  -- que fecha a chave composta abaixo.
  space_id    uuid not null,

  -- Opcional de proposito: `Casa Fiore` e `Grupo VITTA` tem lista pendurada
  -- direto no espaco.
  folder_id   uuid,

  name        text not null,

  -- O ClickUp chama de "content" a descricao da lista. Mantido o nome dele.
  content     text,

  sort_order  integer not null default 0,
  archived_at timestamptz,
  source_id   text,

  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint lists_name_not_blank check (btrim(name) <> ''),

  constraint lists_space_fk
    foreign key (space_id) references ideworks.spaces (id) on delete cascade,

  -- O coracao do desenho. Com `folder_id` nulo a restricao esta satisfeita por
  -- definicao (MATCH SIMPLE), e a lista fica solta no espaco. Com `folder_id`
  -- preenchido, o banco EXIGE que a pasta seja do mesmo `space_id` — nao ha
  -- como uma lista da Alma 9 apontar para uma pasta da Agencia Ide, nem por
  -- engano de codigo nem por escrita direta.
  constraint lists_folder_same_space_fk
    foreign key (folder_id, space_id)
    references ideworks.folders (id, space_id) on delete cascade
);

create unique index if not exists lists_source_key
  on ideworks.lists (source_id) where source_id is not null;

create index if not exists lists_space_idx
  on ideworks.lists (space_id, sort_order) where archived_at is null;

create index if not exists lists_folder_idx
  on ideworks.lists (folder_id, sort_order) where archived_at is null;

comment on table ideworks.lists is
  'A Lista do ClickUp — onde a tarefa mora (F17.3). `folder_id` e opcional; '
  '`space_id` nunca.';
comment on constraint lists_folder_same_space_fk on ideworks.lists is
  'Impede lista de apontar para pasta de outro espaco. Declarado no banco, nao '
  'confiado ao chamador.';

-- --- quem alcanca o espaco ----------------------------------------------------
-- Espelha `can_see_client` da F2.1/F14: a regra mora num lugar so, porque uma
-- copia espalhada pelas politicas fica para tras na primeira mudanca.
--
-- `has_all_clients_access` entra na conta. Sem ele existiria a figura incoerente
-- de alguem que enxerga TODOS os clientes e NENHUM quadro de trabalho — e o
-- proprio ato de conceder acesso amplo ja e a decisao deliberada de confiar.
create or replace function ideworks.can_see_space(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_superadmin()
      or exists (
           select 1 from ideworks.profiles p
            where p.id = ideworks.acting_user_id() and p.has_all_clients_access)
      or exists (
           select 1
             from ideworks.spaces s
             join ideworks.user_categories uc
               on uc.category_id = s.category_id
              and uc.user_id = ideworks.acting_user_id()
            where s.id = target)
$fn$;

comment on function ideworks.can_see_space(uuid) is
  'A regra de alcance do quadro, num lugar so. Sai da empresa (client_categories '
  'via user_categories), que e como a F14 ja separa Ide de Alma9.';

-- --- a arvore viva ------------------------------------------------------------
-- "Esta lista esta viva?" nao e uma coluna — e a corrente inteira sem
-- arquivamento. Calcular aqui, uma vez, evita que cada consulta refaca a conta
-- e que uma delas a refaca errado.
--
-- `security_invoker` faz a view respeitar as politicas de quem consulta. Sem
-- isso ela rodaria com os poderes do dono e seria um buraco de RLS com cara de
-- comodidade.
drop view if exists ideworks.tree;
create view ideworks.tree
  with (security_invoker = true)
as
select
  l.id          as list_id,
  l.name        as list_name,
  l.content     as list_content,
  l.sort_order  as list_sort_order,
  l.archived_at as list_archived_at,
  f.id          as folder_id,
  f.name        as folder_name,
  f.sort_order  as folder_sort_order,
  f.archived_at as folder_archived_at,
  s.id          as space_id,
  s.name        as space_name,
  s.color       as space_color,
  s.sort_order  as space_sort_order,
  s.archived_at as space_archived_at,
  s.category_id,
  (    s.archived_at is null
   and (f.id is null or f.archived_at is null)
   and l.archived_at is null) as is_live
from ideworks.lists l
join ideworks.spaces s on s.id = l.space_id
left join ideworks.folders f on f.id = l.folder_id;

comment on view ideworks.tree is
  'A arvore achatada, com `is_live` calculado sobre a corrente inteira. Regra 1 '
  'do roteiro: agregado e calculo derivado, nunca coluna gravada.';

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.spaces  enable row level security;
alter table ideworks.folders enable row level security;
alter table ideworks.lists   enable row level security;

-- Espaco: le quem alcanca; escreve so administrador. Espacos sao raros e
-- estruturais — dois, hoje.
create policy spaces_select on ideworks.spaces for select
  using (ideworks.can_see_space(id));
create policy spaces_write on ideworks.spaces for all
  using (ideworks.acting_is_superadmin())
  with check (ideworks.acting_is_superadmin());

-- Pasta e lista: quem alcanca o espaco cuida delas. Exigir administrador aqui
-- paralisaria a operacao — mesmo criterio da F4.8 para tarefas.
create policy folders_select on ideworks.folders for select
  using (ideworks.can_see_space(space_id));
create policy folders_write on ideworks.folders for all
  using (ideworks.can_see_space(space_id))
  with check (ideworks.can_see_space(space_id));

create policy lists_select on ideworks.lists for select
  using (ideworks.can_see_space(space_id));
create policy lists_write on ideworks.lists for all
  using (ideworks.can_see_space(space_id))
  with check (ideworks.can_see_space(space_id));

-- --- permissoes ---------------------------------------------------------------
grant all privileges on all tables in schema ideworks to ideworks_app;
grant select on ideworks.tree to ideworks_app;
grant execute on function ideworks.can_see_space(uuid) to ideworks_app;
