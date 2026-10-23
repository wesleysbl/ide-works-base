-- =============================================================================
-- IDE WORKS — F8b  A porta de leitura do motor
-- =============================================================================
-- O motor roda SEM ator declarado, e e por isso que as funcoes de escrita de
-- metrica o aceitam. Mas isso tambem significa que ele nao enxerga NADA por
-- consulta comum: `meta_assets` tem politica de select por cliente, e sem ator
-- ela devolve vazio.
--
-- Entao a lista de ativos a coletar sai por funcao com dono, com a mesma trava
-- das outras: recusa quando ha sessao de pessoa declarada. Uma pessoa logada
-- que quisesse a mesma lista ja tem a rota `/meta/connections`, que respeita a
-- carteira dela.
--
-- So os ativos LIGADOS e que rendem coleta: BM e pagina sao contexto, nao
-- fonte. E so de cliente ATIVO — coletar dado de quem saiu gasta cota da Meta
-- para alimentar um painel que ninguem abre.
create or replace function ideworks.meta_assets_para_coleta()
  returns table (id uuid, kind ideworks.meta_asset_kind, external_id text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  return query
    select a.id, a.kind, a.external_id
      from ideworks.meta_assets a
      join ideworks.clients c on c.id = a.client_id
     where a.is_active
       and c.is_active
       and a.kind in ('instagram_account', 'ad_account')
     order by a.kind, a.external_id;
end;
$fn$;

comment on function ideworks.meta_assets_para_coleta() is
  'A lista que o motor varre. Existe porque o coletor nao declara ator — e por '
  'isso nao enxerga nada por consulta comum. Recusa quando ha sessao de pessoa: '
  'quem esta logado usa /meta/connections, que respeita a carteira.';

grant execute on function ideworks.meta_assets_para_coleta() to ideworks_app;
