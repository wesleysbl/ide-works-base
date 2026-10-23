-- =============================================================================
-- IDE WORKS — F44_6  Concluir e reabrir a tarefa são arrastar o cartão
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   `ideworks.complete_task` e `ideworks.uncomplete_task`, quando a tarefa está
--   num quadro, deixam de trocar a etapa por conta própria e passam a chamar
--   `ideworks.move_task` para a etapa que FECHA (concluir) ou para a PRIMEIRA
--   QUE ABRE (reabrir). Com isso, concluir pela ficha, pela página do cliente
--   ou pela IA grava o histórico (`task_events`) e roda a automação da etapa —
--   exatamente o que arrastar o cartão para aquela coluna já fazia.
--
-- POR QUE (achado da conferência de 08–09/10/2026, plano F44, Fase 8)
--   As duas funções escreviam `status_id` direto, com um `update` próprio. A
--   F17.65 registrou isso como dívida medida ("continuam sem deixar evento") e
--   a conferência mostrou o efeito: a mesma tarefa, concluída pelo botão da
--   ficha, não aparecia no histórico e não disparava "ao fechar, atribuir X";
--   arrastada para a coluna que fecha, aparecia e disparava. Duas verdades
--   sobre o mesmo gesto. A decisão (Wesley, 09/10, "segue o plano"): concluir
--   e reabrir usam o MESMO caminho de `move_task` — automação + histórico.
--
-- COMO FICA CADA CAMINHO
--   concluir, tarefa num quadro, fora da etapa que fecha
--       antes: `update` direto para a etapa que fecha, sem evento nem automação
--       agora: `move_task(tarefa, a lista dela, a etapa que fecha)` — o evento
--              "à mão" com quem age, e a automação daquela etapa, se houver.
--              O gatilho `tasks_status_guard` carimba a conclusão, como no
--              arrasto. Se a automação levar a tarefa para outra lista (ou
--              para uma etapa que abre), o resultado é o do arrasto: a tarefa
--              fica onde a regra a pôs, e a ficha relida mostra isso.
--   reabrir, tarefa num quadro, fora da primeira etapa que abre
--       antes: `update` direto para a primeira que abre
--       agora: `move_task(tarefa, a lista dela, a primeira que abre)` — evento
--              e automação daquela etapa, se houver. O gatilho limpa a
--              conclusão (etapa que não fecha não tem conclusão).
--   tarefa JÁ na etapa de destino (concluir o que já está concluído; reabrir o
--   que já está na primeira que abre), e demanda SEM quadro (`list_id` nulo,
--   F4.8)
--       igual a antes: o `update` da F17.23, sem `move_task`. Na etapa de
--       destino não há chegada — o arrasto que solta o cartão na coluna de onde
--       saiu também não grava evento nem roda regra —, e não se toca nas
--       subtarefas à toa. Na demanda sem quadro não há etapa nem automação.
--
-- O AUTOR DA CONCLUSÃO CONTINUA SENDO `p_by`
--   No arrasto, o gatilho carimba `completed_by` com quem age
--   (`acting_user_id()`). Aqui quem chama já passa o autor (a tela, a pessoa
--   logada; a IA, o dono da concessão — os mesmos que `acting_user_id()` na
--   prática). Para o contrato de `p_by` não mudar, depois do `move_task` o
--   autor é regravado com `p_by` quando a conclusão nasceu nesta chamada e
--   ainda está de pé (a automação pode ter levado a tarefa para uma etapa que
--   abre — aí não há conclusão a assinar).
--
-- ⚠️ `security definer` → `security invoker`, E POR QUÊ
--   As duas eram `definer` desde a F4.8 e conferiam o alcance por dentro
--   (`can_act_on_task(..., 'execute')`). Mantidas assim, o `move_task` chamado
--   de dentro rodaria como o DONO das tabelas, sem política de linha: a
--   automação poderia levar a tarefa para uma lista onde a pessoa só VÊ (o
--   `move_task` só confere `can_see_list` no destino da regra), e o arrasto do
--   mesmo cartão é recusado pela política `tasks_update` nesse caso. "O mesmo
--   resultado de arrastar" pede a mesma política. Como `invoker`:
--     · a escrita da própria tarefa passa por `tasks_update`, cujo texto é
--       EXATAMENTE a conferência que a função fazia — `can_act_on_task(list_id,
--       client_id, 'execute')` —, nos dois lados (`using` e `with check`);
--     · a conferência explícita continua no `where`, para a recusa sair com a
--       mesma frase e o mesmo `42501`, e para valer também quando quem chama
--       não passa pela política (o dono, no editor de SQL);
--     · a tranca das conexões de IA (F44_2, políticas restritivas) passa a
--       valer aqui também — a F44_2 listou estas duas entre as `definer` que a
--       ignoravam;
--     · demanda sem quadro: a mesma política, com `list_id` nulo, é a mesma
--       conferência de antes. `ideworks_app` tem `update` na tabela inteira.
--
-- O QUE NÃO MUDA
--   Assinaturas, retorno (`void`), `search_path`, dono e permissões (o
--   `create or replace` preserva a lista de quem executa). `move_task`,
--   `closing_status`, `first_open_status` e o gatilho do status: intocados. A
--   subtarefa não é concluída junto (como antes, e como no arrasto).
--
-- PAR COM O WORKER
--   Nenhum. As rotas (`/board/tasks/:id/completion`, `/tasks/:id/completion`)
--   e as ferramentas `complete_task`/`reopen_task` chamam as mesmas funções com
--   os mesmos argumentos; o Worker atual funciona com esta migration. O código
--   da F44 Fase 8 (tradução das recusas novas na página do cliente, recorte da
--   conexão depois da automação no MCP, desfazer em lote) pode ir antes ou
--   depois.
--
-- TRAVAS: numa transação, com `lock_timeout` de 5 s — redefinir as funções
-- disputa com o quadro em uso; melhor falhar e repetir do que enfileirar.
--
-- IDEMPOTENTE. REVERSÃO: `supabase/rollback/20261009140000_ideworks_f44_6_concluir_como_mover.sql`
-- (devolve as duas funções da F17.23, `security definer`). Depois de aplicar ou
-- reverter: `node scripts/conferir-schema.mjs --gravar`.
-- =============================================================================

