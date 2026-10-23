-- =============================================================================
-- IDE WORKS — F17.4b  As outras duas portas do estado proibido
-- =============================================================================
-- ESTA MIGRATION NÃO ACRESCENTA REGRA NENHUMA. Ela termina de guardar a regra
-- que a F17.4 escreveu: "a etiqueta vive no espaço da tarefa".
--
-- ================================================= O ARGUMENTO DA F17.4 ======
--   O cabeçalho da F17.4 diz, com todas as letras:
--
--     "E ELE TEM DOIS LADOS, senão seria teatro. Guardar só a etiquetagem
--      deixaria o caminho de trás aberto: bastaria etiquetar a tarefa e depois
--      MOVÊ-LA para outro espaço para chegar ao mesmo estado proibido."
--
--   O argumento está CERTO no espírito e INCOMPLETO na enumeração. A invariante
--   é uma frase sobre CINCO tabelas —
--
--     task_tag_assignments → tasks → lists → spaces      (o lado da tarefa)
--     task_tags            → spaces                      (o lado da etiqueta)
--
--   — e toda COLUNA que aparece nesse desenho é uma porta. São quatro:
--
--     porta                                        guardada pela F17.4?
--     -----------------------------------------    --------------------------
--     pôr a etiqueta na tarefa                     SIM  task_tag_space_guard
--     mover a TAREFA de espaço  (tasks.list_id)    SIM  task_move_tag_guard
--     mover a LISTA  de espaço  (lists.space_id)   NÃO  — esta migration
--     mover a ETIQUETA de espaço (task_tags.       NÃO  — esta migration
--       space_id)
--
--   A F17.4 fechou as duas que mexem NO VÍNCULO OU NA TAREFA. Ficaram abertas
--   as duas que mexem NA ÁRVORE POR BAIXO — e o estado proibido é o mesmo.
--
-- ============================ A SONDA QUE EXPÔS AS DUAS, E POR QUE ELA FICA ==
-- ============================ ESCRITA AQUI =================================
--   Medido em 2026-08-25 como `ideworks_app` (o papel do Worker, sujeito às
--   políticas), tudo em transação revertida. Dois espaços com uma etiqueta e uma
--   tarefa etiquetada, e duas pessoas comuns, cada uma alcançando UMA empresa:
--
--     CENÁRIO 1 — QUEM VIAJA É A LISTA
--       `update ideworks.lists set space_id = <outro>`  ....... PASSOU
--       lista no espaço B, etiqueta no espaço A ............... PROIBIDO
--       quem alcança B e não A: tarefa=1, vínculo=1, etiqueta=0,
--         `task_labels.tags` = `[]`  ......................... CHIP EM BRANCO
--       quem alcança A e não B: perde a tarefa inteira de vista
--
--     CENÁRIO 2 — QUEM VIAJA É A ETIQUETA
--       `update ideworks.task_tags set space_id = <outro>` .... PASSOU
--       lista em A, etiqueta em B ............................ PROIBIDO
--       quem alcança A e não B: tarefa=1, vínculo=1, etiqueta=0,
--         `task_labels.tags` = `[]`  ......................... CHIP EM BRANCO
--
--     QUEM CONSEGUE
--       funcionário comum, sem acesso amplo, alcançando UMA empresa:
--         move a LISTA entre dois espaços dessa empresa ...... PASSOU
--         move a ETIQUETA entre dois espaços dessa empresa ... PASSOU
--         move a LISTA para espaço de OUTRA empresa .......... recusado 42501
--                                                              (política, não guarda)
--
--   ESTE REGISTRO É O QUE IMPEDE ALGUÉM DE APAGAR OS DOIS GATILHOS DAQUI A UM
--   ANO ACHANDO QUE SÃO REDUNDANTES. Eles não repetem os da F17.4: cada um
--   fecha uma porta que os outros dois não alcançam, e a sonda acima é a prova
--   de que a porta existia.
--
--   É EXATAMENTE O DANO QUE A F17.4 USA PARA SE JUSTIFICAR — a migration dela
--   diz "quem alcança a lista mas não o espaço da etiqueta veria a tarefa COM o
--   vínculo e SEM a etiqueta — chip em branco na ficha —, enquanto quem alcança
--   os dois veria o nome. Duas respostas para 'quais são as etiquetas desta
--   tarefa'". Era isso, produzido por dois `update` de uma linha.
--
-- ====================================== EXPOSIÇÃO HOJE: ZERO, E É POR ISSO ==
-- ====================================== QUE O CONSERTO ENTRA AGORA =========
--   Medido antes de escrever uma linha:
--     ideworks.task_tags ................ 0 linhas
--     ideworks.task_tag_assignments ..... 0 linhas
--     ideworks.task_types ............... 0 linhas
--     ideworks.tasks .................... 18 linhas (dado real, do Pilar A′)
--     ideworks.lists .... 2    ideworks.spaces .... 2    ideworks.folders ... 0
--     ideworks.client_tags .............. 31, com 94 atribuições (F2.4, intocada)
--
--   Nenhuma linha atravessada existe, porque não existe etiqueta nenhuma ainda:
--   a importação é a F17.11. Fechar agora custa dois gatilhos; fechar depois
--   custaria uma varredura de dado já importado e uma decisão sobre o que fazer
--   com o que já estivesse torto.
--
-- ================================== A BUSCA PELA QUINTA PORTA, MEDIDA ======
--   A enumeração de quatro não foi aceita de graça. Dezesseis outros caminhos
--   até o mesmo estado foram TENTADOS, um a um, como `ideworks_app`:
--
--     caminho                                          resultado
--     ---------------------------------------------    -----------------------
--     folders.space_id, pasta COM lista dentro         recusa 23503
--                                                        lists_folder_same_space_fk
--     folders.space_id, pasta SEM lista                PASSA — e não é porta:
--                                                        sem lista não há tarefa,
--                                                        sem tarefa não há etiqueta
--     lists.folder_id → pasta de outro espaço          recusa 23503 (mesma chave)
--     lists.space_id + folder_id NA MESMA escrita      PASSA — é a MESMA porta
--                                                        3, com outra roupa; o
--                                                        gatilho desta migration
--                                                        a cobre (dispara pela
--                                                        MENÇÃO de space_id)
--     spaces.id trocado                                recusa 23503
--     lists.id trocado                                 recusa 23503 (tasks_list_fk)
--     task_tags.id trocado                             recusa 23503
--     tasks.id trocado                                 recusa 23503
--     task_tag_assignments.tag_id → etiqueta de outro  recusa 23514 (F17.4)
--     task_tag_assignments.task_id → tarefa de outro   recusa 23514 (F17.4)
--     tasks.list_id → NULL com etiqueta pendurada      recusa 23514 (F17.4)
--     apagar a lista da tarefa etiquetada              recusa 23503 (restrict)
--     spaces.category_id (espaço troca de empresa)     PASSA — e não é porta:
--                                                        lista e etiqueta viajam
--                                                        JUNTAS, dentro do espaço
--     insert ... select de vínculos EM LOTE            recusa 23514 (gatilho de
--                                                        linha dispara por linha)
--     set session_replication_role = 'replica'         recusa 42501
--     alter table ... disable trigger                  recusa 42501 (must be owner)
--
--   NÃO HÁ QUINTA PORTA. As chaves da F17.1 e da F17.3 já fecham a identidade
--   das linhas (`NO ACTION` no lado referenciado recusa alto), o `restrict` de
--   `tasks_list_fk` fecha o apagar, e `ideworks_app` não consegue desligar
--   gatilho nem por parâmetro nem por `alter table` — o que importa, porque
--   invariante guardada por gatilho vale exatamente o quanto vale a
--   impossibilidade de desligá-lo.
--
--   AS DUAS LINHAS "PASSA — E NÃO É PORTA" ESTÃO AQUI DE PROPÓSITO: são as
--   operações que alguém, lendo esta migration depressa, tentaria proibir
--   também. Proibi-las travaria a operação sem fechar nada.
--
-- ==================================== MOVER LISTA DE ESPAÇO CONTINUA SENDO ==
-- ==================================== OPERAÇÃO LEGÍTIMA ====================
--   A pergunta foi feita e é justa: `lists.space_id` mudar de valor é caso real
--   ou é só um buraco? É CASO REAL, e continua permitido. Três razões:
--
--   1. A ORIGEM FAZ. No ClickUp mover uma lista entre spaces existe, é um menu
--      da lista. A decisão D21 manda copiar o que já existe; proibir aqui faria
--      a réplica ser mais severa que a coisa replicada — o mesmo erro que a
--      F17.4 recusou cometer com a cor `#000` e com o nome de emoji.
--
--   2. A F17.11 VAI PRECISAR. A importação copia estrutura, e estrutura torta
--      se conserta movendo — não apagando e recriando, que perderia o
--      `source_id` e faria a importação seguinte duplicar tudo.
--
--   3. A F17.1 JÁ DECIDIU DE QUEM É ESSE ATO. Pasta e lista são governadas por
--      quem alcança o espaço, e o cabeçalho dela é explícito: "exigir
--      administrador aqui paralisaria a operação".
--
--   Então o gatilho recusa POR CAUSA DA ETIQUETA, e só. Lista sem tarefa, lista
--   com tarefa sem etiqueta, lista trocando de pasta, lista sendo renomeada:
--   tudo passa como sempre passou. A prova mede os quatro casos.
--
-- ============================================ RECUSAR, E NÃO APAGAR =========
--   Mesmo critério das duas etapas anteriores, e não é escolha nova: o
--   `restrict` da F17.3 ("O ClickUp apaga; a réplica recusa e diz por quê") e o
--   `task_move_tag_guard` da F17.4, que já preferiu recusar a mover a tirar as
--   etiquetas que não cabem.
--
--   Aqui a razão é ainda mais forte que lá. Mover uma tarefa afeta UMA tarefa;
--   mover uma lista afeta TODAS as tarefas dela, e mover uma etiqueta afeta
--   todas as tarefas que a carregam. Uma limpeza silenciosa nesse tamanho seria
--   uma perda de classificação que ninguém pediu e que ninguém saberia desfazer,
--   porque desfazê-la exige saber o que havia lá.
--
--   Por isso a mensagem NOMEIA O QUE ESTÁ NO CAMINHO — a tarefa, a etiqueta, o
--   espaço dela e QUANTAS estão atrás — e não apenas diz "não pode". É o padrão
--   que a F17.4 estabeleceu e que funciona: "a tarefa carrega a etiqueta
--   'exclusiva-de-A', que e do espaco 'SONDA2 A', e o destino nao e esse
--   espaco".
--
-- ==================================== OS NOMES, E A ORDEM ALFABÉTICA =======
--   Medido na F17.4: gatilhos da MESMA tabela disparam em ordem alfabética de
--   NOME, e foi assim que `tasks_status_guard` falou antes de
--   `tasks_tag_space_guard` e enganou o verificador — dois guardas recusando com
--   `23514` na mesma tabela, e só o código não os separa.
--
--   Hoje `ideworks.lists` e `ideworks.task_tags` não têm gatilho nenhum, então a
--   ordem não decide nada AINDA. Os nomes seguem a convenção já usada — o da
--   tabela, depois o que se guarda:
--
--     ideworks.lists      → `lists_tag_space_guard`   (list_move_tag_guard)
--     ideworks.task_tags  → `task_tags_space_guard`   (tag_move_task_guard)
--
--   E FICA REGISTRADO O QUE ACONTECE QUANDO DEIXAR DE SER VERDADE: um futuro
--   guarda de status em `lists` se chamaria `lists_status_guard`, que vem ANTES
--   de `lists_tag_space_guard` no alfabeto e falaria primeiro num `update` que
--   violasse as duas coisas. Por isso `scripts/provar-etiquetas-e-tipos.mjs`
--   confere SEMPRE um trecho da mensagem, e não só o código — é o 5º parâmetro
--   de `esperarRecusa`, que existe exatamente para isso.
--
--   Os nomes das FUNÇÕES espelham os da F17.4, que são frases: `task_move_tag_
--   guard` é "a tarefa se move, a etiqueta está no caminho". Daí
--   `list_move_tag_guard` ("a lista se move, a etiqueta está no caminho") e
--   `tag_move_task_guard` ("a etiqueta se move, a tarefa está no caminho").
--
-- ============================== O QUE ESTA MIGRATION NÃO CONSERTA, E ISSO ===
-- ============================== ESTÁ MEDIDO E DECLARADO ====================
--   A MESMA CLASSE DE BURACO EXISTE NA INVARIANTE DA F17.3 — "o status da
--   tarefa pertence à esteira RESOLVIDA da lista". `tasks_status_guard` guarda
--   as colunas da TAREFA; ninguém guarda a árvore por baixo dela. Medido, como
--   `ideworks_app`, com tarefa parada e status válido:
--
--     criar esteira NOVA no nível da LISTA .............. PASSA, e o status da
--                                                          tarefa deixa de
--                                                          pertencer à resolvida
--     criar esteira NOVA no nível da PASTA ............. PASSA, idem
--     mover a esteira de dono (status_sets.space_id) ... PASSA quando o destino
--                                                          não tem esteira; a
--                                                          lista fica SEM esteira
--                                                          nenhuma resolvida
--     mover um status de esteira (statuses.status_set_id) PASSA, e o status da
--                                                          tarefa fica órfão
--     mover a LISTA de espaço (lists.space_id) ......... PASSA hoje; a partir
--                                                          desta migration ainda
--                                                          passa quando não há
--                                                          etiqueta, e AÍ TAMBÉM
--                                                          quebra o status
--     apagar a esteira do espaço ....................... recusa 23503, pelo
--                                                          `restrict` de
--                                                          tasks_status_fk
--
--   NÃO É CONSERTADO AQUI DE PROPÓSITO: é outra invariante, com outras cinco
--   colunas e outra decisão a tomar (recusar? reposicionar no primeiro que abre,
--   como `move_task` já faz?). Misturar as duas nesta migration faria uma etapa
--   que ninguém consegue reverter em pedaços. Fica RELATADO, que é o que a
--   regra 3 pede quando não se conserta.
-- =============================================================================

