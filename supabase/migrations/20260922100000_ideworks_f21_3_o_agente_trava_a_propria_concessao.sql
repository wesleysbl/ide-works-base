-- =============================================================================
-- IDE WORKS — F21.3  O agente pode TRAVAR a própria concessão (e só travar)
-- =============================================================================
-- O INCIDENTE (21 → 22/09/2026)
--   Toda escrita de agente parou. `add_comment` e `move_task` devolviam
--   `permission_denied` — "Concessão inexistente ou fora do alcance" — enquanto
--   `list_comments` respondia normalmente na MESMA sessão, com a MESMA
--   concessão, que tinha `comments:write`. A leitura via, a escrita não.
--
-- A CAUSA
--   A F21.1 (teto diário) passou a carregar a concessão com
--
--       select ... from ideworks.integration_grants
--        where id = $1 for update
--
--   para serializar duas escritas disputando a última vaga da cota. Acontece
--   que, sob RLS, `SELECT ... FOR UPDATE` não é lido só pela política de
--   SELECT: o Postgres aplica TAMBÉM o `USING` das políticas de UPDATE da
--   tabela, como filtro silencioso — a linha que o ator não poderia travar
--   simplesmente não volta, sem erro, sem aviso.
--
--   E `integration_grants_update` (F16.1) exige, de propósito,
--   `ideworks.acting_grant_id() is null` — ou seja, sessão HUMANA. Na escrita
--   de agente esse GUC (`app.grant_id`) nunca é nulo. Resultado: zero linhas,
--   `loadGrant` devolvendo null, e o código recusando a escrita como se a
--   concessão não existisse.
--
--   Provado em produção, como `ideworks_app`, numa concessão viva:
--     ator humano  → select: 1 linha · select for update: 1 linha
--     ator agente  → select: 1 linha · select for update: 0 linhas
--
-- POR QUE CONSERTAR NO BANCO, E NÃO NO CÓDIGO
--   Dava para tirar o `for update` e serializar por convenção entre arquivos.
--   Não. A serialização da cota precisa continuar existindo — sem ela, duas
--   escritas simultâneas leem a mesma contagem e as duas passam pela última
--   vaga. E neste sistema quem julga é o banco: trava que existe por acordo
--   entre arquivos é desfeita pela próxima pessoa sem querer.
--
-- O QUE ESTA POLÍTICA CONCEDE — E O QUE ELA NÃO CONCEDE
--   Ela concede o DIREITO DE TRAVAR a própria linha, nada além. O `USING`
--   libera o `for update`; o `with check (false)` garante que nenhuma
--   alteração efetiva passa: qualquer `UPDATE` de verdade do agente sobre a
--   concessão continua afetando zero linhas — porque o `with check` de
--   `integration_grants_update` continua exigindo sessão humana, e nenhuma
--   política permissiva aqui lhe dá um `with check` verdadeiro.
--
--   O recorte é duplo, de propósito: a linha tem de ser A concessão declarada
--   na sessão (`id = acting_grant_id()`) E pertencer a quem a sessão diz ser
--   (`owner_id = acting_user_id()`). Concessão de outro dono continua
--   invisível ao `for update`, exatamente como antes.
--
-- ADITIVA, E SÓ
--   Nada aqui altera política já aplicada. `integration_grants_update`
--   permanece letra por letra como a F16.1 a escreveu — políticas de RLS são
--   permissivas e se somam, e é a soma que queremos: humano continua sendo o
--   único que escreve; agente ganha apenas o cadeado.
-- =============================================================================

create policy integration_grants_lock_self on ideworks.integration_grants
  for update to ideworks_app
  using (
    ideworks.acting_grant_id() is not null
    and id = ideworks.acting_grant_id()
    and ideworks.acting_user_id() is not null
    and owner_id = ideworks.acting_user_id()
  )
  with check (false);

comment on policy integration_grants_lock_self on ideworks.integration_grants is
  'Deixa o agente TRAVAR (select ... for update) a própria concessão, e nada '
  'mais: o with check (false) impede qualquer alteração efetiva. Existe porque '
  'for update sob RLS também passa pelo USING das políticas de UPDATE — ver o '
  'incidente de 21→22/09/2026 no cabeçalho da migration F21.3.';
