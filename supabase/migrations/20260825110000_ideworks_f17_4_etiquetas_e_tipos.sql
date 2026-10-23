-- =============================================================================
-- IDE WORKS — F17.4  Etiquetas e tipos de tarefa
-- =============================================================================
-- O QUE FOI MEDIDO NO CLICKUP ANTES DE ESCREVER UMA LINHA — 2026-08-25
--   Leitura direta dos spaces `AGÊNCIA IDE` (900000000001) e `ALMA 9`
--   (900000000002) pelo conector, SOMENTE LEITURA.
--
--   ETIQUETAS REAIS — e são CINCO, não três:
--
--     etiqueta    tag_bg     tag_fg     onde apareceu
--     --------    -------    -------    ---------------------------------------
--     arte        #A18072    #A18072    Valentini, Jatobá, ATENDIMENTO, ...
--     video       #AB4ABA    #AB4ABA    Estúdio Ide, Nova Imóveis, ...
--     roteiros    #0091ff    #edadc8    Jatobá
--     banners     #152982    #152982    17 tarefas — Valentini, Charme, ...
--     stories     #000       #000       Valentini (junto com `banners`)
--
--   O plano da F17 registrou "três reais". A medição de hoje achou mais duas,
--   e as duas mudam o desenho:
--
--     · `banners` e `stories` APARECEM JUNTAS na mesma tarefa (86aaaaaa1), e
--       `banners` aparece junto com `arte` (86aaaaaa2). A tarefa carrega
--       VÁRIAS etiquetas — o vínculo é tabela própria, não coluna.
--     · `stories` tem cor `#000`. QUATRO caracteres, não sete. Uma restrição
--       `check (bg_color ~ '^#[0-9a-fA-F]{6}$')` seria bonita e RECUSARIA UMA
--       ETIQUETA REAL na primeira rodada da importação. Por isso a cor entra
--       sem formato obrigatório, exatamente como `statuses.color` da F17.2.
--     · `arte` é `#A18072` (maiúsculas) e `roteiros` é `#0091ff`
--       (minúsculas). A origem não normaliza; a réplica também não.
--
--   `arte`, `video`, `banners` e `stories` têm fundo e frente IGUAIS; `roteiros`
--   tem DIFERENTES. Duas colunas, não uma — com uma só, `roteiros` perderia
--   metade da cor em silêncio.
--
--   A SUJEIRA: a etiqueta de nome literal `[]`, cor `#304ffe`, resíduo da
--   importação do Trello. Medida hoje: a primeira página do filtro por essa
--   etiqueta veio CHEIA — 100 tarefas — e com `has_more: true`. São centenas,
--   espalhadas por listas de cliente de verdade (`Delicato (vídeos)`, `FOCUS
--   Ribeirão (Vídeos)`, `Cursos`, `Alma9 (projetos)`).
--
--   TIPOS DE TAREFA — os três números, confirmados um a um:
--     custom_item_id 0 ...... `task_type` vem NULL   (86aaaaaa3, 86aaaaaa4)
--     custom_item_id 1001 ... `task_type` = "Task"   (86aaaaaa5)
--     custom_item_id 1002 ... `task_type` = "Client" (86aaaaaa2, 86aaaaaa1)
--
-- O QUE FOI MEDIDO NO IDE WORKS
--   ideworks.tasks .................... 18 linhas, 0 sem lista
--     com `custom_item_id` preenchido .. 0 de 18
--   ideworks.spaces ................... 2      ideworks.lists ......... 2
--   ideworks.client_tags .............. 31     atribuições a cliente ... 94
--
--   Zero tarefa com tipo hoje: o número da F17.3 existe e ainda não foi usado.
--   É a folga que permite decidir a integridade dele agora, sem migrar dado.
--
-- ================================ A DÍVIDA DA F17.3 QUE VENCE NESTA ETAPA ====
--   A F17.3 criou `tasks.custom_item_id integer` sem integridade referencial e
--   declarou: "até lá o número não tem integridade referencial — e um `check`
--   com os três valores medidos (0, 1001, 1002) mataria a importação no
--   primeiro tipo customizado novo". Este é o "até lá".
--
--   A DECISÃO: `custom_item_id` NÃO GANHA CHAVE ESTRANGEIRA. A ligação com o
--   catálogo é uma FUNÇÃO de resolução (`resolve_task_type`) e uma VIEW que
--   diz, por tarefa, se o tipo dela está catalogado. Três razões, nesta ordem:
--
--   1. A CHAVE SIMPLES É IMPOSSÍVEL, E A COMPOSTA CUSTARIA UMA SEGUNDA VERDADE.
--      O tipo vive no ESPAÇO, e o mesmo número existe em espaços diferentes —
--      1001 é `Task` na AGÊNCIA IDE e pode ser `Task` no ALMA 9, em duas linhas
--      de catálogo distintas. O que é único é o PAR (espaço, número), então uma
--      chave estrangeira precisaria de `(space_id, custom_item_id)` na tarefa.
--      Mas a tarefa não tem espaço: ela tem LISTA, e o espaço se deriva dela
--      (`lists.space_id`). Gravar `tasks.space_id` só para a chave fechar seria
--      a mesma coluna derivada que a dívida 1 do legado produz — e ela ficaria
--      DESATUALIZADA no primeiro `move_task` que trocasse de espaço.
--
--   2. A TAREFA PODE NÃO TER ESPAÇO NENHUM. `list_id` é anulável desde a F17.3:
--      a demanda do Pilar A′ pertence ao cliente e a quadro nenhum. Uma tarefa
--      assim não tem espaço, logo não tem catálogo a que apontar. Chave
--      obrigatória a proibiria de existir; chave anulável não provaria nada.
--
--   3. A DECISÃO D21 MANDA COPIAR O QUE JÁ EXISTE. A F17.11 vai importar tipos
--      que ninguém previu — a equipe cria um tipo novo no ClickUp em dois
--      cliques. Com chave estrangeira, a primeira tarefa de um tipo ainda não
--      catalogado FARIA A IMPORTAÇÃO MORRER. É o mesmo argumento que a F17.3 já
--      usou para recusar o `check`, e ele não mudou por existir catálogo.
--
--   ENTÃO A DÍVIDA NÃO FICA ABERTA — ELA TROCA DE INSTRUMENTO. O que uma chave
--   estrangeira daria era "impossível apontar para tipo inexistente". O que esta
--   etapa dá no lugar é "SEMPRE DÁ PARA SABER quem aponta para tipo inexistente":
--   a view `ideworks.task_labels` traz `task_type_missing` por tarefa, e é ela
--   que a F17.11 vai ler para RELATAR — que é o que a D21 pede — em vez de
--   recusar. Restrição que mata a importação não é integridade, é aposta.
--
-- ================================================= AS DUAS ETIQUETAS DO MUNDO =
--   A F2.4 já tem `client_tags` + `client_tag_assignments`. Elas NÃO servem, e
--   reaproveitá-las seria forçar duas coisas diferentes na mesma tabela:
--
--     `client_tags`                        `task_tags` (esta etapa)
--     ---------------------------------    -----------------------------------
--     etiqueta o CLIENTE                   etiqueta a TAREFA
--     UMA cor (`color`, default #6b7280)   DUAS (fundo e frente, medidas)
--     GLOBAL — sem dono nenhum             do ESPAÇO
--     única por `lower(name)` no sistema   única por `(espaço, nome)`
--     escrita só de administrador          escrita de quem alcança o espaço
--     31 linhas, 94 atribuições, em uso    nasce vazia
--
--   A linha do meio é a que decide: com `client_tags`, `arte` da AGÊNCIA IDE e
--   `arte` do ALMA 9 seriam A MESMA LINHA — recolorir uma recoloriria a outra,
--   e apagar uma apagaria as duas. Duas agências que o plano decidiu não
--   unificar passariam a compartilhar catálogo por acidente de modelagem.
--
--   Nada de `client_tags` é tocado por esta migration.
--
-- ============================ A ETIQUETA `[]` NÃO NASCE DE NOVO, E POR QUÊ ====
--   `task_tags_name_is_a_name` recusa nome em branco e nome só de pontuação.
--   A regra mora em UMA função — `is_meaningful_name` — porque duas tabelas a
--   usam e duas cópias divergiriam no primeiro ajuste.
--
--   A REGRA FOI ESCOLHIDA POR MEDIÇÃO, não por gosto. Duas candidatas foram
--   passadas por uma bateria de 24 nomes:
--
--     A) "não pode ser só pontuação e espaço"  btrim(n) !~ '^[[:punct:][:space:]]+$'
--     B) "tem que ter letra ou dígito"         n ~ '[[:alnum:]]'
--
--   As duas recusam os DOZE casos de sujeira, iguaizinhas: '', '   ', só
--   tabulação, '[]', '  []  ', '---', '...', '()', '#', '?!', '«»' e o travessão
--   '—'. As duas aceitam os nomes reais, com acento e tudo: `vídeo`, `ação`,
--   `publicar/agendar`, `C++`, `3`, e as cinco etiquetas medidas.
--
--   ELAS DIVERGEM EM UM CASO SÓ: a etiqueta cujo nome é UM EMOJI. A regra B a
--   recusa (emoji não é alfanumérico); a regra A a aceita. Emoji é nome que
--   gente escolhe de propósito, e recusá-lo seria a réplica sendo mais severa
--   que a origem — então vale a regra A. Medido, não suposto.
--
--   A RECUSA VALE PARA ESCRITA NOVA, E É O QUE FORÇA A F17.11 A RELATAR. A
--   decisão D21 manda copiar o ClickUp como está — e é exatamente por isso que
--   a restrição precisa existir aqui: com ela, o importador NÃO CONSEGUE criar
--   a `[]` em silêncio; ou ele a relata como suspeita, ou ele para. Sem ela, as
--   centenas de tarefas sujas atravessariam para o sistema novo sem que ninguém
--   ficasse sabendo. A restrição é o que transforma "copiar como está" em
--   "copiar como está E DIZER o que veio torto".
--
-- ============================== ETIQUETA DE OUTRO ESPAÇO É RECUSADA ===========
--   No ClickUp a etiqueta pertence ao espaço e só é oferecida às tarefas dele —
--   uma etiqueta de outro espaço simplesmente não aparece na lista de escolha.
--   Permitir aqui criaria um estado que a ORIGEM NÃO SABE PRODUZIR e que a
--   F17.11 nunca conseguiria importar: a réplica divergiria da coisa replicada.
--
--   E o preço seria concreto, não teórico. `task_tags` se lê por
--   `can_see_space`; o vínculo se lê pelo alcance da TAREFA. Com etiqueta
--   atravessada, quem alcança a lista mas não o espaço da etiqueta veria a
--   tarefa COM o vínculo e SEM a etiqueta — chip em branco na ficha —, enquanto
--   quem alcança os dois veria o nome. Duas respostas para "quais são as
--   etiquetas desta tarefa", que é a dívida que este projeto existe para não
--   repetir.
--
--   NÃO HÁ FORMA DECLARATIVA, e por isso é gatilho. A regra atravessa
--   `task_tag_assignments` → `tasks` → `lists` → `spaces` de um lado e
--   `task_tags` → `spaces` do outro. `check` não aceita subconsulta. A chave
--   composta ao estilo da F17.1 (`lists_folder_same_space_fk`) exigiria
--   `space_id` gravado na tarefa — a mesma segunda verdade recusada acima.
--
--   E ELE TEM DOIS LADOS, senão seria teatro. Guardar só a etiquetagem deixaria
--   o caminho de trás aberto: bastaria etiquetar a tarefa e depois MOVÊ-LA para
--   outro espaço para chegar ao mesmo estado proibido. Então:
--     · `task_tag_space_guard` cuida de PÔR a etiqueta;
--     · `task_move_tag_guard`  cuida de MOVER a tarefa.
--   O segundo RECUSA em vez de apagar as etiquetas que não cabem — mesmo
--   critério do `restrict` da F17.3: "O ClickUp apaga; a réplica recusa e diz
--   por quê". Apagar etiqueta de trabalho alheio dentro de um arrastar de
--   cartão é dano que ninguém pediu.
--
-- ================================== A ETIQUETA NÃO TEM `source_id`, E ISSO É ==
-- ================================== FIEL À ORIGEM, NÃO DESCUIDO =============
--   Todas as tabelas da F17 até aqui guardam `source_id text` — o id da coisa no
--   ClickUp, que torna a importação repetível. `task_tags` NÃO guarda, porque
--   NO CLICKUP A ETIQUETA NÃO TEM ID: o endpoint de etiquetas do espaço devolve
--   `{name, tag_fg, tag_bg}`, e a identidade dela É o nome dentro do espaço.
--
--   Então a chave de importação é o índice único `(space_id, lower(btrim(name)))`
--   — rodar de novo atualiza a cor, nunca duplica a etiqueta. Inventar um id
--   aqui não daria integridade nenhuma: daria uma coluna que a origem não sabe
--   preencher.
--
--   CONSEQUÊNCIA CONHECIDA E DECLARADA: renomear uma etiqueta no ClickUp é,
--   para a importação, apagar uma e criar outra. A origem tem exatamente o
--   mesmo problema, pelo mesmo motivo, e a F17.11 vai relatar a diferença em
--   vez de adivinhar que houve renomeação.
--
--   `task_types` também não tem `source_id` — porque `custom_item_id` JÁ É o id
--   da origem. Uma segunda coluna com o mesmo conteúdo seria a chave dupla da
--   dívida 1.
--
-- ======================================= QUEM ESCREVE CADA UMA DAS DUAS =======
--   ETIQUETA: quem alcança o espaço. É trabalho do dia a dia — `banners` e
--   `stories` nasceram assim, na mão de quem faz — e é a mesma decisão que a
--   F17.1 tomou para pasta e lista ("exigir administrador aqui paralisaria a
--   operação") e que a F2.4 tomou para atribuir etiqueta a cliente.
--
--   NÃO se usa `can_write_owner` aqui, e é de propósito: aquela função existe
--   para a posse de TRÊS níveis, onde o nível espaço é estrutural e herdado por
--   ~95 listas. Chamada com `p_space_id` preenchido ela devolve
--   `acting_is_superadmin()` — ou seja, tornaria toda etiqueta coisa de
--   administrador e mataria justamente o ato que a recusa da `[]` existe para
--   proteger. Etiqueta tem um nível só e não é herdada por ninguém.
--
--   TIPO DE TAREFA: só administrador. Na origem ele não é trabalho de quadro —
--   é AJUSTE DE CONFIGURAÇÃO do workspace, e existem dois no workspace inteiro.
--   Mesmo critério do `spaces_write` da F17.1: "espaços são raros e
--   estruturais". Acrescentar um tipo muda o que toda tarefa do espaço pode
--   ser; isso não é o mesmo ato que pendurar `banners` numa arte.
-- =============================================================================

-- --- a regra do nome, num lugar só --------------------------------------------
-- `immutable` porque restrição `check` a chama: uma função volátil ali faria o
-- banco reavaliar o que não deve, e o `pg_dump` recusaria.
--
-- `search_path` fixo em `pg_catalog, pg_temp` pelo mesmo motivo das funções de
-- alcance: a resposta não pode depender de quem chama de onde. Aqui só se usa
-- `btrim` e operador de expressão regular, que são do catálogo.
create or replace function ideworks.is_meaningful_name(p_name text)
  returns boolean
  language sql immutable
  set search_path = pg_catalog, pg_temp
as $fn$
  select p_name is not null
     and btrim(p_name) <> ''
     and btrim(p_name) !~ '^[[:punct:][:space:]]+$'
$fn$;

comment on function ideworks.is_meaningful_name(text) is
  'Nome de verdade: nao vazio, nao so espaco, nao so pontuacao. E o que recusa '
  'a etiqueta `[]` — residuo do Trello que hoje suja centenas de tarefas no '
  'ClickUp. Aceita acento, emoji e pontuacao NO MEIO do nome (`publicar/'
  'agendar`, `C++`), porque recusar isso seria a replica sendo mais severa que '
  'a origem.';

-- --- a etiqueta, que vive no espaço -------------------------------------------
create table if not exists ideworks.task_tags (
  id         uuid primary key default gen_random_uuid(),

  -- `cascade`: a etiqueta é metadado do espaço, não trabalho. Apagar o espaço
  -- (que a F17.1 já protege com `restrict` contra a empresa) leva junto o
  -- vocabulário dele, que fora dali não quer dizer nada.
  space_id   uuid not null references ideworks.spaces (id) on delete cascade,

  name       text not null,

  -- `tag_bg` e `tag_fg` do ClickUp, com o nome traduzido para o padrão do
  -- schema. DUAS colunas porque `roteiros` tem #0091ff no fundo e #edadc8 na
  -- frente — com uma só, metade da cor sumiria.
  --
  -- SEM FORMATO OBRIGATÓRIO, e isso foi medido: `stories` é `#000`, de quatro
  -- caracteres. Um `check` de seis dígitos recusaria uma etiqueta REAL logo na
  -- primeira importação. Mesma decisão de `statuses.color` na F17.2 — cor é
  -- DADO da origem (decisão D10), e a tela a recebe como variável.
  bg_color   text,
  fg_color   text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_tags_name_is_a_name check (ideworks.is_meaningful_name(name))
);

-- A CHAVE DE IMPORTAÇÃO, e não só uma unicidade de conforto: no ClickUp a
-- etiqueta não tem id, a identidade dela é o nome dentro do espaço. É este
-- índice que faz a F17.11 poder rodar de novo sem duplicar.
--
-- `lower(btrim(...))` porque `Arte` e `arte ` seriam a mesma etiqueta na tela e
-- duas linhas no banco.
create unique index if not exists task_tags_name_key
  on ideworks.task_tags (space_id, lower(btrim(name)));

comment on table ideworks.task_tags is
  'A etiqueta de TAREFA do ClickUp — vive no espaco. Nao se confunde com '
  'ideworks.client_tags (F2.4), que etiqueta CLIENTE, e global e tem uma cor so: '
  'unificar as duas faria `arte` da Agencia Ide e `arte` do Alma 9 virarem a '
  'mesma linha, e recolorir uma recoloriria a outra.';
comment on column ideworks.task_tags.bg_color is
  'O `tag_bg` da origem. Sem formato obrigatorio: medido `#000` (quatro '
  'caracteres) na etiqueta `stories`, e `#A18072` em maiusculas na `arte`. '
  'Restricao de formato recusaria etiqueta real na primeira importacao.';
comment on column ideworks.task_tags.fg_color is
  'O `tag_fg` da origem. Separado do fundo porque `roteiros` tem os dois '
  'diferentes (#0091ff / #edadc8) enquanto as outras quatro tem iguais.';
comment on constraint task_tags_name_is_a_name on ideworks.task_tags is
  'Nome em branco ou so pontuacao e recusado. E o que impede a etiqueta `[]` — '
  'residuo da importacao do Trello, hoje em centenas de tarefas do ClickUp — de '
  'nascer de novo aqui.';

-- --- o vínculo etiqueta ↔ tarefa ----------------------------------------------
-- Mesma forma de `client_tag_assignments` (F2.4) e de `task_assignees` (F4.8):
-- as duas colunas, o instante, e a chave primária composta. A chave é o "a
-- mesma etiqueta não entra duas vezes" — declarativo, sem código que rode.
create table if not exists ideworks.task_tag_assignments (
  task_id     uuid not null references ideworks.tasks     (id) on delete cascade,
  tag_id      uuid not null references ideworks.task_tags (id) on delete cascade,
  assigned_at timestamptz not null default now(),

  primary key (task_id, tag_id)
);

-- A chave primária já serve "quais etiquetas desta tarefa". Este índice serve o
-- outro sentido — "quais tarefas com esta etiqueta", que é o filtro da F17.8 —
-- e é ele que faz a cascata do `delete` de etiqueta não varrer a tabela.
create index if not exists task_tag_assignments_tag_idx
  on ideworks.task_tag_assignments (tag_id);

comment on table ideworks.task_tag_assignments is
  'O vinculo etiqueta-tarefa. A chave primaria composta e o que garante que a '
  'mesma etiqueta nao entra duas vezes na mesma tarefa, sem gatilho nenhum.';

-- --- o tipo de tarefa, que também vive no espaço ------------------------------
create table if not exists ideworks.task_types (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references ideworks.spaces (id) on delete cascade,

  -- O NÚMERO DA ORIGEM. É o `custom_item_id` que a tarefa carrega desde a
  -- F17.3, e é também o id do tipo no ClickUp — por isso não há `source_id`
  -- separado: seriam duas colunas com o mesmo conteúdo.
  custom_item_id integer not null,

  name           text not null,

  -- O `avatar` do tipo no ClickUp, que é um par: de onde vem o ícone e qual é.
  --
  -- DECLARADO SEM MEDIÇÃO, E ISSO ESTÁ ESCRITO DE PROPÓSITO: o conector do
  -- ClickUp não expõe o catálogo de tipos (`GET /team/{id}/custom_item`) — ele
  -- só devolve, na tarefa, o NOME do tipo (`task_type`). As duas colunas vêm da
  -- forma documentada do `avatar` (`source` e `value`). Entram agora, e vazias,
  -- pelo mesmo motivo de `start_on` na F17.3: se não existirem, o primeiro
  -- ícone que a origem trouxer se perde em silêncio.
  icon_source    text,
  icon_value     text,

  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint task_types_name_is_a_name check (ideworks.is_meaningful_name(name)),

  -- Falha alta (regra 3): id de tipo do ClickUp é 0 ou positivo. Número
  -- negativo não é "tipo desconhecido", é dado corrompido, e entrar em silêncio
  -- criaria uma tarefa que aponta para um tipo que jamais poderá existir.
  constraint task_types_id_is_from_clickup check (custom_item_id >= 0)
);

-- Um número, um tipo, dentro do espaço. É o par que a resolução usa, e o que
-- torna determinístico "qual é o tipo desta tarefa".
create unique index if not exists task_types_key
  on ideworks.task_types (space_id, custom_item_id);

-- Dois tipos de mesmo nome no mesmo espaço seriam indistinguíveis na ficha da
-- tarefa. Entre espaços diferentes, repetir é o esperado — `Task` existe nos
-- dois, e são duas linhas.
create unique index if not exists task_types_name_key
  on ideworks.task_types (space_id, lower(btrim(name)));

comment on table ideworks.task_types is
  'O tipo de tarefa do ClickUp — `Task` (1001) e `Client` (1002), medidos, mais '
  'o tipo padrao (0), que a API reporta com `task_type` NULO. Vive no espaco. '
  'NAO ha chave estrangeira de tasks.custom_item_id para ca: ver a nota longa '
  'do cabecalho desta migration.';
comment on column ideworks.task_types.custom_item_id is
  'O numero que o ClickUp da ao tipo, e que a tarefa carrega em '
  'tasks.custom_item_id desde a F17.3. E o id de origem — por isso esta tabela '
  'nao tem `source_id`: seria a mesma coisa duas vezes.';
comment on column ideworks.task_types.icon_source is
  'De onde vem o icone, no `avatar` do ClickUp. Declarado sem medicao: o '
  'conector nao expoe o catalogo de tipos. Existe para a importacao nao perder '
  'o dado em silencio.';

-- --- o guarda de PÔR a etiqueta -----------------------------------------------
-- A etiqueta tem que ser do espaço da tarefa. Ver a nota longa do cabeçalho:
-- não há forma declarativa, porque a regra atravessa cinco tabelas e a chave
-- composta exigiria `space_id` gravado na tarefa.
--
-- `security definer` pelo mesmo motivo do `task_status_guard` da F17.3: sob a
-- política de quem escreve, uma etiqueta fora do alcance sumiria da consulta e
-- o guarda aprovaria por não achar nada. Autorizar é com a política; conferir o
-- dado é com o guarda.
create or replace function ideworks.task_tag_space_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_espaco_da_tarefa   uuid;
  v_espaco_da_etiqueta uuid;
  v_lista              uuid;
  v_etiqueta           text;
  v_nome_do_espaco     text;
begin
  select t.list_id into v_lista from ideworks.tasks t where t.id = new.task_id;

  select g.space_id, g.name into v_espaco_da_etiqueta, v_etiqueta
    from ideworks.task_tags g where g.id = new.tag_id;

  -- A tarefa sem lista não está em espaço nenhum — é a demanda do Pilar A′, que
  -- pertence ao cliente. Ela não pode carregar etiqueta de tarefa, e a recusa
  -- diz para onde ir: quem quer etiquetar cliente tem a F2.4.
  if v_lista is null then
    raise exception
      'esta tarefa nao esta em lista nenhuma, entao nao pertence a espaco nenhum — e etiqueta de tarefa vive no espaco. Ponha a tarefa num quadro com ideworks.move_task antes de etiqueta-la; para etiquetar o CLIENTE, use ideworks.set_client_tags, que e outra coisa.'
      using errcode = '22023';
  end if;

  select l.space_id into v_espaco_da_tarefa
    from ideworks.lists l where l.id = v_lista;

  -- Etiqueta inexistente cai aqui como nula, e nulo é diferente de qualquer
  -- coisa: recusa. A chave estrangeira também recusaria, mas depois — e com uma
  -- mensagem que não diz o que fazer.
  if v_espaco_da_etiqueta is distinct from v_espaco_da_tarefa then
    select s.name into v_nome_do_espaco
      from ideworks.spaces s where s.id = v_espaco_da_tarefa;

    raise exception
      'a etiqueta % nao e do espaco "%", que e onde esta tarefa mora. No ClickUp a etiqueta pertence ao espaco e so aparece para as tarefas dele; crie uma de mesmo nome no espaco de destino em vez de emprestar a de outro.',
      coalesce(quote_literal(v_etiqueta), 'informada'),
      coalesce(v_nome_do_espaco, v_espaco_da_tarefa::text)
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function ideworks.task_tag_space_guard() is
  'A etiqueta tem que ser do espaco da tarefa. Gatilho porque a regra atravessa '
  'cinco tabelas e `check` nao aceita subconsulta. Tarefa sem lista nao tem '
  'espaco, entao nao aceita etiqueta de tarefa — e a recusa aponta a F2.4, que '
  'e onde se etiqueta cliente.';

drop trigger if exists task_tag_assignments_space_guard on ideworks.task_tag_assignments;
create trigger task_tag_assignments_space_guard
  before insert or update on ideworks.task_tag_assignments
  for each row execute function ideworks.task_tag_space_guard();

-- --- o guarda de MOVER a tarefa -----------------------------------------------
-- O outro lado da mesma regra. Sem ele o guarda de cima seria teatro: bastaria
-- etiquetar a tarefa no espaço certo e depois movê-la para outro para chegar ao
-- estado proibido por um caminho que ninguém confere.
--
-- RECUSA, e não apaga as etiquetas que não cabem. Mesmo critério do `restrict`
-- da F17.3: "O ClickUp apaga; a réplica recusa e diz por quê". Apagar
-- classificação de trabalho alheio dentro de um arrastar de cartão é dano
-- silencioso — e desfazê-lo depois exige saber o que havia lá.
create or replace function ideworks.task_move_tag_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_destino  uuid;
  v_etiqueta text;
  v_espaco   text;
begin
  -- `before update of list_id` dispara quando o comando MENCIONA a coluna,
  -- mesmo que o valor não mude. Sem esta saída, renomear uma tarefa com um
  -- `update` genérico pagaria a consulta abaixo por nada.
  if new.list_id is not distinct from old.list_id then
    return new;
  end if;

  -- Nulo quando a tarefa está saindo do quadro: aí NENHUMA etiqueta cabe, e a
  -- comparação `is distinct from` abaixo pega todas.
  select l.space_id into v_destino from ideworks.lists l where l.id = new.list_id;

  select g.name, s.name into v_etiqueta, v_espaco
    from ideworks.task_tag_assignments a
    join ideworks.task_tags g on g.id = a.tag_id
    join ideworks.spaces    s on s.id = g.space_id
   where a.task_id = new.id
     and g.space_id is distinct from v_destino
   order by lower(btrim(g.name))
   limit 1;

  if found then
    raise exception
      'a tarefa carrega a etiqueta %, que e do espaco "%", e o destino nao e esse espaco. Etiqueta de tarefa vive no espaco: tire a etiqueta antes de mover, ou crie uma de mesmo nome no espaco de destino. Nada foi movido.',
      quote_literal(v_etiqueta), v_espaco
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function ideworks.task_move_tag_guard() is
  'O outro lado de `task_tag_space_guard`: mover a tarefa para outro espaco '
  'com etiqueta do espaco antigo e recusado. Sem ele, guardar so a etiquetagem '
  'seria teatro — o mesmo estado proibido se alcancaria etiquetando primeiro e '
  'movendo depois.';

drop trigger if exists tasks_tag_space_guard on ideworks.tasks;
create trigger tasks_tag_space_guard
  before update of list_id on ideworks.tasks
  for each row execute function ideworks.task_move_tag_guard();

-- --- a ligação com o catálogo, que é função e não chave ------------------------
-- O par de `resolve_status_set` da F17.2: a tarefa carrega um número, e o tipo
-- correspondente sai do espaço da lista dela.
--
-- `security definer` para a resposta ser um FATO da árvore. `resolve_status_set`
-- é `invoker` de propósito, porque devolver `null` para quem não alcança o
-- espaço é o comportamento certo de um filtro de LEITURA; aqui não há decisão
-- de escrita pendurada nela, e o que se quer é "qual é o tipo", não "qual é o
-- tipo que você pode ver" — a view abaixo é quem filtra, e ela é
-- `security_invoker`.
create or replace function ideworks.resolve_task_type(
  p_list_id uuid, p_custom_item_id integer)
  returns uuid
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select tt.id
    from ideworks.lists l
    join ideworks.task_types tt
      on tt.space_id = l.space_id
     and tt.custom_item_id = p_custom_item_id
   where l.id = p_list_id
$fn$;

comment on function ideworks.resolve_task_type(uuid, integer) is
  'O tipo da tarefa: o numero que ela carrega, resolvido no catalogo do espaco '
  'da lista dela. E o que substitui a chave estrangeira que `custom_item_id` '
  'nao pode ter — ver a nota longa da migration da F17.4. Devolve nulo quando a '
  'tarefa nao esta em lista, nao tem numero, ou o numero nao esta catalogado.';

-- --- as duas coisas aparecendo na tarefa --------------------------------------
-- É o que a etapa promete: "as etiquetas com cor e os tipos de tarefa existem e
-- APARECEM na tarefa". Uma consulta só, para a ficha e para o cartão do quadro.
--
-- `security_invoker` para a view respeitar a política de quem consulta — sem
-- isso ela rodaria com os poderes do dono e seria um buraco de RLS com cara de
-- comodidade (mesma nota da view `tree`, na F17.1).
--
-- `task_type_missing` É O INSTRUMENTO QUE SUBSTITUI A CHAVE ESTRANGEIRA. Ele
-- responde, por tarefa, "este número aponta para tipo que não existe no
-- catálogo deste espaço?". A F17.11 lê isto para RELATAR, que é o que a decisão
-- D21 pede — em vez de recusar a importação, que é o que a chave faria.
drop view if exists ideworks.task_labels;
create view ideworks.task_labels
  with (security_invoker = true)
as
select
  t.id             as task_id,
  t.list_id,
  l.space_id,
  t.custom_item_id,
  tt.id            as task_type_id,
  tt.name          as task_type_name,
  tt.icon_source   as task_type_icon_source,
  tt.icon_value    as task_type_icon_value,
  (t.custom_item_id is not null and tt.id is null) as task_type_missing,
  coalesce(
    (select jsonb_agg(
              jsonb_build_object(
                'id',       g.id,
                'name',     g.name,
                'bg_color', g.bg_color,
                'fg_color', g.fg_color)
              order by lower(btrim(g.name)))
       from ideworks.task_tag_assignments a
       join ideworks.task_tags g on g.id = a.tag_id
      where a.task_id = t.id),
    '[]'::jsonb) as tags
from ideworks.tasks t
left join ideworks.lists l on l.id = t.list_id
left join ideworks.task_types tt
       on tt.space_id = l.space_id
      and tt.custom_item_id = t.custom_item_id;

comment on view ideworks.task_labels is
  'O tipo e as etiquetas da tarefa, numa consulta so, para a ficha e para o '
  'cartao do quadro. `task_type_missing` e o instrumento que ficou no lugar da '
  'chave estrangeira que `tasks.custom_item_id` nao pode ter: e por ele que a '
  'F17.11 RELATA tipo nao catalogado, em vez de recusar a importacao.';

-- --- trocar a lista inteira de etiquetas (regra 9) ----------------------------
-- Mesma forma de `set_client_tags` (F2.4) e `set_task_assignees` (F17.3): a
-- tela manda o conjunto final, e a troca acontece em bloco.
--
-- A LINHA ENTRE IGNORAR E RECUSAR, e ela é deliberada:
--   · id que NÃO EXISTE MAIS é ignorado — a etiqueta pode ter sido apagada
--     entre a tela abrir e o botão ser clicado, e derrubar a operação inteira
--     por causa disso seria punir quem não errou (o mesmo critério da F2.4).
--   · id que EXISTE mas é de outro espaço é RECUSADO, alto, pelo guarda. Não é
--     descuido de concorrência: é uma etiqueta de verdade no lugar errado, e
--     ignorá-la em silêncio faria a tela dizer "salvo" sobre algo que não foi.
create or replace function ideworks.set_task_tags(p_task_id uuid, p_tag_ids uuid[])
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id and ideworks.can_reach_task(t.list_id, t.client_id)
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

comment on function ideworks.set_task_tags(uuid, uuid[]) is
  'Troca a lista inteira de etiquetas de uma tarefa, em bloco. Exige ALCANCAR a '
  'tarefa, nao ser administrador: etiquetar e trabalho de quem faz. Ignora id '
  'que nao existe mais; etiqueta de OUTRO espaco e recusada pelo guarda, porque '
  'ali nao ha descuido de concorrencia, ha etiqueta no lugar errado.';

-- --- segurança por linha -------------------------------------------------------
alter table ideworks.task_tags            enable row level security;
alter table ideworks.task_tag_assignments enable row level security;
alter table ideworks.task_types           enable row level security;

-- ETIQUETA: lê e escreve quem alcança o espaço. Ver a nota do cabeçalho sobre
-- por que NÃO é `can_write_owner` — ela tornaria toda etiqueta coisa de
-- administrador.
drop policy if exists task_tags_select on ideworks.task_tags;
create policy task_tags_select on ideworks.task_tags for select
  using (ideworks.can_see_space(space_id));

drop policy if exists task_tags_write on ideworks.task_tags;
create policy task_tags_write on ideworks.task_tags for all
  using      (ideworks.can_see_space(space_id))
  with check (ideworks.can_see_space(space_id));

-- TIPO: lê quem alcança o espaço, escreve só administrador. Na origem é ajuste
-- de configuração do workspace, não trabalho de quadro.
drop policy if exists task_types_select on ideworks.task_types;
create policy task_types_select on ideworks.task_types for select
  using (ideworks.can_see_space(space_id));

drop policy if exists task_types_write on ideworks.task_types;
create policy task_types_write on ideworks.task_types for all
  using      (ideworks.acting_is_superadmin())
  with check (ideworks.acting_is_superadmin());

-- VÍNCULO: o alcance da tarefa, e nenhuma regra nova. A etiqueta pendurada na
-- tarefa é parte da tarefa — quem a alcança, a vê e a classifica.
--
-- `can_reach_task_id` recebe o ID e faz subconsulta, e isso é seguro AQUI: a
-- lição da F17.2b vale quando a subconsulta procura a PRÓPRIA linha que está
-- sendo inserida. Aqui a linha nova é do vínculo e a busca é em `tasks`, que já
-- tem a tarefa gravada — exatamente como `task_assignees` faz desde a F17.3.
drop policy if exists task_tag_assignments_select on ideworks.task_tag_assignments;
create policy task_tag_assignments_select on ideworks.task_tag_assignments for select
  using (ideworks.can_reach_task_id(task_id));

drop policy if exists task_tag_assignments_write on ideworks.task_tag_assignments;
create policy task_tag_assignments_write on ideworks.task_tag_assignments for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

-- --- permissões ---------------------------------------------------------------
-- Expressão de política roda com os poderes de quem consulta: sem `execute`, o
-- papel do app bateria em "permission denied for function" em vez de bater na
-- regra. O mesmo vale para função chamada dentro de `check` — sem `execute` em
-- `is_meaningful_name`, NENHUMA etiqueta seria criada pelo app, e o erro não
-- diria nada sobre etiqueta.
--
-- As duas funções de gatilho não entram: permissão de função de gatilho é
-- conferida na criação do gatilho, não a cada disparo (mesma nota da F17.3).
grant all privileges on all tables in schema ideworks to ideworks_app;
grant select on ideworks.task_labels to ideworks_app;
grant execute on function ideworks.is_meaningful_name(text)          to ideworks_app;
grant execute on function ideworks.resolve_task_type(uuid, integer)  to ideworks_app;
grant execute on function ideworks.set_task_tags(uuid, uuid[])       to ideworks_app;
