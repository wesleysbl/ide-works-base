-- =============================================================================
-- F17.19 — A ESTEIRA MUDA COM TAREFA DENTRO
--
-- O QUE O USUÁRIO PEDIU
--   *"só queria criar uma etapa a mais mesmo tendo a tarefa criada antes, é
--   normal ter que alterar no meio do caminho."*
--
--   Hoje ele não consegue. A tela troca a esteira APAGANDO a que existe e
--   criando outra, e o `status_tree_guard` da F17.3c recusa porque as tarefas
--   apontam para os status do conjunto velho — mesmo quando o conjunto novo tem
--   um status com o MESMO NOME. Acrescentar uma etapa numa lista em uso ficou
--   impossível, e acrescentar etapa é o ato mais banal que existe num quadro.
--
-- ⚠️ O GUARDA NÃO É DESLIGADO. ELE PASSA A SER CONFERIDO NO FIM DA TRANSAÇÃO.
--   Esta é a decisão central desta migração, e ela precisa ficar escrita porque
--   parece — e não é — um enfraquecimento.
--
--   A invariante da F17.3c é: *"nenhuma tarefa aponta para status fora da
--   esteira resolvida da lista dela"*. Ela é verdadeira sobre um ESTADO, e dar
--   esteira própria a uma lista que herdava é uma operação de DOIS passos:
--
--     1. o conjunto novo nasce e passa a resolver para a lista;
--     2. as tarefas mudam para os status equivalentes do conjunto novo.
--
--   Entre 1 e 2 o estado é incoerente, e não há ordem que evite isso: o passo 2
--   precisa que os status novos existam, e o passo 1 é o que os faz existir.
--   Um guarda que fala no fim do COMANDO recusa toda operação de dois passos,
--   inclusive as corretas. Um guarda que fala no fim da TRANSAÇÃO recusa
--   exatamente as incorretas.
--
--   Então `status_sets_workflow_guard` vira gatilho de RESTRIÇÃO
--   `deferrable initially deferred`. É a mesma função, a mesma tabela, os
--   mesmos eventos, a mesma mensagem e o mesmo `23514`. Quem fizer um `insert
--   into ideworks.status_sets` solto, à mão, continua sendo recusado e continua
--   sem gravar nada — só que no `commit`.
--
--   Não é invenção desta etapa: `status_sets_must_close` e `statuses_must_close`
--   (F17.2) já são gatilhos de restrição diferidos, na MESMA tabela, pela mesma
--   razão — a esteira nasce em dois comandos, o conjunto e os status.
--
--   Os outros dois gatilhos da F17.3c continuam IMEDIATOS:
--     · `statuses_workflow_guard` (status trocando de conjunto)
--     · `lists_workflow_guard`    (lista trocando de lugar na árvore)
--   Os dois são atos de UM comando. Diferir os três seria diferir por simetria,
--   e simetria não é motivo.
--
--   E `ideworks.set_list_workflow`, abaixo, termina com
--   `set constraints all immediate`: o guarda fala DENTRO da função, ainda
--   dentro da transação de quem chamou. É o que mantém a recusa chegando à tela
--   como recusa (400 com frase), e não como erro de `commit`.
--
-- A SEGUNDA COISA QUE MUDA: A FRASE DO GUARDA
--   A mensagem do `status_tree_guard` apareceu inteira na tela de um designer,
--   com `ideworks.move_task` dentro e mandando "ou conclua-as" — remédio que
--   não funciona, porque concluir não solta a tarefa do status. Ela é
--   reescrita aqui. O RESTO DA FUNÇÃO É O TEXTO DA F17.3c, PALAVRA POR PALAVRA,
--   comentários inclusive: a F17.3 aplicou quatro funções sem os comentários do
--   corpo e quase reencenou a dívida 8.3 do legado.
--
-- ROLLBACK
--   `supabase/rollback/20260827100000_ideworks_f17_19_esteira_que_migra.sql`
--   devolve o gatilho imediato, a frase antiga e apaga a função nova.
-- =============================================================================

