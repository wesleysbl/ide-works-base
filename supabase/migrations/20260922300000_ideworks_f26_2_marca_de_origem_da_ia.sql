-- =============================================================================
-- IDE WORKS — F26.2  A marca de origem da IA, e a regra de edição, no banco
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   Tarefa, evento de tarefa, nota do mural e registro do histórico do cliente
--   passam a guardar POR QUAL CONEXÃO DE IA a linha nasceu — o nome dela no
--   instante e o id —, preenchido pelo banco a partir da sessão; e a IA só
--   edita ou apaga, no mural e no histórico, o que a IA DA MESMA PESSOA
--   escreveu.
--
-- POR QUE NO BANCO, E NÃO NO CÓDIGO DA INTEGRAÇÃO
--   Hoje o banco só sabe QUEM: `created_by`, `actor_id`. O selo "via agente"
--   existe apenas no registro da integração (f16c), visível só para o dono e só
--   para comentários. Pôr a marca no código da integração deixaria dois furos:
--   um caminho novo que esquecesse de marcar gravaria uma linha de IA com cara
--   de gente, e a tela — que escreve as MESMAS tabelas — poderia gravar a marca
--   que quisesse. A sessão já diz tudo: o `withActor` (src/server/db.ts)
--   declara `app.grant_id`, `app.integration_owner_id` e `app.execution_origin`
--   em TODA transação — vazias no caminho humano, preenchidas no do agente. O
--   gatilho lê a sessão, e ninguém passa a marca como parâmetro.
--
-- AS DUAS COLUNAS, NAS QUATRO TABELAS
--   via_grant_id   a conexão (a concessão, `integration_grants`). Chave
--                  estrangeira `on delete set null`: a tela de Conexões só
--                  REVOGA (a linha fica), mas se a concessão um dia for
--                  apagada — SQL manual, ou a cascata de `profiles` — o id vai
--                  embora com ela. Apontar para o nada não serve a ninguém.
--   via_name       o nome da conexão NO INSTANTE ("Claude", "ChatGPT"). É ele
--                  que sustenta "Carla, via ChatGPT" depois que a conexão foi
--                  revogada, renomeada ou apagada. Cópia de propósito, e pelo
--                  mesmo motivo de `automation_name` (F17.41): é o retrato de
--                  um fato, e o livro não se reescreve.
--   As duas nulas = escrita humana. Id sem nome não existe (checagem
--   `*_via_coherent`); nome sem id é a conexão apagada, e continua sendo marca.
--
-- QUANDO A MARCA É ESCRITA — E QUANDO NÃO É
--   Tarefa, nota e registro: a marca é a da CRIAÇÃO. Preenchida no insert e
--   imutável depois: editar pela IA uma tarefa que uma pessoa criou não a
--   transforma em "criada via Claude" (quem editou fica no registro da
--   integração e, para responsável e etapa, no evento da tarefa).
--   Evento da tarefa: cada evento carrega a sessão que o GEROU. É assim que
--   "atribuída por Carla, via ChatGPT" aparece no histórico da tarefa. Os
--   eventos nascem dentro de `set_task_assignees` (security definer, versão
--   da F17.69) e de `move_task` (invoker, versão da F17.80) — um gatilho
--   BEFORE INSERT na própria tabela pega os dois, e o que vier depois, sem
--   reescrever função nenhuma. `security definer` troca o PAPEL, não a sessão:
--   `current_setting('app.grant_id')` dentro da função é o da transação de
--   quem chamou (provado em scripts/testar-marca-de-origem-da-ia-banco.mjs).
--   A linha da AUTOMAÇÃO que a IA disparou ao mover também sai marcada: a regra
--   rodou porque a IA empurrou a tarefa.
--
-- A SESSÃO HUMANA NÃO FORJA NEM APAGA A MARCA
--   No insert humano o gatilho FORÇA nulo — mandar `via_name = 'Claude'` pela
--   tela não grava nada. No update, de qualquer sessão, as duas colunas voltam
--   ao valor antigo. A única exceção é a que o próprio Postgres faz: ao apagar
--   a conexão, a chave estrangeira anula `via_grant_id` — e o gatilho só deixa
--   esse id virar nulo quando a conexão de fato NÃO EXISTE MAIS. O nome fica.
--   Ignorar em silêncio, e não recusar: um `update` legítimo que por acaso
--   reenvie a linha inteira não deve quebrar por causa de duas colunas que ele
--   nem quis mudar.
--
-- A REGRA DE EDIÇÃO: MURAL E HISTÓRICO (decisão 2 do plano F26)
--   Quando a escrita vem de agente, editar ou apagar exige que a linha tenha
--   sido criada PELA MESMA PESSOA (`created_by` = quem age) E VIA AGENTE (marca
--   não nula). Qualquer outra recusa com 42501 e uma frase — a tela e a IA
--   repassam a mensagem como veio (`traduzir` em mural-e-captacao.ts e
--   history.ts). A escrita humana continua EXATAMENTE como hoje: quem vê o
--   cliente edita e apaga qualquer nota e qualquer registro (a regra humana
--   ficou fora da F26, seção 5 do plano).
--   "Mesma pessoa via agente", e não "mesma conexão": a nota que a Carla ditou
--   pelo Claude pode ser corrigida pelo ChatGPT da Carla. A fronteira que
--   importa é a pessoa — a IA dela não mexe no que outra pessoa escreveu, nem
--   no que a própria Carla escreveu à mão.
--   E no insert do agente `created_by` é FORÇADO para quem age: é ele que a
--   regra confere depois, e não pode ser um valor vindo da chamada.
--
--   POR GATILHO, E NÃO POR POLÍTICA DE RLS
--   As políticas de mural e histórico são `for all`/por comando com
--   `can_see_client` — a regra humana. Acrescentar uma política RESTRITIVA
--   funcionaria, mas recusaria calada: política que filtra devolve ZERO
--   linhas, e a IA ouviria "nota não encontrada" em vez de "a IA só edita o
--   que ela escreveu". O gatilho BEFORE UPDATE/DELETE recusa com frase e
--   errcode 42501, deixa as políticas humanas intactas (o retrato de políticas
--   não muda) e sai inteiro no rollback.
--
-- O CUSTO, NUMA TABELA QUENTE
--   `tasks` e `task_events` são escritas pelo quadro inteiro. Por isso:
--     · o gatilho de marca só dispara no update quando o próprio `update`
--       nomeia `via_grant_id` ou `via_name` (`before update of`). Arrastar
--       cartão, concluir, renomear: o gatilho nem acorda;
--     · no insert, a primeira coisa é ler `app.grant_id`. Vazia ou nula — as
--       duas formas que a sessão humana e a do coletor deixam — sai na hora,
--       sem consulta nenhuma. A concessão só é lida no caminho do agente.
--   `current_setting(..., true)` devolve NULO quando a variável nunca foi
--   definida na conexão (coletor, preauth) e '' quando foi e a transação
--   acabou (`set_config` local). O `nullif` trata as duas iguais.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--   Não preenche o passado. Os `move_task` que a IA já fez desde a F21 geraram
--   eventos sem marca; o registro da integração sabe quais foram, mas escrever
--   marca retroativa seria fabricar passado (a regra da F17.65, seção 6).
--   Não muda política, função de escrita nem privilégio de tabela. Não mostra
--   a marca em tela nenhuma (F26 fase 9).
-- =============================================================================

