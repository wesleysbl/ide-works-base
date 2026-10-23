-- =============================================================================
-- IDE WORKS — F17.61b  A esteira tambem para de repetir a pergunta
-- =============================================================================
-- O QUE A F17.61 DESCOBRIU DEPOIS DE CONSERTAR O CONTADOR
--   Com `can_reach_task` memoizada, a barra lateral caiu de 5,7 s para 2,7 s —
--   e o que sobrou NAO e o numerozinho cinza. Medido em 2026-09-03, como
--   `ideworks_app`, dentro da consulta de `readFullTree`:
--
--     as duas subconsultas de contagem ..........  3.297 ms -> 228 ms
--     o `left join lateral` de `list_workflow` .. 2.204 ms   (80% do que sobrou)
--
--   E o custo do lateral e uma repeticao, exatamente como a das tarefas:
--   `status_sets` tem 24 linhas e a politica dela custa 38 ms para varrer as 24
--   (1,6 ms por linha). O lateral roda uma vez por LISTA — 40 vezes — e
--   `resolve_status_set` le `status_sets` de novo por dentro. Sao as MESMAS 24
--   respostas, calculadas ~960 vezes.
--
-- O QUE MUDA
--   `can_see_status_set` e `can_write_owner` — as duas metades da politica
--   `status_sets_select` — ganham a mesma memoria por comando da F17.61. As
--   regras vao inteiras para `..._uncached`, sem uma virgula mudada.
--
-- ⚠️ AQUI A MEMORIA GUARDA TRES ESTADOS, E NAO DOIS
--   `can_reach_task` nunca responde nulo, entao a F17.61 nao precisou guardar
--   "nao sei". `can_write_owner` responde nulo de verdade: quando o no nao tem
--   nivel, `node_level(...) >= 'manage'` e nulo. Guardar so `true`/`false` faria
--   a memoria errar o alvo justamente para quem NAO administra — cada linha
--   voltaria a recalcular — e o `or` da politica leria a mesma coisa. Por isso o
--   valor guardado tem tres letras possiveis: `t`, `f` e `n`.
--
--   Nulo memoizado continua sendo nulo devolvido. Nenhuma resposta muda.
--
-- POR QUE ISTO NAO AFROUXA NADA (mesmo argumento da F17.61)
--   As duas funcoes sao `stable`: o Postgres ja promete resposta constante para
--   os mesmos argumentos DENTRO DE UM COMANDO. A marca guardada junto do valor
--   e `statement_timestamp()` mais os tres GUCs de quem age; comando novo, marca
--   nova, memoria morta. Guardar dentro do comando nao pode mudar resposta.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria tabela, nao toca em politica nenhuma, nao muda `node_level`,
--   `reaches_company`, `acting_is_superadmin` nem `resolve_status_set`.
-- =============================================================================

set local lock_timeout = '15s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AS DUAS REGRAS, INTACTAS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function ideworks.can_see_status_set_uncached(target uuid)
  returns boolean
  language sql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_level(ss.space_id, ss.folder_id, ss.list_id) is not null
    from ideworks.status_sets ss
   where ss.id = target
$fn$;

comment on function ideworks.can_see_status_set_uncached(uuid) is
  'A regra de alcance do conjunto de status, calculada do zero. E o corpo que '
  'era `can_see_status_set` ate a F17.61b, palavra por palavra.';

grant execute on function ideworks.can_see_status_set_uncached(uuid) to ideworks_app;

create or replace function ideworks.can_write_owner_uncached(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns boolean
  language sql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
  select case
           when p_space_id is not null
             then ideworks.acting_is_superadmin()
                  and ideworks.reaches_company(p_space_id)
           else ideworks.node_level(p_space_id, p_folder_id, p_list_id)
                  >= 'manage'::ideworks.access_level
         end
$fn$;

comment on function ideworks.can_write_owner_uncached(uuid, uuid, uuid) is
  'A regra de escrita no dono de um no, calculada do zero. E o corpo que era '
  '`can_write_owner` ate a F17.61b, palavra por palavra. Responde NULO quando o '
  'no nao tem nivel — e por isso a memoria da F17.61b guarda tres estados.';

grant execute on function ideworks.can_write_owner_uncached(uuid, uuid, uuid) to ideworks_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AS MESMAS REGRAS, PERGUNTADAS UMA VEZ POR ARGUMENTO
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function ideworks.can_see_status_set(target uuid)
  returns boolean
  language plpgsql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
declare
  marca    text;
  chave    text;
  lido     text;
  resposta boolean;
begin
  marca := pg_catalog.statement_timestamp()::text
        || coalesce(pg_catalog.current_setting('app.user_id', true), '')
        || coalesce(pg_catalog.current_setting('app.is_superadmin', true), '')
        || coalesce(pg_catalog.current_setting('app.is_super', true), '');

  chave := 'ideworks_statusset.k' || pg_catalog.md5(coalesce(target::text, ''));

  lido := pg_catalog.current_setting(chave, true);
  if lido = marca || 't' then return true;  end if;
  if lido = marca || 'f' then return false; end if;
  if lido = marca || 'n' then return null;  end if;

  resposta := ideworks.can_see_status_set_uncached(target);

  perform pg_catalog.set_config(chave, marca ||
    (case when resposta is null then 'n' when resposta then 't' else 'f' end), true);
  return resposta;
end
$fn$;

comment on function ideworks.can_see_status_set(uuid) is
  'Quem alcanca um conjunto de status. A regra e '
  '`can_see_status_set_uncached`; esta funcao so evita perguntar duas vezes '
  'pelo mesmo conjunto dentro do mesmo comando — o `left join lateral` de '
  '`list_workflow` perguntava as mesmas 24 respostas 40 vezes. F17.61b.';

create or replace function ideworks.can_write_owner(
  p_space_id uuid, p_folder_id uuid, p_list_id uuid)
  returns boolean
  language plpgsql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
declare
  marca    text;
  chave    text;
  lido     text;
  resposta boolean;
begin
  marca := pg_catalog.statement_timestamp()::text
        || coalesce(pg_catalog.current_setting('app.user_id', true), '')
        || coalesce(pg_catalog.current_setting('app.is_superadmin', true), '')
        || coalesce(pg_catalog.current_setting('app.is_super', true), '');

  chave := 'ideworks_writeowner.k' || pg_catalog.md5(
             coalesce(p_space_id::text, '') || '.' ||
             coalesce(p_folder_id::text, '') || '.' ||
             coalesce(p_list_id::text, ''));

  lido := pg_catalog.current_setting(chave, true);
  if lido = marca || 't' then return true;  end if;
  if lido = marca || 'f' then return false; end if;
  if lido = marca || 'n' then return null;  end if;

  resposta := ideworks.can_write_owner_uncached(p_space_id, p_folder_id, p_list_id);

  perform pg_catalog.set_config(chave, marca ||
    (case when resposta is null then 'n' when resposta then 't' else 'f' end), true);
  return resposta;
end
$fn$;

comment on function ideworks.can_write_owner(uuid, uuid, uuid) is
  'Quem escreve no dono de um no. A regra e `can_write_owner_uncached`; esta '
  'funcao so evita perguntar duas vezes pelo mesmo no dentro do mesmo comando. '
  'Guarda tambem o NULO, que aqui e resposta legitima. F17.61b.';
