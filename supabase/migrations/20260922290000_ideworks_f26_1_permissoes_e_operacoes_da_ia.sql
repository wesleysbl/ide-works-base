-- =============================================================================
-- IDE WORKS — F26.1  O banco aprende as permissões e as operações novas da IA
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   A concessão passa a aceitar cinco permissões de escrita novas, e o registro
--   da integração e as aprovações passam a aceitar nove operações novas. Nada
--   do que existe muda de sentido: as duas escritas antigas continuam com as
--   mesmas dependências, e o registro continua compacto e com alvo obrigatório.
--
-- AS CINCO PERMISSÕES, E O QUE CADA UMA ARRASTA
--   tasks:write            criar e editar tarefa      exige tasks:read + boards:read
--   tasks:assign           trocar responsáveis        exige tasks:read + boards:read
--   tasks:complete         concluir e reabrir         exige tasks:read + boards:read
--   clients:mural:write    nota no mural do cliente   exige clients:read
--   clients:history:write  registro no histórico      exige clients:read
--   Tarefa mora num quadro e numa lista: escrever nela sem enxergar o quadro
--   seria escrever às cegas — a mesma razão de `tasks:move` (F16.1). Mural e
--   histórico são do cliente: sem `clients:read` a IA não sabe em qual escreve.
--   Como na F16.1, a recusa é no CHECK, e não um ajuste silencioso que
--   completaria a leitura por trás do consentimento.
--
-- AS NOVE OPERAÇÕES
--   create_task, update_task, assign_task, complete_task, reopen_task,
--   add_mural_note, update_mural_note, add_history_entry, update_history_entry.
--   Nenhuma delas ainda sai pelo MCP nem pela HTTP: esta etapa só abre o banco
--   (F26 fases 5 e 6). O alvo continua `uuid not null` — a tarefa, a nota ou o
--   registro — e o resultado continua proibido de carregar `body`, `content`
--   ou `text` (f16c). Esta migration não toca em nenhuma dessas duas regras.
--
-- POR QUE AS CHECAGENS COMPARAM TEXTO, E NÃO O VALOR DO ENUM
--   `alter type ... add value` pode rodar dentro de transação (Postgres ≥ 12),
--   mas o valor novo NÃO pode ser usado na mesma transação: um literal
--   `'tasks:write'::ideworks.integration_capability` dá 55P04 "unsafe use of
--   new value" até o commit. E esta migration roda inteira numa transação só:
--   pelo `begin` abaixo, e porque `supabase db query --linked -f` manda o
--   arquivo inteiro numa chamada só à Management API. Separar em dois arquivos
--   resolveria, mas deixaria o banco, entre um e outro, aceitando `tasks:write`
--   sem exigir leitura nenhuma.
--   Então o CHECK compara `capabilities::text[]` com texto — o mesmo molde de
--   `integration_allows_capability` (F16.1). A conversão enum → texto não
--   "usa" o valor novo no sentido do 55P04, e tudo entra num commit só.
--   O preço é que um erro de digitação no texto não quebraria sozinho: por
--   isso o bloco `do` no fim confere que cada nome citado nas checagens existe
--   no enum, e aborta a migration inteira se algum não existir.
--
-- O QUE ESTA MIGRATION NÃO FAZ
--   Não altera linha nenhuma. Não oferece as permissões na tela de
--   consentimento (F26 fase 4) nem cria ferramenta (fases 5 e 6). O índice
--   parcial do desfazer (F21.2, `operation = 'add_comment'`) fica como está: o
--   que se desfaz é assunto da fase 8.
-- =============================================================================

begin;
set local lock_timeout = '15s';

-- --- as cinco permissões -----------------------------------------------------
-- `if not exists` deixa a migration reaplicável depois do rollback, que
-- recria o tipo sem elas. A ordem de inclusão é a ordem do enum e a da lista
-- no TypeScript: as nove da F16.1 primeiro, estas cinco depois.

alter type ideworks.integration_capability add value if not exists 'tasks:write';
alter type ideworks.integration_capability add value if not exists 'tasks:assign';
alter type ideworks.integration_capability add value if not exists 'tasks:complete';
alter type ideworks.integration_capability add value if not exists 'clients:mural:write';
alter type ideworks.integration_capability add value if not exists 'clients:history:write';

