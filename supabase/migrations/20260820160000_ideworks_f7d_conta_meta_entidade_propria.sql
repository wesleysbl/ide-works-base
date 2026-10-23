-- =============================================================================
-- IDE WORKS — F7d  A conta da Meta vira entidade propria
-- =============================================================================
-- O QUE ESTAVA ERRADO
--   `meta_assets.client_id` era NOT NULL: a conta so existia como atributo de
--   um cliente do Sistema IDE. Isso inverte a realidade.
--
--   A conta de anuncio existe na BM do cliente, e a conta do Instagram existe
--   pendurada numa pagina do Facebook — as duas existem na Meta,
--   independentemente de haver ou nao um cliente cadastrado aqui. E a propria
--   Meta ja diz qual IG pertence a qual pagina e qual conta pertence a qual BM:
--   nao havia nada a adivinhar, havia estrutura a copiar.
--
--   O vinculo com o cliente e uma PONTE entre duas areas do IDE Works — o
--   Sistema IDE cobra entrega, a Meta mede resultado. Ponte e opcional por
--   natureza: ha conta sem cliente cadastrado, e ha cliente que nao anuncia.
--
-- O QUE MUDA
--   1. `client_id` passa a ser ANULAVEL.
--   2. A unicidade deixa de ser (cliente, tipo, id) e passa a ser (tipo, id) —
--      porque a conta e a entidade, e existe uma vez so. Com `client_id`
--      anulavel a chave antiga nem funcionaria: no Postgres nulos sao distintos
--      entre si, entao a mesma conta poderia entrar N vezes sem dono.
--   3. Entram as colunas da estrutura que a Meta ja sabe: de qual BM a conta de
--      anuncio e, e de qual pagina o Instagram pende.
--
-- QUEM VE O QUE
--   Conta COM cliente segue a carteira, como antes. Conta SEM cliente e visivel
--   so para administrador — ela nao pertence a carteira de ninguem ainda, e
--   deixar todo mundo ver todas as contas da agencia seria afrouxar a regra por
--   causa de uma tabela nova.
-- =============================================================================

alter table ideworks.meta_assets alter column client_id drop not null;

alter table ideworks.meta_assets drop constraint if exists meta_assets_unico_por_cliente;

-- A conta e a entidade: entra uma vez so, com ou sem dono.
create unique index if not exists meta_assets_conta_unica
  on ideworks.meta_assets (kind, external_id);

alter table ideworks.meta_assets add column if not exists business_id   text;
alter table ideworks.meta_assets add column if not exists business_name text;
alter table ideworks.meta_assets add column if not exists page_id       text;
alter table ideworks.meta_assets add column if not exists page_name     text;

comment on column ideworks.meta_assets.client_id is
  'A PONTE com o Sistema IDE, e por isso anulavel: ha conta sem cliente '
  'cadastrado, e cliente que nao anuncia. O vinculo se faz do lado do cliente, '
  'na ficha dele.';
comment on column ideworks.meta_assets.business_id is
  'De qual BM a conta de anuncio e. Vem da propria Meta — nao se digita nem se '
  'adivinha.';
comment on column ideworks.meta_assets.page_id is
  'De qual pagina do Facebook o Instagram pende. E por ela que o Instagram e '
  'alcancado nesta arquitetura.';

drop policy if exists meta_assets_select on ideworks.meta_assets;
drop policy if exists meta_assets_write  on ideworks.meta_assets;

create policy meta_assets_select on ideworks.meta_assets for select
  using (
    ideworks.acting_is_superadmin()
    or (client_id is not null and ideworks.can_see_client(client_id))
  );
create policy meta_assets_write on ideworks.meta_assets for all
  using (ideworks.acting_is_superadmin())
  with check (ideworks.acting_is_superadmin());

-- As metricas seguem a conta: sem cliente, so administrador le.
drop policy if exists organic_select on ideworks.meta_daily_organic;
drop policy if exists campaign_select on ideworks.meta_daily_campaign;

create policy organic_select on ideworks.meta_daily_organic for select
  using (exists (select 1 from ideworks.meta_assets a
                  where a.id = asset_id
                    and (ideworks.acting_is_superadmin()
                         or (a.client_id is not null and ideworks.can_see_client(a.client_id)))));

create policy campaign_select on ideworks.meta_daily_campaign for select
  using (exists (select 1 from ideworks.meta_assets a
                  where a.id = asset_id
                    and (ideworks.acting_is_superadmin()
                         or (a.client_id is not null and ideworks.can_see_client(a.client_id)))));

-- --- importar o que a Meta ja sabe --------------------------------------------
-- Recebe UMA conta descoberta e a insere ou atualiza. NAO mexe em `client_id`:
-- reimportar nao pode desfazer a atribuicao que alguem ja fez na ficha do
-- cliente — rotina automatica nao apaga trabalho humano.
create or replace function ideworks.upsert_meta_asset(
  p_kind          ideworks.meta_asset_kind,
  p_external_id   text,
  p_display_name  text,
  p_business_id   text,
  p_business_name text,
  p_page_id       text,
  p_page_name     text
) returns uuid
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_id uuid;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador importa contas da Meta' using errcode = '42501';
  end if;

  insert into ideworks.meta_assets
    (kind, external_id, display_name, business_id, business_name, page_id, page_name)
  values
    (p_kind, p_external_id, nullif(btrim(p_display_name), ''), p_business_id,
     p_business_name, p_page_id, p_page_name)
  on conflict (kind, external_id) do update set
    display_name  = coalesce(nullif(btrim(p_display_name), ''), ideworks.meta_assets.display_name),
    business_id   = coalesce(p_business_id,   ideworks.meta_assets.business_id),
    business_name = coalesce(p_business_name, ideworks.meta_assets.business_name),
    page_id       = coalesce(p_page_id,       ideworks.meta_assets.page_id),
    page_name     = coalesce(p_page_name,     ideworks.meta_assets.page_name),
    updated_at    = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function ideworks.upsert_meta_asset(
  ideworks.meta_asset_kind, text, text, text, text, text, text) is
  'Importa uma conta descoberta na Meta. NAO toca em `client_id`: reimportar '
  'nao pode desfazer a atribuicao feita por gente.';

-- --- a ponte com o Sistema IDE ------------------------------------------------
-- Feita do lado do cliente, e por isso exige ENXERGAR o cliente — nao ser
-- administrador. Quem cuida da carteira sabe de quem e a conta; a Meta nao tem
-- essa informacao em lugar nenhum.
create or replace function ideworks.set_asset_client(p_asset_id uuid, p_client_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if p_client_id is not null and not ideworks.can_see_client(p_client_id) then
    raise exception 'cliente nao encontrado ou fora do seu alcance' using errcode = '42501';
  end if;

  -- Desatribuir exige enxergar o cliente que estava la — senao alguem soltaria
  -- a conta de uma carteira que nao e dele.
  if p_client_id is null then
    if not exists (
      select 1 from ideworks.meta_assets a
       where a.id = p_asset_id
         and (a.client_id is null or ideworks.can_see_client(a.client_id))
    ) then
      raise exception 'conta fora do seu alcance' using errcode = '42501';
    end if;
  end if;

  update ideworks.meta_assets
     set client_id = p_client_id, updated_at = now()
   where id = p_asset_id;

  if not found then
    raise exception 'conta nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;

grant execute on function ideworks.upsert_meta_asset(
  ideworks.meta_asset_kind, text, text, text, text, text, text) to ideworks_app;
grant execute on function ideworks.set_asset_client(uuid, uuid) to ideworks_app;
grant all privileges on all tables in schema ideworks to ideworks_app;
