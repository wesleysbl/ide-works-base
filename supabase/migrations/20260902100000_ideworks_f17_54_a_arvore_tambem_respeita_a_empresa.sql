-- =============================================================================
-- IDE WORKS — F17.54  A arvore do Pilar B tambem respeita a empresa
-- =============================================================================
-- O ACHADO A1 DA AUDITORIA DE 2026-09-01, E ELE E A DIVIDA ESCRITA DA F17.32
--   `ideworks.reaches_company(p_space_id)` chamava `reaches_company_for` com
--   `ideworks.acting_is_superadmin()` no lugar de `ideworks.acting_is_super()`.
--
--   ⚠️ `acting_is_superadmin()` NAO quer dizer "e o topo". Quer dizer
--   "ADMINISTRA": `profiles.is_superadmin` nasce de `role in ('super_admin',
--   'admin')`, e `src/server/db.ts` declara `app.is_superadmin` verdadeiro para
--   os dois papeis. Quem guarda o topo e `acting_is_super()`, ligada ao GUC
--   `app.is_super`, que o servidor so declara para `role = 'super_admin'`.
--
--   E a MESMA confusao que a F17.32 corrigiu em `can_see_client` e
--   `can_see_asset` — e que ficou registrada la, por escrito, como divida desta
--   funcao, com a razao de nao ter sido desatada na epoca:
--
--     "fechar so a leitura criaria 'escreve mas nao ve'. As duas pontas andam
--      juntas, e isso e desenho, nao troca de nome."
--
--   Esta etapa desata as duas pontas.
--
-- O QUE VAZAVA, MEDIDO
--   O primeiro ramo de `reaches_company_for` e `coalesce(p_super, false)`. Com
--   "administra" ali, quem administra atravessava a arvore INTEIRA do Pilar B —
--   `can_see_space`, `can_see_folder`, `can_see_list`, `can_see_status_set`, via
--   `chain_level` e `node_level`. Alcance: 40 politicas nas 18 tabelas da
--   cadeia.
--
--   Vazamento em 2026-09-02: ZERO linhas. Os 7 espacos sao todos de `Ide`/`Ide
--   Hub`, as duas empresas das duas administradoras. Contar nao provava nada —
--   nao distinguia "nao vaza" de "nao ha o que vazar". Por isso a prova e por
--   SONDA: `scripts/provar-a-empresa-do-espaco.mjs` cria um espaco da `Alma9`
--   dentro de transacao desfeita e mede de novo. Antes desta migration,
--   `gestao@exemplo.com.br` ia de 7 para 8 espacos, com `can_see_space=true`,
--   `reaches_company=true` e nivel `manage` — escrita, nao so leitura — e um
--   tipo de tarefa da Alma9 vinha junto.
--
-- ⚠️ AS DUAS PONTAS, PORQUE APERTAR SO A LEITURA CRIA "ESCREVE MAS NAO VE"
--   Quatro guardas de ESCRITA da arvore diziam so `acting_is_superadmin()`,
--   sem uma palavra sobre empresa. Apertadas aqui, cada uma com a mesma forma:
--   continua exigindo que a pessoa ADMINISTRE, e passa a exigir tambem que ela
--   ALCANCE A EMPRESA.
--
--     · politica `spaces_write`      — escrevia espaco de qualquer empresa
--     · politica `task_types_write`  — escrevia tipo de tarefa de qualquer uma
--     · `can_write_owner`, no ramo do ESPACO — e por ela que passam
--       `status_sets_write` e, via `can_write_status_set`, `statuses_write`
--     · `can_grant_on`, no primeiro ramo — e por ela que passam
--       `node_grants_write`, `node_restrictions_write` e `set_node_access`
--
--   Sem estas quatro, um administrador continuaria fechando, abrindo e
--   concedendo acesso em no de empresa que ele nao enxerga.
--
-- ⚠️ `spaces_write` PERGUNTA PELA EMPRESA, E NAO PELO ESPACO
--   No `insert`, a linha nova ainda nao existe para ser consultada — e a razao
--   medida na F17.2b e repetida no cabecalho da F17.23. `reaches_company(id)`
--   iria buscar `spaces` por um `id` que a propria consulta nao enxerga ainda, e
--   recusaria toda criacao de espaco. Por isso nasce `reaches_category`, que
--   pergunta pela COLUNA que a politica ja tem em maos: `category_id`.
--
--   `reaches_company_for` passou a ser uma casca sobre `reaches_category_for` —
--   resolve a empresa do espaco e delega. Uma regra, dois enderecos: pelo
--   espaco e pela empresa.
--
-- ⚠️ O QUE ESTA MIGRATION RECUSA A FAZER, E POR QUE
--   NAO toca no primeiro ramo de `chain_ceiling_for`, embora o laudo o cite.
--   Aquele ramo e sobre RESTRICAO DE NO, nao sobre empresa, e a F17.23 o
--   escreveu de proposito:
--
--     "Quem administra o sistema atravessa a restricao de no [...] Fechar a
--      porta para ele seria tirar do administrador a capacidade de administrar."
--
--   Medido hoje: ha 4 nos restritos, e dois deles sao os espacos `teste` e `pro`
--   — ambos da empresa `Ide`, que e DELA. Trocar aquele ramo tiraria de
--   `gestao@exemplo.com.br` dois espacos da PROPRIA empresa. Isso nao e "a
--   arvore respeita a empresa"; e outra decisao, sobre outro eixo, e ela e do
--   usuario. Fica como divida escrita desta etapa.
--
--   A ordem salva o desenho: `chain_level` e `node_level_for` perguntam a
--   empresa PRIMEIRO e o teto do no depois. Com a empresa apertada, atravessar
--   o no so vale dentro da propria empresa.
--
-- ⚠️ O SUPER ADMIN NAO PODE PERDER NADA
--   `joana@parceira.com.br` e `super_admin` com ZERO empresas marcadas. Amarra-
--   -lo a propria lista o deixaria sem nada — o dono trancado fora do proprio
--   sistema. Ele atravessa por `acting_is_super()`.
--
--   E ha um segundo caminho para o topo, e ele e proposital: a funcao nova
--   passou a ler `role = 'super_admin'` do PERFIL, ao lado do
--   `has_all_clients_access` que ela ja lia. E preciso porque as versoes `_for`
--   perguntam por OUTRA pessoa, que nao tem GUC nenhum — e e exatamente o que
--   `can_reach_task_for` ja faz desde a F17.41, com o comentario que separa os
--   dois booleanos. Nao alarga ninguem: todo `super_admin` de hoje tem
--   `is_superadmin` verdadeiro e ja passava pelo ramo velho.
--
-- OS TRES CHAMADORES DE `reaches_company_for`, UM A UM
--   1. `reaches_company()`   — passava "administra"; passa a `acting_is_super()`.
--   2. `node_level_for()`    — so recebe UM booleano, e ele e "administra"
--      (`p_admin`, usado tambem para o teto do no). Passa a mandar `false` para
--      a empresa: quem sabe se a pessoa e o topo e a propria
--      `reaches_category_for`, que le o perfil. O teto continua recebendo
--      `p_admin`, porque no eixo do no "administra" e o certo.
--   3. `node_access()`       — a lista "quem alcanca" da tela. Passava
--      `p.is_superadmin`; passa a `p.role = 'super_admin'`. Sem isto a tela
--      diria que um administrador de outra empresa alcanca o no, e mentiria.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova. Duas politicas ALTERADAS (`spaces_write`,
--   `task_types_write`) e uma funcao nova, em duas portas. As demais sao
--   `create or replace`, que preserva privilegio; os `grant` abaixo sao
--   explicitos para o arquivo dizer quem executa sem exigir arqueologia.
-- =============================================================================

