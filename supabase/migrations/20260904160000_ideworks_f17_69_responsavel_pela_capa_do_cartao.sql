-- =============================================================================
-- IDE WORKS — F17.69  Definir responsavel sem abrir o cartao
-- =============================================================================
-- O PEDIDO
--   *"A equipe necessita alterar ou definir o responsavel por um cartao
--   diretamente pelo quadro, sem abrir o modal completo da tarefa."*
--
-- ⚠️ POR QUE UMA MIGRATION, SE O GESTO E DE TELA
--   Porque a escrita de responsavel NAO SE ESTREITAVA POR EMPRESA — divida
--   antiga e registrada. Ate aqui `set_task_assignees` conferia UMA coisa: se
--   QUEM AGE alcanca a tarefa (`can_act_on_task(..., 'execute')`). Sobre a
--   pessoa ATRIBUIDA ela nao perguntava nada: bastava ter perfil. Quem
--   administra a Ide podia pendurar uma tarefa da Ide em alguem que so existe
--   na Alma 9, e a tarefa apareceria no `Meu trabalho` de quem nao alcanca a
--   lista dela.
--
--   Por o gesto na capa do cartao torna isso cem vezes mais facil de fazer — e
--   portanto cem vezes mais facil de errar. Fechar a parede e parte da etapa.
--
-- ⚠️ SAO DUAS PERGUNTAS DIFERENTES, E AS DUAS JA EXISTEM. NENHUMA REGRA NOVA.
--
--   1. `ideworks.can_assign_person(pessoa)`      — F17.53
--      "EU, o ator, posso oferecer esta pessoa?" Empresa compartilhada comigo,
--      ou sou eu mesmo, ou sou o topo, ou ela nao tem empresa nenhuma.
--
--   2. `ideworks.can_reach_task_for(pessoa, lista, cliente)` — F17.41
--      "Esta pessoa alcanca a empresa DESTA tarefa?" Outra pergunta: a
--      primeira olha o ator, a segunda olha o alvo contra a tarefa. Guardar so
--      com a (1) deixaria passar exatamente o caso que esta etapa fecha,
--      porque duas pessoas da MINHA empresa podem nao alcancar a mesma lista.
--
--   ⚠️ `can_assign_person` usa `acting_is_super()` (o TOPO) e nao
--   `acting_is_superadmin()` ("administra" = admin OU super). A troca entre as
--   duas ja causou a F17.32, a F17.38 e a F17.54. Aqui nenhuma das duas e
--   escrita de novo: as funcoes sao chamadas inteiras.
--
-- ⚠️ A PAREDE VALE PARA QUEM ENTRA, NAO PARA QUEM JA ESTA — E ISSO E MEDIDO
--   Medido em 2026-09-04, como `ideworks_app`, sobre o dado real:
--
--     vinculos de responsavel hoje ................................ 553
--     desses, que `can_reach_task_for` RECUSA ......................   1
--
--   Um. E de um perfil sem nome. Guardar tambem quem JA esta atribuido
--   transformaria aquela unica tarefa numa tarefa que ninguem mais consegue
--   salvar: a escrita e de CONJUNTO (apaga e poe), entao tirar um responsavel
--   reenvia os outros, e o vinculo velho derrubaria a gravacao inteira. A
--   equipe esta usando o sistema agora; a etapa nao pode criar uma tarefa
--   travada para consertar um vinculo que ela nem criou.
--
--   Entao a guarda pergunta pelos IDS QUE NAO ESTAVAM LA. Tirar sempre pode.
--   Regravar o que ja existe sempre pode. Por gente nova, so dentro da parede.
--
-- SEM SEGUNDO CAMINHO DE ESCRITA (regra 9)
--   A capa do cartao chama a MESMA `set_task_assignees` que a ficha chama. Por
--   isso o rastro em `task_events` (F17.65) sai de graca e continua saindo de
--   um lugar so — esta migration nao acrescenta um `insert` de evento, ela
--   preserva o que a F17.65 escreveu, palavra por palavra.
--
-- ⚠️ O TEXTO DE PARTIDA E O DO BANCO
--   `pg_get_functiondef` de 2026-09-04, e nao a migration da F17.65 — copiar do
--   arquivo errado ja quase afrouxou esta mesma funcao uma vez. O corpo abaixo
--   e aquele texto com UM bloco acrescentado; nada foi removido.
--
-- A FUNCAO NOVA: QUEM O MENU DA CAPA PODE OFERECER
--   `assignable_people_for_task(task)` e a lista da F17.70 (`can_assign_person`,
--   sem as contas `@ideworks.invalid`) ESTREITADA pela segunda pergunta, mais
--   quem ja e responsavel ali. Nao e uma terceira lista de gente discordando
--   das outras: e a mesma regra, respondida para UMA tarefa.
--
--   ⚠️ QUEM JA E RESPONSAVEL ENTRA SEMPRE, mesmo fora do recorte. E a mesma
--   metade-2 da uniao da F17.70, e pelo mesmo motivo: o cartao ja mostra as
--   iniciais dessa pessoa, e esconde-la do menu deixaria um responsavel que
--   nao da para TIRAR. Enumerar aqui nao revela nada que a capa ja nao mostre.
--
--   Ela e `security definer` pela razao de sempre: `profiles_select` mostra so
--   o proprio perfil, e uma leitura sob politica devolveria UMA linha. Sendo
--   `definer`, a regra tem de ser perguntada de proposito — e e, duas vezes.
--
--   A GUARDA DE QUEM PERGUNTA e a mesma da escrita: sem `execute` na tarefa, a
--   funcao devolve ZERO LINHAS. Um menu que enumerasse gente a partir do id de
--   uma tarefa que o ator nao alcanca seria um vazamento com outro nome.
--
-- CUSTO
--   Nada e acrescentado ao carregamento do quadro — que ja esta em 379 ms no
--   quadro da pasta (F17.74), e esta etapa nao piora isso: a lista so e lida
--   quando alguem ABRE o menu de um cartao, e o estado marcado sai da propria
--   funcao, sem reler `task_assignees` pela politica (que chama
--   `can_reach_task_id` uma vez por linha, F17.3). Dentro de uma funcao
--   `definer` a leitura de UM `task_id` e um acesso por indice.
--
--   `execute` so para `ideworks_app`. `public` nao alcanca.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. QUEM O MENU DA CAPA PODE OFERECER PARA ESTA TAREFA
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function ideworks.assignable_people_for_task(p_task_id uuid)
  returns table (id uuid, name text, assigned boolean)
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  with alvo as (
    -- ⚠️ A GUARDA DE QUEM PERGUNTA. Sem alcance de `execute` na tarefa nao ha
    -- linha em `alvo`, e o `cross join` abaixo zera a lista inteira. Nao e
    -- "menu vazio por engano": e a mesma recusa que a escrita da, dita na
    -- leitura.
    select t.id, t.list_id, t.client_id
      from ideworks.tasks t
     where t.id = p_task_id
       and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
  ),
  donos as (
    select a.user_id
      from ideworks.task_assignees a
     where a.task_id = p_task_id
       and exists (select 1 from alvo)
  )
  select p.id,
         coalesce(p.full_name, p.email) as name,
         exists (select 1 from donos d where d.user_id = p.id) as assigned
    from ideworks.profiles p
    cross join alvo a
   where p.is_active
     and (
          -- QUEM JA E RESPONSAVEL ENTRA SEMPRE — senao nao daria para TIRAR.
          exists (select 1 from donos d where d.user_id = p.id)

          or (
              -- PERGUNTA 1 — "eu posso oferecer esta pessoa?" (F17.53).
              ideworks.can_assign_person(p.id)

              -- PERGUNTA 2 — "esta pessoa alcanca a empresa DESTA tarefa?"
              -- (F17.41). E a que faltava, e e outra pergunta.
              and ideworks.can_reach_task_for(p.id, a.list_id, a.client_id)

              -- CONTA DE SISTEMA NAO E GENTE — mesma linha da F17.70.
              and coalesce(p.email, '') not like '%@ideworks.invalid'
          )
     )
   order by coalesce(p.full_name, p.email)
