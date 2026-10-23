-- Desfaz a F12: a administração de pessoas volta a não existir.
--
-- AVISO: papel e carteira voltam a ser editáveis apenas por SQL direto. A tela
-- some, mas as linhas continuam lá — nada de dado se perde.
drop function if exists ideworks.set_user_clients(uuid, uuid[]);
drop function if exists ideworks.set_user_active(uuid, boolean);
drop function if exists ideworks.set_user_role(uuid, boolean, boolean);
drop function if exists ideworks.admin_user_clients(uuid);
drop function if exists ideworks.admin_directory();
