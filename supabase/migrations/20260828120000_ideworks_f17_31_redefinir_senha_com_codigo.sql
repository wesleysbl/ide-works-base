-- =============================================================================
-- IDE WORKS — F17.31  Redefinir senha, com codigo
-- =============================================================================
-- O QUE ESTAVA PROMETIDO E NUNCA EXISTIU
--   O rodape da tela de entrar diz, desde a F1.6: "Perdeu a senha? Um
--   administrador gera um codigo novo para voce — nao ha recuperacao
--   automatica." `src/auth/password-reset.ts` existe desde a mesma etapa, com
--   decisao, portas e auditoria — e NENHUMA rota o chamava. Nao havia botao.
--
--   Deixou de ser teorico: `gestao@exemplo.com.br` ativou a conta, escolheu
--   uma senha que foi descartada por desenho (F17.30, conta que ja existia) e
--   nao consegue entrar.
--
-- ⚠️ O NO DESTA ETAPA, E A DECISAO QUE O DESATA
--   A F17.30 estabeleceu que convite NUNCA toca senha de conta que ja existe —
--   mexer nela tira o acesso de uma pessoa real ao Sistema IDE em producao.
--   Redefinicao precisa fazer exatamente isso. Os dois nao podem ser o mesmo
--   objeto com o mesmo poder.
--
--   Entao o codigo de redefinicao e OUTRA COISA, DECLARADA: a intencao fica
--   gravada na linha do convite, e so a intencao `reset` autoriza escrever
--   senha. Codigo de convite continua incapaz de trocar senha — nao por
--   cuidado de quem chama, mas por nao ter essa permissao:
--
--     · `find_reset_account` e a UNICA porta que devolve o identificador da
--       conta para o caminho de senha, e ela so responde sobre linha `reset`.
--       Sem identificador nao ha chamada ao provedor: o caminho morre antes.
--
--     · `aplicar_convite` — que da acesso, papel, empresa e areas — passa a
--       RECUSAR linha `reset`. Sem isso, um codigo de redefinicao usado na tela
--       de ativacao reescreveria o acesso da pessoa com o padrao da linha
--       (funcionario, sem empresa, sem area). Redefinir senha nao mexe em mais
--       nada, e esta guarda e o que garante isso quando alguem escrever a rota
--       seguinte sem ler esta.
--
--   As duas guardas moram na funcao, e nao em quem chama. E a licao da F14e:
--   "nao ha caminho hoje" e propriedade do codigo de cima, que muda toda
--   semana.
--
-- O RISCO QUE FICA REGISTRADO, herdado da F1.6 e nao criado aqui
--   Quem gera o codigo PODE assumir a conta — basta usa-lo em vez de entrega-lo.
--   E inerente a administrar. O que se faz a respeito e deixar rastro: por isso
--   `issue_password_reset` grava a linha de auditoria DENTRO da mesma
--   transacao que cria o codigo. Rastro que depende de quem chama lembrar de
--   grava-lo e rastro que falta justamente no dia em que importa.
--
-- QUEM REDEFINE DE QUEM (mantido da F1.6)
--   Administrador de topo redefine a senha de outro, para o caso de alguem se
--   trancar do lado de fora. Nao pode desativa-lo nem exclui-lo — ver
--   `src/auth/session.ts`. Recuperar sim, eliminar nao.
--
--   E ninguem redefine a propria senha por aqui: quem esta com a sessao aberta
--   troca a senha por onde se troca senha, e quem nao esta nao tem como pedir.
--   Autoatendimento aqui seria so uma forma de o codigo nunca sair da mao de
--   quem o gerou.
--
-- SEGURANCA POR LINHA
--   Esta migration nao cria tabela: nao ha politica nova. A coluna nova nasce
--   coberta pelas tres politicas que `ideworks.invitations` ja tem — `_select`,
--   `_insert` e `_update` —, todas decidindo pela LINHA inteira (quem
--   administra, ou a janela de pre-autenticacao). Nao ha permissao por coluna
--   nesta tabela, entao quem nao lia o convite continua sem ler a intencao.
--
--   As duas funcoes novas sao `security definer`, e por isso carregam as
--   proprias guardas no corpo: `execute` revogado de PUBLIC e concedido so ao
--   papel da aplicacao.
-- =============================================================================

-- --- a intencao ---------------------------------------------------------------
-- Enum, e nao texto com valor padrao: a regra 3 do roteiro mestre. Um valor
-- desconhecido tem que falhar alto — foi texto livre com queda silenciosa que
-- fez o legado dar peso 1 a video.
do $$ begin
  create type ideworks.invitation_purpose as enum ('invite', 'reset');
exception when duplicate_object then null; end $$;

alter table ideworks.invitations
  add column if not exists purpose ideworks.invitation_purpose not null default 'invite';

comment on column ideworks.invitations.purpose is
  'Para que serve este codigo: dar acesso (`invite`) ou trocar a senha de quem '
  'ja tem conta (`reset`). NAO e rotulo: e permissao. So a linha `reset` abre a '
  'porta que escreve senha, e so a linha `invite` e aceita por aplicar_convite. '
  'O padrao e `invite` porque toda linha criada antes da F17.31 e convite.';

