-- =============================================================================
-- ROLLBACK — F17.54  A arvore do Pilar B tambem respeita a empresa
-- =============================================================================
-- ⚠️ DESFAZER ISTO REABRE O ACHADO A1 DA AUDITORIA DE 2026-09-01.
--   Quem administra volta a alcancar a arvore INTEIRA do Pilar B de QUALQUER
--   empresa — 40 politicas em 18 tabelas —, com nivel `manage`: leitura e
--   escrita. Hoje isso nao vaza linha nenhuma porque nao existe espaco fora de
--   `Ide`/`Ide Hub`; vira vazamento ativo no primeiro espaco da Alma 9.
--
--   So rode se a estreitada tiver quebrado o trabalho de quem administra —
--   criar espaco, mexer em esteira de espaco, fechar ou abrir no.
--
-- O QUE VOLTA, NA ORDEM QUE O BANCO EXIGE
--   1. as duas politicas, antes de a funcao que elas usam ser apagada;
--   2. os cinco corpos da F17.23/F17.41, palavra por palavra;
--   3. `reaches_category` e `reaches_category_for`, que nasceram na F17.54 e
--      deixam de existir aqui.
-- =============================================================================

-- --- 1. as politicas voltam a dizer so "administra" --------------------------
alter policy spaces_write on ideworks.spaces
  using (ideworks.acting_is_superadmin())
  with check (ideworks.acting_is_superadmin());

alter policy task_types_write on ideworks.task_types
  using (ideworks.acting_is_superadmin())
  with check (ideworks.acting_is_superadmin());

-- --- 2. os corpos anteriores -------------------------------------------------

-- `node_access` volta a mandar `p.is_superadmin` para as DUAS perguntas.
create or replace function ideworks.node_access(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns jsonb
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_space   uuid;
  v_folder  uuid;
  v_saida   jsonb;
begin
  if num_nonnulls(p_space_id, p_folder_id, p_list_id) <> 1 then
    raise exception 'informe exatamente um no: espaco, pasta ou lista'
      using errcode = '22023';
  end if;

  if ideworks.node_level(p_space_id, p_folder_id, p_list_id) is null then
    raise exception 'nao encontrado, ou fora do seu alcance' using errcode = '42501';
  end if;

  v_space  := ideworks.owner_space(p_space_id, p_folder_id, p_list_id);
  v_folder := coalesce(p_folder_id,
                       (select l.folder_id from ideworks.lists l where l.id = p_list_id));

  select jsonb_build_object(
    'restricted', exists (
      select 1 from ideworks.node_restrictions r
       where r.space_id is not distinct from p_space_id
         and r.folder_id is not distinct from p_folder_id
         and r.list_id is not distinct from p_list_id),

    -- Onde estao as paredes da corrente inteira. E o que deixa a tela dizer "a
    -- pasta acima esta fechada" em vez de deixar a pessoa adivinhar por que a
    -- concessao que ela deu nao surtiu efeito.
    'closedAbove', coalesce((
      select jsonb_agg(x.item order by x.ordem)
        from (
          select 1 as ordem,
                 jsonb_build_object('level', 'space', 'id', s.id, 'name', s.name) as item
            from ideworks.spaces s
            join ideworks.node_restrictions r on r.space_id = s.id
           where s.id = v_space and p_space_id is null
          union all
          select 2,
                 jsonb_build_object('level', 'folder', 'id', f.id, 'name', f.name)
            from ideworks.folders f
            join ideworks.node_restrictions r on r.folder_id = f.id
           where f.id = v_folder and p_folder_id is null
        ) x), '[]'::jsonb),

    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'userId', g.user_id,
               'name',   coalesce(p.full_name, p.email),
               'level',  g.level)
             order by coalesce(p.full_name, p.email))
        from ideworks.node_grants g
        join ideworks.profiles p on p.id = g.user_id
       where g.space_id is not distinct from p_space_id
         and g.folder_id is not distinct from p_folder_id
         and g.list_id is not distinct from p_list_id), '[]'::jsonb),

    -- Quem alcanca de verdade. A regra e a MESMA de `chain_level`, chamada com
    -- a pessoa explicita — e por isso `chain_ceiling_for` e `reaches_company_for`
    -- existem com essa forma desde o comeco deste arquivo.
    'reachers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'userId', p.id,
               'name',   coalesce(p.full_name, p.email),
               'level',  n.nivel,
               'admin',  p.is_superadmin)
             order by coalesce(p.full_name, p.email))
        from ideworks.profiles p
        cross join lateral (
          select case
                   when ideworks.reaches_company_for(p.id, p.is_superadmin, v_space)
                     then ideworks.chain_ceiling_for(
                            p.id, p.is_superadmin, v_space, v_folder, p_list_id)
                 end as nivel) n
       where p.is_active and n.nivel is not null), '[]'::jsonb),

    'canGrant', ideworks.can_grant_on(p_space_id, p_folder_id, p_list_id),
    'myLevel',  ideworks.node_level(p_space_id, p_folder_id, p_list_id))
  into v_saida;

  return v_saida;
