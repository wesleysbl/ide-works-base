-- =============================================================================
-- IDE WORKS — F11b  Trazer a entrega do Sistema IDE
-- =============================================================================
-- AS TRES DECISOES DE MODELO, E O NUMERO QUE JUSTIFICA CADA UMA
--
-- 1. A SEMANA NAO VEM, E ISSO NAO E PERDA
--    `week_number` no legado e uma GAVETA, nao um periodo: ja foi medido que
--    "dias 1 a 7 = semana 1" explica 35% da semana 1 e 15% da semana 4. Ela nao
--    responde "quando", so "em qual das cinco caixas isto foi posto".
--
--    Aqui a semana e CONSULTA sobre `scheduled_at`. Trazer o numero da gaveta
--    seria trazer uma resposta errada para uma pergunta que agora tem resposta
--    certa.
--
--    Consequencia, e ela e real: dos 3.734 itens dos clientes ativos, so 1.257
--    tem dia. Os outros 2.477 contam no medidor e no contrato, e NAO aparecem
--    na grade semanal nem no calendario. E o que o legado sabe. Inventar dia a
--    partir da gaveta seria fabricar historico.
--
-- 2. O MES DE REFERENCIA E A DATA SE CONTRADIZEM EM 211 ITENS, E OS DOIS VEM
--    Item arquivado em marco e publicado em 2 de abril. Medido: 205 dos 211
--    sao exatamente o mes seguinte, 4 sao o anterior, 2 sao dois meses depois.
--    Isso e TRANSBORDO, nao apodrecimento.
--
--    Entao `month_year` vira `reference_month` (que decide o contrato) e
--    `post_date` vira `scheduled_at` (que decide o calendario), e eles seguem
--    discordando exatamente como discordam la. Forcar os dois a concordar
--    escolheria entre mentir sobre o contrato ou mentir sobre o dia.
--
-- 3. O CONTRATO DO MES E RECONSTRUIDO CONTANDO, NAO COPIADO DA FICHA
--    O legado nao guarda o contrato de cada mes — so as quantidades ATUAIS na
--    ficha do cliente. Medido: elas batem com o que foi planejado em 77,6% dos
--    meses. Copiar a ficha para tras erraria um quinto do historico.
--
--    Mas o legado GERAVA a grade a partir do plano do mes: entao a contagem de
--    itens NAO extras daquele mes E o contrato daquele mes. Reconstruir
--    contando e mais fiel que copiar.
--
-- O QUE O LEGADO NAO SABE, E FICA NULO EM VEZ DE INVENTADO
--   `platform` (nao existia), `completed_by`, `opened_by`, `planning_done_by`,
--   `client_approved_by` — o legado registra QUANDO, nunca QUEM. Preencher com
--   alguem plausivel seria fabricar autoria.
--
-- REPETIVEL, COMO A F11a: o uuid de origem e mantido.
-- =============================================================================

-- --- a previa, que nao escreve nada -------------------------------------------
create or replace function ideworks.migracao_entrega_previa(
  p_somente_ativos boolean default true
) returns table (o_que text, quantidade bigint, observacao text)
  language plpgsql stable security definer
  set search_path = ideworks, public, pg_temp
as $fn$
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin migra a entrega' using errcode = '42501';
  end if;

  return query
  with alvo as (
    select i.* from public.weekly_content_items i
      join public.clients c on c.id = i.client_id
     where (not p_somente_ativos or c.ativo)
       and exists (select 1 from ideworks.clients d where d.id = i.client_id)
  )
  select 'itens a trazer', count(*),
         'os que ja estao aqui serao ATUALIZADOS, nao duplicados' from alvo
  union all
  select 'com dia definido', count(*) filter (where post_date is not null),
         'entram na grade semanal e no calendario' from alvo
  union all
  select 'SEM dia', count(*) filter (where post_date is null),
         'contam no medidor e no contrato; nao aparecem na grade nem no calendario' from alvo
  union all
  select 'concluidos', count(*) filter (where is_completed), null from alvo
  union all
  select 'extras', count(*) filter (where is_extra),
         'nao entram no contrato do mes' from alvo
  union all
  select 'dia fora do mes de referencia',
         count(*) filter (where post_date is not null
                            and to_char(post_date,'YYYY-MM') <> month_year),
         'transbordo — os dois campos vem como estao' from alvo
  union all
  select 'contratos de mes a abrir', count(distinct (client_id, month_year)),
         'reconstruidos contando os itens nao extras de cada mes' from alvo
  union all
  select 'itens de cliente que NAO foi migrado', count(*),
         'ficam para tras ate o cliente vir — rode a F11a com --todos'
    from public.weekly_content_items i
    join public.clients c on c.id = i.client_id
   where (not p_somente_ativos or c.ativo)
     and not exists (select 1 from ideworks.clients d where d.id = i.client_id);
end;
$fn$;

-- --- a migracao ---------------------------------------------------------------
create or replace function ideworks.migrar_entrega(
  p_somente_ativos boolean default true
) returns table (contratos integer, cotas_do_mes integer, itens integer)
  language plpgsql security definer
  set search_path = ideworks, public, pg_temp
