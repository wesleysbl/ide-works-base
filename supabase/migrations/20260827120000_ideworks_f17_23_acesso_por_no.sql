-- =============================================================================
-- IDE WORKS — F17.23  Acesso por espaco, pasta e lista
-- =============================================================================
-- O PEDIDO, NAS PALAVRAS DO USUARIO (2026-08-27)
--   "Podem ser empresas diferentes, clientes diferentes, e cada cliente ser
--   para um funcionario. Alma 9 tem loja X e Y, X vai para o funcionario A e Y
--   para o B, e esses funcionarios nao podem ver o que cada um tem por
--   responsabilidade. Usar a hierarquia ja definida em usuarios (...) e na
--   criacao de cada coisa, poder definir quem tera acesso ou nao. As vezes o
--   funcionario precisara ter acesso a um espaco e as tarefas desse espaco, mas
--   sem poder criar — precisa cumprir."
--
--   E, no mesmo dia, a frase que decide a ordem das barreiras:
--   "Ja em usuarios isso fica definido: se for criado para a A9, jamais vera
--   nada da Ide, a nao ser que seja permitido depois."
--
-- ESTA E UMA ETAPA DE RISCO, DA MESMA CLASSE DA F17.3
--   Ela mexe em `can_see_space`, `can_see_list` e `can_reach_task` — as funcoes
--   de que dependem todas as politicas do schema e um dos onze gatilhos
--   (`task_parent_guard`). E o sistema esta PUBLICADO E EM USO.
--
--   Por isso o desenho inteiro obedece a uma regra unica, declarada aqui em voz
--   alta e provada par a par em `scripts/provar-acesso-por-no.mjs`:
--
--     *** A CAMADA NOVA E UM TETO, NUNCA UM CHAO. ***
--
--   Ela so REBAIXA o que a pessoa pode fazer num no. Nao existe caminho pelo
--   qual uma concessao de no de acesso a quem nao tinha. Enquanto nada estiver
--   restringido o teto e o maximo, e toda politica responde exatamente o que
--   respondia ontem — a mesma linha, o mesmo `true`, o mesmo `false`.
--
--   Consequencia direta, e e o que o usuario acabou de reafirmar: a EMPRESA
--   continua sendo a primeira barreira e ela NAO se toca. Quem e da Alma 9 nao
--   alcanca nada da Ide, nem com concessao de no — porque a pergunta da empresa
--   e feita ANTES, e quando ela falha a segunda nem e consultada. As duas
--   portas de "permitir depois" continuam sendo as que ja existem:
--   `user_categories` (a empresa inteira) e `user_clients` (um cliente so).
--
-- O QUE FOI MEDIDO ANTES DE ESCREVER UMA LINHA — 2026-08-27
--   ideworks.spaces .............. 3   (Ide/Demandas, Ide/Focus, Ide Hub/Demandas)
--   ideworks.folders ............. 1   (Focus > Cronograma)
--   ideworks.lists ............... 3
--   ideworks.tasks ............... 24  (18 com cliente, 6 sem)
--   ideworks.profiles ............ 7   (3 administram, 4 funcionarios)
--   ideworks.user_categories ..... 1   linha
--   ideworks.user_clients ........ 1   linha
--
--   O alcance de hoje, conferido perfil por perfil contra no por no:
--     217 pares (7 perfis x 31 nos e tarefas), 93 deles visiveis.
--   Esse e o numero que esta migration tem obrigacao de nao mexer, e a prova o
--   confere dos dois lados: `ganhou_acesso=0` e `perdeu_acesso=0`.
--
-- OS QUATRO NIVEIS, COMO O USUARIO OS DESCREVEU
--   ver          le o quadro e as tarefas; nao muda nada
--   executar     arrasta cartao, comenta, anexa, conclui, edita a tarefa
--   criar        tudo de executar, mais criar tarefa, lista e pasta
--   administrar  tudo de criar, mais mudar as etapas da esteira e dar acesso
--
--   O caso "cumpre mas nao cria" e o `execute`. A ordem do enum E a ordem da
--   autoridade — `nivel >= 'create'` responde a pergunta inteira sem tabela de
--   traducao, exatamente como `task_priority` da F17.3 usa a ordem para dizer o
--   que e mais urgente.
--
--   Os valores ficam em ingles (decisao D5: codigo em ingles, tela em
--   portugues). A traducao mora numa constante da tela, num lugar so.
--
-- ONDE A CONCESSAO MORA — E POR QUE SAO DUAS TABELAS, E NAO TRES COLUNAS
--   A forma de posse e a MESMA que `status_sets` usa desde a F17.2: tres
--   colunas anulaveis, exatamente uma preenchida, e tres indices unicos
--   parciais. Reusar essa forma da de graca o `owner_space` e o `can_write_owner`
--   ja escritos, e evita inventar um segundo jeito de dizer "isto pertence a um
--   no de tres niveis".
--
--   Mas RESTRICAO e CONCESSAO sao coisas diferentes, e ficam em tabelas
--   diferentes:
--
--     ideworks.node_restrictions   "este no esta fechado" — uma linha por no
--     ideworks.node_grants         "fulano alcanca este no, neste nivel"
--
--   POR QUE NAO "TEM CONCESSAO => E RESTRITO". Porque apagar a ultima concessao
--   abriria o no em silencio. O modelo de duas tabelas erra para o lado seguro:
--   apagar todas as concessoes deixa a restricao de pe, e o no fica fechado
--   para todo mundo menos quem administra o sistema. Abrir passa a ser um ato
--   explicito — apagar a linha de restricao —, e nunca o efeito colateral de
--   remover a ultima pessoa.
--
--   POR QUE NAO UMA COLUNA `restricted_at` EM `spaces`/`folders`/`lists`. Porque
--   a permissao de ESCREVER a coluna seria a permissao de escrever a linha
--   inteira: quem pode renomear uma lista poderia fecha-la. Numa tabela
--   propria, a politica de escrita e exatamente `can_grant_on` — declarado no
--   banco, e nao confiado ao chamador. Esse e o criterio da casa desde a F17.1.
--
-- A REGRA DE HERANCA, NUMA FRASE SO
--
--     O nivel de um no e o MENOR nivel ao longo da corrente espaco -> pasta ->
--     lista. No aberto nao impoe teto; no restrito impoe o nivel concedido, ou
--     fecha.
--
--   Dela saem, sem caso especial nenhum:
--     · conceder na pasta vale para as listas dela (o pedido do usuario);
--     · restringir mais fundo estreita de novo;
--     · e "concessao mais especifica" nem SOMA nem SUBSTITUI — a mais
--       restritiva vence.
--
--   O CASO DIFICIL, DECIDIDO E JUSTIFICADO: espaco aberto, pasta restrita ao A,
--   e a lista dentro da pasta com concessao propria para o B. B NAO alcanca a
--   lista. A concessao dele nao fura a parede da pasta.
--
--   Tres razoes, e a primeira e a que decide:
--     1. A alternativa exige inventar uma segunda especie de visibilidade — "ve
--        o nome da pasta, nao o conteudo" —, com politica propria, na etapa que
--        ja mexe em todas as politicas do schema. Custo alto, e superficie nova
--        justamente onde o risco e maior.
--     2. Parede que uma concessao mais funda desfaz nao e parede: quem
--        administra UMA lista poderia furar uma pasta que nao e dele. Aqui a
--        parede so se abre no nivel dela, por quem pode abri-la.
--     3. A arvore continua inteira: `ideworks.tree`, `readFullTree` e o quadro
--        seguem resolvendo a corrente como sempre, sem no meio-orfao.
--
--   O ClickUp faz o contrario (a lista compartilhada aparece dentro da pasta
--   privada). Fica registrado como diferenca deliberada: se o usuario quiser o
--   jeito do ClickUp, e decisao dele, e nao defeito deste desenho.
--
-- COMO O NIVEL CONVERSA COM AS POLITICAS DE ESCRITA QUE JA EXISTEM
--   Esta e a parte delicada, e a resposta e a regra do teto:
--
--     politica efetiva = a regra que ja existia   E   nivel do no >= o exigido
--
--   A regra que ja existia continua sendo a unica que diz QUEM pode; o nivel so
--   diz ATE ONDE. Nao ha duas verdades sobre a mesma pergunta, porque as duas
--   metades respondem perguntas diferentes.
--
--   Em particular, `can_write_owner` continua devolvendo `acting_is_superadmin()`
--   para o nivel ESPACO. Ou seja: nem mesmo quem recebe `manage` num espaco
--   passa a criar, renomear ou reescrever a esteira DO ESPACO. Isso e a decisao
--   da F17.2b, palavra por palavra — "mexer nela muda o quadro do espaco
--   inteiro de uma vez, e isso e tao estrutural quanto criar o espaco" — e
--   mante-la e o que garante que ninguem GANHE poder por causa desta etapa.
--   `manage` num espaco significa: dar acesso a outros ali dentro, e mexer nas
--   esteiras das pastas e listas daquele espaco.
--
--   O nivel exigido por operacao, uma vez, aqui:
--     ver          todo `select`
--     executar     mexer na tarefa: mover, comentar, anexar, concluir, editar,
--                  responsaveis, observadores, etiquetas, passos e checklists
--     criar        criar e apagar tarefa; criar, renomear, mover, arquivar e
--                  apagar pasta e lista; arquivar tarefa (arquivar E o apagar
--                  desta casa); e o catalogo de etiquetas do espaco
--     administrar  a esteira de pasta e lista, e dar acesso a outros
--
-- A UNIAO DA F17.3 CONTINUA, E O TETO PASSA POR CIMA DELA
--   `can_reach_task` e a uniao "alcanco a LISTA ou alcanco o CLIENTE". Ela nao
--   muda: recusar o segundo caminho esconderia trabalho de quem o faz, e isso ja
--   foi decidido na F17.3.
--
--   O que muda e que a restricao de no e um TETO SOBRE AS DUAS PORTAS, e nao uma
--   terceira porta. Quando alguem fecha uma pasta de proposito, nenhuma porta
--   implicita a reabre — senao a verificacao do plano ("restringir a pasta X ao
--   funcionario A: B nao le a pasta, as listas nem as tarefas dela") seria falsa
--   para todo B que tivesse aquele cliente na carteira.
--
--   Enquanto nada esta restringido o teto e o maximo, e a uniao responde
--   exatamente o que respondia. Provado par a par.
--
-- QUEM CONCEDE
--   `can_grant_on` responde, e sao tres caminhos:
--     · quem administra o sistema (`acting_is_superadmin` — super_admin e admin);
--     · quem CRIOU o no (`created_by`, que as tres tabelas ja guardam);
--     · quem tem `manage` EXPLICITO no no ou num ancestral dele.
--
--   O terceiro caminho exige concessao explicita de proposito. O teto implicito
--   de um no aberto tambem vale `manage` — se ele contasse aqui, qualquer
--   funcionario que alcance a empresa poderia fechar um espaco e trancar os
--   colegas. Teto e autoridade sao coisas diferentes, e so a segunda abre porta.
--
--   E `set_node_access` NUNCA deixa quem fecha do lado de fora: se quem
--   restringe nao administra o sistema e nao esta na lista, ele entra nela com
--   `manage`. Sem isso, o primeiro uso da funcao trancaria o proprio autor para
--   fora do que ele acabou de fechar.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria, nao altera e nao apaga usuario. Nao toca `user_categories` nem
--   `user_clients` — as duas portas de empresa e de cliente continuam sendo
--   escritas so por quem ja as escrevia. Nao escreve uma unica linha de
--   restricao: o sistema sai daqui com tudo aberto, exatamente como entrou.
-- =============================================================================

-- --- os quatro niveis ---------------------------------------------------------
-- A ORDEM DO ENUM E A ORDEM DA AUTORIDADE. `nivel >= 'create'` responde a
-- pergunta inteira, e `min(nivel)` sobre a corrente devolve o mais restritivo
-- sem que nenhuma consulta carregue tabela de traducao.
do $$ begin
  create type ideworks.access_level as enum ('view', 'execute', 'create', 'manage');
exception when duplicate_object then null; end $$;

comment on type ideworks.access_level is
  'Os quatro niveis de acesso a um no da arvore, na ordem da autoridade: view < '
  'execute < create < manage. `execute` e o caso que o usuario descreveu — '
  '"precisa ter acesso e cumprir, mas sem poder criar".';

-- --- o no fechado -------------------------------------------------------------
-- Uma linha por no fechado. A EXISTENCIA da linha e a restricao; sem linha, o
-- no e aberto — que e como todo espaco nasce hoje e como o ClickUp faz.
--
-- Tabela propria, e nao coluna em `spaces`/`folders`/`lists`, para a politica de
-- escrita poder ser exatamente `can_grant_on`: quem renomeia uma lista nao
-- fecha uma lista.
create table if not exists ideworks.node_restrictions (
  id            uuid primary key default gen_random_uuid(),

  -- A forma de posse da F17.2: exatamente um dos tres.
  space_id      uuid references ideworks.spaces  (id) on delete cascade,
  folder_id     uuid references ideworks.folders (id) on delete cascade,
  list_id       uuid references ideworks.lists   (id) on delete cascade,

  restricted_at timestamptz not null default now(),
  restricted_by uuid references auth.users (id) on delete set null,

  constraint node_restrictions_one_node
    check (num_nonnulls(space_id, folder_id, list_id) = 1)
);

-- Um no fechado esta fechado uma vez so. Duas linhas para o mesmo no nao
-- responderiam "desde quando".
create unique index if not exists node_restrictions_space_key
  on ideworks.node_restrictions (space_id)  where space_id  is not null;
create unique index if not exists node_restrictions_folder_key
  on ideworks.node_restrictions (folder_id) where folder_id is not null;
create unique index if not exists node_restrictions_list_key
  on ideworks.node_restrictions (list_id)   where list_id   is not null;

comment on table ideworks.node_restrictions is
  'O no fechado. A EXISTENCIA da linha e a restricao — sem linha, o no e aberto, '
  'que e como o sistema estava antes desta etapa e como o ClickUp faz. Separada '
  'de node_grants de proposito: apagar a ultima concessao NAO abre o no.';
comment on constraint node_restrictions_one_node on ideworks.node_restrictions is
  'Exatamente um no, como `status_sets_one_owner` da F17.2. Dois donos nao '
  'respondem "qual no esta fechado?"; nenhum dono e linha que nao fecha nada.';

-- --- quem alcanca um no fechado -----------------------------------------------
-- A concessao. So faz diferenca em no fechado: em no aberto todo mundo ja
-- alcanca no teto maximo, e uma concessao ali nao acrescenta nada — o que e
-- coerente com a regra do teto.
create table if not exists ideworks.node_grants (
  id         uuid primary key default gen_random_uuid(),

  space_id   uuid references ideworks.spaces  (id) on delete cascade,
  folder_id  uuid references ideworks.folders (id) on delete cascade,
  list_id    uuid references ideworks.lists   (id) on delete cascade,

  -- `profiles`, e nao `auth.users`: conceder acesso a quem nao entra no IDE
  -- Works e conceder a ninguem. Mesma decisao que `set_task_assignees` tomou na
  -- F4.8, pelo mesmo motivo.
  user_id    uuid not null references ideworks.profiles (id) on delete cascade,

  level      ideworks.access_level not null default 'execute',

  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),

  constraint node_grants_one_node
    check (num_nonnulls(space_id, folder_id, list_id) = 1)
);

