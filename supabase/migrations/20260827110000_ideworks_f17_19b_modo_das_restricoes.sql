-- =============================================================================
-- F17.19b — `SET CONSTRAINTS` VALE PARA A TRANSAÇÃO INTEIRA, E ISSO MORDEU
--
-- O QUE FOI MEDIDO, MINUTOS DEPOIS DE APLICAR A F17.19
--   `scripts/provar-esteira-que-migra.mjs` passou no caso 1 e morreu no caso 2:
--
--     a esteira "Esteira de Setembro" tem 0 status que fecha, e precisa de
--     exatamente um (tipo "closed").
--
--   A esteira TINHA o status que fecha. Quem mudou foi o MODO das restrições.
--
--   `set constraints all immediate` não é uma conferência avulsa: ele muda o
--   modo de todas as restrições diferíveis PELO RESTO DA TRANSAÇÃO. Então a
--   primeira chamada de `set_list_workflow` deixava `status_set_must_close` e
--   `statuses_must_close` — diferidos desde a F17.2 — em modo imediato; e a
--   segunda chamada, ao passar pelo passo neutro (que zera o tipo de todos os
--   status por um instante, para os dois índices únicos não colidirem),
--   esbarrava neles no meio do caminho.
--
--   Duas chamadas na mesma transação não são caso exótico: a tela salva a
--   esteira e, na mesma sessão de trabalho, a pessoa acrescenta outra etapa. E
--   qualquer transação que chamasse a função e depois fizesse outra escrita
--   herdava um modo que não pediu.
--
-- O CONSERTO
--   Forçar e DEVOLVER: `immediate` para o guarda falar aqui, `deferred` logo em
--   seguida para a transação continuar como estava. As três restrições
--   diferíveis do schema são `initially deferred`, então devolver ao diferido é
--   devolver ao declarado — conferido em `pg_constraint` antes de escrever isto.
--
--   É a mesma dupla de linhas que `scripts/provar-esteiras.mjs` já usava desde
--   a F17.2 para provar os dois guardas do fechamento. O padrão existia; esta
--   função é que não o tinha seguido.
--
-- O RESTO DA FUNÇÃO É O TEXTO DA F17.19, PALAVRA POR PALAVRA.
-- =============================================================================

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
  -- Sem a primeira linha a recusa chegaria a tela como erro de transacao, sem
  -- frase e sem codigo — o mesmo estrago que a etapa veio consertar, do outro
  -- lado. Sem a SEGUNDA, a transacao seguiria com todas as restricoes diferiveis
  -- em modo imediato, e a chamada seguinte morreria no passo neutro. Medido na
  -- F17.19b, ver o cabecalho.
  set constraints all immediate;
  set constraints all deferred;

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
  'continua valendo: a funcao forca `set constraints all immediate` para ele '
  'conferir o resultado ainda dentro da transacao de quem chamou, e devolve o '
  'modo ao diferido em seguida — senao a chamada seguinte herdaria um modo que '
  'nao pediu (F17.19b).';