comment on table ideworks.invitations is
  'Convite de acesso e codigo de redefinicao de senha, separados pela coluna '
  '`purpose`. Ate a F17.30 redefinir era ativar de novo; deixou de ser quando '
  'ativar passou a VINCULAR conta existente sem tocar na senha dela.';

-- --- aplicar_convite passa a recusar codigo de redefinicao --------------------
-- O corpo e o mesmo da F17.29, com UMA guarda a mais e a leitura da intencao.
-- Reescrito inteiro porque `create or replace` nao remenda corpo — e a guarda
-- da F14e continua sendo a primeira coisa que ele faz.
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
  if v_purpose <> 'invite' then
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
  'numa transacao so. RECUSA codigo de redefinicao de senha (F17.31): aquele '
  'nasce sem acesso escolhido, e aplica-lo apagaria a empresa e as areas de '
  'quem so quis trocar a senha.';

-- --- quem administra emite o codigo de redefinicao ---------------------------
-- ESTA FUNCAO ESCREVE TRES COISAS OU NENHUMA: mata os codigos pendentes
-- anteriores daquele endereco, cria o codigo novo e grava o rastro. Separar em
-- passos deixaria o dia em que o terceiro falha sem registro nenhum de que os
-- dois primeiros aconteceram — e o registro e o unico contrapeso ao risco de
-- quem gera o codigo poder usa-lo.
create or replace function ideworks.issue_password_reset(
  p_user_id uuid, p_code_hash text, p_expires_at timestamptz
) returns table (new_invitation_id uuid, target_email text, revoked_count integer)
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

  select p.email into v_email from ideworks.profiles p where p.id = p_user_id;
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

revoke all on function ideworks.issue_password_reset(uuid, text, timestamptz) from public;
grant execute on function ideworks.issue_password_reset(uuid, text, timestamptz) to ideworks_app;

comment on function ideworks.issue_password_reset(uuid, text, timestamptz) is
  'Emite o codigo de redefinicao de senha de outra pessoa: mata os codigos '
  'pendentes anteriores do endereco, cria o novo com intencao `reset` e grava '
  'o rastro — as tres coisas ou nenhuma. So quem administra, e nunca para si '
  'mesmo. Devolve o identificador da linha criada e quantas morreram; o codigo '
  'em si nunca passa por aqui, so a impressao digital dele.';

-- --- a unica porta que abre o caminho da senha -------------------------------
create or replace function ideworks.find_reset_account(p_email text, p_invitation_id uuid)
  returns uuid
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  select u.id
    from auth.users u
    join ideworks.invitations i on i.id = p_invitation_id
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
     and lower(btrim(coalesce(p_email, ''))) <> ''
     -- a intencao declarada, que e a invariante desta etapa
     and i.purpose = 'reset'
     and lower(i.email) = lower(u.email)
     and i.status = 'pending'
     and i.expires_at > now()
     -- a mesma janela da F17.30: pre-autenticacao, ou quem administra
     and (ideworks.is_preauth() or ideworks.acting_is_superadmin())
   limit 1;
$fn$;

revoke all on function ideworks.find_reset_account(text, uuid) from public;
grant execute on function ideworks.find_reset_account(text, uuid) to ideworks_app;

comment on function ideworks.find_reset_account(text, uuid) is
  'Devolve o identificador da conta de login cuja senha este codigo autoriza '
  'trocar, e SO isso. Nulo quando a linha nao e de redefinicao, quando ela ja '
  'foi usada, quando venceu, quando o endereco nao bate e quando nao ha conta '
  '— os casos sao indistinguiveis de proposito, como na F17.30. Ela LE: nao '
  'escreve, nao confere senha, nao cria e nao apaga conta. E a unica porta que '
  'devolve identificador para o caminho que escreve senha, e e por ela que '
  'codigo de convite nao troca senha de ninguem.';

-- --- a fila mostra os dois, porque codigo pendente e credencial viva ---------
-- Ate aqui a fila listava "quem foi convidado e ainda nao entrou". Um codigo de
-- redefinicao pendente NAO e isso — mas esconde-lo seria pior: e uma credencial
-- viva, com 72 horas de validade, e quem administra precisa ver que ela existe
-- para poder cancela-la. `revoke_invitation` ja apaga qualquer linha pendente,
-- entao o cancelar da tela ja serve para as duas.
--
-- O tipo de retorno muda, e por isso a funcao cai antes: `create or replace`
-- nao troca assinatura de retorno.
drop function if exists ideworks.admin_pending_invitations();

create function ideworks.admin_pending_invitations()
  returns table (
    id uuid, email text, expires_at timestamptz,
    failed_attempts integer, created_at timestamptz, vencido boolean,
    purpose ideworks.invitation_purpose
  )
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
     order by i.created_at desc;
end;
$fn$;

revoke all on function ideworks.admin_pending_invitations() from public;
grant execute on function ideworks.admin_pending_invitations() to ideworks_app;

comment on function ideworks.admin_pending_invitations() is
  'Os codigos que existem e ainda nao foram usados — de acesso e de senha, '
  'ditos pela intencao. O de senha entra aqui desde a F17.31 porque codigo '
  'pendente e credencial viva: escondido, ninguem o cancelaria.';
