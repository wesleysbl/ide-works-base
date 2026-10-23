-- =============================================================================
-- IDE WORKS — F17.29  A pessoa tem nome
-- =============================================================================
-- O BURACO, MEDIDO ANTES DE ESCREVER
--   O convite pedia e-mail, papel, telas e empresas. A ativacao pedia e-mail,
--   codigo e senha. `profiles.full_name` existia, anulavel, e NADA no percurso
--   inteiro a preenchia. Quem entrasse pelo fluxo de hoje nasceria sem nome e
--   apareceria como `atendimento@…` na lista de responsaveis, nos avatares do
--   cartao, nos comentarios e em quem observa.
--
--   `team_directory()` ja fazia `coalesce(full_name, email)` — o remendo que
--   escondia o buraco, e que CONTINUA aqui: ele e a rede de quem nao tem nome,
--   e tirar a rede junto com o conserto deixaria as duas pessoas de antes sem
--   as duas coisas.
--
-- OS DOIS LUGARES
--   Quem convida SUGERE; quem ativa CONFIRMA ou corrige. Cada metade cobre o
--   risco da outra: so no convite, alguem escreve errado o nome de outra
--   pessoa e ela nao tem como consertar; so na ativacao, a pessoa pula o campo
--   e o nome fica vazio de novo. Esta coluna e a metade que espera — o lugar
--   onde a sugestao de quem convidou fica guardada ate a pessoa chegar.
--
-- POR QUE ANULAVEL, E NAO `not null`
--   Ha convites pendentes criados ANTES desta etapa. `not null` obrigaria um
--   valor de enchimento para eles, e nome inventado e pior que nome ausente:
--   um se ve, o outro se acredita. Convite antigo continua ativavel, e quem
--   ativa por ele so nao ganha sugestao nenhuma.
--
--   A obrigatoriedade mora na ROTA do convite, e nao aqui: e la que existe
--   quem convidou, para receber a recusa e digitar o nome. O banco, se
--   recusasse, recusaria tambem os convites que ja estao no ar.
--
-- SEGURANCA POR LINHA
--   `ideworks.invitations` ja tem RLS ligada e tres politicas — `_select`,
--   `_insert` e `_update` — e todas as tres decidem pela LINHA inteira: quem
--   administra, ou quem esta na janela de pre-autenticacao. Nao ha permissao
--   por coluna nesta tabela, entao a coluna nova nasce coberta pelas mesmas
--   tres, sem superficie nova. Quem nao podia ler o convite continua sem ler o
--   nome.
-- =============================================================================

alter table ideworks.invitations
  add column if not exists full_name text;

comment on column ideworks.invitations.full_name is
  'O nome sugerido por quem convidou. E sugestao, e nao decisao: a ativacao '
  'mostra este valor ja preenchido e quem ativa pode corrigi-lo. Anulavel de '
  'proposito — convite criado antes da F17.29 nao tem nome, e inventar um '
  'seria pior. Quem cobra o preenchimento e a rota do convite, onde existe '
  'quem convidou para receber a recusa.';

-- --- a ativacao passa a gravar o nome ----------------------------------------
-- NA MESMA TRANSACAO DA SENHA, e nao num passo depois. Perfil, empresa, areas,
-- papel e nome nascem juntos ou nao nascem: um passo separado e um passo que
-- falha sozinho, e a pessoa ja entrou — ninguem volta para conferir.
--
-- A REGRA DO NOME, EM UMA LINHA: vale o que a pessoa escreveu; se ela nao
-- escreveu nada, vale a sugestao de quem convidou; se nao ha nem uma nem
-- outra, o nome fica como estava. Vazio NUNCA apaga nome que ja existe.
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
begin
  -- A GUARDA DA F14e CONTINUA A PRIMEIRA COISA. Ela e o que impede esta
  -- funcao, que e SECURITY DEFINER e concede acesso, de depender inteiramente
  -- de a rota de cima estar correta. Reescrever o corpo sem ela seria desfazer
  -- em silencio uma correcao de auditoria.
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra aplica um convite' using errcode = '42501';
  end if;

  select categories, areas, role, full_name
    into v_categories, v_areas, v_role, v_sugerido
    from ideworks.invitations
   where id = p_invitation_id and status = 'pending';

  if not found then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
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

grant execute on function ideworks.aplicar_convite(uuid, text, uuid, text) to ideworks_app;

comment on function ideworks.aplicar_convite(uuid, text, uuid, text) is
  'Cria o perfil E aplica nome, empresa, areas e papel prometidos no convite, '
  'numa transacao so. Metade aplicada deixaria a pessoa dentro com acesso que '
  'ninguem escolheu, ou sem nome nenhum. O nome escrito por quem ativa vence a '
  'sugestao de quem convidou; vazio nao apaga nome que ja existe.';

-- A ASSINATURA DE TRES ARGUMENTOS SAI, e nao fica convivendo com a nova.
-- Duas versoes conviveriam com uma rota chamando a que IGNORA o nome, e nome
-- perdido em silencio e exatamente o defeito que esta etapa conserta.
drop function if exists ideworks.aplicar_convite(uuid, text, uuid);
