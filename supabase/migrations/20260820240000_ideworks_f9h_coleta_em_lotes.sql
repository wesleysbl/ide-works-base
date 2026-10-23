-- =============================================================================
-- IDE WORKS — F9h  A coleta passa a rodar em lotes, com rodízio
-- =============================================================================
-- O PROBLEMA, CRONOMETRADO
--   Uma varredura completa das 41 contas levou 746 segundos antes das quebras
--   da F9g, e 945 depois — 15,7 minutos. O gatilho de tempo do Cloudflare tem
--   teto de tempo de parede, e 15 minutos passa dele.
--
--   Publicar assim não daria "coleta automática": daria coleta que para no
--   meio, o que é pior, porque o livro de execuções registraria uma execução
--   que parecia ter ido bem.
--
--   E há o efeito colateral: a execução inteira roda numa transação só. Treze
--   minutos segurando lock em `meta_assets` foi o bastante para travar uma
--   migration desta mesma sessão — o `alter table` ficou esperando e estourou.
--
-- A SOLUÇÃO: FILA, E NÃO CURSOR
--   `meta_assets_para_coleta` ganha um limite e passa a ordenar pela conta
--   visitada HÁ MAIS TEMPO. O rodízio sai disso, sem tabela de cursor para
--   manter em dia nem corromper: quem acabou de ser visitada vai para o fim da
--   fila por consequência, não por controle.
--
--   Doze contas por execução, de meia em meia hora: as 41 em pouco mais de duas
--   horas, doze voltas por dia. É MAIS frequente que a coleta diária de antes,
--   não menos — e o story, que a Meta apaga em 24 horas, passa a ser visto doze
--   vezes em vez de uma.
--
-- POR QUE UMA COLUNA NOVA, E NÃO `last_seen_at`
--   `last_seen_at` só avança quando dado CHEGOU — é o que a tela usa para dizer
--   "há quanto tempo o dado parou". Ordenar a fila por ele criaria uma fome:
--   uma conta que falha sempre manteria o valor antigo, ficaria eternamente na
--   frente, e as outras 40 nunca seriam visitadas.
--
--   `last_attempt_at` é o relógio da fila: gravado sempre, inclusive na falha.
--   Os dois campos dizem coisas diferentes e por isso são dois.
--
--   Provado em `scripts/provar-rodizio.mjs`, que inclui o caso da conta que só
--   dá erro.
-- =============================================================================

alter table ideworks.meta_assets add column if not exists last_attempt_at timestamptz;

-- As contas ja coletadas nao sao "nunca tentadas": sem isto, a primeira
-- execucao em lote as trataria todas como iguais e a ordem seria arbitraria.
update ideworks.meta_assets
   set last_attempt_at = last_seen_at
 where last_attempt_at is null and last_seen_at is not null;

comment on column ideworks.meta_assets.last_attempt_at is
  'O RELOGIO DA FILA: sempre gravado, com sucesso ou com falha. E diferente de '
  '`last_seen_at`, que so avanca quando dado chegou. A distincao existe porque '
  'a fila ordena pelo mais antigo — e se ela olhasse `last_seen_at`, uma conta '
  'que falha sempre ficaria eternamente na frente e as outras nunca seriam '
  'visitadas.';

create or replace function ideworks.touch_asset(p_asset_id uuid, p_error text)
  returns void
  language plpgsql security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();
  update ideworks.meta_assets
     set last_seen_at    = case when p_error is null then now() else last_seen_at end,
         -- Sempre, inclusive na falha. Ver o comentario da coluna.
         last_attempt_at = now(),
         last_error      = p_error,
         updated_at      = now()
   where id = p_asset_id;
end;
$fn$;

-- A ASSINATURA ANTIGA PRECISA MORRER PRIMEIRO.
--
-- `create or replace function f(p integer default 0)` NAO substitui `f()`:
-- assinatura diferente e funcao diferente, entao as duas passariam a coexistir
-- e `f()` viraria AMBIGUA — "could not choose a best candidate function".
--
-- Aconteceu: quebrou `scripts/provar-coleta.mjs` na hora. O motor nao quebrou
-- porque sempre passa o limite explicitamente, o que e pior — o defeito ficaria
-- escondido ate alguem chamar sem argumento.
drop function if exists ideworks.meta_assets_para_coleta();

-- O padrao zero significa "sem teto", para o script de linha de comando
-- continuar podendo varrer tudo de uma vez.
create or replace function ideworks.meta_assets_para_coleta(p_limite integer default 0)
  returns table(id uuid, kind ideworks.meta_asset_kind, external_id text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  return query
    select a.id, a.kind, a.external_id
      from ideworks.meta_assets a
      left join ideworks.clients c on c.id = a.client_id
     where a.is_active
       and (a.client_id is null or c.is_active)
       and a.kind in ('instagram_account', 'ad_account')
     -- A MAIS ANTIGA PRIMEIRO. E o que faz o rodizio funcionar sozinho.
     order by a.last_attempt_at asc nulls first, a.kind, a.external_id
     limit case when p_limite > 0 then p_limite else null end;
end;
$fn$;

grant execute on function ideworks.meta_assets_para_coleta(integer) to ideworks_app;
