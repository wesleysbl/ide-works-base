-- =============================================================================
-- IDE WORKS — F17.15  Subtarefas e checklists
-- =============================================================================
-- ESTA ETAPA EXISTE POR UM ERRO DE LEVANTAMENTO, E ELE ESTÁ ESCRITO NO PLANO
--   A medição do ClickUp foi feita por AMOSTRA e a amostra pegou a AGÊNCIA IDE
--   e as listas de artes e vídeos da Alma 9. As listas `(setup)`, `(projetos)`,
--   `[Demandas]` e `CRM` ficaram de fora — e é exatamente onde a equipe usa
--   subtarefa e checklist. O plano registrou "Subtarefas: zero" e "Checklists
--   nativos: zero", e as duas foram para a lista de NÃO CONSTRUIR.
--
--   O que existe de verdade, medido depois nas telas do usuário:
--     `Etapa 1: Organização Estratégica Inicial`, lista `Fiorart (setup)`
--       5 subtarefas ..... 1.1 Reunião de Kickoff · 1.2 Acesso às Plataformas ·
--                          1.3 Análise de Produtos · 1.4 Definição de SKUs ·
--                          1.5 Estruturação de Variações
--       1 checklist ...... com 1 item, contagem `0/1`
--     `Automação Market Place`, lista `Alma9 (projetos)`
--       subtarefa e checklist também
--     a contagem ao lado do nome na visão de lista .... `5`, `3`, `4`
--
--   É a espinha do jeito Alma 9 de rodar setup de cliente. Sem isto o sistema
--   entregaria um quadro que não sabe quebrar trabalho em passos.
--
-- O QUE ESTA MIGRATION MEDIU ANTES DE ESCREVER UMA LINHA — 2026-08-26
--   ideworks.tasks .................. 18 linhas (1 arquivada)
--   ideworks.spaces / lists ......... 2 e 2
--   ideworks.status_sets / statuses . 2 e 4
--   ideworks.task_tags .............. 0
--   ideworks.task_assignees ......... 0
--   ideworks.task_watchers .......... 0
--   gatilhos no schema .............. 10, dois deles em `ideworks.tasks`
--                                     (`tasks_status_guard`, `tasks_tag_space_guard`)
--
--   Nenhuma linha existente ganha mãe, nenhum checklist nasce por aqui. Esta
--   migration acrescenta uma coluna anulável, duas tabelas vazias, uma view e um
--   gatilho — o dado real fica exatamente como está.
--
-- ============================================== AS TRÊS DECISÕES DA ETAPA =====
--
-- 1. PROFUNDIDADE LIVRE, E CICLO PROIBIDO
--    Decidido pelo usuário em 2026-08-25, fiel ao ClickUp: lá a subtarefa é uma
--    tarefa inteira — tem status, responsável, prazo, prioridade, etiqueta,
--    descrição — e pode ter as suas. Então `parent_id` aponta para `tasks`, sem
--    teto de nível.
--
--    A consequência que precisa de resposta é o CICLO. Uma tarefa não pode ser
--    ancestral de si mesma, nem por um passo (`A.parent = A`) nem por um caminho
--    longo (`A -> B -> C -> A`). Isso NÃO tem forma declarativa em Postgres:
--    `check` não faz subconsulta, e chave estrangeira não sabe o que é caminho.
--    É gatilho, e é o 11º do projeto.
--
--    O gatilho sobe o caminho a partir da mãe pedida e recusa se encontrar a
--    própria linha. Ele só sobe em `UPDATE`: num `INSERT` a linha nova ainda não
--    é mãe de ninguém — a chave estrangeira exige que a mãe exista, e nada pode
--    apontar para um id que ainda não existe —, então ciclo por inserção é
--    impossível e a subida seria custo sem função.
--
-- 2. A CONTAGEM DO CARTÃO É DE FILHOS DIRETOS, E NÃO DA DESCENDÊNCIA INTEIRA
--    A tela real mostra `5` para a `Etapa 1`, que tem 5 filhas diretas e nenhuma
--    neta — o número medido não separa as duas leituras. A decisão foi tomada
--    por três razões próprias:
--
--      · O número fica ao lado da MÃE e responde "em quantos passos esta tarefa
--        foi quebrada". Contar a descendência faria o número da `Etapa 1` mudar
--        quando alguém quebrasse a `1.3` em três — um fato que não é sobre a
--        `Etapa 1`.
--      · A ficha mostra as filhas diretas, e cada uma mostra a SUA contagem. A
--        recursão aparece navegando, não somando — e assim cartão, linha e ficha
--        dizem a mesma coisa, que é o que a etapa exige.
--      · Custo: filho direto é `count(*)` por `parent_id` com índice.
--        Descendência é consulta recursiva por cartão, num quadro que lista
--        dezenas.
--
--    A view `ideworks.task_progress` é a ÚNICA definição dessa conta. Cartão,
--    linha e ficha leem dela — três `count(*)` escritos à mão em três consultas
--    divergiriam no primeiro ajuste, que é a dívida 8.1 do legado outra vez.
--
-- 3. A SUBTAREFA MORA NA LISTA DA MÃE — E ISSO É ALCANCE, NÃO ARRUMAÇÃO
--    No ClickUp a subtarefa aparece dentro da mãe, e a API devolve `list: null`
--    nelas justamente porque a lista não é dela: é da mãe.
--
--    Aqui a razão é mais dura que fidelidade. O alcance da tarefa é
--    `can_reach_task(list_id, client_id)` — a UNIÃO de "alcanço a lista" e
--    "alcanço o cliente" (F17.3). Se a subtarefa pudesse morar em outra lista,
--    de outro espaço, de outra EMPRESA, então:
--      · quem alcança a mãe poderia não alcançar a filha — e a contagem do
--        cartão diria `5` para uns e `3` para outros, duas verdades sobre o
--        mesmo fato;
--      · quem alcança a filha poderia não alcançar a mãe — e veria um pedaço de
--        trabalho sem o trabalho.
--
--    Então a regra é: A SUBTAREFA TEM EXATAMENTE AS ÂNCORAS DA MÃE. Mesma lista,
--    mesmo cliente. Com as âncoras iguais o alcance é igual por construção, e
--    não existe uma segunda regra de acesso para subtarefa — que é o que este
--    projeto evita desde a F17.1.
--
-- ==================================== A PORTA DECLARATIVA QUE FOI MEDIDA ======
--   "Mesma lista da mãe" NÃO precisou de gatilho. Ela é a chave estrangeira
--   COMPOSTA — o mesmo desenho de `lists_folder_same_space_fk` da F17.1, que já
--   impede a lista de apontar para pasta de outro espaço:
--
--     unique      (id, list_id)
--     foreign key (list_id, parent_id) references tasks (list_id, id)
--       on update cascade  on delete cascade
--
--   MATCH SIMPLE: com `parent_id` nulo a restrição está satisfeita por
--   definição, e a tarefa comum continua exatamente como era. Com `parent_id`
--   preenchido, o banco EXIGE que a mãe esteja na mesma lista.
--
--   E as duas ações referenciais entregam de graça o que seria trabalho:
--     · `on update cascade` — mover a MÃE de lista leva a descendência inteira
--       junto, em cascata recursiva. Sondado em tabela descartável: três níveis,
--       `3 de 3 na lista nova`.
--     · `on delete cascade` — apagar a mãe leva as filhas. É o item "apagar a
--       mãe não deixa subtarefa órfã" do plano, e é o comportamento do ClickUp.
--
--   O QUE A SONDA TAMBÉM MEDIU, E QUE OBRIGOU A MEXER EM `move_task`
--     Mover SÓ a mãe para uma lista de esteira diferente é RECUSADO (`23514`):
--     a cascata atualiza cada filha, `tasks_status_guard` dispara em cada uma e
--     recusa o status que não pertence à esteira nova. Correto e alto — mas
--     tornaria impossível mover uma tarefa com subtarefas entre espaços.
--
--     A saída medida: mover a SUBÁRVORE INTEIRA numa escrita só, com o status de
--     cada linha já resolvido para a esteira de destino. Sondado: `PASSOU — 3 de
--     3 na lista nova`. É o que `move_task` passa a fazer, e é a regra 9 do
--     roteiro (o bloco que sai junto ou não sai) aplicada a uma árvore.
--
-- ========================================== O CHECKLIST, E O `{}` DO TRELLO ===
--   Duas tabelas: a COLEÇÃO nomeada (`Checklist`, no padrão do ClickUp) e os
--   ITENS dela. Uma tarefa pode ter VÁRIOS checklists — medido na tela real, que
--   mostra três cartões empilhados —, e a contagem `resolvidos/total` é POR
--   CHECKLIST.
--
--   O item pode ter RESPONSÁVEL (`assignee` do ClickUp) e pode ter FILHO (o
--   `children` do ClickUp).
--
--   SUJEIRA MEDIDA NA ORIGEM: os itens de checklist reais têm nome `{}` —
--   resíduo do Trello, nos dois casos medidos. `ideworks.is_meaningful_name`, da
--   F17.4, já recusa isso, e ela é usada aqui nos DOIS nomes. Não é para
--   consertar o dado de lá (a importação saiu do plano): é para não deixar
--   nascer aqui.
--
--   O FILHO DO ITEM É UM NÍVEL SÓ, E ISSO TAMBÉM É DECLARATIVO
--     Duas colunas geradas — `nest_level` (0 para item, 1 para filho) e
--     `parent_level` (-1 para item, 0 para filho) — mais uma chave estrangeira
--     composta que exige que o pai esteja um nível acima e no mesmo checklist.
--
--     Um item de nível 0 tem `parent_level = -1`, que nenhuma linha tem: ele só
--     pode existir SEM pai. Um filho de nível 1 precisa de um pai de nível 0.
--     Logo não há neto, não há pai em outro checklist, e — o mais importante —
--     NÃO HÁ CICLO POSSÍVEL, porque o nível estritamente decresce. Zero gatilho.
--
--     Sondado em tabela descartável, os seis casos: raiz sem pai passa, filho de
--     um nível passa, neto recusado `23503`, pai de outro checklist recusado
--     `23503`, auto-pai recusado `23503`, e apagar a raiz leva o filho junto.
--
--   `resolved_at`, E NÃO `resolved boolean` — a regra do projeto: instante
--   responde "resolvido desde quando?", booleano não responde nada. NÃO há
--   `resolved_by`: o ClickUp não guarda quem resolveu o item, e inventar uma
--   coluna que a origem não tem seria a réplica dizendo mais do que sabe.
--
-- ============================================== O NOME DO GATILHO, E A ORDEM ==
--   Gatilhos da MESMA tabela disparam em ordem alfabética de NOME. Isso já
--   enganou dois verificadores neste projeto — `tasks_status_guard` falou antes
--   de `tasks_tag_space_guard` e os dois recusam com `23514`.
--
--   Em `ideworks.tasks` a ordem passa a ser:
--     tasks_parent_guard      (esta etapa)   ← fala PRIMEIRO
--     tasks_status_guard      (F17.3)
--     tasks_tag_space_guard   (F17.4b)
--
--   E o primeiro lugar não é acaso: `tasks_parent_guard` PREENCHE `list_id` a
--   partir da mãe quando ele não vem. Se falasse depois, `tasks_status_guard`
--   veria a lista ainda nula, não resolveria esteira nenhuma, e a subtarefa
--   nasceria sem status — linha sem coluna no quadro.
--
--   A recusa dele usa `42501` (fora do alcance) e `23514` (estado proibido), os
--   mesmos códigos das outras travas — por isso `scripts/provar-subtarefas-e-
--   checklists.mjs` confere SEMPRE um trecho da mensagem, e não só o código.
-- =============================================================================

