-- =============================================================================
-- IDE WORKS — F17.34b  A regra do convite parou de LER a tabela do convite
-- =============================================================================
-- ⚠️ A ARMADILHA DA F17.32b MORDEU DE NOVO, E DESTA VEZ NA HORA CERTA
--   A F17.34 escreveu `can_see_invitation(uuid)`: recebe o identificador e vai
--   BUSCAR a linha em `ideworks.invitations`. A politica de leitura da propria
--   tabela passou a chamar essa funcao. Medido logo depois de aplicar:
--
--     scripts/provar-nome-da-pessoa.mjs    -> new row violates row-level
--     scripts/provar-redefinir-senha.mjs      security policy for "invitations"
--
--   Nao era escrita barrada: era `insert ... returning id`. O `returning` exige
--   que a politica de SELECT aprove a linha RECEM-CRIADA, e a funcao e `stable`
--   — ela enxerga o retrato do banco de ANTES da instrucao, onde a linha ainda
--   nao existe. A funcao respondia "esse convite nao existe" sobre o convite
--   que estava nascendo.
--
--   E o mesmo defeito que a F17.32b mediu em `ideworks.clients`, com uma
--   diferenca que importa: la a causa era `for all` incluir `select`, aqui e a
--   regra LER a tabela que a regra protege. Auto-referencia.
--
-- A SAIDA NAO E MUDAR O SERVIDOR — E TIRAR A AUTO-REFERENCIA
--   A F17.32b resolveu o caso dela mandando `src/server/client-write.ts` gerar
--   o `uuid` do lado de fora e inserir sem `returning`. Aqui isso seria remedio
--   pior que a doenca: nao ha nada de errado com `insert ... returning` num
--   convite, e a proibicao valeria para sempre, para todo mundo, por causa de
--   uma escolha de assinatura.
--
--   `can_see_invitation` passa a receber as TRES colunas de que a regra
--   precisa, em vez do identificador:
--
--     can_see_invitation(p_email text, p_created_by uuid, p_categories uuid[])
--
--   Assim a politica avalia a regra sobre a linha que tem em maos — a nova
--   inclusive — e nao volta a tabela para procura-la. As unicas leituras que
--   sobram dentro da funcao sao `profiles` e `user_categories`, que nao sao a
--   tabela protegida por ela, entao nao ha retrato velho para atrapalhar.
--
--   ⚠️ A REGRA CONTINUA MORANDO EM UM LUGAR SO. A alternativa obvia — copiar a
--   condicao para dentro da politica, escrita a mao — resolveria o `returning`
--   e reabriria o problema que a F17.32 nomeou: condicao copiada em dois
--   lugares nao da erro quando alguem esquece um, da vazamento calado.
--
-- O QUE MUDA DE COMPORTAMENTO: NADA
--   Os tres ramos sao os mesmos, palavra por palavra — o topo atravessa; quem
--   administra ve o proprio convite, o convite de quem ele ja enxerga, e o
--   convite sem empresa marcada. Medido antes e depois, agindo como
--   `ideworks_app`: `gestao@` e `atendimento@` continuam lendo 11 dos 12
--   convites, e o super admin, 12.
--
--   O que muda e que `insert ... returning` volta a funcionar em
--   `ideworks.invitations` — e ha asserção guardando isso, em
--   `scripts/provar-pessoas-por-empresa.mjs`, para o dia em que alguem
--   reescrever esta funcao com a assinatura antiga.
--
-- `revoke_invitation` VOLTA A BUSCAR A LINHA, E ISSO ESTA CERTO
--   Ela recebe um identificador, e nao uma linha. Entao ela le a linha e SO
--   DEPOIS pergunta a regra. Ali nao ha retrato velho: a linha ja existia antes
--   da instrucao.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova, nenhuma politica nova. Duas politicas trocam a chamada
--   e a funcao velha e apagada no fim — deixa-la de pe daria duas versoes da
--   mesma regra vivendo juntas, que e como uma delas envelhece sem ninguem ver.
-- =============================================================================

