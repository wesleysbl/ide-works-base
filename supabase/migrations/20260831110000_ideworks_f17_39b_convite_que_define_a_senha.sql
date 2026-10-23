-- =============================================================================
-- IDE WORKS — F17.39b  O convite de quem ja tem conta define a senha
-- =============================================================================
-- Esta e a metade que USA o valor criado na F17.39. As duas andam juntas: sem a
-- anterior, esta nem compila.
--
-- AS TRES INTENCOES, DEPOIS DESTA MIGRATION
--
--   `invite`                — conta nova. Aplica acesso. NAO toca senha.
--   `invite_with_password`  — a conta ja existe. Aplica acesso E define senha.
--   `reset`                 — so a senha. NAO da acesso nenhum.
--
--   As duas primeiras sao aceitas por `aplicar_convite`; a terceira continua
--   recusada, palavra por palavra, com a guarda da F17.31. E `find_reset_account`
--   continua respondendo SO sobre `reset` — ela nao ganha um irmao mais
--   permissivo, ganha um irmao SEPARADO, com a intencao dele no `where`.
--
-- ⚠️ TRES PORTAS, TRES INTENCOES, E NENHUMA DELAS ABRE A DO LADO
--   A licao da F17.31 e que a guarda mora na funcao, e nao em quem chama: "nao
--   ha caminho hoje" e propriedade do codigo de cima, que muda toda semana.
--   Entao cada caminho tem a propria porta, e cada porta so responde sobre a
--   propria intencao:
--
--     · `find_existing_account`  (F17.30) — vincula, e a senha nao e tocada;
--     · `find_invite_account`    (aqui)   — vincula E autoriza escrever a senha;
--     · `find_reset_account`     (F17.31) — so a senha.
--
--   Trocar a intencao de uma linha e um `update` que a politica de `invitations`
--   ja recorta por administrador; e mesmo quem conseguisse faze-lo nao ganharia
--   nada que convidar de novo nao desse.
--
-- ⚠️ QUEM PERGUNTA "ESTE E-MAIL JA TEM CONTA?", E ONDE
--   Na hora do CONVITE, com quem administra autenticado — e nunca na tela de
--   ativacao, onde perguntar seria a enumeracao de usuarios que a F17.30 fechou
--   (`src/auth/activation.ts` gasta uma secao inteira nisso).
--
--   E a resposta NAO VOLTA PARA QUEM PERGUNTOU. `purpose_for_new_invitation` e
--   consumida DENTRO do proprio `insert` que cria o convite: a rota escreve o
--   valor sem nunca te-lo em maos. Se a tela de quem convida dissesse "esta
--   pessoa ja tem conta", ela viraria um oraculo para administrador descobrir
--   quem tem conta fora da propria empresa — justo depois de a F17.34 ter
--   fechado isso.
--
--   ⚠️ E POR ISSO A FILA TAMBEM PAROU DE DIZER A INTENCAO CRUA. Ver o comentario
--   de `admin_pending_invitations` mais abaixo: e la que este vazamento seria
--   inevitavel, e e la que ele e fechado.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova, nenhuma politica nova. As duas funcoes novas sao
--   `security definer` — uma porque precisa alcancar o cadastro de login, que o
--   papel da aplicacao nao alcanca (medido na F17.30: sem `usage` no schema
--   `auth`), a outra pelo mesmo motivo —, e por isso carregam as proprias
--   guardas no corpo, com `execute` revogado de PUBLIC e concedido so a
--   `ideworks_app`.
-- =============================================================================

