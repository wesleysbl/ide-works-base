-- =============================================================================
-- ROLLBACK da F14d — o convite ja carrega o acesso
-- =============================================================================
-- VOLTA A JANELA ENTRE OS DOIS PASSOS: a pessoa ativa e entra com o padrao, e
-- alguem precisa lembrar de abrir a ficha dela depois para dizer empresa e
-- areas.
--
-- VOLTE O CODIGO JUNTO. A rota de ativacao chama `aplicar_convite`; sem ela, a
-- ativacao quebra e a pessoa fica com conta criada e sem perfil — que foi
-- exatamente o defeito consertado em 2026-08-24.
--
-- As colunas guardam decisao de acesso ja tomada. Apaga-las perde a intencao
-- de convites ainda pendentes, e nao ha de onde tirar de volta.
-- =============================================================================

drop function if exists ideworks.aplicar_convite(uuid, text, uuid);

alter table ideworks.invitations
  drop column if exists categories,
  drop column if exists areas,
  drop column if exists role;
