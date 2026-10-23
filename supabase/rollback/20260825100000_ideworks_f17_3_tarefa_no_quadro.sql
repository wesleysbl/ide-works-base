-- Desfaz a F17.3. Ordem inversa da aplicação.
--
-- O QUE ELE DEVOLVE
--   O estado exato da F4.8: a tarefa volta a pertencer ao cliente e só a ele,
--   `client_id` volta a ser obrigatório, e as seis políticas voltam a chamar
--   `can_see_client`. As colunas de quadro — lista, status, prioridade, tipo,
--   data de início e identificador de origem — somem, e com elas o dado que
--   estiver dentro.
--
--   ATENÇÃO, E ISTO É O MAIS IMPORTANTE DESTE ARQUIVO: reverter APAGA a lista,
--   o status, a prioridade e o tipo de TODA tarefa que já estiver num quadro.
--   Não há como guardá-los — as colunas deixam de existir. Se a F17.11 já
--   tiver importado o ClickUp, isto joga fora a importação inteira, e só um
--   backup a traz de volta.
--
-- ================================================================= A TRAVA ===
-- `client_id` só volta a NOT NULL se NENHUMA linha estiver sem cliente — e a
-- F17.3 existe justamente para permitir tarefa sem cliente (a lista
-- `ATENDIMENTO`, a `ESTÚDIO`, a `Alma9 (projetos)`, que não são de cliente
-- nenhum).
--
-- Por isso a conferência vem PRIMEIRO, antes de qualquer `drop`. Se ela
-- recusar, nada foi desfeito e o banco continua íntegro. Descobrir o problema
-- no fim, com as colunas já apagadas e o `set not null` falhando, deixaria o
-- schema num estado que não é nem o novo nem o velho.
--
-- SE ELA RECUSAR, HÁ DUAS SAÍDAS, E AS DUAS SÃO DECISÃO DE GENTE:
--
--   a) apontar cada tarefa órfã de cliente para um cliente:
--        update ideworks.tasks set client_id = '<uuid do cliente>'
--         where client_id is null and list_id = '<uuid da lista>';
--
--   b) apagá-las deliberadamente, sabendo que é trabalho da equipe:
--        delete from ideworks.tasks where client_id is null;
--
-- Nada aqui escolhe por ninguém: apagar tarefa por conta própria para fazer uma
-- reversão passar é exatamente o tipo de dano silencioso que este projeto
-- existe para não repetir.
do $$
declare v_sem_cliente integer;
begin
  select count(*) into v_sem_cliente from ideworks.tasks where client_id is null;

  if v_sem_cliente > 0 then
    raise exception
      'nao da para devolver `client_id` a NOT NULL: % tarefa(s) nasceram no quadro, sem cliente. Nada foi desfeito. Leia o cabecalho deste arquivo: ou cada uma recebe um cliente, ou e apagada deliberadamente — as duas sao decisao de gente, e nenhuma acontece sozinha aqui.',
      v_sem_cliente;
  end if;
end $$;

