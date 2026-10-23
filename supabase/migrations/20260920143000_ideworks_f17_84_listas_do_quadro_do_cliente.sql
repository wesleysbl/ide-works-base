-- =============================================================================
-- F17.84 — QUE LISTAS DO QUADRO SÃO DESTE CLIENTE
--
-- A PERGUNTA QUE A F17.43 DEIXOU SEM PORTA
--   `lists.client_id` e o índice `lists_client_idx` existem desde a F17.43.
--   Faltava o caminho de LEITURA: ficha, relatório e IA precisam da mesma
--   resposta, e `select * from lists where client_id = ?` NÃO serve.
--
-- POR QUE NÃO É UM SELECT SOB A POLÍTICA DA LISTA
--   `lists_select` pergunta `can_see_space`. Quem alcança o cliente e não
--   alcança o espaço da lista não veria a linha — o vínculo sumiria. O pedido
--   é o contrário: existência sem o nome. Inventar o nome revelaria trabalho
--   de um time que a pessoa não alcança.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ ELA É `SECURITY DEFINER` PARA VER O VÍNCULO, NÃO PARA DAR ALCANCE
--
--   Roda com os poderes do dono, então a política de `lists` não a recorta.
--   A guarda tem de ser perguntada de propósito, e ela é:
--
--     1. `can_see_client(p_client_id)` — sem alcance ao cadastro, zero linhas.
--        Não é 404 daqui: a rota de cima já recusou com a mesma frase do
--        detalhe. Aqui o recorte impede quem chamar a função direto de
--        enumerar listas de cliente alheio.
--     2. `can_see_space(space_id)` decide se o NOME aparece. Identificador,
--        arquivada e contagens saem mesmo assim: são o vínculo, não o quadro.
--        Nome de lista, de espaço e de pasta vão a nulo quando a resposta é
--        não. O vínculo NÃO passa a deixar a pessoa abrir o quadro.
--
--   `execute` só para `ideworks_app`. `public` não alcança.
--
-- A CONTAGEM É A MESMA DA ÁRVORE
--   Aberto = `archived_at is null and completed_at is null`.
--   Total  = `archived_at is null`.
--   É o que `readFullTree` já conta. Outra definição de "aberto" faria ficha
--   e quadro discordarem do mesmo cartão.
--
-- A ORDEM É POR ESPAÇO E DEPOIS POR NOME
--   Relatório e IA não podem receber a mesma pergunta em ordens diferentes
--   a cada chamada. Nomes nulos (espaço fora de alcance) ficam no fim do
--   grupo, desempatados pelo identificador.
-- =============================================================================

create or replace function ideworks.client_board_lists(p_client_id uuid)
  returns table (
    id uuid,
    name text,
    archived boolean,
    space_id uuid,
    space_name text,
    folder_id uuid,
    folder_name text,
    live_tasks integer,
    total_tasks integer
  )
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  select
    x.id,
    case when x.visivel then x.list_name else null end,
    x.archived,
    x.space_id,
    case when x.visivel then x.space_name else null end,
    x.folder_id,
    case when x.visivel then x.folder_name else null end,
    x.live_tasks,
    x.total_tasks
  from (
    select
      l.id,
      l.name as list_name,
      (l.archived_at is not null) as archived,
      l.space_id,
      s.name as space_name,
      l.folder_id,
      f.name as folder_name,
      ideworks.can_see_space(l.space_id) as visivel,
      (select count(*)::int from ideworks.tasks k
        where k.list_id = l.id
          and k.archived_at is null
          and k.completed_at is null) as live_tasks,
      (select count(*)::int from ideworks.tasks k
        where k.list_id = l.id
          and k.archived_at is null) as total_tasks
      from ideworks.lists l
      join ideworks.spaces s on s.id = l.space_id
      left join ideworks.folders f on f.id = l.folder_id
     where l.client_id = p_client_id
       and ideworks.can_see_client(p_client_id)
  ) x
  order by
    case when x.visivel then lower(x.space_name) end nulls last,
    x.space_id,
    case when x.visivel then lower(x.list_name) end nulls last,
    x.id
$fn$;

comment on function ideworks.client_board_lists(uuid) is
  'Que listas do quadro sao deste cliente — F17.84. Security definer para o '
  'vinculo aparecer mesmo quando can_see_space e falso; o NOME (lista, espaco, '
  'pasta) so sai quando a pessoa alcanca o espaco. NAO da alcance: quem nao '
  'via o quadro continua sem ve-lo. Contagem igual a da arvore: aberto = nao '
  'arquivada e nao concluida. Recortada por can_see_client.';

revoke all on function ideworks.client_board_lists(uuid) from public;
grant execute on function ideworks.client_board_lists(uuid) to ideworks_app;
