-- =============================================================================
-- IDE WORKS — F44, Fase 5  A segunda tranca das conexões de IA, no banco
-- =============================================================================
-- O PEDIDO
--   Quando quem age é uma conexão de IA (MCP), o banco também recusa o que está
--   fora das empresas e dos clientes que a pessoa escolheu ao conectar. Até
--   aqui só o CÓDIGO recortava (`companySql`, `clientSql`, `boardClientSql` em
--   `src/integrations/sql-work.ts`, `grantReachesTask` em `writes.ts`): as
--   políticas de linha viam só a PESSOA, e um esquecimento no código entregaria
--   ao agente tudo o que o dono enxerga na tela.
--
-- A REGRA, A MESMA DA F16a
--   Acesso efetivo = acesso atual da pessoa ∩ concessão. A metade "pessoa" são
--   as políticas que já existem, intactas. Esta migration acrescenta a metade
--   "concessão": empresa da linha em `integration_allows_company` (a allowlist
--   de empresas ∩ o alcance atual do dono) e cliente da linha na allowlist de
--   clientes. Sem conexão declarada (`app.grant_id` vazio — a tela, o coletor,
--   o pré-login), a tranca responde `true` sem perguntar mais nada.
--
-- POR QUE UMA POLÍTICA RESTRITIVA POR TABELA, E NÃO O `and (...)` EM CADA UMA
--   O Postgres soma com AND toda política `as restrictive` a TODAS as
--   permissivas da tabela, em todo comando. É exatamente o "acrescentar
--   `and (sem conexão or está na conexão)`" do plano, com três ganhos:
--     · as políticas de hoje ficam byte a byte como estão — a tela não muda
--       porque o texto dela não muda, e o rollback é só apagar o que entrou;
--     · `for all` permissivo (lists_write, folders_write, spaces_write,
--       mural_notes_write, history_documents_write…) REABRIRIA a leitura se
--       só a política de select ganhasse o recorte — a lição da F17.32b. A
--       restritiva vale para select, insert, update e delete de uma vez;
--     · uma política permissiva NOVA, criada amanhã, já nasce debaixo da
--       tranca, sem ninguém lembrar dela.
--   ⚠️ O PREÇO: recriar uma destas SEM `as restrictive` a transforma em porta
--   aberta (vira um `or true` para quem não é agente). Por isso o retrato do
--   schema passa a listar as restritivas à parte (`politicas_restritivas` em
--   `scripts/conferir-schema.mjs`) e a prova de banco confere o tipo.
--
-- A EMPRESA E O CLIENTE DE CADA LINHA
--   · espaço: `category_id`.  pasta e lista: a empresa do espaço.
--     A lista NÃO confere o próprio cliente — ver "TAREFA MOVIDA" abaixo.
--   · tarefa: a empresa é a do espaço da lista; o cliente é o da tarefa e, na
--     falta dele, o da lista (a regra única da F38). Tarefa SEM LISTA (demanda
--     antiga do cliente): a empresa é a do cliente.
--   · comentário, histórico da tarefa, responsável, observador, etiqueta,
--     checklist, link, anexo, rodada de aprovação: a TAREFA dela tem de estar
--     na conexão (a política de `tasks` decide, uma regra só). Item de
--     checklist e item de rodada: pelo checklist e pela rodada.
--   · cliente, mural, histórico do cliente, peças (`content_items`), contratos
--     do mês, cota, etiquetas do cliente, compromissos: o cliente. Documento
--     do histórico e item do contrato: pela linha-mãe.
--
-- TAREFA MOVIDA — POR QUE A LISTA SÓ CONFERE A EMPRESA
--   Mover tarefa não troca o cliente dela (F38: "UPDATE: mover tarefa entre
--   listas não mexe no cliente"). Então existe tarefa do cliente X numa lista
--   do cliente Z. O MCP a lê (o cliente dela, X, está na conexão) juntando
--   `ideworks.tree`, que é `security_invoker`: se a lista de Z sumisse por
--   causa do cliente dela, a tarefa sumiria junto. O recorte do cliente da
--   lista continua no código (`boardClientSql`); o banco tranca a empresa.
--
-- NADA QUE A IA LIA DENTRO DA CONCESSÃO SOME
--   A tranca é um pouco MAIS LARGA que o código em dois pontos, de propósito:
--     · não repete `can_see_client` (está na metade "pessoa" de cada política
--       de cliente; na tarefa, a pessoa a alcança pela lista ou pelo cliente);
--     · tarefa sem lista entra pelo cliente (o código nem a lê).
--   E é igual ao código no resto. O teste de banco
--   (`src/integrations/tranca-da-conexao-banco.test.ts`) compara a regra de
--   leitura do MCP, calculada com as funções da F16a, com o que passa aqui.
--
-- DESEMPENHO — A TELA NÃO PAGA NADA, O AGENTE PAGA POR COMANDO
--   Cada política é `(select no_integration_declared()) is not null or
--   <linha ∈ conjunto>` — essa forma, e não `acting_grant_id() is null`, por
--   causa da estimativa do planejador (ver a função). O `(select …)` vira
--   InitPlan: avaliado uma vez por comando, e os conjuntos (`integration_*_ids()`,
--   arrays de uuid) só são calculados se alguém chegar a perguntar — na tela,
--   o EXPLAIN mostra "never executed". Para o agente,
--   cada conjunto sai uma vez por comando (o quadro tem ~100 listas e ~100
--   clientes), e a linha paga um `= any(array)`. As satélites da tarefa pagam
--   uma busca da tarefa pela chave, como `can_reach_task_id` já paga.
--   `integration_company_ids()` guarda a resposta por COMANDO, no molde da
--   F17.61: os outros conjuntos partem dela, e um comando grande os pede várias
--   vezes (uma por tabela citada).
--
-- O QUE ESTA MIGRATION NÃO COBRE (registrado de propósito)
--   · Funções `security definer` que escrevem por conta própria ignoram toda
--     política de linha, esta inclusive: complete_task, uncomplete_task,
--     set_task_archived, set_task_assignees, set_task_tags, set_task_watchers,
--     set_checklist_item_resolved. Nelas o recorte da conexão continua só no
--     código. Fechar isso é mexer no corpo de cada uma.
--   · Catálogos sem cliente (statuses, status_sets, task_tags, task_types,
--     client_tags, plans, client_categories), gente (profiles,
--     user_categories, user_clients) e o que a IA não lê (video_captures,
--     client_links, client_approval_links, chat).
--   · meta_* (marketing): o código recorta por `meta_assets`; a Fase 2/3 e a
--     worktree F44d mexem nessas tabelas agora.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s. `create policy` pede
-- trava exclusiva em cada tabela; se esbarrar em uso (timeout ou deadlock),
-- é só rodar de novo — a migration é idempotente.
--
-- REVERSÃO: `supabase/rollback/20261009100000_ideworks_f44_2_tranca_da_conexao.sql`
-- apaga as 25 políticas restritivas e as seis funções. As políticas
-- permissivas não foram tocadas, então voltam a valer sozinhas, como hoje.
-- Depois: node scripts/conferir-schema.mjs --gravar.
-- =============================================================================

begin;
set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A PERGUNTA "HÁ CONEXÃO?" E OS CONJUNTOS DA CONEXÃO
-- ─────────────────────────────────────────────────────────────────────────────
-- Verdadeiro quando NÃO há conexão declarada; NULO quando há. A política
-- pergunta `(select ideworks.no_integration_declared()) is not null`, e não
-- `(select ideworks.acting_grant_id()) is null`, por causa do PLANEJADOR: ele
-- não sabe o valor do InitPlan e estima `is null` de expressão em 0,5% e
-- `is not null` em 99,5%. Com `is null`, a estimativa de linhas da TELA cai
-- ~10× (medido no PGlite: 3.333 → 346 linhas numa tabela de 10.000) e o plano
-- das telas pode virar laço aninhado; com `is not null`, fica onde estava
-- (3.333 → 3.318). Na execução as duas formas são iguais: avaliada uma vez,
-- e o resto da política nem roda.
create or replace function ideworks.no_integration_declared()
  returns boolean
  language sql stable
as $fn$
  select case when ideworks.acting_grant_id() is null then true end
$fn$;

comment on function ideworks.no_integration_declared() is
  'Verdadeiro sem conexão de IA declarada; NULO com ela. Feita para '
  '`(select …) is not null` nas políticas da F44_2: a forma que o planejador '
  'estima como "quase todas as linhas", e a tela não muda de plano.';

-- Os conjuntos abaixo devolvem NULO sem conexão declarada. A política não
-- chega a chamá-los nesse caso; quem chamar fora dela recebe nulo, e
-- `x = any(null)` é nulo — falha fechada, nunca "tudo".

-- As empresas da conexão: a pergunta da F16a (`integration_allows_company`),
-- feita uma vez por empresa e guardada por COMANDO.
--
-- A MEMÓRIA, NO MOLDE DA F17.61
--   `stable` já promete a mesma resposta dentro de um comando; guardar a
--   resposta dentro do comando não muda resposta nenhuma. A marca leva
--   statement_timestamp() e todo GUC de quem age que a pergunta lê (concessão,
--   pessoa, dono da integração, topo, administra). Comando novo ou ator novo,
--   memória morta. `is_local` devolve a variável no fim da transação: o pooler
--   nunca leva memória de um pedido para outro.
--   ⚠️ No PGlite o relógio anda de milissegundo em milissegundo: dois comandos
--   no mesmo milissegundo, na mesma transação, dividem a marca. Em produção o
--   relógio é de microssegundo, como na F17.61.
create or replace function ideworks.integration_company_ids()
  returns uuid[]
  language plpgsql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
declare
  marca    text;
  lido     text;
  resposta uuid[];
begin
  if ideworks.acting_grant_id() is null then
    return null;
  end if;

  marca := pg_catalog.statement_timestamp()::text
        || '|' || coalesce(pg_catalog.current_setting('app.grant_id', true), '')
        || '|' || coalesce(pg_catalog.current_setting('app.user_id', true), '')
        || '|' || coalesce(pg_catalog.current_setting('app.integration_owner_id', true), '')
        || '|' || coalesce(pg_catalog.current_setting('app.is_super', true), '')
        || '|' || coalesce(pg_catalog.current_setting('app.is_superadmin', true), '')
        || '|';

  lido := pg_catalog.current_setting('ideworks_tranca.empresas', true);
  if lido is not null and pg_catalog.starts_with(lido, marca) then
    return pg_catalog.substr(lido, pg_catalog.length(marca) + 1)::uuid[];
  end if;

  select coalesce(pg_catalog.array_agg(cc.id order by cc.id), '{}'::uuid[])
    into resposta
    from ideworks.client_categories cc
   where ideworks.integration_allows_company(cc.id);

  perform pg_catalog.set_config('ideworks_tranca.empresas', marca || resposta::text, true);
  return resposta;
end
$fn$;

comment on function ideworks.integration_company_ids() is
  'Empresas da conexão declarada: `integration_allows_company` de cada uma. '
  'Nulo sem conexão. Memória por comando, como a F17.61. F44, Fase 5.';

-- Os espaços das empresas da conexão.
create or replace function ideworks.integration_space_ids()
  returns uuid[]
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
    when ideworks.acting_grant_id() is null then null
    else coalesce(
      (select pg_catalog.array_agg(s.id order by s.id)
         from ideworks.spaces s
        where s.category_id = any ((select ideworks.integration_company_ids())::uuid[])),
      '{}'::uuid[])
  end
$fn$;

comment on function ideworks.integration_space_ids() is
  'Espaços das empresas da conexão declarada. Nulo sem conexão. F44, Fase 5.';

-- As listas dos espaços da conexão — pela EMPRESA só (ver "TAREFA MOVIDA").
create or replace function ideworks.integration_list_ids()
  returns uuid[]
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
    when ideworks.acting_grant_id() is null then null
    else coalesce(
      (select pg_catalog.array_agg(l.id order by l.id)
         from ideworks.lists l
        where l.space_id = any ((select ideworks.integration_space_ids())::uuid[])),
      '{}'::uuid[])
  end
$fn$;

comment on function ideworks.integration_list_ids() is
  'Listas das empresas da conexão declarada, sem olhar o cliente da lista. '
  'Nulo sem conexão. F44, Fase 5.';

-- Os clientes da conexão: empresa do cliente na conexão E cliente na
-- allowlist (`allowed_client_ids` nulo = todos). É `integration_allows_client`
-- sem o `can_see_client` — esse é a metade "pessoa", e já está na política.
create or replace function ideworks.integration_client_ids()
  returns uuid[]
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
    when ideworks.acting_grant_id() is null then null
    else coalesce(
      (select pg_catalog.array_agg(c.id order by c.id)
         from ideworks.clients c
         join ideworks.integration_grants g on g.id = ideworks.acting_grant_id()
        where c.category_id = any ((select ideworks.integration_company_ids())::uuid[])
          and (g.allowed_client_ids is null or c.id = any (g.allowed_client_ids))),
      '{}'::uuid[])
  end
$fn$;

comment on function ideworks.integration_client_ids() is
  'Clientes da conexão declarada: empresa do cliente na conexão e cliente na '
  'allowlist. O alcance da pessoa fica na política de cada tabela. Nulo sem '
  'conexão. F44, Fase 5.';

-- Os QUADROS da conexão: listas da conexão cujo cliente, se houver, também é
-- da conexão — o `boardClientSql` do MCP. É por aqui que passa a tarefa SEM
-- cliente próprio: o cliente dela é o da lista.
create or replace function ideworks.integration_board_ids()
  returns uuid[]
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select case
    when ideworks.acting_grant_id() is null then null
    else coalesce(
      (select pg_catalog.array_agg(l.id order by l.id)
         from ideworks.lists l
        where l.space_id = any ((select ideworks.integration_space_ids())::uuid[])
          and (l.client_id is null
               or l.client_id = any ((select ideworks.integration_client_ids())::uuid[]))),
      '{}'::uuid[])
  end
$fn$;

comment on function ideworks.integration_board_ids() is
  'Listas da conexão cujo cliente (se houver) também é da conexão: onde a '
  'tarefa sem cliente próprio está na conexão. Nulo sem conexão. F44, Fase 5.';

revoke all on function ideworks.no_integration_declared() from public;
revoke all on function ideworks.integration_company_ids() from public;
revoke all on function ideworks.integration_space_ids() from public;
revoke all on function ideworks.integration_list_ids() from public;
revoke all on function ideworks.integration_client_ids() from public;
revoke all on function ideworks.integration_board_ids() from public;

grant execute on function ideworks.no_integration_declared() to ideworks_app;
grant execute on function ideworks.integration_company_ids() to ideworks_app;
grant execute on function ideworks.integration_space_ids() to ideworks_app;
grant execute on function ideworks.integration_list_ids() to ideworks_app;
grant execute on function ideworks.integration_client_ids() to ideworks_app;
grant execute on function ideworks.integration_board_ids() to ideworks_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A TRANCA — uma política restritiva por tabela, `for all`
-- ─────────────────────────────────────────────────────────────────────────────
-- `to public` como as permissivas da tabela: a tranca vale para qualquer papel
-- que um dia ganhe a tabela, e não só para quem lembrar de pedi-la. Sem
-- `with check` explícito o Postgres usaria o `using` — escrito aqui mesmo
-- assim, para ler a regra de escrita sem lembrar desse detalhe.

-- --- espaço, pasta, lista ----------------------------------------------------
drop policy if exists spaces_tranca_da_conexao on ideworks.spaces;
create policy spaces_tranca_da_conexao on ideworks.spaces
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or category_id = any ((select ideworks.integration_company_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or category_id = any ((select ideworks.integration_company_ids())::uuid[]));

drop policy if exists folders_tranca_da_conexao on ideworks.folders;
create policy folders_tranca_da_conexao on ideworks.folders
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or space_id = any ((select ideworks.integration_space_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or space_id = any ((select ideworks.integration_space_ids())::uuid[]));

drop policy if exists lists_tranca_da_conexao on ideworks.lists;
create policy lists_tranca_da_conexao on ideworks.lists
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or space_id = any ((select ideworks.integration_space_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or space_id = any ((select ideworks.integration_space_ids())::uuid[]));

-- --- a tarefa ----------------------------------------------------------------
-- Três casos, e nenhum lê outra tabela por linha:
--   · sem lista: a empresa é a do cliente — o cliente tem de ser da conexão;
--   · sem cliente próprio: vale o da lista — a lista tem de ser QUADRO da
--     conexão (empresa na conexão, cliente da lista nulo ou da conexão);
--   · com os dois: lista de empresa da conexão E cliente da conexão.
-- Sem lista e sem cliente o `case` dá nulo: recusa (a metade "pessoa" também
-- recusa essa linha hoje).
drop policy if exists tasks_tranca_da_conexao on ideworks.tasks;
create policy tasks_tranca_da_conexao on ideworks.tasks
  as restrictive for all to public
  using (
    (select ideworks.no_integration_declared()) is not null
    or case
         when list_id is null
           then client_id = any ((select ideworks.integration_client_ids())::uuid[])
         when client_id is null
           then list_id = any ((select ideworks.integration_board_ids())::uuid[])
         else list_id = any ((select ideworks.integration_list_ids())::uuid[])
          and client_id = any ((select ideworks.integration_client_ids())::uuid[])
       end
  )
  with check (
    (select ideworks.no_integration_declared()) is not null
    or case
         when list_id is null
           then client_id = any ((select ideworks.integration_client_ids())::uuid[])
         when client_id is null
           then list_id = any ((select ideworks.integration_board_ids())::uuid[])
         else list_id = any ((select ideworks.integration_list_ids())::uuid[])
          and client_id = any ((select ideworks.integration_client_ids())::uuid[])
       end
  );

-- --- o que é da tarefa -------------------------------------------------------
-- A tarefa tem de ser VISÍVEL — e a leitura de `tasks` dentro da política passa
-- pela tranca dela. Uma regra só para tudo o que pendura na tarefa.
-- Os apelidos (`tarefa`, `checklist`, `rodada`, `fato`, `contrato`) são só
-- destas políticas: as permissivas usam `r`, `h`, `c`, e a prova de produção
-- acha no EXPLAIN o que é da tranca pelo apelido.
drop policy if exists task_comments_tranca_da_conexao on ideworks.task_comments;
create policy task_comments_tranca_da_conexao on ideworks.task_comments
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_comments.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_comments.task_id));

drop policy if exists task_events_tranca_da_conexao on ideworks.task_events;
create policy task_events_tranca_da_conexao on ideworks.task_events
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_events.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_events.task_id));