-- --- a tarefa ganha mãe -------------------------------------------------------
alter table ideworks.tasks
  add column if not exists parent_id uuid;

-- O par (id, list_id) é o que a subtarefa referencia para provar que a mãe está
-- na mesma lista. Mesmo papel de `folders_id_space_key` na F17.1.
--
-- `id` é chave primária, então o par é único por definição — a restrição existe
-- para a chave estrangeira composta poder apontar para ele, e não para impedir
-- duplicata.
alter table ideworks.tasks
  drop constraint if exists tasks_id_list_key;
alter table ideworks.tasks
  add constraint tasks_id_list_key unique (id, list_id);

-- O CORAÇÃO DO DESENHO. Ver o cabeçalho: com `parent_id` nulo a restrição está
-- satisfeita por definição (MATCH SIMPLE) e a tarefa comum não muda em nada; com
-- `parent_id` preenchido, a mãe TEM que estar na mesma lista.
--
-- `on update cascade` move a descendência inteira quando a mãe muda de lista.
-- `on delete cascade` leva a descendência quando a mãe é apagada — o ClickUp faz
-- isso, e o plano pede "apagar a mãe não deixa subtarefa órfã".
--
-- ATENÇÃO, E ESTÁ AQUI PORQUE É PERIGOSO: apagar uma tarefa com subtarefas apaga
-- as subtarefas. `server/tasks.ts` tem `deleteTask`, e a partir daqui ele leva a
-- descendência junto. Arquivar continua sendo o caminho normal — `archived_at`
-- existe justamente para isso, e arquivar NÃO desce para as filhas.
alter table ideworks.tasks
  drop constraint if exists tasks_parent_same_list_fk;