-- Uma concessao por pessoa por no. Duas linhas dariam dois niveis para a mesma
-- pergunta, e a conta do menor escolheria uma delas em silencio.
create unique index if not exists node_grants_space_key
  on ideworks.node_grants (space_id,  user_id) where space_id  is not null;
create unique index if not exists node_grants_folder_key
  on ideworks.node_grants (folder_id, user_id) where folder_id is not null;
create unique index if not exists node_grants_list_key
  on ideworks.node_grants (list_id,   user_id) where list_id   is not null;

-- A leitura quente e sempre "as concessoes DESTA pessoa neste no", e e ela que
-- os indices acima ja atendem. Este aqui e para a tela do no — "quem alcanca
-- isto?" — e para a cascata de `profiles`.
create index if not exists node_grants_user_idx
  on ideworks.node_grants (user_id);

comment on table ideworks.node_grants is
  'Quem alcanca um no fechado, e ate onde. Em no ABERTO ela nao acrescenta nada: '
  'a camada de acesso por no e um teto, nunca um chao.';
comment on column ideworks.node_grants.level is
  'O teto desta pessoa neste no. O nivel efetivo e o MENOR ao longo da corrente '
  'espaco -> pasta -> lista.';

-- --- a primeira barreira, num lugar so ----------------------------------------
-- ESTE E O CORPO QUE `can_see_space` TINHA ATE AQUI, PALAVRA POR PALAVRA.
-- Ele nao muda de comportamento; muda de nome, para que a EMPRESA seja uma
-- pergunta com endereco proprio — a primeira das duas, e a que barra antes.
--
-- "Se for criado para a A9, jamais vera nada da Ide, a nao ser que seja
-- permitido depois." Permitir depois e `user_categories` ou `user_clients`;
-- nunca uma concessao de no, que so existe DENTRO deste limite.
--
-- A versao com `p_user_id` e `p_super` explicitos existe para a tela poder
-- perguntar "quem alcanca este no?" sem que a regra seja escrita duas vezes. E
-- o mesmo par de portas de `can_write_owner`/`can_write_status_set` da F17.2b.
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

