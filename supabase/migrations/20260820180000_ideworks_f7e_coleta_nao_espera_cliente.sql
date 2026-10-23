-- =============================================================================
-- IDE WORKS — F7e  A coleta não espera atribuição de cliente
-- =============================================================================
-- O QUE ESTAVA ERRADO
--   `meta_assets_para_coleta()` nasceu na F8, quando `client_id` era
--   obrigatório, e por isso fazia JUNÇÃO INTERNA com `clients`:
--
--       join ideworks.clients c on c.id = a.client_id
--
--   A F7d tornou o cliente opcional — a conta existe na Meta com ou sem cliente
--   cadastrado aqui — e eu não voltei nesta função. Resultado: com as 41 contas
--   recém-importadas e nenhuma atribuída ainda, a junção descartava todas e o
--   motor via ZERO ativos. A coleta terminava com desfecho "ok" e nenhuma
--   linha, que é a pior combinação possível: sucesso sem trabalho.
--
-- POR QUE COLETAR SEM CLIENTE É O CERTO, E NÃO UM RELAXAMENTO
--   A Meta guarda métrica de usuário por 90 dias e insight de story por 24
--   horas. **O histórico não existe lá — só vai existir se for nosso.** Dia não
--   coletado é dia perdido para sempre, e não há como buscar depois.
--
--   Fazer a coleta esperar alguém abrir a ficha e ligar a conta a um cliente
--   trocaria uma tarefa humana adiável por perda de dado irreversível. A
--   atribuição serve para saber DE QUEM é o relatório; ela não é condição para
--   o dado existir.
--
--   Quem ainda não pode ver continua não vendo: a política de leitura não muda
--   nesta migration. Conta sem cliente segue visível só para administrador.
--
-- O QUE CONTINUA BARRANDO
--   Conta desligada (`a.is_active = false`) não se coleta — é o interruptor
--   manual, e ele continua valendo.
--
--   Cliente desligado também barra, mas só quando HÁ cliente: contrato
--   encerrado é decisão de parar. Sem cliente atribuído não há decisão nenhuma
--   a respeitar, e o padrão passa a ser guardar.
-- =============================================================================

create or replace function ideworks.meta_assets_para_coleta()
  returns table(id uuid, kind ideworks.meta_asset_kind, external_id text)
  language plpgsql stable security definer
  set search_path = ideworks, pg_temp
as $fn$
begin
  perform ideworks.assert_collector();

  return query
    select a.id, a.kind, a.external_id
      from ideworks.meta_assets a
      -- JUNÇÃO À ESQUERDA, e é o ponto inteiro desta migration: a conta sem
      -- cliente atribuído continua na lista.
      left join ideworks.clients c on c.id = a.client_id
     where a.is_active
       -- Cliente desligado barra; cliente ausente não.
       and (a.client_id is null or c.is_active)
       and a.kind in ('instagram_account', 'ad_account')
     order by a.kind, a.external_id;
end;
$fn$;

comment on function ideworks.meta_assets_para_coleta() is
  'Os ativos a visitar. Conta SEM cliente entra: dia não coletado é dia perdido '
  'para sempre, e atribuição é tarefa humana adiável. Ver a migration F7e.';