alter table ideworks.tasks
  add constraint tasks_parent_same_list_fk
  foreign key (list_id, parent_id) references ideworks.tasks (list_id, id)
  on update cascade on delete cascade;

-- Serve as três leituras que existem sobre `parent_id`: a contagem de filhas
-- diretas (`task_progress`), a lista de filhas na ficha, e a varredura que a
-- cascata da chave estrangeira faz a cada movimento de lista.
--
-- Parcial porque a esmagadora maioria das tarefas não tem mãe: hoje são 18 de
-- 18. Um índice cheio guardaria dezoito nulos para responder uma pergunta que
-- ninguém faz sobre eles.
create index if not exists tasks_parent_idx
  on ideworks.tasks (parent_id, list_id) where parent_id is not null;

comment on column ideworks.tasks.parent_id is
  'A mae, quando esta tarefa e subtarefa. Profundidade LIVRE — no ClickUp a '
  'subtarefa e uma tarefa inteira e pode ter as suas. A mae tem que estar na '
  'MESMA lista (tasks_parent_same_list_fk), e ciclo e recusado pelo gatilho '
  'tasks_parent_guard.';
comment on constraint tasks_parent_same_list_fk on ideworks.tasks is
  'A subtarefa mora na lista da mae. Nao e arrumacao: o alcance da tarefa e '
  'can_reach_task(list_id, client_id), e mae e filha em listas diferentes '
  'teriam alcances diferentes — a contagem do cartao diria 5 para uns e 3 para '
  'outros. `on update cascade` move a descendencia junto; `on delete cascade` a '
  'leva junto.';
comment on constraint tasks_id_list_key on ideworks.tasks is
  'O par que a subtarefa referencia para provar que a mae esta na mesma lista. '
  'Mesmo papel de folders_id_space_key na F17.1.';

-- --- o guarda da mãe ----------------------------------------------------------
-- O 11º gatilho do projeto, e ele existe porque restrição não alcança: ciclo é
-- um CAMINHO, e `check` não faz subconsulta.
--
-- Ele faz cinco coisas, e nada além delas:
--   1. RECUSA a mãe que a pessoa não alcança. A chave estrangeira sozinha
--      deixaria passar um id descoberto por tentativa, e a mensagem de um
--      `security definer` que nomeasse a mãe contaria que ela existe.
--   2. RECUSA a tarefa que é mãe de si mesma — o ciclo de um passo, que a chave
--      estrangeira composta ACEITA (a linha está, trivialmente, na própria
--      lista).
--   3. RECUSA o ciclo longo, subindo o caminho a partir da mãe pedida.
--   4. PREENCHE as âncoras a partir da mãe quando não vêm: `list_id` e
--      `client_id`. É o que faz "a subtarefa herda a lista da mãe" ser verdade
--      no modelo, e não só no chamador.
--   5. RECUSA a mãe que troca de cliente tendo filhas — o outro lado da mesma
--      invariante. A lista é guardada pela cascata da chave estrangeira; o
--      cliente não tem cascata, porque duas cascatas na mesma linha se
--      atropelariam.
--
-- `security definer` pela mesma razão dos sete guardas anteriores: sob a
-- política de quem escreve, uma mãe fora do alcance sumiria da consulta e o
-- guarda aprovaria por não achar nada. Autorizar é com a política; conferir o
-- dado é com o guarda — e por isso o alcance é conferido AQUI, à mão, chamando a
-- mesma função que a política chama.
create or replace function ideworks.task_parent_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_pai_list   uuid;
  v_pai_client uuid;
  v_pai_titulo text;
  v_mudou_pai  boolean;
  v_ciclo      boolean;
  v_caminho    text;
  v_passos     integer;
  v_filhas     integer;
