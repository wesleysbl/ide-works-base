-- =============================================================================
-- IDE WORKS — F17.32  A empresa vale para quem administra tambem
-- =============================================================================
-- ACHADO DO USUARIO, EM PRODUCAO, E ELE ESTA CERTO
--   Duas administradoras designadas para as empresas `Ide` e `Ide Hub` abriam a
--   tela Meta e viam TUDO — inclusive as 61 contas da Alma 9. Medido em
--   2026-08-28, como `ideworks_app`, declarando cada perfil:
--
--     contas Meta   106 vistas   45 devidas   61 vazando
--     clientes       96 vistas   94 devidas    2 vazando
--
-- ⚠️ A CAUSA E UM NOME, E O NOME MENTE
--   `ideworks.acting_is_superadmin()` NAO quer dizer "e super admin". Quer
--   dizer "ADMINISTRA": o padrao da coluna `profiles.is_superadmin` e
--   `role in ('super_admin','admin')`, e `src/server/db.ts` declara
--   `app.is_superadmin` verdadeiro para os dois papeis.
--
--   Quem guarda o topo de verdade e OUTRA funcao, de nome quase igual:
--   `ideworks.acting_is_super()`, ligada ao GUC `app.is_super`, que o servidor
--   so declara verdadeiro para `role = 'super_admin'`.
--
--   Duas funcoes com cinco caracteres de diferenca para dois niveis diferentes,
--   e a de baixo com cara da de cima. Quem escreveu `can_see_client` (F14) e
--   `can_see_asset` (F13b) leu "super admin" na primeira linha e liberou geral.
--   Nao foi descuido de leitura: foi o nome cobrando o preco dele.
--
-- A REGRA QUE PASSA A VALER, fixada pelo usuario nesta etapa
--   "A partir do momento em que se define a criacao do usuario com as empresas
--    responsaveis, deve-se ver todo o sistema apenas com as informacoes
--    permitidas, seja em calendario, meta, usuarios e por ai vai."
--
--   Empresa e a PRIMEIRA parede, e ela vale para quem administra tambem.
--   Administrar e poder de ESCRITA sobre o que se alcanca — nunca uma chave
--   mestra de LEITURA que atravessa a empresa.
--
-- ⚠️ O SUPER ADMIN CONTINUA ATRAVESSANDO, E ISSO NAO E PREGUICA
--   `joana@parceira.com.br` e `super_admin` com ZERO empresas marcadas em
--   `ideworks.user_categories`. Amarra-lo a empresa o deixaria sem nada — o
--   dono trancado fora do proprio sistema. Ele atravessa por `acting_is_super()`
--   (e tambem por `has_all_clients_access`, que ja era o segundo ramo destas
--   duas funcoes). E o que `acting_is_super` sempre quis dizer.
--
-- O QUE ESTA MIGRATION NAO FAZ, E DE PROPOSITO
--   · NAO renomeia `is_superadmin`. O nome e a causa raiz e merece etapa
--     propria: renomear junto de uma correcao de seguranca mistura risco com
--     risco, e a coluna e lida pelo servidor, por 24 politicas e por 29 funcoes.
--
--   · NAO toca em NENHUMA das outras 27 ocorrencias de `acting_is_superadmin()`
--     em funcao, nem nas 24 em politica. A varredura inteira esta no relatorio
--     da etapa. Em quase todas "administra" e o certo: sao guardas de ESCRITA
--     administrativa (`set_user_areas`, `set_user_active`, `set_user_role`,
--     `meta_assets_write`, `clients_write`, a guarda F14e de `aplicar_convite`)
--     e trocar essas quebraria justamente o trabalho das administradoras que
--     esta etapa protege.
--
--   · NAO fecha `ideworks.reaches_company_for(uuid, boolean, uuid)`, que TEM o
--     mesmo furo — e chamada por `reaches_company()` com `acting_is_superadmin()`
--     no parametro `p_super`, e o primeiro `coalesce(p_super,false)` dela abre a
--     arvore inteira do Pilar B para quem administra. Medido hoje, o vazamento
--     dela e ZERO: as 6 esteiras existentes sao todas de `Ide`/`Ide Hub` e nao
--     ha nenhuma da Alma 9. E furo LATENTE, nao ativo. Fica registrado como
--     divida desta etapa, com a razao de nao ser desatado aqui: `spaces_write`
--     autoriza quem administra a ESCREVER em espaco de qualquer empresa, entao
--     fechar so a leitura criaria "escreve mas nao ve". As duas pontas andam
--     juntas, e isso e desenho, nao troca de nome.
--
-- POR QUE `can_see_client` VEM PRIMEIRO
--   `can_see_asset` chama `can_see_client`. As duas sao `create or replace`, e
--   o Postgres nao exigiria ordem — mas ler o arquivo na ordem da dependencia e
--   o que faz a revisao enxergar que o ramo do cliente, dentro de
--   `can_see_asset`, tambem deixou de ser porta larga.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova, nenhuma politica nova. As duas funcoes SAO a regra de
--   leitura de `ideworks.clients` (`clients_select`) e de `ideworks.meta_assets`
--   (`meta_assets_select`) e das outras oito politicas da area Meta, que
--   perguntam a `can_see_asset` desde a F13b. Apertar a funcao aperta as dez.
--
--   As duas continuam `security definer` com `search_path = ideworks, pg_temp` —
--   e o que evita recursao, porque a dona da tabela nao passa por politica.
--   `create or replace` preserva o privilegio; o `grant` abaixo e explicito para
--   que o arquivo diga quem executa sem exigir arqueologia.
-- =============================================================================

