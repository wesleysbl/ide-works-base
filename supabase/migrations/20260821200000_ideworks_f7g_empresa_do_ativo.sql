-- =============================================================================
-- IDE WORKS — F7g  De qual empresa e cada conta da Meta
-- =============================================================================
-- O PROBLEMA
--   Cada empresa do grupo tem a sua BM, o seu System User e portanto o SEU
--   token. Ate agora havia um so (decisao D14), e o motor podia ignorar a
--   questao: qualquer conta era alcancavel pelo unico token que existia.
--
--   Com a Alma Nove isso acaba. O motor precisa saber, conta por conta, qual
--   credencial fala com ela — e errar aqui nao da erro bonito: da conta que
--   simplesmente para de coletar, porque o token da outra empresa nao a enxerga.
--
-- POR QUE NAO DERIVAR DO CLIENTE
--   Seria o caminho obvio: conta -> cliente -> empresa. Nao serve, por dois
--   motivos medidos, nao imaginados:
--
--     1. `client_id` e ANULAVEL desde a F7d, e hoje as 41 contas em producao
--        estao TODAS sem cliente. Derivar daria nulo para todas.
--     2. A carteira e o coletor sao perguntas diferentes. Um cliente do Ide Hub
--        pode ter o anuncio rodando na BM da A9. Amarrar as duas forcaria a
--        escolher qual das duas verdades mentir.
--
-- POR QUE NAO DERIVAR DA BM
--   `business_id` esta nulo nas 41. A permissao `business_management`, que e a
--   que traria a BM, foi deliberadamente descartada na configuracao do app —
--   ela exige verificacao de negocio e nao ganhamos nada com ela. Entao a BM
--   nunca chegou, e nao vai chegar.
--
-- O CRITERIO QUE SOBRA E O MAIS SIMPLES: QUEM DESCOBRIU
--   O token da A9 so enxerga o que a BM da A9 alcanca. Entao o proprio ato de
--   descobrir ja responde a pergunta — a conta e carimbada com a empresa cuja
--   credencial a encontrou.
--
--   O carimbo e um PADRAO, nao um dogma: `on conflict` preserva o que ja estava
--   la. Se uma conta e alcancavel pelas duas empresas (o Ide Hub e justamente o
--   balde compartilhado), quem chegou primeiro fica, e o super admin corrige.
--   Rotina automatica nao desfaz decisao de gente — mesma regra que ja vale
--   para `client_id`.
--
-- O SEGREDO NAO MORA AQUI, E ISSO E ESTRUTURAL
--   `meta_secret_name` guarda o NOME da variavel de ambiente, nunca o valor.
--   A D14 continua inteira: token e segredo do Worker.
--
--   E nao e so promessa de comentario. A restricao abaixo aceita no maximo 64
--   caracteres de [A-Z0-9_] — um token da Meta tem centenas de caracteres e
--   inclui minusculas. Guardar um token aqui e RECUSADO pelo banco, nao
--   desaconselhado por escrito.
-- =============================================================================

-- --- 1. qual credencial cada empresa usa --------------------------------------
alter table ideworks.client_categories
  add column if not exists meta_secret_name text;

alter table ideworks.client_categories
  drop constraint if exists client_categories_meta_secret_e_nome;
alter table ideworks.client_categories
  add constraint client_categories_meta_secret_e_nome
  check (meta_secret_name is null or meta_secret_name ~ '^[A-Z][A-Z0-9_]{0,63}$');

comment on column ideworks.client_categories.meta_secret_name is
  'O NOME da variavel de ambiente que guarda o token da Meta desta empresa — '
  'jamais o token. A restricao de formato torna impossivel guardar um token '
  'aqui: ele tem centenas de caracteres e minusculas. Nulo significa "usa a '
  'credencial padrao do Worker".';

-- --- 2. de qual empresa e cada conta -------------------------------------------
-- `on delete set null`, e nao cascade: apagar uma empresa nao pode levar junto
-- a serie historica das contas dela. A conta perde o carimbo e volta para a
-- credencial padrao, que e recuperavel; a metrica apagada nao e.
alter table ideworks.meta_assets
  add column if not exists category_id uuid
  references ideworks.client_categories (id) on delete set null;

comment on column ideworks.meta_assets.category_id is
  'De qual empresa do grupo e esta conta — e portanto QUAL TOKEN fala com ela. '
  'Carimbado por quem descobriu, corrigivel pelo super admin. E DIFERENTE da '
  'empresa do cliente em `client_id`: aquela e a carteira (quem enxerga), esta '
  'e o coletor (quem alcanca). Podem divergir de proposito.';

create index if not exists meta_assets_por_empresa
  on ideworks.meta_assets (category_id);

-- --- 3. o estado de hoje ganha nome --------------------------------------------
-- As 41 contas em producao vieram do unico token que existia, o da Ide. Sem
-- este passo elas ficariam sem carimbo e o motor teria de adivinhar.
update ideworks.client_categories
   set meta_secret_name = 'IDEWORKS_META_TOKEN'
 where name = 'Ide' and meta_secret_name is null;