begin;
set local lock_timeout = '5s';

create or replace function ideworks.complete_task(p_task_id uuid, p_by uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_lista     uuid;
  v_status    uuid;
  v_concluida boolean;
  v_set       uuid;
  v_fecha     uuid;
begin
  -- A linha TRAVADA: dois cliques simultâneos não disparam a automação duas
  -- vezes. O segundo espera, relê a tarefa já na etapa que fecha e não move.
  select t.list_id, t.status_id, t.completed_at is not null
    into v_lista, v_status, v_concluida
    from ideworks.tasks t
   where t.id = p_task_id
     and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
     for update of t;

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  if v_lista is not null then
    v_set := ideworks.resolve_status_set(v_lista);
    -- Toda lista com tarefa tem esteira (o gatilho do status recusa a que não
    -- tem), e toda esteira tem exatamente uma etapa que fecha (F17.2). Nulo
    -- aqui é a esteira que quem age não enxerga — e o arrasto também pararia.
    if v_set is null then
      raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
    end if;
    v_fecha := ideworks.closing_status(v_set);
  end if;

  if v_fecha is not null and v_status is distinct from v_fecha then
    -- O MESMO GESTO DE ARRASTAR para a coluna que fecha: evento à mão,
    -- automação da etapa, subárvore junto, recusas iguais.
    perform ideworks.move_task(p_task_id, v_lista, v_fecha);

    -- O autor é `p_by`, como sempre foi. O gatilho assinou com quem age; aqui
    -- só se troca se for outro, e só se a conclusão nasceu agora e continua de
    -- pé depois da automação.
    if not v_concluida then
      update ideworks.tasks t
         set completed_by = p_by
       where t.id = p_task_id
         and t.completed_at is not null
         and t.completed_by is distinct from p_by;
    end if;
    return;
  end if;

  -- Demanda sem quadro, ou tarefa já na etapa que fecha: o carimbo da F17.23,
  -- sem `move_task` — não há chegada a registrar nem regra a disparar.
  update ideworks.tasks t
     set completed_at = coalesce(t.completed_at, now()),
         completed_by = coalesce(t.completed_by, p_by),
         updated_at   = now()
   where t.id = p_task_id;
end;
$fn$;

comment on function ideworks.complete_task(uuid, uuid) is
  'Conclui a tarefa. No quadro e o arrasto para a etapa que fecha (move_task: '
  'evento no historico e automacao da etapa); ja na etapa que fecha, ou sem '
  'quadro, so carimba. O autor da conclusao e p_by. Recusa 42501 fora do '
  'alcance (execute).';

create or replace function ideworks.uncomplete_task(p_task_id uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_lista  uuid;
  v_status uuid;
  v_set    uuid;
  v_abre   uuid;
begin
  -- Desmarcar num quadro devolve a tarefa ao comeco da esteira. Deixa-la no
  -- status que fecha com `completed_at` nulo criaria a tarefa "concluida na
  -- coluna, nao concluida na ficha" — a contradicao que este desenho evita.
  select t.list_id, t.status_id
    into v_lista, v_status
    from ideworks.tasks t
   where t.id = p_task_id
     and ideworks.can_act_on_task(t.list_id, t.client_id, 'execute')
     for update of t;

  if not found then
    raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
  end if;

  if v_lista is not null then
    v_set := ideworks.resolve_status_set(v_lista);
    if v_set is null then
      raise exception 'tarefa nao encontrada ou fora do seu alcance' using errcode = '42501';
    end if;
    v_abre := ideworks.first_open_status(v_set);
    -- Antes, a esteira só com a etapa que fecha deixava a tarefa onde estava e
    -- o gatilho recarimbava a conclusão: reabrir não fazia nada, em silêncio.
    -- O arrasto recusa alto; aqui também.
    if v_abre is null then
      raise exception 'a esteira desta lista nao tem nenhum status que abra: so ha o que fecha. Acrescente ao menos um status que abra para poder reabrir a tarefa.'
        using errcode = '22023';
    end if;
  end if;

  if v_abre is not null and v_status is distinct from v_abre then
    -- O MESMO GESTO DE ARRASTAR para a primeira coluna que abre. O gatilho do
    -- status limpa a conclusão (e o autor dela) ao sair da etapa que fecha.
    perform ideworks.move_task(p_task_id, v_lista, v_abre);
    return;
  end if;

  -- Demanda sem quadro, ou tarefa já na primeira que abre: o `update` da
  -- F17.23, sem `move_task`.
  update ideworks.tasks t
     set completed_at = null,
         completed_by = null,
         updated_at   = now()
   where t.id = p_task_id;
end;
$fn$;

comment on function ideworks.uncomplete_task(uuid) is
  'Reabre a tarefa. No quadro e o arrasto para a primeira etapa que abre '
  '(move_task: evento no historico e automacao da etapa); ja nela, ou sem '
  'quadro, so limpa a conclusao. Recusa 42501 fora do alcance (execute).';

-- O `create or replace` preserva quem executa; reafirmar não muda nada e deixa
-- a intenção escrita.
grant execute on function ideworks.complete_task(uuid, uuid) to ideworks_app;
grant execute on function ideworks.uncomplete_task(uuid)     to ideworks_app;

commit;
