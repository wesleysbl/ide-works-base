-- =============================================================================
-- IDE WORKS — F17.3  A tarefa entra no quadro
-- =============================================================================
-- ESTA É A ETAPA DE RISCO DO PLANO, E O RISCO TEM NOME
--   A F4.8 criou `ideworks.tasks` com `client_id uuid NOT NULL` e pendurou a
--   segurança por linha inteira nele — as seis políticas de `tasks` e
--   `task_assignees` chamam `ideworks.can_see_client(client_id)`, e as quatro
--   funções de ação repetem a mesma condição no `where`.
--
--   Ela está EM USO: é a aba "Demandas" do cliente no Pilar A′, com dado real
--   dentro. Esta migration mexe na chave e na política ao mesmo tempo.
--
-- O QUE FOI MEDIDO ANTES DE ESCREVER UMA LINHA — 2026-08-25
--   ideworks.tasks .................. 18 linhas
--     concluídas .................... 18 de 18 (`completed_at` preenchido)
--     arquivadas .................... 0
--     sem prazo ..................... 0
--     `completed_by` nulo ........... 18 de 18
--     `created_by` nulo ............. 18 de 18
--     clientes distintos ............ 6
--     empresas ...................... 2 — Ide (15 tarefas) e Ide Hub (3)
--   ideworks.task_assignees ......... 0 linhas
--   ideworks.spaces/folders/lists ... 0 linhas
--   ideworks.status_sets/statuses ... 0 linhas
--
--   As 18 vieram da F11d (`migrar_o_resto`), que traduz `public.demands`. Uma
--   delas tem prazo `82025-08-07` — ano oitenta e dois mil. É sujeira do
--   legado, entrou como está, e esta migration não a conserta: limpar dado de
--   produção por conta própria não é migração, é aposta (mesmo critério que a
--   F17.11 aplica às 18 tarefas chamadas `null` do ClickUp).
--
--   Três consequências práticas dessa medição:
--     · `task_assignees` vazia significa que a mudança de política ali não pode
--       quebrar nada hoje — mas ela é escrita como se pudesse, porque amanhã
--       tem dado.
--     · Nenhuma tarefa está arquivada nem pendente, então o preenchimento
--       retroativo cai todo no status que fecha.
--     · Duas empresas com tarefa, e não uma. É isso que decide onde mora a
--       lista de destino padrão — ver a seção própria mais abaixo.
--
-- O MOMENTO QUE A F4.8 ANUNCIOU
--   O cabeçalho da F4.8 diz, com todas as letras:
--
--     "Nao ha enum de status. O legado tem so `concluido`, e inventar um fluxo
--      de estados que nunca rodou seria modelar suposicao. (...) Quando a
--      equipe descrever um fluxo de verdade, ele entra como migration, com o
--      comportamento conhecido."
--
--   Este é esse momento. O fluxo de verdade chegou pela F17.2, medido no
--   ClickUp que a equipe opera todo dia: onze esteiras reais, com os cinco
--   tipos de status da origem. A tarefa passa a apontar para um status DAQUELAS
--   esteiras — e continua não havendo enum de status, porque o fluxo é dado,
--   não tipo.
--
-- A TAREFA GANHA LISTA; ELA NÃO PERDE CLIENTE
--   Na réplica do ClickUp a tarefa pertence à LISTA, e há listas que não são de
--   cliente nenhum: `ATENDIMENTO`, `ESTÚDIO`, `Alma9 (projetos)`. Então o
--   cliente vira opcional.
--
--   Opcional não é "some". As 18 linhas existentes seguem com cliente, ganham
--   lista, e continuam sendo lidas pelos dois caminhos. O alcance é a UNIÃO —
--   quem enxerga a lista OU quem enxerga o cliente:
--
--     tarefa sem cliente ....... alcance vem só da lista
--     tarefa sem lista ......... alcance vem só do cliente (o caminho do A′)
--     tarefa com os dois ....... vale qualquer um dos dois
--
--   Recusar o segundo caminho quando a lista é de outra empresa esconderia
--   trabalho de quem o faz — decisão registrada nos Casos de Borda do plano.
--
-- POR QUE `list_id` É ANULÁVEL, E ISSO NÃO É FRAQUEZA
--   Tornar a lista obrigatória quebraria o Pilar A′ no mesmo instante:
--   `createTask` em `src/server/tasks.ts` grava `(client_id, title,
--   description, due_on, created_by)` e não conhece lista nenhuma; a F11d
--   grava o mesmo conjunto ao reimportar; e `scripts/provar-demandas.mjs`,
--   que é a prova da F4.8, insere exatamente assim.
--
--   Obrigar a lista significaria pedir à tela do cliente que escolhesse um
--   quadro para cada demanda — mudança de método, e método é decisão do
--   usuário, não efeito colateral de uma migration.
--
--   O que NÃO pode existir é tarefa sem lista E sem cliente: ela não seria
--   alcançada por caminho nenhum, ficaria invisível para todo mundo e viva no
--   banco. `tasks_anchored` recusa isso de forma declarativa — restrição que
--   simplesmente não deixa, e não código que roda.
--
-- O INSTANTE DE FECHAMENTO JÁ EXISTIA, E CHAMA-SE `completed_at`
--   O plano pede "o instante de fechamento" na lista de campos novos. Ele não
--   entra como coluna nova, e isto é deliberado: a F4.8 já tem `completed_at` +
--   `completed_by`, e uma segunda coluna com o mesmo significado seria a dívida
--   1 do legado (chave dupla) reencenada — duas respostas para "concluída desde
--   quando?", divergindo na primeira vez que alguém escrevesse por um caminho
--   só. Regra 1 do roteiro: uma verdade, um lugar.
--
--   O que esta etapa entrega é o que faltava: `completed_at` passa a ser
--   ESCRITO PELO STATUS. Entrar no status que fecha carimba o instante; voltar
--   para um status que não fecha limpa. E o caminho velho continua: a caixinha
--   "Concluída" do A′ chama `complete_task`, que agora também move o status
--   quando a tarefa está num quadro — senão a tarefa apareceria concluída na
--   aba do cliente e parada na coluna `em edição` do quadro, que são duas
--   verdades de novo.
--
-- O TIPO DE TAREFA ENTRA COMO O CLICKUP O CHAMA
--   Medido: `Task` (`custom_item_id` 0 e 1001) e `Client` (1002). O catálogo —
--   nome e ícone do tipo, vivos no nível do espaço — é a F17.4, e está escrito
--   lá. Aqui entra só o que a TAREFA carrega: o identificador do tipo, com o
--   nome que a origem lhe dá, exatamente como a F17.1 manteve `content` para a
--   descrição da lista.
--
--   Consequência conhecida e declarada: até a F17.4 esse número não tem
--   integridade referencial. Um `check` com os três valores medidos seria pior
--   — o primeiro tipo customizado que a equipe criasse no ClickUp faria a
--   importação morrer, e a F17.11 existe justamente para copiar como está.
--
-- A DATA DE INÍCIO ENTRA VAZIA, DE PROPÓSITO
--   `start_date` existe no ClickUp e está SEMPRE NULA nos dois spaces. Entra
--   porque o importador vai precisar do campo — se ela não existir aqui, a
--   primeira tarefa que ganhar data de início na origem perde o dado em
--   silêncio.
--
--   Sem restrição de coerência com o prazo. Uma `check (start_on <= due_on)`
--   seria bonita e recusaria, um dia, uma tarefa real do ClickUp com as datas
--   trocadas — e a decisão do plano para dado da origem é copiar e relatar,
--   nunca recusar. Data invertida é sujeira; não é corrupção de estrutura.
--
-- O SEGUNDO GATILHO DO PROJETO, E POR QUE RESTRIÇÃO NÃO ALCANÇA
--   "O status da tarefa tem que pertencer à esteira RESOLVIDA da lista dela."
--   Essa frase atravessa quatro tabelas — `tasks` → `lists` → `status_sets`
--   (por lista, ou pasta, ou espaço) → `statuses` — e a resolução é uma função.
--   `check` não aceita subconsulta; chave estrangeira não sabe seguir herança.
--   Não existe forma declarativa.
--
--   Então é gatilho, pelo mesmo motivo que a F17.2 aceitou o dela: ocupa
--   exatamente o buraco que restrição não alcança, e nada além disso. As duas
--   metades que TÊM forma declarativa continuam sendo restrição:
--     · status sem lista .......... `tasks_status_needs_list`
--     · tarefa sem âncora nenhuma . `tasks_anchored`
--
--   `security definer` para a resolução ser FACTUAL. `resolve_status_set` é
--   `security invoker` de propósito (F17.2): consultada por quem não alcança o
--   espaço, ela devolve `null` em vez de vazar o id da esteira. Um guarda que
--   herdasse esse `null` aprovaria QUALQUER status para quem não enxerga a
--   esteira — o filtro de leitura viraria buraco de escrita. Dentro de um
--   `definer` a mesma função volta a ser factual, porque quem invoca ali é o
--   dono. Quem autoriza é a política de linha; quem confere o dado é o guarda.
--
-- MOVER É UMA OPERAÇÃO SÓ (REGRA 9)
--   Trocar a lista e trocar o status são a mesma escrita, porque o status
--   antigo pode não existir na esteira nova. Feitas em dois comandos, uma falha
--   no meio deixaria a tarefa numa lista cujo quadro não tem a coluna dela —
--   visível em lugar nenhum. `move_task` faz as duas em bloco, e devolve o que
--   fez.
--
-- O QUE A F4.8 GARANTIA CONTINUA GARANTINDO
--   Conclusão idempotente (`coalesce` preserva o primeiro instante e o primeiro
--   autor), arquivamento como instante e não booleano, responsáveis no plural
--   sem cópia de nome, prazo anulável que nunca produz "atrasado". Nada disso
--   muda. As quatro funções só trocam a condição de alcance — de
--   `can_see_client(client_id)` para os dois caminhos.
-- =============================================================================

