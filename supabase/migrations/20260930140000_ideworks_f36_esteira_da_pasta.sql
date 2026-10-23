-- F36: uma esteira da pasta, herdada por todas as listas, inclusive arquivadas.
-- Invocação somente pelo backend restrito; identidade vem de withActor.
-- A verificação continua imediata por padrão. A aplicação em bloco difere
-- apenas esta referência durante a troca, e a força antes de retornar.
alter table ideworks.tasks drop constraint tasks_status_fk;
alter table ideworks.tasks add constraint tasks_status_fk foreign key(status_id)
  references ideworks.statuses(id) on delete no action deferrable initially immediate;

create or replace function ideworks.folder_workflow(p_folder uuid, p_input jsonb default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, ideworks, pg_temp
as $fn$
declare
  f record; l record; base uuid; target uuid; v_lists uuid[]; own_sets uuid[];
  originals jsonb; initial jsonb; revision text; mappings jsonb; missing text;
  states jsonb; destinations jsonb; v_name text; moved integer;
begin
  select * into f from ideworks.folders where id=p_folder for update;
  if not found or ideworks.can_act_on_chain(f.space_id,p_folder,null,'create') is not true then
    raise exception 'Você não tem permissão para mudar a esteira desta pasta.' using errcode='42501';
  end if;
  -- FK de lists.folder_id usa key share: a trava acima impede novas filhas
  -- durante a decisão. Travas de lista também impedem novas tarefas no meio.
  for l in select * from ideworks.lists where folder_id=p_folder order by id for update loop
    if ideworks.can_act_on_chain(l.space_id,l.folder_id,l.id,'create') is not true then
      raise exception 'Você precisa de permissão para editar todas as listas desta pasta.' using errcode='42501';
    end if;
  end loop;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_lists from ideworks.lists where folder_id=p_folder;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into own_sets from ideworks.status_sets where list_id=any(v_lists);
  select id into target from ideworks.status_sets where folder_id=p_folder;
  base := coalesce(target,(select id from ideworks.status_sets where space_id=f.space_id));
  perform 1 from ideworks.status_sets where id=base or id=any(own_sets) order by id for update;
  perform 1 from ideworks.statuses where status_set_id=base or status_set_id=any(own_sets) order by id for update;
  perform 1 from ideworks.tasks where list_id=any(v_lists) order by id for update;
  if exists(select 1 from ideworks.tasks t where t.list_id=any(v_lists)
    and ideworks.can_act_on_task(t.list_id,t.client_id,'execute') is not true) then
    raise exception 'Você precisa de permissão para editar as tarefas das listas desta pasta.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'type',s.type,'color',s.color)
    order by s.sort_order,s.name,s.id),'[]') into initial
    from ideworks.statuses s where s.status_set_id=base;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'type',s.type,'color',s.color)
    order by s.id),'[]') into originals from ideworks.statuses s
    where s.status_set_id=base or s.status_set_id=any(own_sets);
  revision := md5(jsonb_build_object('lists',v_lists,'own',own_sets,'base',base,'initial',initial,'originals',originals)::text);
  if p_input is null then
    return jsonb_build_object('name',coalesce((select name from ideworks.status_sets where id=base),'Esteira'),
      'statuses',initial,'originals',originals,'revision',revision,'lists',cardinality(v_lists),
      'archived',(select count(*) from ideworks.lists where id=any(v_lists) and archived_at is not null),
      'tasks',(select count(*) from ideworks.tasks where list_id=any(v_lists)));
  end if;
  if p_input->>'revision' is distinct from revision then
    raise exception 'As listas ou etapas da pasta mudaram. Feche e abra o editor novamente.' using errcode='40001';
  end if;
  states := p_input->'statuses'; destinations := coalesce(p_input->'destinos','[]');
  v_name := btrim(coalesce(p_input->>'name',''));
  if v_name='' or jsonb_typeof(states) is distinct from 'array' or jsonb_array_length(states)=0 then
    raise exception 'Informe o nome e as etapas da esteira.' using errcode='22023';
  end if;
  if jsonb_typeof(destinations) is distinct from 'array' then
    raise exception 'Informe destinos válidos.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(states) e where btrim(coalesce(e->>'name',''))=''
    or coalesce(e->>'type','') not in ('open','unstarted','custom','done','closed'))
    or (select count(*) from jsonb_array_elements(states) e where e->>'type'='closed')<>1
    or exists(select 1 from jsonb_array_elements(states) e group by lower(btrim(e->>'name')) having count(*)>1) then
    raise exception 'Use nomes únicos, grupos válidos e exatamente uma etapa fechada.' using errcode='22023';
  end if;
  -- Identidade / mesmo nome / renomeação da etapa base / destino explícito.
  select jsonb_agg(jsonb_build_object('old',o->>'id','name',o->>'name','to',coalesce(
    (select btrim(e->>'name') from jsonb_array_elements(states) e where e->>'id'=o->>'id' limit 1),
    (select btrim(e->>'name') from jsonb_array_elements(states) e where lower(btrim(e->>'name'))=lower(btrim(o->>'name')) limit 1),
    (select btrim(e->>'name') from jsonb_array_elements(states) e join jsonb_array_elements(initial) i on e->>'id'=i->>'id'
      where lower(btrim(i->>'name'))=lower(btrim(o->>'name')) limit 1),
    (select btrim(d->>'para') from jsonb_array_elements(destinations) d where d->>'de'=o->>'id' limit 1)
  ))) into mappings from jsonb_array_elements(originals) o;
  -- Uma regra externa que chega aqui também precisa poder ser editada.
  for l in select a.*,s.space_id,s.folder_id from ideworks.task_automations a
    join ideworks.lists s on s.id=a.source_list_id
    where a.source_list_id=any(v_lists) or a.target_list_id=any(v_lists) for update of a loop
    if ideworks.can_act_on_chain(l.space_id,l.folder_id,l.source_list_id,'create') is not true then
      raise exception 'Há uma automação ligada à pasta que você não pode editar.' using errcode='42501';
    end if;
  end loop;
  select string_agg(distinct m->>'name',' | ') into missing from jsonb_array_elements(mappings) m
  where not exists(select 1 from jsonb_array_elements(states) e where btrim(e->>'name')=m->>'to')
  and (exists(select 1 from ideworks.tasks t where t.list_id=any(v_lists) and t.status_id=(m->>'old')::uuid)
    or exists(select 1 from ideworks.task_automations a
      where (a.source_list_id=any(v_lists) and a.trigger_status_id=(m->>'old')::uuid)
      or (a.target_list_id=any(v_lists) and a.target_status_id=(m->>'old')::uuid)));
  if missing is not null then
    raise exception 'Etapas com tarefas ou automações precisam de destino. sem destino: %',missing using errcode='22023';
  end if;
  set constraints all deferred;
  if target is null then
    target := ideworks.create_status_set(v_name,states,null,p_folder,null,null,ideworks.acting_user_id());
  else
    update ideworks.status_sets set name=v_name,updated_at=now() where id=target;
    update ideworks.statuses set name=id::text,type='custom',updated_at=now() where status_set_id=target;
    insert into ideworks.statuses(status_set_id,name,type,color,sort_order)
    select target,btrim(e->>'name'),(e->>'type')::ideworks.status_type,
      coalesce(e->>'color','#8a8f98'),ord::int-1
      from jsonb_array_elements(states) with ordinality x(e,ord);
  end if;
  -- Acrescenta o id real do destino ao mapa, sem tocar em outra pasta/espaço.
  select jsonb_agg(m || jsonb_build_object('new',s.id)) into mappings
    from jsonb_array_elements(mappings) m left join ideworks.statuses s
      on s.status_set_id=target and s.name=m->>'to';
  -- Papéis incompatíveis ou duas regras que passariam a ter o mesmo gatilho
  -- são recusados pelas chaves únicas: a transação inteira é desfeita.
  insert into ideworks.automation_stages(list_id,status_id,stage)
    select distinct g.list_id,(m->>'new')::uuid,g.stage
    from ideworks.automation_stages g join jsonb_array_elements(mappings) m on g.status_id=(m->>'old')::uuid
    where g.list_id=any(v_lists) and m->>'new' is not null;
  update ideworks.task_automations a set trigger_status_id=(m->>'new')::uuid
    from jsonb_array_elements(mappings) m
    where a.source_list_id=any(v_lists) and a.trigger_status_id=(m->>'old')::uuid and m->>'new' is not null;
  update ideworks.task_automations a set target_status_id=(m->>'new')::uuid
    from jsonb_array_elements(mappings) m
    where a.target_list_id=any(v_lists) and a.target_status_id=(m->>'old')::uuid and m->>'new' is not null;
  delete from ideworks.automation_stages g where g.list_id=any(v_lists)
    and exists(select 1 from jsonb_array_elements(mappings) m where g.status_id=(m->>'old')::uuid);
  -- Resolve a pasta antes do BEFORE trigger das tarefas conferir o destino.
  -- A referência antiga permanece protegida pela FK diferida até o fim.
  delete from ideworks.status_sets where id=any(own_sets);
  update ideworks.tasks t set status_id=(m->>'new')::uuid,updated_at=now()
    from jsonb_array_elements(mappings) m where t.list_id=any(v_lists)
      and t.status_id=(m->>'old')::uuid and m->>'new' is not null;
  get diagnostics moved = row_count;
  delete from ideworks.statuses s where s.status_set_id=target
    and exists(select 1 from jsonb_array_elements(originals) o where s.id=(o->>'id')::uuid);
  set constraints all immediate;
  set constraints all deferred;
  return jsonb_build_object('lists',cardinality(v_lists),'moved',moved,'statusSetId',target);
end
$fn$;
revoke all on function ideworks.folder_workflow(uuid,jsonb) from public,anon,authenticated;
grant execute on function ideworks.folder_workflow(uuid,jsonb) to ideworks_app;
comment on function ideworks.folder_workflow(uuid,jsonb) is
  'F36: prévia e aplicação atômica da esteira da pasta; valida permissão em todas as listas e preserva tarefas e automações.';