-- --- 1. a decisao, tomada na hora do convite ---------------------------------
--
-- ⚠️ ELA DECIDE, NAO RELATA. A diferenca importa: o valor devolvido e o que vai
-- na coluna `purpose` da linha que esta nascendo, e a rota o usa DENTRO do
-- `insert`, sem le-lo. Nenhuma resposta desta funcao chega a uma tela.
--
-- A GUARDA: so quem administra. E o mesmo teto da guarda 1 da F17.30, e aqui
-- ela nao pode ganhar a companheira de la — "so responde quando ja ha convite
-- pendente" — porque o convite e exatamente o que ainda nao existe quando esta
-- pergunta e feita. O que sobra no lugar e o consumo em linha: quem administra
-- ja decidiu dar acesso aquele endereco, e nao recebe de volta nada sobre ele.
create or replace function ideworks.purpose_for_new_invitation(p_email text)
  returns ideworks.invitation_purpose
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra convida' using errcode = '42501';
  end if;

  if v_email = '' then
    raise exception 'convite sem endereco' using errcode = '22023';
  end if;

  -- ENDERECO COM DONO: o convite ja nasce autorizado a definir a senha. E o
  -- caso da MAIORIA — as 30 pessoas do legado tem conta —, e e por isso que a
  -- tela de ativacao pode enfim cumprir o que promete no botao.
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return 'invite_with_password';
  end if;

  -- SEM CONTA: o caminho de sempre. A conta nasce com a senha escolhida, e
  -- ninguem precisa de autorizacao para escrever senha que ainda nao existe.
  return 'invite';
end;
$fn$;

revoke all on function ideworks.purpose_for_new_invitation(text) from public;
grant execute on function ideworks.purpose_for_new_invitation(text) to ideworks_app;

comment on function ideworks.purpose_for_new_invitation(text) is
  'Com que intencao nasce o convite deste endereco: `invite_with_password` '
  'quando ja ha conta de login, `invite` quando nao ha. So quem administra. '
  'Ela DECIDE, nao relata: a rota a usa dentro do proprio insert e nunca le a '
  'resposta — se a tela de quem convida soubesse, ela viraria um oraculo de '
  'quais e-mails tem conta. Ela LE o cadastro e nada mais: nao cria, nao apaga '
  'e nunca toca em senha.';

-- --- 2. a porta que autoriza a senha do convite ------------------------------
--
-- Irma de `find_reset_account`, e SEPARADA dela de proposito: cada uma tem a
-- propria intencao no `where`, e nenhuma responde sobre a linha da outra. Sem
-- identificador nao ha chamada ao provedor — o caminho morre antes.
create or replace function ideworks.find_invite_account(p_email text, p_invitation_id uuid)
  returns uuid
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select u.id
    from auth.users u
    join ideworks.invitations i on i.id = p_invitation_id
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
     and lower(btrim(coalesce(p_email, ''))) <> ''
     -- a intencao declarada, que e a invariante desta etapa: um convite comum
     -- continua sem devolver identificador nenhum por aqui
     and i.purpose = 'invite_with_password'
     and lower(i.email) = lower(u.email)
     and i.status = 'pending'
     and i.expires_at > now()
     -- a mesma janela da F17.30 e da F17.31: pre-autenticacao, ou quem administra
     and (ideworks.is_preauth() or ideworks.acting_is_superadmin())
   limit 1;
$fn$;

revoke all on function ideworks.find_invite_account(text, uuid) from public;
grant execute on function ideworks.find_invite_account(text, uuid) to ideworks_app;

comment on function ideworks.find_invite_account(text, uuid) is
  'Devolve o identificador da conta de login cuja senha ESTE convite autoriza '
  'definir, e SO isso. Nulo quando a linha e `invite` comum, quando e `reset`, '
  'quando ja foi usada, quando venceu, quando o endereco nao bate e quando nao '
  'ha conta — os casos sao indistinguiveis de proposito, como na F17.30. Ela '
  'LE: nao escreve, nao confere senha, nao cria e nao apaga conta. E a unica '
  'porta que devolve identificador para o caminho em que o convite escreve '
  'senha, e e por ela que a invariante da F17.30 continua de pe: convite comum '
  'nao troca senha de ninguem.';