-- --- a prioridade -------------------------------------------------------------
-- Os quatro valores da API do ClickUp. Medidos em uso nos dois spaces: urgent,
-- high e normal; `low` entra porque a origem o oferece e a importação copia o
-- que vier.
--
-- A ORDEM DO ENUM É A ORDEM DA URGÊNCIA, e isso é escolha. `order by priority`
-- devolve urgente primeiro sem que nenhuma consulta precise carregar uma tabela
-- de tradução — e uma ordem alfabética ('high', 'low', 'normal', 'urgent')
-- colocaria `low` em segundo lugar, que é o oposto do que qualquer tela quer.
do $$ begin
  create type ideworks.task_priority as enum ('urgent', 'high', 'normal', 'low');
exception when duplicate_object then null; end $$;

comment on type ideworks.task_priority is
  'Os quatro valores de prioridade do ClickUp, na ordem da urgencia — urgent '
  'primeiro. Nulo e "sem prioridade", que e o estado da maioria das tarefas na '
  'origem.';

-- --- a tarefa ganha quadro ----------------------------------------------------
alter table ideworks.tasks
  add column if not exists list_id        uuid,
  add column if not exists status_id      uuid,
  add column if not exists priority       ideworks.task_priority,
  add column if not exists custom_item_id integer,
  add column if not exists start_on       date,
  add column if not exists source_id      text;

