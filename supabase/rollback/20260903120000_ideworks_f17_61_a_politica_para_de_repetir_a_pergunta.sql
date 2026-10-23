-- =============================================================================
-- ROLLBACK — F17.61  A politica para de repetir a mesma pergunta
-- =============================================================================
-- ⚠️ DESFAZER ISTO NAO MUDA RESPOSTA NENHUMA — MUDA O RELOGIO
--   `can_reach_task` volta ao corpo da F17.54b, calculado uma vez por LINHA.
--   Medido em 2026-09-03, no banco de producao, como `ideworks_app`:
--
--     barra lateral (`/board/tree/full`)  ~0,5 s  ->  ~3,3 s
--     `Todas as tarefas`                  ~6 s    ->  ~14 s
--
--   E o teto de `statement_timeout = 30s` volta a ficar a 2,1x do acervo de
--   hoje em vez de a mais de 5x. Reverter e escolher voltar para a beira.
--
-- ORDEM
--   Primeiro o corpo antigo em `can_reach_task` — enquanto a memoria existir,
--   `can_reach_task_uncached` ainda esta sendo chamada por ela. So depois a
--   funcao separada some.
--
-- ⚠️ AS GUCs `ideworks_reach.*` NAO PRECISAM DE LIMPEZA
--   Foram gravadas com `is_local`, entao morreram no fim de cada transacao.
--   Nao ha estado a desfazer no banco: a memoria nunca chegou a existir fora de
--   um comando.
-- =============================================================================

set local lock_timeout = '15s';

create or replace function ideworks.can_reach_task(
  p_list_id uuid, p_client_id uuid)
  returns boolean
  language sql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
  select ((p_list_id   is not null and ideworks.can_see_list(p_list_id))
       or (p_client_id is not null and ideworks.can_see_client(p_client_id)))
     and (p_list_id is null
          or ideworks.node_ceiling(null, null, p_list_id) is not null)
$fn$;

comment on function ideworks.can_reach_task(uuid, uuid) is
  'A regra de alcance da tarefa, num lugar so: enxerga quem enxerga a LISTA '
  'dela; quando ela tem CLIENTE, o alcance do cliente tambem vale. Uniao, e nao '
  'intersecao — recusar o segundo caminho esconderia trabalho de quem o faz. A '
  'restricao de no e um TETO sobre as duas portas, e nao uma terceira porta.';

drop function if exists ideworks.can_reach_task_uncached(uuid, uuid);