-- --- o guarda de MOVER A LISTA ------------------------------------------------
-- A terceira porta. A tarefa fica onde está e a etiqueta fica onde está — quem
-- viaja é o CHÃO debaixo da tarefa, e o efeito é idêntico ao de mover a tarefa.
--
-- `security definer` pelo mesmo motivo dos dois guardas da F17.4: sob a política
-- de quem escreve, uma etiqueta fora do alcance sumiria da consulta e o guarda
-- aprovaria por não achar nada. Autorizar é com a política; conferir o dado é
-- com o guarda.
create or replace function ideworks.list_move_tag_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_tarefa   text;
  v_etiqueta text;
  v_espaco   text;
  v_quantos  integer;
begin
  -- `before update of space_id` dispara quando o comando MENCIONA a coluna,
  -- mesmo que o valor não mude. Sem esta saída, um `update` genérico que
  -- reescreva a lista inteira pagaria a varredura abaixo por nada — e a lista
  -- pode ter centenas de tarefas.
  if new.space_id is not distinct from old.space_id then
    return new;
  end if;

  -- `count(*) over ()` conta TODAS as linhas que casam, e não só a que o
  -- `limit 1` traz: janela se calcula antes do limite. É o que permite dizer
  -- "são N no caminho" mostrando uma, em vez de despejar a lista inteira na
  -- mensagem de erro.
  select t.title, g.name, s.name, count(*) over ()
    into v_tarefa, v_etiqueta, v_espaco, v_quantos
    from ideworks.tasks t
    join ideworks.task_tag_assignments a on a.task_id = t.id
    join ideworks.task_tags            g on g.id      = a.tag_id
    join ideworks.spaces               s on s.id      = g.space_id
   where t.list_id = new.id
     and g.space_id is distinct from new.space_id
   order by lower(btrim(g.name)), t.created_at, t.id
   limit 1;

  if found then
    raise exception
      'a tarefa "%" desta lista carrega a etiqueta %, que e do espaco "%", e o destino nao e esse espaco. Sao % vinculo(s) de etiqueta no caminho. Etiqueta de tarefa vive no espaco: tire as etiquetas dessas tarefas antes de mover a lista, ou crie etiquetas de mesmo nome no espaco de destino. Nada foi movido.',
      v_tarefa, quote_literal(v_etiqueta), v_espaco, v_quantos
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function ideworks.list_move_tag_guard() is
  'A terceira porta do estado proibido da F17.4: mover a LISTA de espaco leva as '
  'tarefas dela junto e deixa as etiquetas para tras. Recusa em vez de apagar, e '
  'nomeia a tarefa, a etiqueta e o espaco dela. Mover lista SEM etiqueta em jogo '
  'continua passando — e precisa continuar, porque no ClickUp isso existe.';

