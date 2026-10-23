-- =============================================================================
-- IDE WORKS — F2.4  Planos, categorias e etiquetas
-- =============================================================================
-- O QUE O LEGADO PRECISA DE ACAO PARA MANTER, E AQUI E IMPOSSIVEL QUEBRAR
--
--   Medido em 2026-08-20, em `public.clients` (91 linhas):
--
--     `clients.plano`     e TEXT, e NAO TEM chave estrangeira nenhuma
--     `clients.categoria` e TEXT, com chave para `client_categories.nome`
--                         e ON UPDATE CASCADE
--
--   Hoje ha ZERO clientes apontando para plano inexistente — mas nao porque o
--   banco impeca: porque as acoes `plans__rename_safe` e `plans__delete_safe`
--   da API existem para manter assim. Renomear um plano no legado e uma
--   operacao que precisa de codigo cuidadoso; renomear uma categoria REESCREVE
--   91 linhas de cliente por causa da cascata no nome.
--
--   No IDE Works a referencia e por `uuid` desde a F2.1. Renomear passa a ser
--   trocar uma palavra numa linha, e o orfao deixa de ser possivel — o que
--   aposenta as duas acoes de reparo, pelo mesmo argumento que aposentou a
--   `clients__dedupe_links` na F4.5.
--
-- O QUE FALTAVA, E ESTA MIGRATION TRAZ
--
--   1 · APAGAR CATEGORIA. `clients.category_id` e `on delete restrict`, entao
--       apagar uma categoria em uso simplesmente falha. O legado realoca os
--       clientes para a categoria padrao antes de apagar — comportamento certo,
--       e que aqui vira acao transacional em vez de duas escritas soltas a
--       cargo de quem chama.
--
--   2 · TROCAR A CATEGORIA PADRAO. Existe um indice parcial garantindo
--       EXATAMENTE UMA padrao. Isso significa que trocar exige desligar a
--       antiga e ligar a nova NA MESMA transacao — em duas chamadas, a primeira
--       ja viola o indice. Sem esta funcao, a coluna e ingerenciavel pela tela.
--
--   3 · FUNDIR ETIQUETAS. Sao 31 no legado, 5 sem uso, e ha duplicata semantica
--       inevitavel quando cada pessoa cria a sua. Fundir move as atribuicoes e
--       apaga a origem, sem deixar cliente com etiqueta repetida.
--
--   4 · ATRIBUIR ETIQUETA A CLIENTE E TRABALHO DO DIA A DIA. A politica de
--       `client_tag_assignments` exige administrador, o que esta certo para o
--       CATALOGO e errado para o vinculo: quem cuida da carteira precisa poder
--       etiquetar. Mesma solucao da F4.5 para urgencia — funcao com dono, que
--       confere `can_see_client` por dentro.
-- =============================================================================

-- --- atribuir etiquetas a um cliente -------------------------------------------
create or replace function ideworks.set_client_tags(p_client_id uuid, p_tag_ids uuid[])
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.can_see_client(p_client_id) then
    raise exception 'cliente nao encontrado ou fora do seu alcance' using errcode = '42501';
  end if;

  delete from ideworks.client_tag_assignments where client_id = p_client_id;

  -- `group by` em vez de `distinct on`: a tela pode mandar id repetido, e a
  -- chave primaria recusaria com uma mensagem que ninguem entende.
  insert into ideworks.client_tag_assignments (client_id, tag_id)
  select p_client_id, t
    from unnest(coalesce(p_tag_ids, '{}'::uuid[])) as t
   where exists (select 1 from ideworks.client_tags ct where ct.id = t)
   group by t;
end;
$fn$;

comment on function ideworks.set_client_tags(uuid, uuid[]) is
  'Troca a lista inteira de etiquetas de um cliente. Exige ENXERGAR o cliente, '
  'nao ser administrador: etiquetar e trabalho de quem cuida da carteira. '
  'Ignora id que nao existe mais, em vez de recusar a operacao inteira.';

