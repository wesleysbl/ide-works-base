-- =============================================================================
-- IDE WORKS — F9e  Demografia dos seguidores
-- =============================================================================
-- O QUE A META ENTREGA, MEDIDO EM 2026-08-20
--   `follower_demographics`, com `period=lifetime` e `metric_type=total_value`,
--   responde em quatro quebras: idade (7 faixas), gênero (F/M/U), cidade (45) e
--   país (45). Sai sem permissão nova — as mesmas cinco já concedidas bastam.
--
--   O que NÃO existe: "horários ativos". `online_followers` responde, mas o
--   valor vem VAZIO (`{}`). Está no painel do Instagram e não na API; não
--   adianta pedir de outro jeito.
--
-- POR QUE POR DIA, SE A MÉTRICA É `lifetime`
--   Porque `lifetime` significa "como está agora", não "como era em julho". A
--   Meta não guarda o retrato de ontem. Se a gente não guardar, a pergunta
--   "a audiência envelheceu?" fica sem resposta para sempre — e ela é uma das
--   boas.
--
-- POR QUE FORMATO LONGO, E NÃO COLUNAS
--   O número de faixas varia por conta: 45 cidades num perfil, 3 em outro.
--   Coluna fixa não comporta, e coluna por cidade seria um schema que muda
--   quando um seguidor se muda.
--
-- O RETRATO DO DIA É SUBSTITUÍDO INTEIRO
--   `upsert_follower_demographics` apaga o dia antes de gravar. Mesclar deixaria
--   uma cidade que saiu do ranking congelada para sempre com o último valor que
--   teve — um dado que parece vivo e não é.
-- =============================================================================

create type ideworks.demographic_dimension as enum ('age', 'gender', 'city', 'country');

create table ideworks.meta_follower_demographics (
  asset_id   uuid not null references ideworks.meta_assets(id) on delete cascade,
  day        date not null,
  dimension  ideworks.demographic_dimension not null,
  -- Cru, como a Meta devolveu: '25-34', 'F', 'BR',
  -- 'Ribeirao Preto, Sao Paulo (state)'.
  bucket     text not null,
  value      integer not null check (value >= 0),
  collected_at timestamptz not null default now(),
  primary key (asset_id, day, dimension, bucket)
);

create index meta_follower_demographics_por_dia
  on ideworks.meta_follower_demographics (asset_id, dimension, day desc);

comment on table ideworks.meta_follower_demographics is
  'Retrato diario do publico: faixa etaria, genero, cidade e pais. Uma linha '
  'por faixa. Formato longo e nao colunas porque o numero de cidades varia por '
  'conta — 45 num perfil, 3 em outro — e coluna fixa nao comporta.';

alter table ideworks.meta_follower_demographics enable row level security;

create policy demographics_select on ideworks.meta_follower_demographics for select
  using (exists (select 1 from ideworks.meta_assets a
                  where a.id = asset_id
                    and (ideworks.acting_is_superadmin()
                         or (a.client_id is not null and ideworks.can_see_client(a.client_id)))));

-- Nenhuma politica de escrita, de proposito: entra pelo motor ou nao entra.

create or replace function ideworks.upsert_follower_demographics(
  p_asset_id uuid,
  p_day date,
  p_dimension ideworks.demographic_dimension,
  p_buckets jsonb
) returns integer
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
declare
  v_chave text;
  v_n integer := 0;
begin
  perform ideworks.assert_collector();

  delete from ideworks.meta_follower_demographics
   where asset_id = p_asset_id and day = p_day and dimension = p_dimension;

  for v_chave in select jsonb_object_keys(p_buckets) loop
    if (p_buckets->>v_chave) ~ '^[0-9]+$' then
      insert into ideworks.meta_follower_demographics
        (asset_id, day, dimension, bucket, value)
      values (p_asset_id, p_day, p_dimension, v_chave, (p_buckets->>v_chave)::int);
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end;
$fn$;

grant select on ideworks.meta_follower_demographics to ideworks_app;
grant execute on function ideworks.upsert_follower_demographics(
  uuid, date, ideworks.demographic_dimension, jsonb) to ideworks_app;