drop trigger if exists lists_tag_space_guard on ideworks.lists;
create trigger lists_tag_space_guard
  before update of space_id on ideworks.lists
  for each row execute function ideworks.list_move_tag_guard();

-- --- o guarda de MOVER A ETIQUETA ---------------------------------------------
-- A quarta porta, e o espelho da terceira: aqui quem viaja é a etiqueta, e as
-- tarefas ficam. Uma etiqueta pode estar em muitas tarefas de muitas listas, e
-- basta UMA fora do destino para o estado ficar proibido.
create or replace function ideworks.tag_move_task_guard()
  returns trigger
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_tarefa  text;
  v_espaco  text;
  v_quantos integer;
begin
  if new.space_id is not distinct from old.space_id then
    return new;
  end if;

  -- `left join` nas duas pontas de propósito: a tarefa sem lista não está em
  -- espaço nenhum, e `null is distinct from <destino>` é verdadeiro, então ela
  -- CAI no filtro em vez de sumir dele. Esse estado não deveria existir — o
  -- guarda da F17.4 recusa etiquetar tarefa sem lista —, e é justamente por
  -- isso que ele não pode passar despercebido aqui (regra 3: falhe alto).
  select t.title, s.name, count(*) over ()
    into v_tarefa, v_espaco, v_quantos
    from ideworks.task_tag_assignments a
    join ideworks.tasks       t on t.id = a.task_id
    left join ideworks.lists  l on l.id = t.list_id
    left join ideworks.spaces s on s.id = l.space_id
   where a.tag_id = new.id
     and l.space_id is distinct from new.space_id
   order by t.created_at, t.id
   limit 1;

  if found then
    raise exception
      'a etiqueta % esta na tarefa "%", que mora no espaco "%", e o destino nao e esse espaco. Sao % tarefa(s) com esta etiqueta. Etiqueta de tarefa vive no espaco da tarefa: tire a etiqueta dessas tarefas antes de muda-la de espaco, ou crie uma de mesmo nome no espaco de destino. Nada foi movido.',
      quote_literal(new.name), v_tarefa,
      coalesce(v_espaco, 'nenhum — a tarefa nao esta em lista'), v_quantos
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function ideworks.tag_move_task_guard() is
  'A quarta porta do estado proibido da F17.4: mudar a etiqueta de espaco deixa '
  'as tarefas que a carregam com etiqueta de fora. Espelho de '
  'list_move_tag_guard. Mudar cor ou nome da etiqueta nao dispara nada, e mudar '
  'de espaco uma etiqueta que ninguem usa continua passando.';

drop trigger if exists task_tags_space_guard on ideworks.task_tags;
create trigger task_tags_space_guard
  before update of space_id on ideworks.task_tags
  for each row execute function ideworks.tag_move_task_guard();

-- --- permissões ---------------------------------------------------------------
-- NADA A CONCEDER, e está escrito para não parecer esquecimento: esta migration
-- não cria tabela, view nem função chamável. As duas funções novas são de
-- gatilho, e permissão de função de gatilho é conferida na CRIAÇÃO do gatilho,
-- não a cada disparo — mesma nota da F17.3 e da F17.4, que também deixaram
-- `task_status_guard`, `task_tag_space_guard` e `task_move_tag_guard` de fora
-- da lista de `grant execute`.
