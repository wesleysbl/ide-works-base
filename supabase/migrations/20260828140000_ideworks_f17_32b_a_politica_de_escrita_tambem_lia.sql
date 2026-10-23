-- =============================================================================
-- IDE WORKS — F17.32b  A politica de ESCRITA tambem estava lendo
-- =============================================================================
-- ⚠️ A F17.32 APERTOU A FUNCAO E O NUMERO NAO SE MEXEU. ESTE ARQUIVO E O PORQUE.
--   Depois de `can_see_client` e `can_see_asset` passarem a exigir
--   `acting_is_super()`, a medida como `ideworks_app`, agindo como
--   `gestao@exemplo.com.br` (papel `admin`, empresas `Ide` + `Ide Hub`),
--   deu isto:
--
--     select count(*) from ideworks.meta_assets                       -> 106
--     select count(*) from ideworks.meta_assets where can_see_asset(id) ->  45
--
--     select count(*) from ideworks.clients                           ->  96
--     select count(*) from ideworks.clients where can_see_client(id)  ->  94
--
--   A funcao estava certa e a tabela continuava aberta. A regra nova nao era
--   consultada porque nao precisava ser: outra politica ja tinha dito sim.
--
-- A CAUSA: `FOR ALL` INCLUI `SELECT`
--   `clients_write` e `meta_assets_write` — e mais cinco irmas — foram escritas
--   como politica de ESCRITA:
--
--     create policy clients_write on ideworks.clients for all
--       using (ideworks.acting_is_superadmin()) with check (...);
--
--   Mas `for all` no Postgres nao quer dizer "todo comando de escrita": quer
--   dizer TODO COMANDO, `select` incluido. E politicas permissivas se somam com
--   OU. Entao a tabela lia por dois caminhos — o `_select`, que respeita a
--   empresa, e o `_write`, que so perguntava "administra?" — e bastava o
--   segundo dizer sim.
--
--   E o mesmo defeito da F17.32 em outra roupa: um nome que promete menos do
--   que o objeto faz. La era `is_superadmin` parecendo "e super admin"; aqui e
--   `_write` parecendo "so escreve".
--
-- O QUE MUDA, E O QUE NAO MUDA
--   Cada `for all` vira `for insert` + `for update` + `for delete`, com a
--   MESMA expressao, palavra por palavra. Nenhuma escrita e perdida:
--
--     · quem administra continua criando, alterando e apagando cliente, conta
--       da Meta, link, cota, etiqueta atribuida, contrato e item de contrato —
--       de QUALQUER empresa, exatamente como antes desta migration. Isso e
--       deliberado: a etapa fecha LEITURA, e mexer no alcance da escrita
--       administrativa e outra decisao, com outras telas para conferir;
--     · o que some e o segundo caminho de LEITURA. A partir daqui cada uma
--       destas sete tabelas le por UMA politica so, a `_select`, que pergunta a
--       `can_see_client` ou a `can_see_asset` — a regra que a F17.32 apertou.
--
-- POR QUE SETE TABELAS, E NAO AS TREZE QUE TEM `for all` COM `acting_is_superadmin`
--   Escolhidas pelo criterio de o `_select` delas ser ESTREITO — quer dizer, de
--   a politica de leitura ja depender da empresa. Sao exatamente as que
--   perguntam a `can_see_client` ou a `can_see_asset`:
--
--     clients · meta_assets · client_links · client_quotas ·
--     client_tag_assignments · month_contracts · month_contract_items
--
--   As outras seis ficam de fora COM MOTIVO, e nao por esquecimento:
--
--     · `client_categories`, `client_tags` e `plans` leem por
--       `acting_user_id() is not null` — sao catalogo, abertos a quem entrou.
--       Dividir a politica de escrita delas nao mudaria um numero. Que o
--       catalogo de EMPRESAS seja legivel por todos e uma decisao de desenho
--       para o usuario tomar, e nao efeito colateral desta correcao — fica
--       anotado no relatorio da etapa.
--     · `spaces` e `task_types` leem por `can_see_space`, que hoje deixa quem
--       administra passar por causa de `reaches_company_for` — o furo latente
--       registrado no cabecalho da F17.32. Aperta-las aqui nao mudaria nada
--       enquanto aquele furo estiver aberto, e daria a impressao de que a
--       arvore foi tratada.
--     · `user_clients` le por `user_id = acting_user_id() or
--       acting_is_superadmin()` — quem administra ve a carteira de todo mundo
--       de propriedade. Mexer nisso e a pergunta "quem administra ve quais
--       PESSOAS", que a regra do usuario alcanca e esta etapa nao respondeu.
--
-- ⚠️ O PRECO DISTO, MEDIDO: `insert ... returning` PARA DE FUNCIONAR
--   Fechar leitura mexe em ESCRITA, e nao e obvio. `insert ... returning id`
--   exige que a politica de SELECT aprove a linha recem-criada — e
--   `can_see_client` e `can_see_asset` sao `stable`: elas enxergam o retrato do
--   banco de ANTES da instrucao, onde a linha nova ainda nao existe. Resultado
--   medido em 2026-08-28, agindo como `gestao@`:
--
--     insert into ideworks.clients (...) returning id   -> 42501, RECUSADO
--     insert into ideworks.clients (...)                -> 1 linha, OK
--
--   E recusado ate para cliente da PROPRIA empresa. Cadastrar cliente e
--   conectar conta da Meta parariam de funcionar para quem administra.
--
--   Por isso `src/server/client-write.ts` (`createClient`) e
--   `src/server/meta-conexoes.ts` (`conectarAtivo`) passaram a gerar o `uuid`
--   do lado do servidor e a inserir SEM `returning`. A instrucao seguinte da
--   mesma transacao ja enxerga a linha normalmente — o retrato so estava velho
--   dentro da propria instrucao de insercao.
--
--   ⚠️ QUEM ESCREVER `insert ... returning` NESTAS SETE TABELAS VAI ESBARRAR
--   NISSO DE NOVO. A assercao que guarda esse conhecimento esta em
--   `scripts/provar-empresa-de-quem-administra.mjs`, secao 5: ela exige que o
--   `returning` continue sendo recusado, para que o dia em que ele parar de ser
--   recusado — porque alguem afrouxou a leitura outra vez — apareca em
--   vermelho.
--
-- A MUDANCA DE ALCANCE QUE FICA, e que e do usuario decidir
--   `update ... where id = X` e `delete ... where ...` tambem precisam LER a
--   linha. Entao quem administra continua podendo escrever em linha de outra
--   empresa pela politica `_insert`, mas nao consegue mais ALTERAR nem APAGAR
--   uma linha que nao enxerga — o comando encontra zero linhas. Nenhuma tela
--   depende disso (as duas administradoras so operam `Ide`/`Ide Hub`, e as
--   escritas de dominio passam por funcao `security definer`), e o efeito esta
--   medido na secao 5 da prova. Alinhar tambem a ESCRITA a empresa e uma etapa
--   propria: ela mexe em `spaces_write`, `set_user_*` e na tela de Contas.
--
-- SEGURANCA POR LINHA
--   Nenhuma tabela nova. Sete politicas viram vinte e uma, e nenhuma tabela
--   fica sem cobertura em nenhum comando: cada `for all` derruba tres
--   politicas nomeadas no lugar dela, na mesma transacao.
--
--   A convencao de nome e a que o schema ja usa em `client_history`,
--   `content_items` e `invitations`: `<tabela>_insert`, `_update`, `_delete`.
-- =============================================================================