-- --- o teto da corrente -------------------------------------------------------
-- O CORACAO DESTA ETAPA, E ELE CABE NUMA FRASE:
--   o nivel de um no e o MENOR nivel ao longo da corrente espaco -> pasta ->
--   lista; no aberto nao impoe teto, no restrito impoe o nivel concedido ou
--   fecha.
--
-- So os nos RESTRITOS entram na conta, e isso nao e otimizacao: no aberto vale
-- `manage`, que e o topo, e o topo nunca seria o menor. Com nenhum no restrito
-- a soma e vazia e a resposta e `manage` — o teto maximo, que e o estado de
-- hoje e a razao pela qual nada muda.
--
-- A EMPRESA NAO E CONSULTADA AQUI, de proposito. Quem faz a pergunta da empresa
-- e `reaches_company`, e ha um caso em que o teto precisa ser lido SEM ela: a
-- uniao da F17.3, em que a pessoa alcanca a tarefa pelo CLIENTE e nao pela
-- lista. Ali o teto ainda tem que valer, mas a empresa da lista nao.
--
-- `security definer` porque a resposta tem que ser um FATO da arvore, e nao uma
-- opiniao filtrada pela politica de quem pergunta. Mesma razao de `owner_space`
-- e da `can_see_space` que veio antes.
create or replace function ideworks.chain_ceiling_for(
  p_user_id   uuid,
  p_super     boolean,
  p_space_id  uuid,
  p_folder_id uuid,
  p_list_id   uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  with restrito as (
    select (select g.level
              from ideworks.node_grants g
             where g.user_id = p_user_id and g.space_id = r.space_id) as nivel
      from ideworks.node_restrictions r
     where r.space_id = p_space_id
    union all
    select (select g.level
              from ideworks.node_grants g
             where g.user_id = p_user_id and g.folder_id = r.folder_id)
      from ideworks.node_restrictions r
     where r.folder_id = p_folder_id
    union all
    select (select g.level
              from ideworks.node_grants g
             where g.user_id = p_user_id and g.list_id = r.list_id)
      from ideworks.node_restrictions r
     where r.list_id = p_list_id
  )
  select case
           -- Quem administra o sistema atravessa a restricao de no, como ja
           -- atravessa `can_see_client` e `can_see_space`. Fechar a porta para
           -- ele seria tirar do administrador a capacidade de administrar.
           when coalesce(p_super, false) then 'manage'::ideworks.access_level

           -- Ninguem declarado nao alcanca nada. Nulo nega, como em toda
           -- politica desde a F1.9.
           when p_user_id is null then null

           -- Um no fechado sem concessao para esta pessoa fecha a corrente
           -- inteira, esteja ele em cima ou embaixo.
           when exists (select 1 from restrito where nivel is null) then null

           -- O menor entre os restritos; `manage` quando nenhum esta restrito.
           else coalesce((select min(nivel) from restrito),
                         'manage'::ideworks.access_level)
         end
$fn$;

comment on function ideworks.chain_ceiling_for(uuid, boolean, uuid, uuid, uuid) is
  'O TETO da corrente espaco -> pasta -> lista: o MENOR nivel entre os nos '
  'fechados dela, `manage` quando nenhum esta fechado, e nulo quando algum '
  'fechado nao tem concessao para esta pessoa. Nao consulta a empresa — quem '
  'faz aquela pergunta e `reaches_company`, e ela vem antes.';

-- A corrente, para quem esta agindo agora, ja com a empresa na frente.
create or replace function ideworks.chain_level(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when not ideworks.reaches_company(p_space_id) then null
           else ideworks.chain_ceiling_for(
                  ideworks.acting_user_id(), ideworks.acting_is_superadmin(),
                  p_space_id, p_folder_id, p_list_id)
         end
$fn$;

comment on function ideworks.chain_level(uuid, uuid, uuid) is
  'O nivel efetivo numa corrente informada por inteiro: primeiro a EMPRESA, '
  'depois o teto dos nos. As politicas de `folders` e `lists` chamam esta versao '
  'porque elas ja tem as tres colunas em maos — inclusive no `insert`, em que a '
  'linha nova ainda nao existe para ser consultada (a razao medida na F17.2b).';

create or replace function ideworks.can_act_on_chain(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid,
  p_min ideworks.access_level)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.chain_level(p_space_id, p_folder_id, p_list_id) >= p_min
$fn$;

comment on function ideworks.can_act_on_chain(uuid, uuid, uuid, ideworks.access_level) is
  'A porta booleana de `chain_level`: o nivel da corrente chega ao exigido? Nivel '
  'nulo devolve nulo, e nulo nega.';

-- --- o mesmo, pelo NO de tres niveis ------------------------------------------
-- `owner_space` da F17.2 ja traduz dono -> espaco. Aqui falta so a pasta, e a
-- corrente fica completa.
--
-- No inexistente devolve nulo, e nao `manage`: regra 3 do roteiro — o
-- desconhecido recusa, nao passa calado.
create or replace function ideworks.node_ceiling(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when ideworks.owner_space(p_space_id, p_folder_id, p_list_id) is null
             then null
           else ideworks.chain_ceiling_for(
                  ideworks.acting_user_id(),
                  ideworks.acting_is_superadmin(),
                  ideworks.owner_space(p_space_id, p_folder_id, p_list_id),
                  coalesce(p_folder_id,
                           (select l.folder_id from ideworks.lists l
                             where l.id = p_list_id)),
                  p_list_id)
         end
$fn$;

comment on function ideworks.node_ceiling(uuid, uuid, uuid) is
  'O teto de um no de tres niveis — espaco, pasta OU lista —, com a corrente '
  'resolvida a partir dele. Sem a empresa: e o que a uniao da F17.3 precisa para '
  'aplicar o teto ao caminho do CLIENTE.';

create or replace function ideworks.node_level(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when not ideworks.reaches_company(
                     ideworks.owner_space(p_space_id, p_folder_id, p_list_id))
             then null
           else ideworks.node_ceiling(p_space_id, p_folder_id, p_list_id)
         end
$fn$;

comment on function ideworks.node_level(uuid, uuid, uuid) is
  'O nivel efetivo de um no de tres niveis: a EMPRESA primeiro, o teto da '
  'corrente depois. E a funcao que `can_write_owner` passou a consultar, e por '
  'isso as esteiras herdaram a camada nova sem uma segunda regra.';

-- --- as tres perguntas de alcance, reescritas ---------------------------------
-- `can_see_space` mantem nome, assinatura e todos os chamadores. O que muda e
-- que a resposta agora tem duas metades — empresa e teto —, e a segunda vale
-- `manage` enquanto nada estiver fechado. Com o banco de hoje ela devolve
-- exatamente o que devolvia.
create or replace function ideworks.can_see_space(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.chain_level(target, null, null) is not null
$fn$;

comment on function ideworks.can_see_space(uuid) is
  'A regra de alcance do quadro, num lugar so: a EMPRESA (client_categories via '
  'user_categories, como a F14 separa Ide de Alma9) e, dentro dela, o teto do no. '
  'Enquanto nada esta fechado o teto e o maximo e a resposta e a mesma de sempre.';

-- A pasta ganha pergunta propria. Ate aqui `folders_select` perguntava pelo
-- ESPACO, e com pasta fechada isso deixaria a pasta a vista de quem nao a
-- alcanca — o caso Loja X / Loja Y, que e o pedido inteiro desta etapa.
create or replace function ideworks.can_see_folder(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_level(null, target, null) is not null
$fn$;

comment on function ideworks.can_see_folder(uuid) is
  'O alcance da pasta: a empresa do espaco dela e o teto da corrente ate ela. '
  'Antes da F17.23 a pasta nao tinha pergunta propria — herdava a do espaco.';

create or replace function ideworks.can_see_list(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_level(null, null, target) is not null
$fn$;

comment on function ideworks.can_see_list(uuid) is
  'O alcance da lista: o do espaco dela, agora estreitado pelo teto da pasta e '
  'da propria lista. Continua sendo a mesma regra em um lugar so — anexo, link '
  'e comentario herdam por meio da tarefa, sem politica propria.';

-- A UNIAO DA F17.3 CONTINUA INTEIRA, E O TETO PASSA POR CIMA DELA.
--
-- A primeira linha e a de antes, sem uma virgula de diferenca: enxerga quem
-- enxerga a LISTA; quando ha CLIENTE, o alcance do cliente tambem vale.
--
-- A segunda e o teto. Ela existe porque a restricao de no e um ATO DELIBERADO
-- de fechar, e nenhuma porta implicita pode reabrir o que alguem fechou de
-- proposito. Sem ela, "restringir a pasta X ao funcionario A" seria mentira
-- para todo B que tivesse aquele cliente na carteira.
--
-- Com nada fechado, `node_ceiling` de uma lista real vale `manage`, a segunda
-- linha e sempre verdadeira, e a funcao responde o que respondia. Provado par a
-- par sobre as 24 tarefas reais.
create or replace function ideworks.can_reach_task(p_list_id uuid, p_client_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ((p_list_id   is not null and ideworks.can_see_list(p_list_id))
       or (p_client_id is not null and ideworks.can_see_client(p_client_id)))
     and (p_list_id is null
          or ideworks.node_ceiling(null, null, p_list_id) is not null)
$fn$;

comment on function ideworks.can_reach_task(uuid, uuid) is
  'A regra de alcance da tarefa, num lugar so: enxerga quem enxerga a LISTA '
  'dela; quando ela tem CLIENTE, o alcance do cliente tambem vale. Uniao, e nao '
  'intersecao — recusar o segundo caminho esconderia trabalho de quem o faz. A '
  'restricao de no e um TETO sobre as duas portas, e nao uma terceira porta.';

-- --- as mesmas perguntas, com nivel -------------------------------------------
-- Uma tarefa sem lista nao tem no, e portanto nao tem teto: e a demanda do
-- Pilar A′, que pertence ao cliente e a quadro nenhum. `p_list_id is null`
-- responde `true` e a autoridade dela continua sendo a de sempre.
create or replace function ideworks.can_act_on_task(
  p_list_id uuid, p_client_id uuid, p_min ideworks.access_level)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_reach_task(p_list_id, p_client_id)
     and (p_list_id is null
          or ideworks.node_ceiling(null, null, p_list_id) >= p_min)
$fn$;

comment on function ideworks.can_act_on_task(uuid, uuid, ideworks.access_level) is
  'Alcanca a tarefa E chega ao nivel exigido. Tarefa sem lista nao tem no, logo '
  'nao tem teto: a demanda do Pilar A continua como estava.';

-- A mesma regra alcancada pelo id, que e o que as tabelas satelite tem em maos.
-- `security definer` para a busca ser FACTUAL: sob a politica de quem escreve,
-- uma tarefa fora do alcance sumiria da consulta e a resposta viraria "nao
-- existe" em vez de "nao pode".
create or replace function ideworks.can_act_on_task_id(
  target uuid, p_min ideworks.access_level)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_act_on_task(t.list_id, t.client_id, p_min)
    from ideworks.tasks t
   where t.id = target
$fn$;

comment on function ideworks.can_act_on_task_id(uuid, ideworks.access_level) is
  'A regra de `can_act_on_task` alcancada pelo id da tarefa. Tarefa inexistente '
  'devolve nulo, e nulo nega.';

create or replace function ideworks.can_act_on_checklist(
  target uuid, p_min ideworks.access_level)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_act_on_task_id(k.task_id, p_min)
    from ideworks.task_checklists k
   where k.id = target
$fn$;

comment on function ideworks.can_act_on_checklist(uuid, ideworks.access_level) is
  'O nivel na tarefa dona do checklist. Par de `can_reach_checklist`, que segue '
  'sendo o alcance puro usado pelos `select`.';

-- --- a esteira, e o dono dela -------------------------------------------------
-- `can_see_status_set` deixa de perguntar so pelo ESPACO e passa a perguntar
-- pelo NO dono. Sem isso, quem nao alcanca uma pasta fechada continuaria lendo a
-- esteira dela — e `statuses_select`, que depende desta funcao, junto.
create or replace function ideworks.can_see_status_set(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_level(ss.space_id, ss.folder_id, ss.list_id) is not null
    from ideworks.status_sets ss
   where ss.id = target
$fn$;

comment on function ideworks.can_see_status_set(uuid) is
  'O alcance da esteira e o alcance do NO dela — espaco, pasta ou lista —, e nao '
  'uma segunda regra. Os status usam esta funcao para nao ter politica propria.';

-- A REGRA DO TETO, NO SEU CASO MAIS DELICADO.
--
-- A primeira linha nao muda: esteira de ESPACO continua sendo escrita de
-- administrador do sistema. E a decisao da F17.2b, e mante-la e o que garante
-- que `manage` num espaco nao GANHE poder nenhum que nao existia — ele passa a
-- dar acesso a outros e a mexer nas esteiras das pastas e listas dali, e nada
-- alem disso.
--
-- A segunda troca `can_see_space(owner_space(...))` por `node_level(...) >=
-- 'manage'`. Com nada fechado as duas sao a mesma coisa: o teto de um no aberto
-- E `manage`. Com a pasta fechada, quem tem `view` ou `execute` ali para de
-- reescrever a esteira dela — que e exatamente o que o usuario pediu.
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
  'Quem escreve numa coisa de tres niveis: espaco e so administrador do sistema; '
  'pasta e lista sao de quem tem `manage` no no. Enquanto nada esta fechado o '
  'teto e `manage` e a resposta e a mesma da F17.2b.';

-- --- quem concede -------------------------------------------------------------
-- Tres caminhos, e o terceiro exige concessao EXPLICITA. Ver a nota longa do
-- cabecalho: teto e autoridade sao coisas diferentes, e so a segunda abre porta.
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
  'Quem fecha um no e quem da acesso nele: administrador do sistema, quem criou '
  'o no, ou quem tem `manage` EXPLICITO nele ou num ancestral. O teto implicito '
  'de um no aberto NAO conta aqui — senao qualquer funcionario poderia fechar um '
  'espaco e trancar os colegas.';

-- --- a seguranca por linha das duas tabelas novas -----------------------------
alter table ideworks.node_restrictions enable row level security;
alter table ideworks.node_grants       enable row level security;

-- Ler quem alcanca o no e parte de trabalhar nele: sem isso a tela do acesso
-- mostraria uma lista vazia para quem tem todo o direito de ve-la. Escrever e
-- so de quem concede.
create policy node_restrictions_select on ideworks.node_restrictions for select
  using (ideworks.node_level(space_id, folder_id, list_id) is not null);
create policy node_restrictions_write on ideworks.node_restrictions for all
  using      (ideworks.can_grant_on(space_id, folder_id, list_id))
  with check (ideworks.can_grant_on(space_id, folder_id, list_id));

create policy node_grants_select on ideworks.node_grants for select
  using (user_id = ideworks.acting_user_id()
         or ideworks.node_level(space_id, folder_id, list_id) is not null);
create policy node_grants_write on ideworks.node_grants for all
  using      (ideworks.can_grant_on(space_id, folder_id, list_id))
  with check (ideworks.can_grant_on(space_id, folder_id, list_id));

-- --- as politicas que passam a carregar o nivel -------------------------------
-- ONZE POLITICAS DE ESCRITA MUDAM DE TEXTO, E NENHUMA MUDA DE COMPORTAMENTO
-- HOJE: com nada fechado, `chain_level` e `node_level` valem `manage`, que e o
-- topo, e todo `>=` e verdadeiro. O `select` de cada tabela continua exigindo
-- so alcance.
--
-- A expressao nao e copiada para dentro de nenhuma delas. Onze copias de uma
-- regra de acesso e a divida 8.1 do legado onze vezes.

-- Espaco: `spaces_select` nao muda de texto — `can_see_space` e que ficou com
-- duas metades. `spaces_write` tambem nao muda: criar, renomear e arquivar
-- espaco segue sendo do administrador do sistema (F17.1).

-- Pasta: o `select` passa a perguntar pela PASTA, e nao pelo espaco dela. E a
-- unica forma de a pasta fechada sumir da arvore de quem nao a alcanca.
drop policy if exists folders_select on ideworks.folders;
create policy folders_select on ideworks.folders for select
  using (ideworks.can_see_folder(id));

-- Escrever pasta e `create`. No `insert` a linha nova ainda nao existe para ser
-- consultada por id — a razao medida na F17.2b —, entao a corrente vai pelas
-- COLUNAS: o espaco da linha, mais o proprio `id`, que so encontra restricao
-- quando a pasta ja existe.
drop policy if exists folders_write on ideworks.folders;
create policy folders_write on ideworks.folders for all
  using      (ideworks.can_act_on_chain(space_id, id, null, 'create'))
  with check (ideworks.can_act_on_chain(space_id, id, null, 'create'));

-- Lista: mesma forma, com a pasta no meio da corrente.
drop policy if exists lists_select on ideworks.lists;
create policy lists_select on ideworks.lists for select
  using (ideworks.can_act_on_chain(space_id, folder_id, id, 'view'));

drop policy if exists lists_write on ideworks.lists;
create policy lists_write on ideworks.lists for all
  using      (ideworks.can_act_on_chain(space_id, folder_id, id, 'create'))
  with check (ideworks.can_act_on_chain(space_id, folder_id, id, 'create'));

-- Tarefa: ler e `view`, mexer e `execute`, criar e apagar sao `create`.
-- No `update`, `using` julga a linha ANTIGA e `with check` a NOVA — entao tirar
-- uma tarefa de uma lista onde se tem `execute` para uma onde nao se tem e
-- recusado, e vice-versa, sem caso especial.
drop policy if exists tasks_insert on ideworks.tasks;
create policy tasks_insert on ideworks.tasks for insert
  with check (ideworks.can_act_on_task(list_id, client_id, 'create'));

drop policy if exists tasks_update on ideworks.tasks;
create policy tasks_update on ideworks.tasks for update
  using      (ideworks.can_act_on_task(list_id, client_id, 'execute'))
  with check (ideworks.can_act_on_task(list_id, client_id, 'execute'));

drop policy if exists tasks_delete on ideworks.tasks;
create policy tasks_delete on ideworks.tasks for delete
  using (ideworks.can_act_on_task(list_id, client_id, 'create'));

-- As satelites da tarefa. Todas elas SAO a tarefa vista de outro angulo —
-- responsavel, observador, etiqueta, comentario, anexo, link, passo, checklist
-- —, e mexer nelas e `execute`: e o que o usuario chamou de "cumprir".
drop policy if exists task_assignees_write on ideworks.task_assignees;
create policy task_assignees_write on ideworks.task_assignees for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'));

drop policy if exists task_watchers_write on ideworks.task_watchers;
create policy task_watchers_write on ideworks.task_watchers for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'));

drop policy if exists task_tag_assignments_write on ideworks.task_tag_assignments;
create policy task_tag_assignments_write on ideworks.task_tag_assignments for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'));

drop policy if exists task_attachments_write on ideworks.task_attachments;
create policy task_attachments_write on ideworks.task_attachments for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'));

drop policy if exists task_links_write on ideworks.task_links;
create policy task_links_write on ideworks.task_links for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'));

drop policy if exists task_checklists_write on ideworks.task_checklists;
create policy task_checklists_write on ideworks.task_checklists for all
  using      (ideworks.can_act_on_task_id(task_id, 'execute'))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'));

drop policy if exists checklist_items_write on ideworks.checklist_items;
create policy checklist_items_write on ideworks.checklist_items for all
  using      (ideworks.can_act_on_checklist(checklist_id, 'execute'))
  with check (ideworks.can_act_on_checklist(checklist_id, 'execute'));

-- O comentario mantem a segunda metade que a F17.6 lhe deu: so o autor edita e
-- apaga o proprio. O que entra e o nivel.
drop policy if exists task_comments_insert on ideworks.task_comments;
create policy task_comments_insert on ideworks.task_comments for insert
  with check (ideworks.can_act_on_task_id(task_id, 'execute')
              and author_id = ideworks.acting_user_id());

drop policy if exists task_comments_update on ideworks.task_comments;
create policy task_comments_update on ideworks.task_comments for update
  using      (ideworks.can_act_on_task_id(task_id, 'execute')
              and author_id = ideworks.acting_user_id())
  with check (ideworks.can_act_on_task_id(task_id, 'execute')
              and author_id = ideworks.acting_user_id());

drop policy if exists task_comments_delete on ideworks.task_comments;
create policy task_comments_delete on ideworks.task_comments for delete
  using (ideworks.can_act_on_task_id(task_id, 'execute')
         and author_id = ideworks.acting_user_id());

-- O catalogo de etiquetas vive no espaco e e estrutura: `create`. Ler continua
-- sendo alcance puro, porque a etiqueta aparece na tarefa de quem so ve.
drop policy if exists task_tags_select on ideworks.task_tags;
create policy task_tags_select on ideworks.task_tags for select
  using (ideworks.can_see_space(space_id));

drop policy if exists task_tags_write on ideworks.task_tags;
create policy task_tags_write on ideworks.task_tags for all
  using      (ideworks.can_act_on_chain(space_id, null, null, 'create'))
  with check (ideworks.can_act_on_chain(space_id, null, null, 'create'));

-- A esteira: `status_sets_select` passa a usar a mesma funcao que
-- `statuses_select` — uma regra, e nao duas com o mesmo nome. As duas de
-- escrita nao mudam de texto: `can_write_owner` e que ficou com o teto dentro.
drop policy if exists status_sets_select on ideworks.status_sets;
create policy status_sets_select on ideworks.status_sets for select
  using (ideworks.can_see_status_set(id));

-- --- as funcoes de acao que rodam como o dono ---------------------------------
-- ELAS NAO PASSAM PELA POLITICA DE LINHA, e por isso o nivel precisa entrar
-- dentro delas. Sete funcoes, uma linha cada: a condicao de alcance vira a
-- condicao de alcance MAIS nivel. Nada mais muda em nenhuma.
--
-- As de `security invoker` — `move_task`, `post_task_comment`,
-- `edit_task_comment`, `add_task_link`, `create_status_set`, `set_list_workflow`
-- — ficam como estao: elas ja escrevem sob a politica, e a politica ja carrega
-- o nivel. Toca-las seria a segunda regra.

create or replace function ideworks.complete_task(p_task_id uuid, p_by uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks t
     set status_id    = case
                          when t.list_id is null then t.status_id
                          else coalesce(
                                 ideworks.closing_status(
                                   ideworks.resolve_status_set(t.list_id)),
                                 t.status_id)
                        end,
         completed_at = coalesce(t.completed_at, now()),
         completed_by = coalesce(t.completed_by, p_by),
         updated_at   = now()
   where t.id = p_task_id
     and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute');

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.uncomplete_task(p_task_id uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  -- Desmarcar num quadro devolve a tarefa ao comeco da esteira. Deixa-la no
  -- status que fecha com `completed_at` nulo criaria a tarefa "concluida na
  -- coluna, nao concluida na ficha" — a contradicao que este desenho evita.
  update ideworks.tasks t
     set status_id    = case
                          when t.list_id is null then t.status_id
                          else coalesce(
                                 ideworks.first_open_status(
                                   ideworks.resolve_status_set(t.list_id)),
                                 t.status_id)
                        end,
         completed_at = null,
         completed_by = null,
         updated_at   = now()
   where t.id = p_task_id
     and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute');

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

-- ARQUIVAR EXIGE `create`, E NAO `execute`. Nesta casa arquivar E o apagar:
-- `archived_at` existe justamente para nao se destruir nada. "Nao cria, nao
-- apaga" e a definicao do nivel `execute`, entao arquivar fica do lado de la.
create or replace function ideworks.set_task_archived(p_task_id uuid, p_archived boolean)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks t
     set archived_at = case when p_archived then coalesce(t.archived_at, now()) else null end,
         updated_at  = now()
   where t.id = p_task_id
     and ideworks.can_act_on_task(t.list_id, t.client_id, 'create');

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id
       and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
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
  'tarefa a quem nao entra no sistema e atribuir a ninguem. Responsavel '
  'desativado continua na tarefa — historico nao se reescreve.';

create or replace function ideworks.set_task_tags(p_task_id uuid, p_tag_ids uuid[])
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id
       and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.task_tag_assignments where task_id = p_task_id;

  -- `group by` em vez de `distinct on`: a tela pode mandar id repetido, e a
  -- chave primaria recusaria com uma mensagem que ninguem entende.
  insert into ideworks.task_tag_assignments (task_id, tag_id)
  select p_task_id, g
    from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as g
   where exists (select 1 from ideworks.task_tags tg where tg.id = g)
   group by g;
end;
$fn$;

create or replace function ideworks.set_task_watchers(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id
       and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.task_watchers where task_id = p_task_id;

  insert into ideworks.task_watchers (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;
end;
$fn$;

create or replace function ideworks.set_checklist_item_resolved(
  p_item_id  uuid,
  p_resolved boolean)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  update ideworks.checklist_items i
     set resolved_at = case
                         when p_resolved then coalesce(i.resolved_at, now())
                         else null
                       end,
         updated_at  = now()
   where i.id = p_item_id
     and ideworks.can_act_on_checklist(i.checklist_id, 'execute');

  if not found then
    raise exception 'item de checklist nao encontrado ou fora do seu alcance'
      using errcode = '42501';
  end if;
end;
$fn$;

-- --- a tela do acesso ---------------------------------------------------------
-- O QUE A TELA PRECISA SABER, NUMA CHAMADA SO: o no esta fechado? quem tem
-- concessao nele? quem alcanca de verdade, contando a corrente inteira? e eu
-- posso mexer nisso?
--
-- `quem alcanca` e a resposta que impede a tela de mentir. Sem ela a pessoa
-- veria "concedido a A e B" numa lista dentro de uma pasta fechada onde B nao
-- entra, e acreditaria que B entra.
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

-- --- fechar, abrir e conceder, numa operacao so (regra 9) ---------------------
-- Fechar o no e dizer quem entra sao a MESMA decisao: feitas em dois comandos,
-- uma falha no meio deixaria o no fechado sem ninguem dentro — trabalho de
-- gente de verdade sumindo da tela sem que ninguem tenha pedido isso.
--
-- ⚠️ QUEM FECHA ENTRA. Se quem restringe nao administra o sistema e nao esta na
-- lista, ele e acrescentado com `manage`. Sem esta linha, o primeiro uso desta
-- funcao trancaria o proprio autor para fora do que ele acabou de fechar — e
-- ele nem poderia desfazer, porque `can_grant_on` exige alcance.
create or replace function ideworks.set_node_access(
  p_space_id   uuid,
  p_folder_id  uuid,
  p_list_id    uuid,
  p_restricted boolean,
  p_grants     jsonb default '[]'::jsonb)
  returns jsonb
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_ator uuid := ideworks.acting_user_id();
begin
  if num_nonnulls(p_space_id, p_folder_id, p_list_id) <> 1 then
    raise exception 'informe exatamente um no: espaco, pasta ou lista'
      using errcode = '22023';
  end if;

  if not ideworks.can_grant_on(p_space_id, p_folder_id, p_list_id) then
    raise exception
      'so quem administra o sistema, quem criou isto ou quem recebeu o nivel de administrar aqui pode mudar o acesso'
      using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_grants, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'a lista de pessoas veio num formato que nao e uma lista'
      using errcode = '22023';
  end if;

  -- --- a lista de pessoas, trocada por inteiro -------------------------------
  delete from ideworks.node_grants g
   where g.space_id is not distinct from p_space_id
     and g.folder_id is not distinct from p_folder_id
     and g.list_id is not distinct from p_list_id;

  -- Quem nao tem perfil no IDE Works e ignorado, pela mesma razao de
  -- `set_task_assignees`: dar acesso a quem nao entra no sistema e dar a
  -- ninguem. `group by` porque a tela pode mandar a mesma pessoa duas vezes.
  insert into ideworks.node_grants (space_id, folder_id, list_id, user_id, level, granted_by)
  select p_space_id, p_folder_id, p_list_id,
         (e.value ->> 'userId')::uuid,
         coalesce(nullif(btrim(e.value ->> 'level'), ''), 'execute')::ideworks.access_level,
         v_ator
    from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) e
   where exists (select 1 from ideworks.profiles p
                  where p.id = (e.value ->> 'userId')::uuid)
   group by (e.value ->> 'userId')::uuid,
            coalesce(nullif(btrim(e.value ->> 'level'), ''), 'execute');

  -- --- a parede -------------------------------------------------------------
  if coalesce(p_restricted, false) then
    insert into ideworks.node_restrictions (space_id, folder_id, list_id, restricted_by)
    values (p_space_id, p_folder_id, p_list_id, v_ator)
    on conflict do nothing;

    -- ⚠️ Ver a nota do cabecalho: quem fecha entra.
    if not ideworks.acting_is_superadmin() and v_ator is not null then
      insert into ideworks.node_grants (space_id, folder_id, list_id, user_id, level, granted_by)
      select p_space_id, p_folder_id, p_list_id, v_ator,
             'manage'::ideworks.access_level, v_ator
       where exists (select 1 from ideworks.profiles p where p.id = v_ator)
      on conflict do nothing;
    end if;
  else
    -- Abrir e apagar a parede. As concessoes ficam: elas nao dao nada em no
    -- aberto (o teto ja e o maximo) e sobrevivem para o dia em que alguem
    -- fechar de novo — perde-las aqui obrigaria a refazer a lista inteira a
    -- cada abre-e-fecha.
    delete from ideworks.node_restrictions r
     where r.space_id is not distinct from p_space_id
       and r.folder_id is not distinct from p_folder_id
       and r.list_id is not distinct from p_list_id;
  end if;

  return ideworks.node_access(p_space_id, p_folder_id, p_list_id);
end;
$fn$;

comment on function ideworks.set_node_access(uuid, uuid, uuid, boolean, jsonb) is
  'Fecha ou abre um no e troca a lista de quem alcanca, em bloco (regra 9). Quem '
  'fecha entra na lista com o nivel de administrar, para nao se trancar do lado '
  'de fora. Abrir apaga a parede e PRESERVA as concessoes: em no aberto elas nao '
  'dao nada, e existem para o dia em que alguem fechar de novo.';

-- --- permissoes ---------------------------------------------------------------
-- Expressao de politica roda com os poderes de quem consulta: sem `execute`, o
-- papel do app bateria em "permission denied for function" em vez de bater na
-- regra.
grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.reaches_company_for(uuid, boolean, uuid)                       to ideworks_app;
grant execute on function ideworks.reaches_company(uuid)                                          to ideworks_app;
grant execute on function ideworks.chain_ceiling_for(uuid, boolean, uuid, uuid, uuid)             to ideworks_app;
grant execute on function ideworks.chain_level(uuid, uuid, uuid)                                  to ideworks_app;
grant execute on function ideworks.can_act_on_chain(uuid, uuid, uuid, ideworks.access_level)      to ideworks_app;
grant execute on function ideworks.node_ceiling(uuid, uuid, uuid)                                 to ideworks_app;
grant execute on function ideworks.node_level(uuid, uuid, uuid)                                   to ideworks_app;
grant execute on function ideworks.can_see_folder(uuid)                                           to ideworks_app;
grant execute on function ideworks.can_act_on_task(uuid, uuid, ideworks.access_level)             to ideworks_app;
grant execute on function ideworks.can_act_on_task_id(uuid, ideworks.access_level)                to ideworks_app;
grant execute on function ideworks.can_act_on_checklist(uuid, ideworks.access_level)              to ideworks_app;
grant execute on function ideworks.can_grant_on(uuid, uuid, uuid)                                 to ideworks_app;
grant execute on function ideworks.node_access(uuid, uuid, uuid)                                  to ideworks_app;
grant execute on function ideworks.set_node_access(uuid, uuid, uuid, boolean, jsonb)              to ideworks_app;

-- --- a conferencia que roda ANTES de a migration terminar ---------------------
-- Regra 3 do roteiro: falhar aqui e falhar agora, e nao semanas depois numa tela
-- vazia. Esta etapa sai com o sistema EXATAMENTE tao aberto quanto entrou, e
-- estas duas contas provam a metade que cabe dentro da propria migration — a
-- outra metade, par a par sobre perfil x no, e `scripts/provar-acesso-por-no.mjs`.
do $$
declare
  v_paredes integer;
  v_dados   integer;
begin
  select count(*) into v_paredes from ideworks.node_restrictions;
  select count(*) into v_dados   from ideworks.node_grants;

  if v_paredes <> 0 or v_dados <> 0 then
    raise exception
      'a F17.23 nao pode nascer com no fechado nem com concessao: achei % parede(s) e % concessao(oes). Nada foi gravado.',
      v_paredes, v_dados;
  end if;
end $$;