begin
  -- --- o lado da MÃE: trocar de cliente com filhas penduradas ---------------
  -- `before update of ... client_id` dispara quando o comando MENCIONA a
  -- coluna, mesmo que o valor não mude — foi assim que a F17.4b cobriu
  -- `set space_id = X, folder_id = null` na mesma escrita. Daí o
  -- `is distinct from`: sem ele, todo `update` genérico pagaria a contagem.
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    select count(*) into v_filhas
      from ideworks.tasks f where f.parent_id = new.id;

    if v_filhas > 0 then
      raise exception
        'esta tarefa tem % subtarefa(s), e a subtarefa herda o cliente da mae — trocar o cliente so dela deixaria mae e filha com alcances diferentes. Desfaca o vinculo das subtarefas antes, ou troque o cliente delas junto. Nada foi gravado.',
        v_filhas
        using errcode = '23514';
    end if;
  end if;

  -- Daqui para baixo é o lado da FILHA. Tarefa sem mãe sai agora, e sai barato:
  -- é o caso de 18 das 18 tarefas reais.
  if new.parent_id is null then
    return new;
  end if;

  v_mudou_pai := tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id;

  -- --- o ciclo de um passo --------------------------------------------------
  -- A chave estrangeira composta ACEITA `A.parent = A`: a linha está na própria
  -- lista, então o par (list_id, parent_id) encontra a si mesmo. Sem esta
  -- recusa, a tarefa sumiria de todas as telas — nenhuma raiz a alcança.
  if new.parent_id = new.id then
    raise exception
      'a tarefa "%" nao pode ser mae de si mesma. Uma tarefa nao e ancestral dela propria — nem por um passo, nem por um caminho longo.',
      new.title
      using errcode = '23514';
  end if;

  select t.list_id, t.client_id, t.title
    into v_pai_list, v_pai_client, v_pai_titulo
    from ideworks.tasks t
   where t.id = new.parent_id;

  -- Mãe inexistente não é recusada aqui: quem recusa é
  -- `tasks_parent_same_list_fk`, com `23503`, no fim do comando. Sair silencioso
  -- deixa a chave estrangeira falar, e a mensagem dela nomeia a restrição.
  if not found then
    return new;
  end if;

  -- --- o alcance da mãe -----------------------------------------------------
  -- Só quando a mãe muda: numa cascata de movimento de lista o vínculo é o
  -- mesmo, e reconferir custaria uma consulta por linha da subárvore.
  --
  -- A mensagem NÃO nomeia a mãe. Dentro de `security definer` este guarda
  -- enxerga tudo, e dizer "a tarefa X esta fora do seu alcance" contaria que X
  -- existe — que é justamente o que a política esconde.
  if v_mudou_pai and not ideworks.can_reach_task(v_pai_list, v_pai_client) then
    raise exception
      'a tarefa mae nao existe ou esta fora do seu alcance. So se prende uma subtarefa a uma tarefa que voce alcanca.'
      using errcode = '42501';
  end if;

  -- --- as âncoras são as da mãe ---------------------------------------------
  -- Preencher, e não exigir: é isto que torna "a subtarefa herda a lista da mae"
  -- verdade no MODELO. Quem cria subtarefa manda o título e a mãe; a lista, a
  -- esteira e o cliente vêm sozinhos.
  --
  -- A LISTA NÃO É CONFERIDA AQUI, e a omissão é medida. Quem confere é a chave
  -- estrangeira composta, que é AFTER e vê o fim do comando — e é isso que
  -- permite a `move_task` mover mãe e filhas na MESMA escrita. Um `if
  -- new.list_id <> v_pai_list then raise` aqui recusaria essa escrita, porque um
  -- gatilho BEFORE lê a mãe ainda no estado antigo.
  if new.list_id is null then
    new.list_id := v_pai_list;
  end if;

  if new.client_id is null then
    new.client_id := v_pai_client;
  elsif new.client_id is distinct from v_pai_client then
    raise exception
      'a subtarefa herda o cliente da mae, e o cliente informado nao e o dela. Alcance de tarefa e a uniao "alcanco a lista OU alcanco o cliente": com clientes diferentes, mae e filha seriam lidas por gente diferente. Deixe o cliente em branco para herdar.'
      using errcode = '23514';
  end if;

  -- --- o ciclo longo --------------------------------------------------------
  -- Só em `UPDATE`, e só quando a mãe muda. Num `INSERT` a linha nova não é mãe
  -- de ninguém — a chave estrangeira exige que a mãe EXISTA, e nada pode apontar
  -- para um id que ainda não existe —, então ciclo por inserção é impossível.
  --
  -- `passo` é teto de segurança, e não limite de profundidade: a decisão do
  -- usuário é profundidade LIVRE. Ele existe para a subida terminar mesmo que um
  -- ciclo já estivesse gravado por algum caminho que este guarda não cobre.
  if tg_op = 'UPDATE' and v_mudou_pai then
    with recursive linhagem as (
      select t.id, t.parent_id, t.title, 1 as passo
        from ideworks.tasks t
       where t.id = new.parent_id
      union all
      select a.id, a.parent_id, a.title, l.passo + 1
        from ideworks.tasks a
        join linhagem l on a.id = l.parent_id
       where l.passo < 200
    )
    select bool_or(l.id = new.id),
           string_agg(l.title, ' -> ' order by l.passo desc),
           max(l.passo)
      into v_ciclo, v_caminho, v_passos
      from linhagem l;

    if v_ciclo then
      raise exception
        'por "%" a tarefa "%" voltaria a ela mesma — sao % nivel(is) no caminho. Uma tarefa nao pode ser ancestral de si propria: a arvore ficaria solta, sem raiz, e sumiria de todas as telas. Nada foi gravado.',
        coalesce(v_caminho, v_pai_titulo), new.title, coalesce(v_passos, 0)
        using errcode = '23514';
    end if;

    if coalesce(v_passos, 0) >= 200 then
      raise exception
        'a linhagem desta tarefa passou de 200 niveis, que e o teto de seguranca da subida. Ou ha um ciclo gravado no banco, ou a arvore cresceu alem do que qualquer tela consegue mostrar. Nada foi gravado.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$fn$;