-- --- 3. aplicar_convite aceita as DUAS formas de convite ---------------------
--
-- O corpo e o mesmo da F17.31, com UMA lista onde havia uma desigualdade.
-- Reescrito inteiro porque `create or replace` nao remenda corpo — e a guarda
-- da F14e continua sendo a primeira coisa que ele faz.
--
-- ⚠️ A LISTA E EXPLICITA, E NAO `<> 'reset'`. Sao a mesma coisa hoje e deixam
-- de ser no dia em que nascer a quarta intencao: uma lista fecha a porta ao
-- valor novo por padrao, e uma desigualdade a abre. A guarda da F17.31 nao pode
-- depender de nunca mais haver um valor novo neste tipo.
create or replace function ideworks.aplicar_convite(
  p_user_id uuid, p_email text, p_invitation_id uuid, p_full_name text
) returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_categories uuid[];
  v_areas ideworks.area[];
  v_role ideworks.papel;
  v_sugerido text;
  v_nome text;
  v_purpose ideworks.invitation_purpose;
begin
  -- A GUARDA DA F14e CONTINUA A PRIMEIRA COISA. Ela e o que impede esta
  -- funcao, que e SECURITY DEFINER e concede acesso, de depender inteiramente
  -- de a rota de cima estar correta. Reescrever o corpo sem ela seria desfazer
  -- em silencio uma correcao de auditoria.
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra aplica um convite' using errcode = '42501';
  end if;

  select categories, areas, role, full_name, purpose
    into v_categories, v_areas, v_role, v_sugerido, v_purpose
    from ideworks.invitations
   where id = p_invitation_id and status = 'pending';

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
  end if;

  -- A GUARDA DA F17.31, e ela e simetrica a da porta de senha.
  --
  -- Um codigo de redefinicao nasce sem papel, sem empresa e sem area
  -- escolhidos: os valores padrao da linha. Aceita-lo aqui reescreveria o
  -- acesso da pessoa com esse vazio — ela perderia empresa e areas por ter
  -- trocado a propria senha. Redefinir senha nao mexe em mais nada.
  --
  -- F17.39b: `invite_with_password` entra nesta conta EXPLICITAMENTE, e nao por
  -- brecha. Ela e um convite — nasce com papel, empresas e areas escolhidos por
  -- quem convidou, exatamente como `invite`. O que ela tem a mais mora do outro
  -- lado, em `find_invite_account`, e nao aqui: esta funcao nao escreve senha
  -- nenhuma, nem sabe o que e uma.
  if v_purpose not in ('invite', 'invite_with_password') then
    raise exception 'este codigo serve para escolher uma senha nova, e nao para dar acesso'
      using errcode = '42501';
  end if;

  -- ESPACO DE SOBRA NAO ENTRA: pontas cortadas, espaco do meio juntado.
  --
  -- A rota ja faz o mesmo antes de chamar, e mesmo assim isto fica aqui: a
  -- rota muda toda semana e o dado fica. Medido — sem esta linha, "Nome   Que
  -- A Pessoa Digitou" entrava com os tres espacos.
  --
  -- E so espaco em branco e o mesmo que nada: um campo com um espaco dentro
  -- viraria um nome de exibicao INVISIVEL — pior que vazio, porque o
  -- `coalesce` de quem exibe acharia que ha nome e nao mostraria o e-mail.
  v_nome := coalesce(
    nullif(regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), ''),
    nullif(regexp_replace(btrim(coalesce(v_sugerido, '')), '\s+', ' ', 'g'), ''));

  insert into ideworks.profiles (id, email, full_name, is_active, role)
  values (p_user_id, p_email, v_nome, true, v_role)
  on conflict (id) do update set
    is_active = true,
    role = excluded.role,
    -- `coalesce` e nao `excluded.full_name` seco: ativar de novo sem nome
    -- nenhum nao pode apagar o nome que a pessoa ja tem.
    full_name = coalesce(excluded.full_name, ideworks.profiles.full_name),
    updated_at = now();

  -- `areas` vazio quer dizer "nao foi escolhido", e nao "nenhuma": convite
  -- criado antes da F14d tem o padrao da coluna. Mexer nele apagaria o
  -- acesso que a coluna de `profiles` ja daria.
  if array_length(v_areas, 1) is not null then
    update ideworks.profiles set areas = v_areas, updated_at = now()
     where id = p_user_id;
  end if;

  -- Empresas SUBSTITUEM o que houver: quem convidou decidiu a lista inteira.
  delete from ideworks.user_categories where user_id = p_user_id;
  if array_length(v_categories, 1) is not null then
    insert into ideworks.user_categories (user_id, category_id)
    select p_user_id, unnest(v_categories)
    on conflict do nothing;
  end if;

  update ideworks.invitations
     set status = 'used', used_at = now()
   where id = p_invitation_id;
