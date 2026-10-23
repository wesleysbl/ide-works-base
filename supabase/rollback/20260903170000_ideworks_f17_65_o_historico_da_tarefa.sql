-- =============================================================================
-- ROLLBACK — F17.65  O historico de movimentacao da tarefa
-- =============================================================================
-- ⚠️ O QUE SE PERDE AO DESFAZER, E É PRECISO SABER ANTES
--   O histórico volta a registrar SÓ automação. Trocar status, responsável ou
--   lista à mão deixa de deixar rastro — e a linha do tempo da ficha volta a
--   ficar vazia em toda tarefa que nenhuma regra tocou.
--
-- ⚠️ E ELE NÃO APAGA EVENTO NENHUM. `task_events` continua com todas as linhas
--   que a F17.65 escreveu. É de propósito: o livro não se reescreve, e desfazer
--   o CÓDIGO que escreve não é desfazer o que já aconteceu.
--
-- ⚠️ POR ISSO A ORDEM AQUI É AO CONTRÁRIO DA MIGRATION
--   Primeiro as duas funções voltam ao texto anterior — enquanto elas
--   existirem escrevendo `automation_name` nulo, a coluna não pode voltar a ser
--   obrigatória. Só depois o esquema recua.
--
-- ⚠️ E O RECUO DO ESQUEMA PODE SER RECUSADO, LEGITIMAMENTE
--   `alter column automation_name set not null` FALHA se já houver evento à mão
--   gravado — e é o esperado, não um defeito: aquelas linhas são fatos. Quem
--   precisa mesmo recuar tem de decidir o que fazer com elas, e a decisão não é
--   deste arquivo. Por isso o `set not null` está COMENTADO no fim: descomente
--   só com a resposta na mão.
--
--   As quatro colunas de retrato e `added_user_ids` ficam onde estão, pelo
--   mesmo motivo: derrubá-las apagaria o nome da lista apagada e quem entrou
--   numa troca — dado que só existe ali.
-- =============================================================================

set local lock_timeout = '15s';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — `set_task_assignees` volta ao texto da F17.23
--
-- ⚠️ DA F17.23, E NÃO DA F17.3. A F17.23 substituiu a pergunta de alcance desta
-- função por `can_act_on_task(..., 'execute')` — alcance MAIS nível. Voltar ao
-- texto da F17.3 seria afrouxar a permissão sem ninguém pedir, e foi
-- exatamente o erro que `conferir-schema.mjs` pegou ao escrever esta etapa.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function ideworks.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id
       and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
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

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — `move_task` volta ao texto da F17.41
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

  select t.status_id into v_novo from ideworks.tasks t where t.id = p_task_id;

  v_lista_fim  := p_list_id;
  v_status_fim := v_novo;

  -- ═══ A AUTOMAÇÃO — F17.41 ════════════════════════════════════════════════
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
    insert into ideworks.task_events
      (task_id, automation_id, automation_name,
       from_list_id, to_list_id, from_status_id, to_status_id,
       removed_user_ids, added_user_id, actor_id)
    values
      (p_task_id, v_regra.id, v_regra.name,
       p_list_id, v_lista_fim, v_novo, v_status_fim,
       coalesce(v_tirados, '{}'::uuid[]), v_regra.assignee_id,
       ideworks.acting_user_id());
  end if;

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
  'escrita (F17.15), e desde a F17.41 roda a automacao da etapa de chegada na '
  'MESMA transacao: encaminha para outra lista, substitui o responsavel, e '
  'grava em task_events o que fez. Corrente de automacao e impossivel — o par '
  'de chegada tem papel 1 em automation_stages, e papel 1 nunca dispara. '
  'Devolve o que fez, inclusive o que a automacao fez.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 3 — as restrições de coerência saem
--
-- Elas descrevem o mundo da F17.65 (evento à mão existe, evento tem de dizer
-- alguma coisa). Sem as duas funções acima, nada mais as produz.
-- ─────────────────────────────────────────────────────────────────────────────
alter table ideworks.task_events
  drop constraint if exists task_events_manual_has_no_rule;
alter table ideworks.task_events
  drop constraint if exists task_events_says_something;

comment on table ideworks.task_events is
  'O registro do que a automacao fez numa tarefa: o que mudou, por qual regra e '
  'quando. Guarda IDS, e o nome sai do perfil e da lista na hora de ler — copia '
  'nao se atualiza. So move_task escreve aqui, e nada apaga nem reescreve: nao '
  'ha politica de update nem de delete, de proposito.';
comment on column ideworks.task_events.automation_name is
  'Retrato do nome da regra no instante em que ela rodou. E copia de proposito: '
  'a regra pode sumir, e o livro nao se reescreve.';

-- ⚠️ AS COLUNAS NÃO CAEM, E `not null` NÃO VOLTA SOZINHO. Ver o cabeçalho:
-- derrubá-las apagaria fato, e o `set not null` falha — corretamente — se já
-- houver evento à mão gravado. Descomente só com a decisão tomada sobre essas
-- linhas.
--
-- alter table ideworks.task_events alter column automation_name set not null;
-- alter table ideworks.task_events drop column added_user_ids;
-- alter table ideworks.task_events drop column from_list_name;
-- alter table ideworks.task_events drop column to_list_name;
-- alter table ideworks.task_events drop column from_status_name;
-- alter table ideworks.task_events drop column to_status_name;
