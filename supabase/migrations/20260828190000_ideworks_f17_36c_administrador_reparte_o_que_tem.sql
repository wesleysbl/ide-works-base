-- =============================================================================
-- IDE WORKS — F17.36c  Administrador reparte, mas so o que ele tem
-- =============================================================================
-- O PEDIDO, com o exemplo do usuario
--   "A Helena foi criada para as empresas Ide e Ide Hub, logo mesmo sendo adm,
--    ela so podera atribuir o acesso a funcionarios apenas para a Ide e Ide
--    Hub."
--
--   Ate aqui `set_user_categories` exigia `acting_is_super()`: quem administra
--   nao definia empresa nenhuma, e por isso o bloco de empresas so aparecia
--   para o super admin na tela de convite. Agora ele define — limitado ao
--   conjunto que ele proprio tem.
--
--   E ampliacao E restricao na mesma funcao, e e o par natural da F17.34: la
--   quem administra deixou de ENXERGAR pessoa de outra empresa; aqui deixa de
--   poder MANDAR alguem para fora da propria.
--
-- ⚠️ A REGRA MORA AQUI, E NAO NA TELA
--   Esconder a pilha `Alma9` da tela de quem administra `Ide` nao impede um
--   POST montado a mao. Entao a recusa e do banco: `set_user_categories` recusa
--   empresa que quem age nao possui, e a politica de escrita de `invitations`
--   recusa o mesmo pelo caminho do convite — que seria, sem ela, a porta de
--   contornar a primeira: bastaria convidar em vez de editar.
--
--   A tela apenas deixa de oferecer. Ela nao e a trava; ela e a cortesia.
--
-- ⚠️ TIRAR TAMBEM E REPARTIR, E ESSE ERA O BURACO MENOS OBVIO
--   `set_user_categories` recebe a LISTA INTEIRA e apaga o que nao vem nela.
--   Uma regra que so conferisse o que ENTRA deixaria quem administra `Ide`
--   apagar a `Alma9` de alguem por OMISSAO, sem nunca a nomear — e sem nem
--   saber que fez.
--
--   Entao o que a pessoa ja tem FORA da lista de quem age e preservado: a lista
--   recebida vale so sobre as empresas que quem age poderia ter dado.
--
-- ⚠️ O SUPER ADMIN CONTINUA REPARTINDO TUDO
--   `joana@parceira.com.br` e `super_admin` com ZERO empresas marcadas.
--   Amarra-lo a propria lista o deixaria sem poder conceder nada — o dono
--   trancado fora do proprio sistema, que e o mesmo raciocinio da F17.32.
--   Por isso `acting_is_super()` atravessa antes de qualquer conferencia.
--
-- A REGRA MORA NUMA FUNCAO SO
--   `can_grant_categories` e o unico lugar onde esta escrito "so se reparte o
--   que se tem". Duas politicas e uma funcao perguntam a ela. Repetir a
--   expressao nos tres lugares criaria tres verdades, e a que envelhecesse
--   seria a que ninguem olhou — e a F17.32 ja cobrou esse preco uma vez.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova. Uma funcao nova de PERGUNTA — `can_grant_categories`
--   —, `security definer` com `search_path = ideworks, pg_temp` pelo mesmo
--   motivo de `can_see_person`: ela LE `user_categories`, e a politica de
--   `user_categories` pergunta a `can_see_person`. Como a dona das tabelas nao
--   tem `force row level security` em nenhuma delas, a leitura de dentro da
--   funcao nao passa por politica e nao se morde.
--
--   `invitations_insert` e trocada, e nao somada: politicas permissivas se
--   somam com OU, entao uma politica NOVA ao lado da velha nao apertaria nada
--   — a velha continuaria dizendo sim sozinha. E a armadilha da F17.32b e da
--   F17.34, agora na porta de entrada em vez do `for all`.
-- =============================================================================

