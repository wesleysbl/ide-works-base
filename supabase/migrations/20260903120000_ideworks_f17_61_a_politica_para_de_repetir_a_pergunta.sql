-- =============================================================================
-- IDE WORKS — F17.61  A politica para de repetir a mesma pergunta
-- =============================================================================
-- O QUE MUDA, EM UMA FRASE
--   `can_reach_task` responde EXATAMENTE a mesma coisa. So deixa de calcular a
--   resposta uma vez por LINHA e passa a calcula-la uma vez por PAR distinto
--   (lista, cliente) dentro do mesmo comando.
--
-- ⚠️ ISTO NAO AFROUXA NADA
--   A regra continua sendo a mesma funcao, com o mesmo corpo, com os mesmos
--   `security definer` e `set search_path`: ela agora se chama
--   `can_reach_task_uncached` e nao foi tocada em uma virgula. A F17.50 recusou
--   trocar velocidade por vazamento e continua certa — o que ela nao viu e que
--   nao era preciso escolher.
--
-- POR QUE O PAR BASTA
--   `can_reach_task(p_list_id, p_client_id)` so olha para esses dois valores,
--   para os tres GUCs de quem age e para o dado do banco. Duas tarefas da mesma
--   lista e do mesmo cliente sempre tiveram o mesmo veredito. Medido em
--   2026-09-03, no banco de producao, como `ideworks_app`:
--
--     1.774 tarefas nao arquivadas  ->  109 pares distintos (lista, cliente)
--     as mesmas 1.774 avaliacoes, direto ....... 2.812 ms
--     as mesmas 1.774 avaliacoes, com memoria ..   281 ms   (10x)
--
-- A MEMORIA E DO COMANDO, NAO DA TRANSACAO — E ISSO E A PROVA DE QUE NADA MUDA
--   A funcao e `stable`: o Postgres ja promete que, DENTRO DE UM COMANDO, ela
--   devolve o mesmo valor para os mesmos argumentos. Entao guardar a resposta
--   dentro do comando nao pode mudar resposta nenhuma — nao e uma aposta, e a
--   definicao de `stable`.
--
--   A marca guardada junto do valor e
--     statement_timestamp() || app.user_id || app.is_superadmin || app.is_super
--   e ela e conferida antes de cada acerto. Comando novo, marca nova, memoria
--   morta. Ator novo, marca nova, memoria morta.
--
--   ⚠️ ERA ESTA A ARMADILHA DA F17.32: memoria por TRANSACAO responderia
--   `false` para uma lista criada no meio da transacao — e uma tarefa criada
--   com `insert ... returning` sumiria na volta. Por comando, nao some: o
--   `insert` e outro comando, com outra marca.
--
-- ONDE A MEMORIA MORA
--   Em GUCs de sessao com o prefixo `ideworks_reach.`, gravadas com
--   `set_config(..., is_local => true)`. `is_local` faz o banco devolve-las no
--   fim da transacao, de modo que uma conexao do pooler nunca leva memoria de
--   um pedido para o proximo — cinto alem do suspensorio, porque a marca ja
--   impediria o acerto. O numero de chaves e limitado pelos pares distintos que
--   existem em `tasks` (109 hoje), nao pelo numero de linhas nem de pedidos.
--
-- ⚠️ `parallel unsafe`, DE PROPOSITO E EXPLICITO
--   `set_config` nao pode rodar em processo auxiliar de consulta paralela. A
--   funcao ja era `parallel unsafe` por omissao desde a F17.3; aqui isso vira
--   declaracao escrita, porque agora ha um motivo duro para nao mexer.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   Nao cria tabela (nada de RLS a ligar), nao toca em `can_see_list`,
--   `can_see_client`, `node_ceiling`, `reaches_company` nem em politica alguma.
--   `tasks_select` continua com o texto `can_reach_task(list_id, client_id)`.
-- =============================================================================

set local lock_timeout = '15s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A REGRA, INTACTA — o corpo que era `can_reach_task` ate a F17.54b
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function ideworks.can_reach_task_uncached(
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

comment on function ideworks.can_reach_task_uncached(uuid, uuid) is
  'A regra de alcance de tarefa, calculada do zero. E o corpo que era '
  '`can_reach_task` ate a F17.61, palavra por palavra. Quem responde ao mundo '
  'continua sendo `can_reach_task`, que so acrescenta memoria por comando. '
  'Existe separada para que a prova da F17.61 possa comparar as duas linha a '
  'linha, e para que "a regra" tenha um lugar so.';

grant execute on function ideworks.can_reach_task_uncached(uuid, uuid) to ideworks_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A MESMA REGRA, PERGUNTADA UMA VEZ POR PAR
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function ideworks.can_reach_task(
  p_list_id uuid, p_client_id uuid)
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
  -- A marca do comando e de quem pergunta. Muda o comando, morre a memoria.
  marca := pg_catalog.statement_timestamp()::text
        || coalesce(pg_catalog.current_setting('app.user_id', true), '')
        || coalesce(pg_catalog.current_setting('app.is_superadmin', true), '')
        || coalesce(pg_catalog.current_setting('app.is_super', true), '');

  -- Nome de GUC precisa ser identificador: o par vira resumo hexadecimal.
  chave := 'ideworks_reach.k' || pg_catalog.md5(
             coalesce(p_list_id::text, '') || coalesce(p_client_id::text, ''));

  lido := pg_catalog.current_setting(chave, true);
  if lido = marca || 't' then return true;  end if;
  if lido = marca || 'f' then return false; end if;

  resposta := ideworks.can_reach_task_uncached(p_list_id, p_client_id);

  -- Nulo nao se guarda: guardar "nao sei" seria inventar resposta.
  if resposta is not null then
    perform pg_catalog.set_config(
      chave, marca || (case when resposta then 't' else 'f' end), true);
  end if;
  return resposta;
end
$fn$;

comment on function ideworks.can_reach_task(uuid, uuid) is
  'Quem alcanca uma tarefa. A regra e `can_reach_task_uncached`; esta funcao so '
  'evita perguntar duas vezes pelo mesmo par (lista, cliente) dentro do mesmo '
  'comando. A memoria vale por COMANDO, que e o mesmo alcance que `stable` ja '
  'promete — por isso a resposta e identica, tarefa por tarefa. F17.61.';