-- 1. quem enxerga qual CLIENTE. So o topo atravessa a empresa.
create or replace function ideworks.can_see_client(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- ⚠️ `acting_is_super`, e NAO `acting_is_superadmin`: o segundo quer dizer
  -- "administra", e ate a F17.32 esta linha entregava a carteira inteira a
  -- todo administrador, empresa nenhuma valendo.
  select ideworks.acting_is_super()

      -- a excecao DECLARADA, e nao herdada de papel: quem tem acesso a todos os
      -- clientes marcado no proprio perfil.
      or exists (
           select 1 from ideworks.profiles p
            where p.id = ideworks.acting_user_id() and p.has_all_clients_access)

      -- a carteira fina: alguem de fora que precisa de UM cliente.
      or exists (
           select 1 from ideworks.user_clients uc
            where uc.client_id = target and uc.user_id = ideworks.acting_user_id())

      -- a EMPRESA — a parede que a F14 criou e que agora vale para todo mundo.
      or exists (
           select 1
             from ideworks.clients c
             join ideworks.user_categories ucat
               on ucat.category_id = c.category_id
              and ucat.user_id = ideworks.acting_user_id()
            where c.id = target)
$fn$;

comment on function ideworks.can_see_client(uuid) is
  'A UNICA regra de quem enxerga cliente. F17.32: o primeiro ramo passou de '
  '`acting_is_superadmin` (administra) para `acting_is_super` (so o topo) — '
  'quem administra passou a respeitar a empresa, como todo mundo.';

grant execute on function ideworks.can_see_client(uuid) to ideworks_app;

-- 2. quem enxerga qual CONTA DA META. O mesmo furo, na mesma linha.
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
         -- ⚠️ `acting_is_super`, e NAO `acting_is_superadmin`. Era esta linha
         -- que mostrava as 61 contas da Alma 9 a quem e das empresas Ide.
         ideworks.acting_is_super()

         -- ou enxerga o cliente ao qual a conta foi ligada
         or (a.client_id is not null and ideworks.can_see_client(a.client_id))

         -- ou pertence a EMPRESA da conta. E este ramo que faz a area Meta
         -- funcionar para quem nao administra: a conta responde pela empresa
         -- dela — a que tem o token que a alcanca —, e nao pela empresa de um
         -- cliente que talvez nem exista. Depois da F17.32 e tambem por ele que
         -- quem administra passa: 45 contas de `Ide`, e nenhuma da Alma 9.
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
  'nao daria erro, daria vazamento calado. F17.32: o primeiro ramo passou de '
  '`acting_is_superadmin` (administra) para `acting_is_super` (so o topo).';

grant execute on function ideworks.can_see_asset(uuid) to ideworks_app;
