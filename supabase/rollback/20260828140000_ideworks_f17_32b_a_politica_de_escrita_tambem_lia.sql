-- =============================================================================
-- ROLLBACK da F17.32b — a politica de escrita tambem estava lendo
-- =============================================================================
-- ⚠️ ISTO REABRE O VAZAMENTO, E DESTA VEZ SEM DEIXAR PISTA NA FUNCAO
--   Voltar `for insert` + `for update` + `for delete` para um `for all` unico
--   devolve as sete tabelas o SEGUNDO caminho de leitura: quem administra volta
--   a ler cliente, conta da Meta, link, cota, etiqueta, contrato e item de
--   contrato de QUALQUER empresa — mesmo com `can_see_client` e `can_see_asset`
--   apertadas pela F17.32.
--
--   E o pior modo de falhar deste sistema: a regra fica escrita certa na funcao,
--   quem for conferir vai ler a funcao, e o numero vai continuar errado. Foi
--   exatamente assim que a F17.32 apertou a funcao e mediu 106 no lugar de 45.
--
--   Se este arquivo for aplicado, aplique junto o rollback da F17.32 — deixar
--   as funcoes apertadas e as politicas abertas nao volta a nenhum estado que
--   este projeto ja teve; cria um terceiro, que ninguem provou.
--
-- O QUE ELE NAO DESFAZ, E DE PROPOSITO
--   Nenhum dado. A F17.32b nao escreveu uma linha em nenhuma tabela: so trocou
--   politica por politica.
--
-- NENHUM MOMENTO SEM COBERTURA
--   Cada tabela derruba as tres politicas nomeadas e recria a `for all` na mesma
--   transacao. `drop policy if exists` para que reaplicar este arquivo sobre um
--   estado ja revertido nao seja erro.
-- =============================================================================

-- --- 1. clientes -------------------------------------------------------------
drop policy if exists clients_insert on ideworks.clients;
drop policy if exists clients_update on ideworks.clients;
drop policy if exists clients_delete on ideworks.clients;

create policy clients_write on ideworks.clients for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- --- 2. contas da Meta -------------------------------------------------------
drop policy if exists meta_assets_insert on ideworks.meta_assets;
drop policy if exists meta_assets_update on ideworks.meta_assets;
drop policy if exists meta_assets_delete on ideworks.meta_assets;

create policy meta_assets_write on ideworks.meta_assets for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- --- 3. links do cliente -----------------------------------------------------
drop policy if exists client_links_insert on ideworks.client_links;
drop policy if exists client_links_update on ideworks.client_links;
drop policy if exists client_links_delete on ideworks.client_links;

create policy client_links_write on ideworks.client_links for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- --- 4. cotas do cliente -----------------------------------------------------
drop policy if exists quotas_insert on ideworks.client_quotas;
drop policy if exists quotas_update on ideworks.client_quotas;
drop policy if exists quotas_delete on ideworks.client_quotas;

create policy quotas_write on ideworks.client_quotas for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- --- 5. etiquetas atribuidas ao cliente --------------------------------------
drop policy if exists tag_assign_insert on ideworks.client_tag_assignments;
drop policy if exists tag_assign_update on ideworks.client_tag_assignments;
drop policy if exists tag_assign_delete on ideworks.client_tag_assignments;

create policy tag_assign_write on ideworks.client_tag_assignments for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- --- 6. contratos do mes -----------------------------------------------------
drop policy if exists contracts_insert on ideworks.month_contracts;
drop policy if exists contracts_update on ideworks.month_contracts;
drop policy if exists contracts_delete on ideworks.month_contracts;

create policy contracts_write on ideworks.month_contracts for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());

-- --- 7. itens do contrato ----------------------------------------------------
drop policy if exists contract_items_insert on ideworks.month_contract_items;
drop policy if exists contract_items_update on ideworks.month_contract_items;
drop policy if exists contract_items_delete on ideworks.month_contract_items;

create policy contract_items_write on ideworks.month_contract_items for all
  using (ideworks.acting_is_superadmin()) with check (ideworks.acting_is_superadmin());
