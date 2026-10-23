-- Desfaz a F21.2. Nome idêntico ao da migration, de propósito.
--
-- O QUE ELE DEVOLVE
--   O ledger sem as colunas do desfazer e o gatilho da f16c como estava.
--
--   ⚠️ REVERTER APAGA O REGISTRO DE QUEM DESFEZ E QUANDO. Os comentários
--   apagados NÃO voltam — eles já não existem. Some apenas a explicação de
--   por que sumiram, que é a parte que a pessoa vai procurar depois. Não há
--   cópia. Reverter também desliga a rota de desfazer em lote, que passa a
--   falhar ao consultar colunas inexistentes.

drop policy if exists integration_executions_undo on ideworks.integration_executions;

drop index if exists ideworks.integration_executions_undoable_idx;

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
    return new;
  end if;

  -- UPDATE: só desativar chave expirada. O restante do registro é imutável.
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
  if old.active is not true or new.active is not false then
    raise exception 'execução só pode ser desativada uma vez';
  end if;
  if old.occurred_at > now() - interval '24 hours' then
    raise exception 'chave de idempotência ainda está na janela de 24h';
  end if;
  return new;
end;
$fn$;

alter table ideworks.integration_executions
  drop constraint if exists integration_executions_undone_pair;

alter table ideworks.integration_executions
  drop column if exists undone_at,
  drop column if exists undone_by;