-- --- 1. clientes -------------------------------------------------------------
drop policy if exists clients_write on ideworks.clients;

create policy clients_insert on ideworks.clients for insert
  with check (ideworks.acting_is_superadmin());
create policy clients_update on ideworks.clients for update
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
create policy clients_delete on ideworks.clients for delete
  using (ideworks.acting_is_superadmin());

-- --- 2. contas da Meta -------------------------------------------------------
drop policy if exists meta_assets_write on ideworks.meta_assets;

create policy meta_assets_insert on ideworks.meta_assets for insert
  with check (ideworks.acting_is_superadmin());
create policy meta_assets_update on ideworks.meta_assets for update
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
create policy meta_assets_delete on ideworks.meta_assets for delete
  using (ideworks.acting_is_superadmin());

-- --- 3. links do cliente -----------------------------------------------------
drop policy if exists client_links_write on ideworks.client_links;

create policy client_links_insert on ideworks.client_links for insert
  with check (ideworks.acting_is_superadmin());
create policy client_links_update on ideworks.client_links for update
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
create policy client_links_delete on ideworks.client_links for delete
  using (ideworks.acting_is_superadmin());

-- --- 4. cotas do cliente -----------------------------------------------------
drop policy if exists quotas_write on ideworks.client_quotas;

create policy quotas_insert on ideworks.client_quotas for insert
  with check (ideworks.acting_is_superadmin());
create policy quotas_update on ideworks.client_quotas for update
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
create policy quotas_delete on ideworks.client_quotas for delete
  using (ideworks.acting_is_superadmin());

-- --- 5. etiquetas atribuidas ao cliente --------------------------------------
drop policy if exists tag_assign_write on ideworks.client_tag_assignments;

create policy tag_assign_insert on ideworks.client_tag_assignments for insert
  with check (ideworks.acting_is_superadmin());
create policy tag_assign_update on ideworks.client_tag_assignments for update
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
create policy tag_assign_delete on ideworks.client_tag_assignments for delete
  using (ideworks.acting_is_superadmin());

-- --- 6. contratos do mes -----------------------------------------------------
drop policy if exists contracts_write on ideworks.month_contracts;

create policy contracts_insert on ideworks.month_contracts for insert
  with check (ideworks.acting_is_superadmin());
create policy contracts_update on ideworks.month_contracts for update
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
create policy contracts_delete on ideworks.month_contracts for delete
  using (ideworks.acting_is_superadmin());

-- --- 7. itens do contrato ----------------------------------------------------
drop policy if exists contract_items_write on ideworks.month_contract_items;

create policy contract_items_insert on ideworks.month_contract_items for insert
  with check (ideworks.acting_is_superadmin());
create policy contract_items_update on ideworks.month_contract_items for update
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
create policy contract_items_delete on ideworks.month_contract_items for delete
  using (ideworks.acting_is_superadmin());
