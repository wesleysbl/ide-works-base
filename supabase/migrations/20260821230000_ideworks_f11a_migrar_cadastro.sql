-- =============================================================================
-- IDE WORKS — F11a  Trazer o cadastro do Sistema IDE
-- =============================================================================
-- POR QUE ISTO MORA NO BANCO, E NAO NUM SCRIPT
--   O papel da aplicacao, `ideworks_app`, NAO alcanca o schema `public` — zero
--   permissoes em tabela, nao herda de ninguem, nao ignora RLS. Isso e a
--   garantia de que o IDE Works nunca escreve no sistema que a agencia usa, e
--   nao vai ser afrouxada por causa da migracao.
--
--   Entao a ponte e uma funcao com dono: le `public`, escreve `ideworks`, e
--   nunca o contrario. Versionada, revisavel, e chamavel so por super admin.
--
-- ENSAIO E O MODO NORMAL
--   `migracao_clientes_previa()` nao escreve nada. Ela responde "o que
--   aconteceria", linha por linha. E para ser rodada muitas vezes, ate os
--   avisos pararem de surpreender.
--
-- REPETIVEL DE PROPOSITO: O ID DO LEGADO E MANTIDO
--   O cliente entra com o MESMO uuid que tem la. Duas consequencias, e as duas
--   sao o ponto:
--
--     1. Rodar de novo ATUALIZA em vez de duplicar. O ensaio pode ser repetido
--        a vontade, e no dia da virada roda-se uma ultima vez.
--     2. Qualquer coisa que ja referencie aquele id — planilha, link, anotacao
--        de alguem — continua apontando para o cliente certo.
--
-- O QUE ELA NAO FAZ, E POR QUE
--   * Nao apaga os clientes de exemplo. Apagar dado que outra pessoa criou nao
--     e trabalho de rotina de importacao. Ela AVISA quais sao.
--   * Nao mexe em `public`. Nem um update, nem um delete.
--   * Nao traz entrega, historico, links nem etiquetas — sao etapas proprias.
--     Cadastro primeiro, porque tudo o mais pendura nele.
-- =============================================================================

-- --- a previa: o que aconteceria, sem acontecer -------------------------------
create or replace function ideworks.migracao_clientes_previa(
  p_somente_ativos boolean default true
) returns table (
  acao      text,
  legado_id uuid,
  nome      text,
  empresa   text,
  plano     text,
  ativo     boolean,
  aviso     text
)
  language plpgsql stable security definer
  set search_path = ideworks, public, pg_temp
as $fn$
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin migra o cadastro' using errcode = '42501';
  end if;

  return query
    select
      case when d.id is null then 'criar' else 'atualizar' end,
      o.id,
      o.nome,
      o.categoria,
      o.plano,
      o.ativo,
      -- Os avisos sao o produto principal do ensaio: cada um e um problema de
      -- dado que apareceria depois, com gente olhando.
      nullif(concat_ws(' · ',
        case when cc.id is null then 'empresa "' || coalesce(o.categoria,'(vazia)') || '" nao existe aqui' end,
        case when o.plano is not null and p.id is null
             then 'plano "' || o.plano || '" nao existe aqui' end,
        case when o.data_inicio is null then 'sem data de inicio' end,
        case when coalesce(o.quantidade_videos,0) + coalesce(o.quantidade_artes,0)
                + coalesce(o.quantidade_fotos,0) + coalesce(o.quantidade_ads,0) = 0
             then 'contrato sem cota nenhuma' end,
        case when d.id is not null and d.name <> o.nome
             then 'nome mudou: "' || d.name || '" -> "' || o.nome || '"' end
      ), '')
    from public.clients o
    left join ideworks.clients d           on d.id = o.id
    left join ideworks.client_categories cc on cc.name = o.categoria
    left join ideworks.plans p              on p.name = o.plano
   where (not p_somente_ativos or o.ativo)
   order by o.ativo desc, lower(o.nome);
end;
$fn$;

-- --- os clientes que ja estavam aqui e NAO vem do legado ----------------------
-- Os cinco de exemplo caem aqui. Sao listados, nunca apagados: a contagem
-- depois da migracao mente enquanto eles existirem, e quem decide o que fazer
-- com eles e gente.
create or replace function ideworks.migracao_clientes_estranhos()
  returns table (id uuid, nome text, empresa text, criado_em timestamptz)
  language plpgsql stable security definer
  set search_path = ideworks, public, pg_temp
as $fn$
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin migra o cadastro' using errcode = '42501';
  end if;

  return query
    select d.id, d.name, cc.name, d.created_at
      from ideworks.clients d
      left join ideworks.client_categories cc on cc.id = d.category_id
     where not exists (select 1 from public.clients o where o.id = d.id)
     order by lower(d.name);
end;
$fn$;