comment on function ideworks.task_parent_guard() is
  'O 11o gatilho do projeto, e so porque restricao nao alcanca: ciclo e um '
  'CAMINHO, e check nao faz subconsulta. Recusa mae fora do alcance, mae de si '
  'mesma e ciclo longo; PREENCHE lista e cliente a partir da mae; e recusa a mae '
  'que troca de cliente tendo filhas. A lista igual a da mae quem guarda e a '
  'chave estrangeira composta tasks_parent_same_list_fk.';

-- O nome vem ANTES de `tasks_status_guard` no alfabeto, e isso é o desenho: ele
-- preenche `list_id` a partir da mãe, e o guarda do status precisa da lista já
-- preenchida para resolver a esteira.
drop trigger if exists tasks_parent_guard on ideworks.tasks;
create trigger tasks_parent_guard
  before insert or update of parent_id, list_id, client_id on ideworks.tasks
  for each row execute function ideworks.task_parent_guard();

-- --- mover passa a mover a SUBÁRVORE (regra 9) --------------------------------
-- O texto é o da F17.3 com UMA mudança: a escrita final deixou de alcançar uma
-- linha e passou a alcançar a tarefa e toda a descendência dela, numa consulta
-- só.
--
-- POR QUE ISSO É OBRIGATÓRIO, E NÃO CONFORTO
--   Medido em tabela descartável, com um gatilho que imita `task_status_guard`:
--   mover SÓ a mãe para uma lista de esteira diferente é recusado com `23514` —
--   a cascata de `tasks_parent_same_list_fk` atualiza cada filha, o guarda do
--   status dispara em cada uma, e o status antigo não pertence à esteira nova.
--
--   A tarefa com subtarefas ficaria presa ao espaço em que nasceu. Movendo a
--   subárvore inteira na mesma escrita, cada linha já chega com o status
--   resolvido para a esteira de destino, o guarda aprova todas, e a cascata não
--   encontra nada a fazer — ela procura pelo valor ANTIGO de `list_id`, que já
--   não existe. Sondado: `PASSOU — 3 de 3 na lista nova`.
--
-- A REGRA DO STATUS DE CADA FILHA É A MESMA DA MÃE, e é a do Caso de Borda: se o
-- status atual existe na esteira nova, ele fica; senão, cai no primeiro que
-- abre. O que não se faz é dar à filha o status ESCOLHIDO para a mãe — arrastar
-- um cartão para "em revisão" não põe as cinco subtarefas em revisão.
create or replace function ideworks.move_task(
  p_task_id   uuid,
  p_list_id   uuid,
  p_status_id uuid default null)
  returns jsonb
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_status_antes uuid;
  v_lista_antes  uuid;
  v_set          uuid;
  v_novo         uuid;
  v_mexidas      integer;
