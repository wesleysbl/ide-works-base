-- Desfaz a F26.1. Nome idêntico ao da migration, de propósito.
--
-- O QUE ELE DEVOLVE
--   O enum com as nove permissões da F16.1, a checagem "escrita implica
--   leitura" da F16.1 e as checagens de operação da f16c ('add_comment',
--   'move_task'). O retrato de `conferir-schema.mjs` anterior à F26.1 volta a
--   bater.
--
-- VALOR DE ENUM NÃO SAI SEM RECRIAR O TIPO
--   Postgres não tem `alter type ... drop value`. Deixar os cinco valores no
--   tipo não seria reverter: o enum continuaria aceitando `tasks:write`, e a
--   checagem da F16.1 — que não conhece esse nome — deixaria gravar a escrita
--   sem leitura nenhuma. Então o tipo é recriado com as nove, a coluna
--   `capabilities` troca de tipo pelo texto, e a única função cuja assinatura
--   depende dele (`lookup_live_automation_credential`, F16.2b) é derrubada e
--   refeita idêntica, com os mesmos privilégios. Tudo numa transação: o Worker
--   nunca vê a função ausente. A tabela é regravada sob trava exclusiva — são
--   poucas linhas, e o `lock_timeout` desiste em vez de enfileirar o sistema.
--
-- ⚠️ SE ALGUMA LINHA JÁ USA O QUE A F26.1 ABRIU
--   Concessão com permissão nova: a permissão é RETIRADA da concessão, e as
--   leituras ficam. É o lado seguro — só estreita, nunca amplia — e o gatilho
--   da F16.1 sobe o `policy_version`, então todo token emitido com o alcance
--   maior deixa de valer e a pessoa reconecta. Não há cópia do que foi
--   retirado; quem quiser guardar, consulte antes:
--     select id, owner_id, name, capabilities from ideworks.integration_grants
--      where capabilities::text[] && array['tasks:write', 'tasks:assign',
--        'tasks:complete', 'clients:mural:write', 'clients:history:write'];
--   Registro ou aprovação com operação nova: a linha FICA — o registro é o
--   histórico do que o agente fez, e o gatilho da f16c o declara imutável.
--   Nesse caso a checagem antiga volta `not valid`: vale para toda gravação
--   nova, e não é conferida contra as linhas antigas. O rollback avisa
--   (notice) quantas linhas ficaram fora da regra. Sem nenhuma, ela volta
--   validada, igual à f16c.
--
-- O QUE O ROLLBACK NÃO ALCANÇA
--   Código. Um Worker que já ofereça ou use as permissões e operações novas
--   passa a levar recusa do banco (CHECK ou enum), que é falha fechada. E
--   conexões abertas com o tipo antigo em cache podem precisar reciclar: se o
--   Worker reclamar do tipo depois de reverter, publique de novo.

begin;
set local lock_timeout = '15s';

-- --- 1. concessões: retirar as cinco (antes de o tipo deixar de aceitá-las) --
update ideworks.integration_grants
   set capabilities = array(
         select c
           from unnest(capabilities) with ordinality as u(c, ordem)
          where c::text <> all (array['tasks:write', 'tasks:assign', 'tasks:complete',
                                      'clients:mural:write', 'clients:history:write'])
          order by ordem
       )
 where capabilities::text[] && array['tasks:write', 'tasks:assign', 'tasks:complete',
                                     'clients:mural:write', 'clients:history:write'];

-- --- 2. o tipo volta às nove --------------------------------------------------
-- A checagem sai antes: ela lê a coluna que vai trocar de tipo. Volta no passo 3.
alter table ideworks.integration_grants
  drop constraint if exists integration_grants_write_implies_read;

drop function if exists ideworks.lookup_live_automation_credential(text);

create type ideworks.integration_capability_f16 as enum (
  'boards:read',
  'tasks:read',
  'clients:read',
  'people:read',
  'comments:read',
  'reports:delivery:read',
  'reports:marketing:read',
  'comments:write',
  'tasks:move'
);

alter table ideworks.integration_grants
  alter column capabilities drop default,
  alter column capabilities type ideworks.integration_capability_f16[]
    using capabilities::text[]::ideworks.integration_capability_f16[],
  alter column capabilities set default '{}';

drop type ideworks.integration_capability;
alter type ideworks.integration_capability_f16 rename to integration_capability;

