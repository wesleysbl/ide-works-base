-- Desfaz a F44_6: `complete_task` e `uncomplete_task` voltam à F17.23, sem
-- mudança — o corpo como está no banco antes da F44_6 (o retrato
-- `schema-esperado.json` registra os dois), mesma assinatura, `security
-- definer`, `search_path` e permissões.
--
-- ⚠️ VOLTA A DÍVIDA DA F17.65: concluir e reabrir pela ficha, pela página do
-- cliente ou pela IA trocam a etapa SEM evento no histórico e SEM rodar a
-- automação da etapa; só o arrasto do cartão registra e dispara.
--
-- Não há dado a desfazer: eventos já gravados ficam (o livro não se reescreve),
-- e a tarefa que a automação moveu fica onde a regra a pôs. O Worker não
-- precisa voltar junto.
--
-- Depois: node scripts/conferir-schema.mjs --gravar.

begin;
set local lock_timeout = '5s';

create or replace function ideworks.complete_task(p_task_id uuid, p_by uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks t
     set status_id    = case
                          when t.list_id is null then t.status_id
                          else coalesce(
                                 ideworks.closing_status(
                                   ideworks.resolve_status_set(t.list_id)),
                                 t.status_id)
                        end,
         completed_at = coalesce(t.completed_at, now()),
         completed_by = coalesce(t.completed_by, p_by),
         updated_at   = now()
   where t.id = p_task_id
     and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute');

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.uncomplete_task(p_task_id uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  -- Desmarcar num quadro devolve a tarefa ao comeco da esteira. Deixa-la no
  -- status que fecha com `completed_at` nulo criaria a tarefa "concluida na
  -- coluna, nao concluida na ficha" — a contradicao que este desenho evita.
  update ideworks.tasks t
     set status_id    = case
                          when t.list_id is null then t.status_id
                          else coalesce(
                                 ideworks.first_open_status(
                                   ideworks.resolve_status_set(t.list_id)),
                                 t.status_id)
                        end,
         completed_at = null,
         completed_by = null,
         updated_at   = now()
   where t.id = p_task_id
     and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute');

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

comment on function ideworks.complete_task(uuid, uuid) is null;
comment on function ideworks.uncomplete_task(uuid) is null;

grant execute on function ideworks.complete_task(uuid, uuid) to ideworks_app;
grant execute on function ideworks.uncomplete_task(uuid)     to ideworks_app;

commit;