begin
  if p_list_id is null then
    raise exception
      'mover exige a lista de destino. Para tirar a tarefa do quadro sem apaga-la, arquive-a com ideworks.set_task_archived.'
      using errcode = '22023';
  end if;

  -- Filtrado pela politica: tarefa fora do alcance simplesmente nao aparece.
  select t.status_id, t.list_id into v_status_antes, v_lista_antes
    from ideworks.tasks t where t.id = p_task_id;

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  if not ideworks.can_see_list(p_list_id) then
    raise exception
      'a lista de destino nao existe ou esta fora do seu alcance'
      using errcode = '42501';
  end if;

  v_set := ideworks.resolve_status_set(p_list_id);

  if v_set is null then
    raise exception
      'a lista de destino nao tem esteira: nem ela, nem a pasta dela, nem o espaco declaram um conjunto de status. Crie a esteira antes de mover a tarefa para la.'
      using errcode = '22023';
  end if;

  if p_status_id is not null then
    -- Escolhido por quem chama. O gatilho confere se pertence; aqui so passa.
    v_novo := p_status_id;
  elsif exists (
    select 1 from ideworks.statuses s
     where s.id = v_status_antes and s.status_set_id = v_set
  ) then
    -- A esteira nova e a mesma, ou tem por acaso o mesmo status: nao se mexe no
    -- que a equipe ja tinha marcado.
    v_novo := v_status_antes;
  else
    v_novo := ideworks.first_open_status(v_set);

    if v_novo is null then
      raise exception
        'a esteira da lista de destino nao tem nenhum status que abra: so ha o que fecha. A tarefa ficaria em estado inexistente, entao nada foi movido.'
        using errcode = '22023';
    end if;
  end if;

  -- AS DUAS COLUNAS NA MESMA ESCRITA, E AGORA A SUBÁRVORE INTEIRA TAMBÉM. Em
  -- dois comandos, uma falha no meio deixaria a tarefa numa lista cujo quadro
  -- não tem a coluna dela — e, com subtarefa, deixaria filhas numa lista e mãe
  -- em outra, que a chave estrangeira composta recusaria no fim.
  --
  -- `passo` é o mesmo teto de segurança do guarda: o ciclo é impossível daqui
  -- para a frente, mas uma recursão sem freio sobre dado torto não termina.
  with recursive familia as (
    select t.id, 1 as passo
      from ideworks.tasks t
     where t.id = p_task_id
    union all
    select f.id, m.passo + 1
      from ideworks.tasks f
      join familia m on f.parent_id = m.id
     where m.passo < 200
  )
  update ideworks.tasks t
     set list_id    = p_list_id,
         status_id  = case
                        when t.id = p_task_id then v_novo
                        when exists (select 1 from ideworks.statuses s
                                      where s.id = t.status_id
                                        and s.status_set_id = v_set)
                          then t.status_id
                        else ideworks.first_open_status(v_set)
                      end,
         updated_at = now()
    from familia fa
   where t.id = fa.id;

  get diagnostics v_mexidas = row_count;

  if v_mexidas = 0 then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  -- O gatilho pode ter trocado o status (nao trocou, neste caminho) e carimbado
  -- a conclusao. Le-se de volta o que FICOU, e nao o que se pretendia.
  select t.status_id into v_novo from ideworks.tasks t where t.id = p_task_id;

  -- "E a mudanca fica registrada": a operacao DEVOLVE o que fez, para quem
  -- chama registrar e para a tela poder dizer "o status foi reposicionado".
  -- `subtasks_moved` e novo na F17.15: a tela avisa quando um arrasto levou
  -- trabalho junto, porque mover cinco subtarefas sem dizer nada e um efeito
  -- colateral invisivel.
  return jsonb_build_object(
    'task_id',             p_task_id,
    'list_id',             p_list_id,
    'previous_list_id',    v_lista_antes,
    'status_id',           v_novo,
    'previous_status_id',  v_status_antes,
    'status_repositioned', v_novo is distinct from v_status_antes,
    'subtasks_moved',      v_mexidas - 1);
end;
$fn$;

comment on function ideworks.move_task(uuid, uuid, uuid) is
  'Troca lista e status em bloco (regra 9), porque o status antigo pode nao '
  'existir na esteira nova. Desde a F17.15 move a SUBARVORE inteira na mesma '
  'escrita: mover so a mae seria recusado pela cascata da chave estrangeira '
  'batendo em tasks_status_guard. Sem status escolhido: mantem o atual se ele '
  'existir la, senao cai no primeiro que abre. Devolve o que fez, inclusive '
  'quantas subtarefas foram junto.';

-- --- o checklist, que vive na tarefa ------------------------------------------
create table if not exists ideworks.task_checklists (
  id         uuid primary key default gen_random_uuid(),

  -- `cascade`: o checklist é parte da tarefa, não trabalho de outro dono. Fora
  -- dela ele não quer dizer nada. Mesma decisão de `task_assignees` (F4.8) e
  -- `task_watchers` (F17.10).
  task_id    uuid not null references ideworks.tasks (id) on delete cascade,

  -- No ClickUp o padrão se chama `Checklist`, e a tarefa pode ter vários — a
  -- tela real mostra três cartões empilhados. Por isso é COLEÇÃO NOMEADA, e não
  -- uma lista solta de itens pendurada na tarefa.
  name       text not null,

  sort_order integer not null default 0,

  source_id  text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A regra de nome da F17.4. Ver o cabeçalho: os itens de checklist da origem
  -- têm nome `{}`, resíduo do Trello, e esta é a trava que impede isso de nascer
  -- aqui.
  constraint task_checklists_name_is_a_name check (ideworks.is_meaningful_name(name))
);

create unique index if not exists task_checklists_source_key
  on ideworks.task_checklists (source_id) where source_id is not null;

create index if not exists task_checklists_task_idx
  on ideworks.task_checklists (task_id, sort_order);

comment on table ideworks.task_checklists is
  'A colecao nomeada de itens dentro da tarefa — `Checklist` e o nome padrao no '
  'ClickUp. Uma tarefa pode ter VARIOS, e a contagem resolvidos/total e POR '
  'checklist: e assim que a tela real mostra tres cartoes empilhados.';
comment on column ideworks.task_checklists.name is
  'Passa por ideworks.is_meaningful_name: nome vazio, so espaco ou so pontuacao '
  'e recusado. E a trava contra o `{}` do Trello, que suja os itens da origem.';
comment on column ideworks.task_checklists.source_id is
  'O id deste checklist no ClickUp. A importacao saiu do plano em 2026-08-25, e '
  'a coluna fica porque o custo dela e zero e reconstrui-la depois exigiria '
  'migration com a tabela ja cheia.';