drop policy if exists task_assignees_tranca_da_conexao on ideworks.task_assignees;
create policy task_assignees_tranca_da_conexao on ideworks.task_assignees
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_assignees.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_assignees.task_id));

drop policy if exists task_watchers_tranca_da_conexao on ideworks.task_watchers;
create policy task_watchers_tranca_da_conexao on ideworks.task_watchers
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_watchers.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_watchers.task_id));

drop policy if exists task_tag_assignments_tranca_da_conexao on ideworks.task_tag_assignments;
create policy task_tag_assignments_tranca_da_conexao on ideworks.task_tag_assignments
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_tag_assignments.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_tag_assignments.task_id));

drop policy if exists task_checklists_tranca_da_conexao on ideworks.task_checklists;
create policy task_checklists_tranca_da_conexao on ideworks.task_checklists
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_checklists.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_checklists.task_id));

drop policy if exists checklist_items_tranca_da_conexao on ideworks.checklist_items;
create policy checklist_items_tranca_da_conexao on ideworks.checklist_items
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.task_checklists checklist
                     where checklist.id = checklist_items.checklist_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.task_checklists checklist
                     where checklist.id = checklist_items.checklist_id));

drop policy if exists task_links_tranca_da_conexao on ideworks.task_links;
create policy task_links_tranca_da_conexao on ideworks.task_links
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_links.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_links.task_id));