end;
$fn$;

comment on function ideworks.node_access(uuid, uuid, uuid) is
  'O acesso de um no, inteiro, numa chamada: se esta fechado, onde estao as '
  'paredes acima dele, quem tem concessao, quem ALCANCA de verdade e se quem '
  'pergunta pode mexer. "Quem alcanca" usa a mesma regra da politica, chamada '
  'com a pessoa explicita.';

-- `can_grant_on` volta a abrir o primeiro ramo para quem administra, empresa
-- nenhuma valendo.
create or replace function ideworks.can_grant_on(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_superadmin()
      or (
        -- Quem nao alcanca o no nao decide nada sobre ele. Vem primeiro para a
        -- resposta nao depender de `created_by` de coisa que a pessoa nem ve.
        ideworks.node_level(p_space_id, p_folder_id, p_list_id) is not null
        and (
          -- quem criou o no
          coalesce(
            (select s.created_by from ideworks.spaces  s where s.id = p_space_id),
            (select f.created_by from ideworks.folders f where f.id = p_folder_id),
            (select l.created_by from ideworks.lists   l where l.id = p_list_id))
            = ideworks.acting_user_id()
          -- ou quem tem `manage` EXPLICITO no no ou num ancestral dele
          or exists (
               select 1
                 from ideworks.node_grants g
                where g.user_id = ideworks.acting_user_id()
                  and g.level = 'manage'::ideworks.access_level
                  and (
                    g.space_id = ideworks.owner_space(p_space_id, p_folder_id, p_list_id)
                    or g.folder_id = coalesce(
                         p_folder_id,
                         (select l.folder_id from ideworks.lists l where l.id = p_list_id))
                    or g.list_id = p_list_id))))
$fn$;

comment on function ideworks.can_grant_on(uuid, uuid, uuid) is
  'Quem muda o acesso de um no: quem administra o sistema, quem criou o no, ou '
  'quem tem `manage` explicito nele ou num ancestral. Restrito e aberto usam a '
  'mesma resposta — fechar e conceder sao a mesma decisao.';

-- `can_write_owner` volta a aceitar qualquer administrador no ramo do espaco.
create or replace function ideworks.can_write_owner(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when p_space_id is not null then ideworks.acting_is_superadmin()
           else ideworks.node_level(p_space_id, p_folder_id, p_list_id)
                  >= 'manage'::ideworks.access_level
         end
$fn$;

comment on function ideworks.can_write_owner(uuid, uuid, uuid) is
  'Quem escreve o que pertence a um no. No ESPACO continua sendo so quem '
  'administra o sistema; em pasta e lista passou a exigir `manage` na corrente.';

-- `node_level_for` volta a mandar `p_admin` tambem para a empresa.
create or replace function ideworks.node_level_for(
  p_user_id uuid, p_admin boolean,
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when not ideworks.reaches_company_for(
                     p_user_id, p_admin,
                     ideworks.owner_space(p_space_id, p_folder_id, p_list_id))
             then null
           else ideworks.node_ceiling_for(
                  p_user_id, p_admin, p_space_id, p_folder_id, p_list_id)
         end
$fn$;

comment on function ideworks.node_level_for(uuid, boolean, uuid, uuid, uuid) is
  'O nivel efetivo de um no, com a PESSOA como parametro: a EMPRESA primeiro, o '
  'teto da corrente depois.';

-- `reaches_company` volta a linha do achado A1.
create or replace function ideworks.reaches_company(p_space_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.reaches_company_for(
           ideworks.acting_user_id(), ideworks.acting_is_superadmin(), p_space_id)
$fn$;

comment on function ideworks.reaches_company(uuid) is
  'A primeira barreira, para quem esta agindo agora. Duas portas, uma regra '
  'atras das duas.';

-- `reaches_company_for` volta a ter o corpo inteiro, sem delegar.
create or replace function ideworks.reaches_company_for(
  p_user_id uuid, p_super boolean, p_space_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select coalesce(p_super, false)
      or exists (
           select 1 from ideworks.profiles p
            where p.id = p_user_id and p.has_all_clients_access)
      or exists (
           select 1
             from ideworks.spaces s
             join ideworks.user_categories uc
               on uc.category_id = s.category_id
              and uc.user_id = p_user_id
            where s.id = p_space_id)
$fn$;

comment on function ideworks.reaches_company_for(uuid, boolean, uuid) is
  'A PRIMEIRA barreira: a pessoa alcanca a EMPRESA do espaco? E o corpo que '
  '`can_see_space` tinha ate a F17.23, sem uma virgula de diferenca. Quando ela '
  'responde nao, a camada de no nem e consultada.';

-- --- 3. as duas portas que nasceram na F17.54 deixam de existir --------------
drop function if exists ideworks.reaches_category(uuid);
drop function if exists ideworks.reaches_category_for(uuid, boolean, uuid);
