-- =============================================================================
-- ROLLBACK — F17.61b  A esteira tambem para de repetir a pergunta
-- =============================================================================
-- ⚠️ DESFAZER ISTO NAO MUDA RESPOSTA NENHUMA — MUDA O RELOGIO
--   `can_see_status_set` e `can_write_owner` voltam ao corpo da F17.54, cada uma
--   calculada uma vez por LINHA. Medido em 2026-09-03, como `ideworks_app`:
--
--     `left join lateral` de `list_workflow`  ~0,1 s  ->  ~2,2 s
--     rota `/board/tree/full`                 ~1,2 s  ->  ~2,7 s
--
--   `/board/tree/full` e paga em SEIS telas. Reverter isto custa 1,5 s em cada
--   abertura de quadro, de caixa de entrada e de "meu trabalho".
--
-- ORDEM
--   Primeiro o corpo antigo nas duas funcoes publicas — enquanto a memoria
--   existir, as `..._uncached` ainda estao sendo chamadas por elas. So depois as
--   funcoes separadas somem.
--
-- ⚠️ NAO HA ESTADO A LIMPAR
--   As GUCs `ideworks_statusset.*` e `ideworks_writeowner.*` foram gravadas com
--   `is_local`: morreram no fim de cada transacao.
-- =============================================================================

set local lock_timeout = '15s';

create or replace function ideworks.can_see_status_set(target uuid)
  returns boolean
  language sql stable security definer parallel unsafe
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.node_level(ss.space_id, ss.folder_id, ss.list_id) is not null
    from ideworks.status_sets ss
   where ss.id = target
$fn$;

comment on function ideworks.can_see_status_set(uuid) is
  'O alcance da esteira e o alcance do NO dela — espaco, pasta ou lista —, e nao '
  'uma segunda regra. Os status usam esta funcao para nao ter politica propria.';

create or replace function ideworks.can_write_owner(
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

comment on function ideworks.can_write_owner(uuid, uuid, uuid) is
  'Quem escreve o que pertence a um no. No ESPACO exige administrar o sistema E '
  'alcancar a empresa dele (F17.54 acrescentou a segunda metade, para nao '
  'existir "escreve mas nao ve"); em pasta e lista exige `manage` na corrente.';

drop function if exists ideworks.can_see_status_set_uncached(uuid);
drop function if exists ideworks.can_write_owner_uncached(uuid, uuid, uuid);