-- --- 1. o guarda, com a frase de gente ---------------------------------------
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
      'a tarefa "%" da lista "%" esta no status %, da esteira "%", %. Sao % tarefa(s) no caminho. A esteira de uma lista so pode mudar quando nenhuma tarefa depende dela: diga para qual etapa cada uma dessas tarefas vai, e a mudanca passa. Concluir nao resolve — a tarefa concluida continua nessa etapa, e o guarda recusa de novo. Nada foi mudado.',
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
  'uma so. Na F17.19 a frase deixou de nomear funcao de banco e deixou de mandar '
  'CONCLUIR, que nao solta a tarefa do status — a tarefa concluida continua '
  'apontando para ele.';

-- --- 2. o guarda do conjunto passa a falar no fim da transacao ----------------
-- Ver o cabecalho: e a mesma conferencia, no unico momento em que "coerente"
-- tem sentido para uma operacao de dois passos. Gatilho de RESTRICAO para poder
-- ser diferido, e `initially deferred` porque a operacao normal desta etapa —
-- dar esteira propria a uma lista em uso — e sempre de dois passos.
--
-- Quem quiser a conferencia na hora continua tendo: `set constraints all
-- immediate` forca, e e o que `ideworks.set_list_workflow` faz no fim.
drop trigger if exists status_sets_workflow_guard on ideworks.status_sets;
create constraint trigger status_sets_workflow_guard
  after insert or update on ideworks.status_sets
  deferrable initially deferred
  for each row execute function ideworks.status_tree_guard();

-- Os outros dois continuam IMEDIATOS, e sao recriados aqui para o arquivo
-- descrever o estado inteiro dos tres — ler metade da regra em duas migrations
-- diferentes e como a divida 8.3 comeca.
drop trigger if exists statuses_workflow_guard on ideworks.statuses;
create trigger statuses_workflow_guard
  after update of status_set_id on ideworks.statuses
  for each row execute function ideworks.status_tree_guard();

drop trigger if exists lists_workflow_guard on ideworks.lists;
create trigger lists_workflow_guard
  after update of space_id, folder_id on ideworks.lists
  for each row execute function ideworks.status_tree_guard();

-- --- 3. mudar a esteira de uma lista SEM esvaziar a lista ---------------------
--
-- O QUE ELA FAZ, E POR QUE E UMA FUNCAO E NAO TRES COMANDOS DA TELA
--   Porque os tres comandos so sao corretos JUNTOS, e "junto" e o que uma
--   funcao garante mesmo para quem chamar de um script. E a regra 9 do roteiro,
--   a mesma que fez `create_status_set` nascer em bloco.
--
-- AS DUAS ESTRADAS, E POR QUE SAO DIFERENTES
--   · A lista JA TEM esteira propria → o conjunto e MEXIDO no lugar. Etapa nova
--     entra, etapa que fica e renomeada/recolorida/reordenada, etapa que sai
--     perde as tarefas para o destino e so entao e apagada. Nenhum gatilho de
--     arvore dispara: o conjunto nao nasce nem muda de dono, e nenhum status
--     troca de conjunto. Acrescentar etapa numa lista em uso passa a ser tao
--     barato quanto renomear uma.
--
--   · A lista HERDA → o conjunto novo nasce (o guarda fica pendente) e as
--     tarefas migram para as etapas equivalentes. No fim, `set constraints all
--     immediate` faz o guarda falar, e ele encontra tudo coerente.
--
-- COMO UMA TAREFA ACHA A ETAPA NOVA DELA
--   Tres tentativas, nesta ordem:
--     1. o `id` que a tela mandou junto da etapa — e ela manda, porque o editor
--        abriu com a esteira de hoje. E o que faz RENOMEAR ser renomear: a etapa
--        `a fazer` que virou `pendente` continua sendo a mesma etapa.
--     2. o NOME, sem diferenca de caixa nem de espaco nas pontas. E o que faz a
--        lista que herdava encontrar sozinha o `a fazer` do conjunto novo.
--     3. `p_destinos`, que a tela preenche quando perguntou.
--
--   Nao achou nenhuma das tres → recusa dizendo QUAIS etapas ficaram sem
--   destino, para a tela perguntar em vez de desistir. A recusa termina com
--   `sem destino: a | b | c`, e e por esse rabo que a tela reconhece o caso.
--
-- ⚠️ O MAPA E CALCULADO ANTES DE QUALQUER ESCRITA, e isso nao e capricho:
--   a estrada 1 renomeia os status no lugar, e um mapa calculado depois leria
--   os nomes JA TROCADOS. A tarefa parada em `a fazer` deixaria de achar o
--   caminho dela justamente na operacao que existe para nao perde-la.
--
-- `security invoker`, como `create_status_set`: quem autoriza e a politica de
-- linha, e nao uma copia da regra aqui dentro.
create or replace function ideworks.set_list_workflow(
  p_list_id    uuid,
  p_name       text,
  p_statuses   jsonb,
  p_destinos   jsonb default '[]'::jsonb,
  p_created_by uuid default null)
  returns jsonb
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_nome        text := btrim(coalesce(p_name, ''));
  v_lista       text;
  v_set_atual   uuid;
  v_propria     boolean;
  v_set         uuid;
  v_movidas     integer := 0;
  v_orfas       text;
  v_item        jsonb;
  v_tipo        text;
  v_fecham      integer := 0;
  v_quantos     integer := 0;
  v_antigos     uuid[];
  v_alvo        jsonb;
  v_mapa        jsonb;
  c_tipos       constant text[] := array['open', 'unstarted', 'custom', 'done', 'closed'];
