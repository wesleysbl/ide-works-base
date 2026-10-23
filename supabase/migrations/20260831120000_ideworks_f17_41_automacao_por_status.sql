-- =============================================================================
-- F17.41 — AUTOMAÇÃO POR STATUS
--
-- O PEDIDO, COM A CAPTURA DO CLICKUP JUNTO
--   *"dentro dos status das listas, é necessário a possibilidade de
--   automações... após determinada etapa troca o responsável e encaminha para
--   outro, de forma que não fique mais responsável para o anterior."*
--
--   O que a captura mostra o robô fazendo, numa mudança de etapa só: tirou o
--   responsável, mudou a lista, e DEIXOU ESCRITO que foi ele, por qual regra.
--
-- ONDE ISSO ENTRA, E É SORTE
--   `ideworks.move_task` já é o único caminho por onde lista e status mudam
--   (regra 9). A automação entra DENTRO dela, na mesma escrita — não como um
--   segundo caminho. Se a automação for recusada, a mudança de etapa inteira é
--   recusada junto: a tarefa nunca fica pela metade.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O ACHADO QUE MUDOU O DESENHO: NÃO EXISTIA REGISTRO DE TAREFA
--
--   Medido: o schema tem `task_assignees`, `task_comments`, `task_watchers`,
--   `task_attachments`, `task_checklists`, `task_links` — e nenhuma tabela de
--   histórico. `admin_audit` é de administração de pessoas, não de tarefa.
--
--   Na captura do usuário o valor ESTÁ no registro: ele sabe que foi o robô,
--   qual regra, o que ela tirou, para onde mandou. Sem isso a tarefa muda de
--   lista sozinha, some da tela de quem era responsável, e ninguém consegue
--   explicar por quê. Automação sem rastro não é automação — é a tarefa
--   sumindo.
--
--   Daí `task_events`. Ela guarda IDS, e não nomes copiados: o nome sai do
--   perfil e da lista na hora de ler, pela mesma razão de `task_assignees`
--   ("copia nao se atualiza quando a pessoa muda de nome"). A ÚNICA cópia é
--   `automation_name` — retrato do nome da regra no instante em que ela rodou,
--   porque a regra pode ser apagada depois e o livro não se reescreve.
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A RECURSÃO, E POR QUE ELA É IMPOSSÍVEL POR CONSTRUÇÃO
--
--   Mover para outra lista muda a etapa (a esteira do destino é outra), o que
--   poderia disparar outra automação, que move de novo. "Ninguém vai configurar
--   assim" não é resposta.
--
--   A SOLUÇÃO É A DA F17.15 — coluna gerada mais chave estrangeira composta,
--   sem gatilho nenhum. Lá, `nest_level` (0/1) e `parent_level` (−1/0) tornaram
--   ciclo de checklist impossível. Aqui o que anda em círculo não é uma linha:
--   é o PAR (lista, etapa) — a tarefa cai num par, e se esse par disparar outra
--   regra ela anda de novo.
--
--   Então o par é que ganha um papel, em `automation_stages`:
--
--     stage 0  o par DE ONDE a regra parte  (chegar nele dispara)
--     stage 1  o par ONDE a regra deixa a tarefa (chegar nele não dispara nada)
--
--   A chave primária é `(list_id, status_id)`. Um par tem UM papel, nunca dois.
--   `task_automations` amarra os dois lados por chave estrangeira composta
--   contra colunas GERADAS de valor fixo — `source_stage` vale sempre 0,
--   `target_stage` vale sempre 1. Logo:
--
--     · o par onde uma automação DEIXA a tarefa nunca pode ser o par que
--       DISPARA outra;
--     · a corrente tem comprimento exatamente um;
--     · duas regras apontando uma para a outra não são graváveis;
--     · e nada disso depende de gatilho, de contador de profundidade nem de
--       marca de "estou dentro de automação".
--
--   E ISSO NÃO PROÍBE ESTEIRA EM VÁRIAS LISTAS. Briefing → Atendimento →
--   Design continua valendo: o que a regra proíbe é a etapa de CHEGADA ser a
--   mesma etapa que dispara. A tarefa chega parada, e alguém a empurra.
--
--   A segunda garantia, de graça: o bloco de automação de `move_task` é reto —
--   sem laço, sem chamada recursiva, sem `loop`. Não existe construção que
--   pudesse repetir.
-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A PAREDE DE ACESSO NÃO SE ATRAVESSA, E NOS DOIS SENTIDOS
--
--   Na hora de GRAVAR a regra: a lista de destino tem que estar ao alcance de
--   quem grava, e a pessoa que vai receber a tarefa tem que alcançar a lista
--   onde a tarefa vai parar.
--
--   Na hora de RODAR: a mesma pergunta, de novo, sobre quem está agindo — a
--   configuração pode ter sido feita por outra pessoa, com outro alcance.
--
--   Para perguntar "FULANO alcança?" — e não "eu alcanço?" — as perguntas de
--   alcance ganham a versão `_for`, exatamente como a F17.23 fez com
--   `reaches_company_for` e `chain_ceiling_for`. As de sempre passam a
--   DELEGAR: a regra continua num lugar só.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — as perguntas de alcance, agora também sobre OUTRA pessoa
-- ─────────────────────────────────────────────────────────────────────────────