begin;
set local lock_timeout = '15s';

-- --- as colunas --------------------------------------------------------------
-- Sem default: coluna nula nova é só catálogo, e nenhuma das quatro tabelas é
-- regravada. A chave estrangeira confere as linhas existentes — todas nulas.

alter table ideworks.tasks
  add column if not exists via_grant_id uuid
    references ideworks.integration_grants (id) on delete set null,
  add column if not exists via_name text;

alter table ideworks.task_events
  add column if not exists via_grant_id uuid
    references ideworks.integration_grants (id) on delete set null,
  add column if not exists via_name text;

alter table ideworks.mural_notes
  add column if not exists via_grant_id uuid
    references ideworks.integration_grants (id) on delete set null,
  add column if not exists via_name text;

alter table ideworks.client_history
  add column if not exists via_grant_id uuid
    references ideworks.integration_grants (id) on delete set null,
  add column if not exists via_name text;

-- Id sem nome não é marca, é defeito. Nome sem id é a conexão apagada.
alter table ideworks.tasks          drop constraint if exists tasks_via_coherent;
alter table ideworks.task_events    drop constraint if exists task_events_via_coherent;
alter table ideworks.mural_notes    drop constraint if exists mural_notes_via_coherent;
alter table ideworks.client_history drop constraint if exists client_history_via_coherent;

alter table ideworks.tasks
  add constraint tasks_via_coherent check (via_grant_id is null or via_name is not null);
alter table ideworks.task_events
  add constraint task_events_via_coherent check (via_grant_id is null or via_name is not null);