-- --- o item, que resolve ------------------------------------------------------
create table if not exists ideworks.checklist_items (
  id             uuid primary key default gen_random_uuid(),
  checklist_id   uuid not null
                 references ideworks.task_checklists (id) on delete cascade,

  -- O `children` do ClickUp. UM nível só, e a prova disso é geométrica: ver as
  -- duas colunas geradas abaixo.
  parent_item_id uuid,

  -- AS DUAS COLUNAS QUE SUBSTITUEM UM GATILHO INTEIRO.
  --   `nest_level`   0 para item, 1 para filho de item.
  --   `parent_level` -1 para item, 0 para filho — o nível que o pai DEVE ter.
  --
  -- A chave estrangeira composta lá embaixo liga `parent_level` a `nest_level`.
  -- Um item de nível 0 pede pai de nível -1, que nenhuma linha tem: ele só pode
  -- existir sem pai. Um filho de nível 1 pede pai de nível 0.
  --
  -- Como o nível ESTRITAMENTE DECRESCE do filho para o pai, ciclo é impossível
  -- por construção — não há caminho que volte. É o mesmo problema que em `tasks`
  -- exigiu um gatilho, resolvido aqui sem nenhum, porque aqui a profundidade é
  -- fixa e lá ela é livre.
  nest_level     smallint generated always as
                 (case when parent_item_id is null then 0 else 1 end) stored,
  parent_level   smallint generated always as
                 (case when parent_item_id is null then -1 else 0 end) stored,

  name           text not null,
  sort_order     integer not null default 0,

  -- INSTANTE, E NÃO BOOLEANO — a regra do projeto. Responde "resolvido desde
  -- quando?", que é o que a ficha mostra ao passar o ponteiro.
  --
  -- NÃO HÁ `resolved_by`, e a ausência é deliberada: o ClickUp não guarda quem
  -- resolveu o item do checklist. Inventar a coluna faria a réplica dizer mais
  -- do que a origem sabe, e ninguém teria como preenchê-la de volta.
  resolved_at    timestamptz,

  -- O `assignee` do ClickUp: UM responsável por item, e não vários. Medido na
  -- API da origem — é um campo, não uma lista. `auth.users` e não `profiles`,
  -- como todas as outras referências a pessoa no schema.
  assignee_id    uuid references auth.users (id) on delete set null,

  source_id      text,

  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint checklist_items_name_is_a_name check (ideworks.is_meaningful_name(name)),

  -- O trio que a chave estrangeira composta referencia.
  constraint checklist_items_id_level_key unique (id, nest_level, checklist_id),

  -- Um nível, mesmo checklist, sem ciclo — tudo numa restrição só.
  constraint checklist_items_parent_fk
    foreign key (parent_item_id, parent_level, checklist_id)
    references ideworks.checklist_items (id, nest_level, checklist_id)
    on delete cascade
);

create unique index if not exists checklist_items_source_key
  on ideworks.checklist_items (source_id) where source_id is not null;

create index if not exists checklist_items_checklist_idx
  on ideworks.checklist_items (checklist_id, sort_order);

-- "O que me pediram" — o outro sentido, que a F17.13 vai listar. Mesmo par de
-- `task_assignees_user_idx` na F4.8 e `task_watchers_user_idx` na F17.10.
create index if not exists checklist_items_assignee_idx
  on ideworks.checklist_items (assignee_id) where assignee_id is not null;

comment on table ideworks.checklist_items is
  'O item que resolve, dentro de um checklist. Pode ter responsavel (o '
  '`assignee` do ClickUp, UM por item) e pode ter filho (o `children`), de UM '
  'nivel so.';
comment on column ideworks.checklist_items.resolved_at is
  'Instante, nao booleano: responde "resolvido desde quando?". Sem coluna de '
  'autor — o ClickUp nao guarda quem resolveu o item, e inventa-la faria a '
  'replica dizer mais do que a origem sabe.';
comment on column ideworks.checklist_items.nest_level is
  'Gerada: 0 para item, 1 para filho de item. Junto com parent_level, e o que '
  'garante UM nivel de aninhamento e torna ciclo impossivel sem gatilho nenhum.';
comment on column ideworks.checklist_items.parent_level is
  'Gerada: o nivel que o pai DEVE ter. -1 para quem nao tem pai — e nenhuma '
  'linha tem nivel -1, entao item de nivel 0 so existe sem pai.';
comment on constraint checklist_items_parent_fk on ideworks.checklist_items is
  'Tres coisas numa restricao so: o pai esta um nivel acima, esta no mesmo '
  'checklist, e nao ha ciclo — o nivel decresce estritamente, entao nao ha '
  'caminho de volta.';
comment on column ideworks.checklist_items.name is
  'Passa por ideworks.is_meaningful_name. E aqui que a trava importa: os itens '
  'de checklist medidos na origem tem nome `{}`, residuo do Trello.';

