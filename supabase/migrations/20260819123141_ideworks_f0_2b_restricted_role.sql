-- =============================================================================
-- IDE WORKS — F0.2b  Papel de banco restrito ao schema `ideworks`
-- =============================================================================
-- POR QUE ESTE PAPEL EXISTE
--   O IDE Works divide o projeto de banco com o Sistema IDE EM PRODUCAO (decisao
--   D8). Sem este papel, a unica coisa separando o desenvolvimento dos 91
--   clientes reais seria disciplina humana — e disciplina humana e exatamente o
--   que falhou em todas as dividas mapeadas no legado.
--
--   Com ele, um erro de migration, um comando sem schema explicito ou um teste
--   mal escrito sao FISICAMENTE incapazes de alterar o legado.
--
-- O QUE ELE PODE   Tudo dentro de `ideworks`. Nada fora.
-- O QUE ELE NAO PODE
--   Ler, escrever ou alterar qualquer coisa em `public` (Sistema IDE) ou em
--   `auth` (usuarios COMPARTILHADOS com o legado).
--
-- Nenhum comando abaixo toca em `public` ou em `auth`. Nao ha REVOKE sobre eles:
-- revogar privilegio nesses schemas afetaria o legado. A restricao vem da
-- AUSENCIA de concessao — o papel nasce sem nada e so recebe `ideworks`.
--
-- !! SENHA !!
--   O papel nasce SEM senha: com `login` e sem senha, nenhuma conexão por senha
--   entra. A senha é definida DEPOIS, à mão, no SQL Editor do Supabase:
--
--     alter role ideworks_app with password 'uma-senha-longa-e-sua';
--
--   (passo 3 de `docs/tutoriais/02-configurar-o-supabase.md`). Ela nunca entra
--   no controle de versão: o mesmo valor vai para o `.env`
--   (IDEWORKS_SERVER_DB_PASSWORD) e para o Hyperdrive.
-- =============================================================================

do $$ begin
  create role ideworks_app login;
exception when duplicate_object then
  alter role ideworks_app login;
end $$;

comment on role ideworks_app is
  'IDE Works. Restrito ao schema ideworks. NUNCA conceder acesso a public ou auth.';

-- Caminho de busca fixo: comando sem schema explicito resolve para `ideworks`,
-- jamais para `public` por omissao. Foi por omissao que o legado acumulou
-- divida — o default silencioso e o inimigo deste projeto.
alter role ideworks_app set search_path = ideworks;

-- Sem tempo infinito: consulta travada de desenvolvimento nao pode segurar
-- conexao num banco que atende sistema em producao.
alter role ideworks_app set statement_timeout = '30s';
alter role ideworks_app set lock_timeout = '10s';
alter role ideworks_app set idle_in_transaction_session_timeout = '60s';

-- --- concessoes: SOMENTE ideworks ---------------------------------------------
grant usage, create on schema ideworks to ideworks_app;
grant all privileges on all tables    in schema ideworks to ideworks_app;
grant all privileges on all sequences in schema ideworks to ideworks_app;
grant all privileges on all functions in schema ideworks to ideworks_app;

-- Objetos futuros: sem isto, cada tabela nova precisaria de grant manual, e a
-- primeira que alguem esquecesse quebraria em producao sem aviso.
alter default privileges in schema ideworks
  grant all privileges on tables to ideworks_app;
alter default privileges in schema ideworks
  grant all privileges on sequences to ideworks_app;
alter default privileges in schema ideworks
  grant all privileges on functions to ideworks_app;

-- O papel nao pode criar schema novo: se precisar de um, que seja decisao
-- explicita de quem administra, nao efeito colateral de uma migration.
revoke create on database postgres from ideworks_app;
