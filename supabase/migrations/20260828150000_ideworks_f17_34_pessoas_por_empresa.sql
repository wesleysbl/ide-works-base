-- =============================================================================
-- IDE WORKS — F17.34  A tela de Pessoas tambem respeita a empresa
-- =============================================================================
-- O QUE A F17.32 DEIXOU ABERTO
--   A regra do usuario diz: "a partir do momento em que se define a criacao do
--   usuario com as empresas responsaveis, deve-se ver todo o sistema apenas com
--   as informacoes permitidas, seja em calendario, meta, USUARIOS e por ai
--   vai." A F17.32 fechou cliente e conta da Meta. Pessoa ficou aberta.
--
--   Medido em 2026-08-28, como `ideworks_app`, declarando cada perfil:
--
--     quem olha                      pessoas  empresas de cada um  carteiras  convites  livro
--     gestao@exemplo.com.br (Ide)       4                   4          0        12     13
--     atendimento@exemplo (Ide)         4                   4          0        12     13
--     joana@alma9 (super admin)         4                   4          0        12     13
--
--   Quem administra as empresas `Ide`/`Ide Hub` lia a ficha inteira de todo
--   mundo — inclusive de quem for da Alma 9.
--
-- ⚠️ ISTO NAO E TROCA DE NOME COMO NA F17.32
--   `ideworks.profiles` NAO tem coluna de empresa. A empresa de uma pessoa mora
--   em `ideworks.user_categories`, uma linha por empresa. Entao nao havia uma
--   funcao errada para consertar: a regra nao existia, e esta migration a cria.
--
-- A REGRA, E O TERCEIRO ITEM E O QUE DECIDE TUDO
--   Quem administra enxerga a pessoa quando:
--
--     1. COMPARTILHA EMPRESA com ela — o caso comum; ou
--     2. E ELA MESMA — ninguem some da propria tela; ou
--     3. A PESSOA NAO TEM NENHUMA EMPRESA MARCADA.
--
--   ⚠️ O item 3 nao e frouxidao, e a saida de uma armadilha. Sem ele, convidar
--   alguem e esquecer de marcar a empresa cria uma pessoa que administrador
--   NENHUM enxerga: orfa, alcancavel so por super admin — e quem esqueceu de
--   marcar e justamente quem nao vai lembrar de pedir socorro. E quem nao tem
--   empresa nao e "da outra empresa": pela propria frase da tela de convite,
--   "sem nenhuma marcada, a pessoa so ve o que estiver na carteira dela".
--
--   O super admin continua atravessando, pela mesma razao da F17.32:
--   `joana@parceira.com.br` tem ZERO empresas marcadas, e amarra-lo a empresa
--   trancaria o dono fora do proprio sistema. Ele passa por `acting_is_super()`.
--
--   ⚠️ E `acting_is_superadmin()` — que quer dizer "ADMINISTRA", e nao "e o
--   topo" — continua sendo a porta de entrada da regra: quem nao administra
--   segue vendo so a si mesmo, exatamente como antes. Esta etapa ESTREITA o que
--   o administrador ve; ela nao alarga o que ninguem via.
--
-- ⚠️ O EFEITO NO DADO DE HOJE E ZERO, E O BRIEFING DESTA ETAPA CONTOU ERRADO
--   O plano previa "Helena e Carla passam de 4 pessoas para 3 — ela, a outra, e
--   Joana (zero empresas, regra 3)". Sao QUATRO perfis no sistema, e DOIS
--   deles tem zero empresas:
--
--     joana@parceira.com.br        super_admin   0 empresas   -> visivel (regra 3)
--     teste-f19@ideworks.invalid   super_admin   0 empresas   -> visivel (regra 3)
--     atendimento@exemplo       admin         Ide+Ide Hub  -> visivel (regra 1)
--     gestao@exemplo            admin         Ide+Ide Hub  -> visivel (regra 1/2)
--
--   Pela regra 3, `teste-f19` e tao visivel quanto Joana: os dois tem zero
--   empresas, e nao ha item na regra que separe um do outro. Logo Helena e
--   Carla continuam vendo 4, e nao 3. O numero do briefing esquecia o quarto
--   perfil; a regra que ele mesmo fixou, em tres lugares, e que manda.
--
--   Isso quer dizer que O CENSO DE HOJE NAO PROVA NADA — e por isso a prova
--   desta etapa nao e um censo. Ela cria SONDAS dentro de uma transacao que
--   termina em `ROLLBACK_PROPOSITAL`: uma pessoa da Alma 9 (tem de sumir da
--   tela de quem e de `Ide`) e uma pessoa sem empresa (tem de continuar
--   visivel). Sem sonda, esta migration passaria por "correcao que nao corrige"
--   exatamente como a F17.32 quase passou.
--
--   O que SE MEXE no dado real e a fila de convites: `gestao@` e `atendimento@`
--   liam 12 convites e passam a ler 11 — o de `teste-alma9-acesso`, marcado com
--   a empresa Alma9, sai.
--
-- ⚠️ A ARMADILHA DA F17.32b, QUE ESTAVA AQUI DE NOVO: `FOR ALL` INCLUI `SELECT`
--   `user_clients` tinha `user_clients_write ... for all using
--   (acting_is_superadmin())`. Politicas permissivas se somam com OU, e `for
--   all` no Postgres quer dizer TODO comando — `select` incluido. Entao apertar
--   `user_clients_select` sozinho nao mexeria um numero: a `_write` ja teria
--   dito sim. Ela e partida abaixo em `_insert`/`_update`/`_delete`, do mesmo
--   jeito e pela mesma razao que a F17.32b partiu as sete irmas dela.
--
--   Nenhuma das sete tabelas desta etapa faz `insert ... returning`, entao o
--   preco medido na F17.32b — `returning` recusado porque a politica de
--   `select` nao enxerga a linha recem-criada — nao aparece aqui. Quem for
--   escrever `insert ... returning` em `user_clients` vai esbarrar nele.
--
-- ADMINISTRAR NAO E SO LER: QUEM NAO ENXERGA TAMBEM NAO MEXE
--   Fechar so a leitura deixaria a porta de tras aberta: um POST montado a mao
--   com o identificador de uma pessoa da outra empresa continuaria mudando o
--   papel dela, desativando-a ou gerando codigo de senha em nome dela. Entao as
--   seis funcoes de escrita que apontam para UMA pessoa passam a perguntar a
--   mesma regra, e as politicas de escrita de `profiles`, `user_clients` e
--   `invitations` tambem.
--
--   As guardas que ja existiam continuam inteiras, palavra por palavra: so
--   super admin cria super admin, so super admin mexe em super admin, ninguem
--   muda o proprio papel, ninguem se desativa, ninguem gera o proprio codigo de
--   senha. Esta etapa SOMA uma condicao; nao troca nenhuma.
--
-- O QUE ESTA MIGRATION NAO FAZ, E DE PROPOSITO
--   · NAO mexe em `set_user_categories`. Ela ja exige `acting_is_super()` —
--     quem mexe em empresa e o topo, e isso ja estava certo.
--   · NAO renomeia `is_superadmin`. O nome e a causa raiz da F17.32 e merece
--     etapa propria; misturar renomeacao com correcao de seguranca soma risco.
--   · NAO fecha quem PODE SER CONVIDADO nem para qual empresa. O worker ja
--     recusa administrador que tente marcar empresa num convite (so o super
--     admin marca), entao convite feito por administrador nasce sem empresa —
--     e cai na regra 3, visivel para todos os administradores. Estreitar isso e
--     decisao de produto, e fica anotada como divida.
--   · NAO mexe em `ideworks.people_directory()` (F4.8b), que mostra nome e
--     e-mail de quem pode ser responsavel por uma tarefa. Ela nao e ficha de
--     pessoa: e o dicionario que impede a arvore de exibir identificador cru.
--     Estreita-la esconderia responsavel ja atribuido, e isso e desenho de
--     tela, nao correcao de vazamento. Fica anotada como divida.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova. Duas funcoes novas de LEITURA — `can_see_person` e
--   `can_see_invitation` — no molde de `can_see_client`: a regra mora em UM
--   lugar e as politicas perguntam a ela, para que esquecer uma nao de erro,
--   de vazamento calado.
--
--   As duas sao `security definer` com `search_path = ideworks, pg_temp`. Isso
--   e o que evita recursao: `can_see_person` LE `user_categories`, que e uma
--   das tabelas cuja politica pergunta a ela. Como a dona (`postgres`) nao tem
--   `force row level security` em nenhuma delas — conferido —, a leitura de
--   dentro da funcao nao passa por politica e nao se morde.
-- =============================================================================

