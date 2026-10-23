-- =============================================================================
-- IDE WORKS — F1.9  Politicas de acesso (a terceira barreira)
-- =============================================================================
-- CONTEXTO
--   A F1.1 criou as tabelas com RLS ligada e NENHUMA policy, de proposito: sem
--   policy o Postgres nega tudo, e as permissoes deviam entrar so na etapa que
--   precisasse delas. E esta.
--
-- A TRADUCAO DO MODELO
--   O documento de acesso diz que a terceira barreira vale porque o sistema le o
--   banco com o cracha DA PESSOA, e nao com uma chave-mestra. Aquele desenho
--   pressupoe API com JWT.
--
--   Aqui o servidor conecta com papel proprio (`ideworks_app`). Se ele tivesse
--   acesso amplo, o RLS nao protegeria nada — seria enfeite.
--
--   Entao: o servidor precisa DECLARAR em nome de quem age, por variaveis de
--   sessao, e as policies decidem a partir da declaracao. Esquecer de declarar
--   nao libera tudo: devolve vazio. Falha fechado.
--
--     app.user_id        quem esta agindo (uuid, texto vazio quando ninguem)
--     app.is_superadmin  'true' apenas quando confirmado no perfil
--     app.preauth        'true' nas rotas que rodam ANTES de haver identidade
--                        (login e ativacao). Da o minimo, e nada alem.
-- =============================================================================

-- Leitores das variaveis de sessao. `current_setting(..., true)` devolve nulo em
-- vez de erro quando a variavel nao foi definida — e nulo cai nas policies como
-- falso, que e o comportamento desejado.
create or replace function ideworks.acting_user_id() returns uuid
  language sql stable as $fn$
  select nullif(current_setting('app.user_id', true), '')::uuid
$fn$;

create or replace function ideworks.acting_is_superadmin() returns boolean
  language sql stable as $fn$
  select coalesce(current_setting('app.is_superadmin', true), 'false') = 'true'
$fn$;

create or replace function ideworks.is_preauth() returns boolean
  language sql stable as $fn$
  select coalesce(current_setting('app.preauth', true), 'false') = 'true'
$fn$;

comment on function ideworks.acting_user_id() is
  'Quem o servidor declarou estar representando. Nulo quando nada foi declarado — '
  'e nulo reprova em toda policy, de proposito.';

-- --- profiles -----------------------------------------------------------------
-- Le o proprio perfil, ou tudo se for administrador de topo. O caminho pre-auth
-- le apenas para decidir se a pessoa tem acesso ao IDE Works — a conferencia que
-- existe porque a autenticacao e compartilhada com o sistema legado.

create policy profiles_select on ideworks.profiles for select using (
  id = ideworks.acting_user_id()
  or ideworks.acting_is_superadmin()
  or ideworks.is_preauth()
);

create policy profiles_insert on ideworks.profiles for insert with check (
  ideworks.acting_is_superadmin()
);

create policy profiles_update on ideworks.profiles for update using (
  ideworks.acting_is_superadmin()
) with check (
  ideworks.acting_is_superadmin()
);

-- Sem policy de DELETE: perfil nao se apaga. Desativar e reversivel e deixa
-- rastro; apagar destroi a historia junto.

-- --- invitations --------------------------------------------------------------
-- So administrador de topo cria e revoga. O caminho pre-auth le e atualiza
-- apenas para a ativacao poder conferir o codigo e contar o erro.

create policy invitations_select on ideworks.invitations for select using (
  ideworks.acting_is_superadmin() or ideworks.is_preauth()
);

create policy invitations_insert on ideworks.invitations for insert with check (
  ideworks.acting_is_superadmin()
);

create policy invitations_update on ideworks.invitations for update using (
  ideworks.acting_is_superadmin() or ideworks.is_preauth()
) with check (
  ideworks.acting_is_superadmin() or ideworks.is_preauth()
);

-- --- auth_attempts ------------------------------------------------------------
-- O limitador roda antes de existir identidade: e a propria porta de entrada.
-- Por isso o caminho pre-auth escreve e conta aqui. Ninguem le sem ser
-- administrador — a lista de e-mails tentados diria quem esta sendo atacado.

create policy auth_attempts_insert on ideworks.auth_attempts for insert with check (
  ideworks.is_preauth() or ideworks.acting_is_superadmin()
);

create policy auth_attempts_select on ideworks.auth_attempts for select using (
  ideworks.is_preauth() or ideworks.acting_is_superadmin()
);

-- --- admin_audit --------------------------------------------------------------
-- O livro que nem o auditado reescreve.
--
-- Escrita: permitida so quando ha ator declarado. Sem declaracao, nao grava —
-- linha de auditoria sem autor nao serve para nada.
-- Leitura: so administrador de topo.
-- SEM policy de UPDATE e SEM policy de DELETE: por definicao. Um livro que se
-- corrige depois nao e livro.

create policy admin_audit_insert on ideworks.admin_audit for insert with check (
  ideworks.acting_user_id() is not null
);

create policy admin_audit_select on ideworks.admin_audit for select using (
  ideworks.acting_is_superadmin()
);