drop policy if exists task_attachments_tranca_da_conexao on ideworks.task_attachments;
create policy task_attachments_tranca_da_conexao on ideworks.task_attachments
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_attachments.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = task_attachments.task_id));

-- A rodada também leva `client_id`, mas quem a mostra é a ficha da tarefa: a
-- tarefa decide, como nas outras satélites.
drop policy if exists approval_rounds_tranca_da_conexao on ideworks.approval_rounds;
create policy approval_rounds_tranca_da_conexao on ideworks.approval_rounds
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = approval_rounds.task_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.tasks tarefa where tarefa.id = approval_rounds.task_id));

drop policy if exists approval_round_items_tranca_da_conexao on ideworks.approval_round_items;
create policy approval_round_items_tranca_da_conexao on ideworks.approval_round_items
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.approval_rounds rodada
                     where rodada.id = approval_round_items.round_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.approval_rounds rodada
                     where rodada.id = approval_round_items.round_id));

-- --- o cliente ---------------------------------------------------------------
-- Escrever exige também a empresa da linha NOVA: trocar `category_id` para
-- fora da conexão é sair dela. Cliente novo (o id ainda não está no conjunto)
-- é recusado à conexão — nenhuma ferramenta da IA cria cliente.
drop policy if exists clients_tranca_da_conexao on ideworks.clients;
create policy clients_tranca_da_conexao on ideworks.clients
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or id = any ((select ideworks.integration_client_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or (category_id = any ((select ideworks.integration_company_ids())::uuid[])
             and id = any ((select ideworks.integration_client_ids())::uuid[])));

-- --- o que é do cliente ------------------------------------------------------
drop policy if exists mural_notes_tranca_da_conexao on ideworks.mural_notes;
create policy mural_notes_tranca_da_conexao on ideworks.mural_notes
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]));

