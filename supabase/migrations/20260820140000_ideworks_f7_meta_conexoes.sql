-- =============================================================================
-- IDE WORKS — F7  Conexões da Meta
-- =============================================================================
-- O QUE ESTA ETAPA RESPONDE
--   "De quais contas o motor de coleta deve puxar dado, para cada cliente?"
--
-- O TOKEN NAO ENTRA NO BANCO — E ISSO E UMA MUDANCA DELIBERADA
--   O roteiro mestre dizia "System User e token de longa duracao, guardados em
--   tabela sem acesso para usuario logado". Relendo a arquitetura no documento
--   de viabilidade, a premissa mudou: **nao ha um token por cliente**. Ha UM
--   System User na BM do Grupo Ideal, com acesso de parceiro as BMs dos
--   clientes. Um token, para todos.
--
--   Um segredo unico nao precisa de tabela. Ele vira segredo do Worker, e com
--   isso:
--     - nao existe linha para vazar por consulta, por backup ou por engano de
--       politica;
--     - o schema `ideworks` deixa de conter credencial de terceiro;
--     - rotacionar e trocar um segredo, nao rodar uma migration.
--
--   O que fica no banco e so o MAPA: quais contas pertencem a qual cliente.
--   Identificador de conta de anuncio nao e segredo — e o que aparece na URL do
--   Gerenciador.
--
-- UMA LINHA POR ATIVO, E NAO UMA POR CLIENTE
--   Seria mais simples ter `meta_connections(client_id, ad_account_id,
--   page_id, instagram_id)`. Seria simples e errado: cliente com duas contas de
--   anuncio existe, e o modelo de uma coluna so forcaria escolher qual das duas
--   cabe — ou repetir o cliente inteiro.
--
--   Nao ha dado no legado para medir isso, porque o legado nao tem nada disto.
--   Na duvida, o modelo que aceita o plural custa uma tabela; o que so aceita o
--   singular custa uma migracao depois, com dado dentro.
--
-- METRICA SOME SEM AVISO (secao 6.5 da viabilidade)
--   Por isso `display_name` e opcional e serve so para a tela: o que identifica
--   o ativo e o `external_id`. Nome que a Meta devolve hoje pode nao vir amanha,
--   e o vinculo nao pode depender dele.
-- =============================================================================

do $$ begin
  create type ideworks.meta_asset_kind as enum
    ('business', 'ad_account', 'facebook_page', 'instagram_account');
exception when duplicate_object then null; end $$;

comment on type ideworks.meta_asset_kind is
  'Os quatro tipos de ativo do mapa: a BM do cliente, a conta de anuncio, a '
  'pagina do Facebook e a conta do Instagram.';

create table if not exists ideworks.meta_assets (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references ideworks.clients (id) on delete cascade,

  kind         ideworks.meta_asset_kind not null,

  -- O identificador na Meta. `act_123456` para conta de anuncio, numerico para
  -- pagina e Instagram. Guardado como veio: normalizar aqui seria adivinhar o
  -- formato de uma plataforma que muda sozinha.
  external_id  text not null,

  -- So para a tela. Ver a nota sobre metrica que some, no cabecalho.
  display_name text,

  -- Desligar sem apagar: quando a coleta de um ativo para, a serie historica
  -- dele continua valendo. Apagar o ativo levaria o historico junto.
  is_active    boolean not null default true,

  -- Quando o motor conseguiu falar com este ativo pela ultima vez, e o que deu
  -- errado se deu. Preenchidos pela F8; existem aqui porque a tela de conexoes
  -- e o lugar onde se olha quando o dado para de chegar.
  last_seen_at timestamptz,
  last_error   text,

  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint meta_assets_external_id_not_blank check (btrim(external_id) <> ''),
  constraint meta_assets_name_not_blank check (display_name is null or btrim(display_name) <> ''),

  -- O mesmo ativo nao entra duas vezes para o mesmo cliente.
  constraint meta_assets_unico_por_cliente unique (client_id, kind, external_id)
);

create index if not exists meta_assets_client_idx on ideworks.meta_assets (client_id, kind);

-- O motor da F8 varre por tipo, so o que esta ligado.
create index if not exists meta_assets_coleta_idx
  on ideworks.meta_assets (kind, client_id) where is_active;

comment on table ideworks.meta_assets is
  'O MAPA de quais contas da Meta pertencem a qual cliente. NAO guarda token: o '
  'System User e um so, para toda a carteira, e vive como segredo do Worker. '
  'Identificador de conta de anuncio nao e segredo — e o que aparece na URL do '
  'Gerenciador.';
comment on column ideworks.meta_assets.is_active is
  'Desligar para de coletar SEM apagar a serie historica ja coletada. Apagar o '
  'ativo leva o historico junto, e o historico e o produto.';

-- --- seguranca por linha ------------------------------------------------------
alter table ideworks.meta_assets enable row level security;

-- Ler: quem enxerga o cliente. Escrever: administrador — conectar a conta de um
-- cliente e ato de configuracao, e o erro aqui coleta dado da conta errada.
create policy meta_assets_select on ideworks.meta_assets for select
  using (ideworks.can_see_client(client_id));
create policy meta_assets_write on ideworks.meta_assets for all
  using (ideworks.acting_is_superadmin())
  with check (ideworks.acting_is_superadmin());

grant all privileges on all tables in schema ideworks to ideworks_app;