comment on type ideworks.integration_capability is
  'Capacidades operacionais da integração. Escrita exige a leitura do mesmo '
  'recurso; o CHECK da tabela é que recusa o par incompleto. F26.1 acrescentou '
  'tasks:write, tasks:assign, tasks:complete, clients:mural:write e '
  'clients:history:write.';

-- --- escrita implica leitura -------------------------------------------------
-- Um `alter table` só: tira a checagem antiga e põe a nova na mesma instrução,
-- então não existe instante em que a tabela fique sem nenhuma das duas. As
-- linhas existentes são validadas na hora — e passam, porque as duas regras
-- antigas estão aqui idênticas e ninguém tem ainda permissão nova.
--
-- `&&` lê "tem alguma destas"; `@>` lê "tem todas estas".

alter table ideworks.integration_grants
  drop constraint integration_grants_write_implies_read,
  add constraint integration_grants_write_implies_read check (
    (
      -- F16.1: comentar identifica a tarefa.
      not ('comments:write' = any (capabilities::text[]))
      or capabilities::text[] @> array['comments:read', 'tasks:read']
    )
    and (
      -- F16.1 (tasks:move) + F26.1: toda escrita de tarefa é operação de quadro.
      not (capabilities::text[] && array['tasks:move', 'tasks:write', 'tasks:assign', 'tasks:complete'])
      or capabilities::text[] @> array['tasks:read', 'boards:read']
    )
    and (
      -- F26.1: mural e histórico são do cliente.
      not (capabilities::text[] && array['clients:mural:write', 'clients:history:write'])
      or capabilities::text[] @> array['clients:read']
    )
  );

-- --- operações do registro e das aprovações ---------------------------------
-- Lista fechada, como na f16c: operação desconhecida quebra na gravação, não
-- vira uma linha que a tela de Conexões não sabe rotular.

alter table ideworks.integration_executions
  drop constraint integration_executions_operation_sane,
  add constraint integration_executions_operation_sane check (
    operation in (
      'add_comment',
      'move_task',
      'create_task',
      'update_task',
      'assign_task',
      'complete_task',
      'reopen_task',
      'add_mural_note',
      'update_mural_note',
      'add_history_entry',
      'update_history_entry'
    )
  );

alter table ideworks.integration_write_approvals
  drop constraint integration_write_approvals_operation_sane,
  add constraint integration_write_approvals_operation_sane check (
    operation in (
      'add_comment',
      'move_task',
      'create_task',
      'update_task',
      'assign_task',
      'complete_task',
      'reopen_task',
      'add_mural_note',
      'update_mural_note',
      'add_history_entry',
      'update_history_entry'
    )
  );

-- --- a trava contra erro de digitação ----------------------------------------
-- As checagens acima comparam texto (ver o cabeçalho). Se alguém escrever
-- 'task:write' ali, o CHECK aceitaria a concessão sem exigir leitura, calado.
-- Aqui a definição GRAVADA da checagem é relida do catálogo, cada nome de
-- permissão citado nela é extraído, e cada um é conferido contra o enum de
-- verdade, lido direto de `pg_enum`. Não dá para usar `enum_range` nesta
-- transação: ele também esbarra no 55P04 com os valores recém-incluídos
-- (medido sob PGlite, 22/09).

do $chk$
declare
  v_enum text[] := (
    select array_agg(e.enumlabel::text order by e.enumsortorder)
      from pg_enum e
     where e.enumtypid = 'ideworks.integration_capability'::regtype
  );
  v_def text := (
    select pg_get_constraintdef(c.oid)
      from pg_constraint c
     where c.conrelid = 'ideworks.integration_grants'::regclass
       and c.conname = 'integration_grants_write_implies_read'
  );
  v_citadas text[];
  v_fora text[];
begin
  select array_agg(distinct m[1]) into v_citadas
    from regexp_matches(v_def, '''([a-z_]+(?::[a-z_]+)+)''', 'g') as m;
  if cardinality(v_citadas) is distinct from 11 then
    raise exception 'F26.1: a checagem devia citar 11 permissões e cita %', v_citadas;
  end if;
  select array_agg(c) into v_fora from unnest(v_citadas) c where c <> all (v_enum);
  if v_fora is not null then
    raise exception 'F26.1: a checagem cita permissão que não existe no enum: %', v_fora;
  end if;
  if cardinality(v_enum) <> 14 then
    raise exception 'F26.1: o enum devia ter 14 permissões e tem %: %', cardinality(v_enum), v_enum;
  end if;
end
$chk$;

commit;