$fn$;

comment on function ideworks.assignable_people_for_task(uuid) is
  'Quem o menu de responsavel da CAPA do cartao pode oferecer para UMA tarefa — '
  'F17.69. E a lista da F17.70 (can_assign_person, sem @ideworks.invalid) '
  'estreitada por can_reach_task_for(pessoa, lista, cliente) — as duas '
  'perguntas, que sao diferentes: a primeira olha o ator, a segunda olha se '
  'aquela pessoa alcanca a empresa DAQUELA tarefa. Quem ja e responsavel entra '
  'sempre, marcado, senao nao haveria como tira-lo. Devolve ZERO linhas quando '
  'quem pergunta nao tem `execute` na tarefa.';

revoke all on function ideworks.assignable_people_for_task(uuid) from public;
grant execute on function ideworks.assignable_people_for_task(uuid) to ideworks_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A ESCRITA PASSA A CONFERIR A EMPRESA DE QUEM ENTRA
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function ideworks.set_task_assignees(p_task_id uuid, p_user_ids uuid[])
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_antes    uuid[];
  v_depois   uuid[];
  v_tirados  uuid[];
  v_postos   uuid[];
  v_list_id  uuid;
  v_client   uuid;
  v_novo     uuid;
begin
  -- ⚠️ A LISTA E O CLIENTE SAEM DA MESMA LEITURA QUE JA CONFERIA O ALCANCE DO
  -- ATOR. Duas leituras da mesma tarefa seriam duas chances de discordarem.
  select t.list_id, t.client_id into v_list_id, v_client
    from ideworks.tasks t
   where t.id = p_task_id
     and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute');

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  -- O RETRATO DE ANTES, e ele é tirado AQUI e não depois: a escrita é um
  -- apaga-e-põe, e depois dela não há mais de onde saber quem estava.
  select coalesce(array_agg(a.user_id order by a.user_id), '{}'::uuid[])
    into v_antes
    from ideworks.task_assignees a
   where a.task_id = p_task_id;

  -- ⚠️ A PAREDE POR EMPRESA — F17.69, e ela é a razão desta migration.
  --
  -- Só sobre quem NÃO ESTAVA LÁ. Tirar sempre pode; regravar o que já existe
  -- sempre pode. Guardar também os antigos travaria a única tarefa que hoje
  -- tem um vínculo fora da parede (1 em 553, medido) — e a escrita é de
  -- conjunto, então tirar UM responsável reenvia os outros.
  foreach v_novo in array coalesce(p_user_ids, '{}'::uuid[])
  loop
    if not (v_novo = any (v_antes)) then
      -- PERGUNTA 1 — "eu posso oferecer esta pessoa?" (F17.53).
      if not ideworks.can_assign_person(v_novo) then
        raise exception
          'Você não pode atribuir tarefa a % — essa pessoa está fora do seu alcance.',
          coalesce(ideworks.display_name(v_novo), 'essa pessoa')
          using errcode = '42501';
      end if;

      -- PERGUNTA 2 — "esta pessoa alcança a empresa DESTA tarefa?" (F17.41).
      -- Outra pergunta, e é a que faltava: duas pessoas da minha empresa podem
      -- não alcançar a mesma lista.
      if not ideworks.can_reach_task_for(v_novo, v_list_id, v_client) then
        raise exception
          '% não alcança a empresa desta tarefa, e por isso não pode ser responsável por ela.',
          coalesce(ideworks.display_name(v_novo), 'Essa pessoa')
          using errcode = '42501';
      end if;
    end if;
  end loop;

  delete from ideworks.task_assignees where task_id = p_task_id;

  -- `distinct` porque a tela pode mandar repetido, e a chave primaria recusaria
  -- com uma mensagem que ninguem entende.
  insert into ideworks.task_assignees (task_id, user_id)
  select p_task_id, u from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u
   where exists (select 1 from ideworks.profiles p where p.id = u)
   group by u;

  -- ⚠️ O RETRATO DE DEPOIS SAI DA TABELA, e não de `p_user_ids`. Esta função
  -- DESCARTA em silêncio quem não tem perfil no IDE Works — está no comentário
  -- dela desde a F4.8 —, e registrar o que foi PEDIDO em vez do que FICOU faria
  -- o livro afirmar uma atribuição que não existe. É o mesmo argumento de
  -- `patchBoardTask`, que relê a ficha depois de escrever.
  select coalesce(array_agg(a.user_id order by a.user_id), '{}'::uuid[])
    into v_depois
    from ideworks.task_assignees a
   where a.task_id = p_task_id;

  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_tirados
    from unnest(v_antes) as x where not (x = any (v_depois));

  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_postos
    from unnest(v_depois) as x where not (x = any (v_antes));

  -- REGRAVAR A MESMA LISTA NÃO É EVENTO. A restrição do banco recusaria a linha
  -- em branco; recusar aqui é o mesmo que ela diz, com a diferença de não
  -- abortar uma gravação legítima que só não mudou nada.
  if v_tirados <> '{}'::uuid[] or v_postos <> '{}'::uuid[] then
    insert into ideworks.task_events
      (task_id, automation_id, automation_name,
       removed_user_ids, added_user_ids, actor_id)
    values
      (p_task_id, null, null,
       v_tirados, v_postos, ideworks.acting_user_id());
  end if;
end;
$fn$;

comment on function ideworks.set_task_assignees(uuid, uuid[]) is
  'Troca o CONJUNTO de responsaveis de uma tarefa, e registra o que mudou em '
  'task_events (F17.65). Desde a F17.69 confere a empresa de QUEM ENTRA: '
  'can_assign_person (o ator pode oferecer) e can_reach_task_for (a pessoa '
  'alcanca a empresa daquela tarefa) — as duas, e so sobre ids que ainda nao '
  'estavam na tarefa, para nao travar vinculo antigo.';