-- --- apagar categoria, realocando ----------------------------------------------
create or replace function ideworks.delete_category(p_category_id uuid)
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_padrao    uuid;
  v_realocados integer;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador apaga categoria' using errcode = '42501';
  end if;

  select id into v_padrao from ideworks.client_categories where is_default;

  if v_padrao is null then
    raise exception 'nao ha categoria padrao para receber os clientes'
      using errcode = '22023';
  end if;

  -- Apagar a padrao deixaria a base sem destino de realocacao, e a proxima
  -- exclusao falharia sem que ninguem entendesse por que.
  if p_category_id = v_padrao then
    raise exception 'a categoria padrao nao pode ser apagada'
      using errcode = '22023';
  end if;

  update ideworks.clients
     set category_id = v_padrao, updated_at = now()
   where category_id = p_category_id;
  get diagnostics v_realocados = row_count;

  delete from ideworks.client_categories where id = p_category_id;

  if not found then
    raise exception 'categoria nao encontrada' using errcode = '42501';
  end if;

  return v_realocados;
end;
$fn$;

comment on function ideworks.delete_category(uuid) is
  'Apaga a categoria realocando os clientes para a padrao, em UMA transacao. '
  'Devolve quantos foram realocados, para a tela poder dizer o que aconteceu '
  'em vez de so "pronto". Recusa apagar a propria padrao.';

-- --- trocar a categoria padrao -------------------------------------------------
create or replace function ideworks.set_default_category(p_category_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador troca a categoria padrao' using errcode = '42501';
  end if;

  if not exists (select 1 from ideworks.client_categories where id = p_category_id) then
    raise exception 'categoria nao encontrada' using errcode = '42501';
  end if;

  -- As duas escritas na mesma transacao. O indice parcial exige EXATAMENTE uma
  -- padrao, entao ligar a nova antes de desligar a antiga viola a restricao — e
  -- em duas chamadas separadas nao ha ordem que funcione.
  update ideworks.client_categories set is_default = false, updated_at = now()
   where is_default and id <> p_category_id;

  update ideworks.client_categories set is_default = true, updated_at = now()
   where id = p_category_id;
end;
$fn$;

-- --- fundir etiquetas -----------------------------------------------------------
create or replace function ideworks.merge_tags(p_from uuid, p_into uuid)
  returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_movidos integer;
begin
  if not ideworks.acting_is_superadmin() then
    raise exception 'so administrador funde etiquetas' using errcode = '42501';
  end if;

  if p_from = p_into then
    raise exception 'origem e destino sao a mesma etiqueta' using errcode = '22023';
  end if;

  if not exists (select 1 from ideworks.client_tags where id = p_into) then
    raise exception 'etiqueta de destino nao encontrada' using errcode = '42501';
  end if;

  -- `on conflict do nothing`: cliente que ja tem as DUAS etiquetas ficaria com
  -- a de destino repetida, e a chave primaria recusaria a fusao inteira por
  -- causa de um unico caso.
  insert into ideworks.client_tag_assignments (client_id, tag_id)
  select client_id, p_into from ideworks.client_tag_assignments where tag_id = p_from
  on conflict do nothing;
  get diagnostics v_movidos = row_count;

  -- A origem some com as atribuicoes dela em cascata.
  delete from ideworks.client_tags where id = p_from;

  return v_movidos;
end;
$fn$;

comment on function ideworks.merge_tags(uuid, uuid) is
  'Move as atribuicoes da etiqueta de origem para a de destino e apaga a origem. '
  'Devolve quantos vinculos foram movidos — cliente que ja tinha as duas conta '
  'zero, porque nao havia o que mover.';

grant execute on function ideworks.set_client_tags(uuid, uuid[])   to ideworks_app;
grant execute on function ideworks.delete_category(uuid)           to ideworks_app;
grant execute on function ideworks.set_default_category(uuid)      to ideworks_app;
grant execute on function ideworks.merge_tags(uuid, uuid)          to ideworks_app;