-- --- 1. a regra, agora sobre a LINHA e nao sobre o identificador -------------
create or replace function ideworks.can_see_invitation(
    p_email text, p_created_by uuid, p_categories uuid[])
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- o topo atravessa
  select ideworks.acting_is_super()

      -- e so quem administra ve fila de convite, como sempre foi
      or (ideworks.acting_is_superadmin() and (

           -- FOI VOCE QUEM CONVIDOU: ninguem perde de vista o proprio convite.
           -- E o equivalente, para o convite, de "ninguem some da propria tela"
           -- — e e este ramo que faz `insert ... returning` passar, porque ele
           -- se decide so com a coluna que a instrucao acabou de escrever.
           p_created_by = ideworks.acting_user_id()

           -- JA HA CONTA COM ESTE E-MAIL: o convite segue a PESSOA. Sem isto um
           -- codigo de senha, que nasce sem empresa marcada, entregaria o
           -- e-mail de quem e de outra empresa pelo ramo de baixo.
           or exists (
                select 1 from ideworks.profiles p
                 where lower(p.email) = lower(p_email)
                   and ideworks.can_see_person(p.id))

           -- AINDA NAO HA CONTA: vale a empresa marcada NO CONVITE, pela mesma
           -- regra de tres ramos — compartilha, ou nenhuma marcada.
           or (not exists (
                 select 1 from ideworks.profiles p
                  where lower(p.email) = lower(p_email))
               and (coalesce(array_length(p_categories, 1), 0) = 0
                    or exists (
                         select 1 from ideworks.user_categories minha
                          where minha.user_id = ideworks.acting_user_id()
                            and minha.category_id = any(p_categories))))
         ))
$fn$;

comment on function ideworks.can_see_invitation(text, uuid, uuid[]) is
  'A UNICA regra de quem enxerga qual convite — F17.34, com a assinatura da '
  'F17.34b. Recebe as colunas da LINHA, e nao o identificador: assim a politica '
  'nao volta a `invitations` para se responder, e `insert ... returning` '
  'continua funcionando. Se ja ha conta com o e-mail, o convite segue a pessoa; '
  'se nao ha, vale a empresa marcada nele; quem convidou sempre ve o proprio.';

grant execute on function ideworks.can_see_invitation(text, uuid, uuid[]) to ideworks_app;

-- --- 2. as duas politicas passam a perguntar sobre a linha -------------------
drop policy if exists invitations_select on ideworks.invitations;
create policy invitations_select on ideworks.invitations for select using (
  -- `is_preauth` continua primeiro: e o login e a ativacao, que acontecem antes
  -- de existir pessoa declarada.
  ideworks.is_preauth()
  or ideworks.can_see_invitation(email, created_by, categories)
);

drop policy if exists invitations_update on ideworks.invitations;
create policy invitations_update on ideworks.invitations for update
  using (
    ideworks.is_preauth()
    or (ideworks.acting_is_superadmin()
        and ideworks.can_see_invitation(email, created_by, categories)))
  with check (ideworks.acting_is_superadmin() or ideworks.is_preauth());

-- --- 3. a fila e o cancelamento ----------------------------------------------
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
       and ideworks.can_see_invitation(i.email, i.created_by, i.categories)
     order by i.created_at desc;
end;
$fn$;

comment on function ideworks.admin_pending_invitations() is
  'Os codigos que existem e ainda nao foram usados — de acesso e de senha, '
  'ditos pela intencao. O de senha entra aqui desde a F17.31 porque codigo '
  'pendente e credencial viva: escondido, ninguem o cancelaria. F17.34: a fila '
  'passou a respeitar a empresa, pela regra de `can_see_invitation`.';

revoke all on function ideworks.admin_pending_invitations() from public;
grant execute on function ideworks.admin_pending_invitations() to ideworks_app;

create or replace function ideworks.revoke_invitation(p_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_email text;
  v_created_by uuid;
  v_categories uuid[];
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra cancela convite' using errcode = '42501';
  end if;

  -- ⚠️ F17.34b: aqui a busca da linha esta CERTA, ao contrario da politica. A
  -- funcao recebe um identificador, nao uma linha, e a linha ja existia antes
  -- desta instrucao — nao ha retrato velho para atrapalhar.
  select i.email, i.created_by, i.categories
    into v_email, v_created_by, v_categories
    from ideworks.invitations i
   where i.id = p_id and i.status = 'pending';

  -- ⚠️ F17.34: e so o convite que quem administra enxerga. A frase e a mesma
  -- nos dois casos de proposito: para ele, aquele convite nao existe.
  if not found or not ideworks.can_see_invitation(v_email, v_created_by, v_categories) then
    raise exception 'convite nao encontrado ou ja usado' using errcode = '42501';
  end if;

  -- Apaga, e nao marca como cancelado: convite pendente e um codigo vivo. Um
  -- registro "cancelado" que continuasse valendo seria o pior dos dois mundos.
  delete from ideworks.invitations where id = p_id and status = 'pending';
end;
$fn$;

-- --- 4. e a assinatura velha sai ---------------------------------------------
--
-- ⚠️ Por ultimo, e depois de nada mais chamar por ela: duas versoes da mesma
-- regra vivendo juntas e como uma delas envelhece sem ninguem ver.
drop function if exists ideworks.can_see_invitation(uuid);
