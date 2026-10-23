-- Desfaz a F4.8b. Sem isto, a aba de demandas volta a mostrar tarefa atribuida
-- SEM responsavel para quem nao e administrador — silenciosamente.
drop function if exists ideworks.team_directory();
drop function if exists ideworks.display_name(uuid);