-- --- 1. a regra: quem enxerga qual PESSOA -----------------------------------
create or replace function ideworks.can_see_person(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- REGRA 2, e ela vem primeiro de proposito: ninguem some da propria tela,
  -- nem quem nao administra nada. Se `acting_user_id()` for nulo a comparacao
  -- da nulo, que nao e verdadeiro — e o anonimo nao ve ninguem.
  select target = ideworks.acting_user_id()

      -- O TOPO ATRAVESSA. `acting_is_super`, e nao `acting_is_superadmin`: o
      -- segundo quer dizer "administra", e foi ele que a F17.32 tirou das duas
      -- funcoes de cliente e conta.
      or ideworks.acting_is_super()

      -- Daqui para baixo e a ficha de OUTRA pessoa, e so quem administra chega.
      -- Sem esta porta, todo funcionario passaria a ver os colegas da propria
      -- empresa — que e alargar, e esta etapa so estreita.
      or (ideworks.acting_is_superadmin() and (

           -- REGRA 1: compartilha empresa. E o caso comum, e e o unico que
           -- depende de dado dos dois lados.
           exists (
             select 1
               from ideworks.user_categories minha
               join ideworks.user_categories dela
                 on dela.category_id = minha.category_id
              where minha.user_id = ideworks.acting_user_id()
                and dela.user_id = target)

           -- REGRA 3: a pessoa nao tem NENHUMA empresa marcada. Ver o cabecalho
           -- desta migration: sem isto, esquecer de marcar a empresa de alguem
           -- o torna invisivel para todo administrador, e ninguem descobre.
           or not exists (
                select 1 from ideworks.user_categories dela
                 where dela.user_id = target)
         ))
$fn$;

comment on function ideworks.can_see_person(uuid) is
  'A UNICA regra de quem enxerga qual pessoa — F17.34. Tres ramos: e ela '
  'mesma, ou o topo atravessa, ou quem administra compartilha empresa com ela. '
  'O terceiro ramo, dentro do de quem administra, deixa passar quem nao tem '
  'NENHUMA empresa marcada: sem ele, esquecer de marcar cria pessoa que '
  'administrador nenhum ve.';

grant execute on function ideworks.can_see_person(uuid) to ideworks_app;

-- --- 2. a mesma regra, para o CONVITE ----------------------------------------
--
-- Convite e pessoa que ainda nao existe, entao a empresa dele nao vem de
-- `user_categories`: vem da coluna `categories` do proprio convite, escolhida
-- por quem convidou. Mas se ja HA conta com aquele e-mail — convite de senha
-- (F17.31), ou convite para quem ja entrava pelo cadastro compartilhado
-- (F17.30) —, entao o convite segue a PESSOA, e nao a lista dele: senao um
-- codigo de senha, que nasce com `categories` vazio, entregaria o e-mail de
-- alguem da outra empresa pela regra 3.
create or replace function ideworks.can_see_invitation(target uuid)
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select exists (
    select 1
      from ideworks.invitations i
     where i.id = target
       and (
         -- o topo atravessa
         ideworks.acting_is_super()

         -- e so quem administra ve fila de convite, como sempre foi
         or (ideworks.acting_is_superadmin() and (

              -- FOI VOCE QUEM CONVIDOU: ninguem perde de vista o proprio
              -- convite. E o equivalente, para o convite, de "ninguem some da
              -- propria tela".
              i.created_by = ideworks.acting_user_id()

              -- JA HA CONTA COM ESTE E-MAIL: o convite segue a pessoa.
              or exists (
                   select 1 from ideworks.profiles p
                    where lower(p.email) = lower(i.email)
                      and ideworks.can_see_person(p.id))

              -- AINDA NAO HA CONTA: vale a empresa marcada no convite, pela
              -- mesma regra de tres ramos — compartilha, ou nenhuma marcada.
              or (not exists (
                    select 1 from ideworks.profiles p
                     where lower(p.email) = lower(i.email))
                  and (coalesce(array_length(i.categories, 1), 0) = 0
                       or exists (
                            select 1 from ideworks.user_categories minha
                             where minha.user_id = ideworks.acting_user_id()
                               and minha.category_id = any(i.categories))))
            ))
       ))
$fn$;

comment on function ideworks.can_see_invitation(uuid) is
  'A UNICA regra de quem enxerga qual convite — F17.34. Se ja ha conta com o '
  'e-mail, o convite segue a PESSOA (senao um codigo de senha, que nasce sem '
  'empresa, entregaria o e-mail de quem e de outra empresa). Se nao ha conta, '
  'vale a empresa marcada no convite. Quem convidou sempre ve o proprio.';

grant execute on function ideworks.can_see_invitation(uuid) to ideworks_app;

-- --- 3. as quatro funcoes que a tela de Pessoas chama -------------------------

-- 3.1 a lista de pessoas
create or replace function ideworks.admin_directory()
  returns table (
    id uuid, email text, full_name text, role ideworks.papel,
    is_superadmin boolean, is_active boolean, has_all_clients_access boolean,
    areas ideworks.area[], clientes integer, empresas integer,
    created_at timestamptz)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve a lista de pessoas' using errcode = '42501';
  end if;

  return query
    select p.id, p.email, p.full_name, p.role,
           p.is_superadmin, p.is_active, p.has_all_clients_access, p.areas,
           (select count(*)::int from ideworks.user_clients uc where uc.user_id = p.id),
           (select count(*)::int from ideworks.user_categories ucat where ucat.user_id = p.id),
           p.created_at
      from ideworks.profiles p
     -- ⚠️ F17.34. Sem esta linha a lista era o sistema inteiro. A funcao e
     -- `security definer`, entao a politica de `profiles` nao a alcanca: aqui a
     -- regra tem de ser perguntada de proposito.
     where ideworks.can_see_person(p.id)
     order by p.role, p.is_active desc, lower(coalesce(p.full_name, p.email));
end;
$fn$;

comment on function ideworks.admin_directory() is
  'A lista da tela de Pessoas. F17.34: passou a mostrar so quem administra '
  'enxerga — mesma empresa, ela mesma, ou pessoa sem nenhuma empresa marcada.';

revoke all on function ideworks.admin_directory() from public;
grant execute on function ideworks.admin_directory() to ideworks_app;

-- 3.2 a fila de convites
create or replace function ideworks.admin_pending_invitations()
  returns table (
    id uuid, email text, expires_at timestamptz, failed_attempts integer,
    created_at timestamptz, vencido boolean, purpose ideworks.invitation_purpose)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve a fila' using errcode = '42501';
  end if;

  return query
    select i.id, i.email, i.expires_at, i.failed_attempts, i.created_at,
           i.expires_at < now(), i.purpose
      from ideworks.invitations i
     where i.status = 'pending'
       -- ⚠️ F17.34. A fila mostrava o e-mail de quem esta sendo convidado para
       -- QUALQUER empresa.
       and ideworks.can_see_invitation(i.id)
     order by i.created_at desc;
end;
$fn$;

-- O texto da F17.31 fica inteiro: ele diz POR QUE o codigo de senha aparece na
-- fila, e essa razao nao mudou. A F17.34 so acrescenta a ultima frase.
comment on function ideworks.admin_pending_invitations() is
  'Os codigos que existem e ainda nao foram usados — de acesso e de senha, '
  'ditos pela intencao. O de senha entra aqui desde a F17.31 porque codigo '
  'pendente e credencial viva: escondido, ninguem o cancelaria. F17.34: a fila '
  'passou a respeitar a empresa, pela regra de `can_see_invitation`.';

revoke all on function ideworks.admin_pending_invitations() from public;
grant execute on function ideworks.admin_pending_invitations() to ideworks_app;

-- 3.3 as empresas de uma pessoa
create or replace function ideworks.admin_user_categories(p_user_id uuid)
  returns table (category_id uuid, name text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra ve as empresas de outra pessoa' using errcode = '42501';
  end if;

  -- ⚠️ F17.34. "Nao encontrada", e nao "voce nao pode": para quem administra
  -- outra empresa, esta pessoa de fato nao existe — e dizer o contrario
  -- confirmaria a existencia dela, que e metade do que se esta protegendo.
  if not ideworks.can_see_person(p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  return query
    select c.id, c.name
      from ideworks.user_categories uc
      join ideworks.client_categories c on c.id = uc.category_id
     where uc.user_id = p_user_id
     order by lower(c.name);
end;
$fn$;

comment on function ideworks.admin_user_categories(uuid) is
  'As empresas de uma pessoa, para a ficha dela. F17.34: recusa quem '
  'administra nao enxerga, com a mesma frase de pessoa inexistente.';

revoke all on function ideworks.admin_user_categories(uuid) from public;
grant execute on function ideworks.admin_user_categories(uuid) to ideworks_app;

-- 3.4 a carteira de uma pessoa
create or replace function ideworks.admin_user_clients(p_user_id uuid)
  returns table (client_id uuid, name text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador ve a carteira de outra pessoa' using errcode = '42501';
  end if;

  -- ⚠️ F17.34, mesma razao da funcao acima.
  if not ideworks.can_see_person(p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  return query
    select c.id, c.name
      from ideworks.user_clients uc
      join ideworks.clients c on c.id = uc.client_id
     where uc.user_id = p_user_id
     order by lower(c.name);
end;
$fn$;

comment on function ideworks.admin_user_clients(uuid) is
  'A carteira de uma pessoa, para a ficha dela. F17.34: recusa quem '
  'administra nao enxerga.';

revoke all on function ideworks.admin_user_clients(uuid) from public;
grant execute on function ideworks.admin_user_clients(uuid) to ideworks_app;

-- --- 4. as cinco politicas de leitura ----------------------------------------
--
-- Todas passam a perguntar a MESMA funcao. O ramo `id = acting_user_id()` que
-- estava escrito a mao em tres delas nao some: ele e o primeiro ramo de
-- `can_see_person`, agora em um lugar so.

drop policy if exists profiles_select on ideworks.profiles;
create policy profiles_select on ideworks.profiles for select using (
  -- `is_preauth` continua primeiro: e o login e a ativacao, que acontecem antes
  -- de existir pessoa declarada. Tirar isto tranca a porta de entrada.
  ideworks.is_preauth() or ideworks.can_see_person(id)
);

drop policy if exists user_categories_select on ideworks.user_categories;
create policy user_categories_select on ideworks.user_categories for select using (
  ideworks.can_see_person(user_id)
);

drop policy if exists user_clients_select on ideworks.user_clients;
create policy user_clients_select on ideworks.user_clients for select using (
  ideworks.can_see_person(user_id)
);

drop policy if exists invitations_select on ideworks.invitations;
create policy invitations_select on ideworks.invitations for select using (
  ideworks.is_preauth() or ideworks.can_see_invitation(id)
);

drop policy if exists admin_audit_select on ideworks.admin_audit;
create policy admin_audit_select on ideworks.admin_audit for select using (
  ideworks.acting_is_superadmin()
  and (
    -- o que VOCE fez continua seu, sempre
    actor_id = ideworks.acting_user_id()
    -- linha sem alvo e fato do sistema, e nao ficha de ninguem
    or target_id is null
    or ideworks.can_see_person(target_id)
  )
);

-- --- 5. `for all` incluia `select`: a politica de escrita da carteira --------
--
-- Ver o cabecalho. Sem partir esta, os itens 4 acima nao moveriam um numero em
-- `user_clients`.
drop policy if exists user_clients_write on ideworks.user_clients;

create policy user_clients_insert on ideworks.user_clients for insert
  with check (ideworks.acting_is_superadmin() and ideworks.can_see_person(user_id));
create policy user_clients_update on ideworks.user_clients for update
  using (ideworks.acting_is_superadmin() and ideworks.can_see_person(user_id))
  with check (ideworks.acting_is_superadmin() and ideworks.can_see_person(user_id));
create policy user_clients_delete on ideworks.user_clients for delete
  using (ideworks.acting_is_superadmin() and ideworks.can_see_person(user_id));

-- --- 6. escrever em quem nao se enxerga, pela porta de tras -------------------
--
-- `profiles_update` autorizava quem administra a alterar QUALQUER perfil, e
-- `update ... where id = X` nao precisa de politica de leitura para achar a
-- linha: a tela nao mostrava a pessoa, e um POST montado a mao mudava a ficha
-- dela assim mesmo.
--
-- ⚠️ O `with check` de `invitations_update` fica como estava, de proposito: ele
-- julga a linha DEPOIS da alteracao, e `can_see_invitation` le a propria tabela
-- que esta sendo escrita. O que decide qual linha se pode TOCAR e o `using`, e
-- e nele que a regra entra.
drop policy if exists profiles_update on ideworks.profiles;
create policy profiles_update on ideworks.profiles for update
  using (ideworks.acting_is_superadmin() and ideworks.can_see_person(id))
  with check (ideworks.acting_is_superadmin() and ideworks.can_see_person(id));

drop policy if exists invitations_update on ideworks.invitations;
create policy invitations_update on ideworks.invitations for update
  using (
    ideworks.is_preauth()
    or (ideworks.acting_is_superadmin() and ideworks.can_see_invitation(id)))
  with check (ideworks.acting_is_superadmin() or ideworks.is_preauth());

-- --- 7. as seis escritas que apontam para UMA pessoa --------------------------
--
-- Sao `security definer`: elas nao passam por politica nenhuma, entao a regra
-- tem de ser perguntada dentro de cada uma. Cada guarda que ja existia fica
-- inteira; esta etapa acrescenta UMA linha em cada.

create or replace function ideworks.set_user_areas(p_user_id uuid, p_areas ideworks.area[])
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador define areas' using errcode = '42501';
  end if;

  -- ⚠️ F17.34: quem nao se enxerga tambem nao se mexe.
  if not ideworks.can_see_person(p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  update ideworks.profiles
     set areas = coalesce(p_areas, '{}'::ideworks.area[]),
         updated_at = now()
   where id = p_user_id;

  if not found then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  select array_length(coalesce(p_areas, '{}'::ideworks.area[]), 1) into v_n;
  return coalesce(v_n, 0);
end;
$fn$;

create or replace function ideworks.set_user_active(p_user_id uuid, p_active boolean)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador ativa ou desativa' using errcode = '42501';
  end if;

  -- Mesma razao da regra acima: desativar a si mesmo tranca a porta por dentro.
  if p_user_id = ideworks.acting_user_id() and not p_active then
    raise exception 'voce nao pode desativar a si mesmo' using errcode = '42501';
  end if;

  -- ⚠️ F17.34: quem nao se enxerga tambem nao se mexe.
  if not ideworks.can_see_person(p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  update ideworks.profiles
     set is_active = p_active, updated_at = now()
   where id = p_user_id;

  if not found then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;
end;
$fn$;

create or replace function ideworks.set_user_role(
    p_user_id uuid, p_role ideworks.papel, p_has_all_clients boolean)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_alvo ideworks.papel;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra muda papel' using errcode = '42501';
  end if;

  select role into v_alvo from ideworks.profiles where id = p_user_id;
  if v_alvo is null then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  -- ⚠️ F17.34: quem nao se enxerga tambem nao se mexe. Vem depois da busca do
  -- papel de proposito, para que a frase seja a mesma nos dois casos.
  if not ideworks.can_see_person(p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  -- SO SUPER ADMIN CRIA SUPER ADMIN. Foi o pedido, e sem isso a hierarquia nao
  -- existe: um administrador se promoveria e a distincao viraria enfeite.
  if p_role = 'super_admin' and not ideworks.acting_is_super() then
    raise exception 'so o super admin cria outro super admin' using errcode = '42501';
  end if;

  -- E so super admin MEXE num super admin. Sem isto, um administrador
  -- rebaixaria o super admin e tomaria o lugar dele.
  if v_alvo = 'super_admin' and not ideworks.acting_is_super() then
    raise exception 'so o super admin mexe em outro super admin' using errcode = '42501';
  end if;

  -- NINGUEM SE REBAIXA: o ultimo super admin se trancaria para fora, e nao ha
  -- conserto por dentro.
  if p_user_id = ideworks.acting_user_id() and p_role <> v_alvo then
    raise exception 'voce nao pode mudar o proprio papel' using errcode = '42501';
  end if;

  update ideworks.profiles
     set role = p_role, has_all_clients_access = p_has_all_clients, updated_at = now()
   where id = p_user_id;
end;
$fn$;

create or replace function ideworks.set_user_clients(p_user_id uuid, p_client_ids uuid[])
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_n integer;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador define carteira' using errcode = '42501';
  end if;

  -- ⚠️ F17.34: a existencia e a visibilidade viram uma condicao so, e a frase e
  -- a mesma nas duas — quem administra outra empresa nao descobre daqui que a
  -- pessoa existe.
  if not exists (select 1 from ideworks.profiles where id = p_user_id)
     or not ideworks.can_see_person(p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  delete from ideworks.user_clients where user_id = p_user_id;

  insert into ideworks.user_clients (user_id, client_id)
  select p_user_id, c.id
    from ideworks.clients c
   where c.id = any(coalesce(p_client_ids, '{}'::uuid[]))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function ideworks.issue_password_reset(
    p_user_id uuid, p_code_hash text, p_expires_at timestamptz)
  returns table (new_invitation_id uuid, target_email text, revoked_count integer)
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_actor uuid := ideworks.acting_user_id();
  v_actor_email text;
  v_email text;
  v_revoked integer;
  v_id uuid;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra gera um codigo de senha' using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'sem saber quem pediu, nao ha rastro — e sem rastro nao se gera codigo'
      using errcode = '42501';
  end if;

  -- NEM PARA SI MESMO. Quem tem sessao aberta troca a senha por onde se troca
  -- senha; quem nao tem nao chega ate aqui. Permitir aqui so faria o codigo
  -- nunca sair da mao de quem o gerou.
  if v_actor = p_user_id then
    raise exception 'a recuperacao e feita por outra pessoa, e nao por voce mesmo'
      using errcode = '42501';
  end if;

  -- ⚠️ F17.34: a busca do e-mail passa a exigir a regra. Sem isto, quem
  -- administra `Ide` gerava um codigo valido para a conta de alguem da Alma 9 —
  -- e o codigo, por desenho, volta na tela de quem pediu.
  select p.email into v_email
    from ideworks.profiles p
   where p.id = p_user_id and ideworks.can_see_person(p.id);
  if v_email is null then
    raise exception 'nao ha conta do IDE Works para esta pessoa' using errcode = '42501';
  end if;

  select p.email into v_actor_email from ideworks.profiles p where p.id = v_actor;

  -- CODIGOS ANTERIORES MORREM — os dois tipos, e de proposito.
  --
  -- Deixar dois validos ao mesmo tempo dobraria a janela de quem tivesse
  -- interceptado o primeiro, e ninguem saberia qual dos dois foi usado. E o
  -- convite pendente cai junto porque a pessoa ja tem conta: aquele codigo nao
  -- tem mais o que ativar.
  with mortos as (
    update ideworks.invitations
       set status = 'revoked'
     where lower(invitations.email) = lower(v_email)
       and status = 'pending'
    returning 1)
  select count(*)::integer into v_revoked from mortos;

  insert into ideworks.invitations
    (email, code_hash, expires_at, created_by, purpose)
  values (lower(v_email), p_code_hash, p_expires_at, v_actor, 'reset')
  returning id into v_id;

  -- O RASTRO, NA MESMA TRANSACAO. Quem pediu, para quem, e quando.
  --
  -- O e-mail do alvo vai em TEXTO, e nao como referencia: quando a conta for
  -- excluida a referencia apontaria para o nada, e o livro precisa continuar
  -- legivel depois de o mundo ao redor ter mudado.
  insert into ideworks.admin_audit
    (actor_id, actor_email, action, target_id, target_email)
  values (v_actor, coalesce(v_actor_email, 'sistema'),
          'account_password_reset', p_user_id, v_email);

  return query select v_id, lower(v_email), v_revoked;
end;
$fn$;

create or replace function ideworks.revoke_invitation(p_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra cancela convite' using errcode = '42501';
  end if;

  -- Apaga, e nao marca como cancelado: convite pendente e um codigo vivo. Um
  -- registro "cancelado" que continuasse valendo seria o pior dos dois mundos.
  --
  -- ⚠️ F17.34: e so o convite que quem administra enxerga. A frase de recusa
  -- ja existente serve para os dois casos, e e a certa: para ele, aquele
  -- convite nao existe.
  delete from ideworks.invitations
   where id = p_id and status = 'pending' and ideworks.can_see_invitation(p_id);

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
  end if;
end;
$fn$;
