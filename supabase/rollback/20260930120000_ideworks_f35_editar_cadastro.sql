-- Publicar primeiro o Worker anterior, que não oferece edição de cadastro.
-- Dados já corrigidos e auditoria são preservados; somente a função sai.
drop trigger if exists ideworks_profile_edit on auth.users;
drop function if exists ideworks.apply_profile_edit();