-- `restrict`, e não `cascade`: apagar a lista levaria junto tarefa que pode ser
-- demanda do cliente, criada muito antes de existir quadro. O ClickUp apaga; a
-- réplica recusa e diz por quê, porque aqui a mesma linha tem dois donos
-- possíveis. Arquivar é o caminho normal — `archived_at` existe justamente para
-- isso. Vale também para a cascata de cima: apagar um espaço com trabalho
-- dentro para no `restrict` em vez de esvaziar o quadro em silêncio.
alter table ideworks.tasks
  drop constraint if exists tasks_list_fk;
alter table ideworks.tasks
  add constraint tasks_list_fk
  foreign key (list_id) references ideworks.lists (id) on delete restrict;

-- Mesma razão, e é o Caso de Borda escrito no plano: "se um conjunto de status
-- é apagado enquanto tarefas o usam, a operação é recusada — não se apaga o
-- chão de baixo dos pés de ninguém". Como `statuses` cai em cascata do
-- conjunto, este `restrict` é o que faz a recusa chegar lá em cima.
alter table ideworks.tasks
  drop constraint if exists tasks_status_fk;
alter table ideworks.tasks
  add constraint tasks_status_fk
  foreign key (status_id) references ideworks.statuses (id) on delete restrict;

-- Status sem lista não tem esteira a que pertencer: seria um status escolhido
-- de lugar nenhum, sem nada que o validasse. Declarativo, porque cabe.
alter table ideworks.tasks
  drop constraint if exists tasks_status_needs_list;
alter table ideworks.tasks
  add constraint tasks_status_needs_list
  check (status_id is null or list_id is not null);

-- A ÂNCORA. Esta é a restrição que torna seguro afrouxar `client_id`: uma
-- tarefa sem lista e sem cliente não é alcançada por caminho nenhum — some de
-- todas as telas e continua viva no banco, ocupando espaço e escondendo
-- trabalho. Ninguém a apagaria, porque ninguém a veria.
alter table ideworks.tasks
  drop constraint if exists tasks_anchored;
alter table ideworks.tasks
  add constraint tasks_anchored
  check (list_id is not null or client_id is not null);

-- O afrouxamento propriamente dito. Vem DEPOIS de `tasks_anchored` estar no
-- lugar: entre um comando e outro não existe instante em que a tarefa possa
-- nascer sem âncora nenhuma.
alter table ideworks.tasks alter column client_id drop not null;

create unique index if not exists tasks_source_key
  on ideworks.tasks (source_id) where source_id is not null;

-- O quadro lê por lista e agrupa por status; e é este índice que faz o
-- `restrict` da lista ser conferido sem varrer a tabela.
create index if not exists tasks_list_idx on ideworks.tasks (list_id, status_id);

-- Para o `restrict` do status, e para "quantas tarefas nesta coluna".
create index if not exists tasks_status_idx on ideworks.tasks (status_id);

