-- =============================================================================
-- IDE WORKS — F17.75  O quadro que aguenta
-- =============================================================================
-- ⚠️ O DIAGNOSTICO DA F17.74 ESTAVA ERRADO, E ESTE ARQUIVO E O PORQUE
--
--   A F17.74 escreveu: "a politica `task_assignees_select` chama
--   `can_reach_task_id(task_id)` uma vez por linha, ~1 ms por linha". Medido em
--   2026-09-04, no banco de producao, como `ideworks_app`, sobre os MESMOS 554
--   vinculos, com o par (id) ja colhido para tirar a leitura da conta:
--
--     unnest 554, sem funcao nenhuma (o piso) ................  33 ms
--     554x can_reach_task_id ................................. 180 ms
--     554x can_act_on_task_id(execute) ....................... 541 ms
--     select count(*) from task_assignees [as duas juntas] ... 525 ms
--
--   `can_reach_task_id` custa 0,27 ms alem do piso — e desses, 0,26 e o proprio
--   `where t.id = target` em `tasks`. A memoria da F17.61 ja fez o trabalho
--   dela. **Quem custa e `can_act_on_task_id`, que NAO e a politica de leitura.**
--
--   O plano do banco mostra as duas, e nao uma:
--
--     Seq Scan on task_assignees
--       Filter: (can_act_on_task_id(task_id, 'execute') OR can_reach_task_id(task_id))
--
--   `task_assignees_write` foi escrita `for all`, e **`for all` inclui
--   `select`** — o mesmo defeito que a F17.32b achou em sete tabelas de cliente,
--   aqui de novo em sete tabelas de tarefa. Politicas permissivas se somam com
--   OU, entao toda leitura pagava tambem a metade de ESCRITA.
--
-- SAO DUAS CORRECOES, E ELAS SE SOMAM
--
--   1. A METADE CARA SAI DA LEITURA  (o padrao da F17.32b)
--      Cada `for all` vira `for insert` + `for update` + `for delete`, com a
--      MESMA expressao, palavra por palavra.
--
--      ⚠️ AQUI ISSO NAO ESTREITA A LEITURA DE NINGUEM, E DA PARA PROVAR:
--        can_act_on_task_id(t, min) = can_reach_task(lista, cliente)
--                                     AND node_ceiling(...) >= min
--        can_reach_task_id(t)       = can_reach_task(lista, cliente)
--      A primeira e a segunda mais uma conjuncao. Logo ACT IMPLICA REACH, sobre
--      a MESMA linha de `tasks`: o ramo `_write` do OU nunca somou uma linha que
--      o ramo `_select` ja nao trouxesse. Ele so cobrava por ela.
--      (Na F17.32b as duas metades eram regras DIFERENTES e o numero mudou de
--      106 para 45. Aqui a prova cobra que o conjunto de ids seja IDENTICO.)
--
--   2. A PERGUNTA PARA DE SE REPETIR  (o padrao da F17.61, sem uma virgula nova)
--      O que faz `can_act_on_task_id` custar 1 ms nao e a busca: e
--      `node_ceiling`, medido em 0,61 ms por chamada, com 41 listas distintas no
--      acervo inteiro. `node_ceiling` e a raiz da arvore de permissao — abaixo
--      dela estao `node_level`, `can_see_list`, `can_see_folder`,
--      `can_see_space`, `can_reach_task_uncached`, `can_act_on_task` e
--      `can_write_owner_uncached`. Junto dela, `chain_level` (a raiz de
--      `can_act_on_chain`, que e a politica de `lists`), medido em 0,61 ms.
--
--        574x node_ceiling ... 353 ms      574x chain_level ...... 349 ms
--        574x node_level ..... 549 ms      574x can_act_on_chain . 344 ms
--
--      As duas repetem a mesma resposta: 41 listas distintas, 574 perguntas.
--      Ganham a memoria por COMANDO da F17.61 — a regra vai inteira para uma
--      irma `..._uncached`, e o involucro so evita perguntar duas vezes.
--
-- POR QUE A MEMORIA NAO AFROUXA NADA (o mesmo argumento da F17.61)
--   As duas funcoes sao `stable`: o Postgres ja promete resposta constante para
--   os mesmos argumentos DENTRO DE UM COMANDO. Guardar a resposta dentro do
--   comando nao pode mudar resposta nenhuma — nao e aposta, e a definicao de
--   `stable`. A marca guardada junto do valor e `statement_timestamp()` mais os
--   tres GUCs de quem age; comando novo, marca nova, memoria morta; ator novo,
--   marca nova, memoria morta. E ela e por COMANDO e nao por TRANSACAO, que foi
--   a armadilha nomeada na F17.61: uma lista criada no meio da transacao
--   continua aparecendo no `returning`.
--
-- ⚠️ AQUI A MEMORIA GUARDA CINCO ESTADOS, E NAO DOIS
--   As duas devolvem `access_level`, e nulo e resposta legitima — no nao
--   alcancado, o teto e nulo. O valor guardado e o rotulo do enum
--   (`view`/`execute`/`create`/`manage`) ou `-` para o nulo, e a leitura compara
--   os cinco casos por igualdade exata.
--
--   ⚠️ E ISSO E DE PROPOSITO A FORMA QUE FALHA PARA O LADO SEGURO: se um dia o
--   enum ganhar um sexto rotulo e ninguem lembrar deste arquivo, a comparacao
--   nao acha nenhum dos cinco, a resposta e RECALCULADA e sai certa — so mais
--   devagar. Uma leitura por prefixo devolveria lixo convertido.
--
-- ONDE A MEMORIA MORA
--   Em GUCs de sessao com os prefixos `ideworks_teto.` e `ideworks_cadeia.`,
--   gravadas com `set_config(..., is_local => true)`: o banco as devolve no fim
--   da transacao, de modo que uma conexao do pooler nunca leve memoria de um
--   pedido para o proximo. O numero de chaves e limitado pelos nos distintos que
--   existem (41 listas hoje), nao pelo numero de linhas nem de pedidos.
--
-- ⚠️ `parallel unsafe`, DE PROPOSITO E EXPLICITO
--   `set_config` nao pode rodar em processo auxiliar de consulta paralela. As
--   duas ja eram `parallel unsafe` por omissao; aqui isso vira declaracao
--   escrita, porque agora ha um motivo duro para nao mexer.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria tabela (nada de RLS a ligar), nao apaga politica sem repor a mesma
--   expressao, nao toca em `node_ceiling_for`, `chain_ceiling_for`,
--   `reaches_company`, `can_see_client`, `can_reach_task`, `can_act_on_task`
--   nem em funcao alguma de escrita. Nenhuma regra nova e escrita nesta etapa.
-- =============================================================================