-- --- a migracao de verdade ----------------------------------------------------
create or replace function ideworks.migrar_clientes(
  p_somente_ativos boolean default true
) returns table (criados integer, atualizados integer, cotas integer)
  language plpgsql security definer
  set search_path = ideworks, public, pg_temp
as $fn$
declare
  v_antes integer;
  v_mexidos integer;
  v_cotas integer;
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin migra o cadastro' using errcode = '42501';
  end if;

  select count(*) into v_antes from ideworks.clients;

  -- O UUID DO LEGADO VIRA A CHAVE. Ver o cabecalho: e o que torna a repeticao
  -- barata em vez de destrutiva.
  with origem as (
    select o.*, cc.id as cat_id, p.id as plan_id
      from public.clients o
      join ideworks.client_categories cc on cc.name = o.categoria
      left join ideworks.plans p          on p.name = o.plano
     where (not p_somente_ativos or o.ativo)
       and o.data_inicio is not null
  ), gravado as (
    insert into ideworks.clients (
      id, name, tax_id, company_email, plan_id, category_id,
      started_on, renews_on, phone, whatsapp, address,
      owner_name, owner_phone, owner_whatsapp,
      is_active, inactive_at, urgency, finance_ok, notes
    )
    select
      o.id, o.nome, nullif(btrim(o.cpf_cnpj),''), nullif(btrim(o.email_empresa),''),
      o.plan_id, o.cat_id,
      o.data_inicio, o.data_renovacao,
      nullif(btrim(o.telefone),''), nullif(btrim(o.whatsapp),''), nullif(btrim(o.endereco),''),
      nullif(btrim(o.nome_proprietario),''), nullif(btrim(o.celular_proprietario),''),
      nullif(btrim(o.whatsapp_proprietario),''),
      coalesce(o.ativo, true), o.data_inatividade,
      coalesce(o.urgency_level, 'paz')::ideworks.urgency_level,
      coalesce(o.financeiro_ok, false), nullif(btrim(o.observacoes),'')
      from origem o
    on conflict (id) do update set
      name = excluded.name, tax_id = excluded.tax_id,
      company_email = excluded.company_email, plan_id = excluded.plan_id,
      category_id = excluded.category_id, started_on = excluded.started_on,
      renews_on = excluded.renews_on, phone = excluded.phone,
      whatsapp = excluded.whatsapp, address = excluded.address,
      owner_name = excluded.owner_name, owner_phone = excluded.owner_phone,
      owner_whatsapp = excluded.owner_whatsapp, is_active = excluded.is_active,
      inactive_at = excluded.inactive_at, urgency = excluded.urgency,
      finance_ok = excluded.finance_ok, notes = excluded.notes,
      updated_at = now()
    returning 1
  )
  select count(*)::int into v_mexidos from gravado;

  -- As cotas do contrato. O legado guarda quatro colunas na ficha; aqui cada
  -- tipo e uma linha, que e o que permite um tipo novo entrar sem alterar
  -- tabela.
  --
  -- COTA ZERO NAO ENTRA. Linha com quantidade zero e indistinguivel de "nao
  -- contratado" na leitura, e ocuparia espaco dizendo nada.
  with origem as (
    select o.id, o.quantidade_videos, o.quantidade_artes,
           o.quantidade_fotos, o.quantidade_ads
      from public.clients o
     where (not p_somente_ativos or o.ativo)
       and exists (select 1 from ideworks.clients d where d.id = o.id)
  ), espalhado as (
    select id, tipo, qtd from origem,
      lateral (values
        ('video'::ideworks.content_type, coalesce(quantidade_videos,0)),
        ('arte',                          coalesce(quantidade_artes,0)),
        ('foto',                          coalesce(quantidade_fotos,0)),
        ('ads',                           coalesce(quantidade_ads,0))
      ) as v(tipo, qtd)
     where qtd > 0
  ), gravado as (
    insert into ideworks.client_quotas (client_id, content_type, quantity)
    select id, tipo, qtd from espalhado
    on conflict (client_id, content_type) do update set
      quantity = excluded.quantity, updated_at = now()
    returning 1
  )
  select count(*)::int into v_cotas from gravado;

  return query select
    (select count(*)::int from ideworks.clients) - v_antes,
    v_mexidos - ((select count(*)::int from ideworks.clients) - v_antes),
    v_cotas;
end;
$fn$;

grant execute on function ideworks.migracao_clientes_previa(boolean)   to ideworks_app;
grant execute on function ideworks.migracao_clientes_estranhos()       to ideworks_app;
grant execute on function ideworks.migrar_clientes(boolean)            to ideworks_app;

comment on function ideworks.migrar_clientes(boolean) is
  'Traz o cadastro do Sistema IDE mantendo o uuid de origem, entao rodar de '
  'novo ATUALIZA em vez de duplicar. Le `public`, escreve `ideworks`, nunca o '
  'contrario. So super admin.';