comment on column ideworks.tasks.client_id is
  'Opcional desde a F17.3. Ha lista que nao e de cliente nenhum — ATENDIMENTO, '
  'ESTUDIO, Alma9 (projetos). Continua obrigatorio que a tarefa tenha PELO '
  'MENOS uma ancora: ver a restricao tasks_anchored.';
comment on column ideworks.tasks.list_id is
  'A lista onde a tarefa mora, no sentido do ClickUp. Anulavel porque a demanda '
  'do Pilar A pertence ao cliente e nao a quadro nenhum — e obrigar a lista '
  'mudaria o metodo da equipe, que nao e efeito colateral de migration.';
comment on column ideworks.tasks.status_id is
  'O status atual, que precisa pertencer a esteira RESOLVIDA da lista (lista -> '
  'pasta -> espaco). Conferido pelo gatilho task_status_guard, porque a regra '
  'atravessa quatro tabelas e nao tem forma declarativa.';
comment on column ideworks.tasks.custom_item_id is
  'O tipo de tarefa como o ClickUp o identifica: 0 e 1001 sao `Task`, 1002 e '
  '`Client`. O catalogo com nome e icone, no nivel do espaco, e a F17.4 — ate '
  'la este numero nao tem integridade referencial, e isso esta declarado.';
comment on column ideworks.tasks.start_on is
  'A data de inicio do ClickUp (`start_date`), medida SEMPRE NULA nos dois '
  'spaces. Existe para a importacao nao perder o dado em silencio no dia em que '
  'alguem preencher. Sem coerencia obrigatoria com o prazo: dado da origem se '
  'copia e se relata, nao se recusa.';
comment on column ideworks.tasks.source_id is
  'O id desta tarefa no ClickUp. E o que faz a importacao da F17.11 ser '
  'repetivel: rodar de novo atualiza, nunca duplica.';
comment on constraint tasks_anchored on ideworks.tasks is
  'Toda tarefa tem pelo menos uma ancora — lista ou cliente. Sem nenhuma das '
  'duas ela nao e alcancada por politica nenhuma: some de todas as telas e '
  'continua viva no banco.';

