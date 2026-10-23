-- =============================================================================
-- IDE WORKS — F9g  As quebras diárias: seguidor vs não seguidor, e por formato
-- =============================================================================
-- DE ONDE VEIO
--   O usuário mandou as telas do painel do próprio Instagram e perguntou se dá
--   para chegar perto. Medi item por item contra a API, em 2026-08-20. Quase
--   tudo dá, e o que faltava eram estas quebras:
--
--     views  por follow_type        → FOLLOWER=20228 NON_FOLLOWER=33521 UNKNOWN=136
--     reach  por follow_type        → FOLLOWER=7110  NON_FOLLOWER=15329
--     views  por media_product_type → POST=14 STORY=1269 REEL=8191 AD=40317 …
--     total_interactions idem       → POST=18 STORY=28 REEL=354 AD=175
--     follower_demographics age,gender → as 21 combinações que o app empilha
--
--   O único item do painel que a API NÃO entrega é "horários de atividade dos
--   seguidores": `online_followers` responde, mas com valor vazio (`{}`).
--   Medido em dois perfis, dias diferentes. Está na tela deles e não na API.
--
-- POR QUE UMA TABELA GENÉRICA, E NÃO COLUNAS
--   Seriam ao menos dez colunas novas — `views_followers`, `views_story`,
--   `interactions_reel`… — e a Meta acrescenta faixa sem avisar. Na mesma
--   medição apareceram `DEFAULT_DO_NOT_USE` e `CAROUSEL_CONTAINER`, nenhum dos
--   dois documentado. Coluna para cada um seria uma migration por surpresa.
--
-- POR QUE `metric`, `dimension` E `bucket` SÃO TEXTO
--   Pelo mesmo motivo. Enum exigiria migration para um valor que JÁ CHEGOU — e
--   até a migration sair, a coleta daquele dia estaria perdida, porque a Meta
--   não devolve o passado.
--
-- O VALOR PODE SER NEGATIVO
--   Interação é saldo: a Meta desconta o que foi desfeito. Ver F7f.
-- =============================================================================

alter type ideworks.demographic_dimension add value if not exists 'age_gender';

create table ideworks.meta_daily_breakdown (
  asset_id  uuid not null references ideworks.meta_assets(id) on delete cascade,
  day       date not null,
  metric    text not null,
  dimension text not null,
  bucket    text not null,
  value     integer not null,
  collected_at timestamptz not null default now(),
  primary key (asset_id, day, metric, dimension, bucket)
);

create index meta_daily_breakdown_por_dia
  on ideworks.meta_daily_breakdown (asset_id, metric, dimension, day desc);

comment on table ideworks.meta_daily_breakdown is
  'As quebras diarias do perfil: seguidor vs nao seguidor, e por tipo de '
  'conteudo. Formato longo porque o conjunto de faixas nao e fixo nem conhecido '
  'de antemao.';

alter table ideworks.meta_daily_breakdown enable row level security;

create policy breakdown_select on ideworks.meta_daily_breakdown for select
  using (exists (select 1 from ideworks.meta_assets a
                  where a.id = asset_id
                    and (ideworks.acting_is_superadmin()
                         or (a.client_id is not null and ideworks.can_see_client(a.client_id)))));

-- Nenhuma politica de escrita, de proposito: entra pelo motor ou nao entra.

create or replace function ideworks.upsert_daily_breakdown(
  p_asset_id uuid, p_day date, p_metric text, p_dimension text, p_buckets jsonb
) returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare v_chave text; v_n integer := 0;
begin
  perform ideworks.assert_collector();

  -- O grupo do dia e substituido inteiro: faixa que sumiu da resposta tem de
  -- sumir da tabela, senao fica congelada com o ultimo valor que teve.
  delete from ideworks.meta_daily_breakdown
   where asset_id = p_asset_id and day = p_day
     and metric = p_metric and dimension = p_dimension;

  for v_chave in select jsonb_object_keys(p_buckets) loop
    if (p_buckets->>v_chave) ~ '^-?[0-9]+$' then
      insert into ideworks.meta_daily_breakdown
        (asset_id, day, metric, dimension, bucket, value)
      values (p_asset_id, p_day, p_metric, p_dimension, v_chave,
              (p_buckets->>v_chave)::int);
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$fn$;

grant select on ideworks.meta_daily_breakdown to ideworks_app;
grant execute on function ideworks.upsert_daily_breakdown(uuid, date, text, text, jsonb)
  to ideworks_app;
