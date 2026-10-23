-- F42, Fase 1 (parte 4 de 4) — ENVIAR e DECIDIR a rodada, atômicos, no banco.
--
-- O QUE MUDA
--   1. `ideworks.move_task` — UMA linha: o evento "à mão" passa a levar o nome
--      que estiver em `app.automation_name` (vazio = nulo = à mão, como antes).
--      O corpo é o da F17.80 (`20260909174220_ideworks_f17_80_preservar_etapa_ao_mover.sql`)
--      sem outra diferença. Por que assim, e não reescrever o evento depois: o
--      livro não se reescreve (F17.65, nota 7) — o evento nasce certo.
--   2. `ideworks.create_approval_round(task_id, items jsonb)` — o ENVIO, no banco
--      e não no Worker (decisão desta fase): numa transação só, confere alcance da
--      pessoa ao card e ao cliente, cliente ligado, os três destinos da esteira;
--      marca a aberta anterior como "substituída"; grava a rodada com versão
--      max+1 e a legenda copiada da descrição; grava os itens na ordem do array;
--      e move o card para "aguardando cliente" por `move_task` (evento à mão,
--      com quem enviou de autor). O Worker (fase 4) só consulta o Dropbox antes
--      e passa os itens já conferidos.
--      Formato de cada item: {dropbox_url, dropbox_path?, kind: video|image|other,
--      file_name, dropbox_file_id, dropbox_rev}.
--   3. `ideworks.decide_approval_round(token_hash, round_id, decision, comment)` —
--      a DECISÃO do cliente: o hash do token é a credencial (o cliente não tem
--      conta). Trava a linha da rodada, exige rodada aberta (a segunda decisão é
--      recusada), exige comentário para reprovar, grava o comentário do cliente
--      no card e a decisão, e move o card pelo `move_task` para o destino da
--      esteira ATUAL do card, a partir de onde ele estiver. O evento sai com
--      `automation_name` = "Aprovação do cliente" e `actor_id` nulo. Sem destino
--      configurado (ou etapa apagada): grava a decisão e não move.
--
-- RECUSAS: SQLSTATE `IW042` com `hint` — link_invalid, round_not_found,
-- round_not_open, comment_required, approval_disabled, approval_not_configured,
-- task_without_client, no_items. Alcance: `42501`, como no resto do quadro.
--
-- FICA PARA A FASE 5: comentário do cliente num item sem decidir, e travar a
-- rodada por material alterado (`locked_changed`) — o estado já existe.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s — redefinir `move_task`
-- disputa com o quadro em uso; melhor falhar e repetir do que enfileirar.
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261007150300_ideworks_f42_4_enviar_e_decidir.sql`
-- (devolve o `move_task` da F17.80).

begin;
set local lock_timeout = '5s';

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
      -- F42: `app.automation_name` vazio (o normal) = à mão, como sempre. Só
      -- `decide_approval_round` o preenche, e o evento nasce com o nome
      -- "Aprovação do cliente" como sujeito, sem regra (`automation_id` nulo —
      -- a restrição `task_events_manual_has_no_rule` aceita nome sem id).
      p_task_id, null, nullif(current_setting('app.automation_name', true), ''),
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
  'Devolve o que fez, inclusive o que a automacao fez. F42: o evento da mao '
  'leva o nome em app.automation_name quando quem move e um processo do sistema '
  '("Aprovação do cliente"), e nulo no resto.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ENVIAR — create_approval_round
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function ideworks.create_approval_round(p_task_id uuid, p_items jsonb)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_user       uuid := ideworks.acting_user_id();
  v_task       ideworks.tasks%rowtype;
  v_set        uuid;
  v_awaiting   uuid;
  v_approved   uuid;
  v_rejected   uuid;
  v_version    integer;
  v_round      uuid;
  v_superseded integer;
  v_move       jsonb;
begin
  if v_user is null then
    raise exception 'ninguem declarado: enviar para aprovacao exige uma pessoa da equipe'
      using errcode = '42501';
  end if;

  -- A trava da linha do card serializa dois envios simultâneos: a versão é
  -- `max + 1` e a aberta anterior vira substituída sem corrida.
  select * into v_task from ideworks.tasks t where t.id = p_task_id for update;

  if not found or not ideworks.can_act_on_task_id(p_task_id, 'execute'::ideworks.access_level) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  if v_task.client_id is null then
    raise exception 'Este card nao tem cliente: a aprovacao externa e por cliente.'
      using errcode = 'IW042', hint = 'task_without_client';
  end if;

  if not ideworks.can_see_client(v_task.client_id) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  if not exists (select 1 from ideworks.clients c
                  where c.id = v_task.client_id and c.approval_enabled and c.is_active) then
    raise exception 'A aprovacao externa nao esta ligada para este cliente.'
      using errcode = 'IW042', hint = 'approval_disabled';
  end if;

  if v_task.list_id is not null then
    v_set := ideworks.resolve_status_set(v_task.list_id);
    select a.awaiting_status_id, a.approved_status_id, a.rejected_status_id
      into v_awaiting, v_approved, v_rejected
      from ideworks.approval_targets_for(v_set) a;
  end if;

  if v_awaiting is null or v_approved is null or v_rejected is null then
    raise exception 'A esteira deste card ainda nao tem as tres etapas da aprovacao do cliente (aguardando, aprovado, reprovado). Configure a esteira antes de enviar.'
      using errcode = 'IW042', hint = 'approval_not_configured';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha ao menos um material do Dropbox para enviar.'
      using errcode = 'IW042', hint = 'no_items';
  end if;

  -- Nova rodada com outra aberta: a antiga vira substituída e sai das abertas.
  update ideworks.approval_rounds r
     set state = 'superseded', closed_at = now()
   where r.task_id = p_task_id and r.state = 'open';
  get diagnostics v_superseded = row_count;

  select coalesce(max(r.version), 0) + 1 into v_version
    from ideworks.approval_rounds r where r.task_id = p_task_id;

  insert into ideworks.approval_rounds (task_id, client_id, version, caption, sent_by)
  values (p_task_id, v_task.client_id, v_version, v_task.description, v_user)
  returning id into v_round;

  insert into ideworks.approval_round_items
    (round_id, position, dropbox_url, dropbox_path, kind, file_name, dropbox_file_id, dropbox_rev)
  select v_round, e.pos::integer,
         e.item->>'dropbox_url', nullif(e.item->>'dropbox_path', ''),
         (e.item->>'kind')::ideworks.approval_item_kind,
         e.item->>'file_name', e.item->>'dropbox_file_id', e.item->>'dropbox_rev'
    from jsonb_array_elements(p_items) with ordinality as e(item, pos);

  -- O card vai para "aguardando cliente" pela porta única (`move_task`). Quem
  -- empurrou foi a pessoa que enviou: o evento sai À MÃO, com ela de autora.
  -- `move_task` confere de novo o alcance dela à lista.
  v_move := ideworks.move_task(p_task_id, v_task.list_id, v_awaiting);

  return jsonb_build_object(
    'round_id',   v_round,
    'version',    v_version,
    'superseded', v_superseded,
    'task_move',  v_move);
end;
$fn$;

comment on function ideworks.create_approval_round(uuid, jsonb) is
  'F42: envia o card para aprovação do cliente — confere alcance, cliente ligado e '
  'destinos da esteira; marca a aberta anterior como substituída; grava a rodada '
  '(versão max+1, legenda copiada da descrição) com os itens na ordem do array; e '
  'move o card para "aguardando cliente" por move_task. Tudo ou nada.';

-- ═══════════════════════════════════════════════════════════════════════════
-- DECIDIR — decide_approval_round
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function ideworks.decide_approval_round(
  p_token_hash text,
  p_round_id   uuid,
  p_decision   text,
  p_comment    text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_client   uuid;
  v_round    ideworks.approval_rounds%rowtype;
  v_state    ideworks.approval_round_state;
  v_comment  uuid;
  v_list     uuid;
  v_target   uuid;
  v_move     jsonb;
  v_now      timestamptz := now();
  -- O que estava declarado na sessão, para devolver depois do movimento.
  v_guc_names text[] := array['app.user_id', 'app.is_superadmin', 'app.is_super',
                              'app.grant_id', 'app.integration_id',
                              'app.integration_owner_id', 'app.execution_origin',
                              'app.automation_name'];
  v_guc_saved text[] := '{}'::text[];
  i integer;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'decisao invalida: use approve ou reject' using errcode = '22023';
  end if;

  -- O TOKEN É A CREDENCIAL. Link revogado, cliente desligado ou inativo e token
  -- inexistente caem aqui, com a mesma resposta.
  v_client := ideworks.resolve_approval_link(p_token_hash);
  if v_client is null then
    raise exception 'link de aprovacao invalido' using errcode = 'IW042', hint = 'link_invalid';
  end if;

  -- A trava da linha é o que faz a SEGUNDA decisão (outra aba, clique duplo)
  -- esperar a primeira e encontrar a rodada já decidida.
  select * into v_round
    from ideworks.approval_rounds r
   where r.id = p_round_id and r.client_id = v_client
   for update;

  if not found then
    raise exception 'chamada de aprovacao nao encontrada' using errcode = 'IW042', hint = 'round_not_found';
  end if;

  if v_round.state <> 'open' then
    raise exception 'Esta chamada ja foi respondida ou nao esta mais aberta.'
      using errcode = 'IW042', hint = 'round_not_open',
            detail = jsonb_build_object('state', v_round.state,
                                        'decided_at', v_round.decided_at,
                                        'closed_at', v_round.closed_at)::text;
  end if;

  if p_decision = 'reject' and btrim(coalesce(p_comment, '')) = '' then
    raise exception 'Para pedir ajustes, escreva o que precisa mudar.'
      using errcode = 'IW042', hint = 'comment_required';
  end if;

  -- O comentário do cliente entra NO CARD, marcado e sem autor.
  if btrim(coalesce(p_comment, '')) <> '' then
    insert into ideworks.task_comments (task_id, body, author_id, from_client, approval_round_id)
    values (v_round.task_id, btrim(p_comment), null, true, v_round.id)
    returning id into v_comment;
  end if;

  v_state := case p_decision when 'approve' then 'approved' else 'rejected' end;

  update ideworks.approval_rounds r
     set state = v_state, decided_at = v_now, decided_via = 'client_link',
         decision_comment_id = v_comment
   where r.id = v_round.id;

  -- O DESTINO É O DA ESTEIRA ATUAL DO CARD, a partir de onde ele estiver (a
  -- equipe pode tê-lo movido à mão). Sem destino: decisão gravada, card parado.
  select t.list_id into v_list from ideworks.tasks t where t.id = v_round.task_id;

  if v_list is not null then
    select case v_state when 'approved' then a.approved_status_id else a.rejected_status_id end
      into v_target
      from ideworks.approval_targets_for(ideworks.resolve_status_set(v_list)) a;
  end if;

  if v_target is not null then
    -- QUEM MOVE É O SISTEMA, EM NOME DA APROVAÇÃO DO CLIENTE. Não há pessoa:
    -- `app.user_id` vazio deixa `actor_id` nulo no histórico, e o alcance de
    -- sistema (`is_super`) deixa `move_task` passar pela conferência de lista.
    -- `app.automation_name` é o que faz o evento nascer com o nome
    -- "Aprovação do cliente" como sujeito. Tudo volta ao que era logo depois.
    for i in 1 .. array_length(v_guc_names, 1) loop
      v_guc_saved := v_guc_saved || coalesce(current_setting(v_guc_names[i], true), '');
    end loop;

    perform set_config('app.user_id', '', true),
            set_config('app.is_superadmin', 'true', true),
            set_config('app.is_super', 'true', true),
            set_config('app.grant_id', '', true),
            set_config('app.integration_id', '', true),
            set_config('app.integration_owner_id', '', true),
            set_config('app.execution_origin', '', true),
            set_config('app.automation_name', 'Aprovação do cliente', true);

    v_move := ideworks.move_task(v_round.task_id, v_list, v_target);

    for i in 1 .. array_length(v_guc_names, 1) loop
      perform set_config(v_guc_names[i], v_guc_saved[i], true);
    end loop;
  end if;

  return jsonb_build_object(
    'round_id',   v_round.id,
    'task_id',    v_round.task_id,
    'state',      v_state,
    'decided_at', v_now,
    'comment_id', v_comment,
    'moved',      v_move is not null,
    'task_move',  v_move);
end;
$fn$;

comment on function ideworks.decide_approval_round(text, uuid, text, text) is
  'F42: o cliente decide a rodada pelo link (o hash do token é a credencial). Trava a '
  'linha, exige rodada aberta (segunda decisão: IW042 round_not_open), exige comentário '
  'para reprovar (IW042 comment_required), grava o comentário do cliente no card, a '
  'decisão, e move o card pelo move_task para o destino da esteira ATUAL, com o evento '
  'em nome de "Aprovação do cliente". Sem destino configurado: grava e não move.';

revoke all on function ideworks.create_approval_round(uuid, jsonb) from public, anon, authenticated;
revoke all on function ideworks.decide_approval_round(text, uuid, text, text) from public, anon, authenticated;
grant execute on function ideworks.create_approval_round(uuid, jsonb) to ideworks_app;
grant execute on function ideworks.decide_approval_round(text, uuid, text, text) to ideworks_app;

commit;