alter table ideworks.mural_notes
  add constraint mural_notes_via_coherent check (via_grant_id is null or via_name is not null);
alter table ideworks.client_history
  add constraint client_history_via_coherent check (via_grant_id is null or via_name is not null);

-- Apagar uma conexão procura as linhas dela nas quatro tabelas (o `set null`).
-- Sem índice seria varredura inteira de `tasks` e `task_events` a cada conexão
-- apagada. Parcial: só as linhas de IA entram, e o índice fica do tamanho delas.
create index if not exists tasks_via_grant_idx
  on ideworks.tasks (via_grant_id) where via_grant_id is not null;
create index if not exists task_events_via_grant_idx
  on ideworks.task_events (via_grant_id) where via_grant_id is not null;
create index if not exists mural_notes_via_grant_idx
  on ideworks.mural_notes (via_grant_id) where via_grant_id is not null;
create index if not exists client_history_via_grant_idx
  on ideworks.client_history (via_grant_id) where via_grant_id is not null;

comment on column ideworks.tasks.via_grant_id is
  'Conexão de IA pela qual a tarefa foi CRIADA. Nula = criada por gente. '
  'Preenchida pelo gatilho a partir da sessão; imutável. Some (set null) se a '
  'conexão for apagada — via_name fica.';
comment on column ideworks.tasks.via_name is
  'Nome da conexão no instante da criação ("Claude", "ChatGPT"). Retrato de '
  'propósito: sobrevive à revogação e à remoção da conexão.';
comment on column ideworks.task_events.via_grant_id is
  'Conexão de IA da sessão que GEROU o evento. Nula = gente (ou automação '
  'disparada por gente).';
comment on column ideworks.task_events.via_name is
  'Nome da conexão no instante do evento: "atribuída por Carla, via ChatGPT".';
comment on column ideworks.mural_notes.via_grant_id is
  'Conexão de IA pela qual a nota foi CRIADA. Com created_by, é o que a regra '
  'de edição da IA confere.';
comment on column ideworks.mural_notes.via_name is
  'Nome da conexão no instante da criação. Sobrevive à remoção da conexão.';
comment on column ideworks.client_history.via_grant_id is
  'Conexão de IA pela qual o registro foi CRIADO. Com created_by, é o que a '
  'regra de edição da IA confere.';
comment on column ideworks.client_history.via_name is
  'Nome da conexão no instante da criação. Sobrevive à remoção da conexão.';

-- --- o gatilho da marca --------------------------------------------------------
-- `security definer` por UM motivo: ler o nome da concessão. A política de
-- `integration_grants` mostra ao agente só a concessão dele — que é a que se
-- quer —, mas mostra à SESSÃO HUMANA só as da própria pessoa, e a conferência
-- "a conexão ainda existe?" do update precisa enxergar a de qualquer um. O
-- caminho humano do insert não lê tabela nenhuma.
--
-- A concessão da sessão tem de ser DA PESSOA que age. Se não for — ou não
-- existir —, a escrita é recusada: gravar sem marca uma linha que veio de
-- agente seria a mentira que esta etapa existe para impedir.

create or replace function ideworks.stamp_agent_origin()
  returns trigger
  language plpgsql
  security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_grant uuid;
  v_name  text;
begin
  if tg_op = 'UPDATE' then
    -- A marca é imutável. O nome volta sempre.
    new.via_name := old.via_name;
    -- O id só pode virar nulo quando a conexão deixou de existir: é o
    -- `on delete set null` da chave estrangeira, e só ele.
    if new.via_grant_id is null
       and old.via_grant_id is not null
       and not exists (select 1 from ideworks.integration_grants g
                        where g.id = old.via_grant_id) then
      return new;
    end if;
    new.via_grant_id := old.via_grant_id;
    return new;
  end if;

  -- INSERT. Primeiro a variável: sessão humana sai aqui, sem consulta.
  v_grant := nullif(current_setting('app.grant_id', true), '')::uuid;
  if v_grant is null then
    new.via_grant_id := null;
    new.via_name := null;
    return new;
  end if;

  select g.name into v_name
    from ideworks.integration_grants g
   where g.id = v_grant
     and g.owner_id = ideworks.acting_user_id();

  if not found then
    raise exception
      'A conexão de IA desta chamada não foi encontrada entre as conexões de quem age. Nada foi gravado; reconecte a IA e tente de novo.'
      using errcode = '42501';
  end if;

  new.via_grant_id := v_grant;
  new.via_name := v_name;
  return new;
