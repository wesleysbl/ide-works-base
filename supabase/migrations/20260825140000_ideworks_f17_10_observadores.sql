-- =============================================================================
-- IDE WORKS — F17.10  O observador da tarefa
-- =============================================================================
-- O QUE ENTRA, E POR QUE É UMA TABELA E NÃO UMA COLUNA
--   A ficha da tarefa do ClickUp mostra DOIS conjuntos de pessoas: quem faz
--   (responsável) e quem acompanha (observador). Medido nas duas agências: 1 a
--   2 observadores por tarefa. São papéis diferentes sobre a mesma linha — o
--   observador não recebe trabalho, recebe notícia — e por isso não cabem na
--   mesma lista.
--
--   Plural desde o primeiro dia, pela mesma razão de `task_assignees` na F4.8:
--   uma coluna `watcher_id` obrigaria a segunda pessoa a virar migration.
--
-- ISTO É A METADE DE BAIXO DA F17.6, ADIANTADA — E ESTÁ DECLARADO
--   O plano põe "Observador: quem acompanha a tarefa sem ser responsável" na
--   F17.6, junto de comentário e anexo. Ele vem para cá porque a F17.10 desenha
--   o CABEÇALHO da ficha, e o observador mora nele — entregar o cabeçalho sem
--   ele seria entregar um cabeçalho pela metade e mexer nele de novo depois.
--
--   A F17.6 continua dona da NOTIFICAÇÃO: esta tabela guarda quem acompanha, e
--   nada mais. Não há aqui nenhuma promessa de que alguém será avisado.
--
-- NENHUMA REGRA DE ACESSO NOVA
--   O alcance do observador É o alcance da tarefa: `can_reach_task_id`, a mesma
--   função que `task_assignees` usa desde a F17.3. Escrever aqui uma segunda
--   expressão — mesmo idêntica — seria a dívida 8.1 do legado: duas verdades
--   sobre o mesmo fato, e a de baixo ficando para trás na primeira mudança.
--
-- `set_task_watchers` É O ESPELHO DE `set_task_assignees`, DE PROPÓSITO
--   Troca a lista inteira em bloco (regra 9), aceita repetido sem estourar, e
--   IGNORA quem não tem perfil no IDE Works.
--
--   Esse "ignora" é a decisão da F4.8 sendo honrada e não é indolor: hoje há 8
--   perfis aqui contra 35 membros no ClickUp, e a função descarta em silêncio.
--   A TELA da F17.10 relê depois de salvar e mostra o que de fato ficou — é o
--   único jeito honesto de conviver com uma função que ignora sem falar.
--
--   Por que ignorar em vez de recusar: `task_watchers.user_id` aponta para
--   `auth.users`, então o id pode ser de gente que existe no provedor e não tem
--   perfil aqui. Recusar a operação inteira por causa de um id assim faria o
--   salvamento da ficha falhar por um observador, perdendo o resto do que a
--   pessoa escreveu.
-- =============================================================================

create table if not exists ideworks.task_watchers (
  task_id  uuid not null references ideworks.tasks (id) on delete cascade,
  user_id  uuid not null references auth.users   (id) on delete cascade,

  -- Instante, e não booleano — a regra do projeto. Responde "acompanha desde
  -- quando?", que é o que a ficha mostra ao passar o ponteiro.
  added_at timestamptz not null default now(),

  primary key (task_id, user_id)
);

-- A chave primária já serve "quem observa esta tarefa". Este índice serve o
-- outro sentido — "o que eu acompanho" — que é a lista da F17.13. Mesmo par de
-- `task_assignees_user_idx` na F4.8.
create index if not exists task_watchers_user_idx on ideworks.task_watchers (user_id);

comment on table ideworks.task_watchers is
  'Quem acompanha a tarefa sem ser responsavel. SEM copia do nome ao lado do '
  'id, como task_assignees: o nome sai de ideworks.display_name() na leitura, '
  'porque copia nao se atualiza quando a pessoa muda de nome.';
comment on column ideworks.task_watchers.added_at is
  'Instante, nao booleano: responde "acompanha desde quando?".';

-- --- trocar a lista inteira (regra 9) -----------------------------------------
-- Espelho exato de `set_task_assignees` (F17.3). As três decisões dela valem
-- aqui pelas mesmas razões, e estão no cabeçalho:
--   · exige ALCANÇAR a tarefa, e não ser administrador;
--   · `group by` em vez de `distinct`, porque a tela pode mandar id repetido e
--     a chave primária recusaria com uma mensagem que ninguém entende;
--   · ignora quem não tem perfil.
create or replace function ideworks.set_task_watchers(p_task_id uuid, p_user_ids uuid[])
  returns void language plpgsql security definer
  set search_path = ideworks, pg_temp as $fn$
begin
  if not exists (
    select 1 from ideworks.tasks t
     where t.id = p_task_id and ideworks.can_reach_task(t.list_id, t.client_id)
  ) then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.task_watchers where task_id = p_task_id;

  insert into ideworks.task_watchers (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;
end;
$fn$;

comment on function ideworks.set_task_watchers(uuid, uuid[]) is
  'Troca a lista inteira de observadores. Ignora quem nao tem perfil no IDE '
  'Works, como set_task_assignees: acompanhar sem entrar no sistema e nao '
  'acompanhar. A tela rele depois de salvar e mostra o que de fato ficou.';

-- --- segurança por linha -------------------------------------------------------
alter table ideworks.task_watchers enable row level security;

-- A MESMA função das políticas de `task_assignees`, e não uma cópia da
-- expressão. `task_watchers` também não tem lista nem cliente em mãos — só o id
-- da tarefa — então é a versão por id que serve, exatamente como na F17.3.
drop policy if exists task_watchers_select on ideworks.task_watchers;
create policy task_watchers_select on ideworks.task_watchers for select
  using (ideworks.can_reach_task_id(task_id));

drop policy if exists task_watchers_write on ideworks.task_watchers;
create policy task_watchers_write on ideworks.task_watchers for all
  using      (ideworks.can_reach_task_id(task_id))
  with check (ideworks.can_reach_task_id(task_id));

grant all privileges on all tables in schema ideworks to ideworks_app;
grant execute on function ideworks.set_task_watchers(uuid, uuid[]) to ideworks_app;
