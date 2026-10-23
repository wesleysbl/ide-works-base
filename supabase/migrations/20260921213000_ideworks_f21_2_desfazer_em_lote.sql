-- =============================================================================
-- IDE WORKS — F21.2  Desfazer em lote as escritas de um agente
-- =============================================================================
-- O PEDIDO
--   O dono limpar de uma vez o que uma concessão publicou, sem caçar
--   comentário por comentário na conversa de cada tarefa.
--
-- O COMENTÁRIO SOME; O FATO DE TER EXISTIDO, NÃO
--   Desfazer apaga o comentário de verdade — é o que a pessoa pede quando diz
--   "tira isso daí". Mas a linha do ledger FICA, carimbada com quem desfez e
--   quando. Apagar a linha junto destruiria justamente o registro que existe
--   para a pessoa descobrir, depois, o que o agente andou fazendo.
--
-- POR QUE DUAS COLUNAS, E NENHUMA TABELA NOVA
--   "Desfeito" é um estado da própria execução, não uma entidade. Uma tabela
--   de desfazeres seria um segundo lugar dizendo se o comentário está lá — e
--   os dois discordariam no primeiro rollback.
--
-- O GATILHO PRECISA SER REESCRITO, E SÓ POR ISSO ELE APARECE AQUI
--   `integration_executions_guard` declarava o registro IMUTÁVEL, com uma
--   única exceção (desativar chave expirada). O carimbo do desfazer é a
--   segunda exceção, e ela nasce tão estreita quanto a primeira: de nulo para
--   preenchido, uma vez só, sem tocar em mais nada da linha.
--
-- ADITIVA, E SÓ. Nada do que f16c criou é removido ou afrouxado.
-- =============================================================================

alter table ideworks.integration_executions
  add column undone_at timestamptz,
  add column undone_by uuid;

comment on column ideworks.integration_executions.undone_at is
  'Quando o dono desfez esta escrita em lote (F21.2). Nulo = o comentário '
  'continua valendo. A linha nunca é apagada: o histórico sobrevive ao desfazer.';
comment on column ideworks.integration_executions.undone_by is
  'Quem desfez — sempre uma pessoa em sessão humana, nunca o agente: o gatilho '
  'recusa o carimbo quando `acting_grant_id()` não é nulo. Um agente que '
  'pudesse marcar as próprias escritas como desfeitas apagaria do registro o '
  'rastro de um comentário que continua na conversa.';

-- Os dois andam juntos ou nenhum: "desfeito por ninguém" e "desfeito em
-- nenhum momento" são registros que não explicam nada a quem for ler depois.
alter table ideworks.integration_executions
  add constraint integration_executions_undone_pair
    check ((undone_at is null) = (undone_by is null));

-- O lote lista "o que esta concessão escreveu e ainda não foi desfeito".
-- O índice de f16c é (grant_id, occurred_at desc) e já serve ao recorte por
-- janela; este parcial evita varrer o histórico inteiro de uma concessão
-- antiga só para descobrir que tudo já foi desfeito.
create index integration_executions_undoable_idx
  on ideworks.integration_executions (grant_id, occurred_at)
  where undone_at is null and operation = 'add_comment';

create or replace function ideworks.integration_executions_guard()
  returns trigger
  language plpgsql
  set search_path = ideworks, pg_temp
as $fn$
declare
  g ideworks.integration_grants%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into g from ideworks.integration_grants where id = new.grant_id;
    if not found then
      raise exception 'concessão inexistente para a execução';
    end if;
    if new.owner_id is distinct from g.owner_id then
      raise exception 'dono da execução difere da concessão';
    end if;
    if new.policy_version is distinct from g.policy_version then
      raise exception 'policy_version da execução difere da concessão viva';
    end if;
    if new.undone_at is not null then
      raise exception 'execução não nasce desfeita';
    end if;
    return new;
  end if;

  -- UPDATE: o miolo do registro continua imutável, nos dois caminhos.
  if new.id is distinct from old.id
     or new.grant_id is distinct from old.grant_id
     or new.owner_id is distinct from old.owner_id
     or new.operation is distinct from old.operation
     or new.target_id is distinct from old.target_id
     or new.occurred_at is distinct from old.occurred_at
     or new.result is distinct from old.result
     or new.changes is distinct from old.changes
     or new.idempotency_key is distinct from old.idempotency_key
     or new.params_hash is distinct from old.params_hash
     or new.policy_version is distinct from old.policy_version
     or new.origin is distinct from old.origin then
    raise exception 'registro de execução é imutável';
  end if;

  -- CAMINHO 2 (F21.2): carimbar o desfazer. De nulo para preenchido, uma vez
  -- só. Repetir o desfazer não pode reescrever a data nem trocar o autor —
  -- é assim que "desfazer duas vezes" não conta duas vezes.
  if new.undone_at is distinct from old.undone_at
     or new.undone_by is distinct from old.undone_by then
    -- O CARIMBO É DE GENTE, E ISSO SE DECIDE AQUI — não na política.
    --   A política `integration_executions_update` da f16c exige apenas
    --   `active = false` no `with check`. Numa linha JÁ desativada, `active`
    --   continua false, então aquela política deixaria um agente de concessão
    --   viva gravar `undone_at` numa escrita própria que CONTINUA na conversa.
    --   O ledger passaria a dizer "desfeito" sobre um comentário que está lá
    --   — exatamente a mentira que o desfazer existe para não contar. O
    --   gatilho é o lugar de fechar isso: ele vale para toda política,
    --   presente e futura, e não depende de ninguém se lembrar de repetir a
    --   condição na próxima que for escrita.
    if ideworks.acting_grant_id() is not null then
      raise exception 'só sessão humana desfaz: um agente não carimba o próprio rastro';
    end if;
    if old.undone_at is not null then
      raise exception 'esta execução já foi desfeita';
    end if;
    if new.undone_at is null or new.undone_by is null then
      raise exception 'o desfazer registra quem desfez e quando';
    end if;
    if new.active is distinct from old.active then
      raise exception 'desfazer não mexe na janela de idempotência';
    end if;
    return new;
  end if;

  -- CAMINHO 1 (f16c): desativar chave expirada.
  if old.active is not true or new.active is not false then
    raise exception 'execução só pode ser desativada uma vez';
  end if;
  if old.occurred_at > now() - interval '24 hours' then
    raise exception 'chave de idempotência ainda está na janela de 24h';
  end if;
  return new;
end;
$fn$;

-- Esta é a política do DONO, em sessão humana: `acting_grant_id()` nulo é
-- exatamente "não há agente agindo aqui".
--
-- A política de f16c fica intocada, e por si só ela NÃO basta: o `with check`
-- dela só exige `active = false`, o que numa linha já desativada deixaria um
-- agente carimbar `undone_at`. Quem fecha essa fresta é o gatilho acima, com a
-- mesma condição — política diz quem alcança a linha, gatilho diz o que é uma
-- transição válida, e é a segunda que tem de valer para toda política.
create policy integration_executions_undo on ideworks.integration_executions
  for update to ideworks_app
  using (
    ideworks.acting_grant_id() is null
    and ideworks.acting_user_id() is not null
    and owner_id = ideworks.acting_user_id()
    and undone_at is null
  )
  with check (
    ideworks.acting_grant_id() is null
    and owner_id = ideworks.acting_user_id()
    and undone_at is not null
    and undone_by = ideworks.acting_user_id()
  );