-- O corpo que `can_see_client` tinha desde a F17.32, com a pessoa como
-- parâmetro. `p_super` é o TOPO (`acting_is_super`), e não "administra".
create or replace function ideworks.can_see_client_for(
  p_user_id uuid, p_super boolean, target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select coalesce(p_super, false)
      or exists (
           select 1 from ideworks.profiles p
            where p.id = p_user_id and p.has_all_clients_access)
      or exists (
           select 1 from ideworks.user_clients uc
            where uc.client_id = target and uc.user_id = p_user_id)
      or exists (
           select 1
             from ideworks.clients c
             join ideworks.user_categories ucat
               on ucat.category_id = c.category_id
              and ucat.user_id = p_user_id
            where c.id = target)
$fn$;

comment on function ideworks.can_see_client_for(uuid, boolean, uuid) is
  'Quem enxerga qual cliente, com a PESSOA como parametro. E o corpo que '
  '`can_see_client` tinha na F17.32, sem uma virgula de diferenca; a de sempre '
  'passou a delegar para esta.';

-- A de sempre, agora DELEGANDO. Mesma resposta, mesma assinatura, mesmos
-- chamadores — e uma regra só, num lugar só.
create or replace function ideworks.can_see_client(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.can_see_client_for(
           ideworks.acting_user_id(), ideworks.acting_is_super(), target)
$fn$;

comment on function ideworks.can_see_client(uuid) is
  'A UNICA regra de quem enxerga cliente, para quem esta agindo agora. Desde a '
  'F17.41 ela delega a `can_see_client_for`, que e a mesma regra com a pessoa '
  'como parametro — a automacao precisa perguntar por OUTRA pessoa.';

-- O teto do nó, com a pessoa como parâmetro. `p_admin` é "administra"
-- (`acting_is_superadmin`), que é o booleano que a corrente da F17.23 usa.
create or replace function ideworks.node_ceiling_for(
  p_user_id uuid, p_admin boolean,
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when ideworks.owner_space(p_space_id, p_folder_id, p_list_id) is null
             then null
           else ideworks.chain_ceiling_for(
                  p_user_id, p_admin,
                  ideworks.owner_space(p_space_id, p_folder_id, p_list_id),
                  coalesce(p_folder_id,
                           (select l.folder_id from ideworks.lists l
                             where l.id = p_list_id)),
                  p_list_id)
         end
$fn$;

comment on function ideworks.node_ceiling_for(uuid, boolean, uuid, uuid, uuid) is
  'O teto de um no de tres niveis, com a PESSOA como parametro. Corpo da '
  '`node_ceiling` da F17.23; a de sempre passou a delegar.';

create or replace function ideworks.node_ceiling(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_ceiling_for(
           ideworks.acting_user_id(), ideworks.acting_is_superadmin(),
           p_space_id, p_folder_id, p_list_id)
$fn$;

comment on function ideworks.node_ceiling(uuid, uuid, uuid) is
  'O teto de um no de tres niveis, para quem esta agindo agora. Desde a F17.41 '
  'delega a `node_ceiling_for`.';

create or replace function ideworks.node_level_for(
  p_user_id uuid, p_admin boolean,
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when not ideworks.reaches_company_for(
                     p_user_id, p_admin,
                     ideworks.owner_space(p_space_id, p_folder_id, p_list_id))
             then null
           else ideworks.node_ceiling_for(
                  p_user_id, p_admin, p_space_id, p_folder_id, p_list_id)
         end
$fn$;

comment on function ideworks.node_level_for(uuid, boolean, uuid, uuid, uuid) is
  'O nivel efetivo de um no, com a PESSOA como parametro: a EMPRESA primeiro, o '
  'teto da corrente depois.';

create or replace function ideworks.node_level(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_level_for(
           ideworks.acting_user_id(), ideworks.acting_is_superadmin(),
           p_space_id, p_folder_id, p_list_id)
$fn$;

comment on function ideworks.node_level(uuid, uuid, uuid) is
  'O nivel efetivo de um no para quem esta agindo agora. Desde a F17.41 delega '
  'a `node_level_for`. E a funcao que `can_write_owner` consulta, e por isso as '
  'esteiras herdaram a camada de no sem uma segunda regra.';

create or replace function ideworks.can_see_list_for(
  p_user_id uuid, p_admin boolean, target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_level_for(p_user_id, p_admin, null, null, target) is not null
$fn$;

comment on function ideworks.can_see_list_for(uuid, boolean, uuid) is
  'O alcance da lista, com a PESSOA como parametro.';

-- A UNIÃO DA F17.3 INTEIRA — enxerga a LISTA, ou enxerga o CLIENTE —, com o
-- teto da F17.23 por cima, e com a PESSOA como parâmetro.
--
-- POR QUE ELA LÊ OS DOIS BOOLEANOS DO PERFIL, E NÃO OS RECEBE
--   Quem pergunta é a automação, que tem em mãos só o id de quem vai receber a
--   tarefa. Os dois papéis são coisas diferentes — `is_superadmin` é
--   "administra" e `role = 'super_admin'` é o topo — e confundi-los foi
--   exatamente o defeito que a F17.32 corrigiu.
--
-- PESSOA DESATIVADA NÃO ALCANÇA NADA. Ela continua nas tarefas antigas
-- (historico nao se reescreve, F4.8), mas não recebe trabalho novo.
create or replace function ideworks.can_reach_task_for(
  p_user_id uuid, p_list_id uuid, p_client_id uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  with quem as (
    select p.id                                     as pessoa,
           coalesce(p.is_superadmin, false)         as administra,
           p.role = 'super_admin'::ideworks.papel   as topo
      from ideworks.profiles p
     where p.id = p_user_id and p.is_active
  )
  select exists (select 1 from quem)
     and ((p_list_id is not null
           and ideworks.can_see_list_for((select pessoa from quem),
                                         (select administra from quem),
                                         p_list_id))
       or (p_client_id is not null
           and ideworks.can_see_client_for((select pessoa from quem),
                                           (select topo from quem),
                                           p_client_id)))
     and (p_list_id is null
          or ideworks.node_ceiling_for((select pessoa from quem),
                                       (select administra from quem),
                                       null, null, p_list_id) is not null)
$fn$;

comment on function ideworks.can_reach_task_for(uuid, uuid, uuid) is
  'A regra de alcance da tarefa, com a PESSOA como parametro — a pergunta que a '
  'automacao faz antes de passar a tarefa para alguem. Uniao lista OU cliente, '
  'com o teto do no por cima, igual a `can_reach_task`. Pessoa desativada '
  'responde nao.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — o papel de cada par (lista, etapa): o que torna o círculo impossível
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ideworks.automation_stages (
  list_id   uuid not null references ideworks.lists (id)    on delete cascade,
  status_id uuid not null references ideworks.statuses (id) on delete cascade,

  -- 0 = par de onde a regra parte; 1 = par onde a regra deixa a tarefa.
  stage     smallint not null,

  -- ⚠️ ESTA CHAVE É A REGRA INTEIRA. Um par tem UM papel: ou dispara, ou
  -- recebe. Nunca os dois. Ver a nota 2 do cabeçalho.
  primary key (list_id, status_id),

  constraint automation_stages_stage_range check (stage in (0, 1))
);

-- O alvo das duas chaves estrangeiras compostas de `task_automations`. A chave
-- primária sozinha não serve: ela não tem `stage` dentro.
create unique index if not exists automation_stages_stage_key
  on ideworks.automation_stages (list_id, status_id, stage);

comment on table ideworks.automation_stages is
  'O papel de cada par lista+etapa na automacao: 0 dispara, 1 recebe. A chave '
  'primaria de duas colunas e o que torna corrente de automacao impossivel — '
  'um par que recebe nunca pode disparar. Mesmo desenho de nest_level e '
  'parent_level na F17.15: restricao declarativa, sem gatilho nenhum.';
comment on column ideworks.automation_stages.stage is
  'Escrita por quem grava a regra, nunca a mao: 0 e o par de partida, 1 o de '
  'chegada. Linha sem regra que a referencie e lixo, e a gravacao a varre.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 3 — a regra
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ideworks.task_automations (
  id uuid primary key default gen_random_uuid(),

  -- O nome que aparece no registro da tarefa. A regra de nome da F17.4: nada
  -- de `{}` nem de espaço em branco.
  name text not null,

  -- --- quando ---------------------------------------------------------------
  source_list_id    uuid not null references ideworks.lists (id)    on delete cascade,
  trigger_status_id uuid not null references ideworks.statuses (id) on delete cascade,

  -- Valor fixo, e é de propósito: é o lado 0 da chave composta lá embaixo.
  source_stage smallint generated always as (0) stored,

  -- --- então ----------------------------------------------------------------
  -- Nulo nos dois quando a regra só troca o responsável.
  target_list_id   uuid references ideworks.lists (id)    on delete cascade,
  target_status_id uuid references ideworks.statuses (id) on delete cascade,

  -- Nulo quando não há destino: chave estrangeira composta com coluna nula não
  -- é conferida, e é assim que "esta regra não move" fica dizível.
  target_stage smallint generated always as
    (case when target_list_id is null then null else 1 end) stored,

  -- SUBSTITUI, não acrescenta: o pedido é *"de forma que não fique mais
  -- responsável para o anterior"*. Nulo quando a regra só move.
  assignee_id uuid references auth.users (id) on delete cascade,

  is_active  boolean not null default true,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_automations_name_is_a_name
    check (ideworks.is_meaningful_name(name)),

  -- Destino é lista E etapa, ou nenhum dos dois. Meia mudança de lista deixaria
  -- a tarefa numa coluna que o quadro do destino não tem.
  constraint task_automations_destination_is_whole
    check ((target_list_id is null) = (target_status_id is null)),

  -- Regra que não faz nada é ruído na tela e mentira no registro.
  constraint task_automations_does_something
    check (target_list_id is not null or assignee_id is not null),

  -- Mover para a própria lista não é mover.
  constraint task_automations_moves_somewhere_else
    check (target_list_id is distinct from source_list_id),

  -- ⚠️ AS DUAS CHAVES QUE MATAM O CÍRCULO. Ver a nota 2 do cabeçalho.
  constraint task_automations_trigger_fk
    foreign key (source_list_id, trigger_status_id, source_stage)
    references ideworks.automation_stages (list_id, status_id, stage),

  constraint task_automations_destination_fk
    foreign key (target_list_id, target_status_id, target_stage)
    references ideworks.automation_stages (list_id, status_id, stage)
);

-- Uma regra por chegada. Duas regras no mesmo par dariam duas respostas para a
-- mesma pergunta, e a tarefa iria para onde o planejador do banco decidisse.
create unique index if not exists task_automations_arrival_key
  on ideworks.task_automations (source_list_id, trigger_status_id);

create index if not exists task_automations_target_idx
  on ideworks.task_automations (target_list_id) where target_list_id is not null;

comment on table ideworks.task_automations is
  'A regra: quando a tarefa CHEGA nesta etapa desta lista, encaminhe para tal '
  'lista e/ou passe para tal pessoa. Roda dentro de move_task, na mesma escrita.';
comment on column ideworks.task_automations.assignee_id is
  'Quem passa a cuidar. SUBSTITUI a lista inteira de responsaveis — o pedido e '
  '"de forma que nao fique mais responsavel para o anterior".';
comment on column ideworks.task_automations.source_stage is
  'Calculada, valor fixo 0. E o lado de PARTIDA da chave composta contra '
  'automation_stages; sem ela a corrente de automacao seria possivel.';
comment on column ideworks.task_automations.target_stage is
  'Calculada, valor fixo 1 quando ha destino e nulo quando nao ha. E o lado de '
  'CHEGADA da chave composta; nulo desliga a conferencia, que e como "esta '
  'regra nao move" fica dizivel.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 4 — o registro. Ver a nota 1 do cabeçalho.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ideworks.task_events (
  id bigint generated always as identity primary key,

  task_id uuid not null references ideworks.tasks (id) on delete cascade,

  -- `set null`: apagar a regra não apaga o que ela fez.
  automation_id uuid references ideworks.task_automations (id) on delete set null,

  -- A ÚNICA cópia de nome do projeto, e ela é deliberada: é o retrato do nome
  -- da regra no instante em que ela rodou. A regra pode ser apagada ou
  -- renomeada, e o livro não se reescreve.
  automation_name text not null,

  from_list_id   uuid references ideworks.lists (id)    on delete set null,
  to_list_id     uuid references ideworks.lists (id)    on delete set null,
  from_status_id uuid references ideworks.statuses (id) on delete set null,
  to_status_id   uuid references ideworks.statuses (id) on delete set null,

  -- Quem SAIU. Conjunto, porque a tarefa pode ter vários responsáveis e a regra
  -- substitui todos. Sem chave estrangeira, que arranjo não aceita — e este
  -- projeto não apaga conta.
  removed_user_ids uuid[] not null default '{}'::uuid[],

  added_user_id uuid references auth.users (id) on delete set null,

  -- Quem estava agindo quando o robô disparou. Não é quem configurou a regra.
  actor_id uuid references auth.users (id) on delete set null,

  occurred_at timestamptz not null default now()
);

create index if not exists task_events_task_idx
  on ideworks.task_events (task_id, occurred_at desc, id desc);

comment on table ideworks.task_events is
  'O registro do que a automacao fez numa tarefa: o que mudou, por qual regra e '
  'quando. Guarda IDS, e o nome sai do perfil e da lista na hora de ler — copia '
  'nao se atualiza. So move_task escreve aqui, e nada apaga nem reescreve: nao '
  'ha politica de update nem de delete, de proposito.';
comment on column ideworks.task_events.automation_name is
  'Retrato do nome da regra no instante em que ela rodou. E copia de proposito: '
  'a regra pode sumir, e o livro nao se reescreve.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 5 — segurança por linha, na mesma migration
-- ─────────────────────────────────────────────────────────────────────────────

alter table ideworks.automation_stages enable row level security;
alter table ideworks.task_automations  enable row level security;
alter table ideworks.task_events       enable row level security;

-- Quem enxerga a lista enxerga a automação dela. Escrever exige `manage` no nó,
-- que é a mesma autoridade de mexer na esteira (F17.2b/F17.23) — automação de
-- etapa é parte da esteira.
--
-- ⚠️ `for all` INCLUI `select`. As duas políticas convivem porque políticas
-- permissivas se somam: quem só alcança lê pela primeira, quem cuida lê pelas
-- duas. É o desenho de `task_assignees` desde a F17.3.
drop policy if exists task_automations_select on ideworks.task_automations;
create policy task_automations_select on ideworks.task_automations for select
  using (ideworks.can_see_list(source_list_id));

drop policy if exists task_automations_write on ideworks.task_automations;
create policy task_automations_write on ideworks.task_automations for all
  using      (ideworks.can_write_owner(null, null, source_list_id))
  with check (ideworks.can_write_owner(null, null, source_list_id));

-- O papel do par é ALCANCE, e não autoridade — de propósito. Quem cuida da
-- lista A precisa marcar o par de chegada na lista B, onde ele pode ter só
-- `view`. Exigir `manage` nas duas pontas tornaria "encaminhar para o
-- atendimento" configurável apenas por quem manda nas duas listas, que não é o
-- caso de ninguém. A linha sozinha não faz nada: sem regra que a referencie ela
-- é lixo, e a gravação a varre.
drop policy if exists automation_stages_select on ideworks.automation_stages;
create policy automation_stages_select on ideworks.automation_stages for select
  using (ideworks.can_see_list(list_id));

drop policy if exists automation_stages_write on ideworks.automation_stages;
create policy automation_stages_write on ideworks.automation_stages for all
  using      (ideworks.can_see_list(list_id))
  with check (ideworks.can_see_list(list_id));

-- Quem alcança a tarefa lê o registro dela. NÃO HÁ POLÍTICA DE `update` NEM DE
-- `delete`, e a ausência é a regra: com segurança por linha ligada, o que não
-- tem política permissiva é recusado. O livro não se apaga nem se reescreve.
drop policy if exists task_events_select on ideworks.task_events;
create policy task_events_select on ideworks.task_events for select
  using (ideworks.can_reach_task_id(task_id));

drop policy if exists task_events_insert on ideworks.task_events;
create policy task_events_insert on ideworks.task_events for insert
  with check (ideworks.can_reach_task_id(task_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 6 — gravar e apagar a regra
--
-- `security invoker`, como `set_list_workflow`: quem decide o acesso são as
-- políticas acima. As conferências abaixo existem para a RECUSA SER UMA FRASE —
-- política que filtra devolve zero linhas, não explicação.
-- ─────────────────────────────────────────────────────────────────────────────

-- As linhas de papel que nenhuma regra referencia mais. Varridas a cada
-- gravação e a cada remoção: linha órfã não faz nada, mas ocuparia o par e
-- recusaria uma regra legítima depois.
create or replace function ideworks.sweep_automation_stages()
  returns integer
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  delete from ideworks.automation_stages g
   where not exists (
     select 1 from ideworks.task_automations a
      where (a.source_list_id = g.list_id and a.trigger_status_id = g.status_id)
         or (a.target_list_id = g.list_id and a.target_status_id  = g.status_id));
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

comment on function ideworks.sweep_automation_stages() is
  'Varre os pares de papel que nenhuma regra referencia mais. Roda sob a '
  'politica de quem chama, entao so alcanca o que a pessoa ve — o resto fica, e '
  'nao atrapalha ninguem.';

create or replace function ideworks.set_task_automation(
  p_id                uuid,
  p_source_list_id    uuid,
  p_trigger_status_id uuid,
  p_name              text,
  p_target_list_id    uuid    default null,
  p_target_status_id  uuid    default null,
  p_assignee_id       uuid    default null,
  p_is_active         boolean default true,
  p_created_by        uuid    default null)
  returns uuid
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_nome    text := btrim(coalesce(p_name, ''));
  v_set     uuid;
  v_destino uuid;
  v_etapa   uuid := p_target_status_id;
  v_papel   smallint;
  v_id      uuid;
begin
  if not ideworks.can_see_list(p_source_list_id) then
    raise exception
      'a lista nao existe ou esta fora do seu alcance. Nada foi gravado.'
      using errcode = '42501';
  end if;

  if not ideworks.can_write_owner(null, null, p_source_list_id) then
    raise exception
      'so quem cuida desta lista pode criar automacao nela. Nada foi gravado.'
      using errcode = '42501';
  end if;

  if v_nome = '' then
    raise exception 'a automacao precisa de um nome. Nada foi gravado.'
      using errcode = '22023';
  end if;

  -- --- a etapa que dispara tem que ser uma etapa DESTA lista -----------------
  v_set := ideworks.resolve_status_set(p_source_list_id);

  if v_set is null then
    raise exception
      'esta lista ainda nao tem etapas: nem ela, nem a pasta, nem o espaco. Monte a esteira antes de automatizar. Nada foi gravado.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from ideworks.statuses s
     where s.id = p_trigger_status_id and s.status_set_id = v_set
  ) then
    raise exception
      'a etapa escolhida nao e uma das etapas desta lista. Nada foi gravado.'
      using errcode = '23514';
  end if;

  -- --- o destino ------------------------------------------------------------
  if p_target_list_id is not null then
    if p_target_list_id = p_source_list_id then
      raise exception
        'encaminhar para a propria lista nao encaminha nada. Escolha outra lista, ou deixe a automacao so trocando o responsavel. Nada foi gravado.'
        using errcode = '23514';
    end if;

    if not ideworks.can_see_list(p_target_list_id) then
      raise exception
        'a lista para onde a tarefa iria nao existe ou esta fora do seu alcance. Nada foi gravado.'
        using errcode = '42501';
    end if;

    v_destino := ideworks.resolve_status_set(p_target_list_id);

    if v_destino is null then
      raise exception
        'a lista de destino nao tem etapas, entao a tarefa chegaria sem coluna nenhuma. Monte a esteira dela antes. Nada foi gravado.'
        using errcode = '22023';
    end if;

    -- Sem etapa de chegada escolhida, a tarefa chega na primeira que abre — o
    -- mesmo padrao de quem move a mao.
    if v_etapa is null then
      v_etapa := ideworks.first_open_status(v_destino);
    end if;

    if v_etapa is null then
      raise exception
        'a esteira da lista de destino nao tem nenhuma etapa que abra: so ha a que fecha. A tarefa chegaria ja encerrada. Nada foi gravado.'
        using errcode = '22023';
    end if;

    if not exists (
      select 1 from ideworks.statuses s
       where s.id = v_etapa and s.status_set_id = v_destino
    ) then
      raise exception
        'a etapa de chegada nao e uma das etapas da lista de destino. Nada foi gravado.'
        using errcode = '23514';
    end if;
  end if;

  -- --- quem passa a cuidar --------------------------------------------------
  if p_assignee_id is not null then
    if not ideworks.can_reach_task_for(
             p_assignee_id, coalesce(p_target_list_id, p_source_list_id), null) then
      raise exception
        'essa pessoa nao alcanca a lista onde a tarefa vai parar — a tarefa sumiria da tela dela no instante em que chegasse. Nada foi gravado.'
        using errcode = '42501';
    end if;
  end if;

  -- --- o papel de cada par, que e o que impede o circulo --------------------
  select g.stage into v_papel
    from ideworks.automation_stages g
   where g.list_id = p_source_list_id and g.status_id = p_trigger_status_id;

  if v_papel = 1 then
    raise exception
      'esta etapa e onde OUTRA automacao larga a tarefa. Uma etapa que recebe nao pode tambem encaminhar: as duas ficariam se chamando em circulo, e a tarefa andaria sozinha sem parar. Escolha outra etapa. Nada foi gravado.'
      using errcode = '23514';
  end if;

  if p_target_list_id is not null then
    select g.stage into v_papel
      from ideworks.automation_stages g
     where g.list_id = p_target_list_id and g.status_id = v_etapa;

    if v_papel = 0 then
      raise exception
        'a etapa de chegada ja e o gatilho de outra automacao. Chegar nela faria a tarefa seguir viagem sozinha, e depois voltar. Escolha outra etapa de chegada. Nada foi gravado.'
        using errcode = '23514';
    end if;
  end if;

  insert into ideworks.automation_stages (list_id, status_id, stage)
  values (p_source_list_id, p_trigger_status_id, 0)
  on conflict (list_id, status_id) do nothing;

  if p_target_list_id is not null then
    insert into ideworks.automation_stages (list_id, status_id, stage)
    values (p_target_list_id, v_etapa, 1)
    on conflict (list_id, status_id) do nothing;
  end if;

  -- --- a regra --------------------------------------------------------------
  if p_id is null then
    insert into ideworks.task_automations
      (name, source_list_id, trigger_status_id,
       target_list_id, target_status_id, assignee_id, is_active, created_by)
    values
      (v_nome, p_source_list_id, p_trigger_status_id,
       p_target_list_id, v_etapa, p_assignee_id, coalesce(p_is_active, true),
       coalesce(p_created_by, ideworks.acting_user_id()))
    returning id into v_id;
  else
    update ideworks.task_automations a
       set name              = v_nome,
           source_list_id    = p_source_list_id,
           trigger_status_id = p_trigger_status_id,
           target_list_id    = p_target_list_id,
           target_status_id  = v_etapa,
           assignee_id       = p_assignee_id,
           is_active         = coalesce(p_is_active, true),
           updated_at        = now()
     where a.id = p_id
    returning a.id into v_id;

    if v_id is null then
      raise exception
        'essa automacao nao existe mais, ou esta fora do seu alcance. Nada foi gravado.'
        using errcode = '42501';
    end if;
  end if;

  perform ideworks.sweep_automation_stages();
  return v_id;
end;
$fn$;

comment on function ideworks.set_task_automation(uuid, uuid, uuid, text, uuid, uuid, uuid, boolean, uuid) is
  'Grava a regra de automacao de uma etapa. Confere alcance nas duas pontas, '
  'que a etapa pertence a esteira resolvida de cada lista, e que quem vai '
  'receber a tarefa alcanca a lista onde ela vai parar. As duas recusas de '
  'circulo saem daqui com frase; a garantia mesmo e a chave primaria de '
  'automation_stages.';

create or replace function ideworks.delete_task_automation(p_id uuid)
  returns boolean
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare v_id uuid;
begin
  delete from ideworks.task_automations a where a.id = p_id returning a.id into v_id;

  if v_id is null then
    raise exception
      'essa automacao nao existe mais, ou esta fora do seu alcance. Nada foi mudado.'
      using errcode = '42501';
  end if;

  perform ideworks.sweep_automation_stages();
  return true;
end;
$fn$;

comment on function ideworks.delete_task_automation(uuid) is
  'Apaga a regra e varre os pares de papel que sobraram. O registro do que ela '
  'ja fez NAO e apagado — task_events guarda o nome dela.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE 7 — `move_task`, com a automação DENTRO
--
-- O texto é o da F17.15 palavra por palavra, com um bloco novo no fim. Nada do
-- que já existia mudou de comportamento: sem regra configurada, esta função faz
-- exatamente o que fazia — medido antes e depois.
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

  -- O gatilho pode ter trocado o status (nao trocou, neste caminho) e carimbado
  -- a conclusao. Le-se de volta o que FICOU, e nao o que se pretendia.
  select t.status_id into v_novo from ideworks.tasks t where t.id = p_task_id;

  v_lista_fim  := p_list_id;
  v_status_fim := v_novo;

  -- ═══ A AUTOMAÇÃO — F17.41 ════════════════════════════════════════════════
  -- CHEGAR é o par (lista, etapa) ter mudado. Regravar a mesma etapa na mesma
  -- lista não é chegada, e não dispara nada.
  --
  -- ⚠️ ESTE BLOCO É RETO: sem laço, sem recursão, sem chamada de volta a
  -- `move_task`. A regra encontrada roda UMA vez. E ela não poderia encontrar
  -- outra depois nem se alguém tentasse: o par de chegada tem papel 1 em
  -- `automation_stages`, e papel 1 nunca é gatilho — a chave primária de duas
  -- colunas daquela tabela é o que garante isso, sem gatilho nenhum. Ver a nota
  -- 2 do cabeçalho da migration.
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

  -- "E a mudanca fica registrada": a operacao DEVOLVE o que fez, para quem
  -- chama registrar e para a tela poder dizer o que aconteceu sozinho.
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

-- --- permissões ---------------------------------------------------------------
grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.can_see_client_for(uuid, boolean, uuid)           to ideworks_app;
grant execute on function ideworks.can_see_client(uuid)                              to ideworks_app;
grant execute on function ideworks.node_ceiling_for(uuid, boolean, uuid, uuid, uuid) to ideworks_app;
grant execute on function ideworks.node_ceiling(uuid, uuid, uuid)                    to ideworks_app;
grant execute on function ideworks.node_level_for(uuid, boolean, uuid, uuid, uuid)   to ideworks_app;
grant execute on function ideworks.node_level(uuid, uuid, uuid)                      to ideworks_app;
grant execute on function ideworks.can_see_list_for(uuid, boolean, uuid)             to ideworks_app;
grant execute on function ideworks.can_reach_task_for(uuid, uuid, uuid)              to ideworks_app;
grant execute on function ideworks.sweep_automation_stages()                         to ideworks_app;
grant execute on function ideworks.delete_task_automation(uuid)                      to ideworks_app;
grant execute on function ideworks.move_task(uuid, uuid, uuid)                       to ideworks_app;
grant execute on function ideworks.set_task_automation(uuid, uuid, uuid, text, uuid, uuid, uuid, boolean, uuid) to ideworks_app;
