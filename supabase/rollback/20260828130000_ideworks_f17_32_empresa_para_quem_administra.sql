-- =============================================================================
-- ROLLBACK da F17.32 — a empresa vale para quem administra tambem
-- =============================================================================
-- ⚠️ ISTO REABRE UM VAZAMENTO DE PRODUCAO, MEDIDO
--   Aplicar este arquivo devolve a `can_see_client` e a `can_see_asset` o
--   primeiro ramo `ideworks.acting_is_superadmin()` — "administra" — e com ele
--   volta exatamente o defeito que o usuario achou em 2026-08-28:
--
--     · as duas administradoras das empresas `Ide`/`Ide Hub` voltam a ver as
--       106 contas da Meta em vez de 45, com as 61 da Alma 9 dentro;
--     · e voltam a ver 96 clientes em vez de 94.
--
--   Nao ha "rollback seguro" aqui. Este arquivo existe porque toda migration
--   deste projeto tem irma reversivel — nao porque revertar seja aceitavel. Se
--   algo quebrou depois da F17.32, a pergunta certa e QUEM perdeu O QUE: quase
--   sempre a resposta e "uma tela de administrador que lia cliente ou conta de
--   outra empresa", e a correcao e a tela, nao a regra.
--
-- O QUE ELE NAO PRECISA DESFAZER
--   Nada de codigo. A F17.32 nao mexeu em rota, em tela nem em tipo: so trocou
--   uma chamada dentro de duas funcoes `sql`. Assinatura, retorno, dono,
--   `security definer`, `search_path` e privilegio sao os mesmos antes e depois,
--   entao nao ha versao de servidor que precise voltar junto.
--
-- O QUE ELE NAO DESFAZ, E DE PROPOSITO
--   Nenhum dado. Estas duas funcoes so LEEM; a etapa nao escreveu uma linha em
--   nenhuma tabela.
--
-- ORDEM
--   `can_see_asset` chama `can_see_client`. As duas voltam por
--   `create or replace`, entao o Postgres nao exige ordem — mantem-se a mesma
--   da migration para o diff entre os dois arquivos ser leitura direta.
-- =============================================================================

-- 1. `can_see_client` volta ao texto da F14 (empresas e hierarquia).
create or replace function ideworks.can_see_client(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select ideworks.acting_is_superadmin()
      or exists (
           select 1 from ideworks.profiles p
            where p.id = ideworks.acting_user_id() and p.has_all_clients_access)
      or exists (
           select 1 from ideworks.user_clients uc
            where uc.client_id = target and uc.user_id = ideworks.acting_user_id())
      or exists (
           select 1
             from ideworks.clients c
             join ideworks.user_categories ucat
               on ucat.category_id = c.category_id
              and ucat.user_id = ideworks.acting_user_id()
            where c.id = target)
$fn$;

comment on function ideworks.can_see_client(uuid) is
  'A regra de carteira, num lugar so. Espalhada pelas politicas, uma copia '
  'ficaria para tras na primeira mudanca.';

grant execute on function ideworks.can_see_client(uuid) to ideworks_app;

-- 2. `can_see_asset` volta ao texto da F13b (meta por empresa).
create or replace function ideworks.can_see_asset(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select exists (
    select 1
      from ideworks.meta_assets a
     where a.id = target
       and (
         -- quem administra ve tudo
         ideworks.acting_is_superadmin()

         -- ou enxerga o cliente ao qual a conta foi ligada
         or (a.client_id is not null and ideworks.can_see_client(a.client_id))

         -- ou pertence a EMPRESA da conta. E este ramo que faz a area Meta
         -- funcionar para quem nao administra: a conta responde pela empresa
         -- dela — a que tem o token que a alcanca —, e nao pela empresa de um
         -- cliente que talvez nem exista.
         or (a.category_id is not null and exists (
               select 1 from ideworks.user_categories uc
                where uc.category_id = a.category_id
                  and uc.user_id = ideworks.acting_user_id()))
       )
  )
$fn$;

comment on function ideworks.can_see_asset(uuid) is
  'A UNICA regra de quem enxerga conta da Meta. As nove politicas da area '
  'perguntam a ela — antes a condicao estava copiada nas nove, e esquecer uma '
  'nao daria erro, daria vazamento calado.';

grant execute on function ideworks.can_see_asset(uuid) to ideworks_app;