end;
$fn$;

comment on function ideworks.stamp_agent_origin() is
  'Marca de origem (F26.2). Insert: lê app.grant_id; vazia = gente, e as duas '
  'colunas são forçadas a nulo; preenchida = grava a conexão e o nome dela, e '
  'recusa (42501) se a conexão não for de quem age. Update: devolve a marca '
  'antiga, exceto o id anulado pela remoção da conexão.';

drop trigger if exists tasks_via_origin on ideworks.tasks;
create trigger tasks_via_origin
  before insert or update of via_grant_id, via_name on ideworks.tasks
  for each row execute function ideworks.stamp_agent_origin();

drop trigger if exists task_events_via_origin on ideworks.task_events;
create trigger task_events_via_origin
  before insert or update of via_grant_id, via_name on ideworks.task_events
  for each row execute function ideworks.stamp_agent_origin();

drop trigger if exists mural_notes_via_origin on ideworks.mural_notes;
create trigger mural_notes_via_origin
  before insert or update of via_grant_id, via_name on ideworks.mural_notes
  for each row execute function ideworks.stamp_agent_origin();

drop trigger if exists client_history_via_origin on ideworks.client_history;
create trigger client_history_via_origin
  before insert or update of via_grant_id, via_name on ideworks.client_history
  for each row execute function ideworks.stamp_agent_origin();

-- --- a regra de edição da IA: mural e histórico ------------------------------
-- `security invoker`: lê só a sessão e a linha antiga. As políticas humanas
-- (`can_see_client`) continuam decidindo o que cada um alcança; este gatilho
-- só ESTREITA o agente, nunca alarga ninguém.
--
-- A marca conferida é a da linha ANTIGA: um update de agente não consegue se
-- dar permissão mudando a marca na mesma instrução — e nem conseguiria mudá-la,
-- porque o gatilho acima a devolve.

create or replace function ideworks.agent_client_record_guard()
  returns trigger
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid;
begin
  -- Sessão humana: nada muda.
  if nullif(current_setting('app.grant_id', true), '') is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_actor := ideworks.acting_user_id();

  if tg_op = 'INSERT' then
    -- A autoria do agente é a pessoa dona da conexão, e não o que veio na
    -- chamada: é ela que a regra abaixo confere quando a IA voltar a esta linha.
    new.created_by := v_actor;
    return new;
  end if;

  if old.created_by is distinct from v_actor
     or (old.via_grant_id is null and old.via_name is null) then
    if tg_table_name = 'mural_notes' then
      raise exception
        'A IA só edita ou apaga notas do mural que ela mesma escreveu em seu nome. Esta nota foi escrita por uma pessoa ou pela IA de outra pessoa; quem quiser mudá-la muda pela tela.'
        using errcode = '42501';
    end if;
    raise exception
      'A IA só edita ou apaga registros do histórico do cliente que ela mesma escreveu em seu nome. Este registro foi escrito por uma pessoa ou pela IA de outra pessoa; quem quiser mudá-lo muda pela tela.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- A autoria não troca de mão pelo agente: trocar `created_by` entregaria a
  -- linha à IA de outra pessoa.
  new.created_by := old.created_by;
  return new;
end;
$fn$;

comment on function ideworks.agent_client_record_guard() is
  'Regra de edição da IA no mural e no histórico (F26.2). Sessão humana: nada '
  'muda. Sessão de agente: insert grava created_by = quem age; update e delete '
  'exigem created_by = quem age E marca de origem não nula, senão 42501 com frase.';

drop trigger if exists mural_notes_agent_guard on ideworks.mural_notes;
create trigger mural_notes_agent_guard
  before insert or update or delete on ideworks.mural_notes
  for each row execute function ideworks.agent_client_record_guard();

drop trigger if exists client_history_agent_guard on ideworks.client_history;
create trigger client_history_agent_guard
  before insert or update or delete on ideworks.client_history
  for each row execute function ideworks.agent_client_record_guard();

-- --- privilégios -------------------------------------------------------------
-- Função de gatilho não é chamada por ninguém: o Postgres confere EXECUTE só
-- ao criar o gatilho. Fechadas para todos, no molde de `sync_text_mentions`
-- (F17.82) — uma `security definer` aberta seria porta sem uso.
revoke all on function ideworks.stamp_agent_origin()
  from public, anon, authenticated, ideworks_app;
revoke all on function ideworks.agent_client_record_guard()
  from public, anon, authenticated, ideworks_app;

commit;