as $fn$
declare v_contratos integer; v_cotas integer; v_itens integer;
begin
  if not ideworks.acting_is_super() then
    raise exception 'so o super admin migra a entrega' using errcode = '42501';
  end if;

  -- 1. o contrato do mes -------------------------------------------------------
  -- Nasce de duas fontes: os meses que TEM item, e os meses que so tem ritual
  -- registrado (`client_planning`) — um mes planejado e aprovado sem item ainda
  -- e um mes que existiu, e some se olharmos so para os itens.
  --
  -- O RITUAL VEM AGRUPADO, e nao cru: `client_planning` pode ter mais de uma
  -- linha para o mesmo cliente e mes, e sem agrupar o join multiplicaria.
  with ritual as (
    select p.client_id,
           to_date(p.month_year||'-01','YYYY-MM-DD') as mes,
           bool_or(p.planejamento_ok)  as planejado,
           bool_or(p.aprovado_cliente) as aprovado,
           -- O legado guarda um SIM/NAO e a hora do ultimo toque na linha. Nao
           -- ha quando-exatamente; `updated_at` e a aproximacao honesta.
           max(p.updated_at)           as tocado,
           min(p.created_at)           as nasceu
      from public.client_planning p
      join public.clients c on c.id = p.client_id
     where (not p_somente_ativos or c.ativo)
       and exists (select 1 from ideworks.clients d where d.id = p.client_id)
     group by 1,2
  ), dos_itens as (
    select i.client_id, to_date(i.month_year||'-01','YYYY-MM-DD') as mes,
           min(i.created_at) as nasceu
      from public.weekly_content_items i
      join public.clients c on c.id = i.client_id
     where (not p_somente_ativos or c.ativo)
       and exists (select 1 from ideworks.clients d where d.id = i.client_id)
     group by 1,2
  ), fontes as (
    select client_id, mes, nasceu from dos_itens
    union all
    select client_id, mes, nasceu from ritual
  ), meses as (
    -- AGRUPAR DE NOVO, E NAO CONFIAR NO `union`.
    --   `union` so remove linhas INTEIRAS iguais, e as duas fontes trazem
    --   `nasceu` diferente para o mesmo mes. O lote saia com a chave repetida e
    --   o Postgres recusou com "cannot affect row a second time" — a mesma
    --   armadilha da F7i, tres commits antes, em codigo novo.
    select client_id, mes, min(nasceu) as nasceu from fontes group by 1,2
  ), gravado as (
    insert into ideworks.month_contracts
      (client_id, reference_month, opened_at, planning_done_at, client_approved_at)
    select m.client_id, m.mes, coalesce(m.nasceu, now()),
           case when r.planejado then r.tocado end,
           case when r.aprovado  then r.tocado end
      from meses m
      left join ritual r on r.client_id = m.client_id and r.mes = m.mes
    on conflict (client_id, reference_month) do update set
      planning_done_at   = coalesce(excluded.planning_done_at, ideworks.month_contracts.planning_done_at),
      client_approved_at = coalesce(excluded.client_approved_at, ideworks.month_contracts.client_approved_at)
    returning 1
  )
  select count(*)::int into v_contratos from gravado;

  -- 2. as cotas daquele mes, contadas ------------------------------------------
  with contado as (
    select mc.id as contract_id,
           case i.content_type when 'videos' then 'video' when 'artes' then 'arte'
                when 'fotos' then 'foto' else 'ads' end::ideworks.content_type as tipo,
           count(*) as quantos
      from public.weekly_content_items i
      join public.clients c on c.id = i.client_id
      join ideworks.month_contracts mc
        on mc.client_id = i.client_id
       and mc.reference_month = to_date(i.month_year||'-01','YYYY-MM-DD')
     where (not p_somente_ativos or c.ativo)
       and not i.is_extra
     group by 1,2
  ), gravado as (
    insert into ideworks.month_contract_items (contract_id, content_type, quantity)
    select contract_id, tipo, quantos from contado
    on conflict (contract_id, content_type) do update set quantity = excluded.quantity
    returning 1
  )
  select count(*)::int into v_cotas from gravado;

  -- 3. os itens ----------------------------------------------------------------
  with gravado as (
    insert into ideworks.content_items
      (id, client_id, reference_month, content_type, platform,
       scheduled_at, completed_at, completed_by, is_extra)
    select
      i.id, i.client_id,
      to_date(i.month_year||'-01','YYYY-MM-DD'),
      case i.content_type when 'videos' then 'video' when 'artes' then 'arte'
           when 'fotos' then 'foto' else 'ads' end::ideworks.content_type,
      null,
      -- `post_date` e DATE. Vira meia-noite no fuso da agencia, que e o mesmo
      -- fuso que o calendario usa para ler de volta — senao um item do dia 1
      -- apareceria no dia 31 do mes anterior para quem esta em UTC-3.
      case when i.post_date is not null
           then (i.post_date::timestamp at time zone 'America/Sao_Paulo') end,
      i.completed_at,
      null,
      coalesce(i.is_extra, false)
      from public.weekly_content_items i
      join public.clients c on c.id = i.client_id
     where (not p_somente_ativos or c.ativo)
       and exists (select 1 from ideworks.clients d where d.id = i.client_id)
    on conflict (id) do update set
      reference_month = excluded.reference_month,
      content_type    = excluded.content_type,
      scheduled_at    = excluded.scheduled_at,
      completed_at    = excluded.completed_at,
      is_extra        = excluded.is_extra,
      updated_at      = now()
    returning 1
  )
  select count(*)::int into v_itens from gravado;

  return query select v_contratos, v_cotas, v_itens;
end;
$fn$;

grant execute on function ideworks.migracao_entrega_previa(boolean) to ideworks_app;
grant execute on function ideworks.migrar_entrega(boolean)          to ideworks_app;