-- ============================================================== A ORDEM ======
-- PRIMEIRO O QUE USA, DEPOIS O QUE É USADO.
--
--   políticas → gatilho → funções da F4.8 → move_task
--   → can_reach_task_id → can_reach_task → can_see_list
--   → first_open_status · closing_status
--   → índices → restrições → colunas → tipo
--
-- POLÍTICA → FUNÇÃO É DEPENDÊNCIA REGISTRADA, E RECUSA ALTO. As seis políticas
-- desta etapa chamam `can_reach_task` ou `can_reach_task_id`; com a função na
-- frente, o `restrict` implícito do `drop function` responde `2BP01` — o mesmo
-- erro que já parou o rollback da F17.1 na linha 1. Restaurar as políticas
-- primeiro é o que solta as funções.
--
-- GATILHO → FUNÇÃO TAMBÉM É REGISTRADA. `tasks_status_guard` executa
-- `task_status_guard()`: enquanto o gatilho existir, a função não cai.
--
-- ENTRE FUNÇÕES A DEPENDÊNCIA NÃO É REGISTRADA — E ISSO É PIOR. Medido pelo
-- verificador da F17.2b em `pg_depend`: ZERO elos função→função no schema
-- `ideworks`, porque corpo escrito como literal (`$fn$ ... $fn$`) não anota
-- nada. Apagar `can_reach_task` antes de restaurar `complete_task` não daria
-- erro nenhum: deixaria as quatro ações da F4.8 vivas chamando uma função que
-- não existe mais, e a quebra apareceria na próxima conclusão de tarefa, longe
-- daqui e sem dizer por quê. Recusa ruidosa se conserta na hora; função órfã se
-- descobre semanas depois.
--
-- AS POLÍTICAS SÃO RESTAURADAS, NÃO APAGADAS. Um `drop policy` sem o `create`
-- correspondente deixaria `tasks` e `task_assignees` com RLS ligada e nenhuma
-- política permissiva: ninguém leria nem escreveria mais nada, e a reversão
-- passaria a depender de alguém lembrar de recriar. Cada `drop` vem colado no
-- seu `create`, com o texto da F4.8.

-- 1. As seis políticas voltam ao texto da F4.8 — e é isso que solta as funções.
drop policy if exists tasks_select on ideworks.tasks;
create policy tasks_select on ideworks.tasks for select
  using (ideworks.can_see_client(client_id));

drop policy if exists tasks_insert on ideworks.tasks;
create policy tasks_insert on ideworks.tasks for insert
  with check (ideworks.can_see_client(client_id));

drop policy if exists tasks_update on ideworks.tasks;
create policy tasks_update on ideworks.tasks for update
  using (ideworks.can_see_client(client_id))
  with check (ideworks.can_see_client(client_id));

drop policy if exists tasks_delete on ideworks.tasks;
create policy tasks_delete on ideworks.tasks for delete
  using (ideworks.can_see_client(client_id));

drop policy if exists task_assignees_select on ideworks.task_assignees;
create policy task_assignees_select on ideworks.task_assignees for select
  using (exists (select 1 from ideworks.tasks t
                  where t.id = task_id and ideworks.can_see_client(t.client_id)));

drop policy if exists task_assignees_write on ideworks.task_assignees;
create policy task_assignees_write on ideworks.task_assignees for all
  using (exists (select 1 from ideworks.tasks t
                  where t.id = task_id and ideworks.can_see_client(t.client_id)))
  with check (exists (select 1 from ideworks.tasks t
                       where t.id = task_id and ideworks.can_see_client(t.client_id)));

-- 2. O gatilho antes da função que ele executa.
drop trigger if exists tasks_status_guard on ideworks.tasks;
drop function if exists ideworks.task_status_guard();