comment on type ideworks.integration_capability is
  'Capacidades operacionais da integração. Escrita exige a leitura do mesmo '
  'recurso; o CHECK da tabela é que recusa o par incompleto.';

-- --- 3. escrita implica leitura, como a F16.1 escreveu -----------------------
alter table ideworks.integration_grants
  add constraint integration_grants_write_implies_read check (
    (
      not ('comments:write'::ideworks.integration_capability = any (capabilities))
      or (
        'comments:read'::ideworks.integration_capability = any (capabilities)
        and 'tasks:read'::ideworks.integration_capability = any (capabilities)
      )
    )
    and (
      not ('tasks:move'::ideworks.integration_capability = any (capabilities))
      or (
        'tasks:read'::ideworks.integration_capability = any (capabilities)
        and 'boards:read'::ideworks.integration_capability = any (capabilities)
      )
    )
  );

-- --- 4. a conferência da credencial, idêntica à F16.2b -----------------------
create function ideworks.lookup_live_automation_credential(p_verifier text)
returns table (
  credential_id          uuid,
  grant_id               uuid,
  owner_id               uuid,
  oauth_client_id        text,
  name                   text,
  capabilities           ideworks.integration_capability[],
  allowed_company_ids    uuid[],
  allowed_client_ids     uuid[],
  expires_at             timestamptz,
  revoked_at             timestamptz,
  policy_version         integer,
  credential_expires_at  timestamptz
)
  language sql
  stable
  security definer
  set search_path = ideworks, pg_temp
as $fn$
  select c.id,
         g.id,
         g.owner_id,
         g.oauth_client_id,
         g.name,
         g.capabilities,
         g.allowed_company_ids,
         g.allowed_client_ids,
         g.expires_at,
         g.revoked_at,
         g.policy_version,
         c.expires_at
    from ideworks.integration_credentials c
    join ideworks.integration_grants g on g.id = c.grant_id and g.owner_id = c.responsible_id
    join ideworks.profiles p on p.id = g.owner_id
   where p_verifier ~ '^[0-9a-f]{64}$'
     and c.secret_verifier = p_verifier
     and c.revoked_at is null
     and (c.expires_at is null or c.expires_at > now())
     and g.revoked_at is null
     and (g.expires_at is null or g.expires_at > now())
     and p.is_active
$fn$;

comment on function ideworks.lookup_live_automation_credential(text) is
  'Confere o verificador SHA-256 da credencial de automação e devolve a '
  'concessão viva. Não lista hash. Perfil inativo ou grant revogada somem.';

revoke all on function ideworks.lookup_live_automation_credential(text) from public;
grant execute on function ideworks.lookup_live_automation_credential(text) to ideworks_app;

-- --- 5. operações: de volta às duas da f16c ---------------------------------
-- Validada quando nenhuma linha usa operação nova; `not valid` quando alguma
-- usa (ver o cabeçalho). O registro nunca é apagado nem reescrito aqui.
do $ops$
declare
  v_exec integer;
  v_aprov integer;
begin
  select count(*) into v_exec
    from ideworks.integration_executions
   where operation not in ('add_comment', 'move_task');
  select count(*) into v_aprov
    from ideworks.integration_write_approvals
   where operation not in ('add_comment', 'move_task');

  alter table ideworks.integration_executions
    drop constraint if exists integration_executions_operation_sane;
  alter table ideworks.integration_write_approvals
    drop constraint if exists integration_write_approvals_operation_sane;

  if v_exec = 0 then
    alter table ideworks.integration_executions
      add constraint integration_executions_operation_sane
        check (operation in ('add_comment', 'move_task'));
  else
    raise notice 'rollback F26.1: % execução(ões) com operação da F26 ficam no registro; checagem volta NOT VALID', v_exec;
    alter table ideworks.integration_executions
      add constraint integration_executions_operation_sane
        check (operation in ('add_comment', 'move_task')) not valid;
  end if;

  if v_aprov = 0 then
    alter table ideworks.integration_write_approvals
      add constraint integration_write_approvals_operation_sane
        check (operation in ('add_comment', 'move_task'));
  else
    raise notice 'rollback F26.1: % aprovação(ões) com operação da F26 ficam; checagem volta NOT VALID', v_aprov;
    alter table ideworks.integration_write_approvals
      add constraint integration_write_approvals_operation_sane
        check (operation in ('add_comment', 'move_task')) not valid;
  end if;
end
$ops$;

commit;