set local lock_timeout = '15s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AS DUAS REGRAS, INTACTAS — o corpo que era delas ate aqui, palavra por
--    palavra, copiado do BANCO e nao da migration que as criou.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function ideworks.node_ceiling_uncached(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_ceiling_for(
           ideworks.acting_user_id(), ideworks.acting_is_superadmin(),
           p_space_id, p_folder_id, p_list_id)
$fn$;

comment on function ideworks.node_ceiling_uncached(uuid, uuid, uuid) is
  'O teto de acesso a um no, calculado do zero. E o corpo que era '
  '`node_ceiling` ate a F17.75, palavra por palavra. Quem responde ao mundo '
  'continua sendo `node_ceiling`, que so acrescenta memoria por comando. '
  'Existe separada para que a prova da F17.75 possa comparar as duas no a no.';

grant execute on function ideworks.node_ceiling_uncached(uuid, uuid, uuid) to ideworks_app;

create or replace function ideworks.chain_level_uncached(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language sql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when not ideworks.reaches_company(p_space_id) then null
           else ideworks.chain_ceiling_for(
                  ideworks.acting_user_id(), ideworks.acting_is_superadmin(),
                  p_space_id, p_folder_id, p_list_id)
         end
$fn$;

comment on function ideworks.chain_level_uncached(uuid, uuid, uuid) is
  'O nivel da cadeia espaco/pasta/lista, calculado do zero. E o corpo que era '
  '`chain_level` ate a F17.75, palavra por palavra.';

grant execute on function ideworks.chain_level_uncached(uuid, uuid, uuid) to ideworks_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AS MESMAS REGRAS, PERGUNTADAS UMA VEZ POR NO
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function ideworks.node_ceiling(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language plpgsql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
declare
  marca    text;
  chave    text;
  lido     text;
  resposta ideworks.access_level;
begin
  -- A marca do comando e de quem pergunta. Muda o comando, morre a memoria.
  marca := pg_catalog.statement_timestamp()::text
        || coalesce(pg_catalog.current_setting('app.user_id', true), '')
        || coalesce(pg_catalog.current_setting('app.is_superadmin', true), '')
        || coalesce(pg_catalog.current_setting('app.is_super', true), '');

  -- Nome de GUC precisa ser identificador: os tres nos viram resumo hexadecimal.
  -- O ponto separador existe porque os tres argumentos podem ser nulos e uma
  -- concatenacao crua confundiria (espaco X, sem pasta) com (sem espaco, pasta X).
  chave := 'ideworks_teto.k' || pg_catalog.md5(
             coalesce(p_space_id::text,  '') || '.' ||
             coalesce(p_folder_id::text, '') || '.' ||
             coalesce(p_list_id::text,   ''));

  -- ⚠️ Igualdade exata nos cinco casos, e nao leitura por prefixo: rotulo novo
  -- que ninguem lembrou de por aqui simplesmente NAO acerta, e a resposta e
  -- recalculada certa. Ver o cabecalho.
  lido := pg_catalog.current_setting(chave, true);
  if lido = marca || 'view'    then return 'view'::ideworks.access_level;    end if;
  if lido = marca || 'execute' then return 'execute'::ideworks.access_level; end if;
  if lido = marca || 'create'  then return 'create'::ideworks.access_level;  end if;
  if lido = marca || 'manage'  then return 'manage'::ideworks.access_level;  end if;
  if lido = marca || '-'       then return null;                             end if;

  resposta := ideworks.node_ceiling_uncached(p_space_id, p_folder_id, p_list_id);

  -- O NULO SE GUARDA, e essa e a diferenca para a F17.61: aqui ele quer dizer
  -- "nao alcanca", que e a resposta da MAIORIA dos nos para quem nao e o topo.
  -- Nao guarda-lo faria a memoria errar o alvo justamente para quem menos
  -- alcanca — cada linha voltaria a recalcular.
  perform pg_catalog.set_config(
    chave, marca || coalesce(resposta::text, '-'), true);
  return resposta;
end
$fn$;

comment on function ideworks.node_ceiling(uuid, uuid, uuid) is
  'O teto de acesso a um no. A regra e `node_ceiling_uncached`; esta funcao so '
  'evita perguntar duas vezes pelo mesmo no dentro do mesmo comando. A memoria '
  'vale por COMANDO, que e o mesmo alcance que `stable` ja promete — por isso a '
  'resposta e identica, no a no. Guarda tambem o NULO, que aqui e a resposta '
  'mais comum. F17.75.';

create or replace function ideworks.chain_level(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns ideworks.access_level
  language plpgsql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
declare
  marca    text;
  chave    text;
  lido     text;
  resposta ideworks.access_level;
begin
  marca := pg_catalog.statement_timestamp()::text
        || coalesce(pg_catalog.current_setting('app.user_id', true), '')
        || coalesce(pg_catalog.current_setting('app.is_superadmin', true), '')
        || coalesce(pg_catalog.current_setting('app.is_super', true), '');

  chave := 'ideworks_cadeia.k' || pg_catalog.md5(
             coalesce(p_space_id::text,  '') || '.' ||
             coalesce(p_folder_id::text, '') || '.' ||
             coalesce(p_list_id::text,   ''));

  lido := pg_catalog.current_setting(chave, true);
  if lido = marca || 'view'    then return 'view'::ideworks.access_level;    end if;
  if lido = marca || 'execute' then return 'execute'::ideworks.access_level; end if;
  if lido = marca || 'create'  then return 'create'::ideworks.access_level;  end if;
  if lido = marca || 'manage'  then return 'manage'::ideworks.access_level;  end if;
  if lido = marca || '-'       then return null;                             end if;

  resposta := ideworks.chain_level_uncached(p_space_id, p_folder_id, p_list_id);

  perform pg_catalog.set_config(
    chave, marca || coalesce(resposta::text, '-'), true);
  return resposta;
end
$fn$;

comment on function ideworks.chain_level(uuid, uuid, uuid) is
  'O nivel da cadeia espaco/pasta/lista. A regra e `chain_level_uncached`; esta '
  'funcao so evita perguntar duas vezes pelo mesmo no dentro do mesmo comando — '
  'a politica `lists_select` a perguntava uma vez por linha de lista, e '
  '`can_act_on_chain` de novo por baixo. F17.75.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. AS SETE POLITICAS QUE LIAM SEM PRECISAR — o padrao da F17.32b
--
--    ⚠️ A EXPRESSAO NAO MUDA EM UMA VIRGULA. So o `for all` vira os tres
--    comandos de escrita, para que a LEITURA volte a ter uma politica so.
--
--    A ORDEM IMPORTA: repor as tres antes de derrubar a `for all` deixaria a
--    tabela com quatro politicas por um instante — inofensivo, mas derrubar
--    primeiro deixaria uma janela SEM escrita. Como tudo roda numa transacao
--    so, nenhuma das duas janelas existe de fato; a ordem abaixo e a que se le
--    melhor: derruba e repoe, tabela por tabela.
-- ─────────────────────────────────────────────────────────────────────────────

-- task_assignees ─────────────────────────────────────────────────────────────
drop policy if exists task_assignees_write on ideworks.task_assignees;

create policy task_assignees_insert on ideworks.task_assignees for insert
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_assignees_update on ideworks.task_assignees for update
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_assignees_delete on ideworks.task_assignees for delete
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

-- task_watchers ──────────────────────────────────────────────────────────────
drop policy if exists task_watchers_write on ideworks.task_watchers;

create policy task_watchers_insert on ideworks.task_watchers for insert
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_watchers_update on ideworks.task_watchers for update
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_watchers_delete on ideworks.task_watchers for delete
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

-- task_attachments ───────────────────────────────────────────────────────────
drop policy if exists task_attachments_write on ideworks.task_attachments;

create policy task_attachments_insert on ideworks.task_attachments for insert
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_attachments_update on ideworks.task_attachments for update
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_attachments_delete on ideworks.task_attachments for delete
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

-- task_checklists ────────────────────────────────────────────────────────────
drop policy if exists task_checklists_write on ideworks.task_checklists;

create policy task_checklists_insert on ideworks.task_checklists for insert
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_checklists_update on ideworks.task_checklists for update
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_checklists_delete on ideworks.task_checklists for delete
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

-- task_links ─────────────────────────────────────────────────────────────────
drop policy if exists task_links_write on ideworks.task_links;

create policy task_links_insert on ideworks.task_links for insert
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_links_update on ideworks.task_links for update
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_links_delete on ideworks.task_links for delete
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

-- task_tag_assignments ───────────────────────────────────────────────────────
drop policy if exists task_tag_assignments_write on ideworks.task_tag_assignments;

create policy task_tag_assignments_insert on ideworks.task_tag_assignments for insert
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_tag_assignments_update on ideworks.task_tag_assignments for update
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));
create policy task_tag_assignments_delete on ideworks.task_tag_assignments for delete
  using      (ideworks.can_act_on_task_id(task_id, 'execute'::ideworks.access_level));

-- checklist_items ────────────────────────────────────────────────────────────
-- A mesma implicacao, um degrau abaixo: `can_act_on_checklist(k, min)` e
-- `can_act_on_task_id(k.task_id, min)`, e `can_reach_checklist(k)` e
-- `can_reach_task_id(k.task_id)` — a mesma linha de `task_checklists` nas duas.
drop policy if exists checklist_items_write on ideworks.checklist_items;

create policy checklist_items_insert on ideworks.checklist_items for insert
  with check (ideworks.can_act_on_checklist(checklist_id, 'execute'::ideworks.access_level));
create policy checklist_items_update on ideworks.checklist_items for update
  using      (ideworks.can_act_on_checklist(checklist_id, 'execute'::ideworks.access_level))
  with check (ideworks.can_act_on_checklist(checklist_id, 'execute'::ideworks.access_level));
create policy checklist_items_delete on ideworks.checklist_items for delete
  using      (ideworks.can_act_on_checklist(checklist_id, 'execute'::ideworks.access_level));
