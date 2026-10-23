-- Preservar a etapa ao mudar de lista: Refação no Atendimento -> Refação na Blue Sky.
-- Só altera funções de ideworks. Nenhuma tarefa ou usuário é atualizado pela migration.
-- A unicidade (status_set_id, lower(btrim(name))) garante um único equivalente.
create or replace function ideworks.status_for_move(p_status_id uuid, p_status_set_id uuid)
  returns uuid
  language sql stable security invoker
  set search_path = ideworks, pg_temp
as $fn$
  select coalesce(
    (select destino.id
       from ideworks.statuses origem
       join ideworks.statuses destino
         on destino.status_set_id = p_status_set_id
        and lower(btrim(destino.name)) = lower(btrim(origem.name))
      where origem.id = p_status_id),
    ideworks.first_open_status(p_status_set_id))
$fn$;

comment on function ideworks.status_for_move(uuid, uuid) is
  'Resolve a etapa pelo nome normalizado na esteira de destino; sem equivalente, '
  'usa a primeira aberta. Respeita as políticas de quem chama.';
revoke all on function ideworks.status_for_move(uuid, uuid) from public, anon, authenticated;
grant execute on function ideworks.status_for_move(uuid, uuid) to ideworks_app;

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
  else
    -- Outra lista pode ter a MESMA etapa com outro UUID. Primeiro preserva
    -- o nome; somente sem equivalente escolhe a primeira etapa aberta.
    v_novo := ideworks.status_for_move(v_status_antes, v_set);

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
                        else ideworks.status_for_move(t.status_id, v_set)
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
                            else ideworks.status_for_move(t.status_id, v_set_destino)
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
    -- Trocar o UUID para o equivalente da outra lista não muda a etapa.
    -- O aviso diz respeito à etapa escolhida antes de eventual automação.
    'status_repositioned', v_novo is distinct from v_status_antes and not exists (
      select 1 from ideworks.statuses a join ideworks.statuses b
        on lower(btrim(a.name)) = lower(btrim(b.name))
       where a.id = v_status_antes and b.id = v_novo),
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


-- Prova funcional na aplicação: falha impede a migration, sucesso desfaz as sondas.
do $test$
declare
  actor uuid; company uuid; space uuid;
  origin uuid; target uuid; inherited uuid; missing uuid;
  ref_origin uuid; ref_target uuid; closed_origin uuid; closed_target uuid;
  open_target uuid; fallback_status uuid;
  task uuid; parent uuid; child uuid;
  result jsonb; row_after record; before_closed record;
  events integer;