drop policy if exists client_history_tranca_da_conexao on ideworks.client_history;
create policy client_history_tranca_da_conexao on ideworks.client_history
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]));

drop policy if exists history_documents_tranca_da_conexao on ideworks.history_documents;
create policy history_documents_tranca_da_conexao on ideworks.history_documents
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.client_history fato
                     where fato.id = history_documents.history_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.client_history fato
                     where fato.id = history_documents.history_id));

drop policy if exists content_items_tranca_da_conexao on ideworks.content_items;
create policy content_items_tranca_da_conexao on ideworks.content_items
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]));

drop policy if exists month_contracts_tranca_da_conexao on ideworks.month_contracts;
create policy month_contracts_tranca_da_conexao on ideworks.month_contracts
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]));

drop policy if exists month_contract_items_tranca_da_conexao on ideworks.month_contract_items;
create policy month_contract_items_tranca_da_conexao on ideworks.month_contract_items
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.month_contracts contrato
                     where contrato.id = month_contract_items.contract_id))
  with check ((select ideworks.no_integration_declared()) is not null
         or exists (select 1 from ideworks.month_contracts contrato
                     where contrato.id = month_contract_items.contract_id));

drop policy if exists client_quotas_tranca_da_conexao on ideworks.client_quotas;
create policy client_quotas_tranca_da_conexao on ideworks.client_quotas
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]));

drop policy if exists client_tag_assignments_tranca_da_conexao on ideworks.client_tag_assignments;
create policy client_tag_assignments_tranca_da_conexao on ideworks.client_tag_assignments
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]));

drop policy if exists appointments_tranca_da_conexao on ideworks.appointments;
create policy appointments_tranca_da_conexao on ideworks.appointments
  as restrictive for all to public
  using ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]))
  with check ((select ideworks.no_integration_declared()) is not null
         or client_id = any ((select ideworks.integration_client_ids())::uuid[]));

commit;