update ideworks.client_categories
   set meta_secret_name = 'IDEWORKS_META_TOKEN_ALMA9'
 where name = 'Alma9' and meta_secret_name is null;

update ideworks.meta_assets
   set category_id = (select id from ideworks.client_categories where name = 'Ide')
 where category_id is null
   and exists (select 1 from ideworks.client_categories where name = 'Ide');

-- --- 4. a fila passa a dizer com qual credencial ir ----------------------------
-- DROP ANTES DE CRIAR, E ISSO NAO E ZELO EXCESSIVO
--   `create or replace` com tipo de RETORNO diferente e recusado; com
--   parametros diferentes ele cria uma SEGUNDA funcao em vez de substituir. Foi
--   assim que a F9h deixou duas `meta_assets_para_coleta` vivas e o app passou a
--   chamar a errada, sem erro nenhum.
drop function if exists ideworks.meta_assets_para_coleta(integer);
drop function if exists ideworks.meta_assets_para_coleta();

create function ideworks.meta_assets_para_coleta(p_limite integer default 0)
  returns table(
    id uuid,
    kind ideworks.meta_asset_kind,
    external_id text,
    -- Nulo quando a conta nao tem empresa, ou a empresa nao tem credencial
    -- propria. Quem decide o padrao e o Worker, que e quem conhece o ambiente:
    -- o banco nao sabe quais variaveis existem la.
    secret_name text
  )
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  return query
    select a.id, a.kind, a.external_id, cc.meta_secret_name
      from ideworks.meta_assets a
      left join ideworks.clients c on c.id = a.client_id
      left join ideworks.client_categories cc on cc.id = a.category_id
     where a.is_active
       and (a.client_id is null or c.is_active)
       and a.kind in ('instagram_account', 'ad_account')
     -- A MAIS ANTIGA PRIMEIRO. E o que faz o rodizio funcionar sozinho.
     order by a.last_attempt_at asc nulls first, a.kind, a.external_id
     limit case when p_limite > 0 then p_limite else null end;
end;
$fn$;

grant execute on function ideworks.meta_assets_para_coleta(integer) to ideworks_app;

-- --- 5. a descoberta carimba --------------------------------------------------
drop function if exists ideworks.upsert_meta_asset(
  ideworks.meta_asset_kind, text, text, text, text, text, text);

create function ideworks.upsert_meta_asset(
  p_kind          ideworks.meta_asset_kind,
  p_external_id   text,
  p_display_name  text,
  p_business_id   text,
  p_business_name text,
  p_page_id       text,
  p_page_name     text,
  p_category_id   uuid default null
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
    (kind, external_id, display_name, business_id, business_name, page_id,
     page_name, category_id)
  values
    (p_kind, p_external_id, nullif(btrim(p_display_name), ''), p_business_id,
     p_business_name, p_page_id, p_page_name, p_category_id)
  on conflict (kind, external_id) do update set
    display_name  = coalesce(nullif(btrim(p_display_name), ''), ideworks.meta_assets.display_name),
    business_id   = coalesce(p_business_id,   ideworks.meta_assets.business_id),
    business_name = coalesce(p_business_name, ideworks.meta_assets.business_name),
    page_id       = coalesce(p_page_id,       ideworks.meta_assets.page_id),
    page_name     = coalesce(p_page_name,     ideworks.meta_assets.page_name),
    -- O QUE JA ESTA CARIMBADO MANDA.
    -- Uma conta alcancavel pelas duas empresas seria recarimbada a cada
    -- descoberta, e a empresa dela passaria a depender de quem rodou por ultimo.
    category_id   = coalesce(ideworks.meta_assets.category_id, p_category_id),
    updated_at    = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function ideworks.upsert_meta_asset(
  ideworks.meta_asset_kind, text, text, text, text, text, text, uuid) is
  'Importa uma conta descoberta na Meta. NAO toca em `client_id` nem recarimba '
  '`category_id`: reimportar nao pode desfazer o que gente decidiu.';

grant execute on function ideworks.upsert_meta_asset(
  ideworks.meta_asset_kind, text, text, text, text, text, text, uuid) to ideworks_app;

-- --- 6. so o super admin muda a empresa de uma conta ---------------------------
-- Pedido explicito do dono: atribuir empresa e ato de super admin. Um
-- administrador comum mudando isto redirecionaria a coleta de uma conta para um
-- token que nao a alcanca — e a conta pararia calada.
create or replace function ideworks.set_asset_category(p_asset_id uuid, p_category_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin define a empresa de uma conta' using errcode = '42501';
  end if;

  update ideworks.meta_assets
     set category_id = p_category_id, updated_at = now()
   where id = p_asset_id;

  if not found then
    raise exception 'conta nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;

grant execute on function ideworks.set_asset_category(uuid, uuid) to ideworks_app;
