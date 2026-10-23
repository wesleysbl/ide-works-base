-- F40, Fase 1 — a tarefa ganha um TIPO (vídeo, arte, foto, outros) e o banco
-- sabe dizer se uma lista é de PRODUÇÃO.
--
-- O QUE MUDA
--   1. Enum `ideworks.task_demand_type` (`video`, `arte`, `foto`, `outros`).
--      O nome fala "demand" de propósito: já existem `task_types` (os tipos
--      personalizados do ClickUp, por espaço) e `tasks.custom_item_id`, e
--      "type" solto confundiria os dois.
--   2. `tasks.demand_type`, anulável: o card antigo continua sem tipo
--      ("Sem tipo" na tela) e nenhuma linha existente é tocada.
--   3. `ideworks.list_is_production(list_id)`: verdadeiro quando a esteira
--      EFETIVA da lista tem uma etapa chamada "atribuir demanda", comparada sem
--      acento e sem maiúscula. A esteira efetiva é a MESMA do resto do sistema:
--      `ideworks.resolve_status_set` (lista -> pasta -> espaço), da F17.2/F36.
--      Não há extensão `unaccent` no projeto; o acento sai por `translate()`,
--      determinístico e sem dependência de locale.
--   O gatilho que torna o tipo obrigatório fica na parte 2
--   (`20261007140000_ideworks_f40_tipo_obrigatorio.sql`), que só entra junto com
--   a publicação do Worker que manda o tipo. Esta parte 1 é inofensiva: nenhuma
--   escrita é recusada, e pode ir ao banco já.
--
-- IDEMPOTENTE: pode ser aplicada duas vezes.
--
-- REVERSÃO: `supabase/rollback/20261007130000_ideworks_f40_tipo_da_tarefa.sql`
-- (desfaça antes a parte 2, se ela já foi aplicada).

do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'ideworks' and t.typname = 'task_demand_type'
  ) then
    create type ideworks.task_demand_type as enum ('video', 'arte', 'foto', 'outros');
  end if;
end
$$;

alter table ideworks.tasks
  add column if not exists demand_type ideworks.task_demand_type;

comment on column ideworks.tasks.demand_type is
  'F40: tipo da demanda (video, arte, foto, outros). Obrigatório em tarefa nova de lista de produção; '
  'vazio nos cards antigos.';

create or replace function ideworks.list_is_production(p_list_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- `security definer`: a resposta é um fato da árvore, não do que quem pergunta
  -- enxerga (mesmo motivo do `task_status_guard`). Devolve só um booleano.
  select exists (
    select 1
      from ideworks.statuses s
     where s.status_set_id = ideworks.resolve_status_set(p_list_id)
       and lower(translate(btrim(s.name),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
             'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
           = 'atribuir demanda'
  );
$fn$;

comment on function ideworks.list_is_production(uuid) is
  'F40: a lista é de produção quando a esteira efetiva dela (lista -> pasta -> espaço) tem a etapa '
  '"atribuir demanda", sem acento e sem maiúscula.';