-- --- 1. a regra: quais empresas quem age pode repartir ------------------------
create or replace function ideworks.can_grant_categories(p_ids uuid[])
  returns boolean
  language sql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
  -- O TOPO ATRAVESSA, e ele precisa: o super admin tem zero empresas marcadas.
  select ideworks.acting_is_super()
      -- Nada a repartir e sempre permitido: e o caso de esvaziar, e de convite
      -- feito sem empresa nenhuma.
      or coalesce(array_length(p_ids, 1), 0) = 0
      -- E nao sobra nenhuma pedida fora do que quem age tem.
      or not exists (
           select 1
             from unnest(p_ids) as pedida(id)
            where not exists (
                    select 1 from ideworks.user_categories uc
                     where uc.user_id = ideworks.acting_user_id()
                       and uc.category_id = pedida.id));
$fn$;

comment on function ideworks.can_grant_categories(uuid[]) is
  'Se quem age pode conceder este conjunto de empresas — F17.36c. O super admin '
  'atravessa; quem administra so reparte o que ele proprio tem. E a mesma '
  'pergunta na ficha da pessoa e no convite, para as duas nao divergirem.';

grant execute on function ideworks.can_grant_categories(uuid[]) to ideworks_app;

-- --- 2. a ficha da pessoa ------------------------------------------------------
create or replace function ideworks.set_user_categories(p_user_id uuid, p_ids uuid[])
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_n integer;
  v_pedidas uuid[] := coalesce(p_ids, '{}'::uuid[]);
  v_fora_do_meu_alcance uuid[];
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so quem administra define empresas' using errcode = '42501';
  end if;

  if not exists (select 1 from ideworks.profiles where id = p_user_id) then
    raise exception 'pessoa nao encontrada' using errcode = '42501';
  end if;

  -- Daqui para baixo, so quem NAO e o topo.
  if not ideworks.acting_is_super() then

    -- ⚠️ "Nao encontrada", e nao "voce nao pode" — a mesma escolha de palavras
    -- da F17.34: dizer o contrario confirmaria que a pessoa existe, que e
    -- metade do que se esta protegendo.
    if not ideworks.can_see_person(p_user_id) then
      raise exception 'pessoa nao encontrada' using errcode = '42501';
    end if;

    -- Ninguem mexe nas proprias empresas. E irmao de "ninguem muda o proprio
    -- papel": esvaziar a propria lista nao da poder nenhum, mas nao tem volta —
    -- sem empresa, quem administra nao pode mais se devolver nenhuma.
    if p_user_id = ideworks.acting_user_id() then
      raise exception 'quem administra nao muda as proprias empresas' using errcode = '42501';
    end if;

    if not ideworks.can_grant_categories(v_pedidas) then
      raise exception 'voce so pode dar acesso as empresas de que participa'
        using errcode = '42501';
    end if;

    -- E o que ela ja tem fora do meu alcance nao some por omissao: entra de
    -- volta na lista antes de a lista valer.
    select coalesce(array_agg(uc.category_id), '{}'::uuid[])
      into v_fora_do_meu_alcance
      from ideworks.user_categories uc
     where uc.user_id = p_user_id
       and not exists (
             select 1 from ideworks.user_categories minha
              where minha.user_id = ideworks.acting_user_id()
                and minha.category_id = uc.category_id);

    v_pedidas := v_pedidas || v_fora_do_meu_alcance;
  end if;

  delete from ideworks.user_categories where user_id = p_user_id;

  insert into ideworks.user_categories (user_id, category_id)
  select p_user_id, c.id
    from ideworks.client_categories c
   where c.id = any(v_pedidas)
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

comment on function ideworks.set_user_categories(uuid, uuid[]) is
  'Define de quais empresas uma pessoa participa — F14, reaberta na F17.36c. O '
  'super admin da qualquer uma; quem administra da so as suas, so a quem ele '
  'enxerga, nunca a si mesmo, e o que a pessoa tem fora do alcance dele fica.';

-- --- 3. o convite, que seria a porta de contornar a de cima --------------------
-- TROCADA, e nao somada — ver o cabecalho. A permissao de escrever convite
-- continua sendo "administra"; o que se acrescenta e o limite do que ele pode
-- PROMETER.
drop policy if exists invitations_insert on ideworks.invitations;
create policy invitations_insert on ideworks.invitations for insert with check (
  ideworks.acting_is_superadmin()
  and ideworks.can_grant_categories(categories)
);