end;
$fn$;

comment on function ideworks.aplicar_convite(uuid, text, uuid, text) is
  'Cria o perfil E aplica nome, empresa, areas e papel prometidos no convite, '
  'numa transacao so. Aceita as duas formas de convite — `invite` e '
  '`invite_with_password` (F17.39b) —, e RECUSA codigo de redefinicao de senha '
  '(F17.31): aquele nasce sem acesso escolhido, e aplica-lo apagaria a empresa '
  'e as areas de quem so quis trocar a senha. A lista e explicita para que a '
  'quarta intencao, quando houver, nasca recusada.';

-- --- 4. a fila diz o TIPO do codigo, e nao a intencao crua -------------------
--
-- ⚠️ ESTA E A GUARDA DA F17.39 CONTRA O ORACULO, e ela esta aqui, e nao na tela.
--
--   A fila de codigos em aberto e a UNICA porta pela qual `purpose` chegava a
--   quem administra. Deixa-la devolver `invite_with_password` faria a tela de
--   Pessoas dizer, sem querer, quais dos convidados ja tinham conta — inclusive
--   os de outra empresa que a regra de `can_see_invitation` deixa passar por
--   serem convite proprio. Seria devolver com uma mao o que a F17.34 tirou com
--   a outra.
--
--   Entao a fila responde a pergunta que ela sempre respondeu — "este codigo da
--   ACESSO ou troca SENHA?" —, e nao "com que intencao exata a linha nasceu".
--   `invite_with_password` E um codigo de acesso: dizer `invite` aqui nao e
--   esconder, e responder a pergunta certa.
--
--   O resto da funcao e o mesmo da F17.34b, palavra por palavra.
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
           i.expires_at < now(),
           -- ⚠️ F17.39b: o TIPO do codigo, e nao a intencao crua. Ver acima.
           case when i.purpose = 'reset' then 'reset'::ideworks.invitation_purpose
                else 'invite'::ideworks.invitation_purpose end
      from ideworks.invitations i
     where i.status = 'pending'
       -- ⚠️ F17.34. A fila mostrava o e-mail de quem esta sendo convidado para
       -- QUALQUER empresa.
       and ideworks.can_see_invitation(i.email, i.created_by, i.categories)
     order by i.created_at desc;
end;
$fn$;

comment on function ideworks.admin_pending_invitations() is
  'Os codigos que existem e ainda nao foram usados — de acesso e de senha, '
  'ditos pela intencao. O de senha entra aqui desde a F17.31 porque codigo '
  'pendente e credencial viva: escondido, ninguem o cancelaria. F17.34: a fila '
  'passou a respeitar a empresa, pela regra de `can_see_invitation`. F17.39b: '
  'ela devolve o TIPO do codigo — acesso ou senha —, e nao a intencao crua; '
  'distinguir `invite` de `invite_with_password` contaria a quem administra '
  'quais convidados ja tinham conta de login.';

revoke all on function ideworks.admin_pending_invitations() from public;
grant execute on function ideworks.admin_pending_invitations() to ideworks_app;