-- --- o alcance, sem regra nova ------------------------------------------------
-- O alcance do checklist É o alcance da tarefa, e o do item é o do checklist.
-- Nenhuma expressão nova: `can_reach_task_id` é da F17.3 e já serve
-- `task_assignees` e `task_watchers`.
--
-- ELA RECEBE O ID DO CHECKLIST, E NÃO AS COLUNAS DELE, e isso é seguro — ao
-- contrário do caso medido na F17.2b. Lá a função recebia o id da linha SENDO
-- INSERIDA, e o `with check` julgava uma linha que a subconsulta ainda não
-- enxergava. Aqui a subconsulta é em OUTRA tabela, e o checklist já existe antes
-- de o item ser inserido — senão a chave estrangeira recusaria primeiro.
create or replace function ideworks.can_reach_checklist(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_reach_task_id(k.task_id)
    from ideworks.task_checklists k
   where k.id = target
$fn$;

comment on function ideworks.can_reach_checklist(uuid) is
  'O alcance do checklist e o alcance da TAREFA dele — can_reach_task_id da '
  'F17.3, nao uma segunda regra. Checklist inexistente devolve nulo, e nulo '
  'nega.';

-- --- resolver o item (regra 9, e o primeiro instante preservado) --------------
-- `coalesce` pelo mesmo motivo de `complete_task`: marcar de novo um item já
-- resolvido não reescreve quando ele foi. Desmarcar apaga o instante — guardá-lo
-- faria "resolvido desde" mentir na próxima vez, que é a decisão que
-- `set_task_archived` tomou na F4.8.
--
-- RESOLVER O PAI NÃO RESOLVE OS FILHOS, e não resolver o filho não impede
-- resolver o pai. É o comportamento da origem, e o contrário seria a réplica
-- decidindo pela equipe o que "este passo está feito" quer dizer.
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
     and ideworks.can_reach_checklist(i.checklist_id);

  if not found then
    raise exception 'item de checklist nao encontrado ou fora do seu alcance'
      using errcode = '42501';
  end if;
end;
$fn$;

comment on function ideworks.set_checklist_item_resolved(uuid, boolean) is
  'Marca e desmarca o item. Preserva o PRIMEIRO instante — marcar de novo nao '
  'reescreve quando foi —, e desmarcar limpa, para "resolvido desde" nao mentir '
  'na proxima vez. Nao desce para os filhos nem sobe para o pai.';

-- --- segurança por linha ------------------------------------------------------
alter table ideworks.task_checklists enable row level security;
alter table ideworks.checklist_items enable row level security;

-- A MESMA função das políticas de `task_assignees` e `task_watchers`, e não uma
-- cópia da expressão. `task_checklists` também não tem lista nem cliente em mãos
-- — só o id da tarefa.
drop policy if exists task_checklists_select on ideworks.task_checklists;
create policy task_checklists_select on ideworks.task_checklists for select
  using (ideworks.can_reach_task_id(task_id));

drop policy if exists task_checklists_write on ideworks.task_checklists;
create policy task_checklists_write on ideworks.task_checklists for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

drop policy if exists checklist_items_select on ideworks.checklist_items;
create policy checklist_items_select on ideworks.checklist_items for select
  using (ideworks.can_reach_checklist(checklist_id));

drop policy if exists checklist_items_write on ideworks.checklist_items;
create policy checklist_items_write on ideworks.checklist_items for all
  using      (ideworks.can_reach_checklist(checklist_id))
  with check (ideworks.can_reach_checklist(checklist_id));

-- --- a contagem, num lugar só -------------------------------------------------
-- CARTÃO, LINHA E FICHA LEEM DAQUI. Ver a decisão 2 do cabeçalho: três `count(*)`
-- escritos à mão em três consultas divergiriam no primeiro ajuste — é a dívida
-- 8.1 do legado, e o remédio é sempre o mesmo, uma definição só.
--
-- `security_invoker` para a view respeitar a política de quem consulta, como
-- `tree`, `list_workflow` e `task_labels`. Sem isso ela rodaria com os poderes
-- do dono e contaria subtarefa que quem pergunta não pode ver.
--
-- SUBTAREFA ARQUIVADA NÃO CONTA. Arquivar tira do quadro sem apagar (F4.8), e um
-- contador que somasse o arquivado diria `5` num cartão que abre com 3 — o
-- mesmo critério que `readTree` já usa para "tarefa viva".
--
-- ITEM DE CHECKLIST CONTA INTEIRO, filho incluído: a pergunta que o `0 de 1`
-- responde é "quanto deste checklist está feito", e um filho por fazer é
-- trabalho por fazer.
drop view if exists ideworks.task_progress;
create view ideworks.task_progress
  with (security_invoker = true)
as
select
  t.id as task_id,

  -- Filhas DIRETAS, e não a descendência inteira. A justificativa está na
  -- decisão 2 do cabeçalho; a recursão aparece navegando, não somando.
  (select count(*)
     from ideworks.tasks c
    where c.parent_id = t.id
      and c.archived_at is null)::int as subtask_count,

  (select count(*)
     from ideworks.tasks c
    where c.parent_id = t.id
      and c.archived_at is null
      and c.completed_at is not null)::int as subtask_done,

  (select count(*)
     from ideworks.task_checklists k
    where k.task_id = t.id)::int as checklist_count,

  (select count(*)
     from ideworks.checklist_items i
     join ideworks.task_checklists k on k.id = i.checklist_id
    where k.task_id = t.id)::int as checklist_total,

  (select count(*)
     from ideworks.checklist_items i
     join ideworks.task_checklists k on k.id = i.checklist_id
    where k.task_id = t.id
      and i.resolved_at is not null)::int as checklist_done

from ideworks.tasks t;

comment on view ideworks.task_progress is
  'A contagem de subtarefas e de itens de checklist da tarefa, numa definicao '
  'so — cartao, linha e ficha leem daqui. subtask_count e de filhas DIRETAS e '
  'nao conta arquivada; checklist_total conta o item e o filho dele.';

-- --- permissões ---------------------------------------------------------------
-- Expressão de política roda com os poderes de quem consulta: sem `execute`, o
-- papel do app bateria em "permission denied for function" em vez de bater na
-- regra. `task_parent_guard` não entra — permissão de função de gatilho é
-- conferida na criação do gatilho, não a cada disparo, e o mesmo vale para
-- `task_status_guard` desde a F17.3.
grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.can_reach_checklist(uuid)                  to ideworks_app;
grant execute on function ideworks.set_checklist_item_resolved(uuid, boolean) to ideworks_app;
grant execute on function ideworks.move_task(uuid, uuid, uuid)                to ideworks_app;
