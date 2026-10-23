-- =============================================================================
-- F17.65 — O HISTÓRICO DE MOVIMENTAÇÃO DA TAREFA
--
-- O PEDIDO, COM DUAS CAPTURAS DO PAINEL `Activity` DO CLICKUP
--   *"Helena alterou o status de Aprovação para Enviar Fotos Ao Cliente"*
--   *"removeu o responsável: Murilo Siqueira"*
--   *"alterou a lista de início de Estúdio Ide para ESTÚDIO"*
--   *"Nara criou esta tarefa"*
--   — e os comentários no meio, na mesma linha do tempo.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O QUE FOI MEDIDO ANTES DE ESCREVER UMA LINHA, EM 2026-09-03
--
--     `ideworks.task_events`      1 linha
--     `ideworks.tasks`         1.829 tarefas
--     `tasks.created_by` nulo  1.758 tarefas  (96%)
--     `task_comments`             13 linhas
--     tarefa com 2+ responsáveis   0  (mas o seletor É de marcar vários)
--
--   O livro existe desde a F17.41 e está VAZIO, porque ele só sabe falar de
--   AUTOMAÇÃO. Trocar status, responsável ou lista à mão não deixa rastro.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ⚠️ A DECISÃO QUE MUDOU O DESENHO: `automation_name` DEIXA DE SER `not null`
--
--   A F17.41 pôs essa coluna obrigatória porque, ali, TODA linha vinha de uma
--   regra — e o nome dela era o retrato do instante. Isso deixou de valer: uma
--   troca à mão não tem automação nenhuma, e portanto NÃO TEM NOME A PÔR.
--
--   As duas saídas possíveis eram preencher com mentira (`''`, `'manual'`) ou
--   mexer no esquema. Preencher com mentira faz a TELA mentir, e não só o
--   banco: o nome da regra é o SUJEITO da frase do registro — a peça desenha
--   `<b>{automationName}</b>` como cabeçalho da linha. Uma tarefa que a Helena
--   moveu apareceria encabeçada por `manual`, ou por um negrito vazio.
--
--   Então: `null` quer dizer "não foi regra nenhuma, foi gente" — a MESMA
--   codificação que `automation_id` já usa, e o `actor_id` (que já existe) diz
--   quem. Nenhuma coluna nova para isso, nenhum `kind`: a espécie do evento se
--   lê das colunas que mudaram.
--
--   E a coerência vira restrição, para o par não poder ficar meio a meio:
--   evento à mão não tem regra, então `automation_name` nulo exige
--   `automation_id` nulo. O contrário continua legal — regra APAGADA deixa o
--   nome e perde o id, que é o desenho da F17.41.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ⚠️ `added_user_ids`: O SELETOR DE PESSOAS É DE MARCAR VÁRIOS
--
--   `added_user_id` é SINGULAR porque a automação da F17.41 só sabe pôr UMA
--   pessoa — a regra tem um `assignee_id`. Mas `MenuDePessoas` (F17.3) é de
--   marcar vários, e `set_task_assignees(uuid[])` troca a lista inteira: uma
--   gravação à mão pode ADICIONAR duas pessoas de uma vez. Hoje nenhuma tarefa
--   tem duas — medido —, e "hoje ninguém faz" não é resposta para um livro.
--
--   Daí `added_user_ids`, espelho exato de `removed_user_ids`, que já é
--   conjunto pela mesma razão.
--
--   ⚠️ E A LINHA QUE JÁ EXISTE NÃO É TOCADA. Nada de `update` para copiar
--   `added_user_id` para dentro do array: O LIVRO NÃO SE REESCREVE, e isso vale
--   para a migration também. Os dois são DISJUNTOS por construção — a automação
--   escreve o escalar, a mão escreve o conjunto — e a leitura os CONCATENA, o
--   que não pode duplicar ninguém.
--
--   ⚠️ E A CAIXA DE ENTRADA (F17.46) NÃO MUDA DE COMPORTAMENTO POR ISSO. Ela lê
--   `where e.added_user_id = eu`. Como o caminho à mão nunca escreve o escalar,
--   passar uma tarefa para alguém à mão NÃO gera aviso — que é exatamente o que
--   era antes desta etapa. Aviso novo não foi pedido, e aviso que ninguém pediu
--   é ruído que ensina a ignorar a caixa inteira.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ⚠️ O NOME QUE SUMIU: QUATRO COLUNAS DE RETRATO, E SÓ COMO PARAQUEDAS
--
--   `from_list_id`, `to_list_id`, `from_status_id` e `to_status_id` são todas
--   `on delete set null`. Apagar uma etapa da esteira NÃO apaga o evento — mas
--   apaga o id dentro dele, e com o id vai embora a única forma de descobrir o
--   nome. O registro decairia para *"alterou o status de — para —"*.
--
--   Para um HISTÓRICO isso é fatal: ele existe justamente para ser lido depois,
--   quando a lista já mudou de nome, foi arquivada ou sumiu.
--
--   ⚠️ ISSO NÃO REVOGA A REGRA DA F4.8 (*"copia nao se atualiza quando a pessoa
--   muda de nome"*). O nome VIVO continua ganhando: a leitura junta com `lists`
--   e `statuses` e só cai no retrato quando a junção não devolve nada. Logo:
--     · renomear a lista  → o histórico inteiro passa a dizer o nome novo;
--     · apagar a lista    → o histórico continua dizendo o nome que ela tinha.
--
--   E o retrato NÃO se estende a PESSOA, de propósito: `display_name()` resolve
--   quem quer que ainda exista, e este projeto não apaga conta (D8 — o schema
--   `auth` é do legado e o IDE Works nunca cria nem apaga usuário). Copiar nome
--   de gente seria a cópia que a F4.8 proibiu, sem o perigo que a justifica.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ONDE A ESCRITA ENTRA — E NÃO HÁ CAMINHO NOVO (regra 9)
--
--   `move_task` já é o único caminho por onde lista e status mudam, e
--   `set_task_assignees` já é o único por onde a lista de responsáveis muda. O
--   registro entra DENTRO das duas, na mesma transação. Se o registro falhar, a
--   mudança inteira é recusada junto — livro pela metade é pior que livro
--   nenhum.
--
--   ⚠️ EM `move_task` O EVENTO À MÃO É OUTRO, E VEM ANTES DO DA AUTOMAÇÃO.
--   Quem empurrou a tarefa foi gente; a regra que disparou depois é um segundo
--   fato, de outro sujeito. Duas linhas, e o `id` (identidade crescente)
--   desempata as duas dentro do mesmo `now()` — `occurred_at` é o instante da
--   TRANSAÇÃO, e as duas escritas têm o mesmo.
--
--   ⚠️ A SUBÁRVORE NÃO GANHA LINHA, e é a mesma decisão da F17.41 para a
--   automação: quem se mexeu foi a tarefa movida; as filhas foram arrastadas
--   junto pela regra 9. Uma tarefa com trinta filhas geraria trinta e um
--   eventos por arrasto. Fica escrito como dívida: o histórico da FILHA não diz
--   que ela mudou de lista junto com a mãe.
--
--   ⚠️ E `complete_task` / `uncomplete_task` TAMBÉM MEXEM EM `status_id` —
--   medido, F17.23, linhas 873 e 897 — e continuam sem deixar evento. Não é
--   esquecimento: concluir já tem carimbo próprio na ficha (`completed_at`,
--   `completed_by`, desenhados em `rodapeDaFicha`), e transformar conclusão em
--   evento de etapa é outro pedido. Fica como dívida medida.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 6. ⚠️ O PASSADO NÃO SE FABRICA, E ISSO TEM UM NÚMERO
--
--   1.758 das 1.829 tarefas têm `created_by` NULO: vieram do ClickUp pela
--   importação, e o `created_at` delas é o INSTANTE DA IMPORTAÇÃO — três dias
--   distintos, 21/08, 01/09 e 02/09 de 2026 —, não a data em que alguém as
--   criou. Escrever *"criada em 21/08"* nelas seria inventar passado com cara
--   de fato.
--
--   Então a linha *"criou esta tarefa"* aparece SÓ quando `created_by` não é
--   nulo — 71 tarefas, as que nasceram aqui dentro. Ela não é um evento
--   gravado: é lida de `tasks`, que já tem o par autor+instante desde a F4.8.
--   Zero linha fabricada, zero consulta a mais.
--
--   Nada é gravado retroativamente. O histórico começa vazio e enche a partir
--   de agora.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 7. O QUE ESTA MIGRATION NÃO FAZ
--   · Não cria política de `update` nem de `delete` em `task_events`. A
--     ausência continua sendo a regra: com segurança por linha ligada, o que
--     não tem política permissiva é recusado. O livro não se reescreve.
--   · Não toca em `public`, nem em `auth`, nem em tarefa nenhuma.
--   · Não inventa coluna para o que a captura mostra e a tabela não guarda:
--     mudança de NOME e de PRAZO da tarefa. Coluna que ninguém preenche é pior
--     que coluna ausente — fica na dívida.
-- =============================================================================

set local lock_timeout = '15s';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — o livro passa a caber a escrita à mão
-- ─────────────────────────────────────────────────────────────────────────────

alter table ideworks.task_events
  alter column automation_name drop not null;

alter table ideworks.task_events
  add column if not exists added_user_ids uuid[] not null default '{}'::uuid[];

alter table ideworks.task_events
  add column if not exists from_list_name   text,
  add column if not exists to_list_name     text,
  add column if not exists from_status_name text,
  add column if not exists to_status_name   text;

-- Evento à mão não tem regra. O contrário — nome sem id — continua valendo: é
-- a regra APAGADA, e o nome dela é o retrato que sobrevive (F17.41).
alter table ideworks.task_events
  drop constraint if exists task_events_manual_has_no_rule;
alter table ideworks.task_events
  add constraint task_events_manual_has_no_rule
  check (automation_name is not null or automation_id is null);

-- O EVENTO TEM DE DIZER ALGUMA COISA. Sem isto, um `set_task_assignees` que
-- regrava a mesma lista, ou um `move_task` que regrava a mesma etapa, encheria
-- o histórico de linhas em branco — e histórico com ruído não se lê.
--
-- ⚠️ A conferência é do BANCO e não do código que escreve, porque `move_task` é
-- `security invoker` e `set_task_assignees` é `security definer`: são dois
-- caminhos, e a regra tem de ser uma só (dívida 8.1).
alter table ideworks.task_events
  drop constraint if exists task_events_says_something;
alter table ideworks.task_events
  add constraint task_events_says_something
  check (
    from_list_id   is distinct from to_list_id
    or from_status_id is distinct from to_status_id
    or removed_user_ids <> '{}'::uuid[]
    or added_user_ids   <> '{}'::uuid[]
    or added_user_id    is not null
  );

comment on table ideworks.task_events is
  'O livro da tarefa: o que mudou nela, por quem ou por qual regra, e quando. '
  'Guarda IDS, e o nome sai do perfil, da lista e da etapa na hora de ler — '
  'copia nao se atualiza. As colunas *_name sao PARAQUEDAS: so valem quando a '
  'lista ou a etapa foi APAGADA e o id virou nulo. Escrevem aqui move_task '
  '(mudanca de lista e de etapa, a mao e por automacao) e set_task_assignees '
  '(quem cuida). Nada apaga nem reescreve: nao ha politica de update nem de '
  'delete, de proposito.';

comment on column ideworks.task_events.automation_name is
  'Retrato do nome da regra no instante em que ela rodou, ou NULO quando a '
  'mudanca foi feita A MAO — nesse caso quem fez esta em actor_id. Vazio ou '
  '"manual" fariam a tela mentir: este nome e o sujeito da frase do registro.';

comment on column ideworks.task_events.added_user_ids is
  'Quem ENTROU numa troca feita a mao. Espelho de removed_user_ids, e conjunto '
  'porque o seletor de pessoas e de marcar varios. E DISJUNTO de added_user_id, '
  'que so a automacao escreve: a leitura concatena os dois.';

comment on column ideworks.task_events.from_list_name is
  'Paraquedas. O nome VIVO ganha sempre; este so aparece quando a lista foi '
  'apagada e from_list_id virou nulo.';
comment on column ideworks.task_events.to_list_name is
  'Paraquedas. Ver from_list_name.';
comment on column ideworks.task_events.from_status_name is
  'Paraquedas. O nome VIVO ganha sempre; este so aparece quando a etapa foi '
  'apagada e from_status_id virou nulo.';
comment on column ideworks.task_events.to_status_name is
  'Paraquedas. Ver from_status_name.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — `set_task_assignees` passa a registrar
--
-- O texto é o da F17.23 palavra por palavra, com o diff e o registro no fim.
-- Nada do que já existia mudou de comportamento.
--
-- ⚠️ DA F17.23, E NÃO DA F17.3 — E ISSO QUASE VIROU UM BURACO DE PERMISSÃO.
-- A primeira escrita desta etapa copiou o corpo da F17.3, que pergunta
-- `can_reach_task(...)`. Mas a F17.23 já havia substituído essa pergunta por
-- `can_act_on_task(..., 'execute')` — alcance MAIS nível —, e a cópia teria
-- AFROUXADO a permissão de trocar responsável sem ninguém pedir. Quem pegou foi
-- `conferir-schema.mjs`, comparando o corpo da função com o retrato: é
-- exatamente a rede que a F17.2c criou para isto. Ao reescrever uma função
-- antiga, o texto de partida é o do BANCO, não o da migration que a criou.
--
-- ⚠️ ELA CONTINUA `security definer`, e o registro entra DEPOIS da conferência
-- de alcance que já estava lá. Rodando como dono, o `insert` não passa pela
-- política de `task_events` — e não precisa: a pergunta de alcance é a MESMA
-- (`can_reach_task`), feita cinco linhas acima, e repeti-la seria a dívida 8.1.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function ideworks.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
declare
  v_antes   uuid[];
  v_depois  uuid[];
  v_tirados uuid[];
  v_postos  uuid[];
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id
       and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  -- O RETRATO DE ANTES, e ele é tirado AQUI e não depois: a escrita é um
  -- apaga-e-põe, e depois dela não há mais de onde saber quem estava.
  select coalesce(array_agg(a.user_id order by a.user_id), '{}'::uuid[])
    into v_antes
    from ideworks.task_assignees a
   where a.task_id = p_task_id;

  delete from ideworks.task_assignees where task_id = p_task_id;

  -- `distinct` porque a tela pode mandar repetido, e a chave primaria recusaria
  -- com uma mensagem que ninguem entende.
  insert into ideworks.task_assignees (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;

  -- ⚠️ O RETRATO DE DEPOIS SAI DA TABELA, e não de `p_user_ids`. Esta função
  -- DESCARTA em silêncio quem não tem perfil no IDE Works — está no comentário
  -- dela desde a F4.8 —, e registrar o que foi PEDIDO em vez do que FICOU faria
  -- o livro afirmar uma atribuição que não existe. É o mesmo argumento de
  -- `patchBoardTask`, que relê a ficha depois de escrever.
  select coalesce(array_agg(a.user_id order by a.user_id), '{}'::uuid[])
    into v_depois
    from ideworks.task_assignees a
   where a.task_id = p_task_id;

  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_tirados
    from unnest(v_antes) as x where not (x = any (v_depois));

  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_postos
    from unnest(v_depois) as x where not (x = any (v_antes));

  -- REGRAVAR A MESMA LISTA NÃO É EVENTO. A restrição do banco recusaria a linha
  -- em branco; recusar aqui é o mesmo que ela diz, com a diferença de não
  -- abortar uma gravação legítima que só não mudou nada.
  if v_tirados <> '{}'::uuid[] or v_postos <> '{}'::uuid[] then
    insert into ideworks.task_events
      (task_id, automation_id, automation_name,
       removed_user_ids, added_user_ids, actor_id)
    values
      (p_task_id, null, null,
       v_tirados, v_postos, ideworks.acting_user_id());
  end if;
end;
$fn$;

comment on function ideworks.set_task_assignees(uuid, uuid[]) is
  'Troca a lista inteira. Ignora quem nao tem perfil no IDE Works: atribuir '
  'tarefa a quem nao entra no sistema e atribuir a ninguem. Responsavel '
  'desativado continua na tarefa — historico nao se reescreve. Desde a F17.65 '
  'grava em task_events quem SAIU e quem ENTROU, lidos da tabela depois da '
  'escrita e nao do que foi pedido; regravar a mesma lista nao vira evento.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 3 — `move_task`, com o registro DA MÃO antes do da automação
--
-- O texto é o da F17.41 palavra por palavra, com um `insert` novo e as quatro
-- colunas de retrato no `insert` que já existia. Nada do que já existia mudou
-- de comportamento — medido antes e depois.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- F17.41
  v_regra        ideworks.task_automations%rowtype;
  v_cliente      uuid;
  v_set_destino  uuid;
  v_tirados      uuid[] := '{}'::uuid[];
  v_lista_fim    uuid;
  v_status_fim   uuid;
begin
  if p_list_id is null then
    raise exception
      'mover exige a lista de destino. Para tirar a tarefa do quadro sem apaga-la, arquive-a com ideworks.set_task_archived.'
      using errcode = '22023';
  end if;

  -- Filtrado pela politica: tarefa fora do alcance simplesmente nao aparece.
  select t.status_id, t.list_id, t.client_id
    into v_status_antes, v_lista_antes, v_cliente
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

  -- AS DUAS COLUNAS NA MESMA ESCRITA, E A SUBÁRVORE INTEIRA TAMBÉM (F17.15).
  -- Em dois comandos, uma falha no meio deixaria a tarefa numa lista cujo
  -- quadro não tem a coluna dela — e, com subtarefa, deixaria filhas numa lista
  -- e mãe em outra, que a chave estrangeira composta recusaria no fim.
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

  v_lista_fim  := p_list_id;
  v_status_fim := v_novo;

  -- ═══ O REGISTRO DA MÃO — F17.65 ══════════════════════════════════════════
  -- *"Helena alterou o status de Aprovação para Enviar Fotos Ao Cliente"*.
  --
  -- ELE VEM ANTES DO DA AUTOMAÇÃO, e são dois fatos de sujeitos diferentes:
  -- quem empurrou a tarefa foi gente, e a regra que disparar em seguida é outra
  -- linha. Juntar os dois numa só apagaria de quem foi o gesto.
  --
  -- `automation_name` NULO é o que diz "foi à mão" — ver a nota 2 do cabeçalho.
  --
  -- OS QUATRO NOMES SÃO PARAQUEDAS, e são lidos AQUI porque depois pode não
  -- haver de onde: a etapa que a tarefa deixou pode ser apagada da esteira
  -- amanhã, e o `on delete set null` levaria o id junto. O nome VIVO continua
  -- ganhando na leitura.
  --
  -- ⚠️ REGRAVAR A MESMA COISA NÃO É EVENTO: sem esta condição, todo arrasto que
  -- solta o cartão na coluna de onde saiu viraria linha em branco no histórico.
  if p_list_id is distinct from v_lista_antes
     or v_novo is distinct from v_status_antes then
    insert into ideworks.task_events
      (task_id, automation_id, automation_name,
       from_list_id, to_list_id, from_status_id, to_status_id,
       from_list_name, to_list_name, from_status_name, to_status_name,
       actor_id)
    select
      p_task_id, null, null,
      v_lista_antes, p_list_id, v_status_antes, v_novo,
      (select l.name from ideworks.lists    l where l.id = v_lista_antes),
      (select l.name from ideworks.lists    l where l.id = p_list_id),
      (select s.name from ideworks.statuses s where s.id = v_status_antes),
      (select s.name from ideworks.statuses s where s.id = v_novo),
      ideworks.acting_user_id();
  end if;

  -- ═══ A AUTOMAÇÃO — F17.41 ════════════════════════════════════════════════
  -- CHEGAR é o par (lista, etapa) ter mudado. Regravar a mesma etapa na mesma
  -- lista não é chegada, e não dispara nada.
  --
  -- ⚠️ ESTE BLOCO É RETO: sem laço, sem recursão, sem chamada de volta a
  -- `move_task`. A regra encontrada roda UMA vez. E ela não poderia encontrar
  -- outra depois nem se alguém tentasse: o par de chegada tem papel 1 em
  -- `automation_stages`, e papel 1 nunca é gatilho — a chave primária de duas
  -- colunas daquela tabela é o que garante isso, sem gatilho nenhum. Ver a nota
  -- 2 do cabeçalho da migration da F17.41.
  --
  -- A SUBÁRVORE NÃO DISPARA. Quem chegou foi a tarefa movida; as filhas foram
  -- arrastadas junto pela regra 9. Automatizar cada filha faria um arrasto
  -- espalhar trabalho por listas que ninguém pediu.
  if p_list_id is distinct from v_lista_antes
     or v_novo is distinct from v_status_antes then
    select * into v_regra
      from ideworks.task_automations a
     where a.source_list_id = p_list_id
       and a.trigger_status_id = v_novo
       and a.is_active;
  end if;

  if v_regra.id is not null then
    -- --- encaminhar ---------------------------------------------------------
    if v_regra.target_list_id is not null then
      if not ideworks.can_see_list(v_regra.target_list_id) then
        raise exception
          'esta etapa encaminha a tarefa para uma lista fora do seu alcance, entao a mudanca nao foi feita. Peca a quem cuida do quadro.'
          using errcode = '42501';
      end if;

      v_set_destino := ideworks.resolve_status_set(v_regra.target_list_id);

      if v_set_destino is null then
        raise exception
          'esta etapa encaminha a tarefa para uma lista que ficou sem etapas, entao a mudanca nao foi feita. Ajuste a automacao dessa lista.'
          using errcode = '22023';
      end if;

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
         set list_id    = v_regra.target_list_id,
             status_id  = case
                            when t.id = p_task_id then v_regra.target_status_id
                            when exists (select 1 from ideworks.statuses s
                                          where s.id = t.status_id
                                            and s.status_set_id = v_set_destino)
                              then t.status_id
                            else ideworks.first_open_status(v_set_destino)
                          end,
             updated_at = now()
        from familia fa
       where t.id = fa.id;

      get diagnostics v_mexidas = row_count;

      if v_mexidas = 0 then
        raise exception
          'esta etapa encaminha a tarefa para uma lista fora do seu alcance, entao a mudanca nao foi feita. Peca a quem cuida do quadro.'
          using errcode = '42501';
      end if;

      select t.list_id, t.status_id into v_lista_fim, v_status_fim
        from ideworks.tasks t where t.id = p_task_id;
    end if;

    -- --- trocar quem cuida, SUBSTITUINDO ------------------------------------
    -- *"de forma que não fique mais responsável para o anterior"*: apaga a
    -- lista inteira e põe um. É o mesmo gesto de `set_task_assignees`.
    if v_regra.assignee_id is not null then
      if not ideworks.can_reach_task_for(v_regra.assignee_id, v_lista_fim, v_cliente) then
        raise exception
          'esta etapa passa a tarefa para alguem que nao alcanca a lista onde ela ficaria — a tarefa sumiria da tela dessa pessoa. Nada foi mudado.'
          using errcode = '42501';
      end if;

      select coalesce(array_agg(a.user_id), '{}'::uuid[]) into v_tirados
        from ideworks.task_assignees a
       where a.task_id = p_task_id and a.user_id <> v_regra.assignee_id;

      delete from ideworks.task_assignees where task_id = p_task_id;

      insert into ideworks.task_assignees (task_id, user_id)
      values (p_task_id, v_regra.assignee_id);
    end if;

    -- --- o registro ---------------------------------------------------------
    -- O MESMO `insert` da F17.41, com os quatro paraquedas a mais. Ele continua
    -- escrevendo `added_user_id` (o escalar) porque a regra só sabe pôr UMA
    -- pessoa, e porque a caixa de entrada da F17.46 lê exatamente essa coluna.
    insert into ideworks.task_events
      (task_id, automation_id, automation_name,
       from_list_id, to_list_id, from_status_id, to_status_id,
       from_list_name, to_list_name, from_status_name, to_status_name,
       removed_user_ids, added_user_id, actor_id)
    select
      p_task_id, v_regra.id, v_regra.name,
      p_list_id, v_lista_fim, v_novo, v_status_fim,
      (select l.name from ideworks.lists    l where l.id = p_list_id),
      (select l.name from ideworks.lists    l where l.id = v_lista_fim),
      (select s.name from ideworks.statuses s where s.id = v_novo),
      (select s.name from ideworks.statuses s where s.id = v_status_fim),
      coalesce(v_tirados, '{}'::uuid[]), v_regra.assignee_id,
      ideworks.acting_user_id();
  end if;

  -- "E a mudanca fica registrada": a operacao DEVOLVE o que fez, para quem
  -- chama registrar e para a tela poder dizer o que aconteceu sozinho.
  return jsonb_build_object(
    'task_id',             p_task_id,
    'list_id',             v_lista_fim,
    'previous_list_id',    v_lista_antes,
    'status_id',           v_status_fim,
    'previous_status_id',  v_status_antes,
    'status_repositioned', v_novo is distinct from v_status_antes,
    'subtasks_moved',      v_mexidas - 1,
    'automation',          case
                             when v_regra.id is null then null
                             else jsonb_build_object(
                               'name',     v_regra.name,
                               'moved',    v_regra.target_list_id is not null,
                               'assigned', v_regra.assignee_id is not null,
                               'removed',  coalesce(array_length(v_tirados, 1), 0))
                           end);
end;
$fn$;

comment on function ideworks.move_task(uuid, uuid, uuid) is
  'Troca lista e status em bloco (regra 9), move a SUBARVORE inteira na mesma '
  'escrita (F17.15), roda a automacao da etapa de chegada na MESMA transacao '
  '(F17.41) e, desde a F17.65, grava DUAS linhas quando a regra dispara: a da '
  'MAO que empurrou e a da REGRA que reagiu — dois fatos de sujeitos '
  'diferentes. Regravar a mesma lista e a mesma etapa nao gera linha nenhuma. '
  'Devolve o que fez, inclusive o que a automacao fez.';

-- --- permissões ---------------------------------------------------------------
-- Nenhum privilégio novo: as duas funções já eram executáveis pelo papel do app,
-- e `task_events` já lhe era gravável. Repetido aqui porque `create or replace`
-- não mexe em `grant`, e escrever o que se espera é mais barato que descobrir.
grant execute on function ideworks.set_task_assignees(uuid, uuid[]) to ideworks_app;
grant execute on function ideworks.move_task(uuid, uuid, uuid)      to ideworks_app;
