-- =============================================================================
-- IDEWORKS: PRIMEIRO ACESSO
-- =============================================================================
-- Rode UMA vez, no SQL Editor do Supabase, DEPOIS de aplicar as migrations e
-- de criar a sua conta em Authentication → Users → Add user (com "Auto Confirm
-- User" marcado). Passo a passo em `docs/tutoriais/02-configurar-o-supabase.md`.
--
-- Antes de rodar, troque os TRÊS valores marcados com <<< abaixo.
-- =============================================================================

-- 1. A senha do papel restrito que o servidor usa para falar com o banco.
--    Use uma senha longa (só letras e números evita dor de cabeça na URL de
--    conexão). Guarde: ela vai para o `.env` e para o Hyperdrive.
alter role ideworks_app with password 'TROQUE-POR-UMA-SENHA-LONGA';          -- <<<

-- 2. A primeira empresa. O sistema separa clientes, espaços e pessoas por
--    empresa; com uma só, ela é a padrão.
insert into ideworks.client_categories (name, is_default, sort_order)
select 'Minha Empresa', true, 0                                               -- <<<
 where not exists (select 1 from ideworks.client_categories);

-- 3. Você vira super admin. O e-mail é o mesmo da conta criada no painel.
insert into ideworks.profiles (id, email, full_name, role, is_active, areas, has_all_clients_access)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)),
       'super_admin', true, '{entrega,quadro,meta,catalogos,pessoas}', true
  from auth.users u
 where lower(u.email) = lower('voce@suaempresa.com.br')                         -- <<<
on conflict (id) do update
   set role = 'super_admin', is_active = true, areas = excluded.areas,
       has_all_clients_access = true, updated_at = now();

-- Conferência: deve mostrar uma linha, com o seu e-mail e o papel super_admin.
-- Se não mostrar nada, o e-mail do passo 3 não bate com a conta do painel.
select email, role, is_active from ideworks.profiles where role = 'super_admin';
