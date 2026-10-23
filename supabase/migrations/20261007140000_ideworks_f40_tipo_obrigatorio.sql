-- F40, Fase 1 (parte 2 de 2) — o tipo da tarefa passa a ser OBRIGATÓRIO em lista de produção.
--
-- ⚠️ SÓ APLICAR JUNTO COM A PUBLICAÇÃO DO WORKER QUE MANDA O TIPO (Fases 2–4).
--    O Worker no ar não manda tipo: com este gatilho no banco antes do código
--    novo, toda criação de tarefa nas listas de produção quebra.
--    Requer a parte 1 (`20261007130000_ideworks_f40_tipo_da_tarefa.sql`).
--
-- O QUE MUDA: gatilho `tasks_demand_type_guard`, em INSERT e em
-- UPDATE OF list_id, demand_type:
--   · INSERT de tarefa raiz sem tipo em lista de produção: recusa;
--   · UPDATE que apaga um tipo já escolhido, ficando em lista de produção: recusa;
--   · UPDATE que move a tarefa de fora da produção para uma lista de produção
--     sem tipo: recusa (nenhuma porta escapa — D6).
-- Card antigo sem tipo continua editável em outros campos. Subtarefa
-- (`parent_id`) e tarefa sem lista passam reto, como na F38.
-- SQLSTATE `IW040`, `hint = 'type_required'` (a Fase 2 traduz em `type_required`).
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261007140000_ideworks_f40_tipo_obrigatorio.sql`.

create or replace function ideworks.task_demand_type_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_recusa boolean := false;
begin
  -- Subtarefa e tarefa sem lista: sem tipo exigido.
  if new.parent_id is not null or new.list_id is null or new.demand_type is not null then
    return new;
  end if;

  if not ideworks.list_is_production(new.list_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_recusa := true;
  else
    -- Apagou um tipo já escolhido, ou entrou na produção vindo de fora dela.
    v_recusa := old.demand_type is not null
      or old.list_id is null
      or (old.list_id is distinct from new.list_id and not ideworks.list_is_production(old.list_id));
  end if;

  if v_recusa then
    raise exception
      'Esta lista é de produção: toda tarefa dela precisa de um tipo. Escolha Vídeo, Arte, Foto ou Outros.'
      using errcode = 'IW040', hint = 'type_required';
  end if;

  return new;
end;
$fn$;

comment on function ideworks.task_demand_type_guard() is
  'F40, Fase 1: em lista de produção, tarefa nova sem tipo, tipo apagado e tarefa movida de fora para a '
  'produção sem tipo são recusados com SQLSTATE IW040 (hint type_required).';

drop trigger if exists tasks_demand_type_guard on ideworks.tasks;
create trigger tasks_demand_type_guard
  before insert or update of list_id, demand_type on ideworks.tasks
  for each row execute function ideworks.task_demand_type_guard();