-- 3. As quatro ações voltam ao texto da F4.8, ANTES de as funções de alcance
--    sumirem. Ver a nota sobre função órfã.
create or replace function ideworks.complete_task(p_task_id uuid, p_by uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks
     set completed_at = coalesce(completed_at, now()),
         completed_by = coalesce(completed_by, p_by),
         updated_at   = now()
   where id = p_task_id and ideworks.can_see_client(client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.uncomplete_task(p_task_id uuid)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks
     set completed_at = null, completed_by = null, updated_at = now()
   where id = p_task_id and ideworks.can_see_client(client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_task_archived(p_task_id uuid, p_archived boolean)
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  update ideworks.tasks
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         updated_at  = now()
   where id = p_task_id and ideworks.can_see_client(client_id);

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id and ideworks.can_see_client(t.client_id)
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.task_assignees where task_id = p_task_id;

  insert into ideworks.task_assignees (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;
end;
$fn$;

comment on function ideworks.set_task_assignees(uuid, uuid[]) is
  'Troca a lista inteira. Ignora quem nao tem perfil no IDE Works: atribuir '
  'tarefa a quem nao entra no sistema e atribuir a ninguem.';

-- 4. Nada depende dela: cai agora.
drop function if exists ideworks.move_task(uuid, uuid, uuid);

-- 5. A adaptadora por id antes da regra que ela chama, e as duas antes de
--    `can_see_list`.
drop function if exists ideworks.can_reach_task_id(uuid);
drop function if exists ideworks.can_reach_task(uuid, uuid);
drop function if exists ideworks.can_see_list(uuid);

drop function if exists ideworks.first_open_status(uuid);
drop function if exists ideworks.closing_status(uuid);

-- 6. Os índices, as restrições e as colunas.
drop index if exists ideworks.tasks_status_idx;
drop index if exists ideworks.tasks_list_idx;
drop index if exists ideworks.tasks_source_key;

alter table ideworks.tasks drop constraint if exists tasks_status_needs_list;
alter table ideworks.tasks drop constraint if exists tasks_status_fk;
alter table ideworks.tasks drop constraint if exists tasks_list_fk;

-- `tasks_anchored` cai DEPOIS das colunas de quadro? Não: ela menciona
-- `list_id`, e o `drop column` a levaria junto em cascata silenciosa. Melhor
-- explícito — e ela tem que sair antes do `set not null`, senão sobra uma
-- restrição redundante que ninguém sabe de onde veio.
alter table ideworks.tasks drop constraint if exists tasks_anchored;

comment on column ideworks.tasks.client_id is null;

alter table ideworks.tasks drop column if exists source_id;
alter table ideworks.tasks drop column if exists start_on;
alter table ideworks.tasks drop column if exists custom_item_id;
alter table ideworks.tasks drop column if exists priority;
alter table ideworks.tasks drop column if exists status_id;
alter table ideworks.tasks drop column if exists list_id;

-- 7. E só agora, com a trava do topo já tendo aprovado, o cliente volta a ser
--    obrigatório.
alter table ideworks.tasks alter column client_id set not null;

-- 8. O tipo cai por último dessa corrente: enquanto a coluna `priority`
--    existir, `drop type` é recusado — e essa recusa é uma proteção.
drop type if exists ideworks.task_priority;

-- ============================================== O QUE ESTE ARQUIVO NÃO FAZ ===
-- NÃO APAGA O ESPAÇO `Demandas`, A LISTA `Todas as demandas` NEM A ESTEIRA
-- DELES. Mesma regra da F11d: apaga a ponte, não o dado.
--
-- Depois do `drop column list_id` nada mais aponta para eles, então ficam
-- inertes — e podem ter recebido trabalho de verdade da equipe no meio tempo.
-- Apagar espaço e lista de produção dentro de uma reversão de schema é dano
-- que ninguém pediu.
--
-- Para esvaziá-los, deliberadamente e à mão (a ORDEM importa: a esteira cai em
-- cascata do espaço, e a lista também):
--
--   -- delete from ideworks.lists  where name = 'Todas as demandas'
--   --  and space_id in (select id from ideworks.spaces where name = 'Demandas');
--   -- delete from ideworks.spaces where name = 'Demandas' and source_id is null;
--
-- `source_id is null` é o que separa estes espaços dos que a F17.11 importar do
-- ClickUp — aqueles têm id de origem, e não são desta etapa.
--
-- ESTE ARQUIVO PODE DEIXAR DE RODAR SOZINHO — E ISSO É CORRETO
--   Quando a F17.4 (etiquetas e tipos), a F17.5 (campos) e a F17.6 (anexos,
--   links, comentários) pendurarem tabelas na tarefa, elas vão referenciar
--   `tasks` e, no caso da F17.6, chamar `can_reach_task_id` nas políticas
--   delas — porque anexo e comentário herdam o alcance da tarefa, e não têm
--   política própria. A partir daí a reversão delas tem que vir antes desta, e
--   o `restrict` implícito recusa com `2BP01` dizendo exatamente quem depende.
--   A recusa é a proteção, não o estorvo.
