-- =============================================================================
-- IDE WORKS — F17.3c  A invariante do status, guardada por inteiro
-- =============================================================================
-- ESTA MIGRATION NÃO ACRESCENTA REGRA NENHUMA. Ela termina de guardar as duas
-- regras que a F17.3 escreveu e guardou pela metade:
--
--   1. "o status da tarefa pertence à esteira RESOLVIDA da lista dela"
--   2. "a conclusão é carimbada a partir do TIPO do status, nos dois sentidos"
--
-- É o mesmo padrão que a F17.4b fechou do lado da etiqueta: guardam-se as
-- colunas que mexem no OBJETO, esquecem-se as que mudam a ÁRVORE por baixo dele
-- — e, aqui, também o caminho de escrita em que `old` não existe.
--
-- ============================================ O QUE A F17.3 GUARDA HOJE ======
--   `tasks_status_guard` é um gatilho `before insert or update on tasks`. Ele
--   olha `new.list_id` e `new.status_id` — as duas colunas DA TAREFA — e nada
--   mais. A frase que ele defende, porém, atravessa QUATRO tabelas:
--
--     tasks.status_id → statuses.status_set_id
--     tasks.list_id   → lists.folder_id / lists.space_id
--                     → status_sets.list_id / .folder_id / .space_id
--
--   Toda coluna que aparece nesse desenho é uma porta. As duas primeiras estão
--   guardadas desde a F17.3; as outras seis não estavam.
--
-- ================== A SONDA QUE EXPÔS AS PORTAS, E POR QUE ELA FICA ESCRITA ==
-- ================== AQUI =====================================================
--   Medido em 2026-08-25 como `ideworks_app` (o papel do Worker, sujeito às
--   políticas), tudo em transação revertida, com savepoint que volta MESMO
--   QUANDO O CASO PASSA — a armadilha que a sonda da F17.4b relatou. Árvore da
--   sonda: dois espaços da mesma empresa, um com esteira e outro sem, uma pasta
--   com lista dentro, uma lista solta, e tarefas PARADAS com status válido.
--
--   ESTE REGISTRO É O QUE IMPEDE ALGUÉM DE APAGAR OS GATILHOS DAQUI A UM ANO
--   ACHANDO QUE SÃO REDUNDANTES. Nenhum deles repete `tasks_status_guard`: cada
--   um fecha uma coluna que ele não alcança.
--
--   AS PORTAS DA ÁRVORE — todas PASSAVAM
--     caminho                                            efeito medido
--     ------------------------------------------------   ------------------------
--     insert status_sets (list_id)  — esteira da LISTA    a resolução muda por
--       (e as formas em lote: `insert ... select`,          baixo da tarefa parada
--        `on conflict do update`)                           PERTENCE=false
--     insert status_sets (folder_id) — esteira da PASTA   idem
--     update status_sets.space_id  → espaço sem esteira   `resolve_status_set`
--                                                          devolve NULL: a lista
--                                                          fica SEM esteira
--     update status_sets.space_id → folder_id (troca de   idem — NULL
--       NÍVEL, na mesma escrita)
--     update status_sets.space_id → list_id (idem)        idem — NULL
--     update status_sets.list_id  → outra lista           a lista de origem cai
--                                                          para a esteira de cima
--     update status_sets.folder_id → outra pasta          idem
--     update statuses.status_set_id — mover um STATUS     o status da tarefa fica
--       (também em lote, com `where`)                      ÓRFÃO da esteira dela
--     update lists.space_id                               PASSA — e quebra o
--                                                          status junto (era o
--                                                          achado RELATADO no
--                                                          cabeçalho da F17.4b)
--     update lists.folder_id → pasta COM esteira própria  a resolução sobe para a
--                                                          pasta; PERTENCE=false
--     update lists.folder_id → null, saindo de pasta que  a resolução cai para o
--       tinha a esteira em uso                             espaço; PERTENCE=false
--
--   O CAMINHO MAIS BARATO É O PRIMEIRO: **criar não passa por `restrict`
--   nenhum**, e criar esteira de lista é ato de funcionário comum — a política
--   `status_sets_write` da F17.2b só exige administrador no nível do ESPAÇO.
--
--   O QUE JÁ FECHAVA, E CONTINUA FECHANDO SEM GATILHO NENHUM
--     apagar a esteira que a tarefa usa ............ 23503  tasks_status_fk
--     apagar o status que a tarefa usa ............. 23503  tasks_status_fk
--     apagar a lista com tarefa dentro ............. 23503  tasks_list_fk
--     apagar a pasta com lista com tarefa .......... 23503  tasks_list_fk
--       (a pasta cascateia a lista; o `restrict` da tarefa sobe até lá)
--     mover a PASTA de espaço com lista dentro ..... 23503  lists_folder_same_space_fk
--     desligar o gatilho (`alter table ... disable`) 42501  must be owner
--     `set session_replication_role = 'replica'` ... 42501  permission denied
--
--   PASSA, E **NÃO** É PORTA — está escrito de propósito, porque é o que alguém
--   lendo esta migration depressa tentaria proibir também:
--     · criar esteira no nível do ESPAÇO. Ela só passa a valer para listas que
--       não têm esteira de lista nem de pasta — e essas listas não tinham
--       esteira NENHUMA antes, logo não podiam ter tarefa (o guarda da F17.3
--       recusa tarefa em lista sem esteira). Criar no espaço nunca tira o chão
--       de ninguém.
--     · criar esteira de PASTA quando a lista já resolve pela esteira DELA.
--       Medido: a resolução não se mexe, porque lista ganha de pasta.
--     · apagar uma esteira que ninguém está usando (a "sombra" de outra lista).
--     · renomear a esteira, recolorir, reordenar e ACRESCENTAR status.
--     · mover a lista de espaço quando ela não tem tarefa, ou quando ela carrega
--       ESTEIRA PRÓPRIA — aí a resolução viaja junto com ela e nada muda.
--
-- ========================= O DEFEITO DE OUTRA NATUREZA: O CARIMBO ===========
--   `tasks_status_guard` carimba a conclusão dentro de um `if v_mudou`, e o
--   ramo que LIMPA é `elsif v_tipo_velho = 'closed'`. No `INSERT` não há `old`.
--   Medido, com ator real:
--
--     insert into ideworks.tasks (list_id, client_id, title,
--                                 completed_at, completed_by)
--       → status `to do` (open) + completed_at PREENCHIDO
--
--   Nasce a tarefa "CONCLUÍDA NA FICHA, ABERTA NA COLUNA" — a contradição que o
--   cabeçalho da F17.3 diz evitar, e que a afirmação dele ("carimba a conclusão
--   a partir do TIPO do status, nos dois sentidos") não cobre.
--
--   E a sonda achou que ele tem QUATRO formas, não uma:
--     (i)   insert com lista e conclusão, SEM status ......... PASSAVA
--     (ii)  insert com lista, conclusão e status que ABRE .... PASSAVA
--     (iii) update que mexe SÓ em `completed_at`, com status
--           que abre ........................................ PASSAVA
--     (iv)  update que LIMPA `completed_at` com status que
--           fecha ........................................... PASSAVA
--
--   As três primeiras produzem "concluída na ficha, aberta na coluna"; a quarta
--   produz o inverso, "concluída na coluna, aberta na ficha" — exatamente o que
--   o comentário de `uncomplete_task` diz que o desenho evita.
--
--   Hoje NENHUMA delas é alcançável pelo app: `createTask` grava
--   `(client_id, title, description, due_on, created_by)` e não conhece lista;
--   a F11d grava sem lista; e nenhum caminho de `src/` escreve `completed_at`
--   direto — só `complete_task` e `uncomplete_task`, que são coerentes.
--   **Mas a F17.11 grava exatamente como (i) e (ii):** lista, status e data de
--   fechamento no mesmo comando, vindos do ClickUp.
--
-- ================================== DECISÃO (a): RECUSAR, NOS ONZE CAMINHOS ==
--   As duas saídas tinham defensor. `move_task` REPOSICIONA quando o status não
--   existe na esteira nova, e é precedente dentro da própria F17.3. As três
--   etapas anteriores RECUSAM ("o ClickUp apaga; a réplica recusa e diz por
--   quê"). Recusar ganhou, por quatro razões, e a primeira sozinha decide:
--
--   1. REPOSICIONAR PRECISA DE DESTINO, E EM CINCO DOS CAMINHOS NÃO HÁ NENHUM.
--      Medido: mover a esteira de dono, ou trocar o nível dela, ou mover a lista
--      para um espaço sem esteira deixa `resolve_status_set` devolvendo NULL.
--      Não existe "primeiro que abre" numa esteira que não existe. Um guarda que
--      reposicionasse às vezes e recusasse outras seria imprevisível — o pior
--      dos dois mundos, e imprevisibilidade é o que faz gente desligar guarda.
--
--   2. `move_task` REPOSICIONA UMA TAREFA E **DIZ QUE REPOSICIONOU**. Ela
--      devolve `status_repositioned`, e é isso que torna o reposicionamento
--      aceitável lá: o ato é deliberado, é por tarefa, e volta com recibo. Um
--      gatilho em `lists`, `status_sets` ou `statuses` reposicionaria N tarefas
--      e não tem como devolver nada — gatilho não tem valor de retorno para
--      quem chamou. Seria `move_task` com o recibo rasgado.
--
--   3. A ASSIMETRIA DE ESCALA, QUE É O ARGUMENTO DA F17.4b, E AQUI É MAIOR.
--      Mover uma tarefa afeta uma tarefa. Criar uma esteira de lista, mover a
--      esteira, mover a lista ou mover um status afetam TODAS as tarefas atrás
--      delas. Uma reclassificação silenciosa desse tamanho — centenas de cartões
--      caindo de `em aprovação do cliente` para `a fazer` — é perda de trabalho
--      que ninguém pediu e que ninguém saberia desfazer, porque desfazê-la exige
--      saber onde cada um estava.
--
--   4. É O MESMO CRITÉRIO DAS TRÊS ETAPAS ANTERIORES, e uniformidade vale mais
--      que conveniência numa regra que dispara raramente.
--
--   E O GUARDA RECUSA **POR CAUSA DA TAREFA PARADA, E SÓ** — a mesma forma do
--   `lists_tag_space_guard` da F17.4b, que recusa por causa da etiqueta e não
--   por causa da mudança. Lista sem tarefa, lista com esteira própria, esteira
--   nova no espaço, renomear, recolorir, reordenar, acrescentar status: tudo
--   passa como sempre passou. A prova mede quinze casos de controle.
--
-- ============ DECISÃO (b): O STATUS SAI DO `completed_at`, E O CARIMBO PASSA ==
-- ============ A SER BICONDICIONAL ============================================
--   As três saídas do plano: recusar alto, limpar em silêncio, ou escolher o
--   status a partir do `completed_at`. A escolha é a TERCEIRA, com a segunda
--   como desempate para o caso em que o chamador manda status E data que se
--   contradizem. Recusar foi descartado.
--
--   O QUE FOI MEDIDO NO CLICKUP — porque a pergunta "o ClickUp tem `date_closed`
--   independente do status?" decide isto:
--     · 60 tarefas com status que NÃO fecha (inclusive `publicar/agendar`, que é
--       do tipo `done`): `date_closed` NULO nas 60.
--     · 100 tarefas de duas listas (`Delicato (artes)` e `Casa Nova Ibitinga
--       (Artes)`), abertas e fechadas juntas: TODA tarefa com `date_closed`
--       preenchido está em `concluído` — o status que fecha —, e nenhuma tarefa
--       fora dele carrega `date_closed`.
--   Na origem, medida, os dois campos CONCORDAM. A independência teórica —
--   tarefa fechada e depois reaberta guarda o `date_closed` — não aparece no
--   dado real. Então recusar não mataria a F17.11 no primeiro registro… mas
--   mataria no primeiro registro em que aparecesse, no meio de uma importação,
--   e isso é pior que morrer no começo. Recusar está fora.
--
--   A REGRA QUE ENTRA, NUMA FRASE: `completed_at` é DERIVADO do tipo do status,
--   e não um campo independente que alguém preenche ao lado.
--
--     tipo = closed  →  `completed_at` preenchido
--     tipo ≠ closed  →  `completed_at` nulo
--
--   e, quando a tarefa entra numa lista SEM status escolhido, o status sai do
--   que ela já diz de si: com conclusão vai para o que FECHA, sem conclusão vai
--   para o primeiro que ABRE. **Isto não é regra nova.** É, letra por letra, o
--   preenchimento retroativo que a própria F17.3 aplicou às 18 tarefas reais:
--     `case when completed_at is not null then closing_status(...) else
--      first_open_status(...) end`
--   Uma regra, agora com dois pontos de entrada em vez de um — a mesma forma que
--   a F17.3 usou para justificar o preenchimento do status.
--
--   E QUANDO O CHAMADOR MANDA OS DOIS, EM DESACORDO? O status ganha, e a data se
--   limpa. Isso NÃO é "descartar dado da origem contra a D21", e a razão é que
--   **`date_closed` e `completed_at` não são o mesmo campo**: na origem
--   `date_closed` é "a última vez que isto foi fechado", um fato de LINHA DO
--   TEMPO que sobrevive à reabertura; aqui `completed_at` é "concluída desde",
--   a verdade da caixinha do Pilar A′ — tanto que `uncomplete_task` a limpa,
--   justamente para "concluída desde" nunca mentir. Copiar um no outro é que
--   seria a infidelidade. O lugar do `date_closed` de uma tarefa reaberta é a
--   linha do tempo da F17.10, e não esta coluna.
--
--   REGRA 3 DO ROTEIRO ESTÁ CUMPRIDA, e vale dizer por quê: nada aqui é "valor
--   desconhecido caindo em default silencioso". O status derivado sai de um dado
--   que o chamador MANDOU, e a limpeza aplica uma regra declarada na coluna e no
--   comentário da função. Não se inventa valor; deduz-se do que veio.
--
--   O QUE **NÃO** MUDA, E FOI CONFERIDO CONTRA AS 18 TAREFAS REAIS: as 18 têm
--   `completed_by` NULO e `completed_at` preenchido, no status que fecha. O
--   carimbo só escreve `completed_by` quando está CRIANDO a conclusão (isto é,
--   quando `completed_at` chega nulo) — senão a primeira edição de título de
--   qualquer uma delas carimbaria o editor como quem concluiu, que é reescrever
--   história. A F17.3 evitava isso com `v_mudou`; aqui a bicondicional é
--   permanente, então a proteção passa a ser a própria condição `completed_at
--   is null`, que é mais estreita e mais honesta.
--
-- =================== O SEXTO DEFEITO, ACHADO E **NÃO** CONSERTADO AQUI ======
--   Procurando a quinta porta a sonda achou uma sexta, de dentro da mesma
--   família do carimbo, e ela NÃO é fechada por esta migration. Medido:
--
--     update ideworks.statuses set type = 'done'   where id = <o que fecha>;
--     update ideworks.statuses set type = 'closed' where id = <um que abre>;
--       → PASSA. A tarefa PARADA fica no status que agora FECHA, com
--         `completed_at` NULO — "concluída na coluna, aberta na ficha".
--       → E no sentido inverso, na mesma ordem trocada, a tarefa concluída fica
--         num status que abre com `completed_at` preenchido.
--
--   (Na ordem ingênua — promover antes de rebaixar — o índice único parcial
--   `statuses_one_closing_key` recusa com 23505. A ordem certa atravessa.)
--
--   POR QUE FICA RELATADO E NÃO CONSERTADO, que é o que a regra 3 pede quando
--   não se conserta:
--
--   · É OUTRA INVARIANTE, com outra coluna e OUTRA DECISÃO A TOMAR — e as duas
--     saídas disponíveis são ruins de um jeito que esta etapa não tem mandato
--     para escolher. Reposicionar o carimbo escreveria `now()` em centenas de
--     tarefas que ninguém concluiu, ou apagaria a conclusão real de centenas que
--     alguém concluiu: as duas INVENTAM ou DESTROEM. Recusar trava uma
--     reconfiguração legítima — e trava a F17.11 pelo mesmo motivo que fez
--     "recusar" perder a decisão (b) três parágrafos acima. Escolher isso de
--     lado, dentro de uma migration que veio fazer outra coisa, seria decidir
--     por descuido.
--
--   · MISTURAR AS DUAS FARIA UMA ETAPA QUE NINGUÉM REVERTE EM PEDAÇOS. É o
--     mesmo argumento, palavra por palavra, com que a F17.4b relatou ESTES
--     defeitos em vez de consertá-los — e foi por isso que esta etapa existe
--     separada e pôde ser feita inteira.
--
--   · A EXPOSIÇÃO É PEQUENA E O ATO É RARO: 4 status, todos do quadro
--     `Demandas`, e mudar o tipo de um status é reconfiguração deliberada, não
--     operação de dia.
--
-- =========================================== `AFTER`, E NÃO `BEFORE` ========
--   Os três gatilhos novos são `AFTER`, ao contrário de todos os guardas
--   anteriores do projeto, e a razão é técnica e vale registrar:
--
--   · A pergunta é "depois desta escrita, o status da tarefa ainda pertence à
--     esteira resolvida da lista dela?". Num `BEFORE`, `resolve_status_set`
--     ainda enxerga o mundo VELHO, e no caso do `insert` de `status_sets` a
--     linha nova nem existe. O guarda teria que RECALCULAR a resolução à mão,
--     com uma segunda cópia da regra da F17.2 dentro dele — a dívida 8.1 do
--     legado outra vez. Em `AFTER` a função da F17.2 responde sozinha, e a
--     regra continua morando num lugar só.
--   · Recusar em `AFTER` aborta o comando do mesmo jeito. Não se perde nada.
--   · E ganha-se a precedência certa: a política de linha (`with check`) fala
--     ANTES, então destino de outra empresa continua recusado com `42501` pela
--     política, e não com uma mensagem sobre esteira. É a ordem que a F17.3 já
--     tinha escolhido para `move_task`.
--
-- ================================== OS NOMES, E A ORDEM ALFABÉTICA ==========
--   Medido na F17.4 e confirmado na F17.4b: gatilhos da MESMA tabela disparam em
--   ordem alfabética de NOME — e isso já enganou dois verificadores nesta
--   sessão, porque vários guardas recusam com `23514`. O que decide aqui, porém,
--   vem ANTES do alfabeto, e é o que está escrito nos três casos:
--
--     ideworks.lists       `lists_tag_space_guard` (F17.4b) é BEFORE; o novo
--                          `lists_workflow_guard` é AFTER. Fase ganha de nome:
--                          numa lista que viola as DUAS regras, quem fala é o
--                          da etiqueta. É a ordem certa — a etiqueta é dano de
--                          classificação, o status é dano de quadro, e a
--                          mensagem da etiqueta é a mais específica das duas.
--     ideworks.status_sets `status_sets_must_close` (F17.2) é gatilho de
--                          RESTRIÇÃO `deferrable initially deferred`: fala no
--                          fim da transação. O novo `status_sets_workflow_guard`
--                          é imediato e fala primeiro, apesar de vir DEPOIS no
--                          alfabeto. Diferimento ganha de nome.
--     ideworks.statuses    idem, com `statuses_must_close`.
--
--   FICA REGISTRADO O QUE ACONTECE QUANDO ISSO DEIXAR DE SER VERDADE: dois
--   gatilhos AFTER imediatos na mesma tabela voltariam a ser decididos pelo
--   alfabeto. Por isso `scripts/provar-tarefa-no-quadro.mjs` confere SEMPRE um
--   trecho da mensagem além do código — o 5º parâmetro de `esperarRecusa`.
--
--   Os nomes seguem a convenção das etapas anteriores: o do GATILHO é
--   `<tabela>_<o que guarda>`, e o da FUNÇÃO é uma frase. Aqui a função é UMA
--   SÓ para os três gatilhos, `status_tree_guard` ("a árvore da esteira mudou"),
--   pelo mesmo motivo que `status_set_must_close` da F17.2 serve a dois: a regra
--   é uma, e três cópias dela divergiriam no primeiro ajuste.
-- =============================================================================

-- --- o guarda da árvore da esteira --------------------------------------------
-- Um gatilho para cada tabela que participa da resolução, e uma função só, que
-- se orienta por `tg_table_name` — exatamente como `status_set_must_close` da
-- F17.2 faz para `status_sets` e `statuses`.
--
-- O que muda de tabela para tabela é APENAS quais tarefas estão no caminho:
--
--   lists        as tarefas da lista que se moveu
--   statuses     as tarefas que estão NESTE status
--   status_sets  as tarefas das listas de baixo do dono NOVO e do dono VELHO
--
-- A pergunta feita a elas é sempre a mesma, e é a frase da F17.3.
--
-- `security definer` por dois motivos, e os dois já morderam este projeto:
-- `resolve_status_set` é `security invoker` de propósito (F17.2) e devolveria
-- `null` para quem não alcança o espaço — um guarda que herdasse esse `null`
-- aprovaria qualquer coisa; e sob a política de quem escreve uma tarefa fora do
-- alcance sumiria da consulta e o guarda aprovaria por não achar nada.
-- Autorizar é com a política; conferir o dado é com o guarda.
create or replace function ideworks.status_tree_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_tarefas    uuid[];
  v_old_space  uuid;
  v_old_folder uuid;
  v_old_list   uuid;
  v_tarefa     text;
  v_status     text;
  v_esteira    text;
  v_lista      text;
  v_resolvida  text;
  v_agora      text;
  v_quantas    integer;
begin
  if tg_table_name = 'lists' then
    -- `after update of space_id, folder_id` dispara quando o comando MENCIONA
    -- qualquer uma das duas, mesmo sem mudar o valor. Sem esta saída, um
    -- `update` genérico que reescreva a lista inteira pagaria a varredura por
    -- nada — e a lista pode ter centenas de tarefas. Mencionar as DUAS é o que
    -- cobre `set space_id = X, folder_id = null` na mesma escrita, a porta
    -- disfarçada que a F17.4b quase deixou passar.
    if new.space_id  is not distinct from old.space_id
   and new.folder_id is not distinct from old.folder_id then
      return null;
    end if;

    select array_agg(t.id) into v_tarefas
      from ideworks.tasks t
     where t.list_id = new.id and t.status_id is not null;

  elsif tg_table_name = 'statuses' then
    if new.status_set_id is not distinct from old.status_set_id then
      return null;
    end if;

    -- Escopo exato: só quem está NESTE status pode ficar órfão por ele mudar de
    -- esteira. Gatilho de linha, então um `update` em lote dispara por linha.
    select array_agg(t.id) into v_tarefas
      from ideworks.tasks t
     where t.status_id = new.id;

  else
    -- `status_sets`. No `INSERT` não há `old`, e ler `old.qualquer_coisa` ali
    -- estoura antes de a consulta rodar — plpgsql passa a variável como
    -- parâmetro, e `and` de SQL não garante curto-circuito. Por isso os três
    -- valores velhos passam por variáveis, atribuídas só quando existem.
    if tg_op = 'UPDATE' then
      if new.space_id  is not distinct from old.space_id
     and new.folder_id is not distinct from old.folder_id
     and new.list_id   is not distinct from old.list_id then
        return null;
      end if;

      v_old_space  := old.space_id;
      v_old_folder := old.folder_id;
      v_old_list   := old.list_id;
    end if;

    -- Os DOIS lados: o dono novo (que passa a valer para as listas de baixo
    -- dele) e o dono velho (que deixa de valer para as de baixo do outro). Com
    -- a coluna nula a comparação devolve nulo e simplesmente não casa — não
    -- precisa de caso especial por nível.
    select array_agg(t.id) into v_tarefas
      from ideworks.tasks t
      join ideworks.lists l on l.id = t.list_id
     where t.status_id is not null
       and (l.id        = new.list_id
         or l.folder_id = new.folder_id
         or l.space_id  = new.space_id
         or l.id        = v_old_list
         or l.folder_id = v_old_folder
         or l.space_id  = v_old_space);
  end if;

  if v_tarefas is null then
    return null;
  end if;

  -- A FRASE DA F17.3, CONFERIDA DEPOIS DA ESCRITA. `resolve_status_set` já
  -- enxerga o mundo novo porque este gatilho é `AFTER` — ver o cabeçalho.
  --
  -- `count(*) over ()` conta TODAS as linhas que casam, e não só a que o
  -- `limit 1` traz: a janela se calcula antes do limite. É o que permite dizer
  -- "são N no caminho" mostrando uma, em vez de despejar a lista inteira na
  -- mensagem de erro.
  --
  -- O `left join` da esteira NOVA é o que permite a mensagem dizer para onde a
  -- lista foi parar — ou que ela não foi parar em lugar nenhum.
  select t.title, s.name, ss.name, l.name, nova.name, count(*) over ()
    into v_tarefa, v_status, v_esteira, v_lista, v_resolvida, v_quantas
    from ideworks.tasks t
    join ideworks.statuses     s    on s.id  = t.status_id
    join ideworks.status_sets  ss   on ss.id = s.status_set_id
    join ideworks.lists        l    on l.id  = t.list_id
    left join ideworks.status_sets nova
           on nova.id = ideworks.resolve_status_set(t.list_id)
   where t.id = any (v_tarefas)
     and s.status_set_id is distinct from ideworks.resolve_status_set(t.list_id)
   order by l.name, t.created_at, t.id
   limit 1;

  if found then
    -- Duas frases, porque os dois estragos são diferentes e o que fazer também:
    -- ficar sem esteira nenhuma é o quadro sumir, e trocar de esteira é o cartão
    -- ficar numa coluna que aquele quadro não tem.
    v_agora := case
                 when v_resolvida is null
                 then 'e a lista ficaria SEM esteira nenhuma: o quadro dela nao teria coluna'
                 else format('e a esteira resolvida dessa lista passaria a ser "%s"',
                             v_resolvida)
               end;

    raise exception
      'a tarefa "%" da lista "%" esta no status %, da esteira "%", %. Sao % tarefa(s) no caminho. A esteira de uma lista so pode mudar quando nenhuma tarefa depende dela: mova essas tarefas para outra lista com ideworks.move_task (ou conclua-as), mude a esteira, e traga-as de volta — move_task reposiciona o status sozinho e diz que reposicionou. Nada foi mudado.',
      v_tarefa, v_lista, quote_literal(v_status), v_esteira, v_agora, v_quantas
      using errcode = '23514';
  end if;

  return null;
end;
$fn$;

comment on function ideworks.status_tree_guard() is
  'As portas da ARVORE da invariante da F17.3: `tasks_status_guard` guarda as '
  'colunas da TAREFA, e esta funcao guarda as que mudam a arvore por baixo dela '
  '— quem e o dono da esteira, de que esteira e o status, e onde a lista mora. '
  'Uma funcao para tres gatilhos, como `status_set_must_close`, porque a regra e '
  'uma so. Recusa em vez de reposicionar: reposicionar precisa de destino, e em '
  'cinco dos caminhos medidos a lista fica sem esteira nenhuma.';

-- A criação e o remanejamento da esteira. `insert` entra porque **criar não
-- passa por `restrict` nenhum** — é o caminho mais barato de todos, e o único
-- que não é um `update`.
drop trigger if exists status_sets_workflow_guard on ideworks.status_sets;
create trigger status_sets_workflow_guard
  after insert or update on ideworks.status_sets
  for each row execute function ideworks.status_tree_guard();

-- O status trocando de esteira. `of status_set_id` para renomear, recolorir e
-- reordenar status — que é o ato diário da F17.2 — não pagarem nada.
drop trigger if exists statuses_workflow_guard on ideworks.statuses;
create trigger statuses_workflow_guard
  after update of status_set_id on ideworks.statuses
  for each row execute function ideworks.status_tree_guard();

-- A lista mudando de lugar na árvore. As duas colunas juntas, pela mesma razão
-- que a F17.4b descobriu: o gatilho dispara pela MENÇÃO, e `set space_id = X,
-- folder_id = null` é a mesma porta com outra roupa.
drop trigger if exists lists_workflow_guard on ideworks.lists;
create trigger lists_workflow_guard
  after update of space_id, folder_id on ideworks.lists
  for each row execute function ideworks.status_tree_guard();

-- --- o carimbo, agora nos dois sentidos de verdade ----------------------------
-- Mesma função da F17.3, mesmo gatilho, mesmas três tarefas. Mudam DUAS coisas,
-- e só elas — ver a decisão (b) no cabeçalho:
--
--   · quando a tarefa entra numa lista SEM status escolhido, o status sai do
--     `completed_at` (com conclusão, o que fecha; sem, o primeiro que abre);
--   · o carimbo deixa de valer só quando o status MUDA e passa a valer sempre
--     que a tarefa tem status: `completed_at` é derivado do tipo dele.
--
-- O RESTO É O TEXTO DA F17.3, PALAVRA POR PALAVRA, comentários inclusive. A
-- F17.3 aplicou quatro funções SEM os comentários do corpo e quase reencenou a
-- dívida 8.3 do legado; a F17.4 e a F17.4b acertaram, e esta mantém.
create or replace function ideworks.task_status_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_set        uuid;
  v_lista      text;
  v_tipo       ideworks.status_type;
  v_nome       text;
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
      -- O STATUS SAI DO QUE A TAREFA JA DIZ DE SI. E a mesma regra que o
      -- preenchimento retroativo da F17.3 aplicou as 18 tarefas reais, agora
      -- com dois pontos de entrada em vez de um. Sem ela, `insert (list_id,
      -- completed_at)` — que e como a F17.11 grava — nasce concluida na ficha e
      -- aberta na coluna.
      if new.completed_at is not null then
        new.status_id := ideworks.closing_status(v_set);

        if new.status_id is null then
          raise exception
            'a tarefa chega concluida, e a esteira da lista "%" nao tem status que FECHE. Acrescente o status de tipo "closed" antes de importar tarefa concluida para essa lista.',
            coalesce(v_lista, new.list_id::text)
            using errcode = '22023';
        end if;

      else
        new.status_id := ideworks.first_open_status(v_set);

        if new.status_id is null then
          raise exception
            'a esteira da lista "%" nao tem nenhum status que abra: so ha o que fecha. Acrescente ao menos um status de tipo "open" antes de por tarefa nela.',
            coalesce(v_lista, new.list_id::text)
            using errcode = '22023';
        end if;
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
  -- BICONDICIONAL, e nao mais "so quando o status mudou". A F17.3 gastava um
  -- `v_mudou` para editar o titulo de uma tarefa concluida nao reescrever
  -- `completed_by` — mas com isso deixava passar as tres formas de nascer (ou
  -- ficar) "concluida na ficha, aberta na coluna", e a quarta, inversa, de
  -- limpar a conclusao sem sair do status que fecha.
  --
  -- A protecao daquele `v_mudou` continua de pe, e mais estreita: `completed_by`
  -- so e escrito quando a conclusao esta sendo CRIADA. As 18 tarefas reais tem
  -- `completed_by` NULO com `completed_at` preenchido, e nenhuma edicao delas
  -- pode carimbar o editor como quem concluiu.
  --
  -- Tarefa SEM status nao entra aqui, e isso e o Pilar A': a demanda que so tem
  -- cliente continua governada por `complete_task` e `uncomplete_task`, como a
  -- F4.8 a deixou.
  if new.status_id is not null then
    select s.type into v_tipo from ideworks.statuses s where s.id = new.status_id;

    if v_tipo = 'closed'::ideworks.status_type then
      if new.completed_at is null then
        new.completed_at := now();
        new.completed_by := coalesce(new.completed_by, ideworks.acting_user_id());
      end if;

    else
      -- Fora do status que fecha a conclusao deixa de existir, inclusive o
      -- autor. Guardar o instante antigo faria "concluida desde" mentir na
      -- proxima vez — a mesma decisao que `set_task_archived` tomou na F4.8. E
      -- e aqui que a data que a origem manda ao lado de um status ABERTO cai:
      -- `date_closed` do ClickUp e "a ultima vez que isto foi fechado", que nao
      -- e a mesma coisa que "concluida desde".
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
  'resolucao e uma funcao. Recusa status de fora; preenche o status a partir do '
  '`completed_at` quando nao vem nenhum (concluida vai para o que fecha); e '
  'mantem a BICONDICIONAL do carimbo — tipo `closed` implica conclusao '
  'preenchida, e qualquer outro tipo implica conclusao nula. `completed_by` so '
  'se escreve quando a conclusao esta sendo criada, para edicao de tarefa velha '
  'nao reescrever quem concluiu.';

comment on column ideworks.tasks.completed_at is
  'DERIVADO do tipo do status quando a tarefa esta num quadro: tipo `closed` '
  'implica preenchido, qualquer outro implica nulo — conferido pelo gatilho '
  'tasks_status_guard em TODA escrita, e nao so quando o status muda. Nao e o '
  '`date_closed` do ClickUp: aquele e "a ultima vez que isto foi fechado" e '
  'sobrevive a reabertura; este e "concluida desde", e por isso '
  'uncomplete_task o limpa. Tarefa sem status — a demanda do Pilar A, sem '
  'quadro — continua governada so por complete_task/uncomplete_task.';

-- --- permissões ---------------------------------------------------------------
-- NADA A CONCEDER, e está escrito para não parecer esquecimento: esta migration
-- não cria tabela, view nem função chamável. `status_tree_guard` é função de
-- gatilho, e permissão de função de gatilho é conferida na CRIAÇÃO do gatilho,
-- não a cada disparo — mesma nota da F17.2, da F17.3, da F17.4 e da F17.4b, que
-- também deixaram `status_set_must_close`, `task_status_guard`,
-- `task_tag_space_guard`, `task_move_tag_guard`, `list_move_tag_guard` e
-- `tag_move_task_guard` de fora da lista de `grant execute`.
--
-- `task_status_guard` foi substituída com `create or replace`, o que preserva o
-- dono, as permissões e o gatilho `tasks_status_guard` que a executa. O gatilho
-- NÃO é recriado aqui de propósito: a definição dele não mudou, e recriá-lo
-- mudaria a ordem de disparo dele em relação a `tasks_tag_space_guard` sem
-- necessidade nenhuma (na mesma tabela, a ordem é o alfabeto, mas recriar um
-- gatilho é o tipo de mexida gratuita que um dia surpreende alguém).