begin
  -- As sondas e as variáveis de ator ficam numa subtransação desfeita.
  begin
  perform set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true);
  perform set_config('app.is_superadmin', 'true', true);
  perform set_config('app.is_super', 'true', true);
  select id into actor from ideworks.profiles where role = 'super_admin' limit 1;
  select id into company from ideworks.client_categories order by id limit 1;
  -- INSTALAÇÃO LIMPA: sem super admin nem empresa ainda, não há em nome de
  -- quem registrar as sondas. A prova é pulada (e desfeita como sempre).
  if actor is null or company is null then
    raise notice 'F17.80: banco sem super admin ou empresa ainda; prova funcional pulada.';
    raise exception using errcode = 'Z0001', message = 'sem ator para as sondas';
  end if;
  perform set_config('app.user_id', actor::text, true);
  insert into ideworks.spaces(category_id, name, created_by)
    values(company, 'Sonda preservar etapa', actor) returning id into space;
  perform ideworks.create_status_set('Sonda origem',
    '[{"name":"a fazer","type":"open"},{"name":"refação","type":"custom"},{"name":"concluída","type":"closed"}]'::jsonb,
    space, null::uuid, null::uuid, null::text, actor);
  insert into ideworks.lists(space_id, name, created_by) values(space,'Sonda atendimento',actor) returning id into origin;
  insert into ideworks.lists(space_id, name, created_by) values(space,'Sonda destino',actor) returning id into target;
  insert into ideworks.lists(space_id, name, created_by) values(space,'Sonda herdada',actor) returning id into inherited;
  insert into ideworks.lists(space_id, name, created_by) values(space,'Sonda sem refação',actor) returning id into missing;
  perform ideworks.create_status_set('Sonda destino',
    '[{"name":"A FAZER","type":"open"},{"name":"REFAÇÃO","type":"custom"},{"name":"CONCLUÍDA","type":"closed"}]'::jsonb,
    null::uuid, null::uuid, target, null::text, actor);
  perform ideworks.create_status_set('Sonda sem equivalente',
    '[{"name":"na fila","type":"open"},{"name":"fim","type":"closed"}]'::jsonb,
    null::uuid, null::uuid, missing, null::text, actor);
  set constraints all immediate;
  set constraints all deferred;
  select id into ref_origin from ideworks.statuses where status_set_id=ideworks.resolve_status_set(origin) and name='refação';
  select id into ref_target from ideworks.statuses where status_set_id=ideworks.resolve_status_set(target) and name='REFAÇÃO';
  select id into closed_origin from ideworks.statuses where status_set_id=ideworks.resolve_status_set(origin) and type='closed';
  select id into closed_target from ideworks.statuses where status_set_id=ideworks.resolve_status_set(target) and type='closed';
  select id into open_target from ideworks.statuses where status_set_id=ideworks.resolve_status_set(target) and type='open';
  select id into fallback_status from ideworks.statuses where status_set_id=ideworks.resolve_status_set(missing) and type='open';
  assert ref_origin <> ref_target, 'mesmo nome precisa ter IDs distintos neste cenário';
  insert into ideworks.tasks(list_id,status_id,title,created_by)
    values(origin,ref_origin,'Sonda preservar etapa',actor) returning id into task;
  result := ideworks.move_task(task,target,null);
  assert (result->>'status_id')::uuid = ref_target, 'Refação deve permanecer Refação com o ID do destino';
  assert (result->>'status_repositioned')::boolean = false, 'mesma etapa não anuncia reposicionamento';
  select list_id,status_id into row_after from ideworks.tasks where id=task;
  assert row_after.list_id=target and row_after.status_id=ref_target, 'a tarefa deve estar na etapa equivalente do destino';
  select count(*) into events from ideworks.task_events where task_id=task and from_status_id=ref_origin and to_status_id=ref_target;
  assert events=1, 'histórico registra origem e destino uma vez';
  perform ideworks.move_task(task,target,null);
  select count(*) into events from ideworks.task_events where task_id=task;
  assert events=1, 'repetição idempotente não duplica histórico';

  result := ideworks.move_task(task,inherited,null);
  assert (result->>'status_id')::uuid=ref_origin and not (result->>'status_repositioned')::boolean, 'volta também preserva o nome';
  result := ideworks.move_task(task,origin,null);
  assert (result->>'status_id')::uuid=ref_origin and not (result->>'status_repositioned')::boolean, 'esteira compartilhada mantém o ID';
  result := ideworks.move_task(task,missing,null);
  assert (result->>'status_id')::uuid=fallback_status and (result->>'status_repositioned')::boolean, 'sem equivalente usa primeira etapa e avisa';

  insert into ideworks.tasks(list_id,status_id,title,created_by)
    values(origin,ref_origin,'Sonda mãe',actor) returning id into parent;
  insert into ideworks.tasks(list_id,status_id,parent_id,title,created_by)
    values(origin,ref_origin,parent,'Sonda filha',actor) returning id into child;
  result := ideworks.move_task(parent,target,null);
  assert (result->>'subtasks_moved')::integer=1, 'subtarefa acompanha a mãe';
  select list_id,status_id into row_after from ideworks.tasks where id=child;
  assert row_after.list_id=target and row_after.status_id=ref_target, 'subtarefa preserva sua etapa equivalente';

  insert into ideworks.tasks(list_id,status_id,title,created_by)
    values(origin,closed_origin,'Sonda concluída',actor) returning id into task;
  select completed_at,completed_by into before_closed from ideworks.tasks where id=task;
  result := ideworks.move_task(task,target,null);
  assert (result->>'status_id')::uuid=closed_target and not (result->>'status_repositioned')::boolean, 'etapa concluída equivalente é preservada';
  select completed_at,completed_by into row_after from ideworks.tasks where id=task;
  assert row_after.completed_at=before_closed.completed_at and row_after.completed_by=before_closed.completed_by, 'conclusão e autor são preservados';

  result := ideworks.move_task(task,target,open_target);
  assert (result->>'status_id')::uuid=open_target, 'escolha explícita prevalece';
  begin
    perform ideworks.move_task(task,target,ref_origin);
    raise exception 'ID de outra esteira deveria ser recusado';
  exception when check_violation then null;
  end;
  set constraints all immediate;
  raise exception using errcode = 'Z0001', message = 'desfazer sondas da migration';
  exception when sqlstate 'Z0001' then null;
  end;
end;
$test$;