-- --- o alcance, num lugar só --------------------------------------------------
-- Mesma forma de `can_see_status_set` da F17.2: o alcance da lista É o alcance
-- do espaço dela, e não uma segunda regra. `security definer` para a resposta
-- ser um fato da árvore, e não uma opinião filtrada pela política de quem
-- pergunta.
--
-- Vai ser reusada pela F17.6 — anexo, link e comentário herdam o alcance da
-- tarefa, e a tarefa herda o da lista. Nenhuma delas terá política própria.
create or replace function ideworks.can_see_list(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_see_space(
           (select l.space_id from ideworks.lists l where l.id = target))
$fn$;

comment on function ideworks.can_see_list(uuid) is
  'O alcance da lista e o alcance do espaco dela — `can_see_space` da F17.1, '
  'nao uma segunda regra.';

-- OS DOIS CAMINHOS, NUMA FRASE SÓ.
--
-- Recebe as COLUNAS, e não o id da tarefa, pela mesma razão medida na F17.2b:
-- num `insert`, o `with check` julga a linha nova, e uma subconsulta em `tasks`
-- enxerga a fotografia do comando — que ainda não contém a linha sendo
-- inserida. A versão por id devolveria nulo, nulo nega, e ninguém criaria mais
-- tarefa nenhuma.
--
-- Com as duas âncoras nulas o resultado é `false`, e não nulo: `null is not
-- null` é `false`, e `false and qualquer coisa` é `false`. Ou seja, a política
-- recusa a tarefa sem âncora mesmo que a restrição `tasks_anchored` fosse
-- removida um dia. Duas redes, independentes.
create or replace function ideworks.can_reach_task(p_list_id uuid, p_client_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select (p_list_id   is not null and ideworks.can_see_list(p_list_id))
      or (p_client_id is not null and ideworks.can_see_client(p_client_id))
$fn$;

comment on function ideworks.can_reach_task(uuid, uuid) is
  'A regra de alcance da tarefa, num lugar so: enxerga quem enxerga a LISTA '
  'dela; quando ela tem CLIENTE, o alcance do cliente tambem vale. Uniao, e nao '
  'intersecao — recusar o segundo caminho esconderia trabalho de quem o faz.';

-- A mesma regra alcançada pelo id, que é o que `task_assignees` tem em mãos —
-- ela não guarda nem lista nem cliente. Par exato de `can_write_status_set` da
-- F17.2b: duas portas, uma regra atrás das duas.
--
-- `security definer` para a busca ser FACTUAL: sob a política de quem escreve,
-- uma tarefa fora do alcance sumiria da consulta e a resposta viraria "não
-- existe" em vez de "não pode". Tarefa inexistente devolve nulo, e nulo nega.
create or replace function ideworks.can_reach_task_id(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_reach_task(t.list_id, t.client_id)
    from ideworks.tasks t
   where t.id = target
$fn$;

comment on function ideworks.can_reach_task_id(uuid) is
  'A regra de `can_reach_task` alcancada pelo id da tarefa — que e o que '
  '`task_assignees` tem em maos. Tarefa inexistente devolve nulo, e nulo nega.';

-- --- as duas pontas da esteira ------------------------------------------------
-- "O primeiro que abre" é a regra do Caso de Borda: tarefa que muda para uma
-- esteira onde o status dela não existe cai aqui. Ela mora numa função só
-- porque três lugares a usam — o guarda, `move_task` e `uncomplete_task` — e
-- copiada em três lugares ela divergiria no primeiro ajuste.
--
-- A ordenação faz o tipo `open` ganhar (falso antes de verdadeiro), e só depois
-- desempata pela ordem da esteira. O `where` exclui o status que fecha: uma
-- esteira só com ele existiria, em tese, e devolver justamente o fim como
-- "começo" seria pior que devolver nada — quem chama recusa alto.
create or replace function ideworks.first_open_status(p_status_set_id uuid)
  returns uuid
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select s.id
    from ideworks.statuses s
   where s.status_set_id = p_status_set_id
     and s.type <> 'closed'::ideworks.status_type
   order by (s.type <> 'open'::ideworks.status_type), s.sort_order, s.name
   limit 1
$fn$;

comment on function ideworks.first_open_status(uuid) is
  'O comeco da esteira: o status de tipo `open` e, na falta dele, o primeiro na '
  'ordem entre os que nao fecham. E onde a tarefa cai quando muda para uma '
  'esteira que nao tem o status dela.';

-- O outro fim. A F17.2 garante que existe exatamente um por esteira — índice
-- único parcial para "nunca mais de um", gatilho de restrição para "nunca menos
-- de um" — então esta função devolve um valor ou nenhum, nunca uma escolha.
create or replace function ideworks.closing_status(p_status_set_id uuid)
  returns uuid
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select s.id
    from ideworks.statuses s
   where s.status_set_id = p_status_set_id
     and s.type = 'closed'::ideworks.status_type
$fn$;

comment on function ideworks.closing_status(uuid) is
  'O status que fecha a esteira. A F17.2 garante que ha exatamente um, entao '
  'aqui nao ha escolha a fazer — e o fim do quadro, e e ele que carimba '
  '`completed_at`.';

-- --- o guarda do status -------------------------------------------------------
-- O segundo gatilho do projeto. Ver a nota longa do cabeçalho: a regra
-- atravessa quatro tabelas e a resolução é uma função, então não há forma
-- declarativa. Ele faz três coisas, e nada além delas:
--
--   1. RECUSA status que não pertença à esteira resolvida da lista — alto, com
--      mensagem que diz o que fazer (regra 3 do roteiro).
--   2. PREENCHE o status quando a tarefa entra numa lista sem um. Isto não é
--      "default silencioso de valor desconhecido": é o comportamento da origem
--      — no ClickUp a tarefa criada sem status recebe o primeiro da lista — e é
--      a mesma regra que o Caso de Borda já manda aplicar na mudança de
--      esteira. Uma regra, dois pontos de entrada.
--   3. CARIMBA a conclusão a partir do TIPO do status, nos dois sentidos.
--
-- `security definer` porque `resolve_status_set` é `security invoker` de
-- propósito e devolveria `null` para quem não alcança o espaço — e um guarda
-- que herdasse esse `null` aprovaria qualquer status. Autorizar é com a
-- política; conferir o dado é com o guarda.
create or replace function ideworks.task_status_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_set        uuid;
  v_lista      text;
  v_tipo_novo  ideworks.status_type;
  v_tipo_velho ideworks.status_type;
  v_nome       text;
  v_mudou      boolean;
begin
  if new.list_id is not null then
    select l.name into v_lista from ideworks.lists l where l.id = new.list_id;

    -- Factual: dentro de `definer`, `resolve_status_set` volta a enxergar tudo.
    v_set := ideworks.resolve_status_set(new.list_id);

    if v_set is null then
      raise exception
        'a lista "%" nao tem esteira: nem ela, nem a pasta dela, nem o espaco declaram um conjunto de status. Crie a esteira com ideworks.create_status_set antes de por tarefa nela — sem esteira o quadro nao tem coluna nenhuma.',
        coalesce(v_lista, new.list_id::text)
        using errcode = '22023';
    end if;

    if new.status_id is null then
      new.status_id := ideworks.first_open_status(v_set);

      if new.status_id is null then
        raise exception
          'a esteira da lista "%" nao tem nenhum status que abra: so ha o que fecha. Acrescente ao menos um status de tipo "open" antes de por tarefa nela.',
          coalesce(v_lista, new.list_id::text)
          using errcode = '22023';
      end if;

    elsif not exists (
      select 1 from ideworks.statuses s
       where s.id = new.status_id and s.status_set_id = v_set
    ) then
      select s.name into v_nome from ideworks.statuses s where s.id = new.status_id;

      raise exception
        'o status % nao pertence a esteira da lista "%". O status da tarefa tem que sair da esteira RESOLVIDA da lista dela (lista -> pasta -> espaco); consulte ideworks.list_workflow para ver quais valem, ou use ideworks.move_task, que reposiciona sozinho.',
        coalesce(quote_literal(v_nome), 'informado'),
        coalesce(v_lista, new.list_id::text)
        using errcode = '23514';
    end if;
  end if;

  -- --- os instantes seguem o tipo do status ---------------------------------
  -- Só quando o status realmente mudou. Sem esta guarda, editar o título de uma
  -- tarefa concluída reescreveria `completed_by` para quem editou.
  v_mudou := new.status_id is distinct from (case when tg_op = 'UPDATE' then old.status_id end);

  if v_mudou then
    if new.status_id is not null then
      select s.type into v_tipo_novo from ideworks.statuses s where s.id = new.status_id;
    end if;
    if tg_op = 'UPDATE' and old.status_id is not null then
      select s.type into v_tipo_velho from ideworks.statuses s where s.id = old.status_id;
    end if;

    if v_tipo_novo = 'closed'::ideworks.status_type then
      -- `coalesce` pelo mesmo motivo de `complete_task`: quem concluiu e quando
      -- se guarda uma vez. Passar de novo pelo status que fecha nao reescreve
      -- historia.
      new.completed_at := coalesce(new.completed_at, now());
      new.completed_by := coalesce(new.completed_by, ideworks.acting_user_id());

    elsif v_tipo_velho = 'closed'::ideworks.status_type then
      -- Voltou para o quadro: a conclusao deixa de existir, inclusive o autor.
      -- Guardar o instante antigo faria "concluida desde" mentir na proxima vez
      -- — a mesma decisao que `set_task_archived` tomou na F4.8.
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;

  return new;
end;
$fn$;

comment on function ideworks.task_status_guard() is
  'O segundo gatilho do projeto, e so porque restricao nao alcanca: "o status '
  'pertence a esteira resolvida da lista" atravessa quatro tabelas e a '
  'resolucao e uma funcao. Recusa status de fora, preenche o primeiro que abre '
  'quando nao vem nenhum, e carimba a conclusao a partir do TIPO do status.';

drop trigger if exists tasks_status_guard on ideworks.tasks;
create trigger tasks_status_guard
  before insert or update on ideworks.tasks
  for each row execute function ideworks.task_status_guard();

-- --- mover é uma operação só (regra 9) ----------------------------------------
-- Trocar a lista e trocar o status saem juntos ou não saem. Ver o cabeçalho.
--
-- `security invoker`, como `create_status_set` da F17.2: a autorização é a
-- política de linha, e não uma segunda cópia da regra aqui dentro. O que a
-- função faz por conta própria é conferir o alcance do DESTINO antes de tentar
-- — chamando a mesma função que a política chama, para a recusa vir com "fora
-- do seu alcance" em vez de "esta lista nao tem esteira".
--
-- O status pode vir escolhido (o cartão arrastado para uma coluna específica) ou
-- não vir (o cartão arrastado para outra lista). Quando não vem, a regra do
-- Caso de Borda: se o status atual existe na esteira nova, ele fica; senão, cai
-- no primeiro que abre.
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

  -- As duas colunas na MESMA escrita. Em dois comandos, uma falha no meio
  -- deixaria a tarefa numa lista cujo quadro nao tem a coluna dela.
  update ideworks.tasks
     set list_id    = p_list_id,
         status_id  = v_novo,
         updated_at = now()
   where id = p_task_id;

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  -- O gatilho pode ter trocado o status (nao trocou, neste caminho) e carimbado
  -- a conclusao. Le-se de volta o que FICOU, e nao o que se pretendia.
  select t.status_id into v_novo from ideworks.tasks t where t.id = p_task_id;

  -- "E a mudanca fica registrada": a operacao DEVOLVE o que fez, para quem
  -- chama registrar e para a tela poder dizer "o status foi reposicionado".
  -- A linha do tempo da tarefa e a F17.10, e inventar aqui a tabela de eventos
  -- que ela vai desenhar seria adivinhar a forma dela.
  return jsonb_build_object(
    'task_id',             p_task_id,
    'list_id',             p_list_id,
    'previous_list_id',    v_lista_antes,
    'status_id',           v_novo,
    'previous_status_id',  v_status_antes,
    'status_repositioned', v_novo is distinct from v_status_antes);
end;
$fn$;

comment on function ideworks.move_task(uuid, uuid, uuid) is
  'Troca lista e status em bloco (regra 9), porque o status antigo pode nao '
  'existir na esteira nova. Sem status escolhido: mantem o atual se ele existir '
  'la, senao cai no primeiro que abre. Devolve o que fez, inclusive se '
  'reposicionou.';

-- --- as ações da F4.8 passam a conhecer os dois caminhos ----------------------
-- Só a condição de alcance muda. Toda a garantia continua: `coalesce` preserva
-- o primeiro instante e o primeiro autor, desarquivar limpa a data, a lista de
-- responsáveis é trocada inteira.
--
-- `complete_task` ganhou uma coisa a mais, e ela é obrigatória: quando a tarefa
-- está num quadro, concluir também move o status para o que fecha. Sem isso a
-- caixinha "Concluída" da aba do cliente e a coluna do quadro discordariam — e
-- duas verdades sobre o mesmo fato é exatamente a dívida que este projeto
-- existe para não repetir.
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
     and ideworks.can_reach_task(t.list_id, t.client_id);

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
     and ideworks.can_reach_task(t.list_id, t.client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_task_archived(p_task_id uuid, p_archived boolean)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks t
     set archived_at = case when p_archived then coalesce(t.archived_at, now()) else null end,
         updated_at  = now()
   where t.id = p_task_id
     and ideworks.can_reach_task(t.list_id, t.client_id);

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
     where t.id = p_task_id and ideworks.can_reach_task(t.list_id, t.client_id)
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

-- --- a segurança por linha, reescrita -----------------------------------------
-- As seis políticas da F4.8 chamavam `can_see_client(client_id)` direto. Com o
-- cliente opcional isso passaria a NEGAR toda tarefa de quadro — e negar em
-- silêncio, porque política que filtra devolve zero linhas, não erro.
--
-- Cada uma passa a chamar a mesma função. A expressão não é copiada para dentro
-- de nenhuma: seis cópias de uma regra de acesso é a dívida 8.1 do legado seis
-- vezes.
--
-- No `update`, `using` julga a linha ANTIGA e `with check` a NOVA — então tirar
-- uma tarefa de uma lista que se alcança para uma que não se alcança é recusado,
-- e vice-versa, sem caso especial.
drop policy if exists tasks_select on ideworks.tasks;
create policy tasks_select on ideworks.tasks for select
  using (ideworks.can_reach_task(list_id, client_id));

drop policy if exists tasks_insert on ideworks.tasks;
create policy tasks_insert on ideworks.tasks for insert
  with check (ideworks.can_reach_task(list_id, client_id));

drop policy if exists tasks_update on ideworks.tasks;
create policy tasks_update on ideworks.tasks for update
  using      (ideworks.can_reach_task(list_id, client_id))
  with check (ideworks.can_reach_task(list_id, client_id));

drop policy if exists tasks_delete on ideworks.tasks;
create policy tasks_delete on ideworks.tasks for delete
  using (ideworks.can_reach_task(list_id, client_id));

-- `task_assignees` não tem lista nem cliente: só o id da tarefa. Daí a versão
-- por id — a mesma razão pela qual a F17.2b precisou de duas funções.
drop policy if exists task_assignees_select on ideworks.task_assignees;
create policy task_assignees_select on ideworks.task_assignees for select
  using (ideworks.can_reach_task_id(task_id));

drop policy if exists task_assignees_write on ideworks.task_assignees;
create policy task_assignees_write on ideworks.task_assignees for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

-- --- a lista de destino padrão ------------------------------------------------
-- POR QUE ELA EXISTE
--   Nenhuma linha existente pode ficar órfã de lista. As 18 tarefas do A′
--   nasceram antes de haver quadro, e sem um destino elas ficariam sendo o
--   único caso do sistema que não aparece em quadro nenhum — invisível para a
--   F17.9 e para a F17.13.
--
-- POR QUE UMA POR EMPRESA, E NÃO UMA SÓ
--   Este é o ponto em que uma escolha descuidada VAZARIA DADO. O espaço
--   pertence a exatamente uma empresa (F17.1), e o alcance da tarefa passa a ser
--   a união lista OU cliente. Uma lista única, num espaço da empresa Ide,
--   entregaria as 3 tarefas de `Bela Enxovais` — que é da Ide Hub — a
--   qualquer pessoa que alcance a Ide, pelo caminho novo da lista.
--
--   Medido: as 18 tarefas estão em 2 empresas (Ide, 15; Ide Hub, 3). Com uma
--   lista por empresa, a lista da tarefa é sempre da MESMA empresa do cliente
--   dela, e a união não acrescenta ninguém. Quem via, vê; quem não via,
--   continua sem ver. É a única forma de cumprir "nenhuma órfã" sem alargar o
--   alcance de nada.
--
--   Por isso a criação é dirigida pelo DADO — uma para cada empresa que tem
--   tarefa —, e não por nomes escritos à mão. Hoje são duas; se amanhã a F11
--   trouxer tarefa de uma terceira, esta migration já rodou, e a lista dela
--   nasce pelo mesmo caminho que qualquer lista nasce: a tela.
--
-- ONDE ELA MORA
--   Espaço `Demandas` na empresa, sem pasta, lista `Todas as demandas` solta
--   dentro dele — o arranjo que a F17.1 já aceita e que `Casa Fiore` e
--   `Grupo VITTA` exercitam no ClickUp real.
--
--   `source_id` fica NULO nos três, e isso é de propósito: elas não vêm do
--   ClickUp, então a importação da F17.11 não deve casar com elas nem
--   sobrescrevê-las.
--
-- A ESTEIRA DELA TEM DOIS ESTADOS, E ISSO NÃO É PREGUIÇA
--   É o fluxo que o A′ REALMENTE roda. O legado tem `concluido boolean` e nada
--   mais; a F4.8 recusou inventar estados que nunca rodaram, e inventá-los aqui
--   seria o mesmo erro com outra roupa. `a fazer` e `concluída`, nos dois tipos
--   que importam — o que abre e o que fecha.
--
--   Ela é declarada no ESPAÇO, e não na lista: assim qualquer lista futura
--   criada nesse espaço já nasce com quadro, em vez de bater no guarda. É o
--   mesmo arranjo do padrão do espaço do ALMA 9 (esteira E7).
do $$
declare
  v_empresa  record;
  v_espaco   uuid;
  v_lista    uuid;
begin
  for v_empresa in
    select distinct c.category_id as id
      from ideworks.tasks t
      join ideworks.clients c on c.id = t.client_id
     where t.list_id is null
     order by 1
  loop
    insert into ideworks.spaces (category_id, name, sort_order)
    values (v_empresa.id, 'Demandas', 0)
    returning id into v_espaco;

    insert into ideworks.lists (space_id, name, content, sort_order)
    values (
      v_espaco, 'Todas as demandas',
      'Onde moram as demandas que ja existiam antes de a tarefa ganhar quadro '
      || '(F17.3). Nenhuma tarefa fica orfa de lista. Organizar em pastas e '
      || 'listas de verdade e trabalho da equipe, na tela.',
      0)
    returning id into v_lista;

    perform ideworks.create_status_set(
      p_name     => 'Demandas',
      p_statuses => jsonb_build_array(
        jsonb_build_object('name', 'a fazer',   'type', 'open',   'color', '#d3d3d3'),
        jsonb_build_object('name', 'concluída', 'type', 'closed', 'color', '#6bc950')),
      p_space_id => v_espaco);

    -- O preenchimento retroativo. O gatilho confere cada linha: se o status não
    -- pertencesse à esteira desta lista, a migration inteira pararia aqui.
    --
    -- O status sai do que a tarefa JÁ DIZ de si — concluída vai para o que
    -- fecha, o resto para o que abre. E o `coalesce` do gatilho preserva
    -- `completed_at` como está: nenhuma das 18 tem a conclusão reescrita para
    -- hoje.
    update ideworks.tasks t
       set list_id   = v_lista,
           status_id = case
                         when t.completed_at is not null
                         then ideworks.closing_status(ideworks.resolve_status_set(v_lista))
                         else ideworks.first_open_status(ideworks.resolve_status_set(v_lista))
                       end
      from ideworks.clients c
     where c.id = t.client_id
       and c.category_id = v_empresa.id
       and t.list_id is null;
  end loop;
end $$;

-- A conferência de que o preenchimento não deixou ninguém para trás. Falhar
-- aqui é falhar ANTES de a migration terminar, e não semanas depois numa tela
-- vazia (regra 3 do roteiro).
do $$
declare v_orfas integer;
begin
  select count(*) into v_orfas from ideworks.tasks where list_id is null;

  if v_orfas > 0 then
    raise exception
      'a F17.3 deixaria % tarefa(s) orfas de lista, e o plano exige zero. Nada foi gravado.',
      v_orfas;
  end if;
end $$;

-- --- permissões ---------------------------------------------------------------
-- Expressão de política roda com os poderes de quem consulta: sem `execute`, o
-- papel do app bateria em "permission denied for function" em vez de bater na
-- regra. `task_status_guard` não entra — permissão de função de gatilho é
-- conferida na criação do gatilho, não a cada disparo, e o mesmo vale para
-- `status_set_must_close` desde a F17.2.
grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.can_see_list(uuid)              to ideworks_app;
grant execute on function ideworks.can_reach_task(uuid, uuid)      to ideworks_app;
grant execute on function ideworks.can_reach_task_id(uuid)         to ideworks_app;
grant execute on function ideworks.first_open_status(uuid)         to ideworks_app;
grant execute on function ideworks.closing_status(uuid)            to ideworks_app;
grant execute on function ideworks.move_task(uuid, uuid, uuid)     to ideworks_app;