-- ⚠️ O TETO DE ESPERA E DE PROPOSITO, E FOI MEDIDO
--   `alter policy` pede ACCESS EXCLUSIVE na tabela, e `ideworks.spaces` e lida a
--   cada carregamento da arvore pelo app que esta no ar. Sem teto, esta
--   migration entra na fila, e toda leitura de espaco entra na fila ATRAS dela —
--   o app inteiro para enquanto ela espera. Na primeira tentativa desta etapa foi
--   exatamente o que aconteceu. Com o teto, ela desiste e nada e aplicado; e so
--   rodar de novo.
set local lock_timeout = '15s';

-- --- 1. a empresa, perguntada pela EMPRESA -----------------------------------
-- O corpo que `reaches_company_for` tinha, com um so ajuste: a empresa chega
-- como parametro em vez de ser buscada pelo espaco, e o perfil responde tambem
-- pelo topo.
--
-- `p_top` e "E O TOPO" — `acting_is_super()`, `role = 'super_admin'`. NUNCA
-- `acting_is_superadmin()`, que quer dizer "administra". Foi trocar um pelo
-- outro que abriu o achado A1.
create or replace function ideworks.reaches_category_for(
  p_user_id uuid, p_top boolean, p_category_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select coalesce(p_top, false)

      -- O topo e a excecao DECLARADA no proprio perfil. Os dois ramos moram
      -- juntos porque respondem a mesma pergunta: "esta pessoa esta acima da
      -- parede da empresa?".
      or exists (
           select 1 from ideworks.profiles p
            where p.id = p_user_id
              and (p.has_all_clients_access
                   or p.role = 'super_admin'::ideworks.papel))

      -- A EMPRESA — a parede que a F14 criou e que agora vale para todo mundo.
      or exists (
           select 1 from ideworks.user_categories uc
            where uc.category_id = p_category_id and uc.user_id = p_user_id)
$fn$;

comment on function ideworks.reaches_category_for(uuid, boolean, uuid) is
  'A PRIMEIRA barreira, perguntada pela EMPRESA: esta pessoa alcanca esta '
  'empresa? Nasceu na F17.54 porque a politica de escrita de `spaces` precisa '
  'da pergunta no `insert`, quando a linha nova ainda nao existe para ser '
  'consultada. `p_top` e "e o topo", nunca "administra".';

grant execute on function ideworks.reaches_category_for(uuid, boolean, uuid) to ideworks_app;

create or replace function ideworks.reaches_category(p_category_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.reaches_category_for(
           ideworks.acting_user_id(), ideworks.acting_is_super(), p_category_id)
$fn$;

comment on function ideworks.reaches_category(uuid) is
  'A barreira da empresa para quem esta agindo agora. Duas portas, uma regra '
  'atras das duas — como `reaches_company`.';

grant execute on function ideworks.reaches_category(uuid) to ideworks_app;

-- --- 2. a empresa, perguntada pelo ESPACO ------------------------------------
-- Mesma resposta de sempre, mesma assinatura, mesmos chamadores: resolve a
-- empresa do espaco e delega. Espaco inexistente devolve empresa nula, e empresa
-- nula nao casa com nenhuma linha de `user_categories` — que e exatamente o que
-- o corpo antigo fazia com o `join` que nao achava nada.
--
-- ⚠️ O PARAMETRO CONTINUA SE CHAMANDO `p_super`, E ISSO E DELIBERADO.
--   Renomea-lo para `p_top` exige `drop function` — o Postgres recusa trocar
--   nome de parametro num `create or replace` —, e derrubar a funcao levaria
--   junto os `grant` dela no meio de uma correcao de seguranca. E a mesma
--   recusa da F17.32, pela mesma razao: "renomear junto de uma correcao de
--   seguranca mistura risco com risco". O nome fica; o comentario diz a
--   verdade, e os tres chamadores foram corrigidos um a um.
create or replace function ideworks.reaches_company_for(
  p_user_id uuid, p_super boolean, p_space_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.reaches_category_for(
           p_user_id, p_super,
           (select s.category_id from ideworks.spaces s where s.id = p_space_id))
$fn$;

comment on function ideworks.reaches_company_for(uuid, boolean, uuid) is
  'A PRIMEIRA barreira: a pessoa alcanca a EMPRESA do espaco? Desde a F17.54 '
  'delega a `reaches_category_for`, que e a mesma regra com a empresa em maos. '
  'ATENCAO: `p_super` quer dizer "E O TOPO" (`acting_is_super`), e NAO '
  '"administra" (`acting_is_superadmin`) — trocar um pelo outro foi o achado A1.';

-- A LINHA DO ACHADO A1. Era `acting_is_superadmin()`.
create or replace function ideworks.reaches_company(p_space_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.reaches_company_for(
           ideworks.acting_user_id(), ideworks.acting_is_super(), p_space_id)
$fn$;

comment on function ideworks.reaches_company(uuid) is
  'A primeira barreira, para quem esta agindo agora. F17.54: passou de '
  '`acting_is_superadmin` (administra) para `acting_is_super` (so o topo) — '
  'quem administra passou a respeitar a empresa na arvore do Pilar B, como a '
  'F17.32 ja tinha feito no cliente e na conta da Meta.';

-- --- 3. a pessoa explicita, com os DOIS booleanos separados ------------------
-- `p_admin` continua sendo "administra", porque e o que o teto do no usa. Para a
-- EMPRESA ela manda `false` e deixa `reaches_category_for` ler o perfil: esta
-- funcao nao recebe "e o topo", e chutar seria repetir o achado A1 com outro
-- nome.
create or replace function ideworks.node_level_for(
  p_user_id uuid, p_admin boolean,
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when not ideworks.reaches_company_for(
                     p_user_id, false,
                     ideworks.owner_space(p_space_id, p_folder_id, p_list_id))
             then null
           else ideworks.node_ceiling_for(
                  p_user_id, p_admin, p_space_id, p_folder_id, p_list_id)
         end
$fn$;

comment on function ideworks.node_level_for(uuid, boolean, uuid, uuid, uuid) is
  'O nivel efetivo de um no, com a PESSOA como parametro: a EMPRESA primeiro, o '
  'teto da corrente depois. F17.54: a empresa deixou de receber `p_admin` '
  '(administra) e passa `false`, deixando `reaches_category_for` ler no perfil '
  'quem e o topo.';

-- --- 4. as quatro guardas de ESCRITA da arvore -------------------------------
-- Ate aqui as quatro diziam so "administra". Nenhuma delas perguntava pela
-- empresa, e por isso apertar so a leitura teria criado "escreve mas nao ve".

-- `can_write_owner`, no ramo do ESPACO. `status_sets_write` e — via
-- `can_write_status_set` — `statuses_write` passam por aqui. Os outros ramos ja
-- perguntam pela empresa dentro de `node_level`.
create or replace function ideworks.can_write_owner(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when p_space_id is not null
             then ideworks.acting_is_superadmin()
                  and ideworks.reaches_company(p_space_id)
           else ideworks.node_level(p_space_id, p_folder_id, p_list_id)
                  >= 'manage'::ideworks.access_level
         end
$fn$;

comment on function ideworks.can_write_owner(uuid, uuid, uuid) is
  'Quem escreve o que pertence a um no. No ESPACO exige administrar o sistema E '
  'alcancar a empresa dele (F17.54 acrescentou a segunda metade, para nao '
  'existir "escreve mas nao ve"); em pasta e lista exige `manage` na corrente.';

-- `can_grant_on`, no primeiro ramo. `node_grants_write`,
-- `node_restrictions_write` e `set_node_access` passam por aqui.
create or replace function ideworks.can_grant_on(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select (ideworks.acting_is_superadmin()
          and ideworks.reaches_company(
                ideworks.owner_space(p_space_id, p_folder_id, p_list_id)))
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
  'Quem muda o acesso de um no: quem administra o sistema DENTRO DA EMPRESA '
  'dele (F17.54 acrescentou a empresa), quem criou o no, ou quem tem `manage` '
  'explicito nele ou num ancestral.';

-- --- 5. as duas politicas que diziam so "administra" -------------------------
-- ATENCAO: `spaces_write` pergunta por `category_id`, e nao por `id`: no
-- `insert` a linha nova ainda nao existe para ser consultada.
alter policy spaces_write on ideworks.spaces
  using (ideworks.acting_is_superadmin() and ideworks.reaches_category(category_id))
  with check (ideworks.acting_is_superadmin() and ideworks.reaches_category(category_id));

-- `space_id` aqui aponta para espaco que JA existe, entao a pergunta pode ser
-- pelo espaco.
alter policy task_types_write on ideworks.task_types
  using (ideworks.acting_is_superadmin() and ideworks.reaches_company(space_id))
  with check (ideworks.acting_is_superadmin() and ideworks.reaches_company(space_id));

-- --- 6. a tela nao pode mentir sobre quem alcanca ----------------------------
-- Corpo da F17.23, com UMA linha diferente: a empresa recebe "e o topo"
-- (`p.role = 'super_admin'`) no lugar de "administra" (`p.is_superadmin`). O
-- teto do no continua recebendo `p.is_superadmin`, porque naquele eixo
-- "administra" e o certo — sao dois booleanos diferentes para duas perguntas
-- diferentes, e e por confundi-los que esta etapa existe.
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
    -- existem com essa forma desde o comeco daquele arquivo.
    --
    -- OS DOIS BOOLEANOS SAO DIFERENTES, E A F17.54 OS SEPAROU AQUI:
    --   empresa    -> `p.role = 'super_admin'`  ("e o topo")
    --   teto do no -> `p.is_superadmin`         ("administra")
    -- Antes os dois recebiam `p.is_superadmin`, e a lista dizia que um
    -- administrador de OUTRA empresa alcancava o no.
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
                   when ideworks.reaches_company_for(
                          p.id, p.role = 'super_admin'::ideworks.papel, v_space)
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
  'com a pessoa explicita — e desde a F17.54 com os dois booleanos separados: '
  'a empresa pergunta pelo topo, o teto do no pergunta por quem administra.';