begin
  select l.name into v_lista from ideworks.lists l where l.id = p_list_id;

  if v_lista is null then
    raise exception 'lista nao encontrada, ou fora do seu alcance. Nada foi mudado.'
      using errcode = '22023';
  end if;

  if v_nome = '' then
    raise exception 'a esteira precisa de um nome. Nada foi mudado.'
      using errcode = '22023';
  end if;

  -- --- confere TUDO antes de gravar QUALQUER coisa --------------------------
  -- A mesma ordem de `create_status_set`, e pela mesma razao: recusar no meio
  -- deixaria uma esteira pela metade para quem nao usa transacao. A estrada de
  -- MEXER NO LUGAR nao passa por `create_status_set`, entao a conferencia
  -- precisa existir aqui tambem — senao ela seria a porta sem guarda.
  if jsonb_typeof(p_statuses) is distinct from 'array'
     or jsonb_array_length(p_statuses) = 0 then
    raise exception 'a esteira "%" precisa de ao menos uma etapa. Nada foi mudado.', v_nome
      using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_statuses) loop
    v_quantos := v_quantos + 1;
    v_tipo := v_item ->> 'type';

    if btrim(coalesce(v_item ->> 'name', '')) = '' then
      raise exception 'a etapa % da esteira "%" esta sem nome. Nada foi mudado.',
        v_quantos, v_nome
        using errcode = '22023';
    end if;

    if v_tipo is null or not (v_tipo = any (c_tipos)) then
      raise exception
        'a etapa "%" veio com um grupo que nao existe. Os grupos sao: nao iniciado, ativo, feito e fechado. Nada foi mudado.',
        btrim(v_item ->> 'name')
        using errcode = '22023';
    end if;

    if v_tipo = 'closed' then v_fecham := v_fecham + 1; end if;
  end loop;

  if v_fecham <> 1 then
    raise exception
      'a esteira "%" tem % etapa(s) que fecham, e precisa de exatamente uma. E ela que faz o quadro saber onde e o fim — sem ela a tarefa entra e nunca sai. Nada foi mudado.',
      v_nome, v_fecham
      using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_statuses) e
     group by lower(btrim(e.value ->> 'name'))
    having count(*) > 1
  ) then
    raise exception
      'a esteira "%" tem duas etapas com o mesmo nome, e o quadro nao saberia qual coluna e qual. Nada foi mudado.',
      v_nome
      using errcode = '23514';
  end if;

  -- --- de onde a lista tira a esteira hoje ----------------------------------
  v_set_atual := ideworks.resolve_status_set(p_list_id);

  if v_set_atual is null then
    raise exception
      'a lista "%" nao tem esteira nenhuma para partir — nem ela, nem a pasta, nem o espaco. Nada foi mudado.',
      v_lista
      using errcode = '22023';
  end if;

  select (ss.list_id = p_list_id) into v_propria
    from ideworks.status_sets ss where ss.id = v_set_atual;
  v_propria := coalesce(v_propria, false);

  select array_agg(s.id) into v_antigos
    from ideworks.statuses s where s.status_set_id = v_set_atual;

  -- --- as etapas que perderiam tarefa sem ter para onde manda-la ------------
  -- Uma etapa so precisa de destino quando ha TAREFA DESTA LISTA parada nela.
  -- Etapa vazia que some nao pergunta nada a ninguem — e o caso comum, e e o
  -- que faz "acrescentar uma etapa" nao virar um interrogatorio.
  select string_agg(x.nome, ' | ' order by x.nome) into v_orfas
    from (
      select distinct s.name as nome
        from ideworks.tasks t
        join ideworks.statuses s on s.id = t.status_id
       where t.list_id = p_list_id
         and s.status_set_id = v_set_atual
         and not exists (
               select 1 from jsonb_array_elements(p_statuses) e
                where (e.value ->> 'id')::uuid = s.id)
         and not exists (
               select 1 from jsonb_array_elements(p_statuses) e
                where lower(btrim(e.value ->> 'name')) = lower(btrim(s.name)))
         and not exists (
               select 1 from jsonb_array_elements(p_destinos) d
                where (d.value ->> 'de')::uuid = s.id)
    ) x;

  if v_orfas is not null then
    raise exception
      'a lista "%" tem tarefa parada em etapa que a esteira nova nao tem. Diga para onde essas tarefas vao e a mudanca passa. Nada foi mudado. sem destino: %',
      v_lista, v_orfas
      using errcode = '22023';
  end if;

  -- --- O MAPA, CALCULADO ANTES DE ESCREVER. Ver o cabecalho. ----------------
  -- `alvo` e a linha de status que cada etapa pedida vai OCUPAR quando a lista
  -- ja tem esteira propria; nulo quer dizer "etapa nova, nasce".
  select jsonb_agg(jsonb_build_object(
           'alvo',  x.id_alvo,
           'nome',  x.nome,
           'tipo',  x.tipo,
           'cor',   x.cor,
           'ordem', x.ordem) order by x.ordem)
    into v_alvo
    from (
      select btrim(e.value ->> 'name') as nome,
             e.value ->> 'type'        as tipo,
             nullif(btrim(coalesce(e.value ->> 'color', '')), '') as cor,
             (e.ordem::int - 1)        as ordem,
             coalesce(
               (select s.id from ideworks.statuses s
                 where s.status_set_id = v_set_atual
                   and s.id = (e.value ->> 'id')::uuid),
               (select s.id from ideworks.statuses s
                 where s.status_set_id = v_set_atual
                   and lower(btrim(s.name)) = lower(btrim(e.value ->> 'name')))
             ) as id_alvo
        from jsonb_array_elements(p_statuses) with ordinality as e(value, ordem)
    ) x;

  -- `chave` e o NOME da etapa de destino, em caixa baixa: e o unico apontador
  -- que sobrevive as duas estradas, porque na estrada 2 as linhas de status sao
  -- outras e so o nome atravessa.
  select jsonb_agg(jsonb_build_object('velho', m.velho, 'chave', m.chave))
    into v_mapa
    from (
      select s.id as velho,
             coalesce(
               (select lower(btrim(e.value ->> 'name'))
                  from jsonb_array_elements(p_statuses) e
                 where (e.value ->> 'id')::uuid = s.id limit 1),
               (select lower(btrim(e.value ->> 'name'))
                  from jsonb_array_elements(p_statuses) e
                 where lower(btrim(e.value ->> 'name')) = lower(btrim(s.name)) limit 1),
               (select lower(btrim(d.value ->> 'para'))
                  from jsonb_array_elements(p_destinos) d
                 where (d.value ->> 'de')::uuid = s.id limit 1)
             ) as chave
        from ideworks.statuses s
       where s.status_set_id = v_set_atual
    ) m
   where m.chave is not null;

  if v_propria then
    -- ESTRADA 1: a lista ja tem esteira propria — mexe no lugar.
    v_set := v_set_atual;

    update ideworks.status_sets
       set name = v_nome, updated_at = now()
     where id = v_set;

    -- ⚠️ O PASSO NEUTRO EXISTE POR CAUSA DE DOIS INDICES UNICOS, e nao por
    -- estilo: `statuses_name_key` (nome unico no conjunto) e
    -- `statuses_one_closing_key` (um so que fecha). Trocar o nome de duas
    -- etapas entre si, ou mudar QUAL etapa fecha, esbarra num deles no meio do
    -- caminho. O nome vira o proprio `id` (unico por definicao, e nunca em
    -- branco) e o grupo vira `custom` (que nao fecha); os valores de verdade
    -- entram na frente.
    update ideworks.statuses
       set name = id::text, type = 'custom'::ideworks.status_type, updated_at = now()
     where status_set_id = v_set;

    update ideworks.statuses s
       set name       = a.nome,
           type       = a.tipo,
           color      = coalesce(a.cor, s.color),
           sort_order = a.ordem,
           updated_at = now()
      from (
        select (e.value ->> 'alvo')::uuid as alvo,
               e.value ->> 'nome'         as nome,
               (e.value ->> 'tipo')::ideworks.status_type as tipo,
               e.value ->> 'cor'          as cor,
               (e.value ->> 'ordem')::int as ordem
          from jsonb_array_elements(v_alvo) e
      ) a
     where s.id = a.alvo;

    insert into ideworks.statuses (status_set_id, name, type, color, sort_order)
    select v_set, a.nome, a.tipo, coalesce(a.cor, '#8a8f98'), a.ordem
      from (
        select (e.value ->> 'alvo')::uuid as alvo,
               e.value ->> 'nome'         as nome,
               (e.value ->> 'tipo')::ideworks.status_type as tipo,
               e.value ->> 'cor'          as cor,
               (e.value ->> 'ordem')::int as ordem
          from jsonb_array_elements(v_alvo) e
      ) a
     where a.alvo is null;

  else
    -- ESTRADA 2: a lista herdava — o conjunto novo nasce.
    -- O guarda fica PENDENTE aqui, e e por isso que ele precisou ser diferido.
    -- Ver o cabecalho.
    v_set := ideworks.create_status_set(
               v_nome, p_statuses, null, null, p_list_id, null, p_created_by);
  end if;

  -- --- as tarefas migram para a etapa equivalente ---------------------------
  -- Vale para as DUAS estradas. Na 1 ela move quem estava numa etapa que sumiu
  -- ou que trocou de nome; na 2 ela move todo mundo, porque toda linha mudou.
  with mapa as (
    select (m.value ->> 'velho')::uuid as velho,
           m.value ->> 'chave'         as chave
      from jsonb_array_elements(coalesce(v_mapa, '[]'::jsonb)) m
  ),
  novo as (
    select s.id, lower(btrim(s.name)) as chave
      from ideworks.statuses s where s.status_set_id = v_set
  ),
  movidas as (
    update ideworks.tasks t
       set status_id = n.id, updated_at = now()
      from mapa m
      join novo n on n.chave = m.chave
     where t.list_id  = p_list_id
       and t.status_id = m.velho
       and n.id is distinct from t.status_id
    returning t.id
  )
  select count(*)::int into v_movidas from movidas;

  -- --- so agora as etapas que sairam podem ser apagadas ---------------------
  -- `tasks_status_fk` e `on delete restrict`: se sobrou tarefa apontando para
  -- alguma, o banco recusa aqui, e a recusa e verdadeira. As linhas NOVAS ficam
  -- de fora por construcao — a lista de sobreviventes e a dos ids ANTIGOS.
  if v_propria then
    delete from ideworks.statuses s
     where s.id = any (coalesce(v_antigos, array[]::uuid[]))
       and not exists (
             select 1 from jsonb_array_elements(v_alvo) e
              where (e.value ->> 'alvo')::uuid = s.id);
  end if;

  -- ⚠️ O GUARDA FALA AQUI, e nao no `commit`.
  -- Sem esta linha a recusa chegaria a tela como erro de transacao, sem frase e
  -- sem codigo — o mesmo estrago que a etapa veio consertar, do outro lado.
  set constraints all immediate;

  return jsonb_build_object(
    'status_set_id',    v_set,
    'moved',            v_movidas,
    'inherited_before', not v_propria);
end;
$fn$;

comment on function ideworks.set_list_workflow(uuid, text, jsonb, jsonb, uuid) is
  'Muda a esteira de uma lista SEM esvaziar a lista. Acrescentar, renomear, '
  'recolorir e reordenar etapa funcionam com tarefa dentro; apagar etapa com '
  'tarefa dentro exige destino, e a recusa diz quais etapas ficaram sem ele '
  '(`sem destino: a | b`). Quem herdava ganha conjunto proprio e as tarefas '
  'migram pela identidade da etapa, ou pelo nome. O `status_tree_guard` '
  'continua valendo: a funcao termina com `set constraints all immediate` para '
  'ele conferir o resultado ainda dentro da transacao de quem chamou.';

grant execute on function ideworks.set_list_workflow(uuid, text, jsonb, jsonb, uuid)
  to ideworks_app;
